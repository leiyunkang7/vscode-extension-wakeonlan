---
status: accepted
---

# 目标寻址靠设备记录表达，不靠设置面

一条目标由**一个寻址方式**与**一份设备记录**共同确定（见 `GLOSSARY.md`）。寻址方式只有两档：**隐式广播**（发包位置上每张非 internal IPv4 网卡各发一份到本子网广播地址）与**显式地址**（只发一份到用户指明的那一处，单播）。**域名不是第三档，它是显式地址的一种取值**——票 #4 题面的「三档」在查证后塌成两档，因为域名与显式 IP 走的是同一条发送路径，差别只在发送前多一步解析。

显式地址**存在设备记录里，走 `globalState`**，不进 `contributes.configuration`。本扩展唯一的活动配置键是 `count`，且它是**全局单键**、`scope: "machine"`。`port` 固定 9、`interval` 固定 100ms（ADR #3 的契约），不可配，所以题面那问「端口是全局默认还是每设备覆盖」在本图里没有位置。

这张 ADR 存在的理由是回答一个未来的读者必然会问的问题：**"设置面就是为用户逐机器配置而生的，为什么要把一份网络目标清单放进去？"** 答案是设置面**表达不了这份记录**，四条依据都在 1.138.0 精确 commit `7debcd0e` 上核实（全文见 [`docs/research/addressing-fact-sweep-partial.md`](../research/addressing-fact-sweep-partial.md) 第 8 节）：

1. **`MAC → 一条记录` 在 Settings UI 里不可编辑。** 值 schema 是 object / array / `oneOf` 时整项退化为「Edit in settings.json」链接（`settingsTreeModels.ts:265-278`、`:880-924`；`isSimpleType` 只含 string/boolean/integer/number），没有 Add Item、没有行级校验。一条记录有名称与显式地址两个字段，所以键控表方案必须拆成两个**标量**表才能保住 UI 可用性——然后撞上第 2 条。
2. **拆成两键之后，用户没有彻底删除一条记录的路径。** 配置值是多层 ConfigurationModel 的 `mergeContents`，**对 object 递归合并**（`configurationModels.ts:219-229`）：子键级覆盖成立、整键替换不成立，而**上层写过的子键删不掉**——写 `null` 的白名单是硬编码的，全仓库只有 `workbench.editor.customLabels.patterns` 一条（`settingsTreeModels.ts:872-874`）。
3. **键的形状受限。** 键树只按 `.` 切分（`configuration.ts:250`、`:331`），冒号安全但**点号不安全**；而 `%key%` 必须整串匹配 `/^%([\w\d.]+)%$/i`（`@vscode/vsce/out/nls.js:4`），charset **不含冒号与连字符** ⇒ MAC 形态的键根本不能用作 nls key，本地化字符串那一步就断了。
4. **把用户的目标清单放进配置面，会让它的存储位置随窗口形态漂移。** 显式 `machine` 域在 remote 窗口读 `<远端 userData>/Machine/settings.json`，该路径**由远端服务器进程算出**（`browser/configuration.ts:398-401` + 1.138.0 产物 `server-main.js` 偏移 724141）；remote 时本地用户 `settings.json` 被过滤为 `LOCAL_MACHINE_SCOPES`（**不含 MACHINE**，`configurationService.ts:53-59`），而 Settings Sync 的资源是 `profile.settingsResource`（`settingsSync.ts:71,93,323-340`）⇒ **远端 Machine 文件里的值不是同步对象**。同一个键在有 remote 与无 remote 的两种窗口里落在不同文件、同步参与也不同。

第 4 条与 `globalState` 的对比是决定性的：#17 已证 Memento **恒落在窗口客户端**（同窗口的两种宿主共享同一份 `state.vscdb`）。把记录放在一个**位置确定**的地方，才与 ADR 0005「采集面与发包面是同一台机器」那条立场接得上。

## 域名在扩展手里解析，不在 `dgram` 里解析

先 `dns.lookup` 拿到地址，再把**解析结果**交给 `sendToHost(mac, ip)`。解析失败（`ENOTFOUND` / `EAI_AGAIN`）归类为 `failed`，raw code 原样进日志，**不得归入 `timed-out`**。

判据是实测：把域名字符串直接交给 `socket.send` 时，解析就地发生，失败形状是 `err=EAI_AGAIN` 且 **`bytes=undefined`——一个包都没发出去**，而回调耗时逐字跟随 resolver 超时（Node v24.21.0，`unshare -n` + 自建 DNS：`options timeout:1 attempts:1` → 1007ms；`timeout:10` → **10015ms**）。#3 的 deadline 是 `(count-1)×interval + 500ms`，**盖不住**一次 DNS 挂起。于是「没发出去」会被说成「发了但没回应」，正是 ADR 0002 禁止规则管的那件事。

两条连带收益：传解析后的 IP ⇒ **不会二次解析**；ADR 0005 的同网段谓词此前对域名无从下手（不解析就不知道落在哪个网段），现在它作用于**解析结果**，括注才第一次能诚实出声。

两条**未证事项必须写进规格而不是等实现时才发现**：`dns.lookup` **没有 timeout 参数**，只能整体 `race`，而 race 之后 resolver 是否真中止、原 promise 有无句柄残留——未查证；多地址时实测**只走第一条、无 failover**（三次发送全部落在 `127.0.0.2`），所以「域名解析出两个 IP」对用户不可见，规格要么明写「只试第一条」，要么自己实现遍历。

## 不选网卡，也不 bind `from`

单播不按目标子网挑本地接口、不 `bind` 源地址，交给内核路由。目标与本机同网段时那条 connected route 本来就会被选中，`bind` 不改变出接口，两张同 /24 网卡之间选哪张也不影响包能否抵达，却**新增一处不可观测的失败**（绑到已失效的本机地址得到 socket error，而它在本扩展四态结果里没有位置）。

更根本的一条：网卡枚举只给地址、掩码、family、mac、internal、cidr，**没有任何字段能区分接口类型**，所以「这张网卡收不收得到唤醒报文」对扩展是不可知的（已写进 `GLOSSARY.md` 的边界条）。挑卡、让用户挑卡、引入原生依赖去查接口类型，三者都换不来任何一级证据。

**解析到公网或跨网段地址时照常发出**，但唤醒结果只断言发送方事实——「已向 `<地址>` 发出 N 个唤醒报文，本机未持有任何关于该目标的证据」，并明写该情形不在能力承诺内。**既不拒绝也不反向安慰**（ADR 0005）。⚠️ 且**不得**用 Out of scope 那条「跨路由器的远程唤醒」来关闭任何关于发包位置的问题：两者是不同失败原因。

## `count` 是全局单键，`scope: "machine"`

`count` 描述的是「这台机器的网卡往网络上发几个包」，绑的本来就是**发包位置那台机器**，而不是用户打开了哪个文件夹。`machine` 域在 remote 下恰好跟着扩展进程落点，与 ADR 0005 自洽。

不选 `window`：它允许一个签进 git 的 `.vscode/settings.json` 决定别人机器上唤醒发几个包。不选 `machine-overridable`：那是 `machine` 的弱版，保留的正是上面那条不想要的覆盖路径。不做每设备覆盖：#5 已定**等待提示刻意不带数字**，每设备 `count` 会让 deadline 变成逐目标的，而用户在等待期间看不到任何症状变化——参数变了而症状不变，是规格里最容易读错的一类。

连带代价必须一并钉住：同一个 `count` 键在无 remote 窗口里写进本地用户 `settings.json`（**参与**同步），在 remote 窗口里落到远端 `Machine/settings.json`（**不参与**同步），所以「现在生效的是哪一份」对用户不可见。⇒ **日志行与「复制给维护者」的文本必须带上 `count` 的生效值与它来自哪个 scope 与文件**（该要求作为会话头行那一问的输入交给 #15）。

## Considered Options

- **`contributes.configuration` 里一个 MAC 键控的 object 覆盖层** — 否，见上面四条依据。键名字符集与 schema 表达力**都不是**障碍（`patternProperties` / `propertyNames` 被校验器与 UI 双重实装，先例有 `vscode-lldb` 与 GitLens 的 `gitlens.modes`）；否掉它的是「一条记录有两个字段」。
- **拆成两个标量键控表**（`targets.<MAC>` → 显式地址，`targetLabels.<MAC>` → 名称） — 否，删除路径不通（依据 2）且 MAC 不能作 nls key（依据 3）。
- **每设备一个 `count`** — 否，症状不可见。
- **把域名交给 `dgram` 就地解析** — 否，会把「没发出去」渲染成「没回应」。
- **v0.1.0 砍掉域名** — 否，那需要重画目的地，而地图 Notes 明写「显式 IP 与域名也要支持」，且没有证据表明用户没有这个场景。

## Consequences

- 设备记录的字段形状**不受 manifest schema 与 Settings UI 渲染限制约束**，但受 #13 已定的那条不变量约束：**`iconPath` 不得持久化**。形状的最终裁定归 #6。
- 表单（#7）成为写入这份记录的**唯一通路**，因为设置面已不在候选里。
- 记录继续住 `globalState` ⇒ #9 的「修 `useLocalStorage` 还是绕开」从边缘情况升为主路径；#17 那条「两台机器各一份记录、互相看不见」的可用性缺口**继续存在**，将来只能靠 `setKeysForSync` 补，而启用它就必须一并裁定网络拓扑数据外流。
- 规格里凡出现「目标」都必须能与「显式地址」区分开：后者是记录上可空的一段自由文本，空着即隐式广播。

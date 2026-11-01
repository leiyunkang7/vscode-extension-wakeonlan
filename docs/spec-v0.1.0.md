# Wake On Lan v0.1.0 规格

这份文档是地图 [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) 的**目的地**。它的目标只有一个：**没有参与过那些讨论的人，照着它实现就能发布 v0.1.0，不需要回来问任何产品问题。**

**读法与裁决顺序。** 本文是**汇编**，不是论证——每条结论后面的出处是它被裁定的地方。冲突时按这个顺序：本文正文 → `docs/adr/` → 票据决议 → `docs/research/`。想改任何一条，去改对应 ADR，不要在实现时"顺手变通"。

- 词汇一律用 [`GLOSSARY.md`](../GLOSSARY.md) 里的规范词。**特别地**：「目标」「设备记录」「邻居条目」「未完成条目」「发包位置」「寻址方式」「显式地址」「唤醒结果」「发送方事实」「反证」「未确认」「理由」「日志」「规范形式」「表单」。**「设备」指对端机器本身，不指记录。**
- 标注 **⚠️ 待验证** 的条目是已知未证实的，实现时不得当作已知；标注 **【待决】** 的条目是人还没拍的板，见第 19 节。

---

## 1. 范围

v0.1.0 做四件事：把唤醒报文从本机发到局域网（也可定向到一个显式地址）、把目标存成可复用的设备记录、从邻居缓存里采集候选、诚实报告发送方发生了什么。

**明确不做**（每条都有出处，都不是"以后再说"）：

| 不做 | 为什么 | 出处 |
|---|---|---|
| **跨路由器的远程唤醒** | L2 广播到不了 NAT 后面。路由器侧 WOL 中继 / 公网端口转发 / 静态 IP 单播都不在能力承诺内。**这不是一个设置能解决的问题**，规格必须把这句写进去 | 地图 Out of scope |
| **活性探测**（确认机器醒没醒） | 肯定信号在扩展的运行时里构造不出来：TCP connect 需要一个地址，而隐式广播的目标压根没有；连上了也归因不到这次唤醒；选哪个端口就是赌，赌错得到一次假反证；唯一诚实的机制要原生依赖 | [0011](adr/0011-no-liveness-probe-the-signal-is-not-constructible.md) |
| **SecureOn 密码** | 技术障碍已随发包层归自己而消失（尾部追加 4 或 6 字节），但不进 v0.1.0；没有权威厂商弃用矩阵，不匹配是完全静默失败 | 地图 Out of scope |
| **把自动发现做成好用的产品** / 全子网扫描 | port-80 主动扫描已被明确处决（每次渲染 504 次 outbound connect，且把"没 HTTP 服务的活机"报成不在 = 制造反证） | [0003](adr/0003-discovery-as-capture-not-presence.md) |
| **任何关于目标状态的断言** | 没有证据就不许断言 | [0002](adr/0002-honesty-contract-for-wake-results.md) |
| **策略性拒绝机制**（检测到远程就拒发、地址跨段就拒发、重复就拒存） | 那是可用性失效不是诚实违约；且这条路径上没有异常可捕获 | [0005](adr/0005-sending-position-disclosure-not-refusal.md)、[0007](adr/0007-device-record-identity-is-hardware-address.md) |

**⚠️ 三条不同失败原因不得互相援引关闭**：目标不在同一网段（跨路由器，范围外）、发包的那台机器不是用户以为的那台（范围内，靠披露）、报文构造不出来（范围内，归 `failed`）。

## 2. 运行时基线

- `engines.vscode: ^1.138.0`，`@types/vscode: ^1.138.0`，两者必须同向（否则 `vsce package` 直接失败）。
- **扩展宿主从不跑在 Node 26 上。** 真实宿主 Node 区间是 **v24.18.1–v24.21.0**（1.138.0→24.18.1，1.139.0→24.20.0，1.140.0→24.21.0）。凡历史文档里"实测于 v26.4.0"的表述一律按 v24 理解。
- 已在本机真实 v24.18.1 复现：`dgram` 静默 bind 挂起（回调永不触发、进程存活、exit 0）；**`bindSync` 在 v24 上不存在**（任何把它当第二条错误通道的方案直接不可用）；发往死地址 `cb err=null bytes=102`。
- 工具链按 [0001](adr/0001-bun-oxlint-oxfmt-typescript7.md)：Bun 管包与脚本、`tsc -p ./` 编译到 `out/`、Oxlint + Oxfmt、mocha + `@vscode/test-electron` 跑集成测试。**不引入打包器，不引入原生依赖，不引入新的测试基建。**
- `.oxlintrc.json` 的 `typescript/no-floating-promises` 是 **error**：发包与读表的 promise 必须被 await 或显式处理。

## 3. 数据模型：设备记录

三个自有字段，**落盘形状与 `vscode.TreeItem` 拆开**（今天落盘的六个字段全是 API 属性、没有一个是自有数据，必须改掉）：

```ts
interface DeviceRecord {
  name: string;        // 可选，空串表示无名
  hardwareAddress: string; // 身份。规范形式；未完成条目里是"没能归一化的原始串"
  explicitAddress: string; // 可选，空即隐式广播。IPv4 字面量或域名
}
```

- **身份是硬件地址**，不是名字、不是显式地址：唤醒报文只携带它，缺了就无可发之物；名字可改可重，显式地址可空且域名要到发送那一刻才解析、两条记录字面上无法比较。([0007](adr/0007-device-record-identity-is-hardware-address.md))
- **记录里不存任何观测到的 IP。** 存下它就得到一个会随时间变成假话的字段，仅有的两条用途都不诚实。活性探测若将来上线，必须自带迁移方案回来，不能现在预存。
- **规范形式**：硬件地址落盘一律小写、冒号分隔、12 位十六进制。接受 `:`/`-`/`.`/空格四种分隔、任意大小写、点分形式可省前导零。
- **`iconPath` 不得持久化**（今天它内嵌写入那台机器的绝对路径，`Uri.toJSON()` 之后读回来是普通对象而非 `Uri`——这是硬失败，不是显示难看）。([#13](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/13))
- **查重只提示、不阻止**：六行随机 MAC 是六个真实不同的网卡地址、每个都是合法唤醒目标。用户逐条收藏那六行，收藏里就是六条，规格必须写明这条残余而不是盖过去。
- **硬件地址是身份，但不是键**：允许同地址多条记录 ⇒ 删除**按树行对象匹配**，不按地址匹配。([0009](adr/0009-lossless-normalization-keeps-broken-rows.md))

## 4. 存储与迁移

- 存 `context.globalState`，落盘键名**沿用 `favoriteList`**（键名用户看不见，改名只给迁移多加一步，收益为零）。**不进 `contributes.configuration`**——设置面表达不了这份记录（四条依据见 [0006](adr/0006-addressing-carried-by-device-record-not-settings.md)）。
- `globalState` 落在**窗口客户端**的 `<userDataDir>/User/globalStorage/state.vscdb`，与扩展进程跑在哪台机器无关；真正分机的是**跨客户端**。**⚠️ `setKeysForSync` 在 remote 宿主下的端到端行为是推断、从未实测；本仓库从未打开过一个真的 `state.vscdb`。** ([#17](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/17))
- **不调用 `setKeysForSync`，且规格必须写明"不同步是一次显式选择、不是存储的属性"**——否则下一个读者会以为它是存储的性质。开它的代价是拓扑数据外流 + 一道从未实测的闸门。([0009](adr/0009-lossless-normalization-keeps-broken-rows.md))
- **删掉 `src/use/useLocalStorage.ts`，直接用 `context.globalState`。** 那三个缺陷（`getItem` 把缺失 key 塌缩成 `''` 使 `rawValue === null` 分支成死代码、`read()` 走写入默认值分支时不赋值给 `data.value`、`Array.isArray` 分支不可达）同源：它试图当通用持久化层，而 v0.1.0 的持久化面只有一条设备列表。
- **迁移是无损的**，按 [0009](adr/0009-lossless-normalization-keeps-broken-rows.md)：
  1. 加一个 schema 版本键（键名见第 19 节【待决】）。
  2. `normalizeDevice(raw)` 是存储数据的**唯一入口**，且**绝不注入默认值**——写默认值会让"用户从没设过"与"这条解析失败"不可区分。
  3. 字段映射：旧 `description` → 硬件地址、旧 `label` → 名字；其余四字段（`collapsibleState`/`iconPath`/`contextValue`/`tooltip`）丢弃。
  4. **归一化失败的行不丢**，按新形状保留 = **未完成条目**（见第 11 节）。丢一行是不可逆地弄丢一台用户正想叫醒的机器。
  5. **非法性是推导出来的，不另存标记位**（否则多出第四个字段，0007 的三字段当场破掉）。
  6. 迁移本身**静默**（只进日志通道）；但「有 N 条待补全」**单独发一条通知**——那是扩展在说"我这里有 N 条东西你得亲自处理"。
  7. **表单不读 legacy 数据**：遗留整形必须在读出侧完成（[#7](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/7)）。
- **未被任何票覆盖的相邻风险**：扩展 id 若变更，老用户 `favoriteList` 直接读不出来（`migrateExtensionStorage` 那条路）。v0.1.0 不改 id，规格只需不得引入新的 id 变更路径。

## 5. 发包层：`src/net/wol.ts`

**移除 `wakeonlan` 依赖与 `src/shims.d.ts`，新建 `src/net/wol.ts`（约 80 行）。** 层内**不认识配置、不认识设备记录、不认识用户目标字符串**，`永远不返回字符串、不 import vscode、不读 I18n`，只吐结构化数据。([#3](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/3))

```ts
type AttemptOutcome = 'sent' | 'error' | 'skipped' | 'unsettled'
interface Attempt { destination: string; source?: string; packetCount: number; outcome: AttemptOutcome; reason?: string }
type SendStatus = 'sent' | 'partial' | 'failed' | 'timed-out'
interface SendResult { status: SendStatus; attempts: Attempt[]; durationMs: number }

sendToBroadcast(mac, opts): Promise<SendResult>  // 枚举接口、逐卡算本子网广播、各绑一个源地址
sendToHost(mac, host, opts): Promise<SendResult> // 定向单播到一个已解析的地址
```

- **常量**：`port` 固定 **9**（7 与 9 在本地等价——NIC 按 102 字节载荷模式匹配、不解析协议栈；而越界端口从 bind 回调里同步 throw，try/catch 够不到 → 崩宿主）。`interval` 固定 **100ms**。两者**不可配**，规格以"常量 + 论证"的方式定死，不回避。
- **唯一活动参数**：`count`，来自配置（第 13 节），有上界。
- **deadline = `(count - 1) × interval + 500ms`**（实测收敛时间是 `(count-1)×interval`，不是常数：`(3,100)`→206ms、`(5,200)`→802ms。**旧的 2s 常数已被证伪**）。不做双阶段 deadline。
- **`error` listener 必须挂在 `bind` 之前**——这一条让"静默挂起"这条路径**在结构上不存在**（库的 bug 是 `socket.once('error')` 注册在 bind 回调内部）。deadline 只是最后一道网，不是主要机制。
- **`setBroadcast(true)` 必须在 bind 回调内、`send` 之前**（libuv 懒初始化下 bind 前调用在 Windows 得 `WSAENOPROTOOPT`、Unix 得 `EBADF`）。
- **`/32` 接口的广播地址会塌缩成接口自己的地址**（本机 `tailscale0 100.70.252.121/32`）⇒ 记为 `skipped`，不是静默丢弃、也不是反证、**不产生理由**。`skipped` 不等于排除 VPN：目标真在 VPN 子网上时仍要发。
- **掩码三态不得合并**：`netmask: null` 会同步 throw（穿透调用方，`.catch()` 来不及注册）→ 必须变成一次结构化 reject；`netmask: ''` 会**静默升级**成 `255.255.255.255`（`parseInt('')`→NaN→`ToInt32=0`→每位 OR 成 255）→ 必须拒绝；非连续掩码（`255.0.255.0`）→ 拒绝，不要 OR 出来。
- **入参校验**：本层对自己拿到的硬件地址做防御性校验（收到非法输入就 reject），但**面向用户的解析与归一化在 `src/device/address.ts`**（第 10 节）。#3 那句"发包层必须自己校验"与 0010 那句"解析器住 address.ts"不冲突：address.ts 负责把用户写的变成规范形式，wol.ts 负责拒绝没变成规范形式的东西。
- **零值与越界逐个定**：`count: 0` 拒绝（发 0 个包不是"发默认 3 个"）；`count` 为负或小数必须被 schema 挡住（`!count` 永不成立 → 无限发包 + 永生 socket + 永生 timer 是真实资源泄漏）；`interval` 不可配所以无 `interval: 0` 这条路径。

## 6. 寻址

两档，不是三档（[#4](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/4)、[0006](adr/0006-addressing-carried-by-device-record-not-settings.md)）：

- **隐式广播**：发包位置上每张非 internal IPv4 网卡各发一份到本子网广播地址。
- **显式地址**：只发一份到用户指明的那一处。**域名不是第三档，它是显式地址的一种取值。**

规则：

- **解析发生在扩展手里**：先 `dns.lookup`，再把**解析结果**交给 `sendToHost`。绝不把域名字符串直接丢给 `socket.send`——那会让解析就地发生，实测失败形状是 `err=EAI_AGAIN` 且 `bytes=undefined`（**一个包都没发出去**），耗时逐字跟随 resolver 超时（1007ms／10015ms），会吃掉整个 deadline，于是"没发出去"会被说成"发了但没回应"。
- 解析失败（`ENOTFOUND`/`EAI_AGAIN`）归 `failed`，raw code 原样进日志，**不得归入 `timed-out`**，理由桶用 `ReasonUnreachable`。
- **多地址实测只走第一条、无 failover** ⇒ 规格明写「域名解析出多个地址时只用第一条」。
- **不挑网卡、不 `bind` 源地址**：单播交给内核路由。`bind` 不改变出接口，却新增一处不可观测的失败（绑到已失效的本机地址得到 socket error，而它四态里没有位置）。更根本：**网卡枚举没有任何字段能区分接口类型**，所以"这张卡收不收得到唤醒报文"对扩展是不可知的。
- **解析到公网或跨网段时照常发出**，但只断言发送方事实，**既不拒绝也不反向安慰**，并明写该情形不在能力承诺内。
- 同网段谓词作用于**解析结果**，只在判定为**不同网段**时出声（见第 12 节）；**零个非 internal IPv4 网卡时不算同网段**。

## 7. 唤醒结果：诚实契约

**v0.1.0 的词汇表里不存在"成功"。** ([0002](adr/0002-honesty-contract-for-wake-results.md))

| 级别 | `SendStatus` | 证据地位 | 提示级别 | 可达 | `[查看日志]` | 两条 Hint |
|---|---|---|---|---|---|---|
| `responded` | — | 有正面证据 | Info | **否，永不产生** | — | — |
| `sent` | `sent` | 发送方事实 | Info | 是 | 不挂 | 挂 |
| `timed-out` | `timed-out` | **没有证据** | Warning | 是 | 挂 | 不挂 |
| `partial` | `partial` | **有反证**（部分目标） | Warning | 是 | 挂 | 不挂 |
| `failed` | `failed` | **有反证**（全部目标） | Error | 是 | 挂 | 不挂 |

- **禁止规则的判据是"扩展是否持有支撑证据"，不是主语是谁。** 有证据的状态断言允许；没有的不允许；对所有 WOL 设备都成立的有保留预期允许（所以能写"通常需要几十秒"，不能写"约 15 秒"）。
- **`timed-out` 与 `partial` 同为 Warning，必须靠措辞区分**——不许用颜色或图标。色弱用户截图转发时颜色就没了。
- **`responded` 槽与 `message.WakeResponded` 键按 0002 保留在文案表里，但必须存在一条可核对的不变量：没有任何代码路径能产出它。** 这不是风格约束——它防的正是"枚举里有一格就顺手接上"。
- **每一级都弹 toast**，不做树节点临时状态。
- **toast 的时长扩展不可控**：`MessageOptions` 只有 `modal`/`detail`，workbench 硬编码 Info 10s / Warning 12s / Error 15s 自动清除，且**扩展拿不到 handle**。标称时长只是**上界**：每次延后重新计满一整轮，窗口失焦时定时器根本不启动 ⇒ **规格里禁止写"10 秒后自动消失"**。
- `failed` 是唯一同时满足 Error + 主要动作的级别 ⇒ 它的 `[查看日志]` 会**粘住**到用户点掉。**证据阶梯与持久性自动对齐：反证留下，发送方事实淡出。**
- 三个理由桶（`skipped` **不产生理由**）：`ReasonDeviceInvalid`（MAC 非法、掩码缺失/非连续、报文构造不出来）、`ReasonNoInterface`（零个可用非 internal IPv4 网卡、`EACCES`）、`ReasonUnreachable`（`ENOTFOUND`/`EAI_AGAIN`/`EHOSTUNREACH`/`ENETUNREACH`）。
- **原始错误码永不进用户可见文案**；raw code 连同 `destination`/`source`/`packetCount` 只进日志。
- `sent` 的证据是"内核接受了报文"，**不是"报文离开了网卡"**，措辞精度按 0002。
- 去重条件：相同 source + **逐字节相同的渲染后文案**才顶替。因为文案内嵌 `{targets}`/`{packets}`，所以连点同一台设备会合并、唤醒不同设备不会。**若将来加"全部唤醒"批量命令，逐设备 toast 会按构造丢失 N-3 条**（同时最多 3 条、800ms 内第 4 条被静默丢弃），届时必须汇总成一条。

## 8. 采集面：发现视图

**它是采集面，不是在场面。** ([0003](adr/0003-discovery-as-capture-not-presence.md)、[#8](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/8))

- **自己写邻居表读取，不 fork `local-devices`**：Linux 读 `/proc/net/arp`（制表符定长、无需子进程、无需提权）；macOS 跑 `arp -an`；Windows 跑 `arp -a`。**三平台读邻居表均无需提权**（**⚠️ Windows/macOS 一侧仅为第三方共识，无厂商权威出处，须标注待验证**；另需注意沙箱化 GUI 扩展可能被 App Sandbox/TCC 拒绝，与 UID 无关）。
- **不做任何主动扫描、不做任何在线/开机断言。** 残影里持有的 MAC 是那台机器**正确**的 MAC，所以"扫到就收藏"对残影健壮——收藏一个幽灵得到的是一条**正确**的记录。
- **Wake-on-ARP 让"睡着的机器不在邻居表里"这个前提不成立**；同时残影可无限期存在。所以**覆盖率既不能承诺"找得到"，也不能承诺"找不到"**。
- **按 `(IP, 硬件地址)` 去重**（双网卡会产生两行）。同一台设备因随机 MAC 出现多行**不归此处**，那是身份键问题（第 3 节：只提示不阻止）。
- **只取 IPv4**（WOL 属 IPv4 域；不引入 `ndp`，它有三种词汇体系）。
- **视图显示名必须去掉在场断言**：改为「近期出现的设备」/ "Devices seen recently"。⚠️ 改的是 **nls 值**，**视图 id 与类名一律不动**（见第 13 节那条不变量）。
- **树首行放一条不可操作说明**：取自**扩展进程所在机器**的邻居缓存快照、可能含已关机主机的残留、保存到收藏后才是耐久唤醒入口、以及第 12 节的发包位置那半句（一条行同时占两个已定 ADR 各要的一格）。
- **发现不可用时显示说明项而非空列表**（空列表 = 把"没有证据"呈现成"有反证"），说明项写明失败原因与平台。**不隐藏视图。**
- **Equipment 行去掉唤醒按钮**，只保留「保存到收藏」；后者现在**打开预填的表单**而不是直写存储（第 10 节）。这顺带消掉唤醒调用路径的第二份拷贝。
- **解析规则（实现时照抄，别自己发明）**：macOS **必须** `arp -an`——BSD 原生 `arp` 不是 net-tools，无参数只打印用法并 `exit 1`；且源码里 `if (h_errno == TRY_AGAIN) nflag = 1;` 会**永久 latch**，一次 DNS 超时会把后续所有条目的主机名降级成 `?`。按**结构**匹配、**绝不匹配英文字面量**（表头会本地化）。Windows 的 `arp -a` 以空行开头、每接口一块、`Interface:` 行无缩进、数据行恰好 2 个前导空格、**列宽随构建版本变化故不可按固定偏移解析**、MAC 是小写连字符。`(incomplete)` 是 **MAC 占位符**（`sdl_alen == 0`）不是状态；`(->)` 记法永不出现（那是 `netstat -rn` 的东西）。
- **接口枚举的两个坑**：`internal: false` **不足以**滤掉虚拟适配器（Windows 的 Hyper-V `vEthernet`/Docker/WSL/VMware、macOS 的 `utun0`/`vmnet*` 都以 false 上报并带正常地址）；**不得按接口名硬编码**（Windows 接口名会被本地化）。`family` 当前是字符串 `'IPv4'`（v18.0.0 曾改为数字、v18.4.0 改回，v24 区间内恒为字符串）。

## 9. 收藏视图与树

- 收藏（设备记录）是**唯一的耐久唤醒入口**；唤醒只从这里发起。
- 显示规则（[0007](adr/0007-device-record-identity-is-hardware-address.md)）：`label` = 名字（空则回退硬件地址）、`description` = 硬件地址、`tooltip` = 完整记录。**当前那处字段名与展示语义相反的坑**（`label` 存 ip、`description` 存 MAC，而 `wol(equipment.description)` 把 `description` 当 MAC 传给发包层）随拆开而消失。
- **树首行**是第 12 节的常驻披露，**每次 `getChildren()` 重算**，不物化。
- 图标一律用内置 `ThemeIcon`，收藏行 `$(star-full)`、发现行**不给图标**；**删除 `resources/{light,dark}/add.svg`**（`media/lan.svg` 是活动栏容器图标，不动）。理由不是外观而是失败模式：那两个 SVG 的路径表达式少写一层 `..`，在 v0.0.3 里**两个视图都没有可见图标且不报错不警告**。给发现行一个设备类图标等于给可能整屏都是残影的那一屏发一张可信的身份证。
- 行操作（inline，从左到右）：删除、唤醒、编辑（`$(edit)`）。**发现行只有一个：保存到收藏。**

## 10. 录入面：设备记录的唯一写入通路

**一张 `window.createQuickPick()` 字段清单 + 每行一个 `createInputBox()` 录入面。** ([0010](adr/0010-device-record-form-is-a-quickpick-field-list.md))

- 三个字段行**同时可见**，`ok` 在清单上；点某行进入该行的录入面，回填后回到清单。空字段显示 `未填写` 而不是空白。
- 每行分工：`label` = 字段名（**UI 上说「MAC 地址」**，规范词"硬件地址"只活在文档与代码里）、`description` = 当前值或 `未填写`、`detail` = 句法错误 / 重复提示 / 预填来源标注。`detail` 对每一行都渲染成真实的第二行（未聚焦只是变暗）。
- **状态一律用文字，不用 `$(pass)`/`$(error)` 图标。**
- **寻址方式回显不另起一行**，写在「显式地址」行的 `description`：空 → `广播（所有网卡）`，填了 → `单播到 {address}`。
- **守门是扩展自己的义务**：`createInputBox()` 面上平台**不拦**（`ok.enabled` 只跟 `enabled`、accept 无条件触发）。句法不合法 → `validationMessage = {severity: Error}` 且**不 hide、不回填、不写存储**；与已有记录撞硬件地址 → `{severity: Warning}` 且**照常接受**（`InputBoxValidationSeverity` 的 Info/Warning 明写"不阻止接受"）。**漏写守门的症状是坏数据落盘且毫无提示。**
- **不用 `window.showInputBox({validateInput})`**（那条自带 gate 但拿不到 `enabled`，只读身份无处表达）。**也不依赖 `ignoreFocusOut` 的顺序技巧**——题面那句"`showInputBox({ignoreFocusOut:true})` 是 no-op"经核实是错的，show 前后赋值都有效。
- 三个入口共用 `openDeviceForm(initial?: DeviceRecord): Promise<DeviceRecord | undefined>`，**只返回数据、不碰存储**；写入与 `refresh()` 归调用方。调用方：收藏 add、收藏 edit、发现行「保存到收藏」（**只预填硬件地址**，名字与显式地址留空，并在该行 `detail` 标一句来源）。
- **edit 时硬件地址只读**：该行保持可选中，点进去是 `enabled = false` 的 InputBox + `prompt` 说明"要改请删除后重新添加"。**唯一例外是未完成条目**——它本来就没有合法地址，只读会堵死补全它的路。
- **表单只判句法**：拒绝 `host:port`（`port` 固定 9 不可配，接受端口等于暗示这个框能指定端口）、拒绝 scheme 前缀、拒绝 IPv6 字面量；**绝不在表单上 `dns.lookup` 或探测**。两个文本框一律 trim，**不设长度上限**。
- 一次 `ok` 只落一条记录，**不做批量**。主动取消无副作用、无草稿、无二次确认。
- **已接受的代价，必须写进实现说明**：QuickPick 顶部输入框永远是过滤器，用户在那儿敲 MAC 会得到**一片空列表且不报错**（扩展自己的 QuickPick **没有**内置 "No matching items"，也没有稳定属性能设这句话）。缓解只有 `placeholder` 一句「选择一个字段」，不做任何反制。
- 解析器住 `src/device/address.ts`：`parseHardwareAddress` / `parseExplicitAddress`，**返回结构化结果、不返回用户可见字符串**。不进 `src/net/wol.ts`，不进 provider。
- **文案继续用自带的 `I18n`，不换 `vscode.l10n`**（换它要求 manifest 写 `"l10n"`，且 UI 为默认语言时 `extHostLocalizationService` 根本不加载 bundle）。前置修复：`format` 支持**具名占位符**、`t` 对未知 key 回退为 **key 本身**（今天回退成空串，会渲染出一条只剩设备名的空通知，而空通知在视觉上与成功提示无从区分）。

## 11. 未完成条目在树上的形态

([0009](adr/0009-lossless-normalization-keeps-broken-rows.md) + [#23](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/23))

- **照常渲染、照常可点。** 点下唤醒得到 `failed` + `ReasonDeviceInvalid`——0002 早已把"报文构造不出来"归进这一级，所以**不新增证据等级、不新增理由桶、不置灰、不隐藏**（那是拿拒绝代替披露）。`failed` 的粘住特性与 `[查看日志]` 自动到位；日志走 `error` 档且**不带名字**。
- 只动 `description` 那一格：填一句「缺硬件地址，不能唤醒」。**不区分"缺失"与"写了但不合法"**（`label` 回退到的都是同一串没过校验的原文，`tooltip` 里已经看得见它）。
- `label` 回退链需要终点：名字为空**且**原始地址文本也为空时回退到「未完成」，否则 0007 那条回退会产出一行**空白**。
- `tooltip` = 完整记录，**包括那串校验没过的原文**（旧数据里 `label` 是名字与 IP 的混合物，那串残文往往是用户认出自己那台机器的唯一线索）。
- `contextValue` 保持 `favorite`，**不分叉出第二种行形状**。
- 「有 N 条待补全」的 N 与树上的行**共用同一个推导谓词**（否则"通知说 3 条、树上 2 行"就是扩展自己打自己脸）。每次激活后 N>0 时发一条 Warning；补全一条 N 自己减一，不需要计数机制；无持久"已提醒"标记。

## 12. 发包位置：靠披露，不靠拒绝

([0005](adr/0005-sending-position-disclosure-not-refusal.md)、[#12](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/12)、[#16](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/16)、[#7](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/7))

- `package.json` 显式声明 `"extensionKind": ["ui", "workspace"]`，把默认落点从远端挪到本地。**这不保证发包位置是用户本机**（用户可用 `remote.extensionKind` 覆盖），但默认值定在正确一侧。判据是 `Extension.extensionKind`——**`env.remoteName` 是错的**（本地与远端宿主里都有值），**`env.uiKind` 更是范畴错误**（只有 Desktop/Web，Codespaces 浏览器里跑的是 Node 远端宿主）。
- **不建任何策略性拒绝机制**：不激活门控、不禁用命令、不在 `remoteName` 非空时拒绝执行。这条路径上**没有异常可捕获**（不 `connect` 的 socket 实测 `send cb err=null`、全程无 `error` 事件），一刀切拒绝还会打断机房 SSH 这一正当用法。
- **这是可用性失效，不是诚实违约**：扩展说的每句仍为真，只是发在了听不见的地方，所以 0002 的禁止规则**根本不触发**（不是被豁免，是没有义务）。
- **披露有三处落点，全部复用同一条计算函数与同一个 nls key**：
  1. **树首行**不可操作说明，每次 `getChildren()` 重算，两个视图各一条；「永久可见」如实写成**「视图可见时可见」**。
  2. **`sent` 那句话里**：「已从 {host} 向 {targets} 个目标发出 {packets} 个唤醒报文」——常驻行对 03:00 定时唤醒这类场景提供的保护是零。
  3. **表单清单的 `QuickPick.prompt`**（**不是** `Separator`：分隔行在用户一开始打字时即被隐藏，`alwaysShow` 对分隔行明确无效）。
- **落点已排除的选项**：`contributes.views[].description` **这个 manifest 键根本不存在**（写进 `package.json` 静默失效、`vsce` 也不校验）；`TreeView.description` 那个运行时槽位扛不住措辞（单行、`flex-shrink: 100000` + `nowrap` + `ellipsis`，窄侧栏下最先被截的正是括注；窗格折叠时 `display: none`）；`viewsWelcome` 只在视图**为空**时渲染，而失效形态是非空的收藏列表。
- **措辞两条硬约束**：① 同网段括注**只在判定为不同网段时出声，绝不反向说"没问题"**（零个非 internal IPv4 网卡时不算同网段）；② **只印观测到的事实**（主机名、网卡名、网段），**不加「远程」「容器」这类推断标签**——一行认不出的披露是装饰，而装饰仍然在主张。
- **采集面与发包面是同一台机器**：远程宿主窗口里，「近期出现的设备」列的是**那台机器**的局域网，唤醒也从**那台机器**出去，两者不会互相纠正；一次"全部保存到收藏"会把那台机器的残影一并存成设备记录。
- **各环境能否广播的置信度表**（写进规格的"能/不能"必须带这个精度）：Remote-SSH **可用（当且仅当目标与远端机器同段）**；WSL1 推断；**WSL2-NAT 不可用**；**WSL2-mirrored 未证实**（文档只承诺组播、从未出现 broadcast 一词，⚠️ 不得写成保证）；WSL2-bridged 来源矛盾、不进支持矩阵；Dev Container **不可用**（内核 `bc_forwarding` 默认 0，Docker 从不写它）；Codespaces **不可用**（官方明写无私网访问，且端口转发 TCP-only，**`extensionKind` 救不了它**）；vscode.dev **扩展根本不加载**（有 `main` 无 `browser` ⇒ 不是 web extension，命令静默消失；**规格不得用 `uiKind` 解释这件事**）。
- **我们自己代码里的一条**：从本地掩码推导广播地址，意味着 WSL2 与 dev container 里**包从一开始就不是 LAN 广播地址**。`sendToAll` 这段推导规则会搬进 `src/net/wol.ts`，所以这条不会自动消失——它是第 3 处披露存在的理由之一。

## 13. manifest 契约

**`contributes.commands` 最终是 8 条**（现有 7 条减去被 #8 删掉的 `LANEquipmentProvider.wakeEntry`，加上 `LANFavoritesProvider.edit` 与「复制给维护者」）：

| id | title | icon |
|---|---|---|
| `LANEquipmentProvider.refreshEntry` | `%command.refresh%` | `$(refresh)` |
| `LANEquipmentProvider.add` | `%command.saveToFavorites%` | `$(star-add)` |
| `LANFavoritesProvider.add` | `%command.add%` | `$(plus)` |
| `LANFavoritesProvider.refresh` | `%command.refresh%` | `$(refresh)` |
| `LANFavoritesProvider.remove` | `%command.remove%` | `$(remove)` |
| `LANFavoritesProvider.wake` | `%command.wake%` | — |
| `LANFavoritesProvider.edit` | `%command.edit%` | `$(edit)` |
| `wakeOnLan.copyDiagnostics` | `%command.copyDiagnostics%` | — |

- **菜单**：收藏行 `view/item/context` 三位 `inline@1 remove`、`inline@2 wake`、`inline@3 edit`（`when: view == LANFavoritesProvider && viewItem == favorite`）；发现行一位 `inline@1 add`（`when: view == LANEquipmentProvider && viewItem == equipment`）；视图标题栏保留 refresh 与 add。**这一行第一次从两位变三位。**
- **`activationEvents`**：删掉死条目 `onCommand:first-vs-extension.helloWorld`（该命令**从未存在**：`contributes.commands` 里没有它、`src/` 里也没有，任何绑过它的键绑定早已无效）；**显式写全两条** `onView:LANFavoritesProvider` 与 `onView:LANEquipmentProvider`。不要因为"1.74+ 会隐式推导"就删整块——隐式激活时机从 manifest 里读不出来，而实测两个视图都在激活时创建。
- ⚠️ **必须钉不变量而不是钉类名**：视图 id 现在在**三处重复**（`contributes.views[].id`、`createTreeView(X.name)` 由类名推导、`activationEvents` 里的 `onView:` 字符串）。规格里写：**`activationEvents` 必须含与每个视图最终 id 逐字相同的 `onView` 条目，改 id 即改这里**。**视图 id 与类名在 v0.1.0 一律不改**（改名牵动三处耦合而用户看不到 id，成本全在耦合、收益为零；要改的只有**显示名**，它落在 nls 值上）。
- ⚠️ **没有工具会替你抓这些**：`vsce` 的 `validateManifestForPackaging` 只检查 `activationEvents` 字段本身、**不校验其中命令 id 是否存在**，死条目能一路活进 vsix。⇒ 归第 17 节的人工清单。
- **`contributes.configuration`（从零加）**：唯一活动配置键 `count`，**全局单键 + `scope: "machine"`**（不选 `window`——它允许一个签进 git 的 `.vscode/settings.json` 决定别人机器上唤醒发几个包；不选 `machine-overridable`——那是保留同一条覆盖路径的弱版；不做每设备覆盖——#5 已定等待提示刻意不带数字，参数变了而症状不变是规格里最容易读错的一类）。

```jsonc
"configuration": {
  "title": "%settings.title%",
  "properties": {
    "wakeOnLan.packetCount": {          // 【待决】键 id 与 maximum 见第 19 节
      "type": "integer",
      "minimum": 1,                      // #11 已裁定裸 minimum: 1 安全，不需要抬到 7/9
      "maximum": 10,                     // 提案值：deadline=(count-1)×100ms+500ms 在 10 时是 1400ms
      "default": 3,
      "scope": "machine",
      "description": "%settings.packetCount%"
    }
  }
}
```

- **`"extensionKind": ["ui", "workspace"]`**；**不加 `browser`**（v0.1.0 不支持 web 扩展宿主）；`"main": "./out/extension.js"` 保留。
- ⚠️ `contributes.views[].description` **不要写**——那个键不存在，写了静默无效。
- **删 nls 键与删视图/命令条目必须同时**（留着悬空 `%key%` 会让 vsce 的 `%` 匹配静默失败）。

## 14. 诊断面

([0004](adr/0004-diagnostics-as-vscode-log-channel.md)、[#15](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/15))

- **载体是单一 `window.createOutputChannel(name, { log: true })`。不自写文件**（VS Code 免费提供跨会话落盘 + 级别 + 时间戳 + 轮转，保留最近 9 个会话；自写轮转会**默默截断证据、让残留文本冒充完整历史**）。
- **另有「复制给维护者」命令**：把通道内容 + 环境信息（VS Code 版本、扩展版本、`process.platform`、主机身份 hostname、网卡清单）格式化成可粘贴文本进剪贴板；**剪贴板里 MAC 截到 OUI 三字节**（`a4:83:e7:**:**:**`），首尾两行写死"未验证任何目标状态"。落盘通道里可以留完整 MAC（那是用户自己磁盘），**剪贴板会进公开 issue**。
- **只用 `info`/`warn`/`error` 三档，明令禁止 `debug`/`trace`**：默认级别是 `info`、**过滤发生在写入时**（被拒的行**永不落盘**、事后调高也捞不回来）、`channel.logLevel` 是 `readonly` ⇒ 写在 `debug` 档的证据行在用户从没动过级别时**根本不存在于磁盘上**，`[查看日志]` 会**弹出一个空通道**。映射：`failed` 证据行 + 两处持久化失败 + i18n 激活失败 → `error`；`timed-out`/`partial` → `warn`；`sent` → `info`。
- **禁止 `appendLine`/`append`**：它们在 LogOutputChannel 上被改写成 `info()`，于是本该 `error` 的一行**静默降级、在默认级别仍然可见、毫无症状**。一律显式调 `info()`/`warn()`/`error()`。
- **不提供 verbosity / logLevel 键**：没有任何一行写在 `info` 以下，这个键**没有可作用的物件**；自己 gate 一层是 0004 处决过的"重写级别机制只会更差"的同构罪。留下的缺口如实写明：`Developer: Set Log Level` 是逐通道的，但持久化只有一条全局口子（`argv.json` 的 `log.level`）——**「只给本扩展长期开详细、不动全局」VS Code 自己就做不到**。
- **行格式**：单行、**固定英文**、结论句 + 空格分隔的 `key=value` 尾段（`destination=` `source=` `packetCount=` `code=` `scope=` `effective=`）。`scope=`/`effective=` 不是装饰：同一个 `count` 键在无 remote 窗口进本地用户 `settings.json`（**参与**同步）、在 remote 窗口进远端 `Machine/settings.json`（**不参与**同步），"现在生效的是哪一份"对用户不可见。
- **扩展不自打时间戳**（只拿得到调用时刻、拿不到落盘时刻，两个时钟并存会把"事件顺序还是写入顺序"转嫁给手工活）；**不把会话头行写进通道**（头行属于最老那段、最先被裁，之后用户读到的是**没有表头的正文**）；环境信息由「复制给维护者」在首尾承载。
- **用户自取的设备名不进任何机器可读行**（通道与剪贴板都不进）：它是唯一一个扩展无法预料其内容的字段。代价照实说——维护者认不出"用户说的客厅那台"，只能靠硬件地址对表。
- 记录站点：唤醒路径的两处 `.catch` + 两处持久化失败 + i18n 激活失败。**discovery 站点不记**（0004：在一条即将被改写的代码路径上建日志等于装录音笔）。**日志每次唤醒都写，不只在出错时**。
- **日志正文不本地化**是刻意例外：它不属于 0002 的"用户可见字符串"，**不适用两份 nls 的规则**。
- **记录器不得先于被记录对象的行为修正而上线**（发包层修好之前别写那条日志，否则会在一个尚未修好的缺陷上写下持久的假断言）。

## 15. 必须写进产品说明的物理限制

**不写这些，扩展就会撒谎**（地图 Notes 明令）：

1. **802.11 无线网卡大多收不到 magic packet**（低功耗态不维持链路），需要 WoWLAN 且支持有限。
2. **ErP / 深度省电 BIOS 常切断网卡待机供电**——同一条报文同一个端口，硬件层面就收不到。**这是"发包成功但机器不醒"最常见的真实原因，且没有任何软件手段能诊断。** Disconnected Standby 把网卡置入 D3，它不回应 ARP。
3. **SecureOn 密码不匹配是完全静默失败**，且长度可能是 4 **或** 6 字节（厂商特定、不互操作、明文传输）。
4. **端口值本身不是失败原因**——7 与 9 在本地等价，NIC 按 102 字节载荷模式匹配、不解析协议栈；**主机防火墙与唤醒无关**（模式匹配在网卡硬件里，在防火墙之前）。图表期"部分网卡只接受 0/7/9 或 EtherType 0x0842"的假设**没有权威来源支持**。
5. **跨路由器的远程唤醒不在能力承诺内**，并要写清"为什么这不是一个设置能解决的问题"。
6. **发现的覆盖率因平台与硬件而异**，不得承诺"能找到你的设备"；残影近乎无界（Linux 回收按压力门控、`gc_stale_time=60` 名不副实；macOS v4 条目断电后仍完整有效约 20 分钟）。

`message.HintTroubleshoot` 就是把 1 与 2 说给用户的那句话（只挂 `sent` 一级）。

## 16. 文案：完整键表（中英两份同时改）

规则：**每个用户可见字符串同时进 `package.nls.json` 与 `package.nls.zh-cn.json`**；`%key%` 必须整串匹配且 charset **不含冒号与连字符**；占位符一律**具名**（不用 `{0}`）。日志正文不本地化（第 14 节）。

**现存 11 键的处置**：

| 键 | 处置 |
|---|---|
| `command.refresh` `command.wake` `command.add` `command.remove` | 保留 |
| `command.FavoritesProvider` | 保留 |
| `command.EquipmentProvider` | **值改为「近期出现的设备」/"Devices seen recently"**（键与 id 不动） |
| `message.WakeSuccess` `message.WakeFailed` | **删除**（中英各一。后者主语是目标机器，而真实失败路径全属发送侧） |
| `message.NotNull` `message.PleaseEnterDeviceName` `message.PleaseEnterMACAddress` | **删除**，被下面的 `form.*` 取代 |

**新增**（37 个，五份表）：

`command.*`（3）：`command.edit`、`command.saveToFavorites`、`command.copyDiagnostics`
`message.*`（11，#5 定的那张表）：`WakeResponded`(预留)、`WakeSent{host}{targets}{packets}`、`WakeUnconfirmed`、`WakePartial`、`WakeNotSent{reason}`、`ReasonDeviceInvalid`、`ReasonNoInterface`、`ReasonUnreachable`、`ViewLog`、`HintWait`、`HintTroubleshoot`
`tree.*`（6）：`SendingPosition`、`DiscoveryNotice`、`DiscoveryUnavailable{reason}{platform}`、`MissingHardwareAddress`、`Unfinished`（+ 待补全通知 `IncompleteCount{count}`）
`form.*`（15，0010）：`TitleAdd`、`TitleEdit`、`FieldName`、`FieldHardwareAddress`、`FieldExplicitAddress`、`NotFilled`、`PlaceholderHardwareAddress`、`PlaceholderExplicitAddress`、`ErrorHardwareAddress`、`ErrorExplicitAddress`、`WarningDuplicate`、`SourceFromNeighbor`、`ReadOnlyIdentity`、`ModeBroadcast` / `ModeUnicast{address}`
`settings.*`（2）：`settings.title`、`settings.packetCount`

⚠️ **一处 #5 表里就存在的缺陷，实现时必须统一**：`WakePartial` 的 zh 用 `{sent}`/`{failed}`，而 en 用 `{sent}`/`{total}`——**两份文案的具名槽必须同名同集**，否则 `I18n` 的具名替换会在其中一种语言下静默产出未替换的 `{...}`。统一为 `{sent}` 与 `{failed}`。

**每个 locale 的键数：11（现存）− 5（删除）+ 37（新增）= 43。** ⚠️ #7 那句"每 locale 约 26 键"只数了表单新增，**别拿它当总数**——完整清点以本表为准。

## 17. 可核对不变量清单（人工核对，别指望 CI）

**为什么需要这张表**：`master` 的 CI 当前为红（最近 5 次 push 全部 failure），且 CI 只跑 `compile`/`lint`/`format:check`——**`bun run test` 根本不在 CI 里**。加上 #14 核实过"没有任何工具会替我们抓它"（`vsce` 不校验 `activationEvents` 里的命令 id）。⇒ 每条都写明**怎么核对**，核对动作是人能执行的。

| # | 不变量 | 怎么核对 |
|---|---|---|
| 1 | `package.json` 无 `first-vs-extension.helloWorld` 这条 `activationEvents` | 读 manifest |
| 2 | 每条 `onView:` 与 `contributes.views[].id` **逐字相同** | diff 两处字符串 |
| 3 | 声明了 `"extensionKind": ["ui","workspace"]` 且**没有** `browser` | 读 manifest |
| 4 | manifest 里**没有** `contributes.views[].description`（该键不存在） | 搜 `description` 于 `views` 段 |
| 5 | `commands` 恰为 8 条，且每条都有 `registerCommand` 与菜单归属 | `grep -c registerCommand` + 对表 |
| 6 | 两份 nls 的键集**完全相同**、无悬空 `%key%` | `diff <(jq -keys en) <(jq -keys zh-cn)` |
| 7 | `message.WakeSuccess`/`WakeFailed` 已删，且源码里无引用 | grep 全仓 |
| 8 | 没有任何代码路径能产出 `responded` | grep `responded` 于 `src/` |
| 9 | `port`/`interval` 是常量、不进配置 | 读 `src/net/wol.ts` + manifest |
| 10 | deadline 等于 `(count-1)*interval+500` | 读代码 + 单测断言 |
| 11 | `error` listener 注册在 `bind` **之前** | 读代码行序 |
| 12 | `setBroadcast(true)` 在 bind 回调内、`send` 之前 | 读代码行序 |
| 13 | `/32` 的接口记为 `skipped`、不产生理由 | 单测 |
| 14 | `netmask: null`/`''`/非连续 都变结构化 reject（不 throw） | 单测 |
| 15 | `count: 0` 被拒（不是塌回默认 3） | 单测 |
| 16 | `src/net/wol.ts` 不 import `vscode`、不读 `I18n`、不返回用户可见字符串 | grep import + 返回类型 |
| 17 | 硬件地址落盘恒为规范形式；查重/删除的匹配逻辑不混用两种形式 | 单测 + 读 `remove()` |
| 18 | `remove()` 按树行对象匹配，**绝不 `splice(-1, 1)`**（找不到就不删并如实报错） | 读代码 + 单测一条"找不到"用例 |
| 19 | `normalizeDevice` 是唯一入口且**绝不注入默认值**；不写任何标记位 | 读代码 + 单测"字段缺失"用例产出未完成条目 |
| 20 | 记录里没有观测 IP；`iconPath` 不持久化 | 读落盘形状的单测快照 |
| 21 | 表单是唯一写入通路：`doAdd` 不再被发现行按钮直调 | grep `doAdd` 调用点 |
| 22 | 录入面句法不合法时**不 hide、不回填、不写存储** | 单测（对 parse 结果分支）|
| 23 | 重复硬件地址只 `Warning`、**照常接受** | 单测 |
| 24 | edit 时硬件地址只读，**未完成条目除外** | 手工 smoke |
| 25 | 日志不出现 `appendLine`/`append`、不出现 `debug`/`trace`、无 verbosity 键、名字不进机器可读行 | grep `appendLine\|append(\|debug(\|trace(` + 读行格式 |
| 26 | 发现路径**不发任何探测包**（无 port-80 扫描、无 `connect`） | grep `createConnection\|connect(` |
| 27 | 邻居表解析**不匹配英文字面量**、macOS 用 `arp -an`、不按固定偏移切列 | 读解析器 + 三份 fixture 单测 |
| 28 | 用户可见文案里没有"已唤醒/成功/唤醒失败"，也没有"10 秒后消失" | grep 两份 nls |
| 29 | 待验证项在规格里仍标注为待验证（Windows/macOS 无提权、WSL2-mirrored、`setKeysForSync`、`state.vscdb`） | 读文档 |
| 30 | `resources/{light,dark}/add.svg` 已删、图标一律 `ThemeIcon`；`media/lan.svg` 保留 | 读目录 + grep `iconPath` |

## 18. 验收分层与测试要求（[#22](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/22)）

- **(a) 静态可核对清单**：第 17 节，随规格交付，**每条自带核对方法**。
- **(b) 单元测试**：**只**要求三个无 `vscode` 依赖的纯模块——`src/net/wol.ts` 的报文构造（#3 选择自己拥有它的理由之一就是"纯函数可脱离网络单测"）、`src/device/address.ts` 的归一化与句法（含守门要用的那个谓词）、`normalizeDevice` 的迁移（含"绝不注入默认值"与未完成条目的产出）。**不要求** provider / 树 / 表单装配的测试。
  ⚠️ `src/test/suite/extension.test.ts` 今天还是**未改动的脚手架**（只有一个断言 `indexOf` 的 `Sample test`、`import myExtension` 还注释着）⇒ **(b) 是从零开始，不是维持既有基线**。
- **(c) 手工 smoke 清单**（只覆盖只能在真 UI 里看见的东西）：
  1. 点「添加」→ 三行同时可见、空字段显示「未填写」、`prompt` 那行是否说出发包位置。
  2. 在过滤框里敲一串 MAC → 应得到一片空列表且**不报错**（已知代价，不是缺陷）。
  3. 硬件地址填 `aa-bb-cc-dd-ee-ff` → 接受并落盘成 `aa:bb:cc:dd:ee:ff`；填 `192.168.1.5:9` → 拒绝；填 `deadbeef` → 拒绝。
  4. 填一条已存在的硬件地址 → 出现 Warning 措辞但**能保存**。
  5. 收藏行点「编辑」→ 点硬件地址那行 → 是个灰掉的框并说明"要改请删除后重新添加"；未完成条目那条记录的地址行**可编辑**。
  6. 发现行点「保存到收藏」→ 表单里只有地址被预填、名字与显式地址为空、来源标注出现。
  7. 未完成条目点「唤醒」→ `failed` + 「设备信息无效」+ `[查看日志]`，且那条 toast **粘住**。
  8. 唤醒一台正常设备 → `sent` 文案里的设备名是**这台机器的**，远程窗口下是**远端那台的**。
  9. 调 `Developer: Set Log Level` 到 `error`，确认 `sent`/`timed-out` 的历史**不会**被捞回来（写入时过滤）。
  10. 「复制给维护者」→ 剪贴板里 MAC 只剩前三个字节、**没有设备名**、首尾两行"未验证任何目标状态"在。
- **不要求 UI 自动化测试，也不引入相关基建**：devDependencies 里只有 `@vscode/test-electron`（启动器）+ mocha + glob，**没有** `vscode-extension-tester`/selenium/playwright；公开 API 里没有任何"读取或驱动已打开的 QuickPick/InputBox"的接口。引入第三方 UI 驱动层是一次**独立的基建决定**，与 0001 否掉的"`@vscode/test-cli` 混进工具链迁移"同构。**这条边界如实写明**：本规格核实的是依赖清单与 API 面，**没有**跑过 UI 驱动层。

## 19. 待决项（需要人拍板，规格不猜）

地图里没有一票定过、且从既有 ADR 推不出来的，只有这三条。**它们都不阻塞第 1–18 节的实现**，但阻塞"宣布规格完整"：

1. **新记录的落点、排序与焦点**：新存的记录排在尾部还是按名字排？补全后的行要不要动位置？保存后焦点给谁？（可用的事实：`doAdd` 今天是 `push` 到尾部 = 现状"追加到底、不排序"；`getChildren()` 直接返回数组，所以**排序若要做应在读出时排**——在写入时排会给"删除按树行对象匹配"多一层间接。）
2. **「待补全」通知的频率**：第 11 节按 0009 的理由取了"每次激活、N>0 时一条"，但这是一个可被推翻的产品判断（另一种是"只在迁移真正发生的那次发"），请确认或改掉。
3. **CI**：要不要在 v0.1.0 之前把 `master` 的 CI 修绿、修到什么程度算安全网。**它已被裁定为目的地之外的工作**（本图是规划），但第 17 节那张人工清单存在的全部理由就是它现在不绿，所以"何时不再需要人工清单"是人的决定。

另外两处**命名选择**（不是产品取舍，但值得在实现前定死以免后患）：schema 版本键的键名、`count` 配置键的全名 `wakeOnLan.packetCount` 与其 `maximum: 10`（**地图只定了"有上界"，从未定过那个数字**）。

## 20. 交付与发布

- 版本 `0.0.3` → `0.1.0`；`CHANGELOG.md` 需覆盖：发包层归自己、诚实契约（删两条旧文案）、视图改名与采集面重定义、表单重做、迁移无损、诊断面、远程宿主披露。
- `vsce` 至今仍硬编码用 `npm` 执行 `vscode:prepublish`（microsoft/vscode-vsce#1108 未解决）⇒ 该脚本保持裸 `tsc -p ./`。
- `tsc` **不清理 `out/`**：删掉 `local-devices` 依赖后，残留的 `require("local-devices")` 会被继续打进 vsix。打包前必须清 `out/`。
- 移除 `wakeonlan` 与 `local-devices` 后 `bun.lock` 会剪掉约 17 个包，而 **`bun install --frozen-lockfile` 在锁文件不一致时会在安装步骤就红**——这是 CI 里最容易先撞上的一环。
- `oxlint` 的 `no-unused-vars` 是 deny：`LANEquipmentProvider` 的 `private context` 在 constructor 里未使用会报（#8 实测），改 `ctx` 即可。
- `docs/agents/domain.md` 要求：跨切面决策落 ADR、术语落 `GLOSSARY.md`。**本规格不新增 ADR**；若实现中必须偏离本文，请先改对应 ADR 再改代码。

## 21. 权威来源索引

**ADRs**：[0001](adr/0001-bun-oxlint-oxfmt-typescript7.md) 工具链 · [0002](adr/0002-honesty-contract-for-wake-results.md) 诚实契约 · [0003](adr/0003-discovery-as-capture-not-presence.md) 采集面 · [0004](adr/0004-diagnostics-as-vscode-log-channel.md) 诊断面 · [0005](adr/0005-sending-position-disclosure-not-refusal.md) 发包位置 · [0006](adr/0006-addressing-carried-by-device-record-not-settings.md) 寻址靠记录 · [0007](adr/0007-device-record-identity-is-hardware-address.md) 身份是硬件地址 · [0009](adr/0009-lossless-normalization-keeps-broken-rows.md) 无损归一化 · [0010](adr/0010-device-record-form-is-a-quickpick-field-list.md) 录入面 · [0011](adr/0011-no-liveness-probe-the-signal-is-not-constructible.md) 不做活性探测。**（`0008` 是空号，勿引用。）**

**票据决议**：#3 #4 #5 #6 #7 #8 #9 #10 #11 #12 #13 #14 #15 #16 #17 #18 #21 #22 #23（均在地图 [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) 的 Decisions so far 里有一行摘要）。

**研究文档**（`docs/research/`，共五份事实核）：`cross-platform-mechanisms.md`（#11）、`broadcast-reachability-across-hosts.md`、`remote-globalstate-machine-vs-shared.md`（#17）、`views-description-carrying-sending-position.md`（#16）、`addressing-fact-sweep-partial.md`（#4，Settings UI 那四条依据在第 8 节）。

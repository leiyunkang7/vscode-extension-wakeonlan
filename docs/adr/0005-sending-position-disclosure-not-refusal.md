---
status: accepted
---

# 发包位置靠披露兜底，不靠拒绝兜底

扩展宿主不在用户本机时（remote-SSH / WSL / devcontainer / Codespaces），唤醒报文从**发包位置**——即扩展进程所在的那台机器——发出，而用户想唤醒的设备通常在他自己笔记本的局域网里。v0.1.0 对此**不建任何策略性拒绝机制**：不做激活门控、不禁用命令、不在 `remoteName` 非空时拒绝执行。取而代之的是**披露**——把发包位置本身变成常驻可见的事实，并写进唤醒结果那句话。

同时显式声明 `"extensionKind": ["ui", "workspace"]`，把默认落点从远端挪到本地。

## 为什么不拒绝

**这是可用性失效，不是诚实违约。** ADR 0002 的判据是「扩展是否持有支撑它的证据」：在发包位置不对的情形里，扩展**没有**任何关于"报文能否被目标听见"的证据，因此禁止规则根本不触发——不是被豁免，是没有义务。扩展说的每一句仍然为真：「已向 2 个目标发出 6 个唤醒报文」在目标与发包位置不同网段时照样为真。唯一残留的质疑是**复合读法**——「已发出 6 个」与「通常需要几十秒」各自为真，并置却合成一个假印象。GLOSSARY 早已承认这种形状危险（「日志里没有坏消息，不构成任何结论」），而**披露正是它的答案**。

**更硬的一条：这条路径上没有异常可捕获。** `wakeonlan@0.1.0` 的 socket **不 `connect`**，只 `bind` + `setBroadcast(true)`。在扩展的**真实运行时**上实测（Node **v24.18.1** 与 **v24.21.0**，取自 `/root/.vscode-server` 的两个 server 安装——**不是**本机默认的 v26.4.0）：向一个无人监听的端口发 1024 字节，`send()` 回调 `err=null`、**全程无 `error` 事件**。因此"包到不了"这件事**在本机侧没有任何信号**，拒绝机制若不基于环境识别，就只能在用户已经用完之后才说话——那是**事后解释**，不是保护。反过来，扩展也**拿不到反证**：把网卡枚举出来判定"全部不可达"是启发式而非证明，ADR 0004 已经把"只枚举网卡"定死为零信息（`wakeonlan@0.1.0` 的 `sendToAll` 是 `Promise.all`，零可用接口时照样 resolve）。

**一刀切拒绝会打断一个正当用法。** 有人在机房 SSH 进服务器，想唤醒**那台机器所在网段**里的设备——此时发包位置是服务器，广播完全正确，功能是好的。任何无条件的 remote 拒绝都是钝器。

**默认落点必须偏向本地。** 但偏向本地解决不了全部场景（见下），所以披露不可省。

## 宿主形态的事实

- `package.json` 此前**既无 `extensionKind` 也无 `browser`**，而 `main` 存在。VS Code 的 `deduceExtensionKind` 在 `manifest.main` 分支**早退**返回 `['workspace']`（`extensionManifestPropertiesService.ts:267-274`），`contributes` 那一段过滤根本到不了。旁证三处独立：vsce 4.0.0 的 `deduceExtensionKinds`（`@vscode/vsce/out/package.js:910-921`）形状一致；本机 server bundle 里内嵌的 manifest schema 写着 `default:["workspace"]`，其 NLS 消息 2419 = "can run only on the remote machine when connected remote window"；`/root/.vscode-server/extensions/extensions.json` 里 **GitLens**（贡献 SCM 与活动栏树视图、无 `extensionKind`）就装在**远端**扩展目录中。`extensionPointExtensionKind` 在本机 server 里只有 `typescriptServerPlugins` 一项，**没有 `views`**——贡献视图不会把扩展拉到 UI 侧。
- `pickExtensionHostKind`（`nativeExtensionService.ts:720-723`）对 workspace kind 走 `ExtensionHostKind.Remote`。**所以 remote-SSH 下的默认行为是跑在 SSH 主机上**，本扩展在树里对用户呈现的那个局域网根本不是用户的局域网。
- 判据 API 是 `Extension.extensionKind === vscode.ExtensionKind.Workspace`。**`vscode.env.remoteName` 是错的**——typings 自己写明 "the value is defined in **all** extension hosts (local and remote) in case a remote extension host exists. Use `Extension.extensionKind` to know if a specific extension runs remote or not"。**`vscode.env.uiKind` 更是范畴错误**：它只有 `Desktop = 1` / `Web = 2` 两个成员、没有 `Codespaces`，且描述的是 **UI 表面**而非代码运行处——Codespaces 浏览器编辑器里跑的是 **Node** 远端宿主而 `uiKind === Web`。`appHost === 'codespaces'` 是 Codespaces 的正确判据。
- 显式 `extensionKind` **合法**（manifest 校验器只在 `extensionKind` 与 `main` 不同时存在时报 Warning，NLS 1685）。但扩展**无法强制**：`getConfiguredExtensionKind`（`:324-346`）的优先级是**用户设置 `remote.extensionKind` → product.json → manifest**，用户始终能覆盖。

## 三种失效形态，不可合并

| 形态 | 实际发生 | 扩展能否察觉 |
|---|---|---|
| vscode.dev / 浏览器 | **扩展根本不加载**（`main` 有、`browser` 无 ⇒ 不是 web extension），命令静默消失 | 无 |
| Remote-SSH | 加载、运行、`send()` 返回成功、包到不了 | 无 |
| WSL2-NAT / dev container | **更早一步：连目的地址都推错**（见下） | 无 |

**最深的发现是关于我们自己代码的**：`wakeonlan@0.1.0` 的 `sendToAll` 在无 `from` 选项时遍历 `os.networkInterfaces()`、跳过 `internal`、用 `getBroadcastAddr(iface.address, iface.netmask)` **从发送进程自己的网卡和掩码推导目的地址**。于是 WSL2（`172.x/16`）与 dev container（`172.17.0.x/16`）里，包**从一开始就不是发往 LAN 的广播地址**——`setBroadcast` 成功、`send()` 成功、数字如实上报，而这个数字从构造上就够不着用户想唤醒的机器。#3 要自己写 `src/net/wol.ts` 接手这一层，**这条推导规则会跟着搬过去**。

**本机即活样本**（`node -e` 枚举，非推测）：

```
tailscale0  IPv4  internal=false  addr=100.70.252.121
enp11s0     IPv4  internal=false  addr=192.168.50.56
wlp12s0     IPv4  internal=false  addr=192.168.50.239
```

`tailscale0` 是 VPN 叠加接口，`internal=false`，会在一次发送里被绑上并算出一个 `100.64.0.0/10` 上的定向广播地址——**发到一个按构造就不存在广播语义的地方**。同一次遍历还会走到 `wlp12s0`，而"802.11 无线网卡大多收不到 magic packet"是本图既有的结论。**两种失效形态都不需要 devcontainer 就能复现。**

## 各环境能否广播（带置信度）

- **Remote-SSH**：发往远端机器的网卡；跨网段则连地址解释都不成立。**可用**（当且仅当目标与远端机器同段）。
- **WSL 1**：与宿主共享网络栈，微软文档确认 WSL1 应用"could be accessed on your LAN"，且 WSL2 是 NAT "instead of making it bridged to the host NIC"。广播可用属**推断**——文档里的支持证据是**组播**（`microsoft/WSL#12122`），组播 ≠ 广播。
- **WSL 2 NAT（默认）**：**不可用**。`microsoft/WSL#4150` 的实际 `ip addr` 为 `172.18.72.60/16`，报告者称 "this IP is not accessible from another system on my network"。`hostAddressLoopback` / `localhostForwarding` / `firewall` 都不改这一点。
- **WSL 2 mirrored**：**可能可用，属推断、中等置信度，不得写进规格的保证**。文档只承诺 "Multicast support"，**从未出现 "broadcast" 一词**；且组播本身在 issue #12122 / #12344 里仍是坏的。最强的广播证据是 `WslMirroredNetworking.cpp` 里那段"ignore broadcast and multicast routes"的注释（但定向子网广播走**连接路由**解析，并不被它挡住），以及 `microsoft/WSL#13380`——mirrored 模式把物理 PoE 交换机的 LED 撞得同步闪；**该 issue 已被机器人以过期关闭且无维护者回应**，也可能是 WSL 自身的重复环。
- **WSL 2 bridged**：`networkingMode` 仍有该值但 2.4.5 起废弃、2.5.4 发布说明写着"Remove support bridged networking"，而 #41539 又显示它能工作且 `vmSwitch` 在 `WslCoreConfig.h` 里存在却在 learn.microsoft.com **零命中**。**来源互相矛盾，不进 v0.1.0 支持矩阵。**
- **Dev Container**：**不可用**。真正的闸门是内核 sysctl **`bc_forwarding` 默认 0**（kernel.org `ip-sysctl`："allows the router to forward directed broadcast"），Docker 从不写它；**不是** `FORWARD` DROP——moby 在 bridge 上无条件装 `-i <bridge> -j ACCEPT`。旁证 `moby/moby#38976`（仍 open）："if I send the broadcast from the host, it can be accepted by other hosts in the local area network, but if it is sent from the docker, it cannot."`--network=host` 可用（容器共享宿主网络命名空间），属**推断**。
- **Codespaces**：**不可用**。官方文档直说 codespace "no access to resources on private networks"，且端口转发是 **TCP-only**。**这意味着 `["ui", "workspace"]` 救不了它**——把扩展挪到本地也够不着。
- **vscode.dev**：扩展不加载，故上表第一行。

## 披露的两处落点

**一、常驻行。** 树首行一条不可操作说明，**每次 `getChildren()` 重算**，**两个视图的首行各一条**。重算而非物化，是因为常驻披露的全部价值是"它不会过期"，而一个可能说错自己的常驻行**比没有更糟**（`src/treeview/index.ts:15-21` 两个 `createTreeView` 的返回值都被丢弃，扩展连改视图标题的 handle 都没有）。落点不用 `viewsWelcome`——它只在视图**为空**时渲染，而失效形态是**非空**的收藏列表。两处内容不必相同：收藏视图那行讲发包位置，发现视图那行并讲 ADR 0003 已裁定的"可能含残影"那半句——**一条行同时占掉两个已定 ADR 各要的一格**。此处「永久可见」如实写成**「视图可见时可见」**，树本来就是本扩展唯一的常驻面（ADR 0002 已把瞬时反馈全搬进 toast）。

**二、唤醒结果那句话本身。** 常驻行只在用户**主动去看树**时有效，而唤醒是**用户触发、目标缺席**的动作，两者恰好错开。03:00 定时唤醒 NAS 的场景里，树不是脚本读的、03:00 也不是读树的时刻——**常驻行提供的保护是零**。因此 `sent` 那句话按 ADR 0002 既有的具名占位符扩为「已从 *机器* 向 {targets} 个目标发出 {packets} 个唤醒报文」。这**不**构成越权：主语是发送方行为，而"从哪台机器发出"正是该断言自身的一部分。

## 措辞的两条硬约束

**一、只描述发包侧，且只在判定为不同网段时才出声。** 括注形如「目标 IP 与发包位置的任何网卡都不在同一网段」——这是**两个本地数字的比较**，不是关于目标的断言，**不得出现「到不了」「失败」「未确认」**。**判定为同一网段时不出现任何括注**，绝不反向说「没问题」：同网段判定依赖网卡集可信，而 WSL2-mirrored 用户的网卡集指向一台**能否广播未经证实**的机器——若反向出声，提示会在错的方向上失效。**零个非 internal IPv4 网卡时不算同网段**，那才是唯一有把握的判据。这个谓词与 #4「按目标 IP 所在子网自动选网卡」需要的是**同一个**，两个消费者一份实现，**不是 #4 的新增税**。

**二、只印观测到的事实，不做判定。** 这一行不是唤醒结果里的一句断言，它是一条**独立的、站着的、关于机器身份的主张**，因而落回 ADR 0002 的总则「扩展是否持有支撑它的证据」，**没有豁免**——本次四个对抗视角与四份连锁报告全都把披露当成零成本且严格更诚实，**没人问过它凭什么替自己作证**。可举的证据并不齐：网卡集是直接观测（强），`os.hostname()` 是 OS 报的名字（弱）。**一行认不出的披露是装饰，而装饰仍然在主张。** 因此只印主机名、网卡名与网段，**不隐藏、不替换、不加「远程」「容器」这类推断标签**——那些正是发包位置定义明确排除的判据。诚实印出容器 ID 仍然有用（用户能拿它去比对），抹平或贴标签则把证据换成了结论。

## Considered Options

- **任何形式的策略性拒绝（激活门控 / 禁用命令 / `remoteName` 非空即拒）**：被否。打断机房 SSH 这一正当用法；且在没有异常可捕获的前提下，拒绝要么基于启发式（会把能用的场景误杀），要么只是事后解释。
- **静默继续（当前实际行为）**：被否。唯一失效模式是**信息缺失**，而缺失信息正是 D3 那份产物要补的；且"自动发现"那条 out-of-scope 条目被否的依据是**制造了假的反证**，与本条"缺失信息"不是同一物种，两者不互相援引。
- **把术语改名为 `发包机器`**：被否。`sendToAll` 对每张非 internal IPv4 网卡各算一个广播地址、各自绑来源地址，**网卡集是每次发送的结果而不是机器的属性**，所以词汇收下网卡这一半是实质修正；但改名会与 ADR 0005 的文件名、#4 的词汇与 GLOSSARY 交叉引用互相拖累，而它想要的"更准"已经由 edit-1 的判据修正得到。**保留 `发包位置`，把判据写准。**
- **把 `sent` 那一级再降一格**（因为 `sent` 只证明"内核接受了报文"）：被否，那会波及 ADR 0002 全表。改为在 0002 的 Consequences 里补一条把该级的精度写明。
- **在唤醒结果里做可达性判定并据此改措辞**：被否。扩展拿不到反证（`bc_forwarding`、NAT、无线网卡、VPN 叠加接口这四类都只能靠网卡集启发式判断），而启发式一旦决定措辞，猜错的方向就是**制造反证**——ADR 0003 亲手杀掉 port-80 扫描的同构罪。
- **用 `uiKind` 做门控**：被否，范畴错误（见上）。

## Consequences

- **`package.json` 增加 `"extensionKind": ["ui", "workspace"]`。** 这不保证发包位置是用户本机——用户用 `remote.extensionKind` 可覆盖，product.json 也能覆盖——但它把**默认值**定在了正确的一侧。
- **每个 locale 的 key 数从 11 增至 12**（新增 `sent` 句内的发包位置占位符）。两份 nls 都要改。
- **ADR 0004 的剪贴板 PII 面扩一条规则**：常驻行与导出载荷都含用户主机名与网卡型号，与"截断到 OUI 三字节的 MAC"是**同一个 PII 品种**。`remoteName` 从"标识这台机器"降为辅助标注，主判据改为**机器身份**。
- **扩展对 vscode.dev 的立场是"不加载"，不是"拒绝"。** 无 `browser` 字段 ⇒ 不是 web extension；规格不得引用 `uiKind` 来解释这件事。
- **#4 的寻址模型相对发包位置定义**，而同网段谓词是两个消费者共用的那一份。
- **ADR 0003 补记了一条此前没人写下来的约束：采集面与发包面是同一台机器。** 两者不会互相纠正——一次"全部保存"会把那台机器的残影一并存成设备记录。
- **一项待验证**：ADR 0004 提到的 Windows/macOS 邻居表读路径"无特权仅为第三方共识"之外，本票的 Windows/macOS 结论同样只有 Microsoft / Docker / WSL 官方文档与 issue 为据，**规格须标注为待验证**；而 WSL2-mirrored 一节**连"可用"都未被证实**，只能写成不确定。

# 扩展宿主在哪台机器上，唤醒报文就发到哪台机器的网段

**Issue**: [#12](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/12) · **Map**: [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) · **日期**: 2026-10-07 · **状态**: 事实核查，非决策

`wakeonlan` 的发包路径是 `setBroadcast(true)` + 绑到某个接口地址 + 发到该接口按 netmask 算出的广播地址。这份文档回答一个问题：**在哪些宿主环境里，这个进程发出的广播能真的到达用户物理局域网**。

标注沿用 [cross-platform-mechanisms.md](./cross-platform-mechanisms.md)：**已验证**（有一手来源直接陈述）、**推断**（由已验证事实组合而来）、**未知**（找不到一手来源）。

---

## 0. 先修正三个前提

查证过程中有三个流传很广但**查无实据**的说法，不能写进规格：

| 流传说法 | 实际 | 证据 |
|---|---|---|
| WSL 文档里有 "Windows Host Network Stack" / "Shared network namespace" 对照表 | **当前任何 Microsoft 页面都没有这张表**。`compare-versions` 的特性表只剩 Integration / Fast boot / systemd / IPv6 等行，无网络栈行、无组播行 | [compare-versions](https://learn.microsoft.com/en-us/windows/wsl/compare-versions) |
| WSL2 NAT "天然隔离"、"无直接访问局域网/企业 LAN" | **查不到这句话**。当前文档没有这个措辞 | 遍历 networking / faq / compare-versions / wsl-config 无命中 |
| RFC 9222 规定 limited broadcast | **RFC 9222 是 "Guidelines for Autonomic Service Agents"（GRASP）**。正确的是 RFC 919 / 922 / 1122 §3.2.1.3 | [datatracker.ietf.org/doc/html/rfc9222](https://datatracker.ietf.org/doc/html/rfc9222) |

另外两条**文档级空白**，属于"我确认它没写"而非"我漏了"：

- **Hyper-V Default Switch / WinNAT 会丢广播** —— 广泛流传，但**找不到任何 Microsoft 一手来源**。唯一 MS 作者的 [WinNAT 能力与限制](https://techcommunity.microsoft.com/blog/virtualization/windows-nat-winnat----capabilities-and-limitations/382303) 列的四条限制里**没有**广播或组播。
- **Docker / VS Code 文档里关于广播的陈述** —— 三个 Docker 网络页面和 Dev Container 规范里，"broadcast" 一词作为散文**一次都没出现过**。结论只能由 iptables 源码 + 内核 sysctl 文档拼出来。

---

## 1. 一条代码事实，它比后面所有网络论证都更早生效

`node_modules/wakeonlan/index.js` 未传 `from` 时走 `sendToAll`：

```js
let sendToAll = (mac, opts) => {
  let ifaces = os.networkInterfaces()
  for (let p in ifaces) {
    ifaces[p].forEach(iface => {
      if (iface.internal || !net.isIPv4(iface.address)) return   // ← internal 接口跳过
      ifaceOpts.from = iface.address
      ifaceOpts.address = getBroadcastAddr(iface.address, iface.netmask)  // ← 按本机 netmask 算
      promises.push(send(mac, ifaceOpts))
    })
  }
```

**这条比"虚拟交换机转不转广播"更早决定结果。**（**已验证**，读的是 `node_modules/wakeonlan/index.js:21-34`）

它枚举的是**本进程 `os.networkInterfaces()` 里的非 internal IPv4 接口**，目标广播地址由**该接口自己的 netmask** 算出。于是：

| 环境 | 网卡地址 | 实际发出的广播地址 | 触达物理 LAN？ |
|---|---|---|---|
| 桌面本地 | `192.168.1.x/24` | `192.168.1.255` | 是 |
| WSL2 NAT | `172.x.x.x/16` | `172.x.255.255` | 否 —— 报文连宿主机的 LAN 网段都没进入 |
| Dev Container | `172.17.0.x/16` | `172.17.255.255` | 否 —— docker bridge 自己网段内的广播 |
| WSL2 mirrored | 镜像到宿主网段地址/netmask | 宿主的 `<子网>.255` | 见 §4 |

也就是说：**在这些环境里，报文不是"发出去了但被丢弃"，而是"目标地址算出来的那一刻，就根本不是物理 LAN 的广播地址"**。`SO_BROADCAST` 会设成功，`send()` 会成功返回，扩展会向用户报告"已发出 N 个唤醒报文"——而这在 GLOSSARY 的证据阶梯上只是一条**发送方事实**，不是唤醒结果。这个坑和无报文的坑一样深，只是更隐蔽。

---

## 2. 低层机制（跨平台一致，与环境无关）

| 事实 | 来源 | 标注 |
|---|---|---|
| `setBroadcast(true)` 设置 `SO_BROADCAST`，"UDP packets may be sent to a **local interface's** broadcast address" | [nodejs.org/api/dgram.html](https://nodejs.org/api/dgram.html) | **已验证** |
| 未设 `SO_BROADCAST` 而发往广播地址 → **EACCES** | [ip(7) ERRORS](https://man7.org/linux/man-pages/man7/ip.7.html) | **已验证** |
| `send(2)` 对 UDP："An attempt was made to send to a network/broadcast address as though it was a unicast address" → EACCES（**但它不点名 `SO_BROADCAST`**，链接关系只在 `ip(7)`） | [send.2](https://man7.org/linux/man-pages/man2/send.2.html) | **已验证**（措辞不一致已标） |
| Windows 等价错误 **WSAEACCES (10013)**，Learn 文档明写 "An example is using a broadcast address for sendto without broadcast permission being set using setsockopt(SO_BROADCAST)" | [Winsock error codes](https://learn.microsoft.com/windows/win32/winsock/windows-sockets-error-codes-2) | **已验证** |
| `INADDR_BROADCAST` "broadcast to all hosts on the local network segment, **as long as the link is broadcast-capable**" | [ip(7)](https://man7.org/linux/man-pages/man7/ip.7.html) | **已验证** |
| 子网定向广播只在**本地直连**的子网上成立（"locally-attached"），且必须有 `SO_BROADCAST` | [ip(7)](https://man7.org/linux/man-pages/man7/ip.7.html) | **已验证** |
| `255.255.255.255` "must not be forwarded" | [RFC 919](https://datatracker.ietf.org/doc/html/rfc919) / [RFC 922](https://datatracker.ietf.org/doc/html/rfc922) | **已验证** |
| 定向广播到非本地网段，会被路由到目的网络的网关再广播（"letter bomb"） | [RFC 922](https://datatracker.ietf.org/doc/html/rfc922) | **已验证** |
| `udp(7)` **完全没提**广播 / 组播 / `SO_BROADCAST` / EACCES —— 引错源了 | [udp(7)](https://man7.org/linux/man-pages/man7/udp.7.html) | **已验证（否定结果）** |
| Linux bridge `bcast_flood` **默认 on** | [bridge(8)](https://man7.org/linux/man-pages/man8/bridge.8.html) | **已验证** |
| veth 对："Packets transmitted on one device in the pair are immediately received on the other" | [veth(4)](https://man7.org/linux/man-pages/man4/veth.4.html) | **已验证** |

**`SO_BROADCAST` 在虚拟网络里有没有区别？没有直接陈述。** 没有任何一手来源说过"WSL2 虚拟网卡下 `SO_BROADCAST` 行为不同"。能拿到的只有一条**正面**旁证：[microsoft/WSL#12256](https://github.com/microsoft/WSL/issues/12256)（OPEN）中 WSL2 的 `eth0` 显示 `<BROADCAST,MULTICAST,UP,LOWER_UP>`、`brd ff:ff:ff:ff:ff:ff` —— **虚拟网卡本身具备广播能力，不是阻塞点**。如果丢包，丢在 HNS/WinNAT 那一段。**这一段微软没有任何文档。**（**推断**）

---

## 3. 逐环境结论

### 3.1 WSL 1 —— **works**

WSL1 直接跑在 Windows 网络栈上，不是 VM。

- [networking](https://learn.microsoft.com/en-us/windows/wsl/networking)：**"When using a WSL 1 distribution, if your computer was set up to be accessed by your LAN, then applications run in WSL could be accessed on your LAN as well. This isn't the default case in WSL 2."**
- [compare-versions](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)：WSL2 "uses a Network Address Translation (NAT) service for its virtual network, **instead of making it bridged to the host Network Interface Card (NIC)**" —— 反面确认 WSL1 是 bridged 到宿主 NIC 的。
- [faq](https://learn.microsoft.com/en-us/windows/wsl/faq)："WSL shares the IP address of Windows, as it is running on Windows."

**⚠️ 广播本身是推断。** 上面三句陈述的是"共享网络栈"和"可在 LAN 上被访问"，**没有一句直接说广播可用**。旁证是组播方向的实测：[microsoft/WSL#12122](https://github.com/microsoft/WSL/issues/12122) 中用户 `EliasJRH`："set its version number to 1 which allowed wsl to share the network interface of the host and that allowed inbound/outbound multicast traffic." —— **组播 ≠ 广播**，属**推断**，不是已验证。

Windows 防火墙默认**只挡入站**，出站默认放行，所以出站广播报文不被挡。（[Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)）

### 3.2 WSL 2 默认 NAT —— **does not work**

- [networking](https://learn.microsoft.com/en-us/windows/wsl/networking)："By default, WSL uses a NAT based architecture for networking. WSL 2 has a virtualized ethernet adapter with its own unique IP address."
- [compare-versions](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)：见上，NAT 取代了 bridged。
- [microsoft/WSL#4150](https://github.com/microsoft/WSL/issues/4150)（2019 年至今 OPEN）原始诉求，用户实测：`eth0 ... inet 172.18.72.60 netmask 255.255.0.0 broadcast 172.18.255.255`，并明确 "this IP is not accessible from another system on my network."

结论**高置信**，但注意其构成：广播地址算成 `172.x.255.255` 是**已验证**（§1 代码事实 + #4150 实际 `ip addr` 输出）；"NAT 交换机终止广播域"是**推断**。**没有任何 Microsoft 文档直说"NAT 模式下广播不通"**——只能靠文档沉默 + 组播仅被列为 mirrored 模式优点来反推。

**没有任何配置开关能改变这一点**（`hostAddressLoopback`、`localhostForwarding`、`firewall` 都是单播或仅入站；`netgenType` 这个键在当前文档和 `WslCoreConfig.h` 里都不存在）。

### 3.3 WSL 2 mirrored —— **depends，且是本文档最不确定的一项**

`networkingMode=mirrored`，需 **Windows 11 22H2+**（[wsl-config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config) 脚注 ² / [networking](https://learn.microsoft.com/en-us/windows/wsl/networking)）。

文档承诺的是 **Multicast support，不是 broadcast**：

> Mirroring mode benefits: IPv6 support / localhost / VPN 兼容性 / **Multicast support** / **Connect to WSL directly from your local area network (LAN)**

**整页没有出现过 "broadcast"。** 把 "multicast support" 升级成 "WoL 广播可用"是**没有依据的外推**。

而组播本身还是坏的：[microsoft/WSL#12122](https://github.com/microsoft/WSL/issues/12122) 与 [#12344](https://github.com/microsoft/WSL/issues/12344)（**均 OPEN**），后者正文："Theoretically, the documentation for WSL2 mirrored says that Multicast support is already in place, but there's a lot of issues linked to this"。WSL 成员 `shixudong2020` 给出的绕过是**手工加一条路由**：`sudo ip route add 224.1.1.1 via 169.254.73.152 dev eth0 onlink`。

**广播方向有一条源码级证据，但它容易被误读。** [WslMirroredNetworking.cpp](https://github.com/microsoft/WSL/blob/main/src/windows/service/exe/WslMirroredNetworking.cpp)：

```cpp
if (addressType != NlatUnspecified && addressType != NlatUnicast) {
    // ignore broadcast and multicast routes - Linux doesn't seem to create those like Windows
    continue;
}
```

WSL 在把宿主路由表写进 guest 时**丢弃了所有广播与组播路由**。这看起来像"广播被封了"，**但它不是**——Linux 的**定向子网广播走的是普通 connected route**（`192.168.1.0/24 dev eth0 proto kernel scope link src ...`），不需要专门的广播路由；`SO_BROADCAST` 是 `sendto()` 的闸门，而组播（`224.0.0.0/4`）**没有** connected route——这正是为什么组播的绕过方案必须手工 `ip route add`。同一文件里 WSL 还会算出并记录宿主的广播掩码地址（`GetIpv4BroadcastMask()`）。

**综合：mirrored 模式下定向子网广播极可能正常出去，但这是推断。** 三条支撑：connected route 机制、WSL 源码确实算出了正确广播地址、以及 [microsoft/WSL#13380](https://github.com/microsoft/WSL/issues/13380) 的用户报告——mirrored 模式下**物理 PoE 交换机的所有 LED 同步狂闪（广播风暴）**，"Unplugging the laptop from Ethernet immediately restores the network"。**风暴打到物理交换机，基本等于证明 L2 广播帧上了线。**

⚠️ 但 #13380 是**无维护者回复的 stale-bot 自动关闭**，且现象可能是 WSL 的重复回环 bug 而非健康的广播外发。**标为"推断，中等置信"。**

### 3.4 WSL 2 其它配置（题问"是否存在自定义配置使广播可用"）

**存在，但正在退场，且依赖付费特性。**

- `networkingMode` 当前取值：`none | nat | bridged (deprecated) | mirrored | consomme`。[wsl-config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
- **`bridged` 自 WSL 2.4.5 起标记弃用，2.5.4 release note 写 "Remove support bridged networking"** —— 但 [#41539](https://github.com/microsoft/WSL/issues/41539)（2026-09，WSL 2.7.13）仍展示可用配置 `networkingMode=bridged` + `vmSwitch=WSL-Bridge`。**来源相互矛盾**：`vmSwitch` 存在于 `WslCoreConfig.h`（`static constexpr auto VmSwitch = "wsl2.vmSwitch"`）却**在 learn.microsoft.com 上完全没有文档**（grep 零命中）。
- WSL 负责人 `craigloewen-msft` [在 #12743](https://github.com/microsoft/WSL/issues/12743) 说明为什么不做成正式特性："it relies on **Hyper-V features that are pro only**"。
- [#12122](https://github.com/microsoft/WSL/issues/12122) 里 `EliasJRH` 实测 bridged + external vSwitch 让**组播**通了（"I made it working in WSL2 using: `networkingMode=bridged`"）。广播未测。

**结论：存在这样一条路，但它同时是 deprecated、Pro 特性依赖、依赖未文档化键、且只有组播（而非广播）的实测。判为 depends，中低置信，不建议写进 v0.1.0 的支持矩阵。**

### 3.5 Dev Container（docker bridge）—— **does not work**

扩展宿主确认跑在容器内：[code.visualstudio.com/docs/devcontainers/containers](https://code.visualstudio.com/docs/devcontainers/containers) —— "Extensions are installed and run inside the container"。

**⚠️ 一个反直觉的发现：`FORWARD` 的 DROP 策略并不是拦它的那一层。** Docker 在 `DOCKER-FORWARD` 链里对 bridge 入接口装了无条件 ACCEPT：

```
-A DOCKER-FORWARD -i br-dummy -j ACCEPT      # 注释：Accept outgoing traffic to anywhere
```

（[moby `iptabler/network.go`](https://github.com/moby/moby/blob/master/daemon/libnetwork/drivers/bridge/internal/iptabler/network.go)，规则原文见同目录 `testdata/TestIptabler/*.golden`。）协议、端口、目的地址全不匹配检查。所以"FORWARD DROP 挡住广播"这个常见说法**是错的**。

**真正的拦截在内核**：[ip-sysctl](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html)

> **bc_forwarding** — "It allows the router to forward directed broadcast... **Default: 0**"

Docker 会打开 `ip_forward`（它必须），但**从不碰 `bc_forwarding`**（grep 桥接驱动源码无 sysctl 写入）。

不过如 §1 所述，**实际情形比这更早失败**：容器里 `os.networkInterfaces()` 只有 `172.17.0.2/16`，算出的广播是 `172.17.255.255`——连 `192.168.1.255` 都不是，压根没产生跨网段的定向广播。

**`DOCKER-ISOLATION-STAGE` 在当前 moby master 已不存在**（改为 ipset 匹配，并有 `deleteLegacyTopLevelRules` 清理 28.0.0 之前遗留的规则）。**`--userland-proxy` 与此无关**（它管入站已发布端口，不管容器出站）。两条都别引。

默认模板 `src/typescript-node/.devcontainer/devcontainer.json` 全文只有 `name` 和 `image`，**无 `runArgs`、无任何网络配置**（**已验证**，读的是 `devcontainers/templates` 仓库实际文件）。devcontainer.json schema 里**没有 `networkMode` 属性**（规范在 [containers.dev/implementors/json_reference](https://containers.dev/implementors/json_reference)，code.visualstudio.com 的旧路径 301 到此）。**VS Code 从未推荐过为 LAN 访问使用 host 网络。**

### 3.6 `--network=host` —— **works**（但是推断）

- [host 网络驱动文档](https://docs.docker.com/engine/network/drivers/host/)："that container's network stack isn't isolated from the Docker host (**the container shares the host's networking namespace**), and the container doesn't get its own IP-address allocated."
- 平台：Docker Engine on Linux；Docker Desktop ≥ 4.34 为可选项。**"Host networking does not work with Windows containers."** 层 4 限制下 TCP/UDP 均支持，广播所需的 UDP 不受影响。

⚠️ **Docker 文档里没有任何一句直接说广播在 host 模式下可用。** 结论由"共享宿主网络命名空间"推导：报文在 LAN 段**本地产生**，根本不需要转发，因此 `bc_forwarding` 无关。旁证：[moby#38976](https://github.com/moby/moby/issues/38976)（OPEN，正中本题）报告者原话 "if I send the broadcast from the host, it can be accepted by other hosts in the local area network, but if it is sent from the docker, it cannot be received by other hosts."，唯一回复是 "is there any workaround other that using host network?"——**无人回答**。

⚠️ 该页**自相矛盾**：一段说 "Processes inside the container cannot bind to the IP addresses of the host because the container has no direct access to the interfaces of the host"，另一段却明说共享命名空间且容器绑 80 端口在宿主 IP 上可用。**如实标出，不代为调和。**

**Docker Desktop（Win/Mac）默认形态 —— does not work**（推断，中高置信）。[Docker Desktop 网络文档](https://docs.docker.com/desktop/features/networking/)："Docker Desktop runs the Docker Engine inside a lightweight Linux virtual machine (VM)"、"Outbound traffic from the container is sent through Network Address Translation (NAT) using a virtual adapter (typically with an internal IP such as `192.168.65.3`)"。该文档同样**对广播只字未提**，结论由 NAT 架构推出。注意这意味着 `192.168.65.0/24` 是与 `172.17.0.0/16`、物理 LAN 都不同的**第三个网段**。

### 3.7 Remote-SSH —— **does not work**（相对用户自己的物理 LAN 而言）

- [code.visualstudio.com/docs/remote/ssh](https://code.visualstudio.com/docs/remote/ssh)："VS Code runs extensions in one of two places: locally on the UI / client side, **or remotely on the SSH host**."；"most extensions will reside on the SSH host."
- [extension-host](https://code.visualstudio.com/api/advanced-topics/extension-host)："remote – A Node.js extension host running remotely in a container or a remote location."

所以报文的网卡是**远端那台物理机**的。**如果远端机器和目标在同一网段，广播是通的**；如果不同网段，则 `x.y.z.255` 对远端机不是广播地址（`ip(7)` 的 "locally-attached" 限定），RFC 922 会把它当定向广播路由到目的网络网关——**通常失败**。

**排除"隧道代理回本地"的可能：** [ssh 页](https://code.visualstudio.com/docs/remote/ssh)："All **other** communication between the server and the VS Code client is accomplished through the authenticated, secure SSH tunnel." 这是 client↔server 的 RPC 通道；同页记录的 SSH 端口转发是**用户主动指定某个端口**，不存在任意 UDP 的中继设施。⚠️ **该否定结论是我的推断**——文档从未以否定句形说过"UDP 不会被代理"，但整条远程栈里没有任何 UDP relay 能力。

### 3.8 Codespaces / vscode.dev —— 分两种，**都会失败，但失败方式完全不同**

**（a）vscode.dev / 浏览器编辑器：扩展根本不会被加载。**

[web-extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)："The script runs in the web extension host in a **Browser WebWorker** environment"、"Web extensions still have access to the full VS Code API, but **no longer to the Node.js APIs**"。

**最关键的一句：**
> "Extensions that have only a `main` entry point, but no `browser` are not web extensions."

本扩展 `package.json:18` 只有 `"main": "./out/extension.js"`，**无 `browser` 字段**（**已验证**，读的是本仓库 package.json）。因此它在 vscode.dev 上**不是"广播失败"，而是"扩展缺席"**——没有 `dgram`，没有 `SO_BROADCAST`，没有报文，用户大概率只看到命令消失，且**看不到任何报错**。

**（b）Codespaces：Node 扩展宿主存在，`dgram` 可用，但拓扑上到不了家庭 LAN。**

[remote-extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)："When in a remote workspace or when using Codespaces, Workspace Extensions run on the remote machine / environment." —— Codespaces 里 `dgram` **是**可用的。

⚠️ **`UIKind` 没有 `Codespaces` 成员。** [`vscode.d.ts`](https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts)（10690–10701）只有 `Desktop = 1` 和 `Web = 2`。而且 `uiKind` 描述的是 **UI 表面，不是代码运行位置**：Codespaces 的**浏览器**编辑器里跑的是 **Node remote extension host，而 `uiKind === Web`**（[remote-extensions 文档代码注释](https://code.visualstudio.com/api/advanced-topics/remote-extensions)："Codespaces browser-based editor will return UIKind.Web for uiKind"）。

> **⚠️ 这是一条对 v0.1.0 有直接后果的纠正：用 `uiKind !== UIKind.Web` 来判断"Node 能不能用"是范畴错误。** 在 Codespaces-via-browser 中这个判断会误判。要判定远端请用 `extension.extensionKind === vscode.ExtensionKind.Workspace`，要判定 Codespaces 请用 `env.appHost === 'codespaces'`。

**拓扑上到不了 LAN**（**推断，高置信**，由两条直接陈述组合）：
- [Codespaces deep-dive](https://docs.github.com/en/codespaces/getting-started/deep-dive)："When you create a codespace, **a virtual machine (VM) is created**... The VM is both dedicated and private to you."
- [connecting-to-a-private-network](https://docs.github.com/en/codespaces/developing-in-a-codespace/connecting-to-a-private-network)："**they have no access to resources on private networks.**" ← **最强的一条，是直接否定式陈述**。家庭 LAN 正是私有网络的典型。同页记录的唯一出路方向也是反的："allows you to create a bridge between a codespace and **your local machine**"（codespace → 你的机器，不是反方向）。

**没有隧道救得了它：** Codespaces 端口转发文档："Port forwarding gives you access to **TCP ports**"。VS Code Tunnels 文档**通篇不提 UDP**（否定结果，不转写成正面主张）。且 WoL 的本质是**没有可路由的 IP 路径**——任何中继机制结构上都不可能承载它。

---

## 4. 汇总矩阵

| 宿主环境 | 广播能到物理 LAN？ | 置信度 | 失败发生在哪一层 |
|---|---|---|---|
| 桌面本地 | **是** | 高 | — |
| WSL 1 | **是** | 组播高 / **广播为推断** | — |
| WSL 2 NAT（默认） | **否** | 高 | **广播地址算错**（§1）→ 且 NAT 不转发 |
| WSL 2 mirrored | **很可能能** | **中，推断** | 无文档陈述；#13380 风暴报告旁证 |
| WSL 2 bridged | **可能能** | 中低 | deprecated、Pro 依赖、未文档化键 `vmSwitch` |
| Dev Container（默认 bridge） | **否** | 高 | **广播地址算错** → `bc_forwarding=0` |
| Dev Container `--network=host` | **是** | 高（**推断**） | — |
| Docker Desktop 默认 | **否** | 中高（**推断**） | 第三个网段 + NAT |
| Remote-SSH | **远端同网段才通** | 高 | **远端机的网卡**；跨网段则地址解释失败 |
| Codespaces | **否** | 高（**推断**） | 网络拓扑；无错误，静默 |
| vscode.dev / 浏览器 | **否** | 高 | **扩展未加载**；无报错 |

## 5. 三种不同的失败，别混为一谈

它们的失败层级不同，混为一谈会把修复指向错误的地方：

1. **vscode.dev** —— 扩展**压根没加载**。没有任何代码运行。失败在**扩展加载**。
2. **Codespaces / Remote-SSH** —— 扩展**加载了、运行了**，`dgram` 可用，`SO_BROADCAST` 设置成功，`send()` **成功返回**。报文发出去了，只是**什么都没到达**。失败在**网络拓扑**，**静默、无错**。
3. **WSL2 NAT / Dev Container** —— 更早一步：报文连"物理 LAN 的广播地址"都不是。失败在**地址推导**（§1）。同样静默。

**第 2 类最危险**：UDP `send()` 无论有没有人听都会成功。如果扩展的成功路径 UX 存在，它会**如实报告"已发出 6 个唤醒报文"**——按 GLOSSARY，这是**发送方事实**，可以照说；但任何把它表述成"已唤醒"的文案都是**无证据的断言**。而且**没有异常可捕获**，扩展无从知道。

## 6. 明确标注为"未验证"的部分

- **WSL2 虚拟网络下 `SO_BROADCAST` 是否有任何行为差异** —— **查无来源**。唯一相关证据是 [microsoft/WSL#12256](https://github.com/microsoft/WSL/issues/12256) 显示虚拟网卡**具备**广播能力（旁证，非直接陈述）。
- **内核为 limited broadcast（255.255.255.255）选路的具体算法** —— `ip(7)`、`ip-route(5)`、RFC 919/922/1122 **均无**该规则；`ip(7)` 甚至**没有 BROADCAST 小节**，"limited broadcast" 一词零命中。LKML 上有 `ipv4_is_lbcast()` 的讨论但**未读内核源码，不作断言**。
- **WinNAT / Hyper-V Default Switch 对广播的任何限制** —— 广泛流传，**无一手来源**。
- **mirrored 模式下 limited broadcast（255.255.255.255）** —— 双向都无来源。
- **`SO_BROADCAST` 在 Windows 上是否显式默认 FALSE** —— 选项表未文档化默认值，**不作断言**。
- **SSH 隧道不代理 UDP** —— 由"all other communication … through the authenticated, secure SSH tunnel"**推断**，无否定句式陈述。

## 7. 对 v0.1.0 的直接含义（**推断，非决策**）

1. 任何 WSL 路径都**不可依赖**。若必须在 WSL 下工作，唯一稳妥的路是把报文交给 Windows 侧进程（interop 调 `powershell.exe`，或用一个 Windows 侧 helper），而不是继续在 Linux 侧找开关。
2. Dev Container 下唯一可靠的形态是 `--network=host`（可经 `runArgs` 传，但**这不是 VS Code 文档推荐的做法**）。
3. 诊断面（ADR-0004）应当把"目标广播地址是由哪个接口的 netmask 算出来的"作为可展示信息——**这是最先失效的那一层**，且不依赖任何操作系统文档即可判定。
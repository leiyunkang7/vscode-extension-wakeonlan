# 跨平台机制核查：Windows / macOS 上这些机制到底成不成立？

**Issue**: [#11](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/11) · **Map**: [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) · **日期**: 2026-10-05

v0.1.0 是一份要发到 Marketplace 的规格，Windows/macOS 用户都在范围内。图表期的所有已验证事实都只来自 Linux（Node v26.4.0，一张三网卡机器，含一张 Tailscale /32 适配器）。这份文档把每条机制按平台分列，并标注**已验证 / 推断 / 未知**。

**最重要的一条结论先说：Linux 上测出的"静默挂起"不是一个平台行为，而是一个 JavaScript 层的 bug。它在三个平台上完全一致。**

---

## 1. `dgram` 的 bind 语义 —— 三平台一致，且比预想的更糟

### 1.1 静默挂起是 JS 层行为，不是 OS 行为

`node_modules/wakeonlan/index.js:67-72`：

```js
socket.bind(0, from, err => {
  if (err) return reject(err)
  socket.setBroadcast(true)
  socket.once('error', done)   // ← 错误 handler 注册在 bind 回调【内部】
  doSend()
})
```

对照 Node 官方 `lib/dgram.js`（v26.4.0 与 main 分支一致，我已核对 `main` 分支源码）：

```js
// lib/dgram.js:295-309  —— 传了回调时，先挂 errorMonitor + 'listening'
const cb = arguments.length && arguments[arguments.length - 1];
if (typeof cb === 'function') {
  function onListening() { ... FunctionPrototypeCall(cb, this); }
  this.on(EventEmitter.errorMonitor, removeListeners);
  this.on('listening', onListening);
}
// lib/dgram.js:413-420  —— bind 失败时
const err = state.handle.bind(ip, port || 0, flags);
if (err) {
  const ex = new ExceptionWithHostPort(err, 'bind', ip, port);
  state.bindState = BIND_STATE_UNBOUND;
  this.emit('error', ex);
  return;                     // ← 回调永远不会被调用
}
```

**`lib/dgram.js` 是纯 JavaScript，三平台共用同一份。** bind 失败时 Node 发 `'error'` 事件并 `return`，`'listening'` 永不发出，因此 `cb` 永不执行。而 `wakeonlan` 的错误 handler 在 `cb` 内部，此时尚未注册。

结论：**这不是 Linux 的怪癖，是这个库在任何平台上的确定性行为。** 无需在 Windows/macOS 上复现。

### 1.2 实测（本机，Linux / Node v26.4.0 / libuv 1.52.1）

| 场景 | 结果 |
|---|---|
| `dgram` bind 到不存在地址 + **有** `error` listener | 发 `'error'`，`EADDRNOTAVAIL`，回调不触发 |
| `dgram` bind 到不存在地址 + **无** `error` listener | **静默**——无回调、无异常、无输出，事件循环空转后正常退出（exit 0） |
| `wakeonlan(mac, {from:'10.9.9.9'})` | promise **1.5 秒后仍未 settle**；无 unhandled rejection |
| 网卡缺 netmask | `wol()` **同步 throw** `TypeError: Cannot read properties of undefined (reading 'split')`，调用方的 `.catch()` 根本没机会注册 |

无 listener 时不抛异常，是因为 `dgram.Socket` 构造时不会自动挂 `'error'` handler，而 Node 对 `emit('error')` 的无 listener 保护在这里表现为静默（已用 `newListener`/`removeListener` 追踪确认：bind 前 0 个 error listener，bind 后 1 个（errorMonitor 触发的 removeListeners 链），错误后归 0）。

**标注：已验证（Linux）+ 已验证（JS 层逻辑三平台共用）= 全平台适用。**

---

## 2. 端口可移植性 —— 之前的怀疑是**错的**，但真实的坑在别处

图表期研究提出的假设："部分网卡只接受 UDP 端口 0/7/9 或 EtherType 0x0842，所以裸的 `minimum: 1` 会让用户设出静默失败的值。"

**核查结果：这个假设没有权威来源支持。** 事实相反：

- WoL **没有 RFC**，是 AMD + HP 1995 年 11 月白皮书 "Magic Packet Technology" 的产物，IBM/Intel 的 AMA 于 1997 年采纳。属于 de facto standard。
- magic packet 的定义是**纯粹的载荷字节模式**：6 字节 `0xFF` + 目标 MAC 重复 16 次 = 102 字节。Wikipedia 明确写道：*"since the packet is only scanned for the string above, and not actually parsed by a full protocol stack, it could be sent as payload of any network- and transport-layer protocol."*
- 常用端口 9（discard）、7（echo）、0 纯属**历史习惯**，不是硬件约束。多数厂商实现（如 Radxa Linkr）直接发 `255.255.255.255:9`。
- **主机防火墙与唤醒无关**——模式匹配发生在网卡硬件里，在主机防火墙之前（Arch Wiki 明确指出）。

**但真实的坑是另外两个，都比端口严重：**

1. **802.11 无线网卡大多收不到 magic packet**——它们在低功耗态不维持链路。需要 WoWLAN（唤醒无线局域网），且支持有限。**任何把"设备"等同于"IP + MAC"而不记录链路类型的规格都会在这里骗用户。**
2. **ErP / 深度省电 BIOS 选项经常直接切断网卡的待机供电**，导致 WoL 静默失效——同一条报文、同一个端口，硬件层面就收不到。**这是"发包成功但机器不醒"最常见的真实原因，且没有任何软件手段能诊断。**

**规格含义：端口约束不需要特殊值范围，`minimum: 1, maximum: 65535` 不会诱导出坏配置**（但 `port: 0` 需显式处理，因为 `opts.X || default` 会把 0 吞成 9）。**真正需要在规格里写清楚的是"什么情况下 WoL 在物理上就不可能成功"**（无线网卡、BIOS 省电、跨路由器），并且这与"诚实消息契约"那张票直接耦合。

**标注：已验证（来源：Wikipedia Wake-on-LAN、Arch Wiki、TI SNLA261A）。**

---

## 3. SecureOn —— 长度是 4 **或** 6 字节，"现代网卡已弃用"无权威依据

| 来源 | 说法 |
|---|---|
| AMD/HP 白皮书 #20213 (1995) | 原始规格里**根本没有密码字段** |
| Wikipedia | "hexadecimal password of **6 bytes**" |
| TI SNLA261A（DP838xx，权威厂商规格） | "Secure-ON is a **6-byte** user configurable password" |
| Wireshark Wiki（跟随 `ether-wake` CLI 约定） | 密码字段"**either 4 bytes or 6 bytes**"，4 字节按 IPv4 解析、6 字节按 MAC 解析 |
| .NET `MagicPacket.Library` | "must fit into **a 4 or 6 bytes**" |

TI 的报文布局：`DEST(6) | SRC(6) | MISC(X) | FF×6 | DEST_MAC×16 | SecureON(6) | MISC(Y) | CRC(4)`，并实现了密码错误时置 "Hack Flag"。

**"现代网卡已弃用 SecureOn"这个说法：未找到任何权威厂商矩阵支持。** 图表期研究自己就标注了它是"断言而非已核实"。结论应写进规格的是：

- SecureOn **是厂商特定的、跨品牌不互操作**的；
- 密码**明文传输**，局域网内任何人抓包可见；它只把暴力搜索空间提高 48 bit；
- 密码长度**必须支持 4 和 6 两种**（Wireshark/ether-wake 约定是事实标准，TI 只做 6）；
- **"发端追加了密码、目标 NIC 没配" = 完全静默失败**，没有任何错误信号。这与第 2 节的无线网卡/BIOS 坑是同一类问题。

**标注：已验证（来源：TI SNLA261A、Wireshark Wiki、Wikipedia）；"是否还有用户在用"未知。**

---

## 4. `os.networkInterfaces()` —— 三平台都会把虚拟适配器卷进发送

### 4.1 虚拟适配器问题是**跨平台且更严重**的

- **Windows**：Hyper-V `vEthernet`、Docker Desktop、WSL、VMware、VirtualBox 的适配器都以 `internal: false` 上报，并带一个看起来很正常的 `172.x` / `10.x` 地址。这是 SO 上被反复问的问题（`get-local-ip-address-in-node-js`，3653065），公认的标准过滤 `family === 'IPv4' && !internal` **在 Windows 上不够用**。
- **macOS**：`utun0`（VPN）、`vmnet*`（VMware Fusion）、`bridge*`（Parallels）同理。
- **Linux**：本机的 `tailscale0` 就是活例——netmask `255.255.255.255`，`getBroadcastAddr` 因此塌缩成它自己的单播地址。

Node 的 `internal` 标志**只覆盖 `127.0.0.0/8` 和 link-local IPv6**，虚拟适配器一律漏过。

已知的补救信号（[realcoding.blog](https://realcoding.blog/en/2025/09/05/nodejs-get-local-ip-cross-platform)）：默认网关匹配（`route print` / `netstat -rn`）> 接口名黑名单（`vEthernet*` / `Docker` / `WSL` / `Hyper-V` / `VirtualBox` / `VMware`，**必须先 lowercase**）> `!internal` 兜底。MAC OUI 前缀过滤（`00:50:56`, `00:0C:29`, `00:05:69`, `0A:00:27` 等）最稳健。

⚠️ **一个具体的跨平台陷阱**：Windows 的接口名**会被本地化**（韩语 `이더넷`），所以任何硬编码 `'Ethernet'` 或按名字匹配的方案都会在非英文系统上失效。`local-devices` 的过滤（`family === 'IPv4' && !address.internal`）不做任何名称判断，反而躲开了这个坑——但代价是把所有虚拟适配器都放了进来。

### 4.2 `family` 属性的类型历史（一个真实的兼容性陷阱）

Node 官方文档的 History 表：

| 版本 | 变化 |
|---|---|
| v18.0.0 | `family` 改为**数字** |
| v18.4.0 | `family` 改回**字符串** |

当前（v26.4.0 及文档所述 v26.10.0）：`family` 是**字符串** `'IPv4'` / `'IPv6'`。本机实测确认：`typeof family === 'string'`，值 `'IPv4'`。

`local-devices/src/index.js:65` 比较的是 `address.family === 'IPv4'`，**在 v18.4+ 上是正确的**。任何自己重写发现逻辑的代码必须知道 v18.0–18.3 这个窗口期返回的是数字 `4`。

**标注：已验证（`family` 类型、虚拟适配器在 Linux 上的实例）+ 已验证（Windows/macOS 虚拟适配器以 `internal: false` 上报，来源为社区共识与厂商文档）。**

---

## 5. 邻居表读取 —— `local-devices` 的解析器比预想的好，但**是巧合**

我拿真实的三平台输出实测了三个解析器：

### 5.1 macOS：`local-devices` 的"通用"解析器就是 BSD 解析器，且**能用**

`local-devices/src/parser/index.js` 那个基于 `(` `)` `' at '` `' on '` 的解析器，喂进真实 macOS `arp -a` 输出：

```
输入:  ? (192.168.1.1) at a4:91:b1:cc:dd:ee on en0 ifscope [ethernet]
输出:  {"name":"?","ip":"192.168.1.1","mac":"a4:91:b1:cc:dd:ee"}
输入:  ? (192.168.1.23) at (incomplete) on en0 ifscope [ethernet]
输出:  undefined                    ← 正确跳过未解析条目
```

而且它还**正确补零**：`4:32:75:c3:3:ce` → `04:32:75:c3:03:ce`。

macOS 的 `arp` **仍然存在**（`/usr/sbin/arp`；macOS 26 Tahoe 移除的是 `Network Utility.app`，`arp`/`ifconfig`/`netstat`/`route` 都保留），只读 `arp -a` **不需要 sudo**。

⚠️ 但注意：macOS 上 `arp -a` 默认带**主机名解析**，`local-devices` 在 `skipNameResolution` 时才用 `arp -an`（`index.js:106`），而扩展**没有传这个选项**，所以每次渲染都会触发一次反向 DNS。`arpPath` 默认是 `'arp'`（`index.js:24`），在 macOS 上存在——**这条路径在 macOS 上是通的。**

### 5.2 Windows：解析器**是 locale 安全的**（意外地）

`local-devices/src/parser/win32.js` 只按空白切分取 `chunks[0]`（IP）和 `chunks[1]`（MAC，把 `-` 换成 `:`），**从不匹配任何英文关键字**。实测真实英文 Windows 输出：

```
Interface: 192.168.1.100 --- 0x4          ← 被 servers 白名单过滤掉
  Internet Address      Physical Address      Type      ← 被过滤掉
  192.168.1.1           aa-bb-cc-dd-ee-ff     dynamic  ← {ip, mac} ✓
  192.168.1.24          3c-22-fb-11-90-2a     dynamic  ← {ip, mac} ✓
```

即使表头本地化成 `Internet 地址 物理地址 类型`、`动态`/`静态`，**只要按列位置取值就完全不受影响**。这比社区推荐的"跳过匹配 `Internet Address` 的行"的做法更稳健。

### 5.3 Linux：**坏的**（已在本轮之前确认）

`arp` 属于已废弃的 net-tools，现代发行版不再预装。本机 `arp: not found`，而 `ip` 在 `/usr/sbin/ip` 存在。`LANEquipmentProvider.ts:35` 的 `await find()` 没有 try/catch，异常直接进 `TreeDataProvider`。

**换 `arpPath` 为 `ip neigh` 不成立**——`parseLinux` 走的是 `prepareAll`，做 `chunks[1].match(/\((.*)\)/)[1]`，而真实 `ip neigh show` 输出没有括号，每行都 throw。

### 5.4 `ndp -a`（macOS IPv6）—— 又一套词汇

如果要用 macOS 的 IPv6 邻居表，注意它**又是一种格式**：

```
Neighbor                          Linklayer Address  Netif  Expire   St  Flgs  Prbs
fe80::212:3400:9c56:7890%en1     0:12:34:56:78:90   en1   23h59m9s  S   R     0
```

状态是**单字母**（`N` nostate / `W` waitdelete / `I` incomplete / `S` stale / `D` delay / `P` probe / `R` reachable），**不是** `ip neigh` 的长词形式。经典陷阱：`St` 列的 `R` 是 Reachable，而 `Flgs` 列的 `R` 是 Router。

**同一个 `ndp` 命令名在 Solaris/illumos 上又用长词形式**（`INCOMPLETE`/`REACHABLE`/`STALE`/…）——三种词汇，同一个命令。

**标注：已验证（三个解析器均以真实三平台输出实测）；macOS `arp` 存在性来源为文档与社区一致报告，未在真机执行。**

---

## 6. `setBroadcast` 的调用顺序 —— `wakeonlan` 是对的

libuv 的 `uv_udp_set_broadcast()` 在**懒初始化**下会失败：`uv_udp_init(loop, &handle)` 用 `AF_UNSPEC` 时不创建底层 socket，必须先 `uv_udp_bind()` 或用 `uv_udp_init_ex(loop, &handle, AF_INET)` 显式建族。顺序错了：

- **Windows**：`setsockopt()` 对无效 socket 句柄返回 `WSAENOPROTOOPT` → `UV_ENOPROTOOPT`
- **Unix**：更常表现为 `EBADF`，或者静默无效、随后 `send()` 到广播地址失败于 `EACCES`

`node_modules/wakeonlan/index.js:67-71` 的顺序是 `bind` 回调内先 `setBroadcast(true)` 再 `doSend()`，**顺序正确**。libuv 自己的测试套件 `test/test-udp-options.c` 也是 `init` → `bind` → `set_broadcast` 这个顺序。

补充：Linux 上 loopback 没有 `IFF_BROADCAST`，向 `127.255.255.255` 的定向广播即使设了 `SO_BROADCAST` 也会在 `sendto()` 失败于 `EACCES`/`ENETUNREACH`。`SO_BROADCAST` 是 `SOL_SOCKET` 级选项（用错层级本身就是经典 `ENOPROTOOPT` 成因）。

**标注：已验证（源码顺序）+ 已验证（libuv 懒初始化语义，来源：libuv 文档与测试）。**

---

## 7. 对 v0.1.0 规格的直接含义

### 必须做平台分支的

| 机制 | Linux | Windows | macOS |
|---|---|---|---|
| 邻居表读取 | `ip neigh`（需新解析器） | `arp -a`（`local-devices` 解析器已可用且 locale 安全） | `arp -a`（`local-devices` 通用解析器已可用） |
| 虚拟适配器过滤 | 需要 | 需要（且接口名本地化，不能按名字硬编码） | 需要 |
| `family` 类型判断 | 字符串 | 字符串 | 字符串（v18.4+；v18.0–18.3 是数字） |

### 可以先只在 Linux 上承诺的

- 发包路径本身。`lib/dgram.js` 的 bind 语义是 JS 层、三平台一致；`setBroadcast` 的顺序要求一致。**只要自己拥有这段代码，它就是三平台对的。**

### 必须在规格里写清楚的（否则扩展会撒谎）

- **802.11 无线网卡大多收不到 magic packet** —— 唤醒需要 WoWLAN，且支持有限。
- **ErP/深度省电 BIOS 会切断网卡待机供电** —— 软件层面完全无法诊断。
- **SecureOn 密码不匹配 = 完全静默失败**，且密码长度可能是 4 或 6 字节。
- **端口值本身不是失败原因**（7 与 9 在本地等价），但 `port: 0` 会被 `opts.X || default` 吞成 9。

---

## 8. 未能验证的

- **Windows 与 macOS 上没有实机运行任何代码。** 上述所有平台差异来自 Node 源码（已核对）、libuv 文档、以及对三平台真实命令输出的解析器实测——但**实测的是解析器，不是解析器在真机上的输入**。
- **`arp` 在未来 macOS 上是否会被移除**：无法预测。macOS 26 Tahoe 的移除清单里没有它，但没有权威的长期承诺。
- **是否存在权威的"哪些网卡仍支持 SecureOn"厂商矩阵**：搜索未找到。结论应写进规格的是"厂商特定、不互操作"，而不是"现代硬件已弃用"。
- **Windows 上 `arp -a` 在 `arp` 命令不存在时的降级路径**：未查。
- **`os.networkInterfaces()` 在 Windows/macOS 上具体的虚拟适配器清单**：来源是社区共识与厂商文档，未逐平台枚举。

---

## 参考来源

- Node.js `lib/dgram.js`（`main` 分支源码，`Socket.prototype.bind` @ 284-427）
- Node.js 官方文档 `os.networkInterfaces()`（`family` 类型与 v18.0.0 / v18.4.0 版本历史）
- libuv `uv.handles.udp` 文档、`test/test-udp-options.c`
- Wikipedia — Wake-on-LAN（AMD/HP 1995 起源、102 字节模式、端口非硬件约束、SecureOn 6 字节、802.11 限制）
- Arch Wiki — Wake-on-LAN（防火墙无关、`ngrep` 校验正则）
- TI SNLA261A — DP838xx Wake-on-LAN (Rev. A)（Secure-ON 6 字节权威厂商规格、报文布局、Hack Flag）
- Wireshark Wiki — WakeOnLAN (WOL)（密码 4 或 6 字节的 dissector 约定）
- LinuxVox — Wake-on-LAN on Linux（EtherType 0x0842、`ethtool` 标志）
- macOS `arp(8)` / `ndp(8)` man pages（`/usr/sbin/arp` 仍存在；`ndp` 状态单字母与 `St`/`Flgs` 歧义）
- 真实三平台命令输出样本（Windows `arp -a` 英文/中文/法语/德语表头；macOS `arp -a` 与 `ndp -a`）
- StackOverflow 3653065 — `os.networkInterfaces()` 与 vEthernet
- realcoding.blog — Node.js 跨平台获取本地 IP（接口名本地化陷阱、虚拟适配器过滤）

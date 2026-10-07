# 目标寻址的事实底稿：配置键能否带冒号、域名在 dgram 里怎么走

**Issue**: [#4](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/4) · **Map**: [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) · **日期**: 2026-10-07 · **状态**: 事实底稿，**部分完成**，非决策

本票要定的是「同网段广播、显式 IP、域名三者怎么共存」，其中两件事要先有事实才能谈：**(a)** 若把显式地址存进 `contributes.configuration`，键名能不能带冒号（MAC 字面量的形状）；**(b)** 域名在哪一刻解析、解析失败长什么样、多地址时走哪一条。

本文是从一个**中途断掉**的并行查证里回收的结果。**先读第 0 节，它规定了其余各节能被引用到什么程度。**

---

## 0. 覆盖状况：哪些做完了、哪些没有

派发的是 5 个查证视角 + 对关键断言各派 3 个异质视角反驳。**主会话额度耗尽时停在 12/59。** 本文只汇编已经产出结构化结果的部分。

| 视角 | 状态 | 可用程度 |
|---|---|---|
| **F1** 配置键名字符约束 | **完成** | 可直接引用 |
| **F2** object 型设置的能力边界（`patternProperties` 是否被支持、Settings UI 呈现、scope 对 object 内部值是否生效、Settings Sync） | **未完成** | **零可用产出** |
| **F3** `dgram` 与域名解析语义 | **未完成**，但拿到了**决定性实测**（见第 3 节） | 实测数据可引用；其源码机制解释**缺失** |
| **F4** 本机一手 schema 抄录 | 完成，**但其中三条断言被反驳视角推翻**（见第 5 节） | **必须带着更正引用** |
| **F5** 现状量化 | **完成** | 可直接引用 |
| 反驳阶段 | 18 条断言 × 3 视角 = 54 个任务，**只有 15 个给出裁定** | 第 4 节逐条标明「站住 / 被推翻 / 未裁决」 |

标注沿用 [broadcast-reachability-across-hosts.md](./broadcast-reachability-across-hosts.md)：**已验证**（一手来源直接陈述，附 file:line 或逐字引用）／**推断**／**未知**。

---

## 1. 配置键**允许冒号**（已验证，多来源一致，反驳未推翻）

这是 (a) 的答案：**「以 MAC 为键」这条路在键名字符集上没有障碍。**

- manifest schema 对键名的约束是 `propertyNames.pattern = '\S+'` —— 只有「不得为空且不含空白」，**没有任何字符白名单**。来源：`src/vs/workbench/api/common/configurationExtensionPoint.ts:39-45`（`microsoft/vscode` @ f4dfb91，1.142.0-dev）。
- 运行期注册校验 `validateProperty` 的**全部拒绝条件只有四条**：trim 后空串、整串匹配语言覆盖正则、键已被注册、policy/policyReference 冲突。**没有一条涉及冒号或字符集**。来源：`src/vs/platform/configuration/common/configurationRegistry.ts:1153-1177`。
- 唯一的「非法形状」风险是键**整体**匹配 `^(\[([^\]]+)\])+$`（语言覆盖专用写法，`configurationRegistry.ts:1106-1110`）。`wakeonlan.targets["aa:bb:cc:dd:ee:ff"].port` 这种带点号前缀的写法**不会**命中它。
- 配置键的树化与查表**只按 `.` 切分，从不按 `:` 切分**，所以嵌套 object 里的冒号段在读写两侧原样保留：`src/vs/platform/configuration/common/configuration.ts:251-252`（`addToValueTree`）、`:333`（`getConfigurationValue`）。
- `@vscode/vsce` 4.0.0 打包时**完全不校验** `contributes.configuration`：对 `out/` 全目录做字节级计数，`configuration` 仅命中 `./README.md` 1 处，`out/package.js` 命中 0。
- **无反例**：本机 20+ 已装扩展（含 GitLens 19.1.0、rust-analyzer、Copilot）的 `contributes.configuration.properties` 下含 `:` 的键数为 **0**。（这条是「未找到反例」，不是「反例不存在」。）

**对 #4 的影响**：键名不构成否决。真正的取舍落在**设置 UI 能不能呈现自由键的 object**，而那正是 **F2 未查的部分**（第 6 节）。F1 只给出一条旁证：设置树渲染器**直接读** `objectProperties` / `objectPatternProperties` / `objectAdditionalProperties`，并且**已经透传 `propertyNames`**（`src/vs/workbench/contrib/preferences/browser/settingsTree.ts:182-213`）——UI 侧认识这套结构，但「认识」到什么程度未查。

---

## 2. scope 的合法取值（已验证，反驳视角未推翻）

`scope` 是 6 个字符串的 enum，默认 `window`；`configurationExtensionPoint.ts:55-58` 的 enum 数组字面量恰好 6 项、`enumDescriptions` 同序 6 项，无 `anyOf`/`oneOf` 旁路。

**注意这条与 F2 的缺口相连**：scope 对 **object 内部的值**是否生效、`machine` scope 在 remote 窗口下存哪儿、是否参与 Settings Sync —— **全部未查**（那是 F2 的任务）。#17 已经把 `globalState` 那一侧查清了（Memento 落在窗口客户端），**不要把那条结论外推到配置键**：两者是不同通道。

---

## 3. 域名在 `dgram` 里的实际走法（**实测，Node v24.21.0**）

F3 未完成，但它在断掉之前跑出了决定性数据。全部实测在 `/root/.local/share/fnm/node-versions/v24.21.0/installation/bin/node`（**落在本扩展真实运行时区间 24.18.1–24.21.0 内**）于 `unshare -n` 隔离网络命名空间里进行，用自建 DNS 与 `/etc/hosts` 控制解析结果。脚本留在 `/tmp/dgram-probe/`。

**一、`socket.send(msg, port, host)` 对域名是就地解析，错误从 `send` 自己的回调里出来。** 不需要、也没有第二条路：

```
*** CALLBACK after 1007 ms err= EAI_AGAIN getaddrinfo EAI_AGAIN blackhole.test bytes= undefined
```

- `err.code = 'EAI_AGAIN'`，`err.message` 以 `getaddrinfo` 开头，**`bytes` 是 `undefined`**（不是 0）——即失败时连「发了几字节」都不存在。
- **回调耗时逐字跟随解析器超时**：`options timeout:1 attempts:1` → 1007ms；放大到 `timeout:10` → **10015ms**。同一次实验里独立的 `dns.lookup` 对照组是 1004ms / 10012ms。
- 后果：**域名目标会把「解析等待」直接算进唤醒的 deadline**。#3 定的 deadline 是 `(count-1)×interval + 500ms`，这个常数**盖不住**一次 DNS 超时（可达 10s 量级且不受扩展控制，取决于 resolver 配置）。这是 (b) 里对规格最有约束力的一条。

**二、多地址时只走第一条，没有 failover。** 让 `multi.test` 同时返回 `127.0.0.2` 与 `127.0.0.3`：

```
dns.lookup all     -> {"e":null,"a":[{"address":"127.0.0.2","family":4},{"address":"127.0.0.3","family":4}]}
dns.lookup (single) -> {"e":null,"a":"127.0.0.2","f":4}
send#1 {"err":null,"bytes":6} hits= [{"ip":"127.0.0.2","from":"127.0.0.1","len":6}]
send#2 同上 · send#3 同上
```

三次发送**全部只落在 `127.0.0.2`**。`dgram` 走的是 `dns.lookup` 的单值语义（默认 `verbatim`/第一条），**不会**因为第一条不通而试第二条。

**对 #4 的影响**：「域名」这一档的语义是**单播到一个解析结果，且该结果由 resolver 的顺序决定**。它比显式 IP 更弱——用户写域名时既放弃了可校验性（ADR 0005 的同网段谓词对域名不成立），也放弃了多宿主 failover。规格若要支持域名，必须把「解析发生在发送那一刻、失败以 `EAI_AGAIN`/`bytes=undefined` 出现、耗时计入唤醒」这三条写进唤醒结果的措辞里，而不是假装域名是 IP 的别名。

**三、F3 没做完的部分（勿当已知）**：`node_udp.cc` 的源码机制链条（`Send` → `Lookup` → hints）**未产出**；错误形状矩阵（`ENOTFOUND` vs `EAI_AGAIN` vs 非法字面量 vs IPv6/IPv4 family 冲突）的脚本 `/tmp/dgram-probe/t_errshape.js` **写完但未运行**。

---

## 4. 现状量化（F5，已验证，可直接引用）

这些是 #4 与 #6（设备记录身份）共同的地板：

- **`contributes.configuration` 当前完全不存在**：`Object.keys(contributes) === ['viewsContainers','commands','views','menus']`（`package.json:31-124`）。加第一个配置键要触及 **4 处**：`package.json` 的 `contributes.configuration`、`package.nls.json`、`package.nls.zh-cn.json`（若用 `%key%`），以及按需改 `.vscodeignore`；`tsconfig.json` 不用动。
- **nls 两份各 11 个 key，集合与顺序完全一致、无单边 key，11 个值全部不同。** vsce 的 `%key%` 正则是 `/^%([\w\d.]+)%$/i`（`@vscode/vsce/out/nls.js:4-20`）。
- **`favoriteList` 落盘的是 `JSON.stringify` 后的数组字符串**（`src/use/useLocalStorage.ts:11-14` 的 object 序列化器、`:99` 的写入 effect）。每条记录**恰好 6 个字段**，插入顺序 `collapsibleState, label, description, iconPath, contextValue, tooltip`——**六个全部是 `vscode.TreeItem` 的 API 属性，没有一个是自有数据字段**（`src/treeview/LANFavoritesProvider.ts`）。即：**设备记录目前没有自己的持久化形状**，它是被视图形状反向定义的。
- **字段名与展示语义相反**：`label` 存 ip、`description` 存 MAC，而 `wol(equipment.description)` 把 `description` 当 MAC 传给发包层（`LANFavoritesProvider.ts:66-68`；采集侧 `src/treeview/index.ts:29-32` 的 `doAdd(equipment.label, …)`）。
- **`remove()` 只按 `description`（MAC）单字段匹配**，`findIndex` 取首个命中；找不到时 `findIndex` 返回 `-1`，而 **`splice(-1, 1)` 会静默删掉列表最后一条**（`LANFavoritesProvider.ts:57-63`）。这是「MAC 去重」那条迷雾的既有伤害面。
- **读回来的记录是普通对象，不是 `Favorite` 实例；`iconPath.light` 也是普通对象而非 `Uri`**（`useLocalStorage.ts:12` + `LANFavoritesProvider.ts:31` 直接返回 `this.favoriteList.value` 不重建）。落盘时 `Uri` 经 `toJSON` 序列化成 `{$mid:1, path, scheme}`。
- **`iconPath` 内嵌了写入那台机器的绝对路径，且指向 `out/resources/` 而非实际打包的 `resources/`——该路径在磁盘上不存在**（`LANFavoritesProvider.ts:92-99` 用 `path.join(__filename,'..','..','resources',…)`，而 `__filename` 在 `out/treeview/…`）。
- **每次 `getChildren()` 调 1 次 `local-devices` 的 `find()`**，无缓存无 try/catch（`LANEquipmentProvider.ts:35`）；outbound 次数 = `getServers()` 枚举出的地址数，**一张 /24 网卡 = 252 次 port-80 connect**，`504` 就是两张同 /24（`getServers()` 对网卡完全不去重）。`pingServer` 对成功失败一律 `resolve` 且**结果被丢弃**（`node_modules/local-devices/src/index.js:87-99`、`:81`、`:41`）。
- **`.vscodeignore` 只挡开发期文件**，`resources/`、`media/` 都在打包范围内；但 `AGENTS.md` 与 `GLOSSARY.md` **当前会被打进 vsix**（`vsce ls` 列出二者，两者都不在 `.vscodeignore:1-15`，而已发布的 0.0.3 vsix 里没有它们——是发布时点差异，不是配置在挡）。

---

## 5. F4 被推翻的三条（引用 F4 时必须带上）

反驳视角对 F4 的三条断言给出了**高置信推翻**。它们不影响第 1 节的结论，但影响「去哪里找一手依据」。

1. ❌ **「manifest JSON schema 不在 VS Code Server 的任何编译产物里」——错。** `vscode://schemas/vscode-extensions` 在 5/5 版本的 `server-main.js` **和** 5/5 版本的 `extensionHostProcess.js` 里均命中 1 次（`registerSchema` 命中 3）。F4 只 grep 了三个字符串（`language-overridable` / `machine-overridable` / `Property should not be empty`）就下了「schema 不在」的结论；那三个字符串确实命中 0，**但那是 schema 内容的子集，不是 schema 存在性的判据**。⇒ 想要一手 schema，**本机产物里就有**。
2. ❌ **「键名的唯一约束是 `propertyNames.pattern='\S+'`」——措辞错。** 键名还有 `validateProperty` 里的另外几条运行时约束（空串、语言覆盖形状、重复注册、policy 冲突）。实质结论不变（冒号仍合法），但「唯一」这个词不能用。
3. ❌ **「`/tmp/vscode-code` 的 `product.json` 是 1.140.0」——读错了。** 该 `product.json` **没有顶层 `version`**，全文 3 处 `version` 全在 `builtInExtensions[]` 里（`:43` js-debug-companion、`:59` ms-vscode.js-debug 的 `1.140.0`、`:75` profile-table）。⇒ 那份检出是 `1.142.0-dev`（`code-oss-dev`，2026-10-06），**与本扩展真实运行时 1.138.0 存在版本错位**，引用它给的行号时必须标注版本；第 1 节里凡是只来自该检出的结论，都应在 1.138.0 或本机产物上二次确认（`validateProperty`、`OVERRIDE_PROPERTY_PATTERN` 两条已由反驳视角在 1.138.0 上逐行核对通过）。

**站住的一条**：本机 5 个 Server 安装与内嵌 Node 的映射（1.137.0→v24.18.1、1.138.0→v24.18.1、1.139.0→v24.20.0、1.139.1→v24.20.0、1.140.0→v24.21.0）经三视角复核，其中给出裁定的 2 票均为站住（逐字复现 + 六路反例实验失败），第 3 票的「推翻」针对的是上面第 3 条那个 `product.json` 读法，不是映射本身。

---

## 6. 还缺什么（#4 要能裁定，这些必须补）

1. **F2 整块空白**：`patternProperties` / `additionalProperties` 在 VS Code 配置 schema 里**被支持还是被忽略**——若被忽略，「以 MAC 为键」根本无法约束键的形状。以及 object 型设置在 Settings UI 里的呈现方式（展开还是纯 JSON 编辑）、scope 对 object 内部值是否生效、`machine` scope 在 remote 下的落点与 Settings Sync 行为。
2. **已发布扩展里把 object 当「键控表」用的先例**——F2 的第 5 问，未产出。
3. **F3 的源码机制链条与错误形状矩阵**（第 3 节第三条）。
4. 18 条待验证断言里 **12 条至今无裁定**，全部集中在 F1/F5 的现状量化断言与「冒号键名」的实测反例上。

第 1 条是 #4 的关键路径：**键名字符集已证明不是障碍，所以「MAC 为键的覆盖层」能不能成立，整个悬在 `patternProperties` 的支持度与 Settings UI 的呈现上。**

---

## 7. dead ends（省下后人重查）

- `/root/.vscode-server/code-<hash>` 是**静态 ELF 可执行文件**，不是解包目录；真正的解包在 `/root/.vscode-server/cli/servers/Stable-<commit>/server/`。按 `code-*` 找 schema 全部落空。
- 那份 server 安装是 remote/headless 形态，`out/` 下**没有** `extensionManifestPropertiesService` 与独立 schema 文件；但**这不等价于「产物里没有 schema」**——见第 5 节第 1 条。
- `/tmp/vscode-code` 是 blobless + sparse-checkout 检出，只有 257 个 `.ts`，`configurationRegistry.ts` / `configuration.ts` 等**都不在工作树里**；`git checkout` 扩大检出会触发数 GB blob 下载并超时。**可行解法是逐个 `git show HEAD:<path> > /tmp/x.ts`**。blobless clone 只有一个 grafted commit，**`git log -- <path>` 查不到历史**，issue 溯源只能靠 `gh api search/issues`。
- `grep` 对 `node_modules` 下的编译产物**会静默失效**（`grep -c ""` 报 1736 行但 `grep -o configuration` 命中 0）；一律改用 Python 字节计数。
- WebSearch 查「vscode 配置键 冒号」这类中文关键词，返回的全是 SEO 垃圾站（CSDN/php.cn），**不可用**。
- 否定性检索的诚实边界：`gh api search/issues` 对 `"Cannot register an empty property"` 返回 `total_count=0`，另两组关键词亦无条目——**这只能写成「未检索到」，不能写成「不存在」**。

---
status: accepted
---

# 设备记录只由一张 QuickPick 字段清单写入

添加与编辑共用**同一个函数**，它的载体是 `window.createQuickPick()` 里的一张**字段清单**——三行同时可见（名字 / MAC 地址 / 显式地址），每行 `description` 显示当前值或 `未填写`，`detail` 显示该行的句法错误或与已有记录的重复提示；点某行进入一个 `createInputBox()` 录入面，回填后回到清单，`ok` 在清单上。这是**设备记录唯一的写入通路**（[0006](0006-addressing-carried-by-device-record-not-settings.md) 已定设置面出局，本票把剩下那条通路也钉在这里）。

一次 `ok` 只落一条记录，不做批量；主动取消无副作用、无草稿、无二次确认。

## 先更正一条被当作已知事实的东西：`ignoreFocusOut` 不是 no-op

本票题面写着「`showInputBox({ignoreFocusOut:true})` 在当前 VS Code 里是个 no-op，因为 `quickInputController.ts` 在 `show()` 的重置块里无条件写 `ui.ignoreFocusOut = false`」。**这句在 1.138（commit `7debcd0e`，实测即 release tip）上不成立。** 重置确实发生（`quickInputController.ts:744`），但 `quickInput.ts:349` 的 `show()` 在 `ui.show()` 之后紧跟一句 `this.update()`（`:363`，代码注释逐字写着"update properties in the controller that get reset in the ui.show() call"），而 `:448` 就是 `this.ui.ignoreFocusOut = this.ignoreFocusOut;`。**show 之前赋值、show 之后赋值都有效**，那个"必须 show 之后再赋"的顺序依赖不存在。

这条更正不改变结论，但改变**结论的理由**：向导形态出局**不是**因为它会失焦，而只是因为下一条。

## 为什么不是向导

`InputBox` 的成员表（index.d.ts:13274-13335）加上平台侧 `getSteps()`（`quickInput.ts:488-496`）穷尽之后只有：标题、"n/m" 进度、`prompt`、`validationMessage`。**没有任何属性能显示先前几步已经收集的值**。平台内部另有一条 `description` 行（`quickInput.ts:205-210`、`:484-486`），但 `extHostQuickOpen.ts` 从不转移它 ⇒ 扩展够不着。

而人已确认的痛点是「两个串行框，中间那段内容看不见，Esc 一按两头都丢」，**要的是所有字段同时可见**。向导恰好是那件事的反面。

## 为什么不是 webview

三条独立代价，每一条都要写进一份「没参与讨论的人能照着实现」的规格：

1. **它当不了弹窗。** `WebviewPanelOptions` 只有 `enableFindWidget` 与 `retainContextWhenHidden`（index.d.ts:10061-10086，与 shipped `src/vscode-dts/vscode.d.ts:10056-10081` 逐字相同）；全 d.ts 里 `modal` 只出现在 `MessageOptions`（:2182、:2187），182 个 `vscode.proposed.*` 文件中**没有任何 webview modal 提案**。所以真表单只能占**编辑器组**或**侧边视图**——而侧边视图那一格已经由 [0003](0003-discovery-as-capture-not-presence.md) 与 #16 用作树和披露。
2. **iframe 里没有文案通路。** webview 内部只有 `acquireVsCodeApi()`（postMessage/getState/setState），既没有 `vscode.l10n` 也没有 `%key%`（后者只作用于 `package.json` 的贡献声明）。每条字符串都要由扩展宿主注入。
3. 外加 CSP nonce 与状态序列化两件事。

决定性的一条不是「做不到」，而是**三字段里只有硬件地址是必须输入的**——为一个不存在的复杂度付三条新通道。

## 门是我们自己守的

`createInputBox()` 这个面上**平台不替你把关**：`ok.enabled` 只跟随 `enabled`（`quickInputController.ts:820`），而 InputBox 的 accept 无条件触发（`quickInput.ts:1271`）。带 gate 的那条路是 `window.showInputBox({validateInput})`——`quickInputController.ts:634-648` 的判据是 `!result || result.severity !== Severity.Error` 就 `resolve(value)` 并 hide。

**但本票不用 `showInputBox`**，因为「编辑时硬件地址只读」需要 `InputBox.enabled`，而 `InputBoxOptions`（:2236-2278）没有这个字段。于是守门成为扩展的义务：

- 句法不合法 → `validationMessage = {message, severity: Error}`，**不 hide、不回填、不写存储**。
- 与已有记录撞硬件地址 → `{severity: Warning}` 且**照常接受**——[0007](0007-device-record-identity-is-hardware-address.md) 的「只提示不阻止」在 API 上有精确对应物：`InputBoxValidationSeverity` 的 JSDoc 逐字写着 Info 与 Warning「does not prevent input acceptance」，只有 Error「prevents the user from accepting」（:2199-2241）。
- **这条必须写成不变量而不是实现细节**：漏写守门的症状是坏数据直接落盘且毫无提示，规格里没有任何一层会回来抓它。

**查重提示因此两处都有**：正在打字的框里（Warning，可接受）与回填之后的清单行上（`detail`，常驻到用户离开表单）。后一处不可省——用户在 0007 的场景里要逐条收藏六行随机地址残影，回填后还要看得见「已经存过同样硬件地址的记录」。

## 清单上那一屏的分工

- `label` = 字段名，UI 上说「MAC 地址」而不说「硬件地址」——用户是在路由器与网卡设置里找 MAC 这个词的；规范词只活在文档与代码里，0007 钉的是那段数据的**语义**，不是标签用词。
- `description` = 当前值或 `未填写`。空字段必须显示占位文本，否则「同时可见」退化成「同时什么都没有」。
- `detail` = 该行的句法错误、重复提示、以及预填来源标注。已核实 `detail` 对**每一个**有值的行都渲染成真实的第二行（`quickInputList.ts:382-383`、`:528-548`），未聚焦行只是 `opacity:.7` 变暗而非隐藏（`quickInput.css:325-334`）。
- **状态一律用文字，不用 `$(pass)`/`$(errors)` 图标**——尽管 `$(codicon)` 标记在 `label`/`description`/`detail` 三处都可用（:1912、:1934、:1944）。这与 [0002](0002-honesty-contract-for-wake-results.md) 钉四级时用同一条理由：靠措辞区分，不靠颜色或图形；图标会在用户读出那句话之前就把「这行有问题」变成一个视觉判断。
- `matchOnDescription`/`matchOnDetail` 保持默认 `false`（`quickInput.ts:539-540`），即打字只匹配字段名。

## 只读的身份怎么表达

`QuickPick` **没有** `enabled`；`kind: Separator` 会把 `description`/`detail`/`buttons` 全部忽略（:1932-1989），它的语义是分隔线而不是禁用的行。所以「不能改硬件地址」不能用「这行点不动」表达——静默不可点正是 [0005](0005-sending-position-disclosure-not-refusal.md) 处决过的「用拒绝代替披露」。

**做法**：该行保持可选中，点进去是一个 `enabled = false` 的 InputBox，`value` 为归一化后的硬件地址，`prompt` 写明「硬件地址是这条记录的身份，不能修改；要改请删除后重新添加」。填错硬件地址的正当出路就是删了重加——三个字段、两次点击。

## 表单只判句法，不做任何关于目标的事

- 拒绝 `host:port`：`port` 已由 #4/#3 钉死为固定 9 不可配，接受端口等于**暗示这个框能指定端口**，那是一个无法兑现的暗示。
- 拒绝 `scheme` 前缀（`http://…`）：它暗示这是一条 URL 而不是一台机器。
- 拒绝 IPv6 字面量（`fe80::1%wlan0` 的括号与 zone id 让句法校验复杂化而收益不明）；但**域名解析出 IPv6 时照常发出**——解析在发送那一刻（0006），表单不判。
- **绝不在表单上 `dns.lookup`**：那是拿一次关于目标的命题当校验，而 0003 与 0005 已经为「扩展主动敲门」处决过两次同构罪。
- 硬件地址接受 `:` `-` `.` 空格四种分隔与任意大小写、点分形式可省前导零，**落盘一律归一化为小写冒号分隔 12 位十六进制**；身份比较、查重、删除全部在归一化形式上做。存原样字符串会让 `AA:BB:…` 与 `aa-bb-…` 变成两条「不同」记录，0007 的查重与 `remove()` 都会指错东西。
- 名字与显式地址一律 trim；**不设长度上限**——名字是用户自取的，0004/#15 已裁定它连日志都不许进（扩展无法预料其内容），在表单上用长度限制拒绝它就是拿一个扩展无权判定的标准去拒绝用户。

## 三个入口，一个函数

`openDeviceForm(initial?: 设备记录): Promise<设备记录 | undefined>`——**只返回数据，不碰存储**，写入与 `refresh()` 归调用方。三个调用方：收藏视图的 add、新增的 `LANFavoritesProvider.edit`、以及采集面那一枚「保存到收藏」按钮（**它从此不再直调 `doAdd`**）。

- **表单永远只接受三字段自有形状作为 `initial`，不做任何 legacy 读取**，不把 `label` 当名字用。遗留数据的整形归 #9，且归在读出那一刻完成——本票钉这条边界，否则「修还是绕开」那张票会把归一化塞进表单里，两处各做一半。
- 采集面进入时**只预填硬件地址**，名字与显式地址留空（0007：观测地址不进耐久数据，今天那条 `doAdd(equipment.label, equipment.description)` 正是绕过了表单在绕它）。预填路径在 `detail` 上标一句「这个硬件地址来自一次邻居表观测，扩展不验证它」——那是**发送方事实**（扩展知道自己从哪儿拿的值），落在 0002 允许的一侧。
- edit 的入口：收藏行第三个 inline 按钮（内置 `ThemeIcon` `$(edit)`，按 #13 那条「不用文件路径」的裁定）+ 注册 `LANFavoritesProvider.edit`。`view/item/context` 的 `when` 沿用 `viewItem == favorite`，group 用 `inline@3`——这行第一次从两位变三位，规格要照实写。**采集面不提供 edit**：邻居条目不是记录，给它 edit 按钮会擦掉 0003 那条「采集面 vs 收藏」的线。

## 代码归属与文案

- 解析器住 `src/device/address.ts`（`parseHardwareAddress` / `parseExplicitAddress`），**返回结构化结果，不返回用户可见字符串**。不进 `src/net/wol.ts`——#3 给那一层定的契约边界是「不认识配置、不认识设备记录、不认识用户目标字符串」；也不进 provider，否则三个入口各写一份。
- **不换 `vscode.l10n`**：它要求 manifest 写 `"l10n": "./l10n"`（:18192，`extensionsRegistry.ts:637-645` 明写用 `vscode.l10n` 就必须指定），而 `extHostLocalizationService.ts:61-65` 在 UI 是默认语言时**根本不加载 bundle**。为一张本票用不上的通道重写全扩展的文案通路不成比例。继续用现有 `I18n`，并沿用 #5 已定的修复（具名占位符 + 未知 key 回退为 key 本身）作为前置。
- 新增约 **14 个 `form.*` 键**（两个标题、三个字段名、`未填写`、两个 placeholder、两类句法错误、重复 Warning、预填来源标注、只读身份说明、寻址方式两态），每个用户可见字符串同时进 `package.nls.json` 与 `package.nls.zh-cn.json`。**发包位置那一行不在其中**——它复用 0005 已有的 key。

## 已接受的代价

**过滤框症状。** QuickPick 顶部那个输入框永远是过滤器：用户在里面敲一个 MAC 会得到**一片空列表**，而扩展自己的 QuickPick **没有**内置的「No matching items」（`src/vs/platform/quickinput` 全目录搜不到该字符串，只有 quick-access provider 自己塞 `noResultsPick`），也没有稳定属性能设这句话。缓解只有 `placeholder` 一句「选择一个字段」，不做任何反制——不清空 `value`、不重置它，那会与用户正在做的事对撞。这一条**如实写进规格**，因为它的替代方案（webview）代价更高。

**寻址方式的回显不另起一行。** 它写在「显式地址」那行的 `description` 里：空 → `广播（所有网卡）`，填了 → `单播到 {address}`。独立的一行有上面的过滤陷阱，而这一行本来就同时可见、本来就归用户点。

## Considered Options

- **纯向导（`createInputBox` 三步 + `QuickInputButtons.Back`）** — 否，`InputBox` 无法显示已收集的值，而「所有字段同时可见」是人确认过的核心诉求。
- **webview 表单（编辑器组或侧边视图）** — 否，见上三代价，且 modal webview 在 1.138 连 proposal 都不是。
- **不做手填表单，添加只走采集面按钮** — 否，显式地址是「用户自己点的决定」，邻居条目给不了它。
- **`showInputBox({validateInput})` 作为录入面** — 否，拿不到 `enabled`，只读身份无处表达；gate 换来的是同一个面上另一半能力缺失。
- **`validationMessage` 只当阻断用、查重提示另找地方** — 否，`severity` 就是为「合法但提醒」设计的（见上）。
- **Separator 承载披露行与只读行** — 否，分隔行在用户一开始打字时即被隐藏（`quickInputList.ts:1472-1477`），而 `alwaysShow` 对分隔行明确无效；把一条常驻披露放进一过滤就消失的位置，正是 0002/0005 反复在防的那类失效。
- **批量添加（`ok` 之后回到空表单）** — 否，它把 0007 认定的合法残影（六行随机地址）变成逐条弹的提示，而「快速添加更容易 ⇒ 重复率上升」应当**如实写进规格**，不靠功能遮掩。
- **禁用 `ok` 表示「还没填好」** — 否，`QuickPick` 没有 `enabled`；且 Enter 无反应是最坏的失焦类症状。

## Consequences

- **`remove()` 的既有缺陷在本票的连带义务里修掉**：删除与查重一律在**归一化硬件地址**上比较，匹配不到就什么都不删并如实报错，绝不 `splice(-1, 1)`（今天它会在找不到时静默删掉最后一条）。
- **采集面那一枚按钮不再是直写**，ADR 0006「表单是唯一写入通路」这条从此没有例外。
- **ADR 0005 的披露落点从两处增补为三处**（清单的 `prompt`，复用同一条计算函数与同一个 key；措辞仍遵守「只在判定为不同网段时出声」）。这不与 #16 的裁定冲突——那一票否的是 `TreeView.description` 那个**标题栏槽位**，与本面无关。
- **`Favorite`/`Equipment` 的自有数据形状与 `TreeItem` 拆开**（0007 已定六个 API 属性 → 三个自有字段），这是形状变更而不是改名。
- 每个 locale 的 key 数从 12 增至约 26；`contributes.commands` 从 7 条增至 8 条（`#14` 那条「死命令直接删」与本条新增不冲突——新增的命令有真实注册与真实处理器）。
- 规格必须包含两条不变量而不只是功能描述：**守门义务**（不合法就不关闭、不回填）与**过滤框症状**（打字得空列表且不报错）。
- #9 收到一条边界输入：表单不读 legacy 数据，遗留整形必须在读出侧完成。

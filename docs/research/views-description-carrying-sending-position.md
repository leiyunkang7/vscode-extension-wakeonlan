# 视图窗格标题上的「描述」能否承载发包位置那一行

**Issue**: [#16](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/16) · **Map**: [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) · **日期**: 2026-10-07 · **状态**: 事实核查，非决策

本票问的是：**ADR 0005 要求的「发包位置」常驻披露行，有没有一个不用改泛型、又不用抢树体首行的落点。** 候选是 `contributes.views[].description`。

标注沿用前两篇：**已验证**（有一手来源直接陈述）、**推断**（由已验证事实组合而来）、**未知**（找不到一手来源）。所有源码行号取自 2026-10-07 fetch 的 `microsoft/vscode` `main` 与 `release/1.138` 分支；本机产物取自 `/root/.vscode-server/cli/servers/` 下的五个 Stable server 安装。

---

## 0. 一句话结论，以及它推翻了什么

**`contributes.views[].description` 这个字段不存在。** 它不在 manifest schema 里，不在官方文档里，不在任何读取它的代码路径里。写进 `package.json` 会被**静默忽略**——不报错、不警告、也没有任何 UI 效果。

而 ticket 正文里最关键的那个前提——「manifest 静态声明，只能静态取值」——**是错的，但方向对它不利的那一半恰好不成立**：那个位置在 VS Code 里确实存在，只是**不走 manifest，走运行时 API**：

> **`TreeView.description`** —— stable API，运行时可写，渲染在视图窗格标题旁，与内置 Search 视图显示结果数用的是同一个槽位。

所以答案不是「选 1 / 2 / 3」，而是：**落点存在，代价接近于零（一个赋值语句），但它是单行纯文本、会被截断、折叠时消失**——这三条决定了它能不能单独扛住 ADR 0005 的措辞要求。

**同时**：本机八个已装扩展、40+ 个 `contributes.views` 条目里，**零个**使用 `description` 字段。这不是巧合——它写不了。

---

## 1. Manifest schema：`description` 不存在（已验证）

### 1.1 schema 里没有这个属性

**来源**：[`src/vs/workbench/api/browser/viewsExtensionPoint.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts)（注意路径是 `api/browser/`，不是 `contrib/views/browser/`）

`viewDescriptor` 的完整 `properties`（`:116-177`，`main` 与 `release/1.138` 逐字相同）只有这些键：

```
type, id, name, when, icon, contextualTitle, visibility, initialSize, accessibilityHelpContent
```

对应的 TS 接口 `IUserFriendlyViewDescriptor`（`:89-108`）同样没有它：

```ts
interface IUserFriendlyViewDescriptor {
  type?: ViewType;
  id: string;
  name: string;
  when?: string;
  icon?: string;
  contextualTitle?: string;
  visibility?: string;
  initialSize?: number;
  // From 'remoteViewDescriptor' type
  group?: string;
  remoteName?: string | string[];
  virtualWorkspace?: string;
  accessibilityHelpContent?: string;
}
```

`remoteViewDescriptor`（`:179-207`）也没有。

### 1.2 为什么它会「静默失效」而不是报错

`viewDescriptor` **没有** `additionalProperties: false`（该约束只加在 `viewsContainerSchema`，`:80`）。所以一个未知的 `description` 键**不触发 schema 报错**，只是被丢弃。这是最容易踩的坑：以为写上去了。

**校验函数也不检查它。** `isValidViewDescriptors`（`:591-625`）手工核对的是 `id`、`name`、`when`、`icon`、`contextualTitle`、`visibility` 六项，没有 `description`。

### 1.3 它从未被复制进视图描述符

`registerCustomViews` 构造 `ICustomViewDescriptor` 的对象字面量（`:516-539`）逐字：

```ts
const viewDescriptor: ICustomViewDescriptor = {
  type: type,
  ctorDescriptor: type === ViewType.Tree ? new SyncDescriptor(TreeViewPane) : new SyncDescriptor(WebviewViewPane),
  id: item.id,
  name: { value: item.name, original: item.name },
  when: ContextKeyExpr.deserialize(item.when),
  containerIcon: icon || viewContainer?.icon,
  containerTitle: item.contextualTitle || (viewContainer && (typeof viewContainer.title === 'string' ? viewContainer.title : viewContainer.title.value)),
  canToggleVisibility: true,
  canMoveView: viewContainer?.id !== REMOTE,
  treeView: type === ViewType.Tree ? this.instantiationService.createInstance(CustomTreeView, item.id, item.name, extension.description.identifier.value) : undefined,
  ...
};
```

`item.description` 在这里**一次都没出现**。注意 `CustomTreeView` 的构造参数是 `(item.id, item.name, extensionId)`——**初始描述恒为 `undefined`**。

扩展宿主侧独立印证同一件事：[`extHostTreeViews.ts:384-386`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostTreeViews.ts)

```ts
// initial title picked up from package.json contributes.views[*].name
for (const view of _extension.contributes.views[location]) {
  if (view.id === _viewId) { this._title = view.name; }   // ← 只读 .name
}
```

**扩展宿主从 manifest 里只读 `name`。** 这是最干脆的一条证词：manifest 里就算真有一个 `description`，扩展宿主也不会把它传下去。

### 1.4 主线程从不把 manifest 的描述传给窗格

[`viewPaneContainer.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPaneContainer.ts) 的 `onDidAddViewDescriptors`（`:783-794`）传给 `createView` 的选项只有：

```ts
{
  id: viewDescriptor.id,
  title: viewDescriptor.name.value,
  fromExtensionId: (viewDescriptor as Partial<ICustomViewDescriptor>).extensionId,
  expanded: !collapsed,
  singleViewPaneContainerTitle: viewDescriptor.singleViewPaneContainerTitle,
}
```

**没有 `titleDescription`。** `titleDescription` 内部字段只由运行时 API 填充（见 §3）。

### 1.5 官方文档也没有它

[contribution-points.md](https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/references/contribution-points.md) 的 `## contributes.views` 一节，示例对象只有 `id` / `name` / `when` / `icon` / `contextualTitle` 五个键，正文也只描述这五个。

**已验证结论**：不存在「类型 / 是否 markdown / 长度上限 / 是否走 `%key%`」这四个问题——字段本身不存在。

### 1.6 与 `%key%` 的差别（澄清一个混淆）

`%key%` 替换**不是**按字段白名单做的，而是对整个 manifest 递归遍历：[`extensionNls.ts:30-89`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensionManagement/common/extensionNls.ts)

```ts
const length = str.length;
if (length > 1 && str[0] === '%' && str[length - 1] === '%') {
  const messageKey = str.substr(1, length - 2);
  let translated = messages[messageKey];
  ...
  obj[key] = message;
}
...
for (const key in extensionManifest) { processEntry(extensionManifest, key); }
```

所以：**任何**字符串字段只要整体写成 `%key%` 都会被替换，`name` 不特殊。三个容易踩的细节：

- **只支持整串匹配。** `"%a% - %b%"`、`"已从 %host% 发出"` 都**不会**被替换——必须整个值就是一个 `%key%`。这对动态文案是硬约束：**披露行不可能是「模板 + NLS」的形式，只能是运行时拼出来的完整字符串**。
- 缺 key 时只有 `logger.warn`（`extensionNls.ts` "Couldn't find message for key {0}."），不是 manifest 错误。
- `ILocalizedString {value, original}` 双值对**只**为 `commands[].title` / `category` 生成；视图的 `name` 拿到的是 `{ value: item.name, original: item.name }`——**同一个字符串两次**，视图名不保留原文/译文对。

---

## 2. 渲染位置、可见性与截断（已验证）

既然 manifest 不提供，运行时描述是从哪渲染出来的？

### 2.1 DOM 结构

内部字段名不叫 `description` 而叫 **`titleDescription`**（`getViewDescription` 这个符号全仓库零命中）。

[`viewPane.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPane.ts)：

```ts
536: protected renderHeaderTitle(container: HTMLElement, title: string): void {
...
559:   const calculatedTitle = this.calculateTitle(title);
560:   this.titleContainer = append(container, $('h3.title', {}, calculatedTitle));
561:   this.titleContainerHover = this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.titleContainer, calculatedTitle));
563:   if (this._titleDescription) {
564:     this.setTitleDescription(this._titleDescription);
565:   }
```

插入与更新（`:607-623`）：

```ts
607: private setTitleDescription(description: string | undefined) {
608:   if (this.titleDescriptionContainer) {
609:     this.titleDescriptionContainer.textContent = description ?? '';
610:     this.titleDescriptionContainerHover?.update(description ?? '');
611:   }
612:   else if (description && this.titleContainer) {
613:     this.titleDescriptionContainer = after(this.titleContainer, $('span.description', {}, description));
614:     this.titleDescriptionContainerHover = this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.titleDescriptionContainer, description));
615:   }
616: }
618: protected updateTitleDescription(description?: string | undefined): void {
619:   this.setTitleDescription(description);
620:   this.updateAriaHeaderLabel(this._title, description);
621:   this._titleDescription = description;
622:   this._onDidChangeTitleArea.fire();
623: }
```

三条已验证事实：

1. **位置**：`<span class="description">`，插在 `<h3 class="title">` **之后**，同一行。也就是视图窗格标题栏里，标题右边。
2. **纯文本**：`textContent`。`$()` 的字符串 children 建的是文本节点，**不解析 HTML，不解析 markdown**。写 `$(rocket) 已唤醒` 只会得到字面量 `$(rocket) 已唤醒`。
3. **自带 hover**：`:614` 给描述挂了独立的 managed hover，显示**未截断的完整字符串**。标题与描述各有各的 hover，互相独立。注意图标（折叠态那个）的 hover 里**只有标题**，没有描述（`:567`）。

### 2.2 截断：CSS 说了算

[`media/paneviewlet.css:42-76`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/media/paneviewlet.css)：

```css
.monaco-pane-view .pane > .pane-header h3.title {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  font-size: 11px;
  min-width: 3ch;
}

.monaco-pane-view .pane > .pane-header .description {
  display: block;
  font-weight: normal;
  margin-left: 10px;
  color: var(--vscode-panelTitle-inactiveForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: none;
  white-space: nowrap;
  flex-shrink: 100000;
}

.monaco-pane-view .pane > .pane-header:not(.expanded) .description {
  display: none;                       /* ← 窗格折叠时描述整体消失 */
}

.monaco-pane-view .pane.horizontal:not(.expanded) > .pane-header h3.title,
.monaco-pane-view .pane.horizontal:not(.expanded) > .pane-header .description {
  display: none;
}
```

`.pane-header` 是 `display: flex; overflow: hidden`（[`paneview.css:25-35`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/paneview.css)）。**描述没有 `max-width`**，宽度完全由 flex 分配。

- **`flex-shrink: 100000` 是本题最要紧的一行**。标题 `min-width: 3ch`，描述收缩权重十万倍。**推断（高置信）**：侧边栏越窄，被先挤没的一定是描述，标题始终保住三个字符。**净效果：窄侧栏下披露行第一个消失。**
- **窗格折叠时 `display: none`，完全不可见。** 这不是渐隐，是没有。

**没有找到**任何社区 issue 报告「view description 在窄容器下被截断 / 被隐藏」。用十余条检索式（`view description truncated`、`pane description overlaps title`、`in:body "titleDescription"` 等）搜 `microsoft/vscode` issues，均无结果。**截断的事实来自 CSS 源码，不来自社区截图**——规格里不要写成「社区已知问题」。

**最强的一条旁证**是官方自己承认的：[microsoft/vscode#106683](https://github.com/microsoft/vscode/issues/106683)「View titles don't have a tooltip」，由 VS Code 负责人 eamodio 提交并当日关闭，正文两句：

> This is especially important when the title gets truncated.
>
> **This also applies to the new `titleDescription` label too**

即：**标题会截断、描述有完全相同的截断问题、官方给的兜底就是加 hover。**

无障碍侧另有一条实际约束：[#239376](https://github.com/microsoft/vscode/issues/239376)「Narrator does not read Tree View description」，微软可访问性团队的复现是 `view.description = 'Testing'`——**读屏只在焦点落到标题上时才念出描述**。原因在源码里：aria-label 只挂在 `iconContainer` 上。

### 2.3 `name` 与 `description` 的差别（已验证）

| | `name` | `description` |
|---|---|---|
| 来源 | manifest `contributes.views[].name`（`%key%` 走整串替换） | **只有运行时 API** |
| 渲染 | `<h3 class="title">` | `<span class="description">`，紧随其后 |
| 样式 | 粗体、`text-transform: uppercase`、`min-width: 3ch` | `font-weight: normal`、`text-transform: none`、`--vscode-panelTitle-inactiveForeground` |
| 收缩 | 后期才收缩 | **`flex-shrink: 100000`，优先被挤没** |
| 折叠时 | 有 `:not(.expanded)` 隐藏规则 | 同样隐藏 |
| 类型 | manifest `string` | API `string \| undefined` |

API 文档的原话是 **"rendered less prominently in the title of the view"**（`vscode.d.ts` `TreeView.description` 的 doc comment），WebviewView 版本是 "rendered less prominently in the title"。

---

## 3. 它是动态的：`TreeView.description` 全链路（已验证）

这是本票最实质的发现：**这个槽位存在，且运行时可写。**

### 3.1 稳定 API

`@types/vscode@1.138.0`（与本仓库 `engines.vscode: ^1.138.0` 一致）`index.d.ts:12198-12202`：

```ts
/**
 * An optional human-readable description which is rendered less prominently in the title of the view.
 * Setting the title description to null, undefined, or empty string will remove the description from the view.
 */
description?: string;
```

同一个接口上还有 `message?`、`title?`、`badge?`（`:12190` / `:12196` / `:12208`）。**`WebviewView` 也有 `description`**（doc comment 是 "Human-readable string which is rendered less prominently in the title."，措辞与 TreeView 版略有出入，细节）。

引入时间：**1.47/1.50，2020-09**。

- [`904d03e4`](https://github.com/microsoft/vscode/commit/904d03e421ffac6664ee8fe1a1a760b8a9da9e18)（2020-08-30）「Adds titleDescription to TreeView」
- [`aa6259c1`](https://github.com/microsoft/vscode/commit/aa6259c1ca54676085cd731475a6a312a447d16e)（2020-09-14）「Renames titleDescription to description」
- 原始诉求 [#97193](https://github.com/microsoft/vscode/issues/97193)，作者原话："Just like the Timeline view, this property should be **writeable in runtime, instead of pre-defined in `package.json`**."——**与本票诉求逐字一致**。落地 issue [#105667](https://github.com/microsoft/vscode/issues/105667)。

### 3.2 从扩展到像素的每一跳

**（a）扩展宿主 setter** —— [`extHostTreeViews.ts:543-561`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostTreeViews.ts)

```ts
private _description: string | undefined;
get description(): string | undefined { return this._description; }
set description(description: string | undefined) {
  this._description = description;
  this._proxy.$setTitle(this._viewId, this._title, description);
}
```

**本机实测**：五个 Stable server 安装的 `out/vs/workbench/api/node/extensionHostProcess.js:294`（压缩后单行）里都存在这段 setter 的等价物——

```js
get description(){return this._description}
set description(e){this._description=e,this._proxy.$setTitle(this._viewId,this._title,e)}
```

Node 版本 v24.18.1（两个安装）与 v24.20.0 / v24.21.0，与 ADR 0005 记的一致。

**（b）RPC 桥** —— [`mainThreadTreeViews.ts:109-117`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadTreeViews.ts)

```ts
$setTitle(treeViewId: string, title: string, description: string | undefined): void {
  const viewer = this.getTreeView(treeViewId);
  if (viewer) {
    viewer.title = title;
    viewer.description = description;
  }
}
```

注意：**title 与 description 共用一条 RPC**，两个 setter 都调 `$setTitle`。所以只改描述也会把当前标题原样带过去。

**（c）内部模型** —— [`common/views.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/views.ts) 的 `ITreeView` 有 `description: string | undefined;` 与 `readonly onDidChangeDescription: Event<string | undefined>;`。

**（d）渲染** —— [`treeView.ts:474-477`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/treeView.ts)

```ts
set description(description: string | undefined) {
  this._description = description;
  this._onDidChangeDescription.fire(this._description);
}
```

订阅在 `:106`：`this.treeView.onDidChangeDescription((newDescription) => this.updateTitleDescription(newDescription))`，最终落到 §2.1 的 `viewPane.ts:618`。

### 3.3 「每次 `getChildren()` 重算」能不能落在它身上

**能。** 它是一个普通可写属性，任何时候都能重新赋值，没有缓存、没有生命周期约束。把重算写进 `getChildren()` 里顺带赋值即可，或者订阅树刷新事件时赋值。

但有一条**真实的时序约束**（**推断**）：初始值恒为 `undefined`，从 `createTreeView()` 到第一次赋值之间存在一个空窗；窗口第一次渲染时描述是空的。**首次赋值应在 `createTreeView` 之后同步做，不要等到第一次 `getChildren()`。**

### 3.4 清除语义与一个必须知道的连带效应

d.ts 明写「设为 null / undefined / 空串会移除」。源码侧 `setTitleDescription` 的 `else if (description && this.titleContainer)` 分支意味着：**只有非空描述才会创建那个 span**；清空后 span 留着但内容为空（**推断，cosmetic**：空 span 在 flex 行里占位，`overflow:hidden` 下不可见）。**推断，非文档承诺**：清空后彻底移除该元素。

**连带效应（对本仓库不成立，但对读代码的人重要）**：`$setTitle` 这条 RPC 同时携带 title 与 description，而两个 setter 都调它（`:548-560`）。扩展宿主侧的 `_title` 初值是 `''`（`:543`），**构造函数会从 manifest 的 `contributes.views[*].name` 把它填上**（`:381-389`）：

```ts
private _title: string = '';
...
if (_extension.contributes && _extension.contributes.views) {
  for (const location in _extension.contributes.views) {
    for (const view of _extension.contributes.views[location]) {
      if (view.id === _viewId) { this._title = view.name; }
    }
  }
}
```

**因此**：只要视图 id 在 `contributes.views` 里登记过（本仓库两个视图都在），单独赋 `.description` **不会**清空标题。反之，若 `createTreeView` 用的 id 未在 manifest 登记（自定义的、不贡献到容器的视图），`_title` 保持 `''`，此时赋 `.description` 会连标题一起抹掉。**本票两个视图都已登记，无此风险。**

### 3.5 谁能用

不受 `extensionKind` 影响——它走的是普通的 ext host → main thread RPC，UI 侧和远端侧都能设。**已验证**：本地 `extensionHostProcess.js` 里有 setter，说明远端扩展宿主里可用；UI 侧渲染发生在主线程，与宿主落点无关。

---

## 4. `contributes.views[].description` 的实测先例：零

对本机 `/root/.vscode-server/extensions/` 下**八个**贡献了视图的扩展、**40+** 个 `contributes.views` 条目做全量扫描（GitLens 20 个、ESP-IDF 10 个、GitHub PR 8 个、ChatGPT 2 个、rust-analyzer 2 个、CodeLLDB 2 个），结果：

```
使用 contributes.views[].description 的条目：0
```

顺带确认了它们怎么写视图名——**全部走 `%key%`**，并配 12 份 `package.nls.*.json`。以 GitHub PR 扩展为例：

```json
{ "id": "pr:github", "name": "%view.pr.github.name%", "when": "...", "icon": "$(github-inverted)", "accessibilityHelpContent": "%view.pr.github.accessibilityHelpContent%" }
```

**这不是巧合**：它们不用，是因为写不了（§1）。所有走动态路线的扩展一律用 `treeView.description =`。

**最贴切的动态先例是微软第一方**：[`microsoft/deoptexplorer-vscode`](https://github.com/microsoft/deoptexplorer-vscode/blob/main/src/extension/treeViews/lineTicks/lineTickTree.ts)

```ts
this.treeView.description = this.provider.node ? this.provider.node.entry.functionName.name : undefined;
```

正是「随选中项变化重算、无内容时置 `undefined` 清除」的模式，同仓库另有四处相同写法。GitHub 代码搜索 `\"treeView.description =\"` 的命中量在数百处量级（**推断**：检索式未穷尽变体，精确条数不可作依据）。

**旁证（未逐行核实）**：内置 Search 视图常被举作把结果数放进该槽位的例子，但本票**未能核实 `main` 上 `searchView.ts` 的具体实现**，故此处只作线索，标为**未知**（见 §7）。

**另一条更弱的线索**：workbench 内部有一个专门的 `updateTitleDescription` 方法，全仓库只有三处实现/调用——`timelinePane.ts`（内置 Timeline 视图，动态文件名描述）与两条给扩展/webview 用的管道（`treeView.ts`、`webviewViewPane.ts`）。**内置 Timeline 是这个槽位唯一的工作台级使用者**；至于内置**扩展**（`extensions/*`）里有没有人用 `treeView.description`，**本票未核实**。

---

## 5. 对照方案逐条查证

### 5.1 `viewsWelcome`

**已验证：只在空视图时渲染，且完全静态。**

官方文档原话："Welcome content only applies to empty tree views. **A view is considered empty if the tree has no children and no `TreeView.message`.**"

源码判定 [`treeView.ts:136-138`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/treeView.ts)：

```ts
override shouldShowWelcome(): boolean {
  return ((this.treeView.dataProvider === undefined) || !!this.treeView.dataProvider.isTreeEmpty)
    && ((this.treeView.message === undefined) || (this.treeView.message === ''));
}
```

`isTreeEmpty` 是 `!this.root.children || this.root.children.length === 0`（`:1139`）。**失效形态是非空的收藏列表 → 这一格永远不亮。票正文排除它的理由成立，源码确认。**

**动态刷新：没有。** `setWelcomeContent` 这个符号**全仓库零命中**。内部确实有 `IViewsRegistry.registerViewWelcomeContent` + `onDidChangeViewWelcomeContent`（[`common/views.ts:430-433`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/views.ts)），约十个**内置**贡献者用它；但**没有任何 `vscode.*` 调用能注册或改写 `viewsWelcome` 内容**。`when` 子句能随 context key 变化重渲染（`viewPane.ts:179` + `:202-223`），但那是整串静态内容的显隐，不是内容本身的重算。

**格式**：schema 写的是 "The format of the contents is a subset of Markdown, **with support for links only**"，渲染器是手写的逐行解析（`content.split('\n')` + `parseLinkedText`），不是 markdown 引擎——独占一行的命令链接渲染成按钮。

### 5.2 视图标题上的 `$(command:...)` / 标题栏菜单

**不能显示，只能点击。** §2.1 已证：描述走 `textContent`。`$(icon)` 与 `[text](command:...)` **两者都不支持**。

标题栏菜单（`menus.view/title`）是**图标按钮**，本仓库已在用（`package.json` 的 `view/title` 三条）。它是动作面，不是文本面。

### 5.3 `StatusBarItem`

**能承载，但形态完全不同。** `index.d.ts:7567-7659` 的成员：`text`（支持 `$(icon-name)` codicon，**不支持** markdown、不支持 `[text](command:)` 命令链接——命令走独立的 `command` 属性）、`tooltip`（`string | MarkdownString`）、`name`、`color`、`backgroundColor`、`priority`、`accessibilityInformation`。

三点代价，**均已验证**：

1. **`name` 不是权限字段**（纠正一个常见误解）。它只是可访问性/标识用的短标签，任何扩展都能设，无白名单。
2. **全局可见，与视图无关。** 发包位置是「这台机器」的事实，本就该全局可见——但 ADR 0005 明确要的是**两个视图各一条、且与视图内容相邻**。状态栏做不到「每棵树一条」。
3. **状态栏是共享空间。** VS Code 允许任何扩展往里塞 item，扩展无法保证位置不被挤掉或被误认为属于别的扩展。

**ADR 0002 的文案契约怎么落到它身上**：ADR 0002 已把**瞬时反馈**全搬进 toast（通知），状态栏与它不冲突——但状态栏也是**瞬时面**，而 ADR 0005 要的是**常驻**。二者不构成互补关系，也不冲突，只是不解决 ADR 0005 的问题。

### 5.4 `TreeView.message`

**这是票正文没列、但形态上最接近「一行常驻文本」的第四个候选。** 同样是 stable API、运行时可写（`$setMessage`，`treeView.ts:451`）。

**先排掉一个常见的误读**：`shouldShowWelcome`（`treeView.ts:136-138`）那个「空视图」判定**管的是 `viewsWelcome` 内容，不是 `message` 本身**。`message` 的显示逻辑是 `updateMessage()`（`treeView.ts:890-899`）：

```ts
protected updateMessage(): void {
  if (this._message) { this.showMessage(this._message); }
  else if (!this.dataProvider) { this.showMessage(noDataProviderMessage); }
  else { this.hideMessage(); }
  this.updateContentAreas();
}
```

**只要 `_message` 非空就显示，与树空不空无关。** `updateContentAreas`（`:1138-1154`）只是在「有 message **且** 树为空」时把树容器藏起来。也就是说 **`TreeView.message` 恰恰不是空视图专属**——把它当 `viewsWelcome` 的同类是错的。

代价与差别（**均已验证**）：

1. **它会顶掉 `viewsWelcome`**（`shouldShowWelcome` 的第二个合取项要求 message 为空）。本票不需要 welcome，不影响取舍。
2. **形态不同**：它渲染成树体**上方的一块 `.message` 区域**（`views.css:32-37`，`padding: 4px 12px 4px 18px`、`display: flex`、`user-select: text`），**不截断、可换行**；而 `description` 是标题栏里的一行、会被省略号吃掉。**这是它相对 `description` 的唯一实质优势。**
3. **stable API 只收 `string`**。`MarkdownString` 版是提案（`treeViewMarkdownMessage`），`extHostTreeViews.ts:117-123` 用 `checkProposedApiEnabled` 把守。
4. 它会**占掉树体上方的垂直空间**，并参与高度计算（`layout` 里 `treeHeight = height - DOM.getTotalHeight(this.messageElement)`，`:996`）。

**未验证**：`message` 为空（`''`）时是否保留占位高度。`hideMessage` 只是加 `hide` class（`views.css:67-69` 是 `display:none`），**推断**不留占位，但未实测。

---

## 6. 与 ADR 0005 已选方案的关系：共存还是冲突

ADR 0005 选的是**树首行一条不可操作说明，每次 `getChildren()` 重算**。

**不冲突。** 两者落在完全不同的 DOM 位置：`description` 在 `<h3 class="title">` 之后的 header 里；树首行是树体里的一个 `TreeItem`。互不遮挡、互不影响。

**但 `TreeView.description` 在 ADR 0005 的措辞要求面前有三条硬伤**，需要主会话裁定：

| ADR 0005 的要求 | `TreeView.description` 是否满足 |
|---|---|
| **只印观测到的事实，不加推断标签** | ✅ 能——它是运行时拼的字符串，措辞完全自控 |
| **两个视图各一条** | ✅ 能——两个 `createTreeView` 各持一个 handle，各设各的 |
| **每次 `getChildren()` 重算** | ✅ 能——普通可写属性，无缓存约束（但见 §3.3 的首次赋值时序） |
| **括注形如「目标 IP 与发包位置的任何网卡都不在同一网段」** | ⚠️ **长**。`flex-shrink: 100000` + `white-space: nowrap` + `text-overflow: ellipsis` ⇒ **窄侧栏下先被截断的正是它**。hover 里有全文，但用户不会去 hover 一行灰字 |
| **常驻可见** | ❌ **窗格折叠时 `display: none`**。ADR 0005 写的「视图可见时可见」在这条上不成立 |
| **两份 nls** | ⚠️ 不能模板化——`%key%` 只支持整串（§1.6）。文案要么整条进 nls（则无法动态），要么运行时硬编码（则两份 nls 失效） |

**代价对比**（这是票正文要的「代价差一个数量级」的答案）：

- **`contributes.views[].description`（manifest 静态）**：代价 = **做不成**。写上去什么都不会发生。
- **`TreeView.description`（运行时）**：代价 = **在 `src/treeview/index.ts:15-21` 把两个 `createTreeView` 的返回值接住**，各赋一次值。**零泛型变更、零 schema 变更、零 nls 变更**（文案运行时拼）。这是票正文里三个候选中代价最小的——**因为 ADR 0005 说「扩展连改视图标题的 handle 都没有」那个前提，只差把返回值赋给一个变量。**
- **树首行 `TreeItem`**：代价 = `TreeDataProvider<Favorite>` 改 `<Favorite | Row>` 联合类型，连带 `src/treeview/index.ts:53` 的 `wake(item)` 签名。票正文估的「多一次泛型变更」是对的。

**替代落点排序（若视图描述因截断不可单独承载披露全文）**：

1. **`TreeView.description` 承载短版本**（如 `workstation-01 · 192.168.50.56/24`），**树首行承载完整版本**（含括注）。两者共存，各自形态匹配各自的长度。代价：一个赋值。
2. **`TreeView.message`** 承载完整版本（不截断、可换行、**不受折叠隐藏规则管辖**——它不在 pane header 里）。代价同为赋值，但会占掉树体上方的垂直空间并参与高度计算。
3. **纯树首行**（ADR 0005 原方案），代价是一次泛型变更，但完全不受截断与折叠影响。
4. **`StatusBarItem`**，只能作为补充，不能替代（做不到「每棵树一条」，且是共享空间）。

---

## 7. 未能验证的

以下各条**不得写进规格**，或必须标注为待验证：

- **未在真实 VS Code 里跑过。** 本文所有 UI 结论来自源码与 CSS，**没有像素级实测**。`flex-shrink: 100000` 导致描述优先截断，是**从 CSS 规则推断**（机制清楚、置信度高），未在浏览器里量过。
- **本机没有 workbench 侧 bundle。** `/root/.vscode-server/cli/servers/*/server/out` 只含 server 与 extension host 产物（`extensionHostProcess.js`、`server-main.js`、`nls.*`）。**`viewsExtensionPoint.ts` 与 `paneviewlet.css` 都不在其中**——`nls.metadata.json` 里 `vscode.extension.*` 命名空间下只有 `activationEvents` 系列，**没有 `contributes.views` 系列**（schema 的 NLS 消息在 workbench 侧生成，随客户端分发）。因此 §1 的 schema 结论**全部来自 GitHub 源码**，本机无从交叉验证。这一点与 ADR 0005 里「本机 server bundle 里内嵌的 manifest schema」的说法**不同**——那处指的是 `extensionKind` 的 `default:["workspace"]`，它在 server 侧的 `extensionsManifestPropertiesService` 里，与 `contributes` 扩展点 schema 是两套东西。
- **内置 Search 视图把结果数放在哪个槽位**（`searchView.ts` 的具体行号）——本票派出的核查未能完成这一条，**留作未知**。已知的是 `TreeView.description` 的著名内置用途就是这个，但**未逐行核实当前 `main` 的实现**。
- **内置扩展（`extensions/*`）里有没有人用 `treeView.description`**——本票未核实。已知 Timeline（workbench 内部视图）是 `updateTitleDescription` 的唯一工作台级使用者，但这不能推论到内置扩展。
- **`contextualTitle` 是否支持 `$(icon)` / command 链接**——未查。
- **`TreeView.message` 为空时是否保留占位高度**——未实测。源码 `hideMessage` 只是加 `hide` class，推断不留占位。
- **`paneviewlet.css:64-67` 的 `.description .codicon` 规则**疑似死代码（描述走 `textContent`，不产生 `.codicon` 节点）。**推断**，未穷尽排查所有内置 pane 使用方；但扩展侧经 `setTitleDescription` 的路径确定不会产生。
- **社区侧没有关于视图描述截断的 issue**（§2.2 已述）。这只说明**没人报过**，不说明**没人受影响**。
- **读屏行为**（#239376）只验证了扩展作者的一例复现，未覆盖 aria-label 的完整路径。
- **只检索了 GitHub issues**，未检索 Discussions 与 PR 评论区。

---

## 8. 对票正文的更正

`#16` 正文里需要修正的三处：

1. **「该字段在 VS Code 里是否真实存在」——不存在。** `contributes.views[].description` 是个 phantom field。
2. **「是否只能静态取值」——前提本身错了。** 该槽位存在，但只经由运行时 API，不经由 manifest。**它是动态的。**
3. **「`src/treeview/index.ts:15-21` 两个 `createTreeView` 的返回值都被丢弃，所以扩展当前没有改视图标题的 handle」——这条事实成立，但结论不成立。** 接住返回值就是全部代价。

**因此票正文列的三个候选都不必选。** 新增第四个候选（`TreeView.description`，运行时）与第五个（`TreeView.message`），两者代价都是「接住 `createTreeView` 的返回值并赋值」。

**交给主会话裁定的**：ADR 0005 的披露全文（主机名 + 网卡 + 网段 + 可能的同网段括注）**在标题栏一行里放不下**，因此是「短版进 `description` + 全文进树首行」，还是「全文改用 `message`」，还是「维持纯树首行」。**这是文案长度与 UI 形态的取舍，本文只提供已验证的约束，不做选择。**

---

## 参考来源

**本机**
- `/root/.vscode-server/cli/servers/Stable-{04c0d99f,07f806f9,2242ebbb,645f29cc,7debcd0e}/server/out/vs/workbench/api/node/extensionHostProcess.js:294` —— `TreeView.description` setter 的压缩产物（五个安装全部存在；Node v24.18.1 / v24.20.0 / v24.21.0）
- `/root/.vscode-server/extensions/*/package.json` —— 八个扩展、40+ 视图条目全量扫描，`description` 命中数 0
- `node_modules/@types/vscode@1.138.0/index.d.ts:12190-12208`（`TreeView.message/title/description/badge`）、`:7567-7659`（`StatusBarItem`）
- `node_modules/@vscode/vsce/out/package.js:1005-1019` —— `contributes.views` 仅用于推导隐式激活事件，vsce 不校验该字段
- `/root/.vscode-server/cli/servers/*/server/out/nls.metadata.json` —— 无 `contributes.views` 命名空间的 NLS 消息（schema 在 workbench 侧生成）

**microsoft/vscode `main`（2026-10-07 fetch）**
- [`src/vs/workbench/api/browser/viewsExtensionPoint.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts) —— `:89-108` 接口、`:116-177` schema、`:179-207` remote 变体、`:257-273` 扩展点注册、`:516-539` 描述符构造、`:591-625` 运行时校验
- [`src/vs/platform/extensionManagement/common/extensionNls.ts:30-89`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensionManagement/common/extensionNls.ts) —— `%key%` 整串替换
- [`src/vs/workbench/api/common/extHostTreeViews.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostTreeViews.ts) —— `:124-132` API 桥、`:384-386` 只读 `view.name`、`:543-561` setter
- [`src/vs/workbench/api/browser/mainThreadTreeViews.ts:109-117`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadTreeViews.ts) —— `$setTitle` RPC
- [`src/vs/workbench/browser/parts/views/viewPane.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPane.ts) —— `:396` 标题描述赋值、`:536-569` `renderHeaderTitle`、`:571-583` aria-label、`:607-623` `setTitleDescription` / `updateTitleDescription`
- [`src/vs/workbench/browser/parts/views/media/paneviewlet.css:42-76`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/media/paneviewlet.css) —— 描述的截断与折叠隐藏规则
- [`src/vs/base/browser/ui/splitview/paneview.css:25-35`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/paneview.css) —— `.pane-header` 的 flex + overflow
- [`src/vs/workbench/browser/parts/views/treeView.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/treeView.ts) —— `:106` 订阅、`:136-138` `shouldShowWelcome`、`:474-477` 内部 setter、`:954-976` `showMessage`、`:1138-1154` `updateContentAreas`
- [`src/vs/workbench/browser/parts/views/media/views.css:32-37`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/media/views.css) —— `.message` 形态
- [`src/vs/workbench/browser/parts/views/viewPaneContainer.ts:783-794`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPaneContainer.ts) —— 只传 `title`，不传 `titleDescription`
- [`src/vs/workbench/contrib/welcomeViews/common/viewsWelcomeExtensionPoint.ts:34-76`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/welcomeViews/common/viewsWelcomeExtensionPoint.ts) —— welcome schema（links only）
- [`src/vs/workbench/common/views.ts:395-434`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/views.ts) —— `IViewContentDescriptor` / `IViewsRegistry`
- [`src/vscode-dts/vscode.d.ts`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) —— `TreeView` / `WebviewView` / `StatusBarItem` 定义
- [`src/vscode-dts/vscode.proposed.treeViewMarkdownMessage.d.ts`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.treeViewMarkdownMessage.d.ts) —— 提案只给 `message` 加 MarkdownString，`description` 仍是 `string`
- `release/1.138` 分支的 `viewsExtensionPoint.ts` 与 `extensionNls.ts` —— 与 `main` 逐字一致

**官方文档**
- [contribution-points.md（contributes.views / viewsWelcome）](https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/references/contribution-points.md)
- [Tree View guide](https://code.visualstudio.com/api/extension-guides/tree-view) · [Icons in labels](https://code.visualstudio.com/api/extension-guides/icons-in-labels)

**Issue 与先例（旁证）**
- [#97193](https://github.com/microsoft/vscode/issues/97193)（原始诉求，原话要求 runtime 可写）· [#105667](https://github.com/microsoft/vscode/issues/105667)（落地）· [#106683](https://github.com/microsoft/vscode/issues/106683)（负责人承认标题与描述同样截断，官方兜底是 hover）· [#239376](https://github.com/microsoft/vscode/issues/239376)（读屏只在标题聚焦时念描述）
- commit [`904d03e4`](https://github.com/microsoft/vscode/commit/904d03e421ffac6664ee8fe1a1a760b8a9da9e18) / [`aa6259c1`](https://github.com/microsoft/vscode/commit/aa6259c1ca54676085cd731475a6a312a447d16e)
- [`microsoft/deoptexplorer-vscode` 的 `lineTickTree.ts`](https://github.com/microsoft/deoptexplorer-vscode/blob/main/src/extension/treeViews/lineTicks/lineTickTree.ts) —— 第一方动态 `treeView.description` 先例
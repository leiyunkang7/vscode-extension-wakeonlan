# 远端宿主的 globalState 是分机还是跨机：同一条设备记录会不会有两个发包位置

**Issue**: [#17](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/17) · **Map**: [#2](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/2) · **日期**: 2026-10-07 · **状态**: 事实核查，非决策

本票问一件事：**`ExtensionContext.globalState` 在 remote 场景下落在哪台机器上**。地图迷雾里「Favorites 要不要跨机同步」那条的严重度整个悬在这个答案上。

标注沿用 [broadcast-reachability-across-hosts.md](./broadcast-reachability-across-hosts.md)：**已验证**（有一手来源直接陈述，附 file:line 或逐字引用）、**推断**（由已验证事实组合而来）、**未知**（找不到一手来源或未能观察）。

**结论先行，且与票面预设相反**：`globalState` **不是分机的**。它落在**窗口客户端那一侧**的 `state.vscdb` 里，与扩展跑在哪台机器上**无关**。因此「同一条设备记录因此存在两个发包位置」这条风险**不成立**——但它被另一个真问题取代，见 §7。

---

## 0. 先厘清两个被混为一谈的东西

`ExtensionContext` 暴露了两组形态完全不同的存储，票面把它们当成一件事了：

| | API | 载体 | 落在哪台机器 |
|---|---|---|---|
| **Memento** | `globalState` / `workspaceState` | **`IStorageService` 的键**，不是扩展自己的目录 | **见 §2，与宿主无关** |
| **扩展私有目录** | `globalStorageUri` / `storageUri` / `logUri` | 真实目录，扩展自己往里写文件 | **见 §1，落在扩展进程所在的机器** |

`vscode.d.ts`（`@types/vscode@1.138`，本仓库 `node_modules/@types/vscode/index.d.ts:8444-8463`、`:8525-8535`）把这条界线写得很清楚——两者的 JSDoc 都只提到自己，但 `globalStorageUri` 那条明写 "Use {@linkcode ExtensionContext.globalState globalState} to store key value data"，方向是**从目录 API 指向 Memento**，不是同一物。

混淆的代价是实测性的：目录 API 在 remote 下**确实**分机，Memento **不是**。

---

## 1. 扩展私有目录：remote 下确实分机

### 1.1 路径在扩展进程所在机器上计算

`ExtensionStoragePaths`（`vs/workbench/api/common/extHostStoragePaths.ts`）整段逻辑只依赖注入进来的 init data：

```ts
constructor(
    @IExtHostInitDataService initData: IExtHostInitDataService,
    @ILogService protected readonly _logService: ILogService,
    @IExtHostConsumerFileSystem private readonly _extHostFileSystem: IExtHostConsumerFileSystem
) {
    this._workspace = initData.workspace ?? undefined;
    this._environment = initData.environment;
    this.whenReady = this._getOrCreateWorkspaceStoragePath().then(value => this._value = value);
}

workspaceValue(extension: IExtensionDescription): URI | undefined {
    if (this._value) {
        return URI.joinPath(this._value, extension.identifier.value);
    }
    return undefined;
}

globalValue(extension: IExtensionDescription): URI {
    return URI.joinPath(this._environment.globalStorageHome, extension.identifier.value.toLowerCase());
}
```

**（已验证）** —— 这是 `globalStorageUri` 的**全部**来源：宿主自己的 environment 里的 `globalStorageHome`，加扩展 id 的**小写**。

**注意 `toLowerCase()`** —— 这解释了本机观察到的目录名：`github.copilot-chat` 在 `globalStorage/` 下是小写，而在 `workspaceStorage/` 下是 `GitHub.copilot-chat`（原样）。实测：

```
/root/.vscode-server/data/User/globalStorage/          ← 小写
  eamodio.gitlens/  github.copilot-chat/  github.vscode-pull-request-github/
  mhutchie.git-graph/  tamasfe.even-better-toml/  vscode.json-language-features/
/root/.vscode-server/data/User/workspaceStorage/8833f0e1b415d98fb0496d9abab9b442/
  GitHub.copilot-chat/                                 ← 原样
```

（`workspaceValue` 用 `extension.identifier.value` 不转小写，`globalValue` 转。**已验证**，两行代码 + 目录实测。）

### 1.2 remote 端把**自己**的路径塞进 init data

服务端 `src/vs/server/node/remoteAgentEnvironmentImpl.ts:121-122`（**已验证**）：

```ts
globalStorageHome: this._userDataProfilesService.defaultProfile.globalStorageHome,
workspaceStorageHome: this._environmentService.workspaceStorageHome,
```

本机编译产物逐字对应（`/root/.vscode-server/cli/servers/Stable-645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/server/out/server-main.js`，压缩后单行，行号无意义，用内容定位）：

```js
...extensionHostLogsPath:fe(this._environmentService.logsHome,`exthost${r._namePool++}`),
globalStorageHome:this._userDataProfilesService.defaultProfile.globalStorageHome,
workspaceStorageHome:this._environmentService.workspaceStorageHome,...
```

而 `globalStorageHome` 的绝对路径形态在同一个 bundle 里被写死成：

```js
$h=Sl["server-data-dir"]||process.env.VSCODE_AGENT_FOLDER||z(uB.homedir(),rt.serverDataFolderName||".vscode-remote"),
PC=z($h,"data"), zM=z(PC,"User"), UY=z(zM,"globalStorage"), FY=z(zM,"History"), HY=z(PC,"Machine");
```

即 `~/.vscode-server/data/User/globalStorage/`（`serverDataFolderName` = `.vscode-server`）。**（已验证）** —— 本机目录实测与之逐字相符。

同一条链在远端扩展宿主 bundle 里也能看到实现（`.../out/vs/workbench/api/node/extensionHostProcess.js`，压缩后第 542 行内）：

```js
of=class{constructor(t,e,n){ ... this._workspace=t.workspace??void 0, this._environment=t.environment,
  this.whenReady=this._getOrCreateWorkspaceStoragePath().then(o=>this._value=o)}
  async _getWorkspaceStorageURI(t){return y.joinPath(this._environment.workspaceStorageHome,t)}
  ... workspaceValue(t){if(this._value)return y.joinPath(this._value,t.identifier.value)}
  globalValue(t){return y.joinPath(this._environment.globalStorageHome,t.identifier.value.toLowerCase())}
  onWillDeactivateAll(){}};
```

与上游 `extHostStoragePaths.ts` **逐字同构**。**（已验证）** —— 五个 server 安装（1.137.0 / 1.138.0 / 1.139.0 / 1.139.1 / 1.140.0）全部一致。

### 1.3 本机活样本

`/root/.vscode-server/data/User/globalStorage/` 确实存在，且里面全是**扩展自己写的杂项文件**：

```
eamodio.gitlens/gk                        20254868 B   ← 一个独立下载的二进制
github.copilot-chat/commandEmbeddings.json 20582417 B
github.copilot-chat/session-store.db        233472 B   ← 扩展自己的 SQLite，不是 VS Code 的
github.vscode-pull-request-github/userIcons/leiyunkang7_457279540.jpg
mhutchie.git-graph/life-cycle.json              113 B
tamasfe.even-better-toml/                       （空目录）
vscode.json-language-features/json-schema-cache/ （空目录）
```

**这些目录由 `globalStorageUri` 产生，里面没有一行是 Memento 数据。**（**已验证**，逐目录 `ls`）

---

## 2. `globalState` 落在**窗口客户端**，与扩展跑在哪台机器无关

这是本票最硬的一条，也是与票面预设相反的一条。

### 2.1 Memento 不走文件系统，走 RPC 到主线程

`ExtHostStorage`（`vs/workbench/api/common/extHostStorage.ts`）把每一次读写都转发到主线程代理。远端 bundle 压缩后第 542 行内逐字：

```js
registerExtensionStorageKeysToSync(t,e){this._proxy.$registerExtensionStorageKeysToSync(t,e)}
async initializeExtensionStorage(t,e,n){let o=await this._proxy.$initializeExtensionStorage(t,e),i;
  return o&&(i=this.safeParseValue(t,e,o)),i||n}
setValue(t,e,n){return this._proxy.$setValue(t,e,n)}
```

`globalState` 就是 `shared === true` 那条路（`ExtHostStorageGlobal` / `ExtensionGlobalMemento` 构造时 `super(..., true, ...)`）。

**Memento 全程不碰本地磁盘。**（**已验证**）

### 2.2 主线程那一端在**客户端**，不在远端

`MainThreadStorage` 在客户端的 `ExtensionHostManager` 里被实例化，与扩展宿主跑在哪台机器**无关**——因为 remote 扩展宿主同样由**客户端**的 `ExtensionHostManager` 拉起，两者共用一个 `RPCProtocol`。

`src/vs/workbench/services/extensions/common/extensionHostManager.ts:249-317`（**已验证**，`_createExtensionHostCustomers(kind, protocol)`）：

```ts
// Named customers
const namedCustomers = ExtHostCustomersRegistry.getNamedCustomers();
for (let i = 0, len = namedCustomers.length; i < len; i++) {
    const [id, ctor] = namedCustomers[i];
    try {
        const instance = this._instantiationService.createInstance(ctor, extHostContext);
        this._customers.push(instance);
        this._rpcProtocol.set(id, instance);
    } catch (err) { ... }
}
```

`this._instantiationService` 是 `ExtensionHostManager` 自己的——**workbench（客户端）层**的实例化服务。这个方法对 `ExtensionHostKind.Local` 与 `ExtensionHostKind.Remote` 是**同一段代码**。

### 2.3 远端 server 里根本没有 `MainThreadStorage` 的实现

这条是**否定式的一手证据**，也是最容易验的：

- 逐个 RPC 方法计数，`server-main.js` 中 `$setValue` / `$initializeExtensionStorage` / `$registerExtensionStorageKeysToSync` **全部 0 命中**（**已验证**，五个 server 安装全为 0）。
- `ExtensionStorageService` 在 `server-main.js` 中 **0 命中**（**已验证**）。
- 上游 `src/vs/server/node/remoteExtensionHostAgentServer.ts` **不注册任何 MainThread actor**；`src/vs/server/node/extensionHostConnection.ts` 里 `MainThread` 零命中（**已验证**）。

server bundle 里唯一像样的 `$` 方法集是 pty / debug / terminal 那一族：

```
$createProcess  $getTerminalLayoutInfo  $setTerminalLayoutInfo  $listProcesses
$sendSignal     $orphanQuestionReply    $getDefaultSystemShell  ...
```

**远端 server 是个转发管道，不是主线程宿主。**（**已验证**）

### 2.4 落盘位置：`state.vscdb`

`MainThreadStorage` 委托给 `IExtensionStorageService`，后者委托给 workbench 的 `IStorageService`（`src/vs/platform/extensionManagement/common/extensionStorage.ts:159-181`，**已验证**）：

```ts
getExtensionStateRaw(extension, global): string | undefined {
    const extensionId = this.getExtensionId(extension);
    const rawState = this.storageService.get(extensionId,
        global ? StorageScope.PROFILE : StorageScope.WORKSPACE);
    ...
}

setExtensionState(extension, state, global): void {
    const extensionId = this.getExtensionId(extension);
    if (state === undefined) {
        this.storageService.remove(extensionId, global ? StorageScope.PROFILE : StorageScope.WORKSPACE);
    } else {
        this.storageService.store(extensionId, JSON.stringify(state),
            global ? StorageScope.PROFILE : StorageScope.WORKSPACE,
            StorageTarget.MACHINE /* Extension state is synced separately through extensions */);
    }
}
```

**键就是扩展 id 本身**（`publisher.name`），**不带**机器、宿主种类或工作区限定符。`global ? PROFILE : WORKSPACE` 是唯一的分叉。

而 `IStorageService` 的物理文件是 SQLite（`src/vs/platform/storage/electron-main/storageMain.ts`，**已验证**）：

```ts
285: private static readonly STORAGE_NAME = 'state.vscdb';
289: return join(this.profile.globalStorageHome.with({ scheme: Schemas.file }).fsPath,
               BaseProfileAwareStorageMain.STORAGE_NAME);
415: private static readonly WORKSPACE_STORAGE_NAME = 'state.vscdb';
420: return join(this.environmentService.workspaceStorageHome... , this.workspace.id,
               WorkspaceStorageMain.WORKSPACE_STORAGE_NAME);
```

即 Linux 桌面端 `~/.config/Code/User/globalStorage/state.vscdb`（PROFILE 域）与 `~/.config/Code/User/workspaceStorage/<id>/state.vscdb`（WORKSPACE 域）。

其中 `globalStorageHome` 的本地来源是 `src/vs/platform/userDataProfile/common/userDataProfile.ts:196`（`joinPath(location, 'globalStorage')`）与 `src/vs/platform/environment/common/environmentService.ts:86`（`appSettingsHome = URI.file(join(this.userDataPath, 'User'))`）；Linux 桌面 user-data-dir 由 `src/vs/platform/environment/node/userDataPath.ts:98-100` 的 `join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), productName)` 决定。**（已验证）**

远端那一侧的同一段推导在上游 `src/vs/server/node/server.main.ts:41-47` 写得更直白（**已验证**）：

```ts
const REMOTE_DATA_FOLDER = args['server-data-dir'] || process.env['VSCODE_AGENT_FOLDER'] || join(os.homedir(), product.serverDataFolderName || '.vscode-remote');
const USER_DATA_PATH = join(REMOTE_DATA_FOLDER, 'data');
const APP_SETTINGS_HOME = join(USER_DATA_PATH, 'User');
const GLOBAL_STORAGE_HOME = join(APP_SETTINGS_HOME, 'globalStorage');
const LOCAL_HISTORY_HOME = join(APP_SETTINGS_HOME, 'History');
const MACHINE_SETTINGS_HOME = join(USER_DATA_PATH, 'Machine');
args['user-data-dir'] = USER_DATA_PATH;
```

这段**只决定目录路径**（`globalStorageUri` / `storageUri` / `Machine/settings.json`），**不参与 Memento 落盘**——`ExtensionStorageService` 在远端根本没有实例（§2.3）。

**一处需要纠正的常见误认**：环境服务里那个 `stateResource` getter（`server-main.js` 内 `get stateResource(){return he(this.appSettingsHome,"globalStorage","storage.json")}`）指向 `storage.json`，**不是** Memento 的落点。它在远端 bundle 里只作为路径访问器出现，本机也**从未被写过**（见 §2.5）。

### 2.5 本机活样本：**远端一个字节都没有**

既然 §2.2–2.4 说 Memento 落客户端，那么在这台**纯远端**机器上应该找不到任何 `state.vscdb`。实测（**已验证**）：

```
$ find / -maxdepth 4 -name "state.vscdb"
（无输出）

$ ls /root/.vscode-server/data/User/globalStorage/storage.json
ls: cannot access ...: No such file or directory

$ find /root/.vscode-server/data/User/ -name '*vscdb*'
（无输出）

$ ls /root/.vscode-server/data/User/
History/  globalStorage/  workspaceStorage/          ← 没有 sync/
```

六个扩展在这台机器的远端宿主上装过、跑过（`/root/.vscode-server/data/logs/*/exthost1/` 下有它们的日志），**远端磁盘上没有任何一行 Memento 状态**。这不是"没触发写入"的推测，是**写不了**——远端没有 `IStorageService` 可写。

对照：本机也**没有**本地桌面 VS Code（无 `code` 二进制、无 `/usr/share/code`、无 `~/.config/Code/User`；`/root/.config/Code/` 下只有一个 `agent-host/local-endpoint` 套接字目录）。**（已验证）** —— 这台机器纯粹是 SSH 目标机，客户端在别处，所以本地 `state.vscdb` 不在这里，两边都观察不到，合起来正好印证了「落在客户端」。

---

## 3. `setKeysForSync` 走哪条通道

### 3.1 登记的键落成一条普通 PROFILE 域键，**带版本号**

`setKeysForSync` 落盘成一条普通的 PROFILE 域键（`extensionStorage.ts:179-181`，**已验证**）：

```ts
setKeysForSync(extensionIdWithVersion: IExtensionIdWithVersion, keys: string[]): void {
    this.storageService.store(ExtensionStorageService.toKey(extensionIdWithVersion),
        JSON.stringify(keys), StorageScope.PROFILE, StorageTarget.MACHINE);
}
```

键格式（`extensionStorage.ts:49-51`，**已验证**）：

```ts
return `extensionKeys/${adoptToGalleryExtensionId(extension.id)}@${extension.version}`;
```

**带版本号**——扩展升级后旧版本登记的 key 集合不再被读到。

真正把它送上云的是 `SyncResource.Extensions` 同步资源：它对每个扩展调 `getKeysForSync(...)`，只把**被登记的**那些键作为该扩展条目上的 `state` 字段写进 `extensions.json`（**已验证**，见下方 §3.3）。

### 3.2 状态不进 `globalState.json`，而是 `extensions.json` 里一个字段

一个容易踩空的细节：扩展状态**不是**一条独立的同步资源，而是 **`SyncResource.Extensions` 里每个扩展条目上的 `state` 字段**（`src/vs/platform/userDataSync/common/extensionsSync.ts:397-406`，**已验证**）：

```ts
const keys = extensionStorageService.getKeysForSync({ id: identifier.id, version: manifest.version });
if (keys) {
    const extensionStorageState = extensionStorageService.getExtensionState(extension, true) || {};
    syncExtension.state = Object.keys(extensionStorageState).reduce((state, key) => {
        if (keys.includes(key)) { state[key] = extensionStorageState[key]; }
        return state;
    }, {});
}
```

同步资源的 URI scheme 是 `vscode-userdata-sync`（`userDataSyncResourceProvider.ts:429-448`），**不是** `vscode-userdata:/GlobalStorage/…`。后者是**引用客户端用户数据文件**的 URI scheme（themes / snippets / `settings.json`），与同步无关——本机远端 bundle 里唯一的 `vscode-userdata` 命中就是 `Schemas` 枚举里那一条常量，且被 `get userRoamingDataHome()` 用来给 `userDataPath/User` 换 scheme（**已验证**，逐字见 §1.2 与 §2.4）。

合并是 3-way、按 semver 决胜（`extensionsMerge.ts:324-357`，**已验证**）：

```ts
// If local state exists and local extension is latest then use local state
if (localState && semver.gt(localExtension.version, remoteExtension.version)) { return localState; }
// If remote state exists and remote extension is latest, use remote state
if (remoteState && semver.gt(remoteExtension.version, localExtension.version)) { return remoteState; }
```

**注意这条合并按扩展版本号决胜，而 §3.1 的登记键本身也带版本号**——扩展升级后，登记记录与合并依据**同时**换代。**（推断**）

### 3.3 默认不同步，且这是一个被代码显式实现的选择

`getKeysForSync` 在两条来源都为空时返回 `undefined`；上面那个 `if (keys)` 因此**根本不填** `state` 字段，于是没有任何东西被上传（**已验证**）。

反向的落盘侧同样有闸（`extensionsSync.ts:565-573`，**已验证**）：

```ts
const keys = version ? extensionStorageService.getKeysForSync({ id: extension.identifier.id, version }) : undefined;
if (keys) {
    keys.forEach(key => { extensionState[key] = state[key]; });
} else {
    Object.keys(state).forEach(key => extensionState[key] = state[key]);
}
```

**所以「不同步」不是 `globalState` 的属性，而是扩展没有去登记。** 这与题面给的前置事实一致，只是机制在此补齐。

**一条扩展无法关闭的旁路**：`getKeysForSync` 会 union 产品内置的 `productService.extensionSyncedKeys?.[id]`（`extensionStorage.ts:183-191`）。也就是说 `product.json` 里的 `extensionSyncedKeys` 能强制某些键同步，**扩展无法退出**。本扩展不在任何 `product.json` 的该列表里（**已验证**：逐个 grep 五个 server 的 `product.json`，`leiyunkang` / `wake-on-lan` 零命中）。

### 3.4 两条同步资源互不串味

`SyncResource.GlobalState`（`globalStateSync.ts`）只收 `StorageTarget.USER` 的键；而 Memento 落盘时标的是 **`StorageTarget.MACHINE`**（§2.4 注释 `/* Extension state is synced separately through extensions */`）。**（已验证）** —— 扩展状态因此**不会**被 GlobalState 资源捎带上传，只走 Extensions 资源那条显式通道。两条路不会重复。

### 3.5 远端下意味着什么

同步引擎整个跑在**客户端的 shared process**（`src/vs/workbench/services/userDataSync/electron-browser/userDataSyncService.ts:13`，`registerSharedProcessRemoteService(IUserDataSyncService, 'userDataSync', ...)`）；远端 bundle 里 `UserDataSync` / `IUserDataSyncStoreService` / `GlobalStateSync` / `ExtensionSync` **全部 0 命中**（**已验证**）。

`extensionsSync.ts` 全文**没有**任何 `remoteAuthority` / `isRemote` 判断，`withProfileScopedServices` 只按 profile 换 `IStorageService`、不区分远端（**已验证**）。所以：

- remote 窗口下 `setKeysForSync` **照常工作**，没有任何 guard 会拦它。调用它的扩展宿主虽跑在远端，RPC 的另一端仍是客户端的 `MainThreadStorage` → 客户端的同步引擎。
- **代价**：一旦登记，**在远端机器上收集的设备记录会被同步到用户账号的其它机器上**。这正是票面担心的那种后果——但它只在扩展**主动登记**后才成立。当前 `wakeonlan` 从未登记（且不在任何 `product.json` 的 `extensionSyncedKeys` 里），所以**当前不存在**。（**推断**，由 §2.2–2.4 + §3.1–3.3 + §3.5 组合；每一环本身都已验证）

---

## 4. `StorageScope` / profile / 工作区 与 remote 的交互

| 域 | 键 | 落点 | remote 下的行为 |
|---|---|---|---|
| `PROFILE` | `globalState` 内容（扩展 id） | 客户端 `globalStorage/state.vscdb` | **不分机**（§2） |
| `PROFILE` | `extensionKeys/<id>@<ver>` | 同上 | **不分机** |
| `WORKSPACE` | `workspaceState` 内容 | 客户端 `workspaceStorage/<workspaceId>/state.vscdb` | **不分机**（同上，同一个 `IStorageService`） |
| `APPLICATION` | `extensionStorage.migrationList` | 客户端 | 不分机 |

- **多根工作区**：`workspaceState` 按 `workspace.id` 分区，多根工作区共享同一个 id，**不因根数分裂**。**（推断**，由 `storageMain.ts:420` 的 `join(workspaceStorageHome, this.workspace.id, ...)` 得出；`globalState` 更是完全与工作区无关——`vscode.d.ts:8444-8447` 的 JSDoc 明写 "stores state independent of the currently opened workspace"）
- **`storageUri` 的 remote 语义**：`workspaceValue()` 走 `this._environment.workspaceStorageHome`，而**这一半是远端的**（§1.2）。所以 `storageUri` **分机**，`workspaceState` **不分机**——**同一对"工作区级"API 落点相反**。这是本票最容易踩的坑，也是票面把两类东西混为一谈的根源。
- **profile**：PROFILE 域即 profile 域，`globalStorageHome` 取自 `defaultProfile`（§1.2 的 `this._userDataProfilesService.defaultProfile.globalStorageHome`）。多 profile 下各 profile 有各自的 `state.vscdb`。**（推断）**
- `StorageScope.APPLICATION_SHARED` 的键在非默认 profile 下被同步侧跳过（`globalStateSync.ts`，**已验证**）——与 Memento 无关，但说明 profile 边界在同步层是真实存在的。

---

## 5. `scope: "machine"` 的配置键在 remote 下的行为

**先说一条对本票无关但必须记下的事实**：本扩展 **v0.0.3 根本没有 `contributes.configuration`**（`package.json:30-132` 只有 `viewsContainers` / `commands` / `views` / `menus`），**也没有 `extensionKind`**（`package.json` 无该字段）。所以问题 5 目前对本票**没有现实后果**——但它会随 ADR 0005 落地 `extensionKind` 而成为相邻事实，一并记下。

- **存哪**：remote 窗口下 machine-scope 键读自**远端**的 `<serverData>/data/Machine/settings.json`（服务端 `machineSettingsResource`，§1.2 同一条链）。**（已验证**，本机 `/root/.vscode-server/data/Machine/` 存在）
- **漂移能否影响它**：能。`getConfiguredExtensionKind` 的优先级是**用户设置 `remote.extensionKind` → product.json → manifest**（ADR 0005 已裁定），而 `remote.extensionKind` 本身是**用户设置**——所以它可以在 remote 窗口里被改，进而改变本扩展的宿主落点。**（推断**，由 ADR 0005 已验证事实 + 设置作用域的既有机制组合）
- **不参与 Settings Sync**：官方文档逐字（`code.visualstudio.com/docs/editor/settings-sync`，**已验证**）——
  > "User settings, except settings with the `machine` or `machine-overridable` scope and settings that you exclude."

  代码侧的对应：`src/vs/workbench/services/configuration/common/configuration.ts:31-32`（**已验证**）
  ```ts
  LOCAL_MACHINE_SCOPES = [APPLICATION, WINDOW, RESOURCE, LANGUAGE_OVERRIDABLE]
  REMOTE_MACHINE_SCOPES = [MACHINE, APPLICATION_MACHINE, WINDOW, RESOURCE,
                           LANGUAGE_OVERRIDABLE, MACHINE_OVERRIDABLE]
  ```
  `MACHINE` 被**刻意**排除在本地集合之外。浏览器侧用 `environment.settingsPath` 以 `{ scopes: REMOTE_MACHINE_SCOPES }` 加载。

**关键的不对称**：machine-scope **配置**不跨机（本地一份、远端一份），而 Memento **跨机**（只有一份，在客户端）。同一个扩展里，一个"跟着机器走"，一个"跟着窗口走"。

---

## 6. 官方对「remote 下扩展本地状态」的推荐

### 6.1 官方背书：状态与机密一律在客户端

**这一段是本票最需要的官方依据**，逐字来自 [Remote Extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)（**已验证**）：

> "UI Extensions: These extensions contribute to the VS Code user interface and are always run on the user's local machine."
>
> "Workspace Extensions: These extensions are run on the same machine as where the workspace is located."

紧接着，在 Secrets 一节：

> **"The API will always store the secrets on the client side but you can use this API regardless of where your extension is running and retrieve the same secret values."**

**"always store … on the client side … regardless of where your extension is running"** —— 这正是 §2 结论的官方表述，只是官方拿 `secrets` 举例。`globalState` 走的是**同一条 RPC 通道**（§2.1–2.2），落点同为客户端。官方把"扩展跑在哪台机器上"与"用户状态存在哪台机器上"**明确解耦**。

同一页还给出了跨机持久化的**官方推荐做法**，逐字：

> "If your extension needs to preserve some user state across different machines then provide the state to Settings Sync using vscode.ExtensionContext.globalState.setKeysForSync."
>
> "This can help prevent displaying the same welcome or updates page to users on multiple machines."

**这直接回答了迷雾项「Favorites 要不要跨机同步」**：官方的推荐路径**就是** `setKeysForSync`，没有第二条。

### 6.2 但有一处有价值的文档空白

`code.visualstudio.com/api/advanced-topics/extension-host` 讲 extension host 配置、运行时、`extensionKind` 与稳定性取舍，**通篇不出现 storage / state / persistence**。**（已验证，属否定结果）** 该页没有任何一句说"跑在远端的扩展有独立的本地状态"。

`vscode.d.ts`（`@types/vscode@1.138`，本仓库 `node_modules/@types/vscode/index.d.ts:8438-8463`）只说 `globalState` 是 "A memento object that stores state independent of the currently opened workspace"——**"independent of workspace"，不是 "independent of extension host kind"**。措辞上根本不含 remote 维度。

**结论：官方从未就「`globalState` 本身在 remote 下存哪台机器」单独给过文档**（**未知**）。但 §6.1 那句 secrets 的表述是**同一架构的官方背书**，且 [Remote FAQ](https://code.visualstudio.com/docs/remote/faq) 复述了 UI/Workspace 两类扩展的机器归属。可查到的另一句相关提示来自设置同步页：

> "VS Code does not synchronize your extensions to or from a remote window, such as when you're connected to SSH, a development container (devcontainer), or WSL."

这句话说的是**扩展本身**的同步，不是扩展状态；顺带提示 remote 窗口需要**单独**登录并开启同步。

---

## 7. 对「同一条设备记录两个发包位置」的判定

票面把风险挂在"globalState 分机"上。**该前提不成立**，所以这条推理链断在这里。但**风险本身没有消失，它换了形状**：

| 票面担心的 | 实际 |
|---|---|
| local 与 remote 窗口各有一份 `favoriteList`，互相看不见 | ❌ **不成立**。同一窗口的两种宿主落**同一份** `state.vscdb`，互相看得见。 |
| 同一条记录在笔记本发包、在服务器发包，取决于你在哪个窗口点的 | ⚠️ **部分成立，但机制完全不同**。同一条 `favoriteList` 在两台机器上**都完整可见**——所以不存在"看不见导致的静默改投"。取而代之的是下面这条。 |

**真正成立的那条**：Memento **跟着窗口客户端走**。同一个用户在**两台机器**上（笔记本 A、服务器 B）各开一个 SSH 窗口，两边是**两个客户端**、两个 `state.vscdb`——**这时才分机**。`setKeysForSync` 是唯一能把它们连起来的开关，而本扩展**从未调用**它。

于是迷雾项「Favorites 要不要跨机同步」的性质被**重新裁定**：

- 它**不是**"要不要让用户在两台机器上各填一遍"的便利性问题——那是**同机双宿主**视角下会犯的错。
- 它**是**"用户在笔记本上填的收藏，在 SSH 进服务器时能不能看见"的问题。这是**跨客户端**的可用性问题。
- 它**不是正确性问题**。因为 Memento 不跨机，就不存在"同一条记录在两台机器上被静默改投"——每台机器上的用户看到的是**自己那一份**列表，在**自己那台机器**上发包。**发包位置与收藏列表待在同一台机器上**。（**推断**，由 §2 组合）

**对 ADR 0005 的直接影响**：ADR 0005 假定"用户可用 `remote.extensionKind` 覆盖，于是同一条设备记录在同一个工作区里可能有两个发包位置"。这条**继续成立**——覆盖会改变扩展跑在哪台机器，从而改变**发包位置**。但它与 `favoriteList` **无关**：`favoriteList` 在两种宿主下是同一份，所以覆盖不会让用户"在两个地方各看到一半的收藏"。

**新的真问题不是存储，是披露的作用域**：`favoriteList` 跟着**窗口客户端**走，而**发包位置**跟着**扩展进程**走。在一个 SSH 窗口里两者通常同机（采集面与发包面同机，ADR 0005 已裁定）。但用户可以用 `remote.extensionKind` 把扩展**拉到本地**——此时**发包位置是笔记本、收藏列表仍来自笔记本的 `state.vscdb`**（仍同机）。**在这个具体扩展上二者始终同机**。（**推断**）

**这里有一个例外必须写明**（**推断**）：若用户**不使用** Settings Sync 并在两台机器上各开窗口，则两台机器各有一份独立的 `favoriteList`，且**各自在各自的机器上发包**——仍然同机。要构造出"收藏列表在一台机器、发包位置在另一台"，需要收藏列表被同步过去**而**扩展被拉到远端，即 `setKeysForSync(['favoriteList'])` + `remote.extensionKind: ["workspace"]` 同时成立。当前扩展**两条都不满足**，所以这个组合**当前不产生**。

---

## 8. 仍未验证的问题

1. **`setKeysForSync` 在 remote 宿主里被调用时，实际是否真的同步**——§3.5 的结论是**推断**。推理链的每一环都有一手来源（含"无 remote guard"这一条已验证的否定结果），但**没有端到端实测**（本机既无客户端也无已开启的同步账户，无法观察）。**这是本文最需要补测的一条**，因为它是 §7 那个组合风险成立与否的唯一开关。
2. **profile 非默认时 PROFILE 域的确切落点**——§4 标为**推断**。`defaultProfile.globalStorageHome` 是**已验证**的默认路径，多 profile 下的实际目录布局未实测。
3. **Codespaces / vscode.dev 下的同一问题**——本文全部证据来自 remote-SSH 形态的 `~/.vscode-server`。Codespaces 走不同的数据目录约定，**未查证**。
4. **WASM 扩展宿主（`ExtensionHostKind.Web`）**——`extensionKind: ["web"]` 的扩展与本文两条路都不同，**未查证**。
5. **升级迁移对 `favoriteList` 的影响**——`extensionStorage.ts` 里有 `migrateExtensionStorage` 与 `extensionStorage.migrationList`（`getSourceExtensionToMigrate`），是**为已重命名/重发布的扩展 id**准备的。v0.0.3 → v0.1.0 若**改了扩展 id**，老用户的 `favoriteList` 会读不出来。这是 issue #9 的相邻事实，**本票未查**。
6. **`state.vscdb` 里的实际行**——本文从代码与目录两侧夹逼出结论，**没有打开过一个真的 `state.vscdb`**（本机两个客户端都不存在）。端到端打开验证是**未知**。

---

## 9. 仍然成立的前置事实（本票未推翻任何一条）

- 用户可通过 `remote.extensionKind` 覆盖 manifest ⇒ **同一条设备记录可能有两个发包位置**。**成立**，但与 `favoriteList` 无关（§7）。
- 采集面与发包面是同一台机器，两者不会互相纠正。**未触及**。
- `setKeysForSync(['favoriteList'])` 存在且**从未被调用** ⇒ 不同步是本扩展的遗漏，不是存储的属性。**成立并已补齐机制**（§3.2）。
- `engines.vscode: ^1.138.0`；扩展宿主实际是 Node v24.18.1–24.21.0。**已复核**——本机五个 server 安装：1.137.0→v24.18.1、1.138.0→v24.18.1、1.139.0→v24.20.0、1.139.1→v24.20.0、1.140.0→v24.21.0。

---

## 结论

**一、分机还是跨机。**
**取决于「哪两台机器」，但答案与票面的二选一都不同**：

- **同一个窗口内，UI 侧宿主与 remote 侧宿主** ⇒ **共享同一份 `globalState`**。它落在窗口客户端的 `<userDataDir>/User/globalStorage/state.vscdb`（PROFILE 域），键是裸的 `publisher.name`，**不带任何机器或宿主种类限定符**。`ExtensionHostManager._createExtensionHostCustomers` 对两种 kind 是同一段代码，且远端 server 里根本没有 `MainThreadStorage` 的实现。**（已验证）**
- **两台不同机器上的两个客户端**（笔记本 + 服务器各开一个 SSH 窗口）⇒ **分机**。各自有各自的 `state.vscdb`。**（推断**，由上一条 + 客户端即宿主推得）**
- **反面澄清**：分机的是 `globalStorageUri` / `storageUri` / `logUri` 这些**文件系统路径**——它们在 remote 下**确实**落在扩展进程所在机器（`~/.vscode-server/data/User/globalStorage/<id 小写>/`）。**（已验证）**

**二、对「同一条设备记录两个发包位置」这个风险的判定。**
**该风险不因存储机制而成立。** `favoriteList` 不分机于同窗两宿主，所以不存在"两个窗口各有一半收藏、静默改投"。ADR 0005 的"同一条设备记录可能有两个发包位置"**继续成立**，但成因是 `remote.extensionKind` 改变**扩展进程落点**，与 `favoriteList` 的存储位置**无关**——两者本来就在同一台机器上。

**跨客户端**（笔记本 vs 服务器）才是分机的那种情形，而那里每台机器的用户看到的是自己那一份列表、在自己那台机器上发包，**仍然同机**。因此：

- 「Favorites 要不要跨机同步」是**可用性/产品判断**（用户在 SSH 进服务器时能否看见自己填的收藏），**不是正确性问题**。
- 票面把它记为"取决于本票答案"是对的，但**本票的答案把它推回"产品判断"这一侧**，且是比票面设想的那一种（"要不要在两台机器上各填一遍"）更值得回答的一种。
- **官方推荐路径唯一**：`code.visualstudio.com/api/advanced-topics/remote-extensions` 明说 "If your extension needs to preserve some user state across different machines then provide the state to Settings Sync using vscode.ExtensionContext.globalState.setKeysForSync."（**已验证**，§6.1）。若决定同步，**没有第二条路可走**——这意味着 §3.5 那条 PII 后果是**采用官方做法时必然要一并裁定的**，不是可以绕开的。
- **唯一能把跨客户端的"分机"变成"静默改投"正确性问题的**，是同时满足两条：登记 `setKeysForSync(['favoriteList'])` **且** 用户用 `remote.extensionKind` 把扩展拉到远端。本扩展**当前两条都不满足**，所以该风险**当前不产生**。

**三、哪些问题仍未验证。**（详见 §8）
端到端实测 `setKeysForSync` 在 remote 下的行为（**最重要**，§3.5 结论正确但无端到端实测）；非默认 profile 的 PROFILE 域落点；Codespaces / vscode.dev / WASM 宿主形态；扩展 id 变更对 `favoriteList` 的迁移影响（相邻的 issue #9）；以及**从未打开过一个真的 `state.vscdb`**——本文由代码与目录两侧夹逼得出，未经端到端开库验证。

---

## 引用来源

**VS Code 官方源码**（`github.com/microsoft/vscode`，`main` @ `3f07e1aba32acacb8b08ae91bfdc954b580ad1fd`；`extHostStoragePaths.ts` 已 diff 确认与 tag `1.138.0` 逐字节相同，故核心结论非版本敏感）：

- `src/vs/workbench/api/common/extHostStoragePaths.ts` —— `ExtensionStoragePaths` 的 `globalValue` / `workspaceValue`
- `src/vs/workbench/api/common/extHostStorage.ts` —— `ExtHostStorage` 是纯 RPC 代理
- `src/vs/workbench/api/browser/mainThreadStorage.ts` —— `MainThreadStorage` 委托给 `IExtensionStorageService`
- `src/vs/workbench/api/common/extHostMemento.ts:109-121` —— `ExtensionGlobalMemento.setKeysForSync`
- `src/vs/platform/extensionManagement/common/extensionStorage.ts` —— `ExtensionStorageService`：`getExtensionStateRaw:159-168`、`setExtensionState:170-177`、`setKeysForSync:179-181`、`toKey:49-51`、`getKeysForSync:183-191`
- `src/vs/platform/storage/electron-main/storageMain.ts` —— `STORAGE_NAME = 'state.vscdb'`:285、路径拼接:289/:420
- `src/vs/workbench/services/extensions/common/extensionHostManager.ts:249-317` —— `_createExtensionHostCustomers`
- `src/vs/server/node/server.main.ts:41-47` —— 远端数据目录推导
- `src/vs/server/node/remoteAgentEnvironmentImpl.ts:121-122` —— 远端把**自己**的路径塞进 init data
- `src/vs/server/node/remoteExtensionHostAgentServer.ts`、`extensionHostConnection.ts` —— 不注册任何 MainThread actor
- `src/vs/platform/environment/common/environmentService.ts:68,86`、`node/userDataPath.ts:98-100` —— 本地 user-data-dir 推导
- `src/vs/platform/userDataProfile/common/userDataProfile.ts:196` —— `globalStorageHome` 拼接
- `src/vs/platform/configuration/common/configurationRegistry.ts:184-213` —— `ConfigurationScope` 枚举
- `src/vs/workbench/services/configuration/common/configuration.ts:28-34` —— `LOCAL_MACHINE_SCOPES` / `REMOTE_MACHINE_SCOPES`
- `src/vs/workbench/services/userDataSync/electron-browser/userDataSyncService.ts:13` —— 同步引擎跑在客户端 shared process
- `src/vs/platform/userDataSync/common/extensionsSync.ts:397-406`、`:565-573`、`extensionsMerge.ts:324-357`、`globalStateSync.ts`、`userDataSyncResourceProvider.ts:429-448`

**VS Code 官方文档**：

- [Remote Extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions) —— "always store the secrets on the client side … regardless of where your extension is running" / "provide the state to Settings Sync using vscode.ExtensionContext.globalState.setKeysForSync"
- [Settings Sync](https://code.visualstudio.com/docs/editor/settings-sync) —— "User settings, except settings with the `machine` or `machine-overridable` scope and settings that you exclude." / "VS Code does not synchronize your extensions to or from a remote window…"
- [Remote FAQ](https://code.visualstudio.com/docs/remote/faq) —— UI / Workspace 两类扩展的机器归属
- [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host) —— **不含**任何 storage/state 陈述（否定结果）
- `@types/vscode@1.138`（本仓库 `node_modules/@types/vscode/index.d.ts:8438-8463`、`:8525-8535`）—— `globalState` / `setKeysForSync` / `globalStorageUri` 的 JSDoc

**本机一手观察**（Linux 7.0.0-34-generic）：

- `/root/.vscode-server/cli/servers/Stable-*/server/out/` —— 五个安装（VS Code 1.137.0 / 1.138.0 / 1.139.0 / 1.139.1 / 1.140.0；Node v24.18.1 / v24.18.1 / v24.20.0 / v24.20.0 / v24.21.0）的 `server-main.js` 与 `vs/workbench/api/node/extensionHostProcess.js`
- `/root/.vscode-server/data/User/globalStorage/` —— 六个扩展目录，**无 `storage.json`、无 `state.vscdb`**
- `/root/.vscode-server/data/User/workspaceStorage/*/` —— 只有每扩展子目录，**无 `state.vscdb`**
- `find / -maxdepth 4 -name "state.vscdb"` —— **零命中**
- `/root/.config/Code/` —— 只有 `agent-host/local-endpoint`，无 `User/`

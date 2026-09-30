---
status: accepted
---

# 用 Bun + Oxlint + Oxfmt + TypeScript 7 替换 npm/yarn + ESLint + Prettier + TypeScript 5

工具链整体迁到 oxc 生态：包管理器换成 Bun（`bun.lock`，移除 `yarn.lock` / `.yarnrc`），lint 用 Oxlint、格式化用 Oxfmt（移除 `eslint` / `prettier` / `eslint-plugin-prettier` / `@typescript-eslint/*`），并直接采用 TypeScript 7.0 原生编译器 —— 因为 Oxlint 的类型感知规则由 `oxlint-tsgolint` 提供，而它基于 typescript-go，**要求 TypeScript 7.0+**，两者必须一起上才能拿到 `typescript/no-floating-promises` 这类规则。编译仍走 `tsc -p ./` 产出 `out/`，集成测试仍走 mocha + `@vscode/test-electron`（Bun 只做包管理与脚本运行，不做运行时与打包器）。

## Considered Options

- **停在 TypeScript 5.x + 非类型感知 Oxlint**：迁移最平滑，但拿不到 61 条类型感知规则，而本项目最需要的正是 promise 未处理这一类。被否。
- **用 Oxlint 的 `jsPlugins` 加载 `@typescript-eslint/eslint-plugin`**：只为保留 `@typescript-eslint/naming-convention`（oxc 生态至今未实现该规则）。等于在 devDependencies 里留一整套 ESLint 插件，与"替换"的初衷矛盾。被否，规则直接放弃。
- **`bun build` / `rolldown` 打包成单文件**：会让 `vsce` 的依赖收集逻辑（读 lockfile + `npm list`）整体失效，收益（包体小）与风险（发布链路）不匹配。被否。
- **`@vscode/test-cli` 取代手写 mocha runner**：本身是一次独立重构，不该混在工具链迁移里。被否，本轮只做 `glob` promise API 与包名的最小适配。
- **Biome 替代 oxfmt**：同为单工具方案，但本项目已决定以 Oxlint 为中心，Oxfmt 与其共享配置与 VS Code 扩展（`oxc.oxc-vscode`），少一个扩展、少一套约定。

## Consequences

- `@typescript-eslint/naming-convention`（原为 `warn`）被**主动放弃**，不是遗漏。oxc 实现后可以直接打开，无需其它改动。
- `engines.vscode` 从 `^1.53.0` 抬到 `^1.138.0`：`@types/vscode` 与 `engines.vscode` 必须同向对齐，否则 `vsce package` 直接失败。代价是放弃 2021 年前的 VS Code 用户。
- TypeScript 6/7 起 `esModuleInterop` 与 `allowSyntheticDefaultImports` **不能再设为 false**：`import * as wol from 'wakeonlan'` 后直接 `wol(...)` 这类"namespace 导入当函数调用"的写法变成类型错误，必须改成默认导入。`moduleResolution: node`（node10）在 6.0 弃用、7.0 移除，因此 `tsconfig` 走 `module` / `moduleResolution: nodenext`。
- 类型真相源仍然是 `tsc`：故意**不开** `oxlint --type-check`，让"编译失败"和"lint 失败"保持两套可独立归因的诊断，而不是在 CI 里合并成一个模糊的信号。
- `vsce` 至今仍硬编码用 `npm` 执行 `vscode:prepublish`（microsoft/vscode-vsce#1108 未解决），所以该脚本写成裸 `tsc -p ./`，不经过任何包管理器转发。
- 该仓库的 Prettier 配置从未真正生效过（`eslint-plugin-prettier` 装而未启用，且没有格式化脚本），所以首次 Oxfmt 全量格式化会产生覆盖几乎所有文件的大 diff。该 diff 单独成 commit，并记入 `.git-blame-ignore-revs`，避免污染 `git blame`。

# Frontend Monorepo — Micro-frontends (Module Federation 2.0)

For UI, design-system, component primitive, or overlay work, read the repository-root `DESIGN.md` before editing. It is the current executable design specification; ADRs only preserve decision history.

React 19 + TypeScript + Tailwind + Rspack + Module Federation 2.0.

## Architecture

```
platform (host @ :3000)
  ├── /login                — auth (host-only)
  ├── loads → admin         (remote @ :3001)  routes: /platform/admin/*
  ├── loads → chat          (remote @ :3005)  routes: /platform/chat/*
  └── …                     — new remotes: /platform/<slug>/*
```

**platform owns**: auth, top-level routing, layout, global error boundary, MFE registry. **Each `mfe-*` owns**: its sub-routes, state, API calls, deploy artifact.

## Internal package imports

Every internal package is scoped `@repo/*` and is imported by its real pnpm
workspace package name — that name is the single module identity:

| Package | Tag | Purpose |
|---|---|---|
| `@repo/design-system` | `ui` | shadcn/ui primitives, layout, Tailwind v4 theme (`styles.css`) |
| `@repo/ai-elements` | `ui` | AI Elements primitives + reusable Chat UI; host injects transport/state via props |
| `@repo/editors` | `ui` | Authoring surfaces: markdown (tiptap), code (CodeMirror), file workspace |
| `@repo/viewers` | `ui` | Read-only previewers: PDF, XMind |
| `@repo/chat` | `feature` | Shared Chat session, native messages, tool cards and artifact/video workspaces |
| `@repo/api` | `data` | Unified axios runtime, auth/session, OpenAPI-generated clients |
| `@repo/runtime` | `runtime` | MFE registry, event bus, auth context |
| `@repo/observability` | `runtime` | Tracing / logging / error reporting |
| `@repo/shared` | `util` | Utils, types, constants |
| `@repo/build-config` | `util` | Shared Rspack rules + Module Federation shared registry |
| `@repo/typescript-config` | `util` | Shared `tsconfig` base |

Every consumer must declare the workspace dependency in its own `package.json`
using `"workspace:*"`. An app depends only on the UI packages it actually uses —
`platform` needs `design-system` only, `chat` does not pull `viewers`, `admin`
does not pull `ai-elements`.

包内模块必须从该包公开入口 re-export 出去；禁止业务代码导入 `<包名>/src/...`。
如果一个包需要新增对外 API，先在该包 `package.json#exports` 声明子路径，再从包名使用。

重型组件走子路径入口（不进主 barrel，避免拖慢 tree-shaking / dev 冷启动）：
`@repo/editors/markdown-editor`、`/code-editor`、`/file-workspace`、
`@repo/viewers/pdf-previewer`、`/xmind-previewer`、`@repo/ai-elements/prompt-input`。

## Layout

- `apps/<name>/` — independently deployable MFE
- `packages/<name>/` — capability package, one purpose each (see table above)

### Boundaries are enforced, not documented

`turbo.json` declares tag rules; each package declares its tag in its own
`turbo.json`. Run `turbo boundaries` (part of `just lint`) to verify:

- `app` → may depend on `feature` / `ui` / `data` / `runtime` / `util`; **nothing may depend on an `app`**
  (this is what makes "MFEs never import each other" mechanical)
- `feature` → `ui` / `data` / `runtime` / `util`; shared feature orchestration may consume API and UI, but never an app.
- `ui` → `ui` / `util` only — a UI package must not reach into `@repo/api` or `@repo/runtime`
- `data` → `runtime` / `util`
- `runtime` → `util`

Adding a package means adding its `turbo.json` with a tag; an untagged package
would silently escape these rules.

## Hard rules

### MFE isolation

- MFEs NEVER import from each other (no cross-imports between `apps/*` remotes)
- MFEs NEVER read each other's state directly
- Cross-MFE communication ONLY via:
  - URL params (preferred)
  - `runtime` event bus (for transient events)
  - shared backend state (via API)

### Shared package singletons (MF `shared`)

Host provides only runtime-critical shared packages:

- `react`, `react-dom`, `react-router-dom`
- `zustand`, `@tanstack/react-query`
- `@repo/runtime`, `@repo/shared`, `@repo/observability`

Remotes consume these from the host with `import: false`; they must not bundle fallback copies of React, router, or platform runtime infra. UI packages and API clients (`@repo/design-system`, `@repo/api`, …) remain normal workspace dependencies so each app can tree-shake the imports it actually uses. MFE remotes are independently deployed asset bundles, but platform is the only user-facing entry.

### API calls

- ALWAYS via `@repo/api` (typed wrappers / generated clients re-exported from package entry)
- 所有非流式请求走**唯一 axios 单例** `apiHttp`（`packages/api/src/http.ts`）：request 拦截器注入 `Bearer` token，response 拦截器统一做 401 refresh-retry + 通用错误处理，并把后端 RFC7807 错误信息（`detail`/`message`/`title`）`toast.error` 出来。业务层 `catch` **不要再手动 toast**——那会重复提示。
- 唯一例外是 **SSE / 流式 / raw-fetch**（AI SDK `DefaultChatTransport`、blob 源、少量 multipart/raw fetch）：它们无法过 axios，改用 `authFetch` （同样镜像 401 refresh 策略），错误在调用点自行 `toast.error(getErrorMessage(err))`。
- 需要**抑制**拦截器全局 toast（后台探针、或页面自渲染内联错误 UI）时，给该请求传 `skipErrorNotify: true`（`ApiRequestConfig`）；内联错误文案统一用 `@repo/shared` 的 `getErrorMessage(err, fallback)` 提取。

### shadcn / Tailwind v4

- **Tailwind v4 + theme**: `packages/design-system/src/styles.css` (`@import "tailwindcss"`, `shadcn/tailwind.css`, `@theme` + sidebar tokens)
- **Build**: **platform host only** — `@tailwindcss/webpack` wired in `@repo/build-config/rspack`; `main.tsx` imports `@repo/design-system/styles.css`（公开 CSS 入口）
- **@source** in `styles.css`: `apps/*/src/**/*.{ts,tsx}` + all four `ui`-tagged packages (not shared/runtime/api). 新增 UI 包必须补一条 `@source`，否则该包的 class 会被 Tailwind 漏扫。
- **MFE remotes**: no PostCSS/Tailwind; app-level styles come from platform-injected `@repo/design-system/styles.css`. Component-owned third-party CSS may stay inside lazy component entries and is handled by the remote plain CSS rule.
- **UI capability packages**: normal workspace dependencies, not MF-shared; preserve tree-shaking
- **State**: shared cross-MFE state primitives live in `@repo/runtime`; `zustand`, `zustand/middleware`, and shallow selector helpers are host-provided MF singletons. Private MFE stores may import `create` / `useShallow` directly from `zustand` packages; do not wrap static Zustand APIs in `@repo/runtime`.
- **Shell 布局（Codex 式左右布局）**: platform `Layout` 是**透明 host**——只做埋点，不渲染任何全局 chrome DOM（无顶栏/侧栏）。认证、组织准入与应用权限统一由 platform route `middleware` 处理，业务组件不得自行实现首屏路由守卫。可见外壳由各 MFE 自持：`chat` 是主壳（左侧栏含品牌 + 会话列表 + 左下角用户区，用户区下拉聚合设置/记忆/团队切换/退出），`admin` 是「设置」壳（左侧「返回应用」+ 分组菜单 + 内容区）。登录落地 `/platform/chat`；跨 app 跳转走 chat 用户区（→ admin）与 admin 的「返回应用」（→ chat）。不要把顶栏加回 platform。
- **全局浮层**: platform `AppProviders` 挂载 `TooltipProvider` + `Toaster`（`toast` 从 `@repo/design-system` 导出）
- **浮层层级**: Dialog / AlertDialog / Sheet / Drawer 及其 portalled popup 必须遵循根 `DESIGN.md#overlay-layering`。业务代码不得维护 z-index 数字表或向子组件逐层透传 popup z-index；新增或修改浮层原语时先读该规范。
- **MFE 内 Provider**: 每个 remote 的 `App` 也要挂载自己的 `TooltipProvider`；`Toaster` 保持由 platform 统一挂载
- **表单**: `Form` + `Field` + `react-hook-form` + `zod`；业务页勿手写裸 `Label`+`useState` 校验
- **页面布局**: `Page` / `PageHeader`；加载态用 `Skeleton`
- **原语约定（shadcn v4 / Base Nova / Tailwind v4）**: shadcn 原语一律**扁平 kebab-case 文件**放在 `packages/design-system/src/shadcn/`，命名导出，以 `@base-ui/react` 作为唯一行为底座。Base UI 组合统一使用 `render={<Element />}`，禁止新写 Radix `asChild`。原语间交叉引用写作 `@repo/design-system/shadcn/<name>`；`src/shadcn/index.ts` 与 `src/index.ts` 统一公开。业务消费方从 `@repo/design-system` 导入，重型组件归入 `@repo/ai-elements` / `@repo/editors` / `@repo/viewers`。
- **完整 registry 基线**: design-system 保持官方 Base Nova registry 的完整组件集合；`message-scroller` 与 `questionnaire` 是 shadcn 官方复合组件，行为来自 `@shadcn/react`，不是 Base UI 原语。`@shadcn/react` 要求 React 19，因此不得回退 React 主版本或移除这两个组件。
- **仓库级集成**: registry 生成文件只保留少量集中扩展：modal/popup 接入 `portal-layer.tsx`，`*Content` 把 `container` 传给 Base UI `Portal`，定位 props 传给 `Positioner`；`form.tsx` 保持 React Hook Form 组合。升级后统一重放这些集成并用全仓 typecheck 验证，不恢复旧 Radix fork。
- **shadcn CLI / MCP（已接入）**: 根 `.cursor/mcp.json` 注册 `shadcn` server（cwd=`apps/frontend/packages/design-system`，`components.json#style=base-nova`、`ui` 别名=`@repo/design-system/shadcn`→`src/shadcn`）。CLI 在 monorepo 里要求 `packages/shared` 也有有效 `components.json` + `tsconfig.json`，勿删。新增多个标准原语时在一条 `pnpm ui:add <component...> --overwrite -y` 中批量生成，避免逐文件手写。
  - **registry 取舍**: 优先官方 shadcn/Base Nova registry；不要引入另一套 Radix、Arco、Ant Design 或 MUI primitive。第三方 registry 必须适配现有 Base UI、主题和公共 API，不能带入第二套底座。
- **组件升级/新增流程**（在 `apps/frontend/packages/design-system`）:
  1. **必须 Node 24.18.0 环境**（pnpm 11 依赖 `node:sqlite`；用 `mise exec -- <cmd>` 或已 `mise activate` 的 shell，否则 CLI 内部 `pnpm add` 会崩/落到错误 store）。
  2. 全量升级使用 `pnpm exec shadcn add --all --overwrite -y`；新增一批组件使用 `pnpm ui:add <component...> --overwrite -y`（或经 shadcn MCP `add`）。两者都集中生成到 `src/shadcn/`，不要逐文件手抄。
  3. 在 `src/shadcn/index.ts` 子 barrel 补一行 `export * from "./<name>";`（主 barrel 自动透传）。Base UI Toast 的命令式 `toast` 与 `Toaster` 也从该公共入口导出。
  4. `mise exec -- pnpm -F @repo/design-system typecheck` + 受影响 app `typecheck` + `pnpm -F platform build`。
  5. 新 MFE 通过 admin 应用注册中心登记 `base_path`、`remote_name`、`./routes` 与 manifest `entry`；platform 无需静态改源码。
- **MFE 路由契约**: platform 是唯一 `RouterProvider`。remote 的 `./routes` 命名导出相对 `RouteObject[]`，页面入口按 `route.lazy` 约定命名导出 `Component`；禁止 remote 再建 router 或调用 `useRoutes`。

### React Compiler（build-time 自动记忆化，已启用）

- **原生 SWC 路线，无 Babel**: Rspack **≥ 2.2** 把 React Compiler 用 Rust 移植进 `builtin:swc-loader`，通过 `jsc.transform.reactCompiler` 开启。统一封装在 `@repo/build-config/rspack` 的 `createSwcRule({ reactCompiler })`，四个 app 均以 `createSwcRule({ reactCompiler: { target: "19" } })` 接入——**别再各自内联 swc rule**。React 19 原生包含 compiler runtime；禁止重新加入 `react-compiler-runtime`。
- **模式**: 默认 `infer`（全量自动记忆化）；`panicThreshold` 默认 `none`——违反 Rules of React 的文件会被**安全跳过**、不炸构建。若要单文件退出用 `"use no memo"`，单文件强制用 `"use memo"`。
- **约束**: 记忆化正确性依赖遵守 Rules of React（不要在渲染期 mutate props/state、hooks 只在顶层调用）。新组件若出现 stale/异常，先怀疑规则违背，用 `"use no memo"` 临时隔离再修。
- **版本**: `@rspack/core`/`@rspack/cli` ≥ `2.2.7`；Module Federation Enhanced ≥ `2.9.1`。React 及其 JSX runtimes、React DOM 均保持 `^19.0.0` strict singleton；勿降回旧基线或允许 remote 打包 fallback React。

### TypeScript 7（原生检查器双轨过渡）

- `@typescript/native` 固定原生 TypeScript 7，负责所有 `typecheck`；各包脚本显式调用 `node_modules/@typescript/native/bin/tsc`，不得改回不确定来源的裸 `tsc`。
- `typescript` 5.x 暂时只服务仍依赖旧编程 API / peer range 的 Module Federation、Orval / TypeDoc、shadcn 等工具，不负责仓库类型检查；上游兼容稳定 API 后直接删除旧版本。
- 普通 TS package 不得直接声明旧 `typescript`；每个含 TS 源码的 workspace package 必须提供独立 TS7 `typecheck`。只有承载明确旧 API / peer 消费者的 package 可保留 TS5。
- 共享编译选项只维护在 `packages/typescript-config/base.json`。所有 app/package 必须声明 `"@repo/typescript-config": "workspace:*"` 并从包名继承；禁止用跨目录相对路径继承根 `tsconfig.base.json`，否则从 pnpm `node_modules` 符号链接进入时会解析到错误目录。
- TS7 不支持 `baseUrl`；`paths` replacement 必须以 `./` 开头，并相对声明它的项目 `tsconfig.json`。浏览器代码不要依赖默认注入的 Node 全局类型，计时器使用 `ReturnType<typeof setTimeout>`。
- VS Code / Cursor 使用微软 `TypeScriptTeam.native-preview` 扩展，并在编辑器设置中启用 `js/ts.experimental.useTsgo`。

### Code style

- Oxfmt + Oxlint use the repository root configs; the default line width is 120.
- Components: PascalCase, ≤ 250 LoC, no default exports in libs
- ESM public APIs: named exports only. Private lazy chunks may default-export the component loaded by `React.lazy`;
  React Router lazy entries export `Component`, and Module Federation route entries export `routes`.
- Hooks: `use*`, named exports only
- Types: no `any`, prefer `unknown` + narrow
- Styles: Tailwind utilities from the `@repo/design-system` theme; avoid arbitrary values

## Commands (from `apps/frontend/`)

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `just dev platform` | Start platform only (port 3000)              |
| `just dev <mfe>`    | Start a single MFE (port from PORTS map)     |
| `just dev-all`      | Start platform + all MFEs (heavy)            |
| `just lint`         | Oxlint + Oxfmt check + TS7 typecheck + boundaries |
| `just boundaries`   | Package dependency-tag rules only            |
| `just fmt`          | Oxfmt rewrite (auto-run, no need to ask)     |
| `just gen-client`   | Regen `@repo/api` from `schemas/openapi/`    |

## Size limits

- ≤ 250 LoC per component file
- ≤ 400 LoC hard ceiling — split if exceeded

## Forbidden zones for agents

- `packages/api/generated/**` — codegen output
- `dist/`, `.rspack/`, `node_modules/`

## Done checklist

1. `just lint` (includes typecheck + `turbo boundaries`)
2. `just test <workspace>` for affected behavior
3. `just fmt` only when formatting actually drifted — not after every edit
4. `pnpm -F <app> build` to verify the MF artifact is valid

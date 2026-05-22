# Frontend Monorepo — Micro-frontends (Module Federation 2.0)

React 18 + TypeScript + Tailwind + Rspack + Module Federation 2.0.

## Architecture

```
platform (host @ :3000)
  ├── /login                — auth (host-only)
  ├── loads → admin         (remote @ :3001)  routes: /platform/admin/*
  ├── loads → mfe-scene     (remote @ :3002)  routes: /platform/scene/*  (planned)
  └── …                     — new remotes: /platform/<slug>/*
```

**platform owns**: auth, top-level routing, layout, global error boundary, MFE registry.
**Each `mfe-*` owns**: its sub-routes, state, API calls, deploy artifact.

## Import aliases

One alias (see `workspace-aliases.mjs`, `tsconfig.base.json`):

- `@packages` → `packages/`；子路径由 `packages/package.json` 的 `exports` 解析（见 `packages/index.ts`）

各子包 `package.json` 的 `name` 仍为 `shared`、`components` 等（pnpm workspace）；业务与 MF shared 统一写 `@packages/<子路径>`。

## Layout

- `apps/<name>/` — independently deployable MFE
- `packages/components` — sole UI kit (shadcn/ui) + Tailwind v4 theme (`styles.css`)
- `packages/shared` — utils, types, constants
- `packages/runtime` — MFE registry, event bus, auth context
- `packages/auth-client` — JWT, refresh, propagation
- `packages/api-client/<svc>` — typed API per backend service (AUTO-GEN)

## Hard rules

### MFE isolation

- MFEs NEVER import from each other (no cross-imports between `apps/*` remotes)
- MFEs NEVER read each other's state directly
- Cross-MFE communication ONLY via:
  - URL params (preferred)
  - `@packages/runtime` event bus (for transient events)
  - shared backend state (via API)

### Shared package singletons (MF `shared`)

Host provides all runtime-critical shared packages:

- `react`, `react-dom`, `react-router-dom`
- `zustand`
- `@packages/runtime`, `@packages/auth-client`, `@packages/shared`
- `@packages/components`

Remotes consume these from the host with `import: false`; they must not bundle
fallback copies of React, router, platform infra, or the shared UI kit. MFE
remotes are independently deployed asset bundles, but platform is the only
user-facing entry.

### API calls

- ALWAYS via `@packages/api-client/<service>` (typed, auto-generated)
- NEVER raw `fetch()` in MFE code
- Error handling via shared `useApiError()` hook from `@packages/shared`

### shadcn / Tailwind v4

- **Tailwind v4 + theme**: `packages/components/src/styles.css` (`@import "tailwindcss"`, `shadcn/tailwind.css`, `@theme` + sidebar tokens)
- **Build**: **platform host only** — `@tailwindcss/webpack` in `rspack.shared.mjs`; `main.tsx` imports `@packages/components/src/styles.css`（别名走目录，CSS 需带 `src/`）
- **@source** in `styles.css`: `apps/*/src/**/*.{ts,tsx}` + `packages/components` only (not shared/runtime/api-client)
- **MFE remotes**: no PostCSS; no CSS import — use platform-injected styles
- **@packages/components**: MF-shared singleton provided by platform; remotes import it but do not bundle a fallback
- **State**: shared cross-MFE state primitives live in `@packages/runtime`; `zustand` is a host-provided MF singleton, not a per-MFE dependency/version
- **Shell 布局**: platform `Layout` 使用 `Sidebar` + `registry.subNav`；MFE 只渲染内容区（无二次顶栏）
- **全局浮层**: platform `AppProviders` 挂载 `TooltipProvider` + `Toaster`（`toast` 从 `@packages/components` 导出）
- **MFE 内 Provider**: remote 一般不再重复挂全局 `TooltipProvider` / `Toaster`；需要局部 provider 时必须确认它来自 host-shared `@packages/components`
- **表单**: `Form` + `Field` + `react-hook-form` + `zod`；业务页勿手写裸 `Label`+`useState` 校验
- **页面布局**: `Page` / `PageHeader`；加载态用 `Skeleton`
- **组件升级流程**（在 `apps/frontend/packages/components`）:
  1. 确认 `packages/components/components.json` 与根 `components.json` aliases 一致
  2. `pnpm dlx shadcn@latest add <component> --cwd packages/components --overwrite`（若 CLI 报 workspace 错，按 [registry](https://ui.shadcn.com/r/styles/new-york-v4/) 手改并统一 `@packages/shared` 的 `cn` 导入）
  3. `pnpm -F components typecheck` + 受影响 MFE `typecheck` + `pnpm -F platform build`
  4. 新 MFE 在 `registry.ts` 增加 `basePath` + `subNav`，并在 `App.tsx` `remoteApps` 注册 lazy import
- **MF 例外**: remote 的 `./App` 允许 `export default`（Module Federation 约定），与 lib「禁止 default export」无关

### Code style

- Components: PascalCase, ≤ 250 LoC, no default exports in libs
- Hooks: `use*`, named exports only
- Types: no `any`, prefer `unknown` + narrow
- Styles: Tailwind utilities from `@packages/components` theme; avoid arbitrary values

## Commands (from `apps/frontend/`)

| Command             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `just dev platform` | Start platform only (port 3000)                    |
| `just dev <mfe>`    | Start a single MFE (port from PORTS map)           |
| `just dev-all`      | Start shell + all MFEs (heavy)                     |
| `just test <pkg>`   | Vitest, scoped                                     |
| `just lint`         | ESLint + tsc                                       |
| `just fmt`          | Prettier + eslint --fix (auto-run, no need to ask) |
| `just gen-client`   | Regen api-client from `schemas/openapi/`           |

## Size limits

- ≤ 250 LoC per component file
- ≤ 400 LoC hard ceiling — split if exceeded

## Forbidden zones for agents

- `packages/api-client/*/generated/**` — codegen output
- `dist/`, `.rspack/`, `node_modules/`

## Done checklist

1. `just fmt`
2. `just lint`
3. `just test <affected-pkg>`
4. `pnpm -F <mfe> build` to verify MF artifact is valid

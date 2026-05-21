# Frontend Monorepo — Micro-frontends (Module Federation 2.0)

React 18 + TypeScript + Tailwind + Rspack + Module Federation 2.0.

## Architecture

```
platform (host @ :3000)
  ├── loads → admin         (remote @ :3001)  routes: /bots/*
  ├── loads → mfe-scene     (remote @ :3002)  routes: /scenes/*
  ├── loads → mfe-intention (remote @ :3003)  routes: /intentions/*
  ├── loads → mfe-admin     (remote @ :3004)  routes: /admin/*
  └── loads → mfe-portal    (remote @ :3005)  routes: /portal/*
```

**platform owns**: auth, top-level routing, layout, global error boundary, MFE registry.
**Each `mfe-*` owns**: its sub-routes, state, API calls, deploy artifact.

## Import aliases

One alias (see `workspace-aliases.mjs`, `tsconfig.base.json`):

- `@packages` → `packages/`；子路径由 `packages/package.json` 的 `exports` 解析（见 `packages/index.ts`）

各子包 `package.json` 的 `name` 仍为 `shared`、`components` 等（pnpm workspace）；业务与 MF shared 统一写 `@packages/<子路径>`。

## Layout

- `apps/<name>/`              — independently deployable MFE
- `packages/components`       — sole UI kit (shadcn/ui) + Tailwind v4 theme (`styles.css`)
- `packages/shared`           — utils, types, constants
- `packages/runtime`          — MFE registry, event bus, auth context
- `packages/auth-client`      — JWT, refresh, propagation
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
Host + remotes share only **platform infra**:
- `react`, `react-dom`, `react-router-dom`
- `@packages/runtime`, `@packages/auth-client`, `@packages/shared`

**Not** shared (each MFE bundles on demand): `@packages/components`, `radix-ui`, `lucide-react`, etc.

### API calls
- ALWAYS via `@packages/api-client/<service>` (typed, auto-generated)
- NEVER raw `fetch()` in MFE code
- Error handling via shared `useApiError()` hook from `@packages/shared`

### shadcn / Tailwind v4
- **Tailwind v4 + theme**: `packages/components/src/styles.css` (`@import "tailwindcss"`, `shadcn/tailwind.css`, `@theme`)
- **Build**: **platform host only** — `@tailwindcss/webpack` in `rspack.shared.mjs`; `main.tsx` imports `@packages/components/src/styles.css`（别名走目录，CSS 需带 `src/`）
- **@source** in `styles.css`: `apps/*/src/**/*.{ts,tsx}` + `packages/components` only (not shared/runtime/api-client)
- **MFE remotes**: no PostCSS; no CSS import — use platform-injected styles
- **@packages/components**: per-MFE JS bundle (Radix/shadcn), not MF-shared
- CLI: `cd apps/frontend && pnpm dlx shadcn@latest add <name>`

### Code style
- Components: PascalCase, ≤ 250 LoC, no default exports in libs
- Hooks: `use*`, named exports only
- Types: no `any`, prefer `unknown` + narrow
- Styles: Tailwind utilities from `@packages/components` theme; avoid arbitrary values

## Commands (from `apps/frontend/`)

| Command | Purpose |
|---|---|
| `just dev platform` | Start platform only (port 3000) |
| `just dev <mfe>` | Start a single MFE (port from PORTS map) |
| `just dev-all` | Start shell + all MFEs (heavy) |
| `just test <pkg>` | Vitest, scoped |
| `just lint` | ESLint + tsc |
| `just fmt` | Prettier + eslint --fix (auto-run, no need to ask) |
| `just gen-client` | Regen api-client from `schemas/openapi/` |

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

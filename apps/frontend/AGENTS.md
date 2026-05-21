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

## Layout

- `apps/<name>/`              — independently deployable MFE
- `packages/design-tokens`    — Tailwind preset + CSS vars
- `packages/ui-kit`           — base components (Button, Input, Modal, ...)
- `packages/shared`           — utils, types, constants
- `packages/runtime`          — MFE registry, event bus, auth context
- `packages/auth-client`      — JWT, refresh, propagation
- `packages/api-client/<svc>` — typed API per backend service (AUTO-GEN)

## Hard rules

### MFE isolation
- MFEs NEVER import from each other (no `from "@app/admin"` cross-imports)
- MFEs NEVER read each other's state directly
- Cross-MFE communication ONLY via:
  - URL params (preferred)
  - `@app/runtime` event bus (for transient events)
  - shared backend state (via API)

### Shared package singletons
All MFEs and platform declare these as Module Federation `shared: { singleton: true }`:
- `react`, `react-dom`, `react-router-dom`
- `@app/runtime`, `@app/auth-client`, `@app/ui-kit`, `@app/design-tokens`

This prevents duplicate React copies and hook-rules violations.

### API calls
- ALWAYS via `@app/api-client/<service>` (typed, auto-generated)
- NEVER raw `fetch()` in MFE code
- Error handling via shared `useApiError()` hook from `@app/shared`

### Code style
- Components: PascalCase, ≤ 250 LoC, no default exports in libs
- Hooks: `use*`, named exports only
- Types: no `any`, prefer `unknown` + narrow
- Styles: design-tokens / Tailwind utilities; avoid arbitrary values

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

# admin — Bot Management Micro-frontend

Manages the "智能体" domain on the frontend. Backed by `apps/backend/services/admin`.

## Boundaries

- This MFE owns routes under `/platform/admin/*` when mounted by platform
- `http://localhost:3001/` is not a supported page; this app only serves federation assets
- API calls go through `@packages/api-client/admin` ONLY (no raw fetch)
- NEVER import from `mfe-scene`, `mfe-intention`, or any other MFE
- For cross-MFE coordination, use `@packages/runtime` event bus
- Runtime-critical dependencies (`react`, `react-dom`, `react-router-dom`,
  `zustand`,
  `@packages/components`, platform infra packages) are provided by platform via
  Module Federation shared scope; admin must not bundle standalone fallbacks

## Exposes (via Module Federation)

- `./App` — main route component (mounted by platform)
- `./routes` — route config (for future platform-driven routing)

## Layout

- `src/App.tsx` — routes only; **no** local shell (sidebar/nav in platform `Layout`)
- No `src/main.tsx` / `src/index.html`; do not add a standalone or status page
- `src/pages/<Name>Page.tsx` — page-level components
- `src/components/` — local UI components (not shared)
- `src/store/` — admin-private Zustand stores; import `create` / `useShallow` directly from `zustand` packages
- `src/hooks/` — local hooks

## When to extract a component

- Single-use → keep in `src/components/`
- Used by 2+ MFEs → promote to `@packages/components`

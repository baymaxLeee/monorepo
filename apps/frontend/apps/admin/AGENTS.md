# admin — Bot Management Micro-frontend

Manages the "智能体" domain on the frontend. Backed by `apps/backend/services/admin`.

## Boundaries
- This MFE owns routes under `/bots/*`
- API calls go through `@packages/api-client/admin` ONLY (no raw fetch)
- NEVER import from `mfe-scene`, `mfe-intention`, or any other MFE
- For cross-MFE coordination, use `@packages/runtime` event bus

## Exposes (via Module Federation)
- `./App` — main route component (mounted by platform)
- `./routes` — route config (for future platform-driven routing)

## Layout
- `src/App.tsx` — entry; renders sub-routes
- `src/pages/<Name>Page.tsx` — page-level components
- `src/components/` — local UI components (not shared)
- `src/hooks/` — local hooks

## When to extract a component
- Single-use → keep in `src/components/`
- Used by 2+ MFEs → promote to `@packages/components`

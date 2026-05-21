# mfe-bot — Bot Management Micro-frontend

Manages the "智能体" domain on the frontend. Backed by `apps/backend/services/bot`.

## Boundaries
- This MFE owns routes under `/bots/*`
- API calls go through `@app/api-client/bot` ONLY (no raw fetch)
- NEVER import from `mfe-scene`, `mfe-intention`, or any other MFE
- For cross-MFE coordination, use `@app/runtime` event bus

## Exposes (via Module Federation)
- `./App` — main route component (mounted by shell)
- `./routes` — route config (for future shell-driven routing)

## Layout
- `src/App.tsx` — entry; renders sub-routes
- `src/pages/<Name>Page.tsx` — page-level components
- `src/components/` — local UI components (not shared)
- `src/hooks/` — local hooks

## When to extract a component
- Single-use → keep in `src/components/`
- Used by 2+ MFEs → promote to `@app/ui-kit`

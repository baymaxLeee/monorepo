# platform — Module Federation Host

Platform is the host application. It owns:

- Top-level routing (which URL routes to which MFE)
- Authentication (via api)
- Global layout (header, sidebar, footer)
- Global error boundary
- MFE registry (which remote lives at which URL)

## Hard rules

- Platform MUST NOT contain business logic — that belongs in MFEs
- Platform route additions REQUIRE updating `src/registry.ts`
- New MFE remotes must be added to `rspack.config.ts` `remotes` map
- Shared deps in MF config must match across ALL MFEs (use `singleton: true`)
- ESM exports are named by default; route entry modules under `src/pages/<route>/index.tsx` may additionally `export default` the route component for lazy loading.

## URL layout

- `/` (`HOME_PATH`) — platform-owned home page
- `/login` — session check via `LoginRoute`; valid token → admin, else login form
- `/register` — public account registration
- `/profile` — platform-owned user profile page
- `/404` — platform-owned not-found page
- `/platform/<slug>` — each remote (`basePath` in registry, e.g. `/platform/admin`)
- **Guest**: any unknown path → `/login`
- **Authed**: any unknown host path → `defaultAppPath` (admin; sub-routes owned by MFE)
- Sidebar: top-level apps from `registry`; `subNav` for in-MFE pages (e.g. admin 列表 / 组件演示)

## Adding a new MFE remote

1. Add to `rspack.config.ts` remotes
2. Add to `src/registry.ts` with `basePath: "/platform/<slug>"`
3. Register lazy import in `src/App.tsx` `remoteApps`
4. Standalone remote: `BrowserRouter basename` must match `basePath`
5. Remote must expose `./App` (default)

## When to extend the platform vs. extend an MFE

- Platform: authentication, layout chrome, route shell — anything that must be
  identical across all MFEs.
- MFE: anything domain-specific.

Default rule: if you find yourself adding domain logic here, stop and ask.

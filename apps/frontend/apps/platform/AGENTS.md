# platform — Module Federation Host

Platform is the host application. It owns:

- Top-level routing (which URL routes to which MFE)
- Authentication (via api)
- MFE registry (which remote lives at which URL)
- Global error boundary + global providers (TooltipProvider / Toaster)

Platform is a **transparent host**: its `Layout` renders NO global chrome
(no header/sidebar/footer). It only does auth guards, redirects, and page-view
telemetry, then mounts the active MFE. The visible shell is owned per-MFE:
`chat` is the primary shell (sidebar + user area), `admin` is the settings
shell (sidebar with "返回应用" + grouped menu). See `apps/frontend/AGENTS.md`
"Shell 布局". Do not reintroduce a platform-level top bar.

## Hard rules

- Platform MUST NOT contain business logic — that belongs in MFEs
- Platform route additions REQUIRE updating `src/registry.ts`
- New MFE remotes must be added to `rspack.config.ts` `remotes` map
- Shared deps in MF config must match across ALL MFEs (use `singleton: true`)
- ESM exports are named by default; route entry modules under `src/pages/<route>/index.tsx` may additionally `export default` the route component for lazy loading.

## URL layout

- `/` — redirects to `/login`
- `/login` — session check via `LoginRoute`; valid token → landing, else login form
- `/register` — public account registration
- `/select-org` / `/pending` — org onboarding (host-owned)
- `/404` — platform-owned not-found page
- `/platform` — authed shell; index redirects to `/platform/chat` (primary landing)
- `/platform/<slug>/*` — each remote (`basePath` from app registry, e.g. `/platform/chat`, `/platform/admin`)
- Personal pages (个人资料 / 我的可观测数据 / 总览 Dashboard) live inside the
  `admin` settings shell, not platform.
- **Guest**: any unknown path → `/login`
- **Authed**: unknown app slug in `RemoteHost` → `/404` (never the landing, to avoid a redirect loop)

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

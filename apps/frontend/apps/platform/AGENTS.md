# platform — Module Federation Host

Platform is the only browser application entry and the only owner of
`createBrowserRouter` / `RouterProvider`. It owns authentication, top-level
routing, remote discovery, global errors, and global providers.

Platform is a transparent host. Its `Layout` renders no global chrome; each
MFE owns its visible shell. Do not add domain navigation or business UI here.

## Hard rules

- Platform must not contain MFE business logic.
- Remote metadata comes from the admin app registry, not a static frontend map.
- Enabled remotes mount below their registry `base_path` under `/platform/`.
- Remotes expose `./routes` with a named `routes: RouteObject[]` export.
- Route trees are discovered by `patchRoutesOnNavigation`; do not add a nested
  router, `useRoutes`, or a remote `App` component.
- Remote route paths are relative to their registered `base_path`.
- Shared dependencies must stay aligned through `mf-shared.mjs`.

## URL layout

- `/` — redirects to `/login`
- `/login` and `/register` — public account flows
- `/select-org` and `/pending` — organization onboarding
- `/404` — platform-owned not-found page
- `/platform` — authenticated shell, redirecting to `/platform/chat`
- `/platform/<slug>/*` — a registry-backed remote route tree

Unknown public paths resolve to login. Unknown authenticated app paths resolve
to `/404`.

## Adding a remote

1. Scaffold it with `just new-mfe <slug>`.
2. Assign its dev/deployment manifest URL and orchestration port.
3. Register `base_path`, `remote_name`, `./routes`, and manifest `entry` through
   the admin app registry.
4. Add deployment asset routing.

No platform source-code registration is required.

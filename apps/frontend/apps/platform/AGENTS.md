# Platform Module Federation host

Platform is the only browser entry and owner of `RouterProvider`, authentication,
top-level access policy, dynamic remote discovery, global providers/errors and the
stable outer Apps rail.

- Do not place MFE business logic, domain menus or private remote state in Platform.
  Each MFE owns its second-column menu and content region.
- Remote metadata comes from Admin's app registry, never a static frontend map.
  Enabled remotes mount below their registered `/platform/` base path and expose a
  relative named `routes: RouteObject[]` through `./routes`.
- Route discovery uses the host router. Do not add remote routers, `useRoutes` or a
  remote `App` shell. Cross-app launches use URL state rather than private stores.
- `src/auth/` owns credential/session bootstrap, refresh single-flight, login,
  registration, logout, workspace rotation and Desktop session binding. Auth pages
  use these actions rather than generated lifecycle calls directly.
- Platform registers auth capability in `@repo/runtime`; remotes and API transport
  consume it without holding credentials. `@repo/api` owns transport, not identity.
- Shared dependency alignment comes only from `@repo/shared/mf-shared`.

New remotes follow the repository new-MFE playbook and Admin registry contract;
Platform source registration is unnecessary. Run `just test frontend/platform`
and build Platform when routing, auth, federation or global providers change.

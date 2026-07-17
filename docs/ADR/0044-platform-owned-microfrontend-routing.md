# ADR-0044: Platform-owned micro-frontend routing

- Status: Accepted
- Date: 2026-07-17

## Context

Platform already used React Router's data router, while each remote exposed an
`App` component that called `useRoutes`. This produced two incompatible routing
models in one tree:

- the host owned history, authentication, pending UI, and top-level errors;
- a remote interpreted the remaining URL only after its component loaded;
- React `lazy` and `Suspense` loaded components, but did not participate in
  data-router navigation or route discovery;
- direct navigation, client-side navigation, and remote loading followed
  different control paths;
- every new app required static platform source changes despite the database
  already being the application registry.

The result was observable as navigation that changed the URL without reliably
activating the new remote route. It also prevented future apps from using one
coherent loader, action, pending, and error model.

## External alignment

React Router recommends creating a data router outside the React tree and
rendering it through `RouterProvider`:

- <https://reactrouter.com/start/data/installation>
- <https://reactrouter.com/start/data/route-object>

Its `route.lazy` API lazily supplies route implementation keys such as
`Component`, `loader`, `action`, and `ErrorBoundary`. It is available only to
data routers, not a descendant `useRoutes` tree:

- <https://reactrouter.com/start/data/route-object#lazy>

React Router explicitly documents `patchRoutesOnNavigation` for applications
where the full route tree is unavailable up front, including Module Federation
and micro-frontend architectures:

- <https://reactrouter.com/api/data-routers/createBrowserRouter>

React Router 7 route middleware is the official Data Mode primitive for
authentication and other cross-cutting navigation policy. Typed router context
passes the resolved identity to nested middleware and loaders:

- <https://reactrouter.com/how-to/middleware>

React's `lazy` remains appropriate for component-level code splitting, but it
does not add data-router semantics:

- <https://react.dev/reference/react/lazy>

## Decision

Platform is the sole owner of `createBrowserRouter` and `RouterProvider`.

Each remote exposes `./routes` from `src/router/index.tsx` with the contract:

```ts
export const routes: RouteObject[] = [...];
```

The route objects use paths relative to the application's registered
`base_path`. Lazy route modules use React Router's named exports, especially
`Component`, instead of React component default exports.

On navigation below `/platform`, platform:

1. resolves the IAM session before accessing the protected app registry;
2. lets the platform route middleware redirect anonymous users to `/login`;
3. loads the current user's application metadata once for the document;
4. chooses the longest matching registered `base_path`;
5. registers the remote manifest once with Module Federation;
6. loads and validates the exposed route module;
7. patches it beneath the platform route with `patchRoutesOnNavigation`;
8. checks the discovered app's access policy against the current session in
   the app route middleware.

Route discovery does not throw redirects: React Router treats exceptions from
`patchRoutesOnNavigation` as discovery errors. A static platform splat keeps a
valid route match while discovery is pending, then the platform middleware
performs the redirect through the data-router response path. Session resolution is
shared within one navigation so discovery and middleware do not race each other.

Public authentication routes use guest-only middleware. Onboarding routes use
named access-policy middleware. Route components never bootstrap sessions or
decide their own initial authentication redirect.

Remote routes and registry topology are cached for the document lifetime.
`patchRoutesOnNavigation` never clears discovered routes, repeats remote
registration, or forces a registry refresh. Module Federation registration does
not use `force`, because overriding an already loaded remote invalidates its
module cache without replacing React Router's already patched route subtree.

The app route middleware evaluates the cached app policy against the current
session, so privilege loss cannot grant access to an already discovered route.
Newly visible apps and registry topology changes take effect after a full page
refresh; runtime route replacement is not supported by the additive patch API.

Session middleware preserves the existing user object when persisted session
data is unchanged and does not rewrite platform state on every navigation.
Platform route telemetry lives in a renderless location observer below the
stable host layout, so page-view collection does not make the layout subscribe
to child-route state.

The former `./App`, remote `useRoutes`, nested router, static platform remote
map, and compatibility adapter patterns are not supported. Existing demo and
production seed wiring is migrated directly to `./routes`.

## Consequences

- Direct loads, browser history, redirects, client navigation, loaders,
  pending UI, and route errors use one router state machine.
- Anonymous deep links reach `/login` without requesting protected registry or
  remote-module resources.
- A new app is registered operationally through the admin registry and
  deployment asset routing; platform source code does not change.
- Remotes retain ownership of their local route tree and visible shell without
  owning browser history.
- Child-route navigation only reconciles the matching outlet and its renderless
  telemetry observer; it does not reinitialize platform state or remount the
  host layout.
- Registry CRUD does not mutate the running router. Operators refresh the page
  to start a new topology snapshot.
- A malformed or unavailable remote route module fails through the platform
  error boundary instead of silently rendering an unmatched subtree.
- Remote route IDs must be globally unique. The scaffold prefixes IDs with the
  app slug.
- The refactor is intentionally incompatible with remotes or registry rows
  that still expose `./App`.

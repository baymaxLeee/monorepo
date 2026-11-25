# Frontend applications and packages

React 19, TypeScript, Tailwind and Rspack applications live here. For UI,
design-system, primitive or overlay work, read root [DESIGN.md](../../DESIGN.md)
before editing. The [frontend decision](../../docs/ADR/frontend.md) owns current
architecture. Use root `just` commands and start with `just context <path>`.

## Application and package boundaries

- Platform is the only browser entry, `RouterProvider`, authentication boundary
  and dynamic remote loader. Each remote owns its relative route tree, local shell,
  state, API use and deploy artifact.
- MFEs never import one another or read another app's private state. Coordinate
  through URL state, `@repo/runtime` events or authoritative backend state.
- `turbo.json` tags enforce the dependency direction:
  `app -> feature/ui/data/runtime/util`, `feature -> ui/data/runtime/util`,
  `ui -> ui/util`, `data -> runtime/util`, `runtime -> util`. Nothing depends on
  an app. Every new package must declare its tag.
- Consume workspace packages by their real `@repo/*` name and declare
  `"workspace:*"`. Export public APIs through `package.json#exports`; never import
  another package's `src/` implementation. Keep heavy capabilities behind public
  subpaths instead of the main barrel.

## Runtime, routing and data

- Platform provides only identity-critical Module Federation singletons: React,
  Router, query/state runtime and repository runtime infrastructure. Remotes must
  not bundle fallbacks for those packages. UI and API capabilities remain ordinary
  tree-shakeable workspace dependencies. The exact list is owned by
  `@repo/shared/mf-shared`.
- Remotes expose `./routes` as a named relative `RouteObject[]`; lazy route modules
  export `Component`. Do not create a remote router, call `useRoutes` or add a
  standalone remote page.
- Ordinary HTTP uses generated clients through `@repo/api`; its single transport
  owns auth refresh and default error notification. Streaming, blob, redirect and
  other raw protocols use only the narrow runtime helpers owned by that package.
  Do not duplicate global error toasts in business code.
- Platform owns credentials and registers the auth capability in `@repo/runtime`.
  Remotes consume the capability without importing Platform or persisting tokens.

## UI and build ownership

- Root `DESIGN.md` owns visual, accessibility, layout and overlay conventions.
  Design-system registry and primitive work follows the closest
  [`design-system/AGENTS.md`](packages/design-system/AGENTS.md).
- Platform loads the single global Tailwind/theme entry. Remotes do not create a
  second Tailwind/PostCSS pipeline; component-owned CSS and third-party styles stay
  with their owner or lazy entry.
- Shared TS, Rspack, Module Federation and browser-capability rules live in the
  closest [`shared/AGENTS.md`](packages/shared/AGENTS.md). Use installed
  configuration as fact; do not copy tool versions or compiler settings into apps.
- AI components use official AI SDK message/tool/file/source parts and existing
  AI Elements compositions. Custom Chat stream parts follow
  [`schemas/streaming/chat-uimessage-stream.md`](../../schemas/streaming/chat-uimessage-stream.md).

## Generated clients

Generated API modules are read-only. Change the backend contract and run root
`just sync`; follow [`packages/api/AGENTS.md`](packages/api/AGENTS.md) for transport
exceptions and public imports. Do not add handwritten REST facades or copied DTOs.

## Verification

Run `just test frontend/<workspace-name>` or the target reported by `just context`;
use `just test-affected HEAD frontend --list` to preview affected suites. Run
affected typechecks and `turbo boundaries`; build an app when its federation
entry, bundler configuration, global CSS input or emitted assets change.

Vitest is the frontend unit/component runner. Use explicit Vitest imports, React
Testing Library for interaction and accessibility queries for assertions. Unit
tests do not replace TS7 typechecking, Rspack builds, federation integration or
necessary rendered interaction checks. Shared testing policy lives in
[testing.md](../../docs/开发规范/testing.md).

Use the root Oxc configuration; do not add ESLint/Prettier. Apply scoped format or
lint fixes explicitly and inspect the diff. Never hand-edit generated clients,
`dist/`, `.rspack/` or dependencies under `node_modules/`.

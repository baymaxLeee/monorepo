# Shared frontend infrastructure

This package owns portable browser utilities plus the public build-time
`/typescript-config`, `/rspack` and `/mf-shared` entries. Browser code must not
import build-time subpaths.

- `typescript-config.json` is the frontend TS7 baseline. Apps/packages inherit it
  through `@repo/shared/typescript-config`; do not add a competing base config or
  rely on ambient Node globals in browser source.
- `config/rspack.mjs` owns SWC, React Compiler and host/remote CSS rules. Apps call
  its factories instead of copying loaders. Installed source and manifests own
  versions and compiler options.
- `config/mf-shared.mjs` is the Module Federation singleton authority. Keep React,
  Router and identity-critical runtime packages aligned; do not make UI/API
  capability packages host singletons.
- Platform alone builds the global Tailwind entry. Remote rules handle only
  component-owned or third-party CSS.
- Browser business code uses `randomId()` rather than direct `randomUUID`; only
  capability-tested fallback implementations may hold a narrow exemption.
- The root runtime export stays browser-safe. Node configuration helpers remain in
  explicit subpaths.

Run `just test frontend/@repo/shared`, affected app typechecks and builds, and
`turbo boundaries` after changing public exports or build configuration.

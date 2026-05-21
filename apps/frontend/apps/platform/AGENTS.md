# platform — Module Federation Host

Platform is the host application. It owns:
- Top-level routing (which URL routes to which MFE)
- Authentication (via @app/auth-client)
- Global layout (header, sidebar, footer)
- Global error boundary
- MFE registry (which remote lives at which URL)

## Hard rules
- Platform MUST NOT contain business logic — that belongs in MFEs
- Platform route additions REQUIRE updating `src/registry.ts`
- New MFE remotes must be added to `rspack.config.ts` `remotes` map
- Shared deps in MF config must match across ALL MFEs (use `singleton: true`)

## Adding a new MFE remote
1. Add to `rspack.config.ts` remotes
2. Add to `src/registry.ts` with route prefix and metadata
3. The MFE must expose `./App` (default) and `./routes` (lazy-routed config)

## When to extend the platform vs. extend an MFE
- Platform: authentication, layout chrome, route shell — anything that must be
  identical across all MFEs.
- MFE: anything domain-specific.

Default rule: if you find yourself adding domain logic here, stop and ask.

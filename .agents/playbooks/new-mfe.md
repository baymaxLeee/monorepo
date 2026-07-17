# Playbook: New micro-frontend

Use `just new-mfe <name>` to create `apps/frontend/apps/<name>/`. The generated
remote follows the platform-owned data-router contract; use `admin` and `chat`
as the reference implementations.

## A. Remote skeleton

```
[ ] package.json and tsconfig.json use workspace/catalog versions
[ ] rspack.config.mjs uses uniqueName `mfe_<name>` and exposes `./routes`
[ ] src/router/index.tsx exports named `routes: RouteObject[]`
[ ] src/pages/<route>/index.tsx exports the named `Component` used by route.lazy
[ ] AGENTS.md records the domain and route ownership
[ ] Dockerfile is added when the deployment profile builds a separate image
```

The remote must not create `BrowserRouter`, `RouterProvider`, or call
`useRoutes`. All paths in the exposed route tree are relative to the app's
registered base path. The platform owns navigation, pending UI, error handling,
and runtime route discovery.

## B. Registry and host integration

Create the application through the admin app registry:

```
base_path:   /platform/<name>
remote_name: mfe_<name>
expose_key:  ./routes
entry:       /mfe-<name>/mf-manifest.json
```

No static platform registry, import declaration, or build-time `remotes` entry
is needed. The platform fetches enabled apps, registers their manifests with
Module Federation, and patches the selected route tree on navigation.

Use `requires_admin` for coarse app access. Domain-specific authorization stays
inside the remote and its backend.

## C. Development orchestration

```
[ ] choose a unique port
[ ] add the remote process to Procfile.dev
[ ] update root justfile dev-urls output
[ ] update relevant dev scripts or port maps
```

The remote dev server only serves federation assets. Its root URL is not a
supported business page; verify the app through platform.

## D. Backend API client, when needed

```
[ ] add or reuse the service OpenAPI schema under schemas/openapi/
[ ] update apps/frontend/packages/api generation config and exports
[ ] run just sync
```

Frontend/backend coupling must go through generated schemas. Do not use raw
fetch for ordinary service APIs.

## E. Deployment

```
[ ] add k8s resources and overlay references for independently deployed remotes
[ ] add single-VPS build output and nginx /mfe-<name>/ asset routing
[ ] add the app-registry production seed where the deployment needs bootstrap data
[ ] update affected image-build and deployment workflows
```

## F. Documentation and verification

```
[ ] update docs/微前端/index.md and domain documentation
[ ] just install
[ ] just sync
[ ] just lint
[ ] just build <name>
[ ] just build platform
[ ] just dev, then navigate directly and client-side to /platform/<name>
```

During the demo phase, do not add test scaffolding. Do not run `just fmt` unless
formatting is explicitly required; fix scoped formatter findings instead.

## Hard rules

- Never import another MFE.
- Use the `runtime` event bus for cross-MFE coordination.
- Use `api` for backend calls.
- Keep page-only business components inside the page directory.
- The admin app registry is the only source of remote entry metadata.

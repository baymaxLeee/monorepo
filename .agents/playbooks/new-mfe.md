# Playbook: New micro-frontend

For adding a new MFE under `apps/frontend/apps/<name>/`.

## Steps

```
[ ] 1. Scaffold:
       ./scripts/new-mfe.sh <name>

[ ] 2. Configure Module Federation:
       apps/frontend/apps/<name>/rspack.config.ts
       - name: <name_snake>
       - filename: remoteEntry.js
       - exposes: { "./App": "./src/App.tsx", "./routes": "./src/routes.ts" }
       - shared: react, react-dom, @app/runtime, @app/ui-kit (singletons)

[ ] 3. Register in shell:
       apps/frontend/apps/shell/src/registry.ts → add entry
       apps/frontend/apps/shell/rspack.config.ts → add to remotes

[ ] 4. Port allocation:
       apps/frontend/justfile PORTS map → add <name>

[ ] 5. Initial UI:
       apps/frontend/apps/<name>/src/App.tsx
       apps/frontend/apps/<name>/src/routes.ts

[ ] 6. Dockerfile + k8s:
       apps/frontend/apps/<name>/Dockerfile
       infra/k8s/base/mfe-<name>/

[ ] 7. CI:
       .github/workflows/deploy-mfe-<name>.yml

[ ] 8. Documentation:
       docs/微前端/<name>.md
       Update docs/微前端/index.md
```

## Hard rules
- Never import from another MFE
- Always use @app/ui-kit components, not raw HTML when possible
- Always use @app/api-client/<svc> for API calls, never raw fetch
- Use @app/runtime event bus for cross-MFE signaling

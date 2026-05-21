# Playbook: New microservice

For adding a new service under `apps/backend/services/<name>/`.

## Prerequisites
- Confirm with user: service name, language (default Python), owns-which-DB

## Steps

```
[ ] 1. Scaffold:
       ./scripts/new-service.sh <name>

[ ] 2. Register in apps/backend/justfile SERVICES list

[ ] 3. Define DB:
       apps/backend/services/<name>/alembic.ini
       First migration: services/<name>/migrations/versions/0001_init.py

[ ] 4. First endpoint:
       services/<name>/src/<name>/routes/health.py with /healthz

[ ] 5. OpenAPI export:
       services/<name>/src/<name>/gen_openapi.py
       Verify: `cd apps/backend && just gen-openapi <name>`

[ ] 6. Dockerfile + k8s base:
       services/<name>/Dockerfile
       infra/k8s/base/<name>/{deployment,service,configmap}.yaml

[ ] 7. CI workflow:
       .github/workflows/deploy-<name>.yml (copy from bot template)

[ ] 8. Documentation:
       docs/微服务/<name>.md (owner, responsibilities, dependencies)
       Update docs/微服务/index.md

[ ] 9. Verify integration:
       just test <name>
       just lint <name>
```

## Anti-patterns
- ❌ Sharing domain models with other services via `libs/`
- ❌ Direct DB access to another service's DB
- ❌ Forgetting to add the service to docker-compose for local dev

# Codegen

Generated client code lives next to consumers, not here.

- TS clients   → `apps/frontend/packages/api-client/<svc>/generated/`
- Python clients → `apps/backend/libs/transport/src/transport/clients/<svc>/`
- Go clients   → `apps/backend/services/api-gateway/internal/clients/<svc>/`

Generators are wired into the relevant `justfile`:

- TS:    `cd apps/frontend && just gen-client`
- Python+Go (proto): `cd apps/backend && just gen-proto`
- All:   `just sync` (from repo root)

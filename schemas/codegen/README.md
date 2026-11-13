# Codegen

Generated client code lives next to consumers, not here.

- TS clients   → `apps/frontend/packages/api/src/<svc>-server.ts`
- S2S TS clients → `apps/backend/libs/transport-ts/src/schema/`
- Python clients → `apps/backend/libs/transport/src/transport/clients/<svc>/`
- Go clients   → `apps/backend/services/gateway/internal/infrastructure/clients/<svc>/`

Generators are wired into the relevant `justfile`:

- TS:    `cd apps/frontend && just gen-client`

Frontend REST clients are generated directly from `openapi/`; no runtime or API
templates sit under `schemas/codegen/`. Auth/SSE/blob code lives explicitly in
the frontend API package and must not redeclare ordinary REST operations or wire
types.
- Python+Go (proto): `cd apps/backend && just gen-proto`
- All:   `just sync` (from repo root)

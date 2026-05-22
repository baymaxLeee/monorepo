# api — Unified Frontend API Package

Owns all frontend-to-backend HTTP access.

## Architecture

- Runtime HTTP client: `src/http.ts` (axios instance, same-origin base URL,
  credentials, auth header injection, 401 refresh retry)
- Auth/session APIs: `src/session.ts`
- Domain wrappers: `src/<service-name>.ts` (for hand-written demo wrappers)
- Generated SDKs: `generated/<service-name>/` (produced from OpenAPI; do not
  hand-edit generated files)
- Codegen config: `orval.config.ts`

## Contract Flow

Source of truth is local monorepo contracts:

1. Backend exports OpenAPI JSON to `schemas/openapi/<service-name>.json`
2. `cd apps/frontend && just gen-client`
3. Orval generates typed clients under `packages/api/generated/`

Do not make frontend codegen depend on a live Swagger server. Swagger UI is for
humans; local OpenAPI files are for reproducible code generation.

## Rules

- All app/MFE API calls go through `@packages/api`.
- `@packages/api` is the finest-grained public import path. Re-export every
  public API from `index.ts`; do not add `@packages/api/<module>` imports.
- Use gateway-facing paths (`/api/<service-name>/*`), not internal service
  paths.
- Reuse `apiHttp` / `apiMutator`; do not create another axios instance in apps.
- Demo phase: do not add mocks, MSW handlers, test fixtures, or test scripts.

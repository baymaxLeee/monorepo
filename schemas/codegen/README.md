# Code generation

Cross-service contracts are defined in `schemas/proto/` and generated with Buf:

- Go → `apps/backend/libs/inner-api-go/gen/`
- TypeScript → `apps/backend/libs/inner-api-ts/src/gen/`
- Python → `apps/backend/libs/inner-api-py/generated/`

Run `cd apps/backend && just gen-proto`, or root `just sync`. Generated code is
never edited by hand. Service adapters map generated wire messages to local
application contracts; service domain models do not move into shared libraries.

OpenAPI remains the public browser/edge contract. Frontend clients are generated
from `schemas/openapi/`. Admin's public Go HTTP server is design-first and uses
`admin-server-codegen.json` only to prepare the complete canonical Admin document for
`oapi-codegen`; the manifest no longer defines cross-service clients.

Chat → Runtime streaming and Runtime's worker/sandbox role APIs remain explicit
HTTP/SSE adapters because buffering them into unary RPC would change their
streaming or process boundary semantics. They do not use the cross-service
OpenAPI client generator.

The two built-in MCP releases are defined in [the system plugin catalog](../mcp/system-plugins.json). `just sync` packages that catalog with the Admin seed command. Both MCP providers check their live tool inventories against the catalog. Deployment supplies their service URLs before sealing releases.

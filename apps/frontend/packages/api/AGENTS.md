# api — OpenAPI-generated frontend clients

Ordinary HTTP APIs in this package are generated. Never hand-edit `index.ts` or
`src/*-server.ts`; change the backend contract and run root `just sync`.

## Final structure

- `src/<service>-server.ts`: one Orval `axios-functions` output per service,
  containing that service's operations, interfaces and enums.
- `index.ts`: generated service namespaces plus the explicit runtime exports.
- `http.ts`, `orval-mutator.ts`, `auth-fetch.ts`: the single Axios/auth/error
  transport used by every generated operation.
- `chat-stream.ts`, `canvas-stream.ts`, `storage-runtime.ts`, `session.ts`:
  narrowly scoped runtime code for SSE, redirects/blobs/signed URLs and session
  lifecycle that OpenAPI clients do not replace.

There are no API templates and no handwritten REST facades. Do not add a DTO,
enum, endpoint URL, compatibility alias, request wrapper or response reshaper.
For an ordinary request, improve OpenAPI/`operationId` and regenerate. For an
actual stream or byte transfer, use `fetch` and the gateway URL directly.

## Imports

- Import generated APIs from `@repo/api/admin`, `/canvas`, `/chat`, `/iam`,
  `/knowledge`, `/storage` or `/telemetry`.
- Import only runtime transport helpers from `@repo/api`.
- Never import another service through a handwritten aggregator.

## Generation

`just sync` exports local OpenAPI files, deletes each prior `*-server.ts`, runs
Orval, and regenerates `index.ts`. `just sync-check` rejects drift. Generation
never contacts a live Swagger server.

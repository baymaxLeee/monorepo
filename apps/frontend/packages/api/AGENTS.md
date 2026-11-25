# Generated frontend API clients

Ordinary HTTP APIs are generated. Never hand-edit `index.ts` or
`src/*-server.ts`; change the backend contract and run root `just sync`.

- Import generated operations from `@repo/api/<service>` and only runtime transport
  helpers from the package root.
- The shared Axios/auth/error transport is the single ordinary request path. Do
  not add DTOs, endpoint constants, compatibility aliases, request wrappers,
  response reshapers or handwritten service aggregators.
- SSE, stream, blob, redirect/signed URL and similarly raw protocols may use a
  narrowly owned runtime helper when generated OpenAPI operations cannot express
  their behavior. Session lifecycle and credentials remain with Platform.
- `just sync` generates into staging, validates and formats before atomic publish;
  `just sync-check` rejects drift. Generation never reads a live Swagger server.

Run `just test frontend/@repo/api`, affected consumer typechecks and `just sync`
for contract changes.

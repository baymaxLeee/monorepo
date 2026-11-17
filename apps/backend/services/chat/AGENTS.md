# Chat product app

Thin Web Chat product boundary. Runtime owns messages, Turns, Agent execution,
Sandbox and durable Jobs.

- Chat owns only product conversation metadata and the mapping to one Runtime Session.
- Execution, message, file, approval and run routes are authenticated proxies to Runtime.
- Never add model, tool, Sandbox, Workflow or run-journal code here.
- Cross-service creation uses Runtime idempotency and a durable local mapping.

Go entry points are `cmd/server/main.go` and `cmd/openapi/main.go`. Keep HTTP
wiring in `internal/api/http`, orchestration and wire projection in
`internal/application`, and PostgreSQL/Runtime adapters in
`internal/infrastructure`.

Run `just test backend/chat` and `just build chat`.

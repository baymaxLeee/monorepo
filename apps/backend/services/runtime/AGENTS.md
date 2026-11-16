# Runtime app

Execution kernel for Web Chat, Desktop, Canvas and future hosts. Read
[`docs/ADR/session-runtime.md`](../../../../docs/ADR/session-runtime.md) before changing lifecycle or role boundaries.

- Session/Turn/Item/Job/workspace execution facts belong here; Web product presentation stays in Chat.
- `ToolLoopAgent` is the only interactive loop. A Turn is never a Workflow run.
- Ordinary tools and artifacts run inline through Sandbox. Workflow is only for detached durable Jobs.
- API admission and Agent claims use committed state; detached jobs cross to the worker through the internal Runtime role contract.
- Idempotency lookup precedes state conflicts. Same key with different normalized input fails closed.
- A Session has at most one active Turn. Activation and Agent outbox insertion are one transaction.
- Worker writes are fenced by attempt epoch; process loss does not prove the old writer stopped.
- Runtime business tables never query Workflow World tables. Sandbox guests receive no business credentials.

Run `just test backend/runtime` and `just build runtime`. Skipped PostgreSQL integration tests are unverified, not passes.

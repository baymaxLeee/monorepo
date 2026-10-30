# Playbook: Cross-service refactor

For changes that touch multiple backend services (e.g. shared library bump,
auth contract change, OTel propagation).

## Warning

Trace every affected consumer. Continue within the user's authorized scope;
ask only for an unresolved product, scope or external-state decision.

## Steps

```
[ ] 1. Identify scope:
       - Which services are affected?
       - Is it a libs/ change or a contract change?
       - Are there in-flight migrations?

[ ] 2. State the target contract before editing. Update the relevant current
       decision topic in docs/ADR/ and its owning specification in place.

[ ] 3. (Optional) Dispatch `explorer` sub-agent:
       "List all callers of libs.X in apps/backend/services/"
       Use compact report to plan

[ ] 4. Order matters:
       a) Build the docs/ADR/architecture.md consumer matrix and decide whether code should be shared
       b) Update the shared contract or capability only when justified
       c) Update every consumer; for persisted data use expand/backfill/verify/contract migrations
          Preserve old paths until deployment compatibility and rollback windows allow removal

[ ] 5. Per service:
       cd apps/backend/services/<svc>
       Make minimal change
       Run the service's tests and scoped lint/build checks
       Commit with: `refactor(<svc>): adopt new libs.X API`

[ ] 6. (Optional) Dispatch `reviewer` sub-agent after full diff

[ ] 7. Sync schemas if any OpenAPI/proto changed:
       just sync

[ ] 8. Run root `just lint` and `just build`, then exercise the affected calls
       against the running stack
```

## Strict rules

- **NO** silent breaking changes to `libs/transport/` clients
- **NO** breaking changes to gRPC contracts without proto version bump
- **NO** mixing "refactor" + "feature" in the same commit

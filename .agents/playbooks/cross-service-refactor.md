# Playbook: Cross-service refactor

For changes that touch multiple backend services (e.g. shared library bump,
auth contract change, OTel propagation).

## Warning

This is the **highest-risk** category of change. Default stance: ask before
proceeding. Prefer N small per-service PRs over one mega-PR.

## Steps

```
[ ] 1. Identify scope:
       - Which services are affected?
       - Is it a libs/ change or a contract change?
       - Are there in-flight migrations?

[ ] 2. Write an ADR FIRST:
       docs/ADR/NNNN-<slug>.md must exist before code changes

[ ] 3. (Optional) Dispatch `explorer` sub-agent:
       "List all callers of libs.X in apps/backend/services/"
       Use compact report to plan

[ ] 4. Order matters:
       a) Update libs/ if needed (backward-compatible first)
       b) Update each service consumer
       c) Once all services updated, remove deprecated paths

[ ] 5. Per service:
       cd apps/backend/services/<svc>
       Make minimal change
       just test <svc>
       Commit with: `refactor(<svc>): adopt new libs.X API`

[ ] 6. (Optional) Dispatch `reviewer` sub-agent after full diff

[ ] 7. Sync schemas if any OpenAPI/proto changed:
       just sync
```

## Strict rules

- **NO** silent breaking changes to `libs/transport/` clients
- **NO** breaking changes to gRPC contracts without proto version bump
- **NO** mixing "refactor" + "feature" in the same commit

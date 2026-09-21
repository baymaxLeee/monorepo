# Tenant / Workspace identity

Status: implementing. The user explicitly authorizes a breaking development-environment refactor with no legacy-data or rolling-release compatibility requirement.

Tenant identifies a company. Workspace identifies an organizational working space within that company. IAM owns both identities, membership and the selected session workspace. Org is removed from current application contracts, routes, role names and persistence models. There is no Org/Workspace adapter.

Gateway derives tenant_id and workspace_id from IAM-signed claims, strips caller-supplied identity headers and propagates the verified scope. Business APIs validate scope; tool arguments never grant scope. Chat freezes the authenticated scope in its run context and carries it through Canvas, Admin, Knowledge and Executor calls and durable tasks. Resource identifiers alone are not authorization.

Consumer matrix: IAM owns identity; Gateway verifies/forwards; Admin owns scoped configuration; Canvas owns projects/graphs/assets; Chat owns conversations/runs; Knowledge owns stored content; Executor owns task execution. Each service retains its own persistence and contracts. Shared transport clients carry scope without owning domain data. Frontend session/runtime exposes the same Tenant → Workspace hierarchy and workspace switching.

The agent remains the existing AI SDK ToolLoopAgent. Canvas exposes business tools through internal HTTP contracts; no second agent loop or UIMessage protocol is introduced. Official reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent (context passed to tools). Database scope predicates remain explicit; PostgreSQL RLS is a possible additional enforcement layer, not a substitute for authenticating and propagating scope (https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Apply schema and application changes together. Canvas retains its single initial migration. Existing service migration histories may retain historical SQL names; current code uses only Workspace. No dual reads, legacy routes or token fallback. Existing access tokens must be replaced by login after deployment. Verification covers generated contracts, all affected builds and lint, workspace switching, cross-scope denial and tool/task propagation.

Validation: root lint/build/sync and local up/dev succeeded. HTTP smoke checks passed for tenant creation, multiple workspaces per company, signed-session switching, Canvas/Chat cross-scope denial, Gateway header stripping and mismatched Canvas tenant rejection. IAM identifiers use varchar rather than fixed-width char because padded bootstrap IDs caused session-scope comparisons to fail. Knowledge's pre-existing user-only content endpoints still require a separate scope audit.

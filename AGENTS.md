# Project Monorepo

Repository-wide instructions for coding agents. This file is the entry point;
the closest `AGENTS.md` to the edited file owns stack- and domain-specific
rules. Historical ADRs and plans explain decisions but are not active agent
instructions.

## Repository map

```text
apps/frontend/  pnpm + Rspack micro-frontends
apps/backend/   Python, TypeScript, and Go microservices
schemas/        OpenAPI, Proto, events, and streaming contracts
infra/          deployment and local infrastructure
.agents/        scopes, playbooks, and agent infrastructure
docs/           architecture, ADRs, and conventions
```

## Route before editing

Read only the routes relevant to the task, plus every closer `AGENTS.md` found
while descending into the target directory.

| Task | Required route |
|---|---|
| Frontend UI, design-system, or overlay | `apps/frontend/AGENTS.md` → `DESIGN.md` → closest app/package `AGENTS.md` |
| Frontend app/package (non-UI) | `apps/frontend/AGENTS.md` → closest app/package `AGENTS.md` |
| Backend service/library | `apps/backend/AGENTS.md` → service `AGENTS.md` when present |
| Contracts/codegen | `schemas/AGENTS.md` |
| Infrastructure/deployment | `infra/AGENTS.md` |
| Full-stack feature | `.agents/playbooks/full-stack-feature.md` |
| New microservice | `.agents/playbooks/new-microservice.md` + `docs/微服务/index.md` |
| New micro-frontend | `.agents/playbooks/new-mfe.md` + `docs/微前端/index.md` |
| Cross-service refactor | `.agents/playbooks/cross-service-refactor.md` |
| Plan, design, architecture, review, refactor, or tech selection | `.cursor/skills/plan/SKILL.md` |
| Chat stream or custom `data-*`/`onData` field | `schemas/streaming/chat-uimessage-stream.md` |
| Unclear edit scope | `.agents/scopes/default.yaml` |

## Global hard rules

### Work in one feature context

One full-stack agent owns a feature across both stacks. Sub-agents are limited
to context-free mechanical work, read-only exploration, and fresh-eyes review.
Do not split frontend and backend ownership for the same feature. Follow the
full-stack playbook for cross-stack work.

### Preserve boundaries

- Backend services never import another service's source or access its database;
  use declared transport clients or events.
- Frontend apps never import another app; use URL state, the runtime event bus,
  or backend state.
- Frontend/backend and cross-service contracts live in `schemas/`.
- Shared `libs/` contain infrastructure capabilities, never domain models.
- `admin` owns operator-managed configuration such as tenants, RBAC, feature
  flags, integrations, credentials, bots, and curated skills. Consumers fetch
  and cache it; they do not replicate admin-owned tables.

### Design from evidence

- The `plan` skill is mandatory for design, architecture, review, refactors,
  tech selection, and non-trivial implementation planning.
- Check current primary sources and established implementations before making
  platform or AI-runtime decisions. Do not invent policy, limits, or primitives
  without a product, operational, or official-practice basis.
- Prefer AI-native primitives for AI surfaces and reuse official AI SDK message,
  stream, tool, and artifact parts before creating custom protocol.
- This repository has no legacy-compatibility obligation. Refactor systemic
  problems directly and remove obsolete paths instead of adding shims.

### Restrict browser and computer use

Do not use browser automation or computer-use tools by default. Use persisted
records, logs, source, configuration, tests, and local API responses first.
These UI tools are allowed only when the user explicitly requests them or the
claim can only be verified through rendered layout, real interaction,
accessibility, or browser-only runtime behavior. Never use them to reread data
already available locally, and never expose credentials or unrelated user data.

### Protect public workflows and user work

- Treat root `just` recipes as the public CLI. Renames, moves, port changes,
  environment changes, and workspace changes must update every caller and keep
  affected recipes working.
- Preserve unrelated working-tree changes. Never rewrite, delete, or stage them.
- Do not hand-edit generated files; change their source and regenerate them.
- Do not edit migrations, secrets, `.env*`, generated output, worktrees, or lock
  files unless the task explicitly requires it or the routed instructions say
  how to regenerate them.
- Comments explain only non-obvious constraints and reasons, never routine code.

## Canonical commands

Run from the repository root unless a routed instruction says otherwise.

| Command | Purpose |
|---|---|
| `just install` | Install all dependencies and initialize local examples |
| `just up` / `just down` | Start or stop local infrastructure |
| `just dev` | Start the composed development stack |
| `just build [target]` | Build all or one service/app |
| `just sync` | Regenerate backend contracts and frontend clients |
| `just lint` | Run repository checks |
| `just fmt` | Rewrite formatting; run only when requested or needed |
| `just status` / `just doctor` | Inspect repository and environment health |
| `just new-service <name>` / `just new-mfe <name>` | Scaffold a component through its playbook |

For structural changes, validate the affected install, infrastructure, dev,
build, sync, and lint paths. Do not claim a migration is complete while a public
recipe is broken.

## Definition of done

For rapid local iteration, run only the checks needed for the changed behavior
and reuse passing results until a later edit invalidates them. Follow an
explicit user request to narrow verification or review; state any remaining
unverified gate instead of claiming it passed. Report changes and verification
briefly in the conversation. Do not create a separate validation report or
perform an additional broad review unless the user requests one or a concrete
failure requires it.

1. Run the affected unit/integration tests and add coverage for changed behavior.
2. Run scoped checks, then root `just lint` for repository-wide changes.
3. Run `just sync` after contract changes and verify both producer and consumer.
4. Build every affected service, app, or shared consumer.
5. Update an ADR for new architectural behavior and domain docs for changed
   conventions.
6. For multi-phase or multi-service work, complete the review in
   `docs/ADR/0016-post-implementation-review.md`.

Use Conventional Commits with a scope, for example `feat(canvas): ...` or
`fix(mfe-admin): ...`.

## When stuck

Re-read the closest `AGENTS.md`, then the routed playbook and recent commits in
the same area. Ask the user when the remaining decision changes scope, product
behavior, or external state.

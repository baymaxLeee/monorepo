# Project Monorepo — Multi-agent, Microservices, Micro-frontends

Single source of truth for ALL coding agents (Claude Code, Codex, Cursor, ...).
We use ONLY `AGENTS.md` files — no `CLAUDE.md`, no `.cursorrules`.

## Layout

```
apps/frontend/   pnpm + Rspack, micro-frontends (platform host + mfe-* remotes)
apps/backend/    uv + go.work, microservices (services/* + libs/* kernel)
schemas/        cross-stack & cross-service contracts (OpenAPI + Proto + Events)
infra/          K8s manifests, Dockerfiles, deployment
.agents/        multi-agent infrastructure (playbooks, sub-agents, scope rails)
docs/           ADR, architecture, conventions
```

## Multi-agent philosophy

The most efficient pattern for feature work is **ONE fullstack agent, one
context window, both stacks**. Do NOT dispatch separate "frontend agent" and
"backend agent" for the same feature — sub-agents have independent context
windows; you would lose every cross-stack decision you just made.

Sub-agents (defined in `.agents/subagents/`) are reserved for THREE cases:
1. **Context-free grunt work** — codegen, mass rename, mechanical migration
2. **Fresh-eyes review** — let a sub-agent audit your diff without bias
3. **Read-only exploration** — let a sub-agent dig through code and return
   a compact summary, keeping your main context lean

Switching between frontend and backend is done by `cd`, not by handing off.

For the full feature workflow, see `.agents/playbooks/full-stack-feature.md`.

## How to work in this repo

### Single-feature task (you alone — the default)
- Frontend-only: `cd apps/frontend` then read its `AGENTS.md`
- Backend-only:  `cd apps/backend` then read its `AGENTS.md`
- Cross-stack:   work from root; use `just sync` to bridge

### When in doubt about scope
Read `.agents/scopes/default.yaml` — it tells you which zones are free /
caution / forbidden for unprompted edits.

## Top-level commands (run from root)

These are the **canonical entry points** every contributor (human or agent)
uses. Treat them as the project's public CLI: any refactor / rename / move
MUST keep them working — see "Migration safety" rule below.

| Command | What it does |
|---|---|
| `just install` | Install ALL deps (mise + pnpm + uv + go; copies `.env` from examples) |
| `just up` | Docker (MySQL 8, Redis) + DB bootstrap (`scripts/db-bootstrap.sh`) |
| `just down` | Stop local infra |
| `just dev` | Start full demo stack (gateway + iam + admin svc + platform + admin MFE) |
| `just build [target]` | Build frontend / backend / specific service (target optional) |
| `just sync` | Backend → OpenAPI → frontend TS client regen |
| `just fmt` | Format both stacks (auto-run after edits, no need to ask) |
| `just lint` | Lint both stacks |
| `just status` | Git + service health overview |
| `just doctor` | Environment diagnostics |
| `just new-service <name>` / `just new-mfe <name>` | Scaffold a new service / MFE |

## Universal hard rules

### Project phase: DEMO (overrides everything below)

The project is in the **demo phase**. Until this section is removed, agents
MUST NOT add testing scaffolding of any kind, including:

- Unit / integration / e2e test files (`*_test.go`, `*.test.ts`, `*.spec.ts`,
  `tests/`, `__tests__/`, etc.)
- Test fixtures, mocks, factories, seed data scripts written **for testing**
- pytest / vitest / jest / playwright config; new `just test` recipes;
  CI test jobs
- README sections, ADRs, or playbooks describing how to run tests

`just test` in the "Definition of done" below is **skipped** during this phase.

**Rationale:** demo-phase priority is API/UX surface area and architectural
shape; test infrastructure is a multiplicative cost (test data + mocks + CI
matrices) we will introduce deliberately once the surface stabilizes.

**Override:** if (and only if) the user explicitly asks for tests in a given
task, honor it for that task only — do not generalize it into scaffolding.

### Migration safety: don't break the CLI

The `just` commands above are how everyone (humans, agents, CI, docs, README)
enters the project. **Any rename / move / restructure MUST keep these
commands working** — verify before declaring done:

- `just install` (deps still resolve)
- `just up` (Docker + DB bootstrap still works)
- `just dev` (full stack still boots; ports unchanged)
- `just build` (with no target, and with each affected service/mfe target)
- `just sync` (after backend route or schema changes)
- `just fmt` / `just lint` (after any code change)

Common silent-breakers to watch:

- Renaming a service/mfe directory → update `apps/backend/justfile` SERVICES
  list, `apps/frontend/turbo.json`, `Procfile.dev`, `scripts/dev-*.sh`,
  `scripts/db-bootstrap.sh`, `scripts/new-*.sh`, `infra/k8s/`, all `AGENTS.md`
- Changing a default port → update `justfile` PORTS map, `dev-urls`,
  `.env.example` files, frontend MF `remotes`, gateway upstream config
- Renaming an env var → update **every** `.env.example` AND any script that
  reads it (grep `scripts/` and root `justfile`)
- Moving `scripts/*.sh` → update root `justfile` recipes that call them
- Changing `apps/backend/services/` or `apps/frontend/apps/` layout → update
  `go.work`, `pnpm-workspace.yaml`, `tsconfig.base.json` paths

Quick self-check after any structural change: run at minimum
`just install && just up && just dev` once; if any of them break, the
migration is incomplete.

### Boundaries (NEVER cross these)
- `apps/backend/services/<a>` MUST NOT import from `services/<b>` — use
  `libs/transport/` clients (gRPC/HTTP) or events.
- `apps/frontend/apps/<a>` MUST NOT import from `apps/<b>` — use
  `packages/runtime/` event bus.
- Frontend ↔ Backend coupling goes through `schemas/` ONLY (generated clients).
- `libs/` MUST stay kernel-only: errors, logging, transport, observability,
  auth, audit. **NEVER** add domain models to `libs/`.

### Forbidden zones for unprompted edits
- `**/generated/**` — codegen output
- `apps/backend/services/*/migrations/versions/**` — DB migrations
- `**/.env*` — secrets
- `.worktrees/**`, `.agents/tasks/*/` (except `_template/`)

### Required reads before editing
| Task | Read first |
|---|---|
| New backend route | `apps/backend/services/<svc>/AGENTS.md` + `docs/开发规范/` |
| New micro-frontend | `apps/frontend/AGENTS.md` + `docs/微前端/index.md` |
| New microservice | `docs/微服务/index.md` + `.agents/playbooks/new-microservice.md` |
| Cross-service refactor | `.agents/playbooks/cross-service-refactor.md` |

### Definition of done (every change)
1. `just fmt` (auto-run, do not ask)
2. `just lint` scoped to affected area
3. ~~`just test`~~ — **skipped during demo phase** (see above)
4. If cross-stack: `just sync` and verify both sides build
5. If new behavior: add/update ADR in `docs/ADR/NNNN-<slug>.md`
6. Update relevant `docs/<domain>/index.md` if conventions changed

## Worktree policy

Worktrees are an **escape hatch**, not the default. Use them ONLY when:
- Two independent agent **processes** run simultaneously (e.g. two terminals)
- A background long-running refactor must not block local work
- A/B experimenting with two implementation paths

For in-context multi-agent dispatch (one orchestrator → sub-agents via Task
tool), worktrees are NOT needed because sub-agents execute sequentially within
one process. The `scripts/worktree.sh` helper exists only for the cases above.

## Conventions

- Commits: Conventional Commits with service/mfe scope
  - `feat(bot): add publishing flow`
  - `fix(mfe-scene): correct pagination`
  - `chore(schema): regen clients`
- Branches: `feat/<task-id>-<slug>` or `agent/<task-id>/<subagent>`
- PRs: link to ADR if architectural

## When stuck

1. Re-read this file
2. Read the closest sub-`AGENTS.md` going down the tree
3. Read the relevant playbook in `.agents/playbooks/`
4. Search recent commits in same area for precedent
5. Ask user

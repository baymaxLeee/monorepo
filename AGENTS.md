# Project Monorepo

Python, TypeScript and Go services in `apps/backend/`; React/Rspack micro-frontends
in `apps/frontend/`. Run commands from the repository root.

## Locate the task

Use `just context <path-or-target>` for owner, AGENTS chain, dependencies,
consumers and test command. `just repo-map` lists projects; both support `--json`.
Read only relevant routes and every closer AGENTS file. See the
[CLI usage guide](scripts/README.md#agent-command-guide) for examples and limits.

| Task | Required route |
|---|---|
| Frontend UI/design-system/overlay | [frontend](apps/frontend/AGENTS.md) → [DESIGN.md](DESIGN.md) → closest AGENTS |
| Frontend non-UI | [frontend](apps/frontend/AGENTS.md) → closest AGENTS |
| Backend service/library | [backend](apps/backend/AGENTS.md) → closest AGENTS |
| Contracts/codegen | [schemas](schemas/AGENTS.md) |
| Infrastructure/deployment | [infra](infra/AGENTS.md) |
| Repository scripts/CI/test tooling | [tooling](scripts/AGENTS.md) |
| Architecture/business documentation | [documentation rules](docs/AGENTS.md) → [current specs](docs/index.md) |
| Design/architecture/review/refactor/non-trivial planning | [plan skill](.agents/skills/plan/SKILL.md) |
| Full-stack feature | [full-stack playbook](.agents/playbooks/full-stack-feature.md) |
| New service / MFE | [service](.agents/playbooks/new-microservice.md) / [MFE](.agents/playbooks/new-mfe.md) |
| Cross-service refactor | [refactor playbook](.agents/playbooks/cross-service-refactor.md) |
| Chat stream or custom `data-*`/`onData` | [stream contract](schemas/streaming/chat-uimessage-stream.md) |
| Behavior/config/contract/lifecycle change | [change verification](.agents/playbooks/change-verification.md) |
| Unclear edit scope | [scope guidance](.agents/scopes/default.yaml) |

## Architectural invariants

- One primary agent owns a feature end to end. Helpers are limited to mechanical
  work, read-only exploration and independent review; never split frontend and
  backend ownership of one feature.
- Services never import another service's source or access its database. MFEs
  never import another app. Use declared transports/events, URL state, runtime
  events or backend state.
- Cross-stack and cross-service contracts belong in `schemas/`. Shared libraries
  contain proven infrastructure capabilities, never domain models.
- IAM owns identity, tenants/workspaces, membership and roles. Admin owns scoped
  operator configuration: providers, bots, skills, integrations and app registry.
  Consumers fetch/cache authoritative state rather than replicating owner tables.
- Reuse official AI SDK message, stream, tool and artifact primitives. Verify
  unfamiliar APIs against installed types/source and platform decisions against
  current primary sources. Do not invent limits or orchestration policy.
- Refactor systemic problems directly; there is no legacy-compatibility obligation.
  Preserve user data and unrelated working-tree changes.

## Work and verification

Before behavior edits, trace entry point → implementation → consumers → tests.
State the observable result and protected invariant. Reproduce bugs with a focused
failing test before fixing them; if unavailable, state the gap. Lifecycle,
authorization, concurrency and retry changes need failure/cleanup coverage.

| Command | Purpose |
|---|---|
| `just install` | Dependencies and local examples |
| `just up` / `just down` / `just dev` | Local infrastructure/development |
| `just build [target]` | Build apps/services |
| `just sync` | Regenerate contracts and clients |
| `just test-list` | Targets and missing suites |
| `just test <target> [args...]` | Target tests, e.g. `frontend/@repo/chat` |
| `just test-affected [base] [scope] [--list]` | Dependency-aware tests; HEAD includes local edits |
| `just check-repo` | Project graph and documentation navigation |
| `just lint` / `just check` | Static checks / lint + tests + generated-contract checks |
| `just status` / `just doctor` | Repository/environment health |

After code changes, run affected-target tests and builds. Test infrastructure
changes require root `just test`; repository-wide changes require root `just lint`.
Contract changes require `just sync` and producer/consumer verification. Structural
changes must keep affected install, infra, dev, build, sync and lint recipes
working. Multi-phase/service work follows the
[completion review](.agents/playbooks/completion-review.md).
[Test policy](docs/开发规范/testing.md) owns empty-suite and runner behavior.

Reuse passing checks until affected code changes. Missing dependencies, skipped
tests and absent suites are unverified, never passes. Distinguish tests, lint,
typechecks, builds and integration checks. Report results/gaps briefly, without
a separate validation report. Documentation-only work needs link, command and
consistency checks, not application builds.

## Editing and context discipline

- Root `just` recipes are the public CLI; update every caller when changing them.
- Preserve unrelated edits; never reset, stage or rewrite them.
- Never hand-edit generated output. Do not edit secrets, `.env*`, migrations,
  worktrees or lockfiles unless required by the task or owning routed rules.
- Run `just fmt` only when requested or needed. Comments explain non-obvious reasons.
- Use source, logs, tests and local APIs first. Browser/computer tools require an
  explicit request or a claim only verifiable through rendering/interaction.
- Put rules in the closest AGENTS. Update current architecture/business conventions
  in place through [docs/index.md](docs/index.md). Topic-based ADRs describe current
  decisions; Git preserves prior versions. Old plans/progress notes are opt-in
  history. Do not append conflicting updates to a current specification.
- Ask only when a remaining decision changes scope, product behavior or external
  state. Existing user authorization applies throughout the task.
- Use Conventional Commits with a scope, e.g. `fix(canvas): ...`.

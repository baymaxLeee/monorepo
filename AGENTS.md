# Project Monorepo

Python, TypeScript and Go services live in `apps/backend/`; React/Rspack
micro-frontends live in `apps/frontend/`. Run repository commands from the root.

## Locate and route the task

Start with `just context <path-or-target>` to find the owner, applicable AGENTS
chain, dependencies, consumers and test command. Use `just repo-map` to list
projects; both commands support `--json`. Read only the relevant route and every
closer AGENTS file. See the
[CLI usage guide](scripts/README.md#agent-command-guide) for examples and limits.

| Task | Required route |
|---|---|
| Frontend UI/design-system/overlay | [frontend](apps/frontend/AGENTS.md) -> [DESIGN.md](DESIGN.md) -> closest AGENTS |
| Frontend non-UI | [frontend](apps/frontend/AGENTS.md) -> closest AGENTS |
| Backend service/library | [backend](apps/backend/AGENTS.md) -> closest AGENTS |
| Contracts/codegen | [schemas](schemas/AGENTS.md) |
| Infrastructure/deployment | [infra](infra/AGENTS.md) |
| VPS operations or data recovery | [infra](infra/AGENTS.md) -> [Single-VPS runbook](infra/single-vps/README.md#day-2-operations) |
| Registry mirror failure / domestic publish | [tooling](scripts/AGENTS.md) -> [registry recovery](infra/single-vps/README.md#recover-a-failed-cross-region-mirror) |
| Repository scripts/CI/test tooling | [tooling](scripts/AGENTS.md) |
| Architecture/business documentation | [documentation rules](docs/AGENTS.md) -> [current specs](docs/index.md) |
| Design/architecture/review/refactor/non-trivial planning | [plan skill](.agents/skills/plan/SKILL.md) |
| Full-stack feature | [full-stack playbook](.agents/playbooks/full-stack-feature.md) |
| New service / MFE | [service](.agents/playbooks/new-microservice.md) / [MFE](.agents/playbooks/new-mfe.md) |
| Cross-service refactor | [refactor playbook](.agents/playbooks/cross-service-refactor.md) |
| Chat stream or custom `data-*`/`onData` | [stream contract](schemas/streaming/chat-uimessage-stream.md) |
| Behavior/config/contract/lifecycle change | [change verification](.agents/playbooks/change-verification.md) |
| Unclear edit scope | [scope guidance](.agents/scopes/default.yaml) |

## Repository-wide invariants

- One primary agent owns a feature end to end. Helpers are limited to mechanical
  work, read-only exploration and independent review; never split frontend and
  backend ownership of one feature.
- Services never import another service's source or access its database. MFEs
  never import another app. Use declared transports/events, URL state, runtime
  events or backend state.
- Cross-stack and cross-service contracts belong in `schemas/`. Shared libraries
  contain proven infrastructure capabilities, never domain models.
- IAM owns identity, tenants/workspaces, membership and roles. Admin owns scoped
  operator configuration: providers, skills, integrations and app registry.
  Consumers fetch or cache authoritative state instead of replicating owner tables.
- Agent assembly is not a product or runtime concept. Do not add configurable
  Agents/Bots, factories/profiles, resolved-Agent contracts or per-Agent
  capability selection. Runtime and lower-level harness changes must follow the
  current [Agent Runtime decision](docs/ADR/agent-runtime.md), preserve the single
  AI SDK loop and verify unfamiliar choices against the referenced primary sources.
- Reuse official AI SDK message, stream, tool and artifact primitives. Verify
  unfamiliar APIs against installed types/source; do not invent limits or
  orchestration policy.
- Preserve stored data and deployment compatibility. Database changes follow the
  [migration contract](docs/开发规范/database-migrations.md): append versioned
  migrations, never rewrite applied history or reset data to make an upgrade pass.
- Put narrower rules in the closest AGENTS file. Do not copy owner-specific
  inventories or runbooks into this repository entry point.

## Work and verification

Before behavior edits, trace entry point -> implementation -> consumers -> tests.
State the observable result and protected invariant. Reproduce bugs with a focused
failing test before fixing them; if that is unavailable, state the gap. Lifecycle,
authorization, concurrency and retry changes need failure and cleanup coverage.

Use `just --list` and the [CLI guide](scripts/README.md) for command details.
`just test <target>` verifies one target; `just test-affected HEAD all --list`
previews affected suites. Use `just build <target>` for affected applications,
`just sync` for generated contracts and `just check-repo` for repository and
documentation consistency.

For ordinary code changes, run the tests that cover the change and lint the edited code.
Reuse those results for commit and push while the checked inputs are unchanged.
Add a local typecheck for a changed type boundary or a build when the deliverable
depends on packaging, code generation or build configuration. Remote CI runs the
complete code gate for the pushed SHA. Runner/discovery changes that
can alter every suite require root `just test`; repository-wide quality-policy
changes require root `just lint`; contract changes require `just sync` plus
producer and consumer verification. Multi-phase work follows the
[completion review](.agents/playbooks/completion-review.md).

Reuse passing checks until affected code changes. Missing dependencies, skipped
tests and absent suites are unverified, never passes. Distinguish tests, lint,
typechecks, builds and integration checks. Documentation-only work needs link,
command and consistency checks, not application builds. Review the final diff and
report actual results and gaps without creating a separate validation report.

## Editing and external state

- Preserve unrelated working-tree changes. Never reset, stage, rewrite or delete
  them. Do not hand-edit generated output, secrets or `.env*`; edit migrations,
  lockfiles and worktrees only when the task and owning rules require it.
- Apply fixes explicitly with the owning formatter or `--fix` command, inspect the
  diff and stage again. Do not run broad formatting merely because a commit is next.
- Prefer source, logs, tests and local APIs. Use browser/computer tools only when
  explicitly requested or when a claim requires real rendering or interaction.
- Update the current owning specification in place through
  [docs/index.md](docs/index.md). Git preserves history; do not append conflicting
  overrides or duplicate architecture manuals. Follow
  [ADR instructions](docs/ADR/AGENTS.md) for durable cross-boundary decisions.
- Commit and push only when authorized. Follow the
  [local CI loop](scripts/README.md#local-ci-and-fast-push), use `just push` for
  Git/ref safety and never bypass its failure with raw Git, force or hook
  overrides. Inspect authoritative remote CI for the pushed SHA; a successful
  push does not prove code quality, image publication or deployment success.
- Destructive recovery requires explicit user authorization and the owning
  runbook. Resolve exact targets first; never substitute a broader reset.
- Ask only when a remaining decision changes scope, product behavior or external
  state. Existing authorization remains valid within the agreed task.
- Use Conventional Commits with a scope, for example `fix(canvas): ...`.

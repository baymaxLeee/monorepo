# ADR 0001: Monorepo Structure

**Date**: 2026-05-21
**Status**: Accepted

## Context

We need a repository structure that supports:
- Multiple deployable backend services (microservices)
- Multiple deployable frontend modules (micro-frontends)
- Mixed languages (Python + Go + TypeScript)
- AI-agent-friendly development (single agent context, multi-stack work)
- Independent CI/CD per deployable

## Decision

Use a **meta-monorepo of two sub-monorepos**:

- `apps/frontend/`  — pnpm workspace, Rspack + Module Federation 2.0
- `apps/backend/`   — uv workspace + go.work

Cross-stack coupling lives in `schemas/`, with code generation pipelines.
Shared agent infrastructure lives in `.agents/`.

## Consequences

**Pros**:
- Each sub-monorepo can use its native tooling without compromise
- CI is matrix-aware per service / per MFE
- Clear ownership boundaries map to AGENTS.md hierarchy
- Single `git` keeps cross-stack work atomic

**Cons**:
- Harder to do whole-repo refactors (acceptable: rare event)
- New developers need to understand the nesting (mitigated by README + docs)

## Alternatives considered

- **Single workspace**: rejected; pnpm/uv don't compose well at the same root
- **Polyrepo**: rejected; loses atomic cross-stack PRs
- **Bazel/Buck2**: rejected as premature; revisit at 50+ services

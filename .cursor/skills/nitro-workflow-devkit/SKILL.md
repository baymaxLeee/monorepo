---
name: nitro-workflow-devkit
description: >-
  Diagnoses and fixes known Nitro v3 (beta) build/runtime bugs and pnpm
  monorepo dependency-version conflicts that surface when hosting Vercel
  Workflow DevKit ("use workflow"/"use step") on Nitro inside this repo's
  backend workspace. Use when adding or debugging a Node.js backend service
  built with `nitro build`/`nitro dev` and the `workflow` package, when
  `nitro build` fails with a named-export/interop error, when a built Nitro
  server crashes at boot with MODULE_NOT_FOUND for a package that was never
  called directly, or when TypeScript reports TS2742 ("inferred type cannot
  be named") across two sibling packages that both depend on an `@ai-sdk/*`
  package.
---

# Nitro + Workflow DevKit in this monorepo

Context: `apps/backend/services/executor` is the first (and, as of writing,
only) service using `nitro build`/`nitro dev` + `workflow` (Workflow DevKit)
in this repo. See `docs/ADR/0015-agent-task-executor.md` and
`apps/backend/services/executor/AGENTS.md` for the full story. This skill is
the condensed, actionable version for the next service that hits the same
class of bugs.

## Known bug 1: `nf3`/`@vercel/nft` ESM/CJS interop breaks `nitro build`

**Symptom**: `nitro build` (production bundling) fails with
`SyntaxError: Named export 'nodeFileTrace' not found` (or similar) coming
from `nf3`, a Nitro dependency that wraps `@vercel/nft`.

**Cause**: `nf3` does `import { nodeFileTrace } from "@vercel/nft"` but
`@vercel/nft` ships as CommonJS; that named-export form doesn't reliably
interop through Nitro/rollup's bundling in this version combination.

**Fix**: `pnpm patch` the exact `nf3` version pinned in your lockfile —
change the import to a default-import + destructure:

```js
import __vercelNftPkg from "@vercel/nft";
const { nodeFileTrace } = __vercelNftPkg;
```

The patch lives at `apps/backend/patches/nf3@<version>.patch` and is wired
via `patchedDependencies` in `apps/backend/pnpm-workspace.yaml`. Re-apply the
same patch technique (`pnpm patch nf3@<new-version>`, edit, `pnpm patch-commit`)
if the version drifts and the bug reappears — check first, it may already be
fixed upstream.

## Known bug 2: `nf3` miscalculates `../` depth copying `@vercel/oidc`

**Symptom**: The build succeeds, but the built server crashes at boot with
`MODULE_NOT_FOUND` for something like
`@vercel/oidc/dist/get-vercel-oidc-token.js` — a file your code never
imports directly. It's pulled in transitively by `ai`/`@ai-sdk/gateway`.

**Cause**: `nf3`'s file-tracer computes a relative path to copy vendored
files into the self-contained `.output` bundle. The relative-path depth
calculation is wrong for a package nested this deep inside a monorepo
workspace, so the file lands in the wrong directory relative to where the
built `_runtime.mjs` looks for it. `noExternals: [...]` in `nitro.config.ts`
does **not** fix this — the tracer's copy step runs independently of that
option.

**Fix**: a `postbuild` script that copies the missing files to the exact
(miscalculated) path the built runtime expects. Reference implementation:
`apps/backend/services/executor/scripts/fix-oidc-trace.mjs`, wired as
`"build": "nitro build && node scripts/fix-oidc-trace.mjs"` in
`package.json` — always runs automatically, never a manual step. Adapt the
path-depth constant in that script if the new service sits at a different
nesting depth than `executor`.

**Before assuming this bug is still present**: re-run a clean build first.
Both bugs are specific to a young Nitro v3 beta + this monorepo's nesting
depth, not to Workflow DevKit itself — check if they're still reproducible
whenever `nitro`/`workflow`/`ai` get bumped.

## pnpm monorepo trap: shared lib re-exporting `@ai-sdk/*` types

**Symptom**: `tsc --noEmit` on a service reports
`TS2742: The inferred type of 'X' cannot be named without a reference to
'.pnpm/@ai-sdk+provider@<version>/...'. This is likely not portable.` — for
exported functions that never directly import `@ai-sdk/provider`.

**Cause**: Two sibling services depend on different exact patch versions of
`ai` (or `@ai-sdk/gateway`/`@ai-sdk/openai-compatible`), each of which pins
an exact (non-range) version of `@ai-sdk/provider`. A shared workspace lib
consumed by both (e.g. `@backend/transport-ts/provider-model`) then resolves
yet another physical copy. Non-hoisted pnpm gives each package its own
`node_modules`, so TypeScript sees three *nominally distinct* copies of the
same structural type and refuses to synthesize a portable reference.

**Fix**: add a workspace-wide `overrides` entry in
`apps/backend/pnpm-workspace.yaml` forcing one physical version:

```yaml
overrides:
  "@ai-sdk/provider": "<the newer of the two exact versions in conflict>"
```

Then `pnpm install --no-frozen-lockfile` and re-run `tsc --noEmit` on every
consumer. Verify with:

```bash
find node_modules/.pnpm -maxdepth 1 -iname "@ai-sdk+provider@*"
```

— should show exactly one directory afterward (or all consumers resolving
to it; a stale unused copy in the pnpm store is harmless).

## Cancellation: don't build custom AbortSignal plumbing speculatively

`run.cancel()` (from `"workflow/api"`) was measured to interrupt an
in-flight `"use step"` function within single-digit seconds in this repo's
testing — not "wait for the current step to finish." Do not add a
cancellation-poll mechanism inside step functions without first writing a
real test that starts a task and cancels it mid-flight; you will likely find
Workflow DevKit's own cancellation is already fast enough.

The one real gotcha: the *caller* awaiting `run.returnValue` sees a
`WorkflowRunCancelledError` (import from `"workflow/errors"`, check via
`WorkflowRunCancelledError.is(error)`), not a generic `AbortError`. Classify
on that, not `error.name === "AbortError"`.

## Local dev vs. deployed Workflow World

Local dev should default to Workflow DevKit's filesystem-backed Local World
(leave `WORKFLOW_TARGET_WORLD`/`WORKFLOW_POSTGRES_URL` unset) — it is
sufficient for everything short of multi-replica/crash-recovery testing.
Only wire a real `@workflow/world-postgres` into deployed environments
(`infra/single-vps/docker-compose.prod.yml`, `infra/k8s/base/<svc>/`), never
into the shared root `docker-compose.yml`. See
`.agents/playbooks/new-microservice.md` section G for the general version of
this rule.

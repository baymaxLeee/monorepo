---
name: nitro-workflow-devkit
description: >-
  Diagnoses and fixes known Nitro v3 (beta) build/runtime bugs, Workflow
  DevKit World configuration pitfalls, and pnpm monorepo dependency-version
  conflicts that surface when hosting Vercel Workflow DevKit ("use
  workflow"/"use step") on Nitro inside this repo's backend workspace. Use
  when adding or debugging a Node.js backend service built with
  `nitro build`/`nitro dev` and the `workflow` package, when `nitro build`
  fails with a named-export/interop error, when a built Nitro server crashes
  at boot with MODULE_NOT_FOUND for a package that was never called
  directly, when TypeScript reports TS2742 ("inferred type cannot be named")
  across two sibling packages that both depend on an `@ai-sdk/*` package, or
  when configuring `@workflow/world-postgres` and tasks silently never leave
  the "running" state, or when an env var from `.env` works under `nitro dev`
  but not when running the built server directly.
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

## Local dev vs. deployed Workflow World: prefer parity, don't assume it's overkill

This repo's first instinct was "Local World locally, Postgres World only in
deployed environments" (less container weight for local dev). That was
reverted: local dev now runs the same `postgres` container as every
deployed environment (`docker-compose.yml`, started by `just up`, schema
bootstrapped by `scripts/workflow-postgres-bootstrap.sh`), and Local World is
only a manual fallback (comment out `WORKFLOW_TARGET_WORLD`/
`WORKFLOW_POSTGRES_URL` in `.env`).

**Why parity won here**: bug 3 below (the missing `getWorld().start()` call)
existed for an entire build-out phase without being noticed, specifically
*because* local dev defaulted to Local World and never exercised the
Postgres World code path at all. The moment local dev matched production,
the bug surfaced on the next normal development cycle instead of needing a
dedicated investigation. Weigh this against the extra container/memory cost
before defaulting a new service to Local World "for a lighter `just up`" —
that lightness has a real cost in coverage.

## Known bug 3: Postgres World's queue never starts on this Nitro version

**Symptom**: `WORKFLOW_TARGET_WORLD=@workflow/world-postgres` +
`WORKFLOW_POSTGRES_URL` are set correctly, `npx workflow-postgres-setup` ran
without error, and `POST /tasks`-equivalent calls still return
`"running"` — but tasks never reach a terminal state. No error anywhere.

**Cause**: per Workflow DevKit's own docs (`docs/deploying/world/postgres-world.mdx`
"Starting the World"), setting the env vars alone does **not** start
anything — the graphile-worker queue that actually processes steps only
begins polling once something calls `getWorld().start()`. The docs' Nitro
example wires this via a plugin importing `defineNitroPlugin` from
`"nitro/~internal/runtime/plugin"` — but that subpath is not in
`nitro@3.0.260610-beta`'s own `exports` map (confirm with
`node -e "console.log(Object.keys(require('nitro/package.json').exports))"`),
so the official example fails to resolve at build time.

**Fix**: skip Nitro's plugin system and call `getWorld().start()` directly at
module scope in your Nitro-mounted entry file (the same file that already
does anything else at boot, e.g. `reconcilePendingTasks()` in this repo's
`executor/src/index.ts`):

```ts
import { getWorld } from "workflow/runtime";

if (process.env.WORKFLOW_TARGET_WORLD) {
  void getWorld().start?.().catch((error) => {
    console.error("failed to start workflow world", error);
  });
}
```

Gate it on `WORKFLOW_TARGET_WORLD` being set — calling `start()` against the
default Local World throws `Invalid version string: "bundled"` (harmless if
caught, but pure noise on every local boot; empirically confirmed, the docs
don't mention this).

**Verify it actually worked**, don't just assume the docs are right: run a
real task against a real `@workflow/world-postgres` container end to end and
confirm a row lands in that Postgres database's `workflow_runs` table (e.g.
`psql -c "select count(*) from workflow_runs"`), and that `.workflow-data/`
(the Local World's on-disk marker) is never created. This exact configuration
had previously only been assumed correct from reading documentation, never
tested — it silently would not have worked in production.

## Known bug 4: `nitro dev` loads `.env`, the built server doesn't

**Symptom**: env vars set in `.env` (e.g. `WORKFLOW_TARGET_WORLD`) work under
`pnpm dev` (`nitro dev`) but silently don't take effect when running
`node .output/server/index.mjs` directly — it falls back to whatever the
code's own defaults are, with no error.

**Cause**: `nitro dev` has built-in `.env` loading; the production server
bundle Nitro builds does not carry that behavior over.

**Fix**: use Node's native `--env-file` flag for any script that runs the
built server directly:

```json
"start": "node --env-file=.env .output/server/index.mjs"
```

This doesn't matter for real deployments (`docker-compose.prod.yml`/k8s set
env vars directly, never through a `.env` file), but it matters for anyone
locally testing the production build (`pnpm run build && pnpm run start`) —
without it, that path silently diverges from `nitro dev`'s behavior.

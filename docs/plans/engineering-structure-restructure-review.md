# Post-implementation review — engineering structure restructure

Follows [ADR-0016](../ADR/0016-post-implementation-review.md).  
Plan: `docs/plans/engineering-structure-restructure.md`.

## Checklist

| Check | Result |
|---|---|
| Playbook / plan phases re-read after functional work | Done — Phase 0–4 executed against rewritten plan (Eve rejected; ai-elements kept in packages) |
| Grep for dead callers after rollback | mega-kernel paths removed; `discover-services` / `gen-procfile` / `env-check` removed; frontend justfile no longer calls discovery |
| Production / CI Docker contexts | `build-images.yml` uses service-dir context for gateway/iam — matches restored Dockerfiles |
| Canonical commands | root `just install`, `just up`, `just check` (lint + sync-check), and `just build` pass |
| Speculative limits | Bundle sizes recorded in `docs/baselines/frontend-bundle-2026-08-05.md` as observations only — no hard gates |
| Cross-language / untouched services | Backend architecture migration rolled back; Knowledge OpenAPI no longer drifted from shared auth headers |

## Findings fixed in this pass

1. Frontend justfile still referenced rolled-back `discover-services.sh` — restored static PORTS (dropped ghost `mfe-portal`).
2. Mistaken move of ai-elements into chat app — reverted per updated plan §4.2.
3. Missing machine-checkable service graph — added `services.yaml` + validator (ADR-0060), no generators.
4. Backend capability policy recorded (ADR-0061) so transport-py/auth/persistence are not re-bundled.
5. Duplicate `.agents/service-catalog.yaml` had no callers — deleted instead of retaining a compatibility mirror.
6. Backend justfile retained permission/audit/notification ghost ports — removed; runtime groups and ports now match the seven deployables exactly.
7. Initial validator only compared a subset of local files — expanded to service directories, justfile, Procfile, env bindings, gateway routes, K8s, and Single-VPS.
8. Backend rules, microservice playbook, and scaffold still regenerated nonexistent auth/audit SDKs and test-era steps — aligned with ADR-0060/0061 and demo-phase policy.
9. README and dependency installer retained old app/package/capability names — updated to the actual package graph and commands.

## Runtime evidence

- Fresh review run: `just install` and `just up` pass.
- The full dev stack was already running, so `just dev-preflight` correctly refused a duplicate launch. All seven backend health endpoints (8000/8001/8002/8008/8009/8010/8011), platform login (3000), and admin/chat MF manifests (3001/3005) returned HTTP 200.
- Host `http://localhost:3000/login` renders.
- From the host page context, `fetch` of `http://localhost:3001/mf-manifest.json` and
  `http://localhost:3005/mf-manifest.json` both return 200 with ids `mfe_admin` /
  `mfe_chat`.
- Dev and prod Kustomize overlays render; Single-VPS Compose resolves with validation-only placeholder secrets.
- Authenticated deep-link into `/platform/chat` was not automated (password entry
  blocked in browser tooling); manifests + host boot satisfy the MF load gate.

## Residual / deferred

- `transport-py` deferred until a second Python consumer exists (ADR-0061).
- auth / persistence shared libs deferred (high risk).
- Go OpenAPI / proto retention are separate decisions (plan Phase 4 items 2–3).
- Optional: manual login smoke of `/platform/admin` and `/platform/chat` after remote load.

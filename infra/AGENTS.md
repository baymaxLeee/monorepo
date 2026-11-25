# Infrastructure

This directory owns deployment artifacts for services and MFEs. Follow the
closest runbook for Kubernetes, Single-VPS, images or recovery; do not copy
environment-specific operations into this entry point.

## Deployment invariants

- Service configuration declares `ENVIRONMENT` and fails startup on missing
  production requirements.
- Credentials and managed-database secrets live in Secret resources and are
  injected out of band. Never commit real values or place them in ConfigMaps,
  commands or logs.
- Every database-backed service uses its declared database and login role. Never
  give application containers the Workflow bootstrap superuser. Storage uses its
  current `storage` database/role and environment-specific durable volume names;
  do not restore legacy identities.
- Liveness checks process health only; readiness reflects required dependencies
  and draining. Never tie liveness to PostgreSQL or Redis availability.
- Deployments set resource requests/limits, topology distribution and graceful
  shutdown. Check each workload's actual ServiceAccount and verbs; Runtime's
  sandbox controller uses its dedicated policy.

## Structural changes

New service deployment must update the owning base/overlay or Compose definition,
image mapping, CI/deploy path, configuration/secret injection, probes and service
identity consistently. Follow the new-service playbook and validate the affected
Kubernetes and Single-VPS paths rather than copying an old manifest blindly.

Run `just check-repo` and the affected deployment/config validation. Infrastructure
changes do not prove a release: observe authoritative build, registry, deploy and
health results separately.

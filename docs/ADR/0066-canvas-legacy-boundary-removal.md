# ADR-0066: Remove Canvas legacy platform boundaries

- Status: Accepted
- Date: 2026-09-22

## Context

Canvas now resolves generation providers from Admin, calls provider SDKs at its
outbound adapter, stores artifacts through Knowledge, and receives authenticated
identity from Gateway. The code still exposed names and inactive adapters from
the imported platform's identity, provider-gateway, and artifact services. Those names appeared in
runtime keys, database identifiers, domain types, frontend utilities, comments,
deployment bindings, and an obsolete product manual.

The stale vocabulary obscured the real ownership boundaries. In particular,
Canvas declared a direct identity-service dependency it never called, while its provider and
artifact adapters were named after services that no longer exist in this
monorepo.

## Decision

Canvas uses only the current monorepo boundaries:

- Gateway supplies trusted request identity. Canvas has no direct identity-service binding or
  cleanup callback.
- Admin owns provider configuration and credentials. Canvas calls the selected
  provider through a provider client; generation accounting records generic
  provider calls.
- Knowledge owns staged blobs and durable artifacts. Frontend and backend APIs
  use artifact/storage terminology.
- Canvas-owned topics, cache keys, object namespaces, quota resources, CSS
  classes, drag types, and schema identifiers use the `canvas` namespace.

Existing database installations migrate provider call tables, provider tracing
columns, settlement reasons, platform scope IDs, and quota resource values in
place. Redis and staged-blob keys intentionally cut over without dual reads or
compatibility aliases. Ephemeral legacy entries expire or are recreated.

The obsolete Canvas identity adapters, scope-cleanup path, help route, and imported
manual are deleted. Provider and model type packages are renamed directly; no
legacy import path remains.

## Consequences

- Canvas deployment bindings are Admin, Executor, and Knowledge only.
- Existing durable billing and video-generation rows retain their data under the
  new provider-neutral identifiers.
- In-flight entries under old Redis, task-topic, and staged-blob namespaces are
  not resumed after deployment.
- New code and generated contracts must not reintroduce the removed platform
  vocabulary or dependencies.

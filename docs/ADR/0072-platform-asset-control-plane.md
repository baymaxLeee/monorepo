# ADR 0072: Platform Asset Control Plane

**Date**: 2026-09-24  
**Status**: Accepted  
**Supersedes in part**: ADR-0019, ADR-0052, ADR-0054, ADR-0065  
**Related**: ADR-0016, ADR-0050, ADR-0055, ADR-0060, ADR-0061, ADR-0064, ADR-0071

## Context

The platform stores the same class of durable resource through several unrelated
lifecycles:

- Chat user attachments and Agent-authored Markdown and HTML are Knowledge
  documents whose source bytes are deleted after their metadata;
- generated image, audio, and video bytes use Knowledge staged-media and
  document paths;
- Canvas owns an asset/reference ledger and garbage collector while Knowledge
  owns its physical bytes through a Canvas-specific object API;
- Admin skill files live as database text today, while imported ZIP archives
  and future managed files have no platform storage lifecycle;
- provider-hosted file and skill copies are external effects with independent
  expiry and deletion semantics.

This fragmentation makes identity, quota, retention, malware and media
validation, signed delivery, lineage, audit, and deletion reliability depend on
which product surface created the bytes. It also produced a concrete crash
window in Knowledge: document metadata can commit as deleted before object
deletion responsibility is durably recorded. Canvas contains the most mature
local design, but moving its domain model into every service or into a shared
library would create several competing ledgers rather than one platform view.

The product has no legacy-compatibility requirement. A platform-level boundary
is therefore preferable to extending Knowledge's historical object-store role.

## Evidence and prior-art alignment

- The migrated Multix Asset ledger treats reference counts only as scan hints,
  rechecks authoritative ownership before both soft and physical deletion, and
  keeps storage charged until external deletion is confirmed. Those safety
  properties remain required.
- Kubernetes separates owner facts from an asynchronous garbage-collection
  controller and uses finalizers to retain deletion responsibility while
  cleanup is outstanding.
- The transactional outbox pattern requires the business database to persist an
  effect intent in the same transaction as its state change; delivery is
  at-least-once and consumers must be idempotent.
- Object-store lifecycle policies can expire staging objects, old versions, and
  incomplete multipart uploads. They cannot determine whether a Canvas node,
  Chat message, Knowledge document, or Admin skill still owns content.
- The installed AI SDK 7.0.111 exposes the official `FileUIPart`
  (`mediaType`, optional `filename`, `url`) and provider Files/Skills APIs with
  provider references and optional expiry. Platform assets map to those
  primitives; no custom `data-asset` UIMessage part is introduced.

## Decision

### 1. Separate the Asset control plane from its storage adapter

`asset` is the internal platform Asset Control Plane and the only application
service that accesses durable file bytes. The initial production storage adapter
is a local filesystem on a dedicated persistent volume. S3-compatible or cloud
object storage is an optional future adapter, not a deployment dependency. Asset
is the only service allowed to allocate physical locators, authorize byte
transfers, and decide when canonical objects may be removed; ordinary product
services never receive filesystem paths, storage credentials, bucket names, or
object keys. Asset owns:

- logical Asset identity and immutable Revisions;
- content-addressed Blob metadata and private physical locators;
- upload sessions, byte validation, checksums, and promotion;
- cross-service Claims and revision pins;
- derived-asset Lineage;
- provider Replicas and their expiry/deletion state;
- storage usage ledger and lifecycle policy assignment;
- signed/capability upload and delivery;
- garbage collection and durable external-effect jobs.

With the filesystem adapter, uploads and downloads stream through Asset without
buffering the whole payload. Uploads are written to a temporary file on the same
volume, bounded and hashed while streaming, then atomically renamed into the
content-addressed canonical path. Asset supports HTTP range reads, conditional
responses, and cancellation-aware streaming. A later S3 adapter may replace the
transport with narrowly scoped presigned upload/download capabilities without
changing Asset, Revision, or Claim identities.

Knowledge stops being the platform object-storage facade. It keeps document conversion,
chunking, embedding, retrieval, virtual file trees, and artifact revision
semantics, but its records reference Asset revisions for source and generated
bytes. Canvas keeps projects, resources, revisions, selections, generation
history, and the business facts that create claims. Admin keeps skills and
their file-tree/publishing rules. Chat keeps conversations and messages.

No service imports Asset source or reads the Asset database. All interactions
use versioned contracts and the caller-specific service authentication from
ADR-0071.

### 2. Separate logical identity, immutable content, and physical bytes

The canonical model is:

```text
Asset (stable logical identity)
  -> Revision (immutable user/provider-visible version)
       -> Blob (immutable content-addressed bytes)

Claim (domain owner/slot -> Asset or pinned Revision)
Lineage (output Revision -> input Revisions; provenance, not ownership)
Replica (Revision -> provider file/skill identifier with expiry)
```

- `asset_id` is an opaque stable platform ID, not a digest or object key.
- `revision_id` is an opaque immutable version ID.
- `blob_id` is derived from trusted SHA-256 bytes plus the storage isolation
  scope. Physical bucket/key values never cross the service boundary.
- Asset and Revision metadata use typed columns for lifecycle/security fields
  and a bounded JSON object only for media-specific facts.
- Deduplication is an implementation detail below Revision identity. It never
  merges tenant authorization, filenames, retention, claims, or audit history.
- Filesystem paths and any future object-store credentials, multipart upload
  IDs, buckets, and keys are storage-adapter details visible only to Asset.
  Other services exchange Asset and Revision IDs, never physical locators.

### 3. Claims are the common ownership contract

A Claim has a deterministic identity over:

```text
(tenant_id, workspace_id, owner_service, owner_type, owner_id, slot)
```

and points to either a logical Asset or one pinned Revision. Claim kinds are:

- `strong`: durable business ownership and blocks collection;
- `snapshot`: durable ownership of an immutable revision and blocks collection;
- `lease`: temporary processing use with an explicit expiry;
- `weak`: navigation, lineage, cache, or observability only and never blocks
  collection.

Only a real persisted business fact can create a strong or snapshot claim.
Task runs, provider polls, selection projections, transient model inputs, and
lineage do not pretend to be owners. They use a lease, snapshot owned by a real
result record, or a non-retaining edge.

Asset stores the platform claim projection. Each domain service remains the
authority for whether its owner record and slot exist. This avoids a shared
business database while giving operations one complete inventory.

### 4. Cross-database claim changes are safe and convergent

Creating an owning record follows a protection-first protocol:

1. the caller creates an idempotent `pending` Claim for a stable owner locator;
2. the caller commits its business record plus a local confirmation outbox in
   one database transaction;
3. the relay idempotently activates the Claim.

A pending Claim blocks collection. It is never removed solely because time
elapsed. A reconciler may release it only after the owning service
authoritatively reports that the owner/slot does not exist. An unavailable
owner fails closed. Upload sessions that never produced a domain owner are a
separate TTL-bounded resource and may expire automatically.

Releasing ownership is ordered in the other safe direction: the domain service
commits deletion/replacement plus a release outbox, then Asset idempotently
releases the Claim. Delayed delivery can leak temporarily but cannot delete live
content. Every mutation carries a stable operation ID and expected generation;
redelivery and stale deletion generations are harmless.

### 5. Browser uploads are domain-orchestrated and byte-direct

A browser never chooses an Asset category or creates durable ownership through a
generic storage endpoint. It starts from the domain that will own the result:

1. the domain service authorizes the use case, allocates a stable owner and
   upload-intent identity, and asks Asset for a bounded upload session;
2. the browser receives an opaque `UploadPlan` and transfers bytes directly to
   Asset; a future object-store adapter may instead return presigned single-part
   or multipart URLs from the same plan;
3. after Asset has validated and promoted the bytes to an immutable Revision,
   the browser calls the domain's idempotent finalize command;
4. finalize verifies the session and Revision, prepares protection, and commits
   the business record plus Claim activation outbox in one domain transaction.

The business service owns the command but never proxies browser bytes. Asset is
the only signer and enforces the server-selected category, maximum size, media
policy, expected checksum when supplied, tenant/workspace/user scope, expiry,
and one stable upload-session identity. Product services do not receive storage
credentials or implement provider-specific signing.

The upload-intent state machine is:

```text
pending -> uploading -> uploaded -> committing -> committed
    |          |           |
    +----------+-----------+-> expired
```

- No durable business resource is visible before `committed`.
- A browser crash before or during transfer leaves only a TTL-bounded session;
  partial filesystem staging is removed and incomplete object-store multipart
  uploads are aborted.
- A crash after byte promotion leaves an unclaimed Revision protected by a
  bounded upload lease. A reloaded client can query the domain intent and retry
  finalize without uploading again; expiry releases the lease for Asset GC.
- Finalize uses the intent identity as its idempotency key. A lost response and
  retry return the original business resource rather than creating another.
- Upload initiation does not create a permanent pending Claim. Protection-first
  Claim preparation starts only after a verified Revision is ready to enter the
  business transaction; reconciliation releases a prepared Claim if the owner
  transaction never commits.

`@repo/api`, not a generic utility package, owns the shared frontend
`UploadPlan` executor, cancellation, progress, retry, and resume transport.
Individual apps call their domain-specific initiate/status/finalize APIs.
Server-produced outputs use the internal Asset API with a bounded stream or
scratch file and a deterministic idempotency key; they never materialize large
outputs as `bytes`/`Uint8Array` merely to cross a service boundary.

### 6. Lifecycle is an explicit state machine

```text
uploading -> active -> candidate -> retained -> deleting -> deleted
                  ^        |             |
                  +--------+-------------+  new strong/snapshot claim

failed validation -> quarantined -> deleted
```

- Cached claim counts are scan hints only. Candidate marking and physical
  deletion both query authoritative active/pending claims and fail closed.
- `candidate` records the first zero-owner observation. `retained` provides the
  policy-specific recovery window. A newly activated claim restores the asset
  before physical deletion.
- Physical Blob deletion is a durable, idempotent effect. Metadata and deletion
  responsibility remain until the store confirms absence. Quota moves
  `active -> releasing -> released` and remains charged through `releasing`.
- Jobs use bounded batch claims, `FOR UPDATE SKIP LOCKED`, lease expiry, a
  fencing token/state version, exponential backoff with jitter, classified
  retryable/permanent failures, `dead` state, manual retry, and retention for
  completed audit facts.
- Required signals are queue depth, oldest pending age, attempt count, dead
  count, bytes by lifecycle state, orphan candidates, claim-reconciliation
  drift, upload abandonment, and deletion latency.

### 7. Every platform file class is in scope

| Producer/domain | Asset representation | Authoritative owner claim |
|---|---|---|
| Chat user upload | Asset + immutable source Revision | Chat message attachment slot |
| Agent Markdown/HTML | Asset with successive Revisions | Knowledge virtual-file entry or published document |
| Generated image/audio/video | Asset + output Revision | generation result, Canvas revision, or published document |
| Canvas user material | Asset + Revisions | Canvas node/resource/revision slot |
| Canvas cover/archive | Asset Revision | cover registration/archive result |
| Knowledge source document | Asset source Revision | Knowledge document source slot |
| Admin skill file | Asset Revision | Admin skill workspace-node slot |
| Imported skill ZIP | source Asset Revision; extracted files become independently claimed Assets | Admin import record and skill nodes |
| Provider file/skill upload | Replica of a platform Revision | Replica lease/expiry; never the canonical Asset |
| Temporary conversion/render input | lease Claim | durable task/run while active |

Text is not exempt: Markdown, HTML, JSON manifests, subtitles, and code files
are Assets when they are persisted user or Agent work. Small operational JSON,
message bodies, database configuration, and telemetry are not Assets merely
because they are bytes.

### 8. AI-native transport uses official file parts

Persisted Chat messages use the official AI SDK `file` part. Its `url` is a
stable authenticated Asset resource URL containing Asset and Revision identity,
not a data URL, object key, or expiring provider URL. Projection may mint a
short-lived browser capability URL, and the ToolLoopAgent download hook may
resolve the same Revision to bytes or a provider Replica. These are derived
views and are never persisted as the canonical identity.

Model-generated files returned by a provider are ingested into Asset before a
tool result is considered durable. Provider Files/Skills identifiers are
recorded as Replicas with `expires_at` and cleaned independently; they never
replace platform identity. The single Chat `ToolLoopAgent` remains the only
interactive agent. Executor Workflow continues to own deterministic durable
conversion and generation work.

### 9. Security and policy

- Every operation is tenant/workspace scoped and caller authorized. Browser
  downloads either pass normal Gateway identity or use a short-lived scoped
  capability; query capabilities are redacted from logs.
- Upload allowlists are use-case policies, not trust in filename or request
  `Content-Type`. Asset detects type from bytes, bounds streaming size, uses
  server-owned paths, rejects traversal and archive bombs, and supports
  quarantine/scanning before activation where required.
- Active legal hold overrides ordinary retention and collection. Retention and
  legal-hold changes are audited. No API promises immediate physical erasure
  when an object-store protection window or legal requirement applies.
- Content deduplication must not create a cross-tenant existence oracle.

### 10. Filesystem operations are production lifecycle responsibilities

The local filesystem is a supported production adapter, not a temporary demo
hack. Asset owns its staging cleanup, atomic promotion, garbage collection,
capacity watermarks, integrity scrubbing, backup/restore procedure, and
readiness checks. Its persistent volume must not be shared for direct writes by
Knowledge, Canvas, Admin, Chat, or Executor. Multiple Asset replicas cannot
mount a single-writer volume concurrently; scale-up requires shared filesystem
semantics or an object-store adapter. Database backup alone is not sufficient:
the Asset database and byte volume must be backed up to a mutually consistent
recovery point.

When an S3-compatible adapter is eventually configured, native lifecycle rules
may clean abandoned multipart uploads, isolated staging prefixes, noncurrent
physical versions, and already-deleted recovery copies. They never delete active
canonical Blob prefixes based only on age. In either adapter, the application
ledger remains authoritative for business collection.

## Consumer matrix and sharing verdict

| Consumer | Uses Asset for | Keeps locally | Migration verdict |
|---|---|---|---|
| Chat | attachment claims and official file-part references | messages, conversations, run state | bind to Asset |
| Knowledge | source/generated bytes | documents, file trees, revisions, chunks, retrieval | move bytes to Asset |
| Canvas | uploads, generated media, covers, archives | project/resource graph and owner facts | replace local blob/GC ledger |
| Admin | skill files, ZIP imports, future managed uploads | skill tree, publication, configuration | bind to Asset |
| Executor | temporary leases, generation outputs, provider replicas | tasks, workflows, cost and provider execution | bind to Asset |
| Gateway | public routing only | auth edge and rate limiting | route Asset, no domain logic |
| IAM | none | identity/session state | no Asset dependency |
| Telemetry | none | trace/RUM retention | no Asset dependency |

Under ADR-0061, Asset identity and lifecycle are a **centralized service
capability** because one authoritative inventory is the product requirement.
Wire schemas are shared through `schemas/`; generated transport clients may be
shared. Domain owner models, outboxes, and transaction code stay in each
service. Cross-language lifecycle implementations are not copied into a mega
kernel.

## Migration

This is a direct breaking migration with no compatibility facade:

1. Introduce the internal Asset service, database, object backend, upload/read
   API, Claims, lifecycle jobs, metrics, and public authenticated/capability
   download route.
2. Migrate Knowledge object bytes and document source references. Make Chat
   uploads and newly authored Markdown/HTML use Asset, while Knowledge keeps
   the searchable/document projection. Remove Knowledge object deletion and
   conversation tombstone ownership.
3. Migrate generated media and Executor leases/replicas. Completion is not
   durable until provider output has a platform Revision and owner claim.
4. Migrate Canvas physical Artifact identity, references, quota ledger, covers,
   archives, and GC into Asset. Canvas emits claim operations from its own
   authoritative transactions. Remove the local Asset GC only after parity and
   reconciliation show zero drift.
5. Migrate Admin skill-node content and ZIP import/export. Published skill
   snapshots pin exact file Revisions.
6. Delete Knowledge's ObjectStore, staged-media byte ownership, Canvas-specific
   object routes, obsolete cleanup outboxes, and all raw object locators outside
   Asset. Apply object-store lifecycle rules only after prefix separation is
   verified.

Each wave inventories producer, owner, reader, delete trigger, retention, quota,
and legal-hold behavior; migrates all callers; runs a reverse-reference audit;
then deletes the old path. Contract generation and `just sync` accompany every
API wave. The post-implementation review in ADR-0016 is mandatory.

## Consequences

- Every user upload and generated deliverable has one inspectable lifecycle and
  can be searched by tenant, owner, origin, media type, state, and lineage.
- Domain services remain autonomous and do not share a database, but delayed
  cross-service delivery converges safely toward reclamation rather than risking
  deletion of live work.
- Knowledge becomes narrower and easier to scale independently from byte
  traffic. Canvas no longer maintains a second physical-storage control plane.
- The Asset service is critical infrastructure. Its write/read availability,
  migration, backup, reconciliation, and object-store durability require the
  same production treatment as identity and databases.
- Centralization adds a service hop. Direct signed upload/download and batch
  claim APIs keep large bytes and N+1 ownership operations off synchronous
  application paths.

## 2026-09-24 implementation review

The first platform migration is implemented across Asset, Gateway, Chat,
Knowledge, Canvas, Executor, and Admin. The review re-ran the cross-service and
new-service checklists, generated all contracts, built every frontend and
backend target, rendered both K8s overlays, rendered Single-VPS Compose with
placeholder secrets, and passed the repository service-topology checker.

The review found and corrected seven gaps beyond the initial functional path:

1. Asset lifecycle maintenance now reconciles cached blocking-claim counts and
   removes abandoned staging uploads with retryable cleanup leases; one failed
   maintenance operation does not suppress the remaining collectors.
2. Canvas, Knowledge, and Admin Claim intents use the complete tenant/workspace
   owner identity plus lease and state-version fencing. Release delivery uses
   prepare-then-release, and Skill node owner IDs include the Skill ID so a
   client-selected node ID cannot collide across Skills.
3. Admin only accepts the `skill-archive` and `skill-attachment` Asset
   categories at their respective boundaries. ZIP import counts every central-directory entry, rejects traversal,
   symlinks, encrypted entries, duplicates, oversized members and suspicious
   compression ratios, and verifies both byte count and SHA-256 after streaming
   an Asset revision to disk. Small UTF-8 text remains inline; binary files and
   source ZIPs pin immutable revisions.
4. Chat's `read_skill_file` contract is discriminated: inline text returns
   content, while binary resources return a typed Asset descriptor and delivery
   URL instead of masquerading as empty text. Published Skill snapshots retain
   exact revision IDs through snapshot Claims.
5. The fresh-eyes composition pass removed the obsolete Canvas-to-Knowledge
   binding and Knowledge's stale Canvas caller credential. It also updated the
   service catalog and domain docs so local, K8s, Single-VPS, CI, and generated
   contracts describe the same nine-service topology.
6. Executor video transfer, assembly, QA, and Asset upload now use provider
   streams plus bounded scratch files rather than whole-video `Uint8Array`
   values. All internal byte producers supply a stable, caller-scoped
   idempotency key; replay returns the original revision and metadata mismatch
   fails closed. Delivery has explicit regression coverage for byte ranges and
   `206 Partial Content`.
7. Since local and Single-VPS installations are rebuildable, Canvas's target
   schema was folded into v1.0 and obsolete compatibility migrations, local GC
   tables, and reference-count columns were deleted. Fresh Canvas and Asset
   schemas were both applied to isolated PostgreSQL databases during review.

The migration intentionally retains no object-route, locator-field, migration,
or Knowledge-storage compatibility facade. Canvas attachment rows remain a
domain model in the fresh schema, but no obsolete physical locator metadata is
carried forward or reinterpreted as a platform Asset revision.

## Rejected alternatives

- **Keep storage in Knowledge and rename it Asset**: rejected because document
  retrieval and platform byte lifecycle have different scaling, ownership, and
  failure domains.
- **Copy Canvas GC into every service**: rejected because it preserves multiple
  incompatible identities, quota ledgers, and deletion queues.
- **One shared Asset database read by all services**: rejected because it breaks
  service autonomy and makes domain transactions depend on foreign tables.
- **Rely on object-store TTL**: rejected because age and prefix cannot establish
  business ownership.
- **Store provider file IDs as canonical identity**: rejected because provider
  IDs expire, are vendor-specific, and cannot represent platform retention or
  authorization.

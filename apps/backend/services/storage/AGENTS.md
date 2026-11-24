# storage service

Unified file storage and delivery service. It owns logical assets, immutable revisions,
content-addressed blob metadata, cross-service claims, lifecycle jobs, and the
exclusive local filesystem volume containing durable bytes.

## Boundaries

- Product services store only `asset_id` / `revision_id`; never filesystem
  paths, buckets, or object keys.
- Product meaning and owner existence remain authoritative in the caller. Storage
  stores the lifecycle claim projection and never reads another service's DB.
- Storage protocol, persistence and production models never accept or persist
  tenant, workspace or business-user identity. The internal RPC runtime binds
  `x-caller-service` to that workload's deployment credential before applying
  the exact method policy. Claim owner fields are caller-local opaque
  identifiers rather than product identity columns.
- Upload and download bodies are streamed. Never use `io.ReadAll` or parse a
  complete multipart body.
- A cached claim count is only a scan hint. Collection rechecks claim rows and
  fails closed.
- Filesystem deletion is an idempotent durable effect. Destructive metadata
  cleanup happens only after byte deletion is confirmed.
- The filesystem adapter is supported for single-VPS production and requires a
  single writer. Future object stores implement the same application port.

Follow the parent backend rules and docs/ADR/files-and-assets.md.

- Resource owners authorize reads before internal capability minting. Minting
  requires an active strong/snapshot Claim, or a lease covering the capability
  lifetime, owned by the calling workload for the exact revision. A new Claim
  must derive from that same authority; a completed upload creates the caller's
  24-hour exact-revision lease as its initial authorization root. Public upload
  and delivery accept only short-lived signed capabilities; an Asset, Revision
  or UploadSession ID alone never grants public access.
- Image variants are bounded derivatives; original bytes remain immutable and streamed.

# storage service

Unified file storage and delivery service. It owns logical assets, immutable revisions,
content-addressed blob metadata, cross-service claims, lifecycle jobs, and the
exclusive local filesystem volume containing durable bytes.

## Boundaries

- Product services store only `asset_id` / `revision_id`; never filesystem
  paths, buckets, or object keys.
- Product meaning and owner existence remain authoritative in the caller. Storage
  stores the lifecycle claim projection and never reads another service's DB.
- Upload and download bodies are streamed. Never use `io.ReadAll` or parse a
  complete multipart body.
- A cached claim count is only a scan hint. Collection rechecks claim rows and
  fails closed.
- Filesystem deletion is an idempotent durable effect. Quota is released only
  after deletion is confirmed.
- The filesystem adapter is supported for single-VPS production and requires a
  single writer. Future object stores implement the same application port.

Follow the parent backend rules and docs/ADR/files-and-assets.md.

- Resource owners authorize reads before internal capability minting. Public delivery accepts only signed capabilities; workspace identity alone never grants file access.
- Image variants are bounded derivatives; original bytes remain immutable and streamed.

# asset service

Platform Asset Control Plane. It owns logical assets, immutable revisions,
content-addressed blob metadata, cross-service claims, lifecycle jobs, and the
exclusive local filesystem volume containing durable bytes.

## Boundaries

- Product services store only `asset_id` / `revision_id`; never filesystem
  paths, buckets, or object keys.
- Product meaning and owner existence remain authoritative in the caller. Asset
  stores the lifecycle claim projection and never reads another service's DB.
- Upload and download bodies are streamed. Never use `io.ReadAll` or parse a
  complete multipart body.
- A cached claim count is only a scan hint. Collection rechecks claim rows and
  fails closed.
- Filesystem deletion is an idempotent durable effect. Quota is released only
  after deletion is confirmed.
- The filesystem adapter is supported for single-VPS production and requires a
  single writer. Future object stores implement the same application port.

Follow the parent backend rules and ADR-0072.

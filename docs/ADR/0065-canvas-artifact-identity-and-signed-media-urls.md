# ADR 0065: Canvas artifact identity and signed media URLs

**Date**: 2026-09-21
**Status**: Accepted
**Related**: ADR-0004, ADR-0021, ADR-0057, ADR-0061, ADR-0063

## Context

The first AgentFrame-to-monorepo Canvas adapter stored Knowledge's immutable
object hash in `assets.object_key`. API responses then exposed authenticated
Canvas `/content` endpoints. Browser media elements cannot attach the API
client's bearer token, so project covers and other assets fail with `401` even
though the bytes exist. Fetching every image into a browser `Blob` works around
authentication but duplicates bytes, object-URL lifecycle code, and proxy
endpoints throughout the frontend.

AgentFrame's mature asset model separates three identities:

- `artifact_id` identifies immutable stored bytes;
- `asset_id` identifies a persisted business asset/version;
- `resource_asset_id` identifies a stable resource slot whose
  `current_asset_id` can advance to a new version.

The migrated Canvas domain already contains the latter two concepts, but its
active compatibility application still names the stored identifier
`object_key`, omits signed URLs from several response DTOs, and sometimes maps a
`resource_asset_id` into `CurrentAssetID` on the frontend.

## Consumer matrix

| Consumer | Need | Current path | Decision |
|---|---|---|---|
| Knowledge | Own immutable bytes and capability signing | `/internal/objects`, `/media/canvas` | Keep implementation in Knowledge; expose batch presign internally |
| Canvas | Persist storage identity, resolve display URLs | `assets.object_key`, authenticated `/content` proxy | Persist `artifact_id`; request signed URLs from Knowledge |
| Canvas web | Render covers and asset previews | Canvas `/content` URL, sometimes fetched into `Blob` | Consume returned signed URL directly |
| Chat Canvas tools | Round-trip complete Canvas node values | Typed Canvas graph/mutation contract | Preserve stable resource IDs when editing nodes |
| Executor / generation workers | Read immutable input bytes | internal Knowledge object API | Keep internal authenticated reads by artifact namespace + ID |
| External review/provider | Fetch selected immutable version | Canvas locally constructs a one-hour URL | Use the same Knowledge presign contract |

This is a service-owned contract, not a reusable library: signing and Redis
code stay in Knowledge, while Canvas keeps a small HTTP adapter.

## Decision

1. Knowledge remains the single storage owner. No replacement storage service,
   shared persistence package, or Canvas-specific object-store configuration is
   introduced.
2. Knowledge's internal object contract calls the immutable returned identifier
   `artifact_id`. The current content-addressed SHA-256 identifier remains valid,
   so existing objects require no byte copy and no identity rewrite.
3. An artifact is addressed by `(namespace, artifact_id)`. For current Canvas
   objects the namespace is the existing deterministic project scope; the
   physical path remains an implementation detail of Knowledge.
4. Knowledge exposes an internal batch-presign operation and a public capability
   route. Capability URLs are valid for 24 hours. Successful results are cached
   in the platform Redis with a randomized TTL between six and eight hours,
   bounded by the remaining URL lifetime and keyed by namespace and artifact ID.
   The jitter avoids synchronized refreshes; cache failures are fail-open, so
   signing still works.
5. Signed URLs are derived response state. They are never persisted in Canvas,
   project records, or frontend state intended to outlive the response.
6. Canvas migrates `assets.object_key` and GC ledger `object_key` to
   `artifact_id` in one versioned migration. The rename preserves every value
   and index relationship. Application and internal execution contracts use
   artifact terminology after the migration.
7. Canvas API responses return signed `preview_url`/cover URLs together with the
   real `asset_id`. Resource responses continue to expose the stable
   `resource_asset_id` and separately expose `current_asset_id`.
8. Live resource consumers bind `resource_asset_id` and resolve
   `resource_assets.current_asset_id` at read/execution time. Immutable history,
   generation output, review submission, archive, and GC records intentionally
   pin `asset_id` or `artifact_id`; those are snapshots and must not follow a
   later replacement.
9. The frontend assigns signed URLs directly to `img`, `video`, and `audio`.
   The temporary authenticated-fetch-to-Blob cover path and obsolete media
   proxy use are removed as each response adopts the signed URL.

## Migration and rollout

1. Deploy Knowledge's additive presign endpoint and Redis configuration.
2. Apply the Canvas column-rename migration. Because the stored values and
   physical object paths do not change, old objects remain readable and the
   operation is reversible by renaming the columns back.
3. Deploy Canvas responses and the frontend together; this development
   environment uses whole-stack upgrades and has no rolling compatibility
   window.
4. Validate that an existing artifact can be read by the new public URL without
   bearer authentication, and that a second presign resolves from Redis.

If Knowledge presigning is temporarily unavailable, media URL fields are
omitted while metadata remains readable. Internal byte reads and stored
identities are unaffected.

## Security

- The mint endpoint remains internal-token protected and validates the Canvas
  namespace/identifier format.
- The public route accepts only a valid HMAC capability whose expiry is no more
  than 24 hours in the future.
- Redis contains only the derived URL and expiry, never object bytes or API
  credentials.
- Query strings are capabilities and must remain redacted by normal request
  logging.

## Consequences

- Browser media requests no longer need bearer headers or Canvas byte proxying.
- Replacing a resource slot updates all live `resource_asset_id` consumers while
  historical versions remain reproducible.
- Knowledge gains Redis as a runtime dependency already provided by the
  platform; local development continues to use the root Redis service.
- The content-addressed artifact ID preserves existing data but does not expose
  Knowledge's physical object path as a business field.

## Mature implementation reference

The design follows AgentFrame's current implementation in
`multix-app/internal/server/adapters/outbound/artifact/up.go` and
`internal/server/application/asset/service.go`: batch presigning, Redis-backed
URL caching with a 24-hour capability lifetime and randomized six-to-eight-hour
cache TTL, immutable `ArtifactID` on `Asset`, and owner/reference-aware asset
resolution. The monorepo uses Knowledge's existing object store and platform
Redis instead of copying AgentFrame's UP SDK, IAM credentials, or private
configuration.

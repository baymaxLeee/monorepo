# IAM service

IAM owns account identity, credentials, tenants/workspaces, membership, roles,
login sessions, refresh-token rotation and user profile preferences. Gateway
exposes its service-root auth and administration APIs under `/api/iam-server/*`.

- Password hashes, session/token persistence and identity membership state are
  authoritative here. Other services consume authenticated identity and fetch or
  cache IAM state; they do not replicate IAM tables.
- IAM does not own domain-specific user behavior, resource authorization,
  operator/provider configuration, frontend route shells or transport token
  propagation.
- Application use cases own transaction boundaries. SQL remains named and typed
  through the service's checked-in sqlc output; regenerate it after query changes.
- Keep credentials and token primitives inside the security adapter. Do not return
  hashes, raw tokens or infrastructure errors through public contracts.

Run `just test backend/iam`; cover token reuse/rotation, cross-workspace rejection
and failure cleanup for authentication or membership changes. Run `just sync` when
the public contract changes.

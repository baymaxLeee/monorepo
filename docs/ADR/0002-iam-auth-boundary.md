# 0002 IAM Auth Boundary

## Status

Accepted

## Context

The platform host owns authentication UX and token propagation for all
micro-frontends. The Go API gateway owns cross-cutting request concerns, but it
must stay stateless and should not own IAM data.

## Decision

Add a Go `iam` microservice that owns:

- user account and profile preference records
- password credentials
- role records and user-role assignments
- refresh token storage, revocation, and rotation
- `/v1/auth/register`, `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`,
  and `/v1/auth/me`
- `/v1/iam/roles` and `/v1/iam/users/{userID}/roles`

The gateway proxies `/v1/auth/*` and `/v1/iam/*` to `iam`. Access tokens are
short-lived HMAC JWTs. Refresh tokens are opaque, HttpOnly cookie-backed,
stored only as hashes, and rotated on every refresh. The frontend keeps only
the access token and current user profile in local storage, then silently
refreshes when a protected request receives `401`.

For downstream business services, the gateway verifies access JWTs at the edge,
strips caller-supplied auth propagation headers, and injects only
`X-Auth-User-ID`. Other profile fields are not propagated by default because
they are not universally needed.

## Consequences

- Account and role data remain isolated in the IAM service database.
- MFEs continue to call generated/manual API clients; token propagation stays in
  `@packages/auth-client`.
- Admin user-management workflows can use IAM endpoints without moving
  credential logic into the admin service.

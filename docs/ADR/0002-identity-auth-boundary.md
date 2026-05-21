# 0002 Identity Auth Boundary

## Status

Accepted

## Context

The platform host owns authentication UX and token propagation for all
micro-frontends. The Go API gateway owns cross-cutting request concerns, but it
must stay stateless and should not own identity data.

## Decision

Add a Go `identity` microservice that owns:

- user account and profile preference records
- password credentials
- refresh token storage, revocation, and rotation
- `/v1/auth/register`, `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`,
  and `/v1/auth/me`

The gateway proxies `/v1/auth/*` to `identity`. Access tokens are short-lived
HMAC JWTs. Refresh tokens are opaque, HttpOnly cookie-backed, stored only as
hashes, and rotated on every refresh. The frontend keeps only the access token
and current user profile in local storage, then silently refreshes when a
protected request receives `401`.

## Consequences

- Account data remains isolated in the identity service database.
- MFEs continue to call generated/manual API clients; token propagation stays in
  `@packages/auth-client`.
- Admin user-management workflows can be added later without moving credential
  logic into the admin service.

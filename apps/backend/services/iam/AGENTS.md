# iam service

Go service that owns account identity, credentials, roles, login sessions,
refresh tokens, and user profile preferences.

## Owns
- User account rows and profile preferences
- Password credential hashes
- Role records and user-role assignments
- Refresh token persistence and rotation
- Auth REST endpoints under `/v1/auth`
- IAM REST endpoints under `/v1/iam`

## Layout
- `internal/router/` — HTTP routing and response mapping
- `internal/service/` — auth, session, role business logic
- `internal/crud/` — ORM persistence operations
- `internal/model/` — GORM table models
- `internal/schema/` — request/response DTOs
- `internal/security/` — password hashing and token primitives

## Does not own
- Admin-only user management workflows
- Domain-specific user behavior outside identity/profile settings
- Frontend route shell or token propagation

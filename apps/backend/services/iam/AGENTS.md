# iam service

Go service that owns account identity, credentials, roles, login sessions,
refresh tokens, and user profile preferences.

## Owns
- User account rows and profile preferences
- Password credential hashes
- Role records and user-role assignments
- Refresh token persistence and rotation
- Auth REST endpoints mounted at service root (`/login`, `/register`,
  `/refresh`, `/logout`, `/me`); externally exposed by api-gateway as
  `/api/iam-server/*`
- IAM REST endpoints mounted at service root (`/roles`, `/users/...`);
  externally exposed by api-gateway as `/api/iam-server/*`

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

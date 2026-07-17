# iam service

Go service that owns account identity, credentials, roles, login sessions,
refresh tokens, and user profile preferences.

## Owns
- User account rows and profile preferences
- Password credential hashes
- Role records and user-role assignments
- Refresh token persistence and rotation
- Auth REST endpoints mounted at service root (`/login`, `/register`,
  `/refresh`, `/logout`, `/me`); externally exposed by gateway as
  `/api/iam-server/*`
- IAM REST endpoints mounted at service root (`/roles`, `/users/...`);
  externally exposed by gateway as `/api/iam-server/*`

## Layout
- `internal/bootstrap/config/` — process configuration
- `internal/api/http/router/` — HTTP routing and response mapping
- `internal/application/contracts/` — request/response DTOs
- `internal/api/http/middleware/` — HTTP middleware
- `internal/application/` — auth, session, and role business logic
- `internal/domain/` — identity, organization, and membership value rules
- `internal/infrastructure/persistence/repositories/` — ORM persistence operations
- `internal/infrastructure/persistence/models/` — GORM table models
- `internal/infrastructure/security/` — password hashing and token primitives

## Does not own
- Admin-only user management workflows
- Domain-specific user behavior outside identity/profile settings
- Frontend route shell or token propagation

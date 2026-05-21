# identity service

Go service that owns account identity, credentials, login sessions, refresh
tokens, and user profile preferences.

## Owns
- User account rows and profile preferences
- Password credential hashes
- Refresh token persistence and rotation
- Auth REST endpoints under `/v1/auth`

## Does not own
- Admin-only user management workflows
- Domain-specific user behavior outside identity/profile settings
- Frontend route shell or token propagation

## Test
- `go test ./...`

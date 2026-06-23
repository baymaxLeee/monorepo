# storage service

Go service that owns binary object persistence for demo attachments and
artifacts that should not live in service databases.

## Owns
- Object metadata rows
- Local filesystem object backend for demo / single-VPS deployments
- S3-like internal object API mounted at service root

## Does not own
- Chat document metadata or LLM-specific file interpretation
- Public user authorization decisions; callers complete user auth before using
  internal APIs
- Cloud object-store credentials in the first implementation


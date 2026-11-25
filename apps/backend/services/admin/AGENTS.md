# Admin service

Admin owns workspace-scoped operator configuration: providers, skills,
integrations, publishing and the platform application registry. Its public APIs
are exposed by Gateway under `/api/admin-server/*`.

## Boundaries

- IAM owns identity, tenants/workspaces, membership and roles. Resource
  authorization and business audit remain with the resource owner.
- Storage owns binary skill/import bytes, physical retention, signed delivery and
  GC. Admin stores exact Asset revision references and owns editable skill-tree,
  publication and installation semantics.
- Skill text stays inline for precise code-agent edits. Binary files and imported
  ZIP sources are immutable Asset revisions; published snapshots pin exact
  revision IDs and protect them with snapshot Claims.
- Application methods own transaction boundaries. Keep external Storage/provider
  IO outside database transactions and revalidate locked state before commit.
- OpenAPI wire types remain transport-only; domain state must not depend on
  generated API types. Return application errors through the shared problem writer,
  never expose raw infrastructure errors.

Run `just test backend/admin`; verify Storage claim/publication behavior when skill
assets change and run `just sync` when the public contract changes.

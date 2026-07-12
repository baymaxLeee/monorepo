# ADR 0033: Admin-managed Skill packages

## Status

Accepted. Replaces the former `name + description + body` Skill record.

## Context

An Agent Skill is a directory whose required `SKILL.md` entrypoint may reference
focused documentation, templates, schemas, assets, and scripts. Storing only one
body string prevented operators from authoring or reusing those resources and
could not use the existing frontend `FileWorkspace` editor.

The product does not need release history during the demo phase. It does need a
stable boundary between an operator's in-progress edits and the package used by
live chat runs.

## Decision

1. Admin owns a PostgreSQL-backed mutable file tree in `skill_nodes`. Nodes have
   stable IDs, `parent_id`, name, type, MIME type, textual content, and ordering.
   The public workspace API returns a nested tree and lazily reads file content.
2. `SKILL.md` YAML frontmatter is the content source of truth for `name` and
   `description`. Admin projects those fields onto `skills` for list and binding
   queries; they are not edited in a second form.
3. There is no revision history. Publishing atomically replaces the one
   `skill_published_nodes` snapshot and records its hash and timestamp. Draft
   editing never changes the live package; chat reads only the published
   snapshot.
4. Draft mutations use node-granular create/content/rename/move/delete endpoints.
   Every node carries a content-derived `etag`; only conflicting edits to that
   node fail with HTTP 409. `workspace_seq` is not a product version and is used
   only to ensure publish snapshots the workspace state the editor observed.
5. `workspace_sha256 != published_sha256` is the sole definition of unpublished
   changes. A Skill lifecycle is `draft | published | archived`; `is_enabled`
   independently controls runtime availability.
6. Bot bindings advertise only published, enabled Skills. L1 discovery still
   includes only the published name and description. `load_skill` and explicit
   `/` activation fetch the published `SKILL.md` body through the existing
   internal API; `read_skill_file` fetches only a listed published resource when
   the activated instructions require it, preserving progressive disclosure.
7. Admin validates the root `SKILL.md`, frontmatter, parent chains, node count,
   and file operations before publishing. Uploaded scripts remain package files;
   this decision does not authorize executing them in admin or chat processes.
8. Admin startup performs no remote Skill discovery or import. GitHub/network
   imports are explicit management operations, never lifespan dependencies or
   implicit background work.

## Data shape

```text
skills
├── workspace_seq / workspace_sha256
├── published_sha256 / published_at
├── skill_nodes                 mutable workspace tree
└── skill_published_nodes       one replaceable live snapshot
```

Existing body-only Skills are migrated to a root `SKILL.md`. Previously active
Skills receive a published snapshot; other records remain drafts.

## Consequences

- The editor is a full-page `FileWorkspace` with save, validate, and publish
  actions rather than a textarea dialog.
- Publishing is atomic and live chat runs never observe a partially copied tree.
- There is intentionally no history, diff, pinning, or rollback. Adding those
  later requires a product requirement and a separate immutable-revision ADR.
- The runtime remains one `ToolLoopAgent`; a Skill is a lazily loaded capability
  package, not a sub-agent or role-play persona.

## References

- Agent Skills specification: directory, `SKILL.md`, progressive disclosure
- Codex Skills: explicit/implicit activation and optional resources/scripts
- ADR-0028: code-governed system Skills
- ADR-0036: persisted explicit Skill activation

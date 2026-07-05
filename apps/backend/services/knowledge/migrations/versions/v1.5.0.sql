-- v1.5.0: org tenancy for the knowledge base. Documents and their RAG chunks
-- gain an org_id so a whole team shares one knowledge base; retrieval and the
-- user-facing document list switch from per-user to per-org scoping. user_id is
-- retained as "who uploaded". Agent artifacts stay per-user (org_id NULL) — they
-- are per-conversation outputs, never chunked or team-retrieved.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id varchar(26);
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS org_id varchar(26);

-- Backfill existing team knowledge into the seeded guest org (the only org at
-- this point; matches iam GUEST_ORG_ID default 'guest-org').
UPDATE documents SET org_id = 'guest-org' WHERE org_id IS NULL AND kind = 'source';
UPDATE document_chunks SET org_id = 'guest-org' WHERE org_id IS NULL;

-- Team-scoped access leads with org_id.
CREATE INDEX IF NOT EXISTS ix_documents_org_created ON documents (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_document_chunks_org_id ON document_chunks (org_id);

UPDATE migration SET version = 'v1.5.0', update_time = NOW() WHERE id = 1;

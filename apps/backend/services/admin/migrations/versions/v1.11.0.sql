-- v1.11.0: replace single-body Skills with a PostgreSQL-backed file tree and
-- one replaceable published snapshot. Existing Skills become draft workspaces;
-- previously active Skills also receive an immediately usable published copy.

ALTER TABLE skills ADD COLUMN workspace_seq integer NOT NULL DEFAULT 1;
ALTER TABLE skills ADD COLUMN workspace_sha256 varchar(64);
ALTER TABLE skills ADD COLUMN published_sha256 varchar(64);
ALTER TABLE skills ADD COLUMN published_at timestamptz;
ALTER TABLE skills ADD COLUMN published_name varchar(64);
ALTER TABLE skills ADD COLUMN published_description varchar(1024);

CREATE TABLE skill_nodes (
  id          varchar(64)  PRIMARY KEY,
  skill_id    varchar(32)  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  parent_id   varchar(64)  REFERENCES skill_nodes(id) ON DELETE CASCADE,
  name        varchar(255) NOT NULL,
  node_type   varchar(16)  NOT NULL CHECK (node_type IN ('file', 'directory')),
  mime_type   varchar(160),
  content     text,
  sort_order  integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL,
  updated_at  timestamptz  NOT NULL,
  CHECK (
    (node_type = 'directory' AND content IS NULL)
    OR node_type = 'file'
  )
);
CREATE INDEX ix_skill_nodes_skill_id ON skill_nodes (skill_id);
CREATE INDEX ix_skill_nodes_parent_id ON skill_nodes (parent_id);
CREATE UNIQUE INDEX ux_skill_nodes_root_name
  ON skill_nodes (skill_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX ux_skill_nodes_child_name
  ON skill_nodes (skill_id, parent_id, name) WHERE parent_id IS NOT NULL;

CREATE TABLE skill_published_nodes (
  skill_id       varchar(32)  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  node_id        varchar(64)  NOT NULL,
  parent_node_id varchar(64),
  name           varchar(255) NOT NULL,
  node_type      varchar(16)  NOT NULL CHECK (node_type IN ('file', 'directory')),
  mime_type      varchar(160),
  content        text,
  sort_order     integer      NOT NULL DEFAULT 0,
  PRIMARY KEY (skill_id, node_id),
  CHECK (
    (node_type = 'directory' AND content IS NULL)
    OR node_type = 'file'
  )
);
CREATE INDEX ix_skill_published_nodes_parent
  ON skill_published_nodes (skill_id, parent_node_id);

INSERT INTO skill_nodes (
  id, skill_id, parent_id, name, node_type, mime_type, content,
  sort_order, created_at, updated_at
)
SELECT
  'root-' || id,
  id,
  NULL,
  'SKILL.md',
  'file',
  'text/markdown',
  '---' || chr(10) ||
  'name: ' || name || chr(10) ||
  'description: ' || replace(replace(description, chr(10), ' '), chr(13), ' ') || chr(10) ||
  '---' || chr(10) || chr(10) || body,
  0,
  created_at,
  updated_at
FROM skills;

UPDATE skills
SET workspace_sha256 = md5(
    '---' || chr(10) ||
    'name: ' || name || chr(10) ||
    'description: ' || replace(replace(description, chr(10), ' '), chr(13), ' ') || chr(10) ||
    '---' || chr(10) || chr(10) || body
  );

INSERT INTO skill_published_nodes (
  skill_id, node_id, parent_node_id, name, node_type, mime_type, content, sort_order
)
SELECT skill_id, id, parent_id, name, node_type, mime_type, content, sort_order
FROM skill_nodes
WHERE skill_id IN (SELECT id FROM skills WHERE status = 'active');

UPDATE skills
SET status = CASE WHEN status = 'active' THEN 'published' ELSE 'draft' END,
    published_sha256 = CASE WHEN status = 'active' THEN workspace_sha256 ELSE NULL END,
    published_at = CASE WHEN status = 'active' THEN updated_at ELSE NULL END,
    published_name = CASE WHEN status = 'active' THEN name ELSE NULL END,
    published_description = CASE WHEN status = 'active' THEN description ELSE NULL END;

ALTER TABLE skills DROP COLUMN body;

UPDATE migration SET version = 'v1.11.0', update_time = NOW() WHERE id = 1;

-- Live resource bindings use the stable resource_asset_id. Existing nodes keep
-- their snapshot semantics because the migration cannot reliably distinguish a
-- copied project asset from a copied resource version.

ALTER TABLE canvas_nodes ADD COLUMN resource_id varchar(36) NOT NULL DEFAULT '';
ALTER TABLE canvas_nodes ADD COLUMN resource_asset_id varchar(36) NOT NULL DEFAULT '';
CREATE INDEX canvas_nodes_resource_asset ON canvas_nodes(resource_asset_id, deleted_at)
  WHERE resource_asset_id <> '';

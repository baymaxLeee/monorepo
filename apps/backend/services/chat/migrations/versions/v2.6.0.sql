-- v2.6.0: conversation 冻结 org_id，列表/读写/run 按 user+org 隔离。
-- IAM 将每个 demo 用户加入 guest-org；历史 conversations 没有可推导的
-- org ownership，因此直接归属该唯一的初始组织，而不保留不可访问的空 scope。

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS org_id varchar(26) NOT NULL DEFAULT '';

UPDATE conversations
  SET org_id = 'guest-org'
  WHERE org_id = '';

ALTER TABLE conversations
  ALTER COLUMN org_id DROP DEFAULT;

CREATE INDEX IF NOT EXISTS ix_conversations_user_org
  ON conversations (user_id, org_id);

UPDATE migration SET version = 'v2.6.0', update_time = NOW() WHERE id = 1;

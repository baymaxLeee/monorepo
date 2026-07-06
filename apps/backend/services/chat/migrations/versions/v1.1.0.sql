-- v1.1.0: 将会话绑定到具体模型提供方。provider_id 是指向 admin.model_providers.id
-- 的不透明外键字符串——chat 不得 JOIN admin 表，该字段对本服务不透明。

UPDATE migration SET version = 'v1.1.0', update_time = NOW() WHERE id = 1;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_id varchar(32) NOT NULL DEFAULT '';

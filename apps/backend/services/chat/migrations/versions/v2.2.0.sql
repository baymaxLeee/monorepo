-- v2.2.0: 将 messages.content 转为原生 jsonb,对齐 Vercel AI SDK 的持久化形态(消息 parts
-- 以结构化 JSON 存储、写入时校验),取代 TEXT 里的序列化字符串。
-- PostgreSQL 无 MySQL 的 JSON_VALID 函数:存量若不是以 '{' / '[' 开头(即历史纯文本行),
-- 先包裹进 {version, parts:[{type:text,text:...}]} 信封,使随后的 text→jsonb 类型转换
-- 不会因非 JSON 存量而失败。

UPDATE messages
SET content = jsonb_build_object(
  'version', 1,
  'parts', jsonb_build_array(jsonb_build_object('type', 'text', 'text', content))
)::text
WHERE content IS NOT NULL
  AND left(btrim(content), 1) NOT IN ('{', '[');

ALTER TABLE messages
  ALTER COLUMN content TYPE jsonb USING content::jsonb;

UPDATE migration SET version = 'v2.2.0', update_time = NOW() WHERE id = 1;

-- v1.9.0: replace bots.system_prompt (free-text, high-privilege) with a
--   structured, schema-bound bot profile. The free-text entry into the model's
--   system instructions is removed entirely — historical `system_prompt` values
--   are intentionally discarded (demo phase, no forward-compat obligation).
--
--   New identity fields (role/domain/audience/tone) flow into the prompt through
--   a fixed code renderer; welcome_message/suggested_questions are UI-only and
--   never enter the model context.

ALTER TABLE bots ADD COLUMN IF NOT EXISTS role_description text;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS domain_description text;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS audience varchar(200);
ALTER TABLE bots ADD COLUMN IF NOT EXISTS tone varchar(20) NOT NULL DEFAULT 'professional';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS welcome_message text;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS suggested_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Deterministic structured backfill for the demo oncall bot. We do NOT copy the
-- old free-text persona into role_description (that would just rename the risk);
-- the full RCA workflow moves to a code-versioned skill later.
UPDATE bots SET
  role_description = '团队 Oncall 事故排查助手：结合团队历史复盘与运维文档，帮助值班同学定位并处置线上问题。按 根因 / 排查 / 验证 / 修复 四段作答，每条标注出处与置信度；只读建议，不代替人工执行高危操作。',
  domain_description = '团队线上事故排查、SOP、Runbook、架构与配置知识库。',
  audience = '一线值班与运维工程师',
  tone = 'professional',
  welcome_message = '描述你遇到的线上问题，我会结合团队复盘与文档，给出根因分析、排查步骤、验证方法与修复建议。',
  suggested_questions = '["服务 5xx 突然升高，如何快速定位根因？", "数据库连接池被打满，怎么一步步排查？", "发布后接口大面积超时，回滚前应先确认什么？"]'::jsonb
WHERE id = 'bot-oncall';

-- Drop the free-text high-privilege column last; values are intentionally lost.
ALTER TABLE bots DROP COLUMN IF EXISTS system_prompt;

UPDATE migration SET version = 'v1.9.0', update_time = NOW() WHERE id = 1;

-- v2.3.0: 拆分 token 用量为可计费明细。run 级此前只落 total_tokens,丢弃了 AI SDK
-- 已算好的 input/output 及缓存命中/推理明细;这里把它们全部持久化,使计费可按
-- 命中缓存的输入(火山方舟 prompt_tokens_details.cached_tokens,享折扣)与推理 token
-- (计入 output)分别核算。未命中缓存的输入 = input_tokens - cached_input_tokens,查询时计算,不冗余存列。

-- 仅 run 级持久化明细:run 是计费单元。step 级的缓存/推理明细已存在于
-- agent_steps.metadata.usage(完整 LanguageModelUsage),无需再提升为一等列。

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS input_tokens integer NULL,
  ADD COLUMN IF NOT EXISTS output_tokens integer NULL,
  ADD COLUMN IF NOT EXISTS cached_input_tokens integer NULL,
  ADD COLUMN IF NOT EXISTS reasoning_tokens integer NULL;

UPDATE migration SET version = 'v2.3.0', update_time = NOW() WHERE id = 1;

-- v1.3.0: model_providers gains context_window + max_output_tokens.

ALTER TABLE model_providers
  ADD COLUMN IF NOT EXISTS context_window integer NOT NULL DEFAULT 128000,
  ADD COLUMN IF NOT EXISTS max_output_tokens integer NOT NULL DEFAULT 8192;

UPDATE migration SET version = 'v1.3.0', update_time = NOW() WHERE id = 1;

-- Agent (智能体/bot) model configuration: each agent references the model
-- providers it uses for text / image / video generation. Nullable — an agent
-- may leave a capability unconfigured. `updated_at` tracks edits.

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS text_provider_id varchar(32),
  ADD COLUMN IF NOT EXISTS image_provider_id varchar(32),
  ADD COLUMN IF NOT EXISTS video_provider_id varchar(32),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE migration SET version = 'v1.5.0', update_time = NOW() WHERE id = 1;

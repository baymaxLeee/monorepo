ALTER TABLE model_providers ADD COLUMN pricing_json text;

UPDATE migration SET version = 'v1.13.0', update_time = NOW() WHERE id = 1;

DROP TABLE IF EXISTS intentions;
DROP TABLE IF EXISTS scenes;

UPDATE migration SET version = 'v1.12.0', update_time = NOW() WHERE id = 1;

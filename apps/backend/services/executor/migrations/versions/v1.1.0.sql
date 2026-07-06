-- Progress reporting for durable tasks: intermediate {done,total} counters the
-- workflow reports per completed step. Business truth stays here; the live push
-- to the owner (chat) is derived from this column on each update.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress jsonb;

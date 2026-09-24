-- Non-admin performance queries filter by user and return newest events first.
-- The existing timestamp-only index cannot efficiently satisfy both operations.

CREATE INDEX IF NOT EXISTS ix_events_perform_user_ts
  ON events_perform (user_id, ts_server DESC);

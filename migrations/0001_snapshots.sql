-- One row per scheduled 15-minute observation. Payload limits are logical JSON bytes;
-- SQLite page/index overhead is deliberately not represented as a false exact quota.
CREATE TABLE IF NOT EXISTS snapshot_store_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0 AND row_count <= 8640),
  total_payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_payload_bytes >= 0 AND total_payload_bytes <= 134217728)
);

INSERT OR IGNORE INTO snapshot_store_metadata (id) VALUES (1);

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  scheduled_slot TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count > 0 AND byte_count <= 32768)
);

CREATE INDEX IF NOT EXISTS dashboard_snapshots_observed_at ON dashboard_snapshots (observed_at);

CREATE TRIGGER IF NOT EXISTS dashboard_snapshots_capacity
BEFORE INSERT ON dashboard_snapshots
WHEN (SELECT row_count FROM snapshot_store_metadata WHERE id = 1) >= 8640
  OR (SELECT total_payload_bytes FROM snapshot_store_metadata WHERE id = 1) + NEW.byte_count > 134217728
BEGIN
  SELECT RAISE(ABORT, 'snapshot store logical capacity reached');
END;

CREATE TRIGGER IF NOT EXISTS dashboard_snapshots_count_insert
AFTER INSERT ON dashboard_snapshots
BEGIN
  UPDATE snapshot_store_metadata
  SET row_count = row_count + 1,
      total_payload_bytes = total_payload_bytes + NEW.byte_count
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS dashboard_snapshots_count_delete
AFTER DELETE ON dashboard_snapshots
BEGIN
  UPDATE snapshot_store_metadata
  SET row_count = row_count - 1,
      total_payload_bytes = total_payload_bytes - OLD.byte_count
  WHERE id = 1;
END;

-- Ledger of the first and most recent time each tracked item (a stealth slot, a pending
-- architecture module, a scheduled broadcast, ...) was observed, plus a narrow rollup of
-- the DROPCON score itself. Both tables are bounded the same way as 0001: a metadata row
-- tracks counts so a capacity trigger can abort cheaply, and callers evict old rows with a
-- bounded DELETE before every write (see src/infra/snapshot-store.ts).

CREATE TABLE IF NOT EXISTS first_seen_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0 AND row_count <= 20000)
);

INSERT OR IGNORE INTO first_seen_metadata (id) VALUES (1);

-- seeded=1 marks a row created when its `kind` had no prior rows at all: a baseline,
-- never reported as newly seen. last_seen_at lets a caller detect a key disappearing
-- (a stealth slot revealed, a merge reverted) without scanning the whole kind.
CREATE TABLE IF NOT EXISTS first_seen (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  source TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seeded INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1)),
  meta TEXT,
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS first_seen_kind_last_seen ON first_seen (kind, last_seen_at);

CREATE TRIGGER IF NOT EXISTS first_seen_capacity
BEFORE INSERT ON first_seen
WHEN (SELECT row_count FROM first_seen_metadata WHERE id = 1) >= 20000
BEGIN
  SELECT RAISE(ABORT, 'first_seen logical capacity reached');
END;

CREATE TRIGGER IF NOT EXISTS first_seen_count_insert
AFTER INSERT ON first_seen
BEGIN
  UPDATE first_seen_metadata SET row_count = row_count + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS first_seen_count_delete
AFTER DELETE ON first_seen
BEGIN
  UPDATE first_seen_metadata SET row_count = row_count - 1 WHERE id = 1;
END;

-- Narrow DROPCON rollup, read by src/pages/api/history.json.ts. Never add payload_json
-- here: at ~11.6 KB * 8,640 rows a 90-day scan of dashboard_snapshots would approach the
-- 128 MB isolate cap on its own.
CREATE TABLE IF NOT EXISTS score_series_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0 AND row_count <= 8640)
);

INSERT OR IGNORE INTO score_series_metadata (id) VALUES (1);

CREATE TABLE IF NOT EXISTS score_series (
  slot TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  algo_version INTEGER NOT NULL,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL,
  p7 REAL,
  degraded INTEGER NOT NULL DEFAULT 0 CHECK (degraded IN (0, 1))
);

CREATE INDEX IF NOT EXISTS score_series_observed_at ON score_series (observed_at);

CREATE TRIGGER IF NOT EXISTS score_series_capacity
BEFORE INSERT ON score_series
WHEN (SELECT row_count FROM score_series_metadata WHERE id = 1) >= 8640
BEGIN
  SELECT RAISE(ABORT, 'score_series logical capacity reached');
END;

CREATE TRIGGER IF NOT EXISTS score_series_count_insert
AFTER INSERT ON score_series
BEGIN
  UPDATE score_series_metadata SET row_count = row_count + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS score_series_count_delete
AFTER DELETE ON score_series
BEGIN
  UPDATE score_series_metadata SET row_count = row_count - 1 WHERE id = 1;
END;

-- Backfill from every existing observation. json_extract already returns SQLite integers
-- for JSON true/false, so the CASE below is defensive, not corrective. Rows from before
-- `measurement`/`dropcon` existed in the payload are skipped, not faked.
INSERT OR IGNORE INTO score_series (slot, observed_at, algo_version, score, level, p7, degraded)
SELECT
  scheduled_slot,
  observed_at,
  CAST(json_extract(payload_json, '$.measurement.algorithmVersion') AS INTEGER),
  CAST(json_extract(payload_json, '$.dropcon.score') AS INTEGER),
  CAST(json_extract(payload_json, '$.dropcon.level') AS INTEGER),
  CAST(json_extract(payload_json, '$.measurement.inputs.maxWeekOdds') AS REAL),
  CASE WHEN json_extract(payload_json, '$.dropcon.degraded') THEN 1 ELSE 0 END
FROM dashboard_snapshots
WHERE json_extract(payload_json, '$.dropcon.score') IS NOT NULL
  AND json_extract(payload_json, '$.dropcon.level') IS NOT NULL
  AND json_extract(payload_json, '$.measurement.algorithmVersion') IS NOT NULL;

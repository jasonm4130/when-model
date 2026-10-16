-- The release ledger: when each model first became usable by someone outside its lab, across
-- every keyless source, and when a lab announced one (docs/release-forecast-2026-09-27.md,
-- decision 1). Unlike first_seen these rows are never pruned: they are the forward labelled
-- history the release forecast is judged on, and a model re-listed after first_seen's 90-day
-- prune must not become a new release. Bounded the same way as 0001 and 0002: a metadata row
-- counts rows so a capacity trigger can abort cheaply. Writes are INSERT OR IGNORE, so the
-- earliest sighting of a (lab, sku) wins (see src/infra/snapshot-store.ts).

CREATE TABLE IF NOT EXISTS availability_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0 AND row_count <= 50000)
);

INSERT OR IGNORE INTO availability_metadata (id) VALUES (1);

-- One row per canonical model (src/domain/model-id.ts). baseline=1 marks a row written when its
-- source's first_seen kind was seeded: available by then, not first available then, so it never
-- forms a release. source/source_key name the sighting that won; snapshot is the sku's date part.
CREATE TABLE IF NOT EXISTS availability (
  lab_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT,
  first_available_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1)),
  snapshot TEXT,
  PRIMARY KEY (lab_id, sku)
);

-- Release events are derived from the non-baseline rows in time order.
CREATE INDEX IF NOT EXISTS availability_baseline_first ON availability (baseline, first_available_at);

CREATE TRIGGER IF NOT EXISTS availability_capacity
BEFORE INSERT ON availability
WHEN (SELECT row_count FROM availability_metadata WHERE id = 1) >= 50000
BEGIN
  SELECT RAISE(ABORT, 'availability logical capacity reached');
END;

CREATE TRIGGER IF NOT EXISTS availability_count_insert
AFTER INSERT ON availability
BEGIN
  UPDATE availability_metadata SET row_count = row_count + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS availability_count_delete
AFTER DELETE ON availability
BEGIN
  UPDATE availability_metadata SET row_count = row_count - 1 WHERE id = 1;
END;

CREATE TABLE IF NOT EXISTS announcements_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0 AND row_count <= 10000)
);

INSERT OR IGNORE INTO announcements_metadata (id) VALUES (1);

-- One row per announced (lab, sku): a launch-shaped first-party post, or a chat.qwen.ai model
-- listed but switched off. usable_at is the first availability of the earliest same-lab sku that
-- satisfies it (gpt-6 by gpt-6-sol); NULL while it is announced, not yet usable. A usable_at
-- before first_seen_at is a post that lagged its own model.
CREATE TABLE IF NOT EXISTS announcements (
  lab_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  title TEXT,
  published_at TEXT,
  baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1)),
  usable_at TEXT,
  usable_sku TEXT,
  PRIMARY KEY (lab_id, sku)
);

-- Every capture reads the open (usable_at IS NULL) rows, newest first.
CREATE INDEX IF NOT EXISTS announcements_usable_first ON announcements (usable_at, first_seen_at);

CREATE TRIGGER IF NOT EXISTS announcements_capacity
BEFORE INSERT ON announcements
WHEN (SELECT row_count FROM announcements_metadata WHERE id = 1) >= 10000
BEGIN
  SELECT RAISE(ABORT, 'announcements logical capacity reached');
END;

CREATE TRIGGER IF NOT EXISTS announcements_count_insert
AFTER INSERT ON announcements
BEGIN
  UPDATE announcements_metadata SET row_count = row_count + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS announcements_count_delete
AFTER DELETE ON announcements
BEGIN
  UPDATE announcements_metadata SET row_count = row_count - 1 WHERE id = 1;
END;

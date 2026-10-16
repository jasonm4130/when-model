-- A week of current-version DROPCON readings for the browser tests' local D1, ending at the
-- 15-minute slot before the seed ran, so the home page draws "Service history" from a real read
-- instead of its offline line. Scores drift between level 4 and level 3 and back; nothing here is
-- live data. Re-running it replaces the same slots. playwright.config.ts applies the migrations,
-- then this, before it starts the Worker.
WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 671),
slots AS (
  SELECT
    i,
    strftime('%Y-%m-%dT%H:%M:00.000Z', (CAST(strftime('%s', 'now') AS INTEGER) / 900 - 671 + i) * 900, 'unixepoch') AS slot,
    26 + ABS((i % 288) - 144) / 6 AS score
  FROM n
)
INSERT OR REPLACE INTO score_series (slot, observed_at, algo_version, score, level, headline_p, degraded)
SELECT
  slot,
  slot,
  3,
  score,
  CASE WHEN score >= 75 THEN 1 WHEN score >= 55 THEN 2 WHEN score >= 35 THEN 3 WHEN score >= 15 THEN 4 ELSE 5 END,
  score / 80.0,
  0
FROM slots;

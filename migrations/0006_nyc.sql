-- A second city, same machine. New York gets its own trip row; ballots, marks, decisions,
-- and trophies are already keyed by trip id, so nothing else changes.
INSERT OR IGNORE INTO trips (id, start, nights, version, updated_at)
  VALUES ('nyc-2026', '2026-11-29', 7, 1, '2026-09-07T00:00:00Z');
INSERT OR IGNORE INTO trip_versions (trip_id, version, at) VALUES ('nyc-2026', 1, '2026-09-07T00:00:00Z');

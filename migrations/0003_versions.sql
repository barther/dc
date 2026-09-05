-- A transactional version guard. Every accepted write inserts the next version
-- number here first; a stale writer collides on the primary key, the statement
-- throws, and D1 rolls the whole batch back. A zero-row UPDATE never could.
CREATE TABLE IF NOT EXISTS trip_versions (
  trip_id  TEXT NOT NULL REFERENCES trips(id),
  version  INTEGER NOT NULL,
  at       TEXT NOT NULL,
  PRIMARY KEY (trip_id, version)
);
INSERT OR IGNORE INTO trip_versions (trip_id, version, at)
  SELECT id, version, updated_at FROM trips;

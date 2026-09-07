-- Capacity, aggregated by the floor. Each traveler states a pace (1 easy … 4 all out);
-- the party moves at the slowest. Rest days are pauses anyone can call: nothing is
-- scheduled on one, and the future re-plans around it.
CREATE TABLE IF NOT EXISTS trip_capacity (
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  traveler_id TEXT NOT NULL REFERENCES travelers(id),
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
  set_at      TEXT NOT NULL,
  PRIMARY KEY (trip_id, traveler_id)
);
CREATE TABLE IF NOT EXISTS trip_rest_days (
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  date        TEXT NOT NULL,
  set_by      TEXT NOT NULL REFERENCES travelers(id),
  set_at      TEXT NOT NULL,
  PRIMARY KEY (trip_id, date)
);

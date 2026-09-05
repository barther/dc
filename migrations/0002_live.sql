-- Live-trip facts and the accepted placements.

-- What happened, what's committed, what's excluded. One row per (venue, kind).
CREATE TABLE IF NOT EXISTS trip_marks (
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  venue_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('completed', 'fixed', 'not_this_day')),
  date        TEXT NOT NULL,
  set_by      TEXT NOT NULL REFERENCES travelers(id),
  set_at      TEXT NOT NULL,
  PRIMARY KEY (trip_id, venue_id, kind, date)
);

-- The itinerary the family last accepted: unit id -> date. The planner's stability
-- anchor, so a reload never quietly rearranges what everyone already saw.
ALTER TABLE trips ADD COLUMN placements TEXT NOT NULL DEFAULT '{}';

-- Canonical shared trip state. The planner decides what is valid; these tables
-- record which valid state the family actually accepted, and who did it.

CREATE TABLE IF NOT EXISTS travelers (
  id          TEXT PRIMARY KEY,          -- stable internal id, independent of email
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,             -- display role; 'admin' is the only one with teeth
  is_admin    INTEGER NOT NULL DEFAULT 0
);

-- Tenant identities that map to a traveler. Change an email here, not trip history.
CREATE TABLE IF NOT EXISTS traveler_identities (
  email       TEXT PRIMARY KEY,
  traveler_id TEXT NOT NULL REFERENCES travelers(id)
);

CREATE TABLE IF NOT EXISTS trips (
  id          TEXT PRIMARY KEY,
  start       TEXT NOT NULL,             -- arrival date, ISO
  nights      INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);

-- One row per venue that the family has moved off "ordinary recommendation".
CREATE TABLE IF NOT EXISTS trip_venue_state (
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  venue_id    TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('punted', 'pinned', 'requested')),
  set_by      TEXT NOT NULL REFERENCES travelers(id),
  set_at      TEXT NOT NULL,
  PRIMARY KEY (trip_id, venue_id)
);

-- Personal opinions. Not mutations of the shared itinerary; the planner reads them as a signal.
CREATE TABLE IF NOT EXISTS preferences (
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  traveler_id TEXT NOT NULL REFERENCES travelers(id),
  venue_id    TEXT NOT NULL,
  choice      TEXT NOT NULL CHECK (choice IN ('must', 'good', 'meh', 'punt')),
  set_at      TEXT NOT NULL,
  PRIMARY KEY (trip_id, traveler_id, venue_id)
);

-- Every material change: who, when, what, and the planner's one-line consequence.
CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  at          TEXT NOT NULL,
  traveler_id TEXT NOT NULL REFERENCES travelers(id),
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,             -- JSON
  summary     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_trip_at ON decisions(trip_id, at DESC);

INSERT OR IGNORE INTO travelers (id, name, role, is_admin) VALUES
  ('bart',  'Bart',  'Trip Administrator', 1),
  ('jess',  'Jess',  'Passenger',          0),
  ('sam',   'Sam',   'Minor Stakeholder',  0),
  ('nanny', 'Nanny', 'Nanny',              0);

-- Placeholder identities. Replace with the real tenant addresses:
--   wrangler d1 execute dc-christmas --command "UPDATE traveler_identities SET email='...' WHERE traveler_id='bart'"
INSERT OR IGNORE INTO traveler_identities (email, traveler_id) VALUES
  ('bart@example.com',  'bart'),
  ('jess@example.com',  'jess'),
  ('sam@example.com',   'sam'),
  ('nanny@example.com', 'nanny');

INSERT OR IGNORE INTO trips (id, start, nights, version, updated_at)
  VALUES ('dc-2026', '2026-11-29', 7, 1, '2026-01-01T00:00:00Z');

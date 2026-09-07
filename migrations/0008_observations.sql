-- Catalog observations: what a trip taught us about a venue, written as evidence against
-- the compiled model, distinct from the decision log. One row per live-mode event that
-- says something about load or duration, with enough context to tell "Arlington is harder
-- than we thought" from "we had already done something big that morning."
CREATE TABLE IF NOT EXISTS catalog_observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id         TEXT NOT NULL REFERENCES trips(id),
  city            TEXT NOT NULL,             -- catalog id: dc, nyc
  venue_id        TEXT NOT NULL,
  unit_id         TEXT NOT NULL,             -- the schedulable unit it rode in (a bundle id or the venue)
  date            TEXT,                      -- the day it was placed on
  traveler_id     TEXT NOT NULL REFERENCES travelers(id),
  result          TEXT NOT NULL,             -- complete | shortened | bail | moved | punt
  visit_form      TEXT NOT NULL,             -- full | short
  planned_hours   REAL,                      -- the catalog's number for that form
  actual_hours    REAL,                      -- unknown until the app records times; kept for the loop
  party_pace      INTEGER NOT NULL,          -- the floor in force
  prior_day_load  TEXT,                      -- lo | mid | hi | none: the previous day's daytime load
  same_day_other  TEXT,                      -- the other slot's load that day, or none
  weather         TEXT,                      -- the day's categorical conditions as JSON, if known
  reason          TEXT,                      -- free text from the event, if any
  at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_observations_venue ON catalog_observations(city, venue_id);

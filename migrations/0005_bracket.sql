-- The bracket. One row per pick per traveler; a ballot is the set of a traveler's
-- picks. Completed ballots (every game decided) count toward the family's order.
-- Rerunning a bracket deletes the traveler's rows; the decision log says who did.
CREATE TABLE IF NOT EXISTS bracket_picks (
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  traveler_id TEXT NOT NULL REFERENCES travelers(id),
  game        TEXT NOT NULL,             -- game id from bracket.js: p1, r16-3, r8-1, r4-2, third, final
  winner      TEXT NOT NULL,             -- contender id: a bundle id or a venue id
  at          TEXT NOT NULL,
  PRIMARY KEY (trip_id, traveler_id, game)
);

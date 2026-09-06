-- Opinions on decisions. Anyone on the trip can open a log entry and say
-- "fine by me" or "I object", with a short note. One opinion per traveler per
-- decision; filing again replaces it, withdrawing deletes it.
CREATE TABLE IF NOT EXISTS decision_opinions (
  decision_id INTEGER NOT NULL REFERENCES decisions(id),
  traveler_id TEXT NOT NULL REFERENCES travelers(id),
  stance      TEXT NOT NULL,             -- 'fine' | 'object'
  note        TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL,
  PRIMARY KEY (decision_id, traveler_id)
);

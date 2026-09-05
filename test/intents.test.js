// Intent semantics and the admin boundary. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/intents.js");
const P = require("../public/planner.js");

const limits = { MIN_NIGHTS: P.MIN_NIGHTS, MAX_NIGHTS: P.MAX_NIGHTS, validVenue: (id) => P.catalog.venues.some((v) => v.id === id) };
const bart = { id: "bart", name: "Bart", is_admin: 1 }, jess = { id: "jess", name: "Jess", is_admin: 0 };
const base = () => ({ start: "2026-11-29", nights: 7, venues: {}, preferences: {} });

test("anyone can operate the vacation", () => {
  for (const t of ["punt", "pin", "ask", "unpunt", "unpin", "unask", "prefer"]) assert.ok(I.can(jess, t), t);
  const r = I.apply(base(), { type: "punt", venue: "natural-history", name: "Natural History" }, jess, limits);
  assert.equal(r.state.venues["natural-history"], "punted");
  assert.match(r.summary, /^Jess punted/);
});

test("Bart administers the vacation", () => {
  for (const t of ["set_dates", "set_nights", "reset", "override_preference"]) {
    assert.ok(!I.can(jess, t), t); assert.ok(I.can(bart, t), t);
    assert.equal(I.apply(base(), { type: t, start: "2026-12-01", nights: 6, venue: "arlington", traveler: "sam" }, jess, limits).status, 403);
  }
  assert.equal(I.apply(base(), { type: "set_nights", nights: 5 }, bart, limits).state.nights, 5);
  assert.equal(I.apply(base(), { type: "set_nights", nights: 40 }, bart, limits).status, 400);
});

test("bundle members move together", () => {
  const r = I.apply(base(), { type: "punt", venue: "us-capitol", members: ["us-capitol", "library-of-congress"] }, jess, limits);
  assert.equal(r.state.venues["library-of-congress"], "punted");
});

test("unknown venues and intents are rejected", () => {
  assert.equal(I.apply(base(), { type: "punt", venue: "disney" }, jess, limits).status, 400);
  assert.equal(I.apply(base(), { type: "teleport" }, bart, limits).status, 403);
});

test("personal preferences are opinions, interpreted as a group", () => {
  let s = base();
  s = I.apply(s, { type: "prefer", venue: "natural-history", choice: "must" }, { id: "sam", name: "Sam" }, limits).state;
  assert.deepEqual(I.plannerState(s).pinned, ["natural-history"]);
  s = I.apply(s, { type: "prefer", venue: "spy-museum", choice: "punt" }, jess, limits).state;
  assert.deepEqual(I.plannerState(s).punted, [], "one punt is an opinion, not a removal");
  s = I.apply(s, { type: "prefer", venue: "spy-museum", choice: "punt" }, bart, limits).state;
  assert.deepEqual(I.plannerState(s).punted, ["spy-museum"], "everyone who spoke says punt");
  s = I.apply(s, { type: "prefer", venue: "georgetown", choice: "good" }, { id: "nanny", name: "Nanny" }, limits).state;
  assert.deepEqual(I.plannerState(s).requested, ["georgetown"], "sounds good asks the planner to find room");
  s = I.apply(s, { type: "prefer", venue: "georgetown", choice: "punt" }, jess, limits).state;
  assert.deepEqual(I.plannerState(s).requested, [], "a split vote leaves it to seed and capacity");
});

test("an administrator's explicit shared state wins over the vote", () => {
  let s = base();
  s = I.apply(s, { type: "prefer", venue: "arlington", choice: "must" }, { id: "sam", name: "Sam" }, limits).state;
  s = I.apply(s, { type: "punt", venue: "arlington" }, bart, limits).state;
  assert.deepEqual(I.plannerState(s).punted, ["arlington"]);
});

test("a must-do still goes through the planner's preview when it costs something", () => {
  const before = P.plan({ start: "2026-11-29", nights: 5 }, {});
  const s = I.apply({ ...base(), nights: 5 }, { type: "prefer", venue: "spy-museum", choice: "must" }, { id: "sam", name: "Sam" }, limits).state;
  const after = P.plan({ start: s.start, nights: s.nights }, I.plannerState(s), before);
  assert.ok(P.diff(before, after, ["spy-museum"]).consequential, "Sam really wants this is a constraint, not permission to detonate Tuesday");
});

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

test("live-trip intents are anyone's: complete, not this day, place, bail, swap", () => {
  let s = base();
  for (const t of ["complete", "uncomplete", "not_this_day", "place", "unplace", "bail", "swap"]) assert.ok(I.can(jess, t), t);
  s = I.apply(s, { type: "complete", venue: "air-space", date: "2026-11-30" }, jess, limits).state;
  assert.equal(s.completed["air-space"], "2026-11-30");
  s = I.apply(s, { type: "not_this_day", venue: "arlington", date: "2026-12-04" }, jess, limits).state;
  assert.deepEqual(s.notThisDay["arlington"], ["2026-12-04"]);
  s = I.apply(s, { type: "swap", moves: [{ venue: "arlington", date: "2026-12-03" }, { venue: "natural-history", date: "2026-12-04" }], reason: "rain" }, jess, limits).state;
  assert.equal(s.fixed["arlington"], "2026-12-03");
  const r = I.apply(s, { type: "bail", venue: "arlington", date: "2026-12-03" }, { id: "sam", name: "Sam" }, limits);
  assert.match(r.summary, /bailed on/);
  assert.ok(!r.state.fixed["arlington"] && r.state.notThisDay["arlington"].includes("2026-12-03"));
  const ps = I.plannerState(r.state);
  assert.equal(ps.completed["air-space"], "2026-11-30");
});

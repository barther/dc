const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../public/achievements.js");
const C = require("../public/venues.js");

const facts = (over) => ({ travelerId: "sam", isAdmin: false, completed: {}, bundles: C.bundles, decisions: [], preferences: {}, phase: "live", hadHiHi: false, unlockedByTraveler: {}, ...over });

test("discovery achievements come from completion, and a bundle needs every member", () => {
  assert.deepEqual(A.evaluate(facts({ completed: { "national-archives": "2026-12-02" } })), ["we-the-people"]);
  assert.ok(!A.evaluate(facts({ completed: { "us-capitol": "2026-12-01" } })).includes("checks-and-balances"));
  assert.ok(A.evaluate(facts({ completed: { "us-capitol": "2026-12-01", "library-of-congress": "2026-12-01" } })).includes("checks-and-balances"));
});

test("judgment achievements come from decisions, mine or anyone's as defined", () => {
  const mine = A.evaluate(facts({ decisions: [{ type: "swap", traveler_id: "sam", payload: {} }] }));
  assert.ok(mine.includes("weather-wizard") && mine.includes("plan-not-sacred"));
  assert.ok(!A.evaluate(facts({ decisions: [{ type: "swap", traveler_id: "jess", payload: {} }] })).includes("weather-wizard"));
  assert.ok(A.evaluate(facts({ decisions: [{ type: "bail", traveler_id: "jess", payload: {} }] })).includes("twenty-dollar-solution"));
  assert.ok(A.evaluate(facts({ decisions: [{ type: "prefer", traveler_id: "sam", payload: { choice: "punt" } }] })).includes("strategic-withdrawal"));
});

test("trip achievements need the trip to be over, and Clark needs to be the administrator", () => {
  assert.ok(!A.evaluate(facts({ phase: "live" })).includes("wally-world"));
  const after = A.evaluate(facts({ phase: "after" }));
  assert.ok(after.includes("wally-world") && after.includes("no-death-march") && !after.includes("clark-griswold"));
  assert.ok(A.evaluate(facts({ phase: "after", isAdmin: true })).includes("clark-griswold"));
  assert.ok(!A.evaluate(facts({ phase: "after", hadHiHi: true })).includes("no-death-march"));
});

test("nothing rewards suffering: no rule counts steps or attraction totals", () => {
  for (const d of A.defs) assert.ok(!/steps|walk|count_total|max/.test(JSON.stringify(d.rule)), d.id);
});

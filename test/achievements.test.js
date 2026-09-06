const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../public/achievements.js");
const C = require("../public/venues.js");

const FAMILY = ["bart", "jess", "sam", "nanny"];
const facts = (over) => ({ travelerId: "sam", isAdmin: false, completed: {}, bundles: C.bundles, decisions: [], preferences: {}, phase: "live", hadHiHi: false, unlockedByTraveler: {}, travelerIds: FAMILY, ...over });

test("discovery achievements come from completion, and a bundle needs every member", () => {
  const family = (ids) => ids.filter((id) => !A.byId[id].track);
  assert.deepEqual(family(A.evaluate(facts({ completed: { "national-archives": "2026-12-02" } }))), ["we-the-people"]);
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

test("Four Score counts every traveler on the trip, not just those already on the board", () => {
  const three = { bart: ["a", "b", "c", "d"], jess: ["a", "b", "c", "d"], sam: ["a", "b", "c", "d"] };
  assert.ok(!A.evaluate(facts({ unlockedByTraveler: three })).includes("four-score"), "Nanny has none yet");
  assert.ok(A.evaluate(facts({ unlockedByTraveler: { ...three, nanny: ["a", "b", "c", "d"] } })).includes("four-score"));
});

test("Sam's blue cards evaluate for Sam alone, and never count toward the standings rules", () => {
  const done = { "us-capitol": "2026-12-01", "washington-monument": "2026-12-02", "arlington": "2026-12-04" };
  const sam = A.evaluate(facts({ completed: done }));
  assert.ok(["day-and-night", "two-angles"].every((id) => sam.includes(id)));
  assert.ok(!sam.includes("three-of-six"), "one of the subject stops is not three of six");
  assert.ok(A.evaluate(facts({ completed: { ...done, zoolights: "2026-12-05" } })).includes("three-of-six"));
  const bart = A.evaluate(facts({ travelerId: "bart", completed: done }));
  assert.ok(bart.every((id) => !A.byId[id].track), "no blue cards for anyone but Sam");
  // Photos are a fact of their own
  assert.ok(!A.evaluate(facts({ photos: 0 })).includes("first-frame"));
  assert.ok(A.evaluate(facts({ photos: 1 })).includes("first-frame"));
  assert.ok(!A.evaluate(facts({ photos: 7 })).includes("eight-to-twelve"));
  assert.ok(A.evaluate(facts({ photos: 8 })).includes("eight-to-twelve"));
  // Nothing on the track is a badge Sam already holds or turned down
  for (const d of A.defs.filter((d) => d.track)) assert.ok(!/Citizenship in the Nation|Art \d/.test(d.badge), d.id);
  // Four Score counts family trophies only: thirteen blue cards do not make four achievements
  const cards = A.defs.filter((d) => d.track).map((d) => d.id);
  const u = { bart: ["a", "b", "c", "d"], jess: ["a", "b", "c", "d"], nanny: ["a", "b", "c", "d"], sam: cards };
  assert.ok(!A.evaluate(facts({ travelerId: "bart", unlockedByTraveler: u })).includes("four-score"));
  u.sam = ["a", "b", "c", "d", ...cards];
  assert.ok(A.evaluate(facts({ travelerId: "bart", unlockedByTraveler: u })).includes("four-score"));
});

test("the bracket trophies: a landslide needs every ballot, a buster is personal, Cinderella is a seed", () => {
  const seeds = { a: 1, b: 2, c: 13, d: 17 };
  const all = (ch) => Object.fromEntries(FAMILY.map((t) => [t, { champion: ch }]));
  assert.ok(A.evaluate(facts({ bracket: { ballots: all("a"), familyRank: ["a", "b", "c", "d"], seeds } })).includes("landslide"));
  assert.ok(!A.evaluate(facts({ bracket: { ballots: { ...all("a"), nanny: undefined }, familyRank: ["a", "b"], seeds } })).includes("landslide"), "three ballots is not every ballot");
  assert.ok(!A.evaluate(facts({ bracket: { ballots: { ...all("a"), sam: { champion: "b" } }, familyRank: ["a", "b"], seeds } })).includes("landslide"));
  const buster = A.evaluate(facts({ bracket: { ballots: { ...all("a"), sam: { champion: "b" } }, familyRank: ["a", "b"], seeds } }));
  assert.ok(buster.includes("bracket-buster"));
  assert.ok(!A.evaluate(facts({ travelerId: "jess", bracket: { ballots: { ...all("a"), sam: { champion: "b" } }, familyRank: ["a", "b"], seeds } })).includes("bracket-buster"));
  assert.ok(A.evaluate(facts({ bracket: { ballots: all("a"), familyRank: ["a", "b", "c", "d"], seeds } })).includes("cinderella"));
  assert.ok(!A.evaluate(facts({ bracket: { ballots: all("a"), familyRank: ["a", "b", "d", "c"].slice(0, 2), seeds } })).includes("cinderella"));
  assert.ok(!A.evaluate(facts({})).some((id) => ["landslide", "bracket-buster", "cinderella"].includes(id)), "no bracket, no trophies");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../public/bracket.js");
const C = require("../public/venues.js");

const cs = B.contenders(C);
const ids = cs.map((c) => c.id);

// Fill a bracket by always picking the better seed, or by a chooser.
function fill(struct, ids, choose) {
  const picks = {};
  for (let guard = 0; guard < 100; guard++) {
    const r = B.resolve(struct, ids, picks);
    if (!r.next) return picks;
    picks[r.next.id] = choose(r.next, r);
  }
  throw new Error("bracket never completed");
}
const chalk = (g) => (ids.indexOf(g.a) < ids.indexOf(g.b) ? g.a : g.b);

test("contenders are units: four bundles, thirteen standalones, seeded from the regret list, no accessories", () => {
  assert.equal(cs.length, 17);
  assert.deepEqual(cs.slice(0, 3).map((c) => c.id), ["capitol-hill", "national-archives", "main-memorial-loop"]);
  assert.equal(cs[16].id, "spy-museum");
  assert.ok(!ids.includes("holiday-market") && !ids.includes("lincoln-memorial"));
  assert.deepEqual(cs.map((c) => c.seed), [...Array(17)].map((_, i) => i + 1));
  assert.equal(cs.find((c) => c.id === "main-memorial-loop").members.length, 4);
});

test("seventeen contenders is a sixteen-bracket with one play-in; the roster can grow", () => {
  const s17 = B.structure(17);
  assert.equal(s17.games.filter((g) => g.round === "playin").length, 1);
  assert.deepEqual(s17.games[0].from, [{ seed: 16 }, { seed: 17 }]);
  assert.equal(s17.picksNeeded, 17);
  const s18 = B.structure(18);
  assert.deepEqual(s18.games.filter((g) => g.round === "playin").map((g) => g.from), [[{ seed: 15 }, { seed: 18 }], [{ seed: 16 }, { seed: 17 }]]);
  assert.equal(B.structure(16).picksNeeded, 16);
  // fewer than sixteen: byes decide themselves and are not picks
  assert.equal(B.structure(12).picksNeeded, 12);
});

test("picks advance in order, only between the two contenders on the screen", () => {
  const s = B.structure(17);
  let r = B.resolve(s, ids, {});
  assert.equal(r.next.id, "p1"); assert.deepEqual([r.next.a, r.next.b], ["zoolights", "spy-museum"]);
  assert.ok(!B.valid(s, ids, {}, "p1", "capitol-hill"), "not in this game");
  assert.ok(!B.valid(s, ids, {}, "r16-1", "capitol-hill"), "the 16 seed is not known yet");
  assert.ok(B.valid(s, ids, {}, "p1", "spy-museum"));
  r = B.resolve(s, ids, { p1: "spy-museum" });
  assert.equal(r.next.id, "r16-1"); assert.deepEqual([r.next.a, r.next.b], ["capitol-hill", "spy-museum"]);
  assert.equal(r.picksMade, 1); assert.equal(r.picksNeeded, 17);
  // a pick that names a non-participant is ignored, not applied
  r = B.resolve(s, ids, { p1: "capitol-hill" });
  assert.equal(r.next.id, "p1");
});

test("a completed bracket is a total order with lost-to ordering", () => {
  const s = B.structure(17);
  const picks = fill(s, ids, chalk);
  const r = B.resolve(s, ids, picks);
  assert.ok(r.complete);
  const order = B.ranking(s, ids, picks);
  assert.equal(order.length, 17);
  assert.equal(new Set(order).size, 17);
  assert.deepEqual(order.slice(0, 4), ["capitol-hill", "national-archives", "main-memorial-loop", "air-space"]);
  // Pure chalk: the 16 seed lost to the champion in the round of 16, so it heads that round's losers.
  const r16Losers = order.slice(8, 16);
  assert.equal(r16Losers[0], "zoolights");
  assert.equal(order[16], "spy-museum", "the play-in loser is last");
  // An upset: the 9 seed over the 8 seed, then to the semis. It should rank 3 or 4.
  const upset = fill(s, ids, (g) => (g.id === "r16-2" ? "african-american-history" : g.id === "r8-1" ? "african-american-history" : chalk(g)));
  const o2 = B.ranking(s, ids, upset);
  assert.ok(o2.indexOf("african-american-history") <= 3);
  // The 1 seed lost to it in the quarterfinals. Its conqueror finished fourth, behind the
  // other quarterfinal winners, so the 1 seed is the last of the quarterfinal losers: 8th.
  assert.equal(o2[7], "capitol-hill");
  assert.equal(o2.indexOf("african-american-history"), 3);
});

test("the family's order averages completed ballots, locks champions, and breaks ties by seed", () => {
  const s = B.structure(17);
  const bart = B.ranking(s, ids, fill(s, ids, chalk));
  const nanny = B.ranking(s, ids, fill(s, ids, (g) => (g.a === "national-cathedral" || g.b === "national-cathedral" ? "national-cathedral" : chalk(g))));
  assert.equal(nanny[0], "national-cathedral");
  const half = { p1: "spy-museum" };
  const fam = B.familyOrder({ bart, nanny, sam: half }, ids);
  assert.equal(fam.length, 17);
  assert.ok(fam[0].protected && fam[1].protected);
  assert.deepEqual(fam.slice(0, 2).map((r) => r.id).sort(), ["capitol-hill", "national-cathedral"].sort());
  const cathedral = fam.find((r) => r.id === "national-cathedral");
  assert.equal(cathedral.ranks.nanny, 1);
  assert.ok(cathedral.mean > 3, "one champion vote does not make a consensus, protection does");
  assert.ok(!("sam" in cathedral.ranks), "half a ballot counts for nothing");
  assert.deepEqual(B.familyOrder({ sam: half }, ids), []);
  // ties: identical ballots leave every mean tied, so the seed order holds
  const same = B.familyOrder({ bart, jess: bart }, ids).map((r) => r.id);
  assert.deepEqual(same, bart);
});

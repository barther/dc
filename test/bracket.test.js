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
  // Every contender says what it holds: the White House is inside Christmas Washington, the market rides along.
  const xmas = cs.find((c) => c.id === "christmas-washington");
  assert.deepEqual(xmas.stops.map((s) => s.id), ["white-house", "national-christmas-tree", "holiday-market"]);
  assert.ok(xmas.stops[2].rides && !xmas.stops[0].rides);
  assert.equal(xmas.hours, 2);
  assert.equal(cs.find((c) => c.id === "capitol-hill").reservation, "required");
  assert.equal(cs.find((c) => c.id === "georgetown").reservation, "none");
  for (const c of cs) assert.ok(c.stops.length >= 1 && c.hours > 0, c.id);
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

test("every contender knows how far it is from the hotel and whether that's a walk", () => {
  const air = cs.find((c) => c.id === "air-space"), cath = cs.find((c) => c.id === "national-cathedral"), arl = cs.find((c) => c.id === "arlington");
  assert.ok(air.miles < 1 && air.go === "walk");
  assert.ok(cath.miles > 3 && cath.go === "ride");
  assert.equal(arl.go, "metro");
  for (const c of cs) assert.ok(typeof c.miles === "number" && c.miles >= 0, c.id);
});

test("the New York catalog seeds twenty-one contenders: a sixteen with five play-ins", () => {
  const NYC = require("../public/venues-nyc.js");
  const ny = B.contenders(NYC);
  assert.equal(ny.length, 21);
  assert.equal(B.structure(ny.length).games.filter((g) => g.round === "playin").length, 5);
  assert.equal(ny[0].id, "rockefeller-christmas");
  const xmas = ny.find((c) => c.id === "rockefeller-christmas");
  assert.deepEqual(xmas.stops.map((s) => s.id), ["rockefeller-christmas", "fifth-avenue-christmas", "st-patricks"]);
  assert.ok(ny.every((c) => NYC.copy[c.id] && NYC.copy[c.id].body.length), "every contender has copy");
  assert.equal(ny.find((c) => c.id === "liberty-ellis").go, "subway");
});

test("the seeding round: buckets decide who faces whom, and nothing else", () => {
  // No buckets: the authored order, untouched.
  assert.deepEqual(B.draw(ids, {}, "x"), ids);
  // Four favorites in bucket one never meet before the quarterfinals; the rest hold their tiers.
  const favs = ["spy-museum", "zoolights", "georgetown", "fords-theatre"]; // low authored seeds on purpose
  const buckets = Object.fromEntries(favs.map((id) => [id, 1]));
  buckets["capitol-hill"] = 3;
  const mine = B.draw(ids, buckets, "dc-2026:sam");
  assert.deepEqual(new Set(mine.slice(0, 4)), new Set(favs), "bucket one leads the order");
  assert.equal(mine[mine.length - 1], "capitol-hill", "bucket three trails, whatever its authored seed");
  assert.equal(mine.length, ids.length);
  // Stable: the same salt gives the same draw; a different traveler gets a different shuffle within a bucket.
  assert.deepEqual(B.draw(ids, buckets, "dc-2026:sam"), mine);
  const bart = B.draw(ids, { ...buckets }, "dc-2026:bart");
  assert.deepEqual(new Set(bart.slice(0, 4)), new Set(favs));
  // Spread: with the personal order, no round-of-16 game pairs two favorites.
  const s = B.structure(ids.length);
  const r = B.resolve(s, mine, {});
  for (const g of r.games) if (g.round === "r16" || g.round === "playin") assert.ok(!(favs.includes(g.a) && favs.includes(g.b)), `${g.id} pairs two favorites`);
  // Guardrail: the family's order knows nothing about buckets. Same ballots, same order, whatever the draw was.
  const ballot = B.ranking(s, mine, fill(s, mine, (g) => (mine.indexOf(g.a) < mine.indexOf(g.b) ? g.a : g.b)));
  assert.deepEqual(B.familyOrder({ sam: ballot }, ids).map((x) => x.id), ballot, "the family's order is built from results only");
});

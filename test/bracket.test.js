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

/* ───────────── Close calls, challenges, boundary questions ───────────── */

const s17 = B.structure(17);
const chalkPicks = fill(s17, ids, chalk);
const base = B.ranking(s17, ids, chalkPicks);
// Pure chalk: the champion (seed 1) beat the 16 slot in r16-1. That loser heads the r16 block: 9th.
const r16Loser = B.resolve(s17, ids, chalkPicks).games.find((g) => g.id === "r16-1").loser;

test("a close loss lifts the loser exactly one block, and flags never stack", () => {
  assert.equal(base.indexOf(r16Loser), 8, "home: first of the round-of-16 losers");
  const lifted = B.ranking(s17, ids, { ...chalkPicks, "close:r16-1": "1" });
  assert.equal(lifted.indexOf(r16Loser), 5, "one block up: behind the native who lost to the same conqueror later");
  // A second close flag on a game it did not lose changes nothing; a contender loses once.
  const twice = B.ranking(s17, ids, { ...chalkPicks, "close:r16-1": "1", "close:r8-1": "1", "close:final": "1" });
  assert.equal(twice.indexOf(r16Loser), 5);
  // The play-in loser lifts into the round-of-16 block, and no further. With one play-in its
  // conqueror went the least far of anyone, so it keeps the same seat; the block is what changed.
  const pl = base[16];
  const plUp = B.rankingInfo(s17, ids, { ...chalkPicks, "close:p1": "1" });
  assert.deepEqual(plUp.promoted, [pl]); assert.equal(plUp.order.indexOf(pl), 16);
  // With five play-ins (New York), a close play-in loss lands ahead of every other play-in loser.
  const NYC = require("../public/venues-nyc.js");
  const ny = B.contenders(NYC).map((c) => c.id), sN = B.structure(ny.length);
  const pN = fill(sN, ny, (g) => (ny.indexOf(g.a) < ny.indexOf(g.b) ? g.a : g.b));
  const rN = B.resolve(sN, ny, pN);
  const plLosers = rN.games.filter((g) => g.round === "playin").map((g) => g.loser);
  const liftedN = B.ranking(sN, ny, { ...pN, "close:p1": "1" });
  const me = rN.games.find((g) => g.id === "p1").loser;
  assert.ok(liftedN.indexOf(me) <= 16, "inside the round-of-16 block");
  for (const other of plLosers) if (other !== me) assert.ok(liftedN.indexOf(other) > liftedN.indexOf(me), `${other} stays behind`);
});

test("a close loss in the quarterfinals sorts to the front of its own block and never reaches the top four", () => {
  const games = B.resolve(s17, ids, chalkPicks).games;
  const r8 = games.filter((g) => g.round === "r8");
  for (const g of r8) {
    const o = B.ranking(s17, ids, { ...chalkPicks, [`close:${g.id}`]: "1" });
    assert.deepEqual(o.slice(0, 4), base.slice(0, 4), "the top four are settled by real games");
    assert.ok(o.indexOf(g.loser) >= 4 && o.indexOf(g.loser) <= 7, `${g.loser} stays in the quarterfinal block`);
  }
  // Every quarterfinal close at once: still the same block, still behind the top four.
  const all = B.ranking(s17, ids, { ...chalkPicks, ...Object.fromEntries(r8.map((g) => [`close:${g.id}`, "1"])) });
  assert.deepEqual(all.slice(0, 8), base.slice(0, 8));
});

test("the Intrepid case: a close round-of-16 loss to the eventual champion finishes 6th, not 9th", () => {
  const NYC = require("../public/venues-nyc.js");
  const ny = B.contenders(NYC).map((c) => c.id);
  const s = B.structure(ny.length);
  // Intrepid takes the 16 slot; seed 1 (A) beats it in r16-1 and goes on to win the final.
  const A = ny[0], intrepid = "intrepid";
  const order = ny.filter((id) => id !== intrepid); order.splice(15, 0, intrepid);
  const picks = fill(s, order, (g) => (g.a === intrepid && g.round === "playin" ? intrepid : g.b === intrepid && g.round === "playin" ? intrepid : order.indexOf(g.a) < order.indexOf(g.b) ? g.a : g.b));
  const r = B.resolve(s, order, picks);
  const game = r.games.find((g) => g.round === "r16" && (g.a === intrepid || g.b === intrepid));
  assert.equal(game.winner, A); assert.equal(game.loser, intrepid);
  const before = B.ranking(s, order, picks);
  assert.equal(before[0], A);
  assert.equal(before.indexOf(intrepid), 8, "buried nine deep");
  const after = B.ranking(s, order, { ...picks, [`close:${game.id}`]: "1" });
  assert.equal(after.indexOf(intrepid), 5, "lifted into the quarterfinal block, behind the native A also beat");
  assert.equal(after.length, ny.length); assert.equal(new Set(after).size, ny.length);
});

test("a promoted contender sorts behind a native with the same conqueror", () => {
  const games = B.resolve(s17, ids, chalkPicks).games;
  const champ = base[0];
  const nativeLoser = games.find((g) => g.round === "r8" && g.winner === champ).loser;
  const o = B.ranking(s17, ids, { ...chalkPicks, "close:r16-1": "1" });
  assert.equal(o.indexOf(nativeLoser), 4);
  assert.equal(o.indexOf(r16Loser), 5);
});

test("ranking stays a total order under any mix of promotions and challenges", () => {
  const games = B.resolve(s17, ids, chalkPicks).games;
  const closes = Object.fromEntries(games.filter((g) => !g.auto).map((g) => [`close:${g.id}`, "1"]));
  const chals = {};
  for (let i = 0; i < ids.length; i += 3) chals[B.pairKey(ids[i], ids[(i + 5) % ids.length])] = ids[(i + 5) % ids.length];
  for (const picks of [{ ...chalkPicks, ...closes }, { ...chalkPicks, ...chals }, { ...chalkPicks, ...closes, ...chals }]) {
    const o = B.ranking(s17, ids, picks);
    assert.equal(o.length, 17); assert.equal(new Set(o).size, 17);
    assert.deepEqual([...o].sort(), [...ids].sort());
  }
  const info = B.rankingInfo(s17, ids, { ...chalkPicks, "close:r16-1": "1" });
  assert.deepEqual(info.promoted, [r16Loser]);
});

test("a challenge moves the winner to just before the loser and nothing else", () => {
  const w = base[10], l = base[6];
  const o = B.ranking(s17, ids, { ...chalkPicks, [B.pairKey(w, l)]: w });
  assert.equal(o.indexOf(w), 6); assert.equal(o.indexOf(l), 7);
  const rest = (arr) => arr.filter((x) => x !== w);
  assert.deepEqual(rest(o), rest(base), "everything else keeps its relative order");
  // A challenge the loser already trails is a no-op.
  assert.deepEqual(B.ranking(s17, ids, { ...chalkPicks, [B.pairKey(base[2], base[9])]: base[2] }), base);
  // Unknown ids are ignored.
  assert.deepEqual(B.ranking(s17, ids, { ...chalkPicks, "chal:nope:zzz": "nope" }), base);
});

test("challenges apply in key order, which the Worker keeps as time order; the later one is honored last", () => {
  const [P, Q, R] = [base[5], base[6], base[7]];
  const first = B.ranking(s17, ids, { ...chalkPicks, [B.pairKey(P, R)]: R, [B.pairKey(Q, R)]: Q });
  assert.deepEqual(first.slice(5, 8), [Q, R, P]);
  const flipped = B.ranking(s17, ids, { ...chalkPicks, [B.pairKey(Q, R)]: Q, [B.pairKey(P, R)]: R });
  assert.deepEqual(flipped.slice(5, 8), [R, P, Q]);
});

test("an intransitive challenge set terminates and yields a valid total order", () => {
  const [a, b, c] = [base[4], base[5], base[6]];
  const o = B.ranking(s17, ids, { ...chalkPicks, [B.pairKey(c, a)]: c, [B.pairKey(a, b)]: a, [B.pairKey(b, c)]: b });
  assert.equal(o.length, 17); assert.equal(new Set(o).size, 17);
  assert.deepEqual(new Set(o.slice(4, 7)), new Set([a, b, c]), "the three stay in their block; the last answer is the one that holds");
});

test("intensity never crosses ballots: same personal rankings, different close and challenge rows, byte-identical family order", () => {
  // A close flag on the quarterfinal loser already first in its block, and a challenge its winner already leads: the ranking is unchanged.
  const games = B.resolve(s17, ids, chalkPicks).games;
  const g = games.find((x) => x.round === "r8" && x.winner === base[0]);
  const loud = { ...chalkPicks, [`close:${g.id}`]: "1", [B.pairKey(base[1], base[12])]: base[1], "ladder:zoolights": "closed" };
  const quiet = chalkPicks;
  assert.deepEqual(B.ranking(s17, ids, loud), B.ranking(s17, ids, quiet));
  const nanny = B.ranking(s17, ids, fill(s17, ids, (x) => (x.a === "national-cathedral" || x.b === "national-cathedral" ? "national-cathedral" : chalk(x))));
  const fam = (p) => JSON.stringify(B.familyOrder({ bart: B.ranking(s17, ids, p), nanny }, ids));
  assert.equal(fam(loud), fam(quiet));
  assert.equal(B.challengesUsed(loud), 1); assert.equal(B.challengesUsed(quiet), 0);
});

test("boundary questions straddle a cut, skip pairs already compared, and ask at most one per cut", () => {
  const games = B.resolve(s17, ids, chalkPicks).games;
  const cuts = { protect: 4, mustSee: 13 };
  const qs = B.questions(base, cuts, chalkPicks, { games, promoted: [], means: {}, mine: {} });
  assert.ok(qs.length <= 2);
  const cutNames = qs.map((q) => q.cut);
  assert.equal(new Set(cutNames).size, cutNames.length, "one per cut");
  for (const q of qs) {
    const k = cuts[q.cut], ia = base.indexOf(q.a), ib = base.indexOf(q.b);
    assert.ok(ia >= k - 2 && ia < k && ib >= k && ib < k + 2, `${q.a} vs ${q.b} straddles the ${q.cut} cut`);
    assert.ok(!games.some((g) => (g.a === q.a && g.b === q.b) || (g.a === q.b && g.b === q.a)), "never a bracket game they already played");
    assert.ok(q.reason.length > 10);
  }
  // A pair already challenged is never asked again; with every straddling pair compared, nothing is asked.
  const answered = { ...chalkPicks };
  for (const x of base.slice(2, 4)) for (const y of base.slice(4, 6)) answered[B.pairKey(x, y)] = x;
  for (const x of base.slice(11, 13)) for (const y of base.slice(13, 15)) answered[B.pairKey(x, y)] = x;
  assert.deepEqual(B.questions(base, cuts, answered, { games }), []);
  // A promoted contender on the bubble is asked about first.
  const lifted = B.questions(base, cuts, chalkPicks, { games, promoted: [base[4]], means: {}, mine: {} });
  assert.ok(lifted.find((q) => q.cut === "protect" && (q.a === base[4] || q.b === base[4])));
  // Cuts past the end of the order ask nothing.
  assert.deepEqual(B.questions(base.slice(0, 3), cuts, chalkPicks, { games }), []);
  // Each cut asks once per ballot: an answered cut stays quiet however the order drifts.
  const once = B.questions(base, cuts, { ...chalkPicks, "asked:protect": "chal:x:y" }, { games });
  assert.ok(once.every((q) => q.cut !== "protect") && once.length === 1);
  assert.deepEqual(B.questions(base, cuts, { ...chalkPicks, "asked:protect": "1", "asked:mustSee": "1" }, { games }), []);
});

test("a ladder climbs nearest-first and never starts above the immediate neighbor", () => {
  assert.deepEqual(B.ladder(base, base[9]), [base[8], base[7], base[6]]);
  assert.deepEqual(B.ladder(base, base[9], 1), [base[8]]);
  assert.deepEqual(B.ladder(base, base[1]), [base[0]]);
  assert.deepEqual(B.ladder(base, base[0]), []);
  assert.deepEqual(B.ladder(base, "nope"), []);
});

test("the budget counts ladders opened, not boundary answers", () => {
  const picks = { ...chalkPicks, "ladder:zoolights": "1", "ladder:georgetown": "closed", [B.pairKey(base[3], base[4])]: base[4], [B.pairKey(base[12], base[13])]: base[13] };
  assert.equal(B.challengesUsed(picks), 2, "two ladders, whatever the boundary questions did");
  assert.equal(B.challengesUsed({ ...chalkPicks, [B.pairKey(base[3], base[4])]: base[4] }), 0);
});

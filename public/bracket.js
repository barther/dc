/*
 * The bracket. Pure: a catalog in, contenders and a draw out; picks in, a
 * ranking out; ballots in, the family's order out. No DOM, no Worker. Shared by
 * the browser and the Worker the same way the planner is.
 *
 *   contenders(catalog)      → [{ id, name, short, seed, members, load, period, bundle, stops, hours, reservation, miles, go }]
 *   structure(n)             → { games, slots, picksNeeded }
 *   resolve(struct, ids, picks) → { games, next, complete, picksMade, picksNeeded }
 *   valid(struct, ids, picks, game, winner) → bool
 *   ranking(struct, ids, picks) → [id] best first, length n, no ties
 *   rankingInfo(struct, ids, picks) → { order, promoted: [id], challenged: [id] }
 *   familyOrder(ballots, ids) → [{ id, mean, protected, ranks }]
 *   draw(ids, buckets, salt)  → [id] a personal seed order from three coarse buckets
 *   questions(order, cuts, picks, opts) → [{ a, b, cut, reason }]  boundary questions, at most two
 *   ladder(order, id, depth)  → [id] the rungs above id, nearest first
 *   challengesUsed(picks)     → n ladders opened on this ballot
 *
 * Picks carry more than games. Prefixed keys ride in the same object and every reader
 * ignores what it doesn't own (no game id contains a colon):
 *   bucket:<id>     "1"–"3"       the seeding round
 *   close:<game>    "1"           that matchup was a close call
 *   chal:<a>:<b>    <winner id>   a challenge, a < b lexically; key order is time order
 *   ladder:<id>     "0".."3" | "closed"   a ladder opened on <id>: rungs climbed, or done
 *   asked:<cut>     <pair key>    a boundary question at that cut was answered; each cut asks once per ballot
 *
 * See BRACKET.md for the doctrine.
 */
(function (root) {
  "use strict";

  const DRAW = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
  const ROUND_NAME = { playin: "Play-in", r16: "Round of 16", r8: "Quarterfinals", r4: "Semifinals", third: "Third place", final: "The final" };

  // Units, seeded. A bundle takes its best member's seed; accessories never stand alone.
  // Every contender says what it is: its stops, about how long, and whether tickets are involved.
  const RES_RANK = { none: 0, recommended: 1, required: 2 };
  function contenders(catalog) {
    const venueById = Object.fromEntries(catalog.venues.map((v) => [v.id, v]));
    const stop = (id, rides) => { const v = venueById[id]; return { id, name: v.name, hours: v.ideal_hours, period: v.period, rides: !!rides }; };
    const geo = catalog.geo;
    const describe = (core, accessory) => {
      const vs = core.map((id) => venueById[id]);
      const res = vs.reduce((r, v) => RES_RANK[v.reservation || "none"] > RES_RANK[r] ? v.reservation : r, "none");
      // From the hotel to the first stop: the number that decides walk or ride.
      const first = vs[0];
      const miles = geo && first && first.ll ? geo.distMi(geo.base.ll, first.ll) : null;
      const go = first && first.go ? first.go : miles == null ? null : miles <= geo.WALK ? "walk" : (geo.ride || "ride");
      return { stops: core.map((id) => stop(id, false)).concat(accessory.map((id) => stop(id, true))), hours: vs.reduce((h, v) => h + (v.ideal_hours || 0), 0), reservation: res, miles, go };
    };
    const taken = new Set();
    const out = [];
    for (const [bid, b] of Object.entries(catalog.bundles)) {
      const members = b.core.map((id) => venueById[id]).filter(Boolean);
      b.core.forEach((id) => taken.add(id)); (b.accessory || []).forEach((id) => taken.add(id));
      out.push({ id: bid, bundle: true, name: b.name, short: b.short, period: b.period, load: b.load, members: b.core.slice(), accessory: (b.accessory || []).slice(), seed: Math.min(...members.map((v) => v.seed)), ...describe(b.core, b.accessory || []) });
    }
    for (const v of catalog.venues) {
      if (taken.has(v.id)) continue;
      out.push({ id: v.id, bundle: false, name: v.name, short: v.name, period: v.period, load: v.load, members: [v.id], accessory: [], seed: v.seed, ...describe([v.id], []) });
    }
    out.sort((a, b) => a.seed - b.seed);
    out.forEach((c, i) => { c.seed = i + 1; });
    return out;
  }

  // The seeding round. Three coarse buckets (1 definitely interested, 2 could be good, 3 probably
  // not) become a personal seed order: bucket by bucket, with a stable shuffle inside each, keyed
  // by the salt (the trip and the traveler). The standard draw then spreads the top bucket across
  // the quarters, so favorites can't meet before the quarterfinals. That is the whole job: the
  // buckets never score, never protect, and never enter the family's order. No buckets, no change.
  function draw(ids, buckets, salt) {
    if (!buckets || !Object.keys(buckets).length) return ids.slice();
    const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
    const tier = (id) => { const b = buckets[id] | 0; return b >= 1 && b <= 3 ? b : 2; };
    return ids.slice().sort((a, b) => (tier(a) - tier(b)) || (hash(`${salt}:${a}`) - hash(`${salt}:${b}`)) || (ids.indexOf(a) - ids.indexOf(b)));
  }

  // A 16-bracket, plus one play-in per contender past sixteen. Fewer than sixteen is byes.
  function structure(n) {
    const k = Math.max(0, n - 16);
    const games = [];
    const slotSource = {};
    for (let s = 1; s <= 16; s++) slotSource[s] = { seed: s };
    for (let i = 1; i <= k; i++) {
      const slot = 16 - k + i, low = 17 + k - i;
      const id = `p${i}`;
      games.push({ id, round: "playin", order: i, from: [{ seed: slot }, { seed: low }] });
      slotSource[slot] = { win: id };
    }
    DRAW.forEach(([a, b], i) => games.push({ id: `r16-${i + 1}`, round: "r16", order: i + 1, from: [slotSource[a], slotSource[b]] }));
    for (let i = 0; i < 4; i++) games.push({ id: `r8-${i + 1}`, round: "r8", order: i + 1, from: [{ win: `r16-${2 * i + 1}` }, { win: `r16-${2 * i + 2}` }] });
    for (let i = 0; i < 2; i++) games.push({ id: `r4-${i + 1}`, round: "r4", order: i + 1, from: [{ win: `r8-${2 * i + 1}` }, { win: `r8-${2 * i + 2}` }] });
    games.push({ id: "third", round: "third", order: 1, from: [{ lose: "r4-1" }, { lose: "r4-2" }] });
    games.push({ id: "final", round: "final", order: 1, from: [{ win: "r4-1" }, { win: "r4-2" }] });
    // Games that a person actually decides: everything that isn't settled by a bye.
    const picksNeeded = games.filter((g) => !g.from.some((s) => s.seed && s.seed > n)).length;
    return { n, games, picksNeeded };
  }

  // Walk the games in order, filling participants from seeds, winners, and losers.
  function resolve(struct, ids, picks) {
    picks = picks || {};
    const seedId = (s) => (s <= ids.length ? ids[s - 1] : null);
    const state = {};
    const games = struct.games.map((g) => {
      const side = (src) => src.seed ? seedId(src.seed) : src.win ? (state[src.win] ? state[src.win].winner : null) : (state[src.lose] ? state[src.lose].loser : null);
      const a = side(g.from[0]), b = side(g.from[1]);
      const bye = g.from.some((s) => s.seed && s.seed > ids.length);
      let winner = null, auto = false;
      if (bye) { winner = a || b; auto = true; }
      else if (a && b && picks[g.id] && (picks[g.id] === a || picks[g.id] === b)) winner = picks[g.id];
      const loser = winner ? (winner === a ? b : a) : null;
      const out = { id: g.id, round: g.round, order: g.order, a, b, winner, loser, auto, ready: !!(a && b) };
      state[g.id] = out;
      return out;
    });
    const next = games.find((g) => g.ready && !g.winner) || null;
    const picksMade = games.filter((g) => g.winner && !g.auto).length;
    const complete = games.every((g) => g.winner);
    return { games, next, complete, picksMade, picksNeeded: struct.picksNeeded };
  }

  function valid(struct, ids, picks, gameId, winner) {
    const r = resolve(struct, ids, picks);
    const g = r.games.find((x) => x.id === gameId);
    return !!(g && g.ready && !g.auto && (winner === g.a || winner === g.b));
  }

  // A total order from one completed bracket. The top four are settled by real games (the final
  // and the third-place match). Everyone else lost once, in some round; a round is a block, and
  // within a block losers sort by how far their conqueror went.
  //
  // Close calls: a loss the picker called close lifts the loser exactly one block, never into the
  // top four, and never past a native of that block with the same conqueror (the native lost
  // later, on more evidence). Losses do not stack: one contender loses once.
  //
  // Challenges: after promotion, each chal: row moves its winner to just before its loser, if the
  // loser was ahead. Applied in key order, which the Worker keeps as time order, so later evidence
  // wins. No transitive closure, no cycle repair: every move is a permutation, so the result is
  // always a total order.
  const BLOCKS = ["r8", "r16", "playin"];
  function rankingInfo(struct, ids, picks) {
    picks = picks || {};
    const r = resolve(struct, ids, picks);
    if (!r.complete) return null;
    const by = Object.fromEntries(r.games.map((g) => [g.id, g]));
    const top = [by.final.winner, by.final.loser, by.third.winner, by.third.loser];
    // Base pass: the conqueror's finishing position, with no promotion in play.
    const basePos = new Map(top.map((id, i) => [id, i]));
    let n = top.length;
    for (const round of BLOCKS) {
      const losers = r.games.filter((g) => g.round === round && g.loser).map((g) => ({ id: g.loser, beatenBy: g.winner }));
      losers.sort((x, y) => basePos.get(x.beatenBy) - basePos.get(y.beatenBy));
      for (const l of losers) basePos.set(l.id, n++);
    }
    // Promotion pass.
    const losers = [];
    r.games.forEach((g, seq) => {
      if (!BLOCKS.includes(g.round) || !g.loser) return;
      const home = BLOCKS.indexOf(g.round);
      const block = picks[`close:${g.id}`] ? Math.max(0, home - 1) : home;
      losers.push({ id: g.loser, beatenBy: g.winner, home, block, promoted: block !== home, seq });
    });
    const order = top.slice();
    for (let b = 0; b < BLOCKS.length; b++) {
      const block = losers.filter((l) => l.block === b);
      block.sort((x, y) => (basePos.get(x.beatenBy) - basePos.get(y.beatenBy)) || ((x.promoted ? 1 : 0) - (y.promoted ? 1 : 0)) || (x.seq - y.seq));
      for (const l of block) order.push(l.id);
    }
    const promoted = losers.filter((l) => l.promoted).map((l) => l.id);
    // Challenges, in key order.
    const challenged = [];
    for (const [k, w] of Object.entries(picks)) {
      if (!k.startsWith("chal:")) continue;
      const [a, b] = k.slice(5).split(":");
      const l = w === a ? b : w === b ? a : null;
      if (!l) continue;
      const iw = order.indexOf(w), il = order.indexOf(l);
      if (iw < 0 || il < 0 || il > iw) continue;
      order.splice(iw, 1); order.splice(il, 0, w);
      if (!challenged.includes(w)) challenged.push(w);
    }
    return { order, promoted, challenged };
  }
  function ranking(struct, ids, picks) { const info = rankingInfo(struct, ids, picks); return info ? info.order : null; }

  // The pair key for a challenge: one row per pair, whichever way it was asked.
  const pairKey = (a, b) => `chal:${[a, b].sort()[0]}:${[a, b].sort()[1]}`;
  const compared = (games, picks, a, b) => games.some((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a)) || !!(picks || {})[pairKey(a, b)];

  // Boundary questions: extra comparisons spent only where the order changes the trip. For each
  // cut (a count of things inside), look at the two just inside and the two just outside; a pair
  // straddling the cut that this traveler never compared directly is a candidate. Candidates rank,
  // in this order: one of them was close-promoted (that order is inference, not evidence); the
  // family's means are within 1.0 (the group is undecided); this traveler's ranks differ most from
  // the family's means (their answer moves the aggregate most); adjacent to the cut (it decides
  // the boundary outright). One per cut, two at most, and each cut asks once per ballot: an
  // answer moves the means, a new pair drifts onto the bubble, and without that stop the
  // asking never ends. After that the ladder is the correction path.
  //   opts: { games: resolved games for this traveler, promoted: [id], means: {id: mean}, mine: {id: rank} }
  function questions(order, cuts, picks, opts) {
    opts = opts || {};
    const games = opts.games || [], promoted = new Set(opts.promoted || []), means = opts.means || {}, mine = opts.mine || {};
    const out = [];
    for (const [name, k] of Object.entries(cuts || {})) {
      if (!(k >= 1) || k >= order.length || (picks || {})[`asked:${name}`]) continue;
      const inside = order.slice(Math.max(0, k - 2), k), outside = order.slice(k, k + 2);
      const cands = [];
      for (const x of inside) for (const y of outside) {
        if (compared(games, picks, x, y)) continue;
        const lifted = promoted.has(x) || promoted.has(y) ? 1 : 0;
        const undecided = means[x] != null && means[y] != null && Math.abs(means[x] - means[y]) <= 1 ? 1 : 0;
        const diverge = (means[x] != null && mine[x] != null ? Math.abs(mine[x] - means[x]) : 0) + (means[y] != null && mine[y] != null ? Math.abs(mine[y] - means[y]) : 0);
        const adjacent = order.indexOf(x) === k - 1 && order.indexOf(y) === k ? 1 : 0;
        cands.push({ x, y, lifted, undecided, diverge, adjacent });
      }
      if (!cands.length) continue;
      cands.sort((p, q) => (q.lifted - p.lifted) || (q.undecided - p.undecided) || (q.diverge - p.diverge) || (q.adjacent - p.adjacent) || (order.indexOf(p.x) - order.indexOf(q.x)) || (order.indexOf(p.y) - order.indexOf(q.y)));
      const c = cands[0];
      out.push({ a: c.x, b: c.y, cut: name, reason: name === "protect" ? "These two are fighting for the last protected spot: what a short trip keeps." : "These two are fighting for the last must-see spot: what a normal week schedules." });
      if (out.length === 2) break;
    }
    return out;
  }

  // A ladder: the rungs above a contender, nearest first. It never starts above the immediate neighbor.
  function ladder(order, id, depth) {
    depth = depth == null ? 3 : depth;
    const p = order.indexOf(id);
    if (p <= 0) return [];
    return order.slice(Math.max(0, p - depth), p).reverse();
  }

  // Ladders opened on this ballot. Boundary questions are the system's and cost nothing.
  const challengesUsed = (picks) => Object.keys(picks || {}).filter((k) => k.startsWith("ladder:")).length;

  // Mean rank across completed ballots, champions locked to the top, ties to the seed.
  function familyOrder(ballots, ids) {
    const names = Object.keys(ballots).filter((t) => Array.isArray(ballots[t]) && ballots[t].length === ids.length);
    if (!names.length) return [];
    const champions = new Set(names.map((t) => ballots[t][0]));
    const rows = ids.map((id, seedIdx) => {
      const ranks = {}; let sum = 0;
      for (const t of names) { const p = ballots[t].indexOf(id) + 1; ranks[t] = p; sum += p; }
      return { id, seed: seedIdx + 1, mean: sum / names.length, protected: champions.has(id), ranks };
    });
    rows.sort((a, b) => (a.protected === b.protected ? 0 : a.protected ? -1 : 1) || a.mean - b.mean || a.seed - b.seed);
    return rows;
  }

  const api = { contenders, structure, resolve, valid, ranking, rankingInfo, familyOrder, draw, questions, ladder, challengesUsed, pairKey, ROUND_NAME, DRAW, BLOCKS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.DCBracket = api;
})(typeof window !== "undefined" ? window : globalThis);

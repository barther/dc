/*
 * The bracket. Pure: a catalog in, contenders and a draw out; picks in, a
 * ranking out; ballots in, the family's order out. No DOM, no Worker. Shared by
 * the browser and the Worker the same way the planner is.
 *
 *   contenders(catalog)      → [{ id, name, short, seed, members, load, period, bundle }]
 *   structure(n)             → { games, slots, picksNeeded }
 *   resolve(struct, ids, picks) → { games, next, complete, picksMade, picksNeeded }
 *   valid(struct, ids, picks, game, winner) → bool
 *   ranking(struct, ids, picks) → [id] best first, length n, no ties
 *   familyOrder(ballots, ids) → [{ id, mean, protected, ranks }]
 *
 * See BRACKET.md for the doctrine.
 */
(function (root) {
  "use strict";

  const DRAW = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
  const ROUND_NAME = { playin: "Play-in", r16: "Round of 16", r8: "Quarterfinals", r4: "Semifinals", third: "Third place", final: "The final" };

  // Units, seeded. A bundle takes its best member's seed; accessories never stand alone.
  function contenders(catalog) {
    const venueById = Object.fromEntries(catalog.venues.map((v) => [v.id, v]));
    const taken = new Set();
    const out = [];
    for (const [bid, b] of Object.entries(catalog.bundles)) {
      const members = b.core.map((id) => venueById[id]).filter(Boolean);
      b.core.forEach((id) => taken.add(id)); (b.accessory || []).forEach((id) => taken.add(id));
      out.push({ id: bid, bundle: true, name: b.name, short: b.short, period: b.period, load: b.load, members: b.core.slice(), accessory: (b.accessory || []).slice(), seed: Math.min(...members.map((v) => v.seed)) });
    }
    for (const v of catalog.venues) {
      if (taken.has(v.id)) continue;
      out.push({ id: v.id, bundle: false, name: v.name, short: v.name, period: v.period, load: v.load, members: [v.id], accessory: [], seed: v.seed });
    }
    out.sort((a, b) => a.seed - b.seed);
    out.forEach((c, i) => { c.seed = i + 1; });
    return out;
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

  // A total order from one completed bracket. Later rounds first; within a round,
  // losers are ordered by how far their conqueror went.
  function ranking(struct, ids, picks) {
    const r = resolve(struct, ids, picks);
    if (!r.complete) return null;
    const by = Object.fromEntries(r.games.map((g) => [g.id, g]));
    const order = [by.final.winner, by.final.loser, by.third.winner, by.third.loser];
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const round of ["r8", "r16", "playin"]) {
      const losers = r.games.filter((g) => g.round === round && g.loser).map((g) => ({ id: g.loser, beatenBy: g.winner }));
      losers.sort((x, y) => pos.get(x.beatenBy) - pos.get(y.beatenBy));
      for (const l of losers) { pos.set(l.id, order.length); order.push(l.id); }
    }
    return order;
  }

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

  const api = { contenders, structure, resolve, valid, ranking, familyOrder, ROUND_NAME, DRAW };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.DCBracket = api;
})(typeof window !== "undefined" ? window : globalThis);

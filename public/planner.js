/*
 * DC Trip Planner — the scheduler.
 *
 * Pure: takes the venue catalog, trip dates, and user state, returns a plan.
 * No DOM. Runs under node for tests. The renderer lives in ui.js.
 *
 * For every placement the questions are, in order: is it important, does it
 * fit, does the day stay humane, is there a better day, and if something has
 * to lose, what should lose. Never "how much can we cram in".
 *
 * Constraint order when rules collide (highest first):
 *   completed · pinned/fixed · closures · reservation · bundle integrity ·
 *   HI/MID/LO safety · trip identity · seed · weather · stability · weekday.
 */
(function (root) {
  "use strict";

  const catalog = typeof module !== "undefined" && module.exports ? require("./venues.js") : root.DCVenues;

  /* ───────────── Trip facts ───────────── */

  const DEFAULT = { start: "2026-11-29", nights: 7 };
  const MIN_NIGHTS = 1, MAX_NIGHTS = 10;
  // Bart works until 2 PM Sat Nov 28 (evening boarding is fine) and is back Thu Dec 10 at 2 PM.
  const WORK = { date: "2026-12-10", label: "Thu Dec 10, 2 PM", off: "2026-11-28", offLabel: "Sat Nov 28, 2 PM" };
  const TRAIN = { boardLabel: "evening", arriveWeekend: "~2:12 PM", arriveWeekday: "afternoon, per the timetable", departLabel: "6:30 PM", homeLabel: "~10:30 AM CT" };

  /* ───────────── Dates ───────────── */

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtMD = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  const fmtDMD = (d) => `${DOW[d.getDay()]} ${fmtMD(d)}`;
  const fmtDMDY = (d) => `${fmtDMD(d)}, ${d.getFullYear()}`;
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  function holiday(d) {
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === 12 && day === 25) return "christmas";
    if (m === 1 && day === 1) return "newyear";
    if (m === 11 && d.getDay() === 4 && day >= 22 && day <= 28) return "thanksgiving";
    return null;
  }
  const HOLIDAY_NAMES = { christmas: "Christmas Day", newyear: "New Year's Day", thanksgiving: "Thanksgiving" };

  function workBuffer(home) { return daysBetween(home, parseISO(WORK.date)); }
  function workStatus(home) { const b = workBuffer(home); return b >= 2 ? "ok" : b === 1 ? "thin" : b === 0 ? "tight" : "late"; }
  function workEarly(trainOut) { return daysBetween(trainOut, parseISO(WORK.off)); }

  /* ───────────── Units: what the scheduler actually places ───────────── */

  const TIER_WEIGHT = { protected: 1000, high: 200, medium: 100, bonus: 20 };
  const TIER_RANK = { protected: 0, high: 1, medium: 2, bonus: 3 };
  const LOAD = { lo: 0, mid: 1, hi: 2 };

  const venueById = Object.fromEntries(catalog.venues.map((v) => [v.id, v]));

  // Standing rules live on the venue; date-specific facts arrive as trip constraints.
  function venueClosed(v, d, external) {
    const c = v.constraints;
    if (c) {
      if (c.weekdays && c.weekdays.includes(d.getDay())) return `${v.name} is closed on ${DOW[d.getDay()]}days`;
      const h = holiday(d);
      if (h && c.holidays && c.holidays.includes(h)) return `${v.name} is closed on ${HOLIDAY_NAMES[h]}`;
    }
    const day = iso(d);
    for (const x of (external && external.closures) || []) {
      if (x.venue === v.id && x.date === day) return `${v.name} is closed ${fmtDMD(d)}${x.note ? ` (${x.note})` : ""}`;
    }
    return null;
  }

  // Build the list of schedulable units from the catalog and the user's state.
  function buildUnits(state, external) {
    const punted = new Set(state.punted || []), pinned = new Set(state.pinned || []), requested = new Set(state.requested || []);
    const completed = state.completed || {}, fixedMap = state.fixed || {}, notMap = state.notThisDay || {};
    const units = [];
    const inBundle = new Set();

    for (const [bid, b] of Object.entries(catalog.bundles)) {
      const core = b.core.filter((id) => !punted.has(id));
      b.core.forEach((id) => inBundle.add(id)); // accessories stay standalone units and ride along
      if (!core.length) continue;
      const members = core.map((id) => venueById[id]);
      const whole = core.length === b.core.length;
      const tier = members.reduce((t, v) => TIER_RANK[v.priority_tier] < TIER_RANK[t] ? v.priority_tier : t, members[0].priority_tier);
      units.push({
        id: bid, bundle: true, whole,
        name: whole ? b.name : members.map((v) => v.name).join(" + "),
        short: whole ? b.short : members.map((v) => v.name).join(" + "),
        period: b.period, environment: b.environment,
        load: whole ? b.load : members.reduce((l, v) => LOAD[v.load] > LOAD[l] ? v.load : l, "lo"),
        tier, seed: Math.min(...members.map((v) => v.seed)),
        members: core, accessory: b.accessory.filter((id) => !punted.has(id)),
        shortenable: members.every((v) => v.shortenable), min_hours: members.reduce((s, v) => s + v.min_hours, 0),
        prefer_weekday: b.prefer_weekday ?? null,
        pinned: core.some((id) => pinned.has(id)), requested: core.some((id) => requested.has(id)),
        closed: (d) => { for (const v of members) { const r = venueClosed(v, d, external); if (r) return r; } return null; },
      });
    }
    for (const v of catalog.venues) {
      if (inBundle.has(v.id) || punted.has(v.id)) continue;
      units.push({
        id: v.id, bundle: false, whole: true, name: v.name, short: v.name,
        period: v.period, environment: v.environment, load: v.load, tier: v.priority_tier, seed: v.seed,
        members: [v.id], accessory: [], shortenable: v.shortenable, min_hours: v.min_hours,
        prefer_weekday: null, pinned: pinned.has(v.id), requested: requested.has(v.id), closed: (d) => venueClosed(v, d, external),
      });
    }
    const accessoryIds = new Set(Object.values(catalog.bundles).flatMap((b) => b.accessory));
    for (const u of units) {
      // Live-trip facts: completed is history, fixed is a commitment, notThisDay is an exclusion.
      const doneDates = u.members.map((m) => completed[m]).filter(Boolean);
      u.completedOn = doneDates.length ? doneDates.sort()[0] : null;
      u.fixedOn = fixedMap[u.id] || u.members.map((m) => fixedMap[m]).find(Boolean) || null;
      u.notDays = new Set([...(notMap[u.id] || []), ...u.members.flatMap((m) => notMap[m] || [])]);
      u.value = TIER_WEIGHT[u.tier] - u.seed;
      // The thirteen headline experiences are the trip. They may squeeze; the bench may not.
      u.core = u.members.some((id) => catalog.headlines.includes(id));
      // The planner owns the core trip; the family owns the extras. Only headline experiences,
      // requests, and must-dos are scheduled without being asked. Accessories ride with their bundle.
      u.auto = u.core || u.requested || u.pinned || !!u.completedOn || !!u.fixedOn;
      u.isAccessory = !u.bundle && accessoryIds.has(u.id);
      // Ranking: must-do, protected, high, headline mediums, requested, then the bench.
      u.rank = u.completedOn ? -3 : u.fixedOn ? -2 : u.pinned ? -1 : u.tier === "protected" ? 0 : u.tier === "high" ? 1 : u.core ? 2 : u.requested ? 2.5 : 3;
      // Departure morning: a LO activity, or a shortened indoor/mixed visit. Never a full outdoor day.
      u.departureOK = u.period === "day" && (u.load === "lo" || (u.shortenable && u.environment !== "outdoor" && u.min_hours <= 3));
    }
    return units;
  }

  /* ───────────── The doctrine of a day ───────────── */

  // Score for putting two loads on one day. null = the other slot is empty.
  function pairScore(a, b) {
    if (!a || !b) return 0;
    if (a === "hi" && b === "hi") return -Infinity;       // forbidden
    if ((a === "hi" && b === "mid") || (a === "mid" && b === "hi")) return -8; // avoid
    return 0;                                              // preferred
  }

  /* ───────────── Weather: venue-specific, never "Tuesday is bad" ───────────── */

  const FIT_RANK = { poor: 0, acceptable: 1, good: 2, excellent: 3 };
  const FIT_SCORE = { poor: -6, acceptable: -2, good: 0, excellent: 1 };

  // Fit of a unit on a date given that date's conditions ({ rain, cold, wind, heat } booleans).
  function weatherFit(u, cond) {
    if (!cond) return null;
    const active = ["rain", "cold", "wind", "heat"].filter((k) => cond[k]);
    if (!active.length) return "good";
    let worst = "excellent";
    for (const m of u.members) {
      const w = venueById[m].weather || {};
      for (const k of active) { const f = w[k] || "good"; if (FIT_RANK[f] < FIT_RANK[worst]) worst = f; }
    }
    return worst;
  }

  /* ───────────── Planning ───────────── */

  function frameDays(start, nights) {
    const days = [];
    days.push({ date: start, kind: "arrival", day: null, night: null });
    for (let i = 1; i < nights; i++) days.push({ date: addDays(start, i), kind: "full", day: null, night: null });
    days.push({ date: addDays(start, nights), kind: "departure", day: null, night: null });
    return days;
  }

  function plan(cfg, state = {}, prev = null, external = {}) {
    const start = parseISO(cfg.start) || parseISO(DEFAULT.start);
    const nights = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, cfg.nights | 0 || DEFAULT.nights));
    const prevAt = (prev && prev.placements) || {};
    const today = external.today ? parseISO(external.today) : null;
    const stability = external.stability != null ? external.stability : 5;
    const weather = external.weather || null; // { iso: { rain, cold, wind, heat, summary } }

    const units = buildUnits(state, external);
    const byId = Object.fromEntries(units.map((u) => [u.id, u]));
    const days = frameDays(start, nights);
    for (const d of days) { d.past = !!today && d.date < today; d.isToday = !!today && iso(d.date) === iso(today); d.weather = weather ? weather[iso(d.date)] || null : null; }
    const fixed = Object.fromEntries(units.filter((u) => u.fixedOn).map((u) => [u.id, u.fixedOn]));
    const placed = {};   // unitId -> { dayIdx, slot }
    const reasons = [];
    const excluded = []; // { unit, why, kind }

    const unitAt = (di, slot) => days[di][slot] ? byId[days[di][slot].id] : null;
    const preferredIndex = (u) => catalog.preferred_order.indexOf(u.id);
    const pairingFor = (u) => catalog.pairings.find((p) => p.day === u.id || p.night === u.id);

    function score(u, di, slot, ignore) {
      const d = days[di];
      if (d.kind === "arrival") return -Infinity;
      if (slot !== u.period) return -Infinity;
      if (d.kind === "departure") { if (!u.departureOK) return -Infinity; }
      if (d[slot] && d[slot].id !== ignore && !u.completedOn) {
        // An accessory (the holiday market) yields its slot to anything that matters.
        if (!(d[slot].accessory && TIER_RANK[u.tier] <= TIER_RANK.medium && !u.accessoryOf)) return -Infinity;
      }
      if (u.completedOn) return u.completedOn === iso(d.date) ? 100 : -Infinity; // history: exactly where it happened
      if (d.past) return -Infinity;                                                  // the past is closed
      if (u.closed(d.date)) return -Infinity;
      if (u.fixedOn && u.fixedOn !== iso(d.date)) return -Infinity;
      if (u.notDays.has(iso(d.date))) return -Infinity;

      let s = 0;
      const fit = weatherFit(u, d.weather);
      if (fit) s += FIT_SCORE[fit];
      const other = unitAt(di, slot === "day" ? "night" : "day");
      const otherLoad = other ? other.load : (d.kind === "departure" && slot === "day" ? catalog.structural.departure.night.load : null);
      const ps = pairScore(u.load, otherLoad);
      if (ps === -Infinity) return -Infinity;
      if (ps < 0 && !u.core) return -Infinity;   // only the headline experiences get to squeeze a day
      s += ps;
      if (other && other.environment === "outdoor" && u.environment === "outdoor" && !u.accessoryOf && !(other.accessory)) s -= 3; // two cold outings in one day
      if (d.kind === "departure" && u.load !== "lo") s -= 6;                              // shortened: worth more than stability
      if (u.prefer_weekday != null && d.date.getDay() === u.prefer_weekday) s += 3;
      const pr = pairingFor(u);
      if (pr) { const partner = pr.day === u.id ? pr.night : pr.day; if (placed[partner] && placed[partner].dayIdx === di) s += 6; }
      if (prevAt[u.id] === iso(d.date)) s += stability;                                    // stability
      const pi = preferredIndex(u);
      if (pi >= 0 && d.kind === "full") s -= 0.3 * Math.abs((di - 1) - pi);               // recognizable week
      if (u.fixedOn) s += 50;
      return s;
    }

    function bestSlot(u, ignore) {
      let best = null, bs = -Infinity;
      for (let di = 0; di < days.length; di++) {
        const sc = score(u, di, u.period, ignore);
        if (sc > bs) { bs = sc; best = { dayIdx: di, slot: u.period, score: sc }; }
      }
      return best;
    }

    function put(u, di, slot, tag) {
      const occ = days[di][slot];
      if (occ && occ.id !== u.id) delete placed[occ.id]; // evicting an accessory, or history overriding a plan
      days[di][slot] = { id: u.id, shortened: days[di].kind === "departure" && u.load !== "lo", accessory: !!tag };
      placed[u.id] = { dayIdx: di, slot };
    }
    function remove(u) { const p = placed[u.id]; if (!p) return; days[p.dayIdx][p.slot] = null; delete placed[u.id]; }

    function whyNoSlot(u) {
      const dates = days.filter((d) => d.kind === "full" || (d.kind === "departure" && u.departureOK));
      const closures = dates.map((d) => u.closed(d.date)).filter(Boolean);
      if (closures.length === dates.length) return { why: closures[0] + ", every day of the trip", kind: "closed" };
      if (u.fixedOn) return { why: `couldn't go on ${fmtDMD(parseISO(u.fixedOn))}`, kind: "fixed" };
      if (today && dates.every((d) => d.past)) return { why: "no days left", kind: "room" };
      if (u.requested && !u.pinned) return { why: "no room without changing the current trip", kind: "room" };
      if (u.load === "hi") return { why: u.period === "night" ? "no light day left to pair it with" : "no full day left for it", kind: "room" };
      return { why: "no room left in the week", kind: "room" };
    }

    // 1. Place by value: pinned first, then the rest. Bonus-tier venues wait on the bench.
    const order = units
      .filter((u) => u.auto && !u.isAccessory)
      .sort((a, b) => (a.rank - b.rank) || (b.value - a.value));
    function placeAccessories(u) {
      const p = placed[u.id]; if (!p) return;
      for (const aid of u.accessory) {
        const a = byId[aid]; if (!a || placed[aid]) continue;
        a.accessoryOf = u.id;
        if (score(a, p.dayIdx, a.period) > -Infinity) put(a, p.dayIdx, a.period, "accessory");
      }
    }
    for (const u of order) {
      if (placed[u.id]) continue;
      // A pairing (Archives by day, the memorial loop by night) is placed as one decision.
      const pr = pairingFor(u);
      const partner = pr ? byId[pr.day === u.id ? pr.night : pr.day] : null;
      let best = null;
      if (partner && !placed[partner.id]) {
        let bs = -Infinity;
        for (let di = 0; di < days.length; di++) {
          const s1 = score(u, di, u.period); if (s1 === -Infinity) continue;
          const keep = days[di][u.period]; put(u, di, u.period);
          const s2 = score(partner, di, partner.period);
          days[di][u.period] = keep; delete placed[u.id];
          if (s2 === -Infinity) continue;
          if (s1 + s2 + 6 > bs) { bs = s1 + s2 + 6; best = { dayIdx: di, slot: u.period, withPartner: true }; }
        }
      }
      if (!best) best = bestSlot(u);
      if (!best) { const w = whyNoSlot(u); excluded.push({ unit: u, ...w }); continue; }
      put(u, best.dayIdx, best.slot);
      if (best.withPartner) put(partner, best.dayIdx, partner.period);
      placeAccessories(u); if (best.withPartner) placeAccessories(partner);
    }

    // 1b. Local search: swap two same-slot placements when the week gets better for it.
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      const ids = Object.keys(placed).filter((id) => days[placed[id].dayIdx].kind === "full" && !byId[id].fixedOn && !byId[id].completedOn && !days[placed[id].dayIdx].past && !days[placed[id].dayIdx][placed[id].slot].accessory);
      for (let i = 0; i < ids.length && !improved; i++) for (let j = i + 1; j < ids.length; j++) {
        const A = byId[ids[i]], B = byId[ids[j]];
        const pa = placed[A.id], pb = placed[B.id];
        if (pa.slot !== pb.slot || pa.dayIdx === pb.dayIdx) continue;
        const before = score(A, pa.dayIdx, pa.slot, A.id) + score(B, pb.dayIdx, pb.slot, B.id);
        const after = score(A, pb.dayIdx, pb.slot, B.id) + score(B, pa.dayIdx, pa.slot, A.id);
        if (after > before + 0.5) {
          const ca = days[pa.dayIdx][pa.slot], cb = days[pb.dayIdx][pb.slot];
          days[pa.dayIdx][pa.slot] = cb; days[pb.dayIdx][pb.slot] = ca;
          placed[A.id] = { dayIdx: pb.dayIdx, slot: pb.slot }; placed[B.id] = { dayIdx: pa.dayIdx, slot: pa.slot };
          improved = true; break;
        }
      }
      if (!improved) break;
    }

    // 2. Release valve: a shortenable indoor visit can move to the last morning so a
    //    higher-value full-day experience keeps a full day.
    for (let pass = 0; pass < 4; pass++) {
      let did = false;
      for (const ex of excluded.filter((e) => e.kind === "room" && e.unit.period === "day").sort((a, b) => b.unit.value - a.unit.value)) {
        const U = ex.unit;
        const depIdx = days.length - 1;
        const D = days[depIdx].day ? byId[days[depIdx].day.id] : null;
        if (D && (D.pinned || D.fixedOn || D.completedOn)) continue;
        let best = null, bn = 0;
        for (const S of units) {
          const p = placed[S.id];
          if (!p || days[p.dayIdx].kind !== "full" || p.slot !== "day" || !S.departureOK) continue;
          if (S.tier === "protected" || S.pinned || S.fixedOn || S.completedOn || days[p.dayIdx].past || TIER_RANK[U.tier] > TIER_RANK[S.tier]) continue;
          if (score(U, p.dayIdx, "day", S.id) === -Infinity) continue;
          if (score(S, depIdx, "day", D ? D.id : undefined) === -Infinity) continue;
          const net = D ? U.value - D.value : U.value - 4;
          if (net > bn) { bn = net; best = S; }
        }
        if (!best) continue;
        const p = placed[best.id];
        remove(best); if (D) remove(D);
        put(U, p.dayIdx, "day"); put(best, depIdx, "day");
        excluded.splice(excluded.indexOf(ex), 1);
        if (D) excluded.push({ unit: D, why: `lost the last morning to ${best.name}`, kind: "room" });
        reasons.push(`${best.name} moves to the last morning, shortened, so ${U.name} keeps a full day${D ? `. ${D.name} drops off to make that work` : ""}.`);
        did = true; break;
      }
      if (!did) break;
    }

    // 3. Explain the tradeoffs, not the mundane placements.
    for (const d of days) {
      if (!d.day || !d.night) continue;
      const a = byId[d.day.id], b = byId[d.night.id];
      if (pairScore(a.load, b.load) === -8) reasons.push(`${cap(b.name)} shares ${fmtDMD(d.date)} with ${a.name}: a big day and a big night. No lighter arrangement kept both.`);
    }
    for (const d of days) if (d.kind === "departure" && d.day && d.day.shortened) {
      const u = byId[d.day.id];
      if (!reasons.some((r) => r.startsWith(u.name + " moves"))) reasons.push(`${u.name} takes the last morning in shortened form: a couple of hours before the train.`);
    }
    for (const u of units) {
      const pl = placed[u.id];
      if (u.pinned && pl && days[pl.dayIdx].kind !== "departure" && !catalog.headlines.some((h) => u.members.includes(h))) {
        reasons.push(`${cap(u.name)} is in because you marked it must-do. It takes ${fmtDMD(days[pl.dayIdx].date)}.`);
      }
    }
    for (const ex of excluded) {
      if (ex.kind === "closed") reasons.push(`${cap(ex.unit.name)} can't fit these dates: ${ex.why}.`);
      else if (ex.unit.pinned) reasons.push(`${cap(ex.unit.name)} is marked must-do but there's ${ex.why}.`);
      else if (ex.unit.requested) reasons.push(`${cap(ex.unit.name)} doesn't fit without changing the current trip.`);
      else if (ex.unit.core) reasons.push(`${cap(ex.unit.name)} is cut: ${ex.why}.`);
    }
    for (const u of units) {
      const pl = placed[u.id];
      if (u.requested && !u.pinned && pl && !u.core) reasons.push(`${cap(u.name)} is in because you asked. It takes ${fmtDMD(days[pl.dayIdx].date)}${days[pl.dayIdx].kind === "departure" ? ", the last morning" : ""}.`);
    }

    // 3b. Suggestions for open slots: the bench may be recommended, never imposed.
    for (let di = 0; di < days.length; di++) {
      const d = days[di];
      if (d.kind === "arrival") continue;
      d.suggest = {};
      for (const slot of d.kind === "departure" ? ["day"] : ["day", "night"]) {
        if (d[slot]) continue;
        const floor = d.kind === "departure" ? -6.5 : -1.5;
        d.suggest[slot] = units
          .filter((u) => !placed[u.id] && !u.auto && !u.isAccessory && u.period === slot && score(u, di, slot) >= floor)
          .sort((a, b) => a.seed - b.seed).slice(0, 3)
          .map((u) => ({ id: u.id, name: u.name, seed: u.seed, load: u.load, shortened: d.kind === "departure" && u.load !== "lo" }));
      }
    }

    // 4. What survived.
    const includedVenues = new Set();
    for (const u of units) if (placed[u.id]) u.members.forEach((id) => includedVenues.add(id));
    const has = (id) => includedVenues.has(id);
    const identity = {
      civic: has("us-capitol") || has("library-of-congress"),
      documents: has("national-archives"),
      memorials: ["lincoln-memorial", "vietnam-memorial", "wwii-memorial", "korean-memorial"].every(has),
      christmas: has("white-house") && has("national-christmas-tree"),
      smithsonian: ["air-space", "natural-history", "american-history", "african-american-history"].some(has),
    };
    const intact = Object.values(identity).every(Boolean);

    const cutTier = (t) => excluded.filter((e) => e.unit.tier === t && e.kind !== "punted");
    const avoidPairs = days.filter((d) => d.day && d.night && pairScore(byId[d.day.id].load, byId[d.night.id].load) === -8).length;
    const shortenedHigh = days.some((d) => d.day && d.day.shortened && TIER_RANK[byId[d.day.id].tier] <= TIER_RANK.high);
    const openDays = days.filter((d) => d.kind === "full" && !d.day && !d.night).length;
    const punted = (state.punted || []).length + (state.requested || []).length + (state.pinned || []).length;

    let label;
    if (cutTier("protected").some((e) => e.kind === "closed")) label = "These dates don't work";
    else if (!intact) label = "A different kind of trip";
    else if (cutTier("high").length) label = "Minimum recommended";
    else if (cutTier("medium").filter((e) => e.unit.core).length >= 2) label = "Highlights version";
    else if (cutTier("medium").filter((e) => e.unit.core).length === 1) label = "First real cut";
    else if (avoidPairs || shortenedHigh) label = "Compressed full trip";
    else if (punted && nights <= DEFAULT.nights) label = "Your version";
    else if (nights > DEFAULT.nights) label = "Extended";
    else label = "Recommended";

    for (const d of days) { d.fit = { day: d.day ? weatherFit(byId[d.day.id], d.weather) : null, night: d.night ? weatherFit(byId[d.night.id], d.weather) : null }; }
    const trainOut = addDays(start, -1), home = addDays(start, nights + 1);
    const phase = !today ? "plan" : today < start ? "before" : today <= days[days.length - 1].date ? "live" : "after";
    return {
      start, nights, trainOut, depart: days[days.length - 1].date, home, days, units: byId, today, phase,
      placements: Object.fromEntries(Object.entries(placed).map(([id, p]) => [id, iso(days[p.dayIdx].date)])),
      includedVenues, identity, intact, excluded, reasons, label, openDays, avoidPairs,
      headline: { kept: catalog.headlines.filter(has).length, total: catalog.headlines.length },
      work: { status: workStatus(home), buffer: workBuffer(home), early: workEarly(trainOut) },
    };
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ───────────── Summary copy ───────────── */

  function summarize(p) {
    const N = p.nights;
    const cuts = p.excluded.filter((e) => e.unit.core).map((e) => e.unit.name);
    const s = { nights: N, label: p.label, count: `${p.headline.kept} of ${p.headline.total} headline experiences`, cuts: cuts.length ? `Cut: ${list(cuts)}.` : "", why: "", work: "" };
    const ws = p.work.status, early = p.work.early;
    if (early > 0) s.work = `Runs into work. This boards ${fmtDMD(p.trainOut)}, and Bart works until ${WORK.offLabel}. Arrive ${early === 1 ? "a day" : `${early} days`} later.`;
    else if (ws === "late") s.work = `Runs into work. Home ${fmtDMD(p.home)}, and Bart is due back ${WORK.label}. Start earlier or take a night off the end.`;
    else if (ws === "tight") s.work = `Cuts it close. Home ${fmtDMD(p.home)} around 10:30 AM, work at 2 PM the same day, and the Crescent isn't always on time.`;
    else if (ws === "thin") s.work = `One day at home before work ${WORK.label}.`;
    if (early > 0 || ws === "late") s.label = "Runs into work";

    const missing = Object.entries(p.identity).filter(([, ok]) => !ok).map(([k]) => ({ civic: "the Capitol", documents: "the founding documents", memorials: "the memorial night", christmas: "Christmas Washington", smithsonian: "a major Smithsonian" }[k]));
    switch (p.label) {
      case "These dates don't work": s.why = "Nudge the arrival date a day or two and the trip comes back."; break;
      case "A different kind of trip": s.why = `Without ${list(missing)}, this isn't a shorter version of Washington for Christmas. It's a different trip, which is fine, as long as we know it.`; break;
      case "Minimum recommended": s.why = "This is the shortest version that still feels like the same trip: the civic core, the founding documents, the memorial night, and Christmas Washington."; break;
      case "Highlights version": s.why = "We're protecting the uniquely Washington things over more museums: the Capitol, the founding documents, Arlington, the memorial night, and Christmas."; break;
      case "First real cut": s.why = "Everything else still fits at a reasonable pace."; break;
      case "Compressed full trip": s.why = "Same major sights, less breathing room."; break;
      case "Extended": s.why = p.openDays ? `Everything we'd recommend is already in. ${p.openDays === 1 ? "One day is open" : `${p.openDays} days are open`}, on purpose. The bench has ideas if the weather's right.` : "Everything from the recommended week, with room for more."; break;
      case "Your version": s.why = "The recommended trip, minus what you punted."; break;
      default: s.why = "Everything fits without turning the week into a death march. Best pacing.";
    }
    return s;
  }

  function list(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + (names.length > 2 ? "," : "") + " and " + names[names.length - 1];
  }

  /* ───────────── Preview: what an action would change ───────────── */

  // Compare two plans. `acted` = venue ids the user just acted on (their own moves don't count).
  function diff(before, after, acted = []) {
    const actedUnits = new Set(Object.values(after.units).concat(Object.values(before.units)).filter((u) => u.members.some((m) => acted.includes(m))).map((u) => u.id));
    const moved = Object.keys(before.placements).filter((id) => after.placements[id] && after.placements[id] !== before.placements[id] && !actedUnits.has(id)).map((id) => before.units[id].name);
    const avoidDays = (p) => new Set(p.days.filter((d) => d.day && d.night && pairScore(p.units[d.day.id].load, p.units[d.night.id].load) === -8).map((d) => iso(d.date)));
    const beforeAvoid = avoidDays(before);
    const newAvoid = after.days.filter((d) => avoidDays(after).has(iso(d.date)) && !beforeAvoid.has(iso(d.date)));
    const cutHeadlines = catalog.headlines.filter((id) => before.includedVenues.has(id) && !after.includedVenues.has(id) && !acted.includes(id)).map((id) => venueById[id].name);
    const cutProtected = Object.values(before.units).filter((u) => u.tier === "protected" && before.placements[u.id] && !after.placements[u.id] && !actedUnits.has(u.id)).map((u) => u.name);
    const identityChanged = before.intact && !after.intact;
    const depOf = (p) => { const d = p.days[p.days.length - 1].day; return d ? d.id : null; };
    const shortened = Object.keys(after.placements).filter((id) => depOf(after) === id && after.days[after.days.length - 1].day.shortened && before.placements[id] && depOf(before) !== id && !actedUnits.has(id)).map((id) => after.units[id].name);
    const promoted = Object.keys(after.placements).filter((id) => depOf(before) === id && depOf(after) !== id && !actedUnits.has(id)).map((id) => after.units[id].name);
    const movedOnly = moved.filter((n) => !shortened.includes(n) && !promoted.includes(n));

    const messages = [];
    for (const d of newAvoid) {
      const a = after.units[d.day.id], b = after.units[d.night.id];
      const added = actedUnits.has(a.id) ? a : actedUnits.has(b.id) ? b : b, other = added === a ? b : a;
      messages.push(`This makes ${fmtDMD(d.date)} a hard day. ${cap(other.name)} is already ${other.load.toUpperCase()}; adding ${added.name} makes it ${a.load.toUpperCase()}/${b.load.toUpperCase()}.`);
    }
    if (identityChanged) messages.unshift("This changes the kind of trip.");
    if (cutProtected.length) messages.push(`The best plan then drops ${list(cutProtected)}.`);
    else if (cutHeadlines.length) messages.push(`The best plan then drops ${list(cutHeadlines)}.`);
    if (shortened.length) messages.push(`${cap(list(shortened))} drops to a couple of hours on the last morning.`);
    if (movedOnly.length > 2) messages.push(`${movedOnly.length} other days move: ${list(movedOnly)}.`);
    const notes = [];
    if (promoted.length) notes.push(`${cap(list(promoted))} moves up to a full day.`);
    if (movedOnly.length && movedOnly.length <= 2) notes.push(`${cap(list(movedOnly))} ${movedOnly.length === 1 ? "moves" : "move"} to another day.`);
    const consequential = messages.length > 0;
    return { moved, newAvoid: newAvoid.map((d) => iso(d.date)), cutHeadlines, cutProtected, identityChanged, shortened, promoted, consequential, messages, notes };
  }

  // When a request doesn't land, the honest alternatives: an explicit trade or a longer trip.
  function fitOptions(cfg, state0, id, prev, external) {
    const state = { ...state0, requested: [...new Set([...(state0.requested || []), id])] };
    const base = plan(cfg, state, prev, external);
    const U = Object.values(base.units).find((u) => u.members.includes(id));
    if (!U || base.placements[U.id]) return [];
    const options = [];
    const tryState = (st) => { const p = plan(cfg, st, base, external); const u = Object.values(p.units).find((x) => x.members.includes(id)); return u && p.placements[u.id] ? p : null; };
    // Replace something of the same period that the planner scheduled.
    const candidates = Object.values(base.units).filter((x) => base.placements[x.id] && x.period === U.period && !x.pinned && x.id !== U.id && !x.isAccessory)
      .sort((a, b) => a.value - b.value);
    for (const X of candidates) {
      const st = { ...state, punted: [...(state.punted || []), ...X.members] };
      const p = tryState(st);
      if (!p) continue;
      const day = base.days.find((d) => (d.day && d.day.id === X.id) || (d.night && d.night.id === X.id));
      options.push({ kind: "replace", unit: X.id, members: X.members, label: `Replace ${X.name} on ${day.kind === "departure" ? "the last morning" : fmtDMD(day.date)}`, plan: p });
      if (options.length >= 3) break;
    }
    if (cfg.nights < MAX_NIGHTS) {
      const p = plan({ ...cfg, nights: cfg.nights + 1 }, state, base, external);
      const u = Object.values(p.units).find((x) => x.members.includes(id));
      if (u && p.placements[u.id]) options.push({ kind: "night", label: "Add one night" + (p.work.status === "late" ? " (runs into work)" : p.work.status === "tight" ? " (cuts it close at work)" : ""), plan: p });
    }
    return options;
  }

  // Day-of: would the forecast justify moving things? Only when the win is real.
  function suggestSwap(cfg, state, current, external) {
    if (!external || !external.weather) return null;
    // Asking "is there a better plan given the forecast?" relaxes stability; the gain threshold below guards against churn.
    const next = plan(cfg, state, current, { ...external, stability: 2 });
    const moves = [];
    for (const [id, date] of Object.entries(next.placements)) {
      const u = next.units[id];
      if (!current.placements[id] || current.placements[id] === date || u.completedOn || u.isAccessory) continue;
      const fromCond = external.weather[current.placements[id]] || null, toCond = external.weather[date] || null;
      const fromFit = weatherFit(u, fromCond), toFit = weatherFit(u, toCond);
      moves.push({ id, name: u.name, from: current.placements[id], to: date, fromFit, toFit, gain: fromFit && toFit ? FIT_RANK[toFit] - FIT_RANK[fromFit] : 0 });
    }
    if (!moves.length) return null;
    const cut = Object.keys(current.placements).filter((id) => !next.placements[id] && !next.units[id]?.isAccessory);
    if (cut.length) return null; // never trade an experience for a forecast
    const gain = moves.reduce((s, m) => s + m.gain, 0);
    if (gain < 2) return null;    // don't overreact to trivial differences
    const lines = moves.filter((m) => m.gain > 0).map((m) => `${m.name}: ${fmtDMD(parseISO(m.from))} (${m.fromFit}) → ${fmtDMD(parseISO(m.to))} (${m.toFit})`);
    return { moves, gain, plan: next, lines, summary: `Nothing gets cut and every day stays balanced. ${lines.join(". ")}.` };
  }

  const engine = { plan, summarize, diff, fitOptions, suggestSwap, weatherFit, FIT_RANK, buildUnits, catalog, DEFAULT, MIN_NIGHTS, MAX_NIGHTS, WORK, TRAIN, workStatus, workBuffer, workEarly, parseISO, iso, addDays, fmtMD, fmtDMD, fmtDMDY, DOW, MON, holiday };
  if (typeof module !== "undefined" && module.exports) { module.exports = engine; return; }
  root.DCPlanner = engine;
})(typeof window !== "undefined" ? window : globalThis);

/**
 * dc-christmas — Cloudflare Worker
 *
 * Public: the trip pitch and the recommended itinerary, plus a read of the
 * family's shared trip. Signed in (Cloudflare Access + Entra ID): intents
 * that change the shared trip.
 *
 * The planner is authoritative about whether a state is valid. D1 is
 * authoritative about which valid state the family accepted. The client
 * sends intent; this Worker applies it, re-runs the same planner the
 * browser runs, and persists the canonical state plus a decision record.
 */
import planner from "../public/planner.js";
import nycCatalog from "../public/venues-nyc.js";
import achievements from "../public/achievements.js";
import bracket from "../public/bracket.js";
import intents from "./intents.js";
import { identify } from "./access.js";
import { forecast } from "./weather.js";

// Two cities, one machine. Each has its own trip row, ballots, decisions, and trophies,
// keyed by trip id; the planner and the bracket are built over that city's catalog.
// The viewer's choice rides in a cookie the pages set.
function cityContext(engine, tripId) {
  const CONTENDERS = bracket.contenders(engine.catalog);
  const CIDS = CONTENDERS.map((c) => c.id);
  return {
    id: engine.catalog.city.id, TRIP_ID: tripId, planner: engine, CONTENDERS, CIDS, STRUCT: bracket.structure(CIDS.length),
    CUTS: { protect: engine.FINAL_FOUR, mustSee: engine.MUST_SEE }, // where the order changes the trip
    contenderName: (id) => (CONTENDERS.find((c) => c.id === id) || {}).name || id,
    validVenue: (id) => engine.catalog.venues.some((v) => v.id === id),
    venueName: (id) => (engine.catalog.venues.find((v) => v.id === id) || {}).name || id,
  };
}
const CITIES = { dc: cityContext(planner, "dc-2026"), nyc: cityContext(planner.withCatalog(nycCatalog), "nyc-2026") };
function cityFor(request) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)city=(\w+)/);
  return CITIES[m && m[1]] || CITIES.dc;
}
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...extra } });


async function loadState(ctx, db) {
  const trip = await db.prepare("SELECT id, start, nights, version, updated_at, placements FROM trips WHERE id = ?").bind(ctx.TRIP_ID).first();
  if (!trip) return null;
  const rows = (await db.prepare("SELECT venue_id, state, set_by, set_at FROM trip_venue_state WHERE trip_id = ?").bind(ctx.TRIP_ID).all()).results;
  const prefs = (await db.prepare("SELECT traveler_id, venue_id, choice FROM preferences WHERE trip_id = ?").bind(ctx.TRIP_ID).all()).results;
  const marks = (await db.prepare("SELECT venue_id, kind, date FROM trip_marks WHERE trip_id = ?").bind(ctx.TRIP_ID).all()).results;
  // Pace and pauses. Both tables arrive with migration 0007; until then the trip runs at the default.
  let capacity = {}, restDays = {};
  try {
    for (const r of (await db.prepare("SELECT traveler_id, level FROM trip_capacity WHERE trip_id = ?").bind(ctx.TRIP_ID).all()).results) capacity[r.traveler_id] = r.level;
    for (const r of (await db.prepare("SELECT date, set_by FROM trip_rest_days WHERE trip_id = ?").bind(ctx.TRIP_ID).all()).results) restDays[r.date] = r.set_by;
  } catch (e) { capacity = {}; restDays = {}; }
  const venues = {}; for (const r of rows) venues[r.venue_id] = r.state;
  const preferences = {}; for (const r of prefs) (preferences[r.traveler_id] = preferences[r.traveler_id] || {})[r.venue_id] = r.choice;
  const completed = {}, fixed = {}, notThisDay = {};
  for (const m of marks) {
    if (m.kind === "completed") completed[m.venue_id] = m.date;
    else if (m.kind === "fixed") fixed[m.venue_id] = m.date;
    else (notThisDay[m.venue_id] = notThisDay[m.venue_id] || []).push(m.date);
  }
  let placements = {}; try { placements = JSON.parse(trip.placements || "{}"); } catch (e) {}
  const travelers = (await db.prepare("SELECT id FROM travelers").all()).results.map((t) => t.id);
  const picks = await loadPicks(ctx, db);
  return { id: trip.id, start: trip.start, nights: trip.nights, version: trip.version, updated_at: trip.updated_at, venues, preferences, completed, fixed, notThisDay, placements, travelers, picks, family: familyFromPicks(ctx, picks, travelers), capacity, restDays };
}

// Everyone's bracket picks: { traveler: { game: winner } }. Survives the table not existing yet.
// Rows come back in time order and the object keeps key order, so chal: rows apply oldest first
// and a re-answered pair (same key, newer `at`) moves to the end: later evidence wins.
async function loadPicks(ctx, db) {
  try {
    const rows = (await db.prepare("SELECT traveler_id, game, winner FROM bracket_picks WHERE trip_id = ? ORDER BY at, rowid").bind(ctx.TRIP_ID).all()).results;
    const picks = {}; for (const r of rows) (picks[r.traveler_id] = picks[r.traveler_id] || {})[r.game] = r.winner;
    return picks;
  } catch (e) { return {}; }
}

// Where the family stands: each ballot's state, and the order the planner schedules by.
const bucketsOf = (p) => { const b = {}; for (const [k, v] of Object.entries(p || {})) if (k.startsWith("bucket:")) b[k.slice(7)] = v | 0; return b; };
// Each traveler's bracket is drawn from their own seeding round; without one, the authored order.
const drawFor = (ctx, t, p) => bracket.draw(ctx.CIDS, bucketsOf(p), `${ctx.TRIP_ID}:${t}`);

function familyFromPicks(ctx, picks, travelers) {
  const ballots = {}, status = {};
  for (const t of travelers) {
    const p = picks[t] || {};
    if (p.abstain) { status[t] = { complete: false, abstained: true, seeded: false, picksMade: 0, picksNeeded: ctx.STRUCT.picksNeeded, champion: null }; continue; }
    const ids = drawFor(ctx, t, p);
    const r = bracket.resolve(ctx.STRUCT, ids, p);
    const info = r.complete ? bracket.rankingInfo(ctx.STRUCT, ids, p) : null;
    const ranking = info ? info.order : null;
    status[t] = { complete: r.complete, seeded: Object.keys(bucketsOf(p)).length > 0, picksMade: r.picksMade, picksNeeded: r.picksNeeded, champion: ranking ? ranking[0] : null, promoted: info ? info.promoted : [], challenged: info ? info.challenged : [] };
    if (ranking) ballots[t] = ranking;
  }
  const order = bracket.familyOrder(ballots, ctx.CIDS);
  return { status, ballots, order, familyRank: order.map((r) => r.id), champions: order.filter((r) => r.protected).map((r) => r.id) };
}

/* ───────────── Close calls, ladders, boundary questions: refining one ballot ─────────────
   Everything here refines a personal ranking. The family's order stays mean rank with
   champions locked; closeness and challenges never cross ballots. */

const LADDER_DEPTH = 3, LADDER_BUDGET = 2;

// The order that drives the schedule: the family's once two ballots are in, else this traveler's own.
function drivingOrder(s, t) {
  const done = Object.values(s.family.status).filter((x) => x.complete).length;
  return done >= 2 ? s.family.familyRank : (s.family.ballots[t] || []);
}

// This traveler's open ladder, if any: the contender, the rungs, and the next question.
function ladderFor(ctx, s, t) {
  const p = s.picks[t] || {}, mine = s.family.ballots[t];
  const used = bracket.challengesUsed(p);
  const out = { used, budget: LADDER_BUDGET, open: null };
  if (!mine) return out;
  for (const [k, v] of Object.entries(p)) {
    if (!k.startsWith("ladder:") || v === "closed") continue;
    const id = k.slice(7), climbed = v | 0;
    const rungs = bracket.ladder(mine, id, LADDER_DEPTH - climbed);
    if (!rungs.length || climbed >= LADDER_DEPTH) continue;
    out.open = { id, climbed, next: { a: id, b: rungs[0] }, left: LADDER_DEPTH - climbed };
    break;
  }
  return out;
}

// The boundary questions for this traveler, against the order that drives the schedule.
function questionsFor(ctx, s, t) {
  const p = s.picks[t] || {}, mine = s.family.ballots[t];
  if (!mine) return [];
  const order = drivingOrder(s, t);
  const games = bracket.resolve(ctx.STRUCT, drawFor(ctx, t, p), p).games;
  const means = Object.fromEntries(s.family.order.map((r) => [r.id, r.mean]));
  const myRank = Object.fromEntries(mine.map((id, i) => [id, i + 1]));
  return bracket.questions(order, ctx.CUTS, p, { games, promoted: s.family.status[t].promoted, means, mine: myRank });
}

// Which side of each cut a contender sits on, in the driving order. A move across a cut is the only thing worth logging.
function cutSide(ctx, order, id) {
  const i = order.indexOf(id);
  return i < 0 ? "out" : i < ctx.CUTS.protect ? "protect" : i < ctx.CUTS.mustSee ? "mustSee" : "out";
}
const CUT_WORD = { protect: "inside the top four now, so a short trip keeps it", mustSee: "inside the must-see thirteen now, so a normal week schedules it", out: "outside the must-see thirteen now" };

async function travelerFor(db, identity, env) {
  if (!identity || !identity.email) return null;
  const row = await db.prepare("SELECT t.id, t.name, t.role, t.is_admin FROM traveler_identities i JOIN travelers t ON t.id = i.traveler_id WHERE lower(i.email) = ?").bind(identity.email.toLowerCase()).first();
  if (row) return row;
  // Local dev only: DEV_IDENTITY may name a traveler id directly (e.g. "bart").
  if (identity.sub === "dev" && env && env.DEV_IDENTITY) return db.prepare("SELECT id, name, role, is_admin FROM travelers WHERE id = ?").bind(identity.email.split("@")[0].toLowerCase()).first();
  return null;
}

// Family state is behind sign-in. Public gets the pitch, not the game.
async function requireTraveler(request, env, db) {
  return (await travelerFor(db, await identify(request, env), env)) || null;
}

async function decisions(ctx, db, limit = 12) {
  const rows = (await db.prepare("SELECT d.id, d.at, d.type, d.summary, t.id AS who_id, t.name AS who, t.is_admin AS admin FROM decisions d JOIN travelers t ON t.id = d.traveler_id WHERE d.trip_id = ? ORDER BY d.id DESC LIMIT ?").bind(ctx.TRIP_ID, limit).all()).results;
  if (!rows.length) return rows;
  // Everyone's take on each entry, oldest first.
  const ids = rows.map((r) => r.id);
  const ops = (await db.prepare(`SELECT o.decision_id, o.traveler_id, t.name, o.stance, o.note, o.at FROM decision_opinions o JOIN travelers t ON t.id = o.traveler_id WHERE o.decision_id IN (${ids.map(() => "?").join(",")}) ORDER BY o.at`).bind(...ids).all()).results;
  for (const r of rows) r.opinions = ops.filter((o) => o.decision_id === r.id).map((o) => ({ traveler: o.traveler_id, name: o.name, stance: o.stance, note: o.note, at: o.at }));
  return rows;
}

/* ───────────── Achievements: evaluate on every change, unlock once, never un-unlock ───────────── */

const akey = (ctx, scope, who, id) => scope === "trip" ? `trip:${ctx.TRIP_ID}:group:achievement:${id}` : `trip:${ctx.TRIP_ID}:user:${who}:achievement:${id}`;

// A trophy exists in a city only if its rule can be met there. One that names a venue the city
// doesn't have is filtered out, and a stray key for one (an old bug unlocked a few) is deleted.
const applicableHere = (ctx, id) => { const d = achievements.byId[id]; return !!d && achievements.applicable(d, ctx.planner.catalog); };

async function unlocked(ctx, kv) {
  const byTraveler = {}, group = [];
  if (!kv) return { byTraveler, group };
  const list = await kv.list({ prefix: `trip:${ctx.TRIP_ID}:` });
  for (const k of list.keys) {
    const m = k.name.match(/^trip:[^:]+:(user:([^:]+)|group):achievement:(.+)$/);
    if (!m) continue;
    if (!applicableHere(ctx, m[3])) { try { await kv.delete(k.name); } catch (e) {} continue; }
    if (m[1] === "group") group.push(m[3]); else (byTraveler[m[2]] = byTraveler[m[2]] || []).push(m[3]);
  }
  return { byTraveler, group };
}

// How many of the hunt's family photos exist as /img/done-<file>. Static assets, so a HEAD each.
async function countPhotos(env, origin) {
  if (!env.ASSETS || !origin) return 0;
  const hits = await Promise.all(achievements.HUNT.map(async (f) => {
    // The assets binding answers misses with the index page (single-page-application fallback), so an image is the only real hit.
    try { const r = await env.ASSETS.fetch(new Request(`${origin}/img/done-${f}`, { method: "HEAD" })); return r.ok && (r.headers.get("content-type") || "").startsWith("image/") ? 1 : 0; } catch (e) { return 0; }
  }));
  return hits.reduce((a, b) => a + b, 0);
}

async function evaluateAchievements(ctx, env, db, s, plan, origin) {
  const kv = env.KV; if (!kv) return [];
  const photos = await countPhotos(env, origin);
  const travelers = (await db.prepare("SELECT id, name, is_admin FROM travelers").all()).results;
  const allDecisions = (await db.prepare("SELECT type, traveler_id, payload FROM decisions WHERE trip_id = ?").bind(ctx.TRIP_ID).all()).results
    .map((d) => ({ type: d.type, traveler_id: d.traveler_id, payload: (() => { try { return JSON.parse(d.payload); } catch (e) { return {}; } })() }));
  const have = await unlocked(ctx, kv);
  const hadHiHi = false; // the planner forbids it; recorded here so the rule stays honest if that ever changes
  const fresh = [];
  const now = new Date().toISOString();
  for (const t of travelers) {
    const facts = { travelerId: t.id, isAdmin: !!t.is_admin, completed: s.completed, bundles: ctx.planner.catalog.bundles, decisions: allDecisions, preferences: s.preferences, phase: plan.phase, hadHiHi, unlockedByTraveler: have.byTraveler, travelerIds: travelers.map((x) => x.id), photos, bracket: bracketFacts(ctx, s) };
    for (const id of achievements.evaluate(facts)) {
      const def = achievements.byId[id];
      if (!applicableHere(ctx, id)) continue;
      if (def.scope === "trip") { if (!have.group.includes(id)) { await kv.put(akey(ctx, "trip", null, id), JSON.stringify({ unlockedAt: now, source: "evaluate", version: 1 })); have.group.push(id); fresh.push({ scope: "trip", id, name: def.name }); } continue; }
      if (!(have.byTraveler[t.id] || []).includes(id)) {
        await kv.put(akey(ctx, "user", t.id, id), JSON.stringify({ unlockedAt: now, source: "evaluate", version: 1 }));
        (have.byTraveler[t.id] = have.byTraveler[t.id] || []).push(id);
        fresh.push({ scope: "user", traveler: t.id, name: def.name, id });
      }
    }
  }
  return fresh;
}

function bracketFacts(ctx, s) {
  const f = s.family || { status: {}, familyRank: [] };
  const ballots = {}, abstained = [];
  for (const [t, st] of Object.entries(f.status)) { if (st.complete) ballots[t] = { champion: st.champion }; if (st.abstained) abstained.push(t); }
  return { ballots, abstained, familyRank: f.familyRank, seeds: Object.fromEntries(ctx.CONTENDERS.map((c) => [c.id, c.seed])) };
}

/* ───────────── Catalog observations: what the trip says about the catalog ─────────────
   Written beside the decision log, never instead of it. Only events that carry evidence about
   load or duration, and only with the context that makes the evidence readable: the pace in
   force, what else happened that day and the day before, the weather. Generation supplies the
   prior; trips supply this. */
const OBSERVED = { complete: "complete", bail: "bail", not_this_day: "moved", punt: "punt" };
async function recordObservation(ctx, env, db, traveler, intent, before, now) {
  const result = OBSERVED[intent.type];
  if (!result) return;
  // Before the trip, a punt or a move is an opinion, not an observation. Complete and bail only happen live.
  if ((result === "moved" || result === "punt") && before.phase !== "live") return;
  const members = intent.members || (intent.venue ? [intent.venue] : []);
  const unit = Object.values(before.units).find((u) => u.members.some((m) => members.includes(m)));
  if (!unit) return;
  const date = intent.date || before.placements[unit.id] || null;
  const di = date ? before.days.findIndex((d) => ctx.planner.iso(d.date) === date) : -1;
  const day = di >= 0 ? before.days[di] : null, prev = di > 0 ? before.days[di - 1] : null;
  const slot = day && day.day && day.day.id === unit.id ? "day" : "night";
  const short = !!(day && day[slot] && day[slot].shortened);
  const other = day ? (slot === "day" ? day.night : day.day) : null;
  const load = (x) => (x ? before.units[x.id].load : "none");
  let weather = null;
  if (before.phase === "live" && date) { try { const f = await forecast(env); weather = f && f[date] ? JSON.stringify(f[date]) : null; } catch (e) { weather = null; } }
  const hours = (m) => { const v = ctx.planner.catalog.venues.find((x) => x.id === m); return v ? (short ? v.min_hours : v.ideal_hours) : null; };
  const rows = members.map((m) => db.prepare(
    "INSERT INTO catalog_observations (trip_id, city, venue_id, unit_id, date, traveler_id, result, visit_form, planned_hours, actual_hours, party_pace, prior_day_load, same_day_other, weather, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)"
  ).bind(ctx.TRIP_ID, ctx.id, m, unit.id, date, traveler.id, result === "complete" && short ? "shortened" : result, short ? "short" : "full", hours(m), before.pace ? before.pace.level : 3, prev ? load(prev.day) : "none", load(other), weather, intent.reason || null, now));
  if (rows.length) await db.batch(rows);
}

function publicState(ctx, s) {
  return { id: s.id, start: s.start, nights: s.nights, version: s.version, updated_at: s.updated_at, venues: s.venues, preferences: s.preferences,
    completed: s.completed, fixed: s.fixed, notThisDay: s.notThisDay, placements: s.placements, planner: intents.plannerState(s), bracket: s.family,
    capacity: s.capacity || {}, restDays: s.restDays || {}, pace: intents.paceFloor(s.capacity) };
}

// Today, in Washington's timezone. DEV_TODAY overrides for local testing of live mode.
function todayISO(env) {
  if (env.DEV_TODAY) return env.DEV_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// What the planner is told from outside the catalog: the date, and the family's order when there is one.
function external(ctx, env, s) {
  return { today: todayISO(env), familyRank: s && s.family ? s.family.familyRank : [], champions: s && s.family ? s.family.champions : [],
    pace: intents.paceFloor(s && s.capacity), restDays: Object.keys((s && s.restDays) || {}) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;
    const ctx = cityFor(request);

    if (url.pathname === "/api/me") {
      const identity = await identify(request, env);
      const traveler = await travelerFor(db, identity, env);
      const all = (await db.prepare("SELECT id, name, role, is_admin FROM travelers ORDER BY rowid").all()).results;
      if (traveler) return json({ traveler, travelers: all, city: ctx.id });
      // Not mapped: say why, so a sign-in that goes nowhere is diagnosable from the page.
      const why = !identity ? "not_signed_in" : identity.error ? identity.error : `unknown_email: ${identity.email} is not on the trip`;
      return json({ traveler: null, travelers: all, why, email: identity && identity.email ? identity.email : undefined, city: ctx.id });
    }

    if (url.pathname === "/api/achievements") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      // Trip-level trophies can come due with time alone (the trip ending), so check here too.
      try { const s = await loadState(ctx, db); const ext = external(ctx, env, s); const cur = ctx.planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext); await evaluateAchievements(ctx, env, db, s, cur, url.origin); } catch (e) {}
      const have = await unlocked(ctx, env.KV);
      const visible = achievements.defs.filter((d) => applicableHere(ctx, d.id) && (!d.hidden || have.group.includes(d.id) || Object.values(have.byTraveler).some((l) => l.includes(d.id))));
      return json({ ...have, defs: visible.map(({ id, name, description, scope, hidden, track, badge, only }) => ({ id, name, description, scope, hidden: !!hidden, track: track || null, badge: badge || null, only: only || null })) });
    }

    if (url.pathname === "/api/today") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(ctx, db);
      const ext = external(ctx, env, s);
      const current = ctx.planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext);
      let weather = null, suggestion = null;
      if (current.phase === "live" || current.phase === "before") {
        weather = await forecast(env);
        if (weather && current.phase === "live") {
          const sw = ctx.planner.suggestSwap({ start: s.start, nights: s.nights }, intents.plannerState(s), current, { ...ext, weather });
          if (sw) suggestion = { moves: sw.moves.map((m) => ({ venue: current.units[m.id].members[0], name: m.name, date: m.to, from: m.from, fromFit: m.fromFit, toFit: m.toFit })), lines: sw.lines, summary: sw.summary, gain: sw.gain };
        }
      }
      const todayDay = current.days.find((d) => d.isToday);
      const fits = todayDay ? { day: todayDay.day ? ctx.planner.weatherFit(current.units[todayDay.day.id], weather && weather[ext.today]) : null, night: todayDay.night ? ctx.planner.weatherFit(current.units[todayDay.night.id], weather && weather[ext.today]) : null } : null;
      return json({ today: ext.today, phase: current.phase, weather, fits, suggestion });
    }

    if (url.pathname === "/api/trip" && request.method === "GET") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(ctx, db);
      if (!s) return json({ error: "No trip yet. Run the migrations." }, 500);
      return json({ trip: publicState(ctx, s), decisions: await decisions(ctx, db), today: todayISO(env) });
    }

    if (url.pathname === "/api/intent" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(ctx, db);
      if (body.version && body.version !== s.version) return json({ error: "Somebody else changed the trip first.", trip: publicState(ctx, s), decisions: await decisions(ctx, db) }, 409);

      const intent = { ...body.intent, name: body.intent && body.intent.venue ? ctx.venueName(body.intent.venue) : undefined };
      const r = intents.apply(s, intent, traveler, { MIN_NIGHTS: ctx.planner.MIN_NIGHTS, MAX_NIGHTS: ctx.planner.MAX_NIGHTS, validVenue: ctx.validVenue });
      if (r.error) return json({ error: r.error }, r.status || 400);

      // The planner is the validator: run it on the candidate state, and explain the consequence.
      const ext = external(ctx, env, s);
      const before = ctx.planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext);
      const after = ctx.planner.plan({ start: r.state.start, nights: r.state.nights }, intents.plannerState(r.state), before, { ...ext, pace: intents.paceFloor(r.state.capacity), restDays: Object.keys(r.state.restDays || {}) });
      const acted = intent.members || (intent.venue ? [intent.venue] : []);
      const d = planner.diff(before, after, acted);
      const consequence = [...d.messages, ...d.notes].join(" ");
      if (d.consequential && !body.confirmed) {
        return json({ preview: true, messages: d.messages, notes: d.notes, label: after.label,
          flags: { identityChanged: d.identityChanged, cutHeadlines: d.cutHeadlines, cutProtected: d.cutProtected, newAvoid: d.newAvoid, shortened: d.shortened } }, 200);
      }

      const now = new Date().toISOString();
      const stmts = [
        // The guard: a stale writer collides on (trip_id, version) and the whole batch rolls back.
        db.prepare("INSERT INTO trip_versions (trip_id, version, at) VALUES (?, ?, ?)").bind(ctx.TRIP_ID, s.version + 1, now),
        db.prepare("UPDATE trips SET start = ?, nights = ?, placements = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?").bind(r.state.start, r.state.nights, JSON.stringify(after.placements), s.version + 1, now, ctx.TRIP_ID, s.version),
        db.prepare("DELETE FROM trip_marks WHERE trip_id = ?").bind(ctx.TRIP_ID),
        ...Object.entries(r.state.completed).map(([vid, d]) => db.prepare("INSERT INTO trip_marks (trip_id, venue_id, kind, date, set_by, set_at) VALUES (?, ?, 'completed', ?, ?, ?)").bind(ctx.TRIP_ID, vid, d, traveler.id, now)),
        ...Object.entries(r.state.fixed).map(([vid, d]) => db.prepare("INSERT INTO trip_marks (trip_id, venue_id, kind, date, set_by, set_at) VALUES (?, ?, 'fixed', ?, ?, ?)").bind(ctx.TRIP_ID, vid, d, traveler.id, now)),
        ...Object.entries(r.state.notThisDay).flatMap(([vid, ds]) => ds.map((d) => db.prepare("INSERT INTO trip_marks (trip_id, venue_id, kind, date, set_by, set_at) VALUES (?, ?, 'not_this_day', ?, ?, ?)").bind(ctx.TRIP_ID, vid, d, traveler.id, now))),
        db.prepare("DELETE FROM trip_venue_state WHERE trip_id = ?").bind(ctx.TRIP_ID),
        ...Object.entries(r.state.venues).map(([vid, st]) => db.prepare("INSERT INTO trip_venue_state (trip_id, venue_id, state, set_by, set_at) VALUES (?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, vid, st, traveler.id, now)),
        db.prepare("DELETE FROM trip_capacity WHERE trip_id = ?").bind(ctx.TRIP_ID),
        ...Object.entries(r.state.capacity || {}).map(([tid, level]) => db.prepare("INSERT INTO trip_capacity (trip_id, traveler_id, level, set_at) VALUES (?, ?, ?, ?)").bind(ctx.TRIP_ID, tid, level, now)),
        db.prepare("DELETE FROM trip_rest_days WHERE trip_id = ?").bind(ctx.TRIP_ID),
        ...Object.entries(r.state.restDays || {}).map(([date, by]) => db.prepare("INSERT INTO trip_rest_days (trip_id, date, set_by, set_at) VALUES (?, ?, ?, ?)").bind(ctx.TRIP_ID, date, by, now)),
        db.prepare("DELETE FROM preferences WHERE trip_id = ?").bind(ctx.TRIP_ID),
        ...Object.entries(r.state.preferences).flatMap(([tid, prefs]) => Object.entries(prefs).map(([vid, c]) => db.prepare("INSERT INTO preferences (trip_id, traveler_id, venue_id, choice, set_at) VALUES (?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, tid, vid, c, now))),
        db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, now, traveler.id, intent.type, JSON.stringify(body.intent), `${r.summary}${consequence ? " " + consequence : ""} Now: ${after.label}.`),
      ];
      let results;
      try { results = await db.batch(stmts); }
      catch (e) { const cur = await loadState(ctx, db); return json({ error: "Somebody else changed the trip first.", trip: publicState(ctx, cur), decisions: await decisions(ctx, db) }, 409); }
      if (!results[1].meta.changes) { const cur = await loadState(ctx, db); return json({ error: "Somebody else changed the trip first.", trip: publicState(ctx, cur), decisions: await decisions(ctx, db) }, 409); }
      const cur = await loadState(ctx, db);
      let fresh = [];
      try { fresh = await evaluateAchievements(ctx, env, db, cur, after, url.origin); } catch (e) { fresh = []; }
      try { await recordObservation(ctx, env, db, traveler, intent, before, now); } catch (e) {}
      return json({ trip: publicState(ctx, cur), decisions: await decisions(ctx, db), label: after.label, today: todayISO(env), unlocked: fresh });
    }

    // An opinion on a log entry. Not a trip change: no version bump, no planner run.
    if (url.pathname === "/api/opinion" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const id = Number(body.decision);
      if (!Number.isInteger(id)) return json({ error: "Which decision?" }, 400);
      const exists = await db.prepare("SELECT id FROM decisions WHERE id = ? AND trip_id = ?").bind(id, ctx.TRIP_ID).first();
      if (!exists) return json({ error: "No such decision." }, 404);
      const stance = body.stance === "fine" || body.stance === "object" ? body.stance : null;
      const note = String(body.note || "").trim().slice(0, 200);
      if (stance) await db.prepare("INSERT INTO decision_opinions (decision_id, traveler_id, stance, note, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(decision_id, traveler_id) DO UPDATE SET stance = excluded.stance, note = excluded.note, at = excluded.at").bind(id, traveler.id, stance, note, new Date().toISOString()).run();
      else await db.prepare("DELETE FROM decision_opinions WHERE decision_id = ? AND traveler_id = ?").bind(id, traveler.id).run();
      return json({ decisions: await decisions(ctx, db) });
    }

    /* ───────────── The bracket ───────────── */

    if (url.pathname === "/api/bracket" && request.method === "GET") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(ctx, db);
      return json({ contenders: ctx.CONTENDERS, structure: ctx.STRUCT, cuts: ctx.CUTS, me: traveler.id, picks: s.picks[traveler.id] || {}, draw: drawFor(ctx, traveler.id, s.picks[traveler.id]), family: s.family, questions: questionsFor(ctx, s, traveler.id), ladder: ladderFor(ctx, s, traveler.id) });
    }

    // One pick: the next undecided game, one of its two contenders. Saved as you go.
    if (url.pathname === "/api/bracket/pick" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(ctx, db);
      const mine = s.picks[traveler.id] || {};
      const myIds = drawFor(ctx, traveler.id, mine);
      const cur = bracket.resolve(ctx.STRUCT, myIds, mine);
      if (!cur.next) return json({ error: "Your bracket is finished. Rerun it to change it." }, 409);
      if (body.game !== cur.next.id) return json({ error: "That's not the game on the screen.", picks: mine }, 409);
      if (!bracket.valid(ctx.STRUCT, myIds, mine, body.game, body.winner)) return json({ error: "Pick one of the two." }, 400);
      const now = new Date().toISOString();
      const upsert = (game, winner) => db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trip_id, traveler_id, game) DO UPDATE SET winner = excluded.winner, at = excluded.at").bind(ctx.TRIP_ID, traveler.id, game, winner, now);
      await db.batch([upsert(body.game, body.winner), ...(body.close === true ? [upsert(`close:${body.game}`, "1")] : [])]);
      const next = await loadState(ctx, db);
      const st = next.family.status[traveler.id];
      let fresh = [];
      if (st && st.complete) {
        const rk = next.family.ballots[traveler.id];
        await db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, now, traveler.id, "bracket", JSON.stringify({ champion: rk[0], ranking: rk }), `${traveler.name} finished a bracket: ${ctx.contenderName(rk[0])} is the champion, ${ctx.contenderName(rk[1])} second. ${Object.values(next.family.status).filter((x) => x.complete).length} of ${next.travelers.length} ballots are in.`).run();
        try { const ext = external(ctx, env, next); const p = ctx.planner.plan({ start: next.start, nights: next.nights }, intents.plannerState(next), { placements: next.placements }, ext); fresh = await evaluateAchievements(ctx, env, db, next, p, url.origin); } catch (e) { fresh = []; }
      }
      return json({ picks: next.picks[traveler.id] || {}, family: next.family, trip: publicState(ctx, next), decisions: await decisions(ctx, db), unlocked: fresh });
    }

    // Was that close? Mark or unmark a decided matchup, before or after the ballot is finished.
    // The forced winner stands; the closeness lifts the loser one block on this ballot only.
    if (url.pathname === "/api/bracket/close" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(ctx, db);
      const mine = s.picks[traveler.id] || {};
      const g = bracket.resolve(ctx.STRUCT, drawFor(ctx, traveler.id, mine), mine).games.find((x) => x.id === body.game);
      if (!g || !g.winner || g.auto) return json({ error: "That matchup isn't decided on your ballot.", picks: mine }, 409);
      const now = new Date().toISOString();
      if (body.close === false) await db.prepare("DELETE FROM bracket_picks WHERE trip_id = ? AND traveler_id = ? AND game = ?").bind(ctx.TRIP_ID, traveler.id, `close:${body.game}`).run();
      else await db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, ?, '1', ?) ON CONFLICT(trip_id, traveler_id, game) DO UPDATE SET at = excluded.at").bind(ctx.TRIP_ID, traveler.id, `close:${body.game}`, now).run();
      const next = await loadState(ctx, db);
      return json({ picks: next.picks[traveler.id] || {}, family: next.family, trip: publicState(ctx, next), questions: questionsFor(ctx, next, traveler.id), ladder: ladderFor(ctx, next, traveler.id) });
    }

    // A challenge: open a ladder on a contender you think sits too low, or answer a rung or a
    // boundary question. Arbitrary pairs are refused: that would be an override wearing a
    // comparison's clothes. A ladder climbs one neighbor at a time, stops on a loss, and there
    // are two per ballot. Boundary questions are the system's and cost nothing.
    if (url.pathname === "/api/bracket/challenge" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(ctx, db);
      const mine = s.picks[traveler.id] || {}, ballot = s.family.ballots[traveler.id];
      if (!ballot) return json({ error: "Finish your bracket first." }, 409);
      const now = new Date().toISOString();
      const reply = async (extra) => { const next = await loadState(ctx, db); return json({ picks: next.picks[traveler.id] || {}, family: next.family, trip: publicState(ctx, next), decisions: await decisions(ctx, db), questions: questionsFor(ctx, next, traveler.id), ladder: ladderFor(ctx, next, traveler.id), ...extra }); };
      if (body.open) {
        const id = String(body.open);
        if (!ctx.CIDS.includes(id)) return json({ error: "Not a contender." }, 400);
        const cur = ladderFor(ctx, s, traveler.id);
        if (cur.open) return json({ error: `Finish the ladder on ${ctx.contenderName(cur.open.id)} first.` }, 409);
        if (cur.used >= LADDER_BUDGET) return json({ error: "Two ladders per ballot, and you've used both. Rerun the bracket for a clean slate." }, 409);
        if (mine[`ladder:${id}`] != null) return json({ error: `${ctx.contenderName(id)} already had its ladder.` }, 409);
        if (!bracket.ladder(ballot, id, LADDER_DEPTH).length) return json({ error: `${ctx.contenderName(id)} is already on top.` }, 409);
        await db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, ?, '0', ?)").bind(ctx.TRIP_ID, traveler.id, `ladder:${id}`, now).run();
        return reply({});
      }
      const { a, b, winner } = body;
      if (!a || !b || a === b || (winner !== a && winner !== b)) return json({ error: "Pick one of the two." }, 400);
      const same = (q) => (q.a === a && q.b === b) || (q.a === b && q.b === a);
      const lad = ladderFor(ctx, s, traveler.id);
      const onLadder = lad.open && same(lad.open.next);
      const offered = questionsFor(ctx, s, traveler.id).some(same);
      if (!onLadder && !offered) return json({ error: "That pair isn't on the table." }, 409);
      const before = drivingOrder(s, traveler.id);
      const loser = winner === a ? b : a;
      const stmts = [db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trip_id, traveler_id, game) DO UPDATE SET winner = excluded.winner, at = excluded.at").bind(ctx.TRIP_ID, traveler.id, bracket.pairKey(a, b), winner, now)];
      if (onLadder) {
        const climbed = lad.open.climbed + 1;
        const state = winner !== lad.open.id || climbed >= LADDER_DEPTH ? "closed" : String(climbed); // stop on loss, or at the top rung
        stmts.push(db.prepare("UPDATE bracket_picks SET winner = ?, at = ? WHERE trip_id = ? AND traveler_id = ? AND game = ?").bind(state, now, ctx.TRIP_ID, traveler.id, `ladder:${lad.open.id}`));
      }
      await db.batch(stmts);
      const next = await loadState(ctx, db);
      // The log hears about it only when something crossed a cut line in the order that drives the schedule.
      const after = drivingOrder(next, traveler.id);
      const moved = [winner, loser].filter((id) => cutSide(ctx, before, id) !== cutSide(ctx, after, id));
      if (moved.length) {
        const id = moved.includes(winner) ? winner : loser;
        await db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, now, traveler.id, "bracket_challenge", JSON.stringify({ a, b, winner, ladder: onLadder ? lad.open.id : null, moved }), `${traveler.name} moved ${ctx.contenderName(winner)} above ${ctx.contenderName(loser)}. ${ctx.contenderName(id)} is ${CUT_WORD[cutSide(ctx, after, id)]}.`).run();
      }
      return reply({ moved });
    }

    // Rerun: the old ballot is gone, and the log says so.
    // The seeding round: three coarse buckets that decide who faces whom, and nothing else.
    // Only before the first pick; after that, rerun clears everything and the round comes back.
    if (url.pathname === "/api/bracket/seed" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(ctx, db);
      const had = s.family.status[traveler.id];
      if (had && had.picksMade) return json({ error: "Your bracket is under way. Rerun it to seed again." }, 409);
      const buckets = body.buckets || {};
      const rows = ctx.CIDS.map((id) => { const b = buckets[id] | 0; return b >= 1 && b <= 3 ? b : 2; });
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("DELETE FROM bracket_picks WHERE trip_id = ? AND traveler_id = ?").bind(ctx.TRIP_ID, traveler.id),
        ...ctx.CIDS.map((id, i) => db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, traveler.id, `bucket:${id}`, String(rows[i]), now)),
      ]);
      const next = await loadState(ctx, db);
      return json({ picks: next.picks[traveler.id] || {}, draw: drawFor(ctx, traveler.id, next.picks[traveler.id]), family: next.family, trip: publicState(ctx, next) });
    }

    // Along for the ride: no ballot, on the record. Counts as in, so the family's week stops waiting.
    if (url.pathname === "/api/bracket/abstain" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(ctx, db);
      const had = s.family.status[traveler.id];
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("DELETE FROM bracket_picks WHERE trip_id = ? AND traveler_id = ?").bind(ctx.TRIP_ID, traveler.id),
        db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, 'abstain', 'train', ?)").bind(ctx.TRIP_ID, traveler.id, now),
        db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, now, traveler.id, "bracket_abstain", JSON.stringify({ hadBallot: !!(had && had.complete) }), `${traveler.name} is along for the ride: no ballot, and the family's week doesn't wait on one.`),
      ]);
      const next = await loadState(ctx, db);
      const cur = ctx.planner.plan({ start: next.start, nights: next.nights }, intents.plannerState(next), { placements: next.placements }, external(ctx, env, next));
      let fresh = []; try { fresh = await evaluateAchievements(ctx, env, db, next, cur, url.origin); } catch (e) { fresh = []; }
      return json({ picks: next.picks[traveler.id] || {}, family: next.family, trip: publicState(ctx, next), decisions: await decisions(ctx, db), unlocked: fresh });
    }

    if (url.pathname === "/api/bracket/reset" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(ctx, db);
      const had = s.family.status[traveler.id];
      await db.prepare("DELETE FROM bracket_picks WHERE trip_id = ? AND traveler_id = ?").bind(ctx.TRIP_ID, traveler.id).run();
      if (had && had.abstained) await db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, new Date().toISOString(), traveler.id, "bracket_reset", JSON.stringify({ wasAbstain: true }), `${traveler.name} is filling in a bracket after all.`).run();
      else if (had && had.picksMade) await db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.TRIP_ID, new Date().toISOString(), traveler.id, "bracket_reset", JSON.stringify({ wasComplete: had.complete, champion: had.champion }), had.complete ? `${traveler.name} reran their bracket. The old ballot (${ctx.contenderName(had.champion)} on top) is gone until the new one is finished.` : `${traveler.name} started their bracket over.`).run();
      const next = await loadState(ctx, db);
      return json({ picks: {}, draw: ctx.CIDS, family: next.family, trip: publicState(ctx, next), decisions: await decisions(ctx, db) });
    }

    // Family-only pages live under /family/ so the same Access application covers them.
    // The Worker runs first for that prefix, checks the traveler, then serves the asset.
    if (url.pathname === "/family/scouts") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const page = await env.ASSETS.fetch(new Request(`${url.origin}/family/scouts.html`));
      return new Response(page.body, { status: page.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", ...SECURITY_HEADERS } });
    }
    if (url.pathname.startsWith("/family/")) return json({ error: "Not found." }, 404);

    // The family's trip. Access gates this path in production; the page itself works out
    // who you are from /api/me and shows the banner, or the bracket, the week, and the list.
    if (url.pathname === "/family") {
      const page = await env.ASSETS.fetch(new Request(`${url.origin}/family/trip.html`));
      return new Response(page.body, { status: page.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", ...SECURITY_HEADERS } });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);

    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  },
};

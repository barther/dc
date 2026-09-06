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
import achievements from "../public/achievements.js";
import intents from "./intents.js";
import { identify } from "./access.js";
import { forecast } from "./weather.js";

const TRIP_ID = "dc-2026";
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...extra } });

const validVenue = (id) => planner.catalog.venues.some((v) => v.id === id);
const venueName = (id) => (planner.catalog.venues.find((v) => v.id === id) || {}).name || id;

async function loadState(db) {
  const trip = await db.prepare("SELECT id, start, nights, version, updated_at, placements FROM trips WHERE id = ?").bind(TRIP_ID).first();
  if (!trip) return null;
  const rows = (await db.prepare("SELECT venue_id, state, set_by, set_at FROM trip_venue_state WHERE trip_id = ?").bind(TRIP_ID).all()).results;
  const prefs = (await db.prepare("SELECT traveler_id, venue_id, choice FROM preferences WHERE trip_id = ?").bind(TRIP_ID).all()).results;
  const marks = (await db.prepare("SELECT venue_id, kind, date FROM trip_marks WHERE trip_id = ?").bind(TRIP_ID).all()).results;
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
  return { id: trip.id, start: trip.start, nights: trip.nights, version: trip.version, updated_at: trip.updated_at, venues, preferences, completed, fixed, notThisDay, placements, travelers };
}

async function travelerFor(db, identity, env) {
  if (!identity || !identity.email) return null;
  const row = await db.prepare("SELECT t.id, t.name, t.role, t.is_admin FROM traveler_identities i JOIN travelers t ON t.id = i.traveler_id WHERE i.email = ?").bind(identity.email).first();
  if (row) return row;
  // Local dev only: DEV_IDENTITY may name a traveler id directly (e.g. "bart").
  if (identity.sub === "dev" && env && env.DEV_IDENTITY) return db.prepare("SELECT id, name, role, is_admin FROM travelers WHERE id = ?").bind(env.DEV_IDENTITY.split("@")[0].toLowerCase()).first();
  return null;
}

// Family state is behind sign-in. Public gets the pitch, not the game.
async function requireTraveler(request, env, db) {
  return (await travelerFor(db, await identify(request, env), env)) || null;
}

async function decisions(db, limit = 12) {
  const rows = (await db.prepare("SELECT d.at, d.type, d.summary, t.name AS who, t.is_admin AS admin FROM decisions d JOIN travelers t ON t.id = d.traveler_id WHERE d.trip_id = ? ORDER BY d.id DESC LIMIT ?").bind(TRIP_ID, limit).all()).results;
  return rows;
}

/* ───────────── Achievements: evaluate on every change, unlock once, never un-unlock ───────────── */

const akey = (scope, who, id) => scope === "trip" ? `trip:${TRIP_ID}:group:achievement:${id}` : `trip:${TRIP_ID}:user:${who}:achievement:${id}`;

async function unlocked(kv) {
  const byTraveler = {}, group = [];
  if (!kv) return { byTraveler, group };
  const list = await kv.list({ prefix: `trip:${TRIP_ID}:` });
  for (const k of list.keys) {
    const m = k.name.match(/^trip:[^:]+:(user:([^:]+)|group):achievement:(.+)$/);
    if (!m) continue;
    if (m[1] === "group") group.push(m[3]); else (byTraveler[m[2]] = byTraveler[m[2]] || []).push(m[3]);
  }
  return { byTraveler, group };
}

async function evaluateAchievements(env, db, s, plan) {
  const kv = env.KV; if (!kv) return [];
  const travelers = (await db.prepare("SELECT id, name, is_admin FROM travelers").all()).results;
  const allDecisions = (await db.prepare("SELECT type, traveler_id, payload FROM decisions WHERE trip_id = ?").bind(TRIP_ID).all()).results
    .map((d) => ({ type: d.type, traveler_id: d.traveler_id, payload: (() => { try { return JSON.parse(d.payload); } catch (e) { return {}; } })() }));
  const have = await unlocked(kv);
  const hadHiHi = false; // the planner forbids it; recorded here so the rule stays honest if that ever changes
  const fresh = [];
  const now = new Date().toISOString();
  for (const t of travelers) {
    const facts = { travelerId: t.id, isAdmin: !!t.is_admin, completed: s.completed, bundles: planner.catalog.bundles, decisions: allDecisions, preferences: s.preferences, phase: plan.phase, hadHiHi, unlockedByTraveler: have.byTraveler, travelerIds: travelers.map((x) => x.id) };
    for (const id of achievements.evaluate(facts)) {
      const def = achievements.byId[id];
      if (def.scope === "trip") { if (!have.group.includes(id)) { await kv.put(akey("trip", null, id), JSON.stringify({ unlockedAt: now, source: "evaluate", version: 1 })); have.group.push(id); fresh.push({ scope: "trip", id, name: def.name }); } continue; }
      if (!(have.byTraveler[t.id] || []).includes(id)) {
        await kv.put(akey("user", t.id, id), JSON.stringify({ unlockedAt: now, source: "evaluate", version: 1 }));
        (have.byTraveler[t.id] = have.byTraveler[t.id] || []).push(id);
        fresh.push({ scope: "user", traveler: t.id, name: def.name, id });
      }
    }
  }
  return fresh;
}

function publicState(s) {
  return { id: s.id, start: s.start, nights: s.nights, version: s.version, updated_at: s.updated_at, venues: s.venues, preferences: s.preferences,
    completed: s.completed, fixed: s.fixed, notThisDay: s.notThisDay, placements: s.placements, planner: intents.plannerState(s) };
}

// Today, in Washington's timezone. DEV_TODAY overrides for local testing of live mode.
function todayISO(env) {
  if (env.DEV_TODAY) return env.DEV_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function external(env) { return { today: todayISO(env) }; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;

    if (url.pathname === "/api/me") {
      const identity = await identify(request, env);
      const traveler = await travelerFor(db, identity, env);
      const all = (await db.prepare("SELECT id, name, role, is_admin FROM travelers ORDER BY rowid").all()).results;
      if (traveler) return json({ traveler, travelers: all });
      // Not mapped: say why, so a sign-in that goes nowhere is diagnosable from the page.
      const why = !identity ? "not_signed_in" : identity.error ? identity.error : `unknown_email: ${identity.email} is not on the trip`;
      return json({ traveler: null, travelers: all, why, email: identity && identity.email ? identity.email : undefined });
    }

    if (url.pathname === "/api/achievements") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      // Trip-level trophies can come due with time alone (the trip ending), so check here too.
      try { const s = await loadState(db); const ext = external(env); const cur = planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext); await evaluateAchievements(env, db, s, cur); } catch (e) {}
      const have = await unlocked(env.KV);
      const visible = achievements.defs.filter((d) => !d.hidden || have.group.includes(d.id) || Object.values(have.byTraveler).some((l) => l.includes(d.id)));
      return json({ ...have, defs: visible.map(({ id, name, description, scope, hidden }) => ({ id, name, description, scope, hidden: !!hidden })) });
    }

    if (url.pathname === "/api/today") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(db);
      const ext = external(env);
      const current = planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext);
      let weather = null, suggestion = null;
      if (current.phase === "live" || current.phase === "before") {
        weather = await forecast(env);
        if (weather && current.phase === "live") {
          const sw = planner.suggestSwap({ start: s.start, nights: s.nights }, intents.plannerState(s), current, { ...ext, weather });
          if (sw) suggestion = { moves: sw.moves.map((m) => ({ venue: current.units[m.id].members[0], name: m.name, date: m.to, from: m.from, fromFit: m.fromFit, toFit: m.toFit })), lines: sw.lines, summary: sw.summary, gain: sw.gain };
        }
      }
      const todayDay = current.days.find((d) => d.isToday);
      const fits = todayDay ? { day: todayDay.day ? planner.weatherFit(current.units[todayDay.day.id], weather && weather[ext.today]) : null, night: todayDay.night ? planner.weatherFit(current.units[todayDay.night.id], weather && weather[ext.today]) : null } : null;
      return json({ today: ext.today, phase: current.phase, weather, fits, suggestion });
    }

    if (url.pathname === "/api/trip" && request.method === "GET") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(db);
      if (!s) return json({ error: "No trip yet. Run the migrations." }, 500);
      return json({ trip: publicState(s), decisions: await decisions(db), today: todayISO(env) });
    }

    if (url.pathname === "/api/intent" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(db);
      if (body.version && body.version !== s.version) return json({ error: "Somebody else changed the trip first.", trip: publicState(s), decisions: await decisions(db) }, 409);

      const intent = { ...body.intent, name: body.intent && body.intent.venue ? venueName(body.intent.venue) : undefined };
      const r = intents.apply(s, intent, traveler, { MIN_NIGHTS: planner.MIN_NIGHTS, MAX_NIGHTS: planner.MAX_NIGHTS, validVenue });
      if (r.error) return json({ error: r.error }, r.status || 400);

      // The planner is the validator: run it on the candidate state, and explain the consequence.
      const ext = external(env);
      const before = planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext);
      const after = planner.plan({ start: r.state.start, nights: r.state.nights }, intents.plannerState(r.state), before, ext);
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
        db.prepare("INSERT INTO trip_versions (trip_id, version, at) VALUES (?, ?, ?)").bind(TRIP_ID, s.version + 1, now),
        db.prepare("UPDATE trips SET start = ?, nights = ?, placements = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?").bind(r.state.start, r.state.nights, JSON.stringify(after.placements), s.version + 1, now, TRIP_ID, s.version),
        db.prepare("DELETE FROM trip_marks WHERE trip_id = ?").bind(TRIP_ID),
        ...Object.entries(r.state.completed).map(([vid, d]) => db.prepare("INSERT INTO trip_marks (trip_id, venue_id, kind, date, set_by, set_at) VALUES (?, ?, 'completed', ?, ?, ?)").bind(TRIP_ID, vid, d, traveler.id, now)),
        ...Object.entries(r.state.fixed).map(([vid, d]) => db.prepare("INSERT INTO trip_marks (trip_id, venue_id, kind, date, set_by, set_at) VALUES (?, ?, 'fixed', ?, ?, ?)").bind(TRIP_ID, vid, d, traveler.id, now)),
        ...Object.entries(r.state.notThisDay).flatMap(([vid, ds]) => ds.map((d) => db.prepare("INSERT INTO trip_marks (trip_id, venue_id, kind, date, set_by, set_at) VALUES (?, ?, 'not_this_day', ?, ?, ?)").bind(TRIP_ID, vid, d, traveler.id, now))),
        db.prepare("DELETE FROM trip_venue_state WHERE trip_id = ?").bind(TRIP_ID),
        ...Object.entries(r.state.venues).map(([vid, st]) => db.prepare("INSERT INTO trip_venue_state (trip_id, venue_id, state, set_by, set_at) VALUES (?, ?, ?, ?, ?)").bind(TRIP_ID, vid, st, traveler.id, now)),
        db.prepare("DELETE FROM preferences WHERE trip_id = ?").bind(TRIP_ID),
        ...Object.entries(r.state.preferences).flatMap(([tid, prefs]) => Object.entries(prefs).map(([vid, c]) => db.prepare("INSERT INTO preferences (trip_id, traveler_id, venue_id, choice, set_at) VALUES (?, ?, ?, ?, ?)").bind(TRIP_ID, tid, vid, c, now))),
        db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(TRIP_ID, now, traveler.id, intent.type, JSON.stringify(body.intent), `${r.summary}${consequence ? " " + consequence : ""} Now: ${after.label}.`),
      ];
      let results;
      try { results = await db.batch(stmts); }
      catch (e) { const cur = await loadState(db); return json({ error: "Somebody else changed the trip first.", trip: publicState(cur), decisions: await decisions(db) }, 409); }
      if (!results[1].meta.changes) { const cur = await loadState(db); return json({ error: "Somebody else changed the trip first.", trip: publicState(cur), decisions: await decisions(db) }, 409); }
      const cur = await loadState(db);
      let fresh = [];
      try { fresh = await evaluateAchievements(env, db, cur, after); } catch (e) { fresh = []; }
      return json({ trip: publicState(cur), decisions: await decisions(db), label: after.label, today: todayISO(env), unlocked: fresh });
    }

    if (url.pathname === "/family") {
      // Access gates this path; once through, the Access cookie covers the API. Back to the page.
      return new Response(null, { status: 302, headers: { location: "/#signed-in", ...SECURITY_HEADERS } });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);

    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  },
};

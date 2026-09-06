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
import bracket from "../public/bracket.js";
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

// The bracket is the same for everyone: contenders and draw come from the catalog alone.
const CONTENDERS = bracket.contenders(planner.catalog);
const CIDS = CONTENDERS.map((c) => c.id);
const STRUCT = bracket.structure(CIDS.length);
const contenderName = (id) => (CONTENDERS.find((c) => c.id === id) || {}).name || id;

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
  const picks = await loadPicks(db);
  return { id: trip.id, start: trip.start, nights: trip.nights, version: trip.version, updated_at: trip.updated_at, venues, preferences, completed, fixed, notThisDay, placements, travelers, picks, family: familyFromPicks(picks, travelers) };
}

// Everyone's bracket picks: { traveler: { game: winner } }. Survives the table not existing yet.
async function loadPicks(db) {
  try {
    const rows = (await db.prepare("SELECT traveler_id, game, winner FROM bracket_picks WHERE trip_id = ?").bind(TRIP_ID).all()).results;
    const picks = {}; for (const r of rows) (picks[r.traveler_id] = picks[r.traveler_id] || {})[r.game] = r.winner;
    return picks;
  } catch (e) { return {}; }
}

// Where the family stands: each ballot's state, and the order the planner schedules by.
function familyFromPicks(picks, travelers) {
  const ballots = {}, status = {};
  for (const t of travelers) {
    const p = picks[t] || {};
    const r = bracket.resolve(STRUCT, CIDS, p);
    const ranking = r.complete ? bracket.ranking(STRUCT, CIDS, p) : null;
    status[t] = { complete: r.complete, picksMade: r.picksMade, picksNeeded: r.picksNeeded, champion: ranking ? ranking[0] : null };
    if (ranking) ballots[t] = ranking;
  }
  const order = bracket.familyOrder(ballots, CIDS);
  return { status, ballots, order, familyRank: order.map((r) => r.id), champions: order.filter((r) => r.protected).map((r) => r.id) };
}

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

async function decisions(db, limit = 12) {
  const rows = (await db.prepare("SELECT d.id, d.at, d.type, d.summary, t.id AS who_id, t.name AS who, t.is_admin AS admin FROM decisions d JOIN travelers t ON t.id = d.traveler_id WHERE d.trip_id = ? ORDER BY d.id DESC LIMIT ?").bind(TRIP_ID, limit).all()).results;
  if (!rows.length) return rows;
  // Everyone's take on each entry, oldest first.
  const ids = rows.map((r) => r.id);
  const ops = (await db.prepare(`SELECT o.decision_id, o.traveler_id, t.name, o.stance, o.note, o.at FROM decision_opinions o JOIN travelers t ON t.id = o.traveler_id WHERE o.decision_id IN (${ids.map(() => "?").join(",")}) ORDER BY o.at`).bind(...ids).all()).results;
  for (const r of rows) r.opinions = ops.filter((o) => o.decision_id === r.id).map((o) => ({ traveler: o.traveler_id, name: o.name, stance: o.stance, note: o.note, at: o.at }));
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

// How many of the hunt's family photos exist as /img/done-<file>. Static assets, so a HEAD each.
async function countPhotos(env, origin) {
  if (!env.ASSETS || !origin) return 0;
  const hits = await Promise.all(achievements.HUNT.map(async (f) => {
    // The assets binding answers misses with the index page (single-page-application fallback), so an image is the only real hit.
    try { const r = await env.ASSETS.fetch(new Request(`${origin}/img/done-${f}`, { method: "HEAD" })); return r.ok && (r.headers.get("content-type") || "").startsWith("image/") ? 1 : 0; } catch (e) { return 0; }
  }));
  return hits.reduce((a, b) => a + b, 0);
}

async function evaluateAchievements(env, db, s, plan, origin) {
  const kv = env.KV; if (!kv) return [];
  const photos = await countPhotos(env, origin);
  const travelers = (await db.prepare("SELECT id, name, is_admin FROM travelers").all()).results;
  const allDecisions = (await db.prepare("SELECT type, traveler_id, payload FROM decisions WHERE trip_id = ?").bind(TRIP_ID).all()).results
    .map((d) => ({ type: d.type, traveler_id: d.traveler_id, payload: (() => { try { return JSON.parse(d.payload); } catch (e) { return {}; } })() }));
  const have = await unlocked(kv);
  const hadHiHi = false; // the planner forbids it; recorded here so the rule stays honest if that ever changes
  const fresh = [];
  const now = new Date().toISOString();
  for (const t of travelers) {
    const facts = { travelerId: t.id, isAdmin: !!t.is_admin, completed: s.completed, bundles: planner.catalog.bundles, decisions: allDecisions, preferences: s.preferences, phase: plan.phase, hadHiHi, unlockedByTraveler: have.byTraveler, travelerIds: travelers.map((x) => x.id), photos, bracket: bracketFacts(s) };
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

function bracketFacts(s) {
  const f = s.family || { status: {}, familyRank: [] };
  const ballots = {}; for (const [t, st] of Object.entries(f.status)) if (st.complete) ballots[t] = { champion: st.champion };
  return { ballots, familyRank: f.familyRank, seeds: Object.fromEntries(CONTENDERS.map((c) => [c.id, c.seed])) };
}

function publicState(s) {
  return { id: s.id, start: s.start, nights: s.nights, version: s.version, updated_at: s.updated_at, venues: s.venues, preferences: s.preferences,
    completed: s.completed, fixed: s.fixed, notThisDay: s.notThisDay, placements: s.placements, planner: intents.plannerState(s), bracket: s.family };
}

// Today, in Washington's timezone. DEV_TODAY overrides for local testing of live mode.
function todayISO(env) {
  if (env.DEV_TODAY) return env.DEV_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// What the planner is told from outside the catalog: the date, and the family's order when there is one.
function external(env, s) { return { today: todayISO(env), familyRank: s && s.family ? s.family.familyRank : [], champions: s && s.family ? s.family.champions : [] }; }

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
      try { const s = await loadState(db); const ext = external(env, s); const cur = planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s), { placements: s.placements }, ext); await evaluateAchievements(env, db, s, cur, url.origin); } catch (e) {}
      const have = await unlocked(env.KV);
      const visible = achievements.defs.filter((d) => !d.hidden || have.group.includes(d.id) || Object.values(have.byTraveler).some((l) => l.includes(d.id)));
      return json({ ...have, defs: visible.map(({ id, name, description, scope, hidden, track, badge, only }) => ({ id, name, description, scope, hidden: !!hidden, track: track || null, badge: badge || null, only: only || null })) });
    }

    if (url.pathname === "/api/today") {
      if (!(await requireTraveler(request, env, db))) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(db);
      const ext = external(env, s);
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
      const ext = external(env, s);
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
      try { fresh = await evaluateAchievements(env, db, cur, after, url.origin); } catch (e) { fresh = []; }
      return json({ trip: publicState(cur), decisions: await decisions(db), label: after.label, today: todayISO(env), unlocked: fresh });
    }

    // An opinion on a log entry. Not a trip change: no version bump, no planner run.
    if (url.pathname === "/api/opinion" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const id = Number(body.decision);
      if (!Number.isInteger(id)) return json({ error: "Which decision?" }, 400);
      const exists = await db.prepare("SELECT id FROM decisions WHERE id = ? AND trip_id = ?").bind(id, TRIP_ID).first();
      if (!exists) return json({ error: "No such decision." }, 404);
      const stance = body.stance === "fine" || body.stance === "object" ? body.stance : null;
      const note = String(body.note || "").trim().slice(0, 200);
      if (stance) await db.prepare("INSERT INTO decision_opinions (decision_id, traveler_id, stance, note, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(decision_id, traveler_id) DO UPDATE SET stance = excluded.stance, note = excluded.note, at = excluded.at").bind(id, traveler.id, stance, note, new Date().toISOString()).run();
      else await db.prepare("DELETE FROM decision_opinions WHERE decision_id = ? AND traveler_id = ?").bind(id, traveler.id).run();
      return json({ decisions: await decisions(db) });
    }

    /* ───────────── The bracket ───────────── */

    if (url.pathname === "/api/bracket" && request.method === "GET") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(db);
      return json({ contenders: CONTENDERS, structure: STRUCT, me: traveler.id, picks: s.picks[traveler.id] || {}, family: s.family });
    }

    // One pick: the next undecided game, one of its two contenders. Saved as you go.
    if (url.pathname === "/api/bracket/pick" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(db);
      const mine = s.picks[traveler.id] || {};
      const cur = bracket.resolve(STRUCT, CIDS, mine);
      if (!cur.next) return json({ error: "Your bracket is finished. Rerun it to change it." }, 409);
      if (body.game !== cur.next.id) return json({ error: "That's not the game on the screen.", picks: mine }, 409);
      if (!bracket.valid(STRUCT, CIDS, mine, body.game, body.winner)) return json({ error: "Pick one of the two." }, 400);
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO bracket_picks (trip_id, traveler_id, game, winner, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(trip_id, traveler_id, game) DO UPDATE SET winner = excluded.winner, at = excluded.at").bind(TRIP_ID, traveler.id, body.game, body.winner, now).run();
      const next = await loadState(db);
      const st = next.family.status[traveler.id];
      let fresh = [];
      if (st && st.complete) {
        const rk = next.family.ballots[traveler.id];
        await db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(TRIP_ID, now, traveler.id, "bracket", JSON.stringify({ champion: rk[0], ranking: rk }), `${traveler.name} finished a bracket: ${contenderName(rk[0])} is the champion, ${contenderName(rk[1])} second. ${Object.values(next.family.status).filter((x) => x.complete).length} of ${next.travelers.length} ballots are in.`).run();
        try { const ext = external(env, next); const p = planner.plan({ start: next.start, nights: next.nights }, intents.plannerState(next), { placements: next.placements }, ext); fresh = await evaluateAchievements(env, db, next, p, url.origin); } catch (e) { fresh = []; }
      }
      return json({ picks: next.picks[traveler.id] || {}, family: next.family, trip: publicState(next), decisions: await decisions(db), unlocked: fresh });
    }

    // Rerun: the old ballot is gone, and the log says so.
    if (url.pathname === "/api/bracket/reset" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env), env);
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      const s = await loadState(db);
      const had = s.family.status[traveler.id];
      await db.prepare("DELETE FROM bracket_picks WHERE trip_id = ? AND traveler_id = ?").bind(TRIP_ID, traveler.id).run();
      if (had && had.picksMade) await db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(TRIP_ID, new Date().toISOString(), traveler.id, "bracket_reset", JSON.stringify({ wasComplete: had.complete, champion: had.champion }), had.complete ? `${traveler.name} reran their bracket. The old ballot (${contenderName(had.champion)} on top) is gone until the new one is finished.` : `${traveler.name} started their bracket over.`).run();
      const next = await loadState(db);
      return json({ picks: {}, family: next.family, trip: publicState(next), decisions: await decisions(db) });
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

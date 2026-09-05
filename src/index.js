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
import intents from "./intents.js";
import { identify } from "./access.js";

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
  const trip = await db.prepare("SELECT id, start, nights, version, updated_at FROM trips WHERE id = ?").bind(TRIP_ID).first();
  if (!trip) return null;
  const rows = (await db.prepare("SELECT venue_id, state, set_by, set_at FROM trip_venue_state WHERE trip_id = ?").bind(TRIP_ID).all()).results;
  const prefs = (await db.prepare("SELECT traveler_id, venue_id, choice FROM preferences WHERE trip_id = ?").bind(TRIP_ID).all()).results;
  const venues = {}; for (const r of rows) venues[r.venue_id] = r.state;
  const preferences = {}; for (const r of prefs) (preferences[r.traveler_id] = preferences[r.traveler_id] || {})[r.venue_id] = r.choice;
  return { id: trip.id, start: trip.start, nights: trip.nights, version: trip.version, updated_at: trip.updated_at, venues, preferences };
}

async function travelerFor(db, identity) {
  if (!identity || !identity.email) return null;
  return db.prepare("SELECT t.id, t.name, t.role, t.is_admin FROM traveler_identities i JOIN travelers t ON t.id = i.traveler_id WHERE i.email = ?").bind(identity.email).first();
}

async function decisions(db, limit = 12) {
  const rows = (await db.prepare("SELECT d.at, d.type, d.summary, t.name AS who, t.is_admin AS admin FROM decisions d JOIN travelers t ON t.id = d.traveler_id WHERE d.trip_id = ? ORDER BY d.id DESC LIMIT ?").bind(TRIP_ID, limit).all()).results;
  return rows;
}

function publicState(s) {
  return { id: s.id, start: s.start, nights: s.nights, version: s.version, updated_at: s.updated_at, venues: s.venues, preferences: s.preferences, planner: intents.plannerState(s) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;

    if (url.pathname === "/api/me") {
      const traveler = await travelerFor(db, await identify(request, env));
      const all = (await db.prepare("SELECT id, name, role, is_admin FROM travelers ORDER BY rowid").all()).results;
      return json(traveler ? { traveler, travelers: all } : { traveler: null, travelers: all });
    }

    if (url.pathname === "/api/trip" && request.method === "GET") {
      const s = await loadState(db);
      if (!s) return json({ error: "No trip yet. Run the migrations." }, 500);
      return json({ trip: publicState(s), decisions: await decisions(db) });
    }

    if (url.pathname === "/api/intent" && request.method === "POST") {
      const traveler = await travelerFor(db, await identify(request, env));
      if (!traveler) return json({ error: "Sign in as a traveler first.", signin: "/family" }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ error: "Bad JSON." }, 400); }
      const s = await loadState(db);
      if (body.version && body.version !== s.version) return json({ error: "Somebody else changed the trip first.", trip: publicState(s), decisions: await decisions(db) }, 409);

      const intent = { ...body.intent, name: body.intent && body.intent.venue ? venueName(body.intent.venue) : undefined };
      const r = intents.apply(s, intent, traveler, { MIN_NIGHTS: planner.MIN_NIGHTS, MAX_NIGHTS: planner.MAX_NIGHTS, validVenue });
      if (r.error) return json({ error: r.error }, r.status || 400);

      // The planner is the validator: run it on the candidate state, and explain the consequence.
      const before = planner.plan({ start: s.start, nights: s.nights }, intents.plannerState(s));
      const after = planner.plan({ start: r.state.start, nights: r.state.nights }, intents.plannerState(r.state), before);
      const acted = intent.members || (intent.venue ? [intent.venue] : []);
      const d = planner.diff(before, after, acted);
      const consequence = [...d.messages, ...d.notes].join(" ");
      if (d.consequential && !body.confirmed) {
        return json({ preview: true, messages: d.messages, notes: d.notes, label: after.label,
          flags: { identityChanged: d.identityChanged, cutHeadlines: d.cutHeadlines, cutProtected: d.cutProtected, newAvoid: d.newAvoid, shortened: d.shortened } }, 200);
      }

      const now = new Date().toISOString();
      const stmts = [
        db.prepare("UPDATE trips SET start = ?, nights = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(r.state.start, r.state.nights, now, TRIP_ID, s.version),
        db.prepare("DELETE FROM trip_venue_state WHERE trip_id = ?").bind(TRIP_ID),
        ...Object.entries(r.state.venues).map(([vid, st]) => db.prepare("INSERT INTO trip_venue_state (trip_id, venue_id, state, set_by, set_at) VALUES (?, ?, ?, ?, ?)").bind(TRIP_ID, vid, st, traveler.id, now)),
        db.prepare("DELETE FROM preferences WHERE trip_id = ?").bind(TRIP_ID),
        ...Object.entries(r.state.preferences).flatMap(([tid, prefs]) => Object.entries(prefs).map(([vid, c]) => db.prepare("INSERT INTO preferences (trip_id, traveler_id, venue_id, choice, set_at) VALUES (?, ?, ?, ?, ?)").bind(TRIP_ID, tid, vid, c, now))),
        db.prepare("INSERT INTO decisions (trip_id, at, traveler_id, type, payload, summary) VALUES (?, ?, ?, ?, ?, ?)").bind(TRIP_ID, now, traveler.id, intent.type, JSON.stringify(body.intent), `${r.summary}${consequence ? " " + consequence : ""} Now: ${after.label}.`),
      ];
      const results = await db.batch(stmts);
      if (!results[0].meta.changes) { const cur = await loadState(db); return json({ error: "Somebody else changed the trip first.", trip: publicState(cur), decisions: await decisions(db) }, 409); }
      const cur = await loadState(db);
      return json({ trip: publicState(cur), decisions: await decisions(db), label: after.label });
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

/*
 * Intents: what a traveler asked to do, applied to shared trip state.
 *
 * Pure. No database, no DOM. The Worker loads state, applies the intent,
 * runs the planner on the result, and persists both the state and a decision
 * record. The client never sends itinerary JSON, only intent.
 *
 *   Anyone can operate the vacation. Bart administers the vacation.
 */
(function (root) {
  "use strict";

  // Structural mutations. Only a Trip Administrator.
  const ADMIN_ONLY = new Set(["set_dates", "set_nights", "reset", "override_preference"]);
  // Everything else any authenticated traveler may do.
  const ANYONE = new Set(["punt", "unpunt", "pin", "unpin", "ask", "unask", "prefer"]);

  const VENUE_STATES = ["punted", "pinned", "requested"];

  function can(traveler, type) {
    if (!traveler) return false;
    if (ADMIN_ONLY.has(type)) return !!traveler.is_admin;
    return ANYONE.has(type);
  }

  // state: { start, nights, venues: { [venueId]: 'punted'|'pinned'|'requested' }, preferences: { [travelerId]: { [venueId]: choice } } }
  function apply(state, intent, traveler, limits) {
    const { MIN_NIGHTS, MAX_NIGHTS, validVenue } = limits;
    if (!can(traveler, intent.type)) return { error: ADMIN_ONLY.has(intent.type) ? "Bart administers the vacation. That one's his." : "Not a thing you can do.", status: 403 };
    const next = { start: state.start, nights: state.nights, venues: { ...state.venues }, preferences: JSON.parse(JSON.stringify(state.preferences || {})) };
    const venue = intent.venue;
    const needVenue = () => { if (!venue || !validVenue(venue)) return { error: "Unknown venue.", status: 400 }; return null; };
    let summary = "";

    switch (intent.type) {
      case "set_dates": {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(intent.start || "")) return { error: "Bad date.", status: 400 };
        next.start = intent.start; summary = `moved arrival to ${intent.start}.`; break;
      }
      case "set_nights": {
        const n = intent.nights | 0;
        if (n < MIN_NIGHTS || n > MAX_NIGHTS) return { error: `Nights must be ${MIN_NIGHTS}–${MAX_NIGHTS}.`, status: 400 };
        next.nights = n; summary = `set the trip to ${n} ${n === 1 ? "night" : "nights"}.`; break;
      }
      case "reset": {
        next.start = intent.start || next.start; next.nights = intent.nights || next.nights; next.venues = {};
        summary = "went back to the recommended trip."; break;
      }
      case "punt": case "pin": case "ask": {
        const e = needVenue(); if (e) return e;
        const to = { punt: "punted", pin: "pinned", ask: "requested" }[intent.type];
        for (const v of intent.members || [venue]) next.venues[v] = to;
        summary = { punt: "punted", pin: "marked must-do", ask: "added" }[intent.type] + ` ${intent.name || venue}.`; break;
      }
      case "unpunt": case "unpin": case "unask": {
        const e = needVenue(); if (e) return e;
        for (const v of intent.members || [venue]) {
          if (intent.type === "unpin" && intent.backTo === "requested") next.venues[v] = "requested";
          else delete next.venues[v];
        }
        summary = { unpunt: "brought back", unpin: "relaxed", unask: "took back" }[intent.type] + ` ${intent.name || venue}.`; break;
      }
      case "prefer": {
        const e = needVenue(); if (e) return e;
        if (!["must", "good", "meh", "punt", null].includes(intent.choice)) return { error: "Bad choice.", status: 400 };
        next.preferences[traveler.id] = next.preferences[traveler.id] || {};
        if (intent.choice) next.preferences[traveler.id][venue] = intent.choice; else delete next.preferences[traveler.id][venue];
        summary = intent.choice ? `${{ must: "must do", good: "sounds good", meh: "meh", punt: "punt" }[intent.choice]}: ${intent.name || venue}.` : `cleared ${intent.name || venue}.`; break;
      }
      case "override_preference": {
        const e = needVenue(); if (e) return e;
        if (!intent.traveler) return { error: "Whose preference?", status: 400 };
        next.preferences[intent.traveler] = next.preferences[intent.traveler] || {};
        if (intent.choice) next.preferences[intent.traveler][venue] = intent.choice; else delete next.preferences[intent.traveler][venue];
        summary = `overrode ${intent.traveler}'s preference on ${intent.name || venue}.`; break;
      }
      default: return { error: "Unknown intent.", status: 400 };
    }
    return { state: next, summary: `${traveler.name} ${summary}` };
  }

  // Group interpretation of personal preferences, layered under explicit shared state.
  //   any Must do -> pinned; everyone who has an opinion says punt (and at least two do) -> punted;
  //   mixed -> the planner decides; no response -> neutral.
  function groupState(state) {
    const venues = { ...state.venues };
    const byVenue = {};
    for (const [tid, prefs] of Object.entries(state.preferences || {})) for (const [vid, c] of Object.entries(prefs)) (byVenue[vid] = byVenue[vid] || []).push({ tid, c });
    for (const [vid, votes] of Object.entries(byVenue)) {
      if (venues[vid]) continue; // explicit shared state (an administrator's override) wins
      if (votes.some((v) => v.c === "must")) venues[vid] = "pinned";
      else if (votes.length >= 2 && votes.every((v) => v.c === "punt")) venues[vid] = "punted";
      else if (votes.some((v) => v.c === "good") && !votes.some((v) => v.c === "punt")) venues[vid] = "requested";
    }
    return venues;
  }

  // The planner's state shape from the shared state.
  function plannerState(state) {
    const venues = groupState(state);
    const pick = (s) => Object.entries(venues).filter(([, v]) => v === s).map(([k]) => k);
    return { punted: pick("punted"), pinned: pick("pinned"), requested: pick("requested") };
  }

  const api = { apply, can, groupState, plannerState, ADMIN_ONLY, ANYONE, VENUE_STATES };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.DCIntents = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

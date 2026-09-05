/*
 * Achievements — static definitions plus a pure evaluator.
 *
 * Reward discovery, judgment, participation, and chaos. Never steps, never
 * attraction count, never suffering. Definitions are data; unlock facts live
 * in KV, written once and never un-written.
 *
 *   scope: "user" (each traveler) | "trip" (the whole family)
 *   rule types: venue_complete, venues_complete (all), bundle_complete,
 *               count_complete (n of a list), decision (a type of decision,
 *               by me or anyone), trip_complete, hidden custom checks.
 */
(function (root) {
  "use strict";

  const SMITHSONIAN = ["air-space", "natural-history", "american-history", "african-american-history"];

  const defs = [
    { id: "we-the-people", name: "We The People", description: "See the Declaration, Constitution, and Bill of Rights.", scope: "user", rule: { type: "venue_complete", venue: "national-archives" } },
    { id: "checks-and-balances", name: "Checks and Balances", description: "Complete the Capitol and the Library of Congress.", scope: "user", rule: { type: "bundle_complete", bundle: "capitol-hill" } },
    { id: "one-small-step", name: "One Small Step", description: "Complete Air & Space.", scope: "user", rule: { type: "venue_complete", venue: "air-space" } },
    { id: "night-at-the-monuments", name: "Night at the Monuments", description: "Finish the entire memorial loop.", scope: "user", rule: { type: "bundle_complete", bundle: "main-memorial-loop" } },
    { id: "hope-dealer", name: "Hope Dealer", description: "See the Hope Diamond.", scope: "user", rule: { type: "venue_complete", venue: "natural-history" } },
    { id: "smithsonian-hat-trick", name: "Smithsonian Hat Trick", description: "Complete three Smithsonian museums.", scope: "user", rule: { type: "count_complete", venues: SMITHSONIAN, count: 3 } },
    { id: "o-christmas-tree", name: "O Christmas Tree", description: "Stand in front of the National Christmas Tree.", scope: "user", rule: { type: "venue_complete", venue: "national-christmas-tree" } },
    { id: "unknown-soldier", name: "Known to God", description: "See the Changing of the Guard at Arlington.", scope: "user", rule: { type: "venue_complete", venue: "arlington" } },
    { id: "weather-wizard", name: "Weather Wizard", description: "Accept a weather-driven swap.", scope: "user", rule: { type: "decision", decision: "swap", by: "me" } },
    { id: "strategic-withdrawal", name: "Strategic Withdrawal", description: "Punt something rather than force the outing.", scope: "user", rule: { type: "decision", decision: ["punt", "prefer:punt"], by: "me" } },
    { id: "twenty-dollar-solution", name: "The Twenty-Dollar Solution", description: "Use the car to bail out rather than suffer.", scope: "user", rule: { type: "decision", decision: "bail", by: "any" } },
    { id: "opinionated", name: "Opinionated", description: "Weigh in on five things.", scope: "user", rule: { type: "preferences", count: 5 } },
    { id: "plan-not-sacred", name: "The Plan Is Not Sacred", description: "Deviate from the recommendation and end up with a better day.", scope: "user", hidden: true, rule: { type: "decision", decision: ["not_this_day", "place", "swap"], by: "me" } },
    { id: "no-death-march", name: "No Death March", description: "Complete the trip without a HI/HI day.", scope: "trip", rule: { type: "trip_complete", no_hihi: true } },
    { id: "wally-world", name: "Wally World Was Open", description: "Finish the vacation.", scope: "trip", rule: { type: "trip_complete" } },
    { id: "full-party-capitol", name: "Full Party Clear", description: "All four travelers completed Capitol Hill.", scope: "trip", rule: { type: "bundle_complete", bundle: "capitol-hill" } },
    { id: "four-score", name: "Four Score", description: "Every traveler unlocked at least four achievements.", scope: "trip", rule: { type: "everyone_has", count: 4 } },
    { id: "clark-griswold", name: "Clark Griswold Distinguished Service Medal", description: "Administer a whole family vacation and get everyone home.", scope: "user", hidden: true, rule: { type: "trip_complete", admin: true } },
  ];

  /*
   * facts: {
   *   travelerId, isAdmin, completed: { venue: date }, bundles: { id: { core: [] } },
   *   decisions: [{ type, traveler_id, payload }], preferences: { travelerId: { venue: choice } },
   *   phase: "plan"|"before"|"live"|"after", hadHiHi: bool, unlockedByTraveler: { travelerId: [ids] }
   * }
   */
  function evaluate(facts) {
    const done = (v) => !!facts.completed[v];
    const mine = (d) => d.traveler_id === facts.travelerId;
    const decisionMatches = (d, want) => {
      const wants = Array.isArray(want) ? want : [want];
      return wants.some((w) => w === d.type || (w.startsWith("prefer:") && d.type === "prefer" && d.payload && d.payload.choice === w.slice(7)));
    };
    const out = [];
    for (const a of defs) {
      const r = a.rule; let ok = false;
      switch (r.type) {
        case "venue_complete": ok = done(r.venue); break;
        case "venues_complete": ok = r.venues.every(done); break;
        case "bundle_complete": ok = ((facts.bundles[r.bundle] || {}).core || []).every(done); break;
        case "count_complete": ok = r.venues.filter(done).length >= r.count; break;
        case "decision": ok = facts.decisions.some((d) => decisionMatches(d, r.decision) && (r.by === "any" || mine(d))); break;
        case "preferences": ok = Object.keys((facts.preferences || {})[facts.travelerId] || {}).length >= r.count; break;
        case "trip_complete": ok = facts.phase === "after" && (!r.no_hihi || !facts.hadHiHi) && (!r.admin || !!facts.isAdmin); break;
        case "everyone_has": { const u = facts.unlockedByTraveler || {}; const ids = Object.keys(u); ok = ids.length > 0 && ids.every((t) => (u[t] || []).length >= r.count); break; }
        default: ok = false;
      }
      if (ok) out.push(a.id);
    }
    return out;
  }

  const api = { defs, evaluate, byId: Object.fromEntries(defs.map((d) => [d.id, d])) };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.DCAchievements = api;
})(typeof window !== "undefined" ? window : globalThis);

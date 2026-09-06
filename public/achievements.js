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
    // The bracket: what the vote said about us.
    { id: "landslide", name: "Landslide", description: "Every ballot crowned the same champion.", scope: "trip", rule: { type: "bracket", fact: "landslide" } },
    { id: "bracket-buster", name: "Bracket Buster", description: "Your champion wasn't the family's number one.", scope: "user", rule: { type: "bracket", fact: "buster" } },
    { id: "cinderella", name: "Cinderella", description: "A 13-seed or lower made the family's top eight.", scope: "trip", rule: { type: "bracket", fact: "cinderella" } },
    { id: "clark-griswold", name: "Clark Griswold Distinguished Service Medal", description: "Administer a whole family vacation and get everyone home.", scope: "user", hidden: true, rule: { type: "trip_complete", admin: true } },

    // Sam's blue cards. One traveler, one track: each unlocks when the venue that
    // satisfies a merit badge requirement is marked done. They live beside the
    // family trophies, never in the standings. Requirement numbers are from the
    // official scouting.org pages, checked September 2026.
    { id: "seven-b", name: "Seven-B", description: "Tour the U.S. Capitol.", badge: "Citizenship in the Nation 7b", only: "sam", track: "scouts", scope: "user", rule: { type: "venue_complete", venue: "us-capitol" } },
    { id: "federal-facility", name: "Federal Facility", description: "Tour the National Archives and say what it does for the nation.", badge: "Citizenship in the Nation 7c", only: "sam", track: "scouts", scope: "user", rule: { type: "venue_complete", venue: "national-archives" } },
    { id: "on-the-register", name: "On the Register", description: "Visit a place on the National Register of Historic Places.", badge: "Citizenship in the Nation 7a", only: "sam", track: "scouts", scope: "user", rule: { type: "count_complete", venues: ["library-of-congress", "fords-theatre", "national-cathedral", "georgetown"], count: 1 } },
    { id: "monumental", name: "Monumental", description: "Stand at the national monument you chose.", badge: "Citizenship in the Nation 7d", only: "sam", track: "scouts", scope: "user", rule: { type: "count_complete", venues: ["lincoln-memorial", "washington-monument"], count: 1 } },
    { id: "clean-sweep", name: "Clean Sweep", description: "All four site visits, when the badge asks for two.", badge: "Citizenship in the Nation 7, twice over", only: "sam", track: "scouts", scope: "user", rule: { type: "all_of", rules: [{ type: "venue_complete", venue: "us-capitol" }, { type: "venue_complete", venue: "national-archives" }, { type: "count_complete", venues: ["library-of-congress", "fords-theatre", "national-cathedral", "georgetown"], count: 1 }, { type: "count_complete", venues: ["lincoln-memorial", "washington-monument"], count: 1 }] } },
    { id: "four-score-and-seven", name: "Four Score and Seven", description: "Read the speech where it's carved.", badge: "Citizenship in the Nation 6", only: "sam", track: "scouts", scope: "user", rule: { type: "venue_complete", venue: "lincoln-memorial" } },
    { id: "separation-of-powers", name: "Separation of Powers", description: "The Capitol and the White House, two branches on foot.", badge: "Citizenship in the Nation 3", only: "sam", track: "scouts", scope: "user", rule: { type: "venues_complete", venues: ["us-capitol", "white-house"] } },
    { id: "five-hundred-miles", name: "Five Hundred Miles", description: "Plan the rail trip from a timetable, then ride it. About 730, actually.", badge: "Railroading 2a and 7b(4)", only: "sam", track: "scouts", scope: "user", rule: { type: "trip_complete" } },
    { id: "america-on-the-move", name: "America on the Move", description: "The 1401 locomotive and the flag the anthem is about, one building.", badge: "Railroading 7b(1), American Heritage 3b", only: "sam", track: "scouts", scope: "user", rule: { type: "venue_complete", venue: "american-history" } },
    { id: "four-d", name: "Four-D", description: "Visit an aviation museum and report what you learned.", badge: "Aviation 4d", only: "sam", track: "scouts", scope: "user", rule: { type: "venue_complete", venue: "air-space" } },
    { id: "gallery-pass", name: "Gallery Pass", description: "Visit an art museum, with the counselor's approval first.", badge: "Art 6", only: "sam", track: "scouts", scope: "user", rule: { type: "venue_complete", venue: "national-gallery" } },
    { id: "march-on-washington", name: "March on Washington", description: "Stand where an event changed how the country saw a group of people.", badge: "Citizenship in Society 8", only: "sam", track: "scouts", scope: "user", rule: { type: "count_complete", venues: ["mlk-memorial", "african-american-history", "lincoln-memorial"], count: 1 } },
    { id: "eight-to-twelve", name: "Eight to Twelve", description: "Eight family photos on the record, the visual story's raw material.", badge: "Photography 7c", only: "sam", track: "scouts", scope: "user", rule: { type: "photos", count: 8 } },
  ];

  // The photo hunt: the family's own shots replace the promotional ones as /img/done-<file>.
  // The Worker counts which of these exist; that count is the "photos" fact.
  const HUNT = ["day-1128-anniston-station.webp", "day-1129-union-station.webp", "day-1130-air-space.webp", "day-1201-loc-great-hall.webp", "day-1202-lincoln-night.webp", "day-1203-natural-history.webp", "day-1204-arlington-guard.webp", "day-1205-national-christmas-tree.webp", "day-1206-american-history.webp", "day-1207-home.webp", "train-crescent.webp", "train-roomette.webp", "hero-capitol-night.webp", "family.webp"];

  /*
   * facts: {
   *   travelerId, isAdmin, completed: { venue: date }, bundles: { id: { core: [] } },
   *   decisions: [{ type, traveler_id, payload }], preferences: { travelerId: { venue: choice } },
   *   phase: "plan"|"before"|"live"|"after", hadHiHi: bool, unlockedByTraveler: { travelerId: [ids] },
   *   photos: number of family photos on the record,
   *   bracket: { ballots: { travelerId: { champion } } (completed ballots only), familyRank: [unit ids], seeds: { unitId: seed } }
   * }
   * Definitions with `only` evaluate for that traveler alone. Definitions with a
   * `track` never count toward the standings or toward "everyone has N".
   */
  function evaluate(facts) {
    const done = (v) => !!facts.completed[v];
    const mine = (d) => d.traveler_id === facts.travelerId;
    const decisionMatches = (d, want) => {
      const wants = Array.isArray(want) ? want : [want];
      return wants.some((w) => w === d.type || (w.startsWith("prefer:") && d.type === "prefer" && d.payload && d.payload.choice === w.slice(7)));
    };
    const counted = (ids) => (ids || []).filter((id) => !(byId[id] || {}).track).length;
    const check = (r) => {
      let ok = false;
      switch (r.type) {
        case "venue_complete": ok = done(r.venue); break;
        case "venues_complete": ok = r.venues.every(done); break;
        case "bundle_complete": ok = ((facts.bundles[r.bundle] || {}).core || []).every(done); break;
        case "count_complete": ok = r.venues.filter(done).length >= r.count; break;
        case "decision": ok = facts.decisions.some((d) => decisionMatches(d, r.decision) && (r.by === "any" || mine(d))); break;
        case "preferences": ok = Object.keys((facts.preferences || {})[facts.travelerId] || {}).length >= r.count; break;
        case "trip_complete": ok = facts.phase === "after" && (!r.no_hihi || !facts.hadHiHi) && (!r.admin || !!facts.isAdmin); break;
        case "everyone_has": { const u = facts.unlockedByTraveler || {}; const ids = facts.travelerIds || []; ok = ids.length > 0 && ids.every((t) => counted(u[t]) >= r.count); break; }
        case "photos": ok = (facts.photos || 0) >= r.count; break;
        case "bracket": {
          const b = facts.bracket || {}; const ballots = b.ballots || {}; const order = b.familyRank || []; const ids = facts.travelerIds || [];
          const champs = ids.map((t) => ballots[t] && ballots[t].champion);
          if (r.fact === "landslide") ok = ids.length > 0 && champs.every(Boolean) && new Set(champs).size === 1;
          else if (r.fact === "buster") ok = !!(ballots[facts.travelerId] && order.length && ballots[facts.travelerId].champion !== order[0]);
          else if (r.fact === "cinderella") ok = order.slice(0, 8).some((id) => (b.seeds || {})[id] >= 13);
          break;
        }
        case "all_of": ok = r.rules.every(check); break;
        default: ok = false;
      }
      return ok;
    };
    const out = [];
    for (const a of defs) {
      if (a.only && a.only !== facts.travelerId) continue;
      if (check(a.rule)) out.push(a.id);
    }
    return out;
  }

  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
  const api = { defs, evaluate, byId, HUNT };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.DCAchievements = api;
})(typeof window !== "undefined" ? window : globalThis);

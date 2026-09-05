// Behavioral invariants for the scheduler. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../public/planner.js");
const C = require("../public/venues.js");

const D = { start: "2026-11-29", nights: 7 };
const plan = (cfg, state, prev) => P.plan({ ...D, ...cfg }, state || {}, prev || null);
const fullDays = (p) => p.days.filter((d) => d.kind === "full");
const dayIds = (p) => fullDays(p).map((d) => [d.day && d.day.id, d.night && d.night.id]);
const included = (p, id) => p.includedVenues.has(id);
const dep = (p) => { const d = p.days[p.days.length - 1]; return d.day ? d.day.id : null; };
const LOAD = { lo: 0, mid: 1, hi: 2 };
const allTrips = function* () {
  for (let n = 1; n <= 10; n++) for (let d = 26; d <= 31; d++) yield { start: `2026-11-${d}`, nights: n };
  for (let n = 1; n <= 10; n++) for (let d = 1; d <= 9; d++) yield { start: `2026-12-0${d}`, nights: n };
};

test("default dates generate the recommended trip", () => {
  const p = plan();
  assert.equal(p.label, "Recommended");
  assert.equal(p.headline.kept, 13);
  assert.deepEqual(dayIds(p), [
    ["air-space", null], ["capitol-hill", null], ["national-archives", "main-memorial-loop"],
    ["natural-history", null], ["arlington", null], ["holiday-market", "christmas-washington"],
  ]);
  assert.equal(dep(p), "american-history");
  assert.equal(P.fmtDMD(p.trainOut), "Sat Nov 28");
  assert.equal(P.fmtDMD(p.home), "Mon Dec 7");
});

test("the ladder emerges from the rules", () => {
  const rungs = { 6: ["Compressed full trip", 13], 5: ["First real cut", 12], 4: ["Highlights version", 11], 3: ["Minimum recommended", 10], 2: ["A different kind of trip", null] };
  for (const [n, [label, kept]] of Object.entries(rungs)) {
    const p = plan({ nights: +n });
    assert.equal(p.label, label, `${n} nights`);
    if (kept) assert.equal(p.headline.kept, kept, `${n} nights kept`);
  }
  assert.equal(plan({ nights: 5 }).excluded.map((e) => e.unit.id).filter((id) => ["american-history", "natural-history", "arlington"].includes(id)).join(), "american-history");
  assert.equal(dep(plan({ nights: 5 })), "natural-history");
  assert.equal(dep(plan({ nights: 4 })), "air-space");
  assert.ok(included(plan({ nights: 4 }), "arlington"), "4 nights keeps Arlington");
  assert.equal(plan({ nights: 8 }).label, "Extended");
});

test("no HI/HI day, ever", () => {
  for (const cfg of allTrips()) for (const state of [{}, { punted: ["national-archives"] }, { pinned: ["national-gallery", "spy-museum"] }]) {
    const p = plan(cfg, state);
    for (const d of p.days) if (d.day && d.night) {
      assert.ok(!(p.units[d.day.id].load === "hi" && p.units[d.night.id].load === "hi"), `${cfg.start} ${cfg.nights} ${JSON.stringify(state)} ${P.fmtDMD(d.date)}`);
    }
  }
});

test("only headline experiences may squeeze a day; the bench never creates an avoid pair", () => {
  for (const cfg of allTrips()) {
    const p = plan(cfg);
    for (const d of p.days) if (d.day && d.night) {
      const a = p.units[d.day.id], b = p.units[d.night.id];
      const avoid = LOAD[a.load] + LOAD[b.load] === 3;
      if (avoid) assert.ok(a.core && b.core, `${cfg.start} ${cfg.nights}: ${a.name} + ${b.name}`);
    }
  }
});

test("Capitol and Library stay bundled; the memorial loop stays bundled", () => {
  for (const cfg of allTrips()) {
    const p = plan(cfg);
    assert.equal(included(p, "us-capitol"), included(p, "library-of-congress"), `${cfg.start} ${cfg.nights}`);
    const mem = ["lincoln-memorial", "vietnam-memorial", "wwii-memorial", "korean-memorial"].map((id) => included(p, id));
    assert.ok(mem.every(Boolean) || !mem.some(Boolean), `${cfg.start} ${cfg.nights} memorials split`);
  }
});

test("Capitol Hill never lands on a Sunday or a federal holiday", () => {
  for (const cfg of allTrips()) {
    const p = plan(cfg);
    const d = p.days.find((x) => x.day && x.day.id === "capitol-hill");
    if (d) { assert.notEqual(d.date.getDay(), 0, `${cfg.start} ${cfg.nights}`); assert.equal(P.holiday(d.date), null); }
  }
});

test("the memorial loop rides on the Archives day when both are in", () => {
  for (const cfg of allTrips()) {
    const p = plan(cfg);
    const mem = p.days.find((x) => x.night && x.night.id === "main-memorial-loop");
    const arch = p.days.find((x) => x.day && x.day.id === "national-archives");
    if (mem && arch && arch.kind === "full") assert.equal(mem, arch, `${cfg.start} ${cfg.nights}`);
  }
});

test("punted venues never appear", () => {
  const p = plan({}, { punted: ["natural-history", "arlington"] });
  assert.ok(!included(p, "natural-history") && !included(p, "arlington"));
  assert.notEqual(p.label, "Recommended");
});

test("punting the civic core is honestly a different trip", () => {
  assert.equal(plan({}, { punted: ["us-capitol", "library-of-congress", "national-archives"] }).label, "A different kind of trip");
});

test("pinned venues survive ordinary cuts and displace the bench, not the core", () => {
  const p = plan({ nights: 4 }, { pinned: ["natural-history"] });
  assert.ok(included(p, "natural-history"));
  assert.ok(included(p, "us-capitol") && included(p, "national-archives") && included(p, "lincoln-memorial"));
  const q = plan({}, { pinned: ["national-gallery"] });
  assert.ok(included(q, "national-gallery"));
  assert.ok(q.reasons.some((r) => /National Gallery.*must-do/.test(r)));
});

test("departure day never hosts Arlington or a full outdoor day", () => {
  for (const cfg of allTrips()) for (const state of [{}, { pinned: ["arlington", "georgetown"] }]) {
    const p = plan(cfg, state);
    const id = dep(p);
    if (!id) continue;
    const u = p.units[id];
    assert.notEqual(id, "arlington", `${cfg.start} ${cfg.nights}`);
    assert.ok(u.load === "lo" || u.environment !== "outdoor", `${cfg.start} ${cfg.nights}: ${u.name}`);
  }
});

test("a punt changes one day, not the week (a headline moving up to a full day is allowed)", () => {
  const before = plan();
  const after = plan({}, { punted: ["natural-history"] }, before);
  const d = P.diff(before, after, ["natural-history"]);
  assert.deepEqual(d.moved.filter((n) => !d.promoted.includes(n)), [], `moved: ${d.moved.join(", ")}`);
  assert.deepEqual(d.promoted, ["National Museum of American History"]);
});

test("impossible dates produce an honest warning, not a quiet cut", () => {
  const p = plan({ start: "2026-11-25", nights: 2 }); // Thanksgiving (Nov 26) is the only full day
  assert.ok(p.excluded.some((e) => e.kind === "closed"));
  assert.notEqual(p.label, "Recommended");
});

test("adding a venue cannot violate capacity", () => {
  const p = plan({ nights: 3 }, { pinned: ["national-gallery", "spy-museum", "african-american-history"] });
  for (const d of p.days) if (d.day && d.night) assert.ok(LOAD[p.units[d.day.id].load] + LOAD[p.units[d.night.id].load] < 4);
  // Pins outrank trip identity, so the core loses and the label says so.
  assert.equal(p.label, "A different kind of trip");
  const q = plan({ nights: 2 }, { pinned: ["national-gallery", "spy-museum", "african-american-history", "georgetown"] });
  assert.ok(q.excluded.some((e) => e.unit.pinned), "something pinned had to be reported as not fitting");
});

test("work window: the train can't leave before Bart's shift, and must get home before the next one", () => {
  assert.equal(P.summarize(plan()).work, "");
  assert.equal(P.summarize(plan({ start: "2026-11-27" })).label, "Runs into work");
  assert.equal(P.summarize(plan({ start: "2026-12-05" })).label, "Runs into work");
  assert.match(P.summarize(plan({ start: "2026-12-02" })).work, /Cuts it close/);
});

/* ───── Customization semantics ───── */

test("Add to trip is not Must-do: a request never displaces a headline experience", () => {
  const p = plan({}, { requested: ["national-gallery"] });
  assert.ok(!included(p, "national-gallery"));
  assert.equal(p.headline.kept, 13);
  assert.ok(p.reasons.some((r) => /National Gallery.*doesn't fit/.test(r)));
  const q = plan({}, { pinned: ["national-gallery"] });
  assert.ok(included(q, "national-gallery"));
});

test("a request that doesn't fit gets honest options, including the explicit trade and a longer trip", () => {
  const opts = P.fitOptions(D, { requested: ["national-gallery"] }, "national-gallery");
  assert.ok(opts.some((o) => o.kind === "replace" && o.unit === "american-history"));
  assert.ok(opts.some((o) => o.kind === "night"));
  for (const o of opts) assert.ok(o.plan.includedVenues.has("national-gallery"));
});

test("a punt may leave a slot empty; the bench is suggested, not imposed", () => {
  const before = plan();
  const p = plan({}, { punted: ["natural-history"] }, before);
  const dep = p.days[p.days.length - 1];
  assert.equal(dep.day, null, "the last morning stays open after the headline museum moves up");
  assert.ok(dep.suggest.day.length > 0);
  assert.ok(!p.days.some((d) => d.day && ["african-american-history", "national-gallery", "washington-monument"].includes(d.day.id)));
});

test("the planner owns the core trip; the family owns the extras: 8 nights leaves a day open with suggestions", () => {
  const p = plan({ nights: 8 });
  assert.equal(p.headline.kept, 13);
  const open = p.days.filter((d) => d.kind !== "arrival" && !d.day && !d.night);
  assert.ok(open.length >= 1);
  assert.ok(open.every((d) => d.suggest.day && d.suggest.day.length));
  assert.ok(!Object.values(p.units).some((u) => !u.core && !u.isAccessory && p.placements[u.id]));
});

test("a forced HI/MID pairing is flagged in the preview, not silently accepted", () => {
  const before = plan({ nights: 5 });
  const after = plan({ nights: 5 }, { pinned: ["spy-museum"] }, before);
  const d = P.diff(before, after, ["spy-museum"]);
  assert.ok(d.consequential);
  assert.ok(d.messages.length);
});

test("an action that destroys trip identity requires an explicit choice", () => {
  const before = plan({ nights: 3 });
  const after = plan({ nights: 3 }, { pinned: ["national-gallery", "spy-museum", "african-american-history"] }, before);
  const d = P.diff(before, after, ["national-gallery", "spy-museum", "african-american-history"]);
  assert.ok(d.identityChanged);
  assert.ok(d.messages[0].startsWith("This changes the kind of trip"));
});

test("replanning moves nothing unrelated when a stable solution exists", () => {
  const before = plan();
  for (const state of [{ punted: ["arlington"] }, { requested: ["fords-theatre"] }, { punted: ["natural-history"] }]) {
    const after = plan({}, state, before);
    const acted = [...(state.punted || []), ...(state.requested || [])];
    const d = P.diff(before, after, acted);
    const unrelated = d.moved.filter((n) => !d.promoted.includes(n) && !d.shortened.includes(n));
    assert.deepEqual(unrelated, [], JSON.stringify(state));
  }
});

test("a requested attraction is sacrificed before a pinned one", () => {
  const p = plan({ nights: 4 }, { requested: ["national-gallery"], pinned: ["spy-museum"] });
  assert.ok(included(p, "spy-museum"));
  assert.ok(!included(p, "national-gallery"));
});

test("standing venue rules and trip-specific closures are separate inputs", () => {
  assert.ok(C.venues.every((v) => !("closures" in v)));
  const p = P.plan(D, {}, null, { closures: [{ venue: "air-space", date: "2026-11-30", note: "private event" }] });
  const mon = p.days.find((d) => P.iso(d.date) === "2026-11-30");
  assert.notEqual(mon.day && mon.day.id, "air-space");
  assert.ok(included(p, "air-space"), "a one-day closure moves it, not cuts it");
});

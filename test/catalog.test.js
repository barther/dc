// The admission gate. A catalog is not usable until the planner can make humane weeks out
// of it. These rules were discovered by hand while normalizing New York; now they're the
// test every catalog passes before it ships. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../public/planner.js");
const B = require("../public/bracket.js");
const CATALOGS = { dc: require("../public/venues.js"), nyc: require("../public/venues-nyc.js") };
const SLOT_HOURS = { day: 8, night: 4.5 };

for (const [id, C] of Object.entries(CATALOGS)) {
  test(`${id}: structural admission`, () => {
    const E = P.withCatalog(C); // throws if the city block is incomplete: no silent fallback to Washington
    assert.equal(C.city.id, id);
    for (const k of ["train", "edges", "narrative", "station", "hotel", "plate", "title", "lede"]) assert.ok(C.city[k], `city.${k}`);
    assert.ok(C.city.edges.departureHours > 0 && C.city.train.arriveHour > 0);
    const ids = new Set();
    for (const v of C.venues) {
      assert.ok(!ids.has(v.id), `duplicate id ${v.id}`); ids.add(v.id);
      assert.ok(Array.isArray(v.ll) && C.geo.distMi(C.geo.base.ll, v.ll) < 25, `${v.id} is within 25 miles of the hotel`);
      assert.ok(["day", "night"].includes(v.period) && ["lo", "mid", "hi"].includes(v.load), v.id);
      assert.ok(v.min_hours > 0 && v.ideal_hours >= v.min_hours, `${v.id} hours`);
      assert.ok(["none", "recommended", "required"].includes(v.reservation), `${v.id} reservation is never unknown`);
      for (const k of ["rain", "cold", "wind", "heat"]) assert.ok(["poor", "acceptable", "good", "excellent"].includes((v.weather || {})[k]), `${v.id} weather.${k}`);
      const c = v.constraints || {};
      assert.ok(!c.weekdays || (Array.isArray(c.weekdays) && c.weekdays.every((w) => w >= 0 && w <= 6)), `${v.id} weekdays parse`);
      for (const h of c.holidays || []) assert.ok(["christmas", "newyear", "thanksgiving"].includes(h), `${v.id} holiday ${h}`);
      if (c.season) assert.match(c.season.from + c.season.to, /^\d{2}-\d{2}\d{2}-\d{2}$/, `${v.id} season`);
      if (v.bundle) assert.ok(C.bundles[v.bundle], `${v.id} names a real bundle`);
    }
    // Seeds dense and unique.
    const seeds = C.venues.map((v) => v.seed).sort((a, b) => a - b);
    assert.deepEqual(seeds, seeds.map((_, i) => i + 1), "seeds are 1..n");
    // Bundles: one period, at least two core members, hours that fit a slot, accessories in the other period.
    for (const [bid, b] of Object.entries(C.bundles)) {
      assert.ok(b.core.length >= 2, `${bid}: a one-member bundle is a standalone`);
      const members = b.core.map((m) => C.venues.find((v) => v.id === m));
      assert.ok(members.every(Boolean), `${bid} members exist`);
      assert.ok(members.every((m) => m.period === b.period), `${bid}: no mixed periods`);
      assert.ok(members.reduce((h, m) => h + m.ideal_hours, 0) <= SLOT_HOURS[b.period], `${bid} fits a ${b.period}`);
      for (const a of b.accessory || []) { const v = C.venues.find((x) => x.id === a); assert.ok(v && v.period !== b.period, `${bid}: accessory ${a} rides in the other slot`); }
    }
    for (const pr of C.pairings) assert.ok(C.venues.find((v) => v.id === pr.day && v.period === "day") && (C.bundles[pr.night] || C.venues.find((v) => v.id === pr.night && v.period === "night")), "pairings are day+night");
    // Headlines exist; a sixteen-bracket is possible; every contender has copy and a stop list.
    assert.equal(C.headlines.length, 13);
    for (const h of C.headlines) assert.ok(ids.has(h), `headline ${h}`);
    const cs = B.contenders(C);
    assert.ok(cs.length >= 16, `${cs.length} contenders`);
    for (const c of cs) { assert.ok(C.copy[c.id] && C.copy[c.id].body.length, `${c.id} has copy`); assert.ok(c.stops.length && c.hours > 0 && typeof c.miles === "number", `${c.id} describes itself`); }
    assert.ok(E.EDGES === C.city.edges);
  });

  test(`${id}: behavioral admission, the planner can make humane weeks out of it`, () => {
    const E = P.withCatalog(C);
    const start = "2026-11-29";
    const hihi = (p) => p.days.some((d) => d.day && d.night && p.units[d.day.id].load === "hi" && p.units[d.night.id].load === "hi");
    const everPlaced = new Set();
    for (let n = E.MIN_NIGHTS; n <= E.MAX_NIGHTS; n++) {
      const p = E.plan({ start, nights: n });
      assert.ok(p && p.days.length === n + 1, `${n} nights plans`);
      assert.ok(!hihi(p), `${n} nights: no HI/HI`);
      assert.ok(p.headline.kept <= p.headline.total, `${n} nights headline count`);
      for (const id2 of Object.keys(p.placements)) everPlaced.add(id2);
    }
    // Neither too thin to fill a week nor so dense everything gets cut.
    const week = E.plan({ start, nights: 7 });
    assert.ok(week.headline.kept >= 9, `a week keeps ${week.headline.kept} of 13`);
    assert.ok(week.days.filter((d) => d.kind === "full" && (d.day || d.night)).length >= 5, "a week has at least five real days");
    // Every contender is schedulable somewhere: ask for all of them across a long trip at the most
    // permissive pace, so this tests the catalog's structure, not the pacing doctrine.
    const cs = B.contenders(C);
    const all = E.plan({ start, nights: 14 }, { requested: cs.flatMap((c) => c.members) }, null, { familyRank: cs.map((c) => c.id), champions: [], pace: 4 });
    // Running out of days is a scheduling outcome; a venue that is closed, out of season, or otherwise
    // unplaceable every day of a fourteen-night trip is a catalog bug.
    for (const c of cs) {
      if (all.placements[c.id] || everPlaced.has(c.id)) continue;
      const ex = all.excluded.find((e) => e.unit.id === c.id);
      assert.ok(ex && ex.kind === "room", `${c.id}: ${ex ? ex.kind + ", " + ex.why : "missing without a reason"}`);
    }
    // Under a bad forecast the swap is legal or absent.
    const wet = {}; for (const d of week.days) wet[E.iso(d.date)] = { rain: true, cold: true, wind: false, heat: false, summary: "rain" };
    const sw = E.suggestSwap({ start, nights: 7 }, {}, week, { weather: wet });
    if (sw) assert.ok(!hihi(sw.plan), "a weather swap never makes a HI/HI day");
    // The travel-day rule holds: nothing longer than the last morning ever lands on it.
    for (let n = 1; n <= 10; n++) { const p = E.plan({ start, nights: n }); const last = p.days[p.days.length - 1]; if (last.day) assert.ok(p.units[last.day.id].min_hours <= C.city.edges.departureHours, `${n} nights last morning`); }
  });
}

test("a catalog that forgets its city block fails loudly instead of inheriting Washington", () => {
  const dc = CATALOGS.dc;
  assert.throws(() => P.withCatalog({ ...dc, city: undefined }), /missing city/);
  assert.throws(() => P.withCatalog({ ...dc, city: { ...dc.city, edges: undefined } }), /missing edges/);
  assert.throws(() => P.withCatalog({ ...dc, city: { ...dc.city, train: undefined } }), /missing train/);
});

test("validity windows: a seasonal venue is closed outside its season, and the reason says so", () => {
  const p = P.plan({ start: "2026-04-14", nights: 3 });
  const tree = p.excluded.find((e) => e.unit.members.includes("national-christmas-tree"));
  assert.ok(tree && /isn't running/.test(tree.why), tree && tree.why);
  assert.ok(P.inSeason({ from: "12-04", to: "01-01" }, new Date(2026, 11, 20)) && P.inSeason({ from: "12-04", to: "01-01" }, new Date(2027, 0, 1)));
  assert.ok(!P.inSeason({ from: "12-04", to: "01-01" }, new Date(2026, 11, 3)) && !P.inSeason({ from: "11-21", to: "12-23" }, new Date(2026, 3, 17)));
  // The recommended December week is untouched.
  assert.equal(P.plan({ start: "2026-11-29", nights: 7 }).label, "Recommended");
});

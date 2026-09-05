// Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../public/planner.js");

const fulls = (r) => r.days.filter((d) => d.kind === "full").map((d) => d.id);
const dep = (r) => r.days.find((d) => d.kind === "depart").id || null;
const cuts = (r) => r.cuts.map((c) => c.id).sort();

test("7 nights is the recommended trip, exactly as written", () => {
  const r = P.plan({ start: "2026-11-29", nights: 7 });
  assert.deepEqual(fulls(r), ["airspace", "capitolhill", "archivesmem", "naturalhistory", "arlington", "christmas"]);
  assert.equal(dep(r), "americanhistory");
  assert.equal(r.kept.size, 13);
  assert.deepEqual(cuts(r), []);
  assert.equal(P.summarize(r).label, "Recommended");
  assert.equal(P.fmtDMD(r.days[0].date), "Sat Nov 28");
  assert.equal(P.fmtDMD(r.home), "Mon Dec 7");
});

test("6 nights compresses Christmas onto an indoor day, cuts nothing", () => {
  const r = P.plan({ start: "2026-11-29", nights: 6 });
  assert.equal(r.kept.size, 13);
  assert.equal(r.christmasFull, false);
  const host = r.days[2 + r.host];
  assert.ok(P.MODULES[host.id].indoor, "Christmas night rides an indoor day");
  assert.equal(host.night.label, "White House + National Christmas Tree");
  assert.equal(dep(r), "americanhistory");
});

test("5 nights: cut American History, Natural History shortened on departure", () => {
  const r = P.plan({ start: "2026-11-29", nights: 5 });
  assert.equal(r.kept.size, 12);
  assert.deepEqual(cuts(r), ["americanhistory"]);
  assert.equal(dep(r), "naturalhistory");
  assert.ok(fulls(r).includes("arlington"));
});

test("4 nights: highlights version keeps Arlington, Air & Space on the last morning", () => {
  const r = P.plan({ start: "2026-11-29", nights: 4 });
  assert.equal(r.kept.size, 11);
  assert.deepEqual(cuts(r), ["americanhistory", "naturalhistory"]);
  assert.ok(fulls(r).includes("arlington"));
  assert.equal(dep(r), "airspace");
  assert.equal(P.summarize(r).label, "Highlights version");
});

test("3 nights: minimum recommended", () => {
  const r = P.plan({ start: "2026-11-29", nights: 3 });
  assert.equal(r.kept.size, 10);
  assert.deepEqual(cuts(r), ["americanhistory", "arlington", "naturalhistory"]);
  assert.deepEqual(fulls(r), ["capitolhill", "archivesmem"]);
  assert.equal(dep(r), "airspace");
  assert.ok(r.kept.has("christmas"));
  assert.equal(P.summarize(r).label, "Minimum recommended");
});

test("below 3 nights is a different trip, not a mangled one", () => {
  const r = P.plan({ start: "2026-11-29", nights: 2 });
  assert.equal(r.mode, "different");
  assert.equal(P.summarize(r).label, "A different kind of trip");
});

test("8 and 9 nights add open days and keep everything", () => {
  for (const n of [8, 9]) {
    const r = P.plan({ start: "2026-11-29", nights: n });
    assert.equal(r.kept.size, 13);
    assert.equal(fulls(r).filter((id) => id === "open").length, n - 7);
  }
});

test("Capitol Hill never lands on a Sunday", () => {
  for (let d = 1; d <= 31; d++) {
    for (const n of [3, 4, 5, 6, 7]) {
      const r = P.plan({ start: `2026-12-${String(d).padStart(2, "0")}`, nights: n });
      const cap = r.days.find((x) => x.id === "capitolhill");
      if (cap) assert.notEqual(cap.date.getDay(), 0, `start Dec ${d}, ${n} nights`);
    }
  }
});

test("the memorial night never shares a day with Christmas night", () => {
  for (let d = 1; d <= 20; d++) for (const n of [3, 4, 5, 6]) {
    const r = P.plan({ start: `2026-12-${String(d).padStart(2, "0")}`, nights: n });
    const arch = r.days.find((x) => x.id === "archivesmem");
    if (arch) assert.equal(arch.night.label, "WWII → Vietnam → Lincoln → Korea");
  }
});

test("a closure that kills a protected module is reported, not hidden", () => {
  const r = P.plan({ start: "2026-11-24", nights: 3 }); // Thanksgiving inside
  assert.ok(r.cuts.some((c) => c.id === "archivesmem" && /Thanksgiving/.test(c.why)));
  assert.equal(P.summarize(r).label, "These dates don't work");
});

test("work on Thu Dec 10 at 2 PM is a hard wall", () => {
  const ok = P.plan({ start: "2026-11-29", nights: 7 });
  assert.equal(P.workStatus(ok.home), "ok");
  assert.equal(P.summarize(ok).work, "");

  const late = P.plan({ start: "2026-12-05", nights: 7 }); // home Sat Dec 12
  assert.equal(P.workStatus(late.home), "late");
  assert.equal(P.summarize(late).label, "Runs into work");
  assert.match(P.summarize(late).work, /Runs into work/);
  assert.ok(late.days[late.days.length - 1].late);

  const tight = P.plan({ start: "2026-12-02", nights: 7 }); // home Thu Dec 10
  assert.equal(P.workStatus(tight.home), "tight");
  assert.match(P.summarize(tight).work, /Cuts it close/);
  assert.equal(P.summarize(tight).label, "Recommended");

  const thin = P.plan({ start: "2026-11-29", nights: 9 }); // home Wed Dec 9
  assert.equal(P.workStatus(thin.home), "thin");
  assert.match(P.summarize(thin).work, /One day at home/);
});

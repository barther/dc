/*
 * DC Trip Planner — engine + renderer.
 *
 * The page opens as the recommended seven-night trip. "Change the trip"
 * lets the family move the start date or the number of nights, and the
 * itinerary re-plans immediately, preserving the trip's identity and pacing
 * before it worries about attraction count. See PLANNER.md for the doctrine.
 *
 * The engine (plan) is pure and also runs under node for tests.
 */
(function (root) {
  "use strict";

  /* ───────────── Dates ───────────── */

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const fmtMD = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  const fmtDMD = (d) => `${DOW[d.getDay()]} ${fmtMD(d)}`;
  const fmtDMDY = (d) => `${fmtDMD(d)}, ${d.getFullYear()}`;

  // Closures that matter for these modules.
  function holiday(d) {
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === 12 && day === 25) return "Christmas Day";
    if (m === 1 && day === 1) return "New Year's Day";
    if (m === 11 && d.getDay() === 4 && day >= 22 && day <= 28) return "Thanksgiving";
    return null;
  }

  /* ───────────── Modules ───────────── */

  const REST = { label: "Dinner, nothing scheduled", legs: 1, exp: 0 };

  // Headline experiences (the 13 on "The list"), keyed to match data-h in the HTML.
  const HEADLINES = [
    "capitol", "loc", "airspace", "naturalhistory", "americanhistory", "archives",
    "whitehouse", "lincoln", "vietnam", "korea", "wwii", "arlington", "christmas",
  ];
  const HEADLINE_NAMES = {
    capitol: "U.S. Capitol", loc: "Library of Congress", airspace: "Air and Space Museum",
    naturalhistory: "Natural History Museum", americanhistory: "American History Museum",
    archives: "Declaration, Constitution & Bill of Rights", whitehouse: "The White House",
    lincoln: "Lincoln Memorial", vietnam: "Vietnam Veterans Memorial", korea: "Korean War Veterans Memorial",
    wwii: "World War II Memorial", arlington: "Arlington National Cemetery", christmas: "Christmas in Washington",
  };

  const MODULES = {
    airspace: {
      id: "airspace", name: "Air & Space", rank: 0, headlines: ["airspace"],
      day: { label: "Air & Space Museum", legs: 4, exp: 0 }, night: { label: "Dinner, feet up", legs: 1, exp: 0 },
      indoor: true, closed: (d) => holiday(d) === "Christmas Day" ? "closed Christmas Day" : null,
      title: "Air & Space.",
      body: ["A whole day for the National Air and Space Museum. Real spacecraft. Real rockets. The planes that changed everything, hanging right over your head. We go at our own pace and leave when we're full."],
      photo: ["day-1130-air-space.webp", "National Air and Space Museum"],
      short: {
        title: "Air & Space, shortened, then home.",
        body: ["Check out, leave the bags with the hotel, and give the morning to Air and Space: the Wright Flyer, the Spirit of St. Louis, an Apollo capsule, and whatever else pulls hardest. A couple of hours, not the full day it gets in the seven-night trip. Lunch, luggage, Union Station, and the 6:30 Crescent south."],
        label: "Air & Space, a couple of hours", legs: 3,
      },
    },
    capitolhill: {
      id: "capitolhill", name: "Capitol Hill", rank: 1, headlines: ["capitol", "loc"], protected: true,
      day: { label: "Capitol + Library of Congress", legs: 4, exp: 1 }, night: REST,
      indoor: false,
      closed: (d) => d.getDay() === 0 ? "the Capitol and the Library are closed Sundays" : holiday(d) ? `closed on ${holiday(d)}` : null,
      title: "Capitol Hill.",
      body: ["Morning tour inside the U.S. Capitol, under the dome. Lunch. Then across the street to the Library of Congress, where the Great Hall of the Jefferson Building is the single most beautiful room in the country. Argue with us after you've seen it."],
      photo: ["day-1201-loc-great-hall.webp", "The Great Hall, Library of Congress"],
    },
    archivesmem: {
      id: "archivesmem", name: "Archives + memorial night", rank: 2, headlines: ["archives", "lincoln", "vietnam", "korea", "wwii"], protected: true,
      day: { label: "National Archives", legs: 2, exp: 0 }, night: { label: "WWII → Vietnam → Lincoln → Korea", legs: 4, exp: 4 },
      indoor: false, closed: (d) => holiday(d) ? `the Archives are closed on ${holiday(d)}` : null,
      featured: true, hostsNight: false,
      title: "The founding documents, then the big memorial night.",
      body: [
        "A short daytime visit to the National Archives to stand in front of the Declaration of Independence, the Constitution, and the Bill of Rights. The real ones. Then back to the hotel to warm up and rest, because tonight is the one we'll talk about for years.",
        "Reach the Vietnam Wall at dusk while the names are still easy to read. Then let it get dark: World War II Memorial, up the steps to Lincoln, and finally the Korean War Memorial, where the statues come alive under the lights. Bundle up. Hot chocolate after.",
      ],
      photo: ["day-1202-lincoln-night.webp", "Lincoln Memorial after dark"],
    },
    naturalhistory: {
      id: "naturalhistory", name: "Natural History", rank: 3, headlines: ["naturalhistory"],
      day: { label: "Natural History Museum", legs: 4, exp: 0 }, night: REST,
      indoor: true, closed: (d) => holiday(d) === "Christmas Day" ? "closed Christmas Day" : null,
      title: "Natural History.",
      body: ["Dinosaurs. The Hope Diamond. The elephant in the rotunda. The ocean hall, the mammals, the giant squid. Sam, this is your day. We stay until everyone has seen the thing they came for."],
      photo: ["day-1203-natural-history.webp", "National Museum of Natural History"],
      short: {
        title: "Natural History, shortened, then home.",
        body: ["Check out, leave the bags with the hotel, and give the morning to Natural History: the elephant, the dinosaurs, the Hope Diamond, and not much else. This is the greatest-hits version, not the full day it gets in the seven-night trip. Lunch, luggage, Union Station, and the 6:30 Crescent south."],
        label: "Natural History, the greatest hits", legs: 3,
      },
    },
    open: {
      id: "open", name: "Open day", rank: 4.5, headlines: [],
      day: { label: "Nothing scheduled, on purpose", legs: 1, exp: 0 }, night: REST,
      indoor: true, closed: () => null,
      title: "Open day.",
      body: ["Nothing scheduled, on purpose. If the sun's out, the Tidal Basin loop: Jefferson, MLK, FDR. If it isn't, the National Gallery. If everyone's cooked, the hotel and a long lunch. Whitespace is part of the itinerary."],
      photo: null,
    },
    arlington: {
      id: "arlington", name: "Arlington", rank: 4, headlines: ["arlington"], inflexible: true,
      day: { label: "Arlington National Cemetery", legs: 4, exp: 3 }, night: REST,
      indoor: false, closed: () => null,
      title: "Arlington.",
      body: ["One Metro ride across the river to Arlington National Cemetery. The Tomb of the Unknown Soldier and the Changing of the Guard, which we build the whole day around. President Kennedy's gravesite and the eternal flame. Arlington House on the hill, looking back over the whole city. Quiet, cold, and unforgettable."],
      photo: ["day-1204-arlington-guard.webp", "Changing of the Guard, Tomb of the Unknown Soldier"],
    },
    christmas: {
      id: "christmas", name: "Christmas Washington", rank: 5, headlines: ["whitehouse", "christmas"], protected: true,
      day: { label: "Holiday market + downtown", legs: 2, exp: 1 }, night: { label: "White House + National Christmas Tree", legs: 3, exp: 3 },
      indoor: false, closed: () => null, featured: true, preferDow: 6,
      title: "Christmas Washington.",
      body: [
        "Sleep in. Wander the holiday market and the downtown decorations, poke around the shops, get lunch and something warm to drink, and possibly the Washington Monument if tickets and weather cooperate. Then back to the hotel for an afternoon reset.",
        "After dark: the White House, the Ellipse, and the National Christmas Tree if this year's lighting has happened by then, with the state and territory trees around it. This night isn't for learning anything. It's for lights, cocoa, and seasonal nonsense.",
      ],
      photo: ["day-1205-national-christmas-tree.webp", "The National Christmas Tree on the Ellipse"],
      // When compressed, the night rides on another day and this paragraph is appended there.
      compressed: "Then, after dark, Christmas Washington: the White House, the Ellipse, and the National Christmas Tree if this year's lighting has happened by then. Call the afternoon early, reset at the hotel, bundle up. The holiday market becomes a quick stop on the way rather than its own day. Lights, cocoa, seasonal nonsense.",
    },
    americanhistory: {
      id: "americanhistory", name: "American History", rank: 6, headlines: ["americanhistory"],
      day: { label: "American History Museum", legs: 3, exp: 0 }, night: REST,
      indoor: true, closed: (d) => holiday(d) === "Christmas Day" ? "closed Christmas Day" : null,
      departureOnly: true,
      photo: ["day-1206-american-history.webp", "National Museum of American History"],
      short: {
        title: "American History, then home.",
        body: ["Check out, leave the bags with the hotel, and spend the morning at the National Museum of American History. The Star-Spangled Banner, the actual flag from the actual song, plus the presidents, the trains, the inventions, and whatever else pulls us in. Lunch, grab the luggage, Union Station, and the 6:30 Crescent south."],
        label: "American History Museum", legs: 3,
      },
    },
  };

  // Which museum gets the departure morning, best first, when it couldn't get its own day.
  const MUSEUM_PRIORITY = ["airspace", "naturalhistory", "americanhistory"];
  // Full-day modules that bend before others. Order = who keeps a full day first.
  const FLEXIBLE = ["arlington", "airspace", "naturalhistory"];
  const PROTECTED_FULL = ["capitolhill", "archivesmem"];

  const DEFAULT = { start: "2026-11-29", nights: 7 };
  // Crescent facts. Train 20 reaches Washington early afternoon on the weekend schedule;
  // on weekdays it's earlier, so we point at the timetable rather than guess.
  const TRAIN = { boardLabel: "evening", arriveWeekend: "~2:12 PM", arriveWeekday: "afternoon, per the timetable", departLabel: "6:30 PM", homeLabel: "~10:30 AM CT" };
  // Bart works until 2 PM Saturday Nov 28, 2026 (evening boarding is fine) and is back at work
  // Thursday Dec 10, 2026 at 2 PM. The Crescent gets into Anniston ~10:30 AM.
  const WORK = { date: "2026-12-10", label: "Thu Dec 10, 2 PM", off: "2026-11-28", offLabel: "Sat Nov 28, 2 PM" };

  // Days the outbound train day sits before Bart's last shift ends (0 = boards that evening).
  function workEarly(trainOut) {
    return Math.round((parseISO(WORK.off) - trainOut) / 86400000);
  }

  // Days at home between getting off the train and going back to work.
  function workBuffer(home) {
    const w = parseISO(WORK.date);
    return Math.round((w - home) / 86400000);
  }
  function workStatus(home) {
    const b = workBuffer(home);
    return b >= 2 ? "ok" : b === 1 ? "thin" : b === 0 ? "tight" : "late";
  }
  const MIN_NIGHTS = 1, MAX_NIGHTS = 9;

  /* ───────────── Scheduler ───────────── */

  function permutations(arr) {
    const out = [];
    (function rec(a, m) {
      if (!a.length) { out.push(m); return; }
      const seen = new Set();
      for (let i = 0; i < a.length; i++) {
        if (seen.has(a[i])) continue; // identical open days
        seen.add(a[i]);
        rec(a.slice(0, i).concat(a.slice(i + 1)), m.concat(a[i]));
      }
    })(arr, []);
    return out;
  }

  function dayScore(day, night) {
    let s = 0;
    if (day.legs + night.legs > 6) s -= 4;
    if (day.exp + night.exp > 4) s -= 4;
    return s;
  }

  function scoreOrder(order, dates) {
    let s = 0;
    for (let i = 0; i < order.length; i++) {
      const m = MODULES[order[i]], d = dates[i];
      if (m.closed(d)) s -= 1000;
      s += dayScore(m.day, m.night);
      if (m.preferDow != null && d.getDay() === m.preferDow) s += 3;
      for (let j = i + 1; j < order.length; j++) if (MODULES[order[j]].rank < m.rank) s -= 1; // inversions vs canonical
    }
    return s;
  }

  function plan(cfg) {
    const start = parseISO(cfg.start) || parseISO(DEFAULT.start);
    const N = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, cfg.nights | 0 || DEFAULT.nights));
    const trainOut = addDays(start, -1), depart = addDays(start, N), home = addDays(start, N + 1);
    const fullDates = [];
    for (let i = 1; i < N; i++) fullDates.push(addDays(start, i));

    const r = { start, nights: N, trainOut, depart, home, days: [], cuts: [], notes: [], kept: new Set(), mode: "full" };

    if (N < 3) { r.mode = "different"; r.days = frame(r, [], null, null); return r; }

    // 1. Who gets a full day. Protected first, Christmas only if everyone else still fits,
    //    then the least flexible (Arlington can't be shortened), then by priority.
    let placed = PROTECTED_FULL.slice();
    let slots = fullDates.length - placed.length;
    let christmasFull = false;
    if (slots >= FLEXIBLE.length + 1) { placed.push("christmas"); christmasFull = true; slots--; }
    for (const id of FLEXIBLE) if (slots > 0) { placed.push(id); slots--; }
    while (slots-- > 0) placed.push("open");

    // 2. The departure morning hosts the best indoor museum that lost its full day.
    let depMuseum = MUSEUM_PRIORITY.find((id) => !placed.includes(id)) || null;

    // 3. Assign dates: search orderings, best score wins, canonical order breaks ties.
    let assign = null;
    for (let attempt = 0; attempt < 3 && !assign; attempt++) {
      const orders = permutations(placed.slice().sort((a, b) => MODULES[a].rank - MODULES[b].rank));
      let best = null, bestScore = -Infinity;
      for (const o of orders) { const sc = scoreOrder(o, fullDates); if (sc > bestScore) { bestScore = sc; best = o; } }
      const bad = best.map((id, i) => [id, MODULES[id].closed(fullDates[i])]).filter((x) => x[1]);
      if (!bad.length) { assign = best; break; }
      for (const [id, why] of bad) {
        placed.splice(placed.indexOf(id), 1);
        placed.push("open");
        r.cuts.push({ id, why: `${MODULES[id].name} can't fit these dates: ${why}.` });
        if (id === "christmas") christmasFull = false;
      }
    }
    if (!assign) assign = placed;

    if (depMuseum && MODULES[depMuseum].closed(depart)) {
      r.notes.push(`${MODULES[depMuseum].name} is ${MODULES[depMuseum].closed(depart)}, so the last morning stays light.`);
      depMuseum = null;
    }

    // 4. Christmas night, compressed: pick the host day.
    let host = null;
    if (!christmasFull && !r.cuts.some((c) => c.id === "christmas")) {
      let bestS = -Infinity;
      assign.forEach((id, i) => {
        const m = MODULES[id];
        if (m.hostsNight === false) return;
        const d = fullDates[i];
        let s = dayScore(m.day, MODULES.christmas.night) + (d.getDay() === 6 ? 3 : 0) + (m.indoor ? 2 : 0) + i * 0.3;
        if (id === "open") s += 4;
        if (s > bestS) { bestS = s; host = i; }
      });
      if (host == null) r.cuts.push({ id: "christmas", why: "There's no evening left for Christmas Washington on these dates." });
    }

    // 5. Book-keeping: what survived.
    for (const id of assign) MODULES[id].headlines.forEach((h) => r.kept.add(h));
    if (depMuseum) MODULES[depMuseum].headlines.forEach((h) => r.kept.add(h));
    if (christmasFull || host != null) MODULES.christmas.headlines.forEach((h) => r.kept.add(h));
    for (const id of ["americanhistory", "naturalhistory", "airspace", "arlington"]) {
      if (!assign.includes(id) && id !== depMuseum && !r.cuts.some((c) => c.id === id)) {
        r.cuts.push({ id, why: null });
      }
    }
    r.christmasFull = christmasFull;
    r.host = host;
    r.depMuseum = depMuseum;
    r.days = frame(r, assign.map((id, i) => ({ id, date: fullDates[i], hostsChristmas: host === i })), depMuseum);
    return r;
  }

  // Build the full day list: train out, arrival, full days, departure, home.
  function frame(r, fulls, depMuseum) {
    const days = [];
    const early = workEarly(r.trainOut);
    days.push({
      kind: "train", date: r.trainOut, late: early > 0,
      title: early > 0 ? "All aboard. Except Bart's at work." : "All aboard.",
      body: [early > 0
        ? `Bart works until ${WORK.offLabel}, so this train leaves ${early === 1 ? "a day" : `${early} days`} before he can. Push the arrival date later.`
        : early === 0
        ? "Bart clocks out at 2:00, we load up, drive to Anniston, eat, and climb onto the Crescent. Nothing to accomplish tonight except finding the bunks and watching Alabama slide by in the dark."
        : "Load up, drive to Anniston, eat, and climb onto the Crescent. Nothing to accomplish tonight except finding the bunks and watching Alabama slide by in the dark."],
      day: { label: "Pack and drive", legs: 1, exp: 0 }, night: { label: "The train is the activity", legs: 1, exp: 0 },
      photo: ["day-1128-anniston-station.webp", "Anniston station at boarding time"],
    });
    if (r.mode === "different") return days;
    days.push({
      kind: "arrive", date: r.start, title: "Hello, Washington.",
      body: ["Roll into Union Station, check into the hotel, unpack, eat. Then, after dark, our first real look at the city: the U.S. Capitol dome lit up against the night sky. No tour. No agenda. Just stand there and take it in."],
      day: { label: "Arrive, hotel, food", legs: 1, exp: 0 }, night: { label: "The Capitol, illuminated", legs: 3, exp: 2 },
      photo: ["day-1129-union-station.webp", "The main hall at Union Station"],
    });
    for (const f of fulls) {
      const m = MODULES[f.id];
      const d = { kind: "full", id: f.id, date: f.date, title: m.title, body: m.body.slice(), day: m.day, night: m.night, photo: m.photo, featured: !!m.featured };
      if (f.hostsChristmas) {
        d.title = m.title.replace(/\.$/, "") + ", then Christmas Washington.";
        d.body.push(MODULES.christmas.compressed);
        d.night = MODULES.christmas.night;
        d.featured = true;
        d.photo = m.photo || MODULES.christmas.photo;
      }
      days.push(d);
    }
    if (depMuseum) {
      const m = MODULES[depMuseum];
      days.push({
        kind: "depart", id: depMuseum, date: r.depart, title: m.short.title, body: m.short.body,
        day: { label: m.short.label, legs: m.short.legs, exp: 0 }, night: { label: "Southbound sleeper", legs: 1, exp: 0 }, photo: m.photo,
      });
    } else {
      days.push({
        kind: "depart", date: r.depart, title: "Last morning, then home.",
        body: ["Check out, leave the bags with the hotel, a slow breakfast, and one last walk on the Mall. Lunch, luggage, Union Station, and the 6:30 Crescent south. Nothing big on purpose."],
        day: { label: "A slow last morning", legs: 1, exp: 1 }, night: { label: "Southbound sleeper", legs: 1, exp: 0 }, photo: null,
      });
    }
    const buf = workBuffer(r.home), ws = workStatus(r.home);
    const homeBody = ws === "ok"
      ? [`Get the car, go home, and do absolutely nothing. ${buf === 2 ? "Two full days" : `${buf} days`} at home before Bart is back at work ${WORK.label}. That's part of the plan, not wasted vacation.`]
      : ws === "thin"
      ? [`Get the car, go home, and do absolutely nothing. One day at home before Bart is back at work ${WORK.label}. Tighter than the recommended trip, but it works.`]
      : ws === "tight"
      ? [`Get the car and go straight home, because Bart is due at work at 2 PM the same day. The Crescent gets in around 10:30 if it's on time. It is not always on time.`]
      : [`This version gets home ${-buf === 1 ? "a day" : `${-buf} days`} after Bart was due back at work (${WORK.label}). Start earlier or take a night off the end.`];
    days.push({
      kind: "home", date: r.home, title: ws === "late" ? "Anniston, ~10:30 AM. Late for work." : ws === "tight" ? "Anniston, ~10:30 AM. Work at 2." : "Anniston, ~10:30 AM.",
      body: homeBody, late: ws === "late" || ws === "tight",
      photo: ["day-1207-home.webp", "Home."],
    });
    return days;
  }

  /* ───────────── Summary copy ───────────── */

  function cutNames(r) {
    return r.cuts.map((c) => c.id === "christmas" ? "Christmas Washington" : MODULES[c.id].name);
  }
  function list(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + (names.length > 2 ? "," : "") + " and " + names[names.length - 1];
  }

  function summarize(r) {
    const N = r.nights, kept = r.kept.size, total = HEADLINES.length;
    const cuts = cutNames(r);
    const s = { nights: N, label: "", count: `${kept} of ${total} headline experiences`, cuts: cuts.length ? `Cut: ${list(cuts)}.` : "", why: "", work: "" };
    const ws = workStatus(r.home), buf = workBuffer(r.home), early = workEarly(r.trainOut);
    if (early > 0) s.work = `Runs into work. This boards ${fmtDMD(r.trainOut)}, and Bart works until ${WORK.offLabel}. Arrive ${early === 1 ? "a day" : `${early} days`} later.`;
    else if (ws === "late") s.work = `Runs into work. Home ${fmtDMD(r.home)}, and Bart is due back ${WORK.label}. Start earlier or take a night off the end.`;
    else if (ws === "tight") s.work = `Cuts it close. Home ${fmtDMD(r.home)} around 10:30 AM, work at 2 PM the same day, and the Crescent isn't always on time.`;
    else if (ws === "thin") s.work = `One day at home before work ${WORK.label}.`;
    if (r.mode === "different") {
      s.label = ws === "late" || early > 0 ? "Runs into work" : "A different kind of trip";
      s.count = "";
      s.why = `${N === 1 ? "One night" : "Two nights"} isn't a shorter version of this trip. It's a different trip, and it deserves its own plan rather than a mangled version of this one.`;
      return s;
    }
    const hostName = r.host != null ? MODULES[r.days[2 + r.host].id].name : null;
    if (ws === "late" || early > 0) s.label = "Runs into work";
    const forced = r.cuts.filter((c) => c.why && (c.id === "christmas" || MODULES[c.id].protected));
    if (forced.length) {
      s.label = "These dates don't work";
      s.why = forced.map((c) => c.why).join(" ") + " Nudge the arrival date a day or two and the trip comes back.";
      return s;
    }
    if (ws === "late" || early > 0) {
      s.why = "";
      return s;
    }
    if (N >= 8) {
      s.label = "Extended";
      s.why = `Everything from the recommended week, plus ${N - 7 === 1 ? "an open day" : `${N - 7} open days`} for the bonus round or for doing nothing at all.`;
    } else if (N === 7) {
      s.label = "Recommended";
      s.why = "Everything fits without turning the week into a death march. Best pacing.";
    } else if (N === 6) {
      s.label = "Compressed full trip";
      s.why = `Same major sights, less breathing room. The holiday market becomes a quick stop, and Christmas night rides on the back of the ${hostName} day.`;
    } else if (N === 5) {
      s.label = "First real cut";
      s.why = `${MODULES[r.depMuseum] ? MODULES[r.depMuseum].name + " moves to a shortened last morning before the train. " : ""}Everything else still fits at a reasonable pace.`;
    } else if (N === 4) {
      s.label = "Highlights version";
      s.why = `We're protecting the uniquely Washington things over more museums: the Capitol, the founding documents, Arlington, the memorial night, and Christmas. ${MODULES[r.depMuseum] ? MODULES[r.depMuseum].name + " becomes a couple of hours on the last morning." : ""}`;
    } else {
      s.label = "Minimum recommended";
      s.why = "This is the shortest version that still feels like the same trip: the civic core, the founding documents, the memorial night, Air & Space, and Christmas Washington.";
    }
    if (r.notes.length) s.why += " " + r.notes.join(" ");
    const dateCuts = r.cuts.filter((c) => c.why).map((c) => c.why);
    if (dateCuts.length) s.why += " " + dateCuts.join(" ");
    return s;
  }

  const engine = { plan, summarize, workStatus, workBuffer, workEarly, WORK, MODULES, HEADLINES, HEADLINE_NAMES, DEFAULT, MIN_NIGHTS, MAX_NIGHTS, parseISO, iso, fmtMD, fmtDMD, fmtDMDY, addDays };
  if (typeof module !== "undefined" && module.exports) { module.exports = engine; return; }
  root.DCPlanner = engine;

  /* ───────────── Renderer (browser only) ───────────── */

  if (typeof document === "undefined") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ticks = (n) => `<i class="ticks" style="--n:${n}"></i>`;

  function readHash() {
    const cfg = { ...DEFAULT };
    const h = location.hash.replace(/^#/, "");
    for (const part of h.split("&")) {
      const [k, v] = part.split("=");
      if (k === "start" && parseISO(v)) cfg.start = v;
      if (k === "nights" && +v >= MIN_NIGHTS && +v <= MAX_NIGHTS) cfg.nights = +v;
    }
    return cfg;
  }
  function writeHash(cfg) {
    const isDefault = cfg.start === DEFAULT.start && cfg.nights === DEFAULT.nights;
    const url = location.pathname + location.search + (isDefault ? "" : `#start=${cfg.start}&nights=${cfg.nights}`);
    history.replaceState(null, "", url);
  }

  function renderDay(d) {
    const dateCell = `<div class="stop-date"><b>${DOW[d.date.getDay()]}</b><span>${fmtMD(d.date)}</span></div>`;
    const photo = d.photo ? `<figure class="stop-photo"><img class="photo" src="/img/${d.photo[0]}" alt="${esc(d.photo[1])}" loading="lazy"><figcaption>${esc(d.photo[1])}</figcaption></figure>` : "";
    const body = d.body.map((p) => `<p>${esc(p)}</p>`).join("");
    const halves = d.day ? `<div class="halves">
      <div class="half"><small>Day</small>${ticks(d.day.legs)}<span>${esc(d.day.label)}</span></div>
      <div class="half night"><small>Night</small>${ticks(d.night.legs)}<span>${esc(d.night.label)}</span></div>
    </div>` : "";
    const cls = ["stop", d.featured ? "featured" : "", d.kind === "home" ? "last" : "", d.late ? "late" : ""].filter(Boolean).join(" ");
    return `<li class="${cls}">${dateCell}<div class="stop-body"><h3>${esc(d.title)}</h3>${photo}${body}${halves}</div></li>`;
  }

  function renderDifferent(r) {
    const n = r.nights === 1 ? "One night" : "Two nights";
    return `<li class="stop different"><div class="stop-date"><b>${DOW[r.start.getDay()]}</b><span>${fmtMD(r.start)}</span></div>
      <div class="stop-body">
        <h3>${n} is a different trip.</h3>
        <p>The seven-night plan is built around one big thing a day with room to breathe. Cutting it to ${r.nights === 1 ? "one night" : "two nights"} wouldn't shorten that trip, it would replace it. Rather than hand you a mangled version, pick what this shorter trip is <em>for</em>:</p>
        <ul class="options">
          <li><b>Monuments &amp; government.</b> The Capitol, the founding documents, and the memorial night. Washington the idea.</li>
          <li><b>Museums &amp; family.</b> Air &amp; Space and Natural History, with the Capitol lit up on the way in. Washington for Sam.</li>
          <li><b>Christmas Washington.</b> The tree, the White House, the market, the lights. Washington the postcard.</li>
        </ul>
        <p>The planner doesn't write those yet. Pick one and we'll build it by hand.</p>
      </div></li>`;
  }

  function render(cfg) {
    const r = plan(cfg);
    const s = summarize(r);

    // Hero dates and countdown source.
    $("eyebrow-dates").innerHTML = `${esc(fmtDMD(r.trainOut))} → ${esc(fmtDMDY(r.home))}`.replace(/ /g, "&nbsp;");
    root.DCTrip = { depart: new Date(r.trainOut.getFullYear(), r.trainOut.getMonth(), r.trainOut.getDate()), arrive: addDays(r.start, 0), home: r.home };
    root.dispatchEvent(new CustomEvent("trip:change"));

    const NW = ["", "One night", "Two nights", "Three nights", "Four nights", "Five nights", "Six nights", "Seven nights", "Eight nights", "Nine nights"];
    $("lede-nights").textContent = NW[r.nights] || `${r.nights} nights`;

    // Verdict line + controls.
    $("cfg-nights").textContent = String(r.nights);
    $("cfg-minus").disabled = r.nights <= MIN_NIGHTS;
    $("cfg-plus").disabled = r.nights >= MAX_NIGHTS;
    const isDefault = cfg.start === DEFAULT.start && cfg.nights === DEFAULT.nights;
    $("cfg-reset").hidden = isDefault;
    $("verdict").innerHTML = [
      `<b>${r.nights} ${r.nights === 1 ? "night" : "nights"}</b>`,
      `<span class="verdict-label${r.mode === "different" ? " warn" : ""}">${esc(s.label)}</span>`,
      s.count ? `<span>${esc(s.count)}</span>` : "",
    ].filter(Boolean).join('<span class="sep">·</span>');
    $("verdict-why").innerHTML = [s.cuts ? `<b>${esc(s.cuts)}</b>` : "", esc(s.why)].filter(Boolean).join(" ");
    const ws = workEarly(r.trainOut) > 0 ? "late" : workStatus(r.home);
    $("verdict-work").textContent = s.work;
    $("verdict-work").className = "verdict-work " + ws;
    $("verdict-work").hidden = !s.work;

    // Departure board.
    const weekend = r.start.getDay() === 0 || r.start.getDay() === 6;
    $("b-out-from").textContent = `${fmtDMD(r.trainOut)} · ${TRAIN.boardLabel}`;
    $("b-out-to").textContent = `${fmtDMD(r.start)} · ${weekend ? TRAIN.arriveWeekend : TRAIN.arriveWeekday}`;
    $("b-back-from").textContent = `${fmtDMD(r.depart)} · ${TRAIN.departLabel}`;
    $("b-back-to").textContent = `${fmtDMD(r.home)} · ${TRAIN.homeLabel}`;
    $("fixed-fact").innerHTML = `Bart works until <b>${esc(WORK.offLabel)}</b> and is back at work <b>${esc(WORK.label)}</b>. The train gets home around ${esc(TRAIN.homeLabel.replace(" CT", ""))}.`;
    renderStrip(r);

    // The week.
    const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    const nDays = r.days.length - 1; // the home day doesn't count
    $("week-kicker").textContent = r.mode === "different" ? "II.  A different trip" : `II.  ${WORDS[nDays] || nDays} days, one big thing a day`;
    $("line").innerHTML = r.mode === "different" ? renderDay(r.days[0]) + renderDifferent(r) : r.days.map(renderDay).join("");

    // The list: mark cuts.
    const cutSet = new Set(r.mode === "different" ? [] : HEADLINES.filter((h) => !r.kept.has(h)));
    document.querySelectorAll("#canon li[data-h]").forEach((li) => li.classList.toggle("cut", cutSet.has(li.dataset.h)));
    $("canon-note").textContent = r.mode === "different" ? "Which of these a shorter trip keeps depends on what it's for."
      : cutSet.size ? `${HEADLINES.length - cutSet.size} of thirteen on this version. The rest are marked.` : "All on the schedule.";

    // Footer.
    $("foot-dates").textContent = `${fmtMD(r.trainOut)} – ${fmtMD(r.home)}, ${r.home.getFullYear()}`;
  }


  /* ───────────── Calendar strip ─────────────
     One cell per day. Days Bart is at work are shaded. The trip is a block
     spanning train day → home day; drag it to move the arrival date. */

  const strip = $("strip");
  let stripRange = null; // { from: Date, n: number }
  let drag = null;

  function renderStrip(r) {
    const workOff = parseISO(WORK.off), workBack = parseISO(WORK.date);
    let from = addDays(workOff, -2), to = addDays(workBack, 2);
    if (r.trainOut < from) from = r.trainOut;
    if (r.home > to) to = r.home;
    const n = Math.round((to - from) / 86400000) + 1;
    stripRange = { from, n };
    const col = (d) => Math.round((d - from) / 86400000) + 1;

    let cells = "";
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      const hard = d < workOff || d > workBack;
      const half = iso(d) === WORK.off ? " half-am" : iso(d) === WORK.date ? " half-pm" : "";
      const first = i === 0 || d.getDate() === 1;
      cells += `<div class="cell${hard ? " work" : half}${first ? " month" : ""}" style="grid-column:${i + 1}" data-month="${MON[d.getMonth()]}"><i>${DOW[d.getDay()][0]}</i><b>${d.getDate()}</b></div>`;
    }
    const a = col(r.trainOut), b = col(r.home);
    const late = r.trainOut < workOff || r.home > workBack;
    const block = `<div class="block${late ? " late" : ""}" id="block" style="grid-column:${a} / ${b + 1}" tabindex="0" role="slider"
        aria-label="Trip dates" aria-valuetext="${esc(fmtDMD(r.trainOut))} to ${esc(fmtDMD(r.home))}">
        <span class="seg train" title="Train"></span>${r.nights >= 1 ? `<span class="seg nights">${r.nights} ${r.nights === 1 ? "night" : "nights"}</span>` : ""}<span class="seg train" title="Train"></span>
      </div>`;
    strip.style.setProperty("--n", n);
    strip.innerHTML = cells + block;
    bindBlock();
  }

  function bindBlock() {
    const block = $("block");
    block.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      drag = { x: e.clientX, start: parseISO(cfg.start), cell: strip.getBoundingClientRect().width / stripRange.n, applied: 0 };
      block.setPointerCapture(e.pointerId);
      block.classList.add("dragging");
      e.preventDefault();
    });
    block.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const delta = Math.round((e.clientX - drag.x) / drag.cell);
      if (delta === drag.applied) return;
      drag.applied = delta;
      const next = addDays(drag.start, delta);
      // keep the block on the strip while dragging; the strip regrows on release
      const minStart = addDays(stripRange.from, 1), maxStart = addDays(stripRange.from, stripRange.n - 1 - cfg.nights - 1);
      const clamped = next < minStart ? minStart : next > maxStart ? maxStart : next;
      update({ start: iso(clamped) }, true);
      // renderStrip replaced the block; keep the capture alive on the new one
      const nb = $("block"); nb.classList.add("dragging"); try { nb.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const end = () => { if (!drag) return; drag = null; update({}); };
    block.addEventListener("pointerup", end);
    block.addEventListener("pointercancel", end);
    block.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { update({ start: iso(addDays(parseISO(cfg.start), -1)) }); e.preventDefault(); $("block").focus(); }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { update({ start: iso(addDays(parseISO(cfg.start), 1)) }); e.preventDefault(); $("block").focus(); }
    });
  }

  let cfg = readHash();
  function update(next, live) {
    cfg = { ...cfg, ...next };
    cfg.nights = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, cfg.nights));
    if (!live) writeHash(cfg);
    render(cfg);
  }

  render(cfg);
  $("cfg-minus").addEventListener("click", () => update({ nights: cfg.nights - 1 }));
  $("cfg-plus").addEventListener("click", () => update({ nights: cfg.nights + 1 }));
  $("cfg-reset").addEventListener("click", () => update({ ...DEFAULT }));
  if (cfg.start !== DEFAULT.start || cfg.nights !== DEFAULT.nights) $("change").open = true;
})(typeof window !== "undefined" ? window : globalThis);

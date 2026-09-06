/*
 * DC Trip Planner — renderer and controls.
 *
 * Takes a plan from DCPlanner and turns it into the page. Two modes:
 *
 *   shared  — a signed-in traveler's view of the family's canonical trip from
 *             the Worker. Intents go up; the Worker re-runs the planner and
 *             persists the result.
 *   local   — the public pitch: the recommended trip and what-ifs in the URL
 *             hash. Anonymous visitors never see family state. Also the mode
 *             of a static preview with no Worker at all.
 */
(function () {
  "use strict";

  const P = window.DCPlanner, C = window.DCVenues;
  const { DEFAULT, MIN_NIGHTS, MAX_NIGHTS, WORK, TRAIN, parseISO, iso, addDays, fmtMD, fmtDMD, fmtDMDY, DOW, MON } = P;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // Reader-facing names. The data keeps lo/mid/hi, seed, punt; the page says Easy/Real/Big, Skip.
  const LOAD_NAME = { lo: "Easy", mid: "Real", hi: "Big" };
  const loadBadge = (load) => `<i class="load ${load}">${LOAD_NAME[load] || load}</i>`;
  const hint = (text) => `<span class="hint">${esc(text)}</span>`;
  const HINT = {
    vote: "Votes aren't edits. Any must-do protects it; if everyone skips it, it's off.",
    notThisDay: "Keeps it on the trip, finds another day.",
    done: "Locks it into history and counts toward trophies.",
    bail: "Bailed means we went, it was miserable, we called the car.",
    override: "Changes the shared trip for everyone. Votes still show.",
    whatIf: "A what-if. Nothing here changes the family's plan.",
    add: "Asks the planner to find room. Never bumps a must-see thing.",
    suggest: "Open on purpose. Add one of these, or leave it open.",
    nights: "Fewer nights cut the least-missed things first. More nights come back open.",
    strip: "Drag the block to move the whole trip. Shaded days, Bart's at work.",
  };
  const MISS = ["We'd miss it a lot", "We'd miss it some", "We'd miss it a little"];

  /* Narrative for the structural days. Trip prose, not venue data. */
  const NARRATIVE = {
    train: (early) => ({
      title: early > 0 ? "All aboard. Except Bart's at work." : "All aboard.",
      body: [early > 0
        ? `Bart works until ${WORK.offLabel}, so this train leaves ${early === 1 ? "a day" : `${early} days`} before he can. Push the arrival date later.`
        : early === 0
        ? "Bart clocks out at 2:00, we load up, drive to Anniston, eat, and climb onto the Crescent. Nothing to accomplish tonight except finding the bunks and watching Alabama slide by in the dark."
        : "Load up, drive to Anniston, eat, and climb onto the Crescent. Nothing to accomplish tonight except finding the bunks and watching Alabama slide by in the dark."],
      day: { label: "Pack and drive", load: "lo" }, night: { label: "The train is the activity", load: "lo" },
      photo: ["day-1128-anniston-station.webp", "Anniston station at boarding time"],
    }),
    arrival: {
      title: "Hello, Washington.",
      body: ["Roll into Union Station, check into the hotel, unpack, eat. Then, after dark, our first real look at the city: the U.S. Capitol dome lit up against the night sky. No tour. No agenda. Just stand there and take it in."],
      photo: ["day-1129-union-station.webp", "The main hall at Union Station"],
    },
    departureTail: "Lunch, luggage, Union Station, and the Crescent south.",
    departureEmpty: {
      title: "Last morning, then home.",
      body: ["Check out, leave the bags with the hotel, a slow breakfast, and one last walk on the Mall. Lunch, luggage, Union Station, and the Crescent south. Nothing big on purpose."],
      day: { label: "A slow last morning", load: "lo" },
    },
    open: {
      title: "Open day.",
      body: ["Nothing scheduled, on purpose. If the sun's out, walk the Tidal Basin. If it isn't, the National Gallery. If everyone's cooked, the hotel and a long lunch. Whitespace is part of the itinerary."],
    },
    home: (p) => {
      const { status, buffer } = p.work;
      const body = status === "ok"
        ? `Get the car, go home, and do absolutely nothing. ${buffer === 2 ? "Two full days" : `${buffer} days`} at home before Bart is back at work ${WORK.label}. That's part of the plan, not wasted vacation.`
        : status === "thin"
        ? `Get the car, go home, and do absolutely nothing. One day at home before Bart is back at work ${WORK.label}. Tighter than the recommended trip, but it works.`
        : status === "tight"
        ? "Get the car and go straight home, because Bart is due at work at 2 PM the same day. The Crescent gets in around 10:30 if it's on time. It is not always on time."
        : `This version gets home ${-buffer === 1 ? "a day" : `${-buffer} days`} after Bart was due back at work (${WORK.label}). Start earlier or take a night off the end.`;
      return {
        title: status === "late" ? "Anniston, ~10:30 AM. Late for work." : status === "tight" ? "Anniston, ~10:30 AM. Work at 2." : "Anniston, ~10:30 AM.",
        body: [body], late: status === "late" || status === "tight", photo: ["day-1207-home.webp", "Home."],
      };
    },
  };

  /* ───────────── State ───────────── */

  let cfg = { ...DEFAULT };
  let user = { punted: [], pinned: [], requested: [] };
  let pending = null; // an action awaiting confirmation, or a request awaiting a trade
  let prevPlan = null;
  let shared = null;   // { trip, decisions } from the Worker, or null in local mode
  let me = null;       // signed-in traveler, or null
  let travelers = [];  // everyone on the trip
  let today = null;    // ISO, from the Worker (or the browser in local mode)
  let live = null;     // /api/today: weather, fits, suggestion
  let trophies = null; // /api/achievements
  let whatIf = false;  // anonymous visitor exploring locally on top of the shared trip
  const signedIn = () => !!me;
  const isAdmin = () => !!(me && me.is_admin);

  function readHash() {
    const h = location.hash.replace(/^#/, "");
    for (const part of h.split("&")) {
      const [k, v] = part.split("=");
      if (k === "start" && parseISO(v)) cfg.start = v;
      if (k === "nights" && +v >= MIN_NIGHTS && +v <= MAX_NIGHTS) cfg.nights = +v;
      if (k === "punt" && v) user.punted = v.split(",").filter(Boolean);
      if (k === "pin" && v) user.pinned = v.split(",").filter(Boolean);
      if (k === "ask" && v) user.requested = v.split(",").filter(Boolean);
    }
  }
  function writeHash() {
    const parts = [];
    if (cfg.start !== DEFAULT.start) parts.push(`start=${cfg.start}`);
    if (cfg.nights !== DEFAULT.nights) parts.push(`nights=${cfg.nights}`);
    if (user.punted.length) parts.push(`punt=${user.punted.join(",")}`);
    if (user.pinned.length) parts.push(`pin=${user.pinned.join(",")}`);
    if (user.requested.length) parts.push(`ask=${user.requested.join(",")}`);
    history.replaceState(null, "", location.pathname + location.search + (parts.length ? "#" + parts.join("&") : ""));
  }
  const isDefault = () => cfg.start === DEFAULT.start && cfg.nights === DEFAULT.nights && !user.punted.length && !user.pinned.length && !user.requested.length;

  /* ───────────── Day cards ───────────── */

  function unitCopy(u) { return C.copy[u.id] || { title: u.name, body: [] }; }

  function halves(day, night) {
    const h = (slot, x) => `<div class="half${slot === "night" ? " night" : ""}"><small>${slot === "day" ? "Day" : "Night"}</small>${loadBadge(x.load)}<span>${esc(x.label)}</span></div>`;
    return `<div class="halves">${h("day", day)}${h("night", night)}</div>`;
  }

  const CHOICES = [["must", "Must do"], ["good", "Sounds good"], ["meh", "Meh"], ["punt", "Skip"]];
  const initials = (t) => t.name[0];

  // Personal opinions, not mutations. Everyone's shown; yours is clickable.
  function prefRow(u) {
    if (!shared || !signedIn()) return "";
    const prefs = shared.trip.preferences || {};
    const mine = (prefs[me.id] || {})[u.members[0]] || null;
    const others = travelers.filter((t) => t.id !== me.id && (prefs[t.id] || {})[u.members[0]]).map((t) => `<span class="vote ${(prefs[t.id] || {})[u.members[0]]}" title="${esc(t.name)}: ${(prefs[t.id] || {})[u.members[0]]}">${esc(initials(t))}</span>`).join("");
    return `<div class="prefs"><span class="prefs-you">Your vote</span><span class="pref-pills">${CHOICES.map(([c, l]) => `<button type="button" class="ctl pref${mine === c ? " on " + c : ""}" data-act="prefer" data-choice="${mine === c ? "" : c}" data-ids="${u.members.join(",")}">${l}</button>`).join("")}</span>${others ? `<span class="votes">${others}</span>` : ""}${hint(HINT.vote)}</div>`;
  }

  // What you can do with this thing today: done, moved, bailed. One hint per state.
  function doneRow(u, d) {
    if (!shared || !signedIn() || !d) return "";
    const ids = u.members.join(","), date = iso(d.date);
    if (u.completedOn) return `<div class="actions"><span class="done-state">✓ Done</span><button type="button" class="ctl" data-act="uncomplete" data-ids="${ids}">Undo</button>${hint("It happened. Undo only if that was a mis-tap.")}</div>`;
    if (d.past || d.isToday) return `<div class="actions"><button type="button" class="ctl" data-act="complete" data-ids="${ids}" data-date="${date}">Mark done</button>${d.isToday ? `<button type="button" class="ctl" data-act="bail" data-ids="${ids}" data-date="${date}">We bailed</button>` : ""}${hint(d.isToday ? `${HINT.done} ${HINT.bail}` : HINT.done)}</div>`;
    return `<div class="actions"><button type="button" class="ctl" data-act="not_this_day" data-ids="${ids}" data-date="${date}">Not this day</button>${hint(HINT.notThisDay)}</div>`;
  }

  // Admin overrides (or, with no family sign-in, what-if edits). A separate block, never the vote row.
  function overrideBlock(u) {
    if (!u) return "";
    if (shared && signedIn() && !isAdmin()) return "";
    const ids = u.members.join(",");
    const label = shared && signedIn() ? "Override" : "What-if";
    const state = u.pinned ? `<span class="ctl-state">✦ Must-do</span>` : u.requested ? `<span class="ctl-state">Added</span>` : "";
    const pin = u.pinned
      ? `<button type="button" class="ctl" data-act="unpin" data-ids="${ids}">Relax</button>`
      : `<button type="button" class="ctl" data-act="pin" data-ids="${ids}">Must-do</button>`;
    const off = u.requested && !u.pinned
      ? `<button type="button" class="ctl" data-act="unask" data-ids="${ids}">Remove</button>`
      : `<button type="button" class="ctl" data-act="punt" data-ids="${ids}">Skip</button>`;
    return `<div class="override"><span class="override-label">${label}</span>${state}${pin}${off}${hint(shared && signedIn() ? HINT.override : HINT.whatIf)}</div>`;
  }

  function unitControls(u, d) { return u ? doneRow(u, d) : ""; }

  // Ranked suggestions for an open slot. Recommended, never imposed.
  function suggestions(d, slot) {
    const list = d.suggest && d.suggest[slot];
    if (!list || !list.length) return "";
    return `<div class="suggest"><span class="suggest-head">${slot === "day" ? "Ideas for this day" : "Ideas for tonight"}</span>
      ${list.map((x) => `<button type="button" class="ctl suggest-btn" data-act="ask" data-ids="${x.id}">${esc(x.name)}${x.shortened ? ", shortened" : ""} <em>${LOAD_NAME[x.load]}</em></button>`).join("")}
      ${hint(HINT.suggest)}</div>`;
  }

  // Family photos replace the promotional ones when they exist: /img/done-<file>.
  function figure(photo, cls) {
    if (!photo) return "";
    const done = prevPlan && prevPlan.phase === "after";
    const src = done ? `/img/done-${photo[0]}` : `/img/${photo[0]}`;
    return `<figure class="${cls}"><img class="photo" src="${src}" ${done ? `data-fallback="/img/${photo[0]}"` : ""} alt="${esc(photo[1])}" loading="lazy"><figcaption>${esc(photo[1])}</figcaption></figure>`;
  }

  function renderFull(p, d) {
    const du = d.day ? p.units[d.day.id] : null, nu = d.night ? p.units[d.night.id] : null;
    const dc = du ? unitCopy(du) : null, nc = nu ? unitCopy(nu) : null;
    let title, body = [];
    if (du && nu) title = `${cap(dc.title)}, then ${nc.title}.`;
    else if (du) title = `${cap(dc.title)}.`;
    else if (nu) title = `${cap(nc.title)}.`;
    else title = NARRATIVE.open.title;
    if (dc) body.push(...dc.body); if (nc) body.push(...nc.body);
    if (!du && !nu) body.push(p.nights > DEFAULT.nights && p.headline.kept === p.headline.total ? "Everything in the core trip already fits comfortably. This day is open on purpose." : NARRATIVE.open.body[0]);
    if (du && !nu) body.push(du.load === "hi" ? "After a Big day, we keep the night empty on purpose." : "Dinner. Nothing scheduled after.");
    const featured = (dc && dc.featured) || (nc && nc.featured);
    const photo = (dc && dc.photo) || (nc && nc.photo) || null;
    const dayHalf = du ? { label: du.short, load: du.load } : C.structural.open;
    const nightHalf = nu ? { label: nu.short, load: nu.load } : C.structural.rest;
    const block = (label, u) => `<div class="unit-block" data-units="${u.id}"><span class="unit-label">${label}</span>${unitControls(u, d)}${prefRow(u)}${overrideBlock(u)}</div>`;
    return card(d, title, body, photo, halves(dayHalf, nightHalf), featured, false,
      (du ? block("Day", du) : (d.past ? "" : suggestions(d, "day"))) + (nu ? block("Night", nu) : (du && du.load !== "hi" && !d.past ? suggestions(d, "night") : "")),
      [du && du.id, nu && nu.id].filter(Boolean).join(" "));
  }

  function renderDeparture(p, d) {
    const du = d.day ? p.units[d.day.id] : null;
    if (!du) {
      const n = NARRATIVE.departureEmpty;
      return card(d, n.title, n.body, null, halves(n.day, C.structural.departure.night), false, false, suggestions(d, "day"));
    }
    const c = unitCopy(du);
    const title = d.day.shortened ? `${cap(c.title)}, shortened, then home.` : `${cap(c.title)}, then home.`;
    const body = c.short ? c.short.slice() : [...c.body, NARRATIVE.departureTail];
    return card(d, title, body, c.photo || null, halves({ label: d.day.shortened ? `${du.short}, a couple of hours` : du.short, load: d.day.shortened ? "mid" : du.load }, C.structural.departure.night), false, false,
      `<div class="unit-block" data-units="${du.id}"><span class="unit-label">Morning</span>${unitControls(du, d)}${prefRow(du)}${overrideBlock(du)}</div>`, du.id);
  }

  function card(d, title, body, photo, halvesHtml, featured, late, controls, units) {
    const cls = ["stop", featured ? "featured" : "", d.kind === "home" ? "last" : "", late ? "late" : "", d.past ? "past" : "", d.isToday ? "today" : ""].filter(Boolean).join(" ");
    return `<li class="${cls}"><div class="stop-date"><b>${DOW[d.date.getDay()]}</b><span>${fmtMD(d.date)}</span></div>
      <div class="stop-body"${units ? ` data-anchor="${units}"` : ""}><h3>${esc(title)}</h3>${figure(photo, "stop-photo")}${body.map((t) => `<p>${esc(t)}</p>`).join("")}${halvesHtml}${controls}</div></li>`;
  }

  function renderWeek(p) {
    const out = [];
    const t = NARRATIVE.train(p.work.early);
    out.push(card({ date: p.trainOut, kind: "train" }, t.title, t.body, t.photo, halves(t.day, t.night), false, p.work.early > 0, ""));
    for (const d of p.days) {
      if (d.kind === "arrival") { const a = NARRATIVE.arrival; out.push(card(d, a.title, a.body, a.photo, halves(C.structural.arrival.day, C.structural.arrival.night), false, false, "")); }
      else if (d.kind === "full") out.push(renderFull(p, d));
      else out.push(renderDeparture(p, d));
    }
    const h = NARRATIVE.home(p);
    out.push(card({ date: p.home, kind: "home" }, h.title, h.body, h.photo, "", false, h.late, ""));
    return out.join("");
  }

  /* ───────────── Bench ───────────── */

  function renderBench(p) {
    const units = Object.values(p.units).filter((u) => !p.placements[u.id]).sort((a, b) => a.seed - b.seed);
    const puntedVenues = user.punted.map((id) => C.venues.find((v) => v.id === id)).filter(Boolean);
    const tier = (i) => MISS[Math.min(2, Math.floor((i / Math.max(1, units.length)) * 3))];
    const meta = (u, i) => `<span class="bench-meta">${esc(tier(i))} · ${LOAD_NAME[u.load]} · ${u.period === "day" ? "Day" : "Night"}</span>`;
    const row = (u, i) => {
      const ex = p.excluded.find((e) => e.unit.id === u.id);
      const note = u.pinned ? `<em class="bench-note">Marked must-do, but there's ${ex ? ex.why : "no room"}.</em>`
        : u.requested ? `<em class="bench-note">Doesn't fit without changing the current trip. <button type="button" class="link" data-act="options" data-ids="${u.members[0]}">See the options</button></em>` : "";
      const ids = u.members.join(",");
      const adminOrLocal = !(shared && signedIn()) || isAdmin();
      const btn = !adminOrLocal ? "" : u.pinned
        ? `<button type="button" class="ctl" data-act="unpin" data-ids="${ids}">Let it go</button>`
        : u.requested
        ? `<button type="button" class="ctl" data-act="unask" data-ids="${ids}">Never mind</button>`
        : `<button type="button" class="ctl" data-act="ask" data-ids="${ids}">Add to trip</button>`;
      const btnHint = !adminOrLocal ? "" : hint(u.pinned || u.requested ? (shared && signedIn() ? HINT.override : HINT.whatIf) : HINT.add);
      return `<li data-anchor="${u.id}">${meta(u, i)}<span class="bench-name">${esc(u.name)}${note}${shared && signedIn() ? prefRow(u) : ""}</span><span class="bench-act">${btn}${btnHint}</span></li>`;
    };
    const puntRow = (v) => `<li class="punted"><span class="bench-meta">${LOAD_NAME[v.load]} · ${v.period === "day" ? "Day" : "Night"}</span><span class="bench-name">${esc(v.name)}</span><span class="bench-act"><button type="button" class="ctl" data-act="unpunt" data-ids="${v.id}">Bring back</button>${hint("Puts it back on the ideas list. The planner decides if it fits.")}</span></li>`;
    $("bench").innerHTML = units.map(row).join("") || `<li class="empty">Every idea we have is already in the trip.</li>`;
    $("punted-wrap").hidden = !puntedVenues.length;
    $("punted").innerHTML = puntedVenues.map(puntRow).join("");
  }

  /* ───────────── Page ───────────── */

  function render() {
    // Park the panel before anything it might be mounted in gets re-rendered.
    $("panel-home").appendChild($("panel"));
    const p = P.plan(cfg, user, prevPlan, { today: today || (shared ? null : localToday()) });
    const s = P.summarize(p);
    prevPlan = p;

    // Hero
    $("eyebrow-dates").innerHTML = `${esc(fmtDMD(p.trainOut))} → ${esc(fmtDMDY(p.home))}`.replace(/ /g, "&nbsp;");
    const NW = ["", "One night", "Two nights", "Three nights", "Four nights", "Five nights", "Six nights", "Seven nights", "Eight nights", "Nine nights", "Ten nights", "Eleven nights", "Twelve nights", "Thirteen nights", "Fourteen nights"];
    $("lede-nights").textContent = NW[p.nights] || `${p.nights} nights`;
    window.DCTrip = { depart: p.trainOut, arrive: new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate(), 14, 12), home: new Date(p.home.getFullYear(), p.home.getMonth(), p.home.getDate(), 10, 30) };
    window.dispatchEvent(new CustomEvent("trip:change"));

    $("cfg-nights").textContent = String(p.nights);
    const structural = shared && signedIn() && !isAdmin();
    $("cfg-minus").disabled = p.nights <= MIN_NIGHTS;
    $("cfg-plus").disabled = p.nights >= MAX_NIGHTS;
    $("cfg-reset").hidden = isDefault() && !(structural && whatIf);
    $("admin-note").hidden = !structural;
    $("nights-hint").textContent = HINT.nights;
    document.body.classList.toggle("structural-locked", false);
    renderIdentity();
    renderDecisions();
    const warn = s.label === "A different kind of trip" || s.label === "These dates don't work" || s.label === "Runs into work";
    $("verdict").innerHTML = [`<b>${p.nights} ${p.nights === 1 ? "night" : "nights"}</b>`, `<span class="verdict-label${warn ? " warn" : ""}">${esc(s.label)}</span>`, `<span>${esc(s.count.replace("headline experiences", "must-see things fit"))}</span>`].join('<span class="sep">·</span>');
    $("change-summary-text").textContent = shared && signedIn() && isAdmin() ? "Change dates or nights" : shared && signedIn() ? "Try a shorter trip (a what-if)" : "Try a shorter trip";
    renderExplainer(p);
    $("verdict-why").innerHTML = [s.cuts ? `<b>${esc(s.cuts)}</b>` : "", esc(s.why)].filter(Boolean).join(" ");
    const ws = p.work.early > 0 ? "late" : p.work.status;
    $("verdict-work").textContent = s.work; $("verdict-work").className = "verdict-work " + ws; $("verdict-work").hidden = !s.work;
    $("fixed-fact").innerHTML = `Bart works until <b>${esc(WORK.offLabel)}</b> and is back at work <b>${esc(WORK.label)}</b>. The train gets home around ${esc(TRAIN.homeLabel.replace(" CT", ""))}.`;
    renderStrip(p);

    // Board
    const weekend = p.start.getDay() === 0 || p.start.getDay() === 6;
    $("b-out-from").textContent = `${fmtDMD(p.trainOut)} · ${TRAIN.boardLabel}`;
    $("b-out-to").textContent = `${fmtDMD(p.start)} · ${weekend ? TRAIN.arriveWeekend : TRAIN.arriveWeekday}`;
    $("b-back-from").textContent = `${fmtDMD(p.depart)} · ${TRAIN.departLabel}`;
    $("b-back-to").textContent = `${fmtDMD(p.home)} · ${TRAIN.homeLabel}`;

    // Today in Washington, and the trophy case
    renderToday(p);
    renderTrophies();

    // Week
    const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
    const nDays = p.days.length + 1;
    $("week-kicker").textContent = `II.  ${WORDS[nDays] || nDays} days, one big thing a day`;
    $("line").innerHTML = renderWeek(p);
    $("tradeoffs-wrap").hidden = !p.reasons.length;
    $("tradeoffs").innerHTML = p.reasons.map((r) => `<li>${esc(r)}</li>`).join("");

    // The list
    document.querySelectorAll("#canon li[data-v]").forEach((li) => {
      const id = li.dataset.v;
      li.classList.toggle("cut", !p.includedVenues.has(id));
      li.classList.toggle("punted", user.punted.includes(id));
    });
    const kept = p.headline.kept, total = p.headline.total;
    $("canon-note").textContent = kept === total ? "All on the schedule." : `${kept} of thirteen fit this version. The rest are marked.`;
    $("whatif-banner").hidden = !(shared && signedIn() && whatIf);

    // Ideas + footer, then put the panel back next to its cause.
    renderBench(p);
    $("foot-dates").textContent = `${fmtMD(p.trainOut)} – ${fmtMD(p.home)}, ${p.home.getFullYear()}`;
    renderPanel(true);
  }

  function localToday() {
    const q = new URLSearchParams(location.search).get("today");
    if (q && parseISO(q)) return q;
    return iso(new Date());
  }

  function update(next, live) {
    if (shared && signedIn() && !live) {
      // Structural changes are intents; the Worker decides. Local render only while dragging.
      if (next.cfg && !isAdmin()) {
        // Not theirs to change. Let them look, locally, and say so.
        cfg = { ...cfg, ...next.cfg }; cfg.nights = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, cfg.nights));
        whatIf = !(cfg.start === shared.trip.start && cfg.nights === shared.trip.nights);
        render(); return;
      }
      if (next.cfg) {
        const c = { ...cfg, ...next.cfg };
        let intent = null;
        if (next.cfg.start && next.cfg.start !== shared.trip.start) intent = { type: "set_dates", start: c.start };
        else if (next.cfg.nights != null && next.cfg.nights !== shared.trip.nights) intent = { type: "set_nights", nights: Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, c.nights)) };
        else if (next.user && next.user.reset) intent = { type: "reset", start: DEFAULT.start, nights: DEFAULT.nights };
        if (!intent) { render(); return; }
        send(intent, false).then((r) => {
          if (r.ok && r.preview) {
            pending = { kind: "confirm", intent, messages: [...r.preview.messages, ...r.preview.notes],
              title: intent.type === "set_nights" ? `${intent.nights} nights: ${r.preview.label}.` : intent.type === "set_dates" ? `Arriving ${fmtDMD(parseISO(intent.start))}: ${r.preview.label}.` : "Back to the recommended trip.",
              go: "Make the change" };
            renderPanel();
          }
          if (!r.ok || r.preview) { adoptShared(); render(); }
        });
        return;
      }
    }
    if (next.cfg) cfg = { ...cfg, ...next.cfg };
    if (next.user) user = { ...user, punted: [...(next.user.punted || [])], pinned: [...(next.user.pinned || [])], requested: [...(next.user.requested || [])] };
    cfg.nights = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, cfg.nights));
    if (shared && !signedIn() && !live) { const pl = shared.trip.planner; whatIf = !(cfg.start === shared.trip.start && cfg.nights === shared.trip.nights && JSON.stringify([user.punted, user.pinned, user.requested]) === JSON.stringify([pl.punted, pl.pinned, pl.requested])); }
    if (!live && !shared) writeHash();
    render();
  }

  /* ───────────── Today in Washington ───────────── */

  function renderToday(p) {
    const el = $("today");
    renderRecord(p);
    if (p.phase !== "live") { el.hidden = true; return; }
    const d = p.days.find((x) => x.isToday);
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    if (live && live.weather && !d.weather) d.weather = live.weather[iso(d.date)] || null;
    if (live && live.fits) d.fit = live.fits;
    const line = (slot, x) => {
      if (!x) return `<p class="today-line"><span class="today-slot">${slot}</span> ${slot === "Day" ? (d.kind === "arrival" ? esc(C.structural.arrival.day.label) : "Open") : (d.kind === "arrival" ? esc(C.structural.arrival.night.label) : d.kind === "departure" ? esc(C.structural.departure.night.label) : "Dinner, nothing scheduled")}</p>`;
      const u = p.units[x.id], fit = d.fit[slot.toLowerCase()];
      return `<p class="today-line"><span class="today-slot">${slot}</span> ${loadBadge(u.load)} <b>${esc(u.name)}</b>${x.shortened ? ", shortened" : ""}${u.completedOn ? ' <span class="done-state">✓ Done</span>' : ""}${fit ? ` <span class="fit ${fit}">${fit}</span>` : ""}</p>`;
    };
    const w = d.weather ? `<p class="today-weather">${esc(d.weather.summary || "")}</p>` : "";
    const sug = live && live.suggestion ? `<div class="better"><p class="kicker-sm">Better plan available</p><p>${esc(live.suggestion.summary)}</p>${signedIn() ? `<button type="button" class="ctl on" data-swap="1">Make the swap</button>` : ""}</div>` : "";
    $("today-body").innerHTML = `<p class="today-date">${esc(fmtDMDY(d.date))}</p>${w}${line("Day", d.day)}${line("Night", d.night)}${sug}`;
  }

  // After the trip: the record, not dead infrastructure.
  function renderRecord(p) {
    const el = $("record");
    if (p.phase !== "after") { el.hidden = true; return; }
    el.hidden = false;
    const doneCount = C.headlines.filter((h) => (user.completed || {})[h]).length;
    const swaps = (shared && shared.decisions || []).filter((d) => d.type === "swap").length;
    const punts = (shared && shared.decisions || []).filter((d) => d.type === "punt" || /punt/.test(d.summary)).length;
    const total = trophies ? Object.values(trophies.byTraveler).reduce((n, l) => n + l.length, 0) + trophies.group.length : null;
    $("record-body").innerHTML = `<p class="today-date">${esc(fmtMD(p.trainOut))} – ${esc(fmtDMDY(p.home))}</p>
      <ul class="record-list"><li><b>${doneCount}</b> of ${C.headlines.length} must-see things</li>${total != null ? `<li><b>${total}</b> achievements</li>` : ""}<li><b>${swaps}</b> weather-driven ${swaps === 1 ? "swap" : "swaps"}</li><li><b>${punts}</b> strategic ${punts === 1 ? "skip" : "skips"}</li><li><b>0</b> days with two Big things</li></ul>
      ${trophies && trophies.group.includes("wally-world") ? `<p class="record-trophy">Wally World Was Open.</p>` : ""}`;
  }

  /* ───────────── Trophies: personal, and the standings ───────────── */

  function renderTrophies() {
    const el = $("trophies");
    if (!shared || !trophies || !signedIn()) { el.hidden = true; return; }
    el.hidden = false;
    const defs = Object.fromEntries(trophies.defs.map((d) => [d.id, d]));
    const mine = (trophies.byTraveler[me.id] || []).map((id) => defs[id]).filter(Boolean);
    const musts = Object.entries((shared.trip.preferences || {})[me.id] || {}).filter(([, c]) => c === "must").map(([v]) => (C.venues.find((x) => x.id === v) || {}).name).filter(Boolean);
    const doneMine = C.headlines.filter((h) => (user.completed || {})[h]).length;
    const standings = travelers.map((t) => ({ t, n: (trophies.byTraveler[t.id] || []).length })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name));
    const bartFirst = standings[0] && standings[0].t.is_admin;
    $("trophies-body").innerHTML = `
      <div class="mine"><p class="kicker-sm">${esc(me.name)}'s Washington</p>
        <p><b>${mine.length}</b> ${mine.length === 1 ? "achievement" : "achievements"} · <b>${doneMine}</b> of ${C.headlines.length} must-see things done${musts.length ? ` · must do: ${esc(musts.join(", "))}` : ""}</p>
        ${mine.length ? `<ul class="trophy-list">${mine.map((d) => `<li><b>${esc(d.name)}</b> <span>${esc(d.description)}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing yet. Go see something.</p>`}
      </div>
      <div class="standings"><p class="kicker-sm">Current standings</p>
        <ol>${standings.map((s) => `<li><span>${esc(s.t.name)}</span><b>${s.n}</b></li>`).join("")}</ol>
        ${!bartFirst && standings.length ? `<p class="muted">Bart has appealed the results.</p>` : ""}
        ${trophies.group.length ? `<p class="muted">Trip: ${trophies.group.map((id) => (defs[id] || {}).name).filter(Boolean).join(", ")}</p>` : ""}
      </div>`;
  }

  async function fetchLive() {
    if (!shared) return;
    try {
      const [t, a] = await Promise.all([fetch("/api/today"), signedIn() ? fetch("/api/achievements") : Promise.resolve(null)]);
      live = t.ok ? await t.json() : null;
      trophies = a && a.ok ? await a.json() : null;
    } catch (_) { live = null; trophies = null; }
  }

  /* ───────────── Who's here, what's been decided ───────────── */

  // The role banner: who you are, and one sentence on what you can change.
  function renderIdentity() {
    const el = $("identity");
    if (!shared && !hasWorker) { el.hidden = true; return; }
    el.hidden = false;
    if (me && isAdmin()) el.innerHTML = `<span class="who">You're <b>${esc(me.name)}</b>, ${esc(me.role)}.</span><span class="can">You can change dates and nights, override any vote, and do everything the others can.</span>`;
    else if (me) el.innerHTML = `<span class="who">You're <b>${esc(me.name)}</b>, ${esc(me.role)}.</span><span class="can">Vote on anything, mark things done, move things to another day. Dates and nights are Bart's.</span>`;
    else el.innerHTML = `<span class="who">This is the pitch.</span><span class="can">Try a shorter trip below; nothing here changes the family's plan.</span> <a href="/family" class="signin">Family, sign in</a>`;
  }

  // One explainer, four points, pacing first. Signed-in, before the trip, dismissable once.
  function renderExplainer(p) {
    const el = $("explainer");
    let seen = false; try { seen = localStorage.getItem("dc.explained") === "1"; } catch (_) {}
    el.hidden = !(shared && signedIn() && (p.phase === "before" || p.phase === "plan") && !seen);
  }

  function renderDecisions() {
    const wrap = $("decisions-wrap");
    if (!shared || !shared.decisions || !shared.decisions.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const fmt = (iso) => { const d = new Date(iso); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; };
    $("decisions").innerHTML = shared.decisions.map((d) => `<li><span class="when">${esc(fmt(d.at))}</span> ${esc(d.summary)}${d.admin ? "" : ' <em class="quip">Bart has filed no objection.</em>'}</li>`).join("");
  }

  /* ───────────── Talking to the Worker ───────────── */

  let hasWorker = false; // a Worker answered, even if we're anonymous

  async function fetchShared() {
    try {
      const m = await fetch("/api/me", { headers: { accept: "application/json" }, redirect: "manual" });
      let mj = null; try { mj = m.ok ? await m.json() : null; } catch (_) {}
      hasWorker = m.ok || m.type === "opaqueredirect" || m.status === 401 || m.status === 403;
      me = mj && mj.traveler ? mj.traveler : null; travelers = (mj && mj.travelers) || [];
      if (!me) return false; // the pitch, locally; family state stays behind sign-in
      const t = await fetch("/api/trip", { headers: { accept: "application/json" } });
      if (!t.ok) { me = null; return false; }
      shared = await t.json();
      today = shared.today || null;
      return true;
    } catch (_) { return false; }
  }

  function adoptShared() {
    cfg = { start: shared.trip.start, nights: shared.trip.nights };
    const pl = shared.trip.planner;
    user = { punted: [...pl.punted], pinned: [...pl.pinned], requested: [...pl.requested], completed: pl.completed || {}, fixed: pl.fixed || {}, notThisDay: pl.notThisDay || {} };
    prevPlan = { placements: shared.trip.placements || {} };
  }

  // Send intent. Returns { ok, preview } — a preview means the Worker wants a confirmation.
  async function send(intent, confirmed) {
    const res = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ version: shared.trip.version, intent, confirmed: !!confirmed }) });
    let body = null; try { body = await res.json(); } catch (_) {}
    if (res.status === 401) { location.href = (body && body.signin) || "/family"; return { ok: false }; }
    if (res.status === 409 && body && body.trip) { shared = body; adoptShared(); render(); toast("Somebody else changed the trip first. Here's the latest."); return { ok: false }; }
    if (!res.ok) { toast((body && body.error) || "That didn't take."); return { ok: false }; }
    if (body.preview) return { ok: true, preview: body };
    shared = { trip: body.trip, decisions: body.decisions, today: body.today }; adoptShared();
    await fetchLive(); render();
    const mine = (body.unlocked || []).filter((u) => u.scope === "trip" || u.traveler === (me && me.id));
    if (mine.length) toast(`Achievement unlocked: ${mine.map((u) => u.name).join(", ")}`);
    return { ok: true };
  }

  function toast(text) {
    const el = $("toast"); el.textContent = text; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  /* ───────────── Calendar strip ───────────── */

  const strip = $("strip");
  let stripRange = null, drag = null;

  function renderStrip(p) {
    const workOff = parseISO(WORK.off), workBack = parseISO(WORK.date);
    let from = addDays(workOff, -2), to = addDays(workBack, 2);
    if (p.trainOut < from) from = p.trainOut;
    if (p.home > to) to = p.home;
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
    const a = col(p.trainOut), b = col(p.home);
    const late = p.trainOut < workOff || p.home > workBack;
    strip.style.setProperty("--n", n);
    strip.innerHTML = cells + `<div class="block${late ? " late" : ""}" id="block" style="grid-column:${a} / ${b + 1}" tabindex="0" role="slider" aria-label="Trip dates" aria-valuetext="${esc(fmtDMD(p.trainOut))} to ${esc(fmtDMD(p.home))}">
        <span class="seg train"><i class="grip" aria-hidden="true">⋮</i></span><span class="seg nights">Your trip · ${p.nights} ${p.nights === 1 ? "night" : "nights"}</span><span class="seg train"><i class="grip" aria-hidden="true">⋮</i></span></div>`;
    bindBlock();
  }

  function bindBlock() {
    const block = $("block");
    block.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      drag = { x: e.clientX, start: parseISO(cfg.start), cell: strip.getBoundingClientRect().width / stripRange.n, applied: 0 };
      block.setPointerCapture(e.pointerId); block.classList.add("dragging"); e.preventDefault();
    });
    block.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const delta = Math.round((e.clientX - drag.x) / drag.cell);
      if (delta === drag.applied) return;
      drag.applied = delta;
      const next = addDays(drag.start, delta);
      const minStart = addDays(stripRange.from, 1), maxStart = addDays(stripRange.from, stripRange.n - 2 - cfg.nights);
      const clamped = next < minStart ? minStart : next > maxStart ? maxStart : next;
      update({ cfg: { start: iso(clamped) } }, true);
      const nb = $("block"); nb.classList.add("dragging"); try { nb.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const end = () => { if (!drag) return; drag = null; update({}); };
    block.addEventListener("pointerup", end); block.addEventListener("pointercancel", end);
    block.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
      if (!step) return;
      update({ cfg: { start: iso(addDays(parseISO(cfg.start), step)) } }); e.preventDefault(); $("block").focus();
    });
  }

  /* ───────────── Wire up ───────────── */

  (async () => {
    if (await fetchShared()) { adoptShared(); await fetchLive(); if (location.hash === "#signed-in") history.replaceState(null, "", location.pathname); }
    else readHash();
    render();
    document.addEventListener("visibilitychange", async () => { if (!document.hidden && shared && !whatIf && !pending && await fetchShared()) { adoptShared(); render(); } });
  })();
  $("whatif-back").addEventListener("click", () => { pending = null; adoptShared(); whatIf = false; render(); });
  $("cfg-minus").addEventListener("click", () => update({ cfg: { nights: cfg.nights - 1 } }));
  $("cfg-plus").addEventListener("click", () => update({ cfg: { nights: cfg.nights + 1 } }));
  $("cfg-reset").addEventListener("click", () => {
    pending = null; renderPanel();
    if (shared && signedIn() && !isAdmin()) { adoptShared(); whatIf = false; render(); return; }
    if (shared && signedIn()) { update({ cfg: { ...DEFAULT }, user: { reset: true, punted: [], pinned: [], requested: [] } }); return; }
    update({ cfg: { ...DEFAULT }, user: { punted: [], pinned: [], requested: [] } });
  });

  /* ───────────── Actions: preview first, then apply or ask ───────────── */

  function nextUser(act, ids) {
    const u = { punted: user.punted.filter((id) => !ids.includes(id)), pinned: user.pinned.filter((id) => !ids.includes(id)), requested: user.requested.filter((id) => !ids.includes(id)) };
    if (act === "punt") u.punted.push(...ids);
    if (act === "pin") u.pinned.push(...ids);
    if (act === "ask") u.requested.push(...ids);
    if (act === "unpin" && ids.some((id) => user.requested.includes(id))) u.requested.push(...ids); // relax back to requested
    return u;
  }

  function reveal(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // The consequence mounts next to its cause: inside the card or the Ideas row that was pressed.
  function anchorPanel() {
    const el = $("panel"), home = $("panel-home");
    let target = null;
    if (pending && pending.anchor) {
      const id = pending.anchor;
      target = document.querySelector(`.stop-body[data-anchor~="${CSS.escape(id)}"]`) || document.querySelector(`#bench li[data-anchor="${CSS.escape(id)}"] .bench-name`);
    }
    (target || home).appendChild(el);
  }

  function renderPanel(silent) {
    const el = $("panel");
    if (!pending) { el.hidden = true; el.innerHTML = ""; $("panel-home").appendChild(el); return; }
    el.hidden = false;
    if (pending.kind === "confirm") {
      el.innerHTML = `<p class="panel-head">${esc(pending.title)}</p>
        <ul class="panel-list">${pending.messages.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
        <div class="panel-actions"><button type="button" class="ctl on" data-panel="go">${esc(pending.go)}</button><button type="button" class="ctl" data-panel="no">Don't make this change</button></div>`;
    } else {
      el.innerHTML = `<p class="panel-head">${esc(pending.name)} doesn't fit without changing the current trip.</p>
        ${pending.options.length ? `<p class="panel-sub">Best options:</p>` : `<p class="panel-note">At this length, every trade would go to something we'd miss more. Mark it must-do if it matters more than that, or add nights.</p>`}
        <div class="panel-actions vertical">
          ${pending.options.map((o, i) => `<button type="button" class="ctl" data-panel="opt" data-i="${i}">${esc(o.label)}</button>`).join("")}
          <button type="button" class="ctl" data-panel="board">Leave it as an idea</button>
        </div>`;
    }
    anchorPanel();
    if (!silent) reveal(el);
  }

  const INTENT_OF = { punt: "punt", unpunt: "unpunt", pin: "pin", unpin: "unpin", ask: "ask", unask: "unask", complete: "complete", uncomplete: "uncomplete", not_this_day: "not_this_day", bail: "bail", prefer: "prefer" };

  function nameOf(ids) {
    const unit = Object.values(prevPlan.units).find((x) => x.members.some((m) => ids.includes(m)));
    if (unit) return unit.name;
    const bundle = Object.entries(C.bundles).find(([, b]) => b.core.includes(ids[0]));
    return bundle ? bundle[1].name : (C.venues.find((v) => v.id === ids[0]) || {}).name || "this";
  }

  async function actShared(action, ids, extra = {}) {
    const unit = Object.values(prevPlan.units).find((x) => x.members.some((m) => ids.includes(m)));
    const name = nameOf(ids);
    const intent = { type: INTENT_OF[action], venue: ids[0], members: ids, ...extra };
    if (action === "prefer" && unit && extra.choice === "good") {
      // Would the group reading land it? If not, record the opinion and show the trades up front.
      const trial = { ...user, requested: [...user.requested, ...ids] };
      const after = P.plan(cfg, trial, prevPlan, { today });
      if (!after.placements[unit.id]) {
        await send(intent, true);
        pending = { kind: "options", name: unit.name, id: ids[0], anchor: unit.id, options: P.fitOptions(cfg, user, ids[0], prevPlan) }; renderPanel(); return;
      }
    }
    if (action === "unpin" && ids.some((id) => user.requested.includes(id))) intent.backTo = "requested";
    if (action === "ask" && unit) {
      // Would it land? Ask the planner locally first so the options panel can offer the trades.
      const after = P.plan(cfg, nextUser("ask", ids), prevPlan);
      if (!after.placements[unit.id]) { pending = { kind: "options", name: unit.name, id: ids[0], anchor: unit.id, options: P.fitOptions(cfg, user, ids[0], prevPlan) }; renderPanel(); return; }
    }
    const r = await send(intent, false);
    if (r.ok && r.preview) {
      const f = r.preview.flags || {};
      const cutsCore = (f.cutHeadlines && f.cutHeadlines.length) || (f.cutProtected && f.cutProtected.length);
      const title = f.identityChanged ? "This changes the kind of trip."
        : cutsCore ? `To keep ${name}, something has to give.`
        : f.newAvoid && f.newAvoid.length ? "This makes a day harder."
        : "This changes more than one day.";
      pending = { kind: "confirm", intent, anchor: unit ? unit.id : null, messages: [...r.preview.messages, ...r.preview.notes], title,
        go: cutsCore ? `Keep ${name}, drop ${(f.cutProtected && f.cutProtected[0]) || f.cutHeadlines[0]}` : "Continue anyway" };
      renderPanel();
    } else if (r.ok && unit) { const a = document.querySelector(`.stop-body[data-anchor~="${CSS.escape(unit.id)}"]`); if (a) reveal(a); }
  }

  function act(action, ids, extra) {
    pending = null;
    if (shared && signedIn()) { actShared(action, ids, extra); return; }
    if (!["punt", "unpunt", "pin", "unpin", "ask", "unask"].includes(action)) return;
    const before = prevPlan;
    const u = nextUser(action, ids);
    if (action === "punt" || action === "unpunt" || action === "unask" || action === "unpin") {
      update({ user: u });
      const d = P.diff(before, prevPlan, ids);
      if (action === "punt" && d.notes.length) { $("tradeoffs-wrap").hidden = false; $("tradeoffs").insertAdjacentHTML("afterbegin", d.notes.map((n) => `<li>${esc(n)}</li>`).join("")); }
      return;
    }
    const after = P.plan(cfg, u, before);
    const unit = Object.values(after.units).find((x) => x.members.some((m) => ids.includes(m)));
    if (action === "ask" && unit && !after.placements[unit.id]) {
      pending = { kind: "options", name: unit.name, id: ids[0], anchor: unit.id, options: P.fitOptions(cfg, user, ids[0], before) };
      renderPanel(); return;
    }
    const d = P.diff(before, after, ids);
    if (d.consequential) {
      const cutsCore = d.cutHeadlines.length || d.cutProtected.length || d.identityChanged;
      pending = { kind: "confirm", user: u, anchor: unit ? unit.id : null, messages: d.messages.concat(d.notes),
        title: d.identityChanged ? "This changes the kind of trip." : cutsCore ? `To keep ${unit ? unit.name : "this"}, something has to give.` : d.newAvoid.length ? "This makes a day harder." : "This changes more than one day.",
        go: cutsCore && unit ? `Keep ${unit.name}${d.cutHeadlines.length ? `, drop ${d.cutHeadlines[0]}` : ""}` : "Continue anyway" };
      renderPanel(); return;
    }
    update({ user: u });
    if (d.notes.length) { $("tradeoffs-wrap").hidden = false; $("tradeoffs").insertAdjacentHTML("afterbegin", d.notes.map((n) => `<li>${esc(n)}</li>`).join("")); }
    if (unit) { const a = document.querySelector(`.stop-body[data-anchor~="${CSS.escape(unit.id)}"]`); if (a) reveal(a); }
  }

  document.addEventListener("click", (e) => {
    const sw = e.target.closest("button[data-swap]");
    if (sw && live && live.suggestion) {
      send({ type: "swap", moves: live.suggestion.moves.map((m) => ({ venue: m.venue, date: m.date, name: m.name })), reason: live.weather && live.weather[today] ? live.weather[today].summary : "weather" }, true);
      return;
    }
    const pb = e.target.closest("button[data-panel]");
    if (pb) {
      const k = pb.dataset.panel;
      if (k === "go" && pending) {
        const pd = pending; pending = null; renderPanel();
        if (pd.intent) send(pd.intent, true); else update({ user: pd.user });
      }
      else if (k === "opt" && pending) {
        const o = pending.options[+pb.dataset.i]; const id = pending.id; pending = null; renderPanel();
        if (shared && signedIn()) {
          (async () => {
            if (o.kind === "night") { if (!isAdmin()) { toast("Adding a night is Bart's call. Ask him."); return; } await send({ type: "set_nights", nights: cfg.nights + 1 }, true); }
            else await send({ type: "punt", venue: o.members[0], members: o.members }, true);
            await send({ type: "ask", venue: id, members: [id] }, true);
          })();
          return;
        }
        if (o.kind === "night") update({ cfg: { nights: cfg.nights + 1 }, user: nextUser("ask", [id]) });
        else update({ user: { ...nextUser("ask", [id]), punted: [...user.punted.filter((x) => !o.members.includes(x)), ...o.members] } });
      }
      else if (k === "board" && pending) {
        const id = pending.id; pending = null; renderPanel();
        if (shared && signedIn()) send({ type: "ask", venue: id, members: [id] }, true); else update({ user: nextUser("ask", [id]) });
      }
      else { pending = null; renderPanel(); }
      return;
    }
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const ids = b.dataset.ids.split(","), a = b.dataset.act;
    if (a === "prefer") { act(a, ids, { choice: b.dataset.choice || null }); return; }
    if (["complete", "not_this_day", "bail"].includes(a)) { act(a, ids, { date: b.dataset.date }); return; }
    if (a === "options") { const u = Object.values(prevPlan.units).find((x) => x.members.includes(ids[0])); pending = { kind: "options", name: u.name, id: ids[0], anchor: u.id, options: P.fitOptions(cfg, user, ids[0], prevPlan) }; renderPanel(); return; }
    if (a === "explained") { try { localStorage.setItem("dc.explained", "1"); } catch (_) {} $("explainer").hidden = true; return; }
    act(a, ids);
  });
  if (!isDefault()) $("change").open = true;
})();

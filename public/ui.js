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

  const P = window.DCPlanner, C = window.DCVenues, B = window.DCBracket;
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
    nights: "Both travel days are the train's. Fewer nights cut from the bottom of the family's order; more nights bring things back.",
    bracket: "Tap the one you'd rather not miss. Saved as you go. You can rerun the whole thing later.",
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
  let signinWhy = null; // why a sign-in did not map to a traveler, from /api/me
  let travelers = [];  // everyone on the trip
  let today = null;    // ISO, from the Worker (or the browser in local mode)
  let live = null;     // /api/today: weather, fits, suggestion
  let trophies = null; // /api/achievements
  let br = null;       // /api/bracket: contenders, structure, my picks, the family's standing
  let brConfirm = false; // "rerun my bracket" asked once, waiting for a yes
  let whatIf = false;  // anonymous visitor exploring locally on top of the shared trip
  const signedIn = () => !!me;
  const isAdmin = () => !!(me && me.is_admin);
  // The family layer: signed in, on the trip. Everyone else gets the pitch.
  const family = () => !!(shared && signedIn());
  // What the planner is told from outside: the date, and the family's order when there is one.
  const ext = () => { const bk = shared && shared.trip.bracket; return { today: today || (shared ? null : localToday()), familyRank: bk ? bk.familyRank : [], champions: bk ? bk.champions : [] }; };
  const venueName = (id) => (C.venues.find((v) => v.id === id) || {}).name || id;

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
    const units = Object.values(p.units).filter((u) => !p.placements[u.id]).sort((a, b) => a.order - b.order);
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
    $("bench-intro").textContent = p.family
      ? "Everything below the family's top thirteen, in the family's order, plus anything that didn't fit. Ask for one and the planner finds room if it can, or tells you what it would cost."
      : "Everything else worth doing, in the order we'd miss it. The planner fills the must-see things on its own; these are yours to add. Ask for one and it finds room if it can, or tells you what it would cost.";
    $("punted-wrap").hidden = !puntedVenues.length;
    $("punted").innerHTML = puntedVenues.map(puntRow).join("");
  }

  /* ───────────── Page ───────────── */

  function render() {
    // Park the panel before anything it might be mounted in gets re-rendered.
    $("panel-home").appendChild($("panel"));
    const p = P.plan(cfg, user, prevPlan, ext());
    const s = P.summarize(p);
    prevPlan = p;
    // The family layer shows only to the family. The pitch is the reel.
    document.querySelectorAll("[data-family]").forEach((el) => { el.hidden = !family(); });

    // Hero
    $("eyebrow-dates").innerHTML = `${esc(fmtDMD(p.trainOut))} → ${esc(fmtDMDY(p.home))}`.replace(/ /g, "&nbsp;");
    const NW = ["", "One night", "Two nights", "Three nights", "Four nights", "Five nights", "Six nights", "Seven nights", "Eight nights", "Nine nights", "Ten nights", "Eleven nights", "Twelve nights", "Thirteen nights", "Fourteen nights"];
    $("lede-nights").textContent = NW[p.nights] || `${p.nights} nights`;
    $("lede-span").textContent = p.nights >= 7 ? "the whole week" : p.nights >= 4 ? "all of it" : "every minute of it";
    window.DCTrip = { depart: p.trainOut, arrive: new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate(), 14, 12), home: new Date(p.home.getFullYear(), p.home.getMonth(), p.home.getDate(), 10, 30) };
    window.dispatchEvent(new CustomEvent("trip:change"));

    $("cfg-nights").textContent = String(p.nights); $("cfg-nights-word").textContent = p.nights === 1 ? "hotel night" : "hotel nights";
    $("cfg-leave").value = iso(p.trainOut); $("cfg-home").value = iso(p.home);
    const structural = shared && signedIn() && !isAdmin();
    $("cfg-reset").hidden = isDefault() && !(structural && whatIf);
    $("admin-note").hidden = !structural;
    $("nights-hint").textContent = HINT.nights;
    document.body.classList.toggle("structural-locked", false);
    renderIdentity();
    renderDecisions();
    const warn = s.label === "A different kind of trip" || s.label === "These dates don't work" || s.label === "Runs into work";
    $("verdict").innerHTML = [`<b>${p.nights} ${p.nights === 1 ? "night" : "nights"}</b>`, `<span class="verdict-label${warn ? " warn" : ""}">${esc(s.label)}</span>`, `<span>${esc(s.count.replace("headline experiences", "must-see things fit"))}</span>`].join('<span class="sep">·</span>');
    $("change-summary-text").textContent = shared && signedIn() && isAdmin() ? "Change the dates" : shared && signedIn() ? "Try other dates (a what-if)" : "Try other dates";
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

    // Today in Washington, the trophy case, the bracket, the reel
    renderToday(p);
    renderTrophies();
    renderBracket();
    renderReel(p);

    // Week
    const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
    const nDays = p.days.length + 1;
    $("week-kicker").dataset.base = `${cap(WORDS[nDays] || String(nDays))} days, one big thing a day`;
    $("line").innerHTML = renderWeek(p);
    $("tradeoffs-wrap").hidden = !p.reasons.length;
    $("tradeoffs").innerHTML = p.reasons.map((r) => `<li>${esc(r)}</li>`).join("");

    // The list
    renderCanon(p);
    $("whatif-banner").hidden = !(shared && signedIn() && whatIf);

    // Ideas + footer, then put the panel back next to its cause.
    renderBench(p);
    $("foot-dates").textContent = `${fmtMD(p.trainOut)} – ${fmtMD(p.home)}, ${p.home.getFullYear()}`;
    numberSections();
    renderPanel(true);
  }

  // Roman numerals follow whatever sections are showing.
  function numberSections() {
    const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
    let n = 0;
    document.querySelectorAll("main > section").forEach((sec) => {
      if (sec.hidden) return;
      const k = sec.querySelector("[data-kicker]"); if (!k) return;
      if (!k.dataset.base) k.dataset.base = k.textContent.trim();
      k.innerHTML = `${ROMAN[n++] || n}. &nbsp;${esc(k.dataset.base)}`;
    });
  }

  /* ───────────── The list: the thirteen must-see things ───────────── */

  const CANON_NAME = { "national-archives": "Declaration, Constitution & Bill of Rights", "national-christmas-tree": "Christmas in Washington" };

  function renderCanon(p) {
    const items = p.family
      ? p.mustSee.map((id) => ({ id, name: p.units[id].name, cut: !p.placements[id], punted: p.units[id].members.every((m) => user.punted.includes(m)) }))
      : C.headlines.map((id) => ({ id, name: CANON_NAME[id] || venueName(id), cut: !p.includedVenues.has(id), punted: user.punted.includes(id) }));
    $("canon").innerHTML = items.map((x) => `<li data-v="${x.id}" class="${x.cut ? "cut" : ""}${x.punted ? " punted" : ""}">${esc(x.name)}</li>`).join("");
    $("canon-lead").textContent = p.family
      ? "The family's bracket picked these, and the planner gives every one of them the time it deserves."
      : "We're probably only doing this once, so we picked the A-list and gave every one of them the time it deserves.";
    const kept = p.headline.kept, total = p.headline.total;
    $("canon-note").textContent = kept === total ? "All on the schedule." : `${kept} of thirteen fit this version. The rest are marked.`;
  }

  /* ───────────── The reel: every contender, no schedule ───────────── */

  function renderReel(p) {
    const cs = B.contenders(C);
    $("reel-list").innerHTML = cs.map((c) => {
      const cp = C.copy[c.id] || { title: c.name, body: [] };
      const u = p.family ? p.units[c.id] : null;
      const rank = u && u.familyRank ? `<span class="reel-rank">Family's No. ${u.familyRank}</span>` : "";
      return `<li class="reel-item${cp.featured ? " featured" : ""}" id="reel-${c.id}">
        <div class="reel-meta"><span class="reel-seed">${c.seed}</span>${loadBadge(c.load)}<span class="reel-when">${c.period === "day" ? "Day" : "Night"}</span>${rank}</div>
        <h3>${esc(cap(cp.title))}</h3>
        ${c.bundle ? `<p class="reel-short">${esc(c.short)}</p>` : ""}
        ${figure(cp.photo || null, "reel-photo")}
        ${cp.body.map((t) => `<p>${esc(t)}</p>`).join("")}
      </li>`;
    }).join("");
    $("reel-cta").hidden = family();
    $("reel-intro").querySelector(".reel-easy").hidden = false;
  }

  /* ───────────── The bracket ───────────── */

  function contenderCard(c, side, game) {
    const cp = C.copy[c.id] || { title: c.name, body: [] };
    return `<button type="button" class="contender" data-pick="${c.id}" data-game="${game}" aria-label="Pick ${esc(c.name)}">
      <span class="c-meta"><span class="c-seed">${c.seed} seed</span>${loadBadge(c.load)}<span>${c.period === "day" ? "Day" : "Night"}</span></span>
      ${figure(cp.photo || null, "c-photo")}
      <span class="c-title">${esc(cap(cp.title))}</span>
      ${c.bundle ? `<span class="c-short">${esc(c.short)}</span>` : ""}
      <span class="c-body">${esc(cp.body[0] || "")}</span>
      <span class="c-go">This one</span>
    </button>`;
  }

  function renderBracket() {
    const el = $("bracket-body");
    if (!family() || !br) { el.innerHTML = ""; return; }
    const ids = br.contenders.map((c) => c.id);
    const byId = Object.fromEntries(br.contenders.map((c) => [c.id, c]));
    const r = B.resolve(br.structure, ids, br.picks);
    let mine;
    if (!r.complete) {
      const g = r.next;
      const sofar = r.picksMade ? `<p class="matchup-sofar">${r.picksMade} of ${r.picksNeeded} picked. <button type="button" class="link" data-bracket="restart">Start over</button></p>` : "";
      mine = `<div class="matchup">
        <p class="matchup-round"><span class="round">${esc(B.ROUND_NAME[g.round])}</span><span class="sep">·</span><span>pick ${r.picksMade + 1} of ${r.picksNeeded}</span></p>
        <div class="versus">${contenderCard(byId[g.a], "a", g.id)}<span class="vs">or</span>${contenderCard(byId[g.b], "b", g.id)}</div>
        ${hint(HINT.bracket)}${sofar}
      </div>`;
    } else {
      const order = B.ranking(br.structure, ids, br.picks);
      const rerun = brConfirm
        ? `<div class="actions"><span class="ctl-state">Sure? The old ballot is gone until the new one is finished.</span><button type="button" class="ctl on" data-bracket="reset">Yes, rerun it</button><button type="button" class="ctl" data-bracket="keep">Keep it</button></div>`
        : `<div class="actions"><button type="button" class="ctl" data-bracket="rerun">Rerun my bracket</button>${hint("Replaces your ballot. The log will say you did.")}</div>`;
      mine = `<div class="ballot">
        <p class="kicker-sm">Your ballot</p>
        <ol class="ballot-list">${order.map((id, i) => `<li><b>${i + 1}</b><span>${esc(byId[id].name)}</span><i>${byId[id].seed} seed</i></li>`).join("")}</ol>
        ${rerun}
      </div>`;
    }
    el.innerHTML = mine + familyStandings(byId);
  }

  function familyStandings(byId) {
    const fam = (shared.trip.bracket) || br.family;
    const status = fam.status || {};
    const done = travelers.filter((t) => status[t.id] && status[t.id].complete);
    const waiting = travelers.filter((t) => !(status[t.id] && status[t.id].complete));
    const line = done.length === travelers.length ? "Every ballot is in." : `${done.length} of ${travelers.length} ballots in.${waiting.length ? ` Waiting on ${waiting.map((t) => t.name).join(waiting.length === 2 ? " and " : ", ")}.` : ""}`;
    if (!fam.order || !fam.order.length) {
      return `<div class="family-order"><p class="kicker-sm">The family's order</p><p class="muted">${esc(line)} Until a ballot is finished, the week runs on the pitch order.</p></div>`;
    }
    const head = travelers.map((t) => `<th title="${esc(t.name)}">${esc(t.name[0])}</th>`).join("");
    const rows = fam.order.map((row, i) => `<tr class="${row.protected ? "champ" : ""}${i === 12 ? " must-see-line" : ""}">
      <td class="n">${i + 1}</td><td class="name">${row.protected ? '<span class="star" aria-label="champion">✦</span> ' : ""}${esc(byId[row.id] ? byId[row.id].name : row.id)}</td>
      ${travelers.map((t) => `<td class="r">${row.ranks[t.id] || "–"}</td>`).join("")}<td class="avg">${row.mean.toFixed(1)}</td></tr>`).join("");
    return `<div class="family-order">
      <p class="kicker-sm">The family's order</p>
      <p class="ballots-in">${esc(line)}</p>
      <div class="table-wrap"><table class="fam-table"><thead><tr><th>#</th><th>Thing</th>${head}<th>Avg</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${hint("✦ A champion: somebody's number one, locked to the top. Lower average is better; ties go to the seed. The top thirteen are the must-see things; the planner schedules in this order.")}
    </div>`;
  }

  async function bracketPost(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body || {}) });
    let data = null; try { data = await res.json(); } catch (_) {}
    if (res.status === 401) { location.href = (data && data.signin) || "/family"; return null; }
    if (!res.ok) { toast((data && data.error) || "That didn't take."); if (data && data.picks) { br.picks = data.picks; renderBracket(); } return null; }
    return data;
  }

  async function bracketPick(game, winner) {
    const data = await bracketPost("/api/bracket/pick", { game, winner });
    if (!data) return;
    br.picks = data.picks; br.family = data.family;
    shared = { ...shared, trip: data.trip, decisions: data.decisions }; adoptShared();
    const st = data.family.status[me.id];
    render();
    if (st && st.complete) {
      const champ = (br.contenders.find((c) => c.id === st.champion) || {}).name || "";
      toast(`Ballot in. ${champ} is your champion.`);
      const mine = (data.unlocked || []).filter((u) => u.scope === "trip" || u.traveler === me.id);
      if (mine.length) setTimeout(() => toast(`Achievement unlocked: ${mine.map((u) => u.name).join(", ")}`), 4200);
    }
  }

  async function bracketReset() {
    const data = await bracketPost("/api/bracket/reset", {});
    if (!data) return;
    brConfirm = false;
    br.picks = {}; br.family = data.family;
    shared = { ...shared, trip: data.trip, decisions: data.decisions }; adoptShared();
    render();
  }

  $("bracket-body").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { bracketPick(pick.dataset.game, pick.dataset.pick); return; }
    const b = e.target.closest("[data-bracket]"); if (!b) return;
    const k = b.dataset.bracket;
    if (k === "rerun" || k === "restart") { brConfirm = true; if (k === "restart") { bracketReset(); return; } renderBracket(); }
    else if (k === "keep") { brConfirm = false; renderBracket(); }
    else if (k === "reset") bracketReset();
  });

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
        const startMoved = next.cfg.start && next.cfg.start !== shared.trip.start, nightsMoved = next.cfg.nights != null && next.cfg.nights !== shared.trip.nights;
        const n = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, c.nights));
        if (startMoved && nightsMoved) intent = { type: "set_trip", start: c.start, nights: n };
        else if (startMoved) intent = { type: "set_dates", start: c.start };
        else if (nightsMoved) intent = { type: "set_nights", nights: n };
        else if (next.user && next.user.reset) intent = { type: "reset", start: DEFAULT.start, nights: DEFAULT.nights };
        if (!intent) { render(); return; }
        send(intent, false).then((r) => {
          if (r.ok && r.preview) {
            pending = { kind: "confirm", intent, messages: [...r.preview.messages, ...r.preview.notes],
              title: intent.type === "set_nights" ? `${intent.nights} nights: ${r.preview.label}.` : intent.type === "set_dates" ? `Arriving ${fmtDMD(parseISO(intent.start))}: ${r.preview.label}.` : intent.type === "set_trip" ? `Leave ${fmtDMD(addDays(parseISO(intent.start), -1))}, home ${fmtDMD(addDays(parseISO(intent.start), intent.nights + 1))}: ${r.preview.label}.` : "Back to the recommended trip.",
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
    const all = (trophies.byTraveler[me.id] || []).map((id) => defs[id]).filter(Boolean);
    const mine = all.filter((d) => !d.track);
    const cards = all.filter((d) => d.track === "scouts");
    const cardTotal = trophies.defs.filter((d) => d.track === "scouts" && d.only === me.id).length;
    const musts = Object.entries((shared.trip.preferences || {})[me.id] || {}).filter(([, c]) => c === "must").map(([v]) => (C.venues.find((x) => x.id === v) || {}).name).filter(Boolean);
    const doneMine = C.headlines.filter((h) => (user.completed || {})[h]).length;
    const standings = travelers.map((t) => ({ t, n: (trophies.byTraveler[t.id] || []).filter((id) => !(defs[id] || {}).track).length })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name));
    const samCards = (trophies.byTraveler.sam || []).filter((id) => (defs[id] || {}).track === "scouts").length;
    const samTotal = trophies.defs.filter((d) => d.track === "scouts" && d.only === "sam").length;
    const bartFirst = standings[0] && standings[0].t.is_admin;
    $("trophies-body").innerHTML = `
      <div class="mine"><p class="kicker-sm">${esc(me.name)}'s Washington</p>
        <p><b>${mine.length}</b> ${mine.length === 1 ? "achievement" : "achievements"} · <b>${doneMine}</b> of ${C.headlines.length} must-see things done${musts.length ? ` · must do: ${esc(musts.join(", "))}` : ""}</p>
        ${mine.length ? `<ul class="trophy-list">${mine.map((d) => `<li><b>${esc(d.name)}</b> <span>${esc(d.description)}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing yet. Go see something.</p>`}
        ${cardTotal ? `<p class="kicker-sm cards-head">Blue cards · ${cards.length} of ${cardTotal} · <a href="/family/scouts" class="cards-map">the map</a></p>
        ${cards.length ? `<ul class="trophy-list cards">${cards.map((d) => `<li><b>${esc(d.name)}</b> <span>${esc(d.description)}</span> <i class="badge-req">${esc(d.badge || "")}</i></li>`).join("")}</ul>` : `<p class="muted">Each one is a merit badge requirement a stop on this trip satisfies. Mark the stop done and it files itself.</p>`}` : ""}
      </div>
      <div class="standings"><p class="kicker-sm">Current standings</p>
        <ol>${standings.map((s) => `<li><span>${esc(s.t.name)}</span><b>${s.n}</b></li>`).join("")}</ol>
        ${!bartFirst && standings.length ? `<p class="muted">Bart has appealed the results.</p>` : ""}
        ${trophies.group.length ? `<p class="muted">Trip: ${trophies.group.map((id) => (defs[id] || {}).name).filter(Boolean).join(", ")}</p>` : ""}
        ${samTotal && me.id !== "sam" ? `<p class="muted">Sam's blue cards: ${samCards} of ${samTotal}. They don't count here. <a href="/family/scouts">The map.</a></p>` : ""}
      </div>`;
  }

  async function fetchLive() {
    if (!shared) return;
    try {
      const [t, a, bk] = await Promise.all([fetch("/api/today"), signedIn() ? fetch("/api/achievements") : Promise.resolve(null), signedIn() ? fetch("/api/bracket") : Promise.resolve(null)]);
      live = t.ok ? await t.json() : null;
      trophies = a && a.ok ? await a.json() : null;
      br = bk && bk.ok ? await bk.json() : null;
    } catch (_) { live = null; trophies = null; br = null; }
  }

  /* ───────────── Who's here, what's been decided ───────────── */

  // The role banner: who you are, and one sentence on what you can change.
  function renderIdentity() {
    const el = $("identity");
    if (!shared && !hasWorker) { el.hidden = true; return; }
    el.hidden = false;
    if (me && isAdmin()) el.innerHTML = `<span class="who">You're <b>${esc(me.name)}</b>, ${esc(me.role)}.</span><span class="can">You can change dates and nights, override any vote, and do everything the others can.</span>`;
    else if (me) el.innerHTML = `<span class="who">You're <b>${esc(me.name)}</b>, ${esc(me.role)}.</span><span class="can">Vote on anything, mark things done, move things to another day. Dates and nights are Bart's.</span>`;
    else if (signinWhy) el.innerHTML = `<span class="who">Signed in, but not on the trip.</span><span class="can">${esc(signinWhy)}. Bart can fix the address in the family list.</span>`;
    else el.innerHTML = `<span class="who">This is the pitch.</span><span class="can">The family votes with a bracket, and the week follows the vote.</span> <a href="/family" class="signin">Family, sign in</a>`;
  }

  // One explainer, four points, pacing first. Signed-in, before the trip, dismissable once.
  function renderExplainer(p) {
    const el = $("explainer");
    let seen = false; try { seen = localStorage.getItem("dc.explained") === "1"; } catch (_) {}
    el.hidden = !(shared && signedIn() && (p.phase === "before" || p.phase === "plan") && !seen);
  }

  // The log. Tap an entry to open it: who did it, who's weighed in, and a place for your own take.
  let openDecision = null; // id of the entry currently open
  const STANCE = { fine: "Fine by me", object: "I object" };

  function takeLine(o) {
    return `<li class="${o.stance}"><b>${esc(o.name)}</b>: ${esc(STANCE[o.stance] || o.stance)}${o.note ? ` <q>${esc(o.note)}</q>` : ""}</li>`;
  }

  function renderDecisions() {
    const wrap = $("decisions-wrap");
    if (!shared || !shared.decisions || !shared.decisions.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const fmt = (iso) => { const d = new Date(iso); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; };
    const quip = (d) => {
      const ops = d.opinions || [];
      if (!ops.length) return "No objections filed.";
      const objs = ops.filter((o) => o.stance === "object"), fine = ops.filter((o) => o.stance === "fine");
      const parts = [];
      if (objs.length) parts.push(`${objs.map((o) => o.name).join(" and ")} object${objs.length === 1 ? "s" : ""}.`);
      if (fine.length) parts.push(`${fine.map((o) => o.name).join(" and ")}: fine.`);
      return parts.join(" ");
    };
    $("decisions").innerHTML = shared.decisions.map((d) => {
      const open = openDecision === d.id;
      return `<li data-decision="${d.id}"><button type="button" class="log-entry" data-log="${d.id}" aria-expanded="${open}"><span class="when">${esc(fmt(d.at))}</span> ${esc(d.summary)} <em class="quip">${esc(quip(d))}</em></button>${open ? logOpen(d, fmt) : ""}</li>`;
    }).join("");
  }

  function logOpen(d, fmt) {
    const ops = d.opinions || [];
    const mine = me ? ops.find((o) => o.traveler === me.id) : null;
    const takes = ops.length ? `<ul class="takes">${ops.map(takeLine).join("")}</ul>` : `<p class="hint">Nobody has weighed in on this one.</p>`;
    let form = "";
    if (me) {
      form = `<div class="opine">
        <span class="kicker-sm">Your take</span>
        <div class="unit-controls">
          <button type="button" class="ctl${mine && mine.stance === "fine" ? " on" : ""}" data-opine="fine" data-decision="${d.id}">${STANCE.fine}</button>
          <button type="button" class="ctl${mine && mine.stance === "object" ? " on" : ""}" data-opine="object" data-decision="${d.id}">${STANCE.object}</button>
          ${mine ? `<button type="button" class="ctl" data-opine="" data-decision="${d.id}">Withdraw</button>` : ""}
        </div>
        <input class="opine-note" type="text" maxlength="200" placeholder="Say why, if you want" value="${esc(mine ? mine.note : "")}" data-note="${d.id}" aria-label="Why">
        <span class="hint">Filed with your name on it. It doesn't change the trip; it tells ${esc(d.who)} how you feel about it.</span>
      </div>`;
    } else {
      form = `<p class="hint">Family, sign in to weigh in.</p>`;
    }
    return `<div class="log-open">
      <span class="who">${esc(d.who)} · ${esc(fmt(d.at))}</span>
      ${takes}
      ${form}
    </div>`;
  }

  async function opine(id, stance) {
    const noteEl = document.querySelector(`.opine-note[data-note="${id}"]`);
    const note = noteEl ? noteEl.value : "";
    const res = await fetch("/api/opinion", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ decision: id, stance, note }) });
    let body = null; try { body = await res.json(); } catch (_) {}
    if (res.status === 401) { location.href = (body && body.signin) || "/family"; return; }
    if (!res.ok) { toast((body && body.error) || "That didn't take."); return; }
    shared.decisions = body.decisions; renderDecisions();
    toast(stance ? `Filed: ${STANCE[stance]}.` : "Withdrawn.");
  }

  $("decisions").addEventListener("click", (e) => {
    const entry = e.target.closest("[data-log]");
    if (entry) { const id = Number(entry.dataset.log); openDecision = openDecision === id ? null : id; renderDecisions(); return; }
    const op = e.target.closest("[data-opine]");
    if (op) opine(Number(op.dataset.decision), op.dataset.opine);
  });
  $("decisions").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".opine-note")) {
      const id = Number(e.target.dataset.note);
      const d = (shared.decisions || []).find((x) => x.id === id);
      const mine = d && me ? (d.opinions || []).find((o) => o.traveler === me.id) : null;
      opine(id, mine ? mine.stance : "fine");
    }
  });

  /* ───────────── Talking to the Worker ───────────── */

  let hasWorker = false; // a Worker answered, even if we're anonymous

  async function fetchShared() {
    try {
      const m = await fetch("/api/me", { headers: { accept: "application/json" }, redirect: "manual" });
      let mj = null; try { mj = m.ok ? await m.json() : null; } catch (_) {}
      hasWorker = m.ok || m.type === "opaqueredirect" || m.status === 401 || m.status === 403;
      me = mj && mj.traveler ? mj.traveler : null; travelers = (mj && mj.travelers) || [];
      signinWhy = mj && !mj.traveler && mj.why && mj.why !== "not_signed_in" ? mj.why : null;
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
        <span class="seg train"><i class="grip" aria-hidden="true">⋮</i></span><span class="seg nights"><span class="lbl">Your trip · </span>${p.nights}<span class="unit"> ${p.nights === 1 ? "night" : "nights"}</span></span><span class="seg train"><i class="grip" aria-hidden="true">⋮</i></span></div>`;
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
    document.addEventListener("visibilitychange", async () => { if (!document.hidden && shared && !whatIf && !pending && await fetchShared()) { adoptShared(); await fetchLive(); render(); } });
  })();
  $("whatif-back").addEventListener("click", () => { pending = null; adoptShared(); whatIf = false; render(); });
  // Leave home and back home. The train eats both travel days: nights = home − leave − 2.
  function datesChanged() {
    const leave = parseISO($("cfg-leave").value), home = parseISO($("cfg-home").value);
    if (!leave || !home) return;
    const nights = Math.round((home - leave) / 86400000) - 2;
    if (nights < MIN_NIGHTS || nights > MAX_NIGHTS) { toast(nights < MIN_NIGHTS ? `That's ${nights < 1 ? "no" : nights} hotel ${nights === 1 ? "night" : "nights"}. Both travel days are the train's; it needs at least ${MIN_NIGHTS}.` : `That's ${nights} hotel nights. ${MAX_NIGHTS} is the most this planner will do.`); render(); return; }
    update({ cfg: { start: iso(addDays(leave, 1)), nights } });
  }
  $("cfg-leave").addEventListener("change", datesChanged);
  $("cfg-home").addEventListener("change", datesChanged);
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
      const after = P.plan(cfg, trial, prevPlan, ext());
      if (!after.placements[unit.id]) {
        await send(intent, true);
        pending = { kind: "options", name: unit.name, id: ids[0], anchor: unit.id, options: P.fitOptions(cfg, user, ids[0], prevPlan, ext()) }; renderPanel(); return;
      }
    }
    if (action === "unpin" && ids.some((id) => user.requested.includes(id))) intent.backTo = "requested";
    if (action === "ask" && unit) {
      // Would it land? Ask the planner locally first so the options panel can offer the trades.
      const after = P.plan(cfg, nextUser("ask", ids), prevPlan, ext());
      if (!after.placements[unit.id]) { pending = { kind: "options", name: unit.name, id: ids[0], anchor: unit.id, options: P.fitOptions(cfg, user, ids[0], prevPlan, ext()) }; renderPanel(); return; }
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
    const after = P.plan(cfg, u, before, ext());
    const unit = Object.values(after.units).find((x) => x.members.some((m) => ids.includes(m)));
    if (action === "ask" && unit && !after.placements[unit.id]) {
      pending = { kind: "options", name: unit.name, id: ids[0], anchor: unit.id, options: P.fitOptions(cfg, user, ids[0], before, ext()) };
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
    if (a === "options") { const u = Object.values(prevPlan.units).find((x) => x.members.includes(ids[0])); pending = { kind: "options", name: u.name, id: ids[0], anchor: u.id, options: P.fitOptions(cfg, user, ids[0], prevPlan, ext()) }; renderPanel(); return; }
    if (a === "explained") { try { localStorage.setItem("dc.explained", "1"); } catch (_) {} $("explainer").hidden = true; return; }
    act(a, ids);
  });
  if (!isDefault()) $("change").open = true;
})();

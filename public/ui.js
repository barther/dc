/*
 * DC Trip Planner — renderer and controls.
 *
 * Takes a plan from DCPlanner and turns it into the page. Owns the user's
 * trip-design state (dates, nights, punts, pins) and keeps it in the URL hash
 * so a configured trip can be sent around. Live-trip state (completed,
 * weather) is deliberately not part of that.
 */
(function () {
  "use strict";

  const P = window.DCPlanner, C = window.DCVenues;
  const { DEFAULT, MIN_NIGHTS, MAX_NIGHTS, WORK, TRAIN, parseISO, iso, addDays, fmtMD, fmtDMD, fmtDMDY, DOW, MON } = P;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const loadBadge = (load) => `<i class="load ${load}">${load.toUpperCase()}</i>`;

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

  function unitControls(u) {
    if (!u) return "";
    const ids = u.members.join(",");
    const state = u.pinned ? `<span class="ctl-state">✦ Must-do</span>` : u.requested ? `<span class="ctl-state">Added by you</span>` : "";
    const pin = u.pinned
      ? `<button type="button" class="ctl" data-act="unpin" data-ids="${ids}" title="Back to an ordinary recommendation">Relax</button>`
      : `<button type="button" class="ctl" data-act="pin" data-ids="${ids}" title="Protect this from ordinary cuts">Must-do</button>`;
    const off = u.requested && !u.pinned
      ? `<button type="button" class="ctl" data-act="unask" data-ids="${ids}" title="Back to the board">Remove</button>`
      : `<button type="button" class="ctl" data-act="punt" data-ids="${ids}" title="Take this off the trip">Punt</button>`;
    return `<span class="unit-controls">${state}${pin}${off}</span>`;
  }

  // Ranked suggestions for an open slot. Recommended, never imposed.
  function suggestions(d, slot) {
    const list = d.suggest && d.suggest[slot];
    if (!list || !list.length) return "";
    return `<div class="suggest"><span class="suggest-head">${slot === "day" ? "Best additions" : "Or, after dark"}</span>
      ${list.map((x) => `<button type="button" class="ctl suggest-btn" data-act="ask" data-ids="${x.id}"><em>#${x.seed}</em> ${esc(x.name)}${x.shortened ? ", shortened" : ""}</button>`).join("")}
      <span class="suggest-or">or leave it open.</span></div>`;
  }

  function figure(photo, cls) {
    return photo ? `<figure class="${cls}"><img class="photo" src="/img/${photo[0]}" alt="${esc(photo[1])}" loading="lazy"><figcaption>${esc(photo[1])}</figcaption></figure>` : "";
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
    if (du && !nu) body.push(du.load === "hi" ? "Then dinner, the hotel, and nothing. That's the plan, not a gap in it." : "Dinner. Nothing scheduled after.");
    const featured = (dc && dc.featured) || (nc && nc.featured);
    const photo = (dc && dc.photo) || (nc && nc.photo) || null;
    const dayHalf = du ? { label: du.short, load: du.load } : C.structural.open;
    const nightHalf = nu ? { label: nu.short, load: nu.load } : C.structural.rest;
    return card(d, title, body, photo, halves(dayHalf, nightHalf), featured, false,
      (du ? `<div class="ctl-row"><span>Day</span>${unitControls(du)}</div>` : suggestions(d, "day")) + (nu ? `<div class="ctl-row"><span>Night</span>${unitControls(nu)}</div>` : (du && du.load !== "hi" ? suggestions(d, "night") : "")));
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
      `<div class="ctl-row"><span>Morning</span>${unitControls(du)}</div>`);
  }

  function card(d, title, body, photo, halvesHtml, featured, late, controls) {
    const cls = ["stop", featured ? "featured" : "", d.kind === "home" ? "last" : "", late ? "late" : ""].filter(Boolean).join(" ");
    return `<li class="${cls}"><div class="stop-date"><b>${DOW[d.date.getDay()]}</b><span>${fmtMD(d.date)}</span></div>
      <div class="stop-body"><h3>${esc(title)}</h3>${figure(photo, "stop-photo")}${body.map((t) => `<p>${esc(t)}</p>`).join("")}${halvesHtml}${controls}</div></li>`;
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
    const row = (u) => {
      const ex = p.excluded.find((e) => e.unit.id === u.id);
      const note = u.pinned ? `<em class="bench-note">Marked must-do, but there's ${ex ? ex.why : "no room"}.</em>`
        : u.requested ? `<em class="bench-note">Doesn't fit without changing the current trip. <button type="button" class="link" data-act="options" data-ids="${u.members[0]}">See the options</button></em>` : "";
      const btn = u.pinned
        ? `<button type="button" class="ctl" data-act="unpin" data-ids="${u.members.join(",")}">Let it go</button>`
        : u.requested
        ? `<button type="button" class="ctl" data-act="unask" data-ids="${u.members.join(",")}">Never mind</button>`
        : `<button type="button" class="ctl" data-act="ask" data-ids="${u.members.join(",")}">Add to trip</button>`;
      return `<li><span class="bench-meta">#${u.seed} · ${u.load.toUpperCase()} · ${u.period.toUpperCase()}</span><span class="bench-name">${esc(u.name)}${note}</span>${btn}</li>`;
    };
    const puntRow = (v) => `<li class="punted"><span class="bench-meta">#${v.seed} · ${v.load.toUpperCase()} · ${v.period.toUpperCase()}</span><span class="bench-name">${esc(v.name)}</span><button type="button" class="ctl" data-act="unpunt" data-ids="${v.id}">Bring back</button></li>`;
    $("bench").innerHTML = units.map(row).join("") || `<li class="empty">Everything on the board is in the trip.</li>`;
    $("punted-wrap").hidden = !puntedVenues.length;
    $("punted").innerHTML = puntedVenues.map(puntRow).join("");
  }

  /* ───────────── Page ───────────── */

  function render() {
    const p = P.plan(cfg, user, prevPlan);
    const s = P.summarize(p);
    prevPlan = p;

    // Hero
    $("eyebrow-dates").innerHTML = `${esc(fmtDMD(p.trainOut))} → ${esc(fmtDMDY(p.home))}`.replace(/ /g, "&nbsp;");
    const NW = ["", "One night", "Two nights", "Three nights", "Four nights", "Five nights", "Six nights", "Seven nights", "Eight nights", "Nine nights", "Ten nights"];
    $("lede-nights").textContent = NW[p.nights] || `${p.nights} nights`;
    window.DCTrip = { depart: p.trainOut, arrive: new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate(), 14, 12), home: new Date(p.home.getFullYear(), p.home.getMonth(), p.home.getDate(), 10, 30) };
    window.dispatchEvent(new CustomEvent("trip:change"));

    $("cfg-nights").textContent = String(p.nights);
    $("cfg-minus").disabled = p.nights <= MIN_NIGHTS;
    $("cfg-plus").disabled = p.nights >= MAX_NIGHTS;
    $("cfg-reset").hidden = isDefault();
    const warn = s.label === "A different kind of trip" || s.label === "These dates don't work" || s.label === "Runs into work";
    $("verdict").innerHTML = [`<b>${p.nights} ${p.nights === 1 ? "night" : "nights"}</b>`, `<span class="verdict-label${warn ? " warn" : ""}">${esc(s.label)}</span>`, `<span>${esc(s.count)}</span>`].join('<span class="sep">·</span>');
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

    // Week
    const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
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
    $("canon-note").textContent = kept === total ? "All on the schedule." : `${kept} of thirteen on this version. The rest are marked.`;

    // Bench + footer
    renderBench(p);
    $("foot-dates").textContent = `${fmtMD(p.trainOut)} – ${fmtMD(p.home)}, ${p.home.getFullYear()}`;
  }

  function update(next, live) {
    if (next.cfg) cfg = { ...cfg, ...next.cfg };
    if (next.user) user = { punted: [...(next.user.punted || [])], pinned: [...(next.user.pinned || [])], requested: [...(next.user.requested || [])] };
    cfg.nights = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, cfg.nights));
    if (!live) writeHash();
    render();
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
        <span class="seg train"></span><span class="seg nights">${p.nights} ${p.nights === 1 ? "night" : "nights"}</span><span class="seg train"></span></div>`;
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

  readHash();
  render();
  $("cfg-minus").addEventListener("click", () => update({ cfg: { nights: cfg.nights - 1 } }));
  $("cfg-plus").addEventListener("click", () => update({ cfg: { nights: cfg.nights + 1 } }));
  $("cfg-reset").addEventListener("click", () => { pending = null; renderPanel(); update({ cfg: { ...DEFAULT }, user: { punted: [], pinned: [], requested: [] } }); });

  /* ───────────── Actions: preview first, then apply or ask ───────────── */

  function nextUser(act, ids) {
    const u = { punted: user.punted.filter((id) => !ids.includes(id)), pinned: user.pinned.filter((id) => !ids.includes(id)), requested: user.requested.filter((id) => !ids.includes(id)) };
    if (act === "punt") u.punted.push(...ids);
    if (act === "pin") u.pinned.push(...ids);
    if (act === "ask") u.requested.push(...ids);
    if (act === "unpin" && ids.some((id) => user.requested.includes(id))) u.requested.push(...ids); // relax back to requested
    return u;
  }

  function renderPanel() {
    const el = $("panel");
    if (!pending) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    if (pending.kind === "confirm") {
      el.innerHTML = `<p class="panel-head">${esc(pending.title)}</p>
        <ul class="panel-list">${pending.messages.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
        <div class="panel-actions"><button type="button" class="ctl on" data-panel="go">${esc(pending.go)}</button><button type="button" class="ctl" data-panel="no">Don't make this change</button></div>`;
    } else {
      el.innerHTML = `<p class="panel-head">${esc(pending.name)} doesn't fit without changing the current trip.</p>
        ${pending.options.length ? `<p class="panel-sub">Best options:</p>` : `<p class="panel-note">At this length, every trade would go to something we rank higher. Mark it must-do on a day if it matters more than that, or add nights.</p>`}
        <div class="panel-actions vertical">
          ${pending.options.map((o, i) => `<button type="button" class="ctl" data-panel="opt" data-i="${i}">${esc(o.label)}</button>`).join("")}
          <button type="button" class="ctl" data-panel="board">Leave it on the board</button>
        </div>`;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function act(action, ids) {
    pending = null;
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
      pending = { kind: "options", name: unit.name, id: ids[0], options: P.fitOptions(cfg, user, ids[0], before) };
      renderPanel(); return;
    }
    const d = P.diff(before, after, ids);
    if (d.consequential) {
      const cutsCore = d.cutHeadlines.length || d.cutProtected.length || d.identityChanged;
      pending = { kind: "confirm", user: u, messages: d.messages.concat(d.notes),
        title: d.identityChanged ? "This changes the kind of trip." : cutsCore ? `To keep ${unit ? unit.name : "this"}, something has to give.` : d.newAvoid.length ? "This makes a day harder." : "This changes more than one day.",
        go: cutsCore && unit ? `Keep ${unit.name}${d.cutHeadlines.length ? `, drop ${d.cutHeadlines[0]}` : ""}` : "Continue anyway" };
      renderPanel(); return;
    }
    update({ user: u });
    if (d.notes.length) { $("tradeoffs-wrap").hidden = false; $("tradeoffs").insertAdjacentHTML("afterbegin", d.notes.map((n) => `<li>${esc(n)}</li>`).join("")); }
    $("week").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("click", (e) => {
    const pb = e.target.closest("button[data-panel]");
    if (pb) {
      const k = pb.dataset.panel;
      if (k === "go" && pending) { const u = pending.user; pending = null; renderPanel(); update({ user: u }); }
      else if (k === "opt" && pending) {
        const o = pending.options[+pb.dataset.i]; const id = pending.id; pending = null; renderPanel();
        if (o.kind === "night") update({ cfg: { nights: cfg.nights + 1 }, user: nextUser("ask", [id]) });
        else update({ user: { ...nextUser("ask", [id]), punted: [...user.punted.filter((x) => !o.members.includes(x)), ...o.members] } });
        $("week").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      else if (k === "board" && pending) { const id = pending.id; pending = null; renderPanel(); update({ user: nextUser("ask", [id]) }); }
      else { pending = null; renderPanel(); }
      return;
    }
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const ids = b.dataset.ids.split(","), a = b.dataset.act;
    if (a === "options") { pending = { kind: "options", name: prevPlan.units[Object.values(prevPlan.units).find((x) => x.members.includes(ids[0])).id].name, id: ids[0], options: P.fitOptions(cfg, user, ids[0], prevPlan) }; renderPanel(); return; }
    act(a, ids);
  });
  if (!isDefault()) $("change").open = true;
})();

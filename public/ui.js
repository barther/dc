/*
 * Inside the gate — the family's page at /family.
 *
 * Less is more. Sign in, fill in your bracket. Nothing is scheduled until your
 * ballot is done; then your week appears, built from your ranking by the house
 * rules. The family's week is built the same way from everyone's ballots, and it
 * is the trip: during the trip that's where things get marked done. No log, no
 * ideas, no skips, no recommended trip. The Worker still runs the same planner
 * on the same order, so what you see here is what it persists.
 *
 * The public pitch at / is pitch.js.
 */
(function () {
  "use strict";

  const B = window.DCBracket;
  const $ = (id) => document.getElementById(id);
  const cityId = (document.cookie.match(/(?:^|;\s*)city=(\w+)/) || [])[1] === "nyc" && window.DCVenuesNYC ? "nyc" : "dc";
  const C = cityId === "nyc" ? window.DCVenuesNYC : window.DCVenues;
  const P = window.DCPlanner.withCatalog(C);
  const { DEFAULT, MIN_NIGHTS, MAX_NIGHTS, WORK, TRAIN, parseISO, iso, addDays, fmtMD, fmtDMD, fmtDMDY, DOW } = P;
  const city = C.city, N = city.narrative;
  document.body.dataset.city = cityId;
  document.querySelectorAll("[data-city-pick]").forEach((b) => { b.classList.toggle("on", b.dataset.cityPick === cityId); b.setAttribute("aria-pressed", String(b.dataset.cityPick === cityId)); });
  document.querySelector(".city-switch").addEventListener("click", (e) => { const b = e.target.closest("[data-city-pick]"); if (!b || b.dataset.cityPick === cityId) return; document.cookie = `city=${b.dataset.cityPick}; path=/; max-age=31536000; samesite=lax`; location.reload(); });
  document.title = `${city.title[0]} ${city.title[1]} · inside`;
  $("hero-title").innerHTML = `${city.title[0]} <em>${city.title[1]}</em>`;
  document.querySelectorAll(".city-name").forEach((el) => { el.textContent = city.name; });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const LOAD_NAME = { lo: "Easy", mid: "Real", hi: "Big" };
  const loadBadge = (load) => `<i class="load ${load}">${LOAD_NAME[load] || load}</i>`;
  const hint = (text) => `<span class="hint">${esc(text)}</span>`;
  const list = (names) => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + (names.length > 2 ? "," : "") + " and " + names[names.length - 1];

  /* Narrative for the structural days. Trip prose, not venue data. */
  const NARRATIVE = {
    train: (early) => ({
      title: early > 0 ? "All aboard. Except Bart's at work." : "All aboard.",
      body: [early > 0
        ? `Bart works until ${WORK.offLabel}, so this train leaves ${early === 1 ? "a day" : `${early} days`} before he can. Push the leave date later.`
        : early === 0
        ? "Bart clocks out at 2:00, we load up, drive to Anniston, eat, and climb onto the Crescent. Nothing to accomplish tonight except finding the bunks and watching Alabama slide by in the dark."
        : "Load up, drive to Anniston, eat, and climb onto the Crescent. Nothing to accomplish tonight except finding the bunks and watching Alabama slide by in the dark."],
      day: { label: "Pack and drive", load: "lo" }, night: { label: "The train is the activity", load: "lo" },
      photo: ["day-1128-anniston-station.webp", "Anniston station at boarding time"],
    }),
    arrival: { title: N.arrivalTitle, body: [N.arrivalBody], photo: N.arrivalPhoto || null },
    departureTail: N.departureTail,
    departureEmpty: { title: "Last morning, then home.", body: [N.lastMorning], day: { label: "A slow last morning", load: "lo" } },
    open: {
      title: "Open day.",
      body: ["Nothing scheduled, on purpose. Whitespace is part of the itinerary."],
    },
    home: (p) => {
      const { status, buffer } = p.work;
      const body = status === "ok"
        ? `Get the car, go home, and do absolutely nothing. ${buffer === 2 ? "Two full days" : `${buffer} days`} at home before Bart is back at work ${WORK.label}. That's part of the plan, not wasted vacation.`
        : status === "thin"
        ? `Get the car, go home, and do absolutely nothing. One day at home before Bart is back at work ${WORK.label}. Tight, but it works.`
        : status === "tight"
        ? "Get the car and go straight home, because Bart is due at work at 2 PM the same day. The Crescent gets in around 10:30 if it's on time. It is not always on time."
        : `This version gets home ${-buffer === 1 ? "a day" : `${-buffer} days`} after Bart was due back at work (${WORK.label}). Leave earlier or come home sooner.`;
      return {
        title: status === "late" ? "Anniston, ~10:30 AM. Late for work." : status === "tight" ? "Anniston, ~10:30 AM. Work at 2." : "Anniston, ~10:30 AM.",
        body: [body], late: status === "late" || status === "tight", photo: ["day-1207-home.webp", "Home."],
      };
    },
  };

  /* ───────────── State ───────────── */

  let shared = null;    // { trip, today } from the Worker
  let me = null;        // signed-in traveler, or null
  let signinWhy = null; // why a sign-in did not map to a traveler
  let travelers = [];
  let today = null;
  let live = null;      // /api/today: weather, fits, suggestion
  let trophies = null;  // /api/achievements
  let br = null;        // /api/bracket: contenders, structure, my picks, the family's standing
  let brConfirm = false;
  let familyPlan = null; // the family's plan, for live actions
  const signedIn = () => !!me;
  const isAdmin = () => !!(me && me.is_admin);
  const inside = () => !!(shared && signedIn());

  const cfg = () => ({ start: shared.trip.start, nights: shared.trip.nights });
  const userState = () => { const pl = shared.trip.planner; return { punted: [...pl.punted], pinned: [...pl.pinned], requested: [...pl.requested], completed: pl.completed || {}, fixed: pl.fixed || {}, notThisDay: pl.notThisDay || {} }; };
  // A week from an order: the same planner the Worker runs, told who ranked what.
  const planFrom = (order, champions, prev, whose) => { const p = P.plan(cfg(), userState(), prev || null, { today, familyRank: order, champions }); p.champions = whose || {}; return p; };

  /* ───────────── Day cards ───────────── */

  const unitCopy = (u) => C.copy[u.id] || { title: u.name, body: [] };
  // A champion on this week: somebody's number one, locked to the top. The red rule and the mark say whose.
  function champion(p, u) {
    if (!u || u.tier !== "protected" || !p.champions) return null;
    const names = p.champions[u.id]; if (!names || !names.length) return null;
    return names[0] === "you" ? "Your champion" : `${names.join(" and ")}'s champion`;
  }
  function halves(day, night) {
    const h = (slot, x) => `<div class="half${slot === "night" ? " night" : ""}"><small>${slot === "day" ? "Day" : "Night"}</small>${loadBadge(x.load)}<span>${esc(x.label)}</span></div>`;
    return `<div class="halves">${h("day", day)}${h("night", night)}</div>`;
  }
  function figure(photo, cls, p) {
    if (!photo) return "";
    const done = p && p.phase === "after";
    const src = done ? `/img/done-${photo[0]}` : `/img/${photo[0]}`;
    return `<figure class="${cls}"><img class="photo" src="${src}" ${done ? `data-fallback="/img/${photo[0]}"` : ""} alt="${esc(photo[1])}" loading="lazy"><figcaption>${esc(photo[1])}</figcaption></figure>`;
  }

  // During the trip, on the family's week only: done, or bailed. Nothing else.
  function doneRow(u, d, liveMode) {
    if (!liveMode || !d) return "";
    const ids = u.members.join(","), date = iso(d.date);
    if (u.completedOn) return `<div class="actions"><span class="done-state">✓ Done</span><button type="button" class="ctl" data-act="uncomplete" data-ids="${ids}">Undo</button></div>`;
    if (d.past || d.isToday) return `<div class="actions"><button type="button" class="ctl" data-act="complete" data-ids="${ids}" data-date="${date}">Mark done</button>${d.isToday ? `<button type="button" class="ctl" data-act="bail" data-ids="${ids}" data-date="${date}">We bailed</button>` : ""}</div>`;
    return "";
  }

  // Getting there: the day's legs from the hotel and back, miles and walk or ride. Straight-line, honest about it.
  const MODE = { walk: "walk", ride: "a ride", metro: "Metro", subway: "subway" };
  const mi = (m) => m < 0.95 ? `${Math.max(0.1, Math.round(m * 10) / 10)} mi` : `${m.toFixed(1)} mi`;
  function routeLine(d) {
    const r = d.route; if (!r) return "";
    const legs = r.legs.map((l) => `<span class="leg"><span class="leg-to">${esc(l.to)}</span> <span class="leg-mi">${mi(l.miles)}&nbsp;<span class="leg-mode ${l.mode}">${MODE[l.mode]}</span></span></span>`).join('<span class="leg-arrow">→</span>');
    const sum = `${mi(r.walked)} on foot${r.rides ? `, ${r.rides === 1 ? "one ride" : `${r.rides} rides`}` : ", no rides"}`;
    return `<div class="route"><span class="route-head">Getting there · ${esc(sum)}</span><span class="legs"><span class="leg"><span class="leg-to">Hotel</span></span><span class="leg-arrow">→</span>${legs}</span></div>`;
  }

  function card(p, d, title, body, photo, halvesHtml, featured, late, controls) {
    const cls = ["stop", featured ? "featured" : "", d.kind === "home" ? "last" : "", late ? "late" : "", d.past ? "past" : "", d.isToday ? "today" : ""].filter(Boolean).join(" ");
    return `<li class="${cls}"><div class="stop-date"><b>${DOW[d.date.getDay()]}</b><span>${fmtMD(d.date)}</span>${featured ? `<em class="champ-mark">✦ ${esc(featured)}</em>` : ""}</div>
      <div class="stop-body"><h3>${esc(title)}</h3>${figure(photo, "stop-photo", p)}${body.map((t) => `<p>${esc(t)}</p>`).join("")}${halvesHtml}${d.kind === "full" || d.kind === "departure" ? routeLine(d) : ""}${controls}</div></li>`;
  }

  function renderFull(p, d, liveMode) {
    const du = d.day ? p.units[d.day.id] : null, nu = d.night ? p.units[d.night.id] : null;
    const dc = du ? unitCopy(du) : null, nc = nu ? unitCopy(nu) : null;
    let title, body = [];
    if (du && nu) title = `${cap(dc.title)}, then ${nc.title}.`;
    else if (du) title = `${cap(dc.title)}.`;
    else if (nu) title = `${cap(nc.title)}.`;
    else title = NARRATIVE.open.title;
    if (dc) body.push(...dc.body); if (nc) body.push(...nc.body);
    if (!du && !nu) body.push(NARRATIVE.open.body[0]);
    if (du && !nu) body.push(du.load === "hi" ? "After a Big day, we keep the night empty on purpose." : "Dinner. Nothing scheduled after.");
    const featured = champion(p, du) || champion(p, nu);
    const photo = (dc && dc.photo) || (nc && nc.photo) || null;
    const controls = (du ? doneRow(du, d, liveMode) : "") + (nu ? doneRow(nu, d, liveMode) : "");
    return card(p, d, title, body, photo, halves(du ? { label: du.short, load: du.load } : C.structural.open, nu ? { label: nu.short, load: nu.load } : C.structural.rest), featured, false, controls);
  }

  function renderDeparture(p, d, liveMode) {
    const du = d.day ? p.units[d.day.id] : null;
    if (!du) { const n = NARRATIVE.departureEmpty; return card(p, d, n.title, n.body, null, halves(n.day, C.structural.departure.night), false, false, ""); }
    const c = unitCopy(du);
    const title = d.day.shortened ? `${cap(c.title)}, shortened, then home.` : `${cap(c.title)}, then home.`;
    const body = c.short ? c.short.slice() : [...c.body, NARRATIVE.departureTail];
    return card(p, d, title, body, c.photo || null, halves({ label: d.day.shortened ? `${du.short}, a couple of hours` : du.short, load: d.day.shortened ? "mid" : du.load }, C.structural.departure.night), champion(p, du), false, doneRow(du, d, liveMode));
  }

  // One map of the week: the hotel, every stop, each day's loop. Leaflet on OpenStreetMap tiles,
  // vendored, so it pinches and zooms on a phone. Without the library, the page just has no map.
  const maps = {};
  function weekMap(id, p) {
    const host = $(id); if (!host) return;
    if (maps[id]) { maps[id].remove(); delete maps[id]; }
    host.innerHTML = "";
    if (!window.L) return;
    const geo = C.geo;
    const days = p.days.filter((d) => d.route);
    if (!days.length) return;
    const el = document.createElement("div"); el.className = "week-map"; host.appendChild(el);
    const map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>" }).addTo(map);
    const all = [geo.base.ll];
    for (const d of days) {
      const seq = [geo.base.ll, ...d.route.stops.map((s) => s.ll), geo.base.ll];
      L.polyline(seq, { color: "#1c2a4a", weight: 1.5, opacity: 0.45 }).addTo(map);
      for (const s of d.route.stops) {
        all.push(s.ll);
        const fromHotel = geo.distMi(geo.base.ll, s.ll);
        L.circleMarker(s.ll, { radius: 6, color: "#1c2a4a", weight: 1.5, fillColor: "#f4f1ea", fillOpacity: 1 }).addTo(map)
          .bindPopup(`<b>${esc(s.name)}</b><br>${esc(fmtDMD(d.date))} · ${mi(fromHotel)} from the hotel`);
      }
    }
    L.circleMarker(geo.base.ll, { radius: 7, color: "#a8322c", weight: 2, fillColor: "#a8322c", fillOpacity: 1 }).addTo(map).bindPopup(`<b>The hotel</b><br>${esc(city.hotel)}`);
    map.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
    maps[id] = map;
  }

  function renderWeek(p, liveMode) {
    const out = [];
    const t = NARRATIVE.train(p.work.early);
    out.push(card(p, { date: p.trainOut, kind: "train" }, t.title, t.body, t.photo, halves(t.day, t.night), false, p.work.early > 0, ""));
    for (const d of p.days) {
      if (d.kind === "arrival") { const a = NARRATIVE.arrival; out.push(card(p, d, a.title, a.body, a.photo, halves(C.structural.arrival.day, C.structural.arrival.night), false, false, "")); }
      else if (d.kind === "full") out.push(renderFull(p, d, liveMode));
      else out.push(renderDeparture(p, d, liveMode));
    }
    const h = NARRATIVE.home(p);
    out.push(card(p, { date: p.home, kind: "home" }, h.title, h.body, h.photo, "", false, h.late, ""));
    return out.join("");
  }

  /* ───────────── The page ───────────── */

  function render() {
    document.querySelectorAll("[data-family]").forEach((el) => { el.hidden = !inside(); });
    renderIdentity();
    if (!inside()) { numberSections(); return; }

    const fam = shared.trip.bracket || { familyRank: [], champions: [], status: {}, order: [] };
    const ids = br ? br.contenders.map((c) => c.id) : [];
    const mine = br ? B.ranking(br.structure, ids, br.picks) : null; // null until my ballot is done
    const status = fam.status || {};
    const abstained = (t) => !!(status[t.id] && status[t.id].abstained);
    const iAbstain = !!(me && status[me.id] && status[me.id].abstained);
    const done = travelers.filter((t) => status[t.id] && status[t.id].complete);
    const riders = travelers.filter(abstained);
    const waiting = travelers.filter((t) => !(status[t.id] && status[t.id].complete) && !abstained(t));

    // The family's week is the trip: planned from every finished ballot, or from the seeds until there is one.
    const whose = {}; for (const t of travelers) { const st = status[t.id]; if (st && st.champion) (whose[st.champion] = whose[st.champion] || []).push(t.name); }
    familyPlan = planFrom(fam.familyRank || [], fam.champions || [], { placements: shared.trip.placements || {} }, whose);
    const p = familyPlan;
    const s = P.summarize(p);

    // Header: dates, and whether they collide with work.
    $("eyebrow-dates").innerHTML = `${esc(fmtDMD(p.trainOut))} → ${esc(fmtDMDY(p.home))}`.replace(/ /g, "&nbsp;");

    $("dates-admin").hidden = !isAdmin();
    $("dates-line").hidden = isAdmin();
    if (isAdmin()) {
      $("cfg-leave").value = iso(p.trainOut); $("cfg-home").value = iso(p.home);
      $("cfg-nights").textContent = String(p.nights); $("cfg-nights-word").textContent = p.nights === 1 ? "hotel night" : "hotel nights";
    } else {
      $("dates-line").innerHTML = `Leave home <b>${esc(fmtDMD(p.trainOut))}</b>, back home <b>${esc(fmtDMD(p.home))}</b>. ${p.nights} hotel ${p.nights === 1 ? "night" : "nights"}. Bart's call.`;
    }
    const ws = p.work.early > 0 ? "late" : p.work.status;
    $("verdict-work").textContent = s.work; $("verdict-work").className = "verdict-work " + ws; $("verdict-work").hidden = !s.work;
    $("foot-dates").textContent = `${fmtMD(p.trainOut)} – ${fmtMD(p.home)}, ${p.home.getFullYear()}`;

    renderToday(p);
    renderBracket(mine, iAbstain);

    // Your week: only once your ballot is done, and only from your ballot.
    $("mine").hidden = !mine; $("nav-mine").hidden = !mine;
    if (mine) {
      const my = planFrom(mine, [mine[0]], null, { [mine[0]]: ["you"] });
      $("mine-intro").innerHTML = `Your ranking, packed into ${my.nights} ${my.nights === 1 ? "night" : "nights"}. One <i class="load hi">Big</i> thing a day, and a Big day gets an <i class="load lo">Easy</i> night.${my.headline.kept < my.headline.total ? ` ${my.headline.total - my.headline.kept} of your top thirteen didn't fit.` : ""}`;
      $("line-mine").innerHTML = renderWeek(my, false);
      weekMap("map-mine", my);
    }

    // The family's week: behind your own ballot, built from everyone's.
    const showFamily = (!!mine || iAbstain) && done.length > 0;
    $("week").hidden = !showFamily; $("nav-week").hidden = !showFamily;
    if (showFamily) {
      const allIn = waiting.length === 0;
      $("week-head").textContent = allIn ? "Everyone's ballots, one week." : `${done.length} of ${travelers.length} ballots, one week so far.`;
      const ride = riders.length ? ` ${list(riders.map((t) => t.name))} ${riders.length === 1 ? "is" : "are"} along for the ride.` : "";
      $("week-intro").textContent = allIn
        ? `Every ballot is in. Each thing's place is the average of everyone's rank, champions locked to the top, and the same rules pack it into the nights. This is the trip.${ride}`
        : `Built from ${list(done.map((t) => t.name))}. Waiting on ${list(waiting.map((t) => t.name))}; the week moves when ${waiting.length === 1 ? "that ballot" : "those ballots"} land${waiting.length === 1 ? "s" : ""}.${ride}`;
      $("line").innerHTML = renderWeek(p, p.phase === "live" || p.phase === "after");
      weekMap("map", p);
      renderOrder(fam);
    }

    renderTrophies();
    numberSections();
  }

  function numberSections() {
    const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
    let n = 0;
    document.querySelectorAll("main > section").forEach((sec) => {
      if (sec.hidden) return;
      const k = sec.querySelector("[data-kicker]"); if (!k) return;
      if (!k.dataset.base) k.dataset.base = k.textContent.trim();
      k.innerHTML = `${ROMAN[n++] || n}. &nbsp;${esc(k.dataset.base)}`;
    });
  }

  function renderIdentity() {
    const el = $("identity");
    el.hidden = false;
    if (me) el.innerHTML = `<span class="who">You're <b>${esc(me.name)}</b>, ${esc(me.role)}.</span>`;
    else if (signinWhy) el.innerHTML = `<span class="who">Signed in, but not on the trip.</span><span class="can">${esc(signinWhy)}. Bart can fix the address in the family list.</span>`;
    else el.innerHTML = `<span class="who">Not signed in.</span> <a href="/family" class="signin">Family, sign in</a> <a href="/" class="signin">The pitch</a>`;
  }

  /* ───────────── The bracket ───────────── */

  // What we're in for: every stop, about how long, tickets or not. So nobody misses the White House inside a night.
  const hoursText = (h) => h >= 1 ? `about ${Number.isInteger(h) ? h : h.toFixed(1).replace(/\.0$/, "")} ${h === 1 ? "hour" : "hours"}` : `about ${Math.round(h * 60)} minutes`;
  const TICKETS = { none: "no tickets", recommended: "tickets recommended", required: "timed tickets required" };
  const GO_TEXT = { walk: "a walk", ride: "a ride", metro: "one Metro ride", subway: "the subway" };
  const fromHotel = (c) => c.miles == null ? "" : ` · ${c.miles < 0.95 ? `${(c.miles * 10 | 0) / 10 || 0.1} mi` : `${c.miles.toFixed(1)} mi`} from the hotel, ${GO_TEXT[c.go] || "a ride"}`;

  function inFor(c) {
    const stops = c.stops.map((s) => `<li${s.rides ? ' class="ride"' : ""}><b>${esc(s.name)}</b><span>${s.rides ? `rides along by ${s.period}` : hoursText(s.hours)}</span></li>`).join("");
    return `<div class="in-for"><span class="in-for-head">What we're in for</span><ul class="stops">${stops}</ul>
      <p class="in-for-line">${c.period === "day" ? "A day" : "A night"} · ${LOAD_NAME[c.load]} · ${hoursText(c.hours)} on the ground · ${TICKETS[c.reservation] || TICKETS.none}${fromHotel(c)}</p></div>`;
  }

  function contenderCard(c, game) {
    const cp = C.copy[c.id] || { title: c.name, body: [] };
    return `<button type="button" class="contender" data-pick="${c.id}" data-game="${game}" aria-label="Pick ${esc(c.name)}">
      <span class="c-meta"><span class="c-seed">${c.seed} seed</span>${loadBadge(c.load)}<span>${c.period === "day" ? "Day" : "Night"}</span></span>
      ${figure(cp.photo || null, "c-photo", null)}
      <span class="c-title">${esc(cap(cp.title))}</span>
      ${c.bundle ? `<span class="c-short">${esc(c.short)}</span>` : ""}
      <span class="c-body">${esc(cp.body[0] || "")}</span>
      ${inFor(c)}
      <span class="c-go">This one</span>
    </button>`;
  }

  let abstainConfirm = false;
  function renderBracket(mine, iAbstain) {
    const el = $("bracket-body");
    if (!br) { el.innerHTML = ""; return; }
    if (iAbstain) {
      $("bracket-head").textContent = "You're along for the ride.";
      $("bracket-intro").hidden = true;
      el.innerHTML = `<div class="ballot"><p class="ballots-in">No ballot from you, on the record. The family's week below doesn't wait on one.</p>
        <div class="actions"><button type="button" class="ctl" data-bracket="restart">Fill in a bracket after all</button></div></div>`;
      return;
    }
    const ids = br.contenders.map((c) => c.id);
    const byId = Object.fromEntries(br.contenders.map((c) => [c.id, c]));
    const r = B.resolve(br.structure, ids, br.picks);
    if (!mine) {
      const g = r.next;
      $("bracket-head").textContent = "Fill in your bracket.";
      $("bracket-intro").hidden = false;
      const sofar = r.picksMade ? `<p class="matchup-sofar">${r.picksMade} of ${r.picksNeeded} picked. <button type="button" class="link" data-bracket="restart">Start over</button></p>` : "";
      el.innerHTML = `<div class="matchup">
        <p class="matchup-round"><span class="round">${esc(B.ROUND_NAME[g.round])}</span><span class="sep">·</span><span>pick ${r.picksMade + 1} of ${r.picksNeeded}</span></p>
        <div class="versus">${contenderCard(byId[g.a], g.id)}<span class="vs">or</span>${contenderCard(byId[g.b], g.id)}</div>
        ${hint("Tap the one you'd rather not miss. Saved as you go.")}${sofar}
        ${abstainConfirm
          ? `<div class="actions"><span class="ctl-state">No ballot, then. The family's week won't wait on you.</span><button type="button" class="ctl on" data-bracket="abstain">That's right</button><button type="button" class="ctl" data-bracket="keep">Never mind</button></div>`
          : `<p class="matchup-sofar">Been already? <button type="button" class="link" data-bracket="abstain-ask">I'm here for the train.</button></p>`}
      </div>`;
      return;
    }
    $("bracket-head").textContent = "Your ballot is in.";
    $("bracket-intro").hidden = true;
    const rerun = brConfirm
      ? `<div class="actions"><span class="ctl-state">Sure? Your week disappears until the new ballot is finished.</span><button type="button" class="ctl on" data-bracket="reset">Yes, rerun it</button><button type="button" class="ctl" data-bracket="keep">Keep it</button></div>`
      : `<div class="actions"><button type="button" class="ctl" data-bracket="rerun">Rerun my bracket</button></div>`;
    el.innerHTML = `<div class="ballot">
      <ol class="ballot-list">${mine.map((id, i) => `<li><b>${i + 1}</b><span>${esc(byId[id].name)}${byId[id].bundle ? `<small>${esc(byId[id].short)}</small>` : ""}</span><i>${byId[id].seed} seed</i></li>`).join("")}</ol>
      ${rerun}
    </div>`;
  }

  // The family's order, under the family's week: why the week is what it is.
  function renderOrder(fam) {
    const el = $("family-order");
    if (!fam.order || !fam.order.length || !br) { el.hidden = true; return; }
    el.hidden = false;
    const byId = Object.fromEntries(br.contenders.map((c) => [c.id, c]));
    const head = travelers.map((t) => `<th title="${esc(t.name)}">${esc(t.name[0])}</th>`).join("");
    const rows = fam.order.map((row, i) => `<tr class="${row.protected ? "champ" : ""}${i === 12 ? " must-see-line" : ""}">
      <td class="n">${i + 1}</td><td class="name">${row.protected ? '<span class="star" aria-label="champion">✦</span> ' : ""}${esc(byId[row.id] ? byId[row.id].name : row.id)}${byId[row.id] && byId[row.id].bundle ? `<small>${esc(byId[row.id].short)}</small>` : ""}</td>
      ${travelers.map((t) => `<td class="r">${row.ranks[t.id] || "–"}</td>`).join("")}<td class="avg">${row.mean.toFixed(1)}</td></tr>`).join("");
    el.innerHTML = `<p class="kicker-sm">The family's order</p>
      <div class="table-wrap"><table class="fam-table"><thead><tr><th>#</th><th>Thing</th>${head}<th>Avg</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${hint("✦ somebody's champion, locked to the top. Lower average is better. The top thirteen are the must-see things.")}`;
  }

  async function bracketPost(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body || {}) });
    let data = null; try { data = await res.json(); } catch (_) {}
    if (res.status === 401) { location.href = (data && data.signin) || "/family"; return null; }
    if (!res.ok) { toast((data && data.error) || "That didn't take."); if (data && data.picks) { br.picks = data.picks; render(); } return null; }
    return data;
  }

  async function bracketPick(game, winner) {
    const data = await bracketPost("/api/bracket/pick", { game, winner });
    if (!data) return;
    br.picks = data.picks; br.family = data.family;
    shared = { ...shared, trip: data.trip };
    const st = data.family.status[me.id];
    render();
    if (st && st.complete) {
      const champ = (br.contenders.find((c) => c.id === st.champion) || {}).name || "";
      toast(`Ballot in. ${champ} is your champion. Here's your week.`);
      const mine = (data.unlocked || []).filter((u) => u.scope === "trip" || u.traveler === me.id);
      if (mine.length) setTimeout(() => toast(`Achievement unlocked: ${mine.map((u) => u.name).join(", ")}`), 4200);
      const sec = $("mine"); if (sec && !sec.hidden) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function bracketAbstain() {
    const data = await bracketPost("/api/bracket/abstain", {});
    if (!data) return;
    abstainConfirm = false;
    br.picks = data.picks; br.family = data.family;
    shared = { ...shared, trip: data.trip };
    render();
    const mine = (data.unlocked || []).filter((u) => u.scope === "trip" || u.traveler === me.id);
    if (mine.length) toast(`Achievement unlocked: ${mine.map((u) => u.name).join(", ")}`);
  }

  async function bracketReset() {
    const data = await bracketPost("/api/bracket/reset", {});
    if (!data) return;
    brConfirm = false;
    br.picks = {}; br.family = data.family;
    shared = { ...shared, trip: data.trip };
    render();
  }

  $("bracket-body").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { bracketPick(pick.dataset.game, pick.dataset.pick); return; }
    const b = e.target.closest("[data-bracket]"); if (!b) return;
    const k = b.dataset.bracket;
    if (k === "restart") { bracketReset(); return; }
    if (k === "rerun") { brConfirm = true; render(); }
    else if (k === "keep") { brConfirm = false; abstainConfirm = false; render(); }
    else if (k === "reset") bracketReset();
    else if (k === "abstain-ask") { abstainConfirm = true; render(); }
    else if (k === "abstain") bracketAbstain();
  });

  /* ───────────── Today in Washington, the record, the trophy case ───────────── */

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
    const sug = live && live.suggestion ? `<div class="better"><p class="kicker-sm">Better plan available</p><p>${esc(live.suggestion.summary)}</p><button type="button" class="ctl on" data-swap="1">Make the swap</button></div>` : "";
    $("today-body").innerHTML = `<p class="today-date">${esc(fmtDMDY(d.date))}</p>${w}${line("Day", d.day)}${line("Night", d.night)}${sug}`;
  }

  function renderRecord(p) {
    const el = $("record");
    if (p.phase !== "after") { el.hidden = true; return; }
    el.hidden = false;
    const completed = shared.trip.planner.completed || {};
    const doneCount = p.mustSee.filter((id) => p.units[id] && p.units[id].members.every((m) => completed[m])).length;
    const total = trophies ? Object.values(trophies.byTraveler).reduce((n, l) => n + l.length, 0) + trophies.group.length : null;
    $("record-body").innerHTML = `<p class="today-date">${esc(fmtMD(p.trainOut))} – ${esc(fmtDMDY(p.home))}</p>
      <ul class="record-list"><li><b>${doneCount}</b> of ${p.mustSee.length} must-see things</li>${total != null ? `<li><b>${total}</b> achievements</li>` : ""}<li><b>0</b> days with two Big things</li></ul>
      ${trophies && trophies.group.includes("wally-world") ? `<p class="record-trophy">Wally World Was Open.</p>` : ""}`;
  }

  function renderTrophies() {
    const el = $("trophies-body");
    if (!trophies) { el.innerHTML = `<p class="muted">Nothing on the record yet.</p>`; return; }
    const defs = Object.fromEntries(trophies.defs.map((d) => [d.id, d]));
    const all = (trophies.byTraveler[me.id] || []).map((id) => defs[id]).filter(Boolean);
    const mine = all.filter((d) => !d.track);
    const cards = all.filter((d) => d.track === "scouts");
    const cardTotal = trophies.defs.filter((d) => d.track === "scouts" && d.only === me.id).length;
    const standings = travelers.map((t) => ({ t, n: (trophies.byTraveler[t.id] || []).filter((id) => !(defs[id] || {}).track).length })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name));
    const samCards = (trophies.byTraveler.sam || []).filter((id) => (defs[id] || {}).track === "scouts").length;
    const samTotal = trophies.defs.filter((d) => d.track === "scouts" && d.only === "sam").length;
    const bartFirst = standings[0] && standings[0].t.is_admin;
    el.innerHTML = `
      <div class="mine"><p class="kicker-sm">${esc(me.name)}'s ${esc(city.name)}</p>
        ${mine.length ? `<ul class="trophy-list">${mine.map((d) => `<li><b>${esc(d.name)}</b> <span>${esc(d.description)}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing yet. Go see something.</p>`}
        ${cardTotal ? `<p class="kicker-sm cards-head">Blue cards · ${cards.length} of ${cardTotal} · <a href="/family/scouts" class="cards-map">the map</a></p>
        ${cards.length ? `<ul class="trophy-list cards">${cards.map((d) => `<li><b>${esc(d.name)}</b> <span>${esc(d.description)}</span> <i class="badge-req">${esc(d.badge || "")}</i></li>`).join("")}</ul>` : `<p class="muted">Each one is a merit badge requirement a stop on this trip satisfies. Mark the stop done and it files itself.</p>`}` : ""}
      </div>
      <div class="standings"><p class="kicker-sm">Standings</p>
        <ol>${standings.map((s) => `<li><span>${esc(s.t.name)}</span><b>${s.n}</b></li>`).join("")}</ol>
        ${!bartFirst && standings.length ? `<p class="muted">Bart has appealed the results.</p>` : ""}
        ${trophies.group.length ? `<p class="kicker-sm cards-head">The trip's</p><ul class="trophy-list">${trophies.group.map((id) => defs[id]).filter(Boolean).map((d) => `<li><b>${esc(d.name)}</b> <span>${esc(d.description)}</span></li>`).join("")}</ul>` : ""}
        ${samTotal && me.id !== "sam" ? `<p class="muted">Sam's blue cards: ${samCards} of ${samTotal}. They don't count here. <a href="/family/scouts">The map.</a></p>` : ""}
      </div>`;
  }

  /* ───────────── Talking to the Worker ───────────── */

  async function fetchShared() {
    try {
      const m = await fetch("/api/me", { headers: { accept: "application/json" }, redirect: "manual" });
      let mj = null; try { mj = m.ok ? await m.json() : null; } catch (_) {}
      me = mj && mj.traveler ? mj.traveler : null; travelers = (mj && mj.travelers) || [];
      signinWhy = mj && !mj.traveler && mj.why && mj.why !== "not_signed_in" ? mj.why : null;
      if (!me) return false;
      const t = await fetch("/api/trip", { headers: { accept: "application/json" } });
      if (!t.ok) { me = null; return false; }
      shared = await t.json();
      today = shared.today || null;
      return true;
    } catch (_) { return false; }
  }

  async function fetchLive() {
    if (!shared) return;
    try {
      const [t, a, bk] = await Promise.all([fetch("/api/today"), fetch("/api/achievements"), fetch("/api/bracket")]);
      live = t.ok ? await t.json() : null;
      trophies = a && a.ok ? await a.json() : null;
      br = bk && bk.ok ? await bk.json() : null;
    } catch (_) { live = null; trophies = null; br = null; }
  }

  // Send an intent, no preview: what changes, changes. The Worker persists and re-plans.
  async function send(intent) {
    const res = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ version: shared.trip.version, intent, confirmed: true }) });
    let body = null; try { body = await res.json(); } catch (_) {}
    if (res.status === 401) { location.href = (body && body.signin) || "/family"; return false; }
    if (res.status === 409 && body && body.trip) { shared = { ...shared, trip: body.trip }; render(); toast("Somebody else changed the trip first. Here's the latest."); return false; }
    if (!res.ok) { toast((body && body.error) || "That didn't take."); render(); return false; }
    shared = { ...shared, trip: body.trip, today: body.today }; today = shared.today || today;
    await fetchLive(); render();
    const mine = (body.unlocked || []).filter((u) => u.scope === "trip" || u.traveler === (me && me.id));
    if (mine.length) toast(`Achievement unlocked: ${mine.map((u) => u.name).join(", ")}`);
    return true;
  }

  function toast(text) {
    const el = $("toast"); el.textContent = text; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // Leave home and back home. The train eats both travel days: nights = home − leave − 2.
  function datesChanged() {
    const leave = parseISO($("cfg-leave").value), home = parseISO($("cfg-home").value);
    if (!leave || !home) return;
    const nights = Math.round((home - leave) / 86400000) - 2;
    if (nights < MIN_NIGHTS || nights > MAX_NIGHTS) { toast(nights < MIN_NIGHTS ? `That's ${nights < 1 ? "no" : nights} hotel ${nights === 1 ? "night" : "nights"}. Both travel days are the train's; it needs at least ${MIN_NIGHTS}.` : `That's ${nights} hotel nights. ${MAX_NIGHTS} is the most this planner will do.`); render(); return; }
    const start = iso(addDays(leave, 1));
    const startMoved = start !== shared.trip.start, nightsMoved = nights !== shared.trip.nights;
    if (startMoved && nightsMoved) send({ type: "set_trip", start, nights });
    else if (startMoved) send({ type: "set_dates", start });
    else if (nightsMoved) send({ type: "set_nights", nights });
  }
  $("cfg-leave").addEventListener("change", datesChanged);
  $("cfg-home").addEventListener("change", datesChanged);

  // Live actions on the family's week, and the weather swap.
  const venueName = (id) => (C.venues.find((v) => v.id === id) || {}).name || id;
  document.addEventListener("click", (e) => {
    const sw = e.target.closest("button[data-swap]");
    if (sw && live && live.suggestion) {
      send({ type: "swap", moves: live.suggestion.moves.map((m) => ({ venue: m.venue, date: m.date, name: m.name })), reason: live.weather && live.weather[today] ? live.weather[today].summary : "weather" });
      return;
    }
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const ids = b.dataset.ids.split(","), a = b.dataset.act;
    send({ type: a, venue: ids[0], members: ids, name: venueName(ids[0]), date: b.dataset.date });
  });

  (async () => {
    if (await fetchShared()) { await fetchLive(); if (location.hash === "#signed-in") history.replaceState(null, "", location.pathname); }
    render();
    document.addEventListener("visibilitychange", async () => { if (!document.hidden && shared && await fetchShared()) { await fetchLive(); render(); } });
  })();
})();

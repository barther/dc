/*
 * The pitch. Public, no schedule: the recommended dates for the countdown and the
 * board, and the reel of every contender. The family's trip lives at /family.
 */
(function () {
  "use strict";
  const P = window.DCPlanner, C = window.DCVenues, B = window.DCBracket;
  const { DEFAULT, fmtMD, fmtDMD, fmtDMDY, TRAIN } = P;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const LOAD_NAME = { lo: "Easy", mid: "Real", hi: "Big" };
  const loadBadge = (load) => `<i class="load ${load}">${LOAD_NAME[load] || load}</i>`;

  // The recommended trip sets the dates on the page. The family's real dates are inside.
  const p = P.plan({ ...DEFAULT }, {}, null, {});
  $("eyebrow-dates").innerHTML = `${esc(fmtDMD(p.trainOut))} → ${esc(fmtDMDY(p.home))}`.replace(/ /g, "&nbsp;");
  const NW = ["", "One night", "Two nights", "Three nights", "Four nights", "Five nights", "Six nights", "Seven nights", "Eight nights", "Nine nights", "Ten nights"];
  $("lede-nights").textContent = NW[p.nights] || `${p.nights} nights`;
  $("lede-span").textContent = p.nights >= 7 ? "the whole week" : p.nights >= 4 ? "all of it" : "every minute of it";
  window.DCTrip = { depart: p.trainOut, arrive: new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate(), 14, 12), home: new Date(p.home.getFullYear(), p.home.getMonth(), p.home.getDate(), 10, 30) };
  window.dispatchEvent(new CustomEvent("trip:change"));
  const weekend = p.start.getDay() === 0 || p.start.getDay() === 6;
  $("b-out-from").textContent = `${fmtDMD(p.trainOut)} · ${TRAIN.boardLabel}`;
  $("b-out-to").textContent = `${fmtDMD(p.start)} · ${weekend ? TRAIN.arriveWeekend : TRAIN.arriveWeekday}`;
  $("b-back-from").textContent = `${fmtDMD(p.depart)} · ${TRAIN.departLabel}`;
  $("b-back-to").textContent = `${fmtDMD(p.home)} · ${TRAIN.homeLabel}`;
  $("foot-dates").textContent = `${fmtMD(p.trainOut)} – ${fmtMD(p.home)}, ${p.home.getFullYear()}`;

  // The reel: every contender, seeded, with its copy. Sizzle, not schedule.
  const figure = (photo) => photo ? `<figure class="reel-photo"><img class="photo" src="/img/${photo[0]}" alt="${esc(photo[1])}" loading="lazy"><figcaption>${esc(photo[1])}</figcaption></figure>` : "";
  $("reel-list").innerHTML = B.contenders(C).map((c) => {
    const cp = C.copy[c.id] || { title: c.name, body: [] };
    return `<li class="reel-item${cp.featured ? " featured" : ""}" id="reel-${c.id}">
      <div class="reel-meta"><span class="reel-seed">${c.seed}</span>${loadBadge(c.load)}<span class="reel-when">${c.period === "day" ? "Day" : "Night"}</span></div>
      <h3>${esc(cap(cp.title))}</h3>
      ${c.bundle ? `<p class="reel-short">${esc(c.short)}</p>` : ""}
      ${figure(cp.photo || null)}
      ${cp.body.map((t) => `<p>${esc(t)}</p>`).join("")}
    </li>`;
  }).join("");

  // Who's here. A traveler gets the door; anyone else gets the sign-in.
  const id = $("identity");
  const door = (text, href, label) => { id.hidden = false; id.innerHTML = `<span class="who">${text}</span> <a href="${href}" class="signin">${label}</a>`; document.querySelectorAll(".reel-cta .signin").forEach((a) => { a.href = href; a.textContent = label; }); };
  fetch("/api/me", { headers: { accept: "application/json" }, redirect: "manual" })
    .then((r) => (r.ok ? r.json() : null))
    .then((mj) => {
      if (mj && mj.traveler) door(`You're <b>${esc(mj.traveler.name)}</b>. The bracket, the week, and the list are inside.`, "/family", "Go inside");
      else if (mj && mj.why && mj.why !== "not_signed_in") door(`Signed in, but not on the trip. ${esc(mj.why)}.`, "/family", "Try again");
      else door("This is the pitch. The family votes with a bracket, and the week follows the vote.", "/family", "Family, sign in");
    })
    .catch(() => { id.hidden = true; });
})();

/* Countdown to departure day + a quiet snowfall. */

(function () {
  // Departure day: Saturday Nov 28, 2026, Anniston AL (Central Time).
  const DEPART = new Date("2026-11-28T00:00:00-06:00");
  const ARRIVE_DC = new Date("2026-11-29T14:12:00-05:00");
  const HOME = new Date("2026-12-07T10:30:00-06:00");

  const el = document.getElementById("countdown");
  const label = document.getElementById("countdown-label");
  const units = {
    days: el.querySelector('[data-unit="days"]'),
    hours: el.querySelector('[data-unit="hours"]'),
    minutes: el.querySelector('[data-unit="minutes"]'),
    seconds: el.querySelector('[data-unit="seconds"]'),
  };

  const pad = (n) => String(n).padStart(2, "0");

  function render() {
    const now = new Date();
    let target = DEPART;
    let text = "until we board the train";

    if (now >= DEPART && now < ARRIVE_DC) {
      target = ARRIVE_DC;
      text = "until Union Station. we're on the train!";
    } else if (now >= ARRIVE_DC && now < HOME) {
      target = HOME;
      text = "left in Washington. make it count.";
    } else if (now >= HOME) {
      units.days.textContent = "0";
      units.hours.textContent = "00";
      units.minutes.textContent = "00";
      units.seconds.textContent = "00";
      label.textContent = "we did it. we actually saw Washington.";
      return;
    }

    let ms = Math.max(0, target - now);
    const d = Math.floor(ms / 86400000); ms -= d * 86400000;
    const h = Math.floor(ms / 3600000);  ms -= h * 3600000;
    const m = Math.floor(ms / 60000);    ms -= m * 60000;
    const s = Math.floor(ms / 1000);

    units.days.textContent = String(d);
    units.hours.textContent = pad(h);
    units.minutes.textContent = pad(m);
    units.seconds.textContent = pad(s);
    label.textContent = text;
  }

  render();
  setInterval(render, 1000);

  // ── Snow ─────────────────────────────────────────────────────
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.getElementById("snow");
  if (!canvas || reduce) { if (canvas) canvas.remove(); return; }

  const ctx = canvas.getContext("2d");
  let w, h, flakes = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    const count = Math.round((innerWidth * innerHeight) / 14000);
    flakes = Array.from({ length: count }, () => spawn(true));
  }

  function spawn(anywhere) {
    const r = (0.8 + Math.random() * 1.8) * dpr;
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -r * 2,
      r,
      vy: (0.25 + Math.random() * 0.55) * dpr * (r / dpr),
      vx: (Math.random() - 0.5) * 0.3 * dpr,
      drift: Math.random() * Math.PI * 2,
      a: 0.35 + Math.random() * 0.5,
    };
  }

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(40, t - last) / 16.67;
    last = t;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f3e9d2";
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];
      f.drift += 0.01 * dt;
      f.x += (f.vx + Math.sin(f.drift) * 0.25 * dpr) * dt;
      f.y += f.vy * dt;
      if (f.y > h + f.r * 2) flakes[i] = spawn(false);
      if (f.x < -10) f.x = w + 10; else if (f.x > w + 10) f.x = -10;
      ctx.globalAlpha = f.a;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  resize();
  addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(frame);
})();

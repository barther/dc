/* Countdown to departure day. */

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

})();

/* Countdown to departure day. */

(function () {
  // Dates come from planner.js via window.DCTrip; this file owns no dates of its own.

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
    const trip = window.DCTrip;
    if (!trip) return;
    const DEPART = trip.depart, ARRIVE_DC = trip.arrive, HOME = trip.home;
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
  window.addEventListener("trip:change", render);

})();

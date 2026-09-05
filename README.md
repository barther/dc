# Washington, for Christmas

A one-page promo site for the family's Christmas trip to Washington, DC, built to get
Jess, Sam, and Nanny excited. Content comes from the trip docs in this repo
(`dc-trip-nov-dec-2026.md`, `dc-trip-nov29-dec6-2026.md`).

## Architecture

A single Cloudflare Worker (`src/index.js`) that serves the static site in `public/` through
Workers Static Assets (`ASSETS` binding) and adds security headers. It knows no trip dates.

No build step. No framework. Fonts come from Google Fonts; everything else is in `public/`.

## Run it

```sh
npm install
npm run dev        # http://localhost:8787
```

## Deploy it

```sh
npx wrangler login # once
npm run deploy
```

The Worker is named `dc-christmas` in `wrangler.jsonc`; it will deploy to
`dc-christmas.<your-subdomain>.workers.dev`. Add a custom domain later in the Cloudflare
dashboard if you want a nicer link to text the family.

## The planner

The page opens on the recommended seven-night trip, then lets the family overrule it without
breaking it. Three files, one direction of data flow:

- `public/venues.js` is the source of truth: every experience with its seed, tier, day/night,
  LO/MID/HI load, environment, hours, closures, and bundle. Plus the bundle catalog, the
  Archives/memorials pairing, structural days, and the prose for each unit.
- `public/planner.js` is the scheduler. Pure, no DOM, runs under node. It takes dates and user
  state (punts, pins) and returns a plan: each day's day and night assignment, what was cut or
  shortened, the tradeoffs worth explaining, and a label derived from what survived.
- `public/ui.js` renders the plan and owns the controls: the calendar strip, the nights stepper,
  Must-do and Punt on each day, Add to trip on the bench and on open slots, and the preview
  panel that names a consequence before a change lands.

Trip-design state (dates, nights, punts, pins) lives in the URL hash, so a configured trip can
be sent around: `/#start=2026-12-05&nights=5&punt=natural-history&ask=fords-theatre`. The doctrine is in
`PLANNER.md`; `npm test` checks the behavioral invariants.

## Editing the plan

The list and the house rules are plain HTML in `public/index.html`. Everything the scheduler
knows, and the copy for each experience, lives in `public/venues.js`. Every date on the page, the countdown included, comes from the planner. The
recommended trip, the train times, and Bart's work window are the constants at the top of
`public/planner.js`; nothing else in the repo carries a date.

# Washington, for Christmas

A one-page promo site for the family's Christmas trip to Washington, DC, built to get
Jess, Sam, and Nanny excited. Content comes from the trip docs in this repo
(`dc-trip-nov-dec-2026.md`, `dc-trip-nov29-dec6-2026.md`).

## Architecture

Static data describes Washington; the planner decides what should happen; shared state
records what the family decided; identity says who did it.

- `public/` is the site: the pitch, the recommended itinerary, and the planner UI.
- `src/index.js` is the Worker. It serves the site, reads the shared trip from D1, and accepts
  **intents** from signed-in travelers (`POST /api/intent`). The planner is authoritative about
  whether a state is valid; D1 is authoritative about which valid state the family accepted.
  The Worker applies the intent, re-runs the same planner the browser runs, and persists the
  canonical state plus a decision record. The client never sends itinerary JSON.
- `src/intents.js` is the pure intent reducer and the permission boundary: anyone can operate
  the vacation, Bart administers it (dates, nights, reset, overriding a preference).
- `src/access.js` verifies Cloudflare Access identity. No family password table.
- `src/weather.js` reads the National Weather Service forecast for the Mall (free, no key), caches
  it in KV for an hour, and reduces each day to categorical conditions. The planner turns those
  into venue-specific fit; `/api/today` proposes a swap only when the win is real.
- `public/achievements.js` is the achievement catalog and a pure evaluator. Unlocks are written
  to KV once and never removed. `/api/achievements` feeds the trophy case and the standings.
- `migrations/` is the D1 schema: travelers, identities, trip, venue state, preferences, marks
  (completed, fixed, not-this-day), accepted placements, decisions.

### Setting up the shared trip

```sh
npx wrangler d1 create dc-christmas          # paste the id into wrangler.jsonc
npx wrangler kv namespace create KV          # paste the id into wrangler.jsonc
npx wrangler d1 migrations apply dc-christmas
# map the family's tenant addresses to travelers (ids: bart, jess, sam, nanny)
npx wrangler d1 execute dc-christmas --command "INSERT INTO traveler_identities (email, traveler_id) VALUES ('bart@yourtenant.com', 'bart')"
```

Identity is Cloudflare Access with Entra ID. In Zero Trust, add a self-hosted application for
`dc.arther.co` covering `/family` and `/api/*`, with Entra ID as the login method and a policy
allowing the four addresses. The Worker enforces the same boundary itself: everything under
`/api/` except `/api/me` answers 401 to anyone who isn't a mapped traveler, so the public site
is the pitch and the recommended itinerary only. Family state, the decision log, live mode, and
the trophy case are behind sign-in. Then set `ACCESS_TEAM_DOMAIN` in
`wrangler.jsonc` and the application's AUD tag as a secret: `npx wrangler secret put ACCESS_AUD`.
The pitch stays public; "Sign in" goes through `/family`, and the Access cookie covers the API.

Writes are guarded transactionally: each accepted change inserts the next version into
`trip_versions` first, so a stale writer collides on the primary key and D1 rolls the whole batch
back. The loser gets a 409 with the current trip.

Locally, `wrangler dev` uses a local D1 (`npx wrangler d1 migrations apply dc-christmas --local`)
and a local KV; `.dev.vars` stands in for a signed-in identity (`DEV_IDENTITY=bart` maps by
traveler id when no identity row exists), can pin "today" for live mode,
and can supply a weather fixture instead of the live forecast (see `.dev.vars.example`).

### The trip's phases

The same page is the pitch before the trip, "Today in Washington" during it, and the record after.
Before: plan, vote, punt, pin. During: the day's plan with weather fit, mark things done, bail,
"not this day", and a "Better plan available" swap when the forecast justifies it. After: the
record (experiences, achievements, swaps, punts, zero HI/HI days) and family photos in the venue
slots, dropped into `public/img/` as `done-<original filename>`.

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

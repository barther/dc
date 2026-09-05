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
- `migrations/` is the D1 schema: travelers, identities, trip, venue state, preferences, decisions.

### Setting up the shared trip

```sh
npx wrangler d1 create dc-christmas          # paste the id into wrangler.jsonc
npx wrangler d1 migrations apply dc-christmas
# map the family's tenant addresses to travelers
npx wrangler d1 execute dc-christmas --command "UPDATE traveler_identities SET email='bart@yourtenant.com' WHERE traveler_id='bart'"
```

Identity is Cloudflare Access with Entra ID. In Zero Trust, add a self-hosted application for
`dc.arther.co` covering the paths `/family`, `/api/me`, and `/api/intent`, with Entra ID as the
login method and a policy allowing the four addresses. Then set `ACCESS_TEAM_DOMAIN` in
`wrangler.jsonc` and the application's AUD tag as a secret: `npx wrangler secret put ACCESS_AUD`.
The pitch stays public; "Sign in" goes through `/family`, and the Access cookie covers the API.

Locally, `wrangler dev` uses a local D1 (`npx wrangler d1 migrations apply dc-christmas --local`)
and `.dev.vars` stands in for a signed-in identity (see `.dev.vars.example`).

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

# Washington, for Christmas

A one-page promo site for the family's DC trip (Sat Nov 28 → Mon Dec 7, 2026), built to get
Jess, Sam, and Nanny excited. Content comes from the trip docs in this repo
(`dc-trip-nov-dec-2026.md`, `dc-trip-nov29-dec6-2026.md`).

## Architecture

A single Cloudflare Worker (`src/index.js`) that:

- serves the static site in `public/` through Workers Static Assets (`ASSETS` binding), and
- answers `GET /api/countdown` with a server-side countdown to departure day.

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

"Change the trip" under the countdown lets the family move the arrival date or the number of
hotel nights. `public/planner.js` re-plans the week immediately, protecting the trip's identity
and pacing before attraction count. The doctrine it follows is in `PLANNER.md`; the trip-length
ladder is pinned by `test/planner.test.js` (`npm test`). The chosen trip lives in the URL hash,
so a link like `/#start=2026-12-05&nights=5` opens that version directly.

## Editing the plan

The list and the house rules are plain HTML in `public/index.html`. The itinerary copy, each
day's effort levels, and the cut order live in the `MODULES` table at the top of
`public/planner.js`. The countdown follows whatever trip the planner renders; the server-side
`/api/countdown` in `src/index.js` only knows the recommended dates.

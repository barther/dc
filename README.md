# Washington, for Christmas

A one-page promo site for the family's DC trip (Sat Nov 28 → Mon Dec 7, 2026), built to get
Jess, Sam, and Mom excited. Content comes from the trip docs in this repo
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

## Editing the plan

The itinerary, the list, and the house rules are plain HTML in `public/index.html`.
Departure dates for the countdown live at the top of `public/app.js` (and `src/index.js`
for the API). Level meters use `--n:1` … `--n:4` on the `.ticks` element.

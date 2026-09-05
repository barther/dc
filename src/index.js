/**
 * dc-christmas — Cloudflare Worker
 *
 * Serves the static promo site from ./public via Workers Static Assets and
 * exposes one small JSON endpoint the page can use for a server-side clock:
 *
 *   GET /api/countdown  -> { now, departure, msUntil, daysUntil, phase }
 *
 * Everything else falls through to the asset binding.
 */

// Boarding day in Anniston, AL (Central Time). Trip runs Sat Nov 28 -> Mon Dec 7, 2026.
const DEPARTURE = new Date("2026-11-28T00:00:00-06:00");
const HOME = new Date("2026-12-07T23:59:59-06:00");

function countdown(now = new Date()) {
  const msUntil = DEPARTURE.getTime() - now.getTime();
  let phase = "before";
  if (now >= DEPARTURE && now <= HOME) phase = "during";
  else if (now > HOME) phase = "after";
  return {
    now: now.toISOString(),
    departure: DEPARTURE.toISOString(),
    msUntil,
    daysUntil: Math.max(0, Math.ceil(msUntil / 86_400_000)),
    phase,
  };
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function withHeaders(response, extra = {}) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    res.headers.set(k, v);
  }
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/countdown") {
      return withHeaders(
        Response.json(countdown(), {
          headers: { "cache-control": "no-store" },
        })
      );
    }

    if (url.pathname.startsWith("/api/")) {
      return withHeaders(Response.json({ error: "not found" }, { status: 404 }));
    }

    const asset = await env.ASSETS.fetch(request);
    return withHeaders(asset);
  },
};

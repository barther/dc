/**
 * dc-christmas — Cloudflare Worker
 *
 * Serves the static promo site from ./public via Workers Static Assets and
 * adds a few security headers. All trip dates live in public/planner.js;
 * the Worker knows nothing about them.
 */

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export default {
  async fetch(request, env) {
    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  },
};

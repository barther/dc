/*
 * Cloudflare Access identity. The Worker trusts only a verified Access JWT
 * (Cf-Access-Jwt-Assertion header), checked against the team's public keys.
 * In local dev, DEV_IDENTITY in .dev.vars stands in for a signed-in email.
 */

let certCache = { at: 0, keys: null, domain: null };

async function fetchKeys(teamDomain) {
  const now = Date.now();
  if (certCache.keys && certCache.domain === teamDomain && now - certCache.at < 6 * 3600 * 1000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = await res.json();
  certCache = { at: now, keys: body.keys || [], domain: teamDomain };
  return certCache.keys;
}

function b64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// Verifies an Access JWT. Returns { email, sub } or { error } — the error names
// the check that failed so /api/me can say why a sign-in did not map.
export async function verifyAccessJwt(token, env) {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return { error: "token_malformed" };
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(h)));
    payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  } catch (e) { return { error: "token_malformed" }; }
  let keys;
  try { keys = await fetchKeys(env.ACCESS_TEAM_DOMAIN); } catch (e) { return { error: `certs_unreachable: ${e.message}` }; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { error: "key_not_found: token was not signed by this team" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return { error: "bad_signature" };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { error: "token_expired" };
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return { error: `issuer_mismatch: ${payload.iss}` };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (env.ACCESS_AUD && !aud.includes(env.ACCESS_AUD)) return { error: "aud_mismatch: ACCESS_AUD is not this application's tag" };
  if (!payload.email) return { error: "no_email_claim" };
  return { email: payload.email.toLowerCase(), sub: payload.sub };
}

// Returns { email, sub } for a verified identity, { error } for a sign-in the
// Worker could not accept, or null when no one is signed in.
export async function identify(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie(request, "CF_Authorization");
  if (token && env.ACCESS_TEAM_DOMAIN) {
    try { return await verifyAccessJwt(token, env); } catch (e) { return { error: `verify_failed: ${e.message}` }; }
  }
  if (token) return { error: "team_domain_unset: ACCESS_TEAM_DOMAIN is empty, so the token was ignored" };
  if (env.DEV_IDENTITY && !env.ACCESS_TEAM_DOMAIN) return { email: env.DEV_IDENTITY.toLowerCase(), sub: "dev" };
  return null;
}

function cookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

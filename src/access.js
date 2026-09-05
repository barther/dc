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

export async function verifyAccessJwt(token, env) {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const keys = await fetchKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (env.ACCESS_AUD && !aud.includes(env.ACCESS_AUD)) return null;
  return { email: (payload.email || "").toLowerCase(), sub: payload.sub };
}

// Returns { email } for a verified identity, or null.
export async function identify(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie(request, "CF_Authorization");
  if (token && env.ACCESS_TEAM_DOMAIN) {
    try { return await verifyAccessJwt(token, env); } catch (e) { return null; }
  }
  if (env.DEV_IDENTITY && !env.ACCESS_TEAM_DOMAIN) return { email: env.DEV_IDENTITY.toLowerCase(), sub: "dev" };
  return null;
}

function cookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

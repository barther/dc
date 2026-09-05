/*
 * Weather for the Mall, from the National Weather Service (free, no key, US only).
 * Categorical, venue-agnostic conditions per day; the planner turns them into
 * venue-specific fit. Cached in KV for an hour. Never fake precision.
 */

const POINT = "38.8895,-77.0353"; // the Washington Monument
const UA = "dc-christmas (family trip planner; contact via repo)";

// Turn NWS forecast periods into { iso: { rain, cold, wind, heat, hi, lo, summary } }.
export function daily(periods) {
  const days = {};
  for (const p of periods || []) {
    const iso = (p.startTime || "").slice(0, 10);
    if (!iso) continue;
    const d = days[iso] = days[iso] || { rain: false, cold: false, wind: false, heat: false, hi: null, lo: null, parts: [] };
    const t = Number(p.temperature);
    if (p.isDaytime) d.hi = isFinite(t) ? t : d.hi; else d.lo = d.lo == null && isFinite(t) ? t : d.lo;
    const pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
    const windMph = parseInt((p.windSpeed || "0").split(" ").pop(), 10) || 0;
    const text = (p.shortForecast || "").toLowerCase();
    if ((pop != null && pop >= 50) || /rain|showers|snow|sleet|storm/.test(text)) d.rain = true;
    if (windMph >= 20) d.wind = true;
    if (isFinite(t) && t <= 35 && p.isDaytime) d.cold = true;
    if (isFinite(t) && t >= 85 && p.isDaytime) d.heat = true;
    if (p.isDaytime) d.parts.push(p.shortForecast);
  }
  for (const d of Object.values(days)) {
    const bits = [];
    if (d.hi != null) bits.push(`${d.hi}°`);
    if (d.parts.length) bits.push(d.parts[0].toLowerCase());
    if (d.wind) bits.push("windy");
    d.summary = bits.join(", ");
    delete d.parts;
  }
  return days;
}

export async function forecast(env) {
  if (env.WEATHER_FIXTURE) { try { return JSON.parse(env.WEATHER_FIXTURE); } catch (e) { return null; } }
  const kv = env.KV;
  if (kv) { const cached = await kv.get("weather:forecast", "json"); if (cached) return cached; }
  try {
    const pt = await fetch(`https://api.weather.gov/points/${POINT}`, { headers: { "user-agent": UA, accept: "application/geo+json" } });
    if (!pt.ok) return null;
    const url = (await pt.json()).properties.forecast;
    const fc = await fetch(url, { headers: { "user-agent": UA, accept: "application/geo+json" } });
    if (!fc.ok) return null;
    const days = daily((await fc.json()).properties.periods);
    if (kv) await kv.put("weather:forecast", JSON.stringify(days), { expirationTtl: 3600 });
    return days;
  } catch (e) { return null; }
}

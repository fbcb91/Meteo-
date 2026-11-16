// Codice condiviso dalle funzioni serverless: elenco delle località, dati meteo e piccoli strumenti per l'HTML.
import fs from "node:fs";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const slugify = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const LABELS = {
  0: "sereno", 1: "prevalentemente sereno", 2: "parzialmente nuvoloso", 3: "coperto",
  45: "nebbia", 48: "nebbia con brina", 51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa",
  56: "pioviggine gelata", 57: "pioviggine gelata", 61: "pioggia debole", 63: "pioggia", 65: "pioggia forte",
  66: "pioggia gelata", 67: "pioggia gelata", 71: "neve debole", 73: "neve", 75: "neve forte", 77: "nevischio",
  80: "rovesci leggeri", 81: "rovesci", 82: "rovesci violenti", 85: "rovesci di neve", 86: "rovesci di neve",
  95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine",
};
export const label = (code) => LABELS[code] ?? "n.d.";

/* ---------- Località ---------- */

let cache = null;
export function atlas() {
  if (cache) return cache;
  // Percorso relativo a questo file, così chi impacchetta le funzioni include anche i dati.
  const raw = JSON.parse(fs.readFileSync(new URL("../data/places.json", import.meta.url), "utf8"));
  const regions = raw.regions.map((name) => ({ name, slug: slugify(name), places: [] }));
  const places = raw.places.map(([slug, name, r, lat, lon, pop]) => ({ slug, name, region: regions[r], lat, lon, pop }));
  for (const p of places) p.region.places.push(p); // già in ordine di popolazione
  cache = { places, regions, bySlug: new Map(places.map((p) => [p.slug, p])), byRegion: new Map(regions.map((r) => [r.slug, r])) };
  return cache;
}

// La località dell'elenco più vicina a un punto, entro `maxKm`.
export function nearest(lat, lon, maxKm = 4) {
  let best = null, bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const p of atlas().places) {
    const d = Math.hypot((p.lat - lat) * 111, (p.lon - lon) * 111 * k);
    if (d < bestD) { bestD = d; best = p; }
  }
  return bestD <= maxKm ? best : null;
}

export const siteUrl = (req) => (process.env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/$/, "");

/* ---------- Meteo ---------- */

export async function fetchForecast(lat, lon, { hourly = false, timeout = 5000 } = {}) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "auto", forecast_days: 7, wind_speed_unit: "kmh",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_gusts_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max",
  });
  if (hourly) {
    p.set("minutely_15", "precipitation");
    p.set("hourly", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,uv_index");
  }
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Open-Meteo: ${json.reason}`);
  return json;
}

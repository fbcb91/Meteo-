// /api/place?lat=44.49&lon=11.34 → la località dell'elenco più vicina, se ce n'è una entro pochi km.
// Serve all'app per portare chi cerca una città sulla sua pagina (/meteo/bologna) invece che su un link con coordinate.
import { nearest } from "../lib/site.js";

export default function handler(req, res) {
  const params = new URL(req.url, "http://localhost").searchParams;
  const lat = Number(params.get("lat")), lon = Number(params.get("lon"));
  if (!params.get("lat") || !params.get("lon") || !Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "Coordinate non valide" });
  const p = nearest(lat, lon);
  res.setHeader("Cache-Control", "public, s-maxage=604800, max-age=86400");
  return res.status(200).json(p ? { slug: p.slug, name: p.name, admin: p.region.name, country: "Italia", lat: +p.lat.toFixed(2), lon: +p.lon.toFixed(2) } : { slug: null });
}

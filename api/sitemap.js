// /sitemap.xml e /robots.txt: generati qui perché devono contenere l'indirizzo completo del sito.
import { atlas, siteUrl } from "../lib/site.js";

export default function handler(req, res) {
  const base = siteUrl(req);
  const params = new URL(req.url, "http://localhost").searchParams;
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

  if (params.has("robots")) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
  }

  const { places, regions } = atlas();
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, freq, priority) => `<url><loc>${base}${loc}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url("/", "hourly", "1.0"), url("/meteo", "weekly", "0.6"), url("/come-funziona", "monthly", "0.3"),
    ...regions.map((r) => url(`/regioni/${r.slug}`, "weekly", "0.5")),
    // Le città più grandi per prime e con priorità più alta.
    ...places.map((p) => url(`/meteo/${p.slug}`, "hourly", p.pop >= 100000 ? "0.9" : p.pop >= 20000 ? "0.8" : "0.7")),
    "</urlset>",
  ].join("\n");
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  return res.status(200).send(xml);
}

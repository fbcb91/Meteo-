// Pagine HTML del sito, generate sul server perché i motori di ricerca le leggano già complete:
//
//   /                      → home (Meteo Italia)
//   /meteo/bologna         → pagina di una città, con previsioni scritte nel codice
//   /meteo                 → elenco delle regioni
//   /regioni/emilia-romagna→ elenco delle città di una regione
//   /come-funziona, /privacy
//
// Le pagine con il meteo riusano page.html (l'app) e ci inseriscono titolo, descrizione, dati
// strutturati e un testo di previsioni. La CDN le tiene in cache: i dati meteo si scaricano
// al massimo una volta ogni mezz'ora per città, non a ogni visita.

import fs from "node:fs";
import { atlas, esc, fetchForecast, label, siteUrl } from "../lib/site.js";
import { DOCS } from "../lib/docs.js";

let template = null;
// Il percorso è scritto così perché lo strumento di Vercel che impacchetta le funzioni lo riconosca e includa il file.
const page = () => (template ??= fs.readFileSync(new URL("../page.html", import.meta.url), "utf8"));

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const round = (n) => Math.round(n);
const hhmm = (iso) => iso.slice(11, 16);
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

/* ---------- <head> ---------- */

function head({ title, description, canonical, noindex = false, ld = [] }, base) {
  const image = `${base}/og.png`;
  const verify = process.env.GOOGLE_SITE_VERIFICATION; // codice di Google Search Console, se impostato
  return `<title>${esc(title)}</title>${verify ? `\n  <meta name="google-site-verification" content="${esc(verify)}">` : ""}
  <meta name="description" content="${esc(description)}">
  ${noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${esc(canonical)}">`}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Cielo">
  <meta property="og:locale" content="it_IT">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  ${ld.map((o) => `<script type="application/ld+json">${json(o)}</script>`).join("\n  ")}`;
}

const breadcrumbs = (base, items) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: base + url })),
});

/* ---------- Testo delle previsioni ---------- */

function dayText(name, w, i) {
  const d = w.daily, when = i === 0 ? "oggi" : "domani";
  const prob = d.precipitation_probability_max[i] ?? 0, mm = d.precipitation_sum[i] ?? 0, snow = d.snowfall_sum?.[i] ?? 0;
  const gust = d.wind_gusts_10m_max?.[i] ?? d.wind_speed_10m_max[i];
  const rain = snow >= 1 ? `Neve prevista, circa ${round(snow)} cm.`
    : prob >= 50 ? `Pioggia probabile (${prob}%)${mm >= 1 ? `, circa ${round(mm)} mm` : ""}.`
    : prob >= 20 ? `Possibile qualche pioggia (${prob}%).`
    : `Pioggia improbabile (${prob}%).`;
  const wind = gust >= 50 ? `Raffiche di vento fino a ${round(gust)} km/h.` : `Vento fino a ${round(gust)} km/h.`;
  return `${cap(label(d.weather_code[i]))} ${when} a ${name}, con temperature tra ${round(d.temperature_2m_min[i])}° e ${round(d.temperature_2m_max[i])}°. ${rain} ${wind} Il sole sorge alle ${hhmm(d.sunrise[i])} e tramonta alle ${hhmm(d.sunset[i])}.`;
}

function weekday(iso, tz, style = "long") {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("it-IT", { weekday: style, day: "numeric", month: "long", timeZone: "UTC" });
}

function cityGuide(place, w) {
  const { name, region } = place;
  const near = region.places.filter((p) => p.slug !== place.slug).slice(0, 14);
  const links = `<h2>Meteo nelle altre città: ${esc(region.name)}</h2>
    <ul class="guide-links">${near.map((p) => `<li><a href="/meteo/${p.slug}">Meteo ${esc(p.name)}</a></li>`).join("")}</ul>
    <p><a href="/regioni/${region.slug}">Tutte le località in ${esc(region.name)}</a> · <a href="/meteo">Tutte le regioni</a></p>`;

  if (!w) {
    // Dati non disponibili in questo momento: la pagina resta utile (l'app qui sopra si aggiorna da sola).
    return `<section id="guida" class="guide full" aria-labelledby="guide-title">
      <h2 id="guide-title">Meteo ${esc(name)} oggi e domani</h2>
      <p>Previsioni del tempo per ${esc(name)} (${esc(region.name)}): situazione attuale, ora per ora, prossimi 7 giorni, vento e pioggia sulla mappa. I dati qui sopra si aggiornano in tempo reale.</p>
      ${links}</section>`;
  }

  const c = w.current, d = w.daily;
  const wet = d.time.map((day, i) => i).filter((i) => (d.precipitation_probability_max[i] ?? 0) >= 50);
  const hottest = d.temperature_2m_max.indexOf(Math.max(...d.temperature_2m_max));
  const dayName = (i) => (i === 0 ? "oggi" : i === 1 ? "domani" : weekday(d.time[i]));
  const rows = d.time.map((day, i) => `<tr><th scope="row">${cap(i === 0 ? "oggi" : weekday(day, null))}</th><td>${cap(label(d.weather_code[i]))}</td><td>${round(d.temperature_2m_min[i])}°</td><td>${round(d.temperature_2m_max[i])}°</td><td>${d.precipitation_probability_max[i] ?? 0}%</td></tr>`).join("");

  return `<section id="guida" class="guide full" aria-labelledby="guide-title">
    <p class="guide-updated">Previsioni aggiornate alle ${hhmm(c.time)} di ${weekday(c.time.slice(0, 10))} (ora locale)</p>
    <h2 id="guide-title">Meteo ${esc(name)} oggi</h2>
    <p>${esc(dayText(name, w, 0))} In questo momento ci sono ${round(c.temperature_2m)}° (percepiti ${round(c.apparent_temperature)}°): ${esc(label(c.weather_code))}, umidità al ${round(c.relative_humidity_2m)}%.</p>
    <h2>Meteo ${esc(name)} domani</h2>
    <p>${esc(dayText(name, w, 1))}</p>
    <h2>Previsioni meteo ${esc(name)} a 7 giorni</h2>
    <div class="guide-table"><table>
      <thead><tr><th scope="col">Giorno</th><th scope="col">Cielo</th><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Pioggia</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <h2>Domande frequenti sul meteo a ${esc(name)}</h2>
    <h3>Piove oggi a ${esc(name)}?</h3>
    <p>${(d.precipitation_probability_max[0] ?? 0) >= 50 ? `Sì, è probabile: la probabilità di pioggia oggi a ${esc(name)} è del ${d.precipitation_probability_max[0]}%.` : `Difficile: oggi a ${esc(name)} la probabilità di pioggia è del ${d.precipitation_probability_max[0] ?? 0}%.`}</p>
    <h3>Quando pioverà a ${esc(name)} nei prossimi giorni?</h3>
    <p>${wet.length ? `La pioggia è probabile ${wet.map(dayName).join(", ")}.` : `Nei prossimi 7 giorni non sono previste piogge significative a ${esc(name)}.`}</p>
    <h3>Qual è il giorno più caldo della settimana a ${esc(name)}?</h3>
    <p>${cap(dayName(hottest))}, con una massima di ${round(d.temperature_2m_max[hottest])}°.</p>
    ${links}
  </section>`;
}

function homeGuide() {
  const { regions, places } = atlas();
  return `<section id="guida" class="guide full" aria-labelledby="guide-title">
    <h2 id="guide-title">Meteo Italia: le previsioni per la tua città</h2>
    <p>Cielo è il meteo che ti risponde: una frase chiara su cosa aspettarti, la pioggia delle prossime ore, il momento giusto per uscire e quanto fidarti della previsione. Senza pubblicità e senza titoli allarmistici, per ${places.length.toLocaleString("it-IT")} località italiane.</p>
    <h2>Meteo nelle principali città</h2>
    <ul class="guide-links">${places.slice(0, 30).map((p) => `<li><a href="/meteo/${p.slug}">Meteo ${esc(p.name)}</a></li>`).join("")}</ul>
    <h2>Meteo per regione</h2>
    <ul class="guide-links">${regions.map((r) => `<li><a href="/regioni/${r.slug}">Meteo ${esc(r.name)}</a></li>`).join("")}</ul>
  </section>`;
}

/* ---------- Pagine con l'app ---------- */

function appPage({ meta, place, guide }, base) {
  let html = page();
  html = html.replace(/<!--head:start-->[\s\S]*?<!--head:end-->/, head(meta, base));
  html = html.replace("<!--guide-->", guide ?? "");
  if (place) {
    const data = { slug: place.slug, name: place.name, admin: place.region.name, country: "Italia", lat: +place.lat.toFixed(2), lon: +place.lon.toFixed(2) };
    html = html.replace('<body data-mode="day">', `<body data-mode="day" data-place="${esc(JSON.stringify(data))}">`)
      .replace(/<h1 id="place">[\s\S]*?<\/h1>/, `<h1 id="place">Meteo ${esc(place.name)}<small>${esc(place.region.name)}, Italia</small></h1>`);
  }
  return html;
}

async function cityPage(place, base) {
  let w = null;
  try { w = await fetchForecast(place.lat, place.lon); } catch (err) { console.error(`meteo ${place.slug}:`, err.message); }
  const url = `/meteo/${place.slug}`, { name, region } = place;
  const description = w
    ? `Meteo ${name} oggi: ${label(w.daily.weather_code[0])}, ${round(w.daily.temperature_2m_min[0])}°/${round(w.daily.temperature_2m_max[0])}°, pioggia ${w.daily.precipitation_probability_max[0] ?? 0}%. Previsioni ora per ora, domani e a 7 giorni, vento e pioggia sulla mappa. Senza pubblicità.`
    : `Previsioni meteo per ${name} (${region.name}): oggi, domani, ora per ora e a 7 giorni, con vento e pioggia sulla mappa. Chiare e senza pubblicità.`;
  const meta = {
    title: `Meteo ${name}: previsioni oggi, domani e 7 giorni | Cielo`, description, canonical: base + url,
    ld: [
      breadcrumbs(base, [["Meteo Italia", "/"], [region.name, `/regioni/${region.slug}`], [name, url]]),
      { "@context": "https://schema.org", "@type": "WebPage", name: `Meteo ${name}`, url: base + url, inLanguage: "it", dateModified: new Date().toISOString(),
        isPartOf: { "@type": "WebSite", name: "Cielo", url: base + "/" },
        about: { "@type": "City", name, containedInPlace: { "@type": "AdministrativeArea", name: region.name }, geo: { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lon } } },
    ],
  };
  return { html: appPage({ meta, place, guide: cityGuide(place, w) }, base), fresh: !!w };
}

function homePage(base, params) {
  const custom = params.has("lat") && params.has("lon"); // link a una località fuori elenco: non va indicizzato
  const meta = {
    title: "Cielo — Meteo Italia: previsioni chiare, senza pubblicità",
    description: "Il meteo che ti risponde: cosa aspettarti oggi in una frase, pioggia nelle prossime ore, previsioni a 7 giorni con affidabilità, vento, mare e mappa della pioggia. Per tutti i comuni italiani, senza pubblicità.",
    canonical: base + "/", noindex: custom,
    ld: [{ "@context": "https://schema.org", "@type": "WebSite", name: "Cielo", alternateName: "Cielo Meteo", url: base + "/", inLanguage: "it", description: "Previsioni meteo chiare per tutti i comuni italiani." }],
  };
  return appPage({ meta, guide: custom ? "" : homeGuide() }, base);
}

/* ---------- Pagine di solo testo (elenchi, documenti, errore) ---------- */

function shell({ meta, body }, base) {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  ${head(meta, base)}
  <meta name="theme-color" content="#F3EEE4">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css">
</head>
<body data-mode="day">
  <div class="wrap">
    <header class="top">
      <a class="brand" href="/" aria-label="Cielo, home">cielo<i></i></a>
      <nav class="site-nav" aria-label="Sezioni"><a href="/">Meteo adesso</a><a href="/meteo">Tutte le regioni</a><a href="/come-funziona">Come funziona</a></nav>
    </header>
    <main class="doc">${body}</main>
    <footer class="foot"><div class="foot-in">
      <div class="foot-brand"><p class="brand">cielo<i></i></p><p>Il meteo che ti risponde: prima cosa fare, poi i numeri.</p></div>
      <div><h2>Esplora</h2><p><a href="/">Meteo adesso</a> · <a href="/meteo">Tutte le regioni</a> · <a href="/come-funziona">Come funziona</a> · <a href="/privacy">Privacy</a></p></div>
      <div><h2>In chiaro</h2><p>Nessuna pubblicità, nessun tracciamento. Dati di <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).</p></div>
    </div></footer>
  </div>
</body>
</html>`;
}

function directoryPage(base) {
  const { regions } = atlas();
  const body = `<h1>Meteo Italia, regione per regione</h1>
    <p class="lede">Scegli la regione per vedere le previsioni di tutte le sue località.</p>
    ${regions.map((r) => `<section><h2><a href="/regioni/${r.slug}">Meteo ${esc(r.name)}</a></h2>
      <ul class="guide-links">${r.places.slice(0, 8).map((p) => `<li><a href="/meteo/${p.slug}">${esc(p.name)}</a></li>`).join("")}</ul></section>`).join("")}`;
  return shell({ meta: { title: "Meteo Italia per regione: tutte le località | Cielo", description: "Previsioni meteo per tutte le regioni e i comuni italiani: scegli la regione e trova la tua località.", canonical: base + "/meteo", ld: [breadcrumbs(base, [["Meteo Italia", "/"], ["Regioni", "/meteo"]])] }, body }, base);
}

function regionPage(region, base) {
  const url = `/regioni/${region.slug}`;
  const sorted = [...region.places].sort((a, b) => a.name.localeCompare(b.name, "it"));
  const body = `<p class="crumbs"><a href="/">Meteo Italia</a> › <a href="/meteo">Regioni</a> › ${esc(region.name)}</p>
    <h1>Meteo ${esc(region.name)}</h1>
    <p class="lede">Previsioni del tempo per ${region.places.length.toLocaleString("it-IT")} località in ${esc(region.name)}: oggi, domani e a 7 giorni.</p>
    <h2>Le città principali</h2>
    <ul class="guide-links">${region.places.slice(0, 16).map((p) => `<li><a href="/meteo/${p.slug}">Meteo ${esc(p.name)}</a></li>`).join("")}</ul>
    <h2>Tutte le località, in ordine alfabetico</h2>
    <ul class="guide-links dense">${sorted.map((p) => `<li><a href="/meteo/${p.slug}">${esc(p.name)}</a></li>`).join("")}</ul>`;
  return shell({ meta: { title: `Meteo ${region.name}: previsioni per tutte le località | Cielo`, description: `Previsioni meteo in ${region.name}: ${region.places.slice(0, 5).map((p) => p.name).join(", ")} e altre ${region.places.length - 5} località. Oggi, domani e a 7 giorni.`, canonical: base + url, ld: [breadcrumbs(base, [["Meteo Italia", "/"], ["Regioni", "/meteo"], [region.name, url]])] }, body }, base);
}

function docPage(doc, slug, base) {
  return shell({ meta: { title: `${doc.title} | Cielo`, description: doc.description, canonical: `${base}/${slug}`, noindex: !!doc.noindex }, body: doc.html }, base);
}

function notFound(base) {
  const { places } = atlas();
  const body = `<h1>Questa pagina non esiste</h1>
    <p class="lede">Forse l'indirizzo è cambiato o la località non è nel nostro elenco. Puoi cercarla dalla <a href="/">home</a> oppure partire da qui:</p>
    <ul class="guide-links">${places.slice(0, 20).map((p) => `<li><a href="/meteo/${p.slug}">Meteo ${esc(p.name)}</a></li>`).join("")}</ul>
    <p><a href="/meteo">Tutte le regioni</a></p>`;
  return shell({ meta: { title: "Pagina non trovata | Cielo", description: "La pagina cercata non esiste.", canonical: base + "/", noindex: true }, body }, base);
}

/* ---------- Ingresso ---------- */

const DAY = "public, s-maxage=86400, stale-while-revalidate=604800";

export default async function handler(req, res) {
  const base = siteUrl(req);
  const params = new URL(req.url, "http://localhost").searchParams;
  const send = (status, html, cache) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", cache);
    return res.status(status).send(html);
  };

  try {
    const { bySlug, byRegion } = atlas();
    if (params.has("slug")) {
      const place = bySlug.get(params.get("slug"));
      if (!place) return send(404, notFound(base), "public, s-maxage=3600");
      const { html, fresh } = await cityPage(place, base);
      // Con i dati: mezz'ora di cache. Senza (servizio meteo irraggiungibile): si riprova presto.
      return send(200, html, fresh ? "public, s-maxage=1800, stale-while-revalidate=3600" : "public, s-maxage=120");
    }
    if (params.has("region")) {
      const region = byRegion.get(params.get("region"));
      return region ? send(200, regionPage(region, base), DAY) : send(404, notFound(base), "public, s-maxage=3600");
    }
    const view = params.get("view");
    if (view === "directory") return send(200, directoryPage(base), DAY);
    if (view === "404") return send(404, notFound(base), "public, s-maxage=3600");
    if (view && DOCS[view]) return send(200, docPage(DOCS[view], view, base), DAY);
    if (view) return send(404, notFound(base), "public, s-maxage=3600");
    return send(200, homePage(base, params), "public, s-maxage=3600, stale-while-revalidate=86400");
  } catch (err) {
    console.error(err);
    return send(500, "<!doctype html><meta charset=utf-8><title>Errore</title><p>Qualcosa è andato storto. Riprova tra poco.</p>", "no-store");
  }
}

/* Cielo — logica dell'app. Nessuna dipendenza, nessuna build. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DEFAULT_PLACE = { name: "Roma", admin: "Lazio", country: "Italia", lat: 41.89, lon: 12.48 };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    place: null,
    data: null,        // previsioni Open-Meteo (giornaliere già allineate a "oggi")
    air: null,         // qualità dell'aria e pollini
    sea: null,         // onde e temperatura dell'acqua, solo vicino alla costa
    trust: null,       // affidabilità per giorno (1–3), dal confronto tra modelli
    nowIndex: 0,       // indice dell'ora corrente negli array orari
    selectedDay: 0,
    headline: "",
    summary: null,     // { title, text, ai } per il momento attuale
    preview: null,     // indice orario che si sta guardando nel "viaggio nel tempo"
    art: "",
    aiAvailable: null, // null = non ancora verificato
    requestId: 0,
  };

  /* ---------- Utilità ---------- */

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage non disponibile */ }
    },
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const round = (n) => Math.round(n);
  const comma = (n, digits = 1) => n.toFixed(digits).replace(".", ",");
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const hourOf = (iso) => iso.slice(11, 13);
  const hhmm = (iso) => iso.slice(11, 16);
  const samePlace = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;
  const gradi = (n) => `${n} ${Math.abs(n) === 1 ? "grado" : "gradi"}`;

  async function getJSON(url, { timeout = 12000, signal } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function kmBetween(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }

  let toastTimer = 0;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- Codici meteo (WMO) ---------- */

  const LABELS = {
    0: "Sereno", 1: "Prevalentemente sereno", 2: "Parzialmente nuvoloso", 3: "Coperto",
    45: "Nebbia", 48: "Nebbia con brina",
    51: "Pioviggine leggera", 53: "Pioviggine", 55: "Pioviggine intensa", 56: "Pioviggine gelata", 57: "Pioviggine gelata",
    61: "Pioggia debole", 63: "Pioggia", 65: "Pioggia forte", 66: "Pioggia gelata", 67: "Pioggia gelata",
    71: "Neve debole", 73: "Neve", 75: "Neve forte", 77: "Nevischio",
    80: "Rovesci leggeri", 81: "Rovesci", 82: "Rovesci violenti", 85: "Rovesci di neve", 86: "Rovesci di neve",
    95: "Temporale", 96: "Temporale con grandine", 99: "Temporale con grandine",
  };
  const label = (code) => LABELS[code] ?? "—";

  function kind(code) {
    if (code <= 1) return "clear";
    if (code === 2) return "partly";
    if (code === 3) return "cloudy";
    if (code <= 48) return "fog";
    if (code <= 57) return "drizzle";
    if (code <= 67) return "rain";
    if (code <= 77) return "snow";
    if (code <= 82) return "rain";
    if (code <= 86) return "snow";
    return "storm";
  }
  const isWet = (code) => ["drizzle", "rain", "storm"].includes(kind(code));
  const isSnow = (code) => kind(code) === "snow";

  /* ---------- Icone: forme piene con contorno a inchiostro ---------- */

  const CLOUD = "M20 46h26a10 10 0 0 0 1-20 14 14 0 0 0-27-3 11.5 11.5 0 0 0 0 23z";
  const INK = 'stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

  function sun(cx, cy, r) {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, cos = Math.cos(a), sin = Math.sin(a);
      rays += `<line x1="${(cx + cos * (r + 5)).toFixed(1)}" y1="${(cy + sin * (r + 5)).toFixed(1)}" x2="${(cx + cos * (r + 10)).toFixed(1)}" y2="${(cy + sin * (r + 10)).toFixed(1)}"/>`;
    }
    return `<g ${INK}>${rays}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFC533"/></g>`;
  }
  const moon = (tx, ty, s) =>
    `<path transform="translate(${tx} ${ty}) scale(${s})" d="M38 8a22 22 0 1 0 18 34A18 18 0 0 1 38 8z" fill="#F6E7A1" ${INK}/>`;
  const cloud = (transform = "") => `<path transform="${transform}" d="${CLOUD}" fill="var(--cloud)" ${INK}/>`;
  const drops = (n) => {
    const xs = n === 2 ? [27, 41] : [23, 34, 45];
    return `<g stroke="var(--drop)" stroke-width="3.5" stroke-linecap="round">${xs.map((x) => `<line x1="${x}" y1="48" x2="${x - 3}" y2="57"/>`).join("")}</g>`;
  };
  const flakes = () => `<g fill="currentColor">${[[22, 51], [33, 56], [44, 51]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join("")}</g>`;

  function icon(code, isDay = true) {
    let body;
    switch (kind(code)) {
      case "clear":
        body = isDay ? sun(32, 32, 12) : moon(0, 0, 1);
        break;
      case "partly":
        body = (isDay ? sun(23, 23, 8) : moon(4, 2, 0.55)) + cloud("translate(10 14) scale(.82)");
        break;
      case "cloudy":
        body = cloud("translate(16 2) scale(.68)") + cloud("translate(0 7)");
        break;
      case "fog":
        body = cloud("translate(0 -7)") + `<g ${INK}><line x1="14" y1="48" x2="50" y2="48"/><line x1="20" y1="56" x2="44" y2="56"/></g>`;
        break;
      case "drizzle":
        body = cloud("translate(0 -8)") + drops(2);
        break;
      case "rain":
        body = cloud("translate(0 -8)") + drops(3);
        break;
      case "snow":
        body = cloud("translate(0 -8)") + flakes();
        break;
      default: // temporale
        body = cloud("translate(0 -8)") + `<path d="M34 39l-9 12h7l-3 11 11-15h-7l4-8z" fill="#FFC533" ${INK} stroke-width="2.5"/>`;
    }
    return `<svg viewBox="0 0 64 64" role="img" aria-label="${esc(label(code))}">${body}</svg>`;
  }

  function artFor(code, isDay) {
    switch (kind(code)) {
      case "clear": return isDay ? "sun" : "night";
      case "partly": return isDay ? "partly" : "night";
      case "cloudy": return isDay ? "cloud" : "night-cloud";
      case "fog": return isDay ? "fog" : "night-cloud";
      case "drizzle": case "rain": return "rain";
      case "snow": return isDay ? "snow" : "night-cloud";
      default: return "storm";
    }
  }

  /* ---------- La scena animata dentro il blocco cielo ---------- */

  const rnd = (a, b) => a + Math.random() * (b - a);
  const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join("");
  const layer = (depth, html) => `<div class="a-layer" style="--d:${depth}">${html}</div>`;

  const clouds = (n) => many(n, (i) => {
    const w = rnd(150, 300), t = rnd(60, 120);
    return `<i class="a-cloud" style="--w:${w.toFixed(0)}px;--h:${(w * 0.3).toFixed(0)}px;--y:${(4 + i * (62 / n) + rnd(0, 8)).toFixed(0)}%;--t:${t.toFixed(0)}s;--dl:-${rnd(0, t).toFixed(0)}s"></i>`;
  });
  const rain = (n) => many(n, () => {
    const t = rnd(0.55, 1.1);
    return `<i class="a-drop${Math.random() < 0.3 ? " hi" : ""}" style="left:${rnd(0, 125).toFixed(1)}%;--h:${rnd(14, 34).toFixed(0)}px;--t:${t.toFixed(2)}s;--dl:-${rnd(0, t).toFixed(2)}s"></i>`;
  });
  const sunDisc = (rings) => `<i class="a-disc"></i>` + (rings ? `<i class="a-disc a-ring"></i><i class="a-disc a-ring"></i>` : "");

  const SCENES = {
    sun: () => layer(6, `<i class="a-burst"></i>`) + layer(16, sunDisc(true)),
    partly: () => layer(6, `<i class="a-burst"></i>`) + layer(14, sunDisc(false)) + layer(26, clouds(3)),
    cloud: () => layer(10, clouds(3)) + layer(24, clouds(3)),
    "night-cloud": () => layer(10, clouds(3)) + layer(24, clouds(2)),
    night: () => layer(5, many(54, () => {
      const t = rnd(2, 6);
      return `<i class="a-star" style="left:${rnd(0, 100).toFixed(1)}%;top:${rnd(0, 100).toFixed(1)}%;--s:${rnd(1.5, 4).toFixed(1)}px;--t:${t.toFixed(1)}s;--dl:-${rnd(0, t).toFixed(1)}s"></i>`;
    }) + `<i class="a-shoot"></i>`) + layer(18, `<i class="a-disc a-moon"></i><i class="a-disc a-moon-cut"></i>`),
    rain: () => layer(8, rain(34)) + layer(22, rain(22)),
    storm: () => layer(0, `<i class="a-flash"></i>`) + layer(8, rain(40)) + layer(22, rain(26)),
    snow: () => layer(8, many(46, () => {
      const t = rnd(7, 15);
      return `<i class="a-flake" style="left:${rnd(0, 100).toFixed(1)}%;--s:${rnd(5, 13).toFixed(0)}px;--t:${t.toFixed(1)}s;--dl:-${rnd(0, t).toFixed(1)}s"></i>`;
    })),
    fog: () => layer(12, many(6, (i) =>
      `<i class="a-band" style="--y:${8 + i * 16}%;--h:${rnd(14, 34).toFixed(0)}px;--t:${rnd(9, 18).toFixed(0)}s;--dl:-${rnd(0, 9).toFixed(0)}s"></i>`)),
  };

  function renderArt(art) {
    if (art === state.art) return;
    state.art = art;
    const sky = $("sky");
    sky.dataset.art = art;
    sky.querySelector(".sky-art").innerHTML = SCENES[art]();
  }

  // Leggera parallasse: la scena segue il puntatore.
  $("sky").addEventListener("pointermove", (e) => {
    if (reducedMotion || e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    const artEl = e.currentTarget.querySelector(".sky-art");
    artEl.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    artEl.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  });

  /* ---------- Dati ---------- */

  const coords = ({ lat, lon }) => ({ latitude: lat, longitude: lon, timezone: "auto" });

  function forecastURL(place) {
    const p = new URLSearchParams({
      ...coords(place), forecast_days: 7, past_days: 1, wind_speed_unit: "kmh",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      minutely_15: "precipitation",
      hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,is_day,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_gusts_10m_max",
    });
    return `https://api.open-meteo.com/v1/forecast?${p}`;
  }

  function airURL(place) {
    const p = new URLSearchParams({
      ...coords(place), forecast_days: 1,
      current: "european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone",
      hourly: "alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
    });
    return `https://air-quality-api.open-meteo.com/v1/air-quality?${p}`;
  }

  function seaURL(place) {
    const p = new URLSearchParams({
      ...coords(place), forecast_days: 7,
      current: "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,sea_surface_temperature",
      hourly: "wave_height,wave_direction,wave_period,sea_surface_temperature",
    });
    return `https://marine-api.open-meteo.com/v1/marine?${p}`;
  }

  // Stessa previsione chiesta a tre modelli diversi: se concordano, ci si può fidare di più.
  function modelsURL(place) {
    const p = new URLSearchParams({
      ...coords(place), forecast_days: 7,
      daily: "temperature_2m_max,precipitation_sum",
      models: "ecmwf_ifs025,icon_seamless,gfs_seamless",
    });
    return `https://api.open-meteo.com/v1/forecast?${p}`;
  }

  // Con past_days=1 il primo giorno è ieri: lo mettiamo da parte e allineiamo tutto a oggi.
  function alignToToday(data) {
    const today = data.current.time.slice(0, 10);
    const t0 = Math.max(0, data.daily.time.indexOf(today));
    data.yesterday = t0 > 0 ? { max: data.daily.temperature_2m_max[t0 - 1], min: data.daily.temperature_2m_min[t0 - 1] } : null;
    for (const key of Object.keys(data.daily)) {
      if (Array.isArray(data.daily[key])) data.daily[key] = data.daily[key].slice(t0);
    }
    return data;
  }

  function trustFrom(models, days) {
    if (!models?.daily) return null;
    const series = (prefix) => Object.keys(models.daily).filter((k) => k.startsWith(prefix + "_")).map((k) => models.daily[k]);
    const temps = series("temperature_2m_max"), rains = series("precipitation_sum");
    if (temps.length < 2) return null;
    return days.map((day) => {
      const i = models.daily.time.indexOf(day);
      if (i < 0) return null;
      const t = temps.map((s) => s[i]).filter((v) => v != null);
      const r = rains.map((s) => s[i]).filter((v) => v != null);
      if (t.length < 2) return null;
      const spread = Math.max(...t) - Math.min(...t);
      const split = r.some((v) => v >= 1) && r.some((v) => v < 0.2); // qualcuno dice pioggia, qualcuno asciutto
      const heavy = Math.max(0, ...r) >= 5;
      if (spread <= 2 && !split) return 3;
      if (spread <= 4 && !(split && heavy)) return 2;
      return 1;
    });
  }

  async function load(place, { remember = true } = {}) {
    const id = ++state.requestId;
    state.place = place;
    $("status").hidden = true;
    $("app").setAttribute("aria-busy", "true");
    renderFavs();

    try {
      const optional = (url) => getJSON(url).catch(() => null);
      const [data, air, sea, models] = await Promise.all([
        getJSON(forecastURL(place)), optional(airURL(place)), optional(seaURL(place)), optional(modelsURL(place)),
      ]);
      if (id !== state.requestId) return;

      state.data = alignToToday(data);
      state.air = air;
      // Il servizio marino risponde con la cella di mare più vicina: la mostriamo solo se è davvero vicina.
      const nearSea = sea?.current?.wave_height != null && kmBetween(place.lat, place.lon, sea.latitude, sea.longitude) <= 40;
      state.sea = nearSea ? { now: sea.current, hourly: sea.hourly, index: new Map((sea.hourly?.time ?? []).map((t, i) => [t, i])) } : null;
      state.trust = trustFrom(models, data.daily.time);
      factsCache = new Map();
      state.selectedDay = 0;
      state.preview = null;
      state.summary = null;
      const key = data.current.time.slice(0, 13);
      state.nowIndex = Math.max(0, data.hourly.time.findIndex((t) => t.slice(0, 13) === key));

      if (remember) store.set("cielo:last", place);
      const url = new URL(location.href);
      url.search = new URLSearchParams({ lat: place.lat, lon: place.lon, n: place.name }).toString();
      history.replaceState(null, "", url);
      document.title = `${place.name} ${round(data.current.temperature_2m)}° — Cielo`;

      render();
      loadSummary(id);
    } catch (err) {
      if (id !== state.requestId) return;
      console.error(err);
      showStatus("Non riesco a caricare il meteo in questo momento.", () => load(place, { remember }));
    }
  }

  function showStatus(message, retry) {
    const el = $("status");
    el.textContent = message;
    if (retry) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = "Riprova";
      b.onclick = retry;
      el.append(b);
    }
    el.hidden = false;
  }

  /* ---------- Finestre temporali ---------- */

  // Indici delle prossime `hours` ore a partire da adesso.
  function ahead(hours) {
    const h = state.data.hourly, from = state.nowIndex;
    const idx = [];
    for (let i = from; i < Math.min(from + hours, h.time.length); i++) idx.push(i);
    return idx;
  }

  const isToday = (iso) => iso.slice(0, 10) === state.data.current.time.slice(0, 10);
  const when = (iso) => {
    const hour = Number(hourOf(iso));
    return (isToday(iso) ? "" : "domani ") + (hour === 0 ? "verso mezzanotte" : hour === 1 ? "verso l'una" : `verso le ${hour}`);
  };

  function nextRain(hours = 24) {
    const h = state.data.hourly;
    return ahead(hours).find((i) => (h.precipitation_probability[i] ?? 0) >= 50);
  }

  /* ---------- Render ---------- */

  function render() {
    renderSky();
    $("fav-toggle").hidden = false;
    $("share").hidden = false;
    // Ogni sezione è indipendente: se una fallisce (dato mancante, servizio giù) le altre restano in piedi.
    for (const section of [renderFavs, renderNowcast, renderAlerts, renderMine, renderHours, renderDays, renderMoments, renderPlan, renderSeaWind, renderHealth, renderTiles]) {
      try { section(); } catch (err) { console.error(`${section.name}:`, err); }
    }

    const app = $("app");
    app.setAttribute("aria-busy", "false");
    app.classList.remove("ready");
    void app.offsetWidth; // riavvia l'animazione d'ingresso
    app.classList.add("ready");
  }

  let shownTemp = null, tempTimer = 0;
  function countTo(value) {
    const el = $("now-temp"), from = shownTemp ?? value;
    cancelAnimationFrame(tempTimer);
    shownTemp = value;
    if (reducedMotion || from === value) { el.textContent = `${value}°`; return; }
    const start = performance.now();
    const step = (now) => {
      const k = Math.min((now - start) / 600, 1);
      el.textContent = `${Math.round(from + (value - from) * (1 - (1 - k) ** 3))}°`;
      if (k < 1) tempTimer = requestAnimationFrame(step);
    };
    tempTimer = requestAnimationFrame(step);
  }

  function setHeadline(text) {
    const el = $("headline");
    el.setAttribute("aria-label", text);
    el.innerHTML = text.split(" ").map((w, i) => `<span class="w" aria-hidden="true"><span style="--i:${i}">${esc(w)}</span></span>`).join(" ");
  }

  /* Il blocco cielo mostra adesso oppure, durante il "viaggio nel tempo", l'ora scelta. */
  function renderSky() {
    const { data, place, preview } = state;
    const c = data.current, d = data.daily, h = data.hourly;
    const at = preview != null;
    const code = at ? h.weather_code[preview] : c.weather_code;
    const day = !!(at ? h.is_day[preview] : c.is_day);
    const iso = at ? h.time[preview] : c.time;

    document.body.dataset.mode = day ? "day" : "night";
    renderArt(artFor(code, day));
    try { radarSync(); } catch { /* il radar è facoltativo */ }
    document.querySelector('meta[name="theme-color"]').content = day ? "#F3EEE4" : "#101116";

    const sub = [place.admin, place.country].filter((x) => x && x !== place.name).join(", ");
    $("place").innerHTML = esc(place.name) + (sub ? `<small>${esc(sub)}</small>` : "");
    $("when").textContent = new Date(iso).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }) + " · " + hhmm(iso);
    countTo(round(at ? h.temperature_2m[preview] : c.temperature_2m));
    $("now-icon").innerHTML = icon(code, day);
    $("now-label").textContent = `${label(code)} · percepiti ${round(at ? h.apparent_temperature[preview] : c.apparent_temperature)}°`;

    if (at) {
      $("now-meta").textContent = `Pioggia ${h.precipitation_probability[preview] ?? 0}% · Vento ${round(h.wind_speed_10m[preview])} km/h`;
    } else {
      const meta = [`Max ${round(d.temperature_2m_max[0])}°`, `Min ${round(d.temperature_2m_min[0])}°`];
      if (data.yesterday) {
        const delta = round(d.temperature_2m_max[0] - data.yesterday.max);
        meta.push(Math.abs(delta) < 2 ? "come ieri" : `${Math.abs(delta)}° più ${delta > 0 ? "caldo" : "fresco"} di ieri`);
      }
      $("now-meta").textContent = meta.join(" · ");
    }
    renderLead();
  }

  function renderLead(type = false) {
    const { data, preview, summary } = state;
    const text = $("ai-text");
    clearInterval(typing);
    $("back-now").hidden = preview == null;
    $("nowcast").classList.toggle("off", preview != null);

    if (preview != null) {
      const h = data.hourly, iso = h.time[preview];
      const hour = Number(hourOf(iso));
      const dayWord = isToday(iso) ? "" : new Date(iso).toLocaleDateString("it-IT", { weekday: "long" }) + " ";
      const head = `${dayWord}${hour === 1 ? "all'una" : `alle ${hour}`}: ${label(h.weather_code[preview]).toLowerCase()}.`;
      setHeadline(head[0].toUpperCase() + head.slice(1));
      text.textContent = `${round(h.temperature_2m[preview])}° sul termometro, ${round(h.apparent_temperature[preview])}° percepiti. Umidità ${round(h.relative_humidity_2m[preview])}%, raffiche fino a ${round(h.wind_gusts_10m[preview] ?? h.wind_speed_10m[preview])} km/h.`;
      $("ai-badge").hidden = true;
    } else if (summary) {
      setHeadline(summary.title);
      if (type) typeInto(text, summary.text); else text.textContent = summary.text;
      $("ai-badge").hidden = !summary.ai;
    } else {
      $("headline").innerHTML = '<span class="sk" style="width:90%;height:.9em"></span><span class="sk" style="width:60%;height:.9em"></span>';
      text.innerHTML = '<span class="sk sk-line"></span><span class="sk sk-line short"></span>';
      $("ai-badge").hidden = true;
    }
  }

  function travelTo(i) {
    state.preview = i === state.nowIndex ? null : i;
    renderSky();
    markHour();
    if (state.preview != null && $("sky").getBoundingClientRect().bottom < 120) {
      $("sky").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }
  $("back-now").addEventListener("click", () => travelTo(state.nowIndex));

  /* Pioggia nelle prossime due ore, a passi di 15 minuti. */
  function minutes(m) {
    if (m < 60) return `${m} minuti`;
    if (m === 60) return "un'ora";
    if (m === 90) return "un'ora e mezza";
    return m < 90 ? "poco più di un'ora" : "quasi due ore";
  }

  function renderNowcast() {
    const m = state.data.minutely_15, c = state.data.current;
    const box = $("nowcast");
    const start = m?.time?.findIndex((t) => t >= c.time) ?? -1;
    if (start < 0) { box.hidden = true; return; }

    const steps = m.precipitation.slice(start, start + 8).map((v) => v ?? 0);
    const wet = steps.map((v) => v >= 0.1);
    const what = isSnow(c.weather_code) || c.temperature_2m <= 0.5 ? "Neve" : "Pioggia";
    let text;
    if (!wet.includes(true)) {
      text = "Asciutto per le prossime 2 ore";
    } else if (wet[0]) {
      const stop = wet.indexOf(false);
      text = stop < 0 ? `${what} per almeno altre 2 ore` : `${what} in corso: pausa tra ${minutes(stop * 15)}`;
    } else {
      text = `${what} in arrivo tra ${minutes(wet.indexOf(true) * 15)}`;
    }
    $("nowcast-bars").innerHTML = steps.map((v, i) =>
      `<i class="${wet[i] ? "wet" : ""}" style="height:${3 + Math.round(Math.min(v / 1.5, 1) * 25)}px"></i>`).join("");
    $("nowcast-text").textContent = text;
    box.hidden = false;
  }

  /* Segnalazioni calcolate sui dati: non sono allerte ufficiali. */
  function renderAlerts() {
    const { data, air } = state;
    const c = data.current, d = data.daily, h = data.hourly;
    const out = [];
    const dayWord = ["oggi", "domani"];

    for (const i of [0, 1]) {
      if (d.weather_code[i] >= 95) { out.push(`Temporali ${dayWord[i]}: meglio evitare spazi aperti e alberi isolati.`); break; }
    }
    for (const i of [0, 1]) {
      if ((d.wind_gusts_10m_max[i] ?? 0) >= 60) { out.push(`Raffiche di vento fino a ${round(d.wind_gusts_10m_max[i])} km/h ${dayWord[i]}.`); break; }
    }
    for (const i of [0, 1]) {
      if ((d.snowfall_sum?.[i] ?? 0) >= 1) { out.push(`Neve ${dayWord[i]}: circa ${round(d.snowfall_sum[i])} cm.`); break; }
      if ((d.precipitation_sum[i] ?? 0) >= 30) { out.push(`Pioggia abbondante ${dayWord[i]}: circa ${round(d.precipitation_sum[i])} mm.`); break; }
    }
    if (d.temperature_2m_max[0] >= 35) out.push(`Caldo intenso: massima di ${round(d.temperature_2m_max[0])}°. Evita le ore centrali.`);
    const night = Math.min(...ahead(18).map((i) => h.temperature_2m[i]));
    if (night <= 0) out.push(`Gelo nelle prossime ore: fino a ${round(night)}°. Attenzione al ghiaccio.`);
    if ((d.uv_index_max[0] ?? 0) >= 8 && c.is_day) out.push(`UV molto alto (${round(d.uv_index_max[0])}): crema solare e ombra nelle ore centrali.`);
    if (kind(c.weather_code) === "fog") out.push("Nebbia: visibilità ridotta, prudenza alla guida.");
    if ((air?.current?.european_aqi ?? 0) > 80) out.push("Aria inquinata: meglio limitare gli sforzi all'aperto.");

    $("alerts-list").innerHTML = out.map((t) => `<li>${esc(t)}</li>`).join("");
    $("alerts").hidden = !out.length;
  }

  function renderHours() {
    const h = state.data.hourly;
    const day = state.selectedDay;
    let from;
    if (day === 0) from = state.nowIndex;
    else from = h.time.findIndex((t) => t.startsWith(state.data.daily.time[day]));
    const to = Math.min(from + 24, h.time.length);

    const temps = h.temperature_2m.slice(from, to);
    const lo = Math.min(...temps), span = Math.max(Math.max(...temps) - lo, 1);

    let html = "";
    for (let i = from; i < to; i++) {
      const isNow = day === 0 && i === from;
      const prob = h.precipitation_probability[i] ?? 0;
      const midnight = hourOf(h.time[i]) === "00" && i !== from;
      const time = isNow ? "Ora" : midnight
        ? new Date(h.time[i]).toLocaleDateString("it-IT", { weekday: "short" })
        : hourOf(h.time[i]);
      html += `<li><button type="button" data-i="${i}" aria-pressed="false"
          aria-label="${isNow ? "Adesso" : "Ore " + hourOf(h.time[i])}: ${esc(label(h.weather_code[i]))}, ${round(h.temperature_2m[i])}°, pioggia ${prob}%">
        <span class="h-time">${esc(time)}</span>
        ${icon(h.weather_code[i], !!h.is_day[i])}
        <span class="h-track"><span class="h-temp" style="--t:${((h.temperature_2m[i] - lo) / span).toFixed(2)}">${round(h.temperature_2m[i])}°</span></span>
        <span class="h-bar"><i style="--p:${prob};--n:${i - from}"></i></span>
        <span class="h-rain">${prob >= 20 ? prob + "%" : ""}</span>
      </button></li>`;
    }
    $("hours").innerHTML = html;
    $("hours-wrap").scrollLeft = 0;

    $("hourly-title").textContent = day === 0 ? "Ora per ora" : "Ora per ora · " + dayName(day, "long");
    $("back-today").hidden = day === 0;
    $("hours-hint").hidden = day !== 0;
    markHour();
    drawCurve(true);
  }

  function markHour() {
    const current = state.preview ?? state.nowIndex;
    document.querySelectorAll("#hours button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.i) === current)));
    document.querySelectorAll("#hours-curve circle").forEach((dot) => dot.classList.toggle("sel", Number(dot.dataset.i) === current));
  }

  // Curva morbida che passa sotto le temperature: i punti si leggono dalla pagina, così segue sempre il layout.
  function drawCurve(animate = false) {
    const list = $("hours"), svg = $("hours-curve");
    const box = list.getBoundingClientRect();
    if (!box.width) return;
    const pts = [...list.querySelectorAll("button")].map((b) => {
      const r = b.querySelector(".h-temp").getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.bottom - box.top + 9, i: b.dataset.i };
    });
    if (pts.length < 2) { svg.innerHTML = ""; return; }
    const floor = Math.max(...pts.map((p) => p.y)) + 18;

    let line = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[Math.max(k - 1, 0)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(k + 2, pts.length - 1)];
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      line += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    const area = `${line} L${pts.at(-1).x.toFixed(1)} ${floor} L${pts[0].x.toFixed(1)} ${floor} Z`;
    const top = Math.min(...pts.map((p) => p.y));
    const still = animate ? "" : ' style="animation:none;stroke-dashoffset:0;opacity:1"';

    svg.setAttribute("width", box.width);
    svg.setAttribute("height", box.height);
    svg.innerHTML = `<defs><linearGradient id="hours-fill" gradientUnits="userSpaceOnUse" x1="0" y1="${top.toFixed(0)}" x2="0" y2="${floor.toFixed(0)}">
        <stop offset="0" stop-color="var(--warm)" stop-opacity=".34"/><stop offset="1" stop-color="var(--warm)" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${area}"${still}/><path class="line" pathLength="1" d="${line}"${still}/>
      ${pts.map((p) => `<circle data-i="${p.i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"/>`).join("")}`;
    markHourDots();
  }
  const markHourDots = () => {
    const current = state.preview ?? state.nowIndex;
    document.querySelectorAll("#hours-curve circle").forEach((dot) => dot.classList.toggle("sel", Number(dot.dataset.i) === current));
  };
  addEventListener("resize", () => state.data && drawCurve());
  document.fonts?.ready.then(() => state.data && drawCurve());

  $("hours").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) travelTo(Number(b.dataset.i));
  });

  function dayName(i, weekday = "short") {
    if (i === 0) return "Oggi";
    if (i === 1 && weekday === "long") return "domani";
    return new Date(state.data.daily.time[i] + "T12:00").toLocaleDateString("it-IT", { weekday });
  }

  const TRUST = ["", "bassa", "media", "alta"];

  function renderDays() {
    const d = state.data.daily, trust = state.trust;
    const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
    const span = Math.max(hi - lo, 1);
    $("days").innerHTML = d.time.map((_, i) => {
      const min = d.temperature_2m_min[i], max = d.temperature_2m_max[i];
      const left = ((min - lo) / span) * 100, right = ((hi - max) / span) * 100;
      const prob = d.precipitation_probability_max[i] ?? 0;
      const t = trust?.[i];
      const meter = t ? `<span class="trust t${t}" title="Affidabilità ${TRUST[t]}"><i></i><i></i><i></i></span>` : "<span></span>";
      return `<li><button type="button" data-day="${i}" aria-pressed="${i === state.selectedDay}"
          aria-label="${esc(dayName(i, "long"))}: ${esc(label(d.weather_code[i]))}, minima ${round(min)}°, massima ${round(max)}°${t ? `, affidabilità ${TRUST[t]}` : ""}">
        <span class="d-name">${esc(dayName(i))}</span>
        ${icon(d.weather_code[i], true)}
        <span class="d-rain">${prob >= 20 ? prob + "%" : ""}</span>
        <span class="d-min">${round(min)}°</span>
        <span class="d-bar"><i style="left:${left.toFixed(1)}%;right:${right.toFixed(1)}%"></i></span>
        <span class="d-max">${round(max)}°</span>
        ${meter}
      </button></li>`;
    }).join("");
    $("trust-note").hidden = !trust;
  }

  /* ---------- Il momento giusto ---------- */

  const up = (x, a, b) => clamp01((x - a) / (b - a));      // 0 sotto a, 1 sopra b
  const down = (x, a, b) => 1 - up(x, a, b);               // 1 sotto a, 0 sopra b
  const band = (x, a, b, c, d) => Math.min(up(x, a, b), down(x, c, d));

  function moonIllumination(date = new Date()) {
    const phase = (((date.getTime() / 86400000 + 2440587.5 - 2451550.1) / 29.530588853) % 1 + 1) % 1;
    return { phase, lit: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
  }

  // Valore orario del mare (onde, direzione…) per l'ora indicata, se siamo vicino alla costa.
  function seaAt(key, iso) {
    const i = state.sea?.index.get(iso);
    return i == null ? null : state.sea.hourly[key]?.[i] ?? null;
  }

  const KN = 1 / 1.852;

  // I "fatti" di un'ora, calcolati una volta sola per caricamento.
  let factsCache = new Map();
  function hourFacts(i) {
    if (factsCache.has(i)) return factsCache.get(i);
    const h = state.data.hourly;
    const prob = h.precipitation_probability[i] ?? 0;
    const falling = isWet(h.weather_code[i]) || isSnow(h.weather_code[i]);
    const gusts = h.wind_gusts_10m[i] ?? h.wind_speed_10m[i];
    let rainSoon = 0; // probabilità massima di pioggia nelle 12 ore successive
    for (let k = i + 1; k <= Math.min(i + 12, h.time.length - 1); k++) rainSoon = Math.max(rainSoon, h.precipitation_probability[k] ?? 0);
    const facts = {
      i, hour: Number(hourOf(h.time[i])), prob, rainSoon,
      t: h.apparent_temperature[i], wind: h.wind_speed_10m[i], gusts, kn: h.wind_speed_10m[i] * KN, gustKn: gusts * KN,
      hum: h.relative_humidity_2m[i], clouds: h.cloud_cover[i] ?? 50, day: !!h.is_day[i],
      wave: seaAt("wave_height", h.time[i]) ?? 0, period: seaAt("wave_period", h.time[i]) ?? 0, water: seaAt("sea_surface_temperature", h.time[i]) ?? 0,
      moon: moonIllumination(new Date(h.time[i])).lit,
      dry: down(prob, 20, 60) * (falling ? 0.2 : 1),
      veryDry: down(prob, 10, 40) * (falling ? 0.1 : 1),
    };
    factsCache.set(i, facts);
    return facts;
  }

  // Ogni attività dà un voto da 0 a 1 a ciascuna ora. `min` = ore consecutive che servono.
  const ACTIVITIES = [
    // Sport
    { id: "sport", group: "Sport", name: "Sport all'aperto", min: 1, score: (f) => band(f.t, 0, 8, 24, 30) * f.dry * down(f.wind, 25, 45) * (f.day ? 1 : 0.7) },
    { id: "run", group: "Sport", name: "Corsa", min: 1, score: (f) => band(f.t, -2, 6, 20, 28) * f.dry * down(f.wind, 25, 45) },
    { id: "bike", group: "Sport", name: "Bici", min: 2, score: (f) => band(f.t, 3, 10, 26, 33) * f.dry * down(f.gusts, 30, 55) * (f.day ? 1 : 0.4) },
    { id: "walk", group: "Sport", name: "Camminata", min: 1, score: (f) => band(f.t, -2, 6, 26, 31) * f.dry * down(f.wind, 30, 50) },
    { id: "trek", group: "Sport", name: "Trekking", min: 4, score: (f) => (f.day ? band(f.t, 2, 9, 25, 31) * f.veryDry * down(f.gusts, 35, 60) : 0) },
    { id: "racket", group: "Sport", name: "Tennis e padel", min: 2, score: (f) => band(f.t, 5, 12, 28, 33) * f.veryDry * down(f.wind, 18, 32) * (f.day ? 1 : 0.8) },
    { id: "football", group: "Sport", name: "Calcetto", min: 2, score: (f) => band(f.t, 0, 8, 26, 32) * f.dry * down(f.wind, 30, 50) },
    // Tempo libero
    { id: "outdoor", group: "Tempo libero", name: "Stare all'aperto", min: 2, score: (f) => band(f.t, 8, 15, 28, 33) * f.dry * down(f.wind, 22, 40) },
    { id: "dog", group: "Tempo libero", name: "Passeggiata col cane", min: 1, score: (f) => band(f.t, -4, 4, 24, 30) * f.dry * down(f.wind, 30, 50) },
    { id: "table", group: "Tempo libero", name: "Tavolino all'aperto", min: 2, score: (f) => band(f.t, 10, 17, 28, 34) * f.dry * down(f.wind, 18, 35) },
    { id: "bbq", group: "Tempo libero", name: "Grigliata", min: 3, score: (f) => (f.hour >= 11 && f.hour <= 22 ? band(f.t, 8, 15, 30, 35) * f.veryDry * down(f.wind, 15, 30) : 0) },
    { id: "picnic", group: "Tempo libero", name: "Picnic", min: 3, score: (f) => (f.day ? band(f.t, 13, 19, 29, 34) * f.veryDry * down(f.wind, 15, 28) : 0) },
    { id: "trip", group: "Tempo libero", name: "Gita fuori porta", min: 6, score: (f) => (f.day ? band(f.t, 6, 13, 28, 34) * f.veryDry * down(f.wind, 25, 45) * (0.75 + 0.25 * down(f.clouds, 40, 95)) : 0) },
    { id: "moto", group: "Tempo libero", name: "Giro in moto", min: 2, score: (f) => (f.day ? band(f.t, 5, 12, 30, 36) * f.veryDry * down(f.gusts, 35, 60) : 0) },
    { id: "fishing", group: "Tempo libero", name: "Pesca", min: 3, score: (f) => band(f.t, 2, 10, 28, 34) * f.dry * down(f.wind, 18, 32) },
    { id: "stars", group: "Tempo libero", name: "Guardare le stelle", min: 2, score: (f) => (f.day || (f.hour >= 5 && f.hour <= 8) ? 0 : down(f.clouds, 15, 70) * f.dry * (1 - 0.4 * f.moon)) },
    // Casa
    { id: "laundry", group: "Casa", name: "Bucato steso", min: 4, score: (f) => (f.day ? f.dry * down(f.hum, 60, 90) * up(f.t, 2, 12) * (0.7 + 0.3 * up(f.wind, 3, 15)) : 0) },
    { id: "works", group: "Casa", name: "Lavori all'aperto", min: 4, score: (f) => (f.day ? band(f.t, 3, 9, 29, 34) * f.veryDry * down(f.hum, 70, 92) * down(f.wind, 20, 38) : 0) },
    { id: "carwash", group: "Casa", name: "Lavare l'auto", min: 1, score: (f) => (f.day ? f.veryDry * up(f.t, 3, 8) * down(f.rainSoon, 20, 50) : 0) },
    // Mare (solo vicino alla costa)
    { id: "beach", group: "Mare", name: "Spiaggia", min: 3, sea: true, score: (f) => (f.day ? up(f.t, 21, 27) * f.dry * down(f.wind, 20, 40) * down(f.wave, 0.8, 1.8) : 0) },
    { id: "swim", group: "Mare", name: "Bagno in mare", min: 1, sea: true, score: (f) => (f.day ? up(f.water, 18, 23) * up(f.t, 20, 26) * down(f.wave, 0.5, 1.2) * f.dry : 0) },
    { id: "sail", group: "Mare", name: "Vela", min: 3, sea: true, score: (f) => (f.day ? band(f.kn, 5, 9, 18, 25) * down(f.gustKn, 24, 34) * down(f.wave, 1.2, 2.2) * (0.6 + 0.4 * f.dry) : 0) },
    { id: "kite", group: "Mare", name: "Kite e windsurf", min: 2, sea: true, score: (f) => (f.day ? band(f.kn, 11, 15, 25, 32) * down(f.wave, 1.8, 3) * (0.6 + 0.4 * f.dry) : 0) },
    { id: "surf", group: "Mare", name: "Surf", min: 2, sea: true, score: (f) => (f.day ? band(f.wave, 0.5, 0.9, 2, 3) * up(f.period, 4, 7) * down(f.kn, 10, 20) : 0) },
    { id: "sup", group: "Mare", name: "SUP e canoa", min: 2, sea: true, score: (f) => (f.day ? down(f.kn, 6, 11) * down(f.wave, 0.3, 0.7) * f.dry * up(f.t, 14, 20) : 0) },
    { id: "boat", group: "Mare", name: "Uscita in barca", min: 3, sea: true, score: (f) => (f.day ? down(f.kn, 9, 17) * down(f.wave, 0.4, 1) * f.dry : 0) },
  ];
  const DEFAULT_LIKES = ["sport", "outdoor", "laundry", "stars", "beach"];
  const activity = (id) => ACTIVITIES.find((a) => a.id === id);
  const available = () => ACTIVITIES.filter((a) => !a.sea || state.sea);
  const verdictWord = (score) => (score >= 0.8 ? "Ottimo" : score >= 0.6 ? "Buono" : "Discreto");

  // La finestra migliore dentro una serie di voti: parte dall'ora migliore e si allarga finché resta buona.
  function bestWindow(scores, min = 1) {
    const best = scores.indexOf(Math.max(...scores));
    if (best < 0 || scores[best] < 0.4) return null;
    const grow = (floor) => {
      let l = best, r = best;
      while (l > 0 && scores[l - 1] >= floor) l--;
      while (r < scores.length - 1 && scores[r + 1] >= floor) r++;
      return [l, r];
    };
    let [l, r] = grow(Math.max(0.4, scores[best] - 0.2));
    if (r - l + 1 < min) [l, r] = grow(0.4);
    if (r - l + 1 < min) return null;
    const mean = scores.slice(l, r + 1).reduce((a, b) => a + b, 0) / (r - l + 1);
    return { l, r, best, mean };
  }

  // Voti e finestra migliore di un'attività nelle prossime 24 ore.
  function nextDay(a) {
    const h = state.data.hourly, idx = ahead(24);
    const scores = idx.map((i) => a.score(hourFacts(i)));
    const win = bestWindow(scores);
    if (!win) return { scores, idx, text: "Meglio di no", html: "Meglio di no", mean: 0 };
    const startIso = h.time[idx[win.l]];
    const endHour = (Number(hourOf(h.time[idx[win.r]])) + 1) % 24;
    const range = win.l === 0 ? `da adesso alle ${endHour}` : `${isToday(startIso) ? "oggi" : "domani"} ${Number(hourOf(startIso))}–${endHour}`;
    const word = verdictWord(scores[win.best]);
    return { scores, idx, mean: scores[win.best], text: `${word.toLowerCase()} ${range}`, html: `<b>${word}</b> · ${range}` };
  }

  function renderMoments() {
    const h = state.data.hourly;
    const likes = me?.likes?.length ? me.likes : DEFAULT_LIKES;
    const list = available().filter((a) => likes.includes(a.id));
    let idx = ahead(24);

    $("moments").innerHTML = list.map((a) => {
      const day = nextDay(a);
      idx = day.idx;
      const strip = day.scores.map((s) => `<i class="${s < 0.15 ? "off" : ""}" style="--s:${s.toFixed(2)}"></i>`).join("");
      return `<li><span class="m-name">${a.name}</span><span class="m-when">${day.html}</span><span class="m-strip">${strip}</span></li>`;
    }).join("");

    const tick = (k) => (idx[k] != null ? hourOf(h.time[idx[k]]) : "");
    $("moments-axis").innerHTML = ["Ora", tick(6), tick(12), tick(18), tick(23)].map((t) => `<span>${t}</span>`).join("");
  }

  /* ---------- Il mio meteo: le risposte su misura. Il profilo resta nel browser. ---------- */

  let me = store.get("cielo:me", null);
  const MODES = { walk: "A piedi", bike: "In bici", moto: "In moto", car: "In auto", transit: "Con i mezzi" };

  // Profili salvati con la vecchia forma (un'andata e un ritorno) diventano due fasce di un'ora.
  const plusHour = (t) => `${String((Number(t.slice(0, 2)) + 1) % 24).padStart(2, "0")}:00`;
  if (me && !me.outings) {
    me.outings = me.mode ? [{ from: me.out ?? "08:00", to: plusHour(me.out ?? "08:00"), name: "" }, { from: me.back ?? "18:00", to: plusHour(me.back ?? "18:00"), name: "" }] : [];
  }

  // Le ore della prossima volta che cade quella fascia: oggi se non è ancora finita, altrimenti domani.
  function outingHours(o) {
    const h = state.data.hourly;
    const start = Number(o.from.slice(0, 2));
    let end = Number(o.to.slice(0, 2)) + (Number(o.to.slice(3, 5)) > 0 ? 1 : 0);
    if (end <= start) end = start + 1;
    const today = state.data.current.time.slice(0, 10);
    const dates = [today, state.data.daily.time[1]].filter(Boolean);
    for (const date of dates) {
      const idx = h.time.map((t, i) => i).filter((i) => h.time[i].startsWith(date) && i >= state.nowIndex &&
        Number(hourOf(h.time[i])) >= start && Number(hourOf(h.time[i])) < end);
      if (idx.length) return idx;
    }
    return [];
  }

  function outingLine(o, chosenMode) {
    const mode = chosenMode || "walk"; // senza un mezzo scelto, ragiono come per chi è a piedi
    const idx = outingHours(o);
    if (!idx.length) return null;
    const h = state.data.hourly, facts = idx.map(hourFacts);
    const exposed = mode !== "car";
    const issues = [];
    const wet = idx.find((i) => (h.precipitation_probability[i] ?? 0) >= 50 || (isWet(h.weather_code[i]) && (h.precipitation_probability[i] ?? 0) >= 30));
    const peak = Math.max(...facts.map((f) => f.prob));
    const from = (i) => (i === idx[0] ? "" : ` dalle ${Number(hourOf(h.time[i]))}`);
    if (idx.some((i) => isSnow(h.weather_code[i]))) issues.push("neve");
    else if (exposed && wet != null) issues.push(`pioggia probabile${from(wet)} (${peak}%)`);
    else if (!exposed && idx.some((i) => [65, 67, 82, 95, 96, 99].includes(h.weather_code[i]))) issues.push("pioggia intensa");
    const gusts = Math.max(...facts.map((f) => f.gusts));
    if ((mode === "bike" || mode === "moto") && gusts >= 45) issues.push(`raffiche a ${round(gusts)} km/h`);
    const temps = idx.map((i) => h.temperature_2m[i]), lo = round(Math.min(...temps)), hi = round(Math.max(...temps));
    if (lo <= 1) issues.push(mode === "car" || mode === "moto" || mode === "bike" ? "rischio ghiaccio" : "marciapiedi ghiacciati");
    if ((mode === "car" || mode === "moto") && idx.some((i) => kind(h.weather_code[i]) === "fog")) issues.push("nebbia");

    const range = lo === hi ? `${lo}°` : `${lo}–${hi}°`;
    const tips = { walk: "Prendi l'ombrello.", bike: "Porta l'antipioggia o cambia mezzo.", moto: "Antipioggia e prudenza.", car: "Parti con qualche minuto di margine.", transit: "Prendi l'ombrello per il tratto a piedi." };
    const startHour = Number(hourOf(h.time[idx[0]])), endHour = (Number(hourOf(h.time[idx.at(-1)])) + 1) % 24;
    const title = `${o.name || MODES[chosenMode] || "Fuori casa"} · ${startHour}–${endHour}${isToday(h.time[idx[0]]) ? "" : " di domani"}`;
    const rainy = issues.some((x) => x.startsWith("pioggia") || x === "neve"); // il consiglio riguarda la pioggia
    const text = issues.length ? `${issues.join(", ")}, ${range}. ${rainy ? tips[mode] ?? "" : ""}` : `Asciutto, ${range}.`;
    return { level: issues.length ? "warn" : "ok", title, text: text[0].toUpperCase() + text.slice(1).trim() };
  }

  function mineLines() {
    const { data, air } = state;
    const h = data.hourly, d = data.daily;
    const lines = [];

    for (const o of me.outings ?? []) {
      const line = outingLine(o, me.mode);
      if (line) lines.push(line);
    }

    for (const a of available().filter((x) => me.likes?.includes(x.id))) {
      const day = nextDay(a);
      lines.push({ level: day.mean >= 0.6 ? "ok" : day.mean >= 0.4 ? "warn" : "bad", title: a.name, text: day.mean ? `${day.text[0].toUpperCase()}${day.text.slice(1)}.` : "Nelle prossime 24 ore meglio di no." });
    }

    if (me.garden) {
      const next = ahead(48);
      const rain = next.reduce((sum, i) => sum + (h.precipitation[i] ?? 0), 0);
      const coldest = Math.min(...ahead(24).map((i) => h.temperature_2m[i]));
      if (coldest <= 1) lines.push({ level: "bad", title: "Orto e giardino", text: `Gelo in arrivo (fino a ${round(coldest)}°): copri le piante delicate.` });
      else if (rain >= 5) lines.push({ level: "ok", title: "Orto e giardino", text: `Non serve annaffiare: circa ${round(rain)} mm di pioggia nelle prossime 48 ore.` });
      else if (d.temperature_2m_max[0] >= 28) lines.push({ level: "warn", title: "Orto e giardino", text: "Giornata calda e niente pioggia: annaffia la sera." });
      else lines.push({ level: "ok", title: "Orto e giardino", text: "Niente pioggia per 48 ore: annaffia se la terra è asciutta." });
    }

    if (me.uv) {
      const sunny = h.time.map((t, i) => i).filter((i) => isToday(h.time[i]) && (h.uv_index[i] ?? 0) >= 3);
      lines.push(sunny.length
        ? { level: "warn", title: "Sole", text: `Crema solare dalle ${Number(hourOf(h.time[sunny[0]]))} alle ${Number(hourOf(h.time[sunny.at(-1)])) + 1}: UV fino a ${round(d.uv_index_max[0] ?? 0)}.` }
        : { level: "ok", title: "Sole", text: "UV basso tutto il giorno: oggi niente crema." });
    }

    for (const key of me.pollen ?? []) {
      const values = (air?.hourly?.[key] ?? []).filter((v) => v != null);
      if (!values.length) { lines.push({ level: "ok", title: POLLEN[key], text: "Nessun dato sui pollini per questa zona." }); continue; }
      const peak = Math.max(...values), level = peak < 1 ? 0 : peak < 10 ? 1 : peak < 50 ? 2 : 3;
      lines.push({ level: level >= 3 ? "bad" : level === 2 ? "warn" : "ok", title: POLLEN[key], text: level ? `Polline ${POLLEN_LEVEL[level]} oggi.` : "Nessun polline oggi." });
    }
    return lines;
  }

  function renderMine() {
    const lines = me ? mineLines() : [];
    $("mine-empty").hidden = lines.length > 0;
    $("me-edit").hidden = !lines.length;
    $("mine").hidden = !lines.length;
    const away = me?.home && lines.length && !samePlace(me.home, state.place);
    $("mine-where").hidden = !away;
    if (away) $("mine-where").innerHTML = `Stai guardando <b>${esc(state.place.name)}</b>: le risposte qui sotto valgono per questa città. <button type="button" class="link" id="mine-home">Torna a ${esc(me.home.name)}</button>`;
    $("mine").innerHTML = lines.map((l) => `<li class="${l.level}"><i aria-hidden="true"></i><span><b>${esc(l.title)}</b> ${esc(l.text)}</span></li>`).join("");
  }

  const outingRow = (o = { from: "08:00", to: "09:00", name: "" }) => `<div class="outing">
      <label>dalle <input type="time" name="from" value="${esc(o.from)}" step="3600" required></label>
      <label>alle <input type="time" name="to" value="${esc(o.to)}" step="3600" required></label>
      <input type="text" name="oname" value="${esc(o.name ?? "")}" maxlength="24" placeholder="Nome (facoltativo)" aria-label="Nome della fascia">
      <button type="button" class="remove" aria-label="Rimuovi questa fascia">×</button>
    </div>`;

  function openProfile() {
    const form = $("me-form");
    const groups = [...new Set(ACTIVITIES.map((a) => a.group))];
    $("me-likes").innerHTML = groups.map((g) => `<div class="like-group"><h3>${g}${g === "Mare" ? " <small>vicino alla costa</small>" : ""}</h3><div class="picks">${
      ACTIVITIES.filter((a) => a.group === g).map((a) => `<label class="pick"><input type="checkbox" name="like" value="${a.id}"><span>${a.name}</span></label>`).join("")}</div></div>`).join("");
    $("me-pollen").innerHTML = Object.entries(POLLEN).map(([key, name]) => `<label class="pick"><input type="checkbox" name="pollen" value="${key}"><span>${name}</span></label>`).join("");
    const cur = me ?? {};
    setDraftHome(cur.home ?? null);
    $("me-home-here").textContent = state.place ? `Usa ${state.place.name}` : "Usa questa";
    $("me-outings").innerHTML = (cur.outings ?? []).map(outingRow).join("");
    form.elements.mode.value = cur.mode ?? "";
    form.elements.garden.checked = !!cur.garden;
    form.elements.uv.checked = !!cur.uv;
    form.querySelectorAll('[name="like"]').forEach((el) => { el.checked = !!cur.likes?.includes(el.value); });
    form.querySelectorAll('[name="pollen"]').forEach((el) => { el.checked = !!cur.pollen?.includes(el.value); });
    $("me-dialog").showModal();
  }

  // La città di casa: scelta dalla ricerca o presa da quella che si sta guardando.
  let draftHome = null, homeTimer = 0, homeResults = [];
  function setDraftHome(place) {
    draftHome = place;
    $("me-home").hidden = !place;
    $("me-home-pick").hidden = !!place;
    $("me-home-name").textContent = place ? [place.name, place.admin].filter(Boolean).join(", ") : "";
    $("me-home-q").value = "";
    $("me-home-results").innerHTML = "";
  }
  $("me-home-clear").addEventListener("click", () => setDraftHome(null));
  $("me-home-here").addEventListener("click", () => state.place && setDraftHome(state.place));
  $("me-home-q").addEventListener("input", (e) => {
    clearTimeout(homeTimer);
    const term = e.target.value.trim();
    if (term.length < 2) { $("me-home-results").innerHTML = ""; return; }
    homeTimer = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ name: term, count: 5, language: "it", format: "json" });
        const json = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { timeout: 8000 });
        homeResults = (json.results ?? []).map((r) => ({ name: r.name, admin: r.admin1 ?? "", country: r.country ?? "", lat: +r.latitude.toFixed(2), lon: +r.longitude.toFixed(2) }));
        $("me-home-results").innerHTML = homeResults.length
          ? homeResults.map((r, i) => `<li><button type="button" data-home="${i}"><b>${esc(r.name)}</b> <span>${esc([r.admin, r.country].filter(Boolean).join(", "))}</span></button></li>`).join("")
          : "<li class=\"none\">Nessuna città trovata</li>";
      } catch { $("me-home-results").innerHTML = "<li class=\"none\">Ricerca non disponibile, riprova</li>"; }
    }, 220);
  });
  $("me-home-q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // Invio sceglie la prima città, non salva il modulo
    if (homeResults[0]) setDraftHome(homeResults[0]);
  });
  $("me-home-results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-home]");
    if (b) setDraftHome(homeResults[Number(b.dataset.home)]);
  });
  $("mine").parentElement.addEventListener("click", (e) => { if (e.target.id === "mine-home" && me?.home) load(me.home); });

  $("me-add-outing").addEventListener("click", () => {
    const box = $("me-outings");
    if (box.children.length >= 6) return toast("Al massimo sei fasce");
    // La nuova fascia parte un'ora dopo la fine dell'ultima, per non doverla riscrivere da zero.
    const last = box.lastElementChild?.querySelector('[name="to"]').value;
    const from = last ? plusHour(last) : "08:00";
    box.insertAdjacentHTML("beforeend", outingRow({ from, to: plusHour(from), name: "" }));
    box.lastElementChild.querySelector("input").focus();
  });
  $("me-outings").addEventListener("click", (e) => { e.target.closest(".remove")?.parentElement.remove(); });

  $("me-start").addEventListener("click", openProfile);
  $("me-edit").addEventListener("click", openProfile);
  $("me-dialog").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // clic fuori = chiudi
  $("me-form").addEventListener("submit", () => {
    const form = $("me-form");
    const picked = (name) => [...form.querySelectorAll(`[name="${name}"]:checked`)].map((el) => el.value);
    const outings = [...form.querySelectorAll(".outing")].map((row) => ({
      from: row.querySelector('[name="from"]').value, to: row.querySelector('[name="to"]').value, name: row.querySelector('[name="oname"]').value.trim(),
    })).filter((o) => o.from && o.to).sort((x, y) => x.from.localeCompare(y.from));
    const movedHome = draftHome && !samePlace(draftHome, me?.home);
    me = { home: draftHome, mode: form.elements.mode.value, outings, likes: picked("like"), pollen: picked("pollen"), garden: form.elements.garden.checked, uv: form.elements.uv.checked };
    store.set("cielo:me", me);
    if (movedHome && !samePlace(me.home, state.place)) { load(me.home); return; } // nuova casa: la mostro subito
    if (state.data) { renderFavs(); renderMine(); renderMoments(); renderPlan(); }
  });
  $("me-clear").addEventListener("click", () => {
    me = null;
    try { localStorage.removeItem("cielo:me"); } catch { /* storage non disponibile */ }
    $("me-dialog").close();
    if (state.data) { renderFavs(); renderMine(); renderMoments(); renderPlan(); }
  });

  /* ---------- Quando conviene? I momenti migliori dei prossimi 7 giorni. ---------- */

  let planId = store.get("cielo:plan", "bbq"), planAll = false;

  function planFor(a) {
    const { data, trust } = state;
    const h = data.hourly;
    const found = [];
    data.daily.time.forEach((date, dayIndex) => {
      const idx = h.time.map((t, i) => i).filter((i) => h.time[i].startsWith(date) && i >= state.nowIndex);
      if (idx.length < a.min) return;
      const facts = idx.map(hourFacts);
      const win = bestWindow(facts.map((f) => a.score(f)), a.min);
      if (!win) return;
      const slice = facts.slice(win.l, win.r + 1);
      const t = trust?.[dayIndex] ?? null;
      // A parità di condizioni, vince il giorno su cui i modelli sono più d'accordo.
      found.push({ dayIndex, slice, t, mean: win.mean, rank: win.mean * (t === 1 ? 0.75 : t === 2 ? 0.9 : 1) });
    });
    return found.sort((x, y) => y.rank - x.rank).slice(0, 3);
  }

  function renderPlan() {
    const list = available();
    if (!list.some((a) => a.id === planId)) planId = "bbq";
    // Poche scelte in vista (le tue, più le classiche); le altre dietro "Tutte le attività".
    const featured = [...new Set([...(me?.likes ?? []), "bbq", "trip", "sport", "works", planId])];
    const shown = planAll ? list : list.filter((a) => featured.includes(a.id));
    $("plan-picks").innerHTML = shown.map((a) => `<button type="button" data-plan="${a.id}" aria-pressed="${a.id === planId}">${a.name}</button>`).join("") +
      (shown.length < list.length || planAll ? `<button type="button" class="more" data-more>${planAll ? "Mostra meno" : "Tutte le attività"}</button>` : "");

    const a = activity(planId), h = state.data.hourly;
    const options = planFor(a);
    $("plan").innerHTML = options.length ? options.map((o, n) => {
      const first = o.slice[0], last = o.slice.at(-1);
      const temps = o.slice.map((f) => f.t);
      const facts = [
        `${round(Math.min(...temps))}–${round(Math.max(...temps))}° percepiti`,
        `pioggia max ${Math.max(...o.slice.map((f) => f.prob))}%`,
        a.sea ? `vento ${round(Math.max(...o.slice.map((f) => f.kn)))} nodi, onde ${comma(Math.max(...o.slice.map((f) => f.wave)))} m`
          : `vento fino a ${round(Math.max(...o.slice.map((f) => f.wind)))} km/h`,
      ];
      const day = o.dayIndex === 0 ? "Oggi" : o.dayIndex === 1 ? "Domani"
        : new Date(state.data.daily.time[o.dayIndex] + "T12:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric" });
      const meter = o.t ? `<span class="trust t${o.t}" title="Affidabilità ${TRUST[o.t]}"><i></i><i></i><i></i></span>` : "";
      return `<li><button type="button" data-day="${o.dayIndex}">
        <span class="p-rank">${n + 1}</span>
        <span class="p-main"><b>${esc(day)}</b>, dalle ${first.hour} alle ${(last.hour + 1) % 24}</span>
        <span class="p-word">${verdictWord(o.mean)} ${meter}</span>
        <span class="p-why">${facts.join(" · ")}${o.t ? ` · affidabilità ${TRUST[o.t]}` : ""}</span>
      </button></li>`;
    }).join("") : `<li class="p-none">Nei prossimi 7 giorni non c'è un momento adatto per «${esc(a.name.toLowerCase())}». Riprova tra un paio di giorni: le previsioni cambiano.</li>`;
  }

  $("plan-picks").addEventListener("click", (e) => {
    if (e.target.closest("[data-more]")) { planAll = !planAll; renderPlan(); return; }
    const b = e.target.closest("button[data-plan]");
    if (!b) return;
    planId = b.dataset.plan;
    store.set("cielo:plan", planId);
    $("plan-answer").hidden = true;
    renderPlan();
  });
  $("plan").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-day]");
    if (!b) return;
    selectDay(Number(b.dataset.day));
    $("ora").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  });
  $("plan-ask").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("plan-input").value.trim();
    if (!text || !state.data) return;
    const out = $("plan-answer"), id = state.requestId;
    out.innerHTML = '<span class="sk sk-line"></span><span class="sk sk-line short"></span>';
    out.hidden = false;
    const ai = await askAI({ q: `Quando conviene, nei prossimi 7 giorni, per: ${text}? Indica giorno e orario migliori.` });
    if (id !== state.requestId) return;
    out.textContent = ai?.text.trim() ?? "Non riesco a rispondere in questo momento. Riprova tra poco.";
  });

  /* ---------- Mare e vento ---------- */

  const WINDS = ["Tramontana", "Grecale", "Levante", "Scirocco", "Ostro", "Libeccio", "Ponente", "Maestrale"];
  const BEAUFORT = [[1, "calma"], [3, "bava di vento"], [6, "brezza leggera"], [10, "brezza tesa"], [16, "vento moderato"], [21, "vento teso"],
    [27, "vento fresco"], [33, "vento forte"], [40, "burrasca"], [47, "burrasca forte"], [55, "tempesta"], [63, "tempesta violenta"], [Infinity, "uragano"]];
  const beaufort = (kn) => BEAUFORT.findIndex(([limit]) => kn < limit);
  const sector = (deg) => Math.round(deg / 45) % 8;
  const seaState = (m) => (m < 0.1 ? "calmo" : m < 0.5 ? "quasi calmo" : m < 1.25 ? "poco mosso" : m < 2.5 ? "mosso" : m < 4 ? "molto mosso" : "agitato");
  let knots = store.get("cielo:knots", true);
  const speed = (kmh) => round(knots ? kmh * KN : kmh);
  const unit = () => (knots ? "nodi" : "km/h");
  const windArrow = (deg) => `<svg class="w-arrow" viewBox="0 0 24 24" style="rotate:${(deg + 180) % 360}deg" aria-hidden="true"><path d="M12 3l6 16-6-4-6 4z" fill="currentColor"/></svg>`;

  function renderSeaWind() {
    const { data, sea } = state;
    const c = data.current, h = data.hourly;
    const kn = c.wind_speed_10m * KN, force = beaufort(kn);

    const stat = (title, value, sub) => `<div class="sea-stat"><h3>${title}</h3><div class="t-val">${value}</div><p>${sub}</p></div>`;
    const stats = [stat("Vento", `${speed(c.wind_speed_10m)}<small>${knots && speed(c.wind_speed_10m) === 1 ? "nodo" : unit()}</small>`,
      `${windArrow(c.wind_direction_10m)}${WINDS[sector(c.wind_direction_10m)]} da ${COMPASS[sector(c.wind_direction_10m)]} · forza ${force}, ${BEAUFORT[force][1]} · raffiche ${speed(c.wind_gusts_10m)}`)];
    if (sea) {
      const n = sea.now;
      stats.push(stat("Onde", `${comma(n.wave_height)}<small>m</small>`,
        `Mare ${seaState(n.wave_height)}${n.wave_direction != null ? ` · da ${COMPASS[sector(n.wave_direction)]}` : ""}${n.wave_period != null ? ` · periodo ${round(n.wave_period)} s` : ""}`));
      if (n.swell_wave_height != null) stats.push(stat("Mare lungo", `${comma(n.swell_wave_height)}<small>m</small>`, n.swell_wave_period != null ? `Periodo ${round(n.swell_wave_period)} s` : "Onda lunga"));
      if (n.sea_surface_temperature != null) stats.push(stat("Acqua", `${round(n.sea_surface_temperature)}°`, n.sea_surface_temperature >= 24 ? "Calda" : n.sea_surface_temperature >= 20 ? "Gradevole" : n.sea_surface_temperature >= 16 ? "Fresca" : "Fredda"));
    }
    $("sea-now").innerHTML = stats.join("");

    const day = state.selectedDay;
    const from = day === 0 ? state.nowIndex : h.time.findIndex((t) => t.startsWith(data.daily.time[day]));
    const to = Math.min(from + 24, h.time.length);
    let html = "";
    for (let i = from; i < to; i++) {
      const hourKn = h.wind_speed_10m[i] * KN, wave = seaAt("wave_height", h.time[i]);
      const tone = hourKn >= 28 ? "var(--warm)" : `color-mix(in srgb, var(--blue) ${Math.round(8 + clamp01(hourKn / 28) * 72)}%, transparent)`;
      html += `<li>
        <span class="s-time">${day === 0 && i === from ? "Ora" : hourOf(h.time[i])}</span>
        ${windArrow(h.wind_direction_10m[i])}
        <span class="s-wind" style="background:${tone}">${speed(h.wind_speed_10m[i])}</span>
        <span class="s-gust">${speed(h.wind_gusts_10m[i] ?? h.wind_speed_10m[i])}</span>
        ${sea ? `<span class="s-wave"><i style="height:${wave == null ? 0 : Math.round(4 + clamp01(wave / 2.5) * 34)}px"></i></span><span class="s-m">${wave == null ? "—" : comma(wave)}</span>` : ""}
      </li>`;
    }
    $("sea-hours").innerHTML = html;
    $("sea-day").innerHTML = `<b>${day === 0 ? "Prossime 24 ore" : dayName(day, "long")}</b> · vento medio, raffiche${sea ? " e altezza delle onde (m)" : ""}, in ${unit()}`;
    $("sea-note").textContent = sea
      ? "Le frecce indicano dove va il vento. Dati del mare dalla cella più vicina alla costa: sotto riva le condizioni possono cambiare."
      : "Qui il mare è lontano: mostro solo il vento. Cerca una località di costa per vedere onde e temperatura dell'acqua.";
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.unit === "kn") === knots)));
  }

  document.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-unit]");
    if (!b) return;
    knots = b.dataset.unit === "kn";
    store.set("cielo:knots", knots);
    if (state.data) renderSeaWind();
  });

  /* ---------- Aria e salute ---------- */

  const uvLabel = (v) => (v < 3 ? "Basso" : v < 6 ? "Moderato" : v < 8 ? "Alto" : v < 11 ? "Molto alto" : "Estremo");
  const aqiLabel = (v) => (v <= 20 ? "Ottima" : v <= 40 ? "Buona" : v <= 60 ? "Discreta" : v <= 80 ? "Scarsa" : v <= 100 ? "Molto scarsa" : "Pessima");
  const POLLEN = { grass_pollen: "Graminacee", olive_pollen: "Olivo", birch_pollen: "Betulla", alder_pollen: "Ontano", mugwort_pollen: "Artemisia", ragweed_pollen: "Ambrosia" };
  const POLLEN_LEVEL = ["", "basso", "medio", "alto"];

  function renderHealth() {
    const { data, air } = state;
    const h = data.hourly, d = data.daily;
    const rows = [];

    const a = air?.current;
    if (a?.european_aqi != null) {
      const parts = [["PM2.5", a.pm2_5], ["PM10", a.pm10], ["NO₂", a.nitrogen_dioxide], ["O₃", a.ozone]]
        .filter(([, v]) => v != null).map(([k, v]) => `${k} ${round(v)}`).join(" · ");
      rows.push(`<div><span class="hl-name">Qualità dell'aria</span><span class="hl-val">${aqiLabel(a.european_aqi)}</span>
        <span class="scale"><i style="left:${(clamp01(a.european_aqi / 120) * 100).toFixed(0)}%"></i></span>
        <span class="hl-sub">Indice europeo ${round(a.european_aqi)} · ${parts} µg/m³</span></div>`);
    }

    const uvMax = d.uv_index_max[0] ?? 0;
    const sunny = h.time.map((t, i) => i).filter((i) => isToday(h.time[i]) && (h.uv_index[i] ?? 0) >= 3);
    const uvSub = sunny.length
      ? `Protezione solare consigliata dalle ${Number(hourOf(h.time[sunny[0]]))} alle ${Number(hourOf(h.time[sunny.at(-1)])) + 1}.`
      : "Oggi non serve protezione solare.";
    rows.push(`<div><span class="hl-name">Raggi UV</span><span class="hl-val">${uvLabel(uvMax)} · ${round(uvMax)}</span><span class="hl-sub">${uvSub}</span></div>`);

    const pollen = Object.entries(POLLEN).map(([key, name]) => {
      const values = (air?.hourly?.[key] ?? []).filter((v) => v != null);
      if (!values.length) return null;
      const peak = Math.max(...values);
      return { name, level: peak < 1 ? 0 : peak < 10 ? 1 : peak < 50 ? 2 : 3 };
    }).filter(Boolean);
    if (pollen.length) {
      const active = pollen.filter((p) => p.level > 0).sort((x, y) => y.level - x.level);
      const top = active[0]?.level ?? 0;
      rows.push(`<div><span class="hl-name">Pollini</span><span class="hl-val">${top ? POLLEN_LEVEL[top][0].toUpperCase() + POLLEN_LEVEL[top].slice(1) : "Assenti"}</span>
        <span class="hl-sub">${active.length ? active.map((p) => `${p.name} ${POLLEN_LEVEL[p.level]}`).join(" · ") : "Nessun polline rilevante oggi."}</span></div>`);
    }

    $("health").innerHTML = rows.join("");
  }

  /* ---------- Dettagli ---------- */

  const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const MOON = ["Luna nuova", "Falce crescente", "Primo quarto", "Gibbosa crescente", "Luna piena", "Gibbosa calante", "Ultimo quarto", "Falce calante"];

  function renderTiles() {
    const { data, nowIndex: i } = state;
    const c = data.current, h = data.hourly, d = data.daily;
    const vis = h.visibility[i];
    const dir = c.wind_direction_10m;
    const rainToday = d.precipitation_sum[0] ?? 0;
    const light = (new Date(d.sunset[0]) - new Date(d.sunrise[0])) / 60000;
    const moon = moonIllumination();

    const compass = `<svg class="t-g" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="2.5"/>
        <g stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M32 4v6M32 54v6M4 32h6M54 32h6" stroke-opacity=".35"/></g>
        <g transform="rotate(${(dir + 180) % 360} 32 32)"><g class="needle"><path d="M32 12l8 26-8-6-8 6z" fill="var(--warm)" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></g></g>
      </svg>`;

    // Fase lunare: mezzo disco illuminato più un'ellisse che disegna il terminatore.
    const waxing = moon.phase < 0.5, rx = (20 * Math.abs(Math.cos(2 * Math.PI * moon.phase))).toFixed(1);
    const lit = `M32 12 A20 20 0 0 ${waxing ? 1 : 0} 32 52 A${rx} 20 0 0 ${(moon.lit < 0.5) === waxing ? 0 : 1} 32 12Z`;
    const moonSvg = `<svg class="t-g" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="20" fill="currentColor" fill-opacity=".1"/><path d="${lit}" fill="#F6E7A1"/>
        <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>`;


    const tiles = [
      ["Vento", `${round(c.wind_speed_10m)}<small>km/h</small>`, `da ${COMPASS[Math.round(dir / 45) % 8]} · raffiche ${round(c.wind_gusts_10m)}`, compass],
      ["Pioggia oggi", `${rainToday < 10 ? comma(rainToday) : round(rainToday)}<small>mm</small>`, `Probabilità ${d.precipitation_probability_max[0] ?? 0}%`],
      ["Umidità", `${round(c.relative_humidity_2m)}<small>%</small>`, c.relative_humidity_2m >= 75 ? "Aria umida" : c.relative_humidity_2m <= 35 ? "Aria secca" : "Confortevole"],
      ["Pressione", `${round(c.pressure_msl)}<small>hPa</small>`, c.pressure_msl >= 1020 ? "Alta pressione" : c.pressure_msl <= 1005 ? "Bassa pressione" : "Nella norma"],
      ["Visibilità", vis == null ? "—" : `${vis >= 10000 ? round(vis / 1000) : comma(vis / 1000)}<small>km</small>`, vis == null ? "" : vis >= 10000 ? "Ottima" : vis >= 4000 ? "Buona" : "Ridotta"],
      ["Luna", `${round(moon.lit * 100)}<small>%</small>`, MOON[Math.round(moon.phase * 8) % 8], moonSvg],
    ];

    // Il percorso del sole: un arco dall'alba al tramonto con il sole nel punto in cui si trova ora.
    const f = clamp01((new Date(c.time) - new Date(d.sunrise[0])) / (new Date(d.sunset[0]) - new Date(d.sunrise[0])));
    const isUp = f > 0 && f < 1;
    const sunTile = `<div class="tile sun-tile"><h3>Sole</h3>
      <div class="t-val">${Math.floor(light / 60)}<small>h</small> ${String(Math.round(light % 60)).padStart(2, "0")}<small>min di luce</small></div>
      <svg class="sun-arc" viewBox="0 0 300 122" style="--f:${f.toFixed(3)}" role="img" aria-label="Alba alle ${hhmm(d.sunrise[0])}, tramonto alle ${hhmm(d.sunset[0])}">
        <path class="track" d="M30 96 A120 84 0 0 1 270 96"/>
        <path class="done" pathLength="1" d="M30 96 A120 84 0 0 1 270 96"/>
        <line x1="6" y1="96" x2="294" y2="96" stroke="currentColor" stroke-opacity=".25" stroke-width="2.5" stroke-linecap="round"/>
        ${isUp ? `<g class="sun"><circle r="11" fill="#FFC533" stroke="currentColor" stroke-width="2.5"/></g>` : ""}
        <text x="6" y="116">Alba ${hhmm(d.sunrise[0])}</text>
        <text x="294" y="116" text-anchor="end">Tramonto ${hhmm(d.sunset[0])}</text>
      </svg></div>`;

    // Su desktop (4 colonne) i riquadri dell'ultima riga si allargano per non lasciare buchi.
    const rest = tiles.length - 4;
    $("tiles").innerHTML = sunTile + tiles.map(([title, value, sub, graphic = ""], n) =>
      `<div class="tile${tiles.length % 2 && n === tiles.length - 1 ? " odd" : ""}${n >= 4 && (rest === 2 || n === tiles.length - 1) && rest !== 4 ? " fill" : ""}">${graphic}<h3>${title}</h3><div class="t-val">${value}</div><div class="t-sub">${sub}</div></div>`).join("");
  }

  /* ---------- Preferiti e condivisione ---------- */

  function renderFavs() {
    const favs = store.get("cielo:favs", []);
    const home = me?.home;
    const chips = home ? [{ ...home, isHome: true }, ...favs.filter((f) => !samePlace(f, home))] : favs;
    $("favs").replaceChildren(...chips.map((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.isHome ? `⌂ ${f.name}` : f.name;
      if (f.isHome) b.title = "La tua città";
      if (samePlace(f, state.place)) b.setAttribute("aria-current", "true");
      b.onclick = () => load(f);
      return b;
    }));
    const isFav = favs.some((f) => samePlace(f, state.place));
    const t = $("fav-toggle");
    t.setAttribute("aria-pressed", String(isFav));
    t.title = isFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti";
    t.setAttribute("aria-label", t.title);
  }

  $("fav-toggle").addEventListener("click", () => {
    let favs = store.get("cielo:favs", []);
    if (favs.some((f) => samePlace(f, state.place))) favs = favs.filter((f) => !samePlace(f, state.place));
    else favs = [...favs, state.place].slice(-8);
    store.set("cielo:favs", favs);
    renderFavs();
  });

  $("share").addEventListener("click", async () => {
    const text = `${state.place.name}: ${state.headline || label(state.data.current.weather_code)} (${round(state.data.current.temperature_2m)}°)`;
    try {
      if (navigator.share) await navigator.share({ title: "Cielo", text, url: location.href });
      else { await navigator.clipboard.writeText(`${text} ${location.href}`); toast("Link copiato"); }
    } catch { /* condivisione annullata */ }
  });

  /* ---------- Selezione giorno ---------- */

  $("days").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-day]");
    if (!btn) return;
    selectDay(Number(btn.dataset.day));
    if (innerWidth < 880) document.querySelector(".hourly").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  });
  $("back-today").addEventListener("click", () => selectDay(0));

  function selectDay(i) {
    state.selectedDay = i;
    if (state.preview != null) { state.preview = null; renderSky(); }
    renderHours();
    renderSeaWind();
    document.querySelectorAll("#days button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.day) === i)));
  }

  /* ---------- Ricerca ---------- */

  const q = $("q"), sugg = $("suggestions");
  let results = [], active = -1, searchCtrl = null, searchTimer = 0;

  function closeSuggestions() {
    sugg.hidden = true; q.setAttribute("aria-expanded", "false"); active = -1;
  }

  function drawSuggestions(emptyText) {
    if (!results.length) {
      sugg.innerHTML = emptyText ? `<li class="s-empty">${esc(emptyText)}</li>` : "";
      sugg.hidden = !emptyText;
    } else {
      sugg.innerHTML = results.map((r, i) =>
        `<li role="option" id="s-${i}" data-i="${i}" aria-selected="${i === active}">
          <span class="s-name">${esc(r.name)}</span>
          <span class="s-sub">${esc([r.admin, r.country].filter(Boolean).join(", "))}</span>
        </li>`).join("");
      sugg.hidden = false;
    }
    q.setAttribute("aria-expanded", String(!sugg.hidden));
    if (active >= 0) q.setAttribute("aria-activedescendant", `s-${active}`); else q.removeAttribute("aria-activedescendant");
  }

  async function search(term) {
    searchCtrl?.abort();
    searchCtrl = new AbortController();
    try {
      const p = new URLSearchParams({ name: term, count: 6, language: "it", format: "json" });
      const json = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { signal: searchCtrl.signal, timeout: 8000 });
      results = (json.results ?? []).map((r) => ({
        name: r.name, admin: r.admin1 ?? "", country: r.country ?? "",
        lat: +r.latitude.toFixed(2), lon: +r.longitude.toFixed(2),
      }));
      active = results.length ? 0 : -1;
      drawSuggestions("Nessuna città trovata");
    } catch (err) {
      if (err.name !== "AbortError") { results = []; drawSuggestions("Ricerca non disponibile, riprova"); }
    }
  }

  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const term = q.value.trim();
    if (term.length < 2) { searchCtrl?.abort(); results = []; closeSuggestions(); return; }
    searchTimer = setTimeout(() => search(term), 220);
  });

  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSuggestions(); return; }
    if (sugg.hidden || !results.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      drawSuggestions();
    }
  });

  function choose(i) {
    const r = results[i];
    if (!r) return;
    q.value = ""; results = []; closeSuggestions(); q.blur();
    load(r);
  }

  $("search").addEventListener("submit", (e) => { e.preventDefault(); choose(Math.max(active, 0)); });
  sugg.addEventListener("mousedown", (e) => e.preventDefault()); // non togliere il focus all'input
  sugg.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) choose(Number(li.dataset.i)); });
  document.addEventListener("click", (e) => { if (!$("search").contains(e.target)) closeSuggestions(); });

  /* ---------- Geolocalizzazione ---------- */

  $("geo").addEventListener("click", () => {
    if (!navigator.geolocation) return showStatus("Il tuo browser non supporta la geolocalizzazione.");
    const btn = $("geo");
    btn.classList.add("busy");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = +pos.coords.latitude.toFixed(2), lon = +pos.coords.longitude.toFixed(2);
      let place = { name: "La tua posizione", admin: "", country: "", lat, lon };
      try {
        const p = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: "it" });
        const r = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?${p}`, { timeout: 6000 });
        const name = r.city || r.locality;
        if (name) place = { name, admin: r.principalSubdivision ?? "", country: r.countryName ?? "", lat, lon };
      } catch { /* resta "La tua posizione" */ }
      btn.classList.remove("busy");
      load(place);
    }, () => {
      btn.classList.remove("busy");
      showStatus("Non ho il permesso di usare la tua posizione. Puoi cercare la città qui sopra.");
    }, { timeout: 10000, maximumAge: 600000 });
  });

  /* ---------- Il titolo e il testo (versione senza AI) ---------- */

  function localHeadline() {
    const { data } = state;
    const c = data.current, h = data.hourly;
    const k = kind(c.weather_code), t = round(c.temperature_2m);

    if (k === "storm") return "Temporale in corso.";
    if (isWet(c.weather_code)) {
      const stop = ahead(18).find((i) => (h.precipitation_probability[i] ?? 0) < 30 && !isWet(h.weather_code[i]));
      return stop != null && isToday(h.time[stop]) ? `Piove fino alle ${Number(hourOf(h.time[stop]))}.` : "Pioggia per tutto il giorno.";
    }
    if (k === "snow") return "Nevica: occhio alle strade.";
    const rainAt = nextRain(14);
    if (rainAt != null) {
      const what = isSnow(h.weather_code[rainAt]) ? "Neve" : "Ombrello";
      return isToday(h.time[rainAt]) ? `${what} dalle ${Number(hourOf(h.time[rainAt]))}.` : (what === "Neve" ? "Neve in arrivo domani." : "Domani serve l'ombrello.");
    }
    if (k === "fog") return "Nebbia, si vede poco.";
    if (c.wind_gusts_10m >= 50) return `Vento forte: raffiche a ${round(c.wind_gusts_10m)}.`;
    if (c.apparent_temperature <= 3) return `Freddo vero: ${gradi(t)}.`;
    if (c.apparent_temperature >= 32) return `Caldo pesante: ${gradi(t)}.`;
    if (k === "clear") return c.is_day ? `Sole pieno, ${gradi(t)}.` : `Notte limpida, ${gradi(t)}.`;
    if (k === "partly") return c.is_day ? "Qualche nuvola, niente pioggia." : "Qualche nube, serata asciutta.";
    return "Cielo grigio, ma asciutto.";
  }

  function localSummary() {
    const { data } = state;
    const c = data.current, d = data.daily, h = data.hourly;
    const out = [];

    const rainAt = nextRain();
    if (isWet(c.weather_code)) {
      const stop = ahead(24).find((i) => (h.precipitation_probability[i] ?? 0) < 30 && !isWet(h.weather_code[i]));
      out.push(stop != null ? `La pioggia dovrebbe smettere ${when(h.time[stop])}.` : "Tempo instabile ancora per molte ore.");
    } else if (isSnow(c.weather_code)) {
      out.push("La neve continua nelle prossime ore.");
    } else if (rainAt != null) {
      out.push(`${isSnow(h.weather_code[rainAt]) ? "Neve" : "Pioggia"} probabile ${when(h.time[rainAt])}.`);
    } else {
      out.push("Niente pioggia in vista nelle prossime 24 ore.");
    }
    out.push(`Oggi si va da ${round(d.temperature_2m_min[0])}° a ${round(d.temperature_2m_max[0])}°.`);

    const uv = d.uv_index_max[0] ?? 0;
    if (isSnow(c.weather_code)) out.push("Scarpe con una buona suola e passo corto.");
    else if (rainAt != null || isWet(c.weather_code)) out.push("Meglio avere un ombrello con sé.");
    else if (c.wind_gusts_10m >= 50) out.push("Occhio alle raffiche.");
    else if (c.apparent_temperature <= 5) out.push("Copriti bene.");
    else if (uv >= 6 && c.is_day) out.push("UV alto: non dimenticare la crema solare.");
    else if (c.apparent_temperature >= 32) out.push("Bevi spesso e cerca l'ombra.");
    else out.push(c.is_day ? "Una buona giornata per stare fuori." : "Una serata tranquilla per uscire.");
    return out.join(" ");
  }

  const LOCAL_ANSWERS = {
    umbrella() {
      const h = state.data.hourly, code = state.data.current.weather_code;
      const idx = ahead(12);
      const max = Math.max(...idx.map((i) => h.precipitation_probability[i] ?? 0));
      const at = idx.find((i) => (h.precipitation_probability[i] ?? 0) >= 50);
      if (isWet(code)) return "Sì, sta già piovendo: prendilo.";
      if (isSnow(code)) return "Sta nevicando: più dell'ombrello servono un cappuccio e scarpe con una buona suola.";
      if (at != null) return `Sì, portalo: ${isSnow(h.weather_code[at]) ? "neve" : "pioggia"} probabile ${when(h.time[at])} (fino al ${max}%).`;
      if (max >= 30) return `Forse: c'è un ${max}% di probabilità di pioggia nelle prossime 12 ore. Uno piccolo in borsa non guasta.`;
      return `No, puoi lasciarlo a casa: nelle prossime 12 ore la probabilità di pioggia non supera il ${max}%.`;
    },
    clothes() {
      const c = state.data.current, t = c.apparent_temperature;
      let s = t <= 0 ? "Giubbotto pesante, sciarpa e guanti: si gela."
        : t <= 8 ? "Cappotto o piumino, e magari una sciarpa."
        : t <= 15 ? "Una giacca o un maglione pesante: è fresco."
        : t <= 21 ? "Una felpa o una giacca leggera bastano."
        : t <= 27 ? "Maniche corte, si sta bene."
        : "Vestiti leggeri e traspiranti: fa caldo.";
      if (isSnow(c.weather_code)) s += " Scarpe impermeabili, nevica.";
      else if (nextRain(12) != null || isWet(c.weather_code)) s += " Aggiungi qualcosa di impermeabile.";
      else if (c.wind_speed_10m >= 30) s += " Con questo vento, meglio un antivento.";
      return `${s} Ora si percepiscono ${round(t)}°.`;
    },
    sport() {
      const h = state.data.hourly;
      const good = ahead(14).filter((i) => h.is_day[i] && (h.precipitation_probability[i] ?? 0) < 30 &&
        h.apparent_temperature[i] >= 4 && h.apparent_temperature[i] <= 28 && h.wind_speed_10m[i] < 35 && !isWet(h.weather_code[i]));
      if (!good.length) return "Non è il momento ideale: nelle prossime ore tra pioggia, vento, buio o temperature c'è sempre qualcosa che disturba. Meglio al chiuso.";
      const best = good.reduce((a, b) => (Math.abs(h.apparent_temperature[b] - 17) < Math.abs(h.apparent_temperature[a] - 17) ? b : a));
      const first = good[0] === state.nowIndex ? "Sì, anche subito." : `Sì, ${when(h.time[good[0]])} si può.`;
      return `${first} Il momento migliore è ${when(h.time[best])}: ${round(h.apparent_temperature[best])}° percepiti e ${h.precipitation_probability[best] ?? 0}% di probabilità di pioggia.`;
    },
    laundry() {
      const h = state.data.hourly;
      const idx = ahead(8);
      const maxRain = Math.max(...idx.map((i) => h.precipitation_probability[i] ?? 0));
      const hum = idx.reduce((s, i) => s + h.relative_humidity_2m[i], 0) / idx.length;
      if (maxRain >= 40 || isWet(state.data.current.weather_code)) return `Meglio di no: rischio di precipitazioni fino al ${maxRain}% nelle prossime 8 ore.`;
      if (hum >= 80) return `Puoi, ma asciugheranno lentamente: umidità media intorno all'${round(hum)}%.`;
      return `Sì, vai tranquillo: niente pioggia in arrivo e umidità intorno al ${round(hum)}%.`;
    },
  };

  /* ---------- AI ---------- */

  let typing = 0;
  function typeInto(el, text) {
    clearInterval(typing);
    if (reducedMotion) { el.textContent = text; return; }
    const words = text.split(" ");
    let n = 0;
    el.textContent = "";
    typing = setInterval(() => {
      el.textContent = words.slice(0, ++n).join(" ");
      if (n >= words.length) clearInterval(typing);
    }, 28);
  }

  async function askAI(extra = {}) {
    if (state.aiAvailable === false) return null;
    try {
      const p = new URLSearchParams({ lat: state.place.lat, lon: state.place.lon, name: state.place.name, ...extra });
      const json = await getJSON(`api/ai?${p}`, { timeout: 25000 });
      if (typeof json.text !== "string" || !json.text.trim()) throw new Error("risposta vuota");
      state.aiAvailable = true;
      return json;
    } catch (err) {
      // 404/405 = sito pubblicato senza backend; 503 = chiave non configurata.
      if ([404, 405, 501, 503].includes(err.status) || state.aiAvailable === null) state.aiAvailable = false;
      return null;
    }
  }

  async function loadSummary(id) {
    renderLead();
    $("ai-answer").hidden = true;
    $("ai-chips").hidden = true;

    const ai = await askAI();
    if (id !== state.requestId) return;

    state.summary = { title: (ai?.title || localHeadline()).trim(), text: ai?.text.trim() ?? localSummary(), ai: !!ai };
    state.headline = state.summary.title;
    if (state.preview == null) renderLead(true);
    $("ai-chips").hidden = false;
    $("ask").hidden = !state.aiAvailable;
    $("plan-ask").hidden = !state.aiAvailable;
    document.querySelectorAll("[data-ai-only]").forEach((el) => { el.hidden = !state.aiAvailable; });
    $("ai-note").textContent = state.aiAvailable ? "Titolo e risposte sono scritti da un'AI: possono contenere imprecisioni." : "";
  }

  async function answer(question, localKey) {
    const box = $("ai-answer"), a = $("ai-a");
    $("ai-q").textContent = question;
    a.innerHTML = '<span class="sk sk-line"></span><span class="sk sk-line short"></span>';
    box.hidden = false;
    const id = state.requestId;
    const ai = await askAI({ q: question });
    if (id !== state.requestId) return;
    typeInto(a, ai?.text.trim() ?? (localKey ? LOCAL_ANSWERS[localKey]() : "Non riesco a rispondere in questo momento. Riprova tra poco."));
  }

  $("ai-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && state.data) answer(b.textContent, b.dataset.q);
  });

  $("ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("ask-input");
    const question = input.value.trim();
    if (!question || !state.data) return;
    input.value = "";
    answer(question);
  });

  /* ---------- Avvio ---------- */

  function initialPlace() {
    const p = new URLSearchParams(location.search);
    const lat = parseFloat(p.get("lat")), lon = parseFloat(p.get("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const last = store.get("cielo:last", null);
      if (samePlace(last, { lat, lon })) return last;
      return { name: (p.get("n") || "Posizione").slice(0, 60), admin: "", country: "", lat, lon };
    }
    return me?.home ?? store.get("cielo:last", null) ?? DEFAULT_PLACE;
  }

  /* ---------- Radar: la mappa si scarica solo quando la si apre ---------- */

  const radar = { map: null, base: null, labels: null, pin: null, frames: [], layers: [], at: 0, timer: 0, playing: !reducedMotion, mode: "", loadedAt: 0 };
  let leafletReady = null;

  function loadLeaflet() {
    leafletReady ??= new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css";
      const js = document.createElement("script");
      js.src = "vendor/leaflet/leaflet.js"; js.onload = resolve; js.onerror = reject;
      document.head.append(css, js);
    });
    return leafletReady;
  }

  function radarShow(k) {
    if (!radar.frames.length) return;
    radar.at = (k + radar.frames.length) % radar.frames.length;
    // I fotogrammi si aggiungono alla mappa al primo uso; quello dopo viene preparato in anticipo.
    for (const n of [radar.at, (radar.at + 1) % radar.frames.length]) {
      if (!radar.layers[n]) {
        radar.layers[n] = L.tileLayer(`${radar.frames[n].url}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: 7, maxZoom: 10, attribution: "Radar © RainViewer" }).addTo(radar.map);
      }
    }
    radar.layers.forEach((layer, n) => layer?.setOpacity(n === radar.at ? 0.78 : 0));
    $("radar-range").value = radar.at;
    const ago = Math.round((Date.now() / 1000 - radar.frames[radar.at].time) / 60);
    $("radar-time").textContent = new Date(radar.frames[radar.at].time * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) + (ago <= 12 ? " · adesso" : ` · ${ago} min fa`);
  }

  function radarPlay(on) {
    radar.playing = on;
    clearInterval(radar.timer);
    $("radar-play").setAttribute("aria-label", on ? "Pausa" : "Riproduci");
    $("radar-play-icon").setAttribute("d", on ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z");
    if (!on) return;
    let hold = 0;
    radar.timer = setInterval(() => {
      // Sull'ultimo fotogramma (il più recente) ci si ferma un attimo prima di ricominciare.
      if (radar.at === radar.frames.length - 1 && hold++ < 3) return;
      hold = 0;
      radarShow(radar.at + 1);
    }, 550);
  }

  async function radarFrames() {
    const json = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    radar.layers.forEach((layer) => layer?.remove());
    radar.layers = [];
    radar.frames = (json.radar?.past ?? []).map((f) => ({ time: f.time, url: json.host + f.path }));
    radar.loadedAt = Date.now();
    $("radar-range").max = Math.max(radar.frames.length - 1, 0);
    radarShow(radar.frames.length - 1);
  }

  // Tiene la mappa allineata alla città e al tema (carta di giorno, inchiostro di notte).
  function radarSync() {
    if (!radar.map || !state.place) return;
    // I contorni seguono il tema: inchiostro su carta di giorno, chiaro su scuro di notte.
    const mode = document.body.dataset.mode;
    if (mode !== radar.mode && radar.base) {
      const ink = getComputedStyle(document.body).getPropertyValue("--ink").trim();
      radar.base.setStyle({ color: ink });
      radar.pin?.setStyle({ color: ink });
      radar.mode = mode;
    }
    const here = [state.place.lat, state.place.lon];
    if (!radar.pin) radar.pin = L.circleMarker(here, { radius: 7, color: getComputedStyle(document.body).getPropertyValue("--ink").trim(), weight: 2.5, fillColor: "#f08a00", fillOpacity: 1, interactive: false }).addTo(radar.map);
    if (!samePlace(radar.shown, state.place)) { radar.map.setView(here, 7); radar.pin.setLatLng(here); radar.shown = state.place; }
    if (Date.now() - radar.loadedAt > 9 * 60 * 1000) radarFrames().catch(() => {});
  }

  async function openRadar() {
    const btn = $("radar-toggle");
    $("radar-body").hidden = false;
    $("radar-intro").hidden = true;
    btn.textContent = "Chiudi";
    btn.setAttribute("aria-expanded", "true");
    store.set("cielo:radar", true);
    try {
      await loadLeaflet();
      if (!radar.map) {
        radar.map = L.map("radar-map", { minZoom: 4, maxZoom: 10, scrollWheelZoom: false, zoomSnap: 0.5, preferCanvas: true });
        radar.map.attributionControl.setPrefix(false);
        // Sfondo nostro: coste e confini disegnati da un file locale, senza servizi di mappe esterni.
        const lines = await getJSON("vendor/map/lines.json", { timeout: 20000 });
        const flip = (group) => group.map((line) => line.map(([lon, lat]) => [lat, lon]));
        radar.base = L.polyline([...flip(lines.world), ...flip(lines.europe)], { weight: 1.2, opacity: 0.6, interactive: false, smoothFactor: 1.5, attribution: "Contorni: Natural Earth" }).addTo(radar.map);
        radar.labels = L.layerGroup(ITALY.map(([name, , lat, lon]) => L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: "radar-city", html: name, iconSize: null }) }))).addTo(radar.map);
      }
      radarSync();
      radar.map.invalidateSize();
      if (!radar.frames.length) await radarFrames();
      radarPlay(radar.playing);
    } catch (err) {
      console.error(err);
      $("radar-time").textContent = "Radar non disponibile in questo momento";
    }
  }

  function closeRadar() {
    clearInterval(radar.timer);
    $("radar-body").hidden = true;
    $("radar-intro").hidden = false;
    $("radar-toggle").textContent = "Apri il radar";
    $("radar-toggle").setAttribute("aria-expanded", "false");
    store.set("cielo:radar", false);
  }

  $("radar-toggle").addEventListener("click", () => ($("radar-body").hidden ? openRadar() : closeRadar()));
  $("radar-play").addEventListener("click", () => radarPlay(!radar.playing));
  $("radar-range").addEventListener("input", (e) => { radarPlay(false); radarShow(Number(e.target.value)); });
  if (store.get("cielo:radar", false)) openRadar(); // chi l'ha aperto una volta lo ritrova aperto

  /* ---------- Italia adesso ---------- */

  const ITALY = [
    ["Roma", "Lazio", 41.89, 12.48], ["Milano", "Lombardia", 45.46, 9.19], ["Napoli", "Campania", 40.85, 14.27],
    ["Torino", "Piemonte", 45.07, 7.69], ["Palermo", "Sicilia", 38.12, 13.36], ["Bologna", "Emilia-Romagna", 44.49, 11.34],
    ["Firenze", "Toscana", 43.77, 11.26], ["Venezia", "Veneto", 45.44, 12.33], ["Bari", "Puglia", 41.12, 16.87],
    ["Cagliari", "Sardegna", 39.22, 9.12],
  ];

  async function loadItaly(retried = false) {
    try {
      // Una sola richiesta per tutte le città, tenuta in memoria per un quarto d'ora.
      let cached = null;
      try { cached = JSON.parse(sessionStorage.getItem("cielo:italy")); } catch { /* nessuna cache */ }
      let rows = cached && Date.now() - cached.at < 15 * 60 * 1000 ? cached.rows : null;
      if (!rows) {
        const p = new URLSearchParams({
          latitude: ITALY.map((c) => c[2]).join(","), longitude: ITALY.map((c) => c[3]).join(","),
          current: "temperature_2m,weather_code,is_day", timezone: "auto",
        });
        const json = await getJSON(`https://api.open-meteo.com/v1/forecast?${p}`);
        rows = (Array.isArray(json) ? json : [json]).map((r) => r.current);
        if (rows.length !== ITALY.length) return;
        try { sessionStorage.setItem("cielo:italy", JSON.stringify({ at: Date.now(), rows })); } catch { /* storage non disponibile */ }
      }
      $("italy").innerHTML = ITALY.map(([name], i) =>
        `<li><button type="button" data-city="${i}"><span>${name}</span>${icon(rows[i].weather_code, !!rows[i].is_day)}<span class="i-temp">${round(rows[i].temperature_2m)}°</span></button></li>`).join("");
      $("italia").hidden = false;
    } catch {
      // Sezione facoltativa: un secondo tentativo, poi resta nascosta.
      if (!retried) setTimeout(() => loadItaly(true), 4000);
    }
  }

  $("italy").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-city]");
    if (!b) return;
    const [name, admin, lat, lon] = ITALY[Number(b.dataset.city)];
    load({ name, admin, country: "Italia", lat, lon });
    scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  });

  // Evidenzia nella barra di navigazione la sezione che si sta guardando.
  const navLinks = [...document.querySelectorAll(".site-nav a")];
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      navLinks.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${entry.target.id}`)));
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach((a) => { const target = document.querySelector(a.getAttribute("href")); if (target) spy.observe(target); });

  load(initialPlace());
  loadItaly();

  // Aggiorna i dati quando si torna sulla scheda dopo un po'.
  let loadedAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60 * 1000 && state.place) {
      loadedAt = Date.now();
      load(state.place);
    }
  });
})();

/* Cielo — logica dell'app. Nessuna dipendenza, nessuna build. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DEFAULT_PLACE = { name: "Roma", admin: "Lazio", country: "Italia", lat: 41.89, lon: 12.48 };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    place: null,
    data: null,        // risposta Open-Meteo
    air: null,
    nowIndex: 0,       // indice dell'ora corrente negli array orari
    selectedDay: 0,
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
  const hourOf = (iso) => iso.slice(11, 13);
  const hhmm = (iso) => iso.slice(11, 16);
  const samePlace = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;

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

  /* ---------- Icone SVG ---------- */

  const CLOUD = "M20 46h26a10 10 0 0 0 1-20 14 14 0 0 0-27-3 11.5 11.5 0 0 0 0 23z";

  function sun(cx, cy, r) {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
      const x2 = cx + Math.cos(a) * (r + 9), y2 = cy + Math.sin(a) * (r + 9);
      rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    return `<g stroke="#FFD54A" stroke-width="3.5" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFD54A"/>`;
  }
  const moon = (tx, ty, s) =>
    `<path transform="translate(${tx} ${ty}) scale(${s})" d="M38 8a22 22 0 1 0 18 34A18 18 0 0 1 38 8z" fill="#E9E6FF"/>`;
  const cloud = (transform = "", fill = "#fff") => `<path transform="${transform}" d="${CLOUD}" fill="${fill}"/>`;
  const drops = (n) => {
    const xs = n === 2 ? [26, 40] : [22, 33, 44];
    return `<g stroke="#8FD3FF" stroke-width="3.5" stroke-linecap="round">${xs.map((x) => `<line x1="${x}" y1="47" x2="${x - 3}" y2="56"/>`).join("")}</g>`;
  };
  const flakes = () => `<g fill="#fff">${[[22, 50], [33, 55], [44, 50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join("")}</g>`;

  function icon(code, isDay = true) {
    const k = kind(code);
    let body;
    switch (k) {
      case "clear":
        body = isDay ? sun(32, 32, 13) : moon(0, 0, 1);
        break;
      case "partly":
        body = (isDay ? sun(24, 24, 9) : moon(4, 2, 0.55)) + cloud("translate(10 14) scale(.82)");
        break;
      case "cloudy":
        body = cloud("translate(14 2) scale(.7)", "rgba(255,255,255,.6)") + cloud("translate(0 6)");
        break;
      case "fog":
        body = cloud("translate(0 -6)", "rgba(255,255,255,.85)") +
          `<g stroke="#fff" stroke-opacity=".8" stroke-width="3.5" stroke-linecap="round"><line x1="14" y1="48" x2="50" y2="48"/><line x1="20" y1="56" x2="44" y2="56"/></g>`;
        break;
      case "drizzle":
        body = cloud("translate(0 -8)") + drops(2);
        break;
      case "rain":
        body = cloud("translate(0 -8)", "#E6EEF7") + drops(3);
        break;
      case "snow":
        body = cloud("translate(0 -8)") + flakes();
        break;
      default: // storm
        body = cloud("translate(0 -8)", "#D5DCE8") + `<path d="M34 40l-9 12h7l-3 10 11-14h-7l4-8z" fill="#FFD54A"/>`;
    }
    return `<svg viewBox="0 0 64 64" role="img" aria-label="${esc(label(code))}">${body}</svg>`;
  }

  /* ---------- Tema e sfondo animato ---------- */

  function themeFor(code, isDay) {
    switch (kind(code)) {
      case "clear": case "partly": return [isDay ? "clear-day" : "clear-night", isDay ? "none" : "stars"];
      case "cloudy": return [isDay ? "cloudy-day" : "cloudy-night", "none"];
      case "fog": return [isDay ? "fog" : "cloudy-night", "none"];
      case "drizzle": case "rain": return ["rain", "rain"];
      case "snow": return [isDay ? "snow" : "cloudy-night", "snow"];
      default: return ["storm", "rain"];
    }
  }

  const fx = (() => {
    const canvas = $("fx");
    const ctx = canvas.getContext("2d");
    let mode = "none", parts = [], w = 0, h = 0, raf = 0, last = 0;

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      const area = (w * h) / 10000;
      const rnd = Math.random;
      if (mode === "rain") {
        parts = Array.from({ length: Math.min(160, area * 1.1) }, () => ({ x: rnd() * (w + 200), y: rnd() * h, v: 700 + rnd() * 500, l: 10 + rnd() * 14, o: 0.15 + rnd() * 0.3 }));
      } else if (mode === "snow") {
        parts = Array.from({ length: Math.min(110, area * 0.7) }, () => ({ x: rnd() * w, y: rnd() * h, v: 25 + rnd() * 45, r: 1 + rnd() * 2.2, p: rnd() * 6.28, o: 0.4 + rnd() * 0.5 }));
      } else if (mode === "stars") {
        parts = Array.from({ length: Math.min(130, area * 0.9) }, () => ({ x: rnd() * w, y: rnd() * h * 0.75, r: 0.4 + rnd() * 1.1, p: rnd() * 6.28, s: 0.5 + rnd() * 1.5 }));
      } else {
        parts = [];
      }
    }

    function frame(t) {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      ctx.clearRect(0, 0, w, h);
      if (mode === "rain") {
        ctx.strokeStyle = "#cfe6ff"; ctx.lineWidth = 1.2; ctx.lineCap = "round";
        for (const p of parts) {
          p.y += p.v * dt; p.x -= p.v * dt * 0.18;
          if (p.y > h) { p.y = -20; p.x = Math.random() * (w + 200); }
          ctx.globalAlpha = p.o;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.l * 0.18, p.y + p.l); ctx.stroke();
        }
      } else if (mode === "snow") {
        ctx.fillStyle = "#fff";
        for (const p of parts) {
          p.y += p.v * dt; p.p += dt; p.x += Math.sin(p.p) * 12 * dt;
          if (p.y > h + 4) { p.y = -4; p.x = Math.random() * w; }
          ctx.globalAlpha = p.o;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
        }
      } else if (mode === "stars") {
        ctx.fillStyle = "#fff";
        for (const p of parts) {
          ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(p.p + (t / 1000) * p.s));
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (mode !== "none" && !reducedMotion && !document.hidden) raf = requestAnimationFrame(frame);
    }

    function start() {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    addEventListener("resize", () => { resize(); start(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
    resize();

    return {
      set(next) {
        if (next === mode) return;
        mode = next; seed(); start();
      },
    };
  })();

  /* ---------- Dati ---------- */

  function forecastURL({ lat, lon }) {
    const p = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: "auto", forecast_days: 7, wind_speed_unit: "kmh",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,is_day,wind_speed_10m,uv_index,visibility",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    });
    return `https://api.open-meteo.com/v1/forecast?${p}`;
  }

  function airURL({ lat, lon }) {
    const p = new URLSearchParams({ latitude: lat, longitude: lon, timezone: "auto", current: "european_aqi,pm10,pm2_5" });
    return `https://air-quality-api.open-meteo.com/v1/air-quality?${p}`;
  }

  async function load(place, { remember = true } = {}) {
    const id = ++state.requestId;
    state.place = place;
    $("status").hidden = true;
    $("app").setAttribute("aria-busy", "true");
    renderFavs();

    try {
      const [data, air] = await Promise.all([
        getJSON(forecastURL(place)),
        getJSON(airURL(place)).catch(() => null),
      ]);
      if (id !== state.requestId) return;

      state.data = data;
      state.air = air;
      state.selectedDay = 0;
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

  /* ---------- Render ---------- */

  function render() {
    const { data, place } = state;
    const c = data.current, d = data.daily;
    const [theme, effect] = themeFor(c.weather_code, !!c.is_day);
    document.body.dataset.theme = theme;
    fx.set(effect);
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue("--c1").trim() || "#1e6fd9";

    const sub = [place.admin, place.country].filter((x) => x && x !== place.name).join(", ");
    $("place").innerHTML = esc(place.name) + (sub ? `<small>${esc(sub)}</small>` : "");
    $("when").textContent = new Date(c.time).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }) + " · " + hhmm(c.time);
    $("now-temp").innerHTML = `${round(c.temperature_2m)}<sup>°</sup>`;
    $("now-icon").innerHTML = icon(c.weather_code, !!c.is_day);
    $("now-label").textContent = label(c.weather_code);
    $("now-meta").textContent = `Max ${round(d.temperature_2m_max[0])}° · Min ${round(d.temperature_2m_min[0])}° · Percepita ${round(c.apparent_temperature)}°`;

    $("fav-toggle").hidden = false;
    renderFavs();
    renderHours();
    renderDays();
    renderTiles();

    const app = $("app");
    app.setAttribute("aria-busy", "false");
    app.classList.remove("ready");
    void app.offsetWidth; // riavvia l'animazione d'ingresso
    app.classList.add("ready");
  }

  function renderHours() {
    const h = state.data.hourly;
    const day = state.selectedDay;
    let from, to;
    if (day === 0) {
      from = state.nowIndex; to = Math.min(from + 24, h.time.length);
    } else {
      const date = state.data.daily.time[day];
      from = h.time.findIndex((t) => t.startsWith(date));
      to = from + 24;
    }

    let html = "";
    for (let i = from; i < to && i < h.time.length; i++) {
      const isNow = day === 0 && i === from;
      const prob = h.precipitation_probability[i] ?? 0;
      const midnight = hourOf(h.time[i]) === "00" && i !== from;
      const time = isNow ? "Ora" : midnight
        ? new Date(h.time[i]).toLocaleDateString("it-IT", { weekday: "short" })
        : hourOf(h.time[i]);
      html += `<li class="${isNow ? "is-now" : ""}">
        <span class="h-time">${esc(time)}</span>
        ${icon(h.weather_code[i], !!h.is_day[i])}
        <span class="h-temp">${round(h.temperature_2m[i])}°</span>
        <span class="h-rain">${prob >= 20 ? prob + "%" : ""}</span>
      </li>`;
    }
    const list = $("hours");
    list.innerHTML = html;
    list.scrollLeft = 0;

    const title = day === 0 ? "Ora per ora" : "Ora per ora · " + dayName(day, "long");
    $("hourly-title").textContent = title;
    $("back-today").hidden = day === 0;
  }

  function dayName(i, weekday = "short") {
    if (i === 0) return "Oggi";
    if (i === 1 && weekday === "long") return "domani";
    return new Date(state.data.daily.time[i] + "T12:00").toLocaleDateString("it-IT", { weekday });
  }

  function renderDays() {
    const d = state.data.daily;
    const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
    const span = Math.max(hi - lo, 1);
    $("days").innerHTML = d.time.map((_, i) => {
      const min = d.temperature_2m_min[i], max = d.temperature_2m_max[i];
      const left = ((min - lo) / span) * 100, right = ((hi - max) / span) * 100;
      const prob = d.precipitation_probability_max[i] ?? 0;
      return `<li><button type="button" data-day="${i}" aria-pressed="${i === state.selectedDay}"
          aria-label="${esc(dayName(i, "long"))}: ${esc(label(d.weather_code[i]))}, minima ${round(min)}°, massima ${round(max)}°">
        <span class="d-name">${esc(dayName(i))}</span>
        ${icon(d.weather_code[i], true)}
        <span class="d-rain">${prob >= 20 ? prob + "%" : ""}</span>
        <span class="d-min">${round(min)}°</span>
        <span class="d-bar"><i style="left:${left.toFixed(1)}%;right:${right.toFixed(1)}%"></i></span>
        <span class="d-max">${round(max)}°</span>
      </button></li>`;
    }).join("");
  }

  const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const uvLabel = (v) => (v < 3 ? "Basso" : v < 6 ? "Moderato" : v < 8 ? "Alto" : v < 11 ? "Molto alto" : "Estremo");
  const aqiLabel = (v) => (v <= 20 ? "Ottima" : v <= 40 ? "Buona" : v <= 60 ? "Discreta" : v <= 80 ? "Scarsa" : "Pessima");

  function renderTiles() {
    const { data, air, nowIndex: i } = state;
    const c = data.current, h = data.hourly, d = data.daily;
    const uv = h.uv_index[i] ?? 0;
    const vis = h.visibility[i];
    const dir = c.wind_direction_10m;
    const arrow = `<svg class="arrow" viewBox="0 0 24 24" style="transform:rotate(${(dir + 180) % 360}deg)" aria-hidden="true"><path d="M12 3l6 16-6-4-6 4z" fill="currentColor"/></svg>`;
    const rainToday = d.precipitation_sum[0] ?? 0;
    const aqi = air?.current?.european_aqi;

    const tiles = [
      ["Vento", `${round(c.wind_speed_10m)}<small>km/h</small>`, `${arrow}${COMPASS[Math.round(dir / 45) % 8]} · raffiche ${round(c.wind_gusts_10m)}`],
      ["Umidità", `${round(c.relative_humidity_2m)}<small>%</small>`, c.relative_humidity_2m >= 75 ? "Aria umida" : c.relative_humidity_2m <= 35 ? "Aria secca" : "Confortevole"],
      ["Indice UV", `${round(uv)}`, uvLabel(uv)],
      ["Pioggia oggi", `${rainToday < 10 ? rainToday.toFixed(1).replace(".", ",") : round(rainToday)}<small>mm</small>`, `Probabilità ${d.precipitation_probability_max[0] ?? 0}%`],
      ["Pressione", `${round(c.pressure_msl)}<small>hPa</small>`, c.pressure_msl >= 1020 ? "Alta pressione" : c.pressure_msl <= 1005 ? "Bassa pressione" : "Nella norma"],
      ["Visibilità", vis == null ? "—" : vis >= 10000 ? `${round(vis / 1000)}<small>km</small>` : `${(vis / 1000).toFixed(1).replace(".", ",")}<small>km</small>`, vis == null ? "" : vis >= 10000 ? "Ottima" : vis >= 4000 ? "Buona" : "Ridotta"],
      ["Qualità dell'aria", aqi == null ? "—" : `${round(aqi)}`, aqi == null ? "Dato non disponibile" : `${aqiLabel(aqi)} · PM2.5 ${round(air.current.pm2_5)}`],
      ["Alba", hhmm(d.sunrise[0]), ""],
      ["Tramonto", hhmm(d.sunset[0]), daylight(d.sunrise[0], d.sunset[0])],
    ];
    $("tiles").innerHTML = tiles.map(([title, value, sub]) =>
      `<div class="tile"><h3>${title}</h3><div class="t-val">${value}</div><div class="t-sub">${sub}</div></div>`).join("");
  }

  function daylight(rise, set) {
    const mins = (new Date(set) - new Date(rise)) / 60000;
    return `${Math.floor(mins / 60)} h ${String(Math.round(mins % 60)).padStart(2, "0")} di luce`;
  }

  /* ---------- Preferiti ---------- */

  function renderFavs() {
    const favs = store.get("cielo:favs", []);
    const nav = $("favs");
    nav.replaceChildren(...favs.map((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.name;
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

  /* ---------- Selezione giorno ---------- */

  $("days").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-day]");
    if (!btn) return;
    selectDay(Number(btn.dataset.day));
    if (innerWidth < 860) document.querySelector(".hourly").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  });
  $("back-today").addEventListener("click", () => selectDay(0));

  function selectDay(i) {
    state.selectedDay = i;
    renderHours();
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

  /* ---------- Sintesi e risposte ---------- */

  function when(iso) {
    const today = state.data.current.time.slice(0, 10);
    const h = Number(hourOf(iso));
    return (iso.slice(0, 10) === today ? "" : "domani ") + `verso le ${h}`;
  }

  // Finestra delle prossime `hours` ore a partire da adesso.
  function ahead(hours) {
    const h = state.data.hourly, from = state.nowIndex;
    const idx = [];
    for (let i = from; i < Math.min(from + hours, h.time.length); i++) idx.push(i);
    return idx;
  }

  function nextRain(hours = 24) {
    const h = state.data.hourly;
    return ahead(hours).find((i) => (h.precipitation_probability[i] ?? 0) >= 50);
  }

  const wetWord = (i) => (kind(state.data.hourly.weather_code[i]) === "snow" ? "Neve" : "Pioggia");

  function localSummary() {
    const { data, place, nowIndex } = state;
    const c = data.current, d = data.daily, h = data.hourly;
    const out = [`${label(c.weather_code)} a ${place.name}, ${round(c.temperature_2m)}° (percepiti ${round(c.apparent_temperature)}°).`];

    const rainAt = nextRain();
    if (isWet(c.weather_code)) {
      const stop = ahead(24).find((i) => (h.precipitation_probability[i] ?? 0) < 30 && !isWet(h.weather_code[i]));
      out.push(stop != null ? `Dovrebbe smettere ${when(h.time[stop])}.` : "Tempo instabile per tutta la giornata.");
    } else if (kind(c.weather_code) === "snow") {
      out.push("Attenzione a strade e marciapiedi scivolosi.");
    } else if (rainAt != null) {
      out.push(rainAt === nowIndex ? "Precipitazioni molto probabili a breve." : `${wetWord(rainAt)} probabile ${when(h.time[rainAt])}.`);
    } else {
      out.push("Niente pioggia in vista nelle prossime 24 ore.");
    }

    out.push(`Oggi si va da ${round(d.temperature_2m_min[0])}° a ${round(d.temperature_2m_max[0])}°.`);

    const uv = d.uv_index_max[0] ?? 0;
    const snowy = kind(c.weather_code) === "snow";
    if (!snowy && (rainAt != null || isWet(c.weather_code))) out.push("Meglio avere un ombrello con sé.");
    else if (c.wind_gusts_10m >= 50) out.push("Occhio alle raffiche di vento.");
    else if (c.apparent_temperature <= 5) out.push("Copriti bene, fa freddo.");
    else if (uv >= 6 && c.is_day) out.push("UV alto: non dimenticare la crema solare.");
    else if (c.apparent_temperature >= 32) out.push("Fa molto caldo: bevi spesso e cerca l'ombra.");
    else out.push(c.is_day ? "Una buona giornata per stare all'aperto." : "Una serata tranquilla per uscire.");
    return out.join(" ");
  }

  const LOCAL_ANSWERS = {
    umbrella() {
      const h = state.data.hourly;
      const idx = ahead(12);
      const max = Math.max(...idx.map((i) => h.precipitation_probability[i] ?? 0));
      const at = idx.find((i) => (h.precipitation_probability[i] ?? 0) >= 50);
      if (isWet(state.data.current.weather_code)) return "Sì, sta già piovendo: prendilo.";
      if (kind(state.data.current.weather_code) === "snow") return "Sta nevicando: più dell'ombrello servono un cappuccio e scarpe con una buona suola.";
      if (at != null) return `Sì, portalo: ${wetWord(at).toLowerCase()} probabile ${when(h.time[at])} (fino al ${max}%).`;
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
      if (kind(c.weather_code) === "snow") s += " Scarpe impermeabili, nevica.";
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

  function aiURL(extra = {}) {
    const p = new URLSearchParams({ lat: state.place.lat, lon: state.place.lon, name: state.place.name, ...extra });
    return `api/ai?${p}`;
  }

  async function askAI(extra) {
    if (state.aiAvailable === false) return null;
    try {
      const json = await getJSON(aiURL(extra), { timeout: 25000 });
      if (typeof json.text !== "string" || !json.text.trim()) throw new Error("risposta vuota");
      state.aiAvailable = true;
      return json.text.trim();
    } catch (err) {
      // 404/405 = sito pubblicato senza backend; 503 = chiave non configurata.
      if ([404, 405, 501, 503].includes(err.status) || state.aiAvailable === null) state.aiAvailable = false;
      return null;
    }
  }

  async function loadSummary(id) {
    const text = $("ai-text");
    text.innerHTML = '<span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span>';
    $("ai-answer").hidden = true;
    $("ai-chips").hidden = true;

    const ai = await askAI();
    if (id !== state.requestId) return;

    typeInto(text, ai ?? localSummary());
    $("ai-badge").hidden = !ai;
    $("ai-chips").hidden = false;
    $("ask").hidden = !state.aiAvailable;
    $("ai-note").textContent = state.aiAvailable ? "Sintesi e risposte generate dall'AI: possono contenere imprecisioni." : "";
  }

  async function answer(question, localKey) {
    const box = $("ai-answer"), a = $("ai-a");
    $("ai-q").textContent = question;
    a.innerHTML = '<span class="sk sk-line"></span><span class="sk sk-line short"></span>';
    box.hidden = false;
    const id = state.requestId;
    const ai = await askAI({ q: question });
    if (id !== state.requestId) return;
    const text = ai ?? (localKey ? LOCAL_ANSWERS[localKey]() : "Non riesco a rispondere in questo momento. Riprova tra poco.");
    typeInto(a, text);
  }

  $("ai-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-q]");
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
    return store.get("cielo:last", null) ?? DEFAULT_PLACE;
  }

  load(initialPlace());

  // Aggiorna i dati quando si torna sulla scheda dopo un po'.
  let loadedAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - loadedAt > 15 * 60 * 1000 && state.place) {
      loadedAt = Date.now();
      load(state.place);
    }
  });
})();

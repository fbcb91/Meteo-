// Server locale che imita Vercel: stessi indirizzi (vercel.json), stesse intestazioni, stesse funzioni.
// Uso: npm run dev   →   http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const port = Number(process.env.PORT || 3000);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };

// Traduce i "source" di vercel.json (":nome" e gruppi) in espressioni regolari.
const toRegex = (source) => new RegExp("^" + source.replace(/:([a-z]+)/g, "(?<$1>[^/]+)") + "$");
const rewrites = config.rewrites.map((r) => ({ re: toRegex(r.source), to: r.destination }));
const headerRules = config.headers.map((h) => ({ re: toRegex(h.source), headers: h.headers }));

async function runFunction(file, req, res, url) {
  const mod = await import(pathToFileURL(path.join(root, file)).href);
  req.url = url;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
  res.send = (body) => res.end(body);
  await mod.default(req, res);
}

http.createServer(async (req, res) => {
  try {
    const { pathname, search } = new URL(req.url, "http://localhost");
    for (const rule of headerRules) if (rule.re.test(pathname)) for (const h of rule.headers) {
      // In locale non c'è HTTPS: l'intestazione che lo impone romperebbe il browser.
      if (h.key !== "Strict-Transport-Security") res.setHeader(h.key, h.value);
    }

    let target = pathname + search;
    if (!pathname.startsWith("/api/")) {
      const file = path.join(root, pathname);
      const isStatic = pathname !== "/" && !pathname.endsWith(".html") && file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()
        && !/^\/(api|lib|tools|data|node_modules)\//.test(pathname) && !/^\/(package|vercel)/.test(pathname);
      if (isStatic) { res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream"); return res.end(fs.readFileSync(file)); }
      const rule = rewrites.find((r) => r.re.test(pathname));
      if (!rule) { res.statusCode = 404; return res.end("Not found"); }
      const groups = pathname.match(rule.re).groups ?? {};
      target = rule.to.replace(/:([a-z]+)/g, (_, k) => encodeURIComponent(groups[k] ?? ""));
      if (search) target += (target.includes("?") ? "&" : "?") + search.slice(1);
    }
    const name = new URL(target, "http://localhost").pathname.replace(/^\/api\//, "");
    const file = `api/${name}.js`;
    if (!fs.existsSync(path.join(root, file))) { res.statusCode = 404; return res.end("Not found"); }
    await runFunction(file, req, res, target);
  } catch (err) {
    console.error(err);
    res.statusCode = 500; res.end("Errore del server locale");
  }
}).listen(port, () => console.log(`Cielo in locale: http://localhost:${port}`));

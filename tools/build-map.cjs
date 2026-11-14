// Costruisce i contorni (coste e confini) usati come sfondo del radar, a partire da Natural Earth (world-atlas).
// Mondo a bassa risoluzione, Europa e Mediterraneo ad alta. Uso: node build-map.cjs <file di uscita>
const fs = require('fs'), topojson = require('topojson-client');
const load = (name) => JSON.parse(fs.readFileSync(require.resolve(`world-atlas/${name}`)));
const BOX = { w: -12, e: 31, s: 33, n: 61 };
const inside = ([lon, lat]) => lon >= BOX.w && lon <= BOX.e && lat >= BOX.s && lat <= BOX.n;

// Spezza ogni linea tenendo solo i tratti dentro (o fuori) il riquadro, e sfoltisce i punti troppo vicini.
function pieces(lines, keepInside, minStep, digits) {
  const out = [];
  for (const line of lines) {
    let run = [];
    const flush = () => { if (run.length > 1) out.push(run); run = []; };
    for (const pt of line) {
      if (inside(pt) !== keepInside) { flush(); continue; }
      const last = run[run.length - 1];
      if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= minStep) run.push([+pt[0].toFixed(digits), +pt[1].toFixed(digits)]);
    }
    flush();
  }
  return out;
}
const mesh = (topo) => topojson.mesh(topo, topo.objects.countries).coordinates;
const data = {
  source: 'Natural Earth (pubblico dominio), via world-atlas',
  world: pieces(mesh(load('countries-110m.json')), false, 0.1, 2),
  europe: pieces(mesh(load('countries-10m.json')), true, 0.015, 3),
};
fs.writeFileSync(process.argv[2], JSON.stringify(data));
const count = (a) => a.reduce((n, l) => n + l.length, 0);
console.log('mondo:', data.world.length, 'linee,', count(data.world), 'punti | europa:', data.europe.length, 'linee,', count(data.europe), 'punti');

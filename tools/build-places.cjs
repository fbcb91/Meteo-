// Costruisce data/places.json: i comuni italiani con coordinate, da GeoNames (pacchetto all-the-cities, CC BY 4.0).
// Uso: npm run build:places
const fs = require('fs');
const REGIONS = { '01': 'Abruzzo', '02': 'Basilicata', '03': 'Calabria', '04': 'Campania', '05': 'Emilia-Romagna', '06': 'Friuli-Venezia Giulia',
  '07': 'Lazio', '08': 'Liguria', '09': 'Lombardia', '10': 'Marche', '11': 'Molise', '12': 'Piemonte', '13': 'Puglia', '14': 'Sardegna',
  '15': 'Sicilia', '16': 'Toscana', '17': 'Trentino-Alto Adige', '18': 'Umbria', '19': "Valle d'Aosta", '20': 'Veneto' };
// GeoNames usa il nome inglese per alcune città e qualche grafia datata.
const RENAME = { Rome: 'Roma', Milan: 'Milano', Naples: 'Napoli', Turin: 'Torino', Genoa: 'Genova', Florence: 'Firenze', Venice: 'Venezia',
  'San Remo': 'Sanremo', "Reggio nell'Emilia": 'Reggio Emilia', 'Cava Dè Tirreni': "Cava de' Tirreni", 'Carpi Centro': 'Carpi', 'Lido di Ostia': 'Ostia' };
const EXTRA = new Set(['Mestre', 'Lido di Ostia']); // località importanti che non sono sede di comune
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const regionNames = Object.values(REGIONS).sort((a, b) => a.localeCompare(b, 'it'));
const all = require('all-the-cities').filter((c) => c.country === 'IT' && REGIONS[c.adminCode] &&
  (['PPLC', 'PPLA', 'PPLA2', 'PPLA3'].includes(c.featureCode) || EXTRA.has(c.name)));
all.sort((a, b) => b.population - a.population);

const taken = new Set(), places = [];
for (const c of all) {
  const name = RENAME[c.name] ?? c.name, region = REGIONS[c.adminCode];
  // A parità di nome vince il comune più popoloso; gli altri prendono la regione nell'indirizzo.
  let slug = slugify(name);
  if (taken.has(slug)) slug = `${slug}-${slugify(region)}`;
  if (taken.has(slug) || !slug) continue;
  taken.add(slug);
  places.push([slug, name, regionNames.indexOf(region), +c.loc.coordinates[1].toFixed(3), +c.loc.coordinates[0].toFixed(3), c.population]);
}
fs.writeFileSync(process.argv[2], JSON.stringify({ source: 'GeoNames (CC BY 4.0), via all-the-cities', regions: regionNames, places }));
console.log(places.length, 'località |', places.slice(0, 8).map((p) => p[0]).join(', '));

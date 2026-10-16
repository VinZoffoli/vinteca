// Proceso aparte (utilityProcess de Electron): descarga la base de datos de
// Ludusavi (dónde guarda sus partidas cada juego, ~18 MB de YAML), se queda solo
// con tus juegos y termina. Así los ~200 MB que ocupa leerla no se quedan en la app.
const yaml = require('js-yaml');

const URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const strip = (s) => norm(s).replace(/\b(definitive|enhanced|complete|goty|game of the year|deluxe|ultimate|remastered|directors cut|edition)\b/g, ' ').replace(/\s+/g, ' ').trim();

function forStore(v, store) {
  if (!v || !(v.tags || []).includes('save')) return false;
  if (!v.when) return true;
  return v.when.some((w) => (!w.os || w.os === 'windows') && (!w.store || w.store === store));
}

async function run(games) {
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`No se pudo descargar la base de datos de partidas (HTTP ${r.status}).`);
  const manifest = yaml.load(await r.text());
  const bySteam = new Map();
  const byName = new Map();
  for (const [name, e] of Object.entries(manifest)) {
    if (e?.steam?.id) bySteam.set(Number(e.steam.id), name);
    const k = norm(name);
    if (!byName.has(k)) byName.set(k, name);
    const k2 = strip(name);
    if (k2 && !byName.has(k2)) byName.set(k2, name);
  }
  const out = {};
  for (const g of games) {
    const name = (g.appid && bySteam.get(g.appid)) || byName.get(norm(g.title)) || byName.get(strip(g.title));
    if (!name) continue;
    const e = manifest[name] || {};
    const files = Object.entries(e.files || {})
      .filter(([, v]) => forStore(v, g.store))
      .map(([p]) => p);
    const registry = Object.entries(e.registry || {}).some(([, v]) => (v?.tags || []).includes('save'));
    if (!files.length && !registry) continue;
    out[g.id] = { name, files, registry, cloud: e.cloud || {} };
  }
  return out;
}

process.parentPort.on('message', async (e) => {
  try {
    const index = await run(e.data.games || []);
    process.parentPort.postMessage({ ok: true, index });
  } catch (err) {
    process.parentPort.postMessage({ ok: false, error: err.message });
  }
  process.exit(0);
});

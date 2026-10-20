// Copia de seguridad de tus datos de ViperTeca en OneDrive (una carpeta por día,
// se guardan las 10 últimas). Solo lo que escribes tú: Casa, regalos, notas de
// juegos, partidas, Genshin, anime, postulaciones… Nunca las claves ni tokens
// (settings.json se queda fuera) ni las cachés que se pueden volver a bajar.
const fs = require('fs');
const path = require('path');

const FILES = [
  'casa.json', 'user-games.json', 'sessions.json', 'anime.json', 'gfarm-plan.json', 'gresin.json', 'genshin-tasks.json', 'genshin-wishes.json',
  'workana.json', 'linkedin.json', 'alquileres.json', 'price-alerts.json', 'purchase-dates.json', 'weekly.json', 'claude-chats.json', 'calendar-known.json',
  // 1.30: lo que se añadió después (notas, historiales que no se pueden volver a bajar)
  'genshin-inventory.json', 'genshin-gather.json', 'genshin-events-done.json', 'genshin-ai.json', 'goals.json', 'assist-chat.json', 'streaming.json', 'gift-prices.json',
  'price-history.json', 'oneonone.json', 'spend.json', 'journal.json', 'uptime.json', 'cwv.json', 'launch-checks.json', 'changelogs.json', 'team-week.json',
];
const KEEP = 30;

function oneDrive() {
  const cands = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(require('os').homedir(), 'OneDrive')].filter(Boolean);
  return cands.find((d) => fs.existsSync(d)) || null;
}
function root() {
  // en las pruebas (con una copia de los datos) nunca se toca la carpeta real de copias
  if (process.env.BJ_USERDATA) return path.join(process.env.BJ_USERDATA, 'copias-prueba');
  const od = oneDrive();
  return od ? path.join(od, 'ViperTeca', 'Copias') : null;
}

/** Hace la copia de hoy (si ya hay una de hoy, la actualiza). */
function run(dataDir) {
  const dest0 = root();
  if (!dest0) throw new Error('No encuentro la carpeta de OneDrive en este PC.');
  const day = new Date().toLocaleDateString('sv'); // fecha de aquí (no la UTC)
  const dest = path.join(dest0, day);
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of FILES) {
    const src = path.join(dataDir, f);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dest, f));
    n++;
  }
  fs.writeFileSync(path.join(dest, 'LEEME.txt'), 'Copia de tus datos de ViperTeca. Para recuperarlos, copia estos archivos a %APPDATA%\\biblioteca-juegos con la app cerrada.\r\n');
  // borra las copias más viejas
  const days = fs.readdirSync(dest0).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - KEEP))) fs.rmSync(path.join(dest0, old), { recursive: true, force: true });
  return status(n);
}

function status(files) {
  const r = root();
  if (!r) return { available: false };
  const days = fs.existsSync(r) ? fs.readdirSync(r).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  const last = days[days.length - 1] || null;
  let at = null;
  if (last) {
    try {
      at = fs.statSync(path.join(r, last)).mtimeMs;
    } catch {}
  }
  return { available: true, folder: r, last, at, count: days.length, files: files ?? null };
}

/** Copias guardadas (días) con sus archivos. */
function list() {
  const r = root();
  if (!r || !fs.existsSync(r)) return [];
  return fs.readdirSync(r).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().map((day) => ({
    day,
    files: fs.readdirSync(path.join(r, day)).filter((f) => f.endsWith('.json')).map((f) => {
      const st = fs.statSync(path.join(r, day, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    }),
  }));
}
/** Contenido de un archivo de una copia (solo nombres de archivo de la lista). */
function readCopy(day, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !FILES.includes(name)) throw new Error('Esa copia no existe.');
  const f = path.join(root(), day, name);
  if (!fs.existsSync(f)) throw new Error('Ese archivo no está en esa copia.');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
/** Guarda el archivo actual en «antes-de-restaurar» antes de cambiarlo. */
function keepCurrent(dataDir, name) {
  const src = path.join(dataDir, name);
  if (!fs.existsSync(src)) return null;
  const dest = path.join(root() || dataDir, 'antes-de-restaurar', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(src, path.join(dest, name));
  return path.join(dest, name);
}

module.exports = { run, status, root, list, readCopy, keepCurrent, FILES };

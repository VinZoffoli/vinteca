// Copia de seguridad de tus datos de ViperTeca en OneDrive (una carpeta por día,
// se guardan las 10 últimas). Solo lo que escribes tú: Casa, regalos, notas de
// juegos, partidas, Genshin, anime, postulaciones… Nunca las claves ni tokens
// (settings.json se queda fuera) ni las cachés que se pueden volver a bajar.
const fs = require('fs');
const path = require('path');

const FILES = [
  'casa.json', 'user-games.json', 'sessions.json', 'anime.json', 'gfarm-plan.json', 'gresin.json', 'genshin-tasks.json', 'genshin-wishes.json',
  'workana.json', 'linkedin.json', 'alquileres.json', 'price-alerts.json', 'purchase-dates.json', 'weekly.json', 'claude-chats.json', 'calendar-known.json',
];
const KEEP = 10;

function oneDrive() {
  const cands = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(require('os').homedir(), 'OneDrive')].filter(Boolean);
  return cands.find((d) => fs.existsSync(d)) || null;
}
function root() {
  const od = oneDrive();
  return od ? path.join(od, 'ViperTeca', 'Copias') : null;
}

/** Hace la copia de hoy (si ya hay una de hoy, la actualiza). */
function run(dataDir) {
  const dest0 = root();
  if (!dest0) throw new Error('No encuentro la carpeta de OneDrive en este PC.');
  const day = new Date().toISOString().slice(0, 10);
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

module.exports = { run, status, root };

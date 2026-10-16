// Capturas de pantalla de cada juego: las de Steam (tecla F12) y las de la
// Barra de juegos de Windows (Win+Alt+Impr Pant).
const fs = require('fs');
const path = require('path');
const os = require('os');

const IMG = /\.(jpe?g|png|webp)$/i;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’™®]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function roots({ steamPath, steamId }) {
  const out = [];
  if (steamPath && steamId) {
    const acc = (BigInt(steamId) & 0xffffffffn).toString();
    out.push(path.join(steamPath, 'userdata', acc, '760', 'remote'));
  }
  out.push(path.join(os.homedir(), 'Videos', 'Captures'));
  return out;
}

function list(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => IMG.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Capturas de un juego, de la más nueva a la más vieja. */
function forGame(game, ctx) {
  const r = roots(ctx);
  const steamRoot = r.length === 2 ? r[0] : null;
  const captures = r[r.length - 1];
  let files = [];
  if (game.store === 'steam' && steamRoot) files = list(path.join(steamRoot, game.id.split(':')[1], 'screenshots'));
  // La Barra de juegos nombra los archivos "<Título> <fecha>.png"
  const t = norm(game.title);
  if (t.length >= 3) files = files.concat(list(captures).filter((f) => norm(path.basename(f)).startsWith(t)));
  return files
    .map((file) => {
      try {
        return { file, time: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time)
    .slice(0, 40);
}

/** Solo se sirven imágenes de esas carpetas (nada más del disco). */
function isAllowed(file, ctx) {
  const f = path.resolve(file).toLowerCase();
  return IMG.test(f) && roots(ctx).some((r) => f.startsWith(path.resolve(r).toLowerCase() + path.sep));
}

module.exports = { forGame, isAllowed, roots };

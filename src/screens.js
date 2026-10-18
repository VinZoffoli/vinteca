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

// ---- clips de vídeo ----
const VID = /[.](mp4|mkv|webm|mov)$/i;
const videosDir = () => path.join(os.homedir(), 'Videos');
function listVid(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => VID.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
/** Clips de un juego: Barra de juegos ("<Título> <fecha>.mp4"), NVIDIA y AMD (carpeta con el nombre del juego). */
function clipsForGame(game) {
  const t = norm(game.title);
  if (t.length < 3) return [];
  const v = videosDir();
  let files = listVid(path.join(v, 'Captures')).filter((f) => norm(path.basename(f)).startsWith(t));
  const folders = [v, path.join(v, 'NVIDIA'), path.join(v, 'Radeon ReLive'), path.join(v, 'AMD')];
  for (const base of folders) {
    let subs = [];
    try {
      subs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {}
    for (const d of subs) {
      const n = norm(d.name);
      if (n === t || (n.length >= 4 && (n.startsWith(t) || t.startsWith(n)))) files = files.concat(listVid(path.join(base, d.name)));
    }
  }
  return [...new Set(files)]
    .map((file) => {
      try {
        const st = fs.statSync(file);
        return { file, time: st.mtimeMs, size: st.size, name: path.basename(file) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time)
    .slice(0, 30);
}
/** Solo se sirven vídeos de la carpeta Vídeos del usuario. */
function isAllowedVideo(file) {
  const f = path.resolve(file).toLowerCase();
  return VID.test(f) && f.startsWith(path.resolve(videosDir()).toLowerCase() + path.sep);
}

module.exports = { forGame, isAllowed, roots, clipsForGame, isAllowedVideo };

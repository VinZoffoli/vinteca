// Copias de seguridad de partidas guardadas, a partir de las rutas de la base de
// datos de Ludusavi (ver saves-worker.js). Las copias van a
// Documentos\Biblioteca de juegos - partidas guardadas\<juego>\<fecha>, o a esa misma
// carpeta dentro de la que elijas (por ejemplo OneDrive o Google Drive, para tenerlas en la nube).
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_FILES = 20000;
const MAX_BYTES = 4 * 1024 ** 3;
const INDEX_TTL = 7 * 86400000;

const FOLDER = 'Biblioteca de juegos - partidas guardadas';
function backupRoot(ctx) {
  return path.join(ctx.backupDir || ctx.documents, FOLDER);
}

/** Carpetas de nube instaladas en este PC (para elegirlas con un clic). */
function cloudDirs() {
  const out = [];
  const add = (name, dir) => {
    if (dir && fs.existsSync(dir) && !out.some((o) => o.dir.toLowerCase() === dir.toLowerCase())) out.push({ name, dir });
  };
  add('OneDrive', process.env.OneDriveConsumer || process.env.OneDrive);
  add('OneDrive (trabajo)', process.env.OneDriveCommercial);
  // Google Drive para escritorio monta una unidad con "Mi unidad" / "My Drive"
  for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const n of ['Mi unidad', 'My Drive']) add('Google Drive', `${l}:\\${n}`);
  }
  add('Google Drive', path.join(os.homedir(), 'Google Drive'));
  add('Dropbox', path.join(os.homedir(), 'Dropbox'));
  return out;
}

/** Cambia la carpeta de copias y mueve allí las que ya había. */
function moveBackups(fromCtx, toCtx) {
  const from = backupRoot(fromCtx);
  const to = backupRoot(toCtx);
  if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase() || !fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let moved = 0;
  for (const d of fs.readdirSync(from, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    fs.cpSync(path.join(from, d.name), path.join(to, d.name), { recursive: true, force: false, errorOnExist: false });
    fs.rmSync(path.join(from, d.name), { recursive: true, force: true });
    moved++;
  }
  try {
    fs.rmdirSync(from);
  } catch {}
  return moved;
}

const safeName = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Juego';
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
};

/** Sustituye los <marcadores> de Ludusavi; null si alguno no se puede resolver. */
function resolvePlaceholders(pattern, game, ctx) {
  const home = os.homedir();
  const appid = game.store === 'steam' ? game.id.split(':')[1] : null;
  const map = {
    home,
    winAppData: process.env.APPDATA,
    winLocalAppData: process.env.LOCALAPPDATA,
    winLocalAppDataLow: path.join(home, 'AppData', 'LocalLow'),
    winDocuments: ctx.documents,
    winPublic: process.env.PUBLIC || 'C:\\Users\\Public',
    winProgramData: process.env.ProgramData || 'C:\\ProgramData',
    winDir: process.env.WINDIR || 'C:\\Windows',
    osUserName: process.env.USERNAME,
    base: game.installPath || null,
    game: game.installPath ? path.basename(game.installPath) : null,
    root: game.store === 'steam' ? ctx.steamPath : null,
    storeUserId: game.store === 'steam' && ctx.accountId ? ctx.accountId : '*',
    storeGameId: appid,
  };
  let ok = true;
  const out = pattern.replace(/<([a-zA-Z]+)>/g, (_, k) => {
    const v = map[k];
    if (!v) ok = false;
    return v || '';
  });
  return ok ? path.normalize(out) : null;
}

const globRe = (seg) => new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

function walkFiles(p, out, budget) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (out.length >= MAX_FILES || budget.bytes + st.size > MAX_BYTES) throw new Error('Las partidas de este juego ocupan demasiado para copiarlas (más de 4 GB o 20.000 archivos).');
    budget.bytes += st.size;
    out.push({ file: p, size: st.size });
    return;
  }
  if (!st.isDirectory()) return;
  for (const e of fs.readdirSync(p)) walkFiles(path.join(p, e), out, budget);
}

/** Expande comodines (* ? y **) y devuelve los archivos que existen. */
function expand(pattern) {
  const parts = pattern.split(/[\\/]+/).filter(Boolean);
  let bases = [parts[0] + path.sep];
  for (let i = 1; i < parts.length && bases.length; i++) {
    const seg = parts[i];
    const next = [];
    for (const b of bases) {
      if (seg === '**') {
        const stack = [b];
        while (stack.length) {
          const d = stack.pop();
          next.push(d);
          try {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) stack.push(path.join(d, e.name));
          } catch {}
        }
      } else if (/[*?]/.test(seg)) {
        const re = globRe(seg);
        try {
          for (const e of fs.readdirSync(b)) if (re.test(e)) next.push(path.join(b, e));
        } catch {}
      } else {
        const p = path.join(b, seg);
        if (fs.existsSync(p)) next.push(p);
      }
    }
    bases = next;
  }
  return bases;
}

function findFiles(game, info, ctx) {
  const out = [];
  const budget = { bytes: 0 };
  const seen = new Set();
  for (const pat of info.files || []) {
    const resolved = resolvePlaceholders(pat, game, ctx);
    if (!resolved) continue;
    for (const p of expand(resolved)) {
      const before = out.length;
      walkFiles(p, out, budget);
      for (let i = before; i < out.length; i++) {
        const k = out[i].file.toLowerCase();
        if (seen.has(k)) out.splice(i--, 1);
        else seen.add(k);
      }
    }
  }
  return out;
}

function listBackups(game, ctx) {
  const dir = path.join(backupRoot(ctx), safeName(game.title));
  try {
    return fs
      .readdirSync(dir)
      .map((d) => {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, d, 'copia.json'), 'utf8'));
          return { dir: path.join(dir, d), created: meta.created, files: meta.files.length, bytes: meta.files.reduce((s, f) => s + f.size, 0), note: meta.note || null };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

function backup(game, info, ctx, note) {
  const files = findFiles(game, info, ctx);
  if (!files.length) throw new Error('No se encontraron partidas guardadas de este juego en este PC.');
  const dir = path.join(backupRoot(ctx), safeName(game.title), stamp());
  const entries = [];
  for (const f of files) {
    const rel = f.file.replace(/^([A-Za-z]):/, '$1');
    const dest = path.join(dir, 'archivos', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.file, dest);
    entries.push({ src: f.file, rel, size: f.size });
  }
  fs.writeFileSync(path.join(dir, 'copia.json'), JSON.stringify({ game: game.title, id: game.id, created: Date.now(), note: note || null, files: entries }, null, 1));
  return { dir, files: entries.length, bytes: entries.reduce((s, e) => s + e.size, 0) };
}

/** Vuelve a poner los archivos de una copia en su sitio (antes guarda una copia de lo actual). */
function restore(game, info, ctx, dir) {
  const root = path.resolve(backupRoot(ctx)).toLowerCase();
  if (!path.resolve(dir).toLowerCase().startsWith(root + path.sep)) throw new Error('Esa carpeta no es una copia de la app.');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'copia.json'), 'utf8'));
  let safety = null;
  try {
    safety = backup(game, info, ctx, 'Antes de restaurar');
  } catch {}
  for (const f of meta.files) {
    fs.mkdirSync(path.dirname(f.src), { recursive: true });
    fs.copyFileSync(path.join(dir, 'archivos', f.rel), f.src);
  }
  return { files: meta.files.length, safety: safety?.dir || null };
}

/** Deja solo las últimas copias automáticas de un juego (las manuales no se tocan). */
function pruneAuto(game, ctx, keep) {
  const autos = listBackups(game, ctx).filter((b) => b.note === 'Automática');
  for (const b of autos.slice(keep)) {
    try {
      fs.rmSync(b.dir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = { backupRoot, cloudDirs, moveBackups, listBackups, backup, restore, findFiles, pruneAuto, INDEX_TTL };

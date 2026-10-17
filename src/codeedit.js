// Editor de código de Websites: leer y guardar archivos de una web, crear,
// renombrar y mandar a la papelera, y avisar cuando algo cambia en disco
// (por ejemplo, cuando Claude edita un archivo). Todo dentro de la carpeta de
// la web abierta: nunca sale de ella.
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const HEAVY = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.vercel', '.turbo', 'coverage', '.cache']);
const MAX = 3 * 1024 * 1024;

/** Ruta absoluta dentro de la web, o error si intenta salir. */
function inside(root, rel = '') {
  const abs = path.resolve(root, String(rel || ''));
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Esa ruta está fuera de la web.');
  return abs;
}

function list(root, rel) {
  const dir = inside(root, rel);
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const p = path.posix.join(String(rel || '').replace(/\\/g, '/'), e.name);
    out.push({ name: e.name, path: p, dir: e.isDirectory(), heavy: e.isDirectory() && HEAVY.has(e.name) });
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) : a.dir ? -1 : 1));
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function read(root, rel) {
  const f = inside(root, rel);
  const st = fs.statSync(f);
  if (st.isDirectory()) throw new Error('Es una carpeta.');
  if (st.size > MAX) return { path: rel, tooBig: true, size: st.size, mtime: st.mtimeMs };
  const buf = fs.readFileSync(f);
  if (isBinary(buf)) return { path: rel, binary: true, size: st.size, mtime: st.mtimeMs };
  return { path: rel, text: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs, eol: /\r\n/.test(buf.toString('utf8', 0, Math.min(buf.length, 20000))) ? 'CRLF' : 'LF' };
}

function write(root, rel, text, eol) {
  const f = inside(root, rel);
  let t = String(text ?? '');
  if (eol === 'CRLF') t = t.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(f, t, 'utf8');
  return { mtime: fs.statSync(f).mtimeMs };
}

function create(root, rel, isDir) {
  const f = inside(root, rel);
  if (fs.existsSync(f)) throw new Error('Ya existe un archivo o carpeta con ese nombre.');
  if (isDir) fs.mkdirSync(f, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '');
  }
  return true;
}

function rename(root, from, to) {
  const a = inside(root, from);
  const b = inside(root, to);
  if (fs.existsSync(b)) throw new Error('Ya existe algo con ese nombre.');
  fs.renameSync(a, b);
  return true;
}

async function trash(root, rel) {
  const f = inside(root, rel);
  if (f === path.resolve(root)) throw new Error('No se puede borrar la carpeta de la web.');
  await shell.trashItem(f); // a la papelera de Windows: se puede recuperar
  return true;
}

// ---- vigilancia de cambios ----
let watcher = null;
let watchRoot = null;
function watch(root, onChange) {
  unwatch();
  watchRoot = root;
  const pending = new Set();
  let timer = null;
  try {
    watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
      if (!file) return;
      const f = String(file).replace(/\\/g, '/');
      if (f.split('/').some((p) => HEAVY.has(p))) return;
      pending.add(f);
      clearTimeout(timer);
      timer = setTimeout(() => {
        onChange([...pending]);
        pending.clear();
      }, 250);
    });
  } catch {
    watcher = null;
  }
  return !!watcher;
}
function unwatch() {
  if (watcher) watcher.close();
  watcher = null;
  watchRoot = null;
}

module.exports = { list, read, write, create, rename, trash, watch, unwatch, inside, current: () => watchRoot };

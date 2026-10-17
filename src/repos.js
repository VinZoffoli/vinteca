// Websites de Resto Experience: revisa cada carpeta de webs y su repositorio git.
//  - ¿Hay cambios sin subir? ¿Commits locales sin push? ¿Te falta un git pull?
//  - Usa el git de tu PC con tus credenciales de siempre. Nunca pide contraseñas:
//    si un repo pide login, se marca como "sin acceso" y sigue.
//  - Lo único que cambia algo es "Actualizar" (git pull --ff-only), y solo
//    cuando la carpeta está limpia y no tiene commits sin subir.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_DIR = path.join(require('os').homedir(), 'Desktop', 'Vincenzo', 'Resto Experience', 'Webs');
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: 'echo', SSH_ASKPASS: 'echo', LC_ALL: 'C' };

function git(cwd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'credential.interactive=never', ...args], { cwd, env: ENV, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim(), timedOut: !!(err && err.killed) });
    });
  });
}

let hasGit = null;
async function gitAvailable() {
  if (hasGit == null) hasGit = (await git(process.cwd(), ['--version'], 8000)).ok;
  return hasGit;
}

function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/** Qué tipo de web es, mirando los archivos de la carpeta. */
function detect(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const pkg = readJson(path.join(dir, 'package.json'));
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  if (deps.next) return { tech: 'Next.js', version: String(deps.next).replace(/^[^\d]*/, '') };
  if (deps.astro) return { tech: 'Astro', version: String(deps.astro).replace(/^[^\d]*/, '') };
  if (deps.nuxt) return { tech: 'Nuxt' };
  if (deps['@remix-run/react']) return { tech: 'Remix' };
  if (deps.gatsby) return { tech: 'Gatsby' };
  if (deps.vite && deps.react) return { tech: 'React + Vite' };
  if (deps.vite) return { tech: 'Vite' };
  if (deps.react) return { tech: 'React' };
  if (has('wp-config.php') || has('wp-content') || has('wp-config-sample.php')) return { tech: 'WordPress' };
  if (has('style.css') && has('functions.php')) return { tech: 'Tema de WordPress' };
  if (has('shopify.theme.toml') || (has('layout') && has('sections') && has('templates'))) return { tech: 'Shopify' };
  if (pkg) return { tech: 'Node' };
  if (has('index.html')) return { tech: 'HTML estático' };
  if (has('composer.json')) return { tech: 'PHP' };
  return { tech: '' };
}

function githubUrl(remote) {
  if (!remote) return null;
  const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}
const repoKey = (url) => {
  const m = String(url || '').match(/github\.com[:/]([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
};

function dirSize(dir, depth = 0) {
  // solo para saber si node_modules existe y no está vacío; no recorre todo
  return fs.existsSync(path.join(dir, 'node_modules')) ? 1 : 0;
}

/** Revisa una carpeta. fetch=true pregunta a GitHub si hay cambios nuevos. */
async function inspect(dir, { fetch = true } = {}) {
  const name = path.basename(dir);
  const base = { name, dir, ...detect(dir) };
  let mtime = null;
  try {
    mtime = fs.statSync(dir).mtimeMs;
  } catch {}
  if (!fs.existsSync(path.join(dir, '.git'))) return { ...base, git: false, mtime, state: 'nogit' };

  const [branchR, remoteR] = await Promise.all([git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), git(dir, ['remote', 'get-url', 'origin'])]);
  const branch = branchR.ok ? branchR.out : null;
  const remote = remoteR.ok ? remoteR.out : null;
  const r = { ...base, git: true, mtime, branch, remote, github: githubUrl(remote), repoKey: repoKey(remote), detached: branch === 'HEAD', deps: dirSize(dir) > 0 };

  // pregunta a GitHub
  if (fetch && remote) {
    const f = await git(dir, ['fetch', '--prune', '--quiet', 'origin'], 45000);
    r.fetched = f.ok;
    if (!f.ok) r.fetchError = f.timedOut ? 'GitHub tardó demasiado en responder.' : /authentication|could not read username|permission denied|403|not found|repository .* not found/i.test(f.err) ? 'Sin acceso al repositorio con tus credenciales de git.' : /could not resolve host|unable to access/i.test(f.err) ? 'Sin conexión con GitHub.' : f.err.split('\n').pop().slice(0, 160);
  }

  const [status, upstream, last, stash, defR] = await Promise.all([
    git(dir, ['status', '--porcelain=v1', '--untracked-files=normal']),
    git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    git(dir, ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%cI']),
    git(dir, ['stash', 'list']),
    git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ]);
  const lines = status.ok && status.out ? status.out.split('\n') : [];
  r.changes = { total: lines.length, untracked: lines.filter((l) => l.startsWith('??')).length, modified: lines.filter((l) => !l.startsWith('??')).length, sample: lines.slice(0, 8).map((l) => l.slice(3)) };
  r.stashes = stash.ok && stash.out ? stash.out.split('\n').length : 0;
  if (last.ok && last.out) {
    const [hash, subject, author, date] = last.out.split('\x1f');
    r.last = { hash, subject, author, date };
  }
  r.upstream = upstream.ok ? upstream.out : null;
  if (r.upstream) {
    const c = await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const [ahead, behind] = c.ok ? c.out.split(/\s+/).map(Number) : [0, 0];
    r.ahead = ahead || 0;
    r.behind = behind || 0;
    if (r.behind) {
      const rl = await git(dir, ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%cI', '@{u}']);
      if (rl.ok && rl.out) {
        const [hash, subject, author, date] = rl.out.split('\x1f');
        r.remoteLast = { hash, subject, author, date };
      }
    }
  } else {
    r.ahead = 0;
    r.behind = 0;
  }
  // rama principal del remoto (main/master) si estás en otra rama
  const def = defR.ok ? defR.out : (await git(dir, ['rev-parse', '--verify', '--quiet', 'origin/main'])).ok ? 'origin/main' : (await git(dir, ['rev-parse', '--verify', '--quiet', 'origin/master'])).ok ? 'origin/master' : null;
  r.defaultBranch = def ? def.replace(/^origin\//, '') : null;
  if (def && r.upstream !== def && branch && !r.detached) {
    const c = await git(dir, ['rev-list', '--left-right', '--count', `HEAD...${def}`]);
    if (c.ok) {
      const [a, b] = c.out.split(/\s+/).map(Number);
      r.vsDefault = { ahead: a || 0, behind: b || 0 };
    }
  }
  r.state = verdict(r);
  return r;
}

/** Resumen en una palabra para pintar el chip. */
function verdict(r) {
  if (!r.git) return 'nogit';
  if (!r.remote) return 'noremote';
  if (r.fetchError) return 'error';
  if (r.behind && r.ahead) return 'diverged';
  if (r.behind) return r.changes.total ? 'behind-dirty' : 'behind';
  if (r.ahead) return 'ahead';
  if (!r.upstream && !r.detached) return 'nopush';
  if (r.changes.total) return 'dirty';
  return 'ok';
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

function list(root) {
  if (!fs.existsSync(root)) throw new Error(`No encuentro la carpeta ${root}.`);
  const dirs = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const d = path.join(root, e.name);
    if (fs.existsSync(path.join(d, '.git'))) {
      dirs.push(d);
      continue;
    }
    // carpeta contenedora (cliente/web): mira un nivel más
    let inner = [];
    try {
      inner = fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory() && !x.name.startsWith('.') && x.name !== 'node_modules' && fs.existsSync(path.join(d, x.name, '.git')));
    } catch {}
    if (inner.length) inner.forEach((x) => dirs.push(path.join(d, x.name)));
    else dirs.push(d);
  }
  return dirs;
}

/** Escanea todas las webs. onProgress(hechas, total, nombre). */
async function scan(root, { fetch = true, onProgress } = {}) {
  if (!(await gitAvailable())) throw new Error('No encuentro git en este PC. Instálalo desde git-scm.com y vuelve a intentarlo.');
  const dirs = list(root);
  let done = 0;
  const repos = await pool(dirs, 6, async (d) => {
    let r;
    try {
      r = await inspect(d, { fetch });
    } catch (e) {
      r = { name: path.basename(d), dir: d, git: true, state: 'error', fetchError: e.message };
    }
    onProgress && onProgress(++done, dirs.length, r.name);
    return r;
  });
  return { at: Date.now(), root, repos };
}

/** git pull --ff-only, solo si es seguro. */
async function pull(dir) {
  const r = await inspect(dir, { fetch: true });
  if (!r.git || !r.upstream) throw new Error('Esta carpeta no sigue ninguna rama de GitHub.');
  if (r.changes.total) throw new Error('Tienes cambios sin guardar en esta carpeta. Haz commit o guárdalos antes de actualizar.');
  if (r.ahead) throw new Error('Tienes commits sin subir: actualiza desde tu editor para resolverlo con calma.');
  if (!r.behind) return { ...r, pulled: 0 };
  const p = await git(dir, ['pull', '--ff-only', '--quiet'], 90000);
  if (!p.ok) throw new Error(`git pull no pudo terminar: ${p.err.split('\n').pop()}`);
  const after = await inspect(dir, { fetch: false });
  // si cambió package.json, avisa de instalar dependencias
  const pkgChanged = (await git(dir, ['diff', '--name-only', `${r.last?.hash || 'HEAD@{1}'}`, 'HEAD'])).out.split('\n').some((f) => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.json)$/.test(f));
  return { ...after, pulled: r.behind, pkgChanged };
}

module.exports = { DEFAULT_DIR, scan, inspect, pull, repoKey, gitAvailable };

// Fuentes de datos de Epic Games:
//  - Local, sin iniciar sesión:
//      · Data\Catalog\catcache.bin: caché del catálogo de la biblioteca que guarda
//        el launcher (JSON en base64, con keyImages). Se actualiza cada vez que
//        se abre el Epic Games Launcher.
//      · Data\Manifests\*.item: juegos instalados y su versión (AppVersionString).
//      · Data\Manifests\Pending\*.item: descargas/actualizaciones a medias.
//  - legendary (CLI de código abierto, opcional): `legendary list --json`
//    devuelve la biblioteca completa y la última versión publicada de cada juego,
//    con la sesión que el propio usuario abrió con `legendary auth`. Esta app
//    nunca ve ni guarda los tokens de Epic: los gestiona legendary.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const EPIC_DATA = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Imagen panorámica para la cabecera ("DieselGameBox" es la ancha, 16:9).
function pickHero(keyImages) {
  if (!Array.isArray(keyImages)) return null;
  const k = ['DieselGameBox', 'OfferImageWide', 'DieselStoreFrontWide'].map((t) => keyImages.find((x) => x.type === t && x.url)).find(Boolean);
  if (!k) return null;
  return /epicgames.com/.test(k.url) && !k.url.includes('?') ? `${k.url}?h=900&w=1600&resize=1&quality=high` : k.url;
}

function pickCover(keyImages) {
  if (!Array.isArray(keyImages)) return null;
  const order = ['DieselGameBoxTall', 'OfferImageTall', 'Thumbnail', 'DieselStoreFrontTall', 'DieselGameBox', 'OfferImageWide'];
  for (const t of order) {
    const k = keyImages.find((x) => x.type === t && x.url);
    if (k) return withResize(k.url);
  }
  return keyImages[0]?.url ? withResize(keyImages[0].url) : null;
}

// La CDN de Epic redimensiona al vuelo: pasa de ~500 KB a ~40 KB por carátula.
function withResize(url) {
  if (!/epicgames\.com/.test(url) || url.includes('?')) return url;
  return `${url}?h=450&w=338&resize=1&quality=medium`;
}

function isBaseGame(item) {
  const cats = (item.categories || []).map((c) => c.path);
  if (item.mainGameItem && item.mainGameItem.id) return false; // DLC / contenido extra
  if (cats.some((c) => c.startsWith('addons') || c === 'digitalextras')) return false;
  return cats.includes('games');
}

/** Biblioteca según la caché del launcher (no requiere iniciar sesión). */
function readCatalogCache() {
  const res = new Map();
  const file = path.join(EPIC_DATA, 'Catalog', 'catcache.bin');
  let items;
  try {
    items = JSON.parse(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').toString('utf8'));
  } catch {
    return { games: res, updatedAt: null };
  }
  for (const it of items) {
    if (!isBaseGame(it)) continue;
    const appName = it.releaseInfo?.[0]?.appId;
    if (!appName) continue;
    res.set(appName, {
      appName,
      title: it.title,
      namespace: it.namespace,
      catalogItemId: it.id,
      cover: pickCover(it.keyImages),
      hero: pickHero(it.keyImages),
    });
  }
  let updatedAt = null;
  try {
    updatedAt = fs.statSync(file).mtimeMs;
  } catch {}
  return { games: res, updatedAt };
}

/** Juegos instalados con el Epic Games Launcher. */
function readInstalled() {
  const res = new Map();
  const dir = path.join(EPIC_DATA, 'Manifests');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'));
  } catch {
    return res;
  }
  const pendingDir = path.join(dir, 'Pending');
  const pendingByApp = new Map();
  try {
    for (const f of fs.readdirSync(pendingDir).filter((x) => x.endsWith('.item'))) {
      const p = readJson(path.join(pendingDir, f));
      if (p?.AppName) pendingByApp.set(p.AppName, p);
    }
  } catch {}

  for (const f of files) {
    const m = readJson(path.join(dir, f));
    if (!m || !m.AppName || m.MainGameAppName) continue; // los DLC llevan MainGameAppName
    if (m.bIsApplication === false) continue;
    const pending = pendingByApp.get(m.AppName);
    res.set(m.AppName, {
      appName: m.AppName,
      title: m.DisplayName,
      namespace: m.CatalogNamespace,
      catalogItemId: m.CatalogItemId,
      version: m.AppVersionString,
      installLocation: m.InstallLocation,
      sizeBytes: Number(m.InstallSize || 0) || null,
      incomplete: !!m.bIsIncompleteInstall,
      pendingVersion: pending && pending.AppVersionString !== m.AppVersionString ? pending.AppVersionString : null,
      cover: m.VaultThumbnailUrl || null,
    });
  }
  return res;
}

// ---------- Última partida ----------
// Epic no la expone. Se deduce de dos fuentes locales:
//  · La Barra de juegos de Windows (HKCU\System\GameConfigStore\Children) guarda
//    LastAccessed de cada ejecutable de juego que detecta.
//  · El log del Epic Games Launcher registra "Launching app '<exe>'". Solo se lee
//    la ruta del ejecutable, nunca la línea de comandos (lleva tokens).
// Las dos dan rutas de ejecutables, que se asocian al juego por su carpeta.

function readGameBarLastAccess() {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\System\\GameConfigStore\\Children', '/s'],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const res = [];
        if (err) return resolve(res);
        for (const block of stdout.split(/\r?\n\r?\n/)) {
          const exe = block.match(/MatchedExeFullPath\s+REG_SZ\s+(.+)/);
          const last = block.match(/LastAccessed\s+REG_QWORD\s+0x([0-9a-f]+)/i);
          if (!exe || !last) continue;
          const unix = Number(BigInt('0x' + last[1]) / 10000000n - 11644473600n);
          if (unix > 0) res.push({ exe: exe[1].trim(), time: unix });
        }
        resolve(res);
      }
    );
  });
}

function readLauncherLaunches() {
  const res = [];
  const dir = path.join(process.env.LOCALAPPDATA || '', 'EpicGamesLauncher', 'Saved', 'Logs');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^EpicGamesLauncher.*\.log$/i.test(f));
  } catch {
    return res;
  }
  const re = /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):\d+\]\[[ \d]+\]FCommunityPortalLaunchAppTask: Launching app '([^']+)'/gm;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(re)) {
      const [, y, mo, d, h, mi, s, exe] = m;
      res.push({ exe, time: Math.floor(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) / 1000) });
    }
  }
  return res;
}

/** appName -> unix de la última partida (solo juegos instalados). */
async function readLastPlayed(installed) {
  const roots = [...installed.values()]
    .filter((g) => g.installLocation)
    .map((g) => ({ appName: g.appName, root: norm(g.installLocation) + '\\' }));
  const out = new Map();
  const entries = [...(await readGameBarLastAccess()), ...readLauncherLaunches()];
  for (const { exe, time } of entries) {
    const p = norm(exe);
    const hit = roots.find((r) => p.startsWith(r.root));
    if (hit && time > (out.get(hit.appName) || 0)) out.set(hit.appName, time);
  }
  return out;
}

function norm(p) {
  return String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

// ---------- legendary (opcional) ----------

function findLegendary(configured) {
  return new Promise((resolve) => {
    if (configured) return resolve(fs.existsSync(configured) ? configured : null);
    execFile('where', ['legendary'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.split(/\r?\n/).find(Boolean) || null);
    });
  });
}

function runLegendary(exe, args, timeout = 240000) {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim().split(/\r?\n/).slice(-3).join(' ')));
        resolve(stdout);
      }
    );
  });
}

async function legendaryStatus(exe) {
  try {
    const out = await runLegendary(exe, ['status', '--json', '--offline'], 30000);
    const j = JSON.parse(out);
    const acc = j.account || '';
    return { loggedIn: !!acc && !/not logged in/i.test(acc), account: acc };
  } catch (e) {
    return { loggedIn: false, error: e.message };
  }
}

/** Abre `legendary auth` en su propia ventana: el usuario inicia sesión él mismo. */
// Se lanza con `start` para que tenga una consola propia con entrada de teclado:
// si el navegador muestra el authorizationCode, el usuario lo pega ahí.
function legendaryAuth(exe) {
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '"Vincular Epic - legendary"', `"${exe}"`, 'auth'], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  child.unref();
}

/** Biblioteca completa y última versión publicada de cada juego, vía legendary. */
async function legendaryLibrary(exe) {
  const out = await runLegendary(exe, ['list', '--json']);
  const start = out.indexOf('[');
  const list = JSON.parse(start >= 0 ? out.slice(start) : out);
  const res = new Map();
  for (const g of list) {
    const meta = g.metadata || {};
    if (meta.mainGameItem && meta.mainGameItem.id) continue;
    if (meta.categories && !meta.categories.some((c) => c.path === 'games')) continue;
    const asset = g.asset_infos?.Windows || g.asset_infos?.Win32 || Object.values(g.asset_infos || {})[0];
    res.set(g.app_name, {
      appName: g.app_name,
      title: g.app_title || meta.title,
      namespace: meta.namespace || asset?.namespace,
      catalogItemId: meta.id || asset?.catalog_item_id,
      latestVersion: asset?.build_version || g.app_version || null,
      cover: pickCover(meta.keyImages),
      hero: pickHero(meta.keyImages),
    });
  }
  return res;
}

module.exports = {
  readCatalogCache,
  readInstalled,
  readLastPlayed,
  findLegendary,
  legendaryStatus,
  legendaryAuth,
  legendaryLibrary,
};

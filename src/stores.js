// Otras tiendas: Riot, Rockstar, GOG, EA y Ubisoft. Ninguna da a programas
// externos la lista de juegos comprados, así que se leen los juegos INSTALADOS
// a partir de lo que cada launcher guarda en Windows (registro y archivos).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LABEL = { riot: 'Riot', rockstar: 'Rockstar', gog: 'GOG', ea: 'EA', ubisoft: 'Ubisoft', local: 'Carpeta' };

/** `reg query <clave> /s` -> { 'subclave completa': { valor: dato } } */
function regTree(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({});
      const out = {};
      let cur = null;
      for (const line of stdout.split(/\r?\n/)) {
        if (/^HKEY_/i.test(line)) {
          cur = line.trim();
          out[cur] = {};
        } else if (cur) {
          const m = line.match(/^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/);
          if (m) out[cur][m[1].trim()] = m[3].trim();
        }
      }
      resolve(out);
    });
  });
}

const last = (k) => k.split('\\').pop();
const exists = (p) => {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
};

// ---------- Riot ----------
// C:\ProgramData\Riot Games\Metadata\<producto>.<rama>\<producto>.<rama>.product_settings.yaml
async function riot() {
  const base = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Riot Games');
  let client = null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(base, 'RiotClientInstalls.json'), 'utf8'));
    client = [j.rc_default, j.rc_live].find(exists) || null;
  } catch {}
  const NAMES = { league_of_legends: 'League of Legends', valorant: 'VALORANT', bacon: 'Legends of Runeterra', lion: '2XKO' };
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(path.join(base, 'Metadata'));
  } catch {}
  for (const d of dirs) {
    const m = d.match(/^(.+)\.([a-z]+)$/);
    if (!m || m[1] === 'riot_client') continue;
    const file = path.join(base, 'Metadata', d, `${d}.product_settings.yaml`);
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const install = (text.match(/product_install_full_path:\s*"?([^"\r\n]+)"?/) || [])[1];
    if (!exists(install)) continue;
    out.push({
      store: 'riot',
      key: `${m[1]}.${m[2]}`,
      title: NAMES[m[1]] || m[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      installPath: install,
      launch: client ? { exe: client, args: [`--launch-product=${m[1]}`, `--launch-patchline=${m[2]}`] } : null,
    });
  }
  return out;
}

// ---------- Rockstar ----------
// HKLM\SOFTWARE\WOW6432Node\Rockstar Games\<juego> con InstallFolder (los
// comprados en Steam o Epic usan InstallFolderSteam/InstallFolderEpic y ya salen allí)
async function rockstar() {
  const tree = await regTree('HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games');
  const launcher = tree['HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Launcher']?.InstallFolder;
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const name = last(k);
    if (/^(Launcher|Rockstar Games Social Club|Social Club|Rockstar Games)$/i.test(name) || !exists(v.InstallFolder)) continue;
    out.push({
      store: 'rockstar',
      key: name,
      title: name,
      installPath: v.InstallFolder,
      launch: launcher ? { exe: path.join(launcher, 'Launcher.exe'), args: ['-launchTitleInFolder', v.InstallFolder] } : null,
    });
  }
  return out;
}

// ---------- GOG ----------
async function gog() {
  const tree = await regTree('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games');
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    if (!v.gameName || !exists(v.path)) continue;
    const exe = v.exe && exists(v.exe) ? v.exe : null;
    out.push({
      store: 'gog',
      key: v.gameID || last(k),
      title: v.gameName,
      installPath: v.path,
      // Los juegos de GOG no llevan DRM: se abren directamente
      launch: exe ? { exe, args: [], cwd: v.workingDir || v.path } : null,
    });
  }
  return out;
}

// ---------- Ubisoft Connect ----------
async function ubisoft() {
  const tree = await regTree('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs');
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const dir = (v.InstallDir || '').replace(/\//g, '\\');
    if (!exists(dir)) continue;
    const id = last(k);
    out.push({ store: 'ubisoft', key: id, title: path.basename(dir.replace(/\\+$/, '')), installPath: dir, launchUrl: `uplay://launch/${id}/0` });
  }
  return out;
}

// ---------- EA app ----------
async function ea() {
  const tree = await regTree('HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts');
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const dir = v['Install Dir'] || v.InstallDir;
    if (!exists(dir) || /EA Desktop|EA app|Origin$/i.test(last(k))) continue;
    // El identificador para abrirlo con la EA app está en __Installer\installerdata.xml
    let contentId = null;
    try {
      const xml = fs.readFileSync(path.join(dir, '__Installer', 'installerdata.xml'), 'utf8');
      contentId = (xml.match(/<contentID>([^<]+)<\/contentID>/i) || [])[1] || null;
    } catch {}
    out.push({
      store: 'ea',
      key: last(k),
      title: v.DisplayName || last(k),
      installPath: dir,
      launchUrl: contentId ? `link2ea://launchgame/${encodeURIComponent(contentId)}` : null,
    });
  }
  return out;
}

// ---------- Carpetas de juegos (1.35.1) ----------
// Juegos sin tienda (ports, emuladores, copias sueltas): cada subcarpeta de una carpeta
// de juegos es un juego, y se abre con el .exe que mejor parezca su lanzador.
const SKIP_DIR = /^(_internal|__installer|redist|redistributables?|directx|vcredist|support|commonredist|engine|binaries|tools|licenses|patches|shaders?|fsr\d?_shaders|mods|scripts|saves?|user|out|logs?|node_modules|sce_\w+|dvdroot\w*|cusa\d+)$/i;
const SKIP_EXE = /unins|setup|install|redist|vc_?redist|dxsetup|crash|report|helper|updater|uninstall|python|pythonw|7z|unitycrash|launcherhelper/i;
function exesIn(dir, depth, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isFile() && /\.exe$/i.test(e.name) && !SKIP_EXE.test(e.name)) out.push({ p, depth });
    else if (e.isDirectory() && depth < 3 && !SKIP_DIR.test(e.name)) exesIn(p, depth + 1, out);
  }
  return out;
}
const squash = (s) => s.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');
/** El .exe para abrir el juego: «Play …» o «Launch …» primero, luego el que se llama como la carpeta. */
function pickExe(dir, title) {
  const list = exesIn(dir, 1);
  const t = squash(title);
  const score = ({ p, depth }) => {
    const b = path.basename(p);
    let s = -depth;
    if (/^(play|launch|start)\b/i.test(b)) s += 20;
    if (squash(b).includes(t) || t.includes(squash(b))) s += 10;
    if (/launcher/i.test(b)) s -= 2;
    return s;
  };
  return list.sort((a, b) => score(b) - score(a))[0]?.p || null;
}
function folders(dirs) {
  const out = [];
  for (const root of dirs || []) {
    let ents = [];
    try {
      ents = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const exe = pickExe(dir, e.name);
      if (!exe) continue;
      out.push({ store: 'local', key: dir.toLowerCase(), title: e.name, installPath: dir, launch: { exe, args: [], cwd: path.dirname(exe) } });
    }
  }
  return out;
}

/** Todos los juegos instalados de las otras tiendas y de las carpetas de juegos. */
async function installed({ gameFolders } = {}) {
  const parts = await Promise.all([riot(), rockstar(), gog(), ubisoft(), ea(), Promise.resolve().then(() => folders(gameFolders))].map((p) => p.catch(() => [])));
  return parts.flat();
}

module.exports = { installed, folders, pickExe, LABEL, regTree };

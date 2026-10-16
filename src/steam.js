// Fuentes de datos de Steam:
//  - Local: libraryfolders.vdf + appmanifest_*.acf (instalados y StateFlags),
//    loginusers.vdf (SteamID64 de la cuenta usada) y localconfig.vdf (LastPlayed).
//  - Web API con la clave del usuario: IPlayerService/GetOwnedGames.
//  - Tienda (sin clave): IStoreBrowseService/GetItems (carátulas y precios),
//    IWishlistService/GetWishlist (lista de deseados).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseVdf } = require('./vdf');

const API = 'https://api.steampowered.com';
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
// Región de la tienda: decide la moneda de los precios (CL = pesos chilenos,
// CR = colones costarricenses). Steam ya los da en esa moneda, sin convertir.
const REGIONS = { CL: 'CLP', CR: 'CRC' };
let COUNTRY = 'CL';
const LANGUAGE = 'latam'; // español de Latinoamérica

function setRegion(country) {
  COUNTRY = REGIONS[country] ? country : 'CL';
}

// Bits de EAppState (StateFlags en los .acf)
const STATE = {
  UpdateRequired: 2,
  FullyInstalled: 4,
  UpdateRunning: 256,
  UpdatePaused: 512,
  UpdateStarted: 1024,
  Downloading: 1048576,
};

// Apps que Steam instala pero que no son juegos
const IGNORED_APPIDS = new Set([228980]); // Steamworks Common Redistributables

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = stdout.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function findSteamPath() {
  const fromReg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  const candidates = [
    fromReg && fromReg.replace(/\//g, '\\'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(path.join(p, 'steamapps'))) || null;
}

function readVdfFile(file) {
  try {
    return parseVdf(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function libraryFolders(steamPath) {
  const folders = new Set([steamPath]);
  const vdf = readVdfFile(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'));
  const lf = vdf && (vdf.libraryfolders || vdf.LibraryFolders);
  if (lf) {
    for (const v of Object.values(lf)) {
      if (v && typeof v === 'object' && v.path) folders.add(v.path);
      else if (typeof v === 'string' && /^[a-z]:\\/i.test(v)) folders.add(v); // formato antiguo
    }
  }
  return [...folders].filter((p) => fs.existsSync(path.join(p, 'steamapps')));
}

function describeState(flags, st) {
  const updating = (flags & (STATE.UpdateRunning | STATE.Downloading)) !== 0;
  const pending =
    (flags & (STATE.UpdateRequired | STATE.UpdatePaused | STATE.UpdateStarted)) !== 0 ||
    (st.TargetBuildID && st.TargetBuildID !== '0' && st.buildid && st.TargetBuildID !== st.buildid);
  if (updating) return { updatePending: true, updateText: 'Actualizándose ahora' };
  if (pending) return { updatePending: true, updateText: 'Actualización pendiente' };
  return { updatePending: false, updateText: null };
}

/** Juegos instalados en todas las carpetas de biblioteca. */
function readInstalled(steamPath) {
  const out = new Map();
  for (const lib of libraryFolders(steamPath)) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const vdf = readVdfFile(path.join(dir, f));
      const st = vdf && (vdf.AppState || vdf.appstate);
      if (!st || !st.appid) continue;
      const appid = Number(st.appid);
      if (IGNORED_APPIDS.has(appid)) continue;
      const flags = Number(st.StateFlags || 0);
      out.set(appid, {
        appid,
        name: st.name,
        library: lib,
        installPath: st.installdir ? path.join(lib, 'steamapps', 'common', st.installdir) : null,
        flags,
        sizeOnDisk: Number(st.SizeOnDisk || 0),
        ...describeState(flags, st),
      });
    }
  }
  return out;
}

/** SteamID64 de la cuenta con la que se inició sesión por última vez en el cliente. */
function detectSteamId(steamPath) {
  const vdf = readVdfFile(path.join(steamPath, 'config', 'loginusers.vdf'));
  const users = vdf && vdf.users;
  if (!users) return null;
  const ids = Object.keys(users);
  return ids.find((id) => users[id].MostRecent === '1') || ids[0] || null;
}

/** LastPlayed local (sirve aunque no haya clave de la API). */
function readLocalLastPlayed(steamPath, steamId) {
  const res = new Map();
  if (!steamId) return res;
  const accountId = (BigInt(steamId) & 0xffffffffn).toString();
  const vdf = readVdfFile(path.join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf'));
  const apps =
    vdf?.UserLocalConfigStore?.Software?.Valve?.Steam?.apps ||
    vdf?.UserLocalConfigStore?.Software?.valve?.Steam?.apps;
  if (!apps) return res;
  for (const [id, a] of Object.entries(apps)) {
    const t = Number(a?.LastPlayed || 0);
    if (t > 0) res.set(Number(id), t);
  }
  return res;
}

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} en ${url.split('?')[0]}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Juegos en propiedad (Web API, necesita la clave del usuario). */
async function getOwnedGames(apiKey, steamId) {
  const u = new URL(`${API}/IPlayerService/GetOwnedGames/v1/`);
  u.searchParams.set('key', apiKey);
  u.searchParams.set('steamid', steamId);
  u.searchParams.set('include_appinfo', '1');
  u.searchParams.set('include_played_free_games', '1');
  u.searchParams.set('format', 'json');
  let j;
  try {
    j = await getJson(u.toString());
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('Steam rechazó la clave de la API (401/403). Revisa la clave en Ajustes.');
    throw e;
  }
  const games = j?.response?.games;
  if (!games) {
    throw new Error(
      'Steam no devolvió juegos. Comprueba el SteamID64 y que "Detalles de juegos" de tu perfil no esté en Privado.'
    );
  }
  return games;
}

/** Datos de la tienda (carátulas, tipo, etiquetas, franquicia, precio) para una lista de appids. */
async function getStoreItems(appids, { assets = true, prices = false, meta = true } = {}) {
  const res = new Map();
  const ids = [...new Set(appids)];
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const req = {
      ids: ids.slice(i, i + BATCH).map((appid) => ({ appid })),
      context: { language: LANGUAGE, country_code: COUNTRY },
      data_request: { include_assets: assets, include_basic_info: meta, include_release: meta, include_tag_count: meta ? 12 : 0 },
    };
    const url = `${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(req))}`;
    try {
      const j = await getJson(url);
      for (const it of j?.response?.store_items || []) {
        if (!it.appid) continue;
        res.set(it.appid, {
          name: it.name,
          type: it.type,
          cover: assetUrl(it.assets, 'library_capsule'),
          hero: assetUrl(it.assets, 'library_hero'),
          header: assetUrl(it.assets, 'header'),
          price: prices ? priceInfo(it) : undefined,
          franchise: it.basic_info?.franchises?.[0]?.name || null,
          tagIds: (it.tags || []).map((t) => t.tagid),
          released: Number(it.release?.steam_release_date || it.release?.original_release_date || 0) || null,
        });
      }
    } catch (e) {
      console.warn('GetItems falló:', e.message);
    }
  }
  return res;
}

function assetUrl(assets, key) {
  if (!assets || !assets.asset_url_format || !assets[key]) return null;
  return ASSET_BASE + assets.asset_url_format.replace('${FILENAME}', assets[key]);
}

function priceInfo(it) {
  if (it.is_free) return { free: true };
  const b = it.best_purchase_option;
  if (!b) return null;
  const end = (b.active_discounts || [])
    .map((d) => Number(d.discount_end_date || 0))
    .filter(Boolean)
    .sort((a, c) => a - c)[0];
  return {
    final: b.formatted_final_price,
    original: b.formatted_original_price || null,
    discountPct: Number(b.discount_pct || 0),
    endsAt: end || null,
  };
}

/** Portadas por defecto de la CDN cuando la tienda no devuelve assets (juegos retirados). */
function fallbackCovers(appid) {
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
  ];
}

/** Lista de deseados + precios actuales. */
async function getWishlistDeals(apiKey, steamId) {
  const u = new URL(`${API}/IWishlistService/GetWishlist/v1/`);
  u.searchParams.set('steamid', steamId);
  if (apiKey) u.searchParams.set('key', apiKey);
  const j = await getJson(u.toString());
  const items = j?.response?.items || [];
  if (!items.length) return { total: 0, items: [] };
  const store = await getStoreItems(
    items.map((i) => i.appid),
    { assets: true, prices: true, meta: false }
  );
  const list = items.map((i) => {
    const s = store.get(i.appid) || {};
    return {
      appid: i.appid,
      name: s.name || `App ${i.appid}`,
      cover: s.header || s.cover || fallbackCovers(i.appid)[1],
      price: s.price || null,
      dateAdded: i.date_added || null,
    };
  });
  return { total: items.length, items: list };
}

/** GetItems tal cual (para pedir otros datos, como la fecha de lanzamiento). */
async function getStoreItemsRaw(appids, dataRequest) {
  const out = [];
  const ids = [...new Set(appids)];
  for (let i = 0; i < ids.length; i += 100) {
    const req = {
      ids: ids.slice(i, i + 100).map((appid) => ({ appid })),
      context: { language: LANGUAGE, country_code: COUNTRY },
      data_request: dataRequest,
    };
    try {
      const j = await getJson(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(req))}`);
      out.push(...(j?.response?.store_items || []).filter((it) => it.appid));
    } catch {}
  }
  return out;
}

/** Nombres de las etiquetas de la tienda en español (id -> nombre). */
async function getTagNames() {
  const j = await getJson(`${API}/IStoreService/GetTagList/v1/?language=${LANGUAGE}`);
  return Object.fromEntries((j?.response?.tags || []).map((t) => [t.tagid, t.name]));
}

/** Busca un juego en la tienda de Steam por nombre (para dar etiquetas a los de Epic). */
async function searchStore(term) {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=${COUNTRY}&l=${LANGUAGE}`);
  if (r.status === 429) {
    const err = new Error('Steam limita las búsquedas (429)');
    err.status = 429;
    throw err;
  }
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).filter((i) => i.type === 'app').map((i) => ({ appid: i.id, name: i.name }));
}

module.exports = {
  libraryFolders,
  setRegion,
  getStoreItemsRaw,
  LANGUAGE,
  getTagNames,
  searchStore,
  findSteamPath,
  readInstalled,
  detectSteamId,
  readLocalLastPlayed,
  getOwnedGames,
  getStoreItems,
  getWishlistDeals,
  fallbackCovers,
};

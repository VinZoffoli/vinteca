// Datos extra de la tienda de Steam (todos públicos, sin clave):
//  - Tráileres de un juego (IStoreBrowseService/GetItems, include_trailers).
//  - DLC rebajados de tus juegos (appdetails -> lista de DLC, GetItems -> precios).
//  - "¿Lo mueve mi PC?": requisitos de appdetails comparados con tu equipo.
//    La comparación de procesador y gráfica es aproximada (tabla de rendimiento relativo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const steam = require('./steam');

const DAY = 86400000;
const VIDEO = 'https://video.akamai.steamstatic.com/store_trailers/';
const ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/';

// ---------- appdetails (con caché) ----------
async function appDetails(appids, { read, write }) {
  const cache = read('appdetails.json', {});
  const now = Date.now();
  const todo = appids.filter((id) => !cache[id] || now - cache[id].at > 7 * DAY);
  let i = 0;
  let limited = false;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (i < todo.length && !limited) {
        const id = todo[i++];
        try {
          const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic&l=english`);
          if (r.status === 429) {
            limited = true;
            break;
          }
          const d = (await r.json())?.[id]?.data;
          cache[id] = {
            at: now,
            dlc: d?.dlc || [],
            min: d?.pc_requirements?.minimum || '',
            rec: d?.pc_requirements?.recommended || '',
          };
        } catch {}
      }
    })
  );
  write('appdetails.json', cache);
  return cache;
}

// ---------- tráileres ----------
async function trailers(appid) {
  const [it] = await steam.getStoreItemsRaw([appid], { include_trailers: true });
  const t = it?.trailers;
  const list = [...(t?.highlights || []), ...(t?.other_trailers || [])];
  return list.slice(0, 6).map((x) => {
    const base = (x.adaptive_trailers || []).find((a) => a.encoding === 'dash_h264')?.cdn_path;
    const micro = (x.microtrailer || []).find((m) => m.type === 'video/mp4')?.filename;
    const fmt = x.trailer_url_format || 'steam/apps/${FILENAME}';
    return {
      name: x.trailer_name || 'Tráiler',
      dash: base ? VIDEO + base : null,
      micro: micro ? VIDEO + micro : null,
      poster: x.screenshot_full ? ASSETS + fmt.replace('${FILENAME}', x.screenshot_full) : null,
    };
  }).filter((x) => x.dash || x.micro);
}

// ---------- DLC rebajados ----------
function ownedDlcs(steamPath) {
  const out = new Set();
  if (!steamPath) return out;
  for (const lib of steam.libraryFolders(steamPath)) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {}
    for (const f of files) {
      try {
        for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/"dlcappid"\s+"(\d+)"/g)) out.add(Number(m[1]));
      } catch {}
    }
  }
  return out;
}

async function dlcDeals({ games, user, steamPath, read, write, force }) {
  const cached = read('dlc-deals.json', null);
  if (!force && cached && Date.now() - cached.at < 6 * 3600000) return cached.items;
  // Juegos de Steam que juegas o tienes instalados (los 50 más jugados)
  const base = games
    .filter((g) => g.store === 'steam' && g.kind !== 'tool' && (g.installed || g.playtimeMin > 60 || user[g.id]?.fav))
    .sort((a, b) => (b.playtimeMin || 0) - (a.playtimeMin || 0))
    .slice(0, 50);
  const ids = base.map((g) => Number(g.id.split(':')[1]));
  const det = await appDetails(ids, { read, write });
  const parentOf = new Map();
  for (const g of base) for (const d of det[g.id.split(':')[1]]?.dlc || []) parentOf.set(d, g);
  const owned = ownedDlcs(steamPath);
  const dlcIds = [...parentOf.keys()].filter((d) => !owned.has(d));
  const items = await steam.getStoreItemsRaw(dlcIds, { include_assets: true, include_basic_info: false });
  const out = items
    .filter((it) => it.visible !== false && it.best_purchase_option?.discount_pct > 0)
    .map((it) => {
      const b = it.best_purchase_option;
      const end = (b.active_discounts || []).map((d) => Number(d.discount_end_date || 0)).filter(Boolean).sort()[0] || null;
      const g = parentOf.get(it.appid);
      return {
        appid: it.appid,
        name: it.name,
        parentId: g.id,
        parent: g.title,
        pct: b.discount_pct,
        final: b.formatted_final_price,
        original: b.formatted_original_price || null,
        endsAt: end,
        header: it.assets?.asset_url_format && it.assets.header ? ASSETS + it.assets.asset_url_format.replace('${FILENAME}', it.assets.header) : `${ASSETS}steam/apps/${it.appid}/header.jpg`,
      };
    })
    .sort((a, b) => b.pct - a.pct);
  write('dlc-deals.json', { at: Date.now(), items: out });
  return out;
}

// ---------- ¿Lo mueve mi PC? ----------
function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 15000, maxBuffer: 4 << 20 }, (e, out) => resolve(e ? '' : String(out))));
}

async function hardware({ read, write }) {
  const c = read('hw.json', null);
  if (c && Date.now() - c.at < 7 * DAY) return c.hw;
  const ps = await run('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Select -First 1 -Expand Name); "---"; Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }']);
  const [cpuPart, gpuPart = ''] = ps.split('---');
  const gpus = gpuPart.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // La gráfica "de verdad" es la que mejor puntúa (descarta pantallas virtuales y USB)
  const gpu = gpus.map((n) => ({ n, s: gpuScore(n) })).sort((a, b) => (b.s || 0) - (a.s || 0))[0]?.n || gpus[0] || '';
  // VRAM: el registro guarda el tamaño real (Win32 lo corta a 4 GB)
  const reg = await run('reg', ['query', 'HKLM\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s', '/v', 'HardwareInformation.qwMemorySize']);
  const vram = Math.max(0, ...[...reg.matchAll(/REG_QWORD\s+0x([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16)));
  const hw = { cpu: cpuPart.trim(), gpu, vramGB: vram ? Math.round(vram / 2 ** 30) : null, ramGB: Math.round(os.totalmem() / 2 ** 30) };
  write('hw.json', { at: Date.now(), hw });
  return hw;
}

// Rendimiento relativo aproximado de gráficas (más = mejor)
const NV = { 450: 0.9, 460: 1.4, 470: 1.8, 480: 2.1, 550: 1.2, 560: 1.5, 570: 2.3, 580: 2.6, 650: 1.6, 660: 2.5, 670: 3.3, 680: 3.8, 750: 2.6, 760: 3.2, 770: 4.1, 780: 4.8, 950: 3.5, 960: 4, 970: 5.5, 980: 6.5, 1030: 1.5, 1050: 3.6, 1060: 6.3, 1070: 8.3, 1080: 10.3, 1630: 2.5, 1650: 5, 1660: 7, 2060: 9.3, 2070: 11, 2080: 13, 3050: 8.4, 3060: 10.7, 3070: 15, 3080: 19, 3090: 21, 4050: 11, 4060: 12.5, 4070: 18, 4080: 24, 4090: 30, 5050: 12, 5060: 15, 5070: 21, 5080: 27, 5090: 36 };
const RX = { 460: 3, 470: 5.5, 480: 6.2, 550: 2.2, 560: 3, 570: 5.8, 580: 6.4, 590: 7, 5500: 6.3, 5600: 9.2, 5700: 11, 6400: 4.2, 6500: 5, 6600: 11, 6650: 12.5, 6700: 14.5, 6750: 15.5, 6800: 19, 6900: 22, 6950: 23, 7600: 13, 7700: 18, 7800: 21, 7900: 27, 9060: 17, 9070: 25 };
const OLD_AMD = { 'hd 5770': 1, 'hd 5850': 1.4, 'hd 5870': 1.7, 'hd 6850': 1.6, 'hd 6870': 1.9, 'hd 6950': 2.2, 'hd 6970': 2.5, 'hd 7750': 1.4, 'hd 7770': 1.8, 'hd 7790': 2.2, 'hd 7850': 2.6, 'hd 7870': 3.1, 'hd 7950': 3.8, 'hd 7970': 4.5, 'r7 260': 2.2, 'r7 370': 2.8, 'r9 270': 3, 'r9 280': 4.2, 'r9 285': 4, 'r9 290': 5.5, 'r9 380': 4.3, 'r9 390': 6, 'r9 fury': 7.5, 'vega 56': 8.5, 'vega 64': 9.5, 'radeon vii': 11 };
const ARC = { a310: 2.5, a380: 3.5, a580: 8, a750: 9.5, a770: 10.5, b570: 11, b580: 12.5 };

function gpuScore(name) {
  const s = String(name || '').toLowerCase().replace(/[™®]/g, '').replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/(?:gtx|rtx|gts|gt)\s?(\d{3,4})\s?(ti|super)?/))) {
    const v = NV[m[1]];
    if (v) return v * (m[2] === 'ti' ? 1.15 : m[2] === 'super' ? 1.1 : 1);
  }
  if ((m = s.match(/rx\s?(\d{3,4})\s?(xtx|xt|gre)?/))) {
    const v = RX[m[1]];
    if (v) return v * (m[2] ? 1.12 : 1);
  }
  for (const [k, v] of Object.entries(OLD_AMD)) if (s.includes(k)) return v;
  if ((m = s.match(/arc\s?([ab]\d{3})/))) return ARC[m[1]] || null;
  if (/intel.*(hd|uhd|iris)|(hd|uhd) graphics/.test(s)) return 0.8;
  return null;
}

function cpuScore(name) {
  const s = String(name || '').toLowerCase();
  let m;
  if ((m = s.match(/ryzen\s?([3579])\s?(?:pro\s)?(\d)\d{3}/))) {
    const tier = { 3: 0.85, 5: 1.1, 7: 1.4, 9: 1.75 }[m[1]];
    return (1.7 + (Number(m[2]) - 1) * 0.35) * tier;
  }
  if ((m = s.match(/i([3579])[- ](\d{4,5})/))) {
    const n = m[2];
    const gen = n.length === 5 ? Number(n.slice(0, 2)) : Number(n[0]);
    return (1 + (gen - 2) * 0.18) * { 3: 1, 5: 1.45, 7: 1.8, 9: 2.2 }[m[1]];
  }
  if ((m = s.match(/core\s?ultra\s?([579])/))) return 4.2 * { 5: 1, 7: 1.2, 9: 1.35 }[m[1]];
  if ((m = s.match(/i([357])[- ](\d{3})\b/))) return 0.8 * { 3: 1, 5: 1.3, 7: 1.6 }[m[1]];
  if (/fx[- ]?(\d)/.test(s)) return /fx[- ]?[89]/.test(s) ? 1.3 : 1.0;
  if (/core\s?2|pentium|celeron|athlon|phenom|a\d+-\d{4}/.test(s)) return 0.6;
  return null;
}

// Separa las alternativas ("GTX 1060 / RX 580") y se queda con la más exigente que se reconozca
function needed(text, scoreFn) {
  const parts = String(text || '').split(/\s*(?:\/|,|\bor\b|\||;)\s*/i);
  const scores = parts.map(scoreFn).filter((x) => x != null);
  return scores.length ? Math.min(...scores) : null;
}

function parseReq(html) {
  const txt = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  const get = (label) => txt.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'))?.[1]?.trim() || '';
  const mem = get('Memory');
  const gb = mem.match(/(\d+(?:\.\d+)?)\s*GB/i) ? Number(RegExp.$1) : mem.match(/(\d+)\s*MB/i) ? Number(RegExp.$1) / 1024 : null;
  const gfx = get('Graphics');
  const vram = gfx.match(/(\d+)\s*GB/i) ? Number(RegExp.$1) : null;
  return { cpu: get('Processor'), gpu: gfx, ramGB: gb, vramGB: vram };
}

function judge(req, hw) {
  const checks = [];
  const cpuNeed = needed(req.cpu, cpuScore);
  const cpuHave = cpuScore(hw.cpu);
  if (req.cpu) checks.push({ part: 'Procesador', need: req.cpu, ok: cpuNeed != null && cpuHave != null ? cpuHave >= cpuNeed * 0.95 : null, margin: cpuNeed && cpuHave ? cpuHave / cpuNeed : null });
  const gpuNeed = needed(req.gpu, gpuScore);
  const gpuHave = gpuScore(hw.gpu);
  if (req.gpu) checks.push({ part: 'Gráfica', need: req.gpu, ok: gpuNeed != null && gpuHave != null ? gpuHave >= gpuNeed * 0.95 : null, margin: gpuNeed && gpuHave ? gpuHave / gpuNeed : null });
  if (req.ramGB) checks.push({ part: 'Memoria', need: `${req.ramGB} GB`, ok: hw.ramGB + 0.5 >= req.ramGB, margin: hw.ramGB / req.ramGB });
  if (req.vramGB && hw.vramGB) checks.push({ part: 'Memoria de vídeo', need: `${req.vramGB} GB`, ok: hw.vramGB >= req.vramGB });
  const known = checks.filter((c) => c.ok != null);
  return { checks, ok: known.length ? known.every((c) => c.ok) : null, known: known.length };
}

/** Veredicto para varios juegos: 'rec' (recomendados), 'min' (mínimos), 'no', o null (no se sabe). */
async function canRun(appids, { read, write }) {
  const hw = await hardware({ read, write });
  const det = await appDetails(appids, { read, write });
  const out = {};
  for (const id of appids) {
    const d = det[id];
    if (!d || (!d.min && !d.rec)) {
      out[id] = { verdict: null };
      continue;
    }
    const min = judge(parseReq(d.min), hw);
    const rec = d.rec ? judge(parseReq(d.rec), hw) : null;
    let verdict = null;
    // Sin recomendados que se puedan comparar: si superas los mínimos con holgura, lo mueve bien
    const roomy = min.ok && min.checks.filter((c) => c.margin != null).every((c) => c.margin >= 1.5);
    if (rec?.ok || (rec?.ok == null && roomy)) verdict = 'rec';
    else if (min.ok) verdict = 'min';
    else if (min.ok === false) verdict = 'no';
    out[id] = { verdict, min: min.checks, rec: rec?.checks || null };
  }
  return { hw, games: out };
}

module.exports = { trailers, dlcDeals, canRun, hardware, gpuScore, cpuScore, parseReq };

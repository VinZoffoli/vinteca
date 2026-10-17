// Casa → Alquileres: publicaciones de Facebook Marketplace (alquiler de
// propiedades) en Guápiles, entre el precio mínimo y el máximo.
// Marketplace solo se ve con sesión: la primera vez se abre Facebook en una
// ventana de la app y entras tú. Después la app lee esa búsqueda solo cuando
// pulsas "Buscar", como si la miraras tú. No publica, no escribe a nadie.
const { BrowserWindow, session, shell } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PART = 'persist:vt-facebook';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT = { city: null, place: 'Guápiles', min: 130000, max: 250000, onlyPlace: true };

function prefs(read) {
  return { ...DEFAULT, ...(read('alquileres.json', {}).prefs || {}) };
}
// Marketplace identifica las ciudades con un número (/marketplace/<id>/…). Sin él
// usa la ubicación de tu cuenta: por eso, cuando eliges Guápiles en la ventana
// de Facebook, la app guarda ese número sola.
function searchUrl(p) {
  const q = new URLSearchParams({ minPrice: String(p.min), maxPrice: String(p.max), exact: 'false' });
  return p.city ? `https://www.facebook.com/marketplace/${encodeURIComponent(p.city)}/propertyrentals?${q}` : `https://www.facebook.com/marketplace/category/propertyrentals?${q}`;
}
let onCity = null;
function rememberCity(url, read, write) {
  const m = String(url).match(/facebook\.com\/marketplace\/(\d{6,})\/(propertyrentals|search|category)?/);
  if (!m) return;
  const s = read('alquileres.json', {});
  s.prefs = { ...prefs(read), city: m[1] };
  write('alquileres.json', s);
  onCity?.(m[1]);
}

function ses() {
  const s = session.fromPartition(PART);
  s.setUserAgent(UA);
  s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  return s;
}

const NAV_OK = /^https:\/\/(www\.|web\.|m\.)?facebook\.com\//;
let win = null;
/** Ventana visible de Facebook (para iniciar sesión o elegir la ubicación). */
function openWindow(url, ctx) {
  if (ctx) onCity = ctx.onCity;
  if (win && !win.isDestroyed()) {
    win.loadURL(url);
    win.show();
    win.focus();
    return true;
  }
  win = new BrowserWindow({ width: 1200, height: 900, title: 'Facebook · ViperTeca', autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { session: ses(), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (NAV_OK.test(u)) win.loadURL(u);
    else if (/^https:\/\//.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => {
    if (!NAV_OK.test(u)) {
      e.preventDefault();
      if (/^https:\/\//.test(u)) shell.openExternal(u);
    }
  });
  if (ctx) {
    win.webContents.on('did-navigate', (_e, u) => rememberCity(u, ctx.read, ctx.write));
    win.webContents.on('did-navigate-in-page', (_e, u) => rememberCity(u, ctx.read, ctx.write));
  }
  win.on('closed', () => (win = null));
  win.loadURL(url);
  return true;
}

// Se ejecuta dentro de Marketplace: lee las tarjetas que se ven en la página
const READ = `(async () => {
  if (/\\/login|checkpoint/.test(location.pathname) || document.querySelector('input[name="email"][type="text"], input[name="email"][type="email"], #login_form')) return { login: true };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 6; i++) { window.scrollBy(0, window.innerHeight * 1.5); await sleep(900); }
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
    const id = (a.href.match(/\\/marketplace\\/item\\/(\\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const lines = a.innerText.split('\\n').map((s) => s.trim()).filter(Boolean);
    const img = a.querySelector('img');
    out.push({ id, lines: lines.slice(0, 8), image: img ? img.src : null, alt: img ? img.alt : '' });
  }
  return { items: out, url: location.href };
})()`;

const money = (s) => {
  const m = String(s).replace(/\s/g, '').match(/[₡$]?([\d.,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function shape(it) {
  const L = it.lines;
  // Marketplace suele mostrar: precio (a veces precio anterior tachado), título, lugar, y a veces "2 hab · 1 baño"
  const priceLine = L.find((l) => /₡|\$|CRC|gratis|free/i.test(l)) || L[0] || '';
  const rest = L.filter((l) => l !== priceLine && !/₡|CRC/.test(l));
  const title = rest[0] || it.alt || 'Sin título';
  const where = rest.find((l, i) => i > 0 && /,|lim[oó]n|gu[aá]piles|pococ[ií]|cariari|jim[eé]nez|rita|roxana/i.test(l)) || rest[1] || '';
  const extra = rest.filter((l) => l !== title && l !== where).join(' · ');
  return { id: it.id, price: priceLine, priceNum: money(priceLine), title, where, extra, image: it.image, url: `https://www.facebook.com/marketplace/item/${it.id}/` };
}

async function search({ read, write }) {
  const p = prefs(read);
  const w = new BrowserWindow({ show: false, width: 1300, height: 1100, webPreferences: { session: ses(), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await w.loadURL(searchUrl(p)).catch(() => {});
    await wait(4000);
    let r = await w.webContents.executeJavaScript(READ).catch(() => ({ items: [] }));
    if (!r.login && !r.items?.length) {
      await wait(4000);
      r = await w.webContents.executeJavaScript(READ).catch(() => ({ items: [] }));
    }
    if (r.login) return { login: true };
    const s = read('alquileres.json', {});
    const seen = s.seen || {};
    let list = (r.items || []).map(shape);
    if (p.onlyPlace && p.place) {
      const plain = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const want = plain(p.place);
      const near = list.filter((x) => plain(`${x.where} ${x.title}`).includes(want));
      if (near.length) list = near;
    }
    list = list.filter((x) => x.priceNum == null || (x.priceNum >= p.min * 0.9 && x.priceNum <= p.max * 1.1)).map((x) => ({ ...x, isNew: !seen[x.id] }));
    for (const x of list) seen[x.id] ||= Date.now();
    s.seen = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 2000));
    s.last = { at: Date.now(), list, url: searchUrl(p) };
    write('alquileres.json', s);
    return s.last;
  } finally {
    w.destroy();
  }
}

function savePrefs({ read, write }, p) {
  const s = read('alquileres.json', {});
  const min = Math.max(0, Math.round(Number(p.min) || DEFAULT.min));
  const max = Math.max(min, Math.round(Number(p.max) || DEFAULT.max));
  const place = String(p.place || DEFAULT.place).trim().slice(0, 60);
  const old = prefs(read);
  // si cambias de lugar, hay que volver a elegirlo en Facebook para saber su número
  const city = place === old.place ? old.city : null;
  s.prefs = { min, max, place, city, onlyPlace: p.onlyPlace !== false };
  write('alquileres.json', s);
  return s.prefs;
}
function star({ read, write }, item, on) {
  const s = read('alquileres.json', {});
  s.saved ||= {};
  if (on) s.saved[item.id] = { ...item, savedAt: Date.now() };
  else delete s.saved[item.id];
  write('alquileres.json', s);
  return s.saved;
}
function state(read) {
  const s = read('alquileres.json', {});
  return { prefs: prefs(read), last: s.last || null, saved: s.saved || {}, url: searchUrl(prefs(read)) };
}

module.exports = { search, openWindow, savePrefs, star, state, searchUrl };

// LinkedIn dentro de ViperTech.
//  - Buscar ofertas: con el buscador público de empleos de LinkedIn (el mismo que
//    ve cualquiera sin iniciar sesión). No usa tu cuenta.
//  - Tus postulaciones y las recomendadas para ti: necesitan tu sesión. Se abre
//    LinkedIn en una ventana de la app, entras tú, y la app solo lee esas dos
//    páginas cuando pulsas "Leer de LinkedIn". Nunca postula ni escribe nada.
const { BrowserWindow, session, shell } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PART = 'persist:vt-linkedin';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ent = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
const text = (html) =>
  ent(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h\d)>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const DEFAULT_PREFS = { keywords: ['WordPress', 'Desarrollador web', 'Frontend', 'React', 'Next.js'], locations: ['Costa Rica', 'Latinoamérica'], remote: ['2'], period: 'r2592000', related: true };
const RELATED = /develop|desarroll|program|engineer|ingenier|front|back|full.?stack|web|wordpress|react|next|javascript|typescript|php|node|shopify|webflow|ui|ux|software|maquet/i;

function prefs(read) {
  return { ...DEFAULT_PREFS, ...(read('linkedin.json', {}).prefs || {}) };
}

function parseCards(html) {
  const out = [];
  for (const li of String(html).split(/<li>/).slice(1)) {
    const id = (li.match(/urn:li:jobPosting:(\d+)/) || [])[1];
    if (!id) continue;
    const pick = (re) => text((li.match(re) || [])[1] || '');
    out.push({
      id,
      title: pick(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/),
      company: pick(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/),
      location: pick(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/),
      date: (li.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null,
      ago: pick(/<time[^>]*>([\s\S]*?)<\/time>/),
      logo: ent((li.match(/data-delayed-url="([^"]+)"/) || [])[1] || '') || null,
      salary: pick(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/) || null,
      url: `https://www.linkedin.com/jobs/view/${id}/`,
    });
  }
  return out;
}

// LinkedIn responde 429 a las peticiones sin cookies de visitante: se guardan
// las que manda (como haría un navegador sin sesión) y se reintenta una vez.
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function keepCookies(r) {
  for (const c of r.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}
async function get(url, retry = true) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', ...(jar.size ? { Cookie: cookieHeader() } : {}) }, signal: AbortSignal.timeout(20000) });
  const had = jar.size;
  keepCookies(r);
  if (r.status === 429 && retry && jar.size > had) {
    await wait(1500);
    return get(url, false);
  }
  if (r.status === 429) throw new Error('LinkedIn pide esperar un rato (demasiadas búsquedas). Prueba más tarde.');
  if (!r.ok) throw new Error(`LinkedIn no respondió (HTTP ${r.status}).`);
  return r.text();
}

/** Busca ofertas con tus preferencias (máximo 2 páginas por palabra y lugar). */
async function search({ read, write }, onProgress) {
  const p = prefs(read);
  const out = new Map();
  // Una sola búsqueda por lugar con todas las palabras (LinkedIn limita mucho las consultas seguidas)
  const kw = p.keywords.slice(0, 8);
  const query = kw.length > 1 ? kw.map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(' OR ') : kw[0] || '';
  const places = (p.locations.length ? p.locations : ['']).slice(0, 4);
  let n = 0;
  let limited = false;
  outer: for (const l of places) {
    for (const start of [0, 25, 50]) {
      const q = new URLSearchParams({ keywords: query, location: l, f_TPR: p.period || 'r2592000', sortBy: 'DD', start: String(start) });
      if (p.remote?.length) q.set('f_WT', p.remote.join(','));
      onProgress?.(`Buscando${l ? ` en ${l}` : ''} (página ${start / 25 + 1})`);
      n++;
      let html = '';
      try {
        html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${q}`);
      } catch (e) {
        if (/esperar/.test(e.message)) {
          limited = true;
          break outer;
        }
      }
      const cards = parseCards(html);
      for (const c of cards) if (!out.has(c.id)) out.set(c.id, { ...c, query: kw.find((k) => c.title.toLowerCase().includes(k.toLowerCase())) || kw[0], where: l });
      if (cards.length < 10) break;
      await wait(3000 + Math.random() * 1500);
    }
  }
  if (limited && !out.size) throw new Error('LinkedIn pide esperar un rato antes de volver a buscar. Prueba en unos minutos.');
  const s = read('linkedin.json', {});
  const seen = s.seen || {};
  let list = [...out.values()];
  if (p.related) list = list.filter((j) => RELATED.test(`${j.title} ${j.query}`) || j.title.toLowerCase().includes(String(j.query).toLowerCase()));
  list = list.map((j) => ({ ...j, isNew: !seen[j.id] })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const j of list) seen[j.id] ||= Date.now();
  s.seen = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 3000));
  s.last = { at: Date.now(), list, limited };
  write('linkedin.json', s);
  return s.last;
}

/** Detalle público de una oferta: descripción, tipo, nivel y postulantes. */
async function detail(id) {
  const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(id)}`);
  const crit = {};
  for (const m of html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)) crit[text(m[1])] = text(m[2]);
  return {
    id,
    description: text((html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '').slice(0, 6000),
    applicants: text((html.match(/num-applicants__caption[^>]*>([\s\S]*?)<\//) || [])[1] || '') || null,
    posted: text((html.match(/posted-time-ago__text[^>]*>([\s\S]*?)<\//) || [])[1] || '') || null,
    seniority: crit['Seniority level'] || crit['Nivel de antigüedad'] || null,
    type: crit['Employment type'] || crit['Tipo de empleo'] || null,
    functions: crit['Job function'] || crit['Función laboral'] || null,
    industries: crit.Industries || crit.Sectores || null,
  };
}

// ---- tu cuenta (ventana de la app) ----
let accWin = null;
function accountSession() {
  const ses = session.fromPartition(PART);
  ses.setUserAgent(UA);
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  return ses;
}
const NAV_OK = /^https:\/\/([a-z]+\.)?linkedin\.com\/|^https:\/\/accounts\.google\.com\/|^https:\/\/appleid\.apple\.com\//;
/** Abre LinkedIn en una ventana visible (para iniciar sesión o postular). */
function openAccount(url = 'https://www.linkedin.com/login') {
  if (accWin && !accWin.isDestroyed()) {
    accWin.loadURL(url);
    accWin.show();
    accWin.focus();
    return true;
  }
  accWin = new BrowserWindow({ width: 1200, height: 900, title: 'LinkedIn · ViperTeca', autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { session: accountSession(), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  accWin.on('page-title-updated', (e) => e.preventDefault());
  accWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (NAV_OK.test(u)) accWin.loadURL(u);
    else if (/^https:\/\//.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  accWin.webContents.on('will-navigate', (e, u) => {
    if (!NAV_OK.test(u)) {
      e.preventDefault();
      if (/^https:\/\//.test(u)) shell.openExternal(u);
    }
  });
  accWin.on('closed', () => (accWin = null));
  accWin.loadURL(url);
  return true;
}

// Se ejecuta dentro de LinkedIn: tarjetas de empleo de la página (con tu sesión)
const READ = `(async () => {
  if (/\\/(login|checkpoint|authwall|uas\\/login)/.test(location.pathname) || document.querySelector('form.login__form, #username')) return { login: true };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 6; i++) {
    const lists = [...document.querySelectorAll('ul, div')].filter((el) => el.scrollHeight > el.clientHeight + 50 && el.querySelector('a[href*="/jobs/view/"]'));
    for (const el of lists.slice(0, 3)) el.scrollTop = el.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(700);
  }
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/jobs/view/"]')) {
    const id = (a.href.match(/\\/jobs\\/view\\/(?:[^/?]*-)?(\\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const card = a.closest('li') || a.closest('[data-job-id]') || a.parentElement;
    const lines = (card?.innerText || a.innerText).split('\\n').map((s) => s.trim()).filter(Boolean);
    const uniq = lines.filter((l, i) => lines.indexOf(l) === i);
    out.push({ id, lines: uniq.slice(0, 12), logo: card?.querySelector('img')?.src || null });
  }
  return { items: out };
})()`;

const STATUS = [
  [/no longer accepting|ya no se aceptan|cerrad/i, 'closed', 'Cerrada'],
  [/application viewed|solicitud vista|vista por|se vio tu solicitud|viewed/i, 'viewed', 'La vieron'],
  [/resume downloaded|cv descargado|currículum descargado/i, 'downloaded', 'Descargaron tu CV'],
  [/not selected|no seleccionad|no avanz|declin|rechaz/i, 'rejected', 'No seleccionado'],
  [/applied|solicitud enviada|postulad|enviaste|solicitado/i, 'applied', 'Enviada'],
];
function fromLines(it) {
  const L = it.lines;
  const status = STATUS.find(([re]) => L.some((l) => re.test(l)));
  const ago = L.find((l) => /(ago|hace|\b\d+\s*(d|sem|w|mo|h|min)\b)/i.test(l) && l.length < 60) || null;
  const title = L.find((l) => !/^(promoted|promocionado|easy apply|solicitud sencilla|actively|viewed|visto|\d)/i.test(l)) || L[0] || '';
  const i = L.indexOf(title);
  return { id: it.id, title, company: L[i + 1] || '', location: L[i + 2] || '', status: status ? status[1] : null, statusText: status ? L.find((l) => status[0].test(l)) : null, ago, logo: it.logo, url: `https://www.linkedin.com/jobs/view/${it.id}/` };
}

/** Lee tus postulaciones o las recomendadas, con la sesión de la ventana de la app. */
async function readAccount({ read, write }, which) {
  const url = which === 'applied' ? 'https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED' : 'https://www.linkedin.com/jobs/collections/recommended/';
  const w = new BrowserWindow({ show: false, width: 1300, height: 1000, webPreferences: { session: accountSession(), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await w.loadURL(url).catch(() => {});
    await wait(3500);
    let r = await w.webContents.executeJavaScript(READ).catch(() => ({ items: [] }));
    if (!r.login && !r.items?.length) {
      await wait(3000);
      r = await w.webContents.executeJavaScript(READ).catch(() => ({ items: [] }));
    }
    if (r.login) return { login: true };
    const items = (r.items || []).map(fromLines);
    const s = read('linkedin.json', {});
    s.account ||= {};
    s.account[which] = { at: Date.now(), items };
    write('linkedin.json', s);
    return s.account[which];
  } finally {
    w.destroy();
  }
}

/** Seguimiento local: guardadas y postulaciones que marcas tú. */
function track({ read, write }, job, status) {
  const s = read('linkedin.json', {});
  s.tracked ||= {};
  if (!status) delete s.tracked[job.id];
  else s.tracked[job.id] = { ...(s.tracked[job.id] || {}), id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, logo: job.logo || null, status, at: s.tracked[job.id]?.at || Date.now(), updated: Date.now() };
  write('linkedin.json', s);
  return s.tracked;
}

function savePrefs({ read, write }, p) {
  const s = read('linkedin.json', {});
  const list = (v, n) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
  s.prefs = {
    keywords: list(p.keywords, 8),
    locations: list(p.locations, 4),
    remote: (Array.isArray(p.remote) ? p.remote : []).filter((x) => ['1', '2', '3'].includes(String(x))).map(String),
    period: ['r86400', 'r604800', 'r2592000'].includes(p.period) ? p.period : 'r2592000',
    related: p.related !== false,
  };
  write('linkedin.json', s);
  return s.prefs;
}

function state(read) {
  const s = read('linkedin.json', {});
  return { prefs: prefs(read), last: s.last || null, account: s.account || {}, tracked: s.tracked || {} };
}

module.exports = { search, detail, openAccount, readAccount, track, savePrefs, state };

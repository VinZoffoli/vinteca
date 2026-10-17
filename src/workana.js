// Búsqueda de proyectos en Workana (la página pública de "Trabajos").
// Workana protege su web con Cloudflare, así que se lee con una ventana oculta
// de la app (Chromium, como un navegador normal) y solo cuando pulsas Buscar:
// unas pocas páginas por búsqueda, sin iniciar sesión.
// La app NO envía propuestas: las deja listas y abre el proyecto para que
// postules tú (Workana no permite postular con programas automáticos).
const { BrowserWindow, session } = require('electron');

const BASE = 'https://www.workana.com/jobs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (s) =>
  String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// "USD 250 - 500", "Menos de USD 50", "Más de USD 3.000", "USD 15 - 45 / hora"
function parseBudget(s) {
  const t = strip(s);
  const nums = (t.match(/\d[\d.,]*/g) || []).map((n) => Number(n.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')));
  const currency = (t.match(/\b([A-Z]{3})\b/) || [])[1] || 'USD';
  let min = null;
  let max = null;
  if (/menos de|less than|até/i.test(t)) max = nums[0] ?? null;
  else if (/más de|more than|mais de/i.test(t)) min = nums[0] ?? null;
  else [min, max] = [nums[0] ?? null, nums[1] ?? nums[0] ?? null];
  return { text: t, currency, min, max, hourly: /hora|hour/i.test(t) };
}

function project(x) {
  const desc = strip(x.description);
  const [body, meta] = desc.split(/\n\s*Categoría:/);
  return {
    slug: x.slug,
    url: `https://www.workana.com/job/${x.slug}`,
    title: strip((String(x.title).match(/title="([^"]+)"/) || [])[1] || x.title),
    description: (body || desc).trim(),
    meta: meta ? `Categoría:${meta}`.replace(/\s+\n/g, '\n').trim() : '',
    budget: parseBudget(x.budget),
    hourly: !!x.isHourly,
    bids: Number((String(x.totalBids || '').match(/\d+/) || [0])[0]),
    posted: x.postedDate || '',
    published: x.publishedDate || null,
    country: strip(x.country),
    rating: x.rating?.value ? Number(x.rating.value) : null,
    verified: !!x.hasVerifiedPaymentMethod,
    urgent: !!x.isUrgent,
    skills: (x.skills || []).map((s) => s.anchorText),
    author: x.authorName || '',
  };
}

let win = null;
async function page() {
  if (win && !win.isDestroyed()) return win;
  const ses = session.fromPartition('persist:vt-workana');
  ses.setUserAgent(UA);
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL(`${BASE}?language=es&category=it-programming`).catch(() => {});
  // Esperar a que pase la comprobación de Cloudflare
  for (let i = 0; i < 30; i++) {
    const t = await win.webContents.executeJavaScript('document.title').catch(() => '');
    if (t && !/just a moment|un momento|attention/i.test(t)) return win;
    await wait(1000);
  }
  throw new Error('Workana no deja cargar la búsqueda ahora mismo (protección de Cloudflare). Prueba en un rato.');
}

function close() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

async function fetchJson(w, url) {
  const code = `fetch(${JSON.stringify(url)}, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, credentials: 'include' }).then((r) => r.ok ? r.json() : { error: r.status })`;
  return w.webContents.executeJavaScript(code);
}

/**
 * Busca proyectos con varias palabras clave y junta los resultados sin repetir.
 * @param queries ['wordpress', 'elementor'...]  @param publication 1d | 3d | 1w | 1m
 */
async function search({ queries, publication = '3d', pages = 2, onProgress }) {
  const w = await page();
  const out = new Map();
  try {
    let n = 0;
    for (const q of queries) {
      for (let p = 1; p <= pages; p++) {
        const url = `${BASE}?category=it-programming&language=es&publication=${encodeURIComponent(publication)}&query=${encodeURIComponent(q)}&page=${p}`;
        const j = await fetchJson(w, url);
        n++;
        onProgress?.(`Buscando «${q}» (${n} de ${queries.length * pages})`);
        if (!j || j.error) break;
        const list = j.results?.results || [];
        for (const x of list) if (x.slug && !out.has(x.slug)) out.set(x.slug, { ...project(x), query: q });
        if (!j.results?.pagination?.nextPage || list.length < 10) break;
        await wait(900 + Math.random() * 700); // ritmo de persona, sin saturar
      }
    }
  } finally {
    close();
  }
  return [...out.values()];
}

// ---- Postular: ventana de Workana con la propuesta y el precio ya puestos ----
// Se abre el proyecto en una ventana de ViperTeca con tu sesión de Workana (la
// inicias tú una vez, con tu usuario y contraseña). La app pasa al formulario de
// propuesta, escribe el texto y el precio, y te deja revisar: el botón Enviar
// lo pulsas tú. Nunca envía nada por su cuenta.
const BID_NAV = /^https:\/\/(www\.)?workana\.com\/|^https:\/\/accounts\.google\.com\/|^https:\/\/(www\.)?facebook\.com\/|^https:\/\/appleid\.apple\.com\//;
let bidWin = null;

// Se ejecuta dentro de la página de Workana. Devuelve en qué paso está.
function fillScript(text, price) {
  return `(() => {
  const TEXT = ${JSON.stringify(text)};
  const PRICE = ${JSON.stringify(String(price || ''))};
  const banner = (msg, ok) => {
    let b = document.getElementById('vt-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'vt-banner';
      b.setAttribute('role', 'status');
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:2147483647;max-width:min(680px,92vw);padding:12px 18px;border-radius:12px;font:600 14px/1.45 system-ui,sans-serif;color:#fff;box-shadow:0 12px 34px rgba(0,0,0,.35)';
      document.body.appendChild(b);
    }
    b.style.background = ok ? '#17643f' : '#2a2160';
    b.textContent = msg;
  };
  const loginMsg = 'Inicia sesión en Workana en esta ventana con tu usuario y contraseña. Cuando entres, ViperTeca sigue sola.';
  if (/\\/(login|signup)/.test(location.pathname)) { banner(loginMsg); return 'login'; }
  const btn = document.getElementById('bid_button');
  if (btn) {
    if (/signup|login/.test(btn.getAttribute('href') || '')) { banner(loginMsg); return 'login'; }
    if (btn.href && btn.href !== location.href) { location.href = btn.href; return 'go'; }
  }
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const tas = [...document.querySelectorAll('textarea')].filter(visible);
  if (!tas.length) return 'wait';
  const ta = tas.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  const set = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    for (const t of ['input', 'change', 'keyup', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
  };
  if (!ta.value.trim()) set(ta, TEXT);
  const label = (el) => [...(el.labels || [])].map((l) => l.textContent).join(' ') + ' ' + el.name + ' ' + el.id + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.closest('.form-group, .field, label, div')?.querySelector('label')?.textContent || '');
  const inputs = [...document.querySelectorAll('input')].filter((i) => visible(i) && /^(text|number|tel|)$/.test(i.type));
  const priceIn = inputs.find((i) => /amount|budget|monto|valor|precio|price|total|cobrar|ofert/i.test(label(i)) && !/hour|hora|time|tiempo|plazo|d[ií]as|delivery|entrega|search|buscar/i.test(label(i)));
  if (priceIn && PRICE && !priceIn.value) set(priceIn, PRICE);
  ta.scrollIntoView({ block: 'center' });
  banner(priceIn ? 'ViperTeca puso tu propuesta y el precio (' + PRICE + '). Revisa todo, completa el plazo si te lo pide y pulsa Enviar.' : 'ViperTeca puso tu propuesta. Escribe el precio (' + PRICE + ') y el plazo, revisa y pulsa Enviar.', true);
  return priceIn ? 'filled' : 'filled-text';
})()`;
}

/** Abre el proyecto para postular. onState(paso) informa de lo que va pasando. */
function bid({ url, text, price, onState, onClose }) {
  if (bidWin && !bidWin.isDestroyed()) bidWin.destroy();
  const ses = session.fromPartition('persist:vt-workana');
  ses.setUserAgent(UA);
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  const w = new BrowserWindow({ width: 1180, height: 920, title: 'Postular en Workana · ViperTeca', autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  bidWin = w;
  w.on('page-title-updated', (e) => e.preventDefault());
  const wc = w.webContents;
  wc.setWindowOpenHandler(({ url: u }) => {
    if (BID_NAV.test(u)) wc.loadURL(u);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, u) => {
    if (!BID_NAV.test(u)) e.preventDefault();
  });
  let last = null;
  let run = 0;
  const step = async () => {
    const id = ++run;
    for (let i = 0; i < 15 && id === run && !w.isDestroyed(); i++) {
      const s = await wc.executeJavaScript(fillScript(text, price)).catch(() => 'wait');
      if (s !== last) onState?.((last = s));
      if (s !== 'wait') return;
      await wait(1000);
    }
  };
  wc.on('did-finish-load', step);
  wc.on('did-navigate-in-page', step);
  w.on('closed', () => {
    if (bidWin === w) bidWin = null;
    onClose?.(last);
  });
  w.loadURL(url).catch(() => {});
  return true;
}

module.exports = { search, parseBudget, strip, bid, fillScript };

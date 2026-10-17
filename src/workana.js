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

module.exports = { search, parseBudget, strip };

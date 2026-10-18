// Revisión profunda de una web, como la vería un visitante: se abre en una
// ventana oculta (sin sesión ni cookies tuyas) y se apunta solo lo que de verdad
// rompe la web, no la velocidad:
//  - la página no carga o devuelve 404/5xx
//  - errores de JavaScript (los que dejan botones o menús sin funcionar)
//  - archivos propios que fallan (scripts, estilos, imágenes, llamadas a la API)
//  - enlaces y botones internos que llevan a una página que no existe o da error
const { BrowserWindow, session } = require('electron');

const PARTITION = 'vt-sitecheck'; // en memoria: no guarda nada
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ViperTeca-monitor';
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
// ruido que no rompe nada (extensiones, analítica, avisos del navegador)
const NOISE = /ResizeObserver loop|chrome-extension|third-party cookie|favicon\.ico|google-analytics|googletagmanager|gtag|facebook|fbevents|hotjar|clarity\.ms|doubleclick|tiktok|pinterest|Failed to load resource|Download the React DevTools|was preloaded using link preload|Permissions-Policy|deprecated|net::ERR_BLOCKED_BY_CLIENT/i;
const SERIOUS = /Uncaught|Unhandled|TypeError|ReferenceError|SyntaxError|is not a function|is not defined|Cannot read prop|Hydration failed|hydrating|Minified React error|ChunkLoadError|Loading chunk .* failed|Application error/i;

let busy = Promise.resolve();

/** Revisa una web. Se hacen de una en una (comparten la sesión oculta). */
function crawl(url, opts = {}) {
  const run = busy.then(() => doCrawl(url, opts));
  busy = run.catch(() => {});
  return run;
}

async function doCrawl(url, { maxLinks = 30, wait = 4500 } = {}) {
  const host = hostOf(url);
  const same = (u) => {
    const h = hostOf(u);
    return h && (h === host || h.endsWith('.' + host));
  };
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(UA);
  const out = { url, at: Date.now(), page: null, jsErrors: [], failed: [], broken: [], links: 0 };
  const w = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: true } });
  const wcId = w.webContents.id;
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ses.webRequest.onCompleted((d) => {
    if (d.webContentsId !== wcId) return;
    if (d.resourceType === 'mainFrame') {
      out.page = out.page || { status: d.statusCode, finalUrl: d.url };
      if (d.url && same(d.url)) out.page = { status: d.statusCode, finalUrl: d.url };
      return;
    }
    if (d.statusCode >= 400 && same(d.url) && !/favicon|\.map$/i.test(d.url)) out.failed.push({ url: d.url, status: d.statusCode, type: d.resourceType });
  });
  ses.webRequest.onErrorOccurred((d) => {
    if (d.webContentsId !== wcId || !same(d.url) || /ERR_ABORTED|ERR_BLOCKED|ERR_CACHE_MISS/.test(d.error)) return;
    if (d.resourceType === 'mainFrame') out.page = { status: 0, error: d.error.replace('net::', ''), finalUrl: d.url };
    else out.failed.push({ url: d.url, status: d.error.replace('net::', ''), type: d.resourceType });
  });
  w.webContents.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    const msg = String(e.message ?? e.params?.message ?? '');
    if ((level === 'error' || level === 3) && !NOISE.test(msg)) out.jsErrors.push(msg.slice(0, 300));
  });
  w.webContents.on('render-process-gone', () => out.jsErrors.push('La página se colgó al cargar (el navegador cerró la pestaña).'));
  const t0 = Date.now();
  try {
    await Promise.race([w.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('No terminó de cargar en 30 s')), 30000))]);
    await new Promise((r) => setTimeout(r, wait)); // deja que la web se monte (Next.js, React…)
    out.ms = Date.now() - t0;
    const found = await w.webContents.executeJavaScript(`(() => {
      const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.title || el.querySelector('img')?.alt || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
      const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: txt(a) }));
      const forms = [...document.querySelectorAll('form[action]')].map((f) => ({ href: f.action, text: 'Formulario ' + (f.getAttribute('name') || f.id || '') }));
      return { links: links.concat(forms), title: document.title, empty: (document.body?.innerText || '').trim().length < 20 };
    })()`, true).catch(() => ({ links: [], title: '', empty: false }));
    out.title = found.title;
    if (found.empty && !out.page?.error) out.blank = true;
    // enlaces internos únicos (sin anclas ni mailto/tel/whatsapp)
    const seen = new Map();
    for (const l of found.links) {
      try {
        const u = new URL(l.href);
        if (!/^https?:$/.test(u.protocol) || !same(u.href)) continue;
        u.hash = '';
        const k = u.href;
        if (!seen.has(k)) seen.set(k, l.text);
      } catch {}
    }
    out.links = seen.size;
    const list = [...seen.entries()].slice(0, maxLinks);
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < list.length) {
        const [href, text] = list[i++];
        const st = await status(href);
        if (st.bad) out.broken.push({ href, text, status: st.status });
      }
    }));
  } catch (e) {
    out.page = out.page && out.page.status >= 400 ? out.page : { status: out.page?.status || 0, error: e.message };
  } finally {
    ses.webRequest.onCompleted(null);
    ses.webRequest.onErrorOccurred(null);
    if (!w.isDestroyed()) w.destroy();
    await ses.clearStorageData().catch(() => {});
  }
  out.jsErrors = [...new Set(out.jsErrors)].slice(0, 10);
  const fk = new Set();
  out.failed = out.failed.filter((f) => !fk.has(f.url) && fk.add(f.url)).slice(0, 15);
  return out;
}

/** Estado de un enlace: HEAD y, si el servidor no lo acepta, GET. */
async function status(href) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(href, { method, redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      r.body?.cancel().catch(() => {});
      if (method === 'HEAD' && [403, 405, 501].includes(r.status)) continue;
      return { status: r.status, bad: r.status === 404 || r.status === 410 || r.status >= 500 };
    } catch (e) {
      if (method === 'GET') return { status: e.name === 'TimeoutError' ? 'no respondió' : 'error de red', bad: e.name !== 'TimeoutError' };
    }
  }
  return { status: 0, bad: false };
}

/**
 * Convierte el resultado en avisos con gravedad. Solo cosas que rompen la web.
 * sev: critical (la web no se puede usar) · high (algo no funciona) · medium (detalles rotos)
 */
function issuesOf(site, r) {
  const out = [];
  const add = (kind, sev, title, detail, target = '') => out.push({ key: `${site.url}|${kind}|${target}`, site: site.url, name: site.name, kind, sev, title, detail, target });
  const p = r.page || {};
  if (p.error || !p.status) add('down', 'critical', 'La web no carga', p.error || 'No responde.');
  else if (p.status >= 500) add('down', 'critical', `La web da error ${p.status}`, 'La página principal responde con un error del servidor.');
  else if (p.status === 404) add('down', 'critical', 'La página principal no existe (404)', p.finalUrl || site.url);
  else if (p.status >= 400) add('down', 'high', `La web responde ${p.status}`, 'La página principal no se puede ver (¿protección o bloqueo?).');
  if (r.blank && !(p.status >= 400)) add('blank', 'critical', 'La web carga en blanco', 'La página no muestra contenido: suele ser un error de JavaScript al arrancar.');
  const serious = r.jsErrors.filter((m) => SERIOUS.test(m));
  if (serious.length) add('js', 'high', serious.length === 1 ? 'Error de JavaScript en la web' : `${serious.length} errores de JavaScript en la web`, serious.slice(0, 3).join('\n'), 'js');
  for (const f of r.failed) {
    const kind = /script|stylesheet/.test(f.type) ? 'asset' : /xhr|fetch/.test(f.type) ? 'api' : f.type === 'image' ? 'image' : 'asset';
    const sev = kind === 'image' ? 'medium' : 'high';
    const label = kind === 'api' ? 'Una llamada a la API falla' : kind === 'image' ? 'Una imagen no carga' : /script/.test(f.type) ? 'Un script de la web no carga' : /stylesheet/.test(f.type) ? 'Una hoja de estilos no carga' : 'Un archivo de la web no carga';
    add(kind, sev, `${label} (${f.status})`, f.url, f.url);
  }
  for (const b of r.broken) add('link', b.status >= 500 ? 'high' : 'high', `${b.text ? `«${b.text}»` : 'Un enlace'} lleva a una página ${b.status === 404 || b.status === 410 ? 'que no existe' : 'con error'} (${b.status})`, b.href, b.href);
  return out;
}

module.exports = { crawl, issuesOf, hostOf };

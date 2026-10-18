'use strict';
// 1.26: revisión de lanzamiento de una web (cuando pasa a Live en Notion, o a mano).
// Abre la web como un visitante, en escritorio y en celular, y devuelve una lista
// de puntos: carga, Google (Tag Manager / Analytics), pixel de Meta, formulario,
// SEO básico (título, descripción, compartir, canonical, robots, sitemap) y móvil.
const { BrowserWindow, session } = require('electron');
const sitecheck = require('./sitecheck');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ViperTeca-lanzamiento';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const DOM = `(() => {
  const m = (sel) => document.querySelector(sel);
  const meta = (n) => (m('meta[name="' + n + '"]') || m('meta[property="' + n + '"]'))?.content || '';
  const forms = [...document.forms].filter((f) => f.querySelector('input, textarea, select'));
  const embeds = [...document.querySelectorAll('iframe')].map((f) => f.src).filter((s) => /toasttab|typeform|jotform|tally\\.so|hubspot|google\\.com\\/forms|formspree|opentable|resy|sevenrooms|tock/i.test(s));
  return {
    title: document.title || '',
    description: meta('description'),
    ogTitle: meta('og:title'),
    ogImage: meta('og:image'),
    canonical: m('link[rel="canonical"]')?.href || '',
    robots: meta('robots'),
    lang: document.documentElement.lang || '',
    h1: document.querySelectorAll('h1').length,
    viewport: meta('viewport'),
    favicon: !!m('link[rel~="icon"]'),
    forms: forms.length,
    emails: document.querySelectorAll('input[type="email"]').length,
    embeds,
    dataLayer: Array.isArray(window.dataLayer),
    fbq: typeof window.fbq === 'function',
    gtag: typeof window.gtag === 'function',
    imgsNoAlt: [...document.images].filter((i) => !i.alt && i.naturalWidth > 80).length,
    imgs: document.images.length,
  };
})()`;
const OVERFLOW = `(() => {
  const w = document.documentElement.clientWidth;
  const wide = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 4 && getComputedStyle(el).position !== 'fixed'; }).slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''));
  const small = [...document.querySelectorAll('p, li, a, span, button')].filter((el) => el.offsetParent && el.innerText?.trim().length > 3 && parseFloat(getComputedStyle(el).fontSize) < 12).length;
  return { scroll: document.documentElement.scrollWidth, width: w, wide, small };
})()`;

async function open(url, { mobile = false } = {}) {
  const ses = session.fromPartition('vt-launch');
  ses.setUserAgent(mobile ? UA_MOBILE : UA);
  const w = new BrowserWindow({ show: false, width: mobile ? 390 : 1366, height: mobile ? 844 : 900, webPreferences: { session: ses, sandbox: true, backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const reqs = [];
  const wcId = w.webContents.id;
  ses.webRequest.onCompleted((d) => d.webContentsId === wcId && reqs.push(d.url));
  let status = null;
  w.webContents.on('did-navigate', (_e, _u, code) => (status = code));
  try {
    await Promise.race([w.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('No terminó de cargar en 30 s')), 30000))]);
    await new Promise((r) => setTimeout(r, 5000));
    return { w, ses, reqs, status };
  } catch (e) {
    ses.webRequest.onCompleted(null);
    if (!w.isDestroyed()) w.destroy();
    throw e;
  }
}
const close = async ({ w, ses }) => {
  ses.webRequest.onCompleted(null);
  if (!w.isDestroyed()) w.destroy();
  await ses.clearStorageData().catch(() => {});
};
async function reachable(u) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    const t = await r.text();
    return { ok: r.ok, text: t.slice(0, 20000) };
  } catch {
    return { ok: false, text: '' };
  }
}

/** Revisa una web y devuelve { url, at, ok, items: [{ key, ok, sev, label, detail }] }. */
async function check(rawUrl) {
  const url = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : 'https://' + rawUrl).href;
  const items = [];
  const add = (key, ok, label, detail = '', sev = 'high') => items.push({ key, ok: !!ok, sev: ok ? 'ok' : sev, label, detail });
  let d = null;
  let reqs = [];
  let status = null;
  try {
    const pg = await open(url);
    status = pg.status;
    reqs = pg.reqs;
    d = await pg.w.webContents.executeJavaScript(DOM).catch(() => null);
    await close(pg);
  } catch (e) {
    add('carga', false, 'La web no carga', e.message, 'critical');
    return { url, at: Date.now(), ok: false, items };
  }
  add('carga', status && status < 400 && d, status && status < 400 ? 'Carga bien' : `Responde ${status || 'sin respuesta'}`, '', 'critical');
  if (!d) return { url, at: Date.now(), ok: false, items };
  // Google y Meta (por lo que pide la página y por los objetos que deja)
  const any = (re) => reqs.some((u) => re.test(u));
  const gtm = any(/googletagmanager\.com\/gtm\.js/);
  const ga = any(/googletagmanager\.com\/gtag\/js|google-analytics\.com\/(g\/)?collect|analytics\.google\.com/) || d.gtag;
  const pixel = any(/connect\.facebook\.net\/.*fbevents|facebook\.com\/tr/) || d.fbq;
  add('gtm', gtm || ga, gtm ? 'Google Tag Manager instalado' + (ga ? ' y Analytics enviando datos' : '') : ga ? 'Google Analytics instalado (sin Tag Manager)' : 'Falta Google Tag Manager / Analytics', gtm && !ga ? 'Tag Manager carga, pero no vi Analytics enviando: revisa la etiqueta GA4 en GTM.' : '', 'high');
  add('pixel', pixel, pixel ? 'Pixel de Meta instalado' : 'Falta el pixel de Meta', pixel ? '' : 'No se cargó fbevents.js: revisa la etiqueta del pixel (o el consentimiento de cookies).', 'medium');
  // formulario
  const hasForm = d.forms > 0 || d.embeds.length > 0;
  add('form', hasForm, hasForm ? (d.forms ? `Formulario en la página (${d.forms})` : 'Formulario incrustado (' + new URL(d.embeds[0]).hostname.replace(/^www\./, '') + ')') : 'No hay formulario en la portada', hasForm ? '' : 'Si el formulario está en otra página (contacto, reservas, catering), revísalo a mano.', 'medium');
  // SEO básico
  const tl = d.title.trim().length;
  add('title', tl >= 10 && tl <= 65, tl ? `Título de ${tl} caracteres` : 'Sin título', tl ? (tl > 65 ? 'Google lo corta: mejor 50–60 caracteres.' : tl < 10 ? 'Muy corto.' : d.title) : '', 'high');
  const dl = d.description.trim().length;
  add('desc', dl >= 50 && dl <= 170, dl ? `Descripción de ${dl} caracteres` : 'Sin meta descripción', dl ? (dl > 170 ? 'Muy larga: Google la corta en ~160.' : dl < 50 ? 'Muy corta.' : '') : 'Google inventará una con el texto de la página.', 'medium');
  add('og', d.ogTitle && d.ogImage, d.ogTitle && d.ogImage ? 'Imagen y título para compartir (WhatsApp, redes)' : 'Falta la imagen o el título para compartir', !d.ogImage ? 'Sin og:image el enlace sale sin foto en WhatsApp e Instagram.' : '', 'medium');
  add('h1', d.h1 === 1, d.h1 === 1 ? 'Un título principal (H1)' : d.h1 ? `${d.h1} títulos H1` : 'Sin título principal (H1)', d.h1 > 1 ? 'Debería haber uno solo.' : '', 'medium');
  add('noindex', !/noindex/i.test(d.robots), /noindex/i.test(d.robots) ? 'La página dice «noindex»: Google no la mostrará' : 'Google puede indexarla', /noindex/i.test(d.robots) ? 'Quita el meta robots noindex de producción.' : '', 'critical');
  add('canonical', !!d.canonical, d.canonical ? 'Canonical definido' : 'Sin enlace canonical', d.canonical && new URL(d.canonical).hostname !== new URL(url).hostname ? 'Apunta a otro dominio: ' + d.canonical : '', 'medium');
  const base = new URL(url).origin;
  const [robots, sitemap] = await Promise.all([reachable(base + '/robots.txt'), reachable(base + '/sitemap.xml')]);
  add('robots', robots.ok && !/Disallow:\s*\/\s*$/m.test(robots.text), robots.ok ? (/Disallow:\s*\/\s*$/m.test(robots.text) ? 'robots.txt bloquea toda la web' : 'robots.txt bien') : 'Sin robots.txt', /Disallow:\s*\/\s*$/m.test(robots.text) ? 'Tiene «Disallow: /»: Google no entra.' : '', /Disallow:\s*\/\s*$/m.test(robots.text) ? 'critical' : 'medium');
  add('sitemap', sitemap.ok && /<urlset|<sitemapindex/.test(sitemap.text), sitemap.ok ? 'sitemap.xml publicado' : 'Sin sitemap.xml', '', 'medium');
  add('lang', !!d.lang, d.lang ? `Idioma de la página: ${d.lang}` : 'Falta el idioma (lang) en la página', '', 'medium');
  add('favicon', d.favicon, d.favicon ? 'Ícono de la pestaña' : 'Sin ícono (favicon)', '', 'medium');
  if (d.imgsNoAlt) add('alt', false, `${d.imgsNoAlt} ${d.imgsNoAlt === 1 ? 'imagen' : 'imágenes'} sin texto alternativo`, 'Ayuda al SEO de imágenes y a la accesibilidad.', 'medium');
  // móvil
  add('viewport', /width=device-width/.test(d.viewport), /width=device-width/.test(d.viewport) ? 'Preparada para celular (viewport)' : 'Falta el meta viewport', '', 'critical');
  try {
    const pg = await open(url, { mobile: true });
    const o = await pg.w.webContents.executeJavaScript(OVERFLOW).catch(() => null);
    await close(pg);
    if (o) {
      const over = o.scroll > o.width + 4;
      add('mobile', !over, over ? 'En el celular la página se mueve de lado' : 'En el celular no se sale de la pantalla', over ? `Se pasa ${o.scroll - o.width}px. Elementos: ${o.wide.join(', ') || '¿?'}` : '', 'high');
      if (o.small) add('font', false, `${o.small} textos de menos de 12px en el celular`, 'Difíciles de leer: mejor 14px o más.', 'medium');
    }
  } catch {}
  // lo que rompe la web (errores de JavaScript, archivos y enlaces rotos)
  try {
    const r = await sitecheck.crawl(url, { maxLinks: 25 });
    const issues = sitecheck.issuesOf({ url, name: url }, r).filter((i) => i.kind !== 'down');
    add('broken', !issues.length, issues.length ? `${issues.length} ${issues.length === 1 ? 'cosa rota' : 'cosas rotas'} (enlaces, archivos o JavaScript)` : 'Sin enlaces rotos ni errores de JavaScript', issues.slice(0, 4).map((i) => i.title).join(' · '), 'high');
  } catch {}
  const bad = items.filter((i) => !i.ok);
  return { url, at: Date.now(), ok: !bad.some((i) => i.sev === 'critical' || i.sev === 'high'), pending: bad.length, items };
}

module.exports = { check };

'use strict';
// 1.25: datos de un producto a partir de su enlace (nombre, foto, precio, tienda).
// Primero se lee la página tal cual; si la tienda arma la página con JavaScript
// (Shein, Temu, AliExpress…) se abre en una ventana oculta, sin tu sesión.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Solo direcciones públicas: nada de la red de casa ni del propio PC.
function privateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80|::ffff:(10|127|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip) || ip === '::';
  return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
}
async function safeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new Error('Ese enlace no es válido.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('El enlace tiene que empezar por https://');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('Ese enlace no es de una tienda.');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('No encuentro esa página. Revisa el enlace.');
  if (addrs.some((a) => privateIp(a.address))) throw new Error('Ese enlace no es de una tienda.');
  if (u.protocol === 'http:') u.protocol = 'https:';
  return u;
}

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html, keys) {
  for (const k of keys) {
    const re = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + k.replace(/[:.]/g, '\\$&') + '["\'][^>]*>', 'i');
    const tag = html.match(re)?.[0];
    const v = tag && (tag.match(/content=["']([^"']*)["']/i) || [])[1];
    if (v) return decode(v);
  }
  return null;
}

/** Número de un precio escrito de cualquier forma: "₡12.500", "$1,299.99", "19,99 €". */
function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  // separador decimal solo si le siguen 1 o 2 cifras
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function currencyOf(text, host) {
  const t = String(text || '');
  if (/^[A-Z]{3}$/.test(t)) return t;
  if (/₡|CRC/.test(t)) return 'CRC';
  if (/€|EUR/.test(t)) return 'EUR';
  if (/US\$|USD|\$/.test(t)) return 'USD';
  if (/\.cr$/i.test(host)) return 'CRC';
  return null;
}

// JSON-LD: el bloque de datos estructurados que casi todas las tiendas publican
function fromJsonLd(html) {
  const out = {};
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try {
      j = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const all = [];
    const walk = (x) => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) return x.forEach(walk);
      all.push(x);
      if (x['@graph']) walk(x['@graph']);
    };
    walk(j);
    const p = all.find((x) => /Product/i.test([].concat(x['@type'] || []).join(' ')));
    if (!p) continue;
    const offer = [].concat(p.offers || [])[0] || {};
    const img = [].concat(p.image || [])[0];
    out.name = out.name || decode(p.name);
    out.image = out.image || (typeof img === 'string' ? img : img?.url || img?.contentUrl) || null;
    out.price = out.price || parsePrice(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price);
    out.currency = out.currency || offer.priceCurrency || offer.priceSpecification?.priceCurrency || null;
    out.store = out.store || decode(p.brand?.name || (typeof p.brand === 'string' ? p.brand : '')) || null;
  }
  return out;
}

function fromHtml(html, url) {
  const ld = fromJsonLd(html);
  const host = url.hostname.replace(/^www\./, '');
  const name =
    ld.name ||
    meta(html, ['og:title', 'twitter:title', 'title']) ||
    decode(html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]) ||
    decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const image =
    ld.image ||
    meta(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src', 'image']) ||
    html.match(/data-old-hires=["'](https:[^"']+)["']/i)?.[1] ||
    html.match(/"hiRes":"(https:[^"]+)"/)?.[1] ||
    null;
  const priceText =
    meta(html, ['product:price:amount', 'og:price:amount', 'price', 'twitter:data1']) ||
    html.match(/class=["']a-offscreen["'][^>]*>([^<]+)</i)?.[1] ||
    html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    null;
  const price = ld.price || parsePrice(priceText);
  const currency = ld.currency || meta(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']) || currencyOf(priceText, host);
  const store = meta(html, ['og:site_name', 'application-name']) || ld.store || host;
  return { name: cleanName(name, store), image: absolute(image, url), price, currency, store };
}
const absolute = (src, base) => {
  if (!src) return null;
  try {
    const u = new URL(decode(src), base);
    return /^https?:$/.test(u.protocol) ? u.href.replace(/^http:/, 'https:') : null;
  } catch {
    return null;
  }
};
// "Zapatillas X : Amazon.com: Moda" → "Zapatillas X"
function cleanName(name, store) {
  let n = decode(name || '');
  if (!n) return null;
  n = n.replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*Amazon\.[a-z.]+.*$/i, '');
  // Amazon añade la categoría al final: "Producto : Dispositivos Amazon y Accesorios"
  if (/amazon/i.test(store || '') && n.includes(' : ')) n = n.slice(0, n.lastIndexOf(' : '));
  if (store) n = n.replace(new RegExp('\\s*[|\\-–—]\\s*' + store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'i'), '');
  return n.slice(0, 160).trim() || null;
}

async function fetchHtml(url) {
  const r = await fetch(url.href, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'es-CR,es;q=0.9,en;q=0.8', Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { html: '', final: new URL(r.url || url.href) };
  const reader = r.body.getReader();
  let html = '';
  const td = new TextDecoder();
  while (html.length < 3_000_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += td.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return { html, final: new URL(r.url || url.href) };
}

// Ventana oculta para las tiendas que arman la página con JavaScript
async function rendered(url) {
  const { BrowserWindow } = require('electron');
  const w = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { partition: 'vt-linkmeta', sandbox: true, javascript: true, images: false, backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([w.loadURL(url.href, { userAgent: UA }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]).catch(() => null);
    await new Promise((r) => setTimeout(r, 3500));
    const html = await w.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => '');
    // por si la foto solo aparece como <img> grande
    const bigImg = await w.webContents
      .executeJavaScript(`(() => { const im = [...document.images].filter((i) => i.naturalWidth >= 300 && /^https:/.test(i.currentSrc || i.src)).sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0]; return im ? (im.currentSrc || im.src) : null; })()`)
      .catch(() => null);
    return { html, final: new URL(w.webContents.getURL() || url.href), bigImg };
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
}

/** Foto pequeña guardada dentro de la app (data:), para que no dependa de la tienda. */
async function shrinkImage(src) {
  if (!src) return null;
  try {
    const u = await safeUrl(src);
    const r = await fetch(u.href, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return u.href;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15_000_000) return u.href;
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return u.href; // webp/avif que Electron no abre: se deja el enlace
    const { width } = img.getSize();
    if (width > 640) img = img.resize({ width: 640, quality: 'good' });
    const jpg = img.toJPEG(82);
    return jpg.length < 650000 ? 'data:image/jpeg;base64,' + jpg.toString('base64') : u.href;
  } catch {
    return /^https:\/\//.test(src) ? src : null;
  }
}

/**
 * Lee un producto. Devuelve { url, name, image, price, currency, store }.
 * @param opts.render  usar la ventana oculta si falta algo (por defecto sí)
 */
// páginas de error o de "no eres un robot" en lugar del producto
const BAD = /robot|captcha|access denied|just a moment|not found|no encontrad|no disponible|no est[aá] disponible|unavailable|error page|^error|404|sign in|iniciar sesi/i;
async function read(raw, opts = {}) {
  const url = await safeUrl(raw);
  let { html, final } = await fetchHtml(url).catch(() => ({ html: '', final: url }));
  let d = html ? fromHtml(html, final) : { name: null, image: null, price: null, currency: null, store: final.hostname.replace(/^www\./, '') };
  const host = final.hostname.replace(/^www./, '').toLowerCase();
  const bare = (x) => String(x || '').toLowerCase().replace(/^www./, '').trim();
  const weak = !d.name || !d.image || bare(d.name) === host || bare(d.name) === bare(d.store) || BAD.test(d.name || '');
  if (weak && opts.render !== false) {
    const r = await rendered(final).catch(() => null);
    if (r?.html) {
      final = r.final;
      const d2 = fromHtml(r.html, final);
      d = { name: d2.name || d.name, image: d2.image || d.image || r.bigImg, price: d2.price || d.price, currency: d2.currency || d.currency, store: d2.store || d.store };
    }
  }
  if (BAD.test(d.name || '') || bare(d.name) === host) d.name = null;
  return { url: final.href, name: d.name, image: opts.keepRemote ? d.image : await shrinkImage(d.image), price: d.price, currency: d.currency || currencyOf('', final.hostname), store: d.store };
}

module.exports = { read, parsePrice, fromHtml, safeUrl };

'use strict';
// 1.27: vigilancia de las webs de los clientes.
//  - Uptime: historial por día de cada revisión (cada 5 min) y aviso si va lenta.
//  - Dominios: cuándo vence cada dominio (RDAP, gratis, sin clave).
//  - Contenido vencido: popups y promos de fechas pasadas, © de otro año.
//  - Capturas: foto diaria de la portada (escritorio y celular) y aviso si cambia mucho.
//  - Core Web Vitals: PageSpeed + datos reales de Chrome (CrUX) cada semana.
//  - Horarios: los de la web frente a los de Google (Places API).
//  - Seguridad de los repos: Dependabot, avisos de Next.js y claves subidas por error.
//  - Horas por cliente y changelog del mes (por los commits).
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const DAY = 86400000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ViperTeca-monitor';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const today = () => new Date().toLocaleDateString('sv');
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

// ============================================================ UPTIME
/** Anota el resultado de cada revisión en un historial por día (60 días). */
function recordUptime({ read, write }, results) {
  const h = read('uptime.json', {});
  const d = today();
  const alerts = [];
  for (const r of results) {
    const s = (h[r.url] ||= { days: {}, slow: 0 });
    const day = (s.days[d] ||= { n: 0, ok: 0, ms: 0, msN: 0, down: [] });
    day.n++;
    if (r.up) {
      day.ok++;
      if (r.ms) {
        day.ms += r.ms;
        day.msN++;
      }
    } else if (!day.down.length || Date.now() - day.down[day.down.length - 1].to > 15 * 60000) day.down.push({ from: Date.now(), to: Date.now(), why: r.error || 'HTTP ' + r.status });
    else day.down[day.down.length - 1].to = Date.now();
    // lenta: más de 3 veces lo normal (y más de 3 s) dos veces seguidas
    const base = baseline(s);
    if (r.up && r.ms && base && r.ms > Math.max(3000, base * 3)) {
      s.slow++;
      if (s.slow === 2) alerts.push({ url: r.url, name: r.name, ms: r.ms, base });
    } else s.slow = 0;
    const keys = Object.keys(s.days).sort();
    for (const k of keys.slice(0, -60)) delete s.days[k];
  }
  write('uptime.json', h);
  return alerts;
}
function baseline(s) {
  const days = Object.values(s.days).slice(-7);
  const ms = days.reduce((a, d) => a + d.ms, 0);
  const n = days.reduce((a, d) => a + d.msN, 0);
  return n >= 10 ? Math.round(ms / n) : null;
}
/** Resumen: % de disponibilidad (30 días y este mes), tiempo medio y caídas. */
function uptimeOf(read, url, month = today().slice(0, 7)) {
  const s = read('uptime.json', {})[url];
  if (!s) return null;
  const entries = Object.entries(s.days).sort((a, b) => a[0].localeCompare(b[0]));
  const pct = (list) => {
    const n = list.reduce((a, [, d]) => a + d.n, 0);
    return n ? Math.round((list.reduce((a, [, d]) => a + d.ok, 0) / n) * 10000) / 100 : null;
  };
  const inMonth = entries.filter(([k]) => k.startsWith(month));
  const ms = inMonth.reduce((a, [, d]) => a + d.ms, 0);
  const msN = inMonth.reduce((a, [, d]) => a + d.msN, 0);
  return {
    last30: pct(entries.slice(-30)),
    month: pct(inMonth),
    avgMs: msN ? Math.round(ms / msN) : null,
    incidents: inMonth.flatMap(([k, d]) => d.down.map((x) => ({ day: k, minutes: Math.max(5, Math.round((x.to - x.from) / 60000) + 5), why: x.why }))),
    series: entries.slice(-30).map(([k, d]) => ({ d: k, pct: d.n ? Math.round((d.ok / d.n) * 1000) / 10 : null, ms: d.msN ? Math.round(d.ms / d.msN) : null })),
  };
}

// ============================================================ DOMINIOS
let rdapBoot = null;
/** Vencimiento del dominio por RDAP (caché de 3 días). */
async function domainExpiry({ read, write }, url) {
  const host = hostOf(url);
  const parts = host.split('.');
  // dominio registrable: ejemplo.com, ejemplo.com.ar
  const reg = /^(com|net|org|co|gob|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.')) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
  const cache = read('domains.json', {});
  if (cache[reg] && Date.now() - cache[reg].at < 3 * DAY) return { domain: reg, ...cache[reg] };
  const out = { at: Date.now() };
  try {
    // el servidor RDAP de cada terminación sale de la lista oficial de IANA
    if (!rdapBoot || Date.now() - rdapBoot.at > 7 * DAY) {
      const b = await fetch('https://data.iana.org/rdap/dns.json', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      rdapBoot = { at: Date.now(), map: Object.fromEntries((b.services || []).flatMap(([tlds, urls]) => tlds.map((t) => [t, urls[0]]))) };
    }
    const tld = reg.split('.').pop();
    const base = rdapBoot.map[tld] || 'https://rdap.org/';
    const j = await fetch(base.replace(/\/?$/, '/') + 'domain/' + reg, { headers: { Accept: 'application/rdap+json', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null));
    const ev = (j?.events || []).find((e) => /expiration/i.test(e.eventAction));
    if (ev) out.until = Date.parse(ev.eventDate);
    const registrar = (j?.entities || []).find((e) => (e.roles || []).includes('registrar'));
    out.registrar = registrar?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3] || null;
    if (!ev) out.unknown = true;
  } catch {
    out.unknown = true;
    out.at = Date.now() - 2 * DAY; // reintenta mañana
  }
  cache[reg] = out;
  write('domains.json', cache);
  return { domain: reg, ...out };
}
/** Certificado SSL: días que quedan. */
function sslDays(host) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      resolve(c?.valid_to ? Math.floor((Date.parse(c.valid_to) - Date.now()) / DAY) : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => {
      sock.destroy();
      resolve(null);
    });
  });
}

// ============================================================ CONTENIDO VENCIDO
const MONTHS = {
  january: 1, jan: 1, enero: 1, february: 2, feb: 2, febrero: 2, march: 3, mar: 3, marzo: 3, april: 4, apr: 4, abril: 4, may: 5, mayo: 5, june: 6, jun: 6, junio: 6, july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, september: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9, october: 10, oct: 10, octubre: 10, november: 11, nov: 11, noviembre: 11, december: 12, dec: 12, diciembre: 12,
};
// fiestas: [mes, día] y cuántos días antes se anuncia
const HOLIDAYS = [
  [/halloween|truck[- ]or[- ]treat|d[ií]a de muertos|day of the dead/i, 'Halloween', 10, 31, 50, 3],
  [/thanksgiving|friendsgiving/i, 'Thanksgiving', 11, 27, 40, 2],
  [/black friday|cyber monday/i, 'Black Friday', 11, 28, 30, 4],
  [/christmas|navidad|xmas|nochebuena/i, 'Navidad', 12, 25, 50, 3],
  [/new year'?s eve|nye\b|fin de a[ñn]o|a[ñn]o nuevo/i, 'Año nuevo', 12, 31, 40, 2],
  [/valentine|san valent[ií]n/i, 'San Valentín', 2, 14, 30, 2],
  [/st\.? patrick|san patricio/i, 'St. Patrick', 3, 17, 25, 2],
  [/cinco de mayo/i, 'Cinco de Mayo', 5, 5, 30, 2],
  [/mother'?s day|d[ií]a de las? madres?/i, 'Día de la madre', 5, 10, 30, 2],
  [/father'?s day|d[ií]a del padre/i, 'Día del padre', 6, 15, 25, 2],
  [/4th of july|fourth of july|independence day/i, '4 de julio', 7, 4, 25, 2],
  [/super ?bowl/i, 'Super Bowl', 2, 8, 25, 2],
  [/easter|pascua|semana santa/i, 'Pascua', 4, 5, 30, 3],
];
/** Busca en el texto fechas y fiestas que ya pasaron. */
function staleIn(text, now = new Date()) {
  const out = [];
  const y = now.getFullYear();
  const t = String(text || '');
  const snip = (i, len = 90) => t.slice(Math.max(0, i - 40), i + len).replace(/\s+/g, ' ').trim();
  // © de un año anterior (no si es un rango que llega a este año)
  const cm = t.match(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/i);
  if (cm && Number(cm[1]) < y) out.push({ kind: 'copyright', label: `El pie dice © ${cm[1]}`, snippet: cm[0] });
  // fiestas fuera de temporada
  for (const [re, name, m, d, before, after] of HOLIDAYS) {
    const mm = t.match(re);
    if (!mm) continue;
    let date = new Date(y, m - 1, d);
    if (now - date > 200 * DAY) date = new Date(y + 1, m - 1, d);
    const days = Math.round((date - now) / DAY);
    // en temporada: desde `before` días antes hasta `after` días después
    const prev = new Date(date.getFullYear() - 1, m - 1, d);
    const sincePrev = Math.round((now - prev) / DAY);
    if (days <= before && days >= -after) continue;
    if (sincePrev >= 0 && sincePrev <= after) continue;
    out.push({ kind: 'holiday', label: `Habla de ${name} fuera de temporada`, snippet: snip(mm.index) });
  }
  // fechas concretas pasadas: "October 31", "Oct. 25th", "31 de octubre", "Sat, Oct 25, 2025"
  const re = /\b(?:(\d{1,2})\s+de\s+([a-záé]+)(?:\s+(?:de|del)\s+(20\d{2}))?|([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?)\b/g;
  const seen = new Set();
  for (const m of t.matchAll(re)) {
    const day = Number(m[1] || m[5]);
    const mon = MONTHS[String(m[2] || m[4] || '').toLowerCase()];
    if (!mon || !day || day > 31) continue;
    let year = Number(m[3] || m[6]) || null;
    const ctx = snip(m.index, 110);
    // solo si suena a evento o promo (no "founded in May 2015")
    if (!/event|evento|party|fiesta|special|promo|join us|ac[oó]mpa[ñn]anos|tickets?|reserv|rsvp|live music|m[uú]sica|brunch|dinner|cena|night|noche|pop[- ]?up|tasting|class|clase|until|hasta|valid|v[aá]lido|deadline|last day|[uú]ltimo d[ií]a|submission|inscrip|sign[- ]?up/i.test(ctx)) continue;
    if (!year) {
      year = y;
      // "Jan 5" leído en diciembre es del año que viene
      if (new Date(year, mon - 1, day) - now > 200 * DAY) year--;
      if (now - new Date(year, mon - 1, day) > 300 * DAY) year++;
    }
    const date = new Date(year, mon - 1, day, 23, 59);
    if (date >= now - DAY) continue;
    const k = mon + '-' + day + '-' + year;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: 'date', label: `Fecha pasada: ${day}/${mon}/${year}`, snippet: ctx });
  }
  return out.slice(0, 8);
}

/** Abre la web (portada + páginas de eventos/promos) y busca contenido vencido. */
async function staleContent(url) {
  const { BrowserWindow, session } = require('electron');
  const ses = session.fromPartition('vt-stale');
  ses.setUserAgent(UA);
  const w = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences: { session: ses, sandbox: true, backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const found = [];
  const read = async (u) => {
    await Promise.race([w.loadURL(u), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]).catch(() => null);
    await new Promise((r) => setTimeout(r, 4500));
    return w.webContents
      .executeJavaScript(`(() => ({
        text: [document.body?.innerText || '', ...[...document.querySelectorAll('[role=dialog], dialog, .modal, .popup, [class*="popup"], [class*="modal"]')].map((e) => e.textContent || '')].join('\\n').slice(0, 60000),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /event|evento|special|promo|happening|calendar|whats-on|news/i.test(h))
      }))()`)
      .catch(() => ({ text: '', links: [] }));
  };
  try {
    const home = await read(url);
    for (const s of staleIn(home.text)) found.push({ ...s, page: url });
    const host = hostOf(url);
    const more = [...new Set(home.links.filter((h) => hostOf(h) === host))].slice(0, 3);
    for (const u of more) for (const s of staleIn((await read(u)).text)) if (!found.some((f) => f.label === s.label)) found.push({ ...s, page: u });
  } finally {
    if (!w.isDestroyed()) w.destroy();
    await ses.clearStorageData().catch(() => {});
  }
  return found;
}

// ============================================================ CAPTURAS
async function capture(url, mobile) {
  const { BrowserWindow, session } = require('electron');
  const ses = session.fromPartition('vt-shots');
  const w = new BrowserWindow({ show: false, width: mobile ? 390 : 1366, height: mobile ? 844 : 900, webPreferences: { session: ses, sandbox: true, backgroundThrottling: false, offscreen: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([w.loadURL(url, { userAgent: mobile ? UA_MOBILE : UA }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]).catch(() => null);
    await new Promise((r) => setTimeout(r, 6000));
    // sin animaciones ni vídeos para comparar mejor
    await w.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}video{visibility:hidden!important}').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    return await w.webContents.capturePage();
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
}
/** Diferencia entre dos imágenes (0 = iguales, 1 = nada que ver), por bloques en gris. */
function diff(a, b) {
  const S = { width: 48, height: 64 };
  const x = a.resize(S).toBitmap();
  const y = b.resize(S).toBitmap();
  if (x.length !== y.length) return 1;
  let sum = 0;
  for (let i = 0; i < x.length; i += 4) {
    const g1 = (x[i] + x[i + 1] + x[i + 2]) / 3;
    const g2 = (y[i] + y[i + 1] + y[i + 2]) / 3;
    sum += Math.abs(g1 - g2) / 255;
  }
  return sum / (x.length / 4);
}
/** Foto del día de una web (escritorio y celular) y comparación con la anterior. */
async function dailyShots(dir, site) {
  const { nativeImage } = require('electron');
  const host = hostOf(site.url);
  const d = path.join(dir, host);
  fs.mkdirSync(d, { recursive: true });
  const day = today();
  const res = { url: site.url, name: site.name, host, day, views: {} };
  for (const [k, mobile] of [['d', false], ['m', true]]) {
    const file = path.join(d, day + '-' + k + '.jpg');
    let img;
    try {
      img = await capture(site.url, mobile);
    } catch {
      continue;
    }
    if (!img || img.isEmpty()) continue;
    fs.writeFileSync(file, img.resize({ width: mobile ? 390 : 683 }).toJPEG(72));
    const prev = fs.readdirSync(d).filter((f) => f.endsWith('-' + k + '.jpg') && f < day + '-' + k + '.jpg').sort().pop();
    const v = { file, prev: prev ? path.join(d, prev) : null, change: null };
    if (prev) v.change = Math.round(diff(img, nativeImage.createFromPath(path.join(d, prev))) * 1000) / 10;
    res.views[k] = v;
  }
  // solo 10 días por web
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.jpg')).sort();
  for (const f of files.slice(0, -20)) fs.rmSync(path.join(d, f), { force: true });
  return res;
}

// ============================================================ CORE WEB VITALS
/** CrUX (datos reales de Chrome, últimos 28 días) para el celular. */
async function crux(key, url) {
  const origin = new URL(url).origin;
  const r = await fetch('https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin, formFactor: 'PHONE' }), signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return { none: true }; // poco tráfico: Chrome no tiene datos
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error('CrUX: ' + String(j.error.message || j.error.status).slice(0, 120));
  const m = j.record?.metrics || {};
  const p75 = (k) => {
    const v = m[k]?.percentiles?.p75;
    return v == null ? null : Number(v);
  };
  return { lcp: p75('largest_contentful_paint'), inp: p75('interaction_to_next_paint'), cls: p75('cumulative_layout_shift'), fcp: p75('first_contentful_paint'), ttfb: p75('experimental_time_to_first_byte') };
}
function recordCwv({ read, write }, url, point) {
  const h = read('cwv.json', {});
  const list = (h[url] ||= []);
  list.push({ at: Date.now(), ...point });
  if (list.length > 26) list.splice(0, list.length - 26);
  write('cwv.json', h);
  return list;
}

// ============================================================ HORARIOS (Google)
async function googlePlaces(key, name, url) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.regularOpeningHours.weekdayDescriptions,places.businessStatus' },
    body: JSON.stringify({ textQuery: name + ' restaurant', languageCode: 'en' }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error('Google Places: ' + String(j.error.message).slice(0, 140));
  const host = hostOf(url);
  // solo los locales cuya web es la misma (cadenas con varios locales)
  return (j.places || []).filter((p) => p.websiteUri && hostOf(p.websiteUri) === host).map((p) => ({ name: p.displayName?.text, address: p.formattedAddress, hours: p.regularOpeningHours?.weekdayDescriptions || [], status: p.businessStatus }));
}
/** Líneas de la web que hablan de horarios (para comparar). */
async function webHoursText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }).then((x) => x.text()).catch(() => '');
  const ld = [...r.matchAll(/"openingHours(?:Specification)?"\s*:\s*(\[[\s\S]*?\]|"[^"]*")/g)].map((m) => m[1]).join('\n').slice(0, 3000);
  const text = r.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;|&amp;/g, ' ');
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  const hit = [];
  lines.forEach((l, i) => {
    if (/\b(mon|tue|wed|thu|fri|sat|sun|lun|mar|mi[eé]|jue|vie|s[aá]b|dom)[a-z]*\b|\d{1,2}(:\d{2})?\s*(am|pm)\b|hours|horario/i.test(l) && l.length < 140) hit.push(...lines.slice(i, i + 2));
  });
  return [ld, [...new Set(hit)].slice(0, 60).join('\n')].filter(Boolean).join('\n');
}

// ============================================================ SEGURIDAD DE LOS REPOS
const SECRET_RE = [
  [/AKIA[0-9A-Z]{16}/, 'clave de AWS'],
  [/sk_live_[0-9a-zA-Z]{20,}/, 'clave secreta de Stripe'],
  [/AIza[0-9A-Za-z\-_]{35}/, 'clave de Google'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'llave privada'],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/, 'token de Slack'],
  [/gh[pousr]_[0-9A-Za-z]{30,}/, 'token de GitHub'],
  [/SG\.[0-9A-Za-z\-_]{20,}\.[0-9A-Za-z\-_]{20,}/, 'clave de SendGrid'],
  [/(?:supabase|service_role)[^\n]{0,30}eyJ[0-9A-Za-z\-_]{30,}\.[0-9A-Za-z\-_]{20,}/i, 'clave de servicio de Supabase'],
  [/re_[0-9A-Za-z]{8}_[0-9A-Za-z]{20,}/, 'clave de Resend'],
];
/**
 * gh: función que llama a la API de GitHub. Revisa los repos con actividad en 30 días.
 * Devuelve [{ repo, dependabot: [{pkg, sev, summary}], next: {version, advisories}, secrets: [{sha, file, what}] }]
 */
async function repoSecurity(gh, org, { pool }) {
  const repos = (await gh('orgs/' + org + '/repos?per_page=100&sort=pushed')).filter((r) => /^website-/.test(r.name) && !r.archived && Date.now() - Date.parse(r.pushed_at) < 30 * DAY);
  const out = [];
  const advCache = {};
  await pool(repos.slice(0, 50), 4, async (r) => {
    const x = { repo: r.name, url: r.html_url, dependabot: [], next: null, secrets: [] };
    const dep = await gh('repos/' + org + '/' + r.name + '/dependabot/alerts?state=open&per_page=50').catch(() => null);
    if (Array.isArray(dep)) x.dependabot = dep.filter((a) => /high|critical/.test(a.security_advisory?.severity)).map((a) => ({ pkg: a.dependency?.package?.name, sev: a.security_advisory?.severity, summary: a.security_advisory?.summary, url: a.html_url }));
    else x.dependabotOff = true;
    const pkg = await gh('repos/' + org + '/' + r.name + '/contents/package.json').catch(() => null);
    if (pkg?.content) {
      try {
        const j = JSON.parse(Buffer.from(pkg.content, 'base64').toString('utf8'));
        const v = String(j.dependencies?.next || '').replace(/^[\^~>=\s]+/, '');
        if (/^\d+\.\d+\.\d+/.test(v)) {
          if (!advCache[v]) advCache[v] = await gh('advisories?ecosystem=npm&affects=' + encodeURIComponent('next@' + v) + '&per_page=30').catch(() => []);
          const adv = (advCache[v] || []).filter((a) => /high|critical/.test(a.severity));
          const major = v.split('.')[0];
          const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - Number(b.split('.')[i] || 0), 0);
          // la versión arreglada de la misma rama (16.x → 16.3.8), no la de 15.x
          const fixedOf = (a) => (a.vulnerabilities || []).filter((q) => q.package?.name === 'next' && q.first_patched_version && q.first_patched_version.split('.')[0] === major).map((q) => q.first_patched_version)[0] || null;
          const list = adv.map((a) => ({ id: a.ghsa_id, sev: a.severity, summary: a.summary, fixed: fixedOf(a), url: a.html_url }));
          const target = list.map((a) => a.fixed).filter(Boolean).sort(cmp).pop() || null;
          x.next = { version: v, target, critical: list.filter((a) => a.sev === 'critical').length, advisories: list };
        }
      } catch {}
    }
    // claves en los commits de la última semana
    const commits = await gh('repos/' + org + '/' + r.name + '/commits?per_page=30&since=' + new Date(Date.now() - 7 * DAY).toISOString()).catch(() => []);
    for (const c of commits.slice(0, 20)) {
      const full = await gh('repos/' + org + '/' + r.name + '/commits/' + c.sha).catch(() => null);
      for (const f of full?.files || []) {
        if (/(^|\/)\.env(\.[a-z]+)?$/i.test(f.filename) && !/example|sample|template/i.test(f.filename) && f.status !== 'removed') x.secrets.push({ sha: c.sha.slice(0, 7), file: f.filename, what: 'archivo .env subido al repo', url: full.html_url });
        for (const [re, what] of SECRET_RE) {
          const added = String(f.patch || '').split('\n').filter((l) => l.startsWith('+')).join('\n');
          if (re.test(added)) x.secrets.push({ sha: c.sha.slice(0, 7), file: f.filename, what, url: full.html_url });
        }
      }
    }
    if (x.dependabot.length || x.next?.advisories.length || x.secrets.length) out.push(x);
  });
  return out;
}

// ============================================================ HORAS Y CHANGELOG
/** Commits de un mes por repo (los repos con actividad). */
async function monthCommits(gh, org, month, { pool }) {
  const [y, m] = month.split('-').map(Number);
  const since = new Date(y, m - 1, 1).toISOString();
  const until = new Date(y, m, 1).toISOString();
  const repos = (await gh('orgs/' + org + '/repos?per_page=100&sort=pushed')).filter((r) => /^website-/.test(r.name) && Date.parse(r.pushed_at) >= Date.parse(since));
  const out = {};
  await pool(repos.slice(0, 80), 6, async (r) => {
    const list = await gh('repos/' + org + '/' + r.name + '/commits?per_page=100&since=' + since + '&until=' + until).catch(() => []);
    if (list.length) out[r.name] = list.map((c) => ({ login: c.author?.login || c.commit?.author?.name || '?', at: Date.parse(c.commit?.author?.date), msg: String(c.commit?.message || '').split('\n')[0].slice(0, 140) }));
  });
  return out;
}
/**
 * Horas aproximadas por repo: los commits de una persona separados por menos de
 * 2 h son una sesión; cada sesión cuenta lo que duró + 30 min de arranque.
 */
function hoursOf(commits) {
  const byWho = {};
  for (const c of commits) (byWho[c.login] ||= []).push(c.at);
  let total = 0;
  const who = {};
  for (const [login, times] of Object.entries(byWho)) {
    times.sort((a, b) => a - b);
    let h = 0;
    let start = times[0];
    let last = times[0];
    for (const t of times.slice(1)) {
      if (t - last > 2 * 3600000) {
        h += (last - start) / 3600000 + 0.5;
        start = t;
      }
      last = t;
    }
    h += (last - start) / 3600000 + 0.5;
    who[login] = Math.round(h * 10) / 10;
    total += h;
  }
  return { total: Math.round(total * 10) / 10, who };
}

module.exports = { recordUptime, uptimeOf, domainExpiry, sslDays, staleIn, staleContent, dailyShots, crux, recordCwv, googlePlaces, webHoursText, repoSecurity, monthCommits, hoursOf, hostOf };

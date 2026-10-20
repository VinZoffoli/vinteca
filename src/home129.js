'use strict';
// 1.29: suscripciones, insumos de los gatitos y el vehículo (cálculos y avisos),
// y el correo personal (solo lectura) para encontrar facturas y cobros de suscripciones.
const { safeStorage } = require('electron');
const mail = require('./mail');

const DAY = 86400000;
const iso = (t) => new Date(t).toLocaleDateString('sv');
const day0 = (t = Date.now()) => new Date(t).setHours(0, 0, 0, 0);

// ============================================================ SUSCRIPCIONES
function advance(next, period) {
  const d = new Date(next + 'T12:00:00');
  if (period === 'año') d.setFullYear(d.getFullYear() + 1);
  else if (period === 'semana') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return iso(d);
}
const perMonth = (s) => (s.amount ? (s.period === 'año' ? s.amount / 12 : s.period === 'semana' ? (s.amount * 52) / 12 : s.amount) : 0);
/** Total al mes en colones (los dólares con el tipo de cambio del día) y próximas renovaciones. */
function subsSummary(subs, rate) {
  const act = (subs || []).filter((s) => s.active);
  const crc = (s) => (s.currency === 'CRC' ? perMonth(s) : s.currency === 'USD' && rate ? perMonth(s) * rate : null);
  const total = act.reduce((a, s) => a + (crc(s) || 0), 0);
  const usd = act.filter((s) => s.currency === 'USD').reduce((a, s) => a + perMonth(s), 0);
  return { total: Math.round(total), usd: Math.round(usd * 100) / 100, count: act.length, year: Math.round(total * 12), next: act.filter((s) => s.next).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 6) };
}

// ============================================================ INSUMOS DE LOS GATITOS
/** Días que le quedan a una bolsa (comida, arena…) según lo que se usa al día. */
function supplyLeft(x, now = Date.now()) {
  if (!x.size || !x.perDay || !x.openedAt) return null;
  const total = x.unit === 'kg' || x.unit === 'l' ? x.size * 1000 : x.size; // g / ml / unidades
  const lasts = total / x.perDay;
  const used = (day0(now) - day0(new Date(x.openedAt + 'T12:00:00').getTime())) / DAY;
  const left = Math.floor(lasts - used);
  return { lasts: Math.round(lasts), left, runsOut: iso(new Date(x.openedAt + 'T12:00:00').getTime() + lasts * DAY) };
}

// ============================================================ VEHÍCULO
function vehicleStats(v, now = Date.now()) {
  if (!v) return null;
  const fuel = (v.fuel || []).filter((f) => f.date).sort((a, b) => a.date.localeCompare(b.date) || (a.km || 0) - (b.km || 0));
  const kmNow = Math.max(0, ...fuel.map((f) => f.km || 0)) || null;
  // consumo: entre dos tanques llenos, km recorridos / litros cargados después del primero
  const cons = [];
  let lastFull = null;
  let liters = 0;
  for (const f of fuel) {
    if (lastFull && f.km && lastFull.km) liters += f.liters || 0;
    if (f.full && f.km) {
      if (lastFull && liters > 0 && f.km > lastFull.km) cons.push({ date: f.date, kmL: Math.round(((f.km - lastFull.km) / liters) * 10) / 10 });
      lastFull = f;
      liters = 0;
    }
  }
  const since = iso(now - 30 * DAY);
  const month = fuel.filter((f) => f.date >= since).reduce((a, f) => a + (f.amount || 0), 0);
  const avg = cons.length ? Math.round((cons.slice(-5).reduce((a, c) => a + c.kmL, 0) / Math.min(5, cons.length)) * 10) / 10 : null;
  const services = (v.services || []).map((s) => {
    const kmLeft = s.everyKm && s.lastKm && kmNow ? s.lastKm + s.everyKm - kmNow : null;
    let daysLeft = null;
    if (s.everyMonths && s.lastDate) {
      const d = new Date(s.lastDate + 'T12:00:00');
      d.setMonth(d.getMonth() + s.everyMonths);
      daysLeft = Math.round((day0(d.getTime()) - day0(now)) / DAY);
    }
    const due = (kmLeft != null && kmLeft <= 500) || (daysLeft != null && daysLeft <= 14);
    return { ...s, kmLeft, daysLeft, due };
  });
  return { kmNow, avgKmL: avg, consumption: cons.slice(-12), last30: Math.round(month), services, fills: fuel.length };
}

// ============================================================ AVISOS
/**
 * Avisos del día y cambios a guardar: renovaciones (3 días antes y el día; luego se
 * pasa la fecha a la siguiente), bolsa que se acaba (5 días antes, y se añade a la
 * lista de compras) y mantenimientos del vehículo.
 */
function notices(d, now = Date.now()) {
  const out = [];
  let changed = false;
  const today = iso(now);
  for (const s of d.subscriptions || []) {
    if (!s.active || !s.next) continue;
    while (s.next < today) {
      s.next = advance(s.next, s.period);
      changed = true;
    }
    const days = Math.round((day0(new Date(s.next + 'T12:00:00').getTime()) - day0(now)) / DAY);
    if (days === 3 || days === 0) out.push({ key: 'sub:' + s.id + ':' + s.next + ':' + days, title: days ? s.name + ' se renueva en 3 días' : s.name + ' se renueva hoy', body: (s.amount ? (s.currency === 'USD' ? '$' : '₡') + s.amount.toLocaleString('es') + ' ' : '') + (s.period === 'año' ? 'al año' : s.period === 'semana' ? 'a la semana' : 'al mes') + '. Si ya no la usas, cancélala antes.' });
  }
  for (const x of d.catSupplies || []) {
    const l = supplyLeft(x, now);
    if (!l || l.left > 5) continue;
    const key = 'sup:' + x.id + ':' + x.openedAt;
    if (x.warnedFor === x.openedAt) continue;
    x.warnedFor = x.openedAt;
    changed = true;
    let added = false;
    if (x.autoShop) {
      d.shopping ||= [];
      const name = x.name + ' de los gatitos';
      if (!d.shopping.some((y) => !y.done && y.name.toLowerCase() === name.toLowerCase())) {
        d.shopping.push({ id: Math.random().toString(16).slice(2, 14), name, qty: x.size ? x.size + ' ' + x.unit : '', cat: (d.shopCats || []).find((c) => /mascota|gato/i.test(c)) || d.shopCats?.[0] || 'Súper', done: false, at: now, price: x.price || null });
        added = true;
      }
    }
    out.push({ key, title: (l.left <= 0 ? 'Se acabó' : 'Se acaba') + ' ' + x.name.toLowerCase() + ' de los gatitos', body: (l.left > 0 ? 'Quedan unos ' + l.left + ' días. ' : '') + (added ? 'Lo añadí a la lista de compras.' : 'Cómprala pronto.') });
  }
  const vs = vehicleStats(d.vehicle, now);
  for (const s of vs?.services || []) {
    if (!s.due) continue;
    const mark = (s.lastKm || '') + '|' + (s.lastDate || '');
    if (s.warned === mark) continue;
    const orig = d.vehicle.services.find((y) => y.id === s.id);
    if (orig) orig.warned = mark;
    changed = true;
    out.push({ key: 'veh:' + s.id + ':' + mark, title: 'Toca ' + s.name.toLowerCase() + (d.vehicle.name ? ' del ' + d.vehicle.name : ''), body: [s.kmLeft != null ? (s.kmLeft > 0 ? 'faltan ' + s.kmLeft.toLocaleString('es') + ' km' : 'se pasó por ' + (-s.kmLeft).toLocaleString('es') + ' km') : null, s.daysLeft != null ? (s.daysLeft > 0 ? 'en ' + s.daysLeft + ' días' : 'ya toca por fecha') : null].filter(Boolean).join(' · ') });
  }
  return { out, changed };
}

// ============================================================ CORREO PERSONAL
const DEFAULT = { host: 'imap.gmail.com', port: 993, user: '' };
function account(read) {
  const s = read('settings.json', {});
  return { ...DEFAULT, ...(s.billMail || {}), hasPassword: !!s.billMailPassEnc };
}
function setAccount({ read, write }, a) {
  const s = read('settings.json', {});
  if (a.forget) {
    delete s.billMail;
    delete s.billMailPassEnc;
    write('settings.json', s);
    return account(read);
  }
  const user = String(a.user || '').trim().slice(0, 120);
  const host = String(a.host || DEFAULT.host).trim().toLowerCase();
  if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(user)) throw new Error('Ese correo no parece válido.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new Error('Ese servidor no parece válido.');
  s.billMail = { user, host, port: Math.max(1, Math.min(65535, Number(a.port) || 993)) };
  if (a.password) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
    s.billMailPassEnc = safeStorage.encryptString(String(a.password)).toString('base64');
  }
  write('settings.json', s);
  return account(read);
}
function password(read) {
  const s = read('settings.json', {});
  if (!s.billMailPassEnc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.billMailPassEnc, 'base64'));
  } catch {
    return null;
  }
}
// cuerpo de un correo MIME a texto (text/plain o, si no hay, text/html sin etiquetas)
function bodyText(raw) {
  const s = String(raw || '');
  const decodePart = (headersPart, body) => {
    const cs = (headersPart.match(/charset="?([\w-]+)/i) || [])[1] || 'utf-8';
    let buf;
    if (/content-transfer-encoding:\s*base64/i.test(headersPart)) buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
    else if (/content-transfer-encoding:\s*quoted-printable/i.test(headersPart)) buf = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
    else buf = Buffer.from(body, 'binary');
    try {
      return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'windows-1252').decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  };
  const parts = [];
  const walk = (chunk) => {
    const i = chunk.search(/\r?\n\r?\n/);
    const head = i >= 0 ? chunk.slice(0, i) : '';
    const body = i >= 0 ? chunk.slice(i).replace(/^\r?\n\r?\n/, '') : chunk;
    const b = (head.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
    if (b) {
      for (const p of body.split('--' + b).slice(1)) if (!/^--/.test(p)) walk(p.replace(/^\r?\n/, ''));
    } else parts.push({ html: /text\/html/i.test(head), text: decodePart(head, body) });
  };
  walk(s);
  const plain = parts.find((p) => !p.html && p.text.trim());
  const html = parts.find((p) => p.html);
  const t = plain ? plain.text : html ? html.text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/tr>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))) : '';
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
/**
 * Correos de los últimos `days` días que parecen facturas o cobros de suscripciones
 * (por el asunto), con un extracto del texto. Solo lectura: no marca nada.
 */
async function scan({ read }, { days = 45, max = 40 } = {}) {
  const a = account(read);
  const pass = password(read);
  if (!a.user || !pass) throw new Error('Conecta tu correo personal (con una contraseña de aplicación).');
  const c = new mail.Imap(a.host, a.port);
  await c.connect();
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  try {
    try {
      await c.cmd('LOGIN ' + q(a.user) + ' ' + q(pass));
    } catch (e) {
      throw new Error(e.imap ? 'El servidor rechazó el correo o la contraseña (en Gmail usa una contraseña de aplicación).' : e.message);
    }
    await c.cmd('EXAMINE INBOX');
    const since = new Date(Date.now() - days * DAY);
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sinceS = since.getDate() + '-' + M[since.getMonth()] + '-' + since.getFullYear();
    const words = ['factura', 'recibo', 'receipt', 'invoice', 'suscripci', 'subscription', 'renov', 'membership', 'membresía', 'payment', 'pago', 'cobro', 'billing', 'estado de cuenta'];
    // OR anidado: (OR SUBJECT a (OR SUBJECT b …))
    const or = words.reduceRight((acc, w) => (acc ? 'OR SUBJECT ' + q(w) + ' ' + acc : 'SUBJECT ' + q(w)), '');
    const lines = await c.cmd('UID SEARCH SINCE ' + sinceS + ' ' + or);
    const uids = ((lines.find((l) => /^\* SEARCH/.test(l.text))?.text || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).map(Number)).slice(-max);
    const out = [];
    for (const uid of uids) {
      const f = await c.cmd('UID FETCH ' + uid + ' (INTERNALDATE BODY.PEEK[]<0.60000>)').catch(() => []);
      const l = f.find((x) => x.literal);
      if (!l) continue;
      const raw = l.literal;
      const hd = mail.headers(raw.split(/\r?\n\r?\n/)[0]);
      const idate = (l.text.match(/INTERNALDATE "([^"]+)"/) || [])[1];
      out.push({ uid, from: hd.from || '', subject: hd.subject || '', date: Date.parse(idate || hd.date || '') || null, text: bodyText(raw).slice(0, 2500) });
    }
    return out;
  } finally {
    c.close();
  }
}

module.exports = { advance, subsSummary, supplyLeft, vehicleStats, notices, account, setAccount, scan, bodyText, perMonth };

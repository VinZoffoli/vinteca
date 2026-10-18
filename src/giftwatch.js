'use strict';
// 1.26: vigilancia de los regalos.
//  - Precios: una vez al día se vuelve a leer el precio de cada regalo con enlace
//    (idea todavía sin comprar). Se guarda el historial y se avisa si baja.
//  - Fechas: antes del cumpleaños de Emi, de Navidad, del aniversario (y las
//    fechas que añadas) avisa qué deseos suyos siguen sin comprar y cuánto suman.
const DAY = 86400000;
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const sym = (c) => (c === 'USD' ? '$' : c === 'CRC' ? '₡' : c === 'EUR' ? '€' : '');
const fmt = (v, c) => sym(c) + Number(v).toLocaleString('es', { maximumFractionDigits: 2 }) + (sym(c) ? '' : ' ' + (c || ''));

/** Regalos que se vigilan: ideas con enlace que no están ocultas. */
const watched = (c) => (c.gifts || []).filter((g) => g.status === 'idea' && g.link && !g.hide && !g.reading);

/**
 * Revisa los precios (máx. `limit` por vez, el que lleva más tiempo sin revisar primero).
 * deps: { read, write, loadCasa, saveCasa, readMeta, notify }
 */
async function checkPrices(deps, { limit = 25, force = false } = {}) {
  const hist = deps.read('gift-prices.json', {});
  const today = new Date().toLocaleDateString('sv');
  const c0 = deps.loadCasa();
  const queue = watched(c0)
    .filter((g) => force || (hist[g.id]?.checked || '') !== today)
    .sort((a, b) => String(hist[a.id]?.checked || '').localeCompare(String(hist[b.id]?.checked || '')))
    .slice(0, limit);
  const drops = [];
  for (const g of queue) {
    let meta = null;
    try {
      meta = await deps.readMeta(g.link);
    } catch {}
    const h = (hist[g.id] ||= { points: [] });
    h.checked = today;
    if (!meta || meta.price == null) continue;
    const pts = h.points;
    // si la tienda cambia de moneda (p. ej. por la región) se empieza de cero
    if (pts.length && pts[pts.length - 1].c && meta.currency && pts[pts.length - 1].c !== meta.currency) pts.length = 0;
    const prev = pts.length ? pts[pts.length - 1].v : g.price ?? null;
    const last = pts[pts.length - 1];
    if (last && last.d === today) last.v = meta.price;
    else pts.push({ d: today, v: meta.price, c: meta.currency || g.currency || null });
    if (pts.length > 180) pts.splice(0, pts.length - 180);
    // se guarda en el regalo el precio de hoy y, si bajó, cuánto
    const c = deps.loadCasa();
    const gift = (c.gifts || []).find((x) => x.id === g.id);
    if (!gift) continue;
    gift.price = meta.price;
    gift.currency = meta.currency || gift.currency || null;
    const top = Math.max(...pts.map((p) => p.v));
    if (prev != null && meta.price < prev * 0.97) {
      const pct = Math.round((1 - meta.price / prev) * 100);
      gift.drop = { from: prev, pct, at: Date.now() };
      drops.push({ gift, from: prev, pct, low: meta.price <= Math.min(...pts.map((p) => p.v)) });
    } else if (gift.drop && meta.price >= top) gift.drop = null; // volvió a subir
    deps.saveCasa(c);
  }
  deps.write('gift-prices.json', hist);
  for (const d of drops.slice(0, 4)) {
    const g = d.gift;
    deps.notify(`Bajó ${d.pct}%: ${g.name}`, `${fmt(d.from, g.currency)} → ${fmt(g.price, g.currency)}${d.low ? ' · el más bajo que he visto' : ''}${g.by === 'Emi' ? ' · de la lista de Emi' : ''}`, g.link);
  }
  if (drops.length > 4) deps.notify(`Bajaron ${drops.length} regalos`, drops.slice(4).map((d) => d.gift.name).join(', '), null);
  return { checked: queue.length, drops: drops.length };
}

const historyOf = (read, id) => read('gift-prices.json', {})[id]?.points || [];

/** Próxima vez que cae un día/mes desde hoy. */
function nextOn(day, month, now = Date.now()) {
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  let d = new Date(t.getFullYear(), month - 1, day);
  if (d < t) d = new Date(t.getFullYear() + 1, month - 1, day);
  return { date: d.getTime(), days: Math.round((d - t) / DAY) };
}

/**
 * Fechas importantes de cada persona con regalos: su cumpleaños (de Cumpleaños),
 * Navidad y las que añadas en Regalos (aniversario, día de la madre…).
 */
function dates(c, now = Date.now()) {
  const out = [];
  for (const p of c.giftPeople || ['Emi']) {
    const bd = (c.birthdays || []).find((b) => b.kind !== 'gato' && (plain(b.name) === plain(p) || plain(b.name).startsWith(plain(p)) || plain(p).startsWith(plain(b.name).split(' ')[0])));
    if (bd?.day && bd?.month) out.push({ key: 'bd:' + p, name: 'Cumpleaños de ' + p, for: p, ...nextOn(bd.day, bd.month, now) });
  }
  out.push({ key: 'navidad', name: 'Navidad', for: 'Emi', ...nextOn(25, 12, now) });
  for (const x of c.giftDates || []) out.push({ key: 'd:' + x.id, name: x.name, for: x.for || 'Emi', ...nextOn(x.day, x.month, now) });
  return out.sort((a, b) => a.days - b.days);
}

/** Deseos sin comprar de una persona y cuánto suman (por moneda y, aprox., en colones). */
function wishes(c, who, rate) {
  const list = (c.gifts || []).filter((g) => g.status === 'idea' && !g.hide && plain(g.for) === plain(who));
  const theirs = list.filter((g) => g.by === 'Emi');
  const sum = {};
  for (const g of list) if (g.price) sum[g.currency || 'CRC'] = (sum[g.currency || 'CRC'] || 0) + g.price;
  const crc = rate ? Object.entries(sum).reduce((a, [cur, v]) => a + (cur === 'CRC' ? v : cur === 'USD' ? v * rate : 0), 0) : null;
  return { list, theirs, sum, crc: crc ? Math.round(crc) : null, text: Object.entries(sum).map(([cur, v]) => fmt(Math.round(v * 100) / 100, cur)).join(' + ') };
}

/** Avisos 21, 7 y 2 días antes de cada fecha. */
function checkDates(deps, rate) {
  const c = deps.loadCasa();
  const sent = deps.read('gift-dates-sent.json', {});
  let n = 0;
  for (const d of dates(c)) {
    if (![21, 7, 2].includes(d.days)) continue;
    const key = d.key + ':' + new Date(d.date).getFullYear() + ':' + d.days;
    if (sent[key]) continue;
    sent[key] = Date.now();
    const w = wishes(c, d.for, rate);
    const body = w.list.length
      ? `${w.list.length} ${w.list.length === 1 ? 'deseo sin comprar' : 'deseos sin comprar'}${w.text ? ', suman ' + w.text : ''}${w.crc && Object.keys(w.sum).length > 1 ? ' (≈ ₡' + w.crc.toLocaleString('es') + ')' : ''}: ${w.list.slice(0, 3).map((g) => g.name).join(', ')}${w.list.length > 3 ? '…' : ''}.`
      : `No hay ideas anotadas para ${d.for}. Pídele que añada algo a su lista.`;
    deps.notify(`Faltan ${d.days} días: ${d.name}`, body, null);
    n++;
  }
  deps.write('gift-dates-sent.json', sent);
  return n;
}

module.exports = { checkPrices, historyOf, dates, wishes, checkDates, nextOn };

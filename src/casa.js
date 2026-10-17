// Casa: lista de compras, pagos del mes, recordatorios, cumpleaños y feriados.
// Todo se guarda en casa.json (en este PC). Los feriados nacionales de
// Estados Unidos, Argentina y Costa Rica vienen de Nager.Date (no se editan).
const crypto = require('crypto');

const id = () => crypto.randomBytes(6).toString('hex');
const COUNTRIES = { US: 'Estados Unidos', AR: 'Argentina', CR: 'Costa Rica' };

function seed() {
  // Si el día de pago de este mes ya pasó, se da por pagado (para no empezar con atrasos)
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const p = (name, group, day = null) => ({ id: id(), name, group, day, amount: null, currency: 'CRC', notifyDays: 3, paid: day && day < now.getDate() ? { [thisMonth]: Date.now() } : {} });
  const b = (name, kind, day, month, note = '') => ({ id: id(), name, kind, day, month, year: null, note });
  return {
    version: 1,
    shopping: [],
    shopCats: ['Súper', 'Verdulería', 'Carnicería', 'Limpieza', 'Gatos', 'Farmacia', 'Otros'],
    payments: [
      p('Alquiler', 'Personal', 10),
      p('Agua', 'Personal'),
      p('Luz', 'Personal'),
      p('Internet', 'Personal'),
      p('Alquiler', 'Abuela'),
      p('Luz', 'Abuela'),
      p('Internet', 'Abuela'),
      p('Lavado de ropa', 'Abuelo'),
    ],
    payGroups: ['Personal', 'Abuela', 'Abuelo'],
    reminders: [{ id: id(), title: 'Mi madre viene de visita', date: '2026-11-28', note: '', notifyDays: 1, done: false }],
    birthdays: [
      b('Vincenzo', 'persona', 7, 2, 'Yo'),
      b('Emily', 'persona', 5, 3),
      b('Keylor', 'persona', 14, 9),
      b('Abuela Estrella', 'persona', 6, 1),
      b('Mamá', 'persona', 9, 1),
      b('Stefano', 'persona', 31, 12, 'Mi hermano'),
      b('Brian', 'persona', 30, 7, 'Amigo'),
      b('Don José', 'persona', 24, 1),
      b('Toshi', 'gato', 25, 7),
      b('Hoshi', 'gato', 1, 11),
      b('Zekrom', 'gato', 13, 4),
      b('Pelcky', 'gato', 24, 2),
      b('Telcky', 'gato', null, 8, 'Día por confirmar'),
    ],
    holidayCountries: ['US', 'AR', 'CR'],
  };
}

function load({ read, write }) {
  let d = read('casa.json', null);
  if (!d) {
    d = seed();
    write('casa.json', d);
  }
  return d;
}

// Validación ligera de lo que llega de la ventana
const str = (v, n = 120) => String(v ?? '').slice(0, n).trim();
const intOr = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
function save({ write }, d) {
  const clean = {
    version: 1,
    shopCats: (d.shopCats || []).map((x) => str(x, 40)).filter(Boolean).slice(0, 30),
    payGroups: (d.payGroups || []).map((x) => str(x, 40)).filter(Boolean).slice(0, 30),
    holidayCountries: (d.holidayCountries || []).filter((c) => COUNTRIES[c]),
    shopping: (d.shopping || []).slice(0, 500).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name), qty: str(x.qty, 30), cat: str(x.cat, 40), done: !!x.done, at: Number(x.at) || Date.now() })).filter((x) => x.name),
    payments: (d.payments || []).slice(0, 200).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name), group: str(x.group, 40) || 'Personal', day: intOr(x.day, 1, 31), amount: x.amount === '' || x.amount == null ? null : Number(x.amount) || null, currency: str(x.currency, 5) || 'CRC', notifyDays: intOr(x.notifyDays, 0, 30) ?? 3, note: str(x.note, 300), paid: Object.fromEntries(Object.entries(x.paid || {}).filter(([k]) => /^\d{4}-\d{2}$/.test(k)).slice(-36)) })).filter((x) => x.name),
    reminders: (d.reminders || []).slice(0, 500).map((x) => ({ id: str(x.id, 20) || id(), title: str(x.title, 160), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null, time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '', note: str(x.note, 500), notifyDays: intOr(x.notifyDays, 0, 60) ?? 1, done: !!x.done })).filter((x) => x.title && x.date),
    birthdays: (d.birthdays || []).slice(0, 500).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name, 80), kind: x.kind === 'gato' ? 'gato' : 'persona', day: intOr(x.day, 1, 31), month: intOr(x.month, 1, 12), year: intOr(x.year, 1900, 2100), note: str(x.note, 200) })).filter((x) => x.name && x.month),
  };
  write('casa.json', clean);
  return clean;
}

// ---- fechas ----
const DAY = 86400000;
const startOfDay = (t = Date.now()) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
const ym = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

/** Próximo vencimiento de un pago mensual (si este mes ya está pagado, el siguiente). */
function nextDue(p, now = Date.now()) {
  if (!p.day) return null;
  const today = new Date(startOfDay(now));
  for (let k = 0; k < 3; k++) {
    const y = today.getFullYear();
    const m = today.getMonth() + k;
    const dt = new Date(y, m, Math.min(p.day, lastDay(y, m)));
    const key = ym(dt);
    if (p.paid?.[key]) continue;
    if (k === 0 || dt.getTime() >= today.getTime() || !p.paid?.[ym(new Date(y, m - 1, 1))]) return { date: dt.getTime(), key, days: Math.round((dt.getTime() - today.getTime()) / DAY) };
  }
  return null;
}

function nextBirthday(b, now = Date.now()) {
  if (!b.month) return null;
  const today = new Date(startOfDay(now));
  if (!b.day) {
    // solo mes: se cuenta desde el día 1
    let y = today.getFullYear();
    if (today.getMonth() + 1 > b.month) y++;
    const dt = new Date(y, b.month - 1, 1);
    return { date: dt.getTime(), days: Math.max(0, Math.round((dt - today) / DAY)), monthOnly: true, age: b.year ? y - b.year : null };
  }
  let y = today.getFullYear();
  let dt = new Date(y, b.month - 1, Math.min(b.day, lastDay(y, b.month - 1)));
  if (dt < today) {
    y++;
    dt = new Date(y, b.month - 1, Math.min(b.day, lastDay(y, b.month - 1)));
  }
  return { date: dt.getTime(), days: Math.round((dt - today) / DAY), age: b.year ? y - b.year : null };
}

// ---- feriados ----
async function holidays({ read, write }, years) {
  const cache = read('holidays.json', {});
  const out = [];
  for (const y of years) {
    for (const c of Object.keys(COUNTRIES)) {
      const k = `${c}-${y}`;
      if (!cache[k] || Date.now() - cache[k].at > 30 * DAY) {
        try {
          const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${c}`, { signal: AbortSignal.timeout(15000) });
          if (r.ok) {
            const list = await r.json();
            const seen = new Set();
            cache[k] = {
              at: Date.now(),
              list: list
                // nacionales: "Public" o, en EE. UU., los federales que Nager marca como "Bank" (Columbus Day)
                .filter((h) => h.global !== false && (h.types || ['Public']).some((t) => t === 'Public' || t === 'Bank'))
                .filter((h) => !seen.has(h.date + h.localName) && seen.add(h.date + h.localName))
                .map((h) => ({ date: h.date, name: h.localName, en: h.name, country: c })),
            };
          }
        } catch {}
      }
      if (cache[k]) out.push(...cache[k].list);
    }
  }
  write('holidays.json', cache);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Avisos que tocan ahora (cada uno una sola vez). */
function dueNotices({ read, write }) {
  const d = read('casa.json', null);
  if (!d) return [];
  const sent = read('casa-notified.json', {});
  const now = Date.now();
  if (new Date(now).getHours() < 8) return []; // nada de avisos de madrugada
  const out = [];
  const once = (key, n) => {
    if (sent[key]) return;
    sent[key] = now;
    out.push(n);
  };
  for (const p of d.payments || []) {
    const n = nextDue(p, now);
    if (!n) continue;
    const label = `${p.name}${p.group && p.group !== 'Personal' ? ` (${p.group})` : ''}`;
    if (n.days === 0) once(`pay:${p.id}:${n.key}:0`, { title: `Hoy se paga: ${label}`, body: p.amount ? `${p.amount.toLocaleString('es')} ${p.currency}` : 'Márcalo como pagado en Casa → Pagos.' });
    else if (n.days > 0 && n.days <= (p.notifyDays ?? 3)) once(`pay:${p.id}:${n.key}:soon`, { title: `${label} vence en ${n.days} ${n.days === 1 ? 'día' : 'días'}`, body: new Date(n.date).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) });
    else if (n.days < 0) once(`pay:${p.id}:${n.key}:late`, { title: `${label} está atrasado`, body: `Vencía el ${new Date(n.date).toLocaleDateString('es', { day: 'numeric', month: 'long' })}.` });
  }
  for (const r of d.reminders || []) {
    if (r.done || !r.date) continue;
    const days = Math.round((new Date(r.date + 'T00:00:00').getTime() - startOfDay(now)) / DAY);
    if (days === 0) once(`rem:${r.id}:0`, { title: `Hoy: ${r.title}`, body: r.time ? `A las ${r.time}. ${r.note || ''}` : r.note || '' });
    else if (days > 0 && days <= (r.notifyDays ?? 1)) once(`rem:${r.id}:soon`, { title: `${days === 1 ? 'Mañana' : `En ${days} días`}: ${r.title}`, body: r.note || new Date(r.date + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) });
  }
  for (const b of d.birthdays || []) {
    if (!b.day) continue;
    const n = nextBirthday(b, now);
    const y = new Date(n.date).getFullYear();
    const who = b.kind === 'gato' ? `${b.name} (gatito)` : b.name;
    if (n.days === 0) once(`bd:${b.id}:${y}:0`, { title: `¡Hoy cumple ${who}!`, body: n.age ? `Cumple ${n.age} ${b.kind === 'gato' ? (n.age === 1 ? 'año' : 'años') : 'años'}.` : 'No te olvides de saludar.' });
    else if (n.days === 1) once(`bd:${b.id}:${y}:1`, { title: `Mañana cumple ${who}`, body: n.age ? `Cumple ${n.age} años.` : 'Prepara el saludo o el regalo.' });
  }
  // limpieza: solo los últimos 400 avisos
  const keys = Object.keys(sent);
  if (keys.length > 400) for (const k of keys.sort((a, b) => sent[a] - sent[b]).slice(0, keys.length - 400)) delete sent[k];
  write('casa-notified.json', sent);
  return out;
}

module.exports = { load, save, holidays, dueNotices, nextDue, nextBirthday, COUNTRIES };

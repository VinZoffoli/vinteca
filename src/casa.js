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

// Regalos que ya tenías pensados para Emi (se añaden una sola vez)
function seedGifts() {
  const g = (name, note = '') => ({ id: id(), name, for: 'Emi', note, link: '', price: null, image: '', status: 'idea', at: Date.now() });
  return [
    g('Sellador One Size', 'On ’Til Dawn, spray fijador mate'),
    g('Set de brochas Beauty Creations', 'En el estuche negro'),
    g('Bronzer Lys', 'Tono Harmony'),
    g('Blush Patrick Ta', 'Tono Just Enough'),
    g('Polvo Huda Beauty', 'Tono Pound Cake'),
  ];
}

function load({ read, write, readStrict }) {
  // Si el archivo existe pero no se pudo leer (ocupado o dañado), NO se empieza de
  // cero: se usa la copia anterior y, si tampoco se puede, se avisa con un error.
  let d;
  if (readStrict) {
    try {
      d = readStrict('casa.json');
    } catch (e) {
      d = read('casa.json.bak', null);
      if (!d) throw e;
    }
  } else d = read('casa.json', null);
  if (!d) d = seed();
  if (!d.gifts) {
    d.gifts = seedGifts();
    d.giftPeople = ['Emi'];
    write('casa.json', d);
  }
  if (!d.tramites) {
    d.tramites = seedTramites();
    write('casa.json', d);
  }
  if (!d.maintenance) {
    // tareas típicas de la casa (se editan o borran en Casa → Hogar)
    const m = (name, everyMonths, note = '') => ({ id: id(), name, everyMonths, last: null, note });
    d.maintenance = [m('Cambiar el filtro del agua', 6), m('Limpiar el aire acondicionado', 6), m('Revisar el gas y la manguera', 12), m('Fumigar la casa', 6), m('Limpiar los canoas', 6)];
    d.warranties = d.warranties || [];
    d.recipes = d.recipes || [];
    d.menu = d.menu || {};
    d.shared = d.shared || { people: ['Yo', 'Abuela', 'Abuelo', 'Emi'], items: [] };
    write('casa.json', d);
  }
  return d;
}

const DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const addMonths = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toLocaleDateString('sv');
};
/** Cuándo vence una garantía y cuándo toca cada tarea de mantenimiento. */
const warrantyEnd = (w) => (w.bought && w.months ? addMonths(w.bought, w.months) : null);
const maintNext = (m) => (m.last ? addMonths(m.last, m.everyMonths || 6) : null);

/** Quién le debe a quién en los gastos compartidos (saldos y pagos sugeridos). */
function sharedBalances(sh) {
  const bal = {};
  for (const p of sh?.people || []) bal[p] = 0;
  for (const it of sh?.items || []) {
    const between = (it.between?.length ? it.between : sh.people).filter(Boolean);
    if (!between.length || !it.amount) continue;
    const part = it.amount / between.length;
    bal[it.paidBy] = (bal[it.paidBy] || 0) + it.amount;
    for (const p of between) bal[p] = (bal[p] || 0) - part;
  }
  const debt = Object.entries(bal).filter(([, v]) => v < -0.5).map(([p, v]) => [p, -v]).sort((a, b) => b[1] - a[1]);
  const cred = Object.entries(bal).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const moves = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i][1], cred[j][1]);
    moves.push({ from: debt[i][0], to: cred[j][0], amount: Math.round(amt) });
    debt[i][1] -= amt;
    cred[j][1] -= amt;
    if (debt[i][1] < 0.5) i++;
    if (cred[j][1] < 0.5) j++;
  }
  return { balances: Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, Math.round(v)])), moves };
}

// Trámites de Costa Rica: marchamo, Riteve, licencia y cédula
const TRAMITES = {
  marchamo: { label: 'Marchamo', renew: 1 },
  riteve: { label: 'Revisión técnica (Riteve)', renew: 1 },
  licencia: { label: 'Licencia de conducir', renew: null },
  cedula: { label: 'Cédula de identidad', renew: 10 },
  pasaporte: { label: 'Pasaporte', renew: 6 },
  otro: { label: 'Otro trámite', renew: null },
};
function seedTramites() {
  const y = new Date().getFullYear();
  const t = (kind, due = null) => ({ id: id(), kind, name: TRAMITES[kind].label, due, plate: '', note: '', lastDone: null });
  return [t('marchamo', `${y}-12-31`), t('riteve'), t('licencia'), t('cedula')];
}
/** Mes de la revisión técnica según el último dígito de la placa (1 = enero … 9 = setiembre, 0 = octubre). */
function riteveMonth(plate) {
  const m = String(plate || '').match(/(\d)\D*$/);
  if (!m) return null;
  return m[1] === '0' ? 10 : Number(m[1]);
}

// Foto de un regalo: una imagen pequeña en data: (elegida o pegada) o un enlace https
const okImage = (v) => (typeof v === 'string' && ((/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 700000) || /^https:\/\/\S{8,1500}$/.test(v)) ? v : '');

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
    giftPeople: (d.giftPeople || ['Emi']).map((x) => str(x, 40)).filter(Boolean).slice(0, 30),
    gifts: (d.gifts || []).slice(0, 300).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name, 160), for: str(x.for, 40) || 'Emi', note: str(x.note, 400), link: /^https:\/\/\S+$/.test(x.link || '') ? str(x.link, 600) : '', price: x.price === '' || x.price == null ? null : Number(x.price) || null, image: okImage(x.image), status: ['idea', 'bought', 'given'].includes(x.status) ? x.status : 'idea', occasion: str(x.occasion, 60), at: Number(x.at) || Date.now() })).filter((x) => x.name),
    shopping: (d.shopping || []).slice(0, 500).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name), qty: str(x.qty, 30), cat: str(x.cat, 40), done: !!x.done, at: Number(x.at) || Date.now(), price: x.price === '' || x.price == null ? null : Number(x.price) || null, boughtAt: x.done ? Number(x.boughtAt) || Date.now() : null })).filter((x) => x.name),
    // Presupuesto del mes: límite y gastos sueltos (los pagos y las compras con precio se suman solos)
    budget: {
      limit: d.budget?.limit === '' || d.budget?.limit == null ? null : Number(d.budget.limit) || null,
      currency: str(d.budget?.currency, 5) || 'CRC',
      expenses: (d.budget?.expenses || []).slice(-2000).map((x) => ({ id: str(x.id, 20) || id(), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : new Date().toISOString().slice(0, 10), amount: Number(x.amount) || 0, cat: str(x.cat, 40) || 'Otros', note: str(x.note, 200) })).filter((x) => x.amount > 0),
    },
    // Cuidados de los gatitos: vacunas, desparasitación, veterinario…
    catCare: (d.catCare || []).slice(0, 1000).map((x) => ({ id: str(x.id, 20) || id(), cat: str(x.cat, 60), type: ['vacuna', 'desparasitacion', 'pulgas', 'veterinario', 'otro'].includes(x.type) ? x.type : 'otro', date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null, next: /^\d{4}-\d{2}-\d{2}$/.test(x.next || '') ? x.next : null, note: str(x.note, 300), done: !!x.done })).filter((x) => x.cat),
    recipes: (d.recipes || []).slice(0, 300).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name, 100), ingredients: (x.ingredients || []).map((g) => str(g, 80)).filter(Boolean).slice(0, 40), note: str(x.note, 300) })).filter((x) => x.name),
    menu: Object.fromEntries(DAYS.map((k) => [k, { almuerzo: str(d.menu?.[k]?.almuerzo, 100), cena: str(d.menu?.[k]?.cena, 100) }])),
    warranties: (d.warranties || []).slice(0, 300).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name, 120), store: str(x.store, 80), bought: /^\d{4}-\d{2}-\d{2}$/.test(x.bought || '') ? x.bought : null, months: intOr(x.months, 0, 240) ?? 12, photo: okImage(x.photo), link: /^https:\/\/\S+$/.test(x.link || '') ? str(x.link, 600) : '', note: str(x.note, 400) })).filter((x) => x.name),
    maintenance: (d.maintenance || []).slice(0, 200).map((x) => ({ id: str(x.id, 20) || id(), name: str(x.name, 120), everyMonths: intOr(x.everyMonths, 1, 120) ?? 6, last: /^\d{4}-\d{2}-\d{2}$/.test(x.last || '') ? x.last : null, note: str(x.note, 300) })).filter((x) => x.name),
    shared: {
      people: (d.shared?.people || ['Yo']).map((p) => str(p, 40)).filter(Boolean).slice(0, 20),
      items: (d.shared?.items || []).slice(-1000).map((x) => ({ id: str(x.id, 20) || id(), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : new Date().toLocaleDateString('sv'), desc: str(x.desc, 160), amount: Math.max(0, Number(x.amount) || 0), paidBy: str(x.paidBy, 40), between: (x.between || []).map((p) => str(p, 40)).filter(Boolean).slice(0, 20), settle: !!x.settle })).filter((x) => x.amount > 0 && x.paidBy),
    },
    tramites: (d.tramites || []).slice(0, 100).map((x) => ({ id: str(x.id, 20) || id(), kind: TRAMITES[x.kind] ? x.kind : 'otro', name: str(x.name, 120) || TRAMITES[x.kind]?.label || 'Trámite', due: /^\d{4}-\d{2}-\d{2}$/.test(x.due || '') ? x.due : null, plate: str(x.plate, 12).toUpperCase(), note: str(x.note, 400), lastDone: /^\d{4}-\d{2}-\d{2}$/.test(x.lastDone || '') ? x.lastDone : null })).filter((x) => x.name),
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
  // Ideas de regalo cuando se acerca un cumpleaños (14 y 3 días antes)
  const plain = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (const b of d.birthdays || []) {
    if (!b.day || b.kind === 'gato') continue;
    const n = nextBirthday(b, now);
    if (n.days !== 14 && n.days !== 3) continue;
    const who = plain(b.name);
    const ideas = (d.gifts || []).filter((g) => g.status === 'idea' && (plain(g.for) === who || who.startsWith(plain(g.for)) || plain(g.for).startsWith(who.split(' ')[0])));
    if (!ideas.length) continue;
    once(`gift:${b.id}:${new Date(n.date).getFullYear()}:${n.days}`, { title: `Faltan ${n.days} días para el cumple de ${b.name}`, body: `Tienes ${ideas.length} ${ideas.length === 1 ? 'idea de regalo' : 'ideas de regalo'}: ${ideas.slice(0, 3).map((g) => g.name).join(', ')}${ideas.length > 3 ? '…' : ''}.` });
  }
  // Cuidados de los gatitos que tocan pronto
  for (const c of d.catCare || []) {
    if (c.done || !c.next) continue;
    const days = Math.round((new Date(c.next + 'T00:00:00').getTime() - startOfDay(now)) / DAY);
    const what = { vacuna: 'vacuna', desparasitacion: 'desparasitación', pulgas: 'antipulgas', veterinario: 'visita al veterinario', otro: c.note || 'cuidado' }[c.type];
    if (days === 3) once(`cat:${c.id}:3`, { title: `En 3 días: ${what} de ${c.cat}`, body: c.note || 'Revisa Casa → Gatitos.' });
    if (days === 0) once(`cat:${c.id}:0`, { title: `Hoy toca ${what} de ${c.cat}`, body: c.note || 'Cuando lo hagas, márcalo en Casa → Gatitos.' });
  }
  // Trámites: 30 días, 7 días y el mismo día del vencimiento
  for (const t of d.tramites || []) {
    if (!t.due) continue;
    const days = Math.round((new Date(t.due + 'T00:00:00').getTime() - startOfDay(now)) / DAY);
    const fecha = new Date(t.due + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long' });
    if (days === 30) once(`tram:${t.id}:${t.due}:30`, { title: `${t.name}: falta un mes`, body: `Vence el ${fecha}. Mejor sacar la cita con tiempo.` });
    else if (days === 7) once(`tram:${t.id}:${t.due}:7`, { title: `${t.name} vence en una semana`, body: `El ${fecha}. Cuando lo hagas, márcalo en Casa → Trámites.` });
    else if (days === 0) once(`tram:${t.id}:${t.due}:0`, { title: `Hoy vence: ${t.name}`, body: t.note || 'Márcalo como hecho en Casa → Trámites.' });
    else if (days < 0 && days >= -3) once(`tram:${t.id}:${t.due}:late`, { title: `${t.name} está vencido`, body: `Venció el ${fecha}.` });
  }
  // Garantías: un mes y una semana antes de que se acaben
  for (const w of d.warranties || []) {
    const end = warrantyEnd(w);
    if (!end) continue;
    const days = Math.round((new Date(end + 'T00:00:00').getTime() - startOfDay(now)) / DAY);
    if (days === 30) once(`war:${w.id}:30`, { title: `La garantía de ${w.name} vence en un mes`, body: `El ${new Date(end + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long' })}. Si falla algo, reclama antes.` });
    else if (days === 7) once(`war:${w.id}:7`, { title: `La garantía de ${w.name} vence en una semana`, body: w.store ? `Comprado en ${w.store}.` : 'Revisa que todo funcione bien.' });
  }
  // Mantenimiento de la casa: una semana antes y el día
  for (const m of d.maintenance || []) {
    const next = maintNext(m);
    if (!next) continue;
    const days = Math.round((new Date(next + 'T00:00:00').getTime() - startOfDay(now)) / DAY);
    if (days === 7) once(`mnt:${m.id}:${next}:7`, { title: `En una semana: ${m.name}`, body: m.note || 'Casa → Hogar.' });
    else if (days === 0) once(`mnt:${m.id}:${next}:0`, { title: `Hoy toca: ${m.name}`, body: 'Cuando lo hagas, márcalo en Casa → Hogar.' });
  }
  // Presupuesto del mes: aviso al 90 % y al pasarse
  const b = budgetStatus(d, now, read('fx.json', null)?.sell);
  if (b.limit) {
    if (b.spent >= b.limit) once(`budget:${b.month}:100`, { title: 'Te pasaste del presupuesto del mes', body: `Llevas ${b.spent.toLocaleString('es')} de ${b.limit.toLocaleString('es')} ${b.currency}.` });
    else if (b.spent >= b.limit * 0.9) once(`budget:${b.month}:90`, { title: 'Llevas el 90 % del presupuesto del mes', body: `Te quedan ${(b.limit - b.spent).toLocaleString('es')} ${b.currency}.` });
  }
  // limpieza: solo los últimos 400 avisos
  const keys = Object.keys(sent);
  if (keys.length > 400) for (const k of keys.sort((a, b) => sent[a] - sent[b]).slice(0, keys.length - 400)) delete sent[k];
  write('casa-notified.json', sent);
  return out;
}

/** Gasto del mes: pagos marcados como pagados + compras con precio + gastos sueltos. */
function budgetStatus(d, now = Date.now(), rate = null) {
  const dt = new Date(now);
  const month = ym(dt);
  const lines = [];
  for (const p of d.payments || []) if (p.amount && p.paid?.[month]) lines.push({ kind: 'Pagos', name: p.name + (p.group && p.group !== 'Personal' ? ` (${p.group})` : ''), amount: p.amount, currency: p.currency });
  for (const s of d.shopping || []) if (s.price && s.done && s.boughtAt && ym(new Date(s.boughtAt)) === month) lines.push({ kind: 'Compras', name: s.name, amount: s.price });
  for (const e of d.budget?.expenses || []) if (e.date.startsWith(month)) lines.push({ kind: e.cat || 'Otros', name: e.note || e.cat, amount: e.amount, id: e.id, date: e.date });
  const currency = d.budget?.currency || 'CRC';
  // con el tipo de cambio del día, los dólares se pasan a colones (y al revés)
  const conv = (amount, cur) => {
    if (!cur || cur === currency) return amount;
    if (!rate) return null;
    if (cur === 'USD' && currency === 'CRC') return Math.round(amount * rate);
    if (cur === 'CRC' && currency === 'USD') return Math.round((amount / rate) * 100) / 100;
    return null;
  };
  for (const l of lines) {
    if (!l.currency || l.currency === currency) continue;
    const v = conv(l.amount, l.currency);
    if (v != null) Object.assign(l, { original: `${l.amount.toLocaleString('es')} ${l.currency}`, amount: v, currency });
  }
  const same = lines.filter((l) => !l.currency || l.currency === currency);
  const spent = same.reduce((a, l) => a + l.amount, 0);
  const planned = (d.payments || []).filter((p) => p.amount).reduce((a, p) => a + (conv(p.amount, p.currency || currency) || 0), 0);
  const byKind = {};
  for (const l of same) byKind[l.kind] = (byKind[l.kind] || 0) + l.amount;
  return { month, limit: d.budget?.limit || null, currency, spent, planned, lines: same, byKind, rate, other: lines.filter((l) => l.currency && l.currency !== currency) };
}

module.exports = { load, save, holidays, dueNotices, nextDue, nextBirthday, budgetStatus, riteveMonth, TRAMITES, COUNTRIES, warrantyEnd, maintNext, sharedBalances, DAYS };

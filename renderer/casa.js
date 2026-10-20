'use strict';
// Casa: compras, pagos, recordatorios, cumpleaños y feriados.
(function () {
  const api = window.api.casa;
  const K = { d: null, tab: 'compras', hol: null, holView: 'list', holMonth: null, holCountries: null, mine: true, newCat: '' };
  const DAY = 86400000;
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const C_LABEL = { US: 'EE. UU.', AR: 'Argentina', CR: 'Costa Rica' };
  const startOfDay = (t = Date.now()) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
  const ym = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
  const dLong = (t) => new Date(t).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  const dShort = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'long' });
  const daysText = (n) => (n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n < 0 ? `Hace ${plural(-n, 'día', 'días')}` : `En ${plural(n, 'día', 'días')}`);
  const uid = () => Math.random().toString(16).slice(2, 14);
  const money = (v, cur) => (v == null ? '' : `${Number(v).toLocaleString('es')} ${cur || ''}`.trim());

  // mismas reglas que src/casa.js
  function nextDue(p) {
    if (!p.day) return null;
    const today = new Date(startOfDay());
    for (let k = 0; k < 3; k++) {
      const y = today.getFullYear();
      const m = today.getMonth() + k;
      const dt = new Date(y, m, Math.min(p.day, lastDay(y, m)));
      const key = ym(dt);
      if (p.paid?.[key]) continue;
      return { date: dt.getTime(), key, days: Math.round((dt.getTime() - today.getTime()) / DAY) };
    }
    return null;
  }
  function nextBirthday(b) {
    if (!b.month) return null;
    const today = new Date(startOfDay());
    let y = today.getFullYear();
    const day = b.day || 1;
    let dt = new Date(y, b.month - 1, Math.min(day, lastDay(y, b.month - 1)));
    if (dt < today && !(!b.day && today.getMonth() + 1 === b.month)) {
      y++;
      dt = new Date(y, b.month - 1, Math.min(day, lastDay(y, b.month - 1)));
    }
    return { date: dt.getTime(), days: Math.max(0, Math.round((dt - today) / DAY)), age: b.year ? y - b.year : null, monthOnly: !b.day };
  }

  async function load() {
    if (!K.d) K.d = await api.get();
    if (!K.holCountries) K.holCountries = new Set(K.d.holidayCountries || ['US', 'AR', 'CR']);
  }
  let saveTimer;
  function save(now) {
    clearTimeout(saveTimer);
    // No se reemplaza K.d con lo devuelto: la vista sigue usando los mismos
    // objetos y un cambio hecho justo después no se pierde.
    const run = async () => {
      await api.save(K.d);
    };
    if (now) return run();
    saveTimer = setTimeout(run, 400);
  }
  const commit = () => {
    const p = save(true);
    render();
    updateBadge();
    // el presupuesto se calcula con lo guardado: se refresca cuando termina de guardar
    if (K.tab === 'presupuesto') p.then(() => { BUD.st = null; render(); });
  };

  // ---- formulario en diálogo ----
  function form(title, fields, onSave, onDelete) {
    const inputs = {};
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg' });
    const body = h('form', { method: 'dialog' },
      h('h2', { text: title }),
      fields.map((f) => {
        let input;
        if (f.type === 'select') input = h('select', { class: 'sn-select' }, f.options.map(([v, l]) => h('option', { value: v, selected: String(f.value ?? '') === String(v), text: l })));
        else if (f.type === 'textarea') input = h('textarea', { class: 'note', rows: 3, value: f.value ?? '' });
        else input = h('input', { type: f.type || 'text', class: 'rx-input', value: f.value ?? '', placeholder: f.placeholder || '', min: f.min, max: f.max, required: !!f.required });
        inputs[f.key] = input;
        return h('label', { class: 'ks-field' }, h('span', { text: f.label }), input, f.hint && h('small', { class: 'hint', text: f.hint }));
      }),
      h('div', { class: 'actions' },
        onDelete && h('button', { type: 'button', class: 'btn subtle', text: 'Eliminar', onclick: (e) => { const b = e.currentTarget; if (b.dataset.sure) { onDelete(); dlg.close(); } else { b.dataset.sure = '1'; b.textContent = 'Pulsa otra vez para eliminar'; } } }),
        h('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: () => dlg.close() }),
        h('button', { class: 'btn primary', text: 'Guardar' })
      )
    );
    body.addEventListener('submit', (e) => {
      const vals = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
      const err = onSave(vals);
      if (err) {
        e.preventDefault();
        toast(err, true);
      }
    });
    dlg.append(body);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    inputs[fields[0].key]?.focus();
  }

  // =========================================================== COMPRAS
  function compras() {
    const d = K.d;
    const name = h('input', { class: 'rx-input', placeholder: 'Qué hay que comprar', 'aria-label': 'Producto' });
    const qty = h('input', { class: 'rx-input ks-qty', placeholder: 'Cantidad', 'aria-label': 'Cantidad' });
    const cat = h('select', { class: 'sn-select', 'aria-label': 'Categoría', onchange: (e) => {
      if (e.target.value !== '__new') return;
      form('Nueva categoría', [{ key: 'name', label: 'Nombre', required: true, placeholder: 'Panadería, Mascotas…' }], (v) => { if (!d.shopCats.includes(v.name)) d.shopCats.push(v.name); K.lastCat = v.name; commit(); });
      e.target.value = K.lastCat || d.shopCats[0];
    } }, d.shopCats.map((c) => h('option', { value: c, text: c, selected: c === K.lastCat })), h('option', { value: '__new', text: '+ Nueva categoría…' }));
    const add = () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      const c = cat.value === '__new' ? d.shopCats[0] : cat.value;
      K.lastCat = c;
      d.shopping.push({ id: uid(), name: n, qty: qty.value.trim(), cat: c, done: false, at: Date.now() });
      commit();
      setTimeout(() => $('#casaBody .ks-add .rx-input')?.focus(), 0);
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    qty.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    const pending = d.shopping.filter((x) => !x.done);
    const bought = d.shopping.filter((x) => x.done);
    const groups = [...new Set([...d.shopCats, ...pending.map((x) => x.cat)])].map((c) => [c, pending.filter((x) => x.cat === c)]).filter(([, l]) => l.length);
    const item = (x) => h('li', { class: `ks-item ${x.done ? 'done' : ''}` },
      h('label', { class: 'ks-check' }, h('input', { type: 'checkbox', checked: x.done, onchange: (e) => { x.done = e.target.checked; x.boughtAt = x.done ? Date.now() : null; commit(); } }), h('span', { text: x.name }), x.qty && h('small', { text: x.qty }), x.price && h('small', { text: money(x.price, 'CRC') })),
      h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => form('Editar producto', [{ key: 'name', label: 'Producto', value: x.name, required: true }, { key: 'qty', label: 'Cantidad', value: x.qty }, { key: 'price', label: 'Precio (opcional, cuenta para el presupuesto)', type: 'number', value: x.price ?? '' }, { key: 'cat', label: 'Categoría', type: 'select', value: x.cat, options: d.shopCats.map((c) => [c, c]) }], (v) => { Object.assign(x, { ...v, price: v.price ? Number(v.price) : null }); commit(); }, () => { d.shopping = d.shopping.filter((y) => y !== x); commit(); }) })
    );
    const phone = h('div', { class: 'ks-phone' });
    window.api.lanStatus().then((st) => {
      if (st.running && st.shopQr) fill(phone, h('img', { src: st.shopQr, alt: 'Código QR de la lista de compras' }), h('div', {}, h('b', { text: 'La lista en el celular' }), h('p', { class: 'hint', text: 'Escanéalo con el celular (misma Wi-Fi): Emi o tú pueden ver, marcar y añadir cosas, y se actualiza aquí.' })));
      else fill(phone, h('div', {}, h('b', { text: 'La lista en el celular' }), h('p', { class: 'hint', text: 'Enciende «En el móvil» para ver y marcar esta lista desde el celular, con un código QR.' })), h('button', { class: 'btn ghost small', text: 'Encender', onclick: async () => { await window.api.lanStart(); render(); } }));
    }).catch(() => {});
    return [
      h('div', { class: 'ks-add rx-row' }, name, qty, cat, h('button', { class: 'btn primary', text: 'Añadir', onclick: add })),
      h('div', { class: 'toolbar flat' },
        h('span', { class: 'hint', text: pending.length ? `${plural(pending.length, 'cosa', 'cosas')} por comprar` : 'No falta nada por comprar.' }),
        pending.length > 0 && h('button', { class: 'btn ghost small', text: 'Copiar lista', onclick: async () => { const txt = groups.map(([c, l]) => `${c}:\n${l.map((x) => `- ${x.name}${x.qty ? ` (${x.qty})` : ''}`).join('\n')}`).join('\n\n'); await window.api.workana.copy(txt); toast('Lista copiada: pégala en WhatsApp o donde quieras.'); } }),
        bought.length > 0 && h('button', { class: 'btn subtle small', text: `Quitar ${plural(bought.length, 'comprado', 'comprados')}`, onclick: () => { d.shopping = pending; commit(); } })
      ),
      groups.length ? h('div', { class: 'ks-cols' }, groups.map(([c, l]) => h('section', { class: 'rx-card ks-cat' }, h('h3', {}, c, h('span', { class: 'count', text: String(l.length) })), h('ul', { class: 'ks-list' }, l.map(item))))) : h('p', { class: 'empty' }, h('b', { text: 'Lista vacía' }), 'Escribe arriba lo que haga falta en la casa.'),
      bought.length ? h('details', { class: 'notes' }, h('summary', { text: `Ya comprado (${bought.length})` }), h('ul', { class: 'ks-list' }, bought.map(item))) : null,
      phone,
    ];
  }

  // =========================================================== PRESUPUESTO
  const BUD = { st: null };
  function presupuesto() {
    const d = K.d;
    d.budget ||= { limit: null, currency: 'CRC', expenses: [] };
    if (!BUD.st) {
      window.api.budget().then((s) => { BUD.st = s; render(); });
      return skeleton();
    }
    const s = BUD.st;
    const pct = s.limit ? Math.min(100, (s.spent / s.limit) * 100) : 0;
    const limitIn = h('input', { class: 'rx-input', type: 'number', value: d.budget.limit ?? '', placeholder: 'Límite del mes', step: 10000 });
    const amount = h('input', { class: 'rx-input', type: 'number', placeholder: 'Monto' });
    const note = h('input', { class: 'rx-input', placeholder: 'En qué (super, gasolina, salida…)' });
    const cat = h('select', { class: 'sn-select' }, ['Comida', 'Casa', 'Transporte', 'Salud', 'Gatos', 'Salidas', 'Regalos', 'Otros'].map((c) => h('option', { value: c, text: c })));
    const addExpense = () => {
      const a = Number(amount.value);
      if (!a) return amount.focus();
      d.budget.expenses.push({ id: uid(), date: new Date().toISOString().slice(0, 10), amount: a, cat: cat.value, note: note.value.trim() });
      BUD.st = null;
      commit();
    };
    amount.addEventListener('keydown', (e) => e.key === 'Enter' && addExpense());
    note.addEventListener('keydown', (e) => e.key === 'Enter' && addExpense());
    const month = new Date().toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const kinds = Object.entries(s.byKind).sort((a, b) => b[1] - a[1]);
    return [
      h('section', { class: `ks-next ${s.limit && s.spent > s.limit ? 'bad' : ''}` },
        h('p', { class: 'ks-kicker', text: `Gastado en ${month}` }),
        h('p', { class: 'ks-big' }, h('b', { text: money(s.spent, s.currency) }), s.limit && h('span', { text: ` de ${money(s.limit, s.currency)}` })),
        s.limit ? h('div', { class: 'dy-bar' }, h('i', { class: s.spent > s.limit ? 'hot' : '', style: { width: `${pct}%` } })) : h('p', { class: 'hint', text: 'Pon un límite para el mes y te aviso al llegar al 90 % y si te pasas.' }),
        s.limit && h('p', { class: 'hint', text: s.spent > s.limit ? `Te pasaste por ${money(s.spent - s.limit, s.currency)}.` : `Te quedan ${money(s.limit - s.spent, s.currency)}. Pagos fijos del mes: ${money(s.planned, s.currency)}.` })
      ),
      fxCard(s),
      h('div', { class: 'toolbar flat' }, h('span', { class: 'hint', text: 'Límite del mes:' }), limitIn, h('button', { class: 'btn ghost small', text: 'Guardar límite', onclick: () => { d.budget.limit = limitIn.value ? Number(limitIn.value) : null; BUD.st = null; commit(); toast('Límite guardado.'); } })),
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Anotar un gasto' }),
        h('div', { class: 'ks-add rx-row' }, amount, cat, note, h('button', { class: 'btn primary', text: 'Anotar', onclick: addExpense })),
        h('p', { class: 'hint', text: 'Los pagos que marcas como pagados (con monto) y las compras con precio que tachas se suman solos.' })
      ),
      kinds.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'En qué se va' }), h('ul', { class: 'bu-kinds' }, kinds.map(([k2, v]) => h('li', {}, h('span', { text: k2 }), h('div', { class: 'dy-bar' }, h('i', { style: { width: `${(v / (s.spent || 1)) * 100}%` } })), h('b', { text: money(v, s.currency) }))))) : null,
      s.lines.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Movimientos del mes' }), h('ul', { class: 'dy-list' }, s.lines.slice().reverse().map((l) => h('li', {}, h('span', { text: `${l.kind} · ${l.name}${l.original ? ` (${l.original})` : ''}` }), h('b', { text: money(l.amount, s.currency) }), l.id && h('button', { class: 'btn subtle small', text: 'Quitar', onclick: () => { d.budget.expenses = d.budget.expenses.filter((x) => x.id !== l.id); BUD.st = null; commit(); } }))))) : null,
      s.other.length ? h('p', { class: 'hint', text: `Hay ${s.other.length} pagos en otra moneda que no se pudieron convertir (${[...new Set(s.other.map((o) => o.currency))].join(', ')}).` }) : null,
    ];
  }

  // Dólar del día (Banco Central, vía Hacienda) y conversor rápido
  const FX = { d: null, busy: false };
  function fxCard(s) {
    if (!FX.d && !FX.busy) {
      FX.busy = true;
      window.api.fx(false).then((d) => { FX.d = d; FX.busy = false; render(); }).catch(() => { FX.busy = false; });
    }
    const f = FX.d;
    if (!f) return null;
    const usd = h('input', { class: 'rx-input', type: 'number', placeholder: 'Dólares', step: 1 });
    const crc = h('input', { class: 'rx-input', type: 'number', placeholder: 'Colones', step: 1000 });
    usd.addEventListener('input', () => { crc.value = usd.value ? Math.round(Number(usd.value) * f.sell) : ''; });
    crc.addEventListener('input', () => { usd.value = crc.value ? (Number(crc.value) / f.sell).toFixed(2) : ''; });
    const diff = f.prev?.sell ? f.sell - f.prev.sell : 0;
    return h('section', { class: 'rx-card fx-card' },
      h('div', { class: 'fx-rate' },
        h('div', {}, h('small', { text: 'Dólar hoy · venta' }), h('b', { text: `₡${f.sell.toLocaleString('es', { minimumFractionDigits: 2 })}` }), diff ? h('em', { class: diff > 0 ? 'up' : 'down', text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(2)}` }) : null),
        h('div', {}, h('small', { text: 'Compra' }), h('b', { text: `₡${f.buy.toLocaleString('es', { minimumFractionDigits: 2 })}` }))
      ),
      h('div', { class: 'fx-conv' }, usd, h('span', { text: '=' }), crc),
      h('p', { class: 'hint', text: `Tipo de cambio de referencia del Banco Central${f.date ? ` del ${dShort(new Date(f.date + 'T12:00:00'))}` : ''}${f.stale ? ' (sin conexión: es el último que guardé)' : ''}. Los pagos en dólares se suman al presupuesto con este valor.` })
    );
  }

  // =========================================================== GATITOS
  const CARE = [['vacuna', 'Vacuna'], ['desparasitacion', 'Desparasitación'], ['pulgas', 'Antipulgas'], ['veterinario', 'Visita al veterinario'], ['otro', 'Otro']];
  function careForm(c, cat) {
    const d = K.d;
    const isNew = !c;
    const cats = d.birthdays.filter((b) => b.kind === 'gato').map((b) => b.name);
    form(isNew ? 'Nuevo cuidado' : 'Editar cuidado', [
      { key: 'cat', label: 'Gatito', type: 'select', value: c?.cat || cat || cats[0], options: cats.map((x) => [x, x]) },
      { key: 'type', label: 'Qué', type: 'select', value: c?.type || 'vacuna', options: CARE },
      { key: 'date', label: 'Cuándo se hizo (opcional)', type: 'date', value: c?.date || '' },
      { key: 'next', label: 'Cuándo toca la próxima', type: 'date', value: c?.next || '' },
      { key: 'note', label: 'Nota (vacuna, producto, veterinaria…)', value: c?.note || '' },
    ], (v) => {
      const row = { cat: v.cat, type: v.type, date: v.date || null, next: v.next || null, note: v.note };
      if (isNew) d.catCare.push({ id: uid(), done: false, ...row });
      else Object.assign(c, row);
      commit();
    }, isNew ? null : () => { d.catCare = d.catCare.filter((x) => x !== c); commit(); });
  }
  function gatitos() {
    const d = K.d;
    d.catCare ||= [];
    const cats = d.birthdays.filter((b) => b.kind === 'gato');
    const today = startOfDay();
    const label = (t) => CARE.find((x) => x[0] === t)?.[1] || t;
    return [
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn primary small', text: 'Anotar cuidado', onclick: () => careForm(null) }), h('span', { class: 'hint', text: 'Te aviso 3 días antes y el día que toca. Los gatitos salen de Cumpleaños.' })),
      cats.length ? h('div', { class: 'ct-grid' }, cats.map((b) => {
        const list = d.catCare.filter((c) => c.cat === b.name).sort((x, y) => String(x.next || '9').localeCompare(String(y.next || '9')));
        const next = list.find((c) => c.next && !c.done);
        return h('section', { class: 'rx-card ct-cat' },
          h('div', { class: 'ct-head' }, h('h3', { text: b.name }), h('button', { class: 'btn subtle small', text: '+ Anotar', onclick: () => careForm(null, b.name) })),
          next ? h('p', { class: `ct-next ${new Date(next.next + 'T00:00:00') <= today ? 'hot' : ''}`, text: `Próximo: ${label(next.type)} · ${daysText(Math.round((new Date(next.next + 'T00:00:00') - today) / DAY))}` }) : h('p', { class: 'hint', text: 'Sin nada pendiente.' }),
          list.length ? h('ul', { class: 'dy-list' }, list.map((c) => h('li', { class: c.done ? 'past' : '' },
            h('span', { text: `${label(c.type)}${c.note ? ` · ${c.note}` : ''}` }),
            h('b', { text: c.next ? `toca ${dShort(new Date(c.next + 'T12:00:00'))}` : c.date ? `hecho ${dShort(new Date(c.date + 'T12:00:00'))}` : '' }),
            h('button', { class: 'btn subtle small', text: c.done ? 'Reabrir' : 'Hecho', onclick: () => { c.done = !c.done; if (c.done && !c.date) c.date = new Date().toISOString().slice(0, 10); commit(); } }),
            h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => careForm(c) })
          ))) : null
        );
      })) : h('p', { class: 'empty', text: 'Añade tus gatitos en Cumpleaños y aquí podrás llevar sus vacunas y visitas.' }),
    ];
  }

  // =========================================================== TRÁMITES (Costa Rica)
  const TRAM = [['marchamo', 'Marchamo'], ['riteve', 'Revisión técnica (Riteve)'], ['licencia', 'Licencia de conducir'], ['cedula', 'Cédula de identidad'], ['pasaporte', 'Pasaporte'], ['otro', 'Otro trámite']];
  const TRAM_RENEW = { marchamo: 1, riteve: 1, cedula: 10, pasaporte: 6 };
  const TRAM_INFO = {
    marchamo: ['Se paga cada año, hasta el 31 de diciembre.', 'https://www.grupoins.com/'],
    riteve: ['El mes depende del último dígito de la placa: 1 enero, 2 febrero… 9 setiembre y 0 octubre.', 'https://www.rtv.co.cr/'],
    licencia: ['Se renueva en el COSEVI o en bancos autorizados, con el dictamen médico digital.', 'https://www.csv.go.cr/'],
    cedula: ['Dura 10 años. Se renueva en el TSE o en bancos autorizados.', 'https://www.tse.go.cr/'],
    pasaporte: ['Se renueva en Migración o en el Banco de Costa Rica.', 'https://www.migracion.go.cr/'],
  };
  const MONTHS_CR = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  // Riteve: último día del mes que toca según la placa (este año o el siguiente si ya pasó)
  function riteveDue(plate, fromYear) {
    const m = String(plate || '').match(/(\d)\D*$/);
    if (!m) return null;
    const month = m[1] === '0' ? 10 : Number(m[1]);
    let y = fromYear || new Date().getFullYear();
    let due = new Date(y, month, 0);
    if (!fromYear && due < new Date(startOfDay())) due = new Date(++y, month, 0);
    return { month, due: iso(due) };
  }
  function tramForm(t) {
    const d = K.d;
    const isNew = !t;
    form(isNew ? 'Nuevo trámite' : `Editar: ${t.name}`, [
      { key: 'kind', label: 'Tipo', type: 'select', value: t?.kind || 'otro', options: TRAM },
      { key: 'name', label: 'Nombre', value: t?.name || '', placeholder: 'Ej.: Marchamo del carro, licencia de moto…' },
      { key: 'plate', label: 'Placa (para marchamo y Riteve)', value: t?.plate || '', placeholder: 'Ej.: BCD123', hint: 'Con la placa calculo el mes de la revisión técnica.' },
      { key: 'due', label: 'Vence el', type: 'date', value: t?.due || '' },
      { key: 'note', label: 'Nota', value: t?.note || '', placeholder: 'Cita, sucursal, papeles que necesitas…' },
    ], (v) => {
      const row = { kind: v.kind, name: v.name || TRAM.find((x) => x[0] === v.kind)[1], plate: v.plate.toUpperCase(), due: v.due || null, note: v.note };
      if (row.kind === 'riteve' && !row.due && row.plate) row.due = riteveDue(row.plate)?.due || null;
      if (row.kind === 'marchamo' && !row.due) row.due = `${new Date().getFullYear()}-12-31`;
      if (isNew) d.tramites.push({ id: uid(), lastDone: null, ...row });
      else Object.assign(t, row);
      commit();
    }, isNew ? null : () => { d.tramites = d.tramites.filter((x) => x !== t); commit(); });
  }
  function tramDone(t) {
    const years = TRAM_RENEW[t.kind];
    t.lastDone = iso(new Date());
    if (years && t.due) {
      const dt = new Date(t.due + 'T12:00:00');
      if (t.kind === 'riteve' && t.plate) t.due = riteveDue(t.plate, dt.getFullYear() + 1).due;
      else t.due = iso(new Date(dt.getFullYear() + years, dt.getMonth(), dt.getDate()));
      commit();
      toast(`Listo. El próximo vence el ${dLong(new Date(t.due + 'T12:00:00'))}.`);
    } else {
      commit();
      tramForm(t);
      toast('Pon la nueva fecha de vencimiento.');
    }
  }
  function tramites() {
    const d = K.d;
    d.tramites ||= [];
    const today = startOfDay();
    const left = (t) => (t.due ? Math.round((new Date(t.due + 'T00:00:00') - today) / DAY) : null);
    const list = d.tramites.slice().sort((a, b) => (left(a) ?? 99999) - (left(b) ?? 99999));
    const plate = d.tramites.find((t) => t.plate)?.plate;
    const rt = plate ? riteveDue(plate) : null;
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Añadir trámite', onclick: () => tramForm(null) }),
        h('span', { class: 'hint', text: 'Te aviso un mes antes, una semana antes y el día que vence.' })
      ),
      rt && h('p', { class: 'hint', text: `Con la placa ${plate}, tu revisión técnica toca en ${MONTHS_CR[rt.month - 1]}.` }),
      h('div', { class: 'tr-grid' }, list.map((t) => {
        const n = left(t);
        const info = TRAM_INFO[t.kind];
        const cls = n == null ? 'none' : n < 0 ? 'late' : n <= 30 ? 'soon' : 'ok';
        return h('section', { class: `rx-card tr-card ${cls}` },
          h('div', { class: 'tr-head' },
            h('h3', { text: t.name }),
            h('span', { class: 'tr-left', text: n == null ? 'Sin fecha' : n < 0 ? `Vencido hace ${plural(-n, 'día', 'días')}` : n === 0 ? 'Vence hoy' : n <= 60 ? `Faltan ${plural(n, 'día', 'días')}` : `Faltan ${Math.round(n / 30)} meses` })
          ),
          h('p', { class: 'tr-date', text: t.due ? `Vence el ${dLong(new Date(t.due + 'T12:00:00'))}` : t.kind === 'riteve' ? 'Pon la placa y calculo el mes.' : 'Pon la fecha de vencimiento.' }),
          (t.plate || t.note) && h('p', { class: 'hint', text: [t.plate && `Placa ${t.plate}`, t.note].filter(Boolean).join(' · ') }),
          info && h('p', { class: 'hint', text: info[0] }),
          t.lastDone && h('p', { class: 'hint', text: `Última vez: ${dShort(new Date(t.lastDone + 'T12:00:00'))}` }),
          h('div', { class: 'tr-actions' },
            t.due && h('button', { class: 'btn ghost small', text: 'Hecho', title: TRAM_RENEW[t.kind] ? `Pasa al ${TRAM_RENEW[t.kind] === 1 ? 'próximo año' : `dentro de ${TRAM_RENEW[t.kind]} años`}` : 'Te pido la nueva fecha', onclick: () => tramDone(t) }),
            h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => tramForm(t) }),
            info && h('button', { class: 'btn subtle small', text: 'Web oficial', onclick: () => window.api.open(info[1]) })
          )
        );
      })),
      !list.length && h('p', { class: 'empty', text: 'Añade el marchamo, la revisión técnica, la licencia o la cédula y te aviso antes de que venzan.' }),
    ];
  }

  // =========================================================== MENÚ SEMANAL
  const WEEK = [['lun', 'Lunes'], ['mar', 'Martes'], ['mie', 'Miércoles'], ['jue', 'Jueves'], ['vie', 'Viernes'], ['sab', 'Sábado'], ['dom', 'Domingo']];
  const plainTxt = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function recipeForm(r) {
    const d = K.d;
    const isNew = !r;
    form(isNew ? 'Nueva receta' : 'Editar: ' + r.name, [
      { key: 'name', label: 'Nombre', value: r?.name || '', required: true, placeholder: 'Arroz con pollo, gallo pinto…' },
      { key: 'ingredients', label: 'Ingredientes (separados por coma)', type: 'textarea', value: (r?.ingredients || []).join(', '), placeholder: 'arroz, pollo, chile dulce, culantro' },
      { key: 'note', label: 'Nota', value: r?.note || '' },
    ], (v) => {
      const row = { name: v.name, ingredients: v.ingredients.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), note: v.note };
      if (isNew) d.recipes.push({ id: uid(), ...row });
      else Object.assign(r, row);
      commit();
    }, isNew ? null : () => { d.recipes = d.recipes.filter((x) => x !== r); commit(); });
  }
  function menu() {
    const d = K.d;
    d.recipes ||= [];
    d.menu ||= {};
    const todayIdx = (new Date().getDay() + 6) % 7;
    const recipeOf = (name) => d.recipes.find((r) => plainTxt(r.name) === plainTxt(name));
    const slot = (k, meal) => {
      const input = h('input', { class: 'mn-in', value: d.menu[k]?.[meal] || '', placeholder: meal === 'almuerzo' ? 'Almuerzo' : 'Cena', 'aria-label': meal + ' del ' + k });
      input.setAttribute('list', 'mnRecipes');
      input.addEventListener('change', () => { d.menu[k] = { ...(d.menu[k] || {}), [meal]: input.value.trim() }; save(); render(); });
      const r = recipeOf(input.value);
      return h('div', { class: 'mn-slot' + (input.value && !r ? ' free' : '') }, h('small', { text: meal === 'almuerzo' ? 'Almuerzo' : 'Cena' }), input, r && r.ingredients.length ? h('span', { class: 'mn-ing', text: r.ingredients.join(', ') }) : null);
    };
    const toShopping = () => {
      const want = new Map();
      for (const [k] of WEEK) for (const meal of ['almuerzo', 'cena']) for (const g of recipeOf(d.menu[k]?.[meal])?.ingredients || []) want.set(plainTxt(g), g);
      const have = new Set(d.shopping.filter((x) => !x.done).map((x) => plainTxt(x.name)));
      const add = [...want].filter(([k]) => !have.has(k)).map(([, g]) => g);
      for (const g of add) d.shopping.push({ id: uid(), name: g[0].toUpperCase() + g.slice(1), qty: '', cat: d.shopCats.includes('Súper') ? 'Súper' : d.shopCats[0], done: false, at: Date.now() });
      commit();
      toast(add.length ? plural(add.length, 'ingrediente pasado', 'ingredientes pasados') + ' a la lista de compras.' : 'Ya tienes todo en la lista de compras.');
    };
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Pasar ingredientes a compras', onclick: toShopping }),
        h('button', { class: 'btn ghost small', text: 'Nueva receta', onclick: () => recipeForm(null) }),
        h('button', { class: 'btn subtle small', text: 'Vaciar la semana', onclick: () => { d.menu = {}; commit(); } }),
        h('span', { class: 'hint', text: 'Escribe la comida o elige una receta: sus ingredientes van solos a la lista de compras.' })
      ),
      h('datalist', { id: 'mnRecipes' }, d.recipes.map((r) => h('option', { value: r.name }))),
      h('div', { class: 'mn-week' }, WEEK.map(([k, l], i) => h('section', { class: 'mn-day' + (i === todayIdx ? ' today' : '') }, h('h3', {}, l, i === todayIdx && h('span', { class: 'mn-today', text: 'Hoy' })), slot(k, 'almuerzo'), slot(k, 'cena')))),
      h('section', { class: 'rx-card mn-recipes' },
        h('h3', {}, 'Tus recetas', h('span', { class: 'count', text: String(d.recipes.length) })),
        d.recipes.length
          ? h('ul', { class: 'mn-rlist' }, d.recipes.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).map((r) => h('li', {}, h('div', {}, h('b', { text: r.name }), h('span', { class: 'hint', text: r.ingredients.join(', ') || 'Sin ingredientes' })), h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => recipeForm(r) }))))
          : h('p', { class: 'hint', text: 'Guarda tus comidas de siempre con sus ingredientes y arma la semana en segundos.' })
      ),
    ];
  }

  // =========================================================== HOGAR: MANTENIMIENTO Y GARANTÍAS
  const isoToday = () => new Date().toLocaleDateString('sv');
  const addM = (iso, n) => { const x = new Date(iso + 'T12:00:00'); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, lastDay(x.getFullYear(), x.getMonth()))); return x.toLocaleDateString('sv'); };
  const daysTo = (iso) => Math.round((new Date(iso + 'T00:00:00') - startOfDay()) / DAY);
  function maintForm(m) {
    const d = K.d;
    const isNew = !m;
    form(isNew ? 'Nueva tarea de la casa' : 'Editar: ' + m.name, [
      { key: 'name', label: 'Qué hay que hacer', value: m?.name || '', required: true, placeholder: 'Cambiar el filtro del agua…' },
      { key: 'everyMonths', label: 'Cada cuántos meses', type: 'number', min: 1, max: 120, value: m?.everyMonths ?? 6 },
      { key: 'last', label: 'La última vez que se hizo', type: 'date', value: m?.last || '' },
      { key: 'note', label: 'Nota', value: m?.note || '', placeholder: 'Marca del filtro, técnico, teléfono…' },
    ], (v) => {
      const row = { name: v.name, everyMonths: Number(v.everyMonths) || 6, last: v.last || null, note: v.note };
      if (isNew) d.maintenance.push({ id: uid(), ...row });
      else Object.assign(m, row);
      commit();
    }, isNew ? null : () => { d.maintenance = d.maintenance.filter((x) => x !== m); commit(); });
  }
  function warrantyForm(w) {
    const d = K.d;
    const isNew = !w;
    form(isNew ? 'Nueva garantía' : 'Editar: ' + w.name, [
      { key: 'name', label: 'Qué es', value: w?.name || '', required: true, placeholder: 'Refrigeradora, monitor, celular…' },
      { key: 'store', label: 'Dónde lo compraste', value: w?.store || '' },
      { key: 'bought', label: 'Fecha de compra', type: 'date', value: w?.bought || isoToday() },
      { key: 'months', label: 'Meses de garantía', type: 'number', min: 0, max: 240, value: w?.months ?? 12 },
      { key: 'link', label: 'Manual o factura (enlace https, opcional)', value: w?.link || '' },
      { key: 'note', label: 'Nota', value: w?.note || '', placeholder: 'Número de serie, factura…' },
    ], (v) => {
      if (v.link && !/^https:\/\//.test(v.link)) return 'El enlace tiene que empezar por https://';
      const row = { name: v.name, store: v.store, bought: v.bought || null, months: Number(v.months) || 0, link: v.link, note: v.note };
      if (isNew) d.warranties.push({ id: uid(), photo: '', ...row });
      else Object.assign(w, row);
      commit();
    }, isNew ? null : () => { d.warranties = d.warranties.filter((x) => x !== w); commit(); });
  }
  function pickPhoto(w) {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try { w.photo = await shrink(f); commit(); toast('Foto guardada.'); } catch (e) { toast(errMsg(e), true); }
    });
    input.click();
  }
  function hogar() {
    const d = K.d;
    d.maintenance ||= [];
    d.warranties ||= [];
    const mrows = d.maintenance.map((m) => ({ m, next: m.last ? addM(m.last, m.everyMonths || 6) : null })).sort((a, b) => (a.next ? daysTo(a.next) : -1e6) - (b.next ? daysTo(b.next) : -1e6));
    const wrows = d.warranties.map((w) => ({ w, end: w.bought && w.months ? addM(w.bought, w.months) : null })).sort((a, b) => (a.end ? daysTo(a.end) : 1e6) - (b.end ? daysTo(b.end) : 1e6));
    return [
      h('div', { class: 'hg-head' }, h('h2', { class: 'section-h', text: 'Mantenimiento' }), h('button', { class: 'btn ghost small', text: 'Nueva tarea', onclick: () => maintForm(null) }), h('span', { class: 'hint', text: 'Te aviso una semana antes y el día que toca.' })),
      h('div', { class: 'hg-grid' }, mrows.map(({ m, next }) => {
        const n = next ? daysTo(next) : null;
        const tone = n == null ? 'none' : n < 0 ? 'late' : n <= 14 ? 'soon' : 'ok';
        const pct = m.last ? Math.max(0, Math.min(100, ((Date.now() - new Date(m.last + 'T12:00:00')) / (new Date(next + 'T12:00:00') - new Date(m.last + 'T12:00:00'))) * 100)) : 0;
        return h('section', { class: 'hg-card ' + tone },
          h('div', { class: 'hg-top' }, h('b', { text: m.name }), h('span', { class: 'hg-every', text: 'cada ' + plural(m.everyMonths, 'mes', 'meses') })),
          h('p', { class: 'hg-when', text: n == null ? '¿Cuándo se hizo la última vez?' : n < 0 ? 'Atrasado ' + plural(-n, 'día', 'días') : n === 0 ? 'Toca hoy' : 'Toca ' + daysText(n).toLowerCase() }),
          m.last && h('div', { class: 'dy-bar' }, h('i', { class: tone === 'late' ? 'hot' : '', style: { width: pct + '%' } })),
          h('p', { class: 'hint', text: [m.last ? 'Última vez: ' + dShort(new Date(m.last + 'T12:00:00')) : null, m.note].filter(Boolean).join(' · ') }),
          h('div', { class: 'hg-act' }, h('button', { class: 'btn primary small', text: 'Hecho hoy', onclick: () => { m.last = isoToday(); commit(); toast(m.name + ': la próxima es el ' + dLong(new Date(addM(m.last, m.everyMonths) + 'T12:00:00')) + '.'); } }), h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => maintForm(m) }))
        );
      })),
      h('div', { class: 'hg-head' }, h('h2', { class: 'section-h', text: 'Garantías' }), h('button', { class: 'btn ghost small', text: 'Nueva garantía', onclick: () => warrantyForm(null) }), h('span', { class: 'hint', text: 'Te aviso un mes y una semana antes de que se acaben.' })),
      wrows.length ? h('div', { class: 'hg-wgrid' }, wrows.map(({ w, end }) => {
        const n = end ? daysTo(end) : null;
        const tone = n == null ? 'none' : n < 0 ? 'over' : n <= 30 ? 'soon' : 'ok';
        return h('section', { class: 'hg-war ' + tone },
          h('button', { class: 'hg-photo', title: w.photo ? 'Cambiar la foto de la factura' : 'Añadir foto de la factura', onclick: () => pickPhoto(w) }, w.photo ? h('img', { src: w.photo, alt: 'Factura de ' + w.name }) : h('span', { text: '+ Foto de la factura' })),
          h('div', { class: 'hg-war-main' },
            h('b', { text: w.name }),
            h('span', { class: 'hint', text: [w.store, w.bought ? 'comprado el ' + dShort(new Date(w.bought + 'T12:00:00')) : null].filter(Boolean).join(' · ') }),
            h('span', { class: 'hg-left ' + tone, text: n == null ? 'Sin fecha' : n < 0 ? 'Garantía vencida' : 'Cubierto hasta el ' + dLong(new Date(end + 'T12:00:00')) + ' (' + (n > 60 ? Math.round(n / 30) + ' meses' : plural(n, 'día', 'días')) + ')' }),
            h('div', { class: 'hg-act' }, w.link && h('button', { class: 'btn ghost small', text: 'Manual o factura', onclick: () => api.openLink(w.link) }), h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => warrantyForm(w) }))
          )
        );
      })) : h('p', { class: 'empty', text: 'Anota lo que compras con garantía y te aviso antes de que se acabe.' }),
    ];
  }

  // =========================================================== GASTOS COMPARTIDOS
  const CS = { paidBy: null, between: null };
  function balances(sh) {
    const bal = {};
    for (const p of sh.people) bal[p] = 0;
    for (const it of sh.items) {
      const bw = (it.between?.length ? it.between : sh.people).filter(Boolean);
      if (!bw.length) continue;
      bal[it.paidBy] = (bal[it.paidBy] || 0) + it.amount;
      for (const p of bw) bal[p] = (bal[p] || 0) - it.amount / bw.length;
    }
    const debt = Object.entries(bal).filter(([, v]) => v < -0.5).map(([p, v]) => [p, -v]).sort((a, b) => b[1] - a[1]);
    const cred = Object.entries(bal).filter(([, v]) => v > 0.5).map(([p, v]) => [p, v]).sort((a, b) => b[1] - a[1]);
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
    return { bal, moves };
  }
  function compartidos() {
    const d = K.d;
    d.shared ||= { people: ['Yo'], items: [] };
    const sh = d.shared;
    CS.paidBy ||= sh.people[0];
    CS.between ||= new Set(sh.people);
    const { bal, moves } = balances(sh);
    const desc = h('input', { class: 'rx-input', placeholder: 'Qué se pagó (luz de la abuela, súper…)' });
    const amount = h('input', { class: 'rx-input cs-amt', type: 'number', placeholder: 'Monto' });
    const add = () => {
      const a = Number(amount.value);
      if (!a) return amount.focus();
      sh.items.push({ id: uid(), date: isoToday(), desc: desc.value.trim() || 'Gasto', amount: a, paidBy: CS.paidBy, between: [...CS.between].filter((p) => sh.people.includes(p)) });
      commit();
    };
    amount.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    return [
      h('section', { class: 'cs-people' },
        sh.people.map((p) => {
          const v = Math.round(bal[p] || 0);
          return h('div', { class: 'cs-person ' + (v > 0 ? 'plus' : v < 0 ? 'minus' : '') },
            h('span', { class: 'cs-av', text: p.slice(0, 1).toUpperCase() }),
            h('b', { text: p }),
            h('span', { class: 'cs-bal', text: v > 0 ? 'le deben ' + money(v, 'CRC') : v < 0 ? 'debe ' + money(-v, 'CRC') : 'al día' }),
            p !== 'Yo' && !sh.items.some((it) => it.paidBy === p || it.between?.includes(p)) && h('button', { class: 'cs-x', 'aria-label': 'Quitar a ' + p, text: '×', onclick: () => { sh.people = sh.people.filter((x) => x !== p); commit(); } })
          );
        }),
        h('button', { class: 'cs-person cs-add', onclick: () => form('Nueva persona', [{ key: 'name', label: 'Nombre', required: true }], (v) => { if (!sh.people.includes(v.name)) { sh.people.push(v.name); CS.between.add(v.name); commit(); } }) }, h('span', { class: 'cs-av', text: '+' }), h('b', { text: 'Añadir persona' }))
      ),
      moves.length ? h('section', { class: 'rx-card cs-moves' }, h('h3', { text: 'Para quedar a mano' }), h('ul', {}, moves.map((m) => h('li', {}, h('span', {}, h('b', { text: m.from }), ' le paga a ', h('b', { text: m.to })), h('strong', { text: money(m.amount, 'CRC') }), h('button', { class: 'btn ghost small', text: 'Ya pagó', onclick: () => { sh.items.push({ id: uid(), date: isoToday(), desc: m.from + ' le pagó a ' + m.to, amount: m.amount, paidBy: m.from, between: [m.to], settle: true }); commit(); toast('Anotado.'); } }))))) : h('p', { class: 'hint', text: 'Todos están a mano.' }),
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Anotar un gasto compartido' }),
        h('div', { class: 'rx-row cs-add-row' }, desc, amount, h('select', { class: 'sn-select', 'aria-label': 'Quién pagó', onchange: (e) => { CS.paidBy = e.target.value; } }, sh.people.map((p) => h('option', { value: p, selected: p === CS.paidBy, text: 'Pagó ' + p }))), h('button', { class: 'btn primary', text: 'Anotar', onclick: add })),
        h('div', { class: 'cs-between' }, h('span', { class: 'hint', text: 'Entre:' }), sh.people.map((p) => h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: CS.between.has(p), onchange: (e) => { e.target.checked ? CS.between.add(p) : CS.between.delete(p); } }), h('span', { text: p }))))
      ),
      sh.items.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Movimientos' }), h('ul', { class: 'dy-list cs-hist' }, sh.items.slice().reverse().slice(0, 60).map((it) => h('li', { class: it.settle ? 'past' : '' }, h('span', { text: dShort(new Date(it.date + 'T12:00:00')) + ' · ' + it.desc + ' · pagó ' + it.paidBy + (it.between?.length && it.between.length < sh.people.length ? ' (entre ' + it.between.join(', ') + ')' : '') }), h('b', { text: money(it.amount, 'CRC') }), h('button', { class: 'cs-x', 'aria-label': 'Borrar movimiento', text: '×', onclick: () => { sh.items = sh.items.filter((x) => x !== it); commit(); } }))))) : null,
    ];
  }

  // =========================================================== PAGOS
  function paymentForm(p, group) {
    const d = K.d;
    const isNew = !p;
    form(isNew ? 'Nuevo pago' : `Editar: ${p.name}`, [
      { key: 'name', label: 'Qué se paga', value: p?.name, required: true, placeholder: 'Luz, internet, alquiler…' },
      { key: 'group', label: 'De quién', type: 'select', value: p?.group || group || 'Personal', options: d.payGroups.map((g) => [g, g]) },
      { key: 'day', label: 'Día del mes en que se paga', type: 'number', min: 1, max: 31, value: p?.day ?? '', hint: 'Déjalo vacío si todavía no sabes la fecha.' },
      { key: 'amount', label: 'Monto (opcional)', type: 'number', value: p?.amount ?? '' },
      { key: 'currency', label: 'Moneda', type: 'select', value: p?.currency || 'CRC', options: [['CRC', 'Colones (CRC)'], ['USD', 'Dólares (USD)'], ['ARS', 'Pesos argentinos (ARS)']] },
      { key: 'notifyDays', label: 'Avisarme con cuántos días de antelación', type: 'number', min: 0, max: 30, value: p?.notifyDays ?? 3 },
      { key: 'note', label: 'Nota', type: 'textarea', value: p?.note || '' },
    ], (v) => {
      const row = { name: v.name, group: v.group, day: v.day ? Number(v.day) : null, amount: v.amount ? Number(v.amount) : null, currency: v.currency, notifyDays: v.notifyDays === '' ? 3 : Number(v.notifyDays), note: v.note };
      if (row.day != null && (row.day < 1 || row.day > 31)) return 'El día tiene que estar entre 1 y 31.';
      if (isNew) d.payments.push({ id: uid(), paid: {}, ...row });
      else Object.assign(p, row);
      commit();
    }, isNew ? null : () => { d.payments = d.payments.filter((x) => x !== p); commit(); });
  }
  function pagos() {
    const d = K.d;
    const groups = [...new Set([...d.payGroups, ...d.payments.map((p) => p.group)])];
    const thisKey = ym(new Date());
    const today = new Date().getDate();
    const monthName = MONTHS[new Date().getMonth()];
    // estado de cada pago en este mes
    const st = (p) => {
      const n = p.day ? nextDue(p) : null;
      const paidNow = !!p.paid?.[thisKey];
      if (!p.day) return { n, paidNow, tone: 'none', chip: 'Sin día fijo' };
      if (paidNow) return { n, paidNow, tone: 'paid', chip: 'Pagado' };
      if (n.days < 0) return { n, paidNow, tone: 'late', chip: `Atrasado ${plural(-n.days, 'día', 'días')}` };
      if (n.days === 0) return { n, paidNow, tone: 'today', chip: 'Se paga hoy' };
      if (n.days <= (p.notifyDays ?? 3)) return { n, paidNow, tone: 'soon', chip: n.days === 1 ? 'Mañana' : `En ${n.days} días` };
      return { n, paidNow, tone: 'ok', chip: `En ${n.days} días` };
    };
    const row = (p) => {
      const x = st(p);
      return h('li', { class: `py-row ${x.tone}` },
        h('div', { class: 'py-day', 'aria-label': p.day ? `Día ${p.day} de cada mes` : 'Sin día fijo' },
          h('small', { text: p.day ? 'día' : '' }),
          h('b', { text: p.day ? String(p.day) : '—' }),
          h('small', { text: p.day ? 'de cada mes' : 'sin fecha' })
        ),
        h('div', { class: 'py-main' },
          h('b', { text: p.name }),
          h('span', { class: 'py-sub', text: [p.amount ? money(p.amount, p.currency) : 'Sin monto', p.note].filter(Boolean).join(' · ') })
        ),
        h('span', { class: `py-chip ${x.tone}`, text: x.chip }),
        h('div', { class: 'py-act' },
          x.paidNow
            ? h('button', { class: 'btn subtle small', text: 'Deshacer', title: `Quitar el pago de ${monthName}`, onclick: () => { const y = { ...p.paid }; delete y[thisKey]; p.paid = y; commit(); } })
            : p.day && x.n && h('button', { class: 'btn primary small', text: x.n.key === thisKey || x.tone === 'late' ? 'Marcar pagado' : `Pagar ${MONTHS[new Date(x.n.date).getMonth()]}`, onclick: () => { p.paid = { ...p.paid, [x.n.key]: Date.now() }; commit(); toast(`${p.name}: pagado.`); } }),
          h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => paymentForm(p) })
        )
      );
    };
    // resumen del mes
    const dated = d.payments.filter((p) => p.day);
    const paid = dated.filter((p) => p.paid?.[thisKey]);
    const totalOf = (list) => list.filter((p) => p.amount && (p.currency || 'CRC') === 'CRC').reduce((t, p) => t + p.amount, 0);
    const total = totalOf(dated);
    const left = totalOf(dated.filter((p) => !p.paid?.[thisKey]));
    const pct = dated.length ? paid.length / dated.length : 0;
    const next = dated.filter((p) => !p.paid?.[thisKey]).map((p) => ({ p, n: nextDue(p) })).filter((x) => x.n).sort((x, y) => x.n.days - y.n.days)[0];
    // el mes en una tira: qué se paga cada día
    const days = lastDay(new Date().getFullYear(), new Date().getMonth());
    const strip = h('div', { class: 'py-month', role: 'img', 'aria-label': `Días de pago de ${monthName}` },
      Array.from({ length: days }, (_, i) => {
        const day = i + 1;
        const here = dated.filter((p) => Math.min(p.day, days) === day);
        const allPaid = here.length && here.every((p) => p.paid?.[thisKey]);
        return h('div', { class: `py-cell ${day === today ? 'now' : ''} ${here.length ? (allPaid ? 'paid' : day < today ? 'late' : 'due') : ''}`, title: here.length ? `Día ${day}: ${here.map((p) => p.name + (p.group !== 'Personal' ? ` (${p.group})` : '')).join(', ')}` : `Día ${day}` },
          h('span', { text: String(day) }),
          here.length ? h('i', { text: here.length > 1 ? String(here.length) : '' }) : null
        );
      })
    );
    const ring = (v) => {
      const r = 34;
      const c = 2 * Math.PI * r;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 80 80');
      svg.setAttribute('class', 'py-ring');
      svg.innerHTML = `<circle cx="40" cy="40" r="${r}" class="bg"/><circle cx="40" cy="40" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}"/>`;
      return svg;
    };
    return [
      h('section', { class: 'py-hero' },
        h('div', { class: 'py-hero-ring' }, ring(pct), h('div', {}, h('b', { text: `${paid.length}/${dated.length}` }), h('small', { text: 'pagados' }))),
        h('div', { class: 'py-hero-main' },
          h('p', { class: 'ks-kicker', text: `Pagos de ${monthName}` }),
          // sin montos anotados, "todo pagado" solo si de verdad no queda ninguno
          h('h2', { text: left ? `Te falta pagar ${money(left, 'CRC')}` : dated.length > paid.length ? `Te faltan ${dated.length - paid.length} ${dated.length - paid.length === 1 ? 'pago' : 'pagos'}` : dated.length ? 'Todo pagado este mes' : 'Pon el día de tus pagos' }),
          h('p', { class: 'hint', text: [total ? `Total del mes: ${money(total, 'CRC')}` : null, next ? `Lo próximo: ${next.p.name}, ${next.n.days === 0 ? 'hoy' : next.n.days < 0 ? `atrasado desde el día ${next.p.day}` : `el día ${next.p.day} (${next.n.days === 1 ? 'mañana' : `en ${next.n.days} días`})`}` : null].filter(Boolean).join(' · ') })
        )
      ),
      strip,
      h('p', { class: 'py-legend' }, h('span', { class: 'due', text: 'Por pagar' }), h('span', { class: 'paid', text: 'Pagado' }), h('span', { class: 'late', text: 'Atrasado' }), h('span', { class: 'hint', text: 'Pasa el ratón por un día para ver qué se paga.' })),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Nuevo pago', onclick: () => paymentForm(null) }),
        h('button', { class: 'btn ghost small', text: 'Foto de un recibo', onclick: () => window.v126?.receipt(d) }),
        h('button', { class: 'btn ghost small', text: 'Nuevo grupo', onclick: () => form('Nuevo grupo de pagos', [{ key: 'name', label: 'Nombre', required: true, placeholder: 'Mamá, Casa de playa…' }], (v) => { if (!d.payGroups.includes(v.name)) { d.payGroups.push(v.name); commit(); } }) }),
        h('span', { class: 'hint', text: 'Te aviso unos días antes de cada pago, el mismo día y si se atrasa.' })
      ),
      groups.map((g) => {
        const list = d.payments.filter((p) => p.group === g).sort((x, y) => (x.day || 99) - (y.day || 99));
        const gl = list.filter((p) => p.day && !p.paid?.[thisKey]).length;
        return h('section', { class: 'py-group' },
          h('div', { class: 'py-group-h' },
            h('h3', { text: g }),
            h('span', { class: 'hint', text: list.length ? (gl ? `${gl} por pagar` : 'al día') : '' }),
            h('button', { class: 'btn subtle small', text: '+ Añadir', onclick: () => paymentForm(null, g) }),
            !list.length && g !== 'Personal' && h('button', { class: 'btn subtle small', text: 'Quitar grupo', onclick: () => { d.payGroups = d.payGroups.filter((x) => x !== g); commit(); } })
          ),
          list.length ? h('ul', { class: 'py-list' }, list.map(row)) : h('p', { class: 'hint', text: 'Sin pagos en este grupo.' })
        );
      }),
      window.v126?.bills(d),
    ];
  }

  // =========================================================== RECORDATORIOS
  function reminderForm(r) {
    const d = K.d;
    const isNew = !r;
    form(isNew ? 'Nuevo recordatorio' : 'Editar recordatorio', [
      { key: 'title', label: 'Qué', value: r?.title, required: true, placeholder: 'Mi madre viene de visita' },
      { key: 'date', label: 'Fecha', type: 'date', value: r?.date || '', required: true },
      { key: 'time', label: 'Hora (opcional)', type: 'time', value: r?.time || '' },
      { key: 'notifyDays', label: 'Avisarme con cuántos días de antelación', type: 'number', min: 0, max: 60, value: r?.notifyDays ?? 1 },
      { key: 'note', label: 'Nota', type: 'textarea', value: r?.note || '' },
    ], (v) => {
      if (!v.date) return 'Pon la fecha.';
      const row = { title: v.title, date: v.date, time: v.time, notifyDays: v.notifyDays === '' ? 1 : Number(v.notifyDays), note: v.note };
      if (isNew) d.reminders.push({ id: uid(), done: false, ...row });
      else Object.assign(r, row);
      commit();
    }, isNew ? null : () => { d.reminders = d.reminders.filter((x) => x !== r); commit(); });
  }
  function recordatorios() {
    const d = K.d;
    const today = startOfDay();
    const withDays = d.reminders.map((r) => ({ r, days: Math.round((new Date(r.date + 'T00:00:00').getTime() - today) / DAY) }));
    const next = withDays.filter((x) => x.days >= 0 && !x.r.done).sort((a, b) => a.days - b.days);
    const past = withDays.filter((x) => x.days < 0 || x.r.done).sort((a, b) => b.days - a.days);
    const row = ({ r, days }) => h('li', { class: `ks-rem ${r.done ? 'done' : ''} ${days <= 1 && days >= 0 ? 'soon' : ''}` },
      h('div', { class: 'ks-when' }, h('b', { text: new Date(r.date + 'T12:00:00').getDate() }), h('span', { text: MONTHS[new Date(r.date + 'T12:00:00').getMonth()].slice(0, 3) })),
      h('div', { class: 'ks-pay-main' }, h('b', { text: r.title }), h('p', { class: 'hint', text: [dLong(new Date(r.date + 'T12:00:00')), r.time && `a las ${r.time}`, r.note].filter(Boolean).join(' · ') })),
      h('span', { class: 'ks-days', text: r.done ? 'Hecho' : daysText(days) }),
      h('div', { class: 'ks-pay-act' }, h('button', { class: 'btn subtle small', text: r.done ? 'Reabrir' : 'Hecho', onclick: () => { r.done = !r.done; commit(); } }), h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => reminderForm(r) }))
    );
    return [
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn primary small', text: 'Nuevo recordatorio', onclick: () => reminderForm(null) }), h('span', { class: 'hint', text: 'Te aviso antes y el mismo día.' })),
      next.length ? h('ul', { class: 'ks-rems' }, next.map(row)) : h('p', { class: 'empty' }, h('b', { text: 'Nada por delante' }), 'Añade visitas, citas o lo que no quieras olvidar.'),
      past.length ? h('details', { class: 'notes' }, h('summary', { text: `Pasados o hechos (${past.length})` }), h('ul', { class: 'ks-rems' }, past.map(row))) : null,
    ];
  }

  // =========================================================== CUMPLEAÑOS
  function birthdayForm(b, kind) {
    const d = K.d;
    const isNew = !b;
    form(isNew ? (kind === 'gato' ? 'Nuevo gatito' : 'Nuevo cumpleaños') : `Editar: ${b.name}`, [
      { key: 'name', label: 'Nombre', value: b?.name, required: true },
      { key: 'kind', label: 'Es', type: 'select', value: b?.kind || kind || 'persona', options: [['persona', 'Persona'], ['gato', 'Gato']] },
      { key: 'day', label: 'Día', type: 'number', min: 1, max: 31, value: b?.day ?? '', hint: 'Si no sabes el día, déjalo vacío y pon solo el mes.' },
      { key: 'month', label: 'Mes', type: 'select', value: b?.month || '', options: MONTHS.map((m, i) => [i + 1, m[0].toUpperCase() + m.slice(1)]) },
      { key: 'year', label: 'Año de nacimiento (opcional, para saber la edad)', type: 'number', min: 1900, max: 2100, value: b?.year ?? '' },
      { key: 'note', label: 'Nota', value: b?.note || '', placeholder: 'Mi hermano, amigo, regalo pensado…' },
    ], (v) => {
      const row = { name: v.name, kind: v.kind, day: v.day ? Number(v.day) : null, month: Number(v.month), year: v.year ? Number(v.year) : null, note: v.note };
      if (row.day && row.day > lastDay(2024, row.month - 1)) return 'Ese mes no tiene tantos días.';
      if (isNew) d.birthdays.push({ id: uid(), ...row });
      else Object.assign(b, row);
      commit();
    }, isNew ? null : () => { d.birthdays = d.birthdays.filter((x) => x !== b); commit(); });
  }
  function cumpleanos() {
    const d = K.d;
    const plain = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const ideasFor = (name) => {
      const who = plain(name);
      return (d.gifts || []).filter((g) => g.status === 'idea' && (plain(g.for) === who || who.startsWith(plain(g.for)) || plain(g.for).startsWith(who.split(' ')[0]))).length;
    };
    const rows = d.birthdays.map((b) => ({ b, n: nextBirthday(b) })).sort((a, b) => a.n.days - b.n.days || (a.b.day || 0) - (b.b.day || 0));
    const people = rows.filter((x) => x.b.kind !== 'gato');
    const cats = rows.filter((x) => x.b.kind === 'gato');
    const dateText = (b) => (b.day ? `${b.day} de ${MONTHS[b.month - 1]}` : `${MONTHS[b.month - 1][0].toUpperCase() + MONTHS[b.month - 1].slice(1)}, día por confirmar`);
    const leftText = (n) => (n.days === 0 ? (n.monthOnly ? 'Este mes' : '¡Hoy!') : daysText(n.days));
    const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

    // --- el próximo, en grande, y los siguientes al lado
    const [first, ...rest] = rows;
    const hero = first && h('section', { class: `bd-hero ${first.n.days === 0 ? 'party' : ''} ${first.b.kind === 'gato' ? 'cat' : ''}` },
      h('div', { class: 'bd-hero-count' }, h('b', { text: first.n.days === 0 ? '¡Hoy!' : String(first.n.days) }), first.n.days ? h('span', { text: first.n.days === 1 ? 'día' : 'días' }) : null),
      h('div', { class: 'bd-hero-main' },
        h('p', { class: 'ks-kicker', text: first.n.days === 0 ? 'Hoy es el cumple de' : first.b.kind === 'gato' ? 'Próximo cumple gatuno' : 'Próximo cumpleaños' }),
        h('h2', { text: first.b.name }),
        h('p', { class: 'hint', text: [first.b.day ? dLong(first.n.date) : dateText(first.b), first.n.age ? `cumple ${first.n.age}` : null].filter(Boolean).join(' · ') }),
        first.b.kind !== 'gato' && (() => {
          const n = ideasFor(first.b.name);
          return h('button', { class: 'btn ghost small', text: n ? `Ver ${plural(n, 'idea', 'ideas')} de regalo` : 'Anotar una idea de regalo', onclick: () => showView('casa-regalos') });
        })()
      )
    );
    const later = h('ol', { class: 'bd-later' }, rest.slice(0, 5).map(({ b, n }) => h('li', { class: b.kind === 'gato' ? 'cat' : '' },
      h('span', { class: 'bd-later-d', text: b.day ? `${b.day} ${MONTHS[b.month - 1].slice(0, 3)}` : MONTHS[b.month - 1].slice(0, 3) }),
      h('b', { text: b.name }),
      h('span', { class: 'bd-later-left', text: leftText(n) })
    )));

    // --- el año entero, mes a mes
    const thisMonth = new Date().getMonth();
    const year = h('div', { class: 'bd-year' }, MONTHS.map((m, i) => {
      const inMonth = d.birthdays.filter((b) => b.month === i + 1).sort((x, y) => (x.day || 99) - (y.day || 99));
      return h('div', { class: `bd-month ${i === thisMonth ? 'now' : ''} ${inMonth.length ? '' : 'empty'}` },
        h('h4', { text: m.slice(0, 3) }),
        inMonth.map((b) => {
          const n = nextBirthday(b);
          return h('button', { class: `bd-chip ${b.kind === 'gato' ? 'cat' : ''} ${n.days === 0 && !n.monthOnly ? 'today' : ''}`, title: `${b.name} · ${dateText(b)}`, onclick: () => birthdayForm(b) },
            h('span', { text: b.day || '?' }), b.name);
        })
      );
    }));

    // --- personas
    const personRow = ({ b, n }) => {
      const ideas = ideasFor(b.name);
      return h('li', { class: `bd-person ${n.days === 0 ? 'today' : n.days <= 7 ? 'soon' : ''}` },
        h('span', { class: 'bd-avatar', style: { '--hue': String((b.month * 30) % 360) }, text: initials(b.name) }),
        h('div', { class: 'bd-person-main' }, h('b', { text: b.name }), h('span', { class: 'hint', text: [dateText(b), n.age ? `cumple ${n.age}` : null, b.note].filter(Boolean).join(' · ') })),
        ideas ? h('button', { class: 'bd-ideas', text: plural(ideas, 'idea', 'ideas'), title: 'Ideas de regalo', onclick: () => showView('casa-regalos') }) : h('span'),
        h('span', { class: 'bd-left', text: leftText(n) }),
        h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => birthdayForm(b) })
      );
    };

    // --- gatitos, del mayor al menor (los que no tienen año van al final)
    const born = (b) => (b.year ? b.year * 10000 + b.month * 100 + (b.day || 15) : Infinity);
    const catsByAge = cats.slice().sort((x, y) => born(x.b) - born(y.b) || x.b.name.localeCompare(y.b.name));
    const withYear = catsByAge.filter((x) => x.b.year);
    const ageNow = (b) => {
      if (!b.year) return null;
      const today = new Date();
      let age = today.getFullYear() - b.year;
      if (today.getMonth() + 1 < b.month || (today.getMonth() + 1 === b.month && b.day && today.getDate() < b.day)) age--;
      return Math.max(0, age);
    };
    const catCard = ({ b, n }) => {
      const age = ageNow(b);
      const yearIn = h('input', { class: 'rx-input bd-year-in', type: 'number', min: 1990, max: new Date().getFullYear(), placeholder: 'Año', 'aria-label': `Año en que nació ${b.name}` });
      const setYear = () => {
        const y = Number(yearIn.value);
        if (!y || y < 1990 || y > new Date().getFullYear()) return yearIn.focus();
        b.year = y;
        commit();
      };
      yearIn.addEventListener('keydown', (e) => e.key === 'Enter' && setYear());
      const rank = withYear.length > 1 && b.year ? (b === withYear[0].b ? 'El mayor' : b === withYear[withYear.length - 1].b ? 'El menor' : null) : null;
      return h('li', { class: `bd-cat ${n.days === 0 && !n.monthOnly ? 'today' : n.days <= 7 ? 'soon' : ''}` },
        rank && h('span', { class: 'bd-rank', text: rank }),
        h('div', { class: 'bd-cat-age' }, age != null ? [h('b', { text: String(age) }), h('span', { text: age === 1 ? 'año' : 'años' })] : h('span', { class: 'hint', text: 'Edad sin anotar' })),
        h('h4', { text: b.name }),
        h('p', { class: 'hint', text: [dateText(b), b.year ? `nació en ${b.year}` : null].filter(Boolean).join(' · ') }),
        h('p', { class: 'bd-cat-left', text: n.days === 0 ? (n.monthOnly ? 'Cumple este mes' : '¡Hoy cumple!') : `Cumple ${daysText(n.days).toLowerCase()}` }),
        b.year ? h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => birthdayForm(b) }) : h('div', { class: 'bd-year-set' }, yearIn, h('button', { class: 'btn ghost small', text: 'Guardar', onclick: setYear }))
      );
    };

    return [
      h('div', { class: 'bd-top' }, hero, rest.length ? h('section', { class: 'bd-next' }, h('h3', { class: 'rx-squad-h', text: 'Después' }), later) : null),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Añadir persona', onclick: () => birthdayForm(null, 'persona') }),
        h('button', { class: 'btn ghost small', text: 'Añadir gatito', onclick: () => birthdayForm(null, 'gato') }),
        h('span', { class: 'hint', text: 'Te aviso el día antes y el mismo día; con ideas de regalo, también 14 y 3 días antes.' })
      ),
      h('section', { class: 'bd-sec' }, h('h3', { class: 'rx-squad-h', text: 'Tu año en cumpleaños' }), year),
      h('div', { class: 'bd-cols' },
        h('section', { class: 'bd-sec' }, h('h3', { class: 'rx-squad-h' }, 'Personas', h('span', { class: 'count', text: String(people.length) })), h('ul', { class: 'bd-people' }, people.map(personRow))),
        h('section', { class: 'bd-sec' },
          h('h3', { class: 'rx-squad-h' }, 'Gatitos, del mayor al menor', h('span', { class: 'count', text: String(cats.length) })),
          cats.length > withYear.length && h('p', { class: 'hint', text: withYear.length ? 'Los que no tienen año van al final: pon el año en que nació cada uno para ordenarlos.' : 'Pon el año en que nació cada uno y los ordeno del mayor al menor.' }),
          h('ul', { class: 'bd-cats' }, catsByAge.map(catCard))
        )
      ),
    ];
  }

  // =========================================================== FERIADOS
  async function loadHolidays() {
    const y = new Date().getFullYear();
    K.hol = await api.holidays([y, y + 1]).catch(() => []);
    render();
  }
  function myDates(y, m) {
    // cumpleaños, recordatorios y pagos del mes, para verlos en el calendario
    const out = [];
    for (const b of K.d.birthdays) if (b.month === m + 1) out.push({ day: b.day, label: `🎂 ${b.name}`, kind: 'bd' });
    for (const r of K.d.reminders) {
      const dt = new Date(r.date + 'T12:00:00');
      if (dt.getFullYear() === y && dt.getMonth() === m) out.push({ day: dt.getDate(), label: r.title, kind: 'rem' });
    }
    for (const p of K.d.payments) if (p.day) out.push({ day: Math.min(p.day, lastDay(y, m)), label: `Pago: ${p.name}${p.group !== 'Personal' ? ` (${p.group})` : ''}`, kind: 'pay' });
    return out;
  }
  function feriados() {
    if (!K.hol) {
      loadHolidays();
      return skeleton();
    }
    const today = new Date(startOfDay());
    const sel = K.holCountries;
    const list = K.hol.filter((x) => sel.has(x.country));
    const chips = h('div', { class: 'chips' }, Object.entries(C_LABEL).map(([c, l]) => h('button', { class: `chip ks-c-${c}`, 'aria-pressed': String(sel.has(c)), onclick: () => { sel.has(c) ? sel.delete(c) : sel.add(c); K.d.holidayCountries = [...sel]; commit(); } }, l)));
    const views = h('div', { class: 'seg' }, h('button', { class: K.holView === 'list' ? 'on' : '', text: 'Lista', onclick: () => ((K.holView = 'list'), render()) }), h('button', { class: K.holView === 'cal' ? 'on' : '', text: 'Calendario', onclick: () => ((K.holView = 'cal'), render()) }));
    const tag = (c) => h('span', { class: `ks-ctag ks-c-${c}`, text: C_LABEL[c] });
    if (K.holView === 'list') {
      const upcoming = list.filter((x) => new Date(x.date + 'T12:00:00') >= today).slice(0, 60);
      const byMonth = new Map();
      for (const x of upcoming) {
        const k = x.date.slice(0, 7);
        if (!byMonth.has(k)) byMonth.set(k, []);
        byMonth.get(k).push(x);
      }
      return [
        h('div', { class: 'toolbar flat' }, views, chips),
        upcoming[0] && h('section', { class: 'ks-next' }, h('p', { class: 'ks-kicker', text: 'Próximo feriado' }), h('h2', {}, upcoming[0].name, ' ', tag(upcoming[0].country)), h('p', { class: 'ks-big' }, h('b', { text: String(Math.round((new Date(upcoming[0].date + 'T00:00:00') - today) / DAY)) }), h('span', { text: ' días' })), h('p', { class: 'hint', text: dLong(new Date(upcoming[0].date + 'T12:00:00')) })),
        [...byMonth.entries()].map(([k, l]) => h('section', { class: 'ks-group' }, h('h3', { class: 'rx-squad-h', text: `${MONTHS[Number(k.slice(5)) - 1][0].toUpperCase()}${MONTHS[Number(k.slice(5)) - 1].slice(1)} ${k.slice(0, 4)}` }), h('ul', { class: 'ks-rems' }, l.map((x) => {
          const dt = new Date(x.date + 'T12:00:00');
          return h('li', { class: 'ks-hol' }, h('div', { class: 'ks-when' }, h('b', { text: dt.getDate() }), h('span', { text: dt.toLocaleDateString('es', { weekday: 'short' }) })), h('div', { class: 'ks-pay-main' }, h('b', { text: x.name }), x.en && x.en !== x.name && h('p', { class: 'hint', text: x.en })), tag(x.country), h('span', { class: 'ks-days', text: daysText(Math.round((dt - today) / DAY)) }));
        })))),
        h('p', { class: 'hint rx-foot', text: 'Feriados nacionales oficiales (Nager.Date). En EE. UU. se muestra el día en que se observa. En Argentina no aparecen los días no laborables con fines turísticos que el gobierno decide cada año.' }),
      ];
    }
    // calendario
    const base = K.holMonth || new Date(today.getFullYear(), today.getMonth(), 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7; // lunes primero
    const days = lastDay(y, m);
    const mine = K.mine ? myDates(y, m) : [];
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(h('div', { class: 'ks-cell empty' }));
    for (let dd = 1; dd <= days; dd++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const hs = list.filter((x) => x.date === key);
      const ms = mine.filter((x) => x.day === dd);
      const isToday = new Date(y, m, dd).getTime() === today.getTime();
      cells.push(h('div', { class: `ks-cell ${hs.length ? 'hol' : ''} ${isToday ? 'today' : ''}` },
        h('b', { text: dd }),
        hs.map((x) => h('span', { class: `ks-ev ks-c-${x.country}`, title: `${C_LABEL[x.country]}: ${x.name}`, text: x.name })),
        ms.map((x) => h('span', { class: `ks-ev mine ${x.kind}`, title: x.label, text: x.label }))
      ));
    }
    const go = (k) => {
      K.holMonth = new Date(y, m + k, 1);
      render();
    };
    return [
      h('div', { class: 'toolbar flat' }, views, chips, h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: K.mine, onchange: (e) => { K.mine = e.target.checked; render(); } }), h('span', { text: 'Ver también mis fechas' }))),
      h('div', { class: 'ks-calhead' }, h('button', { class: 'btn ghost small', text: '‹ Anterior', onclick: () => go(-1) }), h('h2', { text: `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${y}` }), h('button', { class: 'btn ghost small', text: 'Siguiente ›', onclick: () => go(1) })),
      h('div', { class: 'ks-cal' }, ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((x) => h('div', { class: 'ks-dow', text: x })), cells),
    ];
  }

  // =========================================================== vista
  // =========================================================== ALQUILERES (Facebook Marketplace)
  const MK = { st: null, busy: false, error: null, filter: 'all', prefsOpen: false };
  const mk = window.api.market;
  mk.onCity(async () => {
    MK.st = await mk.state();
    toast('Ubicación guardada: ya puedes buscar.');
    render();
  });
  async function mkSearch() {
    MK.busy = true;
    MK.error = null;
    render();
    try {
      const r = await mk.search();
      if (r.login) {
        MK.error = 'login';
        mk.openWindow();
      } else {
        MK.st.last = r;
        const n = r.list.filter((x) => x.isNew).length;
        toast(`${plural(r.list.length, 'alquiler', 'alquileres')}${n ? `, ${n} nuevos` : ''}.`);
      }
    } catch (e) {
      MK.error = errMsg(e);
    }
    MK.busy = false;
    render();
    updateBadge();
  }
  function alquileres() {
    if (!MK.st) {
      mk.state().then((s) => { MK.st = s; render(); });
      return skeleton();
    }
    const { prefs: p, last, saved } = MK.st;
    const crc = (n) => `₡${Number(n).toLocaleString('es')}`;
    const list = (last?.list || []).filter((x) => MK.filter === 'all' || (MK.filter === 'new' ? x.isNew : !!saved[x.id]));
    const shown = MK.filter === 'saved' ? Object.values(saved) : list;
    const card = (x) => {
      const on = !!saved[x.id];
      return h('article', { class: `mk-card ${on ? 'on' : ''}` },
        h('button', { class: 'mk-img', onclick: () => mk.openItem(x.id), 'aria-label': `Abrir ${x.title} en Facebook` }, x.image ? h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : h('span', { text: 'Sin foto' }), x.isNew && h('span', { class: 'rx-tag new mk-new', text: 'Nuevo' })),
        h('div', { class: 'mk-body' },
          h('b', { class: 'mk-price', text: x.price || 'Sin precio' }),
          h('p', { class: 'mk-title', text: x.title }),
          x.where && h('p', { class: 'hint', text: x.where }),
          x.extra && h('p', { class: 'hint', text: x.extra }),
          h('div', { class: 'rx-row mk-act' },
            h('button', { class: 'btn primary small', text: 'Abrir en Facebook', onclick: () => mk.openItem(x.id) }),
            h('button', { class: 'btn subtle small', text: on ? '★ Guardado' : '☆ Guardar', 'aria-pressed': String(on), onclick: async () => { MK.st.saved = await mk.star(x, !on); render(); } })
          )
        )
      );
    };
    const pIn = { place: h('input', { class: 'rx-input', value: p.place }), min: h('input', { class: 'rx-input', type: 'number', value: p.min, step: 5000 }), max: h('input', { class: 'rx-input', type: 'number', value: p.max, step: 5000 }), only: h('input', { type: 'checkbox', checked: p.onlyPlace }) };
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary', text: MK.busy ? 'Buscando…' : 'Buscar alquileres', disabled: MK.busy, onclick: mkSearch }),
        h('button', { class: 'btn ghost small', text: 'Preferencias', onclick: () => { MK.prefsOpen = !MK.prefsOpen; render(); } }),
        h('button', { class: 'btn subtle small', text: p.city ? 'Abrir Facebook' : 'Elegir ubicación en Facebook', onclick: () => mk.openWindow() }),
        h('span', { class: 'hint', text: `${p.place} · ${crc(p.min)} a ${crc(p.max)} · alquiler de propiedades` }),
        p.city && h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: MK.alerts !== false, onchange: (e) => { MK.alerts = e.target.checked; window.api.saveSettings({ rentAlerts: e.target.checked }); } }), h('span', { text: 'Buscar sola cada 4 horas y avisarme de las nuevas' }))
      ),
      !p.city && h('div', { class: 'notice' }, h('span', { text: `Paso único: pulsa «Elegir ubicación en Facebook», inicia sesión si te lo pide y, en el filtro de ubicación de Marketplace, elige ${p.place}. La app lo recuerda sola y desde ahí busca siempre allí.` })),
      MK.error === 'login' && h('div', { class: 'notice' }, h('span', { text: 'Facebook pide iniciar sesión: entra en la ventana que se abrió y vuelve a pulsar «Buscar alquileres».' })),
      MK.error && MK.error !== 'login' && h('p', { class: 'hint bad', text: MK.error }),
      MK.prefsOpen && h('section', { class: 'rx-card li-prefs' },
        h('h3', { text: 'Qué buscar' }),
        h('div', { class: 'ks-two' }, h('label', { class: 'ks-field' }, h('span', { text: 'Precio mínimo (colones)' }), pIn.min), h('label', { class: 'ks-field' }, h('span', { text: 'Precio máximo (colones)' }), pIn.max)),
        h('label', { class: 'ks-field' }, h('span', { text: 'Lugar' }), pIn.place),
        h('label', { class: 'rx-check' }, pIn.only, h('span', { text: 'Mostrar solo los que dicen ese lugar (Marketplace también trae pueblos vecinos)' })),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', text: 'Cancelar', onclick: () => { MK.prefsOpen = false; render(); } }), h('button', { class: 'btn primary', text: 'Guardar', onclick: async () => { await mk.savePrefs({ place: pIn.place.value, min: pIn.min.value, max: pIn.max.value, onlyPlace: pIn.only.checked }); MK.st = await mk.state(); MK.prefsOpen = false; render(); } }))
      ),
      !!(last || Object.keys(saved).length) && h('div', { class: 'row wk-filters' },
        h('div', { class: 'seg' }, [['all', 'Todos'], ['new', 'Nuevos'], ['saved', `Guardados (${Object.keys(saved).length})`]].map(([k2, t]) => h('button', { class: MK.filter === k2 ? 'on' : '', text: t, onclick: () => { MK.filter = k2; render(); } }))),
        last && h('span', { class: 'hint', text: `Búsqueda de ${relTime(last.at / 1000)}.` })
      ),
      shown.length ? h('div', { class: 'mk-grid' }, shown.map(card)) : last ? h('p', { class: 'hint', text: 'No hay publicaciones en este filtro.' }) : h('p', { class: 'empty' }, h('b', { text: 'Pulsa «Buscar alquileres»' }), 'Trae las publicaciones de alquiler de Facebook Marketplace con tu precio y tu lugar.'),
      h('p', { class: 'hint rx-foot', text: 'Se lee Marketplace con tu sesión de Facebook solo cuando pulsas «Buscar». ViperTeca no publica ni escribe a nadie: abres la publicación en tu navegador y contactas tú.' }),
    ];
  }

  // =========================================================== REGALOS
  const GIFT_ST = [['idea', 'Idea'], ['bought', 'Comprado'], ['given', 'Entregado']];
  // reduce la foto a 600 px y la guarda como JPEG dentro de casa.json
  function shrink(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('No pude leer esa imagen.'));
      img.src = url;
    });
  }
  function giftForm(g, person) {
    const d = K.d;
    const isNew = !g;
    let image = g?.image || '';
    const preview = h('div', { class: 'gt-photo' });
    const showPreview = () => fill(preview, image ? h('img', { src: image, alt: '' }) : h('span', { text: 'Sin foto. Elige una, pégala con Ctrl+V o pega el enlace de la imagen.' }));
    showPreview();
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', onchange: async (e) => { const f = e.target.files[0]; if (f) { image = await shrink(f).catch((x) => { toast(errMsg(x), true); return image; }); showPreview(); } } });
    const urlIn = h('input', { class: 'rx-input', placeholder: 'https://… enlace de la imagen (opcional)', onchange: (e) => { if (/^https:\/\//.test(e.target.value.trim())) { image = e.target.value.trim(); showPreview(); } } });
    const f = {
      name: h('input', { class: 'rx-input', value: g?.name || '', required: true, placeholder: 'Qué regalo' }),
      for: h('select', { class: 'sn-select' }, d.giftPeople.map((p) => h('option', { value: p, text: p, selected: (g?.for || person || 'Emi') === p }))),
      note: h('input', { class: 'rx-input', value: g?.note || '', placeholder: 'Tono, talla, color, dónde lo vende…' }),
      occasion: h('input', { class: 'rx-input', value: g?.occasion || '', placeholder: 'Cumpleaños, Navidad, aniversario…' }),
      price: h('input', { class: 'rx-input', type: 'number', value: g?.price ?? '', placeholder: 'Precio aproximado (opcional)' }),
      link: h('input', { class: 'rx-input', value: g?.link || '', placeholder: 'https://… enlace del producto: se completa solo' }),
    };
    const status = h('small', { class: 'hint gt-read' });
    let meta = {};
    f.link.addEventListener('change', async () => {
      const u = f.link.value.trim();
      if (!/^https?:\/\//.test(u)) return;
      status.textContent = 'Leyendo el enlace…';
      try {
        meta = await window.api.giftLinkMeta(u);
        if (meta.name && !f.name.value.trim()) f.name.value = meta.name;
        if (meta.price != null && !f.price.value) f.price.value = meta.price;
        if (meta.image && !image) {
          image = meta.image;
          showPreview();
        }
        status.textContent = meta.name || meta.image ? 'Listo: ' + [meta.store, meta.price != null ? money(meta.price, meta.currency || '') : null].filter(Boolean).join(' · ') : 'No pude leer ese enlace; completa a mano.';
      } catch (e) {
        status.textContent = errMsg(e);
      }
    });
    const field = (l, el) => h('label', { class: 'ks-field' }, h('span', { text: l }), el);
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide' });
    const form = h('form', { method: 'dialog' },
      h('h2', { text: isNew ? 'Nuevo regalo' : 'Editar regalo' }),
      h('div', { class: 'gt-form' },
        h('div', {}, preview, h('div', { class: 'rx-row' }, h('button', { type: 'button', class: 'btn ghost small', text: 'Elegir foto', onclick: () => file.click() }), image && h('button', { type: 'button', class: 'btn subtle small', text: 'Quitar foto', onclick: () => { image = ''; showPreview(); } })), file, urlIn),
        h('div', { class: 'gt-fields' }, field('Regalo', f.name), field('Para', f.for), field('Detalles', f.note), field('Ocasión', f.occasion), field('Precio', f.price), field('Enlace del producto', f.link), status)
      ),
      h('div', { class: 'actions' },
        !isNew && h('button', { type: 'button', class: 'btn subtle', text: 'Eliminar', onclick: (e) => { const b = e.currentTarget; if (b.dataset.sure) { d.gifts = d.gifts.filter((x) => x !== g); commit(); dlg.close(); } else { b.dataset.sure = '1'; b.textContent = 'Pulsa otra vez para eliminar'; } } }),
        h('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: () => dlg.close() }),
        h('button', { class: 'btn primary', text: 'Guardar' })
      )
    );
    form.addEventListener('submit', (e) => {
      const name = f.name.value.trim();
      if (!name) return e.preventDefault();
      const link = f.link.value.trim();
      const row = { name, for: f.for.value, note: f.note.value.trim(), occasion: f.occasion.value.trim(), price: f.price.value ? Number(f.price.value) : null, link: /^https:\/\//.test(link) ? link : '', image, currency: meta.currency || g?.currency || null, store: meta.store || g?.store || '' };
      if (isNew) d.gifts.push({ id: uid(), status: 'idea', at: Date.now(), ...row });
      else Object.assign(g, row);
      commit();
    });
    // pegar una imagen con Ctrl+V mientras el diálogo está abierto
    dlg.addEventListener('paste', async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      image = await shrink(item.getAsFile()).catch(() => image);
      showPreview();
    });
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    f.name.focus();
  }
  // QR y enlaces de la página de Emi
  async function emiLink(renew) {
    let info = null;
    try {
      info = await window.api.giftLink(!!renew);
    } catch (e) {
      return toast(errMsg(e), true);
    }
    if (!info?.url && !info?.tsUrl) return toast('Enciende «El celular» en Ajustes para crear el enlace.', true);
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide' });
    const copy = (u) => navigator.clipboard.writeText(u).then(() => toast('Enlace copiado.'));
    const opt = (title, hint, url, qr) => url && h('div', { class: 'gl-opt' }, h('img', { src: qr, alt: 'QR de ' + title }), h('div', {}, h('b', { text: title }), h('p', { class: 'hint', text: hint }), h('button', { class: 'btn subtle small', text: 'Copiar enlace', onclick: () => copy(url) })));
    dlg.append(
      h('h2', { text: 'Página de regalos para Emi' }),
      h('p', { class: 'hint', text: 'Emi pega el enlace de lo que le gusta y aparece aquí al instante. Su página solo deja añadir y ver lo que ella añadió: no ve tus ideas ni si ya compraste algo. En el iPhone: Compartir → Añadir a pantalla de inicio.' }),
      h('div', { class: 'gl-opts' },
        opt('En la wifi de casa', 'Escanéalo con su cámara estando en la misma wifi.', info.url, info.qr),
        opt('Desde cualquier lugar (Tailscale)', 'Su celular tiene que estar en tu Tailscale: compártele el PC desde Tailscale.', info.httpsUrl || info.tsUrl, info.httpsQr || info.tsQr)
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn subtle', text: 'Cambiar el enlace', title: 'El enlace anterior deja de funcionar', onclick: () => { dlg.close(); emiLink(true); } }),
        h('button', { class: 'btn primary', text: 'Listo', onclick: () => dlg.close() })
      )
    );
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
  function regalos() {
    const d = K.d;
    const people = [...new Set([...(d.giftPeople || ['Emi']), ...d.gifts.map((g) => g.for)])];
    const card = (g) => h('article', { class: `gt-card st-${g.status}` },
      h('button', { class: 'gt-img', onclick: () => giftForm(g), 'aria-label': `Editar ${g.name}` }, g.image ? h('img', { src: g.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('span', { text: '+ Añadir foto' })),
      h('div', { class: 'gt-body' },
        h('b', { text: g.reading ? 'Leyendo el enlace…' : g.name }),
        (g.by === 'Emi' || g.reading || g.drop) && h('div', { class: 'gt-tags' }, window.v126?.dropChip(g), g.by === 'Emi' && h('span', { class: 'gt-tag emi', text: 'Lo añadió Emi' }), g.reading && h('span', { class: 'gt-tag reading', text: 'Buscando foto y precio' })),
        g.note && h('p', { class: 'hint', text: g.note }),
        h('p', { class: 'hint', text: [g.occasion, g.price ? money(g.price, g.currency || 'CRC') : null, g.store].filter(Boolean).join(' · ') }),
        h('div', { class: 'rx-row' },
          h('select', { class: 'sn-select gt-st', 'aria-label': 'Estado', onchange: (e) => { g.status = e.target.value; commit(); } }, GIFT_ST.map(([v, l]) => h('option', { value: v, text: l, selected: g.status === v }))),
          g.link && h('button', { class: 'btn subtle small', text: 'Dónde comprarlo', onclick: () => api.openLink(g.link) }),
          h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => giftForm(g) })
        )
      )
    );
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Nuevo regalo', onclick: () => giftForm(null) }),
        h('button', { class: 'btn ghost small', text: 'Añadir persona', onclick: () => form('Nueva persona para regalos', [{ key: 'name', label: 'Nombre', required: true }], (v) => { if (!d.giftPeople.includes(v.name)) { d.giftPeople.push(v.name); commit(); } }) }),
        h('button', { class: 'btn ghost small', text: 'Enlace para Emi', onclick: () => emiLink() }),
        h('button', { class: 'btn subtle small', text: 'Revisar precios', title: 'Lo hago solo una vez al día', onclick: (e) => window.v126?.checkPrices(e.currentTarget) }),
        h('span', { class: 'hint', text: 'Pega el enlace de un producto y la foto, el nombre y el precio se completan solos. Te aviso si baja de precio.' })
      ),
      window.v126?.giftDates(d),
      people.map((p) => {
        const list = d.gifts.filter((g) => g.for === p).sort((a, b) => ['idea', 'bought', 'given'].indexOf(a.status) - ['idea', 'bought', 'given'].indexOf(b.status));
        const pending = list.filter((g) => g.status === 'idea').length;
        return h('section', { class: 'ks-group' },
          h('h3', { class: 'rx-squad-h' }, `Para ${p}`, h('span', { class: 'count', text: pending ? `${pending} por comprar` : String(list.length) }), h('button', { class: 'btn subtle small', text: '+ Añadir', onclick: () => giftForm(null, p) })),
          list.length ? h('div', { class: 'gt-grid' }, list.map(card)) : h('p', { class: 'hint', text: 'Sin regalos anotados.' })
        );
      }),
    ];
  }

  const TABS = [['compras', 'Lista de compras'], ['pagos', 'Pagos'], ['recordatorios', 'Recordatorios'], ['cumples', 'Cumpleaños'], ['regalos', 'Regalos'], ['presupuesto', 'Presupuesto'], ['gatitos', 'Gatitos'], ['menu', 'Menú semanal'], ['hogar', 'Hogar'], ['compartidos', 'Gastos compartidos'], ['tramites', 'Trámites'], ['feriados', 'Feriados'], ['alquileres', 'Alquileres'], ['suscripciones', 'Suscripciones'], ['vehiculo', 'Vehículo'], ['televisores', 'Televisores']];
  const SUB = {
    compras: 'Lo que falta en la casa, por categoría. Marca lo que vas comprando.',
    pagos: 'Alquiler, servicios y demás pagos de cada mes, con cuánto falta para el próximo.',
    recordatorios: 'Visitas, citas y fechas que no quieres olvidar.',
    cumples: 'Cumpleaños de la familia, amigos y gatitos.',
    regalos: 'Ideas de regalos para cada persona, con su foto y dónde comprarlos.',
    presupuesto: 'Cuánto llevas gastado este mes frente a tu límite: pagos, compras y gastos sueltos.',
    gatitos: 'Vacunas, desparasitación y visitas al veterinario de cada gatito, con recordatorio.',
    tramites: 'Marchamo, revisión técnica, licencia y cédula: cuándo vence cada uno, con aviso antes.',
    menu: 'Lo que vas a comer cada día de la semana. Los ingredientes pasan solos a la lista de compras.',
    hogar: 'El mantenimiento de la casa y las garantías de lo que compras, con aviso antes.',
    compartidos: 'Gastos que pagas por otros o a medias: quién le debe a quién y cuánto.',
    feriados: 'Feriados nacionales de Estados Unidos, Argentina y Costa Rica.',
    alquileres: 'Casas y apartamentos en alquiler de Facebook Marketplace, con tu precio y tu lugar.',
    suscripciones: 'Netflix, Spotify, Game Pass y demás: cuánto suman al mes y cuándo se renueva cada una.',
    vehiculo: 'Gasolina, consumo y mantenimientos del carro, con avisos por kilometraje o por fecha.',
    televisores: 'Enciende, apaga, sube o baja el volumen y mira qué se está viendo en cada televisor.',
  };
  function render() {
    const body = $('#casaBody');
    if (!body || $('#casaView').hidden) return;
    $('#casaTitle').textContent = TABS.find((t) => t[0] === K.tab)[1];
    $('#casaSub').textContent = SUB[K.tab];
    if (!K.d) return fill(body, skeleton());
    const views = { compras, pagos, recordatorios, cumples: cumpleanos, regalos, presupuesto, gatitos: () => [gatitos(), window.v129?.supplies(K.d)], menu, hogar, compartidos, tramites, feriados, alquileres, suscripciones: () => window.v129?.subs(K.d), vehiculo: () => window.v129?.vehicle(K.d), televisores: () => window.v131?.televisores() };
    fill(body, views[K.tab]());
  }
  const skeleton = () => h('div', { class: 'rx-skel' }, [1, 2, 3].map(() => h('div', { class: 'skel rx-skel-row' }, h('i', { class: 'skel-line w70' }), h('i', { class: 'skel-line w40' }))));

  async function show(tab) {
    if (tab) K.tab = tab;
    render();
    await load();
    render();
  }

  // contadores del menú: cosas por comprar, pagos en los próximos días, cumpleaños esta semana
  async function updateBadge() {
    try {
      await load();
    } catch {
      return;
    }
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n ? String(n) : '';
    };
    set('countCompras', K.d.shopping.filter((x) => !x.done).length);
    set('countPagos', K.d.payments.filter((p) => { const n = nextDue(p); return n && n.days <= (p.notifyDays ?? 3); }).length);
    set('countCumples', K.d.birthdays.filter((b) => b.day && nextBirthday(b).days <= 7).length);
    set('countRegalos', (K.d.gifts || []).filter((g) => g.status === 'idea').length);
    set('countTramites', (K.d.tramites || []).filter((t) => t.due && new Date(t.due + 'T00:00:00').getTime() - startOfDay() <= 30 * DAY).length);
    set('countRecordatorios', K.d.reminders.filter((r) => !r.done && Math.round((new Date(r.date + 'T00:00:00').getTime() - startOfDay()) / DAY) <= 7 && new Date(r.date + 'T00:00:00').getTime() >= startOfDay()).length);
  }
  setTimeout(updateBadge, 3000);
  // cambios desde el celular (lista de compras) o alquileres nuevos encontrados en segundo plano
  window.api.onCasaChanged(async () => {
    K.d = await api.get();
    render();
    updateBadge();
  });
  window.api.onMarketChanged(async () => {
    MK.st = await window.api.market.state();
    render();
  });
  window.casaUI = { show };
  // para los añadidos de la 1.26 (regalos, recibos)
  window.casaForm = form;
  window.casaCommit = commit;
})();

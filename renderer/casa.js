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
    const run = async () => {
      K.d = await api.save(K.d);
    };
    if (now) return run();
    saveTimer = setTimeout(run, 400);
  }
  const commit = () => {
    save();
    render();
    updateBadge();
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
      h('label', { class: 'ks-check' }, h('input', { type: 'checkbox', checked: x.done, onchange: (e) => { x.done = e.target.checked; commit(); } }), h('span', { text: x.name }), x.qty && h('small', { text: x.qty })),
      h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => form('Editar producto', [{ key: 'name', label: 'Producto', value: x.name, required: true }, { key: 'qty', label: 'Cantidad', value: x.qty }, { key: 'cat', label: 'Categoría', type: 'select', value: x.cat, options: d.shopCats.map((c) => [c, c]) }], (v) => { Object.assign(x, v); commit(); }, () => { d.shopping = d.shopping.filter((y) => y !== x); commit(); }) })
    );
    return [
      h('div', { class: 'ks-add rx-row' }, name, qty, cat, h('button', { class: 'btn primary', text: 'Añadir', onclick: add })),
      h('div', { class: 'toolbar flat' },
        h('span', { class: 'hint', text: pending.length ? `${plural(pending.length, 'cosa', 'cosas')} por comprar` : 'No falta nada por comprar.' }),
        pending.length > 0 && h('button', { class: 'btn ghost small', text: 'Copiar lista', onclick: async () => { const txt = groups.map(([c, l]) => `${c}:\n${l.map((x) => `- ${x.name}${x.qty ? ` (${x.qty})` : ''}`).join('\n')}`).join('\n\n'); await window.api.workana.copy(txt); toast('Lista copiada: pégala en WhatsApp o donde quieras.'); } }),
        bought.length > 0 && h('button', { class: 'btn subtle small', text: `Quitar ${plural(bought.length, 'comprado', 'comprados')}`, onclick: () => { d.shopping = pending; commit(); } })
      ),
      groups.length ? h('div', { class: 'ks-cols' }, groups.map(([c, l]) => h('section', { class: 'rx-card ks-cat' }, h('h3', {}, c, h('span', { class: 'count', text: String(l.length) })), h('ul', { class: 'ks-list' }, l.map(item))))) : h('p', { class: 'empty' }, h('b', { text: 'Lista vacía' }), 'Escribe arriba lo que haga falta en la casa.'),
      bought.length ? h('details', { class: 'notes' }, h('summary', { text: `Ya comprado (${bought.length})` }), h('ul', { class: 'ks-list' }, bought.map(item))) : null,
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
    const card = (p) => {
      const n = nextDue(p);
      const thisKey = ym(new Date());
      const paidNow = !!p.paid?.[thisKey];
      const tone = !p.day ? 'muted' : n.days < 0 ? 'bad' : n.days <= (p.notifyDays ?? 3) ? 'warn' : 'ok';
      return h('li', { class: `ks-pay ${tone}` },
        h('div', { class: 'ks-pay-count' }, p.day ? [h('b', { text: n.days < 0 ? `−${-n.days}` : String(n.days) }), h('span', { text: n.days < 0 ? 'días de atraso' : n.days === 1 ? 'día' : 'días' })] : h('span', { text: 'Fecha por confirmar' })),
        h('div', { class: 'ks-pay-main' },
          h('b', { text: p.name }),
          h('p', { class: 'hint', text: [p.day ? `Día ${p.day} de cada mes` : 'Sin fecha todavía', p.amount ? money(p.amount, p.currency) : null, p.day && n ? `${n.days < 0 ? 'Vencía' : 'Vence'} el ${dLong(n.date)}` : null].filter(Boolean).join(' · ') }),
          paidNow && h('p', { class: 'ks-paid', text: `Pagado este mes${p.day ? ` · el próximo es el ${dShort(nextDue(p)?.date)}` : ''}` }),
          p.note && h('p', { class: 'hint', text: p.note })
        ),
        h('div', { class: 'ks-pay-act' },
          p.day && n && h('button', { class: 'btn primary small', text: `Marcar ${MONTHS[new Date(n.date).getMonth()]} pagado`, onclick: () => { p.paid = { ...p.paid, [n.key]: Date.now() }; commit(); toast(`${p.name}: marcado como pagado.`); } }),
          paidNow && h('button', { class: 'btn subtle small', text: 'Deshacer', onclick: () => { const x = { ...p.paid }; delete x[thisKey]; p.paid = x; commit(); } }),
          h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => paymentForm(p) })
        )
      );
    };
    const all = d.payments.filter((p) => p.day).map((p) => ({ p, n: nextDue(p) })).filter((x) => x.n).sort((a, b) => a.n.days - b.n.days);
    const soon = all[0];
    return [
      soon && h('section', { class: `ks-next ${soon.n.days < 0 ? 'bad' : ''}` },
        h('p', { class: 'ks-kicker', text: soon.n.days < 0 ? 'Atrasado' : 'Próximo pago' }),
        h('h2', {}, `${soon.p.name}`, soon.p.group !== 'Personal' && h('span', { text: ` · ${soon.p.group}` })),
        h('p', { class: 'ks-big' }, h('b', { text: soon.n.days < 0 ? String(-soon.n.days) : String(soon.n.days) }), h('span', { text: soon.n.days < 0 ? ' días de atraso' : soon.n.days === 1 ? ' día' : ' días' })),
        h('p', { class: 'hint', text: `${dLong(soon.n.date)}${soon.p.amount ? ` · ${money(soon.p.amount, soon.p.currency)}` : ''}` })
      ),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Nuevo pago', onclick: () => paymentForm(null) }),
        h('button', { class: 'btn ghost small', text: 'Nuevo grupo', onclick: () => form('Nuevo grupo de pagos', [{ key: 'name', label: 'Nombre', required: true, placeholder: 'Mamá, Casa de playa…' }], (v) => { if (!d.payGroups.includes(v.name)) { d.payGroups.push(v.name); commit(); } }) }),
        h('span', { class: 'hint', text: 'Te aviso unos días antes de cada pago, el mismo día y si se atrasa.' })
      ),
      groups.map((g) => {
        const list = d.payments.filter((p) => p.group === g).sort((a, b) => (nextDue(a)?.days ?? 999) - (nextDue(b)?.days ?? 999));
        return h('section', { class: 'ks-group' },
          h('h3', { class: 'rx-squad-h' }, g, h('span', { class: 'count', text: String(list.length) }), h('button', { class: 'btn subtle small', text: '+ Añadir', onclick: () => paymentForm(null, g) }), !list.length && g !== 'Personal' && h('button', { class: 'btn subtle small', text: 'Quitar grupo', onclick: () => { d.payGroups = d.payGroups.filter((x) => x !== g); commit(); } })),
          list.length ? h('ul', { class: 'ks-pays' }, list.map(card)) : h('p', { class: 'hint', text: 'Sin pagos en este grupo.' })
        );
      }),
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
    const rows = d.birthdays.map((b) => ({ b, n: nextBirthday(b) })).sort((a, b) => a.n.days - b.n.days);
    const row = ({ b, n }) => h('li', { class: `ks-bd ${n.days === 0 ? 'today' : n.days <= 7 ? 'soon' : ''}` },
      h('div', { class: 'ks-when' }, h('b', { text: b.day || '?' }), h('span', { text: MONTHS[b.month - 1].slice(0, 3) })),
      h('div', { class: 'ks-pay-main' }, h('b', { text: b.name }), h('p', { class: 'hint', text: [b.day ? `${b.day} de ${MONTHS[b.month - 1]}` : `En ${MONTHS[b.month - 1]} (día por confirmar)`, n.age ? `cumple ${n.age}` : null, b.note].filter(Boolean).join(' · ') })),
      h('span', { class: 'ks-days', text: n.days === 0 ? (n.monthOnly ? 'Este mes' : '¡Hoy!') : daysText(n.days) }),
      h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => birthdayForm(b) })
    );
    const people = rows.filter((x) => x.b.kind !== 'gato');
    const cats = rows.filter((x) => x.b.kind === 'gato');
    const next = rows.slice(0, 3);
    return [
      h('div', { class: 'ks-upcoming' }, next.map(({ b, n }) => h('section', { class: `ks-next ${n.days === 0 ? 'party' : ''}` }, h('p', { class: 'ks-kicker', text: b.kind === 'gato' ? 'Gatito' : 'Cumpleaños' }), h('h2', { text: b.name }), h('p', { class: 'ks-big' }, h('b', { text: n.days === 0 ? '¡Hoy!' : String(n.days) }), n.days ? h('span', { text: n.days === 1 ? ' día' : ' días' }) : null), h('p', { class: 'hint', text: b.day ? dLong(n.date) : `En ${MONTHS[b.month - 1]}` })))),
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn primary small', text: 'Añadir persona', onclick: () => birthdayForm(null, 'persona') }), h('button', { class: 'btn ghost small', text: 'Añadir gatito', onclick: () => birthdayForm(null, 'gato') }), h('span', { class: 'hint', text: 'Te aviso el día antes y el mismo día.' })),
      h('div', { class: 'ks-two' },
        h('section', {}, h('h3', { class: 'rx-squad-h' }, 'Personas', h('span', { class: 'count', text: String(people.length) })), h('ul', { class: 'ks-rems' }, people.map(row))),
        h('section', {}, h('h3', { class: 'rx-squad-h' }, 'Gatitos', h('span', { class: 'count', text: String(cats.length) })), h('ul', { class: 'ks-rems' }, cats.map(row)))
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
  const TABS = [['compras', 'Lista de compras'], ['pagos', 'Pagos'], ['recordatorios', 'Recordatorios'], ['cumples', 'Cumpleaños'], ['feriados', 'Feriados']];
  const SUB = {
    compras: 'Lo que falta en la casa, por categoría. Marca lo que vas comprando.',
    pagos: 'Alquiler, servicios y demás pagos de cada mes, con cuánto falta para el próximo.',
    recordatorios: 'Visitas, citas y fechas que no quieres olvidar.',
    cumples: 'Cumpleaños de la familia, amigos y gatitos.',
    feriados: 'Feriados nacionales de Estados Unidos, Argentina y Costa Rica.',
  };
  function render() {
    const body = $('#casaBody');
    if (!body || $('#casaView').hidden) return;
    $('#casaTitle').textContent = TABS.find((t) => t[0] === K.tab)[1];
    $('#casaSub').textContent = SUB[K.tab];
    if (!K.d) return fill(body, skeleton());
    const views = { compras, pagos, recordatorios, cumples: cumpleanos, feriados };
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
    set('countRecordatorios', K.d.reminders.filter((r) => !r.done && Math.round((new Date(r.date + 'T00:00:00').getTime() - startOfDay()) / DAY) <= 7 && new Date(r.date + 'T00:00:00').getTime() >= startOfDay()).length);
  }
  setTimeout(updateBadge, 3000);
  window.casaUI = { show };
})();

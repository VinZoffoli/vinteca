'use strict';
// 1.29: Casa → Suscripciones (con el correo personal) y Vehículo, insumos en Gatitos,
// y la pantalla Conexiones (qué cuentas están bien y cuáles reconectar).
(function () {
  const sym = (c) => (c === 'USD' ? '$' : c === 'CRC' ? '₡' : '');
  const fmt = (v, c) => (v == null ? '—' : sym(c) + Number(v).toLocaleString('es', { maximumFractionDigits: 2 }));
  const ddm = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' }) : '—');
  const daysTo = (s) => (s ? Math.round((new Date(s + 'T12:00:00').setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000) : null);
  const uid = () => Math.random().toString(16).slice(2, 14);
  const form = (...a) => window.casaForm?.(...a);
  const commit = () => window.casaCommit?.();
  const rr = () => window.casaUI?.show?.();

  // ============================================================ SUSCRIPCIONES
  const S = { sum: null, acc: null, last: null, busy: false, asked: false };
  async function loadSubs() {
    S.asked = true;
    [S.sum, S.acc, S.last] = await Promise.all([window.api.subsSummary().catch(() => null), window.api.billMail.account().catch(() => null), window.api.billMail.last().catch(() => null)]);
    rr();
  }
  function subForm(d, s) {
    form(s ? 'Editar suscripción' : 'Nueva suscripción', [
      { key: 'name', label: 'Servicio', value: s?.name || '', required: true, placeholder: 'Netflix, Spotify, iCloud…' },
      { key: 'amount', label: 'Precio', type: 'number', value: s?.amount ?? '' },
      { key: 'currency', label: 'Moneda', type: 'select', value: s?.currency || 'USD', options: [['USD', 'Dólares'], ['CRC', 'Colones']] },
      { key: 'period', label: 'Cada', type: 'select', value: s?.period || 'mes', options: [['mes', 'Mes'], ['año', 'Año'], ['semana', 'Semana']] },
      { key: 'next', label: 'Próxima renovación', type: 'date', value: s?.next || '' },
      { key: 'category', label: 'Tipo', value: s?.category || '', placeholder: 'Series, música, juegos, nube…' },
    ], (v) => {
      d.subscriptions ||= [];
      const row = { name: v.name, amount: v.amount ? Number(v.amount) : null, currency: v.currency, period: v.period, next: v.next || null, category: v.category, active: true };
      if (s) Object.assign(s, row);
      else d.subscriptions.push({ id: uid(), from: 'mano', ...row });
      commit();
      S.sum = null;
      loadSubs();
    }, s ? () => { d.subscriptions = d.subscriptions.filter((x) => x !== s); commit(); loadSubs(); } : null);
  }
  function mailBox() {
    const a = S.acc;
    if (a?.hasPassword) {
      return h('section', { class: 'sb-mail' },
        h('div', {}, h('b', { text: 'Correo personal conectado' }), h('small', { class: 'hint', text: a.user + (S.last?.at ? ' · revisado ' + relTime(S.last.at / 1000) + (S.last.scanned != null ? ' (' + S.last.scanned + ' correos de facturas o cobros)' : '') : '') }), S.last?.error ? h('small', { class: 'hint bad', text: S.last.error }) : null),
        h('button', { class: 'btn subtle small', disabled: S.busy, text: S.busy ? 'Leyendo el correo…' : 'Revisar ahora', onclick: async () => { S.busy = true; rr(); try { const r = await window.api.billMail.scan(); toast('Revisados ' + r.scanned + ' correos.'); } catch (e) { toast(errMsg(e), true); } S.busy = false; loadSubs(); } }),
        h('button', { class: 'btn ghost small', text: 'Desconectar', onclick: async () => { await window.api.billMail.set({ forget: true }); loadSubs(); } })
      );
    }
    const user = h('input', { class: 'rx-input', type: 'email', placeholder: 'tu.correo@gmail.com', value: a?.user || '' });
    const host = h('input', { class: 'rx-input', value: a?.host || 'imap.gmail.com' });
    const pass = h('input', { class: 'rx-input', type: 'password', autocomplete: 'off', placeholder: 'Contraseña de aplicación' });
    return h('section', { class: 'sb-mail' },
      h('div', {}, h('b', { text: 'Conectar el correo personal' }), h('small', { class: 'hint', text: 'Para encontrar solas las facturas (luz, agua, internet) y los cobros de suscripciones. Solo se leen los correos con «factura», «recibo», «suscripción», «receipt»… y no se marca nada. En Gmail crea una «contraseña de aplicación» (Cuenta de Google → Seguridad) y pégala tú aquí; se guarda cifrada en este PC.' })),
      h('div', { class: 'sb-mail-form' }, user, host, pass, h('button', { class: 'btn primary small', text: 'Conectar', onclick: async () => { try { await window.api.billMail.set({ user: user.value, host: host.value, password: pass.value }); pass.value = ''; toast('Correo conectado. Revisando…'); S.busy = true; rr(); await window.api.billMail.scan().catch((e) => toast(errMsg(e), true)); S.busy = false; loadSubs(); } catch (e) { toast(errMsg(e), true); } } }))
    );
  }
  function subs(d) {
    if (!S.asked) setTimeout(loadSubs, 0);
    const list = (d.subscriptions || []).slice().sort((a, b) => Number(b.active) - Number(a.active) || String(a.next || '9').localeCompare(String(b.next || '9')));
    const sm = S.sum;
    return [
      h('section', { class: 'py-hero' },
        h('div', { class: 'py-hero-main' },
          h('p', { class: 'ks-kicker', text: 'Suscripciones' }),
          h('h2', { text: sm ? '₡' + sm.total.toLocaleString('es') + ' al mes' : 'Cargando…' }),
          h('p', { class: 'hint', text: sm ? sm.count + ' activas · ₡' + sm.year.toLocaleString('es') + ' al año' + (sm.usd ? ' · $' + sm.usd + ' en dólares al mes' : '') : '' })
        )
      ),
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn primary small', text: 'Nueva suscripción', onclick: () => subForm(d) }), h('span', { class: 'hint', text: 'Te aviso 3 días antes de cada renovación y el mismo día.' })),
      mailBox(),
      list.length ? h('ul', { class: 'sb-list' }, list.map((s) => {
        const dd = daysTo(s.next);
        return h('li', { class: s.active ? '' : 'off' },
          h('div', {}, h('b', { text: s.name }), h('small', { class: 'hint', text: [s.category, s.from === 'correo' ? 'encontrada en el correo' : null, s.active ? null : 'cancelada'].filter(Boolean).join(' · ') })),
          h('span', { class: 'sb-amt', text: s.amount ? fmt(s.amount, s.currency) + ' / ' + s.period : 'sin precio' }),
          h('span', { class: 'sb-next' + (dd != null && dd <= 3 ? ' soon' : ''), text: s.next ? (dd === 0 ? 'hoy' : dd === 1 ? 'mañana' : ddm(s.next)) : 'sin fecha' }),
          h('label', { class: 'rx-check', title: 'Activa' }, h('input', { type: 'checkbox', checked: s.active, onchange: (e) => { s.active = e.target.checked; commit(); loadSubs(); } }), h('span', { text: 'Activa' })),
          h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => subForm(d, s) })
        );
      })) : h('p', { class: 'empty' }, h('b', { text: 'Sin suscripciones' }), 'Añádelas a mano o conecta tu correo personal para encontrarlas solas.'),
      S.last?.found?.filter((x) => x.kind === 'bill').length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Facturas encontradas en el correo' }), h('ul', { class: 'cl-ul' }, S.last.found.filter((x) => x.kind === 'bill').slice(0, 8).map((x) => h('li', { text: (x.service || x.company) + ': ' + fmt(x.amount, x.currency) + (x.due ? ' · vence ' + ddm(x.due) : '') })))) : null,
    ];
  }

  // ============================================================ INSUMOS (Gatitos)
  function supplyLeft(x) {
    if (!x.size || !x.perDay || !x.openedAt) return null;
    const total = x.unit === 'kg' || x.unit === 'l' ? x.size * 1000 : x.size;
    const lasts = total / x.perDay;
    const used = (new Date().setHours(0, 0, 0, 0) - new Date(x.openedAt + 'T00:00:00').getTime()) / 86400000;
    return { lasts: Math.round(lasts), left: Math.floor(lasts - used) };
  }
  function supForm(d, x) {
    form(x ? 'Editar insumo' : 'Nuevo insumo', [
      { key: 'name', label: 'Qué', value: x?.name || '', required: true, placeholder: 'Comida, arena, snacks…' },
      { key: 'size', label: 'Tamaño de la bolsa', type: 'number', value: x?.size ?? '' },
      { key: 'unit', label: 'Unidad', type: 'select', value: x?.unit || 'kg', options: [['kg', 'kg'], ['g', 'g'], ['l', 'litros'], ['u', 'unidades']] },
      { key: 'perDay', label: 'Cuánto se usa al día (todos los gatitos)', type: 'number', value: x?.perDay ?? '', hint: 'En gramos (o ml / unidades). Ej.: 3 gatos × 60 g = 180' },
      { key: 'openedAt', label: 'Abriste la bolsa el', type: 'date', value: x?.openedAt || new Date().toLocaleDateString('sv') },
      { key: 'price', label: 'Precio (opcional)', type: 'number', value: x?.price ?? '' },
    ], (v) => {
      d.catSupplies ||= [];
      const row = { name: v.name, size: Number(v.size) || null, unit: v.unit, perDay: Number(v.perDay) || null, openedAt: v.openedAt || null, price: Number(v.price) || null };
      if (x) Object.assign(x, row);
      else d.catSupplies.push({ id: uid(), autoShop: true, ...row });
      commit();
    }, x ? () => { d.catSupplies = d.catSupplies.filter((y) => y !== x); commit(); } : null);
  }
  function supplies(d) {
    const list = d.catSupplies || [];
    return h('section', { class: 'sup' },
      h('div', { class: 'gd-head' }, h('h3', { text: 'Comida y arena' }), h('button', { class: 'btn subtle small', text: 'Añadir', onclick: () => supForm(d) })),
      list.length ? h('ul', { class: 'sup-list' }, list.map((x) => {
        const l = supplyLeft(x);
        const pct = l ? Math.max(0, Math.min(100, (l.left / Math.max(1, l.lasts)) * 100)) : null;
        return h('li', {},
          h('div', {}, h('b', { text: x.name }), h('small', { class: 'hint', text: [x.size ? x.size + ' ' + x.unit : null, x.perDay ? x.perDay + (x.unit === 'kg' || x.unit === 'g' ? ' g' : x.unit === 'l' ? ' ml' : ' u') + '/día' : null, x.openedAt ? 'abierta el ' + ddm(x.openedAt) : null].filter(Boolean).join(' · ') })),
          l ? h('div', { class: 'sx-bar sup-bar' + (l.left <= 5 ? ' low' : '') }, h('i', { style: { width: pct + '%' } })) : h('span'),
          h('span', { class: 'sup-left' + (l && l.left <= 5 ? ' bad-t' : ''), text: l ? (l.left <= 0 ? 'se acabó' : l.left + ' días') : 'faltan datos' }),
          h('button', { class: 'btn subtle small', text: 'Abrí una nueva', title: 'Empieza a contar desde hoy', onclick: () => { x.openedAt = new Date().toLocaleDateString('sv'); commit(); } }),
          h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => supForm(d, x) })
        );
      })) : h('p', { class: 'hint', text: 'Añade la comida y la arena con el tamaño de la bolsa y cuánto se usa al día: te aviso 5 días antes de que se acabe y lo pongo en la lista de compras.' })
    );
  }

  // ============================================================ VEHÍCULO
  function vStats(v) {
    if (!v) return null;
    const fuel = (v.fuel || []).slice().sort((a, b) => a.date.localeCompare(b.date) || (a.km || 0) - (b.km || 0));
    const kmNow = Math.max(0, ...fuel.map((f) => f.km || 0)) || null;
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
    const since = new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv');
    return { fuel, kmNow, cons, avg: cons.length ? Math.round((cons.slice(-5).reduce((a, c) => a + c.kmL, 0) / Math.min(5, cons.length)) * 10) / 10 : null, month: fuel.filter((f) => f.date >= since).reduce((a, f) => a + (f.amount || 0), 0) };
  }
  function vehicle(d) {
    d.vehicle ||= { name: '', plate: '', fuel: [], services: [] };
    const v = d.vehicle;
    const st = vStats(v);
    const fuelForm = (f) => form(f ? 'Editar carga' : 'Cargar gasolina', [
      { key: 'date', label: 'Fecha', type: 'date', value: f?.date || new Date().toLocaleDateString('sv'), required: true },
      { key: 'km', label: 'Kilometraje', type: 'number', value: f?.km ?? st?.kmNow ?? '' },
      { key: 'liters', label: 'Litros', type: 'number', value: f?.liters ?? '' },
      { key: 'amount', label: 'Pagaste (₡)', type: 'number', value: f?.amount ?? '' },
      { key: 'full', label: '¿Llenaste el tanque?', type: 'select', value: f?.full === false ? 'no' : 'si', options: [['si', 'Sí, tanque lleno'], ['no', 'No, solo una parte']] },
    ], (x) => {
      const row = { date: x.date, km: Number(x.km) || null, liters: Number(x.liters) || null, amount: Number(x.amount) || null, full: x.full !== 'no' };
      if (f) Object.assign(f, row);
      else v.fuel.push({ id: uid(), ...row });
      commit();
    }, f ? () => { v.fuel = v.fuel.filter((y) => y !== f); commit(); } : null);
    const svcForm = (s) => form(s ? 'Editar mantenimiento' : 'Nuevo mantenimiento', [
      { key: 'name', label: 'Qué', value: s?.name || '', required: true, placeholder: 'Cambio de aceite, llantas, frenos…' },
      { key: 'everyKm', label: 'Cada cuántos km', type: 'number', value: s?.everyKm ?? '' },
      { key: 'everyMonths', label: 'O cada cuántos meses', type: 'number', value: s?.everyMonths ?? '' },
      { key: 'lastKm', label: 'Última vez: kilometraje', type: 'number', value: s?.lastKm ?? '' },
      { key: 'lastDate', label: 'Última vez: fecha', type: 'date', value: s?.lastDate || '' },
    ], (x) => {
      const row = { name: x.name, everyKm: Number(x.everyKm) || null, everyMonths: Number(x.everyMonths) || null, lastKm: Number(x.lastKm) || null, lastDate: x.lastDate || null };
      if (s) Object.assign(s, row);
      else v.services.push({ id: uid(), ...row });
      commit();
    }, s ? () => { v.services = v.services.filter((y) => y !== s); commit(); } : null);
    const svc = (v.services || []).map((s) => {
      const kmLeft = s.everyKm && s.lastKm && st?.kmNow ? s.lastKm + s.everyKm - st.kmNow : null;
      let daysLeft = null;
      if (s.everyMonths && s.lastDate) {
        const x = new Date(s.lastDate + 'T12:00:00');
        x.setMonth(x.getMonth() + s.everyMonths);
        daysLeft = Math.round((x.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
      }
      return { s, kmLeft, daysLeft, due: (kmLeft != null && kmLeft <= 500) || (daysLeft != null && daysLeft <= 14) };
    });
    const maxC = Math.max(1, ...(st?.cons || []).map((c) => c.kmL));
    return [
      h('section', { class: 'py-hero' }, h('div', { class: 'py-hero-main' },
        h('p', { class: 'ks-kicker', text: v.name || 'Tu vehículo' }),
        h('h2', { text: st?.kmNow ? st.kmNow.toLocaleString('es') + ' km' : 'Anota la primera carga de gasolina' }),
        h('p', { class: 'hint', text: [st?.avg ? st.avg + ' km por litro' : null, st?.month ? '₡' + Math.round(st.month).toLocaleString('es') + ' en gasolina los últimos 30 días' : null, v.plate ? 'placa ' + v.plate : null].filter(Boolean).join(' · ') })
      )),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: 'Cargar gasolina', onclick: () => fuelForm() }),
        h('button', { class: 'btn ghost small', text: 'Nuevo mantenimiento', onclick: () => svcForm() }),
        h('button', { class: 'btn subtle small', text: 'Nombre y placa', onclick: () => form('Tu vehículo', [{ key: 'name', label: 'Nombre', value: v.name, placeholder: 'Yaris, la moto…' }, { key: 'plate', label: 'Placa', value: v.plate, hint: 'El último número dice el mes de la revisión técnica (Riteve) en Trámites.' }], (x) => { v.name = x.name; v.plate = x.plate; commit(); }) })
      ),
      h('section', { class: 'rx-card' }, h('h3', { text: 'Mantenimientos' }), svc.length ? h('ul', { class: 'sb-list' }, svc.map(({ s, kmLeft, daysLeft, due }) => h('li', { class: due ? 'due' : '' },
        h('div', {}, h('b', { text: s.name }), h('small', { class: 'hint', text: [s.everyKm ? 'cada ' + s.everyKm.toLocaleString('es') + ' km' : null, s.everyMonths ? 'cada ' + s.everyMonths + ' meses' : null, s.lastKm ? 'último a los ' + s.lastKm.toLocaleString('es') + ' km' : null, s.lastDate ? 'el ' + ddm(s.lastDate) : null].filter(Boolean).join(' · ') })),
        h('span', { class: due ? 'bad-t' : 'hint', text: [kmLeft != null ? (kmLeft > 0 ? 'faltan ' + kmLeft.toLocaleString('es') + ' km' : 'pasado por ' + (-kmLeft).toLocaleString('es') + ' km') : null, daysLeft != null ? (daysLeft > 0 ? 'en ' + daysLeft + ' días' : 'ya toca') : null].filter(Boolean).join(' · ') || '—' }),
        h('button', { class: 'btn subtle small', text: 'Hecho hoy', onclick: () => { s.lastDate = new Date().toLocaleDateString('sv'); if (st?.kmNow) s.lastKm = st.kmNow; commit(); toast(s.name + ': anotado.'); } }),
        h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => svcForm(s) })
      ))) : h('p', { class: 'hint', text: 'Añade el cambio de aceite, las llantas o los frenos: te aviso por kilometraje (con las cargas de gasolina) o por fecha.' })),
      h('section', { class: 'rx-card' }, h('h3', { text: 'Gasolina' }),
        st?.cons?.length > 1 ? h('div', { class: 'bl-bars veh-bars', title: 'Consumo (km por litro) de cada tanque', style: { gridTemplateColumns: 'repeat(' + st.cons.slice(-12).length + ', 34px)' } }, st.cons.slice(-12).map((c) => h('i', { style: { height: Math.max(8, (c.kmL / maxC) * 100) + '%' }, title: ddm(c.date) + ': ' + c.kmL + ' km/L' }))) : null,
        st?.fuel?.length ? h('ul', { class: 'sb-list' }, st.fuel.slice(-10).reverse().map((f) => h('li', {}, h('div', {}, h('b', { text: ddm(f.date) }), h('small', { class: 'hint', text: [f.km ? f.km.toLocaleString('es') + ' km' : null, f.liters ? f.liters + ' L' : null, f.full ? 'tanque lleno' : 'parcial'].filter(Boolean).join(' · ') })), h('span', { text: f.amount ? '₡' + Math.round(f.amount).toLocaleString('es') : '' }), h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => fuelForm(f) })))) : h('p', { class: 'hint', text: 'Cada vez que cargues, anota el kilometraje, los litros y lo que pagaste: saco el consumo y el gasto del mes.' })
      ),
    ];
  }

  // ============================================================ CONEXIONES
  const C = { data: null, busy: false };
  const GO = { settings: () => document.getElementById('settingsBtn')?.click(), notion: () => showView('notion'), webs: () => showView('webs'), mail: () => showView('mail'), 'casa-suscripciones': () => showView('casa-suscripciones'), cal: () => showView('cal'), genshin: () => showView('genshin'), music: () => showView('music'), viendo: () => showView('viendo'), lan: () => showView('lan'), assist: () => showView('assist') };
  async function connLoad() {
    C.busy = true;
    connRender();
    try {
      C.data = await window.api.conn();
    } catch (e) {
      toast(errMsg(e), true);
    }
    C.busy = false;
    connRender();
  }
  function connRender() {
    const body = document.getElementById('connBody');
    if (!body) return;
    const d = C.data;
    if (!d) return fill(body, h('p', { class: 'hint', text: 'Comprobando las conexiones…' }));
    const order = { error: 0, warn: 1, off: 2, ok: 3 };
    const rows = d.rows.slice().sort((a, b) => order[a.state] - order[b.state]);
    const bad = rows.filter((r) => r.state === 'error').length;
    const off = rows.filter((r) => r.state === 'off').length;
    const LBL = { ok: 'Bien', warn: 'Sin datos recientes', off: 'Sin conectar', error: 'Falla' };
    fill(body,
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn ghost small', disabled: C.busy, text: C.busy ? 'Comprobando…' : 'Comprobar otra vez', onclick: connLoad }), h('span', { class: 'hint', text: (bad ? bad + ' con fallos · ' : '') + (off ? off + ' sin conectar · ' : '') + 'Se revisan solas cada 30 minutos y te aviso si alguna se cae.' })),
      h('ul', { class: 'cn-list' }, rows.map((r) => h('li', { class: 'cn-' + r.state },
        h('span', { class: 'cn-dot', 'aria-hidden': 'true' }),
        h('div', {}, h('b', { text: r.name }), h('small', { class: 'hint', text: r.detail || '' })),
        h('span', { class: 'cn-state', text: LBL[r.state] }),
        r.go && r.state !== 'ok' ? h('button', { class: 'btn ' + (r.state === 'error' ? 'primary' : 'subtle') + ' small', text: r.state === 'off' ? 'Conectar' : 'Reconectar', onclick: () => (GO[r.go] || (() => showView(r.go)))() }) : r.go ? h('button', { class: 'btn ghost small', text: 'Abrir', onclick: () => (GO[r.go] || (() => showView(r.go)))() }) : h('span')
      )))
    );
  }

  // vistas nuevas: Conexiones (fuera de Casa)
  const orig = window.showView;
  if (typeof orig === 'function') {
    window.showView = function (v, ...rest) {
      const r = orig.call(this, v, ...rest);
      const cv = document.getElementById('connView');
      if (cv) cv.hidden = v !== 'conn';
      if (v === 'conn') connLoad();
      return r;
    };
  }
  window.v129 = { subs, supplies, vehicle };
})();

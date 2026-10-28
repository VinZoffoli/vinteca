'use strict';
// Mi día (pantalla de inicio), búsqueda global, logros fáciles, juegos gratis y
// mods en la ficha de cada juego.
(function () {
  const DAY = 86400000;
  const hm = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const when = (days) => (days === 0 ? 'hoy' : days === 1 ? 'mañana' : days < 0 ? `hace ${-days} d` : `en ${days} días`);
  const money = (v, c) => `${Number(v).toLocaleString('es')} ${c || ''}`.trim();
  const until = (t) => {
    const m = Math.round((t - Date.now()) / 60000);
    if (m < 60) return `en ${Math.max(0, m)} min`;
    const hh = Math.floor(m / 60);
    return hh < 24 ? `en ${hh} h` : `en ${Math.round(hh / 24)} días`;
  };

  // =================================================== MI DÍA
  const D = { data: null, backup: null };
  async function dayShow() {
    try {
      [D.data, D.backup, D.lan] = await Promise.all([window.api.day(), window.api.backup.status().catch(() => null), window.api.lanStatus().catch(() => null)]);
      // el resumen de la semana viene solo domingo y lunes; el tablero lo muestra siempre
      if (D.data && !D.data.week) D.data.week = await window.api.weekAhead().catch(() => null);
    } catch (e) {
      D.error = errMsg(e);
    }
    dayRender();
  }
  // anillo de progreso (presupuesto, resina)
  const ringSvg = (v, cls) => {
    const r = 30;
    const c = 2 * Math.PI * r;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 72 72');
    el.setAttribute('class', 'md-ring ' + (cls || ''));
    el.innerHTML = '<circle cx="36" cy="36" r="' + r + '" class="bg"/><circle cx="36" cy="36" r="' + r + '" class="fg" stroke-dasharray="' + c + '" stroke-dashoffset="' + c * (1 - Math.max(0, Math.min(1, v))) + '"/>';
    return el;
  };
  const WX_ICON = (code) => (code === 0 ? '☀️' : code <= 2 ? '🌤️' : code === 3 ? '☁️' : code <= 48 ? '🌫️' : code <= 57 ? '🌦️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' : code <= 82 ? '🌧️' : code <= 86 ? '❄️' : '⛈️');
  // 1.36: Mi día como tablero de tarjetas (estilo «Estudio»): bienvenida en lavanda con una flor,
  // cifras grandes, barras en pastel y una columna a la derecha con la semana, el clima, los
  // juegos recientes y los avisos. Debajo, el detalle por tema (Casa, Trabajo, Ocio).
  const svgEl = (cls, viewBox, inner) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', viewBox);
    el.setAttribute('class', cls);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = inner;
    return el;
  };
  const flower = () =>
    svgEl('sd-flower', '0 0 200 200',
      '<defs><radialGradient id="sdPetal" cx="50%" cy="92%" r="95%"><stop offset="0" stop-color="#ffffff"/><stop offset=".42" stop-color="#cdbdff"/><stop offset="1" stop-color="#8a70f0"/></radialGradient>' +
      '<radialGradient id="sdCore" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3d9ff"/></radialGradient></defs>' +
      '<g transform="translate(100 100)">' +
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => '<ellipse rx="27" ry="60" cy="-46" fill="url(#sdPetal)" opacity=".92" transform="rotate(' + (i * 45 + 12) + ')"/>').join('') +
      '<circle r="17" fill="url(#sdCore)"/></g>');
  const coil = () =>
    svgEl('sd-coil', '0 0 120 150',
      '<defs><linearGradient id="sdCoil" x1="0" x2="1"><stop offset="0" stop-color="#e9c6ff"/><stop offset=".5" stop-color="#b9a4ff"/><stop offset="1" stop-color="#f5c9e2"/></linearGradient></defs>' +
      [0, 1, 2, 3, 4, 5].map((i) => '<ellipse cx="60" cy="' + (22 + i * 21) + '" rx="40" ry="13" fill="none" stroke="url(#sdCoil)" stroke-width="13" opacity="' + (1 - i * 0.06) + '"/>').join(''));
  const more = (view, title) => h('button', { class: 'sd-more', 'aria-label': 'Abrir ' + title, onclick: () => showView(view) }, '›');
  function sc(title, opts, ...kids) {
    const body = kids.flat().filter(Boolean);
    if (!body.length && !opts.keep) return null;
    return h('section', { class: 'sd-card ' + (opts.cls || 'sd-span2') },
      title && h('header', { class: 'sd-h' }, h('h3', { text: title }), opts.view && more(opts.view, title)),
      body.length ? body : h('p', { class: 'sd-empty', text: opts.empty || 'Nada por aquí.' })
    );
  }
  const sdRows = (list) => (list.length ? h('ul', { class: 'sd-list' }, list) : null);
  const sdRow = (main, side, cls, sub) => h('li', { class: cls || '' }, h('div', {}, h('span', { text: main }), sub && h('small', { text: sub })), side != null && h('b', { text: side }));
  const ago = (t) => {
    const d = Math.floor((Date.now() - t) / DAY);
    return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 30 ? 'hace ' + d + ' d' : new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  let noteTab = 'todo';

  function dayRender() {
    const box = $('#dayBody');
    if (!box) return;
    const d = D.data;
    if (!d) return fill(box, h('div', { class: 'md-skel' }, [1, 2, 3, 4, 5, 6].map(() => h('div', { class: 'skel' }))));
    const now = new Date();
    const hello = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';
    const meets = d.meetings.filter((m) => !m.allDay);
    const nextMeet = meets.find((m) => m.end > Date.now());
    const w = d.weather;
    const b = d.budget;
    const bits = [];
    bits.push(meets.length ? plural(meets.length, 'reunión', 'reuniones') : 'sin reuniones');
    const payToday = d.pays.filter((p) => p.days <= 0).length;
    if (payToday) bits.push(plural(payToday, 'pago para hoy', 'pagos para hoy'));
    if (d.bdays.some((x) => x.days === 0)) bits.push('un cumpleaños');
    if (w?.today?.heavy) bits.push(w.today.text.toLowerCase());
    else if (w?.today && w.today.prob >= 60) bits.push('probable lluvia');
    const summary = bits.join(', ');
    const late = d.tickets.filter((t) => t.late).length;

    // ---------- la semana: cuántas cosas de cada tipo
    const wk = d.week || { meetings: [], pays: [], bdays: [], rems: [], tramites: [] };
    const parts = [
      ['Reuniones', wk.meetings.length, 'sd-c1'],
      ['Pagos', wk.pays.length, 'sd-c2'],
      ['Cumpleaños', wk.bdays.length, 'sd-c3'],
      ['Recordatorios', wk.rems.length + (wk.tramites || []).length, 'sd-c4'],
    ];
    const total = parts.reduce((s, p) => s + p[1], 0);

    // ---------- días con algo en la semana (lunes a domingo)
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const marks = new Set();
    const mark = (t) => t && marks.add(new Date(t).toDateString());
    for (const m of [...(wk.meetings || []), ...d.meetings]) mark(m.start);
    for (const x of [...(wk.pays || []), ...(wk.bdays || []), ...(wk.rems || []), ...(wk.tramites || [])]) if (Number.isFinite(x.days)) mark(Date.now() + x.days * DAY);

    // ---------- avisos (lo más urgente de cada tema)
    const notes = [
      ...d.pays.map((p) => ({ cat: 'casa', ico: '💳', title: p.name, when: p.days < 0 ? 'Atrasado' : when(p.days), hot: p.days <= 0, days: p.days, view: 'casa-pagos' })),
      ...d.bdays.map((x) => ({ cat: 'casa', ico: '🎂', title: 'Cumpleaños de ' + x.name, when: when(x.days), hot: x.days === 0, days: x.days, view: 'casa-cumples' })),
      ...d.rems.map((r) => ({ cat: 'casa', ico: '🔔', title: r.title, when: when(r.days), hot: r.days <= 0, days: r.days, view: 'casa-recordatorios' })),
      ...(d.tramites || []).map((t) => ({ cat: 'casa', ico: '📄', title: t.name, when: t.days < 0 ? 'Vencido' : when(t.days), hot: t.days <= 7, days: t.days, view: 'casa-tramites' })),
      ...(d.hogar || []).map((x) => ({ cat: 'casa', ico: '🛠️', title: x.name, when: x.days < 0 ? 'Atrasado' : when(x.days), hot: x.days <= 0, days: x.days, view: 'casa-hogar' })),
      ...d.cats.map((c) => ({ cat: 'casa', ico: '🐾', title: c.cat + ': ' + ({ vacuna: 'vacuna', desparasitacion: 'desparasitación', pulgas: 'antipulgas', veterinario: 'veterinario' }[c.type] || c.note || 'cuidado'), when: when(c.days), hot: c.days <= 0, days: c.days, view: 'casa-gatitos' })),
      ...d.tickets.map((t) => ({ cat: 'trabajo', ico: '🎫', title: t.title, when: t.late ? 'Vencido' : t.deadline, hot: t.late, days: t.late ? -1 : 1, view: 'notion' })),
      ...(d.mail?.last || []).map((m) => ({ cat: 'trabajo', ico: '✉️', title: m.subject, when: m.from, hot: false, days: 2, view: 'mail' })),
      ...d.anime.map((x) => ({ cat: 'ocio', ico: '📺', title: x.title + (x.what ? ' · ' + x.what : ''), when: (sameDay(new Date(x.at), now) ? 'hoy ' : 'mañana ') + hm(x.at), hot: false, days: 1, view: 'news' })),
      ...d.giveaways.map((g) => ({ cat: 'ocio', ico: '🎁', title: g.title + ' gratis', when: g.store, hot: false, days: 3, view: 'news' })),
    ].sort((a, z) => a.days - z.days);
    const NOTE_TABS = [['todo', 'Todo'], ['casa', 'Casa'], ['trabajo', 'Trabajo'], ['ocio', 'Ocio']];
    const noteList = h('ul', { class: 'sd-notes' });
    const drawNotes = () => {
      const list = notes.filter((n) => noteTab === 'todo' || n.cat === noteTab).slice(0, 6);
      fill(noteList, list.length ? list.map((n) => h('li', { class: 'sd-note' },
        h('span', { class: 'sd-av c-' + n.cat, 'aria-hidden': 'true', text: n.ico }),
        h('div', {}, h('span', { text: n.title }), h('small', { class: n.hot ? 'hot' : '', text: n.when || '' })),
        h('button', { class: 'sd-go', text: 'Ver', onclick: () => showView(n.view) })
      )) : h('li', { class: 'sd-empty', text: 'Nada pendiente aquí.' }));
    };
    const noteTabs = h('div', { class: 'sd-tabs', role: 'tablist' }, NOTE_TABS.map(([k, l]) => h('button', { class: noteTab === k ? 'on' : '', role: 'tab', 'aria-selected': String(noteTab === k), text: l, onclick: (e) => { noteTab = k; for (const x of noteTabs.children) { x.classList.toggle('on', x === e.currentTarget); x.setAttribute('aria-selected', String(x === e.currentTarget)); } drawNotes(); } })));
    drawNotes();

    // ---------- juegos recientes
    const recent = (typeof games === 'function' ? games() : []).filter((g) => g.lastPlayed && g.kind !== 'tool').sort((a, z) => z.lastPlayed - a.lastPlayed).slice(0, 8);

    const bar = (label, value, view, cls, max) => h('button', { class: 'sd-bar ' + (cls || ''), onclick: () => showView(view), 'aria-label': label + ': ' + value },
      h('span', { style: { height: Math.max(18, Math.round((Math.min(Number(value) || 0, max) / max) * 100)) + '%' } }, h('b', { text: String(value) })),
      h('small', { text: label }));
    const barMax = Math.max(4, d.pays.length, d.tickets.length, d.mail?.count || 0, d.shopping || 0);

    fill(box, h('div', { class: 'sd' },
      h('div', { class: 'sd-main' },
        // bienvenida
        h('section', { class: 'sd-card sd-span6 sd-hero' },
          h('div', {},
            h('p', { class: 'sd-date', text: now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase()) }),
            h('h1', { text: hello + ', Vincenzo' }),
            h('p', { class: 'sd-sum', text: summary.charAt(0).toUpperCase() + summary.slice(1) + '.' }),
            h('div', { class: 'row' },
              nextMeet?.link ? h('button', { class: 'btn primary', text: 'Unirse a la reunión', onclick: () => window.api.cal.open(nextMeet.link) }) : h('button', { class: 'btn primary', text: 'Ver agenda', onclick: () => showView('cal') }),
              h('button', { class: 'btn ghost', text: '¿A qué juego?', onclick: () => $('#pickBtn')?.click() })
            )
          ),
          flower()
        ),
        d.missed?.length ? h('section', { class: 'sd-card sd-span6 sd-missed' },
          h('div', {}, h('b', { text: 'Mientras jugabas: ' + plural(d.missed.length, 'aviso', 'avisos') }), h('span', { text: d.missed.slice(0, 3).map((m) => m.title).join(', ') })),
          h('button', { class: 'btn ghost small', text: 'Ya los vi', onclick: async () => { await window.api.dnd.clear(); D.data.missed = []; dayRender(); } })
        ) : null,

        // próxima reunión
        h('section', { class: 'sd-card sd-span2 sd-meet' },
          h('p', { class: 'sd-k', text: nextMeet ? (nextMeet.start <= Date.now() ? 'Reunión en curso' : 'Próxima reunión, ' + until(nextMeet.start)) : 'Agenda' }),
          h('h2', { text: nextMeet ? nextMeet.title : meets.length ? 'Ya no quedan reuniones hoy' : 'Hoy no tienes reuniones' }),
          h('p', { class: 'sd-time', text: nextMeet ? hm(nextMeet.start) + ' – ' + hm(nextMeet.end) : 'Buen momento para avanzar tickets o descansar.' }),
          h('div', { class: 'row' }, nextMeet?.link && h('button', { class: 'btn primary small', text: 'Unirse', onclick: () => window.api.cal.open(nextMeet.link) }), h('button', { class: 'btn ghost small', text: 'Ver agenda', onclick: () => showView('cal') }))
        ),
        // la semana en una cifra
        h('section', { class: 'sd-card sd-span2' },
          h('header', { class: 'sd-h' }, h('h3', { text: 'Próximos 7 días' }), more('cal', 'Calendario')),
          h('b', { class: 'sd-big', text: String(total) }),
          h('span', { class: 'sd-sub', text: total === 1 ? 'cosa por delante' : 'cosas por delante' }),
          h('div', { class: 'sd-split', 'aria-hidden': 'true' }, parts.filter((p) => p[1]).map((p) => h('i', { class: p[2], style: { flex: String(p[1]) } }))),
          h('ul', { class: 'sd-legend' }, parts.map((p) => h('li', {}, h('i', { class: p[2] }), p[0] + ' ' + p[1])))
        ),
        // pendientes en barras
        h('section', { class: 'sd-card sd-span2' },
          h('header', { class: 'sd-h' }, h('h3', { text: 'Pendientes' })),
          h('div', { class: 'sd-bars' },
            bar('Pagos', d.pays.length, 'casa-pagos', d.pays.some((p) => p.days <= 0) ? 'hot' : 'lav', barMax),
            bar('Tickets', d.tickets.length, 'notion', late ? 'hot' : '', barMax),
            bar('Correos', d.mail ? d.mail.count : 0, 'mail', 'lav', barMax),
            bar('Compras', d.shopping || 0, 'casa-compras', '', barMax)
          )
        ),

        // trabajo en cifras
        h('section', { class: 'sd-card sd-span3' },
          h('header', { class: 'sd-h' }, h('h3', { text: 'Trabajo' }), more('notion', 'Notion')),
          h('div', { class: 'sd-pair' },
            h('button', { onclick: () => showView('notion') }, h('b', { class: 'sd-big' + (late ? ' hot' : ''), text: String(d.tickets.length) }), h('span', { class: 'sd-sub', text: late ? plural(late, 'ticket vencido', 'tickets vencidos') : 'tickets por vencer' })),
            h('button', { onclick: () => showView('mail') }, h('b', { class: 'sd-big', text: d.mail ? String(d.mail.count) : '—' }), h('span', { class: 'sd-sub', text: 'correos sin leer' }))
          ),
          h('div', { class: 'sd-tiles' },
            h('button', { class: 'sd-tile', onclick: () => showView('cal') }, h('b', { text: String(meets.length) }), meets.length === 1 ? 'reunión hoy' : 'reuniones hoy'),
            h('button', { class: 'sd-tile', onclick: () => showView('webs') }, h('b', { text: String(d.pulls || 0) }), (d.pulls || 0) === 1 ? 'web con git pull' : 'webs con git pull')
          )
        ),
        // columna: tarjeta negra + celular
        h('div', { class: 'sd-span3', style: { display: 'grid', gap: '16px', alignContent: 'start' } },
          d.resin
            ? h('section', { class: 'sd-card sd-black' },
                h('div', { class: 'sd-pill' }, ringSvg(d.resin.value / d.resin.max, d.resin.value >= d.resin.max ? 'hot' : 'cyan'), h('span', { text: 'Resina de Genshin: ' + d.resin.value + ' de ' + d.resin.max }), h('small', { text: d.resin.value >= d.resin.max ? 'llena' : 'cargando' })),
                h('button', { class: 'sd-dot', 'aria-label': 'Abrir Genshin', onclick: () => showView('genshin') }, '›')
              )
            : d.fx
              ? h('section', { class: 'sd-card sd-black' },
                  h('div', { class: 'sd-pill' }, h('span', { text: 'Dólar hoy: ₡' + d.fx.sell.toLocaleString('es', { minimumFractionDigits: 2 }) }), h('small', { text: 'compra ₡' + d.fx.buy })))
              : null,
          h('section', { class: 'sd-card sd-promo' },
            D.lan?.dayQr ? h('img', { src: D.lan.mQr || D.lan.dayQr, alt: 'Código QR de ViperTeca para el celular' }) : coil(),
            h('div', {},
              h('b', { text: 'ViperTeca en tu iPhone' }),
              h('p', { text: D.lan?.dayQr ? 'Escanéalo con la cámara. Con Tailscale funciona fuera de casa.' : 'Enciende el acceso y tendrás la app en el teléfono.' }),
              !D.lan?.dayQr
                ? h('button', { class: 'btn small', text: 'Encender', onclick: async () => { try { D.lan = await window.api.lanStart(); dayRender(); } catch (e) { toast(errMsg(e), true); } } })
                : h('button', { class: 'btn small', text: 'Widget de escritorio', onclick: async () => { const on = await window.api.widget.toggle(); toast(on ? 'Widget abierto: arrástralo donde quieras.' : 'Widget cerrado.'); } })
            )
          )
        ),

        // ---------- casa
        h('h2', { class: 'sd-sec', text: 'Casa' }),
        sc('Pagos que vienen', { view: 'casa-pagos', keep: true, empty: 'Nada que pagar esta semana.' }, sdRows(d.pays.map((p) => sdRow(p.name + (p.group && p.group !== 'Personal' ? ' (' + p.group + ')' : ''), p.days < 0 ? 'Atrasado' : when(p.days), p.days <= 0 ? 'hot' : '', p.amount ? money(p.amount, p.currency) : null)))),
        b.limit
          ? h('section', { class: 'sd-card sd-span2' },
              h('header', { class: 'sd-h' }, h('h3', { text: 'Presupuesto' }), more('casa-presupuesto', 'Presupuesto')),
              h('div', { class: 'sd-ringbox' }, ringSvg(b.spent / b.limit, b.spent > b.limit ? 'hot' : ''), h('div', {}, h('b', { text: Math.round((b.spent / b.limit) * 100) + ' %' }), h('small', { text: money(b.spent, b.currency) + ' de ' + money(b.limit, b.currency) })))
            )
          : sc('Presupuesto', { view: 'casa-presupuesto', keep: true, empty: 'Pon un límite del mes y te muestro cuánto llevas.' }),
        sc('Cumpleaños', { view: 'casa-cumples' }, sdRows(d.bdays.map((x) => sdRow(x.name + (x.kind === 'gato' ? ' 🐾' : ''), when(x.days), x.days === 0 ? 'hot' : '', x.age ? 'cumple ' + x.age : null)))),
        sc('Recordatorios', { view: 'casa-recordatorios' }, sdRows(d.rems.map((r) => sdRow(r.title, when(r.days))))),
        sc('Trámites', { view: 'casa-tramites' }, sdRows((d.tramites || []).map((t) => sdRow(t.name, t.days < 0 ? 'Vencido' : when(t.days), t.days <= 7 ? 'hot' : '')))),
        sc('Hogar', { view: 'casa-hogar' }, sdRows((d.hogar || []).map((x) => sdRow(x.name, x.days < 0 ? 'Atrasado' : when(x.days), x.days <= 0 ? 'hot' : '')))),
        sc('Gatitos', { view: 'casa-gatitos' }, sdRows(d.cats.map((c) => sdRow(c.cat, when(c.days), c.days <= 0 ? 'hot' : '', { vacuna: 'vacuna', desparasitacion: 'desparasitación', pulgas: 'antipulgas', veterinario: 'veterinario', otro: c.note || 'cuidado' }[c.type])))),

        // ---------- trabajo
        h('h2', { class: 'sd-sec', text: 'Trabajo' }),
        sc('Agenda de hoy', { view: 'cal', cls: 'sd-span3', keep: true, empty: 'Sin reuniones hoy.' },
          d.meetings.length ? h('ol', { class: 'sd-timeline' }, d.meetings.map((m) => h('li', { class: m.end < Date.now() ? 'past' : m.start <= Date.now() ? 'now' : '' }, h('time', { text: m.allDay ? 'Todo el día' : hm(m.start) }), h('span', { text: m.title })))) : null),
        sc('Tickets de Notion', { view: 'notion', cls: 'sd-span3' }, sdRows(d.tickets.slice(0, 7).map((t) => sdRow(t.title, t.late ? 'Vencido' : t.deadline, t.late ? 'hot' : ''))), d.tickets.length > 7 && h('p', { class: 'sd-sub', text: 'y ' + (d.tickets.length - 7) + ' más' })),

        // ---------- ocio
        h('h2', { class: 'sd-sec', text: 'Ocio' }),
        d.resin || d.resets.length || (d.gather || []).length
          ? h('section', { class: 'sd-card sd-span2' },
              h('header', { class: 'sd-h' }, h('h3', { text: 'Genshin' }), more('genshin', 'Genshin')),
              d.resin ? h('div', { class: 'sd-ringbox' }, ringSvg(d.resin.value / d.resin.max, d.resin.value >= d.resin.max ? 'hot' : 'cyan'), h('div', {}, h('b', { text: String(d.resin.value) }), h('small', { text: 'de ' + d.resin.max + ' resina' }))) : null,
              sdRows([...d.resets.map((r) => sdRow(r.name, until(r.at))), ...(d.gather || []).map((g) => sdRow(g.name, g.readyAt <= Date.now() ? 'Listo' : until(g.readyAt), g.readyAt <= Date.now() ? 'hot' : ''))])
            )
          : null,
        sc('Anime', { view: 'news' }, sdRows(d.anime.map((x) => sdRow(x.title, (sameDay(new Date(x.at), now) ? 'hoy ' : 'mañana ') + hm(x.at), '', x.what)))),
        sc('Juegos gratis', { view: 'news' }, sdRows(d.giveaways.map((g) => sdRow(g.title, g.store)))),

        D.backup && h('p', { class: 'sd-foot' },
          D.backup.available ? 'Copia en OneDrive: ' + (D.backup.last ? 'la última es del ' + D.backup.last : 'todavía ninguna') + '.' : 'No encuentro OneDrive en este PC.',
          D.backup.available && h('button', { class: 'btn subtle small', text: 'Hacer copia ahora', onclick: async () => { try { D.backup = await window.api.backup.run(); toast('Copia guardada en OneDrive.'); dayRender(); } catch (e) { toast(errMsg(e), true); } } })
        )
      ),

      // ---------- columna derecha
      h('aside', { class: 'sd-side' },
        h('section', { class: 'sd-card sd-cal' },
          h('header', { class: 'sd-h' }, h('h3', { text: now.toLocaleDateString('es', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()).replace(' de ', ', ') }), h('div', { class: 'sd-arrows' }, more('cal', 'Calendario'))),
          h('div', { class: 'sd-week' }, [0, 1, 2, 3, 4, 5, 6].map((i) => {
            const day = new Date(monday.getTime() + i * DAY);
            const today = sameDay(day, now);
            return h('button', { class: 'sd-day' + (today ? ' today' : '') + (marks.has(day.toDateString()) ? ' has' : ''), 'aria-label': day.toLocaleDateString('es', { weekday: 'long', day: 'numeric' }), onclick: () => showView('cal') },
              day.toLocaleDateString('es', { weekday: 'short' }).replace('.', '').replace(/^./, (c) => c.toUpperCase()), h('b', { text: String(day.getDate()) }), h('i'));
          }))
        ),
        w && h('section', { class: 'sd-card', title: w.stale ? 'Sin conexión: último dato guardado' : 'Clima de Guápiles' },
          h('div', { class: 'sd-wx' },
            h('span', { class: 'sd-ico', 'aria-hidden': 'true', text: WX_ICON(w.now.code) }),
            h('div', {}, h('b', { text: Math.round(w.now.temp) + '°' }), h('span', { text: w.now.text + (w.today ? '. Máx. ' + Math.round(w.today.max) + '°, lluvia ' + w.today.prob + ' %' : '') }))
          ),
          w.hours?.length ? h('ol', { class: 'sd-hours' }, w.hours.slice(0, 6).map((x) => h('li', { class: x.prob >= 60 ? 'rain' : '' }, h('small', { text: x.time.slice(11, 16) }), h('span', { 'aria-hidden': 'true', text: WX_ICON(x.code) }), h('b', { text: Math.round(x.temp) + '°' })))) : null
        ),
        recent.length ? h('section', { class: 'sd-card' },
          h('header', { class: 'sd-h' }, h('h3', { text: 'Jugados hace poco' }), more('library', 'Juegos')),
          h('div', { class: 'sd-games' }, recent.map((g) => h('button', { class: 'sd-game', onclick: () => openGame(g) },
            h('div', { class: 'sd-art' }, (g.hero || g.cover) && h('img', { src: g.hero || g.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }), h('em', { text: ago(g.lastPlayed) })),
            h('b', { text: g.title })
          )))
        ) : null,
        h('section', { class: 'sd-card' },
          h('header', { class: 'sd-h' }, h('h3', { text: 'Avisos' })),
          noteTabs,
          noteList
        )
      )
    ));
  }

  // =================================================== BÚSQUEDA GLOBAL
  let index = [];
  window.refreshSearchIndex = async () => {
    index = await window.api.searchIndex().catch(() => index);
  };
  window.paletteExtra = (t) => {
    const n = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = n(t);
    return index.filter((x) => n(x.label).includes(q)).slice(0, 8).map((x) => ({ kind: 'extra', label: x.label, hint: x.hint, run: () => { if (x.tab === 'anime') state.newsTab = 'anime'; showView(x.view); } }));
  };

  // =================================================== LOGROS FÁCILES
  async function openEasy() {
    const dlg = h('dialog', { class: 'wide rx-dlg' });
    const body = h('div', {}, h('p', { class: 'hint', text: 'Buscando los logros que más gente tiene y a ti te faltan…' }));
    dlg.append(h('form', { method: 'dialog' }, h('h2', { text: 'Logros fáciles que te faltan' }), h('p', { class: 'hint', text: 'De los juegos que ya empezaste, los logros que tiene al menos 1 de cada 4 jugadores.' }), body, h('div', { class: 'actions' }, h('button', { class: 'btn primary', text: 'Cerrar' }))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    try {
      const list = await window.api.achEasy();
      fill(body, list.length ? h('ul', { class: 'ea-list' }, list.map((a) => h('li', {},
        a.icon ? h('img', { src: a.iconGray || a.icon, alt: '', loading: 'lazy' }) : h('span', { class: 'ea-ph' }),
        h('div', {}, h('b', { text: a.name }), h('p', { class: 'hint', text: a.description || (a.hidden ? 'Logro oculto' : '') }), h('small', { text: `${a.game} · ${a.done}/${a.total}` })),
        h('span', { class: 'ea-pct', text: `${Math.round(a.globalPct)} %` })
      ))) : h('p', { class: 'empty', text: 'No encontré logros fáciles pendientes en los juegos que empezaste.' }));
    } catch (e) {
      fill(body, h('p', { class: 'hint bad', text: errMsg(e) }));
    }
  }
  const achHead = document.querySelector('#achView .view-head.split');
  if (achHead) {
    const btn = h('button', { class: 'btn ghost small', text: 'Logros fáciles que te faltan', onclick: openEasy });
    achHead.insertBefore(btn, document.getElementById('achRefresh'));
  }

  // =================================================== JUEGOS GRATIS (Novedades)
  const GW = { data: null, busy: false };
  window.giveawaysSection = () => {
    if (!GW.data && !GW.busy) {
      GW.busy = true;
      window.api.gw.list(false).then((d) => { GW.data = d; GW.busy = false; window.renderNews?.(); }).catch(() => { GW.busy = false; });
    }
    const items = GW.data?.items || [];
    if (!items.length) return null;
    return h('section', { class: 'nw-rels-wrap' },
      h('h2', { class: 'section-h', text: 'Gratis para quedártelos' }),
      h('div', { class: 'nw-rels' }, items.map((g) => h('button', { class: 'nw-rel', onclick: () => window.api.open(g.url) },
        g.image && h('img', { src: g.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
        h('div', { class: 'nw-rel-body' }, h('b', { text: g.title }), h('span', { text: `${g.store}${g.worth ? ` · antes ${g.worth}` : ''}` }), g.ends && h('em', { text: `Hasta el ${new Date(g.ends).toLocaleDateString('es', { day: 'numeric', month: 'short' })}` }))
      )))
    );
  };

  // =================================================== MODS en la ficha
  window.fillGameMods = async (g) => {
    const box = $('#gameMods');
    if (!box) return;
    fill(box);
    if (g.kind === 'tool') return;
    const r = await window.api.nexus.top(g.title).catch(() => null);
    if (!r?.mods?.length || openGameId !== g.id) return;
    fill(box,
      h('h3', { class: 'sheet-h', text: `Mods populares en Nexus Mods (${r.game.mods.toLocaleString('es')})` }),
      h('ul', { class: 'md-list' }, r.mods.slice(0, 6).map((m) => h('li', {},
        h('button', { class: 'md-item', onclick: () => window.api.open(m.url) },
          m.picture && h('img', { src: m.picture, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
          h('div', {}, h('b', { text: m.name }), h('p', { class: 'hint', text: m.summary }), h('small', { text: `${m.endorsements.toLocaleString('es')} recomendaciones · ${m.downloads.toLocaleString('es')} descargas` }))
        )
      ))),
      h('button', { class: 'btn subtle small', text: 'Ver todos en Nexus Mods', onclick: () => window.api.open(r.game.url) })
    );
  };

  // al abrir la app, empieza en Mi día
  window.addEventListener('load', () => setTimeout(() => { if (state.view === 'library') showView('day'); }, 400));
  window.dayUI = { show: dayShow };
})();

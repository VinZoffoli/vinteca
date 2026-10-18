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
    } catch (e) {
      D.error = errMsg(e);
    }
    dayRender();
  }
  function card(title, view, ...kids) {
    const body = kids.flat().filter(Boolean);
    if (!body.length) return null;
    return h('section', { class: 'dy-card' }, h('div', { class: 'dy-head' }, h('h3', { text: title }), view && h('button', { class: 'btn subtle small', text: 'Ver', onclick: () => showView(view) })), body);
  }
  const li = (main, side, cls) => h('li', { class: cls || '' }, h('span', { text: main }), side && h('b', { text: side }));

  // Mi día, al estilo de los widgets de iOS: un encabezado con el clima y el
  // resumen, y debajo bloques por tema (Ahora, Casa, Trabajo, Ocio).
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
  function wg(title, opts, ...kids) {
    const body = kids.flat().filter(Boolean);
    if (!body.length && !opts.keep) return null;
    return h('section', { class: 'wg ' + (opts.size || '') + ' ' + (opts.tone || '') },
      h('header', { class: 'wg-h' },
        h('span', { class: 'wg-dot', style: { background: opts.color || 'var(--amber)' } }),
        h('h3', { text: title }),
        opts.view && h('button', { class: 'wg-more', 'aria-label': 'Abrir ' + title, onclick: () => showView(opts.view) }, '›')
      ),
      body.length ? body : h('p', { class: 'wg-empty', text: opts.empty || 'Nada por aquí.' })
    );
  }
  const rows = (list) => (list.length ? h('ul', { class: 'wg-list' }, list) : null);
  const row = (main, side, cls, sub) => h('li', { class: cls || '' }, h('div', {}, h('span', { text: main }), sub && h('small', { text: sub })), side != null && h('b', { text: side }));

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
    // resumen de una línea, como en la pantalla de bloqueo
    const bits = [];
    bits.push(meets.length ? plural(meets.length, 'reunión', 'reuniones') : 'sin reuniones');
    const payToday = d.pays.filter((p) => p.days <= 0).length;
    if (payToday) bits.push(plural(payToday, 'pago para hoy', 'pagos para hoy'));
    if (d.bdays.some((x) => x.days === 0)) bits.push('un cumpleaños');
    if (w?.today?.heavy) bits.push(w.today.text.toLowerCase());
    else if (w?.today && w.today.prob >= 60) bits.push('probable lluvia');
    const summary = bits.join(' · ');
    const late = d.tickets.filter((t) => t.late).length;

    fill(box,
      // ---------- encabezado
      h('header', { class: 'md-hero' },
        h('div', { class: 'md-hello' },
          h('p', { class: 'md-date', text: now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase()) }),
          h('h1', { text: hello + ', Vincenzo' }),
          h('p', { class: 'md-sum', text: summary.charAt(0).toUpperCase() + summary.slice(1) + '.' })
        ),
        w && h('div', { class: 'md-wx', title: w.stale ? 'Sin conexión: último dato guardado' : 'Clima de Guápiles' },
          h('span', { class: 'md-wx-ico', 'aria-hidden': 'true', text: WX_ICON(w.now.code) }),
          h('div', {},
            h('b', { text: Math.round(w.now.temp) + '°' }),
            h('span', { text: w.now.text }),
            w.today && h('small', { text: 'Máx. ' + Math.round(w.today.max) + '° · Mín. ' + Math.round(w.today.min) + '° · lluvia ' + w.today.prob + ' %' })
          )
        )
      ),

      // ---------- avisos que no pueden esperar
      d.missed?.length ? h('section', { class: 'md-banner cyan' },
        h('div', {}, h('b', { text: 'Mientras jugabas · ' + plural(d.missed.length, 'aviso', 'avisos') }), h('span', { text: d.missed.slice(0, 3).map((m) => m.title).join(' · ') })),
        h('button', { class: 'btn subtle small', text: 'Ya los vi', onclick: async () => { await window.api.dnd.clear(); D.data.missed = []; dayRender(); } })
      ) : null,
      d.week && h('section', { class: 'md-week' },
        h('p', { class: 'md-kicker', text: now.getDay() === 0 ? 'La semana que viene' : 'Esta semana' }),
        h('div', { class: 'md-week-grid' },
          [[d.week.meetings.length, d.week.meetings.length === 1 ? 'reunión' : 'reuniones'], [d.week.pays.length, d.week.pays.length === 1 ? 'pago' : 'pagos'], [d.week.bdays.length, 'cumpleaños'], [d.week.rems.length + d.week.tramites.length, 'recordatorios y trámites']].map(([n, l]) => h('div', {}, h('b', { text: String(n) }), h('span', { text: l })))
        )
      ),

      // ---------- ahora
      h('h2', { class: 'md-sec', text: 'Ahora' }),
      h('div', { class: 'md-grid' },
        nextMeet
          ? h('section', { class: 'wg wide md-meet' },
              h('p', { class: 'md-kicker', text: nextMeet.start <= Date.now() ? 'Reunión en curso' : 'Próxima reunión · ' + until(nextMeet.start) }),
              h('h2', { text: nextMeet.title }),
              h('p', { class: 'md-meet-time', text: hm(nextMeet.start) + ' – ' + hm(nextMeet.end) }),
              h('div', { class: 'md-meet-act' }, nextMeet.link && h('button', { class: 'btn primary', text: 'Unirse', onclick: () => window.api.cal.open(nextMeet.link) }), h('button', { class: 'btn ghost', text: 'Ver agenda', onclick: () => showView('cal') }))
            )
          : h('section', { class: 'wg wide md-meet free' }, h('p', { class: 'md-kicker', text: 'Agenda' }), h('h2', { text: meets.length ? 'Ya no quedan reuniones hoy' : 'Hoy no tienes reuniones' }), h('p', { class: 'md-meet-time', text: 'Buen momento para avanzar tickets o descansar.' })),
        h('section', { class: 'wg md-stats' },
          [
            ['Pagos esta semana', d.pays.length, d.pays.some((p) => p.days <= 0) ? 'hot' : '', 'casa-pagos'],
            ['Tickets que vencen', d.tickets.length, late ? 'hot' : '', 'notion'],
            ['Correos sin leer', d.mail ? d.mail.count : '—', '', 'mail'],
            ['Por comprar', d.shopping, '', 'casa-compras'],
          ].map(([l, v, cls, view]) => h('button', { class: 'md-stat', onclick: () => showView(view) }, h('b', { class: cls, text: String(v) }), h('span', { text: l })))
        ),
        d.fx && h('section', { class: 'wg md-fx' },
          h('header', { class: 'wg-h' }, h('span', { class: 'wg-dot', style: { background: 'var(--green)' } }), h('h3', { text: 'Dólar hoy' })),
          h('b', { class: 'md-big', text: '₡' + d.fx.sell.toLocaleString('es', { minimumFractionDigits: 2 }) }),
          h('small', { class: 'wg-sub', text: 'venta · compra ₡' + d.fx.buy })
        ),
        w && w.hours?.length ? h('section', { class: 'wg wide md-hours' },
          h('header', { class: 'wg-h' }, h('span', { class: 'wg-dot', style: { background: 'var(--cyan)' } }), h('h3', { text: 'Próximas horas en Guápiles' })),
          h('ol', { class: 'md-hourly' }, w.hours.map((x) => h('li', { class: x.prob >= 60 ? 'rain' : '' }, h('small', { text: x.time.slice(11, 16) }), h('span', { 'aria-hidden': 'true', text: WX_ICON(x.code) }), h('b', { text: Math.round(x.temp) + '°' }), h('em', { text: x.prob + ' %' }))))
        ) : null
      ),

      // ---------- casa
      h('h2', { class: 'md-sec', text: 'Casa' }),
      h('div', { class: 'md-grid' },
        wg('Pagos que vienen', { view: 'casa-pagos', color: 'var(--green)', keep: true, empty: 'Nada que pagar esta semana.' }, rows(d.pays.map((p) => row(p.name + (p.group && p.group !== 'Personal' ? ' (' + p.group + ')' : ''), p.days < 0 ? 'Atrasado' : when(p.days), p.days <= 0 ? 'hot' : '', p.amount ? money(p.amount, p.currency) : null)))),
        b.limit
          ? h('section', { class: 'wg md-budget' },
              h('header', { class: 'wg-h' }, h('span', { class: 'wg-dot', style: { background: 'var(--amber)' } }), h('h3', { text: 'Presupuesto' }), h('button', { class: 'wg-more', 'aria-label': 'Abrir presupuesto', onclick: () => showView('casa-presupuesto') }, '›')),
              h('div', { class: 'md-ringbox' }, ringSvg(b.spent / b.limit, b.spent > b.limit ? 'hot' : ''), h('div', {}, h('b', { text: Math.round((b.spent / b.limit) * 100) + ' %' }), h('small', { text: 'usado' }))),
              h('small', { class: 'wg-sub', text: money(b.spent, b.currency) + ' de ' + money(b.limit, b.currency) })
            )
          : wg('Presupuesto', { view: 'casa-presupuesto', color: 'var(--amber)', keep: true, empty: 'Pon un límite del mes y te muestro cuánto llevas.' }),
        wg('Cumpleaños', { view: 'casa-cumples', color: 'var(--pink)' }, rows(d.bdays.map((x) => row(x.name + (x.kind === 'gato' ? ' 🐾' : ''), when(x.days), x.days === 0 ? 'hot' : '', x.age ? 'cumple ' + x.age : null)))),
        wg('Recordatorios', { view: 'casa-recordatorios', color: 'var(--amber)' }, rows(d.rems.map((r) => row(r.title, when(r.days))))),
        wg('Trámites', { view: 'casa-tramites', color: 'var(--cyan)' }, rows((d.tramites || []).map((t) => row(t.name, t.days < 0 ? 'Vencido' : when(t.days), t.days <= 7 ? 'hot' : '')))),
        wg('Hogar', { view: 'casa-hogar', color: 'var(--green)' }, rows((d.hogar || []).map((x) => row(x.name, x.days < 0 ? 'Atrasado' : when(x.days), x.days <= 0 ? 'hot' : '')))),
        wg('Gatitos', { view: 'casa-gatitos', color: 'var(--pink)' }, rows(d.cats.map((c) => row(c.cat, when(c.days), c.days <= 0 ? 'hot' : '', { vacuna: 'vacuna', desparasitacion: 'desparasitación', pulgas: 'antipulgas', veterinario: 'veterinario', otro: c.note || 'cuidado' }[c.type]))))
      ),

      // ---------- trabajo
      h('h2', { class: 'md-sec', text: 'Trabajo' }),
      h('div', { class: 'md-grid' },
        wg('Agenda de hoy', { view: 'cal', color: 'var(--amber)', size: 'tall', keep: true, empty: 'Sin reuniones hoy.' },
          d.meetings.length ? h('ol', { class: 'md-timeline' }, d.meetings.map((m) => h('li', { class: m.end < Date.now() ? 'past' : m.start <= Date.now() ? 'now' : '' }, h('time', { text: m.allDay ? 'Todo el día' : hm(m.start) }), h('span', { text: m.title })))) : null
        ),
        wg('Tickets de Notion', { view: 'notion', color: 'var(--pink)', size: 'tall' }, rows(d.tickets.slice(0, 7).map((t) => row(t.title, t.late ? 'Vencido' : t.deadline, t.late ? 'hot' : ''))), d.tickets.length > 7 && h('p', { class: 'wg-sub', text: 'y ' + (d.tickets.length - 7) + ' más' })),
        wg('Correo', { view: 'mail', color: 'var(--cyan)' }, d.mail?.count ? [h('b', { class: 'md-big', text: String(d.mail.count) }), h('small', { class: 'wg-sub', text: 'sin leer' }), rows(d.mail.last.map((m) => row(m.subject, null, '', m.from)))] : null),
        d.pulls ? wg('Websites', { view: 'webs', color: 'var(--green)' }, h('b', { class: 'md-big', text: String(d.pulls) }), h('small', { class: 'wg-sub', text: d.pulls === 1 ? 'web necesita git pull' : 'webs necesitan git pull' })) : null
      ),

      // ---------- ocio
      h('h2', { class: 'md-sec', text: 'Ocio' }),
      h('div', { class: 'md-grid' },
        h('section', { class: 'wg md-genshin' },
          h('header', { class: 'wg-h' }, h('span', { class: 'wg-dot', style: { background: 'var(--cyan)' } }), h('h3', { text: 'Genshin' }), h('button', { class: 'wg-more', 'aria-label': 'Abrir Genshin', onclick: () => showView('genshin') }, '›')),
          d.resin ? h('div', { class: 'md-ringbox' }, ringSvg(d.resin.value / d.resin.max, d.resin.value >= d.resin.max ? 'hot' : 'cyan'), h('div', {}, h('b', { text: String(d.resin.value) }), h('small', { text: 'de ' + d.resin.max + ' resina' }))) : null,
          rows([...d.resets.map((r) => row(r.name, until(r.at))), ...(d.gather || []).map((g) => row(g.name, g.readyAt <= Date.now() ? 'Listo' : until(g.readyAt), g.readyAt <= Date.now() ? 'hot' : ''))])
        ),
        wg('Anime', { view: 'news', color: 'var(--pink)' }, rows(d.anime.map((x) => row(x.title, (new Date(x.at).toDateString() === new Date().toDateString() ? 'hoy ' : 'mañana ') + hm(x.at), '', x.what)))),
        wg('Juegos gratis', { view: 'news', color: 'var(--green)' }, rows(d.giveaways.map((g) => row(g.title, g.store))))
      ),

      // ---------- pie
      h('footer', { class: 'md-foot' },
        h('section', { class: 'md-phone' },
          D.lan?.dayQr ? h('img', { src: D.lan.mQr || D.lan.dayQr, alt: 'Código QR de ViperTeca para el celular' }) : null,
          h('div', {},
            h('b', { text: 'ViperTeca en tu iPhone' }),
            h('p', { class: 'hint', text: D.lan?.dayQr ? 'Escanéalo con la cámara. Con Tailscale funciona fuera de casa (código en «En el móvil»).' : 'Enciende el acceso desde el celular y tendrás la app en el teléfono.' }),
            h('div', { class: 'row' },
              !D.lan?.dayQr && h('button', { class: 'btn ghost small', text: 'Encender', onclick: async () => { try { D.lan = await window.api.lanStart(); dayRender(); } catch (e) { toast(errMsg(e), true); } } }),
              h('button', { class: 'btn ghost small', text: 'Widget de escritorio', onclick: async () => { const on = await window.api.widget.toggle(); toast(on ? 'Widget abierto: arrástralo donde quieras.' : 'Widget cerrado.'); } })
            )
          )
        ),
        D.backup && h('p', { class: 'hint md-backup' },
          D.backup.available ? 'Copia en OneDrive: ' + (D.backup.last ? 'la última es del ' + D.backup.last : 'todavía ninguna') + '. ' : 'No encuentro OneDrive en este PC. ',
          D.backup.available && h('button', { class: 'btn subtle small', text: 'Hacer copia ahora', onclick: async () => { try { D.backup = await window.api.backup.run(); toast('Copia guardada en OneDrive.'); dayRender(); } catch (e) { toast(errMsg(e), true); } } })
        )
      )
    );
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

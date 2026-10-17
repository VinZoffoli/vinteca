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

  function dayRender() {
    const box = $('#dayBody');
    if (!box) return;
    const d = D.data;
    if (!d) return fill(box, h('p', { class: 'hint', text: D.error || 'Preparando tu día…' }));
    const now = new Date();
    const hello = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';
    $('#dayTitle').textContent = `${hello}, Vincenzo`;
    $('#daySub').textContent = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
    const nextMeet = d.meetings.find((m) => !m.allDay);
    const b = d.budget;
    fill(box,
      h('div', { class: 'dy-strip' },
        h('div', {}, h('dt', { text: 'Reuniones hoy' }), h('dd', { text: String(d.meetings.filter((m) => !m.allDay).length) })),
        h('div', {}, h('dt', { text: 'Pagos esta semana' }), h('dd', { class: d.pays.some((p) => p.days <= 0) ? 'hot' : '', text: String(d.pays.length) })),
        h('div', {}, h('dt', { text: 'Correos sin leer' }), h('dd', { text: d.mail ? String(d.mail.count) : '—' })),
        h('div', {}, h('dt', { text: 'Tickets que vencen' }), h('dd', { class: d.tickets.some((t) => t.late) ? 'hot' : '', text: String(d.tickets.length) })),
        h('div', {}, h('dt', { text: 'Por comprar' }), h('dd', { text: String(d.shopping) })),
        d.fx && h('div', { title: `Compra ₡${d.fx.buy} · tipo de cambio del Banco Central` }, h('dt', { text: 'Dólar hoy' }), h('dd', { text: `₡${Math.round(d.fx.sell)}` }))
      ),
      d.missed?.length ? h('section', { class: 'dy-missed' },
        h('div', { class: 'dy-head' }, h('h3', { text: `Mientras jugabas · ${plural(d.missed.length, 'aviso', 'avisos')}` }), h('button', { class: 'btn subtle small', text: 'Ya los vi', onclick: async () => { await window.api.dnd.clear(); D.data.missed = []; dayRender(); } })),
        h('ul', { class: 'dy-list' }, d.missed.slice(0, 8).map((m) => h('li', {}, h('span', { text: m.body ? `${m.title} · ${m.body.split('\n')[0]}` : m.title }), h('b', { text: hm(m.at) }))))
      ) : null,
      d.week && h('section', { class: 'dy-week' },
        h('p', { class: 'dy-kicker', text: new Date().getDay() === 0 ? 'La semana que viene' : 'Esta semana' }),
        h('div', { class: 'dy-week-grid' },
          h('div', {}, h('b', { text: String(d.week.meetings.length) }), h('span', { text: d.week.meetings.length === 1 ? 'reunión' : 'reuniones' })),
          h('div', {}, h('b', { text: String(d.week.pays.length) }), h('span', { text: d.week.pays.length === 1 ? 'pago' : 'pagos' })),
          h('div', {}, h('b', { text: String(d.week.bdays.length) }), h('span', { text: 'cumpleaños' })),
          h('div', {}, h('b', { text: String(d.week.rems.length + d.week.tramites.length) }), h('span', { text: 'recordatorios y trámites' }))
        ),
        [...d.week.bdays.map((b) => `cumple de ${b.name} ${when(b.days)}`), ...d.week.tramites.map((t) => `vence ${t.name} ${when(t.days)}`), ...d.week.premieres.map((a) => `estreno de ${a.title}`)].length
          ? h('p', { class: 'hint', text: [...d.week.bdays.map((b) => `cumple de ${b.name} ${when(b.days)}`), ...d.week.tramites.map((t) => `vence ${t.name} ${when(t.days)}`), ...d.week.premieres.map((a) => `estreno de ${a.title}`)].join(' · ') })
          : null
      ),
      nextMeet && h('section', { class: 'dy-next' },
        h('p', { class: 'dy-kicker', text: nextMeet.start <= Date.now() ? 'Reunión en curso' : `Próxima reunión · ${until(nextMeet.start)}` }),
        h('h2', { text: nextMeet.title }),
        h('p', { class: 'hint', text: `${hm(nextMeet.start)} – ${hm(nextMeet.end)}` }),
        nextMeet.link && h('button', { class: 'btn primary small', text: 'Unirse', onclick: () => window.api.cal.open(nextMeet.link) })
      ),
      h('div', { class: 'dy-grid' },
        card('Agenda de hoy', 'cal', d.meetings.length ? h('ul', { class: 'dy-list' }, d.meetings.map((m) => li(m.title, m.allDay ? 'Todo el día' : hm(m.start), m.end < Date.now() ? 'past' : ''))) : null),
        card('Pagos que vienen', 'casa-pagos', d.pays.length ? h('ul', { class: 'dy-list' }, d.pays.map((p) => li(`${p.name}${p.group && p.group !== 'Personal' ? ` (${p.group})` : ''}${p.amount ? ` · ${money(p.amount, p.currency)}` : ''}`, p.days < 0 ? 'Atrasado' : when(p.days), p.days <= 0 ? 'hot' : ''))) : null),
        card('Cumpleaños', 'casa-cumples', d.bdays.length ? h('ul', { class: 'dy-list' }, d.bdays.map((x) => li(`${x.name}${x.kind === 'gato' ? ' (gatito)' : ''}${x.age ? ` · cumple ${x.age}` : ''}`, when(x.days), x.days === 0 ? 'hot' : ''))) : null),
        card('Recordatorios', 'casa-recordatorios', d.rems.length ? h('ul', { class: 'dy-list' }, d.rems.map((r) => li(r.title, when(r.days)))) : null),
        card('Trámites', 'casa-tramites', d.tramites?.length ? h('ul', { class: 'dy-list' }, d.tramites.map((t) => li(t.name, t.days < 0 ? 'Vencido' : when(t.days), t.days <= 7 ? 'hot' : ''))) : null),
        card('Gatitos', 'casa-gatitos', d.cats.length ? h('ul', { class: 'dy-list' }, d.cats.map((c) => li(`${c.cat}: ${{ vacuna: 'vacuna', desparasitacion: 'desparasitación', pulgas: 'antipulgas', veterinario: 'veterinario', otro: c.note || 'cuidado' }[c.type]}`, when(c.days), c.days <= 0 ? 'hot' : ''))) : null),
        card('Tickets de Notion', 'notion', d.tickets.length ? [h('ul', { class: 'dy-list' }, d.tickets.slice(0, 6).map((t) => li(t.title, t.late ? 'Vencido' : t.deadline, t.late ? 'hot' : ''))), d.tickets.length > 6 && h('p', { class: 'hint', text: `y ${d.tickets.length - 6} más` })] : null),
        card('Correo', 'mail', d.mail?.count ? h('ul', { class: 'dy-list' }, d.mail.last.map((m) => li(m.subject, m.from))) : null),
        card('Anime', 'news', d.anime.length ? h('ul', { class: 'dy-list' }, d.anime.map((a) => li(`${a.title} · ${a.what}`, `${new Date(a.at).toDateString() === new Date().toDateString() ? 'hoy' : 'mañana'} ${hm(a.at)}`))) : null),
        card('Genshin', 'genshin', [
          d.resin && h('p', { class: `dy-big ${d.resin.value >= d.resin.max ? 'hot' : ''}`, text: `Resina ${d.resin.value}/${d.resin.max}` }),
          h('ul', { class: 'dy-list' }, d.resets.map((r) => li(r.name, until(r.at)))),
          d.gather?.length && h('ul', { class: 'dy-list' }, d.gather.map((g) => li(g.name, g.readyAt <= Date.now() ? 'Listo para recoger' : until(g.readyAt), g.readyAt <= Date.now() ? 'hot' : ''))),
        ]),
        card('Presupuesto del mes', 'casa-presupuesto', b.limit ? [h('p', { class: 'dy-big', text: `${money(b.spent, b.currency)} de ${money(b.limit, b.currency)}` }), h('div', { class: 'dy-bar' }, h('i', { class: b.spent > b.limit ? 'hot' : '', style: { width: `${Math.min(100, (b.spent / b.limit) * 100)}%` } }))] : h('p', { class: 'hint', text: 'Pon un límite en Casa → Presupuesto para ver cuánto llevas.' })),
        card('Juegos gratis ahora', 'news', d.giveaways.length ? h('ul', { class: 'dy-list' }, d.giveaways.map((g) => li(g.title, g.store))) : null),
        d.pulls ? card('Websites', 'webs', h('p', { class: 'hint', text: `${plural(d.pulls, 'web necesita', 'webs necesitan')} git pull.` })) : null
      ),
      D.backup && h('p', { class: 'hint dy-foot' },
        D.backup.available ? `Copia en OneDrive: ${D.backup.last ? `la última es del ${D.backup.last}` : 'todavía ninguna'}. ` : 'No encuentro OneDrive en este PC. ',
        D.backup.available && h('button', { class: 'btn subtle small', text: 'Hacer copia ahora', onclick: async () => { try { D.backup = await window.api.backup.run(); toast('Copia guardada en OneDrive.'); dayRender(); } catch (e) { toast(errMsg(e), true); } } }),
        D.backup.available && D.backup.last && h('button', { class: 'btn subtle small', text: 'Abrir carpeta', onclick: () => window.api.backup.open() })
      ),
      h('section', { class: 'dy-phone' },
        D.lan?.dayQr ? h('img', { src: D.lan.dayQr, alt: 'Código QR de Mi día para el celular' }) : null,
        h('div', {},
          h('h3', { text: 'Mi día en el celular' }),
          D.lan?.dayQr
            ? h('p', { class: 'hint', text: 'Escanéalo con la cámara del celular (en la misma wifi) y tendrás esta pantalla allí, actualizada cada minuto.' })
            : h('p', { class: 'hint', text: 'Enciende el acceso desde el celular y te doy un código QR para ver tu día desde el teléfono, en la misma wifi.' }),
          !D.lan?.dayQr && h('button', { class: 'btn ghost small', text: 'Encender acceso desde el celular', onclick: async () => { try { D.lan = await window.api.lanStart(); dayRender(); } catch (e) { toast(errMsg(e), true); } } })
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

'use strict';
// Resto Experience dentro de ViperTeca: calendario de trabajo, tickets y
// pipeline de Notion, y el estado de los repositorios de cada web.
(function () {
  const re = window.api.re;
  const cal = window.api.cal;
  const DAY = 86400000;
  const dayKey = (t) => new Date(t).toDateString();
  const hm = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const dateLong = (t) => new Date(t).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateShort = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const ago = (t) => (t ? relTime(new Date(t).getTime() / 1000) : '');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function dayName(t) {
    const d0 = new Date().setHours(0, 0, 0, 0);
    const d = new Date(t).setHours(0, 0, 0, 0);
    const n = Math.round((d - d0) / DAY);
    return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n === -1 ? 'Ayer' : cap(dateLong(t));
  }
  function until(t) {
    const m = Math.round((t - Date.now()) / 60000);
    if (m <= 0) return 'ahora';
    if (m < 60) return `en ${m} min`;
    const hh = Math.floor(m / 60);
    if (hh < 24) return `en ${hh} h${m % 60 ? ` ${m % 60} min` : ''}`;
    return `en ${plural(Math.round(m / 1440), 'día', 'días')}`;
  }
  const skeleton = (n) => h('div', { class: 'rx-skel', 'aria-busy': 'true', 'aria-label': 'Cargando' }, Array.from({ length: n }, () => h('div', { class: 'skel rx-skel-row' }, h('i', { class: 'skel-line w70' }), h('i', { class: 'skel-line w40' }))));

  // =====================================================================
  // CALENDARIO
  // =====================================================================
  const C = { linked: null, data: null, busy: false, error: null, timer: null, setup: false };

  async function calShow(force) {
    if (C.linked == null) C.linked = (await cal.status()).linked;
    if (!C.linked) return calRender();
    if (!C.data || force) {
      C.busy = true;
      C.error = null;
      calRender();
      try {
        C.data = await cal.get(!!force);
      } catch (e) {
        C.error = errMsg(e);
      }
      C.busy = false;
    }
    calRender();
    clearInterval(C.timer);
    C.timer = setInterval(() => !$('#calView').hidden && calRender(), 30000);
  }

  function calSetup() {
    const input = h('input', { type: 'password', class: 'rx-input', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', autocomplete: 'off', spellcheck: false, 'aria-label': 'Dirección secreta en formato iCal' });
    const save = async () => {
      try {
        await cal.setUrl(input.value);
        input.value = '';
        C.linked = true;
        C.setup = false;
        toast('Calendario conectado.');
        calShow(true);
        updateBadges();
      } catch (e) {
        toast(errMsg(e), true);
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    return h('div', { class: 'rx-setup' },
      h('h2', { text: 'Conecta tu Google Calendar' }),
      h('p', { class: 'sub', text: 'ViperTeca lee tu calendario con su dirección privada: ve tus reuniones pero no puede crear, mover ni borrar nada. La pegas tú una vez y se guarda cifrada en este PC.' }),
      h('ol', { class: 'rx-steps' },
        h('li', {}, 'Abre la configuración de Google Calendar con la cuenta vincenzo@restoexp.com. ', h('button', { class: 'btn ghost small', text: 'Abrir configuración', onclick: () => cal.open('https://calendar.google.com/calendar/u/0/r/settings') })),
        h('li', { text: 'En la columna izquierda, dentro de "Configuración de mis calendarios", haz clic en tu calendario (vincenzo@restoexp.com).' }),
        h('li', { text: 'Baja hasta "Integrar el calendario" y copia la "Dirección secreta en formato iCal".' }),
        h('li', { text: 'Pégala aquí abajo y guarda.' })
      ),
      h('div', { class: 'rx-paste' }, input, h('button', { class: 'btn primary', text: 'Guardar dirección', onclick: save })),
      h('p', { class: 'hint', text: 'Si no ves esa opción, tu cuenta de empresa la tiene desactivada: pídeselo a quien administra Google Workspace en Resto Experience. Si alguna vez la compartes por error, restablécela en Google y pega la nueva.' }),
      C.linked && h('button', { class: 'btn subtle small', text: 'Cancelar', onclick: () => ((C.setup = false), calRender()) })
    );
  }

  function joinBtn(e, cls = 'btn primary small') {
    if (!e.link) return null;
    const label = /meet\.google/.test(e.link) ? 'Unirse a Meet' : /zoom/.test(e.link) ? 'Unirse a Zoom' : /teams/.test(e.link) ? 'Unirse a Teams' : 'Unirse';
    return h('button', { class: cls, text: label, onclick: () => cal.open(e.link) });
  }
  const isNew = (e) => e.created && Date.now() - e.created < 2 * DAY;

  function eventRow(e) {
    const now = Date.now();
    const live = e.start <= now && e.end > now;
    const past = e.end <= now;
    const tags = [
      live && h('span', { class: 'rx-tag live', text: 'Ahora' }),
      e.daily && h('span', { class: 'rx-tag daily', text: 'Daily' }),
      isNew(e) && h('span', { class: 'rx-tag new', text: 'Nueva' }),
      e.myStatus === 'NEEDS-ACTION' && h('span', { class: 'rx-tag ask', text: 'Sin responder' }),
      e.myStatus === 'DECLINED' && h('span', { class: 'rx-tag off', text: 'Rechazada' }),
      e.myStatus === 'TENTATIVE' && h('span', { class: 'rx-tag', text: 'Quizás' }),
    ];
    const who = e.organizerIsMe ? 'Organizas tú' : e.organizer ? `Organiza ${e.organizer.split('@')[0]}` : '';
    return h('li', { class: `rx-ev${past ? ' past' : ''}${live ? ' live' : ''}${e.myStatus === 'DECLINED' ? ' declined' : ''}` },
      h('div', { class: 'rx-ev-time' }, e.allDay ? h('b', { text: 'Todo el día' }) : [h('b', { text: hm(e.start) }), h('span', { text: hm(e.end) })]),
      h('div', { class: 'rx-ev-main' },
        h('p', { class: 'rx-ev-title' }, h('span', { text: e.title }), tags),
        h('p', { class: 'rx-ev-meta' }, [who && h('span', { text: who }), e.people ? h('span', { text: plural(e.people, 'persona más', 'personas más'), title: e.peopleNames.join(', ') }) : null, e.location && h('span', { text: e.location }), e.recurring && !e.daily && h('span', { text: 'Se repite' })])
      ),
      !past && !e.allDay && joinBtn(e, live ? 'btn primary small' : 'btn ghost small')
    );
  }

  function dayStrip(list) {
    // franja de hoy de 8 a 20 h (se estira si hay algo fuera)
    const today = list.filter((e) => !e.allDay && dayKey(e.start) === dayKey(Date.now()) && e.myStatus !== 'DECLINED');
    const d0 = new Date().setHours(0, 0, 0, 0);
    let from = 8;
    let to = 20;
    for (const e of today) {
      from = Math.min(from, Math.floor((e.start - d0) / 3600000));
      to = Math.max(to, Math.ceil((e.end - d0) / 3600000));
    }
    from = Math.max(0, from);
    to = Math.min(24, to);
    const span = (to - from) * 3600000;
    const pos = (t) => `${Math.max(0, Math.min(100, ((t - d0 - from * 3600000) / span) * 100))}%`;
    const hours = [];
    for (let k = from; k <= to; k += 2) hours.push(h('span', { class: 'rx-hour', style: { left: pos(d0 + k * 3600000) }, text: `${k}` }));
    const nowT = Date.now();
    return h('div', { class: 'rx-strip', 'aria-label': 'Tu día' },
      hours,
      today.map((e) => h('button', { class: `rx-block${e.daily ? ' daily' : ''}${e.end < nowT ? ' past' : ''}`, style: { left: pos(e.start), width: `calc(${pos(e.end)} - ${pos(e.start)})` }, title: `${hm(e.start)}–${hm(e.end)} · ${e.title}`, onclick: () => e.link && cal.open(e.link) }, h('span', { text: e.title }))),
      nowT > d0 + from * 3600000 && nowT < d0 + to * 3600000 && h('i', { class: 'rx-now', style: { left: pos(nowT) } })
    );
  }

  function dailies(list) {
    const now = Date.now();
    const by = new Map();
    for (const e of list) {
      if (!e.daily || e.myStatus === 'DECLINED') continue;
      const k = e.uid;
      if (!by.has(k)) by.set(k, { title: e.title, link: e.link, times: new Set(), days: new Set(), next: null });
      const d = by.get(k);
      d.times.add(hm(e.start));
      d.days.add(new Date(e.start).getDay());
      if (e.end > now && (!d.next || e.start < d.next.start)) d.next = e;
    }
    const names = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    const rows = [...by.values()].filter((d) => d.next).sort((a, b) => a.next.start - b.next.start);
    if (!rows.length) return null;
    return h('section', { class: 'rx-card rx-dailies' },
      h('h3', { text: 'Tus dailys' }),
      h('ul', {}, rows.map((d) => {
        const days = [1, 2, 3, 4, 5, 6, 0].filter((x) => d.days.has(x));
        const weekdays = days.length === 5 && !d.days.has(0) && !d.days.has(6);
        return h('li', {},
          h('div', {}, h('b', { text: d.title }), h('span', { text: `${weekdays ? 'Lunes a viernes' : days.map((x) => names[x]).join(', ')} · ${[...d.times].join(' / ')}` })),
          h('div', { class: 'rx-daily-next' }, h('span', { text: `${dayName(d.next.start)} ${hm(d.next.start)} · ${until(d.next.start)}` }), joinBtn(d.next, 'btn ghost small'))
        );
      }))
    );
  }

  function calRender() {
    const body = $('#calBody');
    if (!body) return;
    $('#calActions').hidden = !C.linked;
    if (C.linked === false || C.setup) return fill(body, calSetup());
    if (C.busy && !C.data) return fill(body, skeleton(5));
    if (C.error && !C.data) return fill(body, h('div', { class: 'notice' }, h('span', { text: C.error }), h('button', { class: 'btn ghost small', text: 'Cambiar dirección', onclick: () => ((C.setup = true), calRender()) })));
    const list = C.data?.events || [];
    const now = Date.now();
    const upcoming = list.filter((e) => e.end > now && !e.allDay && e.myStatus !== 'DECLINED' && !e.free);
    const next = upcoming[0];
    const todayLeft = upcoming.filter((e) => dayKey(e.start) === dayKey(now)).length;
    const fresh = list.filter((e) => e.end > now && isNew(e));
    const pending = list.filter((e) => e.end > now && e.myStatus === 'NEEDS-ACTION');

    const hero = next
      ? h('section', { class: `rx-next${next.start <= now ? ' live' : ''}` },
          h('p', { class: 'rx-next-when', text: next.start <= now ? `En curso · termina a las ${hm(next.end)}` : `${dayName(next.start)} a las ${hm(next.start)} · ${until(next.start)}` }),
          h('h2', { text: next.title }),
          h('p', { class: 'rx-ev-meta' }, [next.organizer && h('span', { text: next.organizerIsMe ? 'Organizas tú' : `Organiza ${next.organizer.split('@')[0]}` }), (() => {
            const names = next.peopleNames.filter((n) => n !== next.organizer);
            const extra = next.people - next.peopleNames.length;
            return names.length ? h('span', { text: `Con ${names.join(', ')}${extra > 0 ? ` y ${extra} más` : ''}` }) : null;
          })()]),
          h('div', { class: 'rx-next-act' }, joinBtn(next, 'btn primary'))
        )
      : h('section', { class: 'rx-next calm' }, h('h2', { text: 'Sin reuniones por delante' }), h('p', { class: 'sub', text: 'No tienes nada agendado en las próximas tres semanas.' }));

    // agenda por días (14 días)
    const groups = new Map();
    for (const e of list) {
      if (e.end < new Date().setHours(0, 0, 0, 0) || e.start > now + 14 * DAY) continue;
      const k = dayKey(e.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const agenda = [...groups.entries()].map(([, evs]) => h('section', { class: 'rx-day' }, h('h3', { text: dayName(evs[0].start) }), h('ul', {}, evs.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1)).map(eventRow))));

    fill(body,
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Quedan hoy' }), h('dd', { text: todayLeft ? plural(todayLeft, 'reunión', 'reuniones') : 'Nada más' })),
        h('div', {}, h('dt', { text: 'Esta semana' }), h('dd', { text: String(upcoming.filter((e) => e.start < now + 7 * DAY).length) })),
        h('div', {}, h('dt', { text: 'Nuevas (48 h)' }), h('dd', { class: fresh.length ? 'rx-hot' : '', text: String(new Set(fresh.map((e) => e.uid)).size) })),
        h('div', {}, h('dt', { text: 'Sin responder' }), h('dd', { class: pending.length ? 'rx-hot' : '', text: String(new Set(pending.map((e) => e.uid)).size) }))
      ),
      h('div', { class: 'rx-cal-top' }, hero, dailies(list)),
      h('section', { class: 'rx-card' }, h('h3', { text: 'Tu día' }), dayStrip(list)),
      agenda.length ? h('div', { class: 'rx-agenda' }, agenda) : h('p', { class: 'empty', text: 'Nada en las próximas dos semanas.' }),
      h('p', { class: 'hint rx-foot', text: `Actualizado ${ago(C.data.at)}. ViperTeca revisa tu calendario cada 5 minutos y te avisa si te agendan una reunión nueva o si cambia una hora.` })
    );
  }

  async function calSettings() {
    const s = await window.api.getSettings();
    const t1 = h('input', { type: 'checkbox', checked: s.calNewAlerts !== false, onchange: (e) => window.api.saveSettings({ calNewAlerts: e.target.checked }) });
    const t2 = h('input', { type: 'checkbox', checked: s.calReminders !== false, onchange: (e) => window.api.saveSettings({ calReminders: e.target.checked }) });
    const dlg = h('dialog', { class: 'rx-dlg' },
      h('form', { method: 'dialog' },
        h('h2', { text: 'Avisos del calendario' }),
        h('label', { class: 'rx-check' }, t1, h('span', { text: 'Avisarme cuando me agenden una reunión nueva o cambie una hora' })),
        h('label', { class: 'rx-check' }, t2, h('span', { text: 'Avisarme 5 minutos antes de cada reunión' })),
        h('hr'),
        h('div', { class: 'rx-row' },
          h('button', { type: 'button', class: 'btn ghost small', text: 'Cambiar la dirección del calendario', onclick: () => { dlg.close(); C.setup = true; calRender(); } }),
          h('button', { type: 'button', class: 'btn subtle small', text: 'Desconectar', onclick: async () => { await cal.setUrl(''); C.linked = false; C.data = null; dlg.close(); calRender(); updateBadges(); } })
        ),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', text: 'Listo' }))
      )
    );
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // =====================================================================
  // NOTION
  // =====================================================================
  const N = { linked: null, data: null, busy: false, error: null, tab: 'tickets', pipeMine: true, pipeQ: '', chats: {}, open: null, connecting: false };
  const GROUPS = [['todo', 'Por hacer'], ['doing', 'En curso'], ['done', 'Listo']];
  const VERDICT = { pending: ['Queda algo pendiente', 'pend'], waiting: ['Esperando respuesta', 'wait'], done: ['Parece listo', 'ok'], review: ['Revisa el chat', 'rev'], unknown: ['Sin chat', 'none'] };
  const prioClass = (p) => (/MAX|ASAP|Urgent/i.test(p) ? 'p1' : /High/i.test(p) ? 'p2' : /Medium/i.test(p) ? 'p3' : /Low|Pausado/i.test(p) ? 'p4' : '');
  const prioText = (p) => String(p || '').replace(/^[^\p{L}]+/u, '').trim();

  async function notionShow(force) {
    if (N.alerts == null) N.alerts = (await window.api.basicSettings()).notionAlerts;
    if (N.linked == null) N.linked = (await re.notionStatus()).linked;
    if (!N.linked) return notionRender();
    if (!N.data || force) {
      N.busy = true;
      N.error = null;
      notionRender();
      try {
        N.data = await re.notion(!!force);
        if (force) N.chats = {};
        prefetchChats();
      } catch (e) {
        N.error = errMsg(e);
        if (/Conecta|caduc/i.test(N.error)) N.linked = (await re.notionStatus()).linked;
      }
      N.busy = false;
      updateBadges();
    }
    notionRender();
  }

  async function connect() {
    N.connecting = true;
    notionRender();
    try {
      await re.notionLogin();
      N.linked = true;
      toast('Notion conectado.');
      N.connecting = false;
      notionShow(true);
    } catch (e) {
      N.connecting = false;
      toast(errMsg(e), true);
      notionRender();
    }
  }

  // lee el chat de los tickets abiertos en segundo plano (3 a la vez)
  async function prefetchChats() {
    const list = (N.data?.tickets || []).filter((t) => t.group !== 'done' && !N.chats[t.id]);
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const t = list[i++];
        try {
          N.chats[t.id] = await re.ticketChat(t.id, t);
        } catch (e) {
          N.chats[t.id] = { error: errMsg(e) };
        }
        if (!$('#notionView').hidden && N.tab === 'tickets') notionRender();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function deadlineInfo(t) {
    if (!t.deadline) return null;
    const due = new Date(t.deadline + 'T23:59:59').getTime();
    const days = Math.ceil((due - Date.now()) / DAY) - 1;
    if (t.group === 'done') return { text: `Fecha límite ${dateShort(t.deadline + 'T12:00')}`, cls: '' };
    if (days < 0) return { text: `Venció hace ${plural(-days, 'día', 'días')}`, cls: 'late' };
    if (days === 0) return { text: 'Vence hoy', cls: 'soon' };
    if (days <= 2) return { text: `Vence ${days === 1 ? 'mañana' : 'en 2 días'}`, cls: 'soon' };
    return { text: `Vence el ${dateShort(t.deadline + 'T12:00')}`, cls: '' };
  }

  function ticketCard(t) {
    const d = deadlineInfo(t);
    const chat = N.chats[t.id];
    const v = chat?.analysis ? VERDICT[chat.analysis.verdict] : null;
    return h('li', {},
      h('button', { class: `rx-tk${N.open === t.id ? ' open' : ''}`, onclick: () => openTicket(t) },
        h('div', { class: 'rx-tk-top' }, t.priority && h('span', { class: `rx-prio ${prioClass(t.priority)}`, text: prioText(t.priority) }), h('span', { class: 'rx-status', text: t.status })),
        h('b', { class: 'rx-tk-title', text: t.title }),
        t.summary && h('p', { class: 'rx-tk-sum', text: t.summary }),
        h('div', { class: 'rx-tk-foot' },
          d && h('span', { class: `rx-due ${d.cls}`, text: d.text }),
          h('span', { text: `Creado ${ago(t.created)}` }),
          t.group !== 'done' && (v ? h('span', { class: `rx-verdict ${v[1]}`, text: v[0] }) : chat?.error ? null : h('span', { class: 'rx-verdict loading', text: 'Leyendo chat…' }))
        )
      )
    );
  }

  function ticketsTab() {
    const list = N.data?.tickets || [];
    const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
    for (const t of list) by[t.group]?.push(t);
    const sortOpen = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999');
    by.todo.sort(sortOpen);
    by.doing.sort(sortOpen);
    const late = list.filter((t) => t.group !== 'done' && deadlineInfo(t)?.cls === 'late').length;
    const pend = list.filter((t) => t.group !== 'done' && ['pending'].includes(N.chats[t.id]?.analysis?.verdict)).length;
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Por hacer' }), h('dd', { text: String(by.todo.length) })),
        h('div', {}, h('dt', { text: 'En curso' }), h('dd', { text: String(by.doing.length) })),
        h('div', {}, h('dt', { text: 'Vencidos' }), h('dd', { class: late ? 'rx-hot' : '', text: String(late) })),
        h('div', {}, h('dt', { text: 'Con algo pendiente en el chat' }), h('dd', { class: pend ? 'rx-hot' : '', text: String(pend) })),
        h('div', {}, h('dt', { text: 'Cerrados este mes' }), h('dd', { text: String(by.done.length) }))
      ),
      list.length
        ? h('div', { class: 'rx-board' }, GROUPS.map(([k, label]) => h('section', { class: `rx-col ${k}` }, h('h3', {}, label, h('span', { class: 'count', text: String(by[k].length) })), by[k].length ? h('ul', {}, by[k].map(ticketCard)) : h('p', { class: 'rx-col-empty', text: k === 'done' ? 'Nada cerrado en el último mes.' : 'Nada aquí.' }))))
        : h('p', { class: 'empty' }, h('b', { text: 'No tienes tickets a tu nombre' }), 'Cuando te pongan como responsable de un ticket, aparecerá aquí.'),
    ];
  }

  async function openTicket(t) {
    const dlg = h('dialog', { class: 'wide rx-dlg rx-ticket' });
    const render = () => {
      const chat = N.chats[t.id];
      const d = deadlineInfo(t);
      const a = chat?.analysis;
      const v = a ? VERDICT[a.verdict] : null;
      fill(dlg, h('form', { method: 'dialog' },
        h('div', { class: 'rx-tk-top' }, t.priority && h('span', { class: `rx-prio ${prioClass(t.priority)}`, text: prioText(t.priority) }), h('span', { class: 'rx-status', text: t.status }), t.num && h('span', { class: 'rx-num', text: t.num })),
        h('h2', { text: t.title }),
        h('dl', { class: 'stat-strip rx-facts' },
          h('div', {}, h('dt', { text: 'Fecha límite' }), h('dd', { class: d?.cls === 'late' ? 'rx-hot' : '', text: t.deadline ? `${cap(dateLong(t.deadline + 'T12:00'))}` : 'Sin fecha' })),
          h('div', {}, h('dt', { text: 'Creado' }), h('dd', { text: t.created ? `${dateShort(t.created)} (${ago(t.created)})` : '—' })),
          h('div', {}, h('dt', { text: 'Estado' }), h('dd', { text: t.status }))
        ),
        h('h3', { class: 'rx-sec', text: 'De qué trata' }),
        h('p', { class: 'rx-summary', text: t.summary || 'El ticket no tiene resumen. Ábrelo en Notion para ver el detalle.' }),
        h('h3', { class: 'rx-sec', text: '¿Queda algo?' }),
        !chat ? h('p', { class: 'hint', text: 'Leyendo el chat del ticket…' })
          : chat.error ? h('p', { class: 'hint bad', text: chat.error })
          : h('div', { class: `rx-analysis ${v[1]}` }, h('b', { text: v[0] }), h('p', { text: [a.why, ...a.notes].join(' ') })),
        chat?.comments?.length ? [h('h3', { class: 'rx-sec', text: `Chat del ticket (${chat.analysis.count})` }), h('ol', { class: 'rx-chat' }, chat.comments.map((c) => h('li', { class: c.mine ? 'mine' : '' }, h('p', { class: 'rx-chat-who' }, h('b', { text: c.mine ? 'Tú' : c.author }), h('span', { text: ago(c.at) })), h('p', { class: 'rx-chat-text', text: c.text || (c.images ? '(imagen)' : '') }), c.images && c.text ? h('span', { class: 'rx-chat-img', text: plural(c.images, 'imagen adjunta', 'imágenes adjuntas') }) : null)))] : null,
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Abrir en Notion', onclick: () => re.openNotion(t.url) }), h('button', { class: 'btn primary', text: 'Cerrar' }))
      ));
    };
    N.open = t.id;
    dlg.addEventListener('close', () => {
      N.open = null;
      dlg.remove();
      notionRender();
    });
    document.body.append(dlg);
    render();
    dlg.showModal();
    if (!N.chats[t.id] || t.group === 'done') {
      try {
        N.chats[t.id] = await re.ticketChat(t.id, t);
      } catch (e) {
        N.chats[t.id] = { error: errMsg(e) };
      }
      if (dlg.open) render();
    }
  }

  // ---- pipeline ----
  const PIPE_LABEL = { todo: 'Sin empezar', doing: 'En desarrollo', stopped: 'Frenadas', done: 'Publicadas' };
  function repoFor(row) {
    const key = row.repo && (String(row.repo).match(/github\.com\/([^/]+\/[^/?#]+)/i) || [])[1];
    if (!key) return null;
    return (W.data?.repos || []).find((r) => r.repoKey === key.replace(/\.git$/, '').toLowerCase()) || null;
  }
  function pipeCard(r) {
    const local = repoFor(r);
    const ls = local ? REPO_STATE[local.state] : null;
    const end = r.end || r.start;
    const late = end && r.group !== 'done' && new Date(end + 'T23:59:59') < Date.now();
    return h('li', { class: 'rx-pc' },
      h('div', { class: 'rx-tk-top' }, r.priority && h('span', { class: `rx-prio ${prioClass(r.priority)}`, text: prioText(r.priority) }), r.clientStatus && h('span', { class: 'rx-client', title: 'Estado del cliente', text: r.clientStatus })),
      h('button', { class: 'rx-pc-name', text: r.name, onclick: () => re.openNotion(r.url) }),
      h('p', { class: 'rx-pc-meta', text: [r.type, r.tech, r.squad].filter(Boolean).join(' · ') }),
      end && h('p', { class: `rx-due ${late ? 'late' : ''}`, text: `${late ? 'Entrega vencida' : 'Entrega'} ${dateShort(end + 'T12:00')}` }),
      ls && h('p', { class: `rx-local ${ls[1]}`, text: `Tu copia: ${ls[0].toLowerCase()}` }),
      h('div', { class: 'rx-links' },
        r.repo && h('button', { class: 'btn subtle small', text: 'GitHub', onclick: () => window.api.open(r.repo) }),
        r.staging && h('button', { class: 'btn subtle small', text: 'Staging', onclick: () => re.openSite(r.staging) }),
        r.production && h('button', { class: 'btn subtle small', text: 'Web', onclick: () => re.openSite(r.production) })
      )
    );
  }
  function pipelineTab() {
    const p = N.data?.pipeline;
    if (p?.error) return h('div', { class: 'notice' }, h('span', { text: `No pude leer el pipeline: ${p.error}` }));
    const q = N.pipeQ.trim().toLowerCase();
    const rows = (p?.rows || []).filter((r) => (!N.pipeMine || r.mine) && (!q || `${r.name} ${r.tech} ${r.squad}`.toLowerCase().includes(q)));
    const counts = { todo: 0, doing: 0, stopped: 0, done: 0 };
    for (const r of rows) counts[r.group]++;
    const cols = (p?.order || []).map((s) => [s, rows.filter((r) => r.status === s)]).filter(([, l]) => l.length);
    const other = rows.filter((r) => !(p?.order || []).includes(r.status));
    if (other.length) cols.push(['Sin estado', other]);
    const search = h('label', { class: 'search' }, svg('M10.5 4a6.5 6.5 0 1 0 4 11.6l4.4 4.4 1.1-1.1-4.4-4.4A6.5 6.5 0 0 0 10.5 4z'), h('input', { type: 'search', placeholder: 'Buscar web', value: N.pipeQ, oninput: (e) => { N.pipeQ = e.target.value; const pos = e.target.selectionStart; notionRender(); const i = $('#notionBody input[type=search]'); i?.focus(); i?.setSelectionRange(pos, pos); } }));
    return [
      h('dl', { class: 'stat-strip rx-stats' }, Object.entries(PIPE_LABEL).map(([k, l]) => h('div', {}, h('dt', { text: l }), h('dd', { text: String(counts[k]) })))),
      h('div', { class: 'toolbar flat' },
        h('div', { class: 'seg' }, h('button', { class: N.pipeMine ? 'on' : '', text: 'Mis webs', onclick: () => ((N.pipeMine = true), notionRender()) }), h('button', { class: !N.pipeMine ? 'on' : '', text: 'Todo el equipo', onclick: () => ((N.pipeMine = false), notionRender()) })),
        search
      ),
      cols.length ? h('div', { class: 'rx-pipe' }, cols.map(([s, l]) => h('section', { class: `rx-pcol g-${l[0].group}` }, h('h3', {}, s, h('span', { class: 'count', text: String(l.length) })), h('ul', {}, l.map(pipeCard))))) : h('p', { class: 'empty', text: N.pipeMine ? 'No tienes webs a tu nombre en el pipeline.' : 'No hay webs que coincidan.' }),
    ];
  }

  function notionRender() {
    const body = $('#notionBody');
    if (!body) return;
    $('#notionActions').hidden = !N.linked;
    if (!N.linked)
      return fill(body, h('div', { class: 'rx-setup' },
        h('h2', { text: 'Conecta tu Notion' }),
        h('p', { class: 'sub', text: 'Verás tus tickets de Resto Experience (por hacer, en curso y listos), con su fecha límite, de qué tratan y lo que se dijo en el chat de cada uno, más el pipeline completo de webs.' }),
        h('p', { class: 'sub', text: 'Se abre Notion en tu navegador, aceptas el acceso y vuelves aquí. ViperTeca solo lee: no cambia nada en Notion y nunca ve tu contraseña.' }),
        h('button', { class: 'btn primary big', text: N.connecting ? 'Esperando a Notion…' : 'Conectar con Notion', disabled: N.connecting, onclick: connect }),
        N.connecting && h('p', { class: 'hint', text: 'Termina en la pestaña que se abrió en tu navegador.' })
      ));
    if (N.busy && !N.data) return fill(body, skeleton(6));
    if (N.error && !N.data) return fill(body, h('div', { class: 'notice' }, h('span', { text: N.error }), h('button', { class: 'btn ghost small', text: 'Reintentar', onclick: () => notionShow(true) })));
    fill(body,
      h('div', { class: 'seg rx-tabs', role: 'tablist' },
        h('button', { class: N.tab === 'tickets' ? 'on' : '', text: 'Mis tickets', onclick: () => ((N.tab = 'tickets'), notionRender()) }),
        h('button', { class: N.tab === 'pipe' ? 'on' : '', text: 'Pipeline de webs', onclick: () => { N.tab = 'pipe'; if (!W.data) websLoad(); notionRender(); } })
      ),
      N.tab === 'tickets' ? ticketsTab() : pipelineTab(),
      h('p', { class: 'hint rx-foot', text: `${N.busy ? 'Actualizando… ' : ''}Datos de Notion de ${ago(N.data.at)}.` }),
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: N.alerts !== false, onchange: (e) => { N.alerts = e.target.checked; window.api.saveSettings({ notionAlerts: e.target.checked }); } }), h('span', { text: 'Avisarme cuando me asignen un ticket nuevo o alguien escriba o me mencione en el chat de mis tickets (reviso cada 10 minutos)' }))
    );
  }

  // =====================================================================
  // WEBSITES
  // =====================================================================
  const REPO_STATE = {
    ok: ['Al día', 'ok'],
    behind: ['Necesita git pull', 'warn'],
    'behind-dirty': ['Pull pendiente y cambios sin guardar', 'bad'],
    diverged: ['Separada de GitHub', 'bad'],
    ahead: ['Commits sin subir', 'info'],
    dirty: ['Cambios sin commit', 'info'],
    nopush: ['Rama sin subir a GitHub', 'info'],
    noremote: ['Sin GitHub', 'muted'],
    nogit: ['Sin git', 'muted'],
    error: ['No se pudo revisar', 'bad'],
  };
  const W = { data: null, dir: '', busy: null, filter: 'attention', q: '', open: null, pulling: {}, tab: 'repos', squad: 'all' };
  const SQUADS = [['a', 'Squad A'], ['b', 'Squad B'], ['c', 'Squad C'], ['d', 'Squad D'], ['other', 'Sin squad']];
  /** Squad de una web: por el nombre (website-c-…) o, si no, por el pipeline de Notion. */
  function squadOf(r) {
    const m = String(r.name || '').match(/^website-([a-d])-/i);
    if (m) return m[1].toLowerCase();
    const p = pipeFor(r);
    const s = p && String(p.squad || '').match(/squad\s*([a-d])\b/i);
    return s ? s[1].toLowerCase() : 'other';
  }
  function websTabs() {
    const T = [['repos', 'Repositorios'], ['health', 'Salud de las webs'], ['vercel', 'Despliegues de Vercel']];
    return h('div', { class: 'seg rx-tabs', role: 'tablist' }, T.map(([k, l]) => h('button', { class: W.tab === k ? 'on' : '', role: 'tab', 'aria-selected': String(W.tab === k), text: l, onclick: () => { W.tab = k; if (k === 'health') healthLoad(); if (k === 'vercel') vercelLoad(); websRender(); } })));
  }

  // ---- salud de las webs ----
  const HL = { data: null, busy: false, psi: {}, settings: null };
  async function healthLoad(force) {
    if (!HL.settings) HL.settings = await window.api.basicSettings();
    // el pipeline de Notion trae las webs publicadas: se carga aparte, sin esperar
    if (!N.data && N.linked !== false && !HL.notionAsked) {
      HL.notionAsked = true;
      re.notionStatus().then(async (s) => {
        N.linked = s.linked;
        if (!s.linked) return;
        N.data = await re.notion(false).catch(() => null);
        if (N.data && W.tab === 'health') {
          HL.data = await window.api.health.get();
          websRender();
        }
      });
    }
    if (HL.data && !force) return websRender();
    HL.busy = true;
    websRender();
    try {
      HL.data = force || !HL.data ? await window.api.health[force ? 'check' : 'get']() : HL.data;
      if (!force && !HL.data.last && HL.data.sites.length) HL.data = await window.api.health.check();
    } catch (e) {
      toast(errMsg(e), true);
    }
    HL.busy = false;
    websRender();
  }
  const scoreCls = (v) => (v == null ? '' : v >= 90 ? 'ok' : v >= 50 ? 'warn' : 'bad');
  function healthTab() {
    const d = HL.data;
    if (!d) return skeleton(5);
    const res = d.last?.sites || {};
    const rows = d.sites.map((s) => ({ s, r: res[s.url] })).sort((a, b) => (a.r?.up === false ? -1 : 0) - (b.r?.up === false ? -1 : 0) || (a.r?.sslDays ?? 999) - (b.r?.sslDays ?? 999));
    const down = rows.filter((x) => x.r && !x.r.up).length;
    const ssl = rows.filter((x) => x.r?.sslDays != null && x.r.sslDays <= 21).length;
    const slow = rows.filter((x) => x.r?.ms > 2500).length;
    const keyIn = h('input', { type: 'password', class: 'rx-input', placeholder: 'Clave de la API de PageSpeed Insights', autocomplete: 'off', 'aria-label': 'Clave de PageSpeed' });
    const addIn = h('input', { type: 'url', class: 'rx-input', placeholder: 'https://otra-web.com', 'aria-label': 'Añadir web' });
    const row = ({ s, r }) => {
      const psi = HL.psi[s.url] || r?.psi;
      return h('li', { class: `rx-repo ${!r ? 'muted' : r.up ? 'ok' : 'bad'}` },
        h('div', { class: 'rx-repo-head hl-head' },
          h('span', { class: `rx-dot ${!r ? 'muted' : r.up ? 'ok' : 'bad'}` }),
          h('span', { class: 'rx-repo-name' }, h('b', { text: s.name }), h('span', { text: s.url.replace(/^https:\/\//, '') })),
          h('span', { class: `rx-repo-state ${!r ? 'muted' : r.up ? 'ok' : 'bad'}`, text: !r ? 'Sin revisar' : r.up ? `En línea · ${r.ms} ms` : r.error || `Error HTTP ${r.status}` }),
          h('span', { class: `hl-ssl ${r?.sslDays == null ? '' : r.sslDays <= 14 ? 'bad' : r.sslDays <= 30 ? 'warn' : ''}`, text: r?.sslDays != null ? `SSL ${r.sslDays} días` : '' })
        ),
        h('div', { class: 'hl-psi' },
          psi && !psi.error ? [['Velocidad', psi.performance], ['SEO', psi.seo], ['Accesibilidad', psi.accessibility]].map(([l, v]) => h('span', { class: `hl-score ${scoreCls(v)}` }, h('b', { text: v ?? '—' }), l)) : null,
          psi?.lcp && h('span', { class: 'hint', text: `LCP ${psi.lcp}` }),
          psi?.error && h('span', { class: 'hint bad', text: psi.error }),
          h('button', { class: 'btn subtle small', text: psi === 'busy' ? 'Midiendo…' : psi ? 'Medir otra vez' : 'Medir velocidad y SEO', disabled: psi === 'busy' || !d.psi, title: d.psi ? '' : 'Añade tu clave de PageSpeed abajo', onclick: async () => { HL.psi[s.url] = 'busy'; websRender(); try { HL.psi[s.url] = await window.api.health.psi(s.url); } catch (e) { HL.psi[s.url] = { error: errMsg(e) }; } websRender(); } }),
          h('button', { class: 'btn subtle small', text: 'Abrir', onclick: () => window.api.health.open(s.url) })
        )
      );
    };
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Webs vigiladas' }), h('dd', { text: String(rows.length) })),
        h('div', {}, h('dt', { text: 'Caídas' }), h('dd', { class: down ? 'rx-hot' : '', text: String(down) })),
        h('div', {}, h('dt', { text: 'SSL vence en 3 semanas' }), h('dd', { class: ssl ? 'rx-hot' : '', text: String(ssl) })),
        h('div', {}, h('dt', { text: 'Lentas (más de 2,5 s)' }), h('dd', { text: String(slow) }))
      ),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: HL.busy ? 'Revisando…' : 'Revisar ahora', disabled: HL.busy, onclick: () => healthLoad(true) }),
        h('span', { class: 'hint', text: d.last ? `Última revisión ${ago(d.last.at)}. Se revisan solas cada 30 minutos.` : 'Todavía sin revisar.' })
      ),
      rows.length ? h('ul', { class: 'rx-repos' }, rows.map(row)) : h('p', { class: 'empty' }, h('b', { text: 'No hay webs para vigilar' }), 'Salen solas las webs publicadas del pipeline de Notion y los dominios de Vercel. También puedes añadir una abajo.'),
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Ajustes' }),
        h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: HL.settings?.healthAlerts !== false, onchange: (e) => window.api.saveSettings({ healthAlerts: e.target.checked }) }), h('span', { text: 'Avisarme si una web se cae, cuando vuelve y si su SSL vence en menos de 14 días' })),
        h('div', { class: 'rx-paste' }, addIn, h('button', { class: 'btn ghost small', text: 'Añadir web', onclick: async () => { try { await window.api.health.addSite(addIn.value); HL.data = await window.api.health.check(); websRender(); } catch (e) { toast(errMsg(e), true); } } })),
        h('p', { class: 'hint', text: d.psi ? 'Clave de PageSpeed guardada (cifrada en este PC).' : 'Para medir velocidad y SEO hace falta una clave gratuita de la API de PageSpeed Insights (Google Cloud). Créala y pégala aquí.' }),
        h('div', { class: 'rx-paste' }, keyIn, h('button', { class: 'btn ghost small', text: 'Guardar clave', onclick: async () => { await window.api.health.setKey(keyIn.value); HL.data = await window.api.health.get(); toast(keyIn.value ? 'Clave guardada.' : 'Clave borrada.'); websRender(); } }), h('button', { class: 'btn subtle small', text: 'Cómo crear la clave', onclick: () => window.api.open('https://developers.google.com/speed/docs/insights/v5/get-started') }))
      ),
    ];
  }

  // ---- Vercel ----
  const VC = { status: null, data: null, busy: false, error: null, teams: null, settings: null };
  async function vercelLoad(force) {
    if (!VC.settings) VC.settings = await window.api.basicSettings();
    VC.status = await window.api.vercel.status();
    if (!VC.status.linked) return websRender();
    if (!VC.data) VC.data = VC.status.last;
    if (VC.data && !force) return websRender();
    VC.busy = true;
    websRender();
    try {
      VC.data = await window.api.vercel.get();
      VC.error = null;
    } catch (e) {
      VC.error = errMsg(e);
    }
    VC.busy = false;
    websRender();
  }
  const VSTATE = { READY: ['Listo', 'ok'], ERROR: ['Falló', 'bad'], BUILDING: ['Construyendo', 'warn'], QUEUED: ['En cola', 'warn'], INITIALIZING: ['Empezando', 'warn'], CANCELED: ['Cancelado', 'muted'] };
  function vercelTab() {
    const st = VC.status;
    if (!st) return skeleton(4);
    if (!st.linked) {
      const tok = h('input', { type: 'password', class: 'rx-input', placeholder: 'Token de Vercel', autocomplete: 'off', 'aria-label': 'Token de Vercel' });
      return h('div', { class: 'rx-setup' },
        h('h2', { text: 'Conecta Vercel' }),
        h('p', { class: 'sub', text: 'Verás el último despliegue de producción y de preview de cada web, de qué commit es y si falló, con aviso cuando un despliegue falle.' }),
        h('ol', { class: 'rx-steps' },
          h('li', {}, 'Crea un token en tu cuenta de Vercel (Account Settings → Tokens), con acceso al equipo de Resto Experience. ', h('button', { class: 'btn ghost small', text: 'Abrir tokens de Vercel', onclick: () => window.api.open('https://vercel.com/account/settings/tokens') })),
          h('li', { text: 'Pégalo aquí. Se guarda cifrado en este PC y solo se usa para leer.' })
        ),
        h('div', { class: 'rx-paste' }, tok, h('button', { class: 'btn primary', text: 'Guardar token', onclick: async () => { try { const r = await window.api.vercel.setToken(tok.value); VC.teams = r.teams; await vercelLoad(true); } catch (e) { toast(errMsg(e), true); } } }))
      );
    }
    const teamSel = VC.teams?.length ? h('select', { class: 'sn-select', 'aria-label': 'Equipo de Vercel', onchange: async (e) => { await window.api.vercel.setTeam(e.target.value); VC.data = null; vercelLoad(true); } }, h('option', { value: '', text: 'Mi cuenta personal' }), VC.teams.map((t) => h('option', { value: t.id, selected: st.team === t.id, text: t.name }))) : h('button', { class: 'btn subtle small', text: 'Elegir equipo', onclick: async () => { VC.teams = await window.api.vercel.teams(); websRender(); } });
    const projects = VC.data?.projects || [];
    const failed = projects.filter((p) => p.latest?.state === 'ERROR' || p.production?.state === 'ERROR').length;
    const deplCell = (d, label) => {
      if (!d) return h('div', { class: 'vc-dep muted' }, h('small', { text: label }), h('span', { text: 'Sin despliegues' }));
      const [t, tone] = VSTATE[d.state] || [d.state, 'muted'];
      return h('div', { class: `vc-dep ${tone}` },
        h('small', { text: label }),
        h('b', { class: `rx-repo-state ${tone}`, text: t }),
        h('span', { text: [d.branch, d.sha].filter(Boolean).join(' · ') }),
        d.commit && h('span', { class: 'vc-commit', text: d.commit }),
        h('span', { class: 'hint', text: `${ago(d.at)}${d.author ? ` · ${d.author}` : ''}` }),
        d.url && h('button', { class: 'btn subtle small', text: 'Ver', onclick: () => window.api.health.open(d.inspector || d.url) })
      );
    };
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Proyectos' }), h('dd', { text: String(projects.length) })),
        h('div', {}, h('dt', { text: 'Con despliegue fallido' }), h('dd', { class: failed ? 'rx-hot' : '', text: String(failed) })),
        h('div', {}, h('dt', { text: 'Desplegados hoy' }), h('dd', { text: String(projects.filter((p) => p.latest?.at && Date.now() - p.latest.at < 86400000).length) }))
      ),
      h('div', { class: 'toolbar flat' }, teamSel, h('button', { class: 'btn primary small', text: VC.busy ? 'Actualizando…' : 'Actualizar', disabled: VC.busy, onclick: () => vercelLoad(true) }), VC.data && h('span', { class: 'hint', text: `Leído ${ago(VC.data.at)}.` })),
      VC.error && h('p', { class: 'hint bad', text: VC.error }),
      projects.length ? h('ul', { class: 'vc-list' }, projects.map((p) => h('li', { class: 'vc-row' },
        h('div', { class: 'vc-name' }, h('b', { text: p.name }), h('span', { text: [p.framework, p.repo].filter(Boolean).join(' · ') }), p.domain && h('button', { class: 'btn subtle small', text: p.domain.replace('https://', ''), onclick: () => window.api.health.open(p.domain) })),
        deplCell(p.production, 'Producción'),
        p.latest && p.latest.id !== p.production?.id ? deplCell(p.latest, 'Último (preview)') : h('div', { class: 'vc-dep muted' }, h('small', { text: 'Último (preview)' }), h('span', { text: 'El mismo que producción' }))
      ))) : VC.busy ? skeleton(5) : h('p', { class: 'empty', text: 'No hay proyectos en esta cuenta. Si las webs están en el equipo de Resto Experience, elígelo arriba.' }),
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: VC.settings?.vercelAlerts !== false, onchange: (e) => window.api.saveSettings({ vercelAlerts: e.target.checked }) }), h('span', { text: 'Avisarme cuando falle un despliegue (reviso cada 10 minutos)' })),
      h('button', { class: 'btn subtle small', text: 'Quitar token de Vercel', onclick: async () => { await window.api.vercel.setToken(''); VC.data = null; vercelLoad(); } })
    ];
  }
  re.onScanProgress((p) => {
    W.busy = `Revisando ${p.done} de ${p.total} · ${p.name}`;
    if (!$('#websView').hidden) websRender();
  });

  async function websLoad() {
    const r = await re.webs();
    W.dir = r.dir;
    if (!W.data) W.data = r.last;
  }
  async function websShow() {
    if (!W.dir) await websLoad();
    websRender();
    if (!W.data && !W.busy) scan(false);
  }
  async function scan(fetchRemote) {
    W.busy = fetchRemote ? 'Preguntando a GitHub…' : 'Revisando carpetas…';
    websRender();
    try {
      W.data = await re.scan(fetchRemote);
      if (fetchRemote) {
        const n = W.data.repos.filter((r) => r.state === 'behind' || r.state === 'behind-dirty').length;
        toast(n ? `${plural(n, 'web necesita', 'webs necesitan')} git pull.` : 'Todas tus webs están al día con GitHub.');
      }
    } catch (e) {
      toast(errMsg(e), true);
    }
    W.busy = null;
    websRender();
    updateBadges();
  }
  async function pull(r) {
    W.pulling[r.dir] = true;
    websRender();
    try {
      const x = await re.pull(r.dir);
      W.data.repos = W.data.repos.map((y) => (y.dir === x.dir ? x : y));
      toast(x.pulled ? `${r.name}: ${plural(x.pulled, 'commit traído', 'commits traídos')}.${x.pkgChanged ? ' Cambiaron las dependencias: corre npm install.' : ''}` : `${r.name} ya estaba al día.`);
    } catch (e) {
      toast(errMsg(e), true);
    }
    delete W.pulling[r.dir];
    websRender();
    updateBadges();
  }

  function explain(r) {
    const out = [];
    if (r.behind) out.push(`GitHub tiene ${plural(r.behind, 'commit nuevo', 'commits nuevos')} en ${r.upstream}${r.remoteLast ? ` (último: "${r.remoteLast.subject}", de ${r.remoteLast.author}, ${ago(r.remoteLast.date)})` : ''}.`);
    if (r.ahead) out.push(`Tienes ${plural(r.ahead, 'commit', 'commits')} sin subir (git push).`);
    if (r.changes?.total) out.push(`${plural(r.changes.total, 'archivo cambiado', 'archivos cambiados')} sin commit${r.changes.untracked ? ` (${r.changes.untracked} nuevos)` : ''}.`);
    if (r.vsDefault?.behind) out.push(`Tu rama ${r.branch} va ${plural(r.vsDefault.behind, 'commit', 'commits')} por detrás de ${r.defaultBranch}.`);
    if (r.state === 'nopush') out.push(`La rama ${r.branch} no existe en GitHub todavía.`);
    if (r.stashes) out.push(`${plural(r.stashes, 'stash guardado', 'stashes guardados')}.`);
    if (r.fetchError) out.push(r.fetchError);
    if (r.state === 'nogit') out.push('Esta carpeta no es un repositorio git.');
    if (r.state === 'noremote') out.push('El repositorio no tiene origin en GitHub.');
    if (r.state === 'diverged') out.push('Hay commits nuevos a los dos lados: resuélvelo en tu editor (pull con merge o rebase).');
    return out;
  }

  function pipeFor(r) {
    if (!r.repoKey) return null;
    return (N.data?.pipeline?.rows || []).find((p) => p.repo && (String(p.repo).match(/github\.com\/([^/]+\/[^/?#]+)/i) || [])[1]?.replace(/\.git$/, '').toLowerCase() === r.repoKey) || null;
  }

  function repoRow(r) {
    const [label, tone] = REPO_STATE[r.state] || ['—', 'muted'];
    const canPull = r.state === 'behind';
    const open = W.open === r.dir;
    const p = pipeFor(r);
    const lines = explain(r);
    return h('li', { class: `rx-repo ${tone}${open ? ' open' : ''}` },
      h('button', { class: 'rx-repo-head', 'aria-expanded': String(open), onclick: () => ((W.open = open ? null : r.dir), websRender()) },
        h('span', { class: `rx-dot ${tone}` }),
        h('span', { class: 'rx-repo-name' }, h('b', { text: r.name }), h('span', { text: [r.tech, r.branch && r.branch !== 'HEAD' ? `rama ${r.branch}` : null, p ? `Notion: ${p.status}` : null].filter(Boolean).join(' · ') })),
        h('span', { class: `rx-repo-state ${tone}`, text: label + (r.behind ? ` (${r.behind})` : r.ahead && r.state === 'ahead' ? ` (${r.ahead})` : r.state === 'dirty' ? ` (${r.changes.total})` : '') }),
        h('span', { class: 'rx-repo-last', text: r.last ? ago(r.last.date) : '' })
      ),
      open && h('div', { class: 'rx-repo-body' },
        lines.length ? h('ul', { class: 'rx-why' }, lines.map((l) => h('li', { text: l }))) : h('p', { class: 'hint ok', text: 'Al día con GitHub y sin cambios pendientes.' }),
        r.last && h('p', { class: 'hint', text: `Tu último commit local: "${r.last.subject}" de ${r.last.author}, ${ago(r.last.date)}.` }),
        r.changes?.sample?.length ? h('details', { class: 'notes' }, h('summary', { text: 'Archivos con cambios' }), h('ul', { class: 'rx-files' }, r.changes.sample.map((f) => h('li', { text: f })), r.changes.total > r.changes.sample.length && h('li', { text: `y ${r.changes.total - r.changes.sample.length} más` }))) : null,
        h('div', { class: 'rx-row' },
          canPull && h('button', { class: 'btn primary small', text: W.pulling[r.dir] ? 'Actualizando…' : `Hacer git pull (${r.behind})`, disabled: !!W.pulling[r.dir], onclick: () => pull(r) }),
          h('button', { class: 'btn ghost small', text: 'Abrir carpeta', onclick: () => re.openDir(r.dir, 'folder') }),
          h('button', { class: 'btn ghost small', text: 'Abrir en VS Code', onclick: () => re.openDir(r.dir, 'code') }),
          r.github && h('button', { class: 'btn ghost small', text: 'Ver en GitHub', onclick: () => window.api.open(r.github) }),
          p && h('button', { class: 'btn subtle small', text: 'Ver en Notion', onclick: () => re.openNotion(p.url) })
        ),
        r.state === 'behind-dirty' && h('p', { class: 'hint bad', text: 'No hago el pull por ti porque tienes cambios sin guardar: haz commit o stash primero para no perder nada.' })
      )
    );
  }

  function websRender() {
    const body = $('#websBody');
    if (!body) return;
    $('#websDir').textContent = W.dir || '';
    const repos = W.data?.repos || [];
    const count = (f) => repos.filter(f).length;
    const FILTERS = [
      ['attention', 'Necesitan atención', (r) => !['ok', 'nogit', 'noremote'].includes(r.state)],
      ['pull', 'git pull pendiente', (r) => r.behind > 0],
      ['local', 'Cambios locales', (r) => r.changes?.total > 0 || r.ahead > 0],
      ['ok', 'Al día', (r) => r.state === 'ok'],
      ['all', 'Todas', () => true],
    ];
    const f = FILTERS.find((x) => x[0] === W.filter) || FILTERS[0];
    const q = W.q.trim().toLowerCase();
    const order = ['behind-dirty', 'diverged', 'error', 'behind', 'ahead', 'nopush', 'dirty', 'ok', 'noremote', 'nogit'];
    const list = repos.filter(f[2]).filter((r) => (!q || r.name.toLowerCase().includes(q)) && (W.squad === 'all' || squadOf(r) === W.squad)).sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
    const pullable = repos.filter((r) => r.state === 'behind');

    $('#websScan').disabled = !!W.busy;
    $('#websScan').textContent = W.busy ? 'Revisando…' : 'Revisar con GitHub';
    $('#websScan').hidden = W.tab !== 'repos';
    if (W.tab === 'health') return fill(body, websTabs(), healthTab());
    if (W.tab === 'vercel') return fill(body, websTabs(), vercelTab());
    const search = h('label', { class: 'search' }, svg('M10.5 4a6.5 6.5 0 1 0 4 11.6l4.4 4.4 1.1-1.1-4.4-4.4A6.5 6.5 0 0 0 10.5 4z'), h('input', { type: 'search', placeholder: 'Buscar web', value: W.q, oninput: (e) => { W.q = e.target.value; const pos = e.target.selectionStart; websRender(); const i = $('#websBody input[type=search]'); i?.focus(); i?.setSelectionRange(pos, pos); } }));
    if (!W.data) return fill(body, websTabs(), W.busy ? [h('p', { class: 'hint', text: W.busy }), skeleton(8)] : h('p', { class: 'empty', text: 'Revisa tus webs para ver su estado.' }));
    const bySquad = SQUADS.map(([k, label]) => [k, label, list.filter((r) => squadOf(r) === k)]).filter(([, , l]) => l.length);
    fill(body,
      websTabs(),
      W.busy && h('div', { class: 'notice' }, h('span', { text: W.busy })),
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Webs' }), h('dd', { text: String(repos.length) })),
        h('div', {}, h('dt', { text: 'Al día' }), h('dd', { text: String(count((r) => r.state === 'ok')) })),
        h('div', {}, h('dt', { text: 'Necesitan git pull' }), h('dd', { class: count((r) => r.behind > 0) ? 'rx-hot' : '', text: String(count((r) => r.behind > 0)) })),
        h('div', {}, h('dt', { text: 'Cambios sin commit' }), h('dd', { text: String(count((r) => r.changes?.total > 0)) })),
        h('div', {}, h('dt', { text: 'Commits sin subir' }), h('dd', { text: String(count((r) => r.ahead > 0)) }))
      ),
      pullable.length > 1 && h('div', { class: 'notice' }, h('span', { text: `${plural(pullable.length, 'web está limpia y solo necesita', 'webs están limpias y solo necesitan')} git pull.` }), h('button', { class: 'btn primary small', text: 'Actualizar todas', disabled: !!W.busy, onclick: async () => { for (const r of pullable) await pull(r); } })),
      h('div', { class: 'toolbar flat' }, h('div', { class: 'chips' }, FILTERS.map(([k, l, fn]) => h('button', { class: 'chip', 'aria-pressed': String(W.filter === k), onclick: () => ((W.filter = k), websRender()) }, l, h('b', { text: String(count(fn)) })))), search),
      h('div', { class: 'seg rx-squads', role: 'group', 'aria-label': 'Squad' }, [['all', 'Todos los squads'], ...SQUADS].map(([k, l]) => h('button', { class: W.squad === k ? 'on' : '', text: k === 'all' ? l : l.replace('Squad ', ''), title: l, onclick: () => ((W.squad = k), websRender()) }))),
      list.length
        ? bySquad.map(([k, label, l]) => h('section', { class: `rx-squad sq-${k}` }, h('h3', { class: 'rx-squad-h' }, h('span', { class: 'rx-squad-dot' }), label, h('span', { class: 'count', text: String(l.length) })), h('ul', { class: 'rx-repos' }, l.map(repoRow))))
        : h('p', { class: 'empty', text: W.filter === 'attention' ? 'Ninguna web necesita atención. Todo al día.' : 'No hay webs en este filtro.' }),
      h('p', { class: 'hint rx-foot', text: `Revisado ${ago(W.data.at)}. "Revisar con GitHub" hace git fetch en cada web con tus credenciales de git; solo "Hacer git pull" cambia archivos, y únicamente si la carpeta está limpia.` })
    );
  }

  // =====================================================================
  // contadores del menú
  // =====================================================================
  async function updateBadges() {
    try {
      const st = await cal.status();
      if (st.linked) {
        const c = C.data || (await cal.get(false).catch(() => null));
        if (c) C.data = C.data || c;
        const now = Date.now();
        const left = (c?.events || []).filter((e) => !e.allDay && e.end > now && dayKey(e.start) === dayKey(now) && e.myStatus !== 'DECLINED').length;
        $('#countCal').textContent = left ? String(left) : '';
      } else $('#countCal').textContent = '';
    } catch {}
    const open = (N.data?.tickets || []).filter((t) => t.group !== 'done');
    $('#countNotion').textContent = open.length ? String(open.length) : '';
    const pulls = (W.data?.repos || []).filter((r) => r.behind > 0).length;
    $('#countWebs').textContent = pulls ? String(pulls) : '';
  }

  window.api.onNotionChanged(() => {
    N.chats = {};
    if (!$('#notionView').hidden) notionShow(true);
    else re.notion(false).then((d) => { N.data = d; updateBadges(); }).catch(() => {});
  });

  cal.onChanged(() => {
    C.data = null;
    if (!$('#calView').hidden) calShow(false);
    else updateBadges();
  });

  // botones de cabecera
  $('#calRefresh').addEventListener('click', () => calShow(true));
  $('#calOpen').addEventListener('click', () => cal.open('https://calendar.google.com/calendar/u/0/r/week'));
  $('#calSettings').addEventListener('click', calSettings);
  $('#notionRefresh').addEventListener('click', () => notionShow(true));
  $('#notionLogout').addEventListener('click', async () => {
    await re.notionLogout();
    N.linked = false;
    N.data = null;
    N.chats = {};
    notionRender();
    updateBadges();
  });
  $('#websScan').addEventListener('click', () => scan(true));
  $('#websPick').addEventListener('click', async () => {
    const d = await re.pickDir();
    if (!d) return;
    W.dir = d;
    W.data = null;
    scan(false);
  });

  // al arrancar: contadores sin abrir nada
  setTimeout(async () => {
    await websLoad().catch(() => {});
    updateBadges();
  }, 4000);

  window.resto = { calShow: () => calShow(false), notionShow: () => notionShow(false), websShow };
})();

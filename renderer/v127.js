'use strict';
// 1.27: Websites → Clientes (todo de cada web) y extras de Squads (standup,
// riesgo, comentarios sin responder, carga y 1:1).
(function () {
  const C = { data: null, busy: false, filter: 'todas', hooked: false, open: {} };
  const ms = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms');
  const dd = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  const monthNow = () => new Date().toLocaleDateString('sv').slice(0, 7);
  const tone = (v, good, poor) => (v == null ? '' : v <= good ? 'ok' : v <= poor ? 'warn' : 'bad');
  async function load(rr) {
    C.busy = true;
    try {
      C.data = await window.api.sites.get();
    } catch (e) {
      toast(errMsg(e), true);
    }
    C.busy = false;
    rr?.();
  }
  const spark = (vals, { max, cls = '' } = {}) => {
    const v = vals.filter((x) => x != null);
    const top = max ?? Math.max(1, ...v);
    return h('div', { class: 'cl-spark ' + cls }, vals.map((x) => h('i', { class: x == null ? 'none' : '', style: { height: x == null ? '3px' : Math.max(6, (x / top) * 100) + '%' } })));
  };
  /** Problemas de una web, para ordenar y para el resumen. */
  function issues(s) {
    const out = [];
    if (s.health && !s.health.up) out.push(['bad', 'Caída']);
    if (s.uptime?.last30 != null && s.uptime.last30 < 99.5) out.push(['warn', 'Uptime ' + s.uptime.last30 + '%']);
    const ssl = s.health?.sslDays;
    if (ssl != null && ssl <= 30) out.push([ssl <= 7 ? 'bad' : 'warn', 'SSL ' + ssl + ' días']);
    const dom = s.domain?.until ? Math.floor((s.domain.until - Date.now()) / 86400000) : null;
    if (dom != null && dom <= 30) out.push([dom <= 7 ? 'bad' : 'warn', 'Dominio ' + dom + ' días']);
    if (s.stale?.items?.length) out.push(['warn', s.stale.items.length + ' vencido' + (s.stale.items.length > 1 ? 's' : '')]);
    const big = Object.values(s.shots || {}).some((v) => v.change >= 25);
    if (big) out.push(['warn', 'Portada cambió']);
    if (s.hours && s.hours.match === false) out.push(['warn', 'Horarios ≠ Google']);
    if (s.security?.secrets?.length) out.push(['bad', 'Clave expuesta']);
    if (s.security?.next?.critical) out.push(['bad', 'Next.js crítico']);
    else if (s.security?.next?.advisories?.length) out.push(['warn', 'Actualizar Next.js']);
    const last = s.cwv?.[s.cwv.length - 1];
    if (last?.lcp > 4000) out.push(['warn', 'LCP lento']);
    return out;
  }
  async function showShots(s) {
    const r = await window.api.sites.shots(s.url).catch(() => null);
    if (!r) return toast('Todavía no hay capturas de esta web.');
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide' });
    const pair = (k, label) => r[k] && h('div', { class: 'cl-shots' }, h('p', { class: 'hint', text: label + (r[k].change != null ? ' · cambió ' + r[k].change + '%' : '') }), h('div', { class: 'cl-shots-row ' + k }, h('figure', {}, r[k].prev ? h('img', { src: r[k].prev, alt: 'Antes' }) : h('span', { class: 'hint', text: 'Sin la anterior' }), h('figcaption', { text: 'Antes' })), h('figure', {}, h('img', { src: r[k].now, alt: 'Hoy' }), h('figcaption', { text: 'Hoy' }))));
    dlg.append(h('h2', { text: 'Portada de ' + s.name }), pair('d', 'Escritorio'), pair('m', 'Celular'), h('div', { class: 'actions' }, h('button', { class: 'btn primary', text: 'Cerrar', onclick: () => dlg.close() })));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
  async function changelog(s, btn) {
    btn.disabled = true;
    btn.textContent = 'Escribiendo…';
    try {
      const r = await window.api.sites.changelog(s.url, monthNow(), 'en');
      const text = r.empty ? '' : (r.summary ? r.summary + '\n\n' : '') + r.items.map((x) => '• ' + x).join('\n');
      const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide' });
      const ta = h('textarea', { class: 'note', rows: 12, value: text || 'Sin commits este mes en ' + (r.repo || 'su repo') + '.' });
      dlg.append(h('h2', { text: 'Cambios del mes · ' + s.name }), h('p', { class: 'hint', text: (r.commits ? r.commits + ' commits de ' + r.repo + '. ' : '') + 'Escrito para el cliente, en inglés. Puedes editarlo antes de copiarlo.' }), ta, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', text: 'En español', onclick: async (e) => { e.currentTarget.disabled = true; const x = await window.api.sites.changelog(s.url, monthNow(), 'es').catch(() => null); if (x && !x.empty) ta.value = (x.summary ? x.summary + '\n\n' : '') + x.items.map((y) => '• ' + y).join('\n'); } }), h('button', { class: 'btn ghost', text: 'Copiar', onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast('Copiado.')) }), h('button', { class: 'btn primary', text: 'Cerrar', onclick: () => dlg.close() })));
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
    } catch (e) {
      toast(errMsg(e), true);
    }
    btn.disabled = false;
    btn.textContent = 'Cambios del mes';
  }
  async function report(s, btn, lang) {
    btn.disabled = true;
    const t = btn.textContent;
    btn.textContent = 'Preparando PDF…';
    try {
      const r = await window.api.sites.report(s.url, monthNow(), lang);
      toast('Informe guardado: ' + r.file.split('\\').pop());
    } catch (e) {
      toast(errMsg(e), true);
    }
    btn.disabled = false;
    btn.textContent = t;
  }
  function card(s) {
    const iss = issues(s);
    const open = C.open[s.url];
    const up = s.uptime;
    const last = s.cwv?.[s.cwv.length - 1] || null;
    const dom = s.domain?.until ? Math.floor((s.domain.until - Date.now()) / 86400000) : null;
    return h('article', { class: 'cl-card' + (iss.some((x) => x[0] === 'bad') ? ' cl-bad' : iss.length ? ' cl-warn' : '') },
      h('header', { onclick: () => { C.open[s.url] = !open; C.rr(); } },
        h('div', { class: 'cl-name' }, h('b', { text: s.name }), h('small', { class: 'hint', text: s.url.replace(/^https:\/\//, '').replace(/\/$/, '') + (s.repo ? ' · ' + s.repo : '') })),
        h('div', { class: 'cl-kpis' },
          h('span', { title: 'Disponibilidad últimos 30 días' }, h('b', { class: up?.last30 == null ? '' : up.last30 >= 99.9 ? 'ok' : up.last30 >= 99 ? 'warn' : 'bad', text: up?.last30 != null ? up.last30 + '%' : '—' }), 'uptime'),
          h('span', { title: 'Tiempo de respuesta medio del mes' }, h('b', { text: ms(up?.avgMs) }), 'respuesta'),
          h('span', { title: 'LCP real en celulares (CrUX)' }, h('b', { class: tone(last?.lcp, 2500, 4000), text: ms(last?.lcp) }), 'LCP'),
          h('span', { title: 'Horas de trabajo estimadas este mes' }, h('b', { text: s.month?.hours ? s.month.hours.total + ' h' : '—' }), 'este mes')
        ),
        h('div', { class: 'cl-tags' }, iss.length ? iss.slice(0, 4).map(([c, l]) => h('span', { class: 'cl-tag cl-t-' + c, text: l })) : h('span', { class: 'cl-tag cl-t-ok', text: 'Todo bien' }))
      ),
      open && h('div', { class: 'cl-body' },
        h('div', { class: 'cl-grid' },
          h('section', {}, h('h4', { text: 'Uptime (30 días)' }), up ? [spark(up.series.map((x) => x.pct == null ? null : Math.max(0, x.pct - 95)), { max: 5 }), h('p', { class: 'hint', text: (up.incidents.length ? up.incidents.length + ' caídas este mes: ' + up.incidents.slice(0, 3).map((i) => i.day.slice(8) + '/' + i.day.slice(5, 7) + ' ~' + i.minutes + ' min').join(', ') : 'Sin caídas este mes') })] : h('p', { class: 'hint', text: 'Juntando datos: se revisa cada 5 minutos.' })),
          h('section', {}, h('h4', { text: 'Dominio y SSL' }), h('p', { text: (s.domain?.domain || '') + (dom != null ? ' vence el ' + dd(s.domain.until) + ' (' + dom + ' días)' : ' · vencimiento desconocido') }), s.domain?.registrar ? h('small', { class: 'hint', text: 'Registrado en ' + s.domain.registrar }) : null, h('p', { text: s.health?.sslDays != null ? 'SSL: ' + s.health.sslDays + ' días' : '' })),
          h('section', {}, h('h4', { text: 'Core Web Vitals (celular)' }), s.cwv?.length ? [
            h('div', { class: 'cl-cwv' }, [['LCP', last?.lcp, ms(last?.lcp), 2500, 4000], ['INP', last?.inp, ms(last?.inp), 200, 500], ['CLS', last?.cls, last?.cls ?? '—', 0.1, 0.25], ['Velocidad', last?.perf, last?.perf ?? '—']].map(([l, v, txt, g, p]) => h('span', {}, h('b', { class: g ? tone(v, g, p) : v == null ? '' : v >= 90 ? 'ok' : v >= 50 ? 'warn' : 'bad', text: String(txt) }), l))),
            s.cwv.length > 1 ? [h('small', { class: 'hint', text: 'Velocidad por semana' }), spark(s.cwv.map((x) => x.perf), { max: 100 })] : null,
            last && last.lcp == null ? h('small', { class: 'hint', text: 'Sin datos reales de Chrome (poco tráfico): solo PageSpeed.' }) : null,
          ] : h('p', { class: 'hint', text: C.data?.google ? 'Se mide una vez por semana.' : 'Añade tu clave de Google en Salud de las webs.' })),
          h('section', {}, h('h4', { text: 'Horarios web vs. Google' }), !s.hours ? h('p', { class: 'hint', text: C.data?.google ? 'Se revisa una vez por semana.' : 'Necesita tu clave de Google con Places API.' }) : s.hours.error ? h('p', { class: 'hint', text: s.hours.error }) : s.hours.match ? h('p', { class: 'ok-t', text: 'Coinciden (' + s.hours.places.length + (s.hours.places.length === 1 ? ' local)' : ' locales)') }) : h('ul', { class: 'cl-ul' }, (s.hours.differences || []).map((d) => h('li', { text: d })))),
          h('section', {}, h('h4', { text: 'Contenido vencido' }), s.stale?.items?.length ? h('ul', { class: 'cl-ul' }, s.stale.items.map((x) => h('li', {}, h('b', { text: x.label }), h('small', { class: 'hint', text: '«' + x.snippet.slice(0, 120) + '»' })))) : h('p', { class: 'hint', text: s.stale ? 'Nada vencido (revisado ' + relTime(s.stale.at / 1000) + ').' : 'Se revisa una vez al día.' })),
          h('section', {}, h('h4', { text: 'Portada (capturas diarias)' }), s.shots ? [h('p', { text: Object.entries(s.shots).map(([k, v]) => (k === 'd' ? 'Escritorio' : 'Celular') + ': ' + (v.change == null ? 'primera captura' : v.change + '% de cambio')).join(' · ') }), h('button', { class: 'btn subtle small', text: 'Ver antes y hoy', onclick: () => showShots(s) })] : h('p', { class: 'hint', text: 'Se captura una vez al día.' })),
          h('section', {}, h('h4', { text: 'Seguridad del repo' }), !s.repo ? h('p', { class: 'hint', text: 'No encontré su repo.' }) : !s.security ? h('p', { class: 'ok-t', text: 'Sin avisos.' }) : [
            s.security.next?.advisories?.length ? h('p', {}, h('b', { class: s.security.next.critical ? 'bad-t' : 'warn-t', text: 'next@' + s.security.next.version + ' → actualizar a ' + (s.security.next.target || 'la última') }), h('small', { class: 'hint', text: ' ' + s.security.next.advisories.length + ' fallos (' + s.security.next.critical + ' críticos): ' + s.security.next.advisories.slice(0, 2).map((a) => a.summary).join(' · ') })) : null,
            s.security.dependabot?.length ? h('p', { class: 'hint', text: 'Dependabot: ' + s.security.dependabot.length + ' alertas altas o críticas (' + [...new Set(s.security.dependabot.map((a) => a.pkg))].slice(0, 4).join(', ') + ')' }) : null,
            ...(s.security.secrets || []).map((x) => h('p', { class: 'bad-t', text: 'Posible ' + x.what + ' en ' + x.file + ' (commit ' + x.sha + ')' })),
          ]),
          h('section', {}, h('h4', { text: 'Trabajo este mes' }), s.month?.hours ? [h('p', { text: s.month.commits + ' commits · ~' + s.month.hours.total + ' h' }), h('small', { class: 'hint', text: Object.entries(s.month.hours.who).map(([w, x]) => w + ' ' + x + ' h').join(' · ') + ' (estimado por los commits)' })] : h('p', { class: 'hint', text: 'Sin commits este mes.' }))
        ),
        h('div', { class: 'cl-actions' },
          h('button', { class: 'btn ghost small', text: 'Cambios del mes', onclick: (e) => changelog(s, e.currentTarget) }),
          h('button', { class: 'btn primary small', text: 'Informe del mes (PDF)', title: 'En inglés, para el cliente', onclick: (e) => report(s, e.currentTarget, 'en') }),
          h('button', { class: 'btn subtle small', text: 'Informe en español', onclick: (e) => report(s, e.currentTarget, 'es') }),
          h('button', { class: 'btn subtle small', text: 'Abrir la web', onclick: () => window.api.health.open(s.url) })
        )
      )
    );
  }
  function clientsTab(rr) {
    C.rr = rr;
    if (!C.data && !C.busy) load(rr);
    if (!C.hooked) {
      C.hooked = true;
      window.api.sites.onChanged(() => load(C.rr));
    }
    const d = C.data;
    if (!d) return h('p', { class: 'hint', text: 'Cargando las webs…' });
    const sites = [...d.sites].map((s) => ({ s, iss: issues(s) }));
    const bad = sites.filter((x) => x.iss.some((i) => i[0] === 'bad')).length;
    const warn = sites.filter((x) => x.iss.length && !x.iss.some((i) => i[0] === 'bad')).length;
    const list = sites.filter((x) => C.filter === 'todas' || (C.filter === 'problemas' && x.iss.length)).sort((a, b) => Number(b.iss.some((i) => i[0] === 'bad')) - Number(a.iss.some((i) => i[0] === 'bad')) || b.iss.length - a.iss.length || a.s.name.localeCompare(b.s.name));
    const run = async (what, btn) => {
      btn.disabled = true;
      btn.textContent = 'Revisando… (puede tardar)';
      await window.api.sites.run(what).catch((e) => toast(errMsg(e), true));
      await load(rr);
    };
    const nextCrit = (d.sites.filter((s) => s.security?.next?.critical).length);
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Webs' }), h('dd', { text: String(sites.length) })),
        h('div', {}, h('dt', { text: 'Con algo grave' }), h('dd', { class: bad ? 'rx-hot' : '', text: String(bad) })),
        h('div', {}, h('dt', { text: 'Con pendientes' }), h('dd', { text: String(warn) })),
        h('div', {}, h('dt', { text: 'Next.js con fallos críticos' }), h('dd', { class: nextCrit ? 'rx-hot' : '', text: String(nextCrit) }))
      ),
      h('div', { class: 'toolbar flat' },
        h('div', { class: 'seg' }, [['todas', 'Todas'], ['problemas', 'Con algo pendiente']].map(([k, l]) => h('button', { class: C.filter === k ? 'on' : '', text: l, onclick: () => { C.filter = k; rr(); } }))),
        h('button', { class: 'btn subtle small', disabled: d.busy.daily, text: d.busy.daily ? 'Revisando contenido y capturas…' : 'Revisar contenido y capturas', title: 'Dominios, contenido vencido y capturas (se hace solo cada día)', onclick: (e) => run('daily', e.currentTarget) }),
        h('button', { class: 'btn subtle small', disabled: d.busy.weekly || !d.google, text: d.busy.weekly ? 'Midiendo…' : 'Medir velocidad y horarios', title: d.google ? 'Core Web Vitals y horarios de Google (se hace solo cada semana)' : 'Añade tu clave de Google en Salud de las webs', onclick: (e) => run('weekly', e.currentTarget) }),
        h('button', { class: 'btn subtle small', disabled: d.busy.repos, text: d.busy.repos ? 'Revisando repos…' : 'Revisar seguridad', onclick: (e) => run('repos', e.currentTarget) })
      ),
      !d.google ? h('p', { class: 'hint', text: 'Para la velocidad real (CrUX) y los horarios de Google, usa la misma clave de Google de Salud de las webs y activa en Google Cloud «Chrome UX Report API» y «Places API (New)».' }) : null,
      d.securityError ? h('p', { class: 'hint bad', text: 'Seguridad: ' + d.securityError }) : null,
      h('div', { class: 'cl-list' }, list.map((x) => card(x.s))),
      d.otherSecurity?.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Otros repos con avisos de seguridad' }), h('ul', { class: 'cl-ul' }, d.otherSecurity.map((r) => h('li', {}, h('b', { text: r.repo }), h('small', { class: 'hint', text: [r.next?.advisories?.length ? 'next@' + r.next.version + ' → ' + (r.next.target || '?') + (r.next.critical ? ' (' + r.next.critical + ' críticos)' : '') : null, r.secrets?.length ? r.secrets.length + ' posibles claves' : null, r.dependabot?.length ? r.dependabot.length + ' alertas Dependabot' : null].filter(Boolean).join(' · ') }))))) : null,
    ];
  }

  // ================================================================ SQUADS
  const X = { data: null, busy: false };
  async function loadExtras(rr) {
    X.busy = true;
    try {
      X.data = await window.api.team.extras();
    } catch {}
    X.busy = false;
    rr?.();
  }
  async function oneOnOne(sq, person, week) {
    const notes = await window.api.team.notes(sq.key).catch(() => []);
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide' });
    const ta = h('textarea', { class: 'note', rows: 5, placeholder: 'Notas de esta reunión: acuerdos, bloqueos, próximos pasos…' });
    const ai = (week?.ai?.people || []).find((x) => String(x.squad).toLowerCase() === sq.key);
    const wp = (week?.people || []).find((x) => x.squad === sq.key);
    const stale = (week?.stale || []).filter((b) => b.squad === sq.key);
    dlg.append(
      h('h2', { text: '1:1 con ' + sq.leader }),
      h('div', { class: 'oo-grid' },
        h('section', {}, h('h4', { text: 'Su semana' }), ai?.week?.length ? h('ul', { class: 'cl-ul' }, ai.week.map((x) => h('li', { text: x }))) : h('p', { class: 'hint', text: wp ? wp.commits + ' commits · ' + (wp.deploys || 0) + ' deploys' : 'Prepara «La semana del equipo» para ver su resumen.' }),
          ai?.next?.length ? [h('h4', { text: 'La próxima' }), h('ul', { class: 'cl-ul' }, ai.next.map((x) => h('li', { text: x })))] : null),
        h('section', {}, h('h4', { text: 'Para hablar' }), h('ul', { class: 'cl-ul' },
          ...(person?.tickets || []).filter((t) => t.late).slice(0, 6).map((t) => h('li', { text: 'Vencido: ' + t.title + ' (' + t.deadline + ')' })),
          ...stale.slice(0, 4).map((b) => h('li', { text: 'Rama sin pasar a main: ' + b.repo.replace(/^website-[a-d]-/, '') + '/' + b.branch })),
          ...(ai?.watch || []).map((x) => h('li', { text: x })),
          person ? h('li', { text: 'Puntualidad: ' + (person.onTimePct ?? '—') + '% · días por ticket: ' + (person.avgDays ?? '—') }) : null
        ))
      ),
      h('h4', { text: 'Notas' }),
      ta,
      notes.length ? h('details', { class: 'oo-prev' }, h('summary', { text: 'Reuniones anteriores (' + notes.length + ')' }), notes.slice().reverse().map((n) => h('div', { class: 'oo-note' }, h('small', { class: 'hint', text: new Date(n.at).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) }), h('p', { text: n.text })))) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', text: 'Cerrar', onclick: () => dlg.close() }), h('button', { class: 'btn primary', text: 'Guardar notas', onclick: async () => { if (ta.value.trim()) await window.api.team.saveNote(sq.key, ta.value); toast('Notas guardadas.'); dlg.close(); } }))
    );
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
  function squadsExtras(d, rr, week) {
    if (!X.data && !X.busy) loadExtras(rr);
    const x = X.data;
    const COLORS = { a: '#7be0a5', b: '#5fd8e8', c: '#f5b942', d: '#f07ab8' };
    const badge = (sq) => h('span', { class: 'tw-badge sm', style: { '--sq': COLORS[sq] || 'var(--muted)' }, text: String(sq || '·').toUpperCase() });
    return h('section', { class: 'sx' },
      h('div', { class: 'sx-grid' },
        h('section', { class: 'sx-box' },
          h('div', { class: 'gd-head' }, h('h3', { text: 'Standup de hoy' }), h('button', { class: 'btn subtle small', text: 'Preparar', onclick: async () => { await window.api.team.standup(); loadExtras(rr); } })),
          x?.standup?.squads?.length ? x.standup.squads.map((s) => h('div', { class: 'sx-stand' }, h('pre', { text: s.text }), h('button', { class: 'btn subtle small', text: 'Copiar', onclick: () => navigator.clipboard.writeText(s.text).then(() => toast('Copiado para Slack.')) }))) : h('p', { class: 'hint', text: 'Se prepara solo a las 9 de la mañana (lunes a viernes).' }),
          x?.standup?.squads?.length ? h('button', { class: 'btn ghost small', text: 'Copiar los cuatro', onclick: () => navigator.clipboard.writeText(x.standup.squads.map((s) => s.text).join('\n\n')).then(() => toast('Copiado.')) }) : null
        ),
        h('div', { class: 'sx-col' },
          h('section', { class: 'sx-box' }, h('h3', { text: 'En riesgo de atraso' }), x?.risk?.length ? h('ul', { class: 'tw-rows' }, x.risk.map((r) => h('li', {}, badge(r.squad), h('button', { class: 'link-btn', text: r.ticket, onclick: () => window.api.open(r.url) }), h('small', { class: 'hint', text: 'vence ' + r.deadline + ' · ' + r.repo.replace(/^website-[a-d]-/, '') + ' sin commits ' + (r.lastCommit ? 'desde ' + relTime(r.lastCommit / 1000) : 'este mes') })))) : h('p', { class: 'hint', text: 'Ningún ticket de web vence en 3 días sin trabajo reciente.' })),
          h('section', { class: 'sx-box' }, h('div', { class: 'gd-head' }, h('h3', { text: 'Comentarios sin responder' }), h('button', { class: 'btn subtle small', text: 'Revisar', onclick: async (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Leyendo Notion…'; await window.api.team.comments().catch((er) => toast(errMsg(er), true)); loadExtras(rr); } })),
            x?.comments?.list?.length ? h('ul', { class: 'tw-rows' }, x.comments.list.slice(0, 10).map((c) => h('li', {}, badge(c.squad), h('button', { class: 'link-btn', text: c.ticket, onclick: () => window.api.open(c.url) }), h('small', { class: 'hint', text: c.author + ' hace ' + (c.hours >= 48 ? Math.round(c.hours / 24) + ' días' : c.hours + ' h') + ': «' + c.text.slice(0, 80) + '»' })))) : h('p', { class: 'hint', text: x?.comments ? 'Nada esperando respuesta.' : 'Se revisa cada mañana: el último mensaje es de otra persona y lleva más de 48 h.' })),
          h('section', { class: 'sx-box' }, h('h3', { text: 'Carga del equipo' }), x?.load?.rows?.length ? [h('ul', { class: 'sx-load' }, x.load.rows.map((r) => h('li', {}, badge(r.squad), h('span', { text: r.leader.split(' ')[0] }), h('div', { class: 'sx-bar' }, h('i', { style: { width: Math.min(100, ((r.weeks || 0) / Math.max(1, ...x.load.rows.map((y) => y.weeks || 0))) * 100) + '%' } })), h('small', { class: 'hint', text: r.open + ' abiertos · cierra ' + r.rate + '/sem · ' + (r.weeks != null ? r.weeks + ' sem.' : '—') })))), ...x.load.tips.map((t) => h('p', { class: 'hint', text: t }))] : h('p', { class: 'hint', text: 'Necesita los tickets de Notion.' }))
        )
      ),
      h('div', { class: 'sx-oo' }, h('span', { class: 'hint', text: 'Preparar el 1:1 con:' }), (d.squads || []).map((sq) => h('button', { class: 'btn subtle small', text: sq.leader.split(' ')[0], onclick: () => oneOnOne(sq, sq.person, week) })))
    );
  }

  window.clientsTab = clientsTab;
  window.squadsExtras = squadsExtras;
})();

'use strict';
// 1.22: Websites → Alertas (solo lo que rompe una web) y Squads (webs, alertas y
// el ritmo de cada responsable en Notion).
(function () {
  const SQ = { a: 'Squad A', b: 'Squad B', c: 'Squad C', d: 'Squad D', other: 'Sin squad' };
  const SQC = { a: '#7ee2a8', b: '#62e0e8', c: '#ffb547', d: '#ff7ab8', other: 'var(--muted)' };
  const SEV = { critical: ['Crítico', 'crit'], high: ['Importante', 'high'], medium: ['Menor', 'med'] };
  const ago = (t) => relTime(t / 1000);
  const A = { data: null, busy: false, progress: null, squad: 'all', showMuted: false, rerender: null };
  const S = { data: null, busy: false, rerender: null };

  window.api.webAlerts.onProgress((p) => {
    A.progress = p;
    A.rerender?.();
  });
  window.api.webAlerts.onDone(async () => {
    A.progress = null;
    A.busy = false;
    A.data = await window.api.webAlerts.get();
    A.rerender?.();
    S.data = null;
  });
  async function aLoad() {
    if (A.loading) return;
    A.loading = true;
    A.data = await window.api.webAlerts.get().catch(() => ({ issues: {}, muted: {}, sites: {} }));
    A.loading = false;
    A.busy = !!A.data?.running;
    A.rerender?.();
  }
  async function aRun(only) {
    A.busy = true;
    A.rerender?.();
    try {
      A.data = await window.api.webAlerts.run(only);
      toast(only ? 'Web revisada.' : 'Revisión terminada.');
    } catch (e) {
      toast(errMsg(e), true);
    }
    A.busy = false;
    A.progress = null;
    A.rerender?.();
  }

  // =================================================== ALERTAS
  window.webAlertsTab = (rerender) => {
    A.rerender = rerender;
    if (!A.data) {
      aLoad();
      return h('div', { class: 'wa-skel' }, [1, 2, 3].map(() => h('div', { class: 'skel' })));
    }
    const d = A.data;
    const issues = Object.values(d.issues || {}).filter((i) => i.open && (A.showMuted || !d.muted?.[i.key]));
    const muted = Object.values(d.issues || {}).filter((i) => i.open && d.muted?.[i.key]).length;
    const list = issues.filter((i) => A.squad === 'all' || i.squad === A.squad).sort((a, b) => ({ critical: 0, high: 1, medium: 2 }[a.sev] - { critical: 0, high: 1, medium: 2 }[b.sev]) || b.lastAt - a.lastAt);
    const count = (sev) => issues.filter((i) => i.sev === sev).length;
    const sites = Object.keys(d.sites || {}).length;
    const resolved = Object.values(d.issues || {}).filter((i) => !i.open && i.resolvedAt > Date.now() - 7 * 86400000);
    const bySite = {};
    for (const i of list) (bySite[i.site] ||= []).push(i);
    const siteCard = ([site, items]) => {
      const it = items[0];
      const worst = items.some((x) => x.sev === 'critical') ? 'critical' : items.some((x) => x.sev === 'high') ? 'high' : 'medium';
      return h('section', { class: 'wa-site sev-' + worst },
        h('header', { class: 'wa-site-h' },
          h('span', { class: 'wa-sq', style: { '--sq': SQC[it.squad] || SQC.other }, text: it.squad !== 'other' ? it.squad.toUpperCase() : '·', title: SQ[it.squad] + (it.leader ? ' · ' + it.leader : '') }),
          h('div', {}, h('b', { text: it.name }), h('small', { class: 'hint', text: site.replace(/^https?:\/\//, '') + (it.leader ? ' · ' + it.leader : '') })),
          h('div', { class: 'wa-site-act' },
            h('button', { class: 'btn subtle small', text: 'Abrir web', onclick: () => window.api.health.open(site) }),
            h('button', { class: 'btn ghost small', disabled: A.busy, text: 'Revisar otra vez', onclick: () => aRun(site) })
          )
        ),
        h('ul', { class: 'wa-list' }, items.map((x) => h('li', { class: 'sev-' + x.sev + (d.muted?.[x.key] ? ' muted' : '') },
          h('span', { class: 'wa-sev ' + SEV[x.sev][1], text: SEV[x.sev][0] }),
          h('div', { class: 'wa-txt' }, h('b', { text: x.title }), x.detail && h('code', { text: x.detail.split('\n')[0].slice(0, 220) }), h('small', { class: 'hint', text: 'Visto ' + ago(x.lastAt) + (x.seen > 1 ? ' · ' + x.seen + ' revisiones seguidas' : '') + ' · desde ' + ago(x.firstAt) })),
          h('button', { class: 'btn subtle small', text: d.muted?.[x.key] ? 'Volver a avisar' : 'Ignorar', title: d.muted?.[x.key] ? '' : 'No volver a avisar de este problema', onclick: async () => { A.data = { ...A.data, ...(await window.api.webAlerts.mute(x.key, !d.muted?.[x.key])) }; A.rerender?.(); } })
        )))
      );
    };
    return [
      h('section', { class: 'wa-hero ' + (count('critical') ? 'bad' : count('high') ? 'warn' : 'ok') },
        h('div', {},
          h('p', { class: 'ks-kicker', text: 'Alertas críticas' }),
          h('h2', { text: issues.length ? (count('critical') ? count('critical') + (count('critical') === 1 ? ' web rota' : ' problemas críticos') : issues.length + (issues.length === 1 ? ' problema que revisar' : ' problemas que revisar')) : 'Todo funciona' }),
          h('p', { class: 'hint', text: d.at ? 'Revisé ' + sites + ' webs ' + ago(d.at) + ' abriendo cada una como un visitante: páginas caídas, errores de JavaScript, archivos y enlaces rotos, y errores en vivo de Vercel. Nada de rendimiento.' : 'Todavía no revisé las webs. La primera revisión tarda unos minutos.' })
        ),
        h('div', { class: 'wa-counts' },
          h('div', { class: 'crit' }, h('b', { text: String(count('critical')) }), h('span', { text: 'críticos' })),
          h('div', { class: 'high' }, h('b', { text: String(count('high')) }), h('span', { text: 'importantes' })),
          h('div', { class: 'ok' }, h('b', { text: String(resolved.length) }), h('span', { text: 'arreglados esta semana' }))
        )
      ),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', disabled: A.busy, text: A.busy ? (A.progress ? 'Revisando ' + A.progress.n + ' de ' + A.progress.total + '…' : 'Revisando…') : 'Revisar todas ahora', onclick: () => aRun() }),
        h('div', { class: 'seg' }, [['all', 'Todos'], ['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['other', 'Sin squad']].map(([k, l]) => h('button', { class: A.squad === k ? 'on' : '', text: l, onclick: () => { A.squad = k; A.rerender?.(); } }))),
        muted ? h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: A.showMuted, onchange: (e) => { A.showMuted = e.target.checked; A.rerender?.(); } }), h('span', { text: 'Mostrar ' + muted + ' ignorados' })) : null,
        A.progress && h('span', { class: 'hint', text: A.progress.name })
      ),
      list.length ? h('div', { class: 'wa-sites' }, Object.entries(bySite).map(siteCard)) : d.at ? h('p', { class: 'empty' }, h('b', { text: 'Sin problemas' }), A.squad === 'all' ? 'Ninguna web tiene errores que rompan algo.' : 'Las webs de este squad están bien.') : null,
      resolved.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Arreglado en los últimos 7 días' }), h('ul', { class: 'dy-list' }, resolved.slice(0, 10).map((x) => h('li', {}, h('span', { text: x.name + ': ' + x.title }), h('b', { text: ago(x.resolvedAt) }))))) : null,
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => window.api.saveSettings({ webAlerts: e.target.checked }) }), h('span', { text: 'Revisarlas solas cada 6 horas y avisarme de lo que se rompa (con el squad y su responsable)' })),
    ];
  };

  // =================================================== SQUADS
  async function sLoad(force) {
    S.busy = true;
    S.rerender?.();
    try {
      S.data = await window.api.squads(!!force);
    } catch (e) {
      toast(errMsg(e), true);
    }
    S.busy = false;
    S.rerender?.();
  }
  const spark = (vals) => {
    const max = Math.max(1, ...vals);
    return h('div', { class: 'sq-spark', 'aria-label': 'Tickets cerrados por semana: ' + vals.join(', ') }, vals.map((v, i) => h('i', { style: { height: Math.max(6, (v / max) * 100) + '%' }, title: (i === vals.length - 1 ? 'Esta semana' : 'Hace ' + (vals.length - 1 - i) + ' sem.') + ': ' + v })));
  };
  const light = (sq) => {
    const p = sq.person;
    const bad = sq.issues.critical + sq.deploys.failed + (p?.late || 0) >= 3 || sq.issues.critical > 0;
    const warn = !bad && (sq.issues.high > 0 || (p?.late || 0) > 0 || sq.deploys.failed > 0);
    return bad ? ['bad', 'Necesita atención'] : warn ? ['warn', 'Con pendientes'] : ['ok', 'Al día'];
  };
  window.squadsTab = (rerender) => {
    S.rerender = rerender;
    if (!S.data && !S.busy) sLoad(false);
    const d = S.data;
    if (!d) return h('div', { class: 'wa-skel' }, [1, 2, 3, 4].map(() => h('div', { class: 'skel' })));
    const card = (sq) => {
      const p = sq.person;
      const [tone, label] = light(sq);
      const closed = p?.closed || [0, 0, 0, 0];
      return h('section', { class: 'sq-card', style: { '--sq': SQC[sq.key] } },
        h('header', { class: 'sq-h' },
          h('span', { class: 'sq-badge', text: sq.key.toUpperCase() }),
          h('div', {}, h('b', { text: 'Squad ' + sq.key.toUpperCase() }), h('small', { text: sq.leader })),
          h('span', { class: 'sq-light ' + tone, text: label })
        ),
        h('div', { class: 'sq-kpis' },
          h('div', {}, h('b', { text: p ? String(p.open) : '—' }), h('span', { text: 'tickets abiertos' })),
          h('div', { class: p?.late ? 'hot' : '' }, h('b', { text: p ? String(p.late) : '—' }), h('span', { text: 'vencidos' })),
          h('div', {}, h('b', { text: p?.onTimePct != null ? p.onTimePct + '%' : '—' }), h('span', { text: 'a tiempo (30 días)' })),
          h('div', {}, h('b', { text: p?.avgDays != null ? String(p.avgDays).replace('.', ',') + ' d' : '—' }), h('span', { text: 'por ticket' }))
        ),
        p ? h('div', { class: 'sq-pace' }, h('span', { class: 'hint', text: 'Cerrados por semana' }), spark(closed), h('b', { text: closed[3] + ' esta semana' })) : h('p', { class: 'hint', text: d.notion ? (S.busy ? 'Leyendo los tickets de ' + sq.leader + '…' : 'No encontré a ' + sq.leader + ' como Responsible en los tickets.') : 'Conecta Notion para ver su ritmo.' }),
        p?.tickets?.length ? h('div', { class: 'sq-sec' }, h('p', { class: 'sq-sec-h', text: 'Tickets abiertos de ' + sq.leader.split(' ')[0] }), h('ul', { class: 'sq-tk' }, p.tickets.slice(0, 6).map((t) => h('li', { class: t.late ? 'late' : '' }, h('button', { class: 'link-btn', text: t.title, title: 'Abrir en Notion', onclick: () => window.api.open(t.url) }), h('b', { text: t.late ? 'vencido ' + t.deadline.slice(5).split('-').reverse().join('/') : t.deadline ? t.deadline.slice(5).split('-').reverse().join('/') : t.status })))), p.tickets.length > 6 && h('p', { class: 'hint', text: 'y ' + (p.open - 6) + ' más' })) : null,
        (() => {
          const doing = sq.webs.list.filter((w) => w.group === 'doing' || w.group === 'todo' || w.group === 'stopped');
          return doing.length ? h('div', { class: 'sq-sec' }, h('p', { class: 'sq-sec-h', text: 'Webs en el pipeline (' + doing.length + ')' }), h('ul', { class: 'sq-webs' }, doing.map((w) => h('li', { class: 'g-' + w.group }, h('span', { text: w.name }), h('em', { text: w.status }))))) : null;
        })(),
        h('div', { class: 'sq-row' },
          h('div', {}, h('b', { text: String(sq.webs.live) }), h('span', { text: 'webs publicadas' })),
          h('div', {}, h('b', { text: String(sq.webs.doing) }), h('span', { text: 'en curso' })),
          h('div', {}, h('b', { text: String(sq.deploys.week) }), h('span', { text: 'deploys esta semana' })),
          h('div', { class: sq.deploys.failed ? 'hot' : '' }, h('b', { text: String(sq.deploys.failed) }), h('span', { text: 'deploys fallidos' }))
        ),
        sq.issues.top.length
          ? h('ul', { class: 'sq-issues' }, sq.issues.top.map((i) => h('li', { class: 'sev-' + i.sev }, h('span', { class: 'wa-sev ' + SEV[i.sev][1], text: SEV[i.sev][0] }), h('span', { text: i.name + ': ' + i.title }))))
          : h('p', { class: 'sq-clean', text: 'Sus webs no tienen errores críticos.' }),
        null
      );
    };
    const max = Math.max(1, ...d.squads.map((s) => (s.person?.closed || []).reduce((a, b) => a + b, 0)));
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn ghost small', disabled: S.busy, text: S.busy ? 'Actualizando…' : 'Actualizar', onclick: () => sLoad(true) }),
        h('span', { class: 'hint', text: [d.team ? 'Notion: ' + d.team.openTotal + ' tickets abiertos en el equipo, leídos ' + relTime(d.team.at / 1000) : d.notion ? 'Leyendo Notion…' : 'Notion sin conectar', d.vercel ? null : 'Vercel sin conectar (deploys en 0)'].filter(Boolean).join(' · ') }),
        d.teamError && h('span', { class: 'hint bad', text: d.teamError }),
        d.team?.errors?.length ? h('span', { class: 'hint', text: d.team.errors.join(' · ') }) : null
      ),
      h('div', { class: 'sq-grid' }, d.squads.map(card)),
      h('section', { class: 'rx-card sq-compare' },
        h('h3', { text: 'Comparativa (solo para ti)' }),
        h('table', { class: 'sq-table' },
          h('thead', {}, h('tr', {}, ['Squad', 'Abiertos', 'Vencidos', 'A tiempo', 'Cerrados 4 sem.', 'Alertas', 'Deploys sem.'].map((x) => h('th', { text: x })))),
          h('tbody', {}, d.squads.map((s) => {
            const tot = (s.person?.closed || []).reduce((a, b) => a + b, 0);
            return h('tr', {},
              h('td', {}, h('span', { class: 'sq-dot', style: { background: SQC[s.key] } }), ' ' + s.key.toUpperCase() + ' · ' + s.leader),
              h('td', { text: s.person ? String(s.person.open) : '—' }),
              h('td', { class: s.person?.late ? 'hot' : '', text: s.person ? String(s.person.late) : '—' }),
              h('td', { text: s.person?.onTimePct != null ? s.person.onTimePct + '%' : '—' }),
              h('td', {}, h('span', { class: 'sq-bar' }, h('i', { style: { width: (tot / max) * 100 + '%', background: SQC[s.key] } })), ' ' + tot),
              h('td', { class: s.issues.critical ? 'hot' : '', text: String(s.issues.critical + s.issues.high) }),
              h('td', { text: String(s.deploys.week) })
            );
          }))
        ),
        h('p', { class: 'hint', text: 'Ritmo según el campo Responsible de los tickets de Notion (cerrados = pasados a Done en las últimas 4 semanas; a tiempo = cerrados antes de su fecha límite). Alertas de Websites → Alertas.' })
      ),
    ];
  };
})();

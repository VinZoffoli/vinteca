'use strict';
// 1.32: Websites → Equipo dev (PRs, deploys rotos, tiempo de ciclo, retro, quién conoce
// cada web), Vercel y versiones (consumo, versiones, variables, previews olvidados) y
// Clientes → Reseñas, Vencimientos e Incidentes, más la ficha de cliente en cada web.
(function () {
  const D = { st: null, usage: null, reviews: null, exp: null, inc: null, sub: 'webs', hooked: false, rr: null, open: {}, verAll: false, loading: {} };
  const rr = () => D.rr?.();
  const ago = (t) => (t ? relTime(t / 1000) : '—');
  const dd = (d) => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const fmtH = (x) => (x == null ? '—' : x < 1 ? Math.max(1, Math.round(x * 60)) + ' min' : x < 48 ? (Math.round(x * 10) / 10).toLocaleString('es') + ' h' : Math.round(x / 24) + ' días');
  const money = (x) => (x == null ? '—' : 'US$' + (x >= 100 ? Math.round(x).toLocaleString('es') : x.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  const parts = (x) => { const m = String(x || '').match(/(d+)(?:.(d+))?/); return m ? Number(m[1]) * 1000 + Number(m[2] || 0) : 99999; };
  const short = (r) => String(r || '').replace(/^website-[a-d]-/i, '');
  const sqOf = (r) => (String(r || '').match(/^website-([a-d])-/i) || [])[1]?.toLowerCase() || null;
  const COLORS = { a: '#7be0a5', b: '#5fd8e8', c: '#f5b942', d: '#f07ab8' };
  const badge = (sq) => sq && h('span', { class: 'tw-badge sm', style: { '--sq': COLORS[sq] || 'var(--muted)' }, text: String(sq || '·').toUpperCase() });
  const tag = (cls, text) => h('span', { class: 'cl-tag cl-t-' + cls, text });
  const box = (cls, title, action, ...kids) => h('section', { class: 'sx-box ' + cls }, h('div', { class: 'gd-head' }, h('h3', { text: title }), action || null), ...kids);
  const spark = (vals, cls = '') => {
    const top = Math.max(0.01, ...vals.filter((x) => x != null));
    return h('div', { class: 'cl-spark ' + cls }, vals.map((x) => h('i', { class: x == null ? 'none' : '', title: x == null ? '' : money(x), style: { height: x == null ? '3px' : Math.max(6, (x / top) * 100) + '%' } })));
  };
  function hook(r) {
    D.rr = r;
    if (D.hooked) return;
    D.hooked = true;
    window.api.r132.onChanged(() => {
      clearTimeout(D.t);
      D.t = setTimeout(async () => {
        await loadState();
        if (D.usage) D.usage = await window.api.r132.usage().catch(() => D.usage);
        if (D.reviews) D.reviews = await window.api.r132.reviews().catch(() => D.reviews);
        rr();
      }, 500);
    });
  }
  async function loadState() {
    D.st = await window.api.r132.get().catch(() => D.st);
  }
  async function once(key, fn) {
    if (D.loading[key]) return;
    D.loading[key] = true;
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), true);
    }
    D.loading[key] = false;
    rr();
  }
  const busy = (k) => (D.st?.busy || []).includes(k);
  async function run(kinds, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Revisando… (puede tardar)';
    }
    await Promise.all(kinds.map((k) => window.api.r132.run(k).catch((e) => toast(errMsg(e), true))));
    await loadState();
    if (kinds.includes('usage')) D.usage = await window.api.r132.usage().catch(() => D.usage);
    if (kinds.includes('reviews')) D.reviews = await window.api.r132.reviews().catch(() => D.reviews);
    rr();
  }
  const errLine = (k) => D.st?.[k + 'Error'] ? h('p', { class: 'hint bad-t', text: D.st[k + 'Error'] }) : null;
  const checkedAt = (k) => D.st?.[k + 'At'] || (typeof D.st?.[k]?.at === 'number' ? D.st[k].at : null);
  const stamp = (k) => h('small', { class: 'hint', text: busy(k) ? 'Revisando…' : checkedAt(k) ? 'Revisado ' + ago(checkedAt(k)) : 'Sin revisar todavía' });

  // ================================================================ EQUIPO DEV
  function prsBox() {
    const all = D.st?.prs || [];
    const waiting = all.filter((p) => !p.reviewed && p.ageDays >= 2);
    const changes = all.filter((p) => p.changes && !p.approved);
    const row = (p) => h('li', {}, badge(sqOf(p.repo)), h('button', { class: 'link-btn', text: short(p.repo) + ' #' + p.number, onclick: () => window.api.open(p.url) }), h('span', { text: p.title }), h('small', { class: 'hint', text: p.author + ' · hace ' + (p.ageDays ? p.ageDays + (p.ageDays === 1 ? ' día' : ' días') : 'hoy') + ' · ' + (p.reviewers.length ? 'revisa: ' + p.reviewers.join(', ') : 'sin revisor asignado') }));
    const byReviewer = {};
    for (const p of waiting) for (const r of p.reviewers.length ? p.reviewers : ['(sin asignar)']) byReviewer[r] = (byReviewer[r] || 0) + 1;
    return box('r2-prs', 'PRs esperando revisión', stamp('prs'),
      errLine('prs'),
      waiting.length ? [h('ul', { class: 'tw-rows' }, waiting.map(row)), h('p', { class: 'hint', text: 'Tienen que revisar: ' + Object.entries(byReviewer).sort((a, b) => b[1] - a[1]).map(([w, n]) => w + ' (' + n + ')').join(' · ') })] : h('p', { class: 'ok-t', text: D.st?.prs ? 'Ningún PR lleva más de 2 días sin revisión.' : 'Pulsa «Actualizar» para revisarlo.' }),
      changes.length ? [h('h4', { text: 'Con cambios pedidos' }), h('ul', { class: 'tw-rows' }, changes.map(row))] : null,
      all.length ? h('small', { class: 'hint', text: all.length + ' PRs abiertos en total (sin contar borradores).' }) : null
    );
  }
  function brokenBox() {
    const b = D.st?.broken;
    const open = (b?.list || []).filter((d) => !d.fixedAt);
    const fixed = (b?.list || []).filter((d) => d.fixedAt);
    return box('r2-broken', 'Deploys que fallaron', stamp('broken'),
      errLine('broken'),
      open.length ? h('ul', { class: 'r2-list' }, open.map((d) => h('li', { class: 'r2-bad' },
        h('div', {}, badge(sqOf(d.project)), h('b', { text: short(d.project) }), h('span', { class: 'hint', text: ' · ' + (d.target === 'production' ? 'producción' : 'preview') + (d.branch ? ' · ' + d.branch : '') })),
        h('p', {}, 'Lo rompió ', h('b', { text: d.author }), ' ' + ago(d.at) + (d.commit ? ': «' + d.commit + '»' : '')),
        (d.reason || []).length ? h('pre', { class: 'r2-log', text: d.reason.join('\n') }) : null,
        h('div', { class: 'row' }, d.inspector && h('button', { class: 'btn subtle small', text: 'Ver el log en Vercel', onclick: () => window.api.open(d.inspector) }))
      ))) : h('p', { class: 'ok-t', text: b ? 'Nada roto: todo lo que falló en 14 días ya se arregló.' : 'Pulsa «Actualizar» para revisarlo.' }),
      fixed.length ? h('details', { class: 'r2-more' }, h('summary', { text: fixed.length + ' que fallaron y ya se arreglaron' }), h('ul', { class: 'tw-rows' }, fixed.slice(0, 15).map((d) => h('li', {}, badge(sqOf(d.project)), h('span', { text: short(d.project) + (d.branch ? ' · ' + d.branch : '') }), h('small', { class: 'hint', text: 'falló con ' + d.author + ', lo arregló ' + (d.fixedBy || '?') + ' en ' + fmtH((d.fixedAt - d.at) / 3600000) }))))) : null
    );
  }
  function cycleBox() {
    const c = D.st?.cycle;
    const table = (rows, label) => h('table', { class: 'r2-table' },
      h('thead', {}, h('tr', {}, h('th', { text: label }), h('th', { text: 'PRs' }), h('th', { text: 'Abierto → fusionado' }), h('th', { text: 'Fusionado → en producción' }), h('th', { text: 'Total' }))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { text: label === 'Web' ? short(r.key) : r.key }), h('td', { text: String(r.prs) }), h('td', { text: fmtH(r.toMerge) }), h('td', { text: fmtH(r.toLive) }), h('td', {}, h('b', { text: fmtH(r.total) }))))));
    return box('r2-cycle wide', 'Tiempo de ciclo (últimos 30 días)', stamp('cycle'),
      errLine('cycle'),
      !c ? h('p', { class: 'hint', text: 'Desde que se abre un PR hasta que está en producción en Vercel. Pulsa «Actualizar».' }) : [
        h('dl', { class: 'stat-strip rx-stats' },
          h('div', {}, h('dt', { text: 'PRs fusionados' }), h('dd', { text: String(c.prs) })),
          h('div', {}, h('dt', { text: 'Abierto → fusionado' }), h('dd', { text: fmtH(c.toMerge) })),
          h('div', {}, h('dt', { text: 'Fusionado → en producción' }), h('dd', { text: fmtH(c.toLive) }))
        ),
        h('div', { class: 'r2-two' }, table(c.people, 'Persona'), table(c.repos.slice(0, 10), 'Web')),
        c.slowest?.length ? [h('h4', { text: 'Los que más tardaron' }), h('ul', { class: 'tw-rows' }, c.slowest.map((p) => h('li', {}, h('button', { class: 'link-btn', text: short(p.repo), onclick: () => window.api.open(p.url) }), h('span', { text: p.title }), h('small', { class: 'hint', text: p.author + ' · ' + fmtH(p.toMerge) + ' hasta fusionar + ' + fmtH(p.toLive) + ' hasta producción' }))))] : null,
        h('small', { class: 'hint', text: 'Medianas. «En producción» es el primer deploy de producción listo después de fusionar; si la web no está en Vercel, queda en —.' }),
      ]
    );
  }
  function retroBox() {
    const r = D.st?.retro;
    const text = () => (r.general ? r.general + '\n\n' : '') + r.squads.map((s) => '*Squad ' + String(s.squad).toUpperCase() + (s.leader ? ' (' + s.leader + ')' : '') + '*\n' + [['✅ Cerrado', s.cerrado], ['⏳ Pendiente', s.pendiente], ['🚧 Bloqueado', s.bloqueado], ['💡 Mejorar', s.mejorar]].filter(([, l]) => l?.length).map(([t, l]) => t + '\n' + l.map((x) => '• ' + x).join('\n')).join('\n')).join('\n\n');
    return box('r2-retro wide', 'Retro del sprint', h('div', { class: 'row' }, r ? h('small', { class: 'hint', text: 'Preparada ' + ago(r.at) }) : null, h('button', { class: 'btn subtle small', disabled: D.loading.retro, text: D.loading.retro ? 'Preparando… (1–2 min)' : r ? 'Prepararla de nuevo' : 'Preparar la retro', onclick: () => once('retro', async () => { await window.api.r132.retro(); await loadState(); }) }), r ? h('button', { class: 'btn ghost small', text: 'Copiar para Slack', onclick: () => navigator.clipboard.writeText(text()).then(() => toast('Copiada.')) }) : null),
      !r ? h('p', { class: 'hint', text: 'Las últimas 2 semanas de cada squad: qué se cerró, qué quedó pendiente, qué está bloqueado y qué mejorar. Usa los tickets de Notion, la semana del equipo, los PRs y los deploys rotos.' }) : [
        r.general ? h('p', { text: r.general }) : null,
        h('div', { class: 'r2-retro-grid' }, r.squads.map((s) => h('section', { class: 'r2-retro-sq', style: { '--sq': COLORS[String(s.squad).toLowerCase()] || 'var(--muted)' } },
          h('h4', {}, badge(String(s.squad).toLowerCase()), ' ' + (s.leader || 'Squad ' + String(s.squad).toUpperCase())),
          [['Cerrado', s.cerrado, 'ok'], ['Pendiente', s.pendiente, 'warn'], ['Bloqueado', s.bloqueado, 'bad'], ['Mejorar', s.mejorar, 'info']].map(([t, l, c]) => l?.length ? [h('small', { class: 'r2-k r2-k-' + c, text: t }), h('ul', { class: 'cl-ul' }, l.map((x) => h('li', { text: x })))] : null)
        ))),
      ]
    );
  }
  function busBox() {
    const b = D.st?.bus;
    const solo = (b?.repos || []).filter((r) => r.share >= 85);
    const shared = (b?.repos || []).filter((r) => r.share < 85);
    const byPerson = {};
    for (const r of solo) (byPerson[r.top] ||= []).push(r);
    const people = Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length);
    const recent = (r) => Date.now() - r.lastPush < 30 * 86400000;
    return box('r2-bus wide', 'Quién conoce cada web', stamp('bus'),
      errLine('bus'),
      !b ? h('p', { class: 'hint', text: 'Webs que solo ha tocado una persona en 6 meses: si esa persona falta, nadie más las conoce. Pulsa «Actualizar».' }) : [
        h('p', { class: 'hint', text: solo.length + ' de ' + b.repos.length + ' repos con actividad los toca una sola persona (85 % o más de los commits en 6 meses); ' + shared.length + ' los comparten varias. Las marcadas se movieron este mes: son las que más urge que alguien más conozca.' }),
        h('div', { class: 'r2-bus-grid' }, people.map(([who, list]) => h('section', { class: 'r2-bus-p' },
          h('h4', {}, h('b', { text: who }), h('span', { class: 'hint', text: ' · ' + list.length + (list.length === 1 ? ' web' : ' webs') + ', ' + list.filter(recent).length + ' activas este mes' })),
          h('div', { class: 'r2-chips' }, list.sort((x, y) => Number(recent(y)) - Number(recent(x)) || y.total - x.total).map((r) => h('span', { class: 'r2-chip' + (recent(r) ? ' hot' : ''), title: r.total + ' commits · último ' + ago(r.lastPush), text: short(r.repo) })))
        ))),
        shared.length ? h('details', { class: 'r2-more' }, h('summary', { text: 'Repos compartidos (' + shared.length + ')' }), h('ul', { class: 'tw-rows' }, shared.map((r) => h('li', {}, h('span', { text: short(r.repo) }), h('small', { class: 'hint', text: r.people.slice(0, 4).map((p) => p.who + ' ' + p.n).join(' · ') }))))) : null,
      ]
    );
  }
  function devTab(r) {
    hook(r);
    if (!D.st) {
      once('st', loadState);
      return h('p', { class: 'hint', text: 'Cargando…' });
    }
    const s = D.st;
    const waiting = (s.prs || []).filter((p) => !p.reviewed && p.ageDays >= 2).length;
    const broken = (s.broken?.list || []).filter((d) => !d.fixedAt).length;
    const solo = (s.bus?.repos || []).filter((x) => x.share >= 85).length;
    const any = ['prs', 'broken', 'cycle', 'bus'].some(busy);
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'PRs esperando +2 días' }), h('dd', { class: waiting ? 'rx-hot' : '', text: s.prs ? String(waiting) : '—' })),
        h('div', {}, h('dt', { text: 'Deploys rotos' }), h('dd', { class: broken ? 'rx-hot' : '', text: s.broken ? String(broken) : '—' })),
        h('div', {}, h('dt', { text: 'PR → producción' }), h('dd', { text: s.cycle ? fmtH(s.cycle.toLive != null ? (s.cycle.toMerge || 0) + s.cycle.toLive : s.cycle.toMerge) : '—' })),
        h('div', {}, h('dt', { text: 'Webs de una sola persona' }), h('dd', { text: s.bus ? String(solo) : '—' }))
      ),
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn subtle small', disabled: any, text: any ? 'Revisando GitHub y Vercel…' : 'Actualizar', onclick: (e) => run(['prs', 'broken', 'cycle', 'bus'], e.currentTarget) }), h('span', { class: 'hint', text: 'Se revisa solo: PRs y deploys cada 3 horas, el tiempo de ciclo cada día y quién conoce cada web cada semana.' })),
      h('div', { class: 'sx-grid r2-grid' }, prsBox(), brokenBox(), cycleBox(), retroBox(), busBox()),
    ];
  }

  // ================================================================ VERCEL Y VERSIONES
  function usageBox() {
    if (!D.usage && !D.loading.usage) once('usage', async () => (D.usage = await window.api.r132.usage()));
    const u = D.usage;
    const s = u?.summary;
    const budgetIn = h('input', { type: 'number', class: 'rx-input r2-budget', min: 0, step: 50, value: s?.budget || '', placeholder: s?.limit ? String(s.limit) : 'US$', 'aria-label': 'Límite mensual en dólares' });
    return box('r2-use wide', 'Consumo de Vercel (' + (s ? new Date(s.month + '-15').toLocaleDateString('es', { month: 'long' }) : 'este mes') + ')', h('div', { class: 'row' }, h('small', { class: 'hint', text: u?.busy || busy('usage') ? 'Leyendo la facturación… (la primera vez tarda unos minutos)' : u?.at ? 'Actualizado ' + ago(u.at) : '' }), h('button', { class: 'btn subtle small', disabled: u?.busy || busy('usage'), text: 'Actualizar', onclick: (e) => run(['usage'], e.currentTarget) })),
      u?.error ? h('p', { class: 'hint bad-t', text: u.error }) : null,
      !s ? h('p', { class: 'hint', text: u ? 'Todavía no hay datos: pulsa «Actualizar». Usa tu token de Vercel (rol Owner, Member, Developer o Billing del equipo).' : 'Cargando…' }) : [
        h('dl', { class: 'stat-strip rx-stats' },
          h('div', {}, h('dt', { text: 'Llevas este mes' }), h('dd', { text: money(s.mtd) })),
          h('div', {}, h('dt', { text: 'Al ritmo actual cierras en' }), h('dd', { class: s.over ? 'rx-hot' : '', text: money(s.projected) })),
          h('div', {}, h('dt', { text: 'Mes pasado' }), h('dd', { text: money(s.prev) })),
          h('div', {}, h('dt', { text: s.budget ? 'Tu límite' : 'Límite (mes pasado + 20 %)' }), h('dd', { text: money(s.limit) }))
        ),
        s.over ? h('p', { class: 'notice', text: 'Al ritmo de este mes vas a pasar el límite por ' + money(s.projected - s.limit) + '. Lo que más gasta: ' + s.projects.slice(0, 3).map((p) => p.name + ' (' + money(p.cost) + ')').join(', ') + '.' }) : null,
        h('div', { class: 'r2-use-top' },
          h('div', {}, h('small', { class: 'hint', text: 'Gasto por día' }), spark(s.daily.map((d) => d.total), 'r2-spark-big')),
          h('label', { class: 'r2-budget-row' }, h('span', { class: 'hint', text: 'Avisarme si el mes va a pasar de US$' }), budgetIn, h('button', { class: 'btn ghost small', text: 'Guardar', onclick: async () => { await window.api.r132.setBudget(budgetIn.value); D.usage = await window.api.r132.usage(); toast(budgetIn.value ? 'Te aviso si el mes va a pasar de US$' + budgetIn.value + '.' : 'Uso el mes pasado + 20 % como límite.'); rr(); } }))
        ),
        h('div', { class: 'r2-chips' }, s.services.map((x) => h('span', { class: 'r2-chip', text: x.svc + ' ' + money(x.cost) }))),
        h('table', { class: 'r2-table r2-use-t' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Proyecto' }), h('th', { text: 'Este mes' }), h('th', { text: 'Proyección' }), h('th', { text: 'Mes pasado' }), h('th', { text: 'En qué' }), h('th', { text: 'Últimos 14 días' }))),
          h('tbody', {}, s.projects.slice(0, D.open.useAll ? 200 : 15).map((p) => h('tr', { class: p.spike ? 'r2-row-bad' : '' },
            h('td', {}, h('b', { text: short(p.name) || p.name }), p.spike ? tag('bad', 'Ayer ' + money(p.spike.last) + ' (lo normal ' + money(p.spike.base) + ')') : null),
            h('td', { text: money(p.cost) }),
            h('td', { class: p.prev != null && p.projected > p.prev * 1.3 && p.projected - p.prev > 10 ? 'warn-t' : '', text: money(p.projected) }),
            h('td', { text: money(p.prev) }),
            h('td', {}, h('small', { class: 'hint', text: p.top.map((t) => t.svc + ' ' + money(t.cost) + (t.unit && t.qty ? ' (' + (t.qty >= 100 ? Math.round(t.qty) : t.qty).toLocaleString('es') + ' ' + t.unit.replace('gigabyte', 'GB') + ')' : '')).join(' · ') })),
            h('td', {}, spark(p.spark))
          )))
        ),
        s.projects.length > 15 ? h('button', { class: 'link-btn', text: D.open.useAll ? 'Ver menos' : 'Ver los ' + s.projects.length + ' proyectos', onclick: () => { D.open.useAll = !D.open.useAll; rr(); } }) : null,
      ]
    );
  }
  function versionsBox() {
    const v = D.st?.versions;
    // lo que importa: Next.js o React con una versión mayor atrasada (TypeScript y ESLint casi siempre van detrás)
    const key = (r) => r.lag.next === 'major' || r.lag.react === 'major';
    const rows = (v?.rows || []).filter((r) => D.verAll || key(r)).sort((a, b) => Number(key(b)) - Number(key(a)) || parts(a.deps.next) - parts(b.deps.next) || a.repo.localeCompare(b.repo));
    return box('r2-ver wide', 'Versiones de cada web', h('div', { class: 'row' }, stamp('versions'), h('button', { class: 'btn subtle small', disabled: busy('versions'), text: 'Actualizar', onclick: (e) => run(['versions'], e.currentTarget) })),
      errLine('versions'),
      !v ? h('p', { class: 'hint', text: 'Next.js, React, Tailwind y las demás dependencias principales de cada repo website-…, comparadas con la última versión.' }) : [
        h('div', { class: 'toolbar flat' }, h('div', { class: 'seg' }, [[false, 'Next.js o React atrasados'], [true, 'Todas']].map(([k, l]) => h('button', { class: D.verAll === k ? 'on' : '', text: l, onclick: () => { D.verAll = k; rr(); } }))), h('span', { class: 'hint', text: 'Rojo: versión mayor atrasada (cambio grande). Ámbar: menor. Lo que dice package.json.' })),
        h('div', { class: 'r2-scroll' }, h('table', { class: 'r2-table r2-ver-t' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Web' }), v.packages.map((p) => h('th', {}, h('span', { text: p }), h('small', { class: 'hint', text: v.latest[p] || '?' }))))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, badge(sqOf(r.repo)), ' ' + short(r.repo)), v.packages.map((p) => h('td', { class: 'r2-v r2-v-' + (r.lag[p] || 'none'), title: r.deps[p] ? p + ' ' + r.deps[p] + ' → ' + (v.latest[p] || '?') : '', text: r.deps[p] || '' })))))
        )),
        h('small', { class: 'hint', text: rows.length + ' de ' + v.rows.length + ' webs' + (D.verAll ? '' : ' con Next.js o React una versión mayor por detrás') + '.' }),
      ]
    );
  }
  function envBox() {
    const e = D.st?.env;
    const bad = (e?.projects || []).filter((p) => p.missingInProd.length);
    const info = (e?.projects || []).filter((p) => !p.missingInProd.length && p.missingInPreview.length);
    const keys = (l) => h('div', { class: 'r2-chips' }, l.map((k) => h('code', { class: 'r2-chip', text: k })));
    return box('r2-env', 'Variables de entorno', h('div', { class: 'row' }, stamp('env'), h('button', { class: 'btn subtle small', disabled: busy('env'), text: 'Actualizar', onclick: (ev) => run(['env'], ev.currentTarget) })),
      errLine('env'),
      !e ? h('p', { class: 'hint', text: 'Las variables que están en preview y faltan en producción (y al revés). Solo se leen los nombres, nunca los valores.' }) : [
        bad.length ? h('ul', { class: 'r2-list' }, bad.map((p) => h('li', { class: 'r2-bad' }, h('b', { text: short(p.project) || p.project }), h('small', { class: 'hint', text: ' faltan en producción:' }), keys(p.missingInProd)))) : h('p', { class: 'ok-t', text: 'Ningún proyecto tiene variables de preview que falten en producción.' }),
        info.length ? h('details', { class: 'r2-more' }, h('summary', { text: info.length + ' proyectos con variables solo en producción (normal si son claves privadas)' }), h('ul', { class: 'r2-list' }, info.map((p) => h('li', {}, h('b', { text: short(p.project) || p.project }), keys(p.missingInPreview))))) : null,
      ]
    );
  }
  function previewsBox() {
    const p = D.st?.previews;
    return box('r2-prev', 'Previews olvidados', h('div', { class: 'row' }, stamp('previews'), h('button', { class: 'btn subtle small', disabled: busy('previews'), text: 'Actualizar', onclick: (e) => run(['previews'], e.currentTarget) })),
      errLine('previews'),
      !p ? h('p', { class: 'hint', text: 'Ramas con preview en Vercel, sin fusionar a main y sin movimiento hace más de 2 semanas.' }) : p.list.length ? h('ul', { class: 'r2-list' }, p.list.map((x) => h('li', {},
        h('div', {}, badge(sqOf(x.project)), h('b', { text: short(x.project) }), h('span', { text: ' · ' + x.branch })),
        h('small', { class: 'hint', text: x.author + ' · quieta hace ' + x.idleDays + ' días · ' + x.ahead + ' commits sin pasar a ' + x.base + (x.behind ? ' · ' + x.behind + ' por detrás' : '') }),
        h('div', { class: 'row' }, x.url && h('button', { class: 'btn subtle small', text: 'Ver preview', onclick: () => window.api.open(x.url) }), x.compare && h('button', { class: 'btn ghost small', text: 'Comparar en GitHub', onclick: () => window.api.open(x.compare) }))
      ))) : h('p', { class: 'ok-t', text: 'No hay previews olvidados.' })
    );
  }
  function infraTab(r) {
    hook(r);
    if (!D.st) {
      once('st', loadState);
      return h('p', { class: 'hint', text: 'Cargando…' });
    }
    return h('div', { class: 'sx-grid r2-grid' }, usageBox(), versionsBox(), envBox(), previewsBox());
  }

  // ================================================================ CLIENTES: RESEÑAS
  const stars = (n) => h('span', { class: 'r2-stars s' + Math.round(n || 0), 'aria-label': n + ' estrellas', text: '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0)) });
  async function reply(rv, holder, again) {
    holder.replaceChildren(h('p', { class: 'hint', text: 'Escribiendo una respuesta…' }));
    try {
      const text = await window.api.r132.reply(rv.id, again);
      if (D.reviews) D.reviews.replies[rv.id] = text;
      const ta = h('textarea', { class: 'note', rows: 5, value: text });
      holder.replaceChildren(ta, h('div', { class: 'row' }, h('button', { class: 'btn primary small', text: 'Copiar', onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast('Copiada: pégala en Google.')) }), h('button', { class: 'btn ghost small', text: 'Otra versión', onclick: () => reply(rv, holder, true) })));
    } catch (e) {
      holder.replaceChildren(h('p', { class: 'hint bad-t', text: errMsg(e) }));
    }
  }
  function reviewsView() {
    if (!D.reviews && !D.loading.reviews) once('reviews', async () => (D.reviews = await window.api.r132.reviews()));
    const R = D.reviews;
    if (!R) return h('p', { class: 'hint', text: 'Cargando…' });
    const places = R.sites.flatMap((s) => (s.places || []).map((p) => ({ ...p, site: s.name })));
    const neg = places.flatMap((p) => p.reviews.filter((r) => r.stars <= 3 && r.at && Date.now() - r.at < 60 * 86400000).map((r) => ({ ...r, place: p }))).sort((a, b) => b.at - a.at);
    const rated = places.filter((p) => p.rating != null);
    const avg = rated.length ? Math.round((rated.reduce((a, p) => a + p.rating, 0) / rated.length) * 10) / 10 : null;
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Locales en Google' }), h('dd', { text: String(places.length) })),
        h('div', {}, h('dt', { text: 'Nota media' }), h('dd', { text: avg != null ? avg.toLocaleString('es') + ' ★' : '—' })),
        h('div', {}, h('dt', { text: 'Negativas (60 días)' }), h('dd', { class: neg.length ? 'rx-hot' : '', text: String(neg.length) }))
      ),
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn subtle small', disabled: R.busy || busy('reviews'), text: R.busy || busy('reviews') ? 'Leyendo Google…' : 'Revisar reseñas', onclick: (e) => run(['reviews'], e.currentTarget) }), h('span', { class: 'hint', text: (R.at ? 'Revisadas ' + ago(R.at) + '. ' : '') + 'Se revisan solas una vez al día y te aviso de cada reseña de 3★ o menos. Google solo comparte las 5 más relevantes de cada local.' })),
      !R.google ? h('p', { class: 'hint', text: 'Necesita tu clave de Google (la de Salud de las webs) con «Places API (New)» activada.' }) : null,
      h('section', { class: 'sx-box' }, h('h3', { text: 'Para responder' }),
        neg.length ? h('ul', { class: 'r2-list' }, neg.map((r) => {
          const holder = h('div', { class: 'r2-reply' });
          if (R.replies[r.id]) setTimeout(() => reply(r, holder), 0);
          return h('li', { class: r.stars <= 2 ? 'r2-bad' : '' },
            h('div', { class: 'r2-rev-h' }, stars(r.stars), h('b', { text: r.place.name }), h('small', { class: 'hint', text: (r.author || 'Anónimo') + ' · ' + (r.rel || ago(r.at)) })),
            h('p', { class: 'r2-rev-t', text: r.text || '(sin texto)' }),
            holder,
            h('div', { class: 'row' }, !R.replies[r.id] && h('button', { class: 'btn subtle small', text: 'Respuesta sugerida', onclick: () => reply(r, holder) }), r.place.maps && h('button', { class: 'btn ghost small', text: 'Abrir en Google Maps', onclick: () => window.api.open(r.place.maps) }))
          );
        })) : h('p', { class: 'ok-t', text: R.at ? 'Ninguna reseña negativa en los últimos 60 días.' : 'Pulsa «Revisar reseñas».' })
      ),
      h('section', { class: 'sx-box' }, h('h3', { text: 'Cada local' }),
        h('table', { class: 'r2-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Local' }), h('th', { text: 'Nota' }), h('th', { text: 'Reseñas' }), h('th', { text: 'La más reciente' }))),
          h('tbody', {}, places.sort((a, b) => (a.rating ?? 9) - (b.rating ?? 9)).map((p) => {
            const last = p.reviews.filter((r) => r.at).sort((a, b) => b.at - a.at)[0];
            return h('tr', {}, h('td', {}, h('b', { text: p.name }), h('small', { class: 'hint', text: ' ' + p.address.split(',').slice(0, 2).join(',') })), h('td', { class: p.rating == null ? '' : p.rating >= 4.5 ? 'ok-t' : p.rating >= 4 ? '' : 'warn-t', text: p.rating != null ? p.rating.toLocaleString('es') + ' ★' : '—' }), h('td', { text: p.count != null ? p.count.toLocaleString('es') : '—' }), h('td', {}, last ? [stars(last.stars), h('small', { class: 'hint', text: ' ' + (last.rel || ago(last.at)) })] : '—'));
          }))),
        R.sites.filter((s) => s.error).length ? h('details', { class: 'r2-more' }, h('summary', { text: R.sites.filter((s) => s.error).length + ' webs sin encontrar en Google' }), h('ul', { class: 'cl-ul' }, R.sites.filter((s) => s.error).map((s) => h('li', { text: s.name + ': ' + s.error })))) : null,
        R.sites.filter((s) => !s.error && !(s.places || []).length).length ? h('small', { class: 'hint', text: 'Sin local en Google con la misma web: ' + R.sites.filter((s) => !s.error && !(s.places || []).length).map((s) => s.name).join(', ') }) : null
      ),
    ];
  }

  // ================================================================ CLIENTES: VENCIMIENTOS
  function subForm(x) {
    window.casaForm(x ? 'Editar suscripción' : 'Nueva suscripción o renovación', [
      { key: 'name', label: 'Qué es', value: x?.name, placeholder: 'Hosting, plugin, Google Workspace, licencia…', required: true },
      { key: 'client', label: 'Cliente', value: x?.client, placeholder: 'Restaurante' },
      { key: 'date', label: 'Próxima fecha', type: 'date', value: x?.date || new Date().toLocaleDateString('sv'), required: true },
      { key: 'cycle', label: 'Se repite', type: 'select', value: x?.cycle || 'anual', options: [['mensual', 'Cada mes'], ['trimestral', 'Cada 3 meses'], ['anual', 'Cada año'], ['unico', 'Una sola vez']] },
      { key: 'amount', label: 'Monto (opcional)', type: 'number', value: x?.amount ?? '' },
      { key: 'currency', label: 'Moneda', value: x?.currency || 'USD' },
      { key: 'note', label: 'Nota', value: x?.note, placeholder: 'Quién la paga, dónde se renueva…' },
    ], (v) => {
      if (!v.name) return 'Ponle un nombre.';
      window.api.r132.subSave({ ...v, id: x?.id }).then(async () => { D.exp = await window.api.r132.expiries(); rr(); toast('Guardada. Te aviso 30 y 7 días antes.'); }).catch((e) => toast(errMsg(e), true));
    }, x ? () => window.api.r132.subDelete(x.id).then(async () => { D.exp = await window.api.r132.expiries(); rr(); }) : null);
  }
  function expiriesView() {
    if (!D.exp && !D.loading.exp) once('exp', async () => (D.exp = await window.api.r132.expiries()));
    const list = D.exp;
    if (!list) return h('p', { class: 'hint', text: 'Cargando…' });
    const months = {};
    for (const x of list) (months[x.date.slice(0, 7)] ||= []).push(x);
    const KIND = { dominio: 'Dominio', ssl: 'SSL', suscripcion: 'Suscripción' };
    const soon = list.filter((x) => x.left <= 30 && x.left >= 0 && x.kind !== 'ssl').length;
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Vencen en 30 días' }), h('dd', { class: soon ? 'rx-hot' : '', text: String(soon) })),
        h('div', {}, h('dt', { text: 'Ya vencidos' }), h('dd', { class: list.some((x) => x.left < 0) ? 'rx-hot' : '', text: String(list.filter((x) => x.left < 0).length) })),
        h('div', {}, h('dt', { text: 'Suscripciones anotadas' }), h('dd', { text: String(list.filter((x) => x.kind === 'suscripcion').length) }))
      ),
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn primary small', text: 'Añadir suscripción', onclick: () => subForm(null) }), h('span', { class: 'hint', text: 'Dominios y SSL salen solos de cada web. Las suscripciones de clientes (hosting, plugins, licencias…) las añades tú; te aviso 30 y 7 días antes.' })),
      list.length ? Object.entries(months).map(([m, items]) => h('section', { class: 'r2-month' },
        h('h3', { text: new Date(m + '-15').toLocaleDateString('es', { month: 'long', year: 'numeric' }) }),
        h('ul', { class: 'r2-list' }, items.map((x) => h('li', { class: 'r2-exp' + (x.left < 0 ? ' r2-bad' : x.left <= 7 ? ' r2-bad' : x.left <= 30 ? ' r2-warn' : ''), onclick: x.sub ? () => subForm(x.sub) : null, style: x.sub ? { cursor: 'pointer' } : null },
          h('span', { class: 'r2-exp-d' }, h('b', { text: dd(x.date) }), h('small', { class: x.left < 0 ? 'bad-t' : x.left <= 30 ? 'warn-t' : 'hint', text: x.left < 0 ? 'venció hace ' + -x.left + ' d' : x.left === 0 ? 'hoy' : 'en ' + x.left + ' d' })),
          tag(x.kind === 'suscripcion' ? 'warn' : x.kind === 'ssl' ? 'ok' : 'bad', KIND[x.kind]),
          h('span', {}, h('b', { text: x.title }), x.client ? h('small', { class: 'hint', text: ' · ' + x.client }) : null, x.note ? h('small', { class: 'hint r2-block', text: x.note }) : null)
        )))
      )) : h('p', { class: 'empty', text: 'Nada que venza. Pulsa «Revisar contenido y capturas» en Webs para leer los dominios.' }),
    ];
  }

  // ================================================================ CLIENTES: INCIDENTES
  function incForm(x) {
    const sites = (window.clientsData?.() || []).map((s) => [s.url, s.name]);
    window.casaForm(x?.auto ? 'Incidente de ' + x.name + ' · ' + dd(x.day) : x ? 'Editar incidente' : 'Nuevo incidente', [
      ...(x?.auto ? [] : [
        { key: 'url', label: 'Web', type: 'select', value: x?.url || sites[0]?.[0], options: sites.length ? sites : [['', 'Abre la pestaña Webs primero']] },
        { key: 'day', label: 'Día', type: 'date', value: x?.day || new Date().toLocaleDateString('sv') },
        { key: 'minutes', label: 'Minutos caída', type: 'number', value: x?.minutes || '' },
      ]),
      { key: 'cause', label: 'Causa', value: x?.cause, placeholder: 'Deploy roto, DNS, Vercel, hosting del cliente…' },
      { key: 'notes', label: 'Qué pasó y qué se hizo', type: 'textarea', value: x?.notes },
    ], (v) => {
      window.api.r132.incidentSave({ ...v, id: x?.id }).then(async () => { D.inc = await window.api.r132.incidents(); rr(); }).catch((e) => toast(errMsg(e), true));
    }, x && !x.auto ? () => window.api.r132.incidentDelete(x.id).then(async () => { D.inc = await window.api.r132.incidents(); rr(); }) : null);
  }
  function incidentsView() {
    if (!D.inc && !D.loading.inc) once('inc', async () => (D.inc = await window.api.r132.incidents()));
    const list = D.inc;
    if (!list) return h('p', { class: 'hint', text: 'Cargando…' });
    const month = new Date().toLocaleDateString('sv').slice(0, 7);
    const thisMonth = list.filter((x) => x.day.startsWith(month));
    const noCause = list.filter((x) => !x.cause).length;
    return [
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Caídas este mes' }), h('dd', { class: thisMonth.length ? 'rx-hot' : '', text: String(thisMonth.length) })),
        h('div', {}, h('dt', { text: 'Minutos caídas' }), h('dd', { text: String(thisMonth.reduce((a, x) => a + (x.minutes || 0), 0)) })),
        h('div', {}, h('dt', { text: 'Sin causa anotada' }), h('dd', { text: String(noCause) }))
      ),
      h('div', { class: 'toolbar flat' }, h('button', { class: 'btn subtle small', text: 'Añadir incidente', onclick: () => incForm(null) }), h('span', { class: 'hint', text: 'Las caídas que ve el monitor (cada 5 minutos) entran solas. Anota la causa o deja que Claude la redacte con los deploys de ese día.' })),
      list.length ? h('ul', { class: 'r2-list' }, list.map((x) => {
        const open = D.open['inc:' + x.id];
        return h('li', { class: x.cause ? '' : 'r2-warn' },
          h('div', { class: 'r2-inc-h', onclick: () => { D.open['inc:' + x.id] = !open; rr(); } },
            h('span', { class: 'r2-exp-d' }, h('b', { text: dd(x.day) }), h('small', { class: 'hint', text: '~' + x.minutes + ' min' })),
            h('span', {}, h('b', { text: x.name }), h('small', { class: 'hint r2-block', text: x.cause || (x.why ? 'Monitor: ' + x.why : 'Sin causa anotada') }))
          ),
          open ? [
            x.why && x.cause ? h('small', { class: 'hint', text: 'Monitor: ' + x.why }) : null,
            x.notes ? h('pre', { class: 'r2-notes', text: x.notes }) : null,
            h('div', { class: 'row' },
              h('button', { class: 'btn subtle small', text: 'Editar', onclick: () => incForm(x) }),
              h('button', { class: 'btn ghost small', disabled: D.loading['draft:' + x.id], text: D.loading['draft:' + x.id] ? 'Redactando…' : 'Redactar causa y análisis', onclick: () => once('draft:' + x.id, async () => { await window.api.r132.incidentDraft(x.id); D.inc = await window.api.r132.incidents(); }) }),
              h('button', { class: 'btn ghost small', text: 'Copiar', onclick: () => navigator.clipboard.writeText(x.name + ' — ' + x.day + ' (~' + x.minutes + ' min)\nCausa: ' + (x.cause || 'sin anotar') + (x.notes ? '\n\n' + x.notes : '')).then(() => toast('Copiado.')) })
            ),
          ] : null
        );
      })) : h('p', { class: 'ok-t', text: 'Sin caídas registradas en los últimos dos meses.' }),
    ];
  }

  // ================================================================ CLIENTES: PESTAÑAS
  const baseClients = window.clientsTab;
  window.clientsTab = (r) => {
    hook(r);
    const SUB = [['webs', 'Webs'], ['resenas', 'Reseñas'], ['vencimientos', 'Vencimientos'], ['incidentes', 'Incidentes']];
    return [
      h('div', { class: 'seg r2-sub', role: 'tablist' }, SUB.map(([k, l]) => h('button', { class: D.sub === k ? 'on' : '', 'data-r2sub': k, role: 'tab', 'aria-selected': String(D.sub === k), text: l, onclick: () => { D.sub = k; if (k === 'vencimientos') D.exp = null; if (k === 'incidentes') D.inc = null; rr(); } }))),
      D.sub === 'resenas' ? reviewsView() : D.sub === 'vencimientos' ? expiriesView() : D.sub === 'incidentes' ? incidentsView() : baseClients(r),
    ];
  };

  // ================================================================ FICHA DE CLIENTE (en cada web)
  function contactForm(s) {
    const c = s.client?.contact || {};
    window.casaForm('Contacto de ' + s.name, [
      { key: 'name', label: 'Nombre', value: c.name },
      { key: 'role', label: 'Cargo', value: c.role, placeholder: 'Dueño, gerente, marketing…' },
      { key: 'email', label: 'Correo', type: 'email', value: c.email },
      { key: 'phone', label: 'Teléfono / WhatsApp', value: c.phone },
      { key: 'notes', label: 'Notas', type: 'textarea', value: c.notes, placeholder: 'Cómo prefiere que le escriban, horarios, accesos que tiene…' },
    ], (v) => {
      window.api.r132.contactSave(s.url, v).then(() => window.api.sites.get()).then(() => { toast('Contacto guardado.'); window.clientsReload?.(); }).catch((e) => toast(errMsg(e), true));
    });
  }
  function cardExtra(s) {
    const c = s.client || {};
    const ct = c.contact;
    const vp = c.vercel;
    const dep = (d, label) => d && h('p', {}, h('b', { class: d.state === 'ERROR' ? 'bad-t' : d.state === 'READY' ? 'ok-t' : 'warn-t', text: label + ': ' + (d.state === 'READY' ? 'listo' : d.state === 'ERROR' ? 'falló' : String(d.state || '').toLowerCase()) }), h('small', { class: 'hint', text: ' ' + ago(d.at) + (d.author ? ' · ' + d.author : '') + (d.commit ? ' · «' + d.commit.slice(0, 70) + '»' : '') }));
    return [
      h('section', {}, h('div', { class: 'gd-head' }, h('h4', { text: 'Contacto del cliente' }), h('button', { class: 'link-btn', text: ct ? 'Editar' : 'Añadir', onclick: (e) => { e.stopPropagation(); contactForm(s); } })),
        ct ? [h('p', {}, h('b', { text: ct.name || '—' }), ct.role ? h('small', { class: 'hint', text: ' · ' + ct.role }) : null), ct.email ? h('p', {}, h('button', { class: 'link-btn', text: ct.email, onclick: () => window.api.open('mailto:' + ct.email) })) : null, ct.phone ? h('p', { text: ct.phone }) : null, ct.notes ? h('small', { class: 'hint', text: ct.notes }) : null] : h('p', { class: 'hint', text: 'Sin contacto anotado.' })),
      h('section', {}, h('h4', { text: 'Tickets abiertos' }),
        c.tickets?.length ? h('ul', { class: 'cl-ul' }, c.tickets.map((t) => h('li', {}, h('button', { class: 'link-btn' + (t.late ? ' bad-t' : ''), text: t.title, onclick: () => window.api.open(t.url) }), h('small', { class: 'hint', text: [t.status, t.deadline ? (t.late ? 'venció ' : 'vence ') + dd(t.deadline) : null, t.who].filter(Boolean).join(' · ') })))) : h('p', { class: 'hint', text: 'Ningún ticket abierto con su nombre (de los tuyos y los de los líderes).' })),
      h('section', {}, h('h4', { text: 'Pipeline y deploys' }),
        c.pipe ? h('p', {}, h('button', { class: 'link-btn', text: c.pipe.status, onclick: () => window.api.open(c.pipe.url) }), h('small', { class: 'hint', text: [c.pipe.clientStatus, c.pipe.squad].filter(Boolean).map((x) => ' · ' + x).join('') })) : h('p', { class: 'hint', text: 'No está en el pipeline de Notion.' }),
        vp ? [dep(vp.production, 'Producción'), vp.latest && vp.latest.id !== vp.production?.id ? dep(vp.latest, 'Último (' + (vp.latest.target === 'production' ? 'producción' : vp.latest.branch || 'preview') + ')') : null, vp.production?.inspector ? h('button', { class: 'btn subtle small', text: 'Abrir en Vercel', onclick: () => window.api.open(vp.production.inspector) }) : null] : h('p', { class: 'hint', text: 'Sin proyecto de Vercel con este dominio.' })),
    ];
  }

  window.devTab = devTab;
  window.infraTab = infraTab;
  window.v132 = { cardExtra };
})();

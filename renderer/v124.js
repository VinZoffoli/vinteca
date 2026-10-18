'use strict';
// 1.24: la semana del equipo en Websites → Squads. Qué trabajó cada responsable
// y en qué seguirá, con GitHub, Vercel y Notion (una sola lectura con tu cuenta).
(function () {
  const W = { data: null, busy: false, err: null, tried: false, auto: false, rerender: null };
  const COLORS = { a: '#7be0a5', b: '#5fd8e8', c: '#f5b942', d: '#f07ab8' };
  const dShort = (t) => new Date(t).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  async function load() {
    W.tried = true;
    try {
      W.data = await window.api.teamWeek.get();
    } catch {}
    // se prepara solo una vez por sesión si no hay uno de las últimas 12 horas
    if (!W.auto && (!W.data || Date.now() - W.data.at > 12 * 3600000)) {
      W.auto = true;
      run();
    }
    W.rerender?.();
  }
  async function run() {
    W.busy = true;
    W.err = null;
    W.rerender?.();
    try {
      W.data = await window.api.teamWeek.run();
    } catch (e) {
      W.err = errMsg(e);
    }
    W.busy = false;
    W.rerender?.();
  }
  const list = (items, cls) => (items?.length ? h('ul', { class: 'tw-list ' + (cls || '') }, items.map((x) => h('li', { text: x }))) : null);
  function person(p, ai) {
    const n = p.notion;
    const stats = [
      [p.commits, 'commits'],
      W.data?.sources?.vercel ? [p.deploys, 'deploys'] : null,
      n ? [n.closed.length, 'tickets cerrados'] : null,
      p.failed.length ? [p.failed.length, 'deploys fallidos', 'bad'] : null,
    ].filter(Boolean);
    return h('article', { class: 'tw-person', style: { '--sq': COLORS[p.squad] || 'var(--muted)' } },
      h('header', {}, h('span', { class: 'tw-badge', text: p.squad.toUpperCase() }), h('div', {}, h('b', { text: p.name }), h('small', { class: 'hint', text: p.repos.slice(0, 3).map((r) => r.repo.replace(/^website-[a-d]-/, '')).join(', ') || 'Sin commits esta semana' }))),
      h('div', { class: 'tw-stats' }, stats.map(([v, l, c]) => h('div', { class: c || '' }, h('b', { text: String(v) }), h('span', { text: l })))),
      ai
        ? [h('p', { class: 'tw-h', text: 'Esta semana' }), list(ai.week), h('p', { class: 'tw-h', text: 'La próxima, probablemente' }), list(ai.next, 'next'), ai.watch?.length ? [h('p', { class: 'tw-h', text: 'Para vigilar' }), list(ai.watch, 'watch')] : null]
        : [
            h('p', { class: 'tw-h', text: 'Dónde hizo commits' }),
            list(p.repos.slice(0, 5).map((r) => r.repo.replace(/^website-/, '') + ' · ' + r.commits)),
            n?.next?.length ? [h('p', { class: 'tw-h', text: 'Vence pronto' }), list(n.next.map((t) => t.title + ' · ' + t.deadline.slice(5).split('-').reverse().join('/')), 'next')] : null,
          ]
    );
  }
  function block(rerender) {
    W.rerender = rerender;
    if (!W.tried) setTimeout(load, 0);
    const d = W.data;
    const byKey = Object.fromEntries((d?.ai?.people || []).map((x) => [String(x.squad).toLowerCase(), x]));
    return h('section', { class: 'tw' },
      h('div', { class: 'tw-head' },
        h('div', {},
          h('h2', { class: 'section-h', text: 'La semana del equipo' }),
          h('p', { class: 'hint', text: d ? 'Desde el ' + dShort(d.since) + ' · ' + d.totals.commits + ' commits en ' + d.totals.repos + ' repos, ' + d.totals.deploys + ' deploys · preparado ' + relTime(d.at / 1000) : 'Qué trabajó cada responsable y en qué seguirá, con GitHub, Vercel y los tickets de Notion.' })
        ),
        h('button', { class: d ? 'btn ghost small' : 'btn primary small', disabled: W.busy, text: W.busy ? 'Preparando…' : d ? 'Volver a preparar' : 'Preparar', onclick: run })
      ),
      W.busy && !d ? h('div', { class: 'ai-wait' }, h('span', { class: 'as-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Leyendo GitHub, Vercel y Notion, y escribiendo el resumen. Tarda uno o dos minutos.' })) : null,
      W.err ? h('p', { class: 'hint bad', text: W.err }) : null,
      d?.errors?.length ? h('p', { class: 'hint', text: 'No se pudo leer: ' + d.errors.join(' · ') }) : null,
      d?.aiError ? h('p', { class: 'hint', text: 'Sin resumen escrito (' + d.aiError + '). Se muestran los datos.' }) : null,
      d?.ai?.team ? h('p', { class: 'tw-team', text: d.ai.team }) : null,
      d ? h('div', { class: 'tw-grid' }, d.people.map((p) => person(p, byKey[p.squad]))) : null,
      d?.others?.length ? h('p', { class: 'hint', text: 'También hicieron commits: ' + d.others.map((o) => o.login + ' (' + o.commits + ')').join(', ') }) : null
    );
  }
  window.teamWeekUI = { block };
})();

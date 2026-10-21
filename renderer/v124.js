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
  const list = (items, cls, links) => (items?.length ? h('ul', { class: 'tw-list ' + (cls || '') }, items.map((x, i) => h('li', {}, h('span', { text: x }), refChips(links?.[i])))) : null);
  // 1.32.1: los tickets, webs y ramas de cada frase, para abrirlos
  const KIND = { T: 'Ticket', W: 'Web', R: 'Rama' };
  function refChips(refs) {
    if (!refs?.length) return null;
    return h('span', { class: 'tw-refs' }, refs.map((r) => h('button', { class: 'tw-ref k-' + r.kind, title: (KIND[r.kind] || '') + ': ' + r.label + (r.status ? ' · ' + r.status : '') + (r.deadline ? ' · vence ' + r.deadline : ''), onclick: () => window.api.open(r.url) }, h('i', { text: KIND[r.kind] || '' }), h('span', { text: r.label }))));
  }
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ');
  const STOP = new Set(['para', 'with', 'from', 'that', 'this', 'pagina', 'paginas', 'website', 'landing', 'ticket', 'nueva', 'nuevo', 'cambios', 'ajustes', 'correcciones', 'general']);
  /** Resúmenes de antes de la 1.32.1 (sin códigos): se buscan los títulos de los tickets en cada frase. */
  function guessLinks(p, items) {
    const n = p.notion;
    const cands = [];
    const seen = new Set();
    for (const t of n ? [...(n.overdue || []), ...(n.next || []), ...(n.touched || []), ...(n.closed || [])] : []) if (t.url && !seen.has(t.url)) { seen.add(t.url); cands.push({ kind: 'T', label: t.title, url: t.url, status: t.status, deadline: t.deadline }); }
    for (const w of p.pipeline || []) if (w.url && !seen.has(w.url)) { seen.add(w.url); cands.push({ kind: 'W', label: w.name, url: w.url, status: w.status }); }
    return (items || []).map((text) => {
      const s = ' ' + norm(text) + ' ';
      return cands.filter((c) => {
        const title = norm(c.label).replace(/\s+/g, ' ').trim();
        if (title.length >= 6 && s.includes(' ' + title + ' ')) return true;
        const words = title.split(' ').filter((w) => w.length >= 4 && !STOP.has(w));
        return words.length >= 2 && words.filter((w) => s.includes(' ' + w)).length / words.length >= 0.75;
      }).slice(0, 3);
    });
  }
  function person(p, ai) {
    const links = ai ? Object.fromEntries(['week', 'next', 'watch'].map((k) => [k, ai.links?.[k] || guessLinks(p, ai[k])])) : {};
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
        ? [h('p', { class: 'tw-h', text: 'Esta semana' }), list(ai.week, '', links.week), h('p', { class: 'tw-h', text: 'La próxima, probablemente' }), list(ai.next, 'next', links.next), ai.watch?.length ? [h('p', { class: 'tw-h', text: 'Para vigilar' }), list(ai.watch, 'watch', links.watch)] : null]
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
      d?.stale?.length ? h('section', { class: 'tw-extra' }, h('h3', { text: 'Ramas olvidadas (' + d.stale.length + ')' }), h('p', { class: 'hint', text: 'Commits que llevan más de una semana sin pasar a main.' }), h('ul', { class: 'tw-rows' }, d.stale.map((b) => h('li', {}, h('span', { class: 'tw-badge sm', style: { '--sq': COLORS[b.squad] || 'var(--muted)' }, text: (b.squad || '·').toUpperCase() }), h('button', { class: 'link-btn', text: b.repo.replace(/^website-[a-d]-/, '') + ' / ' + b.branch, title: b.msg, onclick: () => window.api.open(b.pr || b.url) }), h('small', { class: 'hint', text: b.login + ' · ' + b.ahead + ' commits · ' + relTime(b.at / 1000) + (b.pr ? ' · PR abierto' : '') }))))) : null,
      d?.noTicket?.length ? h('section', { class: 'tw-extra' }, h('h3', { text: 'Trabajo sin ticket en Notion' }), h('ul', { class: 'tw-rows' }, d.noTicket.map((x) => h('li', {}, h('span', { class: 'tw-badge sm', style: { '--sq': COLORS[x.squad] || 'var(--muted)' }, text: (x.squad || '·').toUpperCase() }), h('b', { text: x.repo.replace(/^website-[a-d]-/, '') }), h('small', { class: 'hint', text: x.commits + ' commits esta semana de ' + x.who.join(', ') + ' · no aparece en ningún ticket' }))))) : null,
      d?.others?.length ? h('p', { class: 'hint', text: 'También hicieron commits: ' + d.others.map((o) => o.login + ' (' + o.commits + ')').join(', ') }) : null
    );
  }
  window.teamWeekUI = { block, data: () => W.data };
})();

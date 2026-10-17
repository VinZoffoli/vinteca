'use strict';
// ViperTech → LinkedIn: buscar ofertas con tus preferencias, las recomendadas
// para tu cuenta y el estado de tus postulaciones.
(function () {
  const api = window.api.linkedin;
  const L = { st: null, tab: 'search', busy: null, error: null, details: {}, open: null, prefsOpen: false, filter: 'all' };
  const TRACK = [['saved', 'Guardada'], ['applied', 'Postulé'], ['viewed', 'La vieron'], ['interview', 'Entrevista'], ['offer', 'Oferta'], ['rejected', 'No seleccionado']];
  const ST_ACC = { applied: ['Enviada', 'info'], viewed: ['La vieron', 'warn'], downloaded: ['Descargaron tu CV', 'ok'], rejected: ['No seleccionado', 'muted'], closed: ['Cerrada', 'muted'] };
  const PERIOD = [['r86400', 'Último día'], ['r604800', 'Última semana'], ['r2592000', 'Último mes']];
  const MODE = [['2', 'Remoto'], ['3', 'Híbrido'], ['1', 'Presencial']];
  api.onProgress((t) => {
    L.busy = t;
    render();
  });

  async function show() {
    if (!L.st) L.st = await api.state();
    render();
  }
  async function search() {
    L.busy = 'Buscando en LinkedIn…';
    L.error = null;
    render();
    try {
      const last = await api.search();
      L.st.last = last;
      toast(`${plural(last.list.length, 'oferta', 'ofertas')} del ${PERIOD.find((p) => p[0] === L.st.prefs.period)?.[1].toLowerCase() || 'último mes'}${last.limited ? ' (LinkedIn cortó la búsqueda antes de terminar)' : ''}.`);
    } catch (e) {
      L.error = errMsg(e);
    }
    L.busy = null;
    render();
  }
  async function readAccount(which) {
    L.busy = which === 'applied' ? 'Leyendo tus postulaciones de LinkedIn…' : 'Leyendo las ofertas recomendadas para ti…';
    L.error = null;
    render();
    try {
      const r = await api.readAccount(which);
      if (r.login) {
        L.error = 'Para traerlas a ViperTeca, inicia sesión en LinkedIn en la ventana que se abrió y vuelve a pulsar «Traerlas a ViperTeca». Si prefieres no hacerlo, usa el botón rojo para verlas en Brave.';
        api.openAccount();
      } else L.st.account = { ...L.st.account, [which]: r };
    } catch (e) {
      L.error = errMsg(e);
    }
    L.busy = null;
    render();
  }
  async function toggleDetail(j) {
    if (L.open === j.id) {
      L.open = null;
      return render();
    }
    L.open = j.id;
    render();
    if (!L.details[j.id]) {
      try {
        L.details[j.id] = await api.detail(j.id);
      } catch (e) {
        L.details[j.id] = { error: errMsg(e) };
      }
      render();
    }
  }
  async function setTrack(j, status) {
    L.st.tracked = await api.track(j, status);
    render();
  }

  function prefsBox() {
    const p = L.st.prefs;
    const kw = h('input', { class: 'rx-input', value: p.keywords.join(', '), 'aria-label': 'Palabras clave' });
    const loc = h('input', { class: 'rx-input', value: p.locations.join(', '), 'aria-label': 'Lugares' });
    const per = h('select', { class: 'sn-select', 'aria-label': 'Publicadas' }, PERIOD.map(([v, t]) => h('option', { value: v, text: t, selected: p.period === v })));
    const modes = MODE.map(([v, t]) => h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', value: v, checked: p.remote.includes(v) }), h('span', { text: t })));
    const rel = h('input', { type: 'checkbox', checked: p.related });
    const save = async () => {
      L.st.prefs = await api.savePrefs({ keywords: kw.value, locations: loc.value, period: per.value, remote: modes.map((m) => m.querySelector('input')).filter((i) => i.checked).map((i) => i.value), related: rel.checked });
      L.prefsOpen = false;
      toast('Preferencias guardadas.');
      render();
    };
    return h('section', { class: 'rx-card li-prefs' },
      h('h3', { text: 'Tus preferencias' }),
      h('label', { class: 'ks-field' }, h('span', { text: 'Puestos o tecnologías (separados por comas)' }), kw),
      h('label', { class: 'ks-field' }, h('span', { text: 'Lugares (por ejemplo: Costa Rica, Latinoamérica, United States)' }), loc),
      h('div', { class: 'rx-row' }, h('span', { class: 'hint', text: 'Modalidad:' }), modes, h('span', { class: 'hint', text: 'Publicadas:' }), per),
      h('label', { class: 'rx-check' }, rel, h('span', { text: 'Ocultar ofertas que no son de desarrollo (LinkedIn mezcla resultados)' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', text: 'Cancelar', onclick: () => { L.prefsOpen = false; render(); } }), h('button', { class: 'btn primary', text: 'Guardar', onclick: save }))
    );
  }

  function jobCard(j, extra) {
    const t = L.st.tracked?.[j.id];
    const open = L.open === j.id;
    const d = L.details[j.id];
    return h('article', { class: `wk-card li-card ${open ? 'open' : ''} ${t ? 'tracked' : ''}` },
      h('div', { class: 'li-top' },
        j.logo ? h('img', { class: 'li-logo', src: j.logo, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : h('span', { class: 'li-logo ph', text: (j.company || '?').slice(0, 1) }),
        h('div', { class: 'wk-main' },
          h('h3', {}, h('button', { class: 'link-title', text: j.title, onclick: () => toggleDetail(j) })),
          h('p', { class: 'wk-meta' }, h('span', { text: j.company }), j.location && h('span', { text: j.location }), (j.ago || j.date) && h('span', { text: j.ago || j.date }), j.salary && h('span', { class: 'li-sal', text: j.salary }), j.isNew && h('span', { class: 'rx-tag new', text: 'Nueva' }), extra)
        ),
        h('div', { class: 'li-act' },
          h('select', { class: 'sn-select', 'aria-label': 'Seguimiento', onchange: (e) => setTrack(j, e.target.value || null) }, h('option', { value: '', text: t ? 'Quitar seguimiento' : 'Seguimiento…' }), TRACK.map(([v, l]) => h('option', { value: v, text: l, selected: t?.status === v }))),
          h('button', { class: 'btn primary small', text: 'Abrir en Brave', onclick: () => api.openBrave(j.url) })
        )
      ),
      open && h('div', { class: 'li-detail' },
        !d ? h('p', { class: 'hint', text: 'Cargando la oferta…' })
          : d.error ? h('p', { class: 'hint bad', text: d.error })
          : [
              h('p', { class: 'wk-meta' }, [d.applicants, d.type, d.seniority, d.functions].filter(Boolean).map((x) => h('span', { text: x }))),
              h('p', { class: 'li-desc', text: d.description || 'Sin descripción.' }),
            ]
      )
    );
  }

  function searchTab() {
    const last = L.st.last;
    const p = L.st.prefs;
    const list = (last?.list || []).filter((j) => L.filter === 'all' || (L.filter === 'new' ? j.isNew : !!L.st.tracked?.[j.id]));
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary', text: L.busy ? 'Buscando…' : 'Buscar ofertas', disabled: !!L.busy, onclick: search }),
        h('button', { class: 'btn ghost small', text: 'Preferencias', onclick: () => { L.prefsOpen = !L.prefsOpen; render(); } }),
        h('span', { class: 'hint', text: `${p.keywords.join(', ')} · ${p.locations.join(', ') || 'cualquier lugar'} · ${p.remote.map((r) => MODE.find((m) => m[0] === r)?.[1]).join('/') || 'cualquier modalidad'} · ${PERIOD.find((x) => x[0] === p.period)?.[1]}` })
      ),
      L.prefsOpen && prefsBox(),
      last && h('div', { class: 'row wk-filters' },
        h('div', { class: 'seg' }, [['all', 'Todas'], ['new', 'Nuevas'], ['tracked', 'Con seguimiento']].map(([k, t]) => h('button', { class: L.filter === k ? 'on' : '', text: t, onclick: () => { L.filter = k; render(); } }))),
        h('span', { class: 'hint', text: `Búsqueda de ${relTime(last.at / 1000)}: ${plural(last.list.length, 'oferta', 'ofertas')}${last.list.filter((j) => j.isNew).length ? `, ${last.list.filter((j) => j.isNew).length} nuevas` : ''}.` })
      ),
      !last ? h('p', { class: 'empty' }, h('b', { text: 'Pulsa «Buscar ofertas»' }), 'Busca en LinkedIn las ofertas publicadas en el último mes con tus preferencias. No usa tu cuenta.')
        : list.length ? h('div', { class: 'wk-list' }, list.map((j) => jobCard(j))) : h('p', { class: 'hint', text: 'No hay ofertas en este filtro.' }),
    ];
  }

  function accountTab(which) {
    const acc = L.st.account?.[which];
    const isApplied = which === 'applied';
    const items = (acc?.items || []).map((j) => ({ ...j, ...(isApplied ? {} : {}) }));
    const local = isApplied ? Object.values(L.st.tracked || {}).filter((t) => t.status !== 'saved' && !items.some((i) => i.id === t.id)) : [];
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary', text: isApplied ? 'Ver mis postulaciones en Brave' : 'Ver recomendadas en Brave', onclick: () => api.openBrave(isApplied ? 'https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED' : 'https://www.linkedin.com/jobs/collections/recommended/') }),
        h('button', { class: 'btn ghost small', text: L.busy ? 'Leyendo…' : 'Traerlas a ViperTeca', disabled: !!L.busy, onclick: () => readAccount(which) }),
        acc && h('span', { class: 'hint', text: `Leído ${relTime(acc.at / 1000)}.` })
      ),
      h('p', { class: 'hint', text: isApplied ? 'El botón rojo abre «Mis empleos → Solicitados» en Brave, donde ya tienes la sesión. Para verlas aquí, con su estado, usa «Traerlas a ViperTeca»: como la app no puede usar la sesión de Brave, la primera vez te pide entrar a LinkedIn en una ventana propia.' : 'El botón rojo abre en Brave las ofertas que LinkedIn te recomienda. «Traerlas a ViperTeca» las lee con una sesión propia de la app (la primera vez entras tú).' }),
      items.length
        ? [isApplied && h('dl', { class: 'stat-strip rx-stats' },
            h('div', {}, h('dt', { text: 'Postulaciones' }), h('dd', { text: String(items.length) })),
            h('div', {}, h('dt', { text: 'Las vieron' }), h('dd', { text: String(items.filter((i) => ['viewed', 'downloaded'].includes(i.status)).length) })),
            h('div', {}, h('dt', { text: 'Descargaron tu CV' }), h('dd', { text: String(items.filter((i) => i.status === 'downloaded').length) })),
            h('div', {}, h('dt', { text: 'Cerradas o descartadas' }), h('dd', { text: String(items.filter((i) => ['closed', 'rejected'].includes(i.status)).length) }))
          ),
          h('div', { class: 'wk-list' }, items.map((j) => jobCard(j, j.status ? h('span', { class: `rx-repo-state ${ST_ACC[j.status]?.[1] || ''}`, text: j.statusText || ST_ACC[j.status]?.[0] }) : null)))]
        : acc ? h('p', { class: 'empty', text: isApplied ? 'No encontré postulaciones en tu cuenta.' : 'No encontré recomendaciones.' }) : null,
      local.length ? [h('h3', { class: 'rx-sec', text: 'Marcadas por ti en ViperTeca' }), h('div', { class: 'wk-list' }, local.map((j) => jobCard(j, h('span', { class: 'rx-repo-state info', text: TRACK.find((t) => t[0] === j.status)?.[1] }))))] : null,
    ];
  }

  function render() {
    const body = $('#linkedinBody');
    if (!body || $('#linkedinView').hidden || !L.st) return;
    const nTracked = Object.keys(L.st.tracked || {}).length;
    fill(body,
      h('div', { class: 'seg rx-tabs', role: 'tablist' },
        [['search', 'Buscar ofertas'], ['recommended', 'Recomendadas para ti'], ['applied', `Mis postulaciones${nTracked ? ` (${nTracked})` : ''}`]].map(([k, t]) => h('button', { class: L.tab === k ? 'on' : '', role: 'tab', 'aria-selected': String(L.tab === k), text: t, onclick: () => { L.tab = k; L.error = null; render(); } }))),
      L.busy && h('p', { class: 'hint', text: L.busy }),
      L.error && h('p', { class: 'hint bad', text: L.error }),
      L.tab === 'search' ? searchTab() : accountTab(L.tab),
      h('p', { class: 'hint wk-note', text: 'ViperTeca no postula ni escribe en LinkedIn: buscas aquí, abres la oferta en Brave y te postulas tú.' })
    );
  }

  window.linkedinUI = { show };
})();

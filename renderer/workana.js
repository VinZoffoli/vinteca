'use strict';
// Workana dentro de ViperTeca: buscar proyectos, leer un comentario de cada uno
// (qué piden, presupuesto, competencia y cliente), poner tu precio y obtener la
// propuesta lista. La app no postula por ti: copias la propuesta, se abre el
// proyecto en tu navegador y lo envías tú.
(function () {
  const api = window.api.workana;
  const W = { state: null, busy: null, list: null, filter: 'pending', sort: 'new', prices: {}, open: null, drafts: {}, problems: {} };
  const PUBS = [['1d', 'Último día'], ['3d', 'Últimos 3 días'], ['1w', 'Última semana'], ['1m', 'Último mes']];
  const visible = () => !$('#workanaView').hidden;

  api.onProgress((t) => {
    W.busy = t;
    render();
  });

  async function show() {
    if (!W.state) {
      W.state = await api.state();
      W.list = W.state.last?.list || null;
      $('#wkOpenDash').addEventListener('click', () => window.api.open('https://www.workana.com/dashboard'));
    }
    render();
  }

  async function search() {
    W.busy = 'Abriendo Workana…';
    render();
    try {
      const r = await api.search({ queries: W.state.queries, publication: W.state.publication });
      W.list = r.list;
      W.state.last = r;
      toast(`${plural(r.list.length, 'proyecto encontrado', 'proyectos encontrados')}.`);
    } catch (e) {
      toast(errMsg(e), true);
    }
    W.busy = null;
    render();
  }

  // ---- comentario de cada proyecto ----
  function comment(p) {
    const t = `${p.title} ${p.description}`.toLowerCase();
    const what = /tienda|e-?commerce|woocommerce|shopify/.test(t) ? 'Tienda online'
      : /landing/.test(t) ? 'Landing page'
      : /redise[ñn]o|migra/.test(t) ? 'Rediseño de un sitio existente'
      : /error|arreglar|corregir|soporte|mantenimiento|lento/.test(t) ? 'Arreglo o mantenimiento'
      : /blog/.test(t) ? 'Blog o sitio de contenido'
      : 'Sitio web';
    const tech = [/elementor/.test(t) && 'Elementor', /woocommerce/.test(t) && 'WooCommerce', /wordpress/.test(t) && 'WordPress', /shopify/.test(t) && 'Shopify', /react|next\.?js/.test(t) && 'React/Nextjs', /figma/.test(t) && 'Figma'].filter(Boolean);
    const asks = [/pasarela|pago/.test(t) && 'pagos en línea', /whatsapp|wsp/.test(t) && 'botón de chat', /reserva|cita|agenda/.test(t) && 'reservas', /idioma|biling/.test(t) && 'varios idiomas', /seo|posicionamiento/.test(t) && 'SEO', /velocidad|r[aá]pid/.test(t) && 'velocidad', /pdf|borrador|maqueta|mockup|figma/.test(t) && 'diseño ya hecho para maquetar', /inteligencia artificial|\bia\b/.test(t) && 'algo de IA'].filter(Boolean);
    const comp = p.bids >= 80 ? ['hot', 'mucha competencia'] : p.bids >= 30 ? ['warm', 'competencia media'] : ['ok', 'poca competencia'];
    const client = p.verified ? (p.rating ? `cliente con pago verificado y ${p.rating.toFixed(1)} de valoración` : 'cliente con pago verificado, sin valoraciones aún') : 'cliente sin pago verificado';
    return { what, tech, asks, comp, client };
  }

  const budgetTxt = (b) => (b ? `${b.text}` : 'Sin presupuesto');
  const budgetNum = (b) => (b?.max ?? b?.min ?? 0);

  async function prepare(p) {
    const price = String(W.prices[p.slug] || '').trim();
    if (!price) return toast('Escribe primero tu precio para este proyecto.', true);
    const r = await api.build(p);
    W.drafts[p.slug] = r.text;
    W.refs = { ...(W.refs || {}), [p.slug]: r.references };
    W.problems[p.slug] = r.problems;
    W.open = p.slug;
    render();
  }

  async function markDone(p, done) {
    const d = { ...(W.state.done || {}) };
    if (done) d[p.slug] = { at: Date.now(), price: W.prices[p.slug] || null, title: p.title };
    else delete d[p.slug];
    W.state = await api.saveState({ done: d });
    render();
  }

  // Postular: ventana de Workana con propuesta y precio puestos; Enviar lo pulsas tú
  const BID_MSG = {
    login: 'Inicia sesión en Workana en la ventana que se abrió. Después la propuesta se rellena sola.',
    go: 'Abriendo el formulario de propuesta…',
    filled: 'Propuesta y precio puestos. Revisa en la ventana de Workana y pulsa Enviar.',
    'filled-text': 'Propuesta puesta. Escribe el precio en la ventana de Workana, revisa y pulsa Enviar.',
  };
  W.bid = {};
  api.onBidState(({ slug, state }) => {
    W.bid[slug] = { state, open: true };
    if (BID_MSG[state]) toast(BID_MSG[state]);
    render();
  });
  api.onBidClosed(({ slug, state }) => {
    W.bid[slug] = { state, open: false, ask: /^filled/.test(state || '') };
    render();
  });
  async function postular(p) {
    const text = W.drafts[p.slug];
    const probs = await api.check(text);
    if (probs.length) {
      W.problems[p.slug] = probs;
      render();
      return toast('La propuesta tiene cosas que Workana no permite: corrígelas antes de postular.', true);
    }
    try {
      await api.bid({ url: p.url, slug: p.slug, text, price: W.prices[p.slug] });
      W.bid[p.slug] = { state: 'opening', open: true };
      render();
    } catch (e) {
      toast(errMsg(e), true);
    }
  }

  async function copyAndOpen(p) {
    const text = W.drafts[p.slug];
    const probs = await api.check(text);
    if (probs.length) {
      W.problems[p.slug] = probs;
      render();
      return toast('La propuesta tiene cosas que Workana no permite: corrígelas antes de copiarla.', true);
    }
    await api.copy(text);
    window.api.open(p.url);
    toast(`Propuesta copiada. Pégala en Workana y pon ${W.prices[p.slug]} como precio.`);
  }

  // ---- vista ----
  function render() {
    const box = $('#workanaBody');
    const pending = (W.list || []).filter((p) => !W.state?.done?.[p.slug]).length;
    $('#countWorkana').textContent = pending || '';
    if (!box || !visible() || !W.state) return;
    const qInput = h('input', { type: 'text', class: 'wk-q', value: W.state.queries.join(', '), 'aria-label': 'Palabras para buscar, separadas por comas' });
    qInput.addEventListener('change', async () => {
      W.state = await api.saveState({ queries: qInput.value.split(',').map((s) => s.trim()).filter(Boolean) });
    });
    const pub = h('select', { 'aria-label': 'Publicados', onchange: async (e) => (W.state = await api.saveState({ publication: e.target.value })) }, PUBS.map(([v, t]) => h('option', { value: v, text: t, selected: W.state.publication === v })));
    let list = [...(W.list || [])];
    const done = W.state.done || {};
    if (W.filter === 'pending') list = list.filter((p) => !done[p.slug]);
    if (W.filter === 'done') list = list.filter((p) => done[p.slug]);
    if (W.filter === 'verified') list = list.filter((p) => p.verified && !done[p.slug]);
    if (W.sort === 'budget') list.sort((a, b) => budgetNum(b.budget) - budgetNum(a.budget));
    else if (W.sort === 'bids') list.sort((a, b) => a.bids - b.bids);
    else list.sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')));
    fill(
      box,
      h(
        'div',
        { class: 'wk-bar' },
        h('label', { class: 'lux-field wk-qf' }, h('span', { text: 'Buscar (separa con comas)' }), qInput),
        h('label', { class: 'lux-field' }, h('span', { text: 'Publicados' }), pub),
        h('button', { class: 'btn primary', disabled: !!W.busy, text: W.busy ? 'Buscando…' : 'Buscar', onclick: search })
      ),
      W.busy && h('p', { class: 'hint', text: W.busy }),
      W.list &&
        h(
          'div',
          { class: 'row wk-filters' },
          h('div', { class: 'seg' }, [['pending', 'Por postular'], ['verified', 'Pago verificado'], ['done', 'Postulados'], ['all', 'Todos']].map(([k, t]) => h('button', { class: W.filter === k ? 'on' : '', text: t, onclick: () => { W.filter = k; render(); } }))),
          h('div', { class: 'seg' }, [['new', 'Más nuevos'], ['budget', 'Mayor presupuesto'], ['bids', 'Menos propuestas']].map(([k, t]) => h('button', { class: W.sort === k ? 'on' : '', text: t, onclick: () => { W.sort = k; render(); } }))),
          W.state.last?.at && h('span', { class: 'hint', text: `Búsqueda de ${relTime(W.state.last.at / 1000)}, ${plural(W.list.length, 'proyecto', 'proyectos')}` })
        ),
      !W.list
        ? h('div', { class: 'empty' }, h('b', { text: 'Pulsa «Buscar»' }), 'La app mira los proyectos nuevos de Workana con tus palabras clave y te los comenta uno por uno.')
        : list.length
          ? h('div', { class: 'wk-list' }, list.map(card))
          : h('p', { class: 'hint', text: W.filter === 'done' ? 'Aún no has marcado ninguno como postulado.' : 'No hay proyectos en este filtro.' }),
      h('p', { class: 'hint wk-note', text: 'ViperTeca no envía propuestas por ti (Workana no permite postular con programas automáticos): la deja lista y copiada, abre el proyecto en tu navegador y la envías tú.' })
    );
  }

  function card(p) {
    const c = comment(p);
    const isDone = !!W.state.done?.[p.slug];
    const open = W.open === p.slug && W.drafts[p.slug] != null;
    const price = h('input', { type: 'text', inputMode: 'decimal', class: 'wk-price', placeholder: p.budget?.currency || 'USD', value: W.prices[p.slug] || '', 'aria-label': `Tu precio para ${p.title}` });
    price.addEventListener('input', () => (W.prices[p.slug] = price.value));
    price.addEventListener('keydown', (e) => e.key === 'Enter' && prepare(p));
    return h(
      'article',
      { class: `wk-card${isDone ? ' done' : ''}${open ? ' open' : ''}` },
      h(
        'div',
        { class: 'wk-top' },
        h('div', { class: 'wk-main' }, h('h3', {}, h('button', { class: 'link-title', text: p.title, onclick: () => window.api.open(p.url) })), h('p', { class: 'wk-meta' }, h('span', { text: p.posted }), h('span', { text: p.country }), h('span', { class: `wk-comp ${c.comp[0]}`, text: `${p.bids} propuestas` }), p.urgent && h('span', { class: 'wk-urgent', text: 'Urgente' }))),
        h('div', { class: 'wk-budget' }, h('b', { text: budgetTxt(p.budget) }), h('span', { text: p.hourly ? 'por hora' : 'precio fijo' }))
      ),
      h(
        'div',
        { class: 'wk-comment' },
        h('p', {}, h('b', { text: `${c.what}${c.tech.length ? ` con ${c.tech.join(', ')}` : ''}. ` }), c.asks.length ? `Pide ${c.asks.join(', ')}. ` : '', `${c.client[0].toUpperCase()}${c.client.slice(1)}, ${c.comp[1]}.`),
        h('details', {}, h('summary', { text: 'Ver la descripción completa' }), h('p', { class: 'wk-desc', text: p.description }), p.meta && h('p', { class: 'hint', text: p.meta }))
      ),
      h(
        'div',
        { class: 'row wk-act' },
        h('label', { class: 'wk-price-l' }, h('span', { class: 'hint', text: 'Tu precio' }), price),
        h('button', { class: 'btn primary small', text: open ? 'Rehacer propuesta' : 'Preparar propuesta', onclick: () => prepare(p) }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: isDone, onchange: (e) => markDone(p, e.target.checked) }), 'Ya postulé')
      ),
      open && draftBox(p)
    );
  }

  function draftBox(p) {
    const ta = h('textarea', { class: 'note wk-draft', rows: 12, value: W.drafts[p.slug], 'aria-label': 'Propuesta' });
    let timer;
    ta.addEventListener('input', () => {
      W.drafts[p.slug] = ta.value;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        W.problems[p.slug] = await api.check(ta.value);
        const box = ta.parentElement?.querySelector('.wk-problems');
        if (box) fill(box, problemsList(p));
      }, 400);
    });
    return h(
      'div',
      { class: 'wk-draftbox' },
      h('p', { class: 'hint', text: `Referencias elegidas de tu perfil: ${(W.refs?.[p.slug] || []).join(' y ') || 'ninguna'}. Precio para poner en Workana: ${W.prices[p.slug]} ${p.budget?.currency || ''}.` }),
      ta,
      h('div', { class: 'wk-problems' }, problemsList(p)),
      W.bid?.[p.slug]?.ask && h('div', { class: 'notice' }, h('span', { text: '¿Enviaste la propuesta en Workana?' }), h('button', { class: 'btn primary small', text: 'Sí, marcar como postulado', onclick: () => { W.bid[p.slug].ask = false; markDone(p, true); } }), h('button', { class: 'btn subtle small', text: 'No', onclick: () => { W.bid[p.slug].ask = false; render(); } })),
      W.bid?.[p.slug]?.open && h('p', { class: 'hint', text: BID_MSG[W.bid[p.slug].state] || 'Abriendo Workana…' }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', text: 'Postular', onclick: () => postular(p) }),
        h('button', { class: 'btn ghost small', text: 'Copiar y abrir en el navegador', onclick: () => copyAndOpen(p) }),
        h('button', { class: 'btn ghost small', text: 'Solo copiar', onclick: async () => { const probs = await api.check(W.drafts[p.slug]); if (probs.length) return toast('Corrige primero lo marcado en rojo.', true); await api.copy(W.drafts[p.slug]); toast('Propuesta copiada.'); } })
      )
    );
  }

  function problemsList(p) {
    const probs = W.problems[p.slug] || [];
    if (!probs.length) return h('p', { class: 'hint ok', text: 'Cumple las reglas de Workana: sin enlaces (salvo tu línea de portafolio), sin números y sin datos de contacto.' });
    return [
      h('ul', { class: 'wk-bad' }, probs.map((x) => h('li', { text: `${x.why}: ${x.found.join(', ')}` }))),
      h('button', { class: 'btn ghost small', text: 'Corregir automáticamente', onclick: async () => { W.drafts[p.slug] = await api.clean(W.drafts[p.slug]); W.problems[p.slug] = await api.check(W.drafts[p.slug]); render(); } }),
    ];
  }

  window.workanaUI = { show };
})();

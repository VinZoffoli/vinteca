'use strict';
// Novedades → Anime: próximos estrenos (AniList) y tu calendario de anime.
(function () {
  const api = window.api.anime;
  const A = { data: null, busy: false, error: null, view: 'next', group: 'soon', q: '', results: null, searching: false, mine: null, calMonth: null, calView: 'list', open: null };
  const redraw = () => window.renderNews?.();
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DAY = 86400000;
  const today0 = () => new Date().setHours(0, 0, 0, 0);

  async function load(force) {
    if (A.busy) return;
    A.busy = true;
    redraw();
    try {
      [A.data, A.mine] = await Promise.all([api.upcoming(!!force), api.mine(!!force)]);
      A.error = null;
    } catch (e) {
      A.error = errMsg(e);
      A.mine ||= await api.mine(false).catch(() => ({ follows: {}, custom: [] }));
    }
    A.busy = false;
    redraw();
  }

  function dateLabel(a) {
    if (!a.start || a.precision === 'tba') return { text: 'Sin fecha', days: null };
    const d = new Date(a.start);
    if (a.precision === 'day') {
      const days = Math.round((a.start - today0()) / DAY);
      return { text: d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }), days };
    }
    if (a.precision === 'month') return { text: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, days: null };
    if (a.precision === 'season') return { text: a.season, days: null };
    return { text: String(d.getFullYear()), days: null };
  }
  const countdown = (days) => (days == null ? '' : days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : days > 0 ? `En ${days} días` : 'Ya salió');
  const following = (id) => !!A.mine?.follows?.[id];

  async function toggleFollow(a) {
    const on = !following(a.id);
    A.mine = await api.follow(a, on);
    toast(on ? `${a.title}: añadido a tu calendario.` : `${a.title}: quitado de tu calendario.`);
    redraw();
  }

  function card(a) {
    const dl = dateLabel(a);
    const on = following(a.id);
    const open = A.open === a.id;
    return h('article', { class: `an-card ${on ? 'on' : ''}`, style: a.color ? { '--an-c': a.color } : null },
      h('div', { class: 'an-cover' }, a.cover ? h('img', { src: a.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('span', { text: a.title }),
        h('span', { class: `an-date ${dl.days != null && dl.days >= 0 && dl.days <= 14 ? 'soon' : ''}` }, h('b', { text: dl.text }), dl.days != null && dl.days >= 0 && h('small', { text: countdown(dl.days) }))),
      h('div', { class: 'an-body' },
        h('h3', { text: a.title }),
        a.romaji && a.romaji !== a.title && h('p', { class: 'an-alt', text: a.romaji }),
        h('p', { class: 'an-meta', text: [a.format, a.episodes ? `${a.episodes} ep.` : null, a.studio, a.streaming?.length ? a.streaming.join(', ') : null].filter(Boolean).join(' · ') }),
        a.genres?.length ? h('p', { class: 'an-genres' }, a.genres.map((g) => h('span', { text: g }))) : null,
        a.synopsis && h('p', { class: `an-syn ${open ? 'open' : ''}`, text: A.tr?.[a.id] || a.synopsis, lang: A.tr?.[a.id] ? 'es' : 'en', onclick: () => { A.open = open ? null : a.id; redraw(); }, title: open ? '' : 'Clic para leer completa' }),
        h('div', { class: 'an-act' },
          h('button', { class: on ? 'btn ghost small' : 'btn primary small', text: on ? 'En tu calendario' : 'Añadir a mi calendario', onclick: () => toggleFollow(a) }),
          a.trailer && h('button', { class: 'btn subtle small', text: 'Tráiler', onclick: () => window.api.open(a.trailer) }),
          a.url && h('button', { class: 'btn subtle small', text: 'AniList', onclick: () => window.api.open(a.url) })
        )
      )
    );
  }

  function searchBar() {
    const input = h('input', { type: 'search', class: 'rx-input', placeholder: 'Buscar un anime (Frieren, Jujutsu Kaisen, Cyberpunk…)', value: A.q, 'aria-label': 'Buscar anime' });
    const go = async () => {
      A.q = input.value.trim();
      if (!A.q) {
        A.results = null;
        return redraw();
      }
      A.searching = true;
      redraw();
      try {
        A.results = await api.search(A.q);
      } catch (e) {
        toast(errMsg(e), true);
      }
      A.searching = false;
      redraw();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    return h('div', { class: 'rx-paste an-search' }, input, h('button', { class: 'btn ghost', text: A.searching ? 'Buscando…' : 'Buscar', onclick: go }), A.results && h('button', { class: 'btn subtle small', text: 'Limpiar', onclick: () => { A.q = ''; A.results = null; redraw(); } }));
  }

  function nextView() {
    const d = A.data;
    if (!d) return A.error ? h('p', { class: 'hint bad', text: A.error }) : h('p', { class: 'hint', text: 'Cargando estrenos de AniList…' });
    const groups = [['soon', 'Anunciados'], ...d.seasons.map((s, i) => [`s${i}`, s.label])];
    let list = A.group === 'soon' ? [...d.soon].sort((a, b) => (a.start ?? 9e15) - (b.start ?? 9e15) || b.popularity - a.popularity) : d.seasons[Number(A.group.slice(1))]?.list || [];
    if (A.group === 'soon') list = list.filter((a) => !a.start || a.start >= today0() - 7 * DAY);
    return [
      h('div', { class: 'chips an-groups' }, groups.map(([k, l]) => h('button', { class: 'chip', 'aria-pressed': String(A.group === k), onclick: () => { A.group = k; redraw(); } }, l))),
      h('p', { class: 'hint', text: A.group === 'soon' ? 'Lo más esperado que aún no se estrenó, ordenado por fecha.' : 'Lo de esa temporada, de más a menos popular.' }),
      h('div', { class: 'an-grid' }, list.map(card)),
    ];
  }

  // ---- mi calendario ----
  function customForm(c) {
    const isNew = !c;
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg' });
    const f = { title: h('input', { class: 'rx-input', value: c?.title || '', required: true, placeholder: 'Nombre del anime o evento' }), date: h('input', { class: 'rx-input', type: 'date', value: c?.date || '' }), where: h('input', { class: 'rx-input', value: c?.where || '', placeholder: 'Netflix, Crunchyroll, cine…' }), note: h('textarea', { class: 'note', rows: 3, value: c?.note || '' }) };
    const field = (l, el) => h('label', { class: 'ks-field' }, h('span', { text: l }), el);
    const form = h('form', { method: 'dialog' },
      h('h2', { text: isNew ? 'Añadir a mano' : 'Editar' }),
      field('Qué', f.title), field('Fecha (si la sabes)', f.date), field('Dónde se ve', f.where), field('Nota', f.note),
      h('div', { class: 'actions' },
        !isNew && h('button', { type: 'button', class: 'btn subtle', text: 'Eliminar', onclick: async () => { A.mine = await api.saveCustom(A.mine.custom.filter((x) => x.id !== c.id)); dlg.close(); redraw(); } }),
        h('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: () => dlg.close() }),
        h('button', { class: 'btn primary', text: 'Guardar' })
      )
    );
    form.addEventListener('submit', async () => {
      const row = { id: c?.id, title: f.title.value.trim(), date: f.date.value, where: f.where.value.trim(), note: f.note.value.trim() };
      if (!row.title) return;
      const list = isNew ? [...(A.mine.custom || []), row] : A.mine.custom.map((x) => (x.id === c.id ? { ...x, ...row } : x));
      A.mine = await api.saveCustom(list);
      redraw();
    });
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function entries() {
    const m = A.mine || { follows: {}, custom: [] };
    const out = [];
    for (const a of Object.values(m.follows)) {
      if (a.next) out.push({ kind: 'ep', a, at: a.next.at, label: `Episodio ${a.next.episode}`, precise: true });
      else if (a.status === 'NOT_YET_RELEASED') out.push({ kind: 'premiere', a, at: a.start, label: a.precision === 'day' ? 'Estreno' : `Estreno: ${dateLabel(a).text}`, precise: a.precision === 'day' });
      else out.push({ kind: 'done', a, at: null, label: a.status === 'FINISHED' ? 'Terminado' : 'En emisión' });
    }
    for (const c of m.custom || []) out.push({ kind: 'custom', c, at: c.date ? new Date(c.date + 'T12:00:00').getTime() : null, label: c.where || 'Añadido a mano', precise: !!c.date });
    return out.sort((x, y) => (x.at ?? 9e15) - (y.at ?? 9e15));
  }

  function mineView() {
    const list = entries();
    const row = (e) => {
      const title = e.a ? e.a.title : e.c.title;
      const days = e.at && e.precise ? Math.round((new Date(e.at).setHours(0, 0, 0, 0) - today0()) / DAY) : null;
      return h('li', { class: 'an-row' },
        e.a?.cover ? h('img', { class: 'an-thumb', src: e.a.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('div', { class: 'an-thumb ph', text: title.slice(0, 1) }),
        h('div', { class: 'an-row-main' },
          h('b', { text: title }),
          h('p', { class: 'hint', text: [e.label, e.at && e.precise ? new Date(e.at).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', ...(e.kind === 'ep' ? { hour: '2-digit', minute: '2-digit' } : {}) }) : null, e.a?.streaming?.join(', ') || null, e.c?.note || null].filter(Boolean).join(' · ') })
        ),
        h('span', { class: 'ks-days', text: days == null ? '' : countdown(days) }),
        e.a ? h('button', { class: 'btn subtle small', text: 'Quitar', onclick: () => toggleFollow(e.a) }) : h('button', { class: 'btn ghost small', text: 'Editar', onclick: () => customForm(e.c) })
      );
    };
    const calendar = () => {
      const base = A.calMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const y = base.getFullYear();
      const mo = base.getMonth();
      const first = (new Date(y, mo, 1).getDay() + 6) % 7;
      const days = new Date(y, mo + 1, 0).getDate();
      // episodios: el que viene y los siguientes semanales hasta fin de mes
      const marks = [];
      for (const e of list) {
        if (!e.at || !e.precise) continue;
        if (e.kind === 'ep') for (let t = e.at, n = e.a.next.episode; t < new Date(y, mo + 1, 1).getTime() && (!e.a.episodes || n <= e.a.episodes); t += 7 * DAY, n++) marks.push({ t, label: `${e.a.title} · ep. ${n}` });
        else marks.push({ t: e.at, label: `${e.a ? e.a.title : e.c.title}${e.kind === 'premiere' ? ' (estreno)' : ''}` });
      }
      const cells = [];
      for (let i = 0; i < first; i++) cells.push(h('div', { class: 'ks-cell empty' }));
      for (let dd = 1; dd <= days; dd++) {
        const ms = marks.filter((x) => { const t = new Date(x.t); return t.getFullYear() === y && t.getMonth() === mo && t.getDate() === dd; });
        const isToday = new Date(y, mo, dd).getTime() === today0();
        cells.push(h('div', { class: `ks-cell ${isToday ? 'today' : ''}` }, h('b', { text: dd }), ms.map((x) => h('span', { class: 'ks-ev an-ev', title: x.label, text: x.label }))));
      }
      return [
        h('div', { class: 'ks-calhead' }, h('button', { class: 'btn ghost small', text: '‹ Anterior', onclick: () => { A.calMonth = new Date(y, mo - 1, 1); redraw(); } }), h('h2', { text: `${MONTHS[mo][0].toUpperCase()}${MONTHS[mo].slice(1)} ${y}` }), h('button', { class: 'btn ghost small', text: 'Siguiente ›', onclick: () => { A.calMonth = new Date(y, mo + 1, 1); redraw(); } })),
        h('div', { class: 'ks-cal' }, ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((x) => h('div', { class: 'ks-dow', text: x })), cells),
      ];
    };
    return [
      h('div', { class: 'toolbar flat' },
        h('div', { class: 'seg' }, h('button', { class: A.calView === 'list' ? 'on' : '', text: 'Lista', onclick: () => { A.calView = 'list'; redraw(); } }), h('button', { class: A.calView === 'cal' ? 'on' : '', text: 'Calendario', onclick: () => { A.calView = 'cal'; redraw(); } })),
        h('button', { class: 'btn primary small', text: 'Añadir a mano', onclick: () => customForm(null) }),
        h('span', { class: 'hint', text: 'Te aviso el día antes del estreno, el mismo día y cuando sale cada episodio de los que sigues.' })
      ),
      !list.length
        ? h('p', { class: 'empty' }, h('b', { text: 'Tu calendario de anime está vacío' }), 'Pulsa «Añadir a mi calendario» en cualquier estreno, búscalo arriba o añade uno a mano.')
        : A.calView === 'cal' ? calendar() : h('ul', { class: 'an-list' }, list.map(row)),
    ];
  }

  // Sinopsis en español: se traducen con Claude (Haiku) al pulsar el botón y quedan guardadas
  async function translateAll() {
    const pool = [...(A.results || []), ...(A.data?.soon || []), ...(A.data?.seasons || []).flatMap((s) => s.list), ...Object.values(A.mine?.follows || {})];
    const todo = [...new Map(pool.filter((a) => a.synopsis && !A.tr?.[a.id]).map((a) => [a.id, { id: a.id, synopsis: a.synopsis }])).values()];
    if (!todo.length) return toast('Ya están todas en español.');
    A.translating = true;
    redraw();
    try {
      const r = await window.api.animeTr.run(todo);
      A.tr = r.cache;
      toast(`${plural(r.done, 'sinopsis traducida', 'sinopsis traducidas')}.`);
    } catch (e) {
      toast(errMsg(e), true);
    }
    A.translating = false;
    redraw();
  }
  function render() {
    if (!A.tr && !A.trLoading) {
      A.trLoading = true;
      window.api.animeTr.get().then((t) => { A.tr = t || {}; redraw(); }).catch(() => (A.tr = {}));
    }
    if (!A.data && !A.busy && !A.error) load(false);
    const n = Object.keys(A.mine?.follows || {}).length + (A.mine?.custom?.length || 0);
    return h('div', { class: 'an' },
      h('div', { class: 'toolbar flat an-top' },
        h('div', { class: 'seg' }, h('button', { class: A.view === 'next' ? 'on' : '', text: 'Próximos estrenos', onclick: () => { A.view = 'next'; redraw(); } }), h('button', { class: A.view === 'mine' ? 'on' : '', text: `Mi calendario${n ? ` (${n})` : ''}`, onclick: () => { A.view = 'mine'; redraw(); } })),
        h('span', { class: 'ed-sp' }),
        h('button', { class: 'btn ghost small', text: A.translating ? 'Traduciendo con Claude…' : 'Traducir sinopsis al español', disabled: !!A.translating, title: 'Usa tu Claude Code (modelo Haiku) una vez; las traducciones quedan guardadas', onclick: translateAll }),
        h('button', { class: 'btn subtle small', text: A.busy ? 'Actualizando…' : 'Actualizar', disabled: A.busy, onclick: () => load(true) })
      ),
      searchBar(),
      A.results ? [h('h2', { class: 'section-h', text: `Resultados para «${A.q}»` }), A.results.length ? h('div', { class: 'an-grid' }, A.results.map(card)) : h('p', { class: 'hint', text: 'No encontré nada con ese nombre.' })] : A.view === 'mine' ? mineView() : nextView(),
      h('p', { class: 'hint rx-foot', text: 'Datos y portadas oficiales de AniList. Las sinopsis vienen en inglés; «Traducir sinopsis al español» las traduce con tu Claude y quedan guardadas.' })
    );
  }

  window.animeUI = { render };
})();

'use strict';
// 1.23: Viendo — Netflix y Crunchyroll de Vincenzo y Emily: qué están viendo,
// cuántos capítulos faltan, qué sigue y los próximos estrenos.
(function () {
  const V = { data: null, busy: false, who: 'all', aiBusy: false, aiErr: null, reading: null };
  const P = { netflix: ['Netflix', '#e50914'], crunchyroll: ['Crunchyroll', '#f47521'] };
  const WHO = { vincenzo: 'Vincenzo', emily: 'Emily' };
  const dShort = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  async function load() {
    V.busy = true;
    render();
    try {
      V.data = await window.api.stream.get();
    } catch (e) {
      toast(errMsg(e), true);
    }
    V.busy = false;
    render();
  }
  async function read(platform, who) {
    V.reading = platform + ':' + who;
    render();
    try {
      const r = await window.api.stream.read(platform, who);
      toast(P[platform][0] + ': leí ' + r.count + ' visionados' + (r.profile ? ' del perfil «' + r.profile + '»' : '') + ' como ' + WHO[who] + '.');
      await load();
    } catch (e) {
      toast(errMsg(e), true);
    }
    V.reading = null;
    render();
  }
  async function ai() {
    V.aiBusy = true;
    V.aiErr = null;
    render();
    try {
      const r = await window.api.stream.ai();
      V.data = { ...(V.data || {}), ai: r };
    } catch (e) {
      V.aiErr = errMsg(e);
    }
    V.aiBusy = false;
    render();
  }
  function connectCard(platform) {
    const [name, color] = P[platform];
    const accs = (V.data?.accounts || []).filter((a) => a.platform === platform);
    return h('section', { class: 'vw-conn', style: { '--pc': color } },
      h('header', {}, h('b', { text: name }), h('button', { class: 'btn ghost small', text: 'Abrir ' + name, onclick: () => window.api.stream.open(platform) })),
      h('p', { class: 'hint', text: 'Inicias sesión tú en la ventana de la app y eliges el perfil. Luego pulsa «Leer» con el nombre de esa persona. Solo se lee el historial; no se cambia nada.' }),
      h('div', { class: 'vw-who' }, Object.entries(WHO).map(([k, label]) => {
        const a = accs.find((x) => x.who === k);
        return h('div', { class: 'vw-acc' },
          h('div', {}, h('b', { text: label }), h('small', { class: 'hint', text: a ? a.count + ' visionados · leído ' + relTime(a.at / 1000) + (a.profile ? ' · perfil «' + a.profile + '»' : '') : 'Sin leer' })),
          h('button', { class: a ? 'btn subtle small' : 'btn primary small', disabled: !!V.reading, text: V.reading === platform + ':' + k ? 'Leyendo…' : a ? 'Volver a leer' : 'Leer como ' + label, onclick: () => read(platform, k) })
        );
      }))
    );
  }
  function showCard(s) {
    const [pname, color] = P[s.platform] || ['', 'var(--muted)'];
    const done = s.total && s.left != null ? s.total - s.left : null;
    const pct = s.total && done != null ? Math.min(100, (done / s.total) * 100) : null;
    const last = s.last || {};
    const ep = last.episodeTitle || last.episode;
    return h('article', { class: 'vw-show', style: { '--pc': color } },
      h('div', { class: 'vw-cover' }, s.cover ? h('img', { src: s.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('span', { text: s.name.slice(0, 1) }), h('span', { class: 'vw-plat', text: pname })),
      h('div', { class: 'vw-body' },
        h('b', { class: 'vw-title', text: s.name }),
        h('small', { class: 'hint', text: [WHO[s.who], s.movie ? 'película' : [last.season, ep && (typeof ep === 'number' ? 'episodio ' + ep : '«' + ep + '»')].filter(Boolean).join(' · '), last.date ? dShort(last.date) : null].filter(Boolean).join(' · ') }),
        pct != null ? h('div', { class: 'vw-bar' }, h('i', { style: { width: pct + '%' } })) : null,
        s.movie ? null : h('p', { class: 'vw-left ' + (s.left === 0 ? 'done' : '') }, s.left == null ? (s.total ? s.total + ' capítulos en total' : 'No sé cuántos capítulos tiene') : s.left === 0 ? (s.next ? 'Al día: el siguiente sale ' + relTime(s.next.at / 1000) : 'La terminaste') : 'Te faltan ' + plural(s.left, 'capítulo', 'capítulos')),
        s.next && s.left !== 0 ? h('small', { class: 'hint', text: 'Nuevo: ' + s.next.label + ' ' + relTime(s.next.at / 1000) }) : null
      )
    );
  }
  function aiBlock() {
    const a = V.data?.ai?.data;
    return h('section', { class: 'vw-ai' },
      h('div', { class: 'ai-head' },
        h('div', {}, h('h2', { class: 'section-h', text: 'Qué ver después y lo que se estrena' }), h('p', { class: 'hint', text: 'Tu Claude Code mira lo que vieron los dos y busca en la web qué sigue y los estrenos de Netflix y Crunchyroll.' })),
        h('div', { class: 'ai-tools' }, V.data?.ai && h('span', { class: 'hint', text: 'Actualizado ' + relTime(V.data.ai.at / 1000) }), h('button', { class: a ? 'btn ghost small' : 'btn primary small', disabled: V.aiBusy, text: V.aiBusy ? 'Buscando…' : a ? 'Volver a buscar' : 'Preparar', onclick: ai }))
      ),
      V.aiBusy && !a ? h('div', { class: 'ai-wait' }, h('span', { class: 'as-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Leyendo su historial y buscando estrenos. Tarda uno o dos minutos.' })) : null,
      V.aiErr ? h('p', { class: 'hint bad', text: V.aiErr }) : null,
      a && [
        h('div', { class: 'vw-recs' }, (a.profiles || []).map((p) => h('section', { class: 'vw-rec' }, h('h3', { text: 'Para ' + p.who }), h('ol', {}, (p.next || []).map((x) => h('li', {}, h('b', { text: x.title }), h('span', { class: 'vw-tag', style: { '--pc': (P[String(x.platform).toLowerCase()] || [])[1] || 'var(--muted)' }, text: x.platform }), h('p', { class: 'hint', text: x.why })))))),
          a.together?.length ? h('section', { class: 'vw-rec together' }, h('h3', { text: 'Para ver juntos' }), h('ol', {}, a.together.map((x) => h('li', {}, h('b', { text: x.title }), h('span', { class: 'vw-tag', style: { '--pc': (P[String(x.platform).toLowerCase()] || [])[1] || 'var(--muted)' }, text: x.platform }), h('p', { class: 'hint', text: x.why }))))) : null
        ),
        a.upcoming?.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Próximos estrenos' }), h('ul', { class: 'vw-up' }, a.upcoming.map((x) => h('li', {}, h('span', { class: 'vw-date', text: x.date || '' }), h('div', {}, h('b', { text: x.title }), h('small', { class: 'hint', text: [x.platform, x.kind, x.why].filter(Boolean).join(' · ') })))))) : null,
      ]
    );
  }
  function render() {
    const box = document.getElementById('viendoBody');
    if (!box || document.getElementById('viendoView').hidden) return;
    if (!V.data && !V.busy && !V.tried) {
      V.tried = true;
      load();
      return;
    }
    if (!V.data) return fill(box, h('div', { class: 'vw-conns' }, [1, 2].map(() => h('div', { class: 'skel', style: { height: '200px', borderRadius: '16px' } }))), h('p', { class: 'hint', text: 'Leyendo lo que están viendo y buscando cuántos capítulos faltan…' }));
    const shows = (V.data?.shows || []).filter((s) => V.who === 'all' || s.who === V.who);
    const going = shows.filter((s) => !s.movie && s.left !== 0);
    const ready = shows.filter((s) => !s.movie && s.left === 0);
    const movies = shows.filter((s) => s.movie).slice(0, 12);
    fill(box,
      h('div', { class: 'vw-conns' }, connectCard('netflix'), connectCard('crunchyroll')),
      V.data?.shows?.length ? h('div', { class: 'toolbar flat' }, h('div', { class: 'seg' }, [['all', 'Los dos'], ['vincenzo', 'Vincenzo'], ['emily', 'Emily']].map(([k, l]) => h('button', { class: V.who === k ? 'on' : '', text: l, onclick: () => { V.who = k; render(); } }))), h('button', { class: 'btn subtle small', disabled: V.busy, text: V.busy ? 'Actualizando…' : 'Actualizar', onclick: load })) : null,
      going.length ? [h('h2', { class: 'section-h', text: 'Siguen viendo' }), h('div', { class: 'vw-grid' }, going.slice(0, 18).map(showCard))] : null,
      ready.length ? [h('h2', { class: 'section-h', text: 'Al día o terminadas' }), h('div', { class: 'vw-grid' }, ready.slice(0, 12).map(showCard))] : null,
      movies.length ? [h('h2', { class: 'section-h', text: 'Películas recientes' }), h('div', { class: 'vw-grid' }, movies.map(showCard))] : null,
      V.data?.shows?.length ? aiBlock() : h('p', { class: 'empty' }, h('b', { text: 'Conecta un perfil' }), 'Abre Netflix o Crunchyroll arriba, inicia sesión, elige el perfil y pulsa «Leer».')
    );
  }
  window.viendoUI = { show: render };
})();

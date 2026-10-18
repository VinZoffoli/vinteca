'use strict';
// Genshin: planificador de farmeo (con la resina) y códigos de canje.
(function () {
  const api = window.api.gplus;
  const F = { avatars: null, plan: null, result: null, busy: false, error: null, q: '', resin: null, settings: null };
  const C = { data: null, busy: false, error: null };
  const redraw = () => window.renderGenshin?.();
  const ELEM = { Fire: 'Pyro', Water: 'Hydro', Wind: 'Anemo', Ice: 'Cryo', Rock: 'Geo', Electric: 'Electro', Grass: 'Dendro' };

  // ---------------- FARMEO ----------------
  async function loadFarm() {
    if (F.plan) return;
    F.busy = true;
    try {
      [F.avatars, F.plan, F.resin, F.settings, F.inv] = await Promise.all([api.avatars(), api.plan(), api.resin(), window.api.basicSettings(), api.inventory().catch(() => ({}))]);
      if (F.plan.length) F.result = await api.compute();
    } catch (e) {
      F.error = errMsg(e);
    }
    F.busy = false;
    redraw();
  }
  async function save() {
    F.plan = await api.savePlan(F.plan);
    F.busy = true;
    redraw();
    try {
      F.result = F.plan.length ? await api.compute() : null;
      F.error = null;
    } catch (e) {
      F.error = errMsg(e);
    }
    F.busy = false;
    redraw();
  }
  let saveTimer;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  };

  function numIn(value, min, max, label, onset) {
    return h('input', { type: 'number', class: 'gf-num', min, max, value, 'aria-label': label, onchange: (e) => onset(Math.max(min, Math.min(max, Number(e.target.value) || min))) });
  }

  function resinCard() {
    // `gi` es el estado de Genshin de app.js (constante global de otro script)
    const hoyo = typeof gi !== 'undefined' ? gi.hoyo : null;
    const live = (hoyo?.linked && hoyo.notes) || F.resin?.live;
    const r = hoyo?.linked && hoyo.notes ? { value: hoyo.notes.resin, max: hoyo.notes.maxResin, fullAt: hoyo.notes.resinFullAt } : F.resin;
    const input = h('input', { type: 'number', class: 'gf-num gf-resin-in', min: 0, max: 200, placeholder: '0–200', 'aria-label': 'Resina que tienes ahora' });
    const full = r && r.value >= r.max;
    return h('section', { class: 'rx-card gf-resin' },
      h('div', { class: 'gf-resin-top' },
        h('div', {}, h('h3', { text: 'Resina' }), r ? h('p', { class: `gf-resin-num ${full ? 'full' : ''}`, text: `${r.value}/${r.max}` }) : h('p', { class: 'hint', text: 'Escribe cuánta resina tienes y te aviso cuando se llene.' }), r && h('p', { class: 'hint', text: full ? 'Está llena: gástala en el dominio de hoy.' : r.fullAt ? `Se llena ${new Date(r.fullAt).toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` : '' })),
        !live && h('div', { class: 'rx-row' }, input, h('button', { class: 'btn ghost small', text: 'Guardar', onclick: async () => { F.resin = await api.setResin(input.value); toast('Resina guardada. Te aviso cuando se llene.'); redraw(); } }))
      ),
      live && h('p', { class: 'hint', text: 'Leída de HoYoLAB: se actualiza sola.' }),
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: F.settings?.resinAlert !== false, onchange: (e) => window.api.saveSettings({ resinAlert: e.target.checked }) }), h('span', { text: live ? 'Avisarme cuando la resina esté llena y cuando vuelvan las expediciones' : 'Avisarme cuando la resina esté llena' }))
    );
  }

  function charRow(p, i) {
    const a = (F.avatars || []).find((x) => String(x.id) === String(p.id));
    const names = F.result?.chars?.find((c) => String(c.id) === String(p.id))?.talentNames || ['Ataque normal', 'Habilidad', 'Definitiva'];
    const set = (fn) => {
      fn(p);
      saveSoon();
    };
    return h('li', { class: 'gf-char' },
      a && h('img', { class: 'gf-face', src: a.icon, alt: '', loading: 'lazy' }),
      h('div', { class: 'gf-char-main' },
        h('b', { text: a?.name || p.id }),
        h('div', { class: 'gf-levels' },
          h('label', {}, h('span', { text: 'Nivel' }), numIn(p.level, 1, 90, 'Nivel actual', (v) => set((x) => (x.level = v))), h('span', { text: '→' }), numIn(p.target.level, 1, 90, 'Nivel objetivo', (v) => set((x) => (x.target.level = v)))),
          h('label', { class: 'gf-asc' }, h('input', { type: 'checkbox', checked: p.ascended, onchange: (e) => set((x) => (x.ascended = e.target.checked)) }), h('span', { text: 'ya ascendido' })),
          names.map((n, k) => h('label', { title: n }, h('span', { text: ['A. normal', 'Habilidad', 'Definitiva'][k] }), numIn(p.talents[k], 1, 10, `${n} actual`, (v) => set((x) => (x.talents[k] = v))), h('span', { text: '→' }), numIn(p.target.talents[k], 1, 10, `${n} objetivo`, (v) => set((x) => (x.target.talents[k] = v)))))
        )
      ),
      h('button', { class: 'btn subtle small', text: 'Quitar', onclick: () => { F.plan.splice(i, 1); save(); } })
    );
  }

  function picker() {
    const q = F.q.trim().toLowerCase();
    const taken = new Set((F.plan || []).map((p) => String(p.id)));
    const list = (F.avatars || []).filter((a) => !taken.has(String(a.id)) && (!q || a.name.toLowerCase().includes(q))).slice(0, q ? 12 : 0);
    const input = h('input', { type: 'search', class: 'rx-input', placeholder: 'Añadir personaje (escribe su nombre)', value: F.q, oninput: (e) => { F.q = e.target.value; const pos = e.target.selectionStart; redraw(); const i = document.querySelector('.gf-pick input'); i?.focus(); i?.setSelectionRange(pos, pos); } });
    return h('div', { class: 'gf-pick' }, input, list.length ? h('ul', { class: 'gf-pick-list' }, list.map((a) => h('li', {}, h('button', { onclick: () => { F.plan.push({ id: a.id, level: 1, ascended: false, talents: [1, 1, 1], target: { level: 90, talents: [8, 8, 8] } }); F.q = ''; save(); } }, h('img', { src: a.icon, alt: '', loading: 'lazy' }), h('span', { text: a.name }), h('small', { text: `${a.rank}★ · ${ELEM[a.element] || a.element}` }))))) : null);
  }

  function results() {
    const r = F.result;
    if (!r) return null;
    const groups = {};
    for (const m of r.materials) (groups[m.group] ||= []).push(m);
    return [
      h('section', { class: `rx-card gf-today ${r.todayFarm.length ? 'on' : ''}` },
        h('h3', { text: `Hoy es ${r.todayEs}${r.sunday ? ': todos los dominios de talentos están abiertos' : ''}` }),
        r.todayFarm.length
          ? h('ul', {}, r.todayFarm.map((t) => h('li', {}, h('b', { text: t.domain || 'Dominio de talentos' }), h('span', { text: ` para ${t.who.join(', ')}` }))))
          : h('p', { class: 'hint', text: 'Hoy no toca ningún libro de tus personajes: aprovecha para jefes, gemas o materiales de enemigos.' })
      ),
      (() => {
        const inv = F.inv || {};
        const moraLeft = Math.max(0, r.mora - (inv.Mora || 0));
        const done = r.materials.filter((m) => (inv[m.name] || 0) >= m.count).length;
        const moraIn = h('input', { type: 'number', class: 'gf-num gf-mora-in', min: 0, step: 10000, value: inv.Mora || '', placeholder: 'tu mora', 'aria-label': 'Mora que tienes', onchange: async (e) => { F.inv = await api.setInventory('Mora', e.target.value); redraw(); } });
        return h('div', { class: 'gf-inv' },
          h('p', { class: 'hint', text: `Mora: necesitas ${r.mora.toLocaleString('es')}${inv.Mora ? `, te faltan ${moraLeft.toLocaleString('es')}` : ''} (sin contar la experiencia). Anota en cada material cuánto tienes y te digo lo que falta.` }),
          h('label', { class: 'gf-have' }, h('span', { text: 'Tengo de mora' }), moraIn),
          window.ginvSyncButton?.((inv) => { F.inv = inv; redraw(); }),
          h('span', { class: 'gf-inv-sum', text: `${done} de ${r.materials.length} materiales completos` })
        );
      })(),
      Object.entries(groups).map(([g, list]) => h('section', { class: 'gf-group' },
        h('h3', { class: 'rx-sec', text: r.groups[g] || g }),
        h('ul', { class: 'gf-mats' }, list.map((m) => {
          const have = F.inv?.[m.name] || 0;
          const left = Math.max(0, m.count - have);
          return h('li', { class: `r${m.rank || 1} ${m.days && m.today ? 'today' : ''} ${left === 0 ? 'got' : ''}`, title: `${m.name} · para ${m.who.join(', ')}${m.days ? ` · ${m.days.map((d) => r.daysEs[d]).join(', ')}` : ''}` },
            m.icon && h('img', { src: m.icon, alt: '', loading: 'lazy' }),
            h('b', { text: left === 0 ? '✓' : `×${left}` }),
            h('span', { text: m.name }),
            m.days && h('small', { text: m.today ? 'Hoy' : m.days.filter((d) => d !== 'sunday').map((d) => r.daysEs[d].slice(0, 3)).join('/') }),
            h('input', { type: 'number', class: 'gf-have-in', min: 0, value: have || '', placeholder: 'tengo', title: `Cuántos tienes (necesitas ${m.count})`, 'aria-label': `Cuántos ${m.name} tienes`, onchange: async (e) => { F.inv = await api.setInventory(m.name, e.target.value); redraw(); } })
          );
        }))
      )),
    ];
  }

  // ---- recompensa diaria, reinicios y banners ----
  const X = { sign: null, resets: null, news: null, loading: false };
  async function loadExtra() {
    if (X.loading || X.resets) return;
    X.loading = true;
    [X.sign, X.resets, X.news] = await Promise.all([
      window.api.gend.sign().catch(() => null),
      window.api.gend.resets().catch(() => []),
      typeof gi !== 'undefined' && gi.news ? gi.news : window.api.gnews(false).catch(() => null),
    ]);
    X.loading = false;
    redraw();
  }
  const until = (t) => {
    const m = Math.round((t - Date.now()) / 60000);
    if (m < 60) return `${m} min`;
    const hh = Math.floor(m / 60);
    return hh < 48 ? `${hh} h` : `${Math.round(hh / 24)} días`;
  };
  const plainName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function bannerChars() {
    const evs = (X.news?.events || []).filter((e) => /gachap|deseo|invocaci[oó]n de personaje/i.test(e.kind || '') && e.end > Date.now());
    const out = [];
    for (const e of evs) {
      for (const m of String(e.title).matchAll(/obtenci[oó]n de ([^,"«»]+?),\s*["“«]/g)) {
        const name = m[1].trim();
        const av = (F.avatars || []).find((a) => plainName(a.name) === plainName(name));
        if (!out.some((x) => x.name === name)) out.push({ name, av, end: e.end, start: e.start, upcoming: e.start > Date.now() });
      }
    }
    return out;
  }
  function extraCards() {
    loadExtra();
    const s = X.sign;
    const chars = bannerChars();
    return h('div', { class: 'gx' },
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Reinicios' }),
        h('ul', { class: 'dy-list' }, (X.resets || []).map((r) => h('li', { title: r.note }, h('span', { text: r.name }), h('b', { text: `en ${until(r.at)}` })))),
        h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: F.settings?.paimonAlert !== false, onchange: (e) => window.api.saveSettings({ paimonAlert: e.target.checked }) }), h('span', { text: 'Avisarme el día 1 cuando se renueva la tienda de Paimon' }))
      ),
      h('section', { class: `rx-card ${s && s.linked && !s.signed && !s.error ? 'gx-warn' : ''}` },
        h('h3', { text: 'Recompensa diaria de HoYoLAB' }),
        !s ? h('p', { class: 'hint', text: 'Comprobando…' })
          : !s.linked ? h('p', { class: 'hint', text: 'Inicia sesión en HoYoLAB (pestaña Notas) para saber si ya la reclamaste hoy.' })
          : s.error ? h('p', { class: 'hint bad', text: s.error })
          : h('p', { class: 'gx-sign', text: s.signed ? `Ya la reclamaste hoy (${s.days} días este mes).` : 'Todavía no la reclamaste hoy.' }),
        h('div', { class: 'rx-row' },
          h('button', { class: s?.signed ? 'btn ghost small' : 'btn primary small', text: 'Abrir la página para reclamarla', onclick: () => window.api.gend.openSign() }),
          h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: F.settings?.checkinAlert !== false, onchange: (e) => window.api.saveSettings({ checkinAlert: e.target.checked }) }), h('span', { text: 'Avisarme si se me olvida' }))
        )
      ),
      h('section', { class: 'rx-card gx-banners' },
        h('h3', { text: 'Personajes de los banners' }),
        chars.length ? h('ul', { class: 'gx-chars' }, chars.map((c) => {
          const inPlan = (F.plan || []).some((p) => c.av && String(p.id) === String(c.av.id));
          return h('li', {},
            c.av ? h('img', { src: c.av.icon, alt: '', loading: 'lazy' }) : h('span', { class: 'gx-ph' }),
            h('div', {}, h('b', { text: c.name }), h('small', { text: c.upcoming ? `Llega en ${until(c.start)}` : `Hasta dentro de ${until(c.end)}` }), (() => {
              const ch = window.gcalcUI?.chance?.(c.end);
              if (!ch) return null;
              const pct = Math.round(ch.p * 100);
              return h('small', { class: `gx-odds ${pct >= 90 ? 'ok' : pct >= 50 ? 'mid' : 'low'}`, title: 'Con lo que tienes y lo que juntes hasta que termine (según la Calculadora de tiradas)', text: `${pct} % de sacarlo · ${ch.pulls} tiradas` });
            })()),
            c.av && h('button', { class: inPlan ? 'btn subtle small' : 'btn ghost small', text: inPlan ? 'En tu plan' : 'Planear farmeo', disabled: inPlan, onclick: () => { F.plan.push({ id: c.av.id, level: 1, ascended: false, talents: [1, 1, 1], target: { level: 90, talents: [8, 8, 8] } }); save(); toast(`${c.name} añadido: te digo qué materiales juntar.`); } })
          );
        })) : h('p', { class: 'hint', text: 'Sin datos de banners todavía (se leen de los anuncios oficiales del juego).' }),
        h('p', { class: 'hint', text: 'Los del próximo parche aparecen aquí en cuanto HoYoverse los anuncia (normalmente tras el livestream).' })
      )
    );
  }

  function renderFarm() {
    loadFarm();
    if (!F.plan) return [resinCardSafe(), skeletonDeals(3)];
    return h('div', { class: 'gf' },
      window.genshinTodayPlan?.({ result: F.result, resin: F.resin, sign: X.sign }),
      extraCards(),
      resinCardSafe(),
      window.gatherCard?.(F.result),
      F.error && h('p', { class: 'hint bad', text: F.error }),
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Personajes que quieres subir' }),
        F.plan.length ? h('ol', { class: 'gf-chars' }, F.plan.map(charRow)) : h('p', { class: 'hint', text: 'Añade los personajes que quieres mejorar y pon el nivel y los talentos que tienen y a los que quieres llegar.' }),
        picker()
      ),
      F.busy ? h('p', { class: 'hint', text: 'Calculando materiales…' }) : results(),
      h('p', { class: 'hint rx-foot', text: 'Datos de los materiales y días de dominio de Project Amber. El día de Genshin cambia a las 4:00 del servidor de América.' })
    );
  }
  function resinCardSafe() {
    try {
      return resinCard();
    } catch {
      return null;
    }
  }

  // ---------------- CÓDIGOS ----------------
  async function loadCodes(force) {
    C.busy = true;
    redraw();
    try {
      C.data = await api.codes(!!force);
      C.error = null;
    } catch (e) {
      C.error = errMsg(e);
    }
    C.busy = false;
    redraw();
  }
  function renderCodes() {
    if (!C.data && !C.busy && !C.error) loadCodes(false);
    if (!C.data) return C.error ? h('p', { class: 'hint bad', text: C.error }) : skeletonDeals(3);
    const fresh = C.data.codes.filter((c) => !c.used);
    const used = C.data.codes.filter((c) => c.used);
    const row = (c) => h('li', { class: `gc-code ${c.used ? 'used' : ''} ${c.isNew ? 'new' : ''}` },
      h('div', { class: 'gc-main' }, h('code', { text: c.code }), c.isNew && !c.used && h('span', { class: 'rx-tag new', text: 'Nuevo' }), h('p', { class: 'hint', text: c.rewards.join(' · ') || 'Recompensa sin detallar' })),
      h('div', { class: 'rx-row' },
        !c.used && h('button', { class: 'btn primary small', text: 'Canjear', onclick: async () => { await window.api.gplus.openCode(c.code); C.data = await api.codeUsed(c.code, true); toast('Se abrió la página oficial de canje con el código puesto. Inicia sesión si te lo pide y pulsa Canjear.'); redraw(); } }),
        h('button', { class: 'btn ghost small', text: 'Copiar', onclick: async () => { await window.api.workana.copy(c.code); toast('Código copiado.'); } }),
        h('button', { class: 'btn subtle small', text: c.used ? 'Marcar sin canjear' : 'Ya lo canjeé', onclick: async () => { C.data = await api.codeUsed(c.code, !c.used); redraw(); } })
      )
    );
    return h('div', { class: 'gc' },
      h('div', { class: 'rx-row gc-head' },
        h('p', { class: 'hint', text: `${plural(fresh.length, 'código vigente sin canjear', 'códigos vigentes sin canjear')}. Revisado ${relTime(C.data.at / 1000)}.` }),
        h('button', { class: 'btn ghost small', text: C.busy ? 'Revisando…' : 'Buscar códigos', disabled: C.busy, onclick: () => loadCodes(true) })
      ),
      fresh.length ? h('ul', { class: 'gc-list' }, fresh.map(row)) : h('p', { class: 'empty', text: 'Ya canjeaste todos los códigos vigentes.' }),
      used.length ? [h('h3', { class: 'rx-sec', text: 'Ya canjeados' }), h('ul', { class: 'gc-list' }, used.map(row))] : null,
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: F.settings?.codesAlert !== false, onchange: (e) => window.api.saveSettings({ codesAlert: e.target.checked }) }), h('span', { text: 'Avisarme cuando salga un código nuevo (lo reviso cada 6 horas)' })),
      h('p', { class: 'hint rx-foot', text: 'Lista comunitaria de hoyo-codes, que comprueba cada código con HoYoverse. «Canjear» abre la página oficial con el código ya puesto.' })
    );
  }

  window.gplusUI = { renderFarm, renderCodes };
})();

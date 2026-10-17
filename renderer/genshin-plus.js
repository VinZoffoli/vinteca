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
      [F.avatars, F.plan, F.resin, F.settings] = await Promise.all([api.avatars(), api.plan(), api.resin(), window.api.basicSettings()]);
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
      h('p', { class: 'hint', text: `Necesitas en total ${r.mora.toLocaleString('es')} de mora (sin contar la experiencia para subir de nivel). No sé lo que ya tienes en el inventario: resta lo que tengas.` }),
      Object.entries(groups).map(([g, list]) => h('section', { class: 'gf-group' },
        h('h3', { class: 'rx-sec', text: r.groups[g] || g }),
        h('ul', { class: 'gf-mats' }, list.map((m) => h('li', { class: `r${m.rank || 1} ${m.days && m.today ? 'today' : ''}`, title: `${m.name} · para ${m.who.join(', ')}${m.days ? ` · ${m.days.map((d) => r.daysEs[d]).join(', ')}` : ''}` },
          m.icon && h('img', { src: m.icon, alt: '', loading: 'lazy' }),
          h('b', { text: `×${m.count}` }),
          h('span', { text: m.name }),
          m.days && h('small', { text: m.today ? 'Hoy' : m.days.filter((d) => d !== 'sunday').map((d) => r.daysEs[d].slice(0, 3)).join('/') })
        )))
      )),
    ];
  }

  function renderFarm() {
    loadFarm();
    if (!F.plan) return [resinCardSafe(), skeletonDeals(3)];
    return h('div', { class: 'gf' },
      resinCardSafe(),
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

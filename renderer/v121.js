'use strict';
// 1.21: precios históricos, clips por juego, retos del backlog, noche de juego y
// Genshin (lo que viene, consejos de tiradas, equipos, eventos e inventario).
(function () {
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  };
  const dShort = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

  // =================================================== PRECIOS (Ofertas)
  window.PRICES = null;
  window.api.prices().then((p) => {
    window.PRICES = p;
    window.renderDeals?.();
  }).catch(() => {});
  window.priceBadge = (it) => {
    const P = window.PRICES;
    if (!P) return null;
    const hist = P.history?.[it.appid] || [];
    const low = P.lows?.[it.appid];
    const pct = it.price?.discountPct || 0;
    const atLow = pct && ((low?.lowPct != null && pct >= low.lowPct - 1) || (hist.length >= 8 && hist[hist.length - 1]?.v <= Math.min(...hist.map((x) => x.v))));
    const kids = [];
    if (atLow) kids.push(h('span', { class: 'pr-low', text: 'Mínimo histórico' }));
    else if (low?.lowPct) kids.push(h('span', { class: 'pr-ref', title: low.lowDate ? 'El ' + dShort(low.lowDate) : '', text: 'Su mínimo: −' + low.lowPct + ' %' }));
    if (hist.length >= 3) {
      const W = 120, H = 26;
      const vs = hist.slice(-60).map((x) => x.v);
      const mx = Math.max(...vs);
      const mn = Math.min(...vs);
      const pts = vs.map((v, i) => (i * W) / Math.max(1, vs.length - 1) + ',' + (H - 3 - ((v - mn) / Math.max(1, mx - mn)) * (H - 6))).join(' ');
      const s = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'pr-spark', 'aria-label': 'Precio de los últimos días' });
      s.append(svgEl('polyline', { points: pts }));
      kids.push(s);
    }
    return kids.length ? h('div', { class: 'pr-row' }, kids) : null;
  };

  // =================================================== CLIPS (ficha del juego)
  window.fillGameClips = async (g) => {
    const box = document.getElementById('gameClips');
    if (!box) return;
    fill(box);
    if (g.kind === 'tool') return;
    const list = await window.api.clips.get(g.id).catch(() => []);
    if (!list.length || (typeof openGameId !== 'undefined' && openGameId !== g.id)) return;
    const mb = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
    fill(box,
      h('h3', { class: 'sheet-h', text: 'Clips (' + list.length + ')' }),
      h('div', { class: 'clips' }, list.slice(0, 9).map((c) => h('figure', { class: 'clip' },
        h('button', { class: 'clip-v', title: 'Abrir el vídeo', onclick: () => window.api.clips.open(c.file) },
          h('video', { src: c.url + '#t=1', preload: 'metadata', muted: true, playsInline: true }),
          h('span', { class: 'clip-play', 'aria-hidden': 'true', text: '▶' })
        ),
        h('figcaption', {}, h('span', { text: dShort(c.time) + ' · ' + mb(c.size) }), h('button', { class: 'link-btn', text: 'Carpeta', onclick: () => window.api.clips.folder(c.file) }))
      ))),
      h('p', { class: 'hint', text: 'De la Barra de juegos de Windows (Win+Alt+G) y de las carpetas de NVIDIA o AMD con el nombre del juego.' })
    );
    for (const v of box.querySelectorAll('video')) {
      v.addEventListener('mouseenter', () => { v.currentTime = 0; v.play().catch(() => {}); });
      v.addEventListener('mouseleave', () => v.pause());
    }
  };

  // =================================================== RETOS DEL BACKLOG
  const GO = { g: null };
  window.api.goals.get().then((g) => { GO.g = g; }).catch(() => {});
  window.backlogGoalCard = () => {
    const g = GO.g || { perMonth: 0, history: {} };
    const ym = (t) => new Date(t).toLocaleDateString('sv').slice(0, 7);
    const finishedIn = (m) => Object.values(state.user || {}).filter((u) => u.finishedAt && ym(u.finishedAt) === m).length;
    const now = ym(Date.now());
    const done = finishedIn(now);
    const goal = g.perMonth || 0;
    // racha: meses seguidos (hacia atrás) en los que cumpliste la meta de ese mes
    let streak = 0;
    const d = new Date();
    d.setDate(1);
    for (let i = 0; i < 24; i++) {
      d.setMonth(d.getMonth() - 1);
      const m = d.toLocaleDateString('sv').slice(0, 7);
      const target = g.history?.[m];
      if (!target) break;
      if (finishedIn(m) >= target) streak++;
      else break;
    }
    const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
    const set = async (n) => { GO.g = await window.api.goals.set({ perMonth: n }); document.dispatchEvent(new Event('vt-goal')); };
    const steps = Array.from({ length: Math.max(goal, 1) }, (_, i) => h('i', { class: i < done ? 'on' : '' }));
    return h('section', { class: 'goal-card' + (goal && done >= goal ? ' won' : '') },
      h('div', { class: 'goal-main' },
        h('p', { class: 'ks-kicker', text: 'Reto de ' + new Date().toLocaleDateString('es', { month: 'long' }) }),
        goal
          ? h('h2', { text: done >= goal ? '¡Reto cumplido! ' + done + ' de ' + goal + ' terminados' : 'Llevas ' + done + ' de ' + goal + ' juegos terminados' })
          : h('h2', { text: 'Ponte una meta para este mes' }),
        h('p', { class: 'hint', text: goal ? (done >= goal ? 'Cualquier juego más es extra.' : 'Te quedan ' + daysLeft + ' días. Marca un juego como «Terminado» en su ficha y suma aquí.') + (streak ? ' Racha: ' + streak + (streak === 1 ? ' mes seguido' : ' meses seguidos') + ' cumpliendo.' : '') : 'Elige cuántos juegos quieres terminar cada mes y lleva la cuenta (y la racha).' }),
        goal ? h('div', { class: 'goal-steps' }, steps) : null
      ),
      h('div', { class: 'goal-set' }, h('span', { class: 'hint', text: 'Meta al mes' }), h('div', { class: 'seg' }, [0, 1, 2, 3, 4].map((n) => h('button', { type: 'button', class: goal === n ? 'on' : '', text: n ? String(n) : 'Sin meta', onclick: () => set(n) }))))
    );
  };

  // =================================================== NOCHE DE JUEGO (Amigos)
  window.gameNightCard = (c) => {
    const rows = (c?.rows || []).filter((r) => r.all).map((r) => ({ r, g: findGame(r.id) })).filter((x) => x.g);
    if (!rows.length) return null;
    const score = ({ r, g }) => (r.multiplayer ? 4 : 0) + (g.installed ? 2 : 0) + (g.familyOwners?.length ? 1 : 0) + Math.min(2, r.hours / 50);
    const top = rows.sort((a, b) => score(b) - score(a)).slice(0, 3);
    const when = h('input', { type: 'datetime-local', class: 'rx-input gn-when', value: (() => { const d = new Date(); d.setHours(21, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })() });
    const copy = async () => {
      const t = new Date(when.value);
      const day = t.toDateString() === new Date().toDateString() ? 'hoy' : t.toLocaleDateString('es', { weekday: 'long', day: 'numeric' });
      const text = '¿Noche de juego ' + day + ' a las ' + t.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + '? 🎮\n' + top.map((x, i) => (i + 1) + ') ' + x.g.title + (x.r.multiplayer ? '' : ' (no es multijugador)')).join('\n') + '\n¡Lo tenemos todos!';
      try { await navigator.clipboard.writeText(text); toast('Invitación copiada: pégala en Discord o en el chat de Steam.'); } catch { toast('No pude copiar la invitación.', true); }
    };
    return h('section', { class: 'gn-night' },
      h('div', { class: 'gn-night-head' }, h('p', { class: 'ks-kicker', text: 'Noche de juego' }), h('h2', { text: 'Propuesta para esta noche' })),
      h('ol', { class: 'gn-night-list' }, top.map(({ r, g }, i) => h('li', {},
        h('span', { class: 'gn-n', text: String(i + 1) }),
        h('div', { class: 'gn-night-cover' }, g.cover ? coverImg(g) : null),
        h('div', {}, h('b', { text: g.title }), h('small', { class: 'hint', text: [r.multiplayer ? 'Multijugador' : 'Lo tienen todos', g.installed ? 'instalado' : 'sin instalar', g.familyOwners?.length ? 'de la familia' : null].filter(Boolean).join(' · ') })),
        h('button', { class: 'btn ghost small', text: g.installed ? 'Jugar' : 'Instalar', onclick: () => launch(g) })
      ))),
      h('div', { class: 'row' }, h('span', { class: 'hint', text: 'Cuándo:' }), when, h('button', { class: 'btn primary small', text: 'Copiar invitación', onclick: copy }))
    );
  };

  // =================================================== GENSHIN: EVENTOS HECHOS
  const EV = { done: null };
  window.api.gevents.done().then((d) => { EV.done = d; }).catch(() => { EV.done = {}; });
  window.geventDone = (e) => {
    const on = !!EV.done?.[e.id];
    return h('button', { class: 'gn-ev-done' + (on ? ' on' : ''), title: on ? 'Hecho (pulsa para desmarcar)' : 'Marcar como hecho: ya no te aviso de este evento', 'aria-pressed': String(on), onclick: async () => { EV.done = await window.api.gevents.toggle(e.id); window.renderGenshin?.(); } }, on ? '✓ Hecho' : 'Hecho');
  };

  // =================================================== GENSHIN: INVENTARIO DESDE HoYoLAB
  window.ginvSyncButton = (redraw) => h('button', { class: 'btn ghost small', text: 'Leer de HoYoLAB', title: 'Lee lo que tienes de cada material del plan desde la calculadora oficial de HoYoLAB', onclick: async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Leyendo…';
    try {
      const r = await window.api.ginvSync();
      toast('Inventario leído: ' + r.matched + ' materiales del plan actualizados' + (r.skipped ? ' (' + r.skipped + ' personajes no están en tu cuenta)' : '') + '.');
      redraw?.(r.inv);
    } catch (err) {
      toast(errMsg(err), true);
    }
    b.disabled = false;
    b.textContent = 'Leer de HoYoLAB';
  } });

  // =================================================== GENSHIN: IA (lo que viene, tiradas, equipos)
  const AI = { cache: null, busy: {}, err: {}, spoil: false };
  window.api.gai.cached().then((c) => { AI.cache = c; window.renderGenshin?.(); }).catch(() => { AI.cache = {}; });
  async function aiLoad(kind, force) {
    if (AI.busy[kind]) return;
    AI.busy[kind] = true;
    AI.err[kind] = null;
    window.renderGenshin?.();
    try {
      let extra = null;
      if (kind === 'advice' && window.gcalcUI?.chance) {
        const n = typeof gi !== 'undefined' && gi.news?.next?.at;
        extra = n ? { pulls: window.gcalcUI.chance(n)?.pulls || 0 } : null;
      }
      const r = await window.api.gai.get(kind, !!force, extra);
      AI.cache = { ...(AI.cache || {}), [kind]: r };
    } catch (e) {
      AI.err[kind] = errMsg(e);
    }
    AI.busy[kind] = false;
    window.renderGenshin?.();
  }
  const aiHead = (kind, title, sub) => {
    const c = AI.cache?.[kind];
    return h('div', { class: 'ai-head' },
      h('div', {}, h('h2', { class: 'section-h', text: title }), h('p', { class: 'hint', text: sub })),
      h('div', { class: 'ai-tools' },
        c && h('span', { class: 'hint', text: 'Actualizado ' + relTime(c.at / 1000) }),
        h('button', { class: c ? 'btn ghost small' : 'btn primary small', disabled: AI.busy[kind], text: AI.busy[kind] ? 'Buscando en la web…' : c ? 'Volver a buscar' : 'Preparar', onclick: () => aiLoad(kind, true) })
      )
    );
  };
  const aiState = (kind) => (AI.busy[kind] && !AI.cache?.[kind] ? h('div', { class: 'ai-wait' }, h('span', { class: 'as-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Tu Claude Code está leyendo anuncios y filtraciones. Tarda uno o dos minutos.' })) : AI.err[kind] ? h('p', { class: 'hint bad', text: AI.err[kind] }) : null);
  const STATUS = { oficial: 'ok', filtración: 'leak', rumor: 'rumor' };
  function renderComing() {
    const ins = AI.cache?.insights?.data;
    const adv = AI.cache?.advice?.data;
    const EL = { Pyro: 'var(--pink)', Hydro: 'var(--cyan)', Anemo: 'var(--green)', Electro: '#b98cff', Dendro: '#9be36b', Cryo: '#9fe3ff', Geo: 'var(--amber)' };
    return h('div', { class: 'ai' },
      aiHead('advice', 'Por quién tirar', 'Según tus personajes, tus tiradas y los banners de ahora y los que vienen.'),
      aiState('advice'),
      adv && h('section', { class: 'ai-advice' },
        h('p', { class: 'ai-sum', text: adv.summary }),
        h('div', { class: 'ai-picks' }, (adv.picks || []).sort((a, b) => (a.priority || 9) - (b.priority || 9)).map((p) => h('article', { class: 'ai-pick v-' + String(p.verdict || '').split(' ')[0].toLowerCase() },
          h('div', { class: 'ai-pick-h' }, h('b', { text: p.name }), h('span', { class: 'ai-verdict', text: p.verdict })),
          h('small', { class: 'hint', text: p.banner ? 'Banner ' + p.banner : '' }),
          h('p', { text: p.why })
        ))),
        adv.saveFor?.name && h('p', { class: 'ai-save' }, h('b', { text: 'Ahorra para ' + adv.saveFor.name }), (adv.saveFor.when ? ' (' + adv.saveFor.when + ')' : '') + ': ' + (adv.saveFor.why || ''))
      ),
      aiHead('insights', 'Lo que viene', 'La historia de esta versión y las tres próximas: personajes, fechas y de dónde sale cada dato.'),
      aiState('insights'),
      ins && [
        h('section', { class: 'ai-lore' },
          h('div', { class: 'ai-lore-h' }, h('p', { class: 'ks-kicker', text: 'Versión ' + (ins.current?.version || '') + (ins.current?.name ? ' · ' + ins.current.name : '') }), h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: AI.spoil, onchange: (e) => { AI.spoil = e.target.checked; window.renderGenshin?.(); } }), h('span', { text: 'Mostrar spoilers' }))),
          h('p', { class: 'ai-lore-t', text: AI.spoil ? ins.current?.spoilerLore || ins.current?.lore : ins.current?.lore }),
          ins.current?.highlights?.length ? h('ul', { class: 'ai-hl' }, ins.current.highlights.map((x) => h('li', { text: x }))) : null
        ),
        h('div', { class: 'ai-versions' }, (ins.upcoming || []).slice(0, 3).map((v) => h('article', { class: 'ai-ver' },
          h('header', {}, h('b', { text: 'Versión ' + v.version }), h('span', { class: 'hint', text: v.when || '' })),
          h('ul', { class: 'ai-chars' }, (v.characters || []).map((ch) => h('li', { style: { '--el': EL[ch.element] || 'var(--muted)' } },
            h('span', { class: 'ai-star', text: (ch.rarity || 5) + '★' }),
            h('div', {}, h('b', { text: ch.name }), h('small', { text: [ch.element, ch.weapon, ch.region].filter(Boolean).join(' · ') })),
            h('span', { class: 'ai-tag ' + (STATUS[ch.status] || 'rumor'), text: ch.status || 'rumor' })
          ))),
          v.story && h('p', { class: AI.spoil ? 'hint' : 'hint ai-blur', title: AI.spoil ? '' : 'Activa «Mostrar spoilers» para leerlo', text: v.story }),
          v.notes && h('p', { class: 'hint', text: v.notes })
        ))),
        ins.sources?.length ? h('p', { class: 'hint ai-src' }, 'Fuentes: ', ins.sources.slice(0, 6).map((s, i) => [i ? ' · ' : '', h('button', { class: 'link-btn', text: s.title || 'enlace', onclick: () => window.api.open(s.url) })])) : null,
        h('p', { class: 'hint', text: 'Las filtraciones pueden cambiar o no cumplirse. Lo marcado como «oficial» viene de HoYoverse.' }),
      ]
    );
  }
  function renderTeams() {
    const t = AI.cache?.teams?.data;
    const team = (title, members, why) => h('article', { class: 'ai-team' }, h('b', { text: title }), h('div', { class: 'ai-members' }, (members || []).map((m) => h('span', { text: m }))), why && h('p', { class: 'hint', text: why }));
    return h('div', { class: 'ai' },
      aiHead('teams', 'Equipos para el Abismo y el Teatro', 'Armados solo con tus personajes (de HoYoLAB) para la temporada actual.'),
      aiState('teams'),
      !(typeof gi !== 'undefined' && gi.hoyo?.linked) && h('p', { class: 'hint', text: 'Conecta HoYoLAB (pestaña Notas) para que sepa todos tus personajes; sin eso solo ve tu vitrina.' }),
      t && [
        h('section', { class: 'ai-block' }, h('h3', { text: 'Abismo de Espiral' + (t.abyss?.season ? ' · ' + t.abyss.season : '') }), t.abyss?.blessing && h('p', { class: 'hint', text: t.abyss.blessing }), h('div', { class: 'ai-teams' }, (t.abyss?.teams || []).map((x) => team(x.half, x.members, x.why)))),
        h('section', { class: 'ai-block' }, h('h3', { text: 'Teatro Imaginario' + (t.theater?.season ? ' · ' + t.theater.season : '') }), t.theater?.elements?.length && h('p', { class: 'hint', text: 'Elementos: ' + t.theater.elements.join(', ') }), team('Tu alineación', t.theater?.lineup, t.theater?.why)),
        t.upgrades?.length ? h('section', { class: 'ai-block' }, h('h3', { text: 'Qué te conviene subir' }), h('ul', { class: 'dy-list' }, t.upgrades.map((u) => h('li', {}, h('span', { text: u.character }), h('b', { text: u.what }))))) : null,
      ]
    );
  }
  window.gaiUI = { coming: renderComing, teams: renderTeams };
})();

'use strict';
// Sensores del PC, pantalla del case y plan del backlog.
(function () {
  // =====================================================================
  // SENSORES
  // =====================================================================
  const S = { data: null, timer: null, watching: false, panel: null, settings: null, history: { cpu: [], gpu: [] } };
  const deg = (v) => (v == null ? '—' : `${Math.round(v)} °C`);
  const pct = (v) => (v == null ? '—' : `${Math.round(v)} %`);
  const tone = (t, lim) => (t == null ? '' : t >= lim ? 'hot' : t >= lim - 12 ? 'warm' : 'ok');

  async function sensorsShow() {
    if (!S.watching) {
      S.watching = true;
      window.api.sensors.watch(true);
    }
    S.settings = await window.api.basicSettings();
    S.panel = await window.api.panel.displays();
    clearInterval(S.timer);
    const tick = async () => {
      if ($('#sensorsView').hidden) return sensorsHide();
      S.data = await window.api.sensors.get().catch(() => S.data);
      for (const k of ['cpu', 'gpu']) {
        S.history[k].push(S.data?.[k]?.temp ?? S.data?.[k]?.load ?? null);
        S.history[k] = S.history[k].slice(-60);
      }
      sensorsRender();
    };
    tick();
    S.timer = setInterval(tick, 2000);
  }
  function sensorsHide() {
    clearInterval(S.timer);
    if (S.watching) window.api.sensors.watch(false);
    S.watching = false;
  }

  function spark(values) {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return null;
    const max = Math.max(...v, 1);
    const min = Math.min(...v, 0);
    const pts = values.map((x, i) => (x == null ? null : `${(i / (values.length - 1)) * 100},${30 - ((x - min) / (max - min || 1)) * 28}`)).filter(Boolean).join(' ');
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 100 32');
    s.setAttribute('preserveAspectRatio', 'none');
    s.setAttribute('class', 'sn-spark');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    p.setAttribute('points', pts);
    s.append(p);
    return s;
  }

  function gauge(label, temp, load, lim, extra, hist) {
    return h('section', { class: `sn-card ${tone(temp, lim)}` },
      h('p', { class: 'sn-label', text: label }),
      h('p', { class: 'sn-big' }, h('b', { text: temp != null ? Math.round(temp) : load != null ? Math.round(load) : '—' }), h('span', { text: temp != null ? '°C' : load != null ? '% de uso' : '' })),
      h('p', { class: 'sn-sub', text: [temp != null && load != null ? `${pct(load)} de uso` : null, extra].filter(Boolean).join(' · ') || ' ' }),
      spark(hist)
    );
  }

  function panelCard() {
    const P = S.panel;
    if (!P) return null;
    const sel = h('select', { class: 'sn-select', 'aria-label': 'Pantalla del case', onchange: async (e) => { await window.api.panel.set({ display: e.target.value || null }); S.panel = await window.api.panel.displays(); sensorsRender(); } },
      h('option', { value: '', text: 'Detectar sola (la pantalla vertical)' }),
      P.displays.map((d) => h('option', { value: d.id, selected: String(P.chosen) === String(d.id), text: `${d.label || 'Pantalla'} · ${d.w}×${d.h}${d.primary ? ' (principal)' : ''}${d.portrait ? ' · vertical' : ''}` }))
    );
    return h('section', { class: 'rx-card sn-panel' },
      h('h3', { text: 'Pantalla del case' }),
      h('p', { class: 'hint', text: 'Pone en la pantalla lateral del case un panel con la hora, tu próxima reunión, lo que suena en Spotify, temperaturas, FPS mientras juegas, la resina de Genshin y los tickets vencidos.' }),
      h('div', { class: 'rx-row' }, sel,
        h('button', { class: 'btn primary small', text: P.open ? 'Recargar panel' : 'Mostrar panel', onclick: async () => { try { await window.api.panel.open(); S.panel = await window.api.panel.displays(); sensorsRender(); } catch (e) { toast(errMsg(e), true); } } }),
        P.open && h('button', { class: 'btn ghost small', text: 'Quitar panel', onclick: async () => { await window.api.panel.close(); S.panel = await window.api.panel.displays(); sensorsRender(); } })
      ),
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: P.auto, onchange: async (e) => { await window.api.panel.set({ auto: e.target.checked }); } }), h('span', { text: 'Mostrarlo solo al abrir ViperTeca' }))
    );
  }

  function sensorsRender() {
    const body = $('#sensorsBody');
    if (!body) return;
    const d = S.data;
    const st = S.settings || {};
    const lim = st.tempLimits || { cpu: 90, gpu: 85 };
    const lhm = d?.source === 'lhm';
    const limInput = (k) => h('input', { type: 'number', class: 'sn-num', min: 50, max: 110, value: lim[k], 'aria-label': `Límite de ${k.toUpperCase()}`, onchange: async (e) => { lim[k] = Math.max(50, Math.min(110, Number(e.target.value) || lim[k])); await window.api.sensors.limits(lim); S.settings = await window.api.basicSettings(); toast('Límite guardado.'); } });
    fill(body,
      !lhm && h('div', { class: 'notice' },
        h('span', { text: 'Para ver temperaturas y ventiladores abre LibreHardwareMonitor (gratis) y activa Options → Remote Web Server → Run. Mientras tanto ves el uso de CPU, GPU y RAM.' }),
        h('button', { class: 'btn ghost small', text: 'Descargar LibreHardwareMonitor', onclick: () => window.api.open('https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases') })
      ),
      h('div', { class: 'sn-grid' },
        gauge('CPU', d?.cpu?.temp, d?.cpu?.load, lim.cpu, null, S.history.cpu),
        gauge('GPU', d?.gpu?.temp, d?.gpu?.load, lim.gpu, d?.gpu?.hotspot != null ? `punto caliente ${deg(d.gpu.hotspot)}` : null, S.history.gpu),
        h('section', { class: 'sn-card' }, h('p', { class: 'sn-label', text: 'RAM' }), h('p', { class: 'sn-big' }, h('b', { text: d ? Math.round(d.ram.load) : '—' }), h('span', { text: '%' })), h('p', { class: 'sn-sub', text: d ? `${d.ram.usedGb.toFixed(1).replace('.', ',')} de ${d.ram.totalGb.toFixed(0)} GB` : ' ' }))
      ),
      d?.fans?.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Ventiladores' }), h('ul', { class: 'sn-fans' }, d.fans.map((f) => h('li', {}, h('span', { text: f.name }), h('b', { text: f.rpm ? `${f.rpm} RPM` : 'Parado' }))))) : null,
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Avisos de temperatura' }),
        h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: st.sensorAlerts !== false, onchange: (e) => window.api.saveSettings({ sensorAlerts: e.target.checked }) }), h('span', { text: 'Avisarme si la CPU o la GPU se pasan del límite (necesita LibreHardwareMonitor)' })),
        h('div', { class: 'rx-row' }, h('span', { class: 'hint', text: 'Límite CPU' }), limInput('cpu'), h('span', { class: 'hint', text: '°C · GPU' }), limInput('gpu'), h('span', { class: 'hint', text: '°C' })),
        h('p', { class: 'hint', text: 'Durante las partidas con el modo enfoque, la temperatura máxima queda guardada en el registro de la partida, junto a los FPS.' })
      ),
      panelCard()
    );
  }

  // =====================================================================
  // BACKLOG
  // =====================================================================
  const B = { hltb: null, busy: null, mode: 'main', includeNew: false };
  window.api.hltb.onProgress((p) => {
    B.busy = p.done < p.total ? `Buscando duraciones: ${p.done} de ${p.total}${p.title ? ` · ${p.title}` : ''}` : null;
    if (!$('#backlogView').hidden) backlogRender();
  });

  const played = (g) => {
    const sess = (state.sessions?.list || []).filter((s) => s.id === g.id).reduce((a, s) => a + (s.end - s.start) / 60000, 0);
    return Math.max(g.playtimeMin || 0, sess) / 60;
  };
  function weeklyPace() {
    const from = Date.now() - 28 * 86400000;
    const sess = (state.sessions?.list || []).filter((s) => s.end > from).reduce((a, s) => a + (s.end - Math.max(s.start, from)) / 3600000, 0);
    const steam2w = games().reduce((a, g) => a + (g.playtime2wMin || 0), 0) / 60;
    const hours = Math.max(sess / 4, steam2w / 2);
    return Math.max(1, Math.round(hours * 10) / 10);
  }
  function candidates() {
    return games().filter((g) => {
      const st = state.user[g.id]?.status;
      return st === 'playing' || st === 'pending' || (B.includeNew && !st && neverPlayed(g));
    });
  }
  function plan() {
    const cache = B.hltb || {};
    const rows = candidates().map((g) => {
      const h = cache[g.id];
      const total = h?.found ? (B.mode === 'extra' ? h.extra || h.main : h.main || h.extra) : null;
      const done = played(g);
      return { g, h, total, done, left: total != null ? Math.max(0, Math.round((total - done) * 10) / 10) : null, status: state.user[g.id]?.status || 'new' };
    });
    const known = rows.filter((r) => r.left != null).sort((a, b) => (a.status === 'playing' ? 0 : 1) - (b.status === 'playing' ? 0 : 1) || a.left - b.left);
    const pace = weeklyPace();
    let acc = 0;
    for (const r of known) {
      acc += r.left;
      r.weeks = acc / pace;
    }
    return { pace, known, unknown: rows.filter((r) => r.left == null) };
  }
  /** Para "¿A qué juego?": empuja los que te quedan pocas horas. */
  window.backlogBoost = (g) => {
    const h = B.hltb?.[g.id];
    if (!h?.found || !h.main) return 0;
    const left = h.main - played(g);
    return left > 0 && left <= 6 ? 1.5 : 0;
  };

  async function backlogShow() {
    if (!B.hltb) B.hltb = await window.api.hltb.get();
    backlogRender();
  }
  async function fillDurations(force) {
    const list = candidates().filter((g) => force || !B.hltb?.[g.id]);
    if (!list.length) return toast('Ya tengo la duración de todos.');
    B.busy = `Buscando duraciones: 0 de ${list.length}`;
    backlogRender();
    try {
      B.hltb = await window.api.hltb.fill(list.map((g) => ({ id: g.id, title: g.title })), !!force);
      toast('Duraciones listas.');
    } catch (e) {
      toast(errMsg(e), true);
    }
    B.busy = null;
    backlogRender();
  }
  const weeksText = (w) => (w <= 1 ? 'Esta semana' : w <= 2 ? 'La semana que viene' : w <= 4.3 ? `En ${Math.ceil(w)} semanas` : `En ${Math.round(w / 4.3)} ${Math.round(w / 4.3) === 1 ? 'mes' : 'meses'}`);

  document.addEventListener('vt-goal', () => backlogRender());
  function backlogRender() {
    const body = $('#backlogBody');
    if (!body || !state.lib) return;
    const p = plan();
    const thisWeek = p.known.filter((r) => r.weeks <= 1);
    const totalLeft = p.known.reduce((a, r) => a + r.left, 0);
    const row = (r) => h('li', { class: 'bl-row' },
      h('button', { class: 'bl-cover', onclick: () => openGame(r.g), 'aria-label': `Abrir ${r.g.title}` }, r.g.cover ? coverImg(r.g) : h('span', { class: 'ph', text: r.g.title })),
      h('div', { class: 'bl-main' },
        h('b', { text: r.g.title }),
        h('p', { class: 'bl-meta' }, h('span', { text: r.status === 'playing' ? 'Jugando' : r.status === 'pending' ? 'Pendiente' : 'Sin estrenar' }), r.h?.found && h('span', { text: `${B.mode === 'extra' ? 'Historia + extras' : 'Historia'}: ${r.total} h` }), h('span', { text: `Llevas ${r.done.toFixed(1).replace('.', ',')} h` }), r.h?.found && !r.h.exact && h('span', { class: 'bl-guess', title: r.h.title, text: `según «${r.h.title}»` })),
        r.left != null && h('div', { class: 'bl-bar', role: 'img', 'aria-label': `${Math.round(Math.min(100, (r.done / r.total) * 100))} % hecho` }, h('i', { style: { width: `${Math.min(100, (r.done / (r.total || 1)) * 100)}%` } }))
      ),
      h('div', { class: 'bl-left' }, r.left != null ? [h('b', { text: r.left ? `${String(r.left).replace('.', ',')} h` : 'Listo' }), h('span', { text: r.left ? weeksText(r.weeks) : 'Ya superaste la duración' })] : h('span', { text: 'Sin datos' }))
    );
    fill(body,
      B.busy && h('div', { class: 'notice' }, h('span', { text: B.busy })),
      window.backlogGoalCard?.(),
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Tu ritmo' }), h('dd', { text: `${String(p.pace).replace('.', ',')} h por semana` })),
        h('div', {}, h('dt', { text: 'Te quedan' }), h('dd', { text: `${Math.round(totalLeft)} h en ${plural(p.known.length, 'juego', 'juegos')}` })),
        h('div', {}, h('dt', { text: 'Terminarías esta semana' }), h('dd', { text: String(thisWeek.length) })),
        h('div', {}, h('dt', { text: 'Todo el backlog' }), h('dd', { text: p.known.length ? weeksText(p.known[p.known.length - 1].weeks).toLowerCase() : '—' }))
      ),
      h('div', { class: 'toolbar flat' },
        h('div', { class: 'seg' }, h('button', { class: B.mode === 'main' ? 'on' : '', text: 'Solo historia', onclick: () => ((B.mode = 'main'), backlogRender()) }), h('button', { class: B.mode === 'extra' ? 'on' : '', text: 'Historia + extras', onclick: () => ((B.mode = 'extra'), backlogRender()) })),
        h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: B.includeNew, onchange: (e) => { B.includeNew = e.target.checked; backlogRender(); } }), h('span', { text: 'Incluir los que nunca estrenaste' })),
        h('button', { class: 'btn primary small', text: B.busy ? 'Buscando…' : p.unknown.length ? `Buscar duración de ${plural(p.unknown.length, 'juego', 'juegos')}` : 'Actualizar duraciones', disabled: !!B.busy, onclick: () => fillDurations(!p.unknown.length) })
      ),
      !candidates().length
        ? h('p', { class: 'empty' }, h('b', { text: 'Tu backlog está vacío' }), 'Marca juegos como «Jugando» o «Pendiente» en su ficha y aparecerán aquí con cuánto te falta.')
        : [
            thisWeek.length ? h('section', { class: 'rx-card' }, h('h3', { text: 'Con tu ritmo, esta semana terminarías' }), h('p', { class: 'hint', text: thisWeek.map((r) => r.g.title).join(', ') })) : null,
            h('ol', { class: 'bl-list' }, p.known.map(row)),
            p.unknown.length ? [h('h3', { class: 'rx-sec', text: 'Sin duración todavía' }), h('ol', { class: 'bl-list' }, p.unknown.map(row))] : null,
          ],
      h('p', { class: 'hint rx-foot', text: 'Duraciones de HowLongToBeat (se buscan una vez y se guardan 60 días). Tu ritmo sale de lo que jugaste las últimas cuatro semanas. En «¿A qué juego?» salen más los que te faltan menos de 6 horas.' })
    );
  }

  window.pcUI = { sensorsShow, sensorsHide, backlogShow };
})();

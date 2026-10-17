'use strict';
// 1.17: rendimiento por juego, calculadora de tiradas y recolección de Genshin,
// y el asistente «Pregúntale a ViperTeca».
(function () {
  const DAY = 86400000;
  const svgEl = (tag, attrs, ...kids) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const c of kids.flat(Infinity)) if (c) el.append(c);
    return el;
  };
  const dShort = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

  // =================================================== RENDIMIENTO POR JUEGO
  // Una línea por partida medida con el modo enfoque: FPS medio y 1 % bajo, y la
  // temperatura máxima de CPU y GPU.
  function perfChart(list) {
    const W = 560, H = 170, L = 34, R = 10, T = 12, B = 22;
    const max = Math.max(30, ...list.map((s) => s.fps || 0)) * 1.12;
    const x = (i) => L + (list.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (list.length - 1));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const line = (key) => list.map((s, i) => (s[key] ? `${x(i)},${y(s[key])}` : null)).filter(Boolean).join(' ');
    const ticks = [0, 0.5, 1].map((f) => Math.round(max * f / 10) * 10);
    return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pf-chart', role: 'img', 'aria-label': 'FPS por partida' },
      ticks.map((t) => [svgEl('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'pf-grid' }), svgEl('text', { x: L - 6, y: y(t) + 4, class: 'pf-axis', 'text-anchor': 'end' }, document.createTextNode(String(t)))]),
      svgEl('polygon', { points: `${x(0)},${y(0)} ${line('fps')} ${x(list.length - 1)},${y(0)}`, class: 'pf-area' }),
      svgEl('polyline', { points: line('fps'), class: 'pf-fps' }),
      svgEl('polyline', { points: line('low1'), class: 'pf-low' }),
      list.map((s, i) => svgEl('circle', { cx: x(i), cy: y(s.fps), r: 3.5, class: 'pf-dot' }, svgEl('title', {}, document.createTextNode(`${dShort(s.start)}: ${Math.round(s.fps)} FPS${s.low1 ? ` · 1 % bajo ${Math.round(s.low1)}` : ''}`)))),
      [0, list.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => svgEl('text', { x: x(i), y: H - 6, class: 'pf-axis', 'text-anchor': i ? 'end' : 'start' }, document.createTextNode(dShort(list[i].start))))
    );
  }
  window.fillGamePerf = (g) => {
    const box = document.getElementById('gamePerf');
    if (!box) return;
    if (g.kind === 'tool') return fill(box);
    const all = (state.sessions?.list || []).filter((s) => s.id === g.id && (s.fps || s.temps)).sort((a, b) => a.start - b.start);
    const withFps = all.filter((s) => s.fps).slice(-24);
    const temps = all.filter((s) => s.temps);
    if (!all.length) {
      return fill(box,
        h('h3', { class: 'sheet-h', text: 'Rendimiento' }),
        h('p', { class: 'hint', text: 'Juega con el modo enfoque activado y aquí verás los FPS y las temperaturas de cada partida.' })
      );
    }
    const avg = withFps.length ? withFps.reduce((a, s) => a + s.fps, 0) / withFps.length : null;
    const lows = withFps.filter((s) => s.low1);
    const low = lows.length ? lows.reduce((a, s) => a + s.low1, 0) / lows.length : null;
    const cpu = temps.length ? Math.max(...temps.map((s) => s.temps.cpu || 0)) : null;
    const gpu = temps.length ? Math.max(...temps.map((s) => s.temps.gpu || 0)) : null;
    const last = withFps[withFps.length - 1];
    const trend = withFps.length >= 4 ? last.fps - withFps.slice(0, -1).reduce((a, s) => a + s.fps, 0) / (withFps.length - 1) : 0;
    const stat = (label, value, cls, note) => h('div', { class: `pf-stat ${cls || ''}` }, h('small', { text: label }), h('b', { text: value }), note && h('em', { text: note }));
    const lim = state.settings?.tempLimits || { cpu: 90, gpu: 85 };
    fill(box,
      h('h3', { class: 'sheet-h', text: 'Rendimiento' }),
      h('div', { class: 'pf-stats' },
        avg != null && stat('FPS medio', String(Math.round(avg)), '', Math.abs(trend) >= 3 ? `${trend > 0 ? '▲' : '▼'} ${Math.round(Math.abs(trend))} en la última` : null),
        low != null && stat('1 % bajo', String(Math.round(low)), low < 30 ? 'warn' : ''),
        cpu ? stat('CPU máx.', `${cpu} °C`, cpu >= lim.cpu ? 'hot' : cpu >= lim.cpu - 8 ? 'warn' : '') : null,
        gpu ? stat('GPU máx.', `${gpu} °C`, gpu >= lim.gpu ? 'hot' : gpu >= lim.gpu - 8 ? 'warn' : '') : null
      ),
      withFps.length ? perfChart(withFps) : null,
      withFps.length ? h('p', { class: 'pf-legend' }, h('span', { class: 'pf-k fps', text: 'FPS medio' }), h('span', { class: 'pf-k low', text: '1 % bajo' }), h('span', { class: 'hint', text: `${plural(withFps.length, 'partida medida', 'partidas medidas')}` })) : null,
      low != null && avg && low < avg * 0.5 ? h('p', { class: 'hint', text: 'El 1 % bajo está muy lejos de la media: hay tirones. Prueba a limitar los FPS o bajar sombras y distancia de dibujado.' }) : null
    );
  };

  // =================================================== GENSHIN: CALCULADORA DE TIRADAS
  // Probabilidad de conseguir el personaje (o el arma) con lo que tienes y lo que
  // vas a juntar hasta la fecha. Modelo del juego: probabilidad base 0,6 %, sube a
  // partir de la tirada 74 y es seguro en la 90; 50/50 con el «Brillo capturado»
  // (≈ 55 % de ganar) y garantizado si perdiste el anterior.
  const CALC_KEY = 'vt-gcalc';
  const loadCalc = () => {
    try {
      return JSON.parse(localStorage.getItem(CALC_KEY)) || {};
    } catch {
      return {};
    }
  };
  const GC = { v: { banner: 'character', primos: 0, fates: 0, glitter: 0, welkin: false, extra: 1600, copies: 1, pity: null, guaranteed: null, date: '', ...loadCalc() } };
  const saveCalc = () => {
    try {
      localStorage.setItem(CALC_KEY, JSON.stringify(GC.v));
    } catch {}
  };
  function rate5(k, banner) {
    // k = número de la tirada desde el último 5★ (1…90)
    if (banner === 'weapon') return k >= 80 ? 1 : k >= 63 ? 0.007 + 0.07 * (k - 62) : 0.007;
    return k >= 90 ? 1 : k >= 74 ? 0.006 + 0.06 * (k - 73) : 0.006;
  }
  /** Probabilidad acumulada de tener `copies` copias del destacado tras n tiradas (n = 0…max). */
  function simulate({ banner, pity, guaranteed, copies, max }) {
    const hard = banner === 'weapon' ? 80 : 90;
    const win = banner === 'weapon' ? 0.375 : 0.55;
    // estado: [tiradas desde el último 5★][garantizado 0/1][copias]
    let cur = new Map([[`${Math.min(pity, hard - 1)}|${guaranteed ? 1 : 0}|0`, 1]]);
    const out = [0];
    for (let n = 1; n <= max; n++) {
      const next = new Map();
      let done = 0;
      const add = (k, p) => next.set(k, (next.get(k) || 0) + p);
      for (const [key, p] of cur) {
        const [k, g, c] = key.split('|').map(Number);
        if (c >= copies) {
          done += p;
          add(key, p);
          continue;
        }
        const r = rate5(k + 1, banner);
        if (r < 1) add(`${k + 1}|${g}|${c}`, p * (1 - r));
        const hit = p * r;
        if (g) add(`0|0|${c + 1}`, hit);
        else {
          add(`0|0|${c + 1}`, hit * win);
          add(`0|1|${c}`, hit * (1 - win));
        }
      }
      // las que ya llegaron se cuentan en este paso
      let reached = 0;
      for (const [key, p] of next) if (Number(key.split('|')[2]) >= copies) reached += p;
      out.push(reached);
      cur = next;
      if (reached > 0.9995) {
        while (out.length <= max) out.push(1);
        break;
      }
      void done;
    }
    return out;
  }
  function calcChart(curve, have) {
    const W = 1000, H = 230, L = 40, R = 14, T = 12, B = 24;
    const n = curve.length - 1;
    const x = (i) => L + (i / n) * (W - L - R);
    const y = (p) => T + (1 - p) * (H - T - B);
    const step = Math.max(1, Math.floor(n / 160));
    const pts = curve.map((p, i) => (i % step === 0 || i === n ? `${x(i)},${y(p)}` : null)).filter(Boolean).join(' ');
    const hx = Math.min(have, n);
    return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gc-chart', role: 'img', 'aria-label': 'Probabilidad según las tiradas' },
      [0, 0.5, 0.9, 1].map((p) => [svgEl('line', { x1: L, x2: W - R, y1: y(p), y2: y(p), class: 'pf-grid' }), svgEl('text', { x: L - 6, y: y(p) + 4, class: 'pf-axis', 'text-anchor': 'end' }, document.createTextNode(`${Math.round(p * 100)}%`))]),
      svgEl('polygon', { points: `${x(0)},${y(0)} ${pts} ${x(n)},${y(0)}`, class: 'gc-area' }),
      svgEl('polyline', { points: pts, class: 'gc-line' }),
      have > 0 && svgEl('line', { x1: x(hx), x2: x(hx), y1: T, y2: H - B, class: 'gc-have' }),
      have > 0 && svgEl('circle', { cx: x(hx), cy: y(curve[hx]), r: 5, class: 'gc-dot' }),
      svgEl('text', { x: L, y: H - 6, class: 'pf-axis' }, document.createTextNode('0')),
      svgEl('text', { x: W - R, y: H - 6, class: 'pf-axis', 'text-anchor': 'end' }, document.createTextNode(`${n} tiradas`))
    );
  }
  async function ensureWish() {
    if (typeof gi === 'undefined') return null;
    if (!gi.wish && !GC.wishBusy) {
      GC.wishBusy = true;
      gi.wish = await window.api.gwish().catch(() => null);
      GC.wishBusy = false;
      window.renderGenshin?.();
    }
    return gi.wish;
  }
  function renderCalc() {
    ensureWish();
    const v = GC.v;
    const pool = (typeof gi !== 'undefined' && gi.wish?.pools || []).find((p) => p.key === v.banner);
    const pity = v.pity ?? pool?.pity5 ?? 0;
    const guaranteed = v.banner === 'weapon' ? !!v.guaranteed : (v.guaranteed ?? pool?.guaranteed ?? false);
    const nextAt = (typeof gi !== 'undefined' && gi.news?.next?.at) || null;
    const target = v.date ? new Date(v.date + 'T12:00:00').getTime() : nextAt || Date.now() + 21 * DAY;
    const days = Math.max(0, Math.floor((target - Date.now()) / DAY));
    const income = days * (60 + (v.welkin ? 90 : 0)) + Math.round((Number(v.extra) || 0) * (days / 30));
    const primosTotal = (Number(v.primos) || 0) + income;
    const pulls = Math.floor(primosTotal / 160) + (Number(v.fates) || 0) + Math.floor((Number(v.glitter) || 0) / 5);
    const copies = Math.max(1, Math.min(v.banner === 'weapon' ? 5 : 7, Number(v.copies) || 1));
    const maxPulls = Math.max(pulls, (v.banner === 'weapon' ? 160 : 180) * copies);
    const key = JSON.stringify([v.banner, pity, guaranteed, copies, maxPulls]);
    if (GC.key !== key) {
      GC.curve = simulate({ banner: v.banner, pity, guaranteed, copies, max: maxPulls });
      GC.key = key;
    }
    const curve = GC.curve;
    const pNow = curve[Math.min(pulls, curve.length - 1)];
    const need = (p) => curve.findIndex((x) => x >= p);
    const set = (k, val) => {
      v[k] = val;
      saveCalc();
      window.renderGenshin?.();
    };
    const num = (k, label, opts = {}) => h('label', { class: 'gc-field' }, h('span', { text: label }), h('input', { type: 'number', class: 'rx-input', min: 0, value: v[k] ?? '', placeholder: opts.placeholder || '0', step: opts.step || 1, onchange: (e) => set(k, e.target.value === '' ? null : Number(e.target.value)) }), opts.hint && h('small', { class: 'hint', text: opts.hint }));
    const verdict = pNow >= 0.9 ? ['ok', 'Casi seguro'] : pNow >= 0.6 ? ['good', 'Buenas opciones'] : pNow >= 0.3 ? ['warn', 'Es una apuesta'] : ['bad', 'Difícil por ahora'];
    const goal = v.banner === 'weapon' ? (copies === 1 ? 'el arma' : `el arma R${copies}`) : copies === 1 ? 'el personaje' : `C${copies - 1}`;
    return h('div', { class: 'gc' },
      h('section', { class: `gc-hero ${verdict[0]}` },
        h('div', { class: 'gc-pct' }, h('b', { text: `${Math.round(pNow * 100)}` }), h('span', { text: '%' })),
        h('div', {},
          h('p', { class: 'ks-kicker', text: verdict[1] }),
          h('h2', { text: `de conseguir ${goal} con ${plural(pulls, 'tirada', 'tiradas')}` }),
          h('p', { class: 'hint', text: `Hasta el ${new Date(target).toLocaleDateString('es', { day: 'numeric', month: 'long' })} (${plural(days, 'día', 'días')}) juntas unas ${income.toLocaleString('es')} protogemas más. Para el 50 % necesitas ${need(0.5)} tiradas y para el 90 %, ${need(0.9)}.` }),
          pulls < need(0.9) && h('p', { class: 'gc-miss', text: `Te faltan ${(need(0.9) - pulls)} tiradas (${((need(0.9) - pulls) * 160).toLocaleString('es')} protogemas) para ir sobre seguro.` })
        )
      ),
      calcChart(curve, pulls),
      h('section', { class: 'rx-card gc-form' },
        h('div', { class: 'seg gc-seg', role: 'tablist' },
          [['character', 'Personaje'], ['weapon', 'Arma']].map(([k, l]) => h('button', { class: v.banner === k ? 'on' : '', role: 'tab', 'aria-selected': String(v.banner === k), text: l, onclick: () => { v.pity = null; v.guaranteed = null; set('banner', k); } }))
        ),
        h('div', { class: 'gc-grid' },
          num('primos', 'Protogemas que tienes', { step: 160 }),
          num('fates', 'Destinos entrelazados'),
          num('glitter', 'Brillos estelares', { hint: '5 brillos = 1 tirada' }),
          num('extra', 'Extra al mes', { step: 100, hint: 'Abismo, Teatro, eventos y tienda de Paimon' }),
          h('label', { class: 'gc-field' }, h('span', { text: v.banner === 'weapon' ? 'Refinamiento que quieres' : 'Constelación que quieres' }),
            h('select', { class: 'sn-select', onchange: (e) => set('copies', Number(e.target.value)) },
              (v.banner === 'weapon' ? [1, 2, 3, 4, 5].map((c) => [c, `R${c}`]) : [1, 2, 3, 4, 5, 6, 7].map((c) => [c, c === 1 ? 'El personaje (C0)' : `C${c - 1}`])).map(([c, l]) => h('option', { value: c, selected: copies === c, text: l })))),
          h('label', { class: 'gc-field' }, h('span', { text: 'Hasta el día' }), h('input', { type: 'date', class: 'rx-input', value: v.date || (nextAt ? new Date(nextAt).toLocaleDateString('sv') : ''), onchange: (e) => set('date', e.target.value) }), h('small', { class: 'hint', text: nextAt && !v.date ? 'Por defecto, el inicio de la próxima versión' : '' })),
          h('label', { class: 'gc-field' }, h('span', { text: 'Tiradas desde tu último 5★' }), h('input', { type: 'number', class: 'rx-input', min: 0, max: v.banner === 'weapon' ? 79 : 89, value: pity, onchange: (e) => set('pity', Number(e.target.value) || 0) }), pool && v.pity == null && h('small', { class: 'hint', text: 'Leído de tu historial de deseos' })),
          h('label', { class: 'rx-check gc-check' }, h('input', { type: 'checkbox', checked: !!guaranteed, onchange: (e) => set('guaranteed', e.target.checked) }), h('span', { text: v.banner === 'weapon' ? 'Tengo el punto de destino (el próximo 5★ es el elegido)' : 'El próximo 5★ es garantizado (perdí el 50/50)' })),
          h('label', { class: 'rx-check gc-check' }, h('input', { type: 'checkbox', checked: !!v.welkin, onchange: (e) => set('welkin', e.target.checked) }), h('span', { text: 'Tengo la Bendición de la Luna (+90 al día)' }))
        ),
        h('p', { class: 'hint', text: v.banner === 'weapon' ? 'Arma: probabilidad base 0,7 %, segura en la 80 y con el Camino Trazado (37,5 % de que salga la elegida, garantizada después de fallar una).' : 'Personaje: probabilidad base 0,6 %, sube desde la 74, segura en la 90. El 50/50 cuenta el «Brillo capturado» (≈ 55 % de ganar).' })
      )
    );
  }
  window.gcalcUI = { render: renderCalc };

  // =================================================== GENSHIN: ESPECIALIDADES Y MINERALES
  const GT = { list: null, busy: false };
  const MINERALS = ['Trozo de hierro', 'Hierro blanco', 'Mineral de cristal', 'Magicristal', 'Trozo de amatista', 'Cristal de condensación', 'Fragmento de jade nocturno'];
  async function gatherLoad() {
    if (GT.busy || GT.list) return;
    GT.busy = true;
    GT.list = await window.api.gather.get().catch(() => []);
    GT.busy = false;
    window.renderGenshin?.();
  }
  async function gatherSave(list) {
    GT.list = await window.api.gather.set(list);
    window.renderGenshin?.();
  }
  const leftH = (t) => {
    const m = Math.round((t - Date.now()) / 60000);
    if (m <= 0) return null;
    return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`;
  };
  window.gatherCard = (result) => {
    gatherLoad();
    const list = GT.list || [];
    const have = new Set(list.map((g) => g.name.toLowerCase()));
    const fromPlan = (result?.materials || []).filter((m) => m.group === 'local' && !have.has(m.name.toLowerCase()));
    const name = h('input', { class: 'rx-input', placeholder: 'Qué recogiste (ej.: Lirio calla)' });
    name.setAttribute('list', 'gtMinerals');
    const kind = h('select', { class: 'sn-select' }, h('option', { value: 'especialidad', text: 'Especialidad (48 h)' }), h('option', { value: 'mineral', text: 'Mineral (72 h)' }));
    const where = h('input', { class: 'rx-input gt-where', placeholder: 'Dónde (opcional)' });
    const add = (n, k, icon, w) => gatherSave([...list, { name: n, kind: k, where: w || '', icon: icon || '', at: Date.now() }]);
    const sorted = list.slice().sort((a, b) => a.readyAt - b.readyAt);
    return h('section', { class: 'rx-card gt' },
      h('div', { class: 'gt-head' }, h('h3', { text: 'Especialidades y minerales' }), h('span', { class: 'hint', text: 'Pulsa «Ya recogí» al pasar por la ruta y te aviso cuando vuelvan a salir.' })),
      sorted.length ? h('ul', { class: 'gt-list' }, sorted.map((g) => {
        const left = leftH(g.readyAt);
        const pct = Math.min(100, ((Date.now() - g.at) / (g.readyAt - g.at)) * 100);
        return h('li', { class: left ? '' : 'ready' },
          g.icon ? h('img', { src: g.icon, alt: '', loading: 'lazy' }) : h('span', { class: `gt-ico ${g.kind}` }),
          h('div', { class: 'gt-main' }, h('b', { text: g.name }), h('small', { class: 'hint', text: [g.kind === 'mineral' ? 'Mineral' : 'Especialidad', g.where].filter(Boolean).join(' · ') }), h('div', { class: 'dy-bar' }, h('i', { style: { width: `${pct}%` } }))),
          h('span', { class: 'gt-left', text: left ? `en ${left}` : 'Listo' }),
          h('button', { class: left ? 'btn subtle small' : 'btn primary small', text: 'Ya recogí', onclick: () => gatherSave(list.map((x) => (x.id === g.id ? { ...x, at: Date.now(), notified: false } : x))) }),
          h('button', { class: 'btn subtle small', 'aria-label': `Quitar ${g.name}`, text: '×', onclick: () => gatherSave(list.filter((x) => x.id !== g.id)) })
        );
      })) : h('p', { class: 'hint', text: 'Todavía no anotaste ninguna recolección.' }),
      fromPlan.length ? h('div', { class: 'gt-quick' }, h('span', { class: 'hint', text: 'De tu plan:' }), fromPlan.map((m) => h('button', { class: 'chip', onclick: () => add(m.name, 'especialidad', m.icon) }, m.icon && h('img', { src: m.icon, alt: '' }), `${m.name} ×${m.count}`))) : null,
      h('div', { class: 'gt-add rx-row' }, name, kind, where, h('button', { class: 'btn ghost small', text: 'Ya recogí', onclick: () => { const n = name.value.trim(); if (!n) return name.focus(); add(n, MINERALS.includes(n) ? 'mineral' : kind.value, '', where.value.trim()); } })),
      h('datalist', { id: 'gtMinerals' }, MINERALS.map((m) => h('option', { value: m }))),
      h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: state.settings?.gatherAlerts !== false, onchange: (e) => window.api.saveSettings({ gatherAlerts: e.target.checked }) }), h('span', { text: 'Avisarme cuando vuelvan a salir' }))
    );
  };

  // =================================================== PREGÚNTALE A VIPERTECA
  const AS = { messages: [], session: null, model: 'sonnet', busy: false, status: null, loaded: false };
  const SUGGEST = ['¿Qué tengo que pagar esta semana?', '¿Cuánto llevo gastado este mes y en qué?', '¿Qué juego instalado me conviene terminar primero?', '¿Cuánto son 250 dólares en colones hoy?', '¿Qué le regalo a Emi para su cumpleaños?', '¿Qué trámites se me vencen pronto?'];
  // Markdown mínimo (negrita, cursiva, código, listas y párrafos) sin innerHTML
  function inline(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('**')) out.push(h('strong', { text: t.slice(2, -2) }));
      else if (t.startsWith('`')) out.push(h('code', { text: t.slice(1, -1) }));
      else out.push(h('em', { text: t.slice(1, -1) }));
      last = m.index + t.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function md(text) {
    const blocks = [];
    let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trimEnd();
      const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (li) {
        if (!list) blocks.push((list = h(/^\s*\d/.test(line) ? 'ol' : 'ul', {})));
        list.append(h('li', {}, inline(li[1])));
        continue;
      }
      list = null;
      if (!line.trim()) continue;
      const hd = line.match(/^#{1,4}\s+(.*)$/);
      blocks.push(hd ? h('h4', {}, inline(hd[1])) : h('p', {}, inline(line)));
    }
    return blocks;
  }
  async function asLoad() {
    if (AS.loaded) return;
    AS.loaded = true;
    const hist = await window.api.assist.history().catch(() => null);
    if (hist) Object.assign(AS, { messages: hist.messages || [], session: hist.session, model: hist.model || 'sonnet' });
    asRender();
  }
  const persist = () => window.api.assist.save({ session: AS.session, model: AS.model, messages: AS.messages.filter((m) => m.role !== 'status') });
  async function asSend(text) {
    const t = String(text || '').trim();
    if (!t || AS.busy) return;
    AS.messages.push({ role: 'user', text: t, at: Date.now() });
    AS.busy = true;
    AS.status = 'Leyendo tus datos…';
    asRender();
    try {
      await window.api.assist.send({ text: t, session: AS.session, model: AS.model });
    } catch (e) {
      AS.busy = false;
      AS.messages.push({ role: 'error', text: errMsg(e) });
      asRender();
    }
  }
  window.api.claude.onEvent(({ chatId, ev }) => {
    if (chatId !== 'assist') return;
    if (ev.type === 'system' && ev.subtype === 'init') {
      AS.session = ev.session_id;
      AS.status = 'Pensando…';
    } else if (ev.type === 'assistant') {
      const m = ev.message || {};
      for (const part of m.content || []) {
        if (part.type === 'text' && part.text) {
          const last = AS.messages[AS.messages.length - 1];
          if (last?.role === 'assistant' && last.id === m.id) last.text += part.text;
          else AS.messages.push({ role: 'assistant', id: m.id, text: part.text, at: Date.now() });
          AS.status = null;
        } else if (part.type === 'tool_use') {
          AS.status = part.name === 'Read' ? 'Mirando tus datos…' : part.name === 'WebSearch' ? `Buscando en la web: ${part.input?.query || ''}` : part.name === 'WebFetch' ? 'Leyendo una página…' : 'Buscando…';
        }
      }
    } else if (ev.type === 'result') {
      if (ev.session_id) AS.session = ev.session_id;
      if (ev.is_error) AS.messages.push({ role: 'error', text: ev.result || 'No pude terminar la respuesta.' });
    } else if (ev.type === 'vt-error') {
      AS.messages.push({ role: 'error', text: ev.message });
    } else if (ev.type === 'vt-end') {
      AS.busy = false;
      AS.status = null;
      if (ev.code && ev.stderr) AS.messages.push({ role: 'error', text: /login|auth|log in/i.test(ev.stderr) ? 'Claude Code no tiene la sesión iniciada. Abre una terminal, escribe «claude» e inicia sesión una vez.' : ev.stderr });
      persist();
    }
    asRender();
  });
  function asRender() {
    const box = document.getElementById('assistBody');
    if (!box || document.getElementById('assistView').hidden) return;
    const input = h('textarea', { class: 'as-input', rows: 2, placeholder: 'Pregunta lo que quieras: pagos, juegos, Genshin, trámites, el dólar…', 'aria-label': 'Tu pregunta' });
    const prev = box.querySelector('.as-input');
    if (prev) input.value = prev.value;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        asSend(input.value);
      }
    });
    const empty = !AS.messages.length;
    fill(box,
      h('div', { class: `as-wrap ${empty ? 'empty' : ''}` },
        empty
          ? h('div', { class: 'as-hello' },
              h('div', { class: 'as-orb', 'aria-hidden': 'true' }),
              h('h2', { text: '¿En qué te ayudo?' }),
              h('p', { class: 'hint', text: 'Conozco tu agenda, tus pagos, el presupuesto, los trámites, tus juegos y Genshin. Y si hace falta, busco en internet.' }),
              h('div', { class: 'as-suggest' }, SUGGEST.map((s) => h('button', { class: 'as-sug', text: s, onclick: () => asSend(s) })))
            )
          : h('ol', { class: 'as-log', 'aria-live': 'polite' },
              AS.messages.map((m) => h('li', { class: `as-msg ${m.role}` }, m.role === 'assistant' ? md(m.text) : h('p', { text: m.text }))),
              AS.busy && h('li', { class: 'as-msg status' }, h('span', { class: 'as-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: AS.status || 'Pensando…' }))
            ),
        h('div', { class: 'as-bar' },
          input,
          h('div', { class: 'as-tools' },
            h('select', { class: 'sn-select', 'aria-label': 'Modelo', onchange: (e) => { AS.model = e.target.value; persist(); } }, [['haiku', 'Rápido (Haiku)'], ['sonnet', 'Equilibrado (Sonnet)'], ['opus', 'El más listo (Opus)']].map(([v, l]) => h('option', { value: v, selected: AS.model === v, text: l }))),
            !empty && h('button', { class: 'btn subtle small', text: 'Nueva conversación', disabled: AS.busy, onclick: () => { AS.messages = []; AS.session = null; persist(); asRender(); } }),
            AS.busy ? h('button', { class: 'btn ghost', text: 'Parar', onclick: () => window.api.assist.stop() }) : h('button', { class: 'btn primary', text: 'Preguntar', onclick: () => asSend(input.value) })
          )
        )
      )
    );
    const log = box.querySelector('.as-log');
    if (log) log.scrollTop = log.scrollHeight;
    if (!AS.busy) box.querySelector('.as-input')?.focus();
  }
  window.assistUI = {
    show: () => {
      asRender();
      asLoad();
    },
  };
})();

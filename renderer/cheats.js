'use strict';
// Trucos de ViperTeca: buscar un valor en la memoria del juego (oro, vida,
// munición…), filtrarlo, cambiarlo o congelarlo, guardarlo por juego, darle un
// atajo de teclado e importar tablas de Cheat Engine. Solo juegos de un jugador.
(function () {
  const api = window.api.cheats;
  const C = { procs: null, target: null, busy: null, progress: null, scanned: false, results: null, type: 'int32', table: [], values: {}, frozen: new Set(), error: null, timer: null };
  const TYPES = [
    ['int32', 'Número entero (lo normal: oro, munición…)'],
    ['float', 'Número con decimales (vida, energía…)'],
    ['double', 'Decimal de alta precisión'],
    ['int16', 'Entero pequeño (2 bytes)'],
    ['byte', 'Byte (0-255)'],
    ['int64', 'Entero grande (8 bytes)'],
  ];
  const KEYS = ['', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Alt+1', 'Alt+2', 'Alt+3', 'Num1', 'Num2', 'Num3'];
  const hexAddr = (a) => '0x' + Math.floor(a).toString(16).toUpperCase();
  const fmtVal = (v, t) => (v == null || Number.isNaN(v) ? '—' : t === 'float' || t === 'double' ? Number(v).toFixed(2) : String(v));
  const visible = () => !$('#cheatsView').hidden;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  api.onEvent((m) => {
    if (m.progress != null) {
      C.progress = m.progress;
      render();
    } else if (m.event === 'exited') {
      if (C.target) toast(`${C.target.name} se cerró. Los trucos se han desactivado.`);
      C.target = null;
      C.frozen.clear();
      C.results = null;
      C.scanned = false;
      stopLive();
      render();
    } else if (m.event === 'hotkey') {
      m.on ? C.frozen.add(m.key) : C.frozen.delete(m.key);
      render();
    }
  });

  async function show() {
    render();
    if (!C.target) loadProcs();
  }

  async function loadProcs() {
    C.busy = 'Buscando juegos abiertos…';
    render();
    try {
      C.procs = await api.procs();
    } catch (e) {
      C.error = errMsg(e);
    }
    C.busy = null;
    render();
  }

  async function attach(p) {
    C.busy = `Conectando con ${p.name}…`;
    C.error = null;
    render();
    try {
      const r = await api.attach(p);
      C.target = { ...p, ...r };
      C.table = r.table || [];
      C.results = null;
      C.scanned = false;
      C.frozen.clear();
      await syncHotkeys();
      startLive();
    } catch (e) {
      C.error = errMsg(e);
    }
    C.busy = null;
    render();
  }

  async function detach() {
    await api.detach().catch(() => {});
    C.target = null;
    C.frozen.clear();
    stopLive();
    loadProcs();
  }

  async function scan(first) {
    const val = $('#chValue')?.value;
    const mode = first ? 'exact' : $('#chMode')?.value || 'exact';
    if ((first || mode === 'exact') && (val === '' || val == null)) return toast('Escribe el valor que ves en el juego.', true);
    C.busy = first ? 'Buscando en la memoria del juego…' : 'Filtrando…';
    C.progress = first ? 0 : null;
    render();
    try {
      const r = first ? await api.call('firstScan', { type: C.type, value: val }) : await api.call('nextScan', { mode, value: val });
      C.scanned = true;
      C.results = await api.call('results', { limit: 100 });
      if (r.capped) toast('Hay demasiados resultados: cambia el valor en el juego y filtra.');
    } catch (e) {
      toast(errMsg(e), true);
    }
    C.busy = null;
    C.progress = null;
    render();
  }

  async function addResult(it) {
    const where = await api.call('where', { addr: it.addr }).catch(() => null);
    const entry = { id: newId(), desc: `Valor ${C.table.length + 1}`, type: C.results.type, ...(where ? { module: where.module, offset: where.offset } : { addr: it.addr, dynamic: true }), value: it.value, hotkey: '' };
    C.table = [...C.table, entry];
    await saveTable();
    render();
  }

  async function saveTable() {
    await api.saveTable(C.table.map(({ id, desc, type, module, offset, addr, pointer, dynamic, value, hotkey }) => ({ id, desc, type, module, offset, addr, pointer, dynamic, value, hotkey })));
    await syncHotkeys();
  }

  async function syncHotkeys() {
    const list = C.table.filter((e) => e.hotkey).map((e) => ({ key: e.id, accel: e.hotkey, entry: e, value: Number(e.value) }));
    const r = await api.hotkeys(list).catch(() => ({ failed: [] }));
    if (r.failed?.length) toast(`No se pudieron usar estos atajos (los usa otro programa): ${r.failed.join(', ')}`, true);
  }

  async function setValue(e, v) {
    try {
      await api.call('set', { entry: e, value: v });
      e.value = Number(v);
      if (C.frozen.has(e.id)) await api.freeze(e.id, e, Number(v), true);
      await saveTable();
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  async function toggleFreeze(e, on) {
    try {
      await api.freeze(e.id, e, Number(e.value), on);
      on ? C.frozen.add(e.id) : C.frozen.delete(e.id);
    } catch (err) {
      toast(errMsg(err), true);
    }
    render();
  }

  async function importCT() {
    try {
      const r = await api.importCT();
      if (!r) return;
      C.table = [...C.table, ...r.entries.map((e) => ({ ...e, value: 0, hotkey: '' }))];
      await saveTable();
      toast(`Importados ${plural(r.entries.length, 'truco', 'trucos')}${r.skipped.length ? `; ${r.skipped.length} usan scripts de Cheat Engine y no son compatibles` : ''}.`);
      render();
    } catch (e) {
      toast(errMsg(e), true);
    }
  }

  // Valores en vivo de la tabla y de los resultados cada segundo
  function startLive() {
    stopLive();
    C.timer = setInterval(async () => {
      if (!C.target || !visible() || document.visibilityState !== 'visible') return;
      try {
        if (C.table.length) {
          const vals = await api.call('read', { entries: C.table });
          C.table.forEach((e, i) => (C.values[e.id] = vals[i]));
        }
        if (C.results?.items?.length && !C.busy) C.results = await api.call('results', { limit: 100 });
        updateLive();
      } catch {}
    }, 1000);
  }
  function stopLive() {
    if (C.timer) clearInterval(C.timer);
    C.timer = null;
  }
  function updateLive() {
    for (const e of C.table) {
      const el = document.querySelector(`[data-live="${e.id}"]`);
      const v = C.values[e.id];
      if (el) el.textContent = v?.ok ? fmtVal(v.value, e.type) : v?.error ? 'no encontrado' : '—';
    }
    document.querySelectorAll('[data-res]').forEach((el) => {
      const it = C.results?.items?.[Number(el.dataset.res)];
      if (it) el.textContent = fmtVal(it.value, C.results.type);
    });
  }

  // ---- vista ----
  function render() {
    const box = $('#cheatsBody');
    $('#countCheats').textContent = C.frozen.size ? String(C.frozen.size) : '';
    if (!box || !visible()) return;
    if (!C.target) return fill(box, pickView());
    fill(box, attachedView());
    updateLive();
  }

  function pickView() {
    const list = C.procs || [];
    return [
      h(
        'div',
        { class: 'ch-intro' },
        h('ol', { class: 'steps' },
          h('li', {}, h('b', { text: 'Abre el juego y elígelo aquí.' }), h('span', { text: 'Solo juegos de un jugador: si un juego lleva antitrampas (Genshin, Fortnite, Valorant…), ViperTeca no lo toca para que no pierdas tu cuenta.' })),
          h('li', {}, h('b', { text: 'Busca el valor que quieres cambiar.' }), h('span', { text: 'Por ejemplo tu oro: escribe cuánto tienes, cambia esa cantidad en el juego (gasta o gana) y filtra con el número nuevo hasta que queden pocos resultados.' })),
          h('li', {}, h('b', { text: 'Fíjalo y ponle un atajo.' }), h('span', { text: 'Cámbialo al número que quieras o congélalo para que no baje. Con un atajo (F5, Ctrl+1…) lo activas sin salir del juego. Se guarda para la próxima vez.' }))
        )
      ),
      C.error && h('p', { class: 'hint bad', text: C.error }),
      h('div', { class: 'row ch-head' }, h('h2', { class: 'section-h', text: 'Juegos abiertos' }), h('button', { class: 'btn ghost small', disabled: !!C.busy, text: C.busy || 'Actualizar lista', onclick: loadProcs })),
      list.length
        ? h(
            'div',
            { class: 'ch-procs' },
            list.map((p) =>
              h(
                'button',
                { class: `ch-proc${p.blocked ? ' blocked' : ''}${p.game ? ' game' : ''}`, disabled: !!C.busy, onclick: () => attach(p), title: p.path },
                h('b', { text: p.title || p.name }),
                h('span', { class: 'hint', text: `${p.name}.exe${p.game ? ', de tu biblioteca' : ''}` }),
                p.blocked && h('span', { class: 'ch-tag bad', text: 'En línea: no disponible' })
              )
            )
          )
        : h('p', { class: 'hint', text: C.procs ? 'No hay ningún juego abierto. Abre uno y pulsa «Actualizar lista».' : 'Cargando…' }),
    ];
  }

  function attachedView() {
    const t = C.target;
    const typeSel = h('select', { 'aria-label': 'Tipo de valor', disabled: C.scanned, onchange: (e) => (C.type = e.target.value) }, TYPES.map(([v, l]) => h('option', { value: v, text: l, selected: C.type === v })));
    const value = h('input', { id: 'chValue', type: 'text', inputMode: 'decimal', class: 'ch-value', placeholder: 'Valor que ves en el juego', 'aria-label': 'Valor' });
    value.addEventListener('keydown', (e) => e.key === 'Enter' && scan(!C.scanned));
    const mode = h('select', { id: 'chMode', 'aria-label': 'Cómo ha cambiado' }, [['exact', 'Ahora vale exactamente'], ['increased', 'Ha subido'], ['decreased', 'Ha bajado'], ['changed', 'Ha cambiado'], ['unchanged', 'No ha cambiado']].map(([v, l]) => h('option', { value: v, text: l })));
    const r = C.results;
    return [
      h(
        'div',
        { class: 'ch-target' },
        h('div', {}, h('p', { class: 'hero-kicker', text: 'Conectado' }), h('h2', { text: t.title || t.name }), h('span', { class: 'hint', text: `${t.name}.exe, proceso ${t.pid}` })),
        h('button', { class: 'btn ghost', text: 'Desconectar', onclick: detach })
      ),
      h(
        'div',
        { class: 'ch-grid' },
        h(
          'section',
          { class: 'ch-card' },
          h('h3', { class: 'sheet-h', text: 'Buscar un valor' }),
          h('label', { class: 'lux-field' }, h('span', { text: 'Tipo' }), typeSel),
          h('div', { class: 'row' }, C.scanned && mode, value),
          h(
            'div',
            { class: 'row' },
            !C.scanned
              ? h('button', { class: 'btn primary', disabled: !!C.busy, text: 'Primera búsqueda', onclick: () => scan(true) })
              : [h('button', { class: 'btn primary', disabled: !!C.busy, text: 'Filtrar', onclick: () => scan(false) }), h('button', { class: 'btn ghost', disabled: !!C.busy, text: 'Empezar de nuevo', onclick: () => { C.scanned = false; C.results = null; render(); } })]
          ),
          C.busy && h('div', {}, h('p', { class: 'hint', text: C.busy }), C.progress != null && h('div', { class: 'bar wide' }, h('i', { style: { width: `${C.progress}%` } }))),
          r &&
            h(
              'div',
              { class: 'ch-results' },
              h('p', { class: 'hint', text: r.count === 0 ? 'Sin resultados. Empieza de nuevo y prueba otro tipo de valor.' : r.count > 100 ? `${r.count.toLocaleString('es')} resultados: cambia el valor en el juego y filtra otra vez.` : `${plural(r.count, 'resultado', 'resultados')}. Añade el que cambie a la vez que en el juego.` }),
              r.count > 0 &&
                h(
                  'ol',
                  {},
                  r.items.slice(0, 100).map((it, i) => h('li', {}, h('code', { text: it.where ? `${it.where.module}+${it.where.offset.toString(16).toUpperCase()}` : hexAddr(it.addr) }), h('b', { 'data-res': String(i), text: fmtVal(it.value, r.type) }), h('button', { class: 'btn ghost small', text: 'Añadir', onclick: () => addResult(it) })))
                )
            )
        ),
        h(
          'section',
          { class: 'ch-card' },
          h('div', { class: 'row ch-head' }, h('h3', { class: 'sheet-h', text: 'Mis trucos' }), h('button', { class: 'btn ghost small', text: 'Importar tabla .CT…', onclick: importCT })),
          C.table.length
            ? h(
                'ul',
                { class: 'ch-table' },
                C.table.map((e) => {
                  const on = C.frozen.has(e.id);
                  const desc = h('input', { type: 'text', class: 'ch-desc', value: e.desc, maxLength: 60, 'aria-label': 'Nombre del truco' });
                  desc.addEventListener('change', () => { e.desc = desc.value.trim() || e.desc; saveTable(); });
                  const val = h('input', { type: 'text', inputMode: 'decimal', class: 'ch-set', value: e.value ?? '', 'aria-label': `Valor para ${e.desc}` });
                  val.addEventListener('keydown', (ev) => ev.key === 'Enter' && setValue(e, val.value));
                  const key = h('select', { class: 'ch-key', 'aria-label': `Atajo de ${e.desc}`, onchange: (ev) => { e.hotkey = ev.target.value; saveTable(); } }, KEYS.map((k) => h('option', { value: k, text: k || 'Sin atajo', selected: (e.hotkey || '') === k })));
                  return h(
                    'li',
                    { class: on ? 'on' : '' },
                    h('div', { class: 'ch-row1' }, desc, h('span', { class: 'ch-live', 'data-live': e.id, text: '—' })),
                    h(
                      'div',
                      { class: 'ch-row2' },
                      val,
                      h('button', { class: 'btn ghost small', text: 'Poner', onclick: () => setValue(e, val.value) }),
                      h('label', { class: 'check ch-freeze' }, h('input', { type: 'checkbox', checked: on, onchange: (ev) => { e.value = Number(val.value || e.value); toggleFreeze(e, ev.target.checked); } }), 'Congelar'),
                      key,
                      h('button', { class: 'icon-btn', title: 'Quitar', 'aria-label': `Quitar ${e.desc}`, text: '×', onclick: async () => { if (on) await toggleFreeze(e, false); C.table = C.table.filter((x) => x !== e); await saveTable(); render(); } })
                    ),
                    h('small', { class: 'hint', text: `${TYPES.find(([v]) => v === e.type)?.[1].split(' (')[0] || e.type}, ${e.module ? `${e.module}+${Number(e.offset).toString(16).toUpperCase()}` : hexAddr(e.addr)}${e.pointer?.length ? ` con ${e.pointer.length} punteros` : ''}${e.dynamic ? '. Esta dirección cambia al reiniciar el juego: si deja de funcionar, vuelve a buscarla.' : ''}` })
                  );
                })
              )
            : h('p', { class: 'hint', text: 'Aún no tienes trucos para este juego. Busca un valor y pulsa «Añadir», o importa una tabla de Cheat Engine (.CT) de la comunidad.' }),
          C.table.some((e) => e.hotkey) && h('p', { class: 'hint', text: 'Los atajos funcionan dentro del juego mientras ViperTeca esté conectado: activan o quitan el congelado.' })
        )
      ),
    ];
  }

  window.cheats = { show };
})();

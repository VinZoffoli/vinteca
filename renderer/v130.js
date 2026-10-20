'use strict';
// 1.30: Copias (restaurar un archivo de un día concreto), calendario de juego en
// la agenda y el diario de partidas en la ficha de cada juego.
(function () {
  const LABEL = {
    'casa.json': 'Casa (pagos, compras, regalos, cumpleaños, suscripciones, vehículo…)', 'sessions.json': 'Partidas jugadas', 'user-games.json': 'Notas y estados de tus juegos',
    'genshin-wishes.json': 'Historial de deseos de Genshin', 'genshin-inventory.json': 'Inventario de Genshin', 'gfarm-plan.json': 'Plan de farmeo de Genshin', 'genshin-tasks.json': 'Tareas de Genshin',
    'anime.json': 'Anime que sigues', 'workana.json': 'Workana', 'linkedin.json': 'LinkedIn', 'alquileres.json': 'Alquileres', 'streaming.json': 'Viendo (Netflix y Crunchyroll)',
    'oneonone.json': 'Notas de los 1:1', 'journal.json': 'Diario de partidas', 'spend.json': 'Gasto en juegos', 'gift-prices.json': 'Historial de precios de regalos', 'price-history.json': 'Historial de precios de juegos',
    'uptime.json': 'Uptime de las webs', 'cwv.json': 'Velocidad de las webs', 'launch-checks.json': 'Revisiones de lanzamiento', 'team-week.json': 'La semana del equipo', 'assist-chat.json': 'Chat del asistente', 'claude-chats.json': 'Chats con Claude',
  };
  const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const C = { data: null, day: null, busy: false };
  async function load() {
    C.data = await window.api.copies.list().catch((e) => ({ error: errMsg(e) }));
    if (C.data?.days?.length && !C.day) C.day = C.data.days[0].day;
    render();
  }
  async function preview(name, cell) {
    cell.textContent = 'Leyendo…';
    try {
      const p = await window.api.copies.preview(C.day, name);
      cell.textContent = 'En la copia: ' + (p.copy || '—') + ' · Ahora: ' + (p.now || '—');
    } catch (e) {
      cell.textContent = errMsg(e);
    }
  }
  async function restore(name, btn) {
    if (btn.dataset.sure !== '1') {
      btn.dataset.sure = '1';
      btn.textContent = 'Pulsa otra vez para restaurar';
      setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ''; btn.textContent = 'Restaurar'; } }, 4000);
      return;
    }
    btn.disabled = true;
    try {
      await window.api.copies.restore(C.day, name);
      toast((LABEL[name] || name) + ' restaurado al ' + C.day + '. Lo de antes quedó guardado en «antes-de-restaurar».');
    } catch (e) {
      toast(errMsg(e), true);
      btn.disabled = false;
    }
  }
  function render() {
    const body = document.getElementById('copiesBody');
    if (!body) return;
    const d = C.data;
    if (!d) return fill(body, h('p', { class: 'hint', text: 'Buscando tus copias…' }));
    if (d.error) return fill(body, h('p', { class: 'hint bad', text: d.error }));
    if (!d.available) return fill(body, h('p', { class: 'empty' }, h('b', { text: 'No encuentro OneDrive' }), 'Las copias diarias se guardan en tu carpeta de OneDrive. Inicia sesión en OneDrive en este PC.'));
    const day = d.days.find((x) => x.day === C.day) || d.days[0];
    fill(body,
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', disabled: C.busy, text: C.busy ? 'Copiando…' : 'Hacer copia ahora', onclick: async () => { C.busy = true; render(); await window.api.copies.now().catch((e) => toast(errMsg(e), true)); C.busy = false; C.day = null; load(); } }),
        h('button', { class: 'btn ghost small', text: 'Abrir la carpeta', onclick: () => window.api.copies.open() }),
        h('span', { class: 'hint', text: 'Una copia por día, se guardan las últimas 30. Las claves y tokens nunca se copian.' })
      ),
      d.days.length ? [
        h('div', { class: 'cp-days' }, d.days.map((x) => h('button', { class: 'cp-day' + (x.day === day.day ? ' on' : ''), onclick: () => { C.day = x.day; render(); } }, h('b', { text: new Date(x.day + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) }), h('small', { text: x.files.length + ' archivos' })))),
        h('ul', { class: 'cp-files' }, day.files.sort((a, b) => (LABEL[a.name] ? 0 : 1) - (LABEL[b.name] ? 0 : 1) || a.name.localeCompare(b.name)).map((f) => {
          const info = h('small', { class: 'hint', text: f.name + ' · ' + kb(f.size) });
          return h('li', {},
            h('div', {}, h('b', { text: LABEL[f.name] || f.name }), info),
            h('button', { class: 'btn subtle small', text: 'Ver qué tiene', onclick: () => preview(f.name, info) }),
            h('button', { class: 'btn ghost small', text: 'Restaurar', onclick: (e) => restore(f.name, e.currentTarget) })
          );
        })),
      ] : h('p', { class: 'hint', text: 'Todavía no hay copias. Pulsa «Hacer copia ahora».' })
    );
  }

  // ============================================================ CALENDARIO DE JUEGO
  const KIND = { oferta: ['Oferta', '#f5b942'], gratis: ['Gratis en Epic', '#5fd8e8'], genshin: ['Genshin', '#a58bff'], lanzamiento: ['Lanzamiento', '#4fdc9b'] };
  let gc = null;
  async function gameCal() {
    const host = document.getElementById('calBody');
    if (!host) return;
    let box = document.getElementById('gameCal');
    if (!box) {
      box = h('section', { id: 'gameCal', class: 'rx-card gcal' });
      host.after(box);
    }
    if (!gc) fill(box, h('h3', { text: 'Juegos (próximos 30 días)' }), h('p', { class: 'hint', text: 'Cargando…' }));
    gc = await window.api.gameCal().catch(() => []);
    const byDay = new Map();
    for (const e of gc) {
      const k = new Date(e.at).toLocaleDateString('sv');
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
    fill(box,
      h('h3', { text: 'Juegos (próximos 30 días)' }),
      h('p', { class: 'hint', text: 'Cuándo terminan las ofertas de tu lista de deseados, los gratis de Epic, los eventos y reinicios de Genshin y los lanzamientos.' }),
      gc.length ? h('div', { class: 'gcal-days' }, [...byDay.entries()].map(([k, evs]) => h('div', { class: 'gcal-day' },
        h('b', { text: new Date(k + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) }),
        h('ul', {}, evs.map((e) => h('li', {}, h('span', { class: 'gcal-tag', style: { '--c': KIND[e.kind][1] }, text: KIND[e.kind][0] }), e.url ? h('button', { class: 'link-btn', text: e.title, onclick: () => window.api.open(e.url) }) : h('span', { text: e.title }), h('small', { class: 'hint', text: new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) }))))
      ))) : h('p', { class: 'hint', text: 'Nada a la vista.' })
    );
  }

  // ============================================================ DIARIO EN LA FICHA DEL JUEGO
  async function journalBox(g) {
    const body = document.getElementById('gameBody');
    if (!body || !g) return;
    const list = await window.api.journal.get(g.id).catch(() => []);
    document.getElementById('jrBox')?.remove();
    const ta = h('textarea', { class: 'note', rows: 2, placeholder: 'Dónde lo dejaste, qué te faltaba…' });
    body.append(h('section', { id: 'jrBox', class: 'jr' },
      h('h3', { text: 'Diario de partidas' }),
      list.length ? h('ul', { class: 'jr-list' }, list.slice().reverse().slice(0, 6).map((n) => h('li', {}, h('small', { class: 'hint', text: new Date(n.at).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) + (n.minutes ? ' · ' + n.minutes + ' min' : '') }), h('p', { text: n.text })))) : h('p', { class: 'hint', text: 'Al cerrar una partida de más de 15 minutos te pregunto dónde lo dejaste; la próxima vez que lo abras, te lo recuerdo.' }),
      h('div', { class: 'jr-add' }, ta, h('button', { class: 'btn subtle small', text: 'Añadir nota', onclick: async () => { if (!ta.value.trim()) return; await window.api.journal.save(g.id, ta.value, null); journalBox(g); } }))
    ));
  }

  // enganches: vista Copias, la agenda y la ficha de juego
  const orig = window.showView;
  if (typeof orig === 'function') {
    window.showView = function (v, ...rest) {
      const r = orig.call(this, v, ...rest);
      const cv = document.getElementById('copiesView');
      if (cv) cv.hidden = v !== 'copies';
      if (v === 'copies') load();
      if (v === 'cal') setTimeout(gameCal, 300);
      return r;
    };
  }
  const og = window.openGame;
  if (typeof og === 'function') {
    window.openGame = function (g, ...rest) {
      const r = og.call(this, g, ...rest);
      setTimeout(() => journalBox(g), 400);
      return r;
    };
  }
})();

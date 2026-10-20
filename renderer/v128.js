'use strict';
// 1.28: secciones nuevas de juegos dentro de sus pantallas:
// Estadísticas → gasto en juegos y pausas · Logros → los más fáciles ·
// Ofertas → Game Pass y próximos lanzamientos · Amigos → para jugar ahora.
(function () {
  const G = { spend: null, easy: null, gp: null, up: null, play: null, busy: {} };
  const crc = (v) => (v == null ? '—' : '₡' + Math.round(v).toLocaleString('es'));
  const box = (id, before) => {
    let el = document.getElementById(id);
    if (!el) {
      const host = document.getElementById(before);
      if (!host) return null;
      el = document.createElement('div');
      el.id = id;
      el.className = 'gx8';
      host.parentNode.insertBefore(el, host.nextSibling);
    }
    return el;
  };
  async function get(key, fn, el, render) {
    if (G.busy[key]) return;
    G.busy[key] = true;
    try {
      G[key] = await fn();
    } catch (e) {
      G[key] = { error: errMsg(e) };
    }
    G.busy[key] = false;
    render(el);
  }

  // ======================================================= GASTO
  function renderSpend(el) {
    const d = G.spend;
    if (!d) return fill(el, h('p', { class: 'hint', text: 'Cargando el gasto…' }));
    const read = async (which, btn) => {
      btn.disabled = true;
      btn.textContent = 'Leyendo…';
      try {
        const r = await window.api.gx.spendRead(which);
        toast(r.count + ' compras leídas.');
        G.spend = null;
        get('spend', window.api.gx.spend, el, renderSpend);
      } catch (e) {
        toast(errMsg(e), true);
      }
      btn.disabled = false;
      btn.textContent = 'Leer';
    };
    const src = (which, label) => h('div', { class: 'gx-src' }, h('b', { text: label }), h('small', { class: 'hint', text: d.sources?.[which] ? 'leído ' + relTime(d.sources[which] / 1000) : 'sin leer' }), h('button', { class: 'btn subtle small', text: 'Abrir historial', onclick: () => window.api.gx.spendOpen(which) }), h('button', { class: 'btn ghost small', text: 'Leer', onclick: (e) => read(which, e.currentTarget) }));
    const years = Object.entries(d.years || {}).sort((a, b) => b[0] - a[0]);
    const max = Math.max(1, ...years.map(([, v]) => v));
    const breaks = (() => {
      try {
        return JSON.parse(localStorage.getItem('vt-breaks') || 'true');
      } catch {
        return true;
      }
    })();
    return fill(el,
      h('h2', { class: 'section-h', text: 'Gasto en juegos' }),
      h('p', { class: 'hint', text: 'Abre tu historial de compras de Steam o Epic en una ventana de la app, inicia sesión tú y pulsa «Leer». Solo se lee la lista; no se guarda tu sesión fuera de la app.' }),
      h('div', { class: 'gx-srcs' }, src('steam', 'Steam'), src('epic', 'Epic Games')),
      d.error ? h('p', { class: 'hint bad', text: d.error }) : null,
      d.count ? [
        h('div', { class: 'gx-kpis' }, h('div', {}, h('b', { text: crc(d.total) }), h('span', { text: 'en total (' + d.count + ' compras)' })), d.best?.[0] ? h('div', {}, h('b', { text: crc(d.best[0].perHour) + '/h' }), h('span', { text: 'el mejor: ' + d.best[0].title })) : null),
        h('div', { class: 'gx-years' }, years.map(([y, v]) => h('div', {}, h('span', { text: y }), h('div', { class: 'sx-bar' }, h('i', { style: { width: (v / max) * 100 + '%' } })), h('b', { text: crc(v) })))),
        d.perGame?.length ? h('div', { class: 'gx-two' },
          h('section', {}, h('h3', { text: 'Lo que mejor rindió' }), h('ul', { class: 'cl-ul' }, d.best.map((x) => h('li', { text: x.title + ': ' + crc(x.perHour) + ' por hora (' + x.hours + ' h por ' + crc(x.paid) + ')' })))),
          h('section', {}, h('h3', { text: 'Lo que menos' }), h('ul', { class: 'cl-ul' }, d.worst.map((x) => h('li', { text: x.title + ': ' + crc(x.perHour) + ' por hora (' + x.hours + ' h)' }))))
        ) : null,
        !d.rate ? h('p', { class: 'hint', text: 'Las compras en dólares se pasan a colones con el tipo de cambio del día (no disponible ahora).' }) : null,
      ] : null,
      h('label', { class: 'rx-check gx-break' }, h('input', { type: 'checkbox', checked: breaks, onchange: (e) => { localStorage.setItem('vt-breaks', JSON.stringify(e.target.checked)); window.api.saveSettings({ breakReminders: e.target.checked }); } }), h('span', { text: 'Pausas al jugar: cada 2 h seguidas sale un aviso suave arriba de la pantalla (sin sonido ni notificación de Windows).' }))
    );
  }

  // ======================================================= LOGROS FÁCILES
  function renderEasy(el) {
    const d = G.easy;
    if (!d) return fill(el, h('p', { class: 'hint', text: 'Buscando los logros más fáciles que te faltan…' }));
    if (d.error) return fill(el, h('h2', { class: 'section-h', text: 'Los más fáciles que te faltan' }), h('p', { class: 'hint', text: d.error }));
    return fill(el,
      h('div', { class: 'gd-head' }, h('h2', { class: 'section-h', text: 'Los más fáciles que te faltan' }), h('button', { class: 'btn subtle small', text: 'Actualizar', onclick: () => { G.easy = null; renderEasy(el); get('easy', () => window.api.gx.easy(true), el, renderEasy); } })),
      h('p', { class: 'hint', text: 'De tus juegos más avanzados, los logros que más jugadores tienen: los más rápidos para acercarte al 100 %.' }),
      h('div', { class: 'gx-ach' }, (d.list || []).slice(0, 24).map((a) => h('article', {}, a.icon ? h('img', { src: a.icon, alt: '', loading: 'lazy' }) : h('span'), h('div', {}, h('b', { text: a.name }), h('small', { class: 'hint', text: a.game + ' · ' + a.gameProgress + '% (te faltan ' + a.left + ')' }), a.description ? h('p', { text: a.description }) : null), h('em', { text: a.pct + '%' }))))
    );
  }

  // ======================================================= GAME PASS + LANZAMIENTOS
  function renderGp(el) {
    const d = G.gp;
    const u = G.up;
    const verdict = { rec: ['ok', 'Recomendado'], min: ['warn', 'Mínimo'], no: ['bad', 'No llega'] };
    return fill(el,
      h('h2', { class: 'section-h', text: 'PC Game Pass' }),
      !d ? h('p', { class: 'hint', text: 'Cargando el catálogo…' }) : d.error ? h('p', { class: 'hint', text: d.error }) : [
        h('p', { class: 'hint', text: d.total + ' juegos en PC Game Pass. Te aviso si un juego de tu lista de deseados llega o se va.' }),
        d.wishOnPass?.length ? h('div', {}, h('h3', { text: 'De tu lista de deseados, ya en Game Pass (' + d.wishOnPass.length + ')' }), h('div', { class: 'gx-gp' }, d.wishOnPass.map((g) => h('article', { class: g.leaving ? 'leaving' : '' }, g.img ? h('img', { src: g.img + '?w=160', alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null, h('b', { text: g.title }), g.leaving ? h('small', { class: 'bad-t', text: 'Se va pronto' }) : null)))) : h('p', { class: 'hint', text: 'Ninguno de tus deseados está en Game Pass ahora.' }),
        d.leaving?.length ? h('p', { class: 'hint', text: 'Se van pronto: ' + d.leaving.map((g) => g.title).join(' · ') }) : null,
        d.added?.length ? h('p', { class: 'hint', text: 'Llegaron desde la última vez: ' + d.added.slice(0, 12).map((g) => g.title).join(' · ') }) : null,
      ],
      h('h2', { class: 'section-h', text: 'Próximos lanzamientos de tu lista' }),
      !u ? h('p', { class: 'hint', text: 'Cargando…' }) : u.error ? h('p', { class: 'hint', text: u.error }) : u.length ? h('ul', { class: 'gx-up' }, u.map((x) => h('li', {}, h('img', { src: x.header, alt: '', loading: 'lazy' }), h('div', {}, h('b', { text: x.name }), h('small', { class: 'hint', text: x.label || (x.date ? new Date(x.date * 1000).toLocaleDateString('es', { day: x.exact ? 'numeric' : undefined, month: 'long', year: 'numeric' }) : 'Sin fecha') })), x.run?.verdict ? h('span', { class: 'cl-tag cl-t-' + verdict[x.run.verdict][0], text: verdict[x.run.verdict][1] }) : h('span', { class: 'hint', text: '' })))) : h('p', { class: 'hint', text: 'Nada de tu lista de deseados tiene fecha de salida próxima.' }),
      h('p', { class: 'hint', text: 'Te aviso 3 días antes, el día anterior (para dejarlo precargando) y el día que sale, con si tu PC lo mueve.' })
    );
  }

  // ======================================================= JUGAR AHORA
  function renderPlay(el) {
    const d = G.play;
    if (!d) return fill(el, h('p', { class: 'hint', text: 'Mirando quién está conectado…' }));
    if (d.error) return fill(el);
    return fill(el,
      h('div', { class: 'gd-head' }, h('h2', { class: 'section-h', text: 'Para jugar ahora' }), h('button', { class: 'btn subtle small', text: 'Actualizar', onclick: () => { G.play = null; renderPlay(el); get('play', window.api.friendsPlayNow, el, renderPlay); } })),
      !d.online ? h('p', { class: 'hint', text: 'Ningún amigo conectado ahora.' }) : d.list?.length ? h('ul', { class: 'gx-play' }, d.list.map((r) => h('li', {}, h('b', { text: r.title || r.name }), h('small', { class: 'hint', text: 'Lo tienen ' + (r.who || []).map((w) => w.name || w).join(', ') }), h('button', { class: 'btn subtle small', text: 'Jugar', onclick: () => r.id && window.api.launchGame(r.id) })))) : h('p', { class: 'hint', text: d.online + ' amigos conectados, pero sin juegos multijugador en común.' })
    );
  }

  // ======================================================= ENGANCHE CON LAS PANTALLAS
  function after(view) {
    if (view === 'stats') {
      const el = box('gxSpend', 'statsBody');
      if (el) {
        renderSpend(el);
        if (!G.spend) get('spend', window.api.gx.spend, el, renderSpend);
      }
    }
    if (view === 'deals') {
      const host = document.getElementById('dealsView');
      let el = document.getElementById('gxGp');
      if (host && !el) {
        el = document.createElement('div');
        el.id = 'gxGp';
        el.className = 'gx8';
        host.append(el);
      }
      if (el) {
        renderGp(el);
        if (!G.gp) get('gp', () => window.api.gx.gamepass(false), el, renderGp);
        if (!G.up) get('up', window.api.gx.upcoming, el, renderGp);
      }
    }
    if (view === 'friends') {
      const host = document.getElementById('friendsBody');
      let el = document.getElementById('gxPlay');
      if (host && !el) {
        el = document.createElement('div');
        el.id = 'gxPlay';
        el.className = 'gx8';
        host.before(el);
      }
      if (el) {
        renderPlay(el);
        if (!G.play) get('play', window.api.friendsPlayNow, el, renderPlay);
      }
    }
  }
  const orig = window.showView;
  if (typeof orig === 'function') {
    window.showView = function (v, ...rest) {
      const r = orig.call(this, v, ...rest);
      try {
        setTimeout(() => after(v), 0);
      } catch {}
      return r;
    };
  }
  window.v128 = { after };
})();

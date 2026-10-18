'use strict';
// Panel para la pantalla vertical del case: tu día de un vistazo, de arriba abajo.
// Hora y clima, el juego y sus FPS (si juegas), temperaturas, Spotify, la agenda,
// pagos y cosas de la casa, tickets y correo, Genshin y anime. Se actualiza solo.
(function () {
  const root = document.getElementById('panel');
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const time = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const until = (t) => {
    const m = Math.round((t - Date.now()) / 60000);
    if (m <= 0) return 'ahora';
    if (m < 60) return `en ${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `en ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `en ${Math.round(h / 24)} d`;
  };
  const when = (d) => (d < 0 ? 'atrasado' : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} d`);
  const money = (v, c) => `${Number(v).toLocaleString('es')} ${c || ''}`.trim();
  const fmtMs = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const tone = (t, warm, hot) => (t == null ? '' : t >= hot ? 'hot' : t >= warm ? 'warm' : 'ok');
  const WX = (c) => (c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 82 ? '🌧️' : '⛈️');
  const svgNs = 'http://www.w3.org/2000/svg';

  function ring(label, value, unit, sub, cls, pct) {
    const box = el('div', `pn-ring ${cls || ''}`);
    const r = 44;
    const c = 2 * Math.PI * r;
    const s = document.createElementNS(svgNs, 'svg');
    s.setAttribute('viewBox', '0 0 100 100');
    s.setAttribute('aria-hidden', 'true');
    const bg = document.createElementNS(svgNs, 'circle');
    bg.setAttribute('cx', 50); bg.setAttribute('cy', 50); bg.setAttribute('r', r); bg.setAttribute('class', 'pn-ring-bg');
    const fg = document.createElementNS(svgNs, 'circle');
    fg.setAttribute('cx', 50); fg.setAttribute('cy', 50); fg.setAttribute('r', r); fg.setAttribute('class', 'pn-ring-fg');
    fg.setAttribute('stroke-dasharray', `${(Math.max(0, Math.min(100, pct || 0)) / 100) * c} ${c}`);
    s.append(bg, fg);
    const mid = el('div', 'pn-ring-mid');
    mid.append(el('b', '', value), el('span', '', unit));
    box.append(s, mid, el('p', 'pn-ring-label', label), el('p', 'pn-ring-sub', sub || ''));
    return box;
  }
  function card(title, dot, ...kids) {
    const body = kids.flat().filter(Boolean);
    if (!body.length) return null;
    const c = el('section', 'pn-card');
    const h = el('h2');
    const i = el('i', 'pn-dot');
    i.style.background = dot || 'var(--amber)';
    h.append(i, document.createTextNode(title));
    c.append(h, ...body);
    return c;
  }
  function list(rows) {
    if (!rows.length) return null;
    const ul = el('ul', 'pn-list');
    for (const [main, side, hot, sub] of rows) {
      const li = el('li', hot ? 'hot' : '');
      const t = el('div');
      t.append(el('span', '', main));
      if (sub) t.append(el('small', '', sub));
      li.append(t);
      if (side != null) li.append(el('b', '', side));
      ul.append(li);
    }
    return ul;
  }

  let live = null; // sensores, juego, Spotify (cada 2 s)
  let day = null; // Mi día (cada minuto)
  function render() {
    const now = new Date();
    const d = live || {};
    const y = day;
    const parts = [];

    // ---------- hora y clima
    const top = el('header', 'pn-clock');
    top.append(el('b', '', now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })), el('span', '', now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })));
    if (y?.weather) {
      const w = y.weather;
      const wx = el('p', 'pn-wx');
      wx.append(el('span', 'pn-wx-i', WX(w.now.code)), el('b', '', `${Math.round(w.now.temp)}°`), el('span', '', `${w.now.text}${w.today ? ` · máx. ${Math.round(w.today.max)}° · lluvia ${w.today.prob} %` : ''}`));
      top.append(wx);
    }
    parts.push(top);

    // ---------- jugando: el juego manda
    if (d.game) {
      const fps = d.game.fps?.fps;
      const g = el('section', 'pn-game');
      g.append(el('p', 'pn-kicker', 'Jugando'), el('h1', '', d.game.title));
      const big = el('p', 'pn-fps');
      big.append(el('b', '', fps ? Math.round(fps) : '—'), el('span', '', 'FPS'));
      g.append(big);
      if (d.game.fps?.low1) g.append(el('p', 'pn-sub', `1 % más bajo: ${Math.round(d.game.fps.low1)} FPS`));
      parts.push(g);
    }

    // ---------- temperaturas
    const s = d.sensors;
    if (s) {
      const rings = el('section', 'pn-rings');
      const cpuT = s.cpu?.temp;
      const gpuT = s.gpu?.temp;
      rings.append(
        cpuT != null ? ring('CPU', Math.round(cpuT), '°C', s.cpu.load != null ? `${Math.round(s.cpu.load)} %` : '', tone(cpuT, 75, 88), cpuT) : ring('CPU', s.cpu?.load != null ? Math.round(s.cpu.load) : '—', '%', 'de uso', '', s.cpu?.load),
        gpuT != null ? ring('GPU', Math.round(gpuT), '°C', s.gpu.load != null ? `${Math.round(s.gpu.load)} %` : '', tone(gpuT, 72, 84), gpuT) : ring('GPU', s.gpu?.load != null ? Math.round(s.gpu.load) : '—', '%', 'de uso', '', s.gpu?.load),
        ring('RAM', Math.round(s.ram.load), '%', `${s.ram.usedGb.toFixed(1)} GB`, s.ram.load > 90 ? 'warm' : '', s.ram.load)
      );
      parts.push(rings);
    }

    // ---------- Spotify
    const sp = d.spotify;
    if (sp?.active && sp.track) {
      const m = el('section', 'pn-music');
      if (sp.track.cover) {
        const img = el('img', 'pn-cover');
        img.src = sp.track.cover;
        img.alt = '';
        m.append(img);
      }
      const info = el('div', 'pn-music-info');
      info.append(el('p', 'pn-kicker', sp.playing ? 'Sonando' : 'En pausa'), el('b', '', sp.track.name), el('span', '', sp.track.artists));
      const elapsed = Math.min(sp.track.ms, sp.progress + (sp.playing ? Date.now() - sp.at : 0));
      const bar = el('div', 'pn-bar');
      const fillBar = el('i');
      fillBar.style.width = `${(elapsed / (sp.track.ms || 1)) * 100}%`;
      bar.append(fillBar);
      info.append(bar, el('small', '', `${fmtMs(elapsed)} / ${fmtMs(sp.track.ms)}`));
      m.append(info);
      parts.push(m);
    }

    if (y) {
      // ---------- ahora: la próxima reunión y el resto del día
      const meets = y.meetings.filter((m) => !m.allDay);
      const next = meets.find((m) => m.end > Date.now());
      if (next) {
        const on = next.start <= Date.now();
        const c = el('section', 'pn-next');
        c.append(el('p', 'pn-kicker', on ? 'Reunión en curso' : `Próxima reunión · ${until(next.start)}`), el('b', 'pn-title', next.title), el('p', `pn-when ${on || next.start - Date.now() < 15 * 60000 ? 'soon' : ''}`, `${time(next.start)} – ${time(next.end)}`));
        parts.push(c);
      }
      const rest = y.meetings.filter((m) => m !== next && m.end > Date.now());
      if (rest.length) {
        const ul = el('ol', 'pn-timeline');
        for (const e of rest.slice(0, 5)) {
          const li = el('li');
          li.append(el('time', '', e.allDay ? 'Todo el día' : time(e.start)), el('span', '', e.title));
          ul.append(li);
        }
        parts.push(card('Más tarde hoy', 'var(--amber)', ul));
      }

      // ---------- cifras del día
      const grid = el('section', 'pn-stats');
      const stat = (v, label, hot) => {
        const x = el('div', `pn-stat ${hot ? 'hot' : ''}`);
        x.append(el('b', '', String(v)), el('span', '', label));
        return x;
      };
      grid.append(
        stat(y.pays.length, 'pagos esta semana', y.pays.some((p) => p.days <= 0)),
        stat(y.tickets.length, 'tickets que vencen', y.tickets.some((t) => t.late)),
        stat(y.mail ? y.mail.count : '—', 'correos sin leer'),
        y.fx ? stat(`₡${Math.round(y.fx.sell)}`, 'dólar hoy') : stat(y.shopping, 'por comprar')
      );
      parts.push(grid);

      // ---------- casa
      parts.push(card('Pagos que vienen', 'var(--green)', list(y.pays.slice(0, 4).map((p) => [p.name + (p.group && p.group !== 'Personal' ? ` (${p.group})` : ''), when(p.days), p.days <= 0, p.amount ? money(p.amount, p.currency) : null]))));
      const home = [
        ...y.bdays.map((b) => [`Cumple de ${b.name}`, when(b.days), b.days === 0]),
        ...y.rems.map((r) => [r.title, when(r.days), r.days === 0]),
        ...(y.tramites || []).filter((t) => t.days <= 14).map((t) => [t.name, when(t.days), t.days <= 3]),
        ...(y.hogar || []).map((x) => [x.name, when(x.days), x.days <= 0]),
        ...y.cats.map((c) => [`${c.cat}: ${c.type}`, when(c.days), c.days <= 0]),
      ];
      parts.push(card('En casa', 'var(--pink)', list(home.slice(0, 5))));

      // ---------- trabajo
      const late = y.tickets.filter((t) => t.late).length;
      parts.push(card(late ? `Tickets · ${late} vencidos` : 'Tickets', 'var(--pink)', list(y.tickets.slice(0, 7).map((t) => [t.title, t.late ? 'vencido' : t.deadline, t.late]))));
      if (y.mail?.count) parts.push(card(`Correo · ${y.mail.count} sin leer`, 'var(--cyan)', list(y.mail.last.slice(0, 3).map((m) => [m.subject, null, false, m.from]))));

      // ---------- Genshin y anime
      const g = [];
      if (y.resin) g.push([`Resina ${y.resin.value}/${y.resin.max}`, y.resin.value >= y.resin.max ? 'llena' : y.resin.fullAt ? until(y.resin.fullAt) : '', y.resin.value >= y.resin.max]);
      for (const x of (y.gather || []).filter((x) => x.readyAt <= Date.now()).slice(0, 2)) g.push([x.name, 'listo', true]);
      for (const r of y.resets.slice(0, 1)) g.push([r.name, until(r.at), false]);
      parts.push(card('Genshin', 'var(--cyan)', list(g)));
      if (y.anime?.length) parts.push(card('Anime', 'var(--pink)', list(y.anime.slice(0, 2).map((a) => [a.title, time(a.at), false, a.what]))));

      if (y.giveaways?.length) parts.push(card('Juegos gratis ahora', 'var(--green)', list(y.giveaways.slice(0, 3).map((x) => [x.title, x.store, false]))));
      if (y.pulls) parts.push(card('Websites', 'var(--green)', list([[y.pulls === 1 ? '1 web necesita git pull' : y.pulls + ' webs necesitan git pull', null, false]])));
      // ---------- clima por horas
      if (y.weather?.hours?.length) {
        const ol = el('ol', 'pn-hours');
        for (const h of y.weather.hours.slice(0, 6)) {
          const li = el('li', h.prob >= 60 ? 'rain' : '');
          li.append(el('small', '', h.time.slice(11, 16)), el('span', '', WX(h.code)), el('b', '', `${Math.round(h.temp)}°`));
          ol.append(li);
        }
        parts.push(ol);
      }
    }

    if (s && !d.lhm) parts.push(el('p', 'pn-hint', 'Abre LibreHardwareMonitor con su servidor web para ver temperaturas.'));
    parts.push(el('footer', 'pn-brand', 'ViperTeca'));
    root.replaceChildren(...parts.filter(Boolean));
    // si no cabe todo, se quitan las tarjetas de abajo (la pantalla no se desplaza)
    const cards = [...root.querySelectorAll('.pn-card, .pn-hours')];
    while (root.scrollHeight > root.clientHeight + 2 && cards.length) cards.pop().remove();
  }

  async function poll() {
    try {
      live = await window.api.panel.data();
    } catch {}
    render();
  }
  async function pollDay() {
    try {
      day = await window.api.day();
    } catch {}
    render();
  }
  try {
    window.appearance?.apply?.(JSON.parse(localStorage.getItem('vt-look') || 'null') || {});
  } catch {}
  poll();
  pollDay();
  setInterval(poll, 2000);
  setInterval(pollDay, 60000);
  setInterval(render, 1000);
})();

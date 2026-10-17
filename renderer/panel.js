'use strict';
// Panel para la pantalla vertical del case: hora, juego y FPS, temperaturas,
// Spotify, próxima reunión, resina de Genshin y tickets. Se actualiza solo.
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
  const fmtMs = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const tone = (t, warm, hot) => (t == null ? '' : t >= hot ? 'hot' : t >= warm ? 'warm' : 'ok');

  function ring(label, value, unit, sub, cls, pct) {
    const box = el('div', `pn-ring ${cls || ''}`);
    const r = 44;
    const c = 2 * Math.PI * r;
    const svgNs = 'http://www.w3.org/2000/svg';
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

  function card(title, ...kids) {
    const c = el('section', 'pn-card');
    if (title) c.append(el('h2', '', title));
    c.append(...kids.filter(Boolean));
    return c;
  }

  let data = null;
  function render() {
    const now = new Date();
    const d = data || {};
    const parts = [];

    const clock = el('header', 'pn-clock');
    clock.append(el('b', '', now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })), el('span', '', now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })));
    parts.push(clock);

    // juego y FPS
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

    // temperaturas / uso
    const s = d.sensors;
    if (s) {
      const rings = el('section', 'pn-rings');
      const cpuT = s.cpu?.temp;
      const gpuT = s.gpu?.temp;
      rings.append(
        cpuT != null ? ring('CPU', Math.round(cpuT), '°C', s.cpu.load != null ? `${Math.round(s.cpu.load)} % de uso` : '', tone(cpuT, 75, 88), cpuT) : ring('CPU', s.cpu?.load != null ? Math.round(s.cpu.load) : '—', '%', 'de uso', '', s.cpu?.load),
        gpuT != null ? ring('GPU', Math.round(gpuT), '°C', s.gpu.load != null ? `${Math.round(s.gpu.load)} % de uso` : '', tone(gpuT, 72, 84), gpuT) : ring('GPU', s.gpu?.load != null ? Math.round(s.gpu.load) : '—', '%', 'de uso', '', s.gpu?.load),
        ring('RAM', Math.round(s.ram.load), '%', `${s.ram.usedGb.toFixed(1)} GB`, s.ram.load > 90 ? 'warm' : '', s.ram.load)
      );
      parts.push(rings);
    }

    // Spotify
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

    // próxima reunión
    if (d.next) {
      const live = d.next.start <= Date.now();
      parts.push(card(live ? 'Reunión en curso' : 'Próxima reunión', el('b', 'pn-title', d.next.title), el('p', `pn-when ${live || d.next.start - Date.now() < 15 * 60000 ? 'soon' : ''}`, live ? `Termina a las ${time(d.next.end)}` : `${time(d.next.start)} · ${until(d.next.start)}`)));
    }

    // el resto del día
    const rest = (d.today || []).filter((e) => !d.next || e.start !== d.next.start);
    if (rest.length) {
      const ul = el('ul', 'pn-agenda');
      for (const e of rest) {
        const li = el('li');
        li.append(el('b', '', time(e.start)), el('span', '', e.title));
        ul.append(li);
      }
      parts.push(card('Más tarde hoy', ul));
    }

    // resina y tickets
    const row = el('div', 'pn-duo');
    if (d.resin) {
      const full = d.resin.value >= d.resin.max;
      row.append(card('Resina', el('p', `pn-num ${full ? 'hot' : ''}`, `${d.resin.value}/${d.resin.max}`), el('p', 'pn-sub', full ? '¡Llena!' : d.resin.fullAt ? `Llena ${until(d.resin.fullAt)}` : '')));
    }
    if (d.tickets) {
      row.append(card('Tickets', el('p', `pn-num ${d.tickets.late ? 'hot' : ''}`, String(d.tickets.open)), el('p', 'pn-sub', d.tickets.late ? `${d.tickets.late} vencidos` : 'abiertos')));
    }
    if (row.children.length) parts.push(row);

    // esta semana en casa: pagos y cumpleaños
    if (d.week?.length) {
      const ul = el('ul', 'pn-agenda');
      for (const w of d.week) {
        const li = el('li');
        li.append(el('b', '', w.days === 0 ? 'Hoy' : w.days === 1 ? 'Mañana' : `${w.days} d`), el('span', '', `${w.kind === 'pago' ? 'Pago: ' : 'Cumple: '}${w.label}`));
        ul.append(li);
      }
      parts.push(card('Esta semana', ul));
    }

    // el anime que viene
    if (d.anime) {
      const a = el('section', 'pn-anime');
      if (d.anime.cover) {
        const img = el('img');
        img.src = d.anime.cover;
        img.alt = '';
        a.append(img);
      }
      const info = el('div');
      info.append(el('p', 'pn-kicker', d.anime.what), el('b', '', d.anime.title), el('span', '', `${new Date(d.anime.at).toLocaleDateString('es', { weekday: 'long' })} ${time(d.anime.at)}`));
      a.append(info);
      parts.push(a);
    }

    // ventiladores
    if (s?.fans?.length) {
      const list = el('ul', 'pn-fans');
      for (const f of s.fans.filter((x) => x.rpm).slice(0, 6)) {
        const li = el('li');
        li.append(el('span', '', f.name), el('b', '', `${f.rpm} RPM`));
        list.append(li);
      }
      if (list.children.length) parts.push(card('Ventiladores', list));
    }

    if (s && !d.lhm) parts.push(el('p', 'pn-hint', 'Abre LibreHardwareMonitor con su servidor web para ver temperaturas.'));

    const brand = el('footer', 'pn-brand', 'ViperTeca');
    parts.push(brand);
    root.replaceChildren(...parts);
  }

  async function poll() {
    try {
      data = await window.api.panel.data();
    } catch {}
    render();
  }
  try {
    window.appearance?.apply?.(JSON.parse(localStorage.getItem('vt-look') || 'null') || {});
  } catch {}
  poll();
  setInterval(poll, 2000);
  setInterval(render, 1000);
})();

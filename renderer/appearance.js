'use strict';
// Apariencia de ViperTeca: modo (oscuro, claro o como Windows), paleta de colores
// de toda la interfaz (o una a tu gusto) y fondo con el arte de un juego.
// Los colores se calculan aquí a partir de pocos datos por paleta:
//   hue/sat = tono e intensidad del fondo; accent = jugar, instalado, botones;
//   sale = rebajas; fresh = lo nuevo.
(function () {
  const PALETTES = {
    viper: { name: 'ViperTeca', hue: 352, sat: 16, accent: '#ef2f34', sale: '#ffc247', fresh: '#62e0e8' },
    noche: { name: 'Noche', hue: 250, sat: 40, accent: '#ffb547', sale: '#ff5c8a', fresh: '#62e0e8' },
    oceano: { name: 'Océano', hue: 212, sat: 46, accent: '#3cc4ff', sale: '#ff6b9a', fresh: '#b4f06a' },
    bosque: { name: 'Bosque', hue: 160, sat: 24, accent: '#4fd88a', sale: '#ff8a6b', fresh: '#ffd65c' },
    sakura: { name: 'Sakura', hue: 328, sat: 30, accent: '#ff7ab8', sale: '#ffd166', fresh: '#7ae7ff' },
    atardecer: { name: 'Atardecer', hue: 18, sat: 28, accent: '#ff8a3d', sale: '#ff4f79', fresh: '#5fe0c8' },
    grafito: { name: 'Grafito', hue: 220, sat: 6, accent: '#e8e8ec', sale: '#ff5c8a', fresh: '#62e0e8' },
  };

  const media = window.matchMedia('(prefers-color-scheme: light)');
  let current = null;

  // ---- utilidades de color ----
  const hexToRgb = (h) => {
    const m = String(h || '').match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const hsl = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  };
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  // Oscurece (o aclara) un color hasta que se lea sobre el fondo
  function readable(color, bg, min) {
    let c = color;
    const target = lum(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = mix(c, target, 0.12);
    return c;
  }
  const ink = (c) => (contrast(c, [255, 255, 255]) >= contrast(c, [18, 14, 24]) ? '#ffffff' : '#140f1c');

  function palette(s) {
    if (s.palette === 'custom') {
      return {
        hue: Math.max(0, Math.min(360, Number(s.customHue) || 0)),
        sat: Math.max(0, Math.min(60, Number(s.customSat ?? 20))),
        accent: hexToRgb(s.customAccent) ? s.customAccent : '#ef2f34',
        sale: '#ffc247',
        fresh: '#62e0e8',
      };
    }
    return PALETTES[s.palette] || PALETTES.viper;
  }

  function tokens(p, light) {
    const { hue: h, sat: s } = p;
    const base = light
      ? { night: hsl(h, Math.min(s + 20, 70), 97), night2: [255, 255, 255], surface: hsl(h, Math.min(s + 15, 60), 93.5), surface2: hsl(h, Math.min(s + 15, 55), 89), line: hsl(h, Math.min(s + 10, 45), 83), text: hsl(h, Math.min(s + 15, 45), 13), muted: hsl(h, Math.min(s, 22), 36), faint: hsl(h, Math.min(s, 16), 52) }
      : { night: hsl(h, s, 10), night2: hsl(h, s, 12.5), surface: hsl(h, s, 15.5), surface2: hsl(h, s, 21), line: hsl(h, Math.max(s - 4, 0), 29), text: hsl(h, Math.min(s + 30, 60), 95), muted: hsl(h, Math.min(s, 24), 70), faint: hsl(h, Math.min(s, 16), 52) };
    const bg = base.night2;
    const accent = readable(hexToRgb(p.accent), bg, light ? 3.4 : 3);
    const sale = readable(hexToRgb(p.sale), bg, 3.4);
    const fresh = readable(hexToRgb(p.fresh), bg, 3.4);
    const green = readable(hexToRgb(light ? '#18804a' : '#7ee2a8'), bg, 3.4);
    return {
      '--night': rgbToHex(base.night),
      '--night-2': rgbToHex(base.night2),
      '--night-rgb': base.night.map(Math.round).join(', '),
      '--surface': rgbToHex(base.surface),
      '--surface-2': rgbToHex(base.surface2),
      '--line': rgbToHex(base.line),
      '--text': rgbToHex(base.text),
      '--muted': rgbToHex(base.muted),
      '--faint': rgbToHex(base.faint),
      '--amber': rgbToHex(accent),
      '--amber-ink': ink(accent),
      '--pink': rgbToHex(sale),
      '--cyan': rgbToHex(fresh),
      '--cyan-ink': ink(fresh),
      '--green': rgbToHex(green),
      '--plat': light ? '#3d4f99' : '#d6e4ff',
    };
  }

  function apply(s, findGame) {
    current = { s, findGame };
    // Se recuerda para pintar los colores al instante la próxima vez que se abra la app
    try {
      localStorage.setItem('vt-look', JSON.stringify({ theme: s.theme, palette: s.palette, customAccent: s.customAccent, customHue: s.customHue, customSat: s.customSat, density: s.density, radius: s.radius, glow: s.glow, uiScale: s.uiScale, motion: s.motion }));
    } catch {}
    const light = s.theme === 'system' ? media.matches : s.theme === 'light';
    const root = document.documentElement;
    root.dataset.theme = light ? 'light' : 'dark';
    root.style.colorScheme = light ? 'light' : 'dark';
    for (const [k, v] of Object.entries(tokens(palette(s), light))) root.style.setProperty(k, v);
    style(s);
    const g = s.bgGame && findGame ? findGame(s.bgGame) : null;
    const bg = document.getElementById('appBg');
    if (g?.hero && /^https:\/\//.test(g.hero)) {
      bg.style.backgroundImage = `url("${g.hero.replace(/["\\]/g, '')}")`;
      document.body.classList.add('has-bg');
    } else {
      bg.style.backgroundImage = '';
      document.body.classList.remove('has-bg');
    }
  }

  // Densidad, esquinas, brillo del fondo, tamaño y movimiento
  function style(s) {
    const root = document.documentElement;
    root.dataset.density = s.density || 'comoda';
    root.dataset.radius = s.radius || 'suaves';
    root.dataset.glow = s.glow || 'soft';
    root.dataset.motion = s.motion || 'full';
    const z = Number(s.uiScale) || 100;
    document.body ? (document.body.style.zoom = z === 100 ? '' : String(z / 100)) : null;
  }

  /** Colores de muestra de una paleta (para dibujar su botón en Ajustes). */
  function preview(id, s, light) {
    const t = tokens(palette({ ...s, palette: id }), light);
    return { bg: t['--night'], surface: t['--surface-2'], accent: t['--amber'], sale: t['--pink'], fresh: t['--cyan'], text: t['--text'] };
  }

  // Con "Como Windows", seguir el cambio de tema del sistema al momento
  media.addEventListener('change', () => {
    if (current?.s.theme === 'system') apply(current.s, current.findGame);
  });

  window.appearance = { apply, preview, PALETTES };

  // Colores de la última vez, antes de que lleguen los ajustes (evita un parpadeo)
  try {
    const last = JSON.parse(localStorage.getItem('vt-look') || 'null');
    if (last) {
      const light = last.theme === 'system' ? media.matches : last.theme === 'light';
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
      for (const [k, v] of Object.entries(tokens(palette(last), light))) document.documentElement.style.setProperty(k, v);
      if (document.body) style(last);
      else document.addEventListener('DOMContentLoaded', () => style(last), { once: true });
    }
  } catch {}
})();

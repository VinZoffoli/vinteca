'use strict';
// Modo mando: navegar la biblioteca con un mando (Xbox o compatible), como en
// Big Picture. Solo se lee el mando mientras está conectado y la ventana tiene
// el foco, para no gastar nada el resto del tiempo.
(function () {
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, .card, [tabindex="0"]';
  let raf = null;
  let prev = [];
  let repeatAt = 0;
  let lastDir = null;

  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';
  };

  // Ámbito: lo que está encima (diálogo abierto, búsqueda rápida) o la página
  function scope() {
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    if (dlg) return dlg;
    const pal = document.querySelector('#palette:not([hidden])');
    return pal || document.body;
  }

  function candidates() {
    return [...scope().querySelectorAll(FOCUSABLE)].filter(visible);
  }

  function focusEl(el) {
    if (!el) return;
    if (el.classList.contains('card') && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  // Navegación espacial: el elemento más cercano en esa dirección
  function move(dir) {
    const list = candidates();
    const cur = document.activeElement && list.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) return focusEl(list.find((e) => e.classList.contains('card')) || list[0]);
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      if (main <= 4) continue;
      const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      const score = main + cross * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) focusEl(best);
  }

  function back() {
    const pal = document.querySelector('#palette:not([hidden])');
    if (pal) return (pal.hidden = true);
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    if (dlg && dlg.id !== 'welcomeDlg') return dlg.close();
    for (const id of ['#sagaBack', '#achBack']) {
      const b = document.querySelector(id);
      if (b && visible(b)) return b.click();
    }
    document.querySelector('.side .tab[data-view="library"]')?.click();
  }

  function cycleSection(step) {
    const tabs = [...document.querySelectorAll('.side .tab')];
    const i = tabs.findIndex((t) => t.classList.contains('active'));
    const next = tabs[(i + step + tabs.length) % tabs.length];
    next?.click();
    next?.focus();
  }

  function press(b) {
    document.body.classList.add('pad');
    const el = document.activeElement;
    if (b === BTN.A) {
      if (el && el !== document.body) el.click();
      else move('down');
    } else if (b === BTN.B) back();
    else if (b === BTN.Y) {
      // Jugar al juego seleccionado
      const card = el?.closest?.('.card');
      card?.querySelector('button[data-act="main"]')?.click();
    } else if (b === BTN.X) document.querySelector('#pickBtn')?.click();
    else if (b === BTN.LB) cycleSection(-1);
    else if (b === BTN.RB) cycleSection(1);
    else if (b === BTN.START) window.api.toggleFullscreen();
    else if (b === BTN.SELECT) document.querySelector('#focusBtn')?.click();
  }

  function dirFrom(p) {
    const ax = p.axes[0] || 0;
    const ay = p.axes[1] || 0;
    const btn = (i) => p.buttons[i]?.pressed;
    if (btn(BTN.UP) || ay < -0.6) return 'up';
    if (btn(BTN.DOWN) || ay > 0.6) return 'down';
    if (btn(BTN.LEFT) || ax < -0.6) return 'left';
    if (btn(BTN.RIGHT) || ax > 0.6) return 'right';
    return null;
  }

  function loop() {
    raf = null;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) return;
    if (document.hasFocus()) {
      const p = pads[0];
      const pressed = p.buttons.map((x) => x.pressed);
      for (const b of Object.values(BTN)) {
        if (b >= BTN.UP) continue; // la cruceta se trata como dirección
        if (pressed[b] && !prev[b]) press(b);
      }
      prev = pressed;
      const dir = dirFrom(p);
      const now = performance.now();
      if (dir) {
        document.body.classList.add('pad');
        if (dir !== lastDir) {
          move(dir);
          repeatAt = now + 380;
        } else if (now >= repeatAt) {
          move(dir);
          repeatAt = now + 130;
        }
      }
      lastDir = dir;
    }
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener('gamepadconnected', (e) => {
    document.body.classList.add('pad');
    const hint = document.querySelector('#padHint');
    if (hint) hint.hidden = false;
    if (typeof toast === 'function') toast(`Mando conectado: ${e.gamepad.id.replace(/\(.*\)/, '').trim() || 'listo'}.`);
    if (!raf) raf = requestAnimationFrame(loop);
  });
  window.addEventListener('gamepaddisconnected', () => {
    const left = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0;
    if (!left) {
      document.body.classList.remove('pad');
      const hint = document.querySelector('#padHint');
      if (hint) hint.hidden = true;
    }
  });
  // Con el ratón se vuelve a la vista normal
  window.addEventListener('mousemove', () => document.body.classList.remove('pad'), { passive: true });
  window.addEventListener('focus', () => {
    if (!raf && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) raf = requestAnimationFrame(loop);
  });
})();

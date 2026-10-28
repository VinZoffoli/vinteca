'use strict';
// 1.36: el riel negro del estilo «Estudio». Logo arriba (lleva a Mi día), botón abajo para ver
// u ocultar los nombres de las secciones, y el nombre de cada icono al pasar el ratón (con el
// riel cerrado). Con «Nocturno» el logo y el botón no se ven y el menú es el de siempre.
(function () {
  const side = document.querySelector('.side');
  if (!side) return;
  const root = document.documentElement;
  const KEY = 'vt-rail';
  try {
    if (localStorage.getItem(KEY) === 'open') root.dataset.rail = 'open';
  } catch {}

  const brand = document.querySelector('.top .brand svg');
  const logo = h('button', { type: 'button', class: 'rail-logo', 'aria-label': 'Mi día', onclick: () => showView('day') });
  if (brand) logo.append(brand.cloneNode(true));
  side.prepend(logo);

  const toggle = h('button', { type: 'button', class: 'rail-toggle' });
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const label = () => {
    const open = root.dataset.rail === 'open';
    toggle.setAttribute('aria-label', open ? 'Ocultar los nombres' : 'Mostrar los nombres');
    toggle.dataset.tip = open ? 'Ocultar los nombres' : 'Mostrar los nombres';
  };
  toggle.onclick = () => {
    const open = root.dataset.rail !== 'open';
    if (open) root.dataset.rail = 'open';
    else delete root.dataset.rail;
    try {
      localStorage.setItem(KEY, open ? 'open' : 'closed');
    } catch {}
    hide();
    label();
  };
  label();
  side.append(toggle);

  // nombre flotante: va fuera del riel porque el riel recorta lo que sobresale
  const tip = h('div', { class: 'rail-tip', role: 'presentation' });
  document.body.append(tip);
  let shown = null;
  function show(el) {
    if (root.dataset.skin !== 'studio' || root.dataset.rail === 'open') return;
    const text = el.dataset.tip || el.querySelector('.tab-lbl')?.textContent || el.getAttribute('aria-label') || '';
    if (!text) return;
    const r = el.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = r.right + 12 + 'px';
    tip.style.top = r.top + r.height / 2 + 'px';
    tip.classList.add('on');
    shown = el;
  }
  function hide() {
    tip.classList.remove('on');
    shown = null;
  }
  side.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.tab, .rail-logo, .rail-toggle');
    if (el && el !== shown) show(el);
  });
  side.addEventListener('pointerleave', hide);
  side.addEventListener('scroll', hide, { passive: true });
  side.addEventListener('click', hide);
  side.addEventListener('focusin', (e) => {
    const el = e.target.closest('.tab, .rail-logo, .rail-toggle');
    if (el && el.matches(':focus-visible')) show(el);
  });
  side.addEventListener('focusout', hide);
})();

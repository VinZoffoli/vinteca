'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Pequeño creador de nodos (sin innerHTML con datos externos)
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('data-') || k.startsWith('aria-')) el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== "") el.append(c);
  return el;
}
// replaceChildren() convierte en texto lo que no es un nodo: una lista sale como
// "[object HTMLButtonElement],…" y un hueco vacío como "null". En esta página
// siempre se aplanan las listas y se descartan los huecos vacíos.
{
  const original = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) {
    return original.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
  };
}

/** Como el.replaceChildren(), pero sin escribir "null" en los huecos vacíos. */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false && k !== ''));
}

function svg(path, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}
const PLAY_ICON = 'M7 4.5v15l12-7.5z';

const PREFS_KEY = 'prefs.v2';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    const { sort, store, inst, tag, status } = state;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, store, inst, tag, status }));
  } catch {}
}

const prefs = loadPrefs();
const state = {
  lib: null,
  deals: null,
  view: 'library',
  sort: prefs.sort || 'alpha',
  store: prefs.store || 'all',
  inst: prefs.inst || 'all',
  tag: prefs.tag || '',
  status: prefs.status || '',
  user: {}, // estado, favorito, notas... de cada juego
  onlyUpd: false,
  onlyNew: false,
  showTools: false,
  q: '',
  heroId: null,
  saga: null,
  showAllWish: false,
  country: 'CL',
  focus: null,
};

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const dateFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function relTime(unix) {
  const diff = unix * 1000 - Date.now();
  const days = Math.round(diff / 86400000);
  if (Math.abs(days) < 1) {
    const hours = Math.round(diff / 3600000);
    return Math.abs(hours) < 1 ? 'hace un momento' : rtf.format(hours, 'hour');
  }
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}
const STORE_LABEL = { steam: 'Steam', epic: 'Epic', riot: 'Riot', rockstar: 'Rockstar', gog: 'GOG', ea: 'EA', ubisoft: 'Ubisoft' };
const STORE_FULL = { ...STORE_LABEL, epic: 'Epic Games', ea: 'EA app', ubisoft: 'Ubisoft Connect' };
const storeName = (g) => STORE_LABEL[g.store] || g.store;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const games = () => (state.lib?.games || []).filter((g) => g.kind !== 'tool');
const findGame = (id) => state.lib?.games.find((g) => g.id === id);

// ---------- avisos ----------
let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 7000 : 3500);
}
function errMsg(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function launch(g) {
  if (!g) return;
  if (g.launch) window.api.launchGame(g.id);
  else if (g.installed ? g.launchUrl : g.installUrl) window.api.open(g.installed ? g.launchUrl : g.installUrl);
  else return toast(`${g.title} se abre desde ${STORE_FULL[g.store] || 'su launcher'}.`);
  if (g.installed && state.settings?.focus?.autoOnPlay !== false && (!state.focus || state.focus.mode === 'off')) {
    window.api.focusStart().then((s) => {
      state.focus = s;
      renderFocus();
    });
  }
  toast(g.installed ? `Abriendo ${g.title}…` : `Abriendo la instalación de ${g.title}…`);
}

// ---------- filtros y orden ----------
function visibleGames() {
  if (!state.lib) return [];
  const newSet = new Set(state.lib.newIds || []);
  const q = state.q.trim().toLowerCase();
  const list = state.lib.games.filter((g) => {
    if ((g.kind === 'tool') !== state.showTools) return false;
    if (state.store === 'other' ? ['steam', 'epic'].includes(g.store) : state.store !== 'all' && g.store !== state.store) return false;
    if (state.inst === 'yes' && !g.installed) return false;
    if (state.inst === 'no' && g.installed) return false;
    if (state.onlyUpd && !(g.installed && g.updatePending)) return false;
    if (state.onlyNew && !newSet.has(g.id)) return false;
    if (state.tag && !(g.tags || []).includes(state.tag)) return false;
    if (state.status && !matchesStatus(g, state.status)) return false;
    if (q && !g.title.toLowerCase().includes(q)) return false;
    return true;
  });
  return sortGames(list, state.sort);
}

const STATUS_LABEL = { pending: 'Pendiente', playing: 'Jugando', finished: 'Terminado', dropped: 'Abandonado' };
const neverPlayed = (g) => g.store === 'steam' && !g.playtimeMin && !g.lastPlayed;
function matchesStatus(g, st) {
  const u = state.user[g.id] || {};
  if (st === 'fav') return !!u.fav;
  if (st === 'never') return neverPlayed(g);
  if (st === 'trainer') return !!g.trainer;
  if (st === 'none') return !u.status;
  if (st.startsWith('col:')) return (u.cols || []).includes(st.slice(4));
  return u.status === st;
}

function sortGames(list, mode) {
  const alpha = (a, b) => collator.compare(a.title, b.title);
  const byDesc = (key) => (a, b) => (b[key] || 0) - (a[key] || 0) || alpha(a, b);
  const byRelease = (a, b) => (a.released || 9e12) - (b.released || 9e12) || alpha(a, b);
  const byRating = (a, b) => (state.user[b.id]?.rating || 0) - (state.user[a.id]?.rating || 0) || alpha(a, b);
  const fn = { played: byDesc('lastPlayed'), purchased: byDesc('purchased'), release: byRelease, rating: byRating }[mode] || alpha;
  return list.sort(fn);
}

function metaLine(g, mode) {
  if (mode === 'played') {
    if (g.lastPlayed) return h('span', { text: `Jugado ${relTime(g.lastPlayed)}` });
    return h('span', { text: g.store === 'epic' && !g.installed ? 'Sin datos de partidas' : 'Sin partidas' });
  }
  if (mode === 'purchased') {
    if (g.purchased) return h('span', { text: `Comprado el ${dateFmt.format(g.purchased * 1000)}` });
    return h('span', { text: g.store === 'epic' ? 'Epic no da la fecha' : 'Fecha desconocida' });
  }
  if (mode === 'rating') return state.user[g.id]?.rating ? starsView(state.user[g.id].rating) : h('span', { text: 'Sin valorar' });
  if (mode === 'release') {
    const year = g.released ? new Date(g.released * 1000).getFullYear() : null;
    return h('span', { text: [year, g.installed ? 'instalado' : null].filter(Boolean).join(', ') || 'Sin fecha' });
  }
  const st = STATUS_LABEL[state.user[g.id]?.status];
  if (g.installed && g.updatePending) return h('span', { class: 'warn', text: g.updateText || 'Actualización pendiente' });
  if (g.installed) return h('span', {}, st ? `${st}, ` : '', h('span', { class: 'on', text: st ? 'instalado' : 'Instalado' }));
  if (g.familyOwners?.length) return h('span', { title: `Te lo comparte ${g.familyOwners.join(' y ')} (grupo familiar de Steam)`, text: st ? `${st}, de ${g.familyOwners[0]}` : `De ${g.familyOwners[0]} (familia)` });
  return h('span', { text: st ? `${st}, sin instalar` : 'Sin instalar' });
}

function coverImg(g, onFail) {
  const fallbacks = [...(g.coverFallbacks || [])];
  const img = h('img', { src: g.cover, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => {
    const next = fallbacks.shift();
    if (next) img.src = next;
    else onFail?.();
  });
  return img;
}

function card(g, isNew, mode) {
  const cover = h('div', { class: 'cover' });
  const ph = () => cover.prepend(h('div', { class: 'ph', text: g.title }));
  if (g.cover) cover.append(coverImg(g, () => ph()));
  else ph();
  cover.append(
    h('span', { class: 'store', text: storeName(g) }),
    g.installed && g.updatePending && h('span', { class: 'flag upd', text: 'Actualizar', title: g.updateText || '' }),
    isNew && h('span', { class: 'flag new', text: 'Nuevo' }),
    state.user[g.id]?.fav && h('span', { class: 'fav', text: '★', title: 'Favorito' }),
    h(
      'div',
      { class: 'play' },
      h('button', { 'data-act': 'main', text: g.installed ? 'Jugar' : 'Instalar' }),
      g.storeUrl && h('button', { class: 'to-store', 'data-act': 'store', text: 'Tienda' })
    )
  );
  return h(
    'article',
    { class: `card${g.installed ? '' : ' not-installed'}`, tabIndex: 0, 'data-id': g.id, title: (g.tags || []).slice(0, 4).join(', ') },
    cover,
    h('div', { class: 'title', text: g.title }),
    h('div', { class: 'meta' }, metaLine(g, mode))
  );
}

function fillGrid(el, list, mode) {
  const newSet = new Set(state.lib?.newIds || []);
  const frag = document.createDocumentFragment();
  for (const g of list) frag.append(card(g, newSet.has(g.id), mode));
  el.replaceChildren(frag);
}

// ---------- cabecera ----------
function recentGames() {
  return games()
    .filter((g) => g.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 7);
}

function renderHero() {
  const box = $('#hero');
  const recent = recentGames();
  const g = findGame(state.heroId) || recent[0];
  const hide = !g || state.q.trim() || state.showTools;
  box.hidden = !!hide;
  if (hide) return;
  const art = h('img', { class: 'hero-art', src: g.hero || g.cover, alt: '', referrerPolicy: 'no-referrer' });
  art.addEventListener('error', () => {
    if (g.cover && art.src !== g.cover) art.src = g.cover;
    else art.remove();
  });
  const hours = g.playtimeMin ? Math.round(g.playtimeMin / 60) : 0;
  box.replaceChildren(
    art,
    h(
      'div',
      { class: 'hero-body' },
      h('p', { class: 'hero-kicker', text: g === recent[0] ? 'Seguir jugando' : 'Jugado hace poco' }),
      h('h1', { text: g.title }),
      h(
        'div',
        { class: 'hero-meta' },
        g.lastPlayed && h('span', {}, 'Última partida ', h('b', { text: relTime(g.lastPlayed) })),
        hours > 0 && h('span', {}, h('b', { text: plural(hours, 'hora', 'horas') }), ' jugadas'),
        h('span', { text: g.store === 'steam' ? 'En Steam' : 'En Epic Games' }),
        g.updatePending && h('span', {}, h('b', { text: g.updateText }))
      ),
      h(
        'div',
        { class: 'hero-actions' },
        h('button', { class: 'btn primary', onclick: () => launch(g) }, svg(PLAY_ICON), g.installed ? 'Jugar' : 'Instalar'),
        g.storeUrl && h('button', { class: 'btn ghost', text: 'Ver en la tienda', onclick: () => window.api.open(g.storeUrl) })
      ),
      recent.length > 1 &&
        h(
          'div',
          { class: 'recent', role: 'group', 'aria-label': 'Jugados recientemente' },
          recent.map((r) =>
            h(
              'button',
              {
                class: r.id === g.id ? 'on' : '',
                title: r.title,
                'aria-label': r.title,
                onclick: () => {
                  state.heroId = r.id;
                  renderHero();
                },
              },
              coverImg(r)
            )
          )
        )
    )
  );
}

// ---------- biblioteca ----------
function renderTagOptions() {
  const counts = new Map();
  for (const g of games()) for (const t of g.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  if (state.tag && !counts.has(state.tag)) state.tag = '';
  $('#tag').replaceChildren(
    h('option', { value: '', text: 'Todas' }),
    ...tags.map(([t, n]) => h('option', { value: t, text: `${t} (${n})` }))
  );
  $('#tag').value = state.tag;
}

function renderLibrary() {
  const lib = state.lib;
  const grid = $('#grid');
  const empty = $('#empty');
  if (!lib) {
    grid.replaceChildren();
    empty.hidden = false;
    empty.replaceChildren(h('b', { text: 'Leyendo tu biblioteca…' }), 'Steam y Epic tardan unos segundos la primera vez.');
    return;
  }
  renderHero();
  const list = visibleGames();
  fillGrid(grid, list, state.sort);

  empty.hidden = list.length > 0;
  empty.replaceChildren(
    ...(lib.games.length
      ? [h('b', { text: 'Ningún juego coincide' }), 'Prueba a quitar algún filtro o a cambiar la búsqueda.']
      : [h('b', { text: 'Aún no hay juegos' }), 'Abre Ajustes, añade tu clave de Steam y pulsa Actualizar.'])
  );

  const all = games();
  const steamN = all.filter((g) => g.store === 'steam').length;
  const tools = lib.games.length - all.length;
  $('#countAll').textContent = all.length;
  $('#nTools').textContent = tools;
  $('#showTools').hidden = !tools;
  const shown = $('#shown');
  if (state.showTools) shown.replaceChildren(h('b', { text: plural(list.length, 'programa', 'programas') }));
  else
    shown.replaceChildren(
      h('b', { text: `${list.length} de ${all.length} juegos` }),
      `, ${steamN} en Steam y ${all.length - steamN} en Epic`,
      lib.refreshedAt ? `. Leído el ${dateTimeFmt.format(lib.refreshedAt)}.` : '.'
    );

  // Avisos
  const notices = [];
  const upd = lib.games.filter((g) => g.installed && g.updatePending);
  $('#nUpd').textContent = upd.length;
  if (upd.length) {
    const names = upd.slice(0, 3).map((g) => g.title).join(', ') + (upd.length > 3 ? ` y ${upd.length - 3} más` : '');
    notices.push(
      h(
        'div',
        { class: 'notice' },
        h('span', { text: `${upd.length === 1 ? 'Hay una actualización pendiente' : `Hay ${upd.length} actualizaciones pendientes`}: ${names}.` }),
        h('button', { class: 'link', text: state.onlyUpd ? 'Ver todos' : 'Ver solo esos', onclick: () => toggleChip('onlyUpd') })
      )
    );
  }
  const nNew = (lib.newIds || []).length;
  $('#nNew').textContent = nNew;
  if (nNew) {
    notices.push(
      h(
        'div',
        { class: 'notice new' },
        h('span', { text: `${plural(nNew, 'juego nuevo', 'juegos nuevos')} desde la última lectura.` }),
        h('button', { class: 'link', text: state.onlyNew ? 'Ver todos' : 'Ver solo los nuevos', onclick: () => toggleChip('onlyNew') }),
        h('button', { class: 'link', text: 'Marcar como vistos', onclick: clearNew })
      )
    );
  }
  const warns = lib.warnings || [];
  if (warns.length) {
    notices.push(
      h(
        'details',
        { class: 'notes' },
        h('summary', { text: `Avisos de la última lectura (${warns.length})` }),
        h('ul', {}, warns.map((t) => h('li', { text: t })))
      )
    );
  }
  $('#notices').replaceChildren(...notices);
}

function syncControls() {
  $('#sort').value = state.sort;
  $('#tag').value = state.tag;
  $('#status').value = state.status;
  for (const b of $$('#storeSeg button')) b.classList.toggle('on', b.dataset.v === state.store);
  for (const b of $$('#instSeg button')) b.classList.toggle('on', b.dataset.v === state.inst);
  $('#onlyUpdates').setAttribute('aria-pressed', state.onlyUpd);
  $('#onlyNew').setAttribute('aria-pressed', state.onlyNew);
  $('#showTools').setAttribute('aria-pressed', state.showTools);
}

function toggleChip(key) {
  state[key] = !state[key];
  syncControls();
  renderLibrary();
}

// ---------- sagas ----------
function sagaGroups() {
  const map = new Map();
  for (const g of games()) if (g.saga) (map.get(g.saga) || map.set(g.saga, []).get(g.saga)).push(g);
  return [...map]
    .map(([name, list]) => ({ name, list: sortGames(list, 'release') }))
    .sort((a, b) => b.list.length - a.list.length || collator.compare(a.name, b.name));
}

// Aviso para sumar la biblioteca del grupo familiar de Steam
async function familyNotice() {
  const box = $('#familyNotice');
  if (!box) return;
  const st = await window.api.family.status().catch(() => ({ linked: false }));
  if (st.linked) {
    fill(box, h('p', { class: 'hint', text: `Incluye ${plural(st.games, 'juego', 'juegos')} que te comparte tu grupo familiar de Steam (${st.members.map((m) => m.name).join(', ')}).` }));
    return;
  }
  fill(box, h('div', { class: 'notice' },
    h('span', { text: 'Faltan los juegos de tu grupo familiar de Steam (por eso no salen algunas sagas). Conecta tu sesión de Steam una vez y se suman a tu biblioteca.' }),
    h('button', { class: 'btn primary small', text: 'Conectar con Steam', onclick: async () => {
      const ok = await window.api.family.login();
      if (!ok) return toast('No se completó el inicio de sesión en Steam.', true);
      toast('Steam conectado: actualizando la biblioteca con los juegos de tu familia…');
      $('#refreshBtn')?.click();
      familyNotice();
    } })
  ));
}

function renderSagas() {
  familyNotice();
  const groups = sagaGroups();
  $('#countSagas').textContent = groups.length || '';
  const current = state.saga && groups.find((s) => s.name === state.saga);
  $('#sagaList').hidden = !!current;
  $('#sagaDetail').hidden = !current;

  if (current) {
    const inst = current.list.filter((g) => g.installed).length;
    $('#sagaTitle').textContent = current.name;
    const instTxt = inst === 0 ? 'ninguno instalado' : inst === current.list.length ? (inst === 1 ? 'instalado' : 'todos instalados') : `${inst} ${inst === 1 ? 'instalado' : 'instalados'}`;
    $('#sagaSub').textContent = `${plural(current.list.length, 'juego', 'juegos')}, ${instTxt}. Ordenados por fecha de salida.`;
    fillGrid($('#sagaGrid'), current.list, 'release');
    return;
  }

  const box = $('#sagas');
  if (!groups.length) {
    box.replaceChildren(
      h('div', { class: 'empty' }, h('b', { text: 'Todavía no hay sagas' }), 'Aparecen cuando tienes dos o más juegos de la misma serie.')
    );
    return;
  }
  box.replaceChildren(
    ...groups.map((s) => {
      // Arte apaisado oficial del juego más reciente de la saga (el "hero" de la tienda)
      const byNew = [...s.list].sort((x, y) => (y.released || 0) - (x.released || 0) || (y.lastPlayed || 0) - (x.lastPlayed || 0));
      const art = byNew.find((g) => g.hero) || byNew.find((g) => g.cover);
      const inst = s.list.filter((g) => g.installed).length;
      const img = art && h('img', { src: art.hero || art.cover, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer', class: art.hero ? '' : 'blur' });
      return h(
        'button',
        { class: 'saga', onclick: () => openSaga(s.name), 'aria-label': `${s.name}, ${s.list.length} juegos` },
        h('div', { class: 'saga-art' }, img, h('div', { class: 'saga-txt' }, h('h3', { text: s.name }), h('p', { text: `${plural(s.list.length, 'juego', 'juegos')}${inst ? `, ${inst} ${inst === 1 ? 'instalado' : 'instalados'}` : ''}` })))
      );
    })
  );
}

function openSaga(name) {
  state.saga = name;
  renderSagas();
  $('#scroller').scrollTo({ top: 0 });
}

// ---------- ofertas ----------
function renderDeals() {
  const box = $('#deals');
  const d = state.deals;
  const info = $('#dealsInfo');
  $('#country').value = state.country;
  if (!d) {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Consultando precios…' })));
    $('#countDeals').textContent = '';
    info.textContent = '';
    return;
  }
  if (d.error) {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'No se pudo leer la lista de deseados' }), d.error));
    info.textContent = '';
    return;
  }
  const onSale = d.items.filter((i) => i.price?.discountPct > 0).sort((a, b) => b.price.discountPct - a.price.discountPct);
  $('#countDeals').textContent = onSale.length || '';
  info.textContent =
    `${onSale.length} de tus ${d.total} deseados están rebajados en Steam.` +
    (d.fetchedAt ? ` Precios consultados el ${dateTimeFmt.format(d.fetchedAt)}.` : '');
  let list = onSale;
  if (state.showAllWish) {
    const rest = d.items.filter((i) => !(i.price?.discountPct > 0)).sort((a, b) => collator.compare(a.name, b.name));
    list = [...onSale, ...rest];
  }
  if (!list.length) {
    box.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('b', { text: d.total ? 'Nada rebajado ahora mismo' : 'Tu lista de deseados está vacía o es privada' }),
        d.total ? 'Vuelve a mirar en unos días o activa «Mostrar también los que no están rebajados».' : 'Hazla pública en tu perfil de Steam para ver sus ofertas.'
      )
    );
    return;
  }
  const soon = Date.now() / 1000 + 2 * 86400;
  box.replaceChildren(
    ...list.map((it) => {
      const p = it.price;
      const sale = p?.discountPct > 0;
      let priceRow;
      if (!p) priceRow = h('div', { class: 'price' }, h('span', { class: 'orig', text: 'No está a la venta' }));
      else if (p.free) priceRow = h('div', { class: 'price' }, h('span', { class: 'final', text: 'Gratis' }));
      else
        priceRow = h(
          'div',
          { class: 'price' },
          sale && h('span', { class: 'pct', text: `−${p.discountPct}%` }),
          h('span', { class: 'final', text: p.final || '' }),
          sale && p.original && h('span', { class: 'orig', text: p.original })
        );
      const ends = sale
        ? h('div', {
            class: `ends${p.endsAt && p.endsAt < soon ? ' soon' : ''}`,
            text: p.endsAt ? `Termina ${relTime(p.endsAt)}, el ${dateTimeFmt.format(p.endsAt * 1000)}` : 'Sin fecha de fin publicada',
          })
        : null;
      return h(
        'button',
        { class: `deal${sale ? '' : ' nosale'}`, onclick: () => window.api.open(`https://store.steampowered.com/app/${it.appid}/`), title: 'Abrir en la tienda de Steam' },
        h('img', { src: it.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
        h('div', {}, h('h3', { text: it.name }), priceRow, ends, canRunBadge(it.appid))
      );
    })
  );
  // Requisitos de la lista de deseados (una vez; se guardan una semana)
  const missing = d.items.map((i) => i.appid).filter((id) => !(id in canRunCache));
  if (missing.length && !state.canRunLoading) {
    state.canRunLoading = true;
    ensureCanRun(missing)
      .catch(() => {})
      .finally(() => {
        state.canRunLoading = false;
        if (Object.keys(canRunCache).length) renderDeals();
      });
  }
}

// ---------- Iluminación (OpenRGB) ----------
const lux = { st: null, busy: null, color: '#ef2f34', effect: 'static', speed: null, brightness: null, open: null };
const LUX_SWATCHES = ['#ef2f34', '#ff7a1a', '#ffd23f', '#3ddc84', '#1ed7c8', '#3c8cff', '#8a5cff', '#ff4fd8', '#ffffff'];
const LUX_EFFECTS = [['static', 'Fijo'], ['breathing', 'Respirar'], ['rainbow', 'Arcoíris'], ['wave', 'Ola'], ['off', 'Apagado']];
async function loadRgb() {
  if (!lux.lastLoaded) {
    lux.lastLoaded = true;
    const last = await window.api.rgb.last().catch(() => null);
    if (last) Object.assign(lux, { color: last.color || lux.color, effect: last.effect || lux.effect });
  }
  lux.busy = lux.busy || 'Buscando OpenRGB…';
  renderRgb();
  try {
    lux.st = await window.api.rgb.status();
  } catch (e) {
    lux.st = { error: errMsg(e) };
  }
  lux.busy = null;
  renderRgb();
}
async function rgbDo(label, fn) {
  lux.busy = label;
  renderRgb();
  try {
    const r = await fn();
    return r;
  } catch (e) {
    toast(errMsg(e), true);
  } finally {
    lux.busy = null;
    renderRgb();
  }
}
function renderRgb() {
  const box = $('#rgbBody');
  if (!box || $('#rgbView').hidden) return;
  const st = lux.st;
  if (!st) return fill(box, h('p', { class: 'hint', text: lux.busy || 'Cargando…' }));
  if (!st.running) {
    return fill(
      box,
      h(
        'ol',
        { class: 'steps lux-steps' },
        h('li', {}, h('b', { text: st.installed ? 'OpenRGB ya está en tu PC.' : 'Descarga OpenRGB (gratis y de código abierto).' }), h('span', {}, st.installed ? 'ViperTeca lo abre en segundo plano y le manda los colores.' : ['Desde ', h('button', { class: 'link-btn', text: 'openrgb.org', onclick: () => window.api.open('https://openrgb.org/') }), '. Si lo guardas en otra carpeta, indícala con «Buscar OpenRGB».'])),
        h('li', {}, h('b', { text: 'Para la placa base (tus ventiladores ARGB): instala PawnIO.' }), h('span', {}, 'Es el controlador que OpenRGB usa para hablar con el chip RGB de la placa. Descárgalo de ', h('button', { class: 'link-btn', text: 'pawnio.eu', onclick: () => window.api.open('https://pawnio.eu/') }), ' e instálalo tú (pide permisos de administrador).')),
        h('li', {}, h('b', { text: 'Abre OpenRGB como administrador.' }), h('span', { text: 'Windows te preguntará si das permiso. Sin administrador solo se ven el teclado, el ratón y otros dispositivos USB.' }))
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', disabled: !!lux.busy || !st.installed, text: 'Abrir como administrador', onclick: () => rgbDo('Abriendo OpenRGB…', async () => (lux.st = await window.api.rgb.start(true))) }),
        h('button', { class: 'btn ghost', disabled: !!lux.busy || !st.installed, text: 'Abrir sin permisos', onclick: () => rgbDo('Abriendo OpenRGB…', async () => (lux.st = await window.api.rgb.start(false))) }),
        h('button', { class: 'btn ghost subtle', text: 'Buscar OpenRGB…', onclick: async () => { if (await window.api.rgb.pickExe()) loadRgb(); } }),
        lux.busy && h('span', { class: 'hint', text: lux.busy })
      )
    );
  }
  if (!st.devices.length && (lux.retries || 0) < 6) {
    lux.retries = (lux.retries || 0) + 1;
    setTimeout(loadRgb, 2500);
  }
  if (st.devices.length) lux.retries = 0;
  const effectSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Efecto' }, LUX_EFFECTS.map(([k, t]) => h('button', { class: lux.effect === k ? 'on' : '', text: t, onclick: () => { lux.effect = k; renderRgb(); } })));
  const picker = h('input', { type: 'color', class: 'lux-picker', value: lux.color, 'aria-label': 'Color' });
  picker.addEventListener('input', () => (lux.color = picker.value));
  picker.addEventListener('change', () => renderRgb());
  const applyAll = () => rgbDo('Aplicando…', async () => {
    const r = await window.api.rgb.applyAll({ effect: lux.effect, color: lux.color });
    toast(r.skipped.length ? `Aplicado en ${r.done.length}; sin ese efecto: ${r.skipped.join(', ')}` : `Aplicado en ${plural(r.done.length, 'dispositivo', 'dispositivos')}.`);
    lux.st = await window.api.rgb.status();
  });
  const hasBoard = st.devices.some((d) => d.type === 'Placa base');
  return fill(
    box,
    h(
      'section',
      { class: 'lux-main', style: { '--lux': lux.effect === 'off' ? '#222' : lux.color } },
      h('div', { class: `lux-orb ${lux.effect}`, 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'lux-ctrls' },
        h('h2', { class: 'section-h', text: 'Todo el PC' }),
        effectSeg,
        lux.effect !== 'off' && lux.effect !== 'rainbow' && h('div', { class: 'lux-colors' }, picker, LUX_SWATCHES.map((c) => h('button', { class: `lux-sw${lux.color === c ? ' on' : ''}`, style: { background: c }, title: c, 'aria-label': `Color ${c}`, onclick: () => { lux.color = c; renderRgb(); } }))),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !!lux.busy, text: lux.busy || 'Aplicar a todo', onclick: applyAll }), h('button', { class: 'btn ghost small', disabled: !!lux.busy, text: 'Volver a buscar dispositivos', onclick: () => rgbDo('Buscando…', async () => { await window.api.rgb.rescan(); await new Promise((r) => setTimeout(r, 5000)); lux.st = await window.api.rgb.status(); }) }))
      )
    ),
    !hasBoard && h('div', { class: 'notice' }, h('span', {}, 'OpenRGB no ve la placa base, así que tus ventiladores (conectados a su conector ARGB) aún no se pueden controlar. Instala ', h('button', { class: 'link-btn', text: 'PawnIO', onclick: () => window.api.open('https://pawnio.eu/') }), ', cierra OpenRGB y ábrelo como administrador desde aquí.'), h('button', { class: 'btn ghost small', text: 'Abrir como administrador', onclick: () => rgbDo('Abriendo OpenRGB…', async () => (lux.st = await window.api.rgb.start(true))) })),
    h('h2', { class: 'section-h', text: `Dispositivos (${st.devices.length})` }),
    h('div', { class: 'lux-devs' }, st.devices.map(rgbDevice))
  );
}
function rgbDevice(d) {
  const open = lux.open === d.id;
  const mode = d.modes[d.activeMode];
  const sel = h('select', { 'aria-label': `Modo de ${d.name}` }, d.modes.map((m) => h('option', { value: m.id, text: m.name, selected: m.id === d.activeMode })));
  const color = h('input', { type: 'color', value: (mode?.colors?.[0] && mode.colors[0] !== '#000000' ? mode.colors[0] : lux.color), 'aria-label': 'Color' });
  const cur = () => d.modes[Number(sel.value)];
  const speed = h('input', { type: 'range', class: 'lux-range', 'aria-label': 'Velocidad' });
  const bright = h('input', { type: 'range', class: 'lux-range', 'aria-label': 'Brillo' });
  const syncRanges = () => {
    const m = cur();
    for (const [el, k] of [[speed, 'speed'], [bright, 'brightness']]) {
      el.parentElement && (el.parentElement.hidden = !m[k]);
      if (m[k]) Object.assign(el, { min: m[k].min, max: m[k].max, value: m[k].value });
    }
    color.parentElement && (color.parentElement.hidden = !(m.perLed || m.modeColors));
  };
  sel.addEventListener('change', syncRanges);
  const body = h(
    'div',
    { class: 'lux-dev-body' },
    h('label', { class: 'lux-field' }, h('span', { text: 'Modo' }), sel),
    h('label', { class: 'lux-field' }, h('span', { text: 'Color' }), color),
    h('label', { class: 'lux-field' }, h('span', { text: 'Velocidad' }), speed),
    h('label', { class: 'lux-field' }, h('span', { text: 'Brillo' }), bright),
    d.zones.filter((z) => z.resizable).map((z) => {
      const n = h('input', { type: 'number', min: z.min, max: z.max, value: z.leds, class: 'lux-num', 'aria-label': `LEDs de ${z.name}` });
      return h('div', { class: 'lux-field' }, h('span', { text: `LEDs en «${z.name}»` }), h('div', { class: 'row' }, n, h('button', { class: 'btn ghost small', text: 'Guardar', onclick: () => rgbDo('Guardando…', async () => { await window.api.rgb.resize(d.id, z.id, Number(n.value)); lux.st = await window.api.rgb.status(); }) })), h('small', { class: 'hint', text: 'En los conectores ARGB indica cuántos LED hay en total (por ejemplo, 3 ventiladores de 8 LED = 24).' }));
    }),
    h('div', { class: 'row' }, h('button', { class: 'btn primary small', text: 'Aplicar', onclick: () => rgbDo('Aplicando…', async () => { await window.api.rgb.apply(d.id, { mode: Number(sel.value), color: color.value, speed: cur().speed ? Number(speed.value) : null, brightness: cur().brightness ? Number(bright.value) : null }); lux.st = await window.api.rgb.status(); }) }))
  );
  queueMicrotask(syncRanges);
  return h(
    'div',
    { class: `lux-dev${open ? ' open' : ''}` },
    h('button', { class: 'lux-dev-head', 'aria-expanded': String(open), onclick: () => { lux.open = open ? null : d.id; renderRgb(); } }, h('span', { class: 'lux-dot', style: { background: mode?.colors?.[0] && mode.colors[0] !== '#000000' ? mode.colors[0] : d.color } }), h('span', {}, h('b', { text: d.name }), h('small', { text: `${d.type}, ${plural(d.leds, 'LED', 'LED')}, modo «${mode?.name || '—'}»` })), h('span', { class: 'lux-chev', text: open ? '▴' : '▾' })),
    open && body
  );
}

// ---------- Tu saldo en Steam y Epic ----------
const wal = { data: null, busy: {} };
async function loadWallets() {
  if (!wal.data) wal.data = (await window.api.walletCached().catch(() => ({}))) || {};
  renderWallets();
  // Actualiza en silencio lo que ya está conectado (una vez por sesión)
  for (const k of ['steam', 'epic']) if (wal.data[k]?.items && !wal.silent?.[k]) {
    wal.silent = { ...(wal.silent || {}), [k]: true };
    refreshWallet(k, false);
  }
}
async function refreshWallet(key, interactive) {
  wal.busy[key] = true;
  renderWallets();
  try {
    wal.data = await window.api.walletRefresh(key, interactive);
  } catch (e) {
    if (interactive) toast(errMsg(e), true);
  }
  wal.busy[key] = false;
  renderWallets();
}
function renderWallets() {
  const box = $('#walletBox');
  if (!box) return;
  const card = (key, name, hint) => {
    const d = wal.data?.[key];
    const busy = wal.busy[key];
    return h(
      'div',
      { class: `wallet ${key}` },
      h('p', { class: 'wallet-store', text: name }),
      d?.items?.length
        ? h('dl', {}, d.items.map((i) => h('div', {}, h('dt', { text: i.label }), h('dd', { text: i.value }))))
        : h('p', { class: 'hint', text: d?.needsLogin ? 'La sesión caducó: vuelve a conectar.' : hint }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: `btn small ${d?.items ? 'ghost' : 'primary'}`, disabled: busy, text: busy ? 'Leyendo…' : d?.items ? 'Actualizar' : 'Conectar', onclick: () => refreshWallet(key, true) }),
        d?.items && h('button', { class: 'btn small ghost subtle', text: 'Desconectar', onclick: async () => { wal.data = await window.api.walletLogout(key); renderWallets(); } }),
        d?.at && h('span', { class: 'hint', text: relTime(d.at / 1000) })
      )
    );
  };
  fill(
    box,
    h('h2', { class: 'section-h', text: 'Tu saldo' }),
    h(
      'div',
      { class: 'wallets' },
      card('steam', 'Steam', 'Inicias sesión tú en la tienda de Steam y la app lee tu cartera.'),
      card('epic', 'Epic Games', 'Inicias sesión tú en Epic y la app lee tus Epic Rewards y el saldo de la cuenta.')
    ),
    h('p', { class: 'hint', text: 'Ninguna tienda da el saldo a otros programas, así que se lee de sus webs oficiales. La sesión se guarda como en un navegador, cifrada con tu usuario de Windows; «Desconectar» la borra.' })
  );
}

// ---------- DLC rebajados de tus juegos (idea 4) ----------
async function loadDlcDeals(force) {
  const box = $('#dlcDeals');
  if (state.dlcLoading || (state.dlc && !force)) return renderDlcDeals();
  state.dlcLoading = true;
  if (!state.dlc) box.replaceChildren(skeletonDeals(4));
  try {
    state.dlc = await window.api.dlcDeals(force);
  } catch (e) {
    state.dlc = { error: errMsg(e) };
  }
  state.dlcLoading = false;
  renderDlcDeals();
}

function renderDlcDeals() {
  const box = $('#dlcDeals');
  const d = state.dlc;
  if (!d) return;
  if (d.error) return box.replaceChildren(h('p', { class: 'hint bad', text: d.error }));
  const extras = /soundtrack|\bost\b|banda sonora|artbook|art book|wallpaper/i;
  if (state.hideOst === undefined) state.hideOst = true;
  const shownPer = {};
  const all = d.filter((x) => !(state.hideOst && extras.test(x.name)));
  const list = state.allDlc ? all : all.filter((x) => (shownPer[x.parentId] = (shownPer[x.parentId] || 0) + 1) <= 3);
  const hidden = all.length - list.length;
  const soon = Date.now() / 1000 + 2 * 86400;
  box.replaceChildren(
    h('label', { class: 'check dlc-ost' }, h('input', { type: 'checkbox', checked: !!state.hideOst, onchange: (e) => { state.hideOst = e.target.checked; renderDlcDeals(); } }), 'Ocultar bandas sonoras y artbooks'),
    list.length
      ? list.map((x) =>
          h(
            'button',
            { class: 'deal', onclick: () => window.api.open(`https://store.steampowered.com/app/${x.appid}/`), title: 'Abrir en la tienda de Steam' },
            h('img', { src: x.header, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
            h(
              'div',
              {},
              h('p', { class: 'dlc-parent', text: x.parent }),
              h('h3', { text: x.name }),
              h('div', { class: 'price' }, h('span', { class: 'pct', text: `−${x.pct}%` }), h('span', { class: 'final', text: x.final || '' }), x.original && h('span', { class: 'orig', text: x.original })),
              x.endsAt && h('div', { class: `ends${x.endsAt < soon ? ' soon' : ''}`, text: `Termina ${relTime(x.endsAt)}` })
            )
          )
        )
      : h('p', { class: 'hint', text: 'Ningún DLC de tus juegos está rebajado ahora mismo.' }),
    hidden > 0 && h('button', { class: 'btn ghost small dlc-more', text: `Ver los ${hidden} DLC rebajados restantes`, onclick: () => { state.allDlc = true; renderDlcDeals(); } })
  );
}

// ---------- juegos gratis de Epic ----------
const normTitle = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’™®]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function renderEpicFree() {
  const box = $('#epicFree');
  const list = state.epicFree;
  if (!list) return box.replaceChildren();
  if (list.error) return box.replaceChildren(h('p', { class: 'hint', text: `No se pudieron leer los juegos gratis de Epic: ${list.error}` }));
  if (!list.length) return box.replaceChildren();
  const owned = new Set(games().filter((g) => g.store === 'epic').map((g) => normTitle(g.title)));
  const card = (f) => {
    const have = owned.has(normTitle(f.title));
    const now = f.when === 'now';
    const when = now
      ? f.end ? `Gratis hasta el ${dateTimeFmt.format(f.end)} (${relTime(f.end / 1000)})` : 'Gratis ahora'
      : f.start ? `Gratis desde el ${dateTimeFmt.format(f.start)}` : 'Próximamente gratis';
    return h(
      'button',
      { class: `free${now ? ' now' : ''}`, onclick: () => window.api.open(f.url), title: now ? 'Abrir en la tienda de Epic para conseguirlo' : 'Abrir en la tienda de Epic' },
      h('div', { class: 'free-art' }, f.image ? h('img', { src: f.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null, have && h('span', { class: 'flag new', text: 'Ya lo tienes' })),
      h('div', { class: 'free-body' }, h('h3', { text: f.title }), h('p', { class: now ? 'free-when' : 'ends', text: when }), f.originalPrice && h('span', { class: 'orig', text: f.originalPrice }))
    );
  };
  const now = list.filter((f) => f.when === 'now');
  const next = list.filter((f) => f.when === 'next');
  box.replaceChildren(
    h('h2', { class: 'section-h', text: 'Gratis en Epic esta semana' }),
    h('div', { class: 'frees' }, now.map(card), next.map(card))
  );
}

async function loadEpicFree() {
  try {
    state.epicFree = await window.api.epicFree();
  } catch (e) {
    state.epicFree = { error: errMsg(e) };
  }
  renderEpicFree();
}

async function loadDeals(silent) {
  try {
    state.deals = await window.api.getDeals();
  } catch (e) {
    if (!state.deals || state.deals.error) state.deals = { error: errMsg(e) };
    if (!silent) toast(errMsg(e), true);
  }
  renderDeals();
}

// ---------- acciones ----------
async function refresh() {
  const btn = $('#refreshBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.querySelector('.lbl').textContent = 'Leyendo…';
  try {
    const before = state.lib;
    state.lib = await window.api.refresh();
    renderAll();
    const n = state.lib.newIds?.length || 0;
    toast(before ? (n ? `Biblioteca actualizada: ${plural(n, 'juego nuevo', 'juegos nuevos')}.` : 'Biblioteca actualizada, sin juegos nuevos.') : 'Biblioteca cargada.');
  } catch (e) {
    toast(`No se pudo actualizar: ${errMsg(e)}`, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.querySelector('.lbl').textContent = 'Actualizar';
  }
  loadDeals(true);
  loadEpicFree();
  loadNews(false);
}

async function clearNew() {
  await window.api.clearNew();
  if (state.lib) state.lib.newIds = [];
  state.onlyNew = false;
  syncControls();
  renderLibrary();
}

// ---------- colecciones propias ----------
function allCollections() {
  const s = new Set();
  for (const u of Object.values(state.user || {})) for (const c of u.cols || []) s.add(c);
  return [...s].sort(collator.compare);
}

function renderStatusOptions() {
  const sel = $('#status');
  sel.querySelector('optgroup')?.remove();
  const cols = allCollections();
  if (state.status?.startsWith('col:') && !cols.includes(state.status.slice(4))) state.status = '';
  if (cols.length) {
    const count = (c) => Object.values(state.user).filter((u) => (u.cols || []).includes(c)).length;
    sel.append(h('optgroup', { label: 'Tus colecciones' }, cols.map((c) => h('option', { value: `col:${c}`, text: `${c} (${count(c)})` }))));
  }
  sel.value = state.status;
}

function colsBlock(g) {
  const cols = state.user[g.id]?.cols || [];
  const save = (list) => setUser(g.id, { cols: list }).then(() => {
    renderStatusOptions();
    renderGame();
  });
  const input = h('input', { type: 'text', class: 'col-input', placeholder: 'Añadir a una colección (nueva o existente)…', maxLength: 40, 'aria-label': 'Nombre de la colección' });
  input.setAttribute('list', 'colList');
  const add = () => {
    const v = input.value.trim();
    if (v && !cols.includes(v)) save([...cols, v]);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  return h(
    'div',
    { class: 'col-box' },
    cols.map((c) => h('span', { class: 'chip col-chip' }, c, h('button', { class: 'x', text: '×', title: `Quitar de «${c}»`, 'aria-label': `Quitar de ${c}`, onclick: () => save(cols.filter((x) => x !== c)) }))),
    h('div', { class: 'col-add' }, input, h('button', { class: 'btn ghost small', text: 'Añadir', onclick: add })),
    h('datalist', { id: 'colList', hidden: true }, allCollections().filter((c) => !cols.includes(c)).map((c) => h('option', { value: c })))
  );
}

// ---------- apariencia (idea 10) ----------
async function saveAppearance(patch) {
  state.settings = await window.api.saveSettings(patch);
  applyAppearance(state.settings);
  fillAppearance(state.settings);
}
const setTheme = (theme) => saveAppearance({ theme });
const setBackground = (bgGame) => saveAppearance({ bgGame });

function applyAppearance(s) {
  window.appearance.apply(s, (id) => (id === 'last' ? [...games()].filter((g) => g.hero && g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] : findGame(id)));
}

function fillAppearance(s) {
  for (const b of $$('#themeSeg button')) b.classList.toggle('on', b.dataset.v === (s.theme || 'dark'));
  const light = document.documentElement.dataset.theme === 'light';
  const ids = [...Object.keys(window.appearance.PALETTES), 'custom'];
  fill(
    $('#paletteGrid'),
    ids.map((id) => {
      const p = window.appearance.preview(id, s, light);
      const on = (s.palette || 'viper') === id;
      return h(
        'button',
        { type: 'button', class: `swatch${on ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on), onclick: () => saveAppearance({ palette: id }) },
        h('span', { class: 'swatch-art', style: { background: p.bg, color: p.text } }, h('i', { style: { background: p.surface } }), h('b', { style: { background: p.accent } }), h('em', { style: { background: p.sale } }), h('em', { style: { background: p.fresh } })),
        h('span', { class: 'swatch-name', text: id === 'custom' ? 'A tu gusto' : window.appearance.PALETTES[id].name })
      );
    })
  );
  $('#customColors').hidden = s.palette !== 'custom';
  $('#customAccent').value = s.customAccent || '#ef2f34';
  $('#customHue').value = String(s.customHue ?? 352);
  $('#customSat').value = String(s.customSat ?? 16);
  const withArt = games().filter((g) => g.hero && g.kind !== 'tool').sort((a, b) => collator.compare(a.title, b.title));
  $('#bgGame').replaceChildren(
    h('option', { value: '', text: 'Ninguno' }),
    h('option', { value: 'last', text: 'El último que jugaste' }),
    h('optgroup', { label: 'Tus juegos' }, withArt.map((g) => h('option', { value: g.id, text: g.title })))
  );
  $('#bgGame').value = s.bgGame || '';
}

// ---------- carpeta de copias (idea 7) ----------
async function fillBackupDir() {
  let d;
  try {
    d = await window.api.savesDirs();
  } catch {
    return;
  }
  $('#backupDir').textContent = d.current;
  const set = async (dir) => {
    try {
      const r = await window.api.savesSetDir(dir);
      if (!r) return;
      toast(r.moved ? `Copias movidas (${plural(r.moved, 'juego', 'juegos')}). Nueva carpeta: ${r.current}` : `Las copias se guardarán en ${r.current}`);
      fillBackupDir();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  fill(
    $('#backupDirBtns'),
    d.clouds.map((c) => h('button', { type: 'button', class: 'btn ghost small', text: `Usar ${c.name}`, title: c.dir, onclick: () => set(c.dir) })),
    h('button', { type: 'button', class: 'btn ghost small', text: 'Elegir carpeta…', onclick: () => set('pick') }),
    d.custom && h('button', { type: 'button', class: 'btn ghost small', text: 'Volver a Documentos', onclick: () => set(null) }),
    !d.clouds.length && h('span', { class: 'hint', text: 'No se ha encontrado OneDrive ni Google Drive en este PC.' })
  );
}

// ---------- exportar biblioteca (idea 11) ----------
async function exportLibrary(format) {
  try {
    const r = await window.api.exportLibrary(format, { notes: $('#exportNotes').checked });
    if (r) $('#exportState').textContent = `Hecho: ${plural(r.games, 'juego', 'juegos')} en ${r.file}`;
  } catch (e) {
    toast(errMsg(e), true);
  }
}

// ---------- biblioteca en el móvil (idea 8) ----------
async function loadLan() {
  try {
    state.lan = await window.api.lanStatus();
  } catch {
    state.lan = { running: false };
  }
  renderLan();
}

async function lanAction(fn) {
  try {
    state.lan = await fn();
  } catch (e) {
    toast(`No se pudo encender: ${errMsg(e)}`, true);
  }
  renderLan();
}

function renderLan() {
  const l = state.lan || { running: false };
  $('#countLan').textContent = l.running ? '•' : '';
  const box = $('#lanBody');
  if (!box || $('#lanView').hidden) return;
  const auto = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!state.settings?.lanAuto, onchange: async (e) => (state.settings = await window.api.saveSettings({ lanAuto: e.target.checked })) }), 'Encenderla cada vez que abro la app');
  if (!l.running)
    return fill(
      box,
      h(
        'div',
        { class: 'lan-off' },
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, h('b', { text: 'Enciéndela aquí.' }), ' La primera vez Windows te pregunta si la app puede usar la red: elige «Redes privadas».'),
          h('li', {}, h('b', { text: 'Escanea el QR con el móvil.' }), ' Tiene que estar en la misma Wi-Fi que el PC.'),
          h('li', {}, h('b', { text: 'Toca un juego instalado.' }), ' Se abre en el PC después de confirmar.')
        ),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Encender', onclick: () => lanAction(window.api.lanStart) }), auto)
      )
    );
  fill(
    box,
    h(
      'div',
      { class: 'lan-on' },
      l.qr ? h('img', { class: 'lan-qr', src: l.qr, alt: 'Código QR con la dirección de tu biblioteca' }) : h('div', { class: 'lan-qr empty', text: 'Sin red' }),
      h(
        'div',
        {},
        h('h2', { class: 'section-h', text: 'Escanéalo con la cámara del móvil' }),
        l.url ? h('p', { class: 'path', text: l.url }) : h('p', { class: 'hint bad', text: 'Este PC no parece estar conectado a ninguna red local.' }),
        h(
          'ul',
          { class: 'advice' },
          h('li', { text: 'El móvil tiene que estar en la misma Wi-Fi que el PC.' }),
          h('li', { text: 'Desde el móvil puedes buscar, ver tus juegos y abrir en el PC los que están instalados (te pide confirmación).' }),
          h('li', { text: 'El enlace lleva un código secreto: quien no lo tenga no puede entrar. Si lo compartiste sin querer, cámbialo.' }),
          h('li', { text: 'Se apaga al cerrar la app.' })
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn ghost', text: 'Apagar', onclick: () => lanAction(window.api.lanStop) }),
          h('button', { class: 'btn ghost', text: 'Cambiar el código', onclick: () => lanAction(window.api.lanNewCode) })
        ),
        auto
      )
    )
  );
}

function renderAll() {
  $('#genshinTab').hidden = !(state.settings?.genshinUid || games().some((g) => /genshin impact/i.test(g.title)));
  renderTagOptions();
  renderStatusOptions();
  syncControls();
  renderLibrary();
  renderSagas();
}

function showView(view) {
  state.view = view;
  for (const t of $$('.tab')) {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  }
  $('#libraryView').hidden = view !== 'library';
  $('#sagasView').hidden = view !== 'sagas';
  $('#dealsView').hidden = view !== 'deals';
  if (view === 'deals') {
    loadDlcDeals(false);
    loadWallets();
  }
  $('#achView').hidden = view !== 'ach';
  $('#statsView').hidden = view !== 'stats';
  $('#newsView').hidden = view !== 'news';
  $('#friendsView').hidden = view !== 'friends';
  $('#recsView').hidden = view !== 'recs';
  $('#lanView').hidden = view !== 'lan';
  $('#genshinView').hidden = view !== 'genshin';
  $('#musicView').hidden = view !== 'music';
  $('#rgbView').hidden = view !== 'rgb';
  $('#cheatsView').hidden = view !== 'cheats';
  $('#workanaView').hidden = view !== 'workana';
  if (view === 'workana') window.workanaUI?.show();
  $('#calView').hidden = view !== 'cal';
  $('#dayView').hidden = view !== 'day';
  if (view === 'day') window.dayUI?.show();
  $('#linkedinView').hidden = view !== 'linkedin';
  $('#mailView').hidden = view !== 'mail';
  if (view === 'mail') window.mailUI?.show();
  $('#editorView').hidden = view !== 'editor';
  document.body.classList.toggle('editing', view === 'editor');
  if (view === 'linkedin') window.linkedinUI?.show();
  $('#casaView').hidden = !view.startsWith('casa-');
  if (view.startsWith('casa-')) window.casaUI?.show(view.slice(5));
  $('#sensorsView').hidden = view !== 'sensors';
  $('#backlogView').hidden = view !== 'backlog';
  if (view === 'sensors') window.pcUI?.sensorsShow();
  else window.pcUI?.sensorsHide();
  if (view === 'backlog') loadSessions().then(() => window.pcUI?.backlogShow());
  $('#notionView').hidden = view !== 'notion';
  $('#websView').hidden = view !== 'webs';
  if (view === 'cal') window.resto?.calShow();
  if (view === 'notion') window.resto?.notionShow();
  if (view === 'webs') window.resto?.websShow();
  if (view === 'cheats') window.cheats?.show();
  if (view === 'rgb') loadRgb();
  if (view === 'music') window.music?.show();
  if (view === 'genshin') loadGenshin(false);
  if (view === 'lan') loadLan();
  if (view === 'recs') loadRecs(false);
  if (view === 'news') loadNews(false);
  if (view === 'friends') (fr.list ? renderFriendsView() : loadFriends());
  $('#diskView').hidden = view !== 'disk';
  if (view === 'stats') {
    renderStats();
    renderStatsExtra();
  }
  if (view === 'disk') loadDisk();
  if (view === 'ach') {
    ach.detail = null;
    loadAchievements(false);
    loadShowcase();
  }
  $('.search').style.visibility = view === 'library' ? '' : 'hidden';
  if (view === 'sagas') {
    state.saga = null;
    renderSagas();
  }
  $('#scroller').scrollTo({ top: 0 });
}

// ---------- logros ----------
const ach = { summary: null, filter: 'all', sort: 'pct', detail: null, tab: 'missing', loading: false, progress: null, error: null };
const pctOf = (c) => (c.total ? (c.done / c.total) * 100 : 0);
const fmtPct = (p) => (p == null ? '—' : p > 0 && p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`);

function achRows() {
  const cache = ach.summary?.games || {};
  const rows = [];
  for (const g of games()) {
    if (g.store !== 'steam') continue;
    const c = cache[g.id.split(':')[1]];
    if (!c || c.noStats || !c.total) continue;
    rows.push({ g, ...c, pct: pctOf(c) });
  }
  return rows;
}

function renderAchievements() {
  const rows = achRows();
  const plat = rows.filter((r) => r.done === r.total);
  $('#countPlat').textContent = plat.length || '';
  if (ach.detail) return renderAchDetail();
  $('#achList').hidden = false;
  $('#achDetail').hidden = true;

  const btn = $('#achRefresh');
  btn.disabled = ach.loading;
  btn.textContent = ach.loading
    ? ach.progress ? `Leyendo ${ach.progress.done} de ${ach.progress.total}…` : 'Leyendo…'
    : 'Actualizar logros';

  const stats = $('#achStats');
  const box = $('#achGames');
  if (ach.error && !rows.length) {
    stats.replaceChildren();
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'No se pudieron leer tus logros' }), ach.error));
    return;
  }
  if (!rows.length) {
    stats.replaceChildren();
    box.replaceChildren(
      h('div', { class: 'empty' }, h('b', { text: ach.loading ? 'Leyendo tus logros de Steam…' : 'Aún no hay logros' }),
        ach.loading ? 'La primera vez se consulta juego a juego y tarda un poco.' : 'Pulsa «Actualizar logros».')
    );
    return;
  }
  const totalDone = rows.reduce((s, r) => s + r.done, 0);
  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  const started = rows.filter((r) => r.done > 0);
  const avg = started.length ? started.reduce((s, r) => s + r.pct, 0) / started.length : 0;
  const near = rows.filter((r) => r.done < r.total && r.pct >= 75).length;
  stats.replaceChildren(
    h('div', { class: 'stat big' }, h('b', { text: plat.length }), h('span', { text: plat.length === 1 ? 'platino' : 'platinos' })),
    h('div', { class: 'stat' }, h('b', { text: totalDone.toLocaleString('es-CL') }), h('span', { text: `de ${totalAll.toLocaleString('es-CL')} logros conseguidos` })),
    h('div', { class: 'stat' }, h('b', { text: fmtPct(avg) }), h('span', { text: 'completado de media en los juegos que has empezado' })),
    h('div', { class: 'stat' }, h('b', { text: near }), h('span', { text: near === 1 ? 'juego a un paso del platino (75 % o más)' : 'juegos a un paso del platino (75 % o más)' }))
  );
  $('#achSub').textContent = `Tus logros de Steam en ${plural(rows.length, 'juego', 'juegos')} con logros. Epic no ofrece los suyos a programas externos.` +
    (ach.summary?.at ? ` Leídos el ${dateTimeFmt.format(ach.summary.at)}.` : '');

  let list = rows.filter((r) =>
    ach.filter === 'plat' ? r.done === r.total : ach.filter === 'progress' ? r.done > 0 && r.done < r.total : ach.filter === 'none' ? r.done === 0 : true
  );
  const sorters = {
    pct: (a, b) => b.pct - a.pct || a.total - a.done - (b.total - b.done),
    left: (a, b) => (a.done === a.total) - (b.done === b.total) || a.total - a.done - (b.total - b.done) || b.pct - a.pct,
    recent: (a, b) => (b.lastUnlock || 0) - (a.lastUnlock || 0),
    alpha: (a, b) => collator.compare(a.g.title, b.g.title),
  };
  list.sort(sorters[ach.sort] || sorters.pct);
  // Los que marcaste "a por el platino" siempre arriba
  list.sort((a, b) => !!state.user[b.g.id]?.pin - !!state.user[a.g.id]?.pin);
  if (ach.sort === 'left') list = list.filter((r) => r.done > 0);
  box.replaceChildren(
    ...list.map((r) => {
      const isPlat = r.done === r.total;
      return h(
        'button',
        { class: `ach-game${isPlat ? ' plat' : ''}`, onclick: () => openAchDetail(r.g) },
        h('div', { class: 'ach-cover' }, r.g.cover ? coverImg(r.g) : null),
        h(
          'div',
          { class: 'ach-info' },
          h(
            'div',
            { class: 'ach-title' },
            h('span', { text: r.g.title }),
            isPlat && h('span', { class: 'plat-tag', text: 'Platino' }),
            !isPlat && state.user[r.g.id]?.pin && h('span', { class: 'pin-tag', text: 'A por el platino' })
          ),
          h('div', { class: 'bar' }, h('i', { style: { width: `${r.pct.toFixed(1)}%` } })),
          h(
            'div',
            { class: 'ach-meta' },
            h('b', { text: fmtPct(r.pct) }),
            ` ${r.done} de ${r.total}`,
            !isPlat && r.done > 0 ? `, te faltan ${r.total - r.done}` : '',
            r.lastUnlock ? `. Último: ${relTime(r.lastUnlock)}` : ''
          )
        )
      );
    })
  );
  if (!list.length) box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Nada que mostrar con este filtro' })));
}

async function loadAchievements(force) {
  if (ach.loading) return;
  if (!force && ach.summary && Date.now() - (ach.summary.at || 0) < 3600000) return renderAchievements();
  ach.loading = true;
  ach.error = null;
  ach.progress = null;
  renderAchievements();
  try {
    ach.summary = await window.api.achRefresh();
    show.at = 0; // la vitrina se recalcula con los datos nuevos
    if (state.view === 'ach' && !ach.detail) setTimeout(loadShowcase, 0);
  } catch (e) {
    ach.error = errMsg(e);
    toast(ach.error, true);
  } finally {
    ach.loading = false;
    ach.progress = null;
    renderAchievements();
  }
}

function friendsBlock() {
  const f = ach.friends;
  if (!f || f.id !== ach.detail?.g.id) return null;
  if (f.loading) return h('p', { class: 'hint', text: 'Mirando los logros de tus amigos…' });
  if (f.error) return h('p', { class: 'hint bad', text: f.error });
  const list = f.data.friends;
  if (!list.length) return h('p', { class: 'hint', text: `Ninguno de tus amigos con perfil público tiene logros en este juego (${f.data.checked} de ${f.data.total} tienen el perfil público).` });
  return h(
    'div',
    { class: 'friends' },
    h('p', { class: 'hint', text: `Tus amigos en este juego (de ${f.data.checked} con perfil público):` }),
    list.slice(0, 8).map((p) =>
      h(
        'div',
        { class: 'friend-row', 'data-tip': `${p.name}: ${p.done} de ${p.total} logros` },
        p.avatar ? h('img', { src: p.avatar, alt: '', referrerPolicy: 'no-referrer' }) : h('span'),
        h('span', { class: 'bar-label', text: p.name }),
        h('span', { class: 'bar-track' }, h('i', { class: 'bar-fill', style: { width: `${(p.done / p.total) * 100}%` } }), h('span', { class: 'bar-value', text: fmtPct((p.done / p.total) * 100) }))
      )
    )
  );
}

async function loadFriends(g) {
  ach.friends = { id: g.id, loading: true };
  renderAchDetail();
  try {
    ach.friends = { id: g.id, data: await window.api.achFriends(g.id.split(':')[1]) };
  } catch (e) {
    ach.friends = { id: g.id, error: errMsg(e) };
  }
  if (ach.detail?.g.id === g.id) renderAchDetail();
}

async function openAchDetail(g) {
  ach.detail = { g, data: null };
  if (ach.friends?.id !== g.id) ach.friends = null;
  ach.tab = 'missing';
  renderAchDetail();
  $('#scroller').scrollTo({ top: 0 });
  try {
    ach.detail.data = await window.api.achDetail(g.id.split(':')[1]);
  } catch (e) {
    ach.detail.data = { error: errMsg(e) };
  }
  if (ach.detail?.g === g) renderAchDetail();
}

const guideUrl = (site, g, a) => {
  const q = encodeURIComponent(`${g.title} ${a ? `logro "${a.name}"` : 'logros guía'}`);
  return site === 'yt' ? `https://www.youtube.com/results?search_query=${q}` : `https://www.google.com/search?q=${q}`;
};

function renderAchDetail() {
  const { g, data } = ach.detail;
  $('#achList').hidden = true;
  $('#achDetail').hidden = false;
  const appid = g.id.split(':')[1];
  const head = $('#achHeader');
  const items = $('#achItems');
  if (!data) {
    head.replaceChildren(h('h1', { class: 'ach-h1', text: g.title }));
    items.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Cargando logros…' })));
    return;
  }
  if (data.error || !data.total) {
    head.replaceChildren(h('h1', { class: 'ach-h1', text: g.title }));
    items.replaceChildren(h('div', { class: 'empty' }, h('b', { text: data.error ? 'No se pudieron leer los logros' : 'Este juego no tiene logros' }), data.error || ''));
    return;
  }
  const pct = (data.done / data.total) * 100;
  const isPlat = data.done === data.total;
  head.replaceChildren(
    h('div', { class: 'ach-head-cover' }, g.cover ? coverImg(g) : null),
    h(
      'div',
      { class: 'ach-head-body' },
      isPlat ? h('p', { class: 'plat-kicker', text: 'Platino conseguido' }) : h('p', { class: 'hero-kicker', text: `Te faltan ${data.total - data.done} logros` }),
      h('h1', { class: 'ach-h1', text: g.title }),
      h('div', { class: 'ach-big' }, h('b', { text: fmtPct(pct) }), h('span', { text: `${data.done} de ${data.total} logros` })),
      h('div', { class: 'bar wide' }, h('i', { style: { width: `${pct.toFixed(1)}%` } })),
      data.advice?.length ? h('ul', { class: 'advice' }, data.advice.map((t) => h('li', { text: t }))) : null,
      friendsBlock(),
      h(
        'div',
        { class: 'row' },
        !isPlat &&
          h('button', {
            class: `btn small ${state.user[g.id]?.pin ? 'primary' : 'ghost'}`,
            text: state.user[g.id]?.pin ? 'Vas a por el platino' : 'Voy a por el platino',
            onclick: async () => {
              await setUser(g.id, { pin: !state.user[g.id]?.pin });
              renderAchDetail();
            },
          }),
        h('button', { class: 'btn ghost small', text: 'Comparar con mis amigos', onclick: () => loadFriends(g) }),
        h('button', { class: 'btn ghost small', text: 'Guías de Steam', onclick: () => window.api.open(`https://steamcommunity.com/app/${appid}/guides/`) }),
        h('button', { class: 'btn ghost small', text: 'Buscar guía en YouTube', onclick: () => window.api.open(guideUrl('yt', g)) }),
        h('button', { class: 'btn ghost small', text: 'Rareza global en Steam', onclick: () => window.api.open(`https://steamcommunity.com/stats/${appid}/achievements`) })
      )
    )
  );
  for (const b of $$('#achTabs button')) {
    b.classList.toggle('on', b.dataset.v === ach.tab);
    b.textContent = b.dataset.v === 'missing' ? `Te faltan (${data.missing.length})` : `Conseguidos (${data.got.length})`;
  }
  const list = ach.tab === 'missing' ? data.missing : data.got;
  if (!list.length) {
    items.replaceChildren(h('div', { class: 'empty' }, h('b', { text: ach.tab === 'missing' ? 'No te falta ninguno' : 'Aún no tienes ninguno' })));
    return;
  }
  items.replaceChildren(
    ...list.map((a, i) =>
      h(
        'article',
        { class: `ach-item${a.achieved ? ' got' : ''}` },
        h('img', { class: 'ach-icon', src: (a.achieved ? a.icon : a.iconGray) || '', alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
        h(
          'div',
          { class: 'ach-body' },
          h('div', { class: 'ach-name' }, h('b', { text: a.name }), !a.achieved && i === 0 && a.globalPct != null && h('span', { class: 'easy-tag', text: 'El más fácil' })),
          h('p', { class: 'ach-desc', text: a.description || (a.hidden ? 'Logro oculto' : '') }),
          h(
            'div',
            { class: 'ach-tags' },
            h('span', { class: `rar ${a.rarity.key}`, text: a.globalPct != null ? `${a.rarity.label}: ${fmtPct(a.globalPct)} de los jugadores` : a.rarity.label }),
            a.kindLabel && h('span', { class: 'kind', text: a.kindLabel }),
            a.achieved && a.unlockTime && h('span', { class: 'kind', text: `Conseguido el ${dateFmt.format(a.unlockTime * 1000)}` }),
            !a.achieved && ach.friends?.data?.byAch?.[a.api]?.length && h('span', { class: 'kind friend', text: `Lo tienen: ${ach.friends.data.byAch[a.api].slice(0, 3).join(', ')}${ach.friends.data.byAch[a.api].length > 3 ? ` y ${ach.friends.data.byAch[a.api].length - 3} más` : ''}` })
          ),
          !a.achieved && a.tip && h('p', { class: 'ach-tip', text: a.tip }),
          !a.achieved &&
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn ghost small', text: 'Ver en YouTube', onclick: () => window.api.open(guideUrl('yt', g, a)) }),
              h('button', { class: 'btn ghost small', text: 'Buscar en Google', onclick: () => window.api.open(guideUrl('g', g, a)) })
            )
        )
      )
    )
  );
}

// ---------- gráficos de barras ----------
// Una sola serie: sin leyenda (el título dice qué se mide), valor en la punta
// de la barra con color de texto, y el detalle en el tooltip.
function barList(rows, { empty = 'Sin datos' } = {}) {
  if (!rows.length) return h('p', { class: 'hint', text: empty });
  const max = Math.max(...rows.map((r) => r.value), 1);
  return h(
    'div',
    { class: 'bars', role: 'table' },
    rows.map((r) =>
      h(
        r.onClick ? 'button' : 'div',
        { class: 'bar-row', role: 'row', 'data-tip': r.tip || '', onclick: r.onClick || null },
        h('span', { class: 'bar-label', role: 'cell', text: r.label }),
        h(
          'span',
          { class: 'bar-track', role: 'cell' },
          h('i', { class: 'bar-fill', style: { width: `${Math.max(0.8, (r.value / max) * 100)}%` } }),
          h('span', { class: 'bar-value', text: r.valueText })
        )
      )
    )
  );
}

function statTile(value, label, hero) {
  return h('div', { class: `stat${hero ? ' hero-stat' : ''}` }, h('b', { text: value }), h('span', { text: label }));
}

// Tooltip compartido para todo lo que tenga data-tip
function bindTips() {
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || !el.dataset.tip) {
      tip.hidden = true;
      return;
    }
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.min(e.clientY + 16, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
}

// ---------- estadísticas ----------
function renderStats() {
  const steamGames = games().filter((g) => g.store === 'steam');
  const totalMin = steamGames.reduce((s, g) => s + (g.playtimeMin || 0), 0);
  const recentMin = steamGames.reduce((s, g) => s + (g.playtime2wMin || 0), 0);
  const played = steamGames.filter((g) => g.playtimeMin > 0);
  const never = steamGames.filter(neverPlayed);
  const share = (m) => (totalMin ? `${((m / totalMin) * 100).toFixed(1).replace('.', ',')} % de tus horas` : '');

  const top = [...played].sort((a, b) => b.playtimeMin - a.playtimeMin).slice(0, 15);
  const bySaga = new Map();
  for (const g of played) if (g.saga) bySaga.set(g.saga, (bySaga.get(g.saga) || 0) + g.playtimeMin);
  const byTag = new Map();
  for (const g of played) for (const t of (g.tags || []).slice(0, 3)) byTag.set(t, (byTag.get(t) || 0) + g.playtimeMin);
  const recent = steamGames.filter((g) => g.playtime2wMin > 0).sort((a, b) => b.playtime2wMin - a.playtime2wMin);

  $('#statsBody').replaceChildren(
    h(
      'div',
      { class: 'ach-stats' },
      statTile(`${Math.round(totalMin / 60).toLocaleString('es-CL')} h`, 'jugadas en Steam en total', true),
      statTile(String(played.length), 'juegos de Steam con alguna partida'),
      statTile(String(never.length), never.length === 1 ? 'juego de Steam sin estrenar' : 'juegos de Steam sin estrenar'),
      statTile(fmtHours(recentMin), 'en las últimas 2 semanas')
    ),
    h(
      'div',
      { class: 'stat-grid' },
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: 'Los que más has jugado' }),
        barList(
          top.map((g) => ({
            label: g.title,
            value: g.playtimeMin,
            valueText: fmtHours(g.playtimeMin),
            tip: `${g.title}: ${fmtHours(g.playtimeMin)}, ${share(g.playtimeMin)}`,
            onClick: () => openGame(g),
          }))
        )
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: 'Últimas 2 semanas' }),
        barList(
          recent.map((g) => ({
            label: g.title,
            value: g.playtime2wMin,
            valueText: fmtHours(g.playtime2wMin),
            tip: `${g.title}: ${fmtHours(g.playtime2wMin)} en 2 semanas`,
            onClick: () => openGame(g),
          })),
          { empty: 'No has jugado a nada de Steam en las últimas 2 semanas.' }
        ),
        h('h2', { class: 'section-h', text: 'Horas por saga' }),
        barList(
          [...bySaga]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([s, m]) => ({
              label: s,
              value: m,
              valueText: fmtHours(m),
              tip: `${s}: ${fmtHours(m)}, ${share(m)}`,
              onClick: () => {
                showView('sagas');
                openSaga(s);
              },
            })),
          { empty: 'Aún no hay horas en ninguna saga.' }
        )
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: 'Horas por categoría' }),
        h('p', { class: 'hint', text: 'Cada juego suma sus horas a sus 3 categorías principales.' }),
        barList(
          [...byTag]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([t, m]) => ({ label: t, value: m, valueText: fmtHours(m), tip: `${t}: ${fmtHours(m)}`, onClick: () => filterByTag(t) }))
        )
      )
    )
  );
}

// ---------- espacio en disco ----------
const STALE_DAYS = 90;
async function loadDisk() {
  try {
    state.disk = await window.api.diskInfo();
  } catch (e) {
    state.disk = { error: errMsg(e) };
  }
  renderDisk();
  renderCaches();
}

function renderDisk() {
  const d = state.disk;
  const box = $('#diskBody');
  if (!d) return box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Calculando…' })));
  if (d.error) return box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'No se pudo leer el espacio' }), d.error));
  const installed = games().filter((g) => g.installed && g.sizeBytes);
  const now = Date.now() / 1000;
  // Sin fecha de última partida: en Steam es que nunca se ha jugado; en Epic solo
  // se sabe de los juegos que Windows o el launcher han visto abrirse.
  const stale = installed
    .filter((g) => (g.lastPlayed ? now - g.lastPlayed > STALE_DAYS * 86400 : g.store === 'steam'))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
  const freeable = stale.reduce((s, g) => s + g.sizeBytes, 0);

  const drives = d.map((dr) => {
    const gamesB = dr.gamesBytes;
    const used = dr.total != null ? dr.total - dr.free : null;
    const other = used != null ? Math.max(0, used - gamesB) : 0;
    const pct = (v) => (dr.total ? (v / dr.total) * 100 : 0);
    const low = dr.total && dr.free / dr.total < 0.1;
    const letter = dr.drive.slice(0, 2);
    return h(
      'section',
      { class: 'panel drive' },
      h(
        'div',
        { class: 'drive-head' },
        h('h2', { class: 'section-h', text: `Unidad ${letter}` }),
        h('span', { class: 'hint', text: dr.total ? `${fmtBytes(dr.free)} libres de ${fmtBytes(dr.total)}` : '' })
      ),
      dr.total
        ? h(
            'div',
            { class: 'meter', role: 'img', 'aria-label': `Juegos ${fmtBytes(gamesB)}, otros archivos ${fmtBytes(other)}, libre ${fmtBytes(dr.free)}` },
            h('i', { class: 'seg-games', style: { width: `${pct(gamesB)}%` }, 'data-tip': `Juegos: ${fmtBytes(gamesB)} (${Math.round(pct(gamesB))} %)` }),
            h('i', { class: 'seg-other', style: { width: `${pct(other)}%` }, 'data-tip': `Otros archivos: ${fmtBytes(other)} (${Math.round(pct(other))} %)` })
          )
        : null,
      h(
        'div',
        { class: 'legend' },
        h('span', {}, h('i', { class: 'sw games' }), `Juegos (${fmtBytes(gamesB)})`),
        h('span', {}, h('i', { class: 'sw other' }), `Otros archivos (${fmtBytes(other)})`),
        h('span', {}, h('i', { class: 'sw free' }), 'Libre')
      ),
      low && h('p', { class: 'status-warn', text: '⚠ Queda menos del 10 % libre en esta unidad.' })
    );
  });

  box.replaceChildren(
    h(
      'div',
      { class: 'ach-stats' },
      statTile(fmtBytes(freeable), `podrías liberar con ${plural(stale.length, 'juego que no juegas', 'juegos que no juegas')} desde hace más de ${STALE_DAYS} días`, true),
      statTile(fmtBytes(installed.reduce((s, g) => s + g.sizeBytes, 0)), `ocupan tus ${installed.length} juegos instalados`)
    ),
    h('div', { class: 'drives' }, drives),
    h(
      'section',
      { class: 'panel saves-all' },
      h('h2', { class: 'section-h', text: 'Copia de partidas guardadas' }),
      h('p', { class: 'hint', text: 'Copia las partidas de todos tus juegos instalados a Documentos\\Biblioteca de juegos - partidas guardadas. Usa la base de datos de Ludusavi para saber dónde guarda cada juego.' }),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn primary small',
          text: 'Copiar las partidas de todos',
          onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = 'Copiando…';
            try {
              const r = await window.api.savesBackupAll();
              toast(`Copias hechas de ${r.ok} de ${r.total} juegos${r.skipped.length ? ` (sin partidas en este PC: ${r.skipped.slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''})` : ''}.`);
            } catch (err) {
              toast(errMsg(err), true);
            }
            e.target.disabled = false;
            e.target.textContent = 'Copiar las partidas de todos';
          },
        }),
        h('button', { class: 'btn ghost small', text: 'Abrir carpeta de copias', onclick: () => window.api.savesOpen(null) })
      )
    ),
    h(
      'div',
      { class: 'stat-grid two' },
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: 'Cachés que puedes borrar' }),
        h('p', { class: 'hint', text: 'Sombreadores (shaders) que guardan Steam, DirectX y los drivers de tu gráfica. Se vuelven a crear solos; al abrir cada juego por primera vez después puede ir con algún tirón.' }),
        h('div', { id: 'cacheBox' })
      ),
      duplicatesPanel()
    ),
    h(
      'div',
      { class: 'stat-grid two' },
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: 'Para liberar espacio' }),
        h('p', { class: 'hint', text: `Instalados que no juegas desde hace más de ${STALE_DAYS} días, o nunca, de mayor a menor.` }),
        stale.length
          ? h(
              'div',
              { class: 'stale' },
              stale.map((g) =>
                h(
                  'div',
                  { class: 'stale-row' },
                  h('button', { class: 'link-title', text: g.title, onclick: () => openGame(g) }),
                  h('span', { class: 'hint', text: `${fmtBytes(g.sizeBytes)}, ${g.lastPlayed ? `jugado ${relTime(g.lastPlayed)}` : 'nunca jugado'}` }),
                  g.store === 'steam'
                    ? h('button', {
                        class: 'btn ghost small',
                        text: 'Desinstalar',
                        title: 'Steam te pedirá confirmación',
                        onclick: () => window.api.open(`steam://uninstall/${g.id.split(':')[1]}`),
                      })
                    : h('span', { class: 'hint', text: 'Desde el Epic Games Launcher' })
                )
              )
            )
          : h('p', { class: 'hint', text: 'Todo lo que tienes instalado lo has jugado hace poco.' })
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: 'Lo que más ocupa' }),
        barList(
          [...installed]
            .sort((a, b) => b.sizeBytes - a.sizeBytes)
            .slice(0, 15)
            .map((g) => ({
              label: g.title,
              value: g.sizeBytes,
              valueText: fmtBytes(g.sizeBytes),
              tip: `${g.title}: ${fmtBytes(g.sizeBytes)} en ${(g.installPath || '').slice(0, 2)}`,
              onClick: () => openGame(g),
            }))
        )
      )
    )
  );
}

// ---------- sesiones registradas por la app ----------
const sessMin = (s) => Math.max(0, (s.end - s.start) / 60000);
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const monthKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthFmt = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric' });

async function loadSessions() {
  try {
    state.sessions = await window.api.sessions();
  } catch {
    state.sessions = { list: [], current: null };
  }
}
const allSessions = () => state.sessions?.list || [];
const gameSessions = (id) => allSessions().filter((s) => s.id === id);

function columnChart(days) {
  const max = Math.max(...days.map((d) => d.min), 1);
  const peak = days.reduce((a, b) => (b.min > a.min ? b : a), days[0]);
  return h(
    'div',
    { class: 'cols', role: 'img', 'aria-label': 'Minutos jugados por día en los últimos 14 días' },
    days.map((d) =>
      h(
        'div',
        { class: 'col', 'data-tip': `${d.label}: ${d.min ? fmtHours(Math.round(d.min)) : 'sin partidas'}` },
        h('span', { class: 'col-val', text: d === peak && d.min ? fmtHours(Math.round(d.min)) : '' }),
        h('i', { class: 'col-bar', style: { height: `${d.min ? Math.max(3, (d.min / max) * 100) : 0}%` } }),
        h('span', { class: 'col-lbl', text: d.short })
      )
    )
  );
}

function renderStatsExtra() {
  const body = $('#statsBody');
  const list = allSessions();
  const since = list.length ? Math.min(...list.map((s) => s.start)) : null;
  // Últimos 14 días
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), label: dateFmt.format(d), short: shortDay.format(d).replace('.', ''), min: 0 });
  }
  const byDay = new Map(days.map((d) => [d.key, d]));
  for (const s of list) {
    const d = byDay.get(dayKey(s.start));
    if (d) d.min += sessMin(s);
  }
  // Por juego (todas las tiendas, incluido Epic)
  const byGame = new Map();
  for (const s of list) byGame.set(s.id, (byGame.get(s.id) || 0) + sessMin(s));
  const rows = [...byGame]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, m]) => {
      const g = findGame(id);
      return { label: g?.title || id, value: m, valueText: fmtHours(Math.round(m)), tip: `${g?.title || id}: ${fmtHours(Math.round(m))} registradas por la app`, onClick: g ? () => openGame(g) : null };
    });
  const note = since
    ? `La app registra tus partidas desde el ${dateFmt.format(since)}, mientras está abierta (o minimizada). Incluye Epic.`
    : 'La app empieza a registrar tus partidas ahora: cuenta el tiempo de cualquier juego instalado mientras está abierta o minimizada. Incluye Epic.';
  body.append(
    h('h2', { class: 'section-h big', text: 'Registrado por la app' }),
    h('p', { class: 'hint', text: note }),
    h(
      'div',
      { class: 'stat-grid' },
      h('section', { class: 'panel' }, h('h2', { class: 'section-h', text: 'Últimos 14 días' }), columnChart(days)),
      h('section', { class: 'panel' }, h('h2', { class: 'section-h', text: 'Por juego (Steam y Epic)' }), barList(rows, { empty: 'Aún no hay partidas registradas.' }))
    ),
    topOfYear(),
    monthCard()
  );
}

// ---------- resumen del mes ----------
let monthSel = null;
function monthData(mk) {
  const inMonth = (t) => t && monthKey(t) === mk;
  const sess = allSessions().filter((s) => inMonth(s.start));
  const minutes = sess.reduce((a, s) => a + sessMin(s), 0);
  const byGame = new Map();
  for (const s of sess) byGame.set(s.id, (byGame.get(s.id) || 0) + sessMin(s));
  const topId = [...byGame].sort((a, b) => b[1] - a[1])[0];
  let unlocks = 0;
  const plats = [];
  for (const [appid, c] of Object.entries(ach.summary?.games || {})) {
    const u = (c.unlocks || []).filter((t) => inMonth(t * 1000));
    unlocks += u.length;
    if (c.total && c.done === c.total && c.lastUnlock && inMonth(c.lastUnlock * 1000)) plats.push(findGame(`steam:${appid}`)?.title || appid);
  }
  const finished = Object.entries(state.user)
    .filter(([, u]) => u.finishedAt && inMonth(u.finishedAt))
    .map(([id]) => findGame(id)?.title || id);
  return { minutes, sessions: sess.length, top: topId ? { g: findGame(topId[0]), min: topId[1] } : null, unlocks, plats, finished };
}

function monthCard() {
  const months = new Set([monthKey(Date.now())]);
  for (const s of allSessions()) months.add(monthKey(s.start));
  for (const c of Object.values(ach.summary?.games || {})) for (const t of c.unlocks || []) months.add(monthKey(t * 1000));
  const sorted = [...months].sort().reverse().slice(0, 24);
  if (!monthSel || !months.has(monthSel)) monthSel = sorted[0];
  const [y, m] = monthSel.split('-').map(Number);
  const title = monthFmt.format(new Date(y, m - 1, 1));
  const d = monthData(monthSel);
  const sel = h(
    'select',
    { 'aria-label': 'Mes', onchange: (e) => { monthSel = e.target.value; const c = $('#monthCard'); c.replaceWith(monthCard()); } },
    sorted.map((k) => {
      const [yy, mm] = k.split('-').map(Number);
      return h('option', { value: k, text: monthFmt.format(new Date(yy, mm - 1, 1)) });
    })
  );
  sel.value = monthSel;
  const card = h(
    'section',
    { id: 'monthCard', class: 'month-card' },
    h('p', { class: 'hero-kicker', text: 'Tu mes en juegos' }),
    h('h2', { text: title.charAt(0).toUpperCase() + title.slice(1) }),
    h(
      'div',
      { class: 'ach-stats' },
      statTile(d.minutes ? fmtHours(Math.round(d.minutes)) : '—', d.minutes ? `jugadas en ${plural(d.sessions, 'sesión', 'sesiones')}` : 'sin partidas registradas', true),
      statTile(String(d.unlocks), d.unlocks === 1 ? 'logro conseguido' : 'logros conseguidos'),
      statTile(String(d.plats.length), d.plats.length === 1 ? 'platino' : 'platinos'),
      statTile(String(d.finished.length), d.finished.length === 1 ? 'juego terminado' : 'juegos terminados')
    ),
    d.top?.g && h('p', { class: 'month-top' }, 'Lo que más jugaste: ', h('b', { text: d.top.g.title }), ` (${fmtHours(Math.round(d.top.min))})`),
    d.plats.length ? h('p', { class: 'hint', text: `Platinos: ${d.plats.join(', ')}.` }) : null,
    d.finished.length ? h('p', { class: 'hint', text: `Terminados: ${d.finished.join(', ')}.` }) : null
  );
  return h(
    'div',
    { id: 'monthWrap', class: 'month-wrap' },
    h('div', { class: 'row month-tools' }, sel, h('button', { class: 'btn ghost small', text: 'Guardar como imagen', onclick: () => saveMonthCard(title) })),
    card
  );
}

async function saveMonthCard(title) {
  const card = $('#monthCard');
  card.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 350));
  const r = card.getBoundingClientRect();
  const file = await window.api.saveCard({ x: r.left, y: r.top, width: r.width, height: r.height }, `Mi mes en juegos - ${title}`);
  if (file) toast('Imagen guardada.');
}

// ---------- ¿A qué juego? ----------
const SHORT_TAGS = /roguelike|roguelite|arcade|casual|partidas r[aá]pidas|puzles|multijugador|jcj|deportes|carreras|lucha|cartas|party/i;
const LONG_TAGS = /\brol\b|mundo abierto|buena trama|historia|exploraci[oó]n|metroidvania|dark souls|estrategia|simulaci[oó]n|supervivencia/i;
const pick = { time: 'mid', tag: '', installed: true, finished: false, last: [] };

function pickCandidates() {
  return games().filter((g) => {
    const u = state.user[g.id] || {};
    if (pick.installed && !g.installed) return false;
    if (!pick.finished && (u.status === 'finished' || u.status === 'dropped')) return false;
    if (pick.tag && !(g.tags || []).includes(pick.tag)) return false;
    return true;
  });
}

function pickReason(g) {
  const u = state.user[g.id] || {};
  const tags = (g.tags || []).join(' ');
  if (u.status === 'playing') return 'Lo tienes a medias';
  if (u.pin) return 'Vas a por el platino';
  if (u.status === 'pending') return 'Lo tenías pendiente';
  if (neverPlayed(g)) return 'Aún no lo has estrenado';
  if (pick.time === 'short' && SHORT_TAGS.test(tags)) return 'Va bien para un rato';
  if (pick.time === 'long' && LONG_TAGS.test(tags)) return 'Para engancharse varias horas';
  if (g.lastPlayed && Date.now() / 1000 - g.lastPlayed > 180 * 86400) return `No lo juegas desde ${relTime(g.lastPlayed)}`;
  return (g.tags || []).slice(0, 2).join(', ') || 'Por variar';
}

function rollPick() {
  const list = pickCandidates();
  const weight = (g) => {
    const u = state.user[g.id] || {};
    const tags = (g.tags || []).join(' ');
    let w = 1;
    if (u.status === 'playing') w += 3;
    if (u.status === 'pending') w += 2;
    if (u.fav) w += 1;
    if (u.pin) w += 1;
    if (pick.time === 'short') w += SHORT_TAGS.test(tags) ? 2 : LONG_TAGS.test(tags) ? -0.7 : 0;
    if (pick.time === 'long') w += LONG_TAGS.test(tags) ? 2 : SHORT_TAGS.test(tags) ? -0.5 : 0;
    w += window.backlogBoost?.(g) || 0; // le falta poco para terminarlo
    if (pick.last.includes(g.id)) w *= 0.2; // que no repita la tirada anterior
    return Math.max(0.1, w);
  };
  const pool = list.map((g) => ({ g, w: weight(g) }));
  const out = [];
  while (out.length < 3 && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    const i = pool.findIndex((x) => (r -= x.w) <= 0);
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0].g);
  }
  pick.last = out.map((g) => g.id);
  return { out, total: list.length };
}

function renderPick(result) {
  const counts = new Map();
  for (const g of games()) for (const t of g.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const tagSel = h('select', { 'aria-label': 'Qué te apetece', onchange: (e) => { pick.tag = e.target.value; } }, h('option', { value: '', text: 'Lo que sea' }), tags.map(([t]) => h('option', { value: t, text: t })));
  tagSel.value = pick.tag;
  const seg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Tiempo' },
    [['short', 'Un rato'], ['mid', 'Una tarde'], ['long', 'Mucho tiempo']].map(([v, l]) =>
      h('button', { class: pick.time === v ? 'on' : '', text: l, onclick: () => { pick.time = v; renderPick(result); } })
    )
  );
  $('#pickBody').replaceChildren(
    h('h2', { text: '¿A qué juego?' }),
    h(
      'div',
      { class: 'toolbar flat' },
      h('div', { class: 'field' }, h('span', { class: 'field-lbl', text: 'Tiempo' }), seg),
      h('div', { class: 'field' }, h('span', { class: 'field-lbl', text: 'Me apetece' }), tagSel),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: pick.installed, onchange: (e) => { pick.installed = e.target.checked; } }), 'Solo instalados'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: pick.finished, onchange: (e) => { pick.finished = e.target.checked; } }), 'Incluir terminados')
    ),
    result
      ? result.out.length
        ? h(
            'div',
            { class: 'picks' },
            result.out.map((g) =>
              h(
                'div',
                { class: 'pick' },
                h('div', { class: 'cover' }, g.cover ? coverImg(g) : h('div', { class: 'ph', text: g.title })),
                h('h3', { text: g.title }),
                h('p', { class: 'hint', text: pickReason(g) }),
                h(
                  'div',
                  { class: 'row' },
                  h('button', { class: 'btn primary small', text: g.installed ? 'Jugar' : 'Instalar', onclick: () => { $('#pickDlg').close(); launch(g); } }),
                  h('button', { class: 'btn ghost small', text: 'Ficha', onclick: () => { $('#pickDlg').close(); openGame(g); } })
                )
              )
            )
          )
        : h('p', { class: 'hint', text: 'Ningún juego cumple esos filtros. Prueba a quitar alguno.' })
      : null,
    result && h('p', { class: 'hint', text: `Elegidos entre ${plural(result.total, 'juego', 'juegos')} que cumplen los filtros.` }),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn ghost', text: 'Cerrar', onclick: () => $('#pickDlg').close() }),
      h('button', { class: 'btn primary', text: result ? 'Otra tirada' : 'Elegir', onclick: () => renderPick(rollPick()) })
    )
  );
}

function openPick() {
  renderPick(rollPick());
  $('#pickDlg').showModal();
}

// ---------- búsqueda rápida (Ctrl+K) ----------
const VIEWS = [
  ['library', 'Juegos'], ['sagas', 'Sagas'], ['ach', 'Logros'], ['stats', 'Estadísticas'],
  ['news', 'Novedades'], ['friends', 'Amigos'], ['deals', 'Ofertas'], ['disk', 'Espacio'],
  ['day', 'Mi día'], ['backlog', 'Backlog'], ['genshin', 'Genshin'], ['sensors', 'Sensores'], ['cal', 'Calendario'], ['notion', 'Notion'], ['webs', 'Websites'],
  ['workana', 'Workana'], ['linkedin', 'LinkedIn'], ['mail', 'Email'], ['casa-compras', 'Compras'], ['casa-pagos', 'Pagos'], ['casa-presupuesto', 'Presupuesto'],
  ['casa-recordatorios', 'Recordatorios'], ['casa-cumples', 'Cumpleaños'], ['casa-regalos', 'Regalos'], ['casa-gatitos', 'Gatitos'], ['casa-feriados', 'Feriados'], ['casa-alquileres', 'Alquileres'],
];
let palIndex = 0;
let palItems = [];

function openPalette() {
  const p = $('#palette');
  p.hidden = false;
  window.refreshSearchIndex?.().then(() => renderPalette($('#palInput').value));
  const input = $('#palInput');
  input.value = '';
  renderPalette('');
  input.focus();
}
function closePalette() {
  $('#palette').hidden = true;
}
function renderPalette(q) {
  const t = normTitle(q);
  const list = state.lib?.games || [];
  let found = [];
  if (t) {
    const starts = [];
    const has = [];
    for (const g of list) {
      const n = normTitle(g.title);
      if (n.startsWith(t)) starts.push(g);
      else if (n.includes(t)) has.push(g);
    }
    found = [...starts, ...has].slice(0, 8).map((g) => ({ kind: 'game', g }));
  } else {
    found = recentGames().slice(0, 6).map((g) => ({ kind: 'game', g }));
  }
  const views = VIEWS.filter(([, l]) => !t || normTitle(l).startsWith(t)).slice(0, t ? 3 : 0).map(([v, l]) => ({ kind: 'view', v, l }));
  const extra = t ? window.paletteExtra?.(q) || [] : [];
  palItems = [...found, ...views, ...extra];
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  $('#palList').replaceChildren(
    ...(palItems.length
      ? palItems.map((it, i) =>
          h(
            'button',
            { class: `pal-item${i === palIndex ? ' on' : ''}`, onclick: () => runPalette(i, false), onmouseenter: () => { palIndex = i; renderPaletteSel(); } },
            it.kind === 'game'
              ? [h('span', { class: 'pal-cover' }, it.g.cover ? coverImg(it.g) : null), h('span', { class: 'pal-title', text: it.g.title }), h('span', { class: 'pal-hint', text: it.g.installed ? 'Enter: jugar' : 'Enter: ficha' })]
              : it.kind === 'extra'
                ? [h('span', { class: 'pal-cover' }), h('span', { class: 'pal-title', text: it.label }), h('span', { class: 'pal-hint', text: it.hint })]
                : [h('span', { class: 'pal-cover' }), h('span', { class: 'pal-title', text: `Ir a ${it.l}` }), h('span', { class: 'pal-hint', text: 'Sección' })]
          )
        )
      : [h('p', { class: 'hint pal-empty', text: 'Ningún juego con ese nombre.' })])
  );
}
function renderPaletteSel() {
  $$('#palList .pal-item').forEach((b, i) => b.classList.toggle('on', i === palIndex));
}
function runPalette(i, sheet) {
  const it = palItems[i];
  if (!it) return;
  closePalette();
  if (it.kind === 'view') return showView(it.v);
  if (it.kind === 'extra') return it.run();
  if (sheet || !it.g.installed) return openGame(it.g);
  launch(it.g);
}

// ---------- novedades ----------
async function loadNews(force) {
  if (state.newsLoading) return;
  if (!force && state.news && Date.now() - state.news.at < 3600000) return renderNews();
  state.newsLoading = true;
  renderNews();
  try {
    const [items, rel, nin] = await Promise.all([window.api.news(), window.api.releases(), window.api.nintendo(force).catch(() => [])]);
    state.news = { at: Date.now(), items, releases: rel, nintendo: nin };
  } catch (e) {
    state.news = { at: Date.now(), error: errMsg(e), items: [], releases: [], nintendo: [] };
  }
  state.newsLoading = false;
  renderNews();
  if (openGameId && $('#gameDlg').open) fillGameNews(findGame(openGameId));
}

function renderNews() {
  const n = state.news;
  const week = n ? n.items.filter((i) => Date.now() / 1000 - i.date < 7 * 86400).length : 0;
  $('#countNews').textContent = week || '';
  const box = $('#newsBody');
  if (!box || $('#newsView').hidden) return;
  const tab = state.newsTab || 'juegos';
  const tabs = h('div', { class: 'seg nw-tabs', role: 'tablist', 'aria-label': 'Novedades' },
    [['juegos', 'Juegos'], ['anime', 'Anime'], ['nintendo', 'Nintendo']].map(([k, t]) => h('button', { class: tab === k ? 'on' : '', role: 'tab', 'aria-selected': String(tab === k), text: t, onclick: () => { state.newsTab = k; renderNews(); } })));
  if (tab === 'anime') return fill(box, tabs, window.animeUI?.render() || null);
  if (!n) return fill(box, tabs, h('div', { class: 'empty' }, h('b', { text: 'Buscando novedades de tus juegos…' })));
  if (tab === 'nintendo') return fill(box, tabs, renderNintendo(n.nintendo || []));

  const header = (appid) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
  const appGame = (appid) => findGame(`steam:${appid}`);
  const filter = state.newsFilter || 'all';
  const items = n.items.filter((it) => filter === 'all' || (filter === 'patch' ? it.patch : !it.patch)).slice(0, 40);
  const [top, ...rest] = items;
  const meta = (it, g) => h('div', { class: 'news-meta' }, h('b', { text: g?.title || '' }), h('span', { text: relTime(it.date) }), it.patch && h('span', { class: 'kind', text: 'Parche' }), g?.updatePending && h('span', { class: 'flag-inline', text: 'Actualización pendiente' }));
  const img = (src, cls) => h('img', { class: cls, src, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() });
  const feature = top && (() => {
    const g = appGame(top.appid);
    return h('button', { class: 'nw-feature', onclick: () => window.api.open(top.url), title: 'Abrir en Steam' },
      img(g?.hero || header(top.appid), 'nw-feature-art'),
      h('div', { class: 'nw-feature-body' }, meta(top, g), h('h2', { text: top.title }), top.text && h('p', { text: top.text }))
    );
  })();
  const card = (it) => {
    const g = appGame(it.appid);
    return h('button', { class: 'nw-card', onclick: () => window.api.open(it.url), title: 'Abrir en Steam' },
      h('div', { class: 'nw-card-art' }, img(header(it.appid))),
      h('div', { class: 'nw-card-body' }, meta(it, g), h('h3', { text: it.title }), it.text && h('p', { class: 'hint', text: it.text }))
    );
  };
  const rel = n.releases.map((r) => {
    const days = r.date ? Math.ceil((r.date * 1000 - Date.now()) / 86400000) : null;
    return h('button', { class: 'nw-rel', onclick: () => window.api.open(`https://store.steampowered.com/app/${r.appid}/`) },
      img(r.header),
      h('div', { class: 'nw-rel-body' },
        h('b', { text: r.name }),
        h('span', { text: r.date ? (r.exact ? dateFmt.format(r.date * 1000) : `Hacia ${monthFmt.format(r.date * 1000)}`) : r.label || 'Sin fecha' }),
        days != null && days >= 0 && r.exact && h('em', { text: days === 0 ? 'Sale hoy' : `Faltan ${days} ${days === 1 ? 'día' : 'días'}` })
      )
    );
  });
  fill(
    box,
    tabs,
    n.error ? h('p', { class: 'hint bad', text: n.error }) : null,
    window.giveawaysSection?.(),
    rel.length ? h('section', { class: 'nw-rels-wrap' }, h('h2', { class: 'section-h', text: 'Próximos lanzamientos de tu lista de deseados' }), h('div', { class: 'nw-rels' }, rel)) : null,
    h('div', { class: 'toolbar flat nw-filter' },
      h('h2', { class: 'section-h', text: 'Anuncios de tus juegos' }),
      h('div', { class: 'seg' }, [['all', 'Todo'], ['patch', 'Parches'], ['news', 'Anuncios']].map(([k, t]) => h('button', { class: filter === k ? 'on' : '', text: t, onclick: () => { state.newsFilter = k; renderNews(); } })))
    ),
    items.length
      ? [feature, h('div', { class: 'nw-grid' }, rest.map(card))]
      : h('p', { class: 'hint', text: state.newsLoading ? 'Cargando…' : 'No hay anuncios recientes de tus juegos instalados, favoritos y pendientes.' })
  );
}

// Noticias de Nintendo: Nintenderos (español) y Nintendo Life (inglés)
const ninState = { source: 'all' };
function renderNintendo(items) {
  const sources = [...new Set(items.map((i) => i.source))];
  const shown = items.filter((i) => ninState.source === 'all' || i.source === ninState.source).slice(0, 18);
  const seg = h(
    'div',
    { class: 'seg' },
    ['all', ...sources].map((s) =>
      h('button', {
        class: ninState.source === s ? 'on' : '',
        text: s === 'all' ? 'Todas' : s,
        onclick: () => {
          ninState.source = s;
          renderNews();
        },
      })
    )
  );
  return h(
    'section',
    { class: 'nin' },
    h('div', { class: 'nin-head' }, h('div', {}, h('h2', { class: 'section-h', text: 'Noticias de Nintendo' }), h('p', { class: 'hint', text: 'De Nintenderos (en español) y Nintendo Life (en inglés). Se abren en el navegador.' })), sources.length > 1 ? seg : null),
    shown.length
      ? h(
          'div',
          { class: 'nin-grid' },
          shown.map((it) =>
            h(
              'button',
              { class: 'nin-card', onclick: () => window.api.open(it.url), title: `Abrir en ${it.source}` },
              h('div', { class: 'nin-art', 'data-source': it.source }, h('span', { class: 'nin-ph', text: it.source }), it.image ? h('img', { src: it.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null),
              h(
                'div',
                { class: 'nin-body' },
                h('div', { class: 'news-meta' }, h('span', { class: 'kind', text: it.source }), it.lang === 'en' && h('span', { class: 'lang', text: 'EN' }), h('span', { text: relTime(it.date) })),
                h('h3', { text: it.title }),
                it.text && h('p', { class: 'hint', text: it.text })
              )
            )
          )
        )
      : h('p', { class: 'hint', text: state.newsLoading ? 'Cargando…' : 'No se pudieron leer las noticias de Nintendo. Prueba a recargar.' })
  );
}

// Tarjetas vacías con la forma de lo que va a llegar (mejor que un texto de "cargando")
function skeletonDeals(n) {
  return h('div', { class: 'deals skel-list', 'aria-busy': 'true', 'aria-label': 'Cargando' }, Array.from({ length: n }, () => h('div', { class: 'deal skel' }, h('i', { class: 'skel-img' }), h('div', {}, h('i', { class: 'skel-line w70' }), h('i', { class: 'skel-line w40' }), h('i', { class: 'skel-line w55' })))));
}

// ---------- Genshin Impact (Enka.Network) ----------
const gi = { data: null, loading: false, error: null, pick: 0, preview: null, tab: 'perfil', wish: null, wishBusy: null, hoyo: null, hoyoBusy: false, hoyoError: null, tasks: null, found: null, foundBusy: null, showDone: false };

async function loadGenshin(force, previewUid) {
  if (previewUid) gi.preview = previewUid;
  const uid = gi.preview || state.settings?.genshinUid;
  if (!uid) return renderGenshin();
  if (gi.loading || (gi.data && !force && gi.data.uid === uid)) return renderGenshin();
  gi.loading = true;
  renderGenshin();
  try {
    gi.data = await window.api.genshin(force, gi.preview || undefined);
    gi.error = null;
  } catch (e) {
    gi.error = errMsg(e);
  }
  gi.loading = false;
  renderGenshin();
}

async function saveGenshinUid(uid) {
  try {
    state.settings = await window.api.saveSettings({ genshinUid: uid });
    gi.data = null;
    gi.error = null;
    gi.pick = 0;
    $('#genshinTab').hidden = false;
    loadGenshin(true);
  } catch (e) {
    toast(errMsg(e), true);
  }
}

function genshinForm(current) {
  const input = h('input', { type: 'text', inputMode: 'numeric', maxLength: 10, placeholder: 'Por ejemplo 812345678', value: current || '', 'aria-label': 'Tu UID de Genshin Impact', class: 'gi-uid' });
  const go = () => saveGenshinUid(input.value.trim());
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  return h(
    'div',
    { class: 'gi-setup' },
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', text: 'Ver mi perfil', onclick: go })),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, h('b', { text: 'Copia tu UID.' }), ' Son 9 o 10 cifras; salen abajo a la derecha mientras juegas y en el menú de Paimon. No es una contraseña: es tu número público de jugador.'),
      h('li', {}, h('b', { text: 'Enseña los detalles en el juego.' }), ' Menú de Paimon → tu perfil → Editar la vitrina de personajes, y activa «Mostrar detalles de personajes». Si no, solo se ve el nivel.'),
      h('li', {}, h('b', { text: 'Pon en la vitrina a quien quieras ver aquí.' }), ' La app ve los personajes de tu vitrina (como Enka.Network); el inventario y el resto de personajes no son públicos.')
    )
  );
}

function renderGenshin() {
  const box = $('#genshinBody');
  if (!box || $('#genshinView').hidden) return;
  const uid = gi.preview || state.settings?.genshinUid;
  if (!uid)
    return fill(
      box,
      h('div', { class: 'view-head' }, h('h1', { text: 'Tu perfil de Genshin' }), h('p', { class: 'sub', text: 'Tu rango de aventura, logros, Abismo y los personajes de tu vitrina con su arma, artefactos y estadísticas, leídos de Enka.Network con tu UID.' })),
      genshinForm('')
    );
  if (gi.error && !gi.data)
    return fill(box, h('div', { class: 'view-head' }, h('h1', { text: 'Tu perfil de Genshin' })), h('p', { class: 'hint bad', text: gi.error }), genshinForm(uid));
  if (!gi.data) return fill(box, h('div', { class: 'view-head' }, h('h1', { text: 'Tu perfil de Genshin' }), h('p', { class: 'sub', text: `Leyendo el perfil ${uid} de Enka.Network…` })), skeletonDeals(4));
  const d = gi.data;
  const p = d.player;
  const facts = [
    ['Rango de aventura', p.level],
    p.worldLevel != null && ['Nivel de mundo', p.worldLevel],
    ['Logros', p.achievements.toLocaleString('es')],
    p.abyss && ['Abismo de Espiral', `Piso ${p.abyss}${p.abyssStars != null ? ` (${p.abyssStars} ★)` : ''}`],
    p.theater && ['Teatro Imaginario', `Acto ${p.theater.act}${p.theater.stars != null ? ` (${p.theater.stars} ★)` : ''}`],
    p.maxFriendship != null && ['Personajes con amistad 10', p.maxFriendship],
  ].filter(Boolean);
  const chars = d.characters;
  const c = chars[Math.min(gi.pick, chars.length - 1)];
  fill(
    box,
    h(
      'header',
      { class: 'gi-head' },
      p.namecard && h('img', { class: 'gi-card-art', src: p.namecard, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }),
      h(
        'div',
        { class: 'gi-head-in' },
        h('div', { class: 'gi-avatar' }, p.avatar && h('img', { src: p.avatar, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
        h(
          'div',
          { class: 'gi-who' },
          h('p', { class: 'hero-kicker', text: `Genshin Impact, UID ${d.uid}` }),
          h('h1', { text: p.nickname }),
          p.signature && h('p', { class: 'gi-sign', text: p.signature })
        ),
        h(
          'div',
          { class: 'gi-actions' },
          h('button', { class: 'btn ghost small', text: gi.loading ? 'Actualizando…' : 'Actualizar', disabled: gi.loading, onclick: () => loadGenshin(true) }),
          h('button', { class: 'btn ghost small', text: 'Ver en Enka.Network', onclick: () => window.api.open(`https://enka.network/u/${d.uid}/`) }),
          !gi.preview && h('button', { class: 'btn ghost small subtle', text: 'Cambiar UID', onclick: () => saveGenshinUid('') })
        )
      )
    ),
    genshinTabs(),
    gi.tab !== 'perfil' ? genshinOtherTab() : [
    h('dl', { class: 'stat-strip gi-strip' }, facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: String(v) })))),
    d.stale && h('p', { class: 'hint bad', text: `Se muestran los datos guardados: ${d.stale}` }),
    d.detailsHidden &&
      h('div', { class: 'notice' }, h('span', { text: 'Tus personajes están ocultos. En el juego: menú de Paimon → tu perfil → Editar la vitrina, y activa «Mostrar detalles de personajes». Luego pulsa Actualizar (Enka tarda un par de minutos en verlo).' })),
    chars.length
      ? [
          h('h2', { class: 'section-h', text: `Tu vitrina (${chars.length})` }),
          h(
            'div',
            { class: 'gi-roster', role: 'tablist', 'aria-label': 'Personajes' },
            chars.map((ch, i) =>
              h(
                'button',
                { class: `gi-chip${ch === c ? ' on' : ''}`, role: 'tab', 'aria-selected': String(ch === c), style: { '--el': ch.color }, onclick: () => { gi.pick = i; renderGenshin(); } },
                h('span', { class: `gi-face r${ch.rarity}` }, ch.icon && h('img', { src: ch.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })),
                h('span', { class: 'gi-chip-txt' }, h('b', { text: ch.name }), h('span', { text: `Nv. ${ch.level}, C${ch.constellation}` }))
              )
            )
          ),
          c && genshinCharacter(c),
        ]
      : (d.showcase || []).length
        ? [
            h('h2', { class: 'section-h', text: `Tu vitrina (${d.showcase.length})` }),
            h(
              'div',
              { class: 'gi-roster' },
              d.showcase.map((ch) =>
                h(
                  'div',
                  { class: 'gi-chip static', style: { '--el': ch.color } },
                  h('span', { class: `gi-face r${ch.rarity}` }, ch.icon && h('img', { src: ch.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })),
                  h('span', { class: 'gi-chip-txt' }, h('b', { text: ch.name }), h('span', { text: `Nv. ${ch.level}, ${ch.element}` }))
                )
              )
            ),
          ]
        : h('p', { class: 'hint', text: 'Tu vitrina está vacía. Añade personajes en el juego (menú de Paimon → tu perfil) para verlos aquí.' }),
    h('p', { class: 'hint gi-src', text: `Datos de Enka.Network, leídos ${relTime(d.fetchedAt / 1000)}. El inventario y los personajes fuera de la vitrina no son públicos, así que no se pueden ver.` }),
    ]
  );
}

// ---- pestañas de Genshin ----
const GI_TABS = [
  ['perfil', 'Perfil'],
  ['noticias', 'Noticias y eventos'],
  ['prioridades', 'Prioridades'],
  ['notas', 'Notas de HoYoLAB'],
  ['deseos', 'Deseos'],
  ['farmeo', 'Farmeo'],
  ['codigos', 'Códigos'],
];
function genshinTabs() {
  return h(
    'div',
    { class: 'seg gi-tabs', role: 'tablist', 'aria-label': 'Secciones de Genshin' },
    GI_TABS.map(([k, t]) => h('button', { class: gi.tab === k ? 'on' : '', role: 'tab', 'aria-selected': String(gi.tab === k), text: t, onclick: () => setGenshinTab(k) }))
  );
}
function setGenshinTab(k) {
  gi.tab = k;
  if (k === 'noticias' && !gi.news && !gi.newsBusy) loadGnews(false);
  if (k === 'deseos' && !gi.wish) window.api.gwish().then((w) => { gi.wish = w; renderGenshin(); });
  if ((k === 'notas' || k === 'prioridades' || k === 'farmeo') && !gi.hoyo && !gi.hoyoBusy) loadHoyo(false);
  if (k === 'prioridades' && !gi.tasks) {
    window.api.gtasks().then((t) => { gi.tasks = t; renderGenshin(); });
    window.api.gquestsPending().then((p) => { if (p?.quests?.length) { gi.found = p; renderGenshin(); } });
  }
  renderGenshin();
}
function genshinOtherTab() {
  if (gi.tab === 'deseos') return renderWishes();
  if (gi.tab === 'noticias') return renderGnews();
  if (gi.tab === 'notas') return renderHoyo();
  if (gi.tab === 'farmeo') return window.gplusUI?.renderFarm();
  if (gi.tab === 'codigos') return window.gplusUI?.renderCodes();
  return renderPriorities();
}

// ---- noticias y eventos ----
async function loadGnews(force) {
  gi.newsBusy = true;
  renderGenshin();
  try {
    gi.news = await window.api.gnews(force);
    gi.newsError = null;
  } catch (e) {
    gi.newsError = errMsg(e);
  }
  gi.newsBusy = false;
  renderGenshin();
}
const dayFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
function daysLeft(ms) {
  const d = Math.ceil((ms - Date.now()) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`;
}
function renderGnews() {
  const n = gi.news;
  if (!n) return gi.newsError ? h('p', { class: 'hint bad', text: gi.newsError }) : skeletonDeals(4);
  const days = n.next?.at ? Math.max(0, Math.ceil((n.next.at - Date.now()) / 86400000)) : null;
  const span = n.version?.start && n.version?.end ? n.version.end - n.version.start : null;
  const done = span ? Math.min(100, Math.max(0, ((Date.now() - n.version.start) / span) * 100)) : 0;
  const banners = n.events.filter((e) => e.kind === 'Gachapón');
  const events = n.events.filter((e) => e.kind !== 'Gachapón');
  return [
    h(
      'section',
      { class: 'gn-hero' },
      h(
        'div',
        { class: 'gn-count' },
        h('p', { class: 'gn-k', text: n.version ? `Versión ${n.version.number}: «${n.version.name}»` : 'Versión actual' }),
        days != null ? h('p', { class: 'gn-big' }, h('b', { text: String(days) }), h('span', { text: days === 1 ? 'día para la versión ' + n.next.number : 'días para la versión ' + n.next.number })) : null,
        n.next?.at && h('p', { class: 'hint', text: `Sale el ${dayFmt.format(n.next.at)} (la actualización empieza a las ${clock(n.next.at)}).` }),
        span && h('div', { class: 'bar wide' }, h('i', { style: { width: `${done.toFixed(1)}%` } }))
      ),
      h(
        'div',
        { class: 'gn-side' },
        h(
          'div',
          { class: 'gn-card' },
          h('p', { class: 'gn-k', text: `Directo de la versión ${n.next?.number || ''}` }),
          n.livestream?.confirmed
            ? [h('b', { text: 'Anunciado' }), h('button', { class: 'link-btn', text: n.livestream.title, onclick: () => window.api.open(n.livestream.url) })]
            : n.livestream?.at
              ? [h('b', { text: `Hacia el ${dayFmt.format(n.livestream.at)}` }), h('span', { class: 'hint', text: `Estimado (${daysLeft(n.livestream.at)}). Suele ser unos 12 días antes de cada versión; se confirmará aquí cuando HoYoverse lo anuncie.` })]
              : h('span', { class: 'hint', text: 'Sin fecha todavía.' })
        ),
        h(
          'div',
          { class: 'gn-card' },
          h('p', { class: 'gn-k', text: `Personajes de la versión ${n.next?.number || ''}` }),
          n.reveals.length
            ? h('ul', {}, n.reveals.map((r) => h('li', {}, h('button', { class: 'link-btn', text: r.title, onclick: () => window.api.open(r.url) }))))
            : h('span', { class: 'hint', text: 'Aún no se han presentado. HoYoverse suele enseñarlos en las semanas previas al directo; aparecerán aquí en cuanto se publiquen.' })
        )
      )
    ),
    banners.length > 0 && [
      h('h2', { class: 'section-h', text: 'Gachapones ahora' }),
      h('div', { class: 'gn-banners' }, banners.map((b) => h('div', { class: 'gn-banner' }, b.image && h('img', { src: b.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }), h('div', {}, h('b', { text: b.title }), h('span', { class: 'hint', text: `Termina ${daysLeft(b.end)}, el ${dateTimeFmt.format(b.end)}` }))))),
    ],
    h('h2', { class: 'section-h', text: `Eventos en curso (${events.length})` }),
    h(
      'ul',
      { class: 'gn-events' },
      events.map((e) => {
        const total = e.end - (e.start || e.end);
        const left = Math.max(0, e.end - Date.now());
        const soon = left < 3 * 86400000;
        return h(
          'li',
          { class: soon ? 'soon' : '' },
          h('span', { class: 'gi-kind', text: e.kind }),
          h('span', { class: 'gn-ev-t', text: e.short }),
          h('span', { class: 'gn-ev-bar' }, h('i', { style: { width: `${total > 0 ? Math.min(100, (left / total) * 100) : 0}%` } })),
          h('span', { class: 'gn-ev-d', text: `Termina ${daysLeft(e.end)}` })
        );
      })
    ),
    h('div', { class: 'row gi-wish-head' }, h('h2', { class: 'section-h', text: 'Noticias oficiales' }), h('button', { class: 'btn ghost small', disabled: gi.newsBusy, text: gi.newsBusy ? 'Actualizando…' : 'Actualizar', onclick: () => loadGnews(true) })),
    h('div', { class: 'nin-grid' }, n.news.map((x) => h('button', { class: 'nin-card', onclick: () => window.api.open(x.url), title: 'Abrir en HoYoLAB' }, h('div', { class: 'nin-art' }, h('span', { class: 'nin-ph', text: 'HoYoLAB' }), x.image && h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })), h('div', { class: 'nin-body' }, h('div', { class: 'news-meta' }, h('span', { class: 'kind', text: x.type }), h('span', { text: relTime(x.date / 1000) })), h('h3', { text: x.title }))))),
    h('p', { class: 'hint gi-src', text: 'Datos de los anuncios del juego y de las noticias oficiales de HoYoLAB.' }),
  ];
}

// ---- deseos ----
async function importWishes() {
  gi.wishBusy = 'Buscando el enlace del historial…';
  renderGenshin();
  try {
    const r = await window.api.gwishImport();
    gi.wish = r;
    toast(r.added ? `Importadas ${plural(r.added, 'tirada nueva', 'tiradas nuevas')}.` : 'No había tiradas nuevas.');
  } catch (e) {
    toast(errMsg(e), true);
  }
  gi.wishBusy = null;
  renderGenshin();
}
function renderWishes() {
  const w = gi.wish;
  const how = h(
    'ol',
    { class: 'steps' },
    h('li', {}, h('b', { text: 'Abre el historial en el juego.' }), ' En Genshin: Deseos → Historial. Así el juego guarda un enlace con tu historial (vale 24 horas).'),
    h('li', {}, h('b', { text: 'Pulsa «Importar historial».' }), ' La app lee ese enlace de tu PC, descarga tus tiradas y las guarda. Las anteriores se conservan aunque el juego solo enseñe 6 meses.')
  );
  const btn = h('button', { class: 'btn primary', disabled: !!gi.wishBusy, text: gi.wishBusy || (w?.total ? 'Actualizar historial' : 'Importar historial'), onclick: importWishes });
  if (!w) return h('p', { class: 'hint', text: 'Cargando…' });
  if (!w.total) return h('div', { class: 'gi-setup' }, how, h('div', { class: 'row' }, btn));
  const pityCls = (n, hard) => (n >= hard * 0.83 ? 'hot' : n >= hard * 0.66 ? 'warm' : '');
  return [
    h('div', { class: 'row gi-wish-head' }, h('p', { class: 'hint', text: `${w.total.toLocaleString('es')} tiradas guardadas${w.importedAt ? `, la última importación ${relTime(w.importedAt / 1000)}` : ''}.` }), btn),
    h(
      'div',
      { class: 'gi-pools' },
      w.pools.map((p) =>
        h(
          'section',
          { class: 'gi-pool' },
          h('h3', { text: p.name }),
          h('div', { class: 'gi-pity' }, h('b', { class: pityCls(p.pity5, p.hardPity), text: String(p.pity5) }), h('span', { text: `de ${p.hardPity} para el próximo 5★` })),
          h('div', { class: 'bar wide' }, h('i', { style: { width: `${Math.min(100, (p.pity5 / p.hardPity) * 100)}%` } })),
          h('p', { class: 'gi-pool-meta' }, h('span', { text: `4★: ${p.pity4} de 10` }), p.key === 'character' && h('span', { class: p.guaranteed ? 'ok' : '', text: p.guaranteed ? 'Próximo 5★ garantizado' : 'Próximo 5★: 50/50' }), h('span', { text: `${p.total} tiradas` }), p.avg5 && h('span', { text: `media ${p.avg5} por 5★` })),
          p.fives.length
            ? h('ul', { class: 'gi-fives' }, p.fives.slice(0, 12).map((f) => h('li', {}, h('span', { text: f.name }), f.lost === true && h('em', { text: 'perdió el 50/50' }), h('b', { class: pityCls(f.pity, p.hardPity), text: String(f.pity) }))))
            : h('p', { class: 'hint', text: 'Aún sin 5★ en este banner.' })
        )
      )
    ),
  ];
}

// ---- notas de HoYoLAB ----
async function loadHoyo(force) {
  gi.hoyoBusy = true;
  renderGenshin();
  try {
    gi.hoyo = await window.api.hoyo(force);
    gi.hoyoError = null;
  } catch (e) {
    gi.hoyoError = errMsg(e);
    const st = await window.api.hoyoStatus().catch(() => ({ linked: false }));
    if (!st.linked) gi.hoyo = { linked: false };
  }
  gi.hoyoBusy = false;
  renderGenshin();
}
async function hoyoLogin() {
  gi.hoyoBusy = true;
  renderGenshin();
  try {
    const r = await window.api.hoyoLogin();
    if (!r.linked) toast('No se completó el inicio de sesión.', true);
  } catch (e) {
    toast(errMsg(e), true);
  }
  gi.hoyoBusy = false;
  loadHoyo(true);
}
const clock = (ms) => new Date(ms).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const untilTxt = (ms) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
function renderHoyo() {
  const o = gi.hoyo;
  if (gi.hoyoBusy && !o) return h('p', { class: 'hint', text: 'Leyendo HoYoLAB…' });
  if (!o?.linked)
    return h(
      'div',
      { class: 'gi-setup' },
      gi.hoyoError && h('p', { class: 'hint bad', text: gi.hoyoError }),
      h('p', { text: 'Con tu cuenta de HoYoLAB la app ve tu resina, los encargos diarios, los jefes semanales, las expediciones, la exploración de cada región y todos tus personajes (no solo la vitrina).' }),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, h('b', { text: 'Inicias sesión tú en la web de HoYoLAB.' }), ' Se abre en una ventana de la app; la app nunca ve tu contraseña.'),
        h('li', {}, h('b', { text: 'La app guarda solo la sesión de lectura,' }), ' cifrada con tu usuario de Windows. La ventana se borra al cerrarla. Puedes cerrar la sesión cuando quieras.'),
        h('li', {}, h('b', { text: 'Activa tus notas en HoYoLAB.' }), ' Battle Chronicle → ajustes: «Notas en tiempo real» y que tu Battle Chronicle sea visible.')
      ),
      h('p', { class: 'hint', text: 'Ten en cuenta que esa sesión da acceso a tu cuenta de HoYoLAB (no a tu contraseña) y que la API no es oficial: HoYoverse puede cambiarla.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: gi.hoyoBusy, text: gi.hoyoBusy ? 'Esperando el inicio de sesión…' : 'Iniciar sesión en HoYoLAB', onclick: hoyoLogin }))
    );
  const n = o.notes;
  const resinFull = n.resin >= n.maxResin;
  const cards = [
    ['Resina', `${n.resin}/${n.maxResin}`, resinFull ? 'Llena: estás perdiendo resina' : n.resinFullAt ? `Llena a las ${clock(n.resinFullAt)} (en ${untilTxt(n.resinFullAt)})` : '', resinFull || n.resin >= n.maxResin - 20 ? 'hot' : ''],
    ['Encargos diarios', `${n.commissionsDone}/${n.commissionsTotal}`, n.commissionsDone >= n.commissionsTotal ? (n.commissionReward ? 'Recompensa cobrada' : 'Falta cobrar la recompensa con Catherine') : 'Pendientes hoy', n.commissionsDone < n.commissionsTotal || !n.commissionReward ? 'warm' : 'ok'],
    ['Jefes semanales', `${n.weeklyLeft}/${n.weeklyTotal}`, n.weeklyLeft ? 'Descuentos de resina que te quedan esta semana' : 'Hechos esta semana', n.weeklyLeft ? 'warm' : 'ok'],
    ['Moneda del reino', `${n.realmCoins}/${n.realmMax}`, n.realmFullAt ? `Llena en ${untilTxt(n.realmFullAt)}` : n.realmCoins >= n.realmMax ? 'Llena' : '', n.realmCoins >= n.realmMax * 0.9 ? 'hot' : ''],
    ['Expediciones', `${n.expeditions.filter((x) => x.done).length}/${n.expeditions.length}`, n.expeditions.length < n.maxExpeditions ? `Puedes enviar ${n.maxExpeditions - n.expeditions.length} más` : 'Terminadas / enviadas', n.expeditions.some((x) => x.done) ? 'warm' : ''],
    n.transformerReady != null && ['Transformador paramétrico', n.transformerReady ? 'Listo' : 'Recargando', n.transformerReady ? 'Úsalo para conseguir materiales' : '', n.transformerReady ? 'warm' : ''],
  ].filter(Boolean);
  const s = o.stats;
  return [
    gi.hoyoError && h('p', { class: 'hint bad', text: gi.hoyoError }),
    (o.warnings || []).map((w) => h('p', { class: 'hint', text: w })),
    h('div', { class: 'row gi-wish-head' }, h('p', { class: 'hint', text: `Leído de HoYoLAB ${relTime(o.fetchedAt / 1000)}.` }), h('button', { class: 'btn ghost small', disabled: gi.hoyoBusy, text: gi.hoyoBusy ? 'Actualizando…' : 'Actualizar', onclick: () => loadHoyo(true) }), h('button', { class: 'btn ghost small subtle', text: 'Cerrar sesión de HoYoLAB', onclick: async () => { gi.hoyo = await window.api.hoyoLogout(); renderGenshin(); } })),
    h('div', { class: 'gi-notes' }, cards.map(([t, v, sub, cls]) => h('div', { class: `gi-note ${cls}` }, h('span', { class: 'gi-note-t', text: t }), h('b', { text: v }), sub && h('span', { class: 'hint', text: sub })))),
    s && [
      h('h2', { class: 'section-h', text: 'Resumen de la partida' }),
      h('dl', { class: 'gi-summary' }, (s.summary || []).map(([k, v]) => h('div', {}, h('dd', { text: v }), h('dt', { text: k })))),
      s.regions?.length > 0 && [
        h('h2', { class: 'section-h', text: 'Exploración por región' }),
        h('div', { class: 'gi-regions' }, s.regions.map((r) => h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: r.name }), h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${r.pct}%` } }), h('span', { class: 'bar-value', text: `${r.pct}%` }))))),
      ],
    ],
    (o.characters || []).length > 0 && hoyoCharacters(o.characters),
  ];
}

// ---- "Mis personajes" de HoYoLAB: lista y ficha completa ----
function hoyoCharacters(list) {
  const chars = [...list].sort((a, b) => b.level - a.level || b.rarity - a.rarity || b.constellation - a.constellation);
  if (!gi.hoyoPick || !chars.some((c) => c.id === gi.hoyoPick)) gi.hoyoPick = chars[0]?.id;
  const pick = (id) => {
    gi.hoyoPick = id;
    renderGenshin();
    loadHoyoDetail(id);
  };
  if (gi.hoyoPick && !gi.hoyoDetail?.[gi.hoyoPick] && !gi.hoyoDetailBusy) loadHoyoDetail(gi.hoyoPick);
  const d = gi.hoyoDetail?.[gi.hoyoPick];
  return [
    h('h2', { class: 'section-h', text: `Mis personajes (${chars.length})` }),
    h(
      'div',
      { class: 'gi-faces', role: 'tablist', 'aria-label': 'Personajes' },
      chars.map((c) =>
        h(
          'button',
          { class: `gi-face-btn r${c.rarity}${c.id === gi.hoyoPick ? ' on' : ''}`, role: 'tab', 'aria-selected': String(c.id === gi.hoyoPick), title: `${c.name}, Nv. ${c.level}, C${c.constellation}`, onclick: () => pick(c.id) },
          c.icon && h('img', { src: c.icon, alt: c.name, loading: 'lazy', referrerPolicy: 'no-referrer' })
        )
      )
    ),
    d ? hoyoCharacterCard(d) : h('p', { class: 'hint', text: gi.hoyoDetailError || 'Cargando la ficha…' }),
  ];
}

async function loadHoyoDetail(id) {
  if (gi.hoyoDetailBusy) return;
  gi.hoyoDetailBusy = true;
  try {
    const [d] = await window.api.hoyoDetails([id]);
    gi.hoyoDetail = { ...(gi.hoyoDetail || {}), [id]: d };
    gi.hoyoDetailError = null;
  } catch (e) {
    gi.hoyoDetailError = errMsg(e);
  }
  gi.hoyoDetailBusy = false;
  renderGenshin();
}

const ELEMENT_ES = { Anemo: 'Anemo', Geo: 'Geo', Electro: 'Electro', Dendro: 'Dendro', Hydro: 'Hydro', Pyro: 'Pyro', Cryo: 'Cryo' };
const ELEMENT_COLOR = { Anemo: '#5fd1ac', Geo: '#f2b331', Electro: '#b07ce8', Dendro: '#9ccc32', Hydro: '#3fb6ef', Pyro: '#ef7a35', Cryo: '#8fd6ea' };
function hoyoCharacterCard(c) {
  const color = ELEMENT_COLOR[c.element] || 'var(--amber)';
  const isCrit = (n) => /CRIT/i.test(n || '');
  const props = (c.properties || []).filter((p) => p && p.final != null);
  return h(
    'section',
    { class: 'hc', style: { '--el': color } },
    h(
      'div',
      { class: 'hc-left' },
      h('div', { class: 'hc-art' }, c.image && h('img', { src: c.image, alt: '', referrerPolicy: 'no-referrer' })),
      h(
        'ol',
        { class: 'hc-cons', 'aria-label': `Constelación ${c.constellation}` },
        c.constellations.map((k) => h('li', { class: k.active ? 'on' : '', title: `${k.name}${k.active ? '' : ' (bloqueada)'}\n${(k.effect || '').replace(/<[^>]+>/g, '')}` }, k.icon && h('img', { src: k.icon, alt: '', referrerPolicy: 'no-referrer' })))
      ),
      h('p', { class: 'hc-friend', text: `Amistad: ${c.friendship}` }),
      h(
        'div',
        { class: 'hc-skills' },
        c.skills.map((s) => h('span', { class: 'hc-skill', title: s.name }, s.icon && h('img', { src: s.icon, alt: '', referrerPolicy: 'no-referrer' }), h('b', { text: String(s.level) }))),
        c.passives.map((s) => h('span', { class: 'hc-skill passive', title: s.name }, s.icon && h('img', { src: s.icon, alt: '', referrerPolicy: 'no-referrer' })))
      )
    ),
    h(
      'div',
      { class: 'hc-right' },
      h('div', { class: 'hc-title' }, h('h2', { text: c.name }), h('span', { class: 'hc-lv', text: `Nv. ${c.level}` }), h('span', { class: 'hc-stars', text: '★'.repeat(c.rarity || 4) }), h('span', { class: 'hc-el', text: ELEMENT_ES[c.element] || c.element || '' })),
      h('h3', { class: 'hc-h', text: 'Atributos del personaje' }),
      h(
        'dl',
        { class: 'hc-props' },
        props.map((p) => h('div', {}, h('dt', {}, p.icon && h('img', { src: p.icon, alt: '', referrerPolicy: 'no-referrer' }), p.name), h('dd', {}, p.add && p.add !== '0' && p.base ? h('small', {}, p.base, h('i', { text: `+${p.add}` })) : null, h('b', { text: String(p.final) }))))
      ),
      c.weapon &&
        h(
          'div',
          { class: 'hc-weapon' },
          h('h3', { class: 'hc-h', text: 'Arma' }),
          h(
            'div',
            { class: 'hc-weapon-row' },
            h('div', { class: `gi-item r${c.weapon.rarity}` }, c.weapon.icon && h('img', { src: c.weapon.icon, alt: '', referrerPolicy: 'no-referrer' }), h('span', { class: 'gi-lv', text: `R${c.weapon.refinement}` })),
            h('div', {}, h('b', { text: c.weapon.name }), h('span', { class: 'hc-lv', text: `Nv. ${c.weapon.level}` }), h('p', { class: 'hint', text: [c.weapon.main && `${c.weapon.main.name}: ${c.weapon.main.final}`, c.weapon.sub && `${c.weapon.sub.name}: ${c.weapon.sub.final}`].filter(Boolean).join(', ') }))
          )
        )
    ),
    c.artifacts.length > 0 &&
      h(
        'div',
        { class: 'hc-arts' },
        h('h3', { class: 'hc-h', text: 'Artefactos' }),
        h(
          'div',
          { class: 'hc-art-row' },
          c.artifacts.map((a) =>
            h(
              'div',
              { class: 'hc-relic' },
              h('div', { class: 'hc-relic-head' }, h('div', {}, h('b', { text: a.name }), h('span', { class: 'hc-lv', text: `Nv. ${a.level}` }), h('span', { class: 'hc-stars', text: '★'.repeat(a.rarity || 5) })), a.icon && h('img', { src: a.icon, alt: '', referrerPolicy: 'no-referrer' })),
              a.main && h('div', { class: `hc-main${isCrit(a.main.name) ? ' crit' : ''}` }, h('span', { text: a.main.name }), h('b', { text: a.main.final })),
              h(
                'ul',
                {},
                a.subs.map((s) => h('li', { class: isCrit(s.name) ? 'crit' : '' }, h('span', {}, s.name, s.times > 0 && h('em', { title: `Mejorado ${s.times} ${s.times === 1 ? 'vez' : 'veces'}`, text: String(s.times) })), h('b', { text: `+${s.final}` })))
              )
            )
          )
        ),
        h('p', { class: 'hint', text: [...new Set(c.artifacts.map((a) => a.set).filter(Boolean))].join(', ') })
      )
  );
}

// ---- prioridades ----
const TASK_KINDS = ['Arconte', 'Leyenda', 'Mundo', 'Evento', 'Personaje', 'Farmeo', 'Exploración', 'Otra'];
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
async function saveTasks(list) {
  gi.tasks = await window.api.gtasksSave(list);
  renderGenshin();
}
async function readQuests(how) {
  gi.foundBusy = how === 'capture' ? 'Cambia al juego con el diario de misiones abierto (J): capturo en 5 segundos…' : 'Leyendo la imagen…';
  renderGenshin();
  try {
    const r = how === 'capture' ? await window.api.gquestsCapture(5) : await window.api.gquestsImage();
    if (r) {
      gi.found = r;
      if (!r.quests.length) toast('No encontré misiones en esa imagen. Usa una captura del diario de misiones (tecla J).', true);
    }
  } catch (e) {
    toast(errMsg(e), true);
  }
  gi.foundBusy = null;
  renderGenshin();
}
function autoPriorities() {
  const n = gi.hoyo?.linked && gi.hoyo.notes;
  if (!n) return [];
  const out = [];
  if (n.resin >= n.maxResin) out.push(['hot', 'Gasta resina: está llena y no se acumula más.']);
  else if (n.resin >= n.maxResin - 40) out.push(['warm', `Resina ${n.resin}/${n.maxResin}: se llena${n.resinFullAt ? ` a las ${clock(n.resinFullAt)}` : ' pronto'}.`]);
  if (n.commissionsDone < n.commissionsTotal) out.push(['warm', `Haz los encargos diarios (${n.commissionsDone}/${n.commissionsTotal}).`]);
  else if (!n.commissionReward) out.push(['warm', 'Cobra la recompensa de los encargos con Catherine.']);
  if (n.weeklyLeft > 0) out.push(['', `Te quedan ${n.weeklyLeft} jefes semanales con descuento esta semana.`]);
  const done = n.expeditions.filter((x) => x.done).length;
  if (done) out.push(['warm', `Recoge ${plural(done, 'expedición terminada', 'expediciones terminadas')}.`]);
  if (n.realmCoins >= n.realmMax * 0.9) out.push(['warm', 'Recoge la moneda del reino en la Tetera.']);
  if (n.transformerReady) out.push(['', 'El transformador paramétrico está listo.']);
  const low = (gi.hoyo.stats?.regions || []).filter((r) => r.pct < 100).slice(0, 2);
  for (const r of low) out.push(['', `Explorar ${r.name} (${r.pct}%).`]);
  return out;
}
function renderPriorities() {
  const tasks = gi.tasks || [];
  const pending = tasks.filter((t) => !t.done);
  const doneList = tasks.filter((t) => t.done);
  const auto = autoPriorities();
  const text = h('input', { type: 'text', class: 'gi-task-input', placeholder: 'Añade una prioridad: una misión, subir a un personaje, farmear algo…', maxLength: 160, 'aria-label': 'Nueva prioridad' });
  const kind = h('select', { 'aria-label': 'Tipo' }, TASK_KINDS.map((k) => h('option', { value: k, text: k })));
  const add = () => {
    const v = text.value.trim();
    if (v) saveTasks([...tasks, { id: newId(), text: v, kind: kind.value, done: false, at: Date.now() }]);
  };
  text.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const move = (t, step) => {
    const list = [...tasks];
    const i = list.indexOf(t);
    const j = i + step;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveTasks(list);
  };
  const row = (t) =>
    h(
      'li',
      { class: `gi-task${t.done ? ' done' : ''}` },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.done, onchange: (e) => saveTasks(tasks.map((x) => (x === t ? { ...x, done: e.target.checked } : x))) }), h('span', { text: t.text })),
      h('span', { class: 'gi-kind', text: t.kind }),
      !t.done && h('button', { class: 'icon-btn', title: 'Subir', 'aria-label': `Subir ${t.text}`, text: '↑', onclick: () => move(t, -1) }),
      !t.done && h('button', { class: 'icon-btn', title: 'Bajar', 'aria-label': `Bajar ${t.text}`, text: '↓', onclick: () => move(t, 1) }),
      h('button', { class: 'icon-btn', title: 'Quitar', 'aria-label': `Quitar ${t.text}`, text: '×', onclick: () => saveTasks(tasks.filter((x) => x !== t)) })
    );
  const found = gi.found;
  const picks = new Set((found?.quests || []).map((q) => q.text));
  return [
    auto.length > 0 && h('section', { class: 'gi-auto' }, h('h3', { class: 'sheet-h', text: 'Ahora mismo' }), h('ul', {}, auto.map(([cls, t]) => h('li', { class: cls, text: t })))),
    !gi.hoyo?.linked && h('p', { class: 'hint', text: 'Si inicias sesión en HoYoLAB (pestaña Notas), aquí salen solas la resina, los encargos, los jefes semanales y las expediciones pendientes.' }),
    h('h3', { class: 'sheet-h', text: 'Tus prioridades' }),
    h('div', { class: 'row gi-add' }, text, kind, h('button', { class: 'btn primary', text: 'Añadir', onclick: add })),
    pending.length ? h('ol', { class: 'gi-tasks' }, pending.map(row)) : h('p', { class: 'hint', text: 'Sin prioridades pendientes. Añade alguna o léelas de tu diario de misiones.' }),
    doneList.length > 0 && h('button', { class: 'link-btn', text: gi.showDone ? 'Ocultar completadas' : `Ver completadas (${doneList.length})`, onclick: () => { gi.showDone = !gi.showDone; renderGenshin(); } }),
    gi.showDone && h('ol', { class: 'gi-tasks' }, doneList.map(row)),
    h(
      'section',
      { class: 'gi-ocr' },
      h('h3', { class: 'sheet-h', text: 'Leer misiones del juego' }),
      h('p', { class: 'hint', text: 'Genshin no comparte tus misiones con ningún programa, así que la app las lee de una captura del diario de misiones (tecla J) con el reconocimiento de texto de Windows, sin conexión. No toca el juego. Dentro del juego también puedes pulsar Ctrl+Alt+M con el diario abierto.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', disabled: !!gi.foundBusy, text: 'Capturar pantalla en 5 s', onclick: () => readQuests('capture') }), h('button', { class: 'btn ghost', disabled: !!gi.foundBusy, text: 'Desde una imagen…', onclick: () => readQuests('image') })),
      gi.foundBusy && h('p', { class: 'hint', text: gi.foundBusy }),
      found?.quests?.length > 0 &&
        h(
          'div',
          { class: 'gi-found' },
          h('p', { text: `Encontré ${plural(found.quests.length, 'posible misión', 'posibles misiones')}. Desmarca las que no lo sean:` }),
          h('ul', {}, found.quests.map((q) => h('li', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (e.target.checked ? picks.add(q.text) : picks.delete(q.text)) }), h('span', { text: q.text }), h('span', { class: 'gi-kind', text: q.kind }))))),
          h(
            'div',
            { class: 'row' },
            h('button', {
              class: 'btn primary',
              text: 'Añadir a mis prioridades',
              onclick: () => {
                const have = new Set(tasks.map((t) => t.text.toLowerCase()));
                const fresh = found.quests.filter((q) => picks.has(q.text) && !have.has(q.text.toLowerCase())).map((q) => ({ id: newId(), text: q.text, kind: TASK_KINDS.includes(q.kind) ? q.kind : 'Otra', done: false, at: Date.now() }));
                gi.found = null;
                saveTasks([...tasks, ...fresh]);
                toast(fresh.length ? `Añadidas ${plural(fresh.length, 'misión', 'misiones')}.` : 'Ya estaban en tu lista.');
              },
            }),
            h('button', { class: 'btn ghost', text: 'Descartar', onclick: () => { gi.found = null; renderGenshin(); } })
          )
        )
    ),
  ];
}

function genshinCharacter(c) {
  const rarityStars = (n) => '★'.repeat(n);
  return h(
    'section',
    { class: 'gi-char', style: { '--el': c.color } },
    h(
      'div',
      { class: 'gi-char-head' },
      h('div', { class: `gi-portrait r${c.rarity}` }, c.icon && h('img', { src: c.icon, alt: '', referrerPolicy: 'no-referrer' })),
      h(
        'div',
        {},
        h('p', { class: 'gi-el', text: `${c.element} ${rarityStars(c.rarity)}` }),
        h('h2', { text: c.name }),
        h('p', { class: 'gi-meta', text: `Nivel ${c.level}, constelación ${c.constellation}, amistad ${c.friendship}` }),
        h(
          'div',
          { class: 'gi-talents', 'aria-label': 'Niveles de talento' },
          c.talents.map((t, i) => h('span', { class: `gi-talent${t.boosted ? ' up' : ''}`, title: [ 'Ataque normal', 'Habilidad elemental', 'Habilidad definitiva' ][i] + (t.boosted ? ' (sube por constelación)' : '') }, t.icon && h('img', { src: t.icon, alt: '', referrerPolicy: 'no-referrer' }), h('b', { text: String(t.level) })))
        )
      )
    ),
    h(
      'div',
      { class: 'gi-char-cols' },
      h(
        'div',
        {},
        h('h3', { class: 'sheet-h', text: 'Estadísticas' }),
        h('dl', { class: 'gi-stats' }, c.stats.map((s) => [h('dt', { text: s.name }), h('dd', { text: s.value })])),
        c.weapon &&
          h(
            'div',
            { class: 'gi-weapon' },
            h('div', { class: `gi-item r${c.weapon.rarity}` }, c.weapon.icon && h('img', { src: c.weapon.icon, alt: '', referrerPolicy: 'no-referrer' })),
            h(
              'div',
              {},
              h('b', { text: c.weapon.name }),
              h('p', { class: 'hint', text: `Nivel ${c.weapon.level}, refinamiento ${c.weapon.refine}` }),
              h('p', { class: 'gi-wstat', text: [c.weapon.main && `${c.weapon.main.name} ${c.weapon.main.value}`, c.weapon.sub && `${c.weapon.sub.name} ${c.weapon.sub.value}`].filter(Boolean).join(', ') })
            )
          )
      ),
      h(
        'div',
        {},
        h('h3', { class: 'sheet-h', text: 'Artefactos' }),
        h(
          'p',
          { class: 'gi-sets' },
          c.sets.length ? c.sets.map((s) => h('span', { text: `${s.name} (${s.pieces} piezas)` })) : h('span', { class: 'hint', text: 'Sin bonificación de conjunto' }),
          c.artifacts.length > 0 && h('span', { class: 'gi-cv', title: 'Prob. CRIT ×2 + Daño CRIT de los artefactos', text: `Valor crítico ${c.critValue}` })
        ),
        c.artifacts.length
          ? h(
              'div',
              { class: 'gi-arts' },
              c.artifacts.map((a) =>
                h(
                  'div',
                  { class: 'gi-art' },
                  h('div', { class: `gi-item r${a.rarity}` }, a.icon && h('img', { src: a.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }), h('span', { class: 'gi-lv', text: `+${a.level}` })),
                  h(
                    'div',
                    {},
                    h('p', { class: 'gi-slot', text: a.slot }),
                    a.main && h('b', { text: `${a.main.name} ${a.main.value}` }),
                    h('ul', {}, a.subs.map((s) => h('li', { class: /CRIT/.test(s.name) ? 'crit' : '', text: `${s.name} +${s.value}` })))
                  )
                )
              )
            )
          : h('p', { class: 'hint', text: 'No lleva artefactos.' })
      )
    )
  );
}

// ---------- para ti (recomendaciones) ----------
const rec = { data: null, loading: false, error: null, store: 'all' };
async function loadRecs(force) {
  if (rec.loading) return;
  if (rec.data && !force) return renderRecs();
  rec.loading = true;
  renderRecs();
  try {
    rec.data = await window.api.recs(force);
    rec.error = null;
  } catch (e) {
    rec.error = errMsg(e);
  }
  rec.loading = false;
  renderRecs();
}

function recCard(r) {
  return h(
    'button',
    { class: `deal rec${r.discount ? '' : ' nosale'}`, onclick: () => window.api.open(r.url), title: `Ver en la tienda de ${r.store === 'steam' ? 'Steam' : 'Epic Games'}` },
    r.image ? h('img', { src: r.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('div', { class: 'rec-noimg' }),
    h(
      'div',
      {},
      h('h3', { text: r.name }),
      r.reason && h('p', { class: 'rec-why', text: r.reason }),
      h(
        'div',
        { class: 'price' },
        r.discount > 0 && h('span', { class: 'pct', text: `-${r.discount}%` }),
        h('span', { class: 'final', text: r.price || 'Ver precio' }),
        r.reviews && h('span', { class: 'rec-rev', text: `${r.reviews}% positivas` })
      )
    )
  );
}

function renderRecs() {
  const box = $('#recsBody');
  if (!box || $('#recsView').hidden) return;
  if (rec.error) return fill(box, h('p', { class: 'hint bad', text: rec.error }));
  if (!rec.data) return fill(box, h('p', { class: 'hint', text: 'Mirando tus categorías favoritas en Steam y el escaparate de Epic. Tarda unos segundos.' }), skeletonDeals(6));
  const d = rec.data;
  const seg = h(
    'div',
    { class: 'seg' },
    [
      ['all', 'Las dos'],
      ['steam', `Steam (${d.steam.length})`],
      ['epic', `Epic (${d.epic.length})`],
    ].map(([v, t]) =>
      h('button', {
        class: rec.store === v ? 'on' : '',
        text: t,
        onclick: () => {
          rec.store = v;
          renderRecs();
        },
      })
    )
  );
  const block = (title, hint, list) =>
    h('section', { class: 'rec-sec' }, h('h2', { class: 'section-h', text: title }), h('p', { class: 'hint', text: hint }), list.length ? h('div', { class: 'deals' }, list.map(recCard)) : h('p', { class: 'hint', text: 'Nada que encaje ahora mismo.' }));
  fill(
    box,
    d.profile.length
      ? h('p', { class: 'rec-taste' }, h('span', { class: 'field-lbl', text: 'Según lo que más juegas:' }), d.profile.map((p) => h('span', { class: 'taste', text: p.tag })))
      : h('p', { class: 'hint', text: 'Puntúa juegos o juega un poco más para afinar las recomendaciones.' }),
    h('div', { class: 'toolbar' }, seg, rec.loading && h('span', { class: 'hint', text: 'Actualizando…' })),
    rec.store !== 'epic' && block('En Steam', 'Por categorías que juegas mucho y por "más como esto" de tus favoritos.', d.steam),
    rec.store !== 'steam' && block('En Epic Games', 'De lo que Epic tiene ahora en portada, lo que encaja con tus categorías.', d.epic)
  );
}

// ---------- amigos ----------
const fr = { list: null, chosen: new Set(), common: null, loading: false, error: null };

async function loadFriends() {
  if (fr.loading) return;
  fr.loading = true;
  renderFriendsView();
  try {
    fr.list = await window.api.friends();
    fr.error = null;
  } catch (e) {
    fr.error = errMsg(e);
  }
  fr.loading = false;
  renderFriendsView();
}

async function findCommon() {
  if (!fr.chosen.size) return toast('Elige al menos un amigo.', true);
  fr.common = { loading: true };
  renderFriendsView();
  try {
    fr.common = await window.api.friendsCommon([...fr.chosen]);
  } catch (e) {
    fr.common = { error: errMsg(e) };
  }
  renderFriendsView();
}

function renderFriendsView() {
  const online = (fr.list || []).filter((f) => f.online).length;
  $('#countFriends').textContent = online || '';
  const box = $('#friendsBody');
  if (!box || $('#friendsView').hidden) return;
  if (fr.error) return box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'No se pudo leer tu lista de amigos' }), fr.error));
  if (!fr.list) return box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Cargando tus amigos de Steam…' })));
  const playing = fr.list.filter((f) => f.playing);
  const people = fr.list.map((f) =>
    h(
      'label',
      { class: `friend${f.public ? '' : ' private'}`, title: f.public ? '' : 'Perfil privado: no se pueden ver sus juegos' },
      h('input', {
        type: 'checkbox',
        disabled: !f.public,
        checked: fr.chosen.has(f.steamid),
        onchange: (e) => {
          if (e.target.checked) fr.chosen.add(f.steamid);
          else fr.chosen.delete(f.steamid);
          $('#commonBtn').textContent = fr.chosen.size ? `Buscar juegos en común (${fr.chosen.size})` : 'Buscar juegos en común';
        },
      }),
      f.avatar ? h('img', { src: f.avatar, alt: '', referrerPolicy: 'no-referrer' }) : h('span', { class: 'avatar' }),
      h('span', { class: 'friend-name' }, h('b', { text: f.name }), h('span', { class: `friend-state${f.playing ? ' playing' : f.online ? ' on' : ''}`, text: f.playing ? `Jugando a ${f.playing}` : f.public ? f.state : `${f.state}, perfil privado` }))
    )
  );
  const c = fr.common;
  let results = null;
  if (c?.loading) results = h('p', { class: 'hint', text: 'Comparando bibliotecas…' });
  else if (c?.error) results = h('p', { class: 'hint bad', text: c.error });
  else if (c) {
    const all = c.rows.filter((r) => r.all);
    const multi = all.filter((r) => r.multiplayer);
    const card2 = (r) => {
      const g = findGame(r.id);
      if (!g) return null;
      return h(
        'div',
        { class: 'common' },
        h('div', { class: 'ach-cover' }, g.cover ? coverImg(g) : null),
        h('div', {}, h('b', { text: g.title }), h('p', { class: 'hint', text: r.all ? `Lo tenéis todos${r.multiplayer ? ', multijugador' : ''}` : `También lo tiene: ${r.who.join(', ')}` })),
        h('button', { class: 'btn ghost small', text: g.installed ? 'Jugar' : 'Instalar', onclick: () => launch(g) })
      );
    };
    results = h(
      'div',
      {},
      h('h2', { class: 'section-h', text: multi.length ? `Para jugar juntos (${multi.length})` : 'Para jugar juntos' }),
      multi.length ? h('div', { class: 'commons' }, multi.slice(0, 40).map(card2)) : h('p', { class: 'hint', text: 'No tenéis en común ningún juego multijugador o cooperativo.' }),
      all.length > multi.length && h('h2', { class: 'section-h', text: `Otros que tenéis todos (${all.length - multi.length})` }),
      all.length > multi.length && h('div', { class: 'commons' }, all.filter((r) => !r.multiplayer).slice(0, 30).map(card2)),
      c.hidden?.length ? h('p', { class: 'hint', text: `No se pudieron ver los juegos de: ${c.hidden.join(', ')} (tienen los detalles de juegos en privado).` }) : null
    );
  }
  fill(
    box,
    playing.length
      ? h('div', { class: 'now-playing' }, h('span', { class: 'field-lbl', text: 'Jugando ahora' }), playing.map((f) => h('span', { class: 'chip', text: `${f.name}: ${f.playing}` })))
      : null,
    h(
      'div',
      { class: 'friends-grid' },
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'section-h', text: `Tus amigos (${fr.list.length})` }),
        h('p', { class: 'hint', text: 'Marca con quién quieres jugar. Solo se pueden comparar los que tienen el perfil público.' }),
        h('div', { class: 'friend-list' }, people),
        h('div', { class: 'row' }, h('button', { id: 'commonBtn', class: 'btn primary', text: fr.chosen.size ? `Buscar juegos en común (${fr.chosen.size})` : 'Buscar juegos en común', onclick: findCommon }))
      ),
      h('section', {}, results || h('div', { class: 'empty' }, h('b', { text: '¿A qué jugáis?' }), 'Elige amigos a la izquierda y busca los juegos que tenéis en común.'))
    )
  );
}

// ---------- ficha: sesiones, noticias, capturas y partidas guardadas ----------
function fillGameSessions(g) {
  const box = $('#gameSessions');
  if (!box) return;
  const list = gameSessions(g.id).sort((a, b) => b.start - a.start);
  const total = list.reduce((s, x) => s + sessMin(x), 0);
  const cur = state.sessions?.current?.id === g.id ? state.sessions.current : null;
  fill(
    box,
    h('h3', { class: 'sheet-h', text: 'Tus sesiones' }),
    cur ? h('p', { class: 'free-when', text: `Jugando ahora, desde ${relTime(cur.start / 1000)}` }) : null,
    list.length
      ? h(
          'div',
          {},
          h('p', { class: 'hint', text: `${fmtHours(Math.round(total))} en ${plural(list.length, 'sesión', 'sesiones')} registradas por la app.` }),
          (() => {
            const withFps = list.filter((s) => s.fps);
            if (!withFps.length) return null;
            const avg = withFps.reduce((a, s) => a + s.fps, 0) / withFps.length;
            return h('p', { class: 'hint', text: `Rendimiento medio: ${Math.round(avg)} FPS en ${plural(withFps.length, 'partida medida', 'partidas medidas')} con el modo enfoque.` });
          })(),
          h(
            'ul',
            { class: 'sess-list' },
            list.slice(0, 8).map((s) =>
              h(
                'li',
                {},
                h('span', { text: dateTimeFmt.format(s.start) }),
                h('span', { class: 'hint', text: [s.fps ? `${Math.round(s.fps)} FPS${s.low1 ? ` (1 % bajo ${Math.round(s.low1)})` : ''}` : null, s.unlocks ? plural(s.unlocks, 'logro', 'logros') : null].filter(Boolean).join(', ') }),
                h('b', { text: fmtHours(Math.round(sessMin(s))) })
              )
            )
          )
        )
      : h('p', { class: 'hint', text: 'La app aún no ha registrado ninguna partida de este juego.' })
  );
}

function fillGameNews(g) {
  const box = $('#gameNews');
  if (!box || !g || g.store !== 'steam') return box && box.replaceChildren();
  const appid = Number(g.id.split(':')[1]);
  const items = (state.news?.items || []).filter((i) => i.appid === appid).slice(0, 2);
  if (!state.news) {
    loadNews(false);
    return box.replaceChildren();
  }
  if (!items.length) return box.replaceChildren();
  box.replaceChildren(
    h('h3', { class: 'sheet-h', text: 'Últimos anuncios' }),
    items.map((it) => h('button', { class: 'news-mini', onclick: () => window.api.open(it.url) }, h('b', { text: it.title }), h('span', { class: 'hint', text: ` ${relTime(it.date)}` })))
  );
}

async function fillGameShots(g) {
  const box = $('#gameShots');
  if (!box) return;
  let shots = [];
  try {
    shots = await window.api.shots(g.id);
  } catch {}
  if (openGameId !== g.id) return;
  if (!shots.length) return box.replaceChildren(h('h3', { class: 'sheet-h', text: 'Capturas' }), h('p', { class: 'hint', text: 'No hay capturas de este juego (F12 en Steam, Win+Alt+Impr Pant en la Barra de juegos).' }));
  box.replaceChildren(
    h('h3', { class: 'sheet-h', text: `Capturas (${shots.length})` }),
    h('div', { class: 'shots' }, shots.slice(0, 12).map((s) => h('button', { class: 'shot', title: dateTimeFmt.format(s.time), onclick: () => window.api.openShot(s.file) }, h('img', { src: s.url, alt: '', loading: 'lazy' }))))
  );
}

async function fillGameSaves(g) {
  const box = $('#gameSaves');
  if (!box) return;
  box.replaceChildren(h('h3', { class: 'sheet-h', text: 'Partidas guardadas' }), h('p', { class: 'hint', text: 'Buscando dónde guarda este juego sus partidas…' }));
  let info;
  try {
    info = await window.api.savesInfo(g.id);
  } catch (e) {
    info = { error: errMsg(e) };
  }
  if (openGameId !== g.id) return;
  const cloud = info?.cloud?.[g.store];
  const parts = [h('h3', { class: 'sheet-h', text: 'Partidas guardadas' })];
  if (info?.error) parts.push(h('p', { class: 'hint bad', text: info.error }));
  else if (!info?.known) parts.push(h('p', { class: 'hint', text: 'La base de datos de Ludusavi no sabe dónde guarda sus partidas este juego.' }));
  else {
    if (cloud) parts.push(h('p', { class: 'hint ok', text: `${storeName(g)} ya guarda estas partidas en la nube; la copia local es un extra.` }));
    if (info.found?.error) parts.push(h('p', { class: 'hint bad', text: info.found.error }));
    else if (info.found?.files) parts.push(h('p', { class: 'hint', text: `En este PC: ${plural(info.found.files, 'archivo', 'archivos')}, ${fmtBytes(info.found.bytes)}.` }));
    else parts.push(h('p', { class: 'hint', text: info.registry ? 'Este juego guarda sus datos en el registro de Windows; no se pueden copiar como archivos.' : 'No hay partidas de este juego en este PC.' }));
    parts.push(
      h(
        'div',
        { class: 'row' },
        info.found?.files
          ? h('button', {
              class: 'btn ghost small',
              text: 'Hacer copia ahora',
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const r = await window.api.savesBackup(g.id);
                  toast(`Copia hecha: ${plural(r.files, 'archivo', 'archivos')}, ${fmtBytes(r.bytes)}.`);
                } catch (err) {
                  toast(errMsg(err), true);
                }
                fillGameSaves(g);
              },
            })
          : null,
        h('button', { class: 'btn ghost small', text: 'Abrir carpeta de copias', onclick: () => window.api.savesOpen(g.id) })
      )
    );
  }
  if (info?.backups?.length) {
    parts.push(
      h(
        'ul',
        { class: 'sess-list' },
        info.backups.slice(0, 5).map((b) =>
          h(
            'li',
            {},
            h('span', { text: `${dateTimeFmt.format(b.created)}${b.note ? ` (${b.note.toLowerCase()})` : ''}` }),
            h('span', { class: 'hint', text: fmtBytes(b.bytes) }),
            info.known &&
              h('button', {
                class: 'btn ghost small',
                text: 'Restaurar',
                onclick: async () => {
                  try {
                    const r = await window.api.savesRestore(g.id, b.dir);
                    if (!r.cancelled) toast(`Restaurado: ${plural(r.files, 'archivo', 'archivos')}. Tus partidas anteriores quedaron en otra copia.`);
                  } catch (err) {
                    toast(errMsg(err), true);
                  }
                  fillGameSaves(g);
                },
              })
          )
        )
      )
    );
  }
  box.replaceChildren(...parts);
}

const steamAppidOf = (g) => (g.store === 'steam' ? Number(g.id.split(':')[1]) : g.steamAppid || null);

// ---------- parecidos a este (idea 1) ----------
function similarGames(g) {
  const tags = g.tags || [];
  if (!tags.length) return [];
  const w = new Map(tags.map((t, i) => [t, 1 / (1 + i * 0.25)]));
  return games()
    .filter((o) => o.id !== g.id && o.kind !== 'tool' && (o.tags || []).length && (!g.saga || o.saga !== g.saga))
    .map((o) => {
      let s = 0;
      o.tags.forEach((t, i) => {
        if (w.has(t)) s += w.get(t) / (1 + i * 0.25);
      });
      return { o, s: s / Math.sqrt(o.tags.length) };
    })
    .filter((x) => x.s > 0.55)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.o);
}

function fillGameSimilar(g) {
  const box = $('#gameSimilar');
  if (!box) return;
  const list = similarGames(g);
  if (!list.length) return box.replaceChildren();
  const unplayed = (o) => neverPlayed(o) || (o.store !== 'steam' && !o.lastPlayed);
  box.replaceChildren(
    h('h3', { class: 'sheet-h', text: 'Parecidos a este en tu biblioteca' }),
    h('p', { class: 'hint', text: 'Por categorías en común. Los marcados «Sin estrenar» aún no los has jugado.' }),
    h(
      'div',
      { class: 'sim-row' },
      list.map((o) =>
        h(
          'button',
          {
            class: 'sim',
            title: o.title,
            onclick: () => {
              stopTrailer();
              openGameId = o.id;
              renderedGameId = null;
              renderGame();
              fillGameExtras(o);
              $('#gameDlg').scrollTo?.({ top: 0 });
            },
          },
          h('div', { class: 'sim-cover' }, o.cover ? coverImg(o) : null, unplayed(o) && h('span', { class: 'flag new', text: 'Sin estrenar' })),
          h('span', { class: 'sim-title', text: o.title })
        )
      )
    )
  );
}

// ---------- tráileres (idea 6) ----------
function stopTrailer() {
  window.trailerPlayer.stop($('#gameTrailers video'));
}

async function fillGameTrailers(g) {
  const box = $('#gameTrailers');
  const appid = steamAppidOf(g);
  if (!box || !appid) return box && box.replaceChildren();
  let list = [];
  try {
    list = await window.api.trailers(appid);
  } catch {}
  if (openGameId !== g.id || !list.length) return box.replaceChildren();
  const video = h('video', { controls: true, preload: 'none', poster: list[0].poster || '', playsInline: true });
  const label = h('p', { class: 'hint', text: list[0].name });
  const playIt = async (t, btn) => {
    for (const b of box.querySelectorAll('.trailer-thumb')) b.classList.toggle('on', b === btn);
    label.textContent = t.name;
    video.poster = t.poster || '';
    let ok = false;
    try {
      ok = t.dash ? await window.trailerPlayer.play(video, t.dash) : false;
    } catch {}
    if (!ok && t.micro) {
      // Sin DASH: el avance corto (sin sonido) que Steam muestra al pasar el ratón
      video.src = t.micro;
      video.play().catch(() => {});
      label.textContent = `${t.name} (avance corto)`;
    }
  };
  box.replaceChildren(
    h('h3', { class: 'sheet-h', text: list.length > 1 ? `Tráileres (${list.length})` : 'Tráiler' }),
    h('div', { class: 'trailer' }, video),
    label,
    list.length > 1 &&
      h(
        'div',
        { class: 'trailer-row' },
        list.map((t, i) => {
          const btn = h('button', { class: `trailer-thumb${i === 0 ? ' on' : ''}`, title: t.name }, t.poster ? h('img', { src: t.poster, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('span', { text: t.name }));
          btn.addEventListener('click', () => playIt(t, btn));
          return btn;
        })
      )
  );
  // El primero empieza al pulsar play en el vídeo
  video.addEventListener(
    'play',
    function first() {
      if (video.src) return;
      video.removeEventListener('play', first);
      playIt(list[0], box.querySelector('.trailer-thumb'));
    }
  );
}

// ---------- ¿lo mueve mi PC? (idea 5) ----------
const canRunCache = {};
let hwInfo = null;
const CANRUN = {
  rec: { cls: 'ok', short: 'Lo mueve bien', long: 'Tu PC cumple los requisitos recomendados.' },
  min: { cls: 'mid', short: 'Lo mueve justo', long: 'Tu PC cumple los mínimos, pero no todos los recomendados: tocará bajar gráficos.' },
  no: { cls: 'bad', short: 'Le cuesta', long: 'Tu PC no llega a los requisitos mínimos en algo.' },
};
async function ensureCanRun(appids) {
  const todo = [...new Set(appids)].filter((id) => id && !(id in canRunCache));
  if (!todo.length) return;
  const r = await window.api.canRun(todo);
  hwInfo = r.hw;
  Object.assign(canRunCache, r.games);
}
function canRunBadge(appid) {
  const c = canRunCache[appid];
  const v = c && CANRUN[c.verdict];
  if (!v) return null;
  const detail = (c.rec && c.verdict === 'rec' ? c.rec : c.min || []).map((x) => `${x.ok === true ? '✓' : x.ok === false ? '✗' : '?'} ${x.part}: ${x.need}`).join('\n');
  return h('span', { class: `canrun ${v.cls}`, text: v.short, 'data-tip': `${v.long}\n${detail}` });
}

async function fillGameCanRun(g) {
  const box = $('#gameCanRun');
  const appid = steamAppidOf(g);
  if (!box || g.installed || !appid) return box && box.replaceChildren();
  try {
    await ensureCanRun([appid]);
  } catch {
    return box.replaceChildren();
  }
  if (openGameId !== g.id) return;
  const c = canRunCache[appid];
  if (!c?.verdict) return box.replaceChildren();
  const v = CANRUN[c.verdict];
  const rows = (list) => list.map((x) => h('li', { class: x.ok === true ? 'ok' : x.ok === false ? 'bad' : '' }, h('b', { text: `${x.part}: ` }), x.need, x.ok == null && h('span', { class: 'hint', text: ' (no se pudo comparar)' })));
  box.replaceChildren(
    h('h3', { class: 'sheet-h', text: '¿Lo mueve tu PC?' }),
    h('p', { class: `canrun-line ${v.cls}` }, h('b', { text: v.short }), ` · ${v.long}`),
    h('p', { class: 'hint', text: `Tu equipo: ${hwInfo.cpu}, ${hwInfo.gpu}${hwInfo.vramGB ? ` (${hwInfo.vramGB} GB)` : ''}, ${hwInfo.ramGB} GB de RAM. La comparación de procesador y gráfica es aproximada.` }),
    h('details', {}, h('summary', { text: 'Ver requisitos' }), c.min?.length && h('p', { class: 'hint', text: 'Mínimos' }), h('ul', { class: 'req' }, rows(c.min || [])), c.rec?.length && h('p', { class: 'hint', text: 'Recomendados' }), h('ul', { class: 'req' }, rows(c.rec || [])))
  );
}

function fillGameExtras(g) {
  fillGameCanRun(g);
  fillGameTrailers(g);
  fillGameSimilar(g);
  fillGameSessions(g);
  fillGameNews(g);
  fillGameShots(g);
  fillGameSaves(g);
  window.fillGameMods?.(g);
}

// ---------- valoraciones ----------
function starsView(n) {
  return h('span', { class: 'stars', 'aria-label': n ? `${n} de 5 estrellas` : 'Sin valorar' }, [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= (n || 0) ? 'on' : '', text: '★' })));
}

function starsInput(g) {
  const u = state.user[g.id] || {};
  return h(
    'div',
    { class: 'stars input', role: 'radiogroup', 'aria-label': 'Tu nota' },
    [1, 2, 3, 4, 5].map((i) =>
      h('button', {
        class: i <= (u.rating || 0) ? 'on' : '',
        text: '★',
        title: `${i} de 5`,
        'aria-label': `${i} de 5 estrellas`,
        onclick: async () => {
          // Pulsar la misma estrella otra vez quita la nota
          const rating = u.rating === i ? null : i;
          await setUser(g.id, { rating, ratedAt: rating ? Date.now() : null });
          renderGame();
          fillGameExtras(g);
        },
      })
    ),
    u.rating ? h('span', { class: 'hint', text: ['', 'Malo', 'Flojo', 'Está bien', 'Muy bueno', 'Imprescindible'][u.rating] }) : h('span', { class: 'hint', text: 'Sin valorar' })
  );
}

function topOfYear() {
  const year = new Date().getFullYear();
  const inYear = (t) => t && new Date(t).getFullYear() === year;
  const playedYear = new Set(allSessions().filter((s) => inYear(s.start)).map((s) => s.id));
  const rows = (state.lib?.games || [])
    .filter((g) => {
      const u = state.user[g.id] || {};
      if (!u.rating) return false;
      return playedYear.has(g.id) || inYear((g.lastPlayed || 0) * 1000) || inYear(u.finishedAt) || inYear(u.ratedAt);
    })
    .sort((a, b) => state.user[b.id].rating - state.user[a.id].rating || (b.lastPlayed || 0) - (a.lastPlayed || 0))
    .slice(0, 10);
  return h(
    'section',
    { class: 'panel top-year' },
    h('h2', { class: 'section-h', text: `Tu top de ${year}` }),
    rows.length
      ? h(
          'ol',
          { class: 'top-list' },
          rows.map((g) => h('li', {}, h('button', { class: 'link-title', text: g.title, onclick: () => openGame(g) }), starsView(state.user[g.id].rating)))
        )
      : h('p', { class: 'hint', text: 'Valora tus juegos con estrellas en su ficha y aquí saldrán los mejores que has jugado este año.' })
  );
}

// ---------- vitrina de logros ----------
const show = { data: null, loading: false, error: null };
async function loadShowcase() {
  if (show.loading || (show.data && Date.now() - show.at < 3600000)) return renderShowcase();
  show.loading = true;
  renderShowcase();
  try {
    show.data = await window.api.achShowcase();
    show.at = Date.now();
    show.error = null;
  } catch (e) {
    show.error = errMsg(e);
  }
  show.loading = false;
  renderShowcase();
}

function renderShowcase() {
  const box = $('#achShowcase');
  if (!box) return;
  if (show.error) return fill(box, h('p', { class: 'hint bad', text: show.error }));
  if (!show.data) return fill(box, h('p', { class: 'hint', text: show.loading ? 'Preparando tu vitrina de logros (la primera vez tarda unos segundos)…' : '' }));
  const d = show.data;
  const tile = (a) => {
    const g = findGame(`steam:${a.appid}`);
    return h(
      'button',
      { class: 'trophy', 'data-tip': `${a.name}${a.description ? `: ${a.description}` : ''}`, onclick: () => g && (showView('ach'), openAchDetail(g)) },
      a.icon ? h('img', { src: a.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('span', { class: 'ach-icon' }),
      h('span', { class: 'trophy-txt' }, h('b', { text: a.name }), h('span', { text: g?.title || '' })),
      a.pct != null && h('span', { class: `rar ${a.pct < 1 ? 'legend' : a.pct < 5 ? 'epic' : a.pct < 20 ? 'rare' : 'uncommon'}`, text: fmtPct(a.pct) })
    );
  };
  fill(
    box,
    h(
      'div',
      { class: 'ach-stats' },
      statTile(String(d.streak.current), d.streak.current === 1 ? 'día seguido consiguiendo logros' : 'días seguidos consiguiendo logros'),
      statTile(String(d.streak.best), 'tu mejor racha (días)'),
      statTile(String(d.rare), 'logros que tiene menos del 5 % de los jugadores')
    ),
    h('h2', { class: 'section-h', text: 'Vitrina: tus logros más raros' }),
    d.rarest.length ? h('div', { class: 'trophies' }, d.rarest.map(tile)) : h('p', { class: 'hint', text: 'Aún no hay datos de rareza.' }),
    d.recent.length > 0 && h('h2', { class: 'section-h', text: 'Conseguidos hace poco' }),
    d.recent.length > 0 && h('div', { class: 'trophies small' }, d.recent.map((a) => {
      const t = tile(a);
      t.append(h('span', { class: 'hint', text: relTime(a.time) }));
      return t;
    }))
  );
}

// ---------- espacio: cachés y juegos repetidos ----------
const cache = { items: null, loading: false };
async function scanCaches() {
  cache.loading = true;
  renderCaches();
  try {
    cache.items = await window.api.cacheScan();
  } catch (e) {
    cache.items = [];
    toast(errMsg(e), true);
  }
  cache.loading = false;
  renderCaches();
}

function renderCaches() {
  const box = $('#cacheBox');
  if (!box) return;
  if (!cache.items)
    return fill(box, h('button', { class: 'btn ghost small', text: cache.loading ? 'Calculando…' : 'Calcular cuánto ocupan', disabled: cache.loading, onclick: scanCaches }));
  const total = cache.items.reduce((s, i) => s + i.bytes, 0);
  fill(
    box,
    h('p', { class: 'hint', text: `En total: ${fmtBytes(total) === '—' ? '0 MB' : fmtBytes(total)}.` }),
    h(
      'div',
      { class: 'stale' },
      cache.items.map((i) =>
        h(
          'div',
          { class: 'stale-row' },
          h('span', { class: 'link-title', text: i.label }),
          h('span', { class: 'hint', text: i.bytes ? fmtBytes(i.bytes) : 'vacía' }),
          i.bytes
            ? h('button', {
                class: `btn small ${i.safe ? 'primary' : 'ghost'}`,
                text: 'Borrar',
                onclick: async () => {
                  try {
                    const r = await window.api.cacheClean(i.kind);
                    if (!r.cancelled) toast(`Liberados ${fmtBytes(r.freed) === '—' ? '0 MB' : fmtBytes(r.freed)}.`);
                  } catch (e) {
                    toast(errMsg(e), true);
                  }
                  scanCaches();
                },
              })
            : h('span')
        )
      )
    )
  );
}

function duplicatesPanel() {
  const base = (t) => normTitle(t).replace(/\b(definitive|enhanced|complete|goty|game of the year|deluxe|ultimate|remastered|edition|directors cut)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const groups = new Map();
  for (const g of games().filter((x) => x.installed)) {
    const k = base(g.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  const dups = [...groups.values()].filter((l) => l.length > 1);
  return h(
    'section',
    { class: 'panel' },
    h('h2', { class: 'section-h', text: 'Instalados dos veces' }),
    dups.length
      ? h(
          'div',
          { class: 'stale' },
          dups.map((l) =>
            h(
              'div',
              { class: 'dup' },
              h('b', { text: l[0].title }),
              l.map((g) =>
                h(
                  'div',
                  { class: 'stale-row' },
                  h('button', { class: 'link-title', text: `${storeName(g)}, ${(g.installPath || '').slice(0, 2)}`, onclick: () => openGame(g) }),
                  h('span', { class: 'hint', text: `${fmtBytes(g.sizeBytes)}${g.lastPlayed ? `, jugado ${relTime(g.lastPlayed)}` : ''}` }),
                  g.store === 'steam'
                    ? h('button', { class: 'btn ghost small', text: 'Desinstalar', onclick: () => window.api.open(`steam://uninstall/${g.id.split(':')[1]}`) })
                    : h('span', { class: 'hint', text: 'Desde el Epic Games Launcher' })
                )
              )
            )
          )
        )
      : h('p', { class: 'hint', text: 'No tienes ningún juego instalado en las dos tiendas a la vez.' })
  );
}

// ---------- pestañas de Ajustes ----------
function showSettingsTab(tab) {
  for (const b of $$('#setTabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const f of $$('#settingsForm fieldset[data-tab]')) f.hidden = f.dataset.tab !== tab;
}

// ---------- bienvenida (primera vez) ----------
const welcome = { step: 0 };

async function openWelcome() {
  welcome.step = 0;
  welcome.settings = await window.api.getSettings();
  renderWelcome();
  $('#welcomeDlg').showModal();
}

async function finishWelcome() {
  await window.api.saveSettings({ onboarded: true });
  $('#welcomeDlg').close();
  state.settings = await window.api.basicSettings();
  refresh();
}

function renderWelcome() {
  const s = welcome.settings || {};
  const dots = h('div', { class: 'wsteps' }, [0, 1, 2].map((i) => h('i', { class: i === welcome.step ? 'on' : i < welcome.step ? 'done' : '' })));
  const next = (label = 'Siguiente') =>
    h('button', {
      class: 'btn primary',
      text: label,
      onclick: async () => {
        await saveWelcomeStep();
        if (welcome.step < 2) {
          welcome.step++;
          welcome.settings = await window.api.getSettings();
          renderWelcome();
        } else finishWelcome();
      },
    });
  const back = welcome.step > 0 && h('button', { class: 'btn ghost', text: 'Atrás', onclick: () => { welcome.step--; renderWelcome(); } });
  const skip = h('button', { class: 'btn ghost', text: 'Saltar la bienvenida', onclick: finishWelcome });

  let body;
  if (welcome.step === 0) {
    body = [
      h('p', { class: 'hero-kicker', text: 'Paso 1 de 3' }),
      h('h2', { text: 'Tu biblioteca de Steam' }),
      h('p', { class: 'hint', text: 'Sin configurar nada ya verás tus juegos instalados. Con tu clave de la API de Steam verás todos tus juegos, tus logros, tus horas y a tus amigos.' }),
      h('ol', { class: 'wlist' },
        h('li', {}, 'Entra en ', h('a', { href: 'https://steamcommunity.com/dev/apikey', target: '_blank', text: 'steamcommunity.com/dev/apikey' }), ' con tu cuenta.'),
        h('li', { text: 'En «Nombre de dominio» escribe localhost, acepta y copia la clave.' }),
        h('li', { text: 'Pégala aquí. Se guarda cifrada con tu usuario de Windows.' })
      ),
      h('label', { class: 'wfield' }, 'Clave de la API web de Steam', h('input', { id: 'wKey', type: 'password', autocomplete: 'off', spellcheck: false, placeholder: s.hasSteamKey ? 'Ya hay una clave guardada' : 'Pega aquí tu clave' })),
      h('label', { class: 'wfield' }, 'SteamID64', h('input', { id: 'wId', inputmode: 'numeric', value: s.steamId || '', placeholder: s.detectedSteamId ? `Detectado: ${s.detectedSteamId}` : '7656119…' })),
      h('p', { id: 'wErr', class: 'hint bad' }),
    ];
  } else if (welcome.step === 1) {
    const st = s.legendaryState?.loggedIn ? `Vinculado como ${s.legendaryState.account}.` : s.legendary ? 'legendary está listo; falta vincular tu cuenta.' : 'No se encuentra legendary.';
    body = [
      h('p', { class: 'hero-kicker', text: 'Paso 2 de 3' }),
      h('h2', { text: 'Epic Games (opcional)' }),
      h('p', { class: 'hint', text: 'Sin hacer nada se leen los juegos de Epic que conoce el Epic Games Launcher. Para tenerlos todos y saber cuándo hay actualizaciones, se usa legendary, un programa libre: tú inicias sesión en Epic y la app nunca ve tu contraseña.' }),
      h('ol', { class: 'wlist' },
        h('li', {}, 'Descarga legendary_windows_x64.exe de ', h('a', { href: 'https://github.com/legendary-gl/legendary/releases', target: '_blank', text: 'su página oficial' }), '.'),
        h('li', { text: 'Elige el archivo con el botón de abajo.' }),
        h('li', { text: 'Pulsa «Vincular Epic», inicia sesión y pega el código en la ventana negra que se abre.' })
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn ghost small', text: 'Elegir legendary.exe', onclick: async () => { await window.api.pickLegendary(); welcome.settings = await window.api.getSettings(); renderWelcome(); } }),
        h('button', { class: 'btn ghost small', text: 'Vincular Epic', onclick: async () => { try { await window.api.linkEpic(); } catch (e) { toast(errMsg(e), true); } } }),
        h('button', { class: 'btn ghost small', text: 'Comprobar', onclick: async () => { welcome.settings = await window.api.getSettings(); renderWelcome(); } })
      ),
      h('p', { class: `hint ${s.legendaryState?.loggedIn ? 'ok' : ''}`, text: st }),
    ];
  } else {
    const f = s.focus || {};
    body = [
      h('p', { class: 'hero-kicker', text: 'Paso 3 de 3' }),
      h('h2', { text: 'Modo enfoque' }),
      h('p', { class: 'hint', text: 'Mientras juegas, el juego va en prioridad alta y los programas pesados en segundo plano pasan a modo eficiencia. No se cierra nada y todo vuelve a como estaba al terminar.' }),
      h('label', { class: 'check' }, h('input', { id: 'wAuto', type: 'checkbox', checked: f.autoOnPlay !== false }), 'Activarlo al pulsar «Jugar» en la app'),
      h('label', { class: 'check' }, h('input', { id: 'wFree', type: 'checkbox', checked: f.freeMemory !== false }), 'Cerrar la ventana de la biblioteca mientras juegas para liberar memoria (vuelve a abrirse al terminar)'),
      h('label', { class: 'check' }, h('input', { id: 'wOverlay', type: 'checkbox', checked: !!f.overlay }), 'Panel flotante con FPS, CPU, GPU y RAM encima del juego'),
      h('p', { class: 'hint', text: 'Atajo: Ctrl+Alt+F activa o quita el modo enfoque desde cualquier sitio. Todo esto se puede cambiar luego en Ajustes.' }),
    ];
  }
  $('#welcomeBody').replaceChildren(
    h('div', { class: 'welcome-head' }, h('div', { class: 'brand' }, h('span', { text: 'Bienvenido a ViperTeca' })), dots),
    body,
    h('div', { class: 'actions' }, welcome.step === 0 ? skip : back, next(welcome.step === 2 ? 'Empezar' : 'Siguiente'))
  );
}

async function saveWelcomeStep() {
  if (welcome.step === 0) {
    const key = $('#wKey').value.trim();
    const id = $('#wId').value.trim();
    if (key && !/^[0-9A-Fa-f]{32}$/.test(key)) {
      $('#wErr').textContent = 'La clave tiene 32 caracteres (números y letras de la A a la F).';
      throw new Error('clave');
    }
    if (id && !/^\d{17}$/.test(id)) {
      $('#wErr').textContent = 'El SteamID64 tiene 17 cifras y empieza por 7656119.';
      throw new Error('id');
    }
    await window.api.saveSettings({ steamKey: key || undefined, steamId: id || undefined });
  } else if (welcome.step === 2) {
    await window.api.saveSettings({ focus: { autoOnPlay: $('#wAuto').checked, freeMemory: $('#wFree').checked, overlay: $('#wOverlay').checked } });
  }
}

// ---------- ficha de juego ----------
const fmtBytes = (b) => (!b ? '—' : b >= 1e12 ? `${(b / 1e12).toFixed(2).replace('.', ',')} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const fmtHours = (min) => (min >= 60 ? `${(min / 60).toFixed(min >= 600 ? 0 : 1).replace('.', ',')} h` : `${min} min`);
let openGameId = null;
let renderedGameId = null;

async function setUser(id, patch) {
  state.user = await window.api.setUserGame(id, patch);
  renderLibrary();
}

function openGame(g) {
  openGameId = g.id;
  renderedGameId = null;
  renderGame();
  fillGameExtras(g);
  $('#gameDlg').showModal();
}

function renderGame() {
  const g = findGame(openGameId);
  if (!g) return;
  const u = state.user[g.id] || {};
  const appid = g.store === 'steam' ? g.id.split(':')[1] : null;
  const a = appid && ach.summary?.games?.[appid];
  const facts = [
    ['Horas jugadas', g.store === 'steam' ? (g.playtimeMin ? fmtHours(g.playtimeMin) : 'Nunca jugado') : 'Epic no da las horas'],
    g.playtime2wMin ? ['Últimas 2 semanas', fmtHours(g.playtime2wMin)] : null,
    ['Última partida', g.lastPlayed ? `${relTime(g.lastPlayed)} (${dateFmt.format(g.lastPlayed * 1000)})` : '—'],
    ['Comprado', g.purchased ? dateFmt.format(g.purchased * 1000) : g.store === 'epic' ? 'Epic no da la fecha' : '—'],
    ['En disco', g.installed ? fmtBytes(g.sizeBytes) : 'Sin instalar'],
    a && !a.noStats && a.total ? ['Logros', `${a.done} de ${a.total} (${fmtPct((a.done / a.total) * 100)})`] : null,
    g.released ? ['Salida', String(new Date(g.released * 1000).getFullYear())] : null,
  ].filter(Boolean);

  const statusSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Estado' },
    [['', 'Sin estado'], ...Object.entries(STATUS_LABEL)].map(([v, label]) =>
      h('button', { class: (u.status || '') === v ? 'on' : '', text: label, onclick: () => setUser(g.id, { status: v || null }).then(renderGame) })
    )
  );
  const note = h('textarea', { class: 'note', rows: 3, placeholder: 'Notas: dónde lo dejaste, qué te falta, trucos…', value: u.note || '' });
  let noteTimer;
  note.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => setUser(g.id, { note: note.value }), 500);
  });
  const discord = h(
    'select',
    { 'aria-label': 'Discord en el modo enfoque', onchange: (e) => setUser(g.id, { focusDiscord: e.target.value || null }) },
    h('option', { value: '', text: 'Según el ajuste general' }),
    h('option', { value: 'keep', text: 'Dejar Discord tranquilo' }),
    h('option', { value: 'throttle', text: 'Frenar también Discord' })
  );
  discord.value = u.focusDiscord || '';

  // Las secciones que se rellenan aparte se conservan al volver a pintar la ficha
  const same = renderedGameId === g.id;
  renderedGameId = g.id;
  const slot = (id) => (same && document.getElementById(id)) || h('div', { id });
  const close = () => $('#gameDlg').close();
  const platDone = a && !a.noStats && a.total && a.done === a.total;
  const isBg = state.settings?.bgGame === g.id;

  $('#gameBody').replaceChildren(
    h(
      'header',
      { class: `sheet-hero${g.hero ? '' : ' no-art'}` },
      g.hero && h('img', { class: 'sheet-art', src: g.hero, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }),
      h('button', { class: 'sheet-close', 'aria-label': 'Cerrar la ficha', title: 'Cerrar (Esc)', onclick: close }, h('span', { text: '×', 'aria-hidden': 'true' })),
      h(
        'div',
        { class: 'sheet-hero-in' },
        h('div', { class: 'sheet-cover' }, g.cover ? coverImg(g) : null),
        h(
          'div',
          { class: 'sheet-title' },
          h('p', { class: 'hero-kicker', text: STORE_FULL[g.store] || g.store }),
          h('h2', { text: g.title }),
          g.updatePending && h('p', { class: 'sheet-upd', text: g.updateText }),
          h(
            'div',
            { class: 'sheet-cta' },
            h('button', { class: 'btn primary big', onclick: () => { close(); launch(g); } }, h('span', { 'aria-hidden': 'true', text: g.installed ? '▶' : '↓' }), g.installed ? 'Jugar' : 'Instalar'),
            appid && a && !a.noStats && h('button', { class: 'btn ghost', text: 'Logros', onclick: () => { close(); showView('ach'); openAchDetail(g); } }),
            /genshin impact/i.test(g.title) && h('button', { class: 'btn ghost', text: 'Tu perfil', onclick: () => { close(); showView('genshin'); } }),
            g.trainer && h('button', { class: 'btn ghost trainer', title: state.wand ? 'Abrir sus trucos en Wand (solo para partidas de un jugador)' : 'Ver sus trucos en la web de Wand (no está instalado)', onclick: () => window.api.open(state.wand ? g.trainer.play : g.trainer.web) }, h('span', { class: 'wand-dot', 'aria-hidden': 'true' }), `Trucos (${g.trainer.cheats})`),
            g.storeUrl && h('button', { class: 'btn ghost', text: 'Tienda', onclick: () => window.api.open(g.storeUrl) }),
            g.hero && h('button', { class: `btn ghost${isBg ? ' on' : ''}`, text: isBg ? 'Quitar de fondo' : 'Usar de fondo', 'aria-pressed': String(isBg), onclick: () => setBackground(isBg ? '' : g.id).then(renderGame) }),
            g.installed && g.store === 'steam' && h('button', { class: 'btn ghost subtle', text: 'Desinstalar', title: 'Steam te pedirá confirmación', onclick: () => window.api.open(`steam://uninstall/${appid}`) })
          )
        )
      )
    ),
    h('dl', { class: 'stat-strip' }, facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
    (g.tags || []).length || g.saga
      ? h(
          'div',
          { class: 'sheet-tags' },
          g.saga && h('button', { class: 'chip saga-chip', text: `Saga: ${g.saga}`, onclick: () => { close(); showView('sagas'); openSaga(g.saga); } }),
          (g.tags || []).map((t) => h('button', { class: 'chip', text: t, title: 'Ver los juegos de esta categoría', onclick: () => filterByTag(t) }))
        )
      : null,
    h(
      'div',
      { class: 'sheet-cols' },
      h(
        'section',
        {},
        h('h3', { class: 'sheet-h', text: 'Tu seguimiento' }),
        statusSeg,
        starsInput(g),
        h(
          'div',
          { class: 'row toggles' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!u.fav, onchange: (e) => setUser(g.id, { fav: e.target.checked }) }), 'Favorito'),
          appid && a && !a.noStats && !platDone
            ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!u.pin, onchange: (e) => setUser(g.id, { pin: e.target.checked }) }), 'Voy a por el platino')
            : null,
          platDone && h('span', { class: 'plat-badge', text: 'Platino conseguido' })
        ),
        note,
        h('h3', { class: 'sheet-h', text: 'Colecciones' }),
        colsBlock(g)
      ),
      h(
        'section',
        {},
        slot('gameCanRun'),
        slot('gameSessions'),
        h('h3', { class: 'sheet-h', text: 'Modo enfoque en este juego' }),
        h('label', { class: 'field-stack' }, h('span', { class: 'hint', text: 'Qué hacer con Discord mientras juegas a este' }), discord)
      )
    ),
    h(
      'div',
      { class: 'sheet-links' },
      h('span', { class: 'hint', text: 'Buscar:' }),
      h('button', { class: 'link-btn', text: 'Guías en YouTube', onclick: () => window.api.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(g.title + ' guía')}`) }),
      h('button', { class: 'link-btn', text: 'Mods en Nexus Mods', onclick: () => window.api.open(`https://www.nexusmods.com/search?keyword=${encodeURIComponent(g.title)}`) }),
      h('button', { class: 'link-btn', text: 'Cuánto dura (HowLongToBeat)', onclick: () => window.api.open(`https://howlongtobeat.com/?q=${encodeURIComponent(g.title)}`) })
    ),
    slot('gameTrailers'),
    slot('gameSimilar'),
    slot('gameNews'),
    slot('gameShots'),
    slot('gameSaves'),
    slot('gameMods')
  );
}

function filterByTag(t) {
  $('#gameDlg').close();
  state.tag = t;
  savePrefs();
  showView('library');
  syncControls();
  renderLibrary();
}

// ---------- modo enfoque ----------
function renderFocus() {
  const f = state.focus || { mode: 'off' };
  const btn = $('#focusBtn');
  btn.classList.toggle('waiting', f.mode === 'waiting');
  btn.classList.toggle('on', f.mode === 'on');
  btn.querySelector('.lbl').textContent =
    f.mode === 'on' ? `Enfocado en ${f.game?.title || 'tu juego'}` : f.mode === 'waiting' ? 'Esperando un juego…' : 'Modo enfoque';
  if ($('#focusDlg').open) {
    fillFocusDialog();
    if (f.mode === 'on' && !perfTimer) startPerfPolling();
  }
}

function fillFocusDialog() {
  const f = state.focus || { mode: 'off' };
  const body = $('#focusBody');
  $('#focusStop').hidden = f.mode === 'off';
  $('#focusStop').textContent = f.mode === 'waiting' ? 'Cancelar' : 'Salir del modo enfoque';
  if (f.mode === 'waiting') {
    body.replaceChildren(
      h('h2', { text: 'Esperando a que abras un juego' }),
      h('p', { class: 'hint', text: 'Abre cualquiera de tus juegos instalados y el modo enfoque se activará solo. Si en 15 minutos no abres ninguno, se cancela.' })
    );
    return;
  }
  if (f.mode !== 'on') {
    body.replaceChildren(h('h2', { text: 'Modo enfoque desactivado' }));
    return;
  }
  const power = f.power?.now
    ? f.power.prev
      ? `Plan de energía cambiado a ${f.power.now.name}; al terminar vuelve a ${f.power.prev.name}.`
      : `Ya usabas el plan ${f.power.now.name}.`
    : f.power?.failed
      ? 'No se pudo cambiar el plan de energía.'
      : 'El plan de energía no se toca (lo puedes cambiar en Ajustes).';
  body.replaceChildren(
    h('p', { class: 'hero-kicker', text: 'Modo enfoque activo' }),
    h('h2', { text: f.game?.title || 'Tu juego' }),
    h(
      'ul',
      { class: 'focus-list' },
      h('li', {}, h('b', { text: 'Juego en prioridad alta' }), f.boosted ? ` (${plural(f.boosted, 'proceso', 'procesos')}).` : '. Este juego no deja cambiar su prioridad (suele ser por su sistema antitrampas); el resto se aplica igual.'),
      h('li', {}, h('b', { text: `${plural(f.background, 'proceso', 'procesos')} en modo eficiencia` }), f.background ? ': consumen menos CPU y su memoria se libera antes que la del juego.' : ': no había programas pesados abiertos.'),
      h('li', { text: power }),
      h('li', {
        text: f.gameMode === false
          ? 'El Modo de juego de Windows está desactivado. Actívalo en Configuración → Juegos → Modo de juego: es lo que da prioridad de GPU al juego.'
          : 'El Modo de juego de Windows está activado: da prioridad de GPU y CPU al juego en primer plano.',
      })
    ),
    f.apps?.length ? h('div', { class: 'focus-apps' }, f.apps.map((a) => h('span', { class: 'chip', text: a.count > 1 ? `${a.name} ×${a.count}` : a.name }))) : null,
    lastPerf?.error ? h('p', { class: 'hint bad', text: lastPerf.error }) : null,
    h('p', { class: 'hint', text: f.discordKept ? 'Discord no se toca en este juego.' : 'Discord también está en modo eficiencia (puedes cambiarlo en la ficha del juego).' }),
    h('div', { id: 'focusPerf', class: 'perf-grid' }, perfCells(lastPerf)),
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: !!state.settings?.focus?.overlay,
        onchange: async (e) => {
          await window.api.setOverlay(e.target.checked);
          state.settings = await window.api.basicSettings();
        },
      }),
      'Panel flotante de rendimiento encima del juego'
    ),
    h('p', { class: 'hint', text: 'Al cerrar el juego todo vuelve solo a como estaba. Si cierras esta app, también se deshace.' })
  );
}

let lastPerf = null;
let perfTimer = null;
const pctTxt = (v) => (v == null ? '—' : `${Math.round(v)} %`);
const gbTxt = (b) => (b ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : '—');
function perfCells(s) {
  return [
    statTile(s?.fps ? String(Math.round(s.fps)) : '—', s?.low1 ? `FPS (1 % bajo: ${Math.round(s.low1)})` : s?.error ? 'FPS: sin datos' : 'FPS'),
    statTile(pctTxt(s?.cpu), 'CPU'),
    statTile(pctTxt(s?.gpu), 'GPU (3D)'),
    statTile(s ? `${gbTxt(s.ramUsed)} de ${gbTxt(s.ramTotal)}` : '—', 'RAM del PC'),
    statTile(gbTxt(s?.gameRam), 'RAM del juego'),
    statTile(gbTxt(s?.vram), 'VRAM usada'),
  ];
}
function startPerfPolling() {
  stopPerfPolling();
  const tick = async () => {
    lastPerf = await window.api.perfSample();
    const box = $('#focusPerf');
    if (box) box.replaceChildren(...perfCells(lastPerf));
  };
  tick();
  perfTimer = setInterval(tick, 2000);
}
function stopPerfPolling() {
  clearInterval(perfTimer);
  perfTimer = null;
}

async function onFocusClick() {
  const f = state.focus || { mode: 'off' };
  if (f.mode !== 'off') {
    fillFocusDialog();
    $('#focusDlg').showModal();
    if (f.mode === 'on') startPerfPolling();
    return;
  }
  try {
    state.focus = await window.api.focusStart();
    renderFocus();
    if (state.focus.mode === 'on') toast(`Modo enfoque activado para ${state.focus.game.title}.`);
    else toast('No hay ningún juego abierto: el modo enfoque se activará cuando abras uno.');
  } catch (e) {
    toast(`No se pudo activar el modo enfoque: ${errMsg(e)}`, true);
  }
}

// ---------- ajustes ----------
async function openSettings() {
  const dlg = $('#settings');
  const s = await window.api.getSettings();
  $('#steamId').value = s.steamId || '';
  $('#steamKey').value = '';
  $('#steamIdHint').textContent = s.detectedSteamId
    ? `Detectado en el cliente de Steam: ${s.detectedSteamId}${s.steamId ? '' : '. Se usa este si lo dejas vacío.'}`
    : 'No se ha podido detectar desde el cliente de Steam.';
  $('#keyState').replaceChildren(
    s.hasSteamKey ? h('b', { class: 'ok', text: ' Hay una clave guardada.' }) : h('b', { class: 'bad', text: ' Aún no hay ninguna clave guardada.' })
  );
  $('#legendaryPath').value = s.legendaryPath || '';
  $('#focusPower').checked = s.focus?.powerPlan !== false;
  $('#trackSessions').checked = s.trackSessions !== false;
  for (const k of ['autoBackup', 'sessionSummary', 'weeklySummary', 'epicReminder', 'friendAlerts', 'hotkey', 'priceAlerts']) $(`#set-${k}`).checked = s[k] !== false;
  $('#set-dailyLimitMin').value = String(s.dailyLimitMin || 0);
  $('#set-remindEveryMin').value = String(s.remindEveryMin || 0);
  $('#keepTracking').checked = s.keepTracking !== false;
  $('#dataState').textContent = '';
  $('#focusDiscord').value = s.focus?.discord || 'multiplayer';
  $('#focusAuto').checked = s.focus?.autoOnPlay !== false;
  $('#focusOverlay').checked = !!s.focus?.overlay;
  $('#focusFps').checked = s.focus?.fps !== false;
  $('#focusMinimize').checked = s.focus?.minimize !== false;
  $('#focusFree').checked = s.focus?.freeMemory !== false;
  showSettingsTab('cuentas');
  fillBackupDir();
  fillAppearance(s);
  $('#exportState').textContent = '';
  const es = $('#epicState');
  if (!s.legendary) es.replaceChildren(h('span', { class: 'bad', text: 'No se encuentra legendary.' }));
  else if (s.legendaryState?.loggedIn) es.replaceChildren(h('span', { class: 'ok', text: `Vinculado como ${s.legendaryState.account}.` }));
  else es.replaceChildren(h('span', { class: 'bad', text: 'legendary está listo, pero falta vincular tu cuenta.' }));
  const info = state.lib?.purchaseInfo;
  $('#purchState').textContent = info ? `Última importación: ${plural(info.games, 'juego', 'juegos')} con fecha.` : '';
  dlg.showModal();
}

async function saveSettings(ev) {
  ev.preventDefault();
  const steamId = $('#steamId').value.trim();
  if (steamId && !/^\d{17}$/.test(steamId)) return toast('El SteamID64 tiene 17 cifras y empieza por 7656119.', true);
  const steamKey = $('#steamKey').value.trim();
  if (steamKey && !/^[0-9A-Fa-f]{32}$/.test(steamKey)) return toast('La clave de la API de Steam tiene 32 caracteres (números y letras de la A a la F).', true);
  try {
    await window.api.saveSettings({
      steamId,
      steamKey: steamKey || undefined,
      legendaryPath: $('#legendaryPath').value,
      trackSessions: $('#trackSessions').checked,
      ...Object.fromEntries(['autoBackup', 'sessionSummary', 'weeklySummary', 'epicReminder', 'friendAlerts', 'hotkey', 'priceAlerts'].map((k) => [k, $(`#set-${k}`).checked])),
      dailyLimitMin: Number($('#set-dailyLimitMin').value),
      remindEveryMin: Number($('#set-remindEveryMin').value),
      keepTracking: $('#keepTracking').checked,
      focus: {
        powerPlan: $('#focusPower').checked,
        discord: $('#focusDiscord').value,
        minimize: $('#focusMinimize').checked,
        freeMemory: $('#focusFree').checked,
        autoOnPlay: $('#focusAuto').checked,
        overlay: $('#focusOverlay').checked,
        fps: $('#focusFps').checked,
      },
    });
    $('#steamKey').value = '';
    $('#settings').close();
    state.settings = await window.api.basicSettings();
    toast('Ajustes guardados.');
    refresh();
  } catch (e) {
    toast(errMsg(e), true);
  }
}

// ---------- eventos ----------
function onCardClick(e) {
  const c = e.target.closest('.card');
  if (!c) return;
  const g = findGame(c.dataset.id);
  const b = e.target.closest('button[data-act]');
  if (!g) return;
  if (!b) return openGame(g);
  if (b.dataset.act === 'store') return window.api.open(g.storeUrl);
  launch(g);
}
function onCardDblClick(e) {
  const c = e.target.closest('.card');
  const g = c && findGame(c.dataset.id);
  if (g?.installed) launch(g);
}

function bind() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  let qTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = e.target.value;
      renderLibrary();
    }, 120);
  });
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    savePrefs();
    renderLibrary();
  });
  $('#status').addEventListener('change', (e) => {
    state.status = e.target.value;
    savePrefs();
    renderLibrary();
  });
  $('#tag').addEventListener('change', (e) => {
    state.tag = e.target.value;
    savePrefs();
    renderLibrary();
  });
  for (const [sel, key] of [['#storeSeg', 'store'], ['#instSeg', 'inst']]) {
    $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state[key] = b.dataset.v;
      savePrefs();
      syncControls();
      renderLibrary();
    });
  }
  $('#onlyUpdates').addEventListener('click', () => toggleChip('onlyUpd'));
  $('#onlyNew').addEventListener('click', () => toggleChip('onlyNew'));
  $('#showTools').addEventListener('click', () => toggleChip('showTools'));
  $('#refreshBtn').addEventListener('click', refresh);
  $('#focusBtn').addEventListener('click', onFocusClick);
  $('#pickBtn').addEventListener('click', openPick);
  $('#recsRefresh').addEventListener('click', () => loadRecs(true));
  window.api.onGwishProgress((t) => {
    gi.wishBusy = t;
    if (gi.tab === 'deseos') renderGenshin();
  });
  window.api.onGquestsPending(async () => {
    const p = await window.api.gquestsPending();
    if (p?.quests?.length) {
      gi.found = p;
      if (!gi.tasks) gi.tasks = await window.api.gtasks();
      renderGenshin();
    }
  });
  $('#gameDlg').addEventListener('close', stopTrailer);
  for (const b of $$('#themeSeg button')) b.addEventListener('click', () => setTheme(b.dataset.v));
  $('#bgGame').addEventListener('change', (e) => setBackground(e.target.value));
  // Color a tu gusto: se ve al momento y se guarda al soltar
  for (const id of ['customAccent', 'customHue', 'customSat']) {
    const el = $(`#${id}`);
    const val = () => (id === 'customAccent' ? el.value : Number(el.value));
    el.addEventListener('input', () => applyAppearance({ ...state.settings, palette: 'custom', [id]: val() }));
    el.addEventListener('change', () => saveAppearance({ palette: 'custom', [id]: val() }));
  }
  $('#exportCsv').addEventListener('click', () => exportLibrary('csv'));
  $('#exportHtml').addEventListener('click', () => exportLibrary('html'));
  // Enter sobre una carátula abre su ficha (teclado y mando)
  for (const id of ['#grid', '#sagaGrid']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.classList.contains('card')) return;
      const g = findGame(e.target.dataset.id);
      if (g) openGame(g);
    });
  }
  $('#setTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showSettingsTab(b.dataset.tab);
  });
  $('#welcomeDlg').addEventListener('cancel', (e) => e.preventDefault());
  $('#newsRefresh').addEventListener('click', () => loadNews(true));
  $('#friendsRefresh').addEventListener('click', loadFriends);
  // Búsqueda rápida: Ctrl+K desde cualquier sitio
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#palette').hidden ? openPalette() : closePalette();
    } else if (e.key === 'Escape' && !$('#palette').hidden) closePalette();
  });
  $('#palette').addEventListener('click', (e) => {
    if (e.target.id === 'palette') closePalette();
  });
  $('#palInput').addEventListener('input', (e) => {
    palIndex = 0;
    renderPalette(e.target.value);
  });
  $('#palInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      palIndex = (palIndex + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
      renderPaletteSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPalette(palIndex, e.shiftKey);
    }
  });
  $('#exportData').addEventListener('click', async () => {
    try {
      const r = await window.api.exportData();
      if (r) $('#dataState').textContent = `Exportado: ${plural(r.games, 'juego', 'juegos')} con datos y ${plural(r.sessions, 'sesión', 'sesiones')}.`;
    } catch (e) {
      $('#dataState').textContent = errMsg(e);
    }
  });
  $('#importData').addEventListener('click', async () => {
    try {
      const r = await window.api.importData();
      if (!r) return;
      $('#dataState').textContent = `Importado: ${plural(r.games, 'juego', 'juegos')} y ${plural(r.sessions, 'sesión', 'sesiones')}.`;
      state.user = (await window.api.userGames()) || {};
      await loadSessions();
      renderAll();
    } catch (e) {
      $('#dataState').textContent = errMsg(e);
    }
  });
  window.api.onSessionEnded((s) => {
    const parts = [fmtHours(Math.round(s.minutes))];
    if (s.fps) parts.push(`${Math.round(s.fps)} FPS de media`);
    if (s.unlocks) parts.push(plural(s.unlocks, 'logro', 'logros'));
    if (s.backup) parts.push('partidas copiadas');
    toast(`Partida terminada: ${s.title}. ${parts.join(', ')}.`);
  });
  window.api.onSession(async () => {
    await loadSessions();
    if (state.view === 'stats') {
      renderStats();
      renderStatsExtra();
    }
    if (openGameId && $('#gameDlg').open) fillGameSessions(findGame(openGameId));
  });
  $('#achRefresh').addEventListener('click', () => loadAchievements(true));
  $('#achBack').addEventListener('click', () => {
    ach.detail = null;
    renderAchievements();
  });
  $('#achSort').addEventListener('change', (e) => {
    ach.sort = e.target.value;
    renderAchievements();
  });
  $('#achFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ach.filter = b.dataset.v;
    for (const x of $$('#achFilter button')) x.classList.toggle('on', x === b);
    renderAchievements();
  });
  $('#achTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ach.tab = b.dataset.v;
    renderAchDetail();
  });
  window.api.onUnlocked((d) => {
    toast(d.achievements.length === 1 ? `Logro conseguido: ${d.achievements[0].name}` : `${d.achievements.length} logros nuevos`);
    if (ach.summary?.games?.[d.appid]) ach.summary.games[d.appid].at = 0; // se vuelve a leer
  });
  window.api.onAchProgress((p) => {
    ach.progress = p;
    if (state.view === 'ach' && !ach.detail) renderAchievements();
  });
  $('#focusClose').addEventListener('click', () => $('#focusDlg').close());
  $('#focusDlg').addEventListener('close', stopPerfPolling);
  $('#focusStop').addEventListener('click', async () => {
    state.focus = await window.api.focusStop();
    $('#focusDlg').close();
    renderFocus();
    toast('Modo enfoque desactivado: todo vuelve a como estaba.');
  });
  window.api.onFocus((s) => {
    state.focus = s;
    renderFocus();
  });

  for (const id of ['#grid', '#sagaGrid']) {
    $(id).addEventListener('click', onCardClick);
    $(id).addEventListener('dblclick', onCardDblClick);
  }
  $('#sagaBack').addEventListener('click', () => {
    state.saga = null;
    renderSagas();
  });

  $('#country').addEventListener('change', async (e) => {
    state.country = e.target.value;
    await window.api.saveSettings({ country: state.country });
    state.deals = null;
    renderDeals();
    loadDeals(false);
  });
  $('#showAllWish').addEventListener('change', (e) => {
    state.showAllWish = e.target.checked;
    renderDeals();
  });
  $('#dealsRefresh').addEventListener('click', () => {
    state.deals = null;
    renderDeals();
    loadDeals(false);
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#closeSettings').addEventListener('click', () => $('#settings').close());
  $('#clearKey').addEventListener('click', async () => {
    await window.api.saveSettings({ clearSteamKey: true });
    $('#keyState').replaceChildren(h('b', { class: 'bad', text: ' Clave borrada.' }));
  });
  $('#pickLegendary').addEventListener('click', async () => {
    const s = await window.api.pickLegendary();
    if (s) $('#legendaryPath').value = s.legendaryPath;
  });
  $('#linkEpic').addEventListener('click', async () => {
    try {
      await window.api.saveSettings({ legendaryPath: $('#legendaryPath').value });
      await window.api.linkEpic();
      toast('Se ha abierto legendary: inicia sesión en Epic y pega el código en esa ventana. Después pulsa Actualizar.');
    } catch (e) {
      toast(errMsg(e), true);
    }
  });
  $('#importPurch').addEventListener('click', async () => {
    $('#purchState').textContent = 'Esperando a que inicies sesión en la ventana de Steam…';
    try {
      state.lib = await window.api.importPurchases();
      const i = state.lib.purchaseInfo;
      $('#purchState').textContent = `Listo: ${plural(i.games, 'juego', 'juegos')} con fecha de compra.`;
      renderAll();
    } catch (e) {
      $('#purchState').textContent = errMsg(e);
    }
  });
}

// ---------- arranque ----------
(async function init() {
  bind();
  bindTips();
  syncControls();
  renderLibrary();
  const [lib, deals, settings] = await Promise.all([window.api.cachedLibrary(), window.api.cachedDeals(), window.api.basicSettings()]);
  state.lib = lib;
  state.country = settings.country || 'CL';
  state.settings = settings;
  applyAppearance(settings);
  window.api.wandInstalled().then((v) => (state.wand = v)).catch(() => {});
  if (!settings.onboarded) {
    if (settings.hasSteamKey) window.api.saveSettings({ onboarded: true });
    else setTimeout(openWelcome, 300);
  }
  state.user = (await window.api.userGames()) || {};
  await loadSessions();
  state.focus = await window.api.focusStatus();
  ach.summary = await window.api.achCached();
  if (ach.summary) $('#countPlat').textContent = achRows().filter((r) => r.done === r.total).length || '';
  renderFocus();
  // Si los precios guardados son de otra región, no se muestran hasta recargar
  state.deals = deals && (deals.country || 'ES') === state.country ? deals : null;
  renderAll();
  renderDeals();
  refresh(); // lectura fresca al abrir; mientras tanto se ve la caché
})();

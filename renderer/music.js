'use strict';
// Spotify dentro de ViperTeca: tus playlists, "Me gusta", lo que más escuchas,
// sugerencias y una barra de reproducción. La música suena en tu app de Spotify
// (Spotify Connect); desde aquí la eliges y la controlas.
(function () {
  const S = { status: null, me: null, playlists: null, page: 'home', home: null, tracks: {}, player: null, devices: null, busy: false, error: null, likedIds: {}, poll: null };
  const sp = window.api.sp;
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const visible = () => !$('#musicView').hidden;

  async function show() {
    if (!S.status) S.status = await sp.status();
    render();
    if (S.status.linked && !S.me) await loadAll();
    startPolling();
  }

  async function loadAll() {
    S.busy = true;
    render();
    try {
      [S.me, S.playlists] = await Promise.all([sp.me(), sp.playlists()]);
      S.error = null;
      if (S.page === 'home' && !S.home) S.home = await sp.home();
    } catch (e) {
      S.error = errMsg(e);
      S.status = await sp.status();
    }
    S.busy = false;
    render();
    pollNow();
  }

  async function openPage(page) {
    S.page = page;
    render();
    $('#scroller').scrollTo({ top: 0 });
    try {
      if (page === 'home' && !S.home) S.home = await sp.home();
      else if (page !== 'home' && !S.tracks[page]) S.tracks[page] = await sp.tracks(page);
      S.error = null;
    } catch (e) {
      S.error = errMsg(e);
    }
    render();
  }

  async function act(action, arg) {
    try {
      await sp.control(action, arg);
      setTimeout(pollNow, 350);
    } catch (e) {
      toast(errMsg(e), true);
    }
  }

  // ---- vista ----
  function render() {
    const box = $('#musicBody');
    if (!box || !visible()) return;
    const st = S.status;
    if (!st) return fill(box, h('p', { class: 'hint', text: 'Cargando…' }));
    if (!st.linked) return fill(box, setupView(st));
    if (!S.me && S.busy) return fill(box, h('div', { class: 'view-head' }, h('h1', { text: 'Spotify' })), skeletonDeals(4));
    fill(
      box,
      h(
        'div',
        { class: 'sp-wrap' },
        h(
          'aside',
          { class: 'sp-side', 'aria-label': 'Tu biblioteca de Spotify' },
          h('div', { class: 'sp-me' }, S.me?.avatar && h('img', { src: S.me.avatar, alt: '' }), h('div', {}, h('b', { text: S.me?.name || '' }), h('span', { class: S.me?.premium ? 'ok' : 'warn', text: S.me ? (S.me.premium ? 'Premium' : 'Gratis: solo para ver y abrir en Spotify') : '' }))),
          navBtn('home', 'Inicio', null),
          navBtn('liked', 'Canciones que te gustan', null, 'liked'),
          h('p', { class: 'sp-side-h', text: 'Tus playlists' }),
          (S.playlists || []).map((p) => navBtn(p.id, p.name, p.cover, null, p.owner))
        ),
        h('div', { class: 'sp-main' }, S.error && h('p', { class: 'hint bad', text: S.error }), S.page === 'home' ? homeView() : listView(S.page))
      )
    );
  }

  function navBtn(page, name, cover, special, sub) {
    return h(
      'button',
      { class: `sp-nav${S.page === page ? ' on' : ''}`, onclick: () => openPage(page), title: name },
      special === 'liked' ? h('span', { class: 'sp-liked-ico', 'aria-hidden': 'true', text: '♥' }) : cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : page === 'home' ? h('span', { class: 'sp-home-ico', 'aria-hidden': 'true', text: '⌂' }) : h('span', { class: 'sp-liked-ico' }),
      h('span', { class: 'sp-nav-txt' }, h('b', { text: name }), sub && h('small', { text: sub }))
    );
  }

  function setupView(st) {
    const input = h('input', { type: 'text', class: 'gi-uid sp-client', value: st.clientId || '', placeholder: 'Client ID (32 caracteres)', maxLength: 32, 'aria-label': 'Client ID de tu app de Spotify' });
    const go = async () => {
      try {
        await sp.setClient(input.value);
        S.status = await sp.status();
        if (!S.status.clientId) return toast('Pega el Client ID primero.', true);
        toast('Se abrió Spotify en tu navegador: acepta el acceso y vuelve aquí.');
        await sp.login();
        S.status = await sp.status();
        await loadAll();
      } catch (e) {
        toast(errMsg(e), true);
      }
    };
    return [
      h('div', { class: 'view-head' }, h('h1', { text: 'Spotify' }), h('p', { class: 'sub', text: 'Tus playlists, tus canciones y sugerencias según lo que escuchas, y control de la música sin salir de ViperTeca. Suena en tu app de Spotify; para controlarla hace falta Premium.' })),
      h(
        'ol',
        { class: 'steps sp-steps' },
        h('li', {}, h('b', { text: 'Crea tu app de Spotify (una vez, gratis).' }), h('span', {}, 'Entra en ', h('button', { class: 'link-btn', text: 'developer.spotify.com/dashboard', onclick: () => window.api.open('https://developer.spotify.com/dashboard') }), ' con tu cuenta, pulsa «Create app», ponle de nombre ViperTeca, marca «Web API» y en «Redirect URIs» añade exactamente:', h('code', { class: 'path', text: st.redirect }))),
        h('li', {}, h('b', { text: 'Copia el Client ID' }), h('span', { text: 'de esa app (en «Settings») y pégalo aquí. No es secreto y no hace falta el «Client secret».' })),
        h('li', {}, h('b', { text: 'Pulsa «Vincular cuenta».' }), h('span', { text: 'Spotify se abre en tu navegador, aceptas y listo. La app no ve tu contraseña y guarda el acceso cifrado con tu usuario de Windows.' }))
      ),
      h('div', { class: 'row' }, input, h('button', { class: 'btn primary', text: 'Vincular cuenta', onclick: go }))
    ];
  }

  function trackRow(t, i, playArgs) {
    const cur = S.player?.track?.id === t.id;
    return h(
      'li',
      { class: `sp-row${cur ? ' now' : ''}` },
      h('button', { class: 'sp-row-play', title: `Reproducir ${t.name}`, onclick: () => act('play', playArgs(t)) }, h('span', { class: 'sp-num', text: cur && S.player?.playing ? '♪' : String(i + 1) }), h('span', { class: 'sp-play-ico', text: '▶' })),
      h('span', { class: 'sp-title' }, t.cover && h('img', { src: t.cover, alt: '', loading: 'lazy' }), h('span', {}, h('b', { text: t.name }), h('small', {}, t.explicit && h('i', { class: 'sp-e', text: 'E' }), t.artists))),
      h('span', { class: 'sp-album', text: t.album }),
      h('span', { class: 'sp-dur', text: fmt(t.ms) })
    );
  }

  function listView(page) {
    const isLiked = page === 'liked';
    const pl = isLiked ? { name: 'Canciones que te gustan', owner: S.me?.name, cover: null } : (S.playlists || []).find((p) => p.id === page);
    const tracks = S.tracks[page];
    const args = (t) => (isLiked ? { uris: tracks.slice(tracks.indexOf(t), tracks.indexOf(t) + 100).map((x) => x.uri) } : { context: pl.uri, offset: t.uri });
    return [
      h(
        'header',
        { class: 'sp-head' },
        pl?.cover ? h('img', { src: pl.cover, alt: '' }) : h('div', { class: 'sp-liked-big', text: '♥' }),
        h(
          'div',
          {},
          h('p', { class: 'hero-kicker', text: isLiked ? 'Tu biblioteca' : 'Playlist' }),
          h('h1', { text: pl?.name || '' }),
          pl?.description && h('p', { class: 'sub', text: pl.description }),
          h('p', { class: 'hint', text: `${pl?.owner || ''}${tracks ? `, ${tracks.length} canciones, ${Math.round(tracks.reduce((s, t) => s + t.ms, 0) / 60000)} min` : ''}` }),
          tracks?.length > 0 && h('div', { class: 'row' }, h('button', { class: 'btn primary sp-big-play', text: '▶ Reproducir', onclick: () => act('play', isLiked ? { uris: tracks.slice(0, 100).map((x) => x.uri) } : { context: pl.uri }) }), h('button', { class: 'btn ghost', text: 'Aleatorio', onclick: async () => { await act('shuffle', { value: true }); act('play', isLiked ? { uris: tracks.slice(0, 100).map((x) => x.uri) } : { context: pl.uri }); } }), !isLiked && h('button', { class: 'btn ghost subtle', text: 'Abrir en Spotify', onclick: () => window.api.open(pl.uri) }))
        )
      ),
      !tracks ? h('p', { class: 'hint', text: 'Cargando canciones…' }) : tracks.length ? h('ol', { class: 'sp-list' }, h('li', { class: 'sp-row sp-row-h' }, h('span', { text: '#' }), h('span', { text: 'Título' }), h('span', { text: 'Álbum' }), h('span', { text: 'Duración' })), tracks.map((t, i) => trackRow(t, i, args))) : h('p', { class: 'hint', text: 'Esta playlist está vacía.' }),
    ];
  }

  function homeView() {
    const d = S.home;
    if (!d) return [h('div', { class: 'view-head' }, h('h1', { text: 'Inicio' })), skeletonDeals(4)];
    const hour = new Date().getHours();
    const hello = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
    const quick = (S.playlists || []).slice(0, 6);
    return [
      h('h1', { class: 'sp-hello', text: hello }),
      quick.length > 0 && h('div', { class: 'sp-quick' }, quick.map((p) => h('button', { class: 'sp-quick-item', onclick: () => openPage(p.id) }, p.cover && h('img', { src: p.cover, alt: '' }), h('b', { text: p.name }), h('span', { class: 'sp-quick-play', title: `Reproducir ${p.name}`, text: '▶', onclick: (e) => { e.stopPropagation(); act('play', { context: p.uri }); } })))),
      d.forYou.length > 0 && [
        h('div', { class: 'sp-sec-head' }, h('h2', { class: 'section-h', text: 'Para ti' }), h('button', { class: 'btn ghost small', text: 'Reproducir todo', onclick: () => act('play', { uris: d.forYou.map((t) => t.uri) }) })),
        h('p', { class: 'hint', text: 'Lo más escuchado de tus artistas favoritos que aún no está entre lo que más oyes.' }),
        h('div', { class: 'sp-cards' }, d.forYou.slice(0, 18).map((t) => h('button', { class: 'sp-card', onclick: () => act('play', { uris: d.forYou.map((x) => x.uri), offset: t.uri }) }, h('span', { class: 'sp-card-art' }, t.cover && h('img', { src: t.cover, alt: '', loading: 'lazy' }), h('i', { text: '▶' })), h('b', { text: t.name }), h('small', { text: `${t.artists}` }), h('small', { class: 'sp-because', text: `Porque escuchas a ${t.because}` })))),
      ],
      d.artists.length > 0 && [h('h2', { class: 'section-h', text: 'Tus artistas' }), h('div', { class: 'sp-artists' }, d.artists.map((a) => h('button', { class: 'sp-artist', onclick: () => act('play', { context: a.uri }), title: `Reproducir ${a.name}` }, a.image && h('img', { src: a.image, alt: '', loading: 'lazy' }), h('b', { text: a.name }), h('small', { text: a.genres.join(', ') }))))],
      d.topTracks.length > 0 && [h('h2', { class: 'section-h', text: 'Lo que más escuchas este mes' }), h('ol', { class: 'sp-list' }, d.topTracks.slice(0, 15).map((t, i) => trackRow(t, i, (x) => ({ uris: d.topTracks.map((y) => y.uri), offset: x.uri }))))],
      d.recentTracks.length > 0 && [h('h2', { class: 'section-h', text: 'Escuchado hace poco' }), h('ol', { class: 'sp-list' }, d.recentTracks.slice(0, 15).map((t, i) => trackRow(t, i, (x) => ({ uris: [x.uri] }))))],
    ];
  }

  // ---- barra de reproducción ----
  function renderBar() {
    const bar = $('#spBar');
    const p = S.player;
    if (!S.status?.linked || !p?.active || !p.track) {
      bar.hidden = true;
      document.body.classList.remove('has-spbar');
      $('#countMusic').textContent = '';
      return;
    }
    bar.hidden = false;
    document.body.classList.add('has-spbar');
    $('#countMusic').textContent = p.playing ? '♪' : '';
    const t = p.track;
    const pos = Math.min(t.ms, p.progress + (p.playing ? Date.now() - p.at : 0));
    const liked = S.likedIds[t.id];
    const seek = h('input', { type: 'range', class: 'sp-seek', min: 0, max: t.ms, value: pos, 'aria-label': 'Posición' });
    seek.addEventListener('change', () => act('seek', { ms: Number(seek.value) }));
    const vol = h('input', { type: 'range', class: 'sp-vol', min: 0, max: 100, value: p.device?.volume ?? 50, 'aria-label': 'Volumen' });
    vol.addEventListener('change', () => act('volume', { value: Number(vol.value) }));
    const devSel = h('select', { class: 'sp-dev', 'aria-label': 'Dónde suena', title: 'Dónde suena', onfocus: loadDevices, onchange: (e) => act('transfer', { device: e.target.value }) }, (S.devices || (p.device ? [p.device] : [])).map((d) => h('option', { value: d.id, text: d.name, selected: d.id === p.device?.id })));
    fill(
      bar,
      h('div', { class: 'sp-bar-track' }, t.cover && h('img', { src: t.cover, alt: '' }), h('div', {}, h('b', { text: t.name }), h('small', { text: t.artists })), h('button', { class: `sp-like${liked ? ' on' : ''}`, title: liked ? 'Quitar de Me gusta' : 'Añadir a Me gusta', 'aria-pressed': String(!!liked), text: liked ? '♥' : '♡', onclick: async () => { await act('like', { id: t.id, value: !liked }); S.likedIds[t.id] = !liked; renderBar(); } })),
      h(
        'div',
        { class: 'sp-bar-mid' },
        h(
          'div',
          { class: 'sp-ctrls' },
          h('button', { class: `sp-ic${p.shuffle ? ' on' : ''}`, title: 'Aleatorio', 'aria-pressed': String(p.shuffle), text: '⤨', onclick: () => act('shuffle', { value: !p.shuffle }) }),
          h('button', { class: 'sp-ic', title: 'Anterior', text: '⏮', onclick: () => act('prev') }),
          h('button', { class: 'sp-ic sp-pp', title: p.playing ? 'Pausa' : 'Reproducir', text: p.playing ? '❚❚' : '▶', onclick: () => act(p.playing ? 'pause' : 'play') }),
          h('button', { class: 'sp-ic', title: 'Siguiente', text: '⏭', onclick: () => act('next') }),
          h('button', { class: `sp-ic${p.repeat !== 'off' ? ' on' : ''}`, title: p.repeat === 'track' ? 'Repetir canción' : p.repeat === 'context' ? 'Repetir todo' : 'Repetir', text: p.repeat === 'track' ? '↻1' : '↻', onclick: () => act('repeat', { value: p.repeat === 'off' ? 'context' : p.repeat === 'context' ? 'track' : 'off' }) })
        ),
        h('div', { class: 'sp-progress' }, h('small', { class: 'sp-pos', text: fmt(pos) }), seek, h('small', { text: fmt(t.ms) }))
      ),
      h('div', { class: 'sp-bar-right' }, h('span', { class: 'sp-dev-ico', 'aria-hidden': 'true', text: '🔈' }), vol, devSel)
    );
  }

  async function loadDevices() {
    try {
      S.devices = await sp.devices();
    } catch {}
  }

  async function pollNow() {
    if (!S.status?.linked) return;
    try {
      const prev = S.player?.track?.id;
      S.player = await sp.state();
      if (S.player?.track && S.player.track.id !== prev && S.likedIds[S.player.track.id] === undefined) {
        const [v] = await sp.liked([S.player.track.id]).catch(() => [false]);
        S.likedIds[S.player.track.id] = !!v;
      }
    } catch {
      S.player = null;
    }
    renderBar();
    if (visible()) {
      // Marca la canción que suena en las listas
      for (const r of document.querySelectorAll('.sp-row.now')) r.classList.remove('now');
    }
  }

  // Consulta el estado cada 5 s mientras la ventana está a la vista; la barra
  // avanza sola cada segundo entre consultas.
  function startPolling() {
    if (S.poll) return;
    S.poll = setInterval(() => {
      if (document.visibilityState === 'visible') pollNow();
    }, 5000);
    setInterval(() => {
      const p = S.player;
      if (!p?.playing || !p.track || $('#spBar').hidden) return;
      const pos = Math.min(p.track.ms, p.progress + (Date.now() - p.at));
      const seek = $('#spBar .sp-seek');
      if (seek && document.activeElement !== seek) seek.value = pos;
      const lbl = $('#spBar .sp-pos');
      if (lbl) lbl.textContent = fmt(pos);
    }, 1000);
  }

  // Al abrir la app, si Spotify está vinculado, enseñar la barra
  sp.status().then((st) => {
    S.status = st;
    if (st.linked) {
      startPolling();
      pollNow();
    }
  });

  window.music = { show, pollNow };
})();

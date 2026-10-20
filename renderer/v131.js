'use strict';
// 1.31: Casa → Televisores: encender, apagar, volumen, silencio, pausa y qué se ve.
(function () {
  const T = { list: null, busy: false, asked: false, pairing: null, hooked: false };
  const rr = () => window.casaUI?.show?.();
  async function load(scan) {
    T.asked = true;
    T.busy = true;
    rr();
    try {
      T.list = scan ? await window.api.tv.scan() : await window.api.tv.list();
    } catch (e) {
      toast(errMsg(e), true);
    }
    T.busy = false;
    rr();
  }
  async function cmd(t, what, arg) {
    try {
      await window.api.tv.cmd(t.id, what, arg);
      setTimeout(() => load(false), what === 'on' || what === 'off' ? 4000 : 800);
    } catch (e) {
      toast(errMsg(e), true);
    }
  }
  async function pair(t) {
    try {
      await window.api.tv.pairStart(t.host);
    } catch (e) {
      return toast(errMsg(e), true);
    }
    const input = h('input', { class: 'rx-input tv-code', maxlength: 6, placeholder: 'A1B2C3', autocomplete: 'off', spellcheck: false });
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg' });
    const go = async () => {
      try {
        await window.api.tv.pairFinish(t.host, input.value);
        toast(t.label + ' vinculado.');
        dlg.close();
        setTimeout(() => load(false), 1500);
      } catch (e) {
        toast(errMsg(e), true);
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    dlg.append(h('h2', { text: 'Vincular ' + t.label }), h('p', { class: 'hint', text: 'En la pantalla del televisor salió un código de 6 caracteres. Escríbelo aquí (solo se hace una vez).' }), input, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', text: 'Cancelar', onclick: () => dlg.close() }), h('button', { class: 'btn primary', text: 'Vincular', onclick: go })));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  }
  const ICON = {
    power: '<path d="M12 3v8"/><path d="M6.5 6.5a8 8 0 1 0 11 0"/>',
    voldown: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 12h5"/>',
    volup: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 12h5M18 9.5v5"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    playpause: '<path d="M6 5.5v13l7-6.5z"/><path d="M16 6v12M20 6v12"/>',
    home: '<path d="M4 11l8-6.5 8 6.5v8.5h-5v-5h-6v5H4z"/>',
  };
  const ib = (name, label, on, cls = '') => {
    const b = h('button', { class: 'tv-btn ' + cls, title: label, 'aria-label': label, onclick: on });
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';
    return b;
  };
  const APPS = [['Netflix', 'https://www.netflix.com/title'], ['YouTube', 'https://www.youtube.com'], ['Crunchyroll', 'https://www.crunchyroll.com'], ['Spotify', 'spotify:'], ['Disney+', 'https://www.disneyplus.com'], ['Max', 'https://play.max.com']];
  function card(t) {
    const st = t.state || {};
    const media = st.cast?.media;
    const castApp = st.cast?.apps?.find((a) => !a.idle);
    const on = st.connected ? st.on !== false : st.reachable ? null : false;
    const vol = st.volume || (st.cast?.volume ? { level: st.cast.volume.level, max: 100, muted: st.cast.volume.muted } : null);
    const playing = media?.title ? media.title + (media.subtitle ? ' · ' + media.subtitle : '') : castApp?.status && castApp.status !== castApp.name ? castApp.status : null;
    const slider = vol ? h('input', { type: 'range', class: 'tv-vol', min: 0, max: vol.max || 100, value: vol.level, 'aria-label': 'Volumen', onchange: (e) => cmd(t, 'vol', Number(e.target.value)) }) : null;
    return h('article', { class: 'tv-card' + (on ? ' on' : on === false ? ' off' : '') },
      h('header', {},
        h('div', {}, h('b', { text: t.label }), h('small', { class: 'hint', text: [t.model, t.host].filter(Boolean).join(' · ') })),
        h('span', { class: 'tv-dot', text: !t.paired ? 'Sin vincular' : st.connected ? (on ? 'Encendido' : 'En reposo') : st.reachable ? 'Conectando…' : 'Apagado' })
      ),
      h('div', { class: 'tv-now' },
        media?.image ? h('img', { src: media.image, alt: '', referrerPolicy: 'no-referrer' }) : h('span', { class: 'tv-now-ic', text: '▶' }),
        h('div', {},
          h('small', { class: 'hint', text: st.appName || castApp?.name || (on ? 'Pantalla de inicio' : '—') }),
          h('b', { text: playing || (on ? (st.appName ? 'Abierto: ' + st.appName : 'Nada reproduciéndose') : 'Apagado') }),
          media?.state ? h('small', { class: 'hint', text: media.state === 'PLAYING' ? 'Reproduciendo' : media.state === 'PAUSED' ? 'En pausa' : media.state.toLowerCase() }) : null
        )
      ),
      t.paired ? [
        h('div', { class: 'tv-ctrl' },
          ib('power', on ? 'Apagar' : 'Encender', () => cmd(t, on ? 'off' : 'on'), on ? 'pw on' : 'pw'),
          ib('voldown', 'Bajar volumen', () => cmd(t, 'voldown')),
          ib('volup', 'Subir volumen', () => cmd(t, 'volup')),
          ib('mute', vol?.muted ? 'Quitar silencio' : 'Silenciar', () => cmd(t, 'mute'), vol?.muted ? 'on' : ''),
          ib('playpause', 'Reproducir / pausa', () => cmd(t, 'playpause')),
          ib('home', 'Inicio', () => cmd(t, 'home'))
        ),
        vol ? h('label', { class: 'tv-vol-row' }, h('span', { text: 'Volumen ' + vol.level + (vol.muted ? ' (silencio)' : '') }), slider) : null,
        h('div', { class: 'tv-apps' }, APPS.map(([n, l]) => h('button', { class: 'btn subtle small', text: n, onclick: () => cmd(t, 'open', l) }))),
      ] : h('div', { class: 'tv-pair' }, h('p', { class: 'hint', text: 'Para controlarlo, vincúlalo una vez: el televisor tiene que estar encendido; mostrará un código.' }), h('button', { class: 'btn primary small', text: 'Vincular', onclick: () => pair(t) })),
      h('div', { class: 'tv-foot' },
        h('button', { class: 'link-btn', text: 'Cambiar nombre', onclick: () => window.casaForm?.('Nombre del televisor', [{ key: 'label', label: 'Nombre', value: t.label, placeholder: 'Sala, cuarto…' }], async (v) => { await window.api.tv.rename(t.id, v.label); load(false); }) }),
        h('button', { class: 'link-btn', text: 'Quitar', onclick: async () => { await window.api.tv.forget(t.id); load(false); } })
      )
    );
  }
  function televisores() {
    if (!T.hooked) {
      T.hooked = true;
      window.api.tv.onChanged(() => {
        clearTimeout(T.t);
        T.t = setTimeout(() => load(false), 600);
      });
    }
    if (!T.asked) setTimeout(() => load(true), 0);
    const list = T.list || [];
    return [
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn ghost small', disabled: T.busy, text: T.busy ? 'Buscando…' : 'Buscar televisores', onclick: () => load(true) }),
        h('span', { class: 'hint', text: 'Televisores con Google TV o Android TV en la wifi de casa (como los TCL). Para encenderlos desde aquí, activa en el televisor Ajustes → Sistema → Energía → «Encender con Chromecast / red».' })
      ),
      list.length ? h('div', { class: 'tv-grid' }, list.map(card)) : h('p', { class: 'empty' }, h('b', { text: T.busy ? 'Buscando…' : 'No encontré televisores' }), 'Enciende el televisor, conéctalo a la misma wifi que este PC y pulsa «Buscar televisores».'),
    ];
  }
  window.v131 = { televisores };
})();

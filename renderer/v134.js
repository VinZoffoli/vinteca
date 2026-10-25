'use strict';
// 1.34: «En el televisor»: el juego corre en el PC y se juega en la tele con el control.
// Steam → Steam Link en la tele; Epic y los demás → Sunshine en el PC + Moonlight en la tele.
(function () {
  const SUNSHINE = 'https://github.com/LizardByte/Sunshine/releases/latest';
  const STEP = (ok, title, body, action) => h('li', { class: 'ptv-step' + (ok === true ? ' ok' : ok === false ? ' todo' : '') },
    h('span', { class: 'ptv-dot', 'aria-hidden': 'true', text: ok === true ? '✓' : ok === false ? '!' : '·' }),
    h('div', {}, h('b', { text: title }), body ? h('p', { class: 'hint', text: body }) : null, action || null));

  async function playOnTv(g) {
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide ptv' });
    const body = h('div', { class: 'ptv-body' }, h('p', { class: 'hint', text: 'Buscando el televisor en la red de casa…' }));
    dlg.append(h('h2', { text: g.title + ' en el televisor' }), body);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    const isSteam = g.store === 'steam';
    let hooked = false;

    async function render(st) {
      if (!st) {
        body.replaceChildren(h('p', { class: 'hint', text: 'Buscando el televisor en la red de casa…' }));
        try {
          st = await window.api.playTv.status();
        } catch (e) {
          return body.replaceChildren(h('p', { class: 'bad-t', text: errMsg(e) }));
        }
      }
      const tvPick = h('select', { class: 'sn-select', 'aria-label': 'Televisor' }, h('option', { value: '', text: 'Elige el televisor…' }), st.tvs.map((t) => h('option', { value: t.id, selected: st.tv?.id === t.id, text: t.label + ' · ' + t.host })));
      tvPick.addEventListener('change', async () => {
        await window.api.playTv.choose(tvPick.value);
        render();
      });
      const ipIn = h('input', { class: 'rx-input', placeholder: 'IP, por ejemplo 192.168.50.121', 'aria-label': 'IP del televisor' });
      const nameIn = h('input', { class: 'rx-input', placeholder: 'Nombre (Habitación…)', 'aria-label': 'Nombre del televisor' });
      const addRow = h('div', { class: 'ptv-add' }, ipIn, nameIn, h('button', { class: 'btn ghost small', text: 'Añadir', onclick: async () => { try { await window.api.playTv.add(ipIn.value, nameIn.value || 'Televisor'); render(); } catch (e) { toast(errMsg(e), true); } } }));
      const storeBtn = (which, label) => h('button', { class: 'btn subtle small', text: 'Abrir ' + label + ' en la Play Store del televisor', onclick: async (e) => { e.currentTarget.disabled = true; try { await window.api.playTv.openStore(st.tv.id, which); toast('Mira el televisor: pulsa «Instalar» y vuelve aquí.'); } catch (er) { toast(errMsg(er), true); } e.currentTarget.disabled = false; } });
      const br = await window.api.playTv.bridge().catch(() => ({ status: 'off' }));
      if (!hooked) {
        hooked = true;
        window.api.playTv.onBridge?.(() => dlg.open && render(st));
      }
      const need = isSteam ? (st.steamlink || (st.moonlight && st.sunshine)) : (st.moonlight && st.sunshine);
      const ready = st.tv && st.adb && need;
      body.replaceChildren(
        h('label', { class: 'ks-field' }, h('span', { text: 'Televisor' }), tvPick),
        h('details', { class: 'ptv-more', open: !st.tvs.length }, h('summary', { text: '¿No está en la lista? Añádelo por su IP' }), addRow),
        h('ol', { class: 'ptv-steps' },
          STEP(st.tv ? st.adb : null, 'Conexión con el televisor', st.adb === false ? (st.adbError || 'No responde.') + ' Si en la tele sale «¿Permitir la depuración?», marca «Permitir siempre» y acepta.' : st.adb ? 'Lista (por ADB en la red de casa).' : 'Elige el televisor arriba.'),
          isSteam ? STEP(st.adb ? st.steamlink : null, 'Steam Link en el televisor', st.steamlink ? 'Instalado. La primera vez elige este PC en la tele y escribe el PIN que te muestra Steam aquí.' : 'Con Steam Link el juego de Steam se ve en la tele y el control le llega al PC.', st.adb && !st.steamlink ? storeBtn('steamlink', 'Steam Link') : null) : null,
          !isSteam || !st.steamlink ? STEP(st.adb ? st.moonlight : null, 'Moonlight en el televisor', st.moonlight ? 'Instalado. La primera vez elige este PC y escribe en Sunshine el PIN que sale en la tele.' : 'Para Epic y los demás juegos (y para Steam, si no usas Steam Link).', st.adb && !st.moonlight ? storeBtn('moonlight', 'Moonlight') : null) : null,
          !isSteam || !st.steamlink ? STEP(st.sunshine, 'Sunshine en este PC', st.sunshine ? 'Abierto. Para vincular Moonlight: abre su página, pestaña PIN.' : 'Es el programa que transmite la pantalla del PC a Moonlight. Descárgalo e instálalo tú; al abrirlo te pide crear un usuario y una contraseña propios.', h('div', { class: 'row' }, st.sunshine ? h('button', { class: 'btn subtle small', text: 'Abrir Sunshine (PIN)', onclick: () => window.api.open('https://localhost:47990/pin') }) : h('button', { class: 'btn subtle small', text: 'Página de descarga de Sunshine', onclick: () => window.api.open(SUNSHINE) }))) : null,
          STEP(br.status === 'on' ? true : br.status === 'error' ? false : null, 'Control (todos los botones)',
            br.status === 'on' ? 'Puente activo: ' + (br.pad || 'el control') + ' de la tele llega al PC con todos sus botones, R1 incluido.'
              : br.status === 'error' ? br.error
              : br.status === 'off' ? 'El televisor se queda el R1 del control. El puente lo lee directo en la tele y lo pasa al PC, así funcionan todos los botones. Se enciende solo al jugar.'
              : (br.error || 'Buscando el control en la tele…') + ' Para vincularlo: en la tele, Ajustes → Control remoto y accesorios → Vincular accesorio, y en el control mantén PS + Create.',
            h('div', { class: 'row' }, br.status === 'off' ? h('button', { class: 'btn subtle small', text: 'Encender el puente', onclick: async () => { await window.api.playTv.bridge(true); render(st); } }) : h('button', { class: 'btn subtle small', text: 'Apagar el puente', onclick: async () => { await window.api.playTv.bridge(false); render(st); } })))
        ),
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', text: 'Revisar de nuevo', onclick: () => render() }),
          h('button', { class: 'btn ghost', text: 'Cerrar', onclick: () => dlg.close() }),
          h('button', { class: 'btn primary', disabled: !ready, text: ready ? 'Jugar en ' + st.tv.label : 'Falta algo arriba', onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            b.textContent = 'Abriendo…';
            try {
              const r = await window.api.playTv.play(g.id, st.tv.id);
              toast(r.method === 'steamlink' ? g.title + ' se abrió en el PC y Steam Link en ' + r.tv + '.' : g.title + ' se abrió en el PC. En ' + r.tv + ', Moonlight: elige este PC y luego «Desktop».');
              dlg.close();
            } catch (er) {
              toast(errMsg(er), true);
              b.disabled = false;
              b.textContent = 'Jugar en ' + st.tv.label;
            }
          } })
        )
      );
    }
    render();
  }
  window.playOnTv = playOnTv;
})();

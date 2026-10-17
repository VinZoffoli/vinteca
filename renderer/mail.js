'use strict';
// ViperTech → Email: correos nuevos del buzón de Hostinger.
(function () {
  const api = window.api.mail;
  const M = { acc: null, data: null, busy: false, error: null, filter: 'all', setup: false };

  async function show(force) {
    M.acc = await api.account();
    if (!M.acc.hasPassword) return render();
    if (!M.data || force) {
      M.busy = true;
      M.error = null;
      render();
      try {
        M.data = await api.inbox(!!force);
      } catch (e) {
        M.error = errMsg(e);
      }
      M.busy = false;
    }
    render();
    updateBadge();
  }
  function updateBadge() {
    const el = document.getElementById('countMail');
    if (el) el.textContent = M.data?.unread ? String(M.data.unread) : '';
  }
  api.onChanged((d) => {
    M.data = d;
    updateBadge();
    if (!$('#mailView').hidden) render();
  });

  function setupForm() {
    const a = M.acc;
    const user = h('input', { class: 'rx-input', value: a.user, autocomplete: 'username' });
    const pass = h('input', { class: 'rx-input', type: 'password', autocomplete: 'current-password', placeholder: a.hasPassword ? 'Déjala vacía para no cambiarla' : 'Contraseña del buzón' });
    const host = h('input', { class: 'rx-input', value: a.host });
    const port = h('input', { class: 'rx-input', type: 'number', value: a.port });
    const save = async () => {
      try {
        M.acc = await api.setAccount({ user: user.value, password: pass.value, host: host.value, port: port.value });
        pass.value = '';
        M.setup = false;
        show(true);
      } catch (e) {
        toast(errMsg(e), true);
      }
    };
    pass.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    return h('div', { class: 'rx-setup' },
      h('h2', { text: 'Conecta tu correo de Hostinger' }),
      h('p', { class: 'sub', text: 'ViperTeca lee la bandeja de entrada por IMAP en modo solo lectura: no marca correos como leídos, no borra ni envía nada. La contraseña la escribes tú y se guarda cifrada en este PC.' }),
      h('label', { class: 'ks-field' }, h('span', { text: 'Correo' }), user),
      h('label', { class: 'ks-field' }, h('span', { text: 'Contraseña del correo' }), pass),
      h('details', { class: 'notes' }, h('summary', { text: 'Servidor (ya viene puesto el de Hostinger)' }), h('div', { class: 'ks-two' }, h('label', { class: 'ks-field' }, h('span', { text: 'Servidor IMAP' }), host), h('label', { class: 'ks-field' }, h('span', { text: 'Puerto' }), port))),
      h('div', { class: 'rx-row' }, h('button', { class: 'btn primary', text: 'Conectar', onclick: save }), M.acc.hasPassword && h('button', { class: 'btn ghost', text: 'Cancelar', onclick: () => { M.setup = false; render(); } }))
    );
  }

  function render() {
    const body = $('#mailBody');
    if (!body || $('#mailView').hidden || !M.acc) return;
    if (!M.acc.hasPassword || M.setup) return fill(body, setupForm());
    const d = M.data;
    const list = (d?.list || []).filter((m) => M.filter === 'all' || m.unread);
    const day = (t) => {
      if (!t) return '';
      const x = new Date(t);
      const today = new Date().toDateString() === x.toDateString();
      return today ? x.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : x.toLocaleDateString('es', { day: 'numeric', month: 'short' });
    };
    fill(body,
      h('dl', { class: 'stat-strip rx-stats' },
        h('div', {}, h('dt', { text: 'Sin leer' }), h('dd', { class: d?.unread ? 'rx-hot' : '', text: d ? String(d.unread) : '—' })),
        h('div', {}, h('dt', { text: 'En la bandeja' }), h('dd', { text: d ? String(d.total) : '—' })),
        h('div', {}, h('dt', { text: 'Cuenta' }), h('dd', { text: M.acc.user }))
      ),
      h('div', { class: 'toolbar flat' },
        h('button', { class: 'btn primary small', text: M.busy ? 'Revisando…' : 'Revisar ahora', disabled: M.busy, onclick: () => show(true) }),
        h('div', { class: 'seg' }, [['all', 'Todos'], ['unread', 'Sin leer']].map(([k, t]) => h('button', { class: M.filter === k ? 'on' : '', text: t, onclick: () => { M.filter = k; render(); } }))),
        h('button', { class: 'btn ghost small', text: 'Abrir Webmail de Hostinger', onclick: () => api.openWeb() }),
        h('button', { class: 'btn subtle small', text: 'Cuenta', onclick: () => { M.setup = true; render(); } }),
        d && h('span', { class: 'hint', text: `Revisado ${relTime(d.at / 1000)}. Se revisa solo cada 5 minutos y te avisa de los nuevos.` })
      ),
      M.error && h('p', { class: 'hint bad', text: M.error }),
      !d ? (M.busy ? h('p', { class: 'hint', text: 'Conectando con el servidor de correo…' }) : null)
        : list.length ? h('ul', { class: 'ml-list' }, list.map((m) => h('li', { class: `ml-row ${m.unread ? 'unread' : ''}` },
            h('span', { class: 'ml-dot', 'aria-label': m.unread ? 'Sin leer' : 'Leído' }),
            h('div', { class: 'ml-main' }, h('b', { text: m.from || m.email }), h('span', { text: m.subject })),
            h('span', { class: 'ml-meta', text: [m.answered ? 'Respondido' : null, day(m.date)].filter(Boolean).join(' · ') })
          )))
        : h('p', { class: 'empty', text: M.filter === 'unread' ? 'No tienes correos sin leer.' : 'La bandeja está vacía.' }),
      h('p', { class: 'hint rx-foot', text: 'Para leer o responder un correo, ábrelo en el Webmail de Hostinger. ViperTeca solo mira la bandeja de entrada.' })
    );
  }

  setTimeout(async () => {
    try {
      const acc = await api.account();
      if (acc.hasPassword) {
        M.acc = acc;
        M.data = await api.cached();
        updateBadge();
      }
    } catch {}
  }, 5000);
  window.mailUI = { show: () => show(false) };
})();

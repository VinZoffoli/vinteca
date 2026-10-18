'use strict';
// 1.26: regalos que bajan de precio y fechas importantes, recibos por foto,
// servicios mes a mes, lanzamientos de webs y noche de serie.
(function () {
  const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  const sym = (c) => (c === 'USD' ? '$' : c === 'CRC' ? '₡' : c === 'EUR' ? '€' : '');
  const fmt = (v, c) => (v == null ? '' : sym(c) + Number(v).toLocaleString('es', { maximumFractionDigits: 2 }) + (sym(c) ? '' : ' ' + (c || '')));
  const ymOf = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
  const rerenderCasa = () => window.casaUI?.show?.();
  const dlgOpen = (...kids) => {
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg wide' }, ...kids);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  };

  // ============================================================ REGALOS
  /** Etiqueta "Bajó 12%" con el historial al pasar el ratón. */
  function dropChip(g) {
    if (!g.drop) return null;
    const chip = h('span', { class: 'gt-tag drop', text: `Bajó ${g.drop.pct}% · antes ${fmt(g.drop.from, g.currency)}` });
    chip.addEventListener('mouseenter', async () => {
      if (chip.title) return;
      const pts = await window.api.giftHistory(g.id).catch(() => []);
      chip.title = pts.length ? 'Precio por día:\n' + pts.slice(-12).map((p) => p.d.slice(5).split('-').reverse().join('/') + '  ' + fmt(p.v, p.c)).join('\n') : '';
    });
    return chip;
  }
  const GD = { list: null, busy: false };
  async function loadDates() {
    GD.busy = true;
    try {
      GD.list = await window.api.giftDates();
    } catch {}
    GD.busy = false;
    rerenderCasa();
  }
  /** Próximas fechas (cumple de Emi, Navidad, aniversario…) con lo que falta comprar. */
  function giftDates(d) {
    if (!GD.list && !GD.busy) setTimeout(loadDates, 0);
    const list = GD.list || [];
    return h('section', { class: 'gd' },
      h('div', { class: 'gd-head' },
        h('h3', { text: 'Fechas importantes' }),
        h('button', { class: 'btn subtle small', text: 'Añadir fecha', onclick: () => datesForm(d) })
      ),
      list.length
        ? h('div', { class: 'gd-row' }, list.map((x) => h('article', { class: 'gd-card' + (x.days <= 7 ? ' soon' : '') },
            h('b', { class: 'gd-days', text: x.days === 0 ? 'Hoy' : x.days === 1 ? 'Mañana' : x.days + ' días' }),
            h('span', { class: 'gd-name', text: x.name }),
            h('small', { class: 'hint', text: x.count ? `${x.count} ${x.count === 1 ? 'deseo' : 'deseos'} sin comprar${x.total ? ' · ' + x.total : ''}${x.crc && x.total.includes('+') ? ' (≈ ₡' + x.crc.toLocaleString('es') + ')' : ''}` : 'Sin ideas todavía' })
          )))
        : h('p', { class: 'hint', text: GD.busy ? 'Calculando…' : 'Añade el aniversario y otras fechas: te aviso 21, 7 y 2 días antes con lo que falta comprar.' }),
      (d.giftDates || []).length ? h('p', { class: 'hint gd-own' }, 'Tus fechas: ', ...(d.giftDates || []).map((x) => h('button', { class: 'link-btn', text: `${x.name} (${x.day}/${x.month})`, onclick: () => datesForm(d, x) }))) : null
    );
  }
  function datesForm(d, x) {
    const people = d.giftPeople || ['Emi'];
    window.casaForm?.(x ? 'Editar fecha' : 'Nueva fecha importante', [
      { key: 'name', label: 'Qué se celebra', value: x?.name || '', required: true, placeholder: 'Aniversario, Día de la madre…' },
      { key: 'day', label: 'Día', type: 'number', min: 1, max: 31, value: x?.day ?? '', required: true },
      { key: 'month', label: 'Mes (1–12)', type: 'number', min: 1, max: 12, value: x?.month ?? '', required: true },
      { key: 'for', label: 'Para', type: 'select', value: x?.for || 'Emi', options: people.map((p) => [p, p]) },
    ], (v) => {
      d.giftDates ||= [];
      const row = { name: v.name, day: Number(v.day), month: Number(v.month), for: v.for };
      if (x) Object.assign(x, row);
      else d.giftDates.push({ id: Math.random().toString(16).slice(2, 10), ...row });
      window.casaCommit?.();
      GD.list = null;
    }, x ? () => { d.giftDates = d.giftDates.filter((y) => y !== x); window.casaCommit?.(); GD.list = null; } : null);
  }
  async function checkPrices(btn) {
    btn.disabled = true;
    btn.textContent = 'Revisando precios…';
    try {
      const r = await window.api.giftCheckPrices();
      toast(r.drops ? `Bajaron ${r.drops} ${r.drops === 1 ? 'regalo' : 'regalos'}.` : `Revisé ${r.checked} ${r.checked === 1 ? 'regalo' : 'regalos'}: ningún precio bajó.`);
    } catch (e) {
      toast(errMsg(e), true);
    }
    btn.disabled = false;
    btn.textContent = 'Revisar precios';
  }

  // ============================================================ PAGOS
  /** Foto de un recibo → monto, mes y a qué pago corresponde. */
  function receipt(d) {
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
    const status = h('p', { class: 'hint', text: 'Elige la foto del recibo (o pégala con Ctrl+V). Tu Claude Code lee el monto, el vencimiento y de qué servicio es. La foto no se guarda.' });
    const box = h('div', { class: 'rc-box' });
    const dlg = dlgOpen(h('h2', { text: 'Recibo por foto' }), status, box, file, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', text: 'Cerrar', onclick: () => dlg.close() })));
    const go = async (blob) => {
      if (!blob) return;
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      fill(box, h('img', { class: 'rc-img', src: dataUrl, alt: '' }), h('div', { class: 'ai-wait' }, h('span', { class: 'as-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Leyendo el recibo…' })));
      try {
        const r = await window.api.receipt(dataUrl);
        confirmForm(r, dataUrl);
      } catch (e) {
        fill(box, h('p', { class: 'hint bad', text: errMsg(e) }), h('button', { class: 'btn subtle small', text: 'Probar con otra foto', onclick: () => file.click() }));
      }
    };
    const confirmForm = (r, dataUrl) => {
      const pay = h('select', { class: 'sn-select' }, h('option', { value: '', text: 'Elige el pago…' }), (d.payments || []).map((p) => h('option', { value: p.id, selected: p.id === r.paymentId, text: p.name + (p.group && p.group !== 'Personal' ? ' (' + p.group + ')' : '') })));
      const amount = h('input', { class: 'rx-input', type: 'number', step: '0.01', value: r.amount ?? '' });
      const cur = h('select', { class: 'sn-select' }, ['CRC', 'USD'].map((c) => h('option', { value: c, text: c, selected: r.currency === c })));
      const month = h('input', { class: 'rx-input', type: 'month', value: r.month || ymOf(new Date()) });
      const due = h('input', { class: 'rx-input', type: 'date', value: r.due || '' });
      const paid = h('input', { type: 'checkbox', checked: true });
      const field = (l, el) => h('label', { class: 'ks-field' }, h('span', { text: l }), el);
      fill(box,
        h('img', { class: 'rc-img', src: dataUrl, alt: '' }),
        h('div', { class: 'rc-form' },
          h('p', { class: 'rc-read', text: [r.service, r.company, r.holder].filter(Boolean).join(' · ') || 'Revisa los datos' }),
          field('Pago', pay), h('div', { class: 'rx-row' }, field('Monto', amount), field('Moneda', cur)), h('div', { class: 'rx-row' }, field('Mes que cobra', month), field('Vence', due)),
          h('label', { class: 'rx-check' }, paid, h('span', { text: 'Marcarlo como pagado' })),
          r.note ? h('p', { class: 'hint', text: r.note }) : null,
          h('button', { class: 'btn primary', text: 'Guardar', onclick: async () => {
            try {
              const out = await window.api.receiptApply({ paymentId: pay.value, month: month.value, amount: Number(amount.value), currency: cur.value, due: due.value || null, paid: paid.checked });
              const c = out.compare;
              toast(c?.high ? `Guardado. Vino ${c.pct}% más alto que el promedio.` : c?.low ? `Guardado. Vino ${-c.pct}% más bajo que el promedio.` : 'Recibo guardado.');
              dlg.close();
            } catch (e) {
              toast(errMsg(e), true);
            }
          } })
        )
      );
    };
    file.addEventListener('change', () => go(file.files[0]));
    dlg.addEventListener('paste', (e) => {
      const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (it) {
        e.preventDefault();
        go(it.getAsFile());
      }
    });
    file.click();
  }
  /** Servicios mes a mes: luz, agua, internet… con lo que vino cada mes. */
  function bills(d) {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => ymOf(new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)));
    const withBills = (d.payments || []).filter((p) => Object.keys(p.bills || {}).length);
    const rows = withBills.map((p) => {
      const vals = months.map((m) => p.bills[m]?.amount ?? null);
      const max = Math.max(1, ...vals.filter((v) => v != null));
      const keys = Object.keys(p.bills).sort();
      const lastK = keys[keys.length - 1];
      const last = p.bills[lastK];
      const prev = keys.slice(0, -1).slice(-3).map((k) => p.bills[k]).filter((b) => b.currency === last.currency);
      const avg = prev.length ? prev.reduce((a, b) => a + b.amount, 0) / prev.length : null;
      const pct = avg ? Math.round((last.amount / avg - 1) * 100) : null;
      return h('div', { class: 'bl-row' },
        h('div', { class: 'bl-name' }, h('b', { text: p.name }), h('small', { class: 'hint', text: p.group !== 'Personal' ? p.group : '' })),
        h('div', { class: 'bl-bars', 'aria-label': p.name + ' por mes' }, vals.map((v, i) => h('i', { class: (v == null ? 'none' : '') + (months[i] === lastK && pct >= 25 ? ' high' : ''), style: { height: v == null ? '4px' : Math.max(8, (v / max) * 100) + '%' }, title: MON[Number(months[i].slice(5)) - 1] + ' ' + months[i].slice(0, 4) + ': ' + (v == null ? 'sin dato' : fmt(v, p.bills[months[i]].currency)) }))),
        h('div', { class: 'bl-last' }, h('b', { text: fmt(last.amount, last.currency) }), h('small', { class: 'hint', text: MON[Number(lastK.slice(5)) - 1] }), pct != null && Math.abs(pct) >= 10 ? h('span', { class: 'bl-pct ' + (pct >= 25 ? 'high' : pct > 0 ? 'up' : 'down'), text: (pct > 0 ? '+' : '') + pct + '% vs. promedio' }) : null)
      );
    });
    return h('section', { class: 'bl' },
      h('div', { class: 'gd-head' }, h('h3', { text: 'Servicios mes a mes' }), h('button', { class: 'btn subtle small', text: 'Anotar monto', onclick: () => billForm(d) })),
      rows.length ? h('div', { class: 'bl-list' }, rows, h('div', { class: 'bl-months' }, h('span'), h('div', { class: 'bl-bars labels' }, months.map((m) => h('small', { text: MON[Number(m.slice(5)) - 1].slice(0, 1).toUpperCase() }))), h('span'))) : h('p', { class: 'hint', text: 'Sube la foto de un recibo o anota el monto de cada mes: aquí verás luz, agua e internet mes a mes y te aviso si un mes viene raro.' })
    );
  }
  function billForm(d) {
    window.casaForm?.('Anotar el monto de un mes', [
      { key: 'id', label: 'Pago', type: 'select', value: '', options: (d.payments || []).map((p) => [p.id, p.name + (p.group !== 'Personal' ? ' (' + p.group + ')' : '')]) },
      { key: 'month', label: 'Mes', type: 'month', value: ymOf(new Date()), required: true },
      { key: 'amount', label: 'Monto', type: 'number', required: true },
      { key: 'currency', label: 'Moneda', type: 'select', value: 'CRC', options: [['CRC', 'Colones'], ['USD', 'Dólares']] },
    ], (v) => {
      window.api.receiptApply({ paymentId: v.id, month: v.month, amount: Number(v.amount), currency: v.currency, paid: false, from: 'mano' }).then((r) => {
        const c = r.compare;
        toast(c?.high ? `Anotado. Vino ${c.pct}% más alto que el promedio.` : 'Anotado.');
      }).catch((e) => toast(errMsg(e), true));
    });
  }

  // ============================================================ LANZAMIENTOS
  const L = { list: null, busy: null };
  async function launchLoad(rr) {
    L.list = await window.api.launch.list().catch(() => []);
    rr?.();
  }
  function launchTab(rr) {
    if (!L.list) launchLoad(rr);
    if (!L.hooked) {
      L.hooked = true;
      window.api.launch.onChanged(() => launchLoad(rr));
    }
    const input = h('input', { class: 'rx-input', placeholder: 'https://… la web que vas a lanzar', type: 'url' });
    const run = async (url, name) => {
      L.busy = url;
      rr();
      try {
        await window.api.launch.check(url, name);
      } catch (e) {
        toast(errMsg(e), true);
      }
      L.busy = null;
      await launchLoad(rr);
    };
    const SEV = { critical: 'Bloquea', high: 'Importante', medium: 'Detalle', ok: '' };
    return [
      h('section', { class: 'rx-card lc-new' },
        h('p', { class: 'hint', text: 'Cuando una web pasa a Live en Notion la reviso sola y te aviso. También puedes revisar cualquiera aquí: carga, Google Tag Manager / Analytics, pixel de Meta, formulario, SEO básico, celular y enlaces rotos.' }),
        h('form', { class: 'rx-row', onsubmit: (e) => { e.preventDefault(); const u = input.value.trim(); if (u) run(u); } }, input, h('button', { class: 'btn primary small', disabled: !!L.busy, text: L.busy ? 'Revisando…' : 'Revisar' }))
      ),
      L.busy ? h('div', { class: 'ai-wait' }, h('span', { class: 'as-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Revisando ' + L.busy + ' en escritorio y en celular… tarda alrededor de un minuto.' })) : null,
      (L.list || []).length
        ? (L.list || []).map((r) => {
            const bad = r.items.filter((i) => !i.ok);
            return h('section', { class: 'rx-card lc' },
              h('header', {}, h('div', {}, h('b', { text: r.name || r.url }), h('small', { class: 'hint', text: r.url + ' · ' + relTime(r.at / 1000) })), h('span', { class: 'lc-badge ' + (bad.some((i) => i.sev === 'critical') ? 'bad' : bad.length ? 'warn' : 'ok'), text: bad.length ? bad.length + ' pendientes' : 'Listo para avisar al cliente' }), h('button', { class: 'btn subtle small', disabled: !!L.busy, text: 'Volver a revisar', onclick: () => run(r.url, r.name) })),
              h('ul', { class: 'lc-list' }, [...bad.sort((a, b) => ['critical', 'high', 'medium'].indexOf(a.sev) - ['critical', 'high', 'medium'].indexOf(b.sev)), ...r.items.filter((i) => i.ok)].map((i) => h('li', { class: i.ok ? 'ok' : 'lc-' + i.sev }, h('span', { class: 'lc-ic', 'aria-hidden': 'true', text: i.ok ? '✓' : '!' }), h('div', {}, h('span', { text: i.label }), i.detail ? h('small', { class: 'hint', text: i.detail }) : null), !i.ok ? h('em', { text: SEV[i.sev] }) : null)))
            );
          })
        : L.list ? h('p', { class: 'empty' }, h('b', { text: 'Sin revisiones todavía' }), 'Pega la dirección de una web arriba o espera a que una pase a Live en Notion.') : null,
    ];
  }

  // ============================================================ NOCHE DE SERIE
  const NS = { min: 60 };
  function night(data, rr) {
    const shows = (data?.shows || []).filter((s) => !s.movie && s.left > 0);
    if (!shows.length) return null;
    // las que ven los dos primero, luego las de cada uno
    const by = new Map();
    for (const s of shows) {
      const k = s.platform + ':' + s.key;
      const cur = by.get(k) || { ...s, who: new Set() };
      cur.who.add(s.who);
      cur.left = Math.min(cur.left, s.left);
      by.set(k, cur);
    }
    const picks = [...by.values()]
      .map((s) => {
        const rt = s.runtime || (s.platform === 'crunchyroll' ? 24 : 45);
        const eps = Math.max(1, Math.min(s.left, Math.floor(NS.min / rt)));
        return { ...s, rt, eps, both: s.who.size > 1, fits: rt <= NS.min + 5 };
      })
      .filter((s) => s.fits)
      .sort((a, b) => Number(b.both) - Number(a.both) || (b.last?.date || 0) - (a.last?.date || 0))
      .slice(0, 3);
    const together = (data?.ai?.data?.together || []).slice(0, 2);
    const WHO = { vincenzo: 'Vincenzo', emily: 'Emily' };
    return h('section', { class: 'ns' },
      h('div', { class: 'gd-head' },
        h('h2', { class: 'section-h', text: 'Noche de serie' }),
        h('div', { class: 'seg' }, [30, 45, 60, 90, 120].map((m) => h('button', { class: NS.min === m ? 'on' : '', text: m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) : ''), onclick: () => { NS.min = m; rr(); } })))
      ),
      picks.length
        ? h('div', { class: 'ns-row' }, picks.map((s, i) => h('article', { class: 'ns-card' + (i === 0 ? ' top' : '') },
            s.cover ? h('img', { src: s.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null,
            h('div', {},
              h('small', { class: 'ns-k', text: i === 0 ? 'Esta noche' : 'También' }),
              h('b', { text: s.name }),
              h('p', { text: `${s.eps} ${s.eps === 1 ? 'capítulo' : 'capítulos'} · ~${s.eps * s.rt} min` }),
              h('small', { class: 'hint', text: s.both ? 'La están viendo los dos' : 'La va viendo ' + [...s.who].map((w) => WHO[w]).join(' y ') + ' (le faltan ' + s.left + ')' })
            )
          )))
        : h('p', { class: 'hint', text: 'No hay nada a medias que entre en ' + NS.min + ' minutos.' }),
      NS.min >= 90 && together.length ? h('p', { class: 'hint ns-movie', text: 'Algo nuevo para los dos: ' + together.map((t) => t.title + ' (' + t.platform + ')').join(' · ') }) : null
    );
  }

  window.v126 = { dropChip, giftDates, checkPrices, receipt, bills, launchTab, night };
  window.launchTab = launchTab;
})();

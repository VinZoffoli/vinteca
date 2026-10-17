'use strict';
// 1.19: Genshin — puntuación de artefactos, suerte en los deseos y plan del día.
(function () {
  // =================================================== ARTEFACTOS
  // Valor crítico de las subestadísticas (Prob. CRIT × 2 + Daño CRIT): la medida
  // que usa la comunidad para saber si una pieza vale la pena.
  const num = (v) => parseFloat(String(v ?? '').replace(',', '.')) || 0;
  const isCR = (n) => /crit/i.test(n) && /prob/i.test(n);
  const isCD = (n) => /crit/i.test(n) && /da[ñn]o/i.test(n);
  window.artScore = (a) => {
    let cv = 0;
    for (const s of a.subs || []) {
      const v = num(s.final ?? s.value);
      if (isCR(s.name)) cv += v * 2;
      else if (isCD(s.name)) cv += v;
    }
    cv = Math.round(cv * 10) / 10;
    const lvl = Number(a.level) || 0;
    const [cls, label] = cv >= 45 ? ['top', 'Joya'] : cv >= 35 ? ['great', 'Muy bueno'] : cv >= 25 ? ['good', 'Bueno'] : cv >= 15 ? ['meh', 'Normal'] : lvl < 16 ? ['meh', 'Por subir'] : ['bad', 'Para cambiar'];
    return { cv, cls, label };
  };
  window.artBadge = (a) => {
    const s = window.artScore(a);
    return h('span', { class: `art-score ${s.cls}`, title: `Valor crítico de las subestadísticas: ${s.cv}. Sirve para personajes de daño; en sanadores y apoyos mira la recarga, la vida o la maestría.` }, h('b', { text: String(Math.round(s.cv)) }), s.label);
  };
  window.artSummary = (arts) => {
    if (!arts?.length) return null;
    const scored = arts.map((a) => ({ a, s: window.artScore(a) }));
    const bad = scored.filter((x) => x.s.cls === 'bad');
    const total = Math.round(scored.reduce((t, x) => t + x.s.cv, 0));
    return h('p', { class: `art-sum ${bad.length ? 'warn' : ''}` },
      h('b', { text: `Valor crítico total ${total}` }),
      bad.length ? ` · Para cambiar: ${bad.map((x) => x.a.slot || x.a.name).join(', ')}. Busca piezas con Prob. o Daño CRIT en las subestadísticas.` : total >= 180 ? ' · Equipo de artefactos excelente.' : total >= 130 ? ' · Buen equipo de artefactos.' : ' · Se puede mejorar sin prisa.'
    );
  };

  // =================================================== SUERTE EN LOS DESEOS
  const GLOBAL = { character: 62.3, weapon: 53.7, standard: 62.3, chronicled: 62.3 };
  window.wishLuck = (w) => {
    const pools = (w?.pools || []).filter((p) => p.fives?.length);
    if (!pools.length) return null;
    return h('section', { class: 'luck' },
      h('h2', { class: 'section-h', text: 'Tu suerte' }),
      h('div', { class: 'luck-grid' }, pools.map((p) => {
        const fives = p.fives.slice().reverse(); // de la más antigua a la más reciente
        const avg = fives.reduce((t, f) => t + (f.pity || 0), 0) / fives.length;
        const base = GLOBAL[p.key] || 62.3;
        const diff = avg - base;
        const verdict = diff <= -4 ? ['good', 'Más suerte que la media'] : diff >= 4 ? ['bad', 'Menos suerte que la media'] : ['', 'En la media'];
        const won = fives.filter((f) => f.lost === false).length;
        const lost = fives.filter((f) => f.lost === true).length;
        let streak = 0;
        let kind = null;
        for (const f of p.fives) {
          if (f.lost == null) continue;
          if (kind == null) kind = f.lost ? 'lost' : 'won';
          if ((f.lost ? 'lost' : 'won') !== kind) break;
          streak++;
        }
        const hard = p.hardPity || 90;
        return h('div', { class: 'luck-card' },
          h('div', { class: 'luck-head' }, h('h3', { text: p.name }), h('span', { class: `luck-v ${verdict[0]}`, text: verdict[1] })),
          h('div', { class: 'luck-bars', role: 'img', 'aria-label': `Tiradas que costó cada 5★ en ${p.name}` },
            fives.slice(-24).map((f) => h('i', { class: f.lost === true ? 'lost' : f.lost === false ? 'won' : '', style: { height: `${Math.max(6, (f.pity / hard) * 100)}%` }, title: `${f.name}: ${f.pity} tiradas${f.lost === true ? ' (perdió el 50/50)' : f.lost === false ? ' (ganó el 50/50)' : ''}` })),
            h('span', { class: 'luck-avg', style: { bottom: `${(base / hard) * 100}%` }, title: `Media de todos los jugadores: ${base}` })
          ),
          h('dl', { class: 'luck-stats' },
            h('div', {}, h('dt', { text: 'Tu media' }), h('dd', { text: avg.toFixed(1) })),
            h('div', {}, h('dt', { text: 'Media global' }), h('dd', { text: String(base) })),
            p.key === 'character' && h('div', {}, h('dt', { text: '50/50' }), h('dd', { text: `${won} ganados · ${lost} perdidos` })),
            p.key === 'character' && streak > 1 && h('div', {}, h('dt', { text: 'Racha' }), h('dd', { class: kind === 'won' ? 'good' : 'bad', text: `${streak} ${kind === 'won' ? 'ganados' : 'perdidos'} seguidos` }))
          )
        );
      })),
      h('p', { class: 'hint', text: 'Cada barra es un 5★: cuanto más alta, más tiradas costó. Azul: ganaste el 50/50; rosa: lo perdiste; gris: garantizado o sin 50/50. La línea marca la media de todos los jugadores.' })
    );
  };

  // =================================================== PLAN DE HOY (Farmeo)
  window.genshinTodayPlan = (ctx) => {
    const notes = typeof gi !== 'undefined' ? gi.hoyo?.notes : null;
    const r = ctx.result;
    const resin = notes ? { value: notes.resin, max: notes.maxResin } : ctx.resin;
    const rows = [];
    const add = (done, text, sub) => rows.push(h('li', { class: done ? 'done' : '' }, h('i', { 'aria-hidden': 'true' }), h('div', {}, h('span', { text }), sub && h('small', { class: 'hint', text: sub }))));
    if (resin?.value != null) {
      const runs = Math.floor(resin.value / 20);
      if (r?.todayFarm?.length) add(runs === 0, `Gasta la resina en ${r.todayFarm.map((t) => t.domain || 'el dominio de talentos').join(' y ')}`, `${resin.value} de resina: ${runs} ${runs === 1 ? 'vuelta' : 'vueltas'} de 20. Para ${[...new Set(r.todayFarm.flatMap((t) => t.who))].join(', ')}.`);
      else add(runs === 0, 'Hoy no toca libro de tus personajes', `${resin.value} de resina: úsala en jefes de mundo (40), flores de experiencia o mora.`);
    }
    if (notes) {
      if (notes.weeklyLeft > 0) add(false, `Te quedan ${notes.weeklyLeft} de ${notes.weeklyTotal} jefes semanales con descuento`, 'Cuestan 30 de resina en vez de 60 hasta el lunes.');
      add(notes.commissionsDone >= notes.commissionsTotal && notes.commissionReward, notes.commissionsDone >= notes.commissionsTotal ? (notes.commissionReward ? 'Encargos diarios hechos y cobrados' : 'Cobra los encargos con Katheryne') : `Encargos diarios: ${notes.commissionsDone} de ${notes.commissionsTotal}`);
      const exp = (notes.expeditions || []).filter((x) => x.done).length;
      if (exp) add(false, `Recoge ${exp} ${exp === 1 ? 'expedición' : 'expediciones'} y mándalas otra vez`);
      if (notes.realmMax && notes.realmCoins >= notes.realmMax * 0.9) add(false, 'Recoge la moneda del reino de la tetera', `${notes.realmCoins} de ${notes.realmMax}.`);
      if (notes.transformerReady) add(false, 'El transformador paramétrico está listo');
    }
    const ready = (window.gatherList?.() || []).filter((g) => g.readyAt <= Date.now());
    if (ready.length) add(false, `Pasa a recoger: ${ready.map((g) => g.name).slice(0, 4).join(', ')}${ready.length > 4 ? '…' : ''}`);
    if (ctx.sign && ctx.sign.linked && !ctx.sign.signed && !ctx.sign.error) add(false, 'Reclama la recompensa diaria de HoYoLAB');
    if (!rows.length) return null;
    return h('section', { class: 'rx-card gplan' },
      h('h3', { text: 'Tu plan de hoy' }),
      h('ul', { class: 'gplan-list' }, rows),
      !notes && h('p', { class: 'hint', text: 'Con tu cuenta de HoYoLAB conectada (pestaña Notas) el plan suma encargos, jefes semanales, expediciones y la tetera.' })
    );
  };
})();

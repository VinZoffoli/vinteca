// Planificador de farmeo de Genshin: eliges personajes y hasta dónde subirlos
// (nivel y talentos) y calcula los materiales que hacen falta y qué dominio de
// talentos está abierto hoy. Datos de Project Amber (gi.yatta.moe), en español.
const API = 'https://gi.yatta.moe/api/v2/es';
const ICON = (name) => `https://gi.yatta.moe/assets/UI/${name}.png`;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GROUPS = ['talent', 'crown', 'weekly', 'boss', 'gem', 'local', 'common'];
const GROUP_ES = { talent: 'Libros de talento (dominio por días)', crown: 'Coronas', weekly: 'Jefes semanales', boss: 'Jefes de mundo', gem: 'Gemas de ascensión', local: 'Especialidades locales', common: 'Materiales de enemigos' };
const DAY_ES = { monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles', thursday: 'jueves', friday: 'viernes', saturday: 'sábado', sunday: 'domingo' };

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers: { 'User-Agent': 'ViperTeca' } });
  if (!r.ok) throw new Error(`Project Amber no respondió (HTTP ${r.status}).`);
  const j = await r.json();
  return j.data;
}

/** Lista de personajes jugables (caché 7 días). */
async function avatars({ read, write }) {
  const c = read('gfarm-avatars.json', null);
  if (c && Date.now() - c.at < 7 * 86400000) return c.list;
  const d = await get('/avatar');
  const list = Object.values(d.items)
    .filter((a) => a.name && a.release && Number(String(a.id).split('-')[0]) < 11000000)
    .map((a) => ({ id: a.id, name: a.name, rank: a.rank, element: a.element, icon: ICON(a.icon) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  write('gfarm-avatars.json', { at: Date.now(), list });
  return list;
}

async function avatar(id, cache) {
  if (cache.av[id]) return cache.av[id];
  const d = await get(`/avatar/${id}`);
  const talents = Object.values(d.talent || {})
    .filter((t) => t.promote?.['2']?.costItems)
    .slice(0, 3)
    .map((t) => ({ name: t.name, promote: Object.fromEntries(Object.entries(t.promote).map(([lv, p]) => [lv, { items: p.costItems || {}, mora: p.coinCost || 0 }])) }));
  const promote = (d.upgrade?.promote || []).map((p) => ({ level: p.promoteLevel, maxLevel: p.unlockMaxLevel, items: p.costItems || {}, mora: p.coinCost || 0 }));
  const items = Object.fromEntries(Object.entries(d.items || {}).map(([k, v]) => [k, { name: v.name, rank: v.rank, icon: ICON(v.icon) }]));
  cache.av[id] = { id: d.id, name: d.name, icon: ICON(d.icon), rank: d.rank, element: d.element, talents, promote, items };
  return cache.av[id];
}

async function material(id, cache) {
  if (cache.mat[id]) return cache.mat[id];
  const d = await get(`/material/${id}`);
  const dom = (d.source || []).find((s) => s.type === 'domain' && s.days);
  cache.mat[id] = { type: d.type || '', days: dom ? dom.days : null, domain: dom ? dom.name : null };
  return cache.mat[id];
}

// Nivel 20/40/50/60/70/80 sin ascender todavía cuenta como el rango anterior.
const ascFromLevel = (lv, ascended) => {
  const caps = [20, 40, 50, 60, 70, 80, 90];
  const i = caps.findIndex((c) => lv <= c);
  const base = i < 0 ? 6 : i;
  return ascended && caps.includes(lv) && lv < 90 ? base + 1 : base;
};

/** Día de Genshin (el servidor de América cambia de día a las 4:00, UTC-5). */
function genshinDay(now = Date.now()) {
  const d = new Date(now - 9 * 3600000); // UTC-5 y 4 horas de margen
  return DAYS[d.getUTCDay()];
}

/**
 * plan: [{ id, level, ascended, talents:[a,b,c], target:{ level, talents:[a,b,c] } }]
 */
async function compute(plan, { read, write }) {
  const cache = read('gfarm-cache.json', null) || { av: {}, mat: {} };
  const need = {};
  const add = (items, meta, who) => {
    for (const [id, n] of Object.entries(items)) {
      if (id === '202') continue;
      need[id] ||= { id, count: 0, who: new Set(), ...meta[id] };
      need[id].count += n;
      need[id].who.add(who);
    }
  };
  let mora = 0;
  const chars = [];
  for (const p of plan) {
    const a = await avatar(p.id, cache);
    const fromAsc = ascFromLevel(p.level, p.ascended);
    const toAsc = ascFromLevel(p.target.level, false);
    for (const pr of a.promote) if (pr.level > fromAsc && pr.level <= toAsc) {
      add(pr.items, a.items, a.name);
      mora += pr.mora;
    }
    a.talents.forEach((t, i) => {
      const from = p.talents?.[i] || 1;
      const to = p.target.talents?.[i] || from;
      for (let lv = from + 1; lv <= to; lv++) {
        const step = t.promote[lv];
        if (!step) continue;
        add(step.items, a.items, a.name);
        mora += step.mora;
      }
    });
    chars.push({ id: a.id, name: a.name, icon: a.icon, rank: a.rank, element: a.element, talentNames: a.talents.map((t) => t.name) });
  }
  // tipo y días de cada material (talentos: dominio por días)
  for (const id of Object.keys(need)) {
    try {
      Object.assign(need[id], await material(id, cache));
    } catch {}
  }
  write('gfarm-cache.json', cache);
  const today = genshinDay();
  const list = Object.values(need).map((m) => ({ ...m, who: [...m.who], today: !m.days || m.days.includes(today) }));
  const group = (m) =>
    /talento/i.test(m.type) ? (m.rank >= 5 ? 'crown' : 'talent')
    : /ascensi[oó]n de personaje/i.test(m.type) ? 'gem'
    : /mejora de personaje y arma/i.test(m.type) ? 'common'
    : /mejora de personaje/i.test(m.type) ? (m.rank >= 5 ? 'weekly' : 'boss')
    : /t[ií]pico|especialidad/i.test(m.type) ? 'local'
    : 'common';
  for (const m of list) m.group = group(m);
  const todayBooks = list.filter((m) => m.days && m.days.includes(today));
  return {
    today,
    todayEs: DAY_ES[today],
    sunday: today === 'sunday',
    mora,
    chars,
    materials: list.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (b.rank || 0) - (a.rank || 0) || a.name.localeCompare(b.name)),
    groups: GROUP_ES,
    todayFarm: [...new Map(todayBooks.map((m) => [m.domain || m.name, { domain: m.domain, who: m.who }])).values()],
    daysEs: DAY_ES,
  };
}

module.exports = { avatars, compute, ascFromLevel, genshinDay };

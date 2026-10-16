// Tu perfil de Genshin Impact, desde Enka.Network: solo hace falta tu UID (es
// público, no es una contraseña). Da el perfil (rango de aventura, logros, Abismo…)
// y los personajes de tu vitrina con su arma, artefactos y estadísticas.
// El inventario y los personajes que no están en la vitrina no son públicos.
// Nombres e iconos: datos abiertos de Enka (github.com/EnkaNetwork/API-docs).
const STORE = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/';
const UI = 'https://enka.network/ui/';
const UA = { 'User-Agent': 'ViperTeca/1.4 (app de escritorio)' };
const STORE_TTL = 3 * 86400000;

const ELEMENTS = {
  Fire: { name: 'Pyro', color: '#ef7a35' },
  Water: { name: 'Hydro', color: '#3fb6ef' },
  Wind: { name: 'Anemo', color: '#5fd1ac' },
  Electric: { name: 'Electro', color: '#b07ce8' },
  Grass: { name: 'Dendro', color: '#9ccc32' },
  Ice: { name: 'Cryo', color: '#8fd6ea' },
  Rock: { name: 'Geo', color: '#f2b331' },
};

// Estadísticas (fightPropMap) que se enseñan
const FIGHT = [
  ['2000', 'Vida máx.', 'int'],
  ['2001', 'Ataque', 'int'],
  ['2002', 'Defensa', 'int'],
  ['28', 'Maestría elemental', 'int'],
  ['20', 'Prob. CRIT', 'pct'],
  ['22', 'Daño CRIT', 'pct'],
  ['23', 'Recarga de energía', 'pct'],
  ['26', 'Bono de curación', 'pct'],
];
const DMG_BONUS = { 30: 'Bono de daño físico', 40: 'Bono de daño Pyro', 41: 'Bono de daño Electro', 42: 'Bono de daño Hydro', 43: 'Bono de daño Dendro', 44: 'Bono de daño Anemo', 45: 'Bono de daño Geo', 46: 'Bono de daño Cryo' };

const PROP = {
  FIGHT_PROP_HP: ['Vida', false],
  FIGHT_PROP_HP_PERCENT: ['Vida', true],
  FIGHT_PROP_ATTACK: ['Ataque', false],
  FIGHT_PROP_ATTACK_PERCENT: ['Ataque', true],
  FIGHT_PROP_BASE_ATTACK: ['Ataque base', false],
  FIGHT_PROP_DEFENSE: ['Defensa', false],
  FIGHT_PROP_DEFENSE_PERCENT: ['Defensa', true],
  FIGHT_PROP_ELEMENT_MASTERY: ['Maestría elemental', false],
  FIGHT_PROP_CRITICAL: ['Prob. CRIT', true],
  FIGHT_PROP_CRITICAL_HURT: ['Daño CRIT', true],
  FIGHT_PROP_CHARGE_EFFICIENCY: ['Recarga de energía', true],
  FIGHT_PROP_HEAL_ADD: ['Bono de curación', true],
  FIGHT_PROP_PHYSICAL_ADD_HURT: ['Daño físico', true],
  FIGHT_PROP_FIRE_ADD_HURT: ['Daño Pyro', true],
  FIGHT_PROP_ELEC_ADD_HURT: ['Daño Electro', true],
  FIGHT_PROP_WATER_ADD_HURT: ['Daño Hydro', true],
  FIGHT_PROP_GRASS_ADD_HURT: ['Daño Dendro', true],
  FIGHT_PROP_WIND_ADD_HURT: ['Daño Anemo', true],
  FIGHT_PROP_ROCK_ADD_HURT: ['Daño Geo', true],
  FIGHT_PROP_ICE_ADD_HURT: ['Daño Cryo', true],
};
const SLOTS = { EQUIP_BRACER: 'Flor', EQUIP_NECKLACE: 'Pluma', EQUIP_SHOES: 'Reloj', EQUIP_RING: 'Cáliz', EQUIP_DRESS: 'Corona' };
const SLOT_ORDER = Object.keys(SLOTS);

const ui = (p) => (p ? UI + String(p).replace(/^\/?ui\//, '').replace(/^\//, '') + (/\.(png|jpg)$/.test(p) ? '' : '.png') : null);
const stat = (id, v) => {
  const [name, pct] = PROP[id] || [id.replace('FIGHT_PROP_', ''), false];
  return { name, value: pct ? `${Number(v).toFixed(1)}%` : String(Math.round(v)), pct };
};

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

/** Nombres (en español) e iconos de personajes, tarjetas y avatares. */
async function store({ read, write }) {
  const c = read('genshin-store.json', null);
  if (c && c.sets && Date.now() - c.at < STORE_TTL) return c;
  try {
    const [avatars, locs, namecards, pfps, relics] = await Promise.all(['avatars.json', 'locs.json', 'namecards.json', 'pfps.json', 'relics.json'].map((f) => getJson(STORE + f)));
    const out = { at: Date.now(), avatars, loc: { ...locs.en, ...locs.es }, namecards, pfps, sets: Object.fromEntries(Object.entries(relics.Sets || {}).map(([id, v]) => [id, v.Name])) };
    write('genshin-store.json', out);
    return out;
  } catch (e) {
    if (c) return c;
    throw e;
  }
}

function character(a, st) {
  const meta = st.avatars[a.avatarId] || st.avatars[`${a.avatarId}-${a.skillDepotId}`] || {};
  const costume = a.costumeId && meta.Costumes?.[a.costumeId];
  const side = costume?.SideIcon || meta.SideIconName || '';
  const el = ELEMENTS[meta.Element] || { name: '', color: '#a39cc3' };
  const fp = a.fightPropMap || {};
  const stats = FIGHT.map(([k, name, kind]) => ({ name, value: kind === 'pct' ? `${((fp[k] || 0) * 100).toFixed(1)}%` : Math.round(fp[k] || 0).toLocaleString('es') })).filter((s, i) => i < 4 || s.value !== '0.0%');
  const best = Object.entries(DMG_BONUS).map(([k, n]) => [n, fp[k] || 0]).sort((x, y) => y[1] - x[1])[0];
  if (best && best[1] > 0) stats.push({ name: best[0], value: `${(best[1] * 100).toFixed(1)}%` });
  const extra = a.proudSkillExtraLevelMap || {};
  const talents = (meta.SkillOrder || []).map((id) => {
    const base = a.skillLevelMap?.[id] || 1;
    const plus = extra[meta.ProudMap?.[id]] || 0;
    return { level: base + plus, boosted: plus > 0, icon: ui(meta.Skills?.[id]) };
  });
  let weapon = null;
  const artifacts = [];
  for (const e of a.equipList || []) {
    const f = e.flat || {};
    if (f.itemType === 'ITEM_WEAPON') {
      const [main, sub] = f.weaponStats || [];
      weapon = {
        name: st.loc[f.nameTextMapHash] || 'Arma',
        icon: ui(f.icon),
        rarity: f.rankLevel || 0,
        level: e.weapon?.level || 1,
        refine: Object.values(e.weapon?.affixMap || {})[0] + 1 || 1,
        main: main ? stat(main.appendPropId, main.statValue) : null,
        sub: sub ? stat(sub.appendPropId, sub.statValue) : null,
      };
    } else if (f.itemType === 'ITEM_RELIQUARY') {
      artifacts.push({
        slot: SLOTS[f.equipType] || '',
        order: SLOT_ORDER.indexOf(f.equipType),
        set: st.loc[st.sets?.[f.setId]] || st.loc[f.setNameTextMapHash] || null,
        icon: ui(f.icon),
        rarity: f.rankLevel || 0,
        level: Math.max(0, (e.reliquary?.level || 1) - 1),
        main: f.reliquaryMainstat ? stat(f.reliquaryMainstat.mainPropId, f.reliquaryMainstat.statValue) : null,
        subs: (f.reliquarySubstats || []).map((s) => stat(s.appendPropId, s.statValue)),
      });
    }
  }
  artifacts.sort((x, y) => x.order - y.order);
  // Valor crítico de los artefactos (Prob. CRIT ×2 + Daño CRIT): medida habitual de lo buenos que son
  let cv = 0;
  for (const ar of artifacts) for (const s of ar.subs) cv += s.name === 'Prob. CRIT' ? parseFloat(s.value) * 2 : s.name === 'Daño CRIT' ? parseFloat(s.value) : 0;
  // Conjuntos: 2 o 4 piezas iguales
  const count = {};
  for (const ar of artifacts) if (ar.set) count[ar.set] = (count[ar.set] || 0) + 1;
  const sets = Object.entries(count).filter(([, n]) => n >= 2).map(([name, n]) => ({ name, pieces: n >= 4 ? 4 : 2 }));
  return {
    id: a.avatarId,
    name: st.loc[meta.NameTextMapHash] || `Personaje ${a.avatarId}`,
    element: el.name,
    color: el.color,
    rarity: meta.QualityType === 'QUALITY_ORANGE' || meta.QualityType === 'QUALITY_ORANGE_SP' ? 5 : 4,
    level: Number(a.propMap?.['4001']?.val || 1),
    constellation: (a.talentIdList || []).length,
    friendship: a.fetterInfo?.expLevel || 0,
    icon: ui(side.replace('_Side', '')),
    side: ui(side),
    talents,
    stats,
    weapon,
    artifacts,
    sets,
    critValue: Math.round(cv * 10) / 10,
  };
}

/** Perfil completo. Enka pide no consultar más a menudo que su "ttl" (unos 60 s). */
async function profile(uid, { read, write, force }) {
  if (!/^\d{9,10}$/.test(String(uid))) throw new Error('El UID tiene 9 o 10 cifras. Lo ves abajo a la derecha en el juego o en el menú de Paimon.');
  const cache = read('genshin-profile.json', null);
  const mine = cache && cache.uid === String(uid);
  // Antes de su "ttl" no hay datos nuevos; sin pedirlo, se reutiliza 30 minutos
  if (mine && (Date.now() < cache.until || (!force && Date.now() - cache.at < 30 * 60000))) return cache.data;
  const st = await store({ read, write });
  let j;
  try {
    j = await getJson(`https://enka.network/api/uid/${uid}/`);
  } catch (e) {
    const msg = {
      400: 'Ese UID no tiene un formato válido.',
      404: 'No existe ninguna cuenta con ese UID.',
      424: 'Genshin está en mantenimiento o acaba de actualizarse; prueba en un rato.',
      429: 'Enka limita las consultas: espera un minuto y vuelve a intentarlo.',
      500: 'Enka no responde ahora mismo.',
      503: 'Enka no responde ahora mismo.',
    }[e.status];
    if (cache && cache.uid === String(uid)) return { ...cache.data, stale: msg || e.message };
    throw new Error(msg || `No se pudo leer el perfil (${e.message}).`);
  }
  const p = j.playerInfo || {};
  const card = st.namecards[p.nameCardId]?.Icon;
  const pfp = p.profilePicture?.id ? st.pfps[p.profilePicture.id]?.IconPath : st.avatars[p.profilePicture?.avatarId]?.SideIconName?.replace('_Side', '');
  const data = {
    uid: String(uid),
    fetchedAt: Date.now(),
    player: {
      nickname: p.nickname || 'Viajero',
      level: p.level || 0,
      worldLevel: p.worldLevel ?? null,
      signature: p.signature || '',
      achievements: p.finishAchievementNum || 0,
      abyss: p.towerFloorIndex ? `${p.towerFloorIndex}-${p.towerLevelIndex}` : null,
      abyssStars: p.towerStarIndex ?? p.towerStar ?? null,
      theater: p.theaterActIndex ? { act: p.theaterActIndex, stars: p.theaterStarIndex ?? null } : null,
      maxFriendship: p.fetterCount ?? null,
      namecard: card ? ui(card) : null,
      avatar: pfp ? ui(pfp) : null,
      showcase: (p.showAvatarInfoList || []).length,
    },
    characters: (j.avatarInfoList || []).map((a) => character(a, st)),
    showcase: (p.showAvatarInfoList || []).map((s) => {
      const meta = st.avatars[s.avatarId] || {};
      const side = (s.costumeId && meta.Costumes?.[s.costumeId]?.SideIcon) || meta.SideIconName || '';
      const el = ELEMENTS[meta.Element] || { name: '', color: '#a39cc3' };
      return { id: s.avatarId, name: st.loc[meta.NameTextMapHash] || `Personaje ${s.avatarId}`, level: s.level || 1, element: el.name, color: el.color, rarity: /ORANGE/.test(meta.QualityType || '') ? 5 : 4, icon: ui(side.replace('_Side', '')) };
    }),
    detailsHidden: (p.showAvatarInfoList || []).length > 0 && !(j.avatarInfoList || []).length,
    region: j.region || null,
  };
  write('genshin-profile.json', { uid: String(uid), at: Date.now(), until: Date.now() + (j.ttl || 60) * 1000, data });
  return data;
}

module.exports = { profile };

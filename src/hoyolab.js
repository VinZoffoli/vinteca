// HoYoLAB (Battle Chronicle): notas en tiempo real (resina, encargos, jefes
// semanales, expediciones…), exploración y todos tus personajes.
//  - Inicias sesión tú en una ventana de HoYoLAB dentro de la app. Esa ventana usa
//    una sesión temporal que se borra al cerrarla; la app solo se queda con las
//    cookies de lectura (ltoken_v2/ltuid_v2…), cifradas con tu usuario de Windows.
//  - La API no es oficial (es la que usa la web de HoYoLAB); puede cambiar.
const crypto = require('crypto');
const { BrowserWindow, session, safeStorage } = require('electron');

const BASE = 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api/';
const SALT = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt'; // firma DS de la web de HoYoLAB (internacional)
const KEEP = ['ltoken_v2', 'ltuid_v2', 'ltmid_v2', 'account_id_v2', 'account_mid_v2', 'cookie_token_v2', 'mi18nLang'];
const PARTITION = 'hoyolab-login';

/** Servidor según la primera cifra del UID. */
function server(uid) {
  return { 6: 'os_usa', 7: 'os_euro', 8: 'os_asia', 9: 'os_cht' }[String(uid)[0]] || 'os_usa';
}

function ds() {
  const t = Math.floor(Date.now() / 1000);
  const r = Math.random().toString(36).slice(2, 8).padEnd(6, 'x');
  const h = crypto.createHash('md5').update(`salt=${SALT}&t=${t}&r=${r}`).digest('hex');
  return `${t},${r},${h}`;
}

// ---- cookies guardadas (cifradas) ----
function saveCookies(read, write, cookie) {
  const s = read('settings.json', {});
  if (!cookie) delete s.hoyolabEnc;
  else s.hoyolabEnc = safeStorage.encryptString(cookie).toString('base64');
  write('settings.json', s);
}
function loadCookies(read) {
  const s = read('settings.json', {});
  if (!s.hoyolabEnc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.hoyolabEnc, 'base64'));
  } catch {
    return null;
  }
}
const linked = (read) => !!read('settings.json', {}).hoyolabEnc;

/** Abre HoYoLAB para que inicies sesión; termina cuando hay sesión o cierras la ventana. */
function login(parent, { read, write }) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
  const ses = session.fromPartition(PARTITION); // sin "persist:": vive solo en memoria
  const win = new BrowserWindow({
    parent,
    width: 1100,
    height: 820,
    title: 'Inicia sesión en HoYoLAB',
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadURL('https://www.hoyolab.com/home');
  return new Promise((resolve) => {
    let done = false;
    const finish = async (ok) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      try {
        await ses.clearStorageData();
      } catch {}
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };
    const timer = setInterval(async () => {
      try {
        const all = await ses.cookies.get({ domain: 'hoyolab.com' });
        const got = Object.fromEntries(all.filter((c) => KEEP.includes(c.name)).map((c) => [c.name, c.value]));
        if (got.ltoken_v2 && (got.ltuid_v2 || got.account_id_v2)) {
          saveCookies(read, write, Object.entries(got).map(([k, v]) => `${k}=${v}`).join('; '));
          finish(true);
        }
      } catch {}
    }, 1500);
    win.on('closed', () => finish(false));
  });
}

const ERRORS = {
  10001: 'La sesión de HoYoLAB caducó. Vuelve a iniciar sesión.',
  '-100': 'La sesión de HoYoLAB caducó. Vuelve a iniciar sesión.',
  10102: 'Tus datos no son públicos en HoYoLAB. En HoYoLAB → Battle Chronicle → ajustes, activa «Mostrar mi Battle Chronicle» y «Notas en tiempo real».',
  1009: 'Esa cuenta de HoYoLAB no tiene ese UID de Genshin.',
  10104: 'Esa cuenta de HoYoLAB no tiene ese UID de Genshin.',
  10035: 'HoYoLAB pide una verificación. Abre hoyolab.com en el navegador, entra en Battle Chronicle y vuelve a intentarlo.',
  5003: 'HoYoLAB pide una verificación. Abre hoyolab.com en el navegador, entra en Battle Chronicle y vuelve a intentarlo.',
  '-10001': 'HoYoLAB ha cambiado su API y la app aún no se ha adaptado.',
};

async function call(cookie, path, uid, body) {
  const q = new URL(BASE + path);
  if (body) body = { role_id: String(uid), server: server(uid), ...body };
  else {
    q.searchParams.set('server', server(uid));
    q.searchParams.set('role_id', String(uid));
  }
  const r = await fetch(q, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: cookie,
      DS: ds(),
      'x-rpc-app_version': '1.5.0',
      'x-rpc-client_type': '5',
      'x-rpc-language': 'es-es',
      'Content-Type': 'application/json',
      Origin: 'https://act.hoyolab.com',
      Referer: 'https://act.hoyolab.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`HoYoLAB no respondió bien (HTTP ${r.status}).`);
  if (j.retcode !== 0) {
    const e = new Error(ERRORS[j.retcode] || ERRORS[String(j.retcode)] || `HoYoLAB respondió: ${j.message} (${j.retcode})`);
    e.code = j.retcode;
    throw e;
  }
  return j.data;
}

const mins = (s) => Math.round(Number(s || 0) / 60);

/** Notas en tiempo real + estadísticas + personajes. */
async function overview(uid, { read, write, force }) {
  const cookie = loadCookies(read);
  if (!cookie) return { linked: false };
  const cache = read('hoyolab-cache.json', null);
  if (!force && cache && cache.uid === String(uid) && Date.now() - cache.at < 5 * 60000) return cache.data;
  let note;
  try {
    note = await call(cookie, 'dailyNote', uid);
  } catch (e) {
    if (e.code === 10001 || e.code === -100) saveCookies(read, write, null);
    throw e;
  }
  const [index, chars] = await Promise.all([
    call(cookie, 'index', uid).catch((e) => ({ error: e.message })),
    call(cookie, 'character/list', uid, {}).catch((e) => ({ error: e.message })),
  ]);
  const now = Date.now();
  const data = {
    linked: true,
    fetchedAt: now,
    notes: {
      resin: note.current_resin,
      maxResin: note.max_resin,
      resinFullAt: Number(note.resin_recovery_time) ? now + Number(note.resin_recovery_time) * 1000 : null,
      commissionsDone: note.finished_task_num,
      commissionsTotal: note.total_task_num,
      commissionReward: !!note.is_extra_task_reward_received,
      weeklyLeft: note.remain_resin_discount_num,
      weeklyTotal: note.resin_discount_num_limit,
      realmCoins: note.current_home_coin,
      realmMax: note.max_home_coin,
      realmFullAt: Number(note.home_coin_recovery_time) ? now + Number(note.home_coin_recovery_time) * 1000 : null,
      expeditions: (note.expeditions || []).map((x) => ({ icon: x.avatar_side_icon, done: x.status === 'Finished', minutesLeft: mins(x.remained_time) })),
      maxExpeditions: note.max_expedition_num,
      transformerReady: note.transformer?.obtained ? !!note.transformer?.recovery_time?.reached : null,
    },
    stats: index.error
      ? null
      : {
          days: index.stats?.active_day_number,
          characters: index.stats?.avatar_number,
          // Resumen de la partida, en el mismo orden que HoYoLAB
          summary: summaryRows(index.stats || {}),
          regions: (index.world_explorations || [])
            .filter((w) => !w.parent_id)
            .map((w) => ({ name: w.name, pct: (w.exploration_percentage || 0) / 10, icon: w.icon }))
            .sort((a, b) => a.pct - b.pct),
        },
    characters: chars.error
      ? null
      : (chars.list || chars.avatars || []).map((c) => ({ id: c.id, name: c.name, element: c.element, rarity: c.rarity, level: c.level, constellation: c.actived_constellation_num, friendship: c.fetter, icon: c.side_icon || c.icon, weapon: c.weapon?.name || null })),
    warnings: [index.error, chars.error].filter(Boolean),
  };
  write('hoyolab-cache.json', { uid: String(uid), at: now, data });
  return data;
}

// Filas del "Resumen de la partida" (claves de la API -> nombre en español)
const SUMMARY = [
  ['active_day_number', 'Días de actividad'],
  ['achievement_number', 'Logros alcanzados'],
  ['avatar_number', 'Personajes'],
  ['full_fetter_avatar_num', 'Personajes con amistad máx.'],
  ['spiral_abyss', 'Espiral del Abismo'],
  ['role_combat', 'Teatro Fantasía'],
  ['hard_challenge', 'Conflagración estigia'],
  ['way_point_number', 'Puntos de teletransporte'],
  ['domain_number', 'Dominios'],
  ['cryoculus_number', 'Cryóculus'],
  ['moonoculus_number', 'Selenóculus'],
  ['anemoculus_number', 'Anemóculus'],
  ['geoculus_number', 'Geóculus'],
  ['electroculus_number', 'Electróculus'],
  ['dendroculus_number', 'Dendróculus'],
  ['hydroculus_number', 'Hydróculus'],
  ['pyroculus_number', 'Pyróculus'],
  ['luxurious_chest_number', 'Cofres lujosos'],
  ['precious_chest_number', 'Cofres valiosos'],
  ['exquisite_chest_number', 'Cofres sofisticados'],
  ['common_chest_number', 'Cofres comunes'],
  ['magic_chest_number', 'Cofres extraños'],
];
function summaryRows(st) {
  const show = (k, v) => {
    if (v == null) return null;
    if (k === 'role_combat') return v.is_unlock && v.has_data !== false && v.max_round_id ? `Acto ${v.max_round_id}` : '-';
    if (k === 'hard_challenge') return v.is_unlock && v.name ? v.name : '-';
    if (typeof v === 'object') return null;
    return v === '' ? '-' : typeof v === 'number' ? v.toLocaleString('es') : String(v);
  };
  return SUMMARY.map(([k, label]) => [label, show(k, st[k])]).filter(([, v]) => v != null);
}

/** Ficha completa de uno o varios personajes (atributos, arma, constelaciones, talentos y artefactos). */
async function details(uid, ids, { read }) {
  const cookie = loadCookies(read);
  if (!cookie) throw new Error('Inicia sesión en HoYoLAB para ver la ficha completa.');
  const d = await call(cookie, 'character/detail', uid, { character_ids: ids.map(Number) });
  const pm = d.property_map || {};
  const pname = (t) => pm[String(t)]?.name?.replace(/\u00a0/g, ' ') || String(t);
  const picon = (t) => pm[String(t)]?.icon || null;
  const prop = (p) => p && { type: p.property_type, name: pname(p.property_type), icon: picon(p.property_type), base: p.base, add: p.add, final: p.final ?? p.value, times: p.times || 0 };
  return (d.list || []).map((c) => {
    const b = c.base || c;
    return {
      id: b.id,
      name: b.name,
      element: b.element,
      rarity: b.rarity,
      level: b.level,
      friendship: b.fetter,
      constellation: b.actived_constellation_num,
      image: b.image || b.icon,
      icon: b.icon,
      weapon: c.weapon && {
        name: c.weapon.name,
        icon: c.weapon.icon,
        rarity: c.weapon.rarity,
        level: c.weapon.level,
        refinement: c.weapon.affix_level,
        main: prop(c.weapon.main_property),
        sub: prop(c.weapon.sub_property),
      },
      properties: [...(c.base_properties || []), ...(c.extra_properties || []), ...(c.element_properties || [])].map(prop),
      selected: (c.selected_properties || []).map(prop),
      constellations: (c.constellations || []).sort((x, y) => x.pos - y.pos).map((k) => ({ name: k.name, icon: k.icon, active: !!k.is_actived, effect: k.effect })),
      skills: (c.skills || []).filter((s) => s.skill_type === 1).map((s) => ({ name: s.name, icon: s.icon, level: s.level })),
      passives: (c.skills || []).filter((s) => s.skill_type === 2 && s.is_unlock !== false).map((s) => ({ name: s.name, icon: s.icon })),
      artifacts: (c.relics || []).sort((x, y) => x.pos - y.pos).map((r) => ({
        name: r.name,
        slot: r.pos_name,
        icon: r.icon,
        rarity: r.rarity,
        level: r.level,
        set: r.set?.name,
        setEffects: (r.set?.affixes || []).map((a) => ({ pieces: a.activation_number, effect: a.effect })),
        main: prop(r.main_property),
        subs: (r.sub_property_list || []).map(prop),
      })),
    };
  });
}

function logout({ read, write }) {
  saveCookies(read, write, null);
  write('hoyolab-cache.json', null);
  return { linked: false };
}

// Recompensa diaria de HoYoLAB: solo se consulta si ya la reclamaste hoy
// (la reclamas tú en la página oficial; la app no la reclama por ti).
const SIGN_ACT = 'e202102251931481';
const SIGN_PAGE = `https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=${SIGN_ACT}`;
async function signInfo(read) {
  const cookie = loadCookies(read);
  if (!cookie) return { linked: false, page: SIGN_PAGE };
  const r = await fetch(`https://sg-hk4e-api.hoyolab.com/event/sol/info?lang=es-es&act_id=${SIGN_ACT}`, { headers: { Cookie: cookie, Origin: 'https://act.hoyolab.com', Referer: 'https://act.hoyolab.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (j.retcode !== 0) return { linked: true, error: j.message || 'HoYoLAB no respondió.', page: SIGN_PAGE };
  return { linked: true, signed: !!j.data?.is_sign, days: j.data?.total_sign_day || 0, today: j.data?.today || null, page: SIGN_PAGE };
}

module.exports = { login, overview, logout, linked, server, details, signInfo, SIGN_PAGE };

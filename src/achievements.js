// Logros de Steam (Epic no ofrece los suyos a programas externos).
//  - Resumen por juego: ISteamUserStats/GetPlayerAchievements (clave + SteamID).
//  - Detalle: lo anterior + GetSchemaForGame (iconos, ocultos) +
//    GetGlobalAchievementPercentagesForApp (qué % de jugadores lo tiene).
// Las recomendaciones salen de esos datos: rareza y tipo de logro según su
// descripción. No se inventan estrategias concretas de cada juego.
const API = 'https://api.steampowered.com/ISteamUserStats';
const LANG = 'latam';
const SUMMARY_TTL = 7 * 86400000;
const NOSTATS_TTL = 30 * 86400000;
const DETAIL_TTL = 12 * 3600000;

async function getJson(url) {
  const r = await fetch(url);
  // Steam responde 400/403 cuando el juego no tiene logros o el perfil es privado
  if (!r.ok) {
    let body = null;
    try {
      body = await r.json();
    } catch {}
    const err = new Error(body?.playerstats?.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json();
}

async function playerAchievements(apiKey, steamId, appid) {
  const u = `${API}/GetPlayerAchievements/v1/?appid=${appid}&key=${encodeURIComponent(apiKey)}&steamid=${steamId}&l=${LANG}`;
  try {
    const j = await getJson(u);
    return j?.playerstats?.achievements || [];
  } catch (e) {
    if (/no stats|not found|no achievements/i.test(e.message) || e.status === 400) return null; // sin logros
    // 403 "Profile is not public" también sale con algún juego retirado de la
    // tienda: solo es un problema de privacidad si falla con todos (ver abajo).
    throw e;
  }
}

async function pool(items, n, fn, onStep) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const it = items[i++];
        try {
          await fn(it);
        } catch {
          // un juego que falla no corta la lectura del resto
        }
        onStep?.(++done, items.length);
      }
    })
  );
}

/**
 * Resumen de todos los juegos de Steam: total, conseguidos y último desbloqueo.
 * Solo vuelve a pedir los juegos jugados desde la última vez o con datos viejos.
 */
async function refreshSummary({ apiKey, steamId, games, read, write, onProgress }) {
  const cache = read('achievements.json', { games: {} });
  const now = Date.now();
  const todo = games.filter((g) => {
    const c = cache.games[g.appid];
    if (!c) return true;
    if (c.noStats) return now - c.at > NOSTATS_TTL;
    if (!c.unlocks || !c.got) return true; // datos de antes de guardar las fechas
    if (g.lastPlayed && g.lastPlayed * 1000 > c.at) return true;
    return now - c.at > SUMMARY_TTL;
  });
  let ok = 0;
  let denied = 0;
  await pool(
    todo,
    4,
    async (g) => {
      let list;
      try {
        list = await playerAchievements(apiKey, steamId, g.appid);
      } catch (e) {
        if (e.status === 403) {
          denied++;
          // Juego retirado o sin datos públicos: se vuelve a mirar dentro de un mes
          cache.games[g.appid] = { noStats: true, at: Date.now() };
        }
        throw e; // los 500 de Steam no se guardan: se reintentan la próxima vez
      }
      ok++;
      if (!list || !list.length) {
        cache.games[g.appid] = { noStats: true, at: Date.now() };
        return;
      }
      const got = list.filter((a) => a.achieved);
      cache.games[g.appid] = {
        total: list.length,
        done: got.length,
        lastUnlock: Math.max(0, ...got.map((a) => a.unlocktime || 0)) || null,
        unlocks: got.map((a) => a.unlocktime || 0).filter(Boolean),
        got: got.map((a) => [a.apiname, a.unlocktime || 0]),
        at: Date.now(),
      };
    },
    (d, t) => onProgress?.(d, t)
  );
  if (todo.length && !ok && denied) {
    throw new Error('Steam no deja ver tus logros: pon "Detalles de juegos" en Público en la privacidad de tu perfil.');
  }
  cache.at = now;
  write('achievements.json', cache);
  return cache;
}

function rarity(pct) {
  if (pct == null) return { key: 'unknown', label: 'Rareza desconocida' };
  if (pct >= 50) return { key: 'common', label: 'Común' };
  if (pct >= 20) return { key: 'uncommon', label: 'Poco común' };
  if (pct >= 5) return { key: 'rare', label: 'Raro' };
  if (pct >= 1) return { key: 'epic', label: 'Muy raro' };
  return { key: 'legend', label: 'Ultra raro' };
}

// Tipo de logro según su descripción (inglés o español) y consejo general.
const KINDS = [
  {
    key: 'difficulty',
    re: /(dificultad|difficulty|hard mode|modo dif[ií]cil|nightmare|pesadilla|hardcore|legendar|insane|very hard|muy dif[ií]cil)/i,
    tip: 'Pide jugar en una dificultad alta. Si el juego lo permite, empieza una partida aparte solo para esto o apúntate los tramos que más cuestan.',
  },
  {
    key: 'challenge',
    re: /(sin morir|without dying|no damage|sin recibir da[ñn]o|without taking damage|deathless|in under|en menos de|speedrun|sin usar|without using|flawless|perfect)/i,
    tip: 'Es un desafío. Practica antes la zona o el jefe y hazlo en un intento dedicado; guardar antes de intentarlo ayuda si el juego lo permite.',
  },
  {
    key: 'online',
    re: /(online|en l[ií]nea|multijugador|multiplayer|ranked|clasificat|pvp|co-?op|cooperativ|with a friend|con un amigo|matchmaking)/i,
    tip: 'Es de juego en línea o cooperativo. Juega con amigos o búscalos en los foros del juego; algunos se hacen más rápido con alguien que también lo necesite.',
  },
  {
    key: 'collect',
    re: /(colecciona|collect|encuentra todos|find all|todos los|all the|every |cada |obt[eé]n todos|unlock all|desbloquea todos|descubre todos|discover all)/i,
    tip: 'Es de coleccionables. Usa un mapa o una guía de ubicaciones y comprueba si hay alguno que se pierde al avanzar.',
  },
  {
    key: 'grind',
    re: /(\d[\d.,]*\s*(veces|times|kills|enemigos|enemies|monedas|coins|gold|oro|partidas|matches|games|horas|hours|niveles|levels))|(alcanza el nivel|reach level|level \d+|nivel \d+)/i,
    tip: 'Es acumulativo: sale solo a base de jugar. Combínalo con otros logros pendientes para no repetir lo mismo.',
  },
  {
    key: 'story',
    re: /(completa|completar|termina|terminar|finish|complete|beat|derrota a|defeat|cap[ií]tulo|chapter|acto|act |historia|story|final|ending|campaign|campa[ñn]a)/i,
    tip: 'Es de historia: sale al avanzar en la campaña principal. Si tiene varios finales, mira cuál hace falta antes de la parte final.',
  },
];

function classify(a) {
  if (a.hidden && !a.description) {
    return { key: 'hidden', tip: 'Es un logro oculto: Steam no publica su descripción. Busca la guía si no te importan los spoilers.' };
  }
  const text = `${a.name || ''} ${a.description || ''}`;
  const k = KINDS.find((x) => x.re.test(text));
  return k ? { key: k.key, tip: k.tip } : { key: 'other', tip: null };
}

const KIND_LABEL = {
  story: 'Historia',
  difficulty: 'Dificultad',
  challenge: 'Desafío',
  online: 'En línea',
  collect: 'Coleccionables',
  grind: 'Acumulativo',
  hidden: 'Oculto',
  other: null,
};

/** Detalle de un juego con recomendaciones. */
async function detail({ apiKey, steamId, appid, read, write }) {
  const cache = read('achievements-detail.json', {});
  const c = cache[appid];
  if (c && Date.now() - c.at < DETAIL_TTL) return c.data;

  const [player, schema, global] = await Promise.all([
    playerAchievements(apiKey, steamId, appid),
    getJson(`${API}/GetSchemaForGame/v2/?appid=${appid}&key=${encodeURIComponent(apiKey)}&l=${LANG}`).catch(() => null),
    getJson(`${API}/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => null),
  ]);
  if (!player) return { appid, total: 0, list: [] };

  const sch = new Map((schema?.game?.availableGameStats?.achievements || []).map((a) => [a.name, a]));
  const pct = new Map((global?.achievementpercentages?.achievements || []).map((a) => [a.name, Number(a.percent)]));
  const list = player.map((p) => {
    const s = sch.get(p.apiname) || {};
    const a = {
      api: p.apiname,
      name: p.name || s.displayName || p.apiname,
      description: p.description || s.description || '',
      hidden: !!s.hidden,
      icon: s.icon || null,
      iconGray: s.icongray || s.icon || null,
      achieved: !!p.achieved,
      unlockTime: p.unlocktime || null,
      globalPct: pct.has(p.apiname) ? pct.get(p.apiname) : null,
    };
    const kind = classify(a);
    a.kind = kind.key;
    a.kindLabel = KIND_LABEL[kind.key];
    a.tip = kind.tip;
    a.rarity = rarity(a.globalPct);
    return a;
  });

  const missing = list.filter((a) => !a.achieved).sort((a, b) => (b.globalPct ?? -1) - (a.globalPct ?? -1));
  const got = list.filter((a) => a.achieved).sort((a, b) => (b.unlockTime || 0) - (a.unlockTime || 0));
  const data = { appid, total: list.length, done: got.length, missing, got, advice: advice(list, missing), at: Date.now() };
  cache[appid] = { at: Date.now(), data };
  write('achievements-detail.json', cache);
  return data;
}

function advice(list, missing) {
  const out = [];
  if (!list.length) return out;
  if (!missing.length) {
    out.push('Platino conseguido: tienes todos los logros de este juego.');
    return out;
  }
  const easy = missing.filter((a) => (a.globalPct ?? 0) >= 20);
  const hard = missing.filter((a) => a.globalPct != null && a.globalPct < 5);
  if (easy.length) {
    out.push(`Empieza por ${easy.length === 1 ? 'el más fácil' : `los ${easy.length} más fáciles`}: ${easy.length === 1 ? 'lo tiene' : 'los tiene'} al menos 1 de cada 5 jugadores.`);
  }
  const byKind = {};
  for (const a of missing) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
  const parts = Object.entries(byKind)
    .filter(([k]) => KIND_LABEL[k])
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} de ${KIND_LABEL[k].toLowerCase()}`);
  if (parts.length) out.push(`Lo que te falta: ${parts.join(', ')}.`);
  if (byKind.collect) out.push('Hay logros de coleccionables: revisa una guía de ubicaciones antes de avanzar demasiado, por si alguno se pierde.');
  if (byKind.online) out.push('Algunos requieren jugar en línea: conviene hacerlos pronto, por si algún día cierran los servidores.');
  if (hard.length) {
    const hardest = hard.sort((a, b) => a.globalPct - b.globalPct)[0];
    out.push(`El más difícil es «${hardest.name}»: solo lo tiene el ${fmtPct(hardest.globalPct)} de los jugadores. Déjalo para el final.`);
  }
  return out;
}

function fmtPct(p) {
  return `${p < 1 ? p.toFixed(1) : Math.round(p)}%`;
}

// ---------- Amigos ----------
const USER_API = 'https://api.steampowered.com/ISteamUser';
const FRIENDS_TTL = 12 * 3600000;

/** Compara un juego con tus amigos de Steam que tengan el perfil público. */
async function friendsCompare({ apiKey, steamId, appid, read, write }) {
  const cache = read('friends-achievements.json', {});
  const c = cache[appid];
  if (c && Date.now() - c.at < FRIENDS_TTL) return c.data;

  let list;
  try {
    list = await getJson(`${USER_API}/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&relationship=friend`);
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('Tu lista de amigos de Steam es privada: hazla visible en la privacidad de tu perfil para comparar.');
    throw e;
  }
  const ids = (list?.friendslist?.friends || []).map((f) => f.steamid).slice(0, 100);
  if (!ids.length) return { friends: [], byAch: {}, total: 0 };
  const sum = await getJson(`${USER_API}/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${ids.join(',')}`);
  const people = (sum?.response?.players || []).filter((p) => p.communityvisibilitystate === 3);

  const friends = [];
  const byAch = {};
  await pool(people, 6, async (p) => {
    const ach = await playerAchievements(apiKey, p.steamid, appid);
    if (!ach || !ach.length) return; // no lo tiene o no comparte sus logros
    const got = ach.filter((a) => a.achieved);
    if (!got.length) return;
    friends.push({ name: p.personaname, avatar: p.avatar, done: got.length, total: ach.length });
    for (const a of got) (byAch[a.apiname] ||= []).push(p.personaname);
  });
  friends.sort((a, b) => b.done - a.done);
  const data = { friends, byAch, checked: people.length, total: ids.length, at: Date.now() };
  cache[appid] = { at: Date.now(), data };
  write('friends-achievements.json', cache);
  return data;
}

// ---------- Aviso de logros nuevos mientras juegas ----------
/** Devuelve los logros conseguidos desde la última llamada (la primera solo toma nota). */
function unlockWatcher({ apiKey, steamId, appid }) {
  let known = null;
  return async () => {
    const list = await playerAchievements(apiKey, steamId, appid);
    if (!list) return [];
    const got = list.filter((a) => a.achieved);
    if (!known) {
      known = new Set(got.map((a) => a.apiname));
      return [];
    }
    const fresh = got.filter((a) => !known.has(a.apiname));
    for (const a of fresh) known.add(a.apiname);
    return fresh.map((a) => ({ name: a.name || a.apiname, description: a.description || '' }));
  };
}

// ---------- Vitrina ----------
const GLOBAL_TTL = 7 * 86400000;
const SCHEMA_TTL = 30 * 86400000;

/**
 * Tus logros más raros, los últimos que conseguiste y tu racha de días seguidos
 * consiguiendo alguno. Usa la rareza global y los nombres de cada juego (con caché).
 */
async function showcase({ apiKey, read, write }) {
  const summary = read('achievements.json', { games: {} });
  const globals = read('ach-global.json', {});
  const schemas = read('ach-schema.json', {});
  const now = Date.now();
  const games = Object.entries(summary.games).filter(([, c]) => c.got && c.got.length);
  await pool(games, 6, async ([appid]) => {
    if (!globals[appid] || now - globals[appid].at > GLOBAL_TTL) {
      const j = await getJson(`${API}/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => null);
      globals[appid] = { at: now, pct: Object.fromEntries((j?.achievementpercentages?.achievements || []).map((a) => [a.name, Number(a.percent)])) };
    }
    if (!schemas[appid] || now - schemas[appid].at > SCHEMA_TTL) {
      const j = await getJson(`${API}/GetSchemaForGame/v2/?appid=${appid}&key=${encodeURIComponent(apiKey)}&l=${LANG}`).catch(() => null);
      schemas[appid] = { at: now, a: Object.fromEntries((j?.game?.availableGameStats?.achievements || []).map((a) => [a.name, [a.displayName, a.icon, a.description || '']])) };
    }
  });
  write('ach-global.json', globals);
  write('ach-schema.json', schemas);

  const all = [];
  for (const [appid, c] of games) {
    for (const [api, time] of c.got) {
      const s = schemas[appid]?.a?.[api];
      all.push({ appid: Number(appid), api, time, pct: globals[appid]?.pct?.[api] ?? null, name: s?.[0] || api, icon: s?.[1] || null, description: s?.[2] || '' });
    }
  }
  const rarest = all.filter((a) => a.pct != null).sort((a, b) => a.pct - b.pct).slice(0, 12);
  const recent = [...all].filter((a) => a.time).sort((a, b) => b.time - a.time).slice(0, 10);

  // Racha: días seguidos (hasta hoy o ayer) con al menos un logro
  const days = new Set(all.filter((a) => a.time).map((a) => new Date(a.time * 1000).toDateString()));
  const dayMs = 86400000;
  let cur = 0;
  let d = new Date();
  if (!days.has(d.toDateString())) d = new Date(d.getTime() - dayMs);
  while (days.has(d.toDateString())) {
    cur++;
    d = new Date(d.getTime() - dayMs);
  }
  const sorted = [...days].map((x) => new Date(x).getTime()).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i && Math.round((sorted[i] - sorted[i - 1]) / dayMs) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { rarest, recent, streak: { current: cur, best }, rare: all.filter((a) => a.pct != null && a.pct < 5).length, total: all.length };
}

module.exports = { refreshSummary, detail, friendsCompare, unlockWatcher, showcase };

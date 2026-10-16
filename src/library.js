// Combina Steam y Epic en una sola lista y detecta juegos nuevos.
const steam = require('./steam');
const epic = require('./epic');
const meta = require('./meta');

// Tipos de la tienda de Steam que no son juegos: 6 software, 13 herramienta,
// 3 película, 7 vídeo, 8 serie, 9 episodio, 10 hardware, 11 música.
const NON_GAME_TYPES = new Set([3, 6, 7, 8, 9, 10, 11, 13]);

function steamGame(appid, { name, installed, lastPlayed, playtime, playtime2w, store, purchased }) {
  const inst = installed || null;
  const fallbacks = steam.fallbackCovers(appid);
  return {
    id: `steam:${appid}`,
    store: 'steam',
    kind: NON_GAME_TYPES.has(store?.type) ? 'tool' : 'game',
    title: store?.name || name || inst?.name || `App ${appid}`,
    cover: store?.cover || fallbacks[0],
    hero: store?.hero || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`,
    coverFallbacks: [store?.header, ...fallbacks].filter(Boolean),
    installed: !!inst && (inst.flags & 4) !== 0,
    installPath: inst?.installPath || null,
    updatePending: !!inst?.updatePending,
    updateText: inst?.updateText || null,
    lastPlayed: lastPlayed || null,
    purchased: purchased || null,
    playtimeMin: playtime || 0,
    playtime2wMin: playtime2w || 0,
    sizeBytes: inst?.sizeOnDisk || null,
    franchise: store?.franchise || null,
    tagIds: store?.tagIds || [],
    released: store?.released || null,
    launchUrl: `steam://rungameid/${appid}`,
    installUrl: `steam://install/${appid}`,
    storeUrl: `https://store.steampowered.com/app/${appid}/`,
  };
}

function epicGame(appName, { owned, installed, latestVersion, lastPlayed }) {
  const inst = installed || null;
  let updateText = null;
  if (inst) {
    if (latestVersion && inst.version && latestVersion !== inst.version) {
      updateText = `Actualización pendiente (${short(inst.version)} → ${short(latestVersion)})`;
    } else if (inst.pendingVersion) {
      updateText = `Actualización a medias en el launcher (${short(inst.pendingVersion)})`;
    } else if (inst.incomplete) {
      updateText = 'Instalación incompleta';
    }
  }
  const title = owned?.title || inst?.title || appName;
  const enc = encodeURIComponent(appName);
  return {
    id: `epic:${appName}`,
    store: 'epic',
    kind: 'game',
    title,
    cover: owned?.cover || inst?.cover || null,
    hero: owned?.hero || null,
    coverFallbacks: [],
    installed: !!inst,
    installPath: inst?.installLocation || null,
    updatePending: !!updateText,
    updateText,
    lastPlayed: lastPlayed || null, // deducida de Windows y del log del launcher
    purchased: null, // Epic no expone la fecha de compra
    playtimeMin: 0, // Epic no da las horas a programas externos
    sizeBytes: inst?.sizeBytes || null,
    launchUrl: `com.epicgames.launcher://apps/${enc}?action=launch&silent=true`,
    installUrl: `com.epicgames.launcher://apps/${enc}?action=install`,
    storeUrl: null,
  };
}

function short(v) {
  const m = String(v).match(/Release-([\d.]+)/);
  return m ? m[1] : String(v).length > 18 ? String(v).slice(0, 16) + '…' : v;
}

async function loadSteam({ apiKey, steamId, purchaseDates, warnings }) {
  const steamPath = await steam.findSteamPath();
  if (!steamPath) {
    warnings.push('No se ha encontrado la instalación de Steam.');
    return { games: [], steamId, source: 'none' };
  }
  const installed = steam.readInstalled(steamPath);
  const id = steamId || steam.detectSteamId(steamPath);
  const localPlayed = steam.readLocalLastPlayed(steamPath, id);

  let owned = [];
  if (apiKey && id) {
    try {
      owned = await steam.getOwnedGames(apiKey, id);
    } catch (e) {
      warnings.push(`Steam: ${e.message} Se muestran solo los juegos instalados.`);
    }
  } else {
    warnings.push('Steam: sin clave de la API o sin SteamID64, solo se muestran los juegos instalados. Configúralo en Ajustes.');
  }

  const entries = new Map();
  for (const g of owned) {
    entries.set(g.appid, {
      name: g.name,
      lastPlayed: g.rtime_last_played || localPlayed.get(g.appid) || null,
      playtime: g.playtime_forever || 0,
      playtime2w: g.playtime_2weeks || 0,
    });
  }
  for (const [appid, inst] of installed) {
    if (!entries.has(appid)) entries.set(appid, { name: inst.name, lastPlayed: localPlayed.get(appid) || null });
  }

  const storeItems = await steam.getStoreItems([...entries.keys()]);
  const games = [...entries].map(([appid, e]) =>
    steamGame(appid, {
      ...e,
      installed: installed.get(appid),
      store: storeItems.get(appid),
      purchased: purchaseDates[appid] || null,
    })
  );
  return { games, steamId: id, source: owned.length ? 'api' : 'local' };
}

async function loadEpic({ legendaryPath, warnings, previous }) {
  const cache = epic.readCatalogCache();
  const installed = epic.readInstalled();
  const played = await epic.readLastPlayed(installed);
  // Los logs del launcher rotan: se conserva la última fecha ya conocida.
  const prevPlayed = new Map((previous?.games || []).filter((g) => g.store === 'epic').map((g) => [g.id, g.lastPlayed]));
  let lib = new Map();
  let source = cache.games.size ? 'cache' : 'none';

  const exe = await epic.findLegendary(legendaryPath);
  if (exe) {
    const st = await epic.legendaryStatus(exe);
    if (st.loggedIn) {
      try {
        lib = await epic.legendaryLibrary(exe);
        source = 'legendary';
      } catch (e) {
        warnings.push(`Epic (legendary): ${e.message}`);
      }
    } else {
      warnings.push('Epic: legendary está instalado pero no has vinculado tu cuenta (Ajustes → Vincular Epic).');
    }
  }
  if (source === 'cache') {
    const when = cache.updatedAt ? new Date(cache.updatedAt).toLocaleDateString('es-ES') : '?';
    warnings.push(
      `Epic: biblioteca leída de la caché del Epic Games Launcher (${when}). Para la lista completa y los avisos de actualización, vincula Epic con legendary.`
    );
  } else if (source === 'none' && !lib.size) {
    warnings.push('Epic: no se ha encontrado la caché del launcher ni legendary.');
  }

  const names = new Set([...cache.games.keys(), ...lib.keys(), ...installed.keys()]);
  const games = [...names].map((n) => {
    const l = lib.get(n);
    const c = cache.games.get(n);
    const owned = l ? { ...c, ...l, cover: l.cover || c?.cover, hero: l.hero || c?.hero } : c;
    const lastPlayed = Math.max(played.get(n) || 0, prevPlayed.get(`epic:${n}`) || 0) || null;
    return epicGame(n, { owned, installed: installed.get(n), latestVersion: l?.latestVersion, lastPlayed });
  });
  return { games, source };
}

async function refresh({ apiKey, settings, previous, purchaseDates, cache }) {
  const warnings = [];
  const [s, e] = await Promise.all([
    loadSteam({ apiKey, steamId: settings.steamId, purchaseDates, warnings }),
    loadEpic({ legendaryPath: settings.legendaryPath, warnings, previous }),
  ]);
  const games = [...s.games, ...e.games];
  await meta.enrich(games, { ...cache, warnings });

  // Solo se marcan como nuevos los juegos de una tienda si la lectura anterior
  // usó la misma fuente (si no, al añadir la clave de Steam todo saldría "nuevo").
  const sources = { steam: s.source, epic: e.source };
  const prevSources = previous?.sources || {};
  const prevKnown = new Set(previous?.knownIds || []);
  const comparable = (g) => previous?.knownIds && prevSources[g.store] === sources[g.store];
  const newIds = games.filter((g) => comparable(g) && !prevKnown.has(g.id)).map((g) => g.id);
  // Un fallo de red no debe hacer que desaparezcan juegos "conocidos"
  const knownIds = [...new Set([...prevKnown, ...games.map((g) => g.id)])];

  return {
    games,
    newIds,
    knownIds,
    warnings,
    steamId: s.steamId,
    sources,
    refreshedAt: Date.now(),
  };
}

module.exports = { refresh };

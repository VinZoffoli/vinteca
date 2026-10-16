// Categorías (etiquetas de la tienda de Steam) y sagas.
//  - Los juegos de Steam traen sus etiquetas y su franquicia de GetItems.
//  - Los de Epic se buscan por nombre en la tienda de Steam (storesearch) y se
//    toman de ahí; la correspondencia se guarda en caché para no repetirla.
//  - Una saga es una franquicia (o, si Steam no da ninguna, un nombre base
//    común) con al menos dos juegos distintos.
const steam = require('./steam');

const TAGS_TTL = 7 * 86400000;
const MISS_RETRY = 30 * 86400000;
// Sube este número si cambia cómo se emparejan los nombres: se repiten los fallos.
const MAP_VERSION = 2;
const MAX_TAGS = 8;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`´]/g, '') // "Assassin's" y "Assassins" son lo mismo
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EDITION_WORDS =
  /\b(tech beta|beta|playtest|demo|modkit|remastered|remaster|remake|definitive|enhanced|edition|goty|game of the year|complete|collection|deluxe|ultimate|director s cut|directors cut|redux|hd|anniversary|reloaded|standard|digital|premium|gold|legendary|final cut|the final cut)\b/g;

// "Resident Evil 2" -> "resident evil", "Hollow Knight: Silksong" -> "hollow knight"
function baseKey(title) {
  let t = String(title || '').split(/\s*[:–—]\s*|\s+-\s*|\s*\(/)[0];
  t = norm(t).replace(EDITION_WORDS, ' ');
  t = t.replace(/\s+(\d+|[ivx]+|19\d\d|20\d\d)(\s+\d+)*$/g, '');
  t = t.replace(/\s+(season|episode|ep|part|chapter|volume|vol|temporada|episodio|capitulo)$/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

function strip(s) {
  return norm(s).replace(EDITION_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

async function pool(items, n, fn) {
  let i = 0;
  let stop = false;
  const workers = Array.from({ length: n }, async () => {
    while (!stop && i < items.length) {
      const it = items[i++];
      try {
        await fn(it);
      } catch (e) {
        if (e.status === 429) stop = true;
      }
    }
  });
  await Promise.all(workers);
  return { stopped: stop, remaining: Math.max(0, items.length - i) };
}

/**
 * Busca en la tienda de Steam los juegos de las demás tiendas (Epic, Riot,
 * GOG...) para tomar sus etiquetas, franquicia y, si no tienen, la carátula.
 */
async function enrichEpic(games, { read, write, warnings }) {
  const epicGames = games.filter((g) => g.store !== 'steam');
  const map = read('epic-steam-map.json', {});
  const now = Date.now();
  const todo = epicGames.filter((g) => {
    const m = map[g.id];
    return !m || (!m.appid && (m.v !== MAP_VERSION || now - m.at > MISS_RETRY));
  });

  if (todo.length) {
    const res = await pool(todo, 3, async (g) => {
      const items = await steam.searchStore(g.title.replace(/[™®©]/g, ''));
      const want = norm(g.title);
      const wantStripped = strip(g.title);
      const hit =
        items.find((i) => norm(i.name) === want) || items.find((i) => strip(i.name) === wantStripped) || null;
      map[g.id] = { appid: hit ? hit.appid : 0, at: now, v: MAP_VERSION };
    });
    write('epic-steam-map.json', map);
    if (res.stopped) {
      warnings.push(
        `Categorías de Epic: Steam ha limitado las búsquedas; faltan ${res.remaining} juegos, se completarán al pulsar Actualizar más tarde.`
      );
    }
  }

  const ids = [...new Set(epicGames.map((g) => map[g.id]?.appid).filter(Boolean))];
  if (!ids.length) return;
  const items = await steam.getStoreItems(ids, { assets: true });
  for (const g of epicGames) {
    const it = items.get(map[g.id]?.appid);
    if (!it) continue;
    g.franchise = it.franchise || null;
    g.tagIds = it.tagIds || [];
    g.released = it.released || null;
    g.steamAppid = map[g.id].appid; // mismo juego en Steam: requisitos, tráiler, DLC...
    if (!g.cover && it.cover) {
      g.cover = it.cover;
      g.coverFallbacks = [it.header].filter(Boolean);
    }
    if (!g.hero && it.hero) g.hero = it.hero;
  }
}

async function applyTagNames(games, { read, write, warnings }) {
  let cache = read('tags.json', null);
  if (!cache || cache.lang !== steam.LANGUAGE || Date.now() - cache.at > TAGS_TTL) {
    try {
      cache = { at: Date.now(), lang: steam.LANGUAGE, names: await steam.getTagNames() };
      write('tags.json', cache);
    } catch (e) {
      if (!cache) {
        warnings.push(`No se pudieron leer los nombres de las categorías: ${e.message}`);
        cache = { names: {} };
      }
    }
  }
  for (const g of games) {
    g.tags = (g.tagIds || [])
      .map((id) => cache.names[id])
      .filter(Boolean)
      .slice(0, MAX_TAGS);
    delete g.tagIds;
  }
}

/** Asigna g.saga a los juegos que comparten franquicia o nombre base con otros. */
function assignSagas(games) {
  const list = games.filter((g) => g.kind !== 'tool');
  const groups = new Map(); // clave -> { name, games: [] }
  const add = (key, name, g) => {
    if (!groups.has(key)) groups.set(key, { name, games: [] });
    groups.get(key).games.push(g);
  };

  // 1) Franquicias de Steam. A veces Steam pone ahí la editora ("Team17
  //    Digital", "PlayStation Studios"): solo vale si el nombre sale en el título.
  const franchiseKeys = [];
  for (const g of list) {
    g._rawFranchise = g.franchise;
    if (g.franchise && !(' ' + norm(g.title) + ' ').includes(' ' + norm(g.franchise) + ' ')) g.franchise = null;
  }
  // 1b) Si el título empieza por otra franquicia más general, manda esa:
  //     "The Elder Scrolls V: Skyrim" viene como "Skyrim" pero va con "The Elder Scrolls".
  const franchiseNames = new Map();
  for (const g of list) if (g.franchise) franchiseNames.set(norm(g.franchise), g.franchise);
  for (const g of list) {
    if (!g.franchise) continue;
    const t = norm(g.title);
    const own = norm(g.franchise);
    if (t.startsWith(own)) continue;
    const better = [...franchiseNames.keys()]
      .filter((k) => k !== own && k.length >= 4 && t.startsWith(k + ' '))
      .sort((a, b) => b.length - a.length)[0];
    if (better) g.franchise = franchiseNames.get(better);
  }
  for (const g of list) {
    if (!g.franchise) continue;
    const key = norm(g.franchise);
    if (!groups.has(key)) franchiseKeys.push(key);
    add(key, g.franchise, g);
  }
  // 2) Sin franquicia: se unen a una franquicia si su nombre empieza igual,
  //    o se agrupan por nombre base.
  for (const g of list) {
    if (g.franchise) continue;
    const t = norm(g.title);
    const fk = franchiseKeys.find((k) => k.length >= 4 && (t === k || t.startsWith(k + ' ')));
    if (fk) {
      add(fk, groups.get(fk).name, g);
      continue;
    }
    const key = baseKey(g.title);
    if (!key || key.length < 3) continue;
    add('t:' + key, null, g);
  }
  // 3) Nombres base que son prefijo de otro ("portal" / "portal stories")
  const tKeys = [...groups.keys()].filter((k) => k.startsWith('t:')).sort((a, b) => a.length - b.length);
  for (const k of tKeys) {
    if (!groups.has(k)) continue;
    const base = k.slice(2);
    for (const other of tKeys) {
      if (other === k || !groups.has(other)) continue;
      if (other.slice(2).startsWith(base + ' ')) {
        groups.get(k).games.push(...groups.get(other).games);
        groups.delete(other);
      }
    }
  }

  // 4) Series sin franquicia en Steam que comparten las dos primeras palabras
  //    ("Tales of Symphonia" / "Tales of Berseria"). Solo juegos para los que
  //    Steam no da ninguna franquicia: "Tales of the Neon Sea" trae la suya
  //    (su editora) y así no se cuela.
  const distinctOf = (grp) => new Set(grp.games.map((g) => strip(g.title))).size;
  const STOP = new Set(['the', 'a', 'an', 'el', 'la', 'los', 'las', 'my', 'super', 'new', 'old', 'dark', 'dead', 'little', 'grand', 'world', 'star']);
  const byPrefix = new Map();
  for (const [key, grp] of groups) {
    if (!key.startsWith('t:') || distinctOf(grp) >= 2 || grp.games.some((g) => g._rawFranchise)) continue;
    const words = norm(grp.games[0].title).split(' ');
    if (words.length < 3 || STOP.has(words[0])) continue;
    const p = words.slice(0, 2).join(' ');
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(key);
  }
  for (const [p, keys] of byPrefix) {
    if (keys.length < 2) continue;
    const merged = keys.flatMap((k) => groups.get(k).games);
    for (const k of keys) groups.delete(k);
    groups.set('t:' + p, { name: null, games: merged });
  }

  for (const g of games) {
    g.saga = null;
    delete g._rawFranchise;
  }
  for (const [key, grp] of groups) {
    const distinct = new Set(grp.games.map((g) => strip(g.title)));
    if (distinct.size < 2) continue;
    let name = grp.name;
    if (!name) {
      // El título más corto, recortado a la longitud del nombre base
      const shortest = [...grp.games].sort((a, b) => a.title.length - b.title.length)[0].title;
      const base = key.slice(2);
      const words = base.split(' ').length;
      name = shortest.split(/\s*[:–—]\s*|\s+-\s*/)[0].split(/\s+/).slice(0, words).join(' ');
    }
    for (const g of grp.games) g.saga = name;
  }
}

async function enrich(games, cache) {
  try {
    await enrichEpic(games, cache);
  } catch (e) {
    cache.warnings.push(`Categorías de Epic: ${e.message}`);
  }
  await applyTagNames(games, cache);
  assignSagas(games);
}

module.exports = { enrich, baseKey, assignSagas };

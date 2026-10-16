// Recomendaciones de juegos que no tienes, a partir de tus gustos:
//  - Tus gustos = categorías de tus juegos, pesadas por horas, tu nota y si los terminaste.
//  - Steam: búsqueda pública por categorías (IStoreQueryService/Query) y la
//    página "más como esto" de tus juegos favoritos.
//  - Epic: su escaparate público (storefrontLayout); cada juego se busca en
//    Steam para conocer sus categorías y ver si encaja contigo.
const steam = require('./steam');

const TTL = 12 * 3600000;
// Etiquetas que no dicen nada de tus gustos
const GENERIC = /^(un jugador|multijugador|cooperativos?( en línea| locales)?|gran banda sonora|buena trama|indie|casuales|2d|3d|primera persona|tercera persona|pixelados|ambientales|divertidos|adorables|protagonista femenina|free to play|acceso anticipado|clásicos|controles|jcj en línea|jcj)$/i;

// Etiquetas muy amplias: cuentan, pero menos
const BROAD = /^(acción|aventura|rol|estrategia|simulación|exploración)$/i;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Peso de cada categoría según tus juegos. */
function profile(games, user) {
  const w = new Map();
  for (const g of games) {
    if (!g.tags?.length || g.kind === 'tool') continue;
    const u = user[g.id] || {};
    let gw = 0.3 + Math.log1p((g.playtimeMin || 0) / 60);
    if (u.rating) gw += (u.rating - 3) * 1.2;
    if (u.status === 'finished') gw += 0.8;
    if (u.status === 'dropped') gw -= 1;
    if (u.fav) gw += 1;
    if (gw <= 0) continue;
    g.tags.forEach((t, i) => {
      if (GENERIC.test(t)) return;
      w.set(t, (w.get(t) || 0) + (gw / (1 + i * 0.3)) * (BROAD.test(t) ? 0.45 : 1));
    });
  }
  return [...w].sort((a, b) => b[1] - a[1]);
}

function scoreTags(tags, prof) {
  const top = new Map(prof.slice(0, 25));
  const matched = (tags || []).filter((t) => top.has(t));
  const score = matched.reduce((s, t, i) => s + top.get(t) / (1 + i * 0.2), 0);
  return { score, matched: matched.slice(0, 3) };
}

async function steamQueryByTag(tagid, country, count = 40) {
  const q = {
    query: { start: 0, count, sort: 10, filters: { released_only: true, type_filters: { include_games: true }, tagids_must_match: [{ tagids: [tagid] }] } },
    context: { language: steam.LANGUAGE, country_code: country },
    data_request: { include_basic_info: false },
  };
  const r = await fetch(`https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=${encodeURIComponent(JSON.stringify(q))}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.response?.ids || j.response?.store_items || []).map((x) => x.appid).filter(Boolean);
}

async function steamMoreLike(appid) {
  const r = await fetch(`https://store.steampowered.com/recommended/morelike/app/${appid}/?l=latam&cc=CL`);
  if (!r.ok) return [];
  const html = await r.text();
  return [...new Set([...html.matchAll(/data-ds-appid="(\d+)"/g)].map((m) => Number(m[1])))];
}

/**
 * @param games biblioteca (con tags)   @param user datos propios por juego
 * @param tagIdByName nombre de categoría -> id de Steam   @param exclude appids que ya tienes o deseas
 */
async function build({ games, user, tagIdByName, exclude, read, write, force, country = 'CL' }) {
  const cache = read('recs.json', null);
  if (!force && cache && cache.country === country && Date.now() - cache.at < TTL) return cache.data;
  const prof = profile(games, user);
  const top = prof.slice(0, 4).filter(([t]) => tagIdByName[t]);

  // ---- Steam ----
  const reasons = new Map(); // appid -> motivo
  for (const [t] of top) {
    for (const id of await steamQueryByTag(tagIdByName[t], country).catch(() => [])) if (!exclude.has(id) && !reasons.has(id)) reasons.set(id, null);
  }
  // "Más como esto" de tus 3 juegos favoritos (nota, horas)
  const favs = games
    .filter((g) => g.store === 'steam' && g.kind !== 'tool')
    .map((g) => ({ g, s: (user[g.id]?.rating || 0) * 50 + (g.playtimeMin || 0) / 60 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  for (const { g } of favs) {
    for (const id of (await steamMoreLike(Number(g.id.split(':')[1])).catch(() => [])).slice(0, 15)) if (!exclude.has(id)) reasons.set(id, `Parecido a ${g.title}`);
  }
  const items = await steam.getStoreItemsRaw([...reasons.keys()], { include_assets: true, include_basic_info: true, include_tag_count: 12, include_reviews: true });
  const tagNames = Object.fromEntries(Object.entries(tagIdByName).map(([n, id]) => [id, n]));
  const steamRecs = items
    .filter((it) => it.type === 0 && it.visible !== false)
    .map((it) => {
      const tags = (it.tags || []).map((t) => tagNames[t.tagid]).filter(Boolean);
      const { score, matched } = scoreTags(tags, prof);
      const b = it.best_purchase_option;
      const pct = it.reviews?.summary_filtered?.percent_positive;
      return {
        store: 'steam',
        appid: it.appid,
        name: it.name,
        reason: reasons.get(it.appid) || (matched.length ? `Encaja con lo que juegas: ${matched.join(', ').toLowerCase()}` : null),
        matched,
        score: score + (pct ? (pct - 70) / 10 : 0),
        reviews: pct || null,
        price: it.is_free ? 'Gratis' : b?.formatted_final_price || null,
        discount: b?.discount_pct || 0,
        image: it.assets?.asset_url_format && it.assets.header ? 'https://shared.akamai.steamstatic.com/store_item_assets/' + it.assets.asset_url_format.replace('${FILENAME}', it.assets.header) : null,
        url: `https://store.steampowered.com/app/${it.appid}/`,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  // ---- Epic ----
  let epicRecs = [];
  try {
    const r = await fetch(`https://store-site-backend-static-ipv4.ak.epicgames.com/storefrontLayout?locale=es-ES&country=${country}&start=0&count=30`);
    const j = await r.json();
    const owned = new Set(games.map((g) => norm(g.title)));
    const seen = new Map();
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.title && o.offerType && (o.categories || []).some((c) => c.path === 'games')) {
        if (o.offerType === 'BASE_GAME' && !owned.has(norm(o.title)) && !seen.has(norm(o.title))) seen.set(norm(o.title), o);
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
    };
    walk(j.data);
    const offers = [...seen.values()].slice(0, 80);
    // Categorías: del mismo juego en Steam (con caché de la búsqueda)
    const map = read('epic-store-map.json', {});
    let i = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (i < offers.length) {
          const o = offers[i++];
          if (map[o.id] !== undefined) continue;
          try {
            const found = await steam.searchStore(o.title);
            const hit = found.find((f) => norm(f.name) === norm(o.title));
            map[o.id] = hit ? hit.appid : 0;
          } catch (e) {
            if (e.status === 429) break;
          }
        }
      })
    );
    write('epic-store-map.json', map);
    const ids = offers.map((o) => map[o.id]).filter(Boolean);
    const sItems = ids.length ? await steam.getStoreItemsRaw(ids, { include_tag_count: 12 }) : [];
    const tagsById = new Map(sItems.map((it) => [it.appid, (it.tags || []).map((t) => tagNames[t.tagid]).filter(Boolean)]));
    epicRecs = offers
      .map((o) => {
        const tags = tagsById.get(map[o.id]) || [];
        const { score, matched } = scoreTags(tags, prof);
        const img = (o.keyImages || []).find((k) => k.type === 'OfferImageWide') || (o.keyImages || []).find((k) => k.type === 'DieselStoreFrontWide') || (o.keyImages || [])[0];
        const slug = o.productSlug?.replace(/\/home$/, '') || o.offerMappings?.[0]?.pageSlug || o.catalogNs?.mappings?.[0]?.pageSlug;
        const p = o.price?.totalPrice;
        return {
          store: 'epic',
          name: o.title,
          matched,
          score,
          reason: matched.length ? `Encaja con lo que juegas: ${matched.join(', ').toLowerCase()}` : null,
          price: p ? (p.discountPrice === 0 ? 'Gratis' : p.fmtPrice?.discountPrice) : null,
          discount: p && p.originalPrice ? Math.round((1 - p.discountPrice / p.originalPrice) * 100) : 0,
          image: img?.url ? `${img.url}${img.url.includes('?') ? '' : '?h=270&w=480&resize=1'}` : null,
          url: slug ? `https://store.epicgames.com/es-ES/p/${slug}` : 'https://store.epicgames.com/es-ES/',
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 16);
  } catch {}

  const data = { profile: prof.slice(0, 8).map(([t, v]) => ({ tag: t, weight: Math.round(v * 10) / 10 })), steam: steamRecs, epic: epicRecs, at: Date.now() };
  write('recs.json', { at: Date.now(), country, data });
  return data;
}

module.exports = { build, profile };

// Novedades: anuncios oficiales de tus juegos (noticias de Steam, que son
// públicas) y próximos lanzamientos de tu lista de deseados.
const steam = require('./steam');

const NEWS_TTL = 6 * 3600000;

// Las noticias vienen con BBCode e imágenes: se deja solo el texto.
function cleanText(s) {
  return String(s || '')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, ' ')
    .replace(/\[previewyoutube=[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, ' ')
    .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function newsForApp(appid) {
  const u = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=3&maxlength=600&feeds=steam_community_announcements&format=json`;
  const r = await fetch(u);
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.appnews?.newsitems || []).map((n) => ({
    gid: n.gid,
    title: n.title,
    date: n.date,
    text: cleanText(n.contents).slice(0, 320),
    url: `https://store.steampowered.com/news/app/${appid}/view/${n.gid}`,
    patch: /patch|update|hotfix|parche|actualizaci|fix/i.test(n.title),
  }));
}

/** Noticias de varios juegos de Steam, con caché de 6 horas por juego. */
async function news(appids, { read, write }) {
  const cache = read('news.json', {});
  const now = Date.now();
  const todo = appids.filter((id) => !cache[id] || now - cache[id].at > NEWS_TTL);
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < todo.length) {
        const id = todo[i++];
        try {
          cache[id] = { at: now, items: await newsForApp(id) };
        } catch {}
      }
    })
  );
  write('news.json', cache);
  const out = [];
  for (const id of appids) for (const n of cache[id]?.items || []) out.push({ appid: id, ...n });
  return out.sort((a, b) => b.date - a.date);
}

/** Próximos lanzamientos de la lista de deseados. */
async function releases(appids) {
  const items = await steam.getStoreItemsRaw(appids, { include_release: true, include_assets: true });
  const now = Date.now() / 1000;
  return items
    .filter((it) => it.release && (it.release.is_coming_soon || (it.release.steam_release_date || 0) > now))
    .map((it) => ({
      appid: it.appid,
      name: it.name,
      date: it.release.steam_release_date || null,
      // "date_full" = día exacto; otros valores (mes, trimestre, año) son aproximados
      exact: !it.release.coming_soon_display || it.release.coming_soon_display === 'date_full',
      label: it.release.custom_release_date_message || null,
      header: it.assets?.asset_url_format && it.assets.header
        ? 'https://shared.akamai.steamstatic.com/store_item_assets/' + it.assets.asset_url_format.replace('${FILENAME}', it.assets.header)
        : `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${it.appid}/header.jpg`,
    }))
    .sort((a, b) => (a.date || 9e12) - (b.date || 9e12));
}

// ---- Noticias de Nintendo (RSS públicos de dos medios) ----
const NINTENDO_FEEDS = [
  { source: 'Nintenderos', lang: 'es', url: 'https://www.nintenderos.com/feed/' },
  { source: 'Nintendo Life', lang: 'en', url: 'https://www.nintendolife.com/feeds/latest' },
];
const NINTENDO_TTL = 2 * 3600000;

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function parseRss(xml, feed) {
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
    return m ? decode(m[1]).trim() : '';
  };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15).map(([, b]) => {
    const html = tag(b, 'content:encoded') || tag(b, 'description');
    const img =
      b.match(/<media:content[^>]*url="([^"]+)"/)?.[1] ||
      b.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] ||
      b.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] ||
      html.match(/<img[^>]*src="([^"]+)"/)?.[1] ||
      null;
    const link = tag(b, 'link');
    const image = img ? decode(img) : null;
    return {
      source: feed.source,
      lang: feed.lang,
      title: tag(b, 'title'),
      url: /^https:\/\//.test(link) ? link : null,
      date: Math.round((Date.parse(tag(b, 'pubDate')) || Date.now()) / 1000),
      text: cleanText(tag(b, 'description')).replace(/\[…\]/g, '…').slice(0, 260),
      image: image && /^https:\/\//.test(image) ? image : null,
    };
  });
}

/** Últimas noticias de Nintendo de varios medios, mezcladas por fecha (caché de 2 horas). */
async function nintendo({ read, write, force }) {
  const cache = read('nintendo-news.json', null);
  if (!force && cache && Date.now() - cache.at < NINTENDO_TTL) return cache.items;
  const lists = await Promise.all(
    NINTENDO_FEEDS.map(async (f) => {
      try {
        const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 BibliotecaDeJuegos' } });
        return r.ok ? parseRss(await r.text(), f) : [];
      } catch {
        return [];
      }
    })
  );
  const items = lists.flat().filter((i) => i.title && i.url).sort((a, b) => b.date - a.date).slice(0, 30);
  if (items.length) write('nintendo-news.json', { at: Date.now(), items });
  return items.length ? items : cache?.items || [];
}

module.exports = { news, releases, cleanText, nintendo };

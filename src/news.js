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

module.exports = { news, releases, cleanText };

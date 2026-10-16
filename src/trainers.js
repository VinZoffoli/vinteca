// Trucos con Wand (antes WeMod). Wand publica su catálogo (storage-cdn.wemod.com/catalog.json):
// cada juego lleva los IDs de su tienda ("steam:367520", "epic:<appName>"), así que se
// sabe qué juegos tuyos tienen trucos y se abren directamente en Wand con
// wemod://play?titleId=…&gameId=…  Si Wand no está instalado, se abre su web.
// Los trucos de Wand son para partidas de un jugador.
const { execFile } = require('child_process');

const CATALOG = 'https://storage-cdn.wemod.com/catalog.json';
const TTL = 24 * 3600000;

/** ¿Está Wand instalado? (registra los enlaces wemod:// y wand://) */
function installed() {
  return new Promise((resolve) => execFile('reg', ['query', 'HKCU\\Software\\Classes\\wemod\\shell\\open\\command'], { windowsHide: true }, (e, out) => resolve(!e && /\.exe/i.test(String(out)))));
}

/** Mapa reducido "steam:<appid>" / "epic:<appName>" -> datos del truco (con caché de un día). */
async function catalog({ read, write, force }) {
  const c = read('wand-map.json', null);
  if (!force && c && Date.now() - c.at < TTL) return c.map;
  try {
    const r = await fetch(CATALOG);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const map = {};
    for (const g of Object.values(j.games || {})) {
      const t = j.titles?.[g.titleId];
      if (!t || !g.trainer) continue;
      const info = { titleId: g.titleId, gameId: g.id, cheats: g.trainer.cheatCount || 0, slug: t.slug, name: t.name };
      for (const id of g.correlationIds || []) {
        // "epic:ns:catalogId:appName" -> también por appName solo
        const parts = id.split(':');
        map[id.toLowerCase()] = info;
        if (parts[0] === 'epic' && parts.length > 2) map[`epic:${parts[parts.length - 1]}`.toLowerCase()] = info;
      }
    }
    write('wand-map.json', { at: Date.now(), map });
    return map;
  } catch (e) {
    if (c) return c.map;
    throw e;
  }
}

/** Busca los trucos de un juego de la biblioteca. */
function forGame(map, g) {
  if (!map || !g) return null;
  if (g.store === 'steam') return map[`steam:${g.id.split(':')[1]}`] || null;
  if (g.store === 'epic') return map[`epic:${g.id.slice(5)}`.toLowerCase()] || (g.steamAppid && map[`steam:${g.steamAppid}`]) || null;
  return (g.steamAppid && map[`steam:${g.steamAppid}`]) || null;
}

const playUrl = (t) => `wemod://play?titleId=${encodeURIComponent(t.titleId)}&gameId=${encodeURIComponent(t.gameId)}`;
const webUrl = (t) => `https://www.wemod.com/cheats/${encodeURIComponent(t.slug)}-trainers`;

module.exports = { installed, catalog, forGame, playUrl, webUrl };

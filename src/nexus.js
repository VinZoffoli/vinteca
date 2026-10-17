// Mods más populares de Nexus Mods para un juego (API pública GraphQL, sin clave).
const API = 'https://api.nexusmods.com/v2/graphql';
const TTL = 7 * 86400000;

async function gql(query, variables) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'ViperTeca' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error(`Nexus Mods: ${j.errors?.[0]?.message || r.status}`);
  return j.data;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function findGame(title) {
  const clean = String(title).replace(/[™®©]/g, '').replace(/\s*[-–:]\s*(game of the year|goty|definitive|deluxe|complete|enhanced|remastered|anniversary)\b.*$/i, '').trim();
  const d = await gql('query($v: String!) { games(filter: { name: { value: $v, op: WILDCARD } }, count: 8) { nodes { id name domainName modCount } } }', { v: clean });
  const nodes = d.games?.nodes || [];
  const n = norm(clean);
  return nodes.find((g) => norm(g.name) === n) || nodes.filter((g) => norm(g.name).startsWith(n) || n.startsWith(norm(g.name))).sort((a, b) => b.modCount - a.modCount)[0] || null;
}

/** Los mods más respaldados del juego (caché de 7 días). */
async function top({ read, write }, title) {
  const cache = read('nexus.json', {});
  const k = norm(title);
  if (cache[k] && Date.now() - cache[k].at < TTL) return cache[k];
  const game = await findGame(title);
  let out = { at: Date.now(), game: null, mods: [] };
  if (game && game.modCount > 0) {
    // sin contenido para adultos
    const d = await gql('query($g: String!) { mods(filter: { gameDomainName: [{ value: $g }], adultContent: [{ value: false }] }, sort: [{ endorsements: { direction: DESC } }], count: 8) { nodes { name summary endorsements downloads modId pictureUrl updatedAt } } }', { g: game.domainName });
    out = {
      at: Date.now(),
      game: { name: game.name, domain: game.domainName, mods: game.modCount, url: `https://www.nexusmods.com/${game.domainName}/mods/` },
      mods: (d.mods?.nodes || []).map((m) => ({ name: m.name, summary: String(m.summary || '').slice(0, 220), endorsements: m.endorsements, downloads: m.downloads, picture: m.pictureUrl, url: `https://www.nexusmods.com/${game.domainName}/mods/${m.modId}` })),
    };
  }
  cache[k] = out;
  write('nexus.json', cache);
  return out;
}

module.exports = { top };

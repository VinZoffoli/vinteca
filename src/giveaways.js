// Juegos que regalan (para quedártelos) en Steam, GOG, Epic y Prime Gaming,
// de la lista pública de GamerPower. Avisa cuando aparece uno nuevo.
const URL_API = 'https://www.gamerpower.com/api/filter?platform=steam.gog.epic-games-store.prime-gaming&type=game';

const STORE = [[/steam/i, 'Steam'], [/gog/i, 'GOG'], [/epic/i, 'Epic'], [/prime|amazon/i, 'Prime Gaming']];
const storeOf = (p) => (STORE.find(([re]) => re.test(p)) || [null, 'PC'])[1];

async function list({ read, write }, force) {
  const c = read('giveaways.json', null);
  if (!force && c && Date.now() - c.at < 3 * 3600000) return c;
  const r = await fetch(URL_API, { headers: { 'User-Agent': 'ViperTeca' }, signal: AbortSignal.timeout(20000) });
  if (r.status === 201) {
    // GamerPower responde 201 cuando no hay ninguno activo
    const out = { at: Date.now(), items: [], seen: c?.seen || [] };
    write('giveaways.json', out);
    return out;
  }
  if (!r.ok) throw new Error(`GamerPower no respondió (HTTP ${r.status}).`);
  const j = await r.json();
  const seen = new Set(c?.seen || []);
  const items = (Array.isArray(j) ? j : []).map((g) => ({
    id: g.id,
    title: String(g.title || '').replace(/\s*\((Steam|GOG|Epic Games|Prime Gaming)\)\s*/i, ' ').replace(/\s*(Key\s+)?Giveaway$/i, '').trim(),
    store: storeOf(g.platforms || ''),
    worth: g.worth && g.worth !== 'N/A' ? g.worth : null,
    image: g.image || g.thumbnail || null,
    ends: g.end_date && g.end_date !== 'N/A' ? Date.parse(g.end_date.replace(' ', 'T')) || null : null,
    url: g.open_giveaway_url || g.gamerpower_url,
    page: g.gamerpower_url,
    isNew: !!c && !seen.has(g.id),
  }));
  const out = { at: Date.now(), items, seen: [...new Set([...seen, ...items.map((x) => x.id)])].slice(-500), first: !c };
  write('giveaways.json', out);
  return out;
}

module.exports = { list };

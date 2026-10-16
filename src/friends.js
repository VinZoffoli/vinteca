// Amigos de Steam: quién está conectado, a qué juega y qué juegos multijugador
// tenéis en común. Solo se ven los amigos con el perfil público.
const API = 'https://api.steampowered.com';
const LIST_TTL = 5 * 60000;
const OWNED_TTL = 24 * 3600000;

const STATE = { 0: 'Desconectado', 1: 'Conectado', 2: 'Ocupado', 3: 'Ausente', 4: 'Ausente', 5: 'Conectado', 6: 'Conectado' };

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function friendsList({ apiKey, steamId, read, write }) {
  const cache = read('friends.json', null);
  if (cache && Date.now() - cache.at < LIST_TTL) return cache.list;
  let fl;
  try {
    fl = await getJson(`${API}/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&relationship=friend`);
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('Tu lista de amigos de Steam es privada: hazla visible en la privacidad de tu perfil.');
    throw e;
  }
  const ids = (fl?.friendslist?.friends || []).map((f) => f.steamid);
  const list = [];
  for (let i = 0; i < ids.length; i += 100) {
    const s = await getJson(`${API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${ids.slice(i, i + 100).join(',')}`);
    for (const p of s?.response?.players || []) {
      list.push({
        steamid: p.steamid,
        name: p.personaname,
        avatar: p.avatarmedium || p.avatar,
        online: p.personastate > 0,
        state: STATE[p.personastate] || 'Desconectado',
        playing: p.gameextrainfo || null,
        public: p.communityvisibilitystate === 3,
        lastOff: p.lastlogoff || null,
      });
    }
  }
  list.sort((a, b) => !!b.playing - !!a.playing || b.online - a.online || a.name.localeCompare(b.name, 'es'));
  write('friends.json', { at: Date.now(), list });
  return list;
}

async function ownedBy({ apiKey, friendId, read, write }) {
  const cache = read('friends-owned.json', {});
  const c = cache[friendId];
  if (c && Date.now() - c.at < OWNED_TTL) return c.games;
  const j = await getJson(`${API}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${friendId}&include_played_free_games=1&format=json`);
  const games = j?.response?.games ? Object.fromEntries(j.response.games.map((g) => [g.appid, g.playtime_forever || 0])) : null;
  cache[friendId] = { at: Date.now(), games };
  write('friends-owned.json', cache);
  return games;
}

/**
 * Juegos tuyos de Steam que también tienen los amigos elegidos.
 * @param myGames [{ appid, id, title, multiplayer }]
 */
async function commonGames({ apiKey, friends, myGames, read, write }) {
  const owned = [];
  const hidden = [];
  for (const f of friends) {
    try {
      const g = await ownedBy({ apiKey, friendId: f.steamid, read, write });
      if (g) owned.push({ f, g });
      else hidden.push(f.name);
    } catch {
      hidden.push(f.name);
    }
  }
  const rows = [];
  for (const m of myGames) {
    const who = owned.filter((o) => o.g[m.appid] !== undefined);
    if (!who.length) continue;
    rows.push({
      id: m.id,
      all: who.length === owned.length,
      who: who.map((o) => o.f.name),
      hours: who.reduce((s, o) => s + o.g[m.appid], 0) / 60,
      multiplayer: m.multiplayer,
    });
  }
  rows.sort((a, b) => b.all - a.all || b.multiplayer - a.multiplayer || b.who.length - a.who.length || b.hours - a.hours);
  return { rows, checked: owned.map((o) => o.f.name), hidden };
}

module.exports = { friendsList, commonGames };

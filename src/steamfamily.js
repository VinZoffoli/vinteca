// Biblioteca del grupo familiar de Steam: los juegos que comparten contigo los
// demás miembros de tu familia. Steam solo los da con tu sesión, así que se usa
// la sesión de Steam que ya inicias dentro de la app (la de la cartera) para
// pedir un token de lectura y consultar IFamilyGroupsService. No se guarda el
// token: se pide cada vez y caduca solo.
const { session } = require('electron');

const PART = 'persist:vt-steam';
const API = 'https://api.steampowered.com/IFamilyGroupsService';

async function token() {
  const ses = session.fromPartition(PART);
  const r = await ses.fetch('https://store.steampowered.com/pointssummary/ajaxgetasyncconfig', { headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  return j?.data?.webapi_token || null;
}

async function call(method, params) {
  const u = new URL(`${API}/${method}/v1/`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Steam no aceptó la sesión.'), { login: true });
  if (!r.ok) throw new Error(`Steam respondió ${r.status} al leer la familia.`);
  return (await r.json()).response || {};
}

async function names(apiKey, ids) {
  if (!apiKey || !ids.length) return {};
  try {
    const u = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
    u.searchParams.set('key', apiKey);
    u.searchParams.set('steamids', ids.slice(0, 100).join(','));
    const j = await (await fetch(u, { signal: AbortSignal.timeout(15000) })).json();
    return Object.fromEntries((j.response?.players || []).map((p) => [p.steamid, p.personaname]));
  } catch {
    return {};
  }
}

/**
 * Juegos compartidos por la familia (sin los tuyos).
 * Devuelve { login: true } si no hay sesión de Steam en la app.
 */
async function load({ read, write }, { steamId, apiKey }) {
  const t = await token().catch(() => null);
  if (!t) return { login: true, cached: read('steam-family.json', null) };
  const fam = await call('GetFamilyGroupForUser', { access_token: t, steamid: steamId, include_family_group_response: true });
  const gid = fam.family_groupid;
  if (!gid || fam.is_not_member_of_any_group) return { none: true };
  const lib = await call('GetSharedLibraryApps', { access_token: t, family_groupid: gid, include_own: false, include_excluded: false, include_free: false, include_non_games: false, language: 'spanish', max_apps: 5000, steamid: steamId });
  const members = (fam.family_group?.members || []).map((m) => m.steamid).filter(Boolean);
  const who = await names(apiKey, members);
  const apps = (lib.apps || [])
    .filter((a) => a.appid && !(a.owner_steamids || []).includes(String(steamId)) && (a.app_type == null || a.app_type === 1))
    .map((a) => ({
      appid: a.appid,
      name: a.name,
      owners: (a.owner_steamids || []).map((id) => who[id] || 'Familia'),
      lastPlayed: a.rt_last_played || null,
      acquired: a.rt_time_acquired || null,
    }));
  const out = { at: Date.now(), group: fam.family_group?.name || 'Familia', members: members.map((id) => ({ id, name: who[id] || id })), apps };
  write('steam-family.json', out);
  return out;
}

module.exports = { load, PART };

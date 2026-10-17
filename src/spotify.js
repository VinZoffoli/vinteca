// Spotify: tus playlists, canciones que te gustan, lo más escuchado, sugerencias
// y control de la reproducción (con Premium suena en tu app de Spotify, por
// Spotify Connect).
//  - Inicio de sesión oficial (OAuth con PKCE): se abre la web de Spotify en tu
//    navegador, aceptas y vuelve a la app por http://127.0.0.1:47811/callback.
//    Hace falta el "Client ID" de una app tuya en developer.spotify.com (no es
//    secreto). La app nunca ve tu contraseña.
//  - Solo se guarda el "refresh token", cifrado con tu usuario de Windows.
const http = require('http');
const crypto = require('crypto');
const { shell, safeStorage } = require('electron');

const PORT = 47811;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
  'user-read-recently-played',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let access = null; // { token, until }

// ---- tokens guardados ----
function settings(read) {
  return read('settings.json', {});
}
function saveRefresh(read, write, token) {
  const s = settings(read);
  if (token) s.spotifyEnc = safeStorage.encryptString(token).toString('base64');
  else delete s.spotifyEnc;
  write('settings.json', s);
}
function loadRefresh(read) {
  const s = settings(read);
  if (!s.spotifyEnc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.spotifyEnc, 'base64'));
  } catch {
    return null;
  }
}
const clientId = (read) => settings(read).spotifyClientId || '';
const linked = (read) => !!settings(read).spotifyEnc && !!clientId(read);

async function tokenRequest(read, body) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(read), ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error === 'invalid_grant' ? 'La sesión de Spotify caducó. Vuelve a vincular tu cuenta.' : `Spotify rechazó el inicio de sesión (${j.error_description || j.error || r.status}).`);
    e.code = j.error;
    throw e;
  }
  return j;
}

/** Inicio de sesión: abre Spotify en el navegador y espera la vuelta (máx. 5 min). */
function login({ read, write }) {
  if (!clientId(read)) throw new Error('Pega primero el Client ID de tu app de Spotify.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      err ? reject(err) : resolve(val);
    };
    const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#191414;color:#fff;display:grid;place-items:center;height:90vh;text-align:center"><div><h1 style="color:#1ed760">${title}</h1><p>${msg}</p></div>`;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (u.searchParams.get('state') !== state) return res.end(page('Algo no cuadra', 'Vuelve a intentarlo desde ViperTeca.'));
      if (u.searchParams.get('error')) {
        res.end(page('No se vinculó', 'Cancelaste el acceso. Puedes cerrar esta pestaña.'));
        return done(new Error('Cancelaste el acceso a Spotify.'));
      }
      try {
        const t = await tokenRequest(read, { grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: verifier });
        saveRefresh(read, write, t.refresh_token);
        access = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
        res.end(page('¡Listo!', 'Tu cuenta de Spotify ya está vinculada a ViperTeca. Puedes cerrar esta pestaña.'));
        done(null, true);
      } catch (e) {
        res.end(page('No se vinculó', e.message));
        done(e);
      }
    });
    server.on('error', (e) => done(new Error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} está ocupado; cierra lo que lo use y vuelve a probar.` : e.message)));
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({ client_id: clientId(read), response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state });
      shell.openExternal(`https://accounts.spotify.com/authorize?${q}`);
    });
    const timer = setTimeout(() => done(new Error('Pasaron 5 minutos sin terminar el inicio de sesión.')), 5 * 60000);
  });
}

async function token({ read, write }) {
  if (access && Date.now() < access.until) return access.token;
  const refresh = loadRefresh(read);
  if (!refresh) throw new Error('Vincula tu cuenta de Spotify.');
  try {
    const t = await tokenRequest(read, { grant_type: 'refresh_token', refresh_token: refresh });
    if (t.refresh_token) saveRefresh(read, write, t.refresh_token);
    access = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
    return access.token;
  } catch (e) {
    if (e.code === 'invalid_grant') saveRefresh(read, write, null);
    throw e;
  }
}

async function api(ctx, path, { method = 'GET', body, query } = {}) {
  const t = await token(ctx);
  const u = new URL(path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const reason = j?.error?.reason;
    const msg =
      reason === 'PREMIUM_REQUIRED' ? 'Controlar la reproducción requiere Spotify Premium.'
      : reason === 'NO_ACTIVE_DEVICE' || r.status === 404 ? 'No hay ningún Spotify abierto. Abre la app de Spotify (en el PC o el móvil) y vuelve a probar.'
      : r.status === 403 ? 'Spotify no deja usar esta función a tu app (revisa que tu cuenta esté en «User Management» de tu app de desarrollador).'
      : r.status === 429 ? 'Spotify pide ir más despacio; prueba en unos segundos.'
      : j?.error?.message || `Spotify respondió ${r.status}.`;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return j;
}

// ---- formato compacto para la interfaz ----
const img = (images, size = 300) => {
  const list = (images || []).filter(Boolean);
  if (!list.length) return null;
  return (list.find((i) => (i.width || 0) <= size && (i.width || 0) >= 64) || list[0]).url;
};
const track = (t) =>
  t && t.id
    ? {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: (t.artists || []).map((a) => a.name).join(', '),
        artistIds: (t.artists || []).map((a) => a.id),
        album: t.album?.name || '',
        cover: img(t.album?.images, 300),
        ms: t.duration_ms || 0,
        explicit: !!t.explicit,
      }
    : null;
const playlist = (p) => p && { id: p.id, uri: p.uri, name: p.name, owner: p.owner?.display_name || '', total: p.tracks?.total ?? p.items?.total ?? 0, cover: img(p.images, 300), description: (p.description || '').replace(/<[^>]+>/g, '') };

async function me(ctx) {
  const u = await api(ctx, '/me');
  return { name: u.display_name || u.id, premium: u.product === 'premium', country: u.country, avatar: img(u.images, 120) };
}

async function playlists(ctx) {
  const out = [];
  let next = '/me/playlists?limit=50';
  for (let i = 0; next && i < 10; i++) {
    const j = await api(ctx, next);
    out.push(...(j.items || []).filter(Boolean).map(playlist));
    next = j.next;
  }
  return out;
}

async function playlistTracks(ctx, id) {
  const out = [];
  let next = `/playlists/${encodeURIComponent(id)}/tracks?limit=100&additional_types=track`;
  for (let i = 0; next && i < 20; i++) {
    const j = await api(ctx, next);
    out.push(...(j.items || []).map((x) => track(x.track)).filter(Boolean));
    next = j.next;
  }
  return out;
}

async function liked(ctx) {
  const out = [];
  let next = '/me/tracks?limit=50';
  for (let i = 0; next && i < 10; i++) {
    const j = await api(ctx, next);
    out.push(...(j.items || []).map((x) => track(x.track)).filter(Boolean));
    next = j.next;
  }
  return out;
}

/** Inicio: lo más escuchado, lo reciente y "Para ti". */
async function home(ctx) {
  const [topT, topA, recent] = await Promise.all([
    api(ctx, '/me/top/tracks', { query: { limit: 30, time_range: 'short_term' } }).catch(() => ({ items: [] })),
    api(ctx, '/me/top/artists', { query: { limit: 12, time_range: 'medium_term' } }).catch(() => ({ items: [] })),
    api(ctx, '/me/player/recently-played', { query: { limit: 30 } }).catch(() => ({ items: [] })),
  ]);
  const topTracks = (topT.items || []).map(track).filter(Boolean);
  const artists = (topA.items || []).map((a) => ({ id: a.id, uri: a.uri, name: a.name, image: img(a.images, 300), genres: (a.genres || []).slice(0, 3) }));
  const seen = new Set();
  const recentTracks = (recent.items || []).map((x) => track(x.track)).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
  // "Para ti": las canciones más populares de tus artistas favoritos que no
  // están entre lo que más escuchas (Spotify cerró su servicio de
  // recomendaciones a las apps nuevas en 2024).
  const known = new Set([...topTracks, ...recentTracks].map((t) => t.id));
  const forYou = [];
  for (const a of artists.slice(0, 8)) {
    try {
      const j = await api(ctx, `/artists/${a.id}/top-tracks`, { query: { market: 'from_token' } });
      for (const t of (j.tracks || []).slice(0, 6)) {
        const tt = track(t);
        if (tt && !known.has(tt.id)) {
          known.add(tt.id);
          forYou.push({ ...tt, because: a.name });
        }
      }
    } catch {}
  }
  // Mezcla para que no salgan todas seguidas del mismo artista
  forYou.sort(() => Math.random() - 0.5);
  return { topTracks, artists, recentTracks, forYou: forYou.slice(0, 40) };
}

// ---- reproducción (Spotify Connect) ----
async function state(ctx) {
  const s = await api(ctx, '/me/player', { query: { additional_types: 'track' } });
  if (!s) return { active: false };
  return {
    active: true,
    playing: !!s.is_playing,
    shuffle: !!s.shuffle_state,
    repeat: s.repeat_state,
    progress: s.progress_ms || 0,
    device: s.device ? { id: s.device.id, name: s.device.name, type: s.device.type, volume: s.device.volume_percent } : null,
    context: s.context?.uri || null,
    track: track(s.item),
    at: Date.now(),
  };
}

async function devices(ctx) {
  const j = await api(ctx, '/me/player/devices');
  return (j.devices || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent }));
}

/** Acciones: play (con contexto o canciones), pause, next, prev, seek, volume, shuffle, transfer. */
async function control(ctx, action, arg = {}) {
  const dev = arg.device ? { device_id: arg.device } : {};
  // Sin dispositivo activo: usar el Spotify del PC si está abierto
  const ensureDevice = async () => {
    if (arg.device) return dev;
    const list = await devices(ctx);
    if (list.some((d) => d.active)) return {};
    const pc = list.find((d) => d.type === 'Computer') || list[0];
    if (!pc) throw new Error('No hay ningún Spotify abierto. Abre la app de Spotify y vuelve a probar.');
    return { device_id: pc.id };
  };
  switch (action) {
    case 'play': {
      const q = await ensureDevice();
      const body = arg.context ? { context_uri: arg.context, ...(arg.offset ? { offset: { uri: arg.offset } } : {}) } : arg.uris ? { uris: arg.uris.slice(0, 100), ...(arg.offset ? { offset: { uri: arg.offset } } : {}) } : undefined;
      return api(ctx, '/me/player/play', { method: 'PUT', query: q, body });
    }
    case 'pause':
      return api(ctx, '/me/player/pause', { method: 'PUT', query: dev });
    case 'next':
      return api(ctx, '/me/player/next', { method: 'POST', query: dev });
    case 'prev':
      return api(ctx, '/me/player/previous', { method: 'POST', query: dev });
    case 'seek':
      return api(ctx, '/me/player/seek', { method: 'PUT', query: { position_ms: Math.max(0, Math.round(arg.ms || 0)), ...dev } });
    case 'volume':
      return api(ctx, '/me/player/volume', { method: 'PUT', query: { volume_percent: Math.max(0, Math.min(100, Math.round(arg.value))), ...dev } });
    case 'shuffle':
      return api(ctx, '/me/player/shuffle', { method: 'PUT', query: { state: !!arg.value, ...dev } });
    case 'repeat':
      return api(ctx, '/me/player/repeat', { method: 'PUT', query: { state: ['off', 'context', 'track'].includes(arg.value) ? arg.value : 'off', ...dev } });
    case 'transfer':
      return api(ctx, '/me/player', { method: 'PUT', body: { device_ids: [arg.device], play: true } });
    case 'like':
      return api(ctx, '/me/tracks', { method: arg.value ? 'PUT' : 'DELETE', query: { ids: arg.id } });
    default:
      throw new Error('Acción desconocida.');
  }
}

async function isLiked(ctx, ids) {
  if (!ids.length) return [];
  return api(ctx, '/me/tracks/contains', { query: { ids: ids.slice(0, 50).join(',') } });
}

function logout({ read, write }) {
  access = null;
  saveRefresh(read, write, null);
}

module.exports = { login, logout, linked, me, playlists, playlistTracks, liked, home, state, devices, control, isLiked, REDIRECT };

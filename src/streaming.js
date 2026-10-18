// Netflix y Crunchyroll: lo que estás viendo en cada perfil.
// No hay API pública, así que: inicias sesión tú en una ventana de la app (la
// sesión queda en esa ventana, como en un navegador) y, cuando pulsas «Leer»,
// ViperTeca lee el historial de visionado del perfil abierto. Solo lectura.
// Los capítulos que faltan salen de AniList (anime) y TVmaze (series).
const { BrowserWindow, session } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SITES = {
  netflix: { part: 'persist:vt-netflix', home: 'https://www.netflix.com/browse', ok: /^https:\/\/([\w-]+\.)*netflix\.com\//, title: 'Netflix · inicia sesión y elige el perfil' },
  crunchyroll: { part: 'persist:vt-crunchyroll', home: 'https://www.crunchyroll.com/history', ok: /^https:\/\/([\w-]+\.)*crunchyroll\.com\//, title: 'Crunchyroll · inicia sesión y elige el perfil' },
};
const wins = {};
const crAuth = { token: null, at: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Abre (o trae al frente) la ventana de la plataforma. */
function open(platform) {
  const S = SITES[platform];
  if (!S) throw new Error('Plataforma desconocida');
  if (wins[platform] && !wins[platform].isDestroyed()) {
    wins[platform].show();
    wins[platform].focus();
    return wins[platform];
  }
  const ses = session.fromPartition(S.part);
  ses.setUserAgent(UA);
  if (platform === 'crunchyroll') {
    // la web de Crunchyroll pide sus datos con un permiso temporal: se toma de ahí
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.crunchyroll.com/*'] }, (d, cb) => {
      const a = d.requestHeaders.Authorization || d.requestHeaders.authorization;
      if (a && /^Bearer /.test(a)) Object.assign(crAuth, { token: a, at: Date.now() });
      cb({ requestHeaders: d.requestHeaders });
    });
  }
  const w = new BrowserWindow({ width: 1280, height: 860, title: S.title, autoHideMenuBar: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  w.removeMenu();
  w.webContents.setWindowOpenHandler(({ url }) => (S.ok.test(url) ? { action: 'allow' } : { action: 'deny' }));
  w.loadURL(S.home);
  w.on('closed', () => delete wins[platform]);
  wins[platform] = w;
  return w;
}

// ---------------- Netflix ----------------
const NETFLIX_READ = `(async () => {
  const m = window.netflix && window.netflix.reactContext && window.netflix.reactContext.models;
  const build = m && m.serverDefs && m.serverDefs.data && m.serverDefs.data.BUILD_IDENTIFIER;
  const who = m && m.userInfo && m.userInfo.data;
  if (!who || !who.membershipStatus || who.membershipStatus === 'ANONYMOUS') return { error: 'login' };
  const items = [];
  if (build) {
    for (let pg = 0; pg < 8; pg++) {
      const r = await fetch('/api/shakti/' + build + '/viewingactivity?pg=' + pg + '&pgSize=100', { credentials: 'include' }).then((x) => x.ok ? x.json() : null).catch(() => null);
      const list = (r && r.viewedItems) || [];
      for (const i of list) items.push({ title: i.title, series: i.seriesTitle || null, seriesId: i.series || null, season: i.seasonDescriptor || null, episode: i.episodeTitle || null, date: i.date, duration: i.duration || null, bookmark: i.bookmark || null, id: i.movieID });
      if (list.length < 100) break;
    }
  }
  // de cada serie reciente: sus episodios (de Netflix) para saber cuántos faltan
  const seen = new Set();
  for (const it of items) {
    if (!build || !it.seriesId || seen.has(it.seriesId) || seen.size >= 20) continue;
    seen.add(it.seriesId);
    const md = await fetch('/api/shakti/' + build + '/metadata?movieid=' + it.seriesId, { credentials: 'include' }).then((x) => x.ok ? x.json() : null).catch(() => null);
    const v = md && md.video;
    if (!v || !v.seasons) continue;
    const eps = v.seasons.flatMap((se) => (se.episodes || []).map((e) => ({ id: e.id || e.episodeId, s: se.seq })));
    const idx = eps.findIndex((e) => String(e.id) === String(it.id));
    it.nfTotal = eps.length;
    it.nfLeft = idx >= 0 ? eps.length - idx - 1 : null;
    it.nfCover = (v.boxart && v.boxart[0] && v.boxart[0].url) || null;
  }
  return { profile: who.name || null, guid: who.userGuid || null, items };
})()`;
// Si la API interna no responde, se lee la página «Actividad de visionado»
const NETFLIX_DOM = `(async () => {
  for (let i = 0; i < 6; i++) {
    const more = [...document.querySelectorAll('button')].find((b) => /mostrar m|show more/i.test(b.textContent));
    if (!more) break;
    more.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  const rows = [...document.querySelectorAll('li.retableRow, .retable li')];
  return rows.map((r) => ({ date: (r.querySelector('.date, .col.date') || {}).textContent || '', title: ((r.querySelector('.title a, .col.title a') || {}).textContent || '').trim() })).filter((x) => x.title);
})()`;
function parseNetflixTitle(t) {
  // "Serie: Temporada 2: «Episodio»" o "Serie: Parte 1: Episodio 3"
  const parts = String(t).split(': ');
  if (parts.length < 2) return { series: null, season: null, episode: null, movie: t };
  return { series: parts[0], season: parts.length > 2 ? parts[1] : null, episode: parts.slice(parts.length > 2 ? 2 : 1).join(': ').replace(/^["«“]|["»”]$/g, '') };
}
async function readNetflix() {
  const w = wins.netflix;
  if (!w || w.isDestroyed()) {
    open('netflix');
    throw new Error('Se abrió Netflix: inicia sesión, elige el perfil y vuelve a pulsar «Leer».');
  }
  if (!/netflix\.com\/(browse|title|watch|search|latest|viewingactivity)/.test(w.webContents.getURL())) {
    await w.loadURL('https://www.netflix.com/browse');
    await sleep(3000);
  }
  let r = await w.webContents.executeJavaScript(NETFLIX_READ, true).catch(() => null);
  if (r?.error === 'login' || !r) throw new Error('Netflix no tiene la sesión iniciada en la ventana: entra y elige el perfil.');
  if (!r.items.length) {
    await w.loadURL('https://www.netflix.com/viewingactivity');
    await sleep(4000);
    const rows = (await w.webContents.executeJavaScript(NETFLIX_DOM, true).catch(() => [])) || [];
    r.items = rows.map((x) => ({ ...parseNetflixTitle(x.title), title: x.title, date: Date.parse(x.date) || null }));
    await w.loadURL('https://www.netflix.com/browse');
  }
  return { platform: 'netflix', profile: r.profile, items: r.items };
}

// ---------------- Crunchyroll ----------------
async function crFetch(ses, path) {
  const r = await ses.fetch('https://www.crunchyroll.com' + path, { headers: { Authorization: crAuth.token, Accept: 'application/json' } });
  if (r.status === 401) throw new Error('caducó');
  if (!r.ok) throw new Error('Crunchyroll respondió ' + r.status);
  return r.json();
}
async function readCrunchyroll() {
  const w = wins.crunchyroll;
  if (!w || w.isDestroyed()) {
    open('crunchyroll');
    throw new Error('Se abrió Crunchyroll: inicia sesión, elige el perfil y vuelve a pulsar «Leer».');
  }
  // recargar el historial hace que la web pida un permiso nuevo (que la app reutiliza)
  crAuth.token = null;
  await w.loadURL('https://www.crunchyroll.com/history');
  for (let i = 0; i < 20 && !crAuth.token; i++) await sleep(500);
  if (!crAuth.token) throw new Error('Crunchyroll no tiene la sesión iniciada en la ventana: entra y elige el perfil.');
  const ses = session.fromPartition(SITES.crunchyroll.part);
  const me = await crFetch(ses, '/accounts/v1/me');
  const id = me.account_id;
  let profile = null;
  try {
    const mp = await crFetch(ses, '/accounts/v1/me/multiprofile');
    profile = (mp.profiles || []).find((p) => p.is_selected)?.profile_name || null;
  } catch {}
  const items = [];
  let page = 1;
  for (let i = 0; i < 6; i++) {
    const j = await crFetch(ses, '/content/v2/' + id + '/watch-history?page_size=100&page=' + page + '&locale=es-419');
    for (const x of j.data || []) {
      const p = x.panel || {};
      const e = p.episode_metadata || {};
      items.push({ title: p.title, series: e.series_title || p.title, seriesId: e.series_id || null, season: e.season_number || null, seasonTitle: e.season_title || null, episode: e.episode_number || null, episodeTitle: p.title, date: Date.parse(x.date_played) || null, duration: e.duration_ms ? Math.round(e.duration_ms / 1000) : null, bookmark: x.playhead || null, done: !!x.fully_watched, image: p.images?.thumbnail?.[0]?.[0]?.source || null });
    }
    if (!(j.data || []).length || (j.data || []).length < 100) break;
    page++;
  }
  return { platform: 'crunchyroll', profile, items };
}

// ---------------- resumen por serie ----------------
/** Agrupa el historial en series/películas con lo último que viste. */
function summarize(read) {
  const out = [];
  const by = new Map();
  for (const it of read.items) {
    const key = norm(it.series || it.title);
    if (!key) continue;
    const cur = by.get(key);
    if (!cur || (it.date || 0) > (cur.last.date || 0)) by.set(key, { key, name: it.series || it.title, movie: !it.series && !it.episode, last: it, count: (cur?.count || 0) + 1 });
    else cur.count++;
  }
  for (const v of by.values()) out.push(v);
  return out.sort((a, b) => (b.last.date || 0) - (a.last.date || 0));
}

/** Cuántos capítulos faltan: anime en AniList, series en TVmaze (caché de 3 días). */
async function enrich({ read, write }, entry, platform) {
  const cache = read('streaming-meta.json', {});
  const ck = platform + ':' + entry.key;
  let meta = cache[ck];
  if (!meta || Date.now() - meta.at > 3 * 86400000) {
    meta = { at: Date.now() };
    try {
      if (platform === 'crunchyroll') {
        const q = 'query($s:String){Media(search:$s,type:ANIME){id title{romaji english} episodes status nextAiringEpisode{episode airingAt} coverImage{large} siteUrl}}';
        const j = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { s: entry.name } }), signal: AbortSignal.timeout(12000) }).then((r) => r.json());
        const m = j.data?.Media;
        if (m) Object.assign(meta, { source: 'AniList', total: m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : null), airing: m.status === 'RELEASING', next: m.nextAiringEpisode ? { ep: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null, cover: m.coverImage?.large || null, url: m.siteUrl });
      } else if (!entry.movie) {
        const s = await fetch('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(entry.name) + '&embed=episodes', { headers: { 'User-Agent': 'ViperTeca/1.23' }, signal: AbortSignal.timeout(12000) }).then((r) => (r.ok ? r.json() : null));
        if (s) Object.assign(meta, { source: 'TVmaze', status: s.status, cover: s.image?.medium || null, url: s.url, episodes: (s._embedded?.episodes || []).map((e) => ({ s: e.season, n: e.number, name: e.name, at: e.airstamp ? Date.parse(e.airstamp) : null })) });
      }
    } catch {}
    cache[ck] = meta;
    write('streaming-meta.json', cache);
  }
  // posición del último capítulo visto
  const last = entry.last;
  let left = null;
  let total = null;
  let next = null;
  if (last.nfTotal) {
    // Netflix dio sus propios episodios: es lo más exacto
    total = last.nfTotal;
    left = last.nfLeft;
    if (meta.episodes?.length) {
      const upcoming = meta.episodes.find((e) => e.at && e.at > Date.now());
      if (upcoming) next = { at: upcoming.at, label: 'T' + upcoming.s + ' E' + upcoming.n };
    }
  } else if (meta.episodes?.length) {
    const aired = meta.episodes.filter((e) => !e.at || e.at < Date.now());
    total = aired.length;
    const sNum = Number(String(last.season || '').match(/\d+/)?.[0]) || null;
    const name = norm(last.episode || last.episodeTitle);
    let idx = aired.findIndex((e) => name && norm(e.name) === name);
    if (idx < 0 && sNum && last.episode && /^\d+$/.test(String(last.episode))) idx = aired.findIndex((e) => e.s === sNum && e.n === Number(last.episode));
    if (idx >= 0) left = aired.length - idx - 1;
    const upcoming = meta.episodes.find((e) => e.at && e.at > Date.now());
    if (upcoming) next = { at: upcoming.at, label: 'T' + upcoming.s + ' E' + upcoming.n };
  } else if (meta.total) {
    total = meta.total;
    const ep = Number(last.episode) || null;
    if (ep) left = Math.max(0, meta.total - ep);
    if (meta.next) next = { at: meta.next.at, label: 'Episodio ' + meta.next.ep };
  }
  return { ...entry, platform, cover: last.image || last.nfCover || meta.cover || null, url: meta.url || null, total, left, next, status: meta.status || (meta.airing ? 'Running' : null) };
}

module.exports = { open, readNetflix, readCrunchyroll, summarize, enrich };

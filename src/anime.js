// Estrenos de anime (AniList, API pública sin clave) y tu calendario de anime:
// los que sigues y los que añades a mano. Avisa del estreno y de cada episodio
// nuevo de los que sigues.
const API = 'https://graphql.anilist.co';
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_ES = { WINTER: 'Invierno', SPRING: 'Primavera', SUMMER: 'Verano', FALL: 'Otoño' };
const FORMAT_ES = { TV: 'Serie', TV_SHORT: 'Serie corta', MOVIE: 'Película', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'Streaming', MUSIC: 'Musical' };

const FIELDS = `id idMal title { romaji english native } coverImage { extraLarge large color } bannerImage
  description(asHtml: false) startDate { year month day } season seasonYear format episodes duration status
  genres popularity averageScore siteUrl studios(isMain: true) { nodes { name } }
  nextAiringEpisode { airingAt episode } trailer { id site }
  externalLinks { site url type }`;

async function gql(query, variables) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) throw new Error('AniList pide esperar un momento (demasiadas consultas). Prueba en un minuto.');
  if (!r.ok || j.errors) throw new Error(`AniList: ${j.errors?.[0]?.message || r.status}`);
  return j.data;
}

const clean = (s) =>
  String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/\[Written by[^\]]*\]/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Fecha conocida de estreno: exacta, solo mes o solo año. */
function when(m) {
  const d = m.startDate || {};
  if (d.year && d.month && d.day) return { at: new Date(d.year, d.month - 1, d.day).getTime(), precision: 'day' };
  if (d.year && d.month) return { at: new Date(d.year, d.month - 1, 1).getTime(), precision: 'month' };
  if (m.season && m.seasonYear) return { at: new Date(m.seasonYear, SEASONS.indexOf(m.season) * 3, 1).getTime(), precision: 'season' };
  if (d.year) return { at: new Date(d.year, 0, 1).getTime(), precision: 'year' };
  return { at: null, precision: 'tba' };
}

function shape(m) {
  const w = when(m);
  const streaming = (m.externalLinks || []).filter((l) => l.type === 'STREAMING').map((l) => l.site);
  return {
    id: m.id,
    title: m.title?.english || m.title?.romaji || 'Sin título',
    romaji: m.title?.romaji || '',
    native: m.title?.native || '',
    cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
    color: m.coverImage?.color || null,
    banner: m.bannerImage || null,
    synopsis: clean(m.description).slice(0, 1200),
    format: FORMAT_ES[m.format] || m.format || '',
    episodes: m.episodes || null,
    status: m.status,
    genres: (m.genres || []).slice(0, 4),
    studio: m.studios?.nodes?.[0]?.name || '',
    season: m.season && m.seasonYear ? `${SEASON_ES[m.season]} ${m.seasonYear}` : '',
    start: w.at,
    precision: w.precision,
    next: m.nextAiringEpisode ? { at: m.nextAiringEpisode.airingAt * 1000, episode: m.nextAiringEpisode.episode } : null,
    popularity: m.popularity || 0,
    score: m.averageScore || null,
    url: m.siteUrl,
    trailer: m.trailer?.site === 'youtube' ? `https://www.youtube.com/watch?v=${m.trailer.id}` : null,
    streaming: [...new Set(streaming)].slice(0, 4),
  };
}

function currentSeason(now = new Date()) {
  return { season: SEASONS[Math.floor(now.getMonth() / 3)], year: now.getFullYear() };
}
function nextSeasons(n = 3) {
  const out = [];
  let { season, year } = currentSeason();
  let i = SEASONS.indexOf(season);
  for (let k = 0; k < n; k++) {
    out.push({ season: SEASONS[i], year, label: `${SEASON_ES[SEASONS[i]]} ${year}` });
    i++;
    if (i > 3) {
      i = 0;
      year++;
    }
  }
  return out;
}

/** Próximos estrenos: anunciados y temporadas que vienen (caché 6 h). */
async function upcoming({ read, write }, force) {
  const c = read('anime-upcoming.json', null);
  if (!force && c && Date.now() - c.at < 6 * 3600000) return c;
  const seasons = nextSeasons(3);
  const q = `query($s1: MediaSeason, $y1: Int, $s2: MediaSeason, $y2: Int, $s3: MediaSeason, $y3: Int) {
    soon: Page(perPage: 50) { media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ${FIELDS} } }
    a: Page(perPage: 40) { media(type: ANIME, season: $s1, seasonYear: $y1, sort: POPULARITY_DESC, isAdult: false) { ${FIELDS} } }
    b: Page(perPage: 40) { media(type: ANIME, season: $s2, seasonYear: $y2, sort: POPULARITY_DESC, isAdult: false) { ${FIELDS} } }
    c: Page(perPage: 40) { media(type: ANIME, season: $s3, seasonYear: $y3, sort: POPULARITY_DESC, isAdult: false) { ${FIELDS} } }
  }`;
  const d = await gql(q, { s1: seasons[0].season, y1: seasons[0].year, s2: seasons[1].season, y2: seasons[1].year, s3: seasons[2].season, y3: seasons[2].year });
  const out = {
    at: Date.now(),
    soon: d.soon.media.map(shape),
    seasons: [d.a, d.b, d.c].map((p, i) => ({ label: seasons[i].label, list: p.media.map(shape) })),
  };
  write('anime-upcoming.json', out);
  return out;
}

async function search(q) {
  const d = await gql(`query($q: String) { Page(perPage: 20) { media(type: ANIME, search: $q, sort: [START_DATE_DESC, POPULARITY_DESC], isAdult: false) { ${FIELDS} } } }`, { q: String(q).slice(0, 80) });
  return d.Page.media.map(shape);
}

// ---- tu calendario ----
function mine({ read }) {
  return read('anime.json', { follows: {}, custom: [] });
}
function follow({ read, write }, media, on) {
  const s = mine({ read });
  if (on) s.follows[media.id] = { ...media, followedAt: Date.now() };
  else delete s.follows[media.id];
  write('anime.json', s);
  return s;
}
function saveCustom({ read, write }, list) {
  const s = mine({ read });
  s.custom = (Array.isArray(list) ? list : []).slice(0, 200).map((x) => ({
    id: String(x.id || Math.random().toString(16).slice(2, 12)).slice(0, 20),
    title: String(x.title || '').slice(0, 160).trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null,
    note: String(x.note || '').slice(0, 400),
    where: String(x.where || '').slice(0, 60),
  })).filter((x) => x.title);
  write('anime.json', s);
  return s;
}

/** Actualiza los que sigues (fechas y próximo episodio). */
async function refreshFollows({ read, write }) {
  const s = mine({ read });
  const ids = Object.keys(s.follows).map(Number).filter(Boolean);
  if (!ids.length) return s;
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql(`query($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${FIELDS} } } }`, { ids: ids.slice(i, i + 50) });
    for (const m of d.Page.media) s.follows[m.id] = { ...s.follows[m.id], ...shape(m) };
  }
  s.refreshedAt = Date.now();
  write('anime.json', s);
  return s;
}

/** Avisos: estreno (día antes y el día) y episodios nuevos de los que sigues. */
function notices({ read, write }) {
  const s = mine({ read });
  const sent = read('anime-notified.json', {});
  const now = Date.now();
  const out = [];
  const once = (k, n) => {
    if (sent[k]) return;
    sent[k] = now;
    out.push(n);
  };
  const day = (t) => Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  for (const a of Object.values(s.follows)) {
    if (a.start && a.precision === 'day' && a.status === 'NOT_YET_RELEASED') {
      const d = day(a.start);
      if (d === 1) once(`a:${a.id}:pre1`, { title: `Mañana se estrena ${a.title}`, body: [a.format, a.studio, a.streaming?.join(', ')].filter(Boolean).join(' · '), url: a.url });
      if (d === 0) once(`a:${a.id}:pre0`, { title: `Hoy se estrena ${a.title}`, body: a.streaming?.length ? `En ${a.streaming.join(', ')}` : 'Ya puedes verlo.', url: a.url });
    }
    if (a.next && a.next.at <= now && now - a.next.at < 2 * 86400000) once(`a:${a.id}:ep${a.next.episode}`, { title: `Episodio ${a.next.episode} de ${a.title}`, body: a.streaming?.length ? `Ya salió en ${a.streaming.join(', ')}.` : 'Ya salió.', url: a.url });
  }
  for (const c of s.custom || []) {
    if (!c.date) continue;
    const d = day(new Date(c.date + 'T00:00:00').getTime());
    if (d === 1) once(`c:${c.id}:1`, { title: `Mañana: ${c.title}`, body: c.where || c.note || '' });
    if (d === 0) once(`c:${c.id}:0`, { title: `Hoy: ${c.title}`, body: c.where || c.note || '' });
  }
  write('anime-notified.json', sent);
  return out;
}

// ---- sinopsis en español ----
// Se traducen con tu Claude Code (modelo Haiku) solo cuando pulsas "Traducir al
// español"; quedan guardadas y no se vuelven a traducir.
function translations(read) {
  return read('anime-tr.json', {});
}
async function translate({ read, write }, items) {
  const { spawn } = require('child_process');
  const exe = require('./claude-chat').findClaude();
  if (!exe) throw new Error('Para traducir hace falta Claude Code instalado en este PC.');
  const cache = translations(read);
  const todo = (items || []).filter((a) => a && a.id && a.synopsis && !cache[a.id]).slice(0, 120);
  let done = 0;
  for (let i = 0; i < todo.length; i += 30) {
    const batch = Object.fromEntries(todo.slice(i, i + 30).map((a) => [a.id, a.synopsis.slice(0, 1200)]));
    const prompt = `Traduce al español neutro (latinoamericano) estas sinopsis de anime. Mantén los nombres propios. Responde SOLO con un objeto JSON válido con las mismas claves y el texto traducido, sin nada más.\n\n${JSON.stringify(batch)}`;
    const out = await new Promise((resolve, reject) => {
      const p = spawn(exe, ['-p', '--output-format', 'json', '--model', 'haiku', '--allowedTools', ''], { windowsHide: true, cwd: require('os').tmpdir() });
      let buf = '';
      p.stdout.on('data', (d) => (buf += d));
      p.on('error', reject);
      p.on('close', () => resolve(buf));
      p.stdin.end(prompt, 'utf8');
    });
    let text = '';
    try {
      text = JSON.parse(out).result || '';
    } catch {
      text = out;
    }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const tr = JSON.parse(m[0]);
      for (const [id, t] of Object.entries(tr)) if (typeof t === 'string' && t.trim()) {
        cache[id] = t.trim();
        done++;
      }
    } catch {}
    write('anime-tr.json', cache);
  }
  return { done, cache };
}

module.exports = { upcoming, search, mine, follow, saveCustom, refreshFollows, notices, nextSeasons, translate, translations };

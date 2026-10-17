// Noticias y calendario de Genshin Impact, de fuentes oficiales y públicas:
//  - Anuncios del juego (los mismos que ves dentro de Genshin): versión actual,
//    cuándo termina, gachapones y eventos en curso con sus fechas.
//  - Noticias oficiales de HoYoLAB (avisos, eventos e información).
// El directo de la próxima versión se da como estimado (unos 12 días antes)
// hasta que HoYoverse publica su aviso.
const ANN = 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList';
const NEWS = 'https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList';
const TTL = 30 * 60000;
const DAY = 86400000;

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

// "2026-11-03 23:00:00" en la zona horaria del servidor -> milisegundos
function serverTime(s, tz) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - tz * 3600000;
}

function kindOf(title) {
  if (/gachap[oó]n/i.test(title)) return 'Gachapón';
  if (/misi[oó]n de arconte/i.test(title)) return 'Misión de Arconte';
  if (/misi[oó]n de mundo/i.test(title)) return 'Misión de mundo';
  if (/pase de batalla|\bPB\b/i.test(title)) return 'Pase de batalla';
  if (/invocaci[oó]n de los sabios/i.test(title)) return 'Invocación de los Sabios';
  return 'Evento';
}

async function announcements(uid) {
  const region = { 6: 'os_usa', 7: 'os_euro', 8: 'os_asia', 9: 'os_cht' }[String(uid || '6')[0]] || 'os_usa';
  const q = new URLSearchParams({ game: 'hk4e', game_biz: 'hk4e_global', lang: 'es-es', bundle_id: 'hk4e_global', platform: 'pc', region, level: '60', uid: String(uid || '') });
  const j = await (await fetch(`${ANN}?${q}`)).json();
  if (j.retcode !== 0) throw new Error(`Los anuncios de Genshin no respondieron (${j.message}).`);
  const tz = Number(j.data.timezone ?? 0);
  const now = Date.now();
  let version = null;
  const events = [];
  for (const group of j.data.list || []) {
    for (const a of group.list || []) {
      const title = strip(a.title);
      const start = serverTime(a.start_time, tz);
      const end = serverTime(a.end_time, tz);
      const v = title.match(/[Dd]etalles de la versi[oó]n (\d+\.\d+)\s*«([^»]+)»/);
      if (v && !version) version = { number: v[1], name: v[2], start, end };
      // Eventos y gachapones (no los avisos permanentes)
      if (group.type_id === 1 || /evento|gachap/i.test(title)) {
        if (!end || end < now || end - now > 200 * DAY) continue;
        events.push({ id: a.ann_id, title, short: strip(a.subtitle) || title, kind: kindOf(title), start, end, image: a.banner || a.img || null, group: group.type_label });
      }
    }
  }
  events.sort((a, b) => (a.kind === 'Gachapón') - (b.kind === 'Gachapón') || a.end - b.end);
  return { version, events };
}

async function news() {
  const out = [];
  for (const type of [3, 1, 2]) {
    try {
      const j = await (await fetch(`${NEWS}?gids=2&page_size=20&type=${type}`, { headers: { 'x-rpc-language': 'es-es', 'User-Agent': 'Mozilla/5.0' } })).json();
      for (const x of j.data?.list || []) {
        out.push({ id: x.post.post_id, title: x.post.subject, date: x.post.created_at * 1000, image: x.image_list?.[0]?.url || x.cover_list?.[0]?.url || null, type: { 1: 'Aviso', 2: 'Evento', 3: 'Información' }[type], url: `https://www.hoyolab.com/article/${x.post.post_id}` });
      }
    } catch {}
  }
  const seen = new Set();
  return out.filter((n) => !seen.has(n.id) && seen.add(n.id)).sort((a, b) => b.date - a.date);
}

function nextNumber(v) {
  const [maj, min] = String(v || '').split('.').map(Number);
  return Number.isFinite(maj) ? `${maj}.${(min || 0) + 1}` : null;
}

async function overview(uid, { read, write, force }) {
  const c = read('genshin-news.json', null);
  if (!force && c && Date.now() - c.at < TTL) return c.data;
  const [ann, list] = await Promise.all([announcements(uid), news()]);
  const v = ann.version;
  const next = v ? nextNumber(v.number) : null;
  // Fin de la versión = salida de la siguiente (el mantenimiento empieza a esa hora)
  const nextAt = v?.end || null;
  const nextRe = next ? new RegExp(`versi[oó]n ${next.replace('.', '\\.')}`, 'i') : null;
  const live = list.find((n) => /programa especial|transmisi[oó]n especial|directo/i.test(n.title) && (!nextRe || nextRe.test(n.title)));
  // Personajes anunciados para la próxima versión (presentaciones oficiales)
  const reveals = nextRe ? list.filter((n) => nextRe.test(n.title) || (/nuevo personaje|personaje jugable/i.test(n.title) && n.date > (v?.start || 0))) : [];
  const data = {
    version: v,
    next: next && { number: next, at: nextAt },
    livestream: live ? { confirmed: true, title: live.title, url: live.url, date: live.date } : nextAt ? { confirmed: false, at: nextAt - 12 * DAY } : null,
    reveals: reveals.slice(0, 8),
    events: ann.events,
    news: list.slice(0, 24),
    at: Date.now(),
  };
  write('genshin-news.json', { at: Date.now(), data });
  return data;
}

module.exports = { overview };

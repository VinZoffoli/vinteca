// Calendario de Google: tus próximas reuniones, tus dailys y aviso cuando te
// agendan algo nuevo.
//  - Funciona con la "dirección secreta en formato iCal" de tu calendario, que
//    pegas tú en la app (Google Calendar → Configuración → tu calendario →
//    Integrar el calendario). Es de solo lectura: la app no puede crear,
//    cambiar ni borrar nada.
//  - La dirección se guarda cifrada con tu usuario de Windows y nunca sale de
//    tu PC salvo para pedirle el calendario a Google.
const { safeStorage } = require('electron');

const ICS_RE = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/\s]+\/(private-[0-9a-f]+|public)\/basic\.ics$/i;
const DAY = 86400000;

// ---- dirección guardada ----
function setUrl({ read, write }, url) {
  const s = read('settings.json', {});
  const v = String(url || '').trim();
  if (!v) {
    delete s.calIcsEnc;
    write('settings.json', s);
    write('calendar-cache.json', null);
    return false;
  }
  if (!ICS_RE.test(v)) throw new Error('Esa no parece la dirección secreta en formato iCal. Debe empezar por https://calendar.google.com/calendar/ical/ y terminar en basic.ics.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
  s.calIcsEnc = safeStorage.encryptString(v).toString('base64');
  write('settings.json', s);
  write('calendar-cache.json', null);
  return true;
}
function getUrl(read) {
  const s = read('settings.json', {});
  if (!s.calIcsEnc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.calIcsEnc, 'base64'));
  } catch {
    return null;
  }
}
const linked = (read) => !!read('settings.json', {}).calIcsEnc;

// ---- lectura del iCal ----
const unesc = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseLines(text) {
  const raw = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  return raw.filter(Boolean).map((l) => {
    // NOMBRE;PARAM=a;PARAM="b:c":valor
    let i = 0;
    let q = false;
    for (; i < l.length; i++) {
      if (l[i] === '"') q = !q;
      else if (l[i] === ':' && !q) break;
    }
    const head = l.slice(0, i);
    const value = l.slice(i + 1);
    const [name, ...ps] = head.split(';');
    const params = {};
    for (const p of ps) {
      const k = p.indexOf('=');
      params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '');
    }
    return { name: name.toUpperCase(), params, value };
  });
}

// hora "de pared" en una zona → instante UTC
const fmtCache = {};
function tzOffset(t, tz) {
  let f = fmtCache[tz];
  if (!f) {
    try {
      f = fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return null;
    }
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}
function wallToUtc(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (!tz) return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime(); // hora local
  let t = guess - (tzOffset(guess, tz) ?? 0);
  const o2 = tzOffset(t, tz);
  if (o2 != null) t = guess - o2;
  return t;
}
const WIN_TZ = { 'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles', 'Argentina Standard Time': 'America/Argentina/Buenos_Aires', 'SA Pacific Standard Time': 'America/Bogota', 'Central America Standard Time': 'America/Costa_Rica', 'Romance Standard Time': 'Europe/Paris', 'W. Europe Standard Time': 'Europe/Berlin', 'GMT Standard Time': 'Europe/London', 'UTC': 'UTC' };

/** DTSTART/DTEND/... → { t, allDay, wall, tz } */
function parseDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  const allDay = prop.params.VALUE === 'DATE' || !m[4];
  let tz = prop.params.TZID ? WIN_TZ[prop.params.TZID] || prop.params.TZID : null;
  if (m[7]) tz = 'UTC';
  const t = allDay ? new Date(wall.y, wall.m - 1, wall.d).getTime() : wallToUtc(wall, tz);
  return { t, allDay, wall, tz };
}
function parseDateList(prop) {
  return prop.value.split(',').map((v) => parseDate({ ...prop, value: v })?.t).filter((x) => x != null);
}

function parseRule(v) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    r[k.toUpperCase()] = val;
  }
  return {
    freq: r.FREQ,
    interval: Math.max(1, +r.INTERVAL || 1),
    count: r.COUNT ? +r.COUNT : null,
    until: r.UNTIL ? parseDate({ value: r.UNTIL, params: {} })?.t : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map((d) => ({ n: d.length > 2 ? parseInt(d, 10) : 0, wd: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2)) })) : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null,
    raw: v,
  };
}

function parseEvents(text) {
  const lines = parseLines(text);
  const events = [];
  let cur = null;
  let depth = 0; // ignora VALARM dentro del evento
  for (const l of lines) {
    if (l.name === 'BEGIN' && l.value === 'VEVENT') {
      cur = { props: {}, multi: {} };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (l.name === 'BEGIN') {
      depth++;
      continue;
    }
    if (l.name === 'END' && l.value !== 'VEVENT') {
      depth--;
      continue;
    }
    if (l.name === 'END' && l.value === 'VEVENT') {
      events.push(cur);
      cur = null;
      continue;
    }
    if (depth) continue;
    if (['ATTENDEE', 'EXDATE', 'RDATE'].includes(l.name)) (cur.multi[l.name] ||= []).push(l);
    else cur.props[l.name] = l;
  }
  return events.map(normalize).filter(Boolean);
}

const LINK_RE = /https:\/\/(?:meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}|[\w.-]*zoom\.us\/[jw]\/[\w?=.&-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+|teams\.live\.com\/meet\/[^\s"<>]+)/i;

function normalize(e) {
  const p = e.props;
  const start = parseDate(p.DTSTART);
  if (!start || !p.UID) return null;
  let end = parseDate(p.DTEND);
  if (!end && p.DURATION) {
    const d = p.DURATION.value.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
    const ms = d ? ((+d[1] || 0) * 7 * DAY + (+d[2] || 0) * DAY + (+d[3] || 0) * 3600000 + (+d[4] || 0) * 60000 + (+d[5] || 0) * 1000) : 0;
    end = { ...start, t: start.t + ms };
  }
  const desc = p.DESCRIPTION ? unesc(p.DESCRIPTION.value) : '';
  const conf = p['X-GOOGLE-CONFERENCE']?.value || (desc.match(LINK_RE) || [])[0] || (p.LOCATION ? (unesc(p.LOCATION.value).match(LINK_RE) || [])[0] : null) || null;
  const attendees = (e.multi.ATTENDEE || []).map((a) => ({ email: a.value.replace(/^mailto:/i, '').toLowerCase(), name: a.params.CN || '', status: (a.params.PARTSTAT || '').toUpperCase(), organizer: false }));
  const organizer = p.ORGANIZER ? { email: p.ORGANIZER.value.replace(/^mailto:/i, '').toLowerCase(), name: p.ORGANIZER.params.CN || '' } : null;
  return {
    uid: p.UID.value,
    recurrenceId: p['RECURRENCE-ID'] ? parseDate(p['RECURRENCE-ID'])?.t : null,
    title: p.SUMMARY ? unesc(p.SUMMARY.value).trim() : '(Sin título)',
    start,
    dur: end ? Math.max(0, end.t - start.t) : start.allDay ? DAY : 0,
    allDay: start.allDay,
    rule: p.RRULE ? parseRule(p.RRULE.value) : null,
    exdates: new Set((e.multi.EXDATE || []).flatMap(parseDateList)),
    rdates: (e.multi.RDATE || []).flatMap(parseDateList),
    status: (p.STATUS?.value || '').toUpperCase(),
    location: p.LOCATION ? unesc(p.LOCATION.value).trim() : '',
    description: desc.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/-::~:~::~[\s\S]*?::~:~::-/g, '').trim(),
    link: conf,
    organizer,
    attendees,
    created: parseDate(p.CREATED)?.t || null,
    modified: parseDate(p['LAST-MODIFIED'])?.t || null,
    transparent: (p.TRANSP?.value || '') === 'TRANSPARENT',
  };
}

// ---- repeticiones (RRULE) ----
function addDays(w, n) {
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const wdOf = (w) => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
const toT = (w, ev) => (ev.allDay ? new Date(w.y, w.m - 1, w.d).getTime() : wallToUtc(w, ev.start.tz));

function nthWeekday(y, m, wd, n) {
  // n>0: n-ésimo; n<0: contando desde el final
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? d : null;
  }
  const last = new Date(Date.UTC(y, m, 0));
  const d = last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

/** Instantes de inicio de un evento entre from y to. */
function occurrences(ev, from, to) {
  const r = ev.rule;
  if (!r) return ev.start.t + ev.dur >= from && ev.start.t <= to ? [ev.start.t] : [];
  const out = [];
  const w0 = ev.start.wall;
  let n = 0;
  const limit = r.until ?? Infinity;
  const push = (w) => {
    const t = toT(w, ev);
    if (t < ev.start.t) return true;
    if (t > limit || (r.count && n >= r.count)) return false;
    n++;
    if (t + ev.dur >= from && t <= to && !ev.exdates.has(t)) out.push(t);
    return t <= to;
  };
  let guard = 0;
  if (r.freq === 'DAILY' || r.freq === 'WEEKLY') {
    const days = r.byday ? r.byday.map((b) => b.wd) : r.freq === 'WEEKLY' ? [wdOf(w0)] : null;
    const step = r.freq === 'DAILY' ? r.interval : 1;
    // semana que empieza el lunes de la semana de DTSTART
    const monday0 = addDays(w0, -((wdOf(w0) + 6) % 7));
    for (let w = w0; guard++ < 5000; w = addDays(w, step)) {
      if (r.freq === 'WEEKLY') {
        const weeks = Math.floor((Date.UTC(w.y, w.m - 1, w.d) - Date.UTC(monday0.y, monday0.m - 1, monday0.d)) / (7 * DAY));
        if (weeks % r.interval) continue;
      }
      if (days && !days.includes(wdOf(w))) continue;
      if (!push(w)) break;
    }
  } else if (r.freq === 'MONTHLY') {
    for (let k = 0; guard++ < 600; k += r.interval) {
      const y = w0.y + Math.floor((w0.m - 1 + k) / 12);
      const m = ((w0.m - 1 + k) % 12) + 1;
      const days = r.byday ? r.byday.map((b) => nthWeekday(y, m, b.wd, b.n || 1)) : (r.bymonthday || [w0.d]).map((d) => (d < 0 ? new Date(Date.UTC(y, m, 0)).getUTCDate() + d + 1 : d));
      let stop = false;
      for (const d of days.filter((d) => d && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()).sort((a, b) => a - b)) {
        if (!push({ ...w0, y, m, d })) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
  } else if (r.freq === 'YEARLY') {
    for (let k = 0; guard++ < 100; k += r.interval) if (!push({ ...w0, y: w0.y + k })) break;
  } else if (ev.start.t + ev.dur >= from && ev.start.t <= to) out.push(ev.start.t);
  for (const t of ev.rdates) if (t + ev.dur >= from && t <= to && !ev.exdates.has(t)) out.push(t);
  return out;
}

const isDaily = (e) => /\b(daily|dailies|stand[ -]?up|scrum|sync diario|reuni[oó]n diaria)\b/i.test(e.title) || (e.rule && ((e.rule.freq === 'DAILY' && e.rule.interval === 1) || (e.rule.freq === 'WEEKLY' && (e.rule.byday?.length || 0) >= 4)));

/** Lista de reuniones entre from y to, ya con repeticiones y excepciones. */
function expand(events, from, to, me) {
  const overrides = new Map(); // uid|instante → evento modificado
  for (const e of events) if (e.recurrenceId != null) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  const out = [];
  for (const e of events) {
    if (e.recurrenceId != null) continue;
    for (const t of occurrences(e, from, to)) {
      const o = overrides.get(`${e.uid}|${t}`);
      const src = o || e;
      if (src.status === 'CANCELLED') continue;
      const start = o ? o.start.t : t;
      out.push(item(src, start, e, me));
    }
  }
  // instancias modificadas que se movieron dentro de la ventana
  for (const o of overrides.values()) {
    if (o.status === 'CANCELLED') continue;
    if (o.start.t + o.dur < from || o.start.t > to) continue;
    if (out.some((x) => x.uid === o.uid && x.start === o.start.t)) continue;
    const parent = events.find((x) => x.uid === o.uid && x.recurrenceId == null);
    if (parent && occurrences(parent, o.recurrenceId - 1, o.recurrenceId + 1).length) continue; // ya contada
    out.push(item(o, o.start.t, parent || o, me));
  }
  return out.sort((a, b) => a.start - b.start);
}

function item(src, start, parent, me) {
  const mine = me ? src.attendees.find((a) => a.email === me) : null;
  const others = src.attendees.filter((a) => a.email !== me && !/resource\.calendar\.google\.com$/.test(a.email));
  return {
    id: `${src.uid}|${start}`,
    uid: src.uid,
    title: src.title,
    start,
    end: start + src.dur,
    allDay: src.allDay,
    recurring: !!parent.rule,
    daily: isDaily(parent) || isDaily(src),
    location: src.location && !LINK_RE.test(src.location) ? src.location : '',
    link: src.link || parent.link,
    description: src.description.slice(0, 600),
    organizer: src.organizer ? src.organizer.name || src.organizer.email : '',
    organizerIsMe: !!(me && src.organizer?.email === me),
    myStatus: mine ? mine.status : '',
    people: others.length,
    peopleNames: others.slice(0, 6).map((a) => a.name || a.email.split('@')[0]),
    created: src.created,
    modified: src.modified,
    free: src.transparent,
  };
}

function ownerOf(url) {
  const m = String(url).match(/\/ical\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** Descarga y prepara los próximos 21 días (caché de 5 min). */
async function load(ctx, force) {
  const url = getUrl(ctx.read);
  if (!url) throw new Error('Pega la dirección secreta de tu calendario para empezar.');
  const c = ctx.read('calendar-cache.json', null);
  if (!force && c && Date.now() - c.at < 5 * 60000 && c.events) return c;
  const r = await fetch(url, { headers: { 'User-Agent': 'ViperTeca' } });
  if (r.status === 404 || r.status === 403 || r.status === 401) throw new Error('Google no reconoce esa dirección: puede que la hayas restablecido. Pega la nueva.');
  if (!r.ok) throw new Error(`Google Calendar no respondió (HTTP ${r.status}).`);
  const text = await r.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Google no devolvió un calendario. Revisa la dirección.');
  const name = (text.match(/^X-WR-CALNAME:(.*)$/m) || [])[1]?.trim() || '';
  const tz = (text.match(/^X-WR-TIMEZONE:(.*)$/m) || [])[1]?.trim() || '';
  const me = ownerOf(url);
  const events = parseEvents(text);
  const now = Date.now();
  const from = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() - DAY;
  const list = expand(events, from, now + 21 * DAY, me);
  const out = { at: now, name, tz, me, events: list };
  ctx.write('calendar-cache.json', out);
  return out;
}

/** Busca reuniones nuevas desde la última vez (para avisar). */
function diffNew(ctx, list) {
  const known = ctx.read('calendar-known.json', null);
  const now = Date.now();
  const future = list.filter((e) => e.start > now);
  const keys = new Set(future.map((e) => e.uid));
  const fresh = known ? future.filter((e) => !known.uids.includes(e.uid)) : [];
  // cambios de hora en reuniones que ya conocías (no repetitivas)
  const moved = known ? future.filter((e) => !e.recurring && known.when?.[e.uid] && known.when[e.uid] !== e.start) : [];
  const when = {};
  for (const e of future) if (!e.recurring && !(e.uid in when)) when[e.uid] = e.start;
  ctx.write('calendar-known.json', { at: now, uids: [...new Set([...(known?.uids || []).slice(-2000), ...keys])], when });
  const seen = new Set();
  return {
    fresh: fresh.filter((e) => !seen.has(e.uid) && seen.add(e.uid)),
    moved,
  };
}

module.exports = { setUrl, linked, load, diffNew, parseEvents, expand, ICS_RE };

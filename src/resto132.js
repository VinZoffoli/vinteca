'use strict';
// 1.32: más para Resto Experience.
//  - Clientes: reseñas de Google (las negativas con respuesta sugerida), vencimientos
//    (dominios, SSL y suscripciones) e incidentes (caídas con causa y análisis).
//  - Equipo: PRs esperando revisión, deploys que fallaron y quién los rompió, tiempo de
//    ciclo (PR abierto → fusionado → en producción) y repos que solo toca una persona.
//  - Vercel: consumo por proyecto, versiones de Next.js y compañía, variables de entorno
//    que faltan en producción (solo los nombres) y previews de ramas sin fusionar.
// Todo se lee: no cambia nada en GitHub, Vercel ni Google.

const DAY = 86400000;
const median = (a) => {
  const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// ============================================================ RESEÑAS (Google Places)
/** Los locales del restaurante (los que tienen su misma web) con sus reseñas. */
async function placeReviews(key, name, url) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri' },
    body: JSON.stringify({ textQuery: name + ' restaurant', languageCode: 'es' }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error('Google Places: ' + String(j.error.message).slice(0, 140));
  const host = hostOf(url);
  return (j.places || []).filter((p) => p.websiteUri && hostOf(p.websiteUri) === host).map((p) => ({
    id: p.id,
    name: p.displayName?.text || name,
    address: p.formattedAddress || '',
    rating: p.rating ?? null,
    count: p.userRatingCount ?? null,
    maps: p.googleMapsUri || null,
    reviews: (p.reviews || []).map((x) => ({
      id: x.name,
      stars: x.rating,
      text: String(x.originalText?.text || x.text?.text || '').slice(0, 1500),
      lang: x.originalText?.languageCode || x.text?.languageCode || '',
      author: x.authorAttribution?.displayName || '',
      at: Date.parse(x.publishTime) || null,
      rel: x.relativePublishTimeDescription || '',
    })),
  }));
}

// ============================================================ PRs ESPERANDO REVISIÓN
async function prQueue(gh, org) {
  const q = encodeURIComponent('org:' + org + ' is:pr is:open draft:false');
  const j = await gh('search/issues?q=' + q + '&per_page=100&sort=created&order=asc');
  const items = (j.items || []).slice(0, 60);
  const out = [];
  await pool(items, 6, async (it) => {
    const repo = String(it.repository_url || '').split('/').pop();
    const n = it.number;
    const [pr, reviews] = await Promise.all([gh('repos/' + org + '/' + repo + '/pulls/' + n).catch(() => null), gh('repos/' + org + '/' + repo + '/pulls/' + n + '/reviews?per_page=100').catch(() => [])]);
    const author = it.user?.login || '?';
    const others = (Array.isArray(reviews) ? reviews : []).filter((r) => r.user?.login && r.user.login !== author);
    const last = others.reduce((m, r) => Math.max(m, Date.parse(r.submitted_at) || 0), 0) || null;
    out.push({
      repo,
      number: n,
      title: String(it.title || '').slice(0, 140),
      url: it.html_url,
      author,
      createdAt: Date.parse(it.created_at),
      ageDays: Math.floor((Date.now() - Date.parse(it.created_at)) / DAY),
      reviewers: [...(pr?.requested_reviewers || []).map((u) => u.login), ...(pr?.requested_teams || []).map((t) => 'equipo ' + t.name)],
      reviewed: others.length > 0,
      approved: others.some((r) => r.state === 'APPROVED'),
      changes: others.some((r) => r.state === 'CHANGES_REQUESTED'),
      lastReviewAt: last,
      base: pr?.base?.ref || null,
    });
  });
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

// ============================================================ VERCEL: DESPLIEGUES
async function vercelDeploys(vercelApi, read, params, pages = 4) {
  const out = [];
  let until;
  for (let i = 0; i < pages; i++) {
    const j = await vercelApi(read, '/v6/deployments', { limit: '100', ...params, ...(until ? { until: String(until) } : {}) });
    out.push(...(j.deployments || []));
    if (!j.pagination?.next || (j.deployments || []).length < 100) break;
    until = j.pagination.next;
  }
  return out;
}
const dShort = (d) => ({
  id: d.uid,
  project: d.name,
  projectId: d.projectId || null,
  state: d.state || d.readyState,
  target: d.target || 'preview',
  at: d.created || d.createdAt,
  branch: d.meta?.githubCommitRef || null,
  sha: d.meta?.githubCommitSha || null,
  commit: String(d.meta?.githubCommitMessage || '').split('\n')[0].slice(0, 140),
  author: d.meta?.githubCommitAuthorLogin || d.meta?.githubCommitAuthorName || d.creator?.username || '?',
  repo: d.meta?.githubRepo || null,
  inspector: d.inspectorUrl || null,
  url: d.url ? 'https://' + d.url : null,
});

/** Los deploys que fallaron en 14 días, quién los rompió y si ya se arregló. */
async function brokenDeploys(vercelApi, read, days = 14) {
  const all = (await vercelDeploys(vercelApi, read, { since: String(Date.now() - days * DAY) })).map(dShort);
  const errors = all.filter((d) => d.state === 'ERROR');
  const out = errors.map((e) => {
    const fix = all.filter((d) => d.project === e.project && d.branch === e.branch && d.state === 'READY' && d.at > e.at).sort((a, b) => a.at - b.at)[0];
    return { ...e, fixedAt: fix?.at || null, fixedBy: fix?.author || null };
  });
  // el motivo, de los que siguen rotos (las últimas líneas de error del build)
  const open = out.filter((d) => !d.fixedAt).slice(0, 10);
  await pool(open, 4, async (d) => {
    const ev = await vercelApi(read, '/v3/deployments/' + d.id + '/events', { limit: '-1', direction: 'backward' }).catch(() => null);
    const lines = (Array.isArray(ev) ? ev : ev?.events || []).map((x) => String(x.text || x.payload?.text || '')).filter((t) => /error|failed|cannot|unexpected|not found/i.test(t));
    d.reason = lines.slice(-3).map((t) => t.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(0, 220));
  });
  return { at: Date.now(), days, total: all.length, list: out.sort((a, b) => Number(!!a.fixedAt) - Number(!!b.fixedAt) || b.at - a.at) };
}

// ============================================================ TIEMPO DE CICLO
/** PR abierto → fusionado → en producción (el primer deploy de producción listo después). */
async function cycleTime(gh, org, vercelApi, read, projects, days = 30) {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const q = encodeURIComponent('org:' + org + ' is:pr is:merged merged:>=' + since);
  const prs = [];
  for (let page = 1; page <= 3; page++) {
    const j = await gh('search/issues?q=' + q + '&per_page=100&page=' + page);
    prs.push(...(j.items || []));
    if ((j.items || []).length < 100) break;
  }
  let prod = [];
  try {
    prod = (await vercelDeploys(vercelApi, read, { target: 'production', since: String(Date.now() - (days + 7) * DAY) }, 6)).map(dShort).filter((d) => d.state === 'READY');
  } catch {}
  const byRepo = new Map();
  for (const p of projects || []) if (p.repo) byRepo.set(String(p.repo).split('/').pop().toLowerCase(), p.name);
  const rows = prs.map((it) => {
    const repo = String(it.repository_url || '').split('/').pop();
    const opened = Date.parse(it.created_at);
    const merged = Date.parse(it.pull_request?.merged_at || it.closed_at);
    const project = byRepo.get(repo.toLowerCase());
    const live = project ? prod.filter((d) => d.project === project && d.at >= merged - 60000 && d.at - merged < 7 * DAY).sort((a, b) => a.at - b.at)[0] : null;
    return { repo, author: it.user?.login || '?', title: String(it.title || '').slice(0, 120), url: it.html_url, opened, merged, live: live?.at || null, toMerge: (merged - opened) / 3600000, toLive: live ? (live.at - merged) / 3600000 : null };
  }).filter((r) => r.merged && r.opened);
  const group = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].map(([k, l]) => ({ key: k, prs: l.length, toMerge: r1(median(l.map((x) => x.toMerge))), toLive: r1(median(l.map((x) => x.toLive))), total: r1(median(l.filter((x) => x.toLive != null).map((x) => x.toMerge + x.toLive))) })).sort((a, b) => b.prs - a.prs);
  };
  return {
    at: Date.now(),
    days,
    prs: rows.length,
    toMerge: r1(median(rows.map((x) => x.toMerge))),
    toLive: r1(median(rows.map((x) => x.toLive))),
    people: group('author'),
    repos: group('repo').slice(0, 25),
    slowest: rows.filter((r) => r.live).sort((a, b) => b.toMerge + b.toLive - (a.toMerge + a.toLive)).slice(0, 5),
  };
}

// ============================================================ REPOS DE UNA SOLA PERSONA
async function busFactor(gh, org, days = 180) {
  const since = Date.now() - days * DAY;
  const repos = [];
  for (let page = 1; page <= 3; page++) {
    const j = await gh('orgs/' + org + '/repos?per_page=100&sort=pushed&page=' + page);
    repos.push(...j);
    if (j.length < 100 || Date.parse(j[j.length - 1]?.pushed_at) < since) break;
  }
  const active = repos.filter((r) => !r.archived && Date.parse(r.pushed_at) >= since).slice(0, 70);
  const out = [];
  await pool(active, 6, async (r) => {
    const list = await gh('repos/' + org + '/' + r.name + '/commits?per_page=100&since=' + new Date(since).toISOString()).catch(() => []);
    const by = {};
    for (const c of Array.isArray(list) ? list : []) {
      const who = c.author?.login || c.commit?.author?.name || '?';
      if (/\[bot\]$|^dependabot|^vercel/i.test(who)) continue;
      by[who] = (by[who] || 0) + 1;
    }
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    if (total < 5) return;
    const sorted = Object.entries(by).sort((a, b) => b[1] - a[1]);
    out.push({ repo: r.name, total, top: sorted[0][0], share: Math.round((sorted[0][1] / total) * 100), people: sorted.map(([w, n]) => ({ who: w, n })), lastPush: Date.parse(r.pushed_at) });
  });
  return { at: Date.now(), days, repos: out.sort((a, b) => b.share - a.share || b.total - a.total) };
}

// ============================================================ CONSUMO DE VERCEL
/**
 * Cobros de Vercel (formato FOCUS, una línea JSON por cobro) de [from, to), sumados por
 * día, proyecto y servicio. Se lee en flujo: un día son miles de líneas.
 */
async function vercelCharges(token, teamId, from, to) {
  const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  if (teamId) q.set('teamId', teamId);
  const r = await fetch('https://api.vercel.com/v1/billing/charges?' + q, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5 * 60000) });
  if (r.status === 401 || r.status === 403) throw new Error('Tu token de Vercel no puede ver la facturación del equipo (hace falta rol Owner, Member, Developer o Billing).');
  if (!r.ok) throw new Error('Vercel (consumo): ' + r.status);
  const days = {};
  const add = (x) => {
    const start = Date.parse(x.ChargePeriodStart);
    if (!start) return;
    // el día del equipo (Vercel corta los días en su zona horaria): el mediodía cae dentro
    const day = new Date(start + 12 * 3600000).toISOString().slice(0, 10);
    const cost = Number(x.BilledCost) || 0;
    const d = (days[day] ||= { total: 0, projects: {}, services: {} });
    d.total += cost;
    const svc = x.ServiceName || 'Otro';
    d.services[svc] = (d.services[svc] || 0) + cost;
    const proj = x.Tags?.ProjectName || (x.ServiceCategory === 'Subscription Licenses' ? '(plan y asientos)' : '(del equipo)');
    const p = (d.projects[proj] ||= { cost: 0, svc: {} });
    p.cost += cost;
    if (cost) {
      const s = (p.svc[svc] ||= { cost: 0, qty: 0, unit: x.ConsumedUnit || '' });
      s.cost += cost;
      s.qty += Number(x.ConsumedQuantity) || 0;
    }
  };
  const dec = new TextDecoder();
  let rest = '';
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += dec.decode(value, { stream: true });
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        add(JSON.parse(l));
      } catch {}
    }
  }
  if (rest.trim()) {
    try {
      add(JSON.parse(rest));
    } catch {}
  }
  // redondeo para guardar menos
  for (const d of Object.values(days)) {
    d.total = Math.round(d.total * 100) / 100;
    for (const k of Object.keys(d.services)) d.services[k] = Math.round(d.services[k] * 100) / 100;
    for (const [k, p] of Object.entries(d.projects)) {
      if (p.cost < 0.005) {
        delete d.projects[k];
        continue;
      }
      p.cost = Math.round(p.cost * 100) / 100;
      for (const [s, v] of Object.entries(p.svc)) {
        if (v.cost < 0.005) delete p.svc[s];
        else p.svc[s] = { cost: Math.round(v.cost * 100) / 100, qty: Math.round(v.qty * 100) / 100, unit: v.unit };
      }
    }
  }
  return days;
}
/** Resumen del mes: gasto hasta hoy, proyección, por proyecto y saltos raros. */
function usageSummary(days, budget) {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const keys = Object.keys(days).sort();
  const inMonth = keys.filter((k) => k.startsWith(month));
  const inPrev = keys.filter((k) => k.startsWith(prevMonth));
  const sum = (list) => Math.round(list.reduce((a, k) => a + days[k].total, 0) * 100) / 100;
  const mtd = sum(inMonth);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const covered = inMonth.length;
  const projected = covered ? Math.round((mtd / covered) * daysInMonth) : null;
  const projects = {};
  for (const k of inMonth) for (const [name, p] of Object.entries(days[k].projects)) {
    const x = (projects[name] ||= { name, cost: 0, svc: {}, daily: {} });
    x.cost += p.cost;
    x.daily[k] = p.cost;
    for (const [s, v] of Object.entries(p.svc)) {
      const y = (x.svc[s] ||= { cost: 0, qty: 0, unit: v.unit });
      y.cost += v.cost;
      y.qty += v.qty;
    }
  }
  const prevByProject = {};
  for (const k of inPrev) for (const [name, p] of Object.entries(days[k].projects)) prevByProject[name] = (prevByProject[name] || 0) + p.cost;
  const list = Object.values(projects).map((p) => {
    const vals = Object.keys(p.daily).sort().map((k) => p.daily[k]);
    const lastDay = vals[vals.length - 1] || 0;
    const base = median(vals.slice(-8, -1));
    return {
      name: p.name,
      cost: Math.round(p.cost * 100) / 100,
      projected: covered ? Math.round((p.cost / covered) * daysInMonth) : null,
      prev: prevByProject[p.name] != null ? Math.round(prevByProject[p.name] * 100) / 100 : null,
      top: Object.entries(p.svc).sort((a, b) => b[1].cost - a[1].cost).slice(0, 3).map(([s, v]) => ({ svc: s, cost: Math.round(v.cost * 100) / 100, qty: Math.round(v.qty * 10) / 10, unit: v.unit })),
      spark: Object.keys(p.daily).sort().slice(-14).map((k) => p.daily[k]),
      spike: base != null && base > 0.5 && lastDay > base * 3 ? { last: Math.round(lastDay * 100) / 100, base: Math.round(base * 100) / 100 } : null,
    };
  }).sort((a, b) => b.cost - a.cost);
  const services = {};
  for (const k of inMonth) for (const [s, c] of Object.entries(days[k].services)) services[s] = (services[s] || 0) + c;
  const limit = budget || (inPrev.length >= 25 ? Math.round(sum(inPrev) * 1.2) : null);
  return {
    month,
    mtd,
    covered,
    daysInMonth,
    projected,
    prev: inPrev.length ? sum(inPrev) : null,
    budget: budget || null,
    limit,
    over: limit != null && projected != null && projected > limit,
    daily: inMonth.map((k) => ({ d: k, total: days[k].total })),
    services: Object.entries(services).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, c]) => ({ svc: s, cost: Math.round(c * 100) / 100 })),
    projects: list,
  };
}

// ============================================================ VERSIONES
const WATCH = ['next', 'react', 'tailwindcss', 'typescript', 'eslint', 'next-intl', 'framer-motion', 'sanity', '@sanity/client', 'payload', 'prisma', '@supabase/supabase-js', 'sharp'];
const clean = (v) => String(v || '').replace(/^[\^~>=<\s]+/, '').split(/\s|\|\|/)[0];
const parts = (v) => clean(v).split('.').map((x) => parseInt(x, 10) || 0);
function lag(cur, latest) {
  if (!cur || !latest || /^(workspace|file|link|git|github|http|latest|\*)/.test(String(cur))) return null;
  const a = parts(cur);
  const b = parts(latest);
  if (a[0] < b[0]) return 'major';
  if (a[0] === b[0] && a[1] < b[1]) return 'minor';
  return 'ok';
}
async function versions(gh, org, repoNames) {
  const rows = [];
  await pool(repoNames.slice(0, 80), 6, async (repo) => {
    const f = await gh('repos/' + org + '/' + repo + '/contents/package.json').catch(() => null);
    if (!f?.content) return;
    let pkg;
    try {
      pkg = JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
    } catch {
      return;
    }
    const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
    rows.push({ repo, deps: Object.fromEntries(WATCH.filter((k) => deps[k]).map((k) => [k, clean(deps[k])])) });
  });
  const used = WATCH.filter((k) => rows.filter((r) => r.deps[k]).length >= 2 || (k === 'next' && rows.some((r) => r.deps[k])));
  const latest = {};
  await pool(used, 4, async (k) => {
    const j = await fetch('https://registry.npmjs.org/' + k.replace('/', '%2F') + '/latest', { signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => null);
    if (j?.version) latest[k] = j.version;
  });
  for (const r of rows) {
    r.lag = Object.fromEntries(used.filter((k) => r.deps[k]).map((k) => [k, lag(r.deps[k], latest[k])]));
    r.majors = Object.values(r.lag).filter((x) => x === 'major').length;
  }
  return { at: Date.now(), packages: used, latest, rows: rows.sort((a, b) => b.majors - a.majors || a.repo.localeCompare(b.repo)) };
}

// ============================================================ VARIABLES DE ENTORNO (solo nombres)
async function envDiff(vercelApi, read, projects) {
  const out = [];
  await pool((projects || []).slice(0, 90), 5, async (p) => {
    const j = await vercelApi(read, '/v9/projects/' + p.id + '/env', {}).catch(() => null);
    // nunca se guardan los valores: solo el nombre y en qué entornos está
    const envs = (j?.envs || []).map((e) => ({ key: e.key, target: Array.isArray(e.target) ? e.target : [e.target].filter(Boolean) }));
    const inT = (t) => new Set(envs.filter((e) => e.target.includes(t)).map((e) => e.key));
    const prod = inT('production');
    const prev = inT('preview');
    const missingInProd = [...prev].filter((k) => !prod.has(k)).sort();
    const missingInPreview = [...prod].filter((k) => !prev.has(k)).sort();
    out.push({ project: p.name, id: p.id, total: new Set(envs.map((e) => e.key)).size, missingInProd, missingInPreview });
  });
  return { at: Date.now(), projects: out.sort((a, b) => b.missingInProd.length - a.missingInProd.length || b.missingInPreview.length - a.missingInPreview.length || a.project.localeCompare(b.project)) };
}

// ============================================================ PREVIEWS OLVIDADOS
async function forgottenPreviews(vercelApi, read, gh, projects, { days = 90, idle = 14 } = {}) {
  const list = (await vercelDeploys(vercelApi, read, { target: 'preview', since: String(Date.now() - days * DAY) }, 6)).map(dShort);
  const repoOf = new Map((projects || []).map((p) => [p.name, p.repo]));
  const last = new Map();
  for (const d of list) {
    if (!d.branch) continue;
    const k = d.project + '|' + d.branch;
    if (!last.has(k) || last.get(k).at < d.at) last.set(k, d);
  }
  const cand = [...last.values()].filter((d) => Date.now() - d.at > idle * DAY && repoOf.get(d.project));
  const defaults = {};
  const out = [];
  await pool(cand.slice(0, 80), 5, async (d) => {
    const repo = repoOf.get(d.project);
    if (!(repo in defaults)) defaults[repo] = (await gh('repos/' + repo).catch(() => null))?.default_branch || 'main';
    const base = defaults[repo];
    if (d.branch === base) return;
    const cmp = await gh('repos/' + repo + '/compare/' + encodeURIComponent(base) + '...' + encodeURIComponent(d.branch)).catch(() => null);
    // la rama ya no existe (se borró al fusionar) o no tiene nada propio: no está olvidada
    if (!cmp || !cmp.ahead_by) return;
    out.push({ project: d.project, repo, branch: d.branch, base, url: d.url, inspector: d.inspector, author: d.author, lastAt: d.at, idleDays: Math.floor((Date.now() - d.at) / DAY), ahead: cmp.ahead_by, behind: cmp.behind_by, compare: cmp.html_url });
  });
  return { at: Date.now(), list: out.sort((a, b) => b.idleDays - a.idleDays) };
}

// ============================================================ VENCIMIENTOS
const addCycle = (date, cycle) => {
  const d = new Date(date + 'T12:00:00');
  if (cycle === 'mensual') d.setMonth(d.getMonth() + 1);
  else if (cycle === 'trimestral') d.setMonth(d.getMonth() + 3);
  else if (cycle === 'anual') d.setFullYear(d.getFullYear() + 1);
  else return null;
  return d.toLocaleDateString('sv');
};
/** La próxima fecha de una suscripción (las periódicas se renuevan solas). */
function nextDate(sub, today = new Date().toLocaleDateString('sv')) {
  let d = sub.date;
  for (let i = 0; d && d < today && i < 400; i++) {
    const n = addCycle(d, sub.cycle);
    if (!n) break;
    d = n;
  }
  return d;
}

module.exports = { placeReviews, prQueue, brokenDeploys, cycleTime, busFactor, vercelCharges, usageSummary, versions, envDiff, forgottenPreviews, nextDate, median, lag };

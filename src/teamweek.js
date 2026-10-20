'use strict';
// 1.24: la semana del equipo. Junta por persona lo que hizo en GitHub (commits y
// ramas), los deploys de producción de Vercel y los tickets de Notion, para que
// Claude Code escriba qué trabajó cada uno y en qué seguirá la semana que viene.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Cuentas de cada responsable (se pueden cambiar en settings.json → teamIds).
const DEFAULT_IDS = {
  a: { gh: ['VinZoffoli'], vc: ['vincenzozoffoli'] },
  b: { gh: ['camilajoucem'], vc: ['camilajoucemenna-6462'] },
  c: { gh: ['chLuis'], vc: ['chluis', 'luis-resto'] },
  d: { gh: ['EmitaQuiel'], vc: ['emily-castillo'] },
};

function ghExe() {
  const known = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe')];
  return known.find((p) => fs.existsSync(p)) || 'gh';
}
/** GitHub con la sesión de `gh` de este PC (la inicias tú con `gh auth login`). */
function gh(apiPath) {
  return new Promise((resolve, reject) => {
    execFile(ghExe(), ['api', apiPath], { windowsHide: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, out, se) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(new Error('Falta GitHub CLI: instálalo e inicia sesión con «gh auth login».'));
        if (/auth login|not logged/i.test(se || '')) return reject(new Error('GitHub CLI no tiene sesión: abre una terminal y ejecuta «gh auth login».'));
        return reject(new Error('GitHub: ' + String(se || err.message).trim().slice(0, 160)));
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('GitHub respondió algo que no entiendo.'));
      }
    });
  });
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Lunes de esta semana (o el anterior si hoy es lunes temprano: se resume la semana pasada). */
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (now - d < 12 * 3600000) d.setDate(d.getDate() - 7);
  return d;
}

async function github(org, since) {
  const repos = (await gh('orgs/' + org + '/repos?per_page=100&sort=pushed')).filter((r) => r.pushed_at && Date.parse(r.pushed_at) >= since.getTime());
  const commits = [];
  const branches = [];
  await pool(repos.slice(0, 80), 6, async (r) => {
    const list = await gh('repos/' + org + '/' + r.name + '/commits?per_page=100&since=' + since.toISOString()).catch(() => []);
    for (const c of list) commits.push({ repo: r.name, login: c.author?.login || c.commit?.author?.name || '?', at: c.commit?.author?.date || null, msg: String(c.commit?.message || '').split('\n')[0].slice(0, 120) });
    const ev = await gh('repos/' + org + '/' + r.name + '/events?per_page=40').catch(() => []);
    for (const e of ev) {
      const ref = String(e.payload?.ref || '').replace('refs/heads/', '');
      if (e.type === 'PushEvent' && Date.parse(e.created_at) >= since.getTime() && ref && ref !== r.default_branch) branches.push({ repo: r.name, login: e.actor?.login, branch: ref, at: e.created_at });
    }
  });
  return { repos: repos.length, commits, branches };
}

async function vercelDeploys(vercelApi, read, since) {
  const out = [];
  let until;
  for (let i = 0; i < 6; i++) {
    const j = await vercelApi(read, '/v6/deployments', { target: 'production', since: String(since.getTime()), limit: '100', ...(until ? { until: String(until) } : {}) });
    out.push(...(j.deployments || []).map((d) => ({ name: d.name, user: d.creator?.username || '?', state: d.state || d.readyState, at: d.created || d.createdAt, msg: String(d.meta?.githubCommitMessage || '').split('\n')[0].slice(0, 100) })));
    if (!j.pagination?.next || (j.deployments || []).length < 100) break;
    until = j.pagination.next;
  }
  return out;
}

/**
 * Ramas olvidadas: ramas con commits que no están en la rama principal y cuyo
 * último commit tiene más de `days` días (repos con actividad en los últimos 90 días).
 */
async function staleBranches(org, { days = 7, maxDays = 45 } = {}) {
  const repos = (await gh('orgs/' + org + '/repos?per_page=100&sort=pushed')).filter((r) => r.pushed_at && Date.now() - Date.parse(r.pushed_at) < 90 * 86400000 && !r.archived);
  const out = [];
  await pool(repos.slice(0, 70), 5, async (r) => {
    const branches = await gh('repos/' + org + '/' + r.name + '/branches?per_page=100').catch(() => []);
    // ramas del agente de SEO y de bots: no son trabajo de nadie
    for (const b of branches.filter((x) => x.name !== r.default_branch && !/^(dependabot|renovate)\/|^seo\/(agent|publish|apply|migration)/.test(x.name)).slice(0, 15)) {
      const cmp = await gh('repos/' + org + '/' + r.name + '/compare/' + encodeURIComponent(r.default_branch) + '...' + encodeURIComponent(b.name) + '?per_page=1').catch(() => null);
      if (!cmp || !cmp.ahead_by) continue;
      const last = cmp.commits?.[cmp.commits.length - 1];
      const at = Date.parse(last?.commit?.author?.date || last?.commit?.committer?.date || 0);
      // más de una semana sin pasar a main, pero no abandonadas hace meses
      if (!at || Date.now() - at < days * 86400000 || Date.now() - at > maxDays * 86400000) continue;
      // si su pull request ya se fusionó (squash), el trabajo sí está en main
      const prs = await gh('repos/' + org + '/' + r.name + '/pulls?state=all&per_page=5&head=' + encodeURIComponent(org + ':' + b.name)).catch(() => []);
      if (prs.some((p) => p.merged_at)) continue;
      out.push({ repo: r.name, branch: b.name, ahead: cmp.ahead_by, behind: cmp.behind_by, at, pr: prs.find((p) => p.state === 'open')?.html_url || null, login: last?.author?.login || last?.commit?.author?.name || '?', msg: String(last?.commit?.message || '').split('\n')[0].slice(0, 100), url: 'https://github.com/' + org + '/' + r.name + '/compare/' + r.default_branch + '...' + encodeURIComponent(b.name) });
    }
  });
  return out.sort((a, b) => a.at - b.at);
}

// "website-b-gezzos" → "gezzos"; "Gezzo’s" → "gezzos"
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^website-[a-d]-/, '').replace(/[^a-z0-9]/g, '');
/** Repos con bastante trabajo esta semana que no aparecen en ningún ticket ni en el pipeline. */
function withoutTicket(commits, notionPeople, pipeline, min = 5) {
  const known = [...(pipeline || []).map((r) => r.name), ...(notionPeople || []).flatMap((p) => [...(p.tickets || []), ...(p.week?.touched || []), ...(p.week?.closed || []), ...(p.week?.next || [])].map((t) => t.title))].map(slug).filter((x) => x.length >= 3);
  const byRepo = {};
  for (const c of commits) if (/^website-/.test(c.repo)) (byRepo[c.repo] ||= []).push(c);
  return Object.entries(byRepo)
    .filter(([, list]) => list.length >= min)
    .filter(([repo]) => {
      const s = slug(repo);
      // coincide si el nombre del cliente aparece en un ticket o al revés (p. ej. "corazonbybaires" ↔ "corazon")
      return !known.some((k) => k.includes(s) || s.includes(k) || (s.length > 5 && k.includes(s.slice(0, 6))));
    })
    .map(([repo, list]) => ({ repo, commits: list.length, who: [...new Set(list.map((c) => c.login))] }));
}

const count = (arr, key) => {
  const m = {};
  for (const x of arr) m[key(x)] = (m[key(x)] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

/**
 * Junta todo por persona. Lo que falle (GitHub, Vercel o Notion) se anota y se sigue.
 * deps: { read, vercelApi, notionTeam, leaders, pipeline }
 */
async function collect({ read, vercelApi, notionTeam, leaders, pipeline }) {
  const s = read('settings.json', {});
  const org = s.githubOrg || 'Resto-Experience';
  const ids = { ...DEFAULT_IDS, ...(s.teamIds || {}) };
  const since = weekStart();
  const errors = [];
  const [g, v, n] = await Promise.all([
    github(org, since).catch((e) => (errors.push(e.message), null)),
    vercelDeploys(vercelApi, read, since).catch((e) => (errors.push(e.message), null)),
    notionTeam().catch((e) => (errors.push('Notion: ' + e.message), null)),
  ]);
  const lc = (x) => String(x || '').toLowerCase();
  const people = Object.entries(leaders).map(([squad, name]) => {
    const id = ids[squad] || { gh: [], vc: [] };
    const mine = (g?.commits || []).filter((c) => id.gh.map(lc).includes(lc(c.login)));
    const deps = (v || []).filter((d) => id.vc.map(lc).includes(lc(d.user)));
    const np = (n?.people || []).find((p) => p.squad === squad) || null;
    return {
      squad,
      name,
      commits: mine.length,
      repos: count(mine, (c) => c.repo).map(([repo, k]) => ({ repo, commits: k, msgs: [...new Set(mine.filter((c) => c.repo === repo).map((c) => c.msg))].slice(0, 10) })),
      branches: [...new Map((g?.branches || []).filter((b) => id.gh.map(lc).includes(lc(b.login))).map((b) => [b.repo + ':' + b.branch, b])).values()].map((b) => ({ repo: b.repo, branch: b.branch })),
      deploys: deps.length,
      projects: count(deps, (d) => d.name).map(([name, k]) => ({ name, deploys: k })),
      failed: deps.filter((d) => d.state === 'ERROR').map((d) => ({ name: d.name, at: d.at })),
      notion: np ? { open: np.open, late: np.late, stale: np.stale, closed: np.week?.closed || [], touched: np.week?.touched || [], next: np.week?.next || [], overdue: (np.tickets || []).filter((t) => t.late).slice(0, 6) } : null,
      pipeline: (pipeline || []).filter((r) => (String(r.squad || '').match(/squad\s*([a-d])/i)?.[1] || String(r.repo || '').match(/website-([a-d])-/i)?.[1] || '').toLowerCase() === squad && r.group !== 'done' && !/cancel/i.test(r.status || '')).map((r) => ({ name: String(r.name || '').replace(/<[^>]+>|\*\*/g, '').trim(), status: r.status })),
    };
  });
  const known = new Set(Object.values(ids).flatMap((x) => x.gh.map(lc)));
  const others = count((g?.commits || []).filter((c) => !known.has(lc(c.login))), (c) => c.login).map(([login, k]) => ({ login, commits: k, repos: [...new Set(g.commits.filter((c) => c.login === login).map((c) => c.repo))].slice(0, 5) }));
  const stale = g ? await staleBranches(org).catch((e) => (errors.push('Ramas: ' + e.message), [])) : [];
  const login2squad = Object.fromEntries(Object.entries(ids).flatMap(([sq, x]) => x.gh.map((l) => [lc(l), sq])));
  for (const b of stale) b.squad = login2squad[lc(b.login)] || (b.repo.match(/^website-([a-d])-/)?.[1] ?? null);
  const noTicket = g && n ? withoutTicket(g.commits, n.people, pipeline) : [];
  for (const x of noTicket) x.squad = x.repo.match(/^website-([a-d])-/)?.[1] || null;
  return { at: Date.now(), since: since.getTime(), org, errors, sources: { github: !!g, vercel: !!v, notion: !!n }, totals: { repos: g?.repos || 0, commits: g?.commits.length || 0, deploys: v?.length || 0 }, people, others, stale, noTicket };
}

/** Texto para Claude Code con los datos de cada persona. */
function prompt(data) {
  const day = (t) => new Date(t).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  const lines = data.people.map((p) => {
    const L = ['## ' + p.name + ' (Squad ' + p.squad.toUpperCase() + ')'];
    L.push('GitHub: ' + p.commits + ' commits.');
    for (const r of p.repos.slice(0, 8)) L.push('- ' + r.repo + ' (' + r.commits + '): ' + r.msgs.join(' | '));
    if (p.branches.length) L.push('Ramas con trabajo sin pasar a main: ' + p.branches.map((b) => b.repo + '/' + b.branch).join(', '));
    if (data.sources.vercel) L.push('Vercel: ' + p.deploys + ' deploys a producción' + (p.projects.length ? ' (' + p.projects.map((x) => x.name + ' ' + x.deploys).join(', ') + ')' : '') + (p.failed.length ? '; fallidos: ' + p.failed.map((f) => f.name).join(', ') : '') + '.');
    if (p.notion) {
      L.push('Notion: ' + p.notion.open + ' tickets abiertos, ' + p.notion.late + ' vencidos.');
      if (p.notion.closed.length) L.push('Cerró esta semana: ' + p.notion.closed.map((t) => t.title).join(' | '));
      if (p.notion.touched.length) L.push('Movió esta semana: ' + p.notion.touched.map((t) => t.title + ' [' + t.status + ']').join(' | '));
      if (p.notion.next.length) L.push('Vence en los próximos días: ' + p.notion.next.map((t) => t.title + ' (' + t.deadline + ', ' + t.status + ')').join(' | '));
      if (p.notion.overdue.length) L.push('Vencidos: ' + p.notion.overdue.map((t) => t.title + ' (' + t.deadline + ')').join(' | '));
    }
    if (p.pipeline.length) L.push('Webs de su squad en el pipeline: ' + p.pipeline.map((w) => w.name + ' [' + w.status + ']').join(', '));
    return L.join('\n');
  });
  const missing = [!data.sources.github && 'GitHub', !data.sources.vercel && 'los deploys de Vercel', !data.sources.notion && 'los tickets de Notion'].filter(Boolean);
  return 'Semana desde el ' + day(data.since) + ' hasta hoy, ' + day(Date.now()) + '. Equipo web de Resto Experience (una agencia de marketing para restaurantes). Cada web vive en un repo «website-<squad>-<cliente>».\n\n' +
    lines.join('\n\n') +
    (data.stale?.length ? '\n\nRamas olvidadas (commits sin pasar a main desde hace más de 7 días): ' + data.stale.slice(0, 15).map((b) => b.repo + '/' + b.branch + ' de ' + b.login + ' (' + b.ahead + ' commits, último ' + new Date(b.at).toLocaleDateString('es') + ')').join('; ') : '') +
    (data.noTicket?.length ? '\n\nWebs con trabajo esta semana sin ticket en Notion: ' + data.noTicket.map((x) => x.repo + ' (' + x.commits + ' commits de ' + x.who.join(', ') + ')').join('; ') : '') +
    (data.others.length ? '\n\nOtros que hicieron commits: ' + data.others.map((o) => o.login + ' (' + o.commits + ': ' + o.repos.join(', ') + ')').join('; ') : '') +
    (missing.length ? '\n\nNo se pudieron leer ' + missing.join(' ni ') + ': no digas nada sobre eso (ni que hubo cero), simplemente no lo menciones.' : '') +
    '\n\nPara cada persona escribe, en español neutro, breve y concreto (nombres de clientes y webs, no de repos):\n' +
    '- "week": 3 a 5 frases de lo que trabajó esta semana, de lo más importante a lo menos.\n' +
    '- "next": 2 a 4 frases de en qué probablemente trabajará la próxima semana (según ramas abiertas, webs en QA o en curso, tickets que vencen y lo que quedó a medias).\n' +
    '- "watch": 0 a 3 cosas a vigilar (tickets vencidos, deploys fallidos, trabajo sin ticket en Notion, webs de otro squad).\n' +
    'Y "team": una frase con el resumen del equipo.\n' +
    'Responde SOLO con este JSON: {"team":"","people":[{"squad":"a","week":[""],"next":[""],"watch":[""]}]}';
}

module.exports = { collect, prompt, weekStart, DEFAULT_IDS, staleBranches, withoutTicket, gh, pool };

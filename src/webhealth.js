// Salud de las webs en producción y despliegues de Vercel.
//  - Salud: si responde, cuánto tarda, cuándo vence el certificado SSL y, con
//    tu clave de PageSpeed (gratis en Google Cloud), la nota de velocidad y SEO.
//  - Vercel: el último despliegue de producción y de preview de cada proyecto,
//    con tu token de Vercel (lo pegas tú; se guarda cifrado).
const tls = require('tls');
const { safeStorage } = require('electron');

// ---- secretos guardados (cifrados con tu usuario de Windows) ----
function setSecret({ read, write }, key, value) {
  const s = read('settings.json', {});
  const v = String(value || '').trim();
  if (!v) delete s[key];
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
    s[key] = safeStorage.encryptString(v).toString('base64');
  }
  write('settings.json', s);
  return !!v;
}
function getSecret(read, key) {
  const s = read('settings.json', {});
  if (!s[key]) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s[key], 'base64'));
  } catch {
    return null;
  }
}

// ---- salud ----
function sslExpiry(host) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      resolve(c?.valid_to ? { until: new Date(c.valid_to).getTime(), issuer: c.issuer?.O || c.issuer?.CN || '' } : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => {
      sock.destroy();
      resolve(null);
    });
  });
}

async function check(url) {
  const out = { url, at: Date.now() };
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 ViperTeca-monitor' } });
    out.status = r.status;
    out.ms = Date.now() - t0;
    out.finalUrl = r.url;
    out.up = r.status < 500 && r.status !== 404;
    await r.body?.cancel().catch(() => {});
  } catch (e) {
    out.up = false;
    out.error = e.name === 'TimeoutError' ? 'No respondió en 15 s' : /ENOTFOUND|getaddrinfo/.test(String(e.cause?.code || e.message)) ? 'El dominio no existe o no apunta a ningún servidor' : String(e.cause?.code || e.message).slice(0, 120);
  }
  try {
    const host = new URL(out.finalUrl || url).hostname;
    const ssl = await sslExpiry(host);
    if (ssl) {
      out.sslUntil = ssl.until;
      out.sslDays = Math.floor((ssl.until - Date.now()) / 86400000);
      out.sslIssuer = ssl.issuer;
    }
  } catch {}
  return out;
}

async function pagespeed(read, url) {
  const key = getSecret(read, 'psiKeyEnc');
  if (!key) throw new Error('Añade tu clave de PageSpeed para medir velocidad y SEO.');
  const q = new URLSearchParams({ url, strategy: 'mobile', key });
  q.append('category', 'PERFORMANCE');
  q.append('category', 'SEO');
  q.append('category', 'ACCESSIBILITY');
  const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.code === 400 && /key/i.test(j.error.message) ? 'La clave de PageSpeed no es válida.' : `PageSpeed: ${String(j.error.message).slice(0, 140)}`);
  const c = j.lighthouseResult?.categories || {};
  const a = j.lighthouseResult?.audits || {};
  const sc = (x) => (x?.score == null ? null : Math.round(x.score * 100));
  return { at: Date.now(), performance: sc(c.performance), seo: sc(c.seo), accessibility: sc(c.accessibility), lcp: a['largest-contentful-paint']?.displayValue || null, cls: a['cumulative-layout-shift']?.displayValue || null };
}

/** Revisa todas las webs (5 a la vez) y guarda el historial corto. */
async function checkAll(sites, { read, write }) {
  const prev = read('webhealth.json', { sites: {} });
  const out = { at: Date.now(), sites: { ...prev.sites } };
  let i = 0;
  const changes = [];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (i < sites.length) {
        const s = sites[i++];
        const r = await check(s.url);
        const old = prev.sites[s.url];
        r.fails = r.up ? 0 : (old?.fails || 0) + 1;
        r.psi = old?.psi || null;
        r.name = s.name;
        r.downSince = r.up ? null : old?.downSince || Date.now();
        if (!r.up && r.fails === 2) changes.push({ kind: 'down', site: s, r });
        if (r.up && old && old.fails >= 2) changes.push({ kind: 'up', site: s, r });
        if (r.sslDays != null && r.sslDays <= 14 && (!old || old.sslDays > 14)) changes.push({ kind: 'ssl', site: s, r });
        out.sites[s.url] = r;
      }
    })
  );
  write('webhealth.json', out);
  return { ...out, changes };
}

// ---- Vercel ----
async function vercel(read, path, params = {}) {
  const token = getSecret(read, 'vercelEnc');
  if (!token) throw new Error('Pega tu token de Vercel para ver los despliegues.');
  const s = read('settings.json', {});
  const q = new URLSearchParams(params);
  if (s.vercelTeam) q.set('teamId', s.vercelTeam);
  const r = await fetch(`https://api.vercel.com${path}?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error('Vercel no acepta el token (caducado o sin acceso a ese equipo).');
  if (!r.ok) throw new Error(`Vercel: ${j.error?.message || r.status}`);
  return j;
}

async function vercelTeams(read) {
  const j = await vercel(read, '/v2/teams', { limit: 50 }).catch(() => ({ teams: [] }));
  return (j.teams || []).map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
}

const depl = (d) =>
  d && {
    id: d.uid,
    url: d.url ? `https://${d.url}` : null,
    state: d.readyState || d.state,
    target: d.target || 'preview',
    at: d.created || d.createdAt,
    ready: d.ready || null,
    branch: d.meta?.githubCommitRef || null,
    commit: d.meta?.githubCommitMessage ? d.meta.githubCommitMessage.split('\n')[0].slice(0, 120) : null,
    sha: d.meta?.githubCommitSha ? d.meta.githubCommitSha.slice(0, 7) : null,
    author: d.meta?.githubCommitAuthorName || d.creator?.username || null,
    inspector: d.inspectorUrl || null,
  };

/** Proyectos con su último despliegue de producción y de preview. */
async function deployments({ read, write }) {
  const projects = [];
  let until;
  for (let i = 0; i < 5; i++) {
    const j = await vercel(read, '/v9/projects', { limit: 100, ...(until ? { until } : {}) });
    projects.push(...(j.projects || []));
    if (!j.pagination?.next) break;
    until = j.pagination.next;
  }
  const list = await Promise.all(
    projects.map(async (p) => {
      const [prod, prev] = await Promise.all([
        vercel(read, '/v6/deployments', { projectId: p.id, target: 'production', limit: 1 }).then((j) => j.deployments?.[0]).catch(() => null),
        vercel(read, '/v6/deployments', { projectId: p.id, limit: 1 }).then((j) => j.deployments?.[0]).catch(() => null),
      ]);
      const domain = (p.targets?.production?.alias || []).find((a) => !/vercel\.app$/.test(a)) || (p.targets?.production?.alias || [])[0] || null;
      return {
        id: p.id,
        name: p.name,
        framework: p.framework || null,
        repo: p.link?.org && p.link?.repo ? `${p.link.org}/${p.link.repo}`.toLowerCase() : null,
        domain: domain ? `https://${domain}` : null,
        production: depl(prod),
        latest: depl(prev),
        dashboard: null,
      };
    })
  );
  const prevState = read('vercel.json', null);
  const out = { at: Date.now(), projects: list.sort((a, b) => (b.latest?.at || 0) - (a.latest?.at || 0)) };
  // despliegues que fallaron desde la última vez
  const known = new Set((prevState?.projects || []).flatMap((p) => [p.latest?.id, p.production?.id]).filter(Boolean));
  out.failed = prevState ? list.filter((p) => p.latest?.state === 'ERROR' && !known.has(p.latest.id)) : [];
  write('vercel.json', out);
  return out;
}


/**
 * Errores en vivo de la producción de un proyecto (registros de Vercel): errores
 * de funciones y respuestas 5xx de las últimas horas. Vercel guarda 1 h en Hobby
 * y 1 día en Pro. La respuesta es un flujo: se lee unos segundos y se corta.
 */
async function runtimeErrors(read, p, sinceMs = 3 * 3600000) {
  const token = getSecret(read, 'vercelEnc');
  if (!token || !p?.id || !p.production?.id) return [];
  const s = read('settings.json', {});
  const q = new URLSearchParams();
  if (s.vercelTeam) q.set('teamId', s.vercelTeam);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  const out = [];
  try {
    const r = await fetch('https://api.vercel.com/v1/projects/' + p.id + '/deployments/' + p.production.id + '/runtime-logs?' + q, { headers: { Authorization: 'Bearer ' + token }, signal: ctrl.signal });
    if (!r.ok || !r.body) return [];
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.source === 'delimiter') continue;
          const at = Number(j.timestampInMs) || 0;
          if (at && at < Date.now() - sinceMs) continue;
          if (['error', 'fatal'].includes(j.level) || Number(j.responseStatusCode) >= 500) out.push({ at, level: j.level, status: Number(j.responseStatusCode) || null, path: String(j.requestPath || '').slice(0, 200), msg: String(j.message || '').slice(0, 300) });
        } catch {}
      }
      if (out.length > 300) break;
    }
  } catch {
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return out;
}

module.exports = { setSecret, getSecret, check, checkAll, pagespeed, deployments, vercelTeams, runtimeErrors };

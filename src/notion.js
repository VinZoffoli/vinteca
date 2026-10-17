// Notion de Resto Experience: tus tickets (Tickets General) y el pipeline de
// webs (Pipeline), con el servidor oficial de Notion (mcp.notion.com).
//  - Conectas con "Conectar con Notion": se abre Notion en tu navegador, aceptas
//    y vuelve a la app (OAuth con PKCE). No hace falta ser administrador ni
//    crear integraciones. La app nunca ve tu contraseña.
//  - Solo se guarda el permiso de acceso (refresh token), cifrado con tu usuario
//    de Windows. Solo lectura: la app no cambia nada en Notion.
const http = require('http');
const crypto = require('crypto');
const { shell, safeStorage } = require('electron');

const SERVER = 'https://mcp.notion.com';
const MCP = `${SERVER}/mcp`;
const PORT = 47812;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
// Bases de Resto Experience
const TICKETS = 'collection://2d82e508-64d6-43e7-aacb-282b387dbd7a';
const PIPELINE_VIEW_ALL = 'https://app.notion.com/p/85f691ae57124f69a42551b47519f200?v=0b91ca036aef4f91aba2e870d48f0665';
const PIPELINE_VIEW_MINE = 'https://app.notion.com/p/85f691ae57124f69a42551b47519f200?v=bfb6d0eedb9d4bbdb0440dd4ee2e7482';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let access = null;
let session = null; // id de sesión MCP
let toolNames = null;

// ---- credenciales guardadas ----
function cfg(read) {
  return read('settings.json', {});
}
function save(read, write, patch) {
  const s = cfg(read);
  Object.assign(s, patch);
  for (const k of Object.keys(patch)) if (patch[k] == null) delete s[k];
  write('settings.json', s);
}
function loadRefresh(read) {
  const s = cfg(read);
  if (!s.notionEnc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.notionEnc, 'base64'));
  } catch {
    return null;
  }
}
const linked = (read) => !!cfg(read).notionEnc;

async function register(read, write) {
  const s = cfg(read);
  if (s.notionClientId) return s.notionClientId;
  const r = await fetch(`${SERVER}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'ViperTeca', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`Notion no aceptó registrar la app (${j.error_description || j.error || r.status}).`);
  save(read, write, { notionClientId: j.client_id });
  return j.client_id;
}

async function token(read, body) {
  const r = await fetch(`${SERVER}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg(read).notionClientId, resource: MCP, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error === 'invalid_grant' ? 'La conexión con Notion caducó. Vuelve a conectar.' : `Notion rechazó el acceso (${j.error_description || j.error || r.status}).`);
    e.code = j.error;
    throw e;
  }
  return j;
}

/** Conectar: abre Notion en el navegador y espera la vuelta (máx. 5 min). */
async function login({ read, write }) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
  const clientId = await register(read, write);
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      err ? reject(err) : resolve(v);
    };
    const page = (t, m) => `<!doctype html><meta charset="utf-8"><title>${t}</title><body style="font:16px system-ui;background:#191919;color:#fff;display:grid;place-items:center;height:90vh;text-align:center"><div><h1>${t}</h1><p>${m}</p></div>`;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (u.searchParams.get('state') !== state) return res.end(page('Algo no cuadra', 'Vuelve a intentarlo desde ViperTeca.'));
      if (u.searchParams.get('error')) {
        res.end(page('No se conectó', 'Cancelaste el acceso. Puedes cerrar esta pestaña.'));
        return finish(new Error('Cancelaste el acceso a Notion.'));
      }
      try {
        const t = await token(read, { grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: verifier });
        save(read, write, { notionEnc: safeStorage.encryptString(t.refresh_token).toString('base64') });
        access = { token: t.access_token, until: Date.now() + ((t.expires_in || 3600) - 60) * 1000 };
        session = null;
        res.end(page('¡Listo!', 'Notion ya está conectado a ViperTeca. Puedes cerrar esta pestaña.'));
        finish(null, true);
      } catch (e) {
        res.end(page('No se conectó', e.message));
        finish(e);
      }
    });
    server.on('error', (e) => finish(new Error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} está ocupado.` : e.message)));
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state, resource: MCP });
      shell.openExternal(`${SERVER}/authorize?${q}`);
    });
    const timer = setTimeout(() => finish(new Error('Pasaron 5 minutos sin terminar la conexión.')), 5 * 60000);
  });
}

async function accessToken(ctx) {
  if (access && Date.now() < access.until) return access.token;
  const refresh = loadRefresh(ctx.read);
  if (!refresh) throw new Error('Conecta tu cuenta de Notion.');
  try {
    const t = await token(ctx.read, { grant_type: 'refresh_token', refresh_token: refresh });
    if (t.refresh_token) save(ctx.read, ctx.write, { notionEnc: safeStorage.encryptString(t.refresh_token).toString('base64') });
    access = { token: t.access_token, until: Date.now() + ((t.expires_in || 3600) - 60) * 1000 };
    return access.token;
  } catch (e) {
    if (e.code === 'invalid_grant') save(ctx.read, ctx.write, { notionEnc: null });
    throw e;
  }
}

// ---- cliente MCP (JSON-RPC por HTTP) ----
let rpcId = 0;
async function rpc(ctx, method, params, notify) {
  const headers = { Authorization: `Bearer ${await accessToken(ctx)}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };
  if (session) headers['Mcp-Session-Id'] = session;
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params };
  const r = await fetch(MCP, { method: 'POST', headers, body: JSON.stringify(body) });
  if (r.headers.get('mcp-session-id')) session = r.headers.get('mcp-session-id');
  if (r.status === 401) {
    access = null;
    throw Object.assign(new Error('La conexión con Notion caducó.'), { retry: true });
  }
  if (r.status === 404 && session) {
    session = null;
    throw Object.assign(new Error('Sesión de Notion reiniciada.'), { retry: true });
  }
  if (notify) return null;
  const text = await r.text();
  let msg = null;
  if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.id === body.id) msg = j;
      } catch {}
    }
  } else msg = JSON.parse(text || '{}');
  if (!msg) throw new Error(`Notion no respondió bien (HTTP ${r.status}).`);
  if (msg.error) throw new Error(`Notion: ${msg.error.message}`);
  return msg.result;
}

async function ensureSession(ctx) {
  if (session && toolNames) return;
  await rpc(ctx, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ViperTeca', version: '1.8.0' } });
  await rpc(ctx, 'notifications/initialized', {}, true);
  const list = await rpc(ctx, 'tools/list', {});
  toolNames = (list.tools || []).map((t) => t.name);
}

async function tool(ctx, short, args) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureSession(ctx);
      const name = toolNames.find((n) => n === short || n === `notion-${short}` || n.endsWith(short)) || short;
      const res = await rpc(ctx, 'tools/call', { name, arguments: args });
      const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (res.isError) throw new Error(`Notion: ${text.slice(0, 200)}`);
      return text;
    } catch (e) {
      if (!e.retry || attempt) throw e;
      session = null;
      toolNames = null;
    }
  }
}

const parseJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    const m = String(t).match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
};

// ---- datos ----
const TICKET_GROUP = {
  todo: ['Waiting for Information', 'CSM x PMs', 'To-do', 'Error de Pago', 'Request incomplete'],
  doing: ['Content Visits', 'PMs x CSM', 'Always On', 'In progress', 'Pending Feedback', 'To Revise / Needs Correction', 'Approved', 'Live'],
  done: ['Done', 'Canceled'],
};
const groupOf = (status, map) => Object.keys(map).find((g) => map[g].includes(status)) || 'doing';

function ticket(r) {
  const people = (() => {
    try {
      return JSON.parse(r.Responsible || '[]');
    } catch {
      return [];
    }
  })();
  return {
    id: r.url.split('/').pop(),
    num: r['userDefined:ID'] || null,
    url: r.url,
    title: r['What to Do'] || 'Sin título',
    status: r.Status || '',
    group: groupOf(r.Status, TICKET_GROUP),
    priority: r.Priority || '',
    deadline: r['date:Deadline:start'] || null,
    created: r['Created time'] || r['Fecha de creación'] || null,
    edited: r['Last edited time'] || null,
    summary: (r.Summary || '').replace(/^Resumen:\s*/i, ''),
    people: people.length,
  };
}

async function query(ctx, data) {
  const t = await tool(ctx, 'query-data-sources', { data });
  return parseJson(t) || { results: [] };
}

/** Tickets donde eres "Responsible": abiertos y los cerrados del último mes. */
async function tickets(ctx) {
  const me = { type: 'property', property: 'Responsible', propertyType: 'person', operator: 'person_contains', value: { type: 'relative', value: 'me' } };
  const open = await query(ctx, { mode: 'rows', data_source_url: TICKETS, filter: { type: 'group', operator: 'and', filters: [me, { type: 'property', property: 'Status', propertyType: 'status', operator: 'status_is_not', value: [{ type: 'is_option', value: 'Done' }, { type: 'is_option', value: 'Canceled' }] }] }, sort: [{ property: 'Deadline', direction: 'ascending' }], limit: 100 });
  const closed = await query(ctx, { mode: 'rows', data_source_url: TICKETS, filter: { type: 'group', operator: 'and', filters: [me, { type: 'property', property: 'Status', propertyType: 'status', operator: 'status_is', value: { type: 'is_option', value: 'Done' } }, { type: 'property', property: 'Last edited time', propertyType: 'last_edited_time', operator: 'date_is_on_or_after', value: { type: 'relative', value: 'one_month_ago' } }] }, sort: [{ property: 'Last edited time', direction: 'descending' }], limit: 30 }).catch(() => ({ results: [] }));
  const list = [...(open.results || []), ...(closed.results || [])].map(ticket);
  const seen = new Set();
  return list.filter((t) => !seen.has(t.id) && seen.add(t.id));
}

// ---- chat del ticket y análisis ----
function parseComments(xml) {
  const names = {};
  for (const m of xml.matchAll(/<mention-user url="user:\/\/([^/"]+)[^"]*">([^<]+)<\/mention-user>/g)) names[m[1]] = m[2];
  const out = [];
  for (const m of xml.matchAll(/<comment [^>]*user-url="user:\/\/([^/"]+)\/?([^"]*)"[^>]*datetime="([^"]+)"([^>]*)>([\s\S]*?)<\/comment>/g)) {
    const [, uid, email, dt, rest, body] = m;
    const text = body
      .replace(/<mention-user[^>]*>([^<]+)<\/mention-user>/g, '@$1')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/\[(https?:[^\]]+)\]\((https?:[^)]+)\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    out.push({ uid, author: names[uid] || (email ? email.split('@')[0] : 'Alguien'), at: dt, mine: /by-you="true"/.test(rest), images: Number((rest.match(/image-attached-count="(\d+)"/) || [0, 0])[1]), text });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const PENDING = /\b(falta|faltar[ií]a|pendiente|corregir|correcci[oó]n|cambiar|cambio|ajust|arregl|todav[ií]a|a[uú]n no|no funciona|error|necesit|podr[aá]n|me pod|porfi|por favor|qu[eé] qued[oó]|en qu[eé] qued[oó]|novedades|missing|please|pending|fix|change|update|need|could you|can you)\b|\?/i;
const DONE = /\b(listo|lista|terminad|aprobad|perfecto|gracias|todo ok|todo bien|publicad|subid|ya est[aá]|done|approved|looks good|thank you|thanks|live)\b/i;

function analyze(t, comments, meId) {
  const last = comments[comments.length - 1];
  const now = Date.now();
  const due = t.deadline ? new Date(t.deadline + 'T23:59:59').getTime() : null;
  const notes = [];
  if (t.group === 'done') notes.push('Cerrado en Notion.');
  if (due && t.group !== 'done') {
    const days = Math.round((due - now) / 86400000);
    notes.push(days < 0 ? `Venció hace ${-days} ${-days === 1 ? 'día' : 'días'}.` : days === 0 ? 'Vence hoy.' : `Vence en ${days} ${days === 1 ? 'día' : 'días'}.`);
  }
  let verdict = 'unknown';
  let why = 'Sin conversación en el ticket.';
  if (last) {
    const mentionsMe = meId && new RegExp(meId).test(JSON.stringify(last));
    const recent = comments.slice(-4);
    const pend = recent.filter((c) => !c.mine && PENDING.test(c.text));
    if (last.mine) {
      verdict = DONE.test(last.text) ? 'done' : 'waiting';
      why = verdict === 'done' ? 'Tu último mensaje da el trabajo por terminado.' : 'Tu mensaje es el último: estás esperando respuesta.';
    } else if (PENDING.test(last.text)) {
      verdict = 'pending';
      why = `${last.author} pide algo en el último mensaje.`;
    } else if (DONE.test(last.text)) {
      verdict = pend.length ? 'pending' : 'done';
      why = pend.length ? 'Hay peticiones recientes sin cerrar.' : `${last.author} lo da por bueno.`;
    } else {
      verdict = 'review';
      why = `Último mensaje de ${last.author}: revisa si te toca responder.`;
    }
    if (mentionsMe && !last.mine) why += ' Te menciona.';
  }
  if (t.group === 'done' && verdict === 'pending') why = 'Está cerrado, pero el último mensaje pide algo: revísalo.';
  return { verdict, why, notes, last: last ? { author: last.author, at: last.at, text: last.text.slice(0, 280), mine: last.mine } : null, count: comments.length };
}

async function ticketChat(ctx, id, t) {
  const xml = await tool(ctx, 'get-comments', { page_id: id, include_all_blocks: true });
  const comments = parseComments(xml);
  const meId = cfg(ctx.read).notionUserId || null;
  return { comments: comments.slice(-30), analysis: analyze(t || { group: 'doing' }, comments, meId) };
}

// ---- pipeline de webs ----
const PIPE_GROUP = {
  todo: ['To Do', 'Pending', 'To Do - SEO'],
  doing: ['In Progress', 'QA SEO', 'QA', 'Corrections', 'Client Review', 'Final Customer Review'],
  stopped: ['On Hold', 'Blocked', 'Canceled'],
  done: ['Ready for Deployment', 'Live con deuda técnica', '🚀 Live'],
};
const PIPE_ORDER = ['To Do', 'Pending', 'To Do - SEO', 'In Progress', 'QA', 'QA SEO', 'Corrections', 'Client Review', 'Final Customer Review', 'On Hold', 'Blocked', 'Ready for Deployment', 'Live con deuda técnica', '🚀 Live', 'Canceled'];

function pipeRow(r) {
  return {
    id: r.url?.split('/').pop(),
    url: r.url,
    name: r['Project Name'] || 'Sin nombre',
    status: r.Status || 'Sin estado',
    group: groupOf(r.Status, PIPE_GROUP),
    priority: r.Priority || '',
    type: r.Type || '',
    tech: r['Tecnología'] || '',
    squad: r.Squad || '',
    clientStatus: r['Client Status'] || '',
    repo: r.Repositorio || '',
    staging: r.Staging || '',
    production: r.Production || '',
    start: r['date:Time:start'] || null,
    end: r['date:Time:end'] || null,
    created: r['Fecha de creación'] || r.createdTime || null,
  };
}

async function viewRows(ctx, viewUrl) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const j = await query(ctx, { mode: 'view', view_url: viewUrl, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...(j.results || []));
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return out;
}

async function pipeline(ctx) {
  const [all, mine] = await Promise.all([viewRows(ctx, PIPELINE_VIEW_ALL), viewRows(ctx, PIPELINE_VIEW_MINE).catch(() => [])]);
  const mineIds = new Set(mine.map((r) => r.url));
  return { order: PIPE_ORDER, rows: all.map((r) => ({ ...pipeRow(r), mine: mineIds.has(r.url) })) };
}

async function me(ctx) {
  const t = await tool(ctx, 'get-self', {});
  const j = parseJson(t);
  if (j?.user?.id) save(ctx.read, ctx.write, { notionUserId: j.user.id });
  return j?.user || null;
}

/** Todo junto, con caché de 5 minutos. */
async function overview(ctx, force) {
  const c = ctx.read('notion-cache.json', null);
  if (!force && c && Date.now() - c.at < 5 * 60000) return c.data;
  const [user, tk, pipe] = await Promise.all([cfg(ctx.read).notionUserId ? Promise.resolve(null) : me(ctx).catch(() => null), tickets(ctx), pipeline(ctx).catch((e) => ({ error: e.message, rows: [], order: PIPE_ORDER }))]);
  const data = { at: Date.now(), user, tickets: tk, pipeline: pipe };
  ctx.write('notion-cache.json', { at: Date.now(), data });
  return data;
}

function logout({ read, write }) {
  access = null;
  session = null;
  toolNames = null;
  save(read, write, { notionEnc: null });
  write('notion-cache.json', null);
}

module.exports = { login, logout, linked, overview, ticketChat, parseComments, analyze };

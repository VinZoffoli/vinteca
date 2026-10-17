// ViperTech → Email: correos de tu buzón de Hostinger (contacto@vipertechcr.com)
// por IMAP, en modo solo lectura (EXAMINE + BODY.PEEK: no marca nada como leído
// ni cambia el buzón). La contraseña la escribes tú y se guarda cifrada con tu
// usuario de Windows; nunca sale de tu PC salvo hacia el servidor de correo.
const tls = require('tls');
const { safeStorage } = require('electron');

const DEFAULT = { host: 'imap.hostinger.com', port: 993, user: 'contacto@vipertechcr.com' };

// ---- cuenta guardada ----
function account(read) {
  const s = read('settings.json', {});
  return { ...DEFAULT, ...(s.mail || {}), hasPassword: !!s.mailPassEnc };
}
function setAccount({ read, write }, a) {
  const s = read('settings.json', {});
  const user = String(a.user || DEFAULT.user).trim().slice(0, 120);
  const host = String(a.host || DEFAULT.host).trim().toLowerCase();
  if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(user)) throw new Error('Ese correo no parece válido.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new Error('Ese servidor no parece válido.');
  s.mail = { user, host, port: Math.max(1, Math.min(65535, Number(a.port) || 993)) };
  if (a.password) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
    s.mailPassEnc = safeStorage.encryptString(String(a.password)).toString('base64');
  }
  if (a.forget) {
    delete s.mail;
    delete s.mailPassEnc;
  }
  write('settings.json', s);
  return account(read);
}
function password(read) {
  const s = read('settings.json', {});
  if (!s.mailPassEnc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.mailPassEnc, 'base64'));
  } catch {
    return null;
  }
}

// ---- cliente IMAP mínimo ----
class Imap {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.buf = Buffer.alloc(0);
    this.n = 0;
    this.waiting = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = tls.connect({ host: this.host, port: this.port, servername: this.host, timeout: 20000 }, () => {});
      this.sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        this.pump();
      });
      this.sock.on('error', (e) => (this.waiting ? this.waiting.reject(e) : reject(e)));
      this.sock.on('timeout', () => {
        const e = new Error('El servidor de correo no respondió.');
        this.sock.destroy();
        this.waiting ? this.waiting.reject(e) : reject(e);
      });
      // saludo inicial "* OK"
      this.waiting = { tag: '*', lines: [], resolve, reject };
    });
  }
  // separa líneas respetando los literales {n}
  pump() {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i < 0) return;
      let line = this.buf.slice(0, i).toString('utf8');
      let end = i + 2;
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        const len = Number(lit[1]);
        if (this.buf.length < end + len) return; // falta el literal
        const data = this.buf.slice(end, end + len).toString('utf8');
        end += len;
        // el resto de la línea después del literal
        const j = this.buf.indexOf('\r\n', end);
        if (j < 0) return;
        const rest = this.buf.slice(end, j).toString('utf8');
        this.buf = this.buf.slice(j + 2);
        this.onLine({ text: line + rest, literal: data });
        continue;
      }
      this.buf = this.buf.slice(end);
      this.onLine({ text: line });
    }
  }
  onLine(l) {
    const w = this.waiting;
    if (!w) return;
    if (w.tag === '*' && /^\* (OK|PREAUTH)/.test(l.text)) {
      this.waiting = null;
      return w.resolve([l]);
    }
    if (w.tag !== '*' && l.text.startsWith(w.tag + ' ')) {
      this.waiting = null;
      if (/^\S+ OK/.test(l.text)) w.resolve(w.lines);
      else {
        const e = new Error(l.text.replace(/^\S+ (NO|BAD) /, ''));
        e.imap = true;
        w.reject(e);
      }
      return;
    }
    w.lines.push(l);
  }
  cmd(text) {
    const tag = `V${++this.n}`;
    return new Promise((resolve, reject) => {
      this.waiting = { tag, lines: [], resolve, reject };
      this.sock.write(`${tag} ${text}\r\n`);
    });
  }
  close() {
    try {
      this.sock.write(`V${++this.n} LOGOUT\r\n`);
      this.sock.end();
    } catch {}
  }
}

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// =?UTF-8?B?...?= y =?ISO-8859-1?Q?...?=
function decodeWords(s) {
  return String(s || '')
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, txt) => {
      try {
        const buf = /b/i.test(enc) ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
        return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : /8859-1|latin1|windows-1252/i.test(cs) ? 'windows-1252' : cs).decode(buf);
      } catch {
        return txt;
      }
    });
}
function headers(raw) {
  const out = {};
  for (const l of String(raw).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = l.indexOf(':');
    if (i > 0) out[l.slice(0, i).trim().toLowerCase()] = decodeWords(l.slice(i + 1).trim());
  }
  return out;
}
function parseFrom(f) {
  const m = String(f || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || m[2], email: m[2].trim() } : { name: String(f || '').trim(), email: String(f || '').trim() };
}

/** Últimos correos de la bandeja de entrada (sin marcarlos como leídos). */
async function inbox({ read, write }, { limit = 40 } = {}) {
  const a = account(read);
  const pass = password(read);
  if (!pass) throw new Error('Escribe la contraseña del correo para conectarlo.');
  const c = new Imap(a.host, a.port);
  await c.connect();
  try {
    try {
      await c.cmd(`LOGIN ${q(a.user)} ${q(pass)}`);
    } catch (e) {
      throw new Error(e.imap ? 'El servidor rechazó el correo o la contraseña.' : e.message);
    }
    const ex = await c.cmd('EXAMINE INBOX');
    const total = Number((ex.map((l) => l.text).join('\n').match(/\* (\d+) EXISTS/) || [])[1] || 0);
    const unseenLines = await c.cmd('UID SEARCH UNSEEN');
    const unseen = new Set(((unseenLines.find((l) => /^\* SEARCH/.test(l.text))?.text || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean)).map(Number));
    const list = [];
    if (total) {
      const from = Math.max(1, total - limit + 1);
      const lines = await c.cmd(`FETCH ${from}:${total} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
      for (const l of lines) {
        if (!/^\* \d+ FETCH/.test(l.text)) continue;
        const uid = Number((l.text.match(/UID (\d+)/) || [])[1]);
        const flags = (l.text.match(/FLAGS \(([^)]*)\)/) || [])[1] || '';
        const idate = (l.text.match(/INTERNALDATE "([^"]+)"/) || [])[1];
        const hd = headers(l.literal || '');
        const fromP = parseFrom(hd.from);
        list.push({ uid, from: fromP.name, email: fromP.email, subject: hd.subject || '(sin asunto)', date: Date.parse(idate || hd.date || '') || null, unread: !/\\Seen/.test(flags), answered: /\\Answered/.test(flags), flagged: /\\Flagged/.test(flags) });
      }
    }
    list.sort((x, y) => (y.date || 0) - (x.date || 0));
    const prev = read('mail-cache.json', null);
    const known = new Set(prev?.known || []);
    const fresh = prev ? list.filter((m) => m.unread && !known.has(m.uid)) : [];
    const out = { at: Date.now(), user: a.user, total, unread: unseen.size, list, known: [...new Set([...(prev?.known || []), ...list.map((m) => m.uid)])].slice(-3000) };
    write('mail-cache.json', out);
    return { ...out, fresh };
  } finally {
    c.close();
  }
}

module.exports = { inbox, account, setAccount, decodeWords, headers, Imap };

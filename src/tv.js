'use strict';
// 1.31: televisores con Google TV / Android TV (como los TCL de la casa).
//  - Vincular: el televisor muestra un código de 6 caracteres y lo escribes en la app
//    (protocolo «Android TV Remote v2», el mismo del control remoto del celular).
//  - Control: encender, apagar, volumen, silencio, pausa, inicio y abrir apps.
//  - Qué se ve: la app abierta (Netflix, YouTube…) por el control remoto y, si algo
//    se está transmitiendo (Chromecast), el título.
// Todo dentro de la red de casa; la llave de la app se guarda cifrada en este PC.
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const dgram = require('dgram');
const { EventEmitter } = require('events');

// ============================================================ PROTOBUF MÍNIMO
function varint(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}
/** Codifica [[campo, tipo, valor], …]; tipos: v (número), s (texto), b (bytes), m (mensaje: otra lista). */
function enc(fields) {
  const parts = [];
  for (const [f, t, val] of fields) {
    if (val == null) continue;
    for (const v of Array.isArray(val) && t !== 'm' ? val : t === 'm' && Array.isArray(val) && Array.isArray(val[0]) && !Array.isArray(val[0][0]) ? [val] : Array.isArray(val) && t === 'm' ? val : [val]) {
      if (t === 'v') parts.push(varint((f << 3) | 0), varint(typeof v === 'boolean' ? Number(v) : v));
      else {
        const body = t === 'm' ? enc(v) : t === 'b' ? Buffer.from(v) : Buffer.from(String(v), 'utf8');
        parts.push(varint((f << 3) | 2), varint(body.length), body);
      }
    }
  }
  return Buffer.concat(parts);
}
function readVarint(buf, i) {
  let v = 0n;
  let shift = 0n;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    v |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return [Number(v), i];
}
/** Decodifica a { campo: [valor, …] } (números o Buffers). */
function dec(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const k = readVarint(buf, i);
    if (!k) break;
    i = k[1];
    const f = k[0] >> 3;
    const w = k[0] & 7;
    let v;
    if (w === 0) {
      const r = readVarint(buf, i);
      if (!r) break;
      [v, i] = r;
    } else if (w === 2) {
      const r = readVarint(buf, i);
      if (!r) break;
      i = r[1];
      v = buf.subarray(i, i + r[0]);
      i += r[0];
    } else if (w === 5) {
      v = buf.readUInt32LE(i);
      i += 4;
    } else if (w === 1) {
      v = buf.readBigUInt64LE(i);
      i += 8;
    } else break;
    (out[f] ||= []).push(v);
  }
  return out;
}
const sub = (m, f) => (m[f]?.[0] instanceof Buffer ? dec(m[f][0]) : null);
const str = (m, f) => (m[f]?.[0] instanceof Buffer ? m[f][0].toString('utf8') : null);
const num = (m, f) => (typeof m[f]?.[0] === 'number' ? m[f][0] : null);

// mensajes con el largo delante (varint), como usa Android TV
function framer(onMsg) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const r = readVarint(buf, 0);
      if (!r || buf.length < r[1] + r[0]) break;
      const msg = buf.subarray(r[1], r[1] + r[0]);
      buf = buf.subarray(r[1] + r[0]);
      onMsg(dec(msg), msg);
    }
  };
}
const frame = (body) => Buffer.concat([varint(body.length), body]);

// ============================================================ CERTIFICADO DE LA APP
// El televisor exige un certificado de cliente: se crea uno propio (RSA 2048) la primera vez.
function derLen(n) {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  while (n) {
    b.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | b.length, ...b]);
}
const der = (tag, c) => Buffer.concat([Buffer.from([tag]), derLen(c.length), c]);
const seq = (...c) => der(0x30, Buffer.concat(c));
const set = (...c) => der(0x31, Buffer.concat(c));
const int = (b) => der(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
function oid(s) {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const b = [n & 0x7f];
    let v = n >> 7;
    while (v) {
      b.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.push(...b);
  }
  return der(0x06, Buffer.from(out));
}
const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
function makeCert(name = 'ViperTeca') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  const alg = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const nm = seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(name)))));
  const serial = crypto.randomBytes(8);
  serial[0] &= 0x7f;
  const now = Date.now();
  const tbs = seq(der(0xa0, int(Buffer.from([2]))), int(serial), alg, nm, seq(utc(new Date(now - 86400000)), utc(new Date(now + 20 * 365 * 86400000))), nm, publicKey.export({ type: 'spki', format: 'der' }));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const pem = '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// ============================================================ VINCULAR
/**
 * Empieza la vinculación: el televisor muestra un código. Devuelve { finish(code) }.
 * creds: { cert, key } de la app.
 */
function pair(host, creds) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: 6467, cert: creds.cert, key: creds.key, rejectUnauthorized: false, timeout: 15000 });
    let step = 0;
    let done = null;
    const send = (fields) => sock.write(frame(enc([[1, 'v', 2], [2, 'v', 200], ...fields])));
    sock.on('timeout', () => {
      sock.destroy();
      reject(new Error('El televisor no respondió. ¿Está encendido y en la misma wifi?'));
    });
    sock.on('error', (e) => (done ? done.reject(e) : reject(e)));
    sock.on(
      'data',
      framer((m) => {
        if (num(m, 2) && num(m, 2) !== 200) {
          const err = new Error(num(m, 2) === 402 ? 'El código no es correcto. Vuelve a intentarlo.' : 'El televisor rechazó la vinculación (' + num(m, 2) + ').');
          sock.destroy();
          return done ? done.reject(err) : reject(err);
        }
        if (step === 0 && m[11]) {
          step = 1;
          send([[20, 'm', [[1, 'm', [[1, 'v', 3], [2, 'v', 6]]], [3, 'v', 1]]]]); // opciones: código hexadecimal de 6
        } else if (step === 1 && m[20]) {
          step = 2;
          send([[30, 'm', [[1, 'm', [[1, 'v', 3], [2, 'v', 6]]], [2, 'v', 1]]]]); // configuración
        } else if (step === 2 && m[31]) {
          step = 3;
          sock.setTimeout(0);
          // ya se ve el código en la pantalla
          resolve({
            finish: (code) =>
              new Promise((res, rej) => {
                const c = String(code || '').trim().toUpperCase();
                if (!/^[0-9A-F]{6}$/.test(c)) return rej(new Error('El código son 6 letras o números (0-9, A-F).'));
                const mine = crypto.createPublicKey(creds.key).export({ format: 'jwk' });
                const peer = sock.getPeerCertificate();
                const hexb = (h) => Buffer.from(h.length % 2 ? '0' + h : h, 'hex');
                const h = crypto.createHash('sha256');
                h.update(Buffer.from(mine.n, 'base64url'));
                h.update(Buffer.from(mine.e, 'base64url'));
                h.update(hexb(String(peer.modulus)));
                h.update(hexb(String(peer.exponent).replace(/^0x/, '')));
                h.update(Buffer.from(c.slice(2), 'hex'));
                const secret = h.digest();
                if (secret[0] !== parseInt(c.slice(0, 2), 16)) return rej(new Error('El código no es correcto. Revisa el que sale en la tele.'));
                done = { resolve: res, reject: rej };
                send([[40, 'm', [[1, 'b', secret]]]]);
              }),
            cancel: () => sock.destroy(),
          });
        } else if (step === 3 && m[41]) {
          sock.end();
          done?.resolve(true);
        }
      })
    );
    sock.on('secureConnect', () => send([[10, 'm', [[1, 's', 'atvremote'], [2, 's', 'ViperTeca']]]]));
  });
}

// ============================================================ CONTROL REMOTO
const KEY = { power: 26, wakeup: 224, sleep: 223, volup: 24, voldown: 25, mute: 164, playpause: 85, home: 3, back: 4, up: 19, down: 20, left: 21, right: 22, ok: 23, next: 87, prev: 88 };
class Remote extends EventEmitter {
  constructor(host, creds) {
    super();
    Object.assign(this, { host, creds, sock: null, state: { connected: false, on: null, app: null, volume: null }, retry: 2000, closed: false });
  }
  connect() {
    if (this.sock || this.closed) return;
    const s = tls.connect({ host: this.host, port: 6466, cert: this.creds.cert, key: this.creds.key, rejectUnauthorized: false });
    this.sock = s;
    const send = (fields) => s.writable && s.write(frame(enc(fields)));
    this.send = send;
    s.setKeepAlive(true, 10000);
    s.on('secureConnect', () => {
      this.retry = 2000;
      this.set({ connected: true });
    });
    s.on(
      'data',
      framer((m) => {
        if (m[1]) send([[1, 'm', [[1, 'v', 622], [2, 'm', [[1, 's', 'ViperTeca'], [2, 's', 'ViperTeca'], [3, 'v', 1], [4, 's', '1'], [5, 's', 'atvremote'], [6, 's', '1.0.0']]]]]]);
        if (m[2]) send([[2, 'm', [[1, 'v', 622]]]]);
        if (m[8]) send([[9, 'm', [[1, 'v', num(sub(m, 8) || {}, 1) || 0]]]]);
        if (m[20]) {
          const app = sub(sub(m, 20) || {}, 1);
          const pkg = app && str(app, 12);
          if (pkg) this.set({ app: pkg });
        }
        if (m[40]) this.set({ on: !!num(sub(m, 40) || {}, 1) });
        if (m[50]) {
          const v = sub(m, 50) || {};
          this.set({ volume: { level: num(v, 7) || 0, max: num(v, 6) || 100, muted: !!num(v, 8) } });
        }
        if (m[3]) this.emit('error', new Error('El televisor devolvió un error.'));
      })
    );
    const bye = (err) => {
      if (this.sock !== s) return;
      this.sock = null;
      this.set({ connected: false });
      if (err && /certificate|handshake|alert/i.test(String(err.message))) this.set({ unpaired: true });
      if (!this.closed) setTimeout(() => this.connect(), (this.retry = Math.min(60000, this.retry * 2)));
    };
    s.on('error', bye);
    s.on('close', () => bye());
  }
  set(p) {
    Object.assign(this.state, p);
    this.emit('state', { ...this.state });
  }
  key(name) {
    const code = typeof name === 'number' ? name : KEY[name];
    if (!code) throw new Error('Tecla desconocida');
    if (!this.sock || !this.state.connected) throw new Error('El televisor no está conectado.');
    this.send([[10, 'm', [[1, 'v', code], [2, 'v', 3]]]]);
  }
  /** Abre una app por su enlace (https://www.netflix.com/title, https://www.youtube.com…). */
  open(link) {
    if (!this.sock || !this.state.connected) throw new Error('El televisor no está conectado.');
    this.send([[90, 'm', [[1, 's', link]]]]);
  }
  close() {
    this.closed = true;
    this.sock?.destroy();
  }
}

// ============================================================ CHROMECAST: QUÉ SE TRANSMITE
// Mensajes Cast: 4 bytes de largo + CastMessage (protobuf) con el contenido en JSON.
function castStatus(host) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 8009, rejectUnauthorized: false, timeout: 6000 });
    let buf = Buffer.alloc(0);
    const out = { apps: [], volume: null, media: null };
    let reqId = 1;
    const send = (dest, ns, payload) => {
      const body = enc([[1, 'v', 0], [2, 's', 'sender-vt'], [3, 's', dest], [4, 's', ns], [5, 'v', 0], [6, 's', JSON.stringify(payload)]]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      s.write(Buffer.concat([len, body]));
    };
    const finish = () => {
      s.destroy();
      resolve(out);
    };
    const timer = setTimeout(finish, 6000);
    s.on('secureConnect', () => {
      send('receiver-0', 'urn:x-cast:com.google.cast.tp.connection', { type: 'CONNECT' });
      send('receiver-0', 'urn:x-cast:com.google.cast.receiver', { type: 'GET_STATUS', requestId: reqId++ });
    });
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const m = dec(buf.subarray(4, 4 + buf.readUInt32BE(0)));
        buf = buf.subarray(4 + buf.readUInt32BE(0));
        let p;
        try {
          p = JSON.parse(str(m, 6) || '{}');
        } catch {
          continue;
        }
        if (p.type === 'PING') send(str(m, 2) || 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', { type: 'PONG' });
        if (p.type === 'RECEIVER_STATUS') {
          out.volume = p.status?.volume ? { level: Math.round((p.status.volume.level || 0) * 100), muted: !!p.status.volume.muted } : null;
          out.apps = (p.status?.applications || []).map((a) => ({ name: a.displayName, status: a.statusText, idle: !!a.isIdleScreen, transportId: a.transportId }));
          const app = out.apps.find((a) => !a.idle && a.transportId);
          if (!app) {
            clearTimeout(timer);
            return finish();
          }
          send(app.transportId, 'urn:x-cast:com.google.cast.tp.connection', { type: 'CONNECT' });
          send(app.transportId, 'urn:x-cast:com.google.cast.media', { type: 'GET_STATUS', requestId: reqId++ });
        }
        if (p.type === 'MEDIA_STATUS') {
          const st = p.status?.[0];
          if (st) out.media = { title: st.media?.metadata?.title || null, subtitle: st.media?.metadata?.subtitle || st.media?.metadata?.seriesTitle || null, image: st.media?.metadata?.images?.[0]?.url || null, state: st.playerState, at: st.currentTime || null, duration: st.media?.duration || null };
          clearTimeout(timer);
          finish();
        }
      }
    });
    s.on('error', () => {
      clearTimeout(timer);
      resolve(out);
    });
    s.on('timeout', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

// ============================================================ BUSCAR TELEVISORES
/** Televisores con Google TV / Android TV en la red (mDNS + datos de Chromecast). */
function discover(lanIp, ms = 3500) {
  return new Promise((resolve) => {
    const found = new Map();
    const names = ['_androidtvremote2._tcp.local', '_googlecast._tcp.local'];
    const q = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, names.length, 0, 0, 0, 0, 0, 0]), ...names.map((n) => Buffer.concat([...n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0, 0, 12, 0, 1])]))]);
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (msg, r) => {
      if (r.address === lanIp) return;
      const t = msg.toString('latin1');
      if (!/_androidtvremote2|_googlecast/.test(t)) return;
      const cur = found.get(r.address) || { host: r.address, atv: false, cast: false, name: null, model: null };
      if (t.includes('_androidtvremote2')) cur.atv = true;
      if (t.includes('_googlecast')) cur.cast = true;
      cur.name = (t.match(/fn=([^\x00-\x1f]{1,60})/) || [])[1] || cur.name;
      cur.model = (t.match(/md=([^\x00-\x1f]{1,60})/) || [])[1] || cur.model;
      found.set(r.address, cur);
    });
    s.on('error', () => resolve([...found.values()]));
    s.bind(5353, () => {
      try {
        if (lanIp) {
          s.addMembership('224.0.0.251', lanIp);
          s.setMulticastInterface(lanIp);
        } else s.addMembership('224.0.0.251');
      } catch {}
      for (let i = 0; i < 3; i++) setTimeout(() => s.send(q, 5353, '224.0.0.251'), i * 600);
    });
    setTimeout(async () => {
      s.close();
      // nombre real desde el propio Chromecast
      for (const tv of found.values()) {
        try {
          const j = await fetch('http://' + tv.host + ':8008/setup/eureka_info?params=name,device_info', { signal: AbortSignal.timeout(2500) }).then((r) => r.json());
          tv.name = j.name || tv.name;
          tv.model = j.device_info?.model_name || tv.model;
          tv.maker = j.device_info?.manufacturer || null;
          tv.mac = j.mac_address && j.mac_address !== '00:00:00:00:00:00' ? j.mac_address : null;
        } catch {}
      }
      resolve([...found.values()]);
    }, ms);
  });
}

/** ¿Responde el televisor? (para saber si está encendido o en reposo profundo) */
function reachable(host, port = 6466) {
  return new Promise((res) => {
    const s = net.connect({ host, port, timeout: 2000 }, () => {
      s.destroy();
      res(true);
    });
    s.on('error', () => res(false));
    s.on('timeout', () => {
      s.destroy();
      res(false);
    });
  });
}
/** Encender por la red (Wake-on-LAN), si la tele lo permite y se sabe su MAC. */
function wake(mac, broadcast = '255.255.255.255') {
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return false;
  const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(Buffer.from(hex, 'hex'))]);
  const s = dgram.createSocket('udp4');
  s.bind(() => {
    s.setBroadcast(true);
    s.send(pkt, 9, broadcast, () => s.close());
  });
  return true;
}

// nombres legibles de las apps más comunes
const APPS = {
  'com.netflix.ninja': 'Netflix', 'com.google.android.youtube.tv': 'YouTube', 'com.google.android.youtube.tvkids': 'YouTube Kids', 'com.disney.disneyplus': 'Disney+', 'com.hbo.hbonow': 'Max', 'com.wbd.stream': 'Max',
  'com.amazon.amazonvideo.livingroom': 'Prime Video', 'com.crunchyroll.crunchyroid': 'Crunchyroll', 'com.spotify.tv.android': 'Spotify', 'com.google.android.apps.tv.launcherx': 'Inicio', 'com.google.android.tvlauncher': 'Inicio',
  'com.tcl.tvinput': 'Entrada (HDMI / TV)', 'com.tcl.tv': 'TV', 'com.google.android.videos': 'Google TV', 'com.plexapp.android': 'Plex', 'com.apple.atve.androidtv.appletv': 'Apple TV', 'com.paramount.android.pplus': 'Paramount+', 'tv.twitch.android.app': 'Twitch',
};
const appName = (pkg) => (pkg ? APPS[pkg] || pkg.split('.').filter((x) => !/^(com|tv|android|app|google|apps)$/.test(x)).pop()?.replace(/^./, (c) => c.toUpperCase()) || pkg : null);

module.exports = { makeCert, pair, Remote, castStatus, discover, reachable, wake, appName, KEY, enc, dec };

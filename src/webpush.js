// Notificaciones en el iPhone (Web Push estándar, sin servicios de terceros):
// la app del celular se suscribe y el PC le manda los avisos cifrados por el
// servicio de push de Apple. Claves VAPID propias, la privada cifrada con DPAPI.
// Cifrado del mensaje según RFC 8291 (aes128gcm) y firma según RFC 8292 (VAPID).
const crypto = require('crypto');
const { safeStorage } = require('electron');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const SUBJECT = 'https://github.com/VinZoffoli/vinteca';

/** Claves VAPID (se crean una vez). Devuelve la pública en base64url (65 bytes). */
function keys({ read, write }) {
  const s = read('settings.json', {});
  if (s.vapidPub && s.vapidEnc) {
    try {
      const pem = safeStorage.decryptString(Buffer.from(s.vapidEnc, 'base64'));
      return { pub: s.vapidPub, priv: crypto.createPrivateKey(pem) };
    } catch {}
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows no está disponible.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
  s.vapidPub = b64u(raw);
  s.vapidEnc = safeStorage.encryptString(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  write('settings.json', s);
  return { pub: s.vapidPub, priv: privateKey };
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** Cifra el mensaje para una suscripción (RFC 8291). */
function encrypt(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])])).subarray(0, 32);
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Firma VAPID (JWT ES256) para el servicio de push de la suscripción. */
function vapidAuth(endpoint, k) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key: k.priv, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + claims + '.' + b64u(sig) + ', k=' + k.pub;
}

/** Envía un aviso a una suscripción. Devuelve 'ok', 'gone' (ya no existe) o 'error'. */
async function send(ctx, sub, msg) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return 'gone';
  const k = keys(ctx);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { TTL: '86400', Urgency: msg.urgent ? 'high' : 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(sub.endpoint, k) },
      body: encrypt(sub, JSON.stringify({ title: String(msg.title || 'ViperTeca').slice(0, 120), body: String(msg.body || '').slice(0, 400), tag: msg.tag || undefined })),
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'error:' + r.status;
  } catch {
    return 'error';
  }
}

module.exports = { keys, send, encrypt };

// Códigos de canje de Genshin vigentes (lista comunitaria de hoyo-codes.seria.moe,
// que revisa cada código contra HoYoverse). Se canjean en la página oficial:
// https://genshin.hoyoverse.com/es/gift?code=… con tu cuenta iniciada.
const URL = 'https://hoyo-codes.seria.moe/codes?game=genshin';
const REDEEM = (code) => `https://genshin.hoyoverse.com/es/gift?code=${encodeURIComponent(code)}`;

const REWARD_ES = { Primogem: 'Protogemas', Mora: 'Mora', "Hero's Wit": 'Ingenio del héroe', "Adventurer's Experience": 'Experiencia del aventurero', 'Mystic Enhancement Ore': 'Mineral de refinamiento místico', 'Fine Enhancement Ore': 'Mineral de refinamiento fino' };
const rewards = (s) =>
  String(s || '')
    .split(';')
    .filter(Boolean)
    .map((r) => {
      const [name, n] = r.split('*');
      return `${n ? `${Number(n).toLocaleString('es')} ` : ''}${REWARD_ES[name.trim()] || name.trim()}`;
    });

/** Códigos vigentes; marca como nuevos los que no habías visto. */
async function list({ read, write }, force) {
  const c = read('gcodes.json', null);
  if (!force && c && Date.now() - c.at < 3 * 3600000) return c;
  const r = await fetch(URL, { headers: { 'User-Agent': 'ViperTeca' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`La lista de códigos no respondió (HTTP ${r.status}).`);
  const j = await r.json();
  const seen = new Set(c?.seen || []);
  const used = c?.used || {};
  const codes = (j.codes || [])
    .filter((x) => x.status === 'OK' && x.code)
    .map((x) => ({ code: x.code, rewards: rewards(x.rewards), isNew: !!c && !seen.has(x.code), used: !!used[x.code], url: REDEEM(x.code) }));
  const out = { at: Date.now(), codes, seen: [...new Set([...seen, ...codes.map((x) => x.code)])].slice(-500), used, first: !c };
  write('gcodes.json', out);
  return out;
}

function markUsed({ read, write }, code, on) {
  const c = read('gcodes.json', null);
  if (!c) return null;
  c.used ||= {};
  if (on) c.used[code] = Date.now();
  else delete c.used[code];
  c.codes = c.codes.map((x) => (x.code === code ? { ...x, used: !!on, isNew: false } : x));
  write('gcodes.json', c);
  return c;
}

module.exports = { list, markUsed, REDEEM };

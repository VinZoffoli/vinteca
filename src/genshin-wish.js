// Historial de deseos de Genshin Impact.
// Cuando abres "Historial" en la pantalla de deseos, el juego guarda en su caché
// web (GenshinImpact_Data\webCaches\<versión>\Cache\Cache_Data\data_2) un enlace
// con una clave temporal (caduca a las 24 h). La app lo lee de tu PC, pide tu
// historial a la API de HoYoverse y lo guarda en tus datos. La clave no se guarda.
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog';
// Tipos de banner que se piden (el 400, segundo banner de personaje, llega con el 301)
const POOLS = [
  { key: 'character', name: 'Personaje de evento', types: ['301'] },
  { key: 'weapon', name: 'Arma de evento', types: ['302'] },
  { key: 'chronicled', name: 'Crónica', types: ['500'] },
  { key: 'standard', name: 'Permanente', types: ['200'] },
  { key: 'beginner', name: 'Principiante', types: ['100'] },
];
// 5★ del banner permanente: si salen en el de evento, se perdió el 50/50
const STANDARD_5 = ['Diluc', 'Jean', 'Keqing', 'Mona', 'Qiqi', 'Tighnari', 'Dehya'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Carpeta GenshinImpact_Data, a partir del registro del juego. */
function gameData() {
  const base = path.join(os.homedir(), 'AppData', 'LocalLow', 'miHoYo');
  for (const dir of ['Genshin Impact', '原神']) {
    for (const f of ['output_log.txt', 'Player.log']) {
      try {
        const txt = fs.readFileSync(path.join(base, dir, f), 'utf8');
        const m = txt.match(/([A-Z]:\/[^\r\n]*?\/(?:GenshinImpact_Data|YuanShen_Data))/);
        if (m && fs.existsSync(m[1])) return m[1];
      } catch {}
    }
  }
  return null;
}

/** El enlace más reciente del historial de deseos (o null). */
function latestLink() {
  const data = gameData();
  if (!data) return { error: 'No se encuentra Genshin en este PC (no hay registro del juego).' };
  const caches = path.join(data, 'webCaches');
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(caches, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const f = path.join(caches, d.name, 'Cache', 'Cache_Data', 'data_2');
        return fs.existsSync(f) ? { f, t: fs.statSync(f).mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.t - a.t);
  } catch {}
  for (const { f, t } of dirs) {
    const txt = fs.readFileSync(f, 'latin1');
    const all = [...txt.matchAll(/https:\/\/[^\s"\x00]*?(?:getGachaLog|gacha-v\d[^?\s"\x00]*index\.html)\?[^\x00\s"]*authkey=[^\x00\s"]*/g)];
    if (all.length) {
      const u = new URL(all[all.length - 1][0].replace(/#\/.*$/, ''));
      return { params: u.searchParams, seenAt: t };
    }
  }
  return { error: 'No hay ningún enlace del historial. Abre Genshin, ve a Deseos → Historial y vuelve a probar.' };
}

async function page(params, type, endId) {
  const q = new URL(API);
  for (const k of ['authkey_ver', 'sign_type', 'auth_appid', 'authkey', 'game_biz', 'region']) if (params.get(k)) q.searchParams.set(k, params.get(k));
  q.searchParams.set('lang', 'es');
  q.searchParams.set('gacha_type', type);
  q.searchParams.set('page', '1');
  q.searchParams.set('size', '20');
  q.searchParams.set('end_id', endId);
  for (let tries = 0; tries < 3; tries++) {
    const j = await (await fetch(q)).json();
    if (j.retcode === 0) return j.data?.list || [];
    if (j.retcode === -110) {
      await wait(1500); // demasiado rápido
      continue;
    }
    const e = new Error(j.retcode === -101 ? 'El enlace del historial caducó (dura 24 horas). Abre en Genshin Deseos → Historial y vuelve a importar.' : `HoYoverse respondió: ${j.message}`);
    e.code = j.retcode;
    throw e;
  }
  throw new Error('HoYoverse está limitando las consultas; prueba en un minuto.');
}

/** Importa lo nuevo del historial y lo junta con lo que ya había. */
async function importHistory({ read, write, onProgress }) {
  const link = latestLink();
  if (link.error) throw new Error(link.error);
  const db = read('genshin-wishes.json', { uid: null, items: {} });
  let added = 0;
  for (const pool of POOLS) {
    for (const type of pool.types) {
      let endId = '0';
      for (let n = 0; n < 200; n++) {
        const list = await page(link.params, type, endId);
        if (!list.length) break;
        let known = false;
        for (const it of list) {
          if (db.uid && it.uid !== db.uid) throw new Error(`Ese historial es de otra cuenta (UID ${it.uid}).`);
          db.uid = it.uid;
          if (db.items[it.id]) known = true;
          else {
            db.items[it.id] = { id: it.id, type: it.gacha_type, name: it.name, kind: it.item_type, rank: Number(it.rank_type), time: it.time };
            added++;
          }
        }
        onProgress?.(`${pool.name}: ${Object.values(db.items).filter((i) => pool.types.includes(i.type) || (pool.key === 'character' && i.type === '400')).length} tiradas`);
        if (known) break; // lo de antes ya estaba guardado
        endId = list[list.length - 1].id;
        await wait(350);
      }
    }
  }
  db.importedAt = Date.now();
  write('genshin-wishes.json', db);
  return { added, ...summary(db) };
}

/** Pity y 5★ de cada banner. */
function summary(db) {
  const items = Object.values(db.items || {}).sort((a, b) => (a.id < b.id ? -1 : 1));
  const pools = POOLS.map((p) => {
    const list = items.filter((i) => p.types.includes(i.type) || (p.key === 'character' && i.type === '400'));
    let since5 = 0;
    let since4 = 0;
    let guaranteed = false;
    const fives = [];
    for (const it of list) {
      since5++;
      since4++;
      if (it.rank === 5) {
        const lost = p.key === 'character' && STANDARD_5.includes(it.name);
        fives.push({ name: it.name, kind: it.kind, pity: since5, time: it.time, lost: p.key === 'character' ? (lost ? true : guaranteed ? null : false) : null });
        guaranteed = p.key === 'character' && lost;
        since5 = 0;
        since4 = 0;
      } else if (it.rank === 4) since4 = 0;
    }
    return {
      key: p.key,
      name: p.name,
      total: list.length,
      pity5: since5,
      pity4: since4,
      hardPity: p.key === 'weapon' ? 80 : 90,
      guaranteed,
      fives: fives.reverse(),
      avg5: fives.length ? Math.round(fives.reduce((s, f) => s + f.pity, 0) / fives.length) : null,
    };
  }).filter((p) => p.total);
  return { uid: db.uid, importedAt: db.importedAt || null, total: items.length, pools };
}

/** Carpeta de capturas del juego (ScreenShot, junto a la carpeta de datos). */
function screenshotDir() {
  const data = gameData();
  const dir = data && path.join(path.dirname(data), 'ScreenShot');
  return dir && fs.existsSync(dir) ? dir : null;
}

module.exports = { importHistory, summary, latestLink, screenshotDir };

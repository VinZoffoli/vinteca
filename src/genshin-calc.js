// Inventario de Genshin desde la calculadora oficial de HoYoLAB.
// Se le pide lo que cuesta subir los personajes de tu plan y la respuesta dice,
// material por material, cuántos te faltan (lack_num): lo que tienes es num − lack_num.
// Solo lectura y con la misma sesión de HoYoLAB que ya conectaste en Notas.
const BASE = 'https://sg-public-api.hoyolab.com/event/e20200928calculate/';
const region = (uid) => ({ 6: 'os_usa', 7: 'os_euro', 8: 'os_asia', 9: 'os_cht' }[String(uid)[0]] || 'os_usa');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"'’]/g, '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(cookie, method, path, { query, body } = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v));
  const r = await fetch(u, {
    method,
    headers: { Cookie: cookie, Referer: 'https://act.hoyolab.com/', Origin: 'https://act.hoyolab.com', 'Content-Type': 'application/json', 'x-rpc-language': 'es-es', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`La calculadora de HoYoLAB no respondió (HTTP ${r.status}).`);
  if (j.retcode !== 0) {
    const e = new Error(j.retcode === -100 || j.retcode === 10001 ? 'La sesión de HoYoLAB caducó: vuelve a iniciarla en Genshin → Notas.' : j.retcode === -500004 ? 'HoYoLAB pide ir más despacio: prueba en un minuto.' : `HoYoLAB respondió: ${j.message} (${j.retcode})`);
    e.code = j.retcode;
    throw e;
  }
  return j.data;
}

/** Detalle de un personaje tuyo: los 3 talentos que se suben (id = group_id). */
async function detail(cookie, uid, avatarId) {
  const d = await call(cookie, 'GET', 'v1/sync/avatar/detail', { query: { avatar_id: avatarId, uid, region: region(uid), lang: 'es-es' } });
  const skills = (d.skill_list || []).filter((s) => s.max_level > 1);
  // fuera la carrera/esprint (max_level 1) y las pasivas
  return skills.slice(0, 3);
}

/**
 * Lee el inventario para los materiales del plan.
 * @param plan [{ id, level, target:{level,talents[3]}, talents[3] }]
 * @returns { items: { [nombre]: cantidad }, matched, total }
 */
async function inventory(cookie, uid, plan) {
  const items = [];
  const skipped = [];
  for (const p of plan) {
    const avatarId = Number(String(p.id).split('-')[0]);
    if (!avatarId) continue;
    try {
      let skills;
      try {
        skills = await detail(cookie, uid, avatarId);
      } catch (e) {
        if (e.code !== -502002) throw e;
        // la calculadora no estaba activada en tu cuenta: se activa una vez
        await call(cookie, 'POST', 'v1/avatar/auth', { body: { avatar_auth: 1, lang: 'es-es' } });
        skills = await detail(cookie, uid, avatarId);
      }
      items.push({
        avatar_id: avatarId,
        avatar_level_current: p.level || 1,
        avatar_level_target: Math.max(p.level || 1, p.target?.level || 90),
        element_attr_id: 0,
        from_user_sync: true,
        skill_list: skills.map((s, k) => ({ id: s.group_id || s.id, level_current: p.talents?.[k] || s.level_current || 1, level_target: Math.max(p.talents?.[k] || 1, p.target?.talents?.[k] || 10) })),
      });
      await sleep(400);
    } catch (e) {
      if (e.code === -502001) skipped.push(p.id);
      else throw e;
    }
  }
  if (!items.length) throw new Error('Ninguno de los personajes de tu plan está en tu cuenta (o no salen en la calculadora de HoYoLAB).');
  const d = await call(cookie, 'POST', 'v3/batch_compute', { body: { items, uid: String(uid), region: region(uid), lang: 'es-es' } });
  if (d.has_user_info === false) throw new Error('HoYoLAB no devolvió tu inventario. Abre la calculadora en HoYoLAB una vez y vuelve a intentarlo.');
  const out = {};
  for (const m of d.overall_consume || []) {
    const have = Math.max(0, (Number(m.num) || 0) - (Number(m.lack_num) || 0));
    out[m.name] = have;
  }
  return { items: out, total: Object.keys(out).length, skipped };
}

/** Une lo leído con los nombres de los materiales del plan (pueden variar acentos). */
function mergeInto(inv, read, planNames) {
  const byNorm = new Map(Object.entries(read).map(([k, v]) => [norm(k), v]));
  let matched = 0;
  for (const name of planNames) {
    const v = byNorm.get(norm(name));
    if (v == null) continue;
    inv[name] = v;
    matched++;
  }
  if (read.Mora != null) inv.Mora = read.Mora;
  return matched;
}

module.exports = { inventory, mergeInto };

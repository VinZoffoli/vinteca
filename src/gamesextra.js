'use strict';
// 1.28: más cosas de juegos.
//  - Game Pass (PC): el catálogo y lo que se va, cruzado con tu lista de deseados.
//  - Logros más fáciles: los que te faltan, ordenados por cuántos jugadores los tienen.
//  - Gasto: tu historial de compras de Steam y Epic (lees la página con tu sesión,
//    que inicias tú en una ventana de la app) y cuánto te costó cada hora jugada.
//  - Lanzamientos de tu lista de deseados con fecha y si tu PC los mueve.
const DAY = 86400000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’™®:–—-]/g, ' ').replace(/\b(edition|edicion|deluxe|standard|definitive|goty|game of the year|remastered|for windows|pc|xbox series x\|s)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// ============================================================ GAME PASS
const SIGL = { all: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff', leaving: '393f05bf-e596-4ef6-9487-6d4fa0eab987' };
async function sigl(id) {
  const j = await fetch('https://catalog.gamepass.com/sigls/v2?id=' + id + '&language=en-us&market=US', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  return j.filter((x) => x.id).map((x) => x.id);
}
async function titles(ids, cache) {
  const missing = ids.filter((id) => !cache[id]);
  for (let i = 0; i < missing.length; i += 20) {
    const part = missing.slice(i, i + 20);
    const j = await fetch('https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=' + part.join(',') + '&market=US&languages=en-us', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null);
    for (const p of j?.Products || []) {
      const lp = p.LocalizedProperties?.[0] || {};
      const img = (lp.Images || []).find((x) => x.ImagePurpose === 'Poster' || x.ImagePurpose === 'BoxArt') || (lp.Images || [])[0];
      cache[p.ProductId] = { title: lp.ProductTitle || p.ProductId, img: img?.Uri ? (img.Uri.startsWith('//') ? 'https:' + img.Uri : img.Uri) : null };
    }
  }
  return ids.map((id) => ({ id, ...(cache[id] || { title: id }) }));
}
/** Catálogo de PC Game Pass y lo que se va, con lo que coincide con tu lista de deseados. */
async function gamePass({ read, write }, wishlist) {
  const prev = read('gamepass.json', null);
  const cache = read('gamepass-titles.json', {});
  const [allIds, leavingIds] = await Promise.all([sigl(SIGL.all), sigl(SIGL.leaving).catch(() => [])]);
  const all = await titles(allIds, cache);
  const leaving = await titles(leavingIds.filter((id) => allIds.includes(id)), cache);
  write('gamepass-titles.json', cache);
  const newIds = prev?.ids ? allIds.filter((id) => !prev.ids.includes(id)) : [];
  const wish = (wishlist || []).map((w) => ({ ...w, n: norm(w.name) }));
  // mismo nombre (sin ediciones ni símbolos): «Final Fantasy» no es «Final Fantasy XVI»
  const match = (g) => wish.find((w) => w.n && norm(g.title) === w.n);
  const out = {
    at: Date.now(),
    ids: allIds,
    total: allIds.length,
    added: all.filter((g) => newIds.includes(g.id)),
    leaving,
    wishOnPass: all.map((g) => ({ ...g, wish: match(g) })).filter((g) => g.wish).map((g) => ({ id: g.id, title: g.title, img: g.img, appid: g.wish.appid, leaving: leavingIds.includes(g.id) })),
    since: prev?.at || null,
  };
  write('gamepass.json', out);
  return out;
}

// ============================================================ LOGROS FÁCILES
/**
 * summary: achievements.json (juegos con total/done); detail(appid) → { list: [{achieved, globalPct, …}] }
 * Toma los juegos más avanzados y junta los logros que faltan, de más común a más raro.
 */
async function easiest(summary, detail, titleOf, { games = 20, max = 40 } = {}) {
  const list = Object.entries(summary?.games || {})
    .filter(([, g]) => g.total && g.done > 0 && g.done < g.total)
    .sort((a, b) => b[1].done / b[1].total - a[1].done / a[1].total)
    .slice(0, games);
  const out = [];
  for (const [appid, g] of list) {
    const d = await detail(Number(appid)).catch(() => null);
    for (const a of d?.list || []) if (!a.achieved && a.globalPct != null) out.push({ appid: Number(appid), game: titleOf(Number(appid)), pct: Math.round(a.globalPct * 10) / 10, name: a.name, description: a.hidden && !a.description ? 'Logro oculto' : a.description, icon: a.iconGray || a.icon, tip: a.tip || null, gameProgress: Math.round((g.done / g.total) * 100), left: g.total - g.done });
  }
  return out.sort((a, b) => b.pct - a.pct).slice(0, max);
}

// ============================================================ GASTO
const STEAM_HISTORY = 'https://store.steampowered.com/account/history/';
const EPIC_HISTORY = 'https://www.epicgames.com/account/transactions';
/** Lee las filas del historial ya abierto en la ventana (con tu sesión). */
const READ_STEAM = `(async () => {
  for (let i = 0; i < 40; i++) {
    const b = document.querySelector('#load_more_button');
    if (!b || b.offsetParent === null) break;
    b.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!document.querySelector('.wallet_history_table')) return { login: !!document.querySelector('#login_btn_signin, .login_btn, form[name="logon"], [class*="login"]') , rows: [] };
  return { rows: [...document.querySelectorAll('.wallet_history_table tr.wallet_table_row')].map((r) => ({
    date: (r.querySelector('.wht_date') || {}).textContent?.trim() || '',
    items: [...r.querySelectorAll('.wht_items > div')].map((d) => d.textContent.trim()).filter(Boolean),
    type: (r.querySelector('.wht_type') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    total: (r.querySelector('.wht_total') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
  })) };
})()`;
const READ_EPIC = `(async () => {
  for (let i = 0; i < 20; i++) {
    const b = [...document.querySelectorAll('button')].find((x) => /show more|mostrar m[aá]s|ver m[aá]s|load more/i.test(x.textContent));
    if (!b) break;
    b.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  const rows = [...document.querySelectorAll('table tbody tr, [role="row"]')].map((r) => [...r.querySelectorAll('td, [role="cell"]')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()));
  return { login: /login|signin|sign in|iniciar/i.test(location.href), rows: rows.filter((c) => c.length >= 3).map((c) => ({ date: c[0], items: [c[1]], type: 'Compra', total: c.find((x) => /[\\d.,]+\\s*$|[$₡€]/.test(x) && /\\d/.test(x) && c.indexOf(x) > 1) || c[c.length - 1] })) };
})()`;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, dic: 12 };
function parseDate(s) {
  const t = String(s || '').toLowerCase().replace(/\./g, '');
  let m = t.match(/(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?,?\s+(?:de\s+)?(\d{4})/);
  if (m && MONTHS[m[2]]) return new Date(Number(m[3]), MONTHS[m[2]] - 1, Number(m[1])).getTime();
  m = t.match(/([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1]]) return new Date(Number(m[3]), MONTHS[m[1]] - 1, Number(m[2])).getTime();
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}
function money(s) {
  const t = String(s || '');
  const cur = /₡|crc/i.test(t) ? 'CRC' : /€|eur/i.test(t) ? 'EUR' : /\$|usd/i.test(t) ? 'USD' : null;
  let n = t.replace(/[^\d.,-]/g, '');
  const dec = Math.max(n.lastIndexOf('.'), n.lastIndexOf(','));
  if (dec >= 0 && n.length - dec - 1 === 2) n = n.slice(0, dec).replace(/[.,]/g, '') + '.' + n.slice(dec + 1);
  else n = n.replace(/[.,]/g, '');
  const v = Math.abs(Number(n));
  return Number.isFinite(v) && v > 0 ? { v, cur } : null;
}
/** Compras (no reembolsos, regalos recibidos ni saldo de mercado). */
function purchases(store, rows) {
  return rows
    .filter((r) => !/refund|reembolso|market|mercado|wallet credit|cr[eé]dito|gift received|regalo recibido/i.test(r.type + ' ' + r.total))
    .map((r) => ({ store, at: parseDate(r.date), items: r.items, amount: money(r.total) }))
    .filter((r) => r.at && r.amount && r.items.length);
}
/**
 * Resumen del gasto: por año y cuánto costó cada hora (si el nombre de la compra
 * coincide con un juego de tu biblioteca con horas).
 */
function spendSummary(list, library, rate) {
  const toCrc = (a) => (a.cur === 'USD' ? (rate ? a.v * rate : null) : a.cur === 'CRC' || !a.cur ? a.v : null);
  const years = {};
  for (const p of list) {
    const y = new Date(p.at).getFullYear();
    const c = toCrc(p.amount);
    if (c == null) continue;
    years[y] = (years[y] || 0) + c;
  }
  const lib = (library || []).filter((g) => g.playtimeMin > 0).map((g) => ({ ...g, n: norm(g.title) }));
  const perGame = [];
  for (const p of list) {
    if (p.items.length !== 1) continue;
    const n = norm(p.items[0]);
    const g = lib.find((x) => x.n === n) || lib.find((x) => n.length > 5 && (x.n.startsWith(n) || n.startsWith(x.n)));
    const c = toCrc(p.amount);
    if (!g || c == null) continue;
    const hours = g.playtimeMin / 60;
    perGame.push({ title: g.title, id: g.id, paid: Math.round(c), hours: Math.round(hours * 10) / 10, perHour: hours >= 0.5 ? Math.round(c / hours) : null, at: p.at, store: p.store });
  }
  perGame.sort((a, b) => (a.perHour ?? 1e12) - (b.perHour ?? 1e12));
  return { years, total: Object.values(years).reduce((a, b) => a + b, 0), count: list.length, perGame, best: perGame.filter((x) => x.perHour != null).slice(0, 5), worst: perGame.filter((x) => x.perHour != null).slice(-5).reverse() };
}

// ============================================================ LANZAMIENTOS
/** Fecha de salida de los deseados que aún no salieron (appdetails de Steam, caché de 2 días). */
async function upcoming({ read, write }, wishlist) {
  const cache = read('wish-release.json', {});
  const out = [];
  let asked = 0;
  for (const w of wishlist || []) {
    let c = cache[w.appid];
    if (!c || Date.now() - c.at > 2 * DAY) {
      if (asked >= 40) continue;
      asked++;
      try {
        const j = await fetch('https://store.steampowered.com/api/appdetails?appids=' + w.appid + '&filters=release_date&l=spanish', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }).then((r) => r.json());
        const rd = j?.[w.appid]?.data?.release_date;
        c = { at: Date.now(), soon: !!rd?.coming_soon, text: rd?.date || '', date: rd?.coming_soon ? parseDate(rd.date) : null };
      } catch {
        c = { at: Date.now() - DAY, soon: false };
      }
      cache[w.appid] = c;
    }
    if (c.soon) out.push({ appid: w.appid, name: w.name, cover: w.cover, text: c.text, date: c.date });
  }
  write('wish-release.json', cache);
  return out.sort((a, b) => (a.date || 9e15) - (b.date || 9e15));
}

module.exports = { gamePass, easiest, purchases, spendSummary, upcoming, READ_STEAM, READ_EPIC, STEAM_HISTORY, EPIC_HISTORY, norm, parseDate, money };

// Historial de precios de la lista de deseados: los precios que ve la app cada 6 h
// (en tu moneda) y el mínimo histórico de Steam según CheapShark (gratis, sin clave).
const UA = 'ViperTeca/1.21 (app de escritorio personal)';
const num = (s) => {
  const t = String(s || '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  // "₡6.500,00" → 6500 · "$14.99" → 14.99
  const n = /,\d{2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(/,/g, '');
  return Number(n) || null;
};

/** Guarda el precio de hoy de cada juego (un punto por día). */
function record({ read, write }, items) {
  const h = read('price-history.json', {});
  const day = new Date().toLocaleDateString('sv');
  for (const i of items || []) {
    const v = num(i.price?.final);
    if (v == null) continue;
    const list = (h[i.appid] ||= []);
    const last = list[list.length - 1];
    if (last && last.d === day) Object.assign(last, { v, pct: i.price.discountPct || 0 });
    else list.push({ d: day, v, pct: i.price.discountPct || 0 });
    if (list.length > 240) list.splice(0, list.length - 240);
  }
  write('price-history.json', h);
  return h;
}

/** Mínimo histórico en Steam (en %, para compararlo con la rebaja de tu región). */
async function lows({ read, write }, items, max = 12) {
  const cache = read('price-lows.json', {});
  let asked = 0;
  for (const i of items || []) {
    const c = cache[i.appid];
    if (c && Date.now() - c.at < 7 * 86400000) continue;
    if (asked >= max) break;
    asked++;
    try {
      const a = await fetch(`https://www.cheapshark.com/api/1.0/games?steamAppID=${i.appid}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }).then((r) => r.json());
      if (!a?.[0]?.gameID) {
        cache[i.appid] = { at: Date.now(), none: true };
        continue;
      }
      const g = await fetch(`https://www.cheapshark.com/api/1.0/games?id=${a[0].gameID}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }).then((r) => r.json());
      const steam = (g.deals || []).find((x) => x.storeID === '1') || g.deals?.[0];
      const retail = Number(steam?.retailPrice) || null;
      const low = Number(g.cheapestPriceEver?.price);
      cache[i.appid] = { at: Date.now(), lowUsd: low, retailUsd: retail, lowPct: retail && low ? Math.round((1 - low / retail) * 100) : null, lowDate: g.cheapestPriceEver?.date ? g.cheapestPriceEver.date * 1000 : null };
    } catch {
      cache[i.appid] = { at: Date.now() - 6 * 86400000, error: true }; // reintenta mañana
    }
  }
  write('price-lows.json', cache);
  return cache;
}

/** ¿Está en su mínimo? (por el historial propio o por CheapShark) */
function atLow(item, hist, low) {
  const pct = item.price?.discountPct || 0;
  if (!pct) return false;
  if (low?.lowPct != null && pct >= low.lowPct - 1) return true;
  const list = hist?.[item.appid] || [];
  const v = num(item.price?.final);
  return list.length >= 8 && v != null && v <= Math.min(...list.map((x) => x.v));
}

module.exports = { record, lows, atLow, num };

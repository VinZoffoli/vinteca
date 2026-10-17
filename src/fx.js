// Tipo de cambio del dólar en Costa Rica (compra y venta del día), de la API
// pública del Ministerio de Hacienda, que publica el del Banco Central.
const URL_API = 'https://api.hacienda.go.cr/indicadores/tc/dolar';

async function get({ read, write }, force) {
  const c = read('fx.json', null);
  if (!force && c && Date.now() - c.at < 4 * 3600000) return c;
  try {
    const r = await fetch(URL_API, { headers: { Accept: 'application/json', 'User-Agent': 'ViperTeca' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Hacienda no respondió (HTTP ${r.status}).`);
    const j = await r.json();
    const out = { at: Date.now(), date: j.venta?.fecha || j.compra?.fecha || null, buy: Number(j.compra?.valor) || null, sell: Number(j.venta?.valor) || null, prev: c && c.date !== (j.venta?.fecha || null) ? { buy: c.buy, sell: c.sell, date: c.date } : c?.prev || null };
    write('fx.json', out);
    return out;
  } catch (e) {
    if (c) return { ...c, stale: true };
    throw e;
  }
}

module.exports = { get };

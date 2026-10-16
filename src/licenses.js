// Fechas de compra de Steam.
// La Web API no las expone. La única fuente fiable es la página de licencias de
// la cuenta (store.steampowered.com/account/licenses), que exige haber iniciado
// sesión en la tienda. La app abre esa página en una ventana aparte, el usuario
// inicia sesión él mismo en la web de Steam y se lee la tabla. La sesión no se
// guarda en disco (partición en memoria): solo se guardan las fechas.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  ene: 0, abr: 3, ago: 7, dic: 11, // por si la página sale en español
};

// Se ejecuta dentro de la página de licencias.
const EXTRACT_JS = `(() => {
  const rows = [...document.querySelectorAll('table.account_table tr')];
  return rows.map(tr => {
    const date = tr.querySelector('td.license_date_col');
    const tds = tr.querySelectorAll('td');
    if (!date || tds.length < 2) return null;
    const nameTd = tds[1];
    const remove = nameTd.querySelector('a[href*="RemoveFreeLicense"], a[onclick*="RemoveFreeLicense"]');
    let packageid = null;
    if (remove) {
      const m = (remove.getAttribute('href') + ' ' + remove.getAttribute('onclick')).match(/RemoveFreeLicense\\(\\s*(\\d+)/);
      if (m) packageid = Number(m[1]);
    }
    const clone = nameTd.cloneNode(true);
    clone.querySelectorAll('div.free_license_remove_link, a').forEach(n => n.remove());
    return { date: date.textContent.trim(), name: clone.textContent.trim().replace(/\\s+/g, ' '), packageid };
  }).filter(Boolean);
})()`;

function parseDate(s) {
  // Inglés: "16 Oct, 2020" u "Oct 16, 2020"
  const m1 = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  const m2 = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  let d, mon, y;
  if (m1) [, d, mon, y] = m1;
  else if (m2) [, mon, d, y] = m2;
  else return null;
  const mi = MONTHS[mon.toLowerCase()];
  if (mi === undefined) return null;
  return Math.floor(Date.UTC(Number(y), mi, Number(d)) / 1000);
}

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/\b(retail|limited free promotional package|free on demand|complimentary|pre-?purchase|standard edition|game of the year edition|goty|deluxe edition|digital deluxe edition|complete edition|definitive edition|edition)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Asocia cada licencia a un juego en propiedad por nombre.
 * @param rows   [{date, name}]
 * @param owned  [{appid, name}]
 * @returns { dates: {appid: unix}, matched, total }
 */
function matchLicenses(rows, owned) {
  const byNorm = new Map();
  for (const g of owned) {
    const k = norm(g.name);
    if (k && !byNorm.has(k)) byNorm.set(k, g.appid);
  }
  const keys = [...byNorm.keys()].sort((a, b) => b.length - a.length);
  const dates = {};
  let matched = 0;
  for (const r of rows) {
    const t = parseDate(r.date);
    if (!t) continue;
    const n = norm(r.name);
    if (!n) continue;
    let appid = byNorm.get(n);
    if (!appid) {
      // "Juego + DLC", "Juego - Season Pass"... -> prefijo más largo
      const k = keys.find((key) => key.length >= 4 && n.startsWith(key + ' '));
      if (k) appid = byNorm.get(k);
    }
    if (!appid) continue;
    matched++;
    if (!dates[appid] || t < dates[appid]) dates[appid] = t;
  }
  return { dates, matched, total: rows.length };
}

module.exports = { EXTRACT_JS, parseDate, matchLicenses };

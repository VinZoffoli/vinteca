// Comprobación rápida sin abrir la ventana: lee las fuentes y muestra un resumen.
// Uso: npm run check   (sin clave de Steam: solo lee instalados + caché de Epic)
const library = require('../src/library');
const { parseDate, matchLicenses } = require('../src/licenses');

const memStore = {};
const mem = { read: (k, d) => memStore[k] ?? d, write: (k, v) => (memStore[k] = v) };

(async () => {
  const r = await library.refresh({ apiKey: process.env.STEAM_API_KEY || null, settings: {}, previous: null, purchaseDates: {}, cache: mem });
  const by = (s) => r.games.filter((g) => g.store === s);
  console.log('SteamID detectado:', r.steamId, '| fuentes:', r.sources);
  console.log('Steam:', by('steam').length, 'juegos | instalados:', by('steam').filter((g) => g.installed).length);
  console.log('Epic :', by('epic').length, 'juegos | instalados:', by('epic').filter((g) => g.installed).length);
  console.log('Con actualización:', r.games.filter((g) => g.updatePending).map((g) => `${g.title} [${g.updateText}]`));
  console.log('Sin carátula:', r.games.filter((g) => !g.cover).map((g) => g.title));
  console.log('Ejemplos:', r.games.slice(0, 3).map((g) => ({ t: g.title, c: g.cover, l: g.launchUrl })));
  console.log('Avisos:', r.warnings);
  console.assert(parseDate('16 Oct, 2020') === Date.UTC(2020, 9, 16) / 1000, 'parseDate en');
  console.assert(parseDate('Oct 16, 2020') === Date.UTC(2020, 9, 16) / 1000, 'parseDate us');
  const m = matchLicenses([{ date: '1 Jan, 2021', name: 'God of War' }, { date: '2 Feb, 2022', name: 'Portal 2 Soundtrack' }], [{ appid: 1, name: 'God of War' }, { appid: 2, name: 'Portal 2' }]);
  console.assert(m.dates[1] && m.dates[2] && m.matched === 2, 'matchLicenses');
  console.log('Pruebas de licencias OK');
})().catch((e) => { console.error(e); process.exit(1); });

// Duración de los juegos según HowLongToBeat (historia, historia + extras,
// completista). HowLongToBeat no tiene API pública: se lee su buscador con una
// ventana oculta de la app, un juego cada pocos segundos, y se guarda 60 días.
const { BrowserWindow, session } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TTL = 60 * 86400000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©:’'!?.,\-–—()[\]]/g, ' ')
    .replace(/\b(goty|game of the year|definitive|deluxe|complete|remastered|edition|director'?s cut|enhanced)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "27 Hours", "41½ Hours", "45 Mins", "--"
function hours(t) {
  const m = String(t || '').match(/(\d+)(½)?\s*(Hours?|Mins?)/i);
  if (!m) return null;
  const v = Number(m[1]) + (m[2] ? 0.5 : 0);
  return /min/i.test(m[3]) ? Math.round((v / 60) * 10) / 10 : v;
}

const SCRAPE = `(() => {
  const items = [...document.querySelectorAll('ul li')].filter((li) => li.querySelector('a[href*="/game/"]') && /Hours|Mins|--/.test(li.innerText));
  return items.slice(0, 6).map((li) => {
    const a = li.querySelector('a[href*="/game/"]');
    const text = li.innerText;
    const grab = (label) => { const m = text.match(new RegExp(label + '\\\\s*([^\\\\n]*?(?:Hours?|Mins?|--))', 'i')); return m ? m[1] : null; };
    return { title: (li.querySelector('h2, h3') || a).innerText.trim().split('\\n')[0], href: a.getAttribute('href'), main: grab('Main Story') || grab('Single-Player'), extra: grab('Main \\\\+ Extra') || grab('Co-Op'), comp: grab('Completionist') || grab('Vs\\\\.') };
  });
})()`;

let win = null;
async function page() {
  if (win && !win.isDestroyed()) return win;
  const ses = session.fromPartition('persist:vt-hltb');
  ses.setUserAgent(UA);
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.setAudioMuted(true);
  return win;
}
function close() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

async function lookup(title) {
  const w = await page();
  await w.loadURL(`https://howlongtobeat.com/?q=${encodeURIComponent(title)}`).catch(() => {});
  let rows = [];
  for (let i = 0; i < 12; i++) {
    await wait(700);
    rows = await w.webContents.executeJavaScript(SCRAPE).catch(() => []);
    if (rows.length) break;
  }
  if (!rows.length) return { found: false };
  const n = norm(title);
  const best = rows.find((r) => norm(r.title) === n) || rows.find((r) => norm(r.title).startsWith(n) || n.startsWith(norm(r.title))) || rows[0];
  return { found: true, title: best.title, url: `https://howlongtobeat.com${best.href}`, main: hours(best.main), extra: hours(best.extra), comp: hours(best.comp), exact: norm(best.title) === n };
}

let running = null;
/** Busca la duración de los juegos que falten (o caducados). */
async function fill(games, { read, write, onProgress, force }) {
  if (running) return running;
  running = (async () => {
    const cache = read('hltb.json', {});
    const todo = games.filter((g) => force || !cache[g.id] || Date.now() - cache[g.id].at > TTL);
    try {
      let n = 0;
      for (const g of todo) {
        onProgress?.({ done: n, total: todo.length, title: g.title });
        try {
          cache[g.id] = { ...(await lookup(g.title)), at: Date.now() };
        } catch {
          cache[g.id] = { found: false, at: Date.now() };
        }
        n++;
        if (n % 5 === 0) write('hltb.json', cache);
        await wait(1200 + Math.random() * 800);
      }
    } finally {
      close();
      write('hltb.json', cache);
    }
    onProgress?.({ done: todo.length, total: todo.length });
    return cache;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

module.exports = { fill, lookup, hours, norm };

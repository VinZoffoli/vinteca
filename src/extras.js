// Juegos gratis de Epic, espacio en disco y datos propios de cada juego
// (estado, favorito, notas, platino objetivo y perfil del modo enfoque).
const fs = require('fs');

// ---------- Juegos gratis de Epic ----------
// Lista pública que usa la propia tienda de Epic. discountPercentage = 0
// significa "precio final 0", es decir, gratis.
async function epicFreeGames(country = 'CL') {
  const url = `https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=es-ES&country=${country}&allowCountries=${country}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Epic respondió ${r.status}`);
  const j = await r.json();
  const els = j?.data?.Catalog?.searchStore?.elements || [];
  const out = [];
  for (const e of els) {
    const slot = (list) => (list?.[0]?.promotionalOffers || []).filter((o) => o.discountSetting?.discountPercentage === 0);
    const now = slot(e.promotions?.promotionalOffers);
    const next = slot(e.promotions?.upcomingPromotionalOffers);
    const offer = now[0] || next[0];
    if (!offer) continue;
    const slug =
      (e.productSlug && e.productSlug.replace(/\/home$/, '')) ||
      e.offerMappings?.[0]?.pageSlug ||
      e.catalogNs?.mappings?.find((m) => m.pageType === 'productHome')?.pageSlug ||
      null;
    const img = (t) => e.keyImages?.find((k) => k.type === t)?.url;
    out.push({
      id: e.id,
      title: e.title,
      when: now[0] ? 'now' : 'next',
      start: Date.parse(offer.startDate) || null,
      end: Date.parse(offer.endDate) || null,
      originalPrice: e.price?.totalPrice?.fmtPrice?.originalPrice || null,
      image: img('OfferImageWide') || img('DieselStoreFrontWide') || img('Thumbnail') || null,
      url: slug ? `https://store.epicgames.com/es-ES/p/${slug}` : 'https://store.epicgames.com/es-ES/free-games',
    });
  }
  return out.sort((a, b) => (a.when === b.when ? (a.start || 0) - (b.start || 0) : a.when === 'now' ? -1 : 1));
}

// ---------- Espacio en disco ----------
function driveOf(p) {
  const m = /^([a-z]):/i.exec(String(p || ''));
  return m ? m[1].toUpperCase() + ':\\' : null;
}

function diskInfo(games) {
  const drives = new Map();
  for (const g of games) {
    if (!g.installed || !g.installPath) continue;
    const d = driveOf(g.installPath);
    if (!d) continue;
    if (!drives.has(d)) drives.set(d, { drive: d, games: [], gamesBytes: 0 });
    const e = drives.get(d);
    e.games.push(g.id);
    e.gamesBytes += g.sizeBytes || 0;
  }
  for (const e of drives.values()) {
    try {
      const s = fs.statfsSync(e.drive);
      e.total = s.blocks * s.bsize;
      e.free = s.bavail * s.bsize;
    } catch {
      e.total = e.free = null;
    }
  }
  return [...drives.values()].sort((a, b) => a.drive.localeCompare(b.drive));
}

// ---------- Datos propios de cada juego ----------
const STATUSES = ['pending', 'playing', 'finished', 'dropped'];

function readUserGames(read) {
  return read('user-games.json', {});
}

function updateUserGame(read, write, id, patch) {
  const all = readUserGames(read);
  const cur = { ...(all[id] || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'status' && v && !STATUSES.includes(v)) continue;
    if (k === 'status') {
      if (v === 'finished' && cur.status !== 'finished') cur.finishedAt = Date.now();
      if (v !== 'finished') delete cur.finishedAt;
    }
    if (k === 'note') {
      const t = String(v || '').slice(0, 2000);
      if (t) cur.note = t;
      else delete cur.note;
      continue;
    }
    if (v === null || v === undefined || v === '' || v === false) delete cur[k];
    else cur[k] = v;
  }
  if (Object.keys(cur).length) all[id] = cur;
  else delete all[id];
  write('user-games.json', all);
  return all;
}

module.exports = { epicFreeGames, diskInfo, readUserGames, updateUserGame };

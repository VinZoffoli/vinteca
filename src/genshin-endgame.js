// Cuándo se reinician el Abismo de Espiral y el Teatro Imaginario (servidor de
// América, UTC-5, a las 4:00) y cuánto falta.
const SERVER_OFFSET = -5 * 3600000;

// Instante UTC de "día d del mes m a las 4:00" en hora del servidor
function at4(y, m, d) {
  return Date.UTC(y, m, d, 4, 0, 0) - SERVER_OFFSET;
}
function nextMonthly(day, now = Date.now()) {
  const s = new Date(now + SERVER_OFFSET);
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  let t = at4(y, m, day);
  if (t <= now) {
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    t = at4(y, m, day);
  }
  return t;
}
function resets(now = Date.now()) {
  const abyss = nextMonthly(16, now); // el Abismo se reinicia el día 16 de cada mes
  const theater = nextMonthly(1, now); // el Teatro Imaginario, el día 1
  const dailyNext = (() => {
    const s = new Date(now + SERVER_OFFSET);
    let t = at4(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    if (t <= now) t += 86400000;
    return t;
  })();
  const weekly = (() => {
    // jefes semanales y tienda: lunes 4:00
    const s = new Date(now + SERVER_OFFSET);
    const dow = s.getUTCDay();
    let t = at4(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + ((8 - dow) % 7));
    if (t <= now) t += 7 * 86400000;
    return t;
  })();
  return [
    { key: 'abyss', name: 'Abismo de Espiral', at: abyss, note: 'Se reinicia el 16 de cada mes.' },
    { key: 'theater', name: 'Teatro Imaginario', at: theater, note: 'Se reinicia el día 1 de cada mes.' },
    { key: 'weekly', name: 'Jefes semanales', at: weekly, note: 'Los descuentos de resina vuelven cada lunes.' },
    { key: 'daily', name: 'Encargos diarios', at: dailyNext, note: 'El día de Genshin cambia a las 4:00 del servidor.' },
    { key: 'paimon', name: 'Tienda de Paimon', at: theater, note: 'Cada día 1: 5 destinos entrelazados y 5 encontrados por brillo estelar, y otros 5 + 5 por polvo estelar.' },
  ];
}

module.exports = { resets };

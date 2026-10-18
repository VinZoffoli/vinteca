// Clima de Guápiles (Open-Meteo, gratis y sin clave): ahora, las próximas horas y
// tres días, con aviso de lluvia fuerte o tormenta.
const PLACE = { name: 'Guápiles', lat: 10.2167, lon: -83.7833, tz: 'America/Costa_Rica' };
const URL_API = `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=temperature_2m,apparent_temperature,weather_code,precipitation,relative_humidity_2m&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=${encodeURIComponent(PLACE.tz)}&forecast_days=3`;

// Códigos WMO en palabras
function describe(code) {
  if (code === 0) return 'Despejado';
  if (code <= 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code <= 48) return 'Neblina';
  if (code <= 55) return 'Llovizna';
  if (code <= 57) return 'Llovizna helada';
  if (code === 61) return 'Lluvia débil';
  if (code === 63) return 'Lluvia';
  if (code === 65) return 'Lluvia fuerte';
  if (code <= 67) return 'Lluvia helada';
  if (code <= 77) return 'Nieve';
  if (code === 80) return 'Chubascos';
  if (code === 81) return 'Chubascos fuertes';
  if (code === 82) return 'Aguaceros muy fuertes';
  if (code <= 86) return 'Nieve';
  if (code === 95) return 'Tormenta eléctrica';
  return 'Tormenta con granizo';
}
const heavy = (code, mm) => [65, 82, 95, 96, 99].includes(code) || mm >= 25;

async function get({ read, write }, force) {
  const c = read('weather.json', null);
  if (!force && c && Date.now() - c.at < 30 * 60000) return c;
  try {
    const r = await fetch(URL_API, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`El servicio del clima no respondió (HTTP ${r.status}).`);
    const j = await r.json();
    const nowIso = j.current.time.slice(0, 13);
    const start = Math.max(0, j.hourly.time.findIndex((t) => t.slice(0, 13) === nowIso));
    const out = {
      at: Date.now(),
      place: PLACE.name,
      now: { temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code, text: describe(j.current.weather_code), rain: j.current.precipitation, humidity: j.current.relative_humidity_2m },
      hours: j.hourly.time.slice(start, start + 12).map((t, i) => ({ time: t, temp: j.hourly.temperature_2m[start + i], prob: j.hourly.precipitation_probability[start + i], mm: j.hourly.precipitation[start + i], code: j.hourly.weather_code[start + i] })),
      days: j.daily.time.map((d, i) => ({ date: d, code: j.daily.weather_code[i], text: describe(j.daily.weather_code[i]), max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], mm: j.daily.precipitation_sum[i], prob: j.daily.precipitation_probability_max[i], heavy: heavy(j.daily.weather_code[i], j.daily.precipitation_sum[i]) })),
    };
    write('weather.json', out);
    return out;
  } catch (e) {
    if (c) return { ...c, stale: true };
    throw e;
  }
}

/** Aviso del día si viene lluvia fuerte o tormenta (una vez al día, desde las 6:00). */
function notice({ read, write }, w) {
  const now = new Date();
  if (!w || now.getHours() < 6) return null;
  const today = w.days?.[0];
  if (!today?.heavy) return null;
  const key = now.toLocaleDateString('sv');
  const s = read('weather-notified.json', {});
  if (s.last === key) return null;
  write('weather-notified.json', { last: key });
  return { title: `${today.text} hoy en ${w.place}`, body: `${Math.round(today.mm)} mm de lluvia previstos (probabilidad ${today.prob} %). Máx. ${Math.round(today.max)} °C.` };
}

module.exports = { get, notice, describe };

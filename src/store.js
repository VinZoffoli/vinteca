// Almacenamiento local en %LOCALAPPDATA%\biblioteca-juegos (fuera del proyecto).
// La clave de la API de Steam se cifra con safeStorage de Electron, que en
// Windows usa DPAPI: solo tu usuario de Windows puede descifrarla.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const dir = () => app.getPath('userData');
const file = (name) => path.join(dir(), name);

const PRECIOUS = /^(casa|settings|sessions|user-games|genshin-(tasks|wishes|gather|inventory)|gfarm-plan|workana|linkedin|alquileres|anime[\w-]*|assist-chat|purchase-dates|weekly|goals|genshin-events-done|genshin-ai|price-history)\.json$/;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function read(name, fallback) {
  try {
    return readStrict(name) ?? fallback;
  } catch (e) {
    // Con tus datos importantes no se finge que el archivo está vacío (eso hacía que
    // se guardara encima uno nuevo y se perdiera todo): se usa la copia anterior o se
    // avisa con un error.
    if (PRECIOUS.test(name)) {
      try {
        const bak = readStrict(name + '.bak');
        if (bak) return bak;
      } catch {}
      throw e;
    }
    return fallback;
  }
}

/**
 * Lee un archivo distinguiendo "no existe" (devuelve null) de "no se pudo leer"
 * (lanza un error). Si Windows lo tiene ocupado o está a medio escribir, lo
 * vuelve a intentar unas veces antes de rendirse.
 */
function readStrict(name) {
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      last = e;
      pause(40 * (i + 1));
    }
  }
  throw new Error(`No pude leer ${name}: ${last?.message || 'error desconocido'}`);
}

// Los datos que escribes tú guardan además la versión anterior (.bak), por si acaso
function write(name, data) {
  fs.mkdirSync(dir(), { recursive: true });
  // nombre temporal único: dos procesos a la vez no se pisan el archivo temporal
  const tmp = file(`${name}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data));
  if (PRECIOUS.test(name)) {
    try {
      const cur = fs.readFileSync(file(name), 'utf8');
      JSON.parse(cur); // solo se guarda como copia si está sano
      fs.writeFileSync(file(name + '.bak'), cur);
    } catch {}
  }
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file(name));
      return;
    } catch (e) {
      if (i === 4) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
        throw e;
      }
      pause(50 * (i + 1));
    }
  }
}

function getSettings() {
  const s = read('settings.json', {});
  return {
    steamId: s.steamId || '',
    legendaryPath: s.legendaryPath || '',
    country: s.country === 'CR' ? 'CR' : 'CL',
    focus: {
      powerPlan: s.focus?.powerPlan !== false,
      // Discord: 'always' (no tocarlo), 'multiplayer' (solo en juegos en línea) o 'never'
      discord: s.focus?.discord || (s.focus?.keepDiscord === false ? 'never' : 'multiplayer'),
      autoOnPlay: s.focus?.autoOnPlay !== false,
      overlay: s.focus?.overlay === true,
      fps: s.focus?.fps !== false,
      minimize: s.focus?.minimize !== false,
      freeMemory: s.focus?.freeMemory !== false,
    },
    trackSessions: s.trackSessions !== false,
    autoBackup: s.autoBackup !== false,
    keepBackups: s.keepBackups || 5,
    sessionSummary: s.sessionSummary !== false,
    dailyLimitMin: Number(s.dailyLimitMin) || 0,
    remindEveryMin: Number(s.remindEveryMin) || 0,
    weeklySummary: s.weeklySummary !== false,
    epicReminder: s.epicReminder !== false,
    friendAlerts: s.friendAlerts !== false,
    hotkey: s.hotkey !== false,
    keepTracking: s.keepTracking !== false,
    onboarded: !!s.onboarded,
    hasSteamKey: !!s.steamKeyEnc,
    backupDir: s.backupDir || '',
    theme: ['light', 'system'].includes(s.theme) ? s.theme : 'dark',
    bgGame: s.bgGame || '',
    density: s.density || 'comoda',
    radius: s.radius || 'suaves',
    glow: s.glow || 'soft',
    uiScale: s.uiScale || '100',
    motion: s.motion || 'full',
    lanAuto: !!s.lanAuto,
    priceAlerts: s.priceAlerts !== false,
    calReminders: s.calReminders !== false,
    calNewAlerts: s.calNewAlerts !== false,
    sensorAlerts: s.sensorAlerts !== false,
    resinAlert: s.resinAlert !== false,
    codesAlert: s.codesAlert !== false,
    notionAlerts: s.notionAlerts !== false,
    healthAlerts: s.healthAlerts !== false,
    vercelAlerts: s.vercelAlerts !== false,
    panelAuto: !!s.panelAuto,
    giveawayAlerts: s.giveawayAlerts !== false,
    checkinAlert: s.checkinAlert !== false,
    rentAlerts: s.rentAlerts !== false,
    cloudBackup: s.cloudBackup !== false,
    dndGaming: s.dndGaming !== false,
    gatherAlerts: s.gatherAlerts !== false,
    sundaySummary: s.sundaySummary !== false,
    paimonAlert: s.paimonAlert !== false,
    weatherAlerts: s.weatherAlerts !== false,
    eventAlerts: s.eventAlerts !== false,
    mailAlerts: s.mailAlerts !== false,
    tempLimits: s.tempLimits || { cpu: 90, gpu: 85 },
    genshinUid: s.genshinUid || '',
    palette: s.palette || 'viper',
    customAccent: s.customAccent || '#ef2f34',
    customHue: Number.isFinite(s.customHue) ? s.customHue : 352,
    customSat: Number.isFinite(s.customSat) ? s.customSat : 16,
  };
}

function getSteamKey() {
  const s = read('settings.json', {});
  if (!s.steamKeyEnc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.steamKeyEnc, 'base64'));
  } catch {
    return null;
  }
}

const FLAGS = ['autoBackup', 'sessionSummary', 'weeklySummary', 'epicReminder', 'friendAlerts', 'hotkey', 'onboarded', 'lanAuto', 'priceAlerts', 'calReminders', 'calNewAlerts', 'sensorAlerts', 'resinAlert', 'codesAlert', 'notionAlerts', 'healthAlerts', 'vercelAlerts', 'panelAuto', 'mailAlerts', 'giveawayAlerts', 'checkinAlert', 'rentAlerts', 'cloudBackup', 'dndGaming', 'gatherAlerts', 'sundaySummary', 'paimonAlert', 'weatherAlerts', 'eventAlerts'];

function saveSettings({ steamId, steamKey, legendaryPath, clearSteamKey, country, focus, trackSessions, keepTracking, ...rest }) {
  const s = read('settings.json', {});
  if (steamId !== undefined) s.steamId = String(steamId).trim();
  if (legendaryPath !== undefined) s.legendaryPath = String(legendaryPath).trim();
  if (country !== undefined) s.country = country === 'CR' ? 'CR' : 'CL';
  if (focus) s.focus = { ...s.focus, ...focus };
  if (trackSessions !== undefined) s.trackSessions = !!trackSessions;
  if (keepTracking !== undefined) s.keepTracking = !!keepTracking;
  for (const k of FLAGS) if (rest[k] !== undefined) s[k] = !!rest[k];
  for (const k of ['dailyLimitMin', 'remindEveryMin', 'keepBackups']) if (rest[k] !== undefined) s[k] = Math.max(0, Math.min(24 * 60, Number(rest[k]) || 0));
  if (rest.theme !== undefined) s.theme = ['light', 'system'].includes(rest.theme) ? rest.theme : 'dark';
  if (rest.genshinUid !== undefined) {
    const u = String(rest.genshinUid || '').trim();
    if (u && !/^\d{9,10}$/.test(u)) throw new Error('El UID de Genshin tiene 9 o 10 cifras.');
    s.genshinUid = u;
  }
  if (rest.palette !== undefined) s.palette = /^[a-z]{2,20}$/.test(rest.palette) ? rest.palette : 'viper';
  if (rest.customAccent !== undefined && /^#[0-9a-f]{6}$/i.test(rest.customAccent)) s.customAccent = rest.customAccent;
  if (rest.customHue !== undefined) s.customHue = Math.max(0, Math.min(360, Math.round(Number(rest.customHue) || 0)));
  if (rest.customSat !== undefined) s.customSat = Math.max(0, Math.min(60, Math.round(Number(rest.customSat) || 0)));
  if (rest.bgGame !== undefined) s.bgGame = String(rest.bgGame || '').slice(0, 200);
  // estilo de la interfaz (Ajustes → Apariencia)
  const LOOK = { density: ['comoda', 'compacta'], radius: ['suaves', 'rectas', 'redondas'], glow: ['soft', 'off', 'strong'], uiScale: ['100', '90', '110', '120'], motion: ['full', 'reduced'] };
  for (const [k, ok] of Object.entries(LOOK)) if (rest[k] !== undefined) s[k] = ok.includes(String(rest[k])) ? String(rest[k]) : ok[0];
  if (clearSteamKey) delete s.steamKeyEnc;
  if (steamKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
    s.steamKeyEnc = safeStorage.encryptString(String(steamKey).trim()).toString('base64');
  }
  write('settings.json', s);
  return getSettings();
}

module.exports = { read, readStrict, write, getSettings, getSteamKey, saveSettings };

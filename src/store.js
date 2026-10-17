// Almacenamiento local en %LOCALAPPDATA%\biblioteca-juegos (fuera del proyecto).
// La clave de la API de Steam se cifra con safeStorage de Electron, que en
// Windows usa DPAPI: solo tu usuario de Windows puede descifrarla.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const dir = () => app.getPath('userData');
const file = (name) => path.join(dir(), name);

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name, data) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file(name));
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

const FLAGS = ['autoBackup', 'sessionSummary', 'weeklySummary', 'epicReminder', 'friendAlerts', 'hotkey', 'onboarded', 'lanAuto', 'priceAlerts', 'calReminders', 'calNewAlerts', 'sensorAlerts', 'resinAlert', 'codesAlert', 'notionAlerts', 'healthAlerts', 'vercelAlerts', 'panelAuto', 'mailAlerts', 'giveawayAlerts', 'checkinAlert', 'rentAlerts', 'cloudBackup'];

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
  if (clearSteamKey) delete s.steamKeyEnc;
  if (steamKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
    s.steamKeyEnc = safeStorage.encryptString(String(steamKey).trim()).toString('base64');
  }
  write('settings.json', s);
  return getSettings();
}

module.exports = { read, write, getSettings, getSteamKey, saveSettings };

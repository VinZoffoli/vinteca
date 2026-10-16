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

const FLAGS = ['autoBackup', 'sessionSummary', 'weeklySummary', 'epicReminder', 'friendAlerts', 'hotkey', 'onboarded'];

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
  if (clearSteamKey) delete s.steamKeyEnc;
  if (steamKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows (DPAPI) no está disponible.');
    s.steamKeyEnc = safeStorage.encryptString(String(steamKey).trim()).toString('base64');
  }
  write('settings.json', s);
  return getSettings();
}

module.exports = { read, write, getSettings, getSteamKey, saveSettings };

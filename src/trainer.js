// Lado de la app del motor de trucos: arranca el proceso de búsqueda
// (trainer-worker.js), lista los juegos abiertos, guarda tus trucos por juego,
// importa tablas de Cheat Engine (.CT) y registra los atajos de teclado.
const path = require('path');
const { execFile } = require('child_process');
const { utilityProcess } = require('electron');

// Juegos en línea o con antitrampas a nivel de sistema: nunca se tocan
const BLOCKED_EXE = /^(genshinimpact|yuanshen|starrail|zenlesszonezero|fortniteclient|valorant|leagueoflegends|league of legends|r5apex|cs2|csgo|dota2|overwatch|pubg|tslgame|rainbowsix|rocketleague|destiny2|eldenring|darksouls3|bf2042|bf1|bfv|cod|modernwarfare|warzone|fifa|fc2\d|deadbydaylight|rust|eft|escapefromtarkov|wow|gta5|gtav|rdr2|lostark|newworld|naraka|thefinals|xdefiant|marvelrivals|hunt|sot|seaofthieves|vrchat|robloxplayerbeta|minecraft)/i;
const AC_SERVICES = ['mhyprot2', 'mhyprot3', 'HoYoKProtect', 'EasyAntiCheat', 'EasyAntiCheat_EOS', 'BEService', 'vgc', 'vgk', 'FACEIT', 'GameGuard'];

let child = null;
let seq = 0;
const pending = new Map();
let onEvent = () => {};

function worker() {
  if (child) return child;
  child = utilityProcess.fork(path.join(__dirname, 'trainer-worker.js'), [], { serviceName: 'Motor de trucos' });
  child.on('message', (m) => {
    if (m.progress != null || m.event) return onEvent(m);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  });
  child.on('exit', () => {
    child = null;
    for (const p of pending.values()) p.reject(new Error('El motor de trucos se detuvo.'));
    pending.clear();
    onEvent({ event: 'exited' });
  });
  return child;
}

function call(cmd, args) {
  const c = worker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    c.postMessage({ id, cmd, args });
  });
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 15000, maxBuffer: 4 << 20 }, (e, out) => resolve(e ? '' : String(out))));

/** Programas abiertos con ventana (los juegos están ahí). */
async function processes(gameExes = []) {
  const out = await run('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.Id, $_.ProcessName, $_.MainWindowTitle, $_.Path }"]);
  const known = new Set(gameExes.map((e) => e.toLowerCase()));
  const skip = /^(explorer|applicationframehost|textinputhost|systemsettings|shellexperiencehost|searchhost|startmenuexperiencehost|electron|viperteca|claude|code|chrome|msedge|firefox|opera|brave|discord|spotify|steam|steamwebhelper|epicgameslauncher|wand|wemod|openrgb|powershell|windowsterminal|cmd|notepad|taskmgr)$/i;
  return out
    .split(/\r?\n/)
    .map((l) => l.split('|'))
    .filter((p) => p.length >= 3 && p[0])
    .map(([id, name, title, exe]) => ({ pid: Number(id), name, title, path: exe || '', game: known.has(`${name}.exe`.toLowerCase()), blocked: BLOCKED_EXE.test(name) }))
    .filter((p) => !skip.test(p.name))
    .sort((a, b) => b.game - a.game || a.name.localeCompare(b.name));
}

async function antiCheatRunning() {
  const out = await run('sc.exe', ['query', 'type=', 'all', 'state=', 'active']);
  return AC_SERVICES.filter((s) => new RegExp(`SERVICE_NAME:\\s*${s}\\b`, 'i').test(out));
}

async function attach(p) {
  if (BLOCKED_EXE.test(p.name)) throw new Error(`${p.name} es un juego en línea o con antitrampas. Por tu seguridad, ViperTeca no lo toca: podrías perder tu cuenta.`);
  const ac = await antiCheatRunning();
  if (ac.length) throw new Error(`Hay un antitrampas en marcha (${ac.join(', ')}). Ciérralo (cierra el juego en línea que lo abrió) antes de usar trucos.`);
  return call('attach', { pid: p.pid });
}

// ---- tablas de Cheat Engine (.CT) ----
const CT_TYPES = { '4 bytes': 'int32', float: 'float', double: 'double', '2 bytes': 'int16', byte: 'byte', '8 bytes': 'int64' };
function parseCT(xml) {
  const out = [];
  const skipped = [];
  const entries = xml.split(/<CheatEntry>/i).slice(1);
  for (const block of entries) {
    const desc = (block.match(/<Description>"?([^<"]*)"?<\/Description>/i) || [])[1]?.trim() || 'Truco';
    if (/<AssemblerScript>/i.test(block.split(/<CheatEntries>/i)[0])) {
      skipped.push(desc);
      continue;
    }
    const vt = (block.match(/<VariableType>([^<]+)<\/VariableType>/i) || [])[1];
    const addrTxt = (block.match(/<Address>([^<]+)<\/Address>/i) || [])[1];
    if (!vt || !addrTxt) continue;
    const type = CT_TYPES[vt.trim().toLowerCase()];
    if (!type) {
      skipped.push(desc);
      continue;
    }
    const offs = [...(block.split(/<\/Offsets>/i)[0].match(/<Offset>([^<]+)<\/Offset>/gi) || [])].map((o) => parseInt(o.replace(/<\/?Offset>/gi, ''), 16));
    const a = addrTxt.trim().replace(/^"|"$/g, '');
    const m = a.match(/^"?([^"+]+\.(?:exe|dll))"?\s*\+\s*([0-9a-f]+)$/i);
    const entry = { id: Math.random().toString(36).slice(2), desc, type, pointer: offs.length ? [...offs].reverse() : undefined };
    if (m) Object.assign(entry, { module: m[1], offset: parseInt(m[2], 16) });
    else if (/^[0-9a-f]+$/i.test(a)) entry.addr = parseInt(a, 16);
    else {
      skipped.push(desc);
      continue;
    }
    out.push(entry);
  }
  return { entries: out, skipped };
}

module.exports = { processes, attach, call, parseCT, setListener: (fn) => (onEvent = fn) };

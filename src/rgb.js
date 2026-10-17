// Iluminación RGB del PC con OpenRGB (openrgb.org, código abierto).
// OpenRGB es quien habla con el hardware (placa base, ventiladores ARGB,
// teclado…); ViperTeca se conecta a su servidor local (127.0.0.1:6742) y le
// manda colores y efectos. Para el RGB de la placa base OpenRGB necesita su
// controlador PawnIO y abrirse como administrador (lo haces tú, con el aviso
// de Windows).
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Client } = require('openrgb-sdk');

const PORT = 6742;
let client = null;
let connecting = null;

function findExe(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  const base = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenRGB');
  const candidates = [path.join(base, 'OpenRGB.exe'), path.join(base, 'OpenRGB Windows 64-bit', 'OpenRGB.exe'), 'C:\\Program Files\\OpenRGB\\OpenRGB.exe'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function connect() {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new Client('ViperTeca', PORT, '127.0.0.1');
    await c.connect(1500);
    c.on?.('disconnect', () => {
      client = null;
    });
    client = c;
    return c;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function tryConnect() {
  try {
    return await connect();
  } catch {
    client = null;
    return null;
  }
}

/** Abre OpenRGB como servidor en segundo plano (con admin = aviso de Windows). */
async function start(exe, admin) {
  if (!exe) throw new Error('No se encuentra OpenRGB. Descárgalo de openrgb.org.');
  const args = ['--server', '--server-port', String(PORT), '--startminimized'];
  if (admin) {
    // Windows enseña su aviso de permisos: lo aceptas tú
    await new Promise((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '${args.join(' ')}' -Verb RunAs`], { windowsHide: true }, (e) => (e ? reject(new Error('No se abrió OpenRGB como administrador (¿cancelaste el aviso de Windows?).')) : resolve()))
    );
  } else {
    spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const c = await tryConnect();
    if (c) {
      // Esperar a que termine de detectar dispositivos (unos segundos)
      for (let j = 0; j < 12; j++) {
        if ((await c.getControllerCount().catch(() => 0)) > 0) break;
        await new Promise((r2) => setTimeout(r2, 1000));
      }
      return true;
    }
  }
  throw new Error('OpenRGB se abrió pero no responde. Revisa que su «SDK Server» esté activo.');
}

const TYPE = ['Placa base', 'Memoria RAM', 'Gráfica', 'Refrigeración', 'Tira de LED', 'Teclado', 'Ratón', 'Alfombrilla', 'Auriculares', 'Soporte de auriculares', 'Mando', 'Luz', 'Altavoz', 'Virtual', 'Almacenamiento', 'Caja', 'Micrófono', 'Accesorio', 'Teclado numérico', 'Portátil', 'Monitor'];
const hex = (c) => '#' + [c.red, c.green, c.blue].map((v) => (v || 0).toString(16).padStart(2, '0')).join('');
const rgb = (h) => {
  const n = parseInt(String(h || '#000000').slice(1), 16);
  return { red: (n >> 16) & 255, green: (n >> 8) & 255, blue: n & 255 };
};

function simplify(d, id) {
  return {
    id,
    name: d.name,
    vendor: d.vendor,
    type: TYPE[d.type] || 'Dispositivo',
    activeMode: d.activeMode,
    leds: d.leds?.length || 0,
    color: d.colors?.[0] ? hex(d.colors[0]) : '#000000',
    modes: d.modes.map((m) => ({
      id: m.id,
      name: m.name,
      perLed: m.flagList.includes('perLedColor'),
      modeColors: m.flagList.includes('modeSpecificColor') ? Math.max(1, m.colorMin || 1) : 0,
      random: m.flagList.includes('randomColor'),
      speed: m.flagList.includes('speed') ? { min: Math.min(m.speedMin, m.speedMax), max: Math.max(m.speedMin, m.speedMax), value: m.speed } : null,
      brightness: m.flagList.includes('brightness') ? { min: m.brightnessMin, max: m.brightnessMax, value: m.brightness } : null,
      colors: (m.colors || []).map(hex),
    })),
    zones: d.zones.map((z) => ({ id: z.id, name: z.name, leds: z.ledsCount, min: z.ledsMin, max: z.ledsMax, resizable: z.ledsMin !== z.ledsMax })),
  };
}

async function status(customExe) {
  const exe = findExe(customExe);
  const c = await tryConnect();
  if (!c) return { installed: !!exe, running: false, devices: [] };
  const n = await c.getControllerCount();
  const devices = [];
  for (let i = 0; i < n; i++) {
    try {
      devices.push(simplify(await c.getControllerData(i), i));
    } catch {}
  }
  return { installed: !!exe, running: true, devices };
}

// Modo que mejor encaja con un efecto, por nombre
const EFFECT_NAMES = {
  static: ['direct', 'static', 'custom'],
  breathing: ['breathing', 'pulse', 'breath'],
  rainbow: ['spectrum cycle', 'rainbow wave', 'rainbow', 'color cycle', 'color wave', 'cycle'],
  wave: ['color wave', 'wave', 'rainbow wave', 'flowing'],
  off: ['off'],
};
function pickMode(modes, effect) {
  for (const name of EFFECT_NAMES[effect] || []) {
    const m = modes.find((x) => x.name.toLowerCase() === name) || modes.find((x) => x.name.toLowerCase().includes(name));
    if (m) return m;
  }
  return null;
}

/** Aplica un modo y color a un dispositivo. */
async function apply(id, { mode, color, colors, speed, brightness }) {
  const c = await connect();
  const d = await c.getControllerData(id);
  const m = typeof mode === 'number' ? d.modes[mode] : d.modes.find((x) => x.name === mode) || d.modes[d.activeMode];
  if (!m) throw new Error('Ese modo no existe en este dispositivo.');
  const input = { id: m.id };
  if (speed != null && m.flagList.includes('speed')) input.speed = Number(speed);
  if (brightness != null && m.flagList.includes('brightness')) input.brightness = Number(brightness);
  if (m.flagList.includes('modeSpecificColor') && (colors || color)) {
    const list = (colors || [color]).map(rgb);
    input.colors = Array.from({ length: Math.max(m.colorMin || 1, list.length) }, (_, i) => list[i] || list[list.length - 1]);
  }
  await c.updateMode(id, input);
  if (m.flagList.includes('perLedColor') && color && d.leds.length) await c.updateLeds(id, Array(d.leds.length).fill(rgb(color)));
}

/** El mismo efecto y color en todos los dispositivos. */
async function applyAll({ effect, color, speed, brightness }) {
  const c = await connect();
  const n = await c.getControllerCount();
  const done = [];
  const skipped = [];
  for (let i = 0; i < n; i++) {
    const d = await c.getControllerData(i);
    let m = pickMode(d.modes, effect);
    let col = color;
    if (!m && effect === 'off') {
      m = pickMode(d.modes, 'static');
      col = '#000000';
    }
    if (!m) {
      skipped.push(d.name);
      continue;
    }
    try {
      await apply(i, { mode: m.id, color: col, speed, brightness });
      done.push(d.name);
    } catch {
      skipped.push(d.name);
    }
  }
  return { done, skipped };
}

async function resize(id, zone, leds) {
  const c = await connect();
  await c.resizeZone(id, zone, Math.max(0, Math.round(leds)));
}

async function rescan() {
  const c = await connect();
  c.requestRescan();
}

module.exports = { findExe, status, start, apply, applyAll, resize, rescan };

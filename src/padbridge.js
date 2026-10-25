'use strict';
// 1.35: puente del control. Los televisores TCL se quedan el R1 del control (lo tienen como
// tecla especial del sistema) antes de que llegue a Moonlight o Steam Link. Este puente lee
// el control en bruto en la tele (`getevent`, por ADB, antes de que el sistema lo interprete)
// y lo reproduce en un control de Xbox 360 virtual en este PC (ViGEmBus, por ViGEmClient.dll
// con koffi). Así el juego recibe todos los botones, R1 incluido, con el control en la tele.
const fs = require('fs');

// botones de Linux (evdev) → botones XUSB (Xbox 360)
const BTN = {
  0x130: 0x1000, // cruz → A
  0x131: 0x2000, // círculo → B
  0x133: 0x8000, // triángulo → Y
  0x134: 0x4000, // cuadrado → X
  0x136: 0x0100, // L1 → LB
  0x137: 0x0200, // R1 → RB
  0x13a: 0x0020, // Create → Back
  0x13b: 0x0010, // Options → Start
  0x13c: 0x0400, // PS → Guide
  0x13d: 0x0040, // L3
  0x13e: 0x0080, // R3
};
const stick = (v, invert) => {
  const x = Math.round(((v - 128) / 127.5) * 32767);
  return Math.max(-32768, Math.min(32767, invert ? -x : x));
};

/** El control virtual: un Xbox 360 en el PC, por ViGEmClient.dll. */
let VG = null; // la DLL y sus funciones se cargan una sola vez
function vigem(dll) {
  if (VG) return VG;
  const koffi = require('koffi');
  const lib = koffi.load(dll);
  koffi.struct('XUSB_REPORT_VT', { wButtons: 'uint16', bLeftTrigger: 'uint8', bRightTrigger: 'uint8', sThumbLX: 'int16', sThumbLY: 'int16', sThumbRX: 'int16', sThumbRY: 'int16' });
  VG = {
    alloc: lib.func('void* vigem_alloc()'),
    connect: lib.func('uint32 vigem_connect(void*)'),
    x360: lib.func('void* vigem_target_x360_alloc()'),
    add: lib.func('uint32 vigem_target_add(void*, void*)'),
    update: lib.func('uint32 vigem_target_x360_update(void*, void*, XUSB_REPORT_VT)'),
    remove: lib.func('uint32 vigem_target_remove(void*, void*)'),
    tfree: lib.func('void vigem_target_free(void*)'),
    disconnect: lib.func('void vigem_disconnect(void*)'),
    free: lib.func('void vigem_free(void*)'),
  };
  return VG;
}
function virtualPad(dll) {
  if (!fs.existsSync(dll)) throw new Error('Falta ViGEmClient.dll.');
  const f = vigem(dll);
  const OK = 0x20000000;
  const client = f.alloc();
  if (f.connect(client) !== OK) {
    f.free(client);
    throw new Error('El controlador ViGEmBus no está instalado o no responde.');
  }
  const pad = f.x360();
  if (f.add(client, pad) !== OK) {
    f.tfree(pad);
    f.disconnect(client);
    f.free(client);
    throw new Error('No pude crear el control virtual.');
  }
  const zero = { wButtons: 0, bLeftTrigger: 0, bRightTrigger: 0, sThumbLX: 0, sThumbLY: 0, sThumbRX: 0, sThumbRY: 0 };
  let closed = false;
  return {
    update: (b, lt, rt, lx, ly, rx, ry) => !closed && f.update(client, pad, { wButtons: b, bLeftTrigger: lt, bRightTrigger: rt, sThumbLX: lx, sThumbLY: ly, sThumbRX: rx, sThumbRY: ry }),
    release: () => !closed && f.update(client, pad, zero),
    close() {
      if (closed) return;
      closed = true;
      f.update(client, pad, zero);
      f.remove(client, pad);
      f.tfree(pad);
      f.disconnect(client);
      f.free(client);
    },
  };
}

/** Busca en la tele el control de juego (no el sensor de movimiento ni el touchpad). */
async function findPad(shell) {
  const out = await shell('getevent -lp');
  for (const b of out.split(/(?=add device \d+: )/)) {
    const dev = (b.match(/add device \d+: (\/dev\/input\/event\d+)/) || [])[1];
    const name = (b.match(/name:\s+"([^"]+)"/) || [])[1] || '';
    if (dev && /BTN_GAMEPAD|BTN_SOUTH/.test(b) && /ABS_RZ|ABS_RX/.test(b) && !/Motion|Touchpad|Sensor/i.test(name)) return { dev, name };
  }
  return null;
}

/**
 * Arranca el puente. deps: { host, key, adbShell, adbStream, dll, onState, onReport, log }
 * Devuelve { stop, state } y avisa por onState({ status, pad, error, events }).
 */
function start({ host, key, adbShell, adbStream, dll, onState, onReport, log = () => {} }) {
  let stopped = false;
  let vpad = null;
  let stream = null;
  let retry = null;
  const st = { status: 'starting', pad: null, error: null, events: 0 };
  const set = (p) => {
    Object.assign(st, p);
    onState?.({ ...st });
  };
  const shell = (cmd) => adbShell(host, key, cmd, { timeout: 15000 });

  async function connect() {
    if (stopped) return;
    try {
      const pad = await findPad(shell);
      if (stopped) return;
      if (!pad) {
        set({ status: 'waiting', pad: null, error: 'Enciende el control (vinculado a la tele).' });
        retry = setTimeout(connect, 5000);
        return;
      }
      if (!vpad) vpad = virtualPad(dll);
      const s = { buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0, hx: 0, hy: 0 };
      let rest = '';
      const send = () => {
        let b = s.buttons & ~0x000f;
        if (s.hy < 0) b |= 0x0001;
        if (s.hy > 0) b |= 0x0002;
        if (s.hx < 0) b |= 0x0004;
        if (s.hx > 0) b |= 0x0008;
        onReport?.(b, s);
        vpad?.update(b, s.lt, s.rt, s.lx, s.ly, s.rx, s.ry);
      };
      set({ status: 'on', pad: pad.name, error: null });
      log('puente: leyendo ' + pad.dev + ' (' + pad.name + ')');
      // getevent numérico: «tipo código valor» en hexadecimal, una línea por evento
      stream = adbStream(host, key, 'getevent ' + pad.dev, {
        onData: (txt) => {
          rest += txt;
          const lines = rest.split(/\r?\n/);
          rest = lines.pop();
          for (const line of lines) {
            const m = line.trim().match(/^([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{8})$/);
            if (!m) continue;
            const type = parseInt(m[1], 16);
            const code = parseInt(m[2], 16);
            let val = parseInt(m[3], 16);
            if (val > 0x7fffffff) val -= 0x100000000;
            if (type === 1 && BTN[code] != null) {
              if (val) s.buttons |= BTN[code];
              else s.buttons &= ~BTN[code];
            } else if (type === 3) {
              if (code === 0x00) s.lx = stick(val);
              else if (code === 0x01) s.ly = stick(val, true);
              else if (code === 0x03) s.rx = stick(val);
              else if (code === 0x04) s.ry = stick(val, true);
              else if (code === 0x02) s.lt = Math.max(0, Math.min(255, val));
              else if (code === 0x05) s.rt = Math.max(0, Math.min(255, val));
              else if (code === 0x10) s.hx = val;
              else if (code === 0x11) s.hy = val;
            } else if (type === 0 && code === 0) {
              st.events++;
              send();
            }
          }
        },
        onEnd: (why) => {
          stream = null;
          // suelta todo (que no quede un botón pegado) y vuelve a intentar
          vpad?.release();
          if (stopped) return;
          set({ status: 'waiting', error: why ? why.message : 'Se cortó la conexión con el control.' });
          retry = setTimeout(connect, 3000);
        },
      });
    } catch (e) {
      if (/ViGEm|control virtual/.test(e.message)) return set({ status: 'error', error: e.message });
      set({ status: 'waiting', error: e.message });
      // tele apagada o sin red: se reintenta con calma
      retry = setTimeout(connect, /ADB|conectar|ECONN|EHOST|ETIMEDOUT|tiempo/i.test(e.message + (e.code || '')) ? 15000 : 5000);
    }
  }
  connect();
  return {
    state: () => ({ ...st }),
    stop() {
      stopped = true;
      clearTimeout(retry);
      stream?.close();
      try {
        vpad?.close();
      } catch {}
      vpad = null;
      set({ status: 'off' });
    },
  };
}

module.exports = { start, findPad, BTN };

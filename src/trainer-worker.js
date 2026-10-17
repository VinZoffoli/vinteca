// Motor de trucos de ViperTeca (proceso aparte): busca valores en la memoria de
// un juego de un jugador, los cambia y los "congela". Es el mismo método que
// usan Cheat Engine o los trainers: leer y escribir la memoria del proceso con
// la API de Windows (ReadProcessMemory / WriteProcessMemory).
// Antes de engancharse comprueba que el juego no lleve antitrampas: en juegos
// en línea esto puede costar un baneo, así que en esos casos se niega.
const koffi = require('koffi');

const k32 = koffi.load('kernel32.dll');
const MBI = koffi.struct('MEMORY_BASIC_INFORMATION64', {
  BaseAddress: 'uint64_t',
  AllocationBase: 'uint64_t',
  AllocationProtect: 'uint32_t',
  PartitionId: 'uint16_t',
  pad1: 'uint16_t',
  RegionSize: 'uint64_t',
  State: 'uint32_t',
  Protect: 'uint32_t',
  Type: 'uint32_t',
  pad2: 'uint32_t',
});
const MODULEENTRY32W = koffi.struct('MODULEENTRY32W', {
  dwSize: 'uint32_t',
  th32ModuleID: 'uint32_t',
  th32ProcessID: 'uint32_t',
  GlblcntUsage: 'uint32_t',
  ProccntUsage: 'uint32_t',
  modBaseAddr: 'uint64_t',
  modBaseSize: 'uint32_t',
  hModule: 'uint64_t',
  szModule: koffi.array('char16_t', 256, 'String'),
  szExePath: koffi.array('char16_t', 260, 'String'),
});
const OpenProcess = k32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = k32.func('bool __stdcall CloseHandle(void* h)');
const VirtualQueryEx = k32.func('size_t __stdcall VirtualQueryEx(void* h, uint64_t addr, _Out_ MEMORY_BASIC_INFORMATION64* mbi, size_t len)');
const ReadProcessMemory = k32.func('bool __stdcall ReadProcessMemory(void* h, uint64_t addr, void* buf, size_t size, _Out_ size_t* read)');
const WriteProcessMemory = k32.func('bool __stdcall WriteProcessMemory(void* h, uint64_t addr, void* buf, size_t size, _Out_ size_t* written)');
const GetExitCodeProcess = k32.func('bool __stdcall GetExitCodeProcess(void* h, _Out_ uint32_t* code)');
const CreateToolhelp32Snapshot = k32.func('void* __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)');
const Module32FirstW = k32.func('bool __stdcall Module32FirstW(void* snap, _Inout_ MODULEENTRY32W* e)');
const Module32NextW = k32.func('bool __stdcall Module32NextW(void* snap, _Inout_ MODULEENTRY32W* e)');

const PROCESS_VM_READ = 0x10;
const PROCESS_VM_WRITE = 0x20;
const PROCESS_VM_OPERATION = 0x08;
const PROCESS_QUERY_INFORMATION = 0x400;
const MEM_COMMIT = 0x1000;
const WRITABLE = 0x04 | 0x08 | 0x40 | 0x80; // READWRITE, WRITECOPY, EXECUTE_READWRITE, EXECUTE_WRITECOPY
const PAGE_GUARD = 0x100;
const MAX_RESULTS = 4_000_000;
const CHUNK = 4 << 20;

// Módulos de antitrampas: si el juego carga alguno, no se toca
const ANTICHEAT = /easyanticheat|^eac(_|\.|launcher)|battleye|^beclient|bedaisy|mhyprot|hoyokprotect|^vgk|vanguard|gameguard|nprotect|xigncode|faceit|ricochet|^ace-(base|tac|safe)|anticheat|anti-cheat|equ8|punkbuster|pnkbstr|hackshield/i;

const TYPES = {
  int32: { size: 4, read: (b, o) => b.readInt32LE(o), write: (v) => { const b = Buffer.alloc(4); b.writeInt32LE(Math.trunc(v)); return b; }, arr: Int32Array },
  float: { size: 4, read: (b, o) => b.readFloatLE(o), write: (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }, arr: Float32Array },
  double: { size: 8, read: (b, o) => b.readDoubleLE(o), write: (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; }, arr: Float64Array },
  int16: { size: 2, read: (b, o) => b.readInt16LE(o), write: (v) => { const b = Buffer.alloc(2); b.writeInt16LE(Math.trunc(v)); return b; }, arr: Int16Array },
  byte: { size: 1, read: (b, o) => b.readUInt8(o), write: (v) => Buffer.from([Math.trunc(v) & 255]), arr: Uint8Array },
  int64: { size: 8, read: (b, o) => Number(b.readBigInt64LE(o)), write: (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(Math.trunc(v))); return b; }, arr: null },
};

let h = null;
let pid = 0;
let modules = [];
let scan = null; // { type, addrs: Float64Array, prev: Float64Array, count }
const frozen = new Map(); // key -> { addr, type, value }
let freezeTimer = null;

const send = (m) => process.parentPort?.postMessage(m);

function listModules(p) {
  const snap = CreateToolhelp32Snapshot(0x8 | 0x10, p);
  const out = [];
  if (!snap || koffi.address(snap) === 0xffffffffffffffffn) return out;
  try {
    const e = { dwSize: koffi.sizeof(MODULEENTRY32W) };
    let ok = Module32FirstW(snap, e);
    while (ok) {
      out.push({ name: e.szModule, base: Number(e.modBaseAddr), size: e.modBaseSize, path: e.szExePath });
      ok = Module32NextW(snap, e);
    }
  } finally {
    CloseHandle(snap);
  }
  return out;
}

function alive() {
  if (!h) return false;
  const code = [0];
  GetExitCodeProcess(h, code);
  return code[0] === 259; // STILL_ACTIVE
}

function readMem(addr, size) {
  const buf = Buffer.alloc(size);
  const got = [0];
  const ok = ReadProcessMemory(h, BigInt(Math.floor(addr)), buf, size, got);
  return ok ? buf.subarray(0, Number(got[0])) : null;
}

function writeMem(addr, buf) {
  const wrote = [0];
  return WriteProcessMemory(h, BigInt(Math.floor(addr)), buf, buf.length, wrote);
}

function regions() {
  const out = [];
  const m = {};
  let addr = 0x10000;
  const end = 0x7fffffff0000;
  while (addr < end) {
    if (!VirtualQueryEx(h, BigInt(addr), m, koffi.sizeof(MBI))) break;
    const base = Number(m.BaseAddress);
    const size = Number(m.RegionSize);
    if (m.State === MEM_COMMIT && m.Protect & WRITABLE && !(m.Protect & PAGE_GUARD)) out.push({ base, size });
    const next = base + size;
    if (next <= addr) break;
    addr = next;
  }
  return out;
}

const close = (a, b, type) => (type === 'float' || type === 'double' ? Math.abs(a - b) < (Math.abs(b) < 10 ? 0.01 : 0.5) : a === b);

function attach(p) {
  detach();
  modules = listModules(p);
  const bad = modules.find((m) => ANTICHEAT.test(m.name));
  if (bad) throw new Error(`Este juego usa un sistema antitrampas (${bad.name}). Por seguridad ViperTeca no lo toca: podrías perder tu cuenta.`);
  h = OpenProcess(PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION | PROCESS_QUERY_INFORMATION, false, p);
  if (!h) throw new Error('No se pudo abrir el juego. Si el juego se ejecuta como administrador, abre ViperTeca también como administrador.');
  pid = p;
  return { pid, modules: modules.length, main: modules[0]?.name || null };
}

function detach() {
  frozen.clear();
  if (freezeTimer) clearInterval(freezeTimer);
  freezeTimer = null;
  scan = null;
  if (h) CloseHandle(h);
  h = null;
  pid = 0;
}

function firstScan({ type, value }) {
  const T = TYPES[type];
  if (!T) throw new Error('Tipo de valor desconocido.');
  const target = Number(value);
  if (!Number.isFinite(target)) throw new Error('Escribe un número.');
  let addrs = new Float64Array(1 << 16);
  let prev = new Float64Array(1 << 16);
  let count = 0;
  const grow = () => {
    const a = new Float64Array(addrs.length * 2);
    a.set(addrs);
    addrs = a;
    const p = new Float64Array(prev.length * 2);
    p.set(prev);
    prev = p;
  };
  const regs = regions();
  const total = regs.reduce((s, r) => s + r.size, 0);
  let done = 0;
  let lastReport = Date.now();
  for (const r of regs) {
    for (let off = 0; off < r.size; off += CHUNK) {
      const len = Math.min(CHUNK, r.size - off);
      const buf = readMem(r.base + off, len);
      done += len;
      if (!buf) continue;
      const step = T.size;
      // Solo direcciones alineadas a su tamaño (así guardan los juegos sus valores)
      if (T.arr) {
        const view = new T.arr(buf.buffer, buf.byteOffset, Math.floor(buf.length / step));
        for (let i = 0; i < view.length; i++) {
          if (close(view[i], target, type)) {
            if (count >= addrs.length) {
              if (count >= MAX_RESULTS) break;
              grow();
            }
            addrs[count] = r.base + off + i * step;
            prev[count++] = view[i];
          }
        }
      } else {
        for (let o = 0; o + step <= buf.length; o += step) {
          const v = T.read(buf, o);
          if (close(v, target, type) && count < MAX_RESULTS) {
            if (count >= addrs.length) grow();
            addrs[count] = r.base + off + o;
            prev[count++] = v;
          }
        }
      }
      if (Date.now() - lastReport > 300) {
        lastReport = Date.now();
        send({ progress: Math.round((done / total) * 100) });
      }
    }
  }
  scan = { type, addrs: addrs.subarray(0, count), prev: prev.subarray(0, count), count };
  return { count, capped: count >= MAX_RESULTS };
}

/** Relee las direcciones agrupando por página (mucho más rápido que una a una). */
function readMany(addrs, type) {
  const T = TYPES[type];
  const out = new Float64Array(addrs.length).fill(NaN);
  let page = -1;
  let buf = null;
  for (let i = 0; i < addrs.length; i++) {
    const a = addrs[i];
    const p = Math.floor(a / 4096);
    if (p !== page) {
      page = p;
      buf = readMem(p * 4096, 4096);
    }
    const o = a - p * 4096;
    if (buf && o + T.size <= buf.length) out[i] = T.read(buf, o);
    else {
      const b = readMem(a, T.size);
      if (b && b.length === T.size) out[i] = T.read(b, 0);
    }
  }
  return out;
}

function nextScan({ mode, value }) {
  if (!scan) throw new Error('Haz primero una búsqueda.');
  const target = Number(value);
  if (mode === 'exact' && !Number.isFinite(target)) throw new Error('Escribe un número.');
  const now = readMany(scan.addrs, scan.type);
  const keepA = [];
  const keepP = [];
  for (let i = 0; i < scan.count; i++) {
    const v = now[i];
    const p = scan.prev[i];
    if (Number.isNaN(v)) continue;
    let ok;
    if (mode === 'exact') ok = close(v, target, scan.type);
    else if (mode === 'increased') ok = v > p;
    else if (mode === 'decreased') ok = v < p;
    else if (mode === 'changed') ok = v !== p;
    else if (mode === 'unchanged') ok = v === p;
    else ok = false;
    if (ok) {
      keepA.push(scan.addrs[i]);
      keepP.push(v);
    }
  }
  scan = { type: scan.type, addrs: Float64Array.from(keepA), prev: Float64Array.from(keepP), count: keepA.length };
  return { count: scan.count };
}

function where(addr) {
  const m = modules.find((x) => addr >= x.base && addr < x.base + x.size);
  return m ? { module: m.name, offset: addr - m.base } : null;
}

function results(limit = 200) {
  if (!scan) return { count: 0, items: [] };
  const n = Math.min(limit, scan.count);
  const addrs = scan.addrs.subarray(0, n);
  const vals = readMany(addrs, scan.type);
  const items = [];
  for (let i = 0; i < n; i++) items.push({ addr: addrs[i], value: vals[i], prev: scan.prev[i], where: where(addrs[i]) });
  return { count: scan.count, type: scan.type, items };
}

/** Dirección de una entrada guardada: absoluta, módulo+desplazamiento o puntero. */
function resolve(entry) {
  let addr;
  if (entry.module) {
    const m = modules.find((x) => x.name.toLowerCase() === entry.module.toLowerCase());
    if (!m) throw new Error(`El juego no tiene el módulo ${entry.module}.`);
    addr = m.base + Number(entry.offset || 0);
  } else addr = Number(entry.addr);
  // Cadena de punteros (como en las tablas de Cheat Engine)
  for (const off of entry.pointer || []) {
    const b = readMem(addr, 8);
    if (!b || b.length < 8) throw new Error('El puntero no lleva a ningún sitio (¿has cargado la partida?).');
    addr = Number(b.readBigUInt64LE(0)) + Number(off);
  }
  return addr;
}

function readValues(entries) {
  return entries.map((e) => {
    try {
      const a = resolve(e);
      const b = readMem(a, TYPES[e.type].size);
      return { ok: true, addr: a, value: b && b.length === TYPES[e.type].size ? TYPES[e.type].read(b, 0) : null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

function setValue(entry, value) {
  const a = resolve(entry);
  if (!writeMem(a, TYPES[entry.type].write(Number(value)))) throw new Error('El juego no deja escribir en esa dirección.');
  return true;
}

function freeze(key, entry, value, on) {
  if (!on) frozen.delete(key);
  else frozen.set(key, { entry, value: Number(value) });
  if (frozen.size && !freezeTimer)
    freezeTimer = setInterval(() => {
      if (!alive()) {
        send({ event: 'exited' });
        return detach();
      }
      for (const f of frozen.values()) {
        try {
          writeMem(resolve(f.entry), TYPES[f.entry.type].write(f.value));
        } catch {}
      }
    }, 100);
  if (!frozen.size && freezeTimer) {
    clearInterval(freezeTimer);
    freezeTimer = null;
  }
  return [...frozen.keys()];
}

const handlers = {
  attach: (a) => attach(a.pid),
  detach: () => detach(),
  firstScan: (a) => firstScan(a),
  nextScan: (a) => nextScan(a),
  results: (a) => results(a.limit),
  read: (a) => readValues(a.entries),
  set: (a) => setValue(a.entry, a.value),
  freeze: (a) => freeze(a.key, a.entry, a.value, a.on),
  where: (a) => where(a.addr),
  debug: () => {
    const m = {};
    const n = VirtualQueryEx(h, BigInt(0x10000), m, koffi.sizeof(MBI));
    const regs = regions();
    const first = regs[0];
    const buf = first ? readMem(first.base, 64) : null;
    return { vq: Number(n), mbi: { base: String(m.BaseAddress), size: String(m.RegionSize), state: m.State, protect: m.Protect }, regions: regs.length, total: regs.reduce((s, r) => s + r.size, 0), read: buf ? buf.length : null, sizeofMbi: koffi.sizeof(MBI) };
  },
  status: () => ({ attached: !!h && alive(), pid, scan: scan ? { count: scan.count, type: scan.type } : null, frozen: [...frozen.keys()] }),
};

if (process.parentPort) process.parentPort.on('message', (e) => {
  const { id, cmd, args } = e.data || {};
  try {
    if (cmd !== 'attach' && cmd !== 'status' && cmd !== 'detach' && !alive()) throw new Error('El juego se cerró. Vuelve a elegirlo.');
    const result = handlers[cmd](args || {});
    send({ id, ok: true, result });
  } catch (err) {
    send({ id, ok: false, error: err.message });
  }
});

module.exports = { handlers };

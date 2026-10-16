// Uso de CPU, RAM y GPU para el panel de rendimiento del modo enfoque.
// La GPU se lee de los contadores de rendimiento de Windows (los mismos que usa
// el Administrador de tareas) llamando a pdh.dll con koffi.
const os = require('os');
const koffi = require('koffi');

const pdh = koffi.load('pdh.dll');
const k32 = koffi.load('kernel32.dll');
const PdhOpenQueryW = pdh.func('uint32_t __stdcall PdhOpenQueryW(void* src, uintptr_t user, _Out_ void** query)');
const PdhAddEnglishCounterW = pdh.func('uint32_t __stdcall PdhAddEnglishCounterW(void* query, const char16_t* path, uintptr_t user, _Out_ void** counter)');
const PdhCollectQueryData = pdh.func('uint32_t __stdcall PdhCollectQueryData(void* query)');
const PdhGetFormattedCounterArrayW = pdh.func(
  'uint32_t __stdcall PdhGetFormattedCounterArrayW(void* counter, uint32_t fmt, _Inout_ uint32_t* size, _Out_ uint32_t* count, uint8_t* items)'
);
const PdhCloseQuery = pdh.func('uint32_t __stdcall PdhCloseQuery(void* query)');
const OpenProcess = k32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = k32.func('bool __stdcall CloseHandle(void* h)');
const K32GetProcessMemoryInfo = k32.func('bool __stdcall K32GetProcessMemoryInfo(void* h, _Out_ uint8_t* counters, uint32_t cb)');

const PDH_FMT_DOUBLE = 0x200;
const PDH_MORE_DATA = 0x800007d2;
const ITEM_SIZE = 24; // { wchar_t* name; { DWORD status; double value } } en x64

function sumCounter(counter) {
  const size = [0];
  const count = [0];
  let rc = PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, size, count, null);
  if (rc !== PDH_MORE_DATA || !size[0]) return null;
  const buf = Buffer.alloc(size[0]);
  rc = PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, size, count, buf);
  if (rc !== 0) return null;
  let total = 0;
  for (let i = 0; i < count[0]; i++) {
    const status = buf.readUInt32LE(i * ITEM_SIZE + 8);
    if (status === 0 || status === 1) total += buf.readDoubleLE(i * ITEM_SIZE + 16);
  }
  return total;
}

class Perf {
  constructor() {
    this.query = null;
    this.gpu = null;
    this.vram = null;
    this.lastCpu = null;
    try {
      const q = [null];
      if (PdhOpenQueryW(null, 0, q) === 0) {
        this.query = q[0];
        const c1 = [null];
        const c2 = [null];
        if (PdhAddEnglishCounterW(this.query, '\\GPU Engine(*engtype_3D)\\Utilization Percentage', 0, c1) === 0) this.gpu = c1[0];
        if (PdhAddEnglishCounterW(this.query, '\\GPU Adapter Memory(*)\\Dedicated Usage', 0, c2) === 0) this.vram = c2[0];
        PdhCollectQueryData(this.query);
      }
    } catch {
      this.query = null;
    }
    this.cpuSample();
  }

  cpuSample() {
    const t = os.cpus().reduce(
      (acc, c) => {
        const tot = Object.values(c.times).reduce((s, v) => s + v, 0);
        return { idle: acc.idle + c.times.idle, total: acc.total + tot };
      },
      { idle: 0, total: 0 }
    );
    const prev = this.lastCpu;
    this.lastCpu = t;
    if (!prev) return null;
    const dt = t.total - prev.total;
    return dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - (t.idle - prev.idle) / dt))) : null;
  }

  /** Memoria (working set) de un conjunto de procesos, en bytes. */
  processesRam(pids) {
    let total = 0;
    for (const pid of pids || []) {
      const h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
      if (!h) continue;
      try {
        const b = Buffer.alloc(72);
        b.writeUInt32LE(72, 0);
        if (K32GetProcessMemoryInfo(h, b, 72)) total += Number(b.readBigUInt64LE(16)); // WorkingSetSize
      } finally {
        CloseHandle(h);
      }
    }
    return total;
  }

  sample(gamePids) {
    let gpu = null;
    let vram = null;
    if (this.query && PdhCollectQueryData(this.query) === 0) {
      gpu = this.gpu ? sumCounter(this.gpu) : null;
      vram = this.vram ? sumCounter(this.vram) : null;
    }
    return {
      cpu: this.cpuSample(),
      gpu: gpu == null ? null : Math.min(100, gpu),
      vram,
      ramUsed: os.totalmem() - os.freemem(),
      ramTotal: os.totalmem(),
      gameRam: gamePids?.length ? this.processesRam(gamePids) : null,
      at: Date.now(),
    };
  }

  close() {
    if (this.query) PdhCloseQuery(this.query);
    this.query = null;
  }
}

module.exports = { Perf };

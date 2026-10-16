// Llamadas directas a la API de Windows (kernel32) con koffi, sin abrir
// procesos auxiliares: listar procesos, leer su ruta y cambiar su prioridad,
// su "modo eficiencia" (EcoQoS) y la prioridad de su memoria.
// Solo afecta a procesos de tu propio usuario: los del sistema no se pueden
// abrir sin ser administrador y simplemente se ignoran.
const koffi = require('koffi');

const k32 = koffi.load('kernel32.dll');

const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
  dwSize: 'uint32_t',
  cntUsage: 'uint32_t',
  th32ProcessID: 'uint32_t',
  th32DefaultHeapID: 'uintptr_t',
  th32ModuleID: 'uint32_t',
  cntThreads: 'uint32_t',
  th32ParentProcessID: 'uint32_t',
  pcPriClassBase: 'int32_t',
  dwFlags: 'uint32_t',
  szExeFile: koffi.array('char16_t', 260, 'String'),
});

const CreateToolhelp32Snapshot = k32.func('void* __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)');
const Process32FirstW = k32.func('bool __stdcall Process32FirstW(void* snap, _Inout_ PROCESSENTRY32W* entry)');
const Process32NextW = k32.func('bool __stdcall Process32NextW(void* snap, _Inout_ PROCESSENTRY32W* entry)');
const OpenProcess = k32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = k32.func('bool __stdcall CloseHandle(void* h)');
const QueryFullProcessImageNameW = k32.func(
  'bool __stdcall QueryFullProcessImageNameW(void* h, uint32_t flags, _Out_ uint8_t* buf, _Inout_ uint32_t* size)'
);
const GetPriorityClass = k32.func('uint32_t __stdcall GetPriorityClass(void* h)');
const SetPriorityClass = k32.func('bool __stdcall SetPriorityClass(void* h, uint32_t cls)');
const GetProcessInformation = k32.func('bool __stdcall GetProcessInformation(void* h, int cls, _Out_ uint8_t* info, uint32_t size)');
const SetProcessInformation = k32.func('bool __stdcall SetProcessInformation(void* h, int cls, uint8_t* info, uint32_t size)');

const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_SET_INFORMATION = 0x0200;
const ProcessMemoryPriority = 0;
const ProcessPowerThrottling = 4;
const POWER_THROTTLING_EXECUTION_SPEED = 0x1;

const PRIORITY = { idle: 0x40, belowNormal: 0x4000, normal: 0x20, aboveNormal: 0x8000, high: 0x80 };
const MEMORY_PRIORITY = { veryLow: 1, low: 2, medium: 3, belowNormal: 4, normal: 5 };

function isInvalid(h) {
  if (!h) return true;
  const a = koffi.address(h);
  return a === 0n || a === 0xffffffffffffffffn;
}

/** Todos los procesos: [{ pid, ppid, name }] */
function listProcesses() {
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (isInvalid(snap)) return [];
  const out = [];
  try {
    const e = { dwSize: koffi.sizeof(PROCESSENTRY32W) };
    let ok = Process32FirstW(snap, e);
    while (ok) {
      out.push({ pid: e.th32ProcessID, ppid: e.th32ParentProcessID, name: e.szExeFile });
      ok = Process32NextW(snap, e);
    }
  } finally {
    CloseHandle(snap);
  }
  return out;
}

function withProcess(pid, access, fn) {
  const h = OpenProcess(access, false, pid);
  if (!h) return null;
  try {
    return fn(h);
  } finally {
    CloseHandle(h);
  }
}

/** Ruta completa del ejecutable, o null si no se puede abrir el proceso. */
function imagePath(pid) {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (h) => {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return null;
    return buf.toString('utf16le', 0, size[0] * 2);
  });
}

function readState(h) {
  const prio = GetPriorityClass(h);
  const mem = Buffer.alloc(4);
  const memPrio = GetProcessInformation(h, ProcessMemoryPriority, mem, 4) ? mem.readUInt32LE(0) : MEMORY_PRIORITY.normal;
  return { prio, memPrio };
}

function setThrottle(h, mode) {
  // mode: 'on' = modo eficiencia, 'off' = nunca ahorrar, 'auto' = lo decide Windows
  const b = Buffer.alloc(12);
  b.writeUInt32LE(1, 0); // Version
  b.writeUInt32LE(mode === 'auto' ? 0 : POWER_THROTTLING_EXECUTION_SPEED, 4); // ControlMask
  b.writeUInt32LE(mode === 'on' ? POWER_THROTTLING_EXECUTION_SPEED : 0, 8); // StateMask
  return SetProcessInformation(h, ProcessPowerThrottling, b, 12);
}

function setMemPriority(h, value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value, 0);
  return SetProcessInformation(h, ProcessMemoryPriority, b, 4);
}

/**
 * Aplica un perfil a un proceso y devuelve su estado anterior (para restaurarlo),
 * o null si Windows no deja tocarlo (procesos del sistema, antitrampas...).
 */
function applyProfile(pid, profile) {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION, (h) => {
    const before = readState(h);
    if (!before.prio) return null;
    let ok;
    if (profile === 'boost') {
      ok = SetPriorityClass(h, PRIORITY.high);
      setThrottle(h, 'off');
    } else {
      ok = SetPriorityClass(h, PRIORITY.belowNormal);
      setThrottle(h, 'on');
      setMemPriority(h, MEMORY_PRIORITY.low);
    }
    return ok ? before : null;
  });
}

function restoreProfile(pid, before) {
  return !!withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION, (h) => {
    SetPriorityClass(h, before.prio || PRIORITY.normal);
    setThrottle(h, 'auto');
    setMemPriority(h, before.memPrio || MEMORY_PRIORITY.normal);
    return true;
  });
}

function priorityOf(pid) {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (h) => readState(h));
}

module.exports = { listProcesses, imagePath, applyProfile, restoreProfile, priorityOf, PRIORITY };

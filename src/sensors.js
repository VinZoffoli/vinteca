// Sensores del PC: uso de CPU, GPU y RAM siempre; temperaturas y ventiladores
// con LibreHardwareMonitor (programa gratuito) abierto con su "Remote Web
// Server" activado. Windows no da las temperaturas reales a los programas
// normales, por eso hace falta.
const os = require('os');
const { spawn } = require('child_process');

const LHM_URL = 'http://127.0.0.1:8085/data.json';

// ---- CPU y RAM (Node) ----
let prevCpu = null;
function cpuLoad() {
  const t = os.cpus().reduce((a, c) => {
    const tot = Object.values(c.times).reduce((x, y) => x + y, 0);
    return { idle: a.idle + c.times.idle, total: a.total + tot };
  }, { idle: 0, total: 0 });
  const p = prevCpu;
  prevCpu = t;
  if (!p || t.total === p.total) return null;
  return Math.max(0, Math.min(100, 100 * (1 - (t.idle - p.idle) / (t.total - p.total))));
}

// ---- GPU (contador de Windows, con un PowerShell que vive mientras se mira) ----
let gpuProc = null;
let gpuLoad = null;
let gpuUsers = 0;
function startGpu() {
  if (gpuProc) return;
  const script = "$ErrorActionPreference='SilentlyContinue'; while ($true) { $s = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage').CounterSamples | Measure-Object CookedValue -Sum; [Console]::Out.WriteLine([math]::Round($s.Sum,1)); Start-Sleep -Milliseconds 1500 }";
  gpuProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  gpuProc.stdout.on('data', (d) => {
    const v = parseFloat(String(d).trim().split(/\s+/).pop().replace(',', '.'));
    if (Number.isFinite(v)) gpuLoad = Math.min(100, v);
  });
  gpuProc.on('exit', () => {
    gpuProc = null;
  });
}
function stopGpu() {
  if (gpuProc) gpuProc.kill();
  gpuProc = null;
  gpuLoad = null;
}
/** Quien muestra la GPU en pantalla avisa con want(true) y suelta con want(false). */
function want(on) {
  gpuUsers = Math.max(0, gpuUsers + (on ? 1 : -1));
  if (gpuUsers) startGpu();
  else stopGpu();
}

// ---- LibreHardwareMonitor ----
const num = (s) => {
  const m = String(s || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
function walk(node, path, out) {
  const p = node.Text ? [...path, node.Text] : path;
  if (node.Value && node.SensorId) out.push({ path: p, name: node.Text, type: node.Type || '', value: num(node.Value), raw: node.Value, id: node.SensorId });
  for (const c of node.Children || []) walk(c, p, out);
  return out;
}
async function lhm() {
  try {
    const r = await fetch(LHM_URL, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    return walk(await r.json(), [], []);
  } catch {
    return null;
  }
}
const isTemp = (s) => s.type === 'Temperature' || /°C/.test(s.raw);
const isFan = (s) => s.type === 'Fan' || /RPM/i.test(s.raw);
const isLoad = (s) => s.type === 'Load' || /%/.test(s.raw);
function pick(list, test, prefer) {
  const c = list.filter(test);
  for (const re of prefer) {
    const f = c.find((s) => re.test(s.name));
    if (f) return f.value;
  }
  return null;
}

let last = null;
let lhmSeen = false;
async function read() {
  const sensors = await lhm();
  const out = { at: Date.now(), source: sensors ? 'lhm' : 'basic', cpu: {}, gpu: {}, ram: {}, fans: [] };
  const total = os.totalmem();
  out.ram = { usedGb: (total - os.freemem()) / 1073741824, totalGb: total / 1073741824, load: 100 * (1 - os.freemem() / total) };
  out.cpu.load = cpuLoad();
  out.gpu.load = gpuLoad;
  if (sensors) {
    lhmSeen = true;
    const cpu = sensors.filter((s) => /\/cpu\//.test(s.id) || /amdcpu|intelcpu/i.test(s.id));
    const gpu = sensors.filter((s) => /gpu/i.test(s.id));
    out.cpu.temp = pick(cpu, isTemp, [/Tctl|Tdie/i, /Package/i, /Core \(Tctl/i, /Core/i, /./]);
    out.cpu.load = pick(cpu, isLoad, [/CPU Total/i]) ?? out.cpu.load;
    out.gpu.temp = pick(gpu, isTemp, [/GPU Core/i, /Core/i, /./]);
    out.gpu.hotspot = pick(gpu, isTemp, [/Hot ?Spot/i, /Junction/i]);
    out.gpu.load = pick(gpu, isLoad, [/GPU Core/i, /D3D 3D/i]) ?? out.gpu.load;
    out.gpu.vramLoad = pick(gpu, isLoad, [/Memory/i]);
    const fans = sensors.filter((s) => isFan(s) && s.value != null);
    out.fans = fans.map((f) => ({ name: f.name, rpm: Math.round(f.value), where: f.path[f.path.length - 3] || '' }));
  }
  last = out;
  return out;
}

// ---- avisos de temperatura ----
const hot = { cpu: 0, gpu: 0 };
const lastAlert = { cpu: 0, gpu: 0 };
/** Devuelve los avisos que tocan ahora (3 lecturas seguidas por encima del límite). */
function checkAlerts(s, limits) {
  const out = [];
  for (const k of ['cpu', 'gpu']) {
    const t = s[k]?.temp;
    const lim = limits[k];
    if (t == null || !lim) continue;
    hot[k] = t >= lim ? hot[k] + 1 : 0;
    if (hot[k] >= 3 && Date.now() - lastAlert[k] > 15 * 60000) {
      lastAlert[k] = Date.now();
      out.push({ part: k === 'cpu' ? 'La CPU' : 'La GPU', temp: Math.round(t), limit: lim });
    }
  }
  return out;
}

module.exports = { read, want, checkAlerts, last: () => last, lhmSeen: () => lhmSeen, LHM_URL };

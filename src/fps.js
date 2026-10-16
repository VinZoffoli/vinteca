// FPS del juego con PresentMon (herramienta gratuita de Intel, licencia MIT),
// que lee los eventos de presentación de fotogramas de Windows. Funciona sin
// administrador si tu usuario está en el grupo "Usuarios del registro de
// rendimiento" (el instalador no lo cambia).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const SESSION = 'BibliotecaJuegosFPS';
const WINDOW_S = 1; // FPS del último segundo
const LOW_WINDOW_S = 10; // "1 % más bajo" de los últimos 10 segundos

class FpsMeter {
  constructor(exePath) {
    this.exe = exePath;
    this.child = null;
    this.frames = []; // { t, ms, pid }
    this.error = null;
  }

  available() {
    return !!this.exe && fs.existsSync(this.exe);
  }

  /** Empieza a medir los procesos con esos nombres de ejecutable. */
  start(processNames) {
    this.stop();
    this.error = null;
    if (!this.available()) {
      this.error = 'Falta PresentMon.';
      return;
    }
    const names = [...new Set(processNames.filter(Boolean))];
    if (!names.length) return;
    const args = ['--output_stdout', '--no_console_stats', '--v1_metrics', '--session_name', SESSION, '--stop_existing_session'];
    for (const n of names) args.push('--process_name', n);
    try {
      this.child = spawn(this.exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.error = e.message;
      return;
    }
    let header = null;
    let colT;
    let colMs;
    let colPid;
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      const c = line.split(',');
      if (!header) {
        header = c;
        colT = c.indexOf('TimeInSeconds');
        colMs = c.indexOf('msBetweenPresents');
        colPid = c.indexOf('ProcessID');
        return;
      }
      const t = Number(c[colT]);
      const ms = Number(c[colMs]);
      if (!(t >= 0) || !(ms > 0)) return;
      this.frames.push({ t, ms, pid: c[colPid] });
      this.lastFrameAt = Date.now();
      // Se guardan solo los últimos segundos
      const cut = t - LOW_WINDOW_S;
      if (this.frames.length > 4000 || this.frames[0].t < cut) this.frames = this.frames.filter((f) => f.t >= cut);
    });
    let errText = '';
    this.child.stderr.on('data', (d) => (errText += d.toString()));
    this.child.on('exit', (code) => {
      if (code && !this.error) this.error = /privilege|access/i.test(errText) ? 'PresentMon no tiene permiso para medir: tu usuario debe estar en el grupo "Usuarios del registro de rendimiento".' : `PresentMon se cerró (código ${code}).`;
      this.child = null;
    });
  }

  stats() {
    // Sin fotogramas en 3 s (juego en pausa o minimizado): no se inventa un número
    if (!this.frames.length || Date.now() - (this.lastFrameAt || 0) > 3000) return { fps: null, low1: null, error: this.error };
    const last = this.frames[this.frames.length - 1].t;
    // Si hay varias ventanas (launcher + juego), manda la que más fotogramas pinta
    const recent = this.frames.filter((f) => f.t >= last - WINDOW_S);
    const byPid = new Map();
    for (const f of recent) byPid.set(f.pid, (byPid.get(f.pid) || 0) + 1);
    const pid = [...byPid].sort((a, b) => b[1] - a[1])[0]?.[0];
    const win = recent.filter((f) => f.pid === pid);
    const avgMs = win.reduce((s, f) => s + f.ms, 0) / Math.max(1, win.length);
    const all = this.frames.filter((f) => f.pid === pid).map((f) => f.ms).sort((a, b) => a - b);
    const p99 = all[Math.min(all.length - 1, Math.floor(all.length * 0.99))];
    return { fps: avgMs ? 1000 / avgMs : null, low1: p99 ? 1000 / p99 : null, error: this.error };
  }

  stop() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
    }
    this.child = null;
    this.frames = [];
  }
}

/** Ruta de PresentMon: dentro de la app instalada o en build/tools durante el desarrollo. */
function presentMonPath(app) {
  return app.isPackaged ? path.join(process.resourcesPath, 'tools', 'PresentMon.exe') : path.join(__dirname, '..', 'build', 'tools', 'PresentMon.exe');
}

module.exports = { FpsMeter, presentMonPath };

// Registro de sesiones de juego: mientras la app está abierta, cada 30 s mira
// qué juego instalado se está ejecutando y apunta inicio y fin. Así hay horas
// también para Epic (que no las da) y detalle por día para Steam.
const win32 = require('./win32');

const SCAN_MS = 30000;
const MIN_SESSION_MS = 60000; // menos de 1 minuto no cuenta
const MAX_SESSIONS = 20000;

const normPath = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

class SessionTracker {
  /**
   * @param {object} o
   * @param {(s: object) => object} [o.getExtra] datos que se añaden a la sesión al cerrarla (FPS, logros)
   * @param {(s: object) => void} [o.onEnd] se llama con cada sesión terminada (ya guardada)
   */
  constructor({ read, write, getGames, onChange, getExtra, onEnd }) {
    Object.assign(this, { read, write, getGames, onChange, getExtra, onEnd });
    this.current = null; // { id, title, store, start, lastSeen }
    this.timer = null;
    this.pathCache = new Map(); // "pid:nombre" -> ruta del ejecutable
  }

  start() {
    this.recover();
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_MS);
  }

  /** Si la app se cerró de golpe, la sesión abierta termina en su última comprobación. */
  recover() {
    const cur = this.read('session-current.json', null);
    if (cur && cur.start && cur.lastSeen) this.save({ ...cur, end: cur.lastSeen });
    this.write('session-current.json', null);
  }

  runningGame() {
    const games = this.getGames()
      .filter((g) => g.installed && g.installPath && g.kind !== 'tool')
      .map((g) => ({ g, root: normPath(g.installPath) + '\\' }));
    if (!games.length) return null;
    const procs = win32.listProcesses();
    const alive = new Set();
    for (const p of procs) {
      if (p.pid <= 4) continue;
      const key = p.pid + ":" + p.name; // el nombre evita confundir un PID reutilizado
      alive.add(key);
      let file = this.pathCache.get(key);
      if (file === undefined) {
        file = normPath(win32.imagePath(p.pid) || '');
        this.pathCache.set(key, file);
      }
      if (!file) continue;
      const hit = games.find((x) => file.startsWith(x.root));
      if (hit) return hit.g;
    }
    for (const key of this.pathCache.keys()) if (!alive.has(key)) this.pathCache.delete(key);
    return null;
  }

  scan() {
    let game = null;
    try {
      game = this.runningGame();
    } catch {
      return;
    }
    const now = Date.now();
    if (this.current && (!game || game.id !== this.current.id)) this.close(this.current.lastSeen);
    if (game && !this.current) {
      this.current = { id: game.id, title: game.title, store: game.store, start: now, lastSeen: now };
      this.onChange?.(this.current);
    } else if (game && this.current) {
      this.current.lastSeen = now;
    }
    this.write('session-current.json', this.current);
  }

  close(end) {
    if (!this.current) return;
    const s = { ...this.current, end: end || Date.now() };
    Object.assign(s, this.getExtra?.(s) || {});
    if (this.save(s)) this.onEnd?.(s);
    this.current = null;
    this.write('session-current.json', null);
    this.onChange?.(null);
  }

  save(s) {
    if (s.end - s.start < MIN_SESSION_MS) return false;
    const list = this.read('sessions.json', []);
    const row = { id: s.id, title: s.title, store: s.store, start: s.start, end: s.end };
    if (s.fps) row.fps = Math.round(s.fps * 10) / 10;
    if (s.low1) row.low1 = Math.round(s.low1 * 10) / 10;
    if (s.unlocks) row.unlocks = s.unlocks;
    list.push(row);
    this.write('sessions.json', list.slice(-MAX_SESSIONS));
    return true;
  }

  /** Minutos jugados hoy (sesiones guardadas + la que está en marcha). */
  todayMinutes() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const from = d.getTime();
    let ms = 0;
    for (const s of this.read('sessions.json', [])) if (s.end > from) ms += s.end - Math.max(s.start, from);
    if (this.current) ms += Date.now() - Math.max(this.current.start, from);
    return ms / 60000;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.current) this.close(Date.now());
  }
}

module.exports = { SessionTracker };

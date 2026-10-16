// Modo enfoque: mientras juegas, el juego va en prioridad alta y los programas
// pesados en segundo plano pasan a "modo eficiencia" (prioridad baja, EcoQoS y
// memoria de baja prioridad). No se cierra nada y todo se restaura al terminar.
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const win32 = require('./win32');

// Programas en segundo plano que se pueden frenar sin romper nada.
const BACKGROUND = new Set(
  [
    // navegadores
    'chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi', 'msedgewebview2',
    // otros launchers y tiendas
    'epicgameslauncher', 'epicwebhelper', 'steamwebhelper', 'riotclientservices', 'riotclientux',
    'riotclientuxrender', 'battle.net', 'eadesktop', 'eabackgroundservice', 'upc', 'ubisoftconnect',
    'galaxyclient', 'galaxyclient helper', 'socialclubhelper',
    // música, chat y sincronización
    'spotify', 'spotifylauncher', 'teams', 'ms-teams', 'slack', 'whatsapp', 'telegram', 'discord',
    'onedrive', 'dropbox', 'googledrivefs',
    // varios
    'widgets', 'widgetservice', 'phoneexperiencehost', 'code', 'wallpaper32', 'wallpaper64', 'webviewhost',
  ].map((n) => n.toLowerCase())
);
// Los que la tienda del juego necesita para su overlay
const STORE_HELPERS = { steam: ['steamwebhelper'], epic: ['epicgameslauncher', 'epicwebhelper'] };

const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const SCAN_MS = 8000;
const WAIT_MAX_MS = 15 * 60000;

// Etiquetas de Steam que indican juego en línea (para dejar Discord tranquilo)
const MULTIPLAYER = /multijugador|cooperativ|jcj|pvp|en l[ií]nea|online|mmo|battle royale|multiplayer|co-op/i;

const baseName = (n) => String(n || '').toLowerCase().replace(/\.exe$/, '');
const normPath = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

function powercfg(args) {
  return new Promise((resolve) => {
    execFile('powercfg', args, { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
  });
}

async function activeScheme() {
  const out = await powercfg(['/getactivescheme']);
  const m = out && out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+\((.+)\)/i);
  return m ? { guid: m[1].toLowerCase(), name: m[2].trim() } : null;
}

async function gameModeEnabled() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\GameBar', '/v', 'AutoGameModeEnabled'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(true); // sin valor = activado (lo predeterminado)
      const m = stdout.match(/AutoGameModeEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i);
      resolve(!m || parseInt(m[1], 16) !== 0);
    });
  });
}

class Focus {
  /**
   * @param {object} o
   * @param {(name: string, fallback: any) => any} o.read
   * @param {(name: string, data: any) => void} o.write
   * @param {() => any[]} o.getGames   juegos instalados con installPath
   * @param {() => object} o.getOptions
   * @param {(id: string) => object} [o.getUserGame] ajustes propios de cada juego
   * @param {(status: object) => void} o.onChange
   * @param {(title: string, body: string) => void} o.notify
   */
  constructor(o) {
    Object.assign(this, o);
    this.reset();
  }

  reset() {
    clearInterval(this.timer);
    this.timer = null;
    this.mode = 'off'; // off | waiting | on
    this.game = null;
    this.touched = new Map(); // pid -> { name, before, kind: 'boost'|'background' }
    this.power = null;
    this.waitingSince = 0;
    this.gameMode = null;
    this.gamePids = [];
  }

  status() {
    const bg = [...this.touched.values()].filter((t) => t.kind === 'background');
    const groups = {};
    for (const t of bg) groups[t.label] = (groups[t.label] || 0) + 1;
    return {
      mode: this.mode,
      game: this.game && { id: this.game.id, title: this.game.title },
      boosted: [...this.touched.values()].filter((t) => t.kind === 'boost').length,
      background: bg.length,
      apps: Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      power: this.power,
      gameMode: this.gameMode,
      discordKept: this.mode === 'on' ? this.discordKept() : null,
    };
  }

  emit() {
    this.onChange?.(this.status());
  }

  /** Juego en ejecución: el primero con un proceso dentro de su carpeta. */
  findRunningGame(procs) {
    const games = this.getGames()
      .filter((g) => g.installPath && g.kind !== 'tool')
      .map((g) => ({ g, root: normPath(g.installPath) + '\\' }));
    if (!games.length) return null;
    for (const p of procs) {
      if (p.pid <= 4) continue;
      const file = win32.imagePath(p.pid);
      if (!file) continue;
      p.path = normPath(file);
      const hit = games.find((x) => p.path.startsWith(x.root));
      if (hit) return hit.g;
    }
    return null;
  }

  async start() {
    if (this.mode !== 'off') return this.status();
    this.gameMode = await gameModeEnabled();
    const procs = win32.listProcesses();
    const game = this.findRunningGame(procs);
    if (game) {
      await this.activate(game);
    } else {
      // Sin juego abierto: se queda esperando a que abras uno.
      this.mode = 'waiting';
      this.waitingSince = Date.now();
      this.timer = setInterval(() => this.waitTick(), 4000);
      this.emit();
    }
    return this.status();
  }

  async waitTick() {
    if (Date.now() - this.waitingSince > WAIT_MAX_MS) {
      this.reset();
      this.emit();
      this.notify?.('Modo enfoque cancelado', 'No se abrió ningún juego en 15 minutos.');
      return;
    }
    const game = this.findRunningGame(win32.listProcesses());
    if (game) {
      clearInterval(this.timer);
      await this.activate(game);
    }
  }

  async activate(game) {
    this.mode = 'on';
    this.game = game;
    const opts = this.getOptions();
    if (opts.powerPlan) {
      const prev = await activeScheme();
      if (prev && prev.guid !== HIGH_PERF && prev.guid !== ULTIMATE) {
        const list = (await powercfg(['/list'])) || '';
        const target = list.toLowerCase().includes(ULTIMATE) ? ULTIMATE : HIGH_PERF;
        const ok = (await powercfg(['/setactive', target])) !== null;
        const now = ok ? await activeScheme() : null;
        this.power = ok && now ? { prev, now } : { prev, failed: true };
      } else if (prev) {
        this.power = { prev: null, now: prev };
      }
    }
    this.apply();
    this.timer = setInterval(() => this.tick(), SCAN_MS);
    this.notify?.(`Modo enfoque: ${game.title}`, this.summary());
    this.emit();
  }

  summary() {
    const s = this.status();
    return `${s.background} procesos en segundo plano frenados.` + (this.power?.now && this.power.prev ? ` Plan de energía: ${this.power.now.name}.` : '');
  }

  /** Aplica los perfiles a los procesos actuales (también a los que aparezcan después). */
  apply() {
    const opts = this.getOptions();
    const procs = win32.listProcesses();
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    const root = normPath(this.game.installPath) + '\\';

    // Procesos del juego y sus hijos
    const gamePids = new Set();
    for (const p of procs) {
      const file = win32.imagePath(p.pid);
      p.path = file ? normPath(file) : '';
      if (p.path.startsWith(root)) gamePids.add(p.pid);
    }
    if (!gamePids.size) return 0; // el juego ya no está abierto
    this.gamePids = [...gamePids];
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of procs) if (!gamePids.has(p.pid) && gamePids.has(p.ppid)) (gamePids.add(p.pid), (grew = true));
    }
    // Lo que lanzó el juego (Steam, Epic, el launcher de Rockstar...) no se toca
    const protectedPids = new Set();
    for (const pid of gamePids) {
      let cur = byPid.get(pid);
      const seen = new Set();
      while (cur && !seen.has(cur.pid)) {
        seen.add(cur.pid);
        protectedPids.add(cur.ppid);
        cur = byPid.get(cur.ppid);
      }
    }
    const skipNames = new Set(STORE_HELPERS[this.game.store] || []);
    if (this.discordKept()) skipNames.add('discord');

    for (const p of procs) {
      if (this.touched.has(p.pid)) continue;
      const name = baseName(p.name);
      let kind = null;
      if (gamePids.has(p.pid)) kind = 'boost';
      else if (BACKGROUND.has(name) && !skipNames.has(name) && !protectedPids.has(p.pid)) kind = 'background';
      if (!kind) continue;
      const before = win32.applyProfile(p.pid, kind);
      if (before) this.touched.set(p.pid, { name, label: path.basename(p.name, '.exe'), before, kind });
    }
    this.persist();
    return gamePids.size;
  }

  /** Nombres de los ejecutables del juego (para medir sus FPS). */
  gameProcessNames() {
    const pids = new Set(this.gamePids);
    return win32
      .listProcesses()
      .filter((p) => pids.has(p.pid))
      .map((p) => p.name);
  }

  /** ¿Se deja Discord sin frenar? Primero manda la ficha del juego, luego el ajuste general. */
  discordKept() {
    const u = (this.game && this.getUserGame?.(this.game.id)) || {};
    if (u.focusDiscord === 'keep') return true;
    if (u.focusDiscord === 'throttle') return false;
    const opts = this.getOptions();
    const mode = opts.discord || 'multiplayer';
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return MULTIPLAYER.test((this.game?.tags || []).join(' '));
  }

  tick() {
    // Olvida los procesos que ya se cerraron
    const alive = new Map(win32.listProcesses().map((p) => [p.pid, baseName(p.name)]));
    for (const [pid, t] of this.touched) if (alive.get(pid) !== t.name) this.touched.delete(pid);
    const running = this.apply();
    if (!running) {
      this.stop('game-closed');
      return;
    }
    this.emit();
  }

  stop(reason) {
    if (this.mode === 'off') return this.status();
    const title = this.game?.title;
    const wasOn = this.mode === 'on';
    clearInterval(this.timer);
    this.restoreAll();
    this.reset();
    this.clearPersisted();
    if (wasOn && reason === 'game-closed') {
      this.notify?.('Modo enfoque terminado', `${title} se ha cerrado. Todo vuelve a la normalidad.`);
    }
    this.emit();
    return this.status();
  }

  restoreAll() {
    const alive = new Map(win32.listProcesses().map((p) => [p.pid, baseName(p.name)]));
    for (const [pid, t] of this.touched) if (alive.get(pid) === t.name) win32.restoreProfile(pid, t.before);
    this.touched.clear();
    if (this.power?.prev && !this.power.failed) {
      try {
        execFileSync('powercfg', ['/setactive', this.power.prev.guid], { windowsHide: true });
      } catch {}
    }
  }

  persist() {
    this.write('focus-state.json', {
      game: this.game && { id: this.game.id, title: this.game.title },
      power: this.power,
      touched: [...this.touched].map(([pid, t]) => ({ pid, name: t.name, before: t.before })),
    });
  }

  clearPersisted() {
    this.write('focus-state.json', null);
  }

  /** Si la app se cerró de golpe con el enfoque activo, deshace los cambios. */
  recover() {
    const saved = this.read('focus-state.json', null);
    if (!saved) return false;
    const alive = new Map(win32.listProcesses().map((p) => [p.pid, baseName(p.name)]));
    for (const t of saved.touched || []) if (alive.get(t.pid) === t.name) win32.restoreProfile(t.pid, t.before);
    if (saved.power?.prev && !saved.power.failed) {
      try {
        execFileSync('powercfg', ['/setactive', saved.power.prev.guid], { windowsHide: true });
      } catch {}
    }
    this.clearPersisted();
    return true;
  }
}

module.exports = { Focus };

const path = require('path');
const { app, BrowserWindow, ipcMain, shell, dialog, session, Notification, utilityProcess, protocol, net, globalShortcut } = require('electron');
const { pathToFileURL } = require('url');
const store = require('./src/store');
const library = require('./src/library');
const steam = require('./src/steam');
const epic = require('./src/epic');
const licenses = require('./src/licenses');
const { Focus } = require('./src/focus');
const achievements = require('./src/achievements');
const extras = require('./src/extras');
const { Perf } = require('./src/perf');
const { SessionTracker } = require('./src/sessions');
const news = require('./src/news');
const friends = require('./src/friends');
const screens = require('./src/screens');
const saves = require('./src/saves');
const { FpsMeter, presentMonPath } = require('./src/fps');
const caches = require('./src/caches');

// Protocolo propio para enseñar tus capturas sin dar acceso al resto del disco
protocol.registerSchemesAsPrivileged([{ scheme: 'bjshot', privileges: { secure: true, supportFetchAPI: true, stream: true } }]);

// Menos memoria: sin caché de disco para GPU shaders y sin corrector ortográfico.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Solo para medir: BJ_NOGPU=1 arranca sin aceleración gráfica
if (process.env.BJ_NOGPU) app.disableHardwareAcceleration();
// En las pruebas con capturas, la ventana se sigue dibujando aunque otra la tape
// (si no, Chromium deja de pintarla y la captura espera para siempre).
if (process.env.BJ_SNAPSHOT) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

// Carpeta de datos: %APPDATA%\biblioteca-juegos (fuera de la carpeta del
// programa, para que desinstalar o actualizar no borre nada).
// BJ_USERDATA solo se usa en pruebas.
const DATA_DIR = process.env.BJ_USERDATA || path.join(app.getPath('appData'), 'biblioteca-juegos');
app.setPath('userData', DATA_DIR);
migrateData();

// Versiones anteriores guardaban los datos en otros sitios: se copian una vez.
function migrateData() {
  const fs = require('fs');
  if (process.env.BJ_USERDATA || fs.existsSync(path.join(DATA_DIR, 'settings.json'))) return;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [path.join(local, 'Programs', 'BibliotecaJuegos', 'data'), path.join(local, 'biblioteca-juegos')];
  const from = candidates.find((d) => fs.existsSync(path.join(d, 'settings.json')));
  if (!from) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    // Los .json son tus datos; "Local State" guarda la llave que cifra la clave de Steam
    if (f.endsWith('.json') || f === 'Local State') {
      try {
        fs.copyFileSync(path.join(from, f), path.join(DATA_DIR, f));
      } catch {}
    }
  }
}

let win = null;

// Abrir un juego desde la lista de recientes del icono de la barra de tareas
const OPEN_ARG = '--abrir=';
const openArg = (argv) => (argv.find((a) => a.startsWith(OPEN_ARG)) || '').slice(OPEN_ARG.length) || null;

// Una sola copia abierta: si pulsas el icono otra vez, se trae al frente la ventana.
const gotLock = process.env.BJ_SNAPSHOT ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  const url = openArg(argv);
  if (url) {
    openSafe(url);
    // Con la app abierta, el modo enfoque se queda esperando a que arranque el juego
    if (store.getSettings().focus.autoOnPlay && focus.mode === 'off') focus.start();
    return;
  }
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

/** Lista "Jugados recientemente" al hacer clic derecho en el icono de la barra de tareas. */
function updateJumpList() {
  if (process.platform !== 'win32' || process.env.BJ_SNAPSHOT) return;
  const lib = store.read('library.json', null);
  const recent = (lib?.games || [])
    .filter((g) => g.installed && g.kind !== 'tool' && g.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 7);
  const prefix = app.isPackaged ? '' : `"${app.getAppPath()}" `;
  try {
    app.setJumpList([
      {
        type: 'custom',
        name: 'Jugados recientemente',
        items: recent.map((g) => ({
          type: 'task',
          title: g.title,
          description: `Jugar a ${g.title}`,
          program: process.execPath,
          args: `${prefix}${OPEN_ARG}${g.launchUrl}`,
          iconPath: process.execPath,
          iconIndex: 0,
        })),
      },
    ]);
  } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#16122a',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    title: 'Biblioteca de juegos',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !process.env.BJ_SNAPSHOT,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Cualquier enlace externo se abre fuera, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => {
    win = null;
    // El panel flotante no mantiene viva la app por sí solo
    if (!keepAlive()) app.quit();
  });
  if (process.env.BJ_SNAPSHOT) snapshot(process.env.BJ_SNAPSHOT);
}

// Solo para pruebas: BJ_SNAPSHOT=carpeta espera a que termine la lectura,
// guarda capturas de cada vista y cierra.
function snapshot(dir) {
  const fs = require('fs');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code).catch(() => null);
  const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(dir, 'console.txt'), '');
  const log = (t) => fs.appendFileSync(path.join(dir, 'console.txt'), `${new Date().toLocaleTimeString()} ${t}\n`);
  win.webContents.on('console-message', (e) => log(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  win.webContents.on('render-process-gone', (_e, d) => log(`[error] página caída: ${d.reason}`));
  win.on('unresponsive', () => log('[error] la página no responde'));
  setInterval(() => log(`ESTADO visible=${win.isVisible()} minimizada=${win.isMinimized()} foco=${win.isFocused()}`), 10000);
  win.webContents.once('did-finish-load', async () => {
    const deadline = Date.now() + Number(process.env.BJ_SNAPSHOT_WAIT || 180000);
    await wait(1500);
    while (Date.now() < deadline && (await js(`document.querySelector('#refreshBtn').disabled`))) await wait(500);
    await wait(2500);
    if (process.env.BJ_SNAPSHOT_JS) {
      await js(process.env.BJ_SNAPSHOT_JS);
      await wait(1200);
    }
    await shot('biblioteca.png');
    await js(`document.querySelector('#scroller').scrollTo({top: 560, behavior: 'instant'})`);
    await wait(1500);
    await shot('biblioteca-rejilla.png');
    await js(`document.querySelector('[data-view=sagas]').click()`);
    await wait(2000);
    await shot('sagas.png');
    await js(`document.querySelector('.saga') && document.querySelector('.saga').click()`);
    await wait(2000);
    await shot('saga-detalle.png');
    await js(`document.querySelector('[data-view=ach]').click()`);
    await wait(1500);
    while (Date.now() < deadline && (await js(`document.querySelector('#achRefresh').disabled`))) await wait(500);
    await wait(2500);
    // la vitrina tarda la primera vez (rareza y nombres de cada juego)
    for (let i = 0; i < 90 && !(await js(`!!document.querySelector('#achShowcase .trophy')`)); i++) await wait(1000);
    await wait(1500);
    await shot('logros.png');
    await js(`document.querySelector('#achShowcase').scrollIntoView()`);
    await wait(800);
    await shot('vitrina.png');
    await js(`document.querySelector('#scroller').scrollTo({top: 0, behavior: 'instant'})`);
    await js(`(document.querySelector('.ach-game:not(.plat)') || document.querySelector('.ach-game'))?.click()`);
    await wait(5000);
    await shot('logro-detalle.png');
    await js(`document.querySelector('#focusBtn').click()`);
    await wait(2500);
    await shot('enfoque.png');
    await js(`window.api.focusStop()`);
    await js(`document.querySelector('[data-view=deals]').click()`);
    await wait(2500);
    await shot('ofertas.png');
    await js(`document.querySelector('[data-view=stats]').click()`);
    await wait(2000);
    await shot('estadisticas.png');
    await js(`document.querySelector('[data-view=disk]').click()`);
    await wait(3000);
    await shot('espacio.png');
    await js(`document.querySelector('#cacheBox button')?.click()`);
    await wait(4000);
    await js(`document.querySelector('#cacheBox').scrollIntoView()`);
    await wait(800);
    await shot('espacio-caches.png');
    await js(`document.querySelector('[data-view=library]').click()`);
    await wait(1500);
    await js(`document.querySelector('#grid .card .title').click()`);
    await wait(2000);
    await shot('ficha.png');
    await wait(8000); // capturas y partidas guardadas de la ficha
    await shot('ficha-extras.png');
    await js(`document.querySelector('#gameDlg').close()`);
    await js(`document.querySelector('[data-view=news]').click()`);
    await wait(12000);
    await shot('novedades.png');
    await js(`document.querySelector('[data-view=friends]').click()`);
    await wait(8000);
    await shot('amigos.png');
    await js(`document.querySelector('#pickBtn').click()`);
    await wait(1500);
    await shot('aque-juego.png');
    await js(`document.querySelector('#pickDlg').close()`);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); const i = document.querySelector('#palInput'); i.value = 'hol'; i.dispatchEvent(new Event('input'));`);
    await wait(800);
    await shot('ctrlk.png');
    app.quit();
  });
}

const ALLOWED = /^(steam:\/\/(rungameid|install|uninstall|store)\/|com\.epicgames\.launcher:\/\/apps\/|https:\/\/(store\.steampowered\.com|steamcommunity\.com|github\.com|www\.epicgames\.com|store\.epicgames\.com)\/|https:\/\/www\.youtube\.com\/results\?|https:\/\/www\.google\.com\/search\?)/;
function openSafe(url) {
  if (typeof url === 'string' && ALLOWED.test(url)) shell.openExternal(url);
}

// Sin bandeja ni procesos residentes: al cerrar la ventana, la app termina
// (y si el modo enfoque estaba activo, antes lo deja todo como estaba).
app.on('window-all-closed', () => {
  if (keepAlive()) return;
  app.quit();
});
app.on('before-quit', () => {
  focus.stop('quit');
  if (fpsMeter) fpsMeter.stop();
  tracker.stop();
});

// ---------- Modo enfoque ----------
const focus = new Focus({
  read: store.read,
  write: store.write,
  getGames: () => (store.read('library.json', null)?.games || []).filter((g) => g.installed),
  getOptions: () => store.getSettings().focus,
  getUserGame: (id) => extras.readUserGames(store.read)[id],
  onChange: (status) => {
    if (win && !win.isDestroyed()) win.webContents.send('focus:update', status);
    // El panel flotante aparece con el enfoque activo (si está activado en Ajustes) y se va al terminar
    if (status.mode === 'on' && store.getSettings().focus.overlay) showOverlay(true);
    if (status.mode === 'off') showOverlay(false);
    if (status.mode === 'on' && lastFocusMode !== 'on') onFocusOn();
    if (status.mode === 'off' && lastFocusMode === 'on') onFocusOff();
    lastFocusMode = status.mode;
    watchUnlocks(status.mode === 'on' ? focus.game : null);
    updateFps(status.mode === 'on');
  },
  notify: (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  },
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // Bloquea permisos que la app no necesita (cámara, notificaciones web, etc.)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  app.setAppUserModelId('Biblioteca de juegos');
  try {
    focus.recover(); // por si la app se cerró de golpe con el enfoque activo
  } catch {}
  // Abierto desde la lista de recientes con la app cerrada: abre el juego y
  // termina sin cargar la ventana (no ocupa memoria mientras juegas).
  const url = openArg(process.argv);
  if (url) {
    openSafe(url);
    setTimeout(() => app.quit(), 1500);
    return;
  }
  protocol.handle('bjshot', async (req) => {
    const file = new URL(req.url).searchParams.get('f') || '';
    if (!screens.isAllowed(file, await localCtx())) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (store.getSettings().trackSessions !== false) tracker.start();
  if (!process.env.BJ_SNAPSHOT) {
    registerHotkey();
    weeklySummary();
    setTimeout(epicReminders, 60000);
    setInterval(epicReminders, 6 * 3600000);
    setTimeout(friendAlerts, 20000);
    setInterval(friendAlerts, 5 * 60000);
  }
  createWindow();
  updateJumpList();
});

// ---------- Logros (Steam) ----------
async function steamAuth() {
  const apiKey = store.getSteamKey();
  if (!apiKey) throw new Error('Para ver los logros hace falta tu clave de la API de Steam (Ajustes).');
  let steamId = store.getSettings().steamId;
  if (!steamId) {
    const p = await steam.findSteamPath();
    steamId = p && steam.detectSteamId(p);
  }
  if (!steamId) throw new Error('Falta tu SteamID64 (Ajustes).');
  return { apiKey, steamId };
}

ipcMain.handle('ach:cached', () => store.read('achievements.json', null));
let achRunning = null;
ipcMain.handle('ach:refresh', () => refreshAch());
function refreshAch() {
  if (achRunning) return achRunning;
  achRunning = (async () => {
    const auth = await steamAuth();
    const games = (store.read('library.json', null)?.games || [])
      .filter((g) => g.store === 'steam' && g.kind !== 'tool')
      .map((g) => ({ appid: Number(g.id.split(':')[1]), lastPlayed: g.lastPlayed }));
    return achievements.refreshSummary({
      ...auth,
      games,
      read: store.read,
      write: store.write,
      onProgress: (done, total) => win && !win.isDestroyed() && win.webContents.send('ach:progress', { done, total }),
    });
  })().finally(() => {
    achRunning = null;
  });
  return achRunning;
}
ipcMain.handle('ach:friends', async (_e, appid) => {
  const auth = await steamAuth();
  return achievements.friendsCompare({ ...auth, appid: Number(appid), read: store.read, write: store.write });
});

// Mientras el modo enfoque está activo con un juego de Steam, se mira cada
// 2 minutos si has conseguido algún logro y se avisa con una notificación.
let unlockTimer = null;
let unlockAppid = null;
async function watchUnlocks(game) {
  const appid = game && game.store === 'steam' ? Number(game.id.split(':')[1]) : null;
  if (appid === unlockAppid) return;
  clearInterval(unlockTimer);
  unlockTimer = null;
  unlockAppid = appid;
  if (!appid) return;
  let check;
  try {
    check = achievements.unlockWatcher({ ...(await steamAuth()), appid });
    await check(); // toma nota de los que ya tienes
  } catch {
    return;
  }
  unlockTimer = setInterval(async () => {
    try {
      const fresh = await check();
      if (!fresh.length) return;
      // La ficha de logros de ese juego se vuelve a pedir la próxima vez
      const det = store.read('achievements-detail.json', {});
      delete det[appid];
      store.write('achievements-detail.json', det);
      if (Notification.isSupported()) {
        const body = fresh.length === 1 ? `${fresh[0].name}${fresh[0].description ? `: ${fresh[0].description}` : ''}` : fresh.map((a) => a.name).join(', ');
        new Notification({ title: fresh.length === 1 ? `Logro conseguido en ${game.title}` : `${fresh.length} logros nuevos en ${game.title}`, body, silent: true }).show();
      }
      sessUnlocks[game.id] = (sessUnlocks[game.id] || 0) + fresh.length;
      if (win && !win.isDestroyed()) win.webContents.send('ach:unlocked', { appid, achievements: fresh });
    } catch {}
  }, 120000);
}

ipcMain.handle('ach:detail', async (_e, appid) => {
  const auth = await steamAuth();
  return achievements.detail({ ...auth, appid: Number(appid), read: store.read, write: store.write });
});

// ---------- Datos propios, espacio y juegos gratis de Epic ----------
ipcMain.handle('user:get', () => extras.readUserGames(store.read));
ipcMain.handle('user:set', (_e, id, patch) => extras.updateUserGame(store.read, store.write, String(id), patch));
ipcMain.handle('disk:info', () => extras.diskInfo(store.read('library.json', null)?.games || []));
ipcMain.handle('epic:free', async () => {
  const list = await extras.epicFreeGames(store.getSettings().country);
  // Aviso de Windows la primera vez que aparece un juego gratis nuevo
  const seen = new Set(store.read('epic-free-seen.json', []));
  const fresh = list.filter((g) => g.when === 'now' && !seen.has(g.id));
  if (fresh.length && seen.size && Notification.isSupported()) {
    new Notification({ title: 'Gratis en Epic esta semana', body: fresh.map((g) => g.title).join(', '), silent: true }).show();
  }
  store.write('epic-free-seen.json', [...new Set([...seen, ...list.map((g) => g.id)])].slice(-200));
  return list;
});

// ---------- Rendimiento y panel flotante ----------
let perf = null;
const getPerf = () => (perf ||= new Perf());
// FPS con PresentMon mientras el modo enfoque está activo
let fpsMeter = null;
let fpsNames = '';
function updateFps(on) {
  if (!on || store.getSettings().focus.fps === false) {
    if (fpsMeter) fpsMeter.stop();
    fpsNames = '';
    return;
  }
  fpsMeter ||= new FpsMeter(presentMonPath(app));
  const names = focus.gameProcessNames();
  const key = [...new Set(names)].sort().join('|');
  if (key && key !== fpsNames) {
    fpsNames = key;
    fpsMeter.start(names);
  }
}
const sampleAll = () => {
  const s = getPerf().sample(focus.gamePids);
  if (focus.mode === 'on' && fpsMeter) Object.assign(s, fpsMeter.stats());
  return s;
};
ipcMain.handle('perf:sample', () => sampleAll());

let overlay = null;
let overlayTimer = null;
function showOverlay(on) {
  if (!on) {
    clearInterval(overlayTimer);
    overlayTimer = null;
    if (overlay && !overlay.isDestroyed()) overlay.close();
    overlay = null;
    return;
  }
  if (overlay && !overlay.isDestroyed()) return;
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    width: 236,
    height: 128,
    x: area.x + area.width - 252,
    y: area.y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true); // los clics pasan al juego
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlay.once('ready-to-show', () => overlay && overlay.showInactive());
  overlay.on('closed', () => {
    overlay = null;
  });
  overlayTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return;
    const s = sampleAll();
    overlay.webContents.send('perf:update', { ...s, game: focus.game?.title || null });
  }, 2000);
}
ipcMain.handle('overlay:set', (_e, on) => {
  store.saveSettings({ focus: { overlay: !!on } });
  showOverlay(!!on && focus.mode === 'on');
  return !!on;
});

// ---------- Memoria mientras juegas ----------
// Con el modo enfoque activo, la ventana de la biblioteca (lo que más memoria
// gasta) se cierra del todo; la app sigue en marcha sin ventana y la vuelve a
// abrir al terminar la partida.
let lastFocusMode = 'off';
let reopenAfterGame = false;
function keepAlive() {
  return focus.mode !== 'off' || reopenAfterGame || (!!tracker.current && store.getSettings().keepTracking !== false);
}
function onFocusOn() {
  const f = store.getSettings().focus;
  if (!win || win.isDestroyed()) return;
  if (f.freeMemory !== false) {
    reopenAfterGame = true;
    win.destroy();
  } else if (f.minimize) {
    win.minimize();
  }
}
function onFocusOff() {
  if (!reopenAfterGame) return;
  reopenAfterGame = false;
  if (!win || win.isDestroyed()) createWindow();
}

// ---------- Sesiones de juego ----------
const tracker = new SessionTracker({
  read: store.read,
  write: store.write,
  getGames: () => store.read('library.json', null)?.games || [],
  onChange: (cur) => {
    if (win && !win.isDestroyed()) win.webContents.send('session:update', cur);
    if (!cur) maybeQuit();
  },
});
// Sin ventana y sin partida en marcha, la app termina
function maybeQuit() {
  if ((!win || win.isDestroyed()) && !keepAlive()) app.quit();
}
ipcMain.handle('sessions:get', () => ({ list: store.read('sessions.json', []), current: tracker.current }));

// ---------- Contexto local (Steam, Documentos) ----------
let steamPathCache;
async function localCtx() {
  if (steamPathCache === undefined) steamPathCache = (await steam.findSteamPath()) || null;
  const steamId = store.read('library.json', null)?.steamId || store.getSettings().steamId || null;
  return {
    steamPath: steamPathCache,
    steamId,
    accountId: steamId ? (BigInt(steamId) & 0xffffffffn).toString() : null,
    documents: app.getPath('documents'),
  };
}
const libGame = (id) => (store.read('library.json', null)?.games || []).find((g) => g.id === id);

// ---------- Novedades ----------
ipcMain.handle('news:get', async () => {
  const lib = store.read('library.json', null);
  const user = extras.readUserGames(store.read);
  const games = (lib?.games || []).filter((g) => g.store === 'steam' && g.kind !== 'tool');
  // Instalados, favoritos y los que estás jugando o pendientes (hasta 30)
  const pick = games
    .filter((g) => g.installed || user[g.id]?.fav || ['playing', 'pending'].includes(user[g.id]?.status) || user[g.id]?.pin)
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
    .slice(0, 30)
    .map((g) => Number(g.id.split(':')[1]));
  return news.news(pick, { read: store.read, write: store.write });
});
ipcMain.handle('releases:get', async () => {
  steam.setRegion(store.getSettings().country);
  const wl = store.read('wishlist.json', null);
  const ids = (wl?.items || []).map((i) => i.appid);
  return ids.length ? news.releases(ids) : [];
});

// ---------- Amigos ----------
ipcMain.handle('friends:list', async () => friends.friendsList({ ...(await steamAuth()), read: store.read, write: store.write }));
ipcMain.handle('friends:common', async (_e, ids) => {
  const auth = await steamAuth();
  const list = await friends.friendsList({ ...auth, read: store.read, write: store.write });
  const chosen = list.filter((f) => ids.includes(f.steamid));
  const MULTI = /multijugador|cooperativ|jcj|pvp|en l[ií]nea|online|mmo|multiplayer|co-op/i;
  const myGames = (store.read('library.json', null)?.games || [])
    .filter((g) => g.store === 'steam' && g.kind !== 'tool')
    .map((g) => ({ id: g.id, appid: Number(g.id.split(':')[1]), multiplayer: MULTI.test((g.tags || []).join(' ')) }));
  return friends.commonGames({ apiKey: auth.apiKey, friends: chosen, myGames, read: store.read, write: store.write });
});

// ---------- Capturas ----------
ipcMain.handle('shots:get', async (_e, id) => {
  const g = libGame(id);
  if (!g) return [];
  const ctx = await localCtx();
  return screens.forGame(g, ctx).map((s) => ({ ...s, url: `bjshot://img/?f=${encodeURIComponent(s.file)}` }));
});
ipcMain.handle('shots:open', async (_e, file) => {
  if (screens.isAllowed(file, await localCtx())) shell.openPath(file);
});

// ---------- Partidas guardadas ----------
let savesBuilding = null;
function buildSavesIndex() {
  if (savesBuilding) return savesBuilding;
  const games = (store.read('library.json', null)?.games || [])
    .filter((g) => g.kind !== 'tool')
    .map((g) => ({ id: g.id, title: g.title, store: g.store, appid: g.store === 'steam' ? Number(g.id.split(':')[1]) : null }));
  savesBuilding = new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'src', 'saves-worker.js'), [], { serviceName: 'Partidas guardadas' });
    let done = false;
    child.on('message', (m) => {
      done = true;
      if (!m.ok) return reject(new Error(m.error));
      const data = { at: Date.now(), index: m.index };
      store.write('saves-index.json', data);
      resolve(data);
    });
    child.on('exit', () => {
      if (!done) reject(new Error('No se pudo leer la base de datos de partidas guardadas.'));
    });
    child.postMessage({ games });
  }).finally(() => {
    savesBuilding = null;
  });
  return savesBuilding;
}
async function savesIndex(force) {
  const cur = store.read('saves-index.json', null);
  if (!force && cur && Date.now() - cur.at < saves.INDEX_TTL) return cur;
  return buildSavesIndex();
}
ipcMain.handle('saves:info', async (_e, id) => {
  const g = libGame(id);
  if (!g) return null;
  const idx = await savesIndex(false);
  const info = idx.index[id];
  const ctx = await localCtx();
  if (!info) return { known: false, backups: saves.listBackups(g, ctx) };
  let found = null;
  try {
    const files = saves.findFiles(g, info, ctx);
    found = { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) };
  } catch (e) {
    found = { error: e.message };
  }
  return { known: true, name: info.name, cloud: info.cloud, registry: info.registry, found, backups: saves.listBackups(g, ctx) };
});
ipcMain.handle('saves:backup', async (_e, id) => {
  const g = libGame(id);
  const idx = await savesIndex(false);
  if (!g || !idx.index[id]) throw new Error('No se sabe dónde guarda sus partidas este juego.');
  return saves.backup(g, idx.index[id], await localCtx());
});
ipcMain.handle('saves:backupAll', async () => {
  const idx = await savesIndex(false);
  const ctx = await localCtx();
  const games = (store.read('library.json', null)?.games || []).filter((g) => g.installed && idx.index[g.id]);
  let ok = 0;
  const skipped = [];
  for (const g of games) {
    try {
      saves.backup(g, idx.index[g.id], ctx);
      ok++;
    } catch {
      skipped.push(g.title);
    }
  }
  return { ok, skipped, total: games.length };
});
ipcMain.handle('saves:restore', async (_e, id, dir) => {
  const g = libGame(id);
  const idx = await savesIndex(false);
  if (!g || !idx.index[id]) throw new Error('No se sabe dónde guarda sus partidas este juego.');
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Restaurar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Restaurar partidas guardadas',
    message: `¿Restaurar las partidas de ${g.title}?`,
    detail: 'Se sustituirán tus partidas actuales por las de esa copia. Antes se guarda una copia de las actuales por si quieres volver atrás. Cierra el juego antes de seguir.',
  });
  if (r.response !== 0) return { cancelled: true };
  return saves.restore(g, idx.index[id], await localCtx(), dir);
});
ipcMain.handle('saves:open', async (_e, id) => {
  const ctx = await localCtx();
  const root = saves.backupRoot(ctx.documents);
  const g = id && libGame(id);
  const dir = g ? path.join(root, saves.listBackups(g, ctx).length ? path.basename(path.dirname(saves.listBackups(g, ctx)[0].dir)) : '') : root;
  require('fs').mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

// ---------- Exportar / importar tus datos ----------
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportar mis datos',
    defaultPath: path.join(app.getPath('documents'), `Biblioteca de juegos - mis datos ${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const settings = { ...store.read('settings.json', {}) };
  delete settings.steamKeyEnc; // la clave cifrada solo sirve en este usuario de Windows
  const data = {
    app: 'biblioteca-juegos',
    version: 1,
    exportedAt: Date.now(),
    userGames: store.read('user-games.json', {}),
    sessions: store.read('sessions.json', []),
    purchaseDates: store.read('purchase-dates.json', {}),
    settings,
  };
  require('fs').writeFileSync(r.filePath, JSON.stringify(data, null, 1));
  return { file: r.filePath, games: Object.keys(data.userGames).length, sessions: data.sessions.length };
});
ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Importar mis datos', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const data = JSON.parse(require('fs').readFileSync(r.filePaths[0], 'utf8'));
  if (data.app !== 'biblioteca-juegos') throw new Error('Ese archivo no es una exportación de esta app.');
  // Se mezcla con lo que ya hay: lo importado gana en cada juego
  const ug = { ...store.read('user-games.json', {}) };
  for (const [id, v] of Object.entries(data.userGames || {})) ug[id] = { ...(ug[id] || {}), ...v };
  store.write('user-games.json', ug);
  const key = (s) => `${s.id}|${s.start}`;
  const sess = store.read('sessions.json', []);
  const have = new Set(sess.map(key));
  for (const s of data.sessions || []) if (!have.has(key(s))) sess.push(s);
  sess.sort((a, b) => a.start - b.start);
  store.write('sessions.json', sess);
  if (data.purchaseDates?.dates) {
    const pd = store.read('purchase-dates.json', {});
    store.write('purchase-dates.json', { ...pd, dates: { ...(pd.dates || {}), ...data.purchaseDates.dates }, info: pd.info || data.purchaseDates.info });
  }
  const { steamId, legendaryPath, country, focus } = data.settings || {};
  store.saveSettings({ steamId, legendaryPath, country, focus });
  return { games: Object.keys(data.userGames || {}).length, sessions: (data.sessions || []).length };
});

// ---------- Guardar una tarjeta como imagen ----------
ipcMain.handle('card:save', async (_e, rect, name) => {
  const img = await win.webContents.capturePage({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  const r = await dialog.showSaveDialog(win, {
    title: 'Guardar imagen',
    defaultPath: path.join(app.getPath('pictures'), `${name}.png`),
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return null;
  require('fs').writeFileSync(r.filePath, img.toPNG());
  return r.filePath;
});

// ---------- Fin de partida: resumen, copia automática y control del tiempo ----------
const notify = (title, body, url) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (url) n.on('click', () => openSafe(url));
  n.show();
};
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${Math.round(m % 60) ? ` ${Math.round(m % 60)} min` : ''}` : `${Math.max(1, Math.round(m))} min`);

// FPS de la partida (media cada 5 s mientras el modo enfoque mide) y logros conseguidos
let sessFps = { id: null, sum: 0, n: 0, low: 0, lowN: 0 };
const sessUnlocks = {};
setInterval(() => {
  if (focus.mode !== 'on' || !fpsMeter || !focus.game) return;
  const st = fpsMeter.stats();
  if (!st.fps) return;
  if (sessFps.id !== focus.game.id) sessFps = { id: focus.game.id, sum: 0, n: 0, low: 0, lowN: 0 };
  sessFps.sum += st.fps;
  sessFps.n++;
  if (st.low1) {
    sessFps.low += st.low1;
    sessFps.lowN++;
  }
}, 5000);

tracker.getExtra = (s) => {
  const extra = {};
  if (sessFps.id === s.id && sessFps.n) {
    extra.fps = sessFps.sum / sessFps.n;
    if (sessFps.lowN) extra.low1 = sessFps.low / sessFps.lowN;
  }
  if (sessUnlocks[s.id]) extra.unlocks = sessUnlocks[s.id];
  sessFps = { id: null, sum: 0, n: 0, low: 0, lowN: 0 };
  delete sessUnlocks[s.id];
  return extra;
};

tracker.onEnd = async (s) => {
  const min = (s.end - s.start) / 60000;
  const parts = [fmtMin(min)];
  if (s.fps) parts.push(`${Math.round(s.fps)} FPS de media${s.low1 ? ` (1 % bajo: ${Math.round(s.low1)})` : ''}`);
  if (s.unlocks) parts.push(`${s.unlocks} ${s.unlocks === 1 ? 'logro' : 'logros'}`);
  const st = store.getSettings();
  let backup = null;
  if (st.autoBackup !== false) {
    try {
      const idx = await savesIndex(false);
      const g = libGame(s.id);
      if (g && idx.index[s.id]) {
        const ctx = await localCtx();
        const r = saves.backup(g, idx.index[s.id], ctx, 'Automática');
        saves.pruneAuto(g, ctx, st.keepBackups || 5);
        backup = r;
        parts.push('partidas copiadas');
      }
    } catch {}
  }
  if (st.sessionSummary !== false) notify(`Partida terminada: ${s.title}`, parts.join(', ') + '.');
  if (win && !win.isDestroyed()) win.webContents.send('session:ended', { ...s, minutes: min, backup: !!backup });
};

// Límite diario y recordatorio cada X tiempo
let limitDay = null;
let remindStep = 0;
let remindFor = null;
setInterval(() => {
  const cur = tracker.current;
  if (!cur) {
    remindFor = null;
    return;
  }
  const { dailyLimitMin, remindEveryMin } = store.getSettings();
  const today = new Date().toDateString();
  if (dailyLimitMin && limitDay !== today && tracker.todayMinutes() >= dailyLimitMin) {
    limitDay = today;
    notify('Has llegado a tu límite de hoy', `Llevas ${fmtMin(tracker.todayMinutes())} jugando hoy (tu límite es ${fmtMin(dailyLimitMin)}).`);
  }
  if (remindEveryMin) {
    if (remindFor !== cur.start) {
      remindFor = cur.start;
      remindStep = 0;
    }
    const step = Math.floor((Date.now() - cur.start) / 60000 / remindEveryMin);
    if (step > remindStep) {
      remindStep = step;
      notify(`Llevas ${fmtMin(step * remindEveryMin)} jugando`, `${cur.title}. Buen momento para estirar las piernas o beber agua.`);
    }
  }
}, 60000);

// Resumen de la semana pasada, la primera vez que abres la app cada semana
function weeklySummary() {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const key = monday.toDateString();
  if (store.read('weekly.json', null)?.week === key) return;
  const from = monday.getTime() - 7 * 86400000;
  const list = store.read('sessions.json', []).filter((s) => s.start >= from && s.start < monday.getTime());
  store.write('weekly.json', { week: key });
  if (!list.length || store.getSettings().weeklySummary === false) return;
  const byGame = new Map();
  for (const s of list) byGame.set(s.title, (byGame.get(s.title) || 0) + (s.end - s.start) / 60000);
  const total = [...byGame.values()].reduce((a, b) => a + b, 0);
  const top = [...byGame].sort((a, b) => b[1] - a[1])[0];
  notify('Tu semana en juegos', `${fmtMin(total)} jugadas en ${list.length} ${list.length === 1 ? 'partida' : 'partidas'}. Lo que más: ${top[0]} (${fmtMin(top[1])}).`);
}

// ---------- Aviso del último día de un juego gratis de Epic ----------
const normT = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’™®]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function epicReminders() {
  if (store.getSettings().epicReminder === false) return;
  try {
    const list = await extras.epicFreeGames(store.getSettings().country);
    const owned = new Set((store.read('library.json', null)?.games || []).filter((g) => g.store === 'epic').map((g) => normT(g.title)));
    const done = new Set(store.read('epic-remind.json', []));
    const soon = list.filter((f) => f.when === 'now' && f.end && f.end - Date.now() < 24 * 3600000 && f.end > Date.now() && !owned.has(normT(f.title)) && !done.has(f.id));
    for (const f of soon) {
      const hora = new Date(f.end).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      notify('Último día gratis en Epic', `${f.title} deja de ser gratis hoy a las ${hora}. Haz clic para conseguirlo.`, f.url);
      done.add(f.id);
    }
    store.write('epic-remind.json', [...done].slice(-200));
  } catch {}
}

// ---------- Aviso cuando un amigo se pone a jugar a algo que tú tienes ----------
let friendsPlaying = null;
async function friendAlerts() {
  if (store.getSettings().friendAlerts === false || !store.getSteamKey()) return;
  try {
    const list = await friends.friendsList({ ...(await steamAuth()), read: store.read, write: store.write });
    const mine = new Set((store.read('library.json', null)?.games || []).map((g) => normT(g.title)));
    const now = new Map(list.filter((f) => f.playing).map((f) => [f.steamid, f.playing]));
    if (friendsPlaying) {
      for (const f of list) {
        if (!f.playing || friendsPlaying.get(f.steamid) === f.playing) continue;
        if (mine.has(normT(f.playing))) notify(`${f.name} está jugando a ${f.playing}`, 'Tú también lo tienes. ¿Te unes?');
      }
    }
    friendsPlaying = now;
  } catch {}
}

// ---------- Atajo global del modo enfoque ----------
async function toggleFocus() {
  if (focus.mode === 'off') {
    const s = await focus.start();
    if (s.mode === 'on') notify(`Modo enfoque: ${s.game.title}`, `${s.background} procesos en segundo plano frenados.`);
    else notify('Modo enfoque esperando', 'Se activará en cuanto abras un juego.');
  } else {
    focus.stop('user');
    notify('Modo enfoque desactivado', 'Todo vuelve a como estaba.');
  }
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (store.getSettings().hotkey === false) return false;
  return globalShortcut.register('CommandOrControl+Alt+F', toggleFocus);
}
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- Cachés ----------
ipcMain.handle('cache:scan', async () => {
  const ctx = await localCtx();
  const libs = ctx.steamPath ? steam.libraryFolders(ctx.steamPath) : [];
  const installed = new Set((store.read('library.json', null)?.games || []).filter((g) => g.store === 'steam' && g.installed).map((g) => Number(g.id.split(':')[1])));
  const items = await caches.scan({ steamLibraries: libs, installedAppids: installed });
  lastCacheScan = items;
  return items.map(({ dirs, ...rest }) => ({ ...rest, folders: dirs.length }));
});
let lastCacheScan = [];
ipcMain.handle('cache:clean', async (_e, kind) => {
  const item = lastCacheScan.find((i) => i.kind === kind);
  if (!item) throw new Error('Vuelve a calcular el tamaño de las cachés.');
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Borrar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Borrar caché',
    message: `¿Borrar «${item.label}»?`,
    detail: item.safe
      ? 'Son de juegos que ya no tienes instalados: no los necesitas.'
      : 'Se vuelven a generar solas. La primera vez que abras cada juego puede tardar algo más en cargar o tener algún tirón mientras las crea. Cierra los juegos antes de seguir.',
  });
  if (r.response !== 0) return { cancelled: true };
  return { freed: await caches.clean(item.dirs) };
});

// ---------- Vitrina de logros ----------
ipcMain.handle('ach:showcase', async () => {
  // Si faltan las fechas y nombres de los logros (datos de versiones anteriores), se leen antes
  const sum = store.read('achievements.json', null);
  if (!sum || Object.values(sum.games || {}).some((c) => !c.noStats && !c.got)) await refreshAch();
  return achievements.showcase({ ...(await steamAuth()), read: store.read, write: store.write });
});

ipcMain.handle('focus:status', () => focus.status());
ipcMain.handle('focus:start', async () => {
  const s = await focus.start();
  return s;
});
ipcMain.handle('focus:stop', () => focus.stop('user'));

// ---------- IPC ----------

ipcMain.handle('settings:get', async () => {
  const s = store.getSettings();
  let detectedSteamId = null;
  const steamPath = await steam.findSteamPath();
  if (steamPath) detectedSteamId = steam.detectSteamId(steamPath);
  const legendary = await epic.findLegendary(s.legendaryPath);
  const legendaryState = legendary ? await epic.legendaryStatus(legendary) : null;
  return { ...s, detectedSteamId, legendary, legendaryState };
});

ipcMain.handle('settings:basic', () => store.getSettings());

ipcMain.handle('settings:save', (_e, data) => {
  const s = store.saveSettings(data || {});
  if (data && 'hotkey' in data && !process.env.BJ_SNAPSHOT) registerHotkey();
  return s;
});

ipcMain.handle('library:cached', () => {
  const lib = store.read('library.json', null);
  return lib ? { ...lib, purchaseInfo: store.read('purchase-dates.json', {}).info || null } : null;
});

let refreshing = null;
ipcMain.handle('library:refresh', async () => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const settings = store.getSettings();
    steam.setRegion(settings.country);
    const previous = store.read('library.json', null);
    const purchases = store.read('purchase-dates.json', {});
    const result = await library.refresh({
      apiKey: store.getSteamKey(),
      settings,
      previous,
      purchaseDates: purchases.dates || {},
      cache: { read: store.read, write: store.write },
    });
    store.write('library.json', result);
    updateJumpList();
    return { ...result, purchaseInfo: purchases.info || null };
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
});

ipcMain.handle('library:clearNew', () => {
  const lib = store.read('library.json', null);
  if (lib) {
    lib.newIds = [];
    store.write('library.json', lib);
  }
  return true;
});

ipcMain.handle('game:open', (_e, url) => openSafe(url));

ipcMain.handle('deals:get', async () => {
  const settings = store.getSettings();
  let steamId = settings.steamId;
  if (!steamId) {
    const p = await steam.findSteamPath();
    steamId = p && steam.detectSteamId(p);
  }
  if (!steamId) throw new Error('Falta el SteamID64 (Ajustes).');
  steam.setRegion(settings.country);
  const res = await steam.getWishlistDeals(store.getSteamKey(), steamId);
  const out = { ...res, country: settings.country, fetchedAt: Date.now() };
  store.write('wishlist.json', out);
  return out;
});

ipcMain.handle('deals:cached', () => store.read('wishlist.json', null));

ipcMain.handle('epic:link', async () => {
  const exe = await epic.findLegendary(store.getSettings().legendaryPath);
  if (!exe) throw new Error('No se encuentra legendary.exe. Indica su ruta en Ajustes.');
  epic.legendaryAuth(exe);
  return true;
});

ipcMain.handle('epic:pickLegendary', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Selecciona legendary.exe',
    filters: [{ name: 'legendary', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return store.saveSettings({ legendaryPath: r.filePaths[0] });
});

// Fechas de compra de Steam: el usuario inicia sesión él mismo en la web de
// Steam en una ventana aislada (partición en memoria, no se guarda nada).
ipcMain.handle('steam:importPurchases', async () => {
  const lib = store.read('library.json', null);
  const owned = (lib?.games || [])
    .filter((g) => g.store === 'steam')
    .map((g) => ({ appid: Number(g.id.split(':')[1]), name: g.title }));
  if (!owned.length) throw new Error('Pulsa "Actualizar" primero para cargar tus juegos de Steam.');

  const part = `licenses-${Date.now()}`;
  const loginWin = new BrowserWindow({
    width: 980,
    height: 760,
    parent: win,
    modal: false,
    title: 'Steam · Licencias (inicia sesión en Steam)',
    autoHideMenuBar: true,
    webPreferences: { partition: part, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  loginWin.removeMenu();
  const target = 'https://store.steampowered.com/account/licenses/?l=english';

  const rows = await new Promise((resolve, reject) => {
    let done = false;
    loginWin.webContents.on('did-finish-load', async () => {
      const url = loginWin.webContents.getURL();
      if (done || !url.startsWith('https://store.steampowered.com/account/licenses')) return;
      // Tras el login Steam puede volver sin ?l=english: se recarga en inglés
      // para que el formato de las fechas sea siempre el mismo.
      if (!url.includes('l=english')) return loginWin.loadURL(target);
      try {
        const r = await loginWin.webContents.executeJavaScript(licenses.EXTRACT_JS);
        if (r && r.length) {
          done = true;
          resolve(r);
          loginWin.close();
        }
      } catch {}
    });
    loginWin.on('closed', () => {
      if (!done) reject(new Error('Ventana cerrada antes de leer las licencias.'));
    });
    loginWin.loadURL(target);
  }).finally(() => session.fromPartition(part).clearStorageData().catch(() => {}));

  const { dates, matched, total } = licenses.matchLicenses(rows, owned);
  const info = { matched, total, games: Object.keys(dates).length, importedAt: Date.now() };
  store.write('purchase-dates.json', { dates, info });

  // Aplica las fechas a la biblioteca guardada sin volver a consultar nada.
  if (lib) {
    for (const g of lib.games) {
      if (g.store === 'steam') g.purchased = dates[g.id.split(':')[1]] || g.purchased || null;
    }
    store.write('library.json', lib);
  }
  return { ...lib, purchaseInfo: info };
});

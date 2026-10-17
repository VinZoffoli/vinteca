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
const trainers = require('./src/trainers');
const genshin = require('./src/genshin');
const genshinWish = require('./src/genshin-wish');
const hoyolab = require('./src/hoyolab');
const ocr = require('./src/ocr');
const wallets = require('./src/wallets');
const genshinNews = require('./src/genshin-news');
const rgb = require('./src/rgb');
const trainer = require('./src/trainer');
const workana = require('./src/workana');
const proposal = require('./src/proposal');
const spotify = require('./src/spotify');
const recs = require('./src/recs');
const storeinfo = require('./src/storeinfo');
const { LanServer } = require('./src/lan');

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
    title: 'ViperTeca',
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
    if (process.env.BJ_SNAPSHOT_ONLY === 'workana') {
      await js(`showView('workana')`);
      await wait(2000);
      await js(`document.querySelector('#workanaBody .btn.primary').click()`);
      for (let i = 0; i < 90 && !(await js(`!!document.querySelector('.wk-card')`)); i++) await wait(1000);
      await wait(1500);
      log(`WORKANA tarjetas=${await js(`document.querySelectorAll('.wk-card').length`)}`);
      await shot('workana.png');
      await js(`(() => { const i = document.querySelector('.wk-price'); i.value = '350'; i.dispatchEvent(new Event('input')); document.querySelector('.wk-act .btn.primary').click(); })()`);
      await wait(2500);
      await js(`document.querySelector('.wk-card.open')?.scrollIntoView()`);
      await wait(800);
      await shot('workana-propuesta.png');
      log(`PROPUESTA ${JSON.stringify(await js(`document.querySelector('.wk-draft')?.value`))}`);
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'genshin') {
      await js(`showView('genshin')`);
      await wait(1500);
      await shot('genshin-uid.png');
      for (let i = 0; i < 40 && !(await js(`!!document.querySelector('.gi-head')`)); i++) await wait(1000);
      await wait(3000);
      await shot('genshin.png');
      await js(`document.querySelector('.gi-roster')?.scrollIntoView()`);
      await wait(1500);
      await shot('genshin-vitrina.png');
      for (const tab of ['noticias', 'prioridades', 'notas', 'deseos']) {
        await js(`setGenshinTab('${tab}')`);
        await wait(3500);
        await js(`document.querySelector('.gi-tabs')?.scrollIntoView()`);
        await wait(800);
        await shot(`genshin-${tab}.png`);
      }
      // Prioridades con una lista de ejemplo (no se guarda) y misiones leídas de ejemplo
      await js(`gi.tasks = [{ id: 'a', text: 'Una luz en la oscuridad', kind: 'Arconte', done: false }, { id: 'b', text: 'Subir a Skirk al nivel 90', kind: 'Personaje', done: false }, { id: 'c', text: 'Pétalos al viento', kind: 'Mundo', done: true }]; gi.found = { quests: [{ text: 'El canto de las mareas', kind: 'Leyenda' }, { text: 'El secreto del bosque perdido', kind: 'Mundo' }] }; setGenshinTab('prioridades')`);
      await wait(1500);
      await js(`document.querySelector('.gi-tabs')?.scrollIntoView()`);
      await wait(800);
      await shot('genshin-prioridades-ejemplo.png');
      // Deseos y notas con datos de ejemplo (solo en pantalla)
      await js(`gi.wish = { total: 812, importedAt: Date.now() - 3600000, pools: [{ key: 'character', name: 'Personaje de evento', total: 540, pity5: 63, pity4: 3, hardPity: 90, guaranteed: true, avg5: 71, fives: [{ name: 'Qiqi', pity: 78, lost: true }, { name: 'Furina', pity: 74, lost: false }, { name: 'Mavuika', pity: 52, lost: null }] }, { key: 'weapon', name: 'Arma de evento', total: 120, pity5: 12, pity4: 1, hardPity: 80, guaranteed: false, avg5: 60, fives: [{ name: 'Espada de la Luz', pity: 60, lost: null }] }] }; setGenshinTab('deseos')`);
      await wait(1500);
      await js(`document.querySelector('.gi-tabs')?.scrollIntoView()`);
      await wait(800);
      await shot('genshin-deseos-ejemplo.png');
      await js(`gi.hoyo = { linked: true, fetchedAt: Date.now(), notes: { resin: 182, maxResin: 200, resinFullAt: Date.now() + 2.5 * 3600000, commissionsDone: 2, commissionsTotal: 4, commissionReward: false, weeklyLeft: 2, weeklyTotal: 3, realmCoins: 2300, realmMax: 2400, realmFullAt: Date.now() + 3600000, expeditions: [{ done: true }, { done: false }, { done: true }], maxExpeditions: 5, transformerReady: true }, stats: { days: 1200, characters: 92, oculi: 1300, chests: 4500, waypoints: 400, domains: 60, regions: [{ name: 'Natlan', pct: 72 }, { name: 'Nod-Krai', pct: 85.5 }, { name: 'Mondstadt', pct: 100 }] }, characters: [{ name: 'Skirk', rarity: 5, level: 90, constellation: 0 }, { name: 'Bennett', rarity: 4, level: 80, constellation: 6 }] }; setGenshinTab('notas')`);
      await wait(1500);
      await js(`document.querySelector('.gi-tabs')?.scrollIntoView()`);
      await wait(800);
      await shot('genshin-notas-ejemplo.png');
      // Ficha de personaje de HoYoLAB con datos de ejemplo
      await js(`gi.hoyo.characters = [{ id: 1, name: 'Zibai', rarity: 5, level: 90, constellation: 0, icon: '' }, { id: 2, name: 'Furina', rarity: 5, level: 90, constellation: 1, icon: '' }]; gi.hoyoPick = 1; gi.hoyoDetail = { 1: { id: 1, name: 'Zibai', element: 'Geo', rarity: 5, level: 90, friendship: 3, constellation: 0, image: '', constellations: [1,2,3,4,5,6].map((i) => ({ name: 'C' + i, active: false })), skills: [{ name: 'Ataque', level: 4 }, { name: 'E', level: 8 }, { name: 'Q', level: 5 }], passives: [], weapon: { name: 'Espada Negra', rarity: 5, level: 90, refinement: 1, main: { name: 'ATQ Básico', final: '510' }, sub: { name: 'Prob. CRIT', final: '27.6%' } }, properties: [{ name: 'Vida Máx.', base: '12919', add: '10177', final: '23097' }, { name: 'ATQ', base: '734', add: '420', final: '1154' }, { name: 'DEF', base: '957', add: '1176', final: '2133' }, { name: 'Maestría Elemental', final: '80' }, { name: 'Prob. CRIT', final: '67.2%' }, { name: 'Daño CRIT', final: '208.1%' }, { name: 'Recarga de Energía', final: '116.2%' }, { name: 'Bono de Daño Geo', final: '0.0%' }], artifacts: ['Flor Anhelaverdad', 'Pluma del Pecado', 'Momento Olvidado', 'Cáliz Rebosante', 'Corona Aciaga'].map((n, i) => ({ name: n, level: 20, rarity: 5, set: 'Conjunto de ejemplo', main: { name: ['Vida', 'ATQ', 'DEF', 'DEF', 'Daño CRIT'][i], final: ['4780', '311', '58.3%', '58.3%', '62.2%'][i] }, subs: [{ name: 'Daño CRIT', final: '14.0%', times: 1 }, { name: 'Prob. CRIT', final: '7.4%', times: 1 }, { name: 'Vida', final: '14.6%', times: 2 }, { name: 'DEF', final: '37', times: 0 }] })) } }; renderGenshin(); document.querySelector('.hc')?.scrollIntoView()`);
      await wait(1500);
      await shot('genshin-ficha-personaje.png');
      await js(`showView('music')`);
      await wait(2500);
      await shot('spotify.png');
      await js(`showView('deals')`);
      await wait(3000);
      await shot('ofertas-saldo.png');
      await js(`showView('sagas')`);
      await wait(3000);
      await shot('sagas-banner.png');
      await js(`showView('cheats')`);
      await wait(5000);
      await shot('trucos.png');
      await js(`showView('rgb')`);
      await wait(4000);
      await shot('iluminacion.png');
      await js(`window.api.rgb.start(false).then(() => loadRgb())`);
      await wait(15000);
      await js(`lux.open = 0; renderRgb()`);
      await wait(1000);
      await shot('iluminacion-conectado.png');
      await js(`setGenshinTab('prioridades')`);
      await wait(1200);
      await js(`document.querySelector('.gi-tabs')?.scrollIntoView()`);
      await wait(800);
      await shot('genshin-prioridades-auto.png');
      return app.quit();
    }
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
    await js(`document.querySelector('#gameDlg .col-box')?.scrollIntoView({ block: 'center' })`);
    await wait(800);
    await shot('ficha-colecciones.png');
    await js(`document.querySelector('#gameDlg').scrollTo({ top: 0 })`);
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
    await js(`document.querySelector('#palette').hidden = true`);
    await js(`document.querySelector('[data-view=news]').click()`);
    await wait(1500);
    await js(`document.querySelector('.nin')?.scrollIntoView()`);
    await wait(2500);
    await shot('nintendo.png');
    await js(`document.querySelector('[data-view=recs]').click()`);
    for (let i = 0; i < 60 && !(await js(`!!document.querySelector('#recsBody .deal')`)); i++) await wait(1000);
    await wait(2500);
    await shot('para-ti.png');
    await js(`document.querySelector('[data-view=deals]').click()`);
    for (let i = 0; i < 40 && !(await js(`!!document.querySelector('#dlcDeals .deal') || /Ningún/.test(document.querySelector('#dlcDeals').textContent)`)); i++) await wait(1000);
    await wait(3000);
    await shot('ofertas-requisitos.png');
    await js(`document.querySelector('#dlcDeals').scrollIntoView()`);
    await wait(1200);
    await shot('dlc.png');
    await js(`document.querySelector('[data-view=lan]').click()`);
    await wait(1200);
    await shot('movil.png');
    await js(`document.querySelector('[data-view=library]').click(); [...document.querySelectorAll('#grid .card')].find((x) => x.classList.contains('not-installed'))?.querySelector('.title')?.click()`);
    await wait(9000);
    await shot('ficha-no-instalado.png');
    await js(`document.querySelector('#gameTrailers')?.scrollIntoView()`);
    await wait(1000);
    await shot('ficha-trailer.png');
    await js(`document.querySelector('#gameTrailers video')?.play()`);
    await wait(8000);
    await js(`(() => { const v = document.querySelector('#gameTrailers video'); if (v) console.log('TRAILER t=' + v.currentTime.toFixed(1) + ' ready=' + v.readyState + ' dur=' + v.duration + ' err=' + (v.error && v.error.code)); })()`);
    await shot('ficha-trailer-play.png');
    await js(`document.querySelector('#gameSimilar')?.scrollIntoView()`);
    await wait(800);
    await shot('ficha-parecidos.png');
    await js(`document.querySelector('#gameDlg').close()`);
    await js(`document.documentElement.dataset.theme = 'light'; document.querySelector('#appBg').style.backgroundImage = 'url(' + JSON.stringify(document.querySelector('#hero img')?.src || '') + ')'; document.body.classList.add('has-bg')`);
    await wait(1500);
    await shot('tema-claro.png');
    await js(`document.documentElement.dataset.theme = 'dark'`);
    await wait(800);
    await shot('fondo-oscuro.png');
    await js(`document.querySelector('#settingsBtn').click()`);
    await wait(4000);
    await js(`document.querySelector('#setTabs [data-tab=partidas]').click()`);
    await wait(800);
    await shot('ajustes-partidas.png');
    await js(`document.querySelector('#setTabs [data-tab=apariencia]').click()`);
    await wait(800);
    await shot('ajustes-apariencia.png');
    await js(`document.querySelector('#settings').close(); window.appearance.apply({ ...state.settings, palette: 'oceano', theme: 'light' }, findGame)`);
    await wait(1200);
    await shot('paleta-oceano-claro.png');
    await js(`window.appearance.apply({ ...state.settings, palette: 'noche', theme: 'dark' }, findGame)`);
    await wait(1200);
    await shot('paleta-noche.png');
    app.quit();
  });
}

const ALLOWED = /^(steam:\/\/(rungameid|install|uninstall|store)\/|com\.epicgames\.launcher:\/\/apps\/|https:\/\/(store\.steampowered\.com|steamcommunity\.com|github\.com|www\.epicgames\.com|store\.epicgames\.com)\/|uplay:\/\/launch\/|link2ea:\/\/launchgame\/|https:\/\/(www\.nintenderos\.com|www\.nintendolife\.com)\/|wemod:\/\/play\?titleId=\d+&gameId=\d+$|https:\/\/www\.wemod\.com\/cheats\/|https:\/\/www\.nexusmods\.com\/search\?|https:\/\/enka\.network\/u\/\d+\/?$|https:\/\/developer\.spotify\.com\/dashboard|https:\/\/www\.hoyolab\.com\/article\/\d+$|https:\/\/(openrgb\.org|pawnio\.eu)\/|https:\/\/www\.workana\.com\/(job|dashboard|freelancer)\/?|spotify:(track|playlist|album|artist):[A-Za-z0-9]+$|https:\/\/howlongtobeat\.com\/\?q=|https:\/\/www\.youtube\.com\/results\?|https:\/\/www\.google\.com\/search\?)/;
function openSafe(url) {
  if (typeof url !== 'string' || !ALLOWED.test(url)) return false;
  shell.openExternal(url);
  return true;
}

// Sin bandeja ni procesos residentes: al cerrar la ventana, la app termina
// (y si el modo enfoque estaba activo, antes lo deja todo como estaba).
app.on('window-all-closed', () => {
  if (keepAlive()) return;
  app.quit();
});
app.on('before-quit', () => {
  lan?.stop();
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
  app.setAppUserModelId('ViperTeca');
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
  if (store.getSettings().lanAuto && !process.env.BJ_SNAPSHOT) lanServer().start().catch(() => {});
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
    setTimeout(priceAlerts, 90000);
    setInterval(priceAlerts, 6 * 3600000);
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
    backupDir: store.getSettings().backupDir || null,
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
// Recomendaciones de Steam y Epic según tus gustos (no incluye lo que ya tienes ni tu lista de deseados)
ipcMain.handle('recs:get', async (_e, force) => {
  const settings = store.getSettings();
  steam.setRegion(settings.country);
  const games = store.read('library.json', null)?.games || [];
  const names = store.read('tags.json', null)?.names || {};
  const tagIdByName = Object.fromEntries(Object.entries(names).map(([id, n]) => [n, Number(id)]));
  const wl = store.read('wishlist.json', null);
  const exclude = new Set([
    ...games.filter((g) => g.store === 'steam').map((g) => Number(g.id.split(':')[1])),
    ...games.map((g) => g.steamAppid).filter(Boolean),
    ...(wl?.items || []).map((i) => i.appid),
  ]);
  return recs.build({ games, user: extras.readUserGames(store.read), tagIdByName, exclude, read: store.read, write: store.write, force: !!force, country: settings.country });
});
ipcMain.handle('trailers:get', (_e, appid) => (Number.isInteger(appid) && appid > 0 ? storeinfo.trailers(appid) : []));
ipcMain.handle('dlc:get', async (_e, force) => {
  steam.setRegion(store.getSettings().country);
  return storeinfo.dlcDeals({
    games: store.read('library.json', null)?.games || [],
    user: extras.readUserGames(store.read),
    steamPath: await steam.findSteamPath().catch(() => null),
    read: store.read,
    write: store.write,
    force: !!force,
  });
});
ipcMain.handle('canrun:get', (_e, appids) => {
  const ids = (Array.isArray(appids) ? appids : []).filter((x) => Number.isInteger(x) && x > 0).slice(0, 150);
  return storeinfo.canRun(ids, { read: store.read, write: store.write });
});
ipcMain.handle('nintendo:get', (_e, force) => news.nintendo({ read: store.read, write: store.write, force: !!force }));
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
  const root = saves.backupRoot(ctx);
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
  delete settings.hoyolabEnc; // la sesión de HoYoLAB tampoco sale del PC
  delete settings.spotifyEnc;
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

// ---------- Aviso cuando un juego de tu lista de deseados se rebaja ----------
async function priceAlerts() {
  const st = store.getSettings();
  if (st.priceAlerts === false) return;
  try {
    let steamId = st.steamId;
    if (!steamId) {
      const p = await steam.findSteamPath();
      steamId = p && steam.detectSteamId(p);
    }
    if (!steamId) return;
    steam.setRegion(st.country);
    const res = await steam.getWishlistDeals(store.getSteamKey(), steamId);
    store.write('wishlist.json', { ...res, country: st.country, fetchedAt: Date.now() });
    const seen = store.read('price-alerts.json', null);
    const now = {};
    for (const i of res.items) if (i.price?.discountPct > 0) now[i.appid] = i.price.discountPct;
    if (seen) {
      // Solo lo que se acaba de rebajar o baja más que la última vez
      const fresh = res.items.filter((i) => now[i.appid] && (!seen[i.appid] || now[i.appid] > seen[i.appid]));
      if (fresh.length === 1) {
        const i = fresh[0];
        notify(`${i.name} está rebajado`, `−${i.price.discountPct}%: ahora ${i.price.final}. Haz clic para verlo en Steam.`, `https://store.steampowered.com/app/${i.appid}/`);
      } else if (fresh.length > 1) {
        notify(`${fresh.length} juegos de tu lista de deseados están rebajados`, fresh.slice(0, 4).map((i) => `${i.name} (−${i.price.discountPct}%)`).join(', '));
      }
    }
    store.write('price-alerts.json', now);
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
  if (store.getSettings().genshinUid) globalShortcut.register('CommandOrControl+Alt+M', questHotkey);
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
  if (data && ('hotkey' in data || 'genshinUid' in data) && !process.env.BJ_SNAPSHOT) registerHotkey();
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
    try {
      const map = await trainers.catalog({ read: store.read, write: store.write });
      for (const g of result.games) {
        const t = g.kind !== 'tool' && trainers.forGame(map, g);
        if (t) g.trainer = { cheats: t.cheats, play: trainers.playUrl(t), web: trainers.webUrl(t) };
        else delete g.trainer;
      }
    } catch {}
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
ipcMain.handle('win:fullscreen', () => {
  if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
});
// Juegos de otras tiendas que se abren con su launcher: el programa y sus
// argumentos salen de la biblioteca guardada (los detectó la app), nunca de la página.
function launchFromMain(g) {
  if (!g.launch) {
    if (!openSafe(g.installed ? g.launchUrl : g.installUrl)) throw new Error('Este juego se abre desde su launcher.');
    return true;
  }
  const l = g.launch;
  if (!l?.exe || !/\.exe$/i.test(l.exe) || !require('fs').existsSync(l.exe)) throw new Error('No se encuentra el launcher de este juego.');
  const { spawn } = require('child_process');
  spawn(l.exe, l.args || [], { cwd: l.cwd || path.dirname(l.exe), detached: true, stdio: 'ignore' }).unref();
  return true;
}
ipcMain.handle('game:launch', (_e, id) => {
  const g = (store.read('library.json', null)?.games || []).find((x) => x.id === id);
  if (!g) throw new Error('No se encuentra ese juego.');
  return launchFromMain(g);
});

// ---------- Biblioteca en el móvil ----------
let lan = null;
function lanServer() {
  if (!lan) {
    const s = store.read('settings.json', {});
    if (!s.lanToken) {
      s.lanToken = require('crypto').randomBytes(12).toString('hex');
      store.write('settings.json', s);
    }
    lan = new LanServer({ games: () => store.read('library.json', null)?.games || [], launch: async (g) => launchFromMain(g), token: s.lanToken });
  }
  return lan;
}
ipcMain.handle('lan:status', () => (lan ? lan.info() : { running: false }));
ipcMain.handle('lan:start', () => lanServer().start());
ipcMain.handle('lan:stop', () => {
  lan?.stop();
  return { running: false };
});
ipcMain.handle('lan:newCode', () => {
  const s = store.read('settings.json', {});
  s.lanToken = require('crypto').randomBytes(12).toString('hex');
  store.write('settings.json', s);
  const wasRunning = lan?.running;
  lan?.stop();
  lan = null;
  return wasRunning ? lanServer().start() : { running: false };
});

// ---------- Carpeta de las copias de partidas ----------
ipcMain.handle('saves:dirs', async () => {
  const ctx = await localCtx();
  return { current: saves.backupRoot(ctx), custom: !!ctx.backupDir, clouds: saves.cloudDirs() };
});
ipcMain.handle('saves:setDir', async (_e, dir) => {
  let target = dir;
  if (dir === 'pick') {
    const r = await dialog.showOpenDialog(win, { title: 'Carpeta para las copias de partidas', properties: ['openDirectory', 'createDirectory'], defaultPath: saves.cloudDirs()[0]?.dir || app.getPath('documents') });
    if (r.canceled || !r.filePaths[0]) return null;
    target = r.filePaths[0];
  }
  if (target && (!path.isAbsolute(target) || !require('fs').existsSync(target))) throw new Error('Esa carpeta no existe.');
  const before = await localCtx();
  const after = { ...before, backupDir: target || null };
  const moved = saves.moveBackups(before, after);
  const s = store.read('settings.json', {});
  if (target) s.backupDir = target;
  else delete s.backupDir;
  store.write('settings.json', s);
  return { current: saves.backupRoot(after), moved };
});

// ---------- Exportar la biblioteca (CSV para Excel o página para compartir) ----------
ipcMain.handle('library:export', async (_e, format, opts = {}) => {
  const games = (store.read('library.json', null)?.games || []).filter((g) => g.kind !== 'tool');
  const user = extras.readUserGames(store.read);
  const sessions = store.read('sessions.json', []);
  const tracked = {};
  for (const s of sessions) tracked[s.id] = (tracked[s.id] || 0) + Math.max(0, (s.end - s.start) / 60000);
  const STATUS = { pending: 'Pendiente', playing: 'Jugando', finished: 'Terminado', dropped: 'Abandonado' };
  const STORES = { steam: 'Steam', epic: 'Epic Games', riot: 'Riot', rockstar: 'Rockstar', gog: 'GOG', ea: 'EA app', ubisoft: 'Ubisoft Connect' };
  const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '');
  const rows = games
    .map((g) => {
      const u = user[g.id] || {};
      const min = g.playtimeMin || tracked[g.id] || 0;
      return {
        title: g.title,
        store: STORES[g.store] || g.store,
        installed: g.installed,
        hours: min ? Math.round((min / 60) * 10) / 10 : 0,
        last: day(g.lastPlayed),
        bought: day(g.purchased),
        status: STATUS[u.status] || '',
        rating: u.rating || 0,
        fav: !!u.fav,
        cols: (u.cols || []).join(', '),
        note: opts.notes ? u.note || '' : '',
        tags: (g.tags || []).join(', '),
        saga: g.saga || '',
        cover: g.cover || '',
        url: g.storeUrl || '',
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
  const csv = format === 'csv';
  const r = await dialog.showSaveDialog(win, {
    title: csv ? 'Exportar biblioteca a CSV' : 'Crear página de tu biblioteca',
    defaultPath: path.join(app.getPath('documents'), `Mi biblioteca de juegos ${new Date().toISOString().slice(0, 10)}.${csv ? 'csv' : 'html'}`),
    filters: [csv ? { name: 'CSV (Excel)', extensions: ['csv'] } : { name: 'Página web', extensions: ['html'] }],
  });
  if (r.canceled || !r.filePath) return null;
  if (csv) {
    // Punto y coma y BOM: así Excel en español lo abre bien a la primera
    const q = (v) => {
      const t = String(v ?? '');
      return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ['Título', 'Tienda', 'Instalado', 'Horas', 'Última partida', 'Comprado', 'Estado', 'Tu nota', 'Favorito', 'Colecciones', 'Categorías', 'Saga'];
    if (opts.notes) head.push('Notas');
    const lines = rows.map((x) => {
      const cells = [x.title, x.store, x.installed ? 'Sí' : 'No', String(x.hours).replace('.', ','), x.last, x.bought, x.status, x.rating || '', x.fav ? 'Sí' : '', x.cols, x.tags, x.saga];
      if (opts.notes) cells.push(x.note);
      return cells.map(q).join(';');
    });
    require('fs').writeFileSync(r.filePath, '\ufeff' + [head.join(';'), ...lines].join('\r\n'), 'utf8');
  } else {
    require('fs').writeFileSync(r.filePath, require('./src/share-page').render(rows, { notes: !!opts.notes }), 'utf8');
  }
  return { file: r.filePath, games: rows.length };
});

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
ipcMain.handle('wand:installed', () => trainers.installed());
// Perfil de Genshin: con el UID guardado (o uno para probar sin guardarlo)
// ---------- Genshin: deseos, HoYoLAB, prioridades y misiones ----------
const gUid = () => store.getSettings().genshinUid;
ipcMain.handle('gwish:get', () => genshinWish.summary(store.read('genshin-wishes.json', { items: {} })));
ipcMain.handle('gwish:import', (e) => genshinWish.importHistory({ read: store.read, write: store.write, onProgress: (t) => !e.sender.isDestroyed() && e.sender.send('gwish:progress', t) }));
ipcMain.handle('hoyo:status', () => ({ linked: hoyolab.linked(store.read) }));
ipcMain.handle('hoyo:login', async () => {
  const ok = await hoyolab.login(win, { read: store.read, write: store.write });
  return { linked: ok };
});
ipcMain.handle('hoyo:get', (_e, force) => (gUid() ? hoyolab.overview(gUid(), { read: store.read, write: store.write, force: !!force }) : { linked: hoyolab.linked(store.read) }));
ipcMain.handle('hoyo:logout', () => hoyolab.logout({ read: store.read, write: store.write }));
ipcMain.handle('hoyo:details', (_e, ids) => hoyolab.details(gUid(), (Array.isArray(ids) ? ids : []).slice(0, 10), { read: store.read }));
ipcMain.handle('gnews:get', (_e, force) => genshinNews.overview(gUid(), { read: store.read, write: store.write, force: !!force }));
ipcMain.handle('gtasks:get', () => store.read('genshin-tasks.json', []));
ipcMain.handle('gtasks:save', (_e, list) => {
  const clean = (Array.isArray(list) ? list : []).slice(0, 300).map((t) => ({
    id: String(t.id || '').slice(0, 40) || Math.random().toString(36).slice(2),
    text: String(t.text || '').trim().slice(0, 160),
    kind: String(t.kind || 'Otra').slice(0, 30),
    done: !!t.done,
    at: Number(t.at) || Date.now(),
  })).filter((t) => t.text);
  store.write('genshin-tasks.json', clean);
  return clean;
});
// Misiones desde una captura del diario de misiones (OCR de Windows)
async function questsFromFile(file) {
  const res = await ocr.recognize(file);
  return { quests: ocr.questsFromOcr(res), lines: (res.lines || []).length };
}
async function captureScreen() {
  const { desktopCapturer, screen } = require('electron');
  const d = screen.getPrimaryDisplay();
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  if (!src) throw new Error('No se pudo capturar la pantalla.');
  const file = path.join(app.getPath('temp'), `viperteca-misiones-${Date.now()}.png`);
  require('fs').writeFileSync(file, src.thumbnail.toPNG());
  try {
    return await questsFromFile(file);
  } finally {
    require('fs').rmSync(file, { force: true });
  }
}
ipcMain.handle('gquests:image', async () => {
  const shots = genshinWish.screenshotDir();
  const r = await dialog.showOpenDialog(win, { title: 'Captura del diario de misiones', defaultPath: shots || app.getPath('pictures'), filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return questsFromFile(r.filePaths[0]);
});
ipcMain.handle('gquests:capture', async (_e, delay) => {
  await new Promise((res) => setTimeout(res, Math.max(0, Math.min(15, Number(delay) || 0)) * 1000));
  return captureScreen();
});
ipcMain.handle('gquests:pending', () => {
  const p = store.read('genshin-ocr-pending.json', null);
  store.write('genshin-ocr-pending.json', null);
  return p;
});
// Ctrl+Alt+M dentro del juego: captura el diario de misiones y lo deja listo en la app
async function questHotkey() {
  try {
    const r = await captureScreen();
    store.write('genshin-ocr-pending.json', { at: Date.now(), ...r });
    notify(r.quests.length ? `${r.quests.length} misiones leídas` : 'No se encontraron misiones', r.quests.length ? 'Abre ViperTeca → Genshin → Prioridades para elegir cuáles guardar.' : 'Abre el diario de misiones (J) y vuelve a pulsar Ctrl+Alt+M.');
    if (win && !win.isDestroyed()) win.webContents.send('gquests:pending');
  } catch (e) {
    notify('No se pudo leer la pantalla', e.message);
  }
}
// ---------- Saldos de Steam y Epic ----------
ipcMain.handle('wallet:cached', () => store.read('wallets.json', {}));
ipcMain.handle('wallet:refresh', async (_e, key, interactive) => {
  if (!['steam', 'epic'].includes(key)) throw new Error('Tienda desconocida.');
  const r = await wallets.refresh(key, { parent: win, interactive: !!interactive });
  const all = store.read('wallets.json', {});
  if (r.ok) all[key] = { items: r.items, at: r.at };
  else if (r.needsLogin && !interactive) all[key] = { ...(all[key] || {}), needsLogin: true };
  store.write('wallets.json', all);
  if (!r.ok && interactive) throw new Error(r.error || 'No se pudo leer el saldo.');
  return all;
});
ipcMain.handle('wallet:logout', async (_e, key) => {
  await wallets.logout(key);
  const all = store.read('wallets.json', {});
  delete all[key];
  store.write('wallets.json', all);
  return all;
});

// ---------- Workana ----------
ipcMain.handle('wk:state', () => store.read('workana.json', { queries: ['wordpress', 'elementor', 'woocommerce', 'landing page', 'pagina web', 'desarrollo web'], publication: '3d', done: {}, last: null }));
ipcMain.handle('wk:saveState', (_e, patchState) => {
  const s = store.read('workana.json', { done: {} });
  const next = { ...s, ...patchState };
  store.write('workana.json', next);
  return next;
});
ipcMain.handle('wk:search', async (e, opts) => {
  const queries = (Array.isArray(opts?.queries) ? opts.queries : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 8);
  if (!queries.length) throw new Error('Añade al menos una palabra para buscar.');
  const list = await workana.search({ queries, publication: ['1d', '3d', '1w', '1m'].includes(opts?.publication) ? opts.publication : '3d', pages: 2, onProgress: (t) => !e.sender.isDestroyed() && e.sender.send('wk:progress', t) });
  const s = store.read('workana.json', { done: {} });
  s.last = { at: Date.now(), list };
  store.write('workana.json', s);
  return s.last;
});
ipcMain.handle('wk:build', (_e, p) => proposal.build(p || {}));
ipcMain.handle('wk:check', (_e, text) => proposal.check(String(text || '')));
ipcMain.handle('wk:clean', (_e, text) => proposal.clean(String(text || '')));
ipcMain.handle('wk:copy', (_e, text) => {
  require('electron').clipboard.writeText(String(text || ''));
  return true;
});

// ---------- Motor de trucos ----------
let cheatTarget = null; // { pid, name }
const cheatKeys = new Map(); // atajo -> { key, entry, value }
const cheatFrozen = new Set();
trainer.setListener((m) => {
  if (m.event === 'exited') {
    cheatTarget = null;
    cheatFrozen.clear();
    for (const accel of cheatKeys.keys()) globalShortcut.unregister(accel);
    cheatKeys.clear();
  }
  if (win && !win.isDestroyed()) win.webContents.send('trainer:event', m);
});
const tables = () => store.read('trainer-tables.json', {});
ipcMain.handle('trainer:procs', async () => {
  let exes = [];
  try {
    exes = [...(focus.gameProcessNames?.() || [])];
  } catch {}
  return trainer.processes(exes);
});
ipcMain.handle('trainer:attach', async (_e, p) => {
  const r = await trainer.attach({ pid: Number(p.pid), name: String(p.name || '') });
  cheatTarget = { pid: Number(p.pid), name: String(p.name || '') };
  return { ...r, table: tables()[cheatTarget.name.toLowerCase()] || [] };
});
ipcMain.handle('trainer:detach', async () => {
  for (const accel of cheatKeys.keys()) globalShortcut.unregister(accel);
  cheatKeys.clear();
  cheatFrozen.clear();
  cheatTarget = null;
  return trainer.call('detach');
});
ipcMain.handle('trainer:call', (_e, cmd, args) => {
  if (!['firstScan', 'nextScan', 'results', 'read', 'set', 'where', 'status'].includes(cmd)) throw new Error('Orden no válida.');
  return trainer.call(cmd, args);
});
ipcMain.handle('trainer:freeze', async (_e, key, entry, value, on) => {
  const r = await trainer.call('freeze', { key, entry, value, on: !!on });
  on ? cheatFrozen.add(key) : cheatFrozen.delete(key);
  return r;
});
ipcMain.handle('trainer:saveTable', (_e, list) => {
  if (!cheatTarget) throw new Error('Elige primero un juego.');
  const all = tables();
  all[cheatTarget.name.toLowerCase()] = (Array.isArray(list) ? list : []).slice(0, 300);
  store.write('trainer-tables.json', all);
  return true;
});
// Atajos de teclado globales (funcionan dentro del juego): activan o quitan el congelado
ipcMain.handle('trainer:hotkeys', (_e, list) => {
  for (const accel of cheatKeys.keys()) globalShortcut.unregister(accel);
  cheatKeys.clear();
  const failed = [];
  for (const h of Array.isArray(list) ? list : []) {
    if (!h.accel || !/^(Alt\+|Ctrl\+|Shift\+)*(F([1-9]|1[0-2])|[0-9]|Num[0-9])$/.test(h.accel)) continue;
    const accel = h.accel.replace(/^Ctrl\+/, 'CommandOrControl+').replace(/Num(\d)/, 'num$1');
    const ok = globalShortcut.register(accel, async () => {
      const on = !cheatFrozen.has(h.key);
      try {
        await trainer.call('freeze', { key: h.key, entry: h.entry, value: h.value, on });
        on ? cheatFrozen.add(h.key) : cheatFrozen.delete(h.key);
        if (win && !win.isDestroyed()) win.webContents.send('trainer:event', { event: 'hotkey', key: h.key, on });
      } catch {}
    });
    if (ok) cheatKeys.set(accel, h);
    else failed.push(h.accel);
  }
  return { failed };
});
ipcMain.handle('trainer:importCT', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Tabla de Cheat Engine', filters: [{ name: 'Tablas de Cheat Engine', extensions: ['ct', 'CT'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const xml = require('fs').readFileSync(r.filePaths[0], 'utf8');
  if (!/<CheatTable/i.test(xml)) throw new Error('Ese archivo no es una tabla de Cheat Engine.');
  return trainer.parseCT(xml);
});

// ---------- Iluminación RGB (OpenRGB) ----------
const rgbExe = () => rgb.findExe(store.read('settings.json', {}).openrgbPath);
ipcMain.handle('rgb:status', () => rgb.status(store.read('settings.json', {}).openrgbPath));
ipcMain.handle('rgb:start', async (_e, admin) => {
  await rgb.start(rgbExe(), !!admin);
  return rgb.status(store.read('settings.json', {}).openrgbPath);
});
ipcMain.handle('rgb:apply', (_e, id, opts) => rgb.apply(Number(id), opts || {}));
ipcMain.handle('rgb:applyAll', async (_e, opts) => {
  const r = await rgb.applyAll(opts || {});
  const s = store.read('settings.json', {});
  s.rgbLast = opts;
  store.write('settings.json', s);
  return r;
});
ipcMain.handle('rgb:resize', (_e, id, zone, leds) => rgb.resize(Number(id), Number(zone), Number(leds)));
ipcMain.handle('rgb:rescan', () => rgb.rescan());
ipcMain.handle('rgb:last', () => store.read('settings.json', {}).rgbLast || null);
ipcMain.handle('rgb:pickExe', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dónde está OpenRGB.exe', filters: [{ name: 'OpenRGB', extensions: ['exe'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const s = store.read('settings.json', {});
  s.openrgbPath = r.filePaths[0];
  store.write('settings.json', s);
  return s.openrgbPath;
});

// ---------- Spotify ----------
const sp = { read: store.read, write: store.write };
ipcMain.handle('sp:status', () => ({ linked: spotify.linked(store.read), clientId: store.read('settings.json', {}).spotifyClientId || '', redirect: spotify.REDIRECT }));
ipcMain.handle('sp:setClient', (_e, id) => {
  const v = String(id || '').trim();
  if (v && !/^[0-9a-f]{32}$/i.test(v)) throw new Error('El Client ID de Spotify tiene 32 caracteres (números y letras de la a a la f).');
  const s = store.read('settings.json', {});
  if (v) s.spotifyClientId = v;
  else delete s.spotifyClientId;
  store.write('settings.json', s);
  return true;
});
ipcMain.handle('sp:login', () => spotify.login(sp));
ipcMain.handle('sp:logout', () => spotify.logout(sp));
ipcMain.handle('sp:me', () => spotify.me(sp));
ipcMain.handle('sp:playlists', () => spotify.playlists(sp));
ipcMain.handle('sp:tracks', (_e, id) => (id === 'liked' ? spotify.liked(sp) : spotify.playlistTracks(sp, String(id))));
ipcMain.handle('sp:home', () => spotify.home(sp));
ipcMain.handle('sp:state', () => spotify.state(sp));
ipcMain.handle('sp:devices', () => spotify.devices(sp));
ipcMain.handle('sp:control', (_e, action, arg) => spotify.control(sp, String(action), arg || {}));
ipcMain.handle('sp:liked', (_e, ids) => spotify.isLiked(sp, Array.isArray(ids) ? ids.map(String) : []));

ipcMain.handle('genshin:get', (_e, force, uid) => {
  const id = uid || store.getSettings().genshinUid;
  if (!id) return null;
  return genshin.profile(String(id), { read: store.read, write: store.write, force: !!force });
});

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

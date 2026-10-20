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
const notion = require('./src/notion');
const repos = require('./src/repos');
const calendar = require('./src/calendar');
const sensors = require('./src/sensors');
const hltb = require('./src/hltb');
const genshinFarm = require('./src/genshin-farm');
const genshinCodes = require('./src/genshin-codes');
const webhealth = require('./src/webhealth');
const casa = require('./src/casa');
const anime = require('./src/anime');
const linkedin = require('./src/linkedin');
const codeedit = require('./src/codeedit');
const claudeChat = require('./src/claude-chat');
const marketplace = require('./src/marketplace');
const mail = require('./src/mail');
const steamfamily = require('./src/steamfamily');
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
      await js(`[...document.querySelectorAll('.wk-draftbox .btn')].find((b) => b.textContent === 'Postular')?.click()`);
      for (let i = 0; i < 30 && !(await js(`/Inicia sesión|Propuesta/.test(document.querySelector('.wk-draftbox > p.hint:last-of-type')?.textContent || '')`)); i++) await wait(1000);
      log(`POSTULAR ${await js(`document.querySelector('.wk-draftbox > p.hint:last-of-type')?.textContent`)}`);
      await shot('workana-postular.png');
      const bidShot = BrowserWindow.getAllWindows().find((w) => /Postular en Workana/.test(w.getTitle()));
      if (bidShot) require('fs').writeFileSync(require('path').join(dir, 'workana-ventana.png'), (await bidShot.webContents.capturePage()).toPNG());
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'v118') {
      const steps = (process.env.BJ_STEPS || 'dia,biblioteca,casa-pagos,casa-cumples,genshin-mapa,movil,ajustes').split(',');
      if (process.env.BJ_PANELTEST) {
        // el vigilante abre el panel en la pantalla del case y lo devuelve si se cierra
        try {
          panelWatch();
          await wait(9000);
          const d = panelTarget();
          log('PANEL destino ' + JSON.stringify(d && d.bounds) + ' abierto=' + !!(panelWin && !panelWin.isDestroyed()) + ' bounds=' + JSON.stringify(panelWin && !panelWin.isDestroyed() && panelWin.getBounds()) + ' visible=' + (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()));
          if (panelWin) fs.writeFileSync(path.join(dir, 'panel-case.png'), (await panelWin.webContents.capturePage()).toPNG());
          panelWin?.destroy();
          await wait(17000);
          log('PANEL tras cerrarlo: abierto=' + !!(panelWin && !panelWin.isDestroyed()) + ' bounds=' + JSON.stringify(panelWin && !panelWin.isDestroyed() && panelWin.getBounds()));
        } catch (e) {
          log('[error] panel: ' + e.stack);
        }
      }
      if (process.env.BJ_T127) {
        try {
          const t0 = Date.now();
          await repoDaily(true);
          log('T127 repos ' + Math.round((Date.now() - t0) / 1000) + 's ' + JSON.stringify((siteState().security?.repos || []).length));
          await siteDaily(true);
          const st = siteState();
          log('T127 daily ' + Math.round((Date.now() - t0) / 1000) + 's ' + JSON.stringify({ dom: Object.values(st.domains).map((d) => d.domain + ':' + (d.until ? new Date(d.until).toISOString().slice(0, 10) : '?')), stale: Object.entries(st.stale).map(([u, x]) => u + ':' + x.items.map((i) => i.label).join('|')), shots: Object.entries(st.shots).map(([u, x]) => u + ':' + Object.entries(x.views).map(([k, v]) => k + v.change).join(',')) }));
          const s = await standup();
          log('T127 standup ' + JSON.stringify(s.squads.map((x) => x.text.slice(0, 160))));
          const first = healthSites()[0];
          const rep = await siteReport(first.url, new Date().toLocaleDateString('sv').slice(0, 7), 'en');
          log('T127 report ' + rep.file);
          await js(`showView('webs'); setTimeout(() => { [...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Clientes')?.click(); setTimeout(() => document.querySelector('.cl-card header')?.click(), 1500); }, 1200)`);
          await wait(4500);
          await shot('clientes.png');
          await js(`[...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Squads')?.click()`);
          await wait(5000);
          await shot('squads-extras.png');
        } catch (e) {
          log('[error] t127: ' + e.stack);
        }
      }
      if (process.env.BJ_T126) {
        // prueba 1.26: recibo de ejemplo, compras de Emi y precios de regalos
        try {
          const rw = new BrowserWindow({ show: false, width: 620, height: 820, webPreferences: { sandbox: true } });
          await rw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:16px Arial;padding:30px;background:#fff"><h2>ICE - Instituto Costarricense de Electricidad</h2><p>Servicio eléctrico residencial</p><p>Cliente: VINCENZO ZOFFOLI · Guápiles, Pococí</p><p>NISE 4521-8890</p><hr><p>Período facturado: 15/09/2026 al 14/10/2026</p><p>Consumo: 212 kWh</p><p>Saldo anterior: ¢0,00</p><p>Cargo por energía ¢21.430,00</p><p>Alumbrado público ¢1.270,00</p><p>Impuesto bomberos ¢200,00</p><p>IVA ¢2.000,00</p><h1>TOTAL A PAGAR ¢24.900,00</h1><p><b>Fecha de vencimiento: 27/10/2026</b></p></body>'));
          await wait(800);
          const img = (await rw.webContents.capturePage()).toDataURL();
          rw.destroy();
          const r = await readReceipt(img);
          log('RECIBO ' + JSON.stringify({ ...r, options: undefined }));
        } catch (e) {
          log('[error] recibo: ' + e.stack);
        }
        try {
          const info = await lanServer().start();
          const base = `http://127.0.0.1:${info.port}`;
          const g = encodeURIComponent(giftToken());
          const add = await fetch(`${base}/api/regalos/compras/add?g=${g}&name=Leche%20de%20almendra&qty=2`, { method: 'POST' }).then((x) => x.json());
          const list = await fetch(`${base}/api/regalos/compras?g=${g}`).then((x) => x.json());
          const bad = await fetch(`${base}/api/regalos/compras?g=malo`).then((x) => x.status);
          log('COMPRAS ' + JSON.stringify({ add, n: list.items.length, ultimo: list.items.find((x) => x.by === 'Emi'), sinCodigo: bad }));
          const w = await weekReview();
          log('SEMANA ' + JSON.stringify({ juegos: w.games.total, series: w.series.length, gasto: w.spending, pagos: w.pays.length, cumples: w.bdays.length, fechas: w.dates }));
          const pr = await giftwatch.checkPrices(giftDeps(), { limit: 3, force: true });
          log('PRECIOS ' + JSON.stringify(pr) + ' ' + JSON.stringify(store.read('gift-prices.json', {})).slice(0, 400));
        } catch (e) {
          log('[error] t126: ' + e.stack);
        }
      }
      if (process.env.BJ_GIFTTEST) {
        // prueba: el celular de Emi añade un regalo por enlace
        try {
          const info = await lanServer().start();
          const local = info.gift.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${info.port}`);
          const phone = new BrowserWindow({ width: 390, height: 844, show: true, webPreferences: { partition: 'snap-emi', sandbox: true } });
          phone.webContents.on('console-message', (e) => log(`[emi] ${e.message}`));
          await phone.loadURL(local);
          await wait(1500);
          await js(`showView('casa-regalos')`);
          await phone.webContents.executeJavaScript(`document.querySelector('#link').value = ${JSON.stringify(process.env.BJ_GIFTTEST)}; document.querySelector('#f').requestSubmit();`);
          await wait(2500);
          fs.writeFileSync(path.join(dir, 'emi-leyendo.png'), (await phone.webContents.capturePage()).toPNG());
          await shot('regalos-leyendo.png');
          await wait(40000);
          fs.writeFileSync(path.join(dir, 'emi-listo.png'), (await phone.webContents.capturePage()).toPNG());
          await shot('regalos-listo.png');
          const g = (casa.load(ctxRW).gifts || []).filter((x) => x.by === 'Emi').map((x) => ({ name: x.name, price: x.price, currency: x.currency, store: x.store, reading: x.reading, img: (x.image || '').slice(0, 30) }));
          log('GIFT ' + JSON.stringify(g));
          phone.destroy();
        } catch (e) {
          log('[error] gift: ' + e.stack);
        }
      }
      if (process.env.BJ_NFTEST) {
        try {
          const w = streaming.open('netflix');
          await wait(9000);
          log('NF url ' + w.webContents.getURL());
          const probe = await w.webContents.executeJavaScript(`(async () => { const m = window.netflix && window.netflix.reactContext && window.netflix.reactContext.models; const b = m && m.serverDefs && m.serverDefs.data && m.serverDefs.data.BUILD_IDENTIFIER; const out = { hasCtx: !!m, build: b || null, who: m && m.userInfo && m.userInfo.data && { name: m.userInfo.data.name, status: m.userInfo.data.membershipStatus } }; if (b) { const r = await fetch('/api/shakti/' + b + '/viewingactivity?pg=0&pgSize=5', { credentials: 'include' }); out.shakti = r.status; out.shaktiBody = (await r.text()).slice(0, 300); } return out; })()`, true).catch((e) => ({ err: e.message }));
          log('NF probe ' + JSON.stringify(probe));
          await w.loadURL('https://www.netflix.com/viewingactivity');
          await wait(5000);
          const dom = await w.webContents.executeJavaScript(`(() => { const rows = [...document.querySelectorAll('li.retableRow, .retable li')]; return { n: rows.length, sample: rows.slice(0, 3).map((r) => r.outerHTML.slice(0, 500)) }; })()`, true).catch((e) => ({ err: e.message }));
          log('NF dom ' + JSON.stringify(dom));
          w.destroy();
        } catch (e) { log('[error] nf ' + e.message); }
        return app.quit();
      }
      if (process.env.BJ_CRAWL) {
        for (const s of healthSites().slice(0, Number(process.env.BJ_CRAWL) || 3)) {
          const t0 = Date.now();
          await runSiteChecks({ only: s.url, notifyNew: false }).catch((e) => log('[error] crawl ' + e.message));
          const st = alertsState();
          log('CRAWL ' + s.url + ' ' + (Date.now() - t0) + 'ms ' + JSON.stringify(st.sites[s.url]) + ' issues=' + JSON.stringify(Object.values(st.issues).filter((i) => i.site === s.url && i.open).map((i) => i.sev + ':' + i.title)));
        }
      }
      const CODE = {
        dia: [`showView('day')`, 4000],
        biblioteca: [`showView('library')`, 2500],
        'casa-pagos': [`showView('casa-pagos')`, 2500],
        'casa-cumples': [`showView('casa-cumples')`, 2500],
        'genshin-mapa': [`showView('genshin'); setGenshinTab('mapa')`, 3000],
        movil: [`showView('lan')`, 3000],
        ajustes: [`openSettings?.(); setTimeout(() => { showSettingsTab?.('apariencia'); }, 500)`, 2500],
        logros: [`document.querySelector('dialog[open]')?.close(); showView('ach')`, 3000],
        asistente: [`showView('assist')`, 2000],
        'r-cal': [`showView('cal')`, 3500],
        'r-notion': [`showView('notion')`, 4000],
        'r-webs': [`showView('webs')`, 4000],
        'stats': [`showView('stats')`, 3500],
        'x-stats': [`showView('stats'); setTimeout(() => document.getElementById('gxSpend')?.scrollIntoView(), 6000)`, 9000],
        'x-ach': [`showView('ach')`, 40000],
        'x-deals': [`showView('deals'); setTimeout(() => document.getElementById('gxGp')?.scrollIntoView(), 20000)`, 26000],
        'x-friends': [`showView('friends')`, 25000],
        'x-calc': [`showView('genshin'); setGenshinTab('tiradas'); setTimeout(() => { document.querySelector('.gc-inc')?.setAttribute('open', ''); document.querySelector('.gc-form')?.scrollIntoView(); }, 4000)`, 7000],
        'ach': [`showView('ach')`, 3500],
        'backlog': [`showView('backlog')`, 4000],
        'c-compras': [`showView('casa-compras')`, 2500],
        'c-presu': [`showView('casa-presupuesto')`, 3000],
        'c-regalos': [`showView('casa-regalos')`, 2500],
        'g-viene': [`showView('genshin'); setGenshinTab('viene'); setTimeout(() => document.querySelectorAll('.ai-head .btn')[1]?.click(), 1500)`, 200000],
        'g-viene2': [`document.querySelector('.ai-versions')?.scrollIntoView()`, 1500],
        'g-viene3': [`showView('genshin'); setGenshinTab('viene')`, 4000],
        'g-viene4': [`document.querySelector('.ai-versions')?.scrollIntoView()`, 1500],
        'g-perfil2': [`showView('genshin'); setGenshinTab('perfil')`, 6000],
        'g-perfil3': [`document.querySelector('.gi-roster')?.scrollIntoView()`, 2500],
        'amigos': [`showView('friends')`, 5000],
        'ofertas': [`showView('deals')`, 5000],
        'w-alertas': [`showView('webs'); setTimeout(() => [...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Alertas')?.click(), 1500)`, 5000],
        'w-squads': [`[...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Squads')?.click()`, 6000],
        'p-servicios': [`showView('casa-pagos'); setTimeout(() => document.querySelector('.bl')?.scrollIntoView({ block: 'center' }), 1500)`, 3500],
        'w-lanz': [`showView('webs'); setTimeout(() => { [...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Lanzamientos')?.click(); window.api.launch.check('https://quesitosexpress.com/', 'Quesito’s Express').catch((e) => console.error('LANZ: ' + e.message)); }, 1500)`, 110000],
        'w-week': [`[...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Squads')?.click(); window.api.teamWeek.run().then(() => [...document.querySelectorAll('.rx-tabs button')].find((x) => x.textContent === 'Squads')?.click()).catch((e) => console.error('SEMANA: ' + e.message))`, 240000],
        'viendo': [`showView('viendo')`, 9000],
        'viendo-ai': [`window.api.stream.ai().then(() => document.querySelector('#viendoBody .toolbar .btn.subtle')?.click()).catch((e) => console.error('IA: ' + e.message))`, 200000],
        'viendo-ai2': [`document.querySelector('.vw-ai')?.scrollIntoView()`, 1500],
        'c-menu': [`showView('casa-menu')`, 2500],
        'c-hogar': [`showView('casa-hogar')`, 2500],
        'c-comp': [`showView('casa-compartidos')`, 2500],
        'sagas': [`showView('sagas')`, 4000],
        'dia2': [`showView('day'); setTimeout(() => document.querySelector('.md-sec:nth-of-type(2)')?.scrollIntoView(), 3000)`, 4500],
        'widget': [`window.api.widget.toggle(true)`, 5000],
        'g-farmeo': [`showView('genshin'); setGenshinTab('farmeo')`, 7000],
        'g-farmeo2': [`document.querySelector('.gf-inv')?.scrollIntoView()`, 1500],
        'g-deseos': [`setGenshinTab('deseos'); setTimeout(() => document.querySelector('.luck')?.scrollIntoView(), 2500)`, 4000],
        'g-notas': [`setGenshinTab('notas'); setTimeout(() => document.querySelector('.hc')?.scrollIntoView(), 6000)`, 8000],
        'g-arts': [`document.querySelector('.hc-arts')?.scrollIntoView()`, 1500],
        'g-perfil': [`setGenshinTab('perfil'); setTimeout(() => document.querySelector('.gi-arts')?.scrollIntoView(), 3000)`, 5000],
      };
      for (const name of steps) {
        const [code, ms] = CODE[name] || [name, 2000];
        await js(code).catch((e) => log(`[error] ${name}: ${e.message}`));
        await wait(ms);
        await shot(`${name}.png`);
      }
      if (widgetWin && !widgetWin.isDestroyed()) { fs.writeFileSync(path.join(dir, 'widget-ventana.png'), (await widgetWin.webContents.capturePage()).toPNG()); openWidget(false); }
      if (process.env.BJ_PANEL) {
        try {
          openPanel();
          await wait(9000);
          if (panelWin) fs.writeFileSync(path.join(dir, 'panel-case.png'), (await panelWin.webContents.capturePage()).toPNG());
          panelWin?.destroy();
        } catch (e) {
          log('[error] panel: ' + e.message);
        }
      }
      // la app del iPhone, a tamaño de teléfono
      try {
        const info = await lanServer().start();
        log(`LAN ${JSON.stringify({ mUrl: !!info.mUrl, ts: info.tailscale })}`);
        const phone = new BrowserWindow({ width: 390, height: 844, show: true, webPreferences: { partition: 'snap-phone', sandbox: true } });
        phone.webContents.on('console-message', (e) => log(`[movil] ${e.message}`));
        const local = info.mUrl.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${info.port}`);
        for (const tab of ['hoy', 'casa', 'juegos', 'genshin', 'mas']) {
          await phone.loadURL(local);
          await wait(800);
          await phone.webContents.executeJavaScript(`localStorage.setItem('vt-tab', '${tab}'); localStorage.setItem('vt-sub', JSON.stringify({ mas: 'pc', casa: 'pagos' })); location.reload()`).catch(() => {});
          await wait(3500);
          fs.writeFileSync(path.join(dir, `movil-${tab}.png`), (await phone.webContents.capturePage()).toPNG());
        }
        phone.destroy();
        lan.stop();
      } catch (e) {
        log(`[error] movil: ${e.message}`);
      }
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'v117') {
      const steps = [
        ['dia', `showView('day')`, 5000],
        ['dia-abajo', `document.querySelector('.dy-phone')?.scrollIntoView()`, 1500],
        ['rendimiento', `showView('library'); const ids = new Set((state.sessions?.list || []).filter((s) => s.fps).map((s) => s.id)); openGame(games().find((g) => ids.has(g.id)) || games()[0]); setTimeout(() => document.querySelector('#gamePerf')?.scrollIntoView(), 4000)`, 6000],
        ['tiradas', `document.querySelector('#gameDlg')?.close(); showView('genshin'); setGenshinTab('tiradas')`, 6000],
        ['farmeo', `setGenshinTab('farmeo'); setTimeout(() => document.querySelector('.gt')?.scrollIntoView(), 5000)`, 7000],
        ['cumples', `showView('casa-cumples')`, 2500],
        ['gatitos-edad', `document.querySelector('.bd-cats')?.scrollIntoView()`, 1000],
        ['tramites', `showView('casa-tramites')`, 2500],
        ['presupuesto', `showView('casa-presupuesto')`, 4000],
        ['workana', `showView('workana')`, 3000],
        ['asistente', `showView('assist')`, 2500],
      ];
      for (const [name, code, ms] of steps) {
        await js(code).catch((e) => log(`[error] ${name}: ${e.message}`));
        await wait(ms);
        await shot(`${name}.png`);
      }
      if (process.env.BJ_ASK) {
        await js(`(() => { const s = document.querySelector('#assistBody select'); s.value = 'haiku'; s.dispatchEvent(new Event('change')); document.querySelector('.as-sug').click(); })()`);
        for (let i = 0; i < 120 && (await js(`!!document.querySelector('.as-msg.status')`)); i++) await wait(1000);
        await wait(1000);
        await shot('asistente-respuesta.png');
        log(`ASISTENTE ${await js(`[...document.querySelectorAll('.as-msg')].map((m) => m.className + ': ' + m.textContent.slice(0, 400)).join(' || ')`)}`);
      }
      try {
        const info = await lanServer().start();
        const r = await fetch(info.dayUrl.replace('/dia?', '/api/dia?'));
        log(`LAN ${info.dayUrl ? 'ok' : 'sin url'} ${r.status} ${(await r.text()).slice(0, 300)}`);
        const pg = await BrowserWindow.getAllWindows()[0];
        void pg;
        await lan.stop();
      } catch (e) {
        log(`[error] lan: ${e.message}`);
      }
      log(`SEMANA ${JSON.stringify(weekAhead()).slice(0, 600)}`);
      log(`FX ${JSON.stringify(await fx.get(ctxRW).catch((e) => e.message))}`);
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'v116') {
      log(`VISTA inicial ${await js('state.view')}`);
      const steps = [
        ['dia', `showView('day')`, 3000],
        ['busqueda', `openPalette(); document.querySelector('#palInput').value = 'selladora'; document.querySelector('#palInput').value = 'sellador'; setTimeout(() => renderPalette('sellador'), 1200)`, 2500],
        ['logros-faciles', `closePalette(); showView('ach'); setTimeout(() => [...document.querySelectorAll('#achView .view-head .btn')].find((b) => /fáciles/.test(b.textContent))?.click(), 500)`, 25000],
        ['ficha-mods', `document.querySelector('dialog[open]')?.close(); openGame(games().find((g) => /cyberpunk|witcher|hollow knight|resident evil/i.test(g.title)) || games()[0]); setTimeout(() => document.querySelector('#gameMods')?.scrollIntoView(), 7000)`, 9000],
        ['novedades', `document.querySelector('#gameDlg')?.close(); showView('news')`, 6000],
        ['genshin', `showView('genshin'); setGenshinTab('farmeo')`, 7000],
        ['presupuesto', `showView('casa-presupuesto')`, 2500],
        ['gatitos', `showView('casa-gatitos')`, 2000],
        ['compras', `showView('casa-compras')`, 2500],
        ['anime', `showView('news'); state.newsTab = 'anime'; renderNews()`, 6000],
      ];
      for (const [name, code, ms] of steps) {
        await js(code).catch((e) => log(`[error] ${name}: ${e.message}`));
        await wait(ms);
        await shot(`${name}.png`);
      }
      log(`PALETA ${await js(`[...document.querySelectorAll('#palList .pal-title')].map((x) => x.textContent).join(' | ')`).catch(() => '')}`);
      try {
        openPanel();
        await wait(5000);
        if (panelWin) fs.writeFileSync(path.join(dir, 'panel.png'), (await panelWin.webContents.capturePage()).toPNG());
      } catch (e) {
        log(`[error] panel: ${e.message}`);
      }
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'family') {
      const s = store.read('settings.json', {});
      const r = await require('./src/steamfamily').load(ctxRW, { steamId: s.steamId || store.getSettings().steamId, apiKey: null }).catch((e) => ({ error: e.message }));
      log(`FAMILY ${JSON.stringify({ login: r.login, none: r.none, error: r.error, group: r.group, members: r.members?.length, apps: r.apps?.length, sample: (r.apps || []).filter((a) => /bioshock|final fantasy|devil may cry|hylics|little nightmares/i.test(a.name)).map((a) => a.name) })}`);
      await js(`showView('sagas')`);
      await wait(2000);
      await shot('sagas.png');
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'v114') {
      for (const [v, name, ms] of [['casa-regalos', 'regalos', 2000], ['casa-alquileres', 'alquileres', 2000], ['mail', 'mail', 2000]]) {
        await js(`showView('${v}')`);
        await wait(ms);
        await shot(`${name}.png`);
      }
      await js(`showView('casa-regalos'); setTimeout(() => document.querySelector('.gt-card .btn.ghost')?.click(), 600)`);
      await wait(1500);
      await shot('regalo-editar.png');
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'editor') {
      const dir = require('path').join(repos.DEFAULT_DIR, 'website-c-smallcakes');
      await js(`window.editorUI.open({ dir: ${JSON.stringify(dir)}, name: 'website-c-smallcakes' })`);
      for (let i = 0; i < 30 && !(await js(`!!document.querySelector('.monaco-editor')`)); i++) await wait(1000);
      await wait(1500);
      await js(`[...document.querySelectorAll('.ed-node.dir')].find((n) => n.textContent.includes('app') || n.textContent.includes('src'))?.click()`);
      await wait(1000);
      await js(`[...document.querySelectorAll('.ed-node.file')].find((n) => /page\\.(tsx|jsx|js)|layout/.test(n.textContent))?.click()`);
      await wait(2000);
      await shot('editor.png');
      if (process.env.BJ_EDITOR_ASK) {
        await js(`(() => { const s = [...document.querySelectorAll('.cl-opts select')]; s[0].value = 'haiku'; s[0].dispatchEvent(new Event('change')); s[2].value = 'read'; s[2].dispatchEvent(new Event('change')); document.querySelector('#clInput').value = '¿Qué framework y versión usa este proyecto? Responde en una sola línea.'; document.querySelector('#clSend').click(); })()`);
        for (let i = 0; i < 90 && !(await js(`!!document.querySelector('.cl-meta')`)); i++) await wait(1000);
        await wait(1000);
        log(`CLAUDE ${await js(`[...document.querySelectorAll('.cl-msg.assistant, .cl-msg.error')].map((m) => m.innerText).join(' | ').slice(0, 300)`)}`);
        log(`STATUS ${await js(`document.querySelector('#edStatus').innerText`)}`);
        await shot('editor-claude.png');
      }
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'linkedin') {
      await js(`showView('linkedin')`);
      await wait(2000);
      await js(`[...document.querySelectorAll('#linkedinBody .toolbar .btn')].find((b) => b.textContent === 'Preferencias')?.click()`);
      await wait(800);
      await shot('linkedin.png');
      await js(`[...document.querySelectorAll('#linkedinBody .rx-tabs button')][2]?.click()`);
      await wait(800);
      await shot('linkedin-postulaciones.png');
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'news') {
      await js(`showView('news')`);
      for (let i = 0; i < 40 && !(await js(`!!document.querySelector('.nw-card, .nw-feature')`)); i++) await wait(1000);
      await wait(1500);
      await shot('news-juegos.png');
      await js(`state.newsTab = 'anime'; renderNews()`);
      for (let i = 0; i < 30 && !(await js(`!!document.querySelector('.an-card')`)); i++) await wait(1000);
      await wait(2500);
      await shot('news-anime.png');
      await js(`document.querySelectorAll('.an-groups .chip')[1]?.click()`);
      await wait(2000);
      await shot('news-anime-temporada.png');
      await js(`[...document.querySelectorAll('.an-top .seg button')][1]?.click()`);
      await wait(1500);
      await shot('news-anime-mio.png');
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'casa') {
      for (const t of ['compras', 'pagos', 'recordatorios', 'cumples', 'feriados']) {
        await js(`showView('casa-${t}')`);
        await wait(t === 'feriados' ? 5000 : 1800);
        await shot(`casa-${t}.png`);
      }
      await js(`[...document.querySelectorAll('#casaBody .seg button')].find((b) => b.textContent === 'Calendario')?.click()`);
      await wait(1200);
      await shot('casa-calendario.png');
      await js(`[...document.querySelectorAll('#casaBody .ks-calhead .btn')][1]?.click()`);
      await wait(800);
      await shot('casa-calendario-nov.png');
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'v190') {
      const steps = [
        ['sensors', `showView('sensors')`, 5000],
        ['backlog', `showView('backlog')`, 2500],
        ['farmeo', `showView('genshin'); setGenshinTab('farmeo')`, 6000],
        ['codigos', `setGenshinTab('codigos')`, 5000],
        ['salud', `showView('webs'); [...document.querySelectorAll('#websBody .rx-tabs button')][1]?.click()`, 9000],
        ['vercel', `[...document.querySelectorAll('#websBody .rx-tabs button')][2]?.click()`, 3000],
        ['webs-squads', `[...document.querySelectorAll('#websBody .rx-tabs button')][0]?.click(); [...document.querySelectorAll('#websBody .chip')].pop()?.click()`, 3000],
        ['workana-mine', `showView('workana'); setTimeout(() => [...document.querySelectorAll('.wk-views button')][1]?.click(), 800)`, 2500],
      ];
      for (const [name, code, ms] of steps) {
        await js(code).catch((e) => log(`[error] ${name}: ${e.message}`));
        await wait(ms);
        await shot(`${name}.png`);
      }
      try {
        openPanel();
        await wait(5000);
        if (panelWin) fs.writeFileSync(path.join(dir, 'panel.png'), (await panelWin.webContents.capturePage()).toPNG());
      } catch (e) {
        log(`[error] panel: ${e.message}`);
      }
      return app.quit();
    }
    if (process.env.BJ_SNAPSHOT_ONLY === 'resto') {
      // BJ_RESTO_FIXTURE: módulo con datos de prueba (así no hacen falta tus cuentas)
      if (process.env.BJ_RESTO_FIXTURE) {
        const fx = require(process.env.BJ_RESTO_FIXTURE)(calendar);
        for (const ch of ['re:notionStatus', 're:notion', 're:ticketChat', 'cal:status', 'cal:get']) ipcMain.removeHandler(ch);
        ipcMain.handle('re:notionStatus', () => ({ linked: true }));
        ipcMain.handle('re:notion', () => fx.notion);
        ipcMain.handle('re:ticketChat', (_e, id) => fx.chat(id));
        ipcMain.handle('cal:status', () => ({ linked: true }));
        ipcMain.handle('cal:get', () => fx.cal);
      }
      await js(`showView('cal')`);
      await wait(2500);
      await shot('calendario.png');
      await js(`showView('notion')`);
      await wait(4000);
      await shot('notion-tickets.png');
      await js(`document.querySelector('.rx-tk')?.click()`);
      await wait(1500);
      await shot('notion-ticket.png');
      await js(`document.querySelector('dialog[open]')?.close()`);
      await js(`document.querySelectorAll('.rx-tabs button')[1]?.click()`);
      await wait(2500);
      await shot('notion-pipeline.png');
      await js(`showView('webs')`);
      for (let i = 0; i < 60 && !(await js(`!!document.querySelector('.rx-repo')`)); i++) await wait(1000);
      await wait(1000);
      await js(`document.querySelector('.rx-repo-head')?.click()`);
      await wait(800);
      await shot('webs.png');
      log(`WEBS filas=${await js(`document.querySelectorAll('.rx-repo').length`)} contadores=${await js(`[...document.querySelectorAll('#countCal,#countNotion,#countWebs')].map((x) => x.textContent).join('|')`)}`);
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

const ALLOWED = /^(steam:\/\/(rungameid|install|uninstall|store)\/|com\.epicgames\.launcher:\/\/apps\/|https:\/\/(store\.steampowered\.com|steamcommunity\.com|github\.com|www\.epicgames\.com|store\.epicgames\.com)\/|uplay:\/\/launch\/|link2ea:\/\/launchgame\/|https:\/\/(www\.nintenderos\.com|www\.nintendolife\.com)\/|wemod:\/\/play\?titleId=\d+&gameId=\d+$|https:\/\/www\.wemod\.com\/cheats\/|https:\/\/www\.nexusmods\.com\/search\?|https:\/\/enka\.network\/u\/\d+\/?$|https:\/\/developer\.spotify\.com\/dashboard|https:\/\/www\.hoyolab\.com\/article\/\d+$|https:\/\/(openrgb\.org|pawnio\.eu)\/|https:\/\/www\.workana\.com\/(job|dashboard|freelancer)\/?|spotify:(track|playlist|album|artist):[A-Za-z0-9]+$|https:\/\/howlongtobeat\.com\/\?q=|https:\/\/www\.youtube\.com\/results\?|https:\/\/www\.google\.com\/search\?|https:\/\/calendar\.google\.com\/calendar\/|https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}$|https:\/\/github\.com\/LibreHardwareMonitor\/|https:\/\/howlongtobeat\.com\/game\/\d+$|https:\/\/anilist\.co\/anime\/\d+|https:\/\/act\.hoyolab\.com\/ys\/event\/signin-sea-v3\/|https:\/\/www\.gamerpower\.com\/(open\/)?[\w-]+$|https:\/\/www\.nexusmods\.com\/[a-z0-9]+\/mods\/(\d+)?$|https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$|https:\/\/vercel\.com\/account\/(settings\/)?tokens|https:\/\/developers\.google\.com\/speed\/docs\/insights\/v5\/get-started|https:\/\/www\.(grupoins\.com|rtv\.co\.cr|csv\.go\.cr|tse\.go\.cr|migracion\.go\.cr|bccr\.fi\.cr)\/|https:\/\/tailscale\.com\/(download|kb)\b|https:\/\/login\.tailscale\.com\/admin\/dns$)/;
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
    if (status.mode === 'off' && lastFocusMode === 'on') {
      onFocusOff();
      flushDnd();
    }
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
    const video = new URL(req.url).hostname === 'vid';
    if (video ? !screens.isAllowedVideo(file) : !screens.isAllowed(file, await localCtx())) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
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
    setTimeout(() => calendarTick(false), 15000);
    setTimeout(() => sensors.read().catch(() => {}), 8000);
    setTimeout(genshinTick, 40000);
    setInterval(genshinTick, 5 * 60000);
    setTimeout(codesTick, 60000);
    setInterval(codesTick, 6 * 3600000);
    setTimeout(notionTick, 45000);
    setInterval(notionTick, 10 * 60000);
    setTimeout(healthTick, 120000);
    setInterval(healthTick, 5 * 60000);
    setTimeout(vercelTick, 75000);
    setInterval(vercelTick, 10 * 60000);
    setTimeout(casaTick, 30000);
    setInterval(casaTick, 30 * 60000);
    setTimeout(giveawayTick, 70000);
    setInterval(giveawayTick, 6 * 3600000);
    setTimeout(checkinTick, 90000);
    setInterval(checkinTick, 60 * 60000);
    setTimeout(rentTick, 10 * 60000);
    setInterval(rentTick, 4 * 3600000);
    setTimeout(backupTick, 120000);
    setInterval(backupTick, 6 * 3600000);
    setTimeout(mailTick, 35000);
    setInterval(mailTick, 5 * 60000);
    setTimeout(animeTick, 50000);
    setInterval(animeTick, 30 * 60000);
    setTimeout(gatherTick, 70000);
    setTimeout(paimonTick, 80000);
    setTimeout(weatherTick, 60000);
    setTimeout(eventsTick, 100000);
    setTimeout(siteChecksTick, 4 * 60000);
    // el certificado de Tailscale dura 90 días: se renueva solo cada mes
    setTimeout(() => { const t = loadTls(); if (t && t.age > 30 * 86400000 && lan) enableHttps().catch(() => {}); }, 3 * 60000);
    setInterval(siteChecksTick, 30 * 60000);
    setInterval(eventsTick, 3 * 3600000);
    setInterval(weatherTick, 30 * 60000);
    if (store.read('settings.json', {}).widgetOn) setTimeout(() => { try { openWidget(true); } catch {} }, 6000);
    setInterval(paimonTick, 60 * 60000);
    setInterval(gatherTick, 10 * 60000);
    setTimeout(sundayTick, 90000);
    if (!process.env.BJ_SNAPSHOT) {
      setTimeout(() => giftTick().catch(() => {}), 4 * 60000);
      setInterval(() => giftTick().catch(() => {}), 3 * 3600000);
      setTimeout(() => launchTick().catch(() => {}), 6 * 60000);
      setInterval(() => launchTick().catch(() => {}), 30 * 60000);
      setTimeout(() => premiereTick().catch(() => {}), 8 * 60000);
      // webs de los clientes: lo diario y lo semanal se revisa cada 2 h si toca
      setTimeout(() => repoDaily().catch(() => {}), 10 * 60000);
      setTimeout(() => siteDaily().catch(() => {}), 15 * 60000);
      setTimeout(() => siteWeekly().catch(() => {}), 40 * 60000);
      setInterval(() => { repoDaily().catch(() => {}); siteDaily().catch(() => {}); siteWeekly().catch(() => {}); }, 2 * 3600000);
      setInterval(() => teamMorningTick().catch(() => {}), 10 * 60000);
      // juegos: Game Pass y lanzamientos una vez al día, pausas cada minuto, check-in por la noche
      setTimeout(() => gamePassTick().catch(() => {}), 12 * 60000);
      setInterval(() => gamePassTick().catch(() => {}), 24 * 3600000);
      setTimeout(() => releaseTick().catch(() => {}), 13 * 60000);
      setInterval(() => releaseTick().catch(() => {}), 6 * 3600000);
      setInterval(breakTick, 60000);
      setInterval(() => checkinEveningTick().catch(() => {}), 20 * 60000);
      setInterval(() => premiereTick().catch(() => {}), 30 * 60000);
    }
    setInterval(sundayTick, 30 * 60000);
    // el panel del case se abre solo y se vigila mientras la app esté abierta
    if (!process.env.BJ_SNAPSHOT) panelWatch();
    setInterval(() => calendarTick(true), 5 * 60000);
    setInterval(calendarReminders, 30000);
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
  delete settings.notionEnc;
  delete settings.notionClientId;
  delete settings.calIcsEnc;
  delete settings.vercelEnc;
  delete settings.psiKeyEnc;
  delete settings.mailPassEnc;
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
const dndQueue = [];
const notify = (title, body, url, opts = {}) => {
  if (!Notification.isSupported() || process.env.BJ_SNAPSHOT) return; // las pruebas no avisan

  if (!opts.urgent && focus.mode === 'on' && store.read('settings.json', {}).dndGaming !== false) {
    dndQueue.push({ at: Date.now(), title: String(title || '').slice(0, 200), body: String(body || '').slice(0, 400), url: url || null });
    return;
  }
  const n = new Notification({ title, body, silent: true });
  if (url) n.on('click', () => openSafe(url));
  n.show();
  try {
    pushToPhone(title, body, opts);
  } catch {}
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
  if (st.sessionSummary !== false) notify(`Partida terminada: ${s.title}`, parts.join(', ') + '.', null, { urgent: true });
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
      // aviso suave en pantalla (el de Windows queda retenido por el modo No molestar)
      nudge(`Llevas ${fmtMin(step * remindEveryMin)} jugando ${cur.title}. Buen momento para estirar las piernas o beber agua.`);
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
    const hist = prices.record(ctxRW, res.items);
    const lowsMap = await prices.lows(ctxRW, res.items.filter((i) => i.price?.discountPct > 0).concat(res.items)).catch(() => store.read('price-lows.json', {}));
    const lowSeen = store.read('price-low-alerts.json', {});
    for (const i of res.items) {
      if (!prices.atLow(i, hist, lowsMap[i.appid]) || lowSeen[i.appid] === i.price.discountPct) continue;
      lowSeen[i.appid] = i.price.discountPct;
      notify(i.name + ' está en su mínimo histórico', '−' + i.price.discountPct + '%: ' + i.price.final + '. Nunca estuvo más barato. Haz clic para verlo en Steam.', 'https://store.steampowered.com/app/' + i.appid + '/');
    }
    store.write('price-low-alerts.json', lowSeen);
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
    if (s.mode === 'on') notify(`Modo enfoque: ${s.game.title}`, `${s.background} procesos en segundo plano frenados.`, null, { urgent: true });
    else notify('Modo enfoque esperando', 'Se activará en cuanto abras un juego.', null, { urgent: true });
  } else {
    focus.stop('user');
    notify('Modo enfoque desactivado', 'Todo vuelve a como estaba.', null, { urgent: true });
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

// Conectar la biblioteca familiar: inicias sesión en Steam en una ventana de la app
ipcMain.handle('family:status', () => {
  const f = store.read('steam-family.json', null);
  return f ? { linked: true, group: f.group, games: f.apps.length, members: f.members, at: f.at } : { linked: false };
});
ipcMain.handle('family:login', () => new Promise((resolve) => {
  const w = new BrowserWindow({ width: 900, height: 780, title: 'Steam · ViperTeca', autoHideMenuBar: true, parent: win, backgroundColor: '#1b2838', webPreferences: { session: session.fromPartition(steamfamily.PART), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  w.on('page-title-updated', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let done = false;
  const check = async () => {
    if (done || w.isDestroyed()) return;
    const ses = session.fromPartition(steamfamily.PART);
    const r = await ses.fetch('https://store.steampowered.com/pointssummary/ajaxgetasyncconfig').then((x) => x.json()).catch(() => null);
    if (r?.data?.webapi_token) {
      done = true;
      w.close();
      resolve(true);
    }
  };
  w.webContents.on('did-navigate', check);
  w.webContents.on('did-finish-load', check);
  w.on('closed', () => !done && resolve(false));
  w.loadURL('https://store.steampowered.com/login/?redir=account%2F');
}));

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
    // Biblioteca del grupo familiar de Steam (si la sesión de Steam de la app está iniciada)
    let family = null;
    try {
      const sid = settings.steamId || steam.detectSteamId(await steam.findSteamPath());
      if (sid) {
        const f = await steamfamily.load({ read: store.read, write: store.write }, { steamId: sid, apiKey: store.getSteamKey() });
        family = f?.apps ? f : f?.cached || null;
      }
    } catch {
      family = store.read('steam-family.json', null);
    }
    const result = await library.refresh({
      apiKey: store.getSteamKey(),
      settings,
      previous,
      purchaseDates: purchases.dates || {},
      cache: { read: store.read, write: store.write },
      family,
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
    lan = new LanServer({
      games: () => store.read('library.json', null)?.games || [],
      launch: async (g) => launchFromMain(g),
      token: s.lanToken,
      day: () => daySummary(),
      mobile: mobileApi,
      tls: loadTls(),
      gifts: giftsApi,
      iconPath: path.join(__dirname, 'build', 'icon.png'),
      // lista de compras de Casa, para verla y marcarla desde el celular
      shopping: {
        get: () => {
          const c = casa.load(ctxRW);
          return { cats: c.shopCats, items: (c.shopping || []).map((x) => ({ id: x.id, name: x.name, qty: x.qty, cat: x.cat, done: x.done })) };
        },
        toggle: (id) => {
          const c = casa.load(ctxRW);
          const it = (c.shopping || []).find((x) => x.id === id);
          if (it) {
            it.done = !it.done;
            it.boughtAt = it.done ? Date.now() : null;
            casa.save(ctxRW, c);
            if (win && !win.isDestroyed()) win.webContents.send('casa:changed');
          }
          return !!it;
        },
        add: (name, qty) => {
          const c = casa.load(ctxRW);
          const n = String(name || '').trim().slice(0, 120);
          if (!n) return false;
          c.shopping.push({ id: require('crypto').randomBytes(6).toString('hex'), name: n, qty: String(qty || '').slice(0, 30), cat: c.shopCats?.[0] || 'Súper', done: false, at: Date.now() });
          casa.save(ctxRW, c);
          if (win && !win.isDestroyed()) win.webContents.send('casa:changed');
          return true;
        },
      },
    });
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
const WK_DEFAULT = { queries: ['wordpress', 'elementor', 'woocommerce', 'landing page', 'pagina web', 'desarrollo web'], publication: '3d', done: {}, last: null };
// Siempre con los valores por defecto debajo: una búsqueda guarda solo `last`
const wkState = () => ({ ...WK_DEFAULT, ...store.read('workana.json', {}) });
ipcMain.handle('wk:state', () => wkState());
ipcMain.handle('wk:saveState', (_e, patchState) => {
  const next = { ...wkState(), ...patchState };
  store.write('workana.json', next);
  return next;
});
ipcMain.handle('wk:search', async (e, opts) => {
  const queries = (Array.isArray(opts?.queries) ? opts.queries : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 8);
  if (!queries.length) throw new Error('Añade al menos una palabra para buscar.');
  const list = await workana.search({ queries, publication: ['1d', '3d', '1w', '1m'].includes(opts?.publication) ? opts.publication : '3d', pages: 2, onProgress: (t) => !e.sender.isDestroyed() && e.sender.send('wk:progress', t) });
  const s = wkState();
  s.last = { at: Date.now(), list };
  store.write('workana.json', s);
  return s.last;
});
ipcMain.handle('wk:build', (_e, p) => proposal.build(p || {}));
ipcMain.handle('wk:check', (_e, text) => proposal.check(String(text || '')));
ipcMain.handle('wk:clean', (_e, text) => proposal.clean(String(text || '')));
ipcMain.handle('wk:bid', (e, p) => {
  const url = String(p?.url || '');
  const text = String(p?.text || '');
  const price = String(p?.price || '').replace(/[^\d.,]/g, '');
  if (!/^https:\/\/www\.workana\.com\/job\/[\w-]+\/?$/.test(url)) throw new Error('Ese proyecto no es de Workana.');
  if (proposal.check(text).length) throw new Error('La propuesta tiene cosas que Workana no permite: corrígelas primero.');
  require('electron').clipboard.writeText(text);
  const send = (ch, v) => !e.sender.isDestroyed() && e.sender.send(ch, { slug: p.slug, state: v });
  return workana.bid({ url, text, price, onState: (s) => send('wk:bidState', s), onClose: (s) => send('wk:bidClosed', s) });
});
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

// ---------- Resto Experience: Notion, webs y calendario ----------
const rx = { read: store.read, write: store.write };
const webRoot = () => store.read('settings.json', {}).websDir || repos.DEFAULT_DIR;
const inWebRoot = (dir) => {
  const p = require('path');
  const rel = p.relative(webRoot(), p.resolve(String(dir || '')));
  return !!rel && !rel.startsWith('..') && !p.isAbsolute(rel);
};
ipcMain.handle('re:notionStatus', () => ({ linked: notion.linked(store.read) }));
ipcMain.handle('re:notionLogin', () => notion.login(rx));
ipcMain.handle('re:notionLogout', () => notion.logout(rx));
ipcMain.handle('re:notion', (_e, force) => notion.overview(rx, !!force));
ipcMain.handle('re:ticketChat', (_e, id, t) => {
  if (!/^[0-9a-f-]{32,36}$/i.test(String(id))) throw new Error('Ticket no válido.');
  return notion.ticketChat(rx, String(id), t || null);
});
ipcMain.handle('re:openNotion', (_e, url) => {
  const u = String(url || '');
  if (!/^https:\/\/(www\.)?(app\.)?notion\.(so|com)\/[\w\-/?=&.%]+$/.test(u)) return false;
  shell.openExternal(u.replace('://www.notion.so/', '://app.notion.com/p/'));
  return true;
});
// abre staging/producción solo si la URL viene del pipeline de Notion
ipcMain.handle('re:openSite', (_e, url) => {
  const u = String(url || '');
  const c = store.read('notion-cache.json', null);
  const known = (c?.data?.pipeline?.rows || []).some((r) => [r.staging, r.production, r.repo].includes(u));
  if (!known || !/^https:\/\//.test(u)) return false;
  shell.openExternal(u);
  return true;
});
ipcMain.handle('re:webs', () => ({ dir: webRoot(), last: store.read('webs.json', null) }));
ipcMain.handle('re:scan', async (e, fetchRemote) => {
  const r = await repos.scan(webRoot(), { fetch: fetchRemote !== false, onProgress: (d, n, name) => !e.sender.isDestroyed() && e.sender.send('re:scanProgress', { done: d, total: n, name }) });
  store.write('webs.json', r);
  return r;
});
ipcMain.handle('re:pull', async (_e, dir) => {
  if (!inWebRoot(dir)) throw new Error('Esa carpeta no está dentro de tus webs.');
  const r = await repos.pull(require('path').resolve(dir));
  const last = store.read('webs.json', null);
  if (last) {
    last.repos = last.repos.map((x) => (x.dir === r.dir ? r : x));
    store.write('webs.json', last);
  }
  return r;
});
ipcMain.handle('re:openDir', (_e, dir, how) => {
  if (!inWebRoot(dir)) return false;
  const p = require('path').resolve(dir);
  if (how === 'code') shell.openExternal('vscode://file/' + p.replace(/\\/g, '/'));
  else shell.openPath(p);
  return true;
});
ipcMain.handle('re:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta donde tienes tus webs', defaultPath: webRoot(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const s = store.read('settings.json', {});
  s.websDir = r.filePaths[0];
  store.write('settings.json', s);
  store.write('webs.json', null);
  return s.websDir;
});

ipcMain.handle('cal:status', () => ({ linked: calendar.linked(store.read) }));
ipcMain.handle('cal:setUrl', (_e, url) => {
  const ok = calendar.setUrl(rx, url);
  if (ok) calendarTick(true).catch(() => {});
  return ok;
});
ipcMain.handle('cal:get', async (_e, force) => {
  const c = await calendar.load(rx, !!force);
  return c;
});
ipcMain.handle('cal:open', (_e, url) => {
  const u = String(url || '');
  if (!/^https:\/\/(meet\.google\.com\/[a-z-]+|[\w.-]*zoom\.us\/[jw]\/|teams\.(microsoft|live)\.com\/|calendar\.google\.com\/calendar\/)/i.test(u)) return false;
  shell.openExternal(u);
  return true;
});

// Avisos del calendario: reunión nueva y "empieza en 5 minutos"
const calReminded = new Set();
async function calendarTick(force) {
  if (!calendar.linked(store.read)) return;
  let c;
  try {
    c = await calendar.load(rx, !!force);
  } catch {
    return;
  }
  if (force !== 'quiet' && store.read('settings.json', {}).calNewAlerts !== false) {
    const { fresh, moved } = calendar.diffNew(rx, c.events);
    const when = (t) => new Date(t).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    if (fresh.length === 1) notify('Te agendaron una reunión', `${fresh[0].title} · ${when(fresh[0].start)}`, 'https://calendar.google.com/calendar/r');
    else if (fresh.length > 1) notify(`Te agendaron ${fresh.length} reuniones`, fresh.slice(0, 3).map((e) => `${e.title} (${when(e.start)})`).join('\n'), 'https://calendar.google.com/calendar/r');
    for (const m of moved.slice(0, 3)) notify('Cambió una reunión', `${m.title} ahora es el ${when(m.start)}`, 'https://calendar.google.com/calendar/r');
    if ((fresh.length || moved.length) && win && !win.isDestroyed()) win.webContents.send('cal:changed');
  }
}
function calendarReminders() {
  if (store.read('settings.json', {}).calReminders === false) return;
  const c = store.read('calendar-cache.json', null);
  if (!c?.events) return;
  const now = Date.now();
  for (const e of c.events) {
    if (e.allDay || e.myStatus === 'DECLINED' || calReminded.has(e.id)) continue;
    const mins = (e.start - now) / 60000;
    if (mins > 0 && mins <= 5) {
      calReminded.add(e.id);
      notify(`En ${Math.max(1, Math.round(mins))} min: ${e.title}`, e.link ? 'Haz clic para entrar a la reunión.' : e.location || 'Reunión', e.link && /^https:\/\/meet\.google\.com\//.test(e.link) ? e.link : null, { urgent: true });
    }
  }
}

// ---------- 1.9: sensores, panel del case, backlog, Genshin, salud de webs ----------
const settingsOn = (k) => store.read('settings.json', {})[k] !== false;
const ctxRW = { read: store.read, write: store.write, readStrict: store.readStrict };

// Sensores: se leen cada 3 s cuando alguien los mira, hay partida o avisos activos
let sensorViewers = 0;
const sessTemps = { id: null, cpu: 0, gpu: 0 };
async function sensorTick() {
  const needed = sensorViewers > 0 || (panelWin && !panelWin.isDestroyed()) || focus.mode === 'on' || (settingsOn('sensorAlerts') && sensors.lhmSeen());
  if (!needed) return;
  const s = await sensors.read().catch(() => null);
  if (!s) return;
  if (focus.mode === 'on' && focus.game) {
    if (sessTemps.id !== focus.game.id) Object.assign(sessTemps, { id: focus.game.id, cpu: 0, gpu: 0 });
    sessTemps.cpu = Math.max(sessTemps.cpu, s.cpu.temp || 0);
    sessTemps.gpu = Math.max(sessTemps.gpu, s.gpu.temp || 0);
  }
  if (settingsOn('sensorAlerts')) {
    const lim = store.read('settings.json', {}).tempLimits || { cpu: 90, gpu: 85 };
    for (const a of sensors.checkAlerts(s, lim)) notify(`${a.part} está a ${a.temp} °C`, `Pasó tu límite de ${a.limit} °C. Revisa los ventiladores o baja la exigencia del juego.`, null, { urgent: true });
  }
}
setInterval(sensorTick, 3000);
setInterval(() => sensors.read().catch(() => {}), 5 * 60000); // detecta si abriste LibreHardwareMonitor
const prevGetExtra = tracker.getExtra;
tracker.getExtra = (s) => {
  const extra = prevGetExtra ? prevGetExtra(s) : {};
  if (sessTemps.id === s.id && (sessTemps.cpu || sessTemps.gpu)) extra.temps = { cpu: Math.round(sessTemps.cpu) || null, gpu: Math.round(sessTemps.gpu) || null };
  Object.assign(sessTemps, { id: null, cpu: 0, gpu: 0 });
  return extra;
};
ipcMain.handle('sensors:get', () => sensors.read());
ipcMain.handle('sensors:limits', (_e, lim) => {
  const s = store.read('settings.json', {});
  s.tempLimits = { cpu: Math.max(50, Math.min(110, Number(lim?.cpu) || 90)), gpu: Math.max(50, Math.min(110, Number(lim?.gpu) || 85)) };
  store.write('settings.json', s);
  return s.tempLimits;
});
ipcMain.handle('sensors:watch', (_e, on) => {
  sensorViewers = Math.max(0, sensorViewers + (on ? 1 : -1));
  sensors.want(!!on);
  return true;
});

// Panel en la pantalla del case
let panelWin = null;
function panelDisplays() {
  const { screen } = require('electron');
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label || '', w: d.size.width, h: d.size.height, primary: d.id === primary, portrait: d.size.height > d.size.width }));
}
function openPanel() {
  const { screen } = require('electron');
  const s = store.read('settings.json', {});
  const all = screen.getAllDisplays();
  const d = all.find((x) => x.id === Number(s.panelDisplay)) || all.find((x) => x.size.height > x.size.width * 1.5);
  if (!d) throw new Error('No encuentro la pantalla del case: elígela en la lista.');
  if (panelWin && !panelWin.isDestroyed()) panelWin.destroy();
  panelWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    frame: false, resizable: false, movable: false, skipTaskbar: true, show: false, fullscreenable: true,
    backgroundColor: '#0b0915', title: 'ViperTeca · Panel',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  panelWin.removeMenu();
  panelWin.setBounds(d.bounds);
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panelWin.once('ready-to-show', () => {
    panelWin.showInactive();
    panelWin.setFullScreen(true);
  });
  sensors.want(true);
  panelWin.on('closed', () => {
    panelWin = null;
    sensors.want(false);
  });
  panelWin.webContents.on('render-process-gone', () => {
    if (panelWin && !panelWin.isDestroyed()) panelWin.destroy();
    setTimeout(panelCheck, 3000);
  });
  return true;
}
/**
 * Panel en la pantalla del case como fondo: se abre al arrancar y cada 15 s se
 * comprueba que siga ahí (las pantallas se apagan, Windows arranca sin detectarla,
 * cambia la resolución…). Si la pantalla no está, se espera a que vuelva.
 */
let panelWatching = false;
function panelTarget() {
  const { screen } = require('electron');
  const s = store.read('settings.json', {});
  const all = screen.getAllDisplays();
  return all.find((x) => x.id === Number(s.panelDisplay)) || all.find((x) => x.size.height > x.size.width * 1.5) || null;
}
function panelCheck() {
  if (store.read('settings.json', {}).panelAuto === false) return;
  const d = panelTarget();
  const open = panelWin && !panelWin.isDestroyed();
  if (!d) {
    // sin la pantalla del case: que no tape la pantalla principal
    if (open && panelWin.isVisible()) panelWin.hide();
    return;
  }
  if (!open) {
    try {
      openPanel();
    } catch {}
    return;
  }
  // en pantalla completa Windows la agranda unos píxeles: basta con que esté en esa pantalla
  const on = require('electron').screen.getDisplayMatching(panelWin.getBounds());
  const off = on.id !== d.id;
  if (off || !panelWin.isVisible()) {
    panelWin.setFullScreen(false);
    panelWin.setBounds(d.bounds);
    panelWin.showInactive();
    panelWin.setFullScreen(true);
  }
}
function panelWatch() {
  if (panelWatching) return;
  panelWatching = true;
  const { screen } = require('electron');
  setTimeout(panelCheck, 4000);
  setInterval(panelCheck, 15000);
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => setTimeout(panelCheck, 2500));
  require('electron').powerMonitor.on('resume', () => setTimeout(panelCheck, 5000));
  require('electron').powerMonitor.on('unlock-screen', () => setTimeout(panelCheck, 3000));
}
let spCache = { at: 0, v: null };
ipcMain.handle('panel:displays', () => ({ displays: panelDisplays(), chosen: store.read('settings.json', {}).panelDisplay || null, open: !!(panelWin && !panelWin.isDestroyed()), auto: store.read('settings.json', {}).panelAuto !== false }));
ipcMain.handle('panel:set', (_e, opts) => {
  const s = store.read('settings.json', {});
  if (opts && 'display' in opts) s.panelDisplay = opts.display == null ? null : Number(opts.display);
  if (opts && 'auto' in opts) s.panelAuto = !!opts.auto;
  store.write('settings.json', s);
  if (opts && ('auto' in opts || 'display' in opts)) setTimeout(panelCheck, 500);
  return true;
});
ipcMain.handle('panel:open', () => openPanel());
ipcMain.handle('panel:close', () => {
  const st = store.read('settings.json', {});
  st.panelAuto = false;
  store.write('settings.json', st);
  if (panelWin && !panelWin.isDestroyed()) panelWin.destroy();
  return true;
});
ipcMain.handle('panel:data', async () => {
  const now = Date.now();
  const cal = store.read('calendar-cache.json', null);
  const next = (cal?.events || []).find((e) => !e.allDay && e.end > now && e.myStatus !== 'DECLINED' && !e.free) || null;
  const hc = hoyolab.linked(store.read) ? store.read('hoyolab-cache.json', null)?.data?.notes || null : null;
  const manual = store.read('gresin.json', null);
  const resin = hc ? { value: hc.resin, max: hc.maxResin, fullAt: hc.resinFullAt, live: true } : manual ? resinFromManual(manual) : null;
  const nc = store.read('notion-cache.json', null)?.data;
  const open = (nc?.tickets || []).filter((t) => t.group !== 'done');
  const late = open.filter((t) => t.deadline && new Date(t.deadline + 'T23:59:59').getTime() < now).length;
  if (spotify.linked(store.read) && now - spCache.at > 4000) {
    spCache = { at: now, v: spCache.v };
    spotify.state(sp).then((v) => (spCache = { at: Date.now(), v })).catch(() => {});
  }
  const st = focus.status?.() || {};
  return {
    now,
    sensors: sensors.last(),
    game: focus.mode === 'on' && focus.game ? { title: focus.game.title, fps: fpsMeter ? fpsMeter.stats() : null } : null,
    next: next && { title: next.title, start: next.start, end: next.end, link: next.link },
    today: (cal?.events || []).filter((e) => !e.allDay && e.end > now && e.myStatus !== 'DECLINED' && new Date(e.start).toDateString() === new Date(now).toDateString()).slice(0, 6).map((e) => ({ title: e.title, start: e.start, daily: e.daily })),
    resin,
    tickets: nc ? { open: open.length, late } : null,
    week: (() => {
      const c = casa.load(ctxRW);
      const pays = (c.payments || []).map((p) => ({ p, n: casa.nextDue(p, now) })).filter((x) => x.n && x.n.days >= 0 && x.n.days <= 7).sort((a, b) => a.n.days - b.n.days).slice(0, 3).map(({ p, n }) => ({ label: p.name + (p.group !== 'Personal' ? ` (${p.group})` : ''), days: n.days, kind: 'pago' }));
      const bd = (c.birthdays || []).filter((b) => b.day).map((b) => ({ b, n: casa.nextBirthday(b, now) })).filter((x) => x.n.days <= 7).slice(0, 3).map(({ b, n }) => ({ label: b.name, days: n.days, kind: 'cumple' }));
      return [...pays, ...bd].sort((a, b) => a.days - b.days);
    })(),
    anime: (() => {
      const f = Object.values(anime.mine(ctxRW).follows || {}).map((a) => ({ a, at: a.next?.at || (a.status === 'NOT_YET_RELEASED' && a.precision === 'day' ? a.start : null) })).filter((x) => x.at && x.at > now - 3600000).sort((x, y) => x.at - y.at)[0];
      return f ? { title: f.a.title, cover: f.a.cover, at: f.at, what: f.a.next ? `Episodio ${f.a.next.episode}` : 'Estreno' } : null;
    })(),
    spotify: spCache.v,
    lhm: sensors.lhmSeen(),
    mode: st.mode || null,
  };
});

// Resina: de HoYoLAB (si iniciaste sesión) o la que escribes tú
const RESIN_MIN = 8 * 60000;
function resinFromManual(m) {
  const max = m.max || 200;
  const value = Math.min(max, m.value + Math.floor((Date.now() - m.at) / RESIN_MIN));
  return { value, max, fullAt: m.at + (max - m.value) * RESIN_MIN, live: false };
}
ipcMain.handle('gresin:get', () => {
  const hc = hoyolab.linked(store.read) ? store.read('hoyolab-cache.json', null)?.data?.notes : null;
  if (hc) return { value: hc.resin, max: hc.maxResin, fullAt: hc.resinFullAt, live: true, expeditions: hc.expeditions?.length ? hc.expeditions.filter((x) => x.done).length + '/' + hc.expeditions.length : null };
  const m = store.read('gresin.json', null);
  return m ? { ...resinFromManual(m), set: m } : null;
});
ipcMain.handle('gresin:set', (_e, value) => {
  const v = Math.max(0, Math.min(200, Math.round(Number(value) || 0)));
  store.write('gresin.json', { value: v, max: 200, at: Date.now() });
  resinNotified = null;
  return resinFromManual({ value: v, max: 200, at: Date.now() });
});
let resinNotified = null;
async function genshinTick() {
  if (!settingsOn('resinAlert')) return;
  let full = null;
  let label = '';
  if (hoyolab.linked(store.read) && gUid()) {
    const d = await hoyolab.overview(gUid(), { read: store.read, write: store.write, force: false }).catch(() => null);
    if (d?.notes) {
      full = d.notes.resinFullAt || (d.notes.resin >= d.notes.maxResin ? Date.now() : null);
      label = `${d.notes.maxResin}`;
      const exp = d.notes.expeditions || [];
      if (exp.length && exp.every((x) => x.done) && resinNotified !== 'exp-' + d.fetchedAt) {
        const k = 'exp-' + exp.length;
        if (store.read('settings.json', {}).lastExpNotice !== k + new Date().toDateString()) {
          const s = store.read('settings.json', {});
          s.lastExpNotice = k + new Date().toDateString();
          store.write('settings.json', s);
          notify('Expediciones terminadas', 'Todas tus expediciones de Genshin volvieron. Recógelas y mándalas de nuevo.');
        }
      }
    }
  } else {
    const m = store.read('gresin.json', null);
    if (m) {
      full = resinFromManual(m).fullAt;
      label = '200';
    }
  }
  // Una sola vez por cada vez que abres la app (antes, con la resina llena,
  // cada revisión contaba como un llenado nuevo y el aviso se repetía)
  if (full && Date.now() >= full && !resinShownThisRun) {
    resinShownThisRun = true;
    notify('Resina llena en Genshin', `Tienes ${label} de resina: gástala antes de que se desperdicie.`);
  }
}
let resinShownThisRun = false;
ipcMain.handle('gfarm:avatars', () => genshinFarm.avatars(ctxRW));
ipcMain.handle('gfarm:plan', () => store.read('gfarm-plan.json', []));
ipcMain.handle('gfarm:save', (_e, plan) => {
  const clean = (Array.isArray(plan) ? plan : []).slice(0, 20).map((p) => ({
    id: Number(String(p.id).split('-')[0]) ? p.id : null,
    level: Math.max(1, Math.min(90, Number(p.level) || 1)),
    ascended: !!p.ascended,
    talents: (p.talents || [1, 1, 1]).slice(0, 3).map((t) => Math.max(1, Math.min(10, Number(t) || 1))),
    target: { level: Math.max(1, Math.min(90, Number(p.target?.level) || 90)), talents: (p.target?.talents || [8, 8, 8]).slice(0, 3).map((t) => Math.max(1, Math.min(10, Number(t) || 1))) },
  })).filter((p) => p.id);
  store.write('gfarm-plan.json', clean);
  return clean;
});
ipcMain.handle('gfarm:compute', () => genshinFarm.compute(store.read('gfarm-plan.json', []), ctxRW));
ipcMain.handle('gcodes:list', (_e, force) => genshinCodes.list(ctxRW, !!force));
ipcMain.handle('gcodes:used', (_e, code, on) => genshinCodes.markUsed(ctxRW, String(code), !!on));
ipcMain.handle('gcodes:open', (_e, code) => {
  if (!/^[A-Z0-9]{6,20}$/.test(String(code))) return false;
  shell.openExternal(genshinCodes.REDEEM(code));
  return true;
});
async function codesTick() {
  if (!settingsOn('codesAlert')) return;
  const c = await genshinCodes.list(ctxRW, true).catch(() => null);
  const fresh = (c?.codes || []).filter((x) => x.isNew && !x.used);
  if (!c || c.first || !fresh.length) return;
  notify(fresh.length === 1 ? 'Código nuevo de Genshin' : `${fresh.length} códigos nuevos de Genshin`, fresh.map((x) => `${x.code}: ${x.rewards.join(', ')}`).join('\n'), fresh[0].url);
}

// Backlog: duración de HowLongToBeat
ipcMain.handle('hltb:get', () => store.read('hltb.json', {}));
ipcMain.handle('hltb:fill', async (e, games, force) => {
  const list = (Array.isArray(games) ? games : []).slice(0, 300).map((g) => ({ id: String(g.id), title: String(g.title).slice(0, 120) }));
  return hltb.fill(list, { read: store.read, write: store.write, force: !!force, onProgress: (p) => !e.sender.isDestroyed() && e.sender.send('hltb:progress', p) });
});

// Salud de las webs y Vercel
function healthSites() {
  const rows = store.read('notion-cache.json', null)?.data?.pipeline?.rows || [];
  const extra = store.read('settings.json', {}).healthExtra || [];
  const vc = store.read('vercel.json', null)?.projects || [];
  const map = new Map();
  for (const r of rows) if (r.production && /^https:\/\//.test(r.production) && (r.group === 'done' || /live/i.test(r.status))) map.set(r.production, { url: r.production, name: r.name, mine: r.mine });
  for (const p of vc) if (p.domain && ![...map.values()].some((x) => new URL(x.url).hostname.replace(/^www\./, '') === new URL(p.domain).hostname.replace(/^www\./, ''))) map.set(p.domain, { url: p.domain, name: p.name, fromVercel: true });
  for (const u of extra) if (!map.has(u)) map.set(u, { url: u, name: new URL(u).hostname });
  const hidden = new Set(healthHidden());
  return [...map.values()].filter((s) => !hidden.has(hostOf(s.url)));
}
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
// Webs que no quieres ver en Salud (por dominio). Fun Tapas viene oculta de serie.
function healthHidden() {
  const s = store.read('settings.json', {});
  return Array.isArray(s.healthHidden) ? s.healthHidden : ['funtapas.com'];
}
ipcMain.handle('health:hide', (_e, url, on) => {
  const host = hostOf(String(url || '')) || String(url || '').replace(/^www\./, '');
  if (!host) return healthHidden();
  const s = store.read('settings.json', {});
  const list = new Set(healthHidden());
  if (on) list.add(host);
  else list.delete(host);
  s.healthHidden = [...list];
  store.write('settings.json', s);
  return s.healthHidden;
});
ipcMain.handle('health:hidden', () => healthHidden());
ipcMain.handle('health:get', () => ({ last: store.read('webhealth.json', null), sites: healthSites(), psi: !!webhealth.getSecret(store.read, 'psiKeyEnc') }));
ipcMain.handle('health:check', async () => {
  const r = await webhealth.checkAll(healthSites(), ctxRW);
  return { last: r, sites: healthSites(), psi: !!webhealth.getSecret(store.read, 'psiKeyEnc') };
});
ipcMain.handle('health:psi', async (_e, url) => {
  const sites = healthSites();
  if (!sites.some((s) => s.url === url)) throw new Error('Esa web no está en tu lista.');
  const r = await webhealth.pagespeed(store.read, url);
  const h = store.read('webhealth.json', { sites: {} });
  h.sites[url] = { ...(h.sites[url] || { url }), psi: r };
  store.write('webhealth.json', h);
  return r;
});
ipcMain.handle('health:setKey', (_e, key) => webhealth.setSecret(ctxRW, 'psiKeyEnc', key));
ipcMain.handle('health:addSite', (_e, url) => {
  const u = String(url || '').trim();
  if (!/^https:\/\/[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(u)) throw new Error('Escribe la dirección completa, con https://');
  const s = store.read('settings.json', {});
  s.healthExtra = [...new Set([...(s.healthExtra || []), u])].slice(0, 100);
  store.write('settings.json', s);
  return healthSites();
});
ipcMain.handle('health:openSite', (_e, url) => {
  const u = String(url || '');
  const known = healthSites().some((s) => s.url === u) || (store.read('vercel.json', null)?.projects || []).some((p) => [p.domain, p.production?.url, p.latest?.url, p.production?.inspector, p.latest?.inspector].includes(u));
  if (!known || !/^https:\/\//.test(u)) return false;
  shell.openExternal(u);
  return true;
});
async function healthTick() {
  const sites = healthSites();
  if (!sites.length || !settingsOn('healthAlerts')) return;
  const r = await webhealth.checkAll(sites, ctxRW).catch(() => null);
  if (r) {
    const slow = sitewatch.recordUptime(ctxRW, sites.map((s) => ({ ...r.sites[s.url], url: s.url, name: s.name })).filter((x) => x.at));
    for (const s of slow) notify(s.name + ' va lenta', 'Responde en ' + (s.ms / 1000).toFixed(1) + ' s (lo normal es ' + (s.base / 1000).toFixed(1) + ' s).', null);
  }
  for (const c of r?.changes || []) {
    if (c.kind === 'down') notify(`${c.site.name} está caída`, `${c.site.url} no responde (${c.r.error || 'HTTP ' + c.r.status}).`, null);
    if (c.kind === 'up') notify(`${c.site.name} volvió`, `${c.site.url} responde otra vez.`);
    if (c.kind === 'ssl') notify(`El SSL de ${c.site.name} vence pronto`, `Le quedan ${c.r.sslDays} días al certificado de ${new URL(c.site.url).hostname}.`);
  }
}
ipcMain.handle('vercel:status', () => ({ linked: !!webhealth.getSecret(store.read, 'vercelEnc'), team: store.read('settings.json', {}).vercelTeam || null, last: store.read('vercel.json', null) }));
ipcMain.handle('vercel:setToken', async (_e, token) => {
  const ok = webhealth.setSecret(ctxRW, 'vercelEnc', token);
  if (!ok) {
    store.write('vercel.json', null);
    return { linked: false, teams: [] };
  }
  const teams = await webhealth.vercelTeams(store.read);
  return { linked: true, teams };
});
ipcMain.handle('vercel:teams', () => webhealth.vercelTeams(store.read));
ipcMain.handle('vercel:setTeam', (_e, id) => {
  const s = store.read('settings.json', {});
  if (id) s.vercelTeam = String(id);
  else delete s.vercelTeam;
  store.write('settings.json', s);
  store.write('vercel.json', null);
  return true;
});
ipcMain.handle('vercel:get', () => webhealth.deployments(ctxRW));
async function vercelTick() {
  if (!webhealth.getSecret(store.read, 'vercelEnc') || !settingsOn('vercelAlerts')) return;
  const r = await webhealth.deployments(ctxRW).catch(() => null);
  for (const p of (r?.failed || []).slice(0, 3)) notify(`Falló el despliegue de ${p.name}`, `${p.latest.target === 'production' ? 'Producción' : 'Preview'}${p.latest.branch ? ' · ' + p.latest.branch : ''}${p.latest.commit ? ': ' + p.latest.commit : ''}`, null);
}

// Avisos de Notion: tickets nuevos y menciones
async function notionTick() {
  if (!notion.linked(store.read) || !settingsOn('notionAlerts')) return;
  const r = await notion.watch(rx).catch(() => null);
  if (!r || r.first) return;
  const tickets = r.events.filter((e) => e.kind === 'ticket');
  const mentions = r.events.filter((e) => e.kind === 'mention');
  const comments = r.events.filter((e) => e.kind === 'comment');
  if (tickets.length === 1) notify('Ticket nuevo a tu nombre', `${tickets[0].ticket.title}${tickets[0].ticket.deadline ? ' · vence el ' + tickets[0].ticket.deadline : ''}`);
  else if (tickets.length > 1) notify(`${tickets.length} tickets nuevos a tu nombre`, tickets.slice(0, 3).map((e) => e.ticket.title).join('\n'));
  for (const m of mentions.slice(0, 3)) notify(`${m.comment.author} te mencionó`, `En «${m.ticket.title}»: ${m.comment.text}`);
  if (comments.length) notify(comments.length === 1 ? `Mensaje nuevo de ${comments[0].comment.author}` : `${comments.length} mensajes nuevos en tus tickets`, comments.slice(0, 3).map((c) => `«${c.ticket.title}»: ${c.comment.text.slice(0, 90)}`).join('\n'));
  if (r.events.length && win && !win.isDestroyed()) win.webContents.send('notion:changed');
}

// ---------- Casa ----------
ipcMain.handle('casa:get', () => casa.load(ctxRW));
ipcMain.handle('casa:save', (_e, d) => casa.save(ctxRW, d || {}));
ipcMain.handle('casa:openLink', (_e, url) => {
  const u = String(url || '');
  const c = store.read('casa.json', {});
  const known = [...(c.gifts || []), ...(c.warranties || [])].some((g) => g.link === u);
  if (!known || !/^https:\/\//.test(u)) return false;
  shell.openExternal(u);
  return true;
});
ipcMain.handle('casa:holidays', (_e, years) => casa.holidays(ctxRW, (Array.isArray(years) ? years : []).map(Number).filter((y) => y >= 2000 && y <= 2100).slice(0, 3)));
ipcMain.handle('anime:upcoming', (_e, force) => anime.upcoming(ctxRW, !!force));
ipcMain.handle('anime:search', (_e, q) => anime.search(String(q || '')));
ipcMain.handle('anime:mine', async (_e, refresh) => (refresh ? anime.refreshFollows(ctxRW).catch(() => anime.mine(ctxRW)) : anime.mine(ctxRW)));
ipcMain.handle('anime:follow', (_e, media, on) => {
  if (!media || !Number(media.id)) throw new Error('Anime no válido.');
  return anime.follow(ctxRW, media, !!on);
});
ipcMain.handle('anime:custom', (_e, list) => anime.saveCustom(ctxRW, list));
async function animeTick() {
  await anime.refreshFollows(ctxRW).catch(() => {});
  for (const n of anime.notices(ctxRW)) notify(n.title, n.body, n.url && /^https:\/\/anilist\.co\/anime\/\d+/.test(n.url) ? n.url : null);
}
ipcMain.handle('li:state', () => linkedin.state(store.read));
ipcMain.handle('li:search', (e) => linkedin.search(ctxRW, (t) => !e.sender.isDestroyed() && e.sender.send('li:progress', t)));
ipcMain.handle('li:detail', (_e, id) => {
  if (!/^\d{5,15}$/.test(String(id))) throw new Error('Oferta no válida.');
  return linkedin.detail(String(id));
});
ipcMain.handle('li:open', (_e, url) => {
  const u = String(url || 'https://www.linkedin.com/login');
  if (!/^https:\/\/www\.linkedin\.com\/(login|jobs\/view\/\d+\/?|my-items\/saved-jobs\/\?cardType=APPLIED|jobs\/collections\/recommended\/?)$/.test(u)) return false;
  return linkedin.openAccount(u);
});
// Abre en Brave (donde ya tienes la sesión de LinkedIn); si no está, en el navegador predeterminado
function openInBrave(url) {
  const fs = require('fs');
  const p = require('path');
  const cands = [p.join(process.env.ProgramFiles || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), p.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), p.join(process.env['ProgramFiles(x86)'] || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')];
  const exe = cands.find((c) => fs.existsSync(c));
  if (!exe) return shell.openExternal(url);
  require('child_process').spawn(exe, [url], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}
ipcMain.handle('li:browser', (_e, url) => {
  const u = String(url || '');
  if (!/^https:\/\/www\.linkedin\.com\/(jobs\/view\/\d+\/?|my-items\/saved-jobs\/\?cardType=APPLIED|jobs\/collections\/recommended\/?|jobs\/search\/\?[\w=&%.+-]*)$/.test(u)) return false;
  openInBrave(u);
  return true;
});
ipcMain.handle('li:read', (_e, which) => linkedin.readAccount(ctxRW, which === 'applied' ? 'applied' : 'recommended'));
ipcMain.handle('li:track', (_e, job, status) => {
  if (!job || !/^\d{5,15}$/.test(String(job.id))) throw new Error('Oferta no válida.');
  return linkedin.track(ctxRW, job, ['saved', 'applied', 'viewed', 'interview', 'offer', 'rejected'].includes(status) ? status : null);
});
ipcMain.handle('li:prefs', (_e, p) => linkedin.savePrefs(ctxRW, p || {}));
// ---------- Editor de código y chat con Claude (Websites) ----------
let edRoot = null;
const edCheck = () => {
  if (!edRoot) throw new Error('Abre primero una web en el editor.');
  return edRoot;
};
ipcMain.handle('ed:open', (e, dir) => {
  if (!inWebRoot(dir)) throw new Error('Esa carpeta no está dentro de tus webs.');
  edRoot = require('path').resolve(dir);
  codeedit.watch(edRoot, (files) => !e.sender.isDestroyed() && e.sender.send('ed:fs', files));
  return { root: edRoot, name: require('path').basename(edRoot) };
});
ipcMain.handle('ed:close', () => {
  codeedit.unwatch();
  edRoot = null;
  return true;
});
ipcMain.handle('ed:list', (_e, rel) => codeedit.list(edCheck(), rel || ''));
ipcMain.handle('ed:read', (_e, rel) => codeedit.read(edCheck(), String(rel || '')));
ipcMain.handle('ed:write', (_e, rel, text, eol) => codeedit.write(edCheck(), String(rel || ''), text, eol));
ipcMain.handle('ed:create', (_e, rel, isDir) => codeedit.create(edCheck(), String(rel || ''), !!isDir));
ipcMain.handle('ed:rename', (_e, from, to) => codeedit.rename(edCheck(), String(from || ''), String(to || '')));
ipcMain.handle('ed:trash', (_e, rel) => codeedit.trash(edCheck(), String(rel || '')));
ipcMain.handle('ed:git', async () => {
  const r = await repos.inspect(edCheck(), { fetch: false }).catch(() => null);
  return r && { branch: r.branch, changes: r.changes?.total || 0, ahead: r.ahead || 0, behind: r.behind || 0 };
});
ipcMain.handle('claude:status', () => claudeChat.available());
ipcMain.handle('claude:send', (e, o) => {
  const cwd = edCheck();
  const chatId = String(o?.chatId || 'main').slice(0, 40);
  const ok = ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
  return claudeChat.send({
    cwd,
    chatId,
    text: String(o?.text || '').slice(0, 100000),
    session: /^[0-9a-f-]{36}$/i.test(o?.session || '') ? o.session : null,
    model: ok.includes(o?.model) ? o.model : null,
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(o?.effort) ? o.effort : null,
    access: ['read', 'edit', 'run'].includes(o?.access) ? o.access : 'edit',
  }, (ev) => !e.sender.isDestroyed() && e.sender.send('claude:event', { chatId, ev }));
});
ipcMain.handle('claude:stop', (_e, chatId) => claudeChat.stop(String(chatId || 'main')));
ipcMain.handle('claude:history', (_e, dir) => (store.read('claude-chats.json', {})[String(dir)] || null));
ipcMain.handle('claude:saveHistory', (_e, dir, h) => {
  if (!inWebRoot(dir)) return false;
  const all = store.read('claude-chats.json', {});
  all[String(dir)] = { session: h?.session || null, model: h?.model || null, messages: (h?.messages || []).slice(-150), usage: h?.usage || null, at: Date.now() };
  store.write('claude-chats.json', all);
  return true;
});

// Casa → Alquileres (Facebook Marketplace con tu sesión)
ipcMain.handle('mk:state', () => marketplace.state(store.read));
ipcMain.handle('mk:search', () => marketplace.search(ctxRW));
ipcMain.handle('mk:prefs', (_e, p) => marketplace.savePrefs(ctxRW, p || {}));
ipcMain.handle('mk:star', (_e, item, on) => {
  if (!item || !/^\d{5,25}$/.test(String(item.id))) throw new Error('Publicación no válida.');
  return marketplace.star(ctxRW, item, !!on);
});
ipcMain.handle('mk:window', (e) => marketplace.openWindow(marketplace.state(store.read).url, { ...ctxRW, onCity: (id) => !e.sender.isDestroyed() && e.sender.send('mk:city', id) }));
ipcMain.handle('mk:openItem', (_e, id) => {
  if (!/^\d{5,25}$/.test(String(id))) return false;
  shell.openExternal(`https://www.facebook.com/marketplace/item/${id}/`);
  return true;
});

// ViperTech → Email (IMAP de Hostinger, solo lectura)
ipcMain.handle('mail:account', () => mail.account(store.read));
ipcMain.handle('mail:setAccount', (_e, a) => mail.setAccount(ctxRW, a || {}));
ipcMain.handle('mail:cached', () => store.read('mail-cache.json', null));
ipcMain.handle('mail:inbox', () => mail.inbox(ctxRW));
ipcMain.handle('mail:openWeb', () => shell.openExternal('https://mail.hostinger.com/'));
async function mailTick() {
  if (!mail.account(store.read).hasPassword) return;
  const r = await mail.inbox(ctxRW).catch(() => null);
  if (!r) return;
  if (win && !win.isDestroyed()) win.webContents.send('mail:changed', r);
  if (!settingsOn('mailAlerts') || !r.fresh?.length) return;
  if (r.fresh.length === 1) notify(`Correo de ${r.fresh[0].from}`, r.fresh[0].subject, null);
  else notify(`${r.fresh.length} correos nuevos en ${r.user}`, r.fresh.slice(0, 3).map((m) => `${m.from}: ${m.subject}`).join('\n'));
}

function casaTick() {
  for (const n of casa.dueNotices(ctxRW)) notify(n.title, n.body);
}

// ---------- 1.16: Mi día, regalos de juegos, mods, Genshin, Casa, copias ----------
const giveaways = require('./src/giveaways');
const nexus = require('./src/nexus');
const genshinEndgame = require('./src/genshin-endgame');
const cloudbackup = require('./src/cloudbackup');

ipcMain.handle('gw:list', (_e, force) => giveaways.list(ctxRW, !!force));
async function giveawayTick() {
  if (!settingsOn('giveawayAlerts')) return;
  const r = await giveaways.list(ctxRW, true).catch(() => null);
  const fresh = (r?.items || []).filter((x) => x.isNew);
  if (!r || r.first || !fresh.length) return;
  notify(fresh.length === 1 ? `Gratis en ${fresh[0].store}: ${fresh[0].title}` : `${fresh.length} juegos gratis nuevos`, fresh.slice(0, 3).map((x) => `${x.store}: ${x.title}${x.worth ? ` (antes ${x.worth})` : ''}`).join('\n'), fresh.length === 1 ? fresh[0].url : null);
}

ipcMain.handle('nexus:top', (_e, title) => nexus.top(ctxRW, String(title || '').slice(0, 120)));

// Logros fáciles que te faltan (los que tiene más gente), de los juegos que ya empezaste
ipcMain.handle('ach:easy', async () => {
  const auth = await steamAuth();
  const sum = store.read('achievements.json', null);
  const lib = new Map((store.read('library.json', null)?.games || []).filter((g) => g.store === 'steam').map((g) => [Number(g.id.split(':')[1]), g]));
  const started = Object.entries(sum?.games || {})
    .filter(([, g]) => g.total && g.done > 0 && g.done < g.total)
    .sort((a, b) => b[1].done / b[1].total - a[1].done / a[1].total)
    .slice(0, 14);
  const out = [];
  let i = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (i < started.length) {
      const [appid, g] = started[i++];
      const d = await achievements.detail({ ...auth, appid: Number(appid), read: store.read, write: store.write }).catch(() => null);
      const game = lib.get(Number(appid));
      for (const a of (d?.missing || []).filter((x) => x.globalPct != null && x.globalPct >= 25).slice(0, 4)) out.push({ ...a, appid: Number(appid), game: game?.title || `App ${appid}`, gameId: game?.id || null, done: g.done, total: g.total });
    }
  }));
  return out.sort((a, b) => b.globalPct - a.globalPct).slice(0, 40);
});

// Genshin: recompensa diaria, reinicios y banners
ipcMain.handle('hoyo:sign', () => hoyolab.signInfo(store.read));
ipcMain.handle('gend:resets', () => genshinEndgame.resets());
ipcMain.handle('hoyo:openSign', () => shell.openExternal(hoyolab.SIGN_PAGE));
async function checkinTick() {
  if (!settingsOn('checkinAlert') || !hoyolab.linked(store.read)) return;
  if (new Date().getHours() < 9) return;
  const today = new Date().toDateString();
  const s = store.read('settings.json', {});
  if (s.lastCheckinNotice === today) return;
  const r = await hoyolab.signInfo(store.read).catch(() => null);
  if (!r || r.error || r.signed) return;
  s.lastCheckinNotice = today;
  store.write('settings.json', s);
  notify('Te falta la recompensa diaria de HoYoLAB', 'Haz clic para abrir la página y reclamarla.', hoyolab.SIGN_PAGE);
}

// Casa: presupuesto y alertas de alquiler
ipcMain.handle('casa:budget', async () => casa.budgetStatus(casa.load(ctxRW), Date.now(), (await fx.get(ctxRW).catch(() => null))?.sell));
async function rentTick() {
  if (!settingsOn('rentAlerts')) return;
  const st = marketplace.state(store.read);
  if (!st.prefs.city) return; // aún no eligió la ubicación en Facebook
  const r = await marketplace.search(ctxRW).catch(() => null);
  const fresh = (r?.list || []).filter((x) => x.isNew);
  if (!r || r.login || !fresh.length) return;
  notify(fresh.length === 1 ? `Alquiler nuevo: ${fresh[0].price}` : `${fresh.length} alquileres nuevos en ${st.prefs.place}`, fresh.slice(0, 3).map((x) => `${x.price} · ${x.title}`).join('\n'));
  if (win && !win.isDestroyed()) win.webContents.send('mk:changed');
}

// Copia en OneDrive (una al día)
ipcMain.handle('backup:status', () => ({ ...cloudbackup.status(), on: settingsOn('cloudBackup') }));
ipcMain.handle('backup:run', () => cloudbackup.run(app.getPath('userData')));
ipcMain.handle('backup:open', () => {
  const r = cloudbackup.root();
  if (r) shell.openPath(r);
  return !!r;
});
function backupTick() {
  if (!settingsOn('cloudBackup')) return;
  const st = cloudbackup.status();
  if (!st.available || st.last === new Date().toISOString().slice(0, 10)) return;
  try {
    cloudbackup.run(app.getPath('userData'));
  } catch {}
}

// Anime: sinopsis en español (con Claude Haiku, solo cuando se pide)
ipcMain.handle('anime:translations', () => anime.translations(store.read));
ipcMain.handle('anime:translate', (_e, items) => anime.translate(ctxRW, (Array.isArray(items) ? items : []).map((a) => ({ id: Number(a.id), synopsis: String(a.synopsis || '') })).filter((a) => a.id)));

// Mi día: todo lo de hoy en un solo lugar
const DAYMS = 86400000;
async function daySummary() {
  const now = Date.now();
  const d0 = new Date().setHours(0, 0, 0, 0);
  const cal = store.read('calendar-cache.json', null);
  const meetings = (cal?.events || []).filter((e) => e.end > now && e.start < d0 + DAYMS && e.myStatus !== 'DECLINED').map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay, link: e.link, daily: e.daily }));
  const c = casa.load(ctxRW);
  const pays = (c.payments || []).map((p) => ({ p, n: casa.nextDue(p, now) })).filter((x) => x.n && x.n.days <= 7).sort((a, b) => a.n.days - b.n.days).map(({ p, n }) => ({ name: p.name, group: p.group, days: n.days, date: n.date, amount: p.amount, currency: p.currency }));
  const bdays = (c.birthdays || []).map((b) => ({ b, n: casa.nextBirthday(b, now) })).filter((x) => x.b.day && x.n.days <= 7).sort((a, b) => a.n.days - b.n.days).map(({ b, n }) => ({ name: b.name, kind: b.kind, days: n.days, age: n.age }));
  const rems = (c.reminders || []).filter((r) => !r.done).map((r) => ({ ...r, days: Math.round((new Date(r.date + 'T00:00:00').getTime() - d0) / DAYMS) })).filter((r) => r.days >= 0 && r.days <= 3).sort((a, b) => a.days - b.days);
  const cats = (c.catCare || []).filter((x) => !x.done && x.next).map((x) => ({ ...x, days: Math.round((new Date(x.next + 'T00:00:00').getTime() - d0) / DAYMS) })).filter((x) => x.days <= 7).sort((a, b) => a.days - b.days);
  const nc = store.read('notion-cache.json', null)?.data;
  const tickets = (nc?.tickets || []).filter((t) => t.group !== 'done' && t.deadline && new Date(t.deadline + 'T23:59:59').getTime() < now + 2 * DAYMS).map((t) => ({ title: t.title, deadline: t.deadline, status: t.status, url: t.url, late: new Date(t.deadline + 'T23:59:59').getTime() < now })).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const mailC = store.read('mail-cache.json', null);
  const mailUnread = mailC ? { count: mailC.unread, last: (mailC.list || []).filter((m) => m.unread).slice(0, 3).map((m) => ({ from: m.from, subject: m.subject })) } : null;
  const hc = hoyolab.linked(store.read) ? store.read('hoyolab-cache.json', null)?.data?.notes : null;
  const manual = store.read('gresin.json', null);
  const resin = hc ? { value: hc.resin, max: hc.maxResin, fullAt: hc.resinFullAt } : manual ? resinFromManual(manual) : null;
  const am = anime.mine(ctxRW);
  const animeToday = Object.values(am.follows || {}).flatMap((a) => {
    const out = [];
    if (a.next && a.next.at < d0 + 2 * DAYMS && a.next.at > now - 6 * 3600000) out.push({ title: a.title, cover: a.cover, what: `Episodio ${a.next.episode}`, at: a.next.at });
    if (a.status === 'NOT_YET_RELEASED' && a.precision === 'day' && a.start >= d0 && a.start < d0 + 2 * DAYMS) out.push({ title: a.title, cover: a.cover, what: 'Estreno', at: a.start });
    return out;
  });
  const gw = store.read('giveaways.json', null);
  const rate = await fx.get(ctxRW).catch(() => null);
  const wx = await weather.get(ctxRW).catch(() => null);
  const budget = casa.budgetStatus(c, now, rate?.sell);
  const inDay = (iso) => Math.round((new Date(iso + 'T00:00:00').getTime() - d0) / DAYMS);
  const hogar = [
    ...(c.maintenance || []).map((m) => ({ m, n: casa.maintNext(m) })).filter((x) => x.n && inDay(x.n) <= 7).map(({ m, n }) => ({ kind: 'mant', name: m.name, days: inDay(n) })),
    ...(c.warranties || []).map((w) => ({ w, e: casa.warrantyEnd(w) })).filter((x) => x.e && inDay(x.e) >= 0 && inDay(x.e) <= 30).map(({ w, e }) => ({ kind: 'gar', name: `Garantía de ${w.name}`, days: inDay(e) })),
  ].sort((a, b) => a.days - b.days);
  const tramites = (c.tramites || []).filter((t) => t.due).map((t) => ({ name: t.name, due: t.due, days: Math.round((new Date(t.due + 'T00:00:00').getTime() - d0) / DAYMS) })).filter((t) => t.days <= 45).sort((a, b) => a.days - b.days);
  const gather = gatherState().filter((g) => g.readyAt <= now + 6 * 3600000).sort((a, b) => a.readyAt - b.readyAt).slice(0, 6);
  const pulls = (store.read('webs.json', null)?.repos || []).filter((r) => r.behind > 0).length;
  return { now, meetings, pays, bdays, rems, cats, tickets, mail: mailUnread, resin, anime: animeToday, giveaways: (gw?.items || []).slice(0, 6), budget: { limit: budget.limit, spent: budget.spent, currency: budget.currency }, shopping: (c.shopping || []).filter((x) => !x.done).length, pulls, resets: genshinEndgame.resets(now).slice(0, 2), fx: rate, weather: wx ? { now: wx.now, today: wx.days?.[0], hours: (wx.hours || []).slice(0, 8), stale: !!wx.stale } : null, hogar, tramites, gather, missed: store.read('dnd-missed.json', []).slice(0, 12), week: [0, 1].includes(new Date(now).getDay()) ? weekAhead(now) : null };
}
ipcMain.handle('day:summary', () => daySummary());

// Búsqueda global (Ctrl+K): índice de lo que hay fuera de la biblioteca
ipcMain.handle('search:index', () => {
  const out = [];
  const c = casa.load(ctxRW);
  for (const g of c.gifts || []) out.push({ label: g.name, hint: `Regalo para ${g.for}`, view: 'casa-regalos' });
  for (const s of c.shopping || []) if (!s.done) out.push({ label: s.name, hint: 'Lista de compras', view: 'casa-compras' });
  for (const p of c.payments || []) out.push({ label: `${p.name}${p.group !== 'Personal' ? ` (${p.group})` : ''}`, hint: 'Pago', view: 'casa-pagos' });
  for (const b of c.birthdays || []) out.push({ label: b.name, hint: b.kind === 'gato' ? 'Cumpleaños (gatito)' : 'Cumpleaños', view: 'casa-cumples' });
  for (const r of c.reminders || []) out.push({ label: r.title, hint: `Recordatorio · ${r.date}`, view: 'casa-recordatorios' });
  for (const t of store.read('notion-cache.json', null)?.data?.tickets || []) out.push({ label: t.title, hint: `Ticket · ${t.status}`, view: 'notion' });
  for (const r of store.read('webs.json', null)?.repos || []) out.push({ label: r.name, hint: 'Web', view: 'webs' });
  for (const a of Object.values(anime.mine(ctxRW).follows || {})) out.push({ label: a.title, hint: 'Anime que sigues', view: 'news', tab: 'anime' });
  for (const m of (store.read('mail-cache.json', null)?.list || []).slice(0, 40)) out.push({ label: m.subject, hint: `Correo de ${m.from}`, view: 'mail' });
  for (const p of Object.values(store.read('workana.json', {}).done || {})) if (p.title) out.push({ label: p.title, hint: 'Postulación de Workana', view: 'workana' });
  for (const j of Object.values(store.read('linkedin.json', {}).tracked || {})) out.push({ label: j.title, hint: `LinkedIn · ${j.company}`, view: 'linkedin' });
  return out;
});

// ---------- 1.17: tipo de cambio, no molestar, recolección, asistente, semana ----------
const fx = require('./src/fx');
ipcMain.handle('fx:get', (_e, force) => fx.get(ctxRW, !!force));

// No molestar: al terminar de jugar, un solo aviso con lo que llegó mientras tanto
function flushDnd() {
  if (!dndQueue.length) return;
  const items = dndQueue.splice(0);
  store.write('dnd-missed.json', [...items.reverse(), ...store.read('dnd-missed.json', [])].slice(0, 40));
  notify(`Mientras jugabas: ${items.length} ${items.length === 1 ? 'aviso' : 'avisos'}`, items.slice(0, 3).map((i) => i.title).join('\n') + (items.length > 3 ? `\ny ${items.length - 3} más (están en Mi día)` : ''), null, { urgent: true });
  if (win && !win.isDestroyed()) win.webContents.send('dnd:missed');
}
ipcMain.handle('dnd:missed', () => store.read('dnd-missed.json', []));
ipcMain.handle('dnd:clear', () => {
  store.write('dnd-missed.json', []);
  return true;
});

// Especialidades (48 h) y minerales (72 h) de Genshin: cuándo vuelven a salir
const GATHER_H = { especialidad: 48, mineral: 72 };
function gatherState() {
  return store.read('genshin-gather.json', []).map((g) => ({ ...g, readyAt: g.at + (GATHER_H[g.kind] || 48) * 3600000 }));
}
ipcMain.handle('gather:get', () => gatherState());
ipcMain.handle('gather:set', (_e, list) => {
  const clean = (Array.isArray(list) ? list : []).slice(0, 80).map((g) => ({
    id: String(g.id || '').slice(0, 20) || require('crypto').randomBytes(6).toString('hex'),
    name: String(g.name || '').slice(0, 80).trim(),
    kind: GATHER_H[g.kind] ? g.kind : 'especialidad',
    where: String(g.where || '').slice(0, 80).trim(),
    icon: /^https:\/\/[\w./%-]+$/.test(g.icon || '') ? g.icon : '',
    at: Number(g.at) || Date.now(),
    notified: !!g.notified,
  })).filter((g) => g.name);
  store.write('genshin-gather.json', clean);
  return gatherState();
});
function gatherTick() {
  if (!settingsOn('gatherAlerts')) return;
  const list = store.read('genshin-gather.json', []);
  const now = Date.now();
  const ready = list.filter((g) => !g.notified && g.at + (GATHER_H[g.kind] || 48) * 3600000 <= now);
  if (!ready.length) return;
  for (const g of ready) g.notified = true;
  store.write('genshin-gather.json', list);
  notify(ready.length === 1 ? `${ready[0].name} ya volvió a salir` : `${ready.length} recolecciones listas en Genshin`, ready.slice(0, 4).map((g) => g.name + (g.where ? ` (${g.where})` : '')).join(', ') + '.');
}

// La semana que viene: reuniones, pagos, cumpleaños, recordatorios, trámites y estrenos
function weekAhead(now = Date.now()) {
  const d0 = new Date(now).setHours(0, 0, 0, 0);
  const end = d0 + 8 * DAYMS;
  const inDays = (t) => Math.round((t - d0) / DAYMS);
  const cal = store.read('calendar-cache.json', null);
  const meetings = (cal?.events || []).filter((e) => !e.allDay && e.start > now && e.start < end && e.myStatus !== 'DECLINED').sort((a, b) => a.start - b.start).map((e) => ({ title: e.title, start: e.start }));
  const c = casa.load(ctxRW);
  const pays = (c.payments || []).map((p) => ({ p, n: casa.nextDue(p, now) })).filter((x) => x.n && x.n.days <= 7).sort((a, b) => a.n.days - b.n.days).map(({ p, n }) => ({ name: p.name + (p.group && p.group !== 'Personal' ? ` (${p.group})` : ''), days: n.days, amount: p.amount, currency: p.currency }));
  const bdays = (c.birthdays || []).map((b) => ({ b, n: casa.nextBirthday(b, now) })).filter((x) => x.b.day && x.n && x.n.days <= 7).sort((a, b) => a.n.days - b.n.days).map(({ b, n }) => ({ name: b.name, kind: b.kind, days: n.days }));
  const rems = (c.reminders || []).filter((r) => !r.done && r.date).map((r) => ({ title: r.title, days: inDays(new Date(r.date + 'T00:00:00').getTime()) })).filter((r) => r.days >= 0 && r.days <= 7);
  const tramites = (c.tramites || []).filter((t) => t.due).map((t) => ({ name: t.name, days: inDays(new Date(t.due + 'T00:00:00').getTime()) })).filter((t) => t.days >= 0 && t.days <= 7);
  const premieres = Object.values(anime.mine(ctxRW).follows || {}).flatMap((a) => {
    if (a.status === 'NOT_YET_RELEASED' && a.precision === 'day' && a.start > now && a.start < end) return [{ title: a.title, at: a.start }];
    if (a.next && a.next.episode === 1 && a.next.at > now && a.next.at < end) return [{ title: a.title, at: a.next.at }];
    return [];
  });
  return { from: d0, meetings, pays, bdays, rems, tramites, premieres };
}
ipcMain.handle('week:ahead', () => weekAhead());
function sundayTick() {
  if (!settingsOn('sundaySummary')) return;
  const now = new Date();
  if (now.getDay() !== 0 || now.getHours() < 18) return;
  const key = now.toLocaleDateString('sv');
  if (store.read('sunday.json', {}).last === key) return;
  store.write('sunday.json', { last: key, at: Date.now() });
  const w = weekAhead(now.getTime());
  const parts = [];
  if (w.meetings.length) parts.push(`${w.meetings.length} ${w.meetings.length === 1 ? 'reunión' : 'reuniones'}`);
  if (w.pays.length) parts.push(`${w.pays.length} ${w.pays.length === 1 ? 'pago' : 'pagos'} (${w.pays.slice(0, 3).map((p) => p.name).join(', ')})`);
  for (const b of w.bdays.slice(0, 3)) parts.push(`cumple de ${b.name}`);
  if (w.rems.length) parts.push(`${w.rems.length} ${w.rems.length === 1 ? 'recordatorio' : 'recordatorios'}`);
  for (const t of w.tramites) parts.push(`vence ${t.name}`);
  for (const a of w.premieres.slice(0, 2)) parts.push(`estreno de ${a.title}`);
  notify('Tu semana que viene', parts.length ? parts.join(', ') + '.' : 'Semana tranquila: no hay nada agendado.');
}

// Asistente general: Claude Code con un resumen de tus datos en contexto.md
const ASSIST_SYSTEM = 'Eres el asistente de ViperTeca, la app personal de Vincenzo (vive en Guápiles, Costa Rica). Responde en español, breve y directo, sin relleno. En la carpeta actual está contexto.md con sus datos de hoy (agenda, pagos, presupuesto, trámites, compras, cumpleaños, regalos, juegos, Genshin, anime, tickets y tipo de cambio): léelo antes de responder cualquier pregunta sobre sus cosas. Puedes buscar en la web si hace falta. No puedes cambiar nada de la app: si te pide hacerlo, dile en qué pantalla hacerlo. Nunca pidas contraseñas ni claves.';
function assistDir() {
  const p = require('path').join(app.getPath('userData'), 'asistente');
  require('fs').mkdirSync(p, { recursive: true });
  return p;
}
async function assistContext(cwd) {
  const d = await daySummary();
  const c = casa.load(ctxRW);
  const now = Date.now();
  const fdate = (t) => new Date(t).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const L = ['# Datos de Vincenzo en ViperTeca', `Generado: ${new Date().toLocaleString('es')}`];
  const sec = (title, rows) => {
    if (rows.length) L.push('', `## ${title}`, ...rows);
  };
  const cal = store.read('calendar-cache.json', null);
  sec('Agenda (próximos 7 días)', (cal?.events || []).filter((e) => e.end > now && e.start < now + 7 * DAYMS && e.myStatus !== 'DECLINED').slice(0, 40).map((e) => `- ${fdate(e.start)} ${e.allDay ? 'todo el día' : hm(e.start)}: ${e.title}`));
  sec('Pagos mensuales', (c.payments || []).map((p) => {
    const n = casa.nextDue(p, now);
    return `- ${p.name} (${p.group})${p.amount ? `: ${p.amount} ${p.currency}` : ''}${p.day ? `, día ${p.day}` : ''}${n ? `, próximo ${fdate(n.date)}${n.days < 0 ? ' (atrasado)' : ''}` : ''}`;
  }));
  const b = casa.budgetStatus(c, now, d.fx?.sell);
  sec('Presupuesto del mes', [`- Gastado ${b.spent.toLocaleString('es')} ${b.currency}${b.limit ? ` de ${b.limit.toLocaleString('es')}` : ' (sin límite puesto)'}`, ...Object.entries(b.byKind).map(([k, v]) => `- ${k}: ${v.toLocaleString('es')}`)]);
  if (d.fx) sec('Tipo de cambio del dólar (Banco Central)', [`- Compra ₡${d.fx.buy}, venta ₡${d.fx.sell} (${d.fx.date || 'hoy'})`]);
  sec('Trámites', (c.tramites || []).map((t) => `- ${t.name}: ${t.due ? `vence el ${t.due}` : 'sin fecha puesta'}${t.plate ? `, placa ${t.plate}` : ''}${t.note ? ` (${t.note})` : ''}`));
  sec('Lista de compras pendiente', (c.shopping || []).filter((s) => !s.done).map((s) => `- ${s.name}${s.qty ? ` (${s.qty})` : ''} [${s.cat}]`));
  sec('Cumpleaños', (c.birthdays || []).map((x) => ({ x, n: casa.nextBirthday(x, now) })).filter((y) => y.n).sort((a, z) => a.n.days - z.n.days).map(({ x, n }) => `- ${x.name}${x.kind === 'gato' ? ' (gatito)' : ''}: ${x.day || '¿?'}/${x.month}, faltan ${n.days} días${n.age ? `, cumple ${n.age}` : ''}`));
  sec('Recordatorios', (c.reminders || []).filter((r) => !r.done).map((r) => `- ${r.date}${r.time ? ' ' + r.time : ''}: ${r.title}`));
  sec('Ideas de regalo', (c.gifts || []).filter((g) => g.status === 'idea').map((g) => `- Para ${g.for}: ${g.name}${g.note ? ` (${g.note})` : ''}${g.price ? `, ${g.price}` : ''}`));
  sec('Cuidados de los gatitos', (c.catCare || []).filter((x) => !x.done && x.next).map((x) => `- ${x.cat}: ${x.type} el ${x.next}`));
  const lib = store.read('library.json', null)?.games || [];
  const byGame = {};
  for (const s of store.read('sessions.json', []).filter((s) => s.end > now - 60 * DAYMS)) byGame[s.title] = (byGame[s.title] || 0) + (s.end - s.start) / 3600000;
  sec('Juegos', [
    `- ${lib.length} juegos en la biblioteca, ${lib.filter((g) => g.installed).length} instalados`,
    `- Más jugados en los últimos 60 días: ${Object.entries(byGame).sort((a, z) => z[1] - a[1]).slice(0, 8).map(([t, h]) => `${t} (${h.toFixed(1)} h)`).join(', ') || 'ninguno registrado'}`,
    `- Instalados: ${lib.filter((g) => g.installed).map((g) => g.title).slice(0, 80).join(', ')}`,
  ]);
  const gr = [];
  if (d.resin) gr.push(`- Resina ${d.resin.value}/${d.resin.max}`);
  try {
    const w = genshinWish.summary(store.read('genshin-wishes.json', { items: {} }));
    for (const p of w?.pools || []) gr.push(`- ${p.name}: ${p.pity5} tiradas desde el último 5★ (máximo ${p.hardPity})${p.key === 'character' ? (p.guaranteed ? ', el próximo 5★ es garantizado' : ', está en 50/50') : ''}`);
  } catch {}
  for (const r of d.resets || []) gr.push(`- ${r.name}: ${fdate(r.at)}`);
  sec('Genshin Impact', gr);
  sec('Anime que sigue', Object.values(anime.mine(ctxRW).follows || {}).slice(0, 30).map((a) => `- ${a.title}${a.next ? `: episodio ${a.next.episode} el ${fdate(a.next.at)}` : ''}`));
  sec('Correos sin leer', (d.mail?.last || []).map((m) => `- ${m.from}: ${m.subject}`));
  const nc = store.read('notion-cache.json', null)?.data;
  sec('Tickets de Notion abiertos', (nc?.tickets || []).filter((t) => t.group !== 'done').slice(0, 30).map((t) => `- ${t.title} (${t.status}${t.deadline ? `, vence ${t.deadline}` : ''})`));
  require('fs').writeFileSync(require('path').join(cwd, 'contexto.md'), L.join('\n'), 'utf8');
}
ipcMain.handle('assist:send', async (e, o) => {
  const cwd = assistDir();
  await assistContext(cwd).catch((err) => log(`asistente: ${err.message}`));
  return claudeChat.send({
    cwd,
    chatId: 'assist',
    text: String(o?.text || '').slice(0, 20000),
    session: /^[0-9a-f-]{36}$/i.test(o?.session || '') ? o.session : null,
    model: ['haiku', 'sonnet', 'opus'].includes(o?.model) ? o.model : 'sonnet',
    access: 'ask',
    system: ASSIST_SYSTEM,
  }, (ev) => !e.sender.isDestroyed() && e.sender.send('claude:event', { chatId: 'assist', ev }));
});
ipcMain.handle('assist:stop', () => claudeChat.stop('assist'));
ipcMain.handle('assist:history', () => store.read('assist-chat.json', null));
ipcMain.handle('assist:save', (_e, h) => {
  store.write('assist-chat.json', { session: /^[0-9a-f-]{36}$/i.test(h?.session || '') ? h.session : null, model: String(h?.model || 'sonnet').slice(0, 20), messages: (Array.isArray(h?.messages) ? h.messages : []).slice(-120), at: Date.now() });
  return true;
});

// Inventario de Genshin: cuánto tienes de cada material del plan (lo anotas tú)
ipcMain.handle('ginv:get', () => store.read('genshin-inventory.json', {}));
ipcMain.handle('ginv:set', (_e, name, n) => {
  const inv = store.read('genshin-inventory.json', {});
  const k = String(name || '').slice(0, 80).trim();
  if (!k) return inv;
  const v = Math.max(0, Math.min(1e10, Math.round(Number(n) || 0)));
  if (v) inv[k] = v;
  else delete inv[k];
  store.write('genshin-inventory.json', inv);
  return inv;
});
// Tienda de Paimon: el día 1 de cada mes se renuevan los destinos de brillo y polvo
function paimonTick() {
  if (!settingsOn('paimonAlert')) return;
  const now = new Date();
  if (now.getDate() !== 1 || now.getHours() < 9) return;
  const key = now.toLocaleDateString('sv').slice(0, 7);
  const s = store.read('settings.json', {});
  if (s.lastPaimonNotice === key) return;
  s.lastPaimonNotice = key;
  store.write('settings.json', s);
  notify('Se renovó la tienda de Paimon', 'Cambia brillo y polvo estelar por los 10 destinos entrelazados y 10 encontrados de este mes.');
}

// Mapa interactivo oficial de Genshin (HoYoLAB) en una ventana de la app.
// Usa su propia sesión guardada: si entras con tu cuenta de HoYoLAB, tus marcas
// se quedan. Recuerda dónde lo dejaste (mapa, centro y zoom).
const GMAP_HOME = 'https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=es-es#/map/2?shown_types=&center=2008.50,-1084.00&zoom=-2.50';
const GMAP_OK = /^https:\/\/([\w-]+\.)*(hoyolab\.com|hoyoverse\.com|mihoyo\.com|hoyo\.link)\//;
let gmapWin = null;
ipcMain.handle('gmap:open', (_e, fresh) => {
  if (gmapWin && !gmapWin.isDestroyed()) {
    if (fresh) gmapWin.loadURL(GMAP_HOME);
    gmapWin.show();
    gmapWin.focus();
    return true;
  }
  const last = store.read('gmap.json', {}).url;
  gmapWin = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Mapa interactivo de Genshin',
    backgroundColor: '#11131a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { partition: 'persist:vt-genshin-map', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  gmapWin.removeMenu();
  const wc = gmapWin.webContents;
  // solo páginas de HoYoverse dentro de la ventana; el resto, fuera o nada
  wc.on('will-navigate', (ev, url) => {
    if (!GMAP_OK.test(url)) ev.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (GMAP_OK.test(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: 'persist:vt-genshin-map', sandbox: true, contextIsolation: true } } };
    return { action: 'deny' };
  });
  const remember = () => {
    const u = !wc.isDestroyed() && wc.getURL();
    if (u && /^https:\/\/act\.hoyolab\.com\/ys\/app\/interactive-map\//.test(u)) store.write('gmap.json', { url: u, at: Date.now() });
  };
  wc.on('did-navigate-in-page', remember);
  gmapWin.on('close', remember);
  gmapWin.on('closed', () => (gmapWin = null));
  gmapWin.loadURL(!fresh && last && GMAP_OK.test(last) ? last : GMAP_HOME);
  return true;
});


// ---------- 1.18: ViperTeca en el iPhone (misma wifi o por Tailscale) ----------
// Lo que ve y puede hacer la app del celular. Solo lectura, salvo marcar compras,
// pagos, recordatorios y recolecciones, anotar gastos, abrir juegos y preguntar.
const mobileCasaChanged = () => win && !win.isDestroyed() && win.webContents.send('casa:changed');
// Avisos en el iPhone: certificado HTTPS de Tailscale y suscripciones Web Push
const webpush = require('./src/webpush');
function tsCertPaths() {
  const dir = path.join(app.getPath('userData'), 'tls');
  return { dir, cert: path.join(dir, 'ts.crt'), key: path.join(dir, 'ts.key') };
}
function tsExe() {
  const p = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
  return require('fs').existsSync(p) ? p : null;
}
/** Pide (o renueva) el certificado HTTPS del PC a Tailscale y enciende el servidor seguro. */
async function enableHttps() {
  const exe = tsExe();
  if (!exe) throw new Error('No encuentro Tailscale en este PC.');
  const info = lan ? lan.info() : null;
  const name = info?.tailscale?.name;
  if (!name) throw new Error('Tailscale no está conectado (no tengo el nombre del PC en tu red).');
  const p = tsCertPaths();
  require('fs').mkdirSync(p.dir, { recursive: true });
  await new Promise((resolve, reject) => {
    require('child_process').execFile(exe, ['cert', '--cert-file', p.cert, '--key-file', p.key, name], { windowsHide: true, timeout: 60000 }, (err, _o, se) => {
      if (!err) return resolve();
      const m = String(se || err.message);
      reject(new Error(/not enabled|HTTPS/i.test(m) ? 'Activa «HTTPS Certificates» en tu panel de Tailscale (DNS → HTTPS Certificates) y vuelve a intentarlo.' : 'Tailscale no dio el certificado: ' + m.trim().split('\n').pop()));
    });
  });
  const fs = require('fs');
  await lan.startSecure({ cert: fs.readFileSync(p.cert), key: fs.readFileSync(p.key) });
  return lan.info();
}
function loadTls() {
  const p = tsCertPaths();
  const fs = require('fs');
  try {
    return { cert: fs.readFileSync(p.cert), key: fs.readFileSync(p.key), age: Date.now() - fs.statSync(p.cert).mtimeMs };
  } catch {
    return null;
  }
}
ipcMain.handle('lan:https', () => enableHttps());
const pushSubs = () => store.read('push-subs.json', []);
let pushQueue = Promise.resolve();
function pushToPhone(title, body, opts = {}) {
  const subs = pushSubs();
  if (!subs.length || store.read('settings.json', {}).pushPhone === false) return;
  pushQueue = pushQueue.then(async () => {
    const keep = [];
    for (const s of subs) {
      const r = await webpush.send(ctxRW, s, { title, body, urgent: opts.urgent, tag: opts.tag });
      if (r !== 'gone') keep.push(s);
    }
    if (keep.length !== subs.length) store.write('push-subs.json', keep);
  }).catch(() => {});
}
const mobileApi = {
  pushKey: () => webpush.keys(ctxRW).pub,
  async pushSub(sub, test) {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return false;
    const list = pushSubs().filter((s) => s.endpoint !== sub.endpoint);
    list.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, at: Date.now() });
    store.write('push-subs.json', list.slice(-5));
    if (test) await webpush.send(ctxRW, sub, { title: 'ViperTeca', body: 'Listo: los avisos de ViperTeca llegarán a este iPhone.' });
    return true;
  },
  async get(section) {
    const now = Date.now();
    const d0 = new Date().setHours(0, 0, 0, 0);
    const inDays = (iso) => Math.round((new Date(iso + 'T00:00:00').getTime() - d0) / DAYMS);
    if (section === 'hoy') return daySummary();
    if (section === 'semana') return weekReview();
    if (section === 'casa') {
      const c = casa.load(ctxRW);
      const rate = await fx.get(ctxRW).catch(() => null);
      const month = new Date().toLocaleDateString('sv').slice(0, 7);
      const b = casa.budgetStatus(c, now, rate?.sell);
      return {
        fx: rate,
        shopping: { cats: c.shopCats, items: (c.shopping || []).map((x) => ({ id: x.id, name: x.name, qty: x.qty, cat: x.cat, done: x.done })) },
        payments: (c.payments || []).map((p) => {
          const n = casa.nextDue(p, now);
          return { id: p.id, name: p.name, group: p.group, day: p.day, amount: p.amount, currency: p.currency, paid: !!p.paid?.[month], days: n?.days ?? null };
        }),
        groups: c.payGroups,
        budget: { limit: b.limit, spent: b.spent, currency: b.currency, byKind: b.byKind, lines: b.lines.slice(-12).reverse(), planned: b.planned },
        reminders: (c.reminders || []).filter((r) => !r.done).map((r) => ({ id: r.id, title: r.title, date: r.date, time: r.time, days: inDays(r.date) })).sort((a, z) => a.days - z.days),
        birthdays: (c.birthdays || []).map((x) => ({ x, n: casa.nextBirthday(x, now) })).filter((y) => y.n).sort((a, z) => a.n.days - z.n.days).map(({ x, n }) => ({ name: x.name, kind: x.kind, day: x.day, month: x.month, days: n.days, age: n.age })),
        gifts: (c.gifts || []).filter((g) => g.status === 'idea').map((g) => ({ name: g.name, for: g.for, note: g.note, price: g.price, image: /^https:/.test(g.image || '') ? g.image : '' })),
        tramites: (c.tramites || []).map((t) => ({ name: t.name, due: t.due, days: t.due ? inDays(t.due) : null, plate: t.plate })).sort((a, z) => (a.days ?? 9e9) - (z.days ?? 9e9)),
        cats: (c.catCare || []).filter((x) => !x.done && x.next).map((x) => ({ cat: x.cat, type: x.type, next: x.next, days: inDays(x.next) })).sort((a, z) => a.days - z.days),
      };
    }
    if (section === 'juegos') {
      const lib = store.read('library.json', null)?.games || [];
      const sess = store.read('sessions.json', []);
      const week = sess.filter((s) => s.end > now - 7 * DAYMS).reduce((a, s) => a + (s.end - s.start), 0) / 60000;
      const pick = (g) => ({ id: g.id, title: g.title, cover: /^https:/.test(g.cover || '') ? g.cover : '', store: g.store, installed: !!g.installed, lastPlayed: (g.lastPlayed || 0) * 1000, hours: Math.round((g.playtimeMin || 0) / 60) });
      return {
        current: tracker.current ? { title: tracker.current.title, start: tracker.current.start } : null,
        focus: focus.mode,
        weekMin: Math.round(week),
        recent: lib.filter((g) => g.lastPlayed && g.kind !== 'tool').sort((a, z) => z.lastPlayed - a.lastPlayed).slice(0, 12).map(pick),
        installed: lib.filter((g) => g.installed && g.kind !== 'tool').sort((a, z) => a.title.localeCompare(z.title, 'es')).map(pick),
        total: lib.length,
      };
    }
    if (section === 'genshin') {
      const d = await daySummary();
      let pools = [];
      try {
        pools = (genshinWish.summary(store.read('genshin-wishes.json', { items: {} }))?.pools || []).map((p) => ({ name: p.name, key: p.key, pity: p.pity5, hard: p.hardPity, guaranteed: p.guaranteed }));
      } catch {}
      const codes = await genshinCodes.list(ctxRW, false).catch(() => null);
      const notes = hoyolab.linked(store.read) ? store.read('hoyolab-cache.json', null)?.data?.notes : null;
      return { notes: notes ? { commissionsDone: notes.commissionsDone, commissionsTotal: notes.commissionsTotal, commissionReward: notes.commissionReward, weeklyLeft: notes.weeklyLeft, weeklyTotal: notes.weeklyTotal, realmCoins: notes.realmCoins, realmMax: notes.realmMax, expeditions: (notes.expeditions || []).map((x) => ({ done: x.done, minutesLeft: x.minutesLeft })), transformerReady: notes.transformerReady } : null, resin: d.resin, resets: genshinEndgame.resets(now), pools, gather: gatherState().sort((a, z) => a.readyAt - z.readyAt), codes: (codes?.codes || codes?.list || []).slice(0, 12).map((x) => ({ code: x.code, rewards: x.rewards, used: x.used, url: x.url })) };
    }
    if (section === 'trabajo') {
      const cal = store.read('calendar-cache.json', null);
      const nc = store.read('notion-cache.json', null)?.data;
      const mc = store.read('mail-cache.json', null);
      return {
        meetings: (cal?.events || []).filter((e) => e.end > now && e.start < now + 7 * DAYMS && e.myStatus !== 'DECLINED').sort((a, z) => a.start - z.start).slice(0, 40).map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay, link: /^https:\/\/meet\.google\.com\//.test(e.link || '') ? e.link : null })),
        tickets: (nc?.tickets || []).filter((t) => t.group !== 'done').slice(0, 40).map((t) => ({ title: t.title, status: t.status, deadline: t.deadline, late: !!t.deadline && new Date(t.deadline + 'T23:59:59').getTime() < now })),
        mail: { user: mc?.user || null, unread: mc?.unread || 0, list: (mc?.list || []).slice(0, 20).map((m) => ({ from: m.from, subject: m.subject, date: m.date, unread: m.unread })) },
      };
    }
    if (section === 'anime') {
      return Object.values(anime.mine(ctxRW).follows || {}).map((a) => ({ title: a.title, cover: /^https:/.test(a.cover || '') ? a.cover : '', next: a.next || null, status: a.status, start: a.start })).sort((a, z) => (a.next?.at || 9e15) - (z.next?.at || 9e15));
    }
    if (section === 'viendo') {
      const all = store.read('streaming.json', {});
      const shows = [];
      for (const a of Object.values(all)) for (const e of streaming.summarize(a).slice(0, 12)) shows.push({ ...(await streaming.enrich(ctxRW, e, a.platform).catch(() => ({ ...e, platform: a.platform }))), who: a.who });
      return shows.sort((x, y) => (y.last.date || 0) - (x.last.date || 0)).slice(0, 30).map((s) => ({ name: s.name, platform: s.platform, who: s.who, left: s.left, total: s.total, next: s.next, cover: /^https:/.test(s.cover || '') ? s.cover : '', last: { date: s.last.date, episode: s.last.episodeTitle || s.last.episode, season: s.last.season } }));
    }
    if (section === 'pc') {
      const s = await sensors.read().catch(() => null);
      return { shutdownAt, sensors: s ? { cpu: s.cpu, gpu: s.gpu, fans: (s.fans || []).slice(0, 6) } : null, focus: focus.status(), current: tracker.current ? { title: tracker.current.title, start: tracker.current.start } : null };
    }
    return null;
  },
  async act(a, q) {
    const c = () => casa.load(ctxRW);
    if (a === 'pay') {
      const d = c();
      const p = (d.payments || []).find((x) => x.id === q.get('id'));
      if (!p) return false;
      const k = new Date().toLocaleDateString('sv').slice(0, 7);
      p.paid ||= {};
      if (p.paid[k]) delete p.paid[k];
      else p.paid[k] = Date.now();
      casa.save(ctxRW, d);
      mobileCasaChanged();
      return true;
    }
    if (a === 'receipt') {
      return applyReceipt({ paymentId: String(q.get('id') || ''), month: String(q.get('month') || ''), amount: Number(q.get('amount')), currency: String(q.get('currency') || 'CRC'), due: q.get('due') || null }).ok;
    }
    if (a === 'rem') {
      const d = c();
      const r = (d.reminders || []).find((x) => x.id === q.get('id'));
      if (!r) return false;
      r.done = true;
      casa.save(ctxRW, d);
      mobileCasaChanged();
      return true;
    }
    if (a === 'expense') {
      const amount = Number(q.get('amount'));
      if (!(amount > 0) || amount > 1e9) return false;
      const d = c();
      d.budget ||= { limit: null, currency: 'CRC', expenses: [] };
      d.budget.expenses ||= [];
      d.budget.expenses.push({ id: require('crypto').randomBytes(6).toString('hex'), date: new Date().toLocaleDateString('sv'), amount, cat: String(q.get('cat') || 'Otros').slice(0, 40), note: String(q.get('note') || '').slice(0, 200) });
      casa.save(ctxRW, d);
      mobileCasaChanged();
      return true;
    }
    if (a === 'pc') {
      const fn = pcActions[String(q.get('do') || '')];
      if (!fn) return false;
      await fn();
      return true;
    }
    if (a === 'gather') {
      const list = store.read('genshin-gather.json', []);
      const g = list.find((x) => x.id === q.get('id'));
      if (!g) return false;
      g.at = Date.now();
      g.notified = false;
      store.write('genshin-gather.json', list);
      return true;
    }
    return false;
  },
  // Pregúntale desde el celular: misma idea que en el PC, pero espera la respuesta entera
  ask(text, session) {
    return new Promise((resolve) => {
      const cwd = assistDir();
      let out = '';
      let sid = session || null;
      const timer = setTimeout(() => {
        claudeChat.stop('assist-m');
        resolve({ text: out || 'Tardó demasiado: prueba otra vez.', session: sid });
      }, 150000);
      assistContext(cwd).catch(() => {}).then(() => {
        try {
          claudeChat.send({ cwd, chatId: 'assist-m', text: String(text || '').slice(0, 8000), session: /^[0-9a-f-]{36}$/i.test(session || '') ? session : null, model: 'sonnet', access: 'ask', system: ASSIST_SYSTEM }, (ev) => {
            if (ev.type === 'system' && ev.session_id) sid = ev.session_id;
            if (ev.type === 'assistant') for (const p of ev.message?.content || []) if (p.type === 'text') out += (out ? '\n\n' : '') + p.text;
            if (ev.type === 'result' && ev.session_id) sid = ev.session_id;
            if (ev.type === 'vt-end') {
              clearTimeout(timer);
              resolve({ text: out || (ev.stderr ? 'Claude Code no respondió. ¿Tiene la sesión iniciada en el PC?' : 'Sin respuesta.'), session: sid });
            }
          });
        } catch (e) {
          clearTimeout(timer);
          resolve({ text: e.message, session: sid });
        }
      });
    });
  },
};


// ---------- 1.20: clima, acciones del iPhone y widget de escritorio ----------
const weather = require('./src/weather');
ipcMain.handle('weather:get', (_e, force) => weather.get(ctxRW, !!force));
async function weatherTick() {
  if (!settingsOn('weatherAlerts')) return;
  const w = await weather.get(ctxRW).catch(() => null);
  const n = weather.notice(ctxRW, w);
  if (n) notify(n.title, n.body);
}

// Acciones rápidas del PC (desde el iPhone): teclas multimedia, bloquear, suspender y apagar
function pressKey(code, times = 1) {
  const keys = Array.from({ length: Math.max(1, Math.min(20, times)) }, () => '$s.SendKeys([char]' + code + ')').join(';');
  require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$s = New-Object -ComObject WScript.Shell; ' + keys], { windowsHide: true, stdio: 'ignore' }).unref();
}
let shutdownAt = null;
const pcActions = {
  'vol-up': () => pressKey(175, 5),
  'vol-down': () => pressKey(174, 5),
  mute: () => pressKey(173),
  'play-pause': () => pressKey(179),
  next: () => pressKey(176),
  prev: () => pressKey(177),
  lock: () => require('child_process').spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true, stdio: 'ignore' }).unref(),
  sleep: () => setTimeout(() => require('child_process').spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true, stdio: 'ignore' }).unref(), 1500),
  shutdown: () => {
    require('child_process').spawn('shutdown.exe', ['/s', '/t', '60', '/c', 'ViperTeca: apagado pedido desde el celular. Para cancelarlo: shutdown /a'], { windowsHide: true, stdio: 'ignore' }).unref();
    shutdownAt = Date.now() + 60000;
    notify('El PC se apaga en 1 minuto', 'Lo pediste desde el celular. Puedes cancelarlo desde allí.', null, { urgent: true });
  },
  'cancel-shutdown': () => {
    require('child_process').spawn('shutdown.exe', ['/a'], { windowsHide: true, stdio: 'ignore' }).unref();
    shutdownAt = null;
  },
  focus: async () => {
    if (focus.mode === 'off') await focus.start();
    else focus.stop('user');
  },
};

// Widget de escritorio: una ventanita con lo importante del día
let widgetWin = null;
function openWidget(on) {
  if (on === false || (on == null && widgetWin && !widgetWin.isDestroyed())) {
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.close();
    widgetWin = null;
    const s = store.read('settings.json', {});
    s.widgetOn = false;
    store.write('settings.json', s);
    return false;
  }
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.show();
    return true;
  }
  const pos = store.read('widget.json', {});
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;
  widgetWin = new BrowserWindow({
    width: 300,
    height: 380,
    x: Number.isFinite(pos.x) ? pos.x : wa.x + wa.width - 320,
    y: Number.isFinite(pos.y) ? pos.y : wa.y + 20,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: pos.top !== false,
    title: 'ViperTeca · widget',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  widgetWin.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widgetWin.once('ready-to-show', () => widgetWin.showInactive());
  const save = () => {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const [x, y] = widgetWin.getPosition();
    store.write('widget.json', { ...store.read('widget.json', {}), x, y });
  };
  widgetWin.on('moved', save);
  widgetWin.on('closed', () => (widgetWin = null));
  const s = store.read('settings.json', {});
  s.widgetOn = true;
  store.write('settings.json', s);
  return true;
}
ipcMain.handle('widget:toggle', (_e, on) => openWidget(on));
ipcMain.handle('widget:status', () => !!(widgetWin && !widgetWin.isDestroyed()));
ipcMain.handle('widget:size', (_e, height) => {
  if (!widgetWin || widgetWin.isDestroyed()) return false;
  widgetWin.setSize(300, Math.max(160, Math.min(600, Math.round(Number(height) || 380))));
  return true;
});
ipcMain.handle('widget:pin', () => {
  if (!widgetWin || widgetWin.isDestroyed()) return false;
  const top = !widgetWin.isAlwaysOnTop();
  widgetWin.setAlwaysOnTop(top);
  store.write('widget.json', { ...store.read('widget.json', {}), top });
  return top;
});
ipcMain.handle('widget:open-app', () => {
  if (!win || win.isDestroyed()) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  return true;
});


// ---------- 1.21: precios, clips, retos, inventario y la IA de Genshin ----------
const prices = require('./src/prices');
ipcMain.handle('prices:get', () => ({ history: store.read('price-history.json', {}), lows: store.read('price-lows.json', {}) }));

// Clips de vídeo de cada juego (Barra de juegos, NVIDIA, AMD)
ipcMain.handle('clips:get', async (_e, id) => {
  const g = libGame(id);
  if (!g) return [];
  return screens.clipsForGame(g).map((c) => ({ ...c, url: 'bjshot://vid/?f=' + encodeURIComponent(c.file) }));
});
ipcMain.handle('clips:open', (_e, file) => {
  if (screens.isAllowedVideo(String(file || ''))) shell.openPath(String(file));
});
ipcMain.handle('clips:folder', (_e, file) => {
  if (screens.isAllowedVideo(String(file || ''))) shell.showItemInFolder(String(file));
});

// Retos del backlog: cuántos juegos quieres terminar cada mes
ipcMain.handle('goals:get', () => store.read('goals.json', { perMonth: 0, history: {} }));
ipcMain.handle('goals:set', (_e, g) => {
  const cur = store.read('goals.json', { perMonth: 0, history: {} });
  const perMonth = Math.max(0, Math.min(30, Math.round(Number(g?.perMonth) || 0)));
  const ym = new Date().toLocaleDateString('sv').slice(0, 7);
  const out = { perMonth, history: { ...(cur.history || {}), [ym]: perMonth } };
  store.write('goals.json', out);
  return out;
});

// Inventario de Genshin desde la calculadora de HoYoLAB
const genshinCalc = require('./src/genshin-calc');
ipcMain.handle('ginv:sync', async () => {
  const uid = store.getSettings().genshinUid;
  if (!uid) throw new Error('Pon tu UID de Genshin primero.');
  const cookie = hoyolab.cookie?.(store.read);
  if (!cookie) throw new Error('Conecta tu cuenta de HoYoLAB en Genshin → Notas de HoYoLAB.');
  const plan = store.read('gfarm-plan.json', []);
  if (!plan.length) throw new Error('Añade personajes al plan de Farmeo primero.');
  const r = await genshinCalc.inventory(cookie, uid, plan);
  const farm = await genshinFarm.compute(plan, ctxRW).catch(() => null);
  const inv = store.read('genshin-inventory.json', {});
  const matched = genshinCalc.mergeInto(inv, r.items, (farm?.materials || []).map((m) => m.name));
  store.write('genshin-inventory.json', inv);
  return { inv, matched, read: r.total, skipped: r.skipped.length };
});

// Eventos de Genshin que terminan pronto y todavía no marcaste como hechos
ipcMain.handle('gevents:done', () => store.read('genshin-events-done.json', {}));
ipcMain.handle('gevents:toggle', (_e, id) => {
  const d = store.read('genshin-events-done.json', {});
  const k = String(id);
  if (d[k]) delete d[k];
  else d[k] = Date.now();
  store.write('genshin-events-done.json', d);
  return d;
});
function eventsTick() {
  if (!settingsOn('eventAlerts')) return;
  const news = store.read('genshin-news.json', null)?.data;
  if (!news?.events) return;
  const done = store.read('genshin-events-done.json', {});
  const sent = store.read('genshin-events-notified.json', {});
  const now = Date.now();
  const soon = news.events.filter((e) => e.end > now && e.end - now < 48 * 3600000 && !/gachap|deseo|invocaci/i.test(e.kind || '') && !done[e.id] && !sent[e.id]);
  if (!soon.length) return;
  for (const e of soon) sent[e.id] = now;
  store.write('genshin-events-notified.json', sent);
  const name = (e) => (String(e.title).match(/«([^»]+)»/) || [])[1] || e.title;
  notify(soon.length === 1 ? 'Termina pronto: ' + name(soon[0]) : soon.length + ' eventos de Genshin terminan pronto', soon.slice(0, 3).map((e) => name(e) + ' (' + Math.round((e.end - now) / 3600000) + ' h)').join(', ') + '. Márcalos como hechos en Genshin → Noticias.');
}

// IA de Genshin: tu Claude Code busca en la web (anuncios oficiales, filtraciones)
// y responde en JSON. Se guarda unos días para no gastar en cada visita.
function aiJson(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const chatId = 'ai-' + Date.now();
    let text = '';
    let final = '';
    const timer = setTimeout(() => {
      claudeChat.stop(chatId);
      reject(new Error('Claude tardó demasiado (más de 5 minutos). Prueba otra vez.'));
    }, 300000);
    try {
      claudeChat.send({ cwd: assistDir(), chatId, text: prompt, model: opts.model || 'sonnet', access: 'ask', system: opts.system || 'Eres un experto en Genshin Impact y escribes en español neutro. Respondes SOLO con un bloque de código json válido, sin texto antes ni después.' }, (ev) => {
        if (ev.type === 'assistant') for (const p of ev.message?.content || []) if (p.type === 'text') text += p.text;
        if (ev.type === 'result' && typeof ev.result === 'string') final = ev.result;
        if (ev.type === 'vt-end') {
          clearTimeout(timer);
          const src = final || text;
          const m = src.match(/```json\s*([\s\S]*?)```/) || src.match(/(\{[\s\S]*\})/);
          try {
            resolve(JSON.parse(m ? m[1] : src));
          } catch {
            reject(new Error(ev.code && ev.stderr ? 'Claude Code no pudo responder: ' + ev.stderr.slice(0, 200) : 'Claude no devolvió datos válidos. Prueba otra vez.'));
          }
        }
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
function genshinContext() {
  const chars = (store.read('hoyolab-cache.json', null)?.data?.characters || []).map((c) => c.name + ' (' + c.rarity + '★ ' + c.element + ', nv. ' + c.level + ', C' + c.constellation + (c.weapon ? ', ' + c.weapon : '') + ')');
  let pools = [];
  try {
    pools = (genshinWish.summary(store.read('genshin-wishes.json', { items: {} }))?.pools || []).map((p) => p.name + ': ' + p.pity5 + ' tiradas desde el último 5★' + (p.key === 'character' ? (p.guaranteed ? ', próximo garantizado' : ', 50/50') : ''));
  } catch {}
  const news = store.read('genshin-news.json', null)?.data;
  const banners = (news?.events || []).filter((e) => /gachap|deseo|invocaci/i.test(e.kind || '') && e.end > Date.now()).map((e) => e.title + ' (hasta ' + new Date(e.end).toLocaleDateString('es') + ')');
  return {
    today: new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }),
    version: news?.version ? news.version.number + ' «' + news.version.name + '»' : 'desconocida',
    next: news?.next ? news.next.number + ' el ' + new Date(news.next.at).toLocaleDateString('es') : 'desconocida',
    chars,
    pools,
    banners,
  };
}
const AI_TTL = { insights: 3 * 86400000, advice: 86400000, teams: 7 * 86400000 };
const aiBusy = {};
ipcMain.handle('gai:get', async (_e, kind, force, extra) => {
  if (!AI_TTL[kind]) throw new Error('Tipo desconocido');
  const cache = store.read('genshin-ai.json', {});
  if (!force && cache[kind] && Date.now() - cache[kind].at < AI_TTL[kind]) return cache[kind];
  if (aiBusy[kind]) return aiBusy[kind];
  const c = genshinContext();
  const money = extra && typeof extra === 'object' ? 'Recursos para tirar: ' + Math.round(Number(extra.pulls) || 0) + ' tiradas disponibles hasta la próxima versión.' : '';
  const prompts = {
    insights: 'Hoy es ' + c.today + '. La versión actual de Genshin Impact es ' + c.version + ' y la próxima es la ' + c.next + '.\n' +
      'Busca en la web (anuncios oficiales de HoYoverse y HoYoLAB, Game8, la wiki de Genshin, r/Genshin_Impact_Leaks y filtradores conocidos) y prepara:\n' +
      '1) Un resumen de la historia (lore) de la versión actual: uno corto sin spoilers y otro completo con spoilers.\n' +
      '2) Las tres próximas versiones: personajes que vendrán (con rareza, elemento, arma y región), fechas aproximadas, lo que se sabe de la historia y de dónde sale cada dato (oficial, filtración o rumor).\n' +
      'Responde SOLO con este JSON: {"current":{"version":"","name":"","lore":"","spoilerLore":"","highlights":[""]},"upcoming":[{"version":"","when":"","characters":[{"name":"","rarity":5,"element":"","weapon":"","region":"","status":"oficial|filtración|rumor"}],"story":"","notes":""}],"sources":[{"title":"","url":""}]}',
    advice: 'Hoy es ' + c.today + '. Banners actuales y próximos de Genshin Impact: ' + (c.banners.join('; ') || 'búscalos en la web') + '. Próxima versión: ' + c.next + '.\n' +
      'Mis personajes: ' + (c.chars.join(', ') || 'no los sé (dímelo de forma general)') + '.\nMis tiradas: ' + (c.pools.join('; ') || 'sin datos') + '. ' + money + '\n' +
      'Busca en la web qué tan buenos son los personajes de los banners actuales y de las próximas 2 versiones (según las filtraciones) y dime por quién tirar, por quién no y para quién ahorrar, teniendo en cuenta MIS personajes y equipos. Sé concreto.\n' +
      'Responde SOLO con este JSON: {"summary":"","picks":[{"name":"","banner":"actual|próximo|filtrado","verdict":"Tirar|Opcional|Saltar|Ahorrar para","why":"","priority":1}],"saveFor":{"name":"","when":"","why":""}}',
    teams: 'Hoy es ' + c.today + '. Busca en la web la temporada actual del Abismo de Espiral (piso 12: enemigos y bendición lunar) y del Teatro Imaginario (elementos permitidos e invitados).\n' +
      'Mis personajes de Genshin Impact: ' + (c.chars.join(', ') || 'desconocidos') + '.\n' +
      'Arma los mejores equipos posibles SOLO con mis personajes: dos para el Abismo (primera y segunda mitad) y una alineación para el Teatro, y dime qué personajes me convendría subir o conseguir.\n' +
      'Responde SOLO con este JSON: {"abyss":{"season":"","blessing":"","teams":[{"half":"Primera mitad","members":["","","",""],"why":""},{"half":"Segunda mitad","members":["","","",""],"why":""}]},"theater":{"season":"","elements":[""],"lineup":[""],"why":""},"upgrades":[{"character":"","what":""}]}',
  };
  aiBusy[kind] = aiJson(prompts[kind]).then((data) => {
    const all = store.read('genshin-ai.json', {});
    all[kind] = { at: Date.now(), data };
    store.write('genshin-ai.json', all);
    return all[kind];
  }).finally(() => delete aiBusy[kind]);
  return aiBusy[kind];
});
ipcMain.handle('gai:cached', () => store.read('genshin-ai.json', {}));


// ---------- 1.22: alertas críticas de las webs y Squads de Resto Experience ----------
const sitecheck = require('./src/sitecheck');
const SQUAD_LEADERS = { a: 'Vincenzo', b: 'Camila Jouce', c: 'Luis Chrestia', d: 'Emily' };
const SEV_ORDER = { critical: 0, high: 1, medium: 2 };
/** Squad de una web (a, b, c, d u other): por el pipeline de Notion o por el repo website-x-… */
function squadOfSite(url, name) {
  const host = sitecheck.hostOf(url);
  const pipe = (store.read('notion-cache.json', null)?.data?.pipeline?.rows || []).find((r) => r.production && sitecheck.hostOf(r.production) === host);
  const m = String(pipe?.squad || '').match(/squad\s*([a-d])/i) || String(pipe?.repo || '').match(/website-([a-d])-/i);
  if (m) return m[1].toLowerCase();
  const vp = (store.read('vercel.json', null)?.projects || []).find((p) => p.domain && sitecheck.hostOf(p.domain) === host);
  const m2 = String(vp?.repo || vp?.name || name || '').match(/website-([a-d])-/i);
  return m2 ? m2[1].toLowerCase() : 'other';
}
const alertsState = () => store.read('web-alerts.json', { at: null, issues: {}, muted: {}, sites: {} });
let alertsRun = null;
async function runSiteChecks({ only, notifyNew = true } = {}) {
  if (alertsRun) return alertsRun;
  alertsRun = (async () => {
    const sites = healthSites().filter((s) => !only || s.url === only);
    const st = alertsState();
    const vc = store.read('vercel.json', null)?.projects || [];
    const fresh = [];
    let n = 0;
    for (const s of sites) {
      n++;
      if (win && !win.isDestroyed()) win.webContents.send('webalerts:progress', { n, total: sites.length, name: s.name });
      let r = await sitecheck.crawl(s.url).catch((e) => ({ page: { status: 0, error: e.message }, jsErrors: [], failed: [], broken: [] }));
      // si la web parece caída o en blanco, se vuelve a probar antes de avisar
      if (!r.page?.status || r.page.status >= 500 || r.blank) r = await sitecheck.crawl(s.url).catch(() => r);
      const found = sitecheck.issuesOf(s, r);
      // errores en vivo de Vercel (funciones y 5xx) de la producción de esta web
      const vp = vc.find((p) => p.domain && sitecheck.hostOf(p.domain) === sitecheck.hostOf(s.url));
      if (vp) {
        if (vp.production?.state === 'ERROR') found.push({ key: s.url + '|deploy|' + vp.production.id, site: s.url, name: s.name, kind: 'deploy', sev: 'high', title: 'El último deploy de producción falló', detail: (vp.production.commit || '') + (vp.production.branch ? ' · ' + vp.production.branch : ''), target: vp.production.id });
        const errs = await webhealth.runtimeErrors(store.read, vp).catch(() => []);
        const groups = {};
        for (const e of errs) {
          const sig = (e.status ? e.status + ' ' : '') + (e.path || '') + ' ' + e.msg.replace(/\d+/g, '#').slice(0, 80);
          (groups[sig] ||= []).push(e);
        }
        for (const [sig, list] of Object.entries(groups)) {
          const fatal = list.some((e) => e.level === 'fatal');
          if (list.length < 3 && !fatal) continue;
          const e = list[0];
          found.push({ key: s.url + '|runtime|' + sig, site: s.url, name: s.name, kind: 'runtime', sev: fatal || (e.status >= 500 && list.length >= 10) ? 'critical' : 'high', title: (e.status >= 500 ? 'Error ' + e.status : 'Error del servidor') + (e.path ? ' en ' + e.path : '') + ' (' + list.length + ' veces en 3 h)', detail: e.msg, target: sig });
        }
      }
      const squad = squadOfSite(s.url, s.name);
      const now = Date.now();
      const keys = new Set();
      for (const f of found) {
        keys.add(f.key);
        const old = st.issues[f.key];
        const seen = old && old.open ? old.seen + 1 : 1;
        const it = { ...f, squad, leader: SQUAD_LEADERS[squad] || null, firstAt: old && old.open ? old.firstAt : now, lastAt: now, seen, open: true, notified: old && old.open ? old.notified : false };
        // los errores de JavaScript se confirman en dos revisiones seguidas (pueden ser puntuales)
        const confirmed = f.kind === 'js' ? seen >= 2 : true;
        if (confirmed && !it.notified && !st.muted[f.key]) {
          it.notified = true;
          fresh.push(it);
        }
        st.issues[f.key] = it;
      }
      for (const [k, it] of Object.entries(st.issues)) if (it.site === s.url && it.open && !keys.has(k)) Object.assign(it, { open: false, resolvedAt: now });
      st.sites[s.url] = { at: now, name: s.name, squad, status: r.page?.status || 0, links: r.links || 0, ms: r.ms || null, title: r.title || '' };
    }
    // limpieza: los resueltos hace más de 14 días se olvidan
    for (const [k, it] of Object.entries(st.issues)) if (!it.open && it.resolvedAt < Date.now() - 14 * 86400000) delete st.issues[k];
    st.at = Date.now();
    store.write('web-alerts.json', st);
    if (notifyNew && fresh.length && settingsOn('webAlerts')) {
      const bySite = {};
      for (const it of fresh) (bySite[it.site] ||= []).push(it);
      const entries = Object.values(bySite).sort((a, b) => Math.min(...a.map((x) => SEV_ORDER[x.sev])) - Math.min(...b.map((x) => SEV_ORDER[x.sev])));
      for (const list of entries.slice(0, 4)) {
        const it = list.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev])[0];
        const who = it.squad !== 'other' ? 'Squad ' + it.squad.toUpperCase() + (it.leader ? ' (' + it.leader + ')' : '') + ' · ' : '';
        notify((it.sev === 'critical' ? '🔴 ' : '🟠 ') + it.name + ': ' + it.title, who + (list.length > 1 ? list.length + ' problemas. ' : '') + (it.detail || '').split('\n')[0].slice(0, 140), null, { urgent: it.sev === 'critical' });
      }
      if (entries.length > 4) notify('Más webs con problemas', (entries.length - 4) + ' webs más tienen errores nuevos. Míralas en Websites → Alertas.');
    }
    if (win && !win.isDestroyed()) win.webContents.send('webalerts:done');
    return st;
  })().finally(() => (alertsRun = null));
  return alertsRun;
}
ipcMain.handle('webalerts:get', () => ({ ...alertsState(), running: !!alertsRun, leaders: SQUAD_LEADERS }));
ipcMain.handle('webalerts:run', (_e, only) => runSiteChecks({ only: only ? String(only) : null }).then(() => ({ ...alertsState(), leaders: SQUAD_LEADERS })));
ipcMain.handle('webalerts:mute', (_e, key, on) => {
  const st = alertsState();
  if (on) st.muted[String(key)] = Date.now();
  else delete st.muted[String(key)];
  store.write('web-alerts.json', st);
  return st;
});
async function siteChecksTick() {
  if (!settingsOn('webAlerts') || focus.mode === 'on') return; // mientras juegas no se revisa nada
  const st = alertsState();
  if (st.at && Date.now() - st.at < 5.5 * 3600000) return;
  await runSiteChecks().catch(() => null);
}

// Squads: responsables, ritmo (Notion), webs y alertas de cada uno
ipcMain.handle('squads:get', async (_e, force) => {
  let team = null;
  let teamError = null;
  if (notion.linked(store.read)) {
    try {
      team = await notion.team(rx, !!force, SQUAD_LEADERS);
      if (team.errors?.length && !team.people.length) teamError = team.errors.join(' · ');
    } catch (e) {
      teamError = e.message;
      team = store.read('notion-team.json', null);
    }
  }
  const pipe = store.read('notion-cache.json', null)?.data?.pipeline?.rows || [];
  const vc = store.read('vercel.json', null)?.projects || [];
  const st = alertsState();
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const squads = Object.entries(SQUAD_LEADERS).map(([k, leader]) => {
    const person = (team?.people || []).find((p) => p.squad === k) || null;
    const webs = pipe.filter((r) => (String(r.squad || '').match(/squad\s*([a-d])/i)?.[1] || String(r.repo || '').match(/website-([a-d])-/i)?.[1] || '').toLowerCase() === k);
    const projects = vc.filter((p) => String(p.repo || p.name || '').match(/website-([a-d])-/i)?.[1]?.toLowerCase() === k);
    const weekAgo = Date.now() - 7 * 86400000;
    const issues = Object.values(st.issues).filter((i) => i.open && i.squad === k && !st.muted[i.key]);
    return {
      key: k,
      leader,
      person: person || null,
      webs: { total: webs.length, live: webs.filter((r) => r.group === 'done' || /live/i.test(r.status)).length, doing: webs.filter((r) => r.group === 'doing').length, stopped: webs.filter((r) => r.group === 'stopped').length, todo: webs.filter((r) => r.group === 'todo').length, list: webs.map((r) => ({ name: String(r.name || '').replace(/<[^>]+>|\*\*/g, '').trim(), status: r.status, group: r.group, production: r.production, url: r.url, end: r.end })) },
      deploys: { week: projects.filter((p) => p.production?.at > weekAgo).length, failed: projects.filter((p) => p.latest?.state === 'ERROR').length, stale: projects.filter((p) => p.production?.at && p.production.at < Date.now() - 30 * 86400000).length, projects: projects.length },
      issues: { critical: issues.filter((i) => i.sev === 'critical').length, high: issues.filter((i) => i.sev === 'high').length, medium: issues.filter((i) => i.sev === 'medium').length, top: issues.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]).slice(0, 4) },
    };
  });
  return { squads, team: team ? { at: team.at, openTotal: team.openTotal, closedTotal: team.closedTotal, people: team.people, errors: team.errors || [] } : null, teamError, notion: notion.linked(store.read), vercel: !!webhealth.getSecret(store.read, 'vercelEnc') };
});


// ---------- 1.25: regalos desde el celular de Emi ----------
// Emi pega el enlace de un producto en su página (/regalos, con su propio código);
// el regalo aparece al instante en Casa → Regalos y la foto, el nombre y el
// precio se completan solos en segundo plano.
const linkmeta = require('./src/linkmeta');
function giftToken() {
  const s = store.read('settings.json', {});
  if (!s.giftToken) {
    s.giftToken = require('crypto').randomBytes(16).toString('hex');
    store.write('settings.json', s);
  }
  return s.giftToken;
}
const casaChanged = () => win && !win.isDestroyed() && win.webContents.send('casa:changed');
/** Completa un regalo con lo que se lee del enlace (sin pisar lo que se escribió a mano). */
async function fillGift(id, link, { fromEmi } = {}) {
  let meta = null;
  try {
    meta = await linkmeta.read(link);
  } catch {}
  const c = casa.load(ctxRW);
  const g = (c.gifts || []).find((x) => x.id === id);
  if (!g) return null;
  if (meta) {
    // el nombre provisional ("Regalo de tienda.com") se cambia; uno escrito a mano se respeta
    if (meta.name && (!g.name || /^Regalo de \S+$/.test(g.name))) g.name = meta.name;
    g.image = g.image || meta.image || '';
    if (g.price == null && meta.price != null) g.price = meta.price;
    g.currency = g.currency || meta.currency || null;
    g.store = g.store || meta.store || '';
  }
  g.reading = false;
  casa.save(ctxRW, c);
  casaChanged();
  if (fromEmi) notify('Emi añadió un regalo', [g.name, g.price != null ? (g.currency === 'USD' ? '$' : g.currency === 'CRC' ? '₡' : '') + Number(g.price).toLocaleString('es') : null, g.store].filter(Boolean).join(' · '), null);
  return g;
}
const giftsApi = {
  token: giftToken,
  list() {
    const c = casa.load(ctxRW);
    const items = (c.gifts || [])
      .filter((g) => g.by === 'Emi' && !g.hide)
      .sort((a, b) => b.at - a.at)
      .slice(0, 80)
      // sin estado (comprado / regalado): que no se arruine la sorpresa
      .map((g) => ({ id: g.id, name: g.name, for: g.for, note: g.note, price: g.price, currency: g.currency, store: g.store, link: g.link, reading: g.reading, image: /^data:/.test(g.image || '') ? 'local' : g.image || '' }));
    return { people: c.giftPeople || ['Emi'], items };
  },
  image(id) {
    const g = (casa.load(ctxRW).gifts || []).find((x) => x.id === id && x.by === 'Emi');
    const m = String(g?.image || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    return m ? { type: m[1], buf: Buffer.from(m[2], 'base64') } : null;
  },
  async add(b) {
    const rawLink = String(b.link || '').trim().match(/https?:\/\/\S+/)?.[0] || '';
    const name = String(b.name || '').trim().slice(0, 160);
    if (!rawLink && !name) throw new Error('Pega un enlace o escribe qué es.');
    let link = '';
    if (rawLink) link = (await linkmeta.safeUrl(rawLink)).href;
    const c = casa.load(ctxRW);
    if (link && (c.gifts || []).some((g) => g.link === link && g.by === 'Emi' && !g.hide)) throw new Error('Eso ya está en tu lista.');
    const people = c.giftPeople || ['Emi'];
    const id = require('crypto').randomBytes(6).toString('hex');
    const host = link ? new URL(link).hostname.replace(/^www\./, '') : '';
    c.gifts = c.gifts || [];
    c.gifts.push({ id, name: name || 'Regalo de ' + host, for: people.includes(b.for) ? b.for : 'Emi', note: String(b.note || '').trim().slice(0, 300), link, price: null, image: '', status: 'idea', occasion: '', at: Date.now(), by: 'Emi', store: host, reading: !!link });
    casa.save(ctxRW, c);
    casaChanged();
    if (link) fillGift(id, link, { fromEmi: true }).catch(() => null);
    else notify('Emi añadió un regalo', name, null);
    return { ok: true, id };
  },
  remove(id) {
    const c = casa.load(ctxRW);
    const g = (c.gifts || []).find((x) => x.id === id && x.by === 'Emi');
    if (!g) return false;
    // si ya lo compraste, solo desaparece de su lista (la sorpresa sigue)
    if (g.status === 'idea') c.gifts = c.gifts.filter((x) => x !== g);
    else g.hide = true;
    casa.save(ctxRW, c);
    casaChanged();
    return true;
  },
};
// desde el PC: leer un enlace al crear un regalo a mano
ipcMain.handle('casa:linkMeta', (_e, url) => linkmeta.read(String(url || '')));
ipcMain.handle('gifts:link', async (_e, renew) => {
  if (renew) {
    const s = store.read('settings.json', {});
    s.giftToken = require('crypto').randomBytes(16).toString('hex');
    store.write('settings.json', s);
  }
  const l = lanServer();
  const info = l.running ? l.info() : await l.start();
  return info.gift || null;
});

// ---------- 1.28: juegos (Game Pass, logros fáciles, gasto, lanzamientos, pausas, jugar con amigos) ----------
const gamesextra = require('./src/gamesextra');
const wishItems = () => store.read('wishlist.json', null)?.items || [];
let gpBusy = null;
function gamePassGet(force) {
  const c = store.read('gamepass.json', null);
  if (!force && c && Date.now() - c.at < 12 * 3600000) return Promise.resolve(c);
  if (!gpBusy) gpBusy = gamesextra.gamePass(ctxRW, wishItems()).finally(() => (gpBusy = null));
  return gpBusy;
}
ipcMain.handle('games:gamepass', (_e, force) => gamePassGet(!!force));
async function gamePassTick() {
  const r = await gamePassGet(true).catch(() => null);
  if (!r) return;
  for (const g of r.wishOnPass) {
    if (r.added.some((x) => x.id === g.id) && once('gp-add:' + g.id)) notify(g.title + ' llegó a Game Pass', 'Está en tu lista de deseados: ya lo puedes jugar con PC Game Pass.', null);
    if (g.leaving && once('gp-leave:' + g.id + ':' + new Date().toLocaleDateString('sv').slice(0, 7))) notify(g.title + ' se va de Game Pass', 'Está en tu lista de deseados. Si lo quieres jugar con Game Pass, es ahora.', null);
  }
}

// logros más fáciles (los que te faltan, de más común a más raro)
ipcMain.handle('games:easy', async (_e, force) => {
  const c = store.read('ach-easy.json', null);
  if (!force && c && Date.now() - c.at < 12 * 3600000) return c;
  const auth = await steamAuth();
  const lib = store.read('library.json', null)?.games || [];
  const titleOf = (appid) => lib.find((g) => g.id === 'steam:' + appid)?.title || String(appid);
  const list = await gamesextra.easiest(store.read('achievements.json', null), (appid) => achievements.detail({ ...auth, appid, read: store.read, write: store.write }), titleOf);
  const out = { at: Date.now(), list };
  store.write('ach-easy.json', out);
  return out;
});

// gasto: historial de Steam y Epic leído en una ventana de la app con tu sesión
const spendWins = {};
ipcMain.handle('games:spendOpen', (_e, which) => {
  const k = which === 'epic' ? 'epic' : 'steam';
  if (spendWins[k] && !spendWins[k].isDestroyed()) {
    spendWins[k].show();
    spendWins[k].focus();
    return true;
  }
  const w = new BrowserWindow({ width: 1200, height: 860, title: k === 'epic' ? 'Epic Games · historial de compras' : 'Steam · historial de compras', autoHideMenuBar: true, webPreferences: { partition: 'persist:vt-' + k + 'store', sandbox: true, contextIsolation: true } });
  w.webContents.setWindowOpenHandler(({ url }) => (/^https:\/\/([a-z]+\.)?(steampowered|steamcommunity|epicgames)\.com\//.test(url) ? { action: 'allow' } : { action: 'deny' }));
  w.loadURL(k === 'epic' ? gamesextra.EPIC_HISTORY : gamesextra.STEAM_HISTORY);
  w.on('closed', () => delete spendWins[k]);
  spendWins[k] = w;
  return true;
});
ipcMain.handle('games:spendRead', async (_e, which) => {
  const k = which === 'epic' ? 'epic' : 'steam';
  const w = spendWins[k];
  if (!w || w.isDestroyed()) throw new Error('Abre primero el historial de ' + (k === 'epic' ? 'Epic' : 'Steam') + ' e inicia sesión.');
  const r = await w.webContents.executeJavaScript(k === 'epic' ? gamesextra.READ_EPIC : gamesextra.READ_STEAM);
  if (!r.rows.length) throw new Error(r.login ? 'Inicia sesión en la ventana y vuelve a pulsar «Leer».' : 'No encontré compras en esa página. ¿Está abierto el historial?');
  const list = gamesextra.purchases(k, r.rows);
  const all = store.read('spend.json', {});
  all[k] = { at: Date.now(), list };
  store.write('spend.json', all);
  return { count: list.length };
});
ipcMain.handle('games:spend', async () => {
  const all = store.read('spend.json', {});
  const list = [...(all.steam?.list || []), ...(all.epic?.list || [])];
  const rate = (await fx.get(ctxRW).catch(() => null))?.sell || null;
  const lib = store.read('library.json', null)?.games || [];
  return { sources: { steam: all.steam?.at || null, epic: all.epic?.at || null }, rate, ...gamesextra.spendSummary(list, lib, rate) };
});

// lanzamientos de tus deseados: si tu PC los mueve y avisos para la precarga
ipcMain.handle('games:upcoming', async () => {
  steam.setRegion(store.getSettings().country);
  const ids = wishItems().map((i) => i.appid);
  const list = ids.length ? await news.releases(ids).catch(() => []) : [];
  const soon = list.filter((x) => x.date).slice(0, 20);
  const run = soon.length ? await storeinfo.canRun(soon.map((x) => x.appid), ctxRW).catch(() => ({})) : {};
  return list.slice(0, 30).map((x) => ({ ...x, run: run[x.appid] || null }));
});
async function releaseTick() {
  const ids = wishItems().map((i) => i.appid);
  if (!ids.length) return;
  steam.setRegion(store.getSettings().country);
  const list = (await news.releases(ids).catch(() => [])).filter((x) => x.date && x.exact);
  const today0 = new Date().setHours(0, 0, 0, 0);
  for (const x of list) {
    const days = Math.round((new Date(x.date * 1000).setHours(0, 0, 0, 0) - today0) / DAYMS);
    if (![3, 1, 0].includes(days) || !once('rel:' + x.appid + ':' + days)) continue;
    const run = (await storeinfo.canRun([x.appid], ctxRW).catch(() => ({})))[x.appid];
    const v = run?.verdict === 'rec' ? 'Tu PC cumple lo recomendado.' : run?.verdict === 'min' ? 'Tu PC cumple lo mínimo (calidad baja o media).' : run?.verdict === 'no' ? 'Ojo: tu PC no llega a los requisitos mínimos.' : '';
    notify(days === 0 ? x.name + ' sale hoy' : x.name + (days === 1 ? ' sale mañana' : ' sale en 3 días'), [days > 0 ? 'Si lo compraste, déjalo precargando.' : '', v].filter(Boolean).join(' '), 'https://store.steampowered.com/app/' + x.appid);
  }
}

// pausas: aviso suave en pantalla (sin sonido ni aviso de Windows) cada 2 h de juego seguidas
let nudgeWin = null;
function nudge(text) {
  const { screen } = require('electron');
  const a = screen.getPrimaryDisplay().workArea;
  if (nudgeWin && !nudgeWin.isDestroyed()) nudgeWin.destroy();
  nudgeWin = new BrowserWindow({ width: 420, height: 74, x: Math.round(a.x + a.width / 2 - 210), y: a.y + 18, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false, webPreferences: { sandbox: true, javascript: false } });
  nudgeWin.setAlwaysOnTop(true, 'screen-saver');
  nudgeWin.setIgnoreMouseEvents(true);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  nudgeWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;font:600 15px Segoe UI,sans-serif;color:#fff"><div style="margin:6px;padding:14px 18px;border-radius:16px;background:rgba(20,14,18,.88);box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12)">' + esc(text) + '</div></body>'));
  nudgeWin.once('ready-to-show', () => nudgeWin && !nudgeWin.isDestroyed() && nudgeWin.showInactive());
  setTimeout(() => nudgeWin && !nudgeWin.isDestroyed() && nudgeWin.destroy(), 9000);
}
let breakState = { id: null, n: 0 };
function breakTick() {
  const s = store.read('settings.json', {});
  // si elegiste otro intervalo en Ajustes, ese recordatorio ya avisa
  if (s.breakReminders === false || s.remindEveryMin) return;
  const cur = tracker.current;
  if (!cur) return (breakState = { id: null, n: 0 });
  if (breakState.id !== cur.id + ':' + cur.start) breakState = { id: cur.id + ':' + cur.start, n: 0 };
  const mins = (Date.now() - cur.start) / 60000;
  const every = Number(s.breakEveryMin) || 120;
  const due = Math.floor(mins / every);
  if (due > breakState.n) {
    breakState.n = due;
    const h = Math.round(mins / 6) / 10;
    nudge('Llevas ' + (h >= 1 ? h.toString().replace('.', ',') + ' h' : Math.round(mins) + ' min') + ' jugando ' + cur.title + '. Estírate, toma agua y descansa la vista 5 minutos.');
  }
}

// jugar con amigos ahora: los conectados que tienen un juego multijugador en común contigo
ipcMain.handle('friends:playNow', async () => {
  const auth = await steamAuth();
  const list = await friends.friendsList({ ...auth, read: store.read, write: store.write });
  const online = list.filter((f) => f.online);
  if (!online.length) return { online: 0, list: [] };
  const MULTI = /multijugador|cooperativ|jcj|pvp|en l[ií]nea|online|mmo|multiplayer|co-op/i;
  const myGames = (store.read('library.json', null)?.games || []).filter((g) => g.store === 'steam' && g.kind !== 'tool').map((g) => ({ id: g.id, appid: Number(g.id.split(':')[1]), title: g.title, multiplayer: MULTI.test((g.tags || []).join(' ')) }));
  const common = await friends.commonGames({ apiKey: auth.apiKey, friends: online, myGames, read: store.read, write: store.write }).catch(() => []);
  const rows = (Array.isArray(common) ? common : common.rows || []).filter((r) => r.multiplayer).slice(0, 12).map((r) => ({ ...r, title: myGames.find((g) => g.id === r.id)?.title || r.title || r.id }));
  return { online: online.length, friends: online.map((f) => ({ name: f.name, state: f.state, playing: f.playing, avatar: f.avatar })), list: rows };
});

// Genshin: segundo recordatorio del check-in por la noche si sigue sin hacerse
async function checkinEveningTick() {
  if (!settingsOn('checkinAlert') || !hoyolab.linked(store.read)) return;
  const hour = Number(store.read('settings.json', {}).checkinEveningHour) || 20;
  if (new Date().getHours() < hour) return;
  const key = 'checkin-pm:' + new Date().toLocaleDateString('sv');
  const s = store.read('site-notified.json', {});
  if (s[key]) return;
  const r = await hoyolab.signInfo(store.read).catch(() => null);
  if (!r || r.error || r.signed) return;
  once(key);
  notify('Todavía te falta el check-in de HoYoLAB', 'Se reinicia a medianoche (hora del servidor). Haz clic para reclamarlo.', hoyolab.SIGN_PAGE);
}

// ---------- 1.27: las webs de los clientes (uptime, dominios, contenido, capturas, CWV, horarios, seguridad) ----------
const sitewatch = require('./src/sitewatch');
const ORG = () => store.read('settings.json', {}).githubOrg || 'Resto-Experience';
const googleKey = () => webhealth.getSecret(store.read, 'psiKeyEnc');
const once = (key) => {
  const s = store.read('site-notified.json', {});
  if (s[key]) return false;
  s[key] = Date.now();
  for (const k of Object.keys(s)) if (Date.now() - s[k] > 120 * DAYMS) delete s[k];
  store.write('site-notified.json', s);
  return true;
};
const shotsDir = () => path.join(app.getPath('userData'), 'capturas');
// las webs de clientes: sin los proyectos internos que solo vienen de Vercel
const clientSites = () => healthSites().filter((s) => !s.fromVercel);
const siteState = () => store.read('site-watch.json', { stale: {}, shots: {}, domains: {}, hours: {}, security: null, at: {} });
const saveSiteState = (s) => {
  store.write('site-watch.json', s);
  if (win && !win.isDestroyed()) win.webContents.send('sites:changed');
};
/** El repo de una web: por el pipeline de Notion, por Vercel o por el nombre. */
function repoOfSite(site) {
  const pipe = (store.read('notion-cache.json', null)?.data?.pipeline?.rows || []).find((r) => r.production && sitewatch.hostOf(r.production) === sitewatch.hostOf(site.url));
  const m = String(pipe?.repo || '').replace(/\.git$/, '').match(/github\.com\/[^/]+\/([^/?#]+)/);
  if (m) return m[1];
  const vp = (store.read('vercel.json', null)?.projects || []).find((p) => p.domain && sitewatch.hostOf(p.domain) === sitewatch.hostOf(site.url));
  if (vp?.repo) return String(vp.repo).split('/').pop();
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^website-[a-d]-/, '').replace(/[^a-z0-9]/g, '');
  const want = slug(site.name);
  const repos = Object.keys(store.read('month-commits.json', {}).repos || {});
  return repos.find((r) => slug(r) === want) || repos.find((r) => want.length > 4 && (slug(r).includes(want) || want.includes(slug(r)))) || null;
}

// cada día: dominios, SSL a 30/7 días, contenido vencido y capturas
let siteDailyBusy = null;
async function siteDaily(force) {
  if (siteDailyBusy) return siteDailyBusy;
  siteDailyBusy = (async () => {
    const st = siteState();
    const day = new Date().toLocaleDateString('sv');
    if (!force && st.at.daily === day) return st;
    const sites = clientSites().slice(0, Number(process.env.BJ_SITES_LIMIT) || 999);
    const health = store.read('webhealth.json', { sites: {} }).sites;
    for (const s of sites) {
      const d = await sitewatch.domainExpiry(ctxRW, s.url).catch(() => null);
      if (d) st.domains[s.url] = { domain: d.domain, until: d.until || null, registrar: d.registrar || null };
      const days = d?.until ? Math.floor((d.until - Date.now()) / DAYMS) : null;
      for (const lim of [30, 7]) if (days != null && days <= lim && once('dom:' + d.domain + ':' + lim + ':' + new Date(d.until).getFullYear())) notify('El dominio ' + d.domain + ' vence en ' + days + ' días', (d.registrar ? 'Renuévalo en ' + d.registrar + '. ' : '') + s.name, null);
      const ssl = health[s.url]?.sslDays;
      for (const lim of [30, 7]) if (ssl != null && ssl <= lim && once('ssl:' + sitewatch.hostOf(s.url) + ':' + lim + ':' + day.slice(0, 7))) notify('El SSL de ' + s.name + ' vence en ' + ssl + ' días', 'Revisa la renovación automática del certificado de ' + sitewatch.hostOf(s.url) + '.', null);
    }
    saveSiteState(st);
    for (const s of sites) {
      const found = await sitewatch.staleContent(s.url).catch(() => null);
      if (!found) continue;
      st.stale[s.url] = { at: Date.now(), items: found };
      // sin aviso de Windows: el contenido vencido se ve en Websites → Clientes
      saveSiteState(st);
    }
    for (const s of sites) {
      const r = await sitewatch.dailyShots(shotsDir(), s).catch(() => null);
      if (!r) continue;
      st.shots[s.url] = r;
      const big = Object.entries(r.views).filter(([, v]) => v.change != null && v.change >= 25);
      if (big.length && once('shot:' + s.url + ':' + day)) notify('La portada de ' + s.name + ' cambió mucho', big.map(([k, v]) => (k === 'd' ? 'Escritorio ' : 'Celular ') + v.change + '%').join(' · ') + ' respecto a ayer. Revisa que no esté rota.', null);
      saveSiteState(st);
    }
    st.at.daily = day;
    saveSiteState(st);
    return st;
  })().finally(() => (siteDailyBusy = null));
  return siteDailyBusy;
}

// cada semana: Core Web Vitals (PageSpeed + CrUX) y horarios frente a Google
let siteWeeklyBusy = null;
async function siteWeekly(force) {
  if (siteWeeklyBusy) return siteWeeklyBusy;
  siteWeeklyBusy = (async () => {
    const st = siteState();
    if (!force && st.at.weekly && Date.now() - st.at.weekly < 6.5 * DAYMS) return st;
    const key = googleKey();
    if (!key) return st;
    const sites = clientSites().slice(0, Number(process.env.BJ_SITES_LIMIT) || 999);
    for (const s of sites) {
      const psi = await webhealth.pagespeed(store.read, s.url).catch((e) => ({ error: e.message }));
      const field = await sitewatch.crux(key, s.url).catch((e) => ({ error: e.message }));
      const list = sitewatch.recordCwv(ctxRW, s.url, { perf: psi?.performance ?? null, seo: psi?.seo ?? null, labLcp: psi?.lcp || null, ...(field?.none || field?.error ? {} : field) });
      const prev = list[list.length - 2];
      const cur = list[list.length - 1];
      if (prev?.perf != null && cur.perf != null && cur.perf <= prev.perf - 15 && once('cwv:' + s.url + ':' + new Date().toLocaleDateString('sv'))) notify(s.name + ' va más lenta', 'Velocidad en celular de ' + prev.perf + ' a ' + cur.perf + ' esta semana. ¿Algún deploy reciente?', null);
    }
    // horarios: Google Places + lo que dice la web, comparados por tu Claude Code (de 6 en 6)
    const batch = [];
    for (const s of sites) {
      const places = await sitewatch.googlePlaces(key, s.name, s.url).catch((e) => ({ error: e.message }));
      if (!Array.isArray(places) || !places.length) {
        st.hours[s.url] = { at: Date.now(), error: places?.error || 'No encontré el restaurante en Google con esta web.' };
        continue;
      }
      const web = await sitewatch.webHoursText(s.url).catch(() => '');
      if (!web.trim()) {
        st.hours[s.url] = { at: Date.now(), places, error: 'La web no muestra horarios que pueda leer.' };
        continue;
      }
      batch.push({ s, places, web });
    }
    for (let i = 0; i < batch.length; i += 6) {
      const part = batch.slice(i, i + 6);
      const prompt = 'Compara los horarios de cada restaurante: lo que dice su web frente a su ficha de Google. Hay restaurantes con varios locales.\n\n' +
        part.map((b, k) => '### ' + (k + 1) + '. ' + b.s.name + ' (' + b.s.url + ')\nGOOGLE:\n' + b.places.map((p) => '- ' + p.name + ' (' + p.address + '): ' + (p.hours.join('; ') || 'sin horario') + (p.status && p.status !== 'OPERATIONAL' ? ' [' + p.status + ']' : '')).join('\n') + '\nWEB:\n' + b.web.slice(0, 2500)).join('\n\n') +
        '\n\nPara cada uno responde si coinciden y, si no, qué día y local difiere (en español, breve). Si la web no tiene horarios claros, dilo. Responde SOLO con JSON: {"results":[{"n":1,"match":true,"differences":["Sábado: web 11am–10pm, Google 11am–11pm"],"note":""}]}';
      const r = await aiJson(prompt, { system: 'Comparas horarios de restaurantes con cuidado (formatos 11am, 11:00, 11 AM son lo mismo; "Closed" es cerrado). Respondes SOLO con un bloque de código json válido.' }).catch(() => null);
      for (const x of r?.results || []) {
        const b = part[Number(x.n) - 1];
        if (!b) continue;
        st.hours[b.s.url] = { at: Date.now(), places: b.places, match: !!x.match, differences: (x.differences || []).slice(0, 6), note: x.note || '' };
        if (!x.match && (x.differences || []).length && once('hours:' + b.s.url + ':' + JSON.stringify(x.differences).slice(0, 80))) notify('Horarios distintos en ' + b.s.name, 'La web y Google no coinciden: ' + x.differences.slice(0, 2).join(' · '), null);
      }
    }
    st.at.weekly = Date.now();
    saveSiteState(st);
    return st;
  })().finally(() => (siteWeeklyBusy = null));
  return siteWeeklyBusy;
}

// cada día: seguridad de los repos y commits del mes (horas por cliente)
let repoBusy = null;
async function repoDaily(force) {
  if (repoBusy) return repoBusy;
  repoBusy = (async () => {
    const st = siteState();
    const day = new Date().toLocaleDateString('sv');
    if (!force && st.at.repos === day) return st;
    const sec = await sitewatch.repoSecurity(teamweek.gh, ORG(), { pool: teamweek.pool }).catch((e) => ({ error: e.message }));
    st.security = Array.isArray(sec) ? { at: Date.now(), repos: sec } : { at: Date.now(), error: sec.error, repos: st.security?.repos || [] };
    for (const r of st.security.repos) {
      for (const x of r.secrets) if (once('secret:' + r.repo + ':' + x.sha + ':' + x.what)) notify('Posible clave subida a ' + r.repo, x.what + ' en ' + x.file + ' (commit ' + x.sha + '). Cámbiala y quítala del repo.', null);
      // las actualizaciones de Next.js se ven en Websites → Clientes, sin aviso de Windows
    }
    const month = day.slice(0, 7);
    const repos = await sitewatch.monthCommits(teamweek.gh, ORG(), month, { pool: teamweek.pool }).catch(() => null);
    if (repos) store.write('month-commits.json', { at: Date.now(), month, repos });
    st.at.repos = day;
    saveSiteState(st);
    return st;
  })().finally(() => (repoBusy = null));
  return repoBusy;
}

/** Todo lo de cada web junto, para la pestaña Clientes. */
ipcMain.handle('sites:get', () => {
  const st = siteState();
  const health = store.read('webhealth.json', { sites: {} }).sites;
  const cwv = store.read('cwv.json', {});
  const mc = store.read('month-commits.json', {});
  const sec = st.security?.repos || [];
  return {
    at: st.at,
    google: !!googleKey(),
    busy: { daily: !!siteDailyBusy, weekly: !!siteWeeklyBusy, repos: !!repoBusy },
    securityError: st.security?.error || null,
    sites: clientSites().map((s) => {
      const repo = repoOfSite(s);
      const commits = (mc.repos || {})[repo] || [];
      return {
        ...s,
        repo,
        health: health[s.url] || null,
        uptime: sitewatch.uptimeOf(store.read, s.url),
        domain: st.domains[s.url] || null,
        stale: st.stale[s.url] || null,
        shots: st.shots[s.url] ? Object.fromEntries(Object.entries(st.shots[s.url].views).map(([k, v]) => [k, { change: v.change }])) : null,
        cwv: (cwv[s.url] || []).slice(-12),
        hours: st.hours[s.url] || null,
        security: sec.find((r) => r.repo === repo) || null,
        month: { commits: commits.length, hours: commits.length ? sitewatch.hoursOf(commits) : null },
      };
    }),
    otherSecurity: sec.filter((r) => !clientSites().some((s) => repoOfSite(s) === r.repo)),
  };
});
ipcMain.handle('sites:run', (_e, what) => (what === 'weekly' ? siteWeekly(true) : what === 'repos' ? repoDaily(true) : siteDaily(true)).then(() => true));
ipcMain.handle('sites:shots', (_e, url) => {
  const r = siteState().shots[String(url)];
  if (!r) return null;
  const data = (f) => {
    try {
      return f && require('fs').existsSync(f) ? 'data:image/jpeg;base64,' + require('fs').readFileSync(f).toString('base64') : null;
    } catch {
      return null;
    }
  };
  return Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { now: data(v.file), prev: data(v.prev), change: v.change }]));
});

/** Changelog del mes de una web, escrito para el cliente (caché por mes). */
async function siteChangelog(url, month, lang = 'en') {
  const site = healthSites().find((s) => s.url === url) || { url, name: sitewatch.hostOf(url) };
  const repo = repoOfSite(site);
  const cache = store.read('changelogs.json', {});
  const ck = url + '|' + month + '|' + lang;
  if (cache[ck] && Date.now() - cache[ck].at < 12 * 3600000) return cache[ck];
  let commits = month === store.read('month-commits.json', {}).month ? (store.read('month-commits.json', {}).repos || {})[repo] || [] : null;
  if (!commits && repo) commits = ((await sitewatch.monthCommits(teamweek.gh, ORG(), month, { pool: teamweek.pool }).catch(() => ({}))) || {})[repo] || [];
  if (!commits?.length) return { at: Date.now(), repo, items: [], empty: true };
  const prompt = (lang === 'es' ? 'Escribe en español' : 'Write in English') + ' a short changelog for the restaurant owner of ' + site.name + ' (' + url + ') for ' + month + ', based on these commits from the website repo. Group into 3–8 plain-language bullet points about what changed on their website (no technical jargon, no file names, no commit hashes, nothing internal like refactors or lint). If something is only internal, skip it.\n\nCommits:\n' + commits.slice(0, 150).map((c) => '- ' + new Date(c.at).toISOString().slice(0, 10) + ' ' + c.msg).join('\n') + '\n\nRespond ONLY with JSON: {"items":["…"],"summary":"one sentence"}';
  const r = await aiJson(prompt, { system: 'You write clear, friendly client-facing website changelogs for restaurant owners. You respond ONLY with a valid json code block.' });
  const out = { at: Date.now(), repo, items: (r.items || []).slice(0, 10), summary: r.summary || '', commits: commits.length };
  cache[ck] = out;
  store.write('changelogs.json', cache);
  return out;
}
ipcMain.handle('sites:changelog', (_e, url, month, lang) => siteChangelog(String(url), String(month || new Date().toLocaleDateString('sv').slice(0, 7)), lang === 'es' ? 'es' : 'en'));

/** Informe mensual para el cliente en PDF (Documentos\ViperTeca\Informes\AAAA-MM). */
async function siteReport(url, month, lang = 'en') {
  const site = healthSites().find((s) => s.url === url);
  if (!site) throw new Error('Esa web no está en Salud de las webs.');
  const es = lang === 'es';
  const up = sitewatch.uptimeOf(store.read, url, month);
  const st = siteState();
  const cw = (store.read('cwv.json', {})[url] || []).slice(-1)[0] || null;
  const vercelP = (store.read('vercel.json', null)?.projects || []).find((p) => p.domain && sitewatch.hostOf(p.domain) === sitewatch.hostOf(url));
  const deps = vercelP ? await webhealth.vercelApi(store.read, '/v6/deployments', { projectId: vercelP.id, target: 'production', limit: '100', since: String(new Date(month + '-01T00:00:00').getTime()) }).then((j) => (j.deployments || []).filter((d) => new Date(d.created).toISOString().startsWith(month)).length).catch(() => null) : null;
  const log = await siteChangelog(url, month, lang).catch(() => ({ items: [] }));
  const launch = store.read('launch-checks.json', {})[url] || Object.values(store.read('launch-checks.json', {})).find((x) => sitewatch.hostOf(x.url) === sitewatch.hostOf(url)) || null;
  const dom = st.domains[url];
  const ssl = store.read('webhealth.json', { sites: {} }).sites[url]?.sslDays;
  const monthName = new Date(month + '-15').toLocaleDateString(es ? 'es' : 'en-US', { month: 'long', year: 'numeric' });
  const T = es
    ? { title: 'Informe mensual del sitio web', up: 'Disponibilidad', avg: 'Tiempo de respuesta medio', inc: 'Incidencias', none: 'Sin caídas este mes', deploys: 'Publicaciones', changes: 'Cambios en tu web', speed: 'Velocidad y experiencia (celular)', seo: 'SEO', domain: 'Dominio', sslT: 'Certificado SSL', renew: 'vence el', days: 'días', good: 'Bien', fix: 'Por mejorar', checks: 'Revisión técnica', by: 'Preparado por Resto Experience' }
    : { title: 'Monthly website report', up: 'Uptime', avg: 'Average response time', inc: 'Incidents', none: 'No downtime this month', deploys: 'Updates published', changes: 'What changed on your website', speed: 'Speed & experience (mobile)', seo: 'SEO', domain: 'Domain', sslT: 'SSL certificate', renew: 'renews on', days: 'days', good: 'Good', fix: 'To improve', checks: 'Technical check', by: 'Prepared by Resto Experience' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ms = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms');
  const rate = (v, good, poor) => (v == null ? '' : v <= good ? 'ok' : v <= poor ? 'mid' : 'bad');
  const fixes = (launch?.items || []).filter((i) => !i.ok);
  const kpi = (v, label, cls = '') => (v == null || v === '—' ? '' : '<div class="k"><b class="' + cls + '">' + v + '</b><span>' + label + '</span></div>');
  const grid = (cells) => (cells.join('') ? '<div class="grid">' + cells.join('') + '</div>' : '');
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4;margin:18mm 16mm}body{font:13px/1.5 "Segoe UI",Arial,sans-serif;color:#1d1b20}h1{font-size:26px;margin:0}h2{font-size:15px;margin:22px 0 8px;color:#6b1d2b;border-bottom:1px solid #eee;padding-bottom:4px}' +
    '.sub{color:#777;margin:4px 0 18px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.k{border:1px solid #eee;border-radius:10px;padding:10px 12px}.k b{display:block;font-size:22px}.k span{color:#777;font-size:11.5px}' +
    'ul{margin:6px 0;padding-left:18px}li{margin:3px 0}.ok{color:#16803c}.mid{color:#b26b00}.bad{color:#b3261e}.foot{margin-top:28px;color:#999;font-size:11px}' +
    '</style></head><body>' +
    '<h1>' + esc(site.name) + '</h1><p class="sub">' + esc(T.title) + ' · ' + esc(monthName) + ' · ' + esc(sitewatch.hostOf(url)) + '</p>' +
    grid([kpi(up?.month != null ? up.month + '%' : null, T.up), kpi(up?.avgMs != null ? ms(up.avgMs) : null, T.avg), kpi(deps, T.deploys)]) +
    (up ? '<h2>' + T.inc + '</h2>' + (up.incidents?.length ? '<ul>' + up.incidents.map((i) => '<li>' + esc(i.day) + ': ~' + i.minutes + ' min (' + esc(i.why) + ')</li>').join('') + '</ul>' : '<p class="ok">' + T.none + '</p>') : '') +
    (log.items?.length ? '<h2>' + T.changes + '</h2>' + (log.summary ? '<p>' + esc(log.summary) + '</p>' : '') + '<ul>' + log.items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
    '<h2>' + T.speed + '</h2>' + grid([kpi(cw?.lcp != null ? ms(cw.lcp) : null, 'LCP', rate(cw?.lcp, 2500, 4000)), kpi(cw?.inp != null ? ms(cw.inp) : null, 'INP', rate(cw?.inp, 200, 500)), kpi(cw?.cls, 'CLS', rate(cw?.cls, 0.1, 0.25)), kpi(cw?.perf, 'PageSpeed'), kpi(cw?.seo, T.seo), kpi(ssl != null ? ssl + ' ' + T.days : null, T.sslT)]) +
    (dom?.until ? '<p>' + T.domain + ' ' + esc(dom.domain) + ' ' + T.renew + ' ' + new Date(dom.until).toLocaleDateString(es ? 'es' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) + '.</p>' : '') +
    (launch ? '<h2>' + T.checks + '</h2>' + (fixes.length ? '<p class="mid">' + T.fix + ':</p><ul>' + fixes.slice(0, 8).map((i) => '<li>' + esc(i.label) + '</li>').join('') + '</ul>' : '<p class="ok">' + T.good + '</p>') : '') +
    '<p class="foot">' + T.by + ' · ' + new Date().toLocaleDateString(es ? 'es' : 'en-US') + '</p></body></html>';
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  w.destroy();
  const dir = path.join(app.getPath('documents'), 'ViperTeca', 'Informes', month);
  require('fs').mkdirSync(dir, { recursive: true });
  const file = path.join(dir, site.name.replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '-') + '-' + month + (es ? '-es' : '') + '.pdf');
  require('fs').writeFileSync(file, pdf);
  shell.showItemInFolder(file);
  return { file };
}
ipcMain.handle('sites:report', (_e, url, month, lang) => siteReport(String(url), String(month || new Date().toLocaleDateString('sv').slice(0, 7)), lang === 'es' ? 'es' : 'en'));

// ---------- 1.27: Squads — riesgo, comentarios sin responder, standup, 1:1, carga ----------
/** Tickets que vencen en 3 días sin commits recientes en el repo de esa web. */
async function teamRisk() {
  const team = store.read('notion-team.json', null);
  if (!team?.people?.length) return [];
  const mc = store.read('month-commits.json', {});
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^website-[a-d]-/, '').replace(/[^a-z0-9]/g, '');
  const repos = Object.keys(mc.repos || {});
  const allRepos = repos.length ? repos : [];
  const out = [];
  const today = new Date().toLocaleDateString('sv');
  const limit = new Date(Date.now() + 3 * DAYMS).toLocaleDateString('sv');
  for (const p of team.people) {
    for (const t of p.tickets || []) {
      if (!t.deadline || t.deadline < today || t.deadline > limit) continue;
      const ts = slug(t.title.replace(/^(web|website|landing|pop ?up|cambios web)\s*[-|:]?\s*/i, ''));
      const repo = allRepos.find((r) => { const s = slug(r); return s.length > 3 && (ts.includes(s) || (s.length > 5 && ts.includes(s.slice(0, 6)))); });
      if (!repo) continue; // ticket que no es de una web: no se puede saber
      const last = Math.max(0, ...(mc.repos[repo] || []).map((c) => c.at));
      const quiet = Date.now() - last > 4 * DAYMS;
      if (quiet) out.push({ squad: p.squad, leader: p.leader, ticket: t.title, url: t.url, deadline: t.deadline, repo, lastCommit: last || null });
    }
  }
  return out;
}
/** Borrador del standup por squad: lo de ayer (commits) y lo de hoy (tickets). */
async function standup() {
  const y0 = new Date();
  y0.setHours(0, 0, 0, 0);
  const from = y0.getTime() - (y0.getDay() === 1 ? 3 : 1) * DAYMS; // el lunes cuenta el viernes
  const mc = store.read('month-commits.json', {});
  const team = store.read('notion-team.json', null);
  const ids = { ...teamweek.DEFAULT_IDS, ...(store.read('settings.json', {}).teamIds || {}) };
  const today = new Date().toLocaleDateString('sv');
  const out = [];
  for (const [sq, leader] of Object.entries(SQUAD_LEADERS)) {
    const logins = (ids[sq]?.gh || []).map((x) => x.toLowerCase());
    const done = [];
    for (const [repo, list] of Object.entries(mc.repos || {})) {
      const mine = list.filter((c) => c.at >= from && c.at < y0.getTime() && logins.includes(String(c.login).toLowerCase()));
      if (mine.length) done.push({ repo: repo.replace(/^website-[a-d]-/, ''), n: mine.length, msgs: [...new Set(mine.map((c) => c.msg))].slice(0, 2) });
    }
    const p = (team?.people || []).find((x) => x.squad === sq);
    const cut = new Date(Date.now() - 14 * DAYMS).toLocaleDateString('sv');
    const todo = (p?.tickets || []).filter((t) => t.deadline && t.deadline >= cut && t.deadline <= new Date(Date.now() + 2 * DAYMS).toLocaleDateString('sv')).slice(0, 5);
    const lines = ['*Squad ' + sq.toUpperCase() + ' · ' + leader + '*', (y0.getDay() === 1 ? 'El viernes:' : 'Ayer:') + (done.length ? '' : ' sin commits'), ...done.map((d) => '• ' + d.repo + ' (' + d.n + '): ' + d.msgs.join('; ')), 'Hoy:' + (todo.length ? '' : ' sin tickets que venzan'), ...todo.map((t) => '• ' + t.title + (t.late ? ' (vencido ' + t.deadline + ')' : t.deadline === today ? ' (vence hoy)' : ' (vence ' + t.deadline + ')'))];
    out.push({ squad: sq, leader, text: lines.join('\n') });
  }
  const res = { at: Date.now(), day: today, squads: out };
  store.write('standup.json', res);
  return res;
}
/** Carga: semanas de trabajo pendiente según el ritmo de cierre de cada uno. */
function teamLoad() {
  const team = store.read('notion-team.json', null);
  const rows = (team?.people || []).map((p) => {
    const rate = (p.closed || []).reduce((a, b) => a + b, 0) / 4;
    return { squad: p.squad, leader: p.leader, open: p.open, late: p.late, rate: Math.round(rate * 10) / 10, weeks: rate ? Math.round((p.open / rate) * 10) / 10 : null };
  });
  const known = rows.filter((r) => r.weeks != null);
  const avg = known.length ? known.reduce((a, r) => a + r.weeks, 0) / known.length : null;
  const tips = [];
  const heavy = known.filter((r) => r.weeks > avg * 1.6 && r.open >= 5).sort((a, b) => b.weeks - a.weeks);
  const light = known.filter((r) => r.weeks < avg * 0.7).sort((a, b) => a.weeks - b.weeks);
  for (const h of heavy) if (light[0]) tips.push(h.leader + ' tiene ' + h.weeks + ' semanas de trabajo pendiente (el equipo, ' + Math.round(avg * 10) / 10 + '). ' + light[0].leader + ' va más holgado: podría tomar ' + Math.max(1, Math.round((h.open - avg * h.rate) / 2)) + ' tickets.');
  return { rows, avg: avg == null ? null : Math.round(avg * 10) / 10, tips };
}
ipcMain.handle('team:extras', async () => ({
  standup: store.read('standup.json', null),
  risk: await teamRisk().catch(() => []),
  comments: store.read('team-comments.json', null),
  load: teamLoad(),
}));
ipcMain.handle('team:standup', () => standup());
ipcMain.handle('team:comments', async () => {
  const team = await notion.team(rx, false, SQUAD_LEADERS);
  const list = await notion.teamComments(rx, team.people);
  const out = { at: Date.now(), list };
  store.write('team-comments.json', out);
  return out;
});
// notas de 1:1 por persona
ipcMain.handle('oneonone:get', (_e, squad) => (store.read('oneonone.json', {})[String(squad)] || []).slice(-20));
ipcMain.handle('oneonone:save', (_e, squad, text) => {
  const all = store.read('oneonone.json', {});
  const list = (all[String(squad)] ||= []);
  const t = String(text || '').trim().slice(0, 5000);
  if (t) list.push({ at: Date.now(), text: t });
  store.write('oneonone.json', all);
  return list.slice(-20);
});
async function teamMorningTick() {
  const now = new Date();
  const day = now.toLocaleDateString('sv');
  const st = store.read('team-morning.json', {});
  if (st.day === day || now.getHours() < 9 || now.getDay() === 0 || now.getDay() === 6) return;
  store.write('team-morning.json', { day });
  await repoDaily().catch(() => {});
  if (notion.linked(store.read)) {
    await notion.team(rx, true, SQUAD_LEADERS).catch(() => {});
    const team = store.read('notion-team.json', null);
    if (team?.people?.length) {
      const list = await notion.teamComments(rx, team.people).catch(() => null);
      if (list) {
        store.write('team-comments.json', { at: Date.now(), list });
        if (list.length) notify(list.length + (list.length === 1 ? ' comentario sin responder' : ' comentarios sin responder'), list.slice(0, 3).map((c) => c.leader.split(' ')[0] + ': «' + c.ticket + '» (' + c.author + ', hace ' + Math.round(c.hours / 24) + ' días)').join(' · '), null);
      }
    }
  }
  const s = await standup().catch(() => null);
  if (s) notify('Standup listo', 'El borrador de cada squad está en Websites → Squads, listo para pegar en Slack.', null);
  const risk = await teamRisk().catch(() => []);
  if (risk.length) notify(risk.length + (risk.length === 1 ? ' ticket en riesgo' : ' tickets en riesgo'), risk.slice(0, 3).map((r) => r.leader.split(' ')[0] + ': ' + r.ticket + ' vence ' + r.deadline + ' y no hay commits recientes').join(' · '), null);
}

// ---------- 1.26: regalos que bajan de precio y fechas importantes ----------
const giftwatch = require('./src/giftwatch');
const giftDeps = () => ({ read: store.read, write: store.write, loadCasa: () => casa.load(ctxRW), saveCasa: (c) => (casa.save(ctxRW, c), casaChanged()), readMeta: (u) => linkmeta.read(u, { keepRemote: true }), notify });
let giftBusy = null;
async function giftTick(force) {
  if (giftBusy) return giftBusy;
  giftBusy = (async () => {
    const st = store.read('gift-watch.json', {});
    const today = new Date().toLocaleDateString('sv');
    const rate = (await fx.get(ctxRW).catch(() => null))?.sell || null;
    giftwatch.checkDates(giftDeps(), rate);
    if (!force && st.day === today) return st;
    const r = await giftwatch.checkPrices(giftDeps(), { force: !!force });
    const out = { day: today, at: Date.now(), ...r };
    store.write('gift-watch.json', out);
    return out;
  })().finally(() => (giftBusy = null));
  return giftBusy;
}
ipcMain.handle('gifts:history', (_e, id) => giftwatch.historyOf(store.read, String(id || '')));
ipcMain.handle('gifts:checkPrices', () => giftTick(true));
ipcMain.handle('gifts:dates', async () => {
  const c = casa.load(ctxRW);
  const rate = (await fx.get(ctxRW).catch(() => null))?.sell || null;
  return giftwatch.dates(c).filter((d) => d.days <= 120).slice(0, 6).map((d) => {
    const w = giftwatch.wishes(c, d.for, rate);
    return { ...d, count: w.list.length, theirs: w.theirs.length, total: w.text, crc: w.crc };
  });
});

// ---------- 1.26: lanzamientos (web que pasa a Live en Notion) ----------
const launchcheck = require('./src/launchcheck');
let launchBusy = Promise.resolve();
function runLaunch(url, name) {
  const job = launchBusy.then(async () => {
    const r = await launchcheck.check(url);
    const all = store.read('launch-checks.json', {});
    all[r.url] = { ...r, name: name || all[r.url]?.name || sitecheck.hostOf(r.url) };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(40)) delete all[k];
    store.write('launch-checks.json', all);
    if (win && !win.isDestroyed()) win.webContents.send('launch:changed');
    return all[r.url];
  });
  launchBusy = job.catch(() => {});
  return job;
}
ipcMain.handle('launch:list', () => Object.values(store.read('launch-checks.json', {})).sort((a, b) => b.at - a.at));
ipcMain.handle('launch:check', (_e, url, name) => runLaunch(String(url || ''), name ? String(name) : null));
/** Mira el pipeline de Notion: si una web pasa a Live, se revisa sola y te avisa. */
async function launchTick() {
  const rows = store.read('notion-cache.json', null)?.data?.pipeline?.rows || [];
  if (!rows.length) return;
  const seen = store.read('launch-seen.json', null);
  const live = (r) => /live|publicad|lanzad/i.test(r.status || '') || r.group === 'done';
  const now = {};
  for (const r of rows) now[r.name] = live(r) ? 'live' : String(r.status || '');
  store.write('launch-seen.json', now);
  if (!seen) return; // la primera vez solo se anota cómo está todo
  for (const r of rows) {
    if (now[r.name] !== 'live' || seen[r.name] === 'live' || !r.production) continue;
    const res = await runLaunch(r.production, String(r.name || '').replace(/<[^>]+>|\*\*/g, '')).catch(() => null);
    if (!res) continue;
    const bad = res.items.filter((i) => !i.ok);
    notify(bad.length ? 'Lanzamiento de ' + res.name + ': ' + bad.length + ' pendientes' : 'Lanzamiento de ' + res.name + ': todo en orden', bad.length ? bad.slice(0, 4).map((i) => i.label).join(' · ') : 'Carga, tags, formulario, SEO y celular bien. Ya puedes avisar al cliente.', null);
  }
}

// ---------- 1.26: recibos por foto (luz, agua, internet…) ----------
async function readReceipt(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpe?g|webp|heic|heif);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) throw new Error('Esa imagen no se puede leer. Usa una foto JPG o PNG.');
  const fs = require('fs');
  const { nativeImage } = require('electron');
  let img = nativeImage.createFromBuffer(Buffer.from(m[2], 'base64'));
  if (img.isEmpty()) throw new Error('No pude abrir la foto (prueba con JPG o PNG).');
  if (img.getSize().width > 1800) img = img.resize({ width: 1800, quality: 'better' });
  const dir = path.join(assistDir(), 'recibos');
  fs.mkdirSync(dir, { recursive: true });
  const name = 'recibo-' + Date.now() + '.jpg';
  const file = path.join(dir, name);
  fs.writeFileSync(file, img.toJPEG(88));
  const c = casa.load(ctxRW);
  const pays = (c.payments || []).map((p) => ({ id: p.id, name: p.name, group: p.group, currency: p.currency }));
  try {
    const prompt = 'Lee la foto del recibo que está en recibos/' + name + ' (usa la herramienta Read para verla).\n' +
      'Estos son mis pagos mensuales: ' + JSON.stringify(pays) + '\n' +
      'Dime de qué servicio es (luz, agua, internet, teléfono, alquiler…), la empresa, el monto total a pagar, la moneda (CRC o USD), la fecha de vencimiento, el mes que cobra y a cuál de mis pagos corresponde (su id; si hay dos con el mismo nombre, elige por la persona o el lugar que aparezca en el recibo y que coincida con el grupo).\n' +
      'Responde SOLO con este JSON: {"servicio":"","empresa":"","monto":0,"moneda":"CRC","vence":"AAAA-MM-DD","mes":"AAAA-MM","pagoId":"","titular":"","nota":""}';
    const r = await aiJson(prompt, { system: 'Lees recibos de servicios de Costa Rica (ICE, CNFL, AyA, ESPH, JASEC, Coopelesca, Kölbi, Liberty, Tigo, Claro…) con cuidado: el monto es el total a pagar del período, no el saldo anterior ni los cargos por separado. Respondes SOLO con un bloque de código json válido.' });
    const p = (c.payments || []).find((x) => x.id === r.pagoId) || (c.payments || []).find((x) => plainText(x.name) === plainText(r.servicio));
    const month = /^\d{4}-\d{2}$/.test(r.mes || '') ? r.mes : /^\d{4}-\d{2}/.test(r.vence || '') ? r.vence.slice(0, 7) : new Date().toLocaleDateString('sv').slice(0, 7);
    return { paymentId: p?.id || null, payment: p ? p.name + (p.group && p.group !== 'Personal' ? ' (' + p.group + ')' : '') : null, service: r.servicio || '', company: r.empresa || '', amount: Number(r.monto) || null, currency: /^(CRC|USD)$/.test(r.moneda) ? r.moneda : 'CRC', due: /^\d{4}-\d{2}-\d{2}$/.test(r.vence || '') ? r.vence : null, month, holder: r.titular || '', note: r.nota || '', options: pays };
  } finally {
    fs.rmSync(file, { force: true }); // el recibo tiene datos de la cuenta: no se guarda
  }
}
const plainText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
/** Guarda el monto del mes, lo marca pagado y compara con los meses anteriores. */
function applyReceipt({ paymentId, month, amount, currency, due, paid = true, from = 'recibo' }) {
  const c = casa.load(ctxRW);
  const p = (c.payments || []).find((x) => x.id === paymentId);
  if (!p) throw new Error('Elige a qué pago corresponde.');
  if (!/^\d{4}-\d{2}$/.test(month || '') || !(Number(amount) > 0)) throw new Error('Falta el monto o el mes.');
  p.bills ||= {};
  p.bills[month] = { amount: Number(amount), currency: currency || p.currency || 'CRC', due: due || null, at: Date.now(), from };
  if (paid) p.paid = { ...(p.paid || {}), [month]: Date.now() };
  casa.save(ctxRW, c);
  casaChanged();
  const cmp = billCompare(p, month);
  if (cmp?.high) notify(p.name + ' vino ' + cmp.pct + '% más alto', 'Este mes ' + cmp.amount.toLocaleString('es') + ' ' + cmp.currency + ' frente a ' + cmp.avg.toLocaleString('es') + ' de promedio en los meses anteriores.', null);
  return { ok: true, compare: cmp };
}
/** Comparación con el promedio de los 3 meses anteriores (alto si pasa del 25%). */
function billCompare(p, month) {
  const cur = p.bills?.[month];
  if (!cur) return null;
  const prev = Object.entries(p.bills || {}).filter(([k, v]) => k < month && v.currency === cur.currency).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3).map(([, v]) => v.amount);
  if (!prev.length) return { amount: cur.amount, currency: cur.currency, avg: null, pct: null, high: false };
  const avg = Math.round(prev.reduce((a, b) => a + b, 0) / prev.length);
  const pct = Math.round((cur.amount / avg - 1) * 100);
  return { amount: cur.amount, currency: cur.currency, avg, pct, high: pct >= 25, low: pct <= -25 };
}
ipcMain.handle('casa:receipt', (_e, dataUrl) => readReceipt(dataUrl));
ipcMain.handle('casa:receiptApply', (_e, r) => applyReceipt(r || {}));

// ---------- 1.26: avisos de capítulos nuevos (Netflix y Crunchyroll) ----------
async function premiereTick() {
  const all = store.read('streaming.json', {});
  if (!Object.keys(all).length) return;
  const sent = store.read('streaming-notified.json', {});
  const now = Date.now();
  const seen = new Set();
  for (const a of Object.values(all)) {
    for (const e of streaming.summarize(a).slice(0, 30)) {
      if (e.movie || seen.has(a.platform + ':' + e.key)) continue;
      seen.add(a.platform + ':' + e.key);
      const s = await streaming.enrich(ctxRW, e, a.platform).catch(() => null);
      if (!s) continue;
      const meta = store.read('streaming-meta.json', {})['v3:' + a.platform + ':' + e.key] || {};
      // capítulos que salieron en las últimas 12 horas
      const fresh = [];
      for (const ep of meta.episodes || []) if (ep.at && ep.at <= now && ep.at > now - 12 * 3600000) fresh.push({ k: 'T' + ep.s + 'E' + ep.n, label: 'T' + ep.s + ' E' + ep.n + (ep.name ? ' «' + ep.name + '»' : '') });
      if (meta.next && meta.next.at <= now && meta.next.at > now - 12 * 3600000) fresh.push({ k: 'E' + meta.next.ep, label: 'Episodio ' + meta.next.ep });
      for (const f of fresh) {
        const key = a.platform + ':' + e.key + ':' + f.k;
        if (sent[key]) continue;
        sent[key] = now;
        const who = Object.values(all).filter((x) => streaming.summarize(x).some((y) => y.key === e.key)).map((x) => (x.who === 'emily' ? 'Emily' : 'Vincenzo'));
        notify('Nuevo capítulo de ' + e.name, f.label + ' ya está en ' + (a.platform === 'netflix' ? 'Netflix' : 'Crunchyroll') + (who.length ? ' · lo siguen ' + [...new Set(who)].join(' y ') : '') + '.', null);
      }
    }
  }
  const keys = Object.keys(sent);
  for (const k of keys) if (now - sent[k] > 60 * 86400000) delete sent[k];
  store.write('streaming-notified.json', sent);
}

// ---------- 1.26: tu semana (tarjeta del domingo en el iPhone) ----------
async function weekReview(nowT = Date.now()) {
  const d0 = new Date(nowT);
  d0.setHours(0, 0, 0, 0);
  const from = d0.getTime() - 6 * DAYMS;
  // juegos
  const byGame = new Map();
  for (const s of store.read('sessions.json', [])) if (s.start >= from) byGame.set(s.title, (byGame.get(s.title) || 0) + (s.end - s.start) / 60000);
  const games = [...byGame].sort((a, b) => b[1] - a[1]).map(([title, min]) => ({ title, min: Math.round(min) }));
  // series
  const series = [];
  for (const a of Object.values(store.read('streaming.json', {}))) {
    const recent = (a.items || []).filter((x) => x.date && x.date >= from);
    const by = new Map();
    for (const x of recent) by.set(x.series || x.title, (by.get(x.series || x.title) || 0) + 1);
    for (const [name, n] of by) series.push({ name, n, who: a.who === 'emily' ? 'Emily' : 'Vincenzo', platform: a.platform });
  }
  series.sort((a, b) => b.n - a.n);
  // gastos
  const c = casa.load(ctxRW);
  const rate = (await fx.get(ctxRW).catch(() => null))?.sell || null;
  const b = casa.budgetStatus(c, nowT, rate);
  const fromDay = new Date(from).toLocaleDateString('sv');
  const weekSpent = (c.budget?.expenses || []).filter((e) => e.date >= fromDay).reduce((s, e) => s + e.amount, 0) + (c.shopping || []).filter((s) => s.price && s.done && s.boughtAt >= from).reduce((s, x) => s + x.price, 0);
  const w = weekAhead(nowT);
  const bdays = (c.birthdays || []).map((x) => ({ x, n: casa.nextBirthday(x, nowT) })).filter((y) => y.x.day && y.n && y.n.days <= 14).sort((a, z) => a.n.days - z.n.days).map(({ x, n }) => ({ name: x.name, kind: x.kind, days: n.days, age: n.age }));
  const dates = giftwatch.dates(c, nowT).filter((x) => x.days <= 30 && !x.key.startsWith('bd:')).map((x) => ({ name: x.name, days: x.days, wishes: giftwatch.wishes(c, x.for, rate).list.length }));
  return {
    from,
    to: nowT,
    games: { total: games.reduce((s, g) => s + g.min, 0), list: games.slice(0, 5) },
    series: series.slice(0, 6),
    spending: { week: weekSpent, month: b.spent, limit: b.limit, currency: b.currency },
    pays: w.pays,
    meetings: w.meetings.length,
    bdays,
    dates,
    tramites: w.tramites,
  };
}
ipcMain.handle('week:review', () => weekReview());

// ---------- 1.26: compras compartidas con Emi (en su página) ----------
const emiShopping = {
  get: () => {
    const c = casa.load(ctxRW);
    return { cats: c.shopCats, items: (c.shopping || []).filter((x) => !x.done || (x.boughtAt && Date.now() - x.boughtAt < 2 * DAYMS)).map((x) => ({ id: x.id, name: x.name, qty: x.qty, cat: x.cat, done: x.done, by: x.by || '' })) };
  },
  add: (name, qty, cat) => {
    const c = casa.load(ctxRW);
    const n = String(name || '').trim().slice(0, 120);
    if (!n) throw new Error('Escribe qué falta.');
    if ((c.shopping || []).some((x) => !x.done && plainText(x.name) === plainText(n))) throw new Error('Eso ya está en la lista.');
    c.shopping.push({ id: require('crypto').randomBytes(6).toString('hex'), name: n, qty: String(qty || '').slice(0, 30), cat: (c.shopCats || []).includes(cat) ? cat : c.shopCats?.[0] || 'Súper', done: false, at: Date.now(), by: 'Emi' });
    casa.save(ctxRW, c);
    casaChanged();
    return true;
  },
  toggle: (id) => {
    const c = casa.load(ctxRW);
    const it = (c.shopping || []).find((x) => x.id === id);
    if (!it) return false;
    it.done = !it.done;
    it.boughtAt = it.done ? Date.now() : null;
    casa.save(ctxRW, c);
    casaChanged();
    return true;
  },
};
giftsApi.shopping = emiShopping;
mobileApi.receipt = readReceipt;

// ---------- 1.24: la semana del equipo (GitHub + Vercel + Notion) ----------
const teamweek = require('./src/teamweek');
let teamWeekBusy = null;
async function teamWeekRun() {
  const data = await teamweek.collect({
    read: store.read,
    vercelApi: webhealth.vercelApi,
    notionTeam: () => (notion.linked(store.read) ? notion.team(rx, false, SQUAD_LEADERS) : Promise.reject(new Error('sin conectar'))),
    leaders: SQUAD_LEADERS,
    pipeline: store.read('notion-cache.json', null)?.data?.pipeline?.rows || [],
  });
  if (!data.sources.github && !data.sources.vercel && !data.sources.notion) throw new Error(data.errors.join(' · ') || 'No pude leer GitHub, Vercel ni Notion.');
  let ai = null;
  let aiError = null;
  try {
    ai = await aiJson(teamweek.prompt(data), { system: 'Eres el líder técnico de un equipo de desarrollo web y escribes resúmenes semanales claros en español neutro. Respondes SOLO con un bloque de código json válido, sin texto antes ni después.' });
  } catch (e) {
    aiError = e.message;
  }
  const out = { ...data, ai, aiError };
  store.write('team-week.json', out);
  return out;
}
ipcMain.handle('teamweek:get', () => store.read('team-week.json', null));
ipcMain.handle('teamweek:run', () => {
  if (!teamWeekBusy) teamWeekBusy = teamWeekRun().finally(() => (teamWeekBusy = null));
  return teamWeekBusy;
});

// ---------- 1.23: Netflix y Crunchyroll (Viendo) ----------
const streaming = require('./src/streaming');
const WHO = ['vincenzo', 'emily'];
ipcMain.handle('stream:open', (_e, platform) => {
  streaming.open(String(platform));
  return true;
});
ipcMain.handle('stream:read', async (_e, platform, who) => {
  const p = String(platform);
  const w = WHO.includes(who) ? who : 'vincenzo';
  const r = p === 'netflix' ? await streaming.readNetflix() : p === 'crunchyroll' ? await streaming.readCrunchyroll() : null;
  if (!r) throw new Error('Plataforma desconocida');
  if (p === 'netflix') await streaming.nfDecorate(ctxRW, r.items).catch(() => null);
  const all = store.read('streaming.json', {});
  all[p + ':' + w] = { platform: p, who: w, profile: r.profile, at: Date.now(), items: r.items.slice(0, 600) };
  store.write('streaming.json', all);
  // las recomendaciones se preparan solas (en segundo plano) si no hay unas recientes
  const ai = store.read('streaming-ai.json', null);
  if (!streamAiBusy && (!ai || Date.now() - ai.at > 2 * 86400000)) {
    streamAiBusy = streamAi().catch(() => null).finally(() => {
      streamAiBusy = null;
      if (win && !win.isDestroyed()) win.webContents.send('stream:ai-ready');
    });
  }
  return { count: r.items.length, profile: r.profile };
});
ipcMain.handle('stream:forget', (_e, key) => {
  const all = store.read('streaming.json', {});
  delete all[String(key)];
  store.write('streaming.json', all);
  return true;
});
ipcMain.handle('stream:get', async () => {
  const all = store.read('streaming.json', {});
  const accounts = Object.entries(all).map(([key, a]) => ({ key, platform: a.platform, who: a.who, profile: a.profile, at: a.at, count: a.items.length, old: a.platform === 'netflix' && !a.items.some((x) => x.seriesId) }));
  const shows = [];
  for (const a of Object.values(all)) {
    if (a.platform === 'netflix' && a.items.some((x) => !x.seriesId)) {
      // lecturas de la 1.23: sin id de serie todavía; se arreglan las fechas al menos
      for (const x of a.items) if (x.date && x.date > Date.now() + 86400000) x.date = null;
    }
    const list = streaming.summarize(a).slice(0, 24);
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < list.length) {
        const e = list[i++];
        shows.push({ ...(await streaming.enrich(ctxRW, e, a.platform).catch(() => ({ ...e, platform: a.platform }))), who: a.who });
      }
    }));
  }
  shows.sort((x, y) => (y.last.date || 0) - (x.last.date || 0));
  return { accounts, shows, ai: store.read('streaming-ai.json', null) };
});
let streamAiBusy = null;
ipcMain.handle('stream:ai', () => streamAiBusy || streamAi());
async function streamAi() {
  const all = store.read('streaming.json', {});
  if (!Object.keys(all).length) throw new Error('Lee primero al menos un perfil de Netflix o Crunchyroll.');
  const lines = [];
  for (const a of Object.values(all)) {
    const list = streaming.summarize(a).slice(0, 40);
    lines.push('Perfil de ' + (a.who === 'emily' ? 'Emily' : 'Vincenzo') + ' en ' + (a.platform === 'netflix' ? 'Netflix' : 'Crunchyroll') + ': ' + list.map((e) => e.name + (e.movie ? ' (película)' : ' (' + e.count + ' episodios vistos, último ' + new Date(e.last.date || Date.now()).toLocaleDateString('es') + ')')).join('; '));
  }
  const today = new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  const prompt = 'Hoy es ' + today + '. Estos son los historiales de Netflix y Crunchyroll de dos perfiles (Vincenzo y Emily):\n' + lines.join('\n') + '\n\n' +
    'Busca en la web lo que haga falta y responde:\n1) Para cada perfil, con qué debería seguir después de lo que está viendo (3 a 5, que estén en Netflix o Crunchyroll en Latinoamérica, explicando por qué según lo que vio).\n2) Recomendaciones para ver juntos (3), que les gusten a los dos.\n3) Próximos estrenos de las próximas 8 semanas en Netflix y en Crunchyroll (temporadas nuevas de lo que ya ven primero, y luego novedades que encajen con sus gustos), con fecha.\n' +
    'Responde SOLO con este JSON: {"profiles":[{"who":"Vincenzo","next":[{"title":"","platform":"Netflix|Crunchyroll","why":""}]},{"who":"Emily","next":[]}],"together":[{"title":"","platform":"","why":""}],"upcoming":[{"title":"","platform":"","date":"","kind":"temporada nueva|estreno","why":""}],"sources":[{"title":"","url":""}]}';
  const data = await aiJson(prompt, { system: 'Eres un experto en series, películas y anime y escribes en español neutro. Respondes SOLO con un bloque de código json válido, sin texto antes ni después.' });
  const out = { at: Date.now(), data };
  store.write('streaming-ai.json', out);
  return out;
}

// Workana en Brave (donde ya tienes la sesión iniciada)
ipcMain.handle('wk:brave', (_e, url, text) => {
  const u = String(url || '');
  if (!/^https:\/\/www\.workana\.com\/[\w\-/?=&%.]*$/.test(u)) return false;
  if (text) require('electron').clipboard.writeText(String(text).slice(0, 20000));
  openInBrave(u);
  return true;
});

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

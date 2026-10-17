// Tu saldo en Steam (cartera) y en Epic (saldo de la cuenta y Epic Rewards).
// Ninguna de las dos tiendas lo da por API, así que se lee de sus páginas web
// oficiales: inicias sesión tú en una ventana de la app y la app lee el importe.
// La sesión se guarda como en un navegador (las cookies las cifra Chromium con tu
// usuario de Windows) para poder actualizar sin volver a entrar; "Desconectar"
// la borra.
const { BrowserWindow, session } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Se ejecuta dentro de la página de pagos de Epic: busca el importe que aparece
// justo después de "Epic Rewards" y de "Saldo de la cuenta".
function readEpic() {
  const text = document.body ? document.body.innerText.replace(/ /g, ' ') : '';
  const logged = !/\/id\/login/.test(location.pathname) && !/Iniciar sesión|Sign In/.test(document.title || '');
  // "CLP 4.350", "$3.80 USD", "4.350 CLP", "US$ 3,80"
  const MONEY = /(?:[A-Z]{2,3}\$?\s?|\p{Sc}\s?)\d[\d.,]*(?:\s?[A-Z]{3})?|\d[\d.,]*\s?(?:[A-Z]{3}\b|\p{Sc})/u;
  const find = (labels) => {
    for (const l of labels) {
      const i = text.toLowerCase().indexOf(l.toLowerCase());
      if (i < 0) continue;
      // Solo las dos líneas siguientes a la etiqueta
      const after = text.slice(i + l.length).split('\n').slice(0, 3).join('\n');
      for (const line of after.split('\n')) {
        const m = line.match(MONEY);
        if (m) return m[0].trim();
      }
    }
    return null;
  };
  const items = [];
  const rewards = find(['Epic Rewards', 'Recompensas de Epic', 'Recompensas']);
  const balance = find(['Saldo de la cuenta', 'Saldo de cuenta', 'Account balance']);
  if (rewards) items.push({ label: 'Epic Rewards', value: rewards });
  if (balance && balance !== rewards) items.push({ label: 'Saldo de la cuenta', value: balance });
  return { logged, items };
}

const STORES = {
  steam: {
    partition: 'persist:vt-steam',
    url: 'https://store.steampowered.com/account/?l=spanish',
    loginTitle: 'Inicia sesión en Steam',
    // Lee la cartera de la cabecera de la tienda o de la página de la cuenta
    read: `(() => {
      const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\\s+/g, ' ').trim();
      const logged = !!document.querySelector('#account_pulldown, #header_wallet_balance, .account_name');
      const wallet = t('#header_wallet_balance') || t('.accountData.price') || t('.account_wallet_balance');
      return { logged, items: wallet ? [{ label: 'Cartera de Steam', value: wallet }] : [] };
    })()`,
  },
  epic: {
    partition: 'persist:vt-epic',
    url: 'https://www.epicgames.com/account/payments?lang=es-ES',
    loginTitle: 'Inicia sesión en Epic Games',
    // Busca los importes junto a "Epic Rewards" / "Recompensas" y "Saldo"
    read: `(${readEpic.toString()})()`,
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function sessionFor(key) {
  const ses = session.fromPartition(STORES[key].partition);
  ses.setUserAgent(UA);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  return ses;
}

/**
 * Lee el saldo. Sin sesión y con interactive=true, enseña la ventana para que
 * inicies sesión y espera (hasta 5 minutos) a que el saldo aparezca.
 */
async function refresh(key, { parent, interactive }) {
  const st = STORES[key];
  if (!st) throw new Error('Tienda desconocida.');
  const win = new BrowserWindow({
    parent,
    show: false,
    width: 1050,
    height: 800,
    title: st.loginTitle,
    autoHideMenuBar: true,
    webPreferences: { session: sessionFor(key), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await win.loadURL(st.url).catch(() => {});
    const read = async () => {
      try {
        return await win.webContents.executeJavaScript(st.read);
      } catch {
        return { logged: false, items: [] };
      }
    };
    // Las páginas cargan el importe con JavaScript: varios intentos cortos
    let r = { logged: false, items: [] };
    for (let i = 0; i < 8; i++) {
      await wait(1000);
      r = await read();
      if (r.items.length) break;
    }
    if (r.items.length) return { ok: true, items: r.items, at: Date.now() };
    if (!interactive) return { ok: false, needsLogin: !r.logged, items: [], at: Date.now() };
    // Mostrar la ventana para que inicies sesión tú
    win.show();
    const deadline = Date.now() + 5 * 60000;
    let lastUrl = '';
    while (!win.isDestroyed() && Date.now() < deadline) {
      await wait(1500);
      if (win.isDestroyed()) break;
      const url = win.webContents.getURL();
      // Tras iniciar sesión, volver a la página del saldo
      if (url !== lastUrl && !/login|signin|\/id\//i.test(url) && !url.startsWith(st.url.split('?')[0])) {
        lastUrl = url;
        await win.loadURL(st.url).catch(() => {});
        continue;
      }
      lastUrl = url;
      r = await read();
      if (r.items.length) return { ok: true, items: r.items, at: Date.now() };
    }
    return { ok: false, needsLogin: true, items: [], at: Date.now(), error: win.isDestroyed() ? 'Cerraste la ventana antes de terminar.' : 'No se encontró el saldo en la página.' };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function logout(key) {
  const st = STORES[key];
  if (!st) return;
  await session.fromPartition(st.partition).clearStorageData();
}

module.exports = { refresh, logout, STORES };

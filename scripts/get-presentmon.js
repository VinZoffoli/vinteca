// Descarga PresentMon (Intel, licencia MIT) a build/tools si no está, y
// comprueba su huella SHA-256 antes de guardarlo. Lo usa `npm run dist`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2.6.0';
const URL = `https://github.com/GameTechDev/PresentMon/releases/download/v${VERSION}/PresentMon-${VERSION}-x64.exe`;
const SHA256 = 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af';
const OUT = path.join(__dirname, '..', 'build', 'tools', 'PresentMon.exe');

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  if (fs.existsSync(OUT) && hash(fs.readFileSync(OUT)) === SHA256) {
    console.log('PresentMon ya está descargado.');
    return;
  }
  console.log(`Descargando PresentMon ${VERSION}…`);
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`No se pudo descargar PresentMon (HTTP ${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (hash(buf) !== SHA256) throw new Error('La huella de PresentMon no coincide: no se guarda.');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('PresentMon descargado y comprobado.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Cachés que se pueden borrar sin perder nada: los sombreadores (shaders) que
// guardan Steam, DirectX y los drivers de la tarjeta gráfica. Se vuelven a
// generar solos la próxima vez que abres cada juego (los primeros minutos
// pueden ir con algún tirón mientras tanto).
const fs = require('fs');
const path = require('path');

async function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += (await fs.promises.stat(p)).size;
        } catch {}
      }
    }
  }
  return total;
}

/** Lista de cachés con su tamaño. */
async function scan({ steamLibraries, installedAppids }) {
  const local = process.env.LOCALAPPDATA || '';
  const items = [];
  // Steam: una carpeta por juego en cada biblioteca
  const unused = [];
  const used = [];
  for (const lib of steamLibraries) {
    const dir = path.join(lib, 'steamapps', 'shadercache');
    let ids = [];
    try {
      ids = fs.readdirSync(dir);
    } catch {}
    for (const id of ids) (installedAppids.has(Number(id)) ? used : unused).push(path.join(dir, id));
  }
  const sum = async (dirs) => (await Promise.all(dirs.map(dirSize))).reduce((a, b) => a + b, 0);
  items.push({ kind: 'steam-unused', label: 'Steam: sombreadores de juegos desinstalados', dirs: unused, bytes: await sum(unused), safe: true });
  items.push({ kind: 'steam-used', label: 'Steam: sombreadores de juegos instalados', dirs: used, bytes: await sum(used), safe: false });
  const gpu = [
    ['directx', 'DirectX (caché de sombreadores de Windows)', [path.join(local, 'D3DSCache')]],
    ['amd', 'Drivers de AMD', ['DxCache', 'DxcCache', 'VkCache', 'GLCache'].map((d) => path.join(local, 'AMD', d))],
    ['nvidia', 'Drivers de NVIDIA', [path.join(local, 'NVIDIA', 'DXCache'), path.join(local, 'NVIDIA', 'GLCache'), path.join(local, 'NVIDIA Corporation', 'NV_Cache')]],
  ];
  for (const [kind, label, dirs] of gpu) {
    const exist = dirs.filter((d) => fs.existsSync(d));
    if (exist.length) items.push({ kind, label, dirs: exist, bytes: await sum(exist), safe: false });
  }
  return items.filter((i) => i.bytes > 0 || i.kind.startsWith('steam'));
}

/** Borra el contenido de esas carpetas (lo que esté en uso se salta). */
async function clean(dirs) {
  let freed = 0;
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        const size = e.isDirectory() ? await dirSize(p) : (await fs.promises.stat(p)).size;
        await fs.promises.rm(p, { recursive: true, force: true });
        freed += size;
      } catch {
        // archivo en uso: se deja
      }
    }
  }
  return freed;
}

module.exports = { scan, clean };

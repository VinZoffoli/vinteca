// Genera build/icon.png (256 px) y build/icon.ico (16-256 px) sin dependencias:
// dibuja el monograma VT de ViperTeca (el mismo de build/brand/viperteca-mark.svg)
// en rojo sobre una baldosa oscura, píxel a píxel y con suavizado, y lo guarda
// como PNG con zlib. Uso: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const SS = 4; // submuestras por eje

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RED = hex('#ec2a30');
const TOP = hex('#2a1f27');
const BOTTOM = hex('#140f14');
const EDGE = hex('#3b2c36');

function inRoundRect(x, y, r) {
  const qx = Math.max(Math.abs(x - (r.x + r.w / 2)) - (r.w / 2 - r.rad), 0);
  const qy = Math.max(Math.abs(y - (r.y + r.h / 2)) - (r.h / 2 - r.rad), 0);
  return qx * qx + qy * qy <= r.rad * r.rad;
}

// Polígono cualquiera (regla par-impar)
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// Monograma en coordenadas de 300 px (igual que el SVG)
const MARK = [
  rect(100, 25, 23, 250),
  rect(22, 139, 82, 22),
  [[28.2, 59.8], [96.2, 127.8], [111.8, 112.2], [43.8, 44.2]],
  [[43.8, 255.8], [111.8, 187.8], [96.2, 172.2], [28.2, 240.2]],
  [[140, 25], [170, 25], [205, 128], [240, 25], [270, 25], [220, 160], [190, 160]],
  rect(140, 160, 130, 24),
  rect(192, 184, 26, 91),
];
// Del diseño de 300 px a la baldosa de 256 px (centrado y con margen)
const SCALE = 0.63;
const OX = 128 - 146 * SCALE;
const OY = 128 - 150 * SCALE;
const inMark = (x, y) => {
  const mx = (x - OX) / SCALE;
  const my = (y - OY) / SCALE;
  return MARK.some((p) => inPoly(mx, my, p));
};

const BG = { x: 8, y: 8, w: 240, h: 240, rad: 56 };
const BG_IN = { x: 9.5, y: 9.5, w: 237, h: 237, rad: 54.5 };

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = 256 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = (i + (si + 0.5) / SS) * k;
          const y = (j + (sj + 0.5) / SS) * k;
          if (!inRoundRect(x, y, BG)) continue;
          let c;
          if (inMark(x, y)) c = RED;
          else if (!inRoundRect(x, y, BG_IN)) c = EDGE;
          else {
            const t = (y - 8) / 240;
            c = TOP.map((v, n) => v + (BOTTOM[n] - v) * t);
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (j * size + i) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return png(size, px);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const v of buf) c = t[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngs = SIZES.map((size) => ({ size, data: render(size) }));
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs[0].data);

// ICO con imágenes PNG dentro (válido desde Windows Vista)
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + dir.length;
pngs.forEach((p, i) => {
  const o = i * 16;
  dir.writeUInt8(p.size >= 256 ? 0 : p.size, o);
  dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(p.data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += p.data.length;
});
fs.writeFileSync(path.join(BUILD, 'icon.ico'), Buffer.concat([header, dir, ...pngs.map((p) => p.data)]));
console.log('icono generado:', pngs.map((p) => `${p.size}px`).join(', '));

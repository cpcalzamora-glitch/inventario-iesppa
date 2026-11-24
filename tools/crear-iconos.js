// Genera los íconos PNG de la app (fondo azul con un código de barras blanco). Sin dependencias.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
function crc32(b) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let crc = 0xffffffff; for (const x of b) crc = t[(crc ^ x) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(tipo, datos) { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(n) {
  const barras = [3,1,2,1,1,3,2,1,1,2,3,1,1,2,1,3,2,1,1,2,1,1,3];
  const total = barras.reduce((a, b) => a + b, 0);
  const x0 = n * 0.22, ancho = n * 0.56, y0 = n * 0.3, y1 = n * 0.62;
  const filas = [];
  for (let y = 0; y < n; y++) {
    const f = Buffer.alloc(1 + n * 3); f[0] = 0;
    for (let x = 0; x < n; x++) {
      let blanco = false;
      if (y >= y0 && y <= y1 && x >= x0 && x < x0 + ancho) {
        let pos = (x - x0) / ancho * total, acc = 0;
        for (let i = 0; i < barras.length; i++) { acc += barras[i]; if (pos < acc) { blanco = i % 2 === 0; break; } }
      }
      if (y >= n * 0.68 && y <= n * 0.72 && x >= x0 && x < x0 + ancho) blanco = true;
      const [r, g, b] = blanco ? [255, 255, 255] : [31, 78, 120];
      f[1 + x * 3] = r; f[2 + x * 3] = g; f[3 + x * 3] = b;
    }
    filas.push(f);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(filas))), chunk('IEND', Buffer.alloc(0))]);
}
const dir = path.join(__dirname, '..', 'web', 'icons'); fs.mkdirSync(dir, { recursive: true });
for (const n of [192, 512]) fs.writeFileSync(path.join(dir, `icon-${n}.png`), png(n));
console.log('íconos creados');

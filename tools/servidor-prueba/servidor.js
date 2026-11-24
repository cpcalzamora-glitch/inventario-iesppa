/**
 * Servidor de pruebas local.
 *  - Sirve la carpeta web/ en http://localhost:8080
 *  - Atiende la API en http://localhost:8080/api ejecutando los .gs reales con gas-shim.js
 *
 * Uso:  node servidor.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 * La ruta indicada se COPIA a datos/ (la copia es la que se modifica; el original no se toca).
 * Los PIN de prueba se fijan con la variable PINES_PRUEBA="hernan:1111,invent1:2222,invent2:3333".
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearContexto } = require('./gas-shim');

const origen = process.argv[2];
const datosDir = path.join(__dirname, 'datos');
const copia = path.join(datosDir, 'BD_PRUEBA.xlsx');
fs.mkdirSync(datosDir, { recursive: true });
if (!fs.existsSync(copia) || process.env.REINICIAR === '1') {
  if (!origen) { console.error('Indique la ruta del Excel de la base.'); process.exit(1); }
  fs.copyFileSync(origen, copia);
}
const gas = crearContexto(copia);
gas.migrarV3(); // la copia local de la base puede ser anterior a la v3
for (const par of (process.env.PINES_PRUEBA || '').split(',').filter(Boolean)) {
  const [u, p] = par.split(':');
  gas.setPin(u, p);
}

const PORT = Number(process.env.PORT || 8080);
const WEB = path.join(__dirname, '..', '..', 'web');
const RETARDO = Number(process.env.RETARDO_MS || 0); // simula la latencia de Apps Script
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let guardarPendiente = null;
function guardarLuego() {
  clearTimeout(guardarPendiente);
  guardarPendiente = setTimeout(() => { try { gas.__ss.save(); } catch (e) { console.error('No se pudo guardar', e.message); } }, 1500);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    if (req.method === 'GET') {
      const out = gas.doGet({ parameter: Object.fromEntries(url.searchParams) });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(out.getContent());
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => setTimeout(() => {
      const out = gas.doPost({ postData: { contents: body, type: 'text/plain' } });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(out.getContent());
      guardarLuego();
    }, RETARDO));
    return;
  }
  let f = path.join(WEB, decodeURIComponent(url.pathname));
  if (!f.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('No encontrado'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('Servidor de prueba en http://localhost:' + PORT));

module.exports = { gas };

/**
 * Prueba de la constancia de verificación física (el mismo web/js/constancia.js de la app, ejecutado en Node).
 * Verifica bienes del Aula 102 en una copia de la base, genera el PDF y comprueba:
 *  - A4 horizontal, encabezado y las tres tablas de exactamente 806 pt de ancho;
 *  - solo trae lo verificado en el ambiente (más sus sobrantes), con fecha de cierre, responsable y DNI.
 * Uso: node prueba-constancia.mjs "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>" [salida.pdf]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(aqui, '..', '..', 'web');

// --- Imitación mínima del navegador para cargar los módulos de la app ---
const { jsPDF } = require('jspdf');
globalThis.window = globalThis;
globalThis.jspdf = { jsPDF };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = {
  createElement: () => ({}),
  head: { append: (s) => { require('jspdf-autotable'); setTimeout(s.onload, 0); } } // carga el plugin de tablas
};
globalThis.fetch = async (u) => {
  const buf = fs.readFileSync(path.join(WEB, u));
  return { ok: true, blob: async () => buf };
};
globalThis.FileReader = class { readAsDataURL(b) { this.result = 'data:image/png;base64,' + b.toString('base64'); this.onload(); } };

// --- Datos: copia de la base con verificaciones reales del backend ---
const { crearContexto } = require('./gas-shim.js');
const tmp = path.join(os.tmpdir(), 'bd_prueba_const_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
gas.migrarV3();
gas.setPin('invent1', '1111');
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
const tok = api({ action: 'login', usuario: 'invent1', pin: '1111' }).data.token;
const sync = (ops) => api({ action: 'sync', token: tok, ops: ops.map((o) => ({ op_id: crypto.randomUUID(), ...o })) }).data;
let bs = api({ action: 'getBootstrap', token: tok }).data;
const obj = (f) => Object.fromEntries(bs.bienes.columnas.map((c, i) => [c, f[i]]));
let bienes = bs.bienes.filas.map(obj);
const a102 = bienes.filter((b) => b.ambiente_id === '102');
const c12 = a102.filter((b) => b.tipo_codigo === '12D');
const lote = a102.filter((b) => b.tipo_codigo !== '12D');
const ext = bienes.find((b) => b.ambiente_id === '103' && b.tipo_codigo === '12D');
sync([{ type: 'abrirAmbiente', ambiente_id: '102' }]);
sync(c12.slice(0, 40).map((b, i) => ({ type: 'verificar', bien_id: b.id, ambiente_id: '102', estado_conserv: b.estado_ref || 'B', situacion: i === 3 ? 'D' : 'U' })));
sync([{ type: 'verificarLote', ambiente_id: '102', bien_ids: lote.slice(0, 4).map((b) => b.id), estado_conserv: 'R' },
  { type: 'verificar', bien_id: ext.id, ambiente_id: '102', estado_conserv: 'B', obs: 'Encontrado en el aula' },
  { type: 'registrarSobrante', ambiente_id: '102', denominacion: 'PIZARRA ACRILICA', color: 'BLANCO', estado_conserv: 'B', cantidad: 1 }]);
bs = api({ action: 'getBootstrap', token: tok }).data;
bienes = bs.bienes.filas.map(obj);

const { S } = await import('../../web/js/store.js');
const C = await import('../../web/js/constancia.js');
Object.assign(S, { cols: bs.bienes.columnas, bienes, ambientes: bs.ambientes, personal: bs.personal, config: bs.config, sobrantes: bs.sobrantes });
const amb = S.ambientes.find((a) => a.id === '102');

let fallos = 0;
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const fecha = '2026-11-25T15:30:00.000Z';
const r = await C.generarConstancia(amb, fecha);
const ancho = r.doc.internal.pageSize.getWidth(), alto = r.doc.internal.pageSize.getHeight();
check(Math.round(ancho) === 842 && Math.round(alto) === 595, `A4 horizontal (${ancho.toFixed(2)} × ${alto.toFixed(2)} pt)`);
check(r.anchos.length === 4 && r.anchos.every((w) => w === 806), 'encabezado, cuadro de datos, tabla de bienes y firmas: exactamente 806 pt (' + r.anchos.join(', ') + ')');
check([C.COLS_INFO, C.COLS_BIENES, C.COLS_FIRMAS].every((a) => a.reduce((x, y) => x + y, 0) === 806), 'los anchos de columna suman 806 pt en las tres tablas');
check(18 + 806 <= ancho - 17.8, 'la tabla entra en la hoja con márgenes de 18 pt');
check(r.bienes === 45 && r.sobrantes === 1 && r.total === 46, `trae solo lo verificado en el Aula 102: ${r.bienes} bienes + ${r.sobrantes} sobrante`);
const f = C.filasConstancia(amb);
const todas = f.grupos.flatMap((g) => g.filas);
check(f.grupos.map((g) => g.titulo).join(' | ') === 'EQUIPOS Y OTROS BIENES | MOBILIARIO | SOBRANTES (inventario aparte)', 'agrupado por categoría: ' + f.grupos.map((g) => g.titulo).join(', '));
check(todas.filter((x) => x[10].includes('(por lote)')).length === 4, 'los 8 dígitos se marcan "(por lote)"');
check(todas.some((x) => x[8] === 'D') && todas.filter((x) => x[8] === 'U').length === 44, 'columna SITUAC. con U/D verificados');
check(todas.some((x) => x[10].includes('Trasladado de')), 'el bien encontrado de otro ambiente se indica como trasladado');
check(todas.some((x) => x[0] === 'S-001' && x[1] === 'SOBRANTE'), 'el sobrante aparece con su código S-001');
check(C.fechaLarga(fecha) === 'Azángaro, 25 de noviembre de 2026', 'fecha de cierre: ' + C.fechaLarga(fecha));
check(C.dniDe(amb.responsable).length === 8, `responsable del ambiente con su DNI (${amb.responsable})`);
const salida = process.argv[3] || path.join(os.tmpdir(), r.nombre);
fs.writeFileSync(salida, Buffer.from(r.doc.output('arraybuffer')));
console.log('PDF: ' + salida + ' (' + r.paginas + ' páginas)');
fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nCONSTANCIA: TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

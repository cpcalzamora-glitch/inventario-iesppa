/**
 * Pruebas del código interno de 5 dígitos (texto): servidor (Apps Script en la PC) y celular (store.js).
 * Uso: node prueba-codigo-interno.mjs "<base con código interno de 5 dígitos.xlsx>"
 *      (la copia se prepara con preparar-codigo-interno.js)
 */
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { crearContexto } = require('./gas-shim');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { hostname: 'localhost' };
globalThis.indexedDB = { open: () => ({}) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { S, cargarBase, normalizarInterno, buscarPorInterno, buscarPorSerie, esCodigoInterno } = await import('../../web/js/store.js');

let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };

// --- Servidor: una celda guardada como NÚMERO (43) se lee como '00043' ---
const tmp = path.join(os.tmpdir(), 'bd_prueba_interno_' + Date.now() + '.xlsx');
const wb = XLSX.readFile(process.argv[2]);
const sh = wb.Sheets.BIENES;
const H = XLSX.utils.sheet_to_json(sh, { header: 1, range: 0 })[0];
const col = XLSX.utils.encode_col(H.indexOf('cod_interno'));
const id43 = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', raw: false }).slice(1).find((r) => r[H.indexOf('cod_interno')] === '00043')[0];
const filaNum = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', raw: false }).findIndex((r) => r[0] === id43);
sh[col + (filaNum + 1)] = { t: 'n', v: 43 }; // simula una celda que Sheets convirtió en número
XLSX.writeFile(wb, tmp);
const gas = crearContexto(tmp);
gas.migrarV3();
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
gas.setPin('invent1', '9102');
const tok = api({ action: 'login', usuario: 'invent1', pin: '9102' }).data.token;
const boot = api({ action: 'getBootstrap', token: tok }).data;
const ci = boot.bienes.columnas.indexOf('cod_interno');
const internos = boot.bienes.filas.map((f) => f[ci]);
check(internos.every((c) => /^\d{5}$/.test(c)), `el servidor entrega los ${internos.length} códigos internos como texto de 5 dígitos`);
check(boot.bienes.filas.find((f) => f[0] === id43)[ci] === '00043', 'una celda guardada como número 43 se entrega como "00043"');
check(new Set(internos).size === internos.length, 'ningún código interno se repite');
check(boot.bienes.columnas.includes('cod_interno_anterior'), 'la columna cod_interno_anterior se conserva (solo histórico)');
check(gas.verificarEstructura().ok, 'verificarEstructura() OK con cod_interno_anterior');
fs.unlinkSync(tmp);

// --- Celular ---
cargarBase(boot);
check(normalizarInterno('43') === '00043' && normalizarInterno(43) === '00043' && normalizarInterno('00043') === '00043', 'normaliza 43 → 00043');
check(normalizarInterno('462252150110') === '462252150110' && normalizarInterno('ABC') === 'ABC', 'no toca códigos de 12 dígitos ni texto');
const a = buscarPorInterno('43'), b = buscarPorInterno('00043'), c = buscarPorInterno('0043');
check(a.length === 1 && a[0] === b[0] && b[0] === c[0], `"43", "0043" y "00043" abren el mismo bien (${b[0].denominacion}, id ${b[0].id})`);
check(buscarPorInterno('123456').length === 0 && buscarPorInterno('99999').length === 0, 'más de 5 dígitos o un código inexistente no se toma como interno');
check(esCodigoInterno('7') && esCodigoInterno('00007'), 'esCodigoInterno completa con ceros');
// Caché antigua del celular con el código como número: al indexar se corrige.
const fila = boot.bienes.filas.find((f) => f[0] === id43).slice();
fila[ci] = '43';
cargarBase({ ...boot, bienes: { columnas: boot.bienes.columnas, filas: [fila] } });
check(S.bienes[0].cod_interno === '00043', 'si la copia del celular tenía 43, se corrige a "00043"');
cargarBase(boot);
// Lote de 8 dígitos: devuelve todos los bienes del lote
const ocho = [...S.porCodigo.entries()].find(([k, l]) => k.length === 8 && l.length > 3);
check(ocho && ocho[1].every((x) => x.tipo_codigo !== '12D'), `un código de lote de 8 dígitos (${ocho[0]}) lista sus ${ocho[1].length} bienes para elegir`);
// 12 dígitos del Lab. 205
const lab = S.bienes.find((x) => x.ambiente_id === '205' && x.tipo_codigo === '12D');
check((S.porCodigo.get(lab.cod_patrimonial) || []).includes(lab), `un código SIGA de 12 dígitos del Lab. 205 (${lab.cod_patrimonial}) encuentra su bien (interno ${lab.cod_interno})`);
const mon = S.bienes.find((x) => x.ambiente_id === '205' && /MONITOR/.test(x.denominacion) && buscarPorSerie(x.serie).length === 1);
check(!!mon && buscarPorSerie(mon.serie)[0] === mon, `la serie de un monitor del Lab. 205 (${mon && mon.serie}) lo encuentra`);

console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nCÓDIGO INTERNO: TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

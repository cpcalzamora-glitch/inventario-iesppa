/**
 * Prueba del criterio de aceptación de la Fase 0 sobre la copia local de la base.
 * Uso: node prueba-fase0.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_fase0_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };

const est = gas.verificarEstructura();
console.log(est.texto);
check(est.detalle.hojas_ok, '8 hojas con sus encabezados');

check(api({ action: 'login', usuario: 'hernan', pin: '1234' }).error === 'El usuario aún no tiene PIN asignado.', 'login rechazado si pin_hash vacío');
gas.setPin('hernan', '135790');
check(!/135790/.test(JSON.stringify(gas.__ss.getSheetByName('USUARIOS').values)), 'el PIN no se guarda en texto plano');
check(api({ action: 'login', usuario: 'hernan', pin: '000000' }).ok === false, 'PIN incorrecto rechazado');
check(api({ action: 'getBootstrap', token: 'falso' }).codigo === 'AUTH', 'token falso rechazado');
const lg = api({ action: 'login', usuario: 'Hernan', pin: '135790' });
check(lg.ok && lg.data.rol === 'ADMIN', 'login correcto (ADMIN)');

const t0 = Date.now();
const bs = api({ action: 'getBootstrap', token: lg.data.token });
const ms = Date.now() - t0;
check(bs.ok, 'getBootstrap responde');
const B = bs.data.bienes;
check(B.filas.length === 2417, 'getBootstrap devuelve 2,417 bienes (' + B.filas.length + ')');
check(bs.data.ambientes.length === 46, '46 ambientes (' + bs.data.ambientes.length + ')');
check(bs.data.personal.length > 0, 'personal: ' + bs.data.personal.length);
const iA = B.columnas.indexOf('ambiente_id');
const cuenta = {};
B.filas.forEach(f => (cuenta[f[iA]] = (cuenta[f[iA]] || 0) + 1));
const dif = bs.data.ambientes.filter(a => Number(a.total_esperado) !== (cuenta[a.id] || 0));
check(dif.length === 0, 'conteos por ambiente = AMBIENTES.total_esperado');
const iC = B.columnas.indexOf('cod_patrimonial');
check(B.filas.every(f => typeof f[iC] === 'string'), 'códigos patrimoniales como texto');
const tam = JSON.stringify(bs).length;
console.log('Tamaño de la descarga inicial: ' + (tam / 1024).toFixed(0) + ' KB, ' + ms + ' ms (local)');
const ping = JSON.parse(gas.doGet({ parameter: { action: 'ping' } }).getContent());
check(ping.ok && ping.data.conteos_coinciden && !ping.data.usuarios_con_pin, 'ping sin datos sensibles');
fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nCRITERIO FASE 0: CUMPLIDO (en copia local)');
process.exit(fallos ? 1 : 0);

/**
 * Pruebas de la revisión general (correcciones del 25/11/2026).
 * Uso: node prueba-revision.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_rev_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
gas.migrarV3();
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
const uid = () => crypto.randomUUID();
const objetos = (n) => { const v = gas.__ss.getSheetByName(n).values; return v.slice(1).map(r => Object.fromEntries(v[0].map((c, i) => [c, r[i] ?? '']))); };
const bien = (id) => objetos('BIENES').find(b => b.id === id);

gas.setPin('hernan', '9101');
gas.setPin('invent1', '9102');
const tA = api({ action: 'login', usuario: 'hernan', pin: '9101' }).data.token;
const tI = api({ action: 'login', usuario: 'invent1', pin: '9102' }).data.token;
const uno = (tok, op) => api({ action: 'sync', token: tok, ops: [{ op_id: uid(), ...op }] }).data[0];

// 1. getCambios manda los nombres de columna (los celulares ya no pierden columnas nuevas como conciliado_con)
const estab = objetos('BIENES').find(b => b.cod_patrimonial === '462252150169');
const siga = objetos('BIENES').find(b => b.cod_patrimonial === '462252150157');
const n0 = api({ action: 'getCambios', token: tI, desde_n: 0 }).data.historial_n;
uno(tA, { type: 'editarBien', bien_id: estab.id, cambios: { cod_patrimonial: '462252150157' }, motivo: 'revisión', conciliar: true });
const gc = api({ action: 'getCambios', token: tI, desde_n: n0 }).data;
const iConc = gc.columnas ? gc.columnas.indexOf('conciliado_con') : -1;
const filaSiga = gc.bienes.find(f => f[0] === siga.id);
check(iConc > 0 && filaSiga && filaSiga[iConc] === estab.id, 'getCambios trae columnas y la fila SIGA llega con conciliado_con = ' + estab.id);

// 2. Un celular con datos viejos verifica la fila SIGA conciliada: se verifica el bien físico
uno(tI, { type: 'abrirAmbiente', ambiente_id: '205' });
const rv = uno(tI, { type: 'verificar', bien_id: siga.id, ambiente_id: '205', estado_conserv: 'B' });
check(rv.estado === 'ok' && rv.data.bien.id === estab.id && bien(estab.id).estado_verif === 'UBICADO', 'verificar la fila SIGA conciliada ubica el bien físico ' + estab.id);
check(bien(siga.id).estado_verif === 'PENDIENTE' && /conciliada/.test(rv.data.aviso) && rv.data.bienes[0].id === siga.id, 'la fila SIGA no se toca, se avisa y se devuelve para deshacerla en el celular');

// 3. getCambios con desde_n mayor que el historial real: relee en vez de quedarse sin cambios para siempre
const gx = api({ action: 'getCambios', token: tI, desde_n: 999999 }).data;
check(gx.bienes.length > 0 && gx.historial_n < 999999, 'desde_n mayor que el HISTORIAL (hoja recortada): se relee todo (' + gx.bienes.length + ' bienes)');

fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nREVISIÓN (backend): TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

/**
 * Pruebas del backend de la Fase 1 sobre una copia de la base (Aula 102 y Aula 202).
 * Uso: node prueba-fase1.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_fase1_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
gas.migrarV3(); // la copia local de la base es anterior a la v3
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
const uid = () => crypto.randomUUID();

gas.setPin('invent1', '1111');
gas.setPin('invent2', '2222');
const t1 = api({ action: 'login', usuario: 'invent1', pin: '1111' }).data.token;
const t2 = api({ action: 'login', usuario: 'invent2', pin: '2222' }).data.token;
const bs = api({ action: 'getBootstrap', token: t1 }).data;
const C = bs.bienes.columnas;
const bienes = bs.bienes.filas.map(f => Object.fromEntries(C.map((c, i) => [c, f[i]])));
const sync = (tok, ops) => { const r = api({ action: 'sync', token: tok, ops }); if (!r.ok) throw new Error(r.error); return r.data; };
const hojaFilas = (n) => gas.__ss.getSheetByName(n).getLastRow() - 1;

// --- Aula 102 ---
const a102 = bienes.filter(b => b.ambiente_id === '102');
const c12 = a102.filter(b => b.tipo_codigo === '12D');
console.log('\nAula 102: ' + a102.length + ' bienes, ' + c12.length + ' con 12 dígitos');
check(sync(t1, [{ type: 'abrirAmbiente', op_id: uid(), ambiente_id: '102' }])[0].estado === 'ok', 'abrir Aula 102');

// Dos celulares verifican a la vez el mismo ambiente: ambos envían 30 bienes, 10 se repiten.
const opsA = c12.slice(0, 30).map(b => ({ type: 'verificar', op_id: uid(), bien_id: b.id, ambiente_id: '102', estado_conserv: 'B', version_cliente: b.version }));
const opsB = c12.slice(20, 50).map(b => ({ type: 'verificar', op_id: uid(), bien_id: b.id, ambiente_id: '102', estado_conserv: 'R', version_cliente: b.version }));
const t0 = Date.now();
const rA = sync(t1, opsA);
const rB = sync(t2, opsB);
console.log('   60 verificaciones en ' + (Date.now() - t0) + ' ms (local)');
check(rA.every(r => r.estado === 'ok') && rB.every(r => r.estado === 'ok'), 'las 60 verificaciones se aceptan');
const sheetB = () => {
  const sh = gas.__ss.getSheetByName('BIENES').values;
  const h = sh[0];
  return sh.slice(1).map(r => Object.fromEntries(h.map((c, i) => [c, r[i]])));
};
let actual = sheetB();
const ub102 = actual.filter(b => b.ambiente_real_id === '102' && b.estado_verif === 'UBICADO');
check(ub102.length === 50, '50 bienes distintos ubicados, sin duplicar filas (' + ub102.length + ')');
check(actual.length === 2417, 'BIENES sigue con 2,417 filas');
check(ub102.every(b => b.etiqueta === 'DEFINITIVA'), '12 dígitos → etiqueta DEFINITIVA');
const dobles = actual.filter(b => c12.slice(20, 30).some(x => x.id === b.id));
check(dobles.every(b => b.estado_conserv === 'R' && b.version === '2' && b.verificado_por === 'invent2'), 'en los 10 repetidos gana la última escritura y version = 2');
check(rB.slice(0, 10).every(r => r.data.aviso), 'los 10 repetidos llevan aviso de conflicto');

// Idempotencia: la cola reintenta las mismas operaciones
const nHist = hojaFilas('HISTORIAL');
const rA2 = sync(t1, opsA);
check(rA2.every(r => r.estado === 'duplicada') && hojaFilas('HISTORIAL') === nHist, 'reenviar la cola no repite nada (op_id idempotente)');

// --- Aula 202 (lote) ---
const a202 = bienes.filter(b => b.ambiente_id === '202');
console.log('\nAula 202: ' + a202.length + ' bienes (' + a202.filter(b => b.tipo_codigo === '8D').length + ' de 8 dígitos, ' + a202.filter(b => b.tipo_codigo === 'ALTA').length + ' altas 2025)');
sync(t1, [{ type: 'abrirAmbiente', op_id: uid(), ambiente_id: '202' }]);
const clave = b => [b.tipo_codigo === 'ALTA' ? 'ALTA' : 'LOTE', b.denominacion, b.marca, b.modelo, b.color, b.dimensiones].map(v => String(v || '').trim().toUpperCase()).join('|');
const grupos = {};
a202.forEach(b => (grupos[clave(b)] = grupos[clave(b)] || []).push(b));
Object.entries(grupos).forEach(([k, v]) => console.log('   ' + String(v.length).padStart(3) + '  ' + k.split('|').slice(0, 2).join(' – ') + ' – ' + k.split('|')[4]));
const carp = Object.values(grupos).sort((a, b) => b.length - a.length).find(g => g[0].tipo_codigo === '8D');
// Los dos celulares cuentan el mismo grupo: ambos eligen los mismos 10 primeros pendientes
const ids10 = carp.slice(0, 10).map(b => b.id);
const l1 = sync(t1, [{ type: 'verificarLote', op_id: uid(), ambiente_id: '202', bien_ids: ids10, estado_conserv: 'B' }])[0];
const l2 = sync(t2, [{ type: 'verificarLote', op_id: uid(), ambiente_id: '202', bien_ids: ids10, estado_conserv: 'B' }])[0];
check(l1.data.marcados.length === 10 && l2.data.marcados.length === 10 && l2.data.reemplazos === 10, 'lote simultáneo: el 2.º celular recibe 10 reemplazos del mismo grupo');
actual = sheetB();
const ubCarp = actual.filter(b => carp.some(c => c.id === b.id) && b.estado_verif === 'UBICADO');
check(ubCarp.length === Math.min(20, carp.length), 'grupo ' + carp[0].denominacion + ': ' + ubCarp.length + ' ubicadas, sin duplicar');
check(ubCarp.every(b => b.etiqueta === 'TEMPORAL'), '8 dígitos → etiqueta TEMPORAL');
const altas = a202.filter(b => b.tipo_codigo === 'ALTA');
const la = sync(t1, [{ type: 'verificarLote', op_id: uid(), ambiente_id: '202', bien_ids: altas.slice(0, 48).map(b => b.id), estado_conserv: 'B' }])[0];
check(la.estado === 'ok' && la.data.marcados.length === 48, '48 altas 2025 verificadas por lote');
check(sheetB().filter(b => b.tipo_codigo === 'ALTA' && b.estado_verif === 'UBICADO').every(b => b.etiqueta === 'TEMPORAL'), 'altas → etiqueta TEMPORAL');
const lx = sync(t1, [{ type: 'verificarLote', op_id: uid(), ambiente_id: '202', bien_ids: [c12[60] ? c12[60].id : c12[0].id], estado_conserv: 'B' }])[0];
check(lx.estado === 'error', 'un bien de 12 dígitos no se puede verificar por lote');

// --- Avisos ---
const otro = bienes.find(b => b.ambiente_id === '103' && b.tipo_codigo === '12D');
sync(t1, [{ type: 'abrirAmbiente', op_id: uid(), ambiente_id: '103' }]);
sync(t1, [{ type: 'verificar', op_id: uid(), bien_id: otro.id, ambiente_id: '103', estado_conserv: 'B' }]);
const cf = sync(t2, [{ type: 'verificar', op_id: uid(), bien_id: otro.id, ambiente_id: '102', estado_conserv: 'B' }])[0];
check(cf.estado === 'conflicto' && cf.data.conflicto === 'YA_VERIFICADO', 'ya verificado en otro ambiente → pide confirmación');
const mv = sync(t2, [{ type: 'verificar', op_id: uid(), bien_id: otro.id, ambiente_id: '102', estado_conserv: 'B', mover: true }])[0];
check(mv.estado === 'ok' && mv.data.bien.ambiente_real_id === '102', 'mover a este ambiente');
const H = gas.__ss.getSheetByName('HISTORIAL').values;
check(H.some(r => r[4] === 'MOVER' && r[3] === otro.id), 'el movimiento queda en HISTORIAL como MOVER');
const sinUb = bienes.find(b => b.ambiente_id === 'SIN_UBICAR');
const su = sync(t1, [{ type: 'verificar', op_id: uid(), bien_id: sinUb.id, ambiente_id: '102', estado_conserv: 'R' }])[0];
check(su.estado === 'ok' && su.data.bien.ambiente_real_id === '102', 'bien SIGA sin ubicar se confirma donde se encuentra');
check(sync(t1, [{ type: 'verificar', op_id: uid(), bien_id: otro.id, ambiente_id: '102', estado_conserv: 'X' }])[0].estado === 'error', 'estado de conservación fuera de la lista se rechaza');

// --- Sobrantes ---
const s1 = sync(t1, [{ type: 'registrarSobrante', op_id: uid(), ambiente_id: '202', denominacion: 'silla fija de madera', color: 'CAOBA', estado_conserv: 'R', cantidad: 3 }])[0];
const s2 = sync(t2, [{ type: 'registrarSobrante', op_id: uid(), ambiente_id: '102', denominacion: 'PIZARRA ACRILICA', estado_conserv: 'B', cantidad: 1 }])[0];
check(JSON.stringify(s1.data.codigos) === '["S-001","S-002","S-003"]' && s2.data.codigos[0] === 'S-004', 'sobrantes con correlativo global S-001…S-004');
check(hojaFilas('SOBRANTES') === 4 && sheetB().length === 2417, 'sobrantes solo en la hoja SOBRANTES (BIENES no cambia)');
const cfg = gas.__ss.getSheetByName('CONFIG').values.find(r => r[0] === 'correlativo_sobrante');
check(cfg[1] === '4', 'CONFIG.correlativo_sobrante = 4');

// --- Cierre en dos pasos: constancia IMPRESA → FIRMADA (recién ahí CERRADO) ---
const amb = (id) => { const v = gas.__ss.getSheetByName('AMBIENTES').values; return Object.fromEntries(v[0].map((c, i) => [c, v.find(r => r[0] === id)[i] ?? ''])); };
check(sync(t1, [{ type: 'firmarConstancia', op_id: uid(), ambiente_id: '202' }])[0].estado === 'error', 'no se puede marcar FIRMADA sin generar antes la constancia');
const ci = sync(t1, [{ type: 'cerrarAmbiente', op_id: uid(), ambiente_id: '202' }])[0];
check(ci.estado === 'ok' && ci.data.ubicados === 68 && ci.data.pendientes.length === 15 && ci.data.sobrantes === 3, 'cerrar Aula 202 (genera constancia): 68 ubicados, 15 pendientes, 3 sobrantes');
check(amb('202').constancia_estado === 'IMPRESA' && amb('202').estado === 'EN_CURSO' && amb('202').constancia_fecha, 'constancia IMPRESA con fecha; el ambiente sigue EN_CURSO hasta la firma');
check(sheetB().filter(b => ci.data.pendientes.includes(b.id)).every(b => b.estado_verif === 'PENDIENTE'), 'los pendientes quedan PENDIENTE (no faltantes)');
// Si se verifica algo más después de imprimir, la constancia queda desactualizada.
const extra = carp.find(b => !sheetB().find(x => x.id === b.id && x.estado_verif === 'UBICADO'));
const rx = sync(t1, [{ type: 'verificarLote', op_id: uid(), ambiente_id: '202', bien_ids: [extra.id], estado_conserv: 'B' }])[0];
check(rx.estado === 'ok' && /desactualizada/.test(rx.data.aviso) && amb('202').constancia_estado === 'PENDIENTE', 'verificar tras imprimir → constancia vuelve a PENDIENTE, con aviso');
check(sync(t1, [{ type: 'firmarConstancia', op_id: uid(), ambiente_id: '202' }])[0].estado === 'error', 'una constancia desactualizada no se puede marcar FIRMADA');
const ci2 = sync(t1, [{ type: 'cerrarAmbiente', op_id: uid(), ambiente_id: '202' }])[0];
const fi = sync(t1, [{ type: 'firmarConstancia', op_id: uid(), ambiente_id: '202', firmante: 'RESPONSABLE PRUEBA' }])[0];
check(ci2.data.ubicados === 69 && fi.estado === 'ok' && amb('202').estado === 'CERRADO' && amb('202').constancia_estado === 'FIRMADA' && amb('202').constancia_firmante === 'RESPONSABLE PRUEBA' && amb('202').total_ubicado === '69', 'constancia regenerada (69) y FIRMADA → ambiente CERRADO');
check(sync(t1, [{ type: 'verificar', op_id: uid(), bien_id: carp[25] ? carp[25].id : a202[0].id, ambiente_id: '202', estado_conserv: 'B' }])[0].estado === 'error', 'no se verifica en un ambiente cerrado');
check(gas.__ss.getSheetByName('HISTORIAL').values.filter(r => r[4] === 'CERRAR_AMBIENTE' && r[5] === 'ambiente.constancia_estado').length === 3, 'impresión y firma quedan en HISTORIAL (CERRAR_AMBIENTE)');
sync(t1, [{ type: 'abrirAmbiente', op_id: uid(), ambiente_id: '202' }]);
check(amb('202').estado === 'EN_CURSO' && amb('202').constancia_estado === 'PENDIENTE', 'reabrir → EN_CURSO y constancia PENDIENTE (la firmada queda en HISTORIAL)');

// --- Situación U/D ---
const libres = c12.filter(b => !sheetB().find(x => x.id === b.id && x.estado_verif === 'UBICADO'));
const sd = sync(t1, [{ type: 'verificar', op_id: uid(), bien_id: libres[0].id, ambiente_id: '102', estado_conserv: 'M', situacion: 'D' }])[0];
check(sd.estado === 'ok' && sd.data.bien.situacion === 'D', 'situación D (desuso) se guarda en BIENES.situacion');
check(sheetB().filter(b => b.estado_verif === 'UBICADO' && b.id !== libres[0].id).every(b => b.situacion === 'U'), 'sin indicar, la situación es U (uso)');
check(sync(t1, [{ type: 'verificar', op_id: uid(), bien_id: libres[1].id, ambiente_id: '102', estado_conserv: 'B', situacion: 'X' }])[0].estado === 'error', 'situación fuera de U/D se rechaza');

// --- Módulo 2c: 2 bienes de prueba referidos como entregados sin baja ---
const ref = c12.filter(b => !sheetB().find(x => x.id === b.id && x.estado_verif === 'UBICADO')).slice(-2);
const shB = gas.__ss.getSheetByName('BIENES').values;
const hdr = shB[0];
ref.forEach(b => { const r = shB.find(x => x[0] === b.id); r[hdr.indexOf('situacion_especial')] = 'REFERIDO_ENTREGADO_SIN_BAJA'; r[hdr.indexOf('ref_declaracion')] = 'D-001'; }); // lo hará el ADMIN en la Fase 2
const rr = sync(t2, [{ type: 'verificar', op_id: uid(), bien_id: ref[0].id, ambiente_id: '102', estado_conserv: 'R' }])[0];
check(rr.estado === 'ok' && /referido como entregado/.test(rr.data.aviso) && rr.data.bien.situacion_especial === '' && rr.data.bien.ref_declaracion === 'D-001', '2c: el bien referido que aparece se confirma, se quita la marca y conserva la declaración');
check(gas.__ss.getSheetByName('HISTORIAL').values.some(r => r[4] === 'QUITAR_REFERIDO' && r[3] === ref[0].id), '2c: quitar la marca queda en HISTORIAL (QUITAR_REFERIDO)');
const r2 = sheetB().find(b => b.id === ref[1].id);
check(r2.situacion_especial === 'REFERIDO_ENTREGADO_SIN_BAJA' && r2.estado_verif === 'PENDIENTE', '2c: el que no aparece sigue PENDIENTE y marcado (no se declara faltante en campo)');

// --- Informes (conteos de la prueba 6 del plan) ---
const todos = sheetB();
check(todos.filter(b => b.destino_informe === 'DREP+INTERNO').every(b => /^\d{12}$/.test(b.cod_patrimonial)), 'informe DREP: solo códigos de 12 dígitos');
check(todos.length + hojaFilas('SOBRANTES') === 2417 + 4, 'informe interno: todas las filas de BIENES + sobrantes (2,417 + 4)');

// --- Cambios incrementales ---
const gc = api({ action: 'getCambios', token: t1, desde_n: nHist }).data;
check(gc.historial_n === hojaFilas('HISTORIAL') && gc.bienes.length > 0 && gc.sobrantes.length === 4, 'getCambios devuelve solo lo nuevo (' + gc.bienes.length + ' bienes)');
check(api({ action: 'sync', token: 'x', ops: [] }).codigo === 'AUTH', 'sync sin token válido se rechaza');

fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nBACKEND FASE 1: TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

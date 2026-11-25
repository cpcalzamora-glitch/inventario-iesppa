/**
 * Pruebas v4 – Fase 1: reabrir (solo ADMIN), anular verificación, anular sobrante y reiniciar ambiente.
 * Uso: node prueba-v4-fase1.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 * Trabaja sobre una copia temporal; nunca toca la base original.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_v4f1_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
gas.migrarV3(); // agrega también las columnas de la v4 (HISTORIAL.motivo y SOBRANTES.anulado)
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
const uid = () => crypto.randomUUID();
const hoja = (n) => gas.__ss.getSheetByName(n).values;
const objetos = (n) => { const v = hoja(n); return v.slice(1).map(r => Object.fromEntries(v[0].map((c, i) => [c, r[i] ?? '']))); };
const amb = (id) => objetos('AMBIENTES').find(a => a.id === id);
const bien = (id) => objetos('BIENES').find(b => b.id === id);
const hist = () => objetos('HISTORIAL');

check(hoja('HISTORIAL')[0].includes('motivo') && hoja('SOBRANTES')[0].includes('anulado'), 'estructura v4: HISTORIAL.motivo y SOBRANTES.anulado agregadas al final');
check(gas.verificarEstructura().ok, 'verificarEstructura() OK con las columnas v4');

gas.setPin('hernan', '9101');
gas.setPin('invent1', '9102');
const tA = api({ action: 'login', usuario: 'hernan', pin: '9101' }).data.token;
const tI = api({ action: 'login', usuario: 'invent1', pin: '9102' }).data.token;
const sync = (tok, ops) => { const r = api({ action: 'sync', token: tok, ops }); if (!r.ok) throw new Error(r.error); return r.data; };
const uno = (tok, op) => sync(tok, [{ op_id: uid(), ...op }])[0];

const nBienes = hoja('BIENES').length;
const A = '102';
const c12 = objetos('BIENES').filter(b => b.ambiente_id === A && b.tipo_codigo === '12D').slice(0, 5);

// Ambiente de prueba: abrir, verificar 5, 2 sobrantes, constancia y firma.
uno(tI, { type: 'abrirAmbiente', ambiente_id: A });
c12.forEach(b => uno(tI, { type: 'verificar', bien_id: b.id, ambiente_id: A, estado_conserv: 'B' }));
const so = uno(tI, { type: 'registrarSobrante', ambiente_id: A, denominacion: 'SILLA PRUEBA', estado_conserv: 'B', cantidad: 2 });
uno(tI, { type: 'cerrarAmbiente', ambiente_id: A });
uno(tI, { type: 'firmarConstancia', ambiente_id: A });
check(amb(A).estado === 'CERRADO', 'ambiente de prueba cerrado con constancia firmada');

// 1. Reabrir
check(uno(tI, { type: 'abrirAmbiente', ambiente_id: A, motivo: 'quiero reabrir' }).estado === 'error' && amb(A).estado === 'CERRADO', 'reabrir: un INVENTARIADOR no puede');
check(uno(tA, { type: 'abrirAmbiente', ambiente_id: A }).estado === 'error', 'reabrir: el ADMIN debe indicar motivo');
check(uno(tI, { type: 'anularVerificacion', bien_id: c12[0].id, motivo: 'error' }).estado === 'error', 'anular en un ambiente cerrado se rechaza (primero reabrir)');
const ra = uno(tA, { type: 'abrirAmbiente', ambiente_id: A, motivo: 'faltó verificar un armario' });
check(ra.estado === 'ok' && amb(A).estado === 'EN_CURSO' && amb(A).constancia_estado === 'PENDIENTE', 'reabrir (ADMIN + motivo) → EN CURSO, constancia PENDIENTE');
check(c12.every(b => bien(b.id).estado_verif === 'UBICADO'), 'reabrir conserva lo verificado');
check(hist().some(h => h.accion === 'REABRIR_AMBIENTE' && h.usuario === 'hernan' && h.motivo === 'faltó verificar un armario' && h.campo === 'ambiente.estado' && h.valor_anterior === 'CERRADO'), 'reabrir queda en HISTORIAL con usuario y motivo');

// 2. Anular verificación de un bien
const b0 = bien(c12[0].id);
check(uno(tI, { type: 'anularVerificacion', bien_id: b0.id }).estado === 'error', 'anular sin motivo se rechaza');
const an = uno(tI, { type: 'anularVerificacion', bien_id: b0.id, motivo: 'se escaneó por error' });
const b0d = bien(b0.id);
check(an.estado === 'ok' && b0d.estado_verif === 'PENDIENTE' && b0d.ambiente_real_id === '' && b0d.verificado_por === '' && b0d.etiqueta === 'NO', 'anular deja el bien PENDIENTE');
const hAn = hist().filter(h => h.accion === 'ANULAR_VERIFICACION' && h.bien_id === b0.id);
check(['estado_verif', 'ambiente_real_id', 'estado_conserv', 'verificado_por', 'verificado_en'].every(c => hAn.some(h => h.campo === c && h.valor_anterior === b0[c])) &&
  hAn.every(h => h.motivo === 'se escaneó por error' && h.ambiente_id === A && h.usuario === 'invent1'), 'el registro anterior queda en HISTORIAL (valores, quién, cuándo, motivo)');
check(Number(b0d.version) === Number(b0.version) + 1, 'anular sube la versión del bien');
check(uno(tI, { type: 'anularVerificacion', bien_id: b0.id, motivo: 'otra vez' }).data.aviso === 'El bien ya estaba pendiente.', 'anular un bien pendiente no cambia nada');
check(uno(tI, { type: 'verificar', bien_id: b0.id, ambiente_id: A, estado_conserv: 'R' }).estado === 'ok' && bien(b0.id).estado_verif === 'UBICADO', 'el bien anulado se puede verificar de nuevo');

// Anular con la constancia impresa la deja desactualizada
uno(tI, { type: 'cerrarAmbiente', ambiente_id: A });
const an2 = uno(tI, { type: 'anularVerificacion', bien_id: c12[1].id, motivo: 'no corresponde' });
check(/desactualizada/.test(an2.data.aviso) && amb(A).constancia_estado === 'PENDIENTE', 'anular con constancia IMPRESA → vuelve a PENDIENTE');

// Anular sobrante
const cod = so.data.codigos[0];
const as = uno(tI, { type: 'anularSobrante', cod_sobrante: cod, motivo: 'era un bien con código' });
check(as.estado === 'ok' && objetos('SOBRANTES').find(s => s.cod_sobrante === cod).anulado === 'SI', 'anular sobrante → anulado = SI (la fila se conserva)');
check(hist().some(h => h.accion === 'ANULAR_SOBRANTE' && h.bien_id === cod && h.motivo === 'era un bien con código'), 'anular sobrante queda en HISTORIAL');
const cr = uno(tI, { type: 'cerrarAmbiente', ambiente_id: A });
check(cr.data.sobrantes === 1 && cr.data.ubicados === 4, 'el cierre no cuenta el sobrante anulado (4 ubicados, 1 sobrante)');

// 3. Reiniciar ambiente
uno(tI, { type: 'firmarConstancia', ambiente_id: A });
const nSob = hoja('SOBRANTES').length;
check(uno(tI, { type: 'reiniciarAmbiente', ambiente_id: A, motivo: 'prueba' }).estado === 'error', 'reiniciar: un INVENTARIADOR no puede');
check(uno(tA, { type: 'reiniciarAmbiente', ambiente_id: A }).estado === 'error', 'reiniciar: el ADMIN debe indicar motivo');
const antes = c12.map(b => bien(b.id)).filter(b => b.estado_verif === 'UBICADO');
const rs = uno(tA, { type: 'reiniciarAmbiente', ambiente_id: A, motivo: 'fin de la prueba piloto' });
check(rs.estado === 'ok' && rs.data.bienes_reiniciados === antes.length && rs.data.sobrantes_anulados === 1, 'reiniciar: ' + rs.data.bienes_reiniciados + ' bienes a PENDIENTE y 1 sobrante anulado');
check(objetos('BIENES').every(b => b.ambiente_real_id !== A), 'no queda ningún bien verificado en el ambiente');
check(objetos('SOBRANTES').filter(s => s.ambiente_id === A).every(s => s.anulado === 'SI'), 'todos los sobrantes del ambiente quedan anulados');
const a2 = amb(A);
check(a2.estado === 'PENDIENTE' && a2.constancia_estado === 'PENDIENTE' && a2.total_ubicado === '0' && !a2.cerrado_por && !a2.constancia_fecha, 'el ambiente vuelve a PENDIENTE');
const hR = hist().filter(h => h.accion === 'REINICIAR_AMBIENTE');
check(antes.every(b => hR.some(h => h.bien_id === b.id && h.campo === 'estado_conserv' && h.valor_anterior === b.estado_conserv)) &&
  hR.some(h => h.campo === 'ambiente.estado' && h.valor_anterior === 'CERRADO') && hR.every(h => h.motivo === 'fin de la prueba piloto' && h.usuario === 'hernan'),
'la copia previa (bienes, sobrantes y ambiente) queda en HISTORIAL con motivo');
check(hoja('BIENES').length === nBienes && hoja('SOBRANTES').length === nSob, 'no se borró ninguna fila de BIENES ni de SOBRANTES');
check(uno(tI, { type: 'abrirAmbiente', ambiente_id: A }).estado === 'ok' && amb(A).estado === 'EN_CURSO', 'tras reiniciar, cualquiera puede volver a abrirlo');

// Lecturas: los cambios llegan a los otros celulares
const gc = api({ action: 'getCambios', token: tI, desde_n: 0 }).data;
check(gc.sobrantes.some(s => s.anulado === 'SI') && gc.bienes.some(f => f[0] === b0.id), 'getCambios trae los bienes reiniciados y los sobrantes anulados');

fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nV4 FASE 1: TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

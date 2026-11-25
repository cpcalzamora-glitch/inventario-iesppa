/**
 * Pruebas v4 – Fase 2: ficha del bien editable (solo ADMIN) e historial.
 * Uso: node prueba-v4-fase2.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 * Trabaja sobre una copia temporal; nunca toca la base original.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_v4f2_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
gas.migrarV3();
const api = (p) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(p) } }).getContent());
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
const uid = () => crypto.randomUUID();
const hoja = (n) => gas.__ss.getSheetByName(n).values;
const objetos = (n) => { const v = hoja(n); return v.slice(1).map(r => Object.fromEntries(v[0].map((c, i) => [c, r[i] ?? '']))); };
const bien = (id) => objetos('BIENES').find(b => b.id === id);

gas.setPin('hernan', '9101');
gas.setPin('invent1', '9102');
const tA = api({ action: 'login', usuario: 'hernan', pin: '9101' }).data.token;
const tI = api({ action: 'login', usuario: 'invent1', pin: '9102' }).data.token;
const uno = (tok, op) => { const r = api({ action: 'sync', token: tok, ops: [{ op_id: uid(), ...op }] }); if (!r.ok) throw new Error(r.error); return r.data[0]; };
const editar = (tok, id, cambios, extra = {}) => uno(tok, { type: 'editarBien', bien_id: id, cambios, motivo: 'corrección de prueba', ...extra });

const nFilas = hoja('BIENES').length;
const COD_DUP = '462252150169';
const estab = objetos('BIENES').filter(b => b.cod_patrimonial === COD_DUP);
console.log('\nEstabilizadores con ' + COD_DUP + ': ' + estab.length);
check(estab.length === 12 && estab.every(b => b.cod_duplicado === 'SI' && b.apto_etiqueta === 'NO'), 'los 12 estabilizadores figuran "dup." y no aptos');

// Permisos y motivo
const e0 = estab[0];
check(editar(tI, e0.id, { cod_patrimonial: '462252150157' }).estado === 'error', 'un INVENTARIADOR no puede editar la ficha');
check(uno(tA, { type: 'editarBien', bien_id: e0.id, cambios: { cod_patrimonial: '462252150157' } }).estado === 'error', 'editar sin motivo se rechaza');

// Validaciones de código
check(/12 dígitos/.test(editar(tA, e0.id, { cod_patrimonial: '46225215015' }).error), '12D con 11 dígitos se rechaza');
check(editar(tA, e0.id, { cod_patrimonial: '46225215015A' }).estado === 'error', '12D con letras se rechaza');
check(editar(tA, e0.id, { tipo_codigo: '8D' }).estado === 'error', '8D con un código de 12 dígitos se rechaza');
check(editar(tA, e0.id, { tipo_codigo: 'XX' }).estado === 'error', 'tipo de código fuera de la lista se rechaza');
check(editar(tA, e0.id, { campo_raro: '1' }).estado === 'error', 'solo se editan los campos de la ficha');
const otro12 = objetos('BIENES').find(b => b.tipo_codigo === '12D' && b.cod_duplicado === 'NO' && b.ambiente_id === '102');
const rd = editar(tA, e0.id, { cod_patrimonial: otro12.cod_patrimonial });
check(rd.estado === 'error' && /ya existe/.test(rd.error), 'un código que ya existe en otro bien se avisa y no se aplica sin confirmar');
check(bien(e0.id).cod_patrimonial === COD_DUP, 'el bien no cambió tras los rechazos');

// Prueba del plan: asignar un código libre a un estabilizador → desaparece "dup."
const siga157 = objetos('BIENES').find(b => b.cod_patrimonial === '462252150157');
const sin = editar(tA, e0.id, { cod_patrimonial: '462252150157' });
check(sin.estado === 'error' && sin.error.includes('fila SIGA sin ubicar id ' + siga157.id), 'el código libre es de una fila SIGA sin ubicar: se pide conciliar');
const ok = editar(tA, e0.id, { cod_patrimonial: '462252150157' }, { motivo: 'código libre asignado por la DREP', conciliar: true });
const s157 = bien(siga157.id);
check(ok.estado === 'ok' && s157.conciliado_con === e0.id && s157.estado_verif === 'PENDIENTE' && s157.cod_patrimonial === '462252150157', 'conciliado: la fila SIGA ' + siga157.id + ' queda marcada con el id ' + e0.id + ' (no se borra)');
check(objetos('HISTORIAL').some(h => h.accion === 'CONCILIAR' && h.bien_id === siga157.id && h.campo === 'conciliado_con' && h.valor_nuevo === e0.id), 'la conciliación queda en HISTORIAL');
check(editar(tA, otro12.id, { cod_patrimonial: '462252150178' }, { conciliar: true }).estado === 'ok' && editar(tA, otro12.id, { cod_patrimonial: otro12.cod_patrimonial }).estado === 'ok', 'probar conciliar y volver al código original');
check(bien(objetos('BIENES').find(b => b.cod_patrimonial === '462252150178' && b.fuente === 'SIGA').id).conciliado_con === '', 'al volver al código original, la fila SIGA deja de estar conciliada (DESCONCILIAR)');
const e0d = bien(e0.id);
check(ok.estado === 'ok' && e0d.cod_patrimonial === '462252150157' && e0d.cod_duplicado === 'NO', 'código libre asignado: el estabilizador ya no es "dup."');
check(e0d.apto_etiqueta === 'SI' && e0d.en_siga === 'SI' && e0d.destino_informe === 'DREP+INTERNO' && e0d.version === String(Number(e0.version) + 1), 'se recalculan apto_etiqueta, en_siga, destino_informe y versión');
check(estab.slice(1).every(b => bien(b.id).cod_duplicado === 'SI'), 'los otros 11 siguen "dup."');
const H = objetos('HISTORIAL');
check(H.some(h => h.accion === 'EDITAR_FICHA' && h.bien_id === e0.id && h.campo === 'cod_patrimonial' && h.valor_anterior === COD_DUP && h.valor_nuevo === '462252150157' && h.motivo === 'código libre asignado por la DREP' && h.usuario === 'hernan'), 'el cambio queda en HISTORIAL (anterior, nuevo, usuario, motivo)');
check(H.some(h => h.accion === 'EDITAR_FICHA' && h.bien_id === e0.id && h.campo === 'cod_duplicado' && h.valor_anterior === 'SI' && h.valor_nuevo === 'NO'), 'el recálculo de cod_duplicado también queda en HISTORIAL');

// Los 11 restantes: al dejar uno solo con el código, también deja de ser "dup."
const libres = ['462252150163', '462252150165', '462252150170', '462252150171', '462252150172', '462252150173', '462252150174', '462252150175', '462252150176', '462252150177'];
estab.slice(1, 11).forEach((b, k) => editar(tA, b.id, { cod_patrimonial: libres[k] }, { conciliar: true }));
const ultimo = bien(estab[11].id);
check(ultimo.cod_patrimonial === COD_DUP && ultimo.cod_duplicado === 'NO' && ultimo.apto_etiqueta === 'SI', 'el último que conserva ' + COD_DUP + ' deja de ser "dup." (recalculado como vecino)');
check(objetos('HISTORIAL').some(h => h.accion === 'RECALCULO' && h.bien_id === ultimo.id && h.campo === 'cod_duplicado'), 'el recálculo del vecino queda en HISTORIAL (RECALCULO)');
const a205 = objetos('AMBIENTES').find(a => a.id === '205');
check(Number(a205.aptos_etiqueta) === objetos('BIENES').filter(b => b.ambiente_id === '205' && b.apto_etiqueta === 'SI').length, 'AMBIENTES.aptos_etiqueta del Lab. 205 recalculado (' + a205.aptos_etiqueta + ')');

// Duplicado aceptado con confirmación expresa
const dupOk = editar(tA, estab[0].id, { cod_patrimonial: '462252150163' }, { aceptar_duplicado: true, motivo: 'misma etiqueta física, se revisará' });
check(dupOk.estado === 'ok' && bien(estab[0].id).cod_duplicado === 'SI' && bien(estab[1].id).cod_duplicado === 'SI', 'duplicado aceptado con motivo: ambos quedan "dup."');
editar(tA, estab[0].id, { cod_patrimonial: '462252150157' });

// Otros campos
const r2 = editar(tA, otro12.id, { serie: 'abc123', marca: 'hp', modelo: 'x1', denominacion: 'monitor led', obs_campo: 'Revisado en almacén' });
const o2 = bien(otro12.id);
check(r2.estado === 'ok' && o2.serie === 'ABC123' && o2.marca === 'HP' && o2.modelo === 'X1' && o2.denominacion === 'MONITOR LED' && o2.obs_campo === 'Revisado en almacén', 'serie, marca, modelo, denominación y observación se editan');
check(editar(tA, otro12.id, { denominacion: '' }).estado === 'error', 'la denominación no puede quedar vacía');
check(editar(tA, otro12.id, { ambiente_real_id: '103' }).estado === 'error', 'el ambiente real no se cambia en un bien pendiente');

// Ambiente real de un bien verificado
uno(tI, { type: 'abrirAmbiente', ambiente_id: '102' });
uno(tI, { type: 'abrirAmbiente', ambiente_id: '103' });
uno(tI, { type: 'verificar', bien_id: otro12.id, ambiente_id: '102', estado_conserv: 'B' });
const ra = editar(tA, otro12.id, { ambiente_real_id: '103' });
const amb103 = objetos('AMBIENTES').find(a => a.id === '103');
check(ra.estado === 'ok' && bien(otro12.id).ambiente_real_id === '103' && bien(otro12.id).responsable_real === amb103.responsable, 'ambiente real corregido (y su responsable)');

// Cambio de tipo: 12D → SIN deja de ir al informe DREP
const rt = editar(tA, otro12.id, { tipo_codigo: 'SIN', cod_patrimonial: '' });
const o3 = bien(otro12.id);
check(rt.estado === 'ok' && o3.destino_informe === 'INTERNO' && o3.apto_etiqueta === 'NO' && o3.en_siga === 'NO' && o3.etiqueta === 'TEMPORAL', '12D → SIN: INTERNO, no apto, etiqueta TEMPORAL');

// Historial del bien
const hb = api({ action: 'getHistorialBien', token: tI, bien_id: estab[0].id }).data;
check(hb.total > 0 && hb.filas[0].fecha_hora >= hb.filas[hb.filas.length - 1].fecha_hora && hb.filas.every(f => f.bien_id === estab[0].id), 'getHistorialBien devuelve el historial del bien, lo más reciente primero (' + hb.total + ')');

check(hoja('BIENES').length === nFilas, 'BIENES conserva todas sus filas');
check(gas.verificarEstructura().ok, 'verificarEstructura() sigue OK (destino_informe coincide con tipo_codigo)');

fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nV4 FASE 2: TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

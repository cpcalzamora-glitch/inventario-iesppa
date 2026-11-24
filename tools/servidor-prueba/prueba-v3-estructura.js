/**
 * Prueba de la migración a la v3 (migrarV3 + verificarEstructura) sobre una copia de la base.
 * Uso: node prueba-v3-estructura.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_v3_' + Date.now() + '.xlsx');
fs.copyFileSync(process.argv[2], tmp);
const gas = crearContexto(tmp);
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
const tabla = (n) => { const v = gas.__ss.getSheetByName(n).values; return v.slice(1).filter(r => r.some(x => x !== '')).map(r => Object.fromEntries(v[0].map((c, i) => [c, r[i] ?? '']))); };

const antes = tabla('BIENES');
const log1 = gas.migrarV3();
console.log(log1.map(l => '   ' + l).join('\n'));
const log2 = gas.migrarV3();
const B = tabla('BIENES');
const hB = gas.__ss.getSheetByName('BIENES').values[0];
check(B.length === 2417 && B.length === antes.length, 'BIENES sigue con 2,417 filas');
check(['destino_informe', 'situacion_especial', 'ref_declaracion', 'situacion'].every(c => hB.includes(c)), 'BIENES tiene las columnas nuevas al final');
check(hB.indexOf('entidad_id') === 31 && hB.indexOf('destino_informe') === 32, 'no se movió ninguna columna (destino_informe en AG)');
check(antes.every((b, i) => Object.keys(b).every(k => B[i][k] === b[k] || k === 'destino_informe')), 'los datos existentes no cambiaron');
const drep = B.filter(b => b.destino_informe === 'DREP+INTERNO');
check(drep.length === B.filter(b => b.tipo_codigo === '12D').length && drep.every(b => b.tipo_codigo === '12D'), 'DREP+INTERNO = solo los 12D (' + drep.length + ')');
check(B.every(b => b.destino_informe === (b.tipo_codigo === '12D' ? 'DREP+INTERNO' : 'INTERNO')), 'todos los demás = INTERNO; ningún bien sin destino');
check(drep.every(b => /^\d{12}$/.test(b.cod_patrimonial)), 'los DREP+INTERNO tienen código de 12 dígitos');
check(gas.__ss.getSheetByName('AMBIENTES').values[0].slice(15, 18).join() === 'constancia_estado,constancia_firmante,constancia_fecha', 'AMBIENTES P-R: constancia_estado, constancia_firmante, constancia_fecha');
check(gas.__ss.getSheetByName('DECLARACIONES').values[0].join() === 'id_decl,fecha,declarante,dni,cargo_periodo,resumen,foto_url,registrado_por,registrado_en', 'hoja DECLARACIONES con sus encabezados');
const L = gas.leerListas_();
check(L.situacion.join() === 'U,D' && L.situacion_especial[0] === 'REFERIDO_ENTREGADO_SIN_BAJA' && L.constancia_estado.join() === 'PENDIENTE,IMPRESA,FIRMADA' && L.destino_informe.join() === 'DREP+INTERNO,INTERNO', 'LISTAS con los valores nuevos');
check(L.estado_conserv.join() === 'B,R,M,CH,RAEE', 'LISTAS anteriores intactas');
check(log2.length === 2, 'ejecutarla otra vez no agrega nada (' + log2.length + ' líneas)');
const est = gas.verificarEstructura();
console.log(est.texto.split('\n').map(l => '   ' + l).join('\n'));
check(est.ok && est.detalle.hojas_ok, 'verificarEstructura: 9 hojas OK y destino_informe coincide');
check(est.detalle.codigos_invalidos.length === 1 && est.detalle.codigos_invalidos[0].cod.length === 9, 'detecta el único código de longitud no válida (9 dígitos)');
// Informe interno = todos los bienes + sobrantes (aquí 0 sobrantes)
check(B.length + tabla('SOBRANTES').length === 2417, 'informe interno: 2,417 bienes + 0 sobrantes');
fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nESTRUCTURA V3: TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

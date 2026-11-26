/**
 * Pruebas: verificación "por serie" (columna metodo_ubicacion) y reinicio de los datos de prueba.
 * Uso: node prueba-serie-reinicio.js "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearContexto } = require('./gas-shim');

const tmp = path.join(os.tmpdir(), 'bd_prueba_serie_' + Date.now() + '.xlsx');
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

gas.setPin('invent1', '9102');
const tI = api({ action: 'login', usuario: 'invent1', pin: '9102' }).data.token;
const uno = (op) => api({ action: 'sync', token: tI, ops: [{ op_id: uid(), ...op }] }).data[0];

const H = hoja('BIENES')[0];
check(H[H.length - 1] === 'metodo_ubicacion' && H.indexOf('conciliado_con') === H.length - 2, 'BIENES: metodo_ubicacion agregada al final, sin mover las demás columnas');

// --- Verificación por serie ---
const equipos = objetos('BIENES').filter(b => b.ambiente_id === '205' && /PROYECTOR|PIZARRA DIGITAL|CPU|MONITOR/.test(b.denominacion) && b.serie && !/^S\.?S/.test(b.serie));
uno({ type: 'abrirAmbiente', ambiente_id: '205' });
const r1 = uno({ type: 'verificar', bien_id: equipos[0].id, ambiente_id: '205', estado_conserv: 'B', por_serie: true });
check(r1.estado === 'ok' && bien(equipos[0].id).metodo_ubicacion === 'SERIE', 'verificado por serie → metodo_ubicacion = SERIE');
check(objetos('HISTORIAL').some(h => h.bien_id === equipos[0].id && h.campo === 'metodo_ubicacion' && h.valor_nuevo === 'SERIE'), 'queda en el HISTORIAL');
uno({ type: 'verificar', bien_id: equipos[1].id, ambiente_id: '205', estado_conserv: 'B' });
check(bien(equipos[1].id).metodo_ubicacion === '', 'verificado por código → metodo_ubicacion vacío');
uno({ type: 'anularVerificacion', bien_id: equipos[0].id, motivo: 'prueba' });
check(bien(equipos[0].id).metodo_ubicacion === '' && bien(equipos[0].id).estado_verif === 'PENDIENTE', 'anular la verificación limpia metodo_ubicacion');
uno({ type: 'verificar', bien_id: equipos[0].id, ambiente_id: '205', estado_conserv: 'R', por_serie: true });

// --- Más datos de prueba: otro ambiente cerrado con constancia firmada y un sobrante ---
const a102 = objetos('BIENES').filter(b => b.ambiente_id === '102' && b.tipo_codigo === '12D').slice(0, 4);
uno({ type: 'abrirAmbiente', ambiente_id: '102' });
a102.forEach(b => uno({ type: 'verificar', bien_id: b.id, ambiente_id: '102', estado_conserv: 'B', situacion: 'D', obs: 'prueba' }));
uno({ type: 'registrarSobrante', ambiente_id: '102', denominacion: 'SILLA PRUEBA', estado_conserv: 'B', cantidad: 2 });
uno({ type: 'cerrarAmbiente', ambiente_id: '102' });
uno({ type: 'firmarConstancia', ambiente_id: '102' });
check(objetos('AMBIENTES').find(a => a.id === '102').estado === 'CERRADO', 'datos de prueba listos (Aula 102 cerrada, 205 en curso)');

// Foto de los datos base antes del reinicio
const BASE = ['id', 'fuente', 'cod_patrimonial', 'tipo_codigo', 'cod_interno', 'cod_duplicado', 'en_siga', 'denominacion', 'marca', 'modelo', 'serie', 'color', 'dimensiones', 'ambiente_id', 'ambiente_ref', 'responsable_ref', 'estado_ref', 'apto_etiqueta', 'destino_informe'];
const foto = (rows) => rows.map(b => BASE.map(c => b[c]).join('|')).join('\n');
const antesB = foto(objetos('BIENES'));
const AMB_BASE = ['id', 'nombre', 'numero', 'programa', 'ubicacion', 'responsable', 'origen', 'cambio_uso', 'total_esperado', 'aptos_etiqueta'];
const fotoA = (rows) => rows.map(a => AMB_BASE.map(c => a[c]).join('|')).join('\n');
const antesA = fotoA(objetos('AMBIENTES'));
const nHist = hoja('HISTORIAL').length;

// --- Reinicio de datos de prueba ---
const r = gas.reiniciarDatosPrueba('admin-hoja');
console.log('   ' + r.texto.split('\n').slice(0, 3).join(' | '));
const B = objetos('BIENES');
const A = objetos('AMBIENTES');
check(r.total_bienes === 2417 && B.length === 2417, 'total de bienes: 2,417 (no se borró ninguna fila)');
check(r.verificados === 0 && B.every(b => b.estado_verif === 'PENDIENTE'), 'bienes verificados: 0 (todos PENDIENTE)');
const LIMPIAS = ['ambiente_real_id', 'responsable_real', 'estado_conserv', 'foto_url', 'obs_campo', 'verificado_por', 'verificado_en', 'situacion', 'metodo_ubicacion'];
check(B.every(b => LIMPIAS.every(c => !b[c]) && b.etiqueta === 'NO'), 'columnas de verificación limpias (etiqueta = NO)');
check(r.ambientes_pendiente === A.length && A.every(a => a.estado === 'PENDIENTE' && !a.abierto_por && !a.cerrado_por && !a.fecha_cierre && !a.constancia_fecha && !a.constancia_firmante && !a.total_ubicado), 'ambientes en PENDIENTE: ' + r.ambientes_pendiente + ' de ' + A.length + ', sin constancias');
check(foto(B) === antesB, 'códigos, denominaciones, series y demás datos base de BIENES sin cambios');
check(fotoA(A) === antesA, 'datos base de AMBIENTES sin cambios');
check(objetos('SOBRANTES').every(s => s.anulado === 'SI') && hoja('SOBRANTES').length === 3, 'sobrantes de prueba anulados (las filas se conservan)');
const HR = objetos('HISTORIAL').slice(nHist - 1).filter(h => h.accion === 'REINICIO_PRUEBAS');
check(HR.length > 0 && HR.some(h => h.bien_id === a102[0].id && h.campo === 'estado_verif' && h.valor_anterior === 'UBICADO') && HR.every(h => h.usuario === 'admin-hoja' && /Reinicio de datos de prueba/.test(h.motivo)), 'cada valor anterior queda en el HISTORIAL (REINICIO_PRUEBAS, con motivo)');
const gc = api({ action: 'getCambios', token: tI, desde_n: nHist - 1 }).data;
check(gc.bienes.some(f => f[0] === a102[0].id) && gc.ambientes.every(a => a.estado === 'PENDIENTE'), 'los celulares reciben el reinicio al sincronizar');
const r2 = gas.reiniciarDatosPrueba('admin-hoja');
check(r2.bienes_reiniciados === 0 && r2.ambientes_reiniciados === 0, 'volver a ejecutarlo no cambia nada');
check(gas.verificarEstructura().ok, 'verificarEstructura() OK después del reinicio');

fs.unlinkSync(tmp);
console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nSERIE Y REINICIO (servidor): TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

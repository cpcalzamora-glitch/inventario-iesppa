/**
 * Pruebas del almacén del celular (web/js/store.js) en Node, sin navegador.
 * Uso: node prueba-revision-web.mjs
 */
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { hostname: 'localhost' };
globalThis.indexedDB = { open: () => ({}) }; // nunca resuelve: no se guarda nada en esta prueba
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { S, cargarBase, aplicarFilasServidor, aplicarOpLocal } = await import('../../web/js/store.js');
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };

const cols = ['id', 'cod_patrimonial', 'tipo_codigo', 'fuente', 'ambiente_id', 'estado_verif', 'ambiente_real_id', 'cod_duplicado', 'en_siga', 'apto_etiqueta', 'destino_informe', 'etiqueta', 'version', 'denominacion'];
const fila = (o) => cols.map((c) => o[c] ?? '');
cargarBase({
  bienes: {
    columnas: cols,
    filas: [
      fila({ id: '1', cod_patrimonial: '462252150169', tipo_codigo: '12D', fuente: 'INV2024', ambiente_id: '205', estado_verif: 'PENDIENTE', cod_duplicado: 'SI', denominacion: 'ESTABILIZADOR' }),
      fila({ id: '2', cod_patrimonial: '462252150169', tipo_codigo: '12D', fuente: 'INV2024', ambiente_id: '205', estado_verif: 'PENDIENTE', cod_duplicado: 'SI', denominacion: 'ESTABILIZADOR' }),
      fila({ id: '3', cod_patrimonial: '462252150157', tipo_codigo: '12D', fuente: 'SIGA', ambiente_id: 'SIN_UBICAR', estado_verif: 'PENDIENTE', denominacion: 'ESTABILIZADOR' })
    ]
  },
  ambientes: [{ id: '205', nombre: 'LAB 205', estado: 'EN_CURSO' }, { id: 'SIN_UBICAR', nombre: 'SIN UBICAR' }],
  personal: [], config: {}, listas: {}, sobrantes: [], historial_n: 0
});
S.sesion = { usuario: 'hernan', rol: 'ADMIN' };

// 1. El servidor manda una columna que el celular no tenía (conciliado_con): no se corre ni se pierde.
const colsServ = [...cols, 'conciliado_con'];
aplicarFilasServidor([[...fila({ id: '3', cod_patrimonial: '462252150157', tipo_codigo: '12D', fuente: 'SIGA', ambiente_id: 'SIN_UBICAR', estado_verif: 'PENDIENTE', denominacion: 'ESTABILIZADOR' }), '1']], new Set(), colsServ);
check(S.cols.includes('conciliado_con'), 'la columna nueva se agrega a las columnas del celular (se guarda al reiniciar la app)');
check(S.porId.get('3').conciliado_con === '1' && !S.bienes.some((b) => b.id === '3'), 'la fila SIGA conciliada sale de la lista de trabajo');
check(!(S.porCodigo.get('462252150157') || []).length, 'al escanear 462252150157 ya no aparece la fila SIGA');

// 2. Edición local con conciliación: quedan anotados los vecinos para releerlos si el servidor la rechaza.
aplicarFilasServidor([[...fila({ id: '3', cod_patrimonial: '462252150157', tipo_codigo: '12D', fuente: 'SIGA', ambiente_id: 'SIN_UBICAR', estado_verif: 'PENDIENTE', denominacion: 'ESTABILIZADOR' }), '']], new Set(), colsServ);
const op = { type: 'editarBien', bien_id: '1', cambios: { cod_patrimonial: '462252150157' }, conciliar: true, ts: new Date().toISOString() };
aplicarOpLocal(op, 'hernan');
check(S.porId.get('3').conciliado_con === '1' && S.porId.get('1').cod_duplicado === 'NO' && S.porId.get('2').cod_duplicado === 'NO', 'edición local: concilia la fila SIGA y recalcula "dup." del bien y de su ex-duplicado');
check(op.afectados.includes('2') && op.afectados.includes('3'), 'la operación guarda los bienes afectados (' + op.afectados.join(', ') + ') para deshacer si el servidor la rechaza');

// 3. Reiniciar ambiente guarda los bienes afectados.
S.porId.get('2').estado_verif = 'UBICADO'; S.porId.get('2').ambiente_real_id = '205';
const op2 = { type: 'reiniciarAmbiente', ambiente_id: '205', motivo: 'prueba' };
aplicarOpLocal(op2, 'hernan');
check(op2.afectados.length === 1 && op2.afectados[0] === '2' && S.porId.get('2').estado_verif === 'PENDIENTE', 'reiniciar guarda los bienes afectados');

console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nREVISIÓN (celular): TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

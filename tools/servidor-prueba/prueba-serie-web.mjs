/**
 * Pruebas de la búsqueda por serie en el celular (web/js/store.js), con la base real.
 * Uso: node prueba-serie-web.mjs "<ruta a BD_APP_INVENTARIO_IESPPA_2026.xlsx>"
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { hostname: 'localhost' };
globalThis.indexedDB = { open: () => ({}) };

const { S, cargarBase, normalizarSerie, esEquipoPorSerie, buscarPorSerie, esCodigoInterno } = await import('../../web/js/store.js');
let fallos = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };

const wb = XLSX.readFile(process.argv[2]);
const filas = XLSX.utils.sheet_to_json(wb.Sheets.BIENES, { header: 1, defval: '', raw: false });
cargarBase({ bienes: { columnas: filas[0], filas: filas.slice(1) }, ambientes: [], personal: [], config: {}, listas: {}, sobrantes: [], historial_n: 0 });

// Normalización
check(normalizarSerie(' s/ ab-12.34 5 ') === 'AB12345', 'normaliza: mayúsculas, sin espacios, guiones ni puntos, sin "S/"');
check(['S.S.', 'S/S', 'S/N', 'S.S', '', 'A1'].every(x => normalizarSerie(x) === ''), 'S.S., S/S, S/N, vacío o muy corta no cuentan como serie');

// Tipo de bien
check(['UNIDAD CENTRAL DE PROCESO - CPU', 'MONITOR PLANO', 'TECLADO - KEYBOARD', 'ESTABILIZADOR', 'RUTEADOR DE RED - ROUTER', 'PROYECTOR', 'TELEVISOR LED 32 in', 'IMPRESORA LASER'].every(esEquipoPorSerie), 'reconoce equipos de cómputo y eléctricos');
check(!['SILLA FIJA DE MADERA', 'CARPETA DE MADERA UNIPERSONAL', 'ESCRITORIO DE MELAMINA', 'SAXO ALTO', 'ESTEREOSCOPIO', 'GRUPOS DE TRABAJO'].some(esEquipoPorSerie), 'no aplica a muebles ni a otros bienes ("GRUPOS" no se confunde con "UPS")');

// Búsqueda exacta con equipos del Lab. 205
const lab = S.bienes.filter(b => b.ambiente_id === '205' && esEquipoPorSerie(b.denominacion) && normalizarSerie(b.serie));
const ej = lab.find(b => buscarPorSerie(b.serie).length === 1);
console.log(`   Lab. 205: ${lab.length} equipos con serie. Ejemplo: ${ej.denominacion} · serie ${ej.serie} · código ${ej.cod_patrimonial}`);
check(buscarPorSerie(ej.serie)[0] === ej, 'la serie exacta encuentra el equipo');
check(buscarPorSerie(ej.serie.toLowerCase().split('').join(' '))[0] === ej, 'también escrita en minúsculas y con espacios');
check(buscarPorSerie(ej.serie.slice(0, -1)).length === 0 && buscarPorSerie(ej.serie + '9').length === 0, 'nunca coincidencias parciales');
const mueble = S.bienes.find(b => !esEquipoPorSerie(b.denominacion) && normalizarSerie(b.serie) && buscarPorSerie(b.serie).every(x => x !== b));
check(!mueble || buscarPorSerie(mueble.serie).every(x => x !== mueble), 'un bien que no es equipo no se encuentra por serie' + (mueble ? ` (${mueble.denominacion})` : ''));
const repetidas = [...S.porSerie.entries()].filter(([, l]) => l.length > 1);
check(repetidas.every(([s, l]) => buscarPorSerie(s).length === l.length), `series repetidas devuelven todos los bienes para elegir (${repetidas.length} casos)`);
check(esCodigoInterno(S.bienes[0].cod_interno) && !esCodigoInterno('ZZZ-NO-EXISTE'), 'reconoce los códigos internos (no se buscan como serie)');
const sinConc = [...S.porSerie.values()].flat().every(b => !b.conciliado_con);
check(sinConc, 'las filas SIGA conciliadas no entran en la búsqueda por serie');

console.log(fallos ? '\n' + fallos + ' FALLAS' : '\nBÚSQUEDA POR SERIE (celular): TODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);

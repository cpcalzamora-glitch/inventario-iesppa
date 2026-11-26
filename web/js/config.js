// URL del Web App de Apps Script (termina en /exec). La misma URL sirve para todas las versiones.
// En la PC (localhost) se usa el servidor de pruebas.
const PRODUCCION = 'https://script.google.com/macros/s/AKfycbyV4K0AT2Jvh5SqaZf3_1O_-L7KtSasQcznhjj_vwOXV_ZLTEdCqX3OZSdCqbmIDVUW/exec';

export const CONFIG = {
  API_URL: ['localhost', '127.0.0.1'].includes(location.hostname) ? '/api' : PRODUCCION,
  APP_VERSION: '1.4.0',
  LOTE_SYNC: 40,          // operaciones por envío
  REFRESCO_MS: 60000,     // cada cuánto se traen los cambios de los otros celulares
  REINTENTO_MS: 15000     // reintento cuando no hay señal
};

// Búsqueda por número de serie (cuando el código leído no es un código patrimonial ni interno).
// Solo se aplica a bienes cuya denominación contiene alguna de estas palabras (sin tildes, como palabra completa).
// Para agregar o quitar tipos de equipo, edite esta lista.
export const EQUIPOS_POR_SERIE = [
  // Cómputo
  'CPU', 'UNIDAD CENTRAL DE PROCESO', 'COMPUTADORA', 'LAPTOP', 'MONITOR', 'TECLADO', 'MOUSE',
  'IMPRESORA', 'MULTIFUNCIONAL', 'FOTOCOPIADORA', 'COPIADORA', 'ESCANER', 'SCANNER',
  'PROYECTOR', 'PROYECCION', 'DATA DISPLAY', 'PIZARRA DIGITAL', 'SWITCH', 'ROUTER', 'RUTEADOR', 'SERVIDOR',
  // Eléctricos y electrónicos
  'ESTABILIZADOR', 'UPS', 'PARLANTE', 'AMPLIFICADOR', 'EQUIPO DE SONIDO', 'RADIOGRABADORA', 'TELEVISOR',
  'DVD', 'BLU-RAY', 'CAMARA', 'TELEFONO', 'RELOJ MARCADOR', 'GAVETA ELECTRONICA', 'BALANZA DIGITAL',
  'TERMOMETRO DIGITAL', 'OXIMETRO', 'TENSIOMETRO', 'TENCIOMETRO', 'CENTRIFUGA', 'SOPLADORA',
  'ELECTRICO', 'ELECTRICA', 'ELECTRONICO', 'ELECTRONICA'
];

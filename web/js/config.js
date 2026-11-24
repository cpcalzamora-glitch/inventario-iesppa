// URL del Web App de Apps Script (termina en /exec). La misma URL sirve para todas las versiones.
// En la PC (localhost) se usa el servidor de pruebas.
const PRODUCCION = 'https://script.google.com/macros/s/AKfycbyV4K0AT2Jvh5SqaZf3_1O_-L7KtSasQcznhjj_vwOXV_ZLTEdCqX3OZSdCqbmIDVUW/exec';

export const CONFIG = {
  API_URL: ['localhost', '127.0.0.1'].includes(location.hostname) ? '/api' : PRODUCCION,
  APP_VERSION: '1.0.0',
  LOTE_SYNC: 40,          // operaciones por envío
  REFRESCO_MS: 60000,     // cada cuánto se traen los cambios de los otros celulares
  REINTENTO_MS: 15000     // reintento cuando no hay señal
};

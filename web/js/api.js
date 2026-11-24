// Llamadas a la API de Apps Script. POST con text/plain (petición simple, sin preflight CORS).
import { CONFIG } from './config.js';
import { S } from './store.js';

export async function llamar(action, datos = {}, timeout = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: S.sesion && S.sesion.token, ...datos }),
      signal: ctrl.signal,
      redirect: 'follow'
    });
    let j;
    try { j = await r.json(); } catch (e) { throw Object.assign(new Error('Respuesta no válida del servidor.'), { codigo: 'RED' }); }
    if (!j.ok) throw Object.assign(new Error(j.error || 'Error del servidor.'), { codigo: j.codigo || 'SERVIDOR' });
    return j.data;
  } catch (e) {
    if (!e.codigo) e.codigo = 'RED';
    if (e.codigo === 'RED') e.message = 'Sin conexión con el servidor.';
    throw e;
  } finally {
    clearTimeout(t);
  }
}

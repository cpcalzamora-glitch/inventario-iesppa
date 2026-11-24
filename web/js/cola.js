// Cola sin conexión: cada operación se aplica de inmediato en el celular, se guarda en IndexedDB
// y se envía al servidor cuando hay señal. El op_id evita duplicados si se reintenta.
import { CONFIG } from './config.js';
import { llamar } from './api.js';
import { colaPut, colaDel, colaTodas } from './db.js';
import { S, aplicarOpLocal, aplicarBien, aplicarFilasServidor, notificar, guardarLuego, nombreAmbiente } from './store.js';

let seq = 0;
let tReintento = null;
let corriendo = false;
let idsReleer = new Set();
export let alPerderSesion = () => {};
export function setAlPerderSesion(fn) { alPerderSesion = fn; }

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export async function encolar(type, datos) {
  const op = {
    type, op_id: uuid(), seq: Date.now() * 1000 + (seq++ % 1000), ts: new Date().toISOString(),
    usuario: S.sesion.usuario, dispositivo: (navigator.userAgent.match(/\(([^)]+)\)/) || ['', 'web'])[1].slice(0, 60),
    ...datos
  };
  aplicarOpLocal(op, S.sesion.usuario);
  await colaPut(op);
  S.pendientes++;
  notificar();
  sincronizar();
  return op;
}

export async function contarPendientes() {
  S.pendientes = (await colaTodas()).length;
  notificar();
  return S.pendientes;
}

function aviso(texto, tipo = 'alerta', extra = {}) {
  S.avisos.push({ texto, tipo, ts: new Date().toISOString(), ...extra });
  guardarLuego();
}

function procesarResultado(op, r) {
  const d = r.data || {};
  if (r.estado === 'ok' || r.estado === 'duplicada') {
    if (d.bien) aplicarBien(d.bien);
    if (d.bienes) d.bienes.forEach(aplicarBien);
    if (d.ambiente) Object.assign(S.ambientes.find((a) => a.id === d.ambiente.id) || {}, d.ambiente);
    if (d.aviso) aviso((d.bien ? d.bien.denominacion + ' (' + d.bien.cod_patrimonial + '): ' : '') + d.aviso, 'info');
    if (op.type === 'verificarLote' && r.estado === 'ok') {
      op.bien_ids.forEach((id) => { if (!d.marcados.includes(id)) idsReleer.add(id); });
      if (d.sin_reemplazo) aviso(`En ${nombreAmbiente(op.ambiente_id)}: ${d.sin_reemplazo} bien(es) del lote ya habían sido ubicados por otro celular y no quedan más pendientes en ese grupo. Revise el conteo.`);
    }
    if (op.type === 'registrarSobrante') {
      const s = S.sobrantesLocales.find((x) => x.op_id === op.op_id);
      if (s && d.codigos) {
        s.codigos = d.codigos;
        aviso(`Sobrante ${d.denominacion}: código(s) ${d.codigos.join(', ')}. Escríbalos en la etiqueta temporal.`, 'sobrante');
      }
    }
  } else if (r.estado === 'conflicto') {
    const b = d.bien || {};
    aviso(`${b.denominacion || 'Bien'} (${b.cod_patrimonial || op.bien_id}) ya estaba verificado por ${b.verificado_por} en ${nombreAmbiente(b.ambiente_real_id)}. No se movió: si está aquí, escanéelo de nuevo y elija "Mover a este ambiente".`);
    if (d.bien) aplicarBien(d.bien);
  } else {
    aviso(`No se pudo registrar (${op.type}): ${r.error}`);
    if (op.bien_id) idsReleer.add(String(op.bien_id));
    (op.bien_ids || []).forEach((id) => idsReleer.add(String(id)));
    if (op.type === 'registrarSobrante') S.sobrantesLocales = S.sobrantesLocales.filter((x) => x.op_id !== op.op_id);
  }
}

/** Envía la cola al servidor. Se puede llamar muchas veces; solo corre una a la vez. */
export async function sincronizar() {
  if (corriendo || !S.sesion) return;
  corriendo = true;
  S.sincronizando = true;
  notificar();
  clearTimeout(tReintento);
  try {
    for (;;) {
      const ops = await colaTodas();
      S.pendientes = ops.length;
      if (!ops.length) break;
      const lote = ops.slice(0, CONFIG.LOTE_SYNC);
      const res = await llamar('sync', { ops: lote.map(({ seq: _s, usuario: _u, ...o }) => o) });
      S.enLinea = true;
      for (let i = 0; i < lote.length; i++) {
        const r = res.find((x) => x.op_id === lote[i].op_id) || { estado: 'error', error: 'sin respuesta' };
        procesarResultado(lote[i], r);
        await colaDel(lote[i].op_id);
      }
      notificar();
    }
    await refrescar();
  } catch (e) {
    if (e.codigo === 'AUTH') { alPerderSesion(); }
    else { S.enLinea = false; tReintento = setTimeout(sincronizar, CONFIG.REINTENTO_MS); }
  } finally {
    corriendo = false;
    S.sincronizando = false;
    S.pendientes = (await colaTodas()).length;
    guardarLuego();
    notificar();
  }
}

/** Trae lo que cambiaron los otros celulares (y relee bienes con error). */
export async function refrescar() {
  const pend = await colaTodas();
  const ocupados = new Set();
  pend.forEach((op) => { if (op.bien_id) ocupados.add(String(op.bien_id)); (op.bien_ids || []).forEach((id) => ocupados.add(String(id))); });
  const ambOcupados = new Set(pend.filter((o) => /Ambiente/.test(o.type)).map((o) => o.ambiente_id));
  const d = await llamar('getCambios', { desde_n: S.historial_n, ids: [...idsReleer] });
  idsReleer = new Set();
  aplicarFilasServidor(d.bienes, ocupados);
  d.ambientes.forEach((a) => {
    if (ambOcupados.has(a.id)) return;
    const loc = S.ambientes.find((x) => x.id === a.id);
    if (loc) Object.assign(loc, a); else S.ambientes.push(a);
  });
  S.sobrantes = d.sobrantes;
  const conCodigo = new Set(d.sobrantes.map((s) => s.op_id));
  S.sobrantesLocales = S.sobrantesLocales.filter((s) => !conCodigo.has(s.op_id));
  S.historial_n = d.historial_n;
  S.ultimaSync = d.servidor_ts;
  S.enLinea = true;
  guardarLuego();
  notificar();
}

window.addEventListener('online', () => { S.enLinea = true; notificar(); sincronizar(); });
window.addEventListener('offline', () => { S.enLinea = false; notificar(); });

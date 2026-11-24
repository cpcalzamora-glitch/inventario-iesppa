// Estado de la app en memoria + copia en IndexedDB para trabajar sin conexión.
import { kvGet, kvSet } from './db.js';

export const S = {
  sesion: null,          // {token, usuario, nombre, rol, vence}
  cols: [],
  bienes: [],            // objetos
  porId: new Map(),
  porCodigo: new Map(),  // cod_patrimonial -> [bienes]
  ambientes: [],
  personal: [],
  config: {},
  listas: {},
  sobrantes: [],         // del servidor
  sobrantesLocales: [],  // registrados en este celular y aún sin código S-xxx
  historial_n: 0,
  ambienteActivo: '',
  avisos: [],
  pendientes: 0,
  enLinea: navigator.onLine,
  sincronizando: false,
  ultimaSync: ''
};

const oyentes = new Set();
export function suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }
export function notificar() { oyentes.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

/** Clave de agrupación para la vista por lote. Idéntica a grupoClave_() del Apps Script. */
export function grupoClave(b) {
  const tipo = b.tipo_codigo === 'ALTA' ? 'ALTA' : 'LOTE';
  return [tipo, b.denominacion, b.marca, b.modelo, b.color, b.dimensiones]
    .map((v) => String(v || '').trim().toUpperCase()).join('|');
}

function indexar() {
  S.porId = new Map();
  S.porCodigo = new Map();
  for (const b of S.bienes) {
    S.porId.set(b.id, b);
    const c = String(b.cod_patrimonial || '').trim();
    if (c) {
      if (!S.porCodigo.has(c)) S.porCodigo.set(c, []);
      S.porCodigo.get(c).push(b);
    }
  }
}

export function cargarBase(d) {
  S.cols = d.bienes.columnas;
  S.bienes = d.bienes.filas.map((f) => Object.fromEntries(S.cols.map((c, i) => [c, String(f[i] ?? '')])));
  S.ambientes = d.ambientes;
  S.personal = d.personal || [];
  S.config = d.config || {};
  S.listas = d.listas || {};
  S.sobrantes = d.sobrantes || [];
  S.historial_n = d.historial_n || 0;
  S.ultimaSync = d.servidor_ts || '';
  indexar();
  guardarLuego();
}

/** Aplica filas de bienes que vienen del servidor (getCambios). */
export function aplicarFilasServidor(filas, omitir = new Set()) {
  for (const f of filas) {
    const o = Object.fromEntries(S.cols.map((c, i) => [c, String(f[i] ?? '')]));
    if (omitir.has(o.id)) continue;
    aplicarBien(o);
  }
}

export function aplicarBien(o) {
  const b = S.porId.get(String(o.id));
  if (b) Object.assign(b, o);
}

export function ambiente(id) { return S.ambientes.find((a) => a.id === id); }

let tGuardar = null;
export function guardarLuego() {
  clearTimeout(tGuardar);
  tGuardar = setTimeout(guardarYa, 800);
}
export async function guardarYa() {
  clearTimeout(tGuardar);
  if (!S.cols.length) return;
  await kvSet('base', {
    cols: S.cols,
    filas: S.bienes.map((b) => S.cols.map((c) => b[c])),
    ambientes: S.ambientes, personal: S.personal, config: S.config, listas: S.listas,
    sobrantes: S.sobrantes, sobrantesLocales: S.sobrantesLocales, historial_n: S.historial_n,
    ultimaSync: S.ultimaSync, avisos: S.avisos.slice(-50)
  });
}

export async function leerBaseLocal() {
  const d = await kvGet('base');
  if (!d) return false;
  S.cols = d.cols;
  S.bienes = d.filas.map((f) => Object.fromEntries(S.cols.map((c, i) => [c, f[i]])));
  S.ambientes = d.ambientes; S.personal = d.personal; S.config = d.config; S.listas = d.listas;
  S.sobrantes = d.sobrantes || []; S.sobrantesLocales = d.sobrantesLocales || [];
  S.historial_n = d.historial_n || 0; S.ultimaSync = d.ultimaSync || ''; S.avisos = d.avisos || [];
  indexar();
  return true;
}

export const REFERIDO = 'REFERIDO_ENTREGADO_SIN_BAJA';

export function ahoraISO() { return new Date().toISOString(); }

/* ----- Aplicación optimista de operaciones (igual que en el servidor) ----- */

export function aplicarOpLocal(op, usuario) {
  if (op.type === 'verificar') verificarLocal(op.bien_id, op, usuario);
  else if (op.type === 'verificarLote') op.bien_ids.forEach((id) => verificarLocal(id, op, usuario));
  else if (op.type === 'abrirAmbiente') { const a = ambiente(op.ambiente_id); if (a && a.estado !== 'EN_CURSO') { a.estado = 'EN_CURSO'; a.constancia_estado = 'PENDIENTE'; if (!a.abierto_por) a.abierto_por = usuario; } }
  // Cierre en dos pasos: la constancia se imprime (IMPRESA) y el ambiente se cierra al marcarla FIRMADA.
  else if (op.type === 'cerrarAmbiente') { const a = ambiente(op.ambiente_id); if (a) { a.constancia_estado = 'IMPRESA'; a.constancia_fecha = op.ts; } }
  else if (op.type === 'firmarConstancia') { const a = ambiente(op.ambiente_id); if (a) { a.constancia_estado = 'FIRMADA'; a.constancia_firmante = op.firmante || a.responsable; a.estado = 'CERRADO'; a.cerrado_por = usuario; a.fecha_cierre = op.ts; } }
  else if (op.type === 'editarResponsableAmbiente') { const a = ambiente(op.ambiente_id); if (a) a.responsable = op.responsable; }
  else if (op.type === 'registrarSobrante') { S.sobrantesLocales.push({ op_id: op.op_id, ...op, codigos: null }); constanciaDesactualizada(op.ambiente_id); }
  guardarLuego();
}

/** Si la constancia ya estaba impresa y cambia lo verificado, hay que generarla de nuevo (igual que el servidor). */
function constanciaDesactualizada(ambId) {
  const a = ambiente(ambId);
  if (a && a.constancia_estado === 'IMPRESA') a.constancia_estado = 'PENDIENTE';
}

function verificarLocal(id, op, usuario) {
  const b = S.porId.get(String(id));
  if (!b) return;
  const a = ambiente(op.ambiente_id) || {};
  constanciaDesactualizada(op.ambiente_id);
  if (b.estado_verif === 'UBICADO' && b.ambiente_real_id && b.ambiente_real_id !== op.ambiente_id) constanciaDesactualizada(b.ambiente_real_id);
  Object.assign(b, {
    estado_verif: 'UBICADO',
    ambiente_real_id: op.ambiente_id,
    responsable_real: op.responsable || a.responsable || '',
    estado_conserv: op.estado_conserv,
    situacion: op.situacion || 'U',
    etiqueta: b.tipo_codigo === '12D' ? 'DEFINITIVA' : 'TEMPORAL',
    verificado_por: usuario,
    verificado_en: op.ts,
    version: String(Number(b.version || 0) + 1)
  });
  if (op.obs) b.obs_campo = op.obs;
  if (b.situacion_especial === REFERIDO) b.situacion_especial = ''; // apareció: se quita la marca
}

/* ----- Consultas ----- */

export function resumenAmbiente(id) {
  let esperados = 0, ubicadosEsperados = 0, ubicadosAqui = 0, aptos = 0, deOtros = 0;
  for (const b of S.bienes) {
    if (b.ambiente_id === id) {
      esperados++;
      if (b.estado_verif === 'UBICADO') ubicadosEsperados++;
      if (b.apto_etiqueta === 'SI') aptos++;
    }
    if (b.estado_verif === 'UBICADO' && b.ambiente_real_id === id) {
      ubicadosAqui++;
      if (b.ambiente_id !== id) deOtros++;
    }
  }
  return { esperados, ubicadosEsperados, ubicadosAqui, aptos, deOtros };
}

export function nombreAmbiente(id) {
  const a = ambiente(id);
  return a ? a.nombre : id || '—';
}

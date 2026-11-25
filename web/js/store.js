// Estado de la app en memoria + copia en IndexedDB para trabajar sin conexión.
import { kvGet, kvSet } from './db.js';

export const S = {
  sesion: null,          // {token, usuario, nombre, rol, vence}
  cols: [],
  todos: [],             // todas las filas de BIENES (incluye las filas SIGA conciliadas)
  bienes: [],            // filas vigentes (sin las conciliadas): es lo que usa la app
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

export function indexar() {
  S.porId = new Map();
  S.porCodigo = new Map();
  for (const b of S.todos) S.porId.set(b.id, b);
  S.bienes = S.todos.filter((b) => !b.conciliado_con);
  for (const b of S.bienes) {
    const c = String(b.cod_patrimonial || '').trim();
    if (c) {
      if (!S.porCodigo.has(c)) S.porCodigo.set(c, []);
      S.porCodigo.get(c).push(b);
    }
  }
}

export function cargarBase(d) {
  S.cols = d.bienes.columnas;
  S.todos = d.bienes.filas.map((f) => Object.fromEntries(S.cols.map((c, i) => [c, String(f[i] ?? '')])));
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
export function aplicarFilasServidor(filas, omitir = new Set(), columnas = null) {
  // Las filas se leen con las columnas que manda el servidor: si BIENES ganó columnas, no se pierden ni se corren.
  const cols = columnas || S.cols;
  let reindexar = false;
  for (const f of filas) {
    const o = Object.fromEntries(cols.map((c, i) => [c, String(f[i] ?? '')]).filter(([c]) => c));
    if (omitir.has(o.id)) continue;
    reindexar = aplicarBien(o, false) || reindexar;
  }
  if (reindexar) indexar();
}

/** Aplica un bien del servidor. Devuelve true si cambió algo que obliga a reindexar. */
export function aplicarBien(o, indexarYa = true) {
  const b = S.porId.get(String(o.id));
  if (!b) return false;
  for (const k of Object.keys(o)) if (k && !S.cols.includes(k)) S.cols.push(k); // columna nueva: se guarda también en el celular
  const reindexar = (o.cod_patrimonial !== undefined && o.cod_patrimonial !== b.cod_patrimonial) || (o.conciliado_con !== undefined && (o.conciliado_con || '') !== (b.conciliado_con || ''));
  Object.assign(b, o);
  if (reindexar && indexarYa) indexar();
  return reindexar;
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
    filas: S.todos.map((b) => S.cols.map((c) => b[c])),
    ambientes: S.ambientes, personal: S.personal, config: S.config, listas: S.listas,
    sobrantes: S.sobrantes, sobrantesLocales: S.sobrantesLocales, historial_n: S.historial_n,
    ultimaSync: S.ultimaSync, avisos: S.avisos.slice(-50)
  });
}

export async function leerBaseLocal() {
  const d = await kvGet('base');
  if (!d) return false;
  S.cols = d.cols;
  S.todos = d.filas.map((f) => Object.fromEntries(S.cols.map((c, i) => [c, f[i] ?? ''])));
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
  // v4: corregir sin borrar (el servidor deja el valor anterior en el HISTORIAL)
  else if (op.type === 'anularVerificacion') { const b = S.porId.get(String(op.bien_id)); if (b) { constanciaDesactualizada(b.ambiente_real_id); anularLocal(b); } }
  else if (op.type === 'anularSobrante') { const s = S.sobrantes.find((x) => x.cod_sobrante === op.cod_sobrante); if (s) { s.anulado = 'SI'; constanciaDesactualizada(s.ambiente_id); } }
  else if (op.type === 'reiniciarAmbiente') {
    op.afectados = [];
    S.bienes.forEach((b) => { if (b.ambiente_real_id === op.ambiente_id && (b.estado_verif === 'UBICADO' || b.estado_verif === 'OBSERVADO')) { op.afectados.push(b.id); anularLocal(b); } });
    S.sobrantes.forEach((s) => { if (s.ambiente_id === op.ambiente_id) s.anulado = 'SI'; });
    const a = ambiente(op.ambiente_id);
    if (a) Object.assign(a, { estado: 'PENDIENTE', total_ubicado: '0', abierto_por: '', cerrado_por: '', fecha_cierre: '', constancia_estado: 'PENDIENTE', constancia_firmante: '', constancia_fecha: '' });
  }
  else if (op.type === 'editarBien') editarLocal(op);
  guardarLuego();
}

function anularLocal(b) {
  Object.assign(b, {
    estado_verif: 'PENDIENTE', ambiente_real_id: '', responsable_real: '', estado_conserv: '', etiqueta: 'NO',
    obs_campo: '', situacion: '', verificado_por: '', verificado_en: '', version: String(Number(b.version || 0) + 1)
  });
}

/** Sobrantes vigentes de un ambiente (sin los anulados). */
export function sobrantesDe(ambId) {
  return S.sobrantes.filter((s) => s.ambiente_id === ambId && s.anulado !== 'SI');
}

export function esAdmin() { return String(S.sesion?.rol || '').toUpperCase() === 'ADMIN'; }

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

/* ----- v4 Fase 2: ficha editable (mismas reglas que ficha.gs) ----- */

export const CAMPOS_FICHA = ['cod_patrimonial', 'tipo_codigo', 'serie', 'marca', 'modelo', 'denominacion', 'ambiente_real_id', 'obs_campo'];

export function normalizarCampo(k, v) {
  v = String(v ?? '').trim();
  if (k === 'cod_patrimonial') return v.replace(/\s+/g, '');
  if (k === 'obs_campo' || k === 'ambiente_real_id') return v;
  return v.toUpperCase();
}

/** Error de validación del código o '' si está bien. */
export function errorCodigo(cod, tipo) {
  if (!['12D', '8D', 'ALTA', 'SIN'].includes(tipo)) return 'Tipo de código no válido.';
  if (tipo === '12D' && !/^\d{12}$/.test(cod)) return `Un código 12D debe tener exactamente 12 dígitos numéricos (tiene ${cod.length}).`;
  if (tipo === '8D' && !/^\d{8}$/.test(cod)) return `Un código 8D debe tener exactamente 8 dígitos numéricos (tiene ${cod.length}).`;
  if (tipo === 'ALTA' && /^\d+$/.test(cod) && cod.length !== 8 && cod.length !== 12) return `Los códigos numéricos solo tienen 8 o 12 dígitos (este tiene ${cod.length}).`;
  return '';
}

/** Otros bienes vigentes con ese código y si todos son filas SIGA sin ubicar pendientes (se pueden conciliar). */
export function otrosConCodigo(cod, id) {
  const otros = cod ? (S.porCodigo.get(cod) || []).filter((x) => x.id !== id) : [];
  const conciliables = otros.length > 0 && otros.every((x) => x.fuente === 'SIGA' && x.ambiente_id === 'SIN_UBICAR' && x.estado_verif === 'PENDIENTE');
  return { otros, conciliables };
}

function editarLocal(op) {
  const b = S.porId.get(String(op.bien_id));
  if (!b) return;
  const antes = { ...b };
  for (const [k, v] of Object.entries(op.cambios || {})) b[k] = normalizarCampo(k, v);
  if ((op.cambios || {}).ambiente_real_id) b.responsable_real = (ambiente(b.ambiente_real_id) || {}).responsable || '';
  b.version = String(Number(b.version || 0) + 1);
  const codigos = new Set([antes.cod_patrimonial, b.cod_patrimonial].filter(Boolean));
  // Vecinos que se recalculan aquí: si el servidor rechaza la edición, se releen (ver cola.js).
  op.afectados = S.todos.filter((x) => x !== b && codigos.has(x.cod_patrimonial)).map((x) => x.id);
  const cambiaCod = antes.cod_patrimonial !== b.cod_patrimonial || antes.tipo_codigo !== b.tipo_codigo;
  for (const x of S.todos) {
    if (x === b) continue;
    if (op.conciliar && x.cod_patrimonial === b.cod_patrimonial && !x.conciliado_con && x.fuente === 'SIGA' && x.estado_verif === 'PENDIENTE') Object.assign(x, { conciliado_con: b.id, cod_duplicado: 'NO', apto_etiqueta: 'NO' });
    else if (x.conciliado_con === b.id && x.cod_patrimonial === antes.cod_patrimonial && antes.cod_patrimonial !== b.cod_patrimonial) x.conciliado_con = '';
  }
  const n = {};
  for (const x of S.todos) if (x.tipo_codigo === '12D' && x.cod_patrimonial && !x.conciliado_con) n[x.cod_patrimonial] = (n[x.cod_patrimonial] || 0) + 1;
  for (const x of S.todos) {
    if (x.conciliado_con || (x !== b && !(cambiaCod && codigos.has(x.cod_patrimonial)))) continue;
    const es12 = x.tipo_codigo === '12D';
    const verif = x.estado_verif === 'UBICADO' || x.estado_verif === 'OBSERVADO';
    const ref = ambiente(x.ambiente_id);
    x.cod_duplicado = es12 && n[x.cod_patrimonial] > 1 ? 'SI' : 'NO';
    x.en_siga = !es12 ? 'NO' : (x === b && cambiaCod ? 'SI' : (x.en_siga || 'SI'));
    x.apto_etiqueta = es12 && x.cod_duplicado === 'NO' && (verif || (x.ambiente_id !== 'SIN_UBICAR' && ref && !ref.cambio_uso)) ? 'SI' : 'NO';
    x.destino_informe = es12 ? 'DREP+INTERNO' : 'INTERNO';
    if (verif) x.etiqueta = es12 ? 'DEFINITIVA' : 'TEMPORAL';
  }
  if (antes.ambiente_real_id) constanciaDesactualizada(antes.ambiente_real_id);
  if (b.ambiente_real_id) constanciaDesactualizada(b.ambiente_real_id);
  indexar();
}

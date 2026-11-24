/**
 * Operaciones de escritura (Fase 1). Todas pasan por procesarOps_():
 *  - un solo LockService para todo el lote de operaciones,
 *  - cada operación lleva op_id (UUID): si ya figura en HISTORIAL o SOBRANTES, no se repite,
 *  - nunca se borran filas; todo cambio se registra en HISTORIAL.
 */

var ESTADOS_CONSERV = ['B', 'R', 'M', 'CH', 'RAEE'];
var SITUACIONES = ['U', 'D']; // Uso / Desuso (columna SITUAC. de la constancia)
var REFERIDO = 'REFERIDO_ENTREGADO_SIN_BAJA';
var COLS_VERIF = ['estado_verif', 'ambiente_real_id', 'responsable_real', 'estado_conserv', 'etiqueta',
  'foto_url', 'obs_campo', 'verificado_por', 'verificado_en', 'version'];
// Columnas agregadas en la v3 que también escribe la app (contiguas al final de BIENES).
var COLS_VERIF_V3 = ['situacion_especial', 'ref_declaracion', 'situacion'];

var OPERACIONES = {
  abrirAmbiente: opAbrirAmbiente_,
  verificar: opVerificar_,
  verificarLote: opVerificarLote_,
  registrarSobrante: opRegistrarSobrante_,
  editarResponsableAmbiente: opEditarResponsableAmbiente_,
  cerrarAmbiente: opCerrarAmbiente_,
  firmarConstancia: opFirmarConstancia_
};

/** Clave de agrupación para la vista por lote. Debe ser idéntica a grupoClave() del frontend. */
function grupoClave_(b) {
  var tipo = b.tipo_codigo === 'ALTA' ? 'ALTA' : 'LOTE';
  return [tipo, b.denominacion, b.marca, b.modelo, b.color, b.dimensiones]
    .map(function (v) { return String(v || '').trim().toUpperCase(); }).join('|');
}

function procesarOps_(ops, sesion) {
  if (!ops || !ops.length) return [];
  if (ops.length > 200) throw new Error('Demasiadas operaciones en un envío (máx. 200).');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ctx = cargarContexto_(sesion);
    var res = ops.map(function (op) {
      var r = { op_id: op && op.op_id, type: op && op.type };
      try {
        if (!op || !op.op_id) throw new Error('Operación sin op_id.');
        var fn = OPERACIONES[op.type];
        if (!fn) throw new Error('Operación desconocida: ' + op.type);
        if (ctx.opsVistas[op.op_id]) { r.estado = 'duplicada'; return r; }
        r.data = fn(ctx, op);
        r.estado = r.data && r.data.conflicto ? 'conflicto' : 'ok';
        ctx.opsVistas[op.op_id] = true;
      } catch (e) {
        r.estado = 'error';
        r.error = String(e.message || e);
      }
      return r;
    });
    guardarContexto_(ctx);
    return res;
  } finally {
    lock.releaseLock();
  }
}

function cargarContexto_(sesion) {
  var B = leerTabla_('BIENES');
  var A = leerTabla_('AMBIENTES');
  var porId = {};
  B.rows.forEach(function (r, i) { porId[r[B.idx.id]] = i; });
  var ambPorId = {};
  A.rows.forEach(function (r, i) { ambPorId[r[A.idx.id]] = i; });
  var vistas = {};
  leerColumna_('HISTORIAL', 'op_id').forEach(function (v) { if (v) vistas[v] = true; });
  leerColumna_('SOBRANTES', 'op_id').forEach(function (v) { if (v) vistas[v] = true; });
  return {
    sesion: sesion, B: B, A: A, porId: porId, ambPorId: ambPorId, opsVistas: vistas,
    bienesSucios: {}, ambSucios: {}, hist: [], sobrantes: [], config: null
  };
}

function leerColumna_(hoja, col) {
  var sh = hoja_(hoja);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var c = header.indexOf(col);
  if (c < 0) return [];
  return sh.getRange(2, c + 1, n - 1, 1).getValues().map(function (r) { return String(r[0]); });
}

function guardarContexto_(ctx) {
  // Bienes: se escriben solo las columnas que llena la app, por tramos de filas contiguas.
  var filas = Object.keys(ctx.bienesSucios).map(Number).sort(function (a, b) { return a - b; });
  escribirTramos_(ctx, filas, COLS_VERIF);
  escribirTramos_(ctx, filas, COLS_VERIF_V3);
  Object.keys(ctx.ambSucios).forEach(function (k) {
    var n = Number(k);
    var fila = ctx.A.rows[n];
    ctx.A.sh.getRange(n + 2, 1, 1, ctx.A.header.length).setValues([fila.slice(0, ctx.A.header.length)]);
  });
  agregarFilas_('SOBRANTES', ctx.sobrantes);
  agregarFilas_('HISTORIAL', ctx.hist);
  if (ctx.config) {
    var t = leerTabla_('CONFIG');
    t.rows.forEach(function (r, idx) {
      if (r[0] === 'correlativo_sobrante') t.sh.getRange(idx + 2, 2).setValue(String(ctx.config.correlativo_sobrante));
    });
  }
}

/** Escribe un grupo de columnas contiguas de BIENES, por tramos de filas contiguas. */
function escribirTramos_(ctx, filas, cols) {
  if (!filas.length) return;
  var c0 = ctx.B.idx[cols[0]];
  var c1 = ctx.B.idx[cols[cols.length - 1]];
  if (c0 === undefined || c1 === undefined || c1 - c0 !== cols.length - 1) {
    throw new Error('Faltan o están desordenadas las columnas ' + cols.join(', ') + ' en BIENES. Ejecute "Actualizar estructura a la v3".');
  }
  var i = 0;
  while (i < filas.length) {
    var j = i;
    while (j + 1 < filas.length && filas[j + 1] === filas[j] + 1) j++;
    var bloque = [];
    for (var k = filas[i]; k <= filas[j]; k++) bloque.push(ctx.B.rows[k].slice(c0, c1 + 1));
    ctx.B.sh.getRange(filas[i] + 2, c0 + 1, bloque.length, c1 - c0 + 1).setValues(bloque);
    i = j + 1;
  }
}

/** Agrega filas (objetos) al final de una hoja, respetando el orden de su encabezado. */
function agregarFilas_(hoja, objetos) {
  if (!objetos.length) return;
  var sh = hoja_(hoja);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var data = objetos.map(function (o) { return header.map(function (h) { return o[h] === undefined ? '' : String(o[h]); }); });
  var r0 = sh.getLastRow() + 1;
  var rango = sh.getRange(r0, 1, data.length, header.length);
  rango.setNumberFormat('@');
  rango.setValues(data);
}

/* ---------------- utilidades de contexto ---------------- */

function bienObj_(ctx, i) {
  var o = {};
  ctx.B.header.forEach(function (h, k) { if (h) o[h] = ctx.B.rows[i][k]; });
  return o;
}

function setBien_(ctx, i, campos, op, accion) {
  var row = ctx.B.rows[i];
  while (row.length < ctx.B.header.length) row.push('');
  var id = row[ctx.B.idx.id];
  Object.keys(campos).forEach(function (c) {
    var k = ctx.B.idx[c];
    var nuevo = String(campos[c]);
    if (row[k] === nuevo) return;
    if (c !== 'version' && c !== 'verificado_en' && c !== 'verificado_por') {
      histRow_(ctx, op, id, accion, c, row[k], nuevo);
    }
    row[k] = nuevo;
  });
  ctx.bienesSucios[i] = true;
}

function ambObj_(ctx, id) {
  var i = ctx.ambPorId[id];
  if (i === undefined) throw new Error('Ambiente desconocido: ' + id);
  var o = { _i: i };
  ctx.A.header.forEach(function (h, k) { if (h) o[h] = ctx.A.rows[i][k]; });
  return o;
}

function setAmb_(ctx, id, campos, op, accion) {
  var i = ctx.ambPorId[id];
  var row = ctx.A.rows[i];
  while (row.length < ctx.A.header.length) row.push('');
  Object.keys(campos).forEach(function (c) {
    var k = ctx.A.idx[c];
    var nuevo = String(campos[c]);
    if (row[k] === nuevo) return;
    histRow_(ctx, op, '', accion, 'ambiente.' + c, row[k], nuevo, id);
    row[k] = nuevo;
  });
  ctx.ambSucios[i] = true;
}

function histRow_(ctx, op, bienId, accion, campo, ant, nuevo, ambienteId) {
  ctx.hist.push({
    fecha_hora: ahora_(), usuario: ctx.sesion.usuario, op_id: op.op_id, bien_id: bienId, accion: accion,
    campo: campo, valor_anterior: ant, valor_nuevo: nuevo, ambiente_id: ambienteId || op.ambiente_id || '',
    dispositivo: String(op.dispositivo || '').slice(0, 80)
  });
}

function tsOp_(op) {
  // Hora del celular (si es razonable); si no, la del servidor.
  if (op.ts && /^\d{4}-\d\d-\d\dT/.test(op.ts)) {
    var d = new Date(op.ts);
    if (!isNaN(d) && Math.abs(Date.now() - d.getTime()) < 15 * 86400000) {
      return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
  }
  return ahora_();
}

function exigirAmbienteAbierto_(amb) {
  if (amb.id === 'SIN_UBICAR') throw new Error('No se puede verificar en el ambiente virtual SIN UBICAR.');
  if (amb.estado === 'CERRADO') throw new Error('El ambiente ' + amb.nombre + ' está cerrado. Ábralo de nuevo para seguir.');
}

function situacionValida_(s) {
  s = String(s || 'U').toUpperCase();
  if (SITUACIONES.indexOf(s) < 0) throw new Error('Situación no válida: ' + s + ' (U = uso, D = desuso).');
  return s;
}

/**
 * Si el ambiente ya tenía la constancia impresa (sin firmar) y cambia lo verificado en él,
 * la constancia queda desactualizada: vuelve a PENDIENTE y hay que generarla de nuevo.
 */
function invalidarConstancia_(ctx, ambId, op) {
  if (!ambId || ctx.ambPorId[ambId] === undefined) return '';
  var a = ambObj_(ctx, ambId);
  if (a.constancia_estado === 'IMPRESA') {
    setAmb_(ctx, ambId, { constancia_estado: 'PENDIENTE' }, op, 'EDITAR');
    return 'La constancia impresa de ' + a.nombre + ' quedó desactualizada: vuelva a generarla antes de firmar.';
  }
  if (a.estado === 'CERRADO') return 'Atención: ' + a.nombre + ' ya estaba cerrado con constancia firmada; revise ese ambiente.';
  return '';
}

function estadoValido_(e) {
  e = String(e || '').toUpperCase();
  if (ESTADOS_CONSERV.indexOf(e) < 0) throw new Error('Estado de conservación no válido: ' + e);
  return e;
}

/* ---------------- operaciones ---------------- */

function opAbrirAmbiente_(ctx, op) {
  var amb = ambObj_(ctx, op.ambiente_id);
  if (amb.id === 'SIN_UBICAR') throw new Error('SIN UBICAR es un ambiente virtual.');
  if (amb.estado !== 'EN_CURSO') {
    var c = { estado: 'EN_CURSO' };
    if (!amb.abierto_por) c.abierto_por = ctx.sesion.usuario;
    // Al abrir (o reabrir) la constancia queda por generar; la firmada anterior sigue en el HISTORIAL.
    c.constancia_estado = 'PENDIENTE';
    setAmb_(ctx, amb.id, c, op, 'ABRIR_AMBIENTE');
  }
  return { ambiente: ambObj_(ctx, amb.id) };
}

function opEditarResponsableAmbiente_(ctx, op) {
  var amb = ambObj_(ctx, op.ambiente_id);
  var resp = String(op.responsable || '').trim();
  if (!resp) throw new Error('Indique el responsable.');
  setAmb_(ctx, amb.id, { responsable: resp }, op, 'EDITAR');
  return { ambiente: ambObj_(ctx, amb.id) };
}

/**
 * Verifica un bien en el ambiente activo.
 * op: {bien_id, ambiente_id, estado_conserv, responsable?, obs?, mover?, version_cliente?, ts?}
 */
function opVerificar_(ctx, op) {
  var i = ctx.porId[String(op.bien_id)];
  if (i === undefined) throw new Error('No existe el bien ' + op.bien_id);
  var amb = ambObj_(ctx, op.ambiente_id);
  exigirAmbienteAbierto_(amb);
  return verificarFila_(ctx, i, amb, op, false);
}

function verificarFila_(ctx, i, amb, op, enLote) {
  var b = bienObj_(ctx, i);
  var estado = estadoValido_(op.estado_conserv || b.estado_ref || 'B');
  if (b.estado_verif === 'UBICADO' && b.ambiente_real_id && b.ambiente_real_id !== amb.id && !op.mover) {
    return { conflicto: 'YA_VERIFICADO', bien: b };
  }
  var aviso = '';
  var vCli = Number(op.version_cliente);
  if (!isNaN(vCli) && op.version_cliente !== undefined && Number(b.version || 0) > vCli) {
    aviso = 'Otro usuario modificó este bien antes (se aplicó su cambio, que es el último).';
    histRow_(ctx, op, b.id, 'EDITAR', 'CONFLICTO_VERSION', String(b.version), String(vCli));
  }
  var mover = b.estado_verif === 'UBICADO' && b.ambiente_real_id && b.ambiente_real_id !== amb.id;
  var avisos = aviso ? [aviso] : [];
  var situacion = situacionValida_(op.situacion);
  // Bien referido como entregado sin baja (2c) que apareció físicamente: se quita la marca, con historial.
  if (b.situacion_especial === REFERIDO) {
    setBien_(ctx, i, { situacion_especial: '' }, op, 'QUITAR_REFERIDO');
    avisos.push('Este bien estaba referido como entregado sin baja' + (b.ref_declaracion ? ' (declaración ' + b.ref_declaracion + ')' : '') + '. Apareció: se quitó la marca.');
  }
  var campos = {
    estado_verif: 'UBICADO',
    ambiente_real_id: amb.id,
    responsable_real: String(op.responsable || amb.responsable || ''),
    estado_conserv: estado,
    situacion: situacion,
    // Regla 1: etiqueta definitiva solo para 12 dígitos; todo lo demás, temporal.
    etiqueta: b.tipo_codigo === '12D' ? 'DEFINITIVA' : 'TEMPORAL',
    verificado_por: ctx.sesion.usuario,
    verificado_en: tsOp_(op),
    version: String(Number(b.version || 0) + 1)
  };
  if (op.obs !== undefined && String(op.obs).trim() !== '') campos.obs_campo = String(op.obs).trim();
  setBien_(ctx, i, campos, op, mover ? 'MOVER' : (enLote ? 'VERIFICAR_LOTE' : 'VERIFICAR'));
  [amb.id, mover ? b.ambiente_real_id : ''].forEach(function (id) {
    var t = invalidarConstancia_(ctx, id, op);
    if (t && avisos.indexOf(t) < 0) avisos.push(t);
  });
  var r = { bien: bienObj_(ctx, i) };
  if (avisos.length) r.aviso = avisos.join(' ');
  return r;
}

/**
 * Verificación por lote (8D y altas). op: {ambiente_id, bien_ids[], estado_conserv, responsable?, ts?}
 * Si un bien elegido ya fue ubicado por otro celular, se toma otro pendiente del mismo grupo y ambiente.
 */
function opVerificarLote_(ctx, op) {
  var amb = ambObj_(ctx, op.ambiente_id);
  exigirAmbienteAbierto_(amb);
  situacionValida_(op.situacion);
  var ids = (op.bien_ids || []).map(String);
  if (!ids.length) throw new Error('No hay bienes en el lote.');
  var usados = {};
  var marcados = [];
  var reemplazos = 0;
  var faltan = 0;
  var avisos = [];
  var anotar = function (r) { if (r && r.aviso && avisos.indexOf(r.aviso) < 0) avisos.push(r.aviso); };
  ids.forEach(function (id) {
    var i = ctx.porId[id];
    if (i === undefined) { faltan++; return; }
    var b = bienObj_(ctx, i);
    if (b.tipo_codigo === '12D') throw new Error('El bien ' + id + ' tiene código de 12 dígitos: se verifica escaneando.');
    if (b.estado_verif !== 'UBICADO' && !usados[id]) {
      usados[id] = true;
      anotar(verificarFila_(ctx, i, amb, op, true));
      marcados.push(id);
      return;
    }
    // Buscar reemplazo: otro pendiente del mismo grupo en el mismo ambiente de referencia.
    var clave = grupoClave_(b);
    var alt = -1;
    for (var k = 0; k < ctx.B.rows.length; k++) {
      var bk = bienObj_(ctx, k);
      if (bk.ambiente_id === b.ambiente_id && bk.estado_verif !== 'UBICADO' && !usados[bk.id] &&
          ids.indexOf(bk.id) < 0 && grupoClave_(bk) === clave) { alt = k; break; }
    }
    if (alt < 0) { faltan++; return; }
    var altId = ctx.B.rows[alt][ctx.B.idx.id];
    usados[altId] = true;
    anotar(verificarFila_(ctx, alt, amb, op, true));
    marcados.push(altId);
    reemplazos++;
  });
  return {
    aviso: avisos.join(' ') || undefined,
    marcados: marcados, reemplazos: reemplazos, sin_reemplazo: faltan,
    bienes: marcados.map(function (id) { return bienObj_(ctx, ctx.porId[id]); })
  };
}

/**
 * Sobrantes: se registran solo en la hoja SOBRANTES (inventario aparte), un código S-xxx por unidad.
 * op: {ambiente_id, denominacion, marca, modelo, serie, color, dimensiones, estado_conserv, cantidad, obs, ts?}
 */
function opRegistrarSobrante_(ctx, op) {
  var amb = ambObj_(ctx, op.ambiente_id);
  exigirAmbienteAbierto_(amb);
  var den = String(op.denominacion || '').trim().toUpperCase();
  if (!den) throw new Error('Indique la denominación del sobrante.');
  var estado = estadoValido_(op.estado_conserv);
  var cant = Math.floor(Number(op.cantidad || 1));
  if (!(cant >= 1 && cant <= 100)) throw new Error('La cantidad debe estar entre 1 y 100.');
  if (!ctx.config) ctx.config = leerConfig_();
  var n = Number(ctx.config.correlativo_sobrante || 0);
  var codigos = [];
  var ts = tsOp_(op);
  for (var k = 0; k < cant; k++) {
    n++;
    var cod = 'S-' + ('00' + n).slice(-Math.max(3, String(n).length));
    codigos.push(cod);
    ctx.sobrantes.push({
      cod_sobrante: cod, denominacion: den, marca: op.marca || '', modelo: op.modelo || '', serie: op.serie || '',
      color: op.color || '', dimensiones: op.dimensiones || '', estado_conserv: estado, cantidad: '1',
      ambiente_id: amb.id, foto_url: '', obs: op.obs || '', registrado_por: ctx.sesion.usuario,
      registrado_en: ts, op_id: op.op_id
    });
    histRow_(ctx, op, cod, 'SOBRANTE', 'denominacion', '', den, amb.id);
  }
  ctx.config.correlativo_sobrante = n;
  var av = invalidarConstancia_(ctx, amb.id, op);
  return { codigos: codigos, ambiente_id: amb.id, denominacion: den, aviso: av || undefined };
}

/**
 * Paso 1 del cierre: el celular generó la constancia en PDF con lo verificado.
 * La constancia queda IMPRESA (falta firmar) y el ambiente sigue EN_CURSO.
 * Los pendientes NO pasan a faltantes: quedan PENDIENTE (inventario aparte).
 */
function opCerrarAmbiente_(ctx, op) {
  var amb = ambObj_(ctx, op.ambiente_id);
  exigirAmbienteAbierto_(amb);
  var r = resumenCierre_(ctx, amb);
  setAmb_(ctx, amb.id, {
    constancia_estado: 'IMPRESA', constancia_fecha: tsOp_(op), total_ubicado: String(r.ubicados)
  }, op, 'CERRAR_AMBIENTE');
  r.ambiente = ambObj_(ctx, amb.id);
  return r;
}

/**
 * Paso 2 del cierre: el responsable firmó y selló la constancia impresa. Recién entonces el ambiente queda CERRADO.
 * op: {ambiente_id, firmante?}
 */
function opFirmarConstancia_(ctx, op) {
  var amb = ambObj_(ctx, op.ambiente_id);
  if (amb.estado === 'CERRADO' && amb.constancia_estado === 'FIRMADA') return { ambiente: amb };
  if (amb.constancia_estado !== 'IMPRESA') {
    throw new Error('La constancia de ' + amb.nombre + ' no está impresa o quedó desactualizada: genérela de nuevo antes de marcarla como firmada.');
  }
  var r = resumenCierre_(ctx, amb);
  setAmb_(ctx, amb.id, {
    constancia_estado: 'FIRMADA', constancia_firmante: String(op.firmante || amb.responsable || ''),
    estado: 'CERRADO', cerrado_por: ctx.sesion.usuario, fecha_cierre: tsOp_(op), total_ubicado: String(r.ubicados)
  }, op, 'CERRAR_AMBIENTE');
  r.ambiente = ambObj_(ctx, amb.id);
  return r;
}

function resumenCierre_(ctx, amb) {
  var ubicados = 0;
  var pendientes = [];
  for (var k = 0; k < ctx.B.rows.length; k++) {
    var r = ctx.B.rows[k];
    if (r[ctx.B.idx.estado_verif] === 'UBICADO' && r[ctx.B.idx.ambiente_real_id] === amb.id) ubicados++;
    else if (r[ctx.B.idx.ambiente_id] === amb.id && r[ctx.B.idx.estado_verif] !== 'UBICADO') pendientes.push(r[ctx.B.idx.id]);
  }
  var sobr = leerColumna_('SOBRANTES', 'ambiente_id').filter(function (a) { return a === amb.id; }).length +
    ctx.sobrantes.filter(function (s) { return s.ambiente_id === amb.id; }).length;
  return { ubicados: ubicados, pendientes: pendientes, sobrantes: sobr };
}

/* ---------------- lecturas incrementales ---------------- */

/**
 * Cambios desde la fila N del HISTORIAL: devuelve los bienes tocados, todos los ambientes y los sobrantes.
 * p: {desde_n, ids?}
 */
function getCambios_(p) {
  var desde = Math.max(0, Number(p.desde_n || 0));
  var sh = hoja_('HISTORIAL');
  var total = Math.max(0, sh.getLastRow() - 1);
  var ids = {};
  (p.ids || []).forEach(function (id) { ids[String(id)] = true; }); // bienes a releer (p. ej. tras un error)
  if (total > desde) {
    leerColumna_('HISTORIAL', 'bien_id').slice(desde).forEach(function (id) { if (id) ids[id] = true; });
  }
  var bienes = [];
  if (Object.keys(ids).length) {
    var B = leerTabla_('BIENES');
    bienes = B.rows.filter(function (r) { return ids[r[B.idx.id]]; });
  }
  return {
    servidor_ts: ahora_(),
    historial_n: total,
    bienes: bienes,
    ambientes: aObjetos_(leerTabla_('AMBIENTES')),
    sobrantes: aObjetos_(leerTabla_('SOBRANTES'))
  };
}

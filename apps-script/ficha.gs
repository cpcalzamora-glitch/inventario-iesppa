/**
 * v4 – Fase 2: ficha del bien editable (solo ADMIN) e historial del bien.
 * Cada cambio va al HISTORIAL con su motivo. Al cambiar el código o el tipo se recalculan
 * cod_duplicado, en_siga, apto_etiqueta y destino_informe del bien y de los que compartían el código.
 */

var CAMPOS_FICHA = ['cod_patrimonial', 'tipo_codigo', 'serie', 'marca', 'modelo', 'denominacion', 'ambiente_real_id', 'obs_campo'];
var TIPOS_CODIGO = ['12D', '8D', 'ALTA', 'SIN'];

/**
 * op: {bien_id, cambios: {campo: valor}, motivo, aceptar_duplicado?}
 */
function opEditarBien_(ctx, op) {
  exigirAdmin_(ctx, 'editar la ficha de un bien');
  exigirMotivo_(op);
  var i = ctx.porId[String(op.bien_id)];
  if (i === undefined) throw new Error('No existe el bien ' + op.bien_id);
  var b = bienObj_(ctx, i);
  var cambios = op.cambios || {};
  var c = {};
  Object.keys(cambios).forEach(function (k) {
    if (CAMPOS_FICHA.indexOf(k) < 0) throw new Error('No se puede editar el campo ' + k + '.');
    var v = String(cambios[k] === null || cambios[k] === undefined ? '' : cambios[k]).trim();
    if (k === 'cod_patrimonial') v = v.replace(/\s+/g, '');
    else if (k !== 'obs_campo' && k !== 'ambiente_real_id') v = v.toUpperCase();
    if (v !== b[k]) c[k] = v;
  });
  if (!Object.keys(c).length) return { bien: b, aviso: 'No había cambios.' };

  var cod = c.cod_patrimonial !== undefined ? c.cod_patrimonial : b.cod_patrimonial;
  var tipo = c.tipo_codigo !== undefined ? c.tipo_codigo : b.tipo_codigo;
  validarCodigo_(cod, tipo);
  if (c.denominacion !== undefined && !c.denominacion) throw new Error('La denominación no puede quedar vacía.');

  // Código repetido: solo se acepta con motivo y confirmación expresa.
  // Si el código solo figura en filas SIGA sin ubicar (pendientes), se puede CONCILIAR: es el mismo bien físico.
  var codigoCambia = c.cod_patrimonial !== undefined || c.tipo_codigo !== undefined;
  var conciliar = [];
  if (codigoCambia && cod && tipo === '12D') {
    var otros = otrosConCodigo_(ctx, cod, i);
    var conciliables = otros.length && otros.every(function (k) { return esConciliable_(ctx, k); });
    if (op.conciliar) {
      if (!conciliables) throw new Error('Solo se concilia con filas SIGA sin ubicar y pendientes de verificar.');
      conciliar = otros;
    } else if (otros.length && !op.aceptar_duplicado) {
      var ids = otros.map(function (k) { return ctx.B.rows[k][ctx.B.idx.id]; });
      var e = new Error(conciliables
        ? 'El código ' + cod + ' es de la fila SIGA sin ubicar id ' + ids.join(', ') + '. Si es el mismo bien, concílielo.'
        : 'El código ' + cod + ' ya existe en ' + ids.length + ' bien(es) (id ' + ids.slice(0, 5).join(', ') + '). Confirme que lo acepta como duplicado.');
      e.codigo = conciliables ? 'CONCILIABLE' : 'DUPLICADO';
      throw e;
    }
  } else if (op.conciliar) {
    throw new Error('Solo se concilia al asignar un código 12D.');
  }

  var verificado = b.estado_verif === 'UBICADO' || b.estado_verif === 'OBSERVADO';
  var avisos = [];
  var ambAnt = b.ambiente_real_id;
  if (c.ambiente_real_id !== undefined) {
    if (!verificado) throw new Error('El ambiente real solo se cambia en un bien ya verificado (se asigna al verificarlo).');
    if (!c.ambiente_real_id || c.ambiente_real_id === 'SIN_UBICAR') throw new Error('Elija un ambiente real válido.');
    var nuevoAmb = ambObj_(ctx, c.ambiente_real_id);
    exigirAmbienteEditable_(ctx, ambAnt);
    exigirAmbienteEditable_(ctx, nuevoAmb.id);
    c.responsable_real = nuevoAmb.responsable || '';
  }
  op.ambiente_id = c.ambiente_real_id || ambAnt || b.ambiente_id;
  c.version = String(Number(b.version || 0) + 1);
  setBien_(ctx, i, c, op, 'EDITAR_FICHA');
  conciliar.forEach(function (k) {
    // La fila SIGA no se borra: queda marcada con el id del bien físico y deja de contar aparte.
    setBien_(ctx, k, { conciliado_con: b.id, cod_duplicado: 'NO', apto_etiqueta: 'NO' }, op, 'CONCILIAR');
    histRow_(ctx, op, b.id, 'CONCILIAR', 'conciliado_con_siga', '', ctx.B.rows[k][ctx.B.idx.id]);
  });
  // Si el bien deja el código con el que se había conciliado una fila SIGA, esa fila vuelve a contar aparte.
  if (c.cod_patrimonial !== undefined && b.cod_patrimonial) {
    ctx.B.rows.forEach(function (r, k) {
      if (conciliado_(ctx, r) && r[ctx.B.idx.conciliado_con] === b.id && r[ctx.B.idx.cod_patrimonial] === b.cod_patrimonial) {
        setBien_(ctx, k, { conciliado_con: '' }, op, 'DESCONCILIAR');
        avisos.push('La fila SIGA id ' + r[ctx.B.idx.id] + ' dejó de estar conciliada.');
      }
    });
  }
  if (conciliar.length) avisos.push('Conciliado con la fila SIGA id ' + conciliar.map(function (k) { return ctx.B.rows[k][ctx.B.idx.id]; }).join(', ') + '.');

  // Recalcular derivados del bien y de los que comparten el código anterior o el nuevo.
  var codigos = {};
  if (b.cod_patrimonial) codigos[b.cod_patrimonial] = true;
  if (cod) codigos[cod] = true;
  var afectados = [i];
  if (codigoCambia) {
    for (var j = 0; j < ctx.B.rows.length; j++) {
      if (j !== i && codigos[ctx.B.rows[j][ctx.B.idx.cod_patrimonial]]) afectados.push(j);
    }
  }
  var conteo = conteo12D_(ctx);
  var ambs = {};
  afectados.forEach(function (k) {
    var antes = bienObj_(ctx, k);
    recalcularDerivados_(ctx, k, op, conteo, k === i && codigoCambia, k === i ? 'EDITAR_FICHA' : 'RECALCULO');
    var despues = bienObj_(ctx, k);
    if (antes.apto_etiqueta !== despues.apto_etiqueta) ambs[despues.ambiente_id] = true;
  });
  Object.keys(ambs).forEach(function (id) { recalcularAptosAmbiente_(ctx, id, op); });

  // La constancia del ambiente donde está verificado deja de reflejar el bien tal como era.
  [ambAnt, c.ambiente_real_id].forEach(function (id) {
    if (!id || !verificado) return;
    var t = invalidarConstancia_(ctx, id, op);
    if (t && avisos.indexOf(t) < 0) avisos.push(t);
  });
  var vecinos = afectados.slice(1).map(function (k) { return bienObj_(ctx, k); });
  return { bien: bienObj_(ctx, i), bienes: vecinos, aviso: avisos.join(' ') || undefined };
}

function validarCodigo_(cod, tipo) {
  if (TIPOS_CODIGO.indexOf(tipo) < 0) throw new Error('Tipo de código no válido: ' + tipo + ' (12D, 8D, ALTA o SIN).');
  if (tipo === '12D' && !/^\d{12}$/.test(cod)) throw new Error('Un código 12D debe tener exactamente 12 dígitos numéricos (tiene ' + cod.length + ').');
  if (tipo === '8D' && !/^\d{8}$/.test(cod)) throw new Error('Un código 8D debe tener exactamente 8 dígitos numéricos (tiene ' + cod.length + ').');
  if (tipo === 'ALTA' && /^\d+$/.test(cod) && cod.length !== 8 && cod.length !== 12) {
    throw new Error('Los códigos numéricos solo tienen 8 o 12 dígitos (este tiene ' + cod.length + ').');
  }
}

function conciliado_(ctx, r) { return ctx.B.idx.conciliado_con !== undefined && !!r[ctx.B.idx.conciliado_con]; }

/** Filas (índices) con ese código, sin contar la fila i ni las ya conciliadas. */
function otrosConCodigo_(ctx, cod, i) {
  var l = [];
  ctx.B.rows.forEach(function (r, k) {
    if (k !== i && r[ctx.B.idx.cod_patrimonial] === cod && !conciliado_(ctx, r)) l.push(k);
  });
  return l;
}

/** Fila del SIGA sin ubicar, aún pendiente: es la que se puede conciliar con un bien físico. */
function esConciliable_(ctx, k) {
  var r = ctx.B.rows[k];
  return r[ctx.B.idx.fuente] === 'SIGA' && r[ctx.B.idx.ambiente_id] === 'SIN_UBICAR' && r[ctx.B.idx.estado_verif] === 'PENDIENTE';
}

/** Cuántas veces aparece cada código entre los bienes 12D (sin las filas SIGA conciliadas). */
function conteo12D_(ctx) {
  var n = {};
  ctx.B.rows.forEach(function (r) {
    if (r[ctx.B.idx.tipo_codigo] === '12D' && r[ctx.B.idx.cod_patrimonial] && !conciliado_(ctx, r)) n[r[ctx.B.idx.cod_patrimonial]] = (n[r[ctx.B.idx.cod_patrimonial]] || 0) + 1;
  });
  return n;
}

/**
 * Reglas (las mismas con que se creó la base):
 *  - cod_duplicado = SI si el código 12D lo comparte otro bien 12D.
 *  - en_siga: NO si no es 12D; si se le asigna un código 12D nuevo, SI (viene del SIGA/DREP); si no, se conserva.
 *  - apto_etiqueta = SI si es 12D, sin duplicado y con ambiente confirmado (verificado, o ambiente de referencia
 *    que no es SIN UBICAR ni cambió de uso).
 *  - destino_informe = DREP+INTERNO si es 12D; si no, INTERNO.
 *  - etiqueta (solo si ya está verificado): DEFINITIVA si es 12D; si no, TEMPORAL.
 */
function recalcularDerivados_(ctx, k, op, conteo, codigoNuevo, accion) {
  var b = bienObj_(ctx, k);
  if (b.conciliado_con) return; // fila SIGA conciliada: ya no cuenta aparte
  var es12 = b.tipo_codigo === '12D';
  var dup = es12 && (conteo[b.cod_patrimonial] || 0) > 1 ? 'SI' : 'NO';
  var enSiga = !es12 ? 'NO' : (codigoNuevo ? 'SI' : (b.en_siga || 'SI'));
  var verificado = b.estado_verif === 'UBICADO' || b.estado_verif === 'OBSERVADO';
  var ambRef = ctx.ambPorId[b.ambiente_id] !== undefined ? ambObj_(ctx, b.ambiente_id) : null;
  var confirmado = verificado || (b.ambiente_id !== 'SIN_UBICAR' && ambRef && !ambRef.cambio_uso);
  var campos = {
    cod_duplicado: dup,
    en_siga: enSiga,
    apto_etiqueta: es12 && dup === 'NO' && confirmado ? 'SI' : 'NO',
    destino_informe: es12 ? 'DREP+INTERNO' : 'INTERNO'
  };
  if (verificado) campos.etiqueta = es12 ? 'DEFINITIVA' : 'TEMPORAL';
  setBien_(ctx, k, campos, op, accion);
}

function recalcularAptosAmbiente_(ctx, ambId, op) {
  if (ctx.ambPorId[ambId] === undefined || ctx.A.idx.aptos_etiqueta === undefined) return;
  var n = 0;
  ctx.B.rows.forEach(function (r) { if (r[ctx.B.idx.ambiente_id] === ambId && r[ctx.B.idx.apto_etiqueta] === 'SI') n++; });
  setAmb_(ctx, ambId, { aptos_etiqueta: String(n) }, op, 'RECALCULO');
}

/** Historial de un bien (lo más reciente primero). p: {bien_id} */
function getHistorialBien_(p) {
  var id = String(p.bien_id || '');
  if (!id) throw new Error('Indique el bien.');
  var t = leerTabla_('HISTORIAL');
  var filas = aObjetos_(t).filter(function (h) { return h.bien_id === id; });
  filas.reverse();
  return { bien_id: id, total: filas.length, filas: filas.slice(0, 200) };
}

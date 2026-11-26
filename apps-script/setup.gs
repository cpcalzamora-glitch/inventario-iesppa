/**
 * Preparación (Fase 0): menú en el Sheet, verificación de estructura y asignación de PIN.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Inventario App')
    .addItem('Asignar PIN a un usuario', 'menuAsignarPin')
    .addItem('Verificar estructura', 'menuVerificarEstructura')
    .addItem('Actualizar estructura (v3 y v4)', 'menuMigrarV3')
    .addSeparator()
    .addItem('Reiniciar datos de prueba (antes del inventario)', 'menuReiniciarDatosPrueba')
    .addToUi();
}

function menuReiniciarDatosPrueba() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Reiniciar datos de prueba',
    'Todos los bienes vuelven a PENDIENTE (se limpian las verificaciones) y todos los ambientes a PENDIENTE, sin constancias. ' +
    'Los sobrantes de prueba quedan anulados. NO se tocan códigos, denominaciones, series ni los datos base. ' +
    'Todo queda en el HISTORIAL.\n\nAntes: compruebe que todos los celulares muestren "Pendientes: 0". ¿Continuar?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var r = ui.prompt('Confirmar reinicio', 'Escriba REINICIAR para confirmar:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || r.getResponseText().trim().toUpperCase() !== 'REINICIAR') { ui.alert('Cancelado: no se cambió nada.'); return; }
  try {
    var res = reiniciarDatosPrueba('admin-hoja');
    ui.alert('Datos de prueba reiniciados', res.texto, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

/**
 * Deja la base lista para el inventario real: limpia las verificaciones de prueba de BIENES, deja todos los
 * ambientes en PENDIENTE sin constancia y anula los sobrantes de prueba. No toca códigos, denominaciones,
 * series ni ningún dato base. Cada valor anterior queda en el HISTORIAL (acción REINICIO_PRUEBAS), así los
 * celulares reciben el cambio al sincronizar.
 */
function reiniciarDatosPrueba(usuario) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ctx = cargarContexto_({ usuario: usuario || 'admin-hoja', rol: 'ADMIN' });
    var op = { op_id: 'REINICIO-' + Utilities.getUuid(), motivo: 'Reinicio de datos de prueba antes del inventario', dispositivo: 'Hoja de cálculo' };
    var limpio = {
      estado_verif: 'PENDIENTE', ambiente_real_id: '', responsable_real: '', estado_conserv: '', etiqueta: 'NO',
      foto_url: '', obs_campo: '', verificado_por: '', verificado_en: '', situacion: ''
    };
    if (ctx.B.idx.metodo_ubicacion !== undefined) limpio.metodo_ubicacion = '';
    var bienes = 0;
    for (var k = 0; k < ctx.B.rows.length; k++) {
      var b = bienObj_(ctx, k);
      var sucio = Object.keys(limpio).some(function (c) { return (b[c] || '') !== limpio[c]; });
      if (!sucio) continue;
      if (b.verificado_por) histRow_(ctx, op, b.id, 'REINICIO_PRUEBAS', 'verificado_por', b.verificado_por, '');
      if (b.verificado_en) histRow_(ctx, op, b.id, 'REINICIO_PRUEBAS', 'verificado_en', b.verificado_en, '');
      setBien_(ctx, k, limpio, op, 'REINICIO_PRUEBAS');
      bienes++;
    }
    var ambientes = 0;
    ctx.A.rows.forEach(function (r) {
      var id = r[ctx.A.idx.id];
      if (!id) return;
      var a = ambObj_(ctx, id);
      var c = { estado: 'PENDIENTE', total_ubicado: '', abierto_por: '', cerrado_por: '', fecha_cierre: '',
        constancia_estado: 'PENDIENTE', constancia_firmante: '', constancia_fecha: '' };
      if (id === 'SIN_UBICAR') c.constancia_estado = a.constancia_estado || ''; // ambiente virtual: no lleva constancia
      if (Object.keys(c).some(function (f) { return (a[f] || '') !== c[f]; })) { setAmb_(ctx, id, c, op, 'REINICIO_PRUEBAS'); ambientes++; }
    });
    var sobr = 0;
    var T = sobTabla_(ctx);
    if (T.idx.anulado !== undefined) {
      T.rows.forEach(function (row, n) { if (row[T.idx.anulado] !== 'SI') { anularSobFila_(ctx, n, op, 'REINICIO_PRUEBAS'); sobr++; } });
    }
    guardarContexto_(ctx);
    // Comprobación final sobre lo que quedó en la hoja.
    var B = aObjetos_(leerTabla_('BIENES'));
    var A = aObjetos_(leerTabla_('AMBIENTES'));
    var r = {
      total_bienes: B.length,
      verificados: B.filter(function (x) { return x.estado_verif === 'UBICADO' || x.estado_verif === 'OBSERVADO'; }).length,
      ambientes_pendiente: A.filter(function (x) { return x.estado === 'PENDIENTE'; }).length,
      total_ambientes: A.length,
      bienes_reiniciados: bienes, ambientes_reiniciados: ambientes, sobrantes_anulados: sobr
    };
    r.texto = 'Total de bienes: ' + r.total_bienes + '\nBienes verificados: ' + r.verificados +
      '\nAmbientes en PENDIENTE: ' + r.ambientes_pendiente + ' de ' + r.total_ambientes +
      '\n\nBienes limpiados: ' + bienes + ' | Ambientes reiniciados: ' + ambientes + ' | Sobrantes anulados: ' + sobr +
      '\n\nEn cada celular: menú del usuario → "Volver a descargar la base completa".';
    Logger.log(r.texto);
    return r;
  } finally {
    lock.releaseLock();
  }
}

function menuAsignarPin() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Asignar PIN', 'Usuario (hernan, invent1 o invent2):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var r2 = ui.prompt('Asignar PIN', 'Nuevo PIN (4 a 6 dígitos):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  try {
    ui.alert(setPin(r1.getResponseText(), r2.getResponseText()));
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

function menuVerificarEstructura() {
  var r = verificarEstructura();
  SpreadsheetApp.getUi().alert(r.ok ? 'Estructura correcta' : 'Hay problemas', r.texto, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Comprueba que existen las hojas con sus encabezados y que los conteos cuadran. */
function verificarEstructura() {
  var r = resumenEstructura_();
  var lineas = [];
  var nH = Object.keys(HOJAS).length;
  lineas.push('Hojas: ' + (r.hojas_ok ? 'OK (' + nH + ' de ' + nH + ')' : 'FALTAN O DIFIEREN'));
  r.problemas.forEach(function (p) { lineas.push(' - ' + p); });
  lineas.push('Bienes: ' + r.bienes + ' | Ambientes: ' + r.ambientes + ' | Personal: ' + r.personal);
  lineas.push('Usuarios con PIN: ' + r.usuarios_con_pin.join(', '));
  lineas.push('Conteo por ambiente = total_esperado: ' + (r.conteos_coinciden ? 'SÍ' : 'NO ' + JSON.stringify(r.diferencias)));
  lineas.push('destino_informe: ' + r.destino.drep + ' DREP+INTERNO, ' + r.destino.interno + ' INTERNO' +
    (r.destino.errados.length ? ' | NO COINCIDEN con tipo_codigo: ' + r.destino.errados.length + ' (ids ' + r.destino.errados.slice(0, 10).join(', ') + ')' : ' (coinciden con tipo_codigo)'));
  lineas.push('Códigos de longitud no válida (ni 8 ni 12 dígitos): ' + (r.codigos_invalidos.length ? r.codigos_invalidos.map(function (c) { return 'id ' + c.id + ' = ' + c.cod; }).join(', ') : 'ninguno'));
  var texto = lineas.join('\n');
  Logger.log(texto);
  return { ok: r.hojas_ok && r.conteos_coinciden && !r.destino.errados.length, texto: texto, detalle: r };
}

function resumenEstructura_() {
  var problemas = [];
  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss_().getSheetByName(nombre);
    if (!sh) { problemas.push('Falta la hoja ' + nombre); return; }
    var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); });
    HOJAS[nombre].forEach(function (col) {
      if (header.indexOf(col) < 0) problemas.push(nombre + ': falta la columna ' + col);
    });
  });
  var bienes = aObjetos_(leerTabla_('BIENES'));
  var ambientes = aObjetos_(leerTabla_('AMBIENTES'));
  var personal = leerTabla_('PERSONAL').rows.length;
  var usuarios = aObjetos_(leerTabla_('USUARIOS'));
  var cuenta = {};
  bienes.forEach(function (b) { cuenta[b.ambiente_id] = (cuenta[b.ambiente_id] || 0) + 1; });
  var diferencias = [];
  ambientes.forEach(function (a) {
    if (Number(a.total_esperado || 0) !== (cuenta[a.id] || 0)) diferencias.push(a.id + ': esperado ' + a.total_esperado + ', hay ' + (cuenta[a.id] || 0));
  });
  Object.keys(cuenta).forEach(function (id) {
    if (!ambientes.some(function (a) { return a.id === id; })) diferencias.push('ambiente_id inexistente: ' + id);
  });
  var destino = { drep: 0, interno: 0, errados: [] };
  var invalidos = [];
  bienes.forEach(function (b) {
    if (b.destino_informe === 'DREP+INTERNO') destino.drep++; else if (b.destino_informe === 'INTERNO') destino.interno++;
    if (b.destino_informe !== destinoInforme_(b)) destino.errados.push(b.id);
    var c = String(b.cod_patrimonial || '');
    if (/^\d+$/.test(c) && c.length !== 8 && c.length !== 12) invalidos.push({ id: b.id, cod: c });
  });
  return {
    version: API_VERSION,
    hojas_ok: problemas.length === 0,
    problemas: problemas,
    bienes: bienes.length,
    ambientes: ambientes.length,
    personal: personal,
    usuarios_con_pin: usuarios.filter(function (u) { return u.pin_hash; }).map(function (u) { return u.usuario; }),
    conteos_coinciden: diferencias.length === 0,
    destino: destino,
    codigos_invalidos: invalidos,
    diferencias: diferencias
  };
}

/** destino_informe según la v3: los 12 dígitos van al informe DREP y al interno; todo lo demás, solo al interno. */
function destinoInforme_(b) {
  return b.tipo_codigo === '12D' ? 'DREP+INTERNO' : 'INTERNO';
}

function menuMigrarV3() {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert('Estructura v3', migrarV3().join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

/**
 * Actualiza el Sheet a la v3 del plan. Se puede ejecutar varias veces: solo agrega lo que falta.
 *  - BIENES: columnas destino_informe, situacion_especial, ref_declaracion y situacion al final;
 *    destino_informe pasa de fórmula a valores fijos (DREP+INTERNO si tipo_codigo = 12D, si no INTERNO).
 *  - AMBIENTES: constancia_estado, constancia_firmante y constancia_fecha.
 *  - Hoja DECLARACIONES (vacía) y valores nuevos en LISTAS.
 * No borra filas ni renombra nada.
 */
function migrarV3() {
  var log = [];
  asegurarColumnas_('BIENES', HOJAS.BIENES, log);
  asegurarColumnas_('AMBIENTES', HOJAS.AMBIENTES, log);
  // v4: motivo en HISTORIAL y marca de anulado en SOBRANTES (solo se agregan al final).
  asegurarColumnas_('HISTORIAL', HOJAS.HISTORIAL, log);
  asegurarColumnas_('SOBRANTES', HOJAS.SOBRANTES, log);
  if (!ss_().getSheetByName('DECLARACIONES')) {
    var sh = ss_().insertSheet('DECLARACIONES');
    sh.getRange(1, 1, 1, HOJAS.DECLARACIONES.length).setValues([HOJAS.DECLARACIONES]);
    sh.getRange(1, 1, Math.max(2, sh.getMaxRows()), HOJAS.DECLARACIONES.length).setNumberFormat('@');
    sh.setFrozenRows(1);
    log.push('Hoja DECLARACIONES creada.');
  }
  // destino_informe: de fórmula a valores fijos.
  var t = leerTabla_('BIENES');
  var c = t.idx.destino_informe;
  var vals = t.rows.map(function (r) { return [destinoInforme_({ tipo_codigo: r[t.idx.tipo_codigo] })]; });
  var cambian = t.rows.filter(function (r, i) { return r[c] !== vals[i][0]; }).length;
  var rg = t.sh.getRange(2, c + 1, vals.length, 1);
  rg.clearContent();
  rg.setNumberFormat('@');
  rg.setValues(vals);
  log.push('destino_informe en valores fijos: ' + vals.filter(function (v) { return v[0] === 'DREP+INTERNO'; }).length +
    ' DREP+INTERNO y ' + vals.filter(function (v) { return v[0] === 'INTERNO'; }).length + ' INTERNO (' + cambian + ' cambiaron).');
  // LISTAS
  asegurarColumnas_('LISTAS', HOJAS.LISTAS, log);
  var L = { situacion: ['U', 'D'], situacion_desc: ['Uso', 'Desuso'], situacion_especial: ['REFERIDO_ENTREGADO_SIN_BAJA'],
    destino_informe: ['DREP+INTERNO', 'INTERNO'], constancia_estado: ['PENDIENTE', 'IMPRESA', 'FIRMADA'] };
  var tl = leerTabla_('LISTAS');
  Object.keys(L).forEach(function (col) {
    var k = tl.idx[col];
    var actuales = tl.rows.map(function (r) { return r[k]; }).filter(function (v) { return v !== ''; });
    if (actuales.join('|') === L[col].join('|')) return;
    tl.sh.getRange(2, k + 1, L[col].length, 1).setNumberFormat('@').setValues(L[col].map(function (v) { return [v]; }));
    log.push('LISTAS.' + col + ': ' + L[col].join(', '));
  });
  log.push('Listo. Ejecute "Verificar estructura" para revisar.');
  Logger.log(log.join('\n'));
  return log;
}

/** Agrega al final de la hoja las columnas esperadas que falten (no mueve ni renombra las existentes). */
function asegurarColumnas_(nombre, esperadas, log) {
  var sh = hoja_(nombre);
  var lastCol = Math.max(1, sh.getLastColumn());
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var faltan = esperadas.filter(function (c) { return header.indexOf(c) < 0; });
  if (!faltan.length) return;
  var libre = sh.getMaxColumns() - sh.getLastColumn();
  if (libre < faltan.length) sh.insertColumnsAfter(sh.getMaxColumns(), faltan.length - libre);
  var c0 = sh.getLastColumn() + 1;
  sh.getRange(1, c0, 1, faltan.length).setValues([faltan]);
  sh.getRange(1, c0, Math.max(2, sh.getMaxRows()), faltan.length).setNumberFormat('@');
  log.push(nombre + ': columnas agregadas al final: ' + faltan.join(', '));
}

/**
 * Preparación (Fase 0): menú en el Sheet, verificación de estructura y asignación de PIN.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Inventario App')
    .addItem('Asignar PIN a un usuario', 'menuAsignarPin')
    .addItem('Verificar estructura', 'menuVerificarEstructura')
    .addToUi();
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

/** Comprueba que existen las 8 hojas con sus encabezados y que los conteos cuadran. */
function verificarEstructura() {
  var r = resumenEstructura_();
  var lineas = [];
  lineas.push('Hojas: ' + (r.hojas_ok ? 'OK (8 de 8)' : 'FALTAN O DIFIEREN'));
  r.problemas.forEach(function (p) { lineas.push(' - ' + p); });
  lineas.push('Bienes: ' + r.bienes + ' | Ambientes: ' + r.ambientes + ' | Personal: ' + r.personal);
  lineas.push('Usuarios con PIN: ' + r.usuarios_con_pin.join(', '));
  lineas.push('Conteo por ambiente = total_esperado: ' + (r.conteos_coinciden ? 'SÍ' : 'NO ' + JSON.stringify(r.diferencias)));
  var texto = lineas.join('\n');
  Logger.log(texto);
  return { ok: r.hojas_ok && r.conteos_coinciden, texto: texto, detalle: r };
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
  return {
    version: API_VERSION,
    hojas_ok: problemas.length === 0,
    problemas: problemas,
    bienes: bienes.length,
    ambientes: ambientes.length,
    personal: personal,
    usuarios_con_pin: usuarios.filter(function (u) { return u.pin_hash; }).map(function (u) { return u.usuario; }),
    conteos_coinciden: diferencias.length === 0,
    diferencias: diferencias
  };
}

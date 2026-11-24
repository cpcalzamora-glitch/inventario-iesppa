/**
 * API del inventario IESPPA 2026.
 * Una sola URL. El frontend envía POST con Content-Type: text/plain y el cuerpo
 * JSON {action, token, ...}. La respuesta es siempre JSON {ok, data} o {ok:false, error, codigo}.
 */

var API_VERSION = '1.0.0';

var ACCIONES = {
  // acción: [función, requiereToken]
  login: [function (p) { return login_(p); }, false],
  logout: [function (p) { return logout_(p.token); }, false],
  getBootstrap: [function (p, s) { return getBootstrap_(s); }, true],
  getCambios: [function (p) { return getCambios_(p); }, true],
  // Escrituras: una operación suelta o una cola completa (sync).
  sync: [function (p, s) { return procesarOps_(p.ops || [], s); }, true],
  abrirAmbiente: [opSuelta_('abrirAmbiente'), true],
  verificar: [opSuelta_('verificar'), true],
  verificarLote: [opSuelta_('verificarLote'), true],
  registrarSobrante: [opSuelta_('registrarSobrante'), true],
  editarResponsableAmbiente: [opSuelta_('editarResponsableAmbiente'), true],
  cerrarAmbiente: [opSuelta_('cerrarAmbiente'), true]
};

function opSuelta_(tipo) {
  return function (p, s) {
    var op = JSON.parse(JSON.stringify(p));
    delete op.token;
    op.type = tipo;
    var r = procesarOps_([op], s)[0];
    if (r.estado === 'error') throw new Error(r.error);
    return r;
  };
}

function doPost(e) {
  var p;
  try {
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud no válida.' });
  }
  return json_(ejecutar_(p));
}

/** GET solo sirve para comprobar que el servicio está vivo (no devuelve datos de bienes). */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'ping') {
    try {
      var r = resumenEstructura_();
      delete r.usuarios_con_pin; // no se exponen nombres de usuario sin token
      return json_({ ok: true, data: r });
    } catch (err) {
      return json_({ ok: false, error: String(err.message || err) });
    }
  }
  return json_({ ok: true, data: { servicio: 'API Inventario IESPPA', version: API_VERSION } });
}

function ejecutar_(p) {
  try {
    var def = ACCIONES[p.action];
    if (!def) throw new Error('Acción desconocida: ' + p.action);
    var sesion = def[1] ? validarToken_(p.token) : null;
    return { ok: true, data: def[0](p, sesion) };
  } catch (err) {
    return { ok: false, error: String(err.message || err), codigo: err.codigo || '' };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Descarga inicial: bienes (como matriz compacta), ambientes, personal, config y listas.
 */
function getBootstrap_(sesion) {
  var b = leerTabla_('BIENES');
  return {
    servidor_ts: ahora_(),
    usuario: sesion.usuario,
    rol: sesion.rol,
    bienes: { columnas: b.header, filas: b.rows },
    ambientes: aObjetos_(leerTabla_('AMBIENTES')),
    personal: aObjetos_(leerTabla_('PERSONAL')),
    config: leerConfig_(),
    listas: leerListas_(),
    sobrantes: aObjetos_(leerTabla_('SOBRANTES')),
    historial_n: Math.max(0, hoja_('HISTORIAL').getLastRow() - 1)
  };
}

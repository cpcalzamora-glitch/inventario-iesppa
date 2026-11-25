/**
 * Acceso a las hojas del Google Sheet.
 * Las columnas se ubican por su nombre (fila 1), nunca por posición fija.
 */

var SHEET_ID = '1jAPsRn1wbtmVR_n-XdcyVS_okdV5Af_oV78KxwJgwaE';
var TZ = 'America/Lima';

var HOJAS = {
  BIENES: ['id', 'fuente', 'cod_patrimonial', 'tipo_codigo', 'cod_interno', 'cod_duplicado', 'en_siga',
    'denominacion', 'marca', 'modelo', 'serie', 'color', 'dimensiones', 'ambiente_id', 'ambiente_ref',
    'ambiente_2024', 'responsable_ref', 'responsable_siga', 'estado_ref', 'obs_ref', 'apto_etiqueta',
    'estado_verif', 'ambiente_real_id', 'responsable_real', 'estado_conserv', 'etiqueta', 'foto_url',
    'obs_campo', 'verificado_por', 'verificado_en', 'version', 'entidad_id',
    // agregadas al final en la v3 (no cambian el orden de las anteriores)
    'destino_informe', 'situacion_especial', 'ref_declaracion', 'situacion',
    // v4: fila SIGA conciliada con el bien físico que tomó su código (id de ese bien)
    'conciliado_con'],
  AMBIENTES: ['id', 'nombre', 'numero', 'programa', 'ubicacion', 'responsable', 'origen', 'cambio_uso',
    'total_esperado', 'aptos_etiqueta', 'estado', 'total_ubicado', 'abierto_por', 'cerrado_por', 'fecha_cierre',
    'constancia_estado', 'constancia_firmante', 'constancia_fecha'],
  PERSONAL: ['n', 'nombre', 'dni', 'cargo'],
  SOBRANTES: ['cod_sobrante', 'denominacion', 'marca', 'modelo', 'serie', 'color', 'dimensiones',
    'estado_conserv', 'cantidad', 'ambiente_id', 'foto_url', 'obs', 'registrado_por', 'registrado_en', 'op_id',
    'anulado'], // agregada al final en la v4 (SI = sobrante anulado; la fila nunca se borra)
  HISTORIAL: ['fecha_hora', 'usuario', 'op_id', 'bien_id', 'accion', 'campo', 'valor_anterior', 'valor_nuevo',
    'ambiente_id', 'dispositivo', 'motivo'], // motivo: agregada al final en la v4
  DECLARACIONES: ['id_decl', 'fecha', 'declarante', 'dni', 'cargo_periodo', 'resumen', 'foto_url', 'registrado_por',
    'registrado_en'],
  USUARIOS: ['usuario', 'nombre', 'pin_hash', 'sal', 'rol', 'activo'],
  CONFIG: ['clave', 'valor'],
  LISTAS: ['estado_conserv', 'estado_conserv_desc', 'estado_verif', 'etiqueta', 'tipo_codigo', 'fuente',
    'situacion', 'situacion_desc', 'situacion_especial', 'destino_informe', 'constancia_estado']
};

var _ss = null;
function ss_() {
  if (!_ss) _ss = SpreadsheetApp.openById(SHEET_ID);
  return _ss;
}

function hoja_(nombre) {
  var sh = ss_().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la hoja ' + nombre);
  return sh;
}

/** Lee una hoja completa. Devuelve {sh, header, idx, rows} (rows sin la fila de encabezado). */
function leerTabla_(nombre) {
  var sh = hoja_(nombre);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var values = lastRow > 0 && lastCol > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  header.forEach(function (h, i) { if (h) idx[h] = i; });
  var rows = values.slice(1).map(function (r) { return r.map(texto_); });
  return { sh: sh, header: header, idx: idx, rows: rows };
}

/** Convierte una tabla a lista de objetos. */
function aObjetos_(t) {
  return t.rows.map(function (r) {
    var o = {};
    t.header.forEach(function (h, i) { if (h) o[h] = r[i]; });
    return o;
  });
}

/** Todo valor se maneja como texto (los códigos conservan los ceros). */
function texto_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return String(v);
}

function ahora_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function leerConfig_() {
  var t = leerTabla_('CONFIG');
  var c = {};
  t.rows.forEach(function (r) { if (r[0]) c[r[0]] = r[1]; });
  return c;
}

function leerListas_() {
  var t = leerTabla_('LISTAS');
  var l = {};
  t.header.forEach(function (h, i) {
    if (!h) return;
    l[h] = t.rows.map(function (r) { return r[i]; }).filter(function (v) { return v !== ''; });
  });
  return l;
}

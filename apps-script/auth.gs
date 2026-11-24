/**
 * Autenticación: usuario + PIN -> token de sesión (7 días).
 * Los PIN se guardan como SHA-256(sal + pin). Nunca en texto plano.
 */

var TOKEN_DIAS = 7;
var MAX_INTENTOS = 5;      // intentos fallidos antes de bloquear
var BLOQUEO_SEG = 600;     // 10 minutos

function sha256Hex_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function nuevaSal_() {
  return sha256Hex_(Utilities.getUuid() + Utilities.getUuid()).slice(0, 32);
}

/**
 * Asigna el PIN de un usuario. Se ejecuta desde el menú "Inventario App" del Sheet
 * (o desde el editor llamando setPin('hernan', '123456')).
 */
function setPin(usuario, pin) {
  usuario = String(usuario || '').trim().toLowerCase();
  pin = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN debe tener de 4 a 6 dígitos.');
  var t = leerTabla_('USUARIOS');
  var fila = -1;
  t.rows.forEach(function (r, i) { if (String(r[t.idx.usuario]).trim().toLowerCase() === usuario) fila = i; });
  if (fila < 0) throw new Error('No existe el usuario ' + usuario);
  var sal = nuevaSal_();
  var hash = sha256Hex_(sal + pin);
  t.sh.getRange(fila + 2, t.idx.pin_hash + 1).setValue(hash);
  t.sh.getRange(fila + 2, t.idx.sal + 1).setValue(sal);
  return 'PIN asignado a ' + usuario;
}

function login_(p) {
  var usuario = String(p.usuario || '').trim().toLowerCase();
  var pin = String(p.pin || '').trim();
  var cache = CacheService.getScriptCache();
  var kInt = 'intentos_' + usuario;
  var intentos = Number(cache.get(kInt) || 0);
  if (intentos >= MAX_INTENTOS) throw new Error('Demasiados intentos. Espere 10 minutos.');

  var u = buscarUsuario_(usuario);
  var ok = u && u.activo === 'SI' && u.pin_hash && sha256Hex_(u.sal + pin) === u.pin_hash;
  if (!ok) {
    cache.put(kInt, String(intentos + 1), BLOQUEO_SEG);
    if (u && !u.pin_hash) throw new Error('El usuario aún no tiene PIN asignado.');
    throw new Error('Usuario o PIN incorrecto.');
  }
  cache.remove(kInt);
  limpiarTokens_();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var vence = Date.now() + TOKEN_DIAS * 86400000;
  PropertiesService.getScriptProperties().setProperty('tok_' + token,
    JSON.stringify({ usuario: u.usuario, rol: u.rol, vence: vence }));
  return { token: token, usuario: u.usuario, nombre: u.nombre, rol: u.rol, vence: vence };
}

function buscarUsuario_(usuario) {
  var lista = aObjetos_(leerTabla_('USUARIOS'));
  for (var i = 0; i < lista.length; i++) {
    if (String(lista[i].usuario).trim().toLowerCase() === usuario) return lista[i];
  }
  return null;
}

/** Valida el token en cada llamada. Comprueba además que el usuario siga activo. */
function validarToken_(token) {
  if (!token) throw errorAuth_();
  var raw = PropertiesService.getScriptProperties().getProperty('tok_' + token);
  if (!raw) throw errorAuth_();
  var s = JSON.parse(raw);
  if (Date.now() > s.vence) {
    PropertiesService.getScriptProperties().deleteProperty('tok_' + token);
    throw errorAuth_();
  }
  var cache = CacheService.getScriptCache();
  var kAct = 'activo_' + s.usuario;
  var activo = cache.get(kAct);
  if (activo === null) {
    var u = buscarUsuario_(s.usuario);
    activo = u && u.activo === 'SI' ? 'SI' : 'NO';
    cache.put(kAct, activo, 60);
  }
  if (activo !== 'SI') throw errorAuth_();
  return s;
}

function logout_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('tok_' + token);
  return { ok: true };
}

function errorAuth_() {
  var e = new Error('Sesión vencida o no válida. Vuelva a ingresar.');
  e.codigo = 'AUTH';
  return e;
}

function limpiarTokens_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('tok_') !== 0) return;
    try { if (Date.now() > JSON.parse(all[k]).vence) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

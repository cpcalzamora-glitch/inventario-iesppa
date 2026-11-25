// Utilidades de interfaz: creación de elementos, avisos, hojas modales, sonido y vibración.

/** h('div.clase#id', {atributos}, hijos...) */
export function h(sel, attrs, ...hijos) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { hijos.unshift(attrs); attrs = {}; }
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  (m[2].match(/[.#][\w-]+/g) || []).forEach((p) => (p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1))));
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  hijos.flat(Infinity).forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return el;
}

export function toast(texto, tipo = 'ok', ms = 2200) {
  const t = h('div.toast.' + tipo, texto);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('ver'));
  setTimeout(() => { t.classList.remove('ver'); setTimeout(() => t.remove(), 300); }, ms);
}

/**
 * Hoja modal desde abajo. contenido: Node | (cerrar) => Node. Devuelve una promesa con el valor de cerrar(v).
 */
export function hoja(contenido, { completa = false, cerrable = true } = {}) {
  return new Promise((resolve) => {
    const fondo = h('div.hoja-fondo');
    const caja = h('div.hoja' + (completa ? '.completa' : ''));
    const cerrar = (v) => { fondo.classList.remove('ver'); setTimeout(() => fondo.remove(), 200); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape' && cerrable) cerrar(null); };
    caja.append(typeof contenido === 'function' ? contenido(cerrar) : contenido);
    fondo.append(caja);
    if (cerrable) fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(null); });
    document.addEventListener('keydown', esc);
    document.body.append(fondo);
    requestAnimationFrame(() => fondo.classList.add('ver'));
  });
}

export function confirmar(titulo, texto, { si = 'Confirmar', no = 'Cancelar', peligro = false } = {}) {
  return hoja((cerrar) => h('div',
    h('h2', titulo),
    texto ? h('p.texto', texto) : null,
    h('div.botones',
      h('button.btn.sec', { onclick: () => cerrar(false) }, no),
      h('button.btn' + (peligro ? '.peligro' : '.pri'), { onclick: () => cerrar(true) }, si))));
}

/**
 * Pide un motivo (queda en el HISTORIAL). Devuelve el texto o null si cancela.
 * opciones: motivos frecuentes que se eligen con un toque. clave: texto que hay que escribir para confirmar (doble confirmación).
 */
export function pedirMotivo(titulo, texto, { si = 'Confirmar', peligro = false, opciones = [], clave = '' } = {}) {
  return hoja((cerrar) => {
    const area = h('textarea', { rows: 2, maxLength: 200, placeholder: 'Motivo (obligatorio)', oninput: validar });
    const inpClave = clave ? h('input.buscar', { placeholder: `Escriba ${clave}`, autocomplete: 'off', oninput: validar }) : null;
    const btn = h('button.btn' + (peligro ? '.peligro' : '.pri'), { disabled: true, onclick: () => cerrar(area.value.trim()) }, si);
    function validar() {
      btn.disabled = area.value.trim().length < 3 || (clave && inpClave.value.trim().toUpperCase() !== clave.toUpperCase());
    }
    return h('div',
      h('h2', titulo),
      texto ? h('p.texto', texto) : null,
      opciones.length ? h('div.chips', opciones.map((o) => h('button.chip-f', { type: 'button', onclick: () => { area.value = o; validar(); } }, o))) : null,
      area,
      inpClave ? h('p.texto.chico', `Para confirmar, escriba `, h('b', clave), ':') : null,
      inpClave,
      h('div.botones', h('button.btn.sec', { onclick: () => cerrar(null) }, 'Cancelar'), btn));
  });
}

let audio = null;
export function beep(ok = true) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = ok ? 1800 : 380;
    g.gain.value = 0.15;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.3));
  } catch (e) { /* sin sonido */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 70 : [120, 60, 120]);
}

export function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const ESTADOS = [
  ['B', 'Bueno'], ['R', 'Regular'], ['M', 'Malo'], ['CH', 'Chatarra'], ['RAEE', 'RAEE']
];

/** Selector de estado de conservación con botones grandes. */
export function selectorEstado(valor, alCambiar) {
  const cont = h('div.estados');
  const pintar = () => {
    cont.replaceChildren(...ESTADOS.map(([k, n]) => h('button.estado' + (k === valor ? '.sel' : ''), {
      type: 'button', title: n, onclick: () => { valor = k; pintar(); alCambiar(k); }
    }, h('b', k), h('small', n))));
  };
  pintar();
  return cont;
}

export const SITUACIONES = [['U', 'Uso'], ['D', 'Desuso']];

/** Selector de situación (U = uso, D = desuso), columna SITUAC. de la constancia. */
export function selectorSituacion(valor, alCambiar) {
  const cont = h('div.estados.dos');
  const pintar = () => {
    cont.replaceChildren(...SITUACIONES.map(([k, n]) => h('button.estado' + (k === valor ? '.sel' : ''), {
      type: 'button', title: n, onclick: () => { valor = k; pintar(); alCambiar(k); }
    }, h('b', k), h('small', n))));
  };
  pintar();
  return cont;
}

export function escapar(t) { return String(t ?? ''); }

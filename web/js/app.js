// Arranque, barra de estado y navegación.
import { CONFIG } from './config.js';
import { S, suscribir, notificar, cargarBase, leerBaseLocal, guardarYa, ambiente } from './store.js';
import { kvGet, kvSet, kvDel } from './db.js';
import { llamar } from './api.js';
import { sincronizar, refrescar, contarPendientes, setAlPerderSesion } from './cola.js';
import { h, hoja, toast, confirmar, fechaCorta } from './ui.js';
import { vistaLogin } from './views/login.js';
import { vistaAmbientes } from './views/ambientes.js';
import { vistaAmbiente } from './views/ambiente.js';
import { vistaBuscar } from './views/buscar.js';

const app = document.getElementById('app');
const barra = document.getElementById('barra');

export function ir(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function render() {
  if (!S.sesion) { app.replaceChildren(vistaLogin(ingresar)); pintarBarra(); return; }
  const [ruta, qs] = (location.hash || '#/ambientes').slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const partes = ruta.split('/').filter(Boolean);
  let v;
  if (partes[0] === 'amb' && partes[1]) {
    const id = decodeURIComponent(partes[1]);
    S.ambienteActivo = id;
    v = vistaAmbiente(id);
  } else if (partes[0] === 'buscar') v = vistaBuscar(params);
  else v = vistaAmbientes();
  app.replaceChildren(v);
  window.scrollTo(0, 0);
  pintarBarra();
}

function pintarBarra() {
  if (!S.sesion) { barra.replaceChildren(); barra.hidden = true; return; }
  barra.hidden = false;
  const estado = S.sincronizando ? 'sync' : (S.enLinea ? 'on' : 'off');
  const nAv = S.avisos.filter((a) => !a.visto).length;
  barra.replaceChildren(...[
    h('button.estado-red.' + estado, { onclick: panelEstado },
      h('span.punto'), S.sincronizando ? 'Sincronizando…' : (S.enLinea ? 'En línea' : 'Sin conexión'),
      h('span.pend' + (S.pendientes ? '.hay' : ''), ` · Pendientes: ${S.pendientes}`)),
    nAv ? h('button.avisos', { onclick: panelAvisos }, `⚠ ${nAv}`) : null,
    h('button.usuario', { onclick: menuUsuario }, S.sesion.usuario)].filter(Boolean));
}

async function panelEstado() {
  await hoja((cerrar) => h('div',
    h('h2', 'Sincronización'),
    h('p.texto', `Pendientes de sincronizar: ${S.pendientes}`),
    h('p.texto.chico', `Última actualización del servidor: ${fechaCorta(S.ultimaSync) || '—'}`),
    h('p.texto.chico', 'Sin señal puede seguir trabajando: todo se guarda en el celular y se envía solo al volver la señal.'),
    h('div.botones',
      h('button.btn.sec', { onclick: () => cerrar() }, 'Cerrar'),
      h('button.btn.pri', { onclick: async () => { cerrar(); await sincronizar(); toast(S.enLinea ? 'Sincronizado' : 'Sin conexión: se reintentará solo', S.enLinea ? 'ok' : 'error'); } }, 'Sincronizar ahora'))));
}

async function panelAvisos() {
  const l = S.avisos.slice().reverse();
  await hoja((cerrar) => h('div',
    h('h2', 'Avisos de sincronización'),
    h('div.lista', l.map((a) => h('div.item.' + (a.tipo || 'alerta'), h('div.item-s', fechaCorta(a.ts)), h('div.item-t.normal', a.texto)))),
    h('div.botones', h('button.btn.pri', { onclick: () => cerrar() }, 'Entendido'))), { completa: true });
  S.avisos.forEach((a) => { a.visto = true; });
  S.avisos = S.avisos.slice(-50);
  notificar();
}

async function menuUsuario() {
  const op = await hoja((cerrar) => h('div',
    h('h2', S.sesion.nombre || S.sesion.usuario),
    h('p.texto.chico', `Rol: ${S.sesion.rol} · App ${CONFIG.APP_VERSION}`),
    h('div.lista',
      h('button.item', { onclick: () => cerrar('buscar') }, h('div.item-t', '🔍 Buscar bienes')),
      h('button.item', { onclick: () => cerrar('recargar') }, h('div.item-t', '⟳ Volver a descargar la base completa')),
      h('button.item', { onclick: () => cerrar('salir') }, h('div.item-t', '⎋ Cerrar sesión'))),
    h('div.botones', h('button.btn.sec', { onclick: () => cerrar() }, 'Cerrar'))));
  if (op === 'buscar') ir('#/buscar');
  if (op === 'recargar') {
    if (S.pendientes) { toast('Primero sincronice los pendientes.', 'error'); return; }
    try { toast('Descargando…', 'ok', 1500); cargarBase(await llamar('getBootstrap')); await guardarYa(); render(); toast('Base actualizada'); }
    catch (e) { toast(e.message, 'error'); }
  }
  if (op === 'salir') {
    if (S.pendientes) { toast(`Hay ${S.pendientes} pendientes de sincronizar. Sincronice antes de salir.`, 'error', 4000); return; }
    if (!(await confirmar('Cerrar sesión', '¿Salir de la app en este celular?', { si: 'Salir' }))) return;
    try { await llamar('logout'); } catch (e) { /* sin señal */ }
    S.sesion = null;
    await kvDel('sesion');
    render();
  }
}

async function ingresar(usuario, pin, progreso) {
  const ses = await llamar('login', { usuario, pin, dispositivo: navigator.userAgent.slice(0, 60) });
  S.sesion = ses;
  await kvSet('sesion', ses);
  const tengoBase = S.cols.length || (await leerBaseLocal());
  if (!tengoBase) {
    progreso('Descargando la base (2,400 bienes)…');
    cargarBase(await llamar('getBootstrap'));
    await guardarYa();
  }
  ir(location.hash && location.hash !== '#/login' ? location.hash : '#/ambientes');
  sincronizar();
}

setAlPerderSesion(async () => {
  // El token venció: se conserva la cola y se pide ingresar otra vez.
  S.sesion = null;
  await kvDel('sesion');
  toast('Su sesión venció. Ingrese de nuevo: lo pendiente se conserva.', 'error', 5000);
  render();
});

async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const ses = await kvGet('sesion');
  if (ses && ses.vence > Date.now()) S.sesion = ses;
  await leerBaseLocal();
  try { S.ambienteActivo = localStorage.getItem('ambienteActivo') || ''; } catch (e) { /* */ }
  if (S.ambienteActivo && !ambiente(S.ambienteActivo)) S.ambienteActivo = '';
  await contarPendientes();
  if (S.sesion && !S.cols.length) {
    app.replaceChildren(h('div.pantalla', h('p.texto', 'Descargando la base…')));
    try { cargarBase(await llamar('getBootstrap')); await guardarYa(); } catch (e) { toast(e.message, 'error'); }
  }
  window.addEventListener('hashchange', render);
  suscribir(pintarBarra);
  render();
  if (S.sesion) sincronizar();
  setInterval(() => {
    if (S.sesion && navigator.onLine && !S.sincronizando && document.visibilityState === 'visible') {
      (S.pendientes ? sincronizar() : refrescar()).catch(() => {});
    }
  }, CONFIG.REFRESCO_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.sesion) sincronizar(); });
}

iniciar();

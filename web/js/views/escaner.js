// Escáner a pantalla completa en modo ráfaga: lee, muestra la ficha, confirma y vuelve a leer solo.
import { S, ambiente, resumenAmbiente, suscribir } from '../store.js';
import { h, toast } from '../ui.js';
import { Escaner, limpiarCodigo } from '../scanner.js';
import { procesarCodigo } from './flujo.js';

export async function abrirEscaner() {
  const amb = ambiente(S.ambienteActivo);
  if (!amb) return;
  let esc = null;
  let luz = false;
  const contador = h('div.esc-cont');
  const pintarCont = () => { const r = resumenAmbiente(amb.id); contador.textContent = `${r.ubicadosEsperados} / ${r.esperados}`; };
  pintarCont();
  const off = suscribir(pintarCont);
  const cerrar = async () => { off(); if (esc) await esc.detener(); capa.remove(); };
  const manual = h('form.esc-manual', {
    onsubmit: async (e) => {
      e.preventDefault();
      const inp = e.target.querySelector('input');
      const c = limpiarCodigo(inp.value);
      inp.value = '';
      inp.blur();
      if (!c) return;
      if (esc) esc.ocupado = true;
      await procesarCodigo(c);
      if (esc) esc.ocupado = false;
    }
  }, h('input', { placeholder: 'Escribir código', inputMode: 'numeric', autocomplete: 'off' }), h('button.btn.sec', { type: 'submit' }, 'OK'));

  const capa = h('div.escaner',
    h('div.esc-cab',
      h('button.icono.blanco', { onclick: cerrar, title: 'Cerrar' }, '✕'),
      h('div.esc-amb', amb.nombre),
      contador,
      h('button.icono.blanco', { title: 'Linterna', onclick: async () => { luz = !luz; if (!(await esc.linterna(luz))) toast('Este celular no permite usar la linterna aquí.', 'error'); } }, '🔦')),
    h('div#lector-camara'),
    h('div.esc-guia', 'Apunte al código de barras o al QR de la etiqueta'),
    manual);
  document.body.append(capa);
  try {
    esc = new Escaner('lector-camara', (codigo) => procesarCodigo(codigo));
    await esc.iniciar();
  } catch (e) {
    console.warn(e);
    capa.querySelector('#lector-camara').replaceChildren(h('div.esc-error',
      h('p', 'No se pudo abrir la cámara.'),
      h('p.chico', 'Permita el acceso a la cámara para esta página (candado de la barra de direcciones → Permisos → Cámara). Mientras tanto puede escribir el código abajo.')));
  }
}

// Inicio: lista de ambientes con estado y avance.
import { S, resumenAmbiente, suscribir } from '../store.js';
import { encolar } from '../cola.js';
import { h } from '../ui.js';
import { reabrir } from './ambiente.js';
import { ir } from '../app.js';

let filtro = 'TODOS';
let texto = '';

export function vistaAmbientes() {
  const lista = h('div.lista');
  const chips = h('div.chips');
  const pintar = () => {
    chips.replaceChildren(...[['TODOS', 'Todos'], ['PENDIENTE', 'Pendientes'], ['EN_CURSO', 'En curso'], ['CERRADO', 'Cerrados']].map(([k, n]) =>
      h('button.chip-f' + (filtro === k ? '.sel' : ''), { onclick: () => { filtro = k; pintar(); } }, n)));
    const t = texto.trim().toUpperCase();
    const l = S.ambientes.filter((a) => (filtro === 'TODOS' || a.estado === filtro) && (!t || (a.nombre + ' ' + a.id + ' ' + a.responsable).toUpperCase().includes(t)));
    lista.replaceChildren(...l.map((a) => {
      const r = resumenAmbiente(a.id);
      const pct = r.esperados ? Math.round((r.ubicadosEsperados / r.esperados) * 100) : 0;
      const virtual = a.id === 'SIN_UBICAR';
      return h('button.amb-item' + (a.id === S.ambienteActivo ? '.activo' : '') + (virtual ? '.virtual' : ''), {
        onclick: () => abrir(a)
      },
      h('div.amb-item-t', h('span', a.nombre), h('span.estado.' + a.estado, virtual ? 'VIRTUAL' : a.estado.replace('_', ' '))),
      h('div.amb-item-s', virtual ? 'Bienes del SIGA por buscar: se confirman al escanearlos en cualquier ambiente.' : (a.responsable || 'Responsable por definir') + (a.cambio_uso ? ' · cambio de uso' : '')),
      h('div.amb-item-c', h('div.barra', h('div', { style: `width:${pct}%` })), h('span', `${r.ubicadosEsperados}/${r.esperados}`)));
    }));
  };
  const raiz = h('div.pantalla',
    h('div.titulo', h('h1', 'Ambientes'), h('button.btn.sec.chico', { onclick: () => ir('#/buscar') }, '🔍 Buscar')),
    h('input.buscar', { placeholder: 'Buscar ambiente, número o responsable…', value: texto, oninput: (e) => { texto = e.target.value; pintar(); } }),
    chips, lista);
  pintar();
  const off = suscribir(() => { if (!raiz.isConnected) off(); else pintar(); });
  return raiz;
}

async function abrir(a) {
  if (a.id === 'SIN_UBICAR') {
    ir('#/buscar?amb=SIN_UBICAR');
    return;
  }
  if (a.estado === 'CERRADO') { if (!(await reabrir(a))) return; }
  else if (a.estado !== 'EN_CURSO') await encolar('abrirAmbiente', { ambiente_id: a.id });
  S.ambienteActivo = a.id;
  try { localStorage.setItem('ambienteActivo', a.id); } catch (e) { /* sin almacenamiento */ }
  ir('#/amb/' + encodeURIComponent(a.id));
}

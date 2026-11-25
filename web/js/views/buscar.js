// Búsqueda sin conexión sobre la base guardada en el celular.
import { S, nombreAmbiente } from '../store.js';
import { h } from '../ui.js';
import { fichaBien } from './ficha.js';

let texto = '';

export function vistaBuscar(params) {
  const soloAmb = params.get('amb') || '';
  const lista = h('div.lista');
  const pintar = () => {
    const t = texto.trim().toUpperCase();
    let l = S.bienes;
    if (soloAmb) l = l.filter((b) => b.ambiente_id === soloAmb);
    if (t) {
      const partes = t.split(/\s+/);
      l = l.filter((b) => {
        const s = [b.cod_patrimonial, b.cod_interno, b.serie, b.denominacion, b.marca, b.responsable_ref, b.responsable_siga, b.ambiente_ref, nombreAmbiente(b.ambiente_real_id)].join(' ').toUpperCase();
        return partes.every((p) => s.includes(p));
      });
    } else if (!soloAmb) l = [];
    const total = l.length;
    lista.replaceChildren(
      h('p.ayuda', t || soloAmb ? `${total} resultado(s)${total > 100 ? ' · se muestran 100' : ''}` : 'Busque por código, serie, denominación, responsable o ambiente. Funciona sin conexión.'),
      ...l.slice(0, 100).map((b) => h('button.item' + (b.estado_verif === 'UBICADO' ? '.hecho' : ''), { onclick: () => detalle(b) },
        h('div.item-t', b.cod_patrimonial || b.cod_interno, ' ', h('small', b.tipo_codigo)),
        h('div.item-s', `${b.denominacion} · ${b.marca} · S/${b.serie}`),
        h('div.item-s', b.estado_verif === 'UBICADO' ? `✓ Ubicado en ${nombreAmbiente(b.ambiente_real_id)}` : `Pendiente · ref. ${nombreAmbiente(b.ambiente_id)}`))));
  };
  const inp = h('input.buscar', { placeholder: 'Código, serie, denominación…', value: texto, autofocus: true, oninput: (e) => { texto = e.target.value; pintar(); } });
  const raiz = h('div.pantalla',
    h('div.titulo', h('button.icono', { onclick: () => history.back() }, '‹'), h('h1', soloAmb ? nombreAmbiente(soloAmb) : 'Buscar')),
    inp, lista);
  pintar();
  setTimeout(() => inp.focus(), 50);
  return raiz;
}

function detalle(b) {
  return fichaBien(b);
}

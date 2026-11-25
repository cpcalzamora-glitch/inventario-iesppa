// Registro de sobrantes (bienes que no figuran en la base). Van a la hoja SOBRANTES (inventario aparte).
import { S, ambiente } from '../store.js';
import { encolar } from '../cola.js';
import { h, hoja, toast, selectorEstado } from '../ui.js';

export function abrirSobrante(pre = {}) {
  const amb = ambiente(S.ambienteActivo);
  if (!amb) { toast('Primero abra un ambiente.', 'error'); return Promise.resolve(); }
  if (amb.estado === 'CERRADO') { toast(amb.nombre + ' está cerrado. El administrador debe reabrirlo para registrar sobrantes.', 'error', 4500); return Promise.resolve(); }
  const d = { denominacion: '', marca: '', modelo: '', serie: '', color: '', dimensiones: '', estado_conserv: 'B', cantidad: 1, obs: '', ...pre };
  const denoms = [...new Set(S.bienes.map((b) => b.denominacion))].sort();
  const campo = (k, etiqueta, extra = {}) => h('label.campo', h('span', etiqueta),
    h('input', { value: d[k], autocomplete: 'off', oninput: (e) => { d[k] = e.target.value; }, ...extra }));
  return hoja((cerrar) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!d.denominacion.trim()) { toast('Escriba la denominación.', 'error'); return; }
      const cant = Math.max(1, Math.min(100, Number(d.cantidad) || 1));
      await encolar('registrarSobrante', {
        ambiente_id: amb.id, denominacion: d.denominacion.trim().toUpperCase(), marca: d.marca.trim(), modelo: d.modelo.trim(),
        serie: d.serie.trim(), color: d.color.trim(), dimensiones: d.dimensiones.trim(), estado_conserv: d.estado_conserv,
        cantidad: cant, obs: d.obs.trim()
      });
      toast(S.enLinea ? 'Sobrante registrado: el código S-xxx aparecerá en la pestaña Sobrantes' : 'Sobrante guardado. El código S-xxx se asignará al volver la señal.', 'ok', 3500);
      cerrar(true);
    }
  },
  h('h2', 'Registrar sobrante'),
  h('p.texto.chico', 'Ambiente: ' + amb.nombre + '. Etiqueta TEMPORAL con el código S-xxx que asigna la app.'),
  h('datalist#denoms', denoms.map((x) => h('option', { value: x }))),
  campo('denominacion', 'Denominación *', { list: 'denoms', required: true }),
  h('div.dos', campo('marca', 'Marca'), campo('modelo', 'Modelo')),
  h('div.dos', campo('serie', 'Serie'), campo('color', 'Color')),
  h('div.dos', campo('dimensiones', 'Dimensiones'), campo('cantidad', 'Cantidad', { type: 'number', min: 1, max: 100, inputMode: 'numeric' })),
  h('div.sub', 'Estado de conservación'),
  selectorEstado(d.estado_conserv, (v) => { d.estado_conserv = v; }),
  h('label.campo', h('span', 'Observación'), h('textarea', { rows: 2, value: d.obs, oninput: (e) => { d.obs = e.target.value; } })),
  h('div.botones', h('button.btn.sec', { type: 'button', onclick: () => cerrar(false) }, 'Cancelar'), h('button.btn.pri', { type: 'submit' }, 'Guardar sobrante'))
  ), { completa: true });
}

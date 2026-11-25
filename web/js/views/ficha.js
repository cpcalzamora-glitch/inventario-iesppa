// Ficha del bien: datos, historial y edición (solo ADMIN). v4 – Fase 2.
import { S, ambiente, nombreAmbiente, esAdmin, normalizarCampo, errorCodigo, otrosConCodigo } from '../store.js';
import { encolar } from '../cola.js';
import { llamar } from '../api.js';
import { h, hoja, toast, fechaCorta } from '../ui.js';
import { ir } from '../app.js';

const TIPOS = [['12D', '12 dígitos'], ['8D', '8 dígitos'], ['ALTA', 'Alta'], ['SIN', 'Sin código']];
const NOMBRES = {
  cod_patrimonial: 'Código', tipo_codigo: 'Tipo', serie: 'Serie', marca: 'Marca', modelo: 'Modelo', denominacion: 'Denominación',
  ambiente_real_id: 'Ambiente real', obs_campo: 'Observación', cod_duplicado: 'Duplicado', en_siga: 'En SIGA', apto_etiqueta: 'Apto etiqueta',
  destino_informe: 'Destino informe', estado_verif: 'Verificación', estado_conserv: 'Estado', etiqueta: 'Etiqueta', situacion: 'Situación',
  responsable_real: 'Responsable real', conciliado_con: 'Conciliado con', conciliado_con_siga: 'Concilió la fila SIGA', situacion_especial: 'Situación especial'
};

/** Ficha completa del bien. Desde aquí el ADMIN puede editarla. */
export function fichaBien(b) {
  return hoja((cerrar) => {
    const activo = ambiente(S.ambienteActivo);
    const hist = h('div.historial', h('button.btn.sec.chico', { onclick: () => cargarHistorial(b, hist) }, 'Ver historial del bien'));
    return h('div',
      h('div.ficha',
        h('div.ficha-den', b.denominacion),
        h('div.ficha-cod', b.cod_patrimonial || b.cod_interno, b.cod_duplicado === 'SI' ? h('span.chip.amarillo', 'dup.') : null),
        h('div.ficha-grid',
          ...[['Tipo de código', b.tipo_codigo], ['Cód. interno', b.cod_interno], ['Marca', b.marca], ['Modelo', b.modelo], ['Serie', b.serie], ['Color', b.color],
            ['Dimensiones', b.dimensiones], ['Ambiente ref.', nombreAmbiente(b.ambiente_id)], ['Responsable ref.', b.responsable_ref], ['Estado anterior', b.estado_ref],
            ['En SIGA', b.en_siga], ['Apto etiqueta', b.apto_etiqueta], ['Destino informe', b.destino_informe], ['Obs. ref.', b.obs_ref],
            ['Verificación', b.estado_verif], ['Ambiente real', b.ambiente_real_id ? nombreAmbiente(b.ambiente_real_id) : ''],
            ['Estado actual', b.estado_conserv], ['Situación', b.situacion], ['Etiqueta', b.etiqueta], ['Observación', b.obs_campo],
            ['Verificado por', b.verificado_por ? `${b.verificado_por} ${fechaCorta(b.verificado_en)}` : '']]
            .filter(([, v]) => v).flatMap(([k, v]) => [h('span', k), h('b', v)]))),
      hist,
      h('div.botones',
        h('button.btn.sec', { onclick: () => cerrar() }, 'Cerrar'),
        esAdmin() ? h('button.btn.pri', { onclick: () => { cerrar(); editarFicha(b); } }, '✎ Editar') : null,
        activo && b.tipo_codigo === '12D' ? h('button.btn.sec', { onclick: async () => { cerrar(); const { fichaVerificar } = await import('./flujo.js'); fichaVerificar(b); } }, 'Verificar aquí') : null,
        activo && b.tipo_codigo !== '12D' && b.ambiente_id === activo.id ? h('button.btn.sec', { onclick: () => { cerrar(); ir('#/amb/' + encodeURIComponent(activo.id)); } }, 'Ir al lote') : null));
  }, { completa: true });
}

async function cargarHistorial(b, cont) {
  cont.replaceChildren(h('p.texto.chico', 'Cargando historial…'));
  try {
    const d = await llamar('getHistorialBien', { bien_id: b.id });
    if (!d.filas.length) { cont.replaceChildren(h('p.texto.chico', 'Sin cambios registrados.')); return; }
    cont.replaceChildren(h('div.sub', `Historial (${d.total})`),
      h('div.hist-lista', d.filas.map((f) => h('div.hist-fila',
        h('div.hist-t', h('b', f.accion.replace(/_/g, ' ')), ' · ', f.usuario, ' · ', fechaCorta(f.fecha_hora)),
        h('div.hist-s', `${NOMBRES[f.campo] || f.campo}: `, h('s', f.valor_anterior || '—'), ' → ', h('b', f.valor_nuevo || '—')),
        f.motivo ? h('div.hist-m', 'Motivo: ' + f.motivo) : null))));
  } catch (e) {
    cont.replaceChildren(h('p.texto.chico', e.codigo === 'RED' ? 'El historial necesita conexión.' : e.message),
      h('button.btn.sec.chico', { onclick: () => cargarHistorial(b, cont) }, 'Reintentar'));
  }
}

/** Formulario de edición (solo ADMIN). Valida igual que el servidor antes de encolar. */
export function editarFicha(b) {
  if (!esAdmin()) { toast('Solo el administrador puede editar la ficha.', 'error'); return; }
  const verificado = b.estado_verif === 'UBICADO' || b.estado_verif === 'OBSERVADO';
  const v = { cod_patrimonial: b.cod_patrimonial, tipo_codigo: b.tipo_codigo, serie: b.serie, marca: b.marca, modelo: b.modelo, denominacion: b.denominacion, ambiente_real_id: b.ambiente_real_id, obs_campo: b.obs_campo };
  let motivo = '';
  let aceptaDup = false;
  return hoja((cerrar) => {
    const aviso = h('div');
    const btn = h('button.btn.pri', { onclick: guardar }, 'Guardar');
    const campo = (k, etiqueta, attrs = {}) => h('label.campo', h('span', etiqueta),
      h('input', { value: v[k] || '', autocomplete: 'off', oninput: (e) => { v[k] = e.target.value; validar(); }, ...attrs }));
    const tipos = h('div.chips');
    const pintarTipos = () => tipos.replaceChildren(...TIPOS.map(([k, n]) => h('button.chip-f' + (v.tipo_codigo === k ? '.sel' : ''), { type: 'button', onclick: () => { v.tipo_codigo = k; pintarTipos(); validar(); } }, `${k} · ${n}`)));
    pintarTipos();
    const ambSel = verificado
      ? h('label.campo', h('span', 'Ambiente real (donde está)'),
        h('select', { onchange: (e) => { v.ambiente_real_id = e.target.value; validar(); } },
          S.ambientes.filter((a) => a.id !== 'SIN_UBICAR').map((a) => h('option', { value: a.id, selected: a.id === b.ambiente_real_id }, a.nombre))))
      : h('p.texto.chico', 'Ambiente real: se asigna al verificar el bien.');

    function cambios() {
      const c = {};
      for (const k of Object.keys(v)) {
        const n = normalizarCampo(k, v[k]);
        if (n !== (b[k] || '')) c[k] = n;
      }
      return c;
    }
    function validar() {
      const c = cambios();
      const cod = normalizarCampo('cod_patrimonial', v.cod_patrimonial);
      const msgs = [];
      let bloquea = !Object.keys(c).length || motivo.trim().length < 3;
      const err = errorCodigo(cod, v.tipo_codigo);
      if (err) { msgs.push(h('div.banda.roja', err)); bloquea = true; }
      if (c.denominacion === '') { msgs.push(h('div.banda.roja', 'La denominación no puede quedar vacía.')); bloquea = true; }
      const cambiaCod = c.cod_patrimonial !== undefined || c.tipo_codigo !== undefined;
      const { otros, conciliables } = cambiaCod && v.tipo_codigo === '12D' ? otrosConCodigo(cod, b.id) : { otros: [] };
      if (otros.length) {
        const lista = otros.slice(0, 4).map((x) => `id ${x.id} · ${x.denominacion} · ${nombreAmbiente(x.ambiente_id)}`).join('; ');
        msgs.push(h('div.banda.amarilla', conciliables
          ? `Este código es de la fila SIGA sin ubicar (${lista}). Si es el mismo bien físico, se concilia: la fila SIGA queda marcada con este bien y deja de contar aparte.`
          : `Este código ya existe en ${otros.length} bien(es): ${lista}.`),
        h('label.aviso-apto', h('input', { type: 'checkbox', checked: aceptaDup, onchange: (e) => { aceptaDup = e.target.checked; validar(); } }),
          conciliables ? ' Es el mismo bien: conciliar con la fila SIGA' : ' Acepto el código repetido (quedará "dup.")'));
        if (!aceptaDup) bloquea = true;
      }
      aviso.replaceChildren(...msgs);
      btn.disabled = bloquea;
      btn._conciliar = otros.length && conciliables;
    }
    async function guardar() {
      const c = cambios();
      const extra = btn._conciliar ? { conciliar: true } : (aceptaDup ? { aceptar_duplicado: true } : {});
      await encolar('editarBien', { bien_id: b.id, cambios: c, motivo: motivo.trim(), ambiente_id: b.ambiente_real_id || b.ambiente_id, ...extra });
      toast('Ficha actualizada' + (S.enLinea ? '' : ' (se enviará al tener señal)'));
      cerrar(true);
    }
    setTimeout(validar, 0);
    return h('div',
      h('h2', 'Editar ficha'),
      h('p.texto.chico', `id ${b.id} · ${b.denominacion}`),
      h('div.sub', 'Tipo de código'), tipos,
      campo('cod_patrimonial', 'Código patrimonial', { inputMode: 'numeric' }),
      aviso,
      campo('denominacion', 'Denominación'),
      campo('marca', 'Marca'),
      campo('modelo', 'Modelo'),
      campo('serie', 'Serie'),
      ambSel,
      h('label.campo', h('span', 'Observación'), h('textarea', { rows: 2, maxLength: 200, value: v.obs_campo || '', oninput: (e) => { v.obs_campo = e.target.value; validar(); } })),
      h('label.campo', h('span', 'Motivo del cambio (obligatorio)'), h('textarea', { rows: 2, maxLength: 200, oninput: (e) => { motivo = e.target.value; validar(); } })),
      h('div.botones', h('button.btn.sec', { onclick: () => cerrar(false) }, 'Cancelar'), btn));
  }, { completa: true });
}

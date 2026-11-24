// Ambiente activo: pantalla principal de trabajo.
import { S, ambiente, resumenAmbiente, grupoClave, nombreAmbiente, suscribir } from '../store.js';
import { encolar } from '../cola.js';
import { h, hoja, toast, confirmar, selectorEstado, fechaCorta } from '../ui.js';
import { procesarCodigo, fichaVerificar } from './flujo.js';
import { abrirSobrante } from './sobrante.js';
import { abrirEscaner } from './escaner.js';
import { ir } from '../app.js';

let pestana = 'codigo';
const conteos = {};          // clave de grupo -> número elegido
const estadosGrupo = {};     // clave de grupo -> estado elegido
const abiertos = new Set();  // grupos desplegados

export function vistaAmbiente(id) {
  const amb = ambiente(id);
  if (!amb) { ir('#/ambientes'); return h('div'); }
  const raiz = h('div.pantalla.amb');
  const cuerpo = h('div.cuerpo');
  const cabecera = h('div');

  const pintarCabecera = () => {
    const r = resumenAmbiente(id);
    const pct = r.esperados ? Math.round((r.ubicadosEsperados / r.esperados) * 100) : 0;
    cabecera.replaceChildren(h('div.amb-cab',
      h('div.amb-fila',
        h('button.icono', { onclick: () => ir('#/ambientes'), title: 'Volver' }, '‹'),
        h('div.amb-tit', h('div.amb-nombre', amb.nombre), h('div.amb-ubic', [amb.ubicacion, amb.estado === 'CERRADO' ? 'CERRADO' : ''].filter(Boolean).join(' · ')))),
      h('button.amb-resp', { onclick: () => editarResponsable(amb) }, h('span', 'Responsable: '), h('b', amb.responsable || 'POR DEFINIR'), ' ✎'),
      h('div.amb-cont',
        h('div.big', h('b', r.ubicadosEsperados), ' / ', r.esperados, h('small', ' verificados')),
        h('div.amb-mini', r.deOtros ? `+${r.deOtros} de otros ambientes · ` : '', `Aptos para etiqueta: ${r.aptos}`)),
      h('div.barra', h('div', { style: `width:${pct}%` })),
      h('form.lector', {
        onsubmit: async (e) => {
          e.preventDefault();
          const inp = e.target.querySelector('input');
          const v = inp.value.trim();
          inp.value = '';
          if (v) { await procesarCodigo(v.split('|')[0].trim().toUpperCase()); inp.focus(); }
        }
      }, h('input', { placeholder: 'Escriba el código o use el lector Bluetooth', inputMode: 'numeric', autocomplete: 'off', enterKeyHint: 'go' }),
      h('button.btn.sec', { type: 'submit' }, 'Buscar')),
      h('div.tabs', [['codigo', 'Con código'], ['lote', 'Por lote'], ['altas', 'Altas 2025'], ['sobr', 'Sobrantes']].map(([k, n]) =>
        h('button.tab' + (pestana === k ? '.sel' : ''), { onclick: () => { pestana = k; pintar(); } }, n, h('small', ' ' + contarPestana(id, k)))))));
  };

  const pintar = () => {
    pintarCabecera();
    if (pestana === 'codigo') cuerpo.replaceChildren(listaConCodigo(id));
    else if (pestana === 'lote') cuerpo.replaceChildren(listaLotes(id, 'LOTE', pintar));
    else if (pestana === 'altas') cuerpo.replaceChildren(listaLotes(id, 'ALTA', pintar));
    else cuerpo.replaceChildren(listaSobrantes(id));
  };

  const pie = h('div.pie',
    h('button.btn.sec', { onclick: () => abrirSobrante() }, '+ Sobrante'),
    h('button.btn.pri.grande', { onclick: () => abrirEscaner() }, '▣ Escanear'),
    h('button.btn.sec', { onclick: () => cerrarAmbiente(amb) }, 'Cerrar amb.'));

  raiz.append(cabecera, cuerpo, pie);
  pintar();
  const off = suscribir(() => { if (!raiz.isConnected) { off(); return; } if (!document.querySelector('.hoja-fondo')) pintar(); else pintarCabecera(); });
  return raiz;
}

function contarPestana(id, k) {
  if (k === 'codigo') {
    const l = S.bienes.filter((b) => b.tipo_codigo === '12D' && (b.ambiente_id === id || b.ambiente_real_id === id));
    return `${l.filter((b) => b.estado_verif === 'UBICADO').length}/${l.length}`;
  }
  if (k === 'sobr') return String(S.sobrantes.filter((s) => s.ambiente_id === id).length + S.sobrantesLocales.filter((s) => s.ambiente_id === id).reduce((n, s) => n + Number(s.cantidad || 1), 0));
  const tipo = k === 'altas' ? 'ALTA' : 'LOTE';
  const l = S.bienes.filter((b) => b.ambiente_id === id && b.tipo_codigo !== '12D' && (tipo === 'ALTA') === (b.tipo_codigo === 'ALTA'));
  return `${l.filter((b) => b.estado_verif === 'UBICADO').length}/${l.length}`;
}

function listaConCodigo(id) {
  const l = S.bienes.filter((b) => b.tipo_codigo === '12D' && (b.ambiente_id === id || b.ambiente_real_id === id));
  if (!l.length) return h('p.vacio', 'Este ambiente no tiene bienes con código de 12 dígitos.');
  l.sort((a, b) => (a.estado_verif === 'UBICADO') - (b.estado_verif === 'UBICADO') || a.cod_patrimonial.localeCompare(b.cod_patrimonial));
  return h('div.lista', l.map((b) => {
    const ok = b.estado_verif === 'UBICADO';
    const aqui = ok && b.ambiente_real_id === id;
    const fuera = ok && !aqui;
    return h('button.item' + (aqui ? '.hecho' : '') + (fuera ? '.fuera' : ''), { onclick: () => fichaVerificar(b) },
      h('div.item-t', h('span.marca', aqui ? '✓' : fuera ? '→' : '○'), ' ', b.cod_patrimonial, ' ', b.apto_etiqueta === 'SI' ? h('span.chip', 'apto') : null, b.cod_duplicado === 'SI' ? h('span.chip.amarillo', 'dup.') : null),
      h('div.item-s', `${b.denominacion} · ${b.marca} · S/${b.serie}`),
      aqui ? h('div.item-s.ok', `${b.estado_conserv} · ${b.verificado_por} ${fechaCorta(b.verificado_en)}`) : null,
      fuera ? h('div.item-s.alerta', `Ubicado en ${nombreAmbiente(b.ambiente_real_id)}`) : null,
      b.ambiente_id !== id && b.ambiente_real_id === id ? h('div.item-s.alerta', `Viene de ${nombreAmbiente(b.ambiente_id)}`) : null);
  }));
}

function grupos(id, tipo) {
  const m = new Map();
  for (const b of S.bienes) {
    if (b.ambiente_id !== id || b.tipo_codigo === '12D') continue;
    if ((tipo === 'ALTA') !== (b.tipo_codigo === 'ALTA')) continue;
    const k = grupoClave(b);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(b);
  }
  for (const v of m.values()) v.sort((a, b) => Number(a.id) - Number(b.id));
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

function moda(arr) {
  const c = {};
  arr.forEach((v) => { if (v) c[v] = (c[v] || 0) + 1; });
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || 'B';
}

function listaLotes(id, tipo, repintar) {
  const gs = grupos(id, tipo);
  if (!gs.length) return h('p.vacio', tipo === 'ALTA' ? 'No hay altas 2025 en este ambiente.' : 'No hay bienes sin código de 12 dígitos en este ambiente.');
  const amb = ambiente(id);
  return h('div.lista', h('p.ayuda', 'Cuente los bienes iguales, elija el estado y confirme. Llevan etiqueta TEMPORAL con el número de referencia que muestra la app.'),
    gs.map(([k, filas]) => {
      const pend = filas.filter((b) => b.estado_verif !== 'UBICADO');
      const ubic = filas.length - pend.length;
      if (conteos[k] === undefined) conteos[k] = 0;
      if (!estadosGrupo[k]) estadosGrupo[k] = moda(filas.map((b) => b.estado_ref));
      const n = conteos[k];
      const exceso = Math.max(0, n - pend.length);
      const b0 = filas[0];
      const valor = h('input.num', {
        type: 'number', min: 0, inputMode: 'numeric', value: n,
        onchange: (e) => { conteos[k] = Math.max(0, Number(e.target.value) || 0); repintar(); }
      });
      const confirmarN = async () => {
        const usar = Math.min(n, pend.length);
        if (!usar) return;
        const elegidos = pend.slice(0, usar);
        await encolar('verificarLote', { ambiente_id: id, bien_ids: elegidos.map((b) => b.id), estado_conserv: estadosGrupo[k], responsable: amb.responsable });
        const refs = elegidos.map((b) => b.cod_interno);
        conteos[k] = 0;
        toast(`✓ ${usar} ubicada(s). Etiquetas TEMPORALES: ${refs.length > 6 ? refs[0] + ' … ' + refs[refs.length - 1] : refs.join(', ')}`, 'ok', 4500);
        repintar();
      };
      return h('div.grupo' + (pend.length ? '' : '.completo'),
        h('div.grupo-t', b0.denominacion),
        h('div.grupo-s', [b0.color, b0.marca, b0.modelo, b0.dimensiones].filter((x) => x && x !== 'S.M.' && x !== 'S/M').join(' · ')),
        h('div.grupo-c', `Esperadas ${filas.length} · Ubicadas `, h('b', ubic), ` · Pendientes ${pend.length}`),
        pend.length || n ? h('div.grupo-acc',
          h('div.stepper',
            h('button', { onclick: () => { conteos[k] = Math.max(0, n - 1); repintar(); } }, '−'),
            valor,
            h('button', { onclick: () => { conteos[k] = n + 1; repintar(); } }, '+')),
          h('button.btn.sec.chico', { onclick: () => { conteos[k] = pend.length; repintar(); } }, `Todas (${pend.length})`)) : null,
        n ? selectorEstado(estadosGrupo[k], (v) => { estadosGrupo[k] = v; }) : null,
        exceso ? h('div.banda.amarilla', `Contó ${exceso} más de las esperadas.`,
          h('button.btn.sec.chico', { onclick: () => abrirSobrante({ denominacion: b0.denominacion, marca: b0.marca, modelo: b0.modelo, color: b0.color, dimensiones: b0.dimensiones, cantidad: exceso, estado_conserv: estadosGrupo[k] }) }, `Registrar ${exceso} sobrante(s)`)) : null,
        n && pend.length ? h('button.btn.pri', { onclick: confirmarN }, `Confirmar ${Math.min(n, pend.length)} ubicada(s)`) : null,
        h('button.desplegar', { onclick: () => { abiertos.has(k) ? abiertos.delete(k) : abiertos.add(k); repintar(); } }, abiertos.has(k) ? 'Ocultar detalle ▲' : 'Ver uno por uno ▼'),
        abiertos.has(k) ? h('div.filas', filas.map((b) => h('div.fila' + (b.estado_verif === 'UBICADO' ? '.hecho' : ''),
          h('span.ref', b.tipo_codigo === 'ALTA' ? b.cod_interno : 'Ref. ' + b.cod_interno),
          h('span.det', b.estado_verif === 'UBICADO' ? `✓ ${b.estado_conserv} · ${b.verificado_por}` : `Pendiente · ant. ${b.estado_ref || '—'}${b.serie && b.serie !== 'S.S.' ? ' · S/' + b.serie : ''}`),
          b.estado_verif === 'UBICADO' ? null : h('button.btn.sec.chico', {
            onclick: async () => {
              await encolar('verificarLote', { ambiente_id: id, bien_ids: [b.id], estado_conserv: estadosGrupo[k], responsable: amb.responsable });
              toast(`✓ ${b.cod_interno} ubicada · etiqueta TEMPORAL`);
            }
          }, 'Marcar')))) : null);
    }));
}

function listaSobrantes(id) {
  const serv = S.sobrantes.filter((s) => s.ambiente_id === id);
  const loc = S.sobrantesLocales.filter((s) => s.ambiente_id === id);
  return h('div.lista',
    h('button.btn.pri', { onclick: () => abrirSobrante() }, '+ Registrar sobrante'),
    !serv.length && !loc.length ? h('p.vacio', 'Sin sobrantes en este ambiente.') : null,
    loc.map((s) => h('div.item.pend', h('div.item-t', '⏳ ', s.denominacion, ' × ', s.cantidad), h('div.item-s', 'Código S-xxx pendiente: se asigna al sincronizar.'))),
    serv.slice().reverse().map((s) => h('div.item', h('div.item-t', h('b', s.cod_sobrante), ' ', s.denominacion), h('div.item-s', [s.marca, s.modelo, s.serie, s.color, s.estado_conserv, s.registrado_por].filter(Boolean).join(' · ')))));
}

function editarResponsable(amb) {
  const nombres = [...new Set([amb.responsable, ...S.personal.map((p) => p.nombre)].filter(Boolean))];
  let filtro = '';
  return hoja((cerrar) => {
    const lista = h('div.lista');
    const pintar = () => lista.replaceChildren(...nombres.filter((n) => n.toUpperCase().includes(filtro.toUpperCase())).map((n) =>
      h('button.item' + (n === amb.responsable ? '.hecho' : ''), {
        onclick: async () => {
          if (n !== amb.responsable) { await encolar('editarResponsableAmbiente', { ambiente_id: amb.id, responsable: n }); toast('Responsable actualizado'); }
          cerrar();
        }
      }, h('div.item-t', n), h('div.item-s', (S.personal.find((p) => p.nombre === n) || {}).cargo || ''))));
    pintar();
    return h('div', h('h2', 'Responsable del ambiente'),
      h('input.buscar', { placeholder: 'Buscar en el personal 2026…', oninput: (e) => { filtro = e.target.value; pintar(); } }),
      lista, h('div.botones', h('button.btn.sec', { onclick: () => cerrar() }, 'Cancelar')));
  }, { completa: true });
}

async function cerrarAmbiente(amb) {
  const pend = S.bienes.filter((b) => b.ambiente_id === amb.id && b.estado_verif !== 'UBICADO');
  const r = resumenAmbiente(amb.id);
  const sobr = S.sobrantes.filter((s) => s.ambiente_id === amb.id).length + S.sobrantesLocales.filter((s) => s.ambiente_id === amb.id).reduce((n, s) => n + Number(s.cantidad || 1), 0);
  const ok = await hoja((cerrar) => h('div',
    h('h2', 'Cerrar ' + amb.nombre),
    h('div.resumen',
      h('div', h('b', r.ubicadosAqui), h('small', 'ubicados aquí')),
      h('div', h('b', pend.length), h('small', 'pendientes')),
      h('div', h('b', sobr), h('small', 'sobrantes'))),
    pend.length ? h('p.texto.chico', 'Los pendientes NO pasan a faltantes: quedan "no ubicados en su ambiente" para el inventario aparte.') : null,
    pend.length ? h('div.lista.corta', pend.slice(0, 80).map((b) => h('div.fila', h('span.ref', b.cod_patrimonial || b.cod_interno), h('span.det', b.denominacion)))) : null,
    h('div.botones', h('button.btn.sec', { onclick: () => cerrar(false) }, 'Seguir trabajando'), h('button.btn.pri', { onclick: () => cerrar(true) }, 'Cerrar ambiente'))), { completa: true });
  if (!ok) return;
  await encolar('cerrarAmbiente', { ambiente_id: amb.id });
  S.ambienteActivo = '';
  toast('Ambiente cerrado');
  ir('#/ambientes');
}

export async function reabrir(amb) {
  if (await confirmar('Reabrir ambiente', `${amb.nombre} está cerrado. ¿Abrirlo de nuevo para seguir verificando?`, { si: 'Reabrir' })) {
    await encolar('abrirAmbiente', { ambiente_id: amb.id });
    return true;
  }
  return false;
}

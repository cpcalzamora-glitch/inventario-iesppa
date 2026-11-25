// Ambiente activo: pantalla principal de trabajo.
import { S, ambiente, resumenAmbiente, grupoClave, nombreAmbiente, suscribir, sobrantesDe, esAdmin } from '../store.js';
import { encolar } from '../cola.js';
import { h, hoja, toast, confirmar, pedirMotivo, selectorEstado, selectorSituacion, fechaCorta } from '../ui.js';
import { procesarCodigo, fichaVerificar, anularVerificacion } from './flujo.js';
import { abrirSobrante } from './sobrante.js';
import { abrirEscaner } from './escaner.js';
import { ir } from '../app.js';
import { descargarConstancia, dniDe } from '../constancia.js';

let pestana = 'codigo';
const conteos = {};          // clave de grupo -> número elegido
const estadosGrupo = {};     // clave de grupo -> estado elegido
const situacionGrupo = {};   // clave de grupo -> U/D
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
        h('div.amb-tit', h('div.amb-nombre', amb.nombre), h('div.amb-ubic', [amb.ubicacion, amb.estado === 'CERRADO' ? 'CERRADO' : ''].filter(Boolean).join(' · '))),
        esAdmin() ? h('button.icono', { onclick: () => menuAdmin(amb), title: 'Opciones del administrador' }, '⋯') : null),
      h('button.amb-resp', { onclick: () => editarResponsable(amb) }, h('span', 'Responsable: '), h('b', amb.responsable || 'POR DEFINIR'), ' ✎'),
      amb.constancia_estado === 'IMPRESA' ? h('div.constancia-pend',
        h('div', h('b', 'Constancia impresa · falta la firma'), h('small', ' ' + fechaCorta(amb.constancia_fecha))),
        h('div.botones',
          h('button.btn.sec.chico', { onclick: () => bajarPdf(amb, amb.constancia_fecha) }, 'PDF'),
          h('button.btn.pri.chico', { onclick: () => marcarFirmada(amb) }, 'Marcar FIRMADA'))) : null,
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
  if (amb.estado === 'CERRADO') {
    pie.replaceChildren(esAdmin()
      ? h('button.btn.pri.grande', { onclick: async () => { if (await reabrir(amb)) ir('#/amb/' + encodeURIComponent(amb.id)); } }, 'Reabrir ambiente')
      : h('p.texto.chico', 'Ambiente cerrado con constancia firmada. Solo el administrador puede reabrirlo.'));
  }

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
  if (k === 'sobr') return String(sobrantesDe(id).length + S.sobrantesLocales.filter((s) => s.ambiente_id === id).reduce((n, s) => n + Number(s.cantidad || 1), 0));
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
      h('div.item-t', h('span.marca', aqui ? '✓' : fuera ? '→' : '○'), ' ', b.cod_patrimonial, ' ', b.apto_etiqueta === 'SI' ? h('span.chip', 'apto') : null, b.cod_duplicado === 'SI' ? h('span.chip.amarillo', 'dup.') : null, b.situacion_especial ? h('span.chip.rojo', 'referido entregado') : null),
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
        await encolar('verificarLote', { ambiente_id: id, bien_ids: elegidos.map((b) => b.id), estado_conserv: estadosGrupo[k], situacion: situacionGrupo[k] || 'U', responsable: amb.responsable });
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
        n ? selectorSituacion(situacionGrupo[k] || 'U', (v) => { situacionGrupo[k] = v; }) : null,
        exceso ? h('div.banda.amarilla', `Contó ${exceso} más de las esperadas.`,
          h('button.btn.sec.chico', { onclick: () => abrirSobrante({ denominacion: b0.denominacion, marca: b0.marca, modelo: b0.modelo, color: b0.color, dimensiones: b0.dimensiones, cantidad: exceso, estado_conserv: estadosGrupo[k] }) }, `Registrar ${exceso} sobrante(s)`)) : null,
        n && pend.length ? h('button.btn.pri', { onclick: confirmarN }, `Confirmar ${Math.min(n, pend.length)} ubicada(s)`) : null,
        h('button.desplegar', { onclick: () => { abiertos.has(k) ? abiertos.delete(k) : abiertos.add(k); repintar(); } }, abiertos.has(k) ? 'Ocultar detalle ▲' : 'Ver uno por uno ▼'),
        abiertos.has(k) ? h('div.filas', filas.map((b) => h('div.fila' + (b.estado_verif === 'UBICADO' ? '.hecho' : ''),
          h('span.ref', b.tipo_codigo === 'ALTA' ? b.cod_interno : 'Ref. ' + b.cod_interno),
          h('span.det', b.estado_verif === 'UBICADO' ? `✓ ${b.estado_conserv} · ${b.verificado_por}` : `Pendiente · ant. ${b.estado_ref || '—'}${b.serie && b.serie !== 'S.S.' ? ' · S/' + b.serie : ''}`),
          b.estado_verif === 'UBICADO' ? (b.ambiente_real_id === id && amb.estado !== 'CERRADO' ? h('button.btn.sec.chico', { onclick: () => anularVerificacion(b) }, 'Anular') : null) : h('button.btn.sec.chico', {
            onclick: async () => {
              await encolar('verificarLote', { ambiente_id: id, bien_ids: [b.id], estado_conserv: estadosGrupo[k], situacion: situacionGrupo[k] || 'U', responsable: amb.responsable });
              toast(`✓ ${b.cod_interno} ubicada · etiqueta TEMPORAL`);
            }
          }, 'Marcar')))) : null);
    }));
}

function listaSobrantes(id) {
  const serv = sobrantesDe(id);
  const cerrado = (ambiente(id) || {}).estado === 'CERRADO';
  const loc = S.sobrantesLocales.filter((s) => s.ambiente_id === id);
  return h('div.lista',
    h('button.btn.pri', { onclick: () => abrirSobrante() }, '+ Registrar sobrante'),
    !serv.length && !loc.length ? h('p.vacio', 'Sin sobrantes en este ambiente.') : null,
    loc.map((s) => h('div.item.pend', h('div.item-t', '⏳ ', s.denominacion, ' × ', s.cantidad), h('div.item-s', 'Código S-xxx pendiente: se asigna al sincronizar.'))),
    serv.slice().reverse().map((s) => h('div.item', h('div.item-t', h('b', s.cod_sobrante), ' ', s.denominacion), h('div.item-s', [s.marca, s.modelo, s.serie, s.color, s.estado_conserv, s.registrado_por].filter(Boolean).join(' · ')),
      cerrado ? null : h('button.btn.sec.chico', { onclick: () => anularSobrante(s) }, 'Anular'))));
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
  if (amb.estado === 'CERRADO') { toast('El ambiente ya está cerrado.', 'error'); return; }
  const pend = S.bienes.filter((b) => b.ambiente_id === amb.id && b.estado_verif !== 'UBICADO');
  const r = resumenAmbiente(amb.id);
  const sinCodigo = S.sobrantesLocales.filter((s) => s.ambiente_id === amb.id && !s.codigos);
  const sobr = sobrantesDe(amb.id).length + sinCodigo.reduce((n, s) => n + Number(s.cantidad || 1), 0);
  const ok = await hoja((cerrar) => h('div',
    h('h2', 'Cerrar ' + amb.nombre),
    h('div.resumen',
      h('div', h('b', r.ubicadosAqui), h('small', 'ubicados aquí')),
      h('div', h('b', pend.length), h('small', 'pendientes')),
      h('div', h('b', sobr), h('small', 'sobrantes'))),
    pend.length ? h('p.texto.chico', 'Los pendientes NO pasan a faltantes: quedan "no ubicados en su ambiente" para el inventario aparte.') : null,
    pend.length ? h('div.lista.corta', pend.slice(0, 80).map((b) => h('div.fila', h('span.ref', b.cod_patrimonial || b.cod_interno), h('span.det', b.denominacion)))) : null,
    h('p.texto.chico', 'Se genera la CONSTANCIA DE VERIFICACIÓN FÍSICA en PDF con lo verificado en este ambiente, para imprimirla y firmarla. El ambiente queda cerrado cuando marque la constancia como FIRMADA.'),
    h('div.botones', h('button.btn.sec', { onclick: () => cerrar(false) }, 'Seguir trabajando'), h('button.btn.pri', { onclick: () => cerrar(true) }, 'Generar constancia'))), { completa: true });
  if (!ok) return;
  if (!amb.responsable) { toast('Primero indique el responsable del ambiente (toque "Responsable").', 'error', 4000); return; }
  if (sinCodigo.length) {
    toast('Hay sobrantes sin código S-xxx. Sincronice (necesita señal) y vuelva a generar la constancia.', 'error', 5000);
    return;
  }
  if (!dniDe(amb.responsable) && !(await confirmar('Responsable sin DNI', `"${amb.responsable}" no figura en la lista del personal 2026, así que la constancia saldrá sin DNI (con espacio para escribirlo). ¿Continuar?`, { si: 'Continuar' }))) return;
  const fecha = new Date().toISOString();
  if (!(await bajarPdf(amb, fecha))) return;
  await encolar('cerrarAmbiente', { ambiente_id: amb.id, ts: fecha });
  await pasoFirma(amb);
}

async function bajarPdf(amb, fecha) {
  try {
    toast('Generando la constancia…', 'ok', 1500);
    const r = await descargarConstancia(amb, fecha);
    toast(`Constancia descargada: ${r.total} bienes, ${r.paginas} página(s)`, 'ok', 3500);
    return true;
  } catch (e) {
    toast('No se pudo generar la constancia: ' + e.message, 'error', 5000);
    return false;
  }
}

async function pasoFirma(amb) {
  const op = await hoja((cerrar) => h('div',
    h('h2', 'Constancia generada'),
    h('p.texto', 'Imprímala (A4 horizontal), hágala firmar y sellar por el responsable, el inventariador y el responsable de Patrimonio.'),
    h('p.texto.chico', 'Si después verifica o registra algo más en este ambiente, la constancia queda desactualizada y habrá que generarla de nuevo.'),
    h('div.botones', h('button.btn.sec', { onclick: () => cerrar('luego') }, 'Firmar después'), h('button.btn.pri', { onclick: () => cerrar('firmar') }, 'Ya está FIRMADA'))));
  if (op === 'firmar') await marcarFirmada(amb);
}

async function marcarFirmada(amb) {
  if (amb.constancia_estado !== 'IMPRESA') { toast('La constancia quedó desactualizada: genérela de nuevo con "Cerrar amb.".', 'error', 4500); return; }
  if (!(await confirmar('Constancia firmada', `¿${amb.responsable} firmó y selló la constancia impresa? El ambiente quedará CERRADO.`, { si: 'Sí, cerrar ambiente' }))) return;
  await encolar('firmarConstancia', { ambiente_id: amb.id, firmante: amb.responsable });
  S.ambienteActivo = '';
  try { localStorage.removeItem('ambienteActivo'); } catch (e) { /* sin almacenamiento */ }
  toast('Ambiente cerrado con constancia firmada');
  ir('#/ambientes');
}

export async function reabrir(amb) {
  if (!esAdmin()) { toast(amb.nombre + ' está cerrado con constancia firmada. Solo el administrador puede reabrirlo.', 'error', 4500); return false; }
  const motivo = await pedirMotivo('Reabrir ' + amb.nombre,
    'Vuelve a EN CURSO y se conserva todo lo verificado. La constancia firmada queda en el HISTORIAL y habrá que generar una nueva.',
    { si: 'Reabrir', opciones: ['Faltó verificar bienes', 'Corregir un error', 'Bien encontrado después'] });
  if (!motivo) return false;
  await encolar('abrirAmbiente', { ambiente_id: amb.id, motivo });
  toast('Ambiente reabierto');
  return true;
}

async function anularSobrante(s) {
  const motivo = await pedirMotivo('Anular sobrante ' + s.cod_sobrante,
    s.denominacion + '. La fila no se borra: queda marcada como anulada y el registro queda en el HISTORIAL.',
    { si: 'Anular', peligro: true, opciones: ['Registrado por error', 'Duplicado', 'Era un bien con código'] });
  if (!motivo) return;
  await encolar('anularSobrante', { cod_sobrante: s.cod_sobrante, ambiente_id: s.ambiente_id, motivo });
  toast('Sobrante anulado');
}

/** Opciones solo para el ADMIN. */
async function menuAdmin(amb) {
  const op = await hoja((cerrar) => h('div',
    h('h2', 'Administrador · ' + amb.nombre),
    h('div.lista',
      amb.estado === 'CERRADO' ? h('button.item', { onclick: () => cerrar('reabrir') }, h('div.item-t', 'Reabrir ambiente'), h('div.item-s', 'Vuelve a EN CURSO y conserva lo verificado.')) : null,
      h('button.item', { onclick: () => cerrar('reiniciar') }, h('div.item-t', '⚠ Reiniciar ambiente (pruebas)'), h('div.item-s', 'Todos sus bienes verificados vuelven a pendiente y sus sobrantes se anulan. Queda copia en el HISTORIAL.'))),
    h('div.botones', h('button.btn.sec', { onclick: () => cerrar(null) }, 'Cerrar'))));
  if (op === 'reabrir') { if (await reabrir(amb)) ir('#/amb/' + encodeURIComponent(amb.id)); }
  else if (op === 'reiniciar') await reiniciar(amb);
}

async function reiniciar(amb) {
  const nB = S.bienes.filter((b) => b.ambiente_real_id === amb.id && (b.estado_verif === 'UBICADO' || b.estado_verif === 'OBSERVADO')).length;
  const nS = sobrantesDe(amb.id).length;
  if (S.sobrantesLocales.some((s) => s.ambiente_id === amb.id)) { toast('Hay sobrantes sin sincronizar en este ambiente. Espere a que se sincronicen.', 'error', 4500); return; }
  // Doble confirmación: primero el aviso, luego motivo + escribir REINICIAR.
  if (!(await confirmar('Reiniciar ' + amb.nombre, `Se quitarán las verificaciones de ${nB} bien(es) (vuelven a PENDIENTE) y se anularán ${nS} sobrante(s). El ambiente vuelve a PENDIENTE. No se borra ninguna fila: todo queda en el HISTORIAL. Úselo solo para pruebas.`, { si: 'Continuar', peligro: true }))) return;
  const motivo = await pedirMotivo('Confirmar reinicio', 'Segunda confirmación.', { si: 'Reiniciar ambiente', peligro: true, clave: 'REINICIAR', opciones: ['Prueba piloto'] });
  if (!motivo) return;
  await encolar('reiniciarAmbiente', { ambiente_id: amb.id, motivo });
  S.ambienteActivo = '';
  try { localStorage.removeItem('ambienteActivo'); } catch (e) { /* sin almacenamiento */ }
  toast(`${amb.nombre} reiniciado: ${nB} bien(es) a pendiente`);
  ir('#/ambientes');
}

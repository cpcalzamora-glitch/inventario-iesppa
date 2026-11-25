// Qué hacer con un código leído (cámara, lector Bluetooth o escrito a mano).
import { S, ambiente, nombreAmbiente, esAdmin } from '../store.js';
import { encolar } from '../cola.js';
import { h, hoja, toast, beep, fechaCorta, selectorEstado, selectorSituacion, pedirMotivo } from '../ui.js';
import { REFERIDO } from '../store.js';
import { abrirSobrante } from './sobrante.js';

/** Devuelve una promesa que se resuelve cuando el usuario termina (para reanudar la cámara). */
export async function procesarCodigo(codigo) {
  const amb = ambiente(S.ambienteActivo);
  if (!amb) { toast('Primero abra un ambiente.', 'error'); return; }
  if (amb.estado === 'CERRADO') { beep(false); toast(amb.nombre + ' está cerrado con constancia firmada. Para verificar, el administrador debe reabrirlo.', 'error', 4500); return; }
  const lista = S.porCodigo.get(codigo) || [];
  // Solo existen códigos de 8 o 12 dígitos: otra longitud se avisa y no se asume (ni se completa ni se recorta).
  if (/^\d+$/.test(codigo) && codigo.length !== 8 && codigo.length !== 12) { beep(false); return longitudInvalida(codigo, lista); }
  if (!lista.length) { beep(false); return noExiste(codigo); }
  const c12 = lista.filter((b) => b.tipo_codigo === '12D');
  if (!c12.length) {
    beep(false);
    return hoja((cerrar) => h('div',
      h('h2', 'Código de catálogo (sin correlativo)'),
      h('p.texto', `El código ${codigo} lo comparten ${lista.length} bienes (${lista[0].denominacion}). No se puede distinguir escaneando.`),
      h('p.texto', 'Verifíquelos contando en la pestaña "Por lote". Llevan etiqueta TEMPORAL.'),
      h('div.botones', h('button.btn.pri', { onclick: () => cerrar() }, 'Entendido'))));
  }
  beep(true);
  let b = c12[0];
  if (c12.length > 1) {
    b = await elegirDuplicado(codigo, c12);
    if (!b) return;
  }
  return fichaVerificar(b);
}

function longitudInvalida(codigo, lista) {
  return hoja((cerrar) => h('div',
    h('div.banda.roja', `Código de ${codigo.length} dígitos: no válido`),
    h('h2.codigo', codigo),
    h('p.texto', 'Los códigos patrimoniales tienen 8 o 12 dígitos. La app no asume a cuál corresponde. Revise la etiqueta y vuelva a leerla, o escriba el código completo a mano.'),
    lista.length ? h('p.texto.chico', `En la base figura así en ${lista.length} bien(es): ${lista[0].denominacion} (Ref. ${lista[0].cod_interno || '—'}). Verifíquelo en la pestaña "Por lote" y anote la observación.`) : null,
    h('div.botones', h('button.btn.pri', { onclick: () => cerrar() }, 'Reintentar'))));
}

function noExiste(codigo) {
  return hoja((cerrar) => h('div',
    h('div.banda.roja', 'Código no encontrado'),
    h('h2.codigo', codigo),
    h('p.texto', 'No figura en la base. Puede ser una etiqueta mal leída: vuelva a intentar. Si el bien existe y no está en la base, regístrelo como sobrante.'),
    h('div.botones',
      h('button.btn.sec', { onclick: () => cerrar() }, 'Reintentar'),
      h('button.btn.pri', { onclick: async () => { cerrar(); await abrirSobrante({ obs: 'Etiqueta leída: ' + codigo }); } }, 'Registrar sobrante'))));
}

function elegirDuplicado(codigo, filas) {
  return hoja((cerrar) => h('div',
    h('div.banda.amarilla', `Código repetido: ${filas.length} bienes`),
    h('h2.codigo', codigo),
    h('p.texto', 'Elija el bien que tiene delante comparando la SERIE:'),
    h('div.lista', filas.map((b) => h('button.item' + (b.estado_verif === 'UBICADO' ? '.hecho' : ''), { onclick: () => cerrar(b) },
      h('div.item-t', 'Serie: ', h('b', b.serie || 'S/S')),
      h('div.item-s', `${b.denominacion} · ${b.marca} · ${nombreAmbiente(b.ambiente_id)}`),
      b.estado_verif === 'UBICADO' ? h('div.item-s.ok', `✓ Ya ubicado en ${nombreAmbiente(b.ambiente_real_id)}`) : null))),
    h('div.botones', h('button.btn.sec', { onclick: () => cerrar(null) }, 'Cancelar'))), { completa: true });
}

/** Ficha breve con estado y botón Confirmar. */
export async function fichaVerificar(b) {
  const amb = ambiente(S.ambienteActivo);
  // Sin ambiente abierto, o cerrado: solo se muestra la ficha (no se puede verificar).
  if (!amb || amb.estado === 'CERRADO') { const { fichaBien } = await import('./ficha.js'); return fichaBien(b); }
  let estado = b.estado_conserv || b.estado_ref || 'B';
  let situacion = b.situacion || 'U';
  const referido = b.situacion_especial === REFERIDO
    ? h('div.banda.roja', 'Este bien fue referido como ENTREGADO SIN BAJA' + (b.ref_declaracion ? ' (declaración ' + b.ref_declaracion + ')' : '') + '. Si está aquí, confírmelo: se quitará la marca.')
    : null;
  let mover = false;
  let banda = null;
  let obs = '';
  const yaAqui = b.estado_verif === 'UBICADO' && b.ambiente_real_id === amb.id;
  const yaOtro = b.estado_verif === 'UBICADO' && b.ambiente_real_id && b.ambiente_real_id !== amb.id;

  if (yaAqui) banda = h('div.banda.verde', `Ya verificado aquí por ${b.verificado_por} (${fechaCorta(b.verificado_en)})`);
  else if (yaOtro) { banda = h('div.banda.roja', `Ya verificado por ${b.verificado_por} el ${fechaCorta(b.verificado_en)} en ${nombreAmbiente(b.ambiente_real_id)}`); mover = true; }
  else if (b.ambiente_id === 'SIN_UBICAR') banda = h('div.banda.verde', 'Encontrado (estaba sin ubicar en el SIGA)');
  else if (b.ambiente_id !== amb.id) banda = h('div.banda.amarilla', `Según el inventario está en ${nombreAmbiente(b.ambiente_id)}`);

  const noApto = b.tipo_codigo === '12D' && b.apto_etiqueta !== 'SI' && !yaAqui;
  return hoja((cerrar) => {
    const chk = noApto ? h('input', { type: 'checkbox', id: 'chkApto', onchange: () => { btn.disabled = !chk.checked; } }) : null;
    const btn = h('button.btn.pri.grande', {
      disabled: noApto,
      onclick: async () => {
        await encolar('verificar', {
          bien_id: b.id, ambiente_id: amb.id, estado_conserv: estado, situacion, responsable: amb.responsable,
          version_cliente: b.version, mover: mover || undefined, obs: obs || undefined
        });
        toast(yaOtro ? '✓ Movido a este ambiente' : (referido ? '✓ Ubicado · se quitó la marca de "entregado sin baja"' : '✓ Ubicado · pegar etiqueta DEFINITIVA'));
        cerrar(true);
      }
    }, yaAqui ? 'Actualizar estado' : (yaOtro ? 'Mover a este ambiente' : (b.ambiente_id !== amb.id && b.ambiente_id !== 'SIN_UBICAR' ? 'Confirmar aquí' : 'Confirmar'))
    );
    return h('div',
      referido,
      banda,
      h('div.ficha',
        h('div.ficha-den', b.denominacion),
        h('div.ficha-cod', b.cod_patrimonial, b.cod_duplicado === 'SI' ? h('span.chip.amarillo', 'duplicado') : null),
        h('div.ficha-grid',
          h('span', 'Marca'), h('b', b.marca || '—'),
          h('span', 'Modelo'), h('b', b.modelo || '—'),
          h('span', 'Serie'), h('b', b.serie || '—'),
          h('span', 'Color'), h('b', b.color || '—'),
          h('span', 'Cód. interno'), h('b', b.cod_interno || '—'),
          h('span', 'Ambiente ref.'), h('b', nombreAmbiente(b.ambiente_id)),
          h('span', 'Estado anterior'), h('b', b.estado_ref || '—'))),
      h('div.etiq', 'Etiqueta: ', h('b', 'DEFINITIVA'), ' (código de 12 dígitos)'),
      noApto ? h('label.aviso-apto', chk, ' No figura como apto para etiqueta. Confirmo que el código y la serie coinciden con el bien.') : null,
      h('div.sub', 'Estado de conservación'),
      selectorEstado(estado, (v) => { estado = v; }),
      h('div.sub', 'Situación'),
      selectorSituacion(situacion, (v) => { situacion = v; }),
      h('details.obs', h('summary', 'Agregar observación'),
        h('textarea', { rows: 2, maxLength: 200, placeholder: 'Observación (opcional)', oninput: (e) => { obs = e.target.value; } })),
      h('div.botones', h('button.btn.sec', { onclick: () => cerrar(false) }, 'Cancelar'), btn),
      h('button.desplegar.centro', { onclick: async () => { cerrar(false); const { fichaBien } = await import('./ficha.js'); fichaBien(b); } }, 'Ver ficha completa e historial' + (esAdmin() ? ' · editar' : '')),
      yaAqui && amb.estado !== 'CERRADO' ? h('button.desplegar.anular', { onclick: async () => { cerrar(false); await anularVerificacion(b); } }, 'Anular verificación de este bien') : null);
  });
}

/** Anula la verificación: el bien vuelve a PENDIENTE y el registro anterior queda en el HISTORIAL. */
export async function anularVerificacion(b) {
  const a = ambiente(b.ambiente_real_id);
  if (a && a.estado === 'CERRADO') { toast(a.nombre + ' está cerrado. El administrador debe reabrirlo primero.', 'error', 4500); return false; }
  const motivo = await pedirMotivo('Anular verificación',
    `${b.denominacion} (${b.cod_patrimonial || b.cod_interno}) volverá a PENDIENTE. Lo verificado por ${b.verificado_por || '—'} queda en el HISTORIAL.`,
    { si: 'Anular', peligro: true, opciones: ['Escaneado por error', 'No es el bien', 'Ambiente equivocado'] });
  if (!motivo) return false;
  await encolar('anularVerificacion', { bien_id: b.id, ambiente_id: b.ambiente_real_id, motivo });
  toast('Verificación anulada: el bien quedó pendiente');
  return true;
}

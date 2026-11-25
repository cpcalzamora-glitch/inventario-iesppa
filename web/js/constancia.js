// Constancia de verificación física por ambiente (PDF A4 horizontal), generada en el celular
// a partir de lo verificado. Replica el diseño aprobado (constancia.py / prototipo del Aula 102).
import { S, sobrantesDe } from './store.js';

const ANCHO = 806;           // ancho útil: A4 horizontal (841.89 pt) menos 18 pt por lado
const MARGEN = 18;
const ENC_W = 2400, ENC_H = 183; // tamaño real de img/encabezado_constancia.png

// Anchos de columna (suman exactamente 806 pt en las tres tablas).
export const COLS_INFO = [88, 324, 98, 296];
export const COLS_BIENES = [24, 46, 66, 140, 50, 48, 48, 62, 60, 30, 46, 186];
export const COLS_FIRMAS = [250, 28, 250, 28, 250];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

let libs = null;
function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => mal(new Error('No se pudo cargar ' + src));
    document.head.append(s);
  });
}
async function cargarLibs() {
  if (!libs) {
    libs = (async () => {
      if (!window.jspdf) await cargarScript('vendor/jspdf.umd.min.js');
      await cargarScript('vendor/jspdf.plugin.autotable.min.js');
      const r = await fetch('img/encabezado_constancia.png');
      if (!r.ok) throw new Error('No se encontró el encabezado de la constancia.');
      const blob = await r.blob();
      const enc = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      return { jsPDF: window.jspdf.jsPDF, enc };
    })().catch((e) => { libs = null; throw e; });
  }
  return libs;
}

/** "Azángaro, 25 de noviembre de 2026" en hora de Lima. */
export function fechaLarga(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `Azángaro, ${Number(p.day)} de ${MESES[Number(p.month) - 1]} de ${p.year}`;
}

function palabras(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-ZÑ ]/g, ' ').split(' ').filter(Boolean).sort().join(' ');
}
export function dniDe(nombre) {
  const n = palabras(nombre);
  if (!n) return '';
  const p = S.personal.find((x) => palabras(x.nombre) === n);
  return p ? p.dni : '';
}

function categoria(b) {
  const c = String(b.cod_patrimonial || '');
  if (c.startsWith('746')) return 'MOBILIARIO';
  if (!/^\d+$/.test(c) && /ESCRITORIO|SILLA|MESA|ESTANTE|ARMARIO|CARPETA|MUEBLE/.test(String(b.denominacion).toUpperCase())) return 'MOBILIARIO';
  return 'EQUIPOS Y OTROS BIENES';
}

function codigoMostrado(b) {
  const c = String(b.cod_patrimonial || '');
  if (/^\d+$/.test(c)) return c;
  return b.tipo_codigo === 'ALTA' ? 'ALTA 2025 (sin código)' : '(sin código)';
}

const limpio = (v) => String(v ?? '').trim();

/** Filas de la constancia: bienes verificados en el ambiente (por categoría) y sus sobrantes. */
export function filasConstancia(amb) {
  const bienes = S.bienes.filter((b) => (b.estado_verif === 'UBICADO' || b.estado_verif === 'OBSERVADO') && b.ambiente_real_id === amb.id);
  bienes.forEach((b) => { b._cat = categoria(b); });
  bienes.sort((a, b) => a._cat.localeCompare(b._cat) || a.denominacion.localeCompare(b.denominacion) || String(a.cod_patrimonial).localeCompare(String(b.cod_patrimonial)) || String(a.cod_interno).localeCompare(String(b.cod_interno)));
  const grupos = [];
  for (const b of bienes) {
    if (!grupos.length || grupos[grupos.length - 1].titulo !== b._cat) grupos.push({ titulo: b._cat, filas: [] });
    const obs = [];
    if (b.tipo_codigo === '8D') obs.push('(por lote)');
    if (b.ambiente_id !== amb.id) obs.push(b.ambiente_id === 'SIN_UBICAR' ? 'Encontrado (SIGA sin ubicar)' : 'Trasladado de ' + ((S.ambientes.find((a) => a.id === b.ambiente_id) || {}).nombre || b.ambiente_id));
    if (b.obs_campo) obs.push(b.obs_campo);
    grupos[grupos.length - 1].filas.push([b.cod_interno, codigoMostrado(b), b.denominacion, b.marca, b.modelo, b.color, b.serie, b.dimensiones, b.situacion || 'U', b.estado_conserv, obs.join(' · ')].map(limpio));
  }
  const sobr = sobrantesDe(amb.id);
  // Sobrantes de este celular que ya recibieron código pero aún no llegan en la lista del servidor.
  for (const l of S.sobrantesLocales.filter((x) => x.ambiente_id === amb.id && x.codigos)) {
    for (const cod of l.codigos) if (!sobr.some((s) => s.cod_sobrante === cod)) sobr.push({ ...l, cod_sobrante: cod, denominacion: String(l.denominacion || '').toUpperCase() });
  }
  sobr.sort((a, b) => a.cod_sobrante.localeCompare(b.cod_sobrante));
  if (sobr.length) {
    grupos.push({
      titulo: 'SOBRANTES (inventario aparte)',
      filas: sobr.map((s) => [s.cod_sobrante, 'SOBRANTE', s.denominacion, s.marca, s.modelo, s.color, s.serie, s.dimensiones, '', s.estado_conserv, ['Etiqueta temporal ' + s.cod_sobrante, s.obs].filter(Boolean).join(' · ')].map(limpio))
    });
  }
  return { grupos, total: bienes.length + sobr.length, bienes: bienes.length, sobrantes: sobr.length };
}

/**
 * Genera la constancia. fecha: ISO de cierre (la que se imprime). Devuelve {doc, nombre, anchos, total}.
 */
export async function generarConstancia(amb, fecha) {
  const { jsPDF, enc } = await cargarLibs();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const anio = S.config.anio_inventario || '2026';
  const inventariador = S.config.proveedor || '';
  const resp = amb.responsable || '';
  const dni = dniDe(resp);
  const datos = filasConstancia(amb);
  const anchos = [];
  const medir = (tabla) => anchos.push(Math.round(tabla.columns.reduce((s, c) => s + c.width, 0) * 1000) / 1000);
  const altoPag = doc.internal.pageSize.getHeight();
  const anchoPag = doc.internal.pageSize.getWidth();

  let y = 16;
  const encH = ANCHO * ENC_H / ENC_W;
  doc.addImage(enc, 'PNG', MARGEN, y, ANCHO, encH);
  anchos.push(ANCHO);
  y += encH + 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const aviso = 'CUALQUIER BIEN QUE SE QUIERE MOVER, DEBE SER COMUNICADO AL ÁREA DE CONTROL PATRIMONIAL A FIN DE ACTUALIZAR LOS BIENES';
  doc.text(aviso, anchoPag / 2, y, { align: 'center' });
  const wa = doc.getTextWidth(aviso);
  doc.setLineWidth(0.5);
  doc.line(anchoPag / 2 - wa / 2, y + 1.5, anchoPag / 2 + wa / 2, y + 1.5);
  y += 13;
  doc.setFontSize(10);
  doc.text(`CONSTANCIA DE VERIFICACIÓN FÍSICA DE BIENES MUEBLES - INVENTARIO ${anio}`, anchoPag / 2, y, { align: 'center' });
  y += 6;

  // Cuadro de datos (4 columnas)
  const b = (t) => ({ content: t, styles: { fontStyle: 'bold' } });
  doc.autoTable({
    startY: y, margin: { left: MARGEN, right: MARGEN }, tableWidth: ANCHO, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, lineColor: [128, 128, 128], lineWidth: 0.3, textColor: 0, valign: 'middle' },
    columnStyles: Object.fromEntries(COLS_INFO.map((w, i) => [i, { cellWidth: w }])),
    body: [
      [b('USUARIO RESPONSABLE:'), resp || '—', 'DNI: ' + (dni || '__________'), 'FECHA: ' + fechaLarga(fecha)],
      [b('AMBIENTE:'), amb.nombre, 'N.º: ' + (amb.numero || amb.id), 'UBICACIÓN: ' + (amb.ubicacion || '')],
      [b('VERIFICACIÓN:'), 'Física ( X )   Digital (   )', 'BIENES: ' + datos.total, 'INVENTARIADOR: ' + inventariador]
    ],
    tableLineColor: [0, 0, 0], tableLineWidth: 0.6
  });
  medir(doc.lastAutoTable);
  y = doc.lastAutoTable.finalY + 5;

  // Tabla de bienes
  const cab = ['N.º', 'INV.\n' + anio, 'CÓDIGO\nPATRIMONIAL', 'DENOMINACIÓN', 'MARCA', 'MODELO', 'COLOR', 'SERIE', 'DIMENSIONES', 'SITUAC.\n(U/D)', 'ESTADO\n(N/B/R/M/\nCH/RAEE)', 'OBSERVACIONES'];
  const body = [];
  let n = 0;
  for (const g of datos.grupos) {
    body.push([{ content: g.titulo, colSpan: 12, styles: { halign: 'center', fontStyle: 'bold', fillColor: [242, 242, 242], fontSize: 6.5 } }]);
    for (const f of g.filas) { n++; body.push([String(n), ...f]); }
  }
  if (!body.length) body.push([{ content: 'No hay bienes verificados en este ambiente.', colSpan: 12, styles: { halign: 'center' } }]);
  doc.autoTable({
    startY: y, margin: { left: MARGEN, right: MARGEN, top: 20, bottom: 24 }, tableWidth: ANCHO, theme: 'grid',
    head: [cab], body, showHead: 'everyPage',
    styles: { font: 'helvetica', fontSize: 6, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.3, textColor: 0, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [255, 230, 153], textColor: 0, fontStyle: 'bold', fontSize: 5.5, halign: 'center' },
    columnStyles: Object.fromEntries(COLS_BIENES.map((w, i) => [i, { cellWidth: w, halign: i < 2 || i === 9 || i === 10 ? 'center' : 'left' }])),
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 11) d.cell.styles.fontSize = 5.5; }
  });
  medir(doc.lastAutoTable);
  y = doc.lastAutoTable.finalY + 6;

  // Pie: escala, consideraciones y firmas (juntos; si no entran, en una hoja nueva).
  const consid = 'El usuario declara haber mostrado todos los bienes muebles que se encuentran bajo su responsabilidad y no contar con más bienes muebles materia de inventario. El usuario es responsable de la permanencia y conservación de cada uno de los bienes descritos, tomando las precauciones del caso para evitar sustracciones, deterioros, etc. Cualquier necesidad de traslado del bien mueble dentro o fuera del local de la Entidad, es previamente comunicado al encargado de la OCP. Los bienes de 8 dígitos (inventario interno) recibirán su código patrimonial de la DREP posteriormente.';
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  const etiqueta = 'CONSIDERACIONES: ';
  const wEt = doc.getTextWidth(etiqueta);
  doc.setFont('helvetica', 'normal');
  // La primera línea empieza después de la etiqueta en negrita.
  const primera = doc.splitTextToSize(consid, ANCHO - wEt)[0];
  const lineasC = [primera, ...doc.splitTextToSize(consid.slice(primera.length).trim(), ANCHO)];
  const altoPie = 10 + lineasC.length * 7.6 + 8 + 44 + 34;
  if (y + altoPie > altoPag - 24) { doc.addPage(); y = 24; }
  doc.text('Uso (U), Desuso (D). El estado se consigna según la escala: Nuevo, Bueno, Regular, Malo, Chatarra y RAEE.', MARGEN, y + 6);
  y += 13;
  doc.setFont('helvetica', 'bold');
  doc.text(etiqueta, MARGEN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(lineasC[0], MARGEN + wEt, y);
  doc.text(lineasC.slice(1), MARGEN, y + 7.6);
  y += lineasC.length * 7.6 + 6;

  const firma = (titulo, sub) => ({ content: `${titulo}\n${sub}\nFirma y sello`, styles: { halign: 'center' } });
  doc.autoTable({
    startY: y, margin: { left: MARGEN, right: MARGEN }, tableWidth: ANCHO, theme: 'plain',
    styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 3, bottom: 1, left: 2, right: 2 }, textColor: 0, valign: 'top' },
    columnStyles: Object.fromEntries(COLS_FIRMAS.map((w, i) => [i, { cellWidth: w }])),
    body: [
      [{ content: '', styles: { minCellHeight: 44 } }, '', '', '', ''], // espacio para la firma y el sello
      [firma(resp || 'USUARIO RESPONSABLE', 'USUARIO RESPONSABLE - DNI: ' + (dni || '__________')), '',
        firma(inventariador || 'INVENTARIADOR', 'INVENTARIADOR - ALZAMORA CONSULT'), '',
        firma('RESPONSABLE DE PATRIMONIO', 'ABASTECIMIENTO - IESPP AZÁNGARO')]
    ],
    didParseCell: (d) => { if (d.row.index === 1 && d.column.index % 2 === 0) d.cell.styles.fontStyle = 'normal'; },
    didDrawCell: (d) => {
      if (d.row.index === 1 && d.column.index % 2 === 0) {
        doc.setLineWidth(0.6);
        doc.setDrawColor(0, 0, 0);
        doc.line(d.cell.x + 15, d.cell.y, d.cell.x + d.cell.width - 15, d.cell.y);
      }
    }
  });
  medir(doc.lastAutoTable);

  // Pie de página en todas las hojas
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(`Ambiente ${amb.numero || amb.id} · Constancia de verificación física ${anio}`, MARGEN, altoPag - 10);
    doc.text(`Página ${p} de ${paginas}`, MARGEN + ANCHO, altoPag - 10, { align: 'right' });
  }
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(fecha ? new Date(fecha) : new Date()); // AAAA-MM-DD en Lima
  const nombre = `Constancia_${String(amb.numero || amb.id).replace(/[^\w-]+/g, '_')}_${dia}.pdf`;
  return { doc, nombre, anchos, total: datos.total, bienes: datos.bienes, sobrantes: datos.sobrantes, paginas };
}

/** Genera y descarga el PDF. */
export async function descargarConstancia(amb, fecha) {
  const r = await generarConstancia(amb, fecha);
  r.doc.save(r.nombre);
  return r;
}

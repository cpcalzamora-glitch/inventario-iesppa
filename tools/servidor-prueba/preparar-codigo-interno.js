/**
 * Solo pruebas: hace una COPIA de la base con el código interno nuevo (texto de 5 dígitos, numerado por ambiente)
 * y el anterior en "cod_interno_anterior", igual que la hoja real desde el 27/11/2026.
 * Uso: node preparar-codigo-interno.js "<base original.xlsx>" "<copia de salida.xlsx>"
 */
const XLSX = require('xlsx');
const [, , entrada, salida] = process.argv;
const wb = XLSX.readFile(entrada);
const sh = wb.Sheets.BIENES;
const filas = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', raw: false });
const H = filas[0];
const iCod = H.indexOf('cod_interno');
const iAmb = H.indexOf('ambiente_id');
let iAnt = H.indexOf('cod_interno_anterior');
if (iAnt < 0) { iAnt = H.length; H.push('cod_interno_anterior'); }
const orden = filas.slice(1).map((r, k) => ({ r, k })).sort((a, b) => String(a.r[iAmb]).localeCompare(String(b.r[iAmb]), 'es', { numeric: true }) || a.k - b.k);
orden.forEach(({ r }, n) => {
  if (!r[iAnt]) r[iAnt] = String(r[iCod]);
  r[iCod] = String(n + 1).padStart(5, '0');
});
const nueva = XLSX.utils.aoa_to_sheet(filas.map((r) => r.map((v) => String(v ?? ''))));
Object.keys(nueva).forEach((k) => { if (k[0] !== '!') nueva[k].t = 's'; });
wb.Sheets.BIENES = nueva;
XLSX.writeFile(wb, salida);
console.log(`Copia lista: ${filas.length - 1} bienes con código interno de 5 dígitos → ${salida}`);

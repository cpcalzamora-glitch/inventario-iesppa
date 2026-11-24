/**
 * Imitación mínima de los servicios de Google Apps Script para probar el backend
 * (los mismos archivos .gs) en la PC, usando una copia local de la base en Excel.
 * SOLO PARA PRUEBAS. En producción se usa el Apps Script real.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const XLSX = require('xlsx');

class Sheet {
  constructor(name, values) { this.name = name; this.values = values; }
  getLastRow() {
    for (let r = this.values.length - 1; r >= 0; r--) if (this.values[r].some(v => v !== '')) return r + 1;
    return 0;
  }
  getLastColumn() { return this.values.reduce((m, r) => { let c = r.length; while (c > 0 && r[c - 1] === '') c--; return Math.max(m, c); }, 0); }
  getRange(row, col, nr = 1, nc = 1) { return new Range(this, row, col, nr, nc); }
  getName() { return this.name; }
}

class Range {
  constructor(sh, row, col, nr, nc) { Object.assign(this, { sh, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sh.values[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) { const v = src[this.col - 1 + c]; line.push(v === undefined ? '' : v); }
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error('setValues: dimensiones no coinciden');
    for (let r = 0; r < this.nr; r++) {
      const i = this.row - 1 + r;
      while (this.sh.values.length <= i) this.sh.values.push([]);
      const line = this.sh.values[i];
      for (let c = 0; c < this.nc; c++) {
        while (line.length < this.col - 1 + c) line.push('');
        line[this.col - 1 + c] = vals[r][c] === undefined || vals[r][c] === null ? '' : vals[r][c];
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
}

class Spreadsheet {
  constructor(file) {
    this.file = file;
    const wb = XLSX.readFile(file);
    this.sheets = {};
    for (const n of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false });
      this.sheets[n] = new Sheet(n, rows.map(r => r.map(v => String(v))));
    }
  }
  getSheetByName(n) { return this.sheets[n] || null; }
  save() {
    const wb = XLSX.utils.book_new();
    for (const n of Object.keys(this.sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(this.sheets[n].values), n);
    XLSX.writeFile(wb, this.file);
  }
}

function crearContexto(archivoDatos) {
  const ss = new Spreadsheet(archivoDatos);
  const props = {};
  const cache = {};
  let lockHeld = false;
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ss, getActive: () => ss, getUi: () => { throw new Error('Sin UI en pruebas'); } },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (lockHeld) throw new Error('Lock ocupado'); lockHeld = true; },
        tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
        releaseLock: () => { lockHeld = false; },
        hasLock: () => lockHeld
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; },
        getProperties: () => ({ ...props })
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => { const e = cache[k]; return e && e.t > Date.now() ? e.v : null; },
        put: (k, v, s = 600) => { cache[k] = { v: String(v), t: Date.now() + s * 1000 }; },
        remove: k => { delete cache[k]; }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, txt) => Array.from(crypto.createHash(alg).update(String(txt), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => {
        // Hora de Lima (UTC-5, sin horario de verano)
        const t = new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 19);
        return t + '-05:00';
      },
      sleep: () => {}
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } })
    },
    Logger: { log: (...a) => console.log('[Logger]', ...a) }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', '..', 'apps-script');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  ctx.__ss = ss;
  return ctx;
}

module.exports = { crearContexto };

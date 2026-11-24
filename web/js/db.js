// Almacenamiento local (IndexedDB): 'kv' guarda la base cacheada y la sesión; 'cola' las operaciones por sincronizar.
const DB_NAME = 'inventario-iesppa';
let dbp = null;

function abrir() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('cola')) d.createObjectStore('cola', { keyPath: 'op_id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function operar(store, modo, fn) {
  const d = await abrir();
  return new Promise((res, rej) => {
    const t = d.transaction(store, modo);
    const req = fn(t.objectStore(store));
    let val;
    if (req) req.onsuccess = () => { val = req.result; };
    t.oncomplete = () => res(val);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const kvGet = (k) => operar('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => operar('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => operar('kv', 'readwrite', (s) => s.delete(k));

export const colaPut = (op) => operar('cola', 'readwrite', (s) => s.put(op));
export const colaDel = (id) => operar('cola', 'readwrite', (s) => s.delete(id));
export async function colaTodas() {
  const ops = (await operar('cola', 'readonly', (s) => s.getAll())) || [];
  return ops.sort((a, b) => a.seq - b.seq);
}

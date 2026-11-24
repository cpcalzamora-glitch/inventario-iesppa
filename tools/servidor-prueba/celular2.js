// Simula un segundo celular (invent2) trabajando a la vez contra el servidor de prueba.
const api = async (p) => (await fetch('http://localhost:8080/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(p) })).json();
(async () => {
  const tok = (await api({ action: 'login', usuario: 'invent2', pin: '9103' })).data.token;
  const bs = (await api({ action: 'getBootstrap', token: tok })).data;
  const C = bs.bienes.columnas; const B = bs.bienes.filas.map(f => Object.fromEntries(C.map((c, i) => [c, f[i]])));
  const pend = B.filter(b => b.ambiente_id === '102' && b.tipo_codigo === '12D' && b.estado_verif !== 'UBICADO');
  // verifica 10 pendientes + 5 que ya verificó el celular 1 (mismo ambiente)
  const ya = B.filter(b => b.ambiente_real_id === '102').slice(0, 5);
  const ops = [...pend.slice(0, 10), ...ya].map(b => ({ type: 'verificar', op_id: crypto.randomUUID(), bien_id: b.id, ambiente_id: '102', estado_conserv: 'B', version_cliente: b.version }));
  const r = (await api({ action: 'sync', token: tok, ops })).data;
  console.log('celular 2:', r.map(x => x.estado).join(','));
})();

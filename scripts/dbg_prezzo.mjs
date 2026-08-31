// Il prezzo che il gestore scrive sui condimenti e' quello che il cliente paga.
const base = process.env.BASE || 'http://127.0.0.1:8700';
const call = async (p, o = {}) => { const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); return r.json().catch(() => ({})); };
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const pan = await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Panino', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti', con_condimenti: true } });
const ids = [];
for (const n of ['Formaggio svizzero', 'Olive', 'Tonno', 'Funghi']) {
  const c = await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 1, stazione: 'cucina', zona: 'comune', categoria: 'Condimenti' } });
  ids.push(c.id);
}
for (const [quanti, etichetta] of [[1, 'un condimento'], [4, 'quattro condimenti']]) {
  const r = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', righe: [{ menu_id: pan.id, qta: 1, complementi: ids.slice(0, quanti) }] } });
  console.log(`panino 6,00 + ${etichetta} da 1,00  →  il cliente paga ${r.totale}`);
}
await call('/api/admin/menu', { method: 'PUT', token, body: { righe: ids.map(id => ({ id, prezzo: 2 })) } });
const m = (await call('/api/menu?zona=bar')).find(x => x.id === pan.id);
console.log('portati a 2,00 → il menù dichiara: condire costa', m.supplemento_complementi);
const r2 = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', righe: [{ menu_id: pan.id, qta: 1, complementi: ids }] } });
console.log('e il cliente paga', r2.totale);

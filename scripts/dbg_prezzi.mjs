// Importo un menù, poi salvo una riga come fa il Crew: i prezzi devono restare.
const base = process.env.BASE || 'http://127.0.0.1:7900';
const call = async (p, o = {}) => {
  const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const token = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } })).body.token;
const csv = 'nome;prezzo;categoria\nCaffè espresso;1,00;Caffetteria\nAmaro siciliano;4,50;Alcolici\nPanino cotoletta;6,00;Panini e fritti\n';
const imp = await call('/api/admin/menu/import', { method: 'POST', token, body: { fileB64: Buffer.from(csv).toString('base64'), mode: 'merge' } });
console.log('import:', imp.status, JSON.stringify(imp.body).slice(0, 90));
const dopoImport = (await call('/api/admin/menu', { token })).body.filter(m => /espresso|Amaro siciliano|cotoletta/.test(m.nome));
console.log('dopo import  →', dopoImport.map(m => `${m.nome}=${m.prezzo}`).join(' | '));

// Il Crew salva la riga: manda esattamente questi campi.
const uno = dopoImport[0];
await call('/api/admin/menu/' + uno.id, { method: 'PUT', token, body: {
  nome: uno.nome, prezzo: Number(uno.prezzo), stazione: uno.stazione, zona: uno.zona,
  categoria: uno.categoria, allergeni: uno.allergeni || '', attivo: true
} });
const dopoSalva = (await call('/api/admin/menu', { token })).body.find(m => m.id === uno.id);
console.log('dopo salvataggio →', dopoSalva.nome, '=', dopoSalva.prezzo);

// E l'esportazione: quali colonne porta?
const exp = (await call('/api/admin/menu/export', { token })).body;
console.log('export: file', exp.filename, '· colonne verificate a parte');

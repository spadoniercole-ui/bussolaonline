// Una popolazione realistica, non ordinata: famiglie, single, pochi over 70 (che sono sempre
// il vincolo piu' difficile) e uno squilibrio di genere come capita nella realta'.
const base = process.env.BASE || 'http://127.0.0.1:9985';
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const anno = new Date().getUTCFullYear();
let n = 0;
const crea = async (eta, sesso, nucleo) => {
  n++;
  return call('/api/admin/soci', { method: 'POST', token, body: {
    nome: 'G' + n, cognome: (nucleo || 'Solo') + n, data_nascita: `${anno - eta}-06-15`,
    sesso, nucleo: nucleo || null, gioca_coppa: true
  } });
};
// 20 famiglie da 3-4 (due genitori + figli), poi single per arrivare a ~100
let creati = 0;
const FAM = Number(process.env.FAM || 20);
for (let f = 1; f <= FAM; f++) {
  const casa = 'fam' + f;
  await crea(30 + (f % 20), 'M', casa); await crea(28 + (f % 20), 'F', casa);
  await crea(6 + (f % 8), f % 2 ? 'M' : 'F', casa);
  creati += 3;
  if (f % 3 === 0) { await crea(72 + (f % 8), f % 2 ? 'F' : 'M', casa); creati++; }
}
// single, con un lieve squilibrio di genere come capita
const QUANTI = Number(process.env.QUANTI || 100);
while (creati < QUANTI) {
  const eta = [17, 24, 33, 41, 52, 58, 66, 71][creati % 8];
  await crea(eta, creati % 5 === 0 ? 'F' : (creati % 2 ? 'M' : 'F'), null);
  creati++;
}
const a = await call('/api/admin/casate/composizione', { token });
console.log('iscritti:', a.iscritti, '· casate schierabili:', a.casate_schierabili, 'su', a.casate_totali);
console.log('regole:', JSON.stringify(a.regole));
for (const c of a.casate) {
  console.log(`  ${c.nome.padEnd(12)} ${c.quanti} giocatori · U14 ${c.under14} · O70 ${c.over70} · donne ${c.donne} · fasce ${c.fasce.length}`);
}
console.log('in lista d\'attesa:', a.in_attesa.length);
console.log('PROBLEMI:', a.problemi.length ? '' : 'nessuno');
for (const p of a.problemi) console.log('  ·', p.casata, '—', p.cosa + ':', p.dettaglio);
for (const av of a.avvisi) console.log('  avviso:', av);

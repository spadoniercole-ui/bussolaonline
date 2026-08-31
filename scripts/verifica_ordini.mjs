// Un ordine e' "acquisito" davvero? Non basta che l'app risponda 201: la comanda deve
// esistere, portare le righe giuste, comparire nel KDS di chi la prepara, restare nella zona
// da cui e' partita, e alla chiusura scaricare il magazzino. Questa prova percorre tutta la
// catena su un database vero e stampa cosa trova a ogni passaggio.
const base = process.env.BASE || 'http://127.0.0.1:7000';
const call = async (p, o = {}) => {
  const r = await fetch(base + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
};
const ok = (c, m) => console.log((c ? '  OK   ' : '  ROTTO') + ' · ' + m);

const { body: login } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const token = login.token;

// Un piatto di cucina con distinta di magazzino, e un condimento.
// Serve un articolo che si conti A PEZZO: solo su quelli la giacenza cala davvero, e la prova
// dello scarico ha senso. Con uno a peso il consumo finisce nel teorico e il confronto
// giacenza-prima/giacenza-dopo passerebbe senza dimostrare niente.
const art = (await call('/api/admin/magazzino', { method: 'POST', token, body: { nome: 'Pane per verifica', area: 'cucina', zona: 'garden', unita: 'pz', giacenza: 50, tipo_consumo: 'pezzo' } })).body;
if (!art || !art.id) { console.log('  ROTTO · non riesco a creare l’articolo di magazzino:', JSON.stringify(art)); process.exit(1); }
const piatto = (await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Panino verifica ordine', prezzo: 6, stazione: 'cucina', categoria: 'Panini e fritti' } })).body;
await call(`/api/admin/menu/${piatto.id}/magazzino`, { method: 'PUT', token, body: { magazzino_id: art.id, consumo: 1 } });
const cond = (await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Maionese verifica', prezzo: 0.5, stazione: 'cucina', categoria: 'Condimenti extra' } })).body;

console.log('\n1) IL SOCIO ORDINA DAL BAR (self-order)');
const menuBar = (await call('/api/menu?zona=bar')).body;
const p = menuBar.find((m) => m.id === piatto.id);
ok(!!p, 'il panino compare nel menù del Bar anche se lo prepara la cucina');
ok(!!(p && (p.complementi || []).some((c) => c.id === cond.id)), 'e porta dentro il condimento');
const ordine = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 2, complementi: [cond.id] }] } });
ok(ordine.status === 201, 'l’ordine viene accettato (201)');
ok(ordine.body.totale === 6 * 2 + 0.5 * 2, `il totale è giusto: ${ordine.body.totale} (2 panini + 2 supplementi)`);

console.log('\n2) LA COMANDA ESISTE DAVVERO');
const comande = (await call('/api/admin/comande', { token })).body;
const c = comande.find((x) => x.numero === ordine.body.numero);
ok(!!c, 'la comanda si ritrova nell’elenco della Crew');
ok(c && c.zona === 'bar', `resta del Bar (zona=${c && c.zona}): non finisce sulla mappa tavoli del Garden`);
const righe = (c && c.righe) || [];
ok(righe.some((r) => r.menu_id === piatto.id && r.qta === 2), 'la riga del panino c’è, con la quantità giusta');
ok(righe.some((r) => r.menu_id === cond.id && r.prezzo === 0), 'il condimento c’è come riga a zero (per cucina e magazzino)');
ok(righe.filter((r) => r.nome === 'Supplemento condimenti').length === 1, 'un solo supplemento, non uno per condimento');

console.log('\n3) ARRIVA A CHI LA DEVE PREPARARE');
const kds = (await call('/api/admin/kds?stazione=cucina', { token })).body;
ok(kds.some((x) => x.id === c.id), 'la comanda compare nel KDS Cucina');
const kdsBar = (await call('/api/admin/kds?stazione=bar', { token })).body;
ok(!kdsBar.some((x) => x.id === c.id), 'e NON in quello del banco: la prepara la cucina');

console.log('\n4) ALLA CHIUSURA SCARICA IL MAGAZZINO');
const prima = (await call('/api/admin/magazzino', { token })).body.articoli.find((a) => a.id === art.id).giacenza;
await call(`/api/admin/comande/${c.id}/stato`, { method: 'PUT', token, body: { stato: 'chiusa' } });
const dopo = (await call('/api/admin/magazzino', { token })).body.articoli.find((a) => a.id === art.id).giacenza;
ok(dopo === prima - 2, `giacenza ${prima} → ${dopo}: due panini, due pezzi di pane in meno`);
const chiusa = (await call('/api/admin/comande?stato=tutte', { token })).body.find((x) => x.id === c.id);
ok(chiusa && Number(chiusa.scaricata) === 1, 'la comanda risulta scaricata: non si scaricherà una seconda volta');

console.log('\n5) LA CREW BATTE UNA COMANDA AL TAVOLO');
const crew = await call('/api/admin/comande', { method: 'POST', token, body: { origine: 'tavolo', zona: 'garden', riferimento: '5', righe: [{ menu_id: piatto.id, qta: 1, complementi: [cond.id] }] } });
ok(crew.status === 201, 'la comanda del cameriere viene accettata');
ok(crew.body.totale === 6.5, `totale ${crew.body.totale}: il supplemento vale anche per lei`);
ok((crew.body.righe || []).filter((r) => r.parent_riga_id).length === 2, 'condimento e supplemento agganciati al piatto');

console.log('\n6) IL LISTINO NON SI PUÒ SVUOTARE SOTTO UNA COMANDA APERTA');
const csv = Buffer.from('nome,prezzo\nSolo questo,1\n').toString('base64');
const rifiuto = await call('/api/admin/menu/import', { method: 'POST', token, body: { fileB64: csv, mode: 'replace' } });
ok(rifiuto.status === 409, `l’import "sostituisci" viene rifiutato (${rifiuto.status}) perché ci sono comande aperte`);
const canc = await call('/api/admin/menu/' + piatto.id, { method: 'DELETE', token });
ok(canc.status === 409, `e il prodotto dentro la comanda aperta non si cancella (${canc.status})`);

console.log('\n7) DIAGNOSI DEL MENÙ');
const d = (await call('/api/admin/menu/diagnosi', { token })).body;
console.log('  ', JSON.stringify({ condimenti: d.condimenti, piatti_cucina: d.piatti_cucina, bar: d.ordinabili_al_bar, garden: d.ordinabili_al_garden, problemi: d.problemi }));

// Unire due tavoli in sala non deve far sparire il secondo dalla pianta.
const base = process.env.BASE || 'http://127.0.0.1:7800';
const call = async (p, o = {}) => {
  const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const ok = (c, m) => console.log((c ? '  OK   ' : '  ROTTO') + ' · ' + m);
const token = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } })).body.token;
const tutto = async () => (await call('/api/admin/tavoli/layout?ambiente=garden', { token })).body.layout[0];
const l = await tutto();
const posti = (t) => t.filter(x => x.attivo !== 0).reduce((s, x) => s + Number(x.posti), 0);
let tav = (await tutto()).tavoli;
// La forma di partenza si guarda PRIMA di toccare qualcosa, altrimenti si misura il risultato
// delle proprie modifiche. I tavoli nascono quadrati da quattro: il quadrato si accosta a un
// altro quadrato e fa una tavolata vera; il tondo, accostato, lascia buchi.
console.log('forma di partenza:', [...new Set(tav.map(t => t.forma))].join(', '),
  '· posti:', [...new Set(tav.map(t => t.posti))].join(', '));
ok(tav.every(t => t.forma === 'quadrato'), 'i tavoli nascono quadrati');
ok(tav.every(t => Number(t.posti) === 4), 'e da quattro posti');
const postiIniziali = posti(tav);
console.log('partenza:', tav.length, 'tavoli ·', postiIniziali, 'posti');

// 1) unione dalla SALA: si manda solo quello che si vede
const visibili = tav.filter(t => t.attivo !== 0).map(t => ({ ...t }));
const a = visibili.find(t => t.numero === 1), b = visibili.find(t => t.numero === 2);
a.posti_base = a.posti; b.posti_base = b.posti;
a.posti = a.posti + b.posti; a.uniti = [2]; a.forma = 'rettangolo'; b.attivo = false;
await call('/api/admin/tavoli/layout/' + l.id, { method: 'PUT', token, body: { tavoli: visibili } });
tav = (await tutto()).tavoli;
ok(tav.some(t => t.numero === 2), 'dopo l’unione il tavolo 2 esiste ancora (nascosto)');

// 2) ora si modifica un ALTRO tavolo, come farebbe la crew: la lista visibile NON contiene il 2
const visibili2 = tav.filter(t => t.attivo !== 0).map(t => ({ ...t }));
const t8 = visibili2.find(t => t.numero === 8);
t8.posti = 8; t8.forma = 'rettangolo';
await call('/api/admin/tavoli/layout/' + l.id, { method: 'PUT', token, body: { tavoli: visibili2 } });
tav = (await tutto()).tavoli;
ok(tav.some(t => t.numero === 2), 'modificando il tavolo 8, il 2 NON viene cancellato');
ok((tav.find(t => t.numero === 8) || {}).posti === 8, 'e la modifica al tavolo 8 si salva');

// 3) separazione: il 2 torna in sala con i suoi posti
const visibili3 = tav.filter(t => t.attivo !== 0).map(t => ({ ...t }));
const a3 = visibili3.find(t => t.numero === 1);
const b3 = { ...tav.find(t => t.numero === 2), attivo: true };
b3.posti = b3.posti_base != null ? b3.posti_base : b3.posti;
a3.uniti = []; if (a3.posti_base != null) a3.posti = a3.posti_base; a3.forma = 'tondo';
await call('/api/admin/tavoli/layout/' + l.id, { method: 'PUT', token, body: { tavoli: visibili3.concat([b3]) } });
tav = (await tutto()).tavoli;
const f2 = tav.find(t => t.numero === 2);
ok(f2 && f2.attivo !== 0, 'separando, il tavolo 2 torna in sala');
console.log('  posti finali:', posti(tav), '(partenza', postiIniziali, '+ 4 per il tavolo 8 portato a 8 =', postiIniziali + 4, ')');


// Unione e separazione: la sala deve tornare esattamente com'era, anche se nel frattempo
// qualcuno corregge i posti di un tavolo (capita: si aggiunge una sedia).
const base = process.env.BASE || 'http://127.0.0.1:7600';
const call = async (p, o = {}) => {
  const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const ok = (c, m) => console.log((c ? '  OK   ' : '  ROTTO') + ' · ' + m);
const { body: login } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const token = login.token;

const leggiTutto = async () => (await call('/api/admin/tavoli/layout?ambiente=garden', { token })).body;
const l = (await leggiTutto()).layout[0];
const leggi = async () => ((await leggiTutto()).layout.find((x) => x.id === l.id) || {}).tavoli;
const salva = async (tav) => call('/api/admin/tavoli/layout/' + l.id, { method: 'PUT', token, body: { tavoli: tav } });

let tav = await leggi();
const a = tav.find(t => t.numero === 1), b = tav.find(t => t.numero === 2);
const postiA = a.posti, postiB = b.posti;
console.log(`partenza: tavolo 1 = ${postiA} posti, tavolo 2 = ${postiB} posti`);

// unione, come la fa il Crew
a.posti_base = a.posti; b.posti_base = b.posti;
a.posti = postiA + postiB; a.uniti = [2]; a.forma = 'rettangolo'; b.attivo = false; b.uniti = [];
await salva(tav);
tav = await leggi();
ok(tav.find(t => t.numero === 1).posti === postiA + postiB, `uniti: il tavolo 1 ha ${tav.find(t => t.numero === 1).posti} posti`);
ok(tav.find(t => t.numero === 2).attivo === 0, 'il tavolo 2 esce dalla sala');

// qualcuno aggiunge una sedia alla tavolata
const a2 = tav.find(t => t.numero === 1);
a2.posti = a2.posti + 1;
await salva(tav);
console.log('  (nel frattempo qualcuno aggiunge una sedia alla tavolata)');

// separazione
tav = await leggi();
const a3 = tav.find(t => t.numero === 1), b3 = tav.find(t => t.numero === 2);
b3.attivo = true;
b3.posti = b3.posti_base != null ? b3.posti_base : b3.posti;
a3.uniti = [];
if (a3.posti_base != null) a3.posti = a3.posti_base;
a3.forma = 'tondo';
await salva(tav);
tav = await leggi();
const fa = tav.find(t => t.numero === 1), fb = tav.find(t => t.numero === 2);
ok(fa.posti === postiA, `separati: il tavolo 1 torna a ${fa.posti} posti (era ${postiA})`);
ok(fb.posti === postiB && fb.attivo !== 0, `il tavolo 2 torna in sala con ${fb.posti} posti`);
ok(!(fa.uniti || []).length, 'e non risulta piu unito a niente');

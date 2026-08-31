// Una prenotazione tavolo annullata deve sparire dalla pianta. Se resta, il tavolo risulta
// occupato da qualcuno che non verra' — e a fine serata mancano coperti che c'erano.
const base = process.env.BASE || 'http://127.0.0.1:9980';
const call = async (p, o = {}) => {
  const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const { body: { token } } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const oggi = new Date().toISOString().slice(0, 10);
const p1 = await call('/api/admin/tavoli/prenota', { method: 'POST', token, body: { data: oggi, turno: '21:30', persone: 3, nome: 'Spadoni' } });
const p2 = await call('/api/admin/tavoli/prenota', { method: 'POST', token, body: { data: oggi, turno: '21:30', persone: 5, nome: 'Spadoni' } });
console.log('prenotate:', p1.body.id, '(tavoli', p1.body.tavoli + ')', '·', p2.body.id, '(tavoli', p2.body.tavoli + ')');
const t1 = await call(`/api/admin/tavoli/turno?data=${oggi}&turno=21:30&ambiente=garden`, { token });
console.log('occupati prima :', (t1.body.tavoli || []).filter(x => x.prenotazione).map(x => x.numero).join(', '));
const ann = await call(`/api/admin/tavoli/prenotazioni/${p1.body.id}`, { method: 'PUT', token, body: { stato: 'annullato' } });
console.log('annullamento   :', ann.status, JSON.stringify(ann.body).slice(0, 90));
const t2 = await call(`/api/admin/tavoli/turno?data=${oggi}&turno=21:30&ambiente=garden`, { token });
const conNome = (t) => (t.tavoli || []).filter(x => x.nome || x.prenotato || x.prenotazioni?.length);
console.log('dopo, tavoli con un nome sopra:', conNome(t2.body).map(x => `${x.numero}:${x.nome || JSON.stringify(x.prenotazioni || x.prenotato)}`).join(' | ') || 'nessuno');
console.log('campi di un tavolo:', Object.keys((t2.body.tavoli || [])[0] || {}).join(', '));
console.log('coperti dopo   :', t2.body.coperti_prenotati ?? '(non esposto)');

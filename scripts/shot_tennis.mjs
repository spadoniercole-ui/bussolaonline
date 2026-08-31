import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9990';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
// un utente "tennis" come quello vero
await call('/api/admin/operatori', { method: 'POST', token, body: { username: 'tennis', password: 'tennis123', ruolo: 'staff', permessi: ['tennis'] } });
// i tre campi dell'area, creati dal modulo
for (const [nome, sport] of [['Campo Tennis', 'tennis'], ['Beach Tennis', 'beach tennis'], ['Beach Volley', 'volley']]) {
  const c = await call('/api/admin/tennis/campi', { method: 'POST', token, body: { nome, sport, apertura: '08:00', chiusura: '22:00' } });
  await call(`/api/admin/tennis/campi/${c.id}/tariffe`, { method: 'POST', token, body: { etichetta: 'mattina', da_ora: '08:00', a_ora: '14:00', prezzo_ora: 12 } });
  await call(`/api/admin/tennis/campi/${c.id}/tariffe`, { method: 'POST', token, body: { etichetta: 'sera', da_ora: '17:00', a_ora: '22:00', prezzo_ora: 18 } });
  await call(`/api/admin/tennis/campi/${c.id}/tariffe`, { method: 'POST', token, body: { etichetta: 'lezione privata', tipo_uso: 'lezione', prezzo_ora: 35 } });
}
const oggi = new Date().toISOString().slice(0, 10);
const campi = await call('/api/admin/tennis/campi', { token });
await call('/api/admin/tennis/prenota', { method: 'POST', token, body: { campo_id: campi[0].id, data: oggi, slot: '18:00', tessera_code: 'RB-000001-4' } });
await call('/api/admin/tennis/blocchi', { method: 'POST', token, body: { campo_id: campi[1].id, data: oggi, dalle: '14:00', alle: '17:00', motivo: 'lezioni' } });

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1150, height: 1100 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'tennis'); await p.fill('#p', 'tennis123'); await p.click('#loginBtn');
await p.waitForTimeout(2600);
console.log('modulo aperto:', await p.evaluate(() => (document.querySelector('#tabs .on') || {}).textContent));
await p.screenshot({ path: '/tmp/tennis.png', fullPage: true });
await b.close();
console.log('ok');

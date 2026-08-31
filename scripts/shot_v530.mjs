// Prova: fitness a griglia e QR dei tavoli che si generano davvero.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6800';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const qr = await call('/api/admin/qr-ordina?punto=Bussola%20Garden&tavolo=3', { token });
console.log('QR tavolo 3 →', qr.url ? 'generato, ' + qr.url : JSON.stringify(qr).slice(0, 120));
// Due corsi con qualche lezione, per vedere la griglia piena.
const oggi = new Date().toISOString().slice(0, 10);
const fra = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
for (const [nome, ist, ora] of [['Pilates', 'Paperino', '18:00'], ['Yoga', 'Pluto', '19:00'], ['Functional', 'Minnie', '07:30']]) {
  console.log(nome, JSON.stringify(await call('/api/admin/fitness/corsi', { method: 'POST', token, body: { nome, istruttore: ist, data_inizio: oggi, data_fine: fra, giorni: [1, 3, 5], ora, durata_min: 60, posti_max: 20, min_iscritti: 10, prezzo: 5 } })).slice(0,160));
}
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore');
await p.fill('#p', 'sim');
await p.click('#loginBtn');
await p.waitForTimeout(2200);
await p.selectOption('#zonaSwitch', 'fitness').catch(() => {});
await p.waitForTimeout(2200);
await p.screenshot({ path: '/tmp/fitness_griglia.png' });
// e il dettaglio di una lezione, dove si iscrive e si incassa
await p.evaluate(() => { const b = document.querySelector('[data-fitapri]'); if (b) b.click(); });
await p.waitForTimeout(900);
await p.screenshot({ path: '/tmp/fitness_lezione.png' });
await b.close();
console.log('ok');

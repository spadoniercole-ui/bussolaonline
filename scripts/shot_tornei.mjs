import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9989';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const t = await call('/api/admin/tornei', { method: 'POST', token, body: { nome: 'Torneo di Ferragosto', disciplina: 'pickleball', posti: 8 } });
for (const n of ['Ercole S.', 'Giulia R.', 'Marco V.', 'Sara V.', 'Luca P.', 'Chiara M.', 'Nino B.', 'Elena C.']) {
  await call(`/api/admin/tornei/${t.id}/iscritti`, { method: 'POST', token, body: { nome: n } });
}
const tab = (await call(`/api/admin/tornei/${t.id}/sorteggia`, { method: 'POST', token, body: {} })).tabellone;
// due quarti giocati, per far vedere il tabellone che sale
for (const p of tab.turni[0].partite.slice(0, 2)) {
  await call(`/api/admin/tornei/partite/${p.id}`, { method: 'PUT', token, body: { vincitore: p.a_nome, punteggio: '6-3' } });
}
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1100, height: 950 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2200);
await p.evaluate(() => { const s = document.querySelector('#zonaSwitch'); s.value = 'campi'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await p.waitForTimeout(2200);
await p.evaluate(() => { const t2 = document.querySelector('#tabs [data-v="tornei"]'); if (t2) t2.click(); });
await p.waitForTimeout(2000);
await p.screenshot({ path: '/tmp/tornei.png', fullPage: true });
await b.close();
console.log('ok');

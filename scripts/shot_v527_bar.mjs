// Prova: sul database "sbagliato" (panini marcati solo Garden) il Bar li mostra lo stesso.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6300';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
for (const n of ['Panino salsiccia e cipolla caramellata', 'Panino hamburger e cheddar', 'Panino cotoletta di pollo']) {
  await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 6, stazione: 'cucina', zona: 'garden', categoria: 'Panini e fritti' } });
}
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/ordina?p=Bussola%20Bar', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cerca = await p.$('input[type="search"], [placeholder*="Cerca"]');
if (cerca) { await cerca.fill('pani'); await p.waitForTimeout(800); }
await p.screenshot({ path: '/tmp/bar_pani.png', fullPage: true });
await b.close(); console.log('ok');

// La diagnosi del menù, come la vede il gestore.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:7100';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
// Il caso reale del gestore: un comando in massa ha marcato "cucina" anche il banco, e i
// condimenti sono spenti.
for (const [n, cat] of [['Panino cotoletta di pollo', 'Panini e fritti'], ['Fettina di carne con contorno', 'Piatto']]) {
  await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 8, stazione: 'cucina', categoria: cat } });
}
for (const [n, cat] of [['Caffè espresso', 'Caffetteria'], ['Cappuccino', 'Caffetteria'], ['Amaro siciliano', 'Alcolici'], ['Granita siciliana', 'Granite'], ['Spritz', 'Aperitivi']]) {
  await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 2, stazione: 'cucina', zona: 'comune', categoria: cat } });
}
const c = await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Maionese', prezzo: 0.5, stazione: 'cucina', categoria: 'Condimenti extra' } });
await call('/api/admin/menu/' + c.id, { method: 'PUT', token, body: { attivo: false } });
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore');
await p.fill('#p', 'sim');
await p.click('#loginBtn');
await p.waitForTimeout(2200);
await p.evaluate(() => { const t = document.querySelector('#tabs [data-v="menu"]'); if (t) t.click(); });
await p.waitForTimeout(2200);
await p.evaluate(() => { const x = document.querySelector('#menu_diag'); if (x) x.click(); });
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/diagnosi.png' });
await b.close();
console.log('ok');

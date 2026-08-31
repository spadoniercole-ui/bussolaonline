// Il listino con i condimenti: prezzo bloccato e spunta Compl. che dice la verità.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8600';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Panino salsiccia e cipolla caramellata', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti', con_condimenti: true } });
for (const n of ['Formaggio svizzero', 'Olive', 'Tonno sott\'olio', 'Funghi sott\'olio']) {
  await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 1, stazione: 'cucina', zona: 'comune', categoria: 'Condimenti' } });
}
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2200);
await p.evaluate(() => { const t = document.querySelector('#tabs [data-v="menu"]'); if (t) t.click(); });
await p.waitForTimeout(2400);
await p.evaluate(() => { const r = [...document.querySelectorAll('input')].find(i => i.value === 'Formaggio svizzero'); if (r) r.scrollIntoView({ block: 'center' }); });
await p.waitForTimeout(700);
await p.screenshot({ path: '/tmp/listino_cond.png' });
await b.close();
console.log('ok');

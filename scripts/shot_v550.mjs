// Il banco con un ordine che arriva da un tavolo del Garden: prima non lo vedeva nessuno.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9200';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
for (const [n, st, cat] of [['Spritz', 'bar', 'Aperitivi'], ['Birra media', 'bar', 'Birre'], ['Panino salsiccia', 'cucina', 'Panini e fritti']]) {
  await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 6, stazione: st, zona: 'comune', categoria: cat } });
}
const menu = await call('/api/menu?zona=garden');
const spritz = menu.find((m) => m.nome === 'Spritz');
const birra = menu.find((m) => m.nome === 'Birra media');
const panino = menu.find((m) => m.stazione === 'cucina');
// un cocktail chiesto al tavolo 4, e una birra al banco
await call('/api/admin/comande', { method: 'POST', token, body: { origine: 'tavolo', zona: 'garden', riferimento: '4', righe: [{ menu_id: spritz.id, qta: 2 }, { menu_id: panino.id, qta: 1 }] } });
await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', righe: [{ menu_id: birra.id, qta: 1 }] } });
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2000);
await p.selectOption('#zonaSwitch', 'bar').catch(() => {});
await p.waitForTimeout(1800);
await p.evaluate(() => { const t = document.querySelector('#tabs [data-v="bar"]'); if (t) t.click(); });
await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/banco.png' });
await b.close();
console.log('ok');

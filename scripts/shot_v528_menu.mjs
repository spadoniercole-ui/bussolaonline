// Prova: nel listino non c'è più il tasto di abbinamento su ogni riga, e nel caffè non
// compaiono condimenti mentre nel panino sì.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6400';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
for (const [n, p] of [['Maionese', 0.5], ['Insalata', 0.5], ['Cipolla caramellata', 0.5]]) {
  const c = await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: p, stazione: 'cucina', categoria: 'Condimenti extra' } });
  await call(`/api/admin/menu/${c.id}/complemento`, { method: 'PUT', token, body: { complemento: true } });
}
const menu = await call('/api/menu?zona=bar');
const caffe = menu.find(m => /caff/i.test(m.nome));
const panino = menu.find(m => /panino/i.test(m.nome));
console.log('caffè →', caffe.nome, '| condimenti:', (caffe.complementi || []).length);
console.log('panino →', panino.nome, '| condimenti:', (panino.complementi || []).map(c => c.nome).join(', '));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1320, height: 700 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2000);
await p.evaluate(() => { const t = document.querySelector('#tabs [data-v="menu"]'); if (t) t.click(); });
await p.waitForTimeout(2000);
await p.evaluate(() => { const h = [...document.querySelectorAll('h3')].find(x => /Men.* del chiosco/i.test(x.textContent)); if (h) h.scrollIntoView(); });
await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/listino_pulito.png' });
await b.close();

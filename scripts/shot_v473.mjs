import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:5100';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const tk = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'shot-admin' } })).token;
const d = (await call('/api/admin/discipline', { token: tk }))[0];
await call(`/api/admin/tabellone/${d.id}/genera`, { method: 'POST', token: tk });
const t = await call(`/api/admin/tabellone/${d.id}`, { token: tk });
for (const g of t.gironi) {
  await call(`/api/admin/tabellone/${d.id}/giornata`, { method: 'PUT', token: tk, body: { girone_id: g.id, giornata: 1, quando: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) } });
  const ps = g.partite.filter(x => x.giornata === 1);
  await call('/api/admin/partite/' + ps[0].id, { method: 'PUT', token: tk, body: { gol_a: 3, gol_b: 1 } });
  await call('/api/admin/partite/' + ps[1].id, { method: 'PUT', token: tk, body: { gol_a: 2, gol_b: 2 } });
  // una partita slittata di un giorno
  await call('/api/admin/partite/' + g.partite.filter(x => x.giornata === 2)[0].id + '/quando', { method: 'PUT', token: tk, body: { quando: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } });
}
// pianta con un'unione
const lay = (await call('/api/admin/tavoli/layout', { token: tk })).layout.find(l => l.predefinito);
await call('/api/admin/tavoli/layout/' + lay.id, { method: 'PUT', token: tk, body: { tavoli: [
  { numero: 1, posti: 8, forma: 'rettangolo', x: 48, y: 48, uniti: [2] },
  { numero: 2, posti: 4, forma: 'tondo', x: 56, y: 48, attivo: false },
  { numero: 3, posti: 4, forma: 'tondo', x: 25, y: 35 }, { numero: 4, posti: 4, forma: 'tondo', x: 75, y: 35 },
  { numero: 5, posti: 2, forma: 'quadrato', x: 18, y: 70 }, { numero: 6, posti: 2, forma: 'quadrato', x: 82, y: 70 },
  { numero: 7, posti: 6, forma: 'rettangolo', x: 50, y: 78 }, { numero: 13, posti: 2, forma: 'tondo', x: 50, y: 18 }
] } });
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
await p.selectOption('#zonaSwitch', 'sport'); await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/sport2.png', fullPage: true });
await p.selectOption('#zonaSwitch', 'garden'); await p.waitForTimeout(1200);
await p.click('#tabs [data-v="tavoli"]'); await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/tavoli_tab.png', fullPage: true });
await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(1500);
await p.click('[data-pmodo="disposizione"]'); await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/pianta2.png', fullPage: true });
await b.close();
console.log('ok');

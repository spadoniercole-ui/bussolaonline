import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:4900';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const tk = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'shot-admin' } })).token;
const d = (await call('/api/admin/discipline', { token: tk }))[0];
await call(`/api/admin/tabellone/${d.id}/genera`, { method: 'POST', token: tk });
const t = await call(`/api/admin/tabellone/${d.id}`, { token: tk });
// qualche risultato e una data, per vedere la videata viva
for (const g of t.gironi) {
  await call(`/api/admin/tabellone/${d.id}/giornata`, { method: 'PUT', token: tk, body: { girone_id: g.id, giornata: 1, quando: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) } });
  for (const p of g.partite.filter(x => x.giornata === 1)) await call('/api/admin/partite/' + p.id, { method: 'PUT', token: tk, body: { gol_a: 3, gol_b: 1 } });
}
for (const [w, h, name] of [[1280, 1400, 'desktop'], [430, 1400, 'mobile']]) {
  const p = await b.newPage({ viewport: { width: w, height: 1000 }, isMobile: w < 600, hasTouch: w < 600 });
  await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
  await p.fill('#u', 'gestore'); await p.fill('#p', 'shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
  await p.selectOption('#zonaSwitch', 'sport'); await p.waitForTimeout(1800);
  await p.screenshot({ path: `/tmp/sport_${name}.png`, fullPage: true });
  await p.close();
}
// back office: la sezione Tornei
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
await p.goto(base + '/admin/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
await p.click('text=Tornei'); await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/admin_tornei.png', fullPage: true });
await b.close();
console.log('ok');

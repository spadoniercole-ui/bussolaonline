// La scheda della cucina con la comanda del gestore: due panini con due condimenti.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:7700';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const pan = await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Panino salsiccia e cipolla caramellata', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti', con_condimenti: true } });
const cond = [];
for (const n of ['Formaggio svizzero', 'Verdure grigliate (zucchine, melanzane, peperoni, cipolle)']) {
  const c = await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 0.5, stazione: 'cucina', categoria: 'Condimenti' } });
  await call(`/api/admin/menu/${c.id}/complemento`, { method: 'PUT', token, body: { complemento: true } });
  cond.push(c.id);
}
const r = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Garden', tavolo: '1', righe: [{ menu_id: pan.id, qta: 2, complementi: cond }] } });
const com = (await call('/api/admin/comande', { token })).find((x) => x.numero === r.numero);
await call(`/api/admin/comande/${com.id}/stato`, { method: 'PUT', token, body: { stato: 'in_preparazione' } });
const kds = await call('/api/admin/kds?stazione=cucina', { token });
console.log('righe che la cucina riceve:', (kds[0].righe || []).map((x) => x.nome).join(' | '));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 520, height: 620 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2000);
await p.selectOption('#zonaSwitch', 'cucina').catch(() => {});
await p.waitForTimeout(2200);
await p.screenshot({ path: '/tmp/kds.png' });
await b.close();
console.log('ok');

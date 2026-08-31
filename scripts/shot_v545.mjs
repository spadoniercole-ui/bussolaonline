// La sala quando la cucina toglie una riga: tavolo rosso col punto esclamativo, e aprendo il
// tavolo il messaggio in cima.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8400';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const menu = await call('/api/menu?zona=garden');
const piatto = menu.find((m) => m.stazione === 'cucina');
// tavolo 3: comanda con un piatto che la cucina non riesce a fare
const r = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Garden', tavolo: '3', righe: [{ menu_id: piatto.id, qta: 2 }] } });
const c = (await call('/api/admin/comande', { token })).find((x) => x.numero === r.numero);
await call(`/api/admin/comande/righe/${c.righe[0].id}/storna`, { method: 'PUT', token, body: { motivo: 'finito il pane siciliano' } });
// tavolo 7: comanda pronta da portare
const r2 = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Garden', tavolo: '7', righe: [{ menu_id: menu[0].id, qta: 2 }] } });
const c2 = (await call('/api/admin/comande', { token })).find((x) => x.numero === r2.numero);
await call(`/api/admin/comande/${c2.id}/stato`, { method: 'PUT', token, body: { stato: 'pronta' } });

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2400);
await p.screenshot({ path: '/tmp/sala_avviso.png' });
await p.evaluate(() => { const t = document.querySelector('#p_canvas [data-tv="3"]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/tavolo_avviso.png' });
await b.close();
console.log('ok');

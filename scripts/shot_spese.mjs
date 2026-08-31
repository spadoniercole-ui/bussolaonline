import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9988';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const T = 'RB-000001-4';
const menu = await call('/api/menu?zona=bar');
for (let i = 0; i < 3; i++) {
  const r = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', tessera_code: T, righe: [{ menu_id: menu[i % menu.length].id, qta: 2 }] } });
  await call(`/api/admin/comande/${r.id}/chiudi`, { method: 'POST', token, body: { metodo: 'contanti' } });
}
const dom = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const campi = await call('/api/campi');
// Un campo del chiosco che sia gia' aperto a quell'ora: uno con ora_min alle 18 rifiuta.
const gratis = campi.find((c) => (c.gestione || 'chiosco') === 'chiosco' && !c.ora_min) || campi.find((c) => (c.gestione || 'chiosco') === 'chiosco');
await call(`/api/campi/${gratis.id}/prenota`, { method: 'POST', body: { data: dom, slot: '10:00', tessera_code: T } });
await call(`/api/campi/${gratis.id}/prenota`, { method: 'POST', body: { data: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), slot: '11:00', tessera_code: T } });

const pren = await call(`/api/campi/${gratis.id}/prenota`, { method: 'POST', body: { data: new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10), slot: '12:00', tessera_code: T } });
console.log('prenotazione campo:', JSON.stringify(pren).slice(0, 140));
const est = await call('/api/estratto-conto?tessera_code=' + T);
console.log('estratto:', JSON.stringify(est.per_servizio), '· gratis:', est.volte_gratis);

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.fill('#gate_tess', T); await p.click('#gate_enter');
await p.waitForTimeout(2400);
await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
await p.waitForTimeout(600);
await p.evaluate(() => { const t = document.querySelector('[data-tessera]') || [...document.querySelectorAll('button')].find(b2 => /Tessera/i.test(b2.textContent || '')); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await p.waitForTimeout(1500);
console.log('tasto spese presente:', await p.evaluate(() => !!document.querySelector('[data-spese]')));
await p.evaluate(() => { const t = document.querySelector('[data-spese]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await p.waitForTimeout(1600);
await p.screenshot({ path: '/tmp/spese.png' });
await b.close();
console.log('ok');

import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9900';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
await call('/api/admin/parametri', { method: 'PUT', token, body: { garden_larghezza_m: 9, garden_profondita_m: 9, garden_ingombro_tavolo_m: 1.5, garden_corridoio_m: 1 } });
const socio = await call('/api/admin/soci', { method: 'POST', token, body: { nome: 'Ercole', cognome: 'Spadoni', data_nascita: '1980-03-03', tipo_profilo: 'socio' } });
const campi = await call('/api/campi');
await call(`/api/campi/${campi[0].id}/prenota`, { method: 'POST', body: { data: new Date().toISOString().slice(0, 10), slot: '21:00', tessera_code: socio.tessera_code } });

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
// 1) il verdetto, ora senza contraddizione
const pc = await b.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
await pc.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await pc.fill('#u', 'gestore'); await pc.fill('#p', 'sim'); await pc.click('#loginBtn');
await pc.waitForTimeout(2200);
await pc.evaluate(() => { const t = document.querySelector('#p_spazio'); if (t) t.click(); });
await pc.waitForTimeout(1400);
await pc.screenshot({ path: '/tmp/v1-verdetto.png' });
// 2) la platea dello Stage, con le sue misure
await pc.evaluate(() => { const c = document.querySelector('#mbox [data-mclose]'); if (c) c.click(); });
await pc.selectOption('#zonaSwitch', 'stage').catch(() => {});
await pc.waitForTimeout(2000);
await pc.evaluate(() => { const t = document.querySelector('#p_spazio'); if (t) t.click(); });
await pc.waitForTimeout(1400);
await pc.screenshot({ path: '/tmp/v2-stage.png' });
// 3) il tasto Disdici nell'app
const pa = await b.newPage({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
pa.on('dialog', (d) => d.accept());
await pa.goto(base + '/', { waitUntil: 'networkidle' });
await pa.waitForTimeout(900);
await pa.fill('#gate_tess', socio.tessera_code);
await pa.click('#gate_enter');
await pa.waitForTimeout(2200);
await pa.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
await pa.waitForTimeout(600);
await pa.evaluate(() => { const t = document.querySelector('[data-campi]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await pa.waitForTimeout(1800);
// La fascia prenotata e' piu' in basso: si scorre fin li', altrimenti si fotografa il vuoto.
await pa.evaluate(() => { const b = document.querySelector('[data-disdici]'); if (b) b.scrollIntoView({ block: 'center' }); });
await pa.waitForTimeout(500);
console.log('tasto Disdici presente:', await pa.evaluate(() => !!document.querySelector('[data-disdici]')));
await pa.screenshot({ path: '/tmp/v3-disdici.png' });
console.log('fasce mostrate:', await pa.evaluate(() => [...document.querySelectorAll('.matchrow b')].map(x => x.textContent).join(' ')));
await b.close();
console.log('ok');

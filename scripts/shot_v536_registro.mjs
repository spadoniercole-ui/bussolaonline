// Il registro storico visto dal gestore, con dentro una prenotazione, la sua disdetta e una
// comanda incassata.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:7400';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const socio = (await call('/api/admin/soci', { token }))[0];
const domani = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
// una cena prenotata e poi disdetta dal socio
const p1 = await call('/api/garden/prenota', { method: 'POST', body: { data: domani, turno: '20:00', persone: 4, tessera_code: socio.tessera_code } });
await call(`/api/garden/prenotazioni/${p1.id}/annulla`, { method: 'POST', body: { tessera_code: socio.tessera_code } });
// una cena che resta
await call('/api/garden/prenota', { method: 'POST', body: { data: domani, turno: '21:30', persone: 2, tessera_code: socio.tessera_code } });
// una comanda aperta e incassata
const menu = await call('/api/menu?zona=bar');
const r = await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', tessera_code: socio.tessera_code, righe: [{ menu_id: menu[0].id, qta: 2 }] } });
const com = (await call('/api/admin/comande', { token })).find((x) => x.numero === r.numero);
await call(`/api/admin/comande/${com.id}/stato`, { method: 'PUT', token, body: { stato: 'chiusa' } });
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 760 }, deviceScaleFactor: 2 });
await pg.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await pg.fill('#u', 'gestore'); await pg.fill('#p', 'sim'); await pg.click('#loginBtn');
await pg.waitForTimeout(2200);
await pg.evaluate(() => { const t = document.querySelector('#tabs [data-v="registro"]'); if (t) t.click(); });
await pg.waitForTimeout(2000);
await pg.screenshot({ path: '/tmp/registro.png' });
await b.close();
console.log('ok');

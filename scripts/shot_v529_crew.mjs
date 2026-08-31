// Prova: al Garden il Crew si apre sulla Pianta, col pannello degli ordini dal QR in cima,
// e il tavolo mostra un conto solo con dentro sia il QR sia la crew.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6601';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const menu = await call('/api/menu?zona=garden');
const piatto = menu.find((m) => m.stazione === 'cucina');
const bibita = menu.find((m) => m.stazione === 'bar');
// Una comanda dal QR e una battuta dalla crew, sullo stesso tavolo.
await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Garden', tavolo: '3', righe: [{ menu_id: piatto.id, qta: 2, complementi: (piatto.complementi || []).slice(0, 1).map((c) => c.id) }] } });
await call('/api/admin/comande', { method: 'POST', token, body: { origine: 'tavolo', zona: 'garden', riferimento: '3', righe: [{ menu_id: bibita.id, qta: 3 }] } });
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore');
await p.fill('#p', 'sim');
await p.click('#loginBtn');
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/crew_pianta.png' });
await p.evaluate(() => { const t = document.querySelector('#p_canvas [data-pren="3"]'); if (t) t.click(); });
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/crew_conto.png' });
await b.close();
console.log('ok');

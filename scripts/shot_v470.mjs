import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const PORT = process.env.PORT || 4800;
const base = `http://127.0.0.1:${PORT}`;
const root = '/opt/pw-browsers';
const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `${root}/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });

const call = async (p, opts = {}) => {
  const r = await fetch(base + p, { headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) }, method: opts.method || 'GET', body: opts.body ? JSON.stringify(opts.body) : undefined });
  return r.json();
};
const tk = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'shot-admin' } })).token;
const data = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

// disposizione realistica: isole al centro, tavoli piccoli a bordo sala
const tavoli = [
  { numero: 1, posti: 4, forma: 'tondo', x: 44, y: 46 }, { numero: 2, posti: 4, forma: 'tondo', x: 56, y: 46 },
  { numero: 3, posti: 6, forma: 'rettangolo', x: 50, y: 60 }, { numero: 4, posti: 2, forma: 'quadrato', x: 30, y: 34 },
  { numero: 5, posti: 2, forma: 'quadrato', x: 70, y: 34 }, { numero: 6, posti: 4, forma: 'tondo', x: 22, y: 60 },
  { numero: 7, posti: 4, forma: 'tondo', x: 78, y: 60 }, { numero: 8, posti: 6, forma: 'rettangolo', x: 50, y: 80 },
  { numero: 9, posti: 2, forma: 'quadrato', x: 14, y: 82 }, { numero: 10, posti: 2, forma: 'quadrato', x: 86, y: 82 },
  { numero: 11, posti: 4, forma: 'tondo', x: 14, y: 20 }, { numero: 12, posti: 4, forma: 'tondo', x: 86, y: 20 }
];
const lay = (await call('/api/admin/tavoli/layout', { token: tk })).layout.find(l => l.predefinito);
await call('/api/admin/tavoli/layout/' + lay.id, { method: 'PUT', token: tk, body: { tavoli } });

// qualche prenotazione: si deve vedere il riempimento dal centro
for (const [t, n] of [['BR-2026-0001', 4], ['BR-2026-0002', 2], ['BR-2026-0003', 6]]) {
  await call('/api/garden/prenota', { method: 'POST', body: { tessera_code: t, data, turno: '20:00', persone: n } });
}
await call('/api/admin/tavoli/prenota', { method: 'POST', token: tk, body: { data, turno: '20:00', persone: 2, nome: 'Sig. Bianchi' } });

const p = await b.newPage({ viewport: { width: 430, height: 1000 }, isMobile: true, hasTouch: true });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'shot-admin');
await p.click('#loginBtn'); await p.waitForTimeout(2000);
await p.selectOption('#zonaSwitch', 'garden').catch(() => { });
await p.waitForTimeout(1200);
await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(1500);
await p.fill('#p_data', data); await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/pianta_servizio.png', fullPage: true });
await p.click('[data-pmodo="disposizione"]'); await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/pianta_disposizione.png', fullPage: true });
await b.close();
console.log('ok');

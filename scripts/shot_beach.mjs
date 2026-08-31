import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9983';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const ora = new Date().getHours();
await call('/api/admin/parametri', { method: 'PUT', token, body: {
  beach_attiva: true, beach_mattina_da: '00:00', beach_mattina_a: '12:00',
  beach_pomeriggio_da: '12:00', beach_pomeriggio_a: '23:59'
} });
const s = await call('/api/admin/spiaggia', { token });
const misure = { Grande: [22, 16], Caltagirone: [16, 12], Piccola: [10, 9], Quadrata: [12, 12] };
const quanti = { Grande: 12, Caltagirone: 6, Piccola: 4, Quadrata: 6 };
for (const p of s.piazzole) {
  // Le misure PRIMA: senza, la creazione viene rifiutata — ed e' giusto cosi'.
  await call(`/api/admin/spiaggia/piazzole/${p.id}`, { method: 'PUT', token, body: { larghezza_m: misure[p.nome][0], profondita_m: misure[p.nome][1] } });
  const r = await call(`/api/admin/spiaggia/piazzole/${p.id}/ombrelloni`, { method: 'POST', token, body: { quanti: quanti[p.nome] } });
  if (r.error) console.log('  ', p.nome, '→', r.error.slice(0, 90));
}
// una presa nella fascia in corso, e una scaduta e mai rilasciata nella fascia del mattino

// qualcuno in spiaggia
const socio = await call('/api/admin/soci', { method: 'POST', token, body: { nome: 'Famiglia', cognome: 'Russo', data_nascita: '1982-04-04', sesso: 'F', nucleo: 'russo' } });
const pub = await call('/api/spiaggia');
const g = pub.piazzole.find((p) => p.nome === 'Grande');
await call('/api/spiaggia/prendi', { method: 'POST', body: { tessera_code: socio.tessera_code, ombrellone_id: g.ombrelloni[2].id, fascia: pub.fascia } });
const s2 = await call('/api/admin/soci', { method: 'POST', token, body: { nome: 'Coppia', cognome: 'Bianchi', data_nascita: '1975-04-04', sesso: 'M', nucleo: 'bianchi' } });
await call('/api/spiaggia/prendi', { method: 'POST', body: { tessera_code: s2.tessera_code, ombrellone_id: g.ombrelloni[5].id, fascia: pub.fascia } });
// e uno che non ha rilasciato quando la fascia e' finita: e' il caso che deve saltare all'occhio
const s3 = await call('/api/admin/soci', { method: 'POST', token, body: { nome: 'Distratto', cognome: 'Verdi', data_nascita: '1970-01-01', sesso: 'M', nucleo: 'verdi' } });
await call('/api/admin/parametri', { method: 'PUT', token, body: { beach_mattina_da: '00:00', beach_mattina_a: '23:58' } });
await call('/api/spiaggia/prendi', { method: 'POST', body: { tessera_code: s3.tessera_code, ombrellone_id: g.ombrelloni[8].id, fascia: 'mattina' } });
await call('/api/admin/parametri', { method: 'PUT', token, body: { beach_mattina_da: '06:00', beach_mattina_a: '06:30' } });

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1150, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2200);
await p.evaluate(() => { const sw = document.querySelector('#zonaSwitch'); sw.value = 'beach'; sw.dispatchEvent(new Event('change', { bubbles: true })); });
await p.waitForTimeout(2400);
console.log('modulo:', await p.evaluate(() => (document.querySelector('#tabs .on') || {}).textContent));
await p.screenshot({ path: '/tmp/beach.png', fullPage: true });
await b.close();
console.log('ok');

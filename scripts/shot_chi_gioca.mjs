// Pippo prenota "Solo io" e dichiara chi gioca con lui: due amici soci e un cugino ospite.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9500';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const fai = async (n, c) => await call('/api/admin/soci', { method: 'POST', token, body: { nome: n, cognome: c, data_nascita: '1988-04-02', tipo_profilo: 'socio' } });
const pippo = await fai('Pippo', 'Sanfilippo');
const sara = await fai('Sara', 'Mancuso');
const campi = await call('/api/campi');
const tennis = campi.find((c) => /tennis/i.test(c.nome)) || campi[0];

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
p.on('dialog', (d) => d.accept());
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.fill('#gate_tess', pippo.tessera_code);
await p.click('#gate_enter');
await p.waitForTimeout(2200);
await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
await p.waitForTimeout(600);
const apri = async () => {
  await p.evaluate(() => { const t = document.querySelector('[data-campi]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await p.waitForTimeout(1600);
  await p.evaluate((id) => { const t = document.querySelector(`[data-campo-pick="${id}"]`); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, tennis.id);
  await p.waitForTimeout(1400);
};
await apri();
// Pippo prenota "Solo io"
await p.evaluate(() => { const t = document.querySelector('[data-prenota$="|18:00"]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await p.waitForTimeout(1600);
await apri();
// Si controlla col server invece di fidarsi della schermata: se la prenotazione non c'e',
// inutile cercare un tasto che non puo' esistere.
const oggi = new Date().toISOString().slice(0, 10);
const disp = await call(`/api/campi/${tennis.id}/disponibilita?data=${oggi}`);
const s18 = (disp.slots || []).find((x) => x.slot === '18:00');
console.log('stato 18:00 →', JSON.stringify(s18));
console.log('tasto "Chi gioca" presente:', await p.evaluate(() => !!document.querySelector('[data-chigioca]')));
await p.evaluate(() => { const t = document.querySelector('[data-chigioca]'); if (t) t.scrollIntoView({ block: 'center' }); });
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/c1-riservata.png' });
// apre "Chi gioca"
await p.evaluate(() => { const t = document.querySelector('[data-chigioca]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await p.waitForTimeout(1400);
await p.screenshot({ path: '/tmp/c2-chi-gioca-vuoto.png' });
// aggiunge un socio con la tessera e un ospite col nome
for (const v of [sara.tessera_code, 'Cugino Nino']) {
  await p.fill('#gioc_v', v);
  await p.evaluate(() => { const t = document.querySelector('[data-giocadd]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await p.waitForTimeout(1400);
}
await p.screenshot({ path: '/tmp/c3-chi-gioca-pieno.png' });
// e al banco
const pc = await b.newPage({ viewport: { width: 1150, height: 620 }, deviceScaleFactor: 2 });
await pc.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await pc.fill('#u', 'gestore'); await pc.fill('#p', 'sim'); await pc.click('#loginBtn');
await pc.waitForTimeout(2000);
await pc.selectOption('#zonaSwitch', 'campi').catch(() => {});
await pc.waitForTimeout(2200);
await pc.screenshot({ path: '/tmp/c4-crew.png' });
await b.close();
console.log('ok');

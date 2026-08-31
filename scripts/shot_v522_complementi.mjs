// Prova visiva del requisito: i condimenti stanno DENTRO il rettangolo del prodotto.
// Si tocca il prodotto, si mette la quantita', si apre "complementi" e si spuntano.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6001';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();

const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'shot-admin' } });
// Un panino di cucina venduto in tutti e due i punti, e tre condimenti da spuntarci dentro.
const panino = await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Panino con petto di pollo', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti', descrizione: 'Petto di pollo alla piastra, pane siciliano' } });
const cond = [];
for (const [n, pr] of [['Maionese', 0.5], ['Insalata', 0.5], ['Cipolla caramellata', 0.5], ['Provola', 0.5]]) {
  const c = await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: pr, stazione: 'cucina', zona: 'comune', categoria: 'Condimenti extra' } });
  await call(`/api/admin/menu/${c.id}/complemento`, { method: 'PUT', token, body: { complemento: true } });
  cond.push(c.id);
}
await call(`/api/admin/menu/${panino.id}/complementi`, { method: 'PUT', token, body: { complementi: cond } });

const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/ordina?punto=Bussola%20Garden', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
// Si cerca il panino, si aggiunge una quantita', poi si aprono i condimenti.
const cerca = await p.$('[data-cq], #cmd_q, input[type="search"]');
if (cerca) { await cerca.fill('petto di pollo'); await p.waitForTimeout(600); }
const add = await p.$(`[data-cadd="${panino.id}"]`);
if (add) { await add.click(); await add.click(); await p.waitForTimeout(400); }
const more = await p.$(`[data-cmore="${panino.id}"]`);
if (more) { await more.click(); await p.waitForTimeout(500); }
const box = await p.$(`[data-cbox="${panino.id}"]`);
if (box) {
  const chk = await box.$$('input[type="checkbox"]');
  if (chk[0]) await chk[0].click();
  if (chk[2]) await chk[2].click();
  await p.waitForTimeout(400);
}
await p.screenshot({ path: '/tmp/complementi_prodotto.png', fullPage: true });
const card = await p.$(`.cmd-item:has([data-cmore="${panino.id}"])`);
if (card) await card.screenshot({ path: '/tmp/complementi_rettangolo.png' });
await b.close();
console.log('ok', { panino: panino.id, cond });

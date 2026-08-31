// Prova: la spunta «Condimenti» nel listino, e la riga che ne esce dentro il panino.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:7300';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();
const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });
const pan = await call('/api/admin/menu', { method: 'POST', token, body: { nome: 'Panino con petto di pollo', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti', descrizione: 'Petto di pollo alla piastra, pane siciliano', con_condimenti: true } });
for (const n of ['Maionese', 'Ketchup', 'Insalata', 'Cipolla caramellata']) {
  const c = await call('/api/admin/menu', { method: 'POST', token, body: { nome: n, prezzo: 0.5, stazione: 'cucina', categoria: 'Condimenti extra' } });
  await call(`/api/admin/menu/${c.id}/complemento`, { method: 'PUT', token, body: { complemento: true } });
}
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
// 1) il listino con la nuova colonna
const g = await b.newPage({ viewport: { width: 1400, height: 620 }, deviceScaleFactor: 2 });
await g.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await g.fill('#u', 'gestore'); await g.fill('#p', 'sim'); await g.click('#loginBtn');
await g.waitForTimeout(2200);
await g.evaluate(() => { const t = document.querySelector('#tabs [data-v="menu"]'); if (t) t.click(); });
await g.waitForTimeout(2200);
await g.evaluate(() => { const h = [...document.querySelectorAll('h3')].find(x => /Men.* del chiosco/i.test(x.textContent)); if (h) h.scrollIntoView(); });
await g.waitForTimeout(600);
await g.screenshot({ path: '/tmp/listino_condimenti.png' });
// 2) il panino nel menù, con la riga aperta
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/ordina?p=Bussola%20Bar', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cerca = await p.$('input[type="search"], [placeholder*="Cerca"]');
if (cerca) { await cerca.fill('petto di pollo'); await p.waitForTimeout(700); }
const add = await p.$(`[data-cadd="${pan.id}"]`); if (add) await add.click();
const more = await p.$(`[data-cmore="${pan.id}"]`); if (more) { await more.click(); await p.waitForTimeout(500); }
const box = await p.$(`[data-cbox="${pan.id}"]`);
if (box) { const ch = await box.$$('input[type="checkbox"]'); if (ch[0]) await ch[0].click(); if (ch[3]) await ch[3].click(); }
await p.waitForTimeout(500);
const card = await p.$(`.cmd-item:has([data-cmore="${pan.id}"])`);
if (card) await card.screenshot({ path: '/tmp/panino_condimenti.png' });
await b.close();
console.log('ok');

import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const PORT = process.env.PORT || 4700;
const base = `http://127.0.0.1:${PORT}`;
const root = '/opt/pw-browsers';
const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `${root}/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });

const api = async (p, opts = {}) => {
  const r = await fetch(base + '/api/admin' + p, { headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) }, method: opts.method || 'GET', body: opts.body ? JSON.stringify(opts.body) : undefined });
  return r.json();
};
const adm = (await api('/login', { method: 'POST', body: { username: 'gestore', password: process.env.ADMIN_PASSWORD || 'shot-admin' } })).token;

// operatore con il SOLO permesso cdc + un po' di dati da mostrare
await api('/operatori', { method: 'POST', token: adm, body: { username: 'biblio', password: 'biblio2026', ruolo: 'staff', permessi: ['cdc', 'magazzino'] } });
await api('/magazzino', { method: 'POST', token: adm, body: { nome: 'Capsule caffè', area: 'casa_di_carta', zona: 'cdc', unita: 'pz', giacenza: 240, punto_riordino: 40 } });
await api('/magazzino', { method: 'POST', token: adm, body: { nome: 'Bicchieri carta', area: 'casa_di_carta', zona: 'cdc', unita: 'pz', giacenza: 500, punto_riordino: 100 } });
await api('/cdc/giochi', { method: 'POST', token: adm, body: { nome: 'Scarabeo', categoria: 'da tavolo', quantita: 2 } });
await api('/cdc/giochi', { method: 'POST', token: adm, body: { nome: 'Risiko', categoria: 'da tavolo', quantita: 1 } });
await api('/cdc/prestiti', { method: 'POST', token: adm, body: { gioco_nome: 'Scarabeo', giocatore: 'Fam. Rossi', ora_inizio: '17:20' } });

const shot = async (user, pw, zona, file) => {
  const p = await b.newPage({ viewport: { width: 430, height: 940 }, isMobile: true, hasTouch: true });
  await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
  await p.fill('#u', user);
  await p.fill('#p', pw);
  await p.click('#loginBtn').catch(() => p.keyboard.press('Enter'));
  await p.waitForTimeout(2000);
  if (zona) { await p.selectOption('#zonaSwitch', zona).catch(() => { }); await p.waitForTimeout(1800); }
  await p.screenshot({ path: file, fullPage: true });
  await p.close();
};

await shot('biblio', 'biblio2026', 'cdc', '/tmp/crew_cdc.png');
await shot('gestore', process.env.ADMIN_PASSWORD || 'shot-admin', 'campi', '/tmp/crew_campi.png');
await shot('gestore', process.env.ADMIN_PASSWORD || 'shot-admin', 'serate', '/tmp/crew_serate.png');

// operatore senza alcun permesso operativo: deve leggere cosa gli manca
await api('/operatori', { method: 'POST', token: adm, body: { username: 'nessuno', password: 'nessuno2026', ruolo: 'staff', permessi: ['proposte'] } });
const p = await b.newPage({ viewport: { width: 430, height: 700 }, isMobile: true });
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'nessuno'); await p.fill('#p', 'nessuno2026');
await p.click('#loginBtn').catch(() => { });
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/crew_noperm.png' });
await b.close();
console.log('ok');

// Verifica visiva dei complementi dentro il rettangolo del prodotto.
// Non basta che l'API restituisca i complementi: bisogna vederli dove li cerca il cliente.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:4799';
const exe = execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1").toString().trim();

const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
p.on('console', (m) => { if (m.type() === 'error') console.log('JS ERROR:', m.text()); });

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
// chiude eventuali modali di benvenuto
for (const sel of ['[data-close]', '.ov .btn.ghost', '#ov_close']) {
  const el = await p.$(sel); if (el) { await el.click().catch(() => {}); await p.waitForTimeout(400); }
}
// login con una tessera del seed
const inp = await p.$('input');
if (inp) { await inp.fill('BR-2026-0001'); await p.waitForTimeout(200); }
const entra = await p.$('text=Entra');
if (entra) { await entra.click(); await p.waitForTimeout(2000); }
await p.screenshot({ path: '/home/claude/shots/01-home.png' });

// apre il Garden -> Ordina dal Tavolo
const apri = await p.$('text=Bussola Garden');
if (apri) { await apri.click({ force: true }); await p.waitForTimeout(1200); }
await p.screenshot({ path: '/home/claude/shots/02-garden.png' });

const ord = await p.$('text=Ordina dal Tavolo');
if (ord) { await ord.click(); await p.waitForTimeout(1200); }
await p.screenshot({ path: '/home/claude/shots/03-ordina.png' });

// cerca il link dei complementi dentro una riga prodotto
const more = await p.$('[data-cmore]');
console.log('complementi presenti nel rettangolo:', !!more);
if (more) {
  await more.scrollIntoViewIfNeeded();
  await p.screenshot({ path: '/home/claude/shots/04-riga-chiusa.png' });
  await more.click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/claude/shots/05-complementi-aperti.png' });
  const chk = await p.$('[data-ccomp]');
  if (chk) { await chk.click(); await p.waitForTimeout(400); }
  await p.screenshot({ path: '/home/claude/shots/06-spuntato.png' });
}
await b.close();
console.log('fatto');

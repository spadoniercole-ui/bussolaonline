// Prova: il Bar mostra panini e piatti con i condimenti dentro, su un listino importato
// tutto come "Bar" — cioè il caso reale del gestore.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6506';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 940 }, deviceScaleFactor: 2 });
await p.goto(base + '/ordina?p=Bussola%20Bar', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cerca = await p.$('input[type="search"], [placeholder*="Cerca"]');
if (cerca) { await cerca.fill('panino'); await p.waitForTimeout(700); }
const more = await p.$('[data-cmore]');
if (more) { await more.click(); await p.waitForTimeout(500); }
await p.screenshot({ path: '/tmp/bar_v529.png', fullPage: true });
await b.close(); console.log('ok');

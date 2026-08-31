// Prova: l'app in tedesco, dove prima restava mezza in italiano.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6901';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.fill('#gate_tess', 'BR-2026-0001');
await p.click('#gate_enter');
await p.waitForTimeout(2500);
await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find(e => /Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
await p.waitForTimeout(600);
// selettore lingua → tedesco
await p.evaluate(() => { localStorage.setItem('koine_lang_code', JSON.stringify('de')); });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find(e => /Verstanden|Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
await p.waitForTimeout(700);
await p.screenshot({ path: '/tmp/app_de.png' });
await b.close();
console.log('ok');

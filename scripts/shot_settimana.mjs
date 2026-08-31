import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9986';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.fill('#gate_tess', 'RB-000001-4'); await p.click('#gate_enter');
await p.waitForTimeout(2400);
await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
await p.waitForTimeout(600);
// La barra in basso: si tocca la voce "Settimana".
await p.evaluate(() => {
  const t = [...document.querySelectorAll('nav button, .tabbar button, [data-tab]')].find(e => /Settimana/i.test(e.textContent || ''));
  if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await p.waitForTimeout(1800);
console.log('nota ancora presente?', await p.evaluate(() => /pomeriggio è dello sport/i.test(document.body.innerText)));
await p.screenshot({ path: '/tmp/settimana.png' });
await b.close();

import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9976';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2400);
const stato = () => p.evaluate(() => ({
  zona: (document.querySelector('#zonaSwitch') || {}).value,
  tab: (document.querySelector('#tabs .on') || {}).textContent,
  titolo: (document.querySelector('#view h3') || {}).textContent,
  badge: (document.querySelector('#view .tag') || {}).textContent, elementi: document.querySelectorAll('#p_canvas [style*="position:absolute"]').length
}));
await p.evaluate(() => { const s = document.querySelector('#zonaSwitch'); s.value = 'cinema'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await p.waitForTimeout(2200);
console.log('1. entrato nel modulo cinema  :', JSON.stringify(await stato()));
// la scheda della platea
await p.evaluate(() => { const t = [...document.querySelectorAll('#tabs button')].find(x => /Organizzazione sala/i.test(x.textContent)); if (t) t.click(); });
await p.waitForTimeout(2000);
console.log('2. scheda della platea        :', JSON.stringify(await stato()));
// "Modifica pianta"
await p.evaluate(() => { const t = [...document.querySelectorAll('button')].find(x => /Modifica pianta/i.test(x.textContent)); if (t) t.click(); });
await p.waitForTimeout(2200);
console.log('3. dopo "Modifica pianta"     :', JSON.stringify(await stato()));
console.log('   elementi disegnati         :', await p.evaluate(() => document.querySelectorAll('#p_canvas [data-tv]').length || document.querySelectorAll('#p_canvas > div').length));
await p.screenshot({ path: '/tmp/stage_edit.png', fullPage: true });
await b.close();

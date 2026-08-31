import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9984';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1250, height: 900 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/admin/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2200);
await p.evaluate(() => { const t = document.querySelector('#menu [data-v="parametri"]'); if (t) t.click(); });
await p.waitForTimeout(2500);
// quali controlli hanno i parametri di testo
console.log('tendine vuote rimaste:', await p.evaluate(() =>
  [...document.querySelectorAll('select.p_in')].filter(s => s.options.length === 0).length));
for (const k of ['coppa_chiusura_formazioni', 'coppa_riapertura', 'aiuto_numero', 'fitness_griglia_da']) {
  console.log(k.padEnd(28), await p.evaluate((key) => {
    const el = document.querySelector(`.p_in[data-pk="${key}"]`);
    return el ? el.tagName.toLowerCase() + (el.type ? ' type=' + el.type : '') : 'non trovato';
  }, k));
}
// si puo' scrivere davvero?
await p.evaluate(() => { const el = document.querySelector('.p_in[data-pk="aiuto_numero"]'); if (el) { el.value = '+39 0931 000000'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
await p.evaluate(() => { const el = document.querySelector('.p_in[data-pk="coppa_riapertura"]'); if (el) { el.value = '2027-07-18'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
await p.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find(x => /Salva le regole/i.test(x.textContent || '')); if (b2) b2.click(); });
await p.waitForTimeout(1800);
await b.close();
console.log('ok');

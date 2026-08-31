import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:9300';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
p.on('pageerror', (e) => console.log('  ECCEZIONE:', String(e.message).slice(0, 140)));
await p.goto(base + '/admin/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore'); await p.fill('#p', 'sim'); await p.click('#loginBtn');
await p.waitForTimeout(2000);
await p.evaluate(() => { const t = document.querySelector('#menu [data-v="parametri"]'); if (t) t.click(); });
await p.waitForTimeout(2500);
console.log('pannelli con data-fold :', await p.evaluate(() => document.querySelectorAll('#view .panel[data-fold]').length));
console.log('barra comprimi presente:', await p.evaluate(() => !!document.querySelector('.foldbar')));
console.log('h3 con handler         :', await p.evaluate(() => [...document.querySelectorAll('#view .panel > h3')].filter(h => !!h.onclick).length));
await p.evaluate(() => { const h = document.querySelector('#view .panel > h3'); if (h) h.click(); });
await p.waitForTimeout(400);
console.log('dopo click sul titolo  → classe chiuso:', await p.evaluate(() => document.querySelector('#view .panel')?.classList.contains('chiuso')));
console.log('  contenuto nascosto?  :', await p.evaluate(() => { const p2 = document.querySelector('#view .panel'); const f = [...p2.children].find(c => c.tagName !== 'H3'); return f ? getComputedStyle(f).display : 'nessun figlio'; }));
await p.evaluate(() => { const t = document.querySelector('#fold_tutti'); if (t) t.click(); });
await p.waitForTimeout(400);
console.log('dopo "Comprimi tutto"  → chiusi:', await p.evaluate(() => document.querySelectorAll('#view .panel.chiuso').length), 'su', await p.evaluate(() => document.querySelectorAll('#view .panel[data-fold]').length));
await p.screenshot({ path: '/tmp/fold.png', fullPage: true });
// Che altezza ha la pagina dopo aver compresso tutto? Se resta lunga, qualcosa non si e' chiuso.
console.log('altezza pagina dopo Comprimi tutto:', await p.evaluate(() => document.body.scrollHeight));
console.log('elementi ancora visibili:', await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('#view .panel.chiuso > *').forEach((el) => {
    if (getComputedStyle(el).display !== 'none') out.push(el.tagName + '.' + (el.className || '-') + ' :: ' + (el.textContent || '').trim().slice(0, 40));
  });
  return out.slice(0, 6);
}));
await b.close();

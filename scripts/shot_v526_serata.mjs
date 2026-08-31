// Prova visiva: la scheda del lunedì (giorno di riposo) non deve mostrare un tasto vuoto.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6208';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.fill('#gate_tess', 'BR-2026-0001');
await p.click('#gate_enter');
await p.waitForTimeout(2500);
// La guida rapida si apre al primo accesso: si chiude, altrimenti copre la scheda.
await p.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Ho capito/i.test(x.textContent || ''));
  if (b) b.click();
});
await p.waitForTimeout(700);
await p.waitForTimeout(800);
await p.evaluate(() => {
  const r = document.querySelector('[data-open="lun"]');
  if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/serata_lun.png' });
await b.close(); console.log('ok');

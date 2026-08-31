import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:6103';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
await p.goto(base + '/ordina?p=Bussola%20Bar', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cerca = await p.$('input[type="search"], [placeholder*="Cerca"]');
if (cerca) { await cerca.fill('panino'); await p.waitForTimeout(700); }
await p.screenshot({ path: '/tmp/bar_panini.png', fullPage: true });
await b.close(); console.log('ok');

import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:5200';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 940 }, isMobile: true, hasTouch: true });
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.fill('#gate_tess', 'BR-2026-0001'); await p.click('#gate_enter'); await p.waitForTimeout(2200);
await p.click('text=Ho capito, inizia').catch(() => { }); await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/app_home.png', fullPage: true });
// Garden
await p.click('[data-ordina="garden"]'); await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/app_garden.png', fullPage: true });
await p.click('[data-gard-pren]').catch(() => { }); await p.waitForTimeout(1800);
await p.click('text=OK').catch(() => { }); await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/app_garden2.png', fullPage: true });
await p.click('[data-close]').catch(() => { }); await p.waitForTimeout(600);
// Coppa → appartenenti
await p.evaluate(() => go('coppa'));
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/app_coppa.png', fullPage: true });
// apre la casata del socio (quella con gli iscritti), non la prima in classifica
const riga = await p.$('[data-casatamembri]:has-text("Aretusa")') || await p.$('[data-casatamembri]');
if (riga) { await riga.click(); await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/app_casata.png', fullPage: true }); }
await b.close();
console.log('ok');

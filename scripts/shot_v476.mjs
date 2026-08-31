import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:5402';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
// back office: QR allineati
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
await p.goto(base + '/admin/', { waitUntil: 'networkidle' });
await p.fill('#u','gestore'); await p.fill('#p','shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
await p.click('button[data-v="installa"]'); await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/qr_desk.png', fullPage: true });
await p.close();
// back office da telefono
const m = await b.newPage({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
await m.goto(base + '/admin/', { waitUntil: 'networkidle' });
await m.fill('#u','gestore'); await m.fill('#p','shot-admin'); await m.click('#loginBtn'); await m.waitForTimeout(1800);
await m.click('#navToggle').catch(()=>{});
await m.click('button[data-v="installa"]'); await m.waitForTimeout(1800);
await m.screenshot({ path: '/tmp/qr_mob.png', fullPage: true });
await m.close();
// app soci: testata
const a = await b.newPage({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
await a.goto(base + '/', { waitUntil: 'networkidle' });
await a.fill('#gate_tess','BR-2026-0001'); await a.click('#gate_enter'); await a.waitForTimeout(2200);
await a.click('text=Ho capito, inizia').catch(()=>{}); await a.waitForTimeout(800);
await a.screenshot({ path: '/tmp/app_head.png', fullPage: true });
await b.close(); console.log('ok');

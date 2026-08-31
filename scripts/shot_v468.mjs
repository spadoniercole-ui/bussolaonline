import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const PORT = process.env.PORT || 4300;
const base = `http://127.0.0.1:${PORT}`;
const root = '/opt/pw-browsers';
const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
const exe = `${root}/${dir}/chrome-linux/chrome`;

const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

// Back office: campi (regole + blocchi + prospetto)
const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
await p.goto(base + '/admin/', { waitUntil: 'networkidle' });
await p.fill('#u', 'gestore');
await p.fill('#p', process.env.ADMIN_PASSWORD || 'shot-admin');
await p.click('#loginBtn').catch(() => p.keyboard.press('Enter'));
await p.waitForTimeout(1500);
await p.click('text=Campi').catch(() => { });
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/shot_admin_campi.png', fullPage: true });
await p.click('text=Casate & punti').catch(() => { });
await p.waitForTimeout(1800);
await p.screenshot({ path: '/tmp/shot_admin_coppa.png', fullPage: true });

// App soci: foglio prenotazione campi
const m = await b.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
await m.goto(base + '/', { waitUntil: 'networkidle' });
await m.waitForTimeout(1200);
await m.screenshot({ path: '/tmp/shot_app_home.png' });
// accesso con la tessera del socio demo
await m.fill('#gate_tess', 'BR-2026-0001');
await m.click('#gate_enter');
await m.waitForTimeout(2000);
await m.screenshot({ path: '/tmp/shot_app_home.png' });
await m.click('text=Ho capito, inizia').catch(() => { });
await m.waitForTimeout(800);
await m.click('[data-campi]').catch(() => { });
await m.waitForTimeout(2000);
await m.screenshot({ path: '/tmp/shot_app_campi.png', fullPage: true });
// prenota e ricontrolla: quota residua + slot occupato
const btn = await m.$('[data-apri]');
m.on('dialog', (d) => d.accept());
if (btn) { await btn.click(); await m.waitForTimeout(2200); }
await m.click('text=OK').catch(() => { });
await m.waitForTimeout(1500);
await m.screenshot({ path: '/tmp/shot_app_dopo.png', fullPage: true });

await b.close();
console.log('screenshot salvati');

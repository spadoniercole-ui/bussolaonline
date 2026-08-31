// Genera i materiali dei manuali: filmati delle funzioni principali (app soci) e schermate
// di riferimento (app soci, Crew, back office). Un filmato per funzione, con pause leggibili.
import { chromium } from 'playwright-core';
import { readdirSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:5998';
const OUT = process.env.OUT || '/tmp/doc';
const VID = join(OUT, 'video');
const IMG = join(OUT, 'img');
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const EXE = `/opt/pw-browsers/${dir}/chrome-linux/chrome`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(VID, { recursive: true });
mkdirSync(IMG, { recursive: true });

const call = async (p, o = {}) => (await fetch(BASE + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
  body: o.body ? JSON.stringify(o.body) : undefined
})).json();

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const tk = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'bussola2026' } })).token;
const oggi = new Date().toISOString().slice(0, 10);

// ---- dati di scena, perché un manuale con schermate vuote non spiega niente ----
const f = await call('/api/admin/film', { method: 'POST', token: tk, body: { titolo: 'Nuovo Cinema Paradiso', regia: 'Giuseppe Tornatore', anno: 1988, durata_min: 155, genere: 'drammatico', sinossi: 'Un regista torna al paese e ritrova il proiezionista che gli insegnò il cinema.' } });
await call('/api/admin/proiezioni', { method: 'POST', token: tk, body: { film_id: f.id, data: oggi, ora: '21:30' } });
const lun = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const piu = (iso, g) => new Date(new Date(iso + 'T12:00:00Z').getTime() + g * 864e5).toISOString().slice(0, 10);
await call('/api/admin/fitness/corsi', { method: 'POST', token: tk, body: { nome: 'Pilates', istruttore: 'Anna Rizzo', data_inizio: lun, data_fine: piu(lun, 13), giorni: [1, 3, 5], ora: '18:00', durata_min: 50, posti_max: 20, min_iscritti: 10, prezzo: 12 } });
await call('/api/admin/fitness/corsi', { method: 'POST', token: tk, body: { nome: 'Yoga all’alba', istruttore: 'Marco Li Volsi', data_inizio: lun, data_fine: piu(lun, 13), giorni: [2, 4, 6], ora: '07:00', durata_min: 60, posti_max: 15, min_iscritti: 10, prezzo: 15 } });
const menu = await call('/api/menu?zona=garden');
await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Garden', tavolo: '3', righe: [{ menu_id: menu[0].id, qta: 2 }, { menu_id: menu[1].id, qta: 1 }] } });
await call('/api/garden/prenota', { method: 'POST', body: { tessera_code: 'BR-2026-0002', data: oggi, turno: '20:00', persone: 2 } });
await call('/api/admin/magazzino', { method: 'POST', token: tk, body: { nome: 'Tovaglioli', zona: 'comune', unita: 'pz', giacenza: 8, punto_riordino: 50 } });

// ---------------------------------------------------------------- filmati (app soci)
async function filmato(nome, passi) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    recordVideo: { dir: VID, size: { width: 390, height: 844 } }
  });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#gate_tess', 'BR-2026-0001');
  await p.click('#gate_enter');
  await p.waitForTimeout(2200);
  await p.click('#onbClose').catch(() => { });
  await p.waitForTimeout(900);
  try { await passi(p); } catch (e) { console.log('  ⚠', nome, e.message.slice(0, 80)); }
  await p.waitForTimeout(1200);
  await ctx.close();
  const files = readdirSync(VID).filter((x) => x.endsWith('.webm') && !x.startsWith('0'));
  const ultimo = files.map((x) => ({ x, t: 0 })).pop();
  if (ultimo) renameSync(join(VID, ultimo.x), join(VID, nome + '.webm'));
  console.log('🎬', nome);
}

const tocca = async (p, sel, attesa = 1500) => { await p.click(sel); await p.waitForTimeout(attesa); };

await filmato('01-prenotare-un-campo', async (p) => {
  await tocca(p, '[data-campi]', 2000);
  await tocca(p, '[data-campo-pick]:nth-of-type(2)', 1500).catch(() => { });
  await p.waitForTimeout(800);
  await tocca(p, '[data-apri]', 2500);
  await p.waitForTimeout(1500);
});

await filmato('02-cena-al-garden', async (p) => {
  await tocca(p, '[data-ordina="garden"]', 2200);
  await tocca(p, '[data-gard-pers="4"]', 1500);
  await tocca(p, '[data-gard-pren]', 2500);
  await p.waitForTimeout(1500);
});

await filmato('03-la-mia-casata', async (p) => {
  await tocca(p, 'nav [data-t="coppa"]', 1800).catch(async () => { await p.evaluate(() => go('coppa')); await p.waitForTimeout(1500); });
  await tocca(p, '[data-casatamembri]', 2000);
  await p.waitForTimeout(1500);
});

await filmato('04-il-programma-della-settimana', async (p) => {
  await tocca(p, 'nav [data-t="eventi"]', 2000);
  await p.mouse.wheel(0, 500);
  await p.waitForTimeout(1500);
  await p.mouse.wheel(0, 500);
  await p.waitForTimeout(1500);
});

await filmato('05-la-guida-e-le-mappe', async (p) => {
  await tocca(p, 'nav [data-t="bussola"]', 2000);
  await p.mouse.wheel(0, 400);
  await p.waitForTimeout(1800);
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(1800);
});

await filmato('06-guida-rapida', async (p) => {
  await tocca(p, '#helpBtn', 2500);
  await p.waitForTimeout(2500);
});

// ---------------------------------------------------------------- schermate
async function scatto(nome, larghezza, azione, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: larghezza, height: mobile ? 844 : 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  try { await azione(p); } catch (e) { console.log('  ⚠', nome, e.message.slice(0, 80)); }
  await p.screenshot({ path: join(IMG, nome + '.png'), fullPage: true });
  await ctx.close();
  console.log('📸', nome);
}

const entraSocio = async (p) => {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#gate_tess', 'BR-2026-0001'); await p.click('#gate_enter'); await p.waitForTimeout(2200);
  await p.click('#onbClose').catch(() => { }); await p.waitForTimeout(800);
};
const entraCrew = async (p) => {
  await p.goto(BASE + '/chiosco/', { waitUntil: 'networkidle' });
  await p.fill('#u', 'gestore'); await p.fill('#p', 'bussola2026'); await p.click('#loginBtn'); await p.waitForTimeout(2000);
};
const entraAdmin = async (p) => {
  await p.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await p.fill('#u', 'gestore'); await p.fill('#p', 'bussola2026'); await p.click('#loginBtn'); await p.waitForTimeout(2000);
};

// app soci
await scatto('socio-accesso', 390, async (p) => { await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200); }, true);
await scatto('socio-home', 390, entraSocio, true);
await scatto('socio-guida-rapida', 390, async (p) => { await entraSocio(p); await p.click('#helpBtn'); await p.waitForTimeout(1200); }, true);
await scatto('socio-campi', 390, async (p) => { await entraSocio(p); await p.click('[data-campi]'); await p.waitForTimeout(2000); }, true);
await scatto('socio-garden', 390, async (p) => { await entraSocio(p); await p.click('[data-ordina="garden"]'); await p.waitForTimeout(2000); }, true);
await scatto('socio-eventi', 390, async (p) => { await entraSocio(p); await p.click('nav [data-t="eventi"]'); await p.waitForTimeout(1500); }, true);
await scatto('socio-coppa', 390, async (p) => { await entraSocio(p); await p.evaluate(() => go('coppa')); await p.waitForTimeout(1500); }, true);
await scatto('socio-guida', 390, async (p) => { await entraSocio(p); await p.click('nav [data-t="bussola"]'); await p.waitForTimeout(1500); }, true);

// Crew
await scatto('crew-accesso', 430, async (p) => { await p.goto(BASE + '/chiosco/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000); }, true);
await scatto('crew-comande', 430, entraCrew, true);
await scatto('crew-pianta', 430, async (p) => { await entraCrew(p); await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(2200); }, true);
await scatto('crew-campi', 430, async (p) => { await entraCrew(p); await p.selectOption('#zonaSwitch', 'campi'); await p.waitForTimeout(2000); }, true);
await scatto('crew-fitness', 430, async (p) => { await entraCrew(p); await p.selectOption('#zonaSwitch', 'fitness'); await p.waitForTimeout(2000); }, true);
await scatto('crew-magazzino', 430, async (p) => { await entraCrew(p); await p.selectOption('#zonaSwitch', 'magazzino'); await p.waitForTimeout(2000); }, true);
await scatto('crew-carta', 430, async (p) => { await entraCrew(p); await p.selectOption('#zonaSwitch', 'cdc'); await p.waitForTimeout(2000); }, true);
await scatto('crew-stage', 430, async (p) => { await entraCrew(p); await p.selectOption('#zonaSwitch', 'cinema'); await p.waitForTimeout(2000); }, true);
await scatto('crew-sport', 430, async (p) => { await entraCrew(p); await p.selectOption('#zonaSwitch', 'sport'); await p.waitForTimeout(2000); }, true);

// back office
await scatto('admin-cruscotto', 1280, entraAdmin);
await scatto('admin-parametri', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="parametri"]'); await p.waitForTimeout(1500); });
await scatto('admin-campi', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="campi"]'); await p.waitForTimeout(1500); });
await scatto('admin-fitness', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="fitness"]'); await p.waitForTimeout(1800); });
await scatto('admin-cinema', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="cinema"]'); await p.waitForTimeout(1800); });
await scatto('admin-casate', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="casate"]'); await p.waitForTimeout(2000); });
await scatto('admin-operatori', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="operatori"]'); await p.waitForTimeout(1500); });
await scatto('admin-eventi', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="eventi"]'); await p.waitForTimeout(1500); });
await scatto('admin-guida', 1280, async (p) => { await entraAdmin(p); await p.click('button[data-v="bussola"]'); await p.waitForTimeout(1500); });

await browser.close();
console.log('fatto');

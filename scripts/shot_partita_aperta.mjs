// UN CASO VERO, FOTOGRAFATO PASSO PER PASSO.
//
// Marco apre una partita di calcetto ai soci, Giulia si unisce, il numero legale non si
// raggiunge e il campo torna libero. Ogni schermata è quella vera dell'app, non un disegno.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const base = process.env.BASE || 'http://127.0.0.1:9400';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
const call = async (p, o = {}) => (await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined })).json();

const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } });

// Due soci con un nome riconoscibile: nelle schermate si deve capire chi è chi.
const fai = async (nome, cognome) => await call('/api/admin/soci', { method: 'POST', token, body: { nome, cognome, email: `${nome.toLowerCase()}@sim.test`, data_nascita: '1990-05-12', tipo_profilo: 'socio' } });
const marco = await fai('Marco', 'Rizzo');
const giulia = await fai('Giulia', 'Corso');
const laura = await fai('Laura', 'Bruno');

// Il campo di calcetto: minimo 6 giocatori, così il numero legale si vede lavorare.
const campi = await call('/api/campi');
const calcetto = campi.find((c) => /calcetto|calcio/i.test(c.nome + ' ' + c.sport)) || campi[0];
await call(`/api/admin/campi/${calcetto.id}`, { method: 'PUT', token, body: { ...calcetto, min_giocatori: 6, posti_default: 10 } });
// Il numero legale acceso, con mezz'ora di margine.
await call('/api/admin/parametri', { method: 'PUT', token, body: { campi_numero_legale: true, campi_numero_legale_minuti: 30 } });

const oggi = new Date().toISOString().slice(0, 10);
// Prenotare chiede conferma: senza accettarla, il browser di prova annulla e non succede
// niente. E' la stessa domanda che vede il socio.
const accettaLeDomande = (p) => p.on('dialog', (d) => d.accept());

const entra = async (p, tessera) => {
  await p.goto(base + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.fill('#gate_tess', tessera);
  await p.click('#gate_enter');
  await p.waitForTimeout(2200);
  await p.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /Ho capito/i.test(e.textContent || '')); if (x) x.click(); });
  await p.waitForTimeout(600);
};
const apriCampi = async (p, campoId) => {
  await p.evaluate(() => { const t = document.querySelector('[data-campi]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await p.waitForTimeout(1800);
  // La schermata si apre sul primo campo: si sceglie quello del calcetto, dove il numero
  // legale conta davvero (sei giocatori, non due).
  if (campoId) {
    await p.evaluate((id) => { const t = document.querySelector(`[data-campo-pick="${id}"]`); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, campoId);
    await p.waitForTimeout(1500);
  }
};

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const vista = { viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 };

// ---- 1. Marco sceglie la fascia: Solo io oppure Apri ai soci ----
const pm = await b.newPage(vista);
accettaLeDomande(pm);
await entra(pm, marco.tessera_code);
await apriCampi(pm, calcetto.id);
await pm.screenshot({ path: '/tmp/g1-scelta.png' });

// ---- 2. Marco apre la partita ai soci ----
const slot = '18:00';
await pm.evaluate((s) => { const t = document.querySelector(`[data-apri$="|${s}"]`); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, slot);
await pm.waitForTimeout(1500);
await pm.screenshot({ path: '/tmp/g2-conferma.png' });

// ---- 3. Giulia vede la partita aperta e si unisce ----
const pg = await b.newPage(vista);
accettaLeDomande(pg);
await entra(pg, giulia.tessera_code);
await pg.evaluate(() => { const t = document.querySelector('[data-partite]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await pg.waitForTimeout(1800);
await pg.screenshot({ path: '/tmp/g3-partite-aperte.png' });
await pg.evaluate(() => { const t = document.querySelector('[data-unisci]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await pg.waitForTimeout(1600);
await pg.screenshot({ path: '/tmp/g4-unito.png' });

// Anche Laura si unisce, così il conteggio si muove.
const pl = await b.newPage(vista);
accettaLeDomande(pl);
await entra(pl, laura.tessera_code);
await pl.evaluate(() => { const t = document.querySelector('[data-partite]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await pl.waitForTimeout(1500);
await pl.evaluate(() => { const t = document.querySelector('[data-unisci]'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await pl.waitForTimeout(1500);

// ---- 4. Lo stato del numero legale, come lo vede chi guarda le fasce ----
await apriCampi(pm, calcetto.id);
await pm.screenshot({ path: '/tmp/g5-numero-legale.png' });

// ---- 5. Il Crew: chi ha prenotato e chi si è dichiarato ----
const pc = await b.newPage({ viewport: { width: 1150, height: 700 }, deviceScaleFactor: 2 });
await pc.goto(base + '/chiosco/', { waitUntil: 'networkidle' });
await pc.fill('#u', 'gestore'); await pc.fill('#p', 'sim'); await pc.click('#loginBtn');
await pc.waitForTimeout(2000);
await pc.selectOption('#zonaSwitch', 'campi').catch(() => {});
await pc.waitForTimeout(2200);
await pc.screenshot({ path: '/tmp/g6-crew-campi.png' });

const stato = await call(`/api/campi/${calcetto.id}/disponibilita?data=${oggi}`);
const s18 = (stato.slots || []).find((x) => x.slot === slot);
console.log('stato della fascia 18:00 →', JSON.stringify(s18));
await b.close();
console.log('ok');

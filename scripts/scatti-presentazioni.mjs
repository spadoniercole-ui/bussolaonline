// Materiale visivo per le presentazioni: schermate della versione corrente, con dati di scena
// credibili. Niente schermate vuote: una presentazione con liste vuote non convince nessuno.
import { chromium } from 'playwright-core';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:9700';
const OUT = '/tmp/pres/img';
const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
rmSync('/tmp/pres', { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const call = async (p, o = {}) => (await fetch(BASE + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
  body: o.body ? JSON.stringify(o.body) : undefined
})).json();

const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const tk = (await call('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'demo2026' } })).token;
const oggi = new Date().toISOString().slice(0, 10);
const domani = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const soci = await call('/api/admin/soci', { token: tk });
const y = new Date().getFullYear();

// ---- scena
await call('/api/admin/parametri', { method: 'PUT', token: tk, body: { aiuto_numero: '0931 123456' } });
const nonna = await call('/api/admin/soci', { method: 'POST', token: tk, body: { nome: 'Rosaria', cognome: 'Spadaro', data_nascita: `${y - 83}-04-18`, casata_id: soci[0].casata_id, consenso_privacy: true } });
await call('/api/admin/soci/' + nonna.id, { method: 'PUT', token: tk, body: { nome: 'Rosaria', cognome: 'Spadaro', data_nascita: `${y - 83}-04-18`, casata_id: soci[0].casata_id, tipo_profilo: 'socio', ruolo: 'socio', consenso_privacy: true, attivo: 1, emergenza_nome: 'Giulia (figlia)', emergenza_tel: '333 1234567' } });
const ragazzo = await call('/api/admin/soci', { method: 'POST', token: tk, body: { nome: 'Elia', cognome: 'Rizzo', data_nascita: `${y - 12}-07-11`, casata_id: soci[1].casata_id, consenso_privacy: true } });

const f = await call('/api/admin/film', { method: 'POST', token: tk, body: { titolo: 'Nuovo Cinema Paradiso', regia: 'Giuseppe Tornatore', anno: 1988, durata_min: 155, genere: 'drammatico' } });
await call('/api/admin/proiezioni', { method: 'POST', token: tk, body: { film_id: f.id, data: oggi, ora: '21:30' } });
const lun = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const piu = (i, g) => new Date(new Date(i + 'T12:00:00Z').getTime() + g * 864e5).toISOString().slice(0, 10);
await call('/api/admin/fitness/corsi', { method: 'POST', token: tk, body: { nome: 'Pilates', istruttore: 'Anna Rizzo', data_inizio: lun, data_fine: piu(lun, 13), giorni: [1, 3, 5], ora: '18:00', durata_min: 50, posti_max: 20, min_iscritti: 10, prezzo: 12 } });
await call('/api/admin/fitness/corsi', { method: 'POST', token: tk, body: { nome: 'Yoga all’alba', istruttore: 'Marco Li Volsi', data_inizio: lun, data_fine: piu(lun, 13), giorni: [2, 4, 6], ora: '07:00', durata_min: 60, posti_max: 15, min_iscritti: 10, prezzo: 15 } });

// cene, comande, campi
for (const [t, turno, n] of [['BR-2026-0001', '20:00', 4], ['BR-2026-0002', '20:00', 2], ['BR-2026-0003', '21:30', 6]]) {
  await call('/api/garden/prenota', { method: 'POST', body: { tessera_code: t, data: oggi, turno, persone: n } });
}
const menu = await call('/api/menu?zona=garden');
await call('/api/self-order', { method: 'POST', body: { punto: 'Bussola Garden', tavolo: '3', righe: [{ menu_id: menu[0].id, qta: 2 }, { menu_id: menu[1].id, qta: 1 }] } });
const campi = await call('/api/campi');
for (const c of campi.slice(0, 3)) {
  const d = await call(`/api/campi/${c.id}/disponibilita?data=${oggi}`);
  const lib = (d.slots || []).filter((s) => s.stato === 'libero');
  if (lib[0]) {
    const r = await call(`/api/campi/${c.id}/partita`, { method: 'POST', body: { tessera_code: 'BR-2026-0004', data: oggi, slot: lib[0].slot } });
    if (r.partita_id) for (const t of ['BR-2026-0005', 'BR-2026-0006']) await call(`/api/partite-aperte/${r.partita_id}/unisciti`, { method: 'POST', body: { tessera_code: t } });
  }
}
await call('/api/carta/prenota', { method: 'POST', body: { tessera_code: 'BR-2026-0007', data: oggi, turno: '16:00', persone: 3 } });
// magazzino sotto scorta e una richiesta di aiuto chiusa
await call('/api/admin/magazzino', { method: 'POST', token: tk, body: { nome: 'Tovaglioli', zona: 'comune', unita: 'pz', giacenza: 8, punto_riordino: 50 } });

const scatta = async (nome, w, azione, mobile = true, h = 900) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  try { await azione(p); } catch (e) { console.log('  ⚠', nome, String(e.message).slice(0, 70)); }
  await p.screenshot({ path: join(OUT, nome + '.png'), fullPage: !mobile });
  await ctx.close();
  console.log('📸', nome);
};
const socio = (tessera) => async (p) => {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#gate_tess', tessera); await p.click('#gate_enter'); await p.waitForTimeout(2400);
  await p.click('#onbClose').catch(() => { }); await p.waitForTimeout(700);
};
const crew = async (p) => {
  await p.goto(BASE + '/chiosco/', { waitUntil: 'networkidle' });
  await p.fill('#u', 'gestore'); await p.fill('#p', 'demo2026'); await p.click('#loginBtn'); await p.waitForTimeout(1900);
};
const admin = async (p) => {
  await p.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await p.fill('#u', 'gestore'); await p.fill('#p', 'demo2026'); await p.click('#loginBtn'); await p.waitForTimeout(1900);
};

// ---------------- SOCI
await scatta('soci-home', 390, socio('BR-2026-0001'));
await scatta('soci-campi', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('[data-campi]'); await p.waitForTimeout(1900); });
await scatta('soci-garden', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('[data-ordina="garden"]'); await p.waitForTimeout(1900); });
await scatta('soci-serate', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('[data-serate-tutte]'); await p.waitForTimeout(1600); });
await scatta('soci-stage', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('[data-stage]'); await p.waitForTimeout(1800); });
await scatta('soci-fitness', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('[data-fitness]'); await p.waitForTimeout(1800); });
await scatta('soci-coppa', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('.tab[data-t="coppa"]').catch(async () => { await p.click('.tab[data-t="sport"]'); }); await p.waitForTimeout(1500); });
await scatta('soci-guida', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('.tab[data-t="bussola"]'); await p.waitForTimeout(1500); });
await scatta('soci-eventi', 390, async (p) => { await socio('BR-2026-0001')(p); await p.click('.tab[data-t="eventi"]'); await p.waitForTimeout(1400); });
await scatta('soci-semplice', 390, socio(nonna.tessera_code));
await scatta('soci-aiuto', 390, async (p) => { await socio(nonna.tessera_code)(p); await p.click('[data-aiuto]'); await p.waitForTimeout(1400); });
await scatta('soci-ragazzi', 390, socio(ragazzo.tessera_code));

// ---------------- CREW
await scatta('crew-pianta', 430, async (p) => { await crew(p); await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(2200); });
await scatta('crew-tavolo', 430, async (p) => {
  await crew(p); await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(2200);
  const st = await call(`/api/admin/tavoli/turno?data=${oggi}&ambiente=garden&turno=20:00`, { token: tk });
  const n = (st.prenotazioni[0] || {}).tavoli[0];
  await p.click(`[data-pren="${n}"]`); await p.waitForTimeout(900);
});
await scatta('crew-ordina', 430, async (p) => {
  await crew(p); await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(2200);
  const st = await call(`/api/admin/tavoli/turno?data=${oggi}&ambiente=garden&turno=20:00`, { token: tk });
  const n = (st.prenotazioni[0] || {}).tavoli[0];
  await p.click(`[data-pren="${n}"]`); await p.waitForTimeout(800);
  await p.click('#tv_ordina'); await p.waitForTimeout(1500);
});
await scatta('crew-comande', 430, crew);
await scatta('crew-campi', 430, async (p) => { await crew(p); await p.selectOption('#zonaSwitch', 'campi'); await p.waitForTimeout(1900); });
await scatta('crew-fitness', 430, async (p) => { await crew(p); await p.selectOption('#zonaSwitch', 'fitness'); await p.waitForTimeout(1900); });
await scatta('crew-magazzino', 430, async (p) => { await crew(p); await p.selectOption('#zonaSwitch', 'magazzino'); await p.waitForTimeout(1900); });
await scatta('crew-carta', 430, async (p) => { await crew(p); await p.selectOption('#zonaSwitch', 'cdc'); await p.waitForTimeout(1900); });
await scatta('crew-stage', 430, async (p) => { await crew(p); await p.selectOption('#zonaSwitch', 'cinema'); await p.waitForTimeout(1500); await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(2200); });

// ---------------- BACK OFFICE
await scatta('bo-cruscotto', 1280, admin, false, 1000);
await scatta('bo-parametri', 1280, async (p) => { await admin(p); await p.click('button[data-v="parametri"]'); await p.waitForTimeout(1500); }, false, 1000);
await scatta('bo-casate', 1280, async (p) => { await admin(p); await p.click('button[data-v="casate"]'); await p.waitForTimeout(1900); }, false, 1000);
await scatta('bo-campi', 1280, async (p) => { await admin(p); await p.click('button[data-v="campi"]'); await p.waitForTimeout(1500); }, false, 1000);
await scatta('bo-fitness', 1280, async (p) => { await admin(p); await p.click('button[data-v="fitness"]'); await p.waitForTimeout(1800); }, false, 1000);
await scatta('bo-sala', 1280, async (p) => { await admin(p); await p.click('button[data-v="sala"]'); await p.waitForTimeout(1500); }, false, 1000);
await scatta('bo-operatori', 1280, async (p) => { await admin(p); await p.click('button[data-v="operatori"]'); await p.waitForTimeout(1500); }, false, 1000);

await b.close();
console.log('fatto');

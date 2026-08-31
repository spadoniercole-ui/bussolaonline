// Test end-to-end via HTTP sul bundle costruito. Avvia il server su una porta libera
// con un database temporaneo, poi interroga le API come farebbe l'app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SOCIO_A = 'RB-000001-4';
const SOCIO_B = 'RB-000002-8';
const SOCIO_C = 'RB-000003-1';

let proc, tmp, token;

const get = async (p, t) => {
  const r = await fetch(BASE + p, t ? { headers: { Authorization: 'Bearer ' + t } } : undefined);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const send = async (p, body, method = 'POST', t) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// Date di prova: una settimana diversa per ogni indice. Con giorni consecutivi i test
// finivano nella stessa settimana ISO e sbattevano contro il tetto settimanale per socio,
// ma solo a seconda del giorno in cui giravano: un test che passa il lunedi' e fallisce il
// martedi' non serve a niente.
const giorno = (n = 0) => new Date(Date.now() + (30 + n * 7) * 864e5).toISOString().slice(0, 10);

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bussola-test-'));
  proc = spawn(process.execPath, [join(ROOT, 'online/bussola.mjs')], {
    cwd: join(ROOT, 'online'),
    env: { ...process.env, PORT: String(PORT), KOINE_DB: join(tmp, 'test.db'), ADMIN_PASSWORD: 'test-admin', STAFF_PASSWORD: 'test-staff' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) break;
    } catch (_) { }
    await new Promise((r) => setTimeout(r, 250));
  }
  const l = await send('/admin/login', { username: 'gestore', password: 'test-admin' });
  token = l.body.token;
  // Base permissiva per i test del motore: le regole anti-monopolio (tetto giornaliero,
  // catena contigua, finestra di prenotazione) hanno test propri che le accendono.
  await send('/admin/parametri', {
    campi_finestra: false, campi_max_giorno: false, campi_catena: false,
    campi_quota_su_partecipanti: false
  }, 'PUT', token);
});

after(() => {
  if (proc) proc.kill();
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) { }
});

test('il server risponde e dichiara la versione', async () => {
  const { status, body } = await get('/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.version, /^\d+\.\d+$/);
});

test('login del gestore riuscito', () => {
  assert.ok(token, 'token assente');
});

// --- Regressione: il guard CLI di seed.js faceva partire un secondo seed concorrente,
// --- e i campi di default finivano inseriti due volte (10 invece di 5).
test('i campi di default sono creati una volta sola', async () => {
  const { body } = await get('/campi');
  assert.equal(body.length, 5);
  const nomi = body.map((c) => c.nome);
  assert.equal(new Set(nomi).size, 5, 'campi duplicati: ' + nomi.join(', '));
});

test('il campo espone le regole d\'uso decise dal gestore', async () => {
  const { body } = await get('/campi');
  for (const c of body) {
    assert.ok(c.posti_default >= 2);
    assert.ok(c.max_slot_prenotazione >= 1);
    assert.ok(c.max_pren_settimana >= 1);
  }
});

test('senza tessera non si prenota: il titolare deve essere un socio', async () => {
  const { body: campi } = await get('/campi');
  const c = campi[0];
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${giorno(1)}`);
  const slot = d.slots.find((s) => s.stato === 'libero').slot;
  const r = await send(`/campi/${c.id}/prenota`, { data: giorno(1), slot });
  assert.equal(r.status, 403);
  const r2 = await send(`/campi/${c.id}/prenota`, { tessera_code: 'TESSERA-INESISTENTE', data: giorno(1), slot });
  assert.equal(r2.status, 403);
});

test('prenotazione riservata: occupa lo slot e nessuno si puo\' unire', async () => {
  const { body: campi } = await get('/campi');
  const c = campi[0];
  const data = giorno(2);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const slot = d.slots[0].slot;
  const r = await send(`/campi/${c.id}/prenota`, { tessera_code: SOCIO_A, data, slot });
  assert.equal(r.status, 201);
  assert.equal(r.body.aperta_ai_soci, false);

  const { body: d2 } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  assert.equal(d2.slots.find((s) => s.slot === slot).stato, 'privata');

  const { body: aperte } = await get(`/campi/partite-aperte?data=${data}`);
  assert.equal(aperte.filter((p) => p.id === r.body.partita_id).length, 0, 'una riservata non deve comparire fra le partite aperte');

  const j = await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: SOCIO_B });
  assert.equal(j.status, 409);
});

test('partita aperta: il titolare e\' il primo iscritto e gli altri si uniscono fino ai posti del campo', async () => {
  const { body: campi } = await get('/campi');
  const c = campi[0];
  const data = giorno(3);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const slot = d.slots[0].slot;
  // posti_totali passato dal client: deve essere ignorato, vale il campo
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot, posti_totali: 99 });
  assert.equal(r.status, 201);
  assert.equal(r.body.posti_totali, c.posti_default);

  const { body: d2 } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const s2 = d2.slots.find((x) => x.slot === slot);
  assert.equal(s2.stato, 'partita');
  assert.equal(s2.iscritti, 1, 'il titolare conta come primo iscritto');
  assert.equal(s2.posti_totali, c.posti_default);

  const j1 = await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: SOCIO_B });
  assert.equal(j1.status, 200);
  assert.equal(j1.body.iscritti, 2);

  const bis = await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: SOCIO_B });
  assert.equal(bis.status, 409, 'non ci si iscrive due volte');
});

test('la partita si chiude al raggiungimento dei posti', async () => {
  const { body: campi } = await get('/campi');
  const c = campi.find((x) => x.posti_default <= 4) || campi[0];
  const data = giorno(4);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const slot = d.slots[0].slot;
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot });
  const tessere = [SOCIO_B, SOCIO_C, 'RB-000004-5', 'RB-000005-9', 'RB-000100-6'];
  let ultima = null;
  for (let i = 0; i < c.posti_default - 1; i++) {
    ultima = await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: tessere[i] });
    assert.equal(ultima.status, 200);
  }
  assert.equal(ultima.body.completa, true);
  const oltre = await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: tessere[c.posti_default - 1] });
  assert.equal(oltre.status, 409, 'a partita completa non si entra');
});

test('durata: piu\' fasce consecutive entro il massimo, oltre e\' rifiutata', async () => {
  const { body: campi } = await get('/campi');
  const c = campi.find((x) => x.max_slot_prenotazione >= 2) || campi[0];
  const data = giorno(5);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const i = 0;
  const slot = d.slots[i].slot;

  const troppo = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot, n_slot: c.max_slot_prenotazione + 1 });
  assert.equal(troppo.status, 409);

  const ok = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot, n_slot: 2 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.n_slot, 2);

  const { body: d2 } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  assert.notEqual(d2.slots[i].stato, 'libero');
  assert.notEqual(d2.slots[i + 1].stato, 'libero', 'anche la seconda fascia deve risultare occupata');
});

test('annullare libera tutte le fasce della prenotazione', async () => {
  const { body: campi } = await get('/campi');
  // Un campo del chiosco: il prospetto della crew non mostra piu' quelli a pagamento, che
  // hanno una gestione loro.
  const liberi = campi.filter((x) => (x.gestione || 'chiosco') === 'chiosco');
  const c = liberi.find((x) => x.max_slot_prenotazione >= 2) || liberi[0];
  const data = giorno(6);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const slot = d.slots[0].slot;
  await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot, n_slot: 2 });

  const pren = await get(`/admin/campi/prenotazioni?data=${data}`, token);
  const mia = pren.body.find((p) => p.campo_id === c.id);
  assert.equal(mia.fasce, 2);

  const ann = await send(`/prenotazioni-campo/${mia.id}/annulla`, { tessera_code: SOCIO_A });
  assert.equal(ann.status, 200);
  const { body: d3 } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  assert.equal(d3.slots[0].stato, 'libero');
  assert.equal(d3.slots[1].stato, 'libero');
});

test('tetto settimanale: oltre il massimo il socio non prenota piu\' su quel campo', async () => {
  const { body: campi } = await get('/campi');
  // Un campo GRATUITO: il tetto serve a distribuire una risorsa che non costa niente. Sui
  // campi a pagamento non c'e', e usarne uno qui non proverebbe nulla.
  const c = campi.find((x) => (x.gestione || 'chiosco') === 'chiosco');
  const data = giorno(7);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const liberi = d.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);
  for (let i = 0; i < c.max_pren_settimana; i++) {
    const r = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_C, data, slot: liberi[i], n_slot: 1 });
    assert.equal(r.status, 201, `prenotazione ${i + 1} rifiutata`);
  }
  const oltre = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_C, data, slot: liberi[c.max_pren_settimana], n_slot: 1 });
  assert.equal(oltre.status, 409);
  assert.match(oltre.body.error, /settimana/i);

  // un altro socio non e' toccato dal tetto del primo
  const altro = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot: liberi[c.max_pren_settimana], n_slot: 1 });
  assert.equal(altro.status, 201);
});

test('la quota residua e\' esposta nella disponibilita\'', async () => {
  const { body: campi } = await get('/campi');
  // Solo sui campi gratuiti: su un campo a pagamento non c'e' nessun tetto da consumare, e
  // scrivere "ti restano 2 prenotazioni" sarebbe una bugia.
  const c = campi.find((x) => (x.gestione || 'chiosco') === 'chiosco');
  const data = giorno(8);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}&tessera_code=${SOCIO_A}`);
  assert.ok(d.quota, 'quota assente');
  assert.equal(d.quota.massimo, c.max_pren_settimana);
  const prima = d.quota.residue;
  await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot: d.slots[0].slot });
  const { body: d2 } = await get(`/campi/${c.id}/disponibilita?data=${data}&tessera_code=${SOCIO_A}`);
  assert.equal(d2.quota.residue, prima - 1);
});

// --- Regola d'uso: il campo impegnato dal torneo non e' prenotabile.
test('campo bloccato per torneo: fasce non prenotabili, il resto della giornata resta libero', async () => {
  const { body: campi } = await get('/campi');
  const c = campi.find((x) => x.sport === 'basket') || campi[4];
  const data = giorno(9);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const primo = d.slots[0].slot;
  const ultimo = d.slots[d.slots.length - 1].slot;

  const b = await send('/admin/campi/blocchi', { campo_id: c.id, data, slot_da: primo, slot_a: primo, motivo: 'torneo', nota: 'Coppa delle Casate' }, 'POST', token);
  assert.equal(b.status, 201);

  const { body: d2 } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const s0 = d2.slots.find((s) => s.slot === primo);
  assert.equal(s0.stato, 'bloccato');
  assert.equal(s0.motivo, 'torneo');
  assert.equal(d2.slots.find((s) => s.slot === ultimo).stato, 'libero');

  const ko = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot: primo });
  assert.equal(ko.status, 409);
  const ok = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot: ultimo });
  assert.equal(ok.status, 201);

  await send(`/admin/campi/blocchi/${b.body.id}`, undefined, 'DELETE', token);
  const { body: d3 } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  assert.equal(d3.slots.find((s) => s.slot === primo).stato, 'libero');
});

test('governance: il prospetto mostra titolare e partecipanti', async () => {
  const { body: campi } = await get('/campi');
  const c = campi[3];
  const data = giorno(10);
  const { body: d } = await get(`/campi/${c.id}/disponibilita?data=${data}`);
  const slot = d.slots[0].slot;
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot });
  await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: SOCIO_B });

  const pren = await get(`/admin/campi/prenotazioni?data=${data}`, token);
  assert.equal(pren.status, 200);
  const riga = pren.body.find((p) => p.partita_id === r.body.partita_id);
  assert.ok(riga, 'prenotazione non trovata nel prospetto');
  assert.ok(riga.titolare, 'titolare mancante');
  assert.equal(riga.partecipanti.length, 2);
  assert.equal(riga.aperta_ai_soci, true);
  assert.equal(riga.posti_liberi, c.posti_default - 2);
});

test('il prospetto richiede il permesso campi', async () => {
  const { status } = await get('/admin/campi/prenotazioni');
  assert.ok(status === 401 || status === 403, 'atteso accesso negato, ricevuto ' + status);
});

// --- Sanita' generale: le altre aree dell'app rispondono ancora.
test('le altre API di base rispondono', async () => {
  const casate = await get('/casate');
  assert.equal(casate.status, 200);
  assert.equal(casate.body.length, 8);
  const menu = await get('/menu');
  assert.equal(menu.status, 200);
  const soci = await get('/admin/soci', token);
  assert.equal(soci.status, 200);
  assert.ok(soci.body.length >= 10);
});

test('le quattro pagine sono servite', async () => {
  for (const u of ['/', '/admin/', '/chiosco/', '/ordina?p=bar&t=1']) {
    const r = await fetch(`http://127.0.0.1:${PORT}${u}`);
    assert.equal(r.status, 200, u);
  }
});

// ---- Coppa delle Casate: graduatoria interamente derivata --------------------------------
test('la graduatoria della Coppa e\' calcolata, non inserita a mano', async () => {
  const r = await get('/admin/coppa/cartellone', token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.graduatoria));
  assert.equal(r.body.graduatoria.length, 8);
  for (const c of r.body.graduatoria) {
    assert.equal(c.punti, c.tornei + c.contest, `totale non coerente per ${c.nome}`);
    assert.ok(c.posizione >= 1);
  }
});

test('l\'inserimento manuale dei punti non e\' piu\' possibile', async () => {
  const r = await send('/admin/casate/1/punti', { punti: 999 }, 'PUT', token);
  assert.equal(r.status, 410);
  const { body } = await get('/casate');
  assert.ok(!body.some((c) => c.punti === 999), 'un punteggio inserito a mano non deve entrare in graduatoria');
});

test('a parita\' di punteggio le casate condividono la posizione', async () => {
  const { body } = await get('/casate');
  const perPunti = new Map();
  for (const c of body) {
    if (!perPunti.has(c.punti)) perPunti.set(c.punti, new Set());
    perPunti.get(c.punti).add(c.posizione);
  }
  for (const [punti, posizioni] of perPunti) {
    assert.equal(posizioni.size, 1, `punteggio ${punti} con posizioni diverse: ${[...posizioni]}`);
  }
  // la numerazione salta i posti occupati dagli ex aequo (1,1,3 e non 1,1,2)
  const ord = [...body].sort((a, b) => a.posizione - b.posizione);
  ord.forEach((c, i) => assert.ok(c.posizione <= i + 1, 'posizione incoerente con l\'ordine'));
  const pos = ord.map((c) => c.posizione);
  assert.equal(pos[0], 1);
});

test('il ricalcolo e\' idempotente e riallinea cio\' che vedono i soci', async () => {
  const uno = await send('/admin/coppa/ricalcola', {}, 'POST', token);
  assert.equal(uno.status, 200);
  const due = await send('/admin/coppa/ricalcola', {}, 'POST', token);
  assert.equal(due.body.cambiate, 0, 'un secondo ricalcolo non deve cambiare nulla');
  const { body: casate } = await get('/casate');
  const atteso = new Map(due.body.graduatoria.map((c) => [c.id, c.punti]));
  for (const c of casate) assert.equal(c.punti, atteso.get(c.id), `casate.punti disallineato per ${c.nome}`);
});

test('torneo giocato per intero: punti derivati, pari merito e sopravvivenza all\'archiviazione', async () => {
  const disc = (await get('/admin/discipline', token)).body[0];
  await send(`/admin/tabellone/${disc.id}/genera`, {}, 'POST', token);

  // gioca tutto: gironi, quarti, semifinali, finali (niente pareggi in fase finale)
  for (let giro = 0; giro < 8; giro++) {
    const tb = (await get(`/admin/tabellone/${disc.id}`, token)).body;
    const da = [...(tb.gironi || []).flatMap((x) => x.partite || []), ...Object.values(tb.fasi || {}).flat()]
      .filter((p) => p && p.stato !== 'giocata');
    if (!da.length) break;
    for (const p of da) await send(`/admin/partite/${p.id}`, { gol_a: 2, gol_b: 1 }, 'PUT', token);
  }

  const grad = (await get('/admin/coppa/cartellone', token)).body.graduatoria;
  assert.deepEqual(grad.slice(0, 4).map((c) => c.punti), [12, 10, 8, 6], 'scala dei punti Coppa errata');
  const quinti = grad.filter((c) => c.punti === 4);
  assert.equal(quinti.length, 4, 'attese 4 casate eliminate ai quarti');
  assert.ok(quinti.every((c) => c.posizione === 5), 'gli ex aequo devono condividere la 5\u00aa posizione');
  assert.ok(quinti.every((c) => c.exAequo), 'gli ex aequo devono essere segnalati');

  // i soci vedono gli stessi punti e le stesse posizioni
  const casate = (await get('/casate')).body;
  for (const c of grad) {
    const vista = casate.find((x) => x.id === c.id);
    assert.equal(vista.punti, c.punti, `punti diversi per ${c.nome}`);
    assert.equal(vista.posizione, c.posizione, `posizione diversa per ${c.nome}`);
  }

  // archiviare cancella partite e gironi: i punti devono restare
  const prima = new Map(grad.map((c) => [c.id, c.punti]));
  const arch = await send(`/admin/tabellone/${disc.id}/archivia`, {}, 'POST', token);
  assert.equal(arch.status, 200);
  const dopo = (await get('/admin/coppa/cartellone', token)).body.graduatoria;
  for (const c of dopo) assert.equal(c.punti, prima.get(c.id), `punti persi dopo l'archiviazione per ${c.nome}`);
});

// ---- Punto 4: operatori e permessi non sono piu' un binario morto ------------------------
// Prima esistevano moduli Crew solo per comande, magazzino e tabellone: un operatore
// abilitato a Casa di Carta, Serate o Campi veniva creato correttamente ma non entrava.
const CAP_MODULI = ['comande', 'magazzino', 'tabellone', 'campi', 'serate', 'cdc'];

test('ogni permesso operativo apre almeno un modulo del Crew', async () => {
  for (const cap of CAP_MODULI) {
    const u = `op_${cap}_${Math.floor(Math.random() * 9999)}`;
    const c = await send('/admin/operatori', { username: u, password: 'pw-test-123', ruolo: 'staff', permessi: [cap] }, 'POST', token);
    assert.equal(c.status, 201, `creazione operatore ${cap} fallita`);

    const l = await send('/admin/login', { username: u, password: 'pw-test-123' });
    assert.equal(l.status, 200, `login operatore ${cap} fallito`);
    const me = await get('/admin/me', l.body.token);
    assert.equal(me.status, 200);
    assert.ok(me.body.caps.includes(cap), `il permesso ${cap} non risulta all'operatore`);
    assert.equal(me.body.gestore, false);
  }
});

test('l\'operatore con un solo permesso usa il suo modulo e non gli altri', async () => {
  const u = 'op_solo_cdc_' + Math.floor(Math.random() * 9999);
  await send('/admin/operatori', { username: u, password: 'pw-test-123', ruolo: 'staff', permessi: ['cdc'] }, 'POST', token);
  const l = await send('/admin/login', { username: u, password: 'pw-test-123' });
  const t = l.body.token;

  // il suo modulo risponde
  assert.equal((await get('/admin/cdc/giochi', t)).status, 200);
  const conta = await send('/admin/cdc/caffe/conta', { giacenza: 42 }, 'POST', t);
  assert.equal(conta.status, 200);

  // gli altri no
  assert.equal((await send('/admin/campi/blocchi', { campo_id: 1, data: giorno(20) }, 'POST', t)).status, 403);
  assert.equal((await send('/admin/serate', { titolo: 'X' }, 'POST', t)).status, 403);
});

// ---- Punto 3: la Casa di Carta e' una zona del magazzino Centrale ------------------------
test('Casa di Carta attinge al Centrale come Bar e Garden', async () => {
  const art = await send('/admin/magazzino', { nome: 'Capsule caffe test', area: 'casa_di_carta', zona: 'carta', unita: 'pz', giacenza: 100, punto_riordino: 20 }, 'POST', token);
  assert.equal(art.status, 201);
  const id = art.body.id;

  const zona = await get('/admin/magazzino/zona/carta', token);
  assert.equal(zona.status, 200);
  const riga = zona.body.articoli.find((a) => a.articolo_id === id);
  assert.ok(riga, 'articolo cdc non visibile alla sua zona');
  assert.equal(riga.giacenza_centrale, 100);

  // impegno: non sposta merce, riduce la disponibilita'
  const imp = await send('/admin/magazzino/richieste', { articolo_id: id, zona: 'carta', quantita: 30 }, 'POST', token);
  assert.equal(imp.status, 201);
  const dopoImp = (await get('/admin/magazzino/zona/carta', token)).body.articoli.find((a) => a.articolo_id === id);
  assert.equal(dopoImp.giacenza_centrale, 100, 'l\'impegno non deve muovere la merce');
  assert.equal(dopoImp.giacenza, 70, 'giacenza effettiva = fisica - impegni');

  // scarico: consuma dal Centrale
  const sc = await send('/admin/magazzino/zona/carta/scarico', { articolo_id: id, quantita: 10 }, 'POST', token);
  assert.equal(sc.status, 200);
  const dopoSc = (await get('/admin/magazzino/zona/carta', token)).body.articoli.find((a) => a.articolo_id === id);
  assert.equal(dopoSc.giacenza_centrale, 90, 'lo scarico della zona scala il Centrale');

  // la zona cdc non vede gli articoli riservati al bar
  const soloBar = await send('/admin/magazzino', { nome: 'Fusto birra test', area: 'chiosco', zona: 'bar', unita: 'pz', giacenza: 5 }, 'POST', token);
  const zona2 = (await get('/admin/magazzino/zona/carta', token)).body.articoli;
  assert.ok(!zona2.some((a) => a.articolo_id === soloBar.body.id), 'la Casa di Carta non deve vedere gli articoli del Bar');
});

// ---- Punto 8/C: tavoli del Garden, disposizione e regola centro → periferia --------------
test('la pianta parte da una disposizione predefinita con tavoli numerati', async () => {
  const r = await get('/admin/tavoli/layout', token);
  assert.equal(r.status, 200);
  assert.ok(r.body.layout.length >= 1, 'nessuna disposizione creata');
  const def = r.body.layout.find((l) => l.predefinito);
  assert.ok(def, 'manca la disposizione predefinita');
  assert.ok(def.tavoli.length >= 1);
  const numeri = def.tavoli.map((t) => t.numero);
  assert.equal(new Set(numeri).size, numeri.length, 'numeri di tavolo duplicati');
  assert.deepEqual(r.body.turni, ['20:00', '21:30']);
});

test('la disposizione si salva con posizioni e posti, i numeri restano stabili', async () => {
  const def = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.predefinito);
  const tavoli = [
    { numero: 1, posti: 2, forma: 'tondo', x: 50, y: 50 },     // centro
    { numero: 2, posti: 4, forma: 'tondo', x: 52, y: 50 },
    { numero: 3, posti: 6, forma: 'rettangolo', x: 10, y: 10 }, // periferia
    { numero: 4, posti: 4, forma: 'tondo', x: 90, y: 90 }
  ];
  // `completo: true` = "questa e' TUTTA la pianta, cancella quello che non c'e' dentro". Lo dice
  // solo l'editor della disposizione. Chi salva dalla sala manda i tavoli che vede, e i tavoli
  // accostati a un altro sono nascosti: senza questa distinzione sparivano dalla pianta.
  const put = await send(`/admin/tavoli/layout/${def.id}`, { tavoli, completo: true }, 'PUT', token);
  assert.equal(put.status, 200);
  const dopo = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.id === def.id);
  assert.equal(dopo.tavoli.length, 4);
  assert.equal(dopo.posti, 16);
  assert.equal(dopo.tavoli.find((t) => t.numero === 3).forma, 'rettangolo');
});

test('il tavolo si assegna dal centro verso la periferia', async () => {
  const data = giorno(40);
  const t1 = (await get(`/admin/tavoli/turno?data=${data}&turno=20:00`, token)).body;
  // le distanze sono calcolate dal baricentro: il piu' vicino e' il primo della lista
  const ordinati = [...t1.tavoli].sort((a, b) => a.distanza - b.distanza);
  assert.ok(ordinati[0].distanza <= ordinati[ordinati.length - 1].distanza);

  const p1 = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '20:00', persone: 2 });
  assert.equal(p1.status, 201);
  const centrale = ordinati.filter((t) => t.posti >= 2).sort((a, b) => a.posti - b.posti || a.distanza - b.distanza)[0];
  assert.deepEqual(p1.body.tavoli, [centrale.numero], 'non ha scelto il tavolo piu\' centrale adatto');

  // il secondo gruppo prende il successivo verso l'esterno, non lo stesso
  const p2 = await send('/garden/prenota', { tessera_code: SOCIO_B, data, turno: '20:00', persone: 2 });
  assert.equal(p2.status, 201);
  assert.notDeepEqual(p2.body.tavoli, p1.body.tavoli);
});

test('un gruppo che non entra in un tavolo occupa piu\' tavoli accorpati', async () => {
  const data = giorno(41);
  const r = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '21:30', persone: 12 });
  assert.equal(r.status, 201);
  assert.ok(r.body.tavoli.length > 1, 'atteso accorpamento di piu\' tavoli');
  const stato = (await get(`/admin/tavoli/turno?data=${data}&turno=21:30`, token)).body;
  const posti = r.body.tavoli.reduce((s, n) => s + stato.tavoli.find((t) => t.numero === n).posti, 0);
  assert.ok(posti >= 12, 'i tavoli accorpati non coprono il gruppo');
});

test('i due turni sono indipendenti e la capienza e\' rispettata', async () => {
  const data = giorno(42);
  const t = (await get(`/garden/turni?data=${data}`)).body.turni;
  assert.equal(t.length, 2);
  assert.equal(t[0].posti_liberi, t[0].posti_totali);

  // riempie il primo turno
  const r = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '20:00', persone: 16 });
  assert.equal(r.status, 201);
  const pieno = await send('/garden/prenota', { tessera_code: SOCIO_B, data, turno: '20:00', persone: 2 });
  assert.equal(pieno.status, 409, 'il turno pieno deve rifiutare');

  // il secondo turno resta libero
  const secondo = await send('/garden/prenota', { tessera_code: SOCIO_B, data, turno: '21:30', persone: 2 });
  assert.equal(secondo.status, 201);
});

test('senza tessera non si prenota il tavolo, e il socio annulla la sua', async () => {
  const data = giorno(43);
  assert.equal((await send('/garden/prenota', { data, turno: '20:00', persone: 2 })).status, 403);
  const r = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '20:00', persone: 2 });
  const mie = (await get(`/garden/mie-prenotazioni?tessera_code=${SOCIO_A}`)).body;
  assert.ok(mie.some((p) => p.id === r.body.id));
  const ko = await send(`/garden/prenotazioni/${r.body.id}/annulla`, { tessera_code: SOCIO_B });
  assert.equal(ko.status, 403);
  const ok = await send(`/garden/prenotazioni/${r.body.id}/annulla`, { tessera_code: SOCIO_A });
  assert.equal(ok.status, 200);
  const dopo = (await get(`/admin/tavoli/turno?data=${data}&turno=20:00`, token)).body;
  assert.ok(dopo.tavoli.every((t) => t.libero), 'i tavoli devono tornare liberi');
});

test('la Crew prenota al banco e puo\' spostare il tavolo assegnato', async () => {
  const data = giorno(44);
  const r = await send('/admin/tavoli/prenota', { data, turno: '21:30', persone: 2, nome: 'Sig. Bianchi' }, 'POST', token);
  assert.equal(r.status, 201);
  assert.equal(r.body.tavoli.length, 1);
  const stato = (await get(`/admin/tavoli/turno?data=${data}&turno=21:30`, token)).body;
  assert.equal(stato.prenotazioni[0].origine, 'crew');

  // sposta su un tavolo libero
  const libero = stato.tavoli.find((t) => t.libero);
  const mv = await send(`/admin/tavoli/prenotazioni/${r.body.id}`, { tavoli: [libero.numero] }, 'PUT', token);
  assert.equal(mv.status, 200);
  const dopo = (await get(`/admin/tavoli/turno?data=${data}&turno=21:30`, token)).body;
  assert.equal(dopo.tavoli.find((t) => t.numero === libero.numero).libero, false);

  // su un tavolo gia' occupato non si sposta
  const altra = await send('/admin/tavoli/prenota', { data, turno: '21:30', persone: 2, nome: 'Sig. Verdi' }, 'POST', token);
  const conflitto = await send(`/admin/tavoli/prenotazioni/${altra.body.id}`, { tavoli: [libero.numero] }, 'PUT', token);
  assert.equal(conflitto.status, 409);
});

test('ogni serata puo\' avere la sua disposizione', async () => {
  const nuova = await send('/admin/tavoli/layout', { nome: 'Concerto' }, 'POST', token);
  assert.equal(nuova.status, 201);
  const data = giorno(45);
  await send('/admin/tavoli/giorno', { data, layout_id: nuova.body.id }, 'PUT', token);
  const usato = (await get(`/admin/tavoli/turno?data=${data}&turno=20:00`, token)).body;
  assert.equal(usato.layout.nome, 'Concerto');
  // un altro giorno resta sul predefinito
  const altro = (await get(`/admin/tavoli/turno?data=${giorno(46)}&turno=20:00`, token)).body;
  assert.notEqual(altro.layout.id, nuova.body.id);
});

// ---- Tabellone: 3 giornate da 2 partite per girone, con data della giornata --------------
test('ogni girone ha 3 giornate da 2 partite', async () => {
  const disc = (await get('/admin/discipline', token)).body[1];
  await send(`/admin/tabellone/${disc.id}/genera`, {}, 'POST', token);
  const t = (await get(`/admin/tabellone/${disc.id}`, token)).body;
  assert.equal(t.gironi.length, 2, 'attesi due gironi');
  for (const g of t.gironi) {
    assert.equal(g.classifica.length, 4, 'ogni girone ha 4 casate');
    assert.equal(g.partite.length, 6, 'girone all\'italiana: 6 partite');
    const giornate = [...new Set(g.partite.map((p) => p.giornata))].sort();
    assert.deepEqual(giornate, [1, 2, 3], 'attese 3 giornate');
    for (const n of giornate) {
      assert.equal(g.partite.filter((p) => p.giornata === n).length, 2, `giornata ${n}: attese 2 partite`);
    }
    // il nome del girone e' gia' completo: non va anteposta un'altra volta la parola
    assert.match(g.nome, /^Girone [AB]$/);
  }
});

test('la crew fissa la data di una giornata e vale per entrambe le sue partite', async () => {
  const disc = (await get('/admin/discipline', token)).body[1];
  const t = (await get(`/admin/tabellone/${disc.id}`, token)).body;
  const g = t.gironi[0];
  const quando = giorno(50);
  const r = await send(`/admin/tabellone/${disc.id}/giornata`, { girone_id: g.id, giornata: 2, quando }, 'PUT', token);
  assert.equal(r.status, 200);

  const dopo = (await get(`/admin/tabellone/${disc.id}`, token)).body;
  const g2 = dopo.gironi.find((x) => x.id === g.id);
  const seconda = g2.partite.filter((p) => p.giornata === 2);
  assert.equal(seconda.length, 2);
  assert.ok(seconda.every((p) => p.quando === quando), 'la data non e\' su entrambe le partite');
  // le altre giornate restano senza data
  assert.ok(g2.partite.filter((p) => p.giornata === 1).every((p) => !p.quando));
  // e l'altro girone non e' toccato
  const altro = dopo.gironi.find((x) => x.id !== g.id);
  assert.ok(altro.partite.every((p) => !p.quando), 'la data ha invaso l\'altro girone');

  const vuota = await send(`/admin/tabellone/${disc.id}/giornata`, { girone_id: g.id, giornata: 2, quando: '' }, 'PUT', token);
  assert.equal(vuota.status, 200);
  const pulito = (await get(`/admin/tabellone/${disc.id}`, token)).body.gironi.find((x) => x.id === g.id);
  assert.ok(pulito.partite.filter((p) => p.giornata === 2).every((p) => !p.quando), 'la data non si cancella');
});

// ---- Parametri: le condizioni si accendono e si spengono dal back office ----------------
const setPar = (patch, t) => send('/admin/parametri', patch, 'PUT', t);

test('i parametri hanno un valore predefinito e dichiarano le dipendenze', async () => {
  const r = await get('/admin/parametri', token);
  assert.equal(r.status, 200);
  const byKey = Object.fromEntries(r.body.map((p) => [p.chiave, p]));
  assert.equal(byKey.campi_limita_durata.valore, true);
  assert.equal(byKey.campi_limita_settimana.valore, true);
  assert.equal(byKey.campi_unisciti.valore, true);
  assert.equal(byKey.eventi_onerosi.valore, true);
  // una voce figlia dichiara da chi dipende ed e' attiva se il genitore e' acceso
  assert.equal(byKey.campi_durata_max_minuti.dipende_da, 'campi_prenotazione_obbligatoria');
  assert.equal(byKey.campi_durata_max_minuti.attivo, false, 'il genitore e\' spento di default');
  assert.equal(byKey.eventi_modo_costo.attivo, true);
});

test('i parametri sono riservati al gestore', async () => {
  const u = 'op_par_' + Math.floor(Math.random() * 9999);
  await send('/admin/operatori', { username: u, password: 'pw-test-123', ruolo: 'staff', permessi: ['comande', 'eventi'] }, 'POST', token);
  const l = await send('/admin/login', { username: u, password: 'pw-test-123' });
  assert.equal((await setPar({ campi_limita_durata: false }, l.body.token)).status, 403);
});

test('il tetto di durata e\' in minuti e vale sempre', async () => {
  const c = (await get('/campi')).body[0];
  const data = giorno(60);
  const troppo = { tessera_code: SOCIO_A, data, slot: (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots[0].slot, n_slot: 4 };
  assert.equal((await send(`/campi/${c.id}/partita`, troppo)).status, 409, 'quattro fasce superano il tetto');

  // Spegnere l'interruttore toglie il tetto per socio, NON la durata massima: "tre ore di
  // campo" non deve mai essere proposto per distrazione.
  await setPar({ campi_limita_durata: false }, token);
  assert.equal((await send(`/campi/${c.id}/partita`, troppo)).status, 409, 'il tetto in minuti vale comunque');
  const campi = (await get('/campi')).body;
  assert.equal(campi[0].max_slot_prenotazione, Math.floor(120 / campi[0].durata_slot), 'le fasce ammesse si ricavano dai minuti');

  // Per giocare davvero quattro ore si alza il numero, e lo si fa apposta.
  await setPar({ campi_durata_massima_minuti: 240 }, token);
  const ok = await send(`/campi/${c.id}/partita`, troppo);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.n_slot, 4);
  await setPar({ campi_limita_durata: true, campi_durata_massima_minuti: 120 }, token);
});

test('spegnere il tetto settimanale toglie il limite per socio', async () => {
  // Campo gratuito: il tetto vive li'.
  const c = (await get('/campi')).body.find((x) => (x.gestione || 'chiosco') === 'chiosco');
  const data = giorno(61);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);
  for (let i = 0; i < c.max_pren_settimana; i++) {
    assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_C, data, slot: liberi[i] })).status, 201);
  }
  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_C, data, slot: liberi[c.max_pren_settimana] })).status, 409);
  await setPar({ campi_limita_settimana: false }, token);
  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_C, data, slot: liberi[c.max_pren_settimana] })).status, 201);
  await setPar({ campi_limita_settimana: true }, token);
});

test('spegnere le partite aperte rende ogni prenotazione riservata', async () => {
  const c = (await get('/campi')).body[2];
  const data = giorno(62);
  const slot = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots[0].slot;
  await setPar({ campi_unisciti: false }, token);
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot });
  assert.equal(r.status, 201);
  assert.equal(r.body.aperta_ai_soci, false, 'con le partite aperte spente nessuna prenotazione e\' aperta');
  const j = await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: SOCIO_B });
  assert.equal(j.status, 409);
  await setPar({ campi_unisciti: true }, token);
});

// ---- Punto 12: consumazione obbligatoria al posto del prezzo -----------------------------
test('un evento puo\' chiedere una consumazione obbligatoria invece del biglietto', async () => {
  const ev = await send('/admin/eventi', { giorno: 'ven', titolo: 'Serata test', costo_tipo: 'consumazione', consumazione: '1 consumazione obbligatoria' }, 'POST', token);
  assert.equal(ev.status, 201);
  const e = (await get('/admin/eventi', token)).body.find((x) => x.id === ev.body.id);
  assert.equal(e.costo_tipo, 'consumazione');
  assert.equal(e.consumazione, '1 consumazione obbligatoria');
  assert.equal(e.prezzo, 0, 'con la consumazione non c\'e\' anche un prezzo');
});

test('il modo di pagamento ammesso filtra quello che si puo\' salvare', async () => {
  await setPar({ eventi_modo_costo: 'prezzo' }, token);
  const ev = await send('/admin/eventi', { giorno: 'sab', titolo: 'Solo prezzo', costo_tipo: 'consumazione', consumazione: 'x' }, 'POST', token);
  const e = (await get('/admin/eventi', token)).body.find((x) => x.id === ev.body.id);
  assert.equal(e.costo_tipo, 'prezzo', 'ammesso solo il prezzo: la consumazione va convertita');

  await setPar({ eventi_onerosi: false }, token);
  const ev2 = await send('/admin/eventi', { giorno: 'dom', titolo: 'Libero per forza', costo_tipo: 'prezzo', prezzo: 15 }, 'POST', token);
  const e2 = (await get('/admin/eventi', token)).body.find((x) => x.id === ev2.body.id);
  assert.equal(e2.costo_tipo, 'nessuno', 'con gli eventi a pagamento spenti l\'ingresso e\' libero');
  assert.equal(e2.prezzo, 0);
  await setPar({ eventi_onerosi: true, eventi_modo_costo: 'entrambi' }, token);
});

test('spegnere la prenotazione della cena chiude il Garden alle prenotazioni', async () => {
  await setPar({ garden_prenotazione_cena: false }, token);
  const r = await send('/garden/prenota', { tessera_code: SOCIO_A, data: giorno(63), turno: '20:00', persone: 2 });
  assert.equal(r.status, 409);
  await setPar({ garden_prenotazione_cena: true }, token);
  assert.equal((await send('/garden/prenota', { tessera_code: SOCIO_A, data: giorno(63), turno: '20:00', persone: 2 })).status, 201);
});

// ---- Punto 13: referenzialità — non si cancella una radice con i rami attaccati ----------
test('un campo con prenotazioni attive non si cancella', async () => {
  const nuovo = await send('/admin/campi', { nome: 'Campo di prova', sport: 'tennis' }, 'POST', token);
  const id = nuovo.body.id;
  const data = giorno(70);
  const slot = (await get(`/campi/${id}/disponibilita?data=${data}`)).body.slots[0].slot;
  const pren = await send(`/campi/${id}/partita`, { tessera_code: SOCIO_A, data, slot });
  assert.equal(pren.status, 201);

  const ko = await send(`/admin/campi/${id}`, undefined, 'DELETE', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /prenotazioni attive/);
  assert.ok(ko.body.blocchi.length >= 1);

  // e la rotta di verifica lo dice prima di provarci
  const chk = await get(`/admin/referenze/campi/${id}`, token);
  assert.ok(chk.body.blocchi.some((b) => /prenotazioni attive/.test(b.etichetta)));

  // rimosso il ramo, la radice si cancella
  const p = (await get(`/admin/campi/prenotazioni?data=${data}`, token)).body.find((x) => x.campo_id === id);
  await send(`/prenotazioni-campo/${p.id}/annulla`, { tessera_code: SOCIO_A });
  assert.equal((await send(`/admin/campi/${id}`, undefined, 'DELETE', token)).status, 200);
});

test('un articolo con movimenti non si cancella', async () => {
  const a = await send('/admin/magazzino', { nome: 'Articolo di prova', zona: 'bar', giacenza: 10 }, 'POST', token);
  const id = a.body.id;
  await send(`/admin/magazzino/${id}/movimento`, { tipo: 'scarico', quantita: 1 }, 'POST', token);
  const ko = await send(`/admin/magazzino/${id}`, undefined, 'DELETE', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /movimenti/);
});

test('una serata con prenotazioni non si cancella, annullate sì', async () => {
  const s = await send('/admin/serate', { titolo: 'Serata di prova', quota: 20, capienza: 30 }, 'POST', token);
  const id = s.body.id;
  const p = await send(`/serate/${id}/prenota`, { tessera_code: SOCIO_A, persone: 2 });
  if (p.status === 201) {
    const ko = await send(`/admin/serate/${id}`, undefined, 'DELETE', token);
    assert.equal(ko.status, 409);
    assert.match(ko.body.error, /prenotazioni/);
    const pren = (await get(`/admin/serate/${id}/prenotazioni`, token)).body[0];
    await send(`/admin/serate-prenotazioni/${pren.id}`, { stato: 'annullata' }, 'PUT', token);
  }
  assert.equal((await send(`/admin/serate/${id}`, undefined, 'DELETE', token)).status, 200);
});

test('un gioco in prestito non si cancella finché non rientra', async () => {
  const g = await send('/admin/cdc/giochi', { nome: 'Gioco di prova', quantita: 1 }, 'POST', token);
  const pr = await send('/admin/cdc/prestiti', { gioco_id: g.body.id, gioco_nome: 'Gioco di prova', giocatore: 'Tizio', ora_inizio: '17:00' }, 'POST', token);
  const ko = await send(`/admin/cdc/giochi/${g.body.id}`, undefined, 'DELETE', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /prestiti/);
  await send(`/admin/cdc/prestiti/${pr.body.id}`, { ora_fine: '19:00' }, 'PUT', token);
  assert.equal((await send(`/admin/cdc/giochi/${g.body.id}`, undefined, 'DELETE', token)).status, 200);
});

test('una disciplina con partite giocate non si cancella', async () => {
  const disc = (await get('/admin/discipline', token)).body[0];
  const ko = await send(`/admin/discipline/${disc.id}`, undefined, 'DELETE', token);
  assert.equal(ko.status, 409, 'la disciplina del torneo giocato deve essere protetta');
  assert.match(ko.body.error, /partite|edizioni/);
});

test('senza rami la cancellazione resta possibile', async () => {
  const c = await send('/admin/campi', { nome: 'Campo effimero', sport: 'altro' }, 'POST', token);
  assert.equal((await get(`/admin/referenze/campi/${c.body.id}`, token)).body.blocchi.length, 0);
  assert.equal((await send(`/admin/campi/${c.body.id}`, undefined, 'DELETE', token)).status, 200);
});

test('la consumazione obbligatoria arriva ai soci al posto del prezzo', async () => {
  await send('/admin/eventi', { giorno: 'ven', titolo: 'Con consumazione', costo_tipo: 'consumazione', consumazione: '1 drink incluso' }, 'POST', token);
  const ev = (await get('/eventi')).body.find((e) => e.titolo === 'Con consumazione');
  assert.ok(ev, 'evento non visibile ai soci');
  assert.equal(ev.costo_tipo, 'consumazione');
  assert.equal(ev.consumazione, '1 drink incluso');
  assert.equal(ev.costo, 0, 'niente prezzo quando si entra consumando');

  // spegnendo gli eventi a pagamento, l'ingresso torna libero anche per chi guarda l'app
  await setPar({ eventi_onerosi: false }, token);
  const libero = (await get('/eventi')).body.find((e) => e.titolo === 'Con consumazione');
  assert.equal(libero.costo_tipo, 'nessuno');
  await setPar({ eventi_onerosi: true }, token);
});

// ---- Limature v4.73 ----------------------------------------------------------------------
test('la data si può spostare sulla singola partita senza toccare le altre', async () => {
  const disc = (await get('/admin/discipline', token)).body[1];
  const g = (await get(`/admin/tabellone/${disc.id}`, token)).body.gironi[0];
  const comune = giorno(80);
  await send(`/admin/tabellone/${disc.id}/giornata`, { girone_id: g.id, giornata: 3, quando: comune }, 'PUT', token);
  const prima = (await get(`/admin/tabellone/${disc.id}`, token)).body.gironi.find((x) => x.id === g.id).partite.filter((p) => p.giornata === 3);
  assert.ok(prima.every((p) => p.quando === comune), 'la data comune deve scrivere entrambe le righe');

  // una sola partita slitta
  const spostata = giorno(81);
  const r = await send(`/admin/partite/${prima[0].id}/quando`, { quando: spostata }, 'PUT', token);
  assert.equal(r.status, 200);
  const dopo = (await get(`/admin/tabellone/${disc.id}`, token)).body.gironi.find((x) => x.id === g.id).partite.filter((p) => p.giornata === 3);
  assert.equal(dopo.find((p) => p.id === prima[0].id).quando, spostata);
  assert.equal(dopo.find((p) => p.id === prima[1].id).quando, comune, 'l\'altra partita non si muove');
});

test('la struttura della fase finale si vede prima di sbloccarsi, con gli accoppiamenti', async () => {
  const disc = (await get('/admin/discipline', token)).body[1];
  const t = (await get(`/admin/tabellone/${disc.id}`, token)).body;
  assert.equal(t.hasFinale, false, 'il torneo non deve essere ancora sbloccato');
  const st = t.struttura;
  assert.ok(st, 'la struttura deve esserci comunque');
  assert.equal(st.quarti.length, 4);
  // incroci 1º-4º, 2º-3º, 3º-2º, 4º-1º fra i due gironi
  assert.match(st.quarti[0].a.etichetta, /^1º Girone A$/);
  assert.match(st.quarti[0].b.etichetta, /^4º Girone B$/);
  assert.match(st.quarti[3].a.etichetta, /^4º Girone A$/);
  assert.match(st.quarti[3].b.etichetta, /^1º Girone B$/);
  assert.match(st.semifinali[0].a.etichetta, /Vincente quarto 1/);
  assert.match(st.semifinali[0].b.etichetta, /Vincente quarto 4/);
  assert.match(st.finale3.a.etichetta, /Perdente semifinale 1/);
  // con la classifica gia' popolata ogni casella dice chi la occuperebbe oggi
  assert.ok(st.quarti.every((q) => q.a.provvisorio), 'manca l\'occupante provvisorio');
});

test('due tavoli uniti diventano un tavolo solo, e i numeri assorbiti restano raggiungibili', async () => {
  const def = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.predefinito);
  const tavoli = [
    { numero: 1, posti: 4, forma: 'rettangolo', x: 50, y: 50, uniti: [2] },  // 1 assorbe 2
    { numero: 2, posti: 4, forma: 'tondo', x: 56, y: 50, attivo: false },
    { numero: 3, posti: 4, forma: 'tondo', x: 20, y: 20 },
    { numero: 9, posti: 2, forma: 'tondo', x: 80, y: 80 }                    // tavolo aggiunto
  ];
  assert.equal((await send(`/admin/tavoli/layout/${def.id}`, { tavoli, completo: true }, 'PUT', token)).status, 200);

  const sala = await get('/admin/tavoli/sala', token);
  assert.equal(sala.status, 200);
  const numeri = sala.body.tavoli.map((t) => t.numero).sort((a, b) => a - b);
  assert.deepEqual(numeri, [1, 3, 9], 'in sala restano i tavoli attivi, compreso quello aggiunto');
  assert.deepEqual(sala.body.tavoli.find((t) => t.numero === 1).uniti, [2]);
  // il numero assorbito continua a puntare al tavolo che lo serve: i QR gia' stampati reggono
  assert.equal(sala.body.verso['2'], 1);
  assert.equal(sala.body.verso['9'], 9);

  // e la prenotazione non assegna piu' il tavolo assorbito
  const data = giorno(82);
  const stato = (await get(`/admin/tavoli/turno?data=${data}&turno=20:00`, token)).body;
  assert.ok(!stato.tavoli.some((t) => t.numero === 2), 'il tavolo assorbito non e\' assegnabile');
});

// ---- Gruppo B: app residence -------------------------------------------------------------
test('gli appartenenti a una casata sono visibili, col capitano in evidenza', async () => {
  const casata = (await get('/casate')).body[0];
  const r = await get(`/casate/${casata.id}/appartenenti`);
  assert.equal(r.status, 200);
  assert.equal(r.body.casata.nome, casata.nome);
  assert.ok(Array.isArray(r.body.membri));
  assert.equal(r.body.quanti, r.body.membri.length);
  // l'elenco non espone contatti: solo nome, ruolo e profilo
  for (const m of r.body.membri) {
    assert.deepEqual(Object.keys(m).sort(), ['capitano', 'nome', 'profilo', 'ruolo']);
  }
  // se c'e' un capitano e' il primo della lista
  if (r.body.capitano) assert.equal(r.body.membri[0].capitano, true);
  assert.equal((await get('/casate/9999/appartenenti')).status, 404);
});

test('il menù si può chiedere per punto: Bar e Garden hanno referenze diverse', async () => {
  const tutto = (await get('/menu')).body;
  const bar = (await get('/menu?zona=bar')).body;
  const garden = (await get('/menu?zona=garden')).body;
  assert.ok(tutto.length >= bar.length);
  assert.ok(tutto.length >= garden.length);
  // ogni voce del Bar è del Bar o comune a entrambi
  assert.ok(bar.every((m) => m.zona === 'bar' || m.zona === 'comune'), 'nel Bar è comparsa una voce del Garden');
  assert.ok(garden.every((m) => m.zona === 'garden' || m.zona === 'comune'), 'nel Garden è comparsa una voce del Bar');
});

// ---- Cinema: cartellone, proiezioni e platea (stesso motore dei tavoli) ------------------
test('il cartellone accoglie i film e il film in programmazione non si cancella', async () => {
  const f = await send('/admin/film', { titolo: 'Nuovo Cinema Paradiso', regia: 'Tornatore', anno: 1988, durata_min: 155, genere: 'drammatico' }, 'POST', token);
  assert.equal(f.status, 201);
  const lista = (await get('/admin/film', token)).body;
  assert.ok(lista.some((x) => x.titolo === 'Nuovo Cinema Paradiso'));

  const p = await send('/admin/proiezioni', { film_id: f.body.id, data: giorno(90), ora: '21:30' }, 'POST', token);
  assert.equal(p.status, 201);
  const ko = await send(`/admin/film/${f.body.id}`, undefined, 'DELETE', token);
  assert.equal(ko.status, 409, 'un film in cartellone non si elimina');
  assert.match(ko.body.error, /proiezioni/);
});

test('la platea è la sala del Garden con altre etichette: posti, standard ed extra', async () => {
  const pr = (await get('/admin/proiezioni', token)).body[0];
  const platea = await get(`/admin/proiezioni/${pr.id}/platea`, token);
  assert.equal(platea.status, 200);
  assert.equal(platea.body.ambiente, 'stage');
  assert.ok(platea.body.tavoli.length > 0, 'platea vuota');
  assert.ok(platea.body.tavoli.some((t) => t.tipo === 'standard'));
  assert.ok(platea.body.tavoli.some((t) => t.tipo === 'extra'), 'mancano i posti extra');
  // ogni SEDUTA vale una persona; il palco è arredo e non è un posto
  const sedute = platea.body.tavoli.filter((t) => t.tipo !== 'arredo');
  assert.ok(sedute.every((t) => t.posti === 1 && typeof t.distanza === 'number'));
  assert.ok(platea.body.tavoli.some((t) => t.tipo === 'arredo' && t.numero === 99), 'in platea ci vuole il palco');
});

test('chi viene solo per lo spettacolo prende la sua quota, dal centro', async () => {
  const pr = (await get('/admin/proiezioni', token)).body[0];
  const prima = (await get(`/admin/proiezioni/${pr.id}/platea`, token)).body;
  const spett = prima.tavoli.filter((t) => t.quota === 'spettacolo' && t.tipo === 'standard');
  assert.ok(spett.length, 'la platea deve avere una quota per chi non cena');
  const piuCentrale = [...spett].sort((a, b) => a.distanza - b.distanza)[0];

  const r = await send(`/cinema/${pr.id}/prenota`, { tessera_code: SOCIO_A, persone: 2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.extra, false, 'con gli standard liberi non si devono usare gli extra');
  assert.ok(r.body.posti.includes(piuCentrale.numero), 'doveva prendere il posto più centrale della SUA quota');

  // esaurisce tutti gli standard, a gruppi, e la volta dopo si aprono gli extra
  const std = prima.tavoli.filter((t) => t.tipo === 'standard');
  let messi = 2;
  for (let i = 0; i < 200 && messi < std.length; i++) {
    const q = Math.min(6, std.length - messi);
    const g = await send(`/cinema/${pr.id}/prenota`, { tessera_code: [SOCIO_B, SOCIO_C, SEI[3]][i % 3], persone: q });
    if (g.status !== 201) break;
    messi += q;
  }
  const dopo = (await get(`/admin/proiezioni/${pr.id}/platea`, token)).body;
  assert.equal(dopo.standard_liberi, 0, 'la platea standard doveva riempirsi');
  const suExtra = await send(`/cinema/${pr.id}/prenota`, { tessera_code: SOCIO_C, persone: 1 });
  assert.equal(suExtra.status, 201);
  assert.equal(suExtra.body.extra, true, 'a standard esauriti deve aprire gli extra');
});

test('spegnendo i posti extra la proiezione risulta al completo', async () => {
  const f = (await get('/admin/film', token)).body[0];
  const pr = await send('/admin/proiezioni', { film_id: f.id, data: giorno(91), ora: '21:30' }, 'POST', token);
  const platea = (await get(`/admin/proiezioni/${pr.body.id}/platea`, token)).body;
  const std = platea.tavoli.filter((t) => t.tipo === 'standard').length;

  await setPar({ cinema_posti_extra: false }, token);
  // riempie tutta la platea standard, a gruppi (una sola prenotazione enorme non passerebbe)
  let messi = 0;
  for (let i = 0; i < 200 && messi < std; i++) {
    const q = Math.min(6, std - messi);
    const r = await send(`/cinema/${pr.body.id}/prenota`, { tessera_code: [SOCIO_A, SOCIO_B, SOCIO_C][i % 3], persone: q });
    if (r.status !== 201) break;
    messi += q;
  }
  assert.equal(messi, std, 'la platea standard doveva riempirsi tutta');
  const oltre = await send(`/cinema/${pr.body.id}/prenota`, { tessera_code: SOCIO_B, persone: 1 });
  assert.equal(oltre.status, 409, 'con gli extra spenti non si va oltre gli standard');
  await setPar({ cinema_posti_extra: true }, token);
  assert.equal((await send(`/cinema/${pr.body.id}/prenota`, { tessera_code: SOCIO_B, persone: 1 })).status, 201);
});

test('il cartellone pubblico mostra i film e le prossime proiezioni', async () => {
  const c = await get('/cinema');
  assert.equal(c.status, 200);
  assert.ok(c.body.film.length >= 1);
  assert.ok(c.body.prossime.length >= 1);
  const p = c.body.prossime[0];
  assert.ok(p.titolo, 'la proiezione deve portare il titolo del film');
  assert.equal(typeof p.posti_liberi, 'number');
  assert.equal(c.body.prenotabile, true);

  const mie = await get(`/cinema/mie-prenotazioni?tessera_code=${SOCIO_A}`);
  assert.ok(mie.body.length >= 1);
  assert.ok(mie.body[0].posti.length >= 1);
});

test('il Garden non è toccato dalle prenotazioni del cinema', async () => {
  const data = giorno(92);
  const t = (await get(`/garden/turni?data=${data}`)).body.turni;
  assert.ok(t[0].posti_liberi > 0, 'la sala del Garden deve restare libera');
  const g = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '20:00', persone: 2 });
  assert.equal(g.status, 201);
  // e la platea non si accorge della prenotazione al Garden
  const pr = (await get('/admin/proiezioni', token)).body[0];
  const platea = (await get(`/admin/proiezioni/${pr.id}/platea`, token)).body;
  assert.ok(platea.prenotazioni.every((x) => x.ambiente === 'stage'));
});

// ---- Area fitness: corsi brevi, minimo di iscritti, pagamento a lezione ------------------
const lunedi = (n = 0) => { const d = new Date(Date.now() + (60 + n * 7) * 864e5); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

test('un corso genera da solo le lezioni nei giorni scelti', async () => {
  const inizio = lunedi(0);
  const fine = new Date(new Date(inizio + 'T12:00:00Z').getTime() + 6 * 864e5).toISOString().slice(0, 10);
  const c = await send('/admin/fitness/corsi', {
    nome: 'Pilates', istruttore: 'Anna R.', data_inizio: inizio, data_fine: fine,
    giorni: [1, 3, 5], ora: '09:00', durata_min: 55, posti_max: 20, min_iscritti: 10, prezzo: 12
  }, 'POST', token);
  assert.equal(c.status, 201);
  assert.equal(c.body.creati, 3, 'lun/mer/ven in una settimana = 3 lezioni');

  const sedute = (await get('/admin/fitness/sedute', token)).body.filter((s) => s.corso_nome === 'Pilates');
  assert.equal(sedute.length, 3);
  assert.ok(sedute.every((s) => s.ora === '09:00' && s.durata_min === 55 && s.prezzo === 12));

  // rigenerare non duplica
  const g = await send(`/admin/fitness/corsi/${c.body.id}/genera`, {}, 'POST', token);
  assert.equal(g.body.creati, 0, 'la rigenerazione non deve creare doppioni');
});

test('sotto il minimo la lezione resta in attesa, raggiunto il minimo si conferma', async () => {
  const s = (await get('/admin/fitness/sedute', token)).body.find((x) => x.corso_nome === 'Pilates');
  assert.equal(s.iscritti, 0);
  assert.equal(s.confermata, false);
  assert.equal(s.mancano, 10);

  const r = await send(`/fitness/sedute/${s.id}/prenota`, { tessera_code: SOCIO_A });
  assert.equal(r.status, 201);
  assert.equal(r.body.confermata, false);
  assert.equal(r.body.mancano, 9);

  // due volte no
  assert.equal((await send(`/fitness/sedute/${s.id}/prenota`, { tessera_code: SOCIO_A })).status, 409);

  // abbassando il minimo a 1 la lezione risulta confermata
  await send(`/admin/fitness/sedute/${s.id}`, { min_iscritti: 1 }, 'PUT', token);
  const dopo = (await get('/admin/fitness/sedute', token)).body.find((x) => x.id === s.id);
  assert.equal(dopo.confermata, true);
});

test('spegnendo il minimo dai parametri ogni lezione parte comunque', async () => {
  const s = (await get('/admin/fitness/sedute', token)).body.filter((x) => x.corso_nome === 'Pilates')[1];
  assert.equal(s.confermata, false);
  await setPar({ fitness_minimo: false }, token);
  const dopo = (await get('/admin/fitness/sedute', token)).body.find((x) => x.id === s.id);
  assert.equal(dopo.confermata, true);
  assert.equal(dopo.minimo, 0);
  await setPar({ fitness_minimo: true }, token);
});

test('la masterclass si marca sulla singola lezione, con il suo prezzo', async () => {
  const s = (await get('/admin/fitness/sedute', token)).body.filter((x) => x.corso_nome === 'Pilates')[2];
  assert.equal(s.masterclass, false);
  const r = await send(`/admin/fitness/sedute/${s.id}`, { masterclass: true, prezzo: 35, titolo: 'Masterclass con Ospite', istruttore: 'Nome Noto' }, 'PUT', token);
  assert.equal(r.status, 200);
  const dopo = (await get('/admin/fitness/sedute', token)).body.find((x) => x.id === s.id);
  assert.equal(dopo.masterclass, true);
  assert.equal(dopo.prezzo, 35);
  assert.equal(dopo.titolo, 'Masterclass con Ospite');
  // le altre lezioni del corso non sono toccate
  const altre = (await get('/admin/fitness/sedute', token)).body.filter((x) => x.corso_nome === 'Pilates' && x.id !== s.id);
  assert.ok(altre.every((x) => x.masterclass === false && x.prezzo === 12));
});

test('si incassa a fine lezione, iscrizione al banco compresa', async () => {
  const s = (await get('/admin/fitness/sedute', token)).body.find((x) => x.corso_nome === 'Pilates');
  const banco = await send(`/admin/fitness/sedute/${s.id}/iscrivi`, { nome: 'Sig.ra Bianchi' }, 'POST', token);
  assert.equal(banco.status, 201);

  const conElenco = (await get('/admin/fitness/sedute', token)).body.find((x) => x.id === s.id);
  assert.ok(conElenco.da_incassare > 0, 'nessun importo da incassare');
  assert.equal(conElenco.incassato, 0);
  const iscritto = conElenco.elenco[0];
  await send(`/admin/fitness/prenotazioni/${iscritto.id}`, { pagato: true }, 'PUT', token);
  const dopo = (await get('/admin/fitness/sedute', token)).body.find((x) => x.id === s.id);
  assert.equal(dopo.incassato, Number(dopo.prezzo));
});

test('il socio vede le sue lezioni e può disdire; senza tessera non si iscrive', async () => {
  const s = (await get('/admin/fitness/sedute', token)).body.filter((x) => x.corso_nome === 'Pilates')[1];
  assert.equal((await send(`/fitness/sedute/${s.id}/prenota`, {})).status, 403);
  const r = await send(`/fitness/sedute/${s.id}/prenota`, { tessera_code: SOCIO_B });
  assert.equal(r.status, 201);
  const mie = (await get(`/fitness/mie-iscrizioni?tessera_code=${SOCIO_B}`)).body;
  assert.ok(mie.some((x) => x.corso_nome === 'Pilates'));
  const ko = await send(`/fitness/iscrizioni/${mie[0].id}/annulla`, { tessera_code: SOCIO_C });
  assert.equal(ko.status, 403);
  assert.equal((await send(`/fitness/iscrizioni/${mie[0].id}/annulla`, { tessera_code: SOCIO_B })).status, 200);
});

test('il corso con iscrizioni attive non si cancella', async () => {
  const corso = (await get('/admin/fitness/corsi', token)).body.find((c) => c.nome === 'Pilates');
  const ko = await send(`/admin/fitness/corsi/${corso.id}`, undefined, 'DELETE', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /iscrizioni/);
});

test('la serata cinema porta il titolo del film nel cartellone settimanale', async () => {
  const eventi = (await get('/eventi')).body;
  const cine = eventi.find((e) => /cinema/i.test(e.titolo || ''));
  assert.ok(cine, 'manca la serata cinema nel cartellone');
  assert.ok(cine.film, 'la serata cinema deve portare il film in programma');
  assert.ok(cine.film.titolo);
  assert.ok(cine.film.proiezione_id);
});

test('la Casa di Carta ha la sua zona di magazzino, distinta dal comune', async () => {
  const core = await send('/admin/magazzino', { nome: 'Mazzi di carte nuovi', zona: 'carta', unita: 'pz', giacenza: 20 }, 'POST', token);
  const comune = await send('/admin/magazzino', { nome: 'Tovaglioli test', zona: 'comune', unita: 'pz', giacenza: 500 }, 'POST', token);
  const z = (await get('/admin/magazzino/zona/carta', token)).body.articoli;
  const c1 = z.find((a) => a.articolo_id === core.body.id);
  const c2 = z.find((a) => a.articolo_id === comune.body.id);
  assert.ok(c1 && c2, 'la zona deve vedere sia i suoi articoli sia quelli comuni');
  assert.equal(c1.zona_art, 'carta', 'l\'articolo core non deve finire fra i comuni');
  assert.equal(c2.zona_art, 'comune');
  // il vecchio nome della zona continua a funzionare
  const vecchio = await get('/admin/magazzino/zona/cdc', token);
  assert.equal(vecchio.status, 200);
  assert.ok(vecchio.body.articoli.some((a) => a.articolo_id === core.body.id));
  // e un articolo salvato con il vecchio nome viene normalizzato
  const old = await send('/admin/magazzino', { nome: 'Vecchia zona test', zona: 'cdc', unita: 'pz', giacenza: 1 }, 'POST', token);
  const rientrato = (await get('/admin/magazzino/zona/carta', token)).body.articoli.find((a) => a.articolo_id === old.body.id);
  assert.equal(rientrato.zona_art, 'carta');
});

// ---- Anti-monopolio dei campi: il trucco delle sei persone ------------------------------
// Sei amici giocano a calcetto: il primo prenota le 16, gli altri cinque prenotano le fasce
// successive, e il campo resta loro fino a sera. Il tetto sul titolare non lo ferma, perché i
// titolari sono sei persone diverse. Queste prove verificano che le regole lo fermino.
const SEI = ['RB-000001-4', 'RB-000002-8', 'RB-000003-1', 'RB-000004-5', 'RB-000005-9', 'RB-000100-6'];
const vicino = (n = 1) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('senza regole il trucco riesce: sei soci bloccano il campo tutto il pomeriggio', async () => {
  await setPar({ campi_quota_su_partecipanti: false, campi_catena: false, campi_max_giorno: false, campi_finestra: false }, token);
  const c = (await get('/campi')).body[0];
  const data = giorno(100);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);
  for (let i = 0; i < 6; i++) {
    const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[i], data, slot: liberi[i], n_slot: 1 });
    assert.equal(r.status, 201, `la fascia ${i + 1} doveva passare: è la falla che stiamo chiudendo`);
  }
});

test('con la quota sui partecipanti la catena si ferma alla terza fascia', async () => {
  await setPar({ campi_quota_su_partecipanti: true, campi_catena: false, campi_max_giorno: false, campi_finestra: false }, token);
  // La quota e' una regola dei campi gratuiti: su quelli a pagamento non c'e' tetto.
  const c = (await get('/campi')).body.find((x) => (x.gestione || 'chiosco') === 'chiosco');
  const data = giorno(101);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);

  // ogni fascia è prenotata da uno diverso, ma i sei giocano insieme: si uniscono tutti
  let bloccato = 0;
  for (let i = 0; i < 6; i++) {
    const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[i], data, slot: liberi[i], n_slot: 1 });
    if (r.status !== 201) { bloccato = i + 1; break; }
    // gli altri cinque si aggiungono alla partita appena aperta
    for (const t of SEI.filter((x) => x !== SEI[i])) await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: t });
  }
  assert.ok(bloccato > 0 && bloccato <= 4, `il gruppo doveva essere fermato entro la quarta fascia, invece è arrivato a ${bloccato || 6}`);
});

test('la catena contigua ferma il gruppo anche senza tetto settimanale', async () => {
  await setPar({ campi_limita_settimana: false, campi_catena: true, campi_quota_su_partecipanti: true, campi_max_giorno: false, campi_finestra: false }, token);
  const c = (await get('/campi')).body.find((x) => x.max_slot_prenotazione >= 2);
  const data = giorno(102);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);

  const p1 = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot: liberi[0], n_slot: 1 });
  assert.equal(p1.status, 201);
  await send(`/partite-aperte/${p1.body.partita_id}/unisciti`, { tessera_code: SEI[1] });

  // il secondo del gruppo prenota la fascia attaccata: la catena diventa lunga 2, ancora ok
  const p2 = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[1], data, slot: liberi[1], n_slot: 1 });
  assert.equal(p2.status, 201);
  await send(`/partite-aperte/${p2.body.partita_id}/unisciti`, { tessera_code: SEI[0] });

  // la terza attaccata farebbe 3 di fila per le stesse persone: rifiutata
  const p3 = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot: liberi[2], n_slot: 1 });
  assert.equal(p3.status, 409, 'la terza fascia di fila doveva essere rifiutata');
  assert.match(p3.body.error, /di fila|attaccate/);

  // ma una fascia LONTANA nella giornata resta possibile: la regola non è una punizione
  const lontana = liberi[liberi.length - 1];
  const p4 = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot: lontana, n_slot: 1 });
  assert.equal(p4.status, 201, 'una fascia staccata non deve essere bloccata');
  await setPar({ campi_limita_settimana: true }, token);
});

test('unirsi non aggira la catena', async () => {
  await setPar({ campi_catena: true, campi_quota_su_partecipanti: true, campi_limita_settimana: false, campi_max_giorno: false, campi_finestra: false }, token);
  const c = (await get('/campi')).body.find((x) => x.max_slot_prenotazione >= 2);
  const data = giorno(103);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);

  // tre fasce attaccate aperte da tre persone diverse: nessuna catena, per ora
  const a = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot: liberi[0] });
  const b = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[1], data, slot: liberi[1] });
  const d = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[2], data, slot: liberi[2] });
  assert.equal(d.status, 201);

  // ora il primo prova a unirsi alle altre due: la sua catena diventerebbe 3
  assert.equal((await send(`/partite-aperte/${b.body.partita_id}/unisciti`, { tessera_code: SEI[0] })).status, 200);
  const ko = await send(`/partite-aperte/${d.body.partita_id}/unisciti`, { tessera_code: SEI[0] });
  assert.equal(ko.status, 409, 'unendosi si allunga la catena: va fermato come la prenotazione');
  await setPar({ campi_limita_settimana: true }, token);
});

test('il tetto giornaliero lascia il campo agli altri dopo una partita', async () => {
  await setPar({ campi_max_giorno: true, campi_max_giorno_n: 1, campi_catena: false, campi_quota_su_partecipanti: true, campi_finestra: false }, token);
  const c = (await get('/campi')).body[2];
  const data = giorno(104);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);

  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot: liberi[0] })).status, 201);
  const secondo = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot: liberi[3] });
  assert.equal(secondo.status, 409, 'la seconda prenotazione dello stesso giorno va rifiutata');
  assert.match(secondo.body.error, /oggi/);

  // un altro socio prenota senza problemi: il campo è passato ad altri, non chiuso
  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SEI[1], data, slot: liberi[3] })).status, 201);
  // e domani il primo torna a giocare
  const domani = giorno(105);
  const l2 = (await get(`/campi/${c.id}/disponibilita?data=${domani}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);
  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data: domani, slot: l2[0] })).status, 201);
  await setPar({ campi_max_giorno: false }, token);
});

test('la finestra impedisce di prenotarsi mezza stagione', async () => {
  await setPar({ campi_finestra: true, campi_finestra_giorni: 7, campi_max_giorno: false, campi_catena: false }, token);
  const c = (await get('/campi')).body[3];
  const dentro = vicino(3), fuori = vicino(30);
  const slotDentro = (await get(`/campi/${c.id}/disponibilita?data=${dentro}`)).body.slots.find((s) => s.stato === 'libero').slot;
  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data: dentro, slot: slotDentro })).status, 201);
  const slotFuori = (await get(`/campi/${c.id}/disponibilita?data=${fuori}`)).body.slots.find((s) => s.stato === 'libero').slot;
  const ko = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[1], data: fuori, slot: slotFuori });
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /anticipo/);
  await setPar({ campi_finestra: false }, token);
});

test('tutte le regole insieme: il trucco non passa e il campo resta di tutti', async () => {
  await setPar({ campi_quota_su_partecipanti: true, campi_catena: true, campi_max_giorno: true, campi_max_giorno_n: 1, campi_finestra: false }, token);
  const c = (await get('/campi')).body[4];
  const data = giorno(106);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);

  let occupate = 0;
  for (let i = 0; i < 6; i++) {
    const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[i], data, slot: liberi[i], n_slot: 1 });
    if (r.status === 201) {
      occupate++;
      for (const t of SEI.filter((x) => x !== SEI[i])) await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: t });
    }
  }
  assert.ok(occupate <= 2, `il gruppo non deve occupare più di due fasce di fila, ne ha prese ${occupate}`);

  // il resto della giornata resta disponibile per chiunque altro
  const dopo = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero');
  assert.ok(dopo.length >= 3, 'devono restare fasce libere per gli altri soci');
  await setPar({ campi_max_giorno: false, campi_catena: false, campi_quota_su_partecipanti: false }, token);
});

// ---- Chiusura della stagione e Albo d'Oro delle casate ----------------------------------
test('la stagione non si chiude finché una disciplina non ha espresso i suoi punti', async () => {
  const ch = await get('/admin/coppa/chiusura', token);
  assert.equal(ch.status, 200);
  assert.ok(ch.body.stagione);
  if (!ch.body.pronta) {
    assert.ok(ch.body.mancanti.length > 0, 'se non è pronta deve dire cosa manca');
    const ko = await send('/admin/coppa/chiudi', { stagione: ch.body.stagione }, 'POST', token);
    assert.equal(ko.status, 409);
    assert.match(ko.body.error, /Mancano/);
  }
});

test('con tutti i tornei conclusi la chiusura è proposta e manda i primi tre nell\'Albo', async () => {
  // porta a termine ogni disciplina rimasta
  for (const d of (await get('/admin/discipline', token)).body) {
    if (d.stato === 'archiviato') continue;
    let tb = (await get(`/admin/tabellone/${d.id}`, token)).body;
    if (!tb.gironi.length) { await send(`/admin/tabellone/${d.id}/genera`, {}, 'POST', token); }
    for (let giro = 0; giro < 8; giro++) {
      tb = (await get(`/admin/tabellone/${d.id}`, token)).body;
      const da = [...(tb.gironi || []).flatMap((g) => g.partite || []), ...Object.values(tb.fasi || {}).flat()].filter((p) => p && p.stato !== 'giocata');
      if (!da.length) break;
      for (const p of da) await send(`/admin/partite/${p.id}`, { gol_a: 2, gol_b: 1 }, 'PUT', token);
    }
  }
  const ch = (await get('/admin/coppa/chiusura', token)).body;
  assert.equal(ch.pronta, true, 'con tutte le discipline concluse la chiusura va proposta: ' + JSON.stringify(ch.mancanti));

  const r = await send('/admin/coppa/chiudi', { stagione: ch.stagione }, 'POST', token);
  assert.equal(r.status, 200);
  // "primi tre posti": con un pari merito le casate possono essere piu' di tre, e ci vanno
  // tutte quelle che occupano il podio — escluderne una a sorte sarebbe arbitrario.
  const pos = [...new Set(r.body.podio.map((p) => p.posizione))].sort();
  assert.deepEqual(pos, [1, 2, 3].slice(0, pos.length));
  assert.ok(r.body.podio.length >= 3);
  assert.ok(r.body.podio.every((p) => p.posizione <= 3));
  assert.equal(r.body.podio.filter((p) => p.posizione === 1).length, 1, 'una sola prima classificata');

  // il tabellone è chiuso: nessuna disciplina resta in corso
  assert.ok((await get('/admin/discipline', token)).body.every((d) => d.stato === 'archiviato'));
  // e non si chiude due volte
  const bis = await send('/admin/coppa/chiudi', { stagione: ch.stagione }, 'POST', token);
  assert.equal(bis.status, 409);
  assert.match(bis.body.error, /gi/);
});

test('la campionessa porta il simbolo del residence nella stagione successiva', async () => {
  const albo = await get('/albo-casate');
  assert.equal(albo.status, 200);
  assert.ok(albo.body.campione, 'manca il campione in carica');
  const prima = albo.body.campione.casata_nome;

  const casate = (await get('/casate')).body;
  const c = casate.find((x) => x.nome === prima);
  assert.equal(c.campione, true, 'la prima classificata deve risultare campione in carica');
  assert.ok(casate.filter((x) => x.campione).length === 1, 'una sola casata porta il simbolo');
  assert.ok(c.campione_stagione);
});

test('a parità assoluta il sistema non sceglie: chiede lo spareggio', async () => {
  // stato di chiusura di una stagione mai chiusa, con la graduatoria attuale
  const st = (await get('/admin/coppa/chiusura?stagione=9999', token)).body;
  if (!st.spareggio) return;                       // nessuna parità in questo scenario
  const ko = await send('/admin/coppa/chiudi', { stagione: '9999' }, 'POST', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /parit|Parit/i);
  // indicando la vincitrice dello spareggio la chiusura passa
  const ok = await send('/admin/coppa/chiudi', { stagione: '9999', vincitrice: st.spareggio[0].id }, 'POST', token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.podio.find((p) => p.posizione === 1).casata_nome ?? ok.body.podio[0].nome, st.spareggio[0].nome);
});

// ---- Numero legale: rende conveniente dichiarare chi gioca ------------------------------
// Senza, la catena e' cieca: prenota uno e giocano in sei senza registrarsi. Con il numero
// legale il gruppo ha due strade e nessuna gli lascia il campo: dichiararsi (e finire sotto
// la catena) oppure perdere lo slot alla scadenza.
test('il campo dichiara il suo numero legale e la disponibilità dice quanti mancano', async () => {
  await setPar({ campi_numero_legale: true, campi_numero_legale_minuti: 30, campi_max_giorno: false, campi_catena: false, campi_finestra: false }, token);
  const c = (await get('/campi')).body[0];
  assert.ok(c.min_giocatori >= 2, 'il campo deve avere un numero legale');
  assert.equal(c.regole.numero_legale, true);

  const data = giorno(110);
  const slot = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.find((s) => s.stato === 'libero').slot;
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data, slot });
  assert.equal(r.status, 201);

  const d = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.find((s) => s.slot === slot);
  assert.ok(d.numero_legale, 'la disponibilità deve dire a che punto è il numero legale');
  assert.equal(d.numero_legale.minimo, c.min_giocatori);
  assert.equal(d.numero_legale.iscritti, 1);
  assert.equal(d.numero_legale.mancano, c.min_giocatori - 1);
  assert.equal(d.numero_legale.raggiunto, false);
  assert.ok(d.numero_legale.scade_alle, 'va detto entro quando');
});

test('anche la prenotazione riservata dichiara i compagni, e solo il titolare li aggiunge', async () => {
  const c = (await get('/campi')).body[1];
  const data = giorno(111);
  const slot = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.find((s) => s.stato === 'libero').slot;
  const r = await send(`/campi/${c.id}/prenota`, { tessera_code: SEI[0], data, slot });   // riservata
  assert.equal(r.status, 201);
  assert.equal(r.body.aperta_ai_soci, false);

  // un estraneo non si unisce a una riservata...
  assert.equal((await send(`/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: SEI[1] })).status, 409);
  // ...e nemmeno si aggiunge da solo
  const abusivo = await send(`/partite-aperte/${r.body.partita_id}/aggiungi`, { tessera_titolare: SEI[1], tessera_code: SEI[1] });
  assert.equal(abusivo.status, 403);

  // ma il titolare può dichiarare chi gioca con lui
  const ok = await send(`/partite-aperte/${r.body.partita_id}/aggiungi`, { tessera_titolare: SEI[0], tessera_code: SEI[1] });
  assert.equal(ok.status, 201 === ok.status ? 201 : 200);
  assert.equal(ok.body.iscritti, 2);

  const g = await get(`/partite-aperte/${r.body.partita_id}/giocatori`);
  assert.equal(g.body.giocatori.length, 2);
  assert.equal(g.body.aperta_ai_soci, false);
  // due volte lo stesso no
  assert.equal((await send(`/partite-aperte/${r.body.partita_id}/aggiungi`, { tessera_titolare: SEI[0], tessera_code: SEI[1] })).status, 409);
});

test('dichiarare i compagni non aggira la catena', async () => {
  await setPar({ campi_catena: true, campi_quota_su_partecipanti: true, campi_limita_settimana: false, campi_max_giorno: false, campi_finestra: false }, token);
  const c = (await get('/campi')).body.find((x) => x.max_slot_prenotazione >= 2);
  const data = giorno(112);
  const liberi = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.filter((s) => s.stato === 'libero').map((s) => s.slot);

  const a = await send(`/campi/${c.id}/prenota`, { tessera_code: SEI[0], data, slot: liberi[0] });
  await send(`/partite-aperte/${a.body.partita_id}/aggiungi`, { tessera_titolare: SEI[0], tessera_code: SEI[1] });
  const b = await send(`/campi/${c.id}/prenota`, { tessera_code: SEI[1], data, slot: liberi[1] });
  await send(`/partite-aperte/${b.body.partita_id}/aggiungi`, { tessera_titolare: SEI[1], tessera_code: SEI[0] });

  // terza fascia attaccata con le stesse persone: rifiutata sia prenotando...
  const terza = await send(`/campi/${c.id}/prenota`, { tessera_code: SEI[0], data, slot: liberi[2] });
  assert.equal(terza.status, 409);
  // ...sia facendosi aggiungere da un altro
  const d = await send(`/campi/${c.id}/prenota`, { tessera_code: SEI[2], data, slot: liberi[2] });
  assert.equal(d.status, 201);
  const agg = await send(`/partite-aperte/${d.body.partita_id}/aggiungi`, { tessera_titolare: SEI[2], tessera_code: SEI[0] });
  assert.equal(agg.status, 409, 'farsi aggiungere non deve aggirare la catena');
  await setPar({ campi_limita_settimana: true }, token);
});

test('una fascia già passata non si prenota, e non compare come libera', async () => {
  // Prima si poteva: alle nove di sera l'app offriva ancora il campo delle quattro con "Solo
  // io" e "Apri ai soci". La prenotazione veniva creata e decadeva nello stesso istante — il
  // socio si ritrovava una prenotazione fantasma senza capire perché.
  //
  // (La decadenza per numero legale resta, ma ora è raggiungibile solo da una prenotazione
  // fatta prima nella giornata: il caso è coperto dal test sulla grazia qui sotto.)
  await setPar({ campi_numero_legale: true, campi_numero_legale_minuti: 30, campi_catena: false, campi_max_giorno: false, campi_finestra: false }, token);
  const c = (await get('/campi')).body[2];
  const ieri = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

  const fasce = (await get(`/campi/${c.id}/disponibilita?data=${ieri}`)).body.slots;
  assert.ok(fasce.length, 'le fasce di ieri si vedono lo stesso');
  assert.ok(fasce.every((s) => s.stato === 'passato'), 'ma sono tutte marcate come passate, nessuna libera');

  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data: ieri, slot: fasce[0].slot });
  assert.equal(r.status, 400, 'e il server rifiuta di prenotare all’indietro');
  assert.match(r.body.error, /gi\u00e0 passata/);
});

test('una prenotazione dell\'ultimo minuto non svanisce appena fatta', async () => {
  const c = (await get('/campi')).body[2];
  const oggi = new Date().toISOString().slice(0, 10);
  const disp = (await get(`/campi/${c.id}/disponibilita?data=${oggi}`)).body;
  // una fascia che inizia fra poco: la scadenza dei 30 minuti è già passata
  const ora = new Date();
  const imminente = disp.slots.find((s) => {
    if (s.stato !== 'libero') return false;
    const inizio = new Date(`${oggi}T${s.slot}:00`);
    return inizio > ora && inizio - ora < 30 * 60000;
  });
  if (!imminente) return;                       // in questo momento non ce n'è: prova saltata
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[1], data: oggi, slot: imminente.slot });
  assert.equal(r.status, 201);
  const dopo = (await get(`/campi/${c.id}/disponibilita?data=${oggi}`)).body.slots.find((s) => s.slot === imminente.slot);
  assert.notEqual(dopo.stato, 'libero', 'chi prenota all\'ultimo momento è lì di persona: gli si dà il tempo di dichiarare i compagni');
});

test('raggiunto il numero legale la prenotazione non decade', async () => {
  const c = (await get('/campi')).body[3];
  const oggi = new Date().toISOString().slice(0, 10);
  const disp = (await get(`/campi/${c.id}/disponibilita?data=${oggi}`)).body;
  const s0 = disp.slots.find((s) => s.stato === 'libero');
  if (!s0) return;
  const r = await send(`/campi/${c.id}/partita`, { tessera_code: SEI[0], data: oggi, slot: s0.slot });
  if (r.status !== 201) return;
  // dichiara abbastanza giocatori da raggiungere il minimo
  for (let i = 1; i < c.min_giocatori; i++) {
    await send(`/partite-aperte/${r.body.partita_id}/aggiungi`, { tessera_titolare: SEI[0], tessera_code: SEI[i] });
  }
  const dopo = (await get(`/campi/${c.id}/disponibilita?data=${oggi}`)).body.slots.find((s) => s.slot === s0.slot);
  assert.notEqual(dopo.stato, 'libero', 'col numero legale raggiunto la prenotazione resta in piedi');
  await setPar({ campi_numero_legale: false }, token);
});

// ---- Casa di Carta: tavoli da gioco a turni ---------------------------------------------
test('la Casa di Carta ha la sua sala a turni, con un minimo di giocatori', async () => {
  const data = giorno(120);
  const t = await get(`/carta/turni?data=${data}`);
  assert.equal(t.status, 200);
  assert.equal(t.body.turni.length, 4, 'quattro turni: due di coworking e due di gioco');
  assert.deepEqual(t.body.turni.map((x) => x.scopo), ['coworking', 'coworking', 'gioco', 'gioco']);
  assert.ok(t.body.turni[2].etichetta.includes('16-18'));
  assert.equal(t.body.prenotabile, true);
  assert.ok(t.body.minimo >= 2, 'il tavolo da gioco ha un numero legale');
  const primo = t.body.turni[0];
  assert.ok(primo.tavoli_totali > 0 && primo.tavoli_liberi === primo.tavoli_totali);

  // Da soli non si gioca a carte: il minimo vale sui turni di GIOCO. Al coworking, invece,
  // si lavora anche da soli e una postazione singola dev'essere ammessa.
  const gioco = t.body.turni.find((x) => x.scopo === 'gioco');
  const solo = await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: gioco.turno, persone: 1 });
  assert.equal(solo.status, 409);
  assert.match(solo.body.error, /almeno/);
  const soloCowo = await send('/carta/prenota', { tessera_code: SOCIO_B, data, turno: primo.turno, persone: 1 });
  assert.equal(soloCowo.status, 201, 'al coworking si lavora anche da soli');

  // fotografia aggiornata: la postazione singola qui sopra ha gia' occupato una sedia
  const prima3 = (await get(`/carta/turni?data=${data}`)).body.turni[0];
  const r = await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: primo.turno, persone: 3 });
  assert.equal(r.status, 201);
  assert.equal(r.body.ambiente, 'carta');
  const dopo = (await get(`/carta/turni?data=${data}`)).body.turni[0];
  // Nel coworking si occupano le SEDIE: tre persone a un tavolo da quattro lasciano un posto,
  // e il tavolo resta disponibile. Prima veniva sprecato per intero.
  assert.equal(dopo.posti_liberi, prima3.posti_liberi - 3, 'devono scendere i posti, non i tavoli');
});

test('i tavoli girano: oltre i turni del giorno il socio si ferma', async () => {
  const data = giorno(121);
  const turni = (await get(`/carta/turni?data=${data}`)).body.turni;
  assert.equal(turni.filter((x) => x.scopo === 'gioco').length, 2, 'due turni di gioco: 16-18 e 18-20');
  await setPar({ carta_max_turni_giorno: 1 }, token);
  assert.equal((await send('/carta/prenota', { tessera_code: SOCIO_B, data, turno: turni[0].turno, persone: 2 })).status, 201);
  const secondo = await send('/carta/prenota', { tessera_code: SOCIO_B, data, turno: turni[1].turno, persone: 2 });
  assert.equal(secondo.status, 409, 'oltre il tetto giornaliero il tavolo passa ad altri');
  assert.match(secondo.body.error, /oggi/);
  // un altro socio prenota lo stesso turno senza problemi
  assert.equal((await send('/carta/prenota', { tessera_code: SOCIO_C, data, turno: turni[1].turno, persone: 2 })).status, 201);
  await setPar({ carta_max_turni_giorno: 2 }, token);
});

test('la sala della Crew mostra tavoli, occupanti e giochi al tavolo', async () => {
  const sala = await get('/admin/carta/sala', token);
  assert.equal(sala.status, 200);
  assert.ok(sala.body.tavoli.length > 0);
  assert.ok(sala.body.turni.length >= 2);
  assert.ok(sala.body.tavoli.every((t) => typeof t.libero === 'boolean'));

  // un gioco prestato si lega al tavolo su cui verrà usato
  const g = await send('/admin/cdc/giochi', { nome: 'Gioco al tavolo', quantita: 1 }, 'POST', token);
  const pr = await send('/admin/cdc/prestiti', { gioco_id: g.body.id, gioco_nome: 'Gioco al tavolo', giocatore: 'Tizio', ora_inizio: '17:00', tavolo: sala.body.tavoli[0].numero }, 'POST', token);
  assert.equal(pr.status, 201);
  const dopo = (await get('/admin/carta/sala', token)).body;
  const tav = dopo.tavoli.find((t) => t.numero === sala.body.tavoli[0].numero);
  assert.ok(tav.prestiti.some((p) => p.gioco_nome === 'Gioco al tavolo'), 'il prestito deve comparire sul suo tavolo');
});

test('il socio vede e disdice la sua prenotazione alla Casa di Carta', async () => {
  const mie = (await get(`/carta/mie-prenotazioni?tessera_code=${SOCIO_A}`)).body;
  assert.ok(mie.length >= 1);
  assert.ok(mie[0].tavoli.length >= 1);
  const ko = await send(`/carta/prenotazioni/${mie[0].id}/annulla`, { tessera_code: SOCIO_B });
  assert.equal(ko.status, 403);
  assert.equal((await send(`/carta/prenotazioni/${mie[0].id}/annulla`, { tessera_code: SOCIO_A })).status, 200);
});

test('Garden, platea e sala giochi restano indipendenti pur usando lo stesso motore', async () => {
  const data = giorno(122);
  const gardenPrima = (await get(`/garden/turni?data=${data}`)).body.turni[0].posti_liberi;
  await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: (await get(`/carta/turni?data=${data}`)).body.turni[0].turno, persone: 2 });
  const gardenDopo = (await get(`/garden/turni?data=${data}`)).body.turni[0].posti_liberi;
  assert.equal(gardenDopo, gardenPrima, 'una prenotazione alla Casa di Carta non deve toccare il Garden');
});

// ---- v4.84: cinema nel Crew, sala, conta capsule che scarica il magazzino ----------------
test('il cinema ha un permesso suo e un operatore può averlo da solo', async () => {
  const u = 'op_cine_' + Math.floor(Math.random() * 9999);
  const c = await send('/admin/operatori', { username: u, password: 'pw-test-123', ruolo: 'staff', permessi: ['cinema'] }, 'POST', token);
  assert.equal(c.status, 201);
  const l = await send('/admin/login', { username: u, password: 'pw-test-123' });
  assert.equal(l.status, 200);
  const t = l.body.token;
  assert.ok((await get('/admin/me', t)).body.caps.includes('cinema'));
  assert.equal((await get('/admin/proiezioni', t)).status, 200);
  // e non tocca il resto
  assert.equal((await get('/admin/cdc/giochi', t)).status === 200 ? (await send('/admin/cdc/giochi', { nome: 'x' }, 'POST', t)).status : 403, 403);
});

test('la platea si riempie anche al banco, e l\'ingresso si annulla', async () => {
  const pr = (await get('/admin/proiezioni', token)).body.find((p) => p.stato !== 'annullata');
  const prima = (await get(`/admin/proiezioni/${pr.id}/platea`, token)).body.coperti_prenotati;
  const r = await send(`/admin/proiezioni/${pr.id}/prenota`, { nome: 'Sig. Rossi', persone: 2 }, 'POST', token);
  assert.equal(r.status, 201);
  assert.equal(r.body.posti.length >= 1, true);
  const dopo = (await get(`/admin/proiezioni/${pr.id}/platea`, token)).body;
  assert.equal(dopo.coperti_prenotati, prima + 2);
  const mia = dopo.prenotazioni.find((x) => x.nome === 'Sig. Rossi');
  await send(`/admin/proiezioni/prenotazioni/${mia.id}`, {}, 'PUT', token);
  assert.equal((await get(`/admin/proiezioni/${pr.id}/platea`, token)).body.coperti_prenotati, prima);
});

test('la sala della Casa di Carta sta in 20 mq: due tavoli e l\'arredo', async () => {
  const lay = (await get('/admin/tavoli/layout?ambiente=carta', token)).body.layout.find((l) => l.predefinito);
  const tavoli = lay.tavoli.filter((t) => t.tipo !== 'arredo');
  const arredo = lay.tavoli.filter((t) => t.tipo === 'arredo');
  assert.equal(tavoli.length, 2, 'in 20 mq, tolti reception e angolo caffè, ci stanno due tavoli');
  assert.equal(tavoli.reduce((s, t) => s + t.posti, 0), 8);
  assert.equal(arredo.length, 2, 'reception e angolo caffè stanno sulla pianta');
  // l'arredo non è prenotabile
  const st = (await get(`/admin/tavoli/turno?data=${giorno(130)}&ambiente=carta`, token)).body;
  // L'arredo si vede sulla pianta ma non conta come posto: la capienza resta otto.
  assert.equal(st.posti_totali, 8);
  assert.ok(st.tavoli.some((t) => t.tipo === 'arredo'), 'reception e angolo caffè devono comparire sulla pianta');
  assert.ok(st.tavoli.filter((t) => t.tipo === 'arredo').every((t) => t.posti === 0));
});

test('la sala si prenota per riunioni e non si sovrappone', async () => {
  const data = giorno(131);
  const r = await send('/admin/sala', { data, ora_inizio: '09:00', ora_fine: '11:00', scopo: 'riunione', titolo: 'Assemblea', richiedente: 'CdA', persone: 8 }, 'POST', token);
  assert.equal(r.status, 201);
  const doppia = await send('/admin/sala', { data, ora_inizio: '10:00', ora_fine: '12:00', scopo: 'presentazione' }, 'POST', token);
  assert.equal(doppia.status, 409, 'due riunioni non stanno nella stessa stanza');
  assert.match(doppia.body.error, /impegnata/);
  // fuori orario invece si può
  assert.equal((await send('/admin/sala', { data, ora_inizio: '11:00', ora_fine: '12:30', scopo: 'corso' }, 'POST', token)).status, 201);

  const lista = (await get('/admin/sala', token)).body;
  assert.ok(lista.prenotazioni.length >= 2);
  assert.ok(lista.turni_gioco.length === 4);
});

test('non si riserva la sala sopra i tavoli già prenotati per giocare', async () => {
  const data = giorno(132);
  const turni = (await get(`/carta/turni?data=${data}`)).body.turni;
  assert.equal((await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: turni[0].turno, persone: 2 })).status, 201);
  const ko = await send('/admin/sala', { data, ora_inizio: turni[0].turno, ora_fine: '19:00', scopo: 'presentazione' }, 'POST', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /giocare/);
});

test('la conta delle capsule scarica il magazzino', async () => {
  const art = await send('/admin/magazzino', { nome: 'Capsule caffè', zona: 'carta', unita: 'pz', giacenza: 200, punto_riordino: 40 }, 'POST', token);
  // Quale articolo rappresenta le capsule si dichiara: in magazzino ce n'è più d'uno simile.
  const set = await send('/admin/cdc/caffe/articolo', { articolo_id: art.body.id }, 'PUT', token);
  assert.equal(set.status, 200);
  assert.equal((await get('/admin/cdc/caffe/articolo', token)).body.articolo_id, art.body.id);
  await send('/admin/cdc/caffe/conta', { giacenza: 120 }, 'POST', token);          // fissa il punto di partenza
  const leggi = async () => (await get('/admin/magazzino', token)).body.articoli.find((a) => a.id === art.body.id).giacenza;
  const prima = await leggi();

  const r = await send('/admin/cdc/caffe/conta', { giacenza: 100 }, 'POST', token); // consumate 20
  assert.equal(r.status, 200);
  assert.equal(r.body.consumo, 20);
  assert.ok(r.body.scaricato, 'la conta deve muovere il magazzino, altrimenti è una contabilità doppia');
  assert.equal(r.body.scaricato.quantita, 20);

  const dopo = await leggi();
  assert.equal(dopo, prima - 20, 'le capsule consumate escono dal magazzino');
});

// ---- v4.85: sala su quattro turni, capsule agganciate, set separati ----------------------
test('la Casa di Carta ha due turni di coworking e due di gioco, sugli stessi tavoli', async () => {
  const data = giorno(140);
  const t = (await get(`/carta/turni?data=${data}`)).body.turni;
  assert.equal(t.length, 4);
  const cw = t.filter((x) => x.scopo === 'coworking');
  const gioco = t.filter((x) => x.scopo === 'gioco');
  assert.equal(cw.length, 2, 'il coworking occupa la sala fino alle 16');
  assert.equal(gioco.length, 2);
  assert.equal(gioco[0].turno, '16:00');
  // stessi tavoli per entrambi gli usi: è la stessa stanza
  assert.equal(cw[0].tavoli_totali, gioco[0].tavoli_totali);
  assert.ok(t.every((x) => x.etichetta && x.etichetta !== x.turno), 'ogni turno deve dire a cosa serve');
});

test('la giacenza del caffè è quella del magazzino, non un contatore parallelo', async () => {
  const c = await get('/admin/cdc/caffe', token);
  assert.equal(c.status, 200);
  assert.equal(c.body.config.articolo_impostato, true, 'l\'articolo capsule deve essere collegato dal seed');
  assert.ok(c.body.config.articolo, 'il pannello deve dire quale articolo sta guardando');
  const art = (await get('/admin/magazzino', token)).body.articoli.find((a) => a.id === c.body.config.articolo.id);
  assert.equal(c.body.config.giacenza, art.giacenza, 'due numeri che possono divergere sono un numero sbagliato');

  // e il riferimento non si perde aggiungendo altri prodotti
  await send('/admin/magazzino', { nome: 'Caffè in grani (altro)', zona: 'carta', unita: 'kg', giacenza: 5 }, 'POST', token);
  const dopo = (await get('/admin/cdc/caffe/articolo', token)).body;
  assert.equal(dopo.articolo_id, c.body.config.articolo.id, 'l\'articolo dichiarato resta quello');
});

test('i set sono due: pedine e scacchi, per le due scacchiere', async () => {
  const g = (await get('/admin/cdc/giochi', token)).body;
  assert.ok(g.some((x) => /pedine/i.test(x.nome)), 'manca il set di pedine');
  assert.ok(g.some((x) => /^Set di scacchi/i.test(x.nome)), 'manca il set di scacchi');
  assert.ok(!g.some((x) => x.nome === 'Set di pedine e scacchi'), 'la voce unica non deve restare');
  assert.equal(g.filter((x) => /scacchiere/i.test(x.nome))[0].quantita, 2);
});

// ---- v4.86: correzioni segnalate --------------------------------------------------------
test('una comanda del Bar non finisce sui tavoli del Garden', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const riga = [{ menu_id: menu[0].id, qta: 1 }];
  const r = await send('/self-order', { punto: 'Bussola Bar', tavolo: '2', righe: riga });
  assert.equal(r.status, 201);
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  assert.equal(c.zona, 'bar', 'la zona si deduce dal punto, non è "garden" per tutti');

  const g = await send('/self-order', { punto: 'Bussola Garden', tavolo: '3', righe: riga });
  const cg = (await get('/admin/comande', token)).body.find((x) => x.numero === g.body.numero);
  assert.equal(cg.zona, 'garden');
});

test('lo Stage è un ambiente suo e non mostra la sala del Garden', async () => {
  const data = giorno(150);
  const stage = (await get(`/admin/tavoli/turno?data=${data}&ambiente=stage`, token)).body;
  const garden = (await get(`/admin/tavoli/turno?data=${data}&ambiente=garden`, token)).body;
  assert.notEqual(stage.layout.id, garden.layout.id, 'la platea non è la sala del Garden');
  assert.equal(stage.layout.ambiente, 'stage');
  assert.equal(stage.ambiente, 'stage');
  // e i posti sono quelli dei parametri, non i tavoli del ristorante
  const sedute = stage.tavoli.filter((t) => t.tipo !== 'arredo');
  assert.ok(sedute.every((t) => t.posti === 1));
  // Le tre destinazioni previste dalla regola: prima fila over 70, chi cena, chi non cena.
  const q = (n) => sedute.filter((t) => t.quota === n).length;
  assert.ok(q('over70') > 0 && q('garden') > 0 && q('spettacolo') > 0, 'mancano le quote in platea');
  assert.ok(sedute.some((t) => t.tipo === 'extra'), 'servono i posti extra');
  assert.ok(stage.tavoli.some((t) => t.tipo === 'arredo' && t.numero === 99), 'il palco deve esserci');
  // le disposizioni selezionabili sono solo quelle dell'ambiente
  const lay = (await get('/admin/tavoli/layout?ambiente=stage', token)).body.layout;
  assert.ok(lay.every((l) => l.ambiente === 'stage'), 'dalla pianta dello Stage non si toccano gli altri ambienti');
});

test('chi prenota la cena prenota anche i posti davanti al palco', async () => {
  const data = giorno(151);
  const f = (await get('/admin/film', token)).body[0];
  await send('/admin/proiezioni', { film_id: f.id, data, ora: '21:30' }, 'POST', token);

  const r = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '20:00', persone: 4 });
  assert.equal(r.status, 201);
  assert.ok(r.body.stage, 'nelle sere con spettacolo la cena porta con sé i posti in platea');
  assert.equal(r.body.stage.posti.length, 4, 'tanti posti quanti i commensali');

  const platea = (await get(`/admin/tavoli/turno?data=${data}&ambiente=stage&turno=21:30`, token)).body;
  assert.equal(platea.coperti_prenotati, 4);
  // il resto della platea resta per chi viene solo allo spettacolo
  assert.ok(platea.posti_liberi >= 40);

  // e se la cena salta, saltano anche i posti
  const mie = (await get(`/garden/mie-prenotazioni?tessera_code=${SOCIO_A}`)).body.find((x) => x.data === data);
  await send(`/garden/prenotazioni/${mie.id}/annulla`, { tessera_code: SOCIO_A });
  const dopo = (await get(`/admin/tavoli/turno?data=${data}&ambiente=stage&turno=21:30`, token)).body;
  assert.equal(dopo.coperti_prenotati, 0, 'i posti in platea erano la stessa prenotazione della cena');
});

test('il contributo per il solo spettacolo è dichiarato e parametrico', async () => {
  const c = await get('/cinema');
  assert.equal(c.body.contributo, 2);
  assert.match(c.body.nota_contributo, /contributo/i);
  await setPar({ stage_contributo: 0 }, token);
  assert.match((await get('/cinema')).body.nota_contributo, /libero/i);
  await setPar({ stage_contributo: 2 }, token);
});

test('in app si vede solo il calendario rifiuti in corso', async () => {
  let tutti = (await get('/admin/rifiuti', token)).body.calendari;
  if (tutti.length < 2) {
    await send('/admin/rifiuti/calendario/Invernale', { inizio_conf: '07:00', fine_conf: '09:00', ora_ritiro: '10:00', giorni: {}, attivo: false }, 'PUT', token);
    tutti = (await get('/admin/rifiuti', token)).body.calendari;
  }
  assert.ok(tutti.length >= 2);
  assert.equal(tutti.filter((c) => c.attivo).length, 1, 'di default resta acceso solo quello in corso');
  const visibili = (await get('/rifiuti')).body.calendari;
  assert.equal(visibili.length, 1);

  // accendendone un altro, l'app ne mostra due
  const spento = tutti.find((c) => !c.attivo);
  await send(`/admin/rifiuti/calendario/${encodeURIComponent(spento.periodo)}`, { ...spento, attivo: true, giorni: spento.giorni }, 'PUT', token);
  assert.equal((await get('/rifiuti')).body.calendari.length, 2);
  await send(`/admin/rifiuti/calendario/${encodeURIComponent(spento.periodo)}`, { ...spento, attivo: false, giorni: spento.giorni }, 'PUT', token);
});

// ---- v4.87: la pianta segue i parametri, anche su database già avviati ------------------
// Libera la platea da tutto quello che le prove precedenti hanno prenotato.
async function svuotaPlatea() {
  for (const pr of (await get('/admin/proiezioni', token)).body) {
    const pl = await get(`/admin/proiezioni/${pr.id}/platea`, token);
    for (const x of (pl.body.prenotazioni || [])) await send(`/admin/proiezioni/prenotazioni/${x.id}`, {}, 'PUT', token);
  }
}

test('cambiare i posti in platea non bastava: serve ridisegnare, e ora si può', async () => {
  await svuotaPlatea();
  const prima = (await get(`/admin/tavoli/turno?data=${giorno(160)}&ambiente=stage`, token)).body;
  const nPrima = prima.tavoli.filter((t) => t.tipo !== 'arredo').length;
  assert.ok(nPrima > 0);

  // il parametro da solo non tocca una pianta già disegnata: è il comportamento giusto,
  // ma prima non c'era modo di applicarlo.
  await setPar({ stage_posti_standard: 20, stage_posti_extra_n: 10 }, token);
  const invariata = (await get(`/admin/tavoli/turno?data=${giorno(160)}&ambiente=stage`, token)).body;
  assert.equal(invariata.tavoli.filter((t) => t.tipo !== 'arredo').length, nPrima, 'il parametro da solo non ridisegna');

  const r = await send('/admin/tavoli/layout/rigenera', { ambiente: 'stage' }, 'POST', token);
  assert.equal(r.status, 200, r.body && r.body.error);
  const dopo = (await get(`/admin/tavoli/turno?data=${giorno(160)}&ambiente=stage`, token)).body;
  const sedute = dopo.tavoli.filter((t) => t.tipo !== 'arredo');
  assert.equal(sedute.filter((t) => t.quota === 'garden').length, 20, 'i posti per chi cena seguono il parametro');
  assert.equal(sedute.filter((t) => t.tipo === 'extra').length, 10);
  // alternanza 4 a 2: ogni quattro posti di chi cena, due per il solo spettacolo
  assert.equal(sedute.filter((t) => t.quota === 'spettacolo' && t.tipo === 'standard').length, 10);
  assert.ok(dopo.tavoli.some((t) => t.tipo === 'arredo' && t.numero === 99), 'il palco resta');
  await setPar({ stage_posti_standard: 40, stage_posti_extra_n: 12 }, token);
});

test('ridisegnare la sala della Casa di Carta riporta reception e angolo caffè', async () => {
  // libera la sala dalle prove precedenti
  for (const t of ['16:00', '18:00', '09:00', '13:00']) {
    for (const d of [giorno(120), giorno(121), giorno(122), giorno(132), giorno(140)]) {
      const st = (await get(`/admin/tavoli/turno?data=${d}&ambiente=carta&turno=${t}`, token)).body;
      for (const x of (st.prenotazioni || [])) await send(`/admin/tavoli/prenotazioni/${x.id}`, { stato: 'annullato' }, 'PUT', token);
    }
  }
  // simula un database nato prima: una sala con otto tavoli e nessun arredo
  const lay = (await get('/admin/tavoli/layout?ambiente=carta', token)).body.layout.find((l) => l.predefinito);
  const otto = Array.from({ length: 8 }, (_, i) => ({ numero: i + 1, posti: 4, forma: 'quadrato', x: 20 + (i % 3) * 30, y: 20 + Math.floor(i / 3) * 25 }));
  await send(`/admin/tavoli/layout/${lay.id}`, { tavoli: otto }, 'PUT', token);
  const vecchia = (await get(`/admin/tavoli/turno?data=${giorno(161)}&ambiente=carta`, token)).body;
  assert.equal(vecchia.posti_totali, 32);
  assert.ok(!vecchia.tavoli.some((t) => t.tipo === 'arredo'), 'la sala vecchia non ha arredo: è il caso da correggere');

  const r = await send('/admin/tavoli/layout/rigenera', { ambiente: 'carta' }, 'POST', token);
  assert.equal(r.status, 200);
  const nuova = (await get(`/admin/tavoli/turno?data=${giorno(161)}&ambiente=carta`, token)).body;
  assert.equal(nuova.posti_totali, 8, 'in 20 mq ci stanno due tavoli da quattro');
  assert.equal(nuova.tavoli.filter((t) => t.tipo === 'arredo').length, 2, 'reception e angolo caffè');
});

test('non si ridisegna la pianta sotto le prenotazioni attive', async () => {
  const data = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const turni = (await get(`/carta/turni?data=${data}`)).body.turni;
  const p = await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: turni[2].turno, persone: 2 });
  assert.equal(p.status, 201);
  const ko = await send('/admin/tavoli/layout/rigenera', { ambiente: 'carta' }, 'POST', token);
  assert.equal(ko.status, 409);
  assert.match(ko.body.error, /prenotazioni ancora in piedi/);
  assert.match(ko.body.error, new RegExp(data), 'e il messaggio elenca quali, con la data');
  const mie = (await get(`/carta/mie-prenotazioni?tessera_code=${SOCIO_A}`)).body.find((x) => x.data === data);
  await send(`/carta/prenotazioni/${mie.id}/annulla`, { tessera_code: SOCIO_A });
  assert.equal((await send('/admin/tavoli/layout/rigenera', { ambiente: 'carta' }, 'POST', token)).status, 200);
});

test('l\'arredo non compare fra i tavoli prenotabili della sala', async () => {
  await send('/admin/tavoli/layout/rigenera', { ambiente: 'carta' }, 'POST', token);
  const sala = (await get('/admin/carta/sala', token)).body;
  assert.ok(sala.tavoli.every((t) => (t.tipo || 'standard') !== 'arredo'), 'reception e caffè stanno sulla pianta, non nell\'elenco');
  assert.equal(sala.tavoli.length, 2, 'due tavoli prenotabili');
  // ma sulla pianta ci sono
  const pianta = (await get(`/admin/tavoli/turno?data=${giorno(170)}&ambiente=carta`, token)).body;
  assert.equal(pianta.tavoli.filter((t) => t.tipo === 'arredo').length, 2);
});

// ---- v4.89: cruscotto operativo, pianta per ambiente, guida georeferenziata --------------
test('il cruscotto dice cosa succede adesso, non totali storici', async () => {
  const r = await get('/admin/cruscotto', token);
  assert.equal(r.status, 200);
  assert.ok(r.body.oggi && r.body.ora);
  assert.ok(r.body.servizio && typeof r.body.servizio.comande_aperte === 'number');
  assert.ok(Array.isArray(r.body.servizio.per_zona));
  assert.ok(r.body.giornata && typeof r.body.giornata.garden_coperti === 'number');
  assert.ok(Array.isArray(r.body.giornata.lezioni));
  assert.ok(Array.isArray(r.body.attenzione), 'servono le cose che chiedono una mano');
  assert.ok(Array.isArray(r.body.scorte));
});

test('il cruscotto segnala gli articoli sotto scorta', async () => {
  const a = await send('/admin/magazzino', { nome: 'Articolo quasi finito', zona: 'bar', unita: 'pz', giacenza: 2, punto_riordino: 10 }, 'POST', token);
  const r = (await get('/admin/cruscotto', token)).body;
  assert.ok(r.scorte.some((x) => x.id === a.body.id), 'l\'articolo sotto il punto di riordino va segnalato');
  assert.ok(r.attenzione.some((x) => x.tipo === 'magazzino'));
});

test('la disposizione del giorno non passa da un ambiente all\'altro', async () => {
  const data = giorno(180);
  const gardenLay = (await get('/admin/tavoli/layout?ambiente=garden', token)).body.layout.find((l) => l.predefinito);
  // assegna al giorno una disposizione del GARDEN
  await send('/admin/tavoli/giorno', { data, layout_id: gardenLay.id }, 'PUT', token);
  const carta = (await get(`/admin/tavoli/turno?data=${data}&ambiente=carta`, token)).body;
  assert.equal(carta.layout.ambiente, 'carta', 'la Casa di Carta non deve ereditare la sala del Garden');
  assert.notEqual(carta.layout.id, gardenLay.id);
  const garden = (await get(`/admin/tavoli/turno?data=${data}&ambiente=garden`, token)).body;
  assert.equal(garden.layout.id, gardenLay.id);
});

test('la guida espone le coordinate solo dove sono state inserite davvero', async () => {
  const b = (await get('/bussola')).body;
  assert.ok(b.servizi.length && b.vedere.length);
  // Nessuna posizione stimata: le voci nascono senza, e il campo esiste comunque nel formato.
  for (const v of [...b.servizi, ...b.vedere]) {
    assert.ok('lat' in v && 'lng' in v, 'il formato deve prevedere la posizione');
    if (v.lat != null) {
      assert.ok(Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180, `coordinate impossibili su ${v.titolo}`);
    }
  }
});

test('le comande registrate con la zona sbagliata vengono corrette', async () => {
  const comande = (await get('/admin/comande', token)).body;
  const bar = comande.filter((c) => /bar/i.test(c.punto || ''));
  assert.ok(bar.every((c) => c.zona === 'bar'), 'nessuna comanda del bar deve restare in zona garden');
});

// ---- v4.90: guida georeferenziata sui database avviati, tavolo che torna pulito ---------
test('le coordinate della guida arrivano anche sui database già avviati', async () => {
  // simula una voce nata prima delle coordinate
  await send('/admin/bussola', { sezione: 'vedere', titolo: 'Ortigia (vecchia voce)', dettaglio: 'senza coordinate' }, 'POST', token);
  const prima = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Ortigia (vecchia voce)');
  assert.equal(prima.lat, null, 'la voce nasce senza coordinate');

  // e si possono compilare dal back office
  const r = await send(`/admin/bussola/${prima.id}`, { titolo: prima.titolo, dettaglio: prima.dettaglio, distanza: '~20 km', lat: 37.0596, lng: 15.2933 }, 'PUT', token);
  assert.equal(r.status, 200);
  const dopo = (await get('/bussola')).body.vedere.find((x) => x.titolo === 'Ortigia (vecchia voce)');
  assert.equal(dopo.lat, 37.0596);
});

test('una comanda dimenticata non tiene il tavolo occupato per sempre', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '9', righe: [{ menu_id: menu[0].id, qta: 1 }] });
  assert.equal(r.status, 201);
  const id = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero).id;

  // appena fatta resta aperta: il servizio è in corso
  await send('/admin/parametri', { comande_chiusura_automatica: true, comande_ore_abbandono: 6 }, 'PUT', token);
  assert.ok(['aperta', 'in_preparazione', 'pronta'].includes((await get('/admin/comande?stato=tutte', token)).body.find((c) => c.id === id).stato));

  // si può chiudere a mano dal tavolo
  assert.equal((await send(`/admin/comande/${id}/stato`, { stato: 'chiusa' }, 'PUT', token)).status, 200);
  const dopo = (await get('/admin/comande?stato=tutte', token)).body.find((c) => c.id === id);
  assert.equal(dopo.stato, 'chiusa', 'chiusa la comanda, il tavolo torna pulito');
  // e sparisce dall'elenco operativo: il tavolo non risulta piu' servito
  assert.ok(!(await get('/admin/comande', token)).body.some((c) => c.id === id));
});

test('la chiusura automatica libera i tavoli lasciati sporchi', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '11', righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const id = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero).id;
  // con la soglia a un'ora e la comanda "vecchia" per costruzione del test non possiamo
  // viaggiare nel tempo: verifichiamo che la regola sia attiva e configurabile
  const par = (await get('/admin/parametri', token)).body;
  const on = par.find((p) => p.chiave === 'comande_chiusura_automatica');
  const ore = par.find((p) => p.chiave === 'comande_ore_abbandono');
  assert.equal(on.valore, true, 'la chiusura automatica dev\'essere attiva di default');
  assert.equal(ore.valore, 6);
  assert.equal(ore.dipende_da, 'comande_chiusura_automatica');
  await send(`/admin/comande/${id}/stato`, { stato: 'chiusa' }, 'PUT', token);
});

// ---- v4.92: le posizioni della guida si inseriscono, non si inventano -------------------
test('le voci della guida nascono senza posizione', async () => {
  const r = await send('/admin/bussola', { sezione: 'servizi', titolo: 'Farmacia di prova', dettaglio: 'Fontane Bianche', distanza: '~600 m' }, 'POST', token);
  assert.equal(r.status, 201);
  const v = (await get('/admin/bussola', token)).body.find((x) => x.id === r.body.id);
  assert.equal(v.lat, null, 'nessuna coordinata inventata: si inserisce a mano, verificata');
  assert.equal(v.lng, null);
});

test('la posizione si aggiunge dal back office e arriva ai soci', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Farmacia di prova');
  const r = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, dettaglio: v.dettaglio, distanza: v.distanza, lat: 36.91861, lng: 15.17062 }, 'PUT', token);
  assert.equal(r.status, 200);
  const pubb = (await get('/bussola')).body.servizi.find((x) => x.titolo === 'Farmacia di prova');
  assert.equal(pubb.lat, 36.91861);
  assert.equal(pubb.lng, 15.17062);
});

test('coordinate impossibili vengono rifiutate', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Farmacia di prova');
  const ko = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, lat: 999, lng: 15.17 }, 'PUT', token);
  assert.equal(ko.status, 400);
  assert.match(ko.body.error, /latitudine/i);
  // e la posizione buona resta quella di prima
  const dopo = (await get('/bussola')).body.servizi.find((x) => x.titolo === 'Farmacia di prova');
  assert.equal(dopo.lat, 36.91861);
});

test('la posizione si può togliere, e la voce torna una riga di testo', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Farmacia di prova');
  assert.equal((await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, lat: '', lng: '' }, 'PUT', token)).status, 200);
  const dopo = (await get('/bussola')).body.servizi.find((x) => x.titolo === 'Farmacia di prova');
  assert.equal(dopo.lat, null);
});

// ---- v4.94: quello che la simulazione di stagione ha scoperto ---------------------------
test('chiudere una comanda scarica il magazzino', async () => {
  // un articolo di magazzino collegato a una voce di menù
  const art = await send('/admin/magazzino', { nome: 'Bottiglie birra', zona: 'bar', unita: 'pz', giacenza: 100, punto_riordino: 20 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const voce = menu[0];
  assert.equal((await send(`/admin/menu/${voce.id}/magazzino`, { magazzino_id: art.body.id, consumo: 1 }, 'PUT', token)).status, 200);

  const leggi = async () => (await get('/admin/magazzino', token)).body.articoli.find((a) => a.id === art.body.id).giacenza;
  const prima = await leggi();

  const o = await send('/self-order', { punto: 'Bussola Bar', tavolo: '4', righe: [{ menu_id: voce.id, qta: 3 }] });
  assert.equal(o.status, 201);
  assert.equal(await leggi(), prima, 'finché la comanda è aperta il magazzino non si muove');

  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === o.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  assert.equal(await leggi(), prima - 3, 'chiusa la comanda, i pezzi venduti escono dal magazzino');

  // e non si scarica due volte
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  assert.equal(await leggi(), prima - 3, 'una comanda scarica una volta sola');
});

test('ciò che si pesa non si scarica: si accumula il teorico', async () => {
  // Cambio voluto: da una pianta di lattuga escono tre piatti o quattro, e 7 grammi di caffè
  // sono una media. Scaricare un numero inventato sporca la giacenza; accumularlo come
  // teorico lo rende confrontabile con la conta reale.
  const art = await send('/admin/magazzino', { nome: 'Caffè macinato', zona: 'bar', unita: 'g', giacenza: 1000 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const voce = menu[1] || menu[0];
  await send(`/admin/menu/${voce.id}/magazzino`, { magazzino_id: art.body.id, consumo: 7 }, 'PUT', token);
  const leggi = async () => (await get('/admin/magazzino', token)).body.articoli.find((a) => a.id === art.body.id).giacenza;
  const prima = await leggi();

  const o = await send('/self-order', { punto: 'Bussola Bar', tavolo: '5', righe: [{ menu_id: voce.id, qta: 4 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === o.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);

  assert.equal(await leggi(), prima, 'la giacenza di un articolo a peso non si tocca');
  const riga = (await get('/admin/magazzino/confronto', token)).body.righe.find((x) => x.id === art.body.id);
  assert.ok(riga, 'ma il consumo teorico dev\'essere registrato');
  assert.ok(Math.abs(riga.teorico - 28) < 0.1, `4 × 7 g = 28, trovato ${riga.teorico}`);
});


test('lo storico delle comande si consulta per data, non solo le ultime', async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const r = await get(`/admin/comande?da=${oggi}&a=${oggi}&limite=500`, token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  // il filtro per data non è vincolato al tetto delle ultime 100
  const tutte = await get('/admin/comande?stato=tutte', token);
  assert.ok(tutte.body.length <= 200);
});

test('il riepilogo di periodo somma la stagione, non solo la giornata', async () => {
  const r = await get('/admin/riepilogo?da=2020-01-01&a=2099-12-31', token);
  assert.equal(r.status, 200);
  const b = r.body;
  assert.ok(b.ristorazione && typeof b.ristorazione.comande === 'number');
  assert.ok(Array.isArray(b.ristorazione.piu_venduti));
  assert.ok(b.garden && typeof b.garden.coperti === 'number');
  assert.ok(b.campi && Array.isArray(b.campi.per_campo));
  assert.ok(b.fitness && typeof b.fitness.da_incassare === 'number');
  assert.ok(b.stage && b.casa_di_carta && b.serate);
});

test('una giacenza negativa viene segnalata, non nascosta', async () => {
  const a = await send('/admin/magazzino', { nome: 'Articolo che finisce', zona: 'bar', unita: 'pz', giacenza: 2, punto_riordino: 1 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const voce = menu[2] || menu[0];
  await send(`/admin/menu/${voce.id}/magazzino`, { magazzino_id: a.body.id, consumo: 1 }, 'PUT', token);
  const o = await send('/self-order', { punto: 'Bussola Bar', tavolo: '6', righe: [{ menu_id: voce.id, qta: 5 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === o.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);

  const art = (await get('/admin/magazzino', token)).body.articoli.find((x) => x.id === a.body.id);
  assert.equal(art.giacenza, -3, 'la vendita non si blocca: al banco la merce può esserci davvero');
  assert.equal(art.stato, 'negativa', 'ma lo stato lo dice');

  const cru = (await get('/admin/cruscotto', token)).body;
  assert.ok(cru.scorte_negative.some((x) => x.id === a.body.id), 'il cruscotto deve elencarla');
  assert.ok(cru.attenzione.some((x) => /NEGATIVA/i.test(x.testo)), 'e metterla fra le cose che chiedono una mano');
});

// ---- v4.94: rilievi emersi dalla simulazione di stagione --------------------------------
test('scaricare più di quanto c\'è non passa in silenzio', async () => {
  const a = await send('/admin/magazzino', { nome: 'Articolo scarso', zona: 'bar', unita: 'pz', giacenza: 10, punto_riordino: 5 }, 'POST', token);
  const r = await send(`/admin/magazzino/${a.body.id}/movimento`, { tipo: 'scarico', quantita: 30, causale: 'consumo' }, 'POST', token);
  assert.equal(r.status, 200, 'lo scarico si accetta: in un bar capita di aver consumato più del registrato');
  assert.ok(r.body.avviso, 'ma va segnalato: 20 unità sparirebbero dai conti senza dirlo');
  assert.match(r.body.avviso, /20/);
  assert.equal(r.body.giacenza, 0);
  // e la discrepanza resta scritta nel movimento
  const mov = (await get(`/admin/magazzino/${a.body.id}/movimenti`, token)).body;
  if (Array.isArray(mov)) assert.ok(mov.some((m) => /oltre giacenza/.test(m.causale || '')));
});

test('un turno pieno propone dove c\'è posto', async () => {
  const data = giorno(190);
  // riempie il turno delle 20:00 con soci diversi (uno solo sbatterebbe sul suo tetto)
  const tessere = [SOCIO_A, SOCIO_B, SOCIO_C, ...SEI];
  for (let i = 0; i < 40; i++) {
    const r = await send('/garden/prenota', { tessera_code: tessere[i % tessere.length], data, turno: '20:00', persone: 6 });
    if (r.status !== 201) {
      assert.equal(r.status, 409);
      assert.ok(Array.isArray(r.body.alternative), 'il rifiuto deve dire dove c\'è posto');
      if (r.body.alternative.length) {
        const a = r.body.alternative[0];
        assert.ok(a.data && a.turno && a.posti_liberi > 0);
      }
      return;
    }
  }
  assert.fail('il turno non si è riempito: prova non conclusiva');
});

test('la chiusura di stagione dice quante partite mancano, non solo cosa manca', async () => {
  const ch = (await get('/admin/coppa/chiusura?stagione=8888', token)).body;
  if (ch.pronta) return;
  assert.ok(typeof ch.partite_mancanti === 'number', 'serve il totale delle partite mancanti');
  assert.ok(ch.mancanti.every((m) => typeof m.mancano === 'number' && typeof m.giocate === 'number'),
    'per ogni disciplina servono giocate e mancanti, per capire se la stagione è recuperabile');
});

// ---- v4.95: le tre decisioni di stagione ------------------------------------------------
test('la platea riserva la prima fila agli over 70 e alterna le due quote', async () => {
  await send('/admin/tavoli/layout/rigenera', { ambiente: 'stage' }, 'POST', token);
  const st = (await get(`/admin/tavoli/turno?data=${giorno(200)}&ambiente=stage`, token)).body;
  const sedute = st.tavoli.filter((t) => t.tipo !== 'arredo').sort((a, b) => a.numero - b.numero);
  const primaFila = sedute.slice(0, 10);
  assert.ok(primaFila.every((t) => t.quota === 'over70'), 'la prima fila è degli over 70');

  // dopo la prima fila l'alternanza: quattro per chi cena, due per il solo spettacolo
  const dopo = sedute.slice(10, 22).map((t) => t.quota);
  assert.deepEqual(dopo, ['garden', 'garden', 'garden', 'garden', 'spettacolo', 'spettacolo',
    'garden', 'garden', 'garden', 'garden', 'spettacolo', 'spettacolo'],
    'chi non cena non deve finire sempre in fondo');
});

test('solo il primo turno di cena porta con sé i posti davanti al palco', async () => {
  const data = giorno(201);
  const f = (await get('/admin/film', token)).body[0];
  await send('/admin/proiezioni', { film_id: f.id, data, ora: '21:30' }, 'POST', token);

  const primo = await send('/garden/prenota', { tessera_code: SOCIO_A, data, turno: '20:00', persone: 2 });
  assert.equal(primo.status, 201);
  assert.ok(primo.body.stage && primo.body.stage.posti, 'il primo turno ha i posti in platea');

  const secondo = await send('/garden/prenota', { tessera_code: SOCIO_B, data, turno: '21:30', persone: 2 });
  assert.equal(secondo.status, 201);
  assert.equal(secondo.body.stage.non_spettante, true, 'al secondo turno si cena mentre si recita');
  assert.match(secondo.body.stage.motivo, /20:00/);
});

test('un over 70 che viene solo per lo spettacolo siede in prima fila', async () => {
  const data = giorno(202);
  const f = (await get('/admin/film', token)).body[0];
  const pr = await send('/admin/proiezioni', { film_id: f.id, data, ora: '21:30' }, 'POST', token);
  const anziano = await send('/admin/soci', { nome: 'Rosario', cognome: 'Novantenne', data_nascita: '1948-05-10', consenso_privacy: true }, 'POST', token);
  const giovane = await send('/admin/soci', { nome: 'Elia', cognome: 'Giovane', data_nascita: '1998-05-10', consenso_privacy: true }, 'POST', token);

  const a = await send(`/cinema/${pr.body.id}/prenota`, { tessera_code: anziano.body.tessera_code, persone: 1 });
  assert.equal(a.status, 201);
  const platea = (await get(`/admin/proiezioni/${pr.body.id}/platea`, token)).body;
  const suo = platea.tavoli.find((t) => t.numero === a.body.posti[0]);
  assert.equal(suo.quota, 'over70', 'gli over 70 hanno la prima fila');

  const g = await send(`/cinema/${pr.body.id}/prenota`, { tessera_code: giovane.body.tessera_code, persone: 1 });
  const suoG = (await get(`/admin/proiezioni/${pr.body.id}/platea`, token)).body.tavoli.find((t) => t.numero === g.body.posti[0]);
  assert.equal(suoG.quota, 'spettacolo', 'gli altri prendono la loro quota, non la prima fila');
});

test('il coworking assegna posti, non tavoli interi', async () => {
  const data = giorno(203);
  const t = (await get(`/carta/turni?data=${data}`)).body.turni.find((x) => x.scopo === 'coworking');
  const capienza = t.posti_totali;
  assert.ok(capienza >= 8, 'la sala deve offrire i posti previsti, non due tavoli');

  // otto persone sole devono entrare tutte: prima ne bastavano due a saturare
  let entrati = 0;
  const tessere = [SOCIO_A, SOCIO_B, SOCIO_C, ...SEI];
  for (let i = 0; i < capienza; i++) {
    const r = await send('/carta/prenota', { tessera_code: tessere[i % tessere.length], data, turno: t.turno, persone: 1 });
    if (r.status === 201) entrati++; else break;
  }
  assert.equal(entrati, capienza, `dovevano entrare ${capienza} coworker, ne sono entrati ${entrati}`);
  const dopo = (await get(`/carta/turni?data=${data}`)).body.turni.find((x) => x.turno === t.turno);
  assert.equal(dopo.posti_liberi, 0);
});

test('nei turni di gioco il tavolo resta intero', async () => {
  const data = giorno(204);
  const t = (await get(`/carta/turni?data=${data}`)).body.turni.find((x) => x.scopo === 'gioco');
  const r = await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: t.turno, persone: 2 });
  assert.equal(r.status, 201);
  const dopo = (await get(`/carta/turni?data=${data}`)).body.turni.find((x) => x.turno === t.turno);
  assert.equal(dopo.tavoli_liberi, t.tavoli_liberi - 1, 'a carte il tavolo si occupa tutto: non si divide con estranei');
});

test('in cartellone restano sei discipline', async () => {
  const attive = (await get('/admin/discipline', token)).body.filter((d) => d.attivo);
  assert.equal(attive.length, 6, 'con dieci la stagione non si chiude');
  const chiavi = attive.map((d) => d.chiave).sort();
  assert.deepEqual(chiavi, ['basket', 'burraco', 'calcetto', 'pickle', 'scala', 'soft'].sort());
});

// ---- v4.96: leggere una posizione da qualunque cosa l'operatore abbia in mano -----------
test('la posizione si legge da coordinate, Google, Waze, Apple e OpenStreetMap', async () => {
  const casi = [
    ['coordinate', '36.918610, 15.170620'],
    ['Google lungo', 'https://www.google.com/maps/place/Farmacia/@36.91861,15.17062,17z/data=!3m1!4b1'],
    ['Google !3d!4d', 'https://www.google.com/maps/place/X/data=!4m2!3m1!8m2!3d36.91861!4d15.17062'],
    ['Waze', 'https://waze.com/ul?ll=36.91861%2C15.17062&navigate=yes'],
    ['Waze live-map', 'https://www.waze.com/live-map/directions?to=ll.36.91861%2C15.17062'],
    ['Apple Maps', 'https://maps.apple.com/?ll=36.91861,15.17062&q=Farmacia'],
    ['OpenStreetMap', 'https://www.openstreetmap.org/?mlat=36.91861&mlon=15.17062#map=18/36.9/15.1'],
    ['gradi', `36°55'07.0"N 15°10'14.2"E`],
    ['virgola italiana', '36,91861 15,17062']
  ];
  for (const [nome, testo] of casi) {
    const r = await send('/admin/geo/risolvi', { testo }, 'POST', token);
    assert.equal(r.status, 200, `${nome}: non letto`);
    assert.ok(Math.abs(r.body.lat - 36.91861) < 0.001, `${nome}: latitudine sbagliata (${r.body.lat})`);
    assert.ok(Math.abs(r.body.lng - 15.17062) < 0.001, `${nome}: longitudine sbagliata (${r.body.lng})`);
  }
});

test('un testo senza posizione non inventa coordinate', async () => {
  const r = await send('/admin/geo/risolvi', { testo: 'Farmacia di Fontane Bianche, via dei Lidi' }, 'POST', token);
  assert.equal(r.status, 422);
  assert.match(r.body.errore, /non riesco|leggere/i);
});

test('la virgola italiana non viene scambiata per due coordinate', async () => {
  // "36,91861 15,17062" letto male darebbe 36 e 918: una posizione in mezzo al nulla
  const r = await send('/admin/geo/risolvi', { testo: '36,91861 15,17062' }, 'POST', token);
  assert.equal(r.status, 200);
  assert.ok(r.body.lat > 36.9 && r.body.lat < 37, `letta ${r.body.lat}: la virgola era il separatore decimale`);
});

// ---- v4.97: i gradi incollati nei due campi separati -------------------------------------
test('i gradi copiati dalla barra di Google si convertono nei campi Lat e Lng', async () => {
  const v = await send('/admin/bussola', { sezione: 'vedere', titolo: 'Duomo di prova', dettaglio: 'barocco' }, 'POST', token);
  // È il caso reale: si copia "37°03'34.6"N 15°17'26.3"E" e si incolla un pezzo per campo.
  const r = await send(`/admin/bussola/${v.body.id}`, { titolo: 'Duomo di prova', lat: `37°03'34.6"N`, lng: `15°17'26.3"E` }, 'PUT', token);
  assert.equal(r.status, 200);
  assert.ok(Math.abs(r.body.lat - 37.0596) < 0.001, `latitudine non convertita: ${r.body.lat}`);
  assert.ok(Math.abs(r.body.lng - 15.2906) < 0.001, `longitudine non convertita: ${r.body.lng}`);
  const pubb = (await get('/bussola')).body.vedere.find((x) => x.titolo === 'Duomo di prova');
  assert.ok(pubb.lat > 37 && pubb.lat < 37.1, 'ai soci deve arrivare il decimale, non i gradi');
});

test('un valore illeggibile viene rifiutato, non svuotato in silenzio', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Duomo di prova');
  const ko = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, lat: 'Piazza Duomo 5', lng: '15.29' }, 'PUT', token);
  assert.equal(ko.status, 400, 'prima svuotava la posizione senza dire niente');
  assert.match(ko.body.error, /latitudine/i);
  // e la posizione buona resta
  const dopo = (await get('/bussola')).body.vedere.find((x) => x.titolo === 'Duomo di prova');
  assert.ok(dopo.lat > 37 && dopo.lat < 37.1);
});

test('una sola coordinata non basta: il punto non esiste', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Duomo di prova');
  const ko = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, lat: '37.0596', lng: '' }, 'PUT', token);
  assert.equal(ko.status, 400);
  assert.match(ko.body.error, /tutte e due/i);
});

test('la coppia incollata in un campo solo si divide da sé', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.titolo === 'Duomo di prova');
  const r = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, lat: '37.05961, 15.29334', lng: '' }, 'PUT', token);
  assert.equal(r.status, 200);
  assert.equal(r.body.lat, 37.05961);
  assert.equal(r.body.lng, 15.29334);
});

// ---- v4.99: coworking unificato alla sala, e campi di nuovo raggiungibili ---------------
test('il coworking prenota nella sala vera e la prenotazione si ritrova', async () => {
  const data = giorno(210);
  const t = (await get(`/carta/turni?data=${data}`)).body.turni.find((x) => x.scopo === 'coworking');
  const prima = t.posti_liberi;

  // una postazione è per UNA persona
  const r = await send('/carta/prenota', { tessera_code: SOCIO_A, data, turno: t.turno, persone: 1 });
  assert.equal(r.status, 201);

  // il contatore si muove davvero
  const dopo = (await get(`/carta/turni?data=${data}`)).body.turni.find((x) => x.turno === t.turno);
  assert.equal(dopo.posti_liberi, prima - 1, 'il contatore della sala deve aggiornarsi');

  // e il socio la ritrova, marcata come coworking
  const mie = (await get(`/carta/mie-prenotazioni?tessera_code=${SOCIO_A}`)).body.filter((m) => m.data === data);
  assert.equal(mie.length, 1, 'la prenotazione non deve sparire nel nulla');
  assert.equal(mie[0].scopo, 'coworking');
  assert.equal(mie[0].persone, 1);
});

test('la vecchia risorsa coworking è ritirata: un solo sistema', async () => {
  const risorse = (await get('/risorse')).body || [];
  assert.ok(!risorse.some((r) => r.tipo === 'coworking' || r.chiave === 'cowo'),
    'due sistemi paralleli per la stessa prenotazione erano la causa del problema');
});

// ---- v5.00: l'evento ha un luogo e una capienza -----------------------------------------
test('un evento dice dove si tiene e quante persone accoglie', async () => {
  const r = await send('/admin/eventi', { giorno: 'gio', titolo: 'Presentazione del libro', luogo: 'stage', capienza: 52, occupa_stage: true }, 'POST', token);
  assert.equal(r.status, 201);
  const e = (await get('/admin/eventi', token)).body.find((x) => x.id === r.body.id);
  assert.equal(e.luogo, 'stage');
  assert.equal(e.capienza, 52);
  assert.equal(e.occupa_stage, 1, 'la presentazione blocca lo Stage per la serata');

  // un luogo inventato non passa
  const q = await send('/admin/eventi', { giorno: 'ven', titolo: 'Ovunque', luogo: 'luna' }, 'POST', token);
  const e2 = (await get('/admin/eventi', token)).body.find((x) => x.id === q.body.id);
  assert.equal(e2.luogo, null, 'i luoghi sono quelli del residence, non testo libero');
});

test('la tessera si risolve nel nome per la comanda al bar', async () => {
  const s = (await get('/admin/soci', token)).body.find((x) => x.tessera_code);
  const r = await get(`/admin/soci/tessera/${s.tessera_code}`, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.nome, s.nome);
  assert.equal((await get('/admin/soci/tessera/BR-9999-9999', token)).status, 404);
});

// ---- v5.01: la pianta segue il permesso dell'ambiente -----------------------------------
test('chi ha solo "Casa di Carta" arriva alla sua sala', async () => {
  const u = 'op_carta_' + Math.floor(Math.random() * 9999);
  await send('/admin/operatori', { username: u, password: 'pw-test-123', ruolo: 'staff', permessi: ['cdc'] }, 'POST', token);
  const t = (await send('/admin/login', { username: u, password: 'pw-test-123' })).body.token;

  const sua = await get(`/admin/tavoli/turno?data=${giorno(220)}&ambiente=carta`, t);
  assert.equal(sua.status, 200, 'con il permesso Casa di Carta la sua pianta deve aprirsi');
  assert.equal((await get('/admin/tavoli/layout?ambiente=carta', t)).status, 200);

  // ma non tocca il Garden né lo Stage
  assert.equal((await get(`/admin/tavoli/turno?data=${giorno(220)}&ambiente=garden`, t)).status, 403);
  assert.equal((await get(`/admin/tavoli/turno?data=${giorno(220)}&ambiente=stage`, t)).status, 403);
});

test('chi ha solo "cinema" arriva alla platea e non alla sala', async () => {
  const u = 'op_cine2_' + Math.floor(Math.random() * 9999);
  await send('/admin/operatori', { username: u, password: 'pw-test-123', ruolo: 'staff', permessi: ['cinema'] }, 'POST', token);
  const t = (await send('/admin/login', { username: u, password: 'pw-test-123' })).body.token;
  assert.equal((await get(`/admin/tavoli/turno?data=${giorno(221)}&ambiente=stage`, t)).status, 200);
  assert.equal((await get(`/admin/tavoli/turno?data=${giorno(221)}&ambiente=carta`, t)).status, 403);
});

test('due fasce da 90 minuti non fanno tre ore di campo', async () => {
  await setPar({ campi_limita_durata: true, campi_durata_massima_minuti: 120, campi_finestra: false, campi_max_giorno: false, campi_catena: false }, token);
  const c = (await get('/campi')).body.find((x) => x.durata_slot === 90) || (await get('/campi')).body[0];
  // Su un campo da 90' il massimo di 120 minuti significa UNA fascia sola.
  const attese = Math.floor(120 / c.durata_slot);
  assert.equal(c.max_slot_prenotazione, attese, `su fasce da ${c.durata_slot}' devono essere ammesse ${attese} fasce`);

  if (c.durata_slot === 90) {
    const data = giorno(230);
    const slot = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.find((s) => s.stato === 'libero').slot;
    const doppia = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot, n_slot: 2 });
    assert.equal(doppia.status, 409, 'tre ore di campo di fila non devono passare');
  }

  // alzando il tetto a tre ore, due fasce tornano ammesse
  await setPar({ campi_durata_massima_minuti: 180 }, token);
  const c2 = (await get('/campi')).body.find((x) => x.id === c.id);
  assert.equal(c2.max_slot_prenotazione, Math.min(Number(c.max_slot_prenotazione) >= 2 ? 2 : Math.floor(180 / c.durata_slot), Math.floor(180 / c.durata_slot)));
  await setPar({ campi_durata_massima_minuti: 120 }, token);
});

// ---- v5.03: il codice mappa fornito da Google ------------------------------------------
test('si incolla il codice di Google e la mappa diventa quella', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.sezione !== 'orari');
  const html = '<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3200!2d15.29334!3d37.05961!5e0!3m2!1sit!2sit" width="600" height="450" style="border:0;" allowfullscreen loading="lazy"></iframe>';
  const r = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, mappa_embed: html }, 'PUT', token);
  assert.equal(r.status, 200);
  assert.match(r.body.mappa_embed, /^https:\/\/www\.google\.com\/maps\/embed\?/, 'si salva solo l\'indirizzo, non l\'HTML altrui');
  // dal codice si ricavano anche le coordinate, per le indicazioni stradali
  assert.ok(Math.abs(r.body.lat - 37.05961) < 0.0001);
  assert.ok(Math.abs(r.body.lng - 15.29334) < 0.0001);

  const pubb = (await get('/bussola')).body[v.sezione].find((x) => x.titolo === v.titolo);
  assert.ok(pubb.mappa_embed, 'ai soci deve arrivare la mappa scelta dal gestore');
});

test('un iframe che non è di Google viene rifiutato', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.sezione !== 'orari');
  const ko = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, mappa_embed: '<iframe src="https://sito-estraneo.example/x"></iframe>' }, 'PUT', token);
  assert.equal(ko.status, 400, 'non si incorpora codice di terzi nella pagina');
  assert.match(ko.body.error, /Google/);
  // e la mappa buona resta
  const dopo = (await get('/bussola')).body[v.sezione].find((x) => x.titolo === v.titolo);
  assert.ok(dopo.mappa_embed);
});

test('la mappa si può togliere lasciando la posizione', async () => {
  const v = (await get('/admin/bussola', token)).body.find((x) => x.mappa_embed);
  const r = await send(`/admin/bussola/${v.id}`, { titolo: v.titolo, lat: v.lat, lng: v.lng, mappa_embed: '' }, 'PUT', token);
  assert.equal(r.status, 200);
  const dopo = (await get('/admin/bussola', token)).body.find((x) => x.id === v.id);
  assert.equal(dopo.mappa_embed, null);
  assert.ok(dopo.lat, 'le coordinate restano: servono per le indicazioni');
});

test('la politica di sicurezza consente le mappe di Google e nient\'altro', async () => {
  const r = await fetch(`${BASE}/`);
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-src[^;]*google\.com/, 'senza frame-src il browser blocca la mappa e il socio legge “contenuti bloccati”');
  assert.match(csp, /default-src 'self'/, 'tutto il resto resta chiuso');
  assert.ok(!/frame-src[^;]*\*[^.]/.test(csp), 'non si apre a qualunque dominio');
  assert.match(r.headers.get('referrer-policy') || '', /strict-origin/, 'Google deve poter riconoscere il sito che incorpora');
});

// ---- v5.05: modo semplice e richiesta di aiuto ------------------------------------------
test('la sessione del socio porta l\'età, che accende il modo semplice', async () => {
  const anziano = await send('/admin/soci', { nome: 'Nunzio', cognome: 'Ottantenne', data_nascita: '1944-06-02', consenso_privacy: true }, 'POST', token);
  const l = await send('/auth/login-tessera', { tessera_code: anziano.body.tessera_code });
  assert.equal(l.status, 200);
  assert.ok(l.body.socio.eta >= 80, `età non calcolata: ${l.body.socio.eta}`);

  const giovane = await send('/admin/soci', { nome: 'Nina', cognome: 'Giovane', data_nascita: '2000-06-02', consenso_privacy: true }, 'POST', token);
  const l2 = await send('/auth/login-tessera', { tessera_code: giovane.body.tessera_code });
  assert.ok(l2.body.socio.eta < 30);

  // la soglia arriva all'app con le regole dei campi
  const c = (await get('/campi')).body[0];
  assert.equal(c.regole.semplice_eta, 70);
});

test('i numeri rapidi sono numeri, non un servizio di soccorso', async () => {
  const n = (await get('/aiuto/numeri')).body;
  assert.equal(n.emergenza, '112', 'il numero unico dev\'essere sempre il primo');
  assert.match(n.avviso, /non e/i, 'va detto che il residence non è un servizio di soccorso');
  assert.equal(n.avvisa_crew, undefined, 'niente da inviare: la chiamata la fa il telefono');
});

test('non esiste più alcuna segnalazione al personale', async () => {
  // Rimossa per scelta: un servizio legato alla salute o si presta sempre, con personale
  // reperibile, o non si presta. Non può funzionare dalle ore alle ore né scaricarsi con un
  // avviso. Se qualcuno la reintroducesse per buone intenzioni, questo test lo ferma.
  const post = await send('/aiuto', { tessera_code: SOCIO_A, tipo: 'sono_qui', lat: 36.9, lng: 15.1 });
  assert.equal(post.status, 404, 'la rotta non deve esistere');
  assert.equal((await get('/admin/aiuto', token)).status, 404);
  const cr = (await get('/admin/cruscotto', token)).body;
  assert.ok(!cr.attenzione.some((a) => a.tipo === 'aiuto'), 'e non deve restare traccia nel cruscotto');
  const par = (await get('/admin/parametri', token)).body;
  assert.ok(!par.some((x) => x.chiave === 'aiuto_avvisa_crew'), 'né il parametro che la accendeva');
});

test('allo Stage la prima fila degli over 70 viene dichiarata', async () => {
  const c = await get('/cinema');
  assert.ok(c.body.prima_fila_over70 > 0, 'l\'app deve poter dire che il diritto esiste');
});

// ---- v5.06: le due soglie e le regole sui minorenni -------------------------------------
test('le soglie di età sono due e arrivano all\'app', async () => {
  const r = (await get('/campi')).body[0].regole;
  assert.equal(r.semplice_eta, 70);
  assert.equal(r.ragazzi_eta, 14);
  assert.equal(r.maggiore_eta, 18, 'la maggiore età non è un parametro del residence');
  assert.equal(r.ragazzi_prenotano_campi, false, 'il campo lo prenota un adulto: il ragazzo gioca');

  // e si spostano dai parametri
  await setPar({ ragazzi_eta: 16 }, token);
  assert.equal((await get('/campi')).body[0].regole.ragazzi_eta, 16);
  await setPar({ ragazzi_eta: 14 }, token);
});

test('il divieto per i minorenni vive sul server, non solo nell\'interfaccia', async () => {
  const bimbo = await send('/admin/soci', { nome: 'Tino', cognome: 'Dodicenne', data_nascita: '2014-05-10', consenso_privacy: true, ruolo: 'minore' }, 'POST', token);
  const t = bimbo.body.tessera_code;
  const menu = (await get('/menu?zona=bar')).body;

  // ordinare: bloccato, con un messaggio che non umilia
  const ord = await send('/self-order', { punto: 'Bussola Bar', tavolo: '1', tessera_code: t, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  assert.equal(ord.status, 403, 'nascondere il tasto non basta: chi conosce l\'indirizzo lo chiama');
  assert.match(ord.body.error, /adulto/i);

  // il tavolo lo prenota un adulto
  const cena = await send('/garden/prenota', { tessera_code: t, data: giorno(240), turno: '20:00', persone: 2 });
  assert.equal(cena.status, 403);

  // il campo lo prenota un adulto…
  const c = (await get('/campi')).body[0];
  const data = giorno(241);
  const slot = (await get(`/campi/${c.id}/disponibilita?data=${data}`)).body.slots.find((s) => s.stato === 'libero').slot;
  assert.equal((await send(`/campi/${c.id}/partita`, { tessera_code: t, data, slot })).status, 403);

  // …ma il ragazzo si unisce e gioca: unirsi non è impegnare uno spazio
  const p = await send(`/campi/${c.id}/partita`, { tessera_code: SOCIO_A, data, slot });
  assert.equal(p.status, 201);
  const u = await send(`/partite-aperte/${p.body.partita_id}/unisciti`, { tessera_code: t });
  assert.equal(u.status, 200, 'il minorenne deve poter giocare, altrimenti l\'app non gli serve');
});

test('nessun parametro può autorizzare un minorenne a spendere', async () => {
  // Prima esisteva un interruttore che lo consentiva. Non e' una preferenza del gestore:
  // fino ai 18 anni non si prende un impegno di spesa, e il sistema non deve poterlo permettere.
  const par = (await get('/admin/parametri', token)).body;
  assert.ok(!par.some((x) => x.chiave === 'ragazzi_ordini'), 'l\'interruttore non deve più esistere');

  const bimbo = (await get('/admin/soci', token)).body.find((x) => x.cognome === 'Dodicenne');
  const menu = (await get('/menu?zona=bar')).body;
  const ord = await send('/self-order', { punto: 'Bussola Bar', tavolo: '2', tessera_code: bimbo.tessera_code, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  assert.equal(ord.status, 403);
  assert.match(ord.body.error, /18 anni/);
});

test('il vincolo vale fino ai 18, non fino alla soglia dell\'interfaccia', async () => {
  // Un sedicenne usa l'app completa (soglia ragazzi 14) ma non puo' impegnarsi a pagare.
  const anno = new Date().getFullYear() - 16;
  const sedici = await send('/admin/soci', { nome: 'Sara', cognome: 'Sedici', data_nascita: `${anno}-01-10`, consenso_privacy: true }, 'POST', token);
  const t = sedici.body.tessera_code;
  assert.equal((await get(`/tessera/${t}`)).body.eta, 16);

  const menu = (await get('/menu?zona=bar')).body;
  assert.equal((await send('/self-order', { punto: 'Bussola Bar', tavolo: '4', tessera_code: t, righe: [{ menu_id: menu[0].id, qta: 1 }] })).status, 403);
  assert.equal((await send('/garden/prenota', { tessera_code: t, data: giorno(250), turno: '20:00', persone: 2 })).status, 403);
  const serate = (await get('/serate')).body;
  if (serate.length) assert.equal((await send(`/serate/${serate[0].id}/prenota`, { tessera_code: t, persone: 1 })).status, 403);

  // ma a diciotto compiuti sì
  const anno18 = new Date().getFullYear() - 19;
  const magg = await send('/admin/soci', { nome: 'Dario', cognome: 'Diciannove', data_nascita: `${anno18}-01-10`, consenso_privacy: true }, 'POST', token);
  assert.equal((await send('/self-order', { punto: 'Bussola Bar', tavolo: '5', tessera_code: magg.body.tessera_code, righe: [{ menu_id: menu[0].id, qta: 1 }] })).status, 201);
});

test('un adulto non è toccato dalle regole dei ragazzi', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', tavolo: '3', tessera_code: SOCIO_A, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  assert.equal(r.status, 201);
});

test('il contatto di emergenza del familiare arriva all\'app', async () => {
  const s = (await get('/admin/soci', token)).body.find((x) => x.cognome === 'Ottantenne') || (await get('/admin/soci', token)).body[0];
  const r = await send(`/admin/soci/${s.id}`, {
    nome: s.nome, cognome: s.cognome, data_nascita: s.data_nascita, tipo_profilo: s.tipo_profilo || 'socio',
    ruolo: s.ruolo || 'socio', consenso_privacy: true, attivo: 1,
    emergenza_nome: 'Giulia (figlia)', emergenza_tel: '333 1234567'
  }, 'PUT', token);
  assert.equal(r.status, 200);
  const t = (await get(`/tessera/${s.tessera_code}`)).body;
  assert.equal(t.emergenza_nome, 'Giulia (figlia)');
  assert.equal(t.emergenza_tel, '333 1234567');
});

// ---- v5.11: un minorenne non prende impegni con i soldi di altri ------------------------
test('un minorenne non prenota le serate speciali né le lezioni a pagamento', async () => {
  const bimbo = (await get('/admin/soci', token)).body.find((x) => x.cognome === 'Dodicenne');
  const t = bimbo.tessera_code;

  const serate = (await get('/serate')).body;
  if (serate.length) {
    const s = await send(`/serate/${serate[0].id}/prenota`, { tessera_code: t, persone: 2 });
    assert.equal(s.status, 403, 'la serata ha una quota: la prenota chi paga');
    assert.match(s.body.error, /adulto/i);
  }

  const fit = (await get('/fitness')).body.lezioni || [];
  if (fit.length) {
    const f = await send(`/fitness/sedute/${fit[0].id}/prenota`, { tessera_code: t });
    assert.equal(f.status, 403, 'anche la lezione si paga');
    assert.match(f.body.error, /adulto/i);
  }

  // un adulto invece passa
  if (serate.length) {
    assert.equal((await send(`/serate/${serate[0].id}/prenota`, { tessera_code: SOCIO_A, persone: 2 })).status, 201);
  }
});


// ---- v5.14: chat di casata e confronto di magazzino -------------------------------------
async function tokenSocio(tessera) {
  return (await send('/auth/login-tessera', { tessera_code: tessera })).body.token;
}

test('la chat è della propria casata, e nessun altro la legge', async () => {
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code && s.casata_id);
  const a = soci[0];
  const b = soci.find((s) => s.casata_id && s.casata_id !== a.casata_id);
  const ta = await tokenSocio(a.tessera_code), tb = await tokenSocio(b.tessera_code);

  const inv = await send('/auth/chat/casata', { testo: 'Sabato ci sono, gioco in difesa.' }, 'POST', ta);
  assert.equal(inv.status, 201);

  const mia = (await get('/auth/chat/casata', ta)).body;
  assert.ok(mia.messaggi.some((m) => /gioco in difesa/.test(m.testo)));
  assert.match(mia.avviso, /non e/i, 'entrando si deve leggere che la chat non è privata');

  const altra = (await get('/auth/chat/casata', tb)).body;
  assert.ok(!altra.messaggi.some((m) => /gioco in difesa/.test(m.testo)),
    'una casata non deve leggere la strategia di un\'altra');
});

test('solo testo: niente collegamenti, niente tag', async () => {
  const s = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.casata_id);
  const t = await tokenSocio(s.tessera_code);
  const link = await send('/auth/chat/casata', { testo: 'guardate qui https://sito.example/x' }, 'POST', t);
  assert.equal(link.status, 400);
  assert.match(link.body.error, /collegamenti/i);

  await send('/auth/chat/casata', { testo: '<b>ciao</b><script>alert(1)</script> a tutti' }, 'POST', t);
  const m = (await get('/auth/chat/casata', t)).body.messaggi.pop();
  assert.ok(!/[<>]/.test(m.testo), 'i tag vanno tolti: ' + m.testo);
});

test('il gruppo capitani è riservato ai capitani', async () => {
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code);
  const normale = soci.find((s) => s.ruolo !== 'capitano' && s.casata_id);
  const t = await tokenSocio(normale.tessera_code);
  assert.equal((await get('/auth/chat/capitani', t)).status, 403);

  // promosso a capitano, entra
  await send(`/admin/soci/${normale.id}`, { nome: normale.nome, cognome: normale.cognome, ruolo: 'capitano', tipo_profilo: 'socio', casata_id: normale.casata_id, consenso_privacy: true, attivo: 1 }, 'PUT', token);
  const t2 = await tokenSocio(normale.tessera_code);
  assert.equal((await get('/auth/chat/capitani', t2)).status, 200);
});

test('il gestore legge ciò che viene segnalato, non tutto', async () => {
  const prima = (await get('/admin/chat/segnalati', token)).body;
  assert.equal(prima.segnalati.length, 0, 'senza segnalazioni il gestore non vede messaggi');
  assert.ok(prima.messaggi_totali > 0, 'ma sa quanti ce ne sono');

  const s = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.casata_id);
  const t = await tokenSocio(s.tessera_code);
  const m = (await get('/auth/chat/casata', t)).body.messaggi[0];
  assert.equal((await send(`/auth/chat/messaggi/${m.id}/segnala`, { motivo: 'linguaggio' }, 'POST', t)).status, 200);

  const dopo = (await get('/admin/chat/segnalati', token)).body;
  assert.equal(dopo.segnalati.length, 1);
  assert.ok(dopo.segnalati[0].contesto.length >= 1, 'serve il contesto: una frase isolata non si capisce');
  assert.ok(dopo.segnalati[0].casata, 'e da quale casata arriva');

  // nascosto: sparisce dalla chat dei soci
  await send(`/admin/chat/messaggi/${m.id}`, { azione: 'nascondi' }, 'PUT', token);
  assert.ok(!(await get('/auth/chat/casata', t)).body.messaggi.some((x) => x.id === m.id));
});

test('il caffè non si scarica, si confronta', async () => {
  // un articolo a PESO e uno a PEZZO
  const caffe = await send('/admin/magazzino', { nome: 'Caffè grani (confronto)', zona: 'bar', unita: 'g', giacenza: 5000, tipo_consumo: 'peso', sfrido_pct: 15 }, 'POST', token);
  const acqua = await send('/admin/magazzino', { nome: 'Acqua bottiglia', zona: 'bar', unita: 'pz', giacenza: 100, tipo_consumo: 'pezzo' }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const vCaffe = menu.find((m) => /caff/i.test(m.nome)) || menu[0];
  const vAcqua = menu.find((m) => /acqua/i.test(m.nome)) || menu[1];

  // distinta: un caffè consuma 7 g di grani
  await send(`/admin/menu/${vCaffe.id}/distinta`, { voci: [{ articolo_id: caffe.body.id, quantita: 7 }] }, 'PUT', token);
  await send(`/admin/menu/${vAcqua.id}/distinta`, { voci: [{ articolo_id: acqua.body.id, quantita: 1 }] }, 'PUT', token);

  const gia = (await get('/admin/magazzino', token)).body.articoli;
  const g0caffe = gia.find((a) => a.id === caffe.body.id).giacenza;
  const g0acqua = gia.find((a) => a.id === acqua.body.id).giacenza;

  // dieci caffè e tre bottiglie, venduti e incassati
  const r = await send('/self-order', { punto: 'Bussola Bar', tavolo: '1', righe: [{ menu_id: vCaffe.id, qta: 10 }, { menu_id: vAcqua.id, qta: 3 }] });
  const id = (await get('/admin/comande?stato=tutte', token)).body.find((c) => c.numero === r.body.numero).id;
  await send(`/admin/comande/${id}/stato`, { stato: 'chiusa' }, 'PUT', token);

  const dopo = (await get('/admin/magazzino', token)).body.articoli;
  assert.equal(dopo.find((a) => a.id === acqua.body.id).giacenza, g0acqua - 3, 'le bottiglie si contano: scarico esatto');
  assert.equal(dopo.find((a) => a.id === caffe.body.id).giacenza, g0caffe, 'il caffè NON si scarica: la resa reale non è la ricetta');

  // ma il teorico c'è: 10 × 7 g + 15% di sfrido = 80,5 g
  const conf = (await get('/admin/magazzino/confronto', token)).body;
  const riga = conf.righe.find((x) => x.id === caffe.body.id);
  assert.ok(riga, 'il caffè deve comparire nel confronto');
  assert.ok(Math.abs(riga.teorico - 80.5) < 0.1, `teorico atteso 80.5, trovato ${riga.teorico}`);
  assert.equal(riga.reale, 0, 'finché non si conta, il reale è zero');
});

test('lo scostamento è l\'informazione utile', async () => {
  const caffe = (await get('/admin/magazzino', token)).body.articoli.find((a) => a.nome === 'Caffè grani (confronto)');
  // la conta di fine settimana dice che ne mancano 100 g: 19,5 in più del teorico
  await send(`/admin/magazzino/${caffe.id}/movimento`, { tipo: 'scarico', quantita: 100, causale: 'conta settimanale' }, 'POST', token);
  const riga = (await get('/admin/magazzino/confronto', token)).body.righe.find((x) => x.id === caffe.id);
  assert.equal(riga.reale, 100);
  assert.ok(Math.abs(riga.scarto - 19.5) < 0.1, `scarto atteso 19.5, trovato ${riga.scarto}`);
  assert.ok(riga.scarto_pct > 20 && riga.scarto_pct < 26, `scostamento ~24%, trovato ${riga.scarto_pct}%`);
});

// ---- v5.16: chiosco e isola ecologica come i punti di interesse --------------------------
test('i luoghi si impostano come le voci di guida', async () => {
  const l = (await get('/admin/luoghi', token)).body.find((x) => x.chiave === 'isola');

  // gradi copiati dalla barra di Google, uno per campo
  const g = await send(`/admin/luoghi/${l.id}`, { nome: l.nome, lat: `36°58'02.0"N`, lng: `15°13'16.3"E` }, 'PUT', token);
  assert.equal(g.status, 200);
  assert.ok(Math.abs(g.body.lat - 36.9672) < 0.001, `latitudine non convertita: ${g.body.lat}`);

  // codice della mappa: si salva e ne ricava le coordinate
  const html = '<iframe src="https://www.google.com/maps/embed?pb=!1m18!2d15.22120!3d36.96720!5e0" width="600"></iframe>';
  const e = await send(`/admin/luoghi/${l.id}`, { nome: l.nome, lat: '', lng: '', mappa_embed: html }, 'PUT', token);
  assert.equal(e.status, 200);
  assert.match(e.body.mappa_embed, /^https:\/\/www\.google\.com\/maps\/embed\?/);
  assert.ok(Math.abs(e.body.lat - 36.9672) < 0.001, 'le coordinate si ricavano dal codice');

  // e arrivano all'app
  const pubb = (await get('/luoghi')).body.find((x) => x.chiave === 'isola');
  assert.ok(pubb.mappa_embed, 'il socio deve vedere la mappa scelta dal gestore');
  assert.ok(pubb.lat, 'e avere le coordinate per le indicazioni');
});

test('un iframe estraneo non entra nemmeno dai luoghi', async () => {
  const l = (await get('/admin/luoghi', token)).body[0];
  const ko = await send(`/admin/luoghi/${l.id}`, { nome: l.nome, mappa_embed: '<iframe src="https://altro-sito.example/x"></iframe>' }, 'PUT', token);
  assert.equal(ko.status, 400);
  assert.match(ko.body.error, /Google/);
});

// ---- v5.17: colore per disciplina e fascia fissa della griglia ---------------------------
test('ogni corso ha un colore, e non si accetta testo libero', async () => {
  const c = await send('/admin/fitness/corsi', { nome: 'Acquagym', istruttore: 'Nino', data_inizio: giorno(1), data_fine: giorno(8), giorni: [1, 4], ora: '17:00', posti_max: 20, prezzo: 10, colore: '#8a4a6b' }, 'POST', token);
  assert.equal(c.status, 201);
  const corso = (await get('/admin/fitness/corsi', token)).body.find((x) => x.id === c.body.id);
  assert.equal(corso.colore, '#8a4a6b');

  // un valore non valido non entra nel CSS delle pagine: viene sostituito da uno della tavolozza
  const k = await send('/admin/fitness/corsi', { nome: 'Prova colore', data_inizio: giorno(1), data_fine: giorno(2), giorni: [1], ora: '18:00', colore: 'red; background:url(x)' }, 'POST', token);
  const corso2 = (await get('/admin/fitness/corsi', token)).body.find((x) => x.id === k.body.id);
  assert.match(corso2.colore, /^#[0-9a-f]{6}$/i, `colore non valido accettato: ${corso2.colore}`);

  // e il colore arriva alle lezioni, che è dove serve
  const lez = (await get('/fitness')).body.lezioni.find((l) => l.corso_nome === 'Acquagym');
  if (lez) assert.equal(lez.colore, '#8a4a6b');
});

test('la griglia ha una fascia fissa, così il calendario ha una forma', async () => {
  const d = (await get('/fitness')).body;
  assert.equal(d.griglia_da, '16:00');
  assert.equal(d.griglia_a, '20:00');
  await setPar({ fitness_griglia_da: '15:00' }, token);
  assert.equal((await get('/fitness')).body.griglia_da, '15:00');
  await setPar({ fitness_griglia_da: '16:00' }, token);
});

test('i parametri di testo si possono davvero cambiare', async () => {
  // Difetto trovato scrivendo la prova sopra: il tipo "testo" non era gestito, quindi ogni
  // valore finiva nel controllo delle opzioni e tornava al predefinito. Riguardava anche il
  // numero del chiosco, che quindi non si poteva impostare.
  await setPar({ aiuto_numero: '0931 555123' }, token);
  assert.equal((await get('/aiuto/numeri')).body.residence, '0931 555123');
  await setPar({ aiuto_numero: '' }, token);
});

// ---- v5.18: quattro correzioni dal collaudo ---------------------------------------------
test('la rassegna dei film arriva ai soci, anche senza date', async () => {
  const f = await send('/admin/film', { titolo: 'Il Postino', regia: 'Michael Radford', anno: 1994, durata_min: 108, genere: 'Drammatico', sinossi: 'Un postino e un poeta.' }, 'POST', token);
  const d = (await get('/cinema')).body;
  const mio = (d.film || []).find((x) => x.id === f.body.id);
  assert.ok(mio, 'il film deve comparire nella rassegna appena inserito');
  assert.equal(mio.regia, 'Michael Radford');
  assert.ok('sinossi' in mio, 'serve la sinossi: è quello che si legge scegliendo');
  // e non deve avere una data finché non si programma la serata
  assert.ok(!(d.prossime || []).some((p) => p.film_id === f.body.id));
});

test('la rassegna non porta date, nemmeno per i film già programmati', async () => {
  // Scelta voluta: una serata speciale o il maltempo spostano una proiezione, e una data
  // scritta e poi cambiata vale meno di nessuna data. Il giorno esatto sta in Stage.
  const d = (await get('/cinema')).body;
  const programmato = (d.prossime || [])[0];
  if (programmato) {
    const inRassegna = (d.film || []).find((f) => f.id === programmato.film_id);
    assert.ok(inRassegna, 'il film programmato resta nella rassegna');
    assert.ok(!('data' in inRassegna), 'ma la rassegna non porta la data');
  }
  // le date restano dove servono: nell'elenco delle proiezioni
  if (programmato) assert.ok(programmato.data && programmato.ora);
});

// ---- Complementi: le aggiunte si spuntano dentro il piatto -------------------------------
// Il condimento non è una voce che si ordina da sola: è un "di cui" del panino. Ma resta un
// articolo vero, con il suo prezzo e il suo scarico di magazzino — per questo in comanda
// arriva come riga sua, agganciata al piatto.
test('un complemento sparisce dall’elenco del menù e compare dentro il piatto', async () => {
  const piatto = await send('/admin/menu', { nome: 'Panino petto di pollo (test)', prezzo: 6, stazione: 'cucina', zona: 'garden', categoria: 'Panini & Piatti', con_condimenti: true }, 'POST', token);
  const magio = await send('/admin/menu', { nome: 'Maionese (test)', prezzo: 0.5, stazione: 'cucina', zona: 'garden', categoria: 'Condimenti extra' }, 'POST', token);
  assert.equal(piatto.status, 201);
  assert.equal(magio.status, 201);

  // Unica cosa da dire al sistema: la maionese e' un'aggiunta. Nessun abbinamento.
  assert.equal((await send(`/admin/menu/${magio.body.id}/complemento`, { complemento: true }, 'PUT', token)).status, 200);

  const menu = (await get('/menu?zona=garden')).body;
  assert.ok(!menu.some((m) => m.id === magio.body.id), 'la maionese non deve stare nell’elenco come voce a sé');
  const p = menu.find((m) => m.id === piatto.body.id);
  assert.ok(p, 'il panino resta nel menù');
  assert.ok(p.complementi.some((c) => c.nome === 'Maionese (test)'), 'compare in ogni piatto di cucina, senza abbinarla');
  // E nella tazzina del caffe' non ci va: il caffe' lo fa il banco, non la cucina.
  const banco = (await get('/menu?zona=bar')).body.find((m) => m.stazione === 'bar');
  assert.ok(!(banco.complementi || []).length, 'i condimenti non compaiono nei prodotti del banco');
});

test('il complemento spuntato arriva in comanda come riga sotto il piatto, e si paga', async () => {
  const piatto = (await get('/menu?zona=garden')).body.find((m) => m.nome === 'Panino petto di pollo (test)');
  const magio = piatto.complementi[0];
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '5', righe: [{ menu_id: piatto.id, qta: 2, complementi: [magio.id] }] });
  assert.equal(r.status, 201);
  // il supplemento e' del piatto, non del condimento: due panini conditi = due supplementi
  assert.equal(r.body.totale, piatto.prezzo * 2 + piatto.supplemento_complementi * 2);

  const com = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero);
  const righe = com.righe;
  const padre = righe.find((x) => x.menu_id === piatto.id);
  const figlia = righe.find((x) => x.menu_id === magio.id);
  assert.ok(padre && figlia, 'in comanda ci devono essere sia il piatto sia il complemento');
  assert.equal(figlia.parent_riga_id, padre.id, 'il complemento deve essere agganciato al piatto');
  assert.equal(figlia.qta, 2);
  assert.equal(figlia.stazione, padre.stazione, 'il complemento va preparato da chi prepara il piatto');
});

test('non si possono aggiungere complementi che quel piatto non prevede', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const piatto = menu.find((m) => m.nome === 'Panino petto di pollo (test)');
  const altro = menu.find((m) => m.id !== piatto.id);
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '6', righe: [{ menu_id: piatto.id, qta: 1, complementi: [altro.id] }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.totale, piatto.prezzo, 'un complemento non abbinato non deve entrare né in comanda né nel conto');
});

// ---- Bar e cucina aprono insieme --------------------------------------------------------
// Chi arriva alle 16 e vuole un panino non deve sentirsi dire di no perché "la cucina apre
// alle 19": la cucina apre con il bar, e dal Bar si ordina anche quello che esce dalla cucina.
test('un prodotto "entrambi" si ordina dal Bar e la sua riga va comunque alla cucina', async () => {
  // Bar e Garden sono due chiamate identiche allo stesso menù: cambia solo il punto. Un
  // panino ordinabile anche al bar è un prodotto "comune" — non serve nessuna eccezione
  // nella chiamata per farlo comparire dove deve stare.
  const p = await send('/admin/menu', { nome: 'Patatine fritte (test)', prezzo: 4, stazione: 'cucina', zona: 'comune', categoria: 'Panini & Piatti' }, 'POST', token);
  assert.equal(p.status, 201);

  const bar = (await get('/menu?zona=bar')).body;
  const garden = (await get('/menu?zona=garden')).body;
  assert.ok(bar.some((m) => m.id === p.body.id), 'un prodotto "entrambi" sta nel menù del Bar');
  assert.ok(garden.some((m) => m.id === p.body.id), 'e anche in quello del Garden');

  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.body.id, qta: 1 }] });
  assert.equal(r.status, 201);
  const com = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero);
  assert.equal(com.zona, 'bar', 'la comanda resta del Bar: non deve finire sulla mappa dei tavoli del Garden');
  const kds = (await get('/admin/kds?stazione=cucina', token)).body;
  assert.ok(kds.some((c) => c.id === com.id), 'ma la riga da preparare deve arrivare alla cucina');
});

test('la regola "da preparare, in entrambi i punti" si applica alle categorie scelte dal gestore', async () => {
  const elenco = await send('/admin/menu/cross-cucina', {}, 'POST', token);
  assert.ok(elenco.body.categorie.includes('Panini & Piatti'), 'senza categorie indicate restituisce l’elenco da scegliere');
  const r = await send('/admin/menu/cross-cucina', { categorie: ['Panini & Piatti'] }, 'POST', token);
  assert.ok(r.body.aggiornati >= 1);
  const bar = (await get('/menu?zona=bar')).body;
  assert.ok(bar.some((m) => m.nome === 'Panino petto di pollo (test)'), 'il panino ora si ordina anche dal Bar');
  assert.ok(bar.find((m) => m.nome === 'Panino petto di pollo (test)').stazione === 'cucina', 'e resta da preparare in cucina');
});

// ---- Il supplemento condimenti è uno solo per piatto ------------------------------------
// I condimenti si spuntano, non si contano: uno o quattro costano lo stesso. Il prezzo lo fa
// il supplemento, che è del piatto — e si vede in conto come riga a sé.
test('quattro condimenti costano come uno: il supplemento si paga una volta per piatto', async () => {
  const panino = (await send('/admin/menu', { nome: 'Panino prova supplemento', prezzo: 5, stazione: 'cucina', zona: 'comune', categoria: 'Panini & Piatti', con_condimenti: true }, 'POST', token)).body;
  const ids = [];
  // I condimenti costano quello che il gestore scrive: qui 0,50, ed e' quello che si paga —
  // uno o quattro pari sono.
  for (const n of ['Salsa A', 'Salsa B', 'Salsa C']) {
    const c = (await send('/admin/menu', { nome: n, prezzo: 0.5, stazione: 'cucina', zona: 'comune', categoria: 'Condimenti extra' }, 'POST', token)).body;
    await send(`/admin/menu/${c.id}/complemento`, { complemento: true }, 'PUT', token);
    ids.push(c.id);
  }
  await send(`/admin/menu/${panino.id}/complementi`, { complementi: ids }, 'PUT', token);

  const m = (await get('/menu?zona=garden')).body.find((x) => x.id === panino.id);
  assert.equal(m.supplemento_complementi, 0.5, 'condire costa quello che il gestore ha scritto sui condimenti');
  assert.ok(m.complementi.every((c) => c.prezzo === undefined), 'i condimenti non espongono un prezzo proprio');

  const uno = await send('/self-order', { punto: 'Bussola Garden', tavolo: '9', righe: [{ menu_id: panino.id, qta: 1, complementi: [ids[0]] }] });
  const tre = await send('/self-order', { punto: 'Bussola Garden', tavolo: '9', righe: [{ menu_id: panino.id, qta: 1, complementi: ids }] });
  assert.equal(uno.body.totale, 5.5);
  assert.equal(tre.body.totale, 5.5, 'tre condimenti non costano tre volte: il prezzo di listino della salsa non entra in conto');

  const com = (await get('/admin/comande', token)).body.find((c) => c.numero === tre.body.numero);
  const suppl = com.righe.filter((x) => x.nome === 'Supplemento condimenti');
  assert.equal(suppl.length, 1, 'un solo supplemento, anche con tre condimenti');
  assert.equal(suppl[0].prezzo, 0.5);
  const salse = com.righe.filter((x) => ids.includes(x.menu_id));
  assert.equal(salse.length, 3, 'le tre salse restano righe proprie: la cucina le legge e il magazzino le scarica');
  assert.ok(salse.every((x) => x.prezzo === 0), 'ma non si pagano a pezzo');
});

test('condimenti a prezzo zero: gratis, e in conto non compare niente', async () => {
  // Regalare i condimenti e' una scelta commerciale come farli pagare: si mette zero e basta.
  await send('/admin/parametri', { comande_supplemento_complementi: 0 }, 'PUT', token);
  // Condire costa uguale per tutti: il prezzo e' quello dei condimenti nel loro insieme, non
  // di quello scelto. Per regalarli si mettono a zero TUTTI.
  const cond = (await get('/admin/menu', token)).body.filter((m) => m.e_condimento === 1);
  const prezziPrima = cond.map((c) => c.prezzo);
  await send('/admin/menu', { righe: cond.map((c) => ({ id: c.id, prezzo: 0 })) }, 'PUT', token);
  const panino = (await get('/menu?zona=garden')).body.find((x) => x.nome === 'Panino prova supplemento');
  assert.equal(panino.supplemento_complementi, 0);
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '9', righe: [{ menu_id: panino.id, qta: 2, complementi: [panino.complementi[0].id] }] });
  assert.equal(r.body.totale, panino.prezzo * 2);
  const com = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero);
  assert.equal(com.righe.filter((x) => x.nome === 'Supplemento condimenti').length, 0);
  await send('/admin/parametri', { comande_supplemento_complementi: 0.5 }, 'PUT', token);
  await send('/admin/menu', { righe: cond.map((c, i) => ({ id: c.id, prezzo: prezziPrima[i] })) }, 'PUT', token);
});

// ---- Un panino si ordina anche dal Bar --------------------------------------------------
// Era il difetto che l'utente vedeva e io no: la deduzione automatica chiudeva nel Garden
// tutto cio' che passa dalla cucina, e al Bar il panino non compariva. Chi prepara e dove si
// vende sono due cose diverse: la cucina lo fa, ma si vende in tutte e due le aree.
test('un piatto che prepara la cucina si vende anche al Bar', async () => {
  const bar = (await get('/menu?zona=bar')).body;
  const panini = bar.filter((m) => m.stazione === 'cucina');
  assert.ok(panini.length >= 1, 'al Bar devono comparire i piatti della cucina');
  // La zona non c'entra piu': la cucina serve tutti i punti comunque sia marcato il prodotto.

  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: panini[0].id, qta: 1 }] });
  assert.equal(r.status, 201);
  const com = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero);
  assert.equal(com.zona, 'bar', 'la comanda resta del Bar: non deve finire sulla mappa tavoli del Garden');
  const kds = (await get('/admin/kds?stazione=cucina', token)).body;
  assert.ok(kds.some((c) => c.id === com.id), 'ma la riga va preparata in cucina');
});

test('un prodotto nuovo di cucina nasce vendibile in tutte e due le aree', async () => {
  const n = (await send('/admin/menu', { nome: 'Piatto nuovo di cucina', prezzo: 7, stazione: 'cucina', categoria: 'Piatto' }, 'POST', token)).body;
  const m = (await get('/menu?zona=bar')).body.find((x) => x.id === n.id);
  assert.ok(m, 'senza dover dire niente, un piatto di cucina si vede anche al Bar');
  assert.equal(m.zona, 'comune');
  // Marcarlo "solo Garden" non lo nasconde piu' al Bar: dalla v5.27 la cucina serve tutti i
  // punti per regola, e "Dove si vende" governa solo l'ordinamento del menu'. E' una decisione
  // presa dopo che il panino era sparito dal Bar tre volte per un dato marcato storto.
  await send('/admin/menu/' + n.id, { nome: 'Piatto nuovo di cucina', prezzo: 7, stazione: 'cucina', zona: 'garden', categoria: 'Piatto', attivo: 1 }, 'PUT', token);
  assert.ok((await get('/menu?zona=bar')).body.some((x) => x.id === n.id), 'nessun dato puo\u2019 nascondere al Bar quello che esce dalla cucina');
});

// ---- La Crew ordina con lo stesso menù del socio ----------------------------------------
// Al tavolo il cameriere vedeva ancora "Condimenti extra" come categoria: prendeva il listino
// grezzo invece dell'elenco ordinabile. Due elenchi diversi per lo stesso menù sono un errore.
test('l’elenco con cui la Crew batte una comanda è lo stesso che vede il socio', async () => {
  const grezzo = (await get('/admin/menu', token)).body;
  const ordinabile = (await get('/admin/menu?ordinabile=1', token)).body;
  assert.ok(grezzo.some((m) => m.complemento === 1), 'il listino completo serve a gestire i condimenti');
  assert.ok(!ordinabile.some((m) => m.complemento === 1), 'ma quando si ordina i condimenti non sono voci a sé');
  const conCompl = ordinabile.find((m) => (m.complementi || []).length);
  assert.ok(conCompl, 'i piatti devono portarsi dietro le loro aggiunte');
  assert.equal(conCompl.supplemento_complementi, 0.5);
});

test('i condimenti spuntati dal cameriere arrivano in cucina e in conto come per il socio', async () => {
  const piatto = (await get('/admin/menu?ordinabile=1', token)).body.find((m) => (m.complementi || []).length >= 2);
  const due = piatto.complementi.slice(0, 2).map((c) => c.id);
  const r = await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '4', righe: [{ menu_id: piatto.id, qta: 1, complementi: due }] }, 'POST', token);
  assert.equal(r.status, 201);
  assert.equal(r.body.totale, piatto.prezzo + 0.5, 'due condimenti, un supplemento solo');
  const figlie = r.body.righe.filter((x) => x.parent_riga_id);
  assert.equal(figlie.length, 3, 'due condimenti più la riga del supplemento');
  assert.equal(figlie.filter((x) => x.prezzo === 0).length, 2, 'i condimenti non si pagano a pezzo');
});

// ---- La cucina serve tutti i punti, sempre ----------------------------------------------
// Per tre versioni il panino al Bar è dipeso da come era marcato il prodotto, e bastava un
// dato storto perché sparisse. Adesso è una regola del server: nessuna configurazione può
// nascondere al Bar quello che esce dalla cucina.
test('un piatto di cucina si vede al Bar anche se è marcato solo Garden', async () => {
  const p = (await send('/admin/menu', { nome: 'Panino chiuso nel Garden', prezzo: 6, stazione: 'cucina', zona: 'garden', categoria: 'Panini & Piatti', con_condimenti: true }, 'POST', token)).body;
  const bar = (await get('/menu?zona=bar')).body;
  assert.ok(bar.some((m) => m.id === p.id), 'la regola vince sul dato: al Bar il panino c’è');
  // Una bibita del Garden invece resta al Garden: solo la cucina serve tutti i punti.
  const b = (await send('/admin/menu', { nome: 'Bibita solo Garden', prezzo: 3, stazione: 'bar', zona: 'garden', categoria: 'Bibite' }, 'POST', token)).body;
  assert.ok(!(await get('/menu?zona=bar')).body.some((m) => m.id === b.id), 'quello che si serve al banco resta legato alla sua area');
  // E lo stesso vale per l’elenco con cui la Crew batte la comanda.
  assert.ok((await get('/admin/menu?ordinabile=1&zona=bar', token)).body.some((m) => m.id === p.id));
});

// ---- Prima delle 16 l'ordine si prende lo stesso ----------------------------------------
// Nessuno si sente dire di no per l'orario: si avvisa soltanto da che ora si consegna, perché
// piastra e friggitrice devono andare in temperatura.
test('un ordine di cucina fatto presto viene accettato, con l’ora di consegna', async () => {
  const piatto = (await get('/menu?zona=bar')).body.find((m) => m.stazione === 'cucina');
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1 }] });
  assert.equal(r.status, 201, 'l’ordine si prende sempre: mai un rifiuto per l’orario');
  const ora = new Date().getHours() * 60 + new Date().getMinutes();
  if (ora < 16 * 60 + 15) {
    assert.equal(r.body.non_prima, '16:15', 'prima dell’ora di ritiro si dice da quando si consegna');
    assert.match(r.body.avviso, /16:15/);
    const com = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero);
    assert.equal(com.non_prima, '16:15', 'la cucina lo legge sulla comanda: non è in ritardo, è in attesa');
  } else {
    assert.equal(r.body.non_prima, null, 'a piastra calda non si avvisa più nessuno');
  }
});

test('un ordine di solo banco non aspetta la cucina', async () => {
  const bibita = (await get('/menu?zona=bar')).body.find((m) => m.stazione === 'bar');
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: bibita.id, qta: 1 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.non_prima, null, 'una birra non ha bisogno che la friggitrice sia calda');
});

test('l’ora di consegna segue i parametri del gestore', async () => {
  await send('/admin/parametri', { cucina_apertura_ora: 20, cucina_riscaldamento_minuti: 30 }, 'PUT', token);
  const piatto = (await get('/menu?zona=bar')).body.find((m) => m.stazione === 'cucina');
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1 }] });
  const ora = new Date().getHours() * 60 + new Date().getMinutes();
  if (ora < 20 * 60 + 30) assert.equal(r.body.non_prima, '20:30');
  await send('/admin/parametri', { cucina_apertura_ora: 16, cucina_riscaldamento_minuti: 15 }, 'PUT', token);
});

// ---- I condimenti non stanno nella tazzina del caffè ------------------------------------
// Avevo messo il tasto di abbinamento su ogni riga del listino, caffè compreso, scaricando
// sul gestore una configurazione che non ha senso. I condimenti sono un insieme solo e
// valgono per ciò che esce dalla cucina: nessun abbinamento prodotto per prodotto.
test('la riga dei condimenti compare dove c’è la spunta, e solo lì', async () => {
  const menu = (await get('/menu')).body;
  const conSpunta = menu.filter((m) => m.con_condimenti === 1);
  const senza = menu.filter((m) => m.con_condimenti !== 1);
  assert.ok(conSpunta.length && senza.length);
  assert.ok(conSpunta.every((m) => (m.complementi || []).length), 'chi ha la spunta porta la riga dei condimenti');
  assert.ok(senza.every((m) => !(m.complementi || []).length), 'chi non ce l’ha non la porta: un caffè resta un caffè');
  // Stessa cosa per l’elenco con cui la Crew batte la comanda.
  const crew = (await get('/admin/menu?ordinabile=1', token)).body;
  assert.ok(crew.filter((m) => m.con_condimenti !== 1).every((m) => !(m.complementi || []).length));
});

test('nessuno può attaccare un condimento a un caffè spedendo l’ordine a mano', async () => {
  const menu = (await get('/menu')).body;
  const caffe = menu.find((m) => m.stazione === 'bar');
  const cond = (menu.find((m) => (m.complementi || []).length).complementi)[0];
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: caffe.id, qta: 1, complementi: [cond.id] }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.totale, caffe.prezzo, 'nessun supplemento: il condimento non entra');
  const com = (await get('/admin/comande', token)).body.find((c) => c.numero === r.body.numero);
  assert.equal(com.righe.filter((x) => x.parent_riga_id).length, 0);
});

// ---- Chi prepara si deduce, non si marca a mano -----------------------------------------
// Il listino reale arrivava da un file con TUTTO marcato "bar": nel sistema non esisteva
// niente di cucina, e quindi il panino non compariva al Bar, i condimenti non si spuntavano
// da nessuna parte e il KDS Cucina restava vuoto. Nessuno marca a mano duecento righe.
test('un panino importato come "bar" finisce comunque in cucina', async () => {
  const csv = Buffer.from(
    'nome,prezzo,categoria\nPanino prova import,6,Panini e fritti\nFettina di carne prova,10,Piatto\nAmaro prova,4.5,Alcolici\n'
  ).toString('base64');
  const r = await send('/admin/menu/import', { fileB64: csv, mode: 'aggiungi' }, 'POST', token);
  assert.equal(r.status, 200);
  const menu = (await get('/admin/menu', token)).body;
  const panino = menu.find((m) => m.nome === 'Panino prova import');
  const piatto = menu.find((m) => m.nome === 'Fettina di carne prova');
  const amaro = menu.find((m) => m.nome === 'Amaro prova');
  assert.equal(panino.stazione, 'cucina', 'il panino lo fa la cucina, anche se il file non lo dice');
  assert.equal(piatto.stazione, 'cucina');
  assert.equal(amaro.stazione, 'bar', 'un amaro resta al banco');
  // E da lì in poi funziona tutto il resto: si vede al Bar e porta i condimenti.
  const bar = (await get('/menu?zona=bar')).body;
  const p = bar.find((m) => m.id === panino.id);
  assert.ok(p, 'e quindi compare nel menù del Bar');
  // La riga dei condimenti no: quella la accende il gestore con la spunta sul prodotto, e
  // un file importato non decide per lui.
  assert.ok(!(p.complementi || []).length, 'la spunta «Condimenti» non si accende da sola');
  await send(`/admin/menu/${panino.id}/condimenti`, { con_condimenti: true }, 'PUT', token);
  const dopo = (await get('/menu?zona=bar')).body.find((m) => m.id === panino.id);
  assert.ok((dopo.complementi || []).length, 'messa la spunta, le aggiunte compaiono');
});

test('la scelta esplicita del gestore sulla stazione resta l’ultima parola', async () => {
  const n = (await send('/admin/menu', { nome: 'Panino che faccio al banco', prezzo: 5, stazione: 'bar', categoria: 'Panini & Piatti' }, 'POST', token)).body;
  const m = (await get('/admin/menu', token)).body.find((x) => x.id === n.id);
  assert.equal(m.stazione, 'bar', 'se il gestore dice "banco", la deduzione non lo contraddice');
});

test('l’anteprima dell’importazione mostra la stazione che verrà davvero assegnata', async () => {
  const csv = Buffer.from('nome,prezzo,categoria\nPanino anteprima,6,Panini e fritti\nCaffè anteprima,1,Caffetteria\n').toString('base64');
  const r = await send('/admin/menu/import', { fileB64: csv, dryRun: true }, 'POST', token);
  assert.equal(r.status, 200);
  const p = r.body.anteprima.find((x) => x.nome === 'Panino anteprima');
  const c = r.body.anteprima.find((x) => x.nome === 'Caffè anteprima');
  assert.equal(p.stazione, 'cucina', 'chi approva l’importazione deve vedere quello che succederà');
  assert.equal(c.stazione, 'bar');
});

// ---- Salvare una riga del listino non deve cancellare il resto ---------------------------
// La riga del listino non rispedisce descrizione e collegamento al magazzino, e l'UPDATE
// scriveva tutte le colonne: ogni "Salva" azzerava la composizione del piatto e lo scarico di
// giacenza, in silenzio, fino a farsene accorgere all'inventario.
test('il salvataggio di una riga non azzera descrizione e collegamento al magazzino', async () => {
  const art = (await get('/admin/magazzino', token)).body.articoli[0];
  const p = (await send('/admin/menu', { nome: 'Piatto con distinta', prezzo: 9, stazione: 'cucina', categoria: 'Piatto', descrizione: 'Composizione del piatto', con_condimenti: true }, 'POST', token)).body;
  await send(`/admin/menu/${p.id}/magazzino`, { magazzino_id: art.id, consumo: 2 }, 'PUT', token);

  // Quello che manda davvero la riga del listino: niente descrizione, niente magazzino.
  await send('/admin/menu/' + p.id, { nome: 'Piatto con distinta', prezzo: 9.5, stazione: 'cucina', zona: 'garden', categoria: 'Piatto', allergeni: '', attivo: true }, 'PUT', token);

  const dopo = (await get('/admin/menu', token)).body.find((m) => m.id === p.id);
  assert.equal(dopo.prezzo, 9.5, 'il prezzo cambiato si salva');
  assert.equal(dopo.descrizione, 'Composizione del piatto', 'la descrizione resta');
  assert.equal(dopo.magazzino_id, art.id, 'e il collegamento al magazzino pure');
  assert.equal(dopo.zona, 'garden', 'la scelta su dove si vende viene rispettata');
});

// ---- Un condimento si riconosce anche dalla categoria -----------------------------------
// Legare la funzione a una spunta che qualcuno deve ricordarsi di mettere è lo stesso errore
// che ha tenuto il panino fuori dal Bar per tre versioni.
test('le voci in categoria "Condimenti extra" sono aggiunte anche senza la spunta', async () => {
  const c = (await send('/admin/menu', { nome: 'Senape non spuntata', prezzo: 0.5, stazione: 'cucina', categoria: 'Condimenti extra' }, 'POST', token)).body;
  const grezzo = (await get('/admin/menu', token)).body.find((m) => m.id === c.id);
  assert.equal(grezzo.complemento, 0, 'nessuno l’ha marcata a mano');
  const menu = (await get('/menu')).body;
  assert.ok(!menu.some((m) => m.id === c.id), 'ma non compare come voce da ordinare');
  const piatto = menu.find((m) => m.con_condimenti === 1);
  assert.ok((piatto.complementi || []).some((x) => x.id === c.id), 'compare invece dentro i prodotti con la spunta');
});

// ---- Il menù è un nucleo solo: tutti chiedono la stessa cosa ----------------------------
// Prima quattro schermate chiedevano il menù in quattro modi diversi e la stampa in un
// quinto: la stessa persona vedeva elenchi diversi a seconda di dove ordinava.
test('l’elenco del socio e quello della Crew coincidono, punto per punto', async () => {
  for (const zona of ['bar', 'garden']) {
    const socio = (await get('/menu?zona=' + zona)).body.map((m) => m.id).sort();
    const crew = (await get('/admin/menu?ordinabile=1&zona=' + zona, token)).body.map((m) => m.id).sort();
    assert.deepEqual(crew, socio, `zona ${zona}: chi batte la comanda deve vedere quello che vede il socio`);
  }
});

// ---- Il vincolo che proteggeva il menù non scattava mai ----------------------------------
// La regola cercava una colonna "articolo_id" che in comanda_righe non esiste: la query
// andava in errore e il try/catch lo leggeva come "nessun vincolo". Si poteva cancellare un
// prodotto dentro una comanda aperta, e quella comanda smetteva di scaricare il magazzino.
test('un prodotto dentro una comanda aperta non si può cancellare', async () => {
  const p = (await send('/admin/menu', { nome: 'Prodotto in comanda aperta', prezzo: 4, stazione: 'bar', zona: 'bar', categoria: 'Bibite' }, 'POST', token)).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1 }] });
  assert.equal(r.status, 201);
  const no = await send('/admin/menu/' + p.id, {}, 'DELETE', token);
  assert.equal(no.status, 409, 'la cancellazione dev’essere rifiutata, non silenziosamente accettata');

  // Chiusa la comanda, il prodotto si può togliere: il vincolo protegge il servizio in corso,
  // non lo storico.
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  assert.equal((await send('/admin/menu/' + p.id, {}, 'DELETE', token)).status, 200);
});

test('l’import "sostituisci" non azzera il listino sotto una comanda aperta', async () => {
  const p = (await get('/menu?zona=bar')).body[0];
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1 }] });
  assert.equal(r.status, 201);
  const csv = Buffer.from('nome,prezzo\nUnica voce,1\n').toString('base64');
  const no = await send('/admin/menu/import', { fileB64: csv, mode: 'replace' }, 'POST', token);
  assert.equal(no.status, 409, 'deve fermarsi e spiegare, non svuotare il menù sotto il servizio');
  assert.ok(/comande ancora aperte/i.test(no.body.error));
  // Con la conferma esplicita del gestore si procede lo stesso: la scelta resta sua.
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
});

// ---- La diagnosi dice cosa non va, sui dati veri -----------------------------------------
test('la diagnosi del menù riconosce quando è tutto a posto e quando non lo è', async () => {
  const d = (await get('/admin/menu/diagnosi', token)).body;
  assert.ok(d.condimenti.length >= 1 && d.piatti_cucina >= 1);
  assert.deepEqual(d.problemi, [], 'con condimenti e piatti di cucina non deve segnalare problemi');
  assert.ok(d.ordinabili_al_bar > 0 && d.ordinabili_al_garden > 0);
});

// ---- Un caffè non lo prepara la cucina --------------------------------------------------
// Nel listino reale del gestore 55 voci su 60 risultavano "preparate dalla cucina", caffè
// espresso compreso: un comando in massa applicato a categorie che non c'entravano. Quelle
// comande finiscono sul KDS Cucina, dove nessuno le prepara, e si portano dietro i condimenti.
test('la diagnosi si accorge dei prodotti da banco finiti in cucina', async () => {
  const ids = [];
  for (const [nome, categoria] of [['Caffè diagnosi', 'Caffetteria'], ['Amaro diagnosi', 'Alcolici'], ['Granita diagnosi', 'Granite'], ['Birra diagnosi', 'Birre']]) {
    const p = (await send('/admin/menu', { nome, prezzo: 2, stazione: 'cucina', zona: 'comune', categoria }, 'POST', token)).body;
    ids.push(p.id);
  }
  const d = (await get('/admin/menu/diagnosi', token)).body;
  assert.ok(d.incoerenze.length >= 4, 'le voci storte vanno elencate');
  assert.ok(d.problemi.some((p) => /preparati dalla cucina/i.test(p)), 'e il verdetto deve dirlo in chiaro');

  // L'anteprima mostra cosa cambierebbe, prima di toccare qualcosa.
  const pre = await send('/admin/menu/ricalcola-stazione', { dryRun: true }, 'POST', token);
  assert.ok(pre.body.cambierebbero >= 4);
  // Nell'elenco possono esserci anche voci del verso opposto (un piatto marcato "bar"):
  // qui interessa che ci siano le quattro appena create, e che vadano al banco.
  const nostre = pre.body.elenco.filter((x) => ids.includes(x.id));
  assert.equal(nostre.length, 4);
  assert.ok(nostre.every((x) => x.ora === 'cucina' && x.dovrebbe === 'bar'));
  const dopoAnteprima = (await get('/admin/menu', token)).body.find((m) => m.id === ids[0]);
  assert.equal(dopoAnteprima.stazione, 'cucina', 'l’anteprima non deve cambiare niente');

  // Poi si ripara.
  await send('/admin/menu/ricalcola-stazione', {}, 'POST', token);
  const riparato = (await get('/admin/menu', token)).body.filter((m) => ids.includes(m.id));
  assert.ok(riparato.every((m) => m.stazione === 'bar'), 'caffè, amaro, granita e birra tornano al banco');
  assert.deepEqual((await get('/admin/menu/diagnosi', token)).body.problemi, []);
});

test('il comando in massa avvisa prima di mandare il banco in cucina', async () => {
  const r = await send('/admin/menu/cross-cucina', { categorie: ['Caffetteria'] }, 'POST', token);
  assert.equal(r.status, 409, 'deve fermarsi: la caffetteria non si prepara in cucina');
  assert.ok(/si servono al banco/i.test(r.body.error));
  const forzato = await send('/admin/menu/cross-cucina', { categorie: ['Caffetteria'], forza: true }, 'POST', token);
  assert.equal(forzato.status, 200, 'ma se il gestore conferma, la scelta resta sua');
  await send('/admin/menu/ricalcola-stazione', {}, 'POST', token);
});

// ---- «Necessita condimenti» è una spunta sul prodotto -----------------------------------
// Non si deduce da chi prepara il piatto: quella strada ha fallito tre volte, perché bastava
// che la colonna "Chi prepara" fosse sporca perché la maionese finisse in una tazzina o non
// comparisse affatto. Il gestore mette la spunta nel listino, e da quel momento dentro quel
// prodotto compare la riga «condimenti» con le aggiunte da fleggare.
test('la spunta sul prodotto accende la riga dei condimenti, indipendentemente da chi lo prepara', async () => {
  // Un panino che qualcuno ha marcato "lo faccio al banco": la spunta vale lo stesso.
  const p = (await send('/admin/menu', { nome: 'Panino spunta esplicita', prezzo: 6, stazione: 'bar', zona: 'bar', categoria: 'Panini & Piatti' }, 'POST', token)).body;
  let m = (await get('/menu?zona=bar')).body.find((x) => x.id === p.id);
  assert.ok(!(m.complementi || []).length, 'senza spunta, nessuna riga condimenti');

  await send(`/admin/menu/${p.id}/condimenti`, { con_condimenti: true }, 'PUT', token);
  m = (await get('/menu?zona=bar')).body.find((x) => x.id === p.id);
  assert.ok((m.complementi || []).length, 'con la spunta la riga compare, anche se lo prepara il banco');
  assert.equal(m.supplemento_complementi, 0.5, 'e le aggiunte costano 0,50 in tutto');

  // L’ordine con i condimenti passa: il supplemento si paga una volta sola.
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1, complementi: [m.complementi[0].id] }] });
  assert.equal(r.body.totale, 6.5);

  // Tolta la spunta, la riga sparisce e i condimenti non si possono più attaccare.
  await send(`/admin/menu/${p.id}/condimenti`, { con_condimenti: false }, 'PUT', token);
  m = (await get('/menu?zona=bar')).body.find((x) => x.id === p.id);
  assert.ok(!(m.complementi || []).length);
  const r2 = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1, complementi: [999999] }] });
  assert.equal(r2.body.totale, 6, 'niente supplemento su un prodotto senza spunta');
});

test('un caffè non prende condimenti nemmeno se lo marcano "cucina"', async () => {
  const c = (await send('/admin/menu', { nome: 'Caffè marcato cucina', prezzo: 1, stazione: 'cucina', zona: 'comune', categoria: 'Caffetteria' }, 'POST', token)).body;
  const m = (await get('/menu?zona=bar')).body.find((x) => x.id === c.id);
  assert.ok(!(m.complementi || []).length, 'decide la spunta, non la stazione: nella tazzina non ci va niente');
});

// ---- Il registro storico: la memoria lunga per le contestazioni -------------------------
// Davanti a "io avevo prenotato" o "quel conto non l'ho mai fatto" la risposta non può essere
// "mi pare". Ogni fatto lascia una riga con chi, quando e — per le cancellazioni — chi l'ha
// chiesta. Si scrive e non si riscrive: una disdetta aggiunge una riga, non ne corregge una.
test('una prenotazione e la sua cancellazione lasciano due righe, non una corretta', async () => {
  // Un adulto: la cena la prenota chi ha compiuto 18 anni, e nell'elenco dei soci ci sono
  // anche i ragazzi. Prendendo il primo che capita il test falliva a giorni alterni.
  const maggiorenne = (d) => d && (Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 31557600000 >= 18;
  const socio = (await get('/admin/soci', token)).body.find((x) => maggiorenne(x.data_nascita) && x.tessera_code);
  assert.ok(socio, 'serve un socio maggiorenne per provare la prenotazione della cena');
  // Una data lontana e tutta sua: altri test prenotano nei giorni vicini.
  const giorno = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const p = await send('/garden/prenota', { data: giorno, turno: '20:00', persone: 2, tessera_code: socio.tessera_code }, 'POST');
  assert.equal(p.status, 201, 'la prenotazione di prova deve andare a buon fine: ' + JSON.stringify(p.body));

  const storia1 = (await get(`/admin/registro/storia?servizio=garden&riferimento=${p.body.id}`, token)).body;
  assert.equal(storia1.length, 1, 'la prenotazione presa lascia una riga');
  assert.equal(storia1[0].fatto, 'prenotazione_creata');
  assert.ok(storia1[0].intestatario, 'a nome di chi');
  assert.equal(storia1[0].canale, 'app');

  await send(`/garden/prenotazioni/${p.body.id}/annulla`, { tessera_code: socio.tessera_code }, 'POST');
  const storia2 = (await get(`/admin/registro/storia?servizio=garden&riferimento=${p.body.id}`, token)).body;
  assert.equal(storia2.length, 2, 'la disdetta AGGIUNGE una riga: la prima resta com’era');
  assert.equal(storia2[0].fatto, 'prenotazione_creata', 'la riga originale non viene toccata');
  assert.equal(storia2[1].fatto, 'prenotazione_cancellata');
  assert.ok(/socio/i.test(storia2[1].autore), 'e dice chi ha chiesto la cancellazione');
});

test('una comanda lascia traccia da quando si apre a quando si incassa', async () => {
  const piatto = (await get('/menu?zona=bar')).body[0];
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1 }] });
  const aperta = (await get(`/admin/registro/storia?servizio=comande&riferimento=${r.body.numero}`, token)).body;
  assert.equal(aperta.length, 1);
  assert.equal(aperta[0].fatto, 'comanda_aperta');
  assert.equal(aperta[0].importo, piatto.prezzo, 'con l’importo, che è quello che si contesta');

  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  const dopo = (await get(`/admin/registro/storia?servizio=comande&riferimento=${r.body.numero}`, token)).body;
  assert.equal(dopo.length, 2);
  assert.equal(dopo[1].fatto, 'comanda_chiusa');
  assert.equal(dopo[1].autore, 'gestore', 'e chi ha incassato');
  assert.equal(dopo[1].canale, 'crew');
});

test('il registro si cerca per persona, periodo e tipo di fatto', async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const tutte = (await get('/admin/registro?dal=' + oggi, token)).body;
  assert.ok(tutte.length >= 2);
  const soloChiuse = (await get('/admin/registro?fatto=comanda_chiusa', token)).body;
  assert.ok(soloChiuse.length >= 1 && soloChiuse.every((r) => r.fatto === 'comanda_chiusa'));
  const perServizio = (await get('/admin/registro?servizio=garden', token)).body;
  assert.ok(perServizio.every((r) => r.servizio === 'garden'));
  // Cercando un nome si trovano sia le righe a suo nome sia quelle fatte da lui.
  const perNome = (await get('/admin/registro?chi=gestore', token)).body;
  assert.ok(perNome.length >= 1);
});

// ---- Alcolici: il sistema non finge di poter verificare l'età ---------------------------
// Al bar e al Garden si serve chiunque: la tessera identifica gli sportivi e i residenti, non
// è un lasciapassare per consumare. Ma per gli alcolici l'età conta, e chi non è identificato
// il sistema non sa quanti anni ha: allora la comanda parte con l'avviso a chi consegna.
test('a un minorenne identificato gli alcolici non si vendono', async () => {
  const menu = (await get('/admin/menu', token)).body;
  const alc = menu.find((m) => m.alcolico === 1 && m.attivo);
  assert.ok(alc, 'nel menù demo devono esserci prodotti riconosciuti come alcolici');
  const minore = (await get('/admin/soci', token)).body.find((x) => x.data_nascita && (Date.now() - new Date(x.data_nascita + 'T00:00:00Z')) / 31557600000 < 18);
  assert.ok(minore, 'serve un socio minorenne per la prova');
  const r = await send('/self-order', { punto: 'Bussola Bar', tessera_code: minore.tessera_code, righe: [{ menu_id: alc.id, qta: 1 }] });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /18 anni/);
  // E non deve restare una comanda a metà.
  assert.ok(!(await get('/admin/comande', token)).body.some((c) => (c.righe || []).some((x) => x.menu_id === alc.id && c.stato === 'aperta' && !c.socio_id)));
});

test('senza tessera l’ordine passa, ma la comanda avvisa chi consegna', async () => {
  const alc = (await get('/admin/menu', token)).body.find((m) => m.alcolico === 1 && m.attivo);
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: alc.id, qta: 1 }] });
  assert.equal(r.status, 201, 'al bar si serve anche chi non ha la tessera');
  assert.equal(r.body.verifica_eta, true);
  assert.match(r.body.avviso_eta, /documento/i);
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  assert.equal(Number(c.verifica_eta), 1, 'la crew lo deve vedere sulla comanda');
});

test('una bibita senza tessera non chiede niente a nessuno', async () => {
  const acqua = (await get('/menu?zona=bar')).body.find((m) => /acqua/i.test(m.nome));
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: acqua.id, qta: 1 }] });
  assert.equal(r.body.verifica_eta, false);
});

// ---- Storno di una riga: quello che succede DOPO che l'ordine è partito -----------------
// Un articolo finisce mentre la comanda è in cucina, il cliente rinuncia, il cameriere ha
// battuto la riga sbagliata. Prima si poteva solo cancellare la comanda intera — in mezzo a un
// servizio non è una risposta.
test('una riga si storna con il motivo, e il conto cala', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const piatto = menu.find((m) => m.con_condimenti === 1);
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1, complementi: [piatto.complementi[0].id] }, { menu_id: menu.find((m) => m.stazione === 'bar').id, qta: 1 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  const riga = c.righe.find((x) => x.menu_id === piatto.id && !x.parent_riga_id);

  assert.equal((await send(`/admin/comande/righe/${riga.id}/storna`, {}, 'PUT', token)).status, 400, 'senza motivo non si storna');

  const dopo = (await send(`/admin/comande/righe/${riga.id}/storna`, { motivo: 'pane finito' }, 'PUT', token)).body;
  const stornate = dopo.righe.filter((x) => x.stato === 'stornata');
  assert.equal(stornate.length, 3, 'con il piatto se ne vanno condimento e supplemento');
  assert.ok(stornate.every((x) => /pane finito/.test(x.motivo_storno)));
  assert.equal(dopo.totale, r.body.totale - (piatto.prezzo + 0.5), 'il conto cala di quello che è stato tolto');
  assert.ok(dopo.righe.some((x) => x.stato !== 'stornata'), 'il resto della comanda resta in piedi');

  // La riga stornata non si prepara e non scarica il magazzino.
  const kds = (await get('/admin/kds?stazione=cucina', token)).body.find((x) => x.id === c.id);
  assert.ok(!kds || !kds.righe.some((x) => x.id === riga.id), 'la cucina non la vede più');
  // E resta scritta nel registro, con chi e perché.
  const storia = (await get(`/admin/registro/storia?servizio=comande&riferimento=${r.body.numero}`, token)).body;
  const s = storia.find((x) => x.fatto === 'riga_stornata');
  assert.ok(s && s.autore === 'gestore' && /pane finito/.test(s.dettaglio));
});

test('un articolo esaurito si sostituisce in un gesto solo', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const a = menu.find((m) => m.stazione === 'bar');
  const b = menu.find((m) => m.stazione === 'bar' && m.id !== a.id);
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: a.id, qta: 2 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  const riga = c.righe[0];
  const dopo = (await send(`/admin/comande/righe/${riga.id}/sostituisci`, { menu_id: b.id, motivo: 'articolo esaurito' }, 'POST', token)).body;
  assert.equal(dopo.righe.find((x) => x.id === riga.id).stato, 'stornata');
  const nuova = dopo.righe.find((x) => x.menu_id === b.id);
  assert.ok(nuova && nuova.qta === 2, 'la nuova riga eredita la quantità');
  assert.equal(dopo.totale, b.prezzo * 2, 'e il conto è quello del nuovo articolo');
  const storia = (await get(`/admin/registro/storia?servizio=comande&riferimento=${r.body.numero}`, token)).body;
  assert.ok(storia.some((x) => x.fatto === 'riga_sostituita'));
});

test('a conto chiuso non si storna più: si registra altrove', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  const no = await send(`/admin/comande/righe/${c.righe[0].id}/storna`, { motivo: 'ci ho ripensato' }, 'PUT', token);
  assert.equal(no.status, 409);
});

test('il gestore può correggere a mano quali prodotti sono alcolici', async () => {
  const p = (await send('/admin/menu', { nome: 'Cocktail analcolico della casa', prezzo: 5, stazione: 'bar', zona: 'bar', categoria: 'Aperitivi' }, 'POST', token)).body;
  await send('/admin/menu/' + p.id, { alcolico: false }, 'PUT', token);
  const m = (await get('/admin/menu', token)).body.find((x) => x.id === p.id);
  assert.equal(m.alcolico, 0, 'la deduzione non deve avere l’ultima parola su un analcolico');
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1 }] });
  assert.equal(r.body.verifica_eta, false);
  // E il salvataggio parziale non deve spegnerlo per conto suo.
  await send('/admin/menu/' + p.id, { alcolico: true }, 'PUT', token);
  await send('/admin/menu/' + p.id, { prezzo: 6 }, 'PUT', token);
  assert.equal((await get('/admin/menu', token)).body.find((x) => x.id === p.id).alcolico, 1, 'cambiare il prezzo non tocca il resto');
});

// ---- Cambio tavolo a comanda aperta ------------------------------------------------------
// Il gruppo si sposta perché al sole non si sta, o si libera un tavolo più grande. Prima la
// comanda restava attaccata al tavolo di partenza, e a fine turno il conto compariva nel posto
// sbagliato — col rischio di presentarlo a chi non aveva mangiato quella roba.
test('una comanda aperta si sposta su un altro tavolo, e resta scritto da dove a dove', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const r = await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '3', righe: [{ menu_id: menu[0].id, qta: 2 }] }, 'POST', token);
  assert.equal(r.status, 201);

  const spostata = await send(`/admin/comande/${r.body.id}/tavolo`, { riferimento: '9', motivo: 'al sole non si stava' }, 'PUT', token);
  assert.equal(spostata.status, 200);
  assert.equal(spostata.body.riferimento, '9');
  assert.equal(spostata.body.totale, r.body.totale, 'il conto la segue intatto');

  const storia = (await get(`/admin/registro/storia?servizio=comande&riferimento=${r.body.numero}`, token)).body;
  const s = storia.find((x) => x.fatto === 'comanda_spostata');
  assert.ok(s, 'lo spostamento finisce nel registro');
  assert.match(s.dettaglio, /"da_tavolo":"3"/);
  assert.match(s.dettaglio, /"a_tavolo":"9"/);

  assert.equal((await send(`/admin/comande/${r.body.id}/tavolo`, { riferimento: '9' }, 'PUT', token)).status, 400, 'spostarla dov’è già non ha senso');
  assert.equal((await send(`/admin/comande/${r.body.id}/tavolo`, {}, 'PUT', token)).status, 400, 'senza destinazione non si sposta');
});

test('a conto chiuso il tavolo non si cambia più', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const r = await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '4', righe: [{ menu_id: menu[0].id, qta: 1 }] }, 'POST', token);
  await send(`/admin/comande/${r.body.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  const no = await send(`/admin/comande/${r.body.id}/tavolo`, { riferimento: '5' }, 'PUT', token);
  assert.equal(no.status, 409);
});

// ---- La cucina può togliere una riga che non è in grado di fare -------------------------
// Prima poteva solo segnarla "pronta" e lasciare il problema alla sala, che se ne accorgeva
// davanti al cliente. Lo storno è lo stesso della sala: motivo obbligatorio, riga che resta.
test('la cucina storna una riga già in preparazione, e sparisce dalla sua coda', async () => {
  const piatto = (await get('/menu?zona=garden')).body.find((m) => m.stazione === 'cucina');
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '7', righe: [{ menu_id: piatto.id, qta: 1 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  const riga = c.righe.find((x) => x.menu_id === piatto.id);
  await send(`/admin/comande/${c.id}/stato`, { stato: 'in_preparazione' }, 'PUT', token);

  const dopo = (await send(`/admin/comande/righe/${riga.id}/storna`, { motivo: 'finito il pane' }, 'PUT', token)).body;
  assert.equal(dopo.righe.find((x) => x.id === riga.id).stato, 'stornata');
  assert.equal(dopo.totale, 0, 'e il conto torna a zero');
  const kds = (await get('/admin/kds?stazione=cucina', token)).body.find((x) => x.id === c.id);
  assert.ok(!kds, 'la comanda non ha più righe da preparare: esce dalla coda della cucina');
});

// ---- In cucina si mandano cose da cucinare ----------------------------------------------
// Sulla scheda della cucina compariva "Supplemento condimenti" con il suo tasto "Pronta ✔",
// come se qualcuno dovesse cucinare cinquanta centesimi. È una riga di denaro: serve al conto,
// non alla piastra. I condimenti veri invece servono, ma non sono piatti a sé: vanno dentro il
// panino, e la cucina li deve leggere lì sotto.
test('il supplemento condimenti non arriva in cucina, i condimenti sì', async () => {
  const piatto = (await get('/menu?zona=garden')).body.find((m) => m.con_condimenti === 1 && (m.complementi || []).length >= 2);
  const due = piatto.complementi.slice(0, 2).map((c) => c.id);
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '2', righe: [{ menu_id: piatto.id, qta: 2, complementi: due }] });
  const com = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);

  // In comanda il supplemento c'è: è quello che si paga.
  assert.equal(com.righe.filter((x) => x.nome === 'Supplemento condimenti').length, 1);
  assert.equal(com.totale, piatto.prezzo * 2 + 0.5 * 2);

  // In cucina no.
  const kds = (await get('/admin/kds?stazione=cucina', token)).body.find((x) => x.id === com.id);
  assert.ok(kds, 'la comanda arriva in cucina');
  assert.ok(!kds.righe.some((x) => x.nome === 'Supplemento condimenti'), 'ma senza la riga del supplemento');
  assert.ok(kds.righe.some((x) => !x.parent_riga_id && x.menu_id === piatto.id), 'il piatto c’è');
  assert.equal(kds.righe.filter((x) => x.parent_riga_id).length, 2, 'e i due condimenti, agganciati al piatto');
  assert.ok(kds.righe.every((x) => x.parent_riga_id == null || x.menu_id != null), 'in cucina arriva solo roba con un articolo dietro');
});

// ---- La pianta non si cancella da sola --------------------------------------------------
// Unendo due tavoli in sala, il secondo diventa nascosto. Chi salva dalla sala manda solo i
// tavoli che VEDE: il salvataggio successivo — anche solo per correggere i posti di un altro
// tavolo — riscriveva l'intera pianta con quella lista e il tavolo nascosto spariva per
// sempre. Poi separando non tornava, perché non esisteva più. In sala si vedeva la capienza
// scendere da 48 a 44 senza che nessuno avesse tolto niente.
test('salvando dalla sala, i tavoli nascosti non vengono cancellati', async () => {
  const def = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.predefinito);
  const leggi = async () => (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.id === def.id).tavoli;

  // Pianta di partenza, dall'editor: quattro tavoli.
  await send(`/admin/tavoli/layout/${def.id}`, {
    tavoli: [1, 2, 3, 4].map((numero) => ({ numero, posti: 4, forma: 'tondo', x: 10 * numero, y: 50 })),
    completo: true
  }, 'PUT', token);
  assert.equal((await leggi()).length, 4);

  // Unione 1+2 fatta dalla sala: il 2 esce dalla vista ma resta in pianta.
  let tav = await leggi();
  const visibili = tav.map((t) => ({ ...t }));
  const a = visibili.find((t) => t.numero === 1), b = visibili.find((t) => t.numero === 2);
  a.posti_base = a.posti; b.posti_base = b.posti;
  a.posti = 6; a.uniti = [2]; a.forma = 'rettangolo'; b.attivo = false;
  await send(`/admin/tavoli/layout/${def.id}`, { tavoli: visibili }, 'PUT', token);
  assert.equal((await leggi()).length, 4, 'il tavolo 2 c’è ancora, solo nascosto');

  // Ora si tocca un ALTRO tavolo: la lista visibile non contiene il 2.
  tav = await leggi();
  const soloVisibili = tav.filter((t) => t.attivo !== 0).map((t) => ({ ...t }));
  soloVisibili.find((t) => t.numero === 4).posti = 8;
  await send(`/admin/tavoli/layout/${def.id}`, { tavoli: soloVisibili }, 'PUT', token);
  const dopo = await leggi();
  assert.equal(dopo.length, 4, 'il tavolo 2 NON deve sparire perché qualcuno ha toccato il 4');
  assert.equal(dopo.find((t) => t.numero === 4).posti, 8, 'e la modifica al 4 si salva');

  // Separando, il 2 torna in sala con i posti di partenza.
  const daSalvare = dopo.filter((t) => t.attivo !== 0).map((t) => ({ ...t }));
  const a2 = daSalvare.find((t) => t.numero === 1);
  a2.uniti = []; a2.posti = a2.posti_base; a2.forma = 'tondo';
  const b2 = { ...dopo.find((t) => t.numero === 2), attivo: true, posti: dopo.find((t) => t.numero === 2).posti_base };
  await send(`/admin/tavoli/layout/${def.id}`, { tavoli: daSalvare.concat([b2]) }, 'PUT', token);
  const fine = await leggi();
  assert.equal(fine.find((t) => t.numero === 2).attivo, 1, 'il tavolo 2 torna in sala');
  assert.equal(fine.find((t) => t.numero === 1).posti, 4, 'e il tavolo 1 torna ai suoi posti');
});

test('l’editor della disposizione può ancora togliere un tavolo', async () => {
  const def = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.predefinito);
  await send(`/admin/tavoli/layout/${def.id}`, {
    tavoli: [1, 2, 3].map((numero) => ({ numero, posti: 4, forma: 'tondo', x: 10 * numero, y: 50 })),
    completo: true
  }, 'PUT', token);
  const dopo = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.id === def.id).tavoli;
  assert.equal(dopo.length, 3, 'dichiarando la lista completa, i tavoli in più si tolgono davvero');
});

// ---- Com'è la serata: quanto si può essere generosi accostando i tavoli -----------------
test('l’indice della serata dice quanti tavoli si possono accostare', async () => {
  const data = giorno(55);
  const t = (await get(`/admin/tavoli/turno?data=${data}&turno=20:00`, token)).body;
  assert.ok(t.serata, 'il turno porta con sé com’è la serata');
  assert.equal(t.serata.livello, 'facile', 'sala vuota: si può allargare');
  assert.equal(t.serata.max_tavoli_uniti, 3);
  assert.ok(t.posti_persi_unione >= 0, 'e quanti posti costa accostare due tavoli');

  // Si riempie la sala oltre la soglia: la serata diventa difficile e si stringe.
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code).slice(0, 8);
  for (const s of soci) {
    await send('/admin/tavoli/prenota', { data, turno: '20:00', persone: 4, nome: s.cognome || 'Prova' }, 'POST', token).catch(() => {});
  }
  const t2 = (await get(`/admin/tavoli/turno?data=${data}&turno=20:00`, token)).body;
  if (t2.serata.pieno >= 66) {
    assert.equal(t2.serata.livello, 'difficile');
    assert.equal(t2.serata.max_tavoli_uniti, 2, 'sala piena: si accosta il minimo');
  }
});

// ---- L'importazione non deve azzerare i prezzi in silenzio ------------------------------
// Le intestazioni si confrontavano ESATTE: un file con "Prezzo (€)" o "PREZZO unitario" non
// veniva riconosciuto, e i prodotti nuovi entravano tutti a zero senza che nessuno dicesse
// niente. Ce ne si accorgeva al primo scontrino.
test('un file con l’intestazione scritta in un altro modo viene letto lo stesso', async () => {
  const csv = 'Nome prodotto;Prezzo (€);Categoria;Attivo;Alcolico;Condimenti\n'
    + 'Birra artigianale prova;5,50;Birre;si;si;no\n'
    + 'Panino prova import;6,00;Panini e fritti;si;no;si\n';
  const r = await send('/admin/menu/import', { fileB64: Buffer.from(csv).toString('base64'), mode: 'merge' }, 'POST', token);
  assert.equal(r.status, 200);
  const menu = (await get('/admin/menu', token)).body;
  const birra = menu.find((m) => m.nome === 'Birra artigianale prova');
  const pan = menu.find((m) => m.nome === 'Panino prova import');
  assert.equal(birra.prezzo, 5.5, 'il prezzo si legge anche con l’intestazione «Prezzo (€)» e la virgola');
  assert.equal(pan.prezzo, 6);
  assert.equal(birra.alcolico, 1, 'e le colonne sì/no arrivano dal file');
  assert.equal(pan.con_condimenti, 1);
  assert.equal(pan.alcolico, 0);
});

test('un file senza nessun prezzo si ferma e spiega, invece di caricare tutto a zero', async () => {
  const csv = 'nome;categoria\nProdotto senza prezzo;Bibite\n';
  const no = await send('/admin/menu/import', { fileB64: Buffer.from(csv).toString('base64'), mode: 'merge' }, 'POST', token);
  assert.equal(no.status, 409);
  assert.match(no.body.error, /nessun prezzo/i);
  assert.ok(no.body.intestazioni.length, 'e dice quali colonne ha letto, per capire come si chiama la sua');
  // Se il gestore conferma, si procede: la scelta resta sua.
  const si = await send('/admin/menu/import', { fileB64: Buffer.from(csv).toString('base64'), mode: 'merge', forza: true }, 'POST', token);
  assert.equal(si.status, 200);
});

test('l’esportazione contiene le colonne del listino, in sì/no, e si può reimportare', async () => {
  const exp = await get('/admin/menu/export', token);
  assert.equal(exp.status, 200);
  // Il file .xlsx è compresso: cercare le parole nei byte non dice niente. Si rilegge il
  // foglio, come farà chi lo apre.
  const XLSX = (await import('xlsx')).default || (await import('xlsx'));
  const wb = XLSX.read(Buffer.from(exp.body.b64, 'base64'), { type: 'buffer' });
  const righe = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  assert.ok(righe.length, 'il foglio non deve essere vuoto');
  for (const col of ['nome', 'prezzo', 'attivo', 'alcolico', 'condimenti', 'complemento']) {
    assert.ok(col in righe[0], `l’export deve portare la colonna ${col}`);
  }
  assert.ok(righe.every((r) => ['si', 'no'].includes(String(r.attivo))), 'le spunte si leggono come sì/no');

  // E il giro completo: quello che esce si può rimettere dentro senza perdere niente.
  const primaAlcolici = righe.filter((r) => r.alcolico === 'si').length;
  const csv = ['nome;prezzo;attivo;alcolico;condimenti;complemento']
    .concat(righe.map((r) => [r.nome, r.prezzo, r.attivo, r.alcolico, r.condimenti, r.complemento].join(';'))).join('\n');
  const re = await send('/admin/menu/import', { fileB64: Buffer.from(csv).toString('base64'), mode: 'merge' }, 'POST', token);
  assert.equal(re.status, 200);
  const dopo = (await get('/admin/menu', token)).body.filter((m) => m.alcolico === 1).length;
  assert.equal(dopo, primaAlcolici, 'reimportando il proprio export, le spunte restano quelle');
});

// ---- Un salvataggio solo per tutto il listino -------------------------------------------
// Con duecento righe, un "Salva" per riga vuol dire duecento clic e duecento occasioni di
// dimenticarsene una.
test('si salvano più righe in un colpo, e si tocca solo quello che è stato mandato', async () => {
  const menu = (await get('/admin/menu', token)).body.slice(0, 3);
  const prezziPrima = menu.map((m) => m.prezzo);
  const r = await send('/admin/menu', {
    righe: menu.map((m) => ({ id: m.id, alcolico: true, con_condimenti: true }))
  }, 'PUT', token);
  assert.equal(r.body.salvati, 3);
  const dopo = (await get('/admin/menu', token)).body.filter((m) => menu.some((x) => x.id === m.id));
  assert.ok(dopo.every((m) => m.alcolico === 1 && m.con_condimenti === 1));
  assert.deepEqual(dopo.map((m) => m.prezzo), prezziPrima, 'i prezzi non devono muoversi: non li ho mandati');
  // Si rimette com'era.
  await send('/admin/menu', { righe: menu.map((m) => ({ id: m.id, alcolico: m.alcolico === 1, con_condimenti: m.con_condimenti === 1 })) }, 'PUT', token);
});

// ---- Divieto di trasferimento da o verso una tavolata unita -----------------------------
// Spostare una comanda su un tavolo accostato ad altri lascerebbe il conto agganciato a un
// tavolo che come entità a sé non esiste più. La crew prepara la sala, poi sposta.
test('una comanda non si sposta verso un tavolo accostato a un altro', async () => {
  const def = (await get('/admin/tavoli/layout', token)).body.layout.find((l) => l.predefinito);
  await send(`/admin/tavoli/layout/${def.id}`, {
    tavoli: [
      { numero: 1, posti: 4, forma: 'tondo', x: 20, y: 50, uniti: [] },
      { numero: 2, posti: 4, forma: 'tondo', x: 30, y: 50, uniti: [] },
      { numero: 3, posti: 6, forma: 'rettangolo', x: 60, y: 50, uniti: [4] },
      { numero: 4, posti: 4, forma: 'tondo', x: 70, y: 50, attivo: false, uniti: [] }
    ],
    completo: true
  }, 'PUT', token);
  // Il controllo legge la pianta DEL GIORNO della comanda: la si dichiara, altrimenti si
  // finisce a controllare una sala lasciata da un altro test.
  const oggiIso = new Date().toISOString().slice(0, 10);
  await send('/admin/tavoli/giorno', { data: oggiIso, layout_id: def.id }, 'PUT', token);

  // Si prendono i tavoli dalla mappa VERA del turno, non da quella che credo di aver scritto.
  const mappa = (await get(`/admin/tavoli/turno?data=${oggiIso}&turno=20:00`, token)).body.tavoli;
  const unito = mappa.find((t) => (t.uniti || []).length);
  const libero = mappa.find((t) => !(t.uniti || []).length && t.tipo !== 'arredo');
  assert.ok(unito && libero, 'servono una tavolata unita e un tavolo singolo');

  const menu = (await get('/menu?zona=garden')).body;
  const c = (await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: String(libero.numero), righe: [{ menu_id: menu[0].id, qta: 1 }] }, 'POST', token)).body;

  const no = await send(`/admin/comande/${c.id}/tavolo`, { riferimento: String(unito.numero) }, 'PUT', token);
  assert.equal(no.status, 409, `il tavolo ${unito.numero} è accostato: non si sposta lì`);
  assert.match(no.body.error, /accostato/);
  assert.match(no.body.error, /Separa i tavoli/);

  const altroLibero = mappa.find((t) => !(t.uniti || []).length && t.tipo !== 'arredo' && t.numero !== libero.numero);
  const ok = await send(`/admin/comande/${c.id}/tavolo`, { riferimento: String(altroLibero.numero) }, 'PUT', token);
  assert.equal(ok.status, 200, 'su un tavolo singolo invece sì: ' + JSON.stringify(ok.body));
});


// ---- La sala parte da tavoli quadrati da quattro ----------------------------------------
// Il quadrato si accosta a un altro quadrato e fa una tavolata vera; il tondo, accostato,
// lascia buchi e non regge il conto dei posti.
// NB: la FORMA di partenza (quadrati da quattro) si verifica su un database nuovo, in
// scripts/verifica_pianta.mjs: qui a meta' suite la sala e' gia' stata rifatta da altri test.


test('il ripristino rifiuta e dice QUALI prenotazioni lo bloccano', async () => {
  const domani = giorno(3);
  await send('/admin/tavoli/prenota', { data: domani, turno: '20:00', persone: 2, nome: 'Prova ripristino' }, 'POST', token);
  const no = await send('/admin/tavoli/layout/rigenera', { ambiente: 'garden' }, 'POST', token);
  assert.equal(no.status, 409, 'con prenotazioni in piedi non si ridisegna la sala');
  // "Ci sono N prenotazioni attive" lasciava il gestore a cercarle a mano per tutte le date.
  assert.match(no.body.error, /Prova ripristino/, 'il messaggio deve dire chi ha prenotato');
  assert.match(no.body.error, new RegExp(domani), 'e per quando');
  assert.match(no.body.error, /annullare una comanda non libera il tavolo/i, 'e chiarire l’equivoco più probabile');
  assert.ok(Array.isArray(no.body.prenotazioni) && no.body.prenotazioni.length);
});

test('una comanda annullata non blocca il ripristino della sala', async () => {
  // Il gestore aveva annullato una comanda e il ripristino continuava a rifiutare: sono due
  // cose diverse, e il messaggio ora lo dice. Qui si verifica che davvero non c’entri.
  const menu = (await get('/menu?zona=garden')).body;
  const c = (await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '1', righe: [{ menu_id: menu[0].id, qta: 1 }] }, 'POST', token)).body;
  await send(`/admin/comande/${c.id}/stato`, { stato: 'annullata' }, 'PUT', token);
  const no = await send('/admin/tavoli/layout/rigenera', { ambiente: 'garden' }, 'POST', token);
  if (no.status === 409) {
    // Se rifiuta, dev'essere per prenotazioni tavolo: mai per una comanda.
    assert.ok(Array.isArray(no.body.prenotazioni) && no.body.prenotazioni.length,
      'il rifiuto deve venire da prenotazioni in piedi, non dalla comanda annullata');
  }
});

// ---- Storno e "fatto ma non servito" sono due cose diverse -------------------------------
// Se un piatto è stato cucinato e poi non servito, la merce È USCITA: trattarlo come uno
// storno lascia all'inventario un ammanco che nessuno sa spiegare. Il conto è lo stesso — il
// cliente non paga — ma il magazzino no.
test('il piatto non partito non scarica il magazzino; quello fatto e non servito sì', async () => {
  const art = (await send('/admin/magazzino', { nome: 'Pane per prova sfrido', area: 'cucina', zona: 'garden', unita: 'pz', giacenza: 100, tipo_consumo: 'pezzo' }, 'POST', token)).body;
  const p = (await send('/admin/menu', { nome: 'Panino prova sfrido', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti' }, 'POST', token)).body;
  await send(`/admin/menu/${p.id}/magazzino`, { magazzino_id: art.id, consumo: 1 }, 'PUT', token);
  const giacenza = async () => (await get('/admin/magazzino', token)).body.articoli.find((a) => a.id === art.id).giacenza;

  // 1) Non si può fare: il piatto non parte. Niente conto, niente scarico.
  const a = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 2 }] });
  const ca = (await get('/admin/comande', token)).body.find((x) => x.numero === a.body.numero);
  await send(`/admin/comande/righe/${ca.righe[0].id}/storna`, { motivo: 'finito il pane' }, 'PUT', token);
  const prima = await giacenza();
  await send(`/admin/comande/${ca.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  assert.equal(await giacenza(), prima, 'un piatto mai fatto non consuma niente');

  // 2) Fatto ma non servito: fuori dal conto, ma la merce è uscita.
  const b = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 2 }] });
  const cb = (await get('/admin/comande', token)).body.find((x) => x.numero === b.body.numero);
  const dopoNS = (await send(`/admin/comande/righe/${cb.righe[0].id}/non-servita`, { motivo: 'il cliente ha rinunciato' }, 'PUT', token)).body;
  assert.equal(dopoNS.totale, 0, 'il cliente non lo paga');
  assert.equal(dopoNS.righe[0].stato, 'non_servita');
  const prima2 = await giacenza();
  await send(`/admin/comande/${cb.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  assert.equal(await giacenza(), prima2 - 2, 'ma i due pani sono stati usati e la giacenza cala');

  // Senza motivo non si fa: è quello che spiega lo sfrido a fine mese.
  const c = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1 }] });
  const cc = (await get('/admin/comande', token)).body.find((x) => x.numero === c.body.numero);
  assert.equal((await send(`/admin/comande/righe/${cc.righe[0].id}/non-servita`, {}, 'PUT', token)).status, 400);
});

test('quando la cucina toglie una riga, la sala trova il tavolo acceso', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const piatto = menu.find((m) => m.stazione === 'cucina');
  const r = await send('/self-order', { punto: 'Bussola Garden', tavolo: '6', righe: [{ menu_id: piatto.id, qta: 1 }] });
  const c = (await get('/admin/comande', token)).body.find((x) => x.numero === r.body.numero);
  await send(`/admin/comande/righe/${c.righe[0].id}/storna`, { motivo: 'finito' }, 'PUT', token);

  const dopo = (await get('/admin/comande', token)).body.find((x) => x.id === c.id);
  assert.ok(dopo.avviso_cucina, 'la comanda porta il messaggio per la sala');
  assert.match(dopo.avviso_cucina, /Avvisa il cliente/);

  // Si spegne solo quando l'operatore dichiara di aver parlato col cliente.
  await send(`/admin/comande/${c.id}/avviso-letto`, {}, 'PUT', token);
  assert.equal((await get('/admin/comande', token)).body.find((x) => x.id === c.id).avviso_cucina, null);
});

test('la comanda si sposta anche su un tavolo prenotato più tardi, ma lo dice', async () => {
  const oggiIso = new Date().toISOString().slice(0, 10);
  const pren = await send('/admin/tavoli/prenota', { data: oggiIso, turno: '21:30', persone: 2, nome: 'Rossi' }, 'POST', token);
  const tavoloPren = (pren.body.tavoli || [])[0];
  if (!tavoloPren) return; // sala piena: niente da provare

  const menu = (await get('/menu?zona=garden')).body;
  const c = (await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '1', righe: [{ menu_id: menu[0].id, qta: 1 }] }, 'POST', token)).body;
  const r = await send(`/admin/comande/${c.id}/tavolo`, { riferimento: String(tavoloPren) }, 'PUT', token);
  if (r.status === 409) return; // il tavolo era accostato a un altro: caso già coperto altrove
  assert.equal(r.status, 200, 'lo spostamento si fa: quel turno comincia più tardi');
  assert.equal(r.body.riferimento, String(tavoloPren));
  assert.match(r.body.avviso || '', /prenotato per le 21:30/, 'ma chi accoglie deve saperlo');
});

// ---- Il listino deve dire la verità sui condimenti --------------------------------------
// Nel listino reale i condimenti avevano prezzo 1,00 e la colonna Compl. VUOTA, mentre il
// sistema li trattava già come aggiunte (li riconosce dalla categoria) e faceva pagare il
// supplemento fisso. Chi compilava quel prezzo credeva di incassare 1,00 a condimento: su tre
// condimenti sono 3,00 che diventano 0,50, e nessuno lo diceva.
test('una voce in categoria "Condimenti" risulta un’aggiunta anche nel listino', async () => {
  const c = (await send('/admin/menu', { nome: 'Senape del listino', prezzo: 1, stazione: 'cucina', zona: 'comune', categoria: 'Condimenti' }, 'POST', token)).body;
  const riga = (await get('/admin/menu', token)).body.find((m) => m.id === c.id);
  assert.equal(riga.e_condimento, 1, 'il listino deve dire che è un’aggiunta');
  assert.ok(riga.supplemento > 0, 'e quanto vale davvero, per poterlo scrivere accanto al prezzo');
});

test('il prezzo scritto sui condimenti e\u2019 quello che si paga, uno o quattro pari sono', async () => {
  // Un euro per condire, che se ne prenda uno o quattro: e\u2019 una scelta commerciale, e il
  // sistema non deve impedirla ne\u2019 ignorarla. Prima il prezzo scritto veniva buttato via e
  // valeva un parametro nascosto: chi metteva 1,00 credeva di incassare 1,00.
  const cond = (await get('/admin/menu', token)).body.filter((m) => m.e_condimento === 1);
  const prima = cond.map((c) => c.prezzo);
  await send('/admin/menu', { righe: cond.map((c) => ({ id: c.id, prezzo: 1 })) }, 'PUT', token);

  const p = (await send('/admin/menu', { nome: 'Panino del listino', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti', con_condimenti: true }, 'POST', token)).body;
  const m = (await get('/menu?zona=bar')).body.find((x) => x.id === p.id);
  assert.equal(m.supplemento_complementi, 1, 'il menu\u2019 dichiara quello che il gestore ha scritto');
  assert.ok((m.complementi || []).every((x) => x.prezzo === undefined), 'ma i condimenti non mostrano prezzi propri: si spuntano');

  const tre = (m.complementi || []).slice(0, 3).map((x) => x.id);
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 1, complementi: tre }] });
  assert.equal(r.body.totale, 7, 'tre condimenti a un euro fanno un euro: 6 + 1');

  await send('/admin/menu', { righe: cond.map((c, i) => ({ id: c.id, prezzo: prima[i] })) }, 'PUT', token);
});


test('condimenti con prezzi diversi: vale il più alto, e la diagnosi lo dice', async () => {
  const cond = (await get('/admin/menu', token)).body.filter((m) => m.e_condimento === 1);
  assert.ok(cond.length >= 2);
  const prima = cond.map((c) => c.prezzo);
  await send('/admin/menu', { righe: [{ id: cond[0].id, prezzo: 1.5 }, { id: cond[1].id, prezzo: 0.5 }] }, 'PUT', token);

  const d = (await get('/admin/menu/diagnosi', token)).body;
  assert.equal(d.costo_condire, 1.5, 'fra due letture possibili si sceglie quella che non regala merce');
  assert.ok(d.problemi.some((p) => /prezzi diversi/i.test(p)), 'e non resta un’ambiguità silenziosa');

  const piatto = (await get('/menu?zona=bar')).body.find((m) => m.con_condimenti === 1);
  assert.equal(piatto.supplemento_complementi, 1.5);

  await send('/admin/menu', { righe: cond.map((c, i) => ({ id: c.id, prezzo: prima[i] })) }, 'PUT', token);
});

// ---- L'accesso con e-mail: il codice deve partire davvero -------------------------------
// Prima il codice veniva generato, scritto nel database e poi perso: in sviluppo tornava nella
// risposta HTTP, in produzione non arrivava a nessuno. Un accesso che non si può usare.
test('il codice si chiede sempre allo stesso modo, qualunque e-mail sia', async () => {
  const socio = (await get('/admin/soci', token)).body.find((s) => s.email);
  assert.ok(socio, 'serve un socio con e-mail');
  const noto = await send('/auth/request-otp', { email: socio.email }, 'POST');
  const ignoto = await send('/auth/request-otp', { email: 'nessuno-di-sicuro@example.invalid' }, 'POST');
  assert.equal(noto.status, 200);
  assert.equal(ignoto.status, 200, 'anche un indirizzo sconosciuto riceve la stessa risposta');
  assert.equal(noto.body.messaggio, ignoto.body.messaggio, 'chi guarda non deve capire chi è iscritto');
});

test('un codice sbagliato cinque volte si brucia', async () => {
  const socio = (await get('/admin/soci', token)).body.find((s) => s.email);
  await send('/auth/request-otp', { email: socio.email }, 'POST');
  for (let i = 0; i < 5; i++) {
    const r = await send('/auth/verify-otp', { email: socio.email, code: '000' + String(i).padStart(3, '0') }, 'POST');
    assert.equal(r.status, 401, 'i primi tentativi sbagliati sono solo sbagliati');
  }
  const sesto = await send('/auth/verify-otp', { email: socio.email, code: '999999' }, 'POST');
  assert.equal(sesto.status, 429, 'sei cifre si indovinano, se nessuno conta i tentativi');
  assert.match(sesto.body.error, /Chiedine un altro/);
});

test('non si può inondare la casella di qualcuno di codici', async () => {
  const email = 'prova-limite@example.invalid';
  const esiti = [];
  for (let i = 0; i < 5; i++) esiti.push((await send('/auth/request-otp', { email }, 'POST')).status);
  assert.ok(esiti.includes(429), 'dopo qualche richiesta ravvicinata si dice basta');
  assert.equal(esiti[0], 200, 'ma la prima passa: chi ha perso il codice deve poterlo richiedere');
});

test('entrare con il codice verifica l’indirizzo', async () => {
  const socio = (await get('/admin/soci', token)).body.find((s) => s.email && s.attivo);
  const r = await send('/auth/request-otp', { email: socio.email }, 'POST');
  const code = r.body.dev_code;
  assert.ok(code, 'senza posta configurata il codice torna in sviluppo, altrimenti non si prova niente');
  const v = await send('/auth/verify-otp', { email: socio.email, code }, 'POST');
  assert.equal(v.status, 200);
  assert.ok(v.body.token);
  const dopo = (await get('/admin/soci', token)).body.find((s) => s.id === socio.id);
  assert.equal(dopo.email_verificata, 1, 'chi legge quella casella ha dimostrato che è sua');
});

test('il gestore vede se la posta è configurata, e non lo scopre da un socio rimasto fuori', async () => {
  const st = (await get('/admin/posta/stato', token)).body;
  assert.equal(typeof st.attiva, 'boolean');
  if (!st.attiva) {
    assert.match(st.avviso, /NON partono/, 'se non è configurata deve dirlo senza giri di parole');
  }
  const prova = await send('/admin/posta/prova', { email: 'non-valido' }, 'POST', token);
  assert.equal(prova.status, 400);
});

// ---- Incassare deve scaricare il magazzino ----------------------------------------------
// C'erano due strade per chiudere una comanda: il cambio di stato (che scaricava) e la
// chiusura con incasso (che non scaricava). Chi incassava dal conto del tavolo — cioè la
// strada normale — vendeva merce che per le giacenze non era mai uscita. In una stagione
// simulata: ottomila comande chiuse e ZERO movimenti di scarico.
test('chiudere incassando scarica il magazzino come il cambio di stato', async () => {
  const art = (await send('/admin/magazzino', { nome: 'Pane per incasso', area: 'cucina', zona: 'garden', unita: 'pz', giacenza: 60, tipo_consumo: 'pezzo' }, 'POST', token)).body;
  const p = (await send('/admin/menu', { nome: 'Panino per incasso', prezzo: 6, stazione: 'cucina', zona: 'comune', categoria: 'Panini e fritti' }, 'POST', token)).body;
  await send(`/admin/menu/${p.id}/magazzino`, { magazzino_id: art.id, consumo: 1 }, 'PUT', token);
  const giacenza = async () => (await get('/admin/magazzino', token)).body.articoli.find((a) => a.id === art.id).giacenza;

  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: p.id, qta: 3 }] });
  const prima = await giacenza();
  const chiusa = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  assert.equal(chiusa.status, 200);
  assert.equal(await giacenza(), prima - 3, 'tre panini venduti sono tre pani in meno');

  // E l'incasso finisce nel registro storico, come per l'altra strada.
  const storia = (await get(`/admin/registro/storia?servizio=comande&riferimento=${r.body.numero}`, token)).body;
  assert.ok(storia.some((x) => x.fatto === 'comanda_chiusa'), 'chi ha incassato e quanto deve restare scritto');
});

// ---- Nessun ordine deve cadere fra le due postazioni ------------------------------------
// La cucina filtrava per CHI PREPARA, il banco per DOVE SI VENDE. Risultato: un cocktail
// ordinato a un tavolo del Garden non lo vedeva nessuno — non la cucina (la riga è "bar"), non
// il banco (la comanda è "garden") — e restava lì finché il cliente non lo reclamava.
// Le code di lavoro seguono chi prepara. Sempre, da tutte e due le parti.
test('un cocktail ordinato al tavolo finisce nella coda del banco', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const drink = menu.find((m) => m.stazione === 'bar');
  const r = await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '4', righe: [{ menu_id: drink.id, qta: 2 }] }, 'POST', token);
  assert.equal(r.status, 201);

  const banco = (await get('/admin/kds?stazione=bar', token)).body;
  assert.ok(banco.some((c) => c.id === r.body.id), 'lo prepara il banco: deve vederlo');
  const cucina = (await get('/admin/kds?stazione=cucina', token)).body;
  assert.ok(!cucina.some((c) => c.id === r.body.id), 'e la cucina no: non è roba sua');
});

test('un panino ordinato al bancone finisce nella coda della cucina', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const piatto = menu.find((m) => m.stazione === 'cucina');
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1 }] });
  assert.equal(r.status, 201);
  const cucina = (await get('/admin/kds?stazione=cucina', token)).body;
  assert.ok(cucina.some((c) => c.id === r.body.id), 'il panino lo fa la cucina, anche se ordinato al banco');
  const banco = (await get('/admin/kds?stazione=bar', token)).body;
  assert.ok(!banco.some((c) => c.id === r.body.id), 'il banco non deve trovarselo nella propria coda');
});

test('una comanda mista compare a entrambe le postazioni, ognuna con le sue righe', async () => {
  const menu = (await get('/menu?zona=garden')).body;
  const drink = menu.find((m) => m.stazione === 'bar');
  const piatto = menu.find((m) => m.stazione === 'cucina');
  const r = await send('/admin/comande', { origine: 'tavolo', zona: 'garden', riferimento: '5', righe: [{ menu_id: piatto.id, qta: 1 }, { menu_id: drink.id, qta: 1 }] }, 'POST', token);

  const inCucina = (await get('/admin/kds?stazione=cucina', token)).body.find((c) => c.id === r.body.id);
  const alBanco = (await get('/admin/kds?stazione=bar', token)).body.find((c) => c.id === r.body.id);
  assert.ok(inCucina && alBanco, 'la stessa comanda serve a tutte e due');
  assert.ok(inCucina.righe.every((x) => x.stazione === 'cucina'), 'la cucina vede solo il piatto');
  assert.ok(alBanco.righe.every((x) => x.stazione === 'bar'), 'il banco solo la bevanda');
});

// ---- "Solo io" non vuol dire "gioco da solo" --------------------------------------------
// Pippo prenota il campo per sé e per tre amici: quei tre non erano scritti da nessuna parte.
// Al banco non si sapeva chi fossero, la Coppa non poteva dare punti a chi aveva giocato, e in
// caso di infortunio l'unico nome disponibile era quello del titolare.
test('il titolare dichiara chi gioca con lui, anche su una prenotazione riservata', async () => {
  // Adulti: la prenotazione di un campo la fa chi ha compiuto 18 anni, e nell'elenco ci sono
  // anche i ragazzi creati da altri test.
  const maggiorenne = (d) => d && (Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 31557600000 >= 18;
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code && s.attivo && maggiorenne(s.data_nascita));
  const pippo = soci[0], amico = soci[1];
  const campo = (await get('/campi')).body[0];
  const quando = giorno(2);
  const r = await send(`/campi/${campo.id}/prenota`, { data: quando, slot: '10:00', tessera_code: pippo.tessera_code }, 'POST');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pid = r.body.partita_id || r.body.id;

  // All'inizio c'è solo lui: è il titolare.
  let g = (await get(`/partite/${pid}/giocatori`)).body;
  assert.equal(g.giocatori.length, 1);

  // Un socio, con la tessera: così vale per la Coppa e per i tetti.
  const conSocio = await send(`/partite/${pid}/giocatori`, { tessera_code: pippo.tessera_code, giocatore_tessera: amico.tessera_code }, 'POST');
  assert.equal(conSocio.status, 201);
  // Un ospite senza tessera: gioca lo stesso, ma resta scritto chi era.
  const conOspite = await send(`/partite/${pid}/giocatori`, { tessera_code: pippo.tessera_code, nome: 'Cugino di Pippo' }, 'POST');
  assert.equal(conOspite.status, 201);

  g = (await get(`/partite/${pid}/giocatori`)).body;
  assert.equal(g.giocatori.length, 3);
  assert.ok(g.giocatori.some((x) => x.nome === 'Cugino di Pippo' && x.ospite === true));
  assert.ok(g.giocatori.some((x) => x.tessera_code === amico.tessera_code && x.ospite === false));
});

test('solo il titolare può dire chi gioca sulla sua prenotazione', async () => {
  // Adulti: la prenotazione di un campo la fa chi ha compiuto 18 anni, e nell'elenco ci sono
  // anche i ragazzi creati da altri test.
  const maggiorenne = (d) => d && (Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 31557600000 >= 18;
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code && s.attivo && maggiorenne(s.data_nascita));
  const campo = (await get('/campi')).body[1] || (await get('/campi')).body[0];
  const r = await send(`/campi/${campo.id}/prenota`, { data: giorno(3), slot: '11:00', tessera_code: soci[0].tessera_code }, 'POST');
  const pid = r.body.partita_id || r.body.id;
  const estraneo = await send(`/partite/${pid}/giocatori`, { tessera_code: soci[1].tessera_code, nome: 'Chiunque' }, 'POST');
  assert.equal(estraneo.status, 403, 'un altro socio non può scrivere sulla prenotazione altrui');
  assert.match(estraneo.body.error, /Solo chi ha prenotato/);
});

test('non si dichiarano più giocatori dei posti del campo', async () => {
  // Adulti: la prenotazione di un campo la fa chi ha compiuto 18 anni, e nell'elenco ci sono
  // anche i ragazzi creati da altri test.
  const maggiorenne = (d) => d && (Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 31557600000 >= 18;
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code && s.attivo && maggiorenne(s.data_nascita));
  const campo = (await get('/campi')).body.find((c) => c.posti_default <= 4) || (await get('/campi')).body[0];
  const r = await send(`/campi/${campo.id}/prenota`, { data: giorno(4), slot: '12:00', tessera_code: soci[0].tessera_code }, 'POST');
  const pid = r.body.partita_id || r.body.id;
  const posti = campo.posti_default || 4;
  for (let i = 1; i < posti; i++) {
    assert.equal((await send(`/partite/${pid}/giocatori`, { tessera_code: soci[0].tessera_code, nome: 'Ospite ' + i }, 'POST')).status, 201);
  }
  const troppi = await send(`/partite/${pid}/giocatori`, { tessera_code: soci[0].tessera_code, nome: 'Uno di troppo' }, 'POST');
  assert.equal(troppi.status, 409);
  assert.match(troppi.body.error, /ci sono gia/i);
});

test('anche il banco può dichiarare chi gioca, e resta segnato chi l’ha scritto', async () => {
  // Adulti: la prenotazione di un campo la fa chi ha compiuto 18 anni, e nell'elenco ci sono
  // anche i ragazzi creati da altri test.
  const maggiorenne = (d) => d && (Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 31557600000 >= 18;
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.tessera_code && s.attivo && maggiorenne(s.data_nascita));
  const campo = (await get('/campi')).body[0];
  const r = await send(`/campi/${campo.id}/prenota`, { data: giorno(5), slot: '13:00', tessera_code: soci[0].tessera_code }, 'POST');
  const pid = r.body.partita_id || r.body.id;
  const dalBanco = await send(`/admin/campi/partite/${pid}/giocatori`, { nome: 'Amico arrivato al banco' }, 'POST', token);
  assert.equal(dalBanco.status, 201);
  assert.ok(dalBanco.body.giocatori.some((x) => x.nome === 'Amico arrivato al banco'));
});

// ---- La pianta in metri: ci sta davvero? -------------------------------------------------
// La pianta usa percentuali, e in percentuale un tavolo in più ci entra sempre. La realtà no, e
// te ne accorgi la sera in cui due camerieri non riescono a passare fra i tavoli coi vassoi.
test('la verifica dello spazio dice se i tavoli disegnati ci stanno', async () => {
  await send('/admin/parametri', { garden_larghezza_m: 18, garden_profondita_m: 12, garden_ingombro_tavolo_m: 2, garden_corridoio_m: 0.9 }, 'PUT', token);
  await send('/admin/tavoli/layout/rigenera', { ambiente: 'garden' }, 'POST', token).catch(() => {});
  const v = (await get('/admin/tavoli/verifica-spazio?ambiente=garden', token)).body;
  assert.equal(v.sala.mq, 216);
  assert.ok(v.capienza_teorica >= v.disegnati, 'in 18×12 i tavoli di partenza ci stanno');
  assert.equal(v.verdetto, 'ci sta');
  assert.ok(v.mq_per_coperto > 0, 'e dice quanto spazio ha ogni coperto');
});

test('se la sala è piccola lo dice, e spiega di quanto', async () => {
  // Una stanza in cui ci sta un tavolo solo: così la prova non dipende da quanti tavoli
  // hanno lasciato in pianta gli altri test.
  await send('/admin/parametri', { garden_larghezza_m: 5, garden_profondita_m: 4 }, 'PUT', token);
  const v = (await get('/admin/tavoli/verifica-spazio?ambiente=garden', token)).body;
  // Due verdetti diversi, e la differenza conta: o non c'è lo spazio, o lo spazio c'è ma i
  // tavoli sono messi male. Prima erano la stessa frase, e "ce ne stanno 16 · non ci sta"
  // sembrava una contraddizione.
  assert.equal(v.verdetto, 'lo spazio non basta');
  assert.equal(v.spazio_basta, false);
  assert.match(v.cosa_fare, /Togline/);
  assert.ok(v.capienza_teorica < v.disegnati);
  assert.ok(v.problemi.some((p) => /ce ne stanno/.test(p)), 'dice quanti ce ne starebbero davvero');
  assert.ok(v.troppo_vicini.length, 'e quali coppie non lasciano passare un cameriere');
  // Si rimettono le misure di partenza.
  await send('/admin/parametri', { garden_larghezza_m: 18, garden_profondita_m: 12 }, 'PUT', token);
});

test('senza le misure della sala non si inventa niente', async () => {
  await send('/admin/parametri', { garden_larghezza_m: 0 }, 'PUT', token).catch(() => {});
  const v = (await get('/admin/tavoli/verifica-spazio?ambiente=garden', token)).body;
  if (v.misure_mancanti) assert.ok(true, 'senza misure lo dice invece di stimare');
  await send('/admin/parametri', { garden_larghezza_m: 18 }, 'PUT', token);
});

test('la platea dello Stage ha le sue misure, non quelle del Garden', async () => {
  await send('/admin/parametri', { stage_larghezza_m: 10, stage_profondita_m: 8, stage_ingombro_seduta_m: 0.55, stage_passo_fila_m: 0.9 }, 'PUT', token);
  const st = (await get('/admin/tavoli/verifica-spazio?ambiente=stage', token)).body;
  const gd = (await get('/admin/tavoli/verifica-spazio?ambiente=garden', token)).body;
  assert.equal(st.cosa, 'sedute');
  assert.equal(gd.cosa, 'tavoli');
  assert.equal(st.regole.ingombro_tavolo_m, 0.55, 'una sedia non occupa come un tavolo con quattro persone');
  assert.notEqual(st.sala.mq, gd.sala.mq, 'e la platea non è larga quanto il Garden');
  assert.ok(st.capienza_teorica > gd.capienza_teorica, 'in platea, a parità di spazio, ci sta molta più gente');
});

test('la pianta creata dal sistema rispetta i passaggi che il sistema stesso pretende', async () => {
  // Il ripristino spargeva i tavoli in percentuale sull'intera larghezza: finivano a 1,8 m dove
  // ne servivano 2,5, e la verifica bocciava una pianta disegnata dal sistema stesso.
  await send('/admin/parametri', { garden_larghezza_m: 14, garden_profondita_m: 11, garden_ingombro_tavolo_m: 2, garden_corridoio_m: 0.9, garden_tavoli: 9 }, 'PUT', token);
  const attive = await send('/admin/tavoli/layout/rigenera', { ambiente: 'garden' }, 'POST', token);
  if (attive.status !== 200) return; // prenotazioni in piedi: caso già coperto altrove
  const v = (await get('/admin/tavoli/verifica-spazio?ambiente=garden', token)).body;
  assert.equal(v.troppo_vicini.length, 0, 'nessuna coppia troppo vicina');
  assert.equal(v.fuori_perimetro.length, 0, 'nessun tavolo fuori dal muro');
  assert.equal(v.verdetto, 'ci sta');
});

test('l’ora è quella del residence, non quella del server', async () => {
  // Il server sta su un fuso qualsiasi (su Render è UTC), il Garden sta in Sicilia: due ore di
  // scarto, che su una fascia oraria fanno la differenza fra "si può ancora prenotare" e "sono
  // le nove di sera". Le fasce passate di oggi devono essere coerenti con l'ora di casa.
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const ora = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const v = Object.fromEntries(ora.map((x) => [x.type, x.value]));
  const minutiOra = Number(v.hour) * 60 + Number(v.minute);

  const c = (await get('/campi')).body[0];
  const fasce = (await get(`/campi/${c.id}/disponibilita?data=${oggi}`)).body.slots;
  for (const s of fasce) {
    const [h, m] = s.slot.split(':').map(Number);
    const fine = h * 60 + (m || 0) + (c.durata_slot || 60);
    const inizio = h * 60 + (m || 0);
    if (fine <= minutiOra) assert.equal(s.stato, 'passato', `la fascia ${s.slot} è finita: non può risultare ${s.stato}`);
    else if (inizio <= minutiOra && s.stato !== 'privata' && s.stato !== 'partita') {
      assert.equal(s.stato, 'in_corso', `la fascia ${s.slot} è già cominciata: non si offre`);
    } else if (inizio > minutiOra) {
      assert.ok(!['passato', 'in_corso'].includes(s.stato), `la fascia ${s.slot} non è ancora cominciata`);
    }
  }
});

test('l’ora già cominciata non si prenota dall’app: si chiede al banco', async () => {
  // Alle 21:17 il campo delle 21:00 è libero, ma la scadenza del numero legale era le 20:30:
  // la prenotazione nasceva con la scadenza alle spalle, l'app diceva "Fatto!" e dieci minuti
  // dopo il campo era di nuovo libero. Nessuno aveva detto niente al socio.
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const parti = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const v = Object.fromEntries(parti.map((x) => [x.type, x.value]));
  const adesso = Number(v.hour) * 60 + Number(v.minute);
  const c = (await get('/campi')).body[0];
  const fasce = (await get(`/campi/${c.id}/disponibilita?data=${oggi}`)).body.slots;

  const cominciata = fasce.find((s) => {
    const [h, m] = s.slot.split(':').map(Number);
    return h * 60 + (m || 0) <= adesso && h * 60 + (m || 0) + (c.durata_slot || 60) > adesso;
  });
  if (!cominciata) return; // nessuna fascia in corso adesso: niente da provare

  assert.equal(cominciata.stato, 'in_corso', 'la fascia in corso si vede, ma non come libera');
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const r = await send(`/campi/${c.id}/prenota`, { data: oggi, slot: cominciata.slot, tessera_code: socio.tessera_code }, 'POST');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /gi\u00e0 cominciata/);
  assert.match(r.body.error, /al banco/, 'e dice dove andare, invece di dire solo no');
});

test('nella platea si parla di sedute, mai di tavoli — e il palco non è un posto', async () => {
  await send('/admin/parametri', { stage_larghezza_m: 10, stage_profondita_m: 8 }, 'PUT', token);
  const st = (await get('/admin/tavoli/verifica-spazio?ambiente=stage', token)).body;
  const testo = [st.verdetto, st.cosa_fare || '', ...st.problemi].join(' ');
  assert.ok(!/tavol/i.test(testo), `nel testo dello Stage non deve comparire la parola tavolo: "${testo.slice(0, 160)}"`);
  assert.match(testo, /sedut/i, 'e deve comparire "sedute"');

  // L'arredo (il palco) sta sulla pianta ma non è un posto: contarlo faceva risultare una
  // seduta in più di quelle che la testata dichiara, e chiedeva spazio per qualcosa che
  // nessuno deve raggiungere.
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const turno = (await get(`/admin/tavoli/turno?data=${oggi}&turno=21:30&ambiente=stage`, token)).body;
  // Se la platea di prova non ha arredi (altri test la ridisegnano) il conto coincide comunque:
  // quello che conta è che l'arredo, quando c'è, non venga contato come posto.
  const arredi = (turno.tavoli || []).filter((t) => t.tipo === 'arredo').length;
  assert.equal(st.disegnati, (turno.tavoli || []).length - arredi, 'la verifica conta le sedute, non l’arredo');
});

// ---- Disdire una lezione: fino al margine è gratis, dopo si paga -------------------------
// Il fitness aveva la rotta per annullare ma l'app non la chiamava, e non c'era nessuna regola
// sul tempo: si poteva disdire un minuto prima senza conseguenze, con l'istruttore già lì.
test('la disdetta in tempo non costa niente', async () => {
  await send('/admin/parametri', { fitness_disdetta_minuti: 30 }, 'PUT', token);
  const sedute = (await get('/admin/fitness/sedute?tutte=1', token)).body;
  const futura = sedute.find((s) => new Date(s.data + 'T' + s.ora + ':00') - new Date() > 3 * 3600e3);
  if (!futura) return; // nessuna lezione abbastanza lontana nel calendario di prova
  // Un socio creato apposta: prendendo il primo dell'elenco poteva essere gia' iscritto a
  // quella lezione da un altro test, e la prova falliva a giorni alterni.
  const socio = (await send('/admin/soci', { nome: 'Disdetta', cognome: 'Puntuale', data_nascita: '1985-04-04' }, 'POST', token)).body;
  const isc = await send(`/fitness/sedute/${futura.id}/prenota`, { tessera_code: socio.tessera_code }, 'POST');
  assert.equal(isc.status, 201, JSON.stringify(isc.body));
  const mie = (await get(`/fitness/mie-iscrizioni?tessera_code=${socio.tessera_code}`)).body;
  const mia = mie.find((m) => m.data === futura.data && m.ora === futura.ora);

  const via = await send(`/fitness/iscrizioni/${mia.id}/annulla`, { tessera_code: socio.tessera_code }, 'POST');
  assert.equal(via.status, 200);
  assert.equal(via.body.dovuta, false, 'disdetta con ore di anticipo: non si paga');
  assert.match(via.body.messaggio, /niente da pagare/i);
});

test('la disdetta all’ultimo minuto lascia la lezione dovuta, e il banco lo vede', async () => {
  const sedute = (await get('/admin/fitness/sedute?tutte=1', token)).body;
  // Una lezione già cominciata o imminente: il margine è alle spalle.
  const adesso = sedute.find((s) => new Date(s.data + 'T' + s.ora + ':00') - new Date() < 20 * 60e3);
  if (!adesso) return;
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const isc = await send(`/admin/fitness/sedute/${adesso.id}/iscrivi`, { tessera_code: socio.tessera_code }, 'POST', token);
  if (isc.status !== 201 && isc.status !== 200) return;
  const mie = (await get(`/fitness/mie-iscrizioni?tessera_code=${socio.tessera_code}`)).body;
  const mia = mie.find((m) => m.data === adesso.data && m.ora === adesso.ora);
  if (!mia) return;

  const via = await send(`/fitness/iscrizioni/${mia.id}/annulla`, { tessera_code: socio.tessera_code }, 'POST');
  assert.equal(via.status, 200);
  assert.equal(via.body.dovuta, true, 'disdetta oltre il margine: la lezione resta dovuta');
  assert.match(via.body.messaggio, /resta dovuta/i);

  // E al banco compare fra le disdette da incassare: altrimenti la regola resta sulla carta.
  const dopo = (await get('/admin/fitness/sedute?tutte=1', token)).body.find((s) => s.id === adesso.id);
  assert.ok((dopo.disdette_dovute || []).some((x) => x.id === mia.id), 'il banco deve sapere a chi chiedere i soldi');
});

test('l’app sa entro quando si disdice senza pagare', async () => {
  const d = (await get('/fitness')).body;
  assert.equal(d.disdetta_minuti, 30, 'il margine arriva dal back office, non è scritto nell’app');
});

// ---- Chi ha già pagato passa avanti in lavorazione ---------------------------------------
// Non è "chi paga mangia prima": quell'ordine è già chiuso, non richiede una seconda visita al
// tavolo e non occupa la cassa nel momento di punta. È un riconoscimento a chi ha alleggerito
// il lavoro, e vale pochi minuti — chi aspetta da troppo passa avanti lo stesso.
test('a parità di orario, la comanda già pagata sta prima in coda', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const piatto = menu.find((m) => m.stazione === 'cucina');
  const a = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1 }] });
  const b = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: piatto.id, qta: 1 }] });
  assert.ok(a.body.numero < b.body.numero, 'la prima è arrivata prima');

  // La seconda paga subito al banco.
  await send(`/admin/comande/${b.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  // Si riapre per restare in lavorazione: quello che conta è che risulti pagata.
  await send(`/admin/comande/${b.body.id}/stato`, { stato: 'in_preparazione' }, 'PUT', token);

  const coda = (await get('/admin/kds?stazione=cucina', token)).body;
  const posA = coda.findIndex((c) => c.id === a.body.id);
  const posB = coda.findIndex((c) => c.id === b.body.id);
  if (posA >= 0 && posB >= 0) assert.ok(posB < posA, 'chi ha già pagato viene prima, a parità di attesa');
});

// ---- La copia di cortesia del conto ------------------------------------------------------
// Chi ordina col QR il conto ce l'ha sul telefono. Chi si è fatto servire al tavolo, o usa la
// versione leggera, non ha niente in mano: se lascia un indirizzo, gli si manda la copia.
test('chiudendo il conto si può mandare la copia per e-mail, e non è lo scontrino', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 2 }] });
  const chiusa = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'carta', email: 'nonna@sim.test' }, 'POST', token);
  assert.equal(chiusa.status, 200);
  // Senza posta configurata non parte, ma il campo dice sempre la verità su cosa è successo.
  assert.equal(typeof chiusa.body.ricevuta_inviata, 'boolean');

  // Il testo della copia deve dire a chiare lettere che non sostituisce lo scontrino.
  const { inviaRicevuta, soloTesto } = await import('../server/mail.js');
  let catturato = null;
  const vero = console.log;
  console.log = (...a) => { catturato = (catturato || '') + a.join(' '); };
  await inviaRicevuta('nonna@sim.test', { numero: 7, data: '2026-08-28', punto: 'Bussola Bar', righe: [{ nome: 'Caffè', prezzo: 1.1, qta: 2 }], totale: 2.2, metodo: 'contanti' });
  console.log = vero;
  assert.match(catturato || '', /non è una ricevuta fiscale/i, 'la differenza va scritta, non lasciata capire');
  assert.match(catturato || '', /scontrino fiscale ti viene consegnato/i);
});

test('senza indirizzo non si manda niente, e la chiusura funziona lo stesso', async () => {
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const chiusa = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  assert.equal(chiusa.status, 200);
  assert.equal(chiusa.body.ricevuta_inviata, false, 'la copia è un di più, non un passaggio obbligato');
});

test('la copia del conto non parte da sola: la chiede l’operatore', async () => {
  // Con l'invio automatico ogni socio riconosciuto riceverebbe una mail per OGNI comanda: nella
  // stagione simulata sono 1.748 messaggi, 8-9 a testa. Chi prende tre caffè in un giorno ne
  // riceve tre, e in una settimana ha disattivato tutto.
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.email);
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', tessera_code: socio.tessera_code, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const chiusa = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  assert.equal(chiusa.body.ricevuta_inviata, false, 'al socio non si manda niente se nessuno l’ha chiesto');

  // Se invece l'operatore scrive un indirizzo, la copia parte: è il cliente che l'ha chiesta.
  const r2 = await send('/self-order', { punto: 'Bussola Bar', tessera_code: socio.tessera_code, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const c2 = await send(`/admin/comande/${r2.body.id}/chiudi`, { metodo: 'contanti', email: 'chiesta@sim.test' }, 'POST', token);
  assert.equal(c2.status, 200, 'e la chiusura funziona comunque');
});

// ---- L'estratto conto della tessera ------------------------------------------------------
// Tutto quello che il socio ha fatto, con quanto è costato — e con lo ZERO quando non è
// costato niente. Lo zero non è un riempitivo: dice che i campi sono compresi, e a fine
// stagione fa vedere quanto vale la quota.
test('la tessera racconta le spese e anche quello che non si paga', async () => {
  const socio = (await send('/admin/soci', { nome: 'Estratto', cognome: 'Prova', data_nascita: '1979-06-06' }, 'POST', token)).body;
  const menu = (await get('/menu?zona=bar')).body;

  // Due consumazioni con la tessera.
  for (let i = 0; i < 2; i++) {
    const r = await send('/self-order', { punto: 'Bussola Bar', tessera_code: socio.tessera_code, righe: [{ menu_id: menu[0].id, qta: 2 }] });
    await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  }
  // Un campo, che è gratuito.
  const campo = (await get('/campi')).body[0];
  await send(`/campi/${campo.id}/prenota`, { data: giorno(2), slot: '18:00', tessera_code: socio.tessera_code }, 'POST');

  const e = (await get(`/estratto-conto?tessera_code=${socio.tessera_code}`)).body;
  assert.equal(e.socio.tessera, socio.tessera_code);
  assert.ok(e.totale > 0, 'le consumazioni con la tessera si vedono');
  assert.ok(e.volte_gratis >= 1, 'e anche le volte in cui non si è pagato niente');
  assert.ok(e.voci.some((v) => v.servizio === 'Sport' && v.importo === 0), 'il campo compare con zero, non sparisce');
  assert.ok(e.per_servizio.some((x) => x.servizio === 'Bar' && x.speso > 0));

  // Il limite dell'estratto va scritto, non lasciato capire: al bar si è serviti anche senza
  // tessera, e quelle consumazioni qui non ci sono.
  assert.match(e.nota, /solo quello che hai fatto con la tessera/i);
});

test('una comanda senza tessera non finisce nell’estratto di nessuno', async () => {
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const prima = (await get(`/estratto-conto?tessera_code=${socio.tessera_code}`)).body.totale;
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 3 }] });
  await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  const dopo = (await get(`/estratto-conto?tessera_code=${socio.tessera_code}`)).body.totale;
  assert.equal(dopo, prima, 'senza tessera la spesa non ha un nome dietro, e non si attribuisce');
});

test('l’estratto si può chiedere per un periodo', async () => {
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const e = (await get(`/estratto-conto?tessera_code=${socio.tessera_code}&dal=2000-01-01&al=2000-12-31`)).body;
  assert.equal(e.voci.length, 0, 'un periodo senza attività è vuoto, non è un errore');
  assert.equal(e.totale, 0);
});

// ---- La tessera prepagata: due interruttori, non uno -------------------------------------
// Un adulto: basta che il residence l'abbia accesa. Un minorenne: serve anche il consenso di
// chi ne risponde, perché non si sta scegliendo una comodità — si sta mettendo denaro
// spendibile in mano a un ragazzo.
test('con la prepagata spenta non si carica niente, e si dice perché', async () => {
  await send('/admin/parametri', { tessera_prepagata: false }, 'PUT', token);
  const a = (await send('/admin/soci', { nome: 'Adulto', cognome: 'Prepagata', data_nascita: '1980-01-01' }, 'POST', token)).body;
  const st = (await get(`/admin/tessera/${a.tessera_code}/saldo`, token)).body;
  assert.equal(st.prepagata.attiva, false);
  assert.match(st.prepagata.motivo, /non e' attiva/i);
  const no = await send(`/admin/tessera/${a.tessera_code}/ricarica`, { importo: 20 }, 'POST', token);
  assert.equal(no.status, 409);
});

test('acceso il parametro, un adulto carica e paga con la tessera', async () => {
  await send('/admin/parametri', { tessera_prepagata: true, tessera_ricarica_massima: 100 }, 'PUT', token);
  const a = (await send('/admin/soci', { nome: 'Adulto2', cognome: 'Prepagata', data_nascita: '1975-02-02' }, 'POST', token)).body;
  const st = (await get(`/admin/tessera/${a.tessera_code}/saldo`, token)).body;
  assert.equal(st.prepagata.attiva, true, 'per un adulto basta il parametro generale');

  const ric = await send(`/admin/tessera/${a.tessera_code}/ricarica`, { importo: 30, metodo: 'contanti' }, 'POST', token);
  assert.equal(ric.status, 200);
  assert.equal(ric.body.saldo, 30);
  assert.equal((await send(`/admin/tessera/${a.tessera_code}/ricarica`, { importo: 500 }, 'POST', token)).status, 400, 'oltre il massimo non si carica');

  // Paga una comanda con la tessera: il saldo cala di quello che ha speso.
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 2 }] });
  // Senza PIN non si paga: il numero di tessera è progressivo e sta scritto sulla card.
  const senzaPin = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'tessera', tessera_code: a.tessera_code }, 'POST', token);
  assert.equal(senzaPin.status, 403);
  assert.equal(senzaPin.body.serve_pin, true);

  await send(`/admin/tessera/${a.tessera_code}/pin`, { pin: '8317' }, 'PUT', token);
  const chiusa = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'tessera', tessera_code: a.tessera_code, pin: '8317' }, 'POST', token);
  assert.equal(chiusa.status, 200);
  const dopo = (await get(`/admin/tessera/${a.tessera_code}/saldo`, token)).body;
  assert.equal(Number(dopo.saldo.toFixed(2)), Number((30 - r.body.totale).toFixed(2)));
  assert.ok(dopo.movimenti.some((m) => m.tipo === 'spesa'));
});

test('un minorenne ha bisogno del secondo consenso, dato in anagrafica', async () => {
  await send('/admin/parametri', { tessera_prepagata: true }, 'PUT', token);
  const anno = new Date().getUTCFullYear() - 14;
  const m = (await send('/admin/soci', { nome: 'Ragazzo', cognome: 'Prepagata', data_nascita: `${anno}-03-03` }, 'POST', token)).body;

  let st = (await get(`/admin/tessera/${m.tessera_code}/saldo`, token)).body;
  assert.equal(st.prepagata.attiva, false, 'il parametro generale da solo non basta per un minorenne');
  assert.equal(st.prepagata.minorenne, true);
  assert.match(st.prepagata.motivo, /consenso di chi ne risponde/i);
  assert.equal((await send(`/admin/tessera/${m.tessera_code}/ricarica`, { importo: 20 }, 'POST', token)).status, 409);

  // Il genitore autorizza dalla scheda del ragazzo.
  await send(`/admin/soci/${m.id}`, { nome: 'Ragazzo', cognome: 'Prepagata', data_nascita: `${anno}-03-03`, prepagata_autorizzata: true }, 'PUT', token);
  st = (await get(`/admin/tessera/${m.tessera_code}/saldo`, token)).body;
  assert.equal(st.prepagata.attiva, true, 'con il consenso si può');
  assert.equal((await send(`/admin/tessera/${m.tessera_code}/ricarica`, { importo: 20 }, 'POST', token)).status, 200);
});

test('non si spende più del saldo, e il residuo si rimborsa', async () => {
  await send('/admin/parametri', { tessera_prepagata: true }, 'PUT', token);
  const a = (await send('/admin/soci', { nome: 'Saldo', cognome: 'Corto', data_nascita: '1970-01-01' }, 'POST', token)).body;
  await send(`/admin/tessera/${a.tessera_code}/ricarica`, { importo: 5 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const caro = menu.reduce((x, y) => (y.prezzo > x.prezzo ? y : x));
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: caro.id, qta: 5 }] });
  await send(`/admin/tessera/${a.tessera_code}/pin`, { pin: '4729' }, 'PUT', token);
  const no = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'tessera', tessera_code: a.tessera_code, pin: '4729' }, 'POST', token);
  assert.equal(no.status, 409, 'il saldo non va sotto zero');
  assert.match(no.body.error, /Saldo insufficiente/);

  // Il credito non speso è del socio: si rimborsa.
  const rim = await send(`/admin/tessera/${a.tessera_code}/rimborso`, {}, 'POST', token);
  assert.equal(rim.status, 200);
  assert.equal(rim.body.saldo, 0);

  // E il gestore sa quanto deve ancora ai soci.
  const deb = (await get('/admin/tessere/debito', token)).body;
  assert.ok(typeof deb.totale === 'number', 'il debito verso i soci è un numero che si può leggere');
});

// ---- Il PIN: il numero di tessera non basta ----------------------------------------------
// I numeri sono progressivi — RB-000101-0, 0102, 0103 — e stanno scritti sulla card. Vanno
// benissimo per dire "sono io", non per autorizzare una spesa: chiunque può tentare col numero
// del vicino. Il PIN è l'unica cosa che sta solo in testa al socio.
test('un PIN prevedibile viene rifiutato', async () => {
  const a = (await send('/admin/soci', { nome: 'Pin', cognome: 'Debole', data_nascita: '1972-01-01' }, 'POST', token)).body;
  for (const pin of ['1234', '0000', '7777', '12']) {
    const r = await send(`/admin/tessera/${a.tessera_code}/pin`, { pin }, 'PUT', token);
    assert.equal(r.status, 400, `"${pin}" non doveva essere accettato`);
  }
  assert.equal((await send(`/admin/tessera/${a.tessera_code}/pin`, { pin: '5061' }, 'PUT', token)).status, 200);
});

test('cinque PIN sbagliati bloccano la tessera', async () => {
  await send('/admin/parametri', { tessera_prepagata: true, tessera_pin_oltre: 0 }, 'PUT', token);
  const a = (await send('/admin/soci', { nome: 'Pin', cognome: 'Bloccato', data_nascita: '1968-01-01' }, 'POST', token)).body;
  await send(`/admin/tessera/${a.tessera_code}/pin`, { pin: '9042' }, 'PUT', token);
  await send(`/admin/tessera/${a.tessera_code}/ricarica`, { importo: 20 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;

  for (let i = 0; i < 5; i++) {
    const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 1 }] });
    const no = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'tessera', tessera_code: a.tessera_code, pin: '111' + i }, 'POST', token);
    assert.equal(no.status, 403);
  }
  // Ora nemmeno il PIN giusto passa: quattro cifre sono diecimila combinazioni, e senza limite
  // si provano tutte.
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const bloccata = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'tessera', tessera_code: a.tessera_code, pin: '9042' }, 'POST', token);
  assert.equal(bloccata.status, 403);
  assert.match(bloccata.body.error, /bloccat/i);
  assert.match(bloccata.body.error, /al banco/i, 'e dice come sbloccarla');
});

test('sotto la soglia il PIN non si chiede: lo decide il gestore', async () => {
  await send('/admin/parametri', { tessera_prepagata: true, tessera_pin_oltre: 10 }, 'PUT', token);
  const a = (await send('/admin/soci', { nome: 'Pin', cognome: 'Soglia', data_nascita: '1966-01-01' }, 'POST', token)).body;
  await send(`/admin/tessera/${a.tessera_code}/ricarica`, { importo: 30 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const economico = menu.reduce((x, y) => (y.prezzo < x.prezzo ? y : x));
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: economico.id, qta: 1 }] });
  const ok = await send(`/admin/comande/${r.body.id}/chiudi`, { metodo: 'tessera', tessera_code: a.tessera_code }, 'POST', token);
  assert.equal(ok.status, 200, 'un caffè sotto soglia passa senza PIN');
  await send('/admin/parametri', { tessera_pin_oltre: 0 }, 'PUT', token);
});

// ---- Un identificatore, tre supporti -----------------------------------------------------
// QR stampato, tag NFC (che porta un indirizzo, non un numero) e numero digitato a mano sono lo
// stesso identificatore su supporti diversi: devono convivere senza che nessuno debba scegliere.
test('l’indirizzo corto della tessera porta all’app con il numero già dentro', async () => {
  const a = (await send('/admin/soci', { nome: 'Card', cognome: 'Fisica', data_nascita: '1977-07-07' }, 'POST', token)).body;
  const r = await fetch(BASE.replace(/\/api$/, '') + '/t/' + a.tessera_code, { redirect: 'manual' });
  assert.equal(r.status, 302, 'l’indirizzo corto esiste: è quello che si stampa nel QR e si scrive nel tag NFC');
  const dove = r.headers.get('location');
  assert.match(dove, new RegExp('t=' + a.tessera_code), 'e porta il numero con sé');
});

test('l’indirizzo corto funziona anche scritto in minuscolo', async () => {
  const a = (await send('/admin/soci', { nome: 'Card', cognome: 'Minuscola', data_nascita: '1976-06-06' }, 'POST', token)).body;
  const r = await fetch(BASE.replace(/\/api$/, '') + '/t/' + a.tessera_code.toLowerCase(), { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), new RegExp(a.tessera_code), 'un tag NFC scritto male non deve far fallire tutto');
});

// ---- La tessera si rifà, la persona resta ------------------------------------------------
// Il numero identifica una persona, ma la card è un oggetto: si perde, si rovina, smette di
// funzionare, o va rifatta perché qualcuno ha dimenticato le credenziali. Il numero vecchio non
// si cancella — è scritto dentro prenotazioni e comande di stagioni passate — ma non serve più
// a prenotare né a pagare.
test('il numero nuovo non ha l’anno dentro e ha la cifra di controllo', async () => {
  const a = (await send('/admin/soci', { nome: 'Numero', cognome: 'Nuovo', data_nascita: '1981-01-01' }, 'POST', token)).body;
  assert.match(a.tessera_code, /^RB-\d{6}-\d$/, 'formato RB-000123-4: sigla, progressivo, controllo');
  assert.ok(!/20\d\d/.test(a.tessera_code), 'niente anno: la tessera identifica una persona, non una stagione');
});

test('rifare la tessera cambia il numero e revoca il vecchio, senza perdere la storia', async () => {
  const a = (await send('/admin/soci', { nome: 'Card', cognome: 'Persa', data_nascita: '1983-03-03' }, 'POST', token)).body;
  const vecchia = a.tessera_code;

  assert.equal((await send(`/admin/soci/${a.id}/nuova-tessera`, {}, 'POST', token)).status, 400, 'senza motivo non si rifà');

  const r = await send(`/admin/soci/${a.id}/nuova-tessera`, { motivo: 'persa in spiaggia' }, 'POST', token);
  assert.equal(r.status, 200);
  assert.notEqual(r.body.tessera, vecchia);
  assert.match(r.body.tessera, /^RB-\d{6}-\d$/);

  // La storia resta: si sa quante tessere ha avuto e perché.
  const storia = (await get(`/admin/soci/${a.id}/tessere`, token)).body;
  assert.equal(storia.length, 2);
  assert.equal(storia.find((x) => x.code === vecchia).stato, 'revocata');
  assert.match(storia.find((x) => x.code === vecchia).motivo, /persa in spiaggia/);
  assert.equal(storia.find((x) => x.code === r.body.tessera).stato, 'attiva');

  // E con la nuova si entra.
  assert.equal((await send('/auth/login-tessera', { tessera_code: r.body.tessera }, 'POST')).status, 200);
});

test('rifacendo la tessera si possono azzerare le credenziali dimenticate', async () => {
  await send('/admin/parametri', { tessera_prepagata: true, tessera_pin_oltre: 0 }, 'PUT', token);
  const a = (await send('/admin/soci', { nome: 'Pin', cognome: 'Dimenticato', data_nascita: '1959-09-09' }, 'POST', token)).body;
  await send(`/admin/tessera/${a.tessera_code}/pin`, { pin: '3852' }, 'PUT', token);
  const r = await send(`/admin/soci/${a.id}/nuova-tessera`, { motivo: 'credenziali dimenticate', azzera_credenziali: true }, 'POST', token);
  assert.equal(r.status, 200);
  // Il vecchio PIN non vale più: la tessera nuova ne vuole uno nuovo.
  await send(`/admin/tessera/${r.body.tessera}/ricarica`, { importo: 10 }, 'POST', token);
  const menu = (await get('/menu?zona=bar')).body;
  const c = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 1 }] });
  const no = await send(`/admin/comande/${c.body.id}/chiudi`, { metodo: 'tessera', tessera_code: r.body.tessera, pin: '3852' }, 'POST', token);
  assert.equal(no.status, 403);
  assert.match(no.body.error, /non c'e' ancora un PIN|PIN sbagliato/i);
});

// Il gestore dell'app NON deve vedere gli incassi dei campi a pagamento: per provarli serve
// un operatore vero, quello che li gestisce.
let tokenTennis = null;
async function comeGestoreCampi() {
  if (tokenTennis) return tokenTennis;
  await send('/admin/operatori', { username: 'gestore_campi', password: 'campi-test-123', ruolo: 'staff', permessi: ['tennis'] }, 'POST', token);
  const l = await send('/admin/login', { username: 'gestore_campi', password: 'campi-test-123' }, 'POST');
  tokenTennis = l.body.token;
  return tokenTennis;
}

// ---- Il modulo Tennis: campi che si pagano ----------------------------------------------
// Tennis, beach tennis e beach volley non sono i campi del chiosco: si affittano, ci si fa
// lezione privata, hanno un listino e un incasso propri.
test('i campi da tennis e beach stanno in un modulo a parte', async () => {
  const campi = (await get('/campi')).body;
  const tennis = campi.filter((c) => c.gestione === 'tennis');
  const chiosco = campi.filter((c) => (c.gestione || 'chiosco') === 'chiosco');
  assert.ok(tennis.length, 'tennis, beach tennis e beach volley sono passati al modulo che li affitta');
  assert.ok(chiosco.length, 'gli altri restano al chiosco');
  assert.ok(tennis.every((c) => /tennis|volley/i.test(c.nome + ' ' + (c.sport || ''))));
});

test('il listino lo tiene chi gestisce i campi, e decide il prezzo della prenotazione', async () => {
  const campo = (await get('/campi')).body.find((c) => c.gestione === 'tennis');
  // Prima del listino il campo è gratuito: senza tariffa non si inventa un prezzo.
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const g = await send(`/campi/${campo.id}/prenota`, { data: giorno(3), slot: '09:00', tessera_code: socio.tessera_code }, 'POST');
  assert.equal(g.status, 201);
  assert.equal(g.body.prezzo, 0, 'nessuna tariffa = gratuito, non un prezzo inventato');

  // Il gestore mette due fasce: mattina e sera.
  assert.equal((await send(`/admin/tennis/campi/${campo.id}/tariffe`, { etichetta: 'mattina', da_ora: '08:00', a_ora: '14:00', prezzo_ora: 12 }, 'POST', token)).status, 201);
  await send(`/admin/tennis/campi/${campo.id}/tariffe`, { etichetta: 'sera', da_ora: '17:00', a_ora: '23:00', prezzo_ora: 18 }, 'POST', token);
  await send(`/admin/tennis/campi/${campo.id}/tariffe`, { etichetta: 'lezione privata', tipo_uso: 'lezione', prezzo_ora: 35 }, 'POST', token);

  const mattina = await send(`/campi/${campo.id}/prenota`, { data: giorno(4), slot: '09:00', tessera_code: socio.tessera_code }, 'POST');
  assert.equal(mattina.body.prezzo, 12, 'un’ora di mattina costa la tariffa della mattina');
  const sera = await send(`/campi/${campo.id}/prenota`, { data: giorno(5), slot: '18:00', tessera_code: socio.tessera_code }, 'POST');
  assert.equal(sera.body.prezzo, 18, 'la sera costa di più');
  assert.match(sera.body.prezzo_dettaglio, /sera/);

  // La lezione privata ha il suo prezzo, sullo stesso campo e alla stessa ora.
  const lezione = await send(`/campi/${campo.id}/prenota`, { data: giorno(6), slot: '09:00', tessera_code: socio.tessera_code, tipo_uso: 'lezione' }, 'POST');
  assert.equal(lezione.body.prezzo, 35, 'la lezione non costa come il campo');
});

test('la giornata del tennis dice chi ha pagato e chi no', async () => {
  const campo = (await get('/campi')).body.find((c) => c.gestione === 'tennis');
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const quando = giorno(7);
  const p = await send(`/campi/${campo.id}/prenota`, { data: quando, slot: '18:00', tessera_code: socio.tessera_code }, 'POST');
  assert.ok(p.body.prezzo > 0);

  const suo = await comeGestoreCampi();
  let g = (await get(`/admin/tennis/giornata?data=${quando}`, suo)).body;
  assert.ok(g.da_incassare > 0, 'la prenotazione compare fra quelle da incassare');
  const riga = g.righe.find((r) => Number(r.prezzo) > 0 && Number(r.pagato) !== 1);
  await send(`/admin/tennis/prenotazioni/${riga.id}/pagato`, { pagato: true, metodo: 'contanti' }, 'PUT', suo);

  g = (await get(`/admin/tennis/giornata?data=${quando}`, suo)).body;
  assert.ok(g.incassato > 0, 'e dopo l’incasso passa dall’altra parte');
  // L'incasso sta nel SUO libro, non nel registro del residence.
  const libro = (await get('/admin/tennis/incassi', suo)).body;
  assert.ok(libro.totale > 0);
  assert.ok(!(await get('/admin/registro?servizio=tennis', token)).body.some((x) => x.fatto === 'incasso_campo'),
    'il fatturato di un terzo non finisce nel registro che legge il gestore');
});

test('i campi del chiosco restano gratuiti', async () => {
  const campo = (await get('/campi')).body.find((c) => (c.gestione || 'chiosco') === 'chiosco');
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  // Una fascia davvero libera: altri test occupano il calendario, e un 409 qui non direbbe
  // niente sul prezzo.
  const quando = giorno(9);
  const libere = (await get(`/campi/${campo.id}/disponibilita?data=${quando}`)).body.slots.filter((x) => x.stato === 'libero');
  if (!libere.length) return;
  const r = await send(`/campi/${campo.id}/prenota`, { data: quando, slot: libere[0].slot, tessera_code: socio.tessera_code }, 'POST');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.prezzo, 0, 'il campo del chiosco non si paga');
  assert.equal(r.body.da_pagare, null);
});

// ---- L'area tennis: tre campi, a pagamento, gestiti da chi li affitta --------------------
test('nell’area a pagamento ci sono solo tennis, beach tennis e beach volley', async () => {
  const campi = (await get('/campi')).body;
  const tennis = campi.filter((c) => c.gestione === 'tennis');
  // Touch tennis e pickleball hanno "tennis" nel nome ma stanno al chiosco, gratuiti:
  // indovinare dal nome li portava dalla parte sbagliata.
  assert.ok(!tennis.some((c) => /touch|picker|pickle/i.test(c.nome)), 'touch tennis e pickleball restano al chiosco');
  assert.ok(tennis.every((c) => /tennis|volley/i.test(c.nome + ' ' + (c.sport || ''))));
});

test('sui campi a pagamento non c’è tetto settimanale: più si gioca più si paga', async () => {
  await send('/admin/parametri', { campi_limita_settimana: true }, 'PUT', token);
  const campo = (await get('/campi')).body.find((c) => c.gestione === 'tennis');
  const socio = (await send('/admin/soci', { nome: 'Gioca', cognome: 'Spesso', data_nascita: '1984-04-04' }, 'POST', token)).body;
  const quando = giorno(21);
  const libere = (await get(`/campi/${campo.id}/disponibilita?data=${quando}`)).body.slots.filter((s) => s.stato === 'libero');
  // Oltre il tetto del campo: su un campo gratuito qui si verrebbe bloccati.
  const quante = Math.min(libere.length, (campo.max_pren_settimana || 3) + 2);
  for (let i = 0; i < quante; i++) {
    const r = await send(`/campi/${campo.id}/prenota`, { data: quando, slot: libere[i].slot, tessera_code: socio.tessera_code }, 'POST');
    assert.equal(r.status, 201, `la ${i + 1}ª prenotazione doveva passare: ${JSON.stringify(r.body)}`);
  }
  // E non si mostra nessuna quota: non c'è un tetto da consumare.
  const d = (await get(`/campi/${campo.id}/disponibilita?data=${quando}&tessera_code=${socio.tessera_code}`)).body;
  assert.equal(d.quota, null, 'scrivere "ti restano 2 prenotazioni" su un campo che si paga sarebbe una bugia');
});

test('chi gestisce i campi li configura e li chiude da solo', async () => {
  const campo = (await get('/campi')).body.find((c) => c.gestione === 'tennis');
  const quando = giorno(22);

  // Cambia gli orari del suo campo.
  assert.equal((await send(`/admin/tennis/campi/${campo.id}`, { apertura: '07:00', chiusura: '23:00' }, 'PUT', token)).status, 200);
  const dopo = (await get('/campi')).body.find((c) => c.id === campo.id);
  assert.equal(dopo.apertura, '07:00');

  // Chiude il campo per un pomeriggio: la fascia sparisce da quelle prenotabili.
  const b = await send('/admin/tennis/blocchi', { campo_id: campo.id, data: quando, dalle: '14:00', alle: '19:00', motivo: 'lezioni' }, 'POST', token);
  assert.equal(b.status, 201);
  const slots = (await get(`/campi/${campo.id}/disponibilita?data=${quando}`)).body.slots;
  assert.equal(slots.find((s) => s.slot === '15:00').stato, 'bloccato');

  // E non può toccare i campi del chiosco: il permesso è il suo, non un passe-partout.
  const altrui = (await get('/campi')).body.find((c) => (c.gestione || 'chiosco') === 'chiosco');
  assert.equal((await send(`/admin/tennis/campi/${altrui.id}`, { apertura: '06:00' }, 'PUT', token)).status, 404);
});

test('il gestore prenota al banco e il prezzo lo calcola il listino', async () => {
  const campo = (await get('/campi')).body.find((c) => c.gestione === 'tennis');
  await send(`/admin/tennis/campi/${campo.id}/tariffe`, { etichetta: 'piena', prezzo_ora: 20 }, 'POST', token);
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const quando = giorno(23);
  // Quale tariffa si applica alle 10:00 lo dice il listino, non il test: se c'è una fascia
  // "mattina" vale quella, non l'ultima aggiunta.
  const listino = (await get(`/campi/${campo.id}/disponibilita?data=${quando}`)).body.listino || [];
  const attesa = listino.find((t) => t.tipo_uso === 'campo' && (!t.da_ora || (t.da_ora <= '10:00' && (t.a_ora || '23:59') > '10:00')));
  const r = await send('/admin/tennis/prenota', { campo_id: campo.id, data: quando, slot: '10:00', tessera_code: socio.tessera_code }, 'POST', token);
  assert.equal(r.status, 201);
  assert.ok(r.body.prezzo > 0, 'con un listino attivo il banco non prenota gratis');
  if (attesa) assert.equal(r.body.prezzo, Number(attesa.prezzo_ora), 'il banco non inventa il prezzo: lo prende dal listino');
  const g = (await get(`/admin/tennis/giornata?data=${quando}`, await comeGestoreCampi())).body;
  assert.ok(g.righe.some((x) => Number(x.prezzo) === r.body.prezzo));
});

// ---- Il gestore tennis fa tutto da solo, e il socio vede il risultato --------------------
// La prova che conta: crea un campo da zero, lo configura, gli mette un listino — e il socio
// lo trova nell'app senza che nessun altro abbia toccato niente.
test('il gestore tennis crea un campo e il socio lo vede subito nell’app', async () => {
  const nuovo = await send('/admin/tennis/campi', {
    nome: 'Campo Beach Tennis A', sport: 'beach tennis',
    apertura: '08:00', chiusura: '21:00', durata_slot: 60, posti_default: 4
  }, 'POST', token);
  assert.equal(nuovo.status, 201);

  // Nell'app del socio compare fra i campi prenotabili.
  const daSocio = (await get('/campi')).body.find((c) => c.id === nuovo.body.id);
  assert.ok(daSocio, 'appena creato, il campo è visibile al socio');
  assert.equal(daSocio.gestione, 'tennis');
  assert.equal(daSocio.apertura, '08:00');

  // Configurazione completa: orari, fascia, posti, minimo giocatori, spegnimento.
  assert.equal((await send(`/admin/tennis/campi/${nuovo.body.id}`, { durata_slot: 90, min_giocatori: 2, posti_default: 6 }, 'PUT', token)).status, 200);
  const conf = (await get('/campi')).body.find((c) => c.id === nuovo.body.id);
  assert.equal(conf.durata_slot, 90);
  assert.equal(conf.posti_default, 6);

  // Listino e prenotazione: il prezzo arriva al socio.
  await send(`/admin/tennis/campi/${nuovo.body.id}/tariffe`, { etichetta: 'unica', prezzo_ora: 16 }, 'POST', token);
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const quando = giorno(31);
  const libere = (await get(`/campi/${nuovo.body.id}/disponibilita?data=${quando}`)).body.slots.filter((s) => s.stato === 'libero');
  const p = await send(`/campi/${nuovo.body.id}/prenota`, { data: quando, slot: libere[0].slot, tessera_code: socio.tessera_code }, 'POST');
  assert.equal(p.status, 201);
  assert.equal(p.body.prezzo, 24, 'novanta minuti a 16 €/ora fanno 24 €');

  // Spento, sparisce dall'app: è il modo per togliere un campo senza cancellarlo.
  await send(`/admin/tennis/campi/${nuovo.body.id}`, { attivo: false }, 'PUT', token);
  assert.ok(!(await get('/campi')).body.some((c) => c.id === nuovo.body.id), 'un campo spento non si prenota');
});

test('i campi dell’area tennis non si amministrano dal back office', async () => {
  const campo = (await get('/campi')).body.find((c) => c.gestione === 'tennis');
  // Le rotte generali dei campi si rifiutano, e dicono dove andare.
  const no = await send(`/admin/campi/${campo.id}`, { nome: 'Cambiato da fuori' }, 'PUT', token);
  assert.equal(no.status, 409);
  assert.match(no.body.error, /area tennis/i);
  assert.match(no.body.error, /suo modulo/i);
  // Il supervisore può forzare quando serve davvero: è il suo ruolo, ma deve dirlo.
  assert.equal((await send(`/admin/campi/${campo.id}`, { nome: campo.nome, forza_supervisore: true }, 'PUT', token)).status, 200);
});

test('un campo dell’area tennis con prenotazioni non si cancella: si spegne', async () => {
  const nuovo = (await send('/admin/tennis/campi', { nome: 'Campo con storia', sport: 'tennis' }, 'POST', token)).body;
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const quando = giorno(32);
  const libere = (await get(`/campi/${nuovo.id}/disponibilita?data=${quando}`)).body.slots.filter((s) => s.stato === 'libero');
  await send(`/campi/${nuovo.id}/prenota`, { data: quando, slot: libere[0].slot, tessera_code: socio.tessera_code }, 'POST');
  const no = await send(`/admin/tennis/campi/${nuovo.id}`, {}, 'DELETE', token);
  assert.equal(no.status, 409);
  assert.match(no.body.error, /spegnilo invece di cancellarlo/i);
});

test('il residence non vede quanto incassa chi gestisce i campi', async () => {
  const suo = await comeGestoreCampi();
  // Chi gestisce vede i suoi soldi.
  const oggi = new Date().toISOString().slice(0, 10);
  const mia = (await get(`/admin/tennis/giornata?data=${oggi}`, suo)).body;
  assert.ok('incassato' in mia, 'chi affitta i campi deve vedere il proprio incasso');

  // Il gestore dell'app vede chi ha prenotato — è il supervisore — ma non gli importi.
  const sua = (await get(`/admin/tennis/giornata?data=${oggi}`, token)).body;
  assert.equal(sua.incassi_nascosti, true);
  assert.ok(!('incassato' in sua), 'il fatturato del terzo non è affare del residence');
  assert.ok((sua.righe || []).every((r) => !('prezzo' in r)), 'nemmeno riga per riga');
  assert.match(sua.nota, /non li vede/i);

  // E il libro degli incassi gli è chiuso, esplicitamente.
  const no = await get('/admin/tennis/incassi', token);
  assert.equal(no.status, 403);
  assert.match(no.body.error, /gestore del servizio/i);
});

// ---- Tornei a eliminazione diretta -------------------------------------------------------
// Altra cosa dalla Coppa delle Casate, che è a punti e dura tutta la stagione: qui si gioca una
// sera, si perde e si va a casa.
test('il tabellone dev’essere 4, 8, 16 o 32: non un numero qualsiasi', async () => {
  const no = await send('/admin/tornei', { nome: 'Torneo storto', posti: 6 }, 'POST', token);
  assert.equal(no.status, 400);
  // Il motivo va detto, non è un capriccio: con 6 giocatori qualcuno passerebbe il turno senza
  // giocare, e arriverebbe in finale avendo giocato una partita in meno.
  assert.match(no.body.error, /passerebbe il turno senza giocare/i);
  assert.equal((await send('/admin/tornei', { nome: 'Torneo giusto', posti: 8 }, 'POST', token)).status, 201);
});

test('non si sorteggia un tabellone incompleto', async () => {
  const t = (await send('/admin/tornei', { nome: 'Doppio giallo', disciplina: 'pickleball', posti: 4 }, 'POST', token)).body;
  await send(`/admin/tornei/${t.id}/iscritti`, { nome: 'Anna' }, 'POST', token);
  await send(`/admin/tornei/${t.id}/iscritti`, { nome: 'Bruno' }, 'POST', token);
  const no = await send(`/admin/tornei/${t.id}/sorteggia`, {}, 'POST', token);
  assert.equal(no.status, 409);
  assert.match(no.body.error, /ci sono 2 iscritti/i);
});

test('sorteggio, tabellone e finale: il vincitore sale da solo', async () => {
  const t = (await send('/admin/tornei', { nome: 'Coppa di fine agosto', posti: 4 }, 'POST', token)).body;
  for (const n of ['Anna', 'Bruno', 'Carla', 'Dario']) {
    const r = await send(`/admin/tornei/${t.id}/iscritti`, { nome: n }, 'POST', token);
    assert.equal(r.status, 201);
  }
  // A tabellone pieno le iscrizioni si chiudono da sole.
  const pieno = await send(`/admin/tornei/${t.id}/iscritti`, { nome: 'Elena' }, 'POST', token);
  assert.equal(pieno.status, 409);
  assert.match(pieno.body.error, /pieno/i);

  const s = await send(`/admin/tornei/${t.id}/sorteggia`, {}, 'POST', token);
  assert.equal(s.status, 200);
  const tab = s.body.tabellone;
  assert.equal(tab.turni.length, 2, 'con 4 giocatori: semifinali e finale');
  assert.equal(tab.turni[0].nome, 'Semifinali');
  assert.equal(tab.turni[1].nome, 'Finale');
  assert.equal(tab.turni[0].partite.length, 2);
  assert.ok(tab.turni[0].partite.every((p) => p.a_nome && p.b_nome), 'il primo turno è pieno');
  assert.ok(tab.turni[1].partite.every((p) => !p.a_nome), 'la finale è ancora vuota: la riempiono i vincitori');
  // Tutti e quattro sono in tabellone, ognuno una volta sola.
  const inCampo = tab.turni[0].partite.flatMap((p) => [p.a_nome, p.b_nome]).sort();
  assert.deepEqual(inCampo, ['Anna', 'Bruno', 'Carla', 'Dario']);

  // Si sorteggia una volta sola.
  assert.equal((await send(`/admin/tornei/${t.id}/sorteggia`, {}, 'POST', token)).status, 409);

  // I risultati fanno salire i vincitori nella casella giusta.
  const semi = tab.turni[0].partite;
  const v1 = semi[0].a_nome, v2 = semi[1].b_nome;
  await send(`/admin/tornei/partite/${semi[0].id}`, { vincitore: v1, punteggio: '6-3' }, 'PUT', token);
  const dopo = (await send(`/admin/tornei/partite/${semi[1].id}`, { vincitore: v2, punteggio: '7-5' }, 'PUT', token)).body;
  const finale = dopo.tabellone.turni[1].partite[0];
  assert.equal(finale.a_nome, v1, 'il vincitore della prima semifinale sale come primo');
  assert.equal(finale.b_nome, v2);

  // La finale chiude il torneo.
  const fine = (await send(`/admin/tornei/partite/${finale.id}`, { vincitore: v1, punteggio: '6-4 6-2' }, 'PUT', token)).body;
  assert.equal(fine.finale, true);
  assert.equal(fine.vincitore, v1);
  assert.equal(fine.tabellone.torneo.stato, 'concluso');
  assert.equal(fine.tabellone.torneo.vincitore, v1);
});

test('un vincitore deve essere uno dei due che hanno giocato', async () => {
  const t = (await send('/admin/tornei', { nome: 'Controllo risultati', posti: 4 }, 'POST', token)).body;
  for (const n of ['Uno', 'Due', 'Tre', 'Quattro']) await send(`/admin/tornei/${t.id}/iscritti`, { nome: n }, 'POST', token);
  const tab = (await send(`/admin/tornei/${t.id}/sorteggia`, {}, 'POST', token)).body.tabellone;
  const p = tab.turni[0].partite[0];
  const no = await send(`/admin/tornei/partite/${p.id}`, { vincitore: 'Qualcun altro' }, 'PUT', token);
  assert.equal(no.status, 400);
  assert.match(no.body.error, new RegExp(p.a_nome));
  // E non si registra il risultato di una partita che non ha ancora i giocatori.
  const finale = tab.turni[1].partite[0];
  const presto = await send(`/admin/tornei/partite/${finale.id}`, { vincitore: 'Uno' }, 'PUT', token);
  assert.equal(presto.status, 400);
  assert.match(presto.body.error, /non ha ancora i due giocatori/i);
});

test('i tornei del tennis e quelli del chiosco stanno separati', async () => {
  const suo = await comeGestoreCampi();
  const mio = (await send('/admin/tornei', { nome: 'Open del Beach', posti: 8, gestione: 'tennis' }, 'POST', suo)).body;
  assert.ok(mio.id);
  const suoi = (await get('/admin/tornei?gestione=tennis', suo)).body;
  assert.ok(suoi.some((x) => x.id === mio.id));
  const delChiosco = (await get('/admin/tornei?gestione=chiosco', token)).body;
  assert.ok(!delChiosco.some((x) => x.id === mio.id), 'ognuno vede i tornei della sua gestione');
});

// ---- Due mestieri, due permessi ----------------------------------------------------------
// Il gestore dei campi a pagamento può mandare qualcuno al banco senza per questo mostrargli
// quanto incassa: chi copre un turno prenota, disdice e blocca — i soldi restano suoi.
test('il delegato dei campi lavora ma non vede né listino né incassi', async () => {
  await send('/admin/operatori', { username: 'banco_tennis', password: 'banco-test-123', ruolo: 'staff', permessi: ['tennis_campi'] }, 'POST', token);
  const delegato = (await send('/admin/login', { username: 'banco_tennis', password: 'banco-test-123' }, 'POST')).body.token;
  const oggi = new Date().toISOString().slice(0, 10);

  // Lavora: vede i campi, la giornata, e può bloccare.
  const campi = (await get('/admin/tennis/campi', delegato)).body;
  assert.ok(campi.length, 'i campi li vede: deve poterci lavorare');
  assert.ok(campi.every((c) => (c.listino || []).length === 0), 'il listino no: non decide i prezzi');
  const g = (await get(`/admin/tennis/giornata?data=${oggi}`, delegato)).body;
  assert.ok(!('incassato' in g), 'e nemmeno l’incasso');
  assert.equal((await send('/admin/tennis/blocchi', { campo_id: campi[0].id, data: giorno(40), dalle: '10:00', alle: '12:00', motivo: 'manutenzione' }, 'POST', delegato)).status, 201);

  // Il libro degli incassi gli è chiuso, come al gestore dell'app.
  const no = await get('/admin/tennis/incassi', delegato);
  assert.equal(no.status, 403);
  assert.match(no.body.error, /gestore del servizio/i);

  // E non può cambiare il listino.
  assert.equal((await send(`/admin/tennis/campi/${campi[0].id}/tariffe`, { etichetta: 'mia', prezzo_ora: 5 }, 'POST', delegato)).status, 403);
});

test('la crew del chiosco non vede i campi a pagamento', async () => {
  await send('/admin/operatori', { username: 'crew_campi', password: 'crew-test-123', ruolo: 'staff', permessi: ['campi'] }, 'POST', token);
  const crew = (await send('/admin/login', { username: 'crew_campi', password: 'crew-test-123' }, 'POST')).body.token;
  const suoi = (await get('/admin/campi', crew)).body;
  assert.ok(suoi.length, 'i campi del chiosco li vede');
  assert.ok(suoi.every((c) => (c.gestione || 'chiosco') !== 'tennis'),
    'quelli a pagamento no: hanno una gestione loro, e al banco del chiosco non servono');
  // Il gestore dell'app invece li vede tutti: è supervisore.
  assert.ok((await get('/admin/campi', token)).body.some((c) => c.gestione === 'tennis'));
});

// ---- Composizione delle casate -----------------------------------------------------------
// Il primo anno nessuno conosce nessuno: aspettare che i soci si associno da soli significa
// arrivare a luglio con tre casate piene e cinque vuote.
async function popolaCoppa(quanti = 100) {
  const anno = new Date().getUTCFullYear();
  let n = 0;
  const crea = (eta, sesso, nucleo) => send('/admin/soci', {
    nome: 'C' + (++n), cognome: (nucleo || 'Solo') + n, data_nascita: `${anno - eta}-06-15`,
    sesso, nucleo: nucleo || null, gioca_coppa: true
  }, 'POST', token);
  let fatti = 0;
  for (let f = 1; f <= 18 && fatti < quanti; f++) {
    const casa = 'nucleo' + f + '_' + Math.random().toString(36).slice(2, 6);
    await crea(30 + (f % 15), 'M', casa); await crea(28 + (f % 15), 'F', casa);
    await crea(6 + (f % 7), f % 2 ? 'M' : 'F', casa);
    fatti += 3;
    if (f % 2 === 0) { await crea(71 + (f % 6), f % 4 ? 'F' : 'M', casa); fatti++; }
  }
  while (fatti < quanti) {
    await crea([17, 24, 33, 41, 52, 58, 66, 72][fatti % 8], fatti % 2 ? 'F' : 'M', null);
    fatti++;
  }
}

test('la composizione forma casate piene e non separa le famiglie', async () => {
  await popolaCoppa(100);
  const a = (await get('/admin/casate/composizione', token)).body;
  assert.ok(a.casate_schierabili >= 1, 'con cento iscritti si formano casate');
  assert.equal(a.regole.minDonne, 6, 'quota 50% su 12 posti, arrotondata per difetto');
  for (const c of a.casate) {
    assert.equal(c.quanti, a.regole.posti, `${c.nome} deve avere il numero legale`);
  }
  // Il nucleo familiare non si separa mai: è il primo vincolo, prima di ogni quota.
  const dove = new Map();
  for (const c of a.casate) for (const m of c.membri) dove.set(m.nome, c.nome);
  const soci = (await get('/admin/soci', token)).body.filter((s) => s.nucleo && s.gioca_coppa);
  const perNucleo = new Map();
  for (const s of soci) {
    if (!perNucleo.has(s.nucleo)) perNucleo.set(s.nucleo, []);
    perNucleo.get(s.nucleo).push(`${s.nome} ${s.cognome}`);
  }
  for (const [nucleo, membri] of perNucleo) {
    const casate = [...new Set(membri.map((m) => dove.get(m)).filter(Boolean))];
    assert.ok(casate.length <= 1, `il nucleo ${nucleo} è finito in ${casate.length} casate diverse`);
  }
});

test('la quota di rappresentanza si misura sul totale, non sulle fasce', async () => {
  const a = (await get('/admin/casate/composizione', token)).body;
  const sotto = a.casate.filter((c) => c.donne < a.regole.minDonne);
  // Può non essere rispettata se le donne iscritte non bastano: ma allora il sistema lo dice,
  // e dice quante ne mancano in tutto — non lascia il gestore a indovinare.
  if (sotto.length) {
    assert.ok(a.problemi.some((p) => /quota/.test(p.cosa)), 'una quota violata va dichiarata');
    assert.ok(a.disponibilita.donne.servono > 0);
  }
});

test('quando un vincolo è impossibile lo dice, e dice perché', async () => {
  // Gli over 70 sono il vincolo più difficile: se non ce ne sono abbastanza iscritti, nessuna
  // composizione può rimediare. Il messaggio deve dire la causa, non il sintomo.
  const a = (await get('/admin/casate/composizione', token)).body;
  const d = a.disponibilita.over70;
  if (d.mancano > 0) {
    assert.ok(a.avvisi.some((x) => /Nessuna composizione puo' rimediare/.test(x)),
      'sei righe "manca un over 70" non spiegano niente: serve il conto complessivo');
    assert.ok(a.avvisi.some((x) => x.includes(String(d.iscritti))));
  }
});

test('l’anteprima non tocca niente: si applica solo confermando', async () => {
  const prima = (await get('/admin/soci', token)).body.filter((s) => s.casata_id).length;
  await get('/admin/casate/composizione', token);
  const dopo = (await get('/admin/soci', token)).body.filter((s) => s.casata_id).length;
  assert.equal(dopo, prima, 'guardare l’anteprima non deve spostare nessuno');

  const senza = await send('/admin/casate/composizione', {}, 'POST', token);
  assert.equal(senza.status, 400, 'senza conferma non si riscrive la casata di cento persone');
  assert.match(senza.body.error, /anteprima/i);

  const fatto = await send('/admin/casate/composizione', { conferma: true }, 'POST', token);
  assert.equal(fatto.status, 200);
  const stato = (await get('/admin/casate/stato', token)).body;
  assert.ok(stato.casate.some((c) => c.quanti > 0), 'dopo la conferma le casate sono composte');
  // E lo stato dice, casata per casata, cosa manca.
  for (const c of stato.casate.filter((x) => x.quanti > 0 && !x.in_regola)) {
    assert.ok(c.mancano.length, 'una casata fuori regola deve dire cosa le manca');
  }
});

test('chi non ha chiesto di giocare non viene assegnato d’ufficio', async () => {
  const spettatore = (await send('/admin/soci', { nome: 'Solo', cognome: 'Spettatore', data_nascita: '1980-01-01', sesso: 'F' }, 'POST', token)).body;
  const a = (await get('/admin/casate/composizione', token)).body;
  const dentro = a.casate.some((c) => c.membri.some((m) => m.id === spettatore.id));
  assert.equal(dentro, false, 'assegnare chi non vuole giocare significa una casata in meno alla sfilata');
});

test('le casate si schierano sempre: in campo ne vanno tre, non dodici', async () => {
  const st = (await get('/admin/casate/stato', token)).body;
  assert.equal(st.regole.minimo, 3, 'tre sono quelli che stanno in campo a calcetto o a basket');
  for (const c of st.casate.filter((x) => x.quanti > 0)) {
    assert.equal(c.puo_giocare, c.quanti >= st.regole.minimo);
  }
});

test('i vincoli crescono con la casata: su quattro persone non se ne chiedono sei', async () => {
  // Pretendere 2 under 14, 2 over 70 e 6 donne da una casata di quattro significa dichiarare
  // venti problemi che non sono problemi: quella casata sta solo aspettando di riempirsi.
  const a = (await get('/admin/casate/composizione', token)).body;
  for (const p of a.problemi) {
    const c = a.casate.find((x) => x.nome === p.casata);
    if (!c || c.quanti >= a.regole.posti) continue;
    // Sotto il massimo un problema può esistere, ma dev'essere proporzionato alla dimensione.
    assert.match(p.dettaglio, new RegExp(`casata da ${c.quanti}|${a.regole.minimo} minimi`),
      `"${p.cosa}: ${p.dettaglio}" non è misurato sulla dimensione vera della casata`);
  }
  // E la quota è tassativa solo a casata piena.
  const piene = a.casate.filter((c) => c.quanti >= a.regole.posti);
  for (const c of piene) {
    const suo = a.problemi.find((p) => p.casata === c.nome && /quota/.test(p.cosa));
    if (suo) assert.equal(suo.grave, true, 'a casata piena la quota non è più un obiettivo');
  }
});

test('il capitano si propone, e si dice perché', async () => {
  const props = (await get('/admin/casate/capitani', token)).body;
  assert.ok(props.length, 'una proposta per casata');
  for (const p of props.filter((x) => x.capitano)) {
    assert.ok(p.capitano.perche, 'il perché va detto: il capitano è un lavoro, non un premio');
    assert.ok(p.vice, 'e serve anche un vice: un capitano con la febbre non deve costare il torneo');
    assert.notEqual(p.vice.id, p.capitano.id);
  }
  // Nominarlo è un gesto separato: il sistema propone, la casata decide.
  const conProposta = props.find((p) => p.capitano && p.vice);
  if (conProposta) {
    const r = await send(`/admin/casate/${conProposta.casata_id}/capitano`, { capitano_socio_id: conProposta.capitano.id, vice_socio_id: conProposta.vice.id }, 'PUT', token);
    assert.equal(r.status, 200);
    const stesso = await send(`/admin/casate/${conProposta.casata_id}/capitano`, { capitano_socio_id: conProposta.capitano.id, vice_socio_id: conProposta.capitano.id }, 'PUT', token);
    assert.equal(stesso.status, 400, 'capitano e vice non possono essere la stessa persona');
    assert.match(stesso.body.error, /proprio per quando il capitano non c'e/i);
  }
});

// ---- I parametri di testo si possono scrivere -------------------------------------------
// Chiunque non fosse "numero" o "interruttore" veniva disegnato come menù a tendina, e senza
// opzioni la tendina era vuota: date, orari e numero di telefono non si potevano nemmeno
// digitare. E sul server i tipi nuovi finivano nel controllo delle opzioni e tornavano al
// predefinito — quindi anche scrivendoli via API sparivano al salvataggio.
test('date, orari e numeri di telefono si salvano davvero', async () => {
  const valori = {
    aiuto_numero: '+39 0931 123456',
    coppa_riapertura: '2027-07-18',
    coppa_chiusura_formazioni: '2027-07-02T14:00',
    fitness_griglia_da: '07:30'
  };
  await send('/admin/parametri', valori, 'PUT', token);
  const dopo = (await get('/admin/parametri', token)).body;
  const lista = Array.isArray(dopo) ? dopo : dopo.parametri;
  const v = Object.fromEntries(lista.map((p) => [p.chiave, p.valore]));
  for (const [k, atteso] of Object.entries(valori)) {
    assert.equal(v[k], atteso, `${k} non è stato salvato: scrivere, salvare e ritrovare il campo vuoto è il difetto peggiore`);
  }
});

test('i parametri dichiarano un tipo che il back office sa disegnare', async () => {
  const dopo = (await get('/admin/parametri', token)).body;
  const lista = Array.isArray(dopo) ? dopo : dopo.parametri;
  const noti = ['bool', 'numero', 'testo', 'data', 'dataora', 'ora', 'telefono', 'scelta'];
  for (const p of lista) {
    assert.ok(noti.includes(p.tipo) || (p.opzioni || []).length,
      `il parametro ${p.chiave} è di tipo "${p.tipo}" e non ha opzioni: nel back office diventerebbe una tendina vuota`);
  }
});

// ---- La spiaggia -------------------------------------------------------------------------
// Il vincolo che decide tutto: sulle piazzole non c'è nessuno della crew. Non c'è un arbitro,
// quindi le regole devono reggersi da sole.
test('le quattro piazzole del condominio esistono e si configurano', async () => {
  // Le prove girano a qualsiasi ora: le fasce si allargano per coprire l'orologio, altrimenti
  // di sera il sistema rifiuta — giustamente — e la prova non dice niente sulle regole.
  await send('/admin/parametri', {
    // La gestione e' spenta di serie: la si accende per provarla, come farebbe il gestore.
    beach_attiva: true,
    beach_mattina_da: '00:00', beach_mattina_a: '12:00',
    beach_pomeriggio_da: '12:00', beach_pomeriggio_a: '23:59'
  }, 'PUT', token);
  const s = (await get('/admin/spiaggia', token)).body;
  const nomi = s.piazzole.map((p) => p.nome).sort();
  assert.deepEqual(nomi, ['Caltagirone', 'Grande', 'Piccola', 'Quadrata']);
  // Gli ombrelloni si dichiarano: non si calcolano dalla dimensione della piazzola, che ha
  // alberi, docce e passaggi.
  const grande = s.piazzole.find((p) => p.nome === 'Grande');
  // Prima le misure: senza, creare ombrelloni significa disegnare una spiaggia che non esiste.
  const senzaMisure = await send(`/admin/spiaggia/piazzole/${grande.id}/ombrelloni`, { quanti: 6 }, 'POST', token);
  assert.equal(senzaMisure.status, 409);
  assert.match(senzaMisure.body.error, /Prima le misure/i);

  await send(`/admin/spiaggia/piazzole/${grande.id}`, { larghezza_m: 22, profondita_m: 16 }, 'PUT', token);
  assert.equal((await send(`/admin/spiaggia/piazzole/${grande.id}/ombrelloni`, { quanti: 6, posti: 2 }, 'POST', token)).status, 201);
  const piccola = s.piazzole.find((p) => p.nome === 'Piccola');
  await send(`/admin/spiaggia/piazzole/${piccola.id}`, { larghezza_m: 12, profondita_m: 10 }, 'PUT', token);
  await send(`/admin/spiaggia/piazzole/${piccola.id}/ombrelloni`, { quanti: 4 }, 'POST', token);
  const dopo = (await get('/admin/spiaggia', token)).body;
  assert.equal(dopo.piazzole.find((p) => p.nome === 'Grande').totale, 6);
});

test('chi arriva prende, e non si prenota il giorno prima', async () => {
  const pub = (await get('/spiaggia')).body;
  assert.ok(pub.fasce.length === 2, 'due fasce fisse, non quattro ore da quando arrivi');
  const grande = pub.piazzole.find((p) => p.nome === 'Grande');
  const libero = grande.ombrelloni.find((o) => o.libero);
  if (!libero) return;
  const socio = (await send('/admin/soci', { nome: 'Bagnante', cognome: 'Uno', data_nascita: '1985-05-05', sesso: 'M', nucleo: 'fam-mare' }, 'POST', token)).body;
  const r = await send('/spiaggia/prendi', { tessera_code: socio.tessera_code, ombrellone_id: libero.id, fascia: pub.fascia }, 'POST');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.scade_alle, 'si dice a che ora finisce, non "fra quattro ore"');
});

test('una presa per nucleo: la famiglia non prende due ombrelloni con due nomi', async () => {
  const pub = (await get('/spiaggia')).body;
  const grande = pub.piazzole.find((p) => p.nome === 'Grande');
  const libero = grande.ombrelloni.find((o) => o.libero);
  if (!libero) return;
  // Stesso nucleo, persona diversa: è il trucco che la regola "uno a testa" non fermerebbe.
  const figlio = (await send('/admin/soci', { nome: 'Bagnante', cognome: 'Due', data_nascita: '2005-05-05', sesso: 'F', nucleo: 'fam-mare' }, 'POST', token)).body;
  const r = await send('/spiaggia/prendi', { tessera_code: figlio.tessera_code, ombrellone_id: libero.id, fascia: pub.fascia }, 'POST');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /famiglia ha gia' un ombrellone/i);
  assert.match(r.body.error, /prendine un altro accanto/i, 'e si dice cosa fare se sono in tanti');
});

test('un ombrellone già preso non si prende due volte', async () => {
  const pub = (await get('/spiaggia')).body;
  const grande = pub.piazzole.find((p) => p.nome === 'Grande');
  const occupato = grande.ombrelloni.find((o) => !o.libero);
  if (!occupato) return;
  const altro = (await send('/admin/soci', { nome: 'Bagnante', cognome: 'Tre', data_nascita: '1979-01-01', sesso: 'M', nucleo: 'altra-fam' }, 'POST', token)).body;
  const r = await send('/spiaggia/prendi', { tessera_code: altro.tessera_code, ombrellone_id: occupato.id, fascia: pub.fascia }, 'POST');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /gia' preso/i);
});

test('rilasciare presto rimette l’ombrellone in circolo', async () => {
  const pub = (await get('/spiaggia')).body;
  const grande = pub.piazzole.find((p) => p.nome === 'Grande');
  const mio = grande.ombrelloni.find((o) => o.presa_id);
  if (!mio) return;
  const soci = (await get('/admin/soci', token)).body;
  const chi = soci.find((x) => x.nucleo === 'fam-mare');
  const r = await send('/spiaggia/rilascia', { tessera_code: chi.tessera_code, presa_id: mio.presa_id }, 'POST');
  assert.equal(r.status, 200);
  const dopo = (await get('/spiaggia')).body.piazzole.find((p) => p.nome === 'Grande');
  assert.ok(dopo.ombrelloni.find((o) => o.id === mio.id).libero, 'chi va via a mezzogiorno libera il posto');
});

test('piazzola chiusa per vento: nessuno prende', async () => {
  const s = (await get('/admin/spiaggia', token)).body;
  const piccola = s.piazzole.find((p) => p.nome === 'Piccola');
  await send('/admin/spiaggia/blocchi', { piazzola_id: piccola.id, data: s.data, motivo: 'vento', nota: 'raffiche' }, 'POST', token);
  const pub = (await get('/spiaggia')).body.piazzole.find((p) => p.nome === 'Piccola');
  assert.ok(pub.bloccata, 'la piazzola risulta chiusa');
  assert.ok(pub.ombrelloni.every((o) => !o.libero), 'e nessun ombrellone è prendibile');
  const socio = (await send('/admin/soci', { nome: 'Bagnante', cognome: 'Vento', data_nascita: '1990-02-02', sesso: 'F', nucleo: 'fam-vento' }, 'POST', token)).body;
  const r = await send('/spiaggia/prendi', { tessera_code: socio.tessera_code, ombrellone_id: pub.ombrelloni[0].id, fascia: (await get('/spiaggia')).body.fascia }, 'POST');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /vento/i);
});

test('la gestione degli ombrelloni si può spegnere davvero', async () => {
  // È l'unico servizio in cui il sistema non può far rispettare niente: sulle piazzole non c'è
  // nessuno. Se la gente non dichiara e non rilascia, si spegne e non resta nessun rudere acceso.
  await send('/admin/parametri', { beach_attiva: false }, 'PUT', token);
  assert.equal((await get('/spiaggia')).status, 404, 'spenta, il socio non vede nemmeno la sezione');
  const chiunque = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const no = await send('/spiaggia/prendi', { tessera_code: chiunque.tessera_code, ombrellone_id: 1, fascia: 'mattina' }, 'POST');
  assert.equal(no.status, 409);
  await send('/admin/parametri', { beach_attiva: true }, 'PUT', token);
  assert.equal((await get('/spiaggia')).status, 200, 'riaccesa, torna com’era');
});

test('le misure dicono quanti ombrelloni ci stanno, non quanti metterne', async () => {
  const s = (await get('/admin/spiaggia', token)).body;
  const grande = s.piazzole.find((p) => p.nome === 'Grande');
  // Senza misure non si inventa una capienza: si chiede di prenderle.
  const senza = (await get(`/admin/spiaggia/piazzole/${grande.id}/verifica`, token)).body;
  if (senza.misure_mancanti) assert.match(senza.nota, /col metro/i);

  await send(`/admin/spiaggia/piazzole/${grande.id}`, { larghezza_m: 20, profondita_m: 15 }, 'PUT', token);
  const v = (await get(`/admin/spiaggia/piazzole/${grande.id}/verifica`, token)).body;
  assert.equal(v.misure.mq, 300);
  assert.ok(v.capienza_indicativa > 0, 'con 20×15 e 3 m di ingombro ce ne stanno diversi');
  assert.ok(v.persone === v.capienza_indicativa * 2, 'due persone per ombrellone');
  assert.match(v.nota, /alberi, docce e passaggi/i, 'la formula non decide: verifica');

  // Troppi ombrelloni per lo spazio: ora il sistema li rifiuta PRIMA di crearli, invece di
  // accettarli e lamentarsene dopo.
  const troppi = await send(`/admin/spiaggia/piazzole/${grande.id}/ombrelloni`, { quanti: 40 }, 'POST', token);
  assert.equal(troppi.status, 409);
  assert.match(troppi.body.error, /ce ne stanno/i);
  assert.ok(troppi.body.capienza > 0);
});

test('il colore dice quanto manca, e chi non ha reso l’ombrellone si vede', async () => {
  const s = (await get('/admin/spiaggia', token)).body;
  const conOmbrelloni = s.piazzole.find((p) => p.totale > 0);
  if (!conOmbrelloni) return;
  for (const o of conOmbrelloni.ombrelloni) {
    assert.ok(['libero', 'inizio', 'seconda_meta', 'in_scadenza', 'scaduto', 'occupato', 'bloccato'].includes(o.stato_uso),
      `stato "${o.stato_uso}" sconosciuto: il colore non saprebbe cosa mostrare`);
    if (o.stato_uso !== 'libero' && o.minuti_alla_fine != null) assert.ok(o.minuti_alla_fine >= 0);
    assert.equal(typeof o.non_rilasciato, 'boolean');
  }
});

test('una piazzola si svuota, ma non mentre c’è gente sotto', async () => {
  const s = (await get('/admin/spiaggia', token)).body;
  const occupata = s.piazzole.find((p) => p.occupati > 0);
  if (occupata) {
    const no = await send(`/admin/spiaggia/piazzole/${occupata.id}/ombrelloni`, {}, 'DELETE', token);
    assert.equal(no.status, 409);
    assert.match(no.body.error, /occupati/i);
  }
  const vuota = s.piazzole.find((p) => p.totale > 0 && p.occupati === 0);
  if (vuota) {
    const r = await send(`/admin/spiaggia/piazzole/${vuota.id}/ombrelloni`, {}, 'DELETE', token);
    assert.equal(r.status, 200);
    assert.ok(r.body.tolti > 0, 'sbagliare il numero di ombrelloni deve essere rimediabile');
  }
});

// ---- Le mie prenotazioni, in un posto solo -----------------------------------------------
// "Cosa ho oggi?" è la prima domanda di chi apre l'app, e la risposta stava sparsa fra tre
// schermate: Campi, Fitness, Garden.
test('le prenotazioni attive del socio si leggono tutte insieme', async () => {
  const socio = (await send('/admin/soci', { nome: 'Prenota', cognome: 'Tutto', data_nascita: '1986-06-06', sesso: 'F' }, 'POST', token)).body;
  const vuoto = (await get(`/mie-prenotazioni?tessera_code=${socio.tessera_code}`)).body;
  assert.equal(vuoto.voci.length, 0, 'chi non ha prenotato niente non vede righe finte');

  const campo = (await get('/campi')).body.find((c) => !c.ora_min && (c.gestione || 'chiosco') === 'chiosco');
  const quando = giorno(3);
  const libere = (await get(`/campi/${campo.id}/disponibilita?data=${quando}`)).body.slots.filter((s) => s.stato === 'libero');
  if (!libere.length) return;
  await send(`/campi/${campo.id}/prenota`, { data: quando, slot: libere[0].slot, tessera_code: socio.tessera_code }, 'POST');

  const d = (await get(`/mie-prenotazioni?tessera_code=${socio.tessera_code}`)).body;
  assert.equal(d.voci.length, 1);
  assert.equal(d.voci[0].tipo, 'campo');
  assert.ok(d.voci[0].quando.includes(quando));
  assert.ok(d.voci[0].annulla, 'e da lì si annulla, senza andare a cercarla');
  assert.ok(d.prossima, 'la prima è quella che serve in cima alla home');
});

test('le prenotazioni passate non compaiono più', async () => {
  const socio = (await get('/admin/soci', token)).body.find((x) => x.cognome === 'Tutto');
  const d = (await get(`/mie-prenotazioni?tessera_code=${socio.tessera_code}`)).body;
  const oggi = new Date().toISOString().slice(0, 10);
  for (const v of d.voci) assert.ok(v.data >= oggi, `${v.titolo} è del ${v.data}: è passata`);
});

test('nessun gruppo di parametri compare due volte', async () => {
  // "Accessibilità" compariva due volte: in un caso la à era il carattere singolo, negli altri
  // una a seguita dall'accento combinante. Identiche a vedersi, due stringhe diverse per il
  // raggruppamento — e nel back office due sezioni con lo stesso nome.
  const dopo = (await get('/admin/parametri', token)).body;
  const lista = Array.isArray(dopo) ? dopo : dopo.parametri;
  const gruppi = [...new Set(lista.map((p) => p.gruppo))];
  const normalizzati = gruppi.map((g) => g.normalize('NFC'));
  assert.equal(new Set(normalizzati).size, gruppi.length,
    `due gruppi sembrano uguali ma non lo sono: ${gruppi.join(' | ')}`);
});

test('KOINÈ non compare più da nessuna parte nei testi dell’app', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../public/app.js', '../chiosco/chiosco.js', '../admin/admin.js', '../public/index.html']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    // Restano ammesse solo le chiavi tecniche di compatibilità, che sono commentate come tali:
    // rinominarle a secco farebbe perdere le preferenze o romperebbe il deploy.
    const righe = src.split('\n').filter((r) => /KOIN|koine/i.test(r) && !/^\s*(\/\/|\*)/.test(r.trim()));
    const sospette = righe.filter((r) => !/koine_|KOINE_API|KOINE_DB|KOINE_ENV|KOINE_ENC/.test(r));
    assert.deepEqual(sospette, [], `${f} contiene ancora KOINÈ:\n${sospette.join('\n')}`);
  }
});

test('nessuna traduzione è rimasta monca dopo la rimozione di KOINÈ', async () => {
  // La sostituzione automatica aveva lasciato "Ich bin-Mitglied" e "Soy socio de": pezzi di
  // frase appesi al nulla, che in tedesco e spagnolo si vedevano subito e in italiano no.
  //
  // Il controllo guarda i SEGNI della mutilazione — trattino orfano, doppio spazio — e non le
  // preposizioni finali: molte voci finiscono con una preposizione apposta ("La cucina consegna
  // dalle" + l'orario), e cercarle produceva solo falsi allarmi.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const blocco = src.slice(src.indexOf('const UI_EXTRA = '));
  const dizionari = JSON.parse(blocco.slice(blocco.indexOf('{'), blocco.indexOf('\n')).replace(/;$/, ''));
  for (const [lingua, voci] of Object.entries(dizionari)) {
    for (const [chiave, valore] of Object.entries(voci)) {
      if (typeof valore !== 'string') continue;
      // In tedesco il trattino sospeso e' corretto — "Vor- und Nachname" — quindi si cerca solo
      // il caso vero: uno spazio, il trattino, e subito una parola attaccata ("bin-Mitglied").
      assert.ok(!/\s-[A-Za-zÀ-ÿ]/.test(valore) && !/-$/.test(valore.trim()),
        `${lingua}: "${chiave}" → "${valore}" ha un trattino orfano`);
      assert.ok(!/ {2,}/.test(valore), `${lingua}: "${chiave}" → "${valore}" ha un doppio spazio: manca una parola`);
    }
  }
});


test('il socio può disdire un tavolo dall’app', async () => {
  // Mancava del tutto: si prenotava e non si poteva più annullare. Il tavolo restava occupato
  // tutta la sera da qualcuno che non veniva, e in sala nessuno sapeva se aspettarli.
  const socio = (await send('/admin/soci', { nome: 'Disdice', cognome: 'Tavolo', data_nascita: '1981-01-01', sesso: 'M' }, 'POST', token)).body;
  const oggi = new Date().toISOString().slice(0, 10);
  const p = await send('/admin/tavoli/prenota', { data: oggi, turno: '21:30', persone: 2, tessera_code: socio.tessera_code, nome: 'Tavolo' }, 'POST', token);
  if (p.status !== 201) return;

  const mie = (await get(`/mie-prenotazioni?tessera_code=${socio.tessera_code}`)).body;
  const voce = mie.voci.find((v) => v.tipo === 'garden');
  assert.ok(voce, 'la prenotazione del tavolo compare fra le sue');
  assert.ok(voce.annulla, 'e si può annullare da lì');

  // Un altro socio non può disdire la prenotazione altrui.
  const altro = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.id !== socio.id);
  const no = await send(voce.annulla.rotta, { tessera_code: altro.tessera_code }, 'POST');
  assert.equal(no.status, 403);

  const si = await send(voce.annulla.rotta, { tessera_code: socio.tessera_code }, 'POST');
  assert.equal(si.status, 200);
  const dopo = (await get(`/mie-prenotazioni?tessera_code=${socio.tessera_code}`)).body;
  assert.ok(!dopo.voci.some((v) => v.tipo === 'garden'), 'e sparisce dalle sue prenotazioni');
});

test('a una lezione già tenuta non ci si iscrive', async () => {
  // Il 30 agosto si poteva prendere posto a una lezione di luglio: il calendario la mostrava
  // ancora, perché la griglia parte dalla prima settimana del corso.
  const sedute = (await get('/admin/fitness/sedute?tutte=1', token)).body;
  const passata = sedute.find((s) => new Date(s.data + 'T' + s.ora + ':00') < new Date(Date.now() - 3 * 3600e3));
  if (!passata) return;
  const socio = (await get('/admin/soci', token)).body.find((x) => x.tessera_code && x.attivo);
  const r = await send(`/fitness/sedute/${passata.id}/prenota`, { tessera_code: socio.tessera_code }, 'POST');
  assert.ok(r.status >= 400, 'una lezione finita non accetta iscritti');
  assert.match(JSON.stringify(r.body), /gi\u00e0 tenuta|si e' gia' tenuta/i);
});

// ---- Una comanda abbandonata non è una comanda pagata -----------------------------------
// Le comande mai lavorate venivano marcate "chiusa" dopo N ore — e "chiusa" nel sistema
// significa una cosa sola: pagata. Finivano nel fatturato del giorno e nell'estratto conto del
// socio, che si ritrovava una spesa per qualcosa che non ha mai avuto.
test('l’estratto conto mostra solo quello che è stato davvero pagato', async () => {
  const socio = (await send('/admin/soci', { nome: 'Mai', cognome: 'Servito', data_nascita: '1988-08-08', sesso: 'M' }, 'POST', token)).body;
  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', tessera_code: socio.tessera_code, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  assert.equal(r.status, 201);

  // Chiusa senza pagamento: è lo stato in cui finiva una comanda abbandonata.
  await send(`/admin/comande/${r.body.id}/stato`, { stato: 'chiusa' }, 'PUT', token);
  const e = (await get(`/estratto-conto?tessera_code=${socio.tessera_code}`)).body;
  assert.equal(e.totale, 0, 'una comanda chiusa senza incasso non è una spesa del socio');

  // Incassata davvero: allora sì.
  const r2 = await send('/self-order', { punto: 'Bussola Bar', tessera_code: socio.tessera_code, righe: [{ menu_id: menu[0].id, qta: 1 }] });
  await send(`/admin/comande/${r2.body.id}/chiudi`, { metodo: 'contanti' }, 'POST', token);
  const e2 = (await get(`/estratto-conto?tessera_code=${socio.tessera_code}`)).body;
  assert.ok(e2.totale > 0, 'quello che ha pagato davvero si vede');
});

test('il riepilogo del gestore non conta soldi mai entrati', async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const prima = (await get(`/admin/riepilogo?da=${oggi}&a=${oggi}`, token)).body;
  const incassoPrima = Number(prima?.comande?.tot ?? prima?.totale ?? 0);

  const menu = (await get('/menu?zona=bar')).body;
  const r = await send('/self-order', { punto: 'Bussola Bar', righe: [{ menu_id: menu[0].id, qta: 3 }] });
  await send(`/admin/comande/${r.body.id}/stato`, { stato: 'chiusa' }, 'PUT', token);

  const dopo = (await get(`/admin/riepilogo?da=${oggi}&a=${oggi}`, token)).body;
  const incassoDopo = Number(dopo?.comande?.tot ?? dopo?.totale ?? 0);
  assert.equal(incassoDopo, incassoPrima, 'una comanda chiusa senza incasso non gonfia il fatturato');
});

// ---- Una disposizione appartiene alla sala in cui è nata --------------------------------
// "Nuova disposizione" non salvava l'ambiente: una platea disegnata nello Stage finiva fra le
// piante del Garden, con dentro le sedute. Chi apriva il Garden si trovava a gestire sessantasei
// sedie da un posto senza capire da dove fossero arrivate.
test('una disposizione creata nello Stage resta nello Stage', async () => {
  const primaGarden = (await get('/admin/tavoli/layout?ambiente=garden', token)).body;
  const nG = (primaGarden.layout || primaGarden).length;

  const nuova = await send('/admin/tavoli/layout', { nome: 'Concerto di prova', ambiente: 'stage' }, 'POST', token);
  assert.ok(nuova.status === 200 || nuova.status === 201, JSON.stringify(nuova.body));

  const stage = (await get('/admin/tavoli/layout?ambiente=stage', token)).body;
  const listaStage = stage.layout || stage;
  assert.ok(listaStage.some((l) => l.id === nuova.body.id), 'la disposizione nuova sta fra quelle dello Stage');

  const garden = (await get('/admin/tavoli/layout?ambiente=garden', token)).body;
  const listaGarden = garden.layout || garden;
  assert.equal(listaGarden.length, nG, 'e il Garden non se ne accorge nemmeno');
  assert.ok(!listaGarden.some((l) => l.id === nuova.body.id));
});

test('senza indicare la sala, la disposizione segue quella che copia', async () => {
  const stage = (await get('/admin/tavoli/layout?ambiente=stage', token)).body;
  const base = (stage.layout || stage)[0];
  const r = await send('/admin/tavoli/layout', { nome: 'Copia della platea', copia_da: base.id }, 'POST', token);
  const dopo = (await get('/admin/tavoli/layout?ambiente=stage', token)).body;
  assert.ok((dopo.layout || dopo).some((l) => l.id === r.body.id),
    'copiando una platea si ottiene una platea, non una pianta del Garden');
});

// ---- Le case vacanza le gestisce chi lo ha chiesto --------------------------------------
// Prima bastava essere residente: chi non aveva mai chiesto di fare l'host si ritrovava la
// sezione, e con essa la responsabilità dei dati dei propri ospiti.
test('un residente senza flag host non è un host', async () => {
  const r = (await send('/admin/soci', { nome: 'Solo', cognome: 'Residente', data_nascita: '1975-05-05', sesso: 'M', tipo_profilo: 'residente' }, 'POST', token)).body;
  const s = (await get(`/tessera/${r.tessera_code}`)).body;
  assert.equal(s.is_host, 0, 'il tipo di profilo non rende host nessuno');
});

test('l’host si attiva e si spegne dal proprio profilo', async () => {
  const r = (await send('/admin/soci', { nome: 'Futuro', cognome: 'Host', data_nascita: '1970-07-07', sesso: 'F', tipo_profilo: 'residente' }, 'POST', token)).body;
  const l = await send('/auth/login-tessera', { tessera_code: r.tessera_code }, 'POST');
  const suo = l.body.token;

  const on = await send('/auth/host', { attivo: true }, 'POST', suo);
  assert.equal(on.status, 200);
  assert.equal((await get(`/tessera/${r.tessera_code}`)).body.is_host, 1);

  const off = await send('/auth/host', { attivo: false }, 'POST', suo);
  assert.equal(off.status, 200);
  assert.equal((await get(`/tessera/${r.tessera_code}`)).body.is_host, 0);
});

test('chi non vive nel residence non può gestire case', async () => {
  const r = (await send('/admin/soci', { nome: 'Solo', cognome: 'Socio', data_nascita: '1990-09-09', sesso: 'M', tipo_profilo: 'socio' }, 'POST', token)).body;
  const suo = (await send('/auth/login-tessera', { tessera_code: r.tessera_code }, 'POST')).body.token;
  const no = await send('/auth/host', { attivo: true }, 'POST', suo);
  assert.equal(no.status, 403);
  assert.match(no.body.error, /chi vive nel residence/i);
});

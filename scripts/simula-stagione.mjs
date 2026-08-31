// SIMULAZIONE DI STAGIONE — 2 luglio / 30 agosto, ~400 persone.
//
// Non è un test: è una stagione finta fatta girare sull'applicativo vera attraverso le sue API,
// per scoprire cosa si rompe quando i numeri diventano quelli reali. Ogni chiamata che va male
// viene registrata con il contesto, e alla fine si contano le anomalie per tipo.
//
// Uso:  BASE=http://127.0.0.1:PORTA node scripts/simula-stagione.mjs
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:6100';
const INIZIO = '2026-07-02';
const FINE = '2026-08-30';

// ---------------------------------------------------------------- infrastruttura
let TOKEN = null;
const anomalie = [];
const tempi = {};
let chiamate = 0;

function seg(nome, ms) {
  const t = (tempi[nome] ??= { n: 0, tot: 0, max: 0 });
  t.n++; t.tot += ms; t.max = Math.max(t.max, ms);
}
function anomalia(tipo, dettaglio, contesto) {
  anomalie.push({ tipo, dettaglio: String(dettaglio).slice(0, 200), contesto });
}

async function api(metodo, percorso, corpo, opts = {}) {
  const t0 = Date.now();
  chiamate++;
  let r, testo;
  try {
    r = await fetch(BASE + percorso, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(opts.admin ? { Authorization: 'Bearer ' + TOKEN } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    testo = await r.text();
  } catch (e) {
    anomalia('RETE', e.message, { metodo, percorso });
    return { status: 0, body: null };
  }
  seg(opts.tag || (metodo + ' ' + percorso.split('?')[0].replace(/\/\d+/g, '/:id')), Date.now() - t0);
  let body = null;
  try { body = testo ? JSON.parse(testo) : null; } catch (_) {
    anomalia('RISPOSTA-NON-JSON', testo.slice(0, 120), { metodo, percorso, status: r.status });
  }
  if (r.status >= 500) anomalia('ERRORE-SERVER', (body && body.error) || testo.slice(0, 120), { metodo, percorso, status: r.status, corpo });
  return { status: r.status, body };
}
const GET = (p, o) => api('GET', p, undefined, o);
const POST = (p, b, o) => api('POST', p, b, o);
const PUT = (p, b, o) => api('PUT', p, b, o);

// ---------------------------------------------------------------- popolazione
let rnd = 20260702;
const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
const scegli = (a) => a[Math.floor(rand() * a.length)];
const fra = (a, b) => a + Math.floor(rand() * (b - a + 1));
const forse = (p) => rand() < p;

const NOMI_M = ['Alessandro', 'Marco', 'Giuseppe', 'Francesco', 'Salvatore', 'Antonio', 'Luca', 'Matteo', 'Davide', 'Simone', 'Andrea', 'Giovanni', 'Riccardo', 'Federico', 'Emanuele', 'Gabriele'];
const NOMI_F = ['Giulia', 'Chiara', 'Sara', 'Martina', 'Francesca', 'Alessia', 'Elena', 'Valentina', 'Marta', 'Anna', 'Laura', 'Sofia', 'Aurora', 'Ilaria', 'Roberta', 'Carla'];
const COGNOMI = ['Rizzo', 'Russo', 'Costa', 'Greco', 'Marino', 'Lo Bianco', 'Amato', 'Caruso', 'Ferrara', 'Gullo', 'Privitera', 'Zappalà', 'Cannata', 'Bonanno', 'Sciacca', 'Randazzo', 'Musumeci', 'Interlandi'];

// Fasce d'età: prevalenza 12-30, adulti proporzionali (sono i genitori), coda di anziani.
function eta() {
  const r = rand();
  if (r < 0.08) return fra(4, 11);      //  8%  bambini
  if (r < 0.42) return fra(12, 30);     // 34%  giovani — la fascia prevalente
  if (r < 0.78) return fra(31, 60);     // 36%  adulti/genitori
  if (r < 0.93) return fra(61, 75);     // 15%  pensionati attivi
  return fra(76, 90);                   //  7%  anziani
}
function professione(a) {
  if (a < 18) return 'studente';
  if (a > 66) return 'pensionato';
  const r = rand();
  if (r < 0.42) return 'dipendente pubblico';
  if (r < 0.74) return 'dipendente privato';
  if (r < 0.90) return 'libero professionista';
  if (r < 0.96) return 'imprenditore';
  return 'studente';
}

const CASATE = ['Aretusa', 'Ortigia', 'Neapolis', 'Dionisio', 'Ciane', 'Plemmirio', 'Epipoli', 'Anapo'];
const popolazione = [];

// ---------------------------------------------------------------- calendario
const giorni = [];
for (let d = new Date(INIZIO + 'T12:00:00Z'); d <= new Date(FINE + 'T12:00:00Z'); d = new Date(d.getTime() + 864e5)) {
  const iso = d.toISOString().slice(0, 10);
  const dow = (d.getUTCDay() + 6) % 7;      // 0 = lunedì
  giorni.push({ iso, dow, weekend: dow >= 4, agosto: iso >= '2026-08-01' });
}

// Presenze: bassa a inizio luglio, piena a ferragosto, in calo a fine agosto.
function presenza(g) {
  const t = giorni.indexOf(g) / giorni.length;
  let base = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15));
  if (g.iso >= '2026-08-08' && g.iso <= '2026-08-20') base = Math.min(1, base + 0.18);
  if (g.weekend) base = Math.min(1, base + 0.08);
  return base;
}

// ================================================================ AVVIO
console.log('SIMULAZIONE DI STAGIONE · 2 luglio – 30 agosto 2026\n');
const t0 = Date.now();

const login = await POST('/api/admin/login', { username: 'gestore', password: 'stagione2026' });
TOKEN = login.body?.token;
if (!TOKEN) { console.log('login fallito'); process.exit(1); }

// Le regole temporali si disattivano: la simulazione lavora su date passate e future.
await PUT('/api/admin/parametri', {
  campi_finestra: false, comande_chiusura_automatica: false, campi_numero_legale: false,
  carta_numero_legale: false
}, { admin: true });

// ---- 1. popolazione -------------------------------------------------------
console.log('1. Creazione della popolazione…');
const casateDb = (await GET('/api/casate')).body || [];
const idCasata = Object.fromEntries(casateDb.map(c => [c.nome, c.id]));
const NUM = 400;
for (let i = 0; i < NUM; i++) {
  const a = eta();
  const m = forse(0.5);
  const nome = m ? scegli(NOMI_M) : scegli(NOMI_F);
  const cognome = scegli(COGNOMI);
  const host = i < 10;
  const tipo = host ? 'residente' : (i < 150 ? 'residente' : (a < 14 ? 'under14' : 'ospite_temporaneo'));
  const p = {
    nome, cognome, eta: a, professione: professione(a), host,
    casata: CASATE[i % 8], tipo,
    attivo: 1, email: `${nome}.${cognome}${i}`.toLowerCase().replace(/[^a-z.]/g, '') + '@esempio.it'
  };
  const r = await POST('/api/admin/soci', {
    nome: p.nome, cognome: p.cognome, email: p.email, casata_id: idCasata[p.casata] || null,
    tipo_profilo: p.tipo, attivo: true, note: `${p.eta} anni · ${p.professione}${host ? ' · host' : ''}`
  }, { admin: true, tag: 'crea socio' });
  if (r.status !== 201) { anomalia('CREAZIONE-SOCIO', r.body?.error || r.status, { i }); continue; }
  p.id = r.body.id; p.tessera = r.body.tessera_code;
  if (!p.tessera) anomalia('TESSERA-MANCANTE', 'socio creato senza tessera', { i, id: p.id });
  popolazione.push(p);
}
console.log(`   ${popolazione.length} persone · ${popolazione.filter(p => p.host).length} host`);
const dist = {};
for (const p of popolazione) { const f = p.eta < 12 ? '4-11' : p.eta <= 30 ? '12-30' : p.eta <= 60 ? '31-60' : p.eta <= 75 ? '61-75' : '76-90'; dist[f] = (dist[f] || 0) + 1; }
console.log('   fasce:', Object.entries(dist).map(([k, v]) => `${k}: ${v}`).join(' · '));
const prof = {};
for (const p of popolazione) prof[p.professione] = (prof[p.professione] || 0) + 1;
console.log('   professioni:', Object.entries(prof).map(([k, v]) => `${k}: ${v}`).join(' · '));

const adulti = popolazione.filter(p => p.eta >= 14 && p.tessera);
const giovani = popolazione.filter(p => p.eta >= 12 && p.eta <= 30 && p.tessera);
const sportivi = popolazione.filter(p => p.eta >= 12 && p.eta <= 60 && p.tessera);
const anziani = popolazione.filter(p => p.eta >= 61 && p.tessera);

// ---- 2. impianto della stagione -------------------------------------------
console.log('2. Impianto della stagione (campi, corsi, film, serate)…');
const campi = (await GET('/api/campi')).body || [];
// Ogni voce di menu consuma un articolo: e' il collegamento che nella prima simulazione
// mancava, ed e' il motivo per cui 1008 comande lasciavano il magazzino immobile.
const artMag = (await GET('/api/admin/magazzino', { admin: true })).body?.articoli || [];
const menuTutto = (await GET('/api/admin/menu', { admin: true })).body || [];
let collegati = 0;
for (const v of menuTutto) {
  const a = artMag[collegati % Math.max(1, artMag.length)];
  if (!a) break;
  const r = await PUT(`/api/admin/menu/${v.id}/magazzino`, { magazzino_id: a.id, consumo: 1 }, { admin: true, tag: 'collega menu' });
  if (r.status === 200) collegati++;
}
console.log(`   ${collegati} voci di menu collegate al magazzino`);
console.log(`   ${campi.length} campi`);

// corsi fitness: due periodi
for (const [nome, istr, gg, ora, prezzo] of [
  ['Pilates', 'Anna Rizzo', [1, 3, 5], '18:00', 12],
  ['Yoga all’alba', 'Marco Li Volsi', [2, 4, 6], '07:00', 15],
  ['Zumba', 'Carla D.', [5], '19:30', 10],
  ['Acquagym', 'Sonia P.', [1, 4], '10:00', 12]
]) {
  const r = await POST('/api/admin/fitness/corsi', {
    nome, istruttore: istr, data_inizio: INIZIO, data_fine: FINE, giorni: gg, ora,
    durata_min: 55, posti_max: 20, min_iscritti: 6, prezzo
  }, { admin: true, tag: 'crea corso' });
  if (r.status !== 201) anomalia('CORSO', r.body?.error, { nome });
}
const sedute = (await GET('/api/admin/fitness/sedute?tutte=1', { admin: true })).body || [];
console.log(`   ${sedute.length} lezioni generate`);

// film e proiezioni del mercoledì
const FILM = ['Nuovo Cinema Paradiso', 'Il Postino', 'La Grande Bellezza', 'Baarìa', 'Divorzio all’italiana',
  'Il Gattopardo', 'Stromboli', 'L’avventura', 'Kaos', 'Sedotta e abbandonata'];
const filmIds = [];
for (const t of FILM) {
  const r = await POST('/api/admin/film', { titolo: t, regia: 'vari', anno: 1980, durata_min: 120 }, { admin: true });
  if (r.body?.id) filmIds.push(r.body.id);
}
let fi = 0;
const proiezioni = [];
for (const g of giorni) {
  if (g.dow !== 2) continue;                     // mercoledì
  const r = await POST('/api/admin/proiezioni', { film_id: filmIds[fi++ % filmIds.length], data: g.iso, ora: '21:30' }, { admin: true, tag: 'crea proiezione' });
  if (r.status === 201) proiezioni.push({ id: r.body.id, data: g.iso });
  else anomalia('PROIEZIONE', r.body?.error, { data: g.iso });
}
console.log(`   ${proiezioni.length} proiezioni`);

// ---- 3. la stagione, giorno per giorno ------------------------------------
console.log('3. Sessanta giorni di attività…\n');
const conteggi = { campi: 0, campiRifiutati: 0, garden: 0, gardenRifiutati: 0, carta: 0, fitness: 0, cinema: 0, comande: 0, coperti: 0 };
const motiviRifiuto = {};

const registraRifiuto = (msg) => {
  const chiave = String(msg || 'senza motivo').slice(0, 60);
  motiviRifiuto[chiave] = (motiviRifiuto[chiave] || 0) + 1;
};

let giorno_n = 0;
for (const g of giorni) {
  giorno_n++;
  const occupazione = presenza(g);
  const presenti = popolazione.filter(() => forse(occupazione));

  // --- CAMPI: i giovani giocano, gli adulti al mattino/sera
  const vogliono = sportivi.filter(() => forse(0.10 * occupazione));
  for (const s of vogliono.slice(0, 30)) {
    const c = scegli(campi);
    const disp = await GET(`/api/campi/${c.id}/disponibilita?data=${g.iso}&tessera_code=${s.tessera}`, { tag: 'disponibilita campo' });
    const liberi = (disp.body?.slots || []).filter(x => x.stato === 'libero');
    if (!liberi.length) continue;
    const slot = scegli(liberi).slot;
    const r = await POST(`/api/campi/${c.id}/partita`, { tessera_code: s.tessera, data: g.iso, slot, n_slot: 1 }, { tag: 'prenota campo' });
    if (r.status === 201) {
      conteggi.campi++;
      // gli amici si uniscono
      const amici = giovani.filter(() => forse(0.02));
      for (const a of amici.slice(0, 3)) await POST(`/api/partite-aperte/${r.body.partita_id}/unisciti`, { tessera_code: a.tessera }, { tag: 'unisciti' });
    } else { conteggi.campiRifiutati++; registraRifiuto(r.body?.error); }
  }

  // --- GARDEN: cena, più intensa nel weekend e a ferragosto
  const turni = (await GET(`/api/garden/turni?data=${g.iso}`, { tag: 'turni garden' })).body?.turni || [];
  const tavolate = Math.round((g.weekend ? 14 : 8) * occupazione);
  for (let i = 0; i < tavolate; i++) {
    const capo = scegli(adulti);
    const persone = forse(0.35) ? fra(2, 3) : fra(4, 6);
    const turno = scegli(turni.map(t => t.turno));
    if (!turno) break;
    const r = await POST('/api/garden/prenota', { tessera_code: capo.tessera, data: g.iso, turno, persone }, { tag: 'prenota garden' });
    if (r.status === 201) { conteggi.garden++; conteggi.coperti += persone; }
    else { conteggi.gardenRifiutati++; registraRifiuto(r.body?.error); }
  }

  // --- CASA DI CARTA: pomeriggio, più i giorni di pioggia (simulati)
  const pioggia = forse(0.07);
  const tavoliGioco = Math.round((pioggia ? 6 : 2) * occupazione);
  const turniCarta = (await GET(`/api/carta/turni?data=${g.iso}`, { tag: 'turni carta' })).body?.turni || [];
  for (let i = 0; i < tavoliGioco; i++) {
    const chi = scegli(popolazione.filter(p => p.tessera));
    const t = scegli(turniCarta.filter(x => x.scopo === 'gioco'));
    if (!t) break;
    const r = await POST('/api/carta/prenota', { tessera_code: chi.tessera, data: g.iso, turno: t.turno, persone: fra(2, 4) }, { tag: 'prenota carta' });
    if (r.status === 201) conteggi.carta++; else registraRifiuto(r.body?.error);
  }

  // --- FITNESS: le lezioni del giorno
  for (const s of sedute.filter(x => x.data === g.iso)) {
    const quanti = Math.round(fra(3, 14) * occupazione);
    const candidati = [...adulti].sort(() => rand() - 0.5).slice(0, quanti);
    for (const p of candidati) {
      const r = await POST(`/api/fitness/sedute/${s.id}/prenota`, { tessera_code: p.tessera }, { tag: 'iscrizione fitness' });
      if (r.status === 201) conteggi.fitness++; else registraRifiuto(r.body?.error);
    }
  }

  // --- CINEMA: il mercoledì
  const pro = proiezioni.find(x => x.data === g.iso);
  if (pro) {
    const gruppi = Math.round(12 * occupazione);
    for (let i = 0; i < gruppi; i++) {
      const chi = scegli(adulti);
      const r = await POST(`/api/cinema/${pro.id}/prenota`, { tessera_code: chi.tessera, persone: fra(1, 4) }, { tag: 'prenota cinema' });
      if (r.status === 201) conteggi.cinema++; else registraRifiuto(r.body?.error);
    }
  }

  // --- COMANDE: bar e garden, ciclo completo
  const menu = (await GET('/api/menu?zona=garden', { tag: 'menu' })).body || [];
  const menubar = (await GET('/api/menu?zona=bar', { tag: 'menu' })).body || [];
  const ordini = Math.round((g.weekend ? 26 : 16) * occupazione);
  for (let i = 0; i < ordini; i++) {
    const bar = forse(0.45);
    const m = bar ? menubar : menu;
    if (!m.length) break;
    const righe = [];
    for (let k = 0; k < fra(1, 4); k++) righe.push({ menu_id: scegli(m).id, qta: fra(1, 3) });
    const r = await POST('/api/self-order', { punto: bar ? 'Bussola Bar' : 'Bussola Garden', tavolo: String(fra(1, 12)), righe }, { tag: 'self-order' });
    if (r.status === 201) conteggi.comande++; else registraRifiuto(r.body?.error);
  }
  // lo staff le lavora e le chiude
  const aperte = (await GET('/api/admin/comande', { admin: true, tag: 'elenco comande' })).body || [];
  for (const c of aperte) {
    if (forse(0.85)) await PUT(`/api/admin/comande/${c.id}/stato`, { stato: 'chiusa' }, { admin: true, tag: 'chiudi comanda' });
  }

  if (giorno_n % 10 === 0) {
    console.log(`   giorno ${giorno_n}/${giorni.length} · ${g.iso} · presenze ~${Math.round(occupazione * 100)}% · ${chiamate} chiamate`);
  }
}

// ---- 4. tornei della Coppa -------------------------------------------------
console.log('\n4. Tornei della Coppa delle Casate…');
const discipline = (await GET('/api/admin/discipline', { admin: true })).body || [];
for (const d of discipline) {
  await POST(`/api/admin/tabellone/${d.id}/genera`, {}, { admin: true, tag: 'genera calendario' });
  for (let giro = 0; giro < 8; giro++) {
    const tb = (await GET(`/api/admin/tabellone/${d.id}`, { admin: true, tag: 'tabellone' })).body;
    const da = [...(tb?.gironi || []).flatMap(x => x.partite || []), ...Object.values(tb?.fasi || {}).flat()].filter(p => p && p.stato !== 'giocata');
    if (!da.length) break;
    for (const p of da) {
      const a = fra(0, 5), b = fra(0, 5);
      await PUT(`/api/admin/partite/${p.id}`, { gol_a: a, gol_b: a === b ? b + 1 : b }, { admin: true, tag: 'risultato' });
    }
  }
}
const cart = (await GET('/api/admin/coppa/cartellone', { admin: true })).body;
console.log('   graduatoria:', (cart?.graduatoria || []).slice(0, 3).map(c => `${c.posizione}º ${c.nome} ${c.punti}`).join(' · '));

// ---- 5. chiusura di stagione ----------------------------------------------
console.log('\n5. Chiusura di stagione…');
const ch = (await GET('/api/admin/coppa/chiusura', { admin: true })).body;
console.log('   pronta:', ch?.pronta, ch?.mancanti?.length ? '· mancano: ' + ch.mancanti.map(m => m.nome).join(', ') : '');
if (ch?.pronta) {
  const r = await POST('/api/admin/coppa/chiudi', { stagione: '2026', vincitrice: ch.spareggio ? ch.spareggio[0].id : null }, { admin: true });
  if (r.status === 200) console.log('   Albo d’Oro:', r.body.podio.map(p => `${p.posizione}º ${p.nome}`).join(' · '));
  else anomalia('CHIUSURA-STAGIONE', r.body?.error, {});
}

// ---- 6. controlli di coerenza a fine stagione ------------------------------
console.log('\n6. Controlli di coerenza…');
const controlli = [];
const ver = (nome, ok, dettaglio) => { controlli.push({ nome, ok, dettaglio }); if (!ok) anomalia('COERENZA', nome + ' — ' + dettaglio, {}); };

const soci = (await GET('/api/admin/soci', { admin: true })).body || [];
ver('anagrafica completa', soci.length >= NUM, `${soci.length} soci in archivio su ${NUM} creati`);
ver('nessuna tessera duplicata', new Set(soci.map(s => s.tessera_code)).size === soci.length,
  `${soci.length - new Set(soci.map(s => s.tessera_code)).size} duplicati`);

const casate = (await GET('/api/casate')).body || [];
ver('otto casate', casate.length === 8, `${casate.length}`);
const sommaPunti = casate.reduce((s, c) => s + c.punti, 0);
ver('punti Coppa assegnati', sommaPunti > 0, `totale ${sommaPunti}`);

const cru = (await GET('/api/admin/cruscotto', { admin: true })).body;
ver('cruscotto risponde', !!cru?.oggi, JSON.stringify(cru?.servizio || {}));

// sovrapposizioni: due prenotazioni sullo stesso tavolo, stesso turno
const gControlla = giorni.filter((_, i) => i % 7 === 0);
let sovrapposizioni = 0, capienzaSforata = 0;
for (const g of gControlla) {
  for (const turno of ['20:00', '21:30']) {
    const st = (await GET(`/api/admin/tavoli/turno?data=${g.iso}&ambiente=garden&turno=${turno}`, { admin: true, tag: 'turno garden' })).body;
    if (!st) continue;
    const visti = new Set();
    for (const p of st.prenotazioni || []) for (const n of p.tavoli || []) {
      if (visti.has(n)) sovrapposizioni++;
      visti.add(n);
    }
    if (st.posti_liberi < 0) capienzaSforata++;
  }
}
ver('nessun tavolo assegnato due volte', sovrapposizioni === 0, `${sovrapposizioni} sovrapposizioni`);
ver('capienza mai sforata', capienzaSforata === 0, `${capienzaSforata} turni oltre capienza`);

// platea del cinema
let plateaSforata = 0;
for (const p of proiezioni.slice(0, 5)) {
  const pl = (await GET(`/api/admin/proiezioni/${p.id}/platea`, { admin: true, tag: 'platea' })).body;
  if (pl && pl.posti_liberi < 0) plateaSforata++;
}
ver('platea mai sforata', plateaSforata === 0, `${plateaSforata} proiezioni oltre capienza`);

// magazzino
const mag = (await GET('/api/admin/magazzino', { admin: true })).body;
const negativi = (mag?.articoli || []).filter(a => Number(a.giacenza) < 0);
ver('nessuna giacenza negativa', negativi.length === 0, negativi.map(a => a.nome).join(', '));

// ---- 7. rapporto ------------------------------------------------------------
const durata = Math.round((Date.now() - t0) / 1000);
const perTipo = {};
for (const a of anomalie) perTipo[a.tipo] = (perTipo[a.tipo] || 0) + 1;
const lenti = Object.entries(tempi).map(([k, v]) => ({ endpoint: k, n: v.n, medio: Math.round(v.tot / v.n), max: v.max }))
  .sort((a, b) => b.medio - a.medio).slice(0, 12);

console.log('\n' + '='.repeat(70));
console.log('ESITO');
console.log('='.repeat(70));
console.log(`durata ${durata}s · ${chiamate} chiamate HTTP · ${Math.round(chiamate / durata)} al secondo`);
console.log('\nATTIVITÀ DELLA STAGIONE');
console.log(`  campi prenotati      ${conteggi.campi}   (rifiutati ${conteggi.campiRifiutati})`);
console.log(`  cene al Garden       ${conteggi.garden}   (${conteggi.coperti} coperti, rifiutate ${conteggi.gardenRifiutati})`);
console.log(`  tavoli Casa di Carta ${conteggi.carta}`);
console.log(`  iscrizioni fitness   ${conteggi.fitness}`);
console.log(`  posti cinema         ${conteggi.cinema}`);
console.log(`  comande              ${conteggi.comande}`);

console.log('\nCONTROLLI DI COERENZA');
for (const c of controlli) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome} — ${c.dettaglio}`);

console.log('\nRIFIUTI PIÙ FREQUENTI (le regole che hanno morso)');
Object.entries(motiviRifiuto).sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([m, n]) => console.log(`  ${String(n).padStart(5)} × ${m}`));

console.log('\nANOMALIE');
if (!anomalie.length) console.log('  nessuna');
else {
  Object.entries(perTipo).forEach(([t, n]) => console.log(`  ${String(n).padStart(5)} × ${t}`));
  console.log('\n  primi esempi:');
  anomalie.slice(0, 12).forEach(a => console.log(`   · [${a.tipo}] ${a.dettaglio} ${JSON.stringify(a.contesto).slice(0, 120)}`));
}

console.log('\nENDPOINT PIÙ LENTI (millisecondi)');
lenti.forEach(l => console.log(`  ${String(l.medio).padStart(5)} ms medio · ${String(l.max).padStart(5)} ms max · ${String(l.n).padStart(6)} chiamate · ${l.endpoint}`));

writeFileSync('/tmp/simulazione.json', JSON.stringify({ conteggi, controlli, motiviRifiuto, anomalie, tempi: lenti, chiamate, durata }, null, 2));
console.log('\ndettaglio completo in /tmp/simulazione.json');

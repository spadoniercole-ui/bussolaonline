// ============================================================================================
// SIMULAZIONE DI STAGIONE — 2 luglio → 30 agosto, residence di 145 ville, ~400 persone.
//
// Non e' un test: e' una prova di realta'. Muove ogni giorno della stagione attraverso le API
// vere, come lo farebbero soci e staff, e ANNOTA tutto cio' che non funziona o che funziona
// male. L'obiettivo non e' un esito verde: e' l'elenco degli angoli ciechi.
//
// Ogni chiamata che fallisce viene registrata con contesto. Alla fine il rapporto distingue:
//   · ATTESO   — un rifiuto che e' il comportamento voluto (una regola che morde)
//   · ANOMALIA — un rifiuto che non ci si aspettava: e' li' che si nasconde il difetto
// ============================================================================================
const BASE = process.env.BASE || 'http://127.0.0.1:6400';
const SEASON_START = '2026-07-02';
const SEASON_END = '2026-08-30';
const OGGI = new Date().toISOString().slice(0, 10);

let TOKEN = null;
const anomalie = [];
const attesi = {};
const conta = {};
const tick = (k, n = 1) => { conta[k] = (conta[k] || 0) + n; };

async function api(path, { method = 'GET', body, token = TOKEN, ctx = '' } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch (_) { j = null; }
  return { ok: r.ok, status: r.status, body: j, path, method, ctx };
}

// Un rifiuto previsto si conta; uno imprevisto si annota con tutto il contesto.
function esito(r, previsti = []) {
  if (r.ok) return true;
  const msg = (r.body && r.body.error) || `HTTP ${r.status}`;
  if (previsti.some((p) => new RegExp(p, 'i').test(msg))) {
    attesi[msg.slice(0, 60)] = (attesi[msg.slice(0, 60)] || 0) + 1;
    return false;
  }
  anomalie.push({ quando: r.ctx, chiamata: `${r.method} ${r.path}`, stato: r.status, messaggio: msg });
  return false;
}

const giorni = (() => {
  const out = [];
  let d = new Date(SEASON_START + 'T12:00:00Z');
  const fine = new Date(SEASON_END + 'T12:00:00Z');
  while (d <= fine) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 864e5); }
  return out;
})();
const dow = (iso) => { const g = new Date(iso + 'T12:00:00Z').getUTCDay(); return g === 0 ? 7 : g; };
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const chance = (p) => Math.random() < p;

// Presenze: luglio in crescita, agosto pieno, ferragosto al massimo (dal business plan:
// luglio e agosto valgono il 57% dei ricavi).
function presenze(iso) {
  const m = Number(iso.slice(5, 7)), g = Number(iso.slice(8, 10));
  let base = m === 7 ? 0.45 + (g / 31) * 0.35 : 0.85;
  if (m === 8 && g >= 10 && g <= 20) base = 1.0;         // ferragosto
  if (m === 8 && g >= 26) base = 0.7;                    // coda di stagione
  if ([5, 6, 7].includes(dow(iso))) base = Math.min(1, base + 0.08);  // weekend
  return base;
}

// ============================================================================ POPOLAZIONE
// ~400 persone: residenti (con una decina di host), ospiti. Eta' 4-90, prevalenza 12-30;
// gli adulti 30-60 sono i genitori, quindi proporzionali ai ragazzi. Professioni: 70%
// dipendenti, 30% fra imprenditori e liberi professionisti, pensionati dopo i 65.
const NOMI_M = ['Marco', 'Luca', 'Giuseppe', 'Salvatore', 'Andrea', 'Francesco', 'Antonio', 'Davide', 'Simone', 'Alessio', 'Gabriele', 'Emanuele', 'Riccardo', 'Federico', 'Lorenzo'];
const NOMI_F = ['Giulia', 'Chiara', 'Sara', 'Martina', 'Alessia', 'Federica', 'Valentina', 'Elena', 'Francesca', 'Ilaria', 'Marta', 'Serena', 'Noemi', 'Rosa', 'Concetta'];
const COGNOMI = ['Rizzo', 'Russo', 'Marino', 'Greco', 'Bruno', 'Lombardo', 'Caruso', 'Costa', 'Amato', 'Messina', 'Grasso', 'Parisi', 'Spadaro', 'Coco', 'Privitera', 'Cassarino', 'Fazio', 'Nicosia'];

function etaCasuale() {
  const r = Math.random();
  if (r < 0.12) return 4 + rnd(8);        // bambini 4-11
  if (r < 0.47) return 12 + rnd(19);      // ragazzi 12-30 (prevalenza)
  if (r < 0.82) return 31 + rnd(30);      // genitori 31-60
  return 61 + rnd(30);                    // 61-90
}
function professione(eta) {
  if (eta < 18) return 'studente';
  if (eta >= 67) return 'pensionato';
  return chance(0.30) ? pick(['imprenditore', 'libero professionista']) : pick(['dipendente pubblico', 'dipendente privato']);
}

async function creaPopolazione(casate) {
  const soci = [];
  const N = 400;
  for (let i = 0; i < N; i++) {
    const eta = etaCasuale();
    const donna = chance(0.5);
    const nome = donna ? pick(NOMI_F) : pick(NOMI_M);
    const cognome = pick(COGNOMI);
    const anno = 2026 - eta;
    // 55% residenti, 42% ospiti, 3% host (una decina)
    const r = Math.random();
    const tipo = r < 0.55 ? 'socio' : r < 0.97 ? 'ospite_temporaneo' : 'socio';
    const host = r >= 0.97;
    const casata = pick(casate);
    const res = await api('/admin/soci', {
      method: 'POST', ctx: 'popolazione',
      body: {
        nome, cognome,
        email: `${nome}.${cognome}${i}@esempio.it`.toLowerCase(),
        data_nascita: `${anno}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`,
        casata_id: casata.id,
        tipo_profilo: tipo,
        ruolo: host ? 'host' : (eta >= 18 ? 'socio' : 'minore'),
        consenso_privacy: true,
        consenso_marketing: chance(0.4),
        soggiorno_dal: tipo === 'ospite_temporaneo' ? SEASON_START : null,
        soggiorno_al: tipo === 'ospite_temporaneo' ? SEASON_END : null
      }
    });
    if (esito(res)) {
      soci.push({ id: res.body.id, tessera: res.body.tessera_code, nome, cognome, eta, host, tipo, casata: casata.id, prof: professione(eta) });
      tick('soci_creati');
    }
  }
  return soci;
}

// ============================================================================ AVVIO
console.log('— Simulazione di stagione: 2 luglio → 30 agosto —\n');
const login = await api('/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim2026' }, token: null });
if (!login.ok) { console.error('login fallito'); process.exit(1); }
TOKEN = login.body.token;

// Le regole legate all'orologio impediscono di registrare il passato: per ricostruire la
// stagione fino a oggi vanno sospese, e riaccese prima di simulare i giorni futuri.
// ⚠️ QUESTO È GIÀ UN RILIEVO: non esiste un modo previsto per caricare dati storici.
await api('/admin/parametri', { method: 'PUT', ctx: 'setup', body: { campi_finestra: false, campi_numero_legale: false, comande_chiusura_automatica: false } });

const casate = await api('/casate', { token: null });
console.log('Popolazione: creo 400 persone…');
const soci = await creaPopolazione(casate.body);
const adulti = soci.filter((s) => s.eta >= 18);
const ragazzi = soci.filter((s) => s.eta >= 12 && s.eta <= 30);
const famiglie = soci.filter((s) => s.eta >= 31 && s.eta <= 60);
const anziani = soci.filter((s) => s.eta > 60);
console.log(`  ${soci.length} persone · ${ragazzi.length} fra 12 e 30 · ${famiglie.length} fra 31 e 60 · ${anziani.length} over 60 · ${soci.filter(s => s.host).length} host\n`);

// ============================================================================ ANAGRAFICHE
const campi = (await api('/campi', { token: null })).body;
const menu = (await api('/menu', { token: null })).body;
const menuBar = menu.filter((m) => m.zona === 'bar' || m.zona === 'comune');
const menuGarden = menu.filter((m) => m.zona === 'garden' || m.zona === 'comune');
const discipline = (await api('/admin/discipline')).body;

// Magazzino: articoli di consumo, con carico iniziale di stagione
const artIniziali = (await api('/admin/magazzino')).body.articoli || [];
console.log(`Anagrafiche: ${campi.length} campi · ${menu.length} voci di menù · ${artIniziali.length} articoli a magazzino · ${discipline.length} discipline\n`);

// Corsi fitness della stagione
for (const [nome, istr, gg, ora, prezzo] of [
  ['Pilates', 'Anna Rizzo', [1, 3, 5], '18:00', 12],
  ['Yoga all’alba', 'Marco Li Volsi', [2, 4, 6], '07:00', 15],
  ['Zumba', 'Carla D.', [5], '19:30', 10]
]) {
  esito(await api('/admin/fitness/corsi', {
    method: 'POST', ctx: 'setup corsi',
    body: { nome, istruttore: istr, data_inizio: SEASON_START, data_fine: SEASON_END, giorni: gg, ora, durata_min: 55, posti_max: 20, min_iscritti: 10, prezzo }
  }));
}

// Cartellone cinema: un film ogni mercoledì
const FILM = [['Nuovo Cinema Paradiso', 'Tornatore'], ['Il Postino', 'Radford'], ['La Grande Bellezza', 'Sorrentino'], ['Kaos', 'Taviani'], ['Baarìa', 'Tornatore'], ['Divorzio all’italiana', 'Germi'], ['Il Gattopardo', 'Visconti'], ['Stromboli', 'Rossellini'], ['L’avventura', 'Antonioni']];
const filmIds = [];
for (const [titolo, regia] of FILM) {
  const r = await api('/admin/film', { method: 'POST', ctx: 'setup film', body: { titolo, regia, durata_min: 120 + rnd(60), genere: 'd’autore' } });
  if (esito(r)) filmIds.push(r.body.id);
}
let iFilm = 0;
for (const g of giorni) {
  if (dow(g) !== 3) continue;
  esito(await api('/admin/proiezioni', { method: 'POST', ctx: `cinema ${g}`, body: { film_id: filmIds[iFilm % filmIds.length], data: g, ora: '21:30' } }));
  iFilm++;
}

// Tornei della Coppa: si generano i calendari
for (const d of discipline.slice(0, 6)) {
  esito(await api(`/admin/tabellone/${d.id}/genera`, { method: 'POST', ctx: `torneo ${d.nome}` }));
}

// ============================================================================ LA STAGIONE
console.log('Stagione: 60 giorni…\n');
let incassoStimato = 0;
const consumoArticoli = {};

for (const g of giorni) {
  const p = presenze(g);
  const inResidence = Math.round(soci.length * p);
  const attivi = soci.slice(0, inResidence);
  const futuro = g > OGGI;
  const d = dow(g);

  // ---- rifornimento settimanale del magazzino (lunedì)
  if (d === 1) {
    for (const a of artIniziali.slice(0, 12)) {
      const q = 20 + rnd(40);
      esito(await api(`/admin/magazzino/${a.id}/movimento`, { method: 'POST', ctx: `carico ${g}`, body: { tipo: 'carico', quantita: q, causale: 'rifornimento settimanale' } }));
      tick('carichi');
    }
  }

  // ---- comande: bancone (bar) e servito (garden)
  const nComande = Math.round((6 + rnd(10)) * p);
  for (let i = 0; i < nComande; i++) {
    const alBar = chance(0.55);
    const fonte = alBar ? menuBar : menuGarden;
    if (!fonte.length) continue;
    const righe = Array.from({ length: 1 + rnd(3) }, () => ({ menu_id: pick(fonte).id, qta: 1 + rnd(2) }));
    const r = await api('/self-order', {
      method: 'POST', ctx: `comanda ${g}`, token: null,
      body: { punto: alBar ? 'Bussola Bar' : 'Bussola Garden', tavolo: String(1 + rnd(12)), righe, nome: pick(attivi)?.nome }
    });
    if (esito(r, ['sospesi', 'impegnata'])) {
      tick(alBar ? 'comande_bar' : 'comande_garden');
      incassoStimato += 8 + rnd(25);
      // il servizio le lavora e le chiude
      const id = r.body.id;
      if (id && chance(0.9)) {
        await api(`/admin/comande/${id}/stato`, { method: 'PUT', ctx: `comanda ${g}`, body: { stato: 'consegnata' } });
        await api(`/admin/comande/${id}/stato`, { method: 'PUT', ctx: `comanda ${g}`, body: { stato: 'chiusa' } });
      } else {
        tick('comande_lasciate_aperte');
      }
    }
  }

  // ---- scarico di magazzino di fine giornata
  for (const a of artIniziali.slice(0, 8)) {
    const q = Math.max(1, Math.round((1 + rnd(6)) * p));
    const r = await api(`/admin/magazzino/${a.id}/movimento`, { method: 'POST', ctx: `scarico ${g}`, body: { tipo: 'scarico', quantita: q, causale: 'consumo giornaliero' } });
    if (esito(r)) { consumoArticoli[a.nome] = (consumoArticoli[a.nome] || 0) + q; tick('scarichi'); }
  }

  // ---- campi: pomeriggio sportivo, soprattutto ragazzi
  const nCampi = Math.round(6 * p);
  for (let i = 0; i < nCampi; i++) {
    const campo = pick(campi);
    const disp = await api(`/campi/${campo.id}/disponibilita?data=${g}`, { token: null, ctx: `campi ${g}` });
    if (!disp.ok) { esito(disp); continue; }
    const liberi = (disp.body.slots || []).filter((s) => s.stato === 'libero');
    if (!liberi.length) { tick('campi_pieni'); continue; }
    const titolare = pick(ragazzi.length ? ragazzi : adulti);
    const r = await api(`/campi/${campo.id}/partita`, {
      method: 'POST', token: null, ctx: `campi ${g}`,
      body: { tessera_code: titolare.tessera, data: g, slot: pick(liberi).slot }
    });
    if (esito(r, ['gi\\u00e0', 'massimo', 'anticipo', 'oggi', 'fila', 'tessera'])) {
      tick('campi_prenotati');
      // i compagni si uniscono
      for (const c of [pick(ragazzi), pick(ragazzi), pick(ragazzi)]) {
        if (!c || c.tessera === titolare.tessera) continue;
        const j = await api(`/partite-aperte/${r.body.partita_id}/unisciti`, { method: 'POST', token: null, ctx: `campi ${g}`, body: { tessera_code: c.tessera } });
        if (esito(j, ['gi\\u00e0', 'completa', 'massimo', 'oggi', 'fila'])) tick('unisciti');
      }
    }
  }

  // ---- Garden: cena a due turni
  const nCene = Math.round(10 * p);
  for (let i = 0; i < nCene; i++) {
    const chi = pick(famiglie.length ? famiglie : adulti);
    const r = await api('/garden/prenota', {
      method: 'POST', token: null, ctx: `garden ${g}`,
      body: { tessera_code: chi.tessera, data: g, turno: chance(0.55) ? '20:00' : '21:30', persone: 2 + rnd(4) }
    });
    if (esito(r, ['posti liberi', 'non e', 'Turno non valido'])) {
      tick('cene');
      if (r.body.stage) tick('posti_stage_da_cena', r.body.stage.posti ? r.body.stage.posti.length : 0);
    }
  }

  // ---- Casa di Carta: tavoli da gioco e coworking
  const turniCarta = await api(`/carta/turni?data=${g}`, { token: null, ctx: `carta ${g}` });
  if (turniCarta.ok) {
    for (const t of turniCarta.body.turni) {
      const quanti = t.scopo === 'coworking' ? Math.round(1.5 * p) : Math.round(2.5 * p);
      for (let i = 0; i < quanti; i++) {
        const chi = pick(t.scopo === 'coworking' ? adulti : soci.filter((s) => s.eta >= 10));
        const r = await api('/carta/prenota', {
          method: 'POST', token: null, ctx: `carta ${g} ${t.turno}`,
          body: { tessera_code: chi.tessera, data: g, turno: t.turno, persone: 2 + rnd(3) }
        });
        if (esito(r, ['posti liberi', 'oggi', 'almeno', 'non e'])) tick('tavoli_gioco');
      }
    }
  } else esito(turniCarta);

  // ---- fitness: iscrizioni alle lezioni del giorno
  const fit = await api('/fitness', { token: null, ctx: `fitness ${g}` });
  if (fit.ok) {
    for (const l of (fit.body.lezioni || []).filter((x) => x.data === g)) {
      const quanti = Math.round((6 + rnd(10)) * p);
      for (let i = 0; i < quanti; i++) {
        const chi = pick(adulti);
        const r = await api(`/fitness/sedute/${l.id}/prenota`, { method: 'POST', token: null, ctx: `fitness ${g}`, body: { tessera_code: chi.tessera } });
        esito(r, ['completo', 'gi\\u00e0 iscritto']) && tick('iscrizioni_fitness');
      }
    }
  }

  // ---- cinema del mercoledì: chi non cena prenota il posto
  if (d === 3) {
    const cin = await api('/cinema', { token: null, ctx: `cinema ${g}` });
    if (cin.ok) {
      const pr = (cin.body.prossime || []).find((x) => x.data === g);
      if (pr) {
        const quanti = Math.round(12 * p);
        for (let i = 0; i < quanti; i++) {
          const chi = pick(soci);
          const r = await api(`/cinema/${pr.id}/prenota`, { method: 'POST', token: null, ctx: `cinema ${g}`, body: { tessera_code: chi.tessera, persone: 1 + rnd(3) } });
          esito(r, ['posti liberi', 'completo', 'non e']) && tick('posti_cinema');
        }
      } else if (!futuro) {
        anomalie.push({ quando: `cinema ${g}`, chiamata: 'GET /cinema', stato: 200, messaggio: 'proiezione del giorno non presente nel cartellone pubblico' });
      }
    }
  }

  // ---- risultati dei tornei: due partite a settimana
  if (d === 6) {
    for (const disc of discipline.slice(0, 6)) {
      const tb = await api(`/admin/tabellone/${disc.id}`, { ctx: `torneo ${g}` });
      if (!tb.ok) { esito(tb); continue; }
      const daGiocare = [...(tb.body.gironi || []).flatMap((x) => x.partite || []), ...Object.values(tb.body.fasi || {}).flat()].filter((x) => x && x.stato !== 'giocata');
      for (const partita of daGiocare.slice(0, 2)) {
        const a = rnd(5), b = rnd(5);
        esito(await api(`/admin/partite/${partita.id}`, { method: 'PUT', ctx: `torneo ${g}`, body: { gol_a: a, gol_b: a === b ? b + 1 : b } }));
        tick('partite_giocate');
      }
    }
  }

  if (giorni.indexOf(g) % 10 === 0) process.stdout.write(`  ${g}  presenze ${Math.round(p * 100)}%  ·  anomalie finora: ${anomalie.length}\n`);
}

// ---- si riaccendono le regole legate all'orologio e si guarda cosa succede DA OGGI
await api('/admin/parametri', { method: 'PUT', ctx: 'ripristino', body: { campi_finestra: true, campi_numero_legale: true, comande_chiusura_automatica: true } });

console.log('\n— Verifiche a regole riaccese —');
const oggiDisp = await api(`/campi/${campi[0].id}/disponibilita?data=${OGGI}`, { token: null, ctx: 'verifica oggi' });
esito(oggiDisp);
const fraUnMese = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const troppoAvanti = await api(`/campi/${campi[0].id}/partita`, { method: 'POST', token: null, ctx: 'verifica finestra', body: { tessera_code: soci[0].tessera, data: fraUnMese, slot: '10:00' } });
console.log('  prenotazione a 30 giorni:', troppoAvanti.ok ? '⚠️ ACCETTATA (la finestra non morde)' : '✓ rifiutata — ' + troppoAvanti.body.error);

// ============================================================================ RAPPORTO
const cruscotto = await api('/admin/cruscotto', { ctx: 'rapporto' });
const magFinale = (await api('/admin/magazzino')).body.articoli || [];
const casateFine = (await api('/casate', { token: null })).body;
const chiusura = await api('/admin/coppa/chiusura', { ctx: 'rapporto' });

console.log('\n════════════ RAPPORTO DI STAGIONE ════════════');
console.log('Movimenti generati:');
for (const [k, v] of Object.entries(conta).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
console.log(`\nIncasso F&B stimato: ~€ ${incassoStimato.toLocaleString('it-IT')}`);
console.log(`Magazzino: ${magFinale.filter((a) => a.punto_riordino > 0 && a.giacenza <= a.punto_riordino).length} articoli sotto il punto di riordino`);
console.log(`Coppa: ${chiusura.body?.pronta ? 'chiudibile' : 'mancano ' + (chiusura.body?.mancanti || []).length + ' discipline'}`);
console.log(`Graduatoria: ${casateFine.body ? '' : ''}${(casateFine.body || []).slice(0, 3).map((c) => c.nome + ' ' + c.punti).join(' · ')}`);

console.log('\n──────── RIFIUTI PREVISTI (le regole che mordono) ────────');
for (const [k, v] of Object.entries(attesi).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(5)}× ${k}`);

console.log(`\n──────── ANOMALIE: ${anomalie.length} ────────`);
const perMsg = {};
for (const a of anomalie) {
  const k = `${a.chiamata} · ${a.stato} · ${a.messaggio}`.slice(0, 120);
  (perMsg[k] ??= []).push(a.quando);
}
for (const [k, quando] of Object.entries(perMsg).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(quando.length).padStart(5)}×  ${k}`);
  console.log(`          es. ${quando.slice(0, 3).join(', ')}`);
}
console.log('\nfine');

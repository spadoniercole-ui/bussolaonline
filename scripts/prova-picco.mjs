// Prova di picco: un 15 agosto con 400 persone in residence. Non si tratta di vedere se le
// API rispondono, ma di misurare DOVE il residence si satura e cosa succede quando lo fa.
const BASE = 'http://127.0.0.1:6400';
let TOKEN = null;
const api = async (p, { method = 'GET', body, token = TOKEN } = {}) => {
  const r = await fetch(BASE + '/api' + p, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await r.json(); } catch (_) { }
  return { ok: r.ok, status: r.status, body: j };
};
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

TOKEN = (await api('/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim2026' }, token: null })).body.token;
const soci = (await api('/admin/soci')).body.filter((s) => s.tessera_code);
const domani = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const oggi = new Date().toISOString().slice(0, 10);
console.log(`Prova di picco su ${domani} · ${soci.length} tesserati disponibili\n`);

const esiti = {};
const nota = (k) => { esiti[k] = (esiti[k] || 0) + 1; };
const motivi = {};
const perche = (m) => { const k = String(m).slice(0, 70); motivi[k] = (motivi[k] || 0) + 1; };

// ---------------------------------------------------------------- GARDEN
// Ipotesi realistica: in una sera di ferragosto un quarto dei presenti cena al Garden.
console.log('— Garden: quanti riescono a cenare —');
let copertiOk = 0, cenaRifiutata = 0;
for (let i = 0; i < 120; i++) {
  const r = await api('/garden/prenota', {
    token: null, method: 'POST',
    body: { tessera_code: pick(soci).tessera_code, data: domani, turno: i % 2 ? '20:00' : '21:30', persone: 2 + rnd(3) }
  });
  if (r.ok) { copertiOk += r.body.persone; nota('cene'); } else { cenaRifiutata++; perche(r.body?.error); }
}
const turniG = (await api(`/garden/turni?data=${domani}`, { token: null })).body.turni;
console.log(`  coperti serviti: ${copertiOk} · richieste rifiutate: ${cenaRifiutata}`);
console.log(`  capienza: ${turniG.map((t) => `${t.turno} ${t.posti_totali - t.posti_liberi}/${t.posti_totali}`).join(' · ')}`);

// ---------------------------------------------------------------- CAMPI
console.log('\n— Campi: quante partite entrano in una giornata —');
const campi = (await api('/campi', { token: null })).body;
let partite = 0, campiRifiutati = 0;
for (let i = 0; i < 150; i++) {
  const c = pick(campi);
  const disp = await api(`/campi/${c.id}/disponibilita?data=${domani}`, { token: null });
  const liberi = (disp.body.slots || []).filter((s) => s.stato === 'libero');
  if (!liberi.length) { campiRifiutati++; perche('nessuna fascia libera su ' + c.nome); continue; }
  const r = await api(`/campi/${c.id}/partita`, { token: null, method: 'POST', body: { tessera_code: pick(soci).tessera_code, data: domani, slot: pick(liberi).slot } });
  if (r.ok) { partite++; nota('partite'); } else { campiRifiutati++; perche(r.body?.error); }
}
let fasceTot = 0, fasceLibere = 0;
for (const c of campi) {
  const d = await api(`/campi/${c.id}/disponibilita?data=${domani}`, { token: null });
  fasceTot += (d.body.slots || []).length;
  fasceLibere += (d.body.slots || []).filter((s) => s.stato === 'libero').length;
}
console.log(`  partite avviate: ${partite} · richieste rifiutate: ${campiRifiutati}`);
console.log(`  fasce del giorno: ${fasceTot - fasceLibere}/${fasceTot} occupate su ${campi.length} campi`);

// ---------------------------------------------------------------- CASA DI CARTA
console.log('\n— Casa di Carta: tavoli da gioco —');
const tc = (await api(`/carta/turni?data=${domani}`, { token: null })).body;
let gioco = 0, giocoNo = 0;
for (const t of tc.turni) {
  for (let i = 0; i < 20; i++) {
    const r = await api('/carta/prenota', { token: null, method: 'POST', body: { tessera_code: pick(soci).tessera_code, data: domani, turno: t.turno, persone: 2 + rnd(2) } });
    if (r.ok) { gioco++; nota('tavoli_gioco'); } else { giocoNo++; perche(r.body?.error); }
  }
}
const tc2 = (await api(`/carta/turni?data=${domani}`, { token: null })).body;
console.log(`  tavoli assegnati: ${gioco} · rifiutati: ${giocoNo}`);
console.log(`  ${tc2.turni.map((t) => `${t.etichetta}: ${t.tavoli_totali - t.tavoli_liberi}/${t.tavoli_totali} tavoli`).join(' · ')}`);

// ---------------------------------------------------------------- STAGE
console.log('\n— Stage: la sera di spettacolo —');
const cin = (await api('/cinema', { token: null })).body;
const pr = (cin.prossime || [])[0];
if (pr) {
  let posti = 0, postiNo = 0;
  for (let i = 0; i < 60; i++) {
    const r = await api(`/cinema/${pr.id}/prenota`, { token: null, method: 'POST', body: { tessera_code: pick(soci).tessera_code, persone: 1 + rnd(3) } });
    if (r.ok) { posti += r.body.posti.length; nota('posti_stage'); } else { postiNo++; perche(r.body?.error); }
  }
  const dopo = ((await api('/cinema', { token: null })).body.prossime || []).find((x) => x.id === pr.id);
  console.log(`  posti assegnati: ${posti} · rifiutati: ${postiNo} · liberi residui: ${dopo ? dopo.posti_liberi : '?'}`);
} else console.log('  ⚠️ nessuna proiezione futura nel cartellone');

// ---------------------------------------------------------------- FITNESS
console.log('\n— Fitness —');
const fit = (await api('/fitness', { token: null })).body;
const lez = (fit.lezioni || []).slice(0, 3);
for (const l of lez) {
  let ok = 0, no = 0;
  for (let i = 0; i < 30; i++) {
    const r = await api(`/fitness/sedute/${l.id}/prenota`, { token: null, method: 'POST', body: { tessera_code: pick(soci).tessera_code } });
    if (r.ok) ok++; else { no++; perche(r.body?.error); }
  }
  console.log(`  ${l.corso_nome} ${l.data} ${l.ora}: ${ok} iscritti · ${no} rifiutati · max ${l.posti_max}`);
}

// ---------------------------------------------------------------- MAGAZZINO
console.log('\n— Magazzino: si può andare sotto zero? —');
const arts = (await api('/admin/magazzino')).body.articoli;
const a0 = arts[0];
const troppo = await api(`/admin/magazzino/${a0.id}/movimento`, { method: 'POST', body: { tipo: 'scarico', quantita: Number(a0.giacenza) + 500, causale: 'prova' } });
const dopoScarico = (await api('/admin/magazzino')).body.articoli.find((x) => x.id === a0.id);
console.log(`  ${a0.nome}: giacenza ${a0.giacenza} → scarico di ${Number(a0.giacenza) + 500} → ${dopoScarico.giacenza} ${dopoScarico.giacenza < 0 ? '⚠️ NEGATIVA' : '(bloccata a zero)'}`);
const sotto = (await api('/admin/magazzino')).body.articoli.filter((x) => x.punto_riordino > 0 && x.giacenza <= x.punto_riordino);
console.log(`  articoli sotto il punto di riordino: ${sotto.length} su ${arts.length}`);

// ---------------------------------------------------------------- COMANDE APERTE
console.log('\n— Comande rimaste aperte —');
const aperte = (await api('/admin/comande')).body;
const vecchie = aperte.filter((c) => (Date.now() - new Date(String(c.created_at).replace(' ', 'T') + 'Z')) > 6 * 3600000);
console.log(`  aperte adesso: ${aperte.length} · di cui oltre 6 ore: ${vecchie.length}`);
console.log(`  tavoli che risultano occupati per una comanda: ${new Set(aperte.filter((c) => c.zona === 'garden' && /^\d+$/.test(String(c.riferimento || ''))).map((c) => c.riferimento)).size}`);

// ---------------------------------------------------------------- CRUSCOTTO
const cr = (await api('/admin/cruscotto')).body;
console.log('\n— Cruscotto —');
console.log(`  comande aperte ${cr.servizio.comande_aperte} · in ritardo ${cr.servizio.in_ritardo}`);
console.log(`  oggi: garden ${cr.giornata.garden_coperti} coperti · campi ${cr.giornata.campi} · stage ${cr.giornata.stage_posti} · carta ${cr.giornata.carta_tavoli}`);
console.log(`  richiede una mano: ${cr.attenzione.map((a) => a.testo).join(' | ') || 'niente'}`);

console.log('\n──── perché il sistema ha detto di no ────');
for (const [k, v] of Object.entries(motivi).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(4)}× ${k}`);

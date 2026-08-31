// TRE STAGIONI, SULL'APPLICATIVO VERO.
//
// Non e' un foglio di calcolo che stima: e' il sistema che gira. Prenotazioni, comande, carichi
// e scarichi di magazzino passano dalle stesse rotte che usera' la crew, quindi i numeri che
// escono sono quelli che produrra' il locale — comprese le cose che si inceppano.
//
// DATABASE: mai quello di produzione. Ogni scenario parte da un file nuovo. Una simulazione che
// scrive sui dati veri non e' una simulazione, e' un incidente.
//
// Uso: BASE=http://127.0.0.1:PORTA node scripts/stagione-3-scenari.mjs <contingency|normale|ottimale>
import { writeFileSync, mkdirSync } from 'node:fs';

const SCENARIO = process.argv[2] || 'contingency';
const BASE = process.env.BASE || 'http://127.0.0.1:9000';

// La differenza fra gli scenari non e' solo "quanta gente": e' quanta ne arriva NELLO STESSO
// momento, che e' cio' che mette in ginocchio una cucina con un addetto solo.
const SCENARI = {
  contingency: { quota: 0.10, etichetta: 'Contingency', spesa: 0.85, maltempo: 3 },
  normale:     { quota: 0.50, etichetta: 'Normale',     spesa: 1.00, maltempo: 2 },
  ottimale:    { quota: 0.75, etichetta: 'Ottimale',    spesa: 1.10, maltempo: 2 }
};
const CFG = SCENARI[SCENARIO];
if (!CFG) { console.error('scenario sconosciuto'); process.exit(1); }
const POPOLAZIONE = 400;
const UTENTI = Math.round(POPOLAZIONE * CFG.quota);

// Organico dato: 1 cucina, 1 bar, 1 chiosco, 2 sala.
const ORGANICO = { cucina: 1, bar: 1, chiosco: 1, sala: 2 };
const CAP = { piattiOraCuoco: 25, scontriniOraBarista: 45, tavoliPerCameriere: 8, oreServizio: 5 };

// Stagione dal 20 giugno. Stagionalita' del siracusano: luglio e agosto concentrano il grosso.
// La stagione "commerciale" comincia il 20 giugno, ma la si fa girare a partire da OGGI: il
// sistema rifiuta di prenotare un campo con piu' di sette giorni di anticipo (regola vera), e
// una stagione ambientata l'anno prossimo si farebbe dire di no ottanta volte su ottanta. I
// pesi mensili restano quelli del calendario vero, cosi' la stagionalita' non si perde.
const ANNO = new Date().getUTCFullYear();
const INIZIO = new Date(Date.now() - 2 * 864e5);
const GIORNI = 80;
const MESE_COMMERCIALE = [5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8]; // giu, lug x4, ago x4, set
const PESO_MESE = { 5: 0.55, 6: 0.90, 7: 1.00, 8: 0.60 };

let seme = 20270620;
const caso = () => { seme = (seme * 1103515245 + 12345) & 0x7fffffff; return seme / 0x7fffffff; };
const tra = (a, b) => a + Math.floor(caso() * (b - a + 1));
const forse = (p) => caso() < p;
// caso() puo' restituire esattamente 1 (quando il seme finisce sul valore massimo): senza il
// limite, l'indice esce dall'array e la simulazione muore dopo migliaia di iterazioni, in un
// punto che sembra non c'entrare niente.
const scegli = (a) => a[Math.min(a.length - 1, Math.floor(caso() * a.length))];
const iso = (d) => d.toISOString().slice(0, 10);

let TOKEN = null;
async function api(p, o = {}) {
  const r = await fetch(BASE + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const R = {
  scenario: CFG.etichetta, utenti: UTENTI, giorni: 0,
  incasso: 0, canale: { bar: 0, garden: 0 }, comande: 0, pezzi: 0,
  coperti: 0, copertiPersi: 0, disdette: 0, aggiunte: 0,
  storni: 0, valStorni: 0, nonServite: 0, valNonServite: 0,
  alcoliciNegati: 0, campiOk: 0, campiNo: 0,
  carichi: 0, valCarichi: 0, sottoScorta: [],
  serate: 0, cinema: 0, stagePresenze: 0, fitnessIscritti: 0, fitnessIncasso: 0, fitnessNonPartite: 0,
  giorniCucinaOltre: 0, giorniSalaOltre: 0, piccoPiatti: 0, piccoCoperti: 0,
  maltempo: [], borderline: [], perGiorno: []
};
const nota = (giorno, titolo, cosa, reazione, gravita) => R.borderline.push({ giorno, titolo, cosa, reazione, gravita });

async function prepara() {
  TOKEN = (await api('/api/admin/login', { method: 'POST', body: { username: 'gestore', password: 'sim' } })).body.token;
  if (!TOKEN) throw new Error('login fallito');

  const LISTINO = [
    ['Caffè espresso', 1.10, 'bar', 'Caffetteria', 0, 0], ['Cappuccino', 1.60, 'bar', 'Caffetteria', 0, 0],
    ['Granita siciliana', 3.00, 'bar', 'Granite', 0, 0], ['Acqua 0,5L', 1.00, 'bar', 'Bibite', 0, 0],
    ['Bibita in lattina', 2.50, 'bar', 'Bibite', 0, 0], ['Birra media', 4.00, 'bar', 'Birre', 1, 0],
    ['Spritz', 6.00, 'bar', 'Aperitivi', 1, 0], ['Amaro siciliano', 4.50, 'bar', 'Alcolici', 1, 0],
    ['Gelato artigianale', 3.50, 'bar', 'Gelato', 0, 0],
    ['Panino salsiccia', 6.00, 'cucina', 'Panini e fritti', 0, 1], ['Panino cotoletta', 6.00, 'cucina', 'Panini e fritti', 0, 1],
    ['Hamburger e cheddar', 6.50, 'cucina', 'Panini e fritti', 0, 1], ['Patatine fritte', 3.00, 'cucina', 'Panini e fritti', 0, 1],
    ['Arancino', 3.00, 'cucina', 'Panini e fritti', 0, 0], ['Fettina con contorno', 10.00, 'cucina', 'Piatto', 0, 1],
    ['Petto di pollo con contorno', 10.00, 'cucina', 'Piatto', 0, 1], ['Insalata di riso', 7.00, 'cucina', 'Piatto', 0, 1],
    ['Caprese', 5.00, 'cucina', 'Piatto', 0, 1]
  ];
  const menu = [];
  for (const [nome, prezzo, stazione, categoria, alc, cond] of LISTINO) {
    const m = (await api('/api/admin/menu', { method: 'POST', body: { nome, prezzo, stazione, zona: 'comune', categoria, alcolico: !!alc, con_condimenti: !!cond } })).body;
    menu.push({ id: m.id, nome, prezzo, stazione, alc, cond });
  }
  for (const n of ['Maionese', 'Ketchup', 'Insalata', 'Cipolla caramellata']) {
    await api('/api/admin/menu', { method: 'POST', body: { nome: n, prezzo: 1, stazione: 'cucina', zona: 'comune', categoria: 'Condimenti' } });
  }

  const MAG = [
    ['Pane siciliano', 'cucina', 'pz', 0.35, 'pezzo'], ['Salsiccia', 'cucina', 'kg', 7.50, 'peso'],
    ['Carne bovina', 'cucina', 'kg', 12.00, 'peso'], ['Petto di pollo', 'cucina', 'kg', 8.50, 'peso'],
    ['Patate surgelate', 'cucina', 'kg', 2.20, 'peso'], ['Caffè in grani', 'bar', 'kg', 18.00, 'peso'],
    ['Latte', 'bar', 'l', 1.30, 'peso'], ['Birra fusto', 'bar', 'l', 3.20, 'peso'],
    ['Bibite lattina', 'bar', 'pz', 0.55, 'pezzo'], ['Acqua bottiglie', 'bar', 'pz', 0.18, 'pezzo'],
    ['Gelato vaschette', 'bar', 'kg', 6.50, 'peso']
  ];
  const magazzino = [];
  for (const [nome, area, unita, costo, tipo] of MAG) {
    const a = (await api('/api/admin/magazzino', { method: 'POST', body: { nome, area, zona: 'comune', unita, giacenza: 0, punto_riordino: 25, tipo_consumo: tipo } })).body;
    magazzino.push({ id: a.id, nome, costo, area });
  }
  const lega = async (p, mm, q) => {
    const P = menu.find((x) => x.nome === p), M = magazzino.find((x) => x.nome === mm);
    if (P && M) await api(`/api/admin/menu/${P.id}/magazzino`, { method: 'PUT', body: { magazzino_id: M.id, consumo: q } });
  };
  await lega('Panino salsiccia', 'Pane siciliano', 1); await lega('Panino cotoletta', 'Pane siciliano', 1);
  await lega('Hamburger e cheddar', 'Pane siciliano', 1); await lega('Patatine fritte', 'Patate surgelate', 0.2);
  await lega('Fettina con contorno', 'Carne bovina', 0.22); await lega('Petto di pollo con contorno', 'Petto di pollo', 0.2);
  await lega('Caffè espresso', 'Caffè in grani', 0.008); await lega('Cappuccino', 'Latte', 0.15);
  await lega('Birra media', 'Birra fusto', 0.4); await lega('Bibita in lattina', 'Bibite lattina', 1);
  await lega('Acqua 0,5L', 'Acqua bottiglie', 1); await lega('Gelato artigianale', 'Gelato vaschette', 0.12);

  const soci = [];
  for (let i = 0; i < UTENTI; i++) {
    const minorenne = forse(0.18);
    const anno = minorenne ? ANNO - tra(8, 17) : ANNO - tra(19, 78);
    const s = (await api('/api/admin/soci', { method: 'POST', body: {
      nome: 'Socio' + i, cognome: 'Prova' + i, email: `socio${i}@sim.test`,
      data_nascita: `${anno}-0${tra(1, 9)}-1${tra(0, 8)}`, tipo_profilo: forse(0.35) ? 'residente' : 'socio'
    } })).body;
    if (s && s.tessera_code) soci.push({ tessera_code: s.tessera_code, cognome: 'Prova' + i, minorenne });
  }
  // Per la simulazione si allarga la finestra di prenotazione al massimo consentito: senza,
  // si prenoterebbe solo la prima settimana e i campi resterebbero vuoti per due mesi.
  await api('/api/admin/parametri', { method: 'PUT', body: { campi_finestra_giorni: 60 } });
  const campi = (await api('/api/campi')).body || [];
  console.log(`preparati: ${menu.length} voci di menu, ${magazzino.length} articoli, ${soci.length} soci, ${campi.length} campi`);
  if (!soci.length) throw new Error('nessun socio creato: la simulazione non puo partire');
  return { menu, magazzino, soci, campi };
}

async function simula() {
  const { menu, magazzino, soci, campi } = await prepara();
  const adulti = soci.filter((s) => !s.minorenne);
  const minori = soci.filter((s) => s.minorenne);
  const bar = menu.filter((m) => m.stazione === 'bar');
  const alcolici = menu.filter((m) => m.alc);
  const cucina = menu.filter((m) => m.stazione === 'cucina');

  const maltempo = new Set();
  while (maltempo.size < CFG.maltempo) maltempo.add(tra(12, GIORNI - 12));

  const giacenze = async () => Object.fromEntries(((await api('/api/admin/magazzino')).body.articoli || []).map((a) => [a.id, a]));
  let G = await giacenze();

  for (let g = 0; g < GIORNI; g++) {
    const data = new Date(INIZIO.getTime() + g * 864e5);
    const d = iso(data);
    // Il mese "commerciale": la giornata g cade nella stagione 20 giugno - 7 settembre.
    const mese = MESE_COMMERCIALE[Math.min(MESE_COMMERCIALE.length - 1, Math.floor(g / (GIORNI / MESE_COMMERCIALE.length)))];
    const weekend = [0, 5, 6].includes(data.getUTCDay());
    const brutto = maltempo.has(g);
    const peso = (PESO_MESE[mese] || 0.6) * (weekend ? 1.25 : 1) * (brutto ? 0.35 : 1);
    const attivi = Math.round(UTENTI * 0.45 * peso);
    const gg = { data: d, brutto, weekend, incasso: 0, comande: 0, coperti: 0, piatti: 0, scontriniBar: 0, tavoli: 0 };

    // Fornitore: lunedi' e giovedi'.
    if ([1, 4].includes(data.getUTCDay())) {
      G = await giacenze();
      for (const m of magazzino) {
        const a = G[m.id];
        const soglia = (m.area === 'cucina' ? 45 : 70) * (0.5 + CFG.quota);
        if (!a || Number(a.giacenza) > soglia) continue;
        const q = Math.ceil(soglia * 2 - Number(a.giacenza));
        await api(`/api/admin/magazzino/${m.id}/movimento`, { method: 'POST', body: { tipo: 'carico', quantita: q, causale: 'consegna fornitore' } });
        R.carichi++; R.valCarichi += q * m.costo;
      }
    }

    // Prenotazioni tavoli sui due turni.
    const vogliono = Math.round(attivi * 0.30 * CFG.spesa);
    const pren = [];
    for (let i = 0; i < vogliono; i++) {
      const persone = tra(2, 5);
      const chi = scegli(adulti);
      const r = await api('/api/admin/tavoli/prenota', { method: 'POST', body: { data: d, turno: forse(0.55) ? '20:00' : '21:30', persone, nome: chi.cognome } });
      if (r.status === 201 && (r.body.tavoli || []).length) { pren.push({ id: r.body.id, tavoli: r.body.tavoli, persone, nome: chi.cognome }); R.coperti += persone; gg.coperti += persone; }
      else R.copertiPersi += persone;
    }
    if (gg.coperti > R.piccoCoperti) R.piccoCoperti = gg.coperti;

    // Disdette all'ultimo secondo (col maltempo si moltiplicano).
    for (const p of pren.slice()) {
      if (!forse(brutto ? 0.35 : 0.06) || !p.id) continue;
      await api(`/api/admin/tavoli/prenotazioni/${p.id}`, { method: 'PUT', body: { stato: 'annullato' } });
      R.disdette++; pren.splice(pren.indexOf(p), 1);
    }

    // Bar: il grosso degli scontrini, anche col maltempo.
    const nBar = Math.round(attivi * (brutto ? 0.40 : 0.75));
    for (let i = 0; i < nBar; i++) {
      const righe = [];
      for (let k = 0, n = tra(1, 3); k < n; k++) {
        righe.push({ menu_id: (forse(0.22) ? scegli(alcolici) : scegli(bar)).id, qta: tra(1, 2) });
      }
      // Un minorenne che prova a ordinare un alcolico: il sistema deve dire di no.
      const conTessera = forse(0.35);
      const chi = conTessera ? (forse(0.15) && minori.length ? scegli(minori) : scegli(soci)) : null;
      const r = await api('/api/self-order', { method: 'POST', body: { punto: 'Bussola Bar', tessera_code: chi ? chi.tessera_code : undefined, righe } });
      if (r.status === 403) { R.alcoliciNegati++; continue; }
      if (r.status !== 201) continue;
      R.comande++; gg.comande++; gg.scontriniBar++;
      await api(`/api/admin/comande/${r.body.id}/chiudi`, { method: 'POST', body: { metodo: forse(0.55) ? 'contanti' : 'carta' } });
      R.incasso += Number(r.body.totale); R.canale.bar += Number(r.body.totale); gg.incasso += Number(r.body.totale);
      R.pezzi += righe.length;
    }

    // Garden: comande al tavolo, con aggiunte tardive e imprevisti.
    for (const p of pren) {
      const tav = (p.tavoli || [])[0];
      if (!tav) continue;
      gg.tavoli++;
      const righe = [];
      for (let k = 0; k < p.persone; k++) { righe.push({ menu_id: scegli(cucina).id, qta: 1 }); gg.piatti++; }
      if (forse(0.7)) righe.push({ menu_id: scegli(bar).id, qta: Math.ceil(p.persone / 2) });
      const r = await api('/api/admin/comande', { method: 'POST', body: { origine: 'tavolo', zona: 'garden', riferimento: String(tav), nome: p.nome, righe } });
      if (r.status !== 201) continue;
      R.comande++; gg.comande++;
      let com = r.body;

      if (forse(0.28)) {
        const a = await api('/api/admin/comande', { method: 'POST', body: { origine: 'tavolo', zona: 'garden', riferimento: String(tav), nome: p.nome, righe: [{ menu_id: scegli(bar).id, qta: tra(1, 2) }] } });
        if (a.status === 201) {
          R.aggiunte++; R.comande++;
          await api(`/api/admin/comande/${a.body.id}/chiudi`, { method: 'POST', body: { metodo: 'contanti' } });
          R.incasso += Number(a.body.totale); R.canale.garden += Number(a.body.totale); gg.incasso += Number(a.body.totale);
        }
      }

      // Ingrediente finito o piatto rifiutato: due gesti diversi, due effetti diversi sul magazzino.
      if (forse(0.05)) {
        const riga = (com.righe || []).find((x) => !x.parent_riga_id);
        if (riga) {
          if (forse(0.5)) {
            const dopo = await api(`/api/admin/comande/righe/${riga.id}/storna`, { method: 'PUT', body: { motivo: 'ingrediente finito' } });
            if (dopo.status === 200) { R.storni++; R.valStorni += Number(riga.prezzo) * Number(riga.qta); com = dopo.body; }
          } else {
            const dopo = await api(`/api/admin/comande/righe/${riga.id}/non-servita`, { method: 'PUT', body: { motivo: 'il cliente ha rinunciato' } });
            if (dopo.status === 200) { R.nonServite++; R.valNonServite += Number(riga.prezzo) * Number(riga.qta); com = dopo.body; }
          }
        }
      }
      await api(`/api/admin/comande/${com.id}/chiudi`, { method: 'POST', body: { metodo: forse(0.5) ? 'contanti' : 'carta' } });
      R.incasso += Number(com.totale); R.canale.garden += Number(com.totale); gg.incasso += Number(com.totale);
      R.pezzi += (com.righe || []).length;
    }

    // Campi: col maltempo si svuotano.
    const nCampi = Math.round(attivi * (brutto ? 0.04 : 0.20));
    for (let i = 0; i < nCampi && campi.length; i++) {
      const c = scegli(campi), chi = scegli(adulti);
      // La fascia si chiama "slot" e vale l'ora piena: chiedere "ora" faceva rifiutare tutto.
      // Oltre la finestra il sistema rifiuta: si prenota per il giorno stesso, che e' come si
      // comporta chi e' gia' in residence.
      const r = await api(`/api/campi/${c.id}/prenota`, { method: 'POST', body: { data: d, slot: ['09:00', '10:00', '17:00', '18:00', '19:00'][tra(0, 4)], tessera_code: chi.tessera_code, aperta: forse(0.4) } });
      if (r.status === 201) R.campiOk++;
      else { R.campiNo++; if (/settimana|tetto/i.test(r.body?.error || '')) R.campiTetto = (R.campiTetto || 0) + 1; }
    }

    // Stage: due serate a settimana (musica) e una proiezione, saltate col maltempo.
    if (!brutto && [3, 6].includes(data.getUTCDay())) {
      R.serate++;
      R.stagePresenze += Math.round(attivi * 0.35);
      if (data.getUTCDay() === 3) R.cinema++;
    } else if (brutto && [3, 6].includes(data.getUTCDay())) {
      nota(d, 'Serata saltata per maltempo',
        'Lo spettacolo all\'aperto non si fa: chi aveva prenotato il posto va avvisato e la cena resta.',
        'Si annulla la proiezione dal Crew, la sala tiene i coperti e il Bar assorbe: gli ordini si spostano al banco.', 'attenzione');
    }

    // Fitness: due lezioni a settimana, che sotto il minimo non partono.
    if ([2, 4].includes(data.getUTCDay())) {
      const iscritti = Math.round(attivi * 0.10);
      if (iscritti >= 6 && !brutto) { R.fitnessIscritti += iscritti; R.fitnessIncasso += iscritti * 8; }
      else {
        R.fitnessNonPartite++;
        if (R.fitnessNonPartite === 8) nota(d, 'Il corso non raggiunge mai il minimo',
          `Con ${UTENTI} presenze la lezione non arriva ai 6 iscritti richiesti: l'istruttore viene, la lezione salta.`,
          'Abbassare il minimo a 4 nei mesi di spalla, oppure accorpare le due lezioni in una sola fascia. Il minimo alto ha senso a sala piena, non in bassa stagione.', 'critica');
      }
    }

    const oreCucina = gg.piatti / CAP.piattiOraCuoco;
    const tavoliPerCameriere = gg.tavoli / ORGANICO.sala;
    if (oreCucina > CAP.oreServizio) R.giorniCucinaOltre++;
    if (tavoliPerCameriere > CAP.tavoliPerCameriere) R.giorniSalaOltre++;
    R.piccoPiatti = Math.max(R.piccoPiatti, gg.piatti);
    gg.oreCucina = Number(oreCucina.toFixed(1));
    gg.tavoliPerCameriere = Number(tavoliPerCameriere.toFixed(1));
    if (brutto) R.maltempo.push({ data: d, coperti: gg.coperti, incasso: Number(gg.incasso.toFixed(2)) });
    R.perGiorno.push(gg);
    R.giorni++;
  }

  G = await giacenze();
  for (const m of magazzino) {
    const a = G[m.id];
    if (a && Number(a.giacenza) < Number(a.punto_riordino)) R.sottoScorta.push({ nome: m.nome, giacenza: Number(Number(a.giacenza).toFixed(1)) });
  }
  R.registro = ((await api('/api/admin/registro?limite=2000')).body || []).length;
  return R;
}

const out = await simula();
mkdirSync('/home/claude/sim', { recursive: true });
writeFileSync(`/home/claude/sim/${SCENARIO}.json`, JSON.stringify(out, null, 1));
const e2 = (n) => Number(n).toFixed(2);
console.log(`\n=== ${out.scenario} · ${out.utenti} utenti · ${out.giorni} giorni ===`);
console.log('incasso stagione     :', e2(out.incasso), '(bar', e2(out.canale.bar), '· garden', e2(out.canale.garden) + ')');
console.log('comande / pezzi      :', out.comande, '/', out.pezzi, '· scontrino medio', e2(out.incasso / Math.max(1, out.comande)));
console.log('coperti serviti      :', out.coperti, '· persi per sala piena:', out.copertiPersi);
console.log('disdette / aggiunte  :', out.disdette, '/', out.aggiunte);
console.log('storni / non serviti :', out.storni, `(${e2(out.valStorni)})`, '/', out.nonServite, `(${e2(out.valNonServite)})`);
console.log('alcolici negati      :', out.alcoliciNegati);
console.log('campi ok / rifiutati :', out.campiOk, '/', out.campiNo);
console.log('magazzino            :', out.carichi, 'carichi ·', e2(out.valCarichi), 'di merce · sotto scorta a fine stagione:', out.sottoScorta.length);
console.log('stage                :', out.serate, 'serate ·', out.cinema, 'proiezioni ·', out.stagePresenze, 'presenze');
console.log('fitness              :', out.fitnessIscritti, 'iscritti ·', e2(out.fitnessIncasso), '· lezioni non partite:', out.fitnessNonPartite);
console.log('giorni oltre capacità: cucina', out.giorniCucinaOltre, '· sala', out.giorniSalaOltre, '· picco piatti/giorno', out.piccoPiatti);

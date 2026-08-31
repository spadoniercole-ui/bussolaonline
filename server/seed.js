import { hashPassword } from './auth.js';
import { encryptJSON } from './crypto.js';
import { audit, db, initSchema, setSetting, url } from './db.js';
import { generaCalendario, registraRisultato } from './tournament.js';

var force = process.argv.includes("--force");
async function seed({ verbose = false } = {}) {
  await initSchema();
  const already = (await db.prepare("SELECT count(*) c FROM casate").get()).c;
  if (already > 0 && !force) {
    if (verbose) console.log("DB gi\xE0 popolato \u2014 salto il seed (usa --force per riscrivere).");
    return;
  }
  if (force) {
    for (const t of ["audit_log", "allegati", "strutture", "partita_iscritti", "partite_aperte", "prenotazioni_campo", "campi", "comanda_righe", "comande", "menu_articoli", "magazzino_movimenti", "magazzino_articoli", "cdc_prestiti", "cdc_check", "cdc_caffe_conte", "cdc_giochi", "cdc_caffe", "proposte", "serate_prenotazioni", "serate", "convocazioni", "partite", "classifica", "gironi", "discipline", "prenotazioni", "risorse", "eventi", "soci", "bussola", "luoghi", "contest_esiti", "contest", "casate", "utenti_admin"]) {
      await db.exec(`DELETE FROM ${t};`);
    }
  }
  const CASATE = [
    ["Aretusa", "#2E6DA4", "l'onda", 0],
    ["Ortigia", "#B7791F", "la rosa dei venti", 0],
    ["Neapolis", "#C0553F", "il teatro", 0],
    ["Dionisio", "#6E5AA6", "la maschera", 0],
    ["Ciane", "#4d7a4a", "il papiro", 0],
    ["Plemmirio", "#12324F", "il faro", 0],
    ["Epipoli", "#7A8790", "le mura", 0],
    ["Anapo", "#2E7D77", "il fiume", 0]
  ];
  const insCasata = db.prepare("INSERT INTO casate (nome,colore,motto,punti) VALUES (?,?,?,?)");
  const casataId = {};
  for (const c of CASATE) {
    const r = await insCasata.run(...c);
    casataId[c[0]] = r.lastInsertRowid;
  }
  const EVENTI = [
    // Lunedì lasciato VUOTO di proposito: coincide con l'inizio dei periodi di vacanza (arrivi/partenze degli esterni).
    ["lun", "Luned\xEC", "Giornata libera", "", "#7A8790", "Arrivi, partenze e riposo", "Nessuna attivit\xE0 in cartellone: il luned\xEC coincide con il cambio degli ospiti (arrivi e partenze). \xC8 il giorno di riposo del residence.", null, null, "libero", 1],
    ["mar", "Marted\xEC", "Vinile & Vino", "Bussola Garden", "#C0553F", "Scegli tu la musica della serata", "La serata la costruisci tu: proponi un vinile, i brani e il perch\xE9. Le proposte della settimana diventano la scaletta di quella successiva.", "Proponi un vinile", "sheet-vinile", "serata", 2],
    ["mer", "Mercoled\xEC", "Cinema d'autore sotto le stelle", "Bussola Stage", "#12324F", "Ortigia Film Festival & titoli d'autore", "Una proiezione a settimana: opere premiate all'Ortigia Film Festival, alternate a titoli pi\xF9 leggeri ma sempre d'autore.", "Prenota un posto", null, "cinema", 3],
    ["gio", "Gioved\xEC", "Jazz & Cocktail", "Bussola Garden", "#2E7D77", "La serata-firma \xB7 trio live", "La serata-firma della Bussola: trio live acustico, luci basse, cocktail. Si cena prima dello spettacolo.", "Prenota un tavolo", null, "serata", 4],
    ["ven", "Venerd\xEC", "Serata dei Clan", "Bussola Stage", "#6E5AA6", "Le otto casate si sfidano", "Le otto casate si sfidano dall\u2019apericena a tarda sera. Questa settimana: gara di karaoke. Coinvolgi un ospite e la tua casata guadagna punti extra.", "Vai alla Coppa", "go-coppa", "serata", 5],
    ["sab", "Sabato", "Live Session", "Bussola Stage", "#B7791F", "Band e cantautori emergenti", "Band e cantautori emergenti dal vivo sul Bussola Stage.", "Prenota un posto", null, "serata", 6],
    ["dom", "Domenica", "Open Mic", "Bussola Stage", "#B7791F", "Tre minuti di palco per te", "Microfono aperto: tre minuti a testa per cantare, recitare un monologo, fare stand-up (linguaggio moderato) o suonare.", "Salgo sul palco", "sheet-openmic", "serata", 7]
  ];
  const insEvento = db.prepare("INSERT INTO eventi (chiave,giorno,titolo,ambiente,colore,sottotitolo,descrizione,cta,azione,tipo,ordine) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const e of EVENTI) await insEvento.run(...e);
  const RISORSE = [
    ["pickleball", "Campo di Pickleball", "sport", "Turni da 90 minuti \xB7 gioco 17\u201320", JSON.stringify(["17:00\u201318:30", "18:30\u201320:00"]), "Si gioca dalle 17 alle 20, per rispettare il silenzio pomeridiano e le attivit\xE0 della sera sul palco."],
    ["soft", "Campo di Soft tennis", "sport", "Turni da 90 minuti \xB7 gioco 17\u201320", JSON.stringify(["17:00\u201318:30", "18:30\u201320:00"]), "Si gioca dalle 17 alle 20, per rispettare il silenzio pomeridiano e le attivit\xE0 della sera."],
    ["tavolo", "Tavolo per la cena", "tavolo", "~40 coperti serviti \xB7 turni 20:00 e 21:30", JSON.stringify(["20:00", "21:30"]), "Indica il numero di persone. All\u2019apertura di stagione c\u2019\xE8 un unico turno alle 20:00 (segue la sfilata dei clan)."]
  ];
  const insRis = db.prepare("INSERT INTO risorse (chiave,nome,tipo,sottotitolo,slots,nota) VALUES (?,?,?,?,?,?)");
  for (const r of RISORSE) await insRis.run(...r);
  const CAS_A = ["Aretusa", "Ortigia", "Ciane", "Epipoli"];
  const CAS_B = ["Neapolis", "Dionisio", "Plemmirio", "Anapo"];
  const SPORT = [
    [
      "pickle",
      "Pickleball",
      [[3, 3, 9], [3, 2, 6], [3, 1, 3], [3, 0, 0]],
      [[3, 2, 6], [3, 2, 6], [3, 1, 3], [3, 1, 3]],
      [["Aretusa", "Ortigia", "Dom 17:30", "Campo 1"], ["Neapolis", "Dionisio", "Dom 19:00", "Campo 1"], ["Ciane", "Epipoli", "Mar 17:30", "Campo 1"]],
      [["Aretusa", "Ciane", "11\u20136"], ["Ortigia", "Epipoli", "11\u20139"], ["Plemmirio", "Anapo", "9\u201311"]]
    ],
    [
      "soft",
      "Soft tennis",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [["Aretusa", "Plemmirio", "Gio 18:00", "Campo 1"], ["Ortigia", "Ciane", "Sab 17:30", "Campo 1"]],
      [["Neapolis", "Anapo", "6\u20132"], ["Dionisio", "Epipoli", "6\u20134"]]
    ],
    [
      "pingpong",
      "Ping pong",
      [[3, 3, 6], [3, 2, 4], [3, 1, 2], [3, 0, 0]],
      [[3, 2, 4], [3, 2, 4], [3, 1, 2], [3, 1, 2]],
      [["Ciane", "Aretusa", "Lun 18:30", "Bussola Bar"], ["Anapo", "Neapolis", "Mer 18:30", "Bussola Bar"]],
      [["Ortigia", "Epipoli", "3\u20131"], ["Dionisio", "Plemmirio", "3\u20132"]]
    ],
    [
      "balilla",
      "Calcio balilla",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 0, 1], [2, 0, 1]],
      [["Aretusa", "Epipoli", "Ven 19:00", "Bussola Bar"], ["Neapolis", "Plemmirio", "Ven 19:30", "Bussola Bar"]],
      [["Ortigia", "Ciane", "10\u20137"], ["Dionisio", "Anapo", "10\u20134"]]
    ],
    [
      "basket",
      "Basket 3\xD73",
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [["Aretusa", "Ciane", "Sab 18:00", "Campo del residence"], ["Neapolis", "Plemmirio", "Dom 18:00", "Campo del residence"]],
      [["Ortigia", "Epipoli", "21\u201315"], ["Dionisio", "Anapo", "21\u201312"]]
    ],
    [
      "calcetto",
      "Calcetto a 5",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 0, 1], [2, 0, 1]],
      [["Aretusa", "Epipoli", "Ven 18:30", "Campo del residence"], ["Neapolis", "Dionisio", "Sab 19:00", "Campo del residence"]],
      [["Ortigia", "Ciane", "5\u20133"], ["Plemmirio", "Anapo", "4\u20134"]]
    ]
  ];
  const GIOCHI = [
    [
      "burraco",
      "Burraco",
      [[3, 3, 9], [3, 2, 6], [3, 1, 3], [3, 0, 0]],
      [[3, 2, 6], [3, 2, 6], [3, 1, 3], [3, 1, 3]],
      [["Aretusa", "Neapolis", "Mar 21:00", "Casa di Carta"], ["Ortigia", "Dionisio", "Gio 21:00", "Casa di Carta"]],
      [["Ciane", "Epipoli", "2\u20130"], ["Plemmirio", "Anapo", "1\u20132"]]
    ],
    [
      "scala",
      "Scala 40",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 0, 1], [2, 0, 1]],
      [["Aretusa", "Epipoli", "Gio 21:30", "Casa di Carta"], ["Neapolis", "Anapo", "Sab 21:00", "Casa di Carta"]],
      [["Ortigia", "Ciane", "1\u20130"], ["Dionisio", "Plemmirio", "1\u20131"]]
    ],
    [
      "briscola",
      "Briscola/Scopa",
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [["Aretusa", "Ciane", "Ven 21:00", "Casa di Carta"], ["Neapolis", "Dionisio", "Dom 21:00", "Casa di Carta"]],
      [["Ortigia", "Epipoli", "2\u20131"], ["Plemmirio", "Anapo", "2\u20130"]]
    ],
    [
      "scacchi",
      "Scacchi/Dama",
      [[3, 3, 6], [3, 2, 4], [3, 1, 2], [3, 0, 0]],
      [[3, 2, 4], [3, 2, 4], [3, 1, 2], [3, 1, 2]],
      [["Aretusa", "Ortigia", "Lun 21:00", "Casa di Carta"], ["Ciane", "Epipoli", "Mer 21:00", "Casa di Carta"]],
      [["Dionisio", "Plemmirio", "1\u20130"], ["Neapolis", "Anapo", "\xBD\u2013\xBD"]]
    ]
  ];
  const MINMAX = {
    pickle: [2, 2],
    soft: [2, 2],
    pingpong: [1, 2],
    balilla: [2, 2],
    basket: [3, 4],
    calcetto: [5, 7],
    burraco: [2, 4],
    scala: [2, 4],
    briscola: [2, 4],
    scacchi: [1, 1]
  };
  const insDisc = db.prepare("INSERT INTO discipline (dominio,chiave,nome,attivo,min_giocatori,max_giocatori,ordine) VALUES (?,?,?,?,?,?,?)");
  const discIds = [];
  async function loadDomain(dom, list) {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const mm = MINMAX[d[0]] || [1, 1];
      // In cartellone sei discipline: 6 × 19 partite = 114, cioe' ~2 al giorno su 60 giorni.
      // Con dieci ne servirebbero 190, oltre 3 al giorno, e la stagione finisce senza
      // graduatoria. Le altre restano registrate ma spente.
      const inCartellone = ["calcetto", "basket", "soft", "pickle", "burraco", "scala"].includes(d[0]);
      discIds.push((await insDisc.run(dom, d[0], d[1], inCartellone ? 1 : 0, mm[0], mm[1], i)).lastInsertRowid);
    }
  }
  await loadDomain("sport", SPORT);
  await loadDomain("giochi", GIOCHI);
  const demoScores = [[2, 1], [1, 1], [2, 0], [1, 0]];
  for (const did of discIds) {
    await generaCalendario(did);
    const g1 = await db.prepare("SELECT id FROM partite WHERE disciplina_id=? AND giornata=1").all(did);
    for (let k = 0; k < g1.length; k++) {
      await registraRisultato(g1[k].id, demoScores[k % demoScores.length][0], demoScores[k % demoScores.length][1]);
    }
  }
  const BUSSOLA = [
    // Nessuna coordinata qui: le posizioni si inseriscono dal back office, verificate sulla
    // mappa. Inventarle significa mandare qualcuno nel posto sbagliato.
    ["servizi", "Farmacia", "Fontane Bianche", "~600 m", 1],
    ["servizi", "Guardia medica", "Cassibile", "~5 km", 2],
    ["servizi", "Spiaggia", "Fontane Bianche", "~300 m", 3],
    ["servizi", "Market & alimentari", "Viale dei Lidi", "~700 m", 4],
    ["servizi", "Bar & tabacchi", "Fontane Bianche", "~500 m", 5],
    ["vedere", "Ortigia", "Centro storico di Siracusa \xB7 cultura", "~20 km", 1],
    ["vedere", "Parco della Neapolis", "Teatro Greco \xB7 Orecchio di Dioniso", "~22 km", 2],
    ["vedere", "Duomo di Siracusa", "Luogo di culto \xB7 barocco", "~20 km", 3],
    ["vedere", "Riserva del Plemmirio", "Area marina protetta \xB7 natura", "~12 km", 4],
    ["vedere", "Cavagrande del Cassibile", "Laghetti e sentieri \xB7 natura", "~18 km", 5],
    ["rifiuti", "Lun \xB7 Organico", "", "", 1],
    ["rifiuti", "Mar \xB7 Plastica", "", "", 2],
    ["rifiuti", "Mer \xB7 Carta", "", "", 3],
    ["rifiuti", "Gio \xB7 Organico", "", "", 4],
    ["rifiuti", "Ven \xB7 Vetro", "", "", 5],
    ["rifiuti", "Sab \xB7 Indifferenziato", "", "", 6],
    ["orari", "Silenzio pomeridiano", "Dalle 14:00 alle 17:00 \u2014 riposo per tutti.", "", 1],
    ["orari", "Silenzio notturno", "Dopo le 23:30 \u2014 si abbassano voci e musica.", "", 2]
  ];
  const insBus = db.prepare("INSERT INTO bussola (sezione,titolo,dettaglio,distanza,ordine,lat,lng) VALUES (?,?,?,?,?,?,?)");
  for (const b of BUSSOLA) await insBus.run(b[0], b[1], b[2], b[3], b[4], b[5] ?? null, b[6] ?? null);
  const insContest = db.prepare("INSERT INTO contest (titolo,tipo,settimana,brief,stato,vincitore,punti_scala,esito_assegnato,attivo) VALUES (?,?,?,?,?,?,?,?,1)");
  await insContest.run(
    "Apertura di stagione \u2014 Sfilata dei Clan",
    "sfilata",
    "apertura stagione",
    "Dopo l'unico turno di cena delle 20:00, le otto casate si presentano in sfilata. Chi dimostra di aver agito come vero clan \u2014 abbigliamento coordinato, un motto, un grido di battaglia, un rito propiziatorio \u2014 prende subito punti. Ai pi\xF9 simpatici, geniali, divertenti e fantasiosi vanno 10 punti. Il voto lo esprimono gli altri clan.",
    "annunciato",
    null,
    JSON.stringify([10, 0, 0, 0, 0, 0, 0, 0]),
    0
  );
  await insContest.run(
    "Il mio nome \xE8 Bond, James Bond",
    "cocktail",
    "25\u201331 agosto",
    "Dati 3 liquori, un'acqua tonica e un selz, ogni casata crea il proprio cocktail. Banco bar e attrezzatura a disposizione; presentate nome e ricetta. I primi 3 finalisti saranno in vendita nel weekend; a fine settimana la graduatoria della giuria + il bonus vendite (4/2/1 pezzi venduti) assegna i punti Coppa.",
    "annunciato",
    null,
    null,
    0
  );
  const insSerata = db.prepare("INSERT INTO serate (chiave,titolo,data,quando,tema,descrizione,quota,capienza,ordine) VALUES (?,?,?,?,?,?,?,?,?)");
  await insSerata.run(
    "apertura",
    "Apertura di stagione",
    "2026-05-30",
    "Sab 30 maggio \xB7 unico turno 20:00",
    "Presentazione e sfilata dei Clan",
    "Cena unica alle 20:00, poi presentazione e sfilata delle otto casate. I clan che si presentano come tali (abbigliamento coordinato, motto, grido, rito) prendono subito punti: 10 al migliore, votato dagli altri clan.",
    25,
    120,
    1
  );
  await insSerata.run(
    "tema_luglio",
    "Serata a tema \xB7 fine luglio",
    "2026-07-25",
    "Sab 25 luglio \xB7 20:00",
    "Tema da annunciare",
    "La serata a tema di fine luglio: il tema viene svelato dal CdA. Cena a numero chiuso con prenotazione.",
    30,
    100,
    2
  );
  await insSerata.run(
    "ferragosto",
    "Cena di Ferragosto",
    "2026-08-15",
    "Sab 15 agosto \xB7 20:00",
    "Gran serata",
    "La serata clou dell\u2019estate: cena speciale di Ferragosto con musica dal vivo. Posti limitati, prenotazione consigliata.",
    40,
    140,
    3
  );
  await insSerata.run(
    "fine_stagione",
    "Chiusura di stagione",
    "2026-09-12",
    "Sab 12 settembre \xB7 20:00",
    "Premiazione Coppa delle Casate",
    "L\u2019ultima grande serata: cena, premiazione della Coppa delle Casate e Albo d\u2019Oro. Si saluta l\u2019estate insieme.",
    30,
    120,
    4
  );
  const insLuogo = db.prepare("INSERT INTO luoghi (chiave,nome,lat,lng,ordine) VALUES (?,?,?,?,?)");
  await insLuogo.run("chiosco", "Chiosco La Bussola", 36.967766, 15.221669, 1);
  await insLuogo.run("isola", "Isola ecologica", 36.967209, 15.221206, 2);
  const insSocio = db.prepare(`INSERT INTO soci (tessera_code,nome,cognome,email,casata_id,ruolo,tipo_profilo,tutore_id,lingua,consenso_privacy,consenso_marketing,notifiche_push,valida_fino)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  await insSocio.run("RB-000001-4", "Ercole", "\u2014", "socio@example.com", casataId["Aretusa"], "socio", "socio", null, "it", 1, 0, 1, "2027-05-01");
  await insSocio.run("RB-000002-8", "Giulia", "R.", "giulia@example.com", casataId["Ortigia"], "capitano", "socio", null, "it", 1, 1, 1, "2027-05-01");
  const genitoreId = (await insSocio.run("RB-000003-1", "Marco", "V.", "marco@example.com", casataId["Neapolis"], "socio", "genitore", null, "en", 1, 0, 1, "2027-05-01")).lastInsertRowid;
  await insSocio.run("RB-000004-5", "Sara", "V.", "", casataId["Neapolis"], "socio", "under14", genitoreId, "it", 1, 0, 0, "2027-05-01");
  await insSocio.run("RB-000005-9", "Luca", "P.", "luca@example.com", casataId["Ciane"], "socio", "ospite_temporaneo", null, "fr", 1, 0, 0, null);
  await db.prepare("UPDATE soci SET soggiorno_dal='2026-08-10', soggiorno_al='2026-08-24' WHERE tessera_code='RB-000005-9'").run();
  const residenteId = Number((await insSocio.run("RB-000100-6", "Chiara", "T.", "residente@example.com", null, "socio", "residente", null, "it", 1, 0, 0, "2026-09-30")).lastInsertRowid);
  await db.prepare("UPDATE soci SET host=1 WHERE id=?").run(residenteId);
  const struttInfo = await db.prepare("INSERT INTO strutture (socio_id,dati_cifrati,attivo) VALUES (?,?,1)").run(residenteId, encryptJSON({
    nome: "Villa Aretusa",
    cir: "CIR-19091-BEA-00123",
    cin: "IT089017C2X9ABC123",
    regole: "Check-out entro le 10:00. Silenzio dopo le 23. Rifiuti secondo il calendario del residence. Vietato fumare all'interno. Animali ammessi su richiesta.",
    isolato: "B",
    numero: "14",
    check_out: "10:00",
    lat: 37.0361,
    lng: 15.2969
  }));
  await db.prepare("UPDATE soci SET struttura_id=? WHERE tessera_code='RB-000006-2'").run(Number(struttInfo.lastInsertRowid));
  const ort = casataId["Ortigia"];
  const compagni = [["Anna", "B."], ["Paolo", "C."], ["Elena", "D."], ["Davide", "F."], ["Marta", "G."], ["Sara", "L."]];
  for (let i = 0; i < compagni.length; i++) {
    const n = compagni[i];
    await insSocio.run(`RB-000007-6${(6 + i).toString().padStart(2, "0")}`, n[0], n[1], "", ort, "socio", "socio", null, "it", 1, 0, i % 2, "2027-05-01");
  }
  const insRifTipo = db.prepare("INSERT INTO rifiuti_tipi (nome,colore,ordine) VALUES (?,?,?)");
  const RIF_TIPI = [["Organico", "#6b4a2b", 1], ["Plastica e lattine", "#d99a00", 2], ["Carta e cartone", "#2E6DA4", 3], ["Vetro", "#3f7a4a", 4], ["Indifferenziato", "#6b6f73", 5]];
  for (const t of RIF_TIPI) await insRifTipo.run(...t);
  await db.prepare("INSERT INTO rifiuti_calendario (periodo,inizio_conf,fine_conf,ora_ritiro,giorni,ordine) VALUES (?,?,?,?,?,?)").run("Estivo", "18:30", "21:30", "22:00", JSON.stringify({ lun: ["Organico"], mar: ["Plastica e lattine"], mer: ["Carta e cartone"], gio: ["Organico"], ven: ["Carta e cartone", "Vetro"], sab: ["Indifferenziato"], dom: [] }), 1);
  const insReg = db.prepare("INSERT INTO regolamenti (chiave,titolo,testo,ordine) VALUES (?,?,?,?)");
  await insReg.run("coppa", "Coppa delle Casate", "Le otto casate si sfidano nelle discipline sportive e nei giochi durante il periodo di svolgimento. Ogni vittoria e pareggio assegna punti alla graduatoria; le migliori accedono a semifinali e finale. La classifica generale determina la Coppa della stagione.", 1);
  await insReg.run("contest", "Serata dei Clan", "Il CdA lancia la sfida (cocktail, karaoke, recitazione\u2026) la settimana prima. La giuria stila una graduatoria (punti per posizione) a cui si somma il bonus vendite 4/2/1 alle prime tre casate per pezzi venduti. I punti finali si versano una sola volta in Coppa.", 2);
  await insReg.run("proposte", "Vinile & Open Mic", "Le proposte musicali (vinile) e le esibizioni all'Open Mic raccolte durante la settimana diventano la scaletta di quella successiva. Linguaggio e contenuti moderati; ogni proposta \xE8 valutata dallo staff.", 3);
  await db.prepare("INSERT OR REPLACE INTO cdc_caffe (id,giacenza,punto_riordino,confezione) VALUES (1,?,?,?)").run(120, 50, 100);
  const insGioco = db.prepare("INSERT INTO cdc_giochi (nome,categoria,quantita,stato,ordine) VALUES (?,?,?,?,?)");
  const GIOCHI_INV = [
    ["Mazzi di carte francesi", "carte", 4, "ok"],
    ["Mazzi di carte italiane", "carte", 2, "ok"],
    ["Cluedo", "gioco_tavolo", 1, "ok"],
    ["Monopoli", "gioco_tavolo", 1, "ok"],
    ["Risiko", "gioco_tavolo", 1, "ok"],
    ["Indovina Chi", "gioco_tavolo", 1, "ok"],
    ["Scacchiere", "scacchi", 2, "ok"],
    ["Set di pedine (dama)", "scacchi", 2, "ok"],
    ["Set di scacchi", "scacchi", 2, "ok"]
  ];
  for (let i = 0; i < GIOCHI_INV.length; i++) {
    const g = GIOCHI_INV[i];
    await insGioco.run(g[0], g[1], g[2], g[3], i);
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insArt = db.prepare("INSERT INTO magazzino_articoli (nome,area,unita,giacenza,punto_riordino,soglia_preavviso,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?)");
  const MAG = [
    // nome, area, unità, giacenza, punto_riordino, soglia_preavviso
    // (il caffè NON è qui: lo gestisce l'upsert sotto, per non duplicare l'articolo creato dalla migrazione)
    ["Bicchieri di carta", "chiosco", "pz", 300, 100, 150],
    ["Acqua naturale 0,5L", "chiosco", "pz", 48, 24, 36],
    ["Birra media", "chiosco", "pz", 60, 24, 40],
    ["Patatine (buste)", "chiosco", "pz", 40, 20, 30],
    ["Ghiaccio (sacchi)", "chiosco", "sacchi", 6, 4, 8],
    ["Piatti biodegradabili", "serata_clan", "pz", 200, 80, 120],
    ["Tovaglioli", "serate_tema", "conf", 10, 4, 6]
  ];
  for (let i = 0; i < MAG.length; i++) {
    const a = MAG[i];
    await insArt.run(a[0], a[1], a[2], a[3], a[4], a[5], i + 1, nowIso);
  }
  const exCaffe = await db.prepare("SELECT id FROM magazzino_articoli WHERE area='casa_di_carta' AND nome='Capsule caff\xE8'").get();
  if (exCaffe) await db.prepare("UPDATE magazzino_articoli SET unita=?,giacenza=?,punto_riordino=?,soglia_preavviso=?,aggiornato_at=? WHERE id=?").run("capsule", 120, 50, 80, nowIso, exCaffe.id);
  else await insArt.run("Capsule caff\xE8", "casa_di_carta", "capsule", 120, 50, 80, 0, nowIso);
  const birra = await db.prepare("SELECT id FROM magazzino_articoli WHERE nome='Birra media'").get();
  const acqua = await db.prepare("SELECT id FROM magazzino_articoli WHERE nome='Acqua naturale 0,5L'").get();
  const patatine = await db.prepare("SELECT id FROM magazzino_articoli WHERE nome='Patatine (buste)'").get();
  const insMenu = db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,zona,categoria,magazzino_id,attivo,ordine,con_condimenti,alcolico) VALUES (?,?,?,?,?,?,1,?,?,?)");
  const MENU = [
    // nome, prezzo, stazione, punto(zona), categoria, magazzino_id
    ["Panino salsiccia", 4.5, "cucina", "comune", "panini", null],
    ["Panino vegetariano", 4, "cucina", "comune", "panini", null],
    ["Hamburger", 5.5, "cucina", "comune", "panini", null],
    ["Patatine fritte", 3, "cucina", "comune", "snack", null],
    ["Patatine in busta", 1.5, "bar", "bar", "snack", patatine ? patatine.id : null],
    ["Birra media", 4, "bar", "bar", "birre", birra ? birra.id : null],
    ["Acqua 0,5L", 1, "bar", "comune", "bibite", acqua ? acqua.id : null],
    ["Bibita in lattina", 2, "bar", "comune", "bibite", null],
    ["Caff\xE8", 1, "bar", "bar", "caldi", null]
  ];
  // Panini e fritti nascono con la spunta "Condimenti": e' li' che il socio se li aspetta.
  const CON_CONDIMENTI = /panin|hamburger|patatine fritte/i;
  // Gli alcolici si dichiarano fin da subito: la verifica dell'eta' non e' una cosa che si
  // accende dopo.
  const ALCOLICO = /birr|vino|calice|prosecc|spritz|amar|grappa|rum|gin|cocktail|liquor/i;
  for (let i = 0; i < MENU.length; i++) {
    const m = MENU[i];
    await insMenu.run(m[0], m[1], m[2], m[3], m[4], m[5], i + 1, CON_CONDIMENTI.test(m[0]) ? 1 : 0, ALCOLICO.test(m[0] + " " + m[4]) ? 1 : 0);
  }
  const adminPwd = process.env.ADMIN_PASSWORD || "koine2026";
  const insAdmin = db.prepare("INSERT INTO utenti_admin (username,password_hash,ruolo,permessi) VALUES (?,?,?,?)");
  await insAdmin.run("gestore", hashPassword(adminPwd), "gestore", null);
  await insAdmin.run("manager", hashPassword(process.env.MANAGER_PASSWORD || "manager2026"), "manager", null);
  const staffCaps = JSON.stringify(["utenti", "utenti_ins", "casate", "cdc", "discipline", "tabellone", "contest", "serate", "proposte", "eventi", "magazzino", "comande"]);
  await insAdmin.run("staff", hashPassword(process.env.STAFF_PASSWORD || "staff2026"), "staff", staffCaps);
  await insAdmin.run("lettura", hashPassword("lettura2026"), "sola_lettura", null);
  // Le capsule sono merce di magazzino della Casa di Carta, e la conta le scarica di li'.
  try {
    const gia = await db.prepare("SELECT id FROM magazzino_articoli WHERE LOWER(nome) LIKE '%capsul%'").get();
    let idArt = gia?.id;
    if (!idArt) {
      const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM magazzino_articoli").get()).n;
      const r = await db.prepare("INSERT INTO magazzino_articoli (nome,area,zona,unita,giacenza,punto_riordino,soglia_preavviso,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run("Capsule caff\xE8", "casa_di_carta", "carta", "pz", 120, 40, 60, ord, (/* @__PURE__ */ new Date()).toISOString());
      idArt = Number(r.lastInsertRowid);
    }
    await setSetting("cdc_articolo_capsule", String(idArt));
  } catch (_) {
  }
  // I punti della Coppa non si popolano a mano: si derivano dai risultati appena inseriti.
  try {
    const { ricalcolaCoppa } = await import('./coppa.js');
    await ricalcolaCoppa("seed");
  } catch (_) {
  }
  audit("sistema", "seed", "database", 0, "Popolamento iniziale Bussola Residence");
  if (verbose) console.log("Seed completato: 8 casate, 7 eventi, 10 discipline, guida Bussola, 3 soci demo, 1 utente back office.");
}
// Avvio da riga di comando: SOLO se questo file e' davvero l'entry (node server/seed.js).
// Nel bundle single-file import.meta.url coincide con process.argv[1] anche quando l'entry
// e' bussola.mjs: senza il controllo sul nome partirebbe un secondo seed() concorrente.
if (import.meta.url === `file://${process.argv[1]}` && /(^|\/)seed\.js$/.test(String(process.argv[1] || ""))) {
  seed({ verbose: true }).catch((e) => {
    console.error("Seed fallito:", e);
    process.exit(1);
  });
}

export { seed };

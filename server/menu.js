// IL MENU', IN UN POSTO SOLO.
//
// Fino a ieri quattro schermate chiedevano il menù in quattro modi diversi — l'app con la
// zona, il QR senza, il Crew con un parametro, il Crew dal tavolo con due — e la stampa PDF
// ne usava un quinto. La stessa persona vedeva elenchi diversi a seconda di dove ordinava, e
// ogni correzione andava ripetuta in cinque punti (o dimenticata in quattro).
//
// Qui c'è UNA funzione che risponde alla sola domanda che conta: **cosa si può ordinare da
// questo punto, e cosa ci si può spuntare dentro**. Tutti chiamano lei: app dei soci, QR al
// tavolo, comanda della Crew, stampa del menù. Se una regola cambia, cambia qui e vale per
// tutti nello stesso istante.
//
// Le tre regole, in chiaro:
//   1. Quello che prepara la cucina si ordina da OGNI punto. Un panino lo fa la cucina, ma
//      chi è al bar alle sei di pomeriggio deve poterlo chiedere. Solo ciò che si serve al
//      banco (bibite, caffè, alcolici) resta legato alla sua area.
//   2. I condimenti non sono voci da ordinare: si spuntano dentro i piatti che escono dalla
//      cucina. Nella tazzina del caffè non ci vanno, perché il caffè lo fa il banco.
//   3. Un prodotto spento non si ordina e non si stampa, da nessuna parte.
import { db } from './db.js';
import { par } from './parametri.js';

// Un condimento è tale se il gestore lo ha spuntato OPPURE se la categoria lo dice a chiare
// lettere. Legarlo alla sola spunta significherebbe far dipendere la funzione da un dato che
// qualcuno deve ricordarsi di mettere: è l'errore che ha tenuto il panino fuori dal Bar per
// tre versioni, e non lo si ripete.
var CONDIMENTO_RX = /condiment|aggiunt|complement|\bsalse\b/i;
function eCondimento(m) {
  return Number(m.complemento) === 1 || CONDIMENTO_RX.test(String(m.categoria || ""));
}
function laPreparaLaCucina(m) {
  return String(m.stazione || "") === "cucina";
}
// Si può ordinare da questo punto vendita?
function siVendeIn(m, zona) {
  if (laPreparaLaCucina(m)) return true;                 // la cucina serve tutti i punti
  if (zona !== "bar" && zona !== "garden") return true;  // nessun punto indicato: tutto
  return m.zona === zona || m.zona === "comune";
}
// Un piatto porta con sé la riga "condimenti"? Lo dice UNA SPUNTA SUL PRODOTTO, messa dal
// gestore nel listino: "Necessita condimenti". Prima lo si deduceva da chi prepara il piatto,
// e non ha mai funzionato — bastava che la colonna "Chi prepara" fosse sporca (nel listino
// reale 55 voci su 60 erano finite su "cucina", caffè compreso) perché la maionese comparisse
// dentro una tazzina o non comparisse affatto. Un dato che il gestore vede e mette lui non
// può sbagliare in silenzio.
function prendeComplementi(m) {
  return Number(m.con_condimenti) === 1 && !eCondimento(m);
}

// Un alcolico non si serve a chi non ha l'eta'. Il sistema non puo' verificarla da solo: la
// tessera dice la data di nascita, ma al bar si serve anche chi non ce l'ha, ed e' giusto cosi'
// (la tessera identifica gli sportivi e i residenti, non e' un lasciapassare per consumare).
// Quello che il sistema deve fare e' non far finta di niente: segnala la comanda a chi la
// consegna, che l'eta' la verifica guardando in faccia il cliente.
function eAlcolico(m) {
  return Number(m.alcolico) === 1;
}

// L'UNICA porta d'ingresso. `zona` è il punto da cui si ordina ('bar' | 'garden' | assente).
// `soloAttivi` è vero ovunque tranne che nella gestione del listino, dove il gestore deve
// vedere anche quello che ha spento.
// QUANTO COSTA CONDIRE. Lo decide il gestore scrivendo il prezzo sui condimenti, non un
// parametro nascosto: se mette un euro, condire costa un euro — che se ne scelga uno o quattro.
// E' una scelta commerciale (promozione, richiamo, marginalita'), non un tecnicismo, e nessuno
// deve impedirgli di cambiarla. Il parametro resta solo come rete: vale quando i condimenti
// non hanno prezzo, cioe' quando il gestore non ha ancora detto niente.
//
// Se i condimenti hanno prezzi diversi si prende il piu' alto: la regola resta "tanto per
// tutti" (l'hai chiesta tu), e fra due letture possibili si sceglie quella che non regala
// merce. La diagnosi lo segnala, cosi' non resta un'ambiguita' silenziosa.
function quantoCostaCondire(condimenti, dalParametro) {
  const prezzi = condimenti.map((m) => Number(m.prezzo) || 0).filter((p) => p > 0);
  if (!prezzi.length) return Number(dalParametro) || 0;
  return Math.max(...prezzi);
}

async function daOrdinare({ zona = "", soloAttivi = true } = {}) {
  const tutte = await db.prepare("SELECT * FROM menu_articoli ORDER BY ordine,id").all();
  const vive = soloAttivi ? tutte.filter((m) => Number(m.attivo) === 1) : tutte;
  const righeCond = vive.filter(eCondimento);
  const condimenti = righeCond.map((m) => ({ id: m.id, nome: m.nome }));
  const supplemento = quantoCostaCondire(righeCond, await par("comande_supplemento_complementi"));
  const voci = vive.filter((m) => !eCondimento(m) && siVendeIn(m, zona));
  if (condimenti.length) {
    for (const v of voci) {
      if (!prendeComplementi(v)) continue;
      v.complementi = condimenti;
      v.supplemento_complementi = supplemento;
    }
  }
  return { voci, condimenti, supplemento };
}

// I condimenti che si possono davvero attaccare a un piatto, quando arriva un ordine. Serve a
// non fidarsi di quello che manda il telefono: nessuno può appiccicare la maionese a un caffè
// spedendo la richiesta a mano.
async function condimentiAmmessi(piatto) {
  if (!prendeComplementi(piatto)) return [];
  const tutte = await db.prepare("SELECT id,nome,categoria,complemento,magazzino_id FROM menu_articoli WHERE attivo=1 ORDER BY ordine,nome").all();
  return tutte.filter(eCondimento);
}

// Prodotti marcati in modo incoerente con quello che sono: un caffè espresso che risulta
// "preparato dalla cucina" non è un dettaglio — finisce sul KDS Cucina, dove nessuno lo farà
// mai, e porta con sé i condimenti dentro la tazzina. Un comando applicato a troppe categorie
// può fare questo danno a cinquanta voci in un colpo, senza che si veda da nessuna parte.
async function incoerenze() {
  const { inferStazione } = await import('./menucat.js');
  const tutte = await db.prepare("SELECT * FROM menu_articoli WHERE attivo=1 ORDER BY ordine,id").all();
  const out = [];
  for (const m of tutte) {
    if (eCondimento(m)) continue;
    const attesa = inferStazione(m.nome, m.categoria);
    if (attesa === String(m.stazione || "")) continue;
    out.push({ id: m.id, nome: m.nome, categoria: m.categoria || "", ora: m.stazione, dovrebbe: attesa });
  }
  return out;
}

// ---- DIAGNOSI -----------------------------------------------------------------------------
// Perché esiste: per tre versioni ho risposto "adesso c'è" a chi apriva l'app e non vedeva
// niente, perché ragionavo sul codice mentre il problema stava nei dati. Questa funzione
// guarda il listino VERO e dice quale condizione non è soddisfatta, con i numeri. Dieci
// secondi, e la risposta viene dal database invece che dalle ipotesi di qualcuno.
async function diagnosi() {
  const tutte = await db.prepare("SELECT * FROM menu_articoli ORDER BY ordine,id").all();
  const attivi = tutte.filter((m) => Number(m.attivo) === 1);
  const spenti = tutte.filter((m) => Number(m.attivo) !== 1);
  const cond = attivi.filter(eCondimento);
  const condSpenti = spenti.filter(eCondimento);
  const cucina = attivi.filter((m) => laPreparaLaCucina(m) && !eCondimento(m));
  const conCondimenti = attivi.filter((m) => prendeComplementi(m));
  const banco = attivi.filter((m) => !laPreparaLaCucina(m) && !eCondimento(m));

  const categorie = [...new Set(tutte.map((m) => String(m.categoria || "").trim()).filter(Boolean))].sort();
  const perZona = {};
  for (const z of ["bar", "garden"]) {
    perZona[z] = attivi.filter((m) => !eCondimento(m) && siVendeIn(m, z)).length;
  }

  // Prezzi diversi fra condimenti: la regola e' "tanto per tutti", quindi vale il piu' alto.
  // Non e' un errore, ma il gestore deve saperlo — altrimenti se lo ritrova sullo scontrino.
  const prezziCond = [...new Set(cond.map((m) => Number(m.prezzo) || 0))];
  const costoCondire = quantoCostaCondire(cond, await par("comande_supplemento_complementi"));
  const storte = await incoerenze();
  const inCucinaPerSbaglio = storte.filter((x) => x.ora === "cucina");

  // Il verdetto in una riga, con il motivo quando qualcosa non torna.
  const problemi = [];
  if (inCucinaPerSbaglio.length >= 3) {
    const esempi = inCucinaPerSbaglio.slice(0, 4).map((x) => x.nome).join(", ");
    problemi.push(`${inCucinaPerSbaglio.length} prodotti da banco risultano \u201cpreparati dalla cucina\u201d (${esempi}\u2026). Finiscono sul KDS Cucina, dove nessuno li prepara, e si portano dietro i condimenti. Succede quando \u201cDa preparare, in entrambi i punti\u201d viene applicato a categorie che non c'entrano.`);
  }
  if (!cond.length) {
    problemi.push(condSpenti.length
      ? `I ${condSpenti.length} condimenti che hai sono SPENTI: riaccendili nella colonna Attivo e compariranno dentro i piatti.`
      : "Nel listino non c'è nessun condimento. Metti le voci (maionese, insalata…) in una categoria che si chiami \u201cCondimenti extra\u201d, oppure spunta Compl. su quelle che ci sono.");
  }
  if (!conCondimenti.length) {
    problemi.push("Nessun prodotto ha la spunta \u201cCondimenti\u201d: i condimenti non hanno dove comparire. Mettila sui panini e sui piatti, nella colonna Condimenti del listino.");
  }
  // Il verdetto "tutto a posto" vale solo se non c'e' nessuna delle tre cose storte.
  if (prezziCond.length > 1) {
    problemi.push(`I condimenti hanno prezzi diversi (${prezziCond.map((p) => p.toFixed(2)).join(", ")}): condire costa uguale per tutti, quindi vale il piu\u2019 alto \u2014 ${costoCondire.toFixed(2)}. Se non e\u2019 quello che vuoi, mettili tutti allo stesso prezzo.`);
  }
  const tuttoOk = cond.length && conCondimenti.length && inCucinaPerSbaglio.length < 3 && prezziCond.length <= 1;

  return {
    totale: tutte.length,
    attivi: attivi.length,
    spenti: spenti.length,
    condimenti: cond.map((m) => m.nome),
    condimenti_spenti: condSpenti.map((m) => m.nome),
    piatti_cucina: cucina.length,
    con_condimenti: conCondimenti.length,
    costo_condire: costoCondire,
    prodotti_banco: banco.length,
    categorie,
    incoerenze: storte,
    ordinabili_al_bar: perZona.bar,
    ordinabili_al_garden: perZona.garden,
    // Un esempio concreto: il primo piatto di cucina, con quello che ci si spunta dentro.
    esempio: conCondimenti.length ? { nome: conCondimenti[0].nome, complementi: cond.map((c) => c.nome) } : null,
    problemi: tuttoOk ? [] : problemi
  };
}

export { CONDIMENTO_RX, condimentiAmmessi, daOrdinare, diagnosi, eAlcolico, eCondimento, incoerenze, laPreparaLaCucina, prendeComplementi, quantoCostaCondire, siVendeIn };

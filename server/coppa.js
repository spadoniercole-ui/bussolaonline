// Coppa delle Casate — la graduatoria e' SEMPRE calcolata, mai inserita a mano.
//
// Tre sorgenti, tutte automatiche:
//   1. tornei in corso  -> graduatoriaFinale() della disciplina, quando la finale e' giocata
//   2. tornei archiviati -> edizioni.punti_coppa, congelato al momento dell'archiviazione
//      (archiviaEdizione cancella partite e gironi: senza il congelamento i punti sparirebbero)
//   3. contest / serate  -> contest_esiti.punti dei contest con esito gia' assegnato
//
// casate.punti resta la colonna letta dall'app dei soci, ma e' un valore DERIVATO:
// viene riscritto da ricalcolaCoppa() a ogni evento che puo' cambiarlo.
import { audit, db, setSetting } from './db.js';
import { graduatoriaFinale } from './tournament.js';

// Posizione con pari merito: stesso punteggio -> stesso indice (1, 1, 3, 4, 4, 6...).
function conPosizioni(righe) {
  const ord = [...righe].sort((a, b) => b.punti - a.punti || String(a.nome).localeCompare(String(b.nome)));
  let ultimoPunti = null;
  let ultimaPos = 0;
  return ord.map((r, i) => {
    if (r.punti !== ultimoPunti) {
      ultimaPos = i + 1;
      ultimoPunti = r.punti;
    }
    return { ...r, posizione: ultimaPos, exAequo: false };
  }).map((r, i, arr) => ({
    ...r,
    exAequo: arr.filter((x) => x.posizione === r.posizione).length > 1
  }));
}

// Dettaglio completo: per ogni casata i punti di ciascuna disciplina e i totali per sorgente.
async function punteggiCoppa() {
  const casate = await db.prepare("SELECT id,nome,colore,motto FROM casate ORDER BY nome").all();
  const discipline = await db.prepare("SELECT id,nome,dominio,stato FROM discipline WHERE attivo=1 ORDER BY dominio,ordine,id").all();

  const celle = {};
  const tornei = {};
  const contest = {};
  casate.forEach((c) => {
    tornei[c.id] = 0;
    contest[c.id] = 0;
  });

  // 1. tornei in corso
  for (const d of discipline) {
    celle[d.id] = {};
    const grad = await graduatoriaFinale(d.id).catch(() => null);
    if (!grad) continue;
    for (const r of grad) {
      celle[d.id][r.id] = r.punti;
      tornei[r.id] = (tornei[r.id] || 0) + r.punti;
    }
  }

  // 2. edizioni archiviate (punti congelati)
  const edizioni = await db.prepare("SELECT disciplina_id,disciplina_nome,punti_coppa FROM edizioni WHERE punti_coppa IS NOT NULL").all();
  const archivio = [];
  for (const e of edizioni) {
    let righe = null;
    try { righe = JSON.parse(e.punti_coppa); } catch (_) { righe = null; }
    if (!Array.isArray(righe)) continue;
    archivio.push({ disciplina_nome: e.disciplina_nome, righe });
    for (const r of righe) {
      const id = Number(r.casata_id);
      if (tornei[id] == null) continue;
      tornei[id] += Number(r.punti) || 0;
      if (e.disciplina_id && celle[e.disciplina_id]) {
        celle[e.disciplina_id][id] = (celle[e.disciplina_id][id] || 0) + (Number(r.punti) || 0);
      }
    }
  }

  // 3. contest con esito gia' assegnato alla Coppa
  const esiti = await db.prepare(
    "SELECT ce.casata_id, SUM(ce.punti) p FROM contest_esiti ce JOIN contest c ON c.id=ce.contest_id WHERE c.esito_assegnato=1 GROUP BY ce.casata_id"
  ).all();
  for (const e of esiti) {
    const id = Number(e.casata_id);
    if (contest[id] == null) continue;
    contest[id] = Number(e.p) || 0;
  }

  const righe = casate.map((c) => ({
    id: c.id,
    nome: c.nome,
    colore: c.colore,
    motto: c.motto,
    tornei: tornei[c.id] || 0,
    contest: contest[c.id] || 0,
    punti: (tornei[c.id] || 0) + (contest[c.id] || 0)
  }));

  return { graduatoria: conPosizioni(righe), discipline, celle, archivio };
}

// Riscrive casate.punti con i valori calcolati e restituisce la graduatoria ordinata.
async function ricalcolaCoppa(chi = "sistema") {
  const dati = await punteggiCoppa();
  const upd = db.prepare("UPDATE casate SET punti=? WHERE id=? AND punti<>?");
  let cambiate = 0;
  for (const r of dati.graduatoria) {
    const info = await upd.run(r.punti, r.id, r.punti);
    if (info.changes) cambiate++;
  }
  if (cambiate) audit(chi, "ricalcolo_coppa", "casate", null, `${cambiate} casate aggiornate`);
  return { ...dati, cambiate };
}

// Congela i punti Coppa di una disciplina prima che l'archiviazione cancelli partite e gironi.
async function congelaPuntiEdizione(disciplinaId) {
  const grad = await graduatoriaFinale(disciplinaId).catch(() => null);
  if (!grad) return null;
  return JSON.stringify(grad.map((r) => ({ casata_id: r.id, nome: r.nome, posizione: r.posizione, punti: r.punti })));
}

// ---- Chiusura della stagione ---------------------------------------------------------------
// Il sistema propone la chiusura quando OGNI disciplina in cartellone ha espresso il suo
// punteggio, cioe' quando la sua colonna nel cartellone non e' piu' vuota: o il torneo si e'
// concluso, o e' stato archiviato coi punti congelati.
function stagioneCorrente(d = /* @__PURE__ */ new Date()) {
  return String(d.getFullYear());
}

// A parita' di punti totali, il criterio oggettivo e' quanti tornei hai vinto (le celle da 12),
// poi quanti secondi posti (celle da 10). Se anche cosi' restano pari, il sistema NON sceglie:
// lo dichiara e chiede uno spareggio, perche' assegnare il simbolo del residence a caso
// sarebbe la cosa peggiore che possa fare.
function primatiDi(dati, casataId) {
  let ori = 0, argenti = 0;
  for (const d of dati.discipline) {
    const v = (dati.celle[d.id] || {})[casataId] || 0;
    if (v >= 12) ori++;
    else if (v >= 10) argenti++;
  }
  return { ori, argenti };
}

async function statoChiusura(stagione = stagioneCorrente()) {
  const dati = await punteggiCoppa();
  const conclusa = (d) => dati.graduatoria.some((c) => (dati.celle[d.id] || {})[c.id] > 0);
  // Dire "manca il Burraco" non aiuta: il gestore vuole sapere QUANTE partite mancano, per
  // capire se la stagione e' ancora recuperabile o se il calendario era sovradimensionato.
  const mancanti = [];
  for (const d of dati.discipline) {
    if (conclusa(d)) continue;
    const tot = await db.prepare("SELECT COUNT(*) n FROM partite WHERE disciplina_id=?").get(d.id);
    const fatte = await db.prepare("SELECT COUNT(*) n FROM partite WHERE disciplina_id=? AND stato='giocata'").get(d.id);
    mancanti.push({ id: d.id, nome: d.nome, partite: Number(tot?.n || 0), giocate: Number(fatte?.n || 0), mancano: Number(tot?.n || 0) - Number(fatte?.n || 0) });
  }
  const chiusa = await db.prepare("SELECT COUNT(*) n FROM albo_casate WHERE stagione=?").get(stagione);
  // graduatoria con lo spareggio oggettivo applicato
  const conPrimati = dati.graduatoria.map((c) => ({ ...c, ...primatiDi(dati, c.id) }));
  conPrimati.sort((a, b) => b.punti - a.punti || b.ori - a.ori || b.argenti - a.argenti || String(a.nome).localeCompare(String(b.nome)));
  let pos = 0, ultimo = null;
  const finale = conPrimati.map((c, i) => {
    const chiave = `${c.punti}|${c.ori}|${c.argenti}`;
    if (chiave !== ultimo) { pos = i + 1; ultimo = chiave; }
    return { ...c, posizione: pos, exAequo: false };
  }).map((c, i, arr) => ({ ...c, exAequo: arr.filter((x) => x.posizione === c.posizione).length > 1 }));
  const primi = finale.filter((c) => c.posizione === 1);
  return {
    stagione,
    graduatoria: finale,
    spareggio: primi.length > 1 ? primi.map((c) => ({ id: c.id, nome: c.nome, punti: c.punti, ori: c.ori, argenti: c.argenti })) : null,
    discipline: dati.discipline,
    celle: dati.celle,
    mancanti,
    partite_mancanti: mancanti.reduce((n, d) => n + d.mancano, 0),
    pronta: mancanti.length === 0 && dati.discipline.length > 0,
    gia_chiusa: Number(chiusa?.n || 0) > 0
  };
}

// Congela la graduatoria e manda i primi tre nell'Albo d'Oro.
async function chiudiStagione(stagione, chi = "gestore", vincitrice = null) {
  const st = await statoChiusura(stagione);
  if (st.gia_chiusa) return { error: `La stagione ${stagione} risulta gi\u00e0 chiusa.` };
  if (!st.pronta) return { error: `Mancano ${st.partite_mancanti} partite: ${st.mancanti.map((m) => `${m.nome} (${m.mancano})`).join(", ")}.` };
  if (st.spareggio && !vincitrice) {
    return { error: `Parita' assoluta al primo posto fra ${st.spareggio.map((c) => c.nome).join(" e ")}: stessi punti, stessi tornei vinti. Serve uno spareggio alla serata delle casate, poi indica qui la vincitrice.`, spareggio: st.spareggio };
  }
  let podio = st.graduatoria.filter((c) => c.posizione <= 3);
  // Spareggio deciso in serata: la vincitrice indicata sale al primo posto, l'altra al secondo.
  if (st.spareggio && vincitrice) {
    const vinc = st.graduatoria.find((c) => c.id === Number(vincitrice));
    if (!vinc) return { error: "La casata indicata come vincitrice non e' fra quelle in parita'." };
    const resto = podio.filter((c) => c.id !== vinc.id);
    podio = [{ ...vinc, posizione: 1, exAequo: false }, ...resto.map((c, i) => ({ ...c, posizione: i + 2 }))].filter((c) => c.posizione <= 3);
  }
  const ins = db.prepare("INSERT OR IGNORE INTO albo_casate (stagione,posizione,casata_id,casata_nome,punti,ex_aequo,chiuso_da) VALUES (?,?,?,?,?,?,?)");
  for (const c of podio) await ins.run(stagione, c.posizione, c.id, c.nome, c.punti, c.exAequo ? 1 : 0, chi);
  // Tabellone chiuso: le discipline non accettano piu' risultati per questa stagione.
  await db.prepare("UPDATE discipline SET stato='archiviato' WHERE stato<>'archiviato'").run();
  await setSetting("coppa_chiusa_" + stagione, (/* @__PURE__ */ new Date()).toISOString());
  audit(chi, "chiusura_coppa", "albo_casate", 0, `stagione ${stagione} \u00b7 podio ${podio.map((c) => c.nome).join(", ")}`);
  return { stagione, podio, graduatoria: st.graduatoria };
}

// La casata campione dell'ultima stagione chiusa: la stagione dopo si fregia del simbolo.
async function campioneInCarica() {
  const r = await db.prepare("SELECT stagione,casata_id,casata_nome,punti FROM albo_casate WHERE posizione=1 ORDER BY stagione DESC LIMIT 1").get();
  return r || null;
}

async function alboCasate() {
  const righe = await db.prepare("SELECT * FROM albo_casate ORDER BY stagione DESC, posizione").all();
  const per = /* @__PURE__ */ new Map();
  for (const r of righe) {
    if (!per.has(r.stagione)) per.set(r.stagione, []);
    per.get(r.stagione).push(r);
  }
  return [...per.entries()].map(([stagione, podio]) => ({ stagione, podio }));
}

export { alboCasate, campioneInCarica, chiudiStagione, conPosizioni, congelaPuntiEdizione, punteggiCoppa, ricalcolaCoppa, stagioneCorrente, statoChiusura };

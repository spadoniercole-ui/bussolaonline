// TORNEI A ELIMINAZIONE DIRETTA.
//
// Un'altra cosa rispetto alla Coppa delle Casate, che e' a punti e dura tutta la stagione. Qui
// si gioca una sera: ci si iscrive, si sorteggia, si perde e si va a casa.
//
// **Perche' i posti sono 4, 8, 16 o 32 e non un numero qualsiasi.** Un tabellone a eliminazione
// diretta dimezza a ogni turno: se i giocatori non sono una potenza di due, qualcuno passa il
// turno senza giocare. Si puo' fare (si chiamano "bye") ma e' un torneo che comincia con
// un'ingiustizia — uno gioca due partite per arrivare in finale, un altro tre. Meglio dire
// prima quanti posti ci sono e chiuderli quando sono pieni.
//
// **Il sorteggio e' cieco.** Nessuna testa di serie, nessun criterio: si mescola e si accoppia.
// In un torneo di residence e' l'unica cosa che nessuno puo' contestare.
import { db } from './db.js';

const POSTI_AMMESSI = [4, 8, 16, 32];

// Mescola davvero (Fisher-Yates): ordinare per numero casuale come si fa di solito produce
// distribuzioni sbilanciate, e in un sorteggio pubblico la differenza si nota.
function mescola(v) {
  const a = v.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function turniNecessari(posti) {
  return Math.log2(posti);
}

// Il nome del turno, come lo direbbe una persona: non "turno 3 di 4" ma "semifinale".
function nomeTurno(turno, posti) {
  const totali = turniNecessari(posti);
  const restanti = totali - turno;
  if (restanti === 0) return "Finale";
  if (restanti === 1) return "Semifinali";
  if (restanti === 2) return "Quarti";
  if (restanti === 3) return "Ottavi";
  return `${Math.pow(2, restanti + 1)}\u00ba di finale`;
}

// Il sorteggio: mescola gli iscritti e riempie il primo turno. I turni successivi nascono
// vuoti — le partite si creano man mano che i vincitori salgono, ma le caselle esistono gia',
// cosi' il tabellone si vede intero dal primo giorno.
async function sorteggia(torneoId) {
  const t = await db.prepare("SELECT * FROM tornei_ko WHERE id=?").get(torneoId);
  if (!t) return { ok: false, error: "Torneo non trovato" };
  if (t.stato !== "iscrizioni") return { ok: false, error: "Il sorteggio si fa una volta sola: questo torneo e' gia' partito." };
  const iscritti = await db.prepare("SELECT * FROM tornei_ko_iscritti WHERE torneo_id=? ORDER BY id").all(torneoId);
  if (iscritti.length !== Number(t.posti)) {
    return { ok: false, error: `Il tabellone e' da ${t.posti}: ci sono ${iscritti.length} iscritti. Servono esattamente ${t.posti}, altrimenti qualcuno passa il turno senza giocare.` };
  }

  const mescolati = mescola(iscritti);
  await db.prepare("DELETE FROM tornei_ko_partite WHERE torneo_id=?").run(torneoId);
  // Primo turno: le coppie escono dal sorteggio.
  for (let i = 0; i < mescolati.length / 2; i++) {
    const a = mescolati[i * 2], b = mescolati[i * 2 + 1];
    await db.prepare(
      "INSERT INTO tornei_ko_partite (torneo_id,turno,posizione,a_nome,b_nome,a_iscritto,b_iscritto) VALUES (?,1,?,?,?,?,?)"
    ).run(torneoId, i, a.nome, b.nome, a.id, b.id);
  }
  // Turni successivi: caselle vuote, cosi' il tabellone si legge intero da subito.
  for (let turno = 2; turno <= turniNecessari(t.posti); turno++) {
    const partite = Number(t.posti) / Math.pow(2, turno);
    for (let i = 0; i < partite; i++) {
      await db.prepare("INSERT INTO tornei_ko_partite (torneo_id,turno,posizione) VALUES (?,?,?)").run(torneoId, turno, i);
    }
  }
  await db.prepare("UPDATE tornei_ko SET stato='sorteggiato' WHERE id=?").run(torneoId);
  return { ok: true };
}

// Il risultato di una partita: il vincitore sale da solo alla casella che gli spetta. Due
// partite adiacenti (0 e 1) confluiscono nella posizione 0 del turno dopo.
async function registraRisultato(partitaId, vincitore, punteggio) {
  const p = await db.prepare("SELECT * FROM tornei_ko_partite WHERE id=?").get(partitaId);
  if (!p) return { ok: false, error: "Partita non trovata" };
  if (!p.a_nome || !p.b_nome) return { ok: false, error: "Questa partita non ha ancora i due giocatori: mancano i risultati del turno prima." };
  if (![p.a_nome, p.b_nome].includes(vincitore)) {
    return { ok: false, error: `Il vincitore dev'essere uno dei due: ${p.a_nome} o ${p.b_nome}.` };
  }
  await db.prepare("UPDATE tornei_ko_partite SET vincitore=?, punteggio=?, giocata_at=? WHERE id=?")
    .run(vincitore, punteggio || null, new Date().toISOString(), p.id);

  const t = await db.prepare("SELECT * FROM tornei_ko WHERE id=?").get(p.torneo_id);
  if (p.turno >= turniNecessari(t.posti)) {
    await db.prepare("UPDATE tornei_ko SET stato='concluso', vincitore=? WHERE id=?").run(vincitore, t.id);
    return { ok: true, finale: true, vincitore };
  }
  // Sale al turno successivo, nella posizione che gli spetta.
  const dopo = await db.prepare("SELECT * FROM tornei_ko_partite WHERE torneo_id=? AND turno=? AND posizione=?")
    .get(t.id, p.turno + 1, Math.floor(p.posizione / 2));
  if (dopo) {
    const campo = p.posizione % 2 === 0 ? "a_nome" : "b_nome";
    await db.prepare(`UPDATE tornei_ko_partite SET ${campo}=? WHERE id=?`).run(vincitore, dopo.id);
  }
  return { ok: true };
}

// Il tabellone come si guarda: turni con il loro nome, partite in ordine.
async function tabellone(torneoId) {
  const t = await db.prepare("SELECT * FROM tornei_ko WHERE id=?").get(torneoId);
  if (!t) return null;
  const partite = await db.prepare("SELECT * FROM tornei_ko_partite WHERE torneo_id=? ORDER BY turno,posizione").all(torneoId);
  const iscritti = await db.prepare("SELECT * FROM tornei_ko_iscritti WHERE torneo_id=? ORDER BY id").all(torneoId);
  const turni = [];
  for (let n = 1; n <= turniNecessari(t.posti); n++) {
    turni.push({ turno: n, nome: nomeTurno(n, t.posti), partite: partite.filter((p) => p.turno === n) });
  }
  return {
    torneo: t,
    iscritti,
    posti_liberi: Math.max(0, Number(t.posti) - iscritti.length),
    turni,
    da_giocare: partite.filter((p) => p.a_nome && p.b_nome && !p.vincitore).length
  };
}

export { POSTI_AMMESSI, nomeTurno, registraRisultato, sorteggia, tabellone, turniNecessari };

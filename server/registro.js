// IL REGISTRO STORICO — la memoria lunga del residence.
//
// A cosa serve: quando qualcuno contesta un conto, una prenotazione sparita o un servizio non
// reso, la risposta non puo' essere "mi pare". Qui resta scritto **cosa e' successo, quando,
// a nome di chi, e chi lo ha chiesto**. Prenotazione presa, prenotazione cancellata (e da chi),
// servizio erogato, comanda chiusa: ogni fatto lascia una riga.
//
// Tre regole che lo rendono una prova e non un elenco:
//
//   1. SI SCRIVE, NON SI RISCRIVE. Nessuna rotta modifica o cancella una riga del registro. Se
//      una prenotazione viene disdetta, non si tocca la riga di quando fu presa: se ne aggiunge
//      un'altra che dice "cancellata". Le due righe insieme raccontano la storia; una riga
//      corretta a posteriori non racconta niente.
//   2. SI CONSERVA QUINDICI ANNI. Nessuna pulizia periodica lo tocca. La durata e' un parametro
//      (`registro_anni_conservazione`) perche' e' una scelta del gestore, non un tecnicismo.
//   3. SI SCRIVE CHI HA CHIESTO. Non basta sapere che una prenotazione e' stata cancellata: per
//      una contestazione conta se l'ha disdetta il socio dal telefono, un operatore al banco o
//      il gestore dal back office. Ogni riga porta autore e canale.
import { db } from './db.js';

// I fatti che si registrano. Nomi in chiaro: chi leggera' il registro fra dieci anni non avra'
// il codice sotto gli occhi.
var FATTI = {
  prenotazione_creata: "Prenotazione presa",
  prenotazione_cancellata: "Prenotazione cancellata",
  prenotazione_modificata: "Prenotazione modificata",
  servizio_reso: "Servizio reso",
  comanda_aperta: "Comanda aperta",
  comanda_chiusa: "Comanda chiusa",
  comanda_annullata: "Comanda annullata",
  iscrizione: "Iscrizione",
  iscrizione_annullata: "Iscrizione annullata"
};

// Registra un fatto. Non lancia mai: un errore di scrittura del registro non deve impedire a un
// socio di prenotare la cena. Se qualcosa va storto lo si vede nei log del server.
async function registra({ fatto, servizio, riferimento = null, socio_id = null, intestatario = null, autore = null, canale = null, quando = null, importo = null, dettaglio = null }) {
  try {
    await db.prepare(
      `INSERT INTO registro_storico (fatto, servizio, riferimento, socio_id, intestatario, autore, canale, quando_servizio, importo, dettaglio)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      String(fatto || ""), String(servizio || ""), riferimento == null ? null : String(riferimento),
      socio_id == null ? null : Number(socio_id), intestatario == null ? null : String(intestatario),
      autore == null ? null : String(autore), canale == null ? null : String(canale),
      quando == null ? null : String(quando),
      importo == null ? null : Number(importo),
      dettaglio == null ? null : (typeof dettaglio === "string" ? dettaglio : JSON.stringify(dettaglio))
    );
  } catch (e) {
    console.error("registro storico: riga non scritta —", e && e.message);
  }
}

// Ricerca per una contestazione: per persona, per servizio, per periodo, per tipo di fatto.
async function cerca({ dal = "", al = "", servizio = "", fatto = "", chi = "", limite = 300 } = {}) {
  const dove = [];
  const args = [];
  if (dal) { dove.push("date(ts) >= ?"); args.push(dal); }
  if (al) { dove.push("date(ts) <= ?"); args.push(al); }
  if (servizio) { dove.push("servizio = ?"); args.push(servizio); }
  if (fatto) { dove.push("fatto = ?"); args.push(fatto); }
  if (chi) {
    dove.push("(intestatario LIKE ? OR autore LIKE ? OR riferimento LIKE ?)");
    const q = "%" + chi + "%";
    args.push(q, q, q);
  }
  const sql = "SELECT * FROM registro_storico" + (dove.length ? " WHERE " + dove.join(" AND ") : "") +
    " ORDER BY id DESC LIMIT ?";
  args.push(Math.min(2000, Math.max(1, Number(limite) || 300)));
  return db.prepare(sql).all(...args);
}

// La storia completa di una singola prenotazione o comanda: presa, modificata, cancellata.
// E' la vista che serve davvero davanti a una contestazione.
async function storiaDi(servizio, riferimento) {
  return db.prepare(
    "SELECT * FROM registro_storico WHERE servizio=? AND riferimento=? ORDER BY id"
  ).all(String(servizio), String(riferimento));
}

export { FATTI, cerca, registra, storiaDi };

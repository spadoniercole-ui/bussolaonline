// Referenzialita': non si cancella una radice finche' esistono rami attaccati.
//
// Prima ogni cancellazione portava via in silenzio quello che le stava sotto: eliminare una
// disciplina cancellava partite e gironi, eliminare un campo cancellava le prenotazioni,
// eliminare un articolo cancellava i suoi movimenti. Nessun avviso, nessun modo di accorgersene.
//
// Ora la cancellazione si ferma e dice COSA la blocca e QUANTO. Restano a cascata solo i rami
// che non hanno vita propria (per esempio un blocco campo, che e' una nota su una data).
//
// La cancellazione GDPR di un socio e' volutamente esclusa: li' la cancellazione e' il diritto
// da garantire, non il rischio da evitare.
import { db } from './db.js';

// soloSe: condizione SQL aggiuntiva — un ramo blocca solo se e' ancora "vivo"
const VINCOLI = {
  casate: [
    { tabella: "soci", colonna: "casata_id", etichetta: "soci iscritti alla casata" },
    { tabella: "classifica", colonna: "casata_id", etichetta: "tornei in cui e\u0300 iscritta" },
    { tabella: "contest_esiti", colonna: "casata_id", etichetta: "esiti di contest registrati" }
  ],
  discipline: [
    { tabella: "partite", colonna: "disciplina_id", soloSe: "stato='giocata'", etichetta: "partite gia\u0300 giocate" },
    { tabella: "edizioni", colonna: "disciplina_id", etichetta: "edizioni nell'Albo d'Oro" }
  ],
  campi: [
    { tabella: "prenotazioni_campo", colonna: "campo_id", soloSe: "stato='prenotato'", etichetta: "prenotazioni attive" },
    { tabella: "partite_aperte", colonna: "campo_id", soloSe: "stato IN ('aperta','completa')", etichetta: "partite aperte" }
  ],
  magazzino_articoli: [
    { tabella: "magazzino_movimenti", colonna: "articolo_id", etichetta: "movimenti di carico/scarico" },
    { tabella: "magazzino_richieste", colonna: "articolo_id", soloSe: "stato='impegnata'", etichetta: "impegni in corso" }
  ],
  menu_articoli: [
    // La colonna si chiama menu_id, non articolo_id. Con il nome sbagliato la query andava in
    // errore, il try/catch di rami() lo leggeva come "nessun vincolo", e la protezione non e'
    // mai scattata: si poteva cancellare un prodotto dentro comande aperte, che perdevano il
    // collegamento e smettevano di scaricare il magazzino. In silenzio.
    { tabella: "comanda_righe", colonna: "menu_id", soloSe: "comanda_id IN (SELECT id FROM comande WHERE stato NOT IN ('chiusa','annullata'))", etichetta: "righe di comande ancora aperte" }
  ],
  cdc_giochi: [
    { tabella: "cdc_prestiti", colonna: "gioco_id", soloSe: "ora_fine IS NULL OR ora_fine=''", etichetta: "prestiti non ancora rientrati" }
  ],
  serate: [
    { tabella: "serate_prenotazioni", colonna: "serata_id", soloSe: "stato<>'annullata'", etichetta: "prenotazioni non annullate" }
  ],
  contest: [
    { tabella: "contest_esiti", colonna: "contest_id", etichetta: "esiti registrati" }
  ],
  tavoli_layout: [
    { tabella: "tavoli_giorni", colonna: "layout_id", etichetta: "giornate che la usano" }
  ]
};

// Quali rami impediscono la cancellazione, e quanti sono.
async function rami(entita, id) {
  const regole = VINCOLI[entita] || [];
  const out = [];
  for (const r of regole) {
    try {
      const dove = `${r.colonna}=?` + (r.soloSe ? ` AND (${r.soloSe})` : "");
      const q = await db.prepare(`SELECT COUNT(*) n FROM ${r.tabella} WHERE ${dove}`).get(id);
      const n = Number(q?.n || 0);
      if (n > 0) out.push({ tabella: r.tabella, etichetta: r.etichetta, quanti: n });
    } catch (_) {
      // tabella non ancora creata su database vecchi: non e' un blocco
    }
  }
  return out;
}

function messaggio(cosa, blocchi) {
  const elenco = blocchi.map((b) => `${b.quanti} ${b.etichetta}`).join(", ");
  return `Non posso eliminare ${cosa}: prima vanno rimossi ${elenco}.`;
}

// Da usare in testa a una rotta DELETE: se qualcosa blocca, risponde 409 e restituisce true.
async function bloccaSeCollegato(res, entita, id, cosa) {
  const blocchi = await rami(entita, id);
  if (!blocchi.length) return false;
  res.status(409).json({ error: messaggio(cosa, blocchi), blocchi });
  return true;
}

export { VINCOLI, bloccaSeCollegato, messaggio, rami };

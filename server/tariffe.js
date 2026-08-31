// QUANTO COSTA UN CAMPO.
//
// I campi del chiosco sono gratuiti e restano tali. Tennis, beach tennis e beach volley no:
// chi li gestisce li affitta e ci fa lezione privata, con un listino suo. Ma il prezzo orario
// ce l'hanno tutti — a zero per i gratuiti — perche' domani si puo' decidere di far pagare
// anche il calcetto senza rimettere le mani nello schema.
//
// Il listino e' fatto di fasce: "mattina 12 €/h", "sera 18 €/h", "lezione privata 35 €/h".
// Se nessuna fascia copre l'orario si usa il prezzo base del campo; se non c'e' nemmeno quello,
// il campo e' gratuito e non si chiede niente.
import { db } from './db.js';

function minuti(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// La tariffa che si applica a una fascia oraria, per un certo uso (campo o lezione).
async function tariffaPer(campo, slot, tipoUso = "campo") {
  const tariffe = await db.prepare(
    "SELECT * FROM campi_tariffe WHERE campo_id=? AND attiva=1 AND tipo_uso=? ORDER BY id"
  ).all(campo.id, tipoUso);
  const t = minuti(slot);
  // Si prende la prima fascia che contiene l'orario. Le fasce senza orari valgono sempre: sono
  // il listino "piatto" di chi non vuole distinguere mattina e sera.
  const scelta = tariffe.find((x) => {
    if (!x.da_ora && !x.a_ora) return true;
    const da = x.da_ora ? minuti(x.da_ora) : 0;
    const a = x.a_ora ? minuti(x.a_ora) : 24 * 60;
    return t >= da && t < a;
  });
  if (scelta) return { prezzo_ora: Number(scelta.prezzo_ora), etichetta: scelta.etichetta, da_listino: true };
  return { prezzo_ora: Number(campo.prezzo_ora || 0), etichetta: null, da_listino: false };
}

// Il conto di una prenotazione: tariffa oraria per la durata effettiva.
async function prezzoPrenotazione(campo, slot, nSlot = 1, tipoUso = "campo") {
  const t = await tariffaPer(campo, slot, tipoUso);
  const ore = (Number(nSlot) * (Number(campo.durata_slot) || 60)) / 60;
  return {
    prezzo: Math.round(t.prezzo_ora * ore * 100) / 100,
    prezzo_ora: t.prezzo_ora,
    ore,
    tariffa: t.etichetta,
    gratuito: t.prezzo_ora <= 0
  };
}

// Il listino di un campo, come lo legge chi lo gestisce e chi prenota.
async function listino(campoId) {
  return db.prepare("SELECT * FROM campi_tariffe WHERE campo_id=? ORDER BY tipo_uso, id").all(campoId);
}

export { listino, prezzoPrenotazione, tariffaPer };

import { db } from './db.js';

var CAPS_DELEGABILI = [
  "utenti",
  // consulta/modifica anagrafiche
  "utenti_ins",
  // registra nuovi soci/ospiti
  "casate",
  // punti Coppa
  "cdc",
  // Casa di Carta (caffè, giochi, prelievi, check)
  "discipline",
  // attiva/parametri discipline
  "tabellone",
  // inserisci risultati / archivia / periodo
  "contest",
  // Contest Serata dei Clan
  "serate",
  // Serate & cena
  "proposte",
  // Proposte vinile/openmic
  "eventi",
  // Cartellone
  "magazzino",
  // Magazzino unificato (aree + alert)
  "comande",
  // Chiosco: comande + KDS (cassa/cameriere/stazioni)
  "campi",
  // Prenotazione campi (config campi + regole + prospetto prenotazioni)
  "beach",
  // La spiaggia: piazzole, ombrelloni, prese. Sulle piazzole non c'e' nessuno della crew —
  // questo permesso serve a chi guarda la situazione, sistema un disallineamento e chiude una
  // piazzola quando tira vento.
  "tennis_campi",
  // Delegato dei campi a pagamento: apre e chiude le fasce, prenota, disdice, blocca un campo.
  // NON vede il listino e NON vede il fatturato — il gestore puo' mandare qualcuno al banco
  // senza per questo mostrargli quanto incassa. Sono due mestieri diversi, e due permessi.
  "tennis",
  // Tennis, beach tennis e beach volley: campi a pagamento con tariffario proprio e lezioni
  // private. Chi li gestisce non e' il chiosco: e' un'attivita' a se', con un listino suo e
  // un incasso suo. Il gestore dell'app resta supervisore e puo' intervenire, ma il campo
  // quotidiano lo tiene chi lo affitta.
  "fitness",
  // Area fitness: corsi, lezioni, iscritti e incassi
  "cinema"
  // Cinema: cartellone, proiezioni, platea
];
var CAPS_GESTORE_ONLY = [
  "utenti_del",
  // cancellazione GDPR
  "discipline_del",
  // elimina disciplina
  "tabellone_reset",
  // rigenera/azzera calendario
  "guida",
  // Guida / Rifiuti
  "luoghi",
  // Luoghi "Siamo qui"
  "registro",
  // Registro attività
  "db",
  // Database & backup
  "operatori",
  // gestione account staff e permessi
  "parametri"
  // regole di funzionamento: decidono come funziona il residence, non si delegano
];
var GO = new Set(CAPS_GESTORE_ONLY);
var MANAGER_CAPS = /* @__PURE__ */ new Set([
  "utenti",
  "casate",
  "cdc",
  "discipline",
  "tabellone",
  "contest",
  "serate",
  "proposte",
  "eventi",
  "magazzino",
  "comande",
  "campi"
]);
function parsePermessi(p) {
  if (Array.isArray(p)) return p;
  if (typeof p === "string" && p) {
    try {
      const a = JSON.parse(p);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
}
function hasCap(user, cap) {
  if (!user) return false;
  if (user.ruolo === "gestore") return true;
  if (GO.has(cap)) return false;
  if (user.ruolo === "manager") return MANAGER_CAPS.has(cap);
  if (user.ruolo === "staff") return parsePermessi(user.permessi).includes(cap);
  return false;
}
function requireCap(cap) {
  return (req, res, next) => hasCap(req.adminUser, cap) ? next() : res.status(403).json({ error: "Permesso insufficiente per il tuo ruolo" });
}
function capsInfo(user) {
  const tutte = [...CAPS_DELEGABILI, ...CAPS_GESTORE_ONLY];
  return {
    ruolo: user.ruolo,
    gestore: user.ruolo === "gestore",
    caps: user.ruolo === "gestore" ? tutte : tutte.filter((c) => hasCap(user, c))
  };
}

export { CAPS_DELEGABILI, capsInfo, hasCap, parsePermessi, requireCap };

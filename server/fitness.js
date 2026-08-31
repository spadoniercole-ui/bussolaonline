// Area fitness — corsi brevi con istruttore esterno, pagamento in contanti a fine lezione.
//
// Modello volutamente semplice, perche' semplice e' la realta': niente abbonamenti, niente
// conteggio presenze. Un corso apre e chiude in una o due settimane, si prenota la singola
// lezione e si paga quella. La masterclass e' una lezione con un nome che tira e un prezzo
// piu' alto: il flag sta sulla SEDUTA, cosi' l'istruttore blasonato che viene una sera sola
// non obbliga a inventare un corso apposta.
import { db } from './db.js';
import { par } from './parametri.js';

const GIORNI = ["", "lun", "mar", "mer", "gio", "ven", "sab", "dom"];

function parseGiorni(v) {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.map(Number).filter((n) => n >= 1 && n <= 7) : [];
  } catch (_) {
    return [];
  }
}

// 1 = lunedi' ... 7 = domenica (ISO), non la numerazione di JS che parte dalla domenica.
function isoDay(dataISO) {
  const d = new Date(dataISO + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

// Genera le lezioni del corso nei giorni indicati, fra inizio e fine.
// Idempotente: non tocca le lezioni gia' esistenti (potrebbero avere prenotazioni o
// modifiche), aggiunge solo quelle mancanti.
async function generaSedute(corsoId) {
  const c = await db.prepare("SELECT * FROM corsi_fitness WHERE id=?").get(corsoId);
  if (!c) return { error: "Corso non trovato" };
  if (!c.data_inizio || !c.data_fine) return { error: "Servono le date di inizio e fine corso" };
  const giorni = parseGiorni(c.giorni);
  if (!giorni.length) return { error: "Scegli almeno un giorno della settimana" };

  const ins = db.prepare(
    "INSERT OR IGNORE INTO fitness_sedute (corso_id,data,ora,durata_min,istruttore,posti_max,min_iscritti,prezzo,masterclass) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  let creati = 0;
  const fine = new Date(c.data_fine + "T12:00:00Z").getTime();
  let cur = new Date(c.data_inizio + "T12:00:00Z").getTime();
  let guardia = 0;
  while (cur <= fine && guardia++ < 400) {
    const data = new Date(cur).toISOString().slice(0, 10);
    if (giorni.includes(isoDay(data))) {
      const r = await ins.run(c.id, data, c.ora, c.durata_min, c.istruttore || null, c.posti_max, c.min_iscritti, c.masterclass ? c.prezzo_master || c.prezzo : c.prezzo, c.masterclass ? 1 : 0);
      if (r.changes) creati++;
    }
    cur += 864e5;
  }
  return { creati };
}

async function iscrittiDi(sedutaId) {
  const r = await db.prepare("SELECT COUNT(*) n FROM fitness_prenotazioni WHERE seduta_id=? AND stato='prenotato'").get(sedutaId);
  return Number(r?.n || 0);
}

// Una lezione con il suo stato: confermata quando raggiunge il minimo, altrimenti "in attesa".
// Il minimo si puo' spegnere del tutto dai parametri: allora ogni lezione parte comunque.
async function conStato(s) {
  const iscritti = await iscrittiDi(s.id);
  const minimoAttivo = await par("fitness_minimo");
  const minimo = minimoAttivo ? Number(s.min_iscritti) || 0 : 0;
  return {
    ...s,
    masterclass: !!s.masterclass,
    iscritti,
    posti_liberi: Math.max(0, Number(s.posti_max) - iscritti),
    minimo,
    mancano: Math.max(0, minimo - iscritti),
    confermata: iscritti >= minimo,
    completa: iscritti >= Number(s.posti_max)
  };
}

async function sedute({ corsoId = null, da = null, soloFuture = true } = {}) {
  const cond = ["s.stato='programmata'"];
  const args = [];
  if (corsoId) { cond.push("s.corso_id=?"); args.push(corsoId); }
  if (soloFuture) cond.push("s.data >= date('now','-1 day')");
  if (da) { cond.push("s.data>=?"); args.push(da); }
  const rows = await db.prepare(
    `SELECT s.*, c.nome AS corso_nome, c.descrizione, c.attivo AS corso_attivo, c.colore
     FROM fitness_sedute s JOIN corsi_fitness c ON c.id=s.corso_id
     WHERE ${cond.join(" AND ")} ORDER BY s.data, s.ora`
  ).all(...args);
  const out = [];
  for (const s of rows.filter((r) => r.corso_attivo)) out.push(await conStato(s));
  return out;
}

// Una lezione e' passata quando e' finita: si guarda l'ora di casa, non quella del server.
function giaPassata(data, ora, durataMin) {
  const f = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const v = Object.fromEntries(f.map((x) => [x.type, x.value]));
  const oggi = `${v.year}-${v.month}-${v.day}`;
  if (data < oggi) return true;
  if (data > oggi) return false;
  const [h, m] = String(ora || "0:0").split(":").map(Number);
  return (h * 60 + (m || 0) + (durataMin || 60)) <= Number(v.hour) * 60 + Number(v.minute);
}

async function prenotaSeduta({ sedutaId, socio, tessera_code, nome, origine }) {
  const s = await db.prepare("SELECT * FROM fitness_sedute WHERE id=? AND stato='programmata'").get(sedutaId);
  if (!s) return { error: "Lezione non disponibile" };
  // A UNA LEZIONE PASSATA NON CI SI ISCRIVE. Mancava del tutto: il 30 agosto si poteva
  // prendere posto a una lezione di luglio, che il calendario mostrava ancora perche' la
  // griglia parte dalla prima settimana del corso. Nessuno se ne accorgeva finche' non
  // arrivava qualcuno a chiedere di una lezione che si era gia' tenuta.
  if (giaPassata(s.data, s.ora, Number(s.durata_min) || 60)) {
    return { error: `Quella lezione si e' gia' tenuta (${s.data} alle ${s.ora}).` };
  }
  const gia = await db.prepare("SELECT id FROM fitness_prenotazioni WHERE seduta_id=? AND tessera_code=? AND stato='prenotato'").get(s.id, tessera_code);
  if (gia) return { error: "Sei gi\u00e0 iscritto a questa lezione" };
  const iscritti = await iscrittiDi(s.id);
  if (iscritti >= Number(s.posti_max)) return { error: "Lezione al completo" };
  const info = await db.prepare("INSERT INTO fitness_prenotazioni (seduta_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)")
    .run(s.id, socio?.id ?? null, tessera_code || null, nome || null);
  const stato = await conStato(s);
  return { id: Number(info.lastInsertRowid), ...stato, origine: origine || "app" };
}

export { GIORNI, conStato, generaSedute, iscrittiDi, isoDay, parseGiorni, prenotaSeduta, sedute };

// LA SPIAGGIA.
//
// Il vincolo che ha deciso tutto il resto: **sulle piazzole non c'e' nessuno della crew**. Non
// c'e' un arbitro, quindi non si puo' progettare come i tavoli — dove chi sbaglia trova un
// cameriere che sistema. Qui le regole devono reggersi da sole, e ogni scelta va fatta
// chiedendosi: "questa cosa, alle undici di mattina, fra due persone in costume che non si
// conoscono, come va a finire?"
//
// Da quella domanda vengono tre decisioni:
//
// 1. **Fasce fisse, non quattro ore mobili.** Con le ore mobili chi prende alle 10:20 libera
//    alle 14:20 — un'ora che non serve a nessuno — e chi arriva alle 15 trova occupato fino
//    alle 19:20 anche se quello se ne va alle 18. Due fasce uguali per tutti si spiegano in una
//    riga e rendono naturale il tetto di due al giorno: sono due, e basta.
//
// 2. **Una presa per NUCLEO, non per persona.** "Uno a testa, salvo altra piazzola" produce
//    l'opposto di quello che si vuole: una famiglia di sei o si separa, o prende gli ombrelloni
//    a nome dei figli. Un nucleo numeroso prende piu' ombrelloni ADIACENTI e conta come una
//    presa sola: la famiglia sta insieme e il furbo non ha margine.
//
// 3. **Alla scadenza l'ombrellone NON passa automaticamente a un altro.** Se l'app dicesse a
//    qualcuno "questo e' tuo" mentre sotto c'e' ancora una famiglia con le sue cose, il litigio
//    lo avrebbe causato il software. Diventa libero, ma chi lo prende legge che potrebbe
//    trovarci ancora qualcuno.
import { db } from './db.js';
import { par } from './parametri.js';
import { adessoInSicilia } from './tavoli.js';

const FASCE = ["mattina", "pomeriggio"];

async function orari() {
  return {
    mattina: { da: String(await par("beach_mattina_da") || "08:00"), a: String(await par("beach_mattina_a") || "13:00") },
    pomeriggio: { da: String(await par("beach_pomeriggio_da") || "13:00"), a: String(await par("beach_pomeriggio_a") || "19:00") }
  };
}
const minuti = (hhmm) => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// In quale fascia siamo adesso, e quale si puo' ancora prendere.
async function fasceOggi() {
  const o = await orari();
  const ora = adessoInSicilia();
  return FASCE.map((f) => ({
    fascia: f,
    da: o[f].da,
    a: o[f].a,
    in_corso: ora.minuti >= minuti(o[f].da) && ora.minuti < minuti(o[f].a),
    passata: ora.minuti >= minuti(o[f].a),
    minuti_alla_fine: Math.max(0, minuti(o[f].a) - ora.minuti)
  }));
}

// Chiude le prese la cui fascia e' finita. Non assegna niente a nessuno: libera e basta.
async function chiudiScadute(data) {
  const o = await orari();
  const ora = adessoInSicilia();
  if (data !== ora.data) return 0;
  let n = 0;
  for (const f of FASCE) {
    if (ora.minuti < minuti(o[f].a)) continue;
    const r = await db.prepare(
      "UPDATE ombrellone_prese SET stato='scaduta', rilasciata_at=datetime('now') WHERE data=? AND fascia=? AND stato='attiva'"
    ).run(data, f);
    n += Number(r?.changes || 0);
  }
  return n;
}

// La situazione di una piazzola: ogni ombrellone con chi c'e' sopra.
async function situazione(piazzolaId, data, fascia) {
  await chiudiScadute(data);
  const ombrelloni = await db.prepare("SELECT * FROM ombrelloni WHERE piazzola_id=? AND attivo=1 ORDER BY numero").all(piazzolaId);
  const prese = await db.prepare(
    "SELECT * FROM ombrellone_prese WHERE data=? AND fascia=? AND stato='attiva'"
  ).all(data, fascia);
  const bloccata = await db.prepare(
    "SELECT * FROM piazzole_blocchi WHERE piazzola_id=? AND data=? AND (fascia IS NULL OR fascia=?)"
  ).get(piazzolaId, data, fascia);
  // QUANTO MANCA, non "da quanto e' li'". Chi guarda la piazzola deve capire in un colpo
  // d'occhio dove si liberera' qualcosa fra poco: e' l'unica informazione che serve a chi
  // aspetta. Le prese scadute e mai rilasciate restano visibili in rosso — sono la misura di
  // quanto la regola sta reggendo, e senza di loro non lo sapremmo mai.
  const o = await orari();
  const ora = adessoInSicilia();
  const inizio = minuti(o[fascia].da), fine = minuti(o[fascia].a);
  const meta = inizio + (fine - inizio) / 2;
  const scadute = await db.prepare(
    "SELECT * FROM ombrellone_prese WHERE data=? AND fascia=? AND stato='scaduta'"
  ).all(data, fascia);

  const statoUso = (p) => {
    if (!p) return "libero";
    if (data !== ora.data) return "occupato";
    if (ora.minuti >= fine) return "scaduto";
    if (fine - ora.minuti <= 30) return "in_scadenza";
    return ora.minuti < meta ? "inizio" : "seconda_meta";
  };

  return {
    bloccata: bloccata ? { motivo: bloccata.motivo, nota: bloccata.nota } : null,
    fascia_da: o[fascia].da, fascia_a: o[fascia].a,
    ombrelloni: ombrelloni.map((omb) => {
      const p = prese.find((x) => x.ombrellone_id === omb.id);
      const sc = !p ? scadute.find((x) => x.ombrellone_id === omb.id) : null;
      return {
        id: omb.id, numero: omb.numero, posti: omb.posti, x: omb.x, y: omb.y,
        libero: !p && !bloccata,
        stato_uso: bloccata ? "bloccato" : statoUso(p),
        // Non rilasciato a fine fascia: non e' un'infrazione da punire, e' un dato da vedere.
        non_rilasciato: !!sc,
        preso_da: p ? (p.nome || p.tessera_code) : (sc ? (sc.nome || sc.tessera_code) : null),
        nucleo: p ? p.nucleo : null,
        presa_id: p ? p.id : null,
        minuti_alla_fine: p && data === ora.data ? Math.max(0, fine - ora.minuti) : null
      };
    })
  };
}

// Il nucleo di chi chiede: se non e' dichiarato, vale la persona. Senza nucleo dichiarato la
// regola "una per famiglia" non e' applicabile, e va detto invece di far finta di niente.
function nucleoDi(socio) {
  const n = String(socio?.nucleo || "").trim();
  return n ? n.toLowerCase() : "socio:" + socio.id;
}

// PRENDERE UN OMBRELLONE. Qui vivono tutte le regole, e ognuna spiega il proprio no.
async function prendi({ socio, ombrelloneId, data, fascia, quanti = 1 }) {
  if (!FASCE.includes(fascia)) return { ok: false, error: "Fascia non valida" };
  const ora = adessoInSicilia();
  if (data !== ora.data) {
    return { ok: false, error: "L'ombrellone si prende il giorno stesso: chi arriva prende. Se si prenotasse la sera prima, la mattina dopo meta' spiaggia risulterebbe occupata e sarebbe vuota." };
  }
  await chiudiScadute(data);

  const o = await orari();
  if (ora.minuti >= minuti(o[fascia].a)) return { ok: false, error: `La fascia del ${fascia} e' finita alle ${o[fascia].a}.` };

  const omb = await db.prepare("SELECT * FROM ombrelloni WHERE id=? AND attivo=1").get(ombrelloneId);
  if (!omb) return { ok: false, error: "Ombrellone non trovato" };
  const bloccata = await db.prepare(
    "SELECT * FROM piazzole_blocchi WHERE piazzola_id=? AND data=? AND (fascia IS NULL OR fascia=?)"
  ).get(omb.piazzola_id, data, fascia);
  if (bloccata) return { ok: false, error: `Piazzola chiusa: ${bloccata.motivo}${bloccata.nota ? " \u2014 " + bloccata.nota : ""}` };

  const giaPreso = await db.prepare(
    "SELECT * FROM ombrellone_prese WHERE ombrellone_id=? AND data=? AND fascia=? AND stato='attiva'"
  ).get(ombrelloneId, data, fascia);
  if (giaPreso) return { ok: false, error: `Gia' preso da ${giaPreso.nome || "un altro socio"}.` };

  const nucleo = nucleoDi(socio);
  const maxFasce = Number(await par("beach_fasce_al_giorno")) || 2;

  // Una presa per fascia, per nucleo: e' la regola che tiene insieme le famiglie e toglie
  // margine a chi prende gli ombrelloni a nome dei figli.
  const inQuestaFascia = await db.prepare(
    "SELECT COUNT(*) n FROM ombrellone_prese WHERE data=? AND fascia=? AND lower(nucleo)=? AND stato='attiva'"
  ).get(data, fascia, nucleo);
  if (Number(inQuestaFascia.n) > 0) {
    return { ok: false, error: "La tua famiglia ha gia' un ombrellone in questa fascia. Se siete in tanti, prendine un altro accanto: contano come uno solo." , gia_preso: true };
  }

  // Quante fasce ha gia' usato oggi il nucleo, comprese quelle finite.
  const oggi = await db.prepare(
    "SELECT COUNT(DISTINCT fascia) n FROM ombrellone_prese WHERE data=? AND lower(nucleo)=?"
  ).get(data, nucleo);
  if (Number(oggi.n) >= maxFasce) {
    return { ok: false, error: `Oggi la tua famiglia ha gia' usato ${maxFasce} fasce: si riprende domani.` };
  }

  const scade = `${data} ${o[fascia].a}`;
  const info = await db.prepare(
    "INSERT INTO ombrellone_prese (ombrellone_id,data,fascia,socio_id,tessera_code,nome,nucleo,scade_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(ombrelloneId, data, fascia, socio.id, socio.tessera_code, `${socio.nome} ${socio.cognome || ""}`.trim(), nucleo, scade);

  // Se il nucleo e' numeroso servono piu' ombrelloni: si dice subito, invece di lasciare che
  // ci provino e ricevano il no della regola "uno per famiglia".
  const posti = Number(await par("beach_posti_ombrellone")) || 2;
  return {
    ok: true, id: Number(info.lastInsertRowid), scade_alle: o[fascia].a,
    nota: quanti > posti
      ? `Un ombrellone tiene ${posti} persone: per essere in ${quanti} prendetene un altro accanto, conta come una presa sola.`
      : null
  };
}

async function rilascia({ socio, presaId }) {
  const p = await db.prepare("SELECT * FROM ombrellone_prese WHERE id=?").get(presaId);
  if (!p || p.stato !== "attiva") return { ok: false, error: "Presa non trovata" };
  // Puo' rilasciare chi l'ha presa o chi e' della stessa famiglia: in spiaggia il telefono ce
  // l'ha uno solo, ed e' quasi sempre quello che resta sotto l'ombrellone.
  if (String(p.nucleo || "") !== nucleoDi(socio) && p.socio_id !== socio.id) {
    return { ok: false, error: "Questo ombrellone l'ha preso qualcun altro." };
  }
  await db.prepare("UPDATE ombrellone_prese SET stato='rilasciata', rilasciata_at=datetime('now') WHERE id=?").run(p.id);
  return { ok: true };
}

// QUANTI OMBRELLONI CI STANNO DAVVERO.
//
// Il numero NON si deduce dalle misure e basta: le piazzole vere hanno alberi, docce, gradini e
// forme storte, e una formula direbbe che ce ne stanno quattordici dove ce ne stanno nove. Ma
// le misure servono lo stesso, per due cose: dare un tetto ragionevole a chi dispone gli
// ombrelloni, e dire se quelli gia' messi si pestano i piedi.
//
// E' lo stesso ragionamento del "ci sta davvero?" del Garden: il conto non decide, verifica.
async function verificaPiazzola(piazzolaId) {
  const p = await db.prepare("SELECT * FROM piazzole WHERE id=?").get(piazzolaId);
  if (!p) return null;
  const L = Number(p.larghezza_m) || 0;
  const P = Number(p.profondita_m) || 0;
  const ing = Number(await par("beach_ingombro_ombrellone_m")) || 3;
  const pass = Number(await par("beach_passaggio_m")) || 1.5;
  const ombrelloni = await db.prepare("SELECT * FROM ombrelloni WHERE piazzola_id=? AND attivo=1 ORDER BY numero").all(p.id);

  if (!L || !P) {
    return {
      piazzola: p.nome, misure_mancanti: true, disposti: ombrelloni.length,
      nota: "Senza le misure della piazzola non si puo' dire se ci stanno: si prendono col metro, una volta sola."
    };
  }

  const passo = ing + pass;
  const perFila = Math.max(0, Math.floor((L + pass) / passo));
  const file = Math.max(0, Math.floor((P + pass) / passo));
  const capienza = perFila * file;

  // Chi si pesta i piedi: stesse regole del Garden, sulle coordinate in percentuale.
  const inMetri = ombrelloni.map((o) => ({ numero: o.numero, x: (Number(o.x) / 100) * L, y: (Number(o.y) / 100) * P }));
  const vicini = [];
  for (let i = 0; i < inMetri.length; i++) {
    for (let j = i + 1; j < inMetri.length; j++) {
      const dx = Math.abs(inMetri[i].x - inMetri[j].x) - ing;
      const dy = Math.abs(inMetri[i].y - inMetri[j].y) - ing;
      const luce = Math.max(dx, dy);
      if (luce < pass - 0.01) vicini.push({ a: inMetri[i].numero, b: inMetri[j].numero, luce: Number(luce.toFixed(2)) });
    }
  }
  const fuori = inMetri.filter((o) => o.x - ing / 2 < -0.01 || o.x + ing / 2 > L + 0.01 || o.y - ing / 2 < -0.01 || o.y + ing / 2 > P + 0.01).map((o) => o.numero);

  const problemi = [];
  if (ombrelloni.length > capienza) problemi.push(`Ne hai disposti ${ombrelloni.length} ma in ${L}\u00d7${P} m ce ne stanno ${capienza} lasciando ${pass} m di passaggio.`);
  if (vicini.length) problemi.push(`Fra ${vicini.length} coppie di ombrelloni non ci si passa: servono ${pass} m, ce ne sono meno.`);
  if (fuori.length) problemi.push(`${fuori.length} ombrelloni escono dal perimetro della piazzola (${fuori.join(", ")}).`);

  return {
    piazzola: p.nome,
    misure: { larghezza_m: L, profondita_m: P, mq: Number((L * P).toFixed(1)) },
    regole: { ingombro_m: ing, passaggio_m: pass },
    disposti: ombrelloni.length,
    capienza_indicativa: capienza,
    persone: capienza * (Number(await par("beach_posti_ombrellone")) || 2),
    mq_per_ombrellone: ombrelloni.length ? Number((L * P / ombrelloni.length).toFixed(1)) : null,
    troppo_vicini: vicini.slice(0, 12),
    fuori_perimetro: fuori,
    problemi,
    verdetto: problemi.length ? (ombrelloni.length > capienza ? "troppi ombrelloni" : "disposizione da rivedere") : "ci stanno",
    // Il numero resta una decisione di chi guarda la spiaggia: qui si dice solo se torna.
    nota: "La capienza e' indicativa: alberi, docce e passaggi non li conosce nessuna formula. Gli ombrelloni si dispongono a mano, questo conto dice se ci stanno."
  };
}

export { verificaPiazzola, chiudiScadute, FASCE, fasceOggi, nucleoDi, orari, prendi, rilascia, situazione };

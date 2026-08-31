// COMPORRE LE CASATE.
//
// Il primo anno nessuno conosce nessuno: aspettare che i soci si associno da soli significa
// arrivare a luglio con tre casate piene e cinque vuote. Quindi il sistema propone lui una
// composizione, e poi lascia due settimane per cambiarla.
//
// I VINCOLI SI CONTRADDICONO, e questo va detto prima di scrivere il codice. Nuclei familiari
// uniti, due under 14, due over 70, meta' donne e fasce d'eta' distribuite non stanno insieme
// appena i numeri non sono perfetti — e non lo sono mai. Il sistema deve sapere in che ordine
// cedere:
//
//   1. Il nucleo familiare non si separa MAI. E' la ragione per cui la gente gioca.
//   2. Numero legale della casata.
//   3. Under 14 e over 70.
//   4. Quota di rappresentanza, sul totale della casata.
//   5. Distribuzione per fasce d'eta': la prima a cedere.
//
// E soprattutto: quando un vincolo viene violato, **si dice**. "Aretusa: 5 donne su 12, sotto
// la quota, perche' i nuclei iscritti non consentono di meglio" e' un'informazione con cui il
// gestore puo' fare qualcosa. Un vincolo violato in silenzio e' peggio di un vincolo assente.
import { db } from './db.js';
import { par } from './parametri.js';

// Le fasce d'eta' servono a evitare casate tutte di trentenni. NON sono un vincolo con una
// quota: otto persone in sei fasce non si dividono, e pretenderlo produrrebbe solo violazioni.
// Sono un criterio di distribuzione: si gira fra le fasce mentre si riempie.
const FASCE = [
  { nome: "under14", da: 0, a: 13 },
  { nome: "15-22", da: 14, a: 22 },
  { nome: "23-30", da: 23, a: 30 },
  { nome: "31-38", da: 31, a: 38 },
  { nome: "39-46", da: 39, a: 46 },
  { nome: "47-54", da: 47, a: 54 },
  { nome: "55-62", da: 55, a: 62 },
  { nome: "63-69", da: 63, a: 69 },
  { nome: "over70", da: 70, a: 200 }
];

function eta(dataNascita) {
  if (!dataNascita) return null;
  const n = new Date(dataNascita + "T00:00:00Z").getTime();
  if (!Number.isFinite(n)) return null;
  return Math.floor((Date.now() - n) / 31557600000);
}
function fasciaDi(anni) {
  if (anni == null) return "sconosciuta";
  return (FASCE.find((f) => anni >= f.da && anni <= f.a) || {}).nome || "sconosciuta";
}

// Un nucleo e' un gruppo che si muove insieme: chi ha lo stesso codice `nucleo`, piu' i minori
// legati al loro tutore. Chi non ha nucleo e' un nucleo di uno.
async function nuclei(giocatori) {
  const perId = new Map(giocatori.map((g) => [g.id, g]));
  const chiave = (g) => {
    if (g.nucleo) return "n:" + String(g.nucleo).trim().toLowerCase();
    // Un minore segue il tutore, anche se nessuno ha scritto il codice nucleo.
    if (g.tutore_id && perId.has(g.tutore_id)) {
      const t = perId.get(g.tutore_id);
      return t.nucleo ? "n:" + String(t.nucleo).trim().toLowerCase() : "t:" + g.tutore_id;
    }
    return "s:" + g.id;
  };
  const gruppi = new Map();
  for (const g of giocatori) {
    const k = chiave(g);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(g);
  }
  return [...gruppi.values()].map((membri) => ({
    membri,
    dimensione: membri.length,
    under14: membri.filter((m) => eta(m.data_nascita) != null && eta(m.data_nascita) < 14).length,
    over70: membri.filter((m) => eta(m.data_nascita) != null && eta(m.data_nascita) >= 70).length,
    donne: membri.filter((m) => String(m.sesso || "").toUpperCase() === "F").length
  }));
}

// Mescolamento vero: ordinare per numero casuale sbilancia, e qui il sorteggio e' pubblico.
function mescola(v) {
  const a = v.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Quanto "ha bisogno" una casata di questo nucleo: piu' alto, piu' quel nucleo le serve. E'
// cosi' che i vincoli si rispettano senza tentare tutte le combinazioni possibili — che con
// novantasei persone sarebbero piu' di quante se ne possano calcolare.
// LA QUOTA CRESCE CON LA CASATA. Su tre persone chiedere sei donne non ha senso: la quota si
// misura su quanti sono ADESSO, e diventa tassativa solo quando la casata e' piena. Sotto il
// massimo e' un obiettivo che si insegue mentre si riempie; al massimo e' un vincolo.
function quotaRichiesta(quanti, regole) {
  return Math.floor(quanti * regole.quota / 100);
}

// ANCHE I MINIMI CRESCONO CON LA CASATA. Pretendere due under 14 e due over 70 da una casata di
// quattro persone significa dichiarare venti problemi che non sono problemi: quella casata sta
// solo aspettando di riempirsi. I minimi valgono per intero a casata piena, e in proporzione
// mentre si riempie — esattamente come la quota.
function minimoRichiesto(quanti, minimoPieno, posti) {
  if (!minimoPieno) return 0;
  return Math.min(minimoPieno, Math.floor(quanti * minimoPieno / posti));
}

function quantoServe(casata, nucleo, regole) {
  if (casata.membri.length + nucleo.dimensione > regole.posti) return -1;  // non ci sta
  let punti = 0;
  const u14Serve = minimoRichiesto(casata.membri.length + nucleo.dimensione, regole.minUnder14, regole.posti);
  if (nucleo.under14 && casata.under14 < u14Serve) punti += 100 * Math.min(nucleo.under14, u14Serve - casata.under14);
  const o70Serve = minimoRichiesto(casata.membri.length + nucleo.dimensione, regole.minOver70, regole.posti);
  if (nucleo.over70 && casata.over70 < o70Serve) punti += 100 * Math.min(nucleo.over70, o70Serve - casata.over70);
  const serviranno = quotaRichiesta(casata.membri.length + nucleo.dimensione, regole);
  if (nucleo.donne && casata.donne < serviranno) punti += 60 * Math.min(nucleo.donne, serviranno - casata.donne);
  // Le fasce: un piccolo premio a chi porta una fascia che manca. Piccolo apposta, perche' e'
  // il criterio che deve cedere per primo.
  for (const m of nucleo.membri) {
    const f = fasciaDi(eta(m.data_nascita));
    if (!casata.fasce.has(f)) punti += 8;
  }
  // A parita' di tutto, si riempie chi ha piu' posti liberi: cosi' le casate crescono insieme
  // invece che una alla volta.
  punti += (regole.posti - casata.membri.length);
  return punti;
}

// Quanti servono e quanti ce ne sono: lo stesso conto serve nell'esito e negli avvisi.
// Quanti ne servono DAVVERO, viste le dimensioni che le casate hanno adesso: se sono da
// quattro, non servono due over 70 a testa. Contare sul massimo teorico produrrebbe un
// "mancano dodici over 70" che spaventa e non serve a niente.
function esitoDisponibilita(giocatori, dimensioni, { minUnder14, minOver70, quota, posti }) {
  const conta = (f) => giocatori.filter(f).length;
  const u14 = conta((g) => eta(g.data_nascita) != null && eta(g.data_nascita) < 14);
  const o70 = conta((g) => eta(g.data_nascita) != null && eta(g.data_nascita) >= 70);
  const donne = conta((g) => String(g.sesso || "").toUpperCase() === "F");
  const somma = (f) => dimensioni.reduce((n, q) => n + f(q), 0);
  const servU14 = somma((q) => minimoRichiesto(q, minUnder14, posti));
  const servO70 = somma((q) => minimoRichiesto(q, minOver70, posti));
  const servD = somma((q) => Math.floor(q * quota / 100));
  return {
    under14: { iscritti: u14, servono: servU14, mancano: Math.max(0, servU14 - u14) },
    over70: { iscritti: o70, servono: servO70, mancano: Math.max(0, servO70 - o70) },
    donne: { iscritti: donne, servono: servD, mancano: Math.max(0, servD - donne) }
  };
}

async function componi({ soloAnteprima = true } = {}) {
  const posti = Number(await par("coppa_casata_posti")) || 12;
  const minUnder14 = Number(await par("coppa_min_under14")) || 0;
  const minOver70 = Number(await par("coppa_min_over70")) || 0;
  const quota = Number(await par("coppa_quota_rosa")) || 0;
  const minDonne = Math.floor(posti * quota / 100);   // arrotondamento per DIFETTO
  const minimo = Number(await par("coppa_casata_min")) || 3;
  const regole = { posti, minimo, minUnder14, minOver70, minDonne, quota };

  const casateDb = await db.prepare("SELECT id,nome,colore FROM casate ORDER BY id").all();
  const giocatori = await db.prepare(
    "SELECT id,nome,cognome,tessera_code,data_nascita,sesso,nucleo,tutore_id,casata_id FROM soci WHERE attivo=1 AND gioca_coppa=1"
  ).all();

  const senzaSesso = giocatori.filter((g) => !["F", "M"].includes(String(g.sesso || "").toUpperCase()));
  const senzaData = giocatori.filter((g) => eta(g.data_nascita) == null);

  // LE CASATE SI SCHIERANO SEMPRE, tutte e otto. In campo, a un calcetto o a un basket, ne
  // vanno tre: una casata da cinque gioca, una da dodici ha piu' ricambi. Tenerne fuori
  // qualcuna perche' non arriva a dodici significa avere quattro casate forti e quattro
  // spettatori — che e' il contrario di un torneo fra otto.
  const quante = casateDb.length;

  const gruppi = mescola(await nuclei(giocatori));
  // Prima i nuclei grandi: sono i piu' difficili da collocare, e lasciarli per ultimi
  // significa non trovare piu' posto e doverli spezzare.
  gruppi.sort((a, b) => b.dimensione - a.dimensione);

  const casate = casateDb.slice(0, quante).map((c) => ({
    id: c.id, nome: c.nome, colore: c.colore,
    membri: [], under14: 0, over70: 0, donne: 0, fasce: new Set()
  }));
  const fuori = [];

  for (const n of gruppi) {
    let migliore = null, punteggio = -1;
    for (const c of casate) {
      const p = quantoServe(c, n, regole);
      if (p > punteggio) { punteggio = p; migliore = c; }
    }
    if (!migliore || punteggio < 0) { fuori.push(n); continue; }
    migliore.membri.push(...n.membri);
    migliore.under14 += n.under14;
    migliore.over70 += n.over70;
    migliore.donne += n.donne;
    for (const m of n.membri) migliore.fasce.add(fasciaDi(eta(m.data_nascita)));
  }

  // COSA NON SI E' RIUSCITI A RISPETTARE. Detto per casata, con il motivo.
  const problemi = [];
  for (const c of casate) {
    // Sotto il minimo la casata non puo' scendere in campo: e' l'unico problema che ferma
    // davvero il torneo.
    if (c.membri.length < minimo) problemi.push({ casata: c.nome, cosa: "non puo' scendere in campo", dettaglio: `${c.membri.length} su ${minimo} minimi`, grave: true });
    const u14Serve = minimoRichiesto(c.membri.length, minUnder14, posti);
    const o70Serve = minimoRichiesto(c.membri.length, minOver70, posti);
    if (c.under14 < u14Serve) problemi.push({ casata: c.nome, cosa: "under 14", dettaglio: `${c.under14} su ${u14Serve} per una casata da ${c.membri.length}`, grave: c.membri.length >= posti });
    if (c.over70 < o70Serve) problemi.push({ casata: c.nome, cosa: "over 70", dettaglio: `${c.over70} su ${o70Serve} per una casata da ${c.membri.length}`, grave: c.membri.length >= posti });
    // La quota si misura su quanti sono, e vincola solo a casata piena.
    const serve = quotaRichiesta(c.membri.length, regole);
    if (c.donne < serve) {
      problemi.push({
        casata: c.nome, cosa: "quota di rappresentanza",
        dettaglio: `${c.donne} donne su ${serve} per una casata da ${c.membri.length}` + (c.membri.length >= posti ? " (casata piena: qui la quota e' tassativa)" : ""),
        grave: c.membri.length >= posti
      });
    }
  }

  const esito = {
    regole: { posti, minimo, minUnder14, minOver70, quota, minDonne },
    iscritti: giocatori.length,
    casate_schierabili: quante,
    casate_totali: casateDb.length,
    casate: casate.map((c) => ({
      id: c.id, nome: c.nome, colore: c.colore,
      membri: c.membri.map((m) => ({
        id: m.id, nome: `${m.nome} ${m.cognome}`, tessera: m.tessera_code,
        eta: eta(m.data_nascita), fascia: fasciaDi(eta(m.data_nascita)), sesso: m.sesso || null
      })),
      quanti: c.membri.length, under14: c.under14, over70: c.over70, donne: c.donne,
      fasce: [...c.fasce].sort()
    })),
    in_attesa: fuori.flatMap((n) => n.membri.map((m) => ({ id: m.id, nome: `${m.nome} ${m.cognome}` }))),
    problemi,
    // LA CAUSA, non solo il sintomo. Sei casate che dicono "manca un over 70" sono sei righe
    // che non spiegano niente; "servono 16 over 70, ne sono iscritti 9" dice al gestore che il
    // problema non e' il sorteggio, e che deve andare a cercare sette persone.
    disponibilita: esitoDisponibilita(giocatori, casate.map((c) => c.membri.length), { minUnder14, minOver70, quota, posti }),
    avvisi: [
      ...(senzaSesso.length ? [`${senzaSesso.length} iscritti non hanno il sesso in anagrafica: senza, la quota di rappresentanza non si puo' calcolare su di loro.`] : []),
      ...(senzaData.length ? [`${senzaData.length} iscritti non hanno la data di nascita: non si sa in quale fascia stanno, ne' se sono under 14 o over 70.`] : []),
      ...(fuori.length ? [`${fuori.reduce((n2, x) => n2 + x.dimensione, 0)} iscritti non trovano posto: tutte le casate sono al massimo di ${posti}.`] : []),
      ...(casate.some((c) => c.membri.length < minimo) ? [`Alcune casate non arrivano a ${minimo} giocatori: sotto quel numero non si scende in campo nemmeno a calcetto.`] : [])
    ].concat((() => {
      const d = esitoDisponibilita(giocatori, casate.map((c) => c.membri.length), { minUnder14, minOver70, quota, posti });
      const righe = [];
      if (d.under14.mancano) righe.push(`Servono ${d.under14.servono} under 14 e ne sono iscritti ${d.under14.iscritti}: ne mancano ${d.under14.mancano}. Non e' il sorteggio, e' che non ci sono.`);
      if (d.over70.mancano) righe.push(`Servono ${d.over70.servono} over 70 e ne sono iscritti ${d.over70.iscritti}: ne mancano ${d.over70.mancano}. Nessuna composizione puo' rimediare: vanno cercati.`);
      if (d.donne.mancano) righe.push(`La quota chiede ${d.donne.servono} donne in tutto e ne sono iscritte ${d.donne.iscritti}: ne mancano ${d.donne.mancano}.`);
      return righe;
    })())
  };

  if (!soloAnteprima) {
    for (const c of casate) {
      for (const m of c.membri) await db.prepare("UPDATE soci SET casata_id=? WHERE id=?").run(c.id, m.id);
    }
    for (const n of fuori) {
      for (const m of n.membri) await db.prepare("UPDATE soci SET casata_id=NULL WHERE id=?").run(m.id);
    }
    const schierate = casate.filter((c) => c.membri.length >= minimo).map((c) => c.id);
    await db.prepare("UPDATE casate SET schierata=0").run();
    for (const id of schierate) await db.prepare("UPDATE casate SET schierata=1 WHERE id=?").run(id);
  }
  return esito;
}

// CHI FA IL CAPITANO.
//
// Il capitano non e' un premio: e' un lavoro. Convoca, iscrive la casata ai tornei, risponde
// quando qualcuno non si presenta. Quindi il criterio non e' "il piu' bravo" ne' "il piu'
// anziano di tessera": e' **chi si puo' raggiungere**. Un capitano irreperibile la sera del
// torneo e' una casata che non si presenta.
//
// Il sistema PROPONE, non nomina. Il primo anno nessuno conosce nessuno e un'elezione sarebbe
// un sorteggio travestito; dal secondo, la casata cambia capitano quando vuole fino alla
// chiusura delle formazioni.
//
// E propone anche un VICE, che e' la cosa che di solito manca: un capitano che quella sera ha
// la febbre non deve costare il torneo.
async function proponiCapitani() {
  const proposte = [];
  for (const c of await db.prepare("SELECT id,nome,capitano_socio_id,vice_socio_id FROM casate ORDER BY id").all()) {
    const membri = await db.prepare(
      "SELECT id,nome,cognome,data_nascita,email,telefono,tipo_profilo,created_at FROM soci WHERE casata_id=? AND attivo=1 AND gioca_coppa=1"
    ).all(c.id);
    const adulti = membri.filter((m) => {
      const a = eta(m.data_nascita);
      return a != null && a >= 18 && a < 75;   // maggiorenne, e non si carica di lavoro chi e' li' per giocare e basta
    });
    const punteggio = (m) => {
      let p = 0;
      // Raggiungibile: e' il requisito, non un di piu'.
      if (m.email) p += 40;
      if (m.telefono) p += 30;
      // Chi sta in residence tutta la stagione c'e' anche la sera del torneo.
      if (m.tipo_profilo === "residente") p += 25;
      else if (m.tipo_profilo === "socio") p += 10;
      // A parita', chi e' iscritto da piu' tempo conosce piu' gente.
      p += Math.max(0, 10 - Math.floor((Date.now() - Date.parse(m.created_at || "")) / 864e5 / 30));
      return p;
    };
    const ordinati = adulti.sort((a, b) => punteggio(b) - punteggio(a));
    proposte.push({
      casata_id: c.id, casata: c.nome,
      capitano_attuale: c.capitano_socio_id, vice_attuale: c.vice_socio_id,
      capitano: ordinati[0] ? { id: ordinati[0].id, nome: `${ordinati[0].nome} ${ordinati[0].cognome}`, perche: motivoCapitano(ordinati[0]) } : null,
      vice: ordinati[1] ? { id: ordinati[1].id, nome: `${ordinati[1].nome} ${ordinati[1].cognome}`, perche: motivoCapitano(ordinati[1]) } : null,
      // Se non c'e' nessun adulto raggiungibile, si dice: e' un problema vero, non un dettaglio.
      avviso: !ordinati.length
        ? "Nessun maggiorenne in questa casata: il capitano non si puo' proporre."
        : (!ordinati[0].email && !ordinati[0].telefono
          ? "Il capitano proposto non ha ne' e-mail ne' telefono: nessuno potra' avvisarlo."
          : null)
    });
  }
  return proposte;
}

function motivoCapitano(m) {
  const r = [];
  if (m.email) r.push("raggiungibile per e-mail");
  if (m.telefono) r.push("e per telefono");
  if (m.tipo_profilo === "residente") r.push("residente per tutta la stagione");
  return r.length ? r.join(", ") : "nessun contatto: da verificare";
}

// Lo stato di una casata rispetto ai vincoli: serve durante le due settimane in cui la gente
// entra ed esce, per sapere in ogni momento chi e' fuori regola.
async function statoCasate() {
  const posti = Number(await par("coppa_casata_posti")) || 12;
  const minUnder14 = Number(await par("coppa_min_under14")) || 0;
  const minOver70 = Number(await par("coppa_min_over70")) || 0;
  const quota = Number(await par("coppa_quota_rosa")) || 0;
  const minimo = Number(await par("coppa_casata_min")) || 3;
  const minDonne = Math.floor(posti * quota / 100);
  const out = [];
  for (const c of await db.prepare("SELECT id,nome,colore,schierata FROM casate ORDER BY id").all()) {
    const membri = await db.prepare("SELECT data_nascita,sesso FROM soci WHERE casata_id=? AND attivo=1 AND gioca_coppa=1").all(c.id);
    const under14 = membri.filter((m) => eta(m.data_nascita) != null && eta(m.data_nascita) < 14).length;
    const over70 = membri.filter((m) => eta(m.data_nascita) != null && eta(m.data_nascita) >= 70).length;
    const donne = membri.filter((m) => String(m.sesso || "").toUpperCase() === "F").length;
    // Cosa manca ADESSO, alla dimensione che ha adesso: i vincoli crescono con la casata.
    const mancano = [];
    const u14Serve = minimoRichiesto(membri.length, minUnder14, posti);
    const o70Serve = minimoRichiesto(membri.length, minOver70, posti);
    const dServe = Math.floor(membri.length * quota / 100);
    if (membri.length < minimo) mancano.push(`${minimo - membri.length} per scendere in campo`);
    if (under14 < u14Serve) mancano.push(`${u14Serve - under14} under 14`);
    if (over70 < o70Serve) mancano.push(`${o70Serve - over70} over 70`);
    if (donne < dServe) mancano.push(`${dServe - donne} donne per la quota`);
    out.push({
      id: c.id, nome: c.nome, colore: c.colore,
      quanti: membri.length, under14, over70, donne,
      in_regola: mancano.length === 0,
      // Si scende in campo dal minimo in su: in campo, a calcetto o a basket, ne vanno tre.
      puo_giocare: membri.length >= minimo,
      schierata: Number(c.schierata) === 1,
      mancano
    });
  }
  return { regole: { posti, minimo, minUnder14, minOver70, quota, minDonne }, casate: out };
}

export { componi, eta, fasciaDi, FASCE, proponiCapitani, statoCasate };

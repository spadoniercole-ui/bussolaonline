// Tavoli del Garden — pianta, disposizioni per serata e assegnazione dal centro alla periferia.
//
// Perche' esiste: fino alla v4.69 i tavoli erano solo numeri (1..N) senza posti ne' posizione.
// Per assegnare "dal centro alla periferia" serve sapere DOVE sta ogni tavolo e QUANTI posti ha.
//
// Modello:
//   - un LAYOUT e' una disposizione con un nome; ogni giorno puo' usarne una diversa
//   - il NUMERO del tavolo e' l'identita' stabile (QR self-order, comande.riferimento)
//   - una prenotazione puo' occupare piu' tavoli: i gruppi grandi non sono un caso speciale
import { db, getSetting, setSetting } from './db.js';
import { par } from './parametri.js';

// I tavoli della Casa di Carta servono due usi diversi nello stesso spazio: la mattina e il
// primo pomeriggio sono coworking (che occupa la sala fino alle 16), dalle 16 si gioca.
// Stessa stanza, stessi tavoli, stessa mappa: cambia solo a cosa serve il turno.
const TURNI_DEFAULT = { garden: ["20:00", "21:30"], carta: ["09:00", "13:00", "16:00", "18:00"] };
const SCOPO_TURNO_CARTA = { "09:00": "coworking", "13:00": "coworking", "16:00": "gioco", "18:00": "gioco" };
const ETICHETTA_TURNO_CARTA = { "09:00": "9-13 coworking", "13:00": "13-16 coworking", "16:00": "16-18 gioco", "18:00": "18-20 gioco" };
const scopoTurno = (t) => SCOPO_TURNO_CARTA[t] || "gioco";
const etichettaTurno = (t) => ETICHETTA_TURNO_CARTA[t] || t;

// I turni dipendono dall'ambiente: al Garden si cena in due turni, alla Casa di Carta si gioca
// in tre fasce. Lo stage non ha turni: il "turno" e' l'ora della proiezione.
async function turni(ambiente = "garden") {
  const amb = TURNI_DEFAULT[ambiente] ? ambiente : "garden";
  const raw = await getSetting(amb + "_turni", TURNI_DEFAULT[amb].join(","));
  const t = String(raw).split(",").map((x) => x.trim()).filter(Boolean);
  return t.length ? t : TURNI_DEFAULT[amb];
}

// Alla prima apertura crea una disposizione di partenza dal numero di tavoli gia' configurato,
// disposta a griglia: la Crew poi la sistema trascinando.
async function layoutPredefinito(ambiente = "garden") {
  let l = await db.prepare("SELECT * FROM tavoli_layout WHERE predefinito=1 AND ambiente=?").get(ambiente);
  if (l) return l;
  l = await db.prepare("SELECT * FROM tavoli_layout WHERE ambiente=? ORDER BY id LIMIT 1").get(ambiente);
  if (l) {
    await db.prepare("UPDATE tavoli_layout SET predefinito=1 WHERE id=?").run(l.id);
    return l;
  }
  // Platea del cinema: file di poltrone. Casa di Carta: tavoli da gioco. Garden: tavoli a griglia.
  if (ambiente === "stage") return await creaPlateaIniziale();
  if (ambiente === "carta") return await creaSalaCarta();
  // Quanti tavoli e quanti posti: sono parametri del back office, non numeri scritti nel
  // codice. Il gestore che aggiunge due tavoli non deve chiedere a nessuno.
  const n = Math.max(1, Number(await par("garden_tavoli")) || 12);
  const postiTavolo = Math.max(1, Number(await par("garden_posti_per_tavolo")) || 4);
  const info = await db.prepare("INSERT INTO tavoli_layout (nome,predefinito,ambiente) VALUES (?,1,'garden')").run("Standard");
  const id = Number(info.lastInsertRowid);
  // Le colonne non si scelgono a occhio con una radice quadrata: si guarda quanti tavoli
  // entrano davvero nella LARGHEZZA della sala, lasciando il passaggio. Prima la griglia
  // metteva quattro tavoli per fila anche in una sala da nove metri, e poi la verifica dello
  // spazio diceva che fra loro non ci passava nessuno — con il gestore a chiedersi perche' la
  // pianta creata dal sistema stesso risultasse sbagliata.
  const Lm = Number(await par("garden_larghezza_m")) || 0;
  const Pm = Number(await par("garden_profondita_m")) || 0;
  const ingM = Number(await par("garden_ingombro_tavolo_m")) || 2;
  const corM = Number(await par("garden_corridoio_m")) || 0.9;
  const perFila = Lm ? Math.max(1, Math.floor((Lm + corM) / (ingM + corM))) : 0;
  const cols = perFila || Math.ceil(Math.sqrt(n));
  const righe = Math.ceil(n / cols);
  if (Lm && Pm) {
    const fileCheStanno = Math.max(1, Math.floor((Pm + corM) / (ingM + corM)));
    if (righe > fileCheStanno) {
      console.log(`  Garden: ${n} tavoli non ci stanno in ${Lm}\u00d7${Pm} m (ne entrano ${cols * fileCheStanno}). Li dispongo lo stesso: la verifica dello spazio te lo dira'.`);
    }
  }
  const ins = db.prepare("INSERT INTO tavoli (layout_id,numero,posti,forma,x,y) VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // Con le misure della sala i tavoli si mettono al PASSO GIUSTO — ingombro piu' passaggio —
    // e la fila si centra sullo spazio che avanza. Spargerli in percentuale sull'intera
    // larghezza li faceva finire a 1,8 m di distanza dove ne servivano 2,5: il sistema
    // disegnava da solo una sala in cui non si passava.
    let x, y;
    if (Lm && Pm) {
      const passo = ingM + corM;
      const margineX = Math.max(ingM / 2, (Lm - ((cols - 1) * passo)) / 2);
      const margineY = Math.max(ingM / 2, (Pm - ((righe - 1) * passo)) / 2);
      x = ((margineX + c * passo) / Lm) * 100;
      y = ((margineY + r * passo) / Pm) * 100;
    } else {
      x = ((c + 1) / (cols + 1)) * 100;
      y = ((r + 1) / (righe + 1)) * 100;
    }
    x = Math.min(97, Math.max(3, x));
    y = Math.min(97, Math.max(3, y));
    // Quadrati da quattro: e' la base del Garden. Il quadrato si accosta a un altro quadrato e
    // fa una tavolata vera; il tondo, accostato, lascia buchi e non regge il conto dei posti.
    await ins.run(id, i + 1, postiTavolo, "quadrato", Number(x.toFixed(1)), Number(y.toFixed(1)));
  }
  return await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(id);
}

async function layoutDelGiorno(data, ambiente = "garden") {
  if (data && (ambiente === "garden" || ambiente === "carta")) {
    // La disposizione del giorno va cercata NELL'AMBIENTE giusto: la tabella tavoli_giorni ha
    // una riga per data, quindi senza questo filtro un layout assegnato al Garden veniva
    // restituito anche alla Casa di Carta (e viceversa).
    const g = await db.prepare(
      "SELECT l.* FROM tavoli_giorni g JOIN tavoli_layout l ON l.id=g.layout_id WHERE g.data=? AND l.ambiente=?"
    ).get(data, ambiente);
    if (g) return g;
  }
  return await layoutPredefinito(ambiente);
}

// Sala della Casa di Carta, dimensionata sullo spazio reale: 18-20 mq, dai quali vanno tolti
// la reception (per il futuro check-in degli host) e l'angolo caffe' con capsule e bicchieri.
// Restano circa 10 mq calpestabili per i tavoli: a 1,2 mq a persona seduta fanno OTTO POSTI,
// cioe' due tavoli da quattro. Metterne di piu' vorrebbe dire disegnare una sala che non esiste.
// Reception e angolo caffe' stanno sulla pianta come ARREDO: si vedono, non si prenotano.
async function creaSalaCarta() {
  const info = await db.prepare("INSERT INTO tavoli_layout (nome,predefinito,ambiente) VALUES (?,1,'carta')").run("Sala 20 mq");
  const id = Number(info.lastInsertRowid);
  const ins = db.prepare("INSERT INTO tavoli (layout_id,numero,posti,forma,x,y,tipo) VALUES (?,?,?,?,?,?,?)");
  await ins.run(id, 1, 4, "quadrato", 33, 58, "standard");
  await ins.run(id, 2, 4, "quadrato", 67, 58, "standard");
  // Arredo fisso: numeri alti per non confondersi coi tavoli.
  await ins.run(id, 90, 0, "rettangolo", 50, 16, "arredo");   // reception / check-in host
  await ins.run(id, 91, 0, "quadrato", 12, 86, "arredo");     // angolo caffe'
  return await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(id);
}

// Platea di partenza: file numerate, poltrone standard davanti e una fila di posti EXTRA in
// fondo, che si aprono solo quando gli standard sono esauriti.
// La platea si dimensiona sul PRIMO turno del Garden: il secondo turno cena mentre lo
// spettacolo e' in corso, quindi non puo' occupare due posti nello stesso momento.
// La prima fila e' degli over 70. Nelle file successive Garden e solo-spettacolo si alternano
// (4 e 2), perche' chi non cena non deve finire sistematicamente in fondo.
async function creaPlateaIniziale() {
  const perGarden = Math.max(1, Number(await par("stage_posti_standard")) || 48);
  const extra = Math.max(0, Number(await par("stage_posti_extra_n")) || 0);
  const primaFila = Math.max(0, Number(await par("stage_prima_fila_over70")) || 0);
  const bloccoG = Math.max(1, Number(await par("stage_blocco_garden")) || 4);
  const bloccoS = Math.max(0, Number(await par("stage_blocco_spettacolo")) || 2);
  const info = await db.prepare("INSERT INTO tavoli_layout (nome,predefinito,ambiente) VALUES (?,1,'stage')").run("Platea");
  const id = Number(info.lastInsertRowid);
  const perFila = 10;
  const ins = db.prepare("INSERT INTO tavoli (layout_id,numero,posti,forma,x,y,tipo,quota) VALUES (?,?,?,?,?,?,?,?)");
  await ins.run(id, 99, 0, "rettangolo", 50, 8, "arredo", null);   // il palco

  // Sequenza delle destinazioni: prima fila over 70, poi l'alternanza, poi gli extra in fondo.
  const seq = [];
  for (let i = 0; i < primaFila; i++) seq.push({ tipo: "standard", quota: "over70" });
  let g = 0;
  while (g < perGarden) {
    for (let i = 0; i < bloccoG && g < perGarden; i++, g++) seq.push({ tipo: "standard", quota: "garden" });
    for (let i = 0; i < bloccoS; i++) seq.push({ tipo: "standard", quota: "spettacolo" });
  }
  for (let i = 0; i < extra; i++) seq.push({ tipo: "extra", quota: "spettacolo" });

  const file = Math.ceil(seq.length / perFila);
  for (let i = 0; i < seq.length; i++) {
    const col = i % perFila, fila = Math.floor(i / perFila);
    const x = ((col + 1) / (perFila + 1)) * 100;
    const y = 22 + (fila / Math.max(1, file - 1)) * 70;
    await ins.run(id, i + 1, 1, "quadrato", Number(x.toFixed(1)), Number(y.toFixed(1)), seq[i].tipo, seq[i].quota);
  }
  return await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(id);
}

async function tavoliDi(layoutId) {
  const rows = await db.prepare("SELECT * FROM tavoli WHERE layout_id=? ORDER BY numero").all(layoutId);
  return rows.map((t) => ({ ...t, uniti: parseNumeri(t.uniti) }));
}

function parseNumeri(v) {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch (_) {
    return [];
  }
}

// Mappa "numero scritto sul QR o sulla comanda" -> "tavolo che lo serve davvero".
// Serve perche' un tavolo assorbito da un'unione non esiste piu' in sala, ma il suo numero
// continua a circolare sui QR gia' stampati e sulle comande gia' aperte.
async function mappaTavoli(data) {
  const layout = await layoutDelGiorno(data);
  const tav = await tavoliDi(layout.id);
  const verso = /* @__PURE__ */ new Map();
  // Solo i tavoli davvero in sala puntano a se stessi; i numeri assorbiti da un'unione
  // puntano al tavolo che li ha assorbiti. L'ordine conta: le unioni vengono per ultime.
  for (const t of tav) if (t.attivo !== 0) verso.set(t.numero, t.numero);
  for (const t of tav) if (t.attivo !== 0) for (const n of t.uniti) verso.set(n, t.numero);
  return { layout, tavoli: tav, verso };
}

// Distanza dal baricentro dei tavoli attivi: e' questo che definisce "centro" e "periferia",
// cosi' la regola vale con qualunque disposizione, anche non simmetrica.
function conDistanza(tavoli) {
  // L'arredo (reception, angolo caffe') sta sulla pianta ma non e' un posto: non si assegna.
  const att = tavoli.filter((t) => t.attivo !== 0 && (t.tipo || "standard") !== "arredo");
  if (!att.length) return [];
  const cx = att.reduce((s, t) => s + Number(t.x), 0) / att.length;
  const cy = att.reduce((s, t) => s + Number(t.y), 0) / att.length;
  return att.map((t) => ({
    ...t,
    distanza: Math.round(Math.hypot(Number(t.x) - cx, Number(t.y) - cy) * 100) / 100
  })).sort((a, b) => a.distanza - b.distanza || a.numero - b.numero);
}

async function prenotazioniDi(data, turno, ambiente = "garden") {
  const q = turno
    ? await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE data=? AND turno=? AND ambiente=? AND stato='prenotato' ORDER BY id").all(data, turno, ambiente)
    : await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE data=? AND ambiente=? AND stato='prenotato' ORDER BY turno,id").all(data, ambiente);
  return q.map((p) => ({ ...p, tavoli: parseTavoli(p.tavoli) }));
}

function parseTavoli(v) {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch (_) {
    return [];
  }
}

// Quadro di un turno: ogni tavolo con la sua distanza dal centro e chi lo occupa.
async function statoTurno(data, turno, ambiente = "garden", layoutId = null) {
  const layout = layoutId
    ? await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(layoutId) || await layoutDelGiorno(data, ambiente)
    : await layoutDelGiorno(data, ambiente);
  const tav = conDistanza(await tavoliDi(layout.id));
  const pren = await prenotazioniDi(data, turno, ambiente);
  // Nei turni condivisi (il coworking) un tavolo ospita piu' prenotazioni finche' ci sono
  // sedie: assegnare l'intero tavolo a chi e' solo sprecherebbe tre posti su quattro.
  const condiviso = ambiente === "carta" && scopoTurno(turno) === "coworking";
  const occupanti = /* @__PURE__ */ new Map();
  const sedute = /* @__PURE__ */ new Map();
  for (const p of pren) {
    for (const n of p.tavoli) {
      if (!occupanti.has(n)) occupanti.set(n, p);
      sedute.set(n, (sedute.get(n) || 0) + (condiviso ? Number(p.persone || 1) : 0));
    }
  }
  const tavoli = tav.map((t) => {
    const p = occupanti.get(t.numero);
    const usati = condiviso ? Math.min(Number(t.posti), sedute.get(t.numero) || 0) : (p ? Number(t.posti) : 0);
    return {
      numero: t.numero, posti: t.posti, forma: t.forma, x: t.x, y: t.y, distanza: t.distanza,
      tipo: t.tipo || "standard",
      quota: t.quota || null,
      uniti: t.uniti || [],
      posti_base: t.posti_base == null ? null : Number(t.posti_base),
      posti_usati: usati,
      posti_liberi: Math.max(0, Number(t.posti) - usati),
      condiviso,
      libero: condiviso ? usati < Number(t.posti) : !p,
      prenotazione_id: p ? p.id : null,
      nome: p ? p.nome || "" : "",
      persone: p ? p.persone : null,
      origine: p ? p.origine : null
    };
  });
  const postiTot = tavoli.reduce((s, t) => s + Number(t.posti), 0);
  const postiOcc = tavoli.reduce((s, t) => s + Number(t.posti_usati || 0), 0);
  // L'arredo non e' un posto, ma sulla pianta si deve vedere: si aggiunge in coda, inerte.
  const arredi = (await tavoliDi(layout.id)).filter((x) => (x.tipo || "standard") === "arredo").map((x) => ({
    numero: x.numero, posti: 0, forma: x.forma, x: x.x, y: x.y, distanza: 999,
    tipo: "arredo", quota: null, uniti: [], posti_usati: 0, posti_liberi: 0, condiviso: false,
    libero: true, prenotazione_id: null, nome: "", persone: null, origine: null
  }));
  tavoli.push(...arredi);
  const std = tavoli.filter((t) => t.tipo !== "extra" && t.tipo !== "arredo");
  return {
    layout: { id: layout.id, nome: layout.nome, ambiente: layout.ambiente || "garden" },
    data, turno, ambiente,
    condiviso,
    standard_liberi: std.reduce((s2, t) => s2 + Number(t.posti_liberi || 0), 0),
    tavoli,
    prenotazioni: pren,
    posti_totali: postiTot,
    posti_occupati: postiOcc,
    posti_liberi: postiTot - postiOcc,
    coperti_prenotati: pren.reduce((s, p) => s + Number(p.persone || 0), 0),
    posti_persi_unione: Number(await par("tavoli_posti_persi_unione")) || 0,
    ...(await comeVaLaSerata(postiTot, pren))
  };
}

// COM'E' LA SERATA, in una parola. Non e' un vezzo: e' la regola che dice a chi accoglie quanto
// puo' essere generoso accostando i tavoli. Con la sala mezza vuota si allarga una tavolata su
// tre tavoli e stanno comodi; con la sala piena si usa il minimo indispensabile, altrimenti si
// brucia la capienza per chi arriva dopo. Le soglie sono parametri: le sposta il gestore.
// CI STA DAVVERO? La pianta e' disegnata in percentuali: un tavolo in piu' ci entra sempre,
// perche' le percentuali non hanno un limite fisico. La realta' si', e la scopri la sera in cui
// due camerieri non riescono a passare fra i tavoli con i vassoi.
//
// Qui la pianta viene riportata in METRI, usando le misure vere della sala prese col metro, e
// si controllano tre cose: che ogni tavolo stia dentro il perimetro, che fra due tavoli ci
// passi una persona con un vassoio, e quanti tavoli ci starebbero al massimo.
// CHE ORA E' IN RESIDENCE. Il server sta su un fuso qualsiasi (su Render e' UTC), il Garden
// sta in Sicilia: due ore di scarto, che su una fascia oraria fanno la differenza fra "si puo'
// ancora prenotare" e "sono le nove di sera". Si guarda sempre l'ora di casa.
function adessoInSicilia() {
  const f = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const v = Object.fromEntries(f.map((x) => [x.type, x.value]));
  return { data: `${v.year}-${v.month}-${v.day}`, minuti: Number(v.hour) * 60 + Number(v.minute) };
}

// Una fascia e' gia' FINITA? Serve a non offrire alle nove di sera il campo delle quattro.
function fasciaPassata(data, slot, durataMin = 60) {
  const ora = adessoInSicilia();
  if (data < ora.data) return true;
  if (data > ora.data) return false;
  const [h, m] = String(slot).split(":").map(Number);
  return (h * 60 + (m || 0) + durataMin) <= ora.minuti;
}

// Una fascia e' gia' COMINCIATA? Dall'app non si prenota l'ora in corso, e non e' pignoleria:
// la scadenza del numero legale sta mezz'ora PRIMA dell'inizio, quindi una prenotazione fatta a
// partita gia' iniziata nasce con la scadenza alle spalle. Il socio leggeva "Fatto!", e dieci
// minuti dopo la prenotazione era svanita senza che nessuno gli avesse detto niente.
// Chi e' li' di persona la chiede al banco, dove la crew la assegna e la vede.
function fasciaIniziata(data, slot) {
  const ora = adessoInSicilia();
  if (data < ora.data) return true;
  if (data > ora.data) return false;
  const [h, m] = String(slot).split(":").map(Number);
  return (h * 60 + (m || 0)) <= ora.minuti;
}

// Quando scade il numero legale per una fascia, e se e' gia' scaduta adesso.
function scadenzaGiaPassata(data, slot, minutiPrima) {
  const ora = adessoInSicilia();
  if (data > ora.data) return false;
  if (data < ora.data) return true;
  const [h, m] = String(slot).split(":").map(Number);
  return (h * 60 + (m || 0) - Number(minutiPrima || 0)) <= ora.minuti;
}

async function verificaSpazio(ambiente = "garden") {
  // Ogni ambiente ha le SUE misure e i suoi ingombri. La platea dello Stage non e' il Garden:
  // una sedia in fila occupa mezzo metro, un tavolo con quattro persone intorno ne occupa due.
  // Usare gli stessi numeri per tutti dava un verdetto che non voleva dire niente.
  const perAmbiente = {
    garden: { L: "garden_larghezza_m", P: "garden_profondita_m", ing: "garden_ingombro_tavolo_m", cor: "garden_corridoio_m", cosa: "tavolo", cose: "tavoli" },
    carta:  { L: "garden_larghezza_m", P: "garden_profondita_m", ing: "garden_ingombro_tavolo_m", cor: "garden_corridoio_m", cosa: "tavolo", cose: "tavoli" },
    stage:  { L: "stage_larghezza_m", P: "stage_profondita_m", ing: "stage_ingombro_seduta_m", cor: "stage_passo_fila_m", cosa: "seduta", cose: "sedute" }
  };
  const cfg = perAmbiente[ambiente] || perAmbiente.garden;
  const L = Number(await par(cfg.L)) || 0;
  const P = Number(await par(cfg.P)) || 0;
  const ing = Number(await par(cfg.ing)) || 2;
  const cor = Number(await par(cfg.cor)) || 0.9;
  if (!L || !P) return { misure_mancanti: true };

  const layout = await layoutPredefinito(ambiente);
  // L'arredo — il palco, il bancone, una pianta — sta sulla pianta ma non e' un posto: contarlo
  // faceva risultare 67 sedute dove la testata ne diceva 66, e chiedeva spazio per un tavolo
  // che nessuno deve raggiungere con un vassoio.
  const tav = (await tavoliDi(layout.id)).filter((t) => Number(t.attivo) !== 0 && (t.tipo || "standard") !== "arredo");
  // Dalla percentuale ai metri: la pianta usa 0-100 sui due lati.
  const inMetri = tav.map((t) => ({
    numero: t.numero,
    posti: Number(t.posti),
    // Una tavolata di piu' tavoli occupa piu' spazio in larghezza: si allunga, non si allarga.
    larghezza: ing * (1 + (Array.isArray(t.uniti) ? t.uniti.length : 0)),
    profondita: ing,
    x: (Number(t.x) / 100) * L,
    y: (Number(t.y) / 100) * P
  }));

  const fuori = [];
  for (const t of inMetri) {
    const mezzaL = t.larghezza / 2, mezzaP = t.profondita / 2;
    // Un centimetro di tolleranza: le coordinate sono percentuali arrotondate al decimo, e
    // senza margine un tavolo appoggiato al muro risultava "fuori" per tre millimetri.
    const eps = 0.01;
    if (t.x - mezzaL < -eps || t.x + mezzaL > L + eps || t.y - mezzaP < -eps || t.y + mezzaP > P + eps) fuori.push(t.numero);
  }
  // Troppo vicini: fra i bordi di due tavoli deve passarci il corridoio.
  const vicini = [];
  for (let i = 0; i < inMetri.length; i++) {
    for (let j = i + 1; j < inMetri.length; j++) {
      const a = inMetri[i], b = inMetri[j];
      const dx = Math.abs(a.x - b.x) - (a.larghezza + b.larghezza) / 2;
      const dy = Math.abs(a.y - b.y) - (a.profondita + b.profondita) / 2;
      // Basta che passi da un lato: se sono sfalsati in profondita', il corridoio c'e'.
      const luce = Math.max(dx, dy);
      if (luce < cor - 0.01) vicini.push({ a: a.numero, b: b.numero, luce: Number(luce.toFixed(2)) });
    }
  }

  // Quanti ce ne starebbero: ogni tavolo si porta dietro meta' corridoio per lato.
  const passo = ing + cor;
  const perFila = Math.floor((L + cor) / passo);
  const file = Math.floor((P + cor) / passo);
  const capienzaTeorica = Math.max(0, perFila * file);
  const postiTeorici = ambiente === "stage" ? capienzaTeorica : capienzaTeorica * (Number(await par("garden_posti_per_tavolo")) || 4);

  // DUE DOMANDE DIVERSE, e prima venivano confuse in una sola risposta: "ce ne stanno 16" e
  // "non ci sta" sembravano contraddirsi. Non lo erano — lo spazio bastava, era la DISPOSIZIONE
  // a essere sbagliata — ma chi legge non deve fare questo ragionamento da solo.
  //   1. Lo SPAZIO basta?      quanti tavoli entrano in quei metri quadri
  //   2. Come li hai MESSI?    i tavoli disegnati rispettano i passaggi?
  const spazioBasta = tav.length <= capienzaTeorica;
  const disposizioneOk = !fuori.length && !vicini.length;
  const problemi = [];
  if (fuori.length) problemi.push(`${fuori.length} ${fuori.length === 1 ? cfg.cosa + " esce" : cfg.cose + " escono"} dal perimetro (${fuori.join(", ")}).`);
  if (vicini.length) problemi.push(ambiente === "stage"
      ? `Fra ${vicini.length} coppie di sedute non si passa: fra le file servono ${cor} m, ce ne sono meno.`
      : `Fra ${vicini.length} coppie di tavoli non passa un cameriere con il vassoio: servono ${cor} m, ce ne sono meno.`);
  if (!spazioBasta) problemi.push(`Hai disegnato ${tav.length} ${cfg.cose} ma in ${L}\u00d7${P} m ce ne stanno ${capienzaTeorica} rispettando i passaggi.`);

  return {
    sala: { larghezza_m: L, profondita_m: P, mq: Number((L * P).toFixed(1)) },
    ambiente,
    cosa: cfg.cose,
    regole: { ingombro_tavolo_m: ing, corridoio_m: cor },
    disegnati: tav.length,
    posti_disegnati: tav.reduce((s2, t) => s2 + Number(t.posti), 0),
    capienza_teorica: capienzaTeorica,
    posti_teorici: postiTeorici,
    mq_per_coperto: tav.length ? Number((L * P / Math.max(1, tav.reduce((s2, t) => s2 + Number(t.posti), 0))).toFixed(2)) : null,
    fuori_perimetro: fuori,
    troppo_vicini: vicini.slice(0, 12),
    problemi,
    spazio_basta: spazioBasta,
    disposizione_ok: disposizioneOk,
    // Il verdetto in una frase, che dice anche COSA fare. "Non ci sta" da solo non serviva a
    // niente: bisognava capire se il problema era la sala o il disegno.
    verdetto: !spazioBasta
      ? "lo spazio non basta"
      : disposizioneOk
        ? "ci sta"
        : "lo spazio basta, la disposizione no",
    cosa_fare: !spazioBasta
      ? `In ${L}\u00d7${P} m ci stanno ${capienzaTeorica} ${cfg.cose}, non ${tav.length}. Togline ${tav.length - capienzaTeorica}, oppure accorcia i passaggi o l'ingombro nei parametri se la tua sala e' fatta diversamente.`
      : disposizioneOk
        ? null
        : `Lo spazio ci sarebbe (ce ne stanno ${capienzaTeorica} ${cfg.cose}), ma cosi' come ${cfg.cose === "sedute" ? "le" : "li"} hai ${cfg.cose === "sedute" ? "messe" : "messi"} non ci si passa. Allontana${cfg.cose === "sedute" ? "le" : "li"} fra loro, oppure usa \u201cRipristina predefinita\u201d, che ${cfg.cose === "sedute" ? "le dispone" : "li dispone"} gia' rispettando i passaggi.`
  };
}

async function comeVaLaSerata(postiTot, pren) {
  const coperti = pren.reduce((s, p) => s + Number(p.persone || 0), 0);
  const pieno = postiTot > 0 ? Math.round((coperti / postiTot) * 100) : 0;
  const buona = Number(await par("sala_soglia_buona"));
  const difficile = Number(await par("sala_soglia_difficile"));
  const livello = pieno >= difficile ? "difficile" : pieno >= buona ? "buona" : "facile";
  return {
    serata: {
      pieno,
      livello,
      etichetta: livello === "difficile" ? "Difficile" : livello === "buona" ? "Buona" : "Facile",
      // Quanti tavoli si possono accostare per una tavolata numerosa.
      max_tavoli_uniti: livello === "difficile" ? 2 : 3,
      consiglio: livello === "difficile"
        ? "Sala quasi piena: accosta il minimo indispensabile, ogni tavolo in piu' toglie posti a chi arriva."
        : livello === "buona"
          ? "Sala che si riempie: accosta con misura, tieni qualche tavolo libero per chi arriva senza prenotazione."
          : "C'e' spazio: puoi allargare una tavolata su piu' tavoli e farli stare comodi."
    }
  };
}

// Assegnazione: si parte dal tavolo piu' vicino al centro fra quelli liberi.
// Se nessun singolo tavolo basta, si accorpano i piu' vicini finche' i posti coprono il gruppo:
// e' la stessa regola, applicata a un gruppo che non entra in un tavolo solo.
// Ordine di assegnazione in platea, secondo la regola concordata:
//   · over 70 → prima fila finche' c'e' posto, poi la quota della loro categoria
//   · chi ha cenato al primo turno → sedute "garden"
//   · chi viene solo per lo spettacolo → sedute "spettacolo", poi gli extra
// Nessuno resta sistematicamente in fondo, perche' le due quote si alternano per fila.
function assegnaPlatea(liberi, persone, { categoria = "spettacolo", over70 = false, extraAmmessi = true } = {}) {
  const perQuota = (q) => liberi.filter((t) => (t.quota || "spettacolo") === q && (t.tipo !== "extra"))
    .sort((a, b) => a.distanza - b.distanza || a.numero - b.numero);
  const extra = extraAmmessi ? liberi.filter((t) => t.tipo === "extra").sort((a, b) => a.numero - b.numero) : [];
  // La quota e' una PRECEDENZA, non un lucchetto: quando la propria si esaurisce si passa
  // all'altra, altrimenti si direbbe "al completo" con mezza platea vuota. Gli extra restano
  // per ultimi, come previsto.
  let ordine;
  if (categoria === "cena") {
    ordine = [...perQuota("garden"), ...perQuota("spettacolo"), ...perQuota("over70"), ...extra];
  } else if (over70) {
    ordine = [...perQuota("over70"), ...perQuota("spettacolo"), ...perQuota("garden"), ...extra];
  } else {
    ordine = [...perQuota("spettacolo"), ...perQuota("over70"), ...perQuota("garden"), ...extra];
  }
  const scelti = [];
  for (const t of ordine) {
    if (scelti.length >= persone) break;
    scelti.push(t.numero);
  }
  return scelti.length >= persone ? scelti : null;
}

// Coworking: si occupano le SEDIE. Si riempie prima un tavolo gia' avviato — si lavora
// meglio in compagnia e non si spezzetta la sala — poi si passa al successivo.
function assegnaPosti(tavoli, persone) {
  const disponibili = tavoli.filter((t) => (t.posti_liberi || 0) > 0)
    .sort((a, b) => (b.posti_usati || 0) - (a.posti_usati || 0) || a.distanza - b.distanza);
  for (const t of disponibili) if ((t.posti_liberi || 0) >= persone) return [t.numero];
  return null;   // niente gruppi spezzati su piu' tavoli: si dice che non c'e' posto
}

function assegnaTavoli(tavoliLiberi, persone, extraAmmessi = true) {
  // I posti "extra" sono l'ultima risorsa: si aprono solo quando gli standard sono finiti.
  const standard = tavoliLiberi.filter((t) => (t.tipo || "standard") !== "extra");
  const extra = extraAmmessi ? tavoliLiberi.filter((t) => (t.tipo || "standard") === "extra") : [];
  const capStandard = standard.reduce((s2, t) => s2 + Number(t.posti), 0);
  const disponibili = capStandard >= persone ? standard : [...standard, ...extra];
  const ord = [...disponibili].sort((a, b) => a.distanza - b.distanza || a.numero - b.numero);
  // 1. il tavolo piu' centrale che contiene il gruppo senza sprecare troppi posti
  const adatti = ord.filter((t) => Number(t.posti) >= persone);
  if (adatti.length) {
    const minPosti = Math.min(...adatti.map((t) => Number(t.posti)));
    const stretti = adatti.filter((t) => Number(t.posti) === minPosti);
    return [stretti[0].numero];
  }
  // 2. accorpamento dal centro verso l'esterno
  const scelti = [];
  let somma = 0;
  for (const t of ord) {
    scelti.push(t.numero);
    somma += Number(t.posti);
    if (somma >= persone) return scelti;
  }
  return null;
}

async function prenotaTavolo({ data, turno, persone, socio, tessera_code, nome, origine, note, tavoli: forzati, ambiente = "garden", proiezione_id = null, layout_id = null, categoria = "spettacolo", over70 = false, scopo = null }) {
  if (ambiente === "garden" || ambiente === "carta") {
    const t = await turni(ambiente);
    if (!t.includes(turno)) return { error: `Turno non valido (${t.join(" o ")})` };
  }
  const n = Math.max(1, Number(persone) || 1);
  const stato = await statoTurno(data, turno, ambiente, layout_id);
  let numeri = Array.isArray(forzati) && forzati.length ? forzati.map(Number) : null;
  if (numeri) {
    const occupati = numeri.filter((x) => !stato.tavoli.find((tt) => tt.numero === x && tt.libero));
    if (occupati.length) return { error: `Tavoli gi\u00e0 occupati: ${occupati.join(", ")}` };
  } else {
    const extraAmmessi = ambiente !== "stage" || await par("cinema_posti_extra") !== false;
    if (ambiente === "stage") {
      numeri = assegnaPlatea(stato.tavoli.filter((x) => x.libero && x.tipo !== "arredo"), n, { categoria, over70, extraAmmessi });
    } else if (stato.condiviso) {
      numeri = assegnaPosti(stato.tavoli.filter((x) => x.tipo !== "arredo"), n);
    } else {
      numeri = assegnaTavoli(stato.tavoli.filter((x) => x.libero), n, extraAmmessi);
    }
    if (!numeri) {
      return { error: ambiente === "stage" ? "Non ci sono abbastanza posti liberi per questa proiezione" : `Non ci sono abbastanza posti liberi nel turno delle ${turno}` };
    }
  }
  const info = await db.prepare(
    "INSERT INTO prenotazioni_tavolo (data,turno,persone,tavoli,socio_id,tessera_code,nome,origine,note,ambiente,proiezione_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).run(data, turno, n, JSON.stringify(numeri), socio?.id ?? null, tessera_code || null, nome || null, origine === "crew" ? "crew" : "app", note || null, ambiente, proiezione_id);
  if (scopo) await db.prepare("UPDATE prenotazioni_tavolo SET scopo=? WHERE id=?").run(scopo, Number(info.lastInsertRowid));
  const usaExtra = numeri.some((x) => (stato.tavoli.find((t) => t.numero === x) || {}).tipo === "extra");
  return { id: Number(info.lastInsertRowid), tavoli: numeri, persone: n, turno, data, ambiente, extra: usaExtra };
}

// Turno successivo all'orario indicato: serve alla Crew che prenota al banco su richiesta.
async function turnoSuccessivo(ora) {
  const t = await turni();
  const hhmm = String(ora || "").slice(0, 5);
  for (const x of t) if (x > hhmm) return x;
  return null;
}

export {
  adessoInSicilia, fasciaIniziata, fasciaPassata, scadenzaGiaPassata, verificaSpazio,
  assegnaPlatea, assegnaPosti, assegnaTavoli, conDistanza, etichettaTurno, layoutDelGiorno, layoutPredefinito, mappaTavoli, parseNumeri, parseTavoli,
  prenotaTavolo, prenotazioniDi, scopoTurno, statoTurno, tavoliDi, turni, turnoSuccessivo
};

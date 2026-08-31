import { Router } from "express";
import { asyncify } from '../asyncroute.js';
import { alboCasate, campioneInCarica, conPosizioni } from '../coppa.js';
import { fasciaIniziata, fasciaPassata, scadenzaGiaPassata, etichettaTurno, prenotaTavolo, scopoTurno, statoTurno, turni } from '../tavoli.js';
import { par } from '../parametri.js';
import { prenotaSeduta, sedute as seduteFitness } from '../fitness.js';
import { audit, db } from '../db.js';
import { publicKey, pushEnabled, sendToSocio } from '../push.js';
import { avvisoRitiro, primoRitiro } from '../cucina.js';
import { condimentiAmmessi, daOrdinare, eAlcolico, eCondimento, quantoCostaCondire } from '../menu.js';
import { registra } from '../registro.js';
import { prezzoPrenotazione } from '../tariffe.js';
import { fasceOggi, prendi as prendiOmbrellone, rilascia as rilasciaOmbrellone, situazione as situazionePiazzola } from '../spiaggia.js';
import { etaMin, pressione, statoCompleto } from '../selforder.js';

var publicRouter = asyncify(Router());
publicRouter.get("/self-order/stato", async (req, res) => {
  const s = await statoCompleto();
  res.json({ aperto: s.aperto, ordinabile: s.ordinabile, sospeso_pressione: s.sospeso_pressione, pressione: s.pressione, eta_min: s.eta_min });
});
publicRouter.get("/casate", async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,colore,motto,punti FROM casate").all();
  // La casata campione dell'ultima stagione chiusa porta il simbolo del residence.
  const camp = await campioneInCarica();
  // La posizione arriva dal server, cosi' l'app non deve ricalcolarla: a parita' di
  // punteggio le casate condividono lo stesso indice (1, 1, 3...).
  res.json(conPosizioni(rows).map((c) => ({
    ...c,
    campione: !!(camp && (camp.casata_id === c.id || camp.casata_nome === c.nome)),
    campione_stagione: camp && (camp.casata_id === c.id || camp.casata_nome === c.nome) ? camp.stagione : null
  })));
});
// Albo d'Oro delle casate, visibile ai soci.
publicRouter.get("/albo-casate", async (req, res) => {
  res.json({ albo: await alboCasate(), campione: await campioneInCarica() });
});
publicRouter.get("/menu", async (req, res) => {
  // ?zona=bar|garden restituisce il menu di quel punto piu' le voci comuni a entrambi:
  // Bar e Garden hanno referenze diverse, non gli stessi prodotti a due prezzi.
  // Una sola porta: il menu' lo decide server/menu.js, uguale per app, QR, Crew e stampa.
  const { voci } = await daOrdinare({ zona: String(req.query.zona || "") });
  res.json(voci);
});
// La zona si deduce dal punto: un ordine del Bar non deve finire sui tavoli del Garden.
// Era scritta a mano come "garden" per tutti, ed e' il motivo per cui una comanda del bar
// compariva nella mappa tavoli.
function zonaDaPunto(punto) {
  const p = String(punto || "").toLowerCase();
  if (p.includes("bar")) return "bar";
  if (p.includes("carta")) return "carta";
  if (p.includes("cucina")) return "cucina";
  return "garden";
}
publicRouter.post("/self-order", async (req, res) => {
  const b = req.body || {};
  const st = await statoCompleto();
  if (!st.ordinabile) return res.status(423).json({
    error: st.sospeso_pressione ? "La cucina \xE8 molto impegnata: ordini dal telefono sospesi per pochi minuti. Rivolgiti allo staff o riprova a breve." : "Gli ordini self sono momentaneamente sospesi. Rivolgiti allo staff.",
    sospeso_pressione: st.sospeso_pressione
  });
  const righeIn = Array.isArray(b.righe) ? b.righe.filter((r) => r && r.menu_id && Number(r.qta) > 0) : [];
  if (!righeIn.length) return res.status(400).json({ error: "Aggiungi almeno un prodotto" });
  if (b.tessera_code) {
    const chi = await socioAttivoByTessera(b.tessera_code);
    const no = await bloccoMinorenne(chi, "ordine");
    if (no) return res.status(403).json({ error: no });
  }
  const punto = String(b.punto || "").trim() || "Chiosco";
  const tavolo = b.tavolo ? String(b.tavolo).trim() : null;
  const chi = b.tessera_code ? String(b.tessera_code).trim().toUpperCase() : null;
  const socio = chi ? await db.prepare("SELECT id FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(chi) : null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const numero = (await db.prepare("SELECT COALESCE(MAX(numero),0)+1 n FROM comande WHERE date(created_at)=date('now')").get()).n;
  const info = await db.prepare("INSERT INTO comande (numero,origine,riferimento,punto,canale,zona,stato,totale,operatore,socio_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(numero, "tavolo", tavolo, punto, "self", zonaDaPunto(punto), "aperta", 0, chi || "self", socio ? socio.id : null, b.note || null, now, now);
  const cid = Number(info.lastInsertRowid);
  // Il supplemento condimenti: uno solo per piatto, qualunque sia il numero di spunte.
  const supplemento = quantoCostaCondire(
    (await db.prepare("SELECT * FROM menu_articoli WHERE attivo=1").all()).filter(eCondimento),
    await par("comande_supplemento_complementi"));
  let totale = 0;
  for (const r of righeIn) {
    const m = await db.prepare("SELECT * FROM menu_articoli WHERE id=? AND attivo=1").get(r.menu_id);
    if (!m) continue;
    const qta = Math.max(1, Math.round(Number(r.qta)));
    totale += Number(m.prezzo) * qta;
    const info2 = await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato) VALUES (?,?,?,?,?,?,?, 'in_coda')").run(cid, m.id, m.nome, Number(m.prezzo), qta, m.stazione, r.note || null);
    // Ogni complemento spuntato e' una riga sua, agganciata al piatto: cosi' la cucina la
    // legge sotto il piatto giusto e il magazzino si scarica davvero. Si accettano solo i
    // complementi davvero abbinati a quel prodotto: nessuno puo' aggiungerne altri da fuori.
    const scelti = Array.isArray(r.complementi) ? r.complementi.map(Number).filter(Boolean) : [];
    // Chi puo' avere condimenti, e quali, lo dice il nucleo del menu': nessuno puo' attaccare
    // la maionese a un caffe' spedendo l'ordine a mano.
    const ammessi = scelti.length ? await condimentiAmmessi(m) : [];
    if (ammessi.length) {
      const padre = Number(info2.lastInsertRowid);
      let messi = 0;
      for (const c of ammessi) {
        if (!scelti.includes(Number(c.id))) continue;
        messi++;
        // La riga del condimento vale zero: serve alla cucina per sapere cosa metterci dentro
        // e al magazzino per scalare la maionese. Il prezzo lo fa il supplemento, una volta.
        await db.prepare(
          "INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,parent_riga_id) VALUES (?,?,?,0,?,?,?, 'in_coda', ?)"
        ).run(cid, c.id, c.nome, qta, m.stazione, null, padre);
      }
      // Uno o quattro condimenti costano lo stesso: il supplemento e' del piatto, non dei
      // condimenti. In conto si vede come riga a se', cosi' si capisce da dove viene.
      if (messi && supplemento > 0) {
        totale += supplemento * qta;
        await db.prepare(
          "INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,parent_riga_id) VALUES (?,NULL,?,?,?,?,NULL,'in_coda',?)"
        ).run(cid, "Supplemento condimenti", supplemento, qta, m.stazione, padre);
      }
    }
  }
  // Alcolici: se chi ordina e' identificato e minorenne, non se ne parla. Se non e'
  // identificato — al bar si serve chiunque, la tessera non e' un lasciapassare — l'ordine si
  // prende, ma la comanda parte con l'avviso: l'eta' la verifica chi consegna, guardando in
  // faccia il cliente. Il sistema non puo' farlo e non deve fingere di poterlo.
  const conAlcol = await db.prepare(
    `SELECT 1 x FROM comanda_righe r JOIN menu_articoli m ON m.id = r.menu_id
     WHERE r.comanda_id=? AND m.alcolico=1 LIMIT 1`
  ).get(cid);
  let verificaEta = 0;
  if (conAlcol) {
    if (socio) {
      const blocco = await bloccoMinorenne(socio, "alcolici");
      if (blocco) {
        await db.prepare("DELETE FROM comanda_righe WHERE comanda_id=?").run(cid);
        await db.prepare("DELETE FROM comande WHERE id=?").run(cid);
        return res.status(403).json({ error: blocco });
      }
    } else {
      verificaEta = 1;
      await db.prepare("UPDATE comande SET verifica_eta=1 WHERE id=?").run(cid);
    }
  }

  // Prima dell'apertura della cucina l'ordine si prende lo stesso: si dice solo da che ora
  // si consegna. Chi arriva alle sedici e vuole un panino non deve sentirsi rispondere di no.
  const haCucina = !!(await db.prepare("SELECT 1 x FROM comanda_righe WHERE comanda_id=? AND stazione='cucina' LIMIT 1").get(cid));
  const nonPrima = await primoRitiro(haCucina);
  await db.prepare("UPDATE comande SET totale=?, non_prima=? WHERE id=?").run(totale, nonPrima, cid);
  audit(chi || "self", "self_order", "comande", cid, `${punto}${tavolo ? " \xB7 tav " + tavolo : ""} \xB7 \u20AC${totale}`);
  await registra({
    fatto: "comanda_aperta", servizio: "comande", riferimento: numero,
    socio_id: socio ? socio.id : null,
    intestatario: socio ? [socio.nome, socio.cognome].filter(Boolean).join(" ") : null,
    autore: socio ? [socio.nome, socio.cognome].filter(Boolean).join(" ") : "ospite",
    canale: tavolo ? "qr" : "app", importo: totale,
    dettaglio: { punto, tavolo: tavolo || null, righe: righeIn.length }
  });
  res.status(201).json({
    ok: true, numero, id: cid, totale, punto, tavolo, eta_min: await etaMin(), push: !!socio,
    non_prima: nonPrima, avviso: avvisoRitiro(nonPrima),
    verifica_eta: !!verificaEta,
    avviso_eta: verificaEta ? "Ci sono alcolici: al ritiro ti verr\u00e0 chiesto un documento se dimostri meno di 18 anni." : null
  });
});
publicRouter.get("/push/pubkey", async (req, res) => {
  const { pushEnabled: pushEnabled2, publicKey: publicKey2 } = await import('../push.js');
  res.json({ enabled: pushEnabled2(), key: publicKey2() });
});
// La serata cinema porta con se' il film in programma: nel cartellone settimanale il socio
// legge il titolo, non una descrizione generica sempre uguale.
async function filmDellaSettimana(e) {
  if (e.tipo !== "cinema" && !/cinema/i.test(String(e.titolo || "") + String(e.chiave || ""))) return {};
  const p = await db.prepare(
    "SELECT p.id,p.data,p.ora,f.titolo,f.regia,f.durata_min,f.vm FROM proiezioni p JOIN film f ON f.id=p.film_id WHERE p.stato='programmata' AND p.data>=date('now','-1 day') ORDER BY p.data,p.ora LIMIT 1"
  ).get();
  return p ? { film: { proiezione_id: p.id, titolo: p.titolo, regia: p.regia, durata_min: p.durata_min, vm: p.vm, data: p.data, ora: p.ora } } : {};
}
publicRouter.get("/eventi", async (req, res) => {
  const rows = await db.prepare("SELECT chiave,giorno,titolo,ambiente,colore,sottotitolo,descrizione,cta,azione,tipo,ora_inizio,tipologia,artista,prezzo,costo_tipo,consumazione,serata_id FROM eventi WHERE attivo=1 ORDER BY ordine").all();
  const onerosi = await par("eventi_onerosi");
  const out = [];
  for (const e of rows) {
    // Se gli eventi a pagamento sono spenti nei parametri, l'ingresso e' libero comunque.
    if (!onerosi) { out.push({ ...e, costo: 0, costo_tipo: "nessuno", consumazione: null, ...await filmDellaSettimana(e) }); continue; }
    if (e.costo_tipo === "consumazione") { out.push({ ...e, costo: 0, ...await filmDellaSettimana(e) }); continue; }
    let costo = Number(e.prezzo || 0);
    if (e.serata_id) {
      const s = await db.prepare("SELECT quota FROM serate WHERE id=?").get(e.serata_id);
      if (s && Number(s.quota) > 0) costo = Number(s.quota);
    }
    out.push({ ...e, costo, costo_tipo: costo > 0 ? "prezzo" : "nessuno", ...await filmDellaSettimana(e) });
  }
  res.json(out);
});
publicRouter.get("/risorse", async (req, res) => {
  const rows = (await db.prepare("SELECT chiave,nome,tipo,sottotitolo,slots,nota FROM risorse WHERE attivo=1").all()).map((r) => ({ ...r, slots: r.slots ? JSON.parse(r.slots) : [] }));
  res.json(rows);
});
publicRouter.get("/bussola", async (req, res) => {
  const rows = await db.prepare("SELECT sezione,titolo,dettaglio,distanza,lat,lng,mappa_embed FROM bussola ORDER BY sezione,ordine").all();
  const out = {};
  for (const r of rows) (out[r.sezione] ??= []).push(r);
  res.json(out);
});
publicRouter.get("/contest/corrente", async (req, res) => {
  const c = await db.prepare("SELECT id,titolo,tipo,settimana,brief,stato,vincitore FROM contest WHERE attivo=1 ORDER BY id DESC LIMIT 1").get();
  res.json(c || null);
});
publicRouter.get("/contest", async (req, res) => {
  res.json(await db.prepare("SELECT id,titolo,tipo,settimana,brief,stato,vincitore FROM contest ORDER BY id DESC").all());
});
publicRouter.get("/luoghi", async (req, res) => {
  res.json(await db.prepare("SELECT chiave,nome,lat,lng,mappa_embed FROM luoghi ORDER BY ordine").all());
});
publicRouter.get("/regolamenti", async (req, res) => {
  const generali = await db.prepare("SELECT chiave,titolo,testo FROM regolamenti ORDER BY ordine,id").all();
  const discipline = await db.prepare(`SELECT chiave,nome,dominio,regolamento,data_inizio,data_fine,stato
    FROM discipline WHERE attivo=1 AND regolamento IS NOT NULL AND regolamento<>'' ORDER BY dominio,ordine`).all();
  res.json({ generali, discipline });
});
publicRouter.get("/albo", async (req, res) => {
  res.json(await db.prepare("SELECT disciplina_nome,dominio,data_inizio,data_fine,vincitore,archiviata_at FROM edizioni ORDER BY id DESC LIMIT 100").all());
});
publicRouter.get("/rifiuti", async (req, res) => {
  const tipi = await db.prepare("SELECT id,nome,colore FROM rifiuti_tipi ORDER BY ordine,id").all();
  // In app si vede solo il calendario in corso: i periodi spenti restano nel back office.
  const cal = (await db.prepare("SELECT periodo,inizio_conf,fine_conf,ora_ritiro,giorni FROM rifiuti_calendario WHERE attivo=1 ORDER BY ordine,id").all()).map((c) => ({ ...c, giorni: c.giorni ? JSON.parse(c.giorni) : {} }));
  res.json({ tipi, calendari: cal });
});
var COWO_MAX = 8;
var TAVOLO_MAX_COPERTI = 40;
function periodiDi(turno) {
  const t = (turno || "").toLowerCase();
  if (t.startsWith("giorn")) return ["mattina", "pomeriggio"];
  if (t.startsWith("pomerig")) return ["pomeriggio"];
  return ["mattina"];
}
async function cowoUsati(giorno) {
  const rows = await db.prepare(`SELECT p.turno FROM prenotazioni p JOIN risorse r ON r.id=p.risorsa_id
    WHERE r.tipo='coworking' AND p.stato='confermata' AND p.giorno=?`).all(giorno || "");
  let mattina = 0, pomeriggio = 0;
  for (const r of rows) {
    const ps = periodiDi(r.turno);
    if (ps.includes("mattina")) mattina++;
    if (ps.includes("pomeriggio")) pomeriggio++;
  }
  return { mattina, pomeriggio };
}
publicRouter.get("/coworking/disponibilita", async (req, res) => {
  const u = await cowoUsati(req.query.giorno);
  res.json({
    giorno: req.query.giorno || null,
    max: COWO_MAX,
    mattina: { usati: u.mattina, liberi: Math.max(0, COWO_MAX - u.mattina) },
    pomeriggio: { usati: u.pomeriggio, liberi: Math.max(0, COWO_MAX - u.pomeriggio) }
  });
});
async function seratePostiUsati(serataId) {
  return (await db.prepare("SELECT COALESCE(SUM(persone),0) n FROM serate_prenotazioni WHERE serata_id=? AND stato!='annullata'").get(serataId)).n;
}
publicRouter.get("/serate", async (req, res) => {
  const rows = await db.prepare("SELECT id,chiave,titolo,data,quando,tema,descrizione,quota,capienza FROM serate WHERE attivo=1 ORDER BY ordine,data").all();
  const out = [];
  for (const s of rows) {
    const usati = await seratePostiUsati(s.id);
    out.push({ ...s, posti_liberi: Math.max(0, s.capienza - usati) });
  }
  res.json(out);
});
publicRouter.post("/serate/:id/prenota", async (req, res) => {
  const s = await db.prepare("SELECT * FROM serate WHERE id=? AND attivo=1").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Serata non trovata" });
  const persone = Math.max(1, Number(req.body?.persone) || 1);
  const usati = await seratePostiUsati(s.id);
  if (usati + persone > s.capienza) return res.status(409).json({ ok: false, error: `Posti esauriti: restano ${Math.max(0, s.capienza - usati)} coperti.`, posti_liberi: Math.max(0, s.capienza - usati) });
  const tessera = req.body?.tessera_code || null;
  const socio = tessera ? await db.prepare("SELECT id,nome,cognome,data_nascita FROM soci WHERE tessera_code=?").get(tessera) : null;
  const noMin = await bloccoMinorenne(socio, "serata");
  if (noMin) return res.status(403).json({ error: noMin });
  const nome = req.body?.nome || (socio ? `${socio.nome} ${socio.cognome || ""}`.trim() : "Ospite");
  const importo = Math.round(s.quota * persone * 100) / 100;
  const info = await db.prepare("INSERT INTO serate_prenotazioni (serata_id,socio_id,tessera_code,nome,persone,importo,stato) VALUES (?,?,?,?,?,?,?)").run(s.id, socio?.id ?? null, tessera, nome, persone, importo, "da_saldare");
  audit(tessera || "ospite", "prenota_serata", "serate", s.id, `${persone}p \xB7 \u20AC${importo}`);
  res.status(201).json({ ok: true, id: info.lastInsertRowid, importo, persone, stato: "da_saldare", titolo: s.titolo });
});
publicRouter.get("/discipline/:dominio", async (req, res) => {
  const dominio = req.params.dominio === "giochi" ? "giochi" : "sport";
  const discs = await db.prepare("SELECT id,chiave,nome,min_giocatori,max_giocatori FROM discipline WHERE dominio=? AND attivo=1 ORDER BY ordine").all(dominio);
  const out = [];
  for (const d of discs) {
    const gironiRows = await db.prepare("SELECT id,nome FROM gironi WHERE disciplina_id=? ORDER BY nome").all(d.id);
    const gironi = [];
    for (const g of gironiRows) {
      gironi.push({
        nome: g.nome,
        rows: await db.prepare(`SELECT c.nome AS t, c.colore AS c, cl.pg, cl.v, cl.pt
                        FROM classifica cl JOIN casate c ON c.id=cl.casata_id
                        WHERE cl.girone_id=? ORDER BY cl.pt DESC, (cl.gf-cl.gs) DESC, cl.gf DESC, c.nome`).all(g.id)
      });
    }
    const next = await db.prepare("SELECT casa_a a,casa_b b,('G'||giornata) wh,luogo court FROM partite WHERE disciplina_id=? AND stato='da_giocare' ORDER BY giornata,id LIMIT 6").all(d.id);
    const results = await db.prepare("SELECT casa_a a,casa_b b,punteggio s FROM partite WHERE disciplina_id=? AND stato='giocata' ORDER BY id DESC LIMIT 6").all(d.id);
    out.push({ chiave: d.chiave, name: d.nome, min: d.min_giocatori, max: d.max_giocatori, gironi, next, results });
  }
  res.json(out);
});
publicRouter.get("/tessera/:code", async (req, res) => {
  const s = await db.prepare(`SELECT so.tessera_code,so.nome,so.cognome,so.ruolo,so.tipo_profilo,so.dinieghi,so.notifiche_push,so.valida_fino,so.host,so.struttura_id,so.data_nascita,so.emergenza_nome,so.emergenza_tel,c.nome AS casata,c.colore
                        FROM soci so LEFT JOIN casate c ON c.id=so.casata_id
                        WHERE so.tessera_code=? AND so.attivo=1`).get(req.params.code);
  if (!s) return res.status(404).json({ error: "Tessera non trovata" });
  // L'eta', non la data di nascita: all'app serve solo sapere se accendere il modo semplice
  // e se spetta la prima fila, non il giorno del compleanno.
  s.eta = etaDi(s);
  delete s.data_nascita;
  s.is_host = s.host ? 1 : 0;
  s.ha_casa = s.struttura_id ? 1 : 0;
  delete s.struttura_id;
  res.json(s);
});
publicRouter.get("/convocazioni/:code", async (req, res) => {
  const socio = await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(req.params.code);
  if (!socio) return res.json([]);
  const rows = await db.prepare(`SELECT cv.id,cv.match_label,cv.quando,cv.luogo,cv.stato,d.nome disciplina,d.dominio
                           FROM convocazioni cv JOIN discipline d ON d.id=cv.disciplina_id
                           WHERE cv.socio_id=? ORDER BY cv.created_at DESC`).all(socio.id);
  res.json(rows);
});
publicRouter.post("/prenotazioni", async (req, res) => {
  const { tessera_code, risorsa, giorno, turno, ospiti } = req.body || {};
  const socio = tessera_code ? await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(tessera_code) : null;
  const ris = risorsa ? await db.prepare("SELECT id,nome,tipo FROM risorse WHERE chiave=?").get(risorsa) : null;
  if (ris?.tipo === "coworking") {
    const u = await cowoUsati(giorno);
    const richiesti = periodiDi(turno);
    const pieno = richiesti.filter((p) => (u[p] || 0) >= COWO_MAX);
    if (pieno.length) {
      return res.status(409).json({
        ok: false,
        error: `Coworking al completo (${pieno.join(" e ")}): max ${COWO_MAX} posti per turno.`,
        disponibilita: { mattina: Math.max(0, COWO_MAX - u.mattina), pomeriggio: Math.max(0, COWO_MAX - u.pomeriggio) }
      });
    }
  }
  if (ris?.tipo === "tavolo") {
    const persone = Math.max(1, Number(req.body?.persone || ospiti) || 1);
    const usati = (await db.prepare(`SELECT COALESCE(SUM(CASE WHEN ospiti>0 THEN ospiti ELSE 1 END),0) n FROM prenotazioni p JOIN risorse r ON r.id=p.risorsa_id
      WHERE r.tipo='tavolo' AND p.stato='confermata' AND p.giorno=? AND p.turno=?`).get(giorno || "", turno || "")).n;
    if (usati + persone > TAVOLO_MAX_COPERTI) {
      return res.status(409).json({ ok: false, error: `Turno ${turno || ""} al completo: restano ${Math.max(0, TAVOLO_MAX_COPERTI - usati)} coperti.`, posti_liberi: Math.max(0, TAVOLO_MAX_COPERTI - usati) });
    }
  }
  const coperti = ris?.tipo === "tavolo" ? Math.max(1, Number(req.body?.persone || ospiti) || 1) : Number(ospiti) || 0;
  const info = await db.prepare(`INSERT INTO prenotazioni (socio_id,risorsa_id,risorsa_nome,giorno,turno,ospiti)
                           VALUES (?,?,?,?,?,?)`).run(socio?.id ?? null, ris?.id ?? null, ris?.nome ?? risorsa ?? "Evento", giorno ?? null, turno ?? null, coperti);
  audit(tessera_code || "ospite", "prenotazione", "prenotazioni", info.lastInsertRowid, ris?.nome || "");
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
publicRouter.post("/convocazioni/:id/risposta", async (req, res) => {
  const { stato } = req.body || {};
  const val = stato === "disponibile" ? "disponibile" : "non_disponibile";
  const cv = await db.prepare("SELECT socio_id FROM convocazioni WHERE id=?").get(req.params.id);
  await db.prepare("UPDATE convocazioni SET stato=? WHERE id=?").run(val, req.params.id);
  let dinieghi = 0, obbligatoria = false;
  if (cv?.socio_id) {
    const so = await db.prepare("SELECT tipo_profilo,dinieghi FROM soci WHERE id=?").get(cv.socio_id);
    if (so) {
      if (val === "non_disponibile" && so.tipo_profilo !== "ospite_temporaneo") {
        dinieghi = so.dinieghi + 1;
        await db.prepare("UPDATE soci SET dinieghi=? WHERE id=?").run(dinieghi, cv.socio_id);
      } else dinieghi = so.dinieghi;
      obbligatoria = so.tipo_profilo !== "ospite_temporaneo" && dinieghi >= 3;
    }
  }
  audit("socio", "risposta_convocazione", "convocazioni", req.params.id, val);
  res.json({ ok: true, stato: val, dinieghi, obbligatoria });
});
publicRouter.post("/proposte", async (req, res) => {
  const { tessera_code, tipo, titolo, dettaglio } = req.body || {};
  const socio = tessera_code ? await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(tessera_code) : null;
  const info = await db.prepare("INSERT INTO proposte (socio_id,tipo,titolo,dettaglio) VALUES (?,?,?,?)").run(socio?.id ?? null, tipo === "openmic" ? "openmic" : "vinile", titolo ?? "", dettaglio ?? "");
  audit(tessera_code || "ospite", "proposta", "proposte", info.lastInsertRowid, tipo || "");
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
function slotDiCampo(campo) {
  const toMin = (t) => {
    const [h, m] = String(t || "0:0").split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const toHHMM = (x) => String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
  const start = Math.max(toMin(campo.apertura), campo.ora_min ? toMin(campo.ora_min) : 0);
  const end = toMin(campo.chiusura);
  const step = Math.max(15, Number(campo.durata_slot) || 60);
  const out = [];
  for (let t = start; t + step <= end + 1e-4; t += step) out.push(toHHMM(t));
  return out;
}
var socioByTessera = async (t) => t ? await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(t) : null;
// ---- Campi: modello "titolare + gli altri si uniscono fino al massimo del campo" ------------
// Ogni prenotazione ha un socio titolare identificato dalla tessera. Il numero di posti e' quello
// del campo (posti_default), deciso dal gestore: il titolare non lo modifica. Il titolare sceglie
// solo la durata (quanti slot consecutivi, entro max_slot_prenotazione) e se aprire ai soci.
// "gestione" e "prezzo_ora" viaggiano coi campi: chi prenota deve sapere PRIMA se quel campo
// si paga, non scoprirlo al momento del conto.
const CAMPI_COLS = "id,nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default,max_slot_prenotazione,max_pren_settimana,min_giocatori,gestione,prezzo_ora";

// Lunedi'-domenica della settimana che contiene la data (per il tetto settimanale).
function settimanaDi(dataISO) {
  const d = new Date(dataISO + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  const lun = new Date(d.getTime() - dow * 864e5);
  const dom = new Date(lun.getTime() + 6 * 864e5);
  return { da: lun.toISOString().slice(0, 10), a: dom.toISOString().slice(0, 10) };
}

// La tessera serve a chi legge (estratto conto, iscrizioni): senza, le ricerche fatte per
// tessera tornavano vuote e sembrava che il socio non avesse mai fatto niente.
var socioAttivoByTessera = async (t) => t ? await db.prepare("SELECT id,nome,cognome,tessera_code,attivo,data_nascita FROM soci WHERE tessera_code=?").get(t) : null;

// Slot resi indisponibili da un blocco (torneo, manutenzione, evento) inserito dal back office.
async function slotBloccati(campoId, data) {
  const out = /* @__PURE__ */ new Map();
  const rows = await db.prepare("SELECT slot_da,slot_a,motivo,nota FROM campi_blocchi WHERE campo_id=? AND data=?").all(campoId, data);
  return { rows, out };
}
function slotDentroBlocco(slot, b) {
  return String(slot) >= String(b.slot_da || "00:00") && String(slot) <= String(b.slot_a || "23:59");
}

// Prenotazioni gia' fatte dal socio come titolare, sul campo, nella settimana della data.
// ---- Anti-monopolio -----------------------------------------------------------------------
// Il trucco da bloccare: sei amici, il primo prenota le 16, gli altri cinque prenotano le fasce
// successive, e il campo resta occupato dallo stesso gruppo fino a sera. Contare il tetto sul
// TITOLARE non serve a niente, perche' i titolari sono sei persone diverse.
//
// La chiave e' che il sistema sa gia' CHI GIOCA, non solo chi ha prenotato: ogni prenotazione
// ha il titolare come primo iscritto e gli altri si aggiungono. Quindi il tetto si conta sulla
// partecipazione, e non sulla firma.

// Tutte le prenotazioni del campo in cui il socio compare, come titolare o come iscritto.
async function occupazioniDelSocio(campoId, socioId, da, a) {
  if (!socioId) return [];
  return await db.prepare(
    `SELECT DISTINCT pc.partita_id, pc.data, pc.slot
     FROM prenotazioni_campo pc
     LEFT JOIN partita_iscritti pi ON pi.partita_id = pc.partita_id
     WHERE pc.campo_id=? AND pc.stato='prenotato' AND pc.data BETWEEN ? AND ?
       AND (pc.titolare_socio_id=? OR pi.socio_id=?)
     ORDER BY pc.data, pc.slot`
  ).all(campoId, da, a, socioId, socioId);
}

// Quante prenotazioni distinte "pesano" sul socio in una finestra di date.
async function quotaUsata(campoId, socioId, da, a) {
  const righe = await occupazioniDelSocio(campoId, socioId, da, a);
  return new Set(righe.map((r) => r.partita_id || `${r.data}-${r.slot}`)).size;
}

// Quante fasce consecutive stanno nella durata massima consentita, su questo campo.
async function fasceAmmesse(campo) {
  const perFascia = Math.max(1, Number(campo.durata_slot) || 60);
  const dichiarato = Math.max(1, Number(campo.max_slot_prenotazione) || 1);
  // Il tetto in MINUTI vale sempre: e' il tempo di campo che si occupa, non il conteggio
  // delle fasce. L'interruttore governa il tetto per socio, non la durata di una partita.
  const minuti = Math.max(perFascia, Number(await par("campi_durata_massima_minuti")) || 120);
  const daTempo = Math.max(1, Math.floor(minuti / perFascia));
  if (!await par("campi_limita_durata")) return daTempo;
  return Math.max(1, Math.min(dichiarato, daTempo));
}

async function prenSettimana(campoId, socioId, dataISO) {
  const w = settimanaDi(dataISO);
  // Con la quota sui partecipanti conta chi gioca; altrimenti solo chi ha firmato.
  if (!await par("campi_quota_su_partecipanti")) {
    if (!socioId) return 0;
    const r = await db.prepare(
      "SELECT COUNT(DISTINCT partita_id) n FROM prenotazioni_campo WHERE campo_id=? AND titolare_socio_id=? AND stato='prenotato' AND data BETWEEN ? AND ?"
    ).get(campoId, socioId, w.da, w.a);
    return Number(r?.n || 0);
  }
  return await quotaUsata(campoId, socioId, w.da, w.a);
}

// Gli slot del campo occupati quel giorno da prenotazioni in cui il socio gia' compare.
async function slotDelSocioNelGiorno(campoId, socioId, data) {
  const righe = await occupazioniDelSocio(campoId, socioId, data, data);
  return righe.map((r) => r.slot);
}

// Regola della catena: fasce ATTACCATE fra loro in cui gioca la stessa persona valgono come
// una sola occupazione lunga, e devono stare nel massimo di fasce consecutive. E' questa che
// spegne il giochino del testimone: la catena delle sei fasce e' lunga sei, non uno.
async function catenaTroppoLunga(campo, data, sceltiSlot, socioId) {
  if (!await par("campi_catena")) return null;
  const maxSlot = Math.max(1, await fasceAmmesse(campo));
  const tutti = slotDiCampo(campo);
  const miei = new Set(await slotDelSocioNelGiorno(campo.id, socioId, data));
  for (const s of sceltiSlot) miei.add(s);
  // misura la catena contigua che contiene le fasce appena richieste
  const idx = sceltiSlot.map((s) => tutti.indexOf(s)).filter((i) => i >= 0);
  if (!idx.length) return null;
  let i = Math.min(...idx);
  let j = Math.max(...idx);
  while (i - 1 >= 0 && miei.has(tutti[i - 1])) i--;
  while (j + 1 < tutti.length && miei.has(tutti[j + 1])) j++;
  const lunghezza = j - i + 1;
  if (lunghezza > maxSlot) {
    return `Con questa prenotazione occuperesti ${lunghezza} fasce di fila su ${campo.nome}, ma il massimo \u00e8 ${maxSlot}. Le fasce attaccate in cui giochi contano insieme, anche se le prenota qualcun altro del gruppo.`;
  }
  return null;
}


// ---- Numero legale ------------------------------------------------------------------------
// Il presupposto della catena e' che i giocatori siano dichiarati. Se prenota uno solo e
// giocano in sei senza registrarsi, il sistema non vede nulla e la regola non morde.
// Il numero legale rende conveniente dichiararli: poco prima dell'orario, se i giocatori
// registrati sono meno del minimo del campo, la prenotazione decade e il campo torna libero.
// Cosi' il gruppo ha due sole strade, e nessuna delle due gli permette di tenere il campo:
// dichiararsi (e finire sotto la catena) oppure perdere lo slot.
function istanteSlot(data, slot) {
  return new Date(`${data}T${String(slot).slice(0, 5)}:00`);
}

// Libera le prenotazioni che non hanno raggiunto il numero legale entro la scadenza.
// Si esegue "pigramente" quando si guarda la disponibilita' o si prenota: nessun cron.
async function liberaDecadute(campo, data) {
  if (!await par("campi_numero_legale")) return 0;
  const minuti = Math.max(1, Number(await par("campi_numero_legale_minuti")) || 30);
  const minGio = Math.max(1, Number(campo.min_giocatori) || 1);
  if (minGio <= 1) return 0;
  const oggi = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (data > oggi) return 0;                       // il futuro non decade
  const partite = await db.prepare(
    "SELECT * FROM partite_aperte WHERE campo_id=? AND data=? AND stato IN ('aperta','completa')"
  ).all(campo.id, data);
  let liberate = 0;
  for (const p of partite) {
    const scadenza = new Date(istanteSlot(p.data, p.slot).getTime() - minuti * 60000);
    if ((/* @__PURE__ */ new Date()) < scadenza) continue;
    // Prenotazione dell'ultimo minuto: chi prenota quando la scadenza e' gia' passata e' li'
    // di persona, e non deve vedersela sparire un istante dopo averla fatta. Le si concede
    // comunque una finestra per dichiarare i compagni.
    const creata = p.created_at ? new Date(String(p.created_at).replace(" ", "T") + "Z") : null;
    if (creata && creata >= scadenza) {
      // La grazia non si spinge oltre l'inizio del turno: se l'orario e' gia' cominciato e
      // nessuno si e' dichiarato, il campo e' vuoto e va liberato comunque.
      const grazia = Math.min(creata.getTime() + Math.min(10, minuti) * 60000, istanteSlot(p.data, p.slot).getTime());
      if ((/* @__PURE__ */ new Date()).getTime() < grazia) continue;
    }
    const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
    if (n >= minGio) continue;
    await db.prepare("UPDATE partite_aperte SET stato='decaduta', decaduta_at=datetime('now') WHERE id=?").run(p.id);
    await db.prepare("UPDATE prenotazioni_campo SET stato='decaduto' WHERE partita_id=?").run(p.id);
    audit("sistema", "decadenza_campo", "campi", campo.id, `${p.data} ${p.slot} \xB7 ${n}/${minGio} giocatori`);
    liberate++;
  }
  return liberate;
}

// Quanto manca al numero legale, e entro quando: serve all'app per avvisare invece di punire.
async function statoNumeroLegale(campo, p, iscritti) {
  if (!await par("campi_numero_legale")) return null;
  const minGio = Math.max(1, Number(campo.min_giocatori) || 1);
  if (minGio <= 1) return null;
  const minuti = Math.max(1, Number(await par("campi_numero_legale_minuti")) || 30);
  const scadenza = new Date(istanteSlot(p.data, p.slot).getTime() - minuti * 60000);
  return {
    minimo: minGio,
    iscritti,
    mancano: Math.max(0, minGio - iscritti),
    raggiunto: iscritti >= minGio,
    scade_alle: scadenza.toTimeString().slice(0, 5),
    scade_il: scadenza.toISOString().slice(0, 10)
  };
}

publicRouter.get("/campi", async (req, res) => {
  const rows = await db.prepare(`SELECT ${CAMPI_COLS} FROM campi WHERE attivo=1 ORDER BY ordine,id`).all();
  // Le regole attive viaggiano coi campi: l'app non deve indovinare cosa e' acceso.
  const regole = {
    limita_durata: await par("campi_limita_durata"),
    limita_settimana: await par("campi_limita_settimana"),
    prenotazione_obbligatoria: await par("campi_prenotazione_obbligatoria"),
    durata_max_minuti: await par("campi_durata_max_minuti"),
    unisciti: await par("campi_unisciti"),
    unisciti_modo: await par("campi_unisciti_modo"),
    durata_massima_minuti: await par("campi_durata_massima_minuti"),
    semplice_eta: Number(await par("semplice_eta")) || 70,
    ragazzi_eta: Number(await par("ragazzi_eta")) || 14,
    maggiore_eta: 18,
    ragazzi_prenotano_campi: !!await par("ragazzi_prenotano_campi"),
    numero_legale: await par("campi_numero_legale"),
    numero_legale_minuti: await par("campi_numero_legale_minuti")
  };
  const conFasce = [];
  for (const c of rows) conFasce.push({ ...c, fasce_ammesse: await fasceAmmesse(c) });
  res.json(conFasce.map((c) => ({
    ...c,
    max_slot_prenotazione: c.fasce_ammesse,
    max_pren_settimana: regole.limita_settimana ? c.max_pren_settimana : null,
    regole
  })));
});

publicRouter.get("/campi/:id/disponibilita", async (req, res) => {
  const campo = await db.prepare("SELECT * FROM campi WHERE id=? AND attivo=1").get(req.params.id);
  if (!campo) return res.status(404).json({ error: "Campo non trovato" });
  const data = String(req.query.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida (YYYY-MM-DD)" });
  await liberaDecadute(campo, data);
  const occ = await db.prepare("SELECT * FROM prenotazioni_campo WHERE campo_id=? AND data=? AND stato='prenotato'").all(campo.id, data);
  const partite = await db.prepare("SELECT * FROM partite_aperte WHERE campo_id=? AND data=? AND stato IN ('aperta','completa')").all(campo.id, data);
  const { rows: blocchi } = await slotBloccati(campo.id, data);
  const iscrittiCount = {};
  const numeroLegale = {};
  for (const p of partite) {
    iscrittiCount[p.id] = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
    numeroLegale[p.id] = await statoNumeroLegale(campo, p, iscrittiCount[p.id]);
  }
  const slots = slotDiCampo(campo).map((slot) => {
    // Una fascia gia' finita non si offre: alle nove di sera il campo delle quattro non e'
    // "libero", e' passato. Prima compariva con i tasti "Solo io" e "Apri ai soci", e chi ci
    // provava creava una prenotazione che decadeva nello stesso istante.
    if (fasciaPassata(data, slot, Number(campo.durata_slot) || 60)) return { slot, stato: "passato" };
    const o = occ.find((x) => x.slot === slot);
    // Libera ma gia' cominciata: si mostra "in corso" e non si offre. Se invece e' occupata,
    // il ramo sotto continua a dire chi c'e': serve saperlo anche a partita iniziata.
    if (!o && fasciaIniziata(data, slot)) return { slot, stato: "in_corso" };
    if (!o) {
      const b = blocchi.find((x) => slotDentroBlocco(slot, x));
      if (b) return { slot, stato: "bloccato", motivo: b.motivo || "torneo", nota: b.nota || "" };
      return { slot, stato: "libero" };
    }
    if (o.partita_id) {
      const p = partite.find((x) => x.id === o.partita_id);
      if (p) {
        const aperta = p.aperta_ai_soci !== 0;
        return {
          slot,
          stato: aperta ? "partita" : "privata",
          partita_id: p.id,
          posti_totali: p.posti_totali,
          iscritti: iscrittiCount[p.id] || 0,
          livello: p.livello || "",
          numero_legale: numeroLegale[p.id] || null,
          // La tessera del titolare serve all'app per sapere se la prenotazione e' di chi sta
          // guardando: solo lui puo' dichiarare chi gioca con lui.
          titolare_tessera: p.creatore_tessera || null,
          titolare: p.creatore_nome || "",
          creatore: p.creatore_nome || "",
          nome: p.creatore_nome || "Prenotato",
          completa: p.stato === "completa"
        };
      }
    }
    const pv = partite.find((x) => x.id === o.partita_id);
    // La tessera del titolare serve all'app per capire se la prenotazione e' di chi sta
    // guardando: solo lui puo' dichiarare chi gioca con lui.
    return { slot, stato: "privata", nome: o.nome || "Prenotato", titolare: o.nome || "", titolare_tessera: o.tessera_code || (pv ? pv.creatore_tessera : null) || null, posti_totali: pv ? pv.posti_totali : null, partita_id: o.partita_id || null, iscritti: pv ? iscrittiCount[pv.id] : null, numero_legale: pv ? numeroLegale[pv.id] : null };
  });
  // Quota residua del richiedente, se si identifica con la tessera.
  let quota = null;
  const socio = await socioAttivoByTessera(req.query.tessera_code);
  if (socio && socio.attivo !== 0) {
    // Sui campi a pagamento non si mostra nessuna quota: non c'e' un tetto da consumare, e
    // scrivere "ti restano 2 prenotazioni" su un campo che si paga sarebbe una bugia.
    if (String(campo.gestione || "chiosco") !== "tennis") {
      const usate = await prenSettimana(campo.id, socio.id, data);
      quota = { usate, massimo: campo.max_pren_settimana, residue: Math.max(0, campo.max_pren_settimana - usate) };
    }
  }
  const listinoCampo = await db.prepare("SELECT etichetta,da_ora,a_ora,tipo_uso,prezzo_ora FROM campi_tariffe WHERE campo_id=? AND attiva=1 ORDER BY tipo_uso,id").all(campo.id);
  res.json({
    listino: listinoCampo,
    gestione: campo.gestione || "chiosco",
    prezzo_ora: Number(campo.prezzo_ora || 0),
    campo: {
      id: campo.id,
      nome: campo.nome,
      sport: campo.sport,
      durata_slot: campo.durata_slot,
      posti_default: campo.posti_default,
      // Le fasce ammesse, non il numero grezzo della scheda: e' il tetto in minuti tradotto
      // su questo campo. Altrimenti l'app propone "2× 90′" cioe' tre ore.
      max_slot_prenotazione: await fasceAmmesse(campo),
      durata_massima_minuti: Number(await par("campi_durata_massima_minuti")) || 120,
      max_pren_settimana: campo.max_pren_settimana
    },
    data,
    quota,
    slots
  });
});

// Verifica gli N slot consecutivi a partire da 'slot': validi, liberi, non bloccati.
async function slotConsecutiviLiberi(campo, data, slot, nSlot) {
  const tutti = slotDiCampo(campo);
  const i = tutti.indexOf(slot);
  if (i < 0) return { error: "Orario non valido per questo campo" + (campo.ora_min ? ` (dalle ${campo.ora_min})` : "") };
  if (i + nSlot > tutti.length) return { error: "La durata scelta supera l'orario di chiusura" };
  const scelti = tutti.slice(i, i + nSlot);
  const { rows: blocchi } = await slotBloccati(campo.id, data);
  for (const s of scelti) {
    const ex = await db.prepare("SELECT id FROM prenotazioni_campo WHERE campo_id=? AND data=? AND slot=? AND stato='prenotato'").get(campo.id, data, s);
    if (ex) return { error: `Slot ${s} gi\xE0 occupato` };
    const b = blocchi.find((x) => slotDentroBlocco(s, x));
    if (b) return { error: `Campo non disponibile alle ${s}${b.motivo ? " (" + b.motivo + ")" : ""}` };
  }
  return { scelti };
}

// Creazione della prenotazione: unico ingresso, sia "aperta ai soci" sia "riservata".
async function creaPrenotazione(req, res, apertaDiDefault) {
  const campo = await db.prepare("SELECT * FROM campi WHERE id=? AND attivo=1").get(req.params.id);
  if (!campo) return res.status(404).json({ error: "Campo non trovato" });
  // Non si prenota all'indietro: la fascia sarebbe decaduta all'istante, e il socio si sarebbe
  // ritrovato una prenotazione fantasma senza capire perche'.
  const { tessera_code, data, slot, livello, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return res.status(400).json({ error: "Data non valida" });
  if (fasciaPassata(data, slot, Number(campo.durata_slot) || 60)) {
    return res.status(400).json({ error: "Quella fascia \u00e8 gi\u00e0 passata: scegline una piu\u2019 avanti o un altro giorno." });
  }
  if (fasciaIniziata(data, slot)) {
    return res.status(400).json({ error: "Quella fascia \u00e8 gi\u00e0 cominciata: dall'app si prenota solo in anticipo. Se sei qui, chiedila al banco." });
  }

  // 1. Il titolare deve essere un socio identificato e attivo.
  const socio = await socioAttivoByTessera(tessera_code);
  if (!socio) return res.status(403).json({ error: "Serve la tessera di un socio per prenotare" });
  if (socio.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });

  // 2. Durata entro il massimo deciso dal gestore. Il limite e' in MINUTI: su un campo da 90
  // minuti "due fasce" sono tre ore, e un tetto espresso in fasce non limitava niente.
  const maxSlot = Math.max(1, await fasceAmmesse(campo));
  const nSlot = Math.max(1, Number(req.body?.n_slot) || 1);
  // Il tetto vale sempre: e' espresso in minuti e tradotto in fasce su questo campo.
  if (nSlot > maxSlot) {
    const min = maxSlot * (Number(campo.durata_slot) || 60);
    return res.status(409).json({ error: `Puoi prenotare al massimo ${maxSlot} ${maxSlot === 1 ? "fascia" : "fasce"} di seguito (${min} minuti)` });
  }

  // 3. Tetto settimanale per socio su questo campo (solo se acceso nei parametri).
  const usate = await prenSettimana(campo.id, socio.id, data);
  // Il tetto settimanale non vale sui campi a pagamento: li' piu' si gioca piu' si paga, e
  // limitare chi vuole spendere non ha senso. Serve sui campi gratuiti del chiosco, dove il
  // tetto e' l'unico modo per distribuire una risorsa che non costa niente.
  const aPagamento = String(campo.gestione || "chiosco") === "tennis";
  if (!aPagamento && await par("campi_limita_settimana") && usate >= campo.max_pren_settimana) {
    return res.status(409).json({ error: `Hai gi\xE0 ${usate} prenotazioni questa settimana su ${campo.nome} (massimo ${campo.max_pren_settimana})` });
  }

  const noCampo = await bloccoMinorenne(socio, "campo");
  if (noCampo) return res.status(403).json({ error: noCampo });

  // 3-bis. Tetto giornaliero: dopo aver giocato, il campo passa ad altri.
  if (await par("campi_max_giorno")) {
    const maxG = Math.max(1, Number(await par("campi_max_giorno_n")) || 1);
    const oggi = await quotaUsata(campo.id, socio.id, data, data);
    if (oggi >= maxG) {
      return res.status(409).json({ error: `Hai gi\u00e0 ${oggi === 1 ? "una prenotazione" : oggi + " prenotazioni"} oggi su ${campo.nome}: per oggi il campo passa ad altri.` });
    }
  }

  // 3-ter. Finestra di prenotazione: nessuno si prende mezza stagione il primo giorno.
  const finestra = await par("campi_finestra") ? Number(await par("campi_finestra_giorni")) || 0 : 0;
  if (finestra > 0) {
    const giorniAvanti = Math.round((new Date(data + "T12:00:00Z") - new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z")) / 864e5);
    if (giorniAvanti > finestra) {
      return res.status(409).json({ error: `Si prenota fino a ${finestra} giorni in anticipo: riprova pi\u00f9 avanti.` });
    }
    if (giorniAvanti < 0) return res.status(409).json({ error: "Non si prenota nel passato" });
  }

  // 4. Slot consecutivi liberi e non bloccati (le decadute si liberano prima).
  await liberaDecadute(campo, data);
  const chk = await slotConsecutiviLiberi(campo, data, slot, nSlot);
  if (chk.error) return res.status(409).json({ error: chk.error });

  // 4-bis. Catena contigua: le fasce attaccate in cui gioca lo stesso socio contano insieme.
  const catena = await catenaTroppoLunga(campo, data, chk.scelti, socio.id);
  if (catena) return res.status(409).json({ error: catena });

  // 4. Le partite aperte esistono solo se il gestore le ha accese.
  const unisciti = await par("campi_unisciti");
  const aperta = unisciti && (req.body?.aperta_ai_soci == null ? apertaDiDefault : !!req.body.aperta_ai_soci);
  // Con "solo unendosi" chi ha gia' una prenotazione quel giorno deve aggregarsi, non aprirne un'altra.
  if (unisciti && await par("campi_unisciti_modo") === "solo_unisciti" && usate > 0) {
    const aperteOggi = await db.prepare(
      "SELECT COUNT(*) n FROM partite_aperte WHERE campo_id=? AND data=? AND stato='aperta' AND aperta_ai_soci=1"
    ).get(campo.id, data);
    if (Number(aperteOggi?.n || 0) > 0) {
      return res.status(409).json({ error: "Hai gi\xE0 una prenotazione oggi su questo campo: unisciti a una partita aperta invece di aprirne un'altra" });
    }
  }
  const posti = Number(campo.posti_default) || 4;
  const nome = (socio.nome + " " + (socio.cognome || "")).trim();
  const slotFine = chk.scelti[chk.scelti.length - 1];

  const pi = await db.prepare(
    "INSERT INTO partite_aperte (campo_id,data,slot,posti_totali,livello,note,stato,creatore_tessera,creatore_nome,aperta_ai_soci,n_slot,slot_fine,titolare_socio_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(campo.id, data, slot, posti, livello || null, note || null, aperta ? "aperta" : "completa", tessera_code, nome, aperta ? 1 : 0, nSlot, slotFine, socio.id);
  const partitaId = Number(pi.lastInsertRowid);

  // Quanto costa: i campi del chiosco sono gratuiti (prezzo zero), quelli in gestione al
  // tennis hanno un listino. Il prezzo si scrive sulla PRIMA fascia della prenotazione, non su
  // tutte: e' un conto solo, non uno per ogni ora.
  const conto = await prezzoPrenotazione(campo, slot, chk.scelti.length, String(req.body?.tipo_uso || "campo"));
  const ins = db.prepare("INSERT INTO prenotazioni_campo (campo_id,data,slot,tipo,socio_id,tessera_code,nome,stato,partita_id,titolare_socio_id,prezzo,tipo_uso) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  let prima = true;
  for (const s of chk.scelti) {
    await ins.run(campo.id, data, s, aperta ? "partita" : "privata", socio.id, tessera_code, nome, "prenotato", partitaId, socio.id,
      prima ? conto.prezzo : 0, String(req.body?.tipo_uso || "campo"));
    prima = false;
  }

  // Il titolare e' sempre il primo iscritto.
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)").run(partitaId, socio.id, tessera_code, nome);

  audit(tessera_code, aperta ? "apre_partita" : "prenota_campo", "campi", campo.id, `${data} ${slot}-${slotFine} \xB7 ${posti} posti`);
  if (aperta) await notifyMancaUno(partitaId);
  // Il numero legale e la sua scadenza: se e' gia' passata, la prenotazione e' in grazia.
  let avvisoScadenza = null;
  try {
    if (String(await par("campi_numero_legale")) === "true" || (await par("campi_numero_legale")) === true) {
      const minimo = Math.max(0, Number(campo.min_giocatori) || 0);
      const prima = Number(await par("campi_numero_legale_minuti")) || 30;
      if (minimo > 1 && scadenzaGiaPassata(data, slot, prima)) {
        avvisoScadenza = `Servono ${minimo} giocatori e la scadenza \u00e8 gi\u00e0 passata: hai 10 minuti per dire chi gioca con te, altrimenti il campo torna libero.`;
      }
    }
  } catch (_) {
  }
  res.status(201).json({
    ok: true,
    partita_id: partitaId,
    id: partitaId,
    posti_totali: posti,
    n_slot: nSlot,
    slot_fine: slotFine,
    aperta_ai_soci: aperta,
    // Quanto si paga, e dove: un campo a pagamento non deve sorprendere al momento del conto.
    prezzo: conto.prezzo,
    prezzo_dettaglio: conto.gratuito ? null : `${conto.ore} ${conto.ore === 1 ? "ora" : "ore"} \u00d7 ${conto.prezzo_ora.toFixed(2)} \u20ac${conto.tariffa ? " (" + conto.tariffa + ")" : ""}`,
    da_pagare: conto.gratuito ? null : "Si paga al banco del tennis.",
    // Se il numero legale e' acceso e la sua scadenza e' gia' alle spalle, questa prenotazione
    // vive dieci minuti: o si dichiara chi gioca, o decade. Dirlo nel momento in cui si scrive
    // "Fatto!" e' l'unico modo perche' il socio non se la ritrovi sparita senza spiegazioni.
    avviso: avvisoScadenza,
    quota: { usate: usate + 1, massimo: campo.max_pren_settimana, residue: Math.max(0, campo.max_pren_settimana - usate - 1) }
  });
}

// "prenota" = riservata al titolare · "partita" = aperta ai soci. Entrambe hanno un titolare.
publicRouter.post("/campi/:id/prenota", (req, res) => creaPrenotazione(req, res, false));
publicRouter.post("/campi/:id/partita", (req, res) => creaPrenotazione(req, res, true));

// DISDIRE UN CAMPO. La rotta per annullare esisteva, ma lavorava sull'id della prenotazione —
// un numero che l'app non ha mai in mano, perche' la fascia conosce la PARTITA. Risultato: dal
// telefono non c'era modo di disdire, e nemmeno la crew poteva farlo. Un campo prenotato per
// sbaglio restava occupato fino a sera.
// L'ESTRATTO CONTO DELLA TESSERA.
//
// Tutto quello che il socio ha fatto in residence, con quanto e' costato — e con lo ZERO quando
// non e' costato niente. Lo zero non e' un riempitivo: dice che i campi, la spiaggia e le
// serate sono compresi, e a fine stagione fa vedere quanto vale la quota. Un elenco di sole
// spese racconta metà della storia.
//
// UN LIMITE DA DIRE, non da nascondere: qui c'e' solo cio' che e' stato fatto CON LA TESSERA.
// Al bar si serve chiunque, e la maggior parte degli scontrini non ha un nome dietro: se il
// socio ha preso tre caffe' senza mostrare la tessera, quei caffe' qui non ci sono. L'estratto
// lo scrive in chiaro, altrimenti chi legge crede che sia tutto e pensa che il conto sia
// sbagliato.
// NB: il percorso NON puo' essere /tessera/estratto: piu' sopra c'e' gia' /tessera/:code, che
// intercetterebbe "estratto" come se fosse un numero di tessera e risponderebbe "non trovata".
// ---- SPIAGGIA ------------------------------------------------------------------------------
// Chi arriva prende. Non c'e' prenotazione anticipata, ed e' voluto: se si prenotasse la sera
// prima, la mattina dopo meta' spiaggia risulterebbe occupata e sarebbe vuota.
publicRouter.get("/spiaggia", async (req, res) => {
  // L'interruttore spegne davvero: se la gestione non e' attiva, il socio non vede nemmeno la
  // sezione. Una funzione accesa a meta' e' peggio di una spenta.
  if (!(await par("beach_attiva"))) return res.status(404).json({ error: "La gestione degli ombrelloni non e' attiva." });
  const oggi = new Date().toISOString().slice(0, 10);
  const piazzole = await db.prepare("SELECT id,nome FROM piazzole WHERE attiva=1 ORDER BY ordine,id").all();
  const fasce = await fasceOggi();
  const attuale = fasce.find((f) => f.in_corso) || fasce.find((f) => !f.passata) || fasce[fasce.length - 1];
  const fascia = ["mattina", "pomeriggio"].includes(String(req.query.fascia)) ? String(req.query.fascia) : attuale.fascia;
  const out = [];
  for (const p of piazzole) out.push({ ...p, ...(await situazionePiazzola(p.id, oggi, fascia)) });
  res.json({ data: oggi, fascia, fasce, piazzole: out, posti_ombrellone: Number(await par("beach_posti_ombrellone")) || 2 });
});

publicRouter.post("/spiaggia/prendi", async (req, res) => {
  if (!(await par("beach_attiva"))) return res.status(409).json({ error: "La gestione degli ombrelloni non e' attiva." });
  const socio = await socioAttivoByTessera(req.body?.tessera_code);
  if (!socio || socio.attivo === 0) return res.status(404).json({ error: "Serve la tessera di un socio" });
  const pieno = await db.prepare("SELECT id,nome,cognome,tessera_code,nucleo FROM soci WHERE id=?").get(socio.id);
  const r = await prendiOmbrellone({
    socio: pieno, ombrelloneId: req.body?.ombrellone_id,
    data: new Date().toISOString().slice(0, 10),
    fascia: req.body?.fascia, quanti: Number(req.body?.quanti) || 1
  });
  if (!r.ok) return res.status(409).json(r);
  await registra({
    fatto: "ombrellone_preso", servizio: "spiaggia", riferimento: r.id,
    socio_id: pieno.id, intestatario: `${pieno.nome} ${pieno.cognome || ""}`.trim(),
    autore: `${pieno.nome} ${pieno.cognome || ""}`.trim(), canale: "app",
    quando: `${new Date().toISOString().slice(0, 10)} \u00b7 ${req.body?.fascia}`,
    dettaglio: { ombrellone_id: req.body?.ombrellone_id, nucleo: pieno.nucleo || null }
  });
  res.status(201).json(r);
});

publicRouter.post("/spiaggia/rilascia", async (req, res) => {
  const socio = await socioAttivoByTessera(req.body?.tessera_code);
  if (!socio) return res.status(404).json({ error: "Serve la tessera di un socio" });
  const pieno = await db.prepare("SELECT id,nome,cognome,nucleo FROM soci WHERE id=?").get(socio.id);
  const r = await rilasciaOmbrellone({ socio: pieno, presaId: req.body?.presa_id });
  if (!r.ok) return res.status(409).json(r);
  // Rilasciare presto e' il gesto che fa girare la spiaggia piu' di qualunque regola: chi va
  // via a mezzogiorno restituisce l'ombrellone e qualcun altro lo usa.
  await registra({
    fatto: "ombrellone_rilasciato", servizio: "spiaggia", riferimento: req.body?.presa_id,
    socio_id: pieno.id, intestatario: `${pieno.nome} ${pieno.cognome || ""}`.trim(),
    autore: `${pieno.nome} ${pieno.cognome || ""}`.trim(), canale: "app"
  });
  res.json(r);
});

// LE MIE PRENOTAZIONI, tutte insieme. Oggi per sapere cosa si ha prenotato bisogna entrare in
// Campi, poi in Fitness, poi nel Garden: tre schermate per una domanda sola. E' la prima cosa
// che uno guarda aprendo l'app — "cosa ho oggi?" — e non c'era.
// DISDIRE UN TAVOLO. Mancava del tutto: il socio prenotava dall'app e poi non aveva nessun modo
// di annullare — doveva telefonare, e se non telefonava il tavolo restava occupato tutta la
// sera da qualcuno che non veniva. In sala si vedeva un nome su un tavolo vuoto e nessuno
// sapeva se aspettarli o liberare.
publicRouter.post("/prenotazioni-tavolo/:id/annulla", async (req, res) => {
  const socio = await socioAttivoByTessera(req.body?.tessera_code);
  if (!socio) return res.status(404).json({ error: "Serve la tessera di un socio" });
  const p = await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "prenotato") return res.status(404).json({ error: "Prenotazione non trovata" });
  if (String(p.tessera_code || "").toUpperCase() !== String(socio.tessera_code).toUpperCase()) {
    return res.status(403).json({ error: "Puoi disdire solo le tue prenotazioni." });
  }
  await db.prepare("UPDATE prenotazioni_tavolo SET stato='annullato' WHERE id=?").run(p.id);
  await registra({
    fatto: "prenotazione_cancellata", servizio: p.ambiente === "stage" ? "stage" : p.ambiente === "carta" ? "carta" : "garden",
    riferimento: p.id, socio_id: socio.id, intestatario: p.nome || null,
    autore: `${socio.nome} ${socio.cognome || ""}`.trim(), canale: "app",
    quando: `${p.data} \u00b7 ${p.turno}`, dettaglio: { persone: p.persone }
  });
  res.json({ ok: true });
});

publicRouter.get("/mie-prenotazioni", async (req, res) => {
  const socio = await socioAttivoByTessera(req.query.tessera_code);
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const oggi = new Date().toISOString().slice(0, 10);
  const voci = [];

  // Campi: la prenotazione vive nella partita, e si annulla da li'.
  for (const p of await db.prepare(
    `SELECT p.id, p.data, p.slot, p.prezzo, c.nome AS campo, pa.id AS partita_id
     FROM prenotazioni_campo p JOIN campi c ON c.id=p.campo_id
     LEFT JOIN partite_aperte pa ON pa.id=p.partita_id
     WHERE upper(p.tessera_code)=? AND p.stato='prenotato' AND p.data>=? ORDER BY p.data, p.slot`
  ).all(String(socio.tessera_code).toUpperCase(), oggi)) {
    voci.push({
      tipo: "campo", titolo: p.campo, quando: `${p.data} \u00b7 ${p.slot}`,
      data: p.data, ora: p.slot, importo: Number(p.prezzo) || 0,
      annulla: p.partita_id ? { rotta: `/partite/${p.partita_id}/annulla` } : null
    });
  }
  // Tavoli: Garden, Stage, Casa di Carta.
  for (const t of await db.prepare(
    `SELECT id, data, turno, persone, ambiente FROM prenotazioni_tavolo
     WHERE upper(tessera_code)=? AND stato='prenotato' AND data>=? ORDER BY data, turno`
  ).all(String(socio.tessera_code).toUpperCase(), oggi).catch(() => [])) {
    voci.push({
      tipo: t.ambiente === "stage" ? "stage" : t.ambiente === "carta" ? "carta" : "garden",
      titolo: t.ambiente === "stage" ? "Posto allo spettacolo" : t.ambiente === "carta" ? "Tavolo da gioco" : "Tavolo al Garden",
      quando: `${t.data} \u00b7 ${t.turno}`, data: t.data, ora: t.turno,
      dettaglio: `${t.persone} ${t.persone === 1 ? "posto" : "posti"}`, importo: 0,
      annulla: { rotta: `/prenotazioni-tavolo/${t.id}/annulla` }
    });
  }
  // Lezioni.
  for (const f of await db.prepare(
    `SELECT p.id, s.data, s.ora, s.prezzo, c.nome FROM fitness_prenotazioni p
     JOIN fitness_sedute s ON s.id=p.seduta_id JOIN corsi_fitness c ON c.id=s.corso_id
     WHERE upper(p.tessera_code)=? AND p.stato='prenotato' AND s.data>=? ORDER BY s.data, s.ora`
  ).all(String(socio.tessera_code).toUpperCase(), oggi).catch(() => [])) {
    voci.push({
      tipo: "fitness", titolo: f.nome, quando: `${f.data} \u00b7 ${f.ora}`,
      data: f.data, ora: f.ora, importo: Number(f.prezzo) || 0,
      annulla: { rotta: `/fitness/iscrizioni/${f.id}/annulla` }
    });
  }
  voci.sort((a, b) => (a.data + a.ora < b.data + b.ora ? -1 : 1));
  res.json({ oggi, voci, quante: voci.length, prossima: voci[0] || null });
});

publicRouter.get("/estratto-conto", async (req, res) => {
  const socio = await socioAttivoByTessera(req.query.tessera_code);
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const dal = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dal || "")) ? String(req.query.dal) : "2000-01-01";
  const al = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.al || "")) ? String(req.query.al) : "2999-12-31";

  const voci = [];
  // Consumazioni: bar, garden, chiosco. Solo quelle battute con la tessera.
  for (const c of await db.prepare(
    // Solo cio' che e' stato PAGATO: "chiusa" non basta come prova che il socio abbia speso
    // qualcosa. Una comanda chiusa senza metodo di pagamento e senza l'ora dell'incasso non e'
    // una spesa — e finiva nell'estratto conto come tale.
    `SELECT numero, zona, punto, totale, metodo_pagamento, date(created_at) g FROM comande
     WHERE socio_id=? AND stato='chiusa' AND (pagata_at IS NOT NULL OR metodo_pagamento IS NOT NULL)
       AND date(created_at) BETWEEN ? AND ? ORDER BY id DESC`
  ).all(socio.id, dal, al)) {
    voci.push({ data: c.g, servizio: c.zona === "garden" ? "Garden" : "Bar", cosa: `Comanda #${c.numero}`, importo: Number(c.totale), pagato: c.metodo_pagamento || null });
  }
  // Lezioni: si pagano, e la disdetta tardiva resta dovuta.
  for (const f of await db.prepare(
    `SELECT p.pagato, p.stato, p.dovuta, s.data, s.ora, s.prezzo, c.nome FROM fitness_prenotazioni p
     JOIN fitness_sedute s ON s.id=p.seduta_id JOIN corsi_fitness c ON c.id=s.corso_id
     WHERE p.tessera_code=? AND s.data BETWEEN ? AND ? ORDER BY s.data DESC`
  ).all(socio.tessera_code, dal, al).catch(() => [])) {
    if (f.stato === "annullato" && Number(f.dovuta) !== 1) continue;
    voci.push({
      data: f.data, servizio: "Fitness",
      cosa: `${f.nome} \u00b7 ${f.ora}` + (f.stato === "annullato" ? " (disdetta tardiva)" : ""),
      importo: Number(f.prezzo || 0), pagato: Number(f.pagato) === 1 ? "gia' pagato" : null
    });
  }
  // Campi: gratuiti. Lo zero e' il punto.
  for (const c of await db.prepare(
    `SELECT p.data, p.slot, ca.nome FROM prenotazioni_campo p JOIN campi ca ON ca.id=p.campo_id
     WHERE p.tessera_code=? AND p.stato='prenotato' AND p.data BETWEEN ? AND ? ORDER BY p.data DESC`
  ).all(socio.tessera_code, dal, al).catch(() => [])) {
    voci.push({ data: c.data, servizio: "Sport", cosa: `${c.nome} \u00b7 ${c.slot}`, importo: 0, pagato: null });
  }
  // Tavoli e platea: la prenotazione non si paga, la cena si paga con la comanda.
  for (const t of await db.prepare(
    `SELECT data, turno, persone, ambiente FROM prenotazioni_tavolo
     WHERE tessera_code=? AND stato='prenotato' AND data BETWEEN ? AND ? ORDER BY data DESC`
  ).all(socio.tessera_code, dal, al).catch(() => [])) {
    voci.push({
      data: t.data, servizio: t.ambiente === "stage" ? "Stage" : t.ambiente === "carta" ? "Casa di Carta" : "Garden",
      cosa: `${t.persone} ${t.persone === 1 ? "posto" : "posti"} \u00b7 ${t.turno}`, importo: 0, pagato: null
    });
  }

  voci.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  const perServizio = {};
  for (const v of voci) {
    perServizio[v.servizio] ??= { volte: 0, speso: 0 };
    perServizio[v.servizio].volte++;
    perServizio[v.servizio].speso += v.importo;
  }
  res.json({
    socio: { nome: socio.nome, cognome: socio.cognome, tessera: socio.tessera_code },
    dal: dal === "2000-01-01" ? null : dal, al: al === "2999-12-31" ? null : al,
    voci,
    per_servizio: Object.entries(perServizio).map(([servizio, v]) => ({ servizio, volte: v.volte, speso: Number(v.speso.toFixed(2)) })),
    totale: Number(voci.reduce((s2, v) => s2 + v.importo, 0).toFixed(2)),
    volte_gratis: voci.filter((v) => v.importo === 0).length,
    nota: "Qui c'e' solo quello che hai fatto con la tessera. Al Bar e al Garden si e' serviti anche senza: quelle consumazioni non compaiono."
  });
});

publicRouter.post("/partite/:id/annulla", async (req, res) => {
  const pa = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!pa || pa.stato === "annullata") return res.status(404).json({ error: "Prenotazione non trovata" });
  const chi = String(req.body?.tessera_code || "").trim();
  if (chi.toUpperCase() !== String(pa.creatore_tessera || "").toUpperCase()) {
    return res.status(403).json({ error: "Puoi disdire solo le tue prenotazioni. Se non e' tua, chiedi al banco." });
  }
  await db.prepare("UPDATE partite_aperte SET stato='annullata' WHERE id=?").run(pa.id);
  await db.prepare("UPDATE prenotazioni_campo SET stato='annullato' WHERE partita_id=?").run(pa.id);
  audit(chi, "annulla_campo", "campi", pa.campo_id, `${pa.data} ${pa.slot}`);
  await registra({
    fatto: "prenotazione_cancellata", servizio: "campi", riferimento: pa.id,
    intestatario: pa.creatore_nome || null, autore: pa.creatore_nome || "il socio (dall'app)",
    canale: "app", quando: `${pa.data} \u00b7 ${pa.slot}`,
    dettaglio: { campo_id: pa.campo_id, posti: pa.posti_totali }
  });
  res.json({ ok: true });
});

publicRouter.post("/prenotazioni-campo/:id/annulla", async (req, res) => {
  const p = await db.prepare("SELECT * FROM prenotazioni_campo WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "prenotato") return res.status(404).json({ error: "Prenotazione non trovata" });
  if (p.tessera_code && req.body?.tessera_code && p.tessera_code !== req.body.tessera_code) return res.status(403).json({ error: "Puoi annullare solo le tue prenotazioni" });
  if (p.partita_id) {
    await db.prepare("UPDATE partite_aperte SET stato='annullata' WHERE id=?").run(p.partita_id);
    // La prenotazione occupa N fasce consecutive: si liberano tutte.
    await db.prepare("UPDATE prenotazioni_campo SET stato='annullato' WHERE partita_id=?").run(p.partita_id);
  } else {
    await db.prepare("UPDATE prenotazioni_campo SET stato='annullato' WHERE id=?").run(p.id);
  }
  audit(req.body?.tessera_code || "socio", "annulla_campo", "campi", p.campo_id, `${p.data} ${p.slot}`);
  res.json({ ok: true });
});

async function notifyMancaUno(partitaId) {
  try {
    const p = await db.prepare("SELECT pa.*, c.nome AS campo_nome, c.sport FROM partite_aperte pa JOIN campi c ON c.id=pa.campo_id WHERE pa.id=?").get(partitaId);
    if (!p || p.stato !== "aperta" || p.aperta_ai_soci === 0) return;
    const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
    if (p.posti_totali - n !== 1) return;
    const iscritti = new Set((await db.prepare("SELECT socio_id FROM partita_iscritti WHERE partita_id=? AND socio_id IS NOT NULL").all(p.id)).map((x) => x.socio_id));
    const soci = await db.prepare("SELECT id FROM soci WHERE attivo=1 AND notifiche_push=1").all();
    const titolo = "Manca 1 giocatore \u{1F3BE}";
    const corpo = `${p.campo_nome} \xB7 ${p.data} ${p.slot}${p.livello ? " \xB7 " + p.livello : ""} \u2014 unisciti alla partita!`;
    const ins = db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)");
    let cnt = 0;
    for (const s of soci) {
      if (iscritti.has(s.id)) continue;
      await ins.run(s.id, "push", "campi", titolo, corpo);
      if (++cnt >= 100) break;
    }
    audit("sistema", "manca_uno", "campi", p.campo_id, `${cnt} avvisati`);
  } catch (_) {
  }
}

publicRouter.get("/campi/partite-aperte", async (req, res) => {
  const data = req.query.data ? String(req.query.data).slice(0, 10) : null;
  const base = "SELECT p.*, c.nome AS campo_nome, c.sport FROM partite_aperte p JOIN campi c ON c.id=p.campo_id WHERE p.stato='aperta' AND p.aperta_ai_soci=1";
  const q = data ? await db.prepare(base + " AND p.data=? ORDER BY p.data,p.slot").all(data) : await db.prepare(base + " ORDER BY p.data,p.slot").all();
  const out = [];
  for (const p of q) {
    const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
    out.push({ id: p.id, campo_id: p.campo_id, campo_nome: p.campo_nome, sport: p.sport, data: p.data, slot: p.slot, slot_fine: p.slot_fine || p.slot, posti_totali: p.posti_totali, iscritti: n, mancano: Math.max(0, p.posti_totali - n), livello: p.livello || "", note: p.note || "", titolare: p.creatore_nome || "", creatore: p.creatore_nome || "" });
  }
  res.json(out);
});

// CHI GIOCA CON IL TITOLARE.
//
// "Solo io" significa **chiuso agli estranei**, non "gioco da solo": Pippo prenota il campo per
// se' e per tre amici, e quei tre non erano scritti da nessuna parte. Al banco non si sapeva
// chi fossero, la Coppa non poteva assegnare punti a chi aveva davvero giocato, e in caso di
// infortunio l'unico nome disponibile era quello del titolare.
//
// Li dichiara il TITOLARE, sulla propria prenotazione, e li puo' aggiungere anche la crew se
// glielo chiede al banco. Due modi:
//   · un SOCIO, con la sua tessera: cosi' vale per la Coppa e per il tetto settimanale;
//   · un OSPITE, col solo nome: chi non ha tessera gioca lo stesso, ma resta scritto.
publicRouter.post("/partite/:id/giocatori", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p || !["aperta", "completa"].includes(p.stato)) return res.status(409).json({ error: "Prenotazione non trovata o gia' chiusa" });
  const chiChiede = String(req.body?.tessera_code || "").trim();
  if (chiChiede.toUpperCase() !== String(p.creatore_tessera || "").toUpperCase()) {
    return res.status(403).json({ error: "Solo chi ha prenotato puo' dire chi gioca. Chiedi al titolare, oppure fallo aggiungere al banco." });
  }
  const iscritti = await db.prepare("SELECT * FROM partita_iscritti WHERE partita_id=?").all(p.id);
  if (iscritti.length >= Number(p.posti_totali)) {
    return res.status(409).json({ error: `Il campo tiene ${p.posti_totali} giocatori e ci sono gia' tutti.` });
  }
  const tesseraNuovo = String(req.body?.giocatore_tessera || "").trim();
  let nome = String(req.body?.nome || "").trim();
  let socioId = null;
  if (tesseraNuovo) {
    const s2 = await socioAttivoByTessera(tesseraNuovo);
    if (!s2) return res.status(404).json({ error: "Tessera non trovata" });
    if (iscritti.some((x) => String(x.tessera_code || "").toUpperCase() === tesseraNuovo.toUpperCase())) {
      return res.status(409).json({ error: "Questo socio e' gia' fra i giocatori" });
    }
    socioId = s2.id;
    nome = (s2.nome + " " + (s2.cognome || "")).trim();
  } else if (!nome) {
    return res.status(400).json({ error: "Scrivi il nome di chi gioca, oppure la sua tessera" });
  }
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)")
    .run(p.id, socioId, tesseraNuovo || null, nome);
  audit(chiChiede, "dichiara_giocatore", "campi", p.campo_id, `${p.data} ${p.slot} \u00b7 ${nome}${tesseraNuovo ? "" : " (ospite)"}`);
  res.status(201).json({ ok: true, giocatori: await db.prepare("SELECT id,nome,tessera_code FROM partita_iscritti WHERE partita_id=? ORDER BY id").all(p.id) });
});

// Toglierne uno: qualcuno rinuncia, e il posto torna libero per un altro.
publicRouter.delete("/partite/:id/giocatori/:iscrittoId", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Prenotazione non trovata" });
  const chiChiede = String(req.query.tessera_code || req.body?.tessera_code || "").trim();
  if (chiChiede.toUpperCase() !== String(p.creatore_tessera || "").toUpperCase()) {
    return res.status(403).json({ error: "Solo chi ha prenotato puo' togliere un giocatore" });
  }
  const r = await db.prepare("SELECT * FROM partita_iscritti WHERE id=? AND partita_id=?").get(req.params.iscrittoId, p.id);
  if (!r) return res.status(404).json({ error: "Giocatore non trovato" });
  // Il titolare non si toglie da solo: e' lui il responsabile della fascia.
  if (String(r.tessera_code || "").toUpperCase() === String(p.creatore_tessera || "").toUpperCase()) {
    return res.status(409).json({ error: "Il titolare non si puo' togliere: annulla la prenotazione, semmai." });
  }
  await db.prepare("DELETE FROM partita_iscritti WHERE id=?").run(r.id);
  audit(chiChiede, "toglie_giocatore", "campi", p.campo_id, `${p.data} ${p.slot} \u00b7 ${r.nome}`);
  res.json({ ok: true, giocatori: await db.prepare("SELECT id,nome,tessera_code FROM partita_iscritti WHERE partita_id=? ORDER BY id").all(p.id) });
});

// Chi gioca, per il titolare e per il banco.
publicRouter.get("/partite/:id/giocatori", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Prenotazione non trovata" });
  const g = await db.prepare("SELECT id,nome,tessera_code FROM partita_iscritti WHERE partita_id=? ORDER BY id").all(p.id);
  res.json({
    partita: { id: p.id, data: p.data, slot: p.slot, posti: p.posti_totali, titolare: p.creatore_nome, aperta: p.aperta_ai_soci === 1 },
    giocatori: g.map((x) => ({ ...x, ospite: !x.tessera_code })),
    posti_liberi: Math.max(0, Number(p.posti_totali) - g.length)
  });
});

publicRouter.post("/partite-aperte/:id/unisciti", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "aperta") return res.status(409).json({ error: "Partita non disponibile" });
  if (!await par("campi_unisciti")) return res.status(409).json({ error: "Le partite aperte sono disattivate: ogni prenotazione e\u0300 riservata al titolare" });
  if (p.aperta_ai_soci === 0) return res.status(409).json({ error: "Prenotazione riservata: non aperta ai soci" });
  const { tessera_code } = req.body || {};
  const socio = await socioAttivoByTessera(tessera_code);
  if (!socio) return res.status(403).json({ error: "Serve la tessera di un socio per unirti" });
  if (socio.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });
  const gia = await db.prepare("SELECT id FROM partita_iscritti WHERE partita_id=? AND tessera_code=?").get(p.id, tessera_code);
  if (gia) return res.status(409).json({ error: "Sei gi\xE0 iscritto a questa partita" });
  // Unirsi e' il modo piu' furbo di allungare la catena: valgono le stesse regole.
  const campo = await db.prepare("SELECT * FROM campi WHERE id=?").get(p.campo_id);
  const slotPartita = (await db.prepare("SELECT slot FROM prenotazioni_campo WHERE partita_id=? AND stato='prenotato' ORDER BY slot").all(p.id)).map((x) => x.slot);
  if (campo) {
    if (await par("campi_max_giorno")) {
      const maxG = Math.max(1, Number(await par("campi_max_giorno_n")) || 1);
      const oggi = await quotaUsata(campo.id, socio.id, p.data, p.data);
      if (oggi >= maxG) return res.status(409).json({ error: `Hai gi\u00e0 ${oggi === 1 ? "una prenotazione" : oggi + " prenotazioni"} oggi su ${campo.nome}: per oggi il campo passa ad altri.` });
    }
    if (await par("campi_limita_settimana")) {
      const usate = await prenSettimana(campo.id, socio.id, p.data);
      if (usate >= campo.max_pren_settimana) return res.status(409).json({ error: `Hai gi\u00e0 ${usate} prenotazioni questa settimana su ${campo.nome} (massimo ${campo.max_pren_settimana})` });
    }
    const catena = await catenaTroppoLunga(campo, p.data, slotPartita, socio.id);
    if (catena) return res.status(409).json({ error: catena });
  }
  const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
  if (n >= p.posti_totali) return res.status(409).json({ error: "Partita gi\xE0 al completo" });
  const nome = (socio.nome + " " + (socio.cognome || "")).trim();
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)").run(p.id, socio.id, tessera_code, nome);
  const nuovi = n + 1;
  const completa = nuovi >= p.posti_totali;
  if (completa) await db.prepare("UPDATE partite_aperte SET stato='completa' WHERE id=?").run(p.id);
  audit(tessera_code, "unisce_partita", "campi", p.campo_id, `${p.data} ${p.slot}`);
  if (!completa) await notifyMancaUno(p.id);
  res.json({ ok: true, iscritti: nuovi, posti_totali: p.posti_totali, completa });
});

// ---- Cena al Garden: due turni, tavolo assegnato dal centro alla periferia ---------------
// Il socio non sceglie il tavolo: indica quante persone e il turno. Il sistema assegna il
// tavolo piu' centrale fra quelli liberi, cosi' il Garden si riempie dal centro verso fuori.
publicRouter.get("/garden/turni", async (req, res) => {
  const data = String(req.query.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  const out = [];
  for (const t of await turni()) {
    const s = await statoTurno(data, t);
    out.push({ turno: t, posti_liberi: s.posti_liberi, posti_totali: s.posti_totali, coperti_prenotati: s.coperti_prenotati });
  }
  res.json({ data, turni: out });
});
// Nelle sere con spettacolo, chi prenota la cena al Garden prenota CONTEMPORANEAMENTE i posti
// davanti al palco, tanti quanti i commensali: e' una prenotazione sola, non due. Il resto
// della platea resta libero per chi viene solo per l'esibizione, versando il contributo.
// Nascondere un tasto non e' un divieto: chi conosce l'indirizzo lo chiama lo stesso. Le
// regole sui minorenni vivono qui, sul server, o non esistono.
async function bloccoMinorenne(socio, cosa) {
  const eta = etaDi(socio);
  if (eta == null || eta >= 18) return null;

  // Sotto i diciotto anni non si prende un impegno a pagamento: non e' una regola del
  // residence, e' la capacita' di agire. Per questo NON dipende da un parametro — nessun
  // gestore puo' accenderla — e vale fino ai 18 anni, non fino alla soglia dell'interfaccia,
  // che serve solo a decidere quale versione dell'app mostrare.
  const perTramite = " Chiedi a un adulto di farlo per te.";
  if (cosa === "ordine") return "Per ordinare serve un adulto: fino ai 18 anni non si possono fare acquisti da soli." + perTramite;
  if (cosa === "serata") return "La serata ha una quota: fino ai 18 anni la prenota un adulto." + perTramite;
  if (cosa === "fitness") return "La lezione si paga: fino ai 18 anni l'iscrizione la fa un adulto." + perTramite;
  if (cosa === "tavolo") return "Il tavolo per la cena lo prenota un adulto." + perTramite;
  // Gli alcolici non sono un impegno di spesa: sono un divieto di legge, e non ha rimedio.
  // Nessun adulto puo' ordinarli "per conto" di un minorenne: qui non c'e' un per tramite.
  if (cosa === "alcolici") return "Bevande alcoliche: non si servono sotto i 18 anni.";

  // I campi invece sono gratuiti: nessun impegno di spesa. Qui decide il gestore.
  if (cosa === "campo" && !await par("ragazzi_prenotano_campi")) {
    return "Per prenotare il campo serve un adulto della tua casata: tu puoi unirti a una partita gi\u00e0 aperta.";
  }
  return null;
}

function etaDi(socio) {
  if (!socio || !socio.data_nascita) return null;
  const n = new Date(String(socio.data_nascita).slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(n.getTime())) return null;
  return Math.floor((Date.now() - n.getTime()) / (365.25 * 864e5));
}

async function spettacoloDelGiorno(data) {
  return await db.prepare(
    "SELECT p.id,p.ora,f.titolo FROM proiezioni p LEFT JOIN film f ON f.id=p.film_id WHERE p.data=? AND p.stato='programmata' ORDER BY p.ora LIMIT 1"
  ).get(data) || null;
}

publicRouter.post("/garden/prenota", async (req, res) => {
  if (!await par("garden_prenotazione_cena")) return res.status(409).json({ error: "La prenotazione della cena non e\u0300 attiva" });
  const b = req.body || {};
  const data = String(b.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  const socio = await socioAttivoByTessera(b.tessera_code);
  if (!socio) return res.status(403).json({ error: "Serve la tessera di un socio per prenotare" });
  if (socio.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });
  const noMin = await bloccoMinorenne(socio, "tavolo");
  if (noMin) return res.status(403).json({ error: noMin });
  const nome = (socio.nome + " " + (socio.cognome || "")).trim();
  const r = await prenotaTavolo({ data, turno: String(b.turno || ""), persone: b.persone, socio, tessera_code: b.tessera_code, nome, origine: "app", note: b.note });
  if (r.error) {
    // Un rifiuto secco manda via il socio: se c'e' spazio nell'altro turno o nei giorni
    // vicini, si dice. Costa due query e cambia l'esito della serata.
    const alt = [];
    for (const t of await turni("garden")) {
      if (t === String(b.turno)) continue;
      const st = await statoTurno(data, t, "garden");
      if (st.posti_liberi >= Math.max(1, Number(b.persone) || 1)) alt.push({ data, turno: t, posti_liberi: st.posti_liberi });
    }
    for (let g = 1; g <= 3 && alt.length < 3; g++) {
      const d2 = new Date(new Date(data + "T12:00:00Z").getTime() + g * 864e5).toISOString().slice(0, 10);
      for (const t of await turni("garden")) {
        const st = await statoTurno(d2, t, "garden");
        if (st.posti_liberi >= Math.max(1, Number(b.persone) || 1)) { alt.push({ data: d2, turno: t, posti_liberi: st.posti_liberi }); break; }
      }
    }
    return res.status(409).json({ error: r.error, alternative: alt.slice(0, 3) });
  }
  audit(b.tessera_code, "prenota_tavolo", "prenotazioni_tavolo", r.id, `${data} ${r.turno} \xB7 ${r.persone}p`);

  // Sera con spettacolo: gli stessi commensali hanno i loro posti davanti al palco.
  let stage = null;
  const sp = await spettacoloDelGiorno(data);
  // Solo il primo turno: chi cena alle 21:30 e' a tavola mentre lo spettacolo e' in corso,
  // e non puo' occupare due posti nello stesso momento.
  const primoTurno = (await turni("garden"))[0];
  if (sp && String(b.turno) !== primoTurno) {
    stage = { non_spettante: true, spettacolo: sp.titolo || "spettacolo", ora: sp.ora, motivo: `I posti davanti al palco spettano al turno delle ${primoTurno}: al secondo turno si cena mentre lo spettacolo e\u0300 in corso.` };
  } else if (sp) {
    const ps = await prenotaTavolo({
      data, turno: sp.ora, persone: r.persone, socio, tessera_code: b.tessera_code, nome,
      origine: "app", ambiente: "stage", proiezione_id: sp.id, categoria: "cena"
    });
    if (!ps.error) {
      await db.prepare("UPDATE prenotazioni_tavolo SET note=? WHERE id=?").run("con cena al Garden", ps.id);
      stage = { spettacolo: sp.titolo || "spettacolo", ora: sp.ora, posti: ps.tavoli, id: ps.id };
      audit(b.tessera_code, "prenota_stage_con_cena", "prenotazioni_tavolo", ps.id, `${data} ${sp.ora} \xB7 ${r.persone}p`);
    } else {
      stage = { errore: ps.error, spettacolo: sp.titolo || "spettacolo", ora: sp.ora };
    }
  }
  // La conferma non resta solo sullo schermo: parte una notifica con giorno, turno e tavolo,
  // che il socio ritrova sul telefono la sera stessa senza riaprire l'app. Se le notifiche non
  // sono attive (o il socio non le ha concesse) non cambia nulla: la prenotazione e' fatta.
  // Resta scritto: chi ha prenotato, per quando, quanti coperti e quale tavolo. Fra dieci anni
  // la risposta a "io avevo prenotato" non sara' "mi pare".
  await registra({
    fatto: "prenotazione_creata", servizio: "garden", riferimento: r.id,
    socio_id: socio ? socio.id : null,
    intestatario: socio ? [socio.nome, socio.cognome].filter(Boolean).join(" ") : (req.body?.nome || null),
    autore: socio ? [socio.nome, socio.cognome].filter(Boolean).join(" ") : "socio",
    canale: "app", quando: `${data} \u00b7 turno ${r.turno}`,
    dettaglio: { persone: r.persone, tavoli: r.tavoli || [], stage }
  });
  try {
    const gg = new Date(data + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    const tav = Array.isArray(r.tavoli) && r.tavoli.length ? r.tavoli.join(", ") : null;
    await sendToSocio(socio.id, {
      title: "Tavolo prenotato al Garden",
      body: `${gg} \xB7 turno ${r.turno} \xB7 ${tav ? "tavolo " + tav : r.persone + " persone"}${tav ? " \xB7 " + r.persone + " persone" : ""}`,
      url: "/",
      tag: "tavolo-garden"
    });
  } catch (_) {
  }
  res.status(201).json({ ok: true, ...r, stage });
});
publicRouter.get("/garden/mie-prenotazioni", async (req, res) => {
  const t = String(req.query.tessera_code || "");
  if (!t) return res.json([]);
  const rows = await db.prepare("SELECT id,data,turno,persone,tavoli,stato FROM prenotazioni_tavolo WHERE tessera_code=? AND stato='prenotato' AND data>=date('now','-1 day') ORDER BY data,turno").all(t);
  res.json(rows.map((r) => ({ ...r, tavoli: JSON.parse(r.tavoli || "[]") })));
});
publicRouter.post("/garden/prenotazioni/:id/annulla", async (req, res) => {
  const p = await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "prenotato") return res.status(404).json({ error: "Prenotazione non trovata" });
  if (p.tessera_code && req.body?.tessera_code && p.tessera_code !== req.body.tessera_code) return res.status(403).json({ error: "Puoi annullare solo le tue prenotazioni" });
  await db.prepare("UPDATE prenotazioni_tavolo SET stato='annullato' WHERE id=?").run(p.id);
  // Se la cena salta, saltano anche i posti davanti al palco: erano la stessa prenotazione.
  await db.prepare(
    "UPDATE prenotazioni_tavolo SET stato='annullato' WHERE ambiente='stage' AND data=? AND tessera_code=? AND stato='prenotato' AND note='con cena al Garden'"
  ).run(p.data, p.tessera_code || "");
  // Per una contestazione non basta sapere che e' stata cancellata: conta CHI l'ha chiesto.
  const chi = await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(p.tessera_code || "").catch(() => null);
  await registra({
    fatto: "prenotazione_cancellata", servizio: "garden", riferimento: p.id,
    socio_id: chi ? chi.id : null,
    intestatario: chi ? [chi.nome, chi.cognome].filter(Boolean).join(" ") : (p.nome || null),
    autore: req.body?.tessera_code ? "il socio (dall'app)" : "socio",
    canale: "app", quando: `${p.data} \u00b7 turno ${p.turno || ""}`,
    dettaglio: { persone: p.persone, motivo: req.body?.motivo || null }
  });
  audit(req.body?.tessera_code || "socio", "annulla_tavolo", "prenotazioni_tavolo", p.id);
  res.json({ ok: true });
});

// Chi c'e' nella mia casata, col capitano in evidenza. Si vede solo il nome e il ruolo:
// nessun contatto, nessuna data di nascita — l'elenco serve a riconoscersi, non a schedarsi.
publicRouter.get("/casate/:id/appartenenti", async (req, res) => {
  const casata = await db.prepare("SELECT id,nome,colore,motto,punti FROM casate WHERE id=?").get(req.params.id);
  if (!casata) return res.status(404).json({ error: "Casata non trovata" });
  const rows = await db.prepare(
    "SELECT nome,cognome,ruolo,tipo_profilo FROM soci WHERE casata_id=? AND attivo=1 ORDER BY (LOWER(ruolo)='capitano') DESC, nome, cognome"
  ).all(casata.id);
  const membri = rows.map((r) => ({
    nome: (r.nome + " " + (r.cognome || "")).trim(),
    ruolo: r.ruolo || "Socio",
    capitano: String(r.ruolo || "").toLowerCase() === "capitano",
    profilo: r.tipo_profilo
  }));
  res.json({
    casata,
    capitano: membri.find((m) => m.capitano) || null,
    membri,
    quanti: membri.length
  });
});

// ---- Cinema: cartellone e posti in platea ------------------------------------------------
publicRouter.get("/cinema", async (req, res) => {
  const film = await db.prepare("SELECT id,titolo,regia,anno,durata_min,genere,sinossi,vm FROM film WHERE attivo=1 ORDER BY ordine,id").all();
  const rows = await db.prepare(
    "SELECT p.id,p.data,p.ora,p.film_id,p.note,f.titolo,f.regia,f.durata_min,f.genere,f.vm FROM proiezioni p LEFT JOIN film f ON f.id=p.film_id WHERE p.stato='programmata' AND p.data>=date('now','-1 day') ORDER BY p.data,p.ora"
  ).all();
  const prenotabile = await par("cinema_prenotazione");
  const contributo = Number(await par("stage_contributo")) || 0;
  const prossime = [];
  for (const p of rows) {
    const st = await statoTurno(p.data, p.ora, "stage", null);
    prossime.push({
      ...p, prenotabile,
      posti_liberi: st.posti_liberi,
      standard_liberi: st.standard_liberi,
      // Gli extra si aprono solo a standard esauriti: al socio si dice quello che vede.
      solo_extra: st.standard_liberi <= 0 && st.posti_liberi > 0
    });
  }
  const primaFila = Number(await par("stage_prima_fila_over70")) || 0;
  res.json({ film, prossime, prenotabile, contributo, prima_fila_over70: primaFila, nota_contributo: contributo > 0
    ? `Chi cena al Garden ha gia\u0300 il suo posto davanti al palco. Per il solo spettacolo si versa un contributo di \u20ac ${contributo.toFixed(2)} all'ingresso.`
    : "Ingresso libero." });
});
publicRouter.post("/cinema/:id/prenota", async (req, res) => {
  if (!await par("cinema_prenotazione")) return res.status(409).json({ error: "La prenotazione dei posti non e\u0300 attiva" });
  const p = await db.prepare("SELECT * FROM proiezioni WHERE id=? AND stato='programmata'").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Proiezione non trovata" });
  const socio = await socioAttivoByTessera(req.body?.tessera_code);
  if (!socio) return res.status(403).json({ error: "Serve la tessera di un socio per prenotare" });
  if (socio.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });
  const nome = (socio.nome + " " + (socio.cognome || "")).trim();
  const eta = etaDi(socio);
  const r = await prenotaTavolo({
    data: p.data, turno: p.ora, persone: req.body?.persone, socio, tessera_code: req.body.tessera_code,
    nome, origine: "app", ambiente: "stage", proiezione_id: p.id, layout_id: p.layout_id,
    categoria: "spettacolo", over70: eta != null && eta >= 70
  });
  if (r.error) return res.status(409).json({ error: r.error });
  audit(req.body.tessera_code, "prenota_cinema", "proiezioni", p.id, `${p.data} ${p.ora} \xB7 ${r.persone}p`);
  res.status(201).json({ ok: true, ...r, posti: r.tavoli });
});
publicRouter.get("/cinema/mie-prenotazioni", async (req, res) => {
  const t = String(req.query.tessera_code || "");
  if (!t) return res.json([]);
  const rows = await db.prepare(
    "SELECT pt.id,pt.data,pt.turno,pt.persone,pt.tavoli,f.titolo FROM prenotazioni_tavolo pt LEFT JOIN proiezioni p ON p.id=pt.proiezione_id LEFT JOIN film f ON f.id=p.film_id WHERE pt.tessera_code=? AND pt.ambiente='stage' AND pt.stato='prenotato' AND pt.data>=date('now','-1 day') ORDER BY pt.data"
  ).all(t);
  res.json(rows.map((r) => ({ ...r, posti: JSON.parse(r.tavoli || "[]") })));
});

// ---- Area fitness: lezioni con istruttore, si paga in contanti a fine lezione ------------
publicRouter.get("/fitness", async (req, res) => {
  const corsi = await db.prepare("SELECT id,nome,istruttore,descrizione,data_inizio,data_fine,ora,durata_min,prezzo,masterclass,prezzo_master,colore FROM corsi_fitness WHERE attivo=1 ORDER BY ordine,id").all();
  res.json({
    corsi: corsi.map((c) => ({ ...c, masterclass: !!c.masterclass })),
    lezioni: await seduteFitness({}),
    prenotazione_obbligatoria: await par("fitness_prenotazione_obbligatoria"),
    minimo_attivo: await par("fitness_minimo"),
    // Entro quanti minuti si disdice senza pagare: l'app lo deve dire PRIMA dell'iscrizione,
    // non dopo che il socio ha disdetto ed e' rimasto con la lezione da pagare.
    disdetta_minuti: Number(await par("fitness_disdetta_minuti")) || 0,
    // Fascia della griglia: sempre almeno queste ore, cosi' il calendario ha una forma stabile
    // e le lezioni si collocano invece di comparire dove capita.
    griglia_da: String(await par("fitness_griglia_da") || "16:00"),
    griglia_a: String(await par("fitness_griglia_a") || "20:00")
  });
});
publicRouter.post("/fitness/sedute/:id/prenota", async (req, res) => {
  const socio = await socioAttivoByTessera(req.body?.tessera_code);
  if (!socio) return res.status(403).json({ error: "Serve la tessera di un socio per iscriverti" });
  if (socio.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });
  const noFit = await bloccoMinorenne(socio, "fitness");
  if (noFit) return res.status(403).json({ error: noFit });
  const nome = (socio.nome + " " + (socio.cognome || "")).trim();
  const r = await prenotaSeduta({ sedutaId: Number(req.params.id), socio, tessera_code: req.body.tessera_code, nome, origine: "app" });
  if (r.error) return res.status(409).json({ error: r.error });
  audit(req.body.tessera_code, "iscrizione_fitness", "fitness_sedute", req.params.id, `${r.data} ${r.ora}`);
  res.status(201).json({ ok: true, ...r });
});
publicRouter.get("/fitness/mie-iscrizioni", async (req, res) => {
  const t = String(req.query.tessera_code || "");
  if (!t) return res.json([]);
  const rows = await db.prepare(
    `SELECT p.id, s.data, s.ora, s.prezzo, s.masterclass, s.titolo, s.istruttore, c.nome AS corso_nome
     FROM fitness_prenotazioni p JOIN fitness_sedute s ON s.id=p.seduta_id JOIN corsi_fitness c ON c.id=s.corso_id
     WHERE p.tessera_code=? AND p.stato='prenotato' AND s.data>=date('now','-1 day') ORDER BY s.data,s.ora`
  ).all(t);
  res.json(rows.map((r) => ({ ...r, masterclass: !!r.masterclass })));
});
publicRouter.post("/fitness/iscrizioni/:id/annulla", async (req, res) => {
  const p = await db.prepare("SELECT * FROM fitness_prenotazioni WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "prenotato") return res.status(404).json({ error: "Iscrizione non trovata" });
  if (p.tessera_code && req.body?.tessera_code && p.tessera_code !== req.body.tessera_code) return res.status(403).json({ error: "Puoi annullare solo le tue iscrizioni" });
  // LA DISDETTA TARDIVA SI PAGA. Non e' una penale inventata: mezz'ora prima l'istruttore e'
  // gia' in viaggio, la lezione parte comunque e quel posto non si rivende a nessuno. Chi
  // disdice in tempo non paga niente; chi disdice all'ultimo, si'.
  const sed = await db.prepare("SELECT * FROM fitness_sedute WHERE id=?").get(p.seduta_id);
  const margine = Number(await par("fitness_disdetta_minuti"));
  const tardiva = sed && margine > 0 && scadenzaGiaPassata(sed.data, sed.ora, margine);
  await db.prepare("UPDATE fitness_prenotazioni SET stato='annullato', dovuta=?, annullata_at=? WHERE id=?")
    .run(tardiva ? 1 : 0, new Date().toISOString(), p.id);
  await registra({
    fatto: "iscrizione_annullata", servizio: "fitness", riferimento: p.id,
    socio_id: p.socio_id || null, intestatario: p.nome || null,
    autore: p.nome || "il socio (dall'app)", canale: "app",
    quando: sed ? `${sed.data} \u00b7 ${sed.ora}` : null,
    importo: tardiva ? Number(sed?.prezzo || 0) : 0,
    dettaglio: { tardiva, margine_minuti: margine }
  });
  res.json({
    ok: true,
    dovuta: !!tardiva,
    messaggio: tardiva
      ? `Iscrizione annullata, ma la lezione resta dovuta: si disdice senza pagare fino a ${margine} minuti prima dell'inizio.`
      : "Iscrizione annullata. Non c'e' niente da pagare."
  });
});

// Il titolare dichiara i compagni: vale anche per la prenotazione RISERVATA, che resta chiusa
// agli estranei ma deve dire chi gioca. Senza questo, il numero legale sarebbe una tagliola per
// chi non apre ai soci, e la catena resterebbe cieca proprio sul caso piu' comune.
publicRouter.post("/partite-aperte/:id/aggiungi", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p || !["aperta", "completa"].includes(p.stato)) return res.status(409).json({ error: "Prenotazione non disponibile" });
  const richiedente = await socioAttivoByTessera(req.body?.tessera_titolare);
  if (!richiedente || richiedente.id !== p.titolare_socio_id) {
    return res.status(403).json({ error: "Solo il titolare pu\u00f2 aggiungere i compagni" });
  }
  const compagno = await socioAttivoByTessera(req.body?.tessera_code);
  if (!compagno) return res.status(403).json({ error: "Serve la tessera del socio da aggiungere" });
  if (compagno.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });
  const gia = await db.prepare("SELECT id FROM partita_iscritti WHERE partita_id=? AND tessera_code=?").get(p.id, req.body.tessera_code);
  if (gia) return res.status(409).json({ error: "Gi\u00e0 fra i giocatori di questa prenotazione" });
  const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
  if (n >= p.posti_totali) return res.status(409).json({ error: "Posti esauriti" });

  // Il compagno aggiunto e' un giocatore a tutti gli effetti: valgono le stesse regole
  // anti-monopolio di chi si unisce da solo, altrimenti basterebbe farsi aggiungere.
  const campo = await db.prepare("SELECT * FROM campi WHERE id=?").get(p.campo_id);
  if (campo) {
    if (await par("campi_max_giorno")) {
      const maxG = Math.max(1, Number(await par("campi_max_giorno_n")) || 1);
      const oggi = await quotaUsata(campo.id, compagno.id, p.data, p.data);
      if (oggi >= maxG) return res.status(409).json({ error: `${compagno.nome} ha gi\u00e0 giocato oggi su ${campo.nome}.` });
    }
    const slotPartita = (await db.prepare("SELECT slot FROM prenotazioni_campo WHERE partita_id=? AND stato='prenotato' ORDER BY slot").all(p.id)).map((x) => x.slot);
    const catena = await catenaTroppoLunga(campo, p.data, slotPartita, compagno.id);
    if (catena) return res.status(409).json({ error: catena });
  }
  const nome = (compagno.nome + " " + (compagno.cognome || "")).trim();
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)").run(p.id, compagno.id, req.body.tessera_code, nome);
  const nuovi = n + 1;
  if (nuovi >= p.posti_totali && p.aperta_ai_soci !== 0) await db.prepare("UPDATE partite_aperte SET stato='completa' WHERE id=?").run(p.id);
  audit(req.body.tessera_titolare, "aggiunge_giocatore", "campi", p.campo_id, `${p.data} ${p.slot} \xB7 ${nome}`);
  res.json({ ok: true, iscritti: nuovi, posti_totali: p.posti_totali, numero_legale: campo ? await statoNumeroLegale(campo, p, nuovi) : null });
});

// I giocatori dichiarati di una prenotazione: serve all'app per mostrare chi c'e' e chi manca.
publicRouter.get("/partite-aperte/:id/giocatori", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Prenotazione non trovata" });
  const campo = await db.prepare("SELECT * FROM campi WHERE id=?").get(p.campo_id);
  const iscritti = await db.prepare("SELECT nome,tessera_code FROM partita_iscritti WHERE partita_id=? ORDER BY id").all(p.id);
  res.json({
    partita_id: p.id, data: p.data, slot: p.slot, stato: p.stato,
    aperta_ai_soci: p.aperta_ai_soci !== 0, titolare: p.creatore_nome || "",
    posti_totali: p.posti_totali, giocatori: iscritti,
    numero_legale: campo ? await statoNumeroLegale(campo, p, iscritti.length) : null
  });
});

// ---- Casa di Carta: tavoli da gioco a turni ----------------------------------------------
// Stesso motore del Garden e della platea: cambiano le etichette e i turni. Il numero legale
// evita i sit-in: se al tavolo non c'e' nessuno che si sia dichiarato, il tavolo torna libero.
async function liberaTavoliCarta(data) {
  if (!await par("carta_numero_legale")) return 0;
  const minGio = Math.max(1, Number(await par("carta_min_giocatori")) || 1);
  const minuti = Math.max(1, Number(await par("carta_numero_legale_minuti")) || 20);
  const oggi = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (data > oggi) return 0;
  const pren = await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE ambiente='carta' AND data=? AND stato='prenotato'").all(data);
  let liberate = 0;
  for (const p of pren) {
    const scadenza = new Date(new Date(`${p.data}T${String(p.turno).slice(0, 5)}:00`).getTime() - minuti * 60000);
    if ((/* @__PURE__ */ new Date()) < scadenza) continue;
    const creata = p.created_at ? new Date(String(p.created_at).replace(" ", "T") + "Z") : null;
    const inizio = new Date(`${p.data}T${String(p.turno).slice(0, 5)}:00`).getTime();
    if (creata && creata >= scadenza && (/* @__PURE__ */ new Date()).getTime() < Math.min(creata.getTime() + Math.min(10, minuti) * 60000, inizio)) continue;
    if (Number(p.persone) >= minGio) continue;
    await db.prepare("UPDATE prenotazioni_tavolo SET stato='annullato' WHERE id=?").run(p.id);
    audit("sistema", "decadenza_tavolo_carta", "prenotazioni_tavolo", p.id, `${p.data} ${p.turno} \xB7 ${p.persone}/${minGio}`);
    liberate++;
  }
  return liberate;
}

publicRouter.get("/carta/turni", async (req, res) => {
  const data = String(req.query.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  await liberaTavoliCarta(data);
  const attiva = await par("carta_prenotazione");
  const out = [];
  for (const t of await turni("carta")) {
    const st = await statoTurno(data, t, "carta");
    out.push({
      turno: t, etichetta: etichettaTurno(t), scopo: scopoTurno(t),
      posti_liberi: st.posti_liberi, posti_totali: st.posti_totali,
      tavoli_liberi: st.tavoli.filter((x) => x.libero).length,
      tavoli_totali: st.tavoli.length, coperti_prenotati: st.coperti_prenotati
    });
  }
  res.json({
    data, turni: out, prenotabile: attiva,
    minimo: await par("carta_numero_legale") ? Number(await par("carta_min_giocatori")) : null
  });
});

publicRouter.post("/carta/prenota", async (req, res) => {
  if (!await par("carta_prenotazione")) return res.status(409).json({ error: "La prenotazione dei tavoli non e\u0300 attiva" });
  const b = req.body || {};
  const data = String(b.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  const socio = await socioAttivoByTessera(b.tessera_code);
  if (!socio) return res.status(403).json({ error: "Serve la tessera di un socio per prenotare" });
  if (socio.attivo === 0) return res.status(403).json({ error: "Tessera non attiva" });

  // Numero legale: al tavolo si va per giocare, non per occupare.
  // Il minimo vale al tavolo da GIOCO: a carte da soli non si gioca. Al coworking si lavora
  // benissimo da soli, e chiedere due persone per una postazione non avrebbe senso.
  const perGioco = scopoTurno(String(b.turno || "")) === "gioco";
  const minGio = perGioco && await par("carta_numero_legale") ? Math.max(1, Number(await par("carta_min_giocatori")) || 1) : 1;
  const persone = Math.max(1, Number(b.persone) || 1);
  if (persone < minGio) return res.status(409).json({ error: `Al tavolo da gioco servono almeno ${minGio} giocatori` });

  // Turni al giorno per socio: i tavoli devono girare.
  const maxT = Math.max(1, Number(await par("carta_max_turni_giorno")) || 1);
  const gia = await db.prepare("SELECT COUNT(*) n FROM prenotazioni_tavolo WHERE ambiente='carta' AND data=? AND stato='prenotato' AND socio_id=?").get(data, socio.id);
  if (Number(gia?.n || 0) >= maxT) {
    return res.status(409).json({ error: `Hai gi\u00e0 ${gia.n} ${gia.n === 1 ? "turno" : "turni"} prenotati oggi alla Casa di Carta: il tavolo passa ad altri.` });
  }

  await liberaTavoliCarta(data);
  const nome = (socio.nome + " " + (socio.cognome || "")).trim();
  const r = await prenotaTavolo({ data, turno: String(b.turno || ""), persone, socio, tessera_code: b.tessera_code, nome, origine: "app", ambiente: "carta", note: b.note, scopo: scopoTurno(String(b.turno || "")) });
  if (r.error) return res.status(409).json({ error: r.error });
  if (b.gioco_id) await db.prepare("UPDATE prenotazioni_tavolo SET gioco_id=? WHERE id=?").run(Number(b.gioco_id), r.id);
  audit(b.tessera_code, "prenota_tavolo_carta", "prenotazioni_tavolo", r.id, `${data} ${r.turno} \xB7 ${persone}p`);
  res.status(201).json({ ok: true, ...r, tavoli: r.tavoli });
});

publicRouter.get("/carta/mie-prenotazioni", async (req, res) => {
  const t = String(req.query.tessera_code || "");
  if (!t) return res.json([]);
  const rows = await db.prepare(
    "SELECT pt.id,pt.data,pt.turno,pt.persone,pt.tavoli,pt.scopo,g.nome AS gioco FROM prenotazioni_tavolo pt LEFT JOIN cdc_giochi g ON g.id=pt.gioco_id WHERE pt.tessera_code=? AND pt.ambiente='carta' AND pt.stato='prenotato' AND pt.data>=date('now','-1 day') ORDER BY pt.data,pt.turno"
  ).all(t);
  res.json(rows.map((r) => ({ ...r, tavoli: JSON.parse(r.tavoli || "[]"), scopo: r.scopo || scopoTurno(r.turno) })));
});

publicRouter.post("/carta/prenotazioni/:id/annulla", async (req, res) => {
  const p = await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE id=? AND ambiente='carta'").get(req.params.id);
  if (!p || p.stato !== "prenotato") return res.status(404).json({ error: "Prenotazione non trovata" });
  if (p.tessera_code && req.body?.tessera_code && p.tessera_code !== req.body.tessera_code) return res.status(403).json({ error: "Puoi annullare solo le tue prenotazioni" });
  await db.prepare("UPDATE prenotazioni_tavolo SET stato='annullato' WHERE id=?").run(p.id);
  res.json({ ok: true });
});

// ---- Numeri da chiamare -------------------------------------------------------------------
// Qui NON c'e' piu' alcuna segnalazione al personale, e la ragione va scritta perche' non
// venga reintrodotta per buone intenzioni.
//
// Avvisare la Crew significava assumersi un servizio legato alla salute. Un servizio del
// genere o si presta sempre, con personale reperibile e tracciabilita', o non si presta: non
// puo' funzionare dalle ore alle ore, non si puo' scaricare con un avviso ("prendi atto che
// potrebbe non funzionare proprio quando serve" e' l'ammissione che non e' adatto), e non si
// puo' accendere e spegnere secondo la disponibilita' del personale. Un residence vacanziero
// non e' una centrale operativa.
//
// Resta cio' che non crea alcun dovere: i numeri da chiamare. La telefonata la fa il telefono,
// non passa da noi. Se manca il campo non funziona la chiamata — come sarebbe successo
// comunque, con o senza applicazione. Non aggiungiamo un servizio: aggiungiamo tasti grandi
// al posto di una rubrica.
publicRouter.get("/aiuto/numeri", async (req, res) => {
  const numero = String(await par("aiuto_numero") || "").trim();
  res.json({
    emergenza: "112",
    residence: numero || null,
    avviso: "Il 112 e\u0300 il numero unico delle emergenze. Il residence non e\u0300 un servizio di soccorso."
  });
});

export { publicRouter };

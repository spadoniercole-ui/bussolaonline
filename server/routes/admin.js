import { Router } from "express";
import { readFileSync, unlinkSync, statSync } from "node:fs";
import * as XLSX from "xlsx";
import { asyncify } from '../asyncroute.js';
import { createSession, destroySession, hashPassword, requireAdmin, verifyPassword } from '../auth.js';
import { assegnaCoppa, esitoCorrente, salvaEsito } from '../contest.js';
import { encryptJSON, tryDecryptJSON } from '../crypto.js';
import { nextTessera, DB_PATH, IS_REMOTE, audit, db, getSetting, insertSocioUnique, setSetting, url } from '../db.js';
import { inferCategoria, inferPunto, inferStazione } from '../menucat.js';
import { CAPS_DELEGABILI, capsInfo, hasCap, parsePermessi, requireCap } from '../permessi.js';
import { pushEnabled, sendToSoci, sendToSocio } from '../push.js';
import { qrSvg } from '../qrcode.js';
import { getConfig, ordinaCoda, setConfig, setSelfOrderAperto, statoCompleto } from '../selforder.js';
import { archiviaEdizione, generaCalendario, getTabellone, graduatoriaFinale, registraRisultato } from '../tournament.js';
import { alboCasate, campioneInCarica, chiudiStagione, punteggiCoppa, ricalcolaCoppa, stagioneCorrente, statoChiusura } from '../coppa.js';
import { listino as listinoCampo, prezzoPrenotazione as prezzoCampo } from '../tariffe.js';
import { POSTI_AMMESSI, registraRisultato as risultatoKO, sorteggia as sorteggiaKO, tabellone as tabelloneKO } from '../tornei.js';
import { componi as componiCasate, proponiCapitani, statoCasate } from '../casate_composizione.js';
import { chiudiScadute, fasceOggi as fasceSpiaggia, prendi as prendiOmbrellone, situazione as situazionePiazzola, verificaPiazzola } from '../spiaggia.js';
import { verificaSpazio, etichettaTurno, layoutDelGiorno, layoutPredefinito, mappaTavoli, prenotaTavolo, scopoTurno, statoTurno, tavoliDi, turni, turnoSuccessivo } from '../tavoli.js';
import { par, salvaParametri, tuttiParametri } from '../parametri.js';
import { avvisoRitiro, primoRitiro } from '../cucina.js';
import { condimentiAmmessi, daOrdinare, diagnosi as diagnosiMenu, eCondimento, incoerenze as incoerenzeMenu, quantoCostaCondire } from '../menu.js';
import { cerca as cercaRegistro, registra, storiaDi } from '../registro.js';
import { cornice as corniceMail, invia as inviaPosta, inviaRicevuta, mailAttiva } from '../mail.js';
import { debitoVersoISoci, impostaPin, movimenti as movimentiTessera, muovi, saldo as saldoTessera, statoPrepagata, verificaPin } from '../tessera.js';
import { bloccaSeCollegato, rami } from '../referenze.js';
import { leggiCoordinate, leggiEmbed, leggiSingola, risolviPosizione } from '../geo.js';
import { conStato, generaSedute, sedute as seduteFitness } from '../fitness.js';

function menuZona(v, stazione) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "garden") return "garden";
  if (s === "comune") return "comune";
  if (s === "bar") return "bar";
  // Non dichiarata: un piatto che passa dalla cucina si vende in tutte e due le aree, una
  // bibita che si stappa al banco resta al bar. E' la regola del posto, non un tecnicismo.
  return String(stazione || "").toLowerCase() === "cucina" ? "comune" : "bar";
}
async function segnaPronta(comandaId) {
  await db.prepare("UPDATE comande SET pronta_at=? WHERE id=? AND pronta_at IS NULL").run((/* @__PURE__ */ new Date()).toISOString(), comandaId);
}
async function avvisaProntoSeSelf(comandaId, prev) {
  if (prev === "pronta") return;
  const c = await db.prepare("SELECT id,numero,canale,socio_id,punto FROM comande WHERE id=? AND stato=?").get(comandaId, "pronta");
  if (!c || c.canale !== "self" || !c.socio_id) return;
  const titolo = "Il tuo ordine \xE8 pronto \u{1F6CE}";
  const corpo = `Ordine #${c.numero}${c.punto ? " \xB7 " + c.punto : ""}: ritira e paga in cassa.`;
  try {
    await db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)").run(c.socio_id, "push", "sistema", titolo, corpo);
  } catch (_) {
  }
  try {
    await sendToSocio(c.socio_id, { title: titolo, body: corpo, url: "/", tag: "ordine-pronto" });
  } catch (_) {
  }
}
var adminRouter = asyncify(Router());
adminRouter.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const u = await db.prepare("SELECT * FROM utenti_admin WHERE username=?").get(username || "");
  if (!u || !verifyPassword(password || "", u.password_hash)) {
    audit(username || "?", "login_fallito", "utenti_admin", u?.id ?? "");
    return res.status(401).json({ error: "Credenziali non valide" });
  }
  const token = await createSession(u);
  audit(u.username, "login", "utenti_admin", u.id);
  res.json({ token, user: { username: u.username, ruolo: u.ruolo } });
});
adminRouter.post("/logout", requireAdmin, async (req, res) => {
  const token = (req.headers.authorization || "").slice(7);
  await destroySession(token);
  res.json({ ok: true });
});
adminRouter.use(requireAdmin);
adminRouter.use((req, res, next) => {
  if (req.adminUser.ruolo === "sola_lettura" && !["GET", "HEAD"].includes(req.method) && req.path !== "/logout")
    return res.status(403).json({ error: "Account in sola lettura" });
  next();
});
adminRouter.get("/me", (req, res) => res.json({ user: { username: req.adminUser.username, ruolo: req.adminUser.ruolo }, ...capsInfo(req.adminUser) }));
adminRouter.get("/operatori", requireCap("operatori"), async (req, res) => {
  const rows = await db.prepare("SELECT id,username,ruolo,permessi,created_at FROM utenti_admin ORDER BY id").all();
  res.json({ operatori: rows.map((r) => ({ ...r, permessi: parsePermessi(r.permessi) })), caps_delegabili: CAPS_DELEGABILI });
});
adminRouter.post("/operatori", requireCap("operatori"), async (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password) return res.status(400).json({ error: "Username e password obbligatori" });
  const ruolo = ["manager", "staff", "sola_lettura"].includes(b.ruolo) ? b.ruolo : "staff";
  const permessi = ruolo === "staff" ? JSON.stringify((Array.isArray(b.permessi) ? b.permessi : []).filter((c) => CAPS_DELEGABILI.includes(c))) : null;
  try {
    const info = await db.prepare("INSERT INTO utenti_admin (username,password_hash,ruolo,permessi) VALUES (?,?,?,?)").run(b.username, hashPassword(b.password), ruolo, permessi);
    audit(req.adminUser.username, "crea", "operatori", info.lastInsertRowid, `${b.username} \xB7 ${ruolo}`);
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Username gi\xE0 esistente" });
  }
});
adminRouter.put("/operatori/:id", requireCap("operatori"), async (req, res) => {
  const b = req.body || {};
  const u = await db.prepare("SELECT username,ruolo FROM utenti_admin WHERE id=?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "Operatore non trovato" });
  if (u.ruolo === "gestore") return res.status(400).json({ error: "Il gestore non \xE8 modificabile da qui (password via ADMIN_PASSWORD)" });
  const ruolo = ["manager", "staff", "sola_lettura"].includes(b.ruolo) ? b.ruolo : u.ruolo;
  const permessi = ruolo === "staff" ? JSON.stringify((Array.isArray(b.permessi) ? b.permessi : []).filter((c) => CAPS_DELEGABILI.includes(c))) : null;
  await db.prepare("UPDATE utenti_admin SET ruolo=?,permessi=? WHERE id=?").run(ruolo, permessi, req.params.id);
  if (b.password) await db.prepare("UPDATE utenti_admin SET password_hash=? WHERE id=?").run(hashPassword(b.password), req.params.id);
  audit(req.adminUser.username, "modifica", "operatori", req.params.id, ruolo);
  res.json({ ok: true });
});
adminRouter.delete("/operatori/:id", requireCap("operatori"), async (req, res) => {
  const u = await db.prepare("SELECT username,ruolo FROM utenti_admin WHERE id=?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "Operatore non trovato" });
  if (u.ruolo === "gestore") return res.status(400).json({ error: "Il gestore non \xE8 eliminabile" });
  await db.prepare("DELETE FROM utenti_admin WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "operatori", req.params.id, u.username);
  res.json({ ok: true });
});
adminRouter.get("/stats", async (req, res) => {
  const one = async (q) => (await db.prepare(q).get()).n;
  res.json({
    soci: await one("SELECT count(*) n FROM soci WHERE attivo=1"),
    soci_marketing: await one("SELECT count(*) n FROM soci WHERE consenso_marketing=1"),
    prenotazioni: await one("SELECT count(*) n FROM prenotazioni"),
    prenotazioni_oggi: await one("SELECT count(*) n FROM prenotazioni WHERE date(created_at)=date('now')"),
    proposte: await one("SELECT count(*) n FROM proposte WHERE stato='ricevuta'"),
    convocazioni_aperte: await one("SELECT count(*) n FROM convocazioni WHERE stato='aperta'"),
    per_casata: await db.prepare(`SELECT c.nome,c.colore,c.punti,count(s.id) soci
                            FROM casate c LEFT JOIN soci s ON s.casata_id=c.id AND s.attivo=1
                            GROUP BY c.id ORDER BY c.punti DESC`).all()
  });
});
adminRouter.get("/soci", async (req, res) => {
  const q = `%${(req.query.q || "").toString()}%`;
  const rows = await db.prepare(`SELECT s.*, c.nome AS casata_nome FROM soci s LEFT JOIN casate c ON c.id=s.casata_id
    WHERE s.nome LIKE ? OR s.cognome LIKE ? OR s.email LIKE ? OR s.tessera_code LIKE ?
    ORDER BY s.created_at DESC`).all(q, q, q, q);
  res.json(rows);
});
adminRouter.post("/soci", requireCap("utenti_ins"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !b.cognome) return res.status(400).json({ error: "Nome e cognome obbligatori" });
  const tipo = b.tipo_profilo ?? "socio";
  const ruolo = tipo === "ospite_temporaneo" ? "non_socio" : b.ruolo ?? "socio";
  const cols = ["tessera_code", "nome", "cognome", "email", "telefono", "data_nascita", "casata_id", "ruolo", "tipo_profilo", "tutore_id", "lingua", "consenso_privacy", "consenso_marketing", "consenso_foto", "notifiche_push", "valida_fino", "sesso", "nucleo", "gioca_coppa", "soggiorno_dal", "soggiorno_al"];
  const vals = [
    b.tessera_code || "",
    b.nome,
    b.cognome,
    b.email ?? null,
    b.telefono ?? null,
    b.data_nascita ?? null,
    b.casata_id ?? null,
    ruolo,
    tipo,
    b.tutore_id ?? null,
    b.lingua ?? "it",
    b.consenso_privacy ? 1 : 0,
    b.consenso_marketing ? 1 : 0,
    b.consenso_foto ? 1 : 0,
    b.notifiche_push ? 1 : 0,
    b.valida_fino ?? null,
    // Il sesso serve alla quota di rappresentanza delle casate, il nucleo tiene insieme la
    // famiglia nel sorteggio, e "gioca_coppa" distingue chi vuole giocare da chi e' socio e
    // basta: assegnare d'ufficio chi non ha chiesto di giocare significa ritrovarsi una casata
    // in meno alla sfilata.
    ["F", "M"].includes(String(b.sesso || "").toUpperCase()) ? String(b.sesso).toUpperCase() : null,
    b.nucleo ?? null,
    b.gioca_coppa ? 1 : 0,
    b.soggiorno_dal ?? null,
    b.soggiorno_al ?? null
  ];
  try {
    let code, info;
    if (b.tessera_code) {
      info = await db.prepare(`INSERT INTO soci (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
      code = b.tessera_code;
    } else {
      const r = await insertSocioUnique(cols, vals);
      code = r.tessera_code;
      info = { lastInsertRowid: r.id };
    }
    audit(req.adminUser.username, "crea", "soci", info.lastInsertRowid, code);
    res.status(201).json({ ok: true, id: info.lastInsertRowid, tessera_code: code });
  } catch (e) {
    // Il messaggio generico nascondeva la causa vera: si stampa nei log del server, cosi' chi
    // guarda sa se e' un duplicato, un campo mancante o altro.
    console.error("creazione socio fallita:", e && e.message);
    res.status(400).json({ error: "Tessera duplicata o dati non validi" });
  }
});
adminRouter.put("/soci/:id", requireCap("utenti"), async (req, res) => {
  const b = req.body || {};
  const exists = await db.prepare("SELECT id FROM soci WHERE id=?").get(req.params.id);
  if (!exists) return res.status(404).json({ error: "Socio non trovato" });
  const tipo = b.tipo_profilo ?? "socio";
  const ruolo = tipo === "ospite_temporaneo" ? "non_socio" : b.ruolo ?? "socio";
  await db.prepare(`UPDATE soci SET nome=?,cognome=?,email=?,telefono=?,data_nascita=?,casata_id=?,ruolo=?,tipo_profilo=?,tutore_id=?,lingua=?,
    consenso_privacy=?,consenso_marketing=?,consenso_foto=?,notifiche_push=?,attivo=?,valida_fino=?,soggiorno_dal=?,soggiorno_al=?,
    emergenza_nome=?,emergenza_tel=? WHERE id=?`).run(
    b.nome,
    b.cognome,
    b.email ?? null,
    b.telefono ?? null,
    b.data_nascita ?? null,
    b.casata_id ?? null,
    ruolo,
    tipo,
    b.tutore_id ?? null,
    b.lingua ?? "it",
    b.consenso_privacy ? 1 : 0,
    b.consenso_marketing ? 1 : 0,
    b.consenso_foto ? 1 : 0,
    b.notifiche_push ? 1 : 0,
    b.attivo ? 1 : 0,
    b.valida_fino ?? null,
    b.soggiorno_dal ?? null,
    b.soggiorno_al ?? null,
        b.emergenza_nome ?? null,
    b.emergenza_tel ?? null,
    req.params.id
  );
  if (!["residente", "socio_residente"].includes(tipo)) await db.prepare("UPDATE soci SET host=0, host_ko=0 WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "modifica", "soci", req.params.id);
    // Il consenso alla prepagata per un minorenne: si segna CHI l'ha dato e quando. Non e' una
  // spunta come le altre — autorizza un ragazzo a spendere denaro — e se domani qualcuno chiede
  // "chi l'ha deciso?", la risposta dev'esserci.
  if (Object.prototype.hasOwnProperty.call(b, "prepagata_autorizzata")) {
    const v = b.prepagata_autorizzata ? 1 : 0;
    await db.prepare("UPDATE soci SET prepagata_autorizzata=?, prepagata_autorizzata_da=?, prepagata_autorizzata_at=? WHERE id=?")
      .run(v, v ? req.adminUser.username : null, v ? new Date().toISOString() : null, req.params.id);
    audit(req.adminUser.username, v ? "prepagata_autorizzata" : "prepagata_revocata", "soci", req.params.id);
  }
res.json({ ok: true });
});
adminRouter.get("/soci/:id/export", requireCap("utenti"), async (req, res) => {
  const s = await db.prepare("SELECT * FROM soci WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Socio non trovato" });
  const prenotazioni = await db.prepare("SELECT * FROM prenotazioni WHERE socio_id=?").all(req.params.id);
  const convocazioni = await db.prepare("SELECT * FROM convocazioni WHERE socio_id=?").all(req.params.id);
  const proposte = await db.prepare("SELECT * FROM proposte WHERE socio_id=?").all(req.params.id);
  audit(req.adminUser.username, "export_gdpr", "soci", req.params.id);
  res.json({ socio: s, prenotazioni, convocazioni, proposte });
});
adminRouter.delete("/soci/:id", requireCap("utenti_del"), async (req, res) => {
  const id = req.params.id;
  const s = await db.prepare("SELECT tessera_code FROM soci WHERE id=?").get(id);
  if (!s) return res.status(404).json({ error: "Socio non trovato" });
  await db.prepare("DELETE FROM convocazioni WHERE socio_id=?").run(id);
  await db.prepare("DELETE FROM prenotazioni WHERE socio_id=?").run(id);
  await db.prepare("DELETE FROM notifiche WHERE socio_id=?").run(id);
  await db.prepare("UPDATE proposte SET socio_id=NULL WHERE socio_id=?").run(id);
  await db.prepare("UPDATE serate_prenotazioni SET socio_id=NULL WHERE socio_id=?").run(id);
  await db.prepare("DELETE FROM soci WHERE tutore_id=?").run(id);
  await db.prepare("DELETE FROM soci WHERE id=?").run(id);
  audit(req.adminUser.username, "cancella_gdpr", "soci", id, s.tessera_code);
  res.json({ ok: true });
});
// I punti della Coppa non si inseriscono piu' a mano: derivano da tornei e contest.
// La rotta resta per segnalare il cambiamento a eventuali client non aggiornati.
adminRouter.put("/casate/:id/punti", requireCap("casate"), async (req, res) => {
  res.status(410).json({ error: "I punti della Coppa sono calcolati dai tornei e dai contest: usa Ricalcola." });
});
adminRouter.get("/eventi", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM eventi ORDER BY ordine").all());
});
adminRouter.put("/eventi/:id", requireCap("eventi"), async (req, res) => {
  const b = req.body || {};
  const c = await costoEvento(b);
  await db.prepare("UPDATE eventi SET titolo=?,sottotitolo=?,descrizione=?,ambiente=?,giorno=?,ora_inizio=?,tipologia=?,artista=?,prezzo=?,costo_tipo=?,consumazione=?,serata_id=?,attivo=?,luogo=?,capienza=?,occupa_stage=? WHERE id=?").run(b.titolo, b.sottotitolo ?? "", b.descrizione ?? "", b.ambiente ?? "", b.giorno ?? "", b.ora_inizio ?? null, b.tipologia ?? null, b.artista ?? null, c.prezzo, c.costo_tipo, c.consumazione, b.serata_id || null, b.attivo ? 1 : 0, LUOGHI_EV.includes(b.luogo) ? b.luogo : null, b.capienza === "" || b.capienza == null ? null : Number(b.capienza), b.occupa_stage ? 1 : 0, req.params.id);
  audit(req.adminUser.username, "modifica", "eventi", req.params.id);
  res.json({ ok: true });
});
adminRouter.post("/eventi", requireCap("eventi"), async (req, res) => {
  const b = req.body || {};
  if (!b.titolo) return res.status(400).json({ error: "Titolo obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM eventi").get()).n;
  const c = await costoEvento(b);
  const info = await db.prepare("INSERT INTO eventi (giorno,titolo,sottotitolo,descrizione,ambiente,ora_inizio,tipologia,artista,prezzo,costo_tipo,consumazione,serata_id,tipo,attivo,ordine,luogo,capienza,occupa_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)").run(b.giorno ?? "", b.titolo, b.sottotitolo ?? "", b.descrizione ?? "", b.ambiente ?? "", b.ora_inizio ?? null, b.tipologia ?? null, b.artista ?? null, c.prezzo, c.costo_tipo, c.consumazione, b.serata_id || null, b.tipo ?? "serata", ord, LUOGHI_EV.includes(b.luogo) ? b.luogo : null, b.capienza === "" || b.capienza == null ? null : Number(b.capienza), b.occupa_stage ? 1 : 0);
  audit(req.adminUser.username, "crea", "eventi", info.lastInsertRowid, b.titolo);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.delete("/eventi/:id", requireCap("eventi"), async (req, res) => {
  await db.prepare("DELETE FROM eventi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "elimina", "eventi", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/push/stato", async (req, res) => {
  const n = (await db.prepare("SELECT COUNT(DISTINCT socio_id) n FROM push_sub").get()).n;
  const consenzienti = (await db.prepare("SELECT COUNT(*) n FROM soci WHERE notifiche_push=1 AND attivo=1").get()).n;
  res.json({ enabled: pushEnabled(), dispositivi: n, consenzienti });
});
adminRouter.post("/push/broadcast", requireCap("eventi"), async (req, res) => {
  const b = req.body || {};
  const titolo = String(b.titolo || "").trim();
  const corpo = String(b.corpo || "").trim();
  if (!titolo) return res.status(400).json({ error: "Titolo obbligatorio" });
  const dove = b.casata_id ? "AND casata_id=?" : "";
  const args = b.casata_id ? [Number(b.casata_id)] : [];
  const soci = await db.prepare(`SELECT id FROM soci WHERE notifiche_push=1 AND attivo=1 ${dove}`).all(...args);
  const ids = soci.map((s) => s.id);
  const insN = db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)");
  for (const id of ids) {
    await insN.run(id, "push", "sistema", titolo, corpo || null);
  }
  let inviati = 0;
  try {
    inviati = await sendToSoci(ids, { title: titolo, body: corpo, url: "/", tag: "avviso" });
  } catch (_) {
  }
  audit(req.adminUser.username, "push_broadcast", "soci", b.casata_id || "tutti", `${ids.length} destinatari, ${inviati} push`);
  res.json({ ok: true, destinatari: ids.length, inviati, enabled: pushEnabled() });
});
adminRouter.get("/prenotazioni", async (req, res) => {
  res.json(await db.prepare(`SELECT p.*, s.nome, s.cognome, s.tessera_code FROM prenotazioni p
    LEFT JOIN soci s ON s.id=p.socio_id ORDER BY p.created_at DESC LIMIT 200`).all());
});
adminRouter.post("/convocazioni", requireCap("tabellone"), async (req, res) => {
  const { disciplina_chiave, dominio, casata_id, match_label, quando, luogo } = req.body || {};
  const disc = await db.prepare("SELECT id FROM discipline WHERE chiave=? AND dominio=?").get(disciplina_chiave, dominio || "sport");
  if (!disc) return res.status(400).json({ error: "Disciplina non trovata" });
  const soci = await db.prepare("SELECT id,notifiche_push FROM soci WHERE casata_id=? AND attivo=1").all(casata_id);
  const ins = db.prepare("INSERT INTO convocazioni (socio_id,disciplina_id,match_label,quando,luogo) VALUES (?,?,?,?,?)");
  const insN = db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)");
  let notificati = 0;
  for (const s of soci) {
    await ins.run(s.id, disc.id, match_label ?? "", quando ?? "", luogo ?? "");
    if (s.notifiche_push) {
      await insN.run(s.id, "push", "casata", "La tua casata ti convoca", `${match_label || ""} \xB7 ${quando || ""} ${luogo || ""}`.trim());
      notificati++;
    }
  }
  audit(req.adminUser.username, "convoca", "convocazioni", casata_id, `${soci.length} soci \xB7 ${notificati} notificati`);
  res.status(201).json({ ok: true, convocati: soci.length, notificati });
});
adminRouter.get("/proposte", async (req, res) => {
  res.json(await db.prepare(`SELECT pr.*, s.nome, s.cognome FROM proposte pr
    LEFT JOIN soci s ON s.id=pr.socio_id ORDER BY pr.created_at DESC`).all());
});
adminRouter.put("/proposte/:id", requireCap("proposte"), async (req, res) => {
  const { stato } = req.body || {};
  await db.prepare("UPDATE proposte SET stato=? WHERE id=?").run(stato || "ricevuta", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/bussola", requireCap("guida"), async (req, res) => {
  res.json(await db.prepare("SELECT * FROM bussola ORDER BY sezione,ordine").all());
});
adminRouter.post("/bussola", requireCap("guida"), async (req, res) => {
  const b = req.body || {};
  const num = (v) => {
    if (v === "" || v == null) return null;
    const n = Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return n;
  };
  const info = await db.prepare("INSERT INTO bussola (sezione,titolo,dettaglio,distanza,ordine,lat,lng) VALUES (?,?,?,?,?,?,?)").run(b.sezione, b.titolo, b.dettaglio ?? "", b.distanza ?? "", Number(b.ordine) || 0, num(b.lat), num(b.lng));
  audit(req.adminUser.username, "crea", "bussola", info.lastInsertRowid);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
// Le coordinate rendono la voce un collegamento alle mappe del telefono.
adminRouter.put("/bussola/:id", requireCap("guida"), async (req, res) => {
  const b = req.body || {};
  // I due campi accettano il decimale (con punto o virgola) e anche il GRADO singolo copiato
  // dalla barra di Google: 37\u00b003'34.6"N. Se un campo e' pieno ma illeggibile si RIFIUTA,
  // invece di svuotarlo in silenzio — era cosi' che una posizione spariva senza dirlo.
  const daTesto = (b.lat == null || b.lat === "") && b.geo ? leggiCoordinate(b.geo) : null;
  let lat0, lng0;
  if (daTesto) {
    lat0 = daTesto.lat; lng0 = daTesto.lng;
  } else {
    const grezzoLat = b.lat, grezzoLng = b.lng;
    // Se la coppia intera finisce in un campo solo (capita incollando "lat lng"), si divide.
    const coppia = grezzoLat ? leggiCoordinate(String(grezzoLat)) : null;
    if (coppia && (grezzoLng == null || grezzoLng === "")) {
      lat0 = coppia.lat; lng0 = coppia.lng;
    } else {
      lat0 = leggiSingola(grezzoLat, "lat");
      lng0 = leggiSingola(grezzoLng, "lng");
      const pieno = (v) => v != null && String(v).trim() !== "";
      if (pieno(grezzoLat) && lat0 == null) return res.status(400).json({ error: `Non riesco a leggere la latitudine "${String(grezzoLat).slice(0, 30)}". Vanno bene 37.0596, 37,0596 oppure 37\u00b003'34.6"N.` });
      if (pieno(grezzoLng) && lng0 == null) return res.status(400).json({ error: `Non riesco a leggere la longitudine "${String(grezzoLng).slice(0, 30)}". Vanno bene 15.2933, 15,2933 oppure 15\u00b017'26.3"E.` });
    }
  }
  // Codice della mappa incollato da Google: se c'e', vale quello — ed e' anche una fonte di
  // coordinate, per il tasto "Portami li'".
  let embed = null;
  if (b.mappa_embed !== undefined) {
    const e = b.mappa_embed ? leggiEmbed(b.mappa_embed) : null;
    if (b.mappa_embed && !e) {
      return res.status(400).json({ error: "Questo non e\u0300 il codice di una mappa Google. Su Google Maps: Condividi → Incorpora una mappa → Copia HTML." });
    }
    embed = e;
    if (e && lat0 == null && e.lat != null) { lat0 = e.lat; lng0 = e.lng; }
  }
  const valide = lat0 != null && lng0 != null && Math.abs(lat0) <= 90 && Math.abs(lng0) <= 180;
  if ((lat0 != null) !== (lng0 != null)) {
    return res.status(400).json({ error: "Servono tutte e due le coordinate: con una sola il punto non esiste." });
  }
  const srcEmbed = b.mappa_embed === undefined ? undefined : (embed ? embed.src : null);
  if (srcEmbed === undefined) {
    await db.prepare("UPDATE bussola SET titolo=?,dettaglio=?,distanza=?,lat=?,lng=? WHERE id=?")
      .run(b.titolo, b.dettaglio ?? "", b.distanza ?? "", valide ? lat0 : null, valide ? lng0 : null, req.params.id);
  } else {
    await db.prepare("UPDATE bussola SET titolo=?,dettaglio=?,distanza=?,lat=?,lng=?,mappa_embed=? WHERE id=?")
      .run(b.titolo, b.dettaglio ?? "", b.distanza ?? "", valide ? lat0 : null, valide ? lng0 : null, srcEmbed, req.params.id);
  }
  audit(req.adminUser.username, "modifica", "bussola", req.params.id, valide ? `${lat0},${lng0}` : "senza posizione");
  res.json({ ok: true, lat: valide ? lat0 : null, lng: valide ? lng0 : null, mappa_embed: srcEmbed ?? undefined });
});
adminRouter.delete("/bussola/:id", requireCap("guida"), async (req, res) => {
  await db.prepare("DELETE FROM bussola WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "bussola", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/luoghi", requireCap("luoghi"), async (req, res) => {
  res.json(await db.prepare("SELECT * FROM luoghi ORDER BY ordine").all());
});
adminRouter.put("/luoghi/:id", requireCap("luoghi"), async (req, res) => {
  const b = req.body || {};
  // Stessi strumenti delle voci di guida: coordinate decimali, gradi copiati da Google,
  // link incollato o codice della mappa. Non c'e' ragione che il chiosco si imposti in un
  // modo diverso dalla farmacia.
  let embed = null;
  if (b.mappa_embed !== undefined) {
    const e = b.mappa_embed ? leggiEmbed(b.mappa_embed) : null;
    if (b.mappa_embed && !e) return res.status(400).json({ error: "Questo non e\u0300 il codice di una mappa Google. Su Google Maps: Condividi → Incorpora una mappa → Copia HTML." });
    embed = e;
  }
  const daTesto = (b.lat == null || b.lat === "") && b.geo ? leggiCoordinate(b.geo) : null;
  let lat = daTesto ? daTesto.lat : leggiSingola(b.lat, "lat");
  let lng = daTesto ? daTesto.lng : leggiSingola(b.lng, "lng");
  if (lat == null && embed && embed.lat != null) { lat = embed.lat; lng = embed.lng; }
  const pieno = (v) => v != null && String(v).trim() !== "";
  if (pieno(b.lat) && lat == null) return res.status(400).json({ error: "Non riesco a leggere la latitudine." });
  if (pieno(b.lng) && lng == null) return res.status(400).json({ error: "Non riesco a leggere la longitudine." });
  if ((lat != null) !== (lng != null)) return res.status(400).json({ error: "Servono tutte e due le coordinate." });

  if (b.mappa_embed === undefined) {
    await db.prepare("UPDATE luoghi SET nome=?,lat=?,lng=? WHERE id=?").run(b.nome, lat, lng, req.params.id);
  } else {
    await db.prepare("UPDATE luoghi SET nome=?,lat=?,lng=?,mappa_embed=? WHERE id=?").run(b.nome, lat, lng, embed ? embed.src : null, req.params.id);
  }
  audit(req.adminUser.username, "coordinate", "luoghi", req.params.id, `${lat},${lng}`);
  res.json({ ok: true, lat, lng, mappa_embed: embed ? embed.src : undefined });
});
adminRouter.get("/rifiuti", requireCap("guida"), async (req, res) => {
  const tipi = await db.prepare("SELECT id,nome,colore,ordine FROM rifiuti_tipi ORDER BY ordine,id").all();
  const calendari = (await db.prepare("SELECT id,periodo,inizio_conf,fine_conf,ora_ritiro,giorni,ordine,attivo FROM rifiuti_calendario ORDER BY ordine,id").all()).map((c) => ({ ...c, giorni: c.giorni ? JSON.parse(c.giorni) : {}, attivo: c.attivo !== 0 }));
  res.json({ tipi, calendari });
});
adminRouter.post("/rifiuti/tipo", requireCap("guida"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM rifiuti_tipi").get()).n;
  const info = await db.prepare("INSERT INTO rifiuti_tipi (nome,colore,ordine) VALUES (?,?,?)").run(b.nome, b.colore || "#7A8790", ord);
  audit(req.adminUser.username, "crea", "rifiuti_tipi", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/rifiuti/tipo/:id", requireCap("guida"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE rifiuti_tipi SET nome=?,colore=? WHERE id=?").run(b.nome, b.colore || "#7A8790", req.params.id);
  audit(req.adminUser.username, "modifica", "rifiuti_tipi", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/rifiuti/tipo/:id", requireCap("guida"), async (req, res) => {
  await db.prepare("DELETE FROM rifiuti_tipi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "rifiuti_tipi", req.params.id);
  res.json({ ok: true });
});
adminRouter.put("/rifiuti/calendario/:periodo", requireCap("guida"), async (req, res) => {
  const b = req.body || {};
  const per = req.params.periodo;
  const giorni = JSON.stringify(b.giorni || {});
  const ex = await db.prepare("SELECT id FROM rifiuti_calendario WHERE periodo=?").get(per);
  if (ex) await db.prepare("UPDATE rifiuti_calendario SET inizio_conf=?,fine_conf=?,ora_ritiro=?,giorni=?,attivo=? WHERE periodo=?").run(b.inizio_conf || "", b.fine_conf || "", b.ora_ritiro || "", giorni, b.attivo === false ? 0 : 1, per);
  else {
    const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM rifiuti_calendario").get()).n;
    await db.prepare("INSERT INTO rifiuti_calendario (periodo,inizio_conf,fine_conf,ora_ritiro,giorni,ordine,attivo) VALUES (?,?,?,?,?,?,?)").run(per, b.inizio_conf || "", b.fine_conf || "", b.ora_ritiro || "", giorni, ord, b.attivo === false ? 0 : 1);
  }
  audit(req.adminUser.username, "modifica", "rifiuti_calendario", per);
  res.json({ ok: true });
});
adminRouter.delete("/rifiuti/calendario/:periodo", requireCap("guida"), async (req, res) => {
  await db.prepare("DELETE FROM rifiuti_calendario WHERE periodo=?").run(req.params.periodo);
  audit(req.adminUser.username, "cancella", "rifiuti_calendario", req.params.periodo);
  res.json({ ok: true });
});
function magStato(a) {
  const g = Number(a.giacenza), pr = Number(a.punto_riordino), pre = Number(a.soglia_preavviso);
  // Giacenza sotto zero: si e' venduto piu' di quanto risulta a magazzino. Non si blocca la
  // vendita — al banco la merce puo' esserci davvero e il dato essere vecchio — ma non si
  // lascia passare in silenzio: sulla stagione simulata TUTTI gli articoli sono finiti sotto
  // zero senza che nulla lo segnalasse.
  if (g < 0) return "negativa";
  if (g <= pr) return "da_riordinare";
  if (pre > 0 && g <= pre) return "in_esaurimento";
  return "ok";
}
adminRouter.get("/magazzino", requireCap("magazzino"), async (req, res) => {
  const area = req.query.area;
  const zona = req.query.zona;
  const zonaWhere = zona === "bar" ? "zona IN ('bar','comune')" : zona === "garden" ? "zona IN ('garden','comune')" : (zona === "carta" || zona === "cdc") ? "zona IN ('carta','cdc','comune')" : zona === "comune" ? "zona='comune'" : zona ? "zona=?" : "";
  const conds = [];
  const args = [];
  if (area) {
    conds.push("area=?");
    args.push(area);
  }
  if (zonaWhere) {
    conds.push(zonaWhere);
    if (zona && !["bar", "garden", "carta", "cdc", "comune"].includes(zona)) args.push(zona);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const rows = await db.prepare(`SELECT * FROM magazzino_articoli ${where} ORDER BY area,ordine,id`).all(...args);
  const imp = await db.prepare("SELECT articolo_id, COALESCE(SUM(quantita),0) q FROM magazzino_richieste WHERE stato='impegnata' GROUP BY articolo_id").all();
  const impMap = {};
  imp.forEach((r) => {
    impMap[r.articolo_id] = Number(r.q);
  });
  const ord = await db.prepare("SELECT articolo_id, COALESCE(SUM(quantita),0) q FROM magazzino_ordini WHERE stato='confermato' GROUP BY articolo_id").all();
  const ordMap = {};
  ord.forEach((r) => {
    ordMap[r.articolo_id] = Number(r.q);
  });
  const articoli = rows.map((a) => {
    const impegno = impMap[a.id] || 0;
    const eff = Number(a.giacenza) - impegno;
    return { ...a, impegno, giacenza_effettiva: eff, in_arrivo: ordMap[a.id] || 0, stato: magStato({ giacenza: eff, punto_riordino: a.punto_riordino, soglia_preavviso: a.soglia_preavviso }) };
  });
  const riepilogo = {
    negative: articoli.filter((a) => a.stato === "negativa").length,
    da_riordinare: articoli.filter((a) => a.stato === "da_riordinare").length,
    in_esaurimento: articoli.filter((a) => a.stato === "in_esaurimento").length,
    totale: articoli.length
  };
  const aree = [...new Set(rows.map((a) => a.area))];
  res.json({ articoli, riepilogo, aree });
});
adminRouter.post("/magazzino", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM magazzino_articoli").get()).n;
  const info = await db.prepare("INSERT INTO magazzino_articoli (nome,area,zona,unita,giacenza,punto_riordino,soglia_preavviso,note,ordine,aggiornato_at,tipo_consumo,sfrido_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(b.nome, b.area || "chiosco", magNormZona(b.zona), b.unita || "pz", Number(b.giacenza || 0), Number(b.punto_riordino || 0), Number(b.soglia_preavviso || 0), b.note || null, ord, (/* @__PURE__ */ new Date()).toISOString(), tipoConsumo(b), Number(b.sfrido_pct) || 0);
  audit(req.adminUser.username, "crea", "magazzino_articoli", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/magazzino/:id", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE magazzino_articoli SET nome=?,area=?,zona=?,unita=?,punto_riordino=?,soglia_preavviso=?,note=?,aggiornato_at=?,tipo_consumo=?,sfrido_pct=? WHERE id=?").run(b.nome, b.area || "chiosco", magNormZona(b.zona), b.unita || "pz", Number(b.punto_riordino || 0), Number(b.soglia_preavviso || 0), b.note || null, (/* @__PURE__ */ new Date()).toISOString(), tipoConsumo(b), Number(b.sfrido_pct) || 0, req.params.id);
  audit(req.adminUser.username, "modifica", "magazzino_articoli", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/magazzino/:id", requireCap("magazzino"), async (req, res) => {
  if (await bloccaSeCollegato(res, "magazzino_articoli", req.params.id, "l'articolo")) return;
  await db.prepare("DELETE FROM magazzino_articoli WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "magazzino_articoli", req.params.id);
  res.json({ ok: true });
});
adminRouter.post("/magazzino/:id/movimento", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  const art = await db.prepare("SELECT * FROM magazzino_articoli WHERE id=?").get(req.params.id);
  if (!art) return res.status(404).json({ error: "Articolo non trovato" });
  const q = Math.abs(Number(b.quantita || 0));
  const tipo = ["carico", "scarico", "rettifica"].includes(b.tipo) ? b.tipo : "carico";
  let nuova = Number(art.giacenza);
  // Scaricare piu' di quanto c'e' non e' un errore da bloccare (in un bar capita di aver
  // consumato piu' di quanto risultava), ma non puo' passare in silenzio: la differenza
  // sparirebbe dai conti. Si segnala e si scrive nella causale.
  let avviso = null;
  if (tipo === "scarico" && q > Number(art.giacenza)) {
    avviso = `Scaricate ${q} unit\u00e0 ma a magazzino ne risultavano ${art.giacenza}: ${q - Number(art.giacenza)} in piu' del disponibile. Controlla la giacenza o registra il carico mancante.`;
  }
  if (tipo === "carico") nuova += q;
  else if (tipo === "scarico") nuova = Math.max(0, nuova - q);
  else nuova = q;
  await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?").run(nuova, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore) VALUES (?,?,?,?,?)").run(req.params.id, tipo, q, avviso ? (b.causale ? b.causale + " · " : "") + "oltre giacenza" : b.causale || null, req.adminUser.username);
  audit(req.adminUser.username, tipo, "magazzino_articoli", req.params.id, String(q) + (avviso ? " (oltre giacenza)" : ""));
  const aggiornato = await db.prepare("SELECT * FROM magazzino_articoli WHERE id=?").get(req.params.id);
  res.json({ ok: true, avviso, giacenza: nuova, stato: magStato(aggiornato) });
});
async function impegnoTot(articoloId) {
  const r = await db.prepare("SELECT COALESCE(SUM(quantita),0) q FROM magazzino_richieste WHERE articolo_id=? AND stato='impegnata'").get(articoloId);
  return Number(r.q);
}
async function impegnoZona(articoloId, zona) {
  const r = await db.prepare("SELECT COALESCE(SUM(quantita),0) q FROM magazzino_richieste WHERE articolo_id=? AND zona=? AND stato='impegnata'").get(articoloId, zona);
  return Number(r.q);
}
// Zone che possono attingere al magazzino Centrale. La zona NON e' un deposito: e' una
// abilitazione (chi puo' usare l'articolo). Casa di Carta e' una zona come Bar e Garden.
// Ogni zona ha la sua voce di magazzino: gli articoli "core" di una zona sono suoi e basta.
// 'comune' resta per cio' che serve davvero a tutti (detergenti, tovaglioli...), e in elenco
// va mostrato sotto i core, separato: e' merce di appoggio, non il cuore della zona.
var ZONE_MAGAZZINO = ["bar", "garden", "carta"];
var zonaMag = (v) => {
  const z = String(v || "");
  if (z === "cdc") return "carta";                      // vecchio nome della zona Casa di Carta
  return ZONE_MAGAZZINO.includes(z) ? z : "garden";
};
adminRouter.get("/magazzino/zona/:zona", requireCap("magazzino"), async (req, res) => {
  const zona = zonaMag(req.params.zona);
  const arts = await db.prepare("SELECT * FROM magazzino_articoli WHERE zona=? OR zona='comune' ORDER BY nome").all(zona);
  const out = [];
  for (const a of arts) {
    const impTot = await impegnoTot(a.id);
    const impZona = await impegnoZona(a.id, zona);
    const eff = Number(a.giacenza) - impTot;
    out.push({
      articolo_id: a.id,
      nome: a.nome,
      unita: a.unita,
      zona_art: a.zona,
      giacenza_centrale: Number(a.giacenza),
      impegno_tot: impTot,
      impegno_zona: impZona,
      giacenza: eff,
      // disponibile = giacenza effettiva (ciò che la zona può ancora usare)
      punto_riordino: Number(a.punto_riordino),
      soglia_preavviso: Number(a.soglia_preavviso),
      stato: magStato({ giacenza: eff, punto_riordino: a.punto_riordino, soglia_preavviso: a.soglia_preavviso })
    });
  }
  const riepilogo = { da_riordinare: out.filter((a) => a.stato === "da_riordinare").length, in_esaurimento: out.filter((a) => a.stato === "in_esaurimento").length, totale: out.length };
  res.json({ articoli: out, riepilogo });
});
adminRouter.post("/magazzino/zona/:zona/scarico", requireCap("magazzino"), async (req, res) => {
  const zona = zonaMag(req.params.zona);
  const b = req.body || {};
  const art = await db.prepare("SELECT * FROM magazzino_articoli WHERE id=?").get(b.articolo_id);
  if (!art) return res.status(404).json({ error: "Articolo non trovato" });
  const q = Math.abs(Number(b.quantita || 0));
  if (!q) return res.status(400).json({ error: "Quantit\xE0 mancante" });
  const nuova = Math.max(0, Number(art.giacenza) - q);
  await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?").run(nuova, (/* @__PURE__ */ new Date()).toISOString(), art.id);
  await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore,zona) VALUES (?,?,?,?,?,?)").run(art.id, "scarico", q, "consumo fine giornata " + zona, req.adminUser.username, zona);
  let resto = q;
  const aperte = await db.prepare("SELECT * FROM magazzino_richieste WHERE articolo_id=? AND zona=? AND stato='impegnata' ORDER BY created_at").all(art.id, zona);
  for (const r of aperte) {
    if (resto <= 0) break;
    const usa = Math.min(resto, Number(r.quantita));
    const residuo = Number(r.quantita) - usa;
    if (residuo > 0) await db.prepare("UPDATE magazzino_richieste SET quantita=?,updated_at=? WHERE id=?").run(residuo, (/* @__PURE__ */ new Date()).toISOString(), r.id);
    else await db.prepare("UPDATE magazzino_richieste SET stato='consumata',updated_at=? WHERE id=?").run((/* @__PURE__ */ new Date()).toISOString(), r.id);
    resto -= usa;
  }
  audit(req.adminUser.username, "scarico_zona", "magazzino_articoli", art.id, `${zona} -${q}`);
  const eff = nuova - await impegnoTot(art.id);
  res.json({ ok: true, giacenza: eff, giacenza_centrale: nuova, stato: magStato({ giacenza: eff, punto_riordino: art.punto_riordino, soglia_preavviso: art.soglia_preavviso }) });
});
adminRouter.post("/magazzino/richieste", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  const zona = zonaMag(b.zona);
  const art = await db.prepare("SELECT id FROM magazzino_articoli WHERE id=?").get(b.articolo_id);
  if (!art) return res.status(404).json({ error: "Articolo non trovato" });
  const q = Math.abs(Number(b.quantita || 0));
  if (!q) return res.status(400).json({ error: "Quantit\xE0 mancante" });
  const info = await db.prepare("INSERT INTO magazzino_richieste (articolo_id,zona,quantita,stato,note) VALUES (?,?,?,?,?)").run(art.id, zona, q, "impegnata", b.note || null);
  audit(req.adminUser.username, "impegno", "magazzino_richieste", info.lastInsertRowid, `${zona} ${q}`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
adminRouter.get("/magazzino/richieste", requireCap("magazzino"), async (req, res) => {
  const conds = [], args = [];
  if (req.query.zona) {
    conds.push("r.zona=?");
    args.push(req.query.zona);
  }
  if (req.query.stato) {
    conds.push("r.stato=?");
    args.push(req.query.stato);
  } else conds.push("r.stato='impegnata'");
  const where = "WHERE " + conds.join(" AND ");
  const rows = await db.prepare(`SELECT r.*, a.nome, a.unita FROM magazzino_richieste r JOIN magazzino_articoli a ON a.id=r.articolo_id ${where} ORDER BY r.created_at DESC LIMIT 200`).all(...args);
  res.json(rows);
});
adminRouter.post("/magazzino/richieste/:id/annulla", requireCap("magazzino"), async (req, res) => {
  await db.prepare("UPDATE magazzino_richieste SET stato='annullata',updated_at=? WHERE id=? AND stato='impegnata'").run((/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  res.json({ ok: true });
});
async function magFinestra() {
  return Math.max(1, Number(await getSetting("mag_finestra_giorni", "14")) || 14);
}
async function magLead() {
  return Math.max(0, Number(await getSetting("mag_lead_time_giorni", "3")) || 0);
}
function addGiorni(base, n) {
  const d = base ? /* @__PURE__ */ new Date(base + "T00:00:00Z") : /* @__PURE__ */ new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
adminRouter.get("/magazzino/config", requireCap("magazzino"), async (req, res) => {
  res.json({ finestra_giorni: await magFinestra(), lead_time_giorni: await magLead() });
});
adminRouter.post("/magazzino/config", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  if (b.finestra_giorni != null) await setSetting("mag_finestra_giorni", Math.max(1, Math.round(Number(b.finestra_giorni) || 14)));
  if (b.lead_time_giorni != null) await setSetting("mag_lead_time_giorni", Math.max(0, Math.round(Number(b.lead_time_giorni) || 0)));
  audit(req.adminUser.username, "magazzino_config", "impostazioni", "magazzino", JSON.stringify(b));
  res.json({ ok: true, finestra_giorni: await magFinestra(), lead_time_giorni: await magLead() });
});
adminRouter.get("/magazzino/previsione", requireCap("magazzino"), async (req, res) => {
  const N = await magFinestra();
  const LEAD = await magLead();
  const oggi2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const arts = await db.prepare("SELECT * FROM magazzino_articoli ORDER BY area,ordine,id").all();
  const consumi = await db.prepare(`SELECT articolo_id, COALESCE(SUM(quantita),0) q FROM magazzino_movimenti WHERE tipo='scarico' AND created_at >= datetime('now', ?) GROUP BY articolo_id`).all("-" + N + " days");
  const cMap = {};
  consumi.forEach((r) => {
    cMap[r.articolo_id] = Number(r.q);
  });
  const imp = await db.prepare("SELECT articolo_id, COALESCE(SUM(quantita),0) q FROM magazzino_richieste WHERE stato='impegnata' GROUP BY articolo_id").all();
  const iMap = {};
  imp.forEach((r) => {
    iMap[r.articolo_id] = Number(r.q);
  });
  const ord = await db.prepare("SELECT articolo_id, COALESCE(SUM(quantita),0) q FROM magazzino_ordini WHERE stato='confermato' GROUP BY articolo_id").all();
  const oMap = {};
  ord.forEach((r) => {
    oMap[r.articolo_id] = Number(r.q);
  });
  const out = arts.map((a) => {
    const consumo = cMap[a.id] || 0;
    const rate = consumo / N;
    const eff = Number(a.giacenza) - (iMap[a.id] || 0);
    const inArrivo = oMap[a.id] || 0;
    const pr = Number(a.punto_riordino);
    const giorni = rate > 0 ? (eff - pr) / rate : null;
    let dataRiordino = null;
    if (giorni != null) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() + Math.max(0, Math.floor(giorni)));
      dataRiordino = d.toISOString().slice(0, 10);
    }
    const fabbisogno = Math.ceil(rate * N);
    const suggerito = Math.max(0, fabbisogno - eff - inArrivo);
    const urgente = eff <= pr || giorni != null && giorni <= N;
    let dataInvio = null;
    if (dataRiordino != null) dataInvio = addGiorni(dataRiordino, -LEAD);
    const daInviareOra = suggerito > 0 && (dataInvio == null ? urgente : dataInvio <= oggi2);
    return {
      articolo_id: a.id,
      nome: a.nome,
      area: a.area,
      zona: a.zona,
      unita: a.unita,
      giacenza: Number(a.giacenza),
      giacenza_effettiva: eff,
      in_arrivo: inArrivo,
      punto_riordino: pr,
      consumo_finestra: consumo,
      rate: Math.round(rate * 100) / 100,
      giorni_residui: giorni != null ? Math.max(0, Math.floor(giorni)) : null,
      data_riordino: dataRiordino,
      data_invio_consigliata: dataInvio,
      da_inviare_ora: daInviareOra,
      suggerito,
      urgente,
      senza_storico: consumo === 0
    };
  });
  out.sort((a, b) => Number(b.da_inviare_ora) - Number(a.da_inviare_ora) || Number(b.urgente && b.suggerito > 0) - Number(a.urgente && a.suggerito > 0) || (a.giorni_residui ?? 9999) - (b.giorni_residui ?? 9999));
  res.json({ finestra_giorni: N, lead_time_giorni: LEAD, oggi: oggi2, articoli: out });
});
adminRouter.post("/magazzino/ordini", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  const art = await db.prepare("SELECT id FROM magazzino_articoli WHERE id=?").get(b.articolo_id);
  if (!art) return res.status(404).json({ error: "Articolo non trovato" });
  const q = Math.abs(Number(b.quantita || 0));
  if (!q) return res.status(400).json({ error: "Quantit\xE0 mancante" });
  const lead = await magLead();
  const oggi2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const dataPrevista = b.data_prevista || addGiorni(oggi2, lead);
  const info = await db.prepare("INSERT INTO magazzino_ordini (articolo_id,quantita,stato,data_invio,data_prevista,lead_time,note) VALUES (?,?,?,?,?,?,?)").run(art.id, q, "confermato", oggi2, dataPrevista, lead, b.note || null);
  audit(req.adminUser.username, "ordine_fornitore", "magazzino_ordini", info.lastInsertRowid, String(q));
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid), data_prevista: dataPrevista });
});
adminRouter.get("/magazzino/ordini", requireCap("magazzino"), async (req, res) => {
  const stato = req.query.stato || "confermato";
  const rows = await db.prepare("SELECT o.*, a.nome, a.unita FROM magazzino_ordini o JOIN magazzino_articoli a ON a.id=o.articolo_id WHERE o.stato=? ORDER BY o.data_prevista IS NULL, o.data_prevista, o.created_at DESC LIMIT 200").all(stato);
  res.json(rows);
});
adminRouter.post("/magazzino/ordini/:id/ricevi", requireCap("magazzino"), async (req, res) => {
  const o = await db.prepare("SELECT * FROM magazzino_ordini WHERE id=?").get(req.params.id);
  if (!o || o.stato !== "confermato") return res.status(400).json({ error: "Ordine non ricevibile" });
  const q = Number(o.quantita);
  const art = await db.prepare("SELECT giacenza FROM magazzino_articoli WHERE id=?").get(o.articolo_id);
  const nuova = Number(art.giacenza) + q;
  await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?").run(nuova, (/* @__PURE__ */ new Date()).toISOString(), o.articolo_id);
  await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore,zona) VALUES (?,?,?,?,?,?)").run(o.articolo_id, "carico", q, "ricezione ordine fornitore", req.adminUser.username, null);
  await db.prepare("UPDATE magazzino_ordini SET stato='ricevuto',updated_at=? WHERE id=?").run((/* @__PURE__ */ new Date()).toISOString(), o.id);
  audit(req.adminUser.username, "ricevi_ordine", "magazzino_ordini", o.id, String(q));
  res.json({ ok: true, giacenza: nuova });
});
adminRouter.post("/magazzino/ordini/:id/annulla", requireCap("magazzino"), async (req, res) => {
  await db.prepare("UPDATE magazzino_ordini SET stato='annullato',updated_at=? WHERE id=? AND stato='confermato'").run((/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  res.json({ ok: true });
});
function meseCorrente() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
}
function mesePrecedente(mese) {
  const [y, m] = mese.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
async function flussiMese(mese) {
  const rows = await db.prepare(`SELECT articolo_id,
      COALESCE(SUM(CASE WHEN tipo='carico' THEN quantita END),0) carico,
      COALESCE(SUM(CASE WHEN tipo='scarico' THEN quantita END),0) scarico,
      COALESCE(SUM(CASE WHEN tipo='scarico' AND zona='bar' THEN quantita END),0) scarico_bar,
      COALESCE(SUM(CASE WHEN tipo='scarico' AND zona='garden' THEN quantita END),0) scarico_garden,
      COALESCE(SUM(CASE WHEN tipo='scarico' AND (zona IS NULL OR zona NOT IN ('bar','garden')) THEN quantita END),0) scarico_centrale
    FROM magazzino_movimenti WHERE strftime('%Y-%m', created_at)=? GROUP BY articolo_id`).all(mese);
  const map = {};
  rows.forEach((r) => {
    map[r.articolo_id] = r;
  });
  return map;
}
async function chiudiMese(mese) {
  const prev = mesePrecedente(mese);
  const flussi = await flussiMese(mese);
  const prevClose = {};
  (await db.prepare("SELECT articolo_id, giacenza_finale FROM magazzino_quadrature WHERE mese=?").all(prev)).forEach((r) => {
    prevClose[r.articolo_id] = Number(r.giacenza_finale);
  });
  const arts = await db.prepare("SELECT id, giacenza FROM magazzino_articoli").all();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const a of arts) {
    const f = flussi[a.id] || { carico: 0, scarico: 0, scarico_bar: 0, scarico_garden: 0, scarico_centrale: 0 };
    const iniziale = a.id in prevClose ? prevClose[a.id] : null;
    await db.prepare("INSERT OR REPLACE INTO magazzino_quadrature (mese,articolo_id,giacenza_iniziale,giacenza_finale,carico,scarico,scarico_bar,scarico_garden,scarico_centrale,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(mese, a.id, iniziale, Number(a.giacenza), Number(f.carico), Number(f.scarico), Number(f.scarico_bar), Number(f.scarico_garden), Number(f.scarico_centrale), now);
  }
  return arts.length;
}
async function magAutoChiusura() {
  try {
    const oggi2 = /* @__PURE__ */ new Date();
    const prev = mesePrecedente(meseCorrente());
    const marker = await getSetting("mag_ultima_chiusura_auto", "");
    if (marker === prev) return;
    if (oggi2.getUTCDate() > 4) return;
    const has = await db.prepare("SELECT 1 FROM magazzino_movimenti WHERE strftime('%Y-%m',created_at)=? LIMIT 1").get(prev);
    if (!has) return;
    const closed = await db.prepare("SELECT 1 FROM magazzino_quadrature WHERE mese=? LIMIT 1").get(prev);
    if (closed) {
      await setSetting("mag_ultima_chiusura_auto", prev);
      return;
    }
    await chiudiMese(prev);
    await setSetting("mag_ultima_chiusura_auto", prev);
  } catch (_) {
  }
}
adminRouter.get("/magazzino/quadratura", requireCap("magazzino"), async (req, res) => {
  await magAutoChiusura();
  const mese = /^\d{4}-\d{2}$/.test(req.query.mese || "") ? req.query.mese : meseCorrente();
  const chiuso = await db.prepare("SELECT * FROM magazzino_quadrature WHERE mese=?").all(mese);
  const chiusaMap = {};
  chiuso.forEach((r) => {
    chiusaMap[r.articolo_id] = r;
  });
  const prevClose = {};
  (await db.prepare("SELECT articolo_id, giacenza_finale FROM magazzino_quadrature WHERE mese=?").all(mesePrecedente(mese))).forEach((r) => {
    prevClose[r.articolo_id] = Number(r.giacenza_finale);
  });
  const flussi = await flussiMese(mese);
  const arts = await db.prepare("SELECT * FROM magazzino_articoli ORDER BY area,ordine,id").all();
  const out = [];
  for (const a of arts) {
    const c = chiusaMap[a.id];
    const f = flussi[a.id] || { carico: 0, scarico: 0, scarico_bar: 0, scarico_garden: 0, scarico_centrale: 0 };
    const carico = c ? Number(c.carico) : Number(f.carico);
    const scarico = c ? Number(c.scarico) : Number(f.scarico);
    const scarico_bar = c ? Number(c.scarico_bar) : Number(f.scarico_bar);
    const scarico_garden = c ? Number(c.scarico_garden) : Number(f.scarico_garden);
    const scarico_centrale = c ? Number(c.scarico_centrale) : Number(f.scarico_centrale);
    const iniziale = c ? c.giacenza_iniziale != null ? Number(c.giacenza_iniziale) : null : a.id in prevClose ? prevClose[a.id] : null;
    const finale = c ? Number(c.giacenza_finale) : Number(a.giacenza);
    if (!carico && !scarico && !Number(a.giacenza) && iniziale == null) continue;
    const atteso = iniziale != null ? iniziale + carico - scarico : null;
    const scostamento = atteso != null ? Math.round((finale - atteso) * 100) / 100 : null;
    out.push({ articolo_id: a.id, nome: a.nome, zona: a.zona, unita: a.unita, giacenza_iniziale: iniziale, carico, scarico, scarico_bar, scarico_garden, scarico_centrale, giacenza_finale: finale, atteso, scostamento });
  }
  const tot = out.reduce((t, r) => ({ carico: t.carico + r.carico, scarico: t.scarico + r.scarico, scarico_bar: t.scarico_bar + r.scarico_bar, scarico_garden: t.scarico_garden + r.scarico_garden, scostamenti: t.scostamenti + (r.scostamento ? 1 : 0) }), { carico: 0, scarico: 0, scarico_bar: 0, scarico_garden: 0, scostamenti: 0 });
  const mesiMov = (await db.prepare("SELECT DISTINCT strftime('%Y-%m', created_at) m FROM magazzino_movimenti ORDER BY m DESC").all()).map((r) => r.m).filter(Boolean);
  const mesiChiusi = (await db.prepare("SELECT DISTINCT mese m FROM magazzino_quadrature ORDER BY m DESC").all()).map((r) => r.m);
  const mesi = [.../* @__PURE__ */ new Set([meseCorrente(), ...mesiMov, ...mesiChiusi])].sort().reverse();
  res.json({ mese, chiusa: chiuso.length > 0, articoli: out, totali: tot, mesi });
});
adminRouter.post("/magazzino/quadratura/chiudi", requireCap("magazzino"), async (req, res) => {
  const mese = /^\d{4}-\d{2}$/.test((req.body || {}).mese || "") ? req.body.mese : meseCorrente();
  const n = await chiudiMese(mese);
  audit(req.adminUser.username, "chiudi_mese", "magazzino_quadrature", mese, String(n));
  res.json({ ok: true, mese, articoli: n });
});
adminRouter.get("/magazzino/:id/movimenti", requireCap("magazzino"), async (req, res) => {
  const rows = await db.prepare("SELECT id,tipo,quantita,causale,operatore,created_at FROM magazzino_movimenti WHERE articolo_id=? ORDER BY id DESC LIMIT 50").all(req.params.id);
  res.json(rows);
});
function magNormArea(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "chiosco";
  const map = { "casa di carta": "casa_di_carta", "serata clan": "serata_clan", "serate a tema": "serate_tema", "serate tema": "serate_tema" };
  return map[s] || s.replace(/\s+/g, "_");
}
// Il tipo di consumo si deduce dall'unita' di misura quando non e' dichiarato: cio' che si
// conta a pezzi si scarica uno a uno, cio' che si misura a peso o a volume no.
var UNITA_A_PEZZO = ["pz", "pezzo", "pezzi", "n", "conf", "cf", "bottiglia", "lattina", "bustina", "barattolo", "scatola", "vasetto"];
function tipoConsumo(b) {
  if (b.tipo_consumo === "pezzo" || b.tipo_consumo === "peso") return b.tipo_consumo;
  return UNITA_A_PEZZO.includes(String(b.unita || "").toLowerCase()) ? "pezzo" : "peso";
}
function magNormZona(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s.startsWith("bar")) return "bar";
  if (s.startsWith("gard") || s.startsWith("giard")) return "garden";
  if (s.startsWith("cart") || s.startsWith("cdc") || s.startsWith("casa")) return "carta";
  return "comune";
}
function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[^\d,.\-]/g, "");
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc > -1) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function pickDelim(text) {
  const line = text.split(/\r?\n/)[0] || "";
  const c = (line.match(/,/g) || []).length, s = (line.match(/;/g) || []).length, t = (line.match(/\t/g) || []).length;
  if (s >= c && s >= t) return ";";
  if (t > c && t >= s) return "	";
  return ",";
}
function sheetRows(fileB64) {
  const buf = Buffer.from(String(fileB64 || "").replace(/^data:[^,]*,/, ""), "base64");
  const isZip = buf[0] === 80 && buf[1] === 75;
  const isOle = buf[0] === 208 && buf[1] === 207;
  let wb;
  if (isZip || isOle) {
    wb = XLSX.read(buf, { type: "buffer" });
  } else {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    wb = XLSX.read(text, { type: "string", FS: pickDelim(text), raw: true });
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true });
}
function parseMagFile(fileB64) {
  const json = sheetRows(fileB64);
  const norm = (s) => String(s || "").trim().toLowerCase();
  const alias = { nome: ["nome", "articolo", "prodotto", "name"], area: ["area", "reparto"], zona: ["zona", "zone", "ambiente"], unita: ["unita", "unit\xE0", "um", "unit"], giacenza: ["giacenza", "quantita", "quantit\xE0", "qta", "stock"], punto_riordino: ["punto_riordino", "riordino", "minimo", "min", "reorder"], soglia_preavviso: ["soglia_preavviso", "preavviso", "avviso", "soglia", "warning"] };
  return json.map((r) => {
    const keys = Object.keys(r);
    const pick = (al) => {
      const k = keys.find((k2) => al.includes(norm(k2)));
      return k != null ? r[k] : "";
    };
    return { nome: pick(alias.nome), area: pick(alias.area), zona: pick(alias.zona), unita: pick(alias.unita), giacenza: pick(alias.giacenza), punto_riordino: pick(alias.punto_riordino), soglia_preavviso: pick(alias.soglia_preavviso) };
  }).filter((r) => String(r.nome).trim());
}
adminRouter.post("/magazzino/import", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  let righe;
  try {
    righe = parseMagFile(b.fileB64);
  } catch (e) {
    return res.status(400).json({ error: "File non leggibile (usa .xlsx o .csv)" });
  }
  if (!righe.length) return res.status(400).json({ error: 'Nessuna riga valida (serve almeno la colonna "nome")' });
  // Se nel file non c'e' NESSUN prezzo leggibile, i prodotti nuovi entrerebbero a zero e il
  // gestore se ne accorgerebbe al primo scontrino. Meglio fermarsi e dire quali colonne si
  // sono lette: nove volte su dieci l'intestazione si chiama in un altro modo.
  if (righe.senzaPrezzo && !b.dryRun && !b.forza) {
    return res.status(409).json({
      error: 'Nel file non trovo nessun prezzo: i prodotti entrerebbero tutti a zero. Le colonne che ho letto sono: '
        + (righe.intestazioni || []).join(", ")
        + '. Rinomina la colonna dei prezzi in "prezzo", oppure conferma se vuoi davvero caricarli senza prezzo.',
      intestazioni: righe.intestazioni || []
    });
  }
  const num = toNum;
  if (b.dryRun) return res.json({ ok: true, totale: righe.length, anteprima: righe.slice(0, 12).map((r) => ({ ...r, area: magNormArea(r.area), zona: magNormZona(r.zona), giacenza: num(r.giacenza), punto_riordino: num(r.punto_riordino), soglia_preavviso: num(r.soglia_preavviso) })) });
  const clean = (v) => v == null || String(v).trim() === "" ? null : String(v).trim();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let creati = 0, aggiornati = 0;
  if (b.mode === "replace") {
    await db.exec("DELETE FROM magazzino_movimenti; DELETE FROM magazzino_articoli;");
  }
  for (const r of righe) {
    const nome = clean(r.nome);
    if (!nome) continue;
    const area = magNormArea(r.area);
    const zona = magNormZona(r.zona);
    const hasZona = r.zona != null && String(r.zona).trim() !== "";
    const ex = await db.prepare("SELECT * FROM magazzino_articoli WHERE nome=? AND area=?").get(nome, area);
    const hasG = r.giacenza != null && String(r.giacenza).trim() !== "";
    if (ex) {
      await db.prepare("UPDATE magazzino_articoli SET zona=?,unita=?,giacenza=?,punto_riordino=?,soglia_preavviso=?,aggiornato_at=? WHERE id=?").run(hasZona ? zona : ex.zona, clean(r.unita) ?? ex.unita, hasG ? num(r.giacenza) : ex.giacenza, r.punto_riordino !== "" ? num(r.punto_riordino) : ex.punto_riordino, r.soglia_preavviso !== "" ? num(r.soglia_preavviso) : ex.soglia_preavviso, now, ex.id);
      aggiornati++;
    } else {
      const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM magazzino_articoli").get()).n;
      await db.prepare("INSERT INTO magazzino_articoli (nome,area,zona,unita,giacenza,punto_riordino,soglia_preavviso,ordine,aggiornato_at,tipo_consumo,sfrido_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(nome, area, zona, clean(r.unita) || "pz", num(r.giacenza), num(r.punto_riordino), num(r.soglia_preavviso), ord, now);
      creati++;
    }
  }
  audit(req.adminUser.username, "import", "magazzino_articoli", null, `creati ${creati}, aggiornati ${aggiornati}`);
  res.json({ ok: true, creati, aggiornati });
});
function xlsxB64(rows, sheet) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}
var XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
adminRouter.get("/magazzino/export", requireCap("magazzino"), async (req, res) => {
  const arts = await db.prepare("SELECT nome,area,zona,unita,giacenza,punto_riordino,soglia_preavviso FROM magazzino_articoli ORDER BY area,nome").all();
  const rows = arts.map((a) => ({ nome: a.nome, area: a.area, zona: a.zona, unita: a.unita, giacenza: Number(a.giacenza), riordino: Number(a.punto_riordino), preavviso: Number(a.soglia_preavviso) }));
  res.json({ filename: "magazzino.xlsx", mime: XLSX_MIME, b64: xlsxB64(rows, "Magazzino") });
});
// L'esportazione deve contenere TUTTO quello che si vede nel listino, altrimenti il giro
// export -> correggo nel foglio -> reimporto perde per strada le spunte. I si'/no si leggono
// e si riscrivono: e' il modo piu' comodo per sistemare duecento righe in un colpo.
adminRouter.get("/menu/export", requireCap("comande"), async (req, res) => {
  const m = await db.prepare("SELECT * FROM menu_articoli ORDER BY ordine,id").all();
  const sn = (v) => Number(v) === 1 ? "si" : "no";
  const rows = m.map((x) => ({
    nome: x.nome,
    prezzo: Number(x.prezzo),
    stazione: x.stazione,
    punto: x.zona || "bar",
    categoria: x.categoria || "",
    descrizione: x.descrizione || "",
    allergeni: x.allergeni || "",
    attivo: sn(x.attivo),
    alcolico: sn(x.alcolico),
    condimenti: sn(x.con_condimenti),
    complemento: sn(x.complemento)
  }));
  res.json({ filename: "menu.xlsx", mime: XLSX_MIME, b64: xlsxB64(rows, "Menu") });
});
adminRouter.get("/menu", requireCap("comande"), async (req, res) => {
  // ?ordinabile=1 e' l'elenco con cui si batte una comanda: viene dal nucleo del menu', lo
  // stesso che vede il socio. Senza parametro e' il listino grezzo, che serve alla gestione.
  if (String(req.query.ordinabile || "") !== "1") {
    // Il listino porta anche il verdetto del sistema: e' un condimento? Cosi' la schermata puo'
    // mostrare la verita' invece di quello che qualcuno ha spuntato (o dimenticato di spuntare).
    const rows = await db.prepare("SELECT * FROM menu_articoli ORDER BY ordine,id").all();
    const suppl = quantoCostaCondire(
    (await db.prepare("SELECT * FROM menu_articoli WHERE attivo=1").all()).filter(eCondimento),
    await par("comande_supplemento_complementi"));
    return res.json(rows.map((m) => ({ ...m, e_condimento: eCondimento(m) ? 1 : 0, supplemento: suppl })));
  }
  const { voci } = await daOrdinare({ zona: String(req.query.zona || "") });
  res.json(voci);
});
// La diagnosi del menu': guarda i dati veri e dice quale condizione non e' soddisfatta.
// Il registro storico si consulta, non si modifica: ci sono solo rotte di lettura.
adminRouter.get("/registro", requireCap("comande"), async (req, res) => {
  res.json(await cercaRegistro({
    dal: String(req.query.dal || ""), al: String(req.query.al || ""),
    servizio: String(req.query.servizio || ""), fatto: String(req.query.fatto || ""),
    chi: String(req.query.chi || ""), limite: Number(req.query.limite || 300)
  }));
});
adminRouter.get("/registro/storia", requireCap("comande"), async (req, res) => {
  res.json(await storiaDi(String(req.query.servizio || ""), String(req.query.riferimento || "")));
});
// STATO DELLA POSTA. Se le e-mail non partono non se ne accorge nessuno finche' un socio non
// resta fuori dall'app: il codice viene generato lo stesso, il database lo salva lo stesso, e
// l'unica cosa che manca e' il messaggio. Qui si vede, e si puo' fare una prova vera.
// LA PREPAGATA AL BANCO: ricarica, saldo, e il debito complessivo verso i soci.
adminRouter.get("/tessera/:code/saldo", requireCap("comande"), async (req, res) => {
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=?").get(String(req.params.code).toUpperCase());
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const st = await statoPrepagata(socio);
  res.json({
    socio: { nome: socio.nome, cognome: socio.cognome, tessera: socio.tessera_code },
    prepagata: st,
    saldo: await saldoTessera(socio.id),
    movimenti: await movimentiTessera(socio.id, 20),
    ricarica_massima: Number(await par("tessera_ricarica_massima")) || 100
  });
});

adminRouter.post("/tessera/:code/ricarica", requireCap("comande"), async (req, res) => {
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=?").get(String(req.params.code).toUpperCase());
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const st = await statoPrepagata(socio);
  if (!st.attiva) return res.status(409).json({ error: st.motivo });
  const importo = Math.round(Number(req.body?.importo || 0) * 100) / 100;
  const massimo = Number(await par("tessera_ricarica_massima")) || 100;
  if (!(importo > 0)) return res.status(400).json({ error: "Scrivi quanto sta caricando" });
  if (importo > massimo) return res.status(400).json({ error: `La ricarica massima e' ${massimo} \u20ac.` });

  const m = await muovi({ socioId: socio.id, tipo: "ricarica", importo, causale: req.body?.metodo || "contanti", operatore: req.adminUser.username });
  // La ricarica NON e' un incasso di vendita: e' denaro ricevuto in anticipo. Va nel registro
  // come tale, cosi' a fine mese non si scambia per fatturato.
  await registra({
    fatto: "ricarica_tessera", servizio: "tessera", riferimento: socio.tessera_code,
    socio_id: socio.id, intestatario: `${socio.nome} ${socio.cognome}`,
    autore: req.adminUser.username, canale: "crew", importo,
    dettaglio: { metodo: req.body?.metodo || "contanti", saldo_dopo: m.saldo, nota: "anticipo, non ricavo" }
  });
  audit(req.adminUser.username, "ricarica_tessera", "soci", socio.id, `${importo} \u20ac`);
  res.json({ ok: true, saldo: m.saldo });
});

// Rimborso del residuo: a fine stagione il credito non speso e' del socio, non del residence.
adminRouter.post("/tessera/:code/rimborso", requireCap("comande"), async (req, res) => {
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=?").get(String(req.params.code).toUpperCase());
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const attuale = await saldoTessera(socio.id);
  const importo = Math.round(Number(req.body?.importo ?? attuale) * 100) / 100;
  if (!(importo > 0)) return res.status(400).json({ error: "Non c'e' credito da rimborsare" });
  const m = await muovi({ socioId: socio.id, tipo: "rimborso", importo: -importo, causale: "rimborso del residuo", operatore: req.adminUser.username });
  if (!m.ok) return res.status(409).json({ error: m.error });
  await registra({
    fatto: "rimborso_tessera", servizio: "tessera", riferimento: socio.tessera_code,
    socio_id: socio.id, intestatario: `${socio.nome} ${socio.cognome}`,
    autore: req.adminUser.username, canale: "crew", importo: -importo,
    dettaglio: { saldo_dopo: m.saldo }
  });
  res.json({ ok: true, saldo: m.saldo });
});

// SOSTITUIRE UNA TESSERA. Il numero identifica una persona, ma la card e' un oggetto: si
// perde, si rovina, smette di funzionare, o va rifatta perche' qualcuno ha dimenticato le
// proprie credenziali e l'utenza va azzerata.
//
// La persona resta la stessa: cambia solo la credenziale. Il numero vecchio NON si cancella —
// e' scritto dentro prenotazioni, iscrizioni e comande di stagioni passate — ma diventa
// revocato: resta leggibile nella storia e non serve piu' a prenotare o a pagare.
adminRouter.post("/soci/:id/nuova-tessera", requireCap("utenti"), async (req, res) => {
  const socio = await db.prepare("SELECT * FROM soci WHERE id=?").get(req.params.id);
  if (!socio) return res.status(404).json({ error: "Socio non trovato" });
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) return res.status(400).json({ error: "Scrivi perche' la stai rifacendo: persa, rovinata, non funziona, credenziali dimenticate." });

  const vecchia = socio.tessera_code;
  const nuova = await nextTessera();
  await db.prepare("UPDATE tessere SET stato='revocata', revocata_at=?, motivo=? WHERE code=?")
    .run(new Date().toISOString(), motivo, vecchia);
  await db.prepare("INSERT OR REPLACE INTO tessere (code,socio_id,stato,motivo) VALUES (?,?,'attiva',?)")
    .run(nuova, socio.id, "sostituisce " + vecchia);
  await db.prepare("UPDATE soci SET tessera_code=? WHERE id=?").run(nuova, socio.id);
  // Le credenziali dimenticate si azzerano insieme alla card: e' il caso per cui si rifa'.
  if (req.body?.azzera_credenziali) {
    await db.prepare("UPDATE soci SET pin_hash=NULL, pin_tentativi=0 WHERE id=?").run(socio.id);
  }
  audit(req.adminUser.username, "nuova_tessera", "soci", socio.id, `${vecchia} \u2192 ${nuova} \u00b7 ${motivo}`);
  await registra({
    fatto: "tessera_sostituita", servizio: "tessera", riferimento: nuova,
    socio_id: socio.id, intestatario: `${socio.nome} ${socio.cognome}`,
    autore: req.adminUser.username, canale: "backoffice",
    dettaglio: { vecchia, nuova, motivo, credenziali_azzerate: !!req.body?.azzera_credenziali }
  });
  res.json({ ok: true, tessera: nuova, precedente: vecchia });
});

// La storia delle tessere di una persona: quante ne ha avute e perche'.
adminRouter.get("/soci/:id/tessere", requireCap("utenti"), async (req, res) => {
  res.json(await db.prepare("SELECT code,stato,emessa_at,revocata_at,motivo FROM tessere WHERE socio_id=? ORDER BY emessa_at DESC").all(req.params.id));
});

adminRouter.put("/tessera/:code/pin", requireCap("comande"), async (req, res) => {
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=?").get(String(req.params.code).toUpperCase());
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const r = await impostaPin(socio.id, req.body?.pin);
  if (!r.ok) return res.status(400).json({ error: r.error });
  audit(req.adminUser.username, "imposta_pin", "soci", socio.id);
  res.json({ ok: true, messaggio: "PIN impostato. Il socio lo usa per pagare con la tessera." });
});
adminRouter.get("/tessere/debito", requireCap("comande"), async (req, res) => {
  res.json(await debitoVersoISoci());
});

adminRouter.get("/posta/stato", requireCap("soci"), async (req, res) => {
  const ultime = await db.prepare(
    "SELECT email,inviata,creato_at FROM otp WHERE creato_at IS NOT NULL ORDER BY id DESC LIMIT 20"
  ).all();
  const inviate = ultime.filter((x) => Number(x.inviata) === 1).length;
  res.json({
    attiva: mailAttiva(),
    fornitore: process.env.MAIL_PROVIDER || "console",
    mittente: process.env.MAIL_FROM || null,
    ultime_richieste: ultime.length,
    ultime_inviate: inviate,
    avviso: mailAttiva()
      ? null
      : "La posta non e' configurata: i codici di accesso NON partono. Chi prova a entrare con l'e-mail resta fuori. Imposta MAIL_PROVIDER, MAIL_API_KEY e MAIL_FROM."
  });
});
adminRouter.post("/posta/prova", requireCap("soci"), async (req, res) => {
  const a = String(req.body?.email || "").trim();
  if (!a.includes("@")) return res.status(400).json({ error: "Scrivi l'indirizzo a cui mandare la prova" });
  const esito = await inviaPosta({
    a,
    oggetto: "Prova di invio \u00b7 Bussola Residence",
    html: corniceMail("Prova di invio", "<p style=\"margin-top:0\">Se leggi questo messaggio, le e-mail della Bussola funzionano: i codici di accesso arriveranno.</p>")
  });
  audit(req.adminUser.username, "prova_posta", "posta", a, esito.inviata ? "inviata" : "NON inviata: " + esito.motivo);
  if (!esito.inviata) return res.status(502).json({ error: "Non e' partita: " + esito.motivo, ...esito });
  res.json({ ok: true, messaggio: "Inviata a " + a + ". Se non arriva entro qualche minuto, guarda nella posta indesiderata." });
});
adminRouter.get("/menu/diagnosi", requireCap("comande"), async (req, res) => {
  res.json(await diagnosiMenu());
});
// L'unica cosa da dire al sistema: questa voce e' un'aggiunta. Da quel momento sparisce
// dall'elenco e si spunta dentro i piatti che escono dalla cucina — tutti, senza abbinamenti.
adminRouter.put("/menu/:id/complemento", requireCap("comande"), async (req, res) => {
  const v = req.body?.complemento ? 1 : 0;
  await db.prepare("UPDATE menu_articoli SET complemento=? WHERE id=?").run(v, req.params.id);
  audit(req.adminUser.username, v ? "segna_complemento" : "torna_articolo", "menu_articoli", req.params.id);
  res.json({ ok: true, complemento: v });
});
// La spunta "Necessita condimenti" sul prodotto: da qui in poi dentro quel panino compare la
// riga con i condimenti da fleggare. E' l'unica cosa che decide, e la decide il gestore.
// SALVATAGGIO IN BLOCCO. Con duecento righe, un "Salva" per riga significa duecento clic e
// duecento occasioni di dimenticarsene una: le spunte si accumulano nella schermata e si
// scrivono tutte insieme. Ogni riga e' comunque un aggiornamento PARZIALE — si tocca solo
// quello che e' stato mandato, cosi' un salvataggio in blocco non azzera niente.
adminRouter.put("/menu", requireCap("comande"), async (req, res) => {
  const righe = Array.isArray(req.body?.righe) ? req.body.righe : [];
  if (!righe.length) return res.json({ ok: true, salvati: 0 });
  let salvati = 0;
  for (const r of righe) {
    const ex = await db.prepare("SELECT * FROM menu_articoli WHERE id=?").get(r.id);
    if (!ex) continue;
    const dato = (k) => Object.prototype.hasOwnProperty.call(r, k);
    const nome = dato("nome") ? r.nome : ex.nome;
    const categoria = dato("categoria") ? (r.categoria || null) : ex.categoria;
    const stazione = dato("stazione")
      ? (r.stazione === "cucina" ? "cucina" : (r.stazione === "bar" ? "bar" : inferStazione(nome, categoria)))
      : ex.stazione;
    await db.prepare("UPDATE menu_articoli SET nome=?,prezzo=?,stazione=?,zona=?,categoria=?,descrizione=?,allergeni=?,magazzino_id=?,attivo=?,con_condimenti=?,alcolico=?,complemento=? WHERE id=?").run(
      nome,
      dato("prezzo") ? Number(r.prezzo || 0) : ex.prezzo,
      stazione,
      dato("zona") ? menuZona(r.zona, stazione) : ex.zona,
      categoria,
      dato("descrizione") ? (r.descrizione ?? null) : ex.descrizione,
      dato("allergeni") ? (r.allergeni ?? null) : ex.allergeni,
      dato("magazzino_id") ? (r.magazzino_id || null) : ex.magazzino_id,
      dato("attivo") ? (r.attivo === false ? 0 : 1) : ex.attivo,
      dato("con_condimenti") ? (r.con_condimenti ? 1 : 0) : ex.con_condimenti,
      dato("alcolico") ? (r.alcolico ? 1 : 0) : ex.alcolico,
      dato("complemento") ? (r.complemento ? 1 : 0) : ex.complemento,
      ex.id
    );
    salvati++;
  }
  audit(req.adminUser.username, "salva_listino", "menu_articoli", null, `${salvati} righe`);
  res.json({ ok: true, salvati });
});
adminRouter.put("/menu/:id/condimenti", requireCap("comande"), async (req, res) => {
  const v = req.body?.con_condimenti ? 1 : 0;
  await db.prepare("UPDATE menu_articoli SET con_condimenti=? WHERE id=?").run(v, req.params.id);
  audit(req.adminUser.username, v ? "con_condimenti" : "senza_condimenti", "menu_articoli", req.params.id);
  res.json({ ok: true, con_condimenti: v });
});
adminRouter.post("/menu", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM menu_articoli").get()).n;
  const info = await db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,zona,categoria,descrizione,allergeni,magazzino_id,attivo,ordine,con_condimenti) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(b.nome, Number(b.prezzo || 0), b.stazione === "cucina" ? "cucina" : (b.stazione === "bar" ? "bar" : inferStazione(b.nome, b.categoria)), menuZona(b.zona, b.stazione), b.categoria || null, b.descrizione || null, b.allergeni || null, b.magazzino_id || null, b.attivo === false ? 0 : 1, ord, b.con_condimenti ? 1 : 0);
  audit(req.adminUser.username, "crea", "menu_articoli", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
// Salvataggio parziale: si aggiorna SOLO quello che e' stato mandato. Prima l'UPDATE scriveva
// tutte le colonne, e siccome la riga del listino non rispedisce descrizione e collegamento al
// magazzino, ogni "Salva" li azzerava in silenzio — sparivano la composizione del piatto e lo
// scarico di giacenza, senza che nessuno se ne accorgesse fino all'inventario.
adminRouter.put("/menu/:id", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  const ex = await db.prepare("SELECT * FROM menu_articoli WHERE id=?").get(req.params.id);
  if (!ex) return res.status(404).json({ error: "Articolo non trovato" });
  const dato = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const nome = dato("nome") ? b.nome : ex.nome;
  const categoria = dato("categoria") ? (b.categoria || null) : ex.categoria;
  const stazione = dato("stazione")
    ? (b.stazione === "cucina" ? "cucina" : (b.stazione === "bar" ? "bar" : inferStazione(nome, categoria)))
    : ex.stazione;
  await db.prepare("UPDATE menu_articoli SET nome=?,prezzo=?,stazione=?,zona=?,categoria=?,descrizione=?,allergeni=?,magazzino_id=?,attivo=?,con_condimenti=?,alcolico=? WHERE id=?").run(
    nome,
    dato("prezzo") ? Number(b.prezzo || 0) : ex.prezzo,
    stazione,
    dato("zona") ? menuZona(b.zona, stazione) : ex.zona,
    categoria,
    dato("descrizione") ? (b.descrizione ?? null) : ex.descrizione,
    dato("allergeni") ? (b.allergeni ?? null) : ex.allergeni,
    dato("magazzino_id") ? (b.magazzino_id || null) : ex.magazzino_id,
    dato("attivo") ? (b.attivo === false ? 0 : 1) : ex.attivo,
    dato("con_condimenti") ? (b.con_condimenti ? 1 : 0) : ex.con_condimenti,
    dato("alcolico") ? (b.alcolico ? 1 : 0) : ex.alcolico,
    req.params.id
  );
  audit(req.adminUser.username, "modifica", "menu_articoli", req.params.id);
  res.json({ ok: true });
});
// Le intestazioni si confrontavano ESATTE: "Prezzo (\u20ac)" o "PREZZO unitario" non venivano
// riconosciute, e i prodotti nuovi entravano a zero senza che nessuno dicesse niente. Ora
// l'intestazione si ripulisce prima di confrontarla — accenti, simboli, parentesi, spazi — e
// basta che cominci con la parola giusta.
function normIntestazione(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
var ALIAS_MENU = {
  nome: ["nome", "prodotto", "articolo", "name", "descrizione prodotto"],
  prezzo: ["prezzo", "price", "costo", "importo", "prezzo unitario", "prezzo di vendita"],
  stazione: ["stazione", "station", "reparto", "chi prepara"],
  punto: ["punto", "zona", "zone", "point", "dove si vende"],
  categoria: ["categoria", "category", "gruppo"],
  descrizione: ["descrizione", "description", "desc", "ingredienti"],
  allergeni: ["allergeni", "allergen", "allergens"],
  attivo: ["attivo", "attiva", "active", "in vendita"],
  alcolico: ["alcolico", "alcolica", "alcol", "18", "minori", "alcohol"],
  condimenti: ["condimenti", "condimento", "necessita condimenti", "con condimenti"],
  complemento: ["complemento", "compl", "aggiunta", "e un condimento"]
};
function parseMenuFile(fileB64) {
  const json = sheetRows(fileB64);
  const trovate = new Set();
  const righe = json.map((r) => {
    const keys = Object.keys(r);
    const pick = (al) => {
      const k = keys.find((k2) => {
        const n = normIntestazione(k2);
        return al.some((a) => n === a || n.startsWith(a + " "));
      });
      if (k != null) trovate.add(k);
      return k != null ? r[k] : "";
    };
    return {
      nome: pick(ALIAS_MENU.nome), prezzo: pick(ALIAS_MENU.prezzo), stazione: pick(ALIAS_MENU.stazione),
      punto: pick(ALIAS_MENU.punto), categoria: pick(ALIAS_MENU.categoria), descrizione: pick(ALIAS_MENU.descrizione),
      allergeni: pick(ALIAS_MENU.allergeni), attivo: pick(ALIAS_MENU.attivo), alcolico: pick(ALIAS_MENU.alcolico),
      condimenti: pick(ALIAS_MENU.condimenti), complemento: pick(ALIAS_MENU.complemento)
    };
  }).filter((r) => String(r.nome).trim());
  // Le intestazioni presenti nel file servono a spiegare al gestore cosa NON e' stato letto.
  righe.intestazioni = json.length ? Object.keys(json[0]) : [];
  righe.senzaPrezzo = righe.length > 0 && righe.every((r) => String(r.prezzo ?? "").trim() === "");
  return righe;
}
// "si"/"no", "1"/"0", "x", "true": il gestore scrive come gli viene, e va bene cosi'.
function siNo(v, sePrecedente) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return sePrecedente;
  return ["si", "s\u00ec", "s", "1", "x", "true", "vero", "y", "yes"].includes(s);
}
adminRouter.post("/menu/import", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  let righe;
  try {
    righe = parseMenuFile(b.fileB64);
  } catch (e) {
    return res.status(400).json({ error: "File non leggibile (usa .xlsx o .csv)" });
  }
  if (!righe.length) return res.status(400).json({ error: 'Nessuna riga valida (serve almeno la colonna "nome")' });
  // Se nel file non c'e' NESSUN prezzo leggibile, i prodotti nuovi entrerebbero a zero e il
  // gestore se ne accorgerebbe al primo scontrino. Meglio fermarsi e dire quali colonne si
  // sono lette: nove volte su dieci l'intestazione si chiama in un altro modo.
  if (righe.senzaPrezzo && !b.dryRun && !b.forza) {
    return res.status(409).json({
      error: 'Nel file non trovo nessun prezzo: i prodotti entrerebbero tutti a zero. Le colonne che ho letto sono: '
        + (righe.intestazioni || []).join(", ")
        + '. Rinomina la colonna dei prezzi in "prezzo", oppure conferma se vuoi davvero caricarli senza prezzo.',
      intestazioni: righe.intestazioni || []
    });
  }
  const clean = (v) => v == null || String(v).trim() === "" ? null : String(v).trim();
  const catImport = (r, staz, ex) => clean(r.categoria) || ex && ex.categoria || inferCategoria(r.nome) || (staz === "cucina" ? "Cucina" : "Bar");
  // L'anteprima deve mostrare quello che succedera' davvero, stazione dedotta compresa:
  // altrimenti il gestore approva un'importazione e poi ne trova un'altra.
  if (b.dryRun) return res.json({ ok: true, totale: righe.length, anteprima: righe.slice(0, 12).map((r) => {
    const dich = String(r.stazione || "").toLowerCase();
    const cat = clean(r.categoria) || inferCategoria(r.nome);
    const staz = dich.startsWith("cuc") ? "cucina" : (dich.startsWith("bar") ? "bar" : inferStazione(r.nome, cat));
    return { ...r, stazione: staz, prezzo: toNum(r.prezzo), categoria: catImport(r, staz, null) };
  }) });
  let creati = 0, aggiornati = 0;
  if (b.mode === "replace") {
    // "Sostituisci" azzerava il listino senza chiedere niente a nessuno, aggirando la stessa
    // protezione che impedisce di cancellare un singolo prodotto. Con comande aperte sul
    // tavolo, quelle righe restavano orfane e smettevano di scaricare il magazzino.
    const inUso = await db.prepare(
      `SELECT COUNT(DISTINCT r.menu_id) n FROM comanda_righe r
       JOIN comande c ON c.id = r.comanda_id
       WHERE r.menu_id IS NOT NULL AND c.stato NOT IN ('chiusa','annullata')`
    ).get();
    const quanti = Number(inUso?.n || 0);
    if (quanti > 0 && !b.forza) {
      return res.status(409).json({
        error: `Ci sono ${quanti} prodotti dentro comande ancora aperte: sostituire il listino ora le lascerebbe senza collegamento, e quelle comande non scaricherebbero il magazzino. Chiudi il servizio e riprova, oppure conferma di voler procedere lo stesso.`,
        in_uso: quanti
      });
    }
    await db.exec("DELETE FROM menu_articoli;");
  }
  for (const r of righe) {
    const nome = clean(r.nome);
    if (!nome) continue;
    const hasPrezzo = r.prezzo != null && String(r.prezzo).trim() !== "";
    const prezzo = toNum(r.prezzo);
    // Se il file non dichiara la stazione, la si deduce dal nome e dalla categoria: nessuno
    // compila quella colonna su duecento righe, e un listino tutto "bar" lascia il KDS Cucina
    // vuoto. La categoria serve alla deduzione, quindi si calcola prima.
    const dichiarata = String(r.stazione || "").toLowerCase();
    const descrizione = clean(r.descrizione), allergeni = clean(r.allergeni);
    const ex = await db.prepare("SELECT * FROM menu_articoli WHERE nome=?").get(nome);
    const catFile = clean(r.categoria) || (ex && ex.categoria) || inferCategoria(nome);
    const stazione = dichiarata.startsWith("cuc")
      ? "cucina"
      : (dichiarata.startsWith("bar") ? "bar" : inferStazione(nome, catFile));
    const categoria = catImport(r, r.stazione ? stazione : ex ? ex.stazione : stazione, ex);
    const hasPunto = r.punto != null && String(r.punto).trim() !== "";
    const zonaNew = hasPunto ? menuZona(r.punto, stazione) : stazione === "cucina" ? "comune" : inferPunto(nome, categoria);
    const puntoSignal = hasPunto || !!clean(r.categoria) || !!(r.stazione && String(r.stazione).trim());
    if (ex) {
      await db.prepare("UPDATE menu_articoli SET prezzo=?,stazione=?,zona=?,categoria=?,descrizione=?,allergeni=?,attivo=?,alcolico=?,con_condimenti=?,complemento=? WHERE id=?").run(hasPrezzo ? prezzo : ex.prezzo, r.stazione ? stazione : ex.stazione, zonaNew, categoria, descrizione ?? ex.descrizione, allergeni ?? ex.allergeni, siNo(r.attivo, ex.attivo === 1) ? 1 : 0, siNo(r.alcolico, ex.alcolico === 1) ? 1 : 0, siNo(r.condimenti, ex.con_condimenti === 1) ? 1 : 0, siNo(r.complemento, ex.complemento === 1) ? 1 : 0, ex.id);
      aggiornati++;
    } else {
      const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM menu_articoli").get()).n;
      await db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,zona,categoria,descrizione,allergeni,attivo,ordine,alcolico,con_condimenti,complemento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(nome, prezzo, stazione, zonaNew, categoria, descrizione, allergeni,
          siNo(r.attivo, true) ? 1 : 0, ord,
          siNo(r.alcolico, false) ? 1 : 0, siNo(r.condimenti, false) ? 1 : 0, siNo(r.complemento, false) ? 1 : 0);
      creati++;
    }
  }
  audit(req.adminUser.username, "import", "menu_articoli", null, `creati ${creati}, aggiornati ${aggiornati}`);
  res.json({ ok: true, creati, aggiornati });
});
adminRouter.post("/menu/ricategorizza", requireCap("comande"), async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,stazione FROM menu_articoli WHERE categoria IS NULL OR trim(categoria)=''").all();
  let n = 0;
  for (const m of rows) {
    const cat = inferCategoria(m.nome) || (m.stazione === "cucina" ? "Cucina" : "Bar");
    await db.prepare("UPDATE menu_articoli SET categoria=? WHERE id=?").run(cat, m.id);
    n++;
  }
  audit(req.adminUser.username, "ricategorizza", "menu_articoli", null, `categorizzati ${n}`);
  res.json({ ok: true, categorizzati: n });
});
// Quello che passa dalla cucina si vende in tutte e due le aree. E' la regola vera del posto:
// un panino lo prepara la cucina, ma chi e' al bar alle sei di pomeriggio lo ordina lo stesso.
// Chiuderlo nel Garden significava renderlo invisibile al Bar — e infatti lo era.
// I prodotti che richiedono una lavorazione e si vendono in tutti e due i punti (panini,
// fritti, gelati sfusi): si segnano Cucina + Entrambi in un colpo solo, per categoria.
// Senza categorie indicate restituisce l'elenco fra cui scegliere.
// Rimette a posto "Chi prepara" su tutto il listino, deducendolo dal nome e dalla categoria.
// Serve dopo che un comando in massa ha marcato Cucina anche quello che si serve al banco:
// con `dryRun` mostra cosa cambierebbe, e solo dopo si esegue. La deduzione non e' infallibile,
// ma il gestore vede la lista prima di dire di si', e puo' sempre correggere riga per riga.
adminRouter.post("/menu/ricalcola-stazione", requireCap("comande"), async (req, res) => {
  const storte = await incoerenzeMenu();
  if (req.body?.dryRun) return res.json({ ok: true, cambierebbero: storte.length, elenco: storte });
  for (const x of storte) {
    await db.prepare("UPDATE menu_articoli SET stazione=? WHERE id=?").run(x.dovrebbe, x.id);
  }
  audit(req.adminUser.username, "ricalcola_stazione", "menu_articoli", null, `${storte.length} corretti`);
  res.json({ ok: true, corretti: storte.length, elenco: storte });
});
adminRouter.post("/menu/cross-cucina", requireCap("comande"), async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,categoria FROM menu_articoli").all();
  const cats = Array.isArray(req.body?.categorie) ? req.body.categorie.map((c) => String(c).trim().toLowerCase()).filter(Boolean) : [];
  const categorie = [...new Set(rows.map((m) => String(m.categoria || "").trim()).filter(Boolean))].sort();
  if (!cats.length) return res.json({ ok: true, aggiornati: 0, categorie });
  // Questo comando ha gia' fatto danno una volta: applicato a categorie che non c'entrano
  // (Caffetteria, Bibite, Alcolici) manda al KDS Cucina cose che nessuno cucinera' mai, e
  // ce ne si accorge solo dal servizio che non funziona. Ora si ferma e lo dice prima.
  const bersagli = rows.filter((m) => cats.includes(String(m.categoria || "").trim().toLowerCase()));
  const daBanco = bersagli.filter((m) => inferStazione(m.nome, m.categoria) !== "cucina");
  if (daBanco.length && !req.body?.forza) {
    return res.status(409).json({
      error: `Fra le categorie scelte ci sono ${daBanco.length} prodotti che si servono al banco (${daBanco.slice(0, 4).map((m) => m.nome).join(", ")}\u2026). Marcarli \u201ccucina\u201d li manda al KDS Cucina, dove nessuno li prepara. Togli quelle categorie, oppure conferma se sai quello che fai.`,
      da_banco: daBanco.length,
      esempi: daBanco.slice(0, 8).map((m) => ({ nome: m.nome, categoria: m.categoria }))
    });
  }
  let aggiornati = 0;
  for (const m of bersagli) {
    await db.prepare("UPDATE menu_articoli SET stazione='cucina', zona='comune' WHERE id=?").run(m.id);
    aggiornati++;
  }
  audit(req.adminUser.username, "cross_cucina", "menu_articoli", null, `${aggiornati} articoli`);
  res.json({ ok: true, aggiornati, categorie });
});
adminRouter.post("/menu/deduci-punto", requireCap("comande"), async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,categoria,stazione FROM menu_articoli").all();
  let garden = 0, bar = 0, entrambi = 0;
  for (const m of rows) {
    const z = m.stazione === "cucina" ? "comune" : inferPunto(m.nome, m.categoria);
    await db.prepare("UPDATE menu_articoli SET zona=? WHERE id=?").run(z, m.id);
    if (z === "comune") entrambi++;
    else if (z === "garden") garden++;
    else bar++;
  }
  audit(req.adminUser.username, "deduci_punto", "menu_articoli", null, `entrambi ${entrambi}, garden ${garden}, bar ${bar}`);
  res.json({ ok: true, garden, bar, entrambi });
});
// Collega una voce di menu a un articolo di magazzino, con la quantita' consumata per pezzo.
adminRouter.put("/menu/:id/magazzino", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  const id = b.magazzino_id ? Number(b.magazzino_id) : null;
  const q = Math.max(0, Number(b.consumo) || 1);
  await db.prepare("UPDATE menu_articoli SET magazzino_id=?, consumo=? WHERE id=?").run(id, q, req.params.id);
  audit(req.adminUser.username, "collega_magazzino", "menu_articoli", req.params.id, id ? `articolo ${id} \xD7 ${q}` : "scollegato");
  res.json({ ok: true });
});
adminRouter.delete("/menu/:id", requireCap("comande"), async (req, res) => {
  if (await bloccaSeCollegato(res, "menu_articoli", req.params.id, "la voce di men\xF9")) return;
  await db.prepare("DELETE FROM menu_articoli WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "menu_articoli", req.params.id);
  res.json({ ok: true });
});

// Chiudere una comanda scarica il magazzino: per ogni riga, se la voce di menu e' collegata a
// un articolo, esce la quantita' venduta moltiplicata per il consumo unitario. Senza questo il
// magazzino resta fermo mentre si vende — la simulazione di stagione ha prodotto 1008 comande
// e zero movimenti, con il punto di riordino che non scattava mai.

async function comandaConRighe(id) {
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(id);
  if (!c) return null;
  c.righe = await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? ORDER BY id").all(id);
  return c;
}
// Comande dimenticate: restano "aperte" e tengono il tavolo occupato per sempre — e' cosi' che
// un tavolo risulta "sporco" il giorno dopo. Si chiudono da sole, pigramente, quando qualcuno
// guarda le comande: nessun processo da tenere vivo.
async function chiudiComandeAbbandonate() {
  if (!await par("comande_chiusura_automatica")) return 0;
  const ore = Math.max(1, Number(await par("comande_ore_abbandono")) || 6);
  const limite = new Date(Date.now() - ore * 3600000).toISOString();
  const vecchie = await db.prepare(
    "SELECT id,numero,riferimento FROM comande WHERE stato IN ('aperta','in_preparazione','pronta') AND created_at < ?"
  ).all(limite);
  for (const c of vecchie) {
    // ABBANDONATA NON E' INCASSATA. Prima queste comande venivano marcate "chiusa", che nel
    // sistema significa una cosa sola: pagata. Una comanda mai lavorata, decaduta dopo sei
    // ore, finiva cosi' nel fatturato del giorno e nell'estratto conto del socio — che si
    // ritrovava una spesa per qualcosa che non ha mai avuto.
    //
    // Si annulla, con il motivo. Il magazzino non scarica (niente e' uscito) e l'incasso non
    // esiste (nessuno ha pagato). Se poi qualcuno l'aveva davvero servita, la si riapre: e'
    // molto meglio di un ammanco che nessuno sa spiegare.
    await db.prepare("UPDATE comande SET stato='annullata',updated_at=? WHERE id=?").run((/* @__PURE__ */ new Date()).toISOString(), c.id);
    audit("sistema", "annullata_per_abbandono", "comande", c.id, `#${c.numero} \xB7 tavolo ${c.riferimento || "-"} \xB7 oltre ${ore}h senza essere lavorata`);
    await registra({
      fatto: "comanda_annullata", servizio: "comande", riferimento: c.numero,
      autore: "il sistema", canale: "sistema",
      dettaglio: { motivo: `mai lavorata: abbandonata dopo ${ore} ore`, automatica: true }
    });
  }
  return vecchie.length;
}

// Scarico da comanda, con una distinzione che viene dal mestiere e non dal software.
//
// Un articolo A PEZZO — bottiglia, lattina, gelato, bustina di zucchero — si scarica uno a
// uno ed e' esatto: quello che hai venduto e' quello che e' uscito.
//
// Un articolo A PESO — caffe', latte, insalata — non si scarica, perche' la resa reale non e'
// la ricetta: da una pianta di lattuga escono tre piatti o quattro a seconda di com'e' fatta,
// e trenta grammi di caffe' sono una media, non una misura. Per questi si accumula il consumo
// TEORICO, che non tocca la giacenza: serve a essere confrontato con la conta vera. La
// differenza fra i due numeri e' l'informazione che interessa — sfrido, omaggi, sprechi — e
// non serve che il teorico sia esatto: serve che sia stabile.
async function scaricaMagazzinoDaComanda(comandaId, chi) {
  const c = await db.prepare("SELECT id,scaricata,zona FROM comande WHERE id=?").get(comandaId);
  if (!c || c.scaricata) return 0;                    // una comanda scarica una volta sola
  const oggi = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let mosse = 0, teorici = 0;

  // 1) il collegamento diretto voce di menu' → articolo (bevande, confezionati)
  const dirette = await db.prepare(
    `SELECT r.qta, m.magazzino_id AS articolo_id, m.consumo AS quantita
     FROM comanda_righe r JOIN menu_articoli m ON m.id = r.menu_id
     WHERE r.comanda_id=? AND r.stato<>'stornata' AND m.magazzino_id IS NOT NULL`
  ).all(comandaId);
  // 2) la distinta: una voce di menu' puo' consumare piu' articoli (un caffe' macchiato
  //    consuma caffe' e latte)
  const daDistinta = await db.prepare(
    `SELECT r.qta, d.articolo_id, d.quantita
     FROM comanda_righe r JOIN menu_distinta d ON d.menu_id = r.menu_id
     WHERE r.comanda_id=? AND r.stato<>'stornata'`
  ).all(comandaId);

  for (const r of [...dirette, ...daDistinta]) {
    const q = Number(r.qta || 0) * Number(r.quantita || 1);
    if (!(q > 0)) continue;
    const art = await db.prepare("SELECT id,nome,giacenza,tipo_consumo,sfrido_pct FROM magazzino_articoli WHERE id=?").get(r.articolo_id);
    if (!art) continue;
    const conSfrido = q * (1 + (Number(art.sfrido_pct) || 0) / 100);

    if ((art.tipo_consumo || "peso") === "pezzo") {
      await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?")
        .run(Number(art.giacenza) - q, (/* @__PURE__ */ new Date()).toISOString(), art.id);
      await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore,zona) VALUES (?,?,?,?,?,?)")
        .run(art.id, "scarico", q, "vendita comanda #" + comandaId, chi || "sistema", c.zona || null);
      mosse++;
    } else {
      await db.prepare(
        "INSERT INTO consumo_teorico (articolo_id,data,quantita) VALUES (?,?,?) ON CONFLICT(articolo_id,data) DO UPDATE SET quantita = quantita + excluded.quantita"
      ).run(art.id, oggi, conSfrido);
      teorici++;
    }
  }
  if (mosse || teorici) await db.prepare("UPDATE comande SET scaricata=1 WHERE id=?").run(comandaId);
  return mosse;
}

adminRouter.get("/comande", requireCap("comande"), async (req, res) => {
  await chiudiComandeAbbandonate();
  const stato = req.query.stato;
  let rows;
  // Con una stagione da mille comande, "le ultime cento" non e' uno storico: si filtra per
  // data e si pagina. ?da=&a= (YYYY-MM-DD) · ?limite= · ?offset=
  if (req.query.da || req.query.a) {
    const da = String(req.query.da || "1970-01-01").slice(0, 10);
    const a = String(req.query.a || "2999-12-31").slice(0, 10);
    const lim = Math.min(1000, Math.max(1, Number(req.query.limite) || 200));
    const off = Math.max(0, Number(req.query.offset) || 0);
    rows = await db.prepare(
      "SELECT * FROM comande WHERE date(created_at) BETWEEN ? AND ? ORDER BY id DESC LIMIT ? OFFSET ?"
    ).all(da, a, lim, off);
  }
  else if (stato === "tutte") rows = await db.prepare("SELECT * FROM comande ORDER BY id DESC LIMIT 200").all();
  else if (stato) rows = await db.prepare("SELECT * FROM comande WHERE stato=? ORDER BY id DESC LIMIT 100").all(stato);
  else rows = ordinaCoda(await db.prepare("SELECT * FROM comande WHERE stato NOT IN ('chiusa','annullata') ORDER BY id").all());
  for (const c of rows) c.righe = await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? ORDER BY id").all(c.id);
  res.json(rows);
});
adminRouter.post("/comande", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  const righe = Array.isArray(b.righe) ? b.righe.filter((r) => r && r.menu_id && Number(r.qta) > 0) : [];
  if (!righe.length) return res.status(400).json({ error: "Aggiungi almeno un articolo" });
  const numero = (await db.prepare("SELECT COALESCE(MAX(numero),0)+1 n FROM comande WHERE date(created_at)=date('now')").get()).n;
  const zona = ["bar", "carta", "garden"].includes(b.zona) ? b.zona : "garden";
  const info = await db.prepare("INSERT INTO comande (numero,origine,riferimento,zona,stato,totale,operatore,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(numero, ["tavolo", "bancone", "chiosco", "bar"].includes(b.origine) ? b.origine : zona === "bar" ? "bar" : "tavolo", b.riferimento || null, zona, "aperta", 0, req.adminUser.username, b.note || null, (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString());
  const cid = Number(info.lastInsertRowid);
  let totale = 0;
  const supplemento = quantoCostaCondire(
    (await db.prepare("SELECT * FROM menu_articoli WHERE attivo=1").all()).filter(eCondimento),
    await par("comande_supplemento_complementi"));
  for (const r of righe) {
    const m = await db.prepare("SELECT * FROM menu_articoli WHERE id=?").get(r.menu_id);
    if (!m) continue;
    const qta = Math.max(1, Math.round(Number(r.qta)));
    totale += Number(m.prezzo) * qta;
    const info2 = await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,magazzino_id) VALUES (?,?,?,?,?,?,?,?,?)").run(cid, m.id, m.nome, Number(m.prezzo), qta, m.stazione, r.note || null, "in_coda", m.magazzino_id || null);
    // Anche quando la comanda la batte il cameriere: i condimenti spuntati diventano righe
    // figlie a prezzo zero (per la cucina e per il magazzino) e il supplemento e' uno solo.
    const scelti = Array.isArray(r.complementi) ? r.complementi.map(Number).filter(Boolean) : [];
    if (!scelti.length) continue;
    const ammessi = await condimentiAmmessi(m);
    if (!ammessi.length) continue;
    const padre = Number(info2.lastInsertRowid);
    let messi = 0;
    for (const c of ammessi) {
      if (!scelti.includes(Number(c.id))) continue;
      messi++;
      await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,magazzino_id,parent_riga_id) VALUES (?,?,?,0,?,?,NULL,'in_coda',?,?)").run(cid, c.id, c.nome, qta, m.stazione, c.magazzino_id || null, padre);
    }
    if (messi && supplemento > 0) {
      totale += supplemento * qta;
      await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,magazzino_id,parent_riga_id) VALUES (?,NULL,?,?,?,?,NULL,'in_coda',NULL,?)").run(cid, "Supplemento condimenti", supplemento, qta, m.stazione, padre);
    }
  }
  // Stessa regola dell'app: prima dell'apertura la comanda si prende, con l'ora di consegna.
  const haCucina = !!(await db.prepare("SELECT 1 x FROM comanda_righe WHERE comanda_id=? AND stazione='cucina' LIMIT 1").get(cid));
  const nonPrima = await primoRitiro(haCucina);
  await db.prepare("UPDATE comande SET totale=?, non_prima=? WHERE id=?").run(totale, nonPrima, cid);
  await registra({
    fatto: "comanda_aperta", servizio: "comande", riferimento: numero,
    intestatario: b.nome || null, autore: req.adminUser.username, canale: "crew",
    importo: totale, dettaglio: { zona: b.zona || null, origine: b.origine || null, riferimento_tavolo: b.riferimento || null, righe: righe.length }
  });
  audit(req.adminUser.username, "crea", "comande", cid, "n." + numero);
  res.status(201).json({ ...(await comandaConRighe(cid)), avviso: avvisoRitiro(nonPrima) });
});
adminRouter.put("/comande/:id/stato", requireCap("comande"), async (req, res) => {
  const stato = req.body && req.body.stato;
  if (!["aperta", "in_preparazione", "pronta", "consegnata", "chiusa", "annullata"].includes(stato)) return res.status(400).json({ error: "Stato non valido" });
  const prev = (await db.prepare("SELECT stato FROM comande WHERE id=?").get(req.params.id) || {}).stato;
  await db.prepare("UPDATE comande SET stato=?,updated_at=? WHERE id=?").run(stato, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  if (stato === "pronta") {
    await segnaPronta(req.params.id);
    await avvisaProntoSeSelf(req.params.id, prev);
  }
  if ((stato === "chiusa" || stato === "consegnata") && prev !== "chiusa") {
    await scaricaMagazzinoDaComanda(req.params.id, req.adminUser.username);
  }
  // Chiusura e annullamento sono i due momenti che finiscono in una contestazione: chi ha
  // incassato, chi ha annullato, quando. Restano scritti per quindici anni.
  if (stato === "chiusa" || stato === "annullata") {
    const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(req.params.id);
    await registra({
      fatto: stato === "chiusa" ? "comanda_chiusa" : "comanda_annullata",
      servizio: "comande", riferimento: c ? c.numero : req.params.id,
      socio_id: c ? c.socio_id : null, intestatario: c ? (c.nome || null) : null,
      autore: req.adminUser.username, canale: "crew",
      importo: c ? c.totale : null,
      dettaglio: { zona: c ? c.zona : null, riferimento_tavolo: c ? c.riferimento : null, stato_precedente: prev }
    });
  }
  audit(req.adminUser.username, "stato:" + stato, "comande", req.params.id);
  res.json(await comandaConRighe(req.params.id));
});
adminRouter.put("/comande/:id/riga/:rid/stato", requireCap("comande"), async (req, res) => {
  const stato = req.body && req.body.stato;
  if (!["in_coda", "pronta", "consegnata"].includes(stato)) return res.status(400).json({ error: "Stato riga non valido" });
  await db.prepare("UPDATE comanda_righe SET stato=? WHERE id=? AND comanda_id=?").run(stato, req.params.rid, req.params.id);
  const righe = await db.prepare("SELECT stato FROM comanda_righe WHERE comanda_id=?").all(req.params.id);
  const cur = await db.prepare("SELECT stato FROM comande WHERE id=?").get(req.params.id);
  if (cur && !["chiusa", "annullata"].includes(cur.stato) && righe.length) {
    let nuovo = cur.stato;
    if (righe.every((r) => r.stato === "consegnata")) nuovo = "consegnata";
    else if (righe.every((r) => r.stato === "pronta" || r.stato === "consegnata")) nuovo = "pronta";
    else if (righe.some((r) => r.stato !== "in_coda")) nuovo = "in_preparazione";
    else nuovo = "aperta";
    if (nuovo !== cur.stato) {
      await db.prepare("UPDATE comande SET stato=?,updated_at=? WHERE id=?").run(nuovo, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
      if (nuovo === "pronta") {
        await segnaPronta(req.params.id);
        await avvisaProntoSeSelf(req.params.id, cur.stato);
      }
    }
  }
  res.json(await comandaConRighe(req.params.id));
});
adminRouter.get("/self-order/stato", requireCap("comande"), async (req, res) => {
  res.json(await statoCompleto());
});
adminRouter.post("/self-order/pausa", requireCap("comande"), async (req, res) => {
  const aperto = !!(req.body && req.body.aperto);
  await setSelfOrderAperto(aperto);
  audit(req.adminUser.username, aperto ? "self_order_apri" : "self_order_chiudi", "impostazioni", "self_order_aperto");
  res.json({ ok: true, aperto });
});
adminRouter.get("/self-order/config", requireCap("comande"), async (req, res) => {
  res.json(await getConfig());
});
adminRouter.post("/self-order/config", requireCap("comande"), async (req, res) => {
  await setConfig(req.body || {});
  audit(req.adminUser.username, "self_order_config", "impostazioni", "", JSON.stringify(req.body || {}));
  res.json({ ok: true, config: await getConfig() });
});
adminRouter.post("/comande/:id/chiudi", requireCap("comande"), async (req, res) => {
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Comanda non trovata" });
  if (c.stato === "chiusa") return res.json(await comandaConRighe(req.params.id));
  // "tessera" mancava dall'elenco, quindi diventava "contanti" IN SILENZIO: la comanda
  // risultava incassata, il saldo del socio restava intatto e la cassa non tornava.
  const metodi = ["contanti", "carta", "satispay", "buoni", "tessera", "altro"];
  const metodo = metodi.includes(req.body?.metodo) ? req.body.metodo : "contanti";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  // PAGAMENTO CON LA TESSERA: si scala il saldo, e solo se basta. Il credito era gia' stato
  // versato: qui non entra denaro nuovo, si trasforma in ricavo un anticipo che il socio aveva
  // gia' dato. E' il momento in cui quel debito si chiude.
  if (metodo === "tessera") {
    const tess = String(req.body?.tessera_code || "").trim() || (c.socio_id ? (await db.prepare("SELECT tessera_code FROM soci WHERE id=?").get(c.socio_id))?.tessera_code : "");
    const socioT = tess ? await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=?").get(String(tess).toUpperCase()) : null;
    if (!socioT) return res.status(400).json({ error: "Serve la tessera di chi paga" });
    const st = await statoPrepagata(socioT);
    if (!st.attiva) return res.status(409).json({ error: st.motivo });
    // Il PIN autorizza la spesa. Il numero di tessera no: e' scritto sulla card e si indovina.
    const soglia = Number(await par("tessera_pin_oltre"));
    if (Number(c.totale) > soglia) {
      const v = await verificaPin(socioT, req.body?.pin);
      if (!v.ok) return res.status(403).json({ error: v.error, serve_pin: true });
    }
    const m = await muovi({
      socioId: socioT.id, tipo: "spesa", importo: -Number(c.totale),
      causale: `comanda #${c.numero}`, comandaId: c.id, operatore: req.adminUser.username
    });
    if (!m.ok) return res.status(409).json({ error: m.error + " Paga la differenza in un altro modo, oppure ricarica." });
  }
  await db.prepare("UPDATE comande SET stato=?,metodo_pagamento=?,pagata_at=?,updated_at=? WHERE id=?").run("chiusa", metodo, now, now, c.id);
  // C'erano DUE strade per chiudere una comanda — questa, che incassa, e il cambio di stato —
  // e solo l'altra scaricava il magazzino. Chi incassava dal conto del tavolo vendeva merce
  // che per le giacenze non era mai uscita: in una stagione di simulazione, zero movimenti di
  // scarico su ottomila comande. Se ne accorge l'inventario, mesi dopo.
  await scaricaMagazzinoDaComanda(c.id, req.adminUser.username);

  // COPIA DI CORTESIA PER POSTA. Chi ordina col QR il conto ce l'ha gia' sul telefono; chi si
  // e' fatto servire al tavolo, o usa la versione leggera, o semplicemente non ha inquadrato
  // niente, non ha niente in mano. Se un indirizzo c'e' — quello del socio, o quello che
  // l'operatore scrive al momento — gliela si manda. Lo scontrino fiscale resta una cosa a
  // parte, e il messaggio lo dice.
  // L'indirizzo scritto dall'operatore vale sempre: l'ha chiesto il cliente in quel momento.
  // Quello del socio NO, se non lo si accende apposta: mandare una copia per ogni comanda
  // significa tre mail al giorno a chi prende tre caffe', e in una settimana quel socio ha
  // disattivato tutto. La copia e' un servizio, non un automatismo.
  let ricevuta = { inviata: false };
  const auto = String(await par("ricevuta_email_automatica")) === "true" || (await par("ricevuta_email_automatica")) === true;
  const dest = String(req.body?.email || "").trim() ||
    (auto && c.socio_id ? (await db.prepare("SELECT email FROM soci WHERE id=?").get(c.socio_id))?.email : "") || "";
  if (dest.includes("@")) {
    const rr = await db.prepare("SELECT nome,prezzo,qta FROM comanda_righe WHERE comanda_id=? AND stato<>'stornata' ORDER BY id").all(c.id);
    ricevuta = await inviaRicevuta(dest, {
      numero: c.numero, data: (c.created_at || "").slice(0, 10), punto: c.punto || c.zona,
      righe: rr, totale: c.totale, metodo
    });
  }
  await registra({
    fatto: "comanda_chiusa", servizio: "comande", riferimento: c.numero,
    socio_id: c.socio_id, intestatario: c.nome || null,
    autore: req.adminUser.username, canale: "crew", importo: c.totale,
    dettaglio: { zona: c.zona, riferimento_tavolo: c.riferimento, metodo }
  });
  audit(req.adminUser.username, "chiudi", "comande", c.id, `tot ${c.totale} \xB7 ${metodo}`);
  res.json({ ...(await comandaConRighe(c.id)), ricevuta_inviata: !!ricevuta.inviata, ricevuta_a: ricevuta.inviata ? dest : null });
});
// STORNO DI UNA RIGA. Serve quando qualcosa cambia dopo che l'ordine e' partito: un articolo
// finisce mentre la comanda e' gia' in cucina, il cliente rifiuta la sostituzione, il cameriere
// ha battuto la riga sbagliata. Finora si poteva solo cancellare la comanda INTERA, che in
// mezzo a un servizio non e' una risposta.
//
// La riga non si cancella: si marca stornata, con il MOTIVO e CHI l'ha stornata. Sparisce dal
// conto e dal KDS, ma resta nel dettaglio della comanda e nel registro storico — perche' se
// domani il cliente contesta l'addebito, la risposta dev'essere una riga, non un ricordo.
adminRouter.put("/comande/righe/:rigaId/storna", requireCap("comande"), async (req, res) => {
  const r = await db.prepare("SELECT * FROM comanda_righe WHERE id=?").get(req.params.rigaId);
  if (!r) return res.status(404).json({ error: "Riga non trovata" });
  if (r.stato === "stornata") return res.status(409).json({ error: "Questa riga e' gia' stornata" });
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(r.comanda_id);
  if (c && (c.stato === "chiusa" || c.stato === "annullata")) {
    return res.status(409).json({ error: "La comanda e' gia' chiusa: uno storno a conto fatto non si registra qui." });
  }
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) return res.status(400).json({ error: "Scrivi il motivo dello storno: e' quello che serve davanti a una contestazione." });

  // Con la riga se ne vanno i suoi condimenti e il suo supplemento: erano parte del piatto.
  const figlie = await db.prepare("SELECT * FROM comanda_righe WHERE parent_riga_id=?").all(r.id);
  const ids = [r.id].concat(figlie.map((f) => f.id));
  for (const id of ids) {
    await db.prepare("UPDATE comanda_righe SET stato='stornata', motivo_storno=?, stornata_da=? WHERE id=?")
      .run(motivo, req.adminUser.username, id);
  }
  const stornato = Number(r.prezzo) * Number(r.qta) + figlie.reduce((t, f) => t + Number(f.prezzo) * Number(f.qta), 0);
  await db.prepare("UPDATE comande SET totale=MAX(0, totale-?), updated_at=? WHERE id=?")
    .run(stornato, new Date().toISOString(), r.comanda_id);

  await registra({
    fatto: "riga_stornata", servizio: "comande", riferimento: c ? c.numero : r.comanda_id,
    socio_id: c ? c.socio_id : null, intestatario: c ? (c.nome || null) : null,
    autore: req.adminUser.username, canale: "crew", importo: -stornato,
    dettaglio: { articolo: r.nome, quantita: r.qta, motivo, in_cucina: r.stato !== "in_coda" }
  });
  // La sala deve saperlo, e non a voce: il tavolo si accende e il messaggio si legge aprendolo.
  // Se il cliente non viene avvisato, lo scopre quando il piatto non arriva.
  await avvisaLaSala(r.comanda_id, `\u21a9\ufe0e Tolto dalla comanda: ${r.qta}\u00d7 ${r.nome} \u2014 ${motivo}. Avvisa il cliente.`);
  audit(req.adminUser.username, "storna_riga", "comanda_righe", r.id, motivo);
  res.json(await comandaConRighe(r.comanda_id));
});

// La cucina parla alla sala. Un messaggio per volta, l'ultimo conta: e' un promemoria da
// leggere aprendo il tavolo, non uno storico (quello sta nel registro).
async function avvisaLaSala(comandaId, testo) {
  await db.prepare("UPDATE comande SET avviso_cucina=?, avviso_cucina_at=? WHERE id=?")
    .run(testo, new Date().toISOString(), comandaId);
}
adminRouter.put("/comande/:id/avviso-letto", requireCap("comande"), async (req, res) => {
  await db.prepare("UPDATE comande SET avviso_cucina=NULL, avviso_cucina_at=NULL WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// FATTO MA NON SERVITO. E' il gemello dello storno, e la differenza non e' formale: il piatto
// e' stato cucinato davvero. Esce dal conto — il cliente non lo paga — ma la merce E' USCITA,
// quindi il magazzino deve scaricarla lo stesso. Trattarlo come uno storno significa ritrovarsi
// all'inventario un ammanco che nessuno sa spiegare.
adminRouter.put("/comande/righe/:rigaId/non-servita", requireCap("comande"), async (req, res) => {
  const r = await db.prepare("SELECT * FROM comanda_righe WHERE id=?").get(req.params.rigaId);
  if (!r) return res.status(404).json({ error: "Riga non trovata" });
  if (r.stato === "stornata" || r.stato === "non_servita") return res.status(409).json({ error: "Questa riga e' gia' fuori dal conto" });
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(r.comanda_id);
  if (c && (c.stato === "chiusa" || c.stato === "annullata")) {
    return res.status(409).json({ error: "La comanda e' gia' chiusa." });
  }
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) return res.status(400).json({ error: "Scrivi cosa e' successo: e' quello che spiega lo sfrido a fine mese." });

  const figlie = await db.prepare("SELECT * FROM comanda_righe WHERE parent_riga_id=?").all(r.id);
  for (const id of [r.id].concat(figlie.map((f) => f.id))) {
    await db.prepare("UPDATE comanda_righe SET stato='non_servita', motivo_storno=?, stornata_da=? WHERE id=?")
      .run(motivo, req.adminUser.username, id);
  }
  const tolto = Number(r.prezzo) * Number(r.qta) + figlie.reduce((t, f) => t + Number(f.prezzo) * Number(f.qta), 0);
  await db.prepare("UPDATE comande SET totale=MAX(0, totale-?), updated_at=? WHERE id=?")
    .run(tolto, new Date().toISOString(), r.comanda_id);

  await avvisaLaSala(r.comanda_id, `\u26a0\ufe0f Preparato ma non servito: ${r.qta}\u00d7 ${r.nome} \u2014 ${motivo}. Fuori dal conto. Avvisa il cliente.`);
  await registra({
    fatto: "riga_non_servita", servizio: "comande", riferimento: c ? c.numero : r.comanda_id,
    socio_id: c ? c.socio_id : null, intestatario: c ? (c.nome || null) : null,
    autore: req.adminUser.username, canale: "crew", importo: -tolto,
    dettaglio: { articolo: r.nome, quantita: r.qta, motivo, merce_consumata: true }
  });
  audit(req.adminUser.username, "non_servita", "comanda_righe", r.id, motivo);
  res.json(await comandaConRighe(r.comanda_id));
});
// SOSTITUZIONE: l'articolo e' finito, il cliente accetta un'alternativa. Un gesto solo, cosi'
// al banco non si rischia di stornare e poi dimenticarsi di aggiungere.
adminRouter.post("/comande/righe/:rigaId/sostituisci", requireCap("comande"), async (req, res) => {
  const r = await db.prepare("SELECT * FROM comanda_righe WHERE id=?").get(req.params.rigaId);
  if (!r) return res.status(404).json({ error: "Riga non trovata" });
  const m = await db.prepare("SELECT * FROM menu_articoli WHERE id=? AND attivo=1").get(req.body?.menu_id);
  if (!m) return res.status(400).json({ error: "Scegli l'articolo con cui sostituirla" });
  const motivo = String(req.body?.motivo || "").trim() || "articolo esaurito";
  const qta = Math.max(1, Math.round(Number(req.body?.qta) || r.qta));

  const figlie = await db.prepare("SELECT * FROM comanda_righe WHERE parent_riga_id=?").all(r.id);
  for (const id of [r.id].concat(figlie.map((f) => f.id))) {
    await db.prepare("UPDATE comanda_righe SET stato='stornata', motivo_storno=?, stornata_da=? WHERE id=?")
      .run(motivo + " \u2192 sostituito con " + m.nome, req.adminUser.username, id);
  }
  const tolto = Number(r.prezzo) * Number(r.qta) + figlie.reduce((t, f) => t + Number(f.prezzo) * Number(f.qta), 0);
  await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,magazzino_id) VALUES (?,?,?,?,?,?,?, 'in_coda', ?)")
    .run(r.comanda_id, m.id, m.nome, Number(m.prezzo), qta, m.stazione, "in sostituzione di " + r.nome, m.magazzino_id || null);
  await db.prepare("UPDATE comande SET totale=MAX(0, totale-?)+?, updated_at=? WHERE id=?")
    .run(tolto, Number(m.prezzo) * qta, new Date().toISOString(), r.comanda_id);

  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(r.comanda_id);
  await registra({
    fatto: "riga_sostituita", servizio: "comande", riferimento: c ? c.numero : r.comanda_id,
    socio_id: c ? c.socio_id : null, intestatario: c ? (c.nome || null) : null,
    autore: req.adminUser.username, canale: "crew", importo: Number(m.prezzo) * qta - tolto,
    dettaglio: { da: r.nome, a: m.nome, quantita: qta, motivo }
  });
  audit(req.adminUser.username, "sostituisci_riga", "comanda_righe", r.id, r.nome + " -> " + m.nome);
  res.json(await comandaConRighe(r.comanda_id));
});
// CAMBIO TAVOLO a comanda aperta. Capita: il gruppo si sposta perche' al sole non si sta, si
// libera un tavolo piu' grande, o due tavolate si accorpano. Finora la comanda restava attaccata
// al tavolo di partenza e il conto compariva nel posto sbagliato — con il rischio, alla fine
// del turno, di presentarlo a chi non aveva mangiato quella roba.
adminRouter.put("/comande/:id/tavolo", requireCap("comande"), async (req, res) => {
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Comanda non trovata" });
  if (c.stato === "chiusa" || c.stato === "annullata") {
    return res.status(409).json({ error: "La comanda e' gia' chiusa: il tavolo non si cambia piu'." });
  }
  const nuovo = String(req.body?.riferimento || "").trim();
  if (!nuovo) return res.status(400).json({ error: "Indica il tavolo di destinazione" });
  if (nuovo === String(c.riferimento || "")) return res.status(400).json({ error: "E' gia' questo il tavolo" });

  // DIVIETO DI TRASFERIMENTO SU UNA TAVOLATA. Se il tavolo di partenza o quello di arrivo sono
  // accostati ad altri, spostare la comanda lascerebbe il conto agganciato a un tavolo che
  // fisicamente non esiste piu' come entita' a se'. La crew prepara prima la sala — separa, o
  // accosta — e poi sposta: il sistema non prova a indovinare cosa volesse dire.
  if (c.zona === "garden" && /^\d+$/.test(nuovo)) {
    // mappaTavoli vuole la data, non un oggetto: `verso` dice a quale tavolo punta un numero
    // assorbito da un'unione, ed e' esattamente quello che serve qui.
    const giorno = (c.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const mappa = await mappaTavoli(giorno).catch(() => null);
    const cerca = (num) => (mappa?.tavoli || []).find((t) => String(t.numero) === String(num) && t.attivo !== 0);
    const daT = cerca(c.riferimento), aT = cerca(nuovo);
    const unito = (t) => t && Array.isArray(t.uniti) && t.uniti.length > 0;
    if (unito(daT) || unito(aT)) {
      const quale = unito(daT) ? `Il tavolo ${c.riferimento} e' accostato a ${daT.uniti.join(", ")}` : `Il tavolo ${nuovo} e' accostato a ${aT.uniti.join(", ")}`;
      return res.status(409).json({
        error: `${quale}: una comanda non si sposta da o verso una tavolata unita. Separa i tavoli (o accosta quelli che servono) e poi sposta la comanda.`,
        tavolo_unito: unito(daT) ? c.riferimento : nuovo
      });
    }
    // Se il tavolo di destinazione non si trova nella pianta letta, NON si blocca: la
    // disposizione del giorno puo' essere un'altra, o il tavolo puo' essere stato aggiunto
    // fisicamente. Si vieta solo quello che si vede davvero, cioe' l'accostamento.
  }

  // Il tavolo di destinazione puo' essere prenotato per un turno successivo: non e' un motivo
  // per dire di no — quel turno comincia fra un'ora e mezza, e il tavolo stasera e' libero. Ma
  // chi accoglie deve saperlo, per decidere lui: si avvisa e si va avanti.
  let avvisoTavolo = null;
  const giornoOra = (c.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const pren = await db.prepare(
    "SELECT turno,nome,persone,tavoli FROM prenotazioni_tavolo WHERE ambiente='garden' AND stato='prenotato' AND data=? ORDER BY turno"
  ).all(giornoOra).catch(() => []);
  for (const p of pren) {
    let nums = [];
    try { nums = JSON.parse(p.tavoli || "[]").map(String); } catch (_) { }
    if (!nums.includes(String(nuovo))) continue;
    avvisoTavolo = `Attenzione: il tavolo ${nuovo} \u00e8 prenotato per le ${p.turno}${p.nome ? " a nome " + p.nome : ""}${p.persone ? " (" + p.persone + " pers.)" : ""}. Lo spostamento \u00e8 fatto: tienilo presente per il cambio turno.`;
    break;
  }

  await db.prepare("UPDATE comande SET riferimento=?, updated_at=? WHERE id=?")
    .run(nuovo, new Date().toISOString(), c.id);
  // Resta scritto da dove a dove: se poi qualcuno contesta il conto di un tavolo, la storia
  // dello spostamento e' l'unica cosa che spiega perche' quella comanda sta li'.
  await registra({
    fatto: "comanda_spostata", servizio: "comande", riferimento: c.numero,
    socio_id: c.socio_id, intestatario: c.nome || null,
    autore: req.adminUser.username, canale: "crew", importo: c.totale,
    dettaglio: { da_tavolo: c.riferimento || null, a_tavolo: nuovo, motivo: req.body?.motivo || null }
  });
  audit(req.adminUser.username, "sposta_tavolo", "comande", c.id, `${c.riferimento} -> ${nuovo}`);
  res.json({ ...(await comandaConRighe(c.id)), avviso: avvisoTavolo });
});
adminRouter.delete("/comande/:id", requireCap("comande"), async (req, res) => {
  await db.prepare("DELETE FROM comanda_righe WHERE comanda_id=?").run(req.params.id);
  await db.prepare("DELETE FROM comande WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "comande", req.params.id);
  res.json({ ok: true });
});
// Il KDS mostra COSE DA PREPARARE. Il supplemento condimenti e' una riga di denaro — serve al
// conto, non alla piastra — e in cucina compariva con il suo tasto "Pronta", come se qualcuno
// dovesse cucinare cinquanta centesimi. I condimenti veri invece servono: ma non sono piatti a
// se', vanno dentro il panino, e vanno letti sotto il piatto a cui appartengono.
adminRouter.get("/kds", requireCap("comande"), async (req, res) => {
  const staz = req.query.stazione;
  const comande = ordinaCoda(await db.prepare("SELECT * FROM comande WHERE stato IN ('aperta','in_preparazione','pronta') ORDER BY id").all());
  const out = [];
  for (const c of comande) {
    const righe = staz ? await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? AND stazione=? AND stato NOT IN ('consegnata','stornata','non_servita') AND NOT (parent_riga_id IS NOT NULL AND menu_id IS NULL) ORDER BY id").all(c.id, staz) : await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? AND stato!='consegnata' ORDER BY id").all(c.id);
    if (righe.length) out.push({ ...c, righe });
  }
  res.json(out);
});
adminRouter.get("/pwa-qr", async (req, res) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const base = `${proto}://${host}`;
  const items = [
    { scope: "soci", label: "App Soci", path: "/" },
    { scope: "chiosco", label: "App Chiosco", path: "/chiosco/" },
    { scope: "admin", label: "Back Office", path: "/admin/" }
  ].map((it) => {
    const url2 = base + it.path;
    return { ...it, url: url2, svg: qrSvg(url2, { cellSize: 6, margin: 2 }) };
  });
  res.json({ base, items });
});
adminRouter.get("/qr-ordina", async (req, res) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const punto = String(req.query.punto || "Chiosco").trim();
  const tavolo = String(req.query.tavolo || "").trim();
  const url2 = `${proto}://${host}/ordina?p=${encodeURIComponent(punto)}${tavolo ? "&t=" + encodeURIComponent(tavolo) : ""}`;
  res.json({ url: url2, punto, tavolo, svg: qrSvg(url2, { cellSize: 6, margin: 2 }) });
});
var HOST_FIELDS = ["nome", "cir", "cin", "regole", "isolato", "numero", "check_out", "lat", "lng"];
function pickStruttura(b) {
  const o = {};
  for (const k of HOST_FIELDS) o[k] = b[k] ?? "";
  if (o.lat !== "") o.lat = Number(o.lat);
  if (o.lng !== "") o.lng = Number(o.lng);
  return o;
}
adminRouter.get("/soci/:id/host", requireCap("utenti"), async (req, res) => {
  const s = await db.prepare("SELECT id,host,host_ko,struttura_id,tipo_profilo FROM soci WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Utente non trovato" });
  const rows = await db.prepare("SELECT id,dati_cifrati,attivo FROM strutture WHERE socio_id=? ORDER BY id").all(s.id);
  let ko = false;
  const strutture = rows.map((r) => {
    const d = tryDecryptJSON(r.dati_cifrati);
    if (!d) {
      ko = true;
      return { id: r.id, ko: true, attivo: r.attivo };
    }
    return { id: r.id, attivo: r.attivo, ...d };
  });
  if (ko) {
    await db.prepare("UPDATE soci SET host_ko=1 WHERE id=?").run(s.id);
    audit(req.adminUser.username, "host_KO", "strutture", s.id, "integrit\xE0 non verificabile");
  }
  res.json({ host: s.host, host_ko: ko ? 1 : s.host_ko, struttura_id: s.struttura_id, tipo_profilo: s.tipo_profilo, strutture });
});
adminRouter.put("/soci/:id/host", requireCap("utenti"), async (req, res) => {
  const s = await db.prepare("SELECT id,tipo_profilo FROM soci WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Utente non trovato" });
  const on = req.body?.host ? 1 : 0;
  if (on && !["residente", "socio_residente"].includes(s.tipo_profilo)) return res.status(409).json({ error: "Il profilo host \xE8 riservato ai Residenti (e Soci-residenti)" });
  await db.prepare("UPDATE soci SET host=? WHERE id=?").run(on, req.params.id);
  audit(req.adminUser.username, on ? "abilita_host" : "disabilita_host", "soci", req.params.id);
  res.json({ ok: true });
});
adminRouter.post("/soci/:id/strutture", requireCap("utenti"), async (req, res) => {
  const s = await db.prepare("SELECT id,host FROM soci WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Utente non trovato" });
  if (!s.host) return res.status(409).json({ error: "Abilita prima il flag host" });
  const n = (await db.prepare("SELECT COUNT(*) n FROM strutture WHERE socio_id=?").get(s.id)).n;
  if (n >= 3) return res.status(409).json({ error: "Massimo 3 strutture per host" });
  const b = req.body || {};
  if (!String(b.nome || "").trim()) return res.status(400).json({ error: "Nome struttura obbligatorio" });
  const info = await db.prepare("INSERT INTO strutture (socio_id,dati_cifrati,attivo) VALUES (?,?,1)").run(s.id, encryptJSON(pickStruttura(b)));
  audit(req.adminUser.username, "crea_struttura", "strutture", info.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
adminRouter.put("/strutture/:id", requireCap("utenti"), async (req, res) => {
  const st = await db.prepare("SELECT id FROM strutture WHERE id=?").get(req.params.id);
  if (!st) return res.status(404).json({ error: "Struttura non trovata" });
  const b = req.body || {};
  await db.prepare("UPDATE strutture SET dati_cifrati=?,attivo=? WHERE id=?").run(encryptJSON(pickStruttura(b)), b.attivo === false ? 0 : 1, req.params.id);
  audit(req.adminUser.username, "modifica_struttura", "strutture", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/strutture/:id", requireCap("utenti"), async (req, res) => {
  await db.prepare("UPDATE soci SET struttura_id=NULL WHERE struttura_id=?").run(req.params.id);
  await db.prepare("DELETE FROM strutture WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "elimina_struttura", "strutture", req.params.id);
  res.json({ ok: true });
});
adminRouter.put("/soci/:id/collega-struttura", requireCap("utenti"), async (req, res) => {
  const sid = req.body?.struttura_id ? Number(req.body.struttura_id) : null;
  if (sid) {
    const st = await db.prepare("SELECT id FROM strutture WHERE id=?").get(sid);
    if (!st) return res.status(404).json({ error: "Struttura inesistente" });
  }
  await db.prepare("UPDATE soci SET struttura_id=? WHERE id=?").run(sid, req.params.id);
  audit(req.adminUser.username, "collega_struttura", "soci", req.params.id, sid ? "struttura " + sid : "scollegato");
  res.json({ ok: true });
});
adminRouter.get("/strutture-collegabili", requireCap("utenti"), async (req, res) => {
  const rows = await db.prepare("SELECT st.id, st.dati_cifrati, s.nome AS host_nome, s.cognome AS host_cognome FROM strutture st JOIN soci s ON s.id=st.socio_id WHERE st.attivo=1 ORDER BY st.id").all();
  const out = rows.map((r) => {
    const d = tryDecryptJSON(r.dati_cifrati);
    return { id: r.id, nome: d ? d.nome : "(dati non leggibili)", host: (r.host_nome || "") + " " + (r.host_cognome || "") };
  });
  res.json(out);
});
adminRouter.get("/campi", requireCap("campi"), async (req, res) => {
  // Chi ha il permesso "campi" gestisce quelli del chiosco: i campi a pagamento hanno un
  // gestore loro e non devono comparire nelle sue tendine. Il gestore dell'app li vede tutti,
  // perche' e' supervisore e deve poter cambiare la gestione di un campo.
  const tutti = req.adminUser?.ruolo === "gestore" || String(req.query.tutti) === "1";
  res.json(await db.prepare(
    tutti ? "SELECT * FROM campi ORDER BY ordine,id" : "SELECT * FROM campi WHERE gestione<>'tennis' ORDER BY ordine,id"
  ).all());
});
adminRouter.post("/campi", requireCap("campi"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM campi").get()).n;
  const info = await db.prepare("INSERT INTO campi (nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default,attivo,ordine,max_slot_prenotazione,max_pren_settimana,min_giocatori,gestione) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(b.nome, b.sport || "pickleball", b.apertura || "09:00", b.chiusura || "22:00", Number(b.durata_slot) || 60, b.ora_min || null, Number(b.posti_default) || 4, b.attivo === false ? 0 : 1, ord, Math.max(1, Number(b.max_slot_prenotazione) || 2), Math.max(1, Number(b.max_pren_settimana) || 3), Math.max(1, Number(b.min_giocatori) || 2), "chiosco");
  audit(req.adminUser.username, "crea", "campi", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/campi/:id", requireCap("campi"), async (req, res) => {
  // I campi dell'area tennis non si toccano da qui: hanno un gestore loro, con le sue tariffe e
  // i suoi orari. Il gestore dell'app resta supervisore — puo' cambiare la gestione di un campo,
  // non amministrarlo al posto suo.
  {
    const _c = await db.prepare("SELECT gestione FROM campi WHERE id=?").get(req.params.id);
    if (_c && String(_c.gestione || "chiosco") === "tennis" && !req.body?.forza_supervisore) {
      return res.status(409).json({ error: "Questo campo e' dell'area tennis: si gestisce dal suo modulo." });
    }
  }
  const b = req.body || {};
  await db.prepare("UPDATE campi SET nome=?,sport=?,apertura=?,chiusura=?,durata_slot=?,ora_min=?,posti_default=?,attivo=?,max_slot_prenotazione=?,max_pren_settimana=?,min_giocatori=? WHERE id=?").run(b.nome, b.sport || "pickleball", b.apertura || "09:00", b.chiusura || "22:00", Number(b.durata_slot) || 60, b.ora_min || null, Number(b.posti_default) || 4, b.attivo === false ? 0 : 1, Math.max(1, Number(b.max_slot_prenotazione) || 2), Math.max(1, Number(b.max_pren_settimana) || 3), Math.max(1, Number(b.min_giocatori) || 2), req.params.id);
  audit(req.adminUser.username, "modifica", "campi", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/campi/:id", requireCap("campi"), async (req, res) => {
  // I campi dell'area tennis non si toccano da qui: hanno un gestore loro, con le sue tariffe e
  // i suoi orari. Il gestore dell'app resta supervisore — puo' cambiare la gestione di un campo,
  // non amministrarlo al posto suo.
  {
    const _c = await db.prepare("SELECT gestione FROM campi WHERE id=?").get(req.params.id);
    if (_c && String(_c.gestione || "chiosco") === "tennis" && !req.body?.forza_supervisore) {
      return res.status(409).json({ error: "Questo campo e' dell'area tennis: si gestisce dal suo modulo." });
    }
  }
  if (await bloccaSeCollegato(res, "campi", req.params.id, "il campo")) return;
  await db.prepare("DELETE FROM partita_iscritti WHERE partita_id IN (SELECT id FROM partite_aperte WHERE campo_id=?)").run(req.params.id);
  await db.prepare("DELETE FROM partite_aperte WHERE campo_id=?").run(req.params.id);
  await db.prepare("DELETE FROM prenotazioni_campo WHERE campo_id=?").run(req.params.id);
  await db.prepare("DELETE FROM campi_blocchi WHERE campo_id=?").run(req.params.id);
  await db.prepare("DELETE FROM campi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "campi", req.params.id);
  res.json({ ok: true });
});
// Governance: chi usa i campi. Una riga per prenotazione (non per fascia), con titolare
// e partecipanti, cosi' si sa a chi fare riferimento per ogni slot occupato.
adminRouter.get("/campi/prenotazioni", requireCap("campi"), async (req, res) => {
  const data = req.query.data ? String(req.query.data).slice(0, 10) : null;
  // I campi a pagamento non compaiono al chiosco: sono di un'altra gestione, e mostrarli qui
  // significa dare al banco del chiosco prenotazioni che non deve toccare.
  const sel = "SELECT p.*, c.nome AS campo_nome, c.ordine AS campo_ordine FROM prenotazioni_campo p JOIN campi c ON c.id=p.campo_id WHERE p.stato='prenotato' AND c.gestione<>'tennis'";
  const rows = data
    ? await db.prepare(sel + " AND p.data=? ORDER BY p.slot,c.ordine").all(data)
    : await db.prepare(sel + " ORDER BY p.data DESC,p.slot LIMIT 200").all();
  // Raggruppa le fasce consecutive della stessa prenotazione.
  const gruppi = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const k = r.partita_id ? "p" + r.partita_id : "r" + r.id;
    const g = gruppi.get(k);
    if (g) {
      g.slot_da = g.slot_da < r.slot ? g.slot_da : r.slot;
      g.slot_a = g.slot_a > r.slot ? g.slot_a : r.slot;
      g.fasce++;
    } else {
      gruppi.set(k, {
        id: r.id, partita_id: r.partita_id || null, campo_id: r.campo_id, campo_nome: r.campo_nome,
        campo_ordine: r.campo_ordine, data: r.data, slot: r.slot, slot_da: r.slot, slot_a: r.slot,
        fasce: 1, tipo: r.tipo, titolare: r.nome || "", titolare_socio_id: r.titolare_socio_id || r.socio_id || null,
        tessera_code: r.tessera_code || "", partecipanti: [], posti_totali: null, aperta_ai_soci: r.tipo !== "privata"
      });
    }
  }
  const out = [...gruppi.values()];
  for (const g of out) {
    if (!g.partita_id) continue;
    const pa = await db.prepare("SELECT posti_totali,aperta_ai_soci,stato FROM partite_aperte WHERE id=?").get(g.partita_id);
    if (pa) {
      g.posti_totali = pa.posti_totali;
      g.aperta_ai_soci = pa.aperta_ai_soci !== 0;
      g.stato_partita = pa.stato;
    }
    const isc = await db.prepare("SELECT nome,tessera_code FROM partita_iscritti WHERE partita_id=? ORDER BY id").all(g.partita_id);
    g.partecipanti = isc.map((x) => ({ nome: x.nome || "", tessera_code: x.tessera_code || "" }));
    g.posti_liberi = g.posti_totali == null ? null : Math.max(0, g.posti_totali - isc.length);
  }
  out.sort((a, b) => String(a.data + a.slot_da).localeCompare(String(b.data + b.slot_da)) || a.campo_ordine - b.campo_ordine);
  res.json(out);
});
// Blocchi del campo (torneo, manutenzione, evento): rendono le fasce non prenotabili.
// E' il modo con cui si applica la regola "il basket si prenota solo se non c'e' il torneo":
// il motore Coppa non lega le partite a un campo, quindi l'impegno va dichiarato qui.
// Chi gioca, dichiarato al banco. Capita quasi sempre cosi': il socio prenota dal telefono e
// i nomi dei compagni li dice arrivando. Stesse regole della dichiarazione fatta dal titolare,
// ma qui l'ha scritta un operatore e resta segnato chi.
adminRouter.post("/campi/partite/:id/giocatori", requireCap("campi"), async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p || !["aperta", "completa"].includes(p.stato)) return res.status(409).json({ error: "Prenotazione non trovata o gia' chiusa" });
  const iscritti = await db.prepare("SELECT * FROM partita_iscritti WHERE partita_id=?").all(p.id);
  if (iscritti.length >= Number(p.posti_totali)) return res.status(409).json({ error: `Il campo tiene ${p.posti_totali} giocatori e ci sono gia' tutti.` });
  const tess = String(req.body?.giocatore_tessera || "").trim();
  let nome = String(req.body?.nome || "").trim();
  let socioId = null;
  if (tess) {
    const s2 = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(tess.toUpperCase());
    if (!s2) return res.status(404).json({ error: "Tessera non trovata" });
    if (iscritti.some((x) => String(x.tessera_code || "").toUpperCase() === tess.toUpperCase())) return res.status(409).json({ error: "Questo socio e' gia' fra i giocatori" });
    socioId = s2.id; nome = (s2.nome + " " + (s2.cognome || "")).trim();
  } else if (!nome) return res.status(400).json({ error: "Scrivi il nome, oppure la tessera" });
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)").run(p.id, socioId, tess || null, nome);
  audit(req.adminUser.username, "dichiara_giocatore", "campi", p.campo_id, `${p.data} ${p.slot} \u00b7 ${nome}${tess ? "" : " (ospite)"}`);
  res.status(201).json({ ok: true, giocatori: await db.prepare("SELECT id,nome,tessera_code FROM partita_iscritti WHERE partita_id=? ORDER BY id").all(p.id) });
});
// Disdetta dal banco: un socio che chiama, uno che se ne va, un campo prenotato per sbaglio.
// La crew deve poterlo fare senza cercare il titolare, e resta scritto chi l'ha fatto.
adminRouter.post("/campi/partite/:id/annulla", requireCap("campi"), async (req, res) => {
  const pa = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!pa || pa.stato === "annullata") return res.status(404).json({ error: "Prenotazione non trovata o gia' annullata" });
  await db.prepare("UPDATE partite_aperte SET stato='annullata' WHERE id=?").run(pa.id);
  await db.prepare("UPDATE prenotazioni_campo SET stato='annullato' WHERE partita_id=?").run(pa.id);
  audit(req.adminUser.username, "annulla_campo", "campi", pa.campo_id, `${pa.data} ${pa.slot} \u00b7 ${pa.creatore_nome || ""}`);
  await registra({
    fatto: "prenotazione_cancellata", servizio: "campi", riferimento: pa.id,
    intestatario: pa.creatore_nome || null, autore: req.adminUser.username, canale: "crew",
    quando: `${pa.data} \u00b7 ${pa.slot}`,
    dettaglio: { campo_id: pa.campo_id, motivo: req.body?.motivo || null }
  });
  res.json({ ok: true });
});
// ---- MODULO TENNIS -----------------------------------------------------------------------
// Tennis, beach tennis e beach volley sono un'attivita' a se': si affittano, ci si fa lezione
// privata, hanno un listino e un incasso propri. Chi li gestisce vede e tocca solo i suoi campi;
// il gestore dell'app ha comunque tutti i permessi e puo' intervenire quando serve — supervisore,
// non sostituto.
adminRouter.get("/tennis/campi", requireTennisOperativo, async (req, res) => {
  const campi = await db.prepare("SELECT * FROM campi WHERE gestione='tennis' AND attivo=1 ORDER BY nome").all();
  // Il listino e' del gestore del servizio: chi sta al banco per lui prenota e blocca, non
  // decide i prezzi e non ha motivo di leggerli.
  const conPrezzi = vedeIncassi(req);
  const out = [];
  for (const c of campi) {
    out.push(conPrezzi
      ? { ...c, listino: await listinoCampo(c.id) }
      : { ...c, prezzo_ora: undefined, listino: [] });
  }
  res.json(out);
});

// Il listino lo imposta chi gestisce i campi, non il gestore dell'app: e' il suo mestiere.
adminRouter.post("/tennis/campi/:id/tariffe", requireCap("tennis"), async (req, res) => {
  const campo = await db.prepare("SELECT * FROM campi WHERE id=?").get(req.params.id);
  if (!campo) return res.status(404).json({ error: "Campo non trovato" });
  const b = req.body || {};
  const etichetta = String(b.etichetta || "").trim();
  if (!etichetta) return res.status(400).json({ error: "Dai un nome alla tariffa: \u201cmattina\u201d, \u201csera\u201d, \u201clezione privata\u201d." });
  const prezzo = Number(b.prezzo_ora);
  if (!(prezzo >= 0)) return res.status(400).json({ error: "Il prezzo orario non e' valido" });
  const tipo = b.tipo_uso === "lezione" ? "lezione" : "campo";
  const info = await db.prepare(
    "INSERT INTO campi_tariffe (campo_id,etichetta,da_ora,a_ora,tipo_uso,prezzo_ora) VALUES (?,?,?,?,?,?)"
  ).run(campo.id, etichetta, b.da_ora || null, b.a_ora || null, tipo, prezzo);
  audit(req.adminUser.username, "tariffa_campo", "campi", campo.id, `${etichetta} ${prezzo} \u20ac/h`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

adminRouter.delete("/tennis/tariffe/:id", requireCap("tennis"), async (req, res) => {
  await db.prepare("DELETE FROM campi_tariffe WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Il prospetto della giornata: chi gioca, su cosa, quanto deve e chi ha gia' pagato.
// I SUOI CAMPI, LI CONFIGURA LUI. Orari, durata della fascia, posti, e la possibilita' di
// spegnerne uno: sono decisioni di chi affitta, non del gestore dell'app. Il perimetro e'
// stretto — puo' toccare SOLO i campi in gestione tennis — perche' un permesso che apre tutto
// non e' una delega, e' un altro gestore.
// DUE MESTIERI, DUE PERMESSI.
//   · "tennis"        = il gestore del servizio: listino, incassi, configurazione dei campi.
//   · "tennis_campi"  = chi sta al banco per lui: prenota, disdice, blocca un campo. E basta.
// Il gestore puo' mandare qualcuno a coprire un turno senza per questo mostrargli quanto
// incassa. E il gestore dell'app non vede i soldi in nessun caso: sono di un terzo.
function requireTennisOperativo(req, res, next) {
  if (req.adminUser?.ruolo === "gestore" || hasCap(req.adminUser, "tennis") || hasCap(req.adminUser, "tennis_campi")) return next();
  return res.status(403).json({ error: "Permesso insufficiente per il tuo ruolo" });
}
// Vede i soldi solo il gestore del servizio, mai il suo delegato e mai il gestore dell'app.
function vedeIncassi(req) {
  return req.adminUser?.ruolo !== "gestore" && hasCap(req.adminUser, "tennis");
}

async function campoDelTennis(id) {
  const c = await db.prepare("SELECT * FROM campi WHERE id=?").get(id);
  return c && String(c.gestione || "chiosco") === "tennis" ? c : null;
}
// I CAMPI DELL'AREA TENNIS SI CREANO QUI, e solo qui. Non nel back office del residence:
// quelli sono i campi gratuiti del chiosco, con regole diverse. Qui c'e' la stessa
// configurazione completa — orari, durata della fascia, posti, quante fasce di fila, minimo
// giocatori — perche' chi affitta deve poter fare tutto da solo senza chiedere niente a
// nessuno.
adminRouter.post("/tennis/campi", requireCap("tennis"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Il campo deve avere un nome" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM campi").get()).n;
  const info = await db.prepare(
    `INSERT INTO campi (nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default,attivo,ordine,
       max_slot_prenotazione,max_pren_settimana,min_giocatori,gestione,prezzo_ora)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'tennis',?)`
  ).run(
    b.nome, b.sport || "tennis", b.apertura || "08:00", b.chiusura || "22:00",
    Number(b.durata_slot) || 60, b.ora_min || null, Number(b.posti_default) || 4,
    b.attivo === false ? 0 : 1, ord,
    Math.max(1, Number(b.max_slot_prenotazione) || 2),
    // Il tetto settimanale non si applica ai campi a pagamento, ma la colonna vuole un valore.
    Math.max(1, Number(b.max_pren_settimana) || 99),
    Math.max(1, Number(b.min_giocatori) || 2),
    Number(b.prezzo_ora) || 0
  );
  audit(req.adminUser.username, "crea_campo_tennis", "campi", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

adminRouter.put("/tennis/campi/:id", requireCap("tennis"), async (req, res) => {
  const c = await campoDelTennis(req.params.id);
  if (!c) return res.status(404).json({ error: "Questo campo non e' fra i tuoi" });
  const b = req.body || {};
  await db.prepare(
    `UPDATE campi SET nome=?,sport=?,apertura=?,chiusura=?,durata_slot=?,ora_min=?,posti_default=?,
       attivo=?,max_slot_prenotazione=?,min_giocatori=?,prezzo_ora=? WHERE id=?`
  ).run(
    b.nome ?? c.nome, b.sport ?? c.sport, b.apertura ?? c.apertura, b.chiusura ?? c.chiusura,
    Number(b.durata_slot ?? c.durata_slot) || 60, b.ora_min === "" ? null : (b.ora_min ?? c.ora_min),
    Number(b.posti_default ?? c.posti_default) || 4,
    b.attivo === false ? 0 : 1,
    Math.max(1, Number(b.max_slot_prenotazione ?? c.max_slot_prenotazione) || 2),
    Math.max(1, Number(b.min_giocatori ?? c.min_giocatori) || 2),
    Number(b.prezzo_ora ?? c.prezzo_ora) || 0,
    c.id
  );
  audit(req.adminUser.username, "modifica_campo_tennis", "campi", c.id);
  res.json({ ok: true });
});

adminRouter.delete("/tennis/campi/:id", requireCap("tennis"), async (req, res) => {
  const c = await campoDelTennis(req.params.id);
  if (!c) return res.status(404).json({ error: "Questo campo non e' fra i tuoi" });
  // Stessa protezione del back office: un campo con prenotazioni in piedi non si cancella, si
  // spegne. Cancellarlo lascerebbe prenotazioni che puntano a un campo che non esiste.
  const usate = await db.prepare("SELECT COUNT(*) n FROM prenotazioni_campo WHERE campo_id=? AND stato='prenotato' AND data>=date('now','-1 day')").get(c.id);
  if (Number(usate?.n || 0) > 0) {
    return res.status(409).json({ error: `Ci sono ${usate.n} prenotazioni su questo campo: spegnilo invece di cancellarlo.` });
  }
  await db.prepare("DELETE FROM campi WHERE id=?").run(c.id);
  audit(req.adminUser.username, "elimina_campo_tennis", "campi", c.id, c.nome);
  res.json({ ok: true });
});

// Campo indisponibile: manutenzione, torneo, lezioni tutto il pomeriggio, o semplicemente
// "oggi non lo affitto". E' la ragione principale per cui la gestione doveva stare in mano sua.
adminRouter.get("/tennis/blocchi", requireTennisOperativo, async (req, res) => {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.data || "")) ? String(req.query.data) : new Date().toISOString().slice(0, 10);
  res.json(await db.prepare(
    `SELECT b.id, b.data, b.slot_da AS dalle, b.slot_a AS alle, b.motivo, b.nota, c.nome AS campo
     FROM campi_blocchi b JOIN campi c ON c.id=b.campo_id
     WHERE c.gestione='tennis' AND b.data=? ORDER BY b.slot_da`
  ).all(data).catch(() => []));
});
adminRouter.post("/tennis/blocchi", requireTennisOperativo, async (req, res) => {
  const c = await campoDelTennis(req.body?.campo_id);
  if (!c) return res.status(404).json({ error: "Questo campo non e' fra i tuoi" });
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data || ""))) return res.status(400).json({ error: "Data non valida" });
  await db.prepare("INSERT INTO campi_blocchi (campo_id,data,slot_da,slot_a,motivo,nota) VALUES (?,?,?,?,?,?)")
    .run(c.id, b.data, b.dalle || c.apertura, b.alle || c.chiusura, b.motivo || "manutenzione", b.nota || null);
  audit(req.adminUser.username, "blocca_campo", "campi", c.id, `${b.data} ${b.dalle || ""}-${b.alle || ""}`);
  res.status(201).json({ ok: true });
});
adminRouter.delete("/tennis/blocchi/:id", requireTennisOperativo, async (req, res) => {
  const b = await db.prepare("SELECT * FROM campi_blocchi WHERE id=?").get(req.params.id);
  if (!b || !(await campoDelTennis(b.campo_id))) return res.status(404).json({ error: "Blocco non trovato" });
  await db.prepare("DELETE FROM campi_blocchi WHERE id=?").run(b.id);
  res.json({ ok: true });
});

// Prenotare al banco per un socio che si presenta: come al chiosco, ma sui suoi campi.
adminRouter.post("/tennis/prenota", requireTennisOperativo, async (req, res) => {
  const c = await campoDelTennis(req.body?.campo_id);
  if (!c) return res.status(404).json({ error: "Questo campo non e' fra i tuoi" });
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(String(req.body?.tessera_code || "").toUpperCase());
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const slot = String(req.body?.slot || "");
  const occupato = await db.prepare("SELECT 1 x FROM prenotazioni_campo WHERE campo_id=? AND data=? AND slot=? AND stato='prenotato'").get(c.id, req.body?.data, slot);
  if (occupato) return res.status(409).json({ error: "Fascia gia' occupata" });
  const conto = await prezzoCampo(c, slot, 1, req.body?.tipo_uso === "lezione" ? "lezione" : "campo");
  // I nomi delle colonne sono quelli veri della tabella: non c'e' `creatore_socio_id`, c'e'
  // `titolare_socio_id`. Inventarli fa fallire l'inserimento con un 500 che non dice niente.
  const pa = await db.prepare(
    "INSERT INTO partite_aperte (campo_id,data,slot,slot_fine,n_slot,posti_totali,aperta_ai_soci,stato,creatore_tessera,creatore_nome,titolare_socio_id) VALUES (?,?,?,?,1,?,0,'completa',?,?,?)"
  ).run(c.id, req.body?.data, slot, slot, c.posti_default, socio.tessera_code, `${socio.nome} ${socio.cognome}`, socio.id);
  const pid = Number(pa.lastInsertRowid);
  await db.prepare(
    "INSERT INTO prenotazioni_campo (campo_id,data,slot,tipo,socio_id,tessera_code,nome,stato,partita_id,titolare_socio_id,prezzo,tipo_uso) VALUES (?,?,?,'privata',?,?,?,'prenotato',?,?,?,?)"
  ).run(c.id, req.body?.data, slot, socio.id, socio.tessera_code, `${socio.nome} ${socio.cognome}`, pid, socio.id, conto.prezzo, req.body?.tipo_uso === "lezione" ? "lezione" : "campo");
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)")
    .run(pid, socio.id, socio.tessera_code, `${socio.nome} ${socio.cognome}`);
  audit(req.adminUser.username, "prenota_campo_banco", "campi", c.id, `${req.body?.data} ${slot} \u00b7 ${conto.prezzo} \u20ac`);
  res.status(201).json({ ok: true, prezzo: conto.prezzo });
});

// Il libro degli incassi dei campi a pagamento. Lo apre solo chi li gestisce: il gestore
// dell'app riceve un rifiuto, ed e' voluto.
// ---- TORNEI A ELIMINAZIONE DIRETTA ---------------------------------------------------------
// Li organizza sia il chiosco (pickleball, calcetto, basket, giochi) sia chi gestisce i campi a
// pagamento. Chi ha il permesso vede e tocca solo i tornei della sua gestione: il perimetro e'
// lo stesso dei campi.
function capTorneo(req) {
  return req.query.gestione === "tennis" || req.body?.gestione === "tennis" ? "tennis" : "campi";
}
function requireCapTorneo(req, res, next) {
  return requireCap(capTorneo(req))(req, res, next);
}

// ---- COMPOSIZIONE DELLE CASATE -------------------------------------------------------------
// Il primo anno nessuno conosce nessuno: aspettare che i soci si associno da soli significa
// arrivare a luglio con tre casate piene e cinque vuote. Il sistema propone, poi la gente
// cambia — fino alla chiusura delle formazioni.
// ---- SPIAGGIA (modulo Beach) ---------------------------------------------------------------
// Sulle piazzole non c'e' nessuno: questo modulo serve a chi guarda la situazione da lontano,
// sistema un disallineamento e chiude una piazzola quando tira vento.
adminRouter.get("/spiaggia", requireCap("beach"), async (req, res) => {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.data || "")) ? String(req.query.data) : new Date().toISOString().slice(0, 10);
  await chiudiScadute(data);
  const fasce = await fasceSpiaggia();
  const attuale = fasce.find((f) => f.in_corso) || fasce[0];
  const fascia = ["mattina", "pomeriggio"].includes(String(req.query.fascia)) ? String(req.query.fascia) : attuale.fascia;
  const piazzole = await db.prepare("SELECT * FROM piazzole ORDER BY ordine,id").all();
  const out = [];
  for (const p of piazzole) {
    const sit = await situazionePiazzola(p.id, data, fascia);
    out.push({
      ...p, ...sit,
      // Occupati = con qualcuno sotto. Una piazzola chiusa per vento non ha nessun ombrellone
      // "libero", ma non e' occupata: contarli come tali diceva "4/4 occupati" su una spiaggia
      // deserta, e impediva persino di svuotarla.
      occupati: sit.ombrelloni.filter((o) => o.presa_id).length,
      totale: sit.ombrelloni.length
    });
  }
  res.json({ data, fascia, fasce, piazzole: out });
});

// Piazzole e ombrelloni si configurano qui: quanti ombrelloni e dove NON si calcolano da soli
// dalla dimensione della piazzola. Le piazzole vere hanno alberi, docce e passaggi: una formula
// direbbe che ce ne stanno quattordici dove ce ne stanno nove.
adminRouter.get("/spiaggia/piazzole/:id/verifica", requireCap("beach"), async (req, res) => {
  const v = await verificaPiazzola(req.params.id);
  if (!v) return res.status(404).json({ error: "Piazzola non trovata" });
  res.json(v);
});

adminRouter.put("/spiaggia/piazzole/:id", requireCap("beach"), async (req, res) => {
  const p = await db.prepare("SELECT * FROM piazzole WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Piazzola non trovata" });
  const b = req.body || {};
  await db.prepare("UPDATE piazzole SET nome=?,larghezza_m=?,profondita_m=?,file=?,colonne=?,attiva=? WHERE id=?")
    .run(b.nome ?? p.nome, b.larghezza_m ?? p.larghezza_m, b.profondita_m ?? p.profondita_m,
      b.file ?? p.file, b.colonne ?? p.colonne, b.attiva === false ? 0 : 1, p.id);
  res.json({ ok: true });
});

adminRouter.post("/spiaggia/piazzole/:id/ombrelloni", requireCap("beach"), async (req, res) => {
  const p = await db.prepare("SELECT * FROM piazzole WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Piazzola non trovata" });
  // PRIMA LE MISURE. Creare ombrelloni in una piazzola di cui non si sa niente significa
  // disegnare una spiaggia che non esiste: si aggiungono, sembrano a posto, e nessuno sa se
  // sulla sabbia ci starebbero davvero.
  if (!Number(p.larghezza_m) || !Number(p.profondita_m)) {
    return res.status(409).json({ error: `Prima le misure di ${p.nome}: senza, non si sa se gli ombrelloni ci stanno.`, misure_mancanti: true });
  }
  const quanti = Math.max(1, Math.min(60, Number(req.body?.quanti) || 1));
  const posti = Number(req.body?.posti) || Number(await par("beach_posti_ombrellone")) || 2;
  const gia = Number((await db.prepare("SELECT COUNT(*) n FROM ombrelloni WHERE piazzola_id=?").get(p.id)).n);

  // E non piu' di quanti ce ne stanno: il conto e' indicativo, ma superarlo di venti non lo e'.
  const v = await verificaPiazzola(p.id);
  if (v && v.capienza_indicativa && gia + quanti > v.capienza_indicativa) {
    return res.status(409).json({
      error: `In ${p.nome} (${v.misure.larghezza_m}\u00d7${v.misure.profondita_m} m) ce ne stanno ${v.capienza_indicativa} lasciando ${v.regole.passaggio_m} m di passaggio: ne hai gia' ${gia} e ne stai aggiungendo ${quanti}.`,
      capienza: v.capienza_indicativa, gia
    });
  }

  // File e colonne come le altre piante: se non sono dichiarate, si ricavano dalle misure —
  // non da una radice quadrata che non somiglia alla spiaggia.
  const passo = (Number(await par("beach_ingombro_ombrellone_m")) || 3) + (Number(await par("beach_passaggio_m")) || 1.5);
  const cols = Math.max(1, Number(p.colonne) || Math.floor((Number(p.larghezza_m) + 0.01) / passo) || 1);
  const righe = Math.max(1, Number(p.file) || Math.ceil((gia + quanti) / cols));
  const max = (await db.prepare("SELECT COALESCE(MAX(numero),0) n FROM ombrelloni WHERE piazzola_id=?").get(p.id)).n;
  const ins = db.prepare("INSERT INTO ombrelloni (piazzola_id,numero,posti,x,y) VALUES (?,?,?,?,?)");
  for (let i = 0; i < quanti; i++) {
    const idx = gia + i;
    const c = idx % cols, r = Math.floor(idx / cols);
    await ins.run(p.id, Number(max) + i + 1, posti,
      Number((((c + 1) / (cols + 1)) * 100).toFixed(1)),
      Number((((r + 1) / (righe + 1)) * 100).toFixed(1)));
  }
  audit(req.adminUser.username, "aggiunge_ombrelloni", "piazzole", p.id, `${quanti} su ${p.nome}`);
  res.status(201).json({ ok: true, aggiunti: quanti, file: righe, colonne: cols });
});

// Svuotare una piazzola: capita di sbagliare il numero e non si puo' restare cosi'.
adminRouter.delete("/spiaggia/piazzole/:id/ombrelloni", requireCap("beach"), async (req, res) => {
  const p = await db.prepare("SELECT * FROM piazzole WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Piazzola non trovata" });
  const occupati = Number((await db.prepare(
    "SELECT COUNT(*) n FROM ombrellone_prese pr JOIN ombrelloni o ON o.id=pr.ombrellone_id WHERE o.piazzola_id=? AND pr.stato='attiva'"
  ).get(p.id)).n);
  if (occupati > 0) return res.status(409).json({ error: `Ci sono ${occupati} ombrelloni occupati: si svuota quando la fascia finisce.` });
  const r = await db.prepare("DELETE FROM ombrelloni WHERE piazzola_id=?").run(p.id);
  audit(req.adminUser.username, "svuota_piazzola", "piazzole", p.id, p.nome);
  res.json({ ok: true, tolti: Number(r?.changes || 0) });
});

// Assegnare al banco: chi non ha l'app deve poter avere un ombrellone, altrimenti la spiaggia
// diventa dei giovani e gli anziani restano fuori.
adminRouter.post("/spiaggia/assegna", requireCap("beach"), async (req, res) => {
  const socio = await db.prepare("SELECT id,nome,cognome,tessera_code,nucleo FROM soci WHERE upper(tessera_code)=? AND attivo=1")
    .get(String(req.body?.tessera_code || "").toUpperCase());
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const r = await prendiOmbrellone({
    socio, ombrelloneId: req.body?.ombrellone_id,
    data: new Date().toISOString().slice(0, 10), fascia: req.body?.fascia
  });
  if (!r.ok) return res.status(409).json(r);
  audit(req.adminUser.username, "assegna_ombrellone", "spiaggia", req.body?.ombrellone_id, `${socio.nome} ${socio.cognome}`);
  res.status(201).json(r);
});

adminRouter.delete("/spiaggia/ombrelloni/:id", requireCap("beach"), async (req, res) => {
  const o = await db.prepare("SELECT * FROM ombrelloni WHERE id=?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "Ombrellone non trovato" });
  const usato = await db.prepare("SELECT COUNT(*) n FROM ombrellone_prese WHERE ombrellone_id=? AND stato='attiva'").get(o.id);
  if (Number(usato.n) > 0) return res.status(409).json({ error: "C'e' qualcuno sotto: si toglie quando la fascia finisce." });
  await db.prepare("DELETE FROM ombrelloni WHERE id=?").run(o.id);
  res.json({ ok: true });
});

// Chiudere una piazzola: vento, marea, manutenzione.
adminRouter.post("/spiaggia/blocchi", requireCap("beach"), async (req, res) => {
  const b = req.body || {};
  const p = await db.prepare("SELECT * FROM piazzole WHERE id=?").get(b.piazzola_id);
  if (!p) return res.status(404).json({ error: "Piazzola non trovata" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data || ""))) return res.status(400).json({ error: "Data non valida" });
  await db.prepare("INSERT INTO piazzole_blocchi (piazzola_id,data,fascia,motivo,nota) VALUES (?,?,?,?,?)")
    .run(p.id, b.data, ["mattina", "pomeriggio"].includes(b.fascia) ? b.fascia : null, b.motivo || "vento", b.nota || null);
  audit(req.adminUser.username, "chiude_piazzola", "piazzole", p.id, `${b.data} \u00b7 ${b.motivo || "vento"}`);
  res.status(201).json({ ok: true });
});

adminRouter.delete("/spiaggia/blocchi/:id", requireCap("beach"), async (req, res) => {
  await db.prepare("DELETE FROM piazzole_blocchi WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Il disallineamento: qualcuno ha steso l'asciugamano senza dichiarare niente. Sulle piazzole
// non c'e' la crew, quindi lo segnala chi lo trova — e il gestore, non l'app, decide.
adminRouter.put("/spiaggia/prese/:id/chiudi", requireCap("beach"), async (req, res) => {
  const p = await db.prepare("SELECT * FROM ombrellone_prese WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "attiva") return res.status(404).json({ error: "Presa non trovata" });
  await db.prepare("UPDATE ombrellone_prese SET stato='rilasciata', rilasciata_at=datetime('now') WHERE id=?").run(p.id);
  audit(req.adminUser.username, "libera_ombrellone", "spiaggia", p.ombrellone_id, p.nome || "");
  await registra({
    fatto: "ombrellone_liberato_dal_banco", servizio: "spiaggia", riferimento: p.id,
    socio_id: p.socio_id, intestatario: p.nome || null,
    autore: req.adminUser.username, canale: "crew",
    dettaglio: { motivo: req.body?.motivo || null }
  });
  res.json({ ok: true });
});

adminRouter.get("/casate/composizione", requireCap("casate"), async (req, res) => {
  res.json(await componiCasate({ soloAnteprima: true }));
});

// L'anteprima si guarda, poi si applica. Non si applica al primo colpo: una composizione
// sbagliata su novantasei persone non si disfa a mano.
adminRouter.post("/casate/composizione", requireCap("casate"), async (req, res) => {
  if (!req.body?.conferma) {
    return res.status(400).json({ error: "Guarda prima l'anteprima: questa operazione riscrive la casata di tutti gli iscritti." });
  }
  const esito = await componiCasate({ soloAnteprima: false });
  audit(req.adminUser.username, "componi_casate", "casate", null, `${esito.iscritti} iscritti \u00b7 ${esito.casate_schierabili} casate`);
  await registra({
    fatto: "casate_composte", servizio: "casate", riferimento: null,
    autore: req.adminUser.username, canale: "backoffice",
    dettaglio: { iscritti: esito.iscritti, casate: esito.casate_schierabili, problemi: esito.problemi.length }
  });
  res.json(esito);
});

// Lo stato dei vincoli, in ogni momento: serve durante le settimane in cui si entra e si esce.
// Chi fa il capitano: il sistema propone e dice PERCHE'. Non nomina — la casata puo' cambiare
// finche' le formazioni sono aperte.
adminRouter.get("/casate/capitani", requireCap("casate"), async (req, res) => {
  res.json(await proponiCapitani());
});

adminRouter.put("/casate/:id/capitano", requireCap("casate"), async (req, res) => {
  const c = await db.prepare("SELECT * FROM casate WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Casata non trovata" });
  const cap = req.body?.capitano_socio_id ? await db.prepare("SELECT * FROM soci WHERE id=? AND casata_id=?").get(req.body.capitano_socio_id, c.id) : null;
  const vice = req.body?.vice_socio_id ? await db.prepare("SELECT * FROM soci WHERE id=? AND casata_id=?").get(req.body.vice_socio_id, c.id) : null;
  if (req.body?.capitano_socio_id && !cap) return res.status(400).json({ error: "Il capitano dev'essere uno della casata" });
  if (req.body?.vice_socio_id && !vice) return res.status(400).json({ error: "Il vice dev'essere uno della casata" });
  if (cap && vice && cap.id === vice.id) return res.status(400).json({ error: "Capitano e vice non possono essere la stessa persona: il vice serve proprio per quando il capitano non c'e'." });
  await db.prepare("UPDATE casate SET capitano_socio_id=?, vice_socio_id=? WHERE id=?")
    .run(cap ? cap.id : null, vice ? vice.id : null, c.id);
  audit(req.adminUser.username, "capitano_casata", "casate", c.id, cap ? `${cap.nome} ${cap.cognome}` : "nessuno");
  res.json({ ok: true });
});

adminRouter.get("/casate/stato", requireCap("casate"), async (req, res) => {
  res.json(await statoCasate());
});

adminRouter.get("/tornei", requireCapTorneo, async (req, res) => {
  const g = req.query.gestione === "tennis" ? "tennis" : "chiosco";
  res.json(await db.prepare("SELECT * FROM tornei_ko WHERE gestione=? ORDER BY created_at DESC").all(g));
});

adminRouter.post("/tornei", requireCapTorneo, async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Dai un nome al torneo" });
  const posti = Number(b.posti);
  if (!POSTI_AMMESSI.includes(posti)) {
    return res.status(400).json({
      error: `Il tabellone dev'essere da ${POSTI_AMMESSI.join(", ")}. Con un numero diverso qualcuno passerebbe il turno senza giocare, e il torneo comincerebbe con un'ingiustizia.`
    });
  }
  const info = await db.prepare(
    "INSERT INTO tornei_ko (nome,disciplina,gestione,posti,quota,data) VALUES (?,?,?,?,?,?)"
  ).run(b.nome, b.disciplina || null, b.gestione === "tennis" ? "tennis" : "chiosco", posti, Number(b.quota) || 0, b.data || null);
  audit(req.adminUser.username, "crea_torneo", "tornei", info.lastInsertRowid, `${b.nome} \u00b7 ${posti} posti`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

adminRouter.get("/tornei/:id", requireCap("campi"), async (req, res) => {
  const t = await tabelloneKO(req.params.id);
  if (!t) return res.status(404).json({ error: "Torneo non trovato" });
  res.json(t);
});

adminRouter.post("/tornei/:id/iscritti", requireCap("campi"), async (req, res) => {
  const t = await db.prepare("SELECT * FROM tornei_ko WHERE id=?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Torneo non trovato" });
  if (t.stato !== "iscrizioni") return res.status(409).json({ error: "Le iscrizioni sono chiuse: il tabellone e' gia' stato sorteggiato." });
  const quanti = (await db.prepare("SELECT COUNT(*) n FROM tornei_ko_iscritti WHERE torneo_id=?").get(t.id)).n;
  if (Number(quanti) >= Number(t.posti)) return res.status(409).json({ error: `Il tabellone da ${t.posti} e' pieno.` });

  const tess = String(req.body?.tessera_code || "").trim();
  let nome = String(req.body?.nome || "").trim();
  let socioId = null;
  if (tess) {
    const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(tess.toUpperCase());
    if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
    const gia = await db.prepare("SELECT 1 x FROM tornei_ko_iscritti WHERE torneo_id=? AND upper(tessera_code)=?").get(t.id, tess.toUpperCase());
    if (gia) return res.status(409).json({ error: "Questo socio e' gia' iscritto" });
    socioId = socio.id;
    nome = `${socio.nome} ${socio.cognome}`.trim();
  } else if (!nome) {
    return res.status(400).json({ error: "Serve un nome, oppure la tessera" });
  }
  await db.prepare("INSERT INTO tornei_ko_iscritti (torneo_id,socio_id,tessera_code,nome,pagato) VALUES (?,?,?,?,?)")
    .run(t.id, socioId, tess || null, nome, req.body?.pagato ? 1 : 0);
  const ora = (await db.prepare("SELECT COUNT(*) n FROM tornei_ko_iscritti WHERE torneo_id=?").get(t.id)).n;
  res.status(201).json({ ok: true, iscritti: Number(ora), posti: Number(t.posti), pieno: Number(ora) === Number(t.posti) });
});

adminRouter.delete("/tornei/:id/iscritti/:iscrittoId", requireCap("campi"), async (req, res) => {
  const t = await db.prepare("SELECT * FROM tornei_ko WHERE id=?").get(req.params.id);
  if (!t || t.stato !== "iscrizioni") return res.status(409).json({ error: "Il tabellone e' gia' sorteggiato: non si tolgono piu' iscritti." });
  await db.prepare("DELETE FROM tornei_ko_iscritti WHERE id=? AND torneo_id=?").run(req.params.iscrittoId, t.id);
  res.json({ ok: true });
});

// Il sorteggio: cieco, una volta sola, e solo a tabellone pieno.
adminRouter.post("/tornei/:id/sorteggia", requireCap("campi"), async (req, res) => {
  const r = await sorteggiaKO(req.params.id);
  if (!r.ok) return res.status(409).json({ error: r.error });
  audit(req.adminUser.username, "sorteggia_torneo", "tornei", req.params.id);
  res.json({ ok: true, tabellone: await tabelloneKO(req.params.id) });
});

adminRouter.put("/tornei/partite/:id", requireCap("campi"), async (req, res) => {
  const r = await risultatoKO(req.params.id, String(req.body?.vincitore || "").trim(), req.body?.punteggio);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const p = await db.prepare("SELECT torneo_id FROM tornei_ko_partite WHERE id=?").get(req.params.id);
  audit(req.adminUser.username, "risultato_torneo", "tornei", p?.torneo_id, req.body?.vincitore);
  res.json({ ok: true, finale: !!r.finale, vincitore: r.vincitore || null, tabellone: await tabelloneKO(p.torneo_id) });
});

// Il libro degli incassi: lo apre SOLO il gestore del servizio. Il delegato al banco e il
// gestore dell'app ricevono lo stesso rifiuto, e con la stessa spiegazione — un "permesso
// insufficiente" secco farebbe pensare a un errore di configurazione, mentre qui e' voluto.
adminRouter.get("/tennis/incassi", requireTennisOperativo, async (req, res) => {
  if (!vedeIncassi(req)) {
    return res.status(403).json({ error: "Gli incassi sono del gestore del servizio: ne' il residence ne' chi sta al banco per lui li vedono." });
  }
  const dal = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dal || "")) ? String(req.query.dal) : "2000-01-01";
  const al = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.al || "")) ? String(req.query.al) : "2999-12-31";
  const righe = await db.prepare(
    `SELECT i.*, c.nome AS campo FROM tennis_incassi i JOIN campi c ON c.id=i.campo_id
     WHERE i.data BETWEEN ? AND ? ORDER BY i.data DESC, i.slot`
  ).all(dal, al);
  res.json({
    dal, al, righe,
    totale: Number(righe.reduce((s2, r) => s2 + Number(r.importo), 0).toFixed(2))
  });
});

adminRouter.get("/tennis/giornata", requireTennisOperativo, async (req, res) => {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.data || "")) ? String(req.query.data) : new Date().toISOString().slice(0, 10);
  const righe = await db.prepare(
    `SELECT p.id, p.slot, p.nome, p.tessera_code, p.prezzo, p.pagato, p.tipo_uso, p.partita_id,
            c.nome AS campo, c.durata_slot
     FROM prenotazioni_campo p JOIN campi c ON c.id=p.campo_id
     WHERE c.gestione='tennis' AND p.data=? AND p.stato='prenotato' ORDER BY p.slot, c.nome`
  ).all(data);
  // IL FATTURATO DEL TERZO NON E' AFFARE NOSTRO. Chi gestisce i campi a pagamento e' un
  // soggetto terzo rispetto al residence: usa l'app perche' e' comodo per tutti, ma quanto
  // incassa non deve arrivare a chi l'app la possiede. Il gestore resta supervisore — vede chi
  // ha prenotato, puo' intervenire su un errore — e i soldi no.
  //
  // Non e' una gentilezza: e' la differenza fra ospitare un'attivita' e sorvegliarla.
  const suoi = vedeIncassi(req);
  const daIncassare = righe.filter((r) => Number(r.prezzo) > 0 && Number(r.pagato) !== 1);
  res.json({
    data,
    righe: suoi ? righe : righe.map((r) => {
      const { prezzo, pagato, ...senzaSoldi } = r;
      return senzaSoldi;
    }),
    ...(suoi ? {
      incassato: Number(righe.filter((r) => Number(r.pagato) === 1).reduce((s2, r) => s2 + Number(r.prezzo), 0).toFixed(2)),
      da_incassare: Number(daIncassare.reduce((s2, r) => s2 + Number(r.prezzo), 0).toFixed(2)),
      quanti_da_incassare: daIncassare.length
    } : {
      incassi_nascosti: true,
      // Due destinatari diversi, due motivi diversi: al residence si dice che non sono affari
      // suoi, a chi sta al banco che non e' il suo compito. Una frase sola sarebbe sbagliata
      // per uno dei due.
      nota: req.adminUser.ruolo === "gestore"
        ? "Gli incassi dei campi a pagamento sono di chi li gestisce: il residence non li vede."
        : "Gli incassi e il listino li tiene il gestore del servizio: qui prenoti, disdici e blocchi i campi."
    })
  });
});

adminRouter.put("/tennis/prenotazioni/:id/pagato", requireTennisOperativo, async (req, res) => {
  const p = await db.prepare("SELECT * FROM prenotazioni_campo WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Prenotazione non trovata" });
  const pagato = req.body?.pagato === false ? 0 : 1;
  await db.prepare("UPDATE prenotazioni_campo SET pagato=? WHERE id=?").run(pagato, p.id);
  audit(req.adminUser.username, pagato ? "incassa_campo" : "storna_incasso_campo", "campi", p.campo_id, `${p.data} ${p.slot} \u00b7 ${p.prezzo} \u20ac`);
  // L'incasso NON va nel registro storico del residence: quello lo legge il gestore, e li'
  // dentro finirebbe il fatturato di un terzo. Resta in un libro suo, che solo lui apre.
  if (pagato) {
    await db.prepare(
      "INSERT INTO tennis_incassi (prenotazione_id,campo_id,data,slot,importo,metodo,operatore) VALUES (?,?,?,?,?,?,?)"
    ).run(p.id, p.campo_id, p.data, p.slot, Number(p.prezzo), req.body?.metodo || null, req.adminUser.username);
  }
  res.json({ ok: true });
});

adminRouter.get("/campi/blocchi", requireCap("campi"), async (req, res) => {
  const data = req.query.data ? String(req.query.data).slice(0, 10) : null;
  const sel = "SELECT b.*, c.nome AS campo_nome FROM campi_blocchi b JOIN campi c ON c.id=b.campo_id";
  res.json(data
    ? await db.prepare(sel + " WHERE b.data=? ORDER BY b.data,b.slot_da").all(data)
    : await db.prepare(sel + " WHERE b.data>=date('now','-1 day') ORDER BY b.data,b.slot_da LIMIT 200").all());
});
adminRouter.post("/campi/blocchi", requireCap("campi"), async (req, res) => {
  const b = req.body || {};
  if (!b.campo_id) return res.status(400).json({ error: "Campo obbligatorio" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data || ""))) return res.status(400).json({ error: "Data non valida" });
  const info = await db.prepare("INSERT INTO campi_blocchi (campo_id,data,slot_da,slot_a,motivo,nota) VALUES (?,?,?,?,?,?)")
    .run(Number(b.campo_id), b.data, b.slot_da || "00:00", b.slot_a || "23:59", b.motivo || "torneo", b.nota || null);
  audit(req.adminUser.username, "blocca_campo", "campi", Number(b.campo_id), `${b.data} ${b.slot_da || "00:00"}-${b.slot_a || "23:59"}`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
adminRouter.delete("/campi/blocchi/:id", requireCap("campi"), async (req, res) => {
  await db.prepare("DELETE FROM campi_blocchi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "sblocca_campo", "campi", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/discipline", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM discipline ORDER BY dominio, ordine").all());
});
// Cartellone della Coppa: tutto calcolato, nessun valore inserito a mano.
adminRouter.get("/coppa/cartellone", requireCap("casate"), async (req, res) => {
  const { graduatoria, discipline, celle } = await punteggiCoppa();
  res.json({
    graduatoria,
    discipline,
    celle,
    // retro-compatibilita' con i client precedenti
    casate: graduatoria,
    totali: Object.fromEntries(graduatoria.map((c) => [c.id, c.punti]))
  });
});
// Ricalcola dalle sorgenti (tornei in corso, edizioni archiviate, contest assegnati)
// e riscrive casate.punti, cioe' quello che vedono i soci.
adminRouter.post("/coppa/ricalcola", requireCap("casate"), async (req, res) => {
  const r = await ricalcolaCoppa(req.adminUser.username);
  res.json({ ok: true, graduatoria: r.graduatoria, discipline: r.discipline, celle: r.celle, cambiate: r.cambiate });
});
adminRouter.post("/discipline", requireCap("discipline"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !b.chiave || !b.dominio) return res.status(400).json({ error: "Dominio, chiave e nome obbligatori" });
  try {
    const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM discipline WHERE dominio=?").get(b.dominio)).n || 0;
    const info = await db.prepare("INSERT INTO discipline (dominio,chiave,nome,attivo,min_giocatori,max_giocatori,punti_vitt,punti_par,ordine) VALUES (?,?,?,?,?,?,?,?,?)").run(b.dominio === "giochi" ? "giochi" : "sport", b.chiave, b.nome, b.attivo ? 1 : 0, Number(b.min_giocatori) || 1, Number(b.max_giocatori) || 1, Number(b.punti_vitt) || 3, Number(b.punti_par) || 1, ord);
    audit(req.adminUser.username, "crea", "discipline", info.lastInsertRowid, b.nome);
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Chiave gi\xE0 esistente per questo dominio" });
  }
});
adminRouter.put("/discipline/:id", requireCap("discipline"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE discipline SET nome=?,attivo=?,min_giocatori=?,max_giocatori=?,punti_vitt=?,punti_par=? WHERE id=?").run(b.nome, b.attivo ? 1 : 0, Number(b.min_giocatori) || 1, Number(b.max_giocatori) || 1, Number(b.punti_vitt) || 3, Number(b.punti_par) || 1, req.params.id);
  audit(req.adminUser.username, "modifica", "discipline", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/discipline/:id", requireCap("discipline_del"), async (req, res) => {
  const id = req.params.id;
  if (await bloccaSeCollegato(res, "discipline", id, "la disciplina")) return;
  await db.prepare("DELETE FROM partite WHERE disciplina_id=?").run(id);
  const gironi = await db.prepare("SELECT id FROM gironi WHERE disciplina_id=?").all(id);
  for (const g of gironi) await db.prepare("DELETE FROM classifica WHERE girone_id=?").run(g.id);
  await db.prepare("DELETE FROM gironi WHERE disciplina_id=?").run(id);
  await db.prepare("DELETE FROM convocazioni WHERE disciplina_id=?").run(id);
  await db.prepare("DELETE FROM discipline WHERE id=?").run(id);
  audit(req.adminUser.username, "cancella", "discipline", id);
  res.json({ ok: true });
});
adminRouter.get("/tabellone/:disciplinaId", requireCap("tabellone"), async (req, res) => {
  res.json(await getTabellone(Number(req.params.disciplinaId)));
});
adminRouter.post("/tabellone/:disciplinaId/genera", requireCap("tabellone_reset"), async (req, res) => {
  try {
    const t = await generaCalendario(Number(req.params.disciplinaId));
    audit(req.adminUser.username, "genera_calendario", "discipline", req.params.disciplinaId);
    res.json({ ok: true, tabellone: t });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
adminRouter.put("/partite/:id", requireCap("tabellone"), async (req, res) => {
  const a = Number(req.body?.gol_a), b = Number(req.body?.gol_b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return res.status(400).json({ error: "Punteggi non validi" });
  try {
    await registraRisultato(Number(req.params.id), a, b);
    audit(req.adminUser.username, "risultato", "partite", req.params.id, `${a}-${b}`);
    // La graduatoria della Coppa e' derivata: si riallinea da sola a ogni risultato.
    await ricalcolaCoppa(req.adminUser.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
adminRouter.put("/tabellone/:id/impostazioni", requireCap("tabellone"), async (req, res) => {
  const b = req.body || {};
  const stato = ["preparazione", "in_corso", "archiviato"].includes(b.stato) ? b.stato : "preparazione";
  await db.prepare("UPDATE discipline SET data_inizio=?,data_fine=?,stato=?,regolamento=? WHERE id=?").run(b.data_inizio || null, b.data_fine || null, stato, b.regolamento ?? null, req.params.id);
  audit(req.adminUser.username, "impostazioni_tabellone", "discipline", req.params.id);
  res.json({ ok: true });
});
adminRouter.post("/tabellone/:id/archivia", requireCap("tabellone"), async (req, res) => {
  try {
    const r = await archiviaEdizione(Number(req.params.id));
    audit(req.adminUser.username, "archivia_edizione", "discipline", req.params.id, `vince ${r.vincitore || "\u2014"}`);
    await ricalcolaCoppa(req.adminUser.username);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
adminRouter.get("/tabellone/:id/edizioni", requireCap("tabellone"), async (req, res) => {
  const rows = await db.prepare("SELECT id,disciplina_nome,dominio,data_inizio,data_fine,vincitore,archiviata_at FROM edizioni WHERE disciplina_id=? ORDER BY id DESC").all(req.params.id);
  res.json(rows);
});
adminRouter.get("/regolamenti", requireCap("tabellone"), async (req, res) => {
  res.json(await db.prepare("SELECT id,chiave,titolo,testo,ordine FROM regolamenti ORDER BY ordine,id").all());
});
adminRouter.put("/regolamenti/:chiave", requireCap("tabellone"), async (req, res) => {
  const b = req.body || {};
  const ex = await db.prepare("SELECT id FROM regolamenti WHERE chiave=?").get(req.params.chiave);
  if (ex) await db.prepare("UPDATE regolamenti SET titolo=?,testo=? WHERE chiave=?").run(b.titolo || req.params.chiave, b.testo ?? "", req.params.chiave);
  else await db.prepare("INSERT INTO regolamenti (chiave,titolo,testo) VALUES (?,?,?)").run(req.params.chiave, b.titolo || req.params.chiave, b.testo ?? "");
  audit(req.adminUser.username, "modifica", "regolamenti", req.params.chiave);
  res.json({ ok: true });
});
adminRouter.get("/contest", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM contest ORDER BY id DESC").all());
});
adminRouter.post("/contest", requireCap("contest"), async (req, res) => {
  const b = req.body || {};
  if (!b.titolo) return res.status(400).json({ error: "Titolo obbligatorio" });
  const info = await db.prepare("INSERT INTO contest (titolo,tipo,settimana,brief,stato,attivo) VALUES (?,?,?,?,?,?)").run(b.titolo, b.tipo ?? "altro", b.settimana ?? "", b.brief ?? "", b.stato ?? "annunciato", b.attivo === false ? 0 : 1);
  audit(req.adminUser.username, "crea", "contest", info.lastInsertRowid, b.titolo);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/contest/:id", requireCap("contest"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE contest SET titolo=?,tipo=?,settimana=?,brief=?,stato=?,vincitore=?,attivo=? WHERE id=?").run(b.titolo, b.tipo ?? "altro", b.settimana ?? "", b.brief ?? "", b.stato ?? "annunciato", b.vincitore ?? null, b.attivo ? 1 : 0, req.params.id);
  audit(req.adminUser.username, "modifica", "contest", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/contest/:id", requireCap("contest"), async (req, res) => {
  if (await bloccaSeCollegato(res, "contest", req.params.id, "il contest")) return;
  await db.prepare("DELETE FROM contest WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "contest", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/contest/:id/esito", requireCap("contest"), async (req, res) => {
  const e = await esitoCorrente(Number(req.params.id));
  if (!e) return res.status(404).json({ error: "Contest non trovato" });
  res.json(e);
});
adminRouter.post("/contest/:id/esito", requireCap("contest"), async (req, res) => {
  try {
    const righe = Array.isArray(req.body?.righe) ? req.body.righe : [];
    const scala = Array.isArray(req.body?.punti_scala) ? req.body.punti_scala.map((n) => Number(n) || 0) : void 0;
    const out = await salvaEsito(Number(req.params.id), righe, scala);
    res.json({ ok: true, righe: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
adminRouter.post("/contest/:id/assegna", requireCap("contest"), async (req, res) => {
  try {
    const r = await assegnaCoppa(Number(req.params.id));
    await ricalcolaCoppa(req.adminUser.username);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
adminRouter.get("/serate", async (req, res) => {
  const rows = await db.prepare("SELECT * FROM serate ORDER BY ordine,data").all();
  const out = [];
  for (const s of rows) {
    const p = await db.prepare("SELECT COALESCE(SUM(CASE WHEN stato!='annullata' THEN persone ELSE 0 END),0) coperti, COALESCE(SUM(CASE WHEN stato='da_saldare' THEN importo ELSE 0 END),0) da_incassare FROM serate_prenotazioni WHERE serata_id=?").get(s.id);
    out.push({ ...s, coperti_prenotati: p.coperti, da_incassare: p.da_incassare });
  }
  res.json(out);
});
adminRouter.post("/serate", requireCap("serate"), async (req, res) => {
  const b = req.body || {};
  if (!b.titolo) return res.status(400).json({ error: "Titolo obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM serate").get()).n;
  const info = await db.prepare("INSERT INTO serate (chiave,titolo,data,quando,tema,descrizione,quota,capienza,attivo,ordine) VALUES (?,?,?,?,?,?,?,?,?,?)").run(b.chiave || null, b.titolo, b.data ?? "", b.quando ?? "", b.tema ?? "", b.descrizione ?? "", Number(b.quota) || 0, Number(b.capienza) || 80, b.attivo === false ? 0 : 1, ord);
  audit(req.adminUser.username, "crea", "serate", info.lastInsertRowid, b.titolo);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/serate/:id", requireCap("serate"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE serate SET titolo=?,data=?,quando=?,tema=?,descrizione=?,quota=?,capienza=?,attivo=? WHERE id=?").run(b.titolo, b.data ?? "", b.quando ?? "", b.tema ?? "", b.descrizione ?? "", Number(b.quota) || 0, Number(b.capienza) || 80, b.attivo ? 1 : 0, req.params.id);
  audit(req.adminUser.username, "modifica", "serate", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/serate/:id", requireCap("serate"), async (req, res) => {
  if (await bloccaSeCollegato(res, "serate", req.params.id, "la serata")) return;
  await db.prepare("DELETE FROM serate_prenotazioni WHERE serata_id=?").run(req.params.id);
  await db.prepare("DELETE FROM serate WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "serate", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/serate/:id/prenotazioni", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM serate_prenotazioni WHERE serata_id=? ORDER BY created_at DESC").all(req.params.id));
});
adminRouter.put("/serate-prenotazioni/:id", requireCap("serate"), async (req, res) => {
  const stato = ["da_saldare", "saldata", "annullata"].includes(req.body?.stato) ? req.body.stato : "da_saldare";
  await db.prepare("UPDATE serate_prenotazioni SET stato=? WHERE id=?").run(stato, req.params.id);
  audit(req.adminUser.username, "stato_prenotazione_serata", "serate_prenotazioni", req.params.id, stato);
  res.json({ ok: true });
});
var oggi = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
async function fetchCoworking() {
  const rows = await db.prepare(`SELECT p.giorno, p.turno FROM prenotazioni p LEFT JOIN risorse r ON r.id=p.risorsa_id
    WHERE p.stato='confermata' AND (r.tipo='coworking' OR p.risorsa_nome LIKE '%oworking%')`).all();
  const periodi = (t) => {
    t = String(t || "").toLowerCase();
    if (t.startsWith("giorn")) return ["mattina", "pomeriggio"];
    if (t.startsWith("pomerig")) return ["pomeriggio"];
    return ["mattina"];
  };
  const per = {};
  for (const r of rows) {
    const g = r.giorno || "\u2014";
    per[g] ??= { mattina: 0, pomeriggio: 0 };
    periodi(r.turno).forEach((k) => per[g][k]++);
  }
  return { max: 8, giorni: Object.keys(per).map((g) => ({ giorno: g, ...per[g] })) };
}
adminRouter.get("/cdc/coworking", async (req, res) => res.json(await fetchCoworking()));

// L'articolo di magazzino che rappresenta le capsule. Si dichiara una volta; in mancanza si
// tenta col nome, ma il riferimento resta esplicito e non si perde fra gli altri prodotti.
async function articoloCapsule() {
  const scelto = Number(await getSetting("cdc_articolo_capsule", "")) || null;
  if (scelto) {
    const a = await db.prepare("SELECT * FROM magazzino_articoli WHERE id=?").get(scelto);
    if (a) return a;
  }
  return await db.prepare(
    "SELECT * FROM magazzino_articoli WHERE zona IN ('carta','cdc') AND (LOWER(nome) LIKE '%capsul%' OR LOWER(nome) LIKE '%caff%') ORDER BY id DESC LIMIT 1"
  ).get() || null;
}
adminRouter.get("/cdc/caffe", async (req, res) => {
  const cfg = await db.prepare("SELECT * FROM cdc_caffe WHERE id=1").get() || { giacenza: 0, punto_riordino: 40, confezione: 100 };
  const conte = await db.prepare("SELECT * FROM cdc_caffe_conte ORDER BY id DESC LIMIT 30").all();
  // La giacenza vera e' quella dell'articolo di magazzino: il contatore interno resta solo
  // come storico delle conte. Cosi' non ci sono due numeri che possono divergere.
  const art = await articoloCapsule();
  if (art) {
    cfg.giacenza = Number(art.giacenza);
    cfg.punto_riordino = Number(art.punto_riordino) || cfg.punto_riordino;
    cfg.articolo = { id: art.id, nome: art.nome, unita: art.unita };
  }
  cfg.articolo_impostato = !!art;
  const daRiordinare = cfg.giacenza <= cfg.punto_riordino;
  const suggerito = daRiordinare ? Math.max(cfg.confezione, Math.ceil((cfg.punto_riordino * 2 - cfg.giacenza) / Math.max(1, cfg.confezione)) * cfg.confezione) : 0;
  res.json({ config: cfg, conte, da_riordinare: daRiordinare, ordine_suggerito: suggerito });
});
adminRouter.put("/cdc/caffe", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE cdc_caffe SET punto_riordino=?,confezione=? WHERE id=1").run(Number(b.punto_riordino) || 0, Number(b.confezione) || 1);
  audit(req.adminUser.username, "modifica", "cdc_caffe", 1, `riordino ${b.punto_riordino}`);
  res.json({ ok: true });
});
adminRouter.post("/cdc/caffe/conta", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  const g = Math.max(0, Number(b.giacenza) || 0);
  const prev = await db.prepare("SELECT giacenza FROM cdc_caffe WHERE id=1").get();
  const consumo = prev && prev.giacenza >= g ? prev.giacenza - g : null;
  await db.prepare("INSERT INTO cdc_caffe_conte (data,ora,giacenza,consumo,operatore,note) VALUES (?,?,?,?,?,?)").run(b.data || oggi(), b.ora || "16:00", g, consumo, req.adminUser.username, b.note || "");
  await db.prepare("UPDATE cdc_caffe SET giacenza=?,aggiornato_at=datetime('now') WHERE id=1").run(g);

  // La conta serve a qualcosa solo se muove il magazzino: la differenza rispetto alla conta
  // precedente e' il consumo, e viene scaricata dall'articolo capsule della zona Casa di Carta.
  // Cosi' il caffe' non ha piu' una contabilita' sua: la conta e' il rilevamento, il magazzino
  // e' la verita'.
  // Quale articolo scaricare non si indovina dal nome: in magazzino puo' essercene piu' d'uno.
  // Il gestore lo indica una volta (impostazione 'cdc_articolo_capsule'); in mancanza si prova
  // col nome, ma la risposta dice sempre QUALE articolo e' stato mosso.
  let scaricato = null;
  if (consumo > 0) {
    const art = await articoloCapsule();
    if (art) {
      const nuova = Number(art.giacenza) - consumo;
      await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?").run(nuova, (/* @__PURE__ */ new Date()).toISOString(), art.id);
      await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore,zona) VALUES (?,?,?,?,?,?)")
        .run(art.id, "scarico", consumo, `conta capsule del ${b.data || oggi()}`, req.adminUser.username, "carta");
      scaricato = { articolo: art.nome, quantita: consumo, giacenza: nuova };
    }
  }
  audit(req.adminUser.username, "conta_caffe", "cdc_caffe", 1, `giacenza ${g}${consumo ? " \xB7 scarico " + consumo : ""}`);
  res.json({ ok: true, giacenza: g, consumo, scaricato });
});
adminRouter.get("/cdc/giochi", async (req, res) => res.json(await db.prepare("SELECT * FROM cdc_giochi ORDER BY ordine,id").all()));
adminRouter.post("/cdc/giochi", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM cdc_giochi").get()).n;
  const info = await db.prepare("INSERT INTO cdc_giochi (nome,categoria,quantita,stato,note,ordine) VALUES (?,?,?,?,?,?)").run(b.nome, b.categoria || "altro", Number(b.quantita) || 1, b.stato || "ok", b.note || "", ord);
  audit(req.adminUser.username, "crea", "cdc_giochi", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/cdc/giochi/:id", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE cdc_giochi SET nome=?,categoria=?,quantita=?,stato=?,note=? WHERE id=?").run(b.nome, b.categoria || "altro", Number(b.quantita) || 1, b.stato || "ok", b.note || "", req.params.id);
  audit(req.adminUser.username, "modifica", "cdc_giochi", req.params.id, b.stato || "");
  res.json({ ok: true });
});
adminRouter.delete("/cdc/giochi/:id", requireCap("cdc"), async (req, res) => {
  if (await bloccaSeCollegato(res, "cdc_giochi", req.params.id, "il gioco")) return;
  await db.prepare("DELETE FROM cdc_giochi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "cdc_giochi", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/cdc/prestiti", async (req, res) => res.json(await db.prepare("SELECT * FROM cdc_prestiti ORDER BY id DESC LIMIT 100").all()));
adminRouter.post("/cdc/prestiti", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  // Il tavolo dove il gioco verra' usato: serve a sapere chi lo ha lasciato in disordine.
  const info = await db.prepare("INSERT INTO cdc_prestiti (gioco_id,gioco_nome,giocatore,data,ora_inizio,ora_fine,note,tavolo) VALUES (?,?,?,?,?,?,?,?)").run(b.gioco_id || null, b.gioco_nome || "", b.giocatore || "", b.data || oggi(), b.ora_inizio || "", b.ora_fine || "", b.note || "", b.tavolo ? Number(b.tavolo) : null);
  audit(req.adminUser.username, "prestito", "cdc_prestiti", info.lastInsertRowid, b.gioco_nome || "");
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/cdc/prestiti/:id", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE cdc_prestiti SET ora_fine=?,note=? WHERE id=?").run(b.ora_fine || "", b.note || "", req.params.id);
  audit(req.adminUser.username, "riconsegna", "cdc_prestiti", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/cdc/check", async (req, res) => res.json(await db.prepare("SELECT id,data,operatore,caffe_giacenza,strumenti_note,arredi_note,esito,(foto IS NOT NULL AND foto<>'') AS has_foto,created_at FROM cdc_check ORDER BY id DESC LIMIT 60").all()));
adminRouter.get("/cdc/check/:id/foto", async (req, res) => {
  const r = await db.prepare("SELECT foto FROM cdc_check WHERE id=?").get(req.params.id);
  if (!r || !r.foto) return res.status(404).json({ error: "Nessuna foto" });
  res.json({ foto: r.foto });
});
adminRouter.post("/cdc/check", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  const info = await db.prepare("INSERT INTO cdc_check (data,operatore,caffe_giacenza,strumenti_note,arredi_note,esito,foto) VALUES (?,?,?,?,?,?,?)").run(b.data || oggi(), req.adminUser.username, b.caffe_giacenza != null && b.caffe_giacenza !== "" ? Number(b.caffe_giacenza) : null, b.strumenti_note || "", b.arredi_note || "", b.esito || "ok", b.foto || null);
  if (b.caffe_giacenza != null && b.caffe_giacenza !== "") {
    const g = Math.max(0, Number(b.caffe_giacenza) || 0);
    const prev = await db.prepare("SELECT giacenza FROM cdc_caffe WHERE id=1").get();
    const consumo = prev && prev.giacenza >= g ? prev.giacenza - g : null;
    await db.prepare("INSERT INTO cdc_caffe_conte (data,ora,giacenza,consumo,operatore,note) VALUES (?,?,?,?,?,?)").run(b.data || oggi(), "16:00", g, consumo, req.adminUser.username, "da check");
    await db.prepare("UPDATE cdc_caffe SET giacenza=?,aggiornato_at=datetime('now') WHERE id=1").run(g);
  }
  audit(req.adminUser.username, "check", "cdc_check", info.lastInsertRowid, b.esito || "ok");
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.get("/allegati", async (req, res) => {
  res.json(await db.prepare("SELECT id,entita,entita_id,nota,autore,created_at FROM allegati WHERE entita=? AND entita_id=? ORDER BY id DESC").all(req.query.entita || "", String(req.query.entita_id || "")));
});
adminRouter.get("/allegati/:id/foto", async (req, res) => {
  const r = await db.prepare("SELECT immagine FROM allegati WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Non trovato" });
  res.json({ foto: r.immagine });
});
adminRouter.post("/allegati", (req, res, next) => {
  const cap = (req.body || {}).entita === "partita" ? "tabellone" : "cdc";
  return requireCap(cap)(req, res, next);
}, async (req, res) => {
  const b = req.body || {};
  if (!b.immagine) return res.status(400).json({ error: "Immagine mancante" });
  const info = await db.prepare("INSERT INTO allegati (entita,entita_id,immagine,nota,autore) VALUES (?,?,?,?,?)").run(b.entita || "generico", String(b.entita_id || ""), b.immagine, b.nota || "", req.adminUser.username);
  audit(req.adminUser.username, "foto", b.entita || "allegati", b.entita_id || info.lastInsertRowid);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.get("/db/info", requireCap("db"), async (req, res) => {
  let size = 0;
  try {
    size = statSync(DB_PATH).size;
  } catch (_) {
  }
  const persistente = IS_REMOTE || /^\/var\/data\b|^\/data\b/.test(DB_PATH) || process.env.KOINE_PERSISTENT === "1";
  res.json({
    path: DB_PATH,
    tipo: IS_REMOTE ? "gestito (Turso/libSQL)" : DB_PATH === ":memory:" ? "memoria" : "file locale",
    size_kb: Math.round(size / 1024),
    persistente,
    soci: (await db.prepare("SELECT count(*) n FROM soci").get()).n
  });
});
adminRouter.get("/db/backup", requireCap("db"), async (req, res) => {
  if (DB_PATH === ":memory:") return res.status(400).json({ error: "Database in memoria: nessun backup su file" });
  if (IS_REMOTE) return res.status(400).json({ error: "Database gestito (Turso): i backup/point-in-time sono gestiti dal provider. Per un estratto usa l\u2019export dei soci." });
  const tmp = `/tmp/bussola-backup-${Date.now()}.db`;
  try {
    await db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = readFileSync(tmp);
    try {
      unlinkSync(tmp);
    } catch (_) {
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="bussola-backup-${stamp}.db"`);
    audit(req.adminUser.username, "backup_db", "database", 0, `${buf.length} byte`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: "Backup non riuscito: " + e.message });
  }
});
adminRouter.get("/audit", requireCap("registro"), async (req, res) => {
  res.json(await db.prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT 200").all());
});


// ===== TAVOLI DEL GARDEN: disposizioni, pianta e prenotazioni ==============================
// La disposizione cambia con la serata: si salvano piu' layout con un nome e se ne assegna
// uno al giorno. Il numero del tavolo resta stabile (QR self-order, comande.riferimento).

// Il permesso della pianta segue l'AMBIENTE, non il servizio: Garden → comande,
// Casa di Carta → cdc, Stage → cinema. Prima serviva "comande" per tutti, e un operatore
// della Casa di Carta si vedeva rifiutare la propria sala.
function capAmbiente(req) {
  const amb = String(req.query.ambiente || req.body?.ambiente || "garden");
  return amb === "carta" ? "cdc" : amb === "stage" ? "cinema" : "comande";
}
function requireCapAmbiente(req, res, next) {
  return requireCap(capAmbiente(req))(req, res, next);
}
adminRouter.get("/tavoli/layout", requireCapAmbiente, async (req, res) => {
  const amb = ["garden", "carta", "stage"].includes(String(req.query.ambiente)) ? String(req.query.ambiente) : null;
  await layoutPredefinito(amb || "garden");
  const rows = amb
    ? await db.prepare("SELECT * FROM tavoli_layout WHERE ambiente=? ORDER BY predefinito DESC, nome").all(amb)
    : await db.prepare("SELECT * FROM tavoli_layout ORDER BY predefinito DESC, nome").all();
  const out = [];
  for (const l of rows) {
    const t = await tavoliDi(l.id);
    out.push({ ...l, tavoli: t, n_tavoli: t.length, posti: t.reduce((s, x) => s + Number(x.posti), 0) });
  }
  const giorni = await db.prepare("SELECT * FROM tavoli_giorni WHERE data>=date('now','-1 day') ORDER BY data").all();
  res.json({ layout: out, giorni, turni: await turni() });
});
adminRouter.post("/tavoli/layout", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  // L'AMBIENTE VA SCRITTO. Senza, ogni nuova disposizione nasceva nel Garden qualunque fosse
  // la sala da cui la si creava: una platea disegnata nello Stage finiva fra le piante del
  // Garden, con dentro le sedute — e chi apriva il Garden si trovava a gestire sessantasei
  // sedie da un posto senza capire da dove fossero arrivate.
  //
  // Si prende dalla sala di partenza, non dal parametro: chi crea una disposizione la crea
  // sempre dove si trova.
  const copiaDa = b.copia_da ? await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(b.copia_da) : null;
  const ambiente = ["garden", "carta", "stage"].includes(String(b.ambiente))
    ? String(b.ambiente)
    : (copiaDa?.ambiente || "garden");
  const info = await db.prepare("INSERT INTO tavoli_layout (nome,predefinito,ambiente) VALUES (?,0,?)").run(b.nome, ambiente);
  const id = Number(info.lastInsertRowid);
  // Nuovo layout: parte come copia di quello indicato (o del predefinito DELLA SUA SALA).
  const src = copiaDa || await layoutPredefinito(ambiente);
  const ins = db.prepare("INSERT INTO tavoli (layout_id,numero,posti,forma,x,y,attivo,uniti,posti_base) VALUES (?,?,?,?,?,?,?,?,?)");
  for (const t of await tavoliDi(src.id)) await ins.run(id, t.numero, t.posti, t.forma, t.x, t.y, t.attivo, JSON.stringify(t.uniti || []), t.posti_base == null ? null : Number(t.posti_base));
  audit(req.adminUser.username, "crea", "tavoli_layout", id, b.nome);
  res.status(201).json({ ok: true, id });
});
// Salvataggio della pianta: arriva l'elenco completo dei tavoli con posizione e posti.
adminRouter.put("/tavoli/layout/:id", async (req, res) => {
  // Il permesso segue l'ambiente della disposizione che si sta salvando.
  const lay = await db.prepare("SELECT ambiente FROM tavoli_layout WHERE id=?").get(req.params.id);
  const cap = lay?.ambiente === "carta" ? "cdc" : lay?.ambiente === "stage" ? "cinema" : "comande";
  if (!hasCap(req.adminUser, cap)) return res.status(403).json({ error: "Permesso insufficiente per questo ambiente" });
  const b = req.body || {};
  const l = await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(req.params.id);
  if (!l) return res.status(404).json({ error: "Disposizione non trovata" });
  if (b.nome) await db.prepare("UPDATE tavoli_layout SET nome=? WHERE id=?").run(b.nome, l.id);
  if (b.predefinito) {
    await db.prepare("UPDATE tavoli_layout SET predefinito=0").run();
    await db.prepare("UPDATE tavoli_layout SET predefinito=1 WHERE id=?").run(l.id);
  }
  if (Array.isArray(b.tavoli)) {
    const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
    const clamp = (v) => Math.max(0, Math.min(100, num(v, 50)));
    // Si legge PRIMA di cancellare, altrimenti si conserva il vuoto: la DELETE stava sopra e
    // l'elenco dei tavoli da tenere risultava sempre vuoto.
    const primaDi = await tavoliDi(l.id);
    await db.prepare("DELETE FROM tavoli WHERE layout_id=?").run(l.id);
    // AGGIORNAMENTO PARZIALE. Chi salva dalla sala manda solo i tavoli che vede, e i tavoli
    // accostati a un altro sono nascosti: riscrivendo tutto, sparivano dalla pianta per
    // sempre. Un tavolo si cancella solo se chi salva dichiara di avere la lista COMPLETA —
    // cioe' dall'editor della disposizione, dove i tavoli si tolgono apposta.
    const inArrivo = new Set((b.tavoli || []).map((t) => num(t.numero, 0)).filter(Boolean));
    const daTenere = b.completo === true ? [] : primaDi.filter((t) => !inArrivo.has(Number(t.numero)));
    const ins = db.prepare("INSERT INTO tavoli (layout_id,numero,posti,forma,x,y,attivo,uniti,posti_base) VALUES (?,?,?,?,?,?,?,?,?)");
    const visti = new Set();
    for (const t of daTenere) {
      visti.add(Number(t.numero));
      await ins.run(l.id, t.numero, t.posti, t.forma, t.x, t.y, t.attivo, JSON.stringify(t.uniti || []), t.posti_base == null ? null : Number(t.posti_base));
    }
    for (const t of b.tavoli) {
      const n = num(t.numero, 0);
      if (!n || visti.has(n)) continue;
      visti.add(n);
      await ins.run(l.id, n, Math.max(1, num(t.posti, 4)), ["tondo", "quadrato", "rettangolo"].includes(t.forma) ? t.forma : "tondo", clamp(t.x), clamp(t.y), t.attivo === false ? 0 : 1, JSON.stringify((Array.isArray(t.uniti) ? t.uniti : []).map(Number).filter(Boolean)), t.posti_base == null ? null : Math.max(1, num(t.posti_base, 4)));
    }
  }
  audit(req.adminUser.username, "modifica", "tavoli_layout", l.id, `${(b.tavoli || []).length} tavoli`);
  res.json({ ok: true });
});
adminRouter.delete("/tavoli/layout/:id", requireCap("comande"), async (req, res) => {
  const l = await db.prepare("SELECT * FROM tavoli_layout WHERE id=?").get(req.params.id);
  if (!l) return res.status(404).json({ error: "Disposizione non trovata" });
  if (l.predefinito) return res.status(409).json({ error: "Non puoi eliminare la disposizione predefinita" });
  if (await bloccaSeCollegato(res, "tavoli_layout", l.id, "la disposizione")) return;
  await db.prepare("DELETE FROM tavoli WHERE layout_id=?").run(l.id);
  await db.prepare("DELETE FROM tavoli_giorni WHERE layout_id=?").run(l.id);
  await db.prepare("DELETE FROM tavoli_layout WHERE id=?").run(l.id);
  audit(req.adminUser.username, "cancella", "tavoli_layout", l.id, l.nome);
  res.json({ ok: true });
});
// Quale disposizione si usa in un certo giorno.
adminRouter.put("/tavoli/giorno", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data || ""))) return res.status(400).json({ error: "Data non valida" });
  if (b.layout_id) {
    await db.prepare("INSERT INTO tavoli_giorni (data,layout_id) VALUES (?,?) ON CONFLICT(data) DO UPDATE SET layout_id=excluded.layout_id").run(b.data, Number(b.layout_id));
  } else {
    await db.prepare("DELETE FROM tavoli_giorni WHERE data=?").run(b.data);
  }
  audit(req.adminUser.username, "layout_giorno", "tavoli_giorni", 0, `${b.data} -> ${b.layout_id || "predefinito"}`);
  res.json({ ok: true });
});
// Quadro del turno per la Crew: pianta, occupazione, prenotazioni.
adminRouter.get("/tavoli/turno", requireCapAmbiente, async (req, res) => {
  const data = String(req.query.data || "").slice(0, 10) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const amb = ["garden", "carta", "stage"].includes(String(req.query.ambiente)) ? String(req.query.ambiente) : "garden";
  // Lo stage non ha turni fissi: le sue "fasce" sono gli spettacoli e le proiezioni del giorno.
  let t;
  if (amb === "stage") {
    const ev = await db.prepare("SELECT DISTINCT ora FROM proiezioni WHERE data=? AND stato='programmata' ORDER BY ora").all(data);
    t = ev.length ? ev.map((x) => x.ora) : ["21:30"];
  } else {
    t = await turni(amb);
  }
  const turno = t.includes(String(req.query.turno)) ? String(req.query.turno) : t[0];
  res.json({ ...await statoTurno(data, turno, amb), turni: t.map((x) => ({ turno: x, etichetta: amb === "stage" ? "spettacolo " + x : etichettaTurno(x), scopo: amb === "stage" ? "stage" : scopoTurno(x) })) });
});
// La Crew prenota al banco: per il turno successivo all'ora indicata o per un altro giorno.
adminRouter.post("/tavoli/prenota", requireCapAmbiente, async (req, res) => {
  const b = req.body || {};
  const data = String(b.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  let turno = b.turno;
  if (!turno) {
    turno = await turnoSuccessivo(b.ora || (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5));
    if (!turno) return res.status(409).json({ error: "Nessun turno disponibile dopo quest'ora: scegli un altro giorno" });
  }
  const socio = b.tessera_code ? await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(b.tessera_code) : null;
  const nome = b.nome || (socio ? (socio.nome + " " + (socio.cognome || "")).trim() : "Ospite");
  const r = await prenotaTavolo({ data, turno, persone: b.persone, socio, tessera_code: b.tessera_code, nome, origine: "crew", note: b.note, tavoli: b.tavoli });
  if (r.error) return res.status(409).json({ error: r.error });
  audit(req.adminUser.username, "prenota_tavolo", "prenotazioni_tavolo", r.id, `${data} ${turno} \xB7 ${r.persone}p \xB7 tavoli ${r.tavoli.join(",")}`);
  res.status(201).json({ ok: true, ...r });
});
// Spostamento manuale: la Crew puo' sempre correggere l'assegnazione automatica.
adminRouter.put("/tavoli/prenotazioni/:id", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  const p = await db.prepare("SELECT * FROM prenotazioni_tavolo WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (b.stato === "annullato") {
    await db.prepare("UPDATE prenotazioni_tavolo SET stato='annullato' WHERE id=?").run(p.id);
    audit(req.adminUser.username, "annulla_tavolo", "prenotazioni_tavolo", p.id);
    return res.json({ ok: true });
  }
  if (Array.isArray(b.tavoli)) {
    const stato = await statoTurno(p.data, p.turno);
    const occupati = b.tavoli.map(Number).filter((n) => {
      const t = stato.tavoli.find((x) => x.numero === n);
      return t && !t.libero && t.prenotazione_id !== p.id;
    });
    if (occupati.length) return res.status(409).json({ error: `Tavoli gi\xE0 occupati: ${occupati.join(", ")}` });
    await db.prepare("UPDATE prenotazioni_tavolo SET tavoli=? WHERE id=?").run(JSON.stringify(b.tavoli.map(Number)), p.id);
  }
  if (b.persone) await db.prepare("UPDATE prenotazioni_tavolo SET persone=? WHERE id=?").run(Math.max(1, Number(b.persone)), p.id);
  audit(req.adminUser.username, "modifica", "prenotazioni_tavolo", p.id);
  res.json({ ok: true });
});

// Data della giornata: le due partite di una giornata si giocano lo stesso giorno, quindi
// la crew indica una data sola e vale per entrambe. Resta per-partita nel database, cosi'
// un recupero fuori giornata si puo' sempre spostare.
adminRouter.put("/tabellone/:disciplinaId/giornata", requireCap("tabellone"), async (req, res) => {
  const b = req.body || {};
  const quando = String(b.quando || "").slice(0, 10);
  if (quando && !/^\d{4}-\d{2}-\d{2}$/.test(quando)) return res.status(400).json({ error: "Data non valida" });
  const g = Number(b.giornata);
  if (!g) return res.status(400).json({ error: "Giornata mancante" });
  if (b.girone_id) {
    await db.prepare("UPDATE partite SET quando=? WHERE disciplina_id=? AND girone_id=? AND giornata=?").run(quando || null, req.params.disciplinaId, Number(b.girone_id), g);
  } else {
    await db.prepare("UPDATE partite SET quando=? WHERE disciplina_id=? AND fase='girone' AND giornata=?").run(quando || null, req.params.disciplinaId, g);
  }
  audit(req.adminUser.username, "data_giornata", "partite", req.params.disciplinaId, `giornata ${g} -> ${quando || "—"}`);
  res.json({ ok: true });
});

// ===== PARAMETRI DI FUNZIONAMENTO ==========================================================
adminRouter.get("/parametri", async (req, res) => {
  res.json(await tuttiParametri());
});
adminRouter.put("/parametri", requireCap("parametri"), async (req, res) => {
  const cambiati = await salvaParametri(req.body || {});
  audit(req.adminUser.username, "parametri", "impostazioni", 0, cambiati.join(", "));
  res.json({ ok: true, cambiati, parametri: await tuttiParametri() });
});

// Costo di un evento, filtrato dai parametri: se gli eventi a pagamento sono spenti l'evento
// e' libero; se e' ammesso un solo modo, l'altro non puo' essere salvato per sbaglio.
// Dove si tiene una cosa: cambia la capienza, chi la serve e se blocca lo Stage.
var LUOGHI_EV = ["bar", "garden", "stage", "carta", "campi", "altro"];
async function costoEvento(b) {
  const onerosi = await par("eventi_onerosi");
  if (!onerosi) return { costo_tipo: "nessuno", prezzo: 0, consumazione: null };
  const modo = await par("eventi_modo_costo");
  let tipo = ["nessuno", "prezzo", "consumazione"].includes(b.costo_tipo) ? b.costo_tipo : (Number(b.prezzo) > 0 ? "prezzo" : "nessuno");
  if (modo === "prezzo" && tipo === "consumazione") tipo = "prezzo";
  if (modo === "consumazione" && tipo === "prezzo") tipo = "consumazione";
  if (tipo === "prezzo") return { costo_tipo: "prezzo", prezzo: Number(b.prezzo) || 0, consumazione: null };
  if (tipo === "consumazione") return { costo_tipo: "consumazione", prezzo: 0, consumazione: String(b.consumazione || "1 consumazione obbligatoria").slice(0, 120) };
  return { costo_tipo: "nessuno", prezzo: 0, consumazione: null };
}

// Cosa impedisce di cancellare: l'interfaccia la usa per spiegarlo PRIMA di provarci.
adminRouter.get("/referenze/:entita/:id", async (req, res) => {
  res.json({ blocchi: await rami(req.params.entita, req.params.id) });
});

// Data della singola partita: la data comune della giornata scrive le righe, ma un incontro
// puo' sempre spostarsi per meteo, disponibilita' del campo o opportunita'.
adminRouter.put("/partite/:id/quando", requireCap("tabellone"), async (req, res) => {
  const quando = String(req.body?.quando || "").slice(0, 10);
  if (quando && !/^\d{4}-\d{2}-\d{2}$/.test(quando)) return res.status(400).json({ error: "Data non valida" });
  const m = await db.prepare("SELECT id FROM partite WHERE id=?").get(req.params.id);
  if (!m) return res.status(404).json({ error: "Partita non trovata" });
  await db.prepare("UPDATE partite SET quando=? WHERE id=?").run(quando || null, m.id);
  audit(req.adminUser.username, "data_partita", "partite", m.id, quando || "\u2014");
  res.json({ ok: true });
});

// I tavoli in sala oggi: la tab Comande legge di qui, non da un semplice conteggio, cosi'
// i tavoli aggiunti compaiono e quelli assorbiti da un'unione spariscono dalla mappa
// pur restando raggiungibili col loro vecchio numero (QR gia' stampati, comande aperte).
adminRouter.get("/tavoli/sala", requireCap("comande"), async (req, res) => {
  const data = String(req.query.data || "").slice(0, 10) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const { layout, tavoli, verso } = await mappaTavoli(data);
  res.json({
    data,
    layout: { id: layout.id, nome: layout.nome },
    tavoli: tavoli.filter((t) => t.attivo !== 0).map((t) => ({ numero: t.numero, posti: t.posti, forma: t.forma, x: t.x, y: t.y, uniti: t.uniti })),
    // numero scritto sulla comanda -> tavolo che lo serve
    verso: Object.fromEntries(verso)
  });
});

// ===== CINEMA: film, cartellone, proiezioni ================================================
adminRouter.get("/film", requireCap("cinema"), async (req, res) => {
  res.json(await db.prepare("SELECT * FROM film ORDER BY ordine,id").all());
});
adminRouter.post("/film", requireCap("cinema"), async (req, res) => {
  const b = req.body || {};
  if (!b.titolo) return res.status(400).json({ error: "Titolo obbligatorio" });
  const ord = ((await db.prepare("SELECT MAX(ordine) m FROM film").get())?.m || 0) + 1;
  const info = await db.prepare("INSERT INTO film (titolo,regia,anno,durata_min,genere,sinossi,vm,ordine) VALUES (?,?,?,?,?,?,?,?)")
    .run(b.titolo, b.regia || null, Number(b.anno) || null, Number(b.durata_min) || null, b.genere || null, b.sinossi || null, b.vm || null, ord);
  audit(req.adminUser.username, "crea", "film", Number(info.lastInsertRowid), b.titolo);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
adminRouter.put("/film/:id", requireCap("cinema"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE film SET titolo=?,regia=?,anno=?,durata_min=?,genere=?,sinossi=?,vm=?,attivo=? WHERE id=?")
    .run(b.titolo, b.regia || null, Number(b.anno) || null, Number(b.durata_min) || null, b.genere || null, b.sinossi || null, b.vm || null, b.attivo === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/film/:id", requireCap("cinema"), async (req, res) => {
  const n = await db.prepare("SELECT COUNT(*) c FROM proiezioni WHERE film_id=?").get(req.params.id);
  if (Number(n?.c || 0) > 0) return res.status(409).json({ error: `Non posso eliminare il film: e\u0300 in cartellone in ${n.c} proiezioni.` });
  await db.prepare("DELETE FROM film WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

adminRouter.get("/proiezioni", requireCap("cinema"), async (req, res) => {
  const rows = await db.prepare("SELECT p.*, f.titolo, f.regia, f.durata_min FROM proiezioni p LEFT JOIN film f ON f.id=p.film_id ORDER BY p.data,p.ora").all();
  const out = [];
  for (const p of rows) {
    const st = await statoTurno(p.data, p.ora, "stage", p.layout_id);
    out.push({ ...p, posti_totali: st.posti_totali, posti_liberi: st.posti_liberi, standard_liberi: st.standard_liberi, prenotati: st.coperti_prenotati });
  }
  res.json(out);
});
adminRouter.post("/proiezioni", requireCap("cinema"), async (req, res) => {
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data || ""))) return res.status(400).json({ error: "Data non valida" });
  if (!b.film_id) return res.status(400).json({ error: "Scegli il film" });
  const lay = b.layout_id ? Number(b.layout_id) : (await layoutPredefinito("stage")).id;
  const info = await db.prepare("INSERT INTO proiezioni (film_id,data,ora,layout_id,note) VALUES (?,?,?,?,?)")
    .run(Number(b.film_id), b.data, b.ora || "21:30", lay, b.note || null);
  audit(req.adminUser.username, "crea", "proiezioni", Number(info.lastInsertRowid), `${b.data} ${b.ora || "21:30"}`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
adminRouter.put("/proiezioni/:id", requireCap("cinema"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE proiezioni SET film_id=?,data=?,ora=?,note=?,stato=? WHERE id=?")
    .run(Number(b.film_id) || null, b.data, b.ora || "21:30", b.note || null, b.stato === "annullata" ? "annullata" : "programmata", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/proiezioni/:id", requireCap("cinema"), async (req, res) => {
  const n = await db.prepare("SELECT COUNT(*) c FROM prenotazioni_tavolo WHERE proiezione_id=? AND stato='prenotato'").get(req.params.id);
  if (Number(n?.c || 0) > 0) return res.status(409).json({ error: `Non posso eliminare la proiezione: ci sono ${n.c} prenotazioni attive.` });
  await db.prepare("DELETE FROM proiezioni WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
// Platea di una proiezione: stessa forma del turno del Garden, altre etichette.
adminRouter.get("/proiezioni/:id/platea", requireCap("cinema"), async (req, res) => {
  const p = await db.prepare("SELECT p.*, f.titolo FROM proiezioni p LEFT JOIN film f ON f.id=p.film_id WHERE p.id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Proiezione non trovata" });
  res.json({ proiezione: p, ...await statoTurno(p.data, p.ora, "stage", p.layout_id) });
});

// ===== AREA FITNESS: corsi, lezioni, iscritti, incassi =====================================
adminRouter.get("/fitness/corsi", requireCap("fitness"), async (req, res) => {
  const corsi = await db.prepare("SELECT * FROM corsi_fitness ORDER BY ordine,id").all();
  const out = [];
  for (const c of corsi) {
    const n = await db.prepare("SELECT COUNT(*) n FROM fitness_sedute WHERE corso_id=? AND stato='programmata'").get(c.id);
    out.push({ ...c, giorni: JSON.parse(c.giorni || "[]"), masterclass: !!c.masterclass, lezioni: Number(n?.n || 0) });
  }
  res.json(out);
});
function corpoCorso(b) {
  return [
    b.nome, b.istruttore || null, b.descrizione || null,
    b.data_inizio || null, b.data_fine || null,
    JSON.stringify((Array.isArray(b.giorni) ? b.giorni : []).map(Number).filter((n) => n >= 1 && n <= 7)),
    b.ora || "09:00", Math.max(15, Number(b.durata_min) || 60),
    Math.max(1, Number(b.posti_max) || 20), Math.max(0, Number(b.min_iscritti) || 0),
    Math.max(0, Number(b.prezzo) || 0), b.masterclass ? 1 : 0, Math.max(0, Number(b.prezzo_master) || 0),
    b.attivo === false ? 0 : 1,
    // Il colore si accetta solo nella forma #rrggbb: e' un valore che finisce dentro il CSS
    // delle pagine, e non ci va infilato testo libero.
    /^#[0-9a-f]{6}$/i.test(String(b.colore || "")) ? b.colore : COLORI_FITNESS[Math.floor(Math.random() * COLORI_FITNESS.length)]
  ];
}
var COLORI_FITNESS = ["#2f6d8a", "#7a5c2e", "#2e6b45", "#8a4a6b", "#b08b3e", "#5f5188", "#b14a35", "#3f7d6a"];
adminRouter.post("/fitness/corsi", requireCap("fitness"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Indica la disciplina" });
  const ord = ((await db.prepare("SELECT MAX(ordine) m FROM corsi_fitness").get())?.m || 0) + 1;
  const info = await db.prepare(
    "INSERT INTO corsi_fitness (nome,istruttore,descrizione,data_inizio,data_fine,giorni,ora,durata_min,posti_max,min_iscritti,prezzo,masterclass,prezzo_master,attivo,colore,ordine) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(...corpoCorso(b), ord);
  const id = Number(info.lastInsertRowid);
  const g = await generaSedute(id);
  audit(req.adminUser.username, "crea", "corsi_fitness", id, `${b.nome}${g.creati ? " \xB7 " + g.creati + " lezioni" : ""}`);
  res.status(201).json({ ok: true, id, ...g });
});
adminRouter.put("/fitness/corsi/:id", requireCap("fitness"), async (req, res) => {
  const b = req.body || {};
  await db.prepare(
    "UPDATE corsi_fitness SET nome=?,istruttore=?,descrizione=?,data_inizio=?,data_fine=?,giorni=?,ora=?,durata_min=?,posti_max=?,min_iscritti=?,prezzo=?,masterclass=?,prezzo_master=?,attivo=?,colore=? WHERE id=?"
  ).run(...corpoCorso(b), req.params.id);
  const g = await generaSedute(Number(req.params.id));
  res.json({ ok: true, ...g });
});
adminRouter.post("/fitness/corsi/:id/genera", requireCap("fitness"), async (req, res) => {
  const g = await generaSedute(Number(req.params.id));
  if (g.error) return res.status(400).json(g);
  audit(req.adminUser.username, "genera_lezioni", "corsi_fitness", req.params.id, `${g.creati} nuove`);
  res.json({ ok: true, ...g });
});
adminRouter.delete("/fitness/corsi/:id", requireCap("fitness"), async (req, res) => {
  const n = await db.prepare(
    "SELECT COUNT(*) c FROM fitness_prenotazioni p JOIN fitness_sedute s ON s.id=p.seduta_id WHERE s.corso_id=? AND p.stato='prenotato'"
  ).get(req.params.id);
  if (Number(n?.c || 0) > 0) return res.status(409).json({ error: `Non posso eliminare il corso: ci sono ${n.c} iscrizioni attive.` });
  await db.prepare("DELETE FROM fitness_sedute WHERE corso_id=?").run(req.params.id);
  await db.prepare("DELETE FROM corsi_fitness WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "corsi_fitness", req.params.id);
  res.json({ ok: true });
});

// Lezioni con iscritti, minimo e stato. E' la vista che serve anche alla Crew.
adminRouter.get("/fitness/sedute", requireCap("fitness"), async (req, res) => {
  const list = await seduteFitness({ corsoId: req.query.corso ? Number(req.query.corso) : null, soloFuture: req.query.tutte !== "1" });
  const out = [];
  for (const s of list) {
    const iscritti = await db.prepare(
      "SELECT id,nome,tessera_code,pagato FROM fitness_prenotazioni WHERE seduta_id=? AND stato='prenotato' ORDER BY id"
    ).all(s.id);
    // Chi ha disdetto oltre il margine: non viene, ma la lezione la deve. Senza questo elenco
    // al banco non si sa a chi chiedere i soldi, e la regola resta scritta solo sulla carta.
    const dovute = await db.prepare(
      "SELECT id,nome,tessera_code,pagato,annullata_at FROM fitness_prenotazioni WHERE seduta_id=? AND stato='annullato' AND dovuta=1 AND pagato=0 ORDER BY id"
    ).all(s.id);
    out.push({ ...s, elenco: iscritti, disdette_dovute: dovute, incassato: iscritti.filter((x) => x.pagato).length * Number(s.prezzo), da_incassare: iscritti.filter((x) => !x.pagato).length * Number(s.prezzo) });
  }
  res.json(out);
});
// Masterclass all'ultimo momento, cambio istruttore, prezzo diverso, lezione annullata.
adminRouter.put("/fitness/sedute/:id", requireCap("fitness"), async (req, res) => {
  const b = req.body || {};
  const s = await db.prepare("SELECT * FROM fitness_sedute WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Lezione non trovata" });
  await db.prepare("UPDATE fitness_sedute SET ora=?,istruttore=?,posti_max=?,min_iscritti=?,prezzo=?,masterclass=?,titolo=?,stato=? WHERE id=?")
    .run(b.ora || s.ora, b.istruttore ?? s.istruttore, Math.max(1, Number(b.posti_max) || s.posti_max), Math.max(0, Number(b.min_iscritti ?? s.min_iscritti)), Math.max(0, Number(b.prezzo ?? s.prezzo)), b.masterclass ? 1 : 0, b.titolo ?? s.titolo, b.stato === "annullata" ? "annullata" : "programmata", s.id);
  audit(req.adminUser.username, "modifica", "fitness_sedute", s.id, b.stato === "annullata" ? "annullata" : "");
  res.json({ ok: true, ...await conStato(await db.prepare("SELECT * FROM fitness_sedute WHERE id=?").get(s.id)) });
});
// Si incassa in contanti a fine lezione: qui si spunta chi ha pagato.
adminRouter.put("/fitness/prenotazioni/:id", requireCap("fitness"), async (req, res) => {
  const b = req.body || {};
  if (b.stato === "annullato") {
    await db.prepare("UPDATE fitness_prenotazioni SET stato='annullato' WHERE id=?").run(req.params.id);
  } else {
    await db.prepare("UPDATE fitness_prenotazioni SET pagato=? WHERE id=?").run(b.pagato ? 1 : 0, req.params.id);
  }
  res.json({ ok: true });
});
// Iscrizione al banco, per chi si presenta senza app.
adminRouter.post("/fitness/sedute/:id/iscrivi", requireCap("fitness"), async (req, res) => {
  const b = req.body || {};
  const socio = b.tessera_code ? await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(b.tessera_code) : null;
  const nome = b.nome || (socio ? (socio.nome + " " + (socio.cognome || "")).trim() : "Ospite");
  const { prenotaSeduta } = await import("../fitness.js");
  const r = await prenotaSeduta({ sedutaId: Number(req.params.id), socio, tessera_code: b.tessera_code, nome, origine: "crew" });
  if (r.error) return res.status(409).json({ error: r.error });
  res.status(201).json({ ok: true, ...r });
});

// ===== CHIUSURA DELLA STAGIONE E ALBO D'ORO DELLE CASATE ==================================
adminRouter.get("/coppa/chiusura", requireCap("casate"), async (req, res) => {
  const stagione = String(req.query.stagione || stagioneCorrente());
  res.json({ ...await statoChiusura(stagione), albo: await alboCasate(), campione: await campioneInCarica() });
});
adminRouter.post("/coppa/chiudi", requireCap("casate"), async (req, res) => {
  const stagione = String(req.body?.stagione || stagioneCorrente());
  const r = await chiudiStagione(stagione, req.adminUser.username, req.body?.vincitrice || null);
  if (r.error) return res.status(409).json(r);
  res.json({ ok: true, ...r, albo: await alboCasate() });
});

// Sala della Casa di Carta per la Crew: tavoli, occupanti e prestiti in corso a quel tavolo.
adminRouter.get("/carta/sala", requireCap("cdc"), async (req, res) => {
  const data = String(req.query.data || "").slice(0, 10) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const t = await turni("carta");
  const turno = t.includes(String(req.query.turno)) ? String(req.query.turno) : t[0];
  const st = await statoTurno(data, turno, "carta");
  const prestiti = await db.prepare("SELECT id,gioco_nome,giocatore,tavolo,ora_inizio FROM cdc_prestiti WHERE (ora_fine IS NULL OR ora_fine='') ORDER BY id").all();
  const perTavolo = {};
  for (const p of prestiti) if (p.tavolo) (perTavolo[p.tavolo] = perTavolo[p.tavolo] || []).push(p);
  res.json({
    data, turno, turni: t.map((x) => ({ turno: x, etichetta: etichettaTurno(x), scopo: scopoTurno(x) })),
    // Reception e angolo caffe' stanno sulla pianta, non nell'elenco dei tavoli prenotabili.
    tavoli: st.tavoli.filter((x) => (x.tipo || "standard") !== "arredo").map((x) => ({ ...x, prestiti: perTavolo[x.numero] || [] })),
    prenotazioni: st.prenotazioni,
    prestiti_senza_tavolo: prestiti.filter((p) => !p.tavolo),
    minimo: await par("carta_numero_legale") ? Number(await par("carta_min_giocatori")) : null
  });
});
adminRouter.post("/carta/prenota", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  const data = String(b.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  const socio = b.tessera_code ? await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(b.tessera_code) : null;
  const nome = b.nome || (socio ? (socio.nome + " " + (socio.cognome || "")).trim() : "Ospite");
  const r = await prenotaTavolo({ data, turno: String(b.turno || ""), persone: b.persone, socio, tessera_code: b.tessera_code, nome, origine: "crew", ambiente: "carta", tavoli: b.tavoli });
  if (r.error) return res.status(409).json({ error: r.error });
  audit(req.adminUser.username, "prenota_tavolo_carta", "prenotazioni_tavolo", r.id, `${data} ${r.turno}`);
  res.status(201).json({ ok: true, ...r });
});

// Platea al banco: chi si presenta senza app viene messo a sedere dalla Crew.
adminRouter.post("/proiezioni/:id/prenota", requireCap("cinema"), async (req, res) => {
  const p = await db.prepare("SELECT * FROM proiezioni WHERE id=? AND stato='programmata'").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Proiezione non trovata" });
  const b = req.body || {};
  const socio = b.tessera_code ? await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(b.tessera_code) : null;
  const nome = b.nome || (socio ? (socio.nome + " " + (socio.cognome || "")).trim() : "Ospite");
  const r = await prenotaTavolo({ data: p.data, turno: p.ora, persone: b.persone, socio, tessera_code: b.tessera_code, nome, origine: "crew", ambiente: "stage", proiezione_id: p.id, layout_id: p.layout_id });
  if (r.error) return res.status(409).json({ error: r.error });
  audit(req.adminUser.username, "prenota_cinema", "proiezioni", p.id, `${r.persone}p \xB7 posti ${r.tavoli.join(",")}`);
  res.status(201).json({ ok: true, ...r, posti: r.tavoli });
});
adminRouter.put("/proiezioni/prenotazioni/:id", requireCap("cinema"), async (req, res) => {
  await db.prepare("UPDATE prenotazioni_tavolo SET stato='annullato' WHERE id=? AND ambiente='stage'").run(req.params.id);
  res.json({ ok: true });
});

// ===== COWORKING E PRENOTAZIONE DELLA SALA ================================================
// La Casa di Carta non e' solo giochi: di mattina e' coworking, e a volte serve tutta per una
// riunione o una presentazione. Una prenotazione di sala esclusiva blocca i tavoli in quella
// fascia, perche' non si gioca a Risiko mentre qualcuno presenta.
const SCOPI_SALA = ["riunione", "presentazione", "corso", "altro"];

function sovrappone(a1, a2, b1, b2) {
  return String(a1) < String(b2) && String(b1) < String(a2);
}

adminRouter.get("/sala", requireCap("cdc"), async (req, res) => {
  const da = String(req.query.da || "").slice(0, 10) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const righe = await db.prepare("SELECT * FROM prenotazioni_sala WHERE stato='confermata' AND data>=? ORDER BY data,ora_inizio").all(da);
  // Il coworking arriva dalle prenotazioni di risorsa gia' esistenti: non si duplica.
  let cw = { giorni: [], max: 8 };
  try {
    const r = await fetchCoworking();
    cw = r;
  } catch (_) {
  }
  res.json({ prenotazioni: righe, scopi: SCOPI_SALA, coworking: cw, turni_gioco: await turni("carta") });
});

adminRouter.post("/sala", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  const data = String(b.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida" });
  const da = String(b.ora_inizio || "").slice(0, 5), a = String(b.ora_fine || "").slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(da) || !/^\d{2}:\d{2}$/.test(a) || a <= da) return res.status(400).json({ error: "Orario non valido" });

  // Due riunioni non stanno nella stessa stanza.
  const altre = await db.prepare("SELECT * FROM prenotazioni_sala WHERE data=? AND stato='confermata'").all(data);
  const scontro = altre.find((x) => sovrappone(da, a, x.ora_inizio, x.ora_fine));
  if (scontro) return res.status(409).json({ error: `La sala e\u0300 gi\u00e0 impegnata dalle ${scontro.ora_inizio} alle ${scontro.ora_fine} (${scontro.titolo || scontro.scopo}).` });

  // E nemmeno una riunione sopra i tavoli gia' prenotati per giocare.
  if (b.esclusiva !== false) {
    const t = await turni("carta");
    for (const turno of t) {
      const durata = scopoTurno(turno) === "coworking" ? (turno === "09:00" ? 4 : 3) : 2;
      const fine = String(Number(turno.slice(0, 2)) + durata).padStart(2, "0") + turno.slice(2);
      if (!sovrappone(da, a, turno, fine)) continue;
      const occupati = await db.prepare("SELECT COUNT(*) n FROM prenotazioni_tavolo WHERE ambiente='carta' AND data=? AND turno=? AND stato='prenotato'").get(data, turno);
      if (Number(occupati?.n || 0) > 0) {
        return res.status(409).json({ error: `Nel turno delle ${turno} ci sono gi\u00e0 ${occupati.n} tavoli prenotati per giocare: liberali prima di riservare la sala.` });
      }
    }
  }
  const info = await db.prepare(
    "INSERT INTO prenotazioni_sala (data,ora_inizio,ora_fine,scopo,titolo,richiedente,tessera_code,persone,esclusiva,note) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(data, da, a, SCOPI_SALA.includes(b.scopo) ? b.scopo : "riunione", b.titolo || null, b.richiedente || null, b.tessera_code || null, Math.max(1, Number(b.persone) || 1), b.esclusiva === false ? 0 : 1, b.note || null);
  audit(req.adminUser.username, "prenota_sala", "prenotazioni_sala", Number(info.lastInsertRowid), `${data} ${da}-${a} \xB7 ${b.scopo || "riunione"}`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

adminRouter.delete("/sala/:id", requireCap("cdc"), async (req, res) => {
  await db.prepare("UPDATE prenotazioni_sala SET stato='annullata' WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "annulla_sala", "prenotazioni_sala", req.params.id);
  res.json({ ok: true });
});

// Quale articolo di magazzino rappresenta le capsule: si sceglie una volta e non si indovina piu'.
adminRouter.get("/cdc/caffe/articolo", requireCap("cdc"), async (req, res) => {
  const id = Number(await getSetting("cdc_articolo_capsule", "")) || null;
  const candidati = await db.prepare("SELECT id,nome,giacenza,unita,zona FROM magazzino_articoli ORDER BY (zona IN ('carta','cdc')) DESC, nome").all();
  const att = await articoloCapsule();
  res.json({ articolo_id: id, attuale: att ? { id: att.id, nome: att.nome, giacenza: att.giacenza } : null, dedotto: !id && !!att, candidati });
});
adminRouter.put("/cdc/caffe/articolo", requireCap("cdc"), async (req, res) => {
  const id = Number(req.body?.articolo_id) || 0;
  await setSetting("cdc_articolo_capsule", id ? String(id) : "");
  audit(req.adminUser.username, "articolo_capsule", "magazzino_articoli", id, "");
  res.json({ ok: true, articolo_id: id || null });
});

// Ripristina la disposizione predefinita di un ambiente dai parametri correnti.
// Serve perche' la platea (e la sala) si creano UNA VOLTA: cambiare "posti standard" nei
// parametri non ridisegnava nulla, e i database nati prima si portavano dietro la vecchia
// pianta. Non si esegue se ci sono prenotazioni attive: prima si liberano.
// "Ci sta davvero?" — la pianta riportata alle misure vere della sala.
adminRouter.get("/tavoli/verifica-spazio", requireCapAmbiente, async (req, res) => {
  const amb = ["garden", "carta", "stage"].includes(String(req.query.ambiente)) ? String(req.query.ambiente) : "garden";
  res.json(await verificaSpazio(amb));
});
adminRouter.post("/tavoli/layout/rigenera", requireCapAmbiente, async (req, res) => {
  const amb = ["garden", "carta", "stage"].includes(String(req.body?.ambiente)) ? String(req.body.ambiente) : null;
  if (!amb) return res.status(400).json({ error: "Ambiente non valido" });
  // Dire "ci sono N prenotazioni attive" senza dire QUALI lascia il gestore a cercarle a mano
  // per tutte le date. Si elencano: giorno, turno, tavolo e nome. Cosi' si sa cosa liberare.
  const attive = await db.prepare(
    "SELECT id,data,turno,tavoli,nome,persone FROM prenotazioni_tavolo WHERE ambiente=? AND stato='prenotato' AND data>=date('now','-1 day') ORDER BY data,turno"
  ).all(amb);
  if (attive.length > 0) {
    const descrivi = (p) => {
      let tv = "";
      try { const a = JSON.parse(p.tavoli || "[]"); tv = Array.isArray(a) && a.length ? " \u00b7 tavolo " + a.join(", ") : ""; } catch (_) { }
      return `${p.data} \u00b7 ${p.turno || ""}${tv}${p.nome ? " \u00b7 " + p.nome : ""}${p.persone ? " (" + p.persone + " pers.)" : ""}`;
    };
    return res.status(409).json({
      error: `Non ridisegno la sala: ci sono ${attive.length} prenotazioni ancora in piedi.\n\n`
        + attive.slice(0, 8).map((p) => "\u00b7 " + descrivi(p)).join("\n")
        + (attive.length > 8 ? `\n\u00b7 \u2026 e altre ${attive.length - 8}` : "")
        + `\n\nLiberale dalla pianta (tocca il tavolo \u2192 Libera) e riprova. Nota: annullare una comanda non libera il tavolo, sono due cose diverse.`,
      prenotazioni: attive.map((p) => ({ id: p.id, data: p.data, turno: p.turno, nome: p.nome }))
    });
  }
  const vecchie = await db.prepare("SELECT id FROM tavoli_layout WHERE ambiente=?").all(amb);
  // Le proiezioni puntano al layout della platea: si sganciano prima, poi si riagganciano
  // al nuovo. Cancellare il layout lasciando il riferimento appeso rompeva la platea.
  for (const l of vecchie) {
    await db.prepare("UPDATE proiezioni SET layout_id=NULL WHERE layout_id=?").run(l.id);
    await db.prepare("DELETE FROM tavoli WHERE layout_id=?").run(l.id);
    await db.prepare("DELETE FROM tavoli_giorni WHERE layout_id=?").run(l.id);
    await db.prepare("DELETE FROM tavoli_layout WHERE id=?").run(l.id);
  }
  const nuovo = await layoutPredefinito(amb);
  if (amb === "stage") await db.prepare("UPDATE proiezioni SET layout_id=? WHERE layout_id IS NULL").run(nuovo.id);
  audit(req.adminUser.username, "rigenera_pianta", "tavoli_layout", nuovo.id, amb);
  res.json({ ok: true, layout: { id: nuovo.id, nome: nuovo.nome, ambiente: nuovo.ambiente } });
});

// ===== CRUSCOTTO OPERATIVO ================================================================
// Non un elenco di totali storici, ma cosa sta succedendo ADESSO e cosa richiede una mano:
// il servizio in corso, le prenotazioni di oggi, i fuori scorta, quello che aspetta risposta.
adminRouter.get("/cruscotto", async (req, res) => {
  const oggi = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const ora = (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5);
  const n = async (sql, ...a) => Number((await db.prepare(sql).get(...a))?.n || 0);

  // --- servizio in corso
  const comandeAperte = await db.prepare("SELECT id,numero,zona,riferimento,stato,created_at FROM comande WHERE stato IN ('aperta','in_preparazione','pronta') ORDER BY id").all();
  const inRitardo = comandeAperte.filter((c) => (Date.now() - new Date(String(c.created_at).replace(" ", "T") + "Z")) > 10 * 60000).length;

  // --- giornata
  const campiOggi = await db.prepare(
    "SELECT COUNT(DISTINCT partita_id) n FROM prenotazioni_campo WHERE data=? AND stato='prenotato'"
  ).get(oggi);
  const gardenOggi = await db.prepare("SELECT COALESCE(SUM(persone),0) n FROM prenotazioni_tavolo WHERE ambiente='garden' AND data=? AND stato='prenotato'").get(oggi);
  const cartaOggi = await db.prepare("SELECT COUNT(*) n FROM prenotazioni_tavolo WHERE ambiente='carta' AND data=? AND stato='prenotato'").get(oggi);
  const stageOggi = await db.prepare("SELECT COALESCE(SUM(persone),0) n FROM prenotazioni_tavolo WHERE ambiente='stage' AND data=? AND stato='prenotato'").get(oggi);
  const lezioniOggi = await db.prepare(
    "SELECT s.id,s.ora,s.posti_max,s.min_iscritti,c.nome FROM fitness_sedute s JOIN corsi_fitness c ON c.id=s.corso_id WHERE s.data=? AND s.stato='programmata' ORDER BY s.ora"
  ).all(oggi);
  const lezioni = [];
  for (const l of lezioniOggi) {
    const isc = await n("SELECT COUNT(*) n FROM fitness_prenotazioni WHERE seduta_id=? AND stato='prenotato'", l.id);
    lezioni.push({ ...l, iscritti: isc, confermata: isc >= l.min_iscritti });
  }
  const proiezioniOggi = await db.prepare("SELECT p.ora,f.titolo FROM proiezioni p LEFT JOIN film f ON f.id=p.film_id WHERE p.data=? AND p.stato='programmata' ORDER BY p.ora").all(oggi);
  const salaOggi = await db.prepare("SELECT ora_inizio,ora_fine,scopo,titolo FROM prenotazioni_sala WHERE data=? AND stato='confermata' ORDER BY ora_inizio").all(oggi);

  // --- cose che chiedono una mano
  const daRiordinare = await db.prepare(
    "SELECT id,nome,giacenza,punto_riordino FROM magazzino_articoli WHERE punto_riordino>0 AND giacenza<=punto_riordino ORDER BY giacenza LIMIT 8"
  ).all();
  const negativi = await db.prepare("SELECT id,nome,giacenza FROM magazzino_articoli WHERE giacenza < 0 ORDER BY giacenza LIMIT 8").all();
  const attenzione = [];
  if (negativi.length) attenzione.push({ tipo: "magazzino", testo: `${negativi.length} articoli con giacenza NEGATIVA: si sta vendendo merce che a sistema non c'\u00e8`, vai: "magazzino" });
  if (inRitardo) attenzione.push({ tipo: "comande", testo: `${inRitardo} comande oltre i 10 minuti`, vai: "chiosco" });
  if (daRiordinare.length) attenzione.push({ tipo: "magazzino", testo: `${daRiordinare.length} articoli sotto il punto di riordino`, vai: "magazzino" });
  const segnalati = await n("SELECT COUNT(*) n FROM chat_messaggi WHERE segnalato=1 AND nascosto=0");
  if (segnalati) attenzione.push({ tipo: "chat", testo: `${segnalati} messaggi segnalati nella chat delle casate`, vai: "casate" });
  const propNuove = await n("SELECT COUNT(*) n FROM proposte WHERE stato='nuova'");
  if (propNuove) attenzione.push({ tipo: "proposte", testo: `${propNuove} proposte da leggere`, vai: "proposte" });
  const lezDeboli = lezioni.filter((l) => !l.confermata).length;
  if (lezDeboli) attenzione.push({ tipo: "fitness", testo: `${lezDeboli} lezioni di oggi sotto il minimo`, vai: "fitness" });
  const partiteDaGiocare = await n("SELECT COUNT(*) n FROM partite WHERE stato<>'giocata'");

  // Il turno di stasera al Garden, nome per nome: e' la prima cosa che serve a chi apre.
  const turniGarden = await turni("garden");
  const attesi = [];
  for (const t of turniGarden) {
    const st = await statoTurno(oggi, t, "garden");
    attesi.push({ turno: t, coperti: st.coperti_prenotati, posti: st.posti_totali,
      ospiti: (st.prenotazioni || []).map((p) => ({ nome: p.nome, persone: p.persone, tavoli: p.tavoli })) });
  }
  // Prossimi arrivi alla Casa di Carta e allo Stage
  const cartaOggiEl = await db.prepare("SELECT turno,nome,persone FROM prenotazioni_tavolo WHERE ambiente='carta' AND data=? AND stato='prenotato' ORDER BY turno").all(oggi);
  const stageOggiEl = await db.prepare("SELECT turno,nome,persone FROM prenotazioni_tavolo WHERE ambiente='stage' AND data=? AND stato='prenotato' ORDER BY turno").all(oggi);
  const campiOggiEl = await db.prepare(
    "SELECT pc.slot, c.nome AS campo, pc.nome FROM prenotazioni_campo pc JOIN campi c ON c.id=pc.campo_id WHERE pc.data=? AND pc.stato='prenotato' ORDER BY pc.slot"
  ).all(oggi).catch(() => []);

  res.json({
    oggi, ora,
    turni_garden: attesi,
    carta_oggi: cartaOggiEl,
    stage_oggi: stageOggiEl,
    campi_oggi: campiOggiEl,
    servizio: {
      comande_aperte: comandeAperte.length,
      in_ritardo: inRitardo,
      per_zona: ["garden", "bar", "cucina", "carta"].map((z) => ({ zona: z, n: comandeAperte.filter((c) => c.zona === z).length }))
    },
    giornata: {
      campi: Number(campiOggi?.n || 0),
      garden_coperti: Number(gardenOggi?.n || 0),
      carta_tavoli: Number(cartaOggi?.n || 0),
      stage_posti: Number(stageOggi?.n || 0),
      lezioni, proiezioni: proiezioniOggi, sala: salaOggi
    },
    attenzione,
    scorte: daRiordinare,
    scorte_negative: negativi,
    coppa: { partite_da_giocare: partiteDaGiocare },
    soci: await n("SELECT COUNT(*) n FROM soci WHERE attivo=1")
  });
});

// Riepilogo di un periodo: quello che un gestore chiede a fine stagione e che finora non
// esisteva da nessuna parte — si vedeva solo la giornata in corso.
adminRouter.get("/riepilogo", async (req, res) => {
  const da = String(req.query.da || "1970-01-01").slice(0, 10);
  const a = String(req.query.a || "2999-12-31").slice(0, 10);
  const uno = async (sql, ...p) => (await db.prepare(sql).get(...p)) || {};

  const com = await uno(
    // L'INCASSO E' QUELLO PAGATO. "Non annullata" includeva le comande chiuse per abbandono —
    // mai lavorate, mai pagate — e le gonfiava dentro il fatturato del periodo. Un riepilogo
    // che conta soldi mai entrati e' peggio di nessun riepilogo.
    "SELECT COUNT(*) n, COALESCE(SUM(totale),0) tot FROM comande WHERE stato='chiusa' AND (pagata_at IS NOT NULL OR metodo_pagamento IS NOT NULL) AND date(created_at) BETWEEN ? AND ?", da, a);
  const perZona = await db.prepare(
    "SELECT zona, COUNT(*) n, COALESCE(SUM(totale),0) tot FROM comande WHERE stato='chiusa' AND (pagata_at IS NOT NULL OR metodo_pagamento IS NOT NULL) AND date(created_at) BETWEEN ? AND ? GROUP BY zona").all(da, a);
  const pezzi = await uno(
    "SELECT COALESCE(SUM(r.qta),0) n FROM comanda_righe r JOIN comande c ON c.id=r.comanda_id WHERE c.stato<>'annullata' AND date(c.created_at) BETWEEN ? AND ?", da, a);
  const topArticoli = await db.prepare(
    `SELECT r.nome, SUM(r.qta) qta, COALESCE(SUM(r.qta*r.prezzo),0) valore
     FROM comanda_righe r JOIN comande c ON c.id=r.comanda_id
     WHERE c.stato<>'annullata' AND date(c.created_at) BETWEEN ? AND ?
     GROUP BY r.nome ORDER BY qta DESC LIMIT 15`).all(da, a);
  const garden = await uno("SELECT COUNT(*) n, COALESCE(SUM(persone),0) coperti FROM prenotazioni_tavolo WHERE ambiente='garden' AND stato='prenotato' AND data BETWEEN ? AND ?", da, a);
  const carta = await uno("SELECT COUNT(*) n FROM prenotazioni_tavolo WHERE ambiente='carta' AND stato='prenotato' AND data BETWEEN ? AND ?", da, a);
  const stage = await uno("SELECT COALESCE(SUM(persone),0) n FROM prenotazioni_tavolo WHERE ambiente='stage' AND stato='prenotato' AND data BETWEEN ? AND ?", da, a);
  const campi = await uno("SELECT COUNT(DISTINCT partita_id) n FROM prenotazioni_campo WHERE stato='prenotato' AND data BETWEEN ? AND ?", da, a);
  const perCampo = await db.prepare(
    `SELECT c.nome, COUNT(DISTINCT p.partita_id) n FROM prenotazioni_campo p JOIN campi c ON c.id=p.campo_id
     WHERE p.stato='prenotato' AND p.data BETWEEN ? AND ? GROUP BY c.nome ORDER BY n DESC`).all(da, a);
  const fit = await uno(
    `SELECT COUNT(*) iscrizioni, COALESCE(SUM(CASE WHEN p.pagato=1 THEN s.prezzo ELSE 0 END),0) incassato,
            COALESCE(SUM(CASE WHEN p.pagato=0 THEN s.prezzo ELSE 0 END),0) da_incassare
     FROM fitness_prenotazioni p JOIN fitness_sedute s ON s.id=p.seduta_id
     WHERE p.stato='prenotato' AND s.data BETWEEN ? AND ?`, da, a);
  const lezioni = await uno("SELECT COUNT(*) n FROM fitness_sedute WHERE stato='programmata' AND data BETWEEN ? AND ?", da, a);
  const serate = await uno(
    `SELECT COUNT(*) n, COALESCE(SUM(sp.persone),0) coperti, COALESCE(SUM(sp.importo),0) importo
     FROM serate_prenotazioni sp WHERE sp.stato<>'annullata'`);

  res.json({
    periodo: { da, a },
    ristorazione: { comande: Number(com.n || 0), incasso: Number(com.tot || 0), pezzi: Number(pezzi.n || 0), per_zona: perZona, piu_venduti: topArticoli },
    garden: { prenotazioni: Number(garden.n || 0), coperti: Number(garden.coperti || 0) },
    casa_di_carta: { tavoli: Number(carta.n || 0) },
    stage: { posti: Number(stage.n || 0) },
    campi: { prenotazioni: Number(campi.n || 0), per_campo: perCampo },
    fitness: { lezioni: Number(lezioni.n || 0), iscrizioni: Number(fit.iscrizioni || 0), incassato: Number(fit.incassato || 0), da_incassare: Number(fit.da_incassare || 0) },
    serate: { prenotazioni: Number(serate.n || 0), coperti: Number(serate.coperti || 0), importo: Number(serate.importo || 0) }
  });
});

// Legge una posizione da coordinate, link di Google Maps, Waze, Apple Maps o OpenStreetMap.
// Sta sul server perche' i link ACCORCIATI (maps.app.goo.gl, waze.com/ul) non contengono le
// coordinate e vanno seguiti: il browser non puo' farlo, il server si'.
adminRouter.post("/geo/risolvi", requireCap("guida"), async (req, res) => {
  const r = await risolviPosizione(req.body?.testo || "");
  if (r.errore) return res.status(422).json(r);
  res.json(r);
});

// Un socio dalla sua tessera: serve alla Crew dopo la scansione del QR, per scrivere sulla
// comanda il nome vero invece del codice.
adminRouter.get("/soci/tessera/:code", requireCap("comande"), async (req, res) => {
  const r = await db.prepare("SELECT id,nome,cognome,tessera_code,attivo FROM soci WHERE tessera_code=?").get(String(req.params.code).toUpperCase());
  if (!r) return res.status(404).json({ error: "Tessera non riconosciuta" });
  res.json(r);
});

// ===== CHAT DI CASATA · MODERAZIONE =========================================================
// Il gestore NON legge tutto: legge cio' che viene segnalato, piu' i messaggi immediatamente
// attorno, perche' una frase isolata spesso non si capisce. E' la differenza fra un controllo
// mirato e una sorveglianza continua, e va tenuta.
adminRouter.get("/chat/segnalati", requireCap("casate"), async (req, res) => {
  const segn = await db.prepare(
    "SELECT * FROM chat_messaggi WHERE segnalato=1 ORDER BY nascosto, id DESC LIMIT 40"
  ).all();
  const out = [];
  for (const m of segn) {
    const contesto = m.ambito === "capitani"
      ? await db.prepare("SELECT id,nome,testo,created_at FROM chat_messaggi WHERE ambito='capitani' AND id BETWEEN ? AND ? ORDER BY id").all(m.id - 3, m.id + 3)
      : await db.prepare("SELECT id,nome,testo,created_at FROM chat_messaggi WHERE ambito='casata' AND casata_id=? AND id BETWEEN ? AND ? ORDER BY id").all(m.casata_id, m.id - 3, m.id + 3);
    const c = m.casata_id ? await db.prepare("SELECT nome FROM casate WHERE id=?").get(m.casata_id) : null;
    out.push({ ...m, casata: c ? c.nome : "Capitani", contesto });
  }
  const totali = await db.prepare("SELECT COUNT(*) n FROM chat_messaggi").get();
  res.json({ segnalati: out, messaggi_totali: Number(totali?.n || 0) });
});

adminRouter.put("/chat/messaggi/:id", requireCap("casate"), async (req, res) => {
  const b = req.body || {};
  if (b.azione === "nascondi") {
    await db.prepare("UPDATE chat_messaggi SET nascosto=1, nascosto_da=? WHERE id=?").run(req.adminUser.username, req.params.id);
  } else if (b.azione === "ripristina") {
    await db.prepare("UPDATE chat_messaggi SET nascosto=0, segnalato=0, segnalato_da=NULL, motivo=NULL WHERE id=?").run(req.params.id);
  } else if (b.azione === "archivia") {
    await db.prepare("UPDATE chat_messaggi SET segnalato=0 WHERE id=?").run(req.params.id);
  } else return res.status(400).json({ error: "Azione non valida" });
  audit(req.adminUser.username, "chat:" + b.azione, "chat_messaggi", req.params.id);
  res.json({ ok: true });
});

// A fine stagione la chat si svuota: sono conversazioni di servizio, non un archivio.
adminRouter.post("/chat/svuota", requireCap("casate"), async (req, res) => {
  const r = await db.prepare("DELETE FROM chat_messaggi WHERE created_at < ?").run(String(req.body?.prima_del || "").slice(0, 10) || "1970-01-01");
  audit(req.adminUser.username, "chat_svuota", "chat_messaggi", 0, String(req.body?.prima_del || ""));
  res.json({ ok: true });
});

// ===== CONFRONTO TEORICO / REALE ============================================================
// Il numero teorico non serve a scaricare: serve a essere smentito. Si mette accanto a quello
// che e' stato contato davvero e si guarda la differenza. Se il caffe' teorico dice tre chili
// e ne mancano quattro, quel chilo ha un nome — sfrido, omaggi, sprechi, o qualcosa che esce
// dalla porta. Non serve che il teorico sia esatto: serve che sia sempre calcolato allo stesso
// modo, perche' e' lo SCOSTAMENTO a parlare, non il valore assoluto.
adminRouter.get("/magazzino/confronto", requireCap("magazzino"), async (req, res) => {
  const da = String(req.query.da || "").slice(0, 10) || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const a = String(req.query.a || "").slice(0, 10) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);

  const articoli = await db.prepare(
    "SELECT id,nome,unita,tipo_consumo,sfrido_pct,giacenza FROM magazzino_articoli WHERE tipo_consumo='peso' ORDER BY nome"
  ).all();
  const righe = [];
  for (const art of articoli) {
    const t = await db.prepare("SELECT COALESCE(SUM(quantita),0) q FROM consumo_teorico WHERE articolo_id=? AND data BETWEEN ? AND ?").get(art.id, da, a);
    const teorico = Number(t?.q || 0);
    // Il consumo reale si ricava dai movimenti: quanto e' stato scaricato o rettificato in meno.
    const m = await db.prepare(
      "SELECT COALESCE(SUM(quantita),0) q FROM magazzino_movimenti WHERE articolo_id=? AND tipo='scarico' AND date(created_at) BETWEEN ? AND ?"
    ).get(art.id, da, a).catch(() => ({ q: 0 }));
    const reale = Number(m?.q || 0);
    if (teorico === 0 && reale === 0) continue;
    const scarto = reale - teorico;
    righe.push({
      id: art.id, nome: art.nome, unita: art.unita,
      teorico: Number(teorico.toFixed(2)),
      reale: Number(reale.toFixed(2)),
      scarto: Number(scarto.toFixed(2)),
      scarto_pct: teorico > 0 ? Number((scarto / teorico * 100).toFixed(1)) : null,
      sfrido_pct: art.sfrido_pct
    });
  }
  righe.sort((x, y) => Math.abs(y.scarto_pct || 0) - Math.abs(x.scarto_pct || 0));
  res.json({
    da, a, righe,
    nota: "Il teorico e' calcolato dalle vendite secondo la distinta, con lo sfrido dichiarato. Il reale viene dagli scarichi e dalle rettifiche. Conta lo scostamento, non il valore assoluto: uno scarto stabile e' normale, uno che cambia all'improvviso va guardato."
  });
});

// Distinta di una voce di menu': quali articoli consuma e in che quantita'.
adminRouter.get("/menu/:id/distinta", requireCap("magazzino"), async (req, res) => {
  const righe = await db.prepare(
    `SELECT d.id, d.articolo_id, d.quantita, a.nome, a.unita, a.tipo_consumo
     FROM menu_distinta d JOIN magazzino_articoli a ON a.id=d.articolo_id
     WHERE d.menu_id=? ORDER BY a.nome`
  ).all(req.params.id);
  const articoli = await db.prepare("SELECT id,nome,unita,tipo_consumo FROM magazzino_articoli ORDER BY nome").all();
  res.json({ righe, articoli });
});
adminRouter.put("/menu/:id/distinta", requireCap("magazzino"), async (req, res) => {
  const voci = Array.isArray(req.body?.voci) ? req.body.voci : [];
  await db.prepare("DELETE FROM menu_distinta WHERE menu_id=?").run(req.params.id);
  for (const v of voci) {
    const q = Number(v.quantita);
    if (!v.articolo_id || !(q > 0)) continue;
    await db.prepare("INSERT OR REPLACE INTO menu_distinta (menu_id,articolo_id,quantita) VALUES (?,?,?)")
      .run(req.params.id, Number(v.articolo_id), q);
  }
  audit(req.adminUser.username, "distinta", "menu_articoli", req.params.id, `${voci.length} ingredienti`);
  res.json({ ok: true });
});

export { adminRouter };

import { Router as Router3 } from "express";
import { asyncify } from '../asyncroute.js';
import { createUserSession, genOtp, getUserSession } from '../auth.js';
import { encryptJSON, tryDecryptJSON } from '../crypto.js';
import { audit, db, insertSocioUnique, url } from '../db.js';
import { pushEnabled, removeSubscription, saveSubscription, sendToSoci } from '../push.js';
import { inviaBenvenuto, inviaCodice, mailAttiva } from '../mail.js';

var authUserRouter = asyncify(Router3());
var DEV = (process.env.KOINE_ENV || "dev") !== "prod";

// L'eta' del socio, dalla data di nascita gia' presente in anagrafica: accende da sola la
// modalita' semplice e ricorda allo Stage il diritto alla prima fila.
function etaDa(dataNascita) {
  if (!dataNascita) return null;
  const n = new Date(String(dataNascita).slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(n.getTime())) return null;
  return Math.floor((Date.now() - n.getTime()) / (365.25 * 864e5));
}
async function requireUser(req, res, next) {
  const token = (req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const u = await getUserSession(token);
  if (!u) return res.status(401).json({ error: "Accesso richiesto" });
  req.user = u;
  next();
}
var OTP_MINUTI = 10;
var OTP_MAX_RICHIESTE = 3;        // per indirizzo, nella finestra qui sotto
var OTP_FINESTRA_MIN = 15;
var OTP_MAX_TENTATIVI = 5;        // quante volte si puo' sbagliare un codice prima di bruciarlo

authUserRouter.post("/request-otp", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "E-mail non valida" });

  // Un codice a sei cifre spedito a comando e' anche un modo per riempire la casella di
  // qualcun altro. Tre richieste per indirizzo ogni quarto d'ora bastano a chi ha davvero
  // perso il codice e non bastano a chi vuole dare fastidio.
  const daQuando = Date.now() - OTP_FINESTRA_MIN * 60 * 1e3;
  const recenti = await db.prepare("SELECT COUNT(*) n FROM otp WHERE email=? AND exp > ?").get(email, daQuando);
  if (Number(recenti?.n || 0) >= OTP_MAX_RICHIESTE) {
    audit(email, "otp_troppe_richieste", "otp", "");
    return res.status(429).json({ error: `Hai gi\u00e0 chiesto il codice pi\u00f9 volte: aspetta qualche minuto e riprova. Controlla anche la posta indesiderata.` });
  }

  const socio = await db.prepare("SELECT id,nome FROM soci WHERE lower(email)=? AND attivo=1").get(email);
  const code = genOtp();
  const exp = Date.now() + OTP_MINUTI * 60 * 1e3;
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();

  // Il codice si manda SOLO a chi ha davvero un profilo. Ma la risposta e' la stessa in ogni
  // caso: dire "questa e-mail non esiste" regalerebbe a chiunque l'elenco di chi e' iscritto.
  let esito = { inviata: false, motivo: "e-mail non registrata" };
  if (socio) esito = await inviaCodice(email, code, OTP_MINUTI);

  await db.prepare("INSERT INTO otp (email,code,exp,ip,inviata,creato_at) VALUES (?,?,?,?,?,?)")
    .run(email, code, exp, ip || null, esito.inviata ? 1 : 0, new Date().toISOString());
  audit(email, "otp_richiesto", "otp", "", socio ? (esito.inviata ? "inviata" : "NON inviata: " + esito.motivo) : "email sconosciuta");

  res.json({
    ok: true,
    // Sempre lo stesso messaggio: chi guarda non deve capire se l'indirizzo esiste.
    messaggio: `Se questo indirizzo \u00e8 registrato, il codice \u00e8 in arrivo. Vale ${OTP_MINUTI} minuti.`,
    // Il codice in chiaro solo quando la posta non e' configurata: senza, in sviluppo non si
    // entrerebbe piu'. In produzione con la posta accesa non esce mai.
    ...(!mailAttiva() && DEV ? { dev_code: code, dev_note: "Posta non configurata: codice mostrato solo in sviluppo." } : {})
  });
});
authUserRouter.post("/login-tessera", async (req, res) => {
  const code = String(req.body?.tessera_code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Codice tessera mancante" });
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(code);
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const token = await createUserSession(socio);
  audit(socio.tessera_code, "login_tessera", "soci", socio.id);
  const casata = await db.prepare("SELECT nome,colore FROM casate WHERE id=?").get(socio.casata_id) || {};
  res.json({ token, socio: { tessera_code: socio.tessera_code, nome: socio.nome, cognome: socio.cognome, ruolo: socio.ruolo, tipo_profilo: socio.tipo_profilo, casata: casata.nome, casata_id: socio.casata_id, colore: casata.colore, eta: etaDa(socio.data_nascita), notifiche_push: !!socio.notifiche_push } });
});
authUserRouter.post("/verify-otp", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();

  // Sei cifre sono un milione di combinazioni: senza un limite ai tentativi, si indovinano.
  // Il conteggio sta sull'ULTIMO codice chiesto, che e' quello che l'utente ha in mano.
  const ultimo = await db.prepare("SELECT * FROM otp WHERE email=? AND used=0 ORDER BY id DESC").get(email);
  if (ultimo && Number(ultimo.tentativi || 0) >= OTP_MAX_TENTATIVI) {
    await db.prepare("UPDATE otp SET used=1 WHERE id=?").run(ultimo.id);
    audit(email, "otp_bruciato", "otp", String(ultimo.id), "troppi tentativi");
    return res.status(429).json({ error: "Troppi tentativi sbagliati: questo codice non vale pi\u00f9. Chiedine un altro." });
  }

  const row = await db.prepare("SELECT * FROM otp WHERE email=? AND code=? AND used=0 ORDER BY id DESC").get(email, code);
  if (!row || Date.now() > row.exp) {
    if (ultimo) await db.prepare("UPDATE otp SET tentativi=tentativi+1 WHERE id=?").run(ultimo.id);
    return res.status(401).json({ error: "Codice non valido o scaduto" });
  }
  await db.prepare("UPDATE otp SET used=1 WHERE id=?").run(row.id);
  const socio = await db.prepare("SELECT * FROM soci WHERE lower(email)=? AND attivo=1").get(email);
  if (!socio) return res.status(404).json({ error: "Nessun profilo associato a questa e-mail" });
  // Chi entra col codice ha dimostrato di leggere quella casella: l'indirizzo e' verificato.
  if (Number(socio.email_verificata) !== 1) {
    await db.prepare("UPDATE soci SET email_verificata=1 WHERE id=?").run(socio.id);
  }
  const token = await createUserSession(socio);
  audit(socio.tessera_code, "login_utente", "soci", socio.id);
  const casata = await db.prepare("SELECT nome,colore FROM casate WHERE id=?").get(socio.casata_id) || {};
  res.json({ token, socio: { tessera_code: socio.tessera_code, nome: socio.nome, cognome: socio.cognome, ruolo: socio.ruolo, tipo_profilo: socio.tipo_profilo, casata: casata.nome, casata_id: socio.casata_id, colore: casata.colore, eta: etaDa(socio.data_nascita), notifiche_push: !!socio.notifiche_push } });
});
authUserRouter.post("/registrazione", async (req, res) => {
  const b = req.body || {};
  const tipiOk = ["socio", "residente", "socio_residente", "ospite_temporaneo"];
  const tipo = tipiOk.includes(b.tipo_profilo) ? b.tipo_profilo : "socio";
  const nome = String(b.nome || "").trim(), cognome = String(b.cognome || "").trim();
  if (!nome || !cognome) return res.status(400).json({ error: "Nome e cognome obbligatori" });
  if (!b.consenso_privacy) return res.status(400).json({ error: "Il consenso privacy \xE8 necessario per registrarsi" });
  const email = b.email ? String(b.email).trim().toLowerCase() : null;
  if (email) {
    const dup = await db.prepare("SELECT id FROM soci WHERE lower(email)=?").get(email);
    if (dup) return res.status(409).json({ error: "Questa e-mail \xE8 gi\xE0 registrata: accedi con e-mail." });
  }
  const ruolo = tipo === "ospite_temporaneo" ? "non_socio" : "socio";
  const lingua = ["it", "en", "fr", "de", "es"].includes(b.lingua) ? b.lingua : "it";
  try {
    const cols = ["tessera_code", "nome", "cognome", "email", "ruolo", "tipo_profilo", "lingua", "consenso_privacy", "consenso_marketing", "soggiorno_dal", "soggiorno_al", "attivo"];
    const vals = [
      "",
      nome,
      cognome,
      email,
      ruolo,
      tipo,
      lingua,
      1,
      b.consenso_marketing ? 1 : 0,
      tipo === "ospite_temporaneo" ? b.soggiorno_dal || null : null,
      tipo === "ospite_temporaneo" ? b.soggiorno_al || null : null,
      1
    ];
    const { id, tessera_code } = await insertSocioUnique(cols, vals);
    const socio = await db.prepare("SELECT * FROM soci WHERE id=?").get(id);
    const token = await createUserSession(socio);
    audit(tessera_code, "auto_registrazione", "soci", id, tipo);
    // La tessera arriva per posta: e' il numero che serve per prenotare un campo o iscriversi
    // a una lezione, e nessuno se lo ricorda a memoria dopo aver chiuso la schermata.
    const posta = email ? await inviaBenvenuto(email, { nome, tessera: tessera_code }) : { inviata: false };
    res.status(201).json({
      token,
      socio: { tessera_code, nome, cognome, ruolo, tipo_profilo: tipo, notifiche_push: false },
      email_inviata: !!posta.inviata
    });
  } catch (e) {
    console.error("registrazione:", e?.message || e);
    res.status(400).json({ error: "Registrazione non riuscita" });
  }
});
var CAP_SOCI_CASATA = 12;
async function contaSoci(casataId) {
  return (await db.prepare("SELECT COUNT(*) n FROM soci WHERE casata_id=? AND tipo_profilo!='ospite_temporaneo' AND attivo=1").get(casataId)).n;
}
authUserRouter.get("/casate", requireUser, async (req, res) => {
  const me = await meSocio(req);
  const rows = await db.prepare("SELECT id,nome,colore,motto,punti FROM casate ORDER BY nome").all();
  const casate = [];
  for (const c of rows) {
    const n = await contaSoci(c.id);
    casate.push({ id: c.id, nome: c.nome, colore: c.colore, motto: c.motto, punti: c.punti, soci: n, capienza: CAP_SOCI_CASATA, pieno: n >= CAP_SOCI_CASATA, mia: !!(me && me.casata_id === c.id) });
  }
  res.json({ casate, mia: me ? me.casata_id : null, capienza: CAP_SOCI_CASATA });
});
authUserRouter.post("/scegli-casata", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!me) return res.status(404).json({ error: "Profilo non trovato" });
  if (!["socio", "socio_residente"].includes(me.tipo_profilo)) return res.status(403).json({ error: "Solo i soci scelgono una casata" });
  const cid = Number(req.body?.casata_id);
  const c = await db.prepare("SELECT id,nome FROM casate WHERE id=?").get(cid);
  if (!c) return res.status(404).json({ error: "Casata non trovata" });
  if (me.casata_id !== cid) {
    const n = await contaSoci(cid);
    if (n >= CAP_SOCI_CASATA) return res.status(409).json({ error: `Casata ${c.nome} al completo (${CAP_SOCI_CASATA} soci): scegline un'altra.` });
  }
  await db.prepare("UPDATE soci SET casata_id=? WHERE id=?").run(cid, me.id);
  audit(me.tessera_code, "scegli_casata", "soci", me.id, c.nome);
  res.json({ ok: true, casata: c.nome });
});
// DIVENTARE HOST e' una scelta, non una conseguenza del tipo di profilo. Prima la sezione
// "Le mie case" compariva a chiunque fosse residente, anche a chi non aveva mai chiesto di
// gestire case vacanza: e con quella sezione arrivava la responsabilita' dei dati dei propri
// ospiti, che e' una cosa seria e non un di piu'.
//
// Si attiva da qui, e si puo' spegnere — ma non finche' ci sono case collegate: spegnere e
// lasciare le strutture in giro sarebbe peggio che tenerlo acceso.
authUserRouter.post("/host", requireUser, async (req, res) => {
  const socio = await db.prepare("SELECT * FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  if (!socio) return res.status(404).json({ error: "Socio non trovato" });
  const vuole = req.body?.attivo !== false;
  if (!["residente", "socio_residente"].includes(String(socio.tipo_profilo)) && vuole) {
    return res.status(403).json({ error: "Le case vacanza le gestisce chi vive nel residence." });
  }
  if (!vuole) {
    const quante = await db.prepare("SELECT COUNT(*) n FROM strutture WHERE socio_id=? AND attivo=1").get(socio.id);
    if (Number(quante?.n || 0) > 0) {
      return res.status(409).json({ error: `Hai ancora ${quante.n} ${Number(quante.n) === 1 ? "casa collegata" : "case collegate"}: toglile prima di disattivare la gestione.` });
    }
  }
  await db.prepare("UPDATE soci SET host=? WHERE id=?").run(vuole ? 1 : 0, socio.id);
  audit(socio.tessera_code, vuole ? "attiva_host" : "disattiva_host", "soci", socio.id);
  res.json({ ok: true, is_host: vuole ? 1 : 0 });
});

authUserRouter.post("/notifiche/consenso", requireUser, async (req, res) => {
  const on = req.body?.attivo ? 1 : 0;
  await db.prepare("UPDATE soci SET notifiche_push=? WHERE tessera_code=?").run(on, req.user.tessera_code);
  audit(req.user.tessera_code, "consenso_notifiche", "soci", "", on ? "attivo" : "disattivo");
  res.json({ ok: true, attivo: !!on });
});
authUserRouter.post("/push/subscribe", requireUser, async (req, res) => {
  const me = await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  if (!me) return res.status(404).json({ error: "Profilo non trovato" });
  const ok = await saveSubscription(me.id, req.body?.subscription || req.body);
  if (ok) await db.prepare("UPDATE soci SET notifiche_push=1 WHERE id=?").run(me.id);
  res.json({ ok, enabled: pushEnabled() });
});
authUserRouter.post("/push/unsubscribe", requireUser, async (req, res) => {
  await removeSubscription(req.body?.endpoint);
  res.json({ ok: true });
});
authUserRouter.post("/convoca", requireUser, async (req, res) => {
  const me = await db.prepare("SELECT id, casata_id, ruolo FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  if (!me || me.ruolo !== "capitano") return res.status(403).json({ error: "Riservato ai capitani" });
  if (!me.casata_id) return res.status(400).json({ error: "Nessuna casata associata" });
  const { dominio, disciplina_chiave, match_label, quando, luogo } = req.body || {};
  const disc = await db.prepare("SELECT id FROM discipline WHERE chiave=? AND dominio=?").get(disciplina_chiave, dominio === "giochi" ? "giochi" : "sport");
  if (!disc) return res.status(400).json({ error: "Disciplina non trovata" });
  const soci = await db.prepare("SELECT id,notifiche_push FROM soci WHERE casata_id=? AND attivo=1").all(me.casata_id);
  const ins = db.prepare("INSERT INTO convocazioni (socio_id,disciplina_id,match_label,quando,luogo) VALUES (?,?,?,?,?)");
  const insN = db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)");
  let notificati = 0;
  const pushIds = [];
  const corpo = `${match_label || ""} \xB7 ${quando || ""} ${luogo || ""}`.trim();
  for (const s of soci) {
    await ins.run(s.id, disc.id, match_label ?? "", quando ?? "", luogo ?? "");
    if (s.notifiche_push) {
      await insN.run(s.id, "push", "casata", "La tua casata ti convoca", corpo);
      notificati++;
      pushIds.push(s.id);
    }
  }
  try {
    await sendToSoci(pushIds, { title: "La tua casata ti convoca", body: corpo, url: "/", tag: "convocazione" });
  } catch (_) {
  }
  audit(req.user.tessera_code, "convoca_capitano", "convocazioni", me.casata_id, `${soci.length} soci`);
  res.status(201).json({ ok: true, convocati: soci.length, notificati });
});
authUserRouter.get("/capitano/partite", requireUser, async (req, res) => {
  const me = await db.prepare("SELECT id,casata_id,ruolo FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  if (!me || me.ruolo !== "capitano") return res.status(403).json({ error: "Riservato ai capitani" });
  const cas = me.casata_id;
  const partite = await db.prepare(`SELECT p.id, p.giornata, p.casata_a_id, p.casata_b_id, p.casa_a, p.casa_b,
      d.id disc_id, d.nome disciplina, d.dominio, d.min_giocatori minimo, d.max_giocatori massimo
    FROM partite p JOIN discipline d ON d.id=p.disciplina_id
    WHERE p.stato='da_giocare' AND d.attivo=1 AND (p.casata_a_id=? OR p.casata_b_id=?)
    ORDER BY d.dominio, d.ordine, p.giornata, p.id`).all(cas, cas);
  const membri = await db.prepare("SELECT id,nome,cognome FROM soci WHERE casata_id=? AND attivo=1 ORDER BY nome").all(cas);
  const out = [];
  for (const p of partite) {
    const conv = await db.prepare("SELECT socio_id,stato FROM convocazioni WHERE partita_id=? AND socio_id IN (SELECT id FROM soci WHERE casata_id=?)").all(p.id, cas);
    const byS = {};
    conv.forEach((c) => byS[c.socio_id] = c.stato);
    out.push({
      partita_id: p.id,
      disciplina: p.disciplina,
      dominio: p.dominio,
      giornata: p.giornata,
      avversario: p.casata_a_id === cas ? p.casa_b : p.casa_a,
      minimo: p.minimo,
      massimo: p.massimo,
      disponibili: conv.filter((c) => c.stato === "disponibile").length,
      convocati: conv.length,
      membri: membri.map((m) => ({ id: m.id, nome: `${m.nome} ${m.cognome}`.trim(), stato: byS[m.id] || "non_convocato" }))
    });
  }
  res.json(out);
});
authUserRouter.post("/capitano/convoca-mirata", requireUser, async (req, res) => {
  const me = await db.prepare("SELECT id,casata_id,ruolo FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  if (!me || me.ruolo !== "capitano") return res.status(403).json({ error: "Riservato ai capitani" });
  const { partita_id, socio_ids } = req.body || {};
  const p = await db.prepare("SELECT p.*, d.nome disc, d.id disc_id FROM partite p JOIN discipline d ON d.id=p.disciplina_id WHERE p.id=?").get(partita_id);
  if (!p) return res.status(400).json({ error: "Partita inesistente" });
  if (p.casata_a_id !== me.casata_id && p.casata_b_id !== me.casata_id) return res.status(403).json({ error: "Partita non della tua casata" });
  const label = `${p.casa_a} vs ${p.casa_b} \xB7 G${p.giornata}`;
  const ids = (Array.isArray(socio_ids) ? socio_ids : []).map(Number);
  const insC = db.prepare("INSERT INTO convocazioni (socio_id,disciplina_id,partita_id,match_label,quando,luogo,stato) VALUES (?,?,?,?,?,?, 'aperta')");
  const insN = db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)");
  let n = 0;
  const pushIds = [];
  for (const sid of ids) {
    const s = await db.prepare("SELECT id,notifiche_push FROM soci WHERE id=? AND casata_id=? AND attivo=1").get(sid, me.casata_id);
    if (!s) continue;
    if (await db.prepare("SELECT id FROM convocazioni WHERE partita_id=? AND socio_id=?").get(partita_id, sid)) continue;
    await insC.run(sid, p.disc_id, partita_id, label, "", "");
    if (s.notifiche_push) {
      await insN.run(sid, "push", "casata", "Convocazione \xB7 " + p.disc, label);
      pushIds.push(sid);
    }
    n++;
  }
  try {
    await sendToSoci(pushIds, { title: "Convocazione \xB7 " + p.disc, body: label, url: "/", tag: "convocazione" });
  } catch (_) {
  }
  audit(req.user.tessera_code, "convoca_mirata", "partite", partita_id, `${n} convocati`);
  res.status(201).json({ ok: true, convocati: n });
});
// Un avviso letto si toglie. Prima restava li' per sempre: l'unico modo per non vederlo era
// non aprire la tessera, e una notifica che non si puo' archiviare smette di essere un avviso
// e diventa arredamento.
authUserRouter.delete("/notifiche/:id", requireUser, async (req, res) => {
  const socio = await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  if (!socio) return res.status(404).json({ error: "Socio non trovato" });
  const n = await db.prepare("SELECT * FROM notifiche WHERE id=? AND socio_id=?").get(req.params.id, socio.id);
  if (!n) return res.status(404).json({ error: "Avviso non trovato" });
  await db.prepare("DELETE FROM notifiche WHERE id=?").run(n.id);
  res.json({ ok: true });
});

authUserRouter.get("/notifiche", requireUser, async (req, res) => {
  const socio = await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  const rows = socio ? await db.prepare("SELECT id,tipo,titolo,corpo,letta,created_at FROM notifiche WHERE socio_id=? ORDER BY created_at DESC LIMIT 50").all(socio.id) : [];
  res.json(rows);
});
var HOST_FIELDS2 = ["nome", "cir", "cin", "regole", "isolato", "numero", "check_out", "lat", "lng"];
function pickStruttura2(b) {
  const o = {};
  for (const k of HOST_FIELDS2) o[k] = b[k] ?? "";
  if (o.lat !== "") o.lat = Number(o.lat);
  if (o.lng !== "") o.lng = Number(o.lng);
  return o;
}
async function meSocio(req) {
  return db.prepare("SELECT * FROM soci WHERE id=? AND attivo=1").get(req.user.id);
}
function canHost(me) {
  return !!me && (me.host === 1 || ["residente", "socio_residente"].includes(me.tipo_profilo));
}
authUserRouter.get("/host/strutture", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const rows = await db.prepare("SELECT id,dati_cifrati,attivo FROM strutture WHERE socio_id=? ORDER BY id").all(me.id);
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
    await db.prepare("UPDATE soci SET host_ko=1 WHERE id=?").run(me.id);
    audit(me.tessera_code, "host_KO", "strutture", me.id, "integrit\xE0 non verificabile");
  }
  res.json({ host: me.host ? 1 : 0, max: 3, host_ko: ko ? 1 : me.host_ko, strutture });
});
authUserRouter.post("/host/strutture", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const n = (await db.prepare("SELECT COUNT(*) n FROM strutture WHERE socio_id=?").get(me.id)).n;
  if (n >= 3) return res.status(409).json({ error: "Massimo 3 strutture per host" });
  const b = req.body || {};
  if (!String(b.nome || "").trim()) return res.status(400).json({ error: "Il nome della struttura \xE8 obbligatorio" });
  const info = await db.prepare("INSERT INTO strutture (socio_id,dati_cifrati,attivo) VALUES (?,?,1)").run(me.id, encryptJSON(pickStruttura2(b)));
  if (!me.host) await db.prepare("UPDATE soci SET host=1 WHERE id=?").run(me.id);
  audit(me.tessera_code, "host_crea_struttura", "strutture", info.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
authUserRouter.put("/host/strutture/:id", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const st = await db.prepare("SELECT id FROM strutture WHERE id=? AND socio_id=?").get(req.params.id, me.id);
  if (!st) return res.status(404).json({ error: "Struttura non trovata" });
  const b = req.body || {};
  await db.prepare("UPDATE strutture SET dati_cifrati=?,attivo=? WHERE id=?").run(encryptJSON(pickStruttura2(b)), b.attivo === false ? 0 : 1, req.params.id);
  audit(me.tessera_code, "host_modifica_struttura", "strutture", req.params.id);
  res.json({ ok: true });
});
authUserRouter.delete("/host/strutture/:id", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const st = await db.prepare("SELECT id FROM strutture WHERE id=? AND socio_id=?").get(req.params.id, me.id);
  if (!st) return res.status(404).json({ error: "Struttura non trovata" });
  await db.prepare("UPDATE soci SET struttura_id=NULL WHERE struttura_id=?").run(req.params.id);
  await db.prepare("DELETE FROM strutture WHERE id=?").run(req.params.id);
  audit(me.tessera_code, "host_elimina_struttura", "strutture", req.params.id);
  res.json({ ok: true });
});
function oggiISO() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
async function sganciaScaduti() {
  await db.prepare("UPDATE soci SET struttura_id=NULL WHERE tipo_profilo='ospite_temporaneo' AND struttura_id IS NOT NULL AND soggiorno_al IS NOT NULL AND soggiorno_al < ?").run(oggiISO());
}
authUserRouter.get("/casa-mia", requireUser, async (req, res) => {
  await sganciaScaduti();
  const me = await meSocio(req);
  if (!me) return res.status(404).json({ error: "Profilo non trovato" });
  if (me.soggiorno_al && me.soggiorno_al < oggiISO()) return res.json({ collegato: false, terminato: true });
  if (!me.struttura_id) return res.json({ collegato: false });
  const st = await db.prepare("SELECT id,dati_cifrati FROM strutture WHERE id=? AND attivo=1").get(me.struttura_id);
  if (!st) return res.json({ collegato: false });
  const d = tryDecryptJSON(st.dati_cifrati);
  if (!d) {
    await db.prepare("UPDATE soci SET host_ko=1 WHERE id=?").run(me.id);
    audit(me.tessera_code, "host_KO_vista_ospite", "strutture", st.id, "integrit\xE0 non verificabile");
    return res.status(423).json({ ko: true, error: "Dati della struttura non disponibili" });
  }
  res.json({ collegato: true, struttura: { nome: d.nome, cir: d.cir, cin: d.cin, regole: d.regole, isolato: d.isolato, numero: d.numero, check_out: d.check_out, lat: d.lat, lng: d.lng }, soggiorno: { dal: me.soggiorno_dal, al: me.soggiorno_al } });
});
async function myStruttureIds(meId) {
  const rows = await db.prepare("SELECT id FROM strutture WHERE socio_id=? AND attivo=1 ORDER BY id").all(meId);
  return rows.map((r) => r.id);
}
function notifica(socioId, titolo, corpo) {
  return db.prepare("INSERT INTO notifiche (socio_id,canale,tipo,titolo,corpo) VALUES (?,?,?,?,?)").run(socioId, "push", "sistema", titolo, corpo || null);
}
authUserRouter.get("/hosts-cerca", requireUser, async (req, res) => {
  const q = "%" + String(req.query.q || "").trim().toLowerCase() + "%";
  if (String(req.query.q || "").trim().length < 2) return res.json({ hosts: [] });
  const rows = await db.prepare("SELECT id,nome,cognome FROM soci WHERE tipo_profilo IN ('residente','socio_residente') AND attivo=1 AND (lower(nome) LIKE ? OR lower(cognome) LIKE ? OR lower(nome||' '||cognome) LIKE ?) ORDER BY cognome,nome LIMIT 12").all(q, q, q);
  res.json({ hosts: rows });
});
authUserRouter.post("/aggancio/richiesta", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!me) return res.status(404).json({ error: "Profilo non trovato" });
  if (me.tipo_profilo !== "ospite_temporaneo") return res.status(403).json({ error: "Solo un visitatore pu\xF2 chiedere l'aggancio a una casa" });
  const hostId = Number(req.body?.host_id);
  const host = await db.prepare("SELECT id,nome,cognome FROM soci WHERE id=? AND tipo_profilo IN ('residente','socio_residente') AND attivo=1").get(hostId);
  if (!host) return res.status(404).json({ error: "Host non trovato" });
  const ex = await db.prepare("SELECT id FROM richieste_aggancio WHERE ospite_id=? AND stato='in_attesa'").get(me.id);
  if (ex) return res.status(409).json({ error: "Hai gi\xE0 una richiesta in attesa" });
  const info = await db.prepare("INSERT INTO richieste_aggancio (ospite_id,host_id,stato) VALUES (?,?,'in_attesa')").run(me.id, host.id);
  notifica(host.id, "Nuovo ospite da confermare \u{1F464}", `${me.nome} ${me.cognome} dice di essere tuo ospite: confermi l'aggancio alla casa?`);
  audit(me.tessera_code, "aggancio_richiesta", "richieste_aggancio", Number(info.lastInsertRowid), `host ${host.id}`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid), host: { nome: host.nome, cognome: host.cognome } });
});
authUserRouter.get("/aggancio/stato", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!me) return res.status(404).json({ error: "Profilo non trovato" });
  const r = await db.prepare("SELECT ra.id,ra.stato,ra.created_at,s.nome host_nome,s.cognome host_cognome FROM richieste_aggancio ra JOIN soci s ON s.id=ra.host_id WHERE ra.ospite_id=? ORDER BY ra.id DESC LIMIT 1").get(me.id);
  res.json({ richiesta: r || null, collegato: !!me.struttura_id });
});
authUserRouter.get("/host/richieste", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const rows = await db.prepare("SELECT ra.id,ra.ospite_id,ra.created_at,s.nome,s.cognome,s.soggiorno_dal,s.soggiorno_al FROM richieste_aggancio ra JOIN soci s ON s.id=ra.ospite_id WHERE ra.host_id=? AND ra.stato='in_attesa' ORDER BY ra.id DESC").all(me.id);
  res.json({ richieste: rows });
});
authUserRouter.post("/host/richieste/:id/approva", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const r = await db.prepare("SELECT * FROM richieste_aggancio WHERE id=? AND host_id=? AND stato='in_attesa'").get(req.params.id, me.id);
  if (!r) return res.status(404).json({ error: "Richiesta non trovata" });
  const ids = await myStruttureIds(me.id);
  if (!ids.length) return res.status(409).json({ error: `Aggiungi prima la tua casa in "Le mie case", poi conferma l'ospite.` });
  const sid = req.body?.struttura_id ? Number(req.body.struttura_id) : ids[0];
  if (!ids.includes(sid)) return res.status(403).json({ error: "Struttura non tua" });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.prepare("UPDATE richieste_aggancio SET stato='approvata',struttura_id=?,updated_at=? WHERE id=?").run(sid, now, r.id);
  await db.prepare("UPDATE soci SET struttura_id=? WHERE id=?").run(sid, r.ospite_id);
  notifica(r.ospite_id, "Casa confermata \u{1F3E1}", `${me.nome} ${me.cognome} ha confermato: ora vedi "Casa mia".`);
  audit(me.tessera_code, "aggancio_approva", "richieste_aggancio", r.id, `ospite ${r.ospite_id} \u2192 struttura ${sid}`);
  res.json({ ok: true });
});
authUserRouter.post("/host/richieste/:id/rifiuta", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const r = await db.prepare("SELECT * FROM richieste_aggancio WHERE id=? AND host_id=? AND stato='in_attesa'").get(req.params.id, me.id);
  if (!r) return res.status(404).json({ error: "Richiesta non trovata" });
  await db.prepare("UPDATE richieste_aggancio SET stato='rifiutata',updated_at=? WHERE id=?").run((/* @__PURE__ */ new Date()).toISOString(), r.id);
  audit(me.tessera_code, "aggancio_rifiuta", "richieste_aggancio", r.id, `ospite ${r.ospite_id}`);
  res.json({ ok: true });
});
authUserRouter.get("/host/ospiti", requireUser, async (req, res) => {
  await sganciaScaduti();
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const ids = await myStruttureIds(me.id);
  if (!ids.length) return res.json({ ospiti: [] });
  const ph = ids.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT id,nome,cognome,tessera_code,struttura_id,soggiorno_dal,soggiorno_al,attivo FROM soci WHERE tipo_profilo='ospite_temporaneo' AND struttura_id IN (${ph}) ORDER BY id DESC`).all(...ids);
  res.json({ ospiti: rows });
});
authUserRouter.post("/host/ospiti/:id/scollega", requireUser, async (req, res) => {
  const me = await meSocio(req);
  if (!canHost(me)) return res.status(403).json({ error: "Profilo non abilitato come host" });
  const ids = await myStruttureIds(me.id);
  const g = await db.prepare("SELECT id,struttura_id FROM soci WHERE id=? AND tipo_profilo='ospite_temporaneo'").get(req.params.id);
  if (!g || !ids.includes(g.struttura_id)) return res.status(404).json({ error: "Visitatore non trovato" });
  await db.prepare("UPDATE soci SET struttura_id=NULL WHERE id=?").run(g.id);
  audit(me.tessera_code, "aggancio_scollega", "soci", g.id);
  res.json({ ok: true });
});

// ---- CHAT DI CASATA ------------------------------------------------------------------------
// Regole, in ordine di importanza:
// 1. si legge e si scrive SOLO nella stanza della propria casata (il gruppo capitani solo se
//    si e' capitani): il rischio vero non e' l'intercettazione, e' che l'Ortigia legga la
//    strategia dell'Aretusa, e si risolve con il controllo di accesso;
// 2. solo testo, niente allegati e niente collegamenti;
// 3. la stanza NON e' privata, e la prima cosa che si legge entrando e' questa.
var CHAT_MAX = 500;

async function chiSono(req) {
  return await db.prepare("SELECT id,nome,cognome,ruolo,casata_id,tessera_code FROM soci WHERE tessera_code=? AND attivo=1").get(req.user.tessera_code);
}

authUserRouter.get("/chat/:ambito", requireUser, async (req, res) => {
  const me = await chiSono(req);
  if (!me) return res.status(403).json({ error: "Socio non trovato" });
  const ambito = req.params.ambito === "capitani" ? "capitani" : "casata";
  if (ambito === "capitani" && me.ruolo !== "capitano") return res.status(403).json({ error: "Il gruppo e\u0300 riservato ai capitani delle casate" });
  if (ambito === "casata" && !me.casata_id) return res.status(409).json({ error: "Non risulti in nessuna casata" });

  const dopo = Number(req.query.dopo) || 0;
  const righe = ambito === "capitani"
    ? await db.prepare("SELECT id,nome,testo,tessera_code,segnalato,created_at FROM chat_messaggi WHERE ambito='capitani' AND nascosto=0 AND id>? ORDER BY id DESC LIMIT 80").all(dopo)
    : await db.prepare("SELECT id,nome,testo,tessera_code,segnalato,created_at FROM chat_messaggi WHERE ambito='casata' AND casata_id=? AND nascosto=0 AND id>? ORDER BY id DESC LIMIT 80").all(me.casata_id, dopo);
  const casata = me.casata_id ? await db.prepare("SELECT nome,colore FROM casate WHERE id=?").get(me.casata_id) : null;
  res.json({
    ambito,
    casata: casata ? casata.nome : null,
    colore: casata ? casata.colore : null,
    capitano: me.ruolo === "capitano",
    io: me.tessera_code,
    avviso: "Questa chat non e\u0300 privata: i messaggi segnalati vengono letti dal gestore. Scrivi come se fossi in bacheca.",
    messaggi: righe.reverse()
  });
});

authUserRouter.post("/chat/:ambito", requireUser, async (req, res) => {
  const me = await chiSono(req);
  if (!me) return res.status(403).json({ error: "Socio non trovato" });
  const ambito = req.params.ambito === "capitani" ? "capitani" : "casata";
  if (ambito === "capitani" && me.ruolo !== "capitano") return res.status(403).json({ error: "Il gruppo e\u0300 riservato ai capitani" });
  if (ambito === "casata" && !me.casata_id) return res.status(409).json({ error: "Non risulti in nessuna casata" });

  // Solo testo: si tolgono i tag e si scoraggiano i collegamenti, che sono la via piu' comune
  // per portare altrove chi legge.
  let testo = String(req.body?.testo || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!testo) return res.status(400).json({ error: "Scrivi qualcosa" });
  if (testo.length > CHAT_MAX) testo = testo.slice(0, CHAT_MAX);
  if (/https?:\/\/|www\./i.test(testo)) return res.status(400).json({ error: "Niente collegamenti nella chat: qui si scrive solo testo." });

  const nome = (me.nome + " " + (me.cognome || "")).trim();
  const info = await db.prepare(
    "INSERT INTO chat_messaggi (ambito,casata_id,socio_id,tessera_code,nome,testo) VALUES (?,?,?,?,?,?)"
  ).run(ambito, ambito === "capitani" ? null : me.casata_id, me.id, me.tessera_code, nome, testo);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

// Segnalare e' il modo in cui la stanza si autoregola: chi segnala accende una luce, e da
// quel momento il gestore puo' leggere.
authUserRouter.post("/chat/messaggi/:id/segnala", requireUser, async (req, res) => {
  const me = await chiSono(req);
  const m = await db.prepare("SELECT * FROM chat_messaggi WHERE id=?").get(req.params.id);
  if (!me || !m) return res.status(404).json({ error: "Messaggio non trovato" });
  if (m.ambito === "casata" && m.casata_id !== me.casata_id) return res.status(403).json({ error: "Non e\u0300 la tua stanza" });
  await db.prepare("UPDATE chat_messaggi SET segnalato=1, segnalato_da=?, motivo=? WHERE id=?")
    .run(me.tessera_code, String(req.body?.motivo || "").slice(0, 200) || null, m.id);
  audit(me.tessera_code, "segnala_messaggio", "chat_messaggi", m.id, m.nome);
  res.json({ ok: true });
});


export { DEV, authUserRouter, notifica };

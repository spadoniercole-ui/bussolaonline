// build/entry.mjs
import express from "express";

// server/db.js
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
var TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.KOINE_DB_URL || "";
var AUTH = process.env.TURSO_AUTH_TOKEN || void 0;
var url;
var LOCAL_FILE = null;
if (TURSO_URL) {
  url = TURSO_URL;
} else {
  const raw = process.env.KOINE_DB || "data/koine.db";
  if (raw === ":memory:") {
    url = ":memory:";
  } else {
    LOCAL_FILE = resolve(process.cwd(), raw);
    mkdirSync(dirname(LOCAL_FILE), { recursive: true });
    url = "file:" + LOCAL_FILE;
  }
}
var IS_REMOTE = !!TURSO_URL;
var DB_PATH = TURSO_URL ? TURSO_URL : LOCAL_FILE || ":memory:";
var client = createClient(AUTH ? { url, authToken: AUTH } : { url });
var flat = (a) => a.map((v) => v === void 0 ? null : v);
var db = {
  prepare(sql) {
    return {
      get: async (...args) => (await client.execute({ sql, args: flat(args) })).rows[0],
      all: async (...args) => (await client.execute({ sql, args: flat(args) })).rows,
      run: async (...args) => {
        const r = await client.execute({ sql, args: flat(args) });
        return { lastInsertRowid: r.lastInsertRowid == null ? void 0 : Number(r.lastInsertRowid), changes: Number(r.rowsAffected || 0) };
      }
    };
  },
  async exec(sql) {
    await client.executeMultiple(sql);
  },
  get raw() {
    return client;
  }
};
function audit(utente, azione, entita, entita_id, dettaglio = "") {
  client.execute({
    sql: "INSERT INTO audit_log (utente, azione, entita, entita_id, dettaglio) VALUES (?,?,?,?,?)",
    args: [utente || "sistema", azione, entita || "", String(entita_id ?? ""), dettaglio]
  }).catch(() => {
  });
}
async function initSchema() {
  try {
    await client.execute("PRAGMA foreign_keys = ON");
  } catch (_) {
  }
  await db.exec(`
  CREATE TABLE IF NOT EXISTS casate (
    id         INTEGER PRIMARY KEY,
    nome       TEXT NOT NULL UNIQUE,
    colore     TEXT NOT NULL,
    motto      TEXT,
    punti      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS soci (
    id                 INTEGER PRIMARY KEY,
    tessera_code       TEXT NOT NULL UNIQUE,
    nome               TEXT NOT NULL,
    cognome            TEXT NOT NULL,
    email              TEXT,
    telefono           TEXT,
    data_nascita       TEXT,
    casata_id          INTEGER REFERENCES casate(id) ON DELETE SET NULL,
    ruolo              TEXT NOT NULL DEFAULT 'socio',      -- socio | capitano | staff
    tipo_profilo       TEXT NOT NULL DEFAULT 'socio',       -- socio | residente | ospite_temporaneo | genitore | under14
    tutore_id          INTEGER REFERENCES soci(id) ON DELETE CASCADE, -- per i profili under14
    soggiorno_dal      TEXT,                                -- ospite temporaneo: inizio soggiorno
    soggiorno_al       TEXT,                                -- ospite temporaneo: fine soggiorno
    lingua             TEXT NOT NULL DEFAULT 'it',
    consenso_privacy   INTEGER NOT NULL DEFAULT 0,          -- GDPR: base necessaria
    consenso_marketing INTEGER NOT NULL DEFAULT 0,          -- GDPR: opt-in separato
    consenso_foto      INTEGER NOT NULL DEFAULT 0,          -- immagini eventi
    notifiche_push     INTEGER NOT NULL DEFAULT 0,          -- consenso notifiche (casata/eventi)
    dinieghi           INTEGER NOT NULL DEFAULT 0,          -- rifiuti convocazione nella stagione
    attivo             INTEGER NOT NULL DEFAULT 1,
    valida_fino        TEXT,                                -- tessera annuale
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS eventi (
    id          INTEGER PRIMARY KEY,
    chiave      TEXT UNIQUE,
    giorno      TEXT NOT NULL,
    titolo      TEXT NOT NULL,
    ambiente    TEXT,
    colore      TEXT,
    sottotitolo TEXT,
    descrizione TEXT,
    cta         TEXT,
    azione      TEXT,                                       -- sheet-vinile | sheet-openmic | go-coppa | null
    tipo        TEXT NOT NULL DEFAULT 'serata',             -- serata | benvenuto | cinema
    data_ora    TEXT,
    capienza    INTEGER,
    attivo      INTEGER NOT NULL DEFAULT 1,
    ordine      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS risorse (
    id          INTEGER PRIMARY KEY,
    chiave      TEXT UNIQUE,
    nome        TEXT NOT NULL,
    tipo        TEXT NOT NULL,                              -- sport | coworking | tavolo | evento
    sottotitolo TEXT,
    slots       TEXT,                                       -- JSON array di turni
    nota        TEXT,
    attivo      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS prenotazioni (
    id          INTEGER PRIMARY KEY,
    socio_id    INTEGER REFERENCES soci(id) ON DELETE CASCADE,
    risorsa_id  INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
    risorsa_nome TEXT,
    giorno      TEXT,
    turno       TEXT,
    ospiti      INTEGER NOT NULL DEFAULT 0,
    stato       TEXT NOT NULL DEFAULT 'confermata',         -- confermata | annullata | lista_attesa
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discipline (
    id            INTEGER PRIMARY KEY,
    dominio       TEXT NOT NULL,                            -- sport | giochi
    chiave        TEXT NOT NULL,
    nome          TEXT NOT NULL,
    attivo        INTEGER NOT NULL DEFAULT 1,               -- 1 = in cartellone quest'anno
    min_giocatori INTEGER NOT NULL DEFAULT 1,               -- partecipanti minimi per casata/partita
    max_giocatori INTEGER NOT NULL DEFAULT 1,               -- partecipanti massimi
    punti_vitt    INTEGER NOT NULL DEFAULT 3,               -- punti vittoria (per la graduatoria)
    punti_par     INTEGER NOT NULL DEFAULT 1,               -- punti pareggio
    data_inizio   TEXT,                                     -- periodo di svolgimento (per il cartellone)
    data_fine     TEXT,
    stato         TEXT NOT NULL DEFAULT 'preparazione',     -- preparazione | in_corso | archiviato
    regolamento   TEXT,                                     -- regolamento visibile in app ai soci
    ordine        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(dominio, chiave)
  );

  -- Edizioni archiviate di una disciplina (Albo d'Oro): snapshot congelato a fine periodo.
  CREATE TABLE IF NOT EXISTS edizioni (
    id              INTEGER PRIMARY KEY,
    disciplina_id   INTEGER,
    disciplina_nome TEXT,
    dominio         TEXT,
    data_inizio     TEXT,
    data_fine       TEXT,
    vincitore       TEXT,
    classifica      TEXT,                                   -- JSON: graduatoria finale congelata
    archiviata_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Regolamenti generali visibili in app (Coppa, Contest, Proposte\u2026).
  CREATE TABLE IF NOT EXISTS regolamenti (
    id      INTEGER PRIMARY KEY,
    chiave  TEXT UNIQUE,
    titolo  TEXT NOT NULL,
    testo   TEXT,
    ordine  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gironi (
    id            INTEGER PRIMARY KEY,
    disciplina_id INTEGER REFERENCES discipline(id) ON DELETE CASCADE,
    nome          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS classifica (
    id         INTEGER PRIMARY KEY,
    girone_id  INTEGER REFERENCES gironi(id) ON DELETE CASCADE,
    casata_id  INTEGER REFERENCES casate(id) ON DELETE CASCADE,
    pg         INTEGER NOT NULL DEFAULT 0,
    v          INTEGER NOT NULL DEFAULT 0,
    p          INTEGER NOT NULL DEFAULT 0,                  -- pareggi
    gf         INTEGER NOT NULL DEFAULT 0,                  -- gol/punti fatti
    gs         INTEGER NOT NULL DEFAULT 0,                  -- gol/punti subiti
    pt         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS partite (
    id            INTEGER PRIMARY KEY,
    disciplina_id INTEGER REFERENCES discipline(id) ON DELETE CASCADE,
    girone_id     INTEGER REFERENCES gironi(id) ON DELETE CASCADE,
    fase          TEXT NOT NULL DEFAULT 'girone',           -- girone | semifinale | finale
    giornata      INTEGER,
    casata_a_id   INTEGER REFERENCES casate(id),
    casata_b_id   INTEGER REFERENCES casate(id),
    casa_a        TEXT NOT NULL,
    casa_b        TEXT NOT NULL,
    quando        TEXT,
    luogo         TEXT,
    gol_a         INTEGER,
    gol_b         INTEGER,
    punteggio     TEXT,
    stato         TEXT NOT NULL DEFAULT 'da_giocare'        -- da_giocare | giocata
  );

  CREATE TABLE IF NOT EXISTS convocazioni (
    id            INTEGER PRIMARY KEY,
    socio_id      INTEGER REFERENCES soci(id) ON DELETE CASCADE,
    disciplina_id INTEGER REFERENCES discipline(id) ON DELETE CASCADE,
    partita_id    INTEGER REFERENCES partite(id) ON DELETE CASCADE,   -- convocazione legata alla partita del calendario
    match_label   TEXT,
    quando        TEXT,
    luogo         TEXT,
    stato         TEXT NOT NULL DEFAULT 'aperta',           -- aperta | disponibile | non_disponibile | obbligatoria
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bussola (
    id        INTEGER PRIMARY KEY,
    sezione   TEXT NOT NULL,                                -- servizi | vedere | rifiuti | orari | lingua
    titolo    TEXT NOT NULL,
    dettaglio TEXT,
    distanza  TEXT,
    ordine    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS luoghi (
    id       INTEGER PRIMARY KEY,
    chiave   TEXT UNIQUE,                                  -- chiosco | isola | ...
    nome     TEXT NOT NULL,
    lat      REAL,
    lng      REAL,
    ordine   INTEGER NOT NULL DEFAULT 0
  );

  -- Rifiuti: legenda (tipo + colore) e calendario di conferimento per periodo (griglia colorata).
  CREATE TABLE IF NOT EXISTS rifiuti_tipi (
    id     INTEGER PRIMARY KEY,
    nome   TEXT NOT NULL,
    colore TEXT NOT NULL DEFAULT '#7A8790',
    ordine INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rifiuti_calendario (
    id          INTEGER PRIMARY KEY,
    periodo     TEXT NOT NULL UNIQUE,                      -- Estivo | Invernale | ...
    inizio_conf TEXT,                                      -- inizio conferimento (es. 18:30)
    fine_conf   TEXT,                                      -- fine conferimento (es. 21:30)
    ora_ritiro  TEXT,                                      -- ora ritiro (es. 22:00)
    giorni      TEXT,                                      -- JSON {lun,mar,mer,gio,ven,sab,dom} = nome tipo o ''
    ordine      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contest (
    id         INTEGER PRIMARY KEY,
    titolo     TEXT NOT NULL,                               -- es. "Il mio nome \xE8 Bond, James Bond"
    tipo       TEXT,                                        -- cocktail | karaoke | recitazione | sfilata | altro
    settimana  TEXT,                                        -- es. "25\u201331 agosto" (settimana della serata)
    brief      TEXT,                                        -- consegna a testo libero + supporti disponibili
    stato      TEXT NOT NULL DEFAULT 'annunciato',          -- annunciato | in_corso | concluso
    vincitore  TEXT,                                        -- casata vincitrice (impostata all'assegnazione)
    punti_scala TEXT,                                       -- JSON: punti per posizione della giuria [1\xB0,2\xB0,3\xB0,...]
    esito_assegnato INTEGER NOT NULL DEFAULT 0,             -- 1 = punti gi\xE0 versati in Coppa (non ripetibile)
    attivo     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Esito della Serata dei Clan: una riga per casata (posizione giuria + pezzi venduti + punti calcolati)
  CREATE TABLE IF NOT EXISTS contest_esiti (
    id            INTEGER PRIMARY KEY,
    contest_id    INTEGER REFERENCES contest(id) ON DELETE CASCADE,
    casata_id     INTEGER REFERENCES casate(id) ON DELETE CASCADE,
    posizione     INTEGER,                                  -- graduatoria di giuria (1 = primo)
    pezzi_venduti INTEGER NOT NULL DEFAULT 0,               -- vendite (per il bonus 4/2/1)
    punti         INTEGER NOT NULL DEFAULT 0,               -- punti totali calcolati (posizione + bonus vendite)
    UNIQUE(contest_id, casata_id)
  );

  -- Serate speciali a numero chiuso con quota (apertura, tema, Ferragosto, fine stagione).
  CREATE TABLE IF NOT EXISTS serate (
    id         INTEGER PRIMARY KEY,
    chiave     TEXT UNIQUE,
    titolo     TEXT NOT NULL,
    data       TEXT,                                        -- es. "2026-08-15"
    quando     TEXT,                                        -- etichetta leggibile es. "Ferragosto \xB7 15 ago \xB7 20:00"
    tema       TEXT,
    descrizione TEXT,
    quota      REAL NOT NULL DEFAULT 0,                     -- \u20AC a persona
    capienza   INTEGER NOT NULL DEFAULT 80,                 -- coperti disponibili
    attivo     INTEGER NOT NULL DEFAULT 1,
    ordine     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS serate_prenotazioni (
    id          INTEGER PRIMARY KEY,
    serata_id   INTEGER REFERENCES serate(id) ON DELETE CASCADE,
    socio_id    INTEGER REFERENCES soci(id) ON DELETE SET NULL,
    tessera_code TEXT,
    nome        TEXT,
    persone     INTEGER NOT NULL DEFAULT 1,
    importo     REAL NOT NULL DEFAULT 0,                    -- quota \xD7 persone (da saldare)
    stato       TEXT NOT NULL DEFAULT 'da_saldare',         -- da_saldare | saldata | annullata
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proposte (
    id         INTEGER PRIMARY KEY,
    socio_id   INTEGER REFERENCES soci(id) ON DELETE SET NULL,
    tipo       TEXT NOT NULL,                               -- vinile | openmic
    titolo     TEXT,
    dettaglio  TEXT,
    stato      TEXT NOT NULL DEFAULT 'ricevuta',            -- ricevuta | in_scaletta | scartata
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS utenti_admin (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,                            -- scrypt: salt:hash
    ruolo         TEXT NOT NULL DEFAULT 'gestore',          -- gestore | manager | staff | sola_lettura
    permessi      TEXT,                                     -- JSON: capacit\xE0 (flag) per lo staff
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otp (
    id         INTEGER PRIMARY KEY,
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    exp        INTEGER NOT NULL,                            -- epoch ms
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notifiche (
    id         INTEGER PRIMARY KEY,
    socio_id   INTEGER REFERENCES soci(id) ON DELETE CASCADE,
    canale     TEXT NOT NULL DEFAULT 'push',                -- push | email
    tipo       TEXT NOT NULL,                               -- casata | evento | sistema
    titolo     TEXT NOT NULL,
    corpo      TEXT,
    letta      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id       INTEGER PRIMARY KEY,
    utente   TEXT,
    azione   TEXT NOT NULL,
    entita   TEXT,
    entita_id TEXT,
    dettaglio TEXT,
    ts       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ====== CASA DI CARTA: coworking + caff\xE8 (magazzino capsule) + inventario giochi + check datati ======
  -- Magazzino capsule caff\xE8: riga unica di configurazione (giacenza corrente + punto di riordino).
  CREATE TABLE IF NOT EXISTS cdc_caffe (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    giacenza       INTEGER NOT NULL DEFAULT 0,             -- capsule attualmente in magazzino
    punto_riordino INTEGER NOT NULL DEFAULT 40,            -- soglia: sotto/uguale \u2192 riordinare
    confezione     INTEGER NOT NULL DEFAULT 100,           -- capsule per confezione d'ordine
    aggiornato_at  TEXT
  );
  -- Conte giornaliere (di norma alle 16:00, alla rimozione della macchinetta) per il trend di consumo.
  CREATE TABLE IF NOT EXISTS cdc_caffe_conte (
    id         INTEGER PRIMARY KEY,
    data       TEXT NOT NULL,                              -- YYYY-MM-DD
    ora        TEXT,                                       -- di norma 16:00
    giacenza   INTEGER NOT NULL,                           -- capsule contate
    consumo    INTEGER,                                    -- differenza rispetto alla conta precedente
    operatore  TEXT,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Inventario dei giochi a uso libero (senza tornei): mazzi, giochi da tavolo, scacchiere.
  CREATE TABLE IF NOT EXISTS cdc_giochi (
    id        INTEGER PRIMARY KEY,
    nome      TEXT NOT NULL,
    categoria TEXT,                                        -- carte | gioco_tavolo | scacchi | altro
    quantita  INTEGER NOT NULL DEFAULT 1,
    stato     TEXT NOT NULL DEFAULT 'ok',                  -- ok | mancante | danneggiato
    note      TEXT,
    ordine    INTEGER NOT NULL DEFAULT 0
  );
  -- Registro prelievi (modulo compilato dal giocatore: gioco, ora inizio, ora fine).
  CREATE TABLE IF NOT EXISTS cdc_prestiti (
    id         INTEGER PRIMARY KEY,
    gioco_id   INTEGER REFERENCES cdc_giochi(id) ON DELETE SET NULL,
    gioco_nome TEXT,
    giocatore  TEXT,
    data       TEXT,
    ora_inizio TEXT,
    ora_fine   TEXT,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Check datati (replica cartacea): magazzino caff\xE8 + stato strumenti + arredi, a ogni prelievo macchina.
  CREATE TABLE IF NOT EXISTS cdc_check (
    id             INTEGER PRIMARY KEY,
    data           TEXT NOT NULL,
    operatore      TEXT,
    caffe_giacenza INTEGER,
    strumenti_note TEXT,
    arredi_note    TEXT,
    esito          TEXT,                                   -- ok | anomalie
    foto           TEXT,                                   -- dataURL della scheda cartacea (facoltativa)
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Allegati fotografici generici (scheda check, punteggi partite/tornei) per evitare contestazioni.
  CREATE TABLE IF NOT EXISTS allegati (
    id         INTEGER PRIMARY KEY,
    entita     TEXT NOT NULL,                              -- partita | check | serata | ...
    entita_id  TEXT,
    immagine   TEXT NOT NULL,                              -- dataURL (jpeg ridotto lato client)
    nota       TEXT,
    autore     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ====== MAGAZZINO UNIFICATO: articoli per area + movimenti + alert anticipati ======
  -- Un unico inventario per tutte le aree (chiosco, casa_di_carta, serata_clan, serate_tema, \u2026).
  CREATE TABLE IF NOT EXISTS magazzino_articoli (
    id               INTEGER PRIMARY KEY,
    nome             TEXT NOT NULL,
    area             TEXT NOT NULL DEFAULT 'chiosco',        -- chiosco | casa_di_carta | serata_clan | serate_tema | ...
    unita            TEXT NOT NULL DEFAULT 'pz',             -- pz | kg | l | capsule | conf | ...
    giacenza         REAL NOT NULL DEFAULT 0,                -- quantit\xE0 attualmente in magazzino
    punto_riordino   REAL NOT NULL DEFAULT 0,                -- giacenza \u2264 questo \u2192 "da riordinare"
    soglia_preavviso REAL NOT NULL DEFAULT 0,                -- giacenza \u2264 questo (e > punto) \u2192 "in esaurimento" (alert anticipato)
    note             TEXT,
    ordine           INTEGER NOT NULL DEFAULT 0,
    aggiornato_at    TEXT
  );
  -- Movimenti di carico/scarico/rettifica: storico essenziale + tracciabilit\xE0.
  CREATE TABLE IF NOT EXISTS magazzino_movimenti (
    id          INTEGER PRIMARY KEY,
    articolo_id INTEGER REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,                               -- carico | scarico | rettifica
    quantita    REAL NOT NULL,                               -- sempre positiva; il segno lo d\xE0 "tipo"
    causale     TEXT,
    operatore   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_mag_area ON magazzino_articoli(area);
  CREATE INDEX IF NOT EXISTS ix_mag_mov ON magazzino_movimenti(articolo_id);

  -- ====== CHIOSCO: menu + comande (cassa/cameriere) + KDS per stazione ======
  CREATE TABLE IF NOT EXISTS menu_articoli (
    id            INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    prezzo        REAL NOT NULL DEFAULT 0,
    stazione      TEXT NOT NULL DEFAULT 'bar',              -- cucina | bar
    categoria     TEXT,                                     -- panini | bibite | birre | snack | ...
    magazzino_id  INTEGER REFERENCES magazzino_articoli(id) ON DELETE SET NULL, -- scarico automatico opzionale
    attivo        INTEGER NOT NULL DEFAULT 1,
    ordine        INTEGER NOT NULL DEFAULT 0
  );
  -- Testata comanda.
  CREATE TABLE IF NOT EXISTS comande (
    id          INTEGER PRIMARY KEY,
    numero      INTEGER,                                    -- progressivo giornaliero (comodo per chiamare)
    origine     TEXT NOT NULL DEFAULT 'chiosco',            -- tavolo | bancone | chiosco
    riferimento TEXT,                                       -- n\xB0 tavolo / nome cliente
    stato       TEXT NOT NULL DEFAULT 'aperta',             -- aperta | in_preparazione | pronta | consegnata | chiusa | annullata
    totale      REAL NOT NULL DEFAULT 0,
    operatore   TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT
  );
  -- Righe comanda (snapshot di nome/prezzo, cos\xEC lo storico non cambia se il menu cambia).
  CREATE TABLE IF NOT EXISTS comanda_righe (
    id          INTEGER PRIMARY KEY,
    comanda_id  INTEGER NOT NULL REFERENCES comande(id) ON DELETE CASCADE,
    menu_id     INTEGER REFERENCES menu_articoli(id) ON DELETE SET NULL,
    nome        TEXT NOT NULL,
    prezzo      REAL NOT NULL DEFAULT 0,
    qta         INTEGER NOT NULL DEFAULT 1,
    stazione    TEXT NOT NULL DEFAULT 'bar',
    note        TEXT,
    stato       TEXT NOT NULL DEFAULT 'in_coda',            -- in_coda | pronta | consegnata
    magazzino_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS ix_com_stato ON comande(stato);
  CREATE INDEX IF NOT EXISTS ix_comr_com ON comanda_righe(comanda_id);
  CREATE INDEX IF NOT EXISTS ix_comr_staz ON comanda_righe(stazione, stato);

  CREATE INDEX IF NOT EXISTS ix_soci_casata ON soci(casata_id);
  CREATE INDEX IF NOT EXISTS ix_cdc_conte ON cdc_caffe_conte(data);
  CREATE INDEX IF NOT EXISTS ix_cdc_prestiti ON cdc_prestiti(created_at);
  CREATE INDEX IF NOT EXISTS ix_allegati ON allegati(entita, entita_id);
  CREATE INDEX IF NOT EXISTS ix_pren_socio ON prenotazioni(socio_id);
  CREATE INDEX IF NOT EXISTS ix_conv_socio ON convocazioni(socio_id);
  CREATE INDEX IF NOT EXISTS ix_esiti_contest ON contest_esiti(contest_id);
  CREATE INDEX IF NOT EXISTS ix_serpren_serata ON serate_prenotazioni(serata_id);
  `);
  await migrate();
}
async function migrate() {
  const cols = async (t) => (await db.prepare(`PRAGMA table_info(${t})`).all()).map((c) => c.name);
  const addIfMissing = async (t, name, ddl) => {
    if (!(await cols(t)).includes(name)) {
      try {
        await db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`);
      } catch (_) {
      }
    }
  };
  await addIfMissing("contest", "punti_scala", "punti_scala TEXT");
  await addIfMissing("contest", "esito_assegnato", "esito_assegnato INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("soci", "soggiorno_dal", "soggiorno_dal TEXT");
  await addIfMissing("soci", "soggiorno_al", "soggiorno_al TEXT");
  await addIfMissing("utenti_admin", "permessi", "permessi TEXT");
  await addIfMissing("discipline", "data_inizio", "data_inizio TEXT");
  await addIfMissing("discipline", "data_fine", "data_fine TEXT");
  await addIfMissing("discipline", "stato", "stato TEXT NOT NULL DEFAULT 'preparazione'");
  await addIfMissing("discipline", "regolamento", "regolamento TEXT");
  try {
    await db.exec("UPDATE soci SET tipo_profilo='residente' WHERE tipo_profilo='visitatore'");
  } catch (_) {
  }
  try {
    await db.exec("INSERT OR IGNORE INTO cdc_caffe (id,giacenza,punto_riordino,confezione) VALUES (1,0,40,100)");
  } catch (_) {
  }
  try {
    const has = await db.prepare("SELECT id FROM magazzino_articoli WHERE area='casa_di_carta' AND nome='Capsule caff\xE8'").get();
    if (!has) {
      const caffe = await db.prepare("SELECT giacenza,punto_riordino FROM cdc_caffe WHERE id=1").get();
      if (caffe) {
        const pr = Number(caffe.punto_riordino || 0);
        const pre = Math.round(pr * 1.5) || pr + 10;
        await db.prepare("INSERT INTO magazzino_articoli (nome,area,unita,giacenza,punto_riordino,soglia_preavviso,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?)").run("Capsule caff\xE8", "casa_di_carta", "capsule", Number(caffe.giacenza || 0), pr, pre, 1, (/* @__PURE__ */ new Date()).toISOString());
      }
    }
  } catch (_) {
  }
}

// server/auth.js
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && timingSafeEqual(test, ref);
}
var sessions = /* @__PURE__ */ new Map();
var TTL = 8 * 60 * 60 * 1e3;
function createSession(user) {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { user: { id: user.id, username: user.username, ruolo: user.ruolo, permessi: user.permessi ?? null }, exp: Date.now() + TTL });
  return token;
}
function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) {
    sessions.delete(token);
    return null;
  }
  return s.user;
}
function destroySession(token) {
  sessions.delete(token);
}
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const user = token && getSession(token);
  if (!user) return res.status(401).json({ error: "Autenticazione richiesta" });
  req.adminUser = user;
  next();
}
var userSessions = /* @__PURE__ */ new Map();
function createUserSession(socio) {
  const token = randomBytes(24).toString("hex");
  userSessions.set(token, { socio: { id: socio.id, tessera_code: socio.tessera_code, nome: socio.nome }, exp: Date.now() + TTL });
  return token;
}
function getUserSession(token) {
  const s = userSessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) {
    userSessions.delete(token);
    return null;
  }
  return s.socio;
}
function genOtp() {
  return String(randomBytes(3).readUIntBE(0, 3) % 1e6).padStart(6, "0");
}

// server/tournament.js
var ORDINE_CASATE = ["Aretusa", "Ortigia", "Neapolis", "Dionisio", "Ciane", "Plemmirio", "Epipoli", "Anapo"];
function giornateGirone(sq) {
  return [
    [[sq[0], sq[1]], [sq[2], sq[3]]],
    [[sq[1], sq[2]], [sq[3], sq[0]]]
  ];
}
async function casateByName() {
  const rows = await db.prepare("SELECT id,nome FROM casate").all();
  const m = {};
  rows.forEach((r) => m[r.nome] = r.id);
  return m;
}
function roundRobinRounds(teams) {
  const arr = teams.slice();
  if (arr.length % 2 === 1) arr.push(null);
  const n = arr.length;
  const fixed = arr[0];
  let rest = arr.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const line = [fixed, ...rest];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = line[i], b = line[n - 1 - i];
      if (a != null && b != null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  return rounds;
}
async function generaCalendario(disciplinaId) {
  const disc = await db.prepare("SELECT id FROM discipline WHERE id=?").get(disciplinaId);
  if (!disc) throw new Error("Disciplina inesistente");
  await db.prepare("DELETE FROM partite WHERE disciplina_id=?").run(disciplinaId);
  const oldGironi = await db.prepare("SELECT id FROM gironi WHERE disciplina_id=?").all(disciplinaId);
  for (const g of oldGironi) await db.prepare("DELETE FROM classifica WHERE girone_id=?").run(g.id);
  await db.prepare("DELETE FROM gironi WHERE disciplina_id=?").run(disciplinaId);
  const idByName = await casateByName();
  const nomi = [
    ...ORDINE_CASATE.filter((n) => idByName[n]),
    ...Object.keys(idByName).filter((n) => !ORDINE_CASATE.includes(n))
  ];
  const off = nomi.length ? ((disciplinaId - 1) % nomi.length + nomi.length) % nomi.length : 0;
  const rot = nomi.slice(off).concat(nomi.slice(0, off));
  const gA = rot.filter((_, i) => i % 2 === 0).slice(0, 4);
  const gB = rot.filter((_, i) => i % 2 === 1).slice(0, 4);
  const insGir = db.prepare("INSERT INTO gironi (disciplina_id,nome) VALUES (?,?)");
  const insCla = db.prepare("INSERT INTO classifica (girone_id,casata_id) VALUES (?,?)");
  const insPar = db.prepare(`INSERT INTO partite (disciplina_id,girone_id,fase,giornata,casata_a_id,casata_b_id,casa_a,casa_b,stato)
    VALUES (?,?,?,?,?,?,?,?, 'da_giocare')`);
  for (const [nome, sq] of [["Girone A", gA], ["Girone B", gB]]) {
    if (!sq.length) continue;
    const gid = (await insGir.run(disciplinaId, nome)).lastInsertRowid;
    for (const n of sq) await insCla.run(gid, idByName[n]);
    const giornate = sq.length === 4 ? giornateGirone(sq) : roundRobinRounds(sq);
    for (let ri = 0; ri < giornate.length; ri++) {
      for (const [a, b] of giornate[ri]) await insPar.run(disciplinaId, gid, "girone", ri + 1, idByName[a], idByName[b], a, b);
    }
  }
  await db.prepare("UPDATE discipline SET stato='in_corso' WHERE id=?").run(disciplinaId);
  return getTabellone(disciplinaId);
}
async function classificaCombinata(disciplinaId) {
  return await db.prepare(`SELECT ca.nome, ca.colore, c.pt, c.v, c.p, c.pg, c.gf, c.gs
    FROM classifica c JOIN casate ca ON ca.id=c.casata_id JOIN gironi g ON g.id=c.girone_id
    WHERE g.disciplina_id=? ORDER BY c.pt DESC, (c.gf-c.gs) DESC, c.gf DESC, ca.nome`).all(disciplinaId);
}
async function archiviaEdizione(disciplinaId) {
  const d = await db.prepare("SELECT id,nome,dominio,data_inizio,data_fine FROM discipline WHERE id=?").get(disciplinaId);
  if (!d) throw new Error("Disciplina inesistente");
  const cl = await classificaCombinata(disciplinaId);
  const vincitore = cl[0]?.nome || null;
  await db.prepare("INSERT INTO edizioni (disciplina_id,disciplina_nome,dominio,data_inizio,data_fine,vincitore,classifica) VALUES (?,?,?,?,?,?,?)").run(d.id, d.nome, d.dominio, d.data_inizio || null, d.data_fine || null, vincitore, JSON.stringify(cl));
  await db.prepare("DELETE FROM partite WHERE disciplina_id=?").run(disciplinaId);
  const g = await db.prepare("SELECT id FROM gironi WHERE disciplina_id=?").all(disciplinaId);
  for (const x of g) await db.prepare("DELETE FROM classifica WHERE girone_id=?").run(x.id);
  await db.prepare("DELETE FROM gironi WHERE disciplina_id=?").run(disciplinaId);
  await db.prepare("UPDATE discipline SET stato='preparazione' WHERE id=?").run(disciplinaId);
  return { vincitore, casate: cl.length };
}
async function recomputeGirone(gironeId) {
  const disc = await db.prepare(`SELECT d.punti_vitt pv, d.punti_par pp FROM gironi g JOIN discipline d ON d.id=g.disciplina_id WHERE g.id=?`).get(gironeId);
  const rows = await db.prepare("SELECT casata_id FROM classifica WHERE girone_id=?").all(gironeId);
  const st = {};
  rows.forEach((r) => st[r.casata_id] = { pg: 0, v: 0, p: 0, gf: 0, gs: 0, pt: 0 });
  const partite = await db.prepare("SELECT * FROM partite WHERE girone_id=? AND stato='giocata'").all(gironeId);
  for (const m of partite) {
    const A = st[m.casata_a_id], B = st[m.casata_b_id];
    if (!A || !B) continue;
    A.pg++;
    B.pg++;
    A.gf += m.gol_a;
    A.gs += m.gol_b;
    B.gf += m.gol_b;
    B.gs += m.gol_a;
    if (m.gol_a > m.gol_b) {
      A.v++;
      A.pt += disc.pv;
    } else if (m.gol_a < m.gol_b) {
      B.v++;
      B.pt += disc.pv;
    } else {
      A.p++;
      B.p++;
      A.pt += disc.pp;
      B.pt += disc.pp;
    }
  }
  const upd = db.prepare("UPDATE classifica SET pg=?,v=?,p=?,gf=?,gs=?,pt=? WHERE girone_id=? AND casata_id=?");
  for (const cid of Object.keys(st)) {
    const s = st[cid];
    await upd.run(s.pg, s.v, s.p, s.gf, s.gs, s.pt, gironeId, cid);
  }
}
async function registraRisultato(partitaId, golA, golB) {
  const m = await db.prepare("SELECT * FROM partite WHERE id=?").get(partitaId);
  if (!m) throw new Error("Partita inesistente");
  await db.prepare("UPDATE partite SET gol_a=?,gol_b=?,punteggio=?,stato='giocata' WHERE id=?").run(golA, golB, `${golA}\u2013${golB}`, partitaId);
  if (m.girone_id) await recomputeGirone(m.girone_id);
  return true;
}
async function classificaOrdinata(gironeId) {
  return await db.prepare(`SELECT c.*, ca.nome, ca.colore FROM classifica c JOIN casate ca ON ca.id=c.casata_id
    WHERE c.girone_id=? ORDER BY c.pt DESC, (c.gf-c.gs) DESC, c.gf DESC, ca.nome`).all(gironeId);
}
async function getTabellone(disciplinaId) {
  const gironiRows = await db.prepare("SELECT id,nome FROM gironi WHERE disciplina_id=? ORDER BY nome").all(disciplinaId);
  const gironi = [];
  for (const g of gironiRows) {
    gironi.push({
      id: g.id,
      nome: g.nome,
      classifica: await classificaOrdinata(g.id),
      partite: await db.prepare("SELECT id,giornata,casa_a,casa_b,gol_a,gol_b,stato FROM partite WHERE girone_id=? ORDER BY giornata,id").all(g.id)
    });
  }
  const tuttiGiocati = (await db.prepare("SELECT count(*) n FROM partite WHERE disciplina_id=? AND fase='girone' AND stato!='giocata'").get(disciplinaId)).n === 0;
  let finali = null;
  if (gironi.length === 2 && tuttiGiocati) {
    const A = gironi[0].classifica, B = gironi[1].classifica;
    finali = {
      semifinali: [
        { casa: A[0]?.nome, ospite: B[1]?.nome, cA: A[0]?.colore, cB: B[1]?.colore },
        { casa: B[0]?.nome, ospite: A[1]?.nome, cA: B[0]?.colore, cB: A[1]?.colore }
      ]
    };
  }
  return { gironi, finali, completo: tuttiGiocati };
}

// server/seed.js
var force = process.argv.includes("--force");
async function seed({ verbose = false } = {}) {
  await initSchema();
  const already = (await db.prepare("SELECT count(*) c FROM casate").get()).c;
  if (already > 0 && !force) {
    if (verbose) console.log("DB gi\xE0 popolato \u2014 salto il seed (usa --force per riscrivere).");
    return;
  }
  if (force) {
    for (const t of ["audit_log", "allegati", "comanda_righe", "comande", "menu_articoli", "magazzino_movimenti", "magazzino_articoli", "cdc_prestiti", "cdc_check", "cdc_caffe_conte", "cdc_giochi", "cdc_caffe", "proposte", "serate_prenotazioni", "serate", "convocazioni", "partite", "classifica", "gironi", "discipline", "prenotazioni", "risorse", "eventi", "soci", "bussola", "luoghi", "contest_esiti", "contest", "casate", "utenti_admin"]) {
      await db.exec(`DELETE FROM ${t};`);
    }
  }
  const CASATE = [
    ["Aretusa", "#2E6DA4", "l'onda", 62],
    ["Ortigia", "#B7791F", "la rosa dei venti", 66],
    ["Neapolis", "#C0553F", "il teatro", 54],
    ["Dionisio", "#6E5AA6", "la maschera", 50],
    ["Ciane", "#4d7a4a", "il papiro", 47],
    ["Plemmirio", "#12324F", "il faro", 44],
    ["Epipoli", "#7A8790", "le mura", 40],
    ["Anapo", "#2E7D77", "il fiume", 37]
  ];
  const insCasata = db.prepare("INSERT INTO casate (nome,colore,motto,punti) VALUES (?,?,?,?)");
  const casataId = {};
  for (const c of CASATE) {
    const r = await insCasata.run(...c);
    casataId[c[0]] = r.lastInsertRowid;
  }
  const EVENTI = [
    // Lunedì lasciato VUOTO di proposito: coincide con l'inizio dei periodi di vacanza (arrivi/partenze degli esterni).
    ["lun", "Luned\xEC", "Giornata libera", "", "#7A8790", "Arrivi, partenze e riposo", "Nessuna attivit\xE0 in cartellone: il luned\xEC coincide con il cambio degli ospiti (arrivi e partenze). \xC8 il giorno di riposo del residence.", null, null, "libero", 1],
    ["mar", "Marted\xEC", "Vinile & Vino", "Bussola Garden", "#C0553F", "Scegli tu la musica della serata", "La serata la costruisci tu: proponi un vinile, i brani e il perch\xE9. Le proposte della settimana diventano la scaletta di quella successiva.", "Proponi un vinile", "sheet-vinile", "serata", 2],
    ["mer", "Mercoled\xEC", "Cinema d'autore sotto le stelle", "Bussola Stage", "#12324F", "Ortigia Film Festival & titoli d'autore", "Una proiezione a settimana: opere premiate all'Ortigia Film Festival, alternate a titoli pi\xF9 leggeri ma sempre d'autore.", "Prenota un posto", null, "cinema", 3],
    ["gio", "Gioved\xEC", "Jazz & Cocktail", "Bussola Garden", "#2E7D77", "La serata-firma \xB7 trio live", "La serata-firma della Bussola: trio live acustico, luci basse, cocktail. Si cena prima dello spettacolo.", "Prenota un tavolo", null, "serata", 4],
    ["ven", "Venerd\xEC", "Serata dei Clan", "Bussola Stage", "#6E5AA6", "Le otto casate si sfidano", "Le otto casate si sfidano dall\u2019apericena a tarda sera. Questa settimana: gara di karaoke. Coinvolgi un ospite e la tua casata guadagna punti extra.", "Vai alla Coppa", "go-coppa", "serata", 5],
    ["sab", "Sabato", "Live Session", "Bussola Stage", "#B7791F", "Band e cantautori emergenti", "Band e cantautori emergenti dal vivo sul Bussola Stage.", "Prenota un posto", null, "serata", 6],
    ["dom", "Domenica", "Open Mic", "Bussola Stage", "#B7791F", "Tre minuti di palco per te", "Microfono aperto: tre minuti a testa per cantare, recitare un monologo, fare stand-up (linguaggio moderato) o suonare.", "Salgo sul palco", "sheet-openmic", "serata", 7]
  ];
  const insEvento = db.prepare("INSERT INTO eventi (chiave,giorno,titolo,ambiente,colore,sottotitolo,descrizione,cta,azione,tipo,ordine) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const e of EVENTI) await insEvento.run(...e);
  const RISORSE = [
    ["pickleball", "Campo di Pickleball", "sport", "Turni da 90 minuti \xB7 gioco 17\u201320", JSON.stringify(["17:00\u201318:30", "18:30\u201320:00"]), "Si gioca dalle 17 alle 20, per rispettare il silenzio pomeridiano e le attivit\xE0 della sera sul palco."],
    ["soft", "Campo di Soft tennis", "sport", "Turni da 90 minuti \xB7 gioco 17\u201320", JSON.stringify(["17:00\u201318:30", "18:30\u201320:00"]), "Si gioca dalle 17 alle 20, per rispettare il silenzio pomeridiano e le attivit\xE0 della sera."],
    ["cowo", "Postazione Coworking", "coworking", "Casa di Carta \xB7 wi-fi e caff\xE8", JSON.stringify(["Mattina (9\u201313)", "Pomeriggio (14\u201318)", "Giornata intera"]), null],
    ["tavolo", "Tavolo per la cena", "tavolo", "~40 coperti serviti \xB7 turni 20:00 e 21:30", JSON.stringify(["20:00", "21:30"]), "Indica il numero di persone. All\u2019apertura di stagione c\u2019\xE8 un unico turno alle 20:00 (segue la sfilata dei clan)."]
  ];
  const insRis = db.prepare("INSERT INTO risorse (chiave,nome,tipo,sottotitolo,slots,nota) VALUES (?,?,?,?,?,?)");
  for (const r of RISORSE) await insRis.run(...r);
  const CAS_A = ["Aretusa", "Ortigia", "Ciane", "Epipoli"];
  const CAS_B = ["Neapolis", "Dionisio", "Plemmirio", "Anapo"];
  const SPORT = [
    [
      "pickle",
      "Pickleball",
      [[3, 3, 9], [3, 2, 6], [3, 1, 3], [3, 0, 0]],
      [[3, 2, 6], [3, 2, 6], [3, 1, 3], [3, 1, 3]],
      [["Aretusa", "Ortigia", "Dom 17:30", "Campo 1"], ["Neapolis", "Dionisio", "Dom 19:00", "Campo 1"], ["Ciane", "Epipoli", "Mar 17:30", "Campo 1"]],
      [["Aretusa", "Ciane", "11\u20136"], ["Ortigia", "Epipoli", "11\u20139"], ["Plemmirio", "Anapo", "9\u201311"]]
    ],
    [
      "soft",
      "Soft tennis",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [["Aretusa", "Plemmirio", "Gio 18:00", "Campo 1"], ["Ortigia", "Ciane", "Sab 17:30", "Campo 1"]],
      [["Neapolis", "Anapo", "6\u20132"], ["Dionisio", "Epipoli", "6\u20134"]]
    ],
    [
      "pingpong",
      "Ping pong",
      [[3, 3, 6], [3, 2, 4], [3, 1, 2], [3, 0, 0]],
      [[3, 2, 4], [3, 2, 4], [3, 1, 2], [3, 1, 2]],
      [["Ciane", "Aretusa", "Lun 18:30", "Bussola Bar"], ["Anapo", "Neapolis", "Mer 18:30", "Bussola Bar"]],
      [["Ortigia", "Epipoli", "3\u20131"], ["Dionisio", "Plemmirio", "3\u20132"]]
    ],
    [
      "balilla",
      "Calcio balilla",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 0, 1], [2, 0, 1]],
      [["Aretusa", "Epipoli", "Ven 19:00", "Bussola Bar"], ["Neapolis", "Plemmirio", "Ven 19:30", "Bussola Bar"]],
      [["Ortigia", "Ciane", "10\u20137"], ["Dionisio", "Anapo", "10\u20134"]]
    ],
    [
      "basket",
      "Basket 3\xD73",
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [["Aretusa", "Ciane", "Sab 18:00", "Campo del residence"], ["Neapolis", "Plemmirio", "Dom 18:00", "Campo del residence"]],
      [["Ortigia", "Epipoli", "21\u201315"], ["Dionisio", "Anapo", "21\u201312"]]
    ],
    [
      "calcetto",
      "Calcetto a 5",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 0, 1], [2, 0, 1]],
      [["Aretusa", "Epipoli", "Ven 18:30", "Campo del residence"], ["Neapolis", "Dionisio", "Sab 19:00", "Campo del residence"]],
      [["Ortigia", "Ciane", "5\u20133"], ["Plemmirio", "Anapo", "4\u20134"]]
    ]
  ];
  const GIOCHI = [
    [
      "burraco",
      "Burraco",
      [[3, 3, 9], [3, 2, 6], [3, 1, 3], [3, 0, 0]],
      [[3, 2, 6], [3, 2, 6], [3, 1, 3], [3, 1, 3]],
      [["Aretusa", "Neapolis", "Mar 21:00", "Casa di Carta"], ["Ortigia", "Dionisio", "Gio 21:00", "Casa di Carta"]],
      [["Ciane", "Epipoli", "2\u20130"], ["Plemmirio", "Anapo", "1\u20132"]]
    ],
    [
      "scala",
      "Scala 40",
      [[2, 2, 6], [2, 1, 3], [2, 1, 3], [2, 0, 0]],
      [[2, 2, 6], [2, 1, 3], [2, 0, 1], [2, 0, 1]],
      [["Aretusa", "Epipoli", "Gio 21:30", "Casa di Carta"], ["Neapolis", "Anapo", "Sab 21:00", "Casa di Carta"]],
      [["Ortigia", "Ciane", "1\u20130"], ["Dionisio", "Plemmirio", "1\u20131"]]
    ],
    [
      "briscola",
      "Briscola/Scopa",
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [[2, 2, 4], [2, 1, 2], [2, 1, 2], [2, 0, 0]],
      [["Aretusa", "Ciane", "Ven 21:00", "Casa di Carta"], ["Neapolis", "Dionisio", "Dom 21:00", "Casa di Carta"]],
      [["Ortigia", "Epipoli", "2\u20131"], ["Plemmirio", "Anapo", "2\u20130"]]
    ],
    [
      "scacchi",
      "Scacchi/Dama",
      [[3, 3, 6], [3, 2, 4], [3, 1, 2], [3, 0, 0]],
      [[3, 2, 4], [3, 2, 4], [3, 1, 2], [3, 1, 2]],
      [["Aretusa", "Ortigia", "Lun 21:00", "Casa di Carta"], ["Ciane", "Epipoli", "Mer 21:00", "Casa di Carta"]],
      [["Dionisio", "Plemmirio", "1\u20130"], ["Neapolis", "Anapo", "\xBD\u2013\xBD"]]
    ]
  ];
  const MINMAX = {
    pickle: [2, 2],
    soft: [2, 2],
    pingpong: [1, 2],
    balilla: [2, 2],
    basket: [3, 4],
    calcetto: [5, 7],
    burraco: [2, 4],
    scala: [2, 4],
    briscola: [2, 4],
    scacchi: [1, 1]
  };
  const insDisc = db.prepare("INSERT INTO discipline (dominio,chiave,nome,attivo,min_giocatori,max_giocatori,ordine) VALUES (?,?,?,?,?,?,?)");
  const discIds = [];
  async function loadDomain(dom, list) {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const mm = MINMAX[d[0]] || [1, 1];
      discIds.push((await insDisc.run(dom, d[0], d[1], 1, mm[0], mm[1], i)).lastInsertRowid);
    }
  }
  await loadDomain("sport", SPORT);
  await loadDomain("giochi", GIOCHI);
  const demoScores = [[2, 1], [1, 1], [2, 0], [1, 0]];
  for (const did of discIds) {
    await generaCalendario(did);
    const g1 = await db.prepare("SELECT id FROM partite WHERE disciplina_id=? AND giornata=1").all(did);
    for (let k = 0; k < g1.length; k++) {
      await registraRisultato(g1[k].id, demoScores[k % demoScores.length][0], demoScores[k % demoScores.length][1]);
    }
  }
  const BUSSOLA = [
    ["servizi", "Farmacia", "Fontane Bianche", "~600 m", 1],
    ["servizi", "Guardia medica", "Cassibile", "~5 km", 2],
    ["servizi", "Spiaggia", "Fontane Bianche", "~300 m", 3],
    ["servizi", "Market & alimentari", "Viale dei Lidi", "~700 m", 4],
    ["servizi", "Bar & tabacchi", "Fontane Bianche", "~500 m", 5],
    ["vedere", "Ortigia", "Centro storico di Siracusa \xB7 cultura", "~20 km", 1],
    ["vedere", "Parco della Neapolis", "Teatro Greco \xB7 Orecchio di Dioniso", "~22 km", 2],
    ["vedere", "Duomo di Siracusa", "Luogo di culto \xB7 barocco", "~20 km", 3],
    ["vedere", "Riserva del Plemmirio", "Area marina protetta \xB7 natura", "~12 km", 4],
    ["vedere", "Cavagrande del Cassibile", "Laghetti e sentieri \xB7 natura", "~18 km", 5],
    ["rifiuti", "Lun \xB7 Organico", "", "", 1],
    ["rifiuti", "Mar \xB7 Plastica", "", "", 2],
    ["rifiuti", "Mer \xB7 Carta", "", "", 3],
    ["rifiuti", "Gio \xB7 Organico", "", "", 4],
    ["rifiuti", "Ven \xB7 Vetro", "", "", 5],
    ["rifiuti", "Sab \xB7 Indifferenziato", "", "", 6],
    ["orari", "Silenzio pomeridiano", "Dalle 14:00 alle 17:00 \u2014 riposo per tutti.", "", 1],
    ["orari", "Silenzio notturno", "Dopo le 23:30 \u2014 si abbassano voci e musica.", "", 2]
  ];
  const insBus = db.prepare("INSERT INTO bussola (sezione,titolo,dettaglio,distanza,ordine) VALUES (?,?,?,?,?)");
  for (const b of BUSSOLA) await insBus.run(...b);
  const insContest = db.prepare("INSERT INTO contest (titolo,tipo,settimana,brief,stato,vincitore,punti_scala,esito_assegnato,attivo) VALUES (?,?,?,?,?,?,?,?,1)");
  await insContest.run(
    "Apertura di stagione \u2014 Sfilata dei Clan",
    "sfilata",
    "apertura stagione",
    "Dopo l'unico turno di cena delle 20:00, le otto casate si presentano in sfilata. Chi dimostra di aver agito come vero clan \u2014 abbigliamento coordinato, un motto, un grido di battaglia, un rito propiziatorio \u2014 prende subito punti. Ai pi\xF9 simpatici, geniali, divertenti e fantasiosi vanno 10 punti. Il voto lo esprimono gli altri clan.",
    "annunciato",
    null,
    JSON.stringify([10, 0, 0, 0, 0, 0, 0, 0]),
    0
  );
  await insContest.run(
    "Il mio nome \xE8 Bond, James Bond",
    "cocktail",
    "25\u201331 agosto",
    "Dati 3 liquori, un'acqua tonica e un selz, ogni casata crea il proprio cocktail. Banco bar e attrezzatura a disposizione; presentate nome e ricetta. I primi 3 finalisti saranno in vendita nel weekend; a fine settimana la graduatoria della giuria + il bonus vendite (4/2/1 pezzi venduti) assegna i punti Coppa.",
    "annunciato",
    null,
    null,
    0
  );
  const insSerata = db.prepare("INSERT INTO serate (chiave,titolo,data,quando,tema,descrizione,quota,capienza,ordine) VALUES (?,?,?,?,?,?,?,?,?)");
  await insSerata.run(
    "apertura",
    "Apertura di stagione",
    "2026-05-30",
    "Sab 30 maggio \xB7 unico turno 20:00",
    "Presentazione e sfilata dei Clan",
    "Cena unica alle 20:00, poi presentazione e sfilata delle otto casate. I clan che si presentano come tali (abbigliamento coordinato, motto, grido, rito) prendono subito punti: 10 al migliore, votato dagli altri clan.",
    25,
    120,
    1
  );
  await insSerata.run(
    "tema_luglio",
    "Serata a tema \xB7 fine luglio",
    "2026-07-25",
    "Sab 25 luglio \xB7 20:00",
    "Tema da annunciare",
    "La serata a tema di fine luglio: il tema viene svelato dal CdA. Cena a numero chiuso con prenotazione.",
    30,
    100,
    2
  );
  await insSerata.run(
    "ferragosto",
    "Cena di Ferragosto",
    "2026-08-15",
    "Sab 15 agosto \xB7 20:00",
    "Gran serata",
    "La serata clou dell\u2019estate: cena speciale di Ferragosto con musica dal vivo. Posti limitati, prenotazione consigliata.",
    40,
    140,
    3
  );
  await insSerata.run(
    "fine_stagione",
    "Chiusura di stagione",
    "2026-09-12",
    "Sab 12 settembre \xB7 20:00",
    "Premiazione Coppa delle Casate",
    "L\u2019ultima grande serata: cena, premiazione della Coppa delle Casate e Albo d\u2019Oro. Si saluta l\u2019estate insieme.",
    30,
    120,
    4
  );
  const insLuogo = db.prepare("INSERT INTO luoghi (chiave,nome,lat,lng,ordine) VALUES (?,?,?,?,?)");
  await insLuogo.run("chiosco", "Chiosco La Bussola", 36.967766, 15.221669, 1);
  await insLuogo.run("isola", "Isola ecologica", 36.967209, 15.221206, 2);
  const insSocio = db.prepare(`INSERT INTO soci (tessera_code,nome,cognome,email,casata_id,ruolo,tipo_profilo,tutore_id,lingua,consenso_privacy,consenso_marketing,notifiche_push,valida_fino)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  await insSocio.run("BR-2026-0001", "Ercole", "\u2014", "socio@example.com", casataId["Aretusa"], "socio", "socio", null, "it", 1, 0, 1, "2027-05-01");
  await insSocio.run("BR-2026-0002", "Giulia", "R.", "giulia@example.com", casataId["Ortigia"], "capitano", "socio", null, "it", 1, 1, 1, "2027-05-01");
  const genitoreId = (await insSocio.run("BR-2026-0003", "Marco", "V.", "marco@example.com", casataId["Neapolis"], "socio", "genitore", null, "en", 1, 0, 1, "2027-05-01")).lastInsertRowid;
  await insSocio.run("BR-2026-0004", "Sara", "V.", "", casataId["Neapolis"], "socio", "under14", genitoreId, "it", 1, 0, 0, "2027-05-01");
  await insSocio.run("BR-2026-0005", "Luca", "P.", "luca@example.com", casataId["Ciane"], "socio", "ospite_temporaneo", null, "fr", 1, 0, 0, null);
  await db.prepare("UPDATE soci SET soggiorno_dal='2026-08-10', soggiorno_al='2026-08-24' WHERE tessera_code='BR-2026-0005'").run();
  await insSocio.run("BR-2026-0100", "Chiara", "T.", "residente@example.com", null, "socio", "residente", null, "it", 1, 0, 0, "2026-09-30");
  const ort = casataId["Ortigia"];
  const compagni = [["Anna", "B."], ["Paolo", "C."], ["Elena", "D."], ["Davide", "F."], ["Marta", "G."], ["Sara", "L."]];
  for (let i = 0; i < compagni.length; i++) {
    const n = compagni[i];
    await insSocio.run(`BR-2026-00${(6 + i).toString().padStart(2, "0")}`, n[0], n[1], "", ort, "socio", "socio", null, "it", 1, 0, i % 2, "2027-05-01");
  }
  const insRifTipo = db.prepare("INSERT INTO rifiuti_tipi (nome,colore,ordine) VALUES (?,?,?)");
  const RIF_TIPI = [["Organico", "#6b4a2b", 1], ["Plastica e lattine", "#d99a00", 2], ["Carta e cartone", "#2E6DA4", 3], ["Vetro", "#3f7a4a", 4], ["Indifferenziato", "#6b6f73", 5]];
  for (const t of RIF_TIPI) await insRifTipo.run(...t);
  await db.prepare("INSERT INTO rifiuti_calendario (periodo,inizio_conf,fine_conf,ora_ritiro,giorni,ordine) VALUES (?,?,?,?,?,?)").run("Estivo", "18:30", "21:30", "22:00", JSON.stringify({ lun: ["Organico"], mar: ["Plastica e lattine"], mer: ["Carta e cartone"], gio: ["Organico"], ven: ["Carta e cartone", "Vetro"], sab: ["Indifferenziato"], dom: [] }), 1);
  const insReg = db.prepare("INSERT INTO regolamenti (chiave,titolo,testo,ordine) VALUES (?,?,?,?)");
  await insReg.run("coppa", "Coppa delle Casate", "Le otto casate si sfidano nelle discipline sportive e nei giochi durante il periodo di svolgimento. Ogni vittoria e pareggio assegna punti alla graduatoria; le migliori accedono a semifinali e finale. La classifica generale determina la Coppa della stagione.", 1);
  await insReg.run("contest", "Serata dei Clan", "Il CdA lancia la sfida (cocktail, karaoke, recitazione\u2026) la settimana prima. La giuria stila una graduatoria (punti per posizione) a cui si somma il bonus vendite 4/2/1 alle prime tre casate per pezzi venduti. I punti finali si versano una sola volta in Coppa.", 2);
  await insReg.run("proposte", "Vinile & Open Mic", "Le proposte musicali (vinile) e le esibizioni all'Open Mic raccolte durante la settimana diventano la scaletta di quella successiva. Linguaggio e contenuti moderati; ogni proposta \xE8 valutata dallo staff.", 3);
  await db.prepare("INSERT OR REPLACE INTO cdc_caffe (id,giacenza,punto_riordino,confezione) VALUES (1,?,?,?)").run(120, 50, 100);
  const insGioco = db.prepare("INSERT INTO cdc_giochi (nome,categoria,quantita,stato,ordine) VALUES (?,?,?,?,?)");
  const GIOCHI_INV = [
    ["Mazzi di carte francesi", "carte", 4, "ok"],
    ["Mazzi di carte italiane", "carte", 2, "ok"],
    ["Cluedo", "gioco_tavolo", 1, "ok"],
    ["Monopoli", "gioco_tavolo", 1, "ok"],
    ["Risiko", "gioco_tavolo", 1, "ok"],
    ["Indovina Chi", "gioco_tavolo", 1, "ok"],
    ["Scacchiere", "scacchi", 2, "ok"],
    ["Set di pedine e scacchi", "scacchi", 2, "ok"]
  ];
  for (let i = 0; i < GIOCHI_INV.length; i++) {
    const g = GIOCHI_INV[i];
    await insGioco.run(g[0], g[1], g[2], g[3], i);
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insArt = db.prepare("INSERT INTO magazzino_articoli (nome,area,unita,giacenza,punto_riordino,soglia_preavviso,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?)");
  const MAG = [
    // nome, area, unità, giacenza, punto_riordino, soglia_preavviso
    // (il caffè NON è qui: lo gestisce l'upsert sotto, per non duplicare l'articolo creato dalla migrazione)
    ["Bicchieri di carta", "chiosco", "pz", 300, 100, 150],
    ["Acqua naturale 0,5L", "chiosco", "pz", 48, 24, 36],
    ["Birra media", "chiosco", "pz", 60, 24, 40],
    ["Patatine (buste)", "chiosco", "pz", 40, 20, 30],
    ["Ghiaccio (sacchi)", "chiosco", "sacchi", 6, 4, 8],
    ["Piatti biodegradabili", "serata_clan", "pz", 200, 80, 120],
    ["Tovaglioli", "serate_tema", "conf", 10, 4, 6]
  ];
  for (let i = 0; i < MAG.length; i++) {
    const a = MAG[i];
    await insArt.run(a[0], a[1], a[2], a[3], a[4], a[5], i + 1, nowIso);
  }
  const exCaffe = await db.prepare("SELECT id FROM magazzino_articoli WHERE area='casa_di_carta' AND nome='Capsule caff\xE8'").get();
  if (exCaffe) await db.prepare("UPDATE magazzino_articoli SET unita=?,giacenza=?,punto_riordino=?,soglia_preavviso=?,aggiornato_at=? WHERE id=?").run("capsule", 120, 50, 80, nowIso, exCaffe.id);
  else await insArt.run("Capsule caff\xE8", "casa_di_carta", "capsule", 120, 50, 80, 0, nowIso);
  const birra = await db.prepare("SELECT id FROM magazzino_articoli WHERE nome='Birra media'").get();
  const acqua = await db.prepare("SELECT id FROM magazzino_articoli WHERE nome='Acqua naturale 0,5L'").get();
  const patatine = await db.prepare("SELECT id FROM magazzino_articoli WHERE nome='Patatine (buste)'").get();
  const insMenu = db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,categoria,magazzino_id,attivo,ordine) VALUES (?,?,?,?,?,1,?)");
  const MENU = [
    ["Panino salsiccia", 4.5, "cucina", "panini", null],
    ["Panino vegetariano", 4, "cucina", "panini", null],
    ["Hamburger", 5.5, "cucina", "panini", null],
    ["Patatine fritte", 3, "cucina", "snack", null],
    ["Patatine in busta", 1.5, "bar", "snack", patatine ? patatine.id : null],
    ["Birra media", 4, "bar", "birre", birra ? birra.id : null],
    ["Acqua 0,5L", 1, "bar", "bibite", acqua ? acqua.id : null],
    ["Bibita in lattina", 2, "bar", "bibite", null],
    ["Caff\xE8", 1, "bar", "caldi", null]
  ];
  for (let i = 0; i < MENU.length; i++) {
    const m = MENU[i];
    await insMenu.run(m[0], m[1], m[2], m[3], m[4], i + 1);
  }
  const adminPwd = process.env.ADMIN_PASSWORD || "koine2026";
  const insAdmin = db.prepare("INSERT INTO utenti_admin (username,password_hash,ruolo,permessi) VALUES (?,?,?,?)");
  await insAdmin.run("gestore", hashPassword(adminPwd), "gestore", null);
  await insAdmin.run("manager", hashPassword(process.env.MANAGER_PASSWORD || "manager2026"), "manager", null);
  const staffCaps = JSON.stringify(["utenti", "utenti_ins", "casate", "cdc", "discipline", "tabellone", "contest", "serate", "proposte", "eventi", "magazzino", "comande"]);
  await insAdmin.run("staff", hashPassword(process.env.STAFF_PASSWORD || "staff2026"), "staff", staffCaps);
  await insAdmin.run("lettura", hashPassword("lettura2026"), "sola_lettura", null);
  audit("sistema", "seed", "database", 0, "Popolamento iniziale KOIN\xC8 Village");
  if (verbose) console.log("Seed completato: 8 casate, 7 eventi, 10 discipline, guida Bussola, 3 soci demo, 1 utente back office.");
}
if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ verbose: true }).catch((e) => {
    console.error("Seed fallito:", e);
    process.exit(1);
  });
}

// server/routes/public.js
import { Router } from "express";

// server/asyncroute.js
function asyncify(router) {
  for (const m of ["get", "post", "put", "delete", "patch"]) {
    const orig = router[m].bind(router);
    router[m] = (path, ...handlers) => orig(path, ...handlers.map((h) => typeof h === "function" && h.length < 4 ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h));
  }
  return router;
}

// server/routes/public.js
var publicRouter = asyncify(Router());
publicRouter.get("/casate", async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,colore,motto,punti FROM casate ORDER BY punti DESC").all();
  res.json(rows);
});
publicRouter.get("/eventi", async (req, res) => {
  const rows = await db.prepare("SELECT chiave,giorno,titolo,ambiente,colore,sottotitolo,descrizione,cta,azione,tipo FROM eventi WHERE attivo=1 ORDER BY ordine").all();
  res.json(rows);
});
publicRouter.get("/risorse", async (req, res) => {
  const rows = (await db.prepare("SELECT chiave,nome,tipo,sottotitolo,slots,nota FROM risorse WHERE attivo=1").all()).map((r) => ({ ...r, slots: r.slots ? JSON.parse(r.slots) : [] }));
  res.json(rows);
});
publicRouter.get("/bussola", async (req, res) => {
  const rows = await db.prepare("SELECT sezione,titolo,dettaglio,distanza FROM bussola ORDER BY sezione,ordine").all();
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
  res.json(await db.prepare("SELECT chiave,nome,lat,lng FROM luoghi ORDER BY ordine").all());
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
  const cal = (await db.prepare("SELECT periodo,inizio_conf,fine_conf,ora_ritiro,giorni FROM rifiuti_calendario ORDER BY ordine,id").all()).map((c) => ({ ...c, giorni: c.giorni ? JSON.parse(c.giorni) : {} }));
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
  const socio = tessera ? await db.prepare("SELECT id,nome,cognome FROM soci WHERE tessera_code=?").get(tessera) : null;
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
  const s = await db.prepare(`SELECT so.tessera_code,so.nome,so.cognome,so.ruolo,so.tipo_profilo,so.dinieghi,so.notifiche_push,so.valida_fino,c.nome AS casata,c.colore
                        FROM soci so LEFT JOIN casate c ON c.id=so.casata_id
                        WHERE so.tessera_code=? AND so.attivo=1`).get(req.params.code);
  if (!s) return res.status(404).json({ error: "Tessera non trovata" });
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

// server/routes/admin.js
import { Router as Router2 } from "express";
import { readFileSync, unlinkSync, statSync } from "node:fs";

// server/contest.js
var SCALA_DEFAULT = [10, 6, 4, 3, 2, 1, 1, 1];
var SCALA_SFILATA = [10, 0, 0, 0, 0, 0, 0, 0];
var BONUS_VENDITE = [4, 2, 1];
function scalaDi(contest) {
  if (contest?.punti_scala) {
    try {
      const a = JSON.parse(contest.punti_scala);
      if (Array.isArray(a)) return a;
    } catch (_) {
    }
  }
  return contest?.tipo === "sfilata" ? SCALA_SFILATA : SCALA_DEFAULT;
}
async function salvaEsito(contestId, righe, scalaOverride) {
  const contest = await db.prepare("SELECT * FROM contest WHERE id=?").get(contestId);
  if (!contest) throw new Error("Contest non trovato");
  if (contest.esito_assegnato) throw new Error("Esito gi\xE0 assegnato alla Coppa: non modificabile");
  const scala = Array.isArray(scalaOverride) ? scalaOverride : scalaDi(contest);
  const venditori = righe.filter((r) => Number(r.pezzi_venduti) > 0).sort((a, b) => Number(b.pezzi_venduti) - Number(a.pezzi_venduti) || Number(a.casata_id) - Number(b.casata_id));
  const bonusPer = /* @__PURE__ */ new Map();
  venditori.slice(0, 3).forEach((r, i) => bonusPer.set(Number(r.casata_id), BONUS_VENDITE[i]));
  const up = db.prepare(`INSERT INTO contest_esiti (contest_id,casata_id,posizione,pezzi_venduti,punti)
                         VALUES (?,?,?,?,?)
                         ON CONFLICT(contest_id,casata_id) DO UPDATE SET
                           posizione=excluded.posizione, pezzi_venduti=excluded.pezzi_venduti, punti=excluded.punti`);
  const out = [];
  for (const r of righe) {
    const pos = Number(r.posizione) || null;
    const pezzi = Number(r.pezzi_venduti) || 0;
    const placement = pos && pos >= 1 && scala[pos - 1] != null ? scala[pos - 1] : 0;
    const bonus = bonusPer.get(Number(r.casata_id)) || 0;
    const punti = placement + bonus;
    await up.run(contestId, r.casata_id, pos, pezzi, punti);
    out.push({ casata_id: Number(r.casata_id), posizione: pos, pezzi_venduti: pezzi, placement, bonus, punti });
  }
  if (Array.isArray(scalaOverride)) {
    await db.prepare("UPDATE contest SET punti_scala=? WHERE id=?").run(JSON.stringify(scalaOverride), contestId);
  }
  await db.prepare("UPDATE contest SET stato='in_corso' WHERE id=? AND stato='annunciato'").run(contestId);
  audit("staff", "esito_contest", "contest", contestId, `${out.length} casate`);
  return out;
}
async function assegnaCoppa(contestId) {
  const contest = await db.prepare("SELECT * FROM contest WHERE id=?").get(contestId);
  if (!contest) throw new Error("Contest non trovato");
  if (contest.esito_assegnato) throw new Error("Punti gi\xE0 assegnati");
  const esiti = await db.prepare("SELECT * FROM contest_esiti WHERE contest_id=?").all(contestId);
  if (!esiti.length) throw new Error("Nessun esito salvato: registra prima la graduatoria");
  const addPunti = db.prepare("UPDATE casate SET punti = punti + ? WHERE id=?");
  let totale = 0;
  for (const e of esiti) {
    if (e.punti) {
      await addPunti.run(e.punti, e.casata_id);
      totale += e.punti;
    }
  }
  const primo = esiti.filter((e) => e.posizione === 1)[0];
  const vincitore = primo ? (await db.prepare("SELECT nome FROM casate WHERE id=?").get(primo.casata_id))?.nome : null;
  await db.prepare("UPDATE contest SET stato='concluso', esito_assegnato=1, vincitore=? WHERE id=?").run(vincitore || null, contestId);
  audit("staff", "assegna_coppa", "contest", contestId, `${totale} punti \xB7 vince ${vincitore || "\u2014"}`);
  return { totale, vincitore, casate: esiti.length };
}
async function esitoCorrente(contestId) {
  const contest = await db.prepare("SELECT * FROM contest WHERE id=?").get(contestId);
  if (!contest) return null;
  const casate = await db.prepare("SELECT id,nome,colore FROM casate ORDER BY nome").all();
  const esiti = new Map((await db.prepare("SELECT * FROM contest_esiti WHERE contest_id=?").all(contestId)).map((e) => [e.casata_id, e]));
  return {
    contest,
    scala: scalaDi(contest),
    assegnato: !!contest.esito_assegnato,
    righe: casate.map((c) => {
      const e = esiti.get(c.id);
      return {
        casata_id: c.id,
        casata: c.nome,
        colore: c.colore,
        posizione: e?.posizione ?? null,
        pezzi_venduti: e?.pezzi_venduti ?? 0,
        punti: e?.punti ?? 0
      };
    })
  };
}

// server/permessi.js
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
  "comande"
  // Chiosco: comande + KDS (cassa/cameriere/stazioni)
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
  "operatori"
  // gestione account staff e permessi
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
  "comande"
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

// server/routes/admin.js
var adminRouter = asyncify(Router2());
adminRouter.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const u = await db.prepare("SELECT * FROM utenti_admin WHERE username=?").get(username || "");
  if (!u || !verifyPassword(password || "", u.password_hash)) {
    audit(username || "?", "login_fallito", "utenti_admin", u?.id ?? "");
    return res.status(401).json({ error: "Credenziali non valide" });
  }
  const token = createSession(u);
  audit(u.username, "login", "utenti_admin", u.id);
  res.json({ token, user: { username: u.username, ruolo: u.ruolo } });
});
adminRouter.post("/logout", requireAdmin, (req, res) => {
  const token = (req.headers.authorization || "").slice(7);
  destroySession(token);
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
  const code = b.tessera_code || await nextTessera();
  try {
    const info = await db.prepare(`INSERT INTO soci (tessera_code,nome,cognome,email,telefono,data_nascita,casata_id,ruolo,tipo_profilo,tutore_id,lingua,consenso_privacy,consenso_marketing,consenso_foto,notifiche_push,valida_fino,soggiorno_dal,soggiorno_al)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code,
      b.nome,
      b.cognome,
      b.email ?? null,
      b.telefono ?? null,
      b.data_nascita ?? null,
      b.casata_id ?? null,
      b.ruolo ?? "socio",
      b.tipo_profilo ?? "socio",
      b.tutore_id ?? null,
      b.lingua ?? "it",
      b.consenso_privacy ? 1 : 0,
      b.consenso_marketing ? 1 : 0,
      b.consenso_foto ? 1 : 0,
      b.notifiche_push ? 1 : 0,
      b.valida_fino ?? null,
      b.soggiorno_dal ?? null,
      b.soggiorno_al ?? null
    );
    audit(req.adminUser.username, "crea", "soci", info.lastInsertRowid, code);
    res.status(201).json({ ok: true, id: info.lastInsertRowid, tessera_code: code });
  } catch (e) {
    res.status(400).json({ error: "Tessera duplicata o dati non validi" });
  }
});
adminRouter.put("/soci/:id", requireCap("utenti"), async (req, res) => {
  const b = req.body || {};
  const exists = await db.prepare("SELECT id FROM soci WHERE id=?").get(req.params.id);
  if (!exists) return res.status(404).json({ error: "Socio non trovato" });
  await db.prepare(`UPDATE soci SET nome=?,cognome=?,email=?,telefono=?,data_nascita=?,casata_id=?,ruolo=?,tipo_profilo=?,tutore_id=?,lingua=?,
    consenso_privacy=?,consenso_marketing=?,consenso_foto=?,notifiche_push=?,attivo=?,valida_fino=?,soggiorno_dal=?,soggiorno_al=? WHERE id=?`).run(
    b.nome,
    b.cognome,
    b.email ?? null,
    b.telefono ?? null,
    b.data_nascita ?? null,
    b.casata_id ?? null,
    b.ruolo ?? "socio",
    b.tipo_profilo ?? "socio",
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
    req.params.id
  );
  audit(req.adminUser.username, "modifica", "soci", req.params.id);
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
adminRouter.put("/casate/:id/punti", requireCap("casate"), async (req, res) => {
  const { punti } = req.body || {};
  await db.prepare("UPDATE casate SET punti=? WHERE id=?").run(Number(punti) || 0, req.params.id);
  audit(req.adminUser.username, "punti", "casate", req.params.id, String(punti));
  res.json({ ok: true });
});
adminRouter.get("/eventi", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM eventi ORDER BY ordine").all());
});
adminRouter.put("/eventi/:id", requireCap("eventi"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE eventi SET titolo=?,sottotitolo=?,descrizione=?,ambiente=?,attivo=? WHERE id=?").run(b.titolo, b.sottotitolo ?? "", b.descrizione ?? "", b.ambiente ?? "", b.attivo ? 1 : 0, req.params.id);
  audit(req.adminUser.username, "modifica", "eventi", req.params.id);
  res.json({ ok: true });
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
  const info = await db.prepare("INSERT INTO bussola (sezione,titolo,dettaglio,distanza,ordine) VALUES (?,?,?,?,?)").run(b.sezione, b.titolo, b.dettaglio ?? "", b.distanza ?? "", Number(b.ordine) || 0);
  audit(req.adminUser.username, "crea", "bussola", info.lastInsertRowid);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
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
  await db.prepare("UPDATE luoghi SET nome=?,lat=?,lng=? WHERE id=?").run(b.nome, b.lat === "" || b.lat == null ? null : Number(b.lat), b.lng === "" || b.lng == null ? null : Number(b.lng), req.params.id);
  audit(req.adminUser.username, "coordinate", "luoghi", req.params.id, `${b.lat},${b.lng}`);
  res.json({ ok: true });
});
adminRouter.get("/rifiuti", requireCap("guida"), async (req, res) => {
  const tipi = await db.prepare("SELECT id,nome,colore,ordine FROM rifiuti_tipi ORDER BY ordine,id").all();
  const calendari = (await db.prepare("SELECT id,periodo,inizio_conf,fine_conf,ora_ritiro,giorni,ordine FROM rifiuti_calendario ORDER BY ordine,id").all()).map((c) => ({ ...c, giorni: c.giorni ? JSON.parse(c.giorni) : {} }));
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
  if (ex) await db.prepare("UPDATE rifiuti_calendario SET inizio_conf=?,fine_conf=?,ora_ritiro=?,giorni=? WHERE periodo=?").run(b.inizio_conf || "", b.fine_conf || "", b.ora_ritiro || "", giorni, per);
  else {
    const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM rifiuti_calendario").get()).n;
    await db.prepare("INSERT INTO rifiuti_calendario (periodo,inizio_conf,fine_conf,ora_ritiro,giorni,ordine) VALUES (?,?,?,?,?,?)").run(per, b.inizio_conf || "", b.fine_conf || "", b.ora_ritiro || "", giorni, ord);
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
  if (g <= pr) return "da_riordinare";
  if (pre > 0 && g <= pre) return "in_esaurimento";
  return "ok";
}
adminRouter.get("/magazzino", requireCap("magazzino"), async (req, res) => {
  const area = req.query.area;
  const rows = area ? await db.prepare("SELECT * FROM magazzino_articoli WHERE area=? ORDER BY ordine,id").all(area) : await db.prepare("SELECT * FROM magazzino_articoli ORDER BY area,ordine,id").all();
  const articoli = rows.map((a) => ({ ...a, stato: magStato(a) }));
  const riepilogo = {
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
  const info = await db.prepare("INSERT INTO magazzino_articoli (nome,area,unita,giacenza,punto_riordino,soglia_preavviso,note,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?,?)").run(b.nome, b.area || "chiosco", b.unita || "pz", Number(b.giacenza || 0), Number(b.punto_riordino || 0), Number(b.soglia_preavviso || 0), b.note || null, ord, (/* @__PURE__ */ new Date()).toISOString());
  audit(req.adminUser.username, "crea", "magazzino_articoli", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/magazzino/:id", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE magazzino_articoli SET nome=?,area=?,unita=?,punto_riordino=?,soglia_preavviso=?,note=?,aggiornato_at=? WHERE id=?").run(b.nome, b.area || "chiosco", b.unita || "pz", Number(b.punto_riordino || 0), Number(b.soglia_preavviso || 0), b.note || null, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  audit(req.adminUser.username, "modifica", "magazzino_articoli", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/magazzino/:id", requireCap("magazzino"), async (req, res) => {
  await db.prepare("DELETE FROM magazzino_movimenti WHERE articolo_id=?").run(req.params.id);
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
  if (tipo === "carico") nuova += q;
  else if (tipo === "scarico") nuova = Math.max(0, nuova - q);
  else nuova = q;
  await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?").run(nuova, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore) VALUES (?,?,?,?,?)").run(req.params.id, tipo, q, b.causale || null, req.adminUser.username);
  audit(req.adminUser.username, tipo, "magazzino_articoli", req.params.id, String(q));
  const aggiornato = await db.prepare("SELECT * FROM magazzino_articoli WHERE id=?").get(req.params.id);
  res.json({ ok: true, giacenza: nuova, stato: magStato(aggiornato) });
});
adminRouter.get("/magazzino/:id/movimenti", requireCap("magazzino"), async (req, res) => {
  const rows = await db.prepare("SELECT id,tipo,quantita,causale,operatore,created_at FROM magazzino_movimenti WHERE articolo_id=? ORDER BY id DESC LIMIT 50").all(req.params.id);
  res.json(rows);
});
adminRouter.get("/menu", requireCap("comande"), async (req, res) => {
  const rows = await db.prepare("SELECT * FROM menu_articoli ORDER BY ordine,id").all();
  res.json(rows);
});
adminRouter.post("/menu", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM menu_articoli").get()).n;
  const info = await db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,categoria,magazzino_id,attivo,ordine) VALUES (?,?,?,?,?,?,?)").run(b.nome, Number(b.prezzo || 0), b.stazione === "cucina" ? "cucina" : "bar", b.categoria || null, b.magazzino_id || null, b.attivo === false ? 0 : 1, ord);
  audit(req.adminUser.username, "crea", "menu_articoli", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/menu/:id", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE menu_articoli SET nome=?,prezzo=?,stazione=?,categoria=?,magazzino_id=?,attivo=? WHERE id=?").run(b.nome, Number(b.prezzo || 0), b.stazione === "cucina" ? "cucina" : "bar", b.categoria || null, b.magazzino_id || null, b.attivo === false ? 0 : 1, req.params.id);
  audit(req.adminUser.username, "modifica", "menu_articoli", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/menu/:id", requireCap("comande"), async (req, res) => {
  await db.prepare("DELETE FROM menu_articoli WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "menu_articoli", req.params.id);
  res.json({ ok: true });
});
async function comandaConRighe(id) {
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(id);
  if (!c) return null;
  c.righe = await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? ORDER BY id").all(id);
  return c;
}
adminRouter.get("/comande", requireCap("comande"), async (req, res) => {
  const stato = req.query.stato;
  let rows;
  if (stato === "tutte") rows = await db.prepare("SELECT * FROM comande ORDER BY id DESC LIMIT 100").all();
  else if (stato) rows = await db.prepare("SELECT * FROM comande WHERE stato=? ORDER BY id DESC LIMIT 100").all(stato);
  else rows = await db.prepare("SELECT * FROM comande WHERE stato NOT IN ('chiusa','annullata') ORDER BY id").all();
  for (const c of rows) c.righe = await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? ORDER BY id").all(c.id);
  res.json(rows);
});
adminRouter.post("/comande", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  const righe = Array.isArray(b.righe) ? b.righe.filter((r) => r && r.menu_id && Number(r.qta) > 0) : [];
  if (!righe.length) return res.status(400).json({ error: "Aggiungi almeno un articolo" });
  const numero = (await db.prepare("SELECT COALESCE(MAX(numero),0)+1 n FROM comande WHERE date(created_at)=date('now')").get()).n;
  const info = await db.prepare("INSERT INTO comande (numero,origine,riferimento,stato,totale,operatore,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(numero, ["tavolo", "bancone", "chiosco"].includes(b.origine) ? b.origine : "chiosco", b.riferimento || null, "aperta", 0, req.adminUser.username, b.note || null, (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString());
  const cid = Number(info.lastInsertRowid);
  let totale = 0;
  for (const r of righe) {
    const m = await db.prepare("SELECT * FROM menu_articoli WHERE id=?").get(r.menu_id);
    if (!m) continue;
    const qta = Math.max(1, Math.round(Number(r.qta)));
    totale += Number(m.prezzo) * qta;
    await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato,magazzino_id) VALUES (?,?,?,?,?,?,?,?,?)").run(cid, m.id, m.nome, Number(m.prezzo), qta, m.stazione, r.note || null, "in_coda", m.magazzino_id || null);
  }
  await db.prepare("UPDATE comande SET totale=? WHERE id=?").run(totale, cid);
  audit(req.adminUser.username, "crea", "comande", cid, "n." + numero);
  res.status(201).json(await comandaConRighe(cid));
});
adminRouter.put("/comande/:id/stato", requireCap("comande"), async (req, res) => {
  const stato = req.body && req.body.stato;
  if (!["aperta", "in_preparazione", "pronta", "consegnata", "chiusa", "annullata"].includes(stato)) return res.status(400).json({ error: "Stato non valido" });
  await db.prepare("UPDATE comande SET stato=?,updated_at=? WHERE id=?").run(stato, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
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
    if (nuovo !== cur.stato) await db.prepare("UPDATE comande SET stato=?,updated_at=? WHERE id=?").run(nuovo, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  }
  res.json(await comandaConRighe(req.params.id));
});
adminRouter.post("/comande/:id/chiudi", requireCap("comande"), async (req, res) => {
  const c = await db.prepare("SELECT * FROM comande WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Comanda non trovata" });
  if (c.stato === "chiusa") return res.json(await comandaConRighe(req.params.id));
  const righe = await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=?").all(c.id);
  for (const r of righe) {
    if (!r.magazzino_id) continue;
    const art = await db.prepare("SELECT giacenza FROM magazzino_articoli WHERE id=?").get(r.magazzino_id);
    if (!art) continue;
    const nuova = Math.max(0, Number(art.giacenza) - Number(r.qta));
    await db.prepare("UPDATE magazzino_articoli SET giacenza=?,aggiornato_at=? WHERE id=?").run(nuova, (/* @__PURE__ */ new Date()).toISOString(), r.magazzino_id);
    await db.prepare("INSERT INTO magazzino_movimenti (articolo_id,tipo,quantita,causale,operatore) VALUES (?,?,?,?,?)").run(r.magazzino_id, "scarico", Number(r.qta), "Comanda #" + (c.numero || c.id), req.adminUser.username);
  }
  await db.prepare("UPDATE comande SET stato=?,updated_at=? WHERE id=?").run("chiusa", (/* @__PURE__ */ new Date()).toISOString(), c.id);
  audit(req.adminUser.username, "chiudi", "comande", c.id, "tot " + c.totale);
  res.json(await comandaConRighe(c.id));
});
adminRouter.delete("/comande/:id", requireCap("comande"), async (req, res) => {
  await db.prepare("DELETE FROM comanda_righe WHERE comanda_id=?").run(req.params.id);
  await db.prepare("DELETE FROM comande WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "comande", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/kds", requireCap("comande"), async (req, res) => {
  const staz = req.query.stazione;
  const comande = await db.prepare("SELECT * FROM comande WHERE stato IN ('aperta','in_preparazione','pronta') ORDER BY id").all();
  const out = [];
  for (const c of comande) {
    const righe = staz ? await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? AND stazione=? AND stato!='consegnata' ORDER BY id").all(c.id, staz) : await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? AND stato!='consegnata' ORDER BY id").all(c.id);
    if (righe.length) out.push({ ...c, righe });
  }
  res.json(out);
});
adminRouter.get("/discipline", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM discipline ORDER BY dominio, ordine").all());
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
  await db.prepare("DELETE FROM contest_esiti WHERE contest_id=?").run(req.params.id);
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
    res.json({ ok: true, ...await assegnaCoppa(Number(req.params.id)) });
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
adminRouter.get("/cdc/coworking", async (req, res) => {
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
  res.json({ max: 8, giorni: Object.keys(per).map((g) => ({ giorno: g, ...per[g] })) });
});
adminRouter.get("/cdc/caffe", async (req, res) => {
  const cfg = await db.prepare("SELECT * FROM cdc_caffe WHERE id=1").get() || { giacenza: 0, punto_riordino: 40, confezione: 100 };
  const conte = await db.prepare("SELECT * FROM cdc_caffe_conte ORDER BY id DESC LIMIT 30").all();
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
  audit(req.adminUser.username, "conta_caffe", "cdc_caffe", 1, `giacenza ${g}`);
  res.json({ ok: true, giacenza: g, consumo });
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
  await db.prepare("DELETE FROM cdc_giochi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "cdc_giochi", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/cdc/prestiti", async (req, res) => res.json(await db.prepare("SELECT * FROM cdc_prestiti ORDER BY id DESC LIMIT 100").all()));
adminRouter.post("/cdc/prestiti", requireCap("cdc"), async (req, res) => {
  const b = req.body || {};
  const info = await db.prepare("INSERT INTO cdc_prestiti (gioco_id,gioco_nome,giocatore,data,ora_inizio,ora_fine,note) VALUES (?,?,?,?,?,?,?)").run(b.gioco_id || null, b.gioco_nome || "", b.giocatore || "", b.data || oggi(), b.ora_inizio || "", b.ora_fine || "", b.note || "");
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
adminRouter.post("/allegati", requireCap("cdc"), async (req, res) => {
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
  const tmp = `/tmp/koine-backup-${Date.now()}.db`;
  try {
    await db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = readFileSync(tmp);
    try {
      unlinkSync(tmp);
    } catch (_) {
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="koine-backup-${stamp}.db"`);
    audit(req.adminUser.username, "backup_db", "database", 0, `${buf.length} byte`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: "Backup non riuscito: " + e.message });
  }
});
adminRouter.get("/audit", requireCap("registro"), async (req, res) => {
  res.json(await db.prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT 200").all());
});
async function nextTessera() {
  const year = 2026;
  const n = (await db.prepare("SELECT count(*) c FROM soci").get()).c + 1;
  return `BR-${year}-${String(n).padStart(4, "0")}`;
}

// server/routes/authuser.js
import { Router as Router3 } from "express";
var authUserRouter = asyncify(Router3());
var DEV = (process.env.KOINE_ENV || "dev") !== "prod";
function requireUser(req, res, next) {
  const token = (req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const u = token && getUserSession(token);
  if (!u) return res.status(401).json({ error: "Accesso richiesto" });
  req.user = u;
  next();
}
authUserRouter.post("/request-otp", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "E-mail non valida" });
  const socio = await db.prepare("SELECT id FROM soci WHERE lower(email)=? AND attivo=1").get(email);
  const code = genOtp();
  const exp = Date.now() + 10 * 60 * 1e3;
  await db.prepare("INSERT INTO otp (email,code,exp) VALUES (?,?,?)").run(email, code, exp);
  audit(email, "otp_richiesto", "otp", "", socio ? "utente noto" : "email sconosciuta");
  res.json({ ok: true, ...DEV ? { dev_code: code, dev_note: "In produzione arriva via e-mail/SMS; qui \xE8 mostrato solo per test." } : {} });
});
authUserRouter.post("/login-tessera", async (req, res) => {
  const code = String(req.body?.tessera_code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Codice tessera mancante" });
  const socio = await db.prepare("SELECT * FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(code);
  if (!socio) return res.status(404).json({ error: "Tessera non trovata" });
  const token = createUserSession(socio);
  audit(socio.tessera_code, "login_tessera", "soci", socio.id);
  const casata = await db.prepare("SELECT nome,colore FROM casate WHERE id=?").get(socio.casata_id) || {};
  res.json({ token, socio: { tessera_code: socio.tessera_code, nome: socio.nome, cognome: socio.cognome, ruolo: socio.ruolo, tipo_profilo: socio.tipo_profilo, casata: casata.nome, colore: casata.colore, notifiche_push: !!socio.notifiche_push } });
});
authUserRouter.post("/verify-otp", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const row = await db.prepare("SELECT * FROM otp WHERE email=? AND code=? AND used=0 ORDER BY id DESC").get(email, code);
  if (!row || Date.now() > row.exp) return res.status(401).json({ error: "Codice non valido o scaduto" });
  await db.prepare("UPDATE otp SET used=1 WHERE id=?").run(row.id);
  const socio = await db.prepare("SELECT * FROM soci WHERE lower(email)=? AND attivo=1").get(email);
  if (!socio) return res.status(404).json({ error: "Nessun profilo associato a questa e-mail" });
  const token = createUserSession(socio);
  audit(socio.tessera_code, "login_utente", "soci", socio.id);
  const casata = await db.prepare("SELECT nome,colore FROM casate WHERE id=?").get(socio.casata_id) || {};
  res.json({ token, socio: { tessera_code: socio.tessera_code, nome: socio.nome, cognome: socio.cognome, ruolo: socio.ruolo, tipo_profilo: socio.tipo_profilo, casata: casata.nome, colore: casata.colore, notifiche_push: !!socio.notifiche_push } });
});
authUserRouter.post("/notifiche/consenso", requireUser, async (req, res) => {
  const on = req.body?.attivo ? 1 : 0;
  await db.prepare("UPDATE soci SET notifiche_push=? WHERE tessera_code=?").run(on, req.user.tessera_code);
  audit(req.user.tessera_code, "consenso_notifiche", "soci", "", on ? "attivo" : "disattivo");
  res.json({ ok: true, attivo: !!on });
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
  for (const s of soci) {
    await ins.run(s.id, disc.id, match_label ?? "", quando ?? "", luogo ?? "");
    if (s.notifiche_push) {
      await insN.run(s.id, "push", "casata", "La tua casata ti convoca", `${match_label || ""} \xB7 ${quando || ""} ${luogo || ""}`.trim());
      notificati++;
    }
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
  for (const sid of ids) {
    const s = await db.prepare("SELECT id,notifiche_push FROM soci WHERE id=? AND casata_id=? AND attivo=1").get(sid, me.casata_id);
    if (!s) continue;
    if (await db.prepare("SELECT id FROM convocazioni WHERE partita_id=? AND socio_id=?").get(partita_id, sid)) continue;
    await insC.run(sid, p.disc_id, partita_id, label, "", "");
    if (s.notifiche_push) await insN.run(sid, "push", "casata", "Convocazione \xB7 " + p.disc, label);
    n++;
  }
  audit(req.user.tessera_code, "convoca_mirata", "partite", partita_id, `${n} convocati`);
  res.status(201).json({ ok: true, convocati: n });
});
authUserRouter.get("/notifiche", requireUser, async (req, res) => {
  const socio = await db.prepare("SELECT id FROM soci WHERE tessera_code=?").get(req.user.tessera_code);
  const rows = socio ? await db.prepare("SELECT id,tipo,titolo,corpo,letta,created_at FROM notifiche WHERE socio_id=? ORDER BY created_at DESC LIMIT 50").all(socio.id) : [];
  res.json(rows);
});

// server/version.js
var VERSION = "4.8";

// build/frontend.html
var frontend_default = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#12324F">
<meta name="description" content="Bussola Residence \u2014 l'app del residence di Fontane Bianche: eventi, sport, Coppa delle Casate, tessera e guida.">
<title>Bussola Residence \u2014 App</title>

<style>
:root{
  --navy:#12324F; --gold:#8a5a12; --teal:#256b65; --coral:#b14a35;
  --plum:#5f4f95; --sage:#3f6b3d; --ink:#17242c; --paper:#F7F4EC;
  --mute:#4a5a64; --line:#E3E1D6; --card:#FFFFFF;
  --scale:1;                 /* controllo dimensione testo (accessibilit\xE0) */
  --tap:46px;                /* area tocco minima */
  --focus:#0a66c2;
}
/* Alto contrasto (attivabile dall'utente) */
body.hc{--navy:#0a1f33; --gold:#6b4406; --teal:#12433f; --mute:#33414a; --line:#b9b6a8; --paper:#fbf9f2; --ink:#0c141a;}
body.hc .card{border-color:#8f8b7c;}
*{box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent;}
html,body{height:100%;}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:calc(16px * var(--scale));
  background:radial-gradient(1200px 800px at 50% -10%, #1c3e5c 0%, #0d2137 55%, #0a1a2b 100%);
  color:var(--ink); display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px 10px;
}
@media (prefers-reduced-motion: reduce){*{animation:none !important; transition:none !important;}}
.serif{font-family:Georgia,"Times New Roman",serif;}
.phone{width:400px; max-width:100%; height:calc(100vh - 40px); max-height:860px; background:var(--paper); border-radius:40px; position:relative; overflow:hidden;
  box-shadow:0 30px 80px rgba(0,0,0,.5), 0 0 0 10px #0c0f13, 0 0 0 12px #23272e; display:flex; flex-direction:column;}
.notch{position:absolute; top:0; left:50%; transform:translateX(-50%); width:140px; height:24px; background:#0c0f13; border-radius:0 0 16px 16px; z-index:40;}
header{background:linear-gradient(160deg, #163a5a, var(--navy)); color:#fff; padding:30px 16px 13px; position:relative; z-index:20; flex:0 0 auto;}
.brandrow{display:flex; align-items:center; justify-content:space-between; gap:10px;}
.brand{font-family:Georgia,serif; font-weight:700; letter-spacing:3px; font-size:1.05rem;}
.brand small{display:block; letter-spacing:5px; font-size:.52rem; color:#e2b45a; font-weight:700; margin-top:1px;}
.brand .byk{font-size:.72em; letter-spacing:2px; opacity:.82; text-transform:none; font-style:italic;}
.hgreet{margin-top:12px; display:flex; align-items:flex-start; justify-content:space-between; gap:10px;}
.hgreet h1{font-family:Georgia,serif; font-size:1.25rem; font-weight:600;}
.hgreet .gsub{font-size:.72rem; color:#c9d6e2; margin-top:2px;}
.hstack{display:flex; flex-direction:column; gap:7px; align-items:flex-end; flex:0 0 auto;}
.tesschip{display:flex; align-items:center; gap:7px; background:linear-gradient(135deg,#caa24f,#8a5f18); color:#fff; padding:8px 12px; border-radius:20px; font-size:.72rem; font-weight:700; cursor:pointer; min-height:var(--tap); box-shadow:0 3px 8px rgba(0,0,0,.25);}
.tesschip svg{width:15px; height:15px;}
.casatapill{display:flex; align-items:center; gap:7px; background:rgba(255,255,255,.14); padding:7px 10px; border-radius:20px; font-size:.72rem; cursor:pointer; color:#fff; min-height:var(--tap);}
.casatapill .sh{width:15px;height:19px;border-radius:4px 4px 8px 8px; display:inline-block;}
.iconbtn{display:inline-flex; align-items:center; justify-content:center; gap:5px; background:rgba(255,255,255,.14); border:none; color:#fff; padding:8px 11px; border-radius:20px; font-size:.7rem; font-weight:700; cursor:pointer; min-height:var(--tap);}
.iconbtn svg{width:16px;height:16px;}
.topicons{display:flex; gap:8px; align-items:center;}

/* Barra accessibilit\xE0 */
.a11y{display:flex; gap:6px; align-items:center; margin-top:10px; background:rgba(255,255,255,.10); padding:6px; border-radius:14px;}
.a11y button{flex:1; background:rgba(255,255,255,.14); border:none; color:#fff; border-radius:10px; padding:8px 4px; font-weight:700; cursor:pointer; font-size:.72rem; min-height:40px;}
.a11y button.on{background:#e2b45a; color:#12324F;}
.a11y .lbl{font-size:.6rem; color:#c9d6e2; padding:0 4px; text-transform:uppercase; letter-spacing:.5px;}

.scroll{flex:1 1 auto; overflow-y:auto; padding:14px 14px 92px; -webkit-overflow-scrolling:touch;}
.scroll::-webkit-scrollbar{display:none;}
.screen{display:none; animation:fade .28s ease;}
.screen.active{display:block;}
@keyframes fade{from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:none;}}
.card{background:var(--card); border-radius:16px; padding:15px; box-shadow:0 4px 14px rgba(18,50,79,.07); border:1px solid var(--line);}
.card + .card{margin-top:11px;}
.eyebrow{font-size:.66rem; letter-spacing:1.4px; text-transform:uppercase; color:var(--gold); font-weight:700;}
.sect-title{font-family:Georgia,serif; font-size:1.02rem; font-weight:700; color:var(--navy); margin:18px 2px 9px; display:flex; align-items:center; gap:8px;}
.sect-title::after{content:""; flex:1; height:1px; background:var(--line);}
.btn{display:inline-flex; align-items:center; justify-content:center; gap:6px; border:none; border-radius:22px; padding:11px 16px; font-size:.82rem; font-weight:700; cursor:pointer; font-family:inherit; min-height:var(--tap);}
.btn.gold{background:var(--gold); color:#fff;} .btn.navy{background:var(--navy); color:#fff;}
.btn.ghost{background:transparent; color:var(--navy); border:1.5px solid var(--line);}
.btn.block{width:100%; padding:14px; font-size:.95rem; border-radius:14px;}
.btn.sm{padding:9px 13px; font-size:.75rem;}
.btn:focus-visible, a:focus-visible, .chip:focus-visible, .tab:focus-visible, [tabindex]:focus-visible{outline:3px solid var(--focus); outline-offset:2px;}
.muted{color:var(--mute);} .tiny{font-size:.72rem;}
.welcome{background:linear-gradient(135deg,#fbf4e6,#f3ead6); border:1px solid #ecdcbd; border-radius:16px; padding:14px 15px; display:flex; gap:12px; align-items:center;}
.welcome .wl{flex:1;} .welcome .eyebrow{color:var(--coral);}
.welcome h3{font-family:Georgia,serif; color:var(--navy); font-size:1rem; margin:2px 0 3px;}
.welcome p{font-size:.75rem; color:var(--mute);}
.hero{position:relative; border-radius:18px; overflow:hidden; color:#fff; padding:18px; min-height:150px; display:flex; flex-direction:column; justify-content:flex-end; margin-top:14px;
  background:linear-gradient(180deg, rgba(18,50,79,.2), rgba(18,50,79,.9)), linear-gradient(135deg,#5f4f95,#256b65); cursor:pointer;}
.hero .eyebrow{color:#ffe1ac;}
.hero h2{font-family:Georgia,serif; font-size:1.5rem; margin:4px 0 2px;} .hero p{font-size:.82rem; opacity:.95;}
.hero .btn{margin-top:12px; align-self:flex-start;}
.pgrid{display:grid; grid-template-columns:repeat(3,1fr); gap:10px;}
.ptile{background:var(--card); border:1px solid var(--line); border-radius:15px; padding:14px 8px; text-align:center; cursor:pointer; box-shadow:0 3px 9px rgba(18,50,79,.05); min-height:var(--tap);}
.ptile .ic{font-size:1.4rem;} .ptile b{display:block; font-size:.78rem; color:var(--navy); margin-top:5px;} .ptile span{display:block; font-size:.62rem; color:var(--mute); margin-top:1px;}
.evcard{display:flex; align-items:stretch; background:#fff; border:1px solid var(--line); border-radius:15px; overflow:hidden; margin-bottom:10px; box-shadow:0 4px 12px rgba(18,50,79,.06); cursor:pointer;}
.evcard .stripe{width:6px; flex:0 0 6px;}
.evcard .body{flex:1; padding:12px 4px 12px 13px; min-width:0;}
.evcard .dl{font-size:.66rem; letter-spacing:.6px; text-transform:uppercase; color:var(--mute); font-weight:700;}
.evcard h4{font-size:.98rem; color:var(--ink); margin:2px 0 1px;}
.evcard p{font-size:.76rem; color:var(--mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.evcard .cta{display:flex; align-items:center; padding:0 12px; flex:0 0 auto;} .evcard .chev{color:#c3cdd6;}
.myclan{background:linear-gradient(135deg,var(--navy),#1d4a6e); color:#fff; border-radius:18px; padding:16px; display:flex; align-items:center; gap:14px;}
.shield{width:52px; height:60px; flex:0 0 auto; border-radius:10px 10px 26px 26px/10px 10px 40px 40px; display:flex; align-items:center; justify-content:center; font-family:Georgia,serif; font-weight:700; color:#fff; font-size:1.35rem; border:2px solid rgba(255,255,255,.5);}
.myclan .info h3{font-family:Georgia,serif; font-size:1.2rem;} .myclan .info p{font-size:.75rem; opacity:.85; margin-top:2px;}
.posbig{margin-left:auto; text-align:center;} .posbig .n{font-family:Georgia,serif; font-size:1.9rem; font-weight:700; color:#e2b45a; line-height:1;} .posbig .l{font-size:.56rem; text-transform:uppercase; letter-spacing:1px; opacity:.85;}
.rank{display:flex; align-items:center; gap:10px; padding:9px 2px;}
.rank .rn{width:18px; font-family:Georgia,serif; font-weight:700; color:var(--mute); font-size:.82rem; text-align:center;}
.rank .sh{width:24px; height:28px; border-radius:6px 6px 12px 12px; flex:0 0 auto;}
.rank .nm{width:84px; font-size:.78rem; font-weight:600;}
.bar{flex:1; height:12px; background:#e6e6e6; border-radius:6px; overflow:hidden;} .bar span{display:block; height:100%; border-radius:6px;}
.rank .pt{width:32px; text-align:right; font-size:.78rem; font-weight:700; color:var(--navy);}
.tessera{border-radius:20px; padding:20px; color:#fff; background:linear-gradient(135deg,#123a5c 0%, #0d2740 60%, #123a5c 100%); position:relative; overflow:hidden; box-shadow:0 12px 30px rgba(9,20,33,.35);}
.tessera .lab{font-size:.62rem; letter-spacing:2px; text-transform:uppercase; color:#e2b45a; font-weight:700;}
.tessera h2{font-family:Georgia,serif; font-size:1.4rem; margin:10px 0 2px;} .tessera .role{font-size:.75rem; opacity:.85;}
.tessera .qr{width:88px; height:88px; background:#fff; border-radius:12px; margin-top:16px; padding:8px;} .qr svg{width:100%; height:100%;}
.tessera .foot{display:flex; justify-content:space-between; align-items:flex-end; margin-top:14px;}
.benefit{display:flex; gap:10px; align-items:flex-start; padding:11px 2px; border-bottom:1px solid var(--line);}
.benefit:last-child{border-bottom:none;} .benefit .bic{color:var(--teal); flex:0 0 auto; margin-top:1px; font-weight:800;}
.benefit b{font-size:.85rem;} .benefit p{font-size:.76rem; color:var(--mute); margin-top:1px;}
nav{position:absolute; bottom:0; left:0; right:0; height:72px; background:rgba(255,255,255,.97); backdrop-filter:blur(10px); border-top:1px solid var(--line); display:flex; z-index:30; padding-bottom:6px;}
.tab{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; color:var(--mute); font-size:.66rem; font-weight:600; min-height:var(--tap); background:none; border:none; font-family:inherit;}
.tab svg{width:23px; height:23px;} .tab.on{color:var(--navy);} .tab.on svg{color:var(--gold);}
.ov{position:absolute; inset:0; z-index:60; display:none;} .ov.show{display:block;}
.ov .bg{position:absolute; inset:0; background:rgba(9,20,33,.5);}
.sheet{position:absolute; left:0; right:0; bottom:0; background:var(--paper); border-radius:22px 22px 0 0; padding:10px 16px 22px; max-height:90%; overflow-y:auto; animation:up .3s ease;}
.sheet::-webkit-scrollbar{display:none;}
@keyframes up{from{transform:translateY(100%);} to{transform:none;}}
.grab{width:42px; height:5px; background:#d8d3c4; border-radius:3px; margin:6px auto 12px;}
.sheet h2{font-family:Georgia,serif; color:var(--navy); font-size:1.35rem;} .sheet .sub{color:var(--mute); font-size:.8rem; margin:3px 0 14px;}
.field{margin-bottom:12px;} .field label{font-size:.75rem; font-weight:700; color:var(--navy); display:block; margin-bottom:6px;}
.field input,.field textarea{width:100%; border:1.5px solid var(--line); border-radius:12px; padding:12px; font-size:.9rem; font-family:inherit; background:#fff; color:var(--ink); min-height:var(--tap);}
.field textarea{resize:none; height:70px;}
.chips{display:flex; flex-wrap:wrap; gap:8px;}
.chip{border:1.5px solid var(--line); background:#fff; border-radius:20px; padding:10px 14px; font-size:.8rem; cursor:pointer; font-weight:600; min-height:var(--tap); display:inline-flex; align-items:center;}
.chip.sel{background:var(--navy); color:#fff; border-color:var(--navy);}
.okmsg .big{width:60px;height:60px;border-radius:50%;background:var(--sage);color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;}
.note{background:#f3ead6; border-left:3px solid var(--gold); border-radius:8px; padding:11px 12px; font-size:.76rem; color:#5c4d2a; margin-top:10px;}
.discrow{display:flex; gap:8px; overflow-x:auto; padding:2px 0 4px; margin-bottom:6px;} .discrow::-webkit-scrollbar{display:none;}
.disc{flex:0 0 auto; border:1.5px solid var(--line); background:#fff; border-radius:20px; padding:10px 15px; font-size:.8rem; font-weight:700; color:var(--mute); cursor:pointer; white-space:nowrap; min-height:var(--tap);}
.disc.on{background:var(--navy); color:#fff; border-color:var(--navy);}
.gtable{width:100%; border-collapse:collapse; margin-top:6px;}
.gtable th{font-size:.6rem; text-transform:uppercase; letter-spacing:.4px; color:var(--mute); padding:3px 2px; font-weight:700;}
.gtable td{padding:8px 2px; font-size:.8rem; border-top:1px solid var(--line); text-align:center;}
.gtable td.team{text-align:left; font-weight:600; white-space:nowrap;}
.gtable td.team .gpos{color:var(--mute); font-family:Georgia,serif; font-weight:700; margin-right:6px;}
.gtable td.team .d{display:inline-block; width:9px;height:9px;border-radius:50%; margin-right:6px; vertical-align:middle;}
.matchrow{display:flex; align-items:center; gap:10px; padding:10px 2px; border-bottom:1px solid var(--line);} .matchrow:last-child{border-bottom:none;}
.matchrow .wh{width:58px; text-align:center; font-size:.68rem; color:var(--navy); font-weight:700;}
.matchrow .vs{flex:1; font-size:.8rem;} .matchrow .vs small{color:var(--mute);} .matchrow .ct{font-size:.68rem; color:var(--mute); margin-top:1px;}
.matchrow .sc{font-weight:700; color:var(--navy); font-size:.88rem;}
/* Banner offline / stato */
.banner{position:absolute; top:0; left:0; right:0; z-index:50; background:var(--coral); color:#fff; text-align:center; font-size:.72rem; padding:5px; transform:translateY(-100%); transition:transform .3s;}
.banner.show{transform:none;}
/* Onboarding */
.onb{position:absolute; inset:0; z-index:70; background:rgba(9,20,33,.72); display:none; align-items:center; justify-content:center; padding:22px;}
.onb.show{display:flex;}
.onb .box{background:var(--paper); border-radius:20px; padding:22px; max-width:320px; text-align:center;}
.onb .box h2{font-family:Georgia,serif; color:var(--navy); font-size:1.3rem; margin-bottom:6px;}
.onb .box p{font-size:.85rem; color:var(--mute); line-height:1.5; margin-bottom:8px;}
.onb ul{text-align:left; font-size:.82rem; color:var(--ink); margin:10px 0 14px; padding-left:2px; list-style:none;}
.onb ul li{padding:6px 0; display:flex; gap:9px; align-items:flex-start;}
.onb ul li b{color:var(--navy);}
.sos{display:block; width:100%; text-align:left; background:#fff; border:1.5px solid var(--line); border-radius:14px; padding:12px 14px; margin-top:11px; cursor:pointer;}
.sos b{color:var(--coral); font-size:.85rem;} .sos p{font-size:.72rem; color:var(--mute); margin-top:2px;}
.skip-link{position:absolute; left:-999px; top:0; background:#fff; color:var(--navy); padding:8px 12px; z-index:100;}
.skip-link:focus{left:8px; top:8px;}

/* ---- Gate di accesso (primo avvio): tessera principale + e-mail di riserva ---- */
.gate{position:absolute; inset:0; z-index:80; background:radial-gradient(600px 420px at 50% -10%, #1c3e5c, #0a1a2b); display:none; align-items:center; justify-content:center; padding:24px;}
.gate.show{display:flex;}
.gatebox{background:var(--paper); border-radius:20px; padding:26px 22px; width:100%; max-width:340px; box-shadow:0 24px 60px rgba(0,0,0,.45);}
.gate-brand{font-family:Georgia,serif; letter-spacing:2px; color:var(--navy); font-weight:700; font-size:18px; margin-bottom:16px;}
.gate-brand small{display:block; letter-spacing:3px; font-size:8px; color:var(--gold,#b7791f); margin-top:2px;}
.gatebox h2{font-family:Georgia,serif; color:var(--navy); font-size:1.4rem;}
.gsub2{color:var(--mute); font-size:.8rem; margin:4px 0 12px; line-height:1.35;}
.gatebox label{display:block; font-size:.72rem; font-weight:700; color:var(--navy); margin:8px 0 5px;}
.gatebox input{width:100%; padding:12px; border:1.5px solid var(--line); border-radius:12px; font-size:16px; font-family:inherit;}
.gate-err{color:var(--coral); font-size:.75rem; min-height:16px;}
.gate-demo{background:none; border:none; color:var(--mute); font-size:.72rem; text-decoration:underline; margin-top:14px; width:100%; cursor:pointer;}

</style>
<style>
  /* Utente non socio (visitatore): nasconde le schede tornei e il distintivo casata */
  body.no-tornei nav [data-t="sport"],
  body.no-tornei nav [data-t="giochi"],
  body.no-tornei #casataBtn { display: none !important; }
</style>
</head>
<body>
<a href="#main" class="skip-link">Salta al contenuto</a>
<div class="phone" role="application" aria-label="App KOIN\xC8 Village">
  <div class="notch" aria-hidden="true"></div>
  <div class="banner" id="banner" role="status" aria-live="polite">Sei offline \u2014 mostro gli ultimi dati salvati</div>

  <header>
    <div class="brandrow">
      <div style="display:flex; align-items:center; gap:10px;">
        <svg width="26" height="26" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" stroke="#e2b45a" stroke-width="1.5"/><path d="M20 4 L23 17 L36 20 L23 23 L20 36 L17 23 L4 20 L17 17 Z" fill="#e2b45a"/><circle cx="20" cy="20" r="2.4" fill="#12324F"/></svg>
        <div class="brand">BUSSOLA<small>RESIDENCE<span class="byk"> \xB7 by KOIN\xC8</span></small></div>
      </div>
      <div class="topicons">
        <button class="iconbtn" id="helpBtn" aria-label="Aiuto e guida rapida"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01"/></svg></button>
        <button class="iconbtn" id="langBtn" aria-label="Cambia lingua"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3.4 2.8 14.6 0 18M12 3c-2.8 3.4-2.8 14.6 0 18"/></svg><span id="langLbl">IT</span></button>
      </div>
    </div>
    <div class="hgreet">
      <div><h1 id="greetName">Ciao</h1><div class="gsub" id="greetSub">Benvenuto alla Bussola</div></div>
      <div class="hstack">
        <button class="tesschip" id="tesseraBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>Tessera</button>
        <button class="casatapill" id="casataBtn"><span class="sh" id="casataSh" style="background:#2E6DA4"></span><span id="casataNm">Aretusa</span></button>
      </div>
    </div>
    <div class="a11y" role="group" aria-label="Dimensione testo e contrasto">
      <span class="lbl">Testo</span>
      <button data-scale="1" aria-label="Testo normale">A</button>
      <button data-scale="1.15" aria-label="Testo grande">A+</button>
      <button data-scale="1.3" aria-label="Testo molto grande">A++</button>
      <button id="hcBtn" aria-label="Alto contrasto" aria-pressed="false">\u25D1 Contrasto</button>
    </div>
  </header>

  <main class="scroll" id="main">
    <section class="screen active" id="s-home" aria-label="Home"></section>
    <section class="screen" id="s-eventi" aria-label="Eventi"></section>
    <section class="screen" id="s-sport" aria-label="Sport e tornei"></section>
    <section class="screen" id="s-giochi" aria-label="Giochi da tavolo"></section>
    <section class="screen" id="s-coppa" aria-label="Coppa delle Casate"></section>
    <section class="screen" id="s-bussola" aria-label="Guida del residence"></section>
  </main>

  <nav aria-label="Navigazione principale">
    <button class="tab on" data-t="home"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 10.5L12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>Home</button>
    <button class="tab" data-t="eventi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>Eventi</button>
    <button class="tab" data-t="sport"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M4 8c5 2.2 11 2.2 16 0M4 16c5-2.2 11-2.2 16 0M12 3v18"/></svg>Sport</button>
    <button class="tab" data-t="giochi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4.5" y="7" width="10.5" height="13.5" rx="2"/><rect x="9" y="3.5" width="10.5" height="13.5" rx="2"/></svg>Giochi</button>
    <button class="tab" data-t="bussola"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none"/></svg>Guida</button>
  </nav>

  <div class="ov" id="ov"><div class="bg" id="ovBg"></div><div class="sheet" id="sheetbox" role="dialog" aria-modal="true"></div></div>

  <div class="onb" id="onb" role="dialog" aria-modal="true" aria-label="Guida rapida">
    <div class="box">
      <div class="eyebrow" style="color:var(--coral)">Benvenuto</div>
      <h2 class="serif">Come funziona</h2>
      <p>Tre passi e sei pronto. Puoi ingrandire il testo dai pulsanti <b>A / A+</b> in alto.</p>
      <ul>
        <li><span>\u{1F3E0}</span><div><b>Home & Eventi:</b> il programma della settimana, prenoti con un tocco.</div></li>
        <li><span>\u{1F3C6}</span><div><b>Sport & Giochi:</b> tornei e Coppa delle Casate della tua squadra.</div></li>
        <li><span>\u{1F9ED}</span><div><b>Guida:</b> orari, servizi vicini, cosa vedere e i numeri utili.</div></li>
      </ul>
      <button class="btn gold block" id="onbClose">Ho capito, inizia</button>
      <button class="sos" id="onbSos"><b>Numeri utili & emergenze</b><p>Guardia medica, farmacia, spiaggia \u2014 sempre a portata di mano.</p></button>
    </div>
  </div>

  <!-- Accesso al primo avvio: la tessera \xE8 la credenziale principale (e-mail come riserva) -->
  <div class="gate" id="gate" role="dialog" aria-modal="true" aria-label="Accesso">
    <div class="gatebox">
      <div class="gate-brand">BUSSOLA<small>RESIDENCE \xB7 BY KOIN\xC8</small></div>
      <h2 class="serif">Benvenuto</h2>
      <p class="gsub2">Entra con la tua tessera per vedere il tuo profilo, la Coppa e gli inviti della casata.</p>
      <div class="gate-err" id="gateErr" aria-live="polite"></div>
      <label for="gate_tess">Codice tessera</label>
      <input id="gate_tess" placeholder="es. BR-2026-0001" autocapitalize="characters" autocomplete="off">
      <button class="btn gold block" id="gate_enter" style="margin-top:12px">Entra</button>
      <button class="btn ghost block" id="gate_email" style="margin-top:8px">Non ho la tessera \xB7 accedi con e-mail</button>
      <button class="gate-demo" id="gate_demo">Guarda in anteprima (demo)</button>
    </div>
  </div>
</div>

<script>
/* KOIN\xC8 Village \u2014 front-end utente.
   Legge i dati dalle API del server; se il server non \xE8 raggiungibile
   (es. file aperto da solo per anteprima) usa i dati incorporati SEED. */
'use strict';

// ---- Stato & preferenze (persistite quando possibile) ---------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('koine_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('koine_' + k, JSON.stringify(v)); } catch {} },
};
const state = {
  tessera: store.get('tessera', null),          // nessuna identit\xE0 finta al primo avvio
  token: store.get('token', null),
  authed: false,
  socio: null,
  online: true,
  lang: store.get('lang_code', 'it'),
  data: {},          // casate, eventi, risorse, sport, giochi, bussola
  conv: {},          // stato convocazioni locale: chiave -> stato
  rifiuti: 0,
};

// ---- Dati incorporati (fallback anteprima) --------------------------------
const SEED = {
  socio: { tessera_code: 'BR-2026-0001', nome: 'Ercole', cognome: '\u2014', ruolo: 'Socio', tipo_profilo: 'socio', casata: 'Aretusa', colore: '#2E6DA4', valida_fino: '2027-05-01', notifiche_push: true },
  luoghi: [ { chiave:'chiosco', nome:'Chiosco La Bussola', lat:36.967766, lng:15.221669 }, { chiave:'isola', nome:'Isola ecologica', lat:36.967209, lng:15.221206 } ],
  contest: { titolo:'Il mio nome \xE8 Bond, James Bond', tipo:'cocktail', settimana:'25\u201331 agosto', brief:'Dati 3 liquori, un\\'acqua tonica e un selz, crea il cocktail della tua casata. I primi 3 in vendita nel weekend; a fine settimana la graduatoria della giuria + il bonus vendite (4/2/1 pezzi venduti) assegna i punti Coppa.', stato:'annunciato', vincitore:null },
  serate: [
    { id:1, chiave:'apertura', titolo:'Apertura di stagione', quando:'Sab 30 maggio \xB7 unico turno 20:00', tema:'Presentazione e sfilata dei Clan', descrizione:'Cena unica alle 20:00, poi presentazione e sfilata delle otto casate. 10 punti al clan migliore, votato dagli altri.', quota:25, capienza:120, posti_liberi:120 },
    { id:2, chiave:'tema_luglio', titolo:'Serata a tema \xB7 fine luglio', quando:'Sab 25 luglio \xB7 20:00', tema:'Tema da annunciare', descrizione:'La serata a tema di fine luglio: il tema lo svela il CdA. Cena a numero chiuso.', quota:30, capienza:100, posti_liberi:100 },
    { id:3, chiave:'ferragosto', titolo:'Cena di Ferragosto', quando:'Sab 15 agosto \xB7 20:00', tema:'Gran serata', descrizione:'La serata clou dell\u2019estate: cena speciale con musica dal vivo. Posti limitati.', quota:40, capienza:140, posti_liberi:140 },
    { id:4, chiave:'fine_stagione', titolo:'Chiusura di stagione', quando:'Sab 12 settembre \xB7 20:00', tema:'Premiazione Coppa', descrizione:'Cena, premiazione della Coppa delle Casate e Albo d\u2019Oro.', quota:30, capienza:120, posti_liberi:120 },
  ],
  casate: [
    { nome: 'Ortigia', colore: '#B7791F', punti: 66 }, { nome: 'Aretusa', colore: '#2E6DA4', punti: 62 },
    { nome: 'Neapolis', colore: '#C0553F', punti: 54 }, { nome: 'Dionisio', colore: '#6E5AA6', punti: 50 },
    { nome: 'Ciane', colore: '#4d7a4a', punti: 47 }, { nome: 'Plemmirio', colore: '#12324F', punti: 44 },
    { nome: 'Epipoli', colore: '#7A8790', punti: 40 }, { nome: 'Anapo', colore: '#2E7D77', punti: 37 },
  ],
  eventi: [
    { chiave:'lun', giorno:'Luned\xEC', titolo:'Giornata libera', ambiente:'', colore:'#7A8790', sottotitolo:'Arrivi, partenze e riposo', descrizione:"Nessuna attivit\xE0 in cartellone: il luned\xEC coincide con il cambio degli ospiti (arrivi e partenze). \xC8 il giorno di riposo del residence.", cta:null, azione:null },
    { chiave:'mar', giorno:'Marted\xEC', titolo:'Vinile & Vino', ambiente:'Bussola Garden', colore:'#C0553F', sottotitolo:'Scegli tu la musica della serata', descrizione:'Proponi un vinile, i brani e il perch\xE9. Le proposte della settimana diventano la scaletta di quella dopo.', cta:'Proponi un vinile', azione:'sheet-vinile' },
    { chiave:'mer', giorno:'Mercoled\xEC', titolo:"Cinema d'autore sotto le stelle", ambiente:'Bussola Stage', colore:'#12324F', sottotitolo:"Ortigia Film Festival & titoli d'autore", descrizione:"Una proiezione a settimana: opere premiate all'Ortigia Film Festival, alternate a titoli pi\xF9 leggeri ma d'autore.", cta:'Prenota un posto', azione:null },
    { chiave:'gio', giorno:'Gioved\xEC', titolo:'Jazz & Cocktail', ambiente:'Bussola Garden', colore:'#2E7D77', sottotitolo:'La serata-firma \xB7 trio live', descrizione:'Trio live acustico, luci basse, cocktail. Si cena prima dello spettacolo.', cta:'Prenota un tavolo', azione:null },
    { chiave:'ven', giorno:'Venerd\xEC', titolo:'Serata dei Clan', ambiente:'Bussola Stage', colore:'#6E5AA6', sottotitolo:'Le otto casate si sfidano', descrizione:'Dall\u2019apericena a tarda sera. Questa settimana: karaoke. Coinvolgi un ospite e la tua casata guadagna punti.', cta:'Vai alla Coppa', azione:'go-coppa' },
    { chiave:'sab', giorno:'Sabato', titolo:'Live Session', ambiente:'Bussola Stage', colore:'#B7791F', sottotitolo:'Band e cantautori emergenti', descrizione:'Band e cantautori emergenti dal vivo sul Bussola Stage.', cta:'Prenota un posto', azione:null },
    { chiave:'dom', giorno:'Domenica', titolo:'Open Mic', ambiente:'Bussola Stage', colore:'#B7791F', sottotitolo:'Tre minuti di palco per te', descrizione:'Microfono aperto: canto, monologo, stand-up (linguaggio moderato) o strumento.', cta:'Salgo sul palco', azione:'sheet-openmic' },
  ],
  risorse: [
    { chiave:'pickleball', nome:'Campo di Pickleball', tipo:'sport', sottotitolo:'Turni da 90\u2032 \xB7 gioco 17\u201320', slots:['17:00\u201318:30','18:30\u201320:00'], nota:'Si gioca dalle 17 alle 20, per rispettare il silenzio pomeridiano.' },
    { chiave:'soft', nome:'Campo di Soft tennis', tipo:'sport', sottotitolo:'Turni da 90\u2032 \xB7 gioco 17\u201320', slots:['17:00\u201318:30','18:30\u201320:00'], nota:'Si gioca dalle 17 alle 20.' },
    { chiave:'cowo', nome:'Postazione Coworking', tipo:'coworking', sottotitolo:'Casa di Carta \xB7 wi-fi e caff\xE8', slots:['Mattina (9\u201313)','Pomeriggio (14\u201318)','Giornata intera'], nota:null },
    { chiave:'tavolo', nome:'Tavolo per la cena', tipo:'tavolo', sottotitolo:'~40 coperti \xB7 turni 20:00 e 21:30', slots:['20:00','21:30'], nota:'Indica quante persone. All\u2019apertura c\u2019\xE8 un unico turno alle 20:00 (segue la sfilata).' },
  ],
  bussola: {
    servizi: [ {titolo:'Farmacia',dettaglio:'Fontane Bianche',distanza:'~600 m'},{titolo:'Guardia medica',dettaglio:'Cassibile',distanza:'~5 km'},{titolo:'Spiaggia',dettaglio:'Fontane Bianche',distanza:'~300 m'},{titolo:'Market & alimentari',dettaglio:'Viale dei Lidi',distanza:'~700 m'},{titolo:'Bar & tabacchi',dettaglio:'Fontane Bianche',distanza:'~500 m'} ],
    vedere: [ {titolo:'Ortigia',dettaglio:'Centro storico \xB7 cultura',distanza:'~20 km'},{titolo:'Parco della Neapolis',dettaglio:'Teatro Greco \xB7 Orecchio di Dioniso',distanza:'~22 km'},{titolo:'Duomo di Siracusa',dettaglio:'Barocco',distanza:'~20 km'},{titolo:'Riserva del Plemmirio',dettaglio:'Area marina protetta',distanza:'~12 km'},{titolo:'Cavagrande del Cassibile',dettaglio:'Laghetti e sentieri',distanza:'~18 km'} ],
    rifiuti: ['Lun \xB7 Organico','Mar \xB7 Plastica','Mer \xB7 Carta','Gio \xB7 Organico','Ven \xB7 Vetro','Sab \xB7 Indifferenziato'].map(t=>({titolo:t})),
    orari: [ {titolo:'Silenzio pomeridiano',dettaglio:'Dalle 14:00 alle 17:00 \u2014 riposo per tutti.'},{titolo:'Silenzio notturno',dettaglio:'Dopo le 23:30 \u2014 si abbassano voci e musica.'} ],
  },
  sport: seedDisc([
    ['Pickleball',[['Aretusa','#2E6DA4',3,3,9],['Ortigia','#B7791F',3,2,6],['Ciane','#4d7a4a',3,1,3],['Epipoli','#7A8790',3,0,0]],[['Neapolis','#C0553F',3,2,6],['Dionisio','#6E5AA6',3,2,6],['Plemmirio','#12324F',3,1,3],['Anapo','#2E7D77',3,1,3]],[['Aretusa','Ortigia','Dom 17:30','Campo 1'],['Neapolis','Dionisio','Dom 19:00','Campo 1']],[['Aretusa','Ciane','11\u20136'],['Ortigia','Epipoli','11\u20139']]],
    ['Soft tennis',[['Aretusa','#2E6DA4',2,2,6],['Ortigia','#B7791F',2,1,3],['Ciane','#4d7a4a',2,1,3],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,6],['Dionisio','#6E5AA6',2,1,3],['Plemmirio','#12324F',2,1,3],['Anapo','#2E7D77',2,0,0]],[['Aretusa','Plemmirio','Gio 18:00','Campo 1']],[['Neapolis','Anapo','6\u20132']]],
    ['Basket 3\xD73',[['Aretusa','#2E6DA4',2,2,4],['Ortigia','#B7791F',2,1,2],['Ciane','#4d7a4a',2,1,2],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,4],['Dionisio','#6E5AA6',2,1,2],['Plemmirio','#12324F',2,1,2],['Anapo','#2E7D77',2,0,0]],[['Aretusa','Ciane','Sab 18:00','Campo residence']],[['Ortigia','Epipoli','21\u201315']]],
    ['Calcetto a 5',[['Aretusa','#2E6DA4',2,2,6],['Ortigia','#B7791F',2,1,3],['Ciane','#4d7a4a',2,1,3],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,6],['Dionisio','#6E5AA6',2,1,3],['Plemmirio','#12324F',2,0,1],['Anapo','#2E7D77',2,0,1]],[['Aretusa','Epipoli','Ven 18:30','Campo residence']],[['Ortigia','Ciane','5\u20133']]],
  ]),
  giochi: seedDisc([
    ['Burraco',[['Aretusa','#2E6DA4',3,3,9],['Ortigia','#B7791F',3,2,6],['Ciane','#4d7a4a',3,1,3],['Epipoli','#7A8790',3,0,0]],[['Neapolis','#C0553F',3,2,6],['Dionisio','#6E5AA6',3,2,6],['Plemmirio','#12324F',3,1,3],['Anapo','#2E7D77',3,1,3]],[['Aretusa','Neapolis','Mar 21:00','Casa di Carta']],[['Ciane','Epipoli','2\u20130']]],
    ['Scala 40',[['Aretusa','#2E6DA4',2,2,6],['Ortigia','#B7791F',2,1,3],['Ciane','#4d7a4a',2,1,3],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,6],['Dionisio','#6E5AA6',2,1,3],['Plemmirio','#12324F',2,0,1],['Anapo','#2E7D77',2,0,1]],[['Aretusa','Epipoli','Gio 21:30','Casa di Carta']],[['Ortigia','Ciane','1\u20130']]],
    ['Briscola/Scopa',[['Aretusa','#2E6DA4',2,2,4],['Ortigia','#B7791F',2,1,2],['Ciane','#4d7a4a',2,1,2],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,4],['Dionisio','#6E5AA6',2,1,2],['Plemmirio','#12324F',2,1,2],['Anapo','#2E7D77',2,0,0]],[['Aretusa','Ciane','Ven 21:00','Casa di Carta']],[['Ortigia','Epipoli','2\u20131']]],
    ['Scacchi/Dama',[['Aretusa','#2E6DA4',3,3,6],['Ortigia','#B7791F',3,2,4],['Ciane','#4d7a4a',3,1,2],['Epipoli','#7A8790',3,0,0]],[['Neapolis','#C0553F',3,2,4],['Dionisio','#6E5AA6',3,2,4],['Plemmirio','#12324F',3,1,2],['Anapo','#2E7D77',3,1,2]],[['Aretusa','Ortigia','Lun 21:00','Casa di Carta']],[['Dionisio','Plemmirio','1\u20130']]],
  ]),
};
function seedDisc(list) {
  return list.map(d => ({
    name: d[0],
    gironi: [ { nome:'Girone A', rows: d[1].map(r=>({t:r[0],c:r[1],pg:r[2],v:r[3],pt:r[4]})) },
              { nome:'Girone B', rows: d[2].map(r=>({t:r[0],c:r[1],pg:r[2],v:r[3],pt:r[4]})) } ],
    next: d[3].map(m=>({a:m[0],b:m[1],wh:m[2],court:m[3]})),
    results: d[4].map(m=>({a:m[0],b:m[1],s:m[2]})),
  }));
}

// ---- Helper API -----------------------------------------------------------
// Base del server: vuota = stessa origine (web); nell'APK collegata viene impostata
// window.KOINE_API con l'indirizzo del server online.
const API_BASE = (typeof window !== 'undefined' && window.KOINE_API) ? String(window.KOINE_API).replace(/\\/$/, '') : '';
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}), ...(opts.headers || {}) };
  const r = await fetch(API_BASE + '/api' + path, { ...opts, headers });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function loadAll() {
  try {
    const [casate, eventi, risorse, sport, giochi, bussola, luoghi, contest, serate, socio, regolamenti, albo, rifiuti] = await Promise.all([
      api('/casate'), api('/eventi'), api('/risorse'), api('/discipline/sport'),
      api('/discipline/giochi'), api('/bussola'), api('/luoghi').catch(() => SEED.luoghi),
      api('/contest/corrente').catch(() => SEED.contest),
      api('/serate').catch(() => SEED.serate),
      api('/tessera/' + state.tessera).catch(() => SEED.socio),
      api('/regolamenti').catch(() => ({ generali: [], discipline: [] })),
      api('/albo').catch(() => []),
      api('/rifiuti').catch(() => ({ tipi: [], calendari: [] })),
    ]);
    state.data = { casate, eventi, risorse, sport, giochi, bussola, luoghi, contest: contest || null, serate: serate || [], regolamenti: regolamenti || { generali: [], discipline: [] }, albo: albo || [], rifiuti: rifiuti || { tipi: [], calendari: [] } };
    state.socio = socio || SEED.socio;
    state.online = true;
  } catch (e) {
    state.data = { casate: SEED.casate, eventi: SEED.eventi, risorse: SEED.risorse, sport: SEED.sport, giochi: SEED.giochi, bussola: SEED.bussola, luoghi: SEED.luoghi, contest: SEED.contest, serate: SEED.serate, regolamenti: { generali: [], discipline: [] }, albo: [], rifiuti: { tipi: [], calendari: [] } };
    state.socio = SEED.socio;
    state.online = false;
  }
  document.getElementById('banner').classList.toggle('show', !state.online);
  applyProfileGating();
}

// ---- Utility --------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ---- Navigazione ----------------------------------------------------------
// Residente (ex "utente non socio"): niente tornei n\xE9 Coppa, solo eventi/guida/prenotazioni.
function isVisitatore() { const t = String(state.socio?.tipo_profilo || ''); return t === 'residente' || t === 'visitatore'; }
function applyProfileGating() {
  const v = isVisitatore();
  document.body.classList.toggle('no-tornei', v);
  if (v) { const cur = document.querySelector('.screen.active'); if (cur && ['s-sport', 's-giochi', 's-coppa'].includes(cur.id)) go('home'); }
}
function go(t) {
  if (isVisitatore() && ['sport', 'giochi', 'coppa'].includes(t)) t = 'home';   // schermate tornei non disponibili
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + t).classList.add('active');
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  $('#main').scrollTop = 0; closeOv();
}

// ---- Rendering schermate --------------------------------------------------
function renderHeader() {
  const s = state.socio;
  $('#greetName').textContent = tr('ciao') + ', ' + (s.nome || '');
  $('#greetSub').textContent = s.casata ? ('Casata ' + s.casata) : 'Benvenuto alla Bussola';
  $('#casataNm').textContent = s.casata || '\u2014';
  $('#casataSh').style.background = s.colore || '#2E6DA4';
}
function evCardHTML(e, withAction) {
  const action = withAction && e.azione
    ? \`<button class="btn gold sm" data-ev="\${e.chiave}" data-act="\${e.azione}">\${e.azione==='sheet-vinile'?'Proponi':(e.azione==='sheet-openmic'?'Salgo':(e.azione==='go-coppa'?'Coppa':'Info'))}</button>\`
    : \`<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>\`;
  const dl = e.ambiente ? \`\${esc(e.giorno)} \xB7 \${esc(e.ambiente)}\` : esc(e.giorno);
  return \`<div class="evcard" role="button" tabindex="0" data-open="\${e.chiave}"><span class="stripe" style="background:\${e.colore}"></span><div class="body"><div class="dl">\${dl}</div><h4>\${esc(e.titolo)}</h4><p>\${esc(e.sottotitolo)}</p></div><div class="cta">\${action}</div></div>\`;
}
function renderHome() {
  const evs = state.data.eventi;
  // Il "benvenuto" salta il luned\xEC vuoto: mostra la prima serata con attivit\xE0.
  const first = evs.find(e => e.tipo !== 'libero' && e.chiave !== 'lun') || evs[0];
  const hero = evs.find(e => e.chiave === 'gio') || evs[3] || evs[0];
  $('#s-home').innerHTML = \`
    <div class="welcome"><div class="wl"><div class="eyebrow">Benvenuti alla Bussola</div><h3>\${esc(first.giorno)} \xB7 \${esc(first.titolo)}</h3><p>\${esc(first.sottotitolo)}</p></div><button class="btn gold sm" data-open="\${first.chiave}">Vedi</button></div>
    <div class="hero" data-open="\${hero.chiave}" role="button" tabindex="0"><div class="eyebrow">Stasera alla Bussola</div><h2 class="serif">\${esc(hero.titolo)}</h2><p>\${esc(hero.sottotitolo)}</p><button class="btn gold" data-book="tavolo">\${esc(hero.cta)}</button></div>
    <div class="sect-title">Prenota</div>
    <div class="pgrid">
      <div class="ptile" role="button" tabindex="0" data-book="pickleball"><div class="ic">\u{1F3BE}</div><b>Pickleball</b><span>turni 90\u2032</span></div>
      <div class="ptile" role="button" tabindex="0" data-book="soft"><div class="ic">\u{1F3BE}</div><b>Soft tennis</b><span>turni 90\u2032</span></div>
      <div class="ptile" role="button" tabindex="0" data-book="cowo"><div class="ic">\u{1F4BB}</div><b>Coworking</b><span>postazione</span></div>
    </div>
    \${serateSectionHTML()}
    <div class="sect-title">Questa settimana</div>
    <div>\${evs.map(e => evCardHTML(e, true)).join('')}</div><div style="height:6px"></div>\`;
}
function serateSectionHTML() {
  const list = state.data.serate || [];
  if (!list.length) return '';
  return \`<div class="sect-title">Serate su prenotazione</div>
    <div>\${list.map(s => \`<div class="evcard" role="button" tabindex="0" data-serata="\${s.id}">
      <span class="stripe" style="background:#b14a35"></span>
      <div class="body"><div class="dl">\${esc(s.quando || '')}</div><h4>\${esc(s.titolo)}</h4><p>\u20AC \${esc(String(s.quota))} a persona\${s.posti_liberi != null ? \` \xB7 \${s.posti_liberi} posti\` : ''}</p></div>
      <div class="cta"><button class="btn gold sm" data-serata="\${s.id}">Prenota</button></div></div>\`).join('')}</div>\`;
}
function renderEventi() {
  $('#s-eventi').innerHTML = \`
    <div class="eyebrow" style="margin:4px 2px 2px">Il cartellone</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:4px">Il programma</h2>
    <p class="tiny muted" style="margin-bottom:12px">Tocca una serata per i dettagli e per prenotare.</p>
    <div>\${state.data.eventi.map(e => evCardHTML(e, false)).join('')}</div>
    <div class="note">Il pomeriggio \xE8 dello sport e delle famiglie; la sera, gli spettacoli che accompagnano la cena.</div>\`;
}
function renderCoppa() {
  const sorted = [...state.data.casate].sort((a, b) => b.punti - a.punti);
  const max = sorted[0].punti || 1;
  const mine = state.socio.casata || '';
  const myPos = sorted.findIndex(c => c.nome === mine) + 1;
  const myClan = sorted.find(c => c.nome === mine) || sorted[0];
  const isCap = String(state.socio.ruolo || '').toLowerCase() === 'capitano';
  const ct = state.data.contest;
  const contestCard = ct ? \`<div class="hero" data-open-contest role="button" tabindex="0" style="min-height:120px; margin-top:12px; background:linear-gradient(180deg, rgba(18,50,79,.15), rgba(18,50,79,.9)), linear-gradient(135deg,#6E5AA6,#b14a35)">
      <div class="eyebrow" style="color:#ffe1ac">Serata dei Clan \xB7 Contest\${ct.settimana ? ' \xB7 ' + esc(ct.settimana) : ''}</div>
      <h2 class="serif" style="font-size:1.3rem">\${esc(ct.titolo)}</h2>
      <p style="font-size:.8rem; opacity:.95">\${esc((ct.brief || '').slice(0, 90))}\${(ct.brief || '').length > 90 ? '\u2026' : ''}</p>
      <button class="btn gold sm" style="align-self:flex-start; margin-top:8px">Apri il contest</button>
    </div>\` : '';
  const capCard = isCap ? \`<div class="card" style="background:linear-gradient(135deg,#8a5a12,#6b4406); color:#fff; border:none; margin-top:12px">
      <div class="eyebrow" style="color:#ffe9c2">Strumenti del capitano \xB7 \${esc(mine)}</div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
        <button class="btn sm" style="background:#fff; color:var(--navy); flex:1" data-cap="convoca">\u{1F4E3} Convoca la casata</button>
        <button class="btn sm" style="background:rgba(255,255,255,.2); color:#fff; flex:1" data-cap="serata">\u{1F3C6} Serata dei Clan</button>
      </div></div>\` : '';
  $('#s-coppa').innerHTML = \`
    <div class="eyebrow" style="margin:4px 2px 2px">La comunit\xE0</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">Coppa delle Casate</h2>
    <div class="myclan"><div class="shield" style="background:\${myClan.colore}">\${esc(mine[0]||'A')}</div><div class="info"><h3>\${esc(mine)}</h3><p>La tua casata \xB7 \${esc(myClan.motto||'')}</p></div><div class="posbig"><div class="n">\${myPos||'\u2014'}\xB0</div><div class="l">posto</div></div></div>
    \${contestCard}\${capCard}
    <div class="card" style="margin-top:12px"><div class="eyebrow" style="color:var(--navy)">Classifica generale</div><div style="margin-top:6px">\${sorted.map((c,i)=>\`<div class="rank"><div class="rn">\${i+1}</div><div class="sh" style="background:\${c.colore}"></div><div class="nm">\${esc(c.nome)}</div><div class="bar"><span style="width:\${Math.round(c.punti/max*100)}%; background:\${c.colore}"></span></div><div class="pt">\${c.punti}</div></div>\`).join('')}</div></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--teal); font-size:1.4rem">\u{1F3BE}</div><div style="flex:1"><b>Campionati sport</b><p class="tiny muted">Gironi, calendario e risultati.</p></div><button class="btn navy sm" data-go="sport">Apri</button></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--plum); font-size:1.4rem">\u{1F0CF}</div><div style="flex:1"><b>Giochi da Tavolo</b><p class="tiny muted">Burraco, scala 40, briscola, scacchi.</p></div><button class="btn navy sm" data-go="giochi">Apri</button></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--gold); font-size:1.4rem">\u{1F4DC}</div><div style="flex:1"><b>Regolamenti & Albo d'Oro</b><p class="tiny muted">Regole di Coppa, Contest e Proposte; le edizioni passate.</p></div><button class="btn navy sm" data-sheet="regolamenti">Apri</button></div>\`;
}
function openRegolamenti() {
  const r = state.data.regolamenti || { generali: [], discipline: [] };
  const albo = state.data.albo || [];
  const blocco = (titolo, testo) => \`<div class="card" style="margin-top:10px"><div class="eyebrow" style="color:var(--navy)">\${esc(titolo)}</div><p class="tiny" style="white-space:pre-wrap; margin-top:4px">\${esc(testo || '\u2014')}</p></div>\`;
  const gen = (r.generali || []).map(x => blocco(x.titolo, x.testo)).join('');
  const disc = (r.discipline || []).map(d => blocco(\`\${d.nome}\${d.data_inizio ? ' \xB7 ' + d.data_inizio + (d.data_fine ? '\u2192' + d.data_fine : '') : ''}\`, d.regolamento)).join('');
  const alboHtml = albo.length ? \`<div class="sect-title" style="margin-top:14px">Albo d'Oro</div><div class="card" style="padding:4px 14px">\${albo.map(e => \`<div class="matchrow"><div class="vs">\${esc(e.disciplina_nome)}<div class="ct">\${esc((e.data_inizio || '') + (e.data_fine ? '\u2192' + e.data_fine : ''))}</div></div><div class="sc">\${esc(e.vincitore || '\u2014')}</div></div>\`).join('')}</div>\` : '';
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">Regole & storia</div><h2>Regolamenti</h2>
    <p class="sub">Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.</p>
    \${gen || '<p class="tiny muted">Nessun regolamento generale.</p>'}
    \${disc ? '<div class="sect-title" style="margin-top:14px">Discipline</div>' + disc : ''}
    \${alboHtml}
    <button class="btn navy block" style="margin-top:14px" data-close>Chiudi</button>\`);
  showOv();
}
const RIF_DAYS = [['lun','Lun'],['mar','Mar'],['mer','Mer'],['gio','Gio'],['ven','Ven'],['sab','Sab'],['dom','Dom']];
function rifTextColor(hex){ if(!hex) return '#fff'; const h=hex.replace('#',''); if(h.length<6) return '#fff'; const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),bl=parseInt(h.slice(4,6),16); return (r*0.299+g*0.587+bl*0.114)>150?'#1a1a1a':'#fff'; }
function rifiutiHTML(){
  const data = state.data.rifiuti || { tipi: [], calendari: [] };
  const tipi = data.tipi || [];
  const cal = data.calendari || [];
  if (!tipi.length && !cal.length) {
    return \`<div class="card"><p class="tiny muted">Calendario non ancora disponibile.</p></div>\`;
  }
  const colorOf = (nome) => (tipi.find(t => t.nome === nome) || {}).colore || '#7A8790';
  // iniziali univoche per la pastiglia (in caso di collisione si passa a due lettere)
  const inits = {}; const used = new Set();
  tipi.forEach(t => { const clean = (t.nome || '').replace(/[^0-9A-Za-z\xC0-\xFF]/g, ''); let ini = (clean[0] || '?').toUpperCase(); let i = 1; while (used.has(ini) && i < clean.length) { ini = (clean[0] + clean[i]).toUpperCase(); i++; } while (used.has(ini)) ini += '\xB7'; used.add(ini); inits[t.nome] = ini; });
  const norm = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);
  const legendChips = tipi.length ? \`<div class="chips" style="margin-top:10px">\${tipi.map(t => \`<span class="chip" style="cursor:default;background:\${esc(t.colore)};color:\${rifTextColor(t.colore)};border-color:\${esc(t.colore)}"><b style="opacity:.9">\${esc(inits[t.nome])}</b> \xB7 \${esc(t.nome)}</span>\`).join('')}</div>\` : '';
  const periods = cal.map(c => {
    const g = c.giorni || {};
    const cells = RIF_DAYS.map(([k,lbl]) => {
      const nomi = norm(g[k]);
      const pills = nomi.length
        ? nomi.map(nome => { const col = colorOf(nome); return \`<div title="\${esc(nome)}" style="width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:\${esc(col)};color:\${rifTextColor(col)};font-size:.62rem;font-weight:800">\${esc(inits[nome] || '\u2022')}</div>\`; }).join('')
        : \`<div style="width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#eef1f3;color:#b5bcc2;font-size:.62rem">\u2013</div>\`;
      return \`<div style="flex:1;min-width:30px;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:.6rem;font-weight:700;color:#5c6a73">\${lbl}</div>\${pills}</div>\`;
    }).join('');
    const info = [];
    if (c.inizio_conf || c.fine_conf) info.push(\`Conferimento \${esc(c.inizio_conf||'')}\${c.fine_conf?'\u2013'+esc(c.fine_conf):''}\`);
    if (c.ora_ritiro) info.push(\`Ritiro dalle \${esc(c.ora_ritiro)}\`);
    return \`<div class="card" style="margin-bottom:10px"><div style="font-weight:700;font-size:.85rem;color:var(--navy);margin-bottom:10px">\${esc(c.periodo)}</div><div style="display:flex;gap:3px">\${cells}</div>\${legendChips}\${info.length?\`<div class="tiny muted" style="margin-top:9px">\${info.join(' \xB7 ')}</div>\`:''}</div>\`;
  }).join('');
  return \`<div>\${periods || '<div class="card"><p class="tiny muted">Nessun periodo configurato.</p></div>'}</div>\`;
}
function renderBussola() {
  const b = state.data.bussola;
  const rows = (arr) => (arr||[]).map(x => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.8rem">\${esc(x.titolo)}</b>\${x.dettaglio?\`<div class="ct">\${esc(x.dettaglio)}</div>\`:''}</div>\${x.distanza?\`<span class="ct">\${esc(x.distanza)}</span>\`:''}</div>\`).join('');
  const luoghi = state.data.luoghi || SEED.luoghi;
  const iconFor = (k) => k === 'isola' ? '\u267B\uFE0F' : '\u{1F4CD}';
  const siamoQui = luoghi.map(l => {
    const label = tr(l.chiave) || l.nome;
    const has = l.lat != null && l.lng != null;
    const right = l.chiave === 'chiosco'
      ? \`<span style="background:var(--coral);color:#fff;padding:3px 10px;border-radius:12px;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px">\${esc(tr('siamo_qui'))}</span>\`
      : \`<span style="color:var(--teal);font-size:1.1rem">\u2197</span>\`;
    return \`<div class="matchrow" \${has ? \`role="button" tabindex="0" data-map="\${l.lat},\${l.lng}" style="cursor:pointer"\` : ''}><div style="flex:1"><b style="font-size:.9rem">\${iconFor(l.chiave)} \${esc(label)}</b>\${has ? \`<div class="ct">\${esc(tr('apri_mappa'))}</div>\` : ''}</div>\${right}</div>\`;
  }).join('');
  $('#s-bussola').innerHTML = \`
    <div class="eyebrow" style="margin:4px 2px 2px">Guida del residence</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">Bussola Residence</h2>
    <div class="sect-title" style="margin-top:2px">\${esc(tr('siamo_qui'))}</div>
    <div class="card" style="padding:4px 14px">\${siamoQui}</div>
    <div class="card" style="background:#fbf4e6; border-color:#ecdcbd; margin-top:11px">
      <div class="benefit" style="border-color:#ecdcbd"><span style="font-size:1.1rem">\u{1F92B}</span><div><b>Silenzio pomeridiano</b><p style="color:#5c4d2a">\${esc(b.orari?.[0]?.dettaglio||'14:00\u201317:00')}</p></div></div>
      <div class="benefit"><span style="font-size:1.1rem">\u{1F319}</span><div><b>Silenzio notturno</b><p style="color:#5c4d2a">\${esc(b.orari?.[1]?.dettaglio||'dopo le 23:30')}</p></div></div>
    </div>
    <div class="sect-title">Numeri utili & servizi</div><div class="card" style="padding:4px 14px">\${rows(b.servizi)}</div>
    <div class="sect-title">Raccolta rifiuti</div>\${rifiutiHTML()}
    <div class="sect-title">Cosa vedere</div><div class="card" style="padding:4px 14px">\${rows(b.vedere)}</div>
    <div style="height:6px"></div>\`;
}

/* Sport & Giochi con convocazione */
const DOMAINS = { sport: { cur: 0 }, giochi: { cur: 0 } };
function renderDom(dom) {
  const list = state.data[dom]; if (!list || !list.length) return;
  const D = DOMAINS[dom]; const s = list[D.cur];
  const key = dom + '/' + D.cur; const st = state.conv[key] || 'open';
  const el = document.getElementById('s-' + dom);
  const disc = \`<div class="discrow" role="tablist">\${list.map((d,i)=>\`<button class="disc\${i===D.cur?' on':''}" data-dom="\${dom}" data-i="\${i}">\${esc(d.name)}</button>\`).join('')}</div>\`;
  const conv = s.next[0] || { a: state.socio.casata, b: '\u2014', wh: 'prossimamente', court: '' };
  const matchLabel = \`\${conv.a} vs \${conv.b}\`;
  const isOspite = state.socio.tipo_profilo === 'ospite_temporaneo';
  let personal;
  if (st === 'ok') {
    personal = \`<div class="card" style="background:linear-gradient(135deg,#5f9a5c,#3f6b3d); color:#fff; border:none"><div class="eyebrow" style="color:#e8f3e2">Presenza confermata \u2713</div><div style="margin-top:6px"><b style="font-size:.9rem">\${esc(matchLabel)}</b><div class="tiny" style="opacity:.9">\${esc(conv.wh)} \xB7 \${esc(conv.court)}</div></div></div>\`;
  } else if (!isOspite && state.rifiuti >= 3) {
    personal = \`<div class="card" style="background:linear-gradient(135deg,#c0553f,#9c3f2c); color:#fff; border:none"><div class="eyebrow" style="color:#ffd9cf">Convocazione vincolante</div><div style="margin-top:6px"><b>\${esc(matchLabel)}</b><div class="tiny" style="opacity:.9">\${esc(conv.wh)} \xB7 \${esc(conv.court)}</div></div><div class="tiny" style="margin-top:8px">Hai gi\xE0 declinato tre volte in stagione: questa convocazione \xE8 vincolante.</div><button class="btn gold sm" style="margin-top:10px" data-conv="ok" data-key="\${key}">Confermo</button></div>\`;
  } else if (st === 'no') {
    personal = \`<div class="card" style="display:flex; align-items:center; gap:12px"><div style="flex:1"><b>Hai declinato</b><p class="tiny muted">\${esc(matchLabel)}\${isOspite?'' :\` \xB7 dinieghi \${state.rifiuti}/3\`}</p></div><button class="btn gold sm" data-conv="ok" data-key="\${key}">Ci ripenso</button></div>\`;
  } else {
    const footer = isOspite
      ? \`<div class="tiny" style="opacity:.85; margin-top:9px">Sei nostro ospite: partecipa quando vuoi, nessun obbligo.</div>\`
      : \`<div class="tiny" style="opacity:.8; margin-top:9px">Dinieghi: \${state.rifiuti}/3 \xB7 diventa vincolante solo dopo il terzo</div>\`;
    personal = \`<div class="card" style="background:linear-gradient(135deg,var(--navy),#1d4a6e); color:#fff; border:none"><div class="eyebrow" style="color:#ffe1ac">La tua casata ti invita</div><div style="margin-top:6px"><b>\${esc(matchLabel)}</b><div class="tiny" style="opacity:.85">\${esc(conv.wh)} \xB7 \${esc(conv.court)}</div></div><div style="display:flex; gap:8px; margin-top:12px"><button class="btn gold sm" data-conv="ok" data-key="\${key}">Disponibile</button><button class="btn ghost sm" style="color:#fff; border-color:rgba(255,255,255,.45)" data-conv="no" data-key="\${key}">Non disponibile</button></div>\${footer}</div>\`;
  }
  const gironi = s.gironi.map(g => \`<div class="card"><div class="eyebrow" style="color:var(--navy)">\${esc(g.nome)}</div><table class="gtable"><thead><tr><th style="text-align:left; padding-left:2px">Squadra</th><th>PG</th><th>V</th><th>Pt</th></tr></thead><tbody>\${g.rows.map((r,i)=>\`<tr><td class="team"><span class="gpos">\${i+1}</span><span class="d" style="background:\${r.c}"></span>\${esc(r.t)}</td><td>\${r.pg}</td><td>\${r.v}</td><td style="font-weight:700; color:var(--navy)">\${r.pt}</td></tr>\`).join('')}</tbody></table></div>\`).join('');
  const next = \`<div class="sect-title">Prossime partite</div><div class="card" style="padding:4px 14px">\${s.next.map(m=>\`<div class="matchrow"><div class="wh">\${esc(m.wh)}</div><div class="vs">\${esc(m.a)} <small>vs</small> \${esc(m.b)}<div class="ct">\${esc(m.court)}</div></div></div>\`).join('')||'<p class="tiny muted" style="padding:8px 0">Calendario in aggiornamento.</p>'}</div>\`;
  const res = \`<div class="sect-title">Risultati recenti</div><div class="card" style="padding:4px 14px">\${s.results.map(m=>\`<div class="matchrow"><div class="vs">\${esc(m.a)} <small>vs</small> \${esc(m.b)}</div><div class="sc">\${esc(m.s)}</div></div>\`).join('')||'<p class="tiny muted" style="padding:8px 0">Nessun risultato ancora.</p>'}</div>\`;
  const note = \`<div class="note">Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.</div>\`;
  const head = \`<div class="eyebrow" style="margin:4px 2px 2px">\${dom==='sport'?'Campionati sociali':'Tornei \xB7 Casa di Carta'}</div><h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">\${dom==='sport'?'Sport & Tornei':'Giochi da Tavolo'}</h2>\`;
  el.innerHTML = head + disc + personal + gironi + next + res + note;
}

// ---- Overlay / sheet ------------------------------------------------------
function setSheet(html) { $('#sheetbox').innerHTML = html; }
function showOv() { $('#ov').classList.add('show'); $('.sheet').scrollTop = 0; }
function closeOv() { $('#ov').classList.remove('show'); if (!state.tessera && !state.token) showGate(); }
function openEvent(k) {
  const e = state.data.eventi.find(x => x.chiave === k); if (!e) return;
  let btn;
  if (e.azione === 'go-coppa') btn = \`<button class="btn gold block" data-go="coppa">\${esc(e.cta)}</button>\`;
  else if (e.azione) btn = \`<button class="btn gold block" data-sheet="\${e.azione}">\${esc(e.cta)}</button>\`;
  else btn = \`<button class="btn gold block" data-confirm="\${esc(e.titolo)}">\${esc(e.cta)}</button>\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:\${e.colore}">\${esc(e.giorno)} \xB7 \${esc(e.ambiente)}</div><h2>\${esc(e.titolo)}</h2><p class="sub">\${esc(e.descrizione)}</p>\${btn}<button class="btn ghost block" style="margin-top:8px" data-close>Chiudi</button>\`);
  showOv();
}
function openBooking(kind) {
  const b = state.data.risorse.find(r => r.chiave === kind) || SEED.risorse.find(r => r.chiave === kind);
  if (!b) return;
  const days = ['Oggi','Domani','Sab','Dom','Lun'];
  const capNota = b.tipo === 'coworking' ? \`<div class="note">Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.</div>\` : '';
  const personeField = b.tipo === 'tavolo'
    ? \`<div class="field"><label>Quante persone</label><div class="chips" data-group="pers">\${[1,2,3,4,5,6].map((n,i)=>\`<button class="chip\${i===1?' sel':''}" data-chip>\${n}</button>\`).join('')}</div></div>\` : '';
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">Prenotazione</div><h2>\${esc(b.nome)}</h2><p class="sub">\${esc(b.sottotitolo)}</p>
    <div class="field"><label>Giorno</label><div class="chips" data-group="day">\${days.map((d,i)=>\`<button class="chip\${i===0?' sel':''}" data-chip>\${d}</button>\`).join('')}</div></div>
    <div class="field"><label>Turno</label><div class="chips" data-group="slot">\${b.slots.map((s,i)=>\`<button class="chip\${i===0?' sel':''}" data-chip>\${esc(s)}</button>\`).join('')}</div></div>
    \${personeField}\${capNota}\${b.nota?\`<div class="note">\${esc(b.nota)}</div>\`:''}
    <button class="btn gold block" style="margin-top:10px" data-do-book="\${b.chiave}">Conferma prenotazione</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>Annulla</button>\`);
  showOv();
}
async function openTessera() {
  const s = state.socio;
  const pushOn = !!s.notifiche_push;
  let notifHtml = '', convHtml = '';
  if (state.token) {
    try {
      const list = await api('/auth/notifiche');
      notifHtml = \`<div class="sect-title" style="margin-top:12px">Le mie notifiche</div><div class="card" style="padding:4px 14px">\${list.length ? list.map(n => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.82rem">\${esc(n.titolo)}</b><div class="ct">\${esc(n.corpo || '')}</div></div>\${n.letta ? '' : '<span style="background:var(--gold);color:#fff;padding:2px 8px;border-radius:10px;font-size:.58rem;font-weight:700">nuovo</span>'}</div>\`).join('') : '<p class="tiny muted" style="padding:8px 0">Nessuna notifica.</p>'}</div>\`;
    } catch {}
    try {
      const cs = (await api('/convocazioni/' + state.tessera)).filter(c => c.stato === 'aperta' || c.stato === 'obbligatoria');
      if (cs.length) convHtml = \`<div class="sect-title" style="margin-top:12px">Le tue convocazioni</div><div class="card" style="padding:4px 14px">\${cs.map(c => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.85rem">\${esc(c.disciplina)}</b><div class="ct">\${esc(c.match_label || '')}</div></div><div style="display:flex; gap:6px"><button class="btn gold sm" data-convrisp="\${c.id}|disponibile">Ci sono</button><button class="btn ghost sm" data-convrisp="\${c.id}|non_disponibile">No</button></div></div>\`).join('')}</div>\`;
    } catch {}
  }
  setSheet(\`<div class="grab"></div>
    <div class="tessera"><div class="lab">BUSSOLA \xB7 by KOIN\xC8</div><h2 class="serif" style="color:#fff">\${esc(s.nome)} \${esc(s.cognome||'')}</h2><div class="role">\${esc(s.ruolo||'Socio')} \xB7 Casata \${esc(s.casata||'')}</div>
      <div class="qr">\${qrSvg(s.tessera_code)}</div>
      <div class="foot"><span class="tiny" style="opacity:.85">Tessera \${esc(s.tessera_code)}</span><span class="tiny" style="opacity:.85">Valida fino al \${esc((s.valida_fino||'').split('-').reverse().join('/'))}</span></div></div>
    <div class="card" style="margin-top:12px; display:flex; align-items:center; gap:12px">
      <div style="flex:1"><b style="font-size:.86rem">Notifiche casata & eventi</b><p class="tiny muted">Convocazioni, cambi orario e serate. Con il tuo consenso.</p></div>
      <button class="btn \${pushOn?'gold':'ghost'} sm" data-push="\${pushOn?'off':'on'}">\${pushOn?'Attive \u2713':'Attiva'}</button>
    </div>
    \${convHtml}\${notifHtml}
    <div class="sect-title" style="margin-top:12px">Cosa ti d\xE0</div>
    <div class="card">
      <div class="benefit"><span class="bic">\u2713</span><div><b>Giochi la Coppa delle Casate</b><p>Sport, giochi da tavolo e prove artistiche con il tuo clan.</p></div></div>
      <div class="benefit"><span class="bic">\u2713</span><div><b>Inviti della casata</b><p>Rispondi disponibile o no, senza biglietto n\xE9 consumazione obbligatoria.</p></div></div>
      <div class="benefit"><span class="bic">\u25CB</span><div><b>Copertura infortuni <span class="tiny" style="color:var(--coral)">in definizione</span></b><p>Stiamo valutando con la compagnia una copertura per le attivit\xE0 sportive.</p></div></div>
      <div class="benefit"><span class="bic">\u2713</span><div><b>Il tuo posto nell'Albo d'Oro</b><p>I vincitori della stagione restano scritti alla Bussola.</p></div></div>
    </div>
    <button class="btn ghost block" style="margin-top:12px" data-logout>Esci / cambia tessera</button>
    <button class="btn navy block" style="margin-top:8px" data-close>Chiudi</button>\`);
  showOv();
}
function openLoginOtp() {
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">Accesso</div><h2>Entra con la tua e-mail</h2><p class="sub">Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.</p>
    <div class="field"><label>La tua e-mail</label><input id="ol_email" type="email" placeholder="nome@example.com" value="socio@example.com"></div>
    <div class="err" id="ol_err" style="color:var(--coral); font-size:.75rem; min-height:16px"></div>
    <button class="btn gold block" data-otp-req>Invia il codice</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>Annulla</button>\`);
  showOv();
}
async function requestOtp() {
  const email = $('#ol_email').value.trim();
  if (!email.includes('@')) { $('#ol_err').textContent = 'Inserisci un\u2019e-mail valida'; return; }
  let devCode = '';
  try { const r = await api('/auth/request-otp', { method:'POST', body: JSON.stringify({ email }) }); devCode = r.dev_code || ''; } catch {}
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">Verifica</div><h2>Inserisci il codice</h2><p class="sub">Ti abbiamo inviato un codice a \${esc(email)}.</p>
    \${devCode?\`<div class="note">Modalit\xE0 test: il codice \xE8 <b>\${esc(devCode)}</b> (in produzione arriva via e-mail/SMS).</div>\`:''}
    <div class="field"><label>Codice a 6 cifre</label><input id="ol_code" inputmode="numeric" placeholder="______" value="\${esc(devCode)}"></div>
    <div class="err" id="ol_err" style="color:var(--coral); font-size:.75rem; min-height:16px"></div>
    <button class="btn gold block" data-otp-verify="\${esc(email)}">Entra</button>
    <button class="btn ghost block" style="margin-top:8px" data-login>Cambia e-mail</button>\`);
  showOv();
}
async function verifyOtp(email) {
  const code = $('#ol_code').value.trim();
  try {
    const r = await api('/auth/verify-otp', { method:'POST', body: JSON.stringify({ email, code }) });
    state.token = r.token; state.tessera = r.socio.tessera_code; state.authed = true;
    store.set('token', r.token); store.set('tessera', r.socio.tessera_code);
    hideGate(); closeOv();
    await enterApp();
    okThen('Bentornato, ' + r.socio.nome);
  } catch { $('#ol_err').textContent = 'Codice non valido o scaduto'; }
}

// ---- Accesso al primo avvio (gate): tessera principale, e-mail di riserva ------
function showGate() { const g = $('#gate'); if (g) { g.classList.add('show'); const i = $('#gate_tess'); if (i) setTimeout(() => i.focus(), 60); } }
function hideGate() { const g = $('#gate'); if (g) g.classList.remove('show'); }
async function enterApp() {
  await loadAll();
  renderHeader(); renderHome(); renderEventi(); renderCoppa(); renderBussola(); renderDom('sport'); renderDom('giochi');
  applyProfileGating();
  if (state.lang && state.lang !== 'it') applyLang(state.lang);
}
async function loginTessera() {
  const code = ($('#gate_tess').value || '').trim().toUpperCase();
  const err = $('#gateErr');
  if (err) err.textContent = '';
  if (!code) { if (err) err.textContent = 'Inserisci il codice tessera.'; return; }
  try {
    const r = await api('/auth/login-tessera', { method: 'POST', body: JSON.stringify({ tessera_code: code }) });
    state.token = r.token; state.tessera = r.socio.tessera_code; state.authed = true;
    store.set('token', r.token); store.set('tessera', r.socio.tessera_code);
    hideGate();
    await enterApp();
    if (!store.get('seen', false)) $('#onb').classList.add('show');
  } catch (e) {
    if (err) err.textContent = 'Tessera non trovata. Controlla il codice o usa l\u2019e-mail.';
  }
}
function demoPreview() {   // solo per anteprima: usa la tessera demo e i dati SEED se offline
  state.tessera = 'BR-2026-0001'; store.set('tessera', state.tessera);
  hideGate(); enterApp();
}
function logoutUser() {
  state.token = null; state.tessera = null; state.authed = false; state.socio = null;
  store.set('token', null); store.set('tessera', null);
  closeOv(); showGate();
}
async function togglefPush(to) {
  const on = to === 'on';
  if (state.token) { try { await api('/auth/notifiche/consenso', { method:'POST', body: JSON.stringify({ attivo: on }) }); } catch {} }
  state.socio.notifiche_push = on;
  okThen(on ? 'Notifiche attivate: ti avviseremo per casata ed eventi' : 'Notifiche disattivate');
}
const SHEETS = {
  'sheet-vinile': () => \`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">Marted\xEC \xB7 Vinile & Vino</div><h2>Proponi un vinile</h2><p class="sub">Le proposte di questa settimana diventano la scaletta di marted\xEC prossimo.</p>
    <div class="field"><label>Quale vinile?</label><input id="in1" placeholder="Es. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4"></div>
    <div class="field"><label>I brani che vuoi ascoltare</label><input id="in2" placeholder="Es. Cr\xEAuza de m\xE4, Sid\xFAn"></div>
    <div class="field"><label>Perch\xE9 lo proponi?</label><textarea id="in3" placeholder="In due righe cosa significa per te..."></textarea></div>
    <button class="btn gold block" data-proposta="vinile">Invia la proposta</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>Annulla</button>\`,
  'sheet-openmic': () => \`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">Domenica \xB7 Open Mic</div><h2>Salgo sul palco</h2><p class="sub">Hai tre minuti. Scegli cosa porti sul Bussola Stage.</p>
    <div class="field"><label>La tua esibizione</label><div class="chips" data-group="tipo"><button class="chip" data-chip>\u{1F3A4} Canto</button><button class="chip" data-chip>\u{1F3AD} Monologo</button><button class="chip" data-chip>\u{1F604} Stand-up</button><button class="chip" data-chip>\u{1F3B8} Strumento</button></div></div>
    <div class="field"><label>Titolo / cosa presenti</label><input id="in1" placeholder="Es. 'Caruso' alla chitarra"></div>
    <div class="note">La stand-up \xE8 benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.</div>
    <button class="btn gold block" style="margin-top:12px" data-proposta="openmic">Prenota i miei tre minuti</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>Annulla</button>\`,
};
function openSheet(id) { setSheet(SHEETS[id]()); showOv(); }
function okThen(msg, ok = true) {
  const icon = ok ? '<path d="M5 13l4 4L19 7"/>' : '<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>';
  const bg = ok ? '' : 'background:var(--coral)';
  const title = ok ? 'Fatto!' : 'Un momento';
  const tail = ok ? ". Lo trovi nell'app e te lo ricordiamo noi." : '';
  setSheet(\`<div class="grab"></div><div class="okmsg" style="text-align:center; padding:12px 0 4px"><div class="big" style="\${bg}"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" aria-hidden="true">\${icon}</svg></div><h2 style="text-align:center">\${title}</h2><p class="sub" style="text-align:center">\${esc(msg)}\${tail}</p></div><button class="btn navy block" style="margin-top:6px" data-close>\${ok ? 'Perfetto' : 'Ho capito'}</button>\`);
  showOv();
}
// Lingue: 5 con traduzione fissa salvata + 2 (zh/ja) con traduzione automatica.
const LANGS = [['it','Italiano','fixed'],['en','English','fixed'],['fr','Fran\xE7ais','fixed'],['de','Deutsch','fixed'],['es','Espa\xF1ol','fixed'],['zh','\u4E2D\u6587 \xB7 auto','auto'],['ja','\u65E5\u672C\u8A9E \xB7 auto','auto']];
const I18N = {
  it:{home:'Home',eventi:'Eventi',sport:'Sport',giochi:'Giochi',bussola:'Guida',ciao:'Ciao',testo:'Testo',contrasto:'Contrasto',siamo_qui:'Siamo qui',chiosco:'Chiosco La Bussola',isola:'Isola ecologica',qui:'sei qui',apri_mappa:'Tocca per aprire la mappa'},
  en:{home:'Home',eventi:'Events',sport:'Sport',giochi:'Games',bussola:'Guide',ciao:'Hi',testo:'Text',contrasto:'Contrast',siamo_qui:'You are here',chiosco:'La Bussola kiosk',isola:'Recycling point',qui:'you are here',apri_mappa:'Tap to open the map'},
  fr:{home:'Accueil',eventi:'\xC9v\xE9nements',sport:'Sport',giochi:'Jeux',bussola:'Guide',ciao:'Bonjour',testo:'Texte',contrasto:'Contraste',siamo_qui:'Vous \xEAtes ici',chiosco:'Kiosque La Bussola',isola:'Point de tri',qui:'vous \xEAtes ici',apri_mappa:'Touchez pour ouvrir la carte'},
  de:{home:'Start',eventi:'Events',sport:'Sport',giochi:'Spiele',bussola:'Guide',ciao:'Hallo',testo:'Text',contrasto:'Kontrast',siamo_qui:'Sie sind hier',chiosco:'Kiosk La Bussola',isola:'Wertstoffinsel',qui:'Sie sind hier',apri_mappa:'Zum \xD6ffnen der Karte tippen'},
  es:{home:'Inicio',eventi:'Eventos',sport:'Deporte',giochi:'Juegos',bussola:'Gu\xEDa',ciao:'Hola',testo:'Texto',contrasto:'Contraste',siamo_qui:'Est\xE1s aqu\xED',chiosco:'Quiosco La Bussola',isola:'Punto de reciclaje',qui:'est\xE1s aqu\xED',apri_mappa:'Toca para abrir el mapa'},
};
function tr(k){ return (I18N[state.lang] || I18N.it)[k] || I18N.it[k]; }
function applyLang(code){
  state.lang = code; store.set('lang_code', code);
  const el = $('#langLbl'); if (el) el.textContent = code.toUpperCase().slice(0,2);
  const src = I18N[code] || I18N.en; // zh/ja: senza dizionario salvato ricadono sull'inglese finch\xE9 non c'\xE8 il motore online
  document.querySelectorAll('.tab').forEach(b => { const k = b.dataset.t; if (src[k]) { const svg = b.querySelector('svg'); b.textContent=''; if (svg) b.appendChild(svg); b.appendChild(document.createTextNode(src[k])); } });
  const lbl = document.querySelector('.a11y .lbl'); if (lbl) lbl.textContent = src.testo || 'Testo';
  const hc = $('#hcBtn'); if (hc) hc.textContent = '\u25D1 ' + (src.contrasto || 'Contrasto');
  renderHeader();
  // Ridisegno le schermate con testi tradotti (es. la sezione "Siamo qui" della Guida).
  try { renderBussola(); } catch {}
}
function openLang() {
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">Lingua \xB7 Language</div><h2>Scegli la lingua</h2><p class="sub">Le prime cinque hanno traduzione salvata; cinese e giapponese sono tradotti automaticamente.</p>
    <div class="chips" style="flex-direction:column; align-items:stretch">\${LANGS.map(l=>\`<button class="chip" style="text-align:left; display:flex; justify-content:space-between; align-items:center" data-lang="\${l[0]}">\${l[1]}\${l[2]==='auto'?' <span class="tiny muted">automatica</span>':''}</button>\`).join('')}</div>
    <button class="btn ghost block" style="margin-top:10px" data-close>Chiudi</button>\`);
  showOv();
}
function openSos() {
  const serv = state.data.bussola?.servizi || SEED.bussola.servizi;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">Numeri utili</div><h2>Emergenze & servizi</h2><p class="sub">In caso di necessit\xE0.</p>
    <div class="card" style="padding:4px 14px">\${serv.map(x=>\`<div class="matchrow"><div style="flex:1"><b style="font-size:.85rem">\${esc(x.titolo)}</b><div class="ct">\${esc(x.dettaglio||'')}</div></div><span class="ct">\${esc(x.distanza||'')}</span></div>\`).join('')}
      <div class="matchrow"><div style="flex:1"><b style="font-size:.85rem; color:var(--coral)">Emergenze (112)</b><div class="ct">Numero unico europeo</div></div></div></div>
    <button class="btn navy block" style="margin-top:12px" data-close>Chiudi</button>\`);
  showOv();
}

// ---- Modalit\xE0 CAPITANO ----------------------------------------------------
let _serataText = '', _capPartite = [], _capCurrent = null;
async function openCapConvoca() {
  let partite = [];
  try { partite = await api('/auth/capitano/partite'); } catch {}
  _capPartite = partite;
  if (!partite.length) {
    setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">Capitano \xB7 \${esc(state.socio.casata || '')}</div><h2>Convoca la tua casata</h2><p class="sub">Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).</p><button class="btn navy block" data-close>Chiudi</button>\`);
    return showOv();
  }
  const rows = partite.map((p, i) => {
    const short = p.disponibili < p.minimo;
    return \`<div class="card" style="padding:12px; margin-bottom:8px">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div style="flex:1"><b style="font-size:.9rem">\${esc(p.disciplina)} \xB7 G\${p.giornata}</b><div class="ct">vs \${esc(p.avversario)}</div></div>
        <div style="text-align:center"><div style="font-family:Georgia,serif; font-weight:700; font-size:1.2rem; color:\${short ? 'var(--coral)' : 'var(--sage)'}">\${p.disponibili}/\${p.minimo}</div><div class="ct">dispon.</div></div>
      </div>
      <button class="btn \${short ? 'gold' : 'ghost'} sm" style="margin-top:8px; width:100%" data-capm="\${i}">\${short ? 'Serve gente \u2014 convoca' : 'Convoca giocatori'}</button>
    </div>\`;
  }).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">Capitano \xB7 \${esc(state.socio.casata || '')}</div><h2>Chi copre le partite?</h2><p class="sub">Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.</p>\${rows}<button class="btn navy block" style="margin-top:6px" data-close>Chiudi</button>\`);
  showOv();
}
function openCapMembri(idx) {
  const p = _capPartite[idx]; if (!p) return;
  _capCurrent = p;
  const rows = p.membri.map(m => {
    const conv = m.stato !== 'non_convocato';
    const badge = m.stato === 'disponibile' ? '<span style="color:var(--sage); font-weight:700">disponibile</span>'
      : m.stato === 'non_disponibile' ? '<span style="color:var(--coral)">non disp.</span>'
      : conv ? '<span class="muted">in attesa</span>' : '';
    return \`<label style="display:flex; gap:10px; align-items:center; padding:9px 2px; border-bottom:1px solid var(--line)">
      <input type="checkbox" data-capchk value="\${m.id}" \${conv ? 'disabled checked' : ''} style="width:auto; transform:scale(1.3)">
      <span style="flex:1">\${esc(m.nome)}</span>\${badge}</label>\`;
  }).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${esc(p.disciplina)} \xB7 G\${p.giornata}</div><h2>Convoca i giocatori</h2><p class="sub">vs \${esc(p.avversario)} \u2014 servono \${p.minimo}, disponibili \${p.disponibili}. Spunta chi vuoi convocare.</p>
    <div class="card" style="padding:2px 14px">\${rows}</div>
    <button class="btn gold block" style="margin-top:12px" data-capsend>Convoca i selezionati</button>
    <button class="btn ghost block" style="margin-top:8px" data-cap="convoca">\u2190 Torna alle partite</button>\`);
  showOv();
}
async function capSendMirata() {
  const ids = [...document.querySelectorAll('[data-capchk]:not(:disabled):checked')].map(c => Number(c.value));
  if (!ids.length) { okThen('Seleziona almeno un giocatore'); return; }
  try { const r = await api('/auth/capitano/convoca-mirata', { method: 'POST', body: JSON.stringify({ partita_id: _capCurrent.partita_id, socio_ids: ids }) }); okThen(\`Convocati \${r.convocati} giocatori\`); }
  catch { okThen('Non riesco a convocare ora'); }
}
function openCapSerata() {
  const sorted = [...state.data.casate].sort((a, b) => b.punti - a.punti);
  const mine = state.socio.casata; const pos = sorted.findIndex(c => c.nome === mine) + 1;
  const my = sorted.find(c => c.nome === mine) || sorted[0];
  const ct = state.data.contest;
  const titolo = ct ? ct.titolo : 'Serata dei Clan';
  const sfida = ct ? (ct.brief || '') : ((state.data.eventi || []).find(e => e.chiave === 'ven')?.descrizione || 'La sfida di venerd\xEC');
  _serataText = \`\u{1F3AC} Serata dei Clan \u2014 "\${titolo}"\${ct && ct.settimana ? \` (\${ct.settimana})\` : ''}\\n\${sfida}\\nCasata \${mine}: siamo \${pos}\xB0 con \${my.punti} punti. Forza \${mine}! \u{1F4AA}\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">Capitano \xB7 Serata dei Clan</div><h2>\${esc(titolo)}</h2>
    <div class="card" style="background:linear-gradient(135deg,\${my.colore || '#12324F'},#0d2740); color:#fff; border:none">
      <div class="eyebrow" style="color:#ffe1ac">Casata \${esc(mine)} \xB7 \${pos}\xB0 posto \xB7 \${my.punti} punti</div>
      <p style="font-size:.85rem; opacity:.95; margin-top:6px; white-space:pre-wrap">\${esc(sfida)}</p>
      <p style="font-size:.8rem; opacity:.85; margin-top:8px">Rilancia la sfida ai tuoi. Forza \${esc(mine)}!</p>
    </div>
    <button class="btn gold block" style="margin-top:12px" data-cap="share">Condividi con la casata</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>Chiudi</button>\`);
  showOv();
}
function openContest() {
  const ct = state.data.contest; if (!ct) return;
  _serataText = \`\u{1F3AC} Serata dei Clan \u2014 "\${ct.titolo}"\${ct.settimana ? \` (\${ct.settimana})\` : ''}\\n\${ct.brief || ''}\\nForza \${state.socio.casata || 'la nostra casata'}!\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">Serata dei Clan \xB7 Contest\${ct.settimana ? ' \xB7 ' + esc(ct.settimana) : ''}</div><h2>\${esc(ct.titolo)}</h2>
    \${ct.tipo ? \`<p class="sub">\${esc(ct.tipo)}\${ct.stato ? ' \xB7 ' + esc(ct.stato) : ''}</p>\` : ''}
    <div class="card"><p style="font-size:.9rem; line-height:1.5; white-space:pre-wrap">\${esc(ct.brief || '')}</p></div>
    \${ct.vincitore ? \`<div class="note">\u{1F3C6} Vincitore: \${esc(ct.vincitore)}</div>\` : ''}
    <button class="btn gold block" style="margin-top:12px" data-cap="share">Condividi</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>Chiudi</button>\`);
  showOv();
}
async function capShare() {
  try { if (navigator.share) { await navigator.share({ title: 'Serata dei Clan', text: _serataText }); } else { await navigator.clipboard.writeText(_serataText); okThen('Testo copiato: incollalo nel gruppo'); } } catch {}
}
async function rispondiConvocazione(id, st) {
  try { await api('/convocazioni/' + id + '/risposta', { method: 'POST', body: JSON.stringify({ stato: st }) }); } catch {}
  okThen(st === 'disponibile' ? 'Presenza confermata' : 'Hai declinato');
}

// QR semplice (segnaposto grafico \u2014 in produzione libreria QR reale)
function qrSvg(text) {
  let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let cells = '';
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) { h = (h * 1103515245 + 12345) & 0x7fffffff; if ((h >> 6) & 1) cells += \`<rect x="\${8+x*7}" y="\${8+y*7}" width="7" height="7"/>\`; }
  const finder = (x,y)=>\`<rect x="\${x}" y="\${y}" width="21" height="21"/><rect x="\${x+4}" y="\${y+4}" width="13" height="13" fill="#fff"/><rect x="\${x+7}" y="\${y+7}" width="7" height="7" fill="#12324F"/>\`;
  return \`<svg viewBox="0 0 100 100" shape-rendering="crispEdges" aria-label="QR tessera"><rect width="100" height="100" fill="#fff"/><g fill="#12324F">\${finder(6,6)}\${finder(73,6)}\${finder(6,73)}\${cells}</g></svg>\`;
}

// ---- Accessibilit\xE0 --------------------------------------------------------
function applyScale(v) {
  document.documentElement.style.setProperty('--scale', v);
  // La dimensione va applicata alla radice (html): cos\xEC TUTTI i testi in rem scalano davvero.
  document.documentElement.style.fontSize = (16 * v) + 'px';
  store.set('scale', v);
  document.querySelectorAll('.a11y button[data-scale]').forEach(b => b.classList.toggle('on', b.dataset.scale === String(v)));
}
function applyContrast(on) {
  document.body.classList.toggle('hc', on); store.set('hc', on);
  const btn = $('#hcBtn'); btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on);
}

// ---- Azioni scrittura (best-effort verso API) -----------------------------
async function doBook(kind) {
  const day = $('[data-group="day"] .sel')?.textContent || '';
  const slot = $('[data-group="slot"] .sel')?.textContent || '';
  const persone = Number($('[data-group="pers"] .sel')?.textContent || 0) || undefined;
  const nome = state.data.risorse.find(r=>r.chiave===kind)?.nome || kind;
  try {
    const headers = { 'Content-Type':'application/json', ...(state.token ? { Authorization:'Bearer '+state.token } : {}) };
    const r = await fetch(API_BASE + '/api/prenotazioni', { method:'POST', headers, body: JSON.stringify({ tessera_code: state.tessera, risorsa: kind, giorno: day, turno: slot, persone }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return okThen(data.error || 'Prenotazione non riuscita: riprova', false);  // es. turno/coworking al completo
  } catch { /* offline (anteprima): conferma ottimistica */ }
  okThen(\`Prenotazione registrata \xB7 \${nome}\${day?\` \xB7 \${day} \${slot}\`:''}\${persone?\` \xB7 \${persone} pers.\`:''}\`);
}
// --- Serate speciali a numero chiuso con quota (da saldare) ---
function openSerata(id) {
  const s = (state.data.serate || []).find(x => String(x.id) === String(id)); if (!s) return;
  const esaurita = s.posti_liberi != null && s.posti_liberi <= 0;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">Serata su prenotazione\${s.quando ? ' \xB7 ' + esc(s.quando) : ''}</div><h2>\${esc(s.titolo)}</h2>
    \${s.tema ? \`<p class="sub">\${esc(s.tema)}</p>\` : ''}
    <div class="card"><p style="font-size:.9rem; line-height:1.5">\${esc(s.descrizione || '')}</p>
      <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:.85rem"><b>Quota</b><span>\u20AC \${esc(String(s.quota))} a persona</span></div>
      \${s.posti_liberi != null ? \`<div style="display:flex; justify-content:space-between; font-size:.8rem; color:var(--mute)"><span>Posti disponibili</span><span>\${s.posti_liberi}</span></div>\` : ''}
    </div>
    \${esaurita ? \`<div class="note">Posti esauriti per questa serata.</div>\` : \`
    <div class="field" style="margin-top:10px"><label>Quante persone</label><div class="chips" data-group="serp">\${[1,2,3,4,5,6].map((n,i)=>\`<button class="chip\${i===1?' sel':''}" data-chip>\${n}</button>\`).join('')}</div></div>
    <div class="note">Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriver\xE0 pi\xF9 avanti).</div>
    <button class="btn gold block" style="margin-top:10px" data-do-serata="\${s.id}">Prenota (\u20AC \${esc(String(s.quota))} a persona)</button>\`}
    <button class="btn ghost block" style="margin-top:8px" data-close>Chiudi</button>\`);
  showOv();
}
async function prenotaSerata(id) {
  const persone = Number($('[data-group="serp"] .sel')?.textContent || 1) || 1;
  const s = (state.data.serate || []).find(x => String(x.id) === String(id));
  try {
    const headers = { 'Content-Type':'application/json', ...(state.token ? { Authorization:'Bearer '+state.token } : {}) };
    const r = await fetch(API_BASE + '/api/serate/' + id + '/prenota', { method:'POST', headers, body: JSON.stringify({ tessera_code: state.tessera, persone }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return okThen(data.error || 'Prenotazione non riuscita', false);
    await loadAll();
    return okThen(\`Sei in lista per "\${data.titolo || (s && s.titolo) || 'la serata'}" \xB7 \${persone} pers. \xB7 \u20AC \${data.importo} da saldare in cassa\`);
  } catch {
    const imp = s ? s.quota * persone : 0;
    okThen(\`Prenotazione registrata \xB7 \${persone} pers.\${imp?\` \xB7 \u20AC \${imp} da saldare\`:''}\`);
  }
}
async function doProposta(tipo) {
  const titolo = $('#in1')?.value || '';
  const dettaglio = tipo==='vinile' ? [$('#in2')?.value, $('#in3')?.value].filter(Boolean).join(' \u2014 ') : ($('[data-group="tipo"] .sel')?.textContent || '');
  try { await api('/proposte', { method:'POST', body: JSON.stringify({ tessera_code: state.tessera, tipo, titolo, dettaglio }) }); } catch {}
  okThen(tipo==='vinile' ? 'La tua proposta \xE8 in lista' : 'Sei in scaletta per domenica');
}
function convOk(key) { state.conv[key] = 'ok'; const [dom]=key.split('/'); renderDom(dom); okThen('Presenza confermata'); }
function convNo(key) { state.rifiuti = Math.min(3, state.rifiuti+1); state.conv[key]='no'; const [dom]=key.split('/'); renderDom(dom); }

// ---- Delegazione eventi (un solo listener) --------------------------------
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-open],[data-book],[data-sheet],[data-go],[data-close],[data-confirm],[data-chip],[data-do-book],[data-proposta],[data-lang],[data-conv],[data-ev],[data-dom],[data-login],[data-logout],[data-otp-req],[data-otp-verify],[data-push],[data-map],[data-cap],[data-capm],[data-capsend],[data-convrisp],[data-open-contest],[data-serata],[data-do-serata]');
  if (!t) return;
  if (t.dataset.doSerata != null) return prenotaSerata(t.dataset.doSerata);
  if (t.dataset.serata != null) return openSerata(t.dataset.serata);
  if (t.dataset.openContest != null) return openContest();
  if (t.dataset.cap) { const a = t.dataset.cap; if (a === 'convoca') return openCapConvoca(); if (a === 'serata') return openCapSerata(); if (a === 'share') return capShare(); return; }
  if (t.dataset.capm != null) return openCapMembri(Number(t.dataset.capm));
  if (t.dataset.capsend != null) return capSendMirata();
  if (t.dataset.convrisp) { const [id, st] = t.dataset.convrisp.split('|'); return rispondiConvocazione(id, st); }
  if (t.dataset.login != null) return openLoginOtp();
  if (t.dataset.logout != null) return logoutUser();
  if (t.dataset.otpReq != null) return requestOtp();
  if (t.dataset.otpVerify) return verifyOtp(t.dataset.otpVerify);
  if (t.dataset.push) return togglefPush(t.dataset.push);
  if (t.dataset.map) { const url = 'https://www.google.com/maps?q=' + encodeURIComponent(t.dataset.map); try { window.open(url, '_blank'); } catch { location.href = url; } return; }
  if (t.dataset.act) { ev.stopPropagation(); if (t.dataset.act==='go-coppa') return go('coppa'); return openSheet(t.dataset.act); }
  if (t.dataset.open != null) return openEvent(t.dataset.open);
  if (t.dataset.book != null) return openBooking(t.dataset.book);
  if (t.dataset.sheet) return t.dataset.sheet === 'regolamenti' ? openRegolamenti() : openSheet(t.dataset.sheet);
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.close != null) return closeOv();
  if (t.dataset.confirm != null) return okThen('Prenotazione registrata \xB7 ' + t.dataset.confirm);
  if (t.dataset.chip != null) { t.parentElement.querySelectorAll('.chip').forEach(c=>c.classList.remove('sel')); t.classList.add('sel'); return; }
  if (t.dataset.doBook) return doBook(t.dataset.doBook);
  if (t.dataset.proposta) return doProposta(t.dataset.proposta);
  if (t.dataset.lang) { applyLang(t.dataset.lang); return okThen('Lingua impostata'); }
  if (t.dataset.conv) return t.dataset.conv==='ok' ? convOk(t.dataset.key) : convNo(t.dataset.key);
  if (t.dataset.dom) { DOMAINS[t.dataset.dom].cur = Number(t.dataset.i); return renderDom(t.dataset.dom); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeOv();
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"][data-open],[role="button"][data-book]')) { ev.preventDefault(); ev.target.click(); }
});

// ---- Bootstrap ------------------------------------------------------------
function bindStatic() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.t)));
  $('#tesseraBtn').addEventListener('click', openTessera);
  $('#casataBtn').addEventListener('click', () => go('coppa'));
  $('#langBtn').addEventListener('click', openLang);
  $('#helpBtn').addEventListener('click', () => $('#onb').classList.add('show'));
  $('#onbClose').addEventListener('click', () => { $('#onb').classList.remove('show'); store.set('seen', true); });
  $('#onbSos').addEventListener('click', () => { $('#onb').classList.remove('show'); openSos(); });
  $('#ovBg').addEventListener('click', closeOv);
  document.querySelectorAll('.a11y button[data-scale]').forEach(b => b.addEventListener('click', () => applyScale(Number(b.dataset.scale))));
  $('#hcBtn').addEventListener('click', () => applyContrast(!document.body.classList.contains('hc')));
}
async function init() {
  bindStatic();
  bindGate();
  applyScale(store.get('scale', 1));
  applyContrast(store.get('hc', false));
  if (state.tessera) {
    // Gi\xE0 identificato (o anteprima): entra direttamente
    if (state.token) state.authed = true;
    await enterApp();
    if (!store.get('seen', false)) $('#onb').classList.add('show');
    const h = location.hash.replace('#', ''); if (h && document.getElementById('s-' + h)) go(h);
  } else {
    // Primo avvio senza identit\xE0: mostra l'accesso
    showGate();
  }
  /* SW off nel file unico */
}
function bindGate() {
  const enter = $('#gate_enter'); if (enter) enter.addEventListener('click', loginTessera);
  const tess = $('#gate_tess'); if (tess) tess.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginTessera(); });
  const email = $('#gate_email'); if (email) email.addEventListener('click', () => { hideGate(); openLoginOtp(); });
  const demo = $('#gate_demo'); if (demo) demo.addEventListener('click', demoPreview);
}
init();

</script>
</body>
</html>
`;

// build/admin.html
var admin_default = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bussola Residence \u2014 Back office</title>
<style>
  :root{--navy:#12324F;--gold:#8a5a12;--teal:#256b65;--coral:#b14a35;--ink:#17242c;--mute:#5a6b75;--line:#e3e1d6;--bg:#f4f2ea;--card:#fff;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink);font-size:15px;}
  a{color:var(--navy);}
  /* Login */
  #login{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(900px 600px at 50% -10%,#1c3e5c,#0a1a2b);}
  #login .box{background:#fff;border-radius:18px;padding:30px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,.4);}
  #login h1{font-family:Georgia,serif;color:var(--navy);font-size:22px;margin-bottom:4px;}
  #login p{color:var(--mute);font-size:13px;margin-bottom:18px;}
  label{display:block;font-size:13px;font-weight:700;color:var(--navy);margin:12px 0 5px;}
  input,select,textarea{width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit;}
  button{cursor:pointer;font-family:inherit;}
  .btn{background:var(--navy);color:#fff;border:none;border-radius:10px;padding:11px 16px;font-weight:700;font-size:14px;}
  .btn.gold{background:var(--gold);} .btn.sm{padding:7px 11px;font-size:13px;border-radius:8px;}
  .btn.ghost{background:#fff;color:var(--navy);border:1.5px solid var(--line);}
  .btn.danger{background:var(--coral);}
  .err{color:var(--coral);font-size:13px;margin-top:10px;min-height:18px;}
  /* App shell */
  #app{display:none;grid-template-columns:220px 1fr;min-height:100vh;}
  aside{background:var(--navy);color:#fff;padding:20px 12px;}
  aside .brand{font-family:Georgia,serif;font-weight:700;letter-spacing:2px;font-size:16px;padding:0 8px 16px;border-bottom:1px solid rgba(255,255,255,.15);}
  aside .brand small{display:block;letter-spacing:4px;font-size:9px;color:#e2b45a;margin-top:2px;}
  nav.menu{margin-top:14px;display:flex;flex-direction:column;gap:2px;}
  nav.menu button{background:none;border:none;color:#cdd8e3;text-align:left;padding:11px 12px;border-radius:9px;font-size:14px;display:flex;gap:9px;align-items:center;}
  nav.menu button.on,nav.menu button:hover{background:rgba(255,255,255,.12);color:#fff;}
  main{padding:26px 30px;overflow:auto;}
  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
  .top h2{font-family:Georgia,serif;color:var(--navy);font-size:24px;}
  .who{font-size:13px;color:var(--mute);}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:22px;}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;}
  .stat .n{font-family:Georgia,serif;font-size:30px;color:var(--navy);font-weight:700;}
  .stat .l{font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px;}
  .panel h3{font-family:Georgia,serif;color:var(--navy);font-size:17px;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--mute);padding:8px 8px;border-bottom:2px solid var(--line);}
  td{padding:9px 8px;border-bottom:1px solid var(--line);font-size:14px;}
  tr:hover td{background:#faf8f1;}
  .tag{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;}
  .tag.ok{background:#e2f0e0;color:#3f6b3d;} .tag.no{background:#f7e0da;color:#9c3f2c;} .tag.mid{background:#f3ead6;color:#6b5a33;}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .modal{position:fixed;inset:0;background:rgba(9,20,33,.5);display:none;align-items:center;justify-content:center;padding:20px;z-index:50;}
  .modal.show{display:flex;}
  .modal .box{background:#fff;border-radius:16px;padding:24px;width:520px;max-width:100%;max-height:90vh;overflow:auto;}
  .modal h3{font-family:Georgia,serif;color:var(--navy);font-size:20px;margin-bottom:14px;}
  .check{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:14px;}
  .check input{width:auto;}
  .muted{color:var(--mute);font-size:13px;}
  .barwrap{background:#eee;border-radius:6px;height:10px;overflow:hidden;width:120px;display:inline-block;vertical-align:middle;}
  .barwrap span{display:block;height:100%;}
  /* Hamburger + drawer (solo mobile) */
  .navToggle{display:none;background:var(--navy);color:#fff;border:none;border-radius:9px;padding:7px 12px;font-size:18px;line-height:1;}
  .scrim{display:none;position:fixed;inset:0;background:rgba(9,20,33,.45);z-index:40;}
  /* ===== Responsive: back office usabile da cellulare ===== */
  @media (max-width:820px){
    #app{grid-template-columns:1fr;}
    aside{position:fixed;top:0;left:0;bottom:0;width:240px;z-index:45;transform:translateX(-100%);transition:transform .22s ease;overflow-y:auto;-webkit-overflow-scrolling:touch;}
    #app.nav-open aside{transform:translateX(0);box-shadow:0 0 40px rgba(0,0,0,.4);}
    #app.nav-open .scrim{display:block;}
    main{padding:14px 12px;}
    .top{flex-wrap:wrap;gap:10px;align-items:center;}
    .top h2{font-size:20px;order:2;}
    .navToggle{display:inline-block;order:1;}
    .who{order:3;width:100%;}
    .grid2{grid-template-columns:1fr;}
    .panel{overflow-x:auto;padding:14px;}
    .panel table{min-width:520px;}
    .modal{padding:10px;}
    .modal .box{width:100%;padding:18px;max-height:94vh;}
    .cards{grid-template-columns:repeat(auto-fit,minmax(130px,1fr));}
    .row{gap:8px;}
    /* iOS: font >=16px sui campi evita lo zoom automatico che scombina il layout */
    input,select,textarea{font-size:16px;}
    .btn.sm{padding:9px 12px;}
  }
</style>
</head>
<body>
  <div id="login">
    <div class="box">
      <h1>Bussola Residence</h1>
      <p>Back office \xB7 gestione soci e progetto</p>
      <p class="muted" id="verline" style="margin:2px 0 6px; font-weight:700">versione online: \u2026</p>
      <label for="u">Utente</label><input id="u" value="gestore" autocomplete="username">
      <label for="p">Password</label><input id="p" type="password" value="" placeholder="password del gestore" autocomplete="current-password">
      <div class="err" id="loginErr"></div>
      <button class="btn gold" style="width:100%;margin-top:14px" id="loginBtn">Entra</button>
      <p class="muted" style="margin-top:12px">La password del gestore si imposta su Render con la variabile <b>ADMIN_PASSWORD</b>.</p>
    </div>
  </div>

  <div id="app">
    <aside>
      <div class="brand">BUSSOLA<small>RESIDENCE \xB7 ADMIN</small></div>
      <nav class="menu" id="menu">
        <button data-v="dashboard" class="on">\u{1F4CA} Cruscotto</button>
        <button data-v="soci" data-cap="utenti">\u{1F464} Utenti</button>
        <button data-v="casate" data-cap="casate">\u{1F6E1}\uFE0F Casate & punti</button>
        <button data-v="cdc" data-cap="cdc">\u{1F0CF} Casa di Carta</button>
        <button data-v="magazzino" data-cap="magazzino">\u{1F4E6} Magazzino</button>
        <button data-v="comande" data-cap="comande">\u{1F354} Chiosco \xB7 Comande</button>
        <button data-v="kds" data-cap="comande">\u{1F5A5}\uFE0F KDS Cucina/Bar</button>
        <button data-v="discipline" data-cap="discipline">\u{1F3C5} Discipline</button>
        <button data-v="tabellone" data-cap="tabellone">\u{1F3C6} Tabellone</button>
        <button data-v="contest" data-cap="contest">\u{1F3AC} Contest Serata Clan</button>
        <button data-v="serate" data-cap="serate">\u{1F37D}\uFE0F Serate & cena</button>
        <button data-v="proposte" data-cap="proposte">\u{1F3B5} Proposte</button>
        <button data-v="eventi" data-cap="eventi">\u{1F3AD} Eventi</button>
        <button data-v="bussola" data-cap="guida">\u{1F9ED} Guida</button>
        <button data-v="luoghi" data-cap="luoghi">\u{1F4CD} Luoghi (Siamo qui)</button>
        <button data-v="operatori" data-cap="operatori">\u{1F511} Operatori & permessi</button>
        <button data-v="database" data-cap="db">\u{1F5C4}\uFE0F Database</button>
        <button data-v="audit" data-cap="registro">\u{1F5C2}\uFE0F Registro</button>
      </nav>
    </aside>
    <main>
      <div class="top"><button class="navToggle" id="navToggle" aria-label="Menu">\u2630</button><h2 id="viewTitle">Cruscotto</h2><div class="who">Accesso: <b id="whoName"></b> \xB7 <a href="#" id="logout">esci</a></div></div>
      <div id="view"></div>
    </main>
    <div class="scrim" id="navScrim"></div>
  </div>

  <div class="modal" id="modal"><div class="box" id="modalBox"></div></div>

  <script>
/* Back office KOIN\xC8 Village \u2014 SPA minimale su fetch/API. */
'use strict';
let TOKEN = null, USER = null, CASATE = [], ME = { ruolo: '', gestore: false, caps: [] };
const can = (cap) => ME.gestore || (ME.caps || []).includes(cap);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Base API: nell'app Staff (APK) \xE8 iniettato window.KOINE_API con l'indirizzo del server online;
// nel back office web resta vuoto (chiamate relative allo stesso server).
const API_BASE = (typeof window !== 'undefined' && window.KOINE_API) ? String(window.KOINE_API).replace(/\\/$/, '') : '';

async function api(path, opts = {}) {
  const r = await fetch(API_BASE + '/api/admin' + path, {
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    ...opts,
  });
  if (r.status === 401) { logout(); throw new Error('non autorizzato'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

// ---- Login ----
async function login() {
  $('#loginErr').textContent = '';
  try {
    const res = await fetch(API_BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#u').value, password: $('#p').value }) });
    if (!res.ok) throw new Error('Credenziali non valide');
    const j = await res.json(); TOKEN = j.token; USER = j.user;
    $('#login').style.display = 'none'; $('#app').style.display = 'grid';
    $('#whoName').textContent = USER.username + ' (' + USER.ruolo + ')';
    ME = await api('/me').catch(() => ({ ruolo: USER.ruolo, gestore: USER.ruolo === 'gestore', caps: [] }));
    applyMenuPermessi();
    CASATE = await api('/../casate').catch(() => []);   // riusa endpoint pubblico
    show('dashboard');
  } catch (e) { $('#loginErr').textContent = e.message; }
}
function logout() { TOKEN = null; USER = null; ME = { ruolo: '', gestore: false, caps: [] }; $('#app').style.display = 'none'; $('#login').style.display = 'flex'; }

// Mostra nel menu solo le voci consentite dai permessi (il Cruscotto \xE8 sempre visibile).
function applyMenuPermessi() {
  document.querySelectorAll('#menu button').forEach(b => {
    const cap = b.dataset.cap;
    b.style.display = (!cap || can(cap)) ? '' : 'none';
  });
}

// ---- Router ----
const VIEWS = {};
async function show(v) {
  document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (window.__kdsTimer) { clearInterval(window.__kdsTimer); window.__kdsTimer = null; }
  $('#viewTitle').textContent = { dashboard:'Cruscotto', soci:'Utenti', casate:'Casate & punti', cdc:'Casa di Carta', magazzino:'Magazzino', comande:'Chiosco \xB7 Comande', kds:'KDS Cucina/Bar', discipline:'Discipline', tabellone:'Tabellone', contest:'Contest Serata dei Clan', serate:'Serate & cena', proposte:'Proposte', eventi:'Eventi', bussola:'Guida', luoghi:'Luoghi (Siamo qui)', operatori:'Operatori & permessi', database:'Database', audit:'Registro attivit\xE0' }[v] || v;
  $('#view').innerHTML = '<p class="muted">Carico\u2026</p>';
  try { await VIEWS[v](); } catch (e) { $('#view').innerHTML = \`<p class="muted">Errore: \${esc(e.message)}</p>\`; }
}

// ---- Cruscotto ----
VIEWS.dashboard = async () => {
  const s = await api('/stats');
  const cards = [
    ['Soci attivi', s.soci], ['Consenso marketing', s.soci_marketing], ['Prenotazioni', s.prenotazioni],
    ['Oggi', s.prenotazioni_oggi], ['Proposte da leggere', s.proposte], ['Convocazioni aperte', s.convocazioni_aperte],
  ];
  const max = Math.max(...s.per_casata.map(c => c.punti), 1);
  // Avviso magazzino (solo se l'utente ha la capacit\xE0): articoli da riordinare / in esaurimento.
  let magAvviso = '';
  if (typeof can === 'function' ? can('magazzino') : true) {
    const mag = await api('/magazzino').catch(() => null);
    if (mag && mag.riepilogo && (mag.riepilogo.da_riordinare || mag.riepilogo.in_esaurimento)) {
      const r = mag.riepilogo;
      magAvviso = \`<div class="panel" style="border-left:4px solid #b14a35"><h3>\u{1F4E6} Magazzino \xB7 da tenere d'occhio</h3>
        <p style="margin:0">\${r.da_riordinare ? \`<b style="color:#b14a35">\${r.da_riordinare}</b> da riordinare\` : ''}\${r.da_riordinare && r.in_esaurimento ? ' \xB7 ' : ''}\${r.in_esaurimento ? \`<b style="color:#8a5a12">\${r.in_esaurimento}</b> in esaurimento\` : ''}. <a href="#" id="mag_link" style="color:var(--navy);font-weight:700">Apri il magazzino \u2192</a></p></div>\`;
    }
  }
  $('#view').innerHTML = \`
    <div class="cards">\${cards.map(c => \`<div class="stat"><div class="n">\${c[1]}</div><div class="l">\${c[0]}</div></div>\`).join('')}</div>
    \${magAvviso}
    <div class="panel"><h3>Coppa delle Casate & soci per casata</h3><table><thead><tr><th>Casata</th><th>Punti</th><th></th><th>Soci</th></tr></thead><tbody>
      \${s.per_casata.map(c => \`<tr><td><b>\${esc(c.nome)}</b></td><td>\${c.punti}</td><td><span class="barwrap"><span style="width:\${Math.round(c.punti/max*100)}%;background:\${c.colore}"></span></span></td><td>\${c.soci}</td></tr>\`).join('')}
    </tbody></table></div>\`;
  const ml = document.getElementById('mag_link'); if (ml) ml.onclick = (e) => { e.preventDefault(); show('magazzino'); };
};

// ---- Database (voce dedicata, solo gestore): stato persistenza + backup ----
VIEWS.database = async () => {
  const info = await api('/db/info');
  const tag = info.persistente ? '<span class="tag ok">persistente \u2713</span>' : '<span class="tag no">NON persistente \u2014 i dati si azzerano al riavvio</span>';
  const dim = info.size_kb ? \` \xB7 \${info.size_kb} KB\` : '';
  $('#view').innerHTML = \`<div class="panel"><h3>Database & backup</h3>
      <p class="muted" style="margin-bottom:8px">Tipo: <b>\${esc(info.tipo || '')}</b> \${tag}<br>Sorgente: <b>\${esc(info.path)}</b>\${dim} \xB7 \${info.soci} soci</p>
      \${info.persistente ? '' : '<p class="muted" style="margin-bottom:8px">Per rendere permanenti i dati: collega un database gestito (Turso) o monta un disco su Render (vedi runbook).</p>'}
      <button class="btn gold sm" id="db_backup">\u2B07\uFE0E Scarica backup (.db)</button>
      <span class="muted" id="db_msg" style="margin-left:8px"></span>
      <p class="muted" style="margin-top:12px;font-size:13px">Su database gestito (Turso) i backup/point-in-time sono del provider; il download .db \xE8 per la modalit\xE0 file locale.</p></div>\`;
  $('#db_backup').onclick = async () => {
    $('#db_msg').textContent = 'preparo\u2026';
    try {
      const r = await fetch(API_BASE + '/api/admin/db/backup', { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      const blob = await r.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'koine-backup-' + new Date().toISOString().slice(0, 10) + '.db'; a.click();
      $('#db_msg').textContent = 'scaricato \u2713';
    } catch (e) { $('#db_msg').textContent = String(e.message || e); }
  };
};

// ---- Operatori & permessi (solo gestore) ----
const CAP_LABEL = { utenti:'Utenti (modifica)', utenti_ins:'Registra utenti', casate:'Casate & punti', cdc:'Casa di Carta', discipline:'Discipline', tabellone:'Tabellone (risultati/archivio)', contest:'Contest', serate:'Serate & cena', proposte:'Proposte', eventi:'Eventi', magazzino:'Magazzino/Chiosco' };
VIEWS.operatori = async () => {
  const d = await api('/operatori');
  const caps = d.caps_delegabili;
  const ruoloTag = (r) => r === 'gestore' ? '<span class="tag ok">gestore</span>' : r === 'manager' ? '<span class="tag mid">manager</span>' : r === 'sola_lettura' ? '<span class="tag no">sola lettura</span>' : '<span class="tag mid">staff</span>';
  $('#view').innerHTML = \`
    <div class="panel"><h3>Operatori</h3>
      <p class="muted" style="margin-bottom:10px">Il <b>gestore</b> pu\xF2 tutto (password via <b>ADMIN_PASSWORD</b>). Il <b>manager</b> sovraintende l'operativit\xE0 (niente inserimenti/cancellazioni n\xE9 funzioni strutturali). Lo <b>staff</b> ha i permessi spuntati qui sotto.</p>
      <table><thead><tr><th>Utente</th><th>Ruolo</th><th>Permessi</th><th></th></tr></thead><tbody>
      \${d.operatori.map(o => \`<tr><td><b>\${esc(o.username)}</b></td><td>\${ruoloTag(o.ruolo)}</td>
        <td class="muted">\${o.ruolo === 'gestore' ? 'tutto' : o.ruolo === 'manager' ? 'template manager' : o.ruolo === 'sola_lettura' ? 'solo lettura' : (o.permessi.map(c => CAP_LABEL[c] || c).join(', ') || '\u2014')}</td>
        <td style="white-space:nowrap">\${o.ruolo === 'gestore' ? '' : \`<button class="btn ghost sm" data-oedit="\${o.id}">\u270E</button> <button class="btn danger sm" data-odel="\${o.id}">\u{1F5D1}</button>\`}</td></tr>\`).join('')}
      </tbody></table>
      <button class="btn gold sm" id="o_new" style="margin-top:12px">+ Nuovo operatore</button>
    </div>\`;
  $('#o_new').onclick = () => openOperatore(null, caps);
  document.querySelectorAll('[data-oedit]').forEach(b => b.onclick = () => openOperatore(d.operatori.find(x => x.id == b.dataset.oedit), caps));
  document.querySelectorAll('[data-odel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare questo operatore?')) return; await api('/operatori/' + b.dataset.odel, { method: 'DELETE' }); show('operatori'); });
};
function openOperatore(o, caps) {
  const isNew = !o;
  const sel = new Set(o?.permessi || []);
  modal(\`<h3>\${isNew ? 'Nuovo operatore' : 'Modifica operatore'}</h3>
    <div class="grid2">
      <div><label>Username</label><input id="o_user" value="\${esc(o?.username || '')}" \${isNew ? '' : 'disabled'}></div>
      <div><label>Ruolo</label><select id="o_ruolo"><option value="staff" \${o?.ruolo === 'staff' ? 'selected' : ''}>staff (permessi a flag)</option><option value="manager" \${o?.ruolo === 'manager' ? 'selected' : ''}>manager (template)</option><option value="sola_lettura" \${o?.ruolo === 'sola_lettura' ? 'selected' : ''}>sola lettura</option></select></div>
      <div><label>Password \${isNew ? '' : '(lascia vuoto per non cambiarla)'}</label><input id="o_pwd" type="password" placeholder="\${isNew ? 'password' : '\u2022\u2022\u2022\u2022\u2022\u2022'}"></div>
    </div>
    <div id="o_capsWrap"><label>Permessi (solo per ruolo staff)</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px">\${caps.map(c => \`<label class="check" style="margin:0"><input type="checkbox" class="o_cap" value="\${c}" \${sel.has(c) ? 'checked' : ''}> \${esc(CAP_LABEL[c] || c)}</label>\`).join('')}</div>
    </div>
    <div class="err" id="o_err"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
  const syncRuolo = () => { $('#o_capsWrap').style.display = $('#o_ruolo').value === 'staff' ? 'block' : 'none'; };
  $('#o_ruolo').onchange = syncRuolo; syncRuolo();
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => {
    const body = { ruolo: $('#o_ruolo').value, permessi: [...document.querySelectorAll('.o_cap:checked')].map(x => x.value) };
    if ($('#o_pwd').value) body.password = $('#o_pwd').value;
    if (isNew) { body.username = $('#o_user').value; if (!body.username || !body.password) { $('#o_err').textContent = 'Username e password obbligatori'; return; } }
    try { await api(isNew ? '/operatori' : '/operatori/' + o.id, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(body) }); closeModal(); show('operatori'); }
    catch (e) { $('#o_err').textContent = e.message; }
  };
}

// ---- Soci ----
VIEWS.soci = async () => {
  const render = async (q = '') => {
    const list = await api('/soci?q=' + encodeURIComponent(q));
    $('#view').innerHTML = \`
      <div class="row"><input id="q" placeholder="Cerca nome, email, tessera\u2026" style="max-width:280px" value="\${esc(q)}"><button class="btn ghost sm" id="search">Cerca</button>\${can('utenti_ins') ? '<button class="btn gold sm" id="new">+ Nuovo utente</button>' : ''}</div>
      <div class="panel"><table><thead><tr><th>Tessera</th><th>Nome</th><th>Casata</th><th>Ruolo</th><th>Consensi</th><th>Stato</th><th></th></tr></thead><tbody>
        \${list.map(s => \`<tr>
          <td>\${esc(s.tessera_code)}</td><td><b>\${esc(s.nome)} \${esc(s.cognome)}</b><br><span class="muted">\${esc(s.email||'')}</span></td>
          <td>\${esc(s.casata_nome||'\u2014')}</td><td>\${esc(s.ruolo)}\${s.tipo_profilo&&s.tipo_profilo!=='socio'?\`<br><span class="tag mid">\${esc(s.tipo_profilo.replace('_',' '))}</span>\`:''}</td>
          <td>\${s.consenso_privacy?'<span class="tag ok">privacy</span> ':''}\${s.consenso_marketing?'<span class="tag mid">mktg</span> ':''}\${s.consenso_foto?'<span class="tag mid">foto</span>':''}</td>
          <td>\${s.attivo?'<span class="tag ok">attivo</span>':'<span class="tag no">inattivo</span>'}</td>
          <td style="white-space:nowrap"><button class="btn ghost sm" data-edit="\${s.id}">\u270E</button> <button class="btn ghost sm" data-exp="\${s.id}">\u2B07\uFE0E</button> \${can('utenti_del') ? \`<button class="btn danger sm" data-del="\${s.id}">\u{1F5D1}</button>\` : ''}</td>
        </tr>\`).join('') || '<tr><td colspan="7" class="muted">Nessun socio.</td></tr>'}
      </tbody></table></div>\`;
    $('#search').onclick = () => render($('#q').value);
    $('#q').onkeydown = (e) => { if (e.key === 'Enter') render($('#q').value); };
    if ($('#new')) $('#new').onclick = () => editSocio(null, list);
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSocio(list.find(x => x.id == b.dataset.edit), list));
    document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => exportSocio(b.dataset.exp));
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => delSocio(b.dataset.del, render));
  };
  await render();
};
function casataOptions(sel) { return \`<option value="">\u2014 nessuna \u2014</option>\` + CASATE.map(c => \`<option value="\${c.id}" \${sel==c.id?'selected':''}>\${esc(c.nome)}</option>\`).join(''); }
function editSocio(s, all) {
  const isNew = !s;
  const genitori = (all || []).filter(x => x.tipo_profilo === 'genitore');
  const profili = [['socio','Socio'],['residente','Residente'],['ospite_temporaneo','Ospite temporaneo'],['genitore','Genitore'],['under14','Under 14 (figlio)']];
  const tutOpts = \`<option value="">\u2014 nessuno \u2014</option>\` + genitori.map(g => \`<option value="\${g.id}" \${s?.tutore_id==g.id?'selected':''}>\${esc(g.nome)} \${esc(g.cognome)}</option>\`).join('');
  modal(\`<h3>\${isNew?'Nuovo profilo':'Modifica profilo'}</h3>
    <div class="grid2">
      <div><label>Nome*</label><input id="f_nome" value="\${esc(s?.nome||'')}"></div>
      <div><label>Cognome*</label><input id="f_cognome" value="\${esc(s?.cognome||'')}"></div>
      <div><label>Email</label><input id="f_email" value="\${esc(s?.email||'')}"></div>
      <div><label>Telefono</label><input id="f_tel" value="\${esc(s?.telefono||'')}"></div>
      <div><label>Data di nascita</label><input id="f_nasc" type="date" value="\${esc(s?.data_nascita||'')}"></div>
      <div><label>Casata</label><select id="f_casata">\${casataOptions(s?.casata_id)}</select></div>
      <div><label>Tipo profilo</label><select id="f_tipo">\${profili.map(p=>\`<option value="\${p[0]}" \${s?.tipo_profilo===p[0]?'selected':''}>\${p[1]}</option>\`).join('')}</select></div>
      <div id="tutoreWrap"><label>Genitore (per Under 14)</label><select id="f_tutore">\${tutOpts}</select></div>
      <div><label>Ruolo</label><select id="f_ruolo"><option \${s?.ruolo==='socio'?'selected':''}>socio</option><option \${s?.ruolo==='capitano'?'selected':''}>capitano</option><option \${s?.ruolo==='staff'?'selected':''}>staff</option></select></div>
      <div><label>Lingua</label><select id="f_lingua">\${['it','en','fr','de','es','zh','ja'].map(l=>\`<option \${s?.lingua===l?'selected':''}>\${l}</option>\`).join('')}</select></div>
      <div id="validaWrap"><label>Tessera valida fino</label><input id="f_valida" type="date" value="\${esc(s?.valida_fino||'2027-05-01')}"></div>
      <div id="dalWrap"><label>Soggiorno dal</label><input id="f_dal" type="date" value="\${esc(s?.soggiorno_dal||'')}"></div>
      <div id="alWrap"><label>Soggiorno al</label><input id="f_al" type="date" value="\${esc(s?.soggiorno_al||'')}"></div>
    </div>
    <p class="muted" id="ospitenote" style="display:none">Ospite temporaneo: indica il periodo di soggiorno (dal / al). Gli eventi selezionabili sono quelli compresi nel periodo; per gli ospiti non serve la data della tessera.</p>
    <label class="check"><input type="checkbox" id="f_privacy" \${(!s||s.consenso_privacy)?'checked':''}> Consenso privacy (necessario)</label>
    <label class="check"><input type="checkbox" id="f_mktg" \${s?.consenso_marketing?'checked':''}> Consenso comunicazioni marketing</label>
    <label class="check"><input type="checkbox" id="f_foto" \${s?.consenso_foto?'checked':''}> Consenso uso immagini eventi</label>
    <label class="check"><input type="checkbox" id="f_push" \${s?.notifiche_push?'checked':''}> Consenso notifiche (casata & eventi)</label>
    \${isNew?'':'<label class="check"><input type="checkbox" id="f_attivo" '+(s.attivo?'checked':'')+'> Profilo attivo</label>'}
    <p class="muted" id="under14note" style="display:none">Per gli under-14 la responsabilit\xE0 del trattamento \xE8 del genitore indicato: seleziona il genitore e la casata del figlio.</p>
    <div class="err" id="mErr"></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
  const syncTipo = () => {
    const t = $('#f_tipo').value;
    const u = t === 'under14', osp = t === 'ospite_temporaneo';
    $('#tutoreWrap').style.opacity = u ? '1' : '.5'; $('#under14note').style.display = u ? 'block' : 'none';
    // Ospite temporaneo: mostra il periodo dal/al e NON abilita la data della tessera.
    $('#dalWrap').style.display = osp ? 'block' : 'none';
    $('#alWrap').style.display = osp ? 'block' : 'none';
    $('#validaWrap').style.display = osp ? 'none' : 'block';
    $('#ospitenote').style.display = osp ? 'block' : 'none';
  };
  $('#f_tipo').onchange = syncTipo; syncTipo();
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => {
    const osp = $('#f_tipo').value === 'ospite_temporaneo';
    const body = {
      nome:$('#f_nome').value, cognome:$('#f_cognome').value, email:$('#f_email').value, telefono:$('#f_tel').value,
      data_nascita:$('#f_nasc').value, casata_id:$('#f_casata').value||null, ruolo:$('#f_ruolo').value, lingua:$('#f_lingua').value,
      tipo_profilo:$('#f_tipo').value, tutore_id: $('#f_tipo').value==='under14' ? ($('#f_tutore').value||null) : null,
      // Ospite temporaneo: nessuna tessera annuale, ma periodo di soggiorno dal/al.
      valida_fino: osp ? null : $('#f_valida').value,
      soggiorno_dal: osp ? ($('#f_dal').value||null) : null, soggiorno_al: osp ? ($('#f_al').value||null) : null,
      consenso_privacy:$('#f_privacy').checked, consenso_marketing:$('#f_mktg').checked,
      consenso_foto:$('#f_foto').checked, notifiche_push:$('#f_push').checked, attivo: isNew ? true : $('#f_attivo').checked,
    };
    try { await api(isNew?'/soci':'/soci/'+s.id, { method:isNew?'POST':'PUT', body:JSON.stringify(body) }); closeModal(); show('soci'); }
    catch (e) { $('#mErr').textContent = e.message; }
  };
}
async function exportSocio(id) {
  const data = await api('/soci/' + id + '/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'socio_' + data.socio.tessera_code + '.json'; a.click();
}
async function delSocio(id, render) {
  if (!confirm('Cancellare il socio e i suoi dati (diritto all\\'oblio GDPR)? Operazione irreversibile.')) return;
  await api('/soci/' + id, { method: 'DELETE' }); render();
}

// ---- Casate ----
VIEWS.casate = async () => {
  const list = await api('/../casate');
  $('#view').innerHTML = \`<div class="panel"><h3>Punti Coppa delle Casate</h3><table><thead><tr><th>Casata</th><th>Punti</th><th></th></tr></thead><tbody>
    \${list.map(c => \`<tr><td><b>\${esc(c.nome)}</b> <span class="muted">\${esc(c.motto||'')}</span></td>
      <td><input type="number" value="\${c.punti}" id="pt_\${c.id}" style="width:90px"></td>
      <td><button class="btn gold sm" data-save="\${c.id}">Salva</button></td></tr>\`).join('')}
  </tbody></table></div>\`;
  document.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    await api('/casate/' + b.dataset.save + '/punti', { method:'PUT', body:JSON.stringify({ punti: Number($('#pt_'+b.dataset.save).value) }) });
    b.textContent = '\u2713 Salvato'; setTimeout(() => b.textContent = 'Salva', 1200);
  });
};

// ---- Prenotazioni (sport, tavolo, eventi). Il coworking \xE8 nella sezione Casa di Carta. ----
VIEWS.prenotazioni = async () => {
  const list = await api('/prenotazioni');
  $('#view').innerHTML = \`<div class="panel"><h3>Prenotazioni recenti</h3>
    <p class="muted" style="margin-bottom:10px">Le postazioni coworking e la gestione della Casa di Carta (caff\xE8, giochi, check) sono nella sezione <b>\u{1F0CF} Casa di Carta</b>.</p>
    <table><thead><tr><th>Quando</th><th>Risorsa</th><th>Socio</th><th>Giorno/Turno</th><th>Stato</th></tr></thead><tbody>
    \${list.map(p => \`<tr><td class="muted">\${esc(p.created_at)}</td><td><b>\${esc(p.risorsa_nome||'')}</b></td>
      <td>\${esc((p.nome||'Ospite')+' '+(p.cognome||''))}<br><span class="muted">\${esc(p.tessera_code||'')}</span></td>
      <td>\${esc(p.giorno||'')} \${esc(p.turno||'')}</td><td><span class="tag ok">\${esc(p.stato)}</span></td></tr>\`).join('') || '<tr><td colspan="5" class="muted">Nessuna prenotazione.</td></tr>'}
  </tbody></table></div>\`;
};

// ---- Foto (acquisizione da fotocamera, utile nella versione staff): ridimensiona a jpeg dataURL ----
function pickPhoto(onReady) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
  inp.onchange = () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const max = 1280; let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      try { onReady(cv.toDataURL('image/jpeg', 0.6)); } catch (_) { alert('Immagine non valida'); }
    };
    img.onerror = () => alert('Impossibile leggere l\\'immagine');
    img.src = URL.createObjectURL(file);
  };
  inp.click();
}

// ---- Casa di Carta: coworking + caff\xE8 (magazzino capsule) + inventario giochi + prelievi + check ----
VIEWS.cdc = async () => {
  const [cw, caffe, giochi, prestiti, checks] = await Promise.all([
    api('/cdc/coworking'), api('/cdc/caffe'), api('/cdc/giochi'), api('/cdc/prestiti'), api('/cdc/check'),
  ]);
  const cfg = caffe.config;
  const cell = (u, max) => \`<span class="tag \${u >= max ? 'no' : u >= max - 2 ? 'mid' : 'ok'}">\${u}/\${max}</span>\`;
  const cwRows = cw.giorni.map(g => \`<tr><td><b>\${esc(g.giorno)}</b></td><td>\${cell(g.mattina, cw.max)}</td><td>\${cell(g.pomeriggio, cw.max)}</td></tr>\`).join('');
  const conteRows = caffe.conte.map(c => \`<tr><td>\${esc(c.data)} \${esc(c.ora || '')}</td><td>\${c.giacenza}</td><td>\${c.consumo == null ? '\u2014' : c.consumo}</td><td class="muted">\${esc(c.operatore || '')}</td></tr>\`).join('') || '<tr><td colspan="4" class="muted">Nessuna conta ancora.</td></tr>';
  const catLabel = { carte: 'Carte', gioco_tavolo: 'Gioco da tavolo', scacchi: 'Scacchi/Dama', altro: 'Altro' };
  const giochiRows = giochi.map(g => \`<tr>
      <td><input id="gnome_\${g.id}" value="\${esc(g.nome)}" style="min-width:150px"></td>
      <td><select id="gcat_\${g.id}">\${Object.keys(catLabel).map(k => \`<option value="\${k}" \${g.categoria === k ? 'selected' : ''}>\${catLabel[k]}</option>\`).join('')}</select></td>
      <td><input id="gqta_\${g.id}" type="number" min="0" value="\${g.quantita}" style="width:60px"></td>
      <td><select id="gstato_\${g.id}">\${['ok', 'danneggiato', 'mancante'].map(s => \`<option value="\${s}" \${g.stato === s ? 'selected' : ''}>\${s}</option>\`).join('')}</select></td>
      <td><input id="gnote_\${g.id}" value="\${esc(g.note || '')}" placeholder="pezzi mancanti\u2026" style="min-width:140px"></td>
      <td style="white-space:nowrap"><button class="btn gold sm" data-gsave="\${g.id}">Salva</button> <button class="btn danger sm" data-gdel="\${g.id}">\u{1F5D1}</button></td>
    </tr>\`).join('');
  const prestitiRows = prestiti.map(p => \`<tr><td>\${esc(p.data || '')}</td><td><b>\${esc(p.gioco_nome || '')}</b></td><td>\${esc(p.giocatore || '')}</td><td>\${esc(p.ora_inizio || '')}</td><td>\${p.ora_fine ? esc(p.ora_fine) : \`<button class="btn ghost sm" data-pfine="\${p.id}">Riconsegna ora</button>\`}</td></tr>\`).join('') || '<tr><td colspan="5" class="muted">Nessun prelievo registrato.</td></tr>';
  const checkRows = checks.map(c => \`<tr><td>\${esc(c.data)}</td><td>\${esc(c.operatore || '')}</td><td>\${c.caffe_giacenza ?? '\u2014'}</td><td>\${c.esito === 'ok' ? '<span class="tag ok">ok</span>' : '<span class="tag no">anomalie</span>'}</td><td class="muted">\${esc([c.strumenti_note, c.arredi_note].filter(Boolean).join(' \xB7 '))}</td><td>\${c.has_foto ? \`<button class="btn ghost sm" data-cfoto="\${c.id}">\u{1F4F7} Vedi</button>\` : '\u2014'}</td></tr>\`).join('') || '<tr><td colspan="6" class="muted">Nessun check registrato.</td></tr>';

  $('#view').innerHTML = \`
    <div class="panel"><h3>\u2615 Caff\xE8 \u2014 magazzino capsule \${caffe.da_riordinare ? '<span class="tag no">DA RIORDINARE</span>' : '<span class="tag ok">scorta ok</span>'}</h3>
      <div class="cards">
        <div class="stat"><div class="n">\${cfg.giacenza}</div><div class="l">Capsule in magazzino</div></div>
        <div class="stat"><div class="n">\${cfg.punto_riordino}</div><div class="l">Punto di riordino</div></div>
        <div class="stat"><div class="n">\${cfg.confezione}</div><div class="l">Capsule / confezione</div></div>
        \${caffe.da_riordinare ? \`<div class="stat" style="background:#f7e0da"><div class="n">\${caffe.ordine_suggerito}</div><div class="l">Ordine suggerito</div></div>\` : ''}
      </div>
      <div class="row" style="align-items:flex-end">
        <div><label>Conta di oggi \xB7 capsule rimaste (rimozione macchina, ore 16:00)</label><input id="ca_g" type="number" min="0" placeholder="es. 55" style="width:180px"></div>
        <button class="btn gold sm" id="ca_conta">Registra conta</button>
      </div>
      <div class="row" style="align-items:flex-end;margin-top:4px">
        <div><label>Punto di riordino</label><input id="ca_pr" type="number" min="0" value="\${cfg.punto_riordino}" style="width:120px"></div>
        <div><label>Capsule / confezione</label><input id="ca_cf" type="number" min="1" value="\${cfg.confezione}" style="width:120px"></div>
        <button class="btn ghost sm" id="ca_cfg">Salva parametri</button>
      </div>
      <table style="margin-top:12px"><thead><tr><th>Conta</th><th>Giacenza</th><th>Consumo</th><th>Operatore</th></tr></thead><tbody>\${conteRows}</tbody></table>
    </div>

    <div class="panel"><h3>\u{1F4BB} Coworking \u2014 posti occupati (max \${cw.max} mattina + \${cw.max} pomeriggio)</h3>
      \${cwRows ? \`<table><thead><tr><th>Giorno</th><th>Mattina</th><th>Pomeriggio</th></tr></thead><tbody>\${cwRows}</tbody></table>\` : '<p class="muted">Nessuna prenotazione coworking.</p>'}
    </div>

    <div class="panel"><h3>\u{1F3B2} Inventario giochi (uso libero) <button class="btn ghost sm" id="g_print" style="float:right">\u{1F5A8}\uFE0F Stampa modulo prelievo</button></h3>
      <table><thead><tr><th>Gioco</th><th>Categoria</th><th>Q.t\xE0</th><th>Stato</th><th>Note</th><th></th></tr></thead><tbody>\${giochiRows}</tbody></table>
      <div class="row" style="margin-top:10px;align-items:flex-end">
        <input id="ng_nome" placeholder="Nuovo gioco" style="max-width:200px">
        <select id="ng_cat">\${Object.keys(catLabel).map(k => \`<option value="\${k}">\${catLabel[k]}</option>\`).join('')}</select>
        <input id="ng_qta" type="number" min="1" value="1" style="width:70px">
        <button class="btn gold sm" id="ng_add">+ Aggiungi</button>
      </div>
    </div>

    <div class="panel"><h3>\u{1F4CB} Prelievi giochi (modulo) <button class="btn ghost sm" id="pr_new" style="float:right">+ Registra prelievo</button></h3>
      <table><thead><tr><th>Data</th><th>Gioco</th><th>Giocatore</th><th>Inizio</th><th>Fine</th></tr></thead><tbody>\${prestitiRows}</tbody></table>
    </div>

    <div class="panel"><h3>\u2705 Check strumenti & arredi (datati) <button class="btn gold sm" id="ck_new" style="float:right">+ Nuovo check</button></h3>
      <p class="muted" style="margin-bottom:8px">A ogni prelievo della macchina del caff\xE8: verifica magazzino caff\xE8, stato strumenti (mazzi, giochi, scacchiere) e arredi. Ogni check \xE8 datato; puoi allegare la foto della scheda cartacea.</p>
      <table><thead><tr><th>Data</th><th>Operatore</th><th>Caff\xE8</th><th>Esito</th><th>Note</th><th>Scheda</th></tr></thead><tbody>\${checkRows}</tbody></table>
    </div>\`;

  $('#ca_conta').onclick = async () => { const v = $('#ca_g').value; if (v === '') return; await api('/cdc/caffe/conta', { method: 'POST', body: JSON.stringify({ giacenza: v }) }); show('cdc'); };
  $('#ca_cfg').onclick = async () => { await api('/cdc/caffe', { method: 'PUT', body: JSON.stringify({ punto_riordino: $('#ca_pr').value, confezione: $('#ca_cf').value }) }); show('cdc'); };
  document.querySelectorAll('[data-gsave]').forEach(b => b.onclick = async () => { const id = b.dataset.gsave; await api('/cdc/giochi/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#gnome_' + id).value, categoria: $('#gcat_' + id).value, quantita: $('#gqta_' + id).value, stato: $('#gstato_' + id).value, note: $('#gnote_' + id).value }) }); b.textContent = '\u2713'; setTimeout(() => b.textContent = 'Salva', 1000); });
  document.querySelectorAll('[data-gdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il gioco dall\\'inventario?')) return; await api('/cdc/giochi/' + b.dataset.gdel, { method: 'DELETE' }); show('cdc'); });
  $('#ng_add').onclick = async () => { if (!$('#ng_nome').value) return; await api('/cdc/giochi', { method: 'POST', body: JSON.stringify({ nome: $('#ng_nome').value, categoria: $('#ng_cat').value, quantita: $('#ng_qta').value }) }); show('cdc'); };
  $('#g_print').onclick = () => stampaModuloPrelievo(giochi);
  $('#pr_new').onclick = () => openPrestito(giochi);
  document.querySelectorAll('[data-pfine]').forEach(b => b.onclick = async () => { const ora = new Date().toTimeString().slice(0, 5); await api('/cdc/prestiti/' + b.dataset.pfine, { method: 'PUT', body: JSON.stringify({ ora_fine: ora }) }); show('cdc'); });
  $('#ck_new').onclick = () => openCheck(cfg);
  document.querySelectorAll('[data-cfoto]').forEach(b => b.onclick = async () => { const r = await api('/cdc/check/' + b.dataset.cfoto + '/foto'); modal(\`<h3>Scheda check</h3><img src="\${r.foto}" style="max-width:100%;border-radius:8px"><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Chiudi</button></div>\`); $('#mCancel').onclick = closeModal; });
};
function openPrestito(giochi) {
  const opts = giochi.map(g => \`<option value="\${g.id}|\${esc(g.nome)}">\${esc(g.nome)}</option>\`).join('');
  const ora = new Date().toTimeString().slice(0, 5);
  modal(\`<h3>Registra prelievo</h3>
    <div class="grid2">
      <div><label>Gioco</label><select id="pk_g">\${opts || '<option>\u2014</option>'}</select></div>
      <div><label>Giocatore</label><input id="pk_gioc" placeholder="Nome del giocatore"></div>
      <div><label>Ora inizio</label><input id="pk_in" value="\${ora}"></div>
      <div><label>Ora fine (facolt.)</label><input id="pk_out" placeholder="\u2014"></div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => { const [id, nome] = ($('#pk_g').value || '|').split('|'); await api('/cdc/prestiti', { method: 'POST', body: JSON.stringify({ gioco_id: Number(id) || null, gioco_nome: nome || '', giocatore: $('#pk_gioc').value, ora_inizio: $('#pk_in').value, ora_fine: $('#pk_out').value }) }); closeModal(); show('cdc'); };
}
function openCheck(cfg) {
  let foto = null;
  modal(\`<h3>Nuovo check (datato)</h3>
    <div class="grid2">
      <div><label>Data</label><input id="ck_data" type="date" value="\${new Date().toISOString().slice(0, 10)}"></div>
      <div><label>Caff\xE8 \xB7 capsule contate</label><input id="ck_caffe" type="number" min="0" placeholder="es. 55"></div>
    </div>
    <label>Stato strumenti (mazzi, giochi da tavolo, scacchiere \u2014 pezzi mancanti/danneggiati)</label><textarea id="ck_str" rows="2"></textarea>
    <label>Arredi (tavoli, sedie, illuminazione\u2026)</label><textarea id="ck_arr" rows="2"></textarea>
    <label>Esito</label><select id="ck_es"><option value="ok">ok</option><option value="anomalie">anomalie</option></select>
    <div class="row" style="margin-top:10px;align-items:center"><button class="btn ghost sm" id="ck_foto">\u{1F4F7} Foto scheda cartacea</button><span class="muted" id="ck_fname"></span></div>
    <div class="err" id="ck_err"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva check</button></div>\`);
  $('#mCancel').onclick = closeModal;
  $('#ck_foto').onclick = () => pickPhoto(d => { foto = d; $('#ck_fname').textContent = 'foto acquisita \u2713'; });
  $('#mSave').onclick = async () => {
    try { await api('/cdc/check', { method: 'POST', body: JSON.stringify({ data: $('#ck_data').value, caffe_giacenza: $('#ck_caffe').value, strumenti_note: $('#ck_str').value, arredi_note: $('#ck_arr').value, esito: $('#ck_es').value, foto }) }); closeModal(); show('cdc'); }
    catch (e) { $('#ck_err').textContent = e.message; }
  };
}
function stampaModuloPrelievo(giochi) {
  const disponibili = giochi.map(g => esc(g.nome)).join(' \xB7 ');
  const righe = Array.from({ length: 14 }).map(() => \`<tr><td style="height:34px"></td><td></td><td></td><td></td></tr>\`).join('');
  const html = \`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Modulo prelievo giochi \u2014 Casa di Carta</title>
    <style>@page{margin:16mm} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#17242c}
      h1{font-family:Georgia,serif;color:#12324F;margin:0} .hd{border-bottom:2px solid #12324F;padding-bottom:8px;margin-bottom:8px}
      .meta{color:#5a6b75;font-size:13px;margin-top:4px} table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #bcc4cb;padding:6px 8px;font-size:13px;text-align:left} th{background:#f2efe6;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
      .disp{margin-top:10px;font-size:12px;color:#5a6b75} @media print{button{display:none}}</style></head>
    <body><div class="hd"><h1>Casa di Carta \xB7 Modulo prelievo giochi</h1>
      <div class="meta">Uso libero previa compilazione. Il giocatore scrive il gioco prelevato e l'ora di inizio; alla riconsegna indica l'ora di fine. Data: ____ / ____ / ______</div></div>
      <table><thead><tr><th>Gioco prelevato</th><th>Giocatore</th><th>Ora inizio</th><th>Ora fine</th></tr></thead><tbody>\${righe}</tbody></table>
      <div class="disp"><b>Giochi disponibili:</b> \${disponibili || '\u2014'}</div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 14px">Stampa</button>
    </body></html>\`;
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti le finestre pop-up per stampare il modulo.'); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch (_) {} }, 300);
}

// ---- Magazzino unificato ----
const MAG_AREE = [['chiosco', 'Chiosco'], ['casa_di_carta', 'Casa di Carta'], ['serata_clan', 'Serata Clan'], ['serate_tema', 'Serate a tema']];
const magAreaLabel = (a) => (MAG_AREE.find(x => x[0] === a) || [a, a])[1];
const magBadge = (s) => s === 'da_riordinare'
  ? '<span class="tag no">Da riordinare</span>'
  : s === 'in_esaurimento' ? '<span class="tag mid">In esaurimento</span>' : '<span class="tag ok">OK</span>';
VIEWS.magazzino = async () => {
  const data = await api('/magazzino').catch(() => ({ articoli: [], riepilogo: { da_riordinare: 0, in_esaurimento: 0, totale: 0 }, aree: [] }));
  const r = data.riepilogo || { da_riordinare: 0, in_esaurimento: 0, totale: 0 };
  const alert = \`<div class="panel"><h3>\u{1F4E6} Magazzino \xB7 riepilogo</h3>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px"><div class="muted" style="font-size:.72rem">Da riordinare</div><div style="font-size:1.6rem;font-weight:800;color:\${r.da_riordinare ? '#b14a35' : 'var(--navy)'}">\${r.da_riordinare}</div></div>
      <div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px"><div class="muted" style="font-size:.72rem">In esaurimento</div><div style="font-size:1.6rem;font-weight:800;color:\${r.in_esaurimento ? '#8a5a12' : 'var(--navy)'}">\${r.in_esaurimento}</div></div>
      <div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px"><div class="muted" style="font-size:.72rem">Articoli totali</div><div style="font-size:1.6rem;font-weight:800;color:var(--navy)">\${r.totale}</div></div>
    </div>
    <p class="muted" style="margin-top:10px;font-size:.78rem">L'alert <b>In esaurimento</b> scatta <i>prima</i> del riordino (soglia di preavviso). <b>Da riordinare</b> quando la giacenza scende al punto di riordino o sotto.</p></div>\`;

  const areeOrdine = [...new Set([...MAG_AREE.map(a => a[0]), ...(data.aree || [])])];
  const perArea = areeOrdine.map(area => {
    const arts = (data.articoli || []).filter(a => a.area === area);
    if (!arts.length) return '';
    const rows = arts.map(a => \`<tr>
      <td><input id="mg_n_\${a.id}" value="\${esc(a.nome)}" style="min-width:150px"></td>
      <td><input id="mg_u_\${a.id}" value="\${esc(a.unita)}" style="width:70px"></td>
      <td style="text-align:center"><b style="font-size:1rem">\${esc(String(a.giacenza))}</b></td>
      <td><input id="mg_pr_\${a.id}" type="number" value="\${esc(String(a.punto_riordino))}" style="width:70px"></td>
      <td><input id="mg_pa_\${a.id}" type="number" value="\${esc(String(a.soglia_preavviso))}" style="width:70px"></td>
      <td style="text-align:center">\${magBadge(a.stato)}</td>
      <td style="white-space:nowrap"><input id="mg_q_\${a.id}" type="number" placeholder="q.t\xE0" style="width:64px"> <button class="btn gold sm" data-mgmov="\${a.id}|carico">+ Carico</button> <button class="btn ghost sm" data-mgmov="\${a.id}|scarico">\u2212 Scarico</button> <button class="btn ghost sm" data-mgmov="\${a.id}|rettifica" title="Imposta la giacenza al valore contato">= Rettifica</button></td>
      <td style="white-space:nowrap"><button class="btn gold sm" data-mgsave="\${a.id}" data-area="\${esc(a.area)}">Salva</button> <button class="btn danger sm" data-mgdel="\${a.id}">\u{1F5D1}</button></td>
    </tr>\`).join('');
    return \`<div class="panel"><h3>\${esc(magAreaLabel(area))}</h3>
      <table><thead><tr><th>Articolo</th><th>Unit\xE0</th><th>Giacenza</th><th>Riordino</th><th>Preavviso</th><th>Stato</th><th>Movimento</th><th></th></tr></thead>
      <tbody>\${rows}</tbody></table></div>\`;
  }).join('');

  const areaOpts = MAG_AREE.map(a => \`<option value="\${a[0]}">\${esc(a[1])}</option>\`).join('');
  const nuovo = \`<div class="panel"><h3>+ Nuovo articolo</h3>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center">
      <input id="mg_new_n" placeholder="Nome (es. Bicchieri)" style="min-width:180px">
      <select id="mg_new_a">\${areaOpts}</select>
      <input id="mg_new_u" placeholder="Unit\xE0 (pz)" value="pz" style="width:80px">
      <input id="mg_new_g" type="number" placeholder="Giacenza" style="width:100px">
      <input id="mg_new_pr" type="number" placeholder="Riordino" style="width:100px">
      <input id="mg_new_pa" type="number" placeholder="Preavviso" style="width:100px">
      <button class="btn gold sm" id="mg_add">+ Aggiungi</button>
    </div>
    <p class="muted" style="margin-top:8px;font-size:.76rem">Il <b>preavviso</b> conviene impostarlo un po' sopra il <b>riordino</b>, cos\xEC ricevi l'avviso "in esaurimento" con anticipo.</p></div>\`;

  $('#view').innerHTML = alert + (perArea || '<div class="panel"><p class="muted">Nessun articolo. Aggiungine uno qui sotto.</p></div>') + nuovo;

  document.querySelectorAll('[data-mgmov]').forEach(b => b.onclick = async () => {
    const [id, tipo] = b.dataset.mgmov.split('|');
    const q = Number((document.getElementById('mg_q_' + id) || {}).value);
    if (!q && tipo !== 'rettifica') { alert('Indica la quantit\xE0.'); return; }
    let causale = null;
    if (tipo === 'rettifica' && (document.getElementById('mg_q_' + id) || {}).value === '') { alert('Indica la giacenza contata.'); return; }
    await api('/magazzino/' + id + '/movimento', { method: 'POST', body: JSON.stringify({ tipo, quantita: q, causale }) });
    show('magazzino');
  });
  document.querySelectorAll('[data-mgsave]').forEach(b => b.onclick = async () => {
    const id = b.dataset.mgsave;
    await api('/magazzino/' + id, { method: 'PUT', body: JSON.stringify({
      nome: $('#mg_n_' + id).value, unita: $('#mg_u_' + id).value, area: b.dataset.area,
      punto_riordino: Number($('#mg_pr_' + id).value), soglia_preavviso: Number($('#mg_pa_' + id).value),
    }) });
    show('magazzino');
  });
  document.querySelectorAll('[data-mgdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare l\\'articolo e il suo storico movimenti?')) return; await api('/magazzino/' + b.dataset.mgdel, { method: 'DELETE' }); show('magazzino'); });
  $('#mg_add').onclick = async () => {
    if (!$('#mg_new_n').value) { alert('Indica il nome.'); return; }
    await api('/magazzino', { method: 'POST', body: JSON.stringify({
      nome: $('#mg_new_n').value, area: $('#mg_new_a').value, unita: $('#mg_new_u').value || 'pz',
      giacenza: Number($('#mg_new_g').value || 0), punto_riordino: Number($('#mg_new_pr').value || 0), soglia_preavviso: Number($('#mg_new_pa').value || 0),
    }) });
    show('magazzino');
  };
};

// ---- Chiosco \xB7 Comande (cassa + board) ----
const COM_STATI = { aperta: ['Aperta', 'mid'], in_preparazione: ['In preparazione', 'mid'], pronta: ['Pronta', 'ok'], consegnata: ['Consegnata', 'ok'], chiusa: ['Chiusa', ''], annullata: ['Annullata', 'no'] };
const eur = (n) => '\u20AC ' + Number(n || 0).toFixed(2);
let COM_CART = {};
VIEWS.comande = async () => {
  const menu = (await api('/menu')).filter(m => m.attivo);
  const comande = await api('/comande');
  const mag = await api('/magazzino').catch(() => ({ articoli: [] }));

  // --- Cassa ---
  const perStaz = (st) => menu.filter(m => m.stazione === st);
  const menuBtns = (st) => perStaz(st).map(m => \`<button class="btn ghost sm" data-add="\${m.id}" style="margin:3px">\${esc(m.nome)} \xB7 \${eur(m.prezzo)}</button>\`).join('') || '<span class="muted">\u2014</span>';
  const cassa = \`<div class="panel"><h3>\u{1F9FE} Nuova comanda (cassa)</h3>
    <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <label>Origine <select id="co_orig"><option value="chiosco">Chiosco</option><option value="bancone">Bancone</option><option value="tavolo">Tavolo</option></select></label>
      <input id="co_rif" placeholder="Rif. (n\xB0 tavolo / nome)" style="max-width:200px">
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <div class="muted" style="font-weight:700;font-size:.75rem;margin:4px 0">\u{1F373} Cucina</div><div>\${menuBtns('cucina')}</div>
        <div class="muted" style="font-weight:700;font-size:.75rem;margin:10px 0 4px">\u{1F379} Bar</div><div>\${menuBtns('bar')}</div>
      </div>
      <div style="flex:1;min-width:240px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px">
        <b style="color:var(--navy)">Comanda</b><div id="co_cart" style="margin-top:6px"></div>
        <div id="co_tot" style="text-align:right;font-weight:800;margin-top:8px"></div>
        <button class="btn gold" id="co_send" style="width:100%;margin-top:8px">Invia comanda</button>
      </div>
    </div></div>\`;

  // --- Board comande attive ---
  const card = (c) => {
    const righe = (c.righe || []).map(r => \`<div style="display:flex;align-items:center;gap:6px;font-size:.82rem;padding:2px 0">
      <span style="flex:1">\${r.qta}\xD7 \${esc(r.nome)} <span class="muted">(\${r.stazione === 'cucina' ? '\u{1F373}' : '\u{1F379}'})</span>\${r.note ? \`<span class="muted"> \xB7 \${esc(r.note)}</span>\` : ''}</span>
      <span class="tag \${r.stato === 'consegnata' || r.stato === 'pronta' ? 'ok' : 'mid'}">\${esc(r.stato)}</span></div>\`).join('');
    const [lbl, cls] = COM_STATI[c.stato] || [c.stato, ''];
    return \`<div style="border:1px solid var(--line);border-radius:12px;padding:12px;min-width:250px;flex:1">
      <div class="row" style="justify-content:space-between;align-items:center"><b style="color:var(--navy)">#\${c.numero || c.id} \xB7 \${esc(c.origine)}\${c.riferimento ? ' ' + esc(c.riferimento) : ''}</b><span class="tag \${cls}">\${esc(lbl)}</span></div>
      <div style="margin:8px 0">\${righe}</div>
      <div style="text-align:right;font-weight:800;margin-bottom:8px">\${eur(c.totale)}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        \${c.stato === 'aperta' ? \`<button class="btn ghost sm" data-cstato="\${c.id}|in_preparazione">\u25B6 Avvia</button>\` : ''}
        \${c.stato === 'in_preparazione' ? \`<button class="btn ghost sm" data-cstato="\${c.id}|pronta">\u2714 Pronta</button>\` : ''}
        \${c.stato === 'pronta' ? \`<button class="btn ghost sm" data-cstato="\${c.id}|consegnata">\u{1F6CE} Consegnata</button>\` : ''}
        <button class="btn gold sm" data-cchiudi="\${c.id}">\u{1F4B6} Chiudi (cassa)</button>
        <button class="btn danger sm" data-cann="\${c.id}">\u2715</button>
      </div></div>\`;
  };
  const board = \`<div class="panel"><h3>\u{1F4CB} Comande in corso <button class="btn ghost sm" id="co_ref" style="margin-left:8px">\u21BB Aggiorna</button></h3>
    <div style="display:flex;gap:12px;flex-wrap:wrap">\${comande.map(card).join('') || '<p class="muted">Nessuna comanda attiva.</p>'}</div></div>\`;

  // --- Gestione menu ---
  const magOpts = (sel) => \`<option value="">\u2014 nessuno \u2014</option>\` + (mag.articoli || []).map(a => \`<option value="\${a.id}" \${String(sel) === String(a.id) ? 'selected' : ''}>\${esc(a.nome)} (\${esc(a.area)})</option>\`).join('');
  const allMenu = await api('/menu');
  const menuRows = allMenu.map(m => \`<tr>
    <td><input id="mn_n_\${m.id}" value="\${esc(m.nome)}" style="min-width:150px"></td>
    <td><input id="mn_p_\${m.id}" type="number" step="0.5" value="\${esc(String(m.prezzo))}" style="width:80px"></td>
    <td><select id="mn_s_\${m.id}"><option value="bar" \${m.stazione === 'bar' ? 'selected' : ''}>Bar</option><option value="cucina" \${m.stazione === 'cucina' ? 'selected' : ''}>Cucina</option></select></td>
    <td><select id="mn_m_\${m.id}">\${magOpts(m.magazzino_id)}</select></td>
    <td style="text-align:center"><input type="checkbox" id="mn_a_\${m.id}" \${m.attivo ? 'checked' : ''}></td>
    <td style="white-space:nowrap"><button class="btn gold sm" data-mnsave="\${m.id}">Salva</button> <button class="btn danger sm" data-mndel="\${m.id}">\u{1F5D1}</button></td>
  </tr>\`).join('');
  const menuPanel = \`<div class="panel"><h3>\u{1F354} Menu del chiosco</h3>
    <p class="muted" style="font-size:.78rem;margin-bottom:8px">Collega un articolo al <b>magazzino</b> per lo scarico automatico alla chiusura della comanda.</p>
    <table><thead><tr><th>Articolo</th><th>Prezzo</th><th>Stazione</th><th>Scarico magazzino</th><th>Attivo</th><th></th></tr></thead><tbody>\${menuRows || '<tr><td colspan="6" class="muted">Nessun articolo.</td></tr>'}</tbody></table>
    <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px;align-items:center">
      <input id="mn_new_n" placeholder="Nome (es. Panino)" style="min-width:160px"><input id="mn_new_p" type="number" step="0.5" placeholder="Prezzo" style="width:90px">
      <select id="mn_new_s"><option value="bar">Bar</option><option value="cucina">Cucina</option></select>
      <select id="mn_new_m">\${magOpts('')}</select>
      <button class="btn gold sm" id="mn_add">+ Aggiungi</button>
    </div></div>\`;

  $('#view').innerHTML = cassa + board + menuPanel;

  // Cassa: carrello in memoria
  const renderCart = () => {
    const items = Object.values(COM_CART);
    $('#co_cart').innerHTML = items.length ? items.map(it => \`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.82rem">
      <span style="flex:1">\${esc(it.menu.nome)}</span>
      <button class="btn ghost sm" data-dec="\${it.menu.id}">\u2212</button><b>\${it.qta}</b><button class="btn ghost sm" data-inc="\${it.menu.id}">+</button>
      <span style="width:60px;text-align:right">\${eur(it.menu.prezzo * it.qta)}</span></div>\`).join('') : '<span class="muted" style="font-size:.8rem">Nessun articolo.</span>';
    const tot = items.reduce((s, it) => s + it.menu.prezzo * it.qta, 0);
    $('#co_tot').textContent = 'Totale ' + eur(tot);
    document.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { COM_CART[b.dataset.inc].qta++; renderCart(); });
    document.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { const it = COM_CART[b.dataset.dec]; it.qta--; if (it.qta <= 0) delete COM_CART[b.dataset.dec]; renderCart(); });
  };
  COM_CART = {};
  renderCart();
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const m = menu.find(x => String(x.id) === b.dataset.add); if (!m) return; if (COM_CART[m.id]) COM_CART[m.id].qta++; else COM_CART[m.id] = { menu: m, qta: 1 }; renderCart(); });
  $('#co_send').onclick = async () => {
    const righe = Object.values(COM_CART).map(it => ({ menu_id: it.menu.id, qta: it.qta }));
    if (!righe.length) { alert('Aggiungi almeno un articolo.'); return; }
    await api('/comande', { method: 'POST', body: JSON.stringify({ origine: $('#co_orig').value, riferimento: $('#co_rif').value, righe }) });
    COM_CART = {}; show('comande');
  };
  $('#co_ref').onclick = () => show('comande');

  // Board azioni
  document.querySelectorAll('[data-cstato]').forEach(b => b.onclick = async () => { const [id, st] = b.dataset.cstato.split('|'); await api('/comande/' + id + '/stato', { method: 'PUT', body: JSON.stringify({ stato: st }) }); show('comande'); });
  document.querySelectorAll('[data-cchiudi]').forEach(b => b.onclick = async () => { if (!confirm('Chiudere la comanda come pagata in cassa? Verr\xE0 scaricato il magazzino collegato.')) return; await api('/comande/' + b.dataset.cchiudi + '/chiudi', { method: 'POST' }); show('comande'); });
  document.querySelectorAll('[data-cann]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare/annullare la comanda?')) return; await api('/comande/' + b.dataset.cann, { method: 'DELETE' }); show('comande'); });

  // Menu azioni
  document.querySelectorAll('[data-mnsave]').forEach(b => b.onclick = async () => { const id = b.dataset.mnsave; await api('/menu/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#mn_n_' + id).value, prezzo: Number($('#mn_p_' + id).value), stazione: $('#mn_s_' + id).value, magazzino_id: $('#mn_m_' + id).value || null, attivo: $('#mn_a_' + id).checked }) }); show('comande'); });
  document.querySelectorAll('[data-mndel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare l\\'articolo di menu?')) return; await api('/menu/' + b.dataset.mndel, { method: 'DELETE' }); show('comande'); });
  $('#mn_add').onclick = async () => { if (!$('#mn_new_n').value) { alert('Indica il nome.'); return; } await api('/menu', { method: 'POST', body: JSON.stringify({ nome: $('#mn_new_n').value, prezzo: Number($('#mn_new_p').value || 0), stazione: $('#mn_new_s').value, magazzino_id: $('#mn_new_m').value || null }) }); show('comande'); };
};

// ---- KDS: schermo cucina/bar con coda in tempo reale ----
let KDS_STAZ = '';
VIEWS.kds = async () => {
  const render = async () => {
    const q = await api('/kds' + (KDS_STAZ ? '?stazione=' + KDS_STAZ : '')).catch(() => []);
    const filtro = \`<div class="panel"><h3>\u{1F5A5}\uFE0F KDS \xB7 coda di preparazione
      <span style="margin-left:10px;font-size:.8rem;font-weight:400">Stazione:
        <select id="kds_st"><option value="">Tutte</option><option value="cucina" \${KDS_STAZ === 'cucina' ? 'selected' : ''}>Cucina</option><option value="bar" \${KDS_STAZ === 'bar' ? 'selected' : ''}>Bar</option></select></span>
      <span class="muted" style="margin-left:10px;font-size:.72rem">aggiornamento automatico</span></h3></div>\`;
    const cards = q.map(c => {
      const righe = c.righe.map(r => \`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f0f0f0">
        <span style="flex:1;font-size:.95rem"><b>\${r.qta}\xD7</b> \${esc(r.nome)} <span class="muted">(\${r.stazione === 'cucina' ? '\u{1F373}' : '\u{1F379}'})</span>\${r.note ? \`<div class="muted" style="font-size:.75rem">\${esc(r.note)}</div>\` : ''}</span>
        \${r.stato === 'in_coda' ? \`<button class="btn gold sm" data-kr="\${c.id}|\${r.id}|pronta">Pronta \u2714</button>\` : ''}
        \${r.stato === 'pronta' ? \`<button class="btn ghost sm" data-kr="\${c.id}|\${r.id}|consegnata">Consegna \u{1F6CE}</button><span class="tag ok">pronta</span>\` : ''}
      </div>\`).join('');
      const parseTs = (s) => { if (!s) return null; const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z'); return isNaN(d.getTime()) ? null : d; };
      const dt = parseTs(c.created_at);
      const mins = dt ? Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000)) : null;
      return \`<div style="border:2px solid var(--navy);border-radius:12px;padding:12px;min-width:270px;flex:1;background:#fff">
        <div class="row" style="justify-content:space-between"><b style="font-size:1.05rem;color:var(--navy)">#\${c.numero || c.id} \xB7 \${esc(c.origine)}\${c.riferimento ? ' ' + esc(c.riferimento) : ''}</b>\${mins != null ? \`<span class="tag \${mins >= 10 ? 'no' : 'mid'}">\${mins}\u2032</span>\` : ''}</div>
        <div style="margin-top:6px">\${righe}</div></div>\`;
    }).join('');
    $('#view').innerHTML = filtro + \`<div style="display:flex;gap:12px;flex-wrap:wrap">\${cards || '<p class="muted">Nessun ordine in coda. \u{1F389}</p>'}</div>\`;
    $('#kds_st').onchange = (e) => { KDS_STAZ = e.target.value; render(); };
    document.querySelectorAll('[data-kr]').forEach(b => b.onclick = async () => { const [cid, rid, st] = b.dataset.kr.split('|'); await api('/comande/' + cid + '/riga/' + rid + '/stato', { method: 'PUT', body: JSON.stringify({ stato: st }) }); render(); });
  };
  await render();
  window.__kdsTimer = setInterval(render, 8000); // auto-refresh coda ogni 8s
};

// ---- Proposte ----
VIEWS.proposte = async () => {
  const list = await api('/proposte');
  const render = () => \`<div class="panel"><h3>Proposte (Vinile & Open Mic)</h3><table><thead><tr><th>Tipo</th><th>Titolo</th><th>Da</th><th>Stato</th><th></th></tr></thead><tbody>
    \${list.map(p => \`<tr><td>\${esc(p.tipo)}</td><td><b>\${esc(p.titolo||'')}</b><br><span class="muted">\${esc(p.dettaglio||'')}</span></td>
      <td>\${esc((p.nome||'Ospite')+' '+(p.cognome||''))}</td><td><span class="tag \${p.stato==='in_scaletta'?'ok':p.stato==='scartata'?'no':'mid'}">\${esc(p.stato)}</span></td>
      <td style="white-space:nowrap"><button class="btn gold sm" data-st="\${p.id}|in_scaletta">In scaletta</button> <button class="btn ghost sm" data-st="\${p.id}|scartata">Scarta</button></td></tr>\`).join('') || '<tr><td colspan="5" class="muted">Nessuna proposta.</td></tr>'}
  </tbody></table></div>\`;
  $('#view').innerHTML = render();
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
    const [id, stato] = b.dataset.st.split('|'); await api('/proposte/' + id, { method:'PUT', body:JSON.stringify({ stato }) }); show('proposte');
  });
};

// ---- Eventi ----
VIEWS.eventi = async () => {
  const list = await api('/eventi');
  $('#view').innerHTML = \`<div class="panel"><h3>Cartellone</h3><table><thead><tr><th>Giorno</th><th>Titolo</th><th>Ambiente</th><th>Attivo</th><th></th></tr></thead><tbody>
    \${list.map(e => \`<tr><td>\${esc(e.giorno)}</td><td><b>\${esc(e.titolo)}</b><br><span class="muted">\${esc(e.sottotitolo||'')}</span></td>
      <td>\${esc(e.ambiente||'')}</td><td>\${e.attivo?'<span class="tag ok">s\xEC</span>':'<span class="tag no">no</span>'}</td>
      <td><button class="btn ghost sm" data-ev="\${e.id}">\u270E</button></td></tr>\`).join('')}
  </tbody></table></div>\`;
  document.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => {
    const e = list.find(x => x.id == b.dataset.ev);
    modal(\`<h3>Modifica evento</h3>
      <label>Titolo</label><input id="e_t" value="\${esc(e.titolo)}">
      <label>Sottotitolo</label><input id="e_s" value="\${esc(e.sottotitolo||'')}">
      <label>Ambiente</label><input id="e_a" value="\${esc(e.ambiente||'')}">
      <label>Descrizione</label><textarea id="e_d" rows="4">\${esc(e.descrizione||'')}</textarea>
      <label class="check"><input type="checkbox" id="e_on" \${e.attivo?'checked':''}> Visibile nell'app</label>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => { await api('/eventi/'+e.id, { method:'PUT', body:JSON.stringify({ titolo:$('#e_t').value, sottotitolo:$('#e_s').value, ambiente:$('#e_a').value, descrizione:$('#e_d').value, attivo:$('#e_on').checked }) }); closeModal(); show('eventi'); };
  });
};

// ---- Bussola ----
const RIF_DAYS = [['lun', 'Lun'], ['mar', 'Mar'], ['mer', 'Mer'], ['gio', 'Gio'], ['ven', 'Ven'], ['sab', 'Sab'], ['dom', 'Dom']];
// normalizza il valore di un giorno in un ARRAY di tipi (retro-compat: stringa singola o vuoto)
function rifNorm(v) { if (Array.isArray(v)) return v.filter(Boolean); if (v == null || v === '') return []; return [String(v)]; }
function rifTxt(hex) { if (!hex) return '#fff'; const h = hex.replace('#', ''); if (h.length < 6) return '#fff'; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1a1a1a' : '#fff'; }
function rifGrad(cols) { if (!cols.length) return '#fff'; if (cols.length === 1) return cols[0]; const n = cols.length; return 'linear-gradient(180deg,' + cols.map((c, i) => \`\${c} \${Math.round(i / n * 100)}%, \${c} \${Math.round((i + 1) / n * 100)}%\`).join(', ') + ')'; }
VIEWS.bussola = async () => {
  const list = await api('/bussola');
  const rif = await api('/rifiuti').catch(() => ({ tipi: [], calendari: [] }));
  const colorBy = {}; rif.tipi.forEach(t => colorBy[t.nome] = t.colore);
  const legenda = \`<div class="panel"><h3>\u267B\uFE0F Rifiuti \xB7 legenda (tipo e colore)</h3>
    <table><thead><tr><th>Tipo</th><th>Colore</th><th></th></tr></thead><tbody>
      \${rif.tipi.map(t => \`<tr><td><input id="rt_n_\${t.id}" value="\${esc(t.nome)}" style="min-width:160px"></td><td><input type="color" id="rt_c_\${t.id}" value="\${esc(t.colore)}"></td><td style="white-space:nowrap"><button class="btn gold sm" data-rtsave="\${t.id}">Salva</button> <button class="btn danger sm" data-rtdel="\${t.id}">\u{1F5D1}</button></td></tr>\`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:10px"><input id="rt_new_n" placeholder="Nuovo tipo (es. Organico)" style="max-width:220px"><input type="color" id="rt_new_c" value="#7A8790"><button class="btn gold sm" id="rt_add">+ Aggiungi</button></div></div>\`;
  const periodBlocks = rif.calendari.map(c => {
    const matrix = rif.tipi.length ? \`<table class="rc_matrix" style="width:100%;border-collapse:collapse;margin-top:4px">
      <thead><tr><th style="text-align:left;padding:4px 8px;font-size:.72rem;color:var(--muted)">Rifiuto</th>\${RIF_DAYS.map(([, l]) => \`<th style="text-align:center;padding:4px 2px;font-size:.72rem;color:var(--muted)">\${l}</th>\`).join('')}</tr></thead>
      <tbody>\${rif.tipi.map(t => \`<tr>
        <td style="padding:5px 8px;white-space:nowrap"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:\${esc(t.colore)};vertical-align:middle;margin-right:7px;border:1px solid rgba(0,0,0,.12)"></span><b style="font-size:.82rem">\${esc(t.nome)}</b></td>
        \${RIF_DAYS.map(([d]) => { const on = rifNorm((c.giorni || {})[d]).includes(t.nome); return \`<td style="text-align:center;padding:3px"><button type="button" class="rc_tog\${on ? ' active' : ''}" data-per="\${esc(c.periodo)}" data-day="\${d}" data-tipo="\${esc(t.nome)}" data-col="\${esc(t.colore)}" aria-pressed="\${on}" title="\${esc(t.nome)} \xB7 \${d}" style="width:26px;height:26px;border-radius:7px;cursor:pointer;font-size:.8rem;font-weight:800;line-height:1;padding:0">\${on ? '\u2713' : ''}</button></td>\`; }).join('')}
      </tr>\`).join('')}</tbody></table>\` : \`<p class="muted" style="font-size:.8rem">Prima aggiungi almeno un tipo di rifiuto nella legenda qui sopra.</p>\`;
    return \`<div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:14px">
      <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <b style="font-size:1rem;color:var(--navy)">\${esc(c.periodo)}</b>
        <span class="muted" style="font-size:.78rem;margin-left:6px">Conferimento</span>
        <input id="rc_ini_\${esc(c.periodo)}" value="\${esc(c.inizio_conf || '')}" style="width:64px" placeholder="18:30"><span class="muted">\u2013</span><input id="rc_fin_\${esc(c.periodo)}" value="\${esc(c.fine_conf || '')}" style="width:64px" placeholder="21:30">
        <span class="muted" style="font-size:.78rem">\xB7 Ritiro</span><input id="rc_rit_\${esc(c.periodo)}" value="\${esc(c.ora_ritiro || '')}" style="width:64px" placeholder="22:00">
        <span style="flex:1"></span>
        <button class="btn gold sm" data-rcsave="\${esc(c.periodo)}">Salva</button> <button class="btn danger sm" data-rcdel="\${esc(c.periodo)}">\u{1F5D1}</button>
      </div>
      \${matrix}
    </div>\`;
  }).join('');
  const calendario = \`<div class="panel"><h3>\u267B\uFE0F Rifiuti \xB7 calendario conferimento</h3>
    <p class="muted" style="margin-bottom:12px">Per ogni periodo, imposta gli orari e <b>clicca le caselle</b>: ogni riga \xE8 un rifiuto, ogni colonna un giorno. Un giorno pu\xF2 avere pi\xF9 rifiuti (es. venerd\xEC: Carta <i>e</i> Vetro). La casella accesa mostra il colore della legenda.</p>
    \${periodBlocks || \`<p class="muted">Nessun periodo. Aggiungine uno qui sotto.</p>\`}
    <div class="row" style="margin-top:6px"><input id="rc_new_per" placeholder="Nuovo periodo (es. Invernale)" style="max-width:220px"><button class="btn gold sm" id="rc_add">+ Aggiungi periodo</button></div></div>\`;
  $('#view').innerHTML = legenda + calendario + \`<div class="panel"><h3>Contenuti guida</h3>
    <div class="row"><select id="b_sez"><option value="servizi">servizi</option><option value="vedere">vedere</option><option value="orari">orari</option></select>
      <input id="b_tit" placeholder="Titolo"><input id="b_det" placeholder="Dettaglio"><input id="b_dist" placeholder="Distanza" style="max-width:110px"><button class="btn gold sm" id="b_add">+ Aggiungi</button></div>
    <table><thead><tr><th>Sezione</th><th>Titolo</th><th>Dettaglio</th><th>Distanza</th><th></th></tr></thead><tbody>
    \${list.filter(b => b.sezione !== 'rifiuti').map(b => \`<tr><td>\${esc(b.sezione)}</td><td><b>\${esc(b.titolo)}</b></td><td>\${esc(b.dettaglio || '')}</td><td>\${esc(b.distanza || '')}</td><td><button class="btn danger sm" data-del="\${b.id}">\u{1F5D1}</button></td></tr>\`).join('')}
  </tbody></table></div>\`;
  // caselle matrice: accese col colore del rifiuto, spente su fondo bianco
  const styleTog = (btn) => { const on = btn.classList.contains('active'); const col = btn.dataset.col || '#7A8790'; if (on) { btn.style.background = col; btn.style.border = '1.5px solid ' + col; btn.style.color = rifTxt(col); btn.textContent = '\u2713'; } else { btn.style.background = '#fff'; btn.style.border = '1.5px solid #cbd2d8'; btn.style.color = ''; btn.textContent = ''; } };
  document.querySelectorAll('.rc_tog').forEach(btn => { styleTog(btn); btn.onclick = () => { btn.classList.toggle('active'); btn.setAttribute('aria-pressed', btn.classList.contains('active')); styleTog(btn); }; });
  // legenda
  document.querySelectorAll('[data-rtsave]').forEach(b => b.onclick = async () => { const id = b.dataset.rtsave; await api('/rifiuti/tipo/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#rt_n_' + id).value, colore: $('#rt_c_' + id).value }) }); show('bussola'); });
  document.querySelectorAll('[data-rtdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il tipo di rifiuto?')) return; await api('/rifiuti/tipo/' + b.dataset.rtdel, { method: 'DELETE' }); show('bussola'); });
  $('#rt_add').onclick = async () => { if (!$('#rt_new_n').value) return; await api('/rifiuti/tipo', { method: 'POST', body: JSON.stringify({ nome: $('#rt_new_n').value, colore: $('#rt_new_c').value }) }); show('bussola'); };
  // calendario
  document.querySelectorAll('[data-rcsave]').forEach(b => b.onclick = async () => {
    const per = b.dataset.rcsave; const giorni = {};
    RIF_DAYS.forEach(([d]) => giorni[d] = [...document.querySelectorAll(\`.rc_tog.active[data-per="\${CSS.escape(per)}"][data-day="\${d}"]\`)].map(x => x.dataset.tipo));
    const gv = (p) => (document.getElementById('rc_' + p + '_' + per) || {}).value || '';
    await api('/rifiuti/calendario/' + encodeURIComponent(per), { method: 'PUT', body: JSON.stringify({ inizio_conf: gv('ini'), fine_conf: gv('fin'), ora_ritiro: gv('rit'), giorni }) });
    b.textContent = '\u2713'; setTimeout(() => b.textContent = 'Salva', 1000);
  });
  document.querySelectorAll('[data-rcdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il periodo?')) return; await api('/rifiuti/calendario/' + encodeURIComponent(b.dataset.rcdel), { method: 'DELETE' }); show('bussola'); });
  $('#rc_add').onclick = async () => { const per = ($('#rc_new_per').value || '').trim(); if (!per) return; await api('/rifiuti/calendario/' + encodeURIComponent(per), { method: 'PUT', body: JSON.stringify({ giorni: {} }) }); show('bussola'); };
  $('#b_add').onclick = async () => { await api('/bussola', { method: 'POST', body: JSON.stringify({ sezione: $('#b_sez').value, titolo: $('#b_tit').value, dettaglio: $('#b_det').value, distanza: $('#b_dist').value }) }); show('bussola'); };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('/bussola/' + b.dataset.del, { method: 'DELETE' }); show('bussola'); });
};

// ---- Luoghi "Siamo qui" ----
function parseCoords(s) {
  if (!s) return null;
  // link Google Maps con @lat,lng  oppure  q=lat,lng  oppure  "lat, lng"
  let m = s.match(/@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)/) || s.match(/[?&]q=(-?\\d+\\.\\d+),\\s*(-?\\d+\\.\\d+)/) || s.match(/(-?\\d+\\.\\d+)\\s*,\\s*(-?\\d+\\.\\d+)/);
  return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
}
VIEWS.luoghi = async () => {
  const list = await api('/luoghi');
  $('#view').innerHTML = \`
    <div class="panel"><h3>Punti "Siamo qui" \u2014 coordinate</h3>
      <p class="muted" style="margin-bottom:12px">Su Google Maps: tasto destro sul punto \u2192 <b>clic sulle coordinate per copiarle</b>, poi incollale qui sotto (accetto anche il link della mappa). Al clic nell'app si aprir\xE0 il punto esatto.</p>
      \${list.map(l => \`<div class="card" style="border:1px solid var(--line);padding:14px;margin-bottom:12px">
        <div class="row" style="margin-bottom:8px"><b style="color:var(--navy)">\${esc(l.chiave === 'chiosco' ? '\u{1F4CD}' : '\u267B\uFE0F')} \${esc(l.nome)}</b></div>
        <div class="grid2">
          <div><label>Nome</label><input id="n_\${l.id}" value="\${esc(l.nome)}"></div>
          <div><label>Incolla link o coordinate</label><input id="p_\${l.id}" placeholder="es. 37.0335, 15.2969 oppure link Maps"></div>
          <div><label>Latitudine</label><input id="lat_\${l.id}" value="\${l.lat ?? ''}"></div>
          <div><label>Longitudine</label><input id="lng_\${l.id}" value="\${l.lng ?? ''}"></div>
        </div>
        <div class="row" style="margin-top:10px;align-items:center">
          <button class="btn gold sm" data-save="\${l.id}">Salva</button>
          <a class="btn ghost sm" id="prev_\${l.id}" href="https://www.google.com/maps?q=\${l.lat ?? ''},\${l.lng ?? ''}" target="_blank" style="text-decoration:none">Anteprima mappa \u2197</a>
          <span class="muted" id="ok_\${l.id}"></span>
        </div>
      </div>\`).join('')}
    </div>\`;
  list.forEach(l => {
    const pasteEl = document.getElementById('p_' + l.id);
    pasteEl.addEventListener('input', () => { const c = parseCoords(pasteEl.value); if (c) { $('#lat_' + l.id).value = c.lat; $('#lng_' + l.id).value = c.lng; } });
    document.getElementById('prev_' + l.id).onclick = (e) => { e.preventDefault(); window.open('https://www.google.com/maps?q=' + $('#lat_' + l.id).value + ',' + $('#lng_' + l.id).value, '_blank'); };
    document.querySelector(\`[data-save="\${l.id}"]\`).onclick = async () => {
      await api('/luoghi/' + l.id, { method: 'PUT', body: JSON.stringify({ nome: $('#n_' + l.id).value, lat: $('#lat_' + l.id).value, lng: $('#lng_' + l.id).value }) });
      $('#ok_' + l.id).textContent = '\u2713 Salvato'; setTimeout(() => $('#ok_' + l.id).textContent = '', 1500);
    };
  });
};

// ---- Discipline parametriche ----
VIEWS.discipline = async () => {
  const list = await api('/discipline');
  const row = (d) => \`<tr>
    <td>\${esc(d.dominio)}</td>
    <td><input id="dn_\${d.id}" value="\${esc(d.nome)}" style="min-width:150px"></td>
    <td style="text-align:center"><input type="checkbox" id="da_\${d.id}" \${d.attivo?'checked':''}></td>
    <td><input type="number" id="dmin_\${d.id}" value="\${d.min_giocatori}" style="width:60px"></td>
    <td><input type="number" id="dmax_\${d.id}" value="\${d.max_giocatori}" style="width:60px"></td>
    <td><input type="number" id="dpv_\${d.id}" value="\${d.punti_vitt}" style="width:55px"></td>
    <td><input type="number" id="dpp_\${d.id}" value="\${d.punti_par}" style="width:55px"></td>
    <td style="white-space:nowrap"><button class="btn gold sm" data-dsave="\${d.id}">Salva</button> \${can('discipline_del') ? \`<button class="btn danger sm" data-ddel="\${d.id}">\u{1F5D1}</button>\` : ''}</td>
  </tr>\`;
  $('#view').innerHTML = \`
    <div class="panel"><h3>Discipline \u2014 attiva/disattiva e partecipanti</h3>
      <p class="muted" style="margin-bottom:10px">Disattiva una disciplina per non giocarla quest'anno (resta in archivio). Min/Max = partecipanti per casata a partita; i punti in graduatoria si assegnano per <b>vittoria</b> e per <b>pareggio</b>.</p>
      <table><thead><tr><th>Dominio</th><th>Nome</th><th>Attiva</th><th>Min</th><th>Max</th><th>Punti vittoria</th><th>Punti pareggio</th><th></th></tr></thead>
      <tbody>\${list.map(row).join('')}</tbody></table>
    </div>
    <div class="panel"><h3>Aggiungi disciplina</h3>
      <div class="row">
        <select id="nd_dom"><option value="sport">sport</option><option value="giochi">giochi</option></select>
        <input id="nd_chiave" placeholder="chiave (es. backgammon)" style="max-width:200px">
        <input id="nd_nome" placeholder="Nome (es. Backgammon)" style="max-width:220px">
        <input id="nd_min" type="number" placeholder="min" value="2" style="width:70px">
        <input id="nd_max" type="number" placeholder="max" value="2" style="width:70px">
        <button class="btn gold sm" id="nd_add">+ Aggiungi</button>
      </div><div class="err" id="nd_err"></div>
    </div>\`;
  document.querySelectorAll('[data-dsave]').forEach(b => b.onclick = async () => {
    const id = b.dataset.dsave;
    await api('/discipline/' + id, { method:'PUT', body: JSON.stringify({ nome:$('#dn_'+id).value, attivo:$('#da_'+id).checked, min_giocatori:$('#dmin_'+id).value, max_giocatori:$('#dmax_'+id).value, punti_vitt:$('#dpv_'+id).value, punti_par:$('#dpp_'+id).value }) });
    b.textContent='\u2713'; setTimeout(()=>b.textContent='Salva',1200);
  });
  document.querySelectorAll('[data-ddel]').forEach(b => b.onclick = async () => { if(!confirm('Eliminare la disciplina (e i suoi gironi/partite)?'))return; await api('/discipline/'+b.dataset.ddel,{method:'DELETE'}); show('discipline'); });
  $('#nd_add').onclick = async () => {
    try { await api('/discipline', { method:'POST', body: JSON.stringify({ dominio:$('#nd_dom').value, chiave:$('#nd_chiave').value, nome:$('#nd_nome').value, attivo:true, min_giocatori:$('#nd_min').value, max_giocatori:$('#nd_max').value }) }); show('discipline'); }
    catch(e){ $('#nd_err').textContent = e.message; }
  };
};

// ---- Tabellone: gironi, calendario, risultati (auto-graduatoria) ----
function gironeHtml(g) {
  const cls = \`<table><thead><tr><th>Squadra</th><th>PG</th><th>V</th><th>N</th><th>Pt</th></tr></thead><tbody>\${g.classifica.map((r, i) => \`<tr><td><b>\${i + 1}.</b> \${esc(r.nome)}</td><td>\${r.pg}</td><td>\${r.v}</td><td>\${r.p}</td><td><b>\${r.pt}</b></td></tr>\`).join('')}</tbody></table>\`;
  const byG = {}; g.partite.forEach(p => { (byG[p.giornata] ??= []).push(p); });
  const cal = Object.keys(byG).map(gn => \`<div style="margin-top:10px"><b class="muted">Giornata \${gn}</b>\${byG[gn].map(p => \`
    <div style="display:flex;gap:8px;align-items:center;padding:5px 0">
      <span style="flex:1;text-align:right">\${esc(p.casa_a)}</span>
      <input id="ga_\${p.id}" type="number" min="0" value="\${p.gol_a ?? ''}" style="width:48px;text-align:center">
      <span>\u2013</span>
      <input id="gb_\${p.id}" type="number" min="0" value="\${p.gol_b ?? ''}" style="width:48px;text-align:center">
      <span style="flex:1">\${esc(p.casa_b)}</span>
      <button class="btn gold sm" data-psave="\${p.id}">\${p.stato === 'giocata' ? '\u2713' : 'Salva'}</button>
      <button class="btn ghost sm" data-pfoto="\${p.id}" title="Foto del punteggio (anti-contestazione)">\u{1F4F7}</button>
    </div>\`).join('')}</div>\`).join('');
  return \`<div class="panel"><h3>\${esc(g.nome)}</h3>\${cls}\${cal}</div>\`;
}
VIEWS.tabellone = async () => {
  const discs = await api('/discipline');
  if (!discs.length) { $('#view').innerHTML = '<p class="muted">Nessuna disciplina.</p>'; return; }
  let cur = discs[0].id;
  const render = async () => {
    const t = await api('/tabellone/' + cur);
    const disc = (await api('/discipline')).find(d => d.id == cur) || {};   // fresco (periodo/regolamento)
    const edz = await api('/tabellone/' + cur + '/edizioni').catch(() => []);
    const giornate = [...new Set(t.gironi.flatMap(g => g.partite.map(p => p.giornata)))].sort((a, b) => a - b);
    const finali = t.finali ? \`<div class="panel"><h3>Fase finale \xB7 qualificate</h3>\${t.finali.semifinali.map((s, i) => \`<div style="padding:6px 0"><b>Semifinale \${i + 1}:</b> \${esc(s.casa || '\u2014')} vs \${esc(s.ospite || '\u2014')}</div>\`).join('')}</div>\` : '';
    const statoTag = { preparazione: 'mid', in_corso: 'ok', archiviato: 'no' }[disc.stato] || 'mid';
    const settings = \`<div class="panel"><h3>Periodo, stato e regolamento <span class="tag \${statoTag}">\${esc(disc.stato || 'preparazione')}</span></h3>
      <div class="grid2">
        <div><label>Inizio periodo</label><input id="tb_di" type="date" value="\${esc(disc.data_inizio || '')}"></div>
        <div><label>Fine periodo</label><input id="tb_df" type="date" value="\${esc(disc.data_fine || '')}"></div>
        <div><label>Stato</label><select id="tb_stato">\${['preparazione', 'in_corso', 'archiviato'].map(s => \`<option \${disc.stato === s ? 'selected' : ''}>\${s}</option>\`).join('')}</select></div>
      </div>
      <label>Regolamento (visibile in app ai soci)</label><textarea id="tb_reg" rows="4" placeholder="Regole del torneo di questa disciplina\u2026">\${esc(disc.regolamento || '')}</textarea>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <button class="btn gold sm" id="tb_setSave">Salva impostazioni</button>
        <button class="btn ghost sm" id="tb_archivia">\u{1F4DA} Archivia edizione (Albo d'Oro)</button>
      </div></div>\`;
    const albo = edz.length ? \`<div class="panel"><h3>Albo d'Oro \u2014 edizioni archiviate</h3><table><thead><tr><th>Periodo</th><th>Vincitrice</th><th>Archiviata</th></tr></thead><tbody>
      \${edz.map(e => \`<tr><td>\${esc((e.data_inizio || '') + (e.data_fine ? ' \u2192 ' + e.data_fine : '')) || '\u2014'}</td><td><b>\${esc(e.vincitore || '\u2014')}</b></td><td class="muted">\${esc(e.archiviata_at || '')}</td></tr>\`).join('')}</tbody></table></div>\` : '';
    const regs = await api('/regolamenti').catch(() => []);
    const regsPanel = \`<div class="panel"><h3>Regolamenti generali (visibili in app)</h3>
      \${regs.map(r => \`<div style="margin-bottom:10px"><label>\${esc(r.titolo)}</label><textarea id="rg_\${esc(r.chiave)}" rows="3">\${esc(r.testo || '')}</textarea>
        <button class="btn gold sm" data-rgsave="\${esc(r.chiave)}" style="margin-top:6px">Salva</button></div>\`).join('') || '<p class="muted">Nessun regolamento.</p>'}</div>\`;
    $('#view').innerHTML = \`
      <div class="row">
        <select id="tb_disc">\${discs.map(d => \`<option value="\${d.id}" \${d.id == cur ? 'selected' : ''}>\${d.dominio} \xB7 \${esc(d.nome)}\${d.attivo ? '' : ' (disattivata)'}</option>\`).join('')}</select>
        \${can('tabellone_reset') ? '<button class="btn ghost sm" id="tb_gen">\u21BB Genera / azzera calendario</button>' : ''}
        \${t.completo ? '<span class="tag ok">gironi completi</span>' : '<span class="tag mid">gironi in corso</span>'}
      </div>
      \${settings}
      \${giornate.length ? \`<div class="row" style="margin-top:-6px">
        <span class="muted" style="font-size:13px">Foglio da stampare per raccogliere i risultati a mano:</span>
        <select id="tb_gio"><option value="">Tutte le giornate</option>\${giornate.map(g => \`<option value="\${g}">Giornata \${g}</option>\`).join('')}</select>
        <button class="btn ghost sm" id="tb_print">\u{1F5A8}\uFE0F Stampa foglio risultati</button>
      </div>\` : ''}
      \${t.gironi.length ? t.gironi.map(gironeHtml).join('') : '<p class="muted">Nessun calendario: premi \u201CGenera\u201D.</p>'}
      \${finali}\${albo}\${regsPanel}\`;
    $('#tb_disc').onchange = (e) => { cur = e.target.value; render(); };
    if ($('#tb_gen')) $('#tb_gen').onclick = async () => { if (!confirm('Rigenerare il calendario AZZERA i risultati di questa disciplina. Procedo?')) return; await api('/tabellone/' + cur + '/genera', { method: 'POST' }); render(); };
    $('#tb_setSave').onclick = async () => { await api('/tabellone/' + cur + '/impostazioni', { method: 'PUT', body: JSON.stringify({ data_inizio: $('#tb_di').value, data_fine: $('#tb_df').value, stato: $('#tb_stato').value, regolamento: $('#tb_reg').value }) }); render(); };
    $('#tb_archivia').onclick = async () => { if (!confirm("Archiviare l'edizione corrente nell'Albo d'Oro e azzerare il calendario di questa disciplina?")) return; try { const r = await api('/tabellone/' + cur + '/archivia', { method: 'POST' }); alert('Edizione archiviata \xB7 vince ' + (r.vincitore || '\u2014')); render(); } catch (e) { alert(e.message); } };
    if ($('#tb_print')) $('#tb_print').onclick = () => stampaGiornata(disc.nome || 'Torneo', t, $('#tb_gio').value);
    document.querySelectorAll('[data-rgsave]').forEach(b => b.onclick = async () => { const k = b.dataset.rgsave; const r = regs.find(x => x.chiave === k) || {}; await api('/regolamenti/' + k, { method: 'PUT', body: JSON.stringify({ titolo: r.titolo, testo: $('#rg_' + k).value }) }); b.textContent = '\u2713'; setTimeout(() => b.textContent = 'Salva', 1000); });
    document.querySelectorAll('[data-psave]').forEach(b => b.onclick = async () => {
      const id = b.dataset.psave;
      try { await api('/partite/' + id, { method: 'PUT', body: JSON.stringify({ gol_a: $('#ga_' + id).value, gol_b: $('#gb_' + id).value }) }); render(); }
      catch (e) { alert(e.message); }
    });
    document.querySelectorAll('[data-pfoto]').forEach(b => b.onclick = () => openFotoPartita(b.dataset.pfoto));
  };
  await render();
};

// Foto dei punteggi dei tornei (allegati): evita contestazioni sulla veridicit\xE0 dei dati.
async function openFotoPartita(id) {
  const list = await api('/allegati?entita=partita&entita_id=' + id).catch(() => []);
  const thumbs = list.length ? list.map(a => \`<button class="btn ghost sm" data-afoto="\${a.id}">\u{1F4F7} \${esc(a.created_at)}</button>\`).join(' ') : '<span class="muted">Nessuna foto allegata.</span>';
  modal(\`<h3>Foto punteggio \xB7 partita #\${esc(String(id))}</h3>
    <p class="muted" style="font-size:13px">Allega la foto del referto/tabellino per certificare il risultato.</p>
    <div id="af_list" style="display:flex;gap:6px;flex-wrap:wrap">\${thumbs}</div>
    <div class="row" style="justify-content:space-between;margin-top:14px"><button class="btn gold sm" id="af_add">\u{1F4F7} Aggiungi foto</button><button class="btn ghost sm" id="mCancel">Chiudi</button></div>\`);
  $('#mCancel').onclick = closeModal;
  $('#af_add').onclick = () => pickPhoto(async d => { await api('/allegati', { method: 'POST', body: JSON.stringify({ entita: 'partita', entita_id: id, immagine: d }) }); openFotoPartita(id); });
  document.querySelectorAll('[data-afoto]').forEach(b => b.onclick = async () => { const r = await api('/allegati/' + b.dataset.afoto + '/foto'); const w = window.open('', '_blank'); if (w) { w.document.write('<img src="' + r.foto + '" style="max-width:100%">'); w.document.close(); } });
}

// Foglio stampabile della/e giornata/e: partite con caselle vuote per segnare i risultati a mano.
function stampaGiornata(nomeDisc, t, gioFilter) {
  const partite = t.gironi.flatMap(g => g.partite.map(p => ({ ...p, girone: g.nome })));
  const giornate = [...new Set(partite.map(p => p.giornata))].sort((a, b) => a - b)
    .filter(g => !gioFilter || String(g) === String(gioFilter));
  const box = '<span style="display:inline-block;width:44px;height:26px;border:1.5px solid #12324F;border-radius:5px;vertical-align:middle"></span>';
  const sezioni = giornate.map(gn => {
    const ps = partite.filter(p => p.giornata === gn);
    const righe = ps.map(p => \`<tr>
        <td style="text-align:right;padding:9px 8px;font-weight:600">\${esc(p.casa_a)}</td>
        <td style="text-align:center;padding:9px 6px">\${box} <span style="color:#5a6b75">\u2013</span> \${box}</td>
        <td style="text-align:left;padding:9px 8px;font-weight:600">\${esc(p.casa_b)}</td>
        <td style="padding:9px 8px;color:#5a6b75;font-size:12px">\${esc(p.girone)}\${p.stato === 'giocata' ? \` \xB7 registrata \${esc((p.gol_a ?? '') + '\u2013' + (p.gol_b ?? ''))}\` : ''}</td>
      </tr>\`).join('');
    return \`<h2 style="font-family:Georgia,serif;color:#12324F;margin:18px 0 4px">Giornata \${gn}</h2>
      <table style="width:100%;border-collapse:collapse">\${righe}</table>\`;
  }).join('');
  const html = \`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Risultati \u2014 \${esc(nomeDisc)}</title>
    <style>@page{margin:18mm} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#17242c}
      h1{font-family:Georgia,serif;color:#12324F;margin:0} .hd{border-bottom:2px solid #12324F;padding-bottom:8px;margin-bottom:6px}
      .meta{color:#5a6b75;font-size:13px;margin-top:4px} tr:nth-child(even){background:#f7f5ee}
      .firma{margin-top:26px;color:#5a6b75;font-size:13px}
      @media print{button{display:none}}</style></head>
    <body>
      <div class="hd"><h1>Bussola Residence \xB7 Coppa delle Casate</h1>
        <div class="meta"><b>\${esc(nomeDisc)}</b> \u2014 foglio raccolta risultati\${gioFilter ? \` \xB7 Giornata \${esc(gioFilter)}\` : ''}. Data: ____ / ____ / ______ \xB7 Arbitro/Staff: __________________</div></div>
      \${sezioni || '<p>Nessuna partita da stampare.</p>'}
      <div class="firma">Compila le caselle con il punteggio e riporta i risultati nel back office (Tabellone) con calma. Firma staff: __________________</div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 14px">Stampa</button>
    </body></html>\`;
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti le finestre pop-up per stampare il foglio.'); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
}

// ---- Contest Serata dei Clan ----
function contestForm(c) {
  const tipi = ['cocktail', 'karaoke', 'recitazione', 'sfilata', 'altro'];
  return \`<div class="grid2">
      <div><label>Titolo della serata</label><input id="c_tit" value="\${esc(c?.titolo || '')}" placeholder="Es. Il mio nome \xE8 Bond, James Bond"></div>
      <div><label>Tipo</label><select id="c_tipo">\${tipi.map(t => \`<option \${c?.tipo === t ? 'selected' : ''}>\${t}</option>\`).join('')}</select></div>
      <div><label>Settimana</label><input id="c_sett" value="\${esc(c?.settimana || '')}" placeholder="Es. 25\u201331 agosto"></div>
      <div><label>Stato</label><select id="c_stato">\${['annunciato', 'in_corso', 'concluso'].map(s => \`<option \${c?.stato === s ? 'selected' : ''}>\${s}</option>\`).join('')}</select></div>
    </div>
    <label>Consegna (testo libero) + supporti a disposizione</label>
    <textarea id="c_brief" rows="5" placeholder="Descrivi la sfida e gli eventuali supporti (bar, karaoke, palco\u2026)">\${esc(c?.brief || '')}</textarea>
    \${c ? \`<label>Vincitore (a fine settimana)</label><input id="c_vin" value="\${esc(c.vincitore || '')}" placeholder="Casata vincitrice">
    <label class="check"><input type="checkbox" id="c_att" \${c.attivo ? 'checked' : ''}> Attivo (mostrato nell'app)</label>\` : ''}\`;
}
// Come per le serate: leggo i campi DENTRO il contenitore (il form "Nuovo contest" e quello di
// modifica hanno gli stessi ID; senza scoping la modifica azzerava la riga).
function contestBody(root, withExtra) {
  const q = (id) => root.querySelector(id);
  const b = { titolo: q('#c_tit').value, tipo: q('#c_tipo').value, settimana: q('#c_sett').value, brief: q('#c_brief').value, stato: q('#c_stato').value };
  if (withExtra) { b.vincitore = q('#c_vin') ? q('#c_vin').value : null; b.attivo = q('#c_att') ? q('#c_att').checked : true; }
  return b;
}
VIEWS.contest = async () => {
  const list = await api('/contest');
  $('#view').innerHTML = \`
    <div class="panel"><h3>Nuovo contest (lo lancia il CdA la settimana prima)</h3>\${contestForm(null)}
      <div class="err" id="c_err"></div>
      <button class="btn gold sm" id="c_add" style="margin-top:10px">Lancia il contest</button></div>
    <div class="panel"><h3>Contest</h3><table><thead><tr><th>Settimana</th><th>Titolo</th><th>Tipo</th><th>Stato</th><th>Attivo</th><th></th></tr></thead><tbody>
      \${list.map(c => \`<tr><td>\${esc(c.settimana || '')}</td><td><b>\${esc(c.titolo)}</b>\${c.vincitore ? \`<br><span class="tag ok">\u{1F3C6} \${esc(c.vincitore)}</span>\` : ''}</td><td>\${esc(c.tipo || '')}</td><td>\${esc(c.stato)}\${c.esito_assegnato ? ' <span class="tag ok">punti versati</span>' : ''}</td><td>\${c.attivo ? '<span class="tag ok">s\xEC</span>' : '<span class="tag no">no</span>'}</td><td style="white-space:nowrap"><button class="btn gold sm" data-cesito="\${c.id}">\u{1F3C5} Esito</button> <button class="btn ghost sm" data-cedit="\${c.id}">\u270E</button> <button class="btn danger sm" data-cdel="\${c.id}">\u{1F5D1}</button></td></tr>\`).join('') || '<tr><td colspan="6" class="muted">Nessun contest.</td></tr>'}
    </tbody></table>
    <p class="muted" style="margin-top:8px;font-size:13px">\u{1F3C5} <b>Esito</b>: la giuria stila la graduatoria (punti per posizione) e si aggiunge il bonus vendite <b>4/2/1</b> alle prime tre casate per pezzi venduti. Poi \u201CAssegna alla Coppa\u201D versa i punti (una volta sola).</p></div>\`;
  $('#c_add').onclick = async () => {
    try { await api('/contest', { method: 'POST', body: JSON.stringify(contestBody($('#view'), false)) }); show('contest'); }
    catch (e) { $('#c_err').textContent = e.message; }
  };
  document.querySelectorAll('[data-cedit]').forEach(b => b.onclick = () => {
    const c = list.find(x => x.id == b.dataset.cedit);
    modal(\`<h3>Modifica contest</h3>\${contestForm(c)}<div class="err" id="c_merr"></div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => {
      try { await api('/contest/' + c.id, { method: 'PUT', body: JSON.stringify(contestBody($('#modalBox'), true)) }); closeModal(); show('contest'); }
      catch (e) { $('#c_merr').textContent = e.message; }
    };
  });
  document.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il contest?')) return; await api('/contest/' + b.dataset.cdel, { method: 'DELETE' }); show('contest'); });
  document.querySelectorAll('[data-cesito]').forEach(b => b.onclick = () => openEsito(b.dataset.cesito));
};

// Esito/voto della Serata dei Clan: posizione di giuria + pezzi venduti \u2192 punti \u2192 Coppa.
async function openEsito(id) {
  const e = await api('/contest/' + id + '/esito');
  const scalaTxt = (e.scala || []).join(', ');
  const rows = e.righe.map(r => \`<tr>
      <td><span class="sh" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:\${esc(r.colore || '#ccc')};vertical-align:middle"></span> \${esc(r.casata)}</td>
      <td><input id="pos_\${r.casata_id}" type="number" min="1" max="8" value="\${r.posizione ?? ''}" style="width:60px;text-align:center" \${e.assegnato ? 'disabled' : ''}></td>
      <td><input id="pez_\${r.casata_id}" type="number" min="0" value="\${r.pezzi_venduti ?? 0}" style="width:80px;text-align:center" \${e.assegnato ? 'disabled' : ''}></td>
      <td style="text-align:center"><b id="pt_\${r.casata_id}">\${r.punti || 0}</b></td>
    </tr>\`).join('');
  modal(\`<h3>Esito \u2014 \${esc(e.contest.titolo)}</h3>
    <p class="muted" style="font-size:13px;margin-bottom:8px">Assegna la <b>posizione</b> di giuria (1 = primo) e i <b>pezzi venduti</b> per casata. I punti = punti della posizione + bonus vendite (4/2/1 alle prime 3 per pezzi).</p>
    <label>Punti per posizione (1\xB0,2\xB0,3\xB0,\u2026) \u2014 modificabili</label>
    <input id="e_scala" value="\${esc(scalaTxt)}" \${e.assegnato ? 'disabled' : ''} placeholder="10, 6, 4, 3, 2, 1, 1, 1">
    <table style="margin-top:10px"><thead><tr><th>Casata</th><th>Pos. giuria</th><th>Pezzi venduti</th><th>Punti</th></tr></thead><tbody>\${rows}</tbody></table>
    <div class="err" id="e_err"></div>
    \${e.assegnato ? \`<div class="tag ok" style="margin-top:10px">\u2705 Punti gi\xE0 versati in Coppa \xB7 vince \${esc(e.contest.vincitore || '\u2014')}</div>\` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button class="btn ghost sm" id="mCancel">Chiudi</button>
      \${e.assegnato ? '' : \`<button class="btn ghost sm" id="e_calc">Calcola e salva</button>
      <button class="btn gold sm" id="e_assegna">Assegna alla Coppa</button>\`}
    </div>\`);
  $('#mCancel').onclick = closeModal;
  const raccogli = () => ({
    punti_scala: $('#e_scala').value.split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x)),
    righe: e.righe.map(r => ({ casata_id: r.casata_id, posizione: Number($('#pos_' + r.casata_id).value) || null, pezzi_venduti: Number($('#pez_' + r.casata_id).value) || 0 })),
  });
  if ($('#e_calc')) $('#e_calc').onclick = async () => {
    try { const r = await api('/contest/' + id + '/esito', { method: 'POST', body: JSON.stringify(raccogli()) });
      r.righe.forEach(x => { const el = $('#pt_' + x.casata_id); if (el) el.textContent = x.punti; }); $('#e_err').textContent = '';
    } catch (err) { $('#e_err').textContent = err.message; }
  };
  if ($('#e_assegna')) $('#e_assegna').onclick = async () => {
    if (!confirm('Assegnare i punti alla Coppa? L\u2019operazione \xE8 definitiva.')) return;
    try { await api('/contest/' + id + '/esito', { method: 'POST', body: JSON.stringify(raccogli()) });
      const r = await api('/contest/' + id + '/assegna', { method: 'POST' });
      closeModal(); show('contest'); alert(\`Assegnati \${r.totale} punti \xB7 vince \${r.vincitore || '\u2014'}\`);
    } catch (err) { $('#e_err').textContent = err.message; }
  };
}

// ---- Serate & cena ----
function serataForm(s) {
  return \`<div class="grid2">
      <div><label>Titolo</label><input id="s_tit" value="\${esc(s?.titolo || '')}" placeholder="Es. Cena di Ferragosto"></div>
      <div><label>Quando (etichetta)</label><input id="s_quando" value="\${esc(s?.quando || '')}" placeholder="Es. Sab 15 agosto \xB7 20:00"></div>
      <div><label>Data</label><input id="s_data" type="date" value="\${esc(s?.data || '')}"></div>
      <div><label>Tema</label><input id="s_tema" value="\${esc(s?.tema || '')}" placeholder="Es. Gran serata"></div>
      <div><label>Quota \u20AC a persona</label><input id="s_quota" type="number" min="0" step="0.5" value="\${esc(String(s?.quota ?? 0))}"></div>
      <div><label>Capienza (coperti)</label><input id="s_cap" type="number" min="1" value="\${esc(String(s?.capienza ?? 80))}"></div>
    </div>
    <label>Descrizione</label><textarea id="s_desc" rows="3">\${esc(s?.descrizione || '')}</textarea>
    \${s ? \`<label class="check"><input type="checkbox" id="s_att" \${s.attivo ? 'checked' : ''}> Attiva (mostrata nell'app)</label>\` : ''}\`;
}
// Legge i campi DENTRO il contenitore indicato (evita la collisione di ID fra il form
// "Nuova serata" sempre presente e il form della finestra di modifica \u2192 prima causava l'azzeramento).
function serataBody(root = document) {
  const q = (id) => root.querySelector(id);
  return { titolo: q('#s_tit').value, quando: q('#s_quando').value, data: q('#s_data').value, tema: q('#s_tema').value,
    descrizione: q('#s_desc').value, quota: Number(q('#s_quota').value) || 0, capienza: Number(q('#s_cap').value) || 80,
    attivo: q('#s_att') ? q('#s_att').checked : true };
}
VIEWS.serate = async () => {
  const list = await api('/serate');
  $('#view').innerHTML = \`
    <div class="panel"><h3>Nuova serata a prenotazione</h3>\${serataForm(null)}
      <div class="err" id="s_err"></div>
      <button class="btn gold sm" id="s_add" style="margin-top:10px">Crea serata</button></div>
    <div class="panel"><h3>Serate (turni cena 20:00 e 21:30 \xB7 pagamento in cassa)</h3>
      <table><thead><tr><th>Quando</th><th>Titolo</th><th>Quota</th><th>Prenotati</th><th>Da incassare</th><th>Attiva</th><th></th></tr></thead><tbody>
      \${list.map(s => \`<tr><td>\${esc(s.quando || s.data || '')}</td><td><b>\${esc(s.titolo)}</b>\${s.tema ? \`<br><span class="muted">\${esc(s.tema)}</span>\` : ''}</td>
        <td>\u20AC \${esc(String(s.quota))}</td><td>\${s.coperti_prenotati}/\${s.capienza}</td><td>\u20AC \${esc(String(s.da_incassare || 0))}</td>
        <td>\${s.attivo ? '<span class="tag ok">s\xEC</span>' : '<span class="tag no">no</span>'}</td>
        <td style="white-space:nowrap"><button class="btn gold sm" data-spren="\${s.id}">\u{1F465} Prenotati</button> <button class="btn ghost sm" data-sedit="\${s.id}">\u270E</button> <button class="btn danger sm" data-sdel="\${s.id}">\u{1F5D1}</button></td></tr>\`).join('') || '<tr><td colspan="7" class="muted">Nessuna serata.</td></tr>'}
    </tbody></table></div>\`;
  $('#s_add').onclick = async () => {
    try { await api('/serate', { method: 'POST', body: JSON.stringify(serataBody($('#view'))) }); show('serate'); }
    catch (e) { $('#s_err').textContent = e.message; }
  };
  document.querySelectorAll('[data-sedit]').forEach(b => b.onclick = () => {
    const s = list.find(x => x.id == b.dataset.sedit);
    modal(\`<h3>Modifica serata</h3>\${serataForm(s)}<div class="err" id="s_merr"></div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => {
      try { await api('/serate/' + s.id, { method: 'PUT', body: JSON.stringify(serataBody($('#modalBox'))) }); closeModal(); show('serate'); }
      catch (e) { $('#s_merr').textContent = e.message; }
    };
  });
  document.querySelectorAll('[data-sdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare la serata e le sue prenotazioni?')) return; await api('/serate/' + b.dataset.sdel, { method: 'DELETE' }); show('serate'); });
  document.querySelectorAll('[data-spren]').forEach(b => b.onclick = () => openPrenotatiSerata(b.dataset.spren, list.find(x => x.id == b.dataset.spren)));
};
async function openPrenotatiSerata(id, s) {
  const list = await api('/serate/' + id + '/prenotazioni');
  const badge = (st) => st === 'saldata' ? '<span class="tag ok">saldata</span>' : st === 'annullata' ? '<span class="tag no">annullata</span>' : '<span class="tag mid">da saldare</span>';
  modal(\`<h3>Prenotati \u2014 \${esc(s?.titolo || 'Serata')}</h3>
    <table><thead><tr><th>Nome</th><th>Pers.</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>
    \${list.map(p => \`<tr><td>\${esc(p.nome || '')}<br><span class="muted">\${esc(p.tessera_code || '')}</span></td><td>\${p.persone}</td><td>\u20AC \${esc(String(p.importo))}</td><td>\${badge(p.stato)}</td>
      <td style="white-space:nowrap">\${p.stato !== 'saldata' ? \`<button class="btn gold sm" data-pset="\${p.id}|saldata">Segna saldata</button>\` : ''} \${p.stato !== 'annullata' ? \`<button class="btn ghost sm" data-pset="\${p.id}|annullata">Annulla</button>\` : ''}</td></tr>\`).join('') || '<tr><td colspan="5" class="muted">Nessuna prenotazione.</td></tr>'}
    </tbody></table>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Chiudi</button></div>\`);
  $('#mCancel').onclick = closeModal;
  document.querySelectorAll('[data-pset]').forEach(b => b.onclick = async () => {
    const [pid, stato] = b.dataset.pset.split('|');
    await api('/serate-prenotazioni/' + pid, { method: 'PUT', body: JSON.stringify({ stato }) });
    openPrenotatiSerata(id, s);
  });
}

// ---- Audit ----
VIEWS.audit = async () => {
  const list = await api('/audit');
  $('#view').innerHTML = \`<div class="panel"><h3>Registro attivit\xE0 (accountability GDPR)</h3><table><thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Entit\xE0</th><th>Dettaglio</th></tr></thead><tbody>
    \${list.map(a => \`<tr><td class="muted">\${esc(a.ts)}</td><td>\${esc(a.utente)}</td><td><b>\${esc(a.azione)}</b></td><td>\${esc(a.entita)} \${esc(a.entita_id||'')}</td><td class="muted">\${esc(a.dettaglio||'')}</td></tr>\`).join('')}
  </tbody></table></div>\`;
};

// ---- Modal helpers ----
function modal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); }

// ---- Bind ----
$('#loginBtn').onclick = login;
$('#p').onkeydown = (e) => { if (e.key === 'Enter') login(); };
$('#logout').onclick = (e) => { e.preventDefault(); api('/logout', { method:'POST' }).catch(()=>{}); logout(); };
document.querySelectorAll('#menu button').forEach(b => b.onclick = () => { show(b.dataset.v); document.getElementById('app').classList.remove('nav-open'); });
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
// Menu a scomparsa su cellulare (hamburger + sfondo cliccabile)
if ($('#navToggle')) $('#navToggle').onclick = () => document.getElementById('app').classList.toggle('nav-open');
if ($('#navScrim')) $('#navScrim').onclick = () => document.getElementById('app').classList.remove('nav-open');

// Mostra la versione REALMENTE online (dal server), cos\xEC sappiamo cosa \xE8 pubblicato
(async () => {
  try {
    const h = await fetch(API_BASE + '/api/health').then(r => r.json());
    $('#verline').textContent = h.version ? \`versione online: v\${h.version}\${h.build && h.build !== 'online' ? ' \xB7 ' + h.build : ''}\` : 'versione online: sconosciuta (build vecchia \u2014 da aggiornare)';
  } catch { $('#verline').textContent = 'server non raggiungibile'; }
})();

</script>
</body>
</html>
`;

// build/entry.mjs
var BUILD = true ? "2026-08-15 18:32" : "online";
var MAJOR = Number(process.versions.node.split(".")[0]);
if (Number.isNaN(MAJOR) || MAJOR < 22) {
  console.error("\n  Serve Node.js 22 o superiore. Versione attuale: " + process.version + "\n  Scarica Node 22 LTS da https://nodejs.org\n");
  process.exit(1);
}
var PORT = process.env.PORT || 4e3;
await initSchema();
await seed();
var app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
  );
  next();
});
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/api/health", (req, res) => res.json({ ok: true, version: VERSION, build: BUILD, env: process.env.KOINE_ENV || "online", ts: (/* @__PURE__ */ new Date()).toISOString() }));
app.use("/api/auth", authUserRouter);
app.use("/api", publicRouter);
app.use("/api/admin", adminRouter);
app.get(["/", "/index.html"], (req, res) => res.type("html").send(frontend_default));
app.get(["/admin", "/admin/", "/admin/index.html"], (req, res) => res.type("html").send(admin_default));
app.use((req, res) => res.status(404).json({ error: "Non trovato" }));
app.use((err, req, res, next) => {
  console.error("Errore API:", err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Errore interno" });
});
app.listen(PORT, () => {
  console.log("\n  Bussola Residence \xB7 by KOIN\xC8 \u2014 online");
  console.log(`  App ospiti:   porta ${PORT}, percorso /`);
  console.log(`  Back office:  porta ${PORT}, percorso /admin/`);
});

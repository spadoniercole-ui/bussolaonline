var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/menucat.js
var menucat_exports = {};
__export(menucat_exports, {
  CATEGORIE_ORDINE: () => CATEGORIE_ORDINE,
  categoriaArticolo: () => categoriaArticolo,
  inferCategoria: () => inferCategoria,
  ordinaCategorie: () => ordinaCategorie
});
function inferCategoria(nome) {
  const s = String(nome == null ? "" : nome);
  for (const [name, rx] of CAT_RULES) {
    if (rx.test(s)) return name;
  }
  return null;
}
function categoriaArticolo({ categoria, nome, stazione } = {}) {
  const esplicita = categoria && String(categoria).trim();
  return esplicita || inferCategoria(nome) || (stazione === "cucina" ? "Cucina" : "Bar");
}
function ordinaCategorie(arr) {
  const rank = (c) => {
    if (c === "Bar") return 900;
    if (c === "Cucina") return 901;
    const i = CATEGORIE_ORDINE.indexOf(c);
    return i < 0 ? 500 : i;
  };
  return arr.slice().sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}
var CAT_RULES, CATEGORIE_ORDINE;
var init_menucat = __esm({
  "server/menucat.js"() {
    CAT_RULES = [
      ["Caffetteria", /caff[eè]|cappucc|macchiat|marocchin|\blatte\b|orzo|ginseng|cioccolat|espress|ristrett|decaffe|shakerat|tisana|camomill|t[eè]\s*cald/i],
      ["Bibite", /acqua|coca|\bcola\b|fanta|sprite|aranciat|chinotto|gassosa|gazzosa|\btonic|spremut|succ|t[eè]\s*fredd|th[eè]|estath|energy|red\s*bull|redbull|gatorade|powerade|bibit|cedrat|lemonsoda|oransoda|schweppes/i],
      ["Birre", /birr|\bbeer\b|\bipa\b|lager|weiss|weizen|\bpils|stout|moretti|heineken|peroni|ichnusa|\bcorona\b|ceres|nastro\s*azzurro/i],
      ["Aperitivi & Cocktail", /spritz|aperol|campari|negroni|american|mojito|cocktail|\bgin\b|vodka|\brum\b|tequila|whisk|bacardi|\bmartini\b|aperitiv|bitter|crodino|analcolic|\blimoncell/i],
      ["Vini", /\bvin[oi]\b|calice|prosecc|spumant|franciacort|moscato|chardonnay|merlot|bollicin|champagn/i],
      ["Gelati", /gelat|ghiacciol|magnum|sorbett|granit|\bstecco\b|coppett/i],
      ["Snack", /patatin|\bchips\b|tarall|nachos|pop\s*corn|popcorn|arachid|\bolive\b|salatin|cracker|pretzel|\bsnack\b/i],
      ["Panini & Piatti", /panin|toast|piadin|hamburger|hot\s*dog|hotdog|pizz|focacc|tramezzin|\bwrap\b|insalat|\bpasta\b|sandwich|bruschett|tagliere|\bfritt|arancin/i],
      ["Dolci", /cornetto|brioch|croissant|\bdolc|\btorta\b|crostat|muffin|biscott|tiramis|budino|crep|cr[eê]pe|waffle|nutella|pancake/i]
    ];
    CATEGORIE_ORDINE = CAT_RULES.map((r) => r[0]).concat(["Bar", "Cucina"]);
  }
});

// server/db.js
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
async function getSetting(chiave, def = null) {
  try {
    const r = await db.prepare("SELECT valore FROM impostazioni WHERE chiave=?").get(chiave);
    return r ? r.valore : def;
  } catch (_) {
    return def;
  }
}
async function setSetting(chiave, valore) {
  try {
    await db.prepare("INSERT OR REPLACE INTO impostazioni (chiave,valore) VALUES (?,?)").run(chiave, String(valore));
  } catch (_) {
  }
}
function audit(utente, azione, entita, entita_id, dettaglio = "") {
  client.execute({
    sql: "INSERT INTO audit_log (utente, azione, entita, entita_id, dettaglio) VALUES (?,?,?,?,?)",
    args: [utente || "sistema", azione, entita || "", String(entita_id ?? ""), dettaglio]
  }).catch(() => {
  });
}
async function nextTessera() {
  const rows = await db.prepare("SELECT tessera_code FROM soci WHERE tessera_code LIKE 'BR-2026-%'").all();
  let max = 0;
  for (const r of rows) {
    const m = /BR-2026-(\d+)/.exec(r.tessera_code || "");
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return "BR-2026-" + String(max + 1).padStart(4, "0");
}
async function insertSocioUnique(cols, vals) {
  const iCode = cols.indexOf("tessera_code");
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO soci (${cols.join(",")}) VALUES (${placeholders})`;
  let base = await nextTessera();
  let baseNum = parseInt(/BR-2026-(\d+)/.exec(base)[1], 10);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = attempt < 6 ? "BR-2026-" + String(baseNum + attempt).padStart(4, "0") : "BR-2026-" + String(baseNum).padStart(4, "0") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const args = vals.slice();
    args[iCode] = code;
    try {
      const info = await db.prepare(sql).run(...args);
      return { id: Number(info.lastInsertRowid), tessera_code: code };
    } catch (e) {
      if (attempt === 7) throw e;
    }
  }
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

  -- Impostazioni chiave/valore (es. self-order aperto/chiuso).
  CREATE TABLE IF NOT EXISTS impostazioni (
    chiave TEXT PRIMARY KEY,
    valore TEXT
  );

  -- Web Push: subscription dei browser (una riga per dispositivo/endpoint) legata al socio.
  CREATE TABLE IF NOT EXISTS push_sub (
    endpoint   TEXT PRIMARY KEY,
    socio_id   INTEGER REFERENCES soci(id) ON DELETE CASCADE,
    p256dh     TEXT,
    auth       TEXT,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_push_socio ON push_sub(socio_id);

  -- Sessioni PERSISTENTI (token). Prima erano in memoria e sparivano a ogni riavvio/redeploy
  -- (su Render: logout forzato di tutti). Ora vivono nel DB: sopravvivono ai riavvii.
  CREATE TABLE IF NOT EXISTS sessioni (
    token      TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,                               -- admin | user
    dati       TEXT NOT NULL,                               -- JSON: profilo di sessione
    exp        INTEGER NOT NULL                             -- epoch ms
  );
  CREATE INDEX IF NOT EXISTS ix_sessioni_exp ON sessioni(exp);

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
    descrizione   TEXT,                                     -- descrizione prodotto (da CSV)
    allergeni     TEXT,                                     -- elenco allergeni (da CSV)
    magazzino_id  INTEGER REFERENCES magazzino_articoli(id) ON DELETE SET NULL, -- scarico automatico (tecnicismo, invisibile all'operatore)
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

  -- ====== CAMPI: prenotazione slot (stile Playtomic) + PARTITE APERTE ======
  CREATE TABLE IF NOT EXISTS campi (
    id            INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    sport         TEXT NOT NULL DEFAULT 'pickleball',      -- pickleball | soft_tennis | calcetto | ...
    apertura      TEXT NOT NULL DEFAULT '09:00',           -- HH:MM
    chiusura      TEXT NOT NULL DEFAULT '22:00',           -- HH:MM
    durata_slot   INTEGER NOT NULL DEFAULT 60,             -- minuti
    ora_min       TEXT,                                    -- regola oraria: prenotabile solo da (es. calcetto '18:00')
    posti_default INTEGER NOT NULL DEFAULT 4,              -- posti di una partita aperta di default
    attivo        INTEGER NOT NULL DEFAULT 1,
    ordine        INTEGER NOT NULL DEFAULT 0
  );
  -- Occupazione slot: sia le prenotazioni private sia le partite aperte riservano lo slot qui.
  CREATE TABLE IF NOT EXISTS prenotazioni_campo (
    id           INTEGER PRIMARY KEY,
    campo_id     INTEGER NOT NULL REFERENCES campi(id) ON DELETE CASCADE,
    data         TEXT NOT NULL,                            -- YYYY-MM-DD
    slot         TEXT NOT NULL,                            -- HH:MM
    tipo         TEXT NOT NULL DEFAULT 'privata',          -- privata | partita
    socio_id     INTEGER,
    tessera_code TEXT,
    nome         TEXT,
    stato        TEXT NOT NULL DEFAULT 'prenotato',        -- prenotato | annullato
    partita_id   INTEGER,                                  -- valorizzato se tipo=partita
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS partite_aperte (
    id               INTEGER PRIMARY KEY,
    campo_id         INTEGER NOT NULL REFERENCES campi(id) ON DELETE CASCADE,
    data             TEXT NOT NULL,
    slot             TEXT NOT NULL,
    posti_totali     INTEGER NOT NULL DEFAULT 4,
    livello          TEXT,                                 -- principiante | intermedio | avanzato | ''
    note             TEXT,
    stato            TEXT NOT NULL DEFAULT 'aperta',       -- aperta | completa | annullata
    creatore_tessera TEXT,
    creatore_nome    TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS partita_iscritti (
    id           INTEGER PRIMARY KEY,
    partita_id   INTEGER NOT NULL REFERENCES partite_aperte(id) ON DELETE CASCADE,
    socio_id     INTEGER,
    tessera_code TEXT,
    nome         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_prenc_slot ON prenotazioni_campo(campo_id, data, slot);
  CREATE INDEX IF NOT EXISTS ix_part_slot ON partite_aperte(campo_id, data, slot);
  CREATE INDEX IF NOT EXISTS ix_part_isc ON partita_iscritti(partita_id);

  -- ====== HOST: case vacanza (dati sensibili CIFRATI a riposo, AES-256-GCM) ======
  -- In chiaro nel DB restano solo id, socio_id, attivo, created_at.
  -- Tutto il resto (nome, cir, cin, regole, isolato, numero, check_out, lat, lng) \xE8 dentro dati_cifrati.
  CREATE TABLE IF NOT EXISTS strutture (
    id           INTEGER PRIMARY KEY,
    socio_id     INTEGER NOT NULL REFERENCES soci(id) ON DELETE CASCADE,
    dati_cifrati TEXT NOT NULL,                            -- AES-256-GCM (base64): iv+tag+ciphertext
    attivo       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_strutture_socio ON strutture(socio_id);

  -- ====== AGGANCIO Visitatore\u2192Host su consenso (due rotte indipendenti che si incontrano) ======
  -- Il visitatore (auto-registrato) chiede l'aggancio indicando l'host per nome; l'host conferma.
  CREATE TABLE IF NOT EXISTS richieste_aggancio (
    id           INTEGER PRIMARY KEY,
    ospite_id    INTEGER NOT NULL REFERENCES soci(id) ON DELETE CASCADE,
    host_id      INTEGER NOT NULL REFERENCES soci(id) ON DELETE CASCADE,
    struttura_id INTEGER,                                   -- scelta dall'host in fase di conferma
    stato        TEXT NOT NULL DEFAULT 'in_attesa',         -- in_attesa | approvata | rifiutata
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_richieste_host ON richieste_aggancio(host_id, stato);
  CREATE INDEX IF NOT EXISTS ix_richieste_ospite ON richieste_aggancio(ospite_id, stato);

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
  await addIfMissing("menu_articoli", "descrizione", "descrizione TEXT");
  await addIfMissing("menu_articoli", "allergeni", "allergeni TEXT");
  try {
    const { inferCategoria: inferCategoria2 } = await Promise.resolve().then(() => (init_menucat(), menucat_exports));
    const vuoti = await db.prepare("SELECT id,nome,stazione FROM menu_articoli WHERE categoria IS NULL OR trim(categoria)=''").all();
    for (const m of vuoti) {
      const cat = inferCategoria2(m.nome) || (m.stazione === "cucina" ? "Cucina" : "Bar");
      await db.prepare("UPDATE menu_articoli SET categoria=? WHERE id=?").run(cat, m.id);
    }
  } catch (_) {
  }
  await addIfMissing("soci", "host", "host INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("soci", "struttura_id", "struttura_id INTEGER");
  await addIfMissing("soci", "host_ko", "host_ko INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("comande", "metodo_pagamento", "metodo_pagamento TEXT");
  await addIfMissing("comande", "pagata_at", "pagata_at TEXT");
  await addIfMissing("comande", "canale", "canale TEXT NOT NULL DEFAULT 'staff'");
  await addIfMissing("comande", "punto", "punto TEXT");
  await addIfMissing("comande", "socio_id", "socio_id INTEGER");
  await addIfMissing("comande", "pronta_at", "pronta_at TEXT");
  await addIfMissing("comande", "zona", "zona TEXT NOT NULL DEFAULT 'garden'");
  await addIfMissing("magazzino_articoli", "zona", "zona TEXT NOT NULL DEFAULT 'comune'");
  try {
    await db.exec(`
    CREATE TABLE IF NOT EXISTS magazzino_zona_scorte (
      articolo_id     INTEGER NOT NULL REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
      zona            TEXT NOT NULL,                 -- bar | garden
      giacenza        REAL NOT NULL DEFAULT 0,
      punto_riordino  REAL NOT NULL DEFAULT 0,
      soglia_preavviso REAL NOT NULL DEFAULT 0,
      aggiornato_at   TEXT,
      PRIMARY KEY (articolo_id, zona)
    );
    CREATE TABLE IF NOT EXISTS magazzino_richieste (
      id          INTEGER PRIMARY KEY,
      articolo_id INTEGER REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
      zona        TEXT NOT NULL,
      quantita    REAL NOT NULL,
      stato       TEXT NOT NULL DEFAULT 'inviata',    -- inviata | evasa | annullata
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_mag_ric ON magazzino_richieste(zona, stato);
    -- Ordini di riordino al fornitore (Fase 2): proposti dalla previsione, validati dall'operatore, poi ricevuti (= carico Centrale).
    CREATE TABLE IF NOT EXISTS magazzino_ordini (
      id            INTEGER PRIMARY KEY,
      articolo_id   INTEGER REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
      quantita      REAL NOT NULL,
      stato         TEXT NOT NULL DEFAULT 'confermato',  -- confermato (ordinato) | ricevuto | annullato
      data_invio    TEXT,                                 -- data di invio ordine al fornitore
      data_prevista TEXT,                                 -- data stimata di consegna
      lead_time     INTEGER,                              -- giorni di lead time applicati
      note          TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_mag_ord ON magazzino_ordini(stato);
    -- Quadratura mensile (Fase 4): snapshot di fine mese per articolo (flussi + giacenza iniziale/finale).
    CREATE TABLE IF NOT EXISTS magazzino_quadrature (
      mese              TEXT NOT NULL,                 -- YYYY-MM
      articolo_id       INTEGER REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
      giacenza_iniziale REAL,                          -- = finale del mese precedente (null se non disponibile)
      giacenza_finale   REAL NOT NULL,                 -- giacenza reale al momento della chiusura
      carico            REAL NOT NULL DEFAULT 0,
      scarico           REAL NOT NULL DEFAULT 0,
      scarico_bar       REAL NOT NULL DEFAULT 0,
      scarico_garden    REAL NOT NULL DEFAULT 0,
      scarico_centrale  REAL NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (mese, articolo_id)
    );
  `);
  } catch (_) {
  }
  await addIfMissing("magazzino_ordini", "data_invio", "data_invio TEXT");
  await addIfMissing("magazzino_ordini", "lead_time", "lead_time INTEGER");
  await addIfMissing("magazzino_movimenti", "zona", "zona TEXT");
  await addIfMissing("eventi", "ora_inizio", "ora_inizio TEXT");
  await addIfMissing("eventi", "tipologia", "tipologia TEXT");
  await addIfMissing("eventi", "artista", "artista TEXT");
  await addIfMissing("eventi", "prezzo", "prezzo REAL NOT NULL DEFAULT 0");
  await addIfMissing("eventi", "serata_id", "serata_id INTEGER");
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
var TURSO_URL, AUTH, url, LOCAL_FILE, IS_REMOTE, DB_PATH, client, flat, db;
var init_db = __esm({
  "server/db.js"() {
    TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.KOINE_DB_URL || "";
    AUTH = process.env.TURSO_AUTH_TOKEN || void 0;
    LOCAL_FILE = null;
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
    IS_REMOTE = !!TURSO_URL;
    DB_PATH = TURSO_URL ? TURSO_URL : LOCAL_FILE || ":memory:";
    client = createClient(AUTH ? { url, authToken: AUTH } : { url });
    flat = (a) => a.map((v) => v === void 0 ? null : v);
    db = {
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
  }
});

// server/push.js
var push_exports = {};
__export(push_exports, {
  publicKey: () => publicKey,
  pushEnabled: () => pushEnabled,
  removeSubscription: () => removeSubscription,
  saveSubscription: () => saveSubscription,
  sendToSoci: () => sendToSoci,
  sendToSocio: () => sendToSocio
});
import webpush from "web-push";
function pushEnabled() {
  return ENABLED;
}
function publicKey() {
  return ENABLED ? PUB : null;
}
async function saveSubscription(socioId, sub) {
  if (!sub || !sub.endpoint) return false;
  const k = sub.keys || {};
  try {
    await db.prepare("INSERT OR REPLACE INTO push_sub (endpoint,socio_id,p256dh,auth,created_at) VALUES (?,?,?,?,datetime('now'))").run(sub.endpoint, socioId, k.p256dh || "", k.auth || "");
    return true;
  } catch (_) {
    return false;
  }
}
async function removeSubscription(endpoint) {
  if (endpoint) {
    try {
      await db.prepare("DELETE FROM push_sub WHERE endpoint=?").run(endpoint);
    } catch (_) {
    }
  }
}
async function sendToSubs(subs, payload) {
  if (!ENABLED || !subs.length) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, data);
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) await removeSubscription(s.endpoint);
    }
  }
  return sent;
}
async function sendToSocio(socioId, payload) {
  if (!ENABLED) return 0;
  const subs = await db.prepare("SELECT endpoint,p256dh,auth FROM push_sub WHERE socio_id=?").all(socioId);
  return sendToSubs(subs, payload);
}
async function sendToSoci(socioIds, payload) {
  if (!ENABLED || !socioIds || !socioIds.length) return 0;
  const uniq = [...new Set(socioIds.filter(Boolean).map(Number))];
  const rows = [];
  for (const id of uniq) {
    const subs = await db.prepare("SELECT endpoint,p256dh,auth FROM push_sub WHERE socio_id=?").all(id);
    rows.push(...subs);
  }
  return sendToSubs(rows, payload);
}
var PUB, PRIV, SUBJ, ENABLED;
var init_push = __esm({
  "server/push.js"() {
    init_db();
    PUB = process.env.VAPID_PUBLIC || process.env.VAPID_PUBLIC_KEY || "";
    PRIV = process.env.VAPID_PRIVATE || process.env.VAPID_PRIVATE_KEY || "";
    SUBJ = process.env.VAPID_SUBJECT || "mailto:info@koine.local";
    ENABLED = false;
    if (PUB && PRIV) {
      try {
        webpush.setVapidDetails(SUBJ, PUB, PRIV);
        ENABLED = true;
      } catch (e) {
        console.error("VAPID non valido:", e?.message || e);
      }
    }
  }
});

// build/entry.mjs
init_db();
import express from "express";

// server/seed.js
init_db();

// server/auth.js
init_db();
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
var TTL = 8 * 60 * 60 * 1e3;
var cache = /* @__PURE__ */ new Map();
async function persist(token, kind, data, exp) {
  cache.set(token, { kind, data, exp });
  try {
    await db.prepare("INSERT OR REPLACE INTO sessioni (token,kind,dati,exp) VALUES (?,?,?,?)").run(token, kind, JSON.stringify(data), exp);
  } catch (_) {
  }
}
async function load(token, kind) {
  if (!token) return null;
  const c = cache.get(token);
  if (c && c.kind === kind) {
    if (Date.now() > c.exp) {
      await drop(token);
      return null;
    }
    return c.data;
  }
  let row = null;
  try {
    row = await db.prepare("SELECT kind,dati,exp FROM sessioni WHERE token=?").get(token);
  } catch (_) {
    row = null;
  }
  if (!row || row.kind !== kind) return null;
  const exp = Number(row.exp);
  if (Date.now() > exp) {
    await drop(token);
    return null;
  }
  let data;
  try {
    data = JSON.parse(row.dati);
  } catch (_) {
    return null;
  }
  cache.set(token, { kind, data, exp });
  return data;
}
async function drop(token) {
  cache.delete(token);
  try {
    await db.prepare("DELETE FROM sessioni WHERE token=?").run(token);
  } catch (_) {
  }
}
async function createSession(user) {
  const token = randomBytes(24).toString("hex");
  await persist(token, "admin", { id: user.id, username: user.username, ruolo: user.ruolo, permessi: user.permessi ?? null }, Date.now() + TTL);
  return token;
}
async function getSession(token) {
  return load(token, "admin");
}
async function destroySession(token) {
  await drop(token);
}
async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = await getSession(token);
    if (!user) return res.status(401).json({ error: "Autenticazione richiesta" });
    req.adminUser = user;
    next();
  } catch (_) {
    res.status(401).json({ error: "Autenticazione richiesta" });
  }
}
async function createUserSession(socio) {
  const token = randomBytes(24).toString("hex");
  await persist(token, "user", { id: socio.id, tessera_code: socio.tessera_code, nome: socio.nome }, Date.now() + TTL);
  return token;
}
async function getUserSession(token) {
  return load(token, "user");
}
function genOtp() {
  return String(randomBytes(3).readUIntBE(0, 3) % 1e6).padStart(6, "0");
}

// server/tournament.js
init_db();
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

// server/crypto.js
import crypto from "node:crypto";
var RAW = process.env.KOINE_ENC_KEY || "";
var ENC_IS_DEV_KEY = !RAW;
var KEYSOURCE = RAW || "KOINE-DEV-ENC-KEY-do-not-use-in-produzione";
var KEY = crypto.createHash("sha256").update(KEYSOURCE, "utf8").digest();
if (ENC_IS_DEV_KEY && (process.env.KOINE_ENV || "dev") === "prod") {
  console.warn("[crypto] ATTENZIONE: KOINE_ENC_KEY non impostata in produzione \u2014 i dati host userebbero una chiave di sviluppo.");
}
function encryptJSON(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}
function decryptJSON(blob) {
  const buf = Buffer.from(String(blob || ""), "base64");
  if (buf.length < 28) throw new Error("blob cifrato non valido");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(pt.toString("utf8"));
}
function tryDecryptJSON(blob) {
  try {
    return decryptJSON(blob);
  } catch (_) {
    return null;
  }
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
    for (const t of ["audit_log", "allegati", "strutture", "partita_iscritti", "partite_aperte", "prenotazioni_campo", "campi", "comanda_righe", "comande", "menu_articoli", "magazzino_movimenti", "magazzino_articoli", "cdc_prestiti", "cdc_check", "cdc_caffe_conte", "cdc_giochi", "cdc_caffe", "proposte", "serate_prenotazioni", "serate", "convocazioni", "partite", "classifica", "gironi", "discipline", "prenotazioni", "risorse", "eventi", "soci", "bussola", "luoghi", "contest_esiti", "contest", "casate", "utenti_admin"]) {
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
  const residenteId = Number((await insSocio.run("BR-2026-0100", "Chiara", "T.", "residente@example.com", null, "socio", "residente", null, "it", 1, 0, 0, "2026-09-30")).lastInsertRowid);
  await db.prepare("UPDATE soci SET host=1 WHERE id=?").run(residenteId);
  const struttInfo = await db.prepare("INSERT INTO strutture (socio_id,dati_cifrati,attivo) VALUES (?,?,1)").run(residenteId, encryptJSON({
    nome: "Villa Aretusa",
    cir: "CIR-19091-BEA-00123",
    cin: "IT089017C2X9ABC123",
    regole: "Check-out entro le 10:00. Silenzio dopo le 23. Rifiuti secondo il calendario del residence. Vietato fumare all'interno. Animali ammessi su richiesta.",
    isolato: "B",
    numero: "14",
    check_out: "10:00",
    lat: 37.0361,
    lng: 15.2969
  }));
  await db.prepare("UPDATE soci SET struttura_id=? WHERE tessera_code='BR-2026-0005'").run(Number(struttInfo.lastInsertRowid));
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
  const insCampo = db.prepare("INSERT INTO campi (nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default,ordine) VALUES (?,?,?,?,?,?,?,?)");
  const CAMPI = [
    // nome, sport, apertura, chiusura, durata_slot, ora_min, posti_default
    ["Campo Pickleball", "pickleball", "09:00", "22:00", 60, null, 4, 1],
    ["Campo Soft Tennis", "soft_tennis", "09:00", "22:00", 60, null, 4, 2],
    ["Campo Calcetto", "calcetto", "18:00", "23:00", 60, "18:00", 10, 3]
    // regola: solo dopo le 18
  ];
  for (const c of CAMPI) await insCampo.run(...c);
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
init_db();
import { Router } from "express";

// server/asyncroute.js
function asyncify(router) {
  for (const m of ["get", "post", "put", "delete", "patch"]) {
    const orig = router[m].bind(router);
    router[m] = (path, ...handlers) => orig(path, ...handlers.map((h) => typeof h === "function" && h.length < 4 ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h));
  }
  return router;
}

// server/selforder.js
init_db();
var STAFF_BOOST_MS = 3 * 60 * 1e3;
var STARVE_MS = 10 * 60 * 1e3;
var ETA_MAX_MIN = 45;
var RATE_WINDOW_MIN = 20;
function tsEffettivo(c, nowMs) {
  const base = Date.parse(c.created_at || "") || 0;
  let eff = base - (c.canale === "staff" ? STAFF_BOOST_MS : 0);
  if (c.canale !== "staff") {
    const wait = nowMs - base;
    if (wait > STARVE_MS) eff -= wait - STARVE_MS;
  }
  return eff;
}
function ordinaCoda(rows) {
  const now = Date.now();
  return rows.slice().sort((a, b) => tsEffettivo(a, now) - tsEffettivo(b, now) || a.id - b.id);
}
async function getConfig() {
  const g = async (k, d) => await getSetting(k, d);
  return {
    aperto: await g("self_order_aperto", "1") !== "0",
    // interruttore manuale (master)
    eta_modo: await g("so_eta_modo", "statico"),
    // statico | tempo
    eta_base: Number(await g("so_eta_base", "3")) || 3,
    // minuti base (modalità statica)
    eta_per_item: Number(await g("so_eta_per_item", "2")) || 2,
    // minuti per articolo (modalità statica)
    press_modo: await g("so_press_modo", "statico"),
    // statico | tempo
    press_max_comande: Number(await g("so_press_max_comande", "6")) || 6,
    // soglia (modalità statica): comande da smaltire
    press_max_minuti: Number(await g("so_press_max_minuti", "10")) || 10,
    // soglia (modalità tempo): attesa massima ammessa
    press_auto: await g("so_press_auto", "0") === "1",
    // se on: sotto pressione sospende in automatico; se off: solo avviso
    // Mappa tavoli (Bussola Garden): numero di tavoli e soglie di colore (minuti di attesa) per box.
    garden_tavoli: Math.max(1, Number(await g("garden_tavoli", "12")) || 12),
    map_giallo_min: Number(await g("map_giallo_min", "5")) || 5,
    // oltre → giallo
    map_rosso_min: Number(await g("map_rosso_min", "10")) || 10
    // oltre → rosso
  };
}
async function setConfig(patch) {
  const map = {
    eta_modo: "so_eta_modo",
    eta_base: "so_eta_base",
    eta_per_item: "so_eta_per_item",
    press_modo: "so_press_modo",
    press_max_comande: "so_press_max_comande",
    press_max_minuti: "so_press_max_minuti",
    press_auto: "so_press_auto",
    garden_tavoli: "garden_tavoli",
    map_giallo_min: "map_giallo_min",
    map_rosso_min: "map_rosso_min"
  };
  for (const [k, key] of Object.entries(map)) {
    if (patch[k] === void 0) continue;
    let v = patch[k];
    if (k === "press_auto") v = v ? "1" : "0";
    await setSetting(key, String(v));
  }
}
async function pendingItems() {
  const r = await db.prepare("SELECT COALESCE(SUM(cr.qta),0) n FROM comanda_righe cr JOIN comande c ON c.id=cr.comanda_id WHERE c.stato IN ('aperta','in_preparazione') AND cr.stato='in_coda'").get();
  return Number(r.n || 0);
}
async function activeOrders() {
  const r = await db.prepare("SELECT COUNT(*) n FROM comande WHERE stato IN ('aperta','in_preparazione')").get();
  return Number(r.n || 0);
}
async function serviceRatePerMin() {
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60 * 1e3).toISOString();
  const r = await db.prepare("SELECT COALESCE(SUM(cr.qta),0) n FROM comanda_righe cr JOIN comande c ON c.id=cr.comanda_id WHERE c.pronta_at IS NOT NULL AND c.pronta_at >= ?").get(since);
  const done = Number(r.n || 0);
  return done > 0 ? done / RATE_WINDOW_MIN : 0;
}
async function etaMin(cfg) {
  cfg = cfg || await getConfig();
  const pending = await pendingItems();
  if (cfg.eta_modo === "tempo") {
    const rate = await serviceRatePerMin();
    if (rate > 0) return Math.max(1, Math.min(ETA_MAX_MIN, Math.ceil(pending / rate)));
  }
  return Math.min(ETA_MAX_MIN, cfg.eta_base + pending * cfg.eta_per_item);
}
async function pressione(cfg) {
  cfg = cfg || await getConfig();
  if (cfg.press_modo === "tempo") return await etaMin(cfg) > cfg.press_max_minuti;
  return await activeOrders() >= cfg.press_max_comande;
}
async function statoCompleto() {
  const cfg = await getConfig();
  const eta = await etaMin(cfg);
  const press = await pressione(cfg);
  const attive = await activeOrders();
  const sospeso_pressione = cfg.aperto && cfg.press_auto && press;
  const ordinabile = cfg.aperto && !sospeso_pressione;
  return {
    aperto: cfg.aperto,
    ordinabile,
    sospeso_pressione,
    pressione: press,
    eta_min: eta,
    attive,
    config: cfg
  };
}
async function setSelfOrderAperto(v) {
  await setSetting("self_order_aperto", v ? "1" : "0");
}

// server/routes/public.js
var publicRouter = asyncify(Router());
publicRouter.get("/self-order/stato", async (req, res) => {
  const s = await statoCompleto();
  res.json({ aperto: s.aperto, ordinabile: s.ordinabile, sospeso_pressione: s.sospeso_pressione, pressione: s.pressione, eta_min: s.eta_min });
});
publicRouter.get("/casate", async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,colore,motto,punti FROM casate ORDER BY punti DESC").all();
  res.json(rows);
});
publicRouter.get("/menu", async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,prezzo,stazione,categoria,descrizione,allergeni FROM menu_articoli WHERE attivo=1 ORDER BY ordine,id").all();
  res.json(rows);
});
publicRouter.post("/self-order", async (req, res) => {
  const b = req.body || {};
  const st = await statoCompleto();
  if (!st.ordinabile) return res.status(423).json({
    error: st.sospeso_pressione ? "La cucina \xE8 molto impegnata: ordini dal telefono sospesi per pochi minuti. Rivolgiti allo staff o riprova a breve." : "Gli ordini self sono momentaneamente sospesi. Rivolgiti allo staff.",
    sospeso_pressione: st.sospeso_pressione
  });
  const righeIn = Array.isArray(b.righe) ? b.righe.filter((r) => r && r.menu_id && Number(r.qta) > 0) : [];
  if (!righeIn.length) return res.status(400).json({ error: "Aggiungi almeno un prodotto" });
  const punto = String(b.punto || "").trim() || "Chiosco";
  const tavolo = b.tavolo ? String(b.tavolo).trim() : null;
  const chi = b.tessera_code ? String(b.tessera_code).trim().toUpperCase() : null;
  const socio = chi ? await db.prepare("SELECT id FROM soci WHERE upper(tessera_code)=? AND attivo=1").get(chi) : null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const numero = (await db.prepare("SELECT COALESCE(MAX(numero),0)+1 n FROM comande WHERE date(created_at)=date('now')").get()).n;
  const info = await db.prepare("INSERT INTO comande (numero,origine,riferimento,punto,canale,zona,stato,totale,operatore,socio_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(numero, "tavolo", tavolo, punto, "self", "garden", "aperta", 0, chi || "self", socio ? socio.id : null, b.note || null, now, now);
  const cid = Number(info.lastInsertRowid);
  let totale = 0;
  for (const r of righeIn) {
    const m = await db.prepare("SELECT * FROM menu_articoli WHERE id=? AND attivo=1").get(r.menu_id);
    if (!m) continue;
    const qta = Math.max(1, Math.round(Number(r.qta)));
    totale += Number(m.prezzo) * qta;
    await db.prepare("INSERT INTO comanda_righe (comanda_id,menu_id,nome,prezzo,qta,stazione,note,stato) VALUES (?,?,?,?,?,?,?, 'in_coda')").run(cid, m.id, m.nome, Number(m.prezzo), qta, m.stazione, r.note || null);
  }
  await db.prepare("UPDATE comande SET totale=? WHERE id=?").run(totale, cid);
  audit(chi || "self", "self_order", "comande", cid, `${punto}${tavolo ? " \xB7 tav " + tavolo : ""} \xB7 \u20AC${totale}`);
  res.status(201).json({ ok: true, numero, id: cid, totale, punto, tavolo, eta_min: await etaMin(), push: !!socio });
});
publicRouter.get("/push/pubkey", async (req, res) => {
  const { pushEnabled: pushEnabled2, publicKey: publicKey2 } = await Promise.resolve().then(() => (init_push(), push_exports));
  res.json({ enabled: pushEnabled2(), key: publicKey2() });
});
publicRouter.get("/eventi", async (req, res) => {
  const rows = await db.prepare("SELECT chiave,giorno,titolo,ambiente,colore,sottotitolo,descrizione,cta,azione,tipo,ora_inizio,tipologia,artista,prezzo,serata_id FROM eventi WHERE attivo=1 ORDER BY ordine").all();
  const out = [];
  for (const e of rows) {
    let costo = Number(e.prezzo || 0);
    if (e.serata_id) {
      const s = await db.prepare("SELECT quota FROM serate WHERE id=?").get(e.serata_id);
      if (s && Number(s.quota) > 0) costo = Number(s.quota);
    }
    out.push({ ...e, costo });
  }
  res.json(out);
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
  const s = await db.prepare(`SELECT so.tessera_code,so.nome,so.cognome,so.ruolo,so.tipo_profilo,so.dinieghi,so.notifiche_push,so.valida_fino,so.host,so.struttura_id,c.nome AS casata,c.colore
                        FROM soci so LEFT JOIN casate c ON c.id=so.casata_id
                        WHERE so.tessera_code=? AND so.attivo=1`).get(req.params.code);
  if (!s) return res.status(404).json({ error: "Tessera non trovata" });
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
publicRouter.get("/campi", async (req, res) => {
  const rows = await db.prepare("SELECT id,nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default FROM campi WHERE attivo=1 ORDER BY ordine,id").all();
  res.json(rows);
});
publicRouter.get("/campi/:id/disponibilita", async (req, res) => {
  const campo = await db.prepare("SELECT * FROM campi WHERE id=? AND attivo=1").get(req.params.id);
  if (!campo) return res.status(404).json({ error: "Campo non trovato" });
  const data = String(req.query.data || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data non valida (YYYY-MM-DD)" });
  const occ = await db.prepare("SELECT * FROM prenotazioni_campo WHERE campo_id=? AND data=? AND stato='prenotato'").all(campo.id, data);
  const partite = await db.prepare("SELECT * FROM partite_aperte WHERE campo_id=? AND data=? AND stato IN ('aperta','completa')").all(campo.id, data);
  const iscrittiCount = {};
  for (const p of partite) iscrittiCount[p.id] = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
  const slots = slotDiCampo(campo).map((slot) => {
    const o = occ.find((x) => x.slot === slot);
    if (!o) return { slot, stato: "libero" };
    if (o.tipo === "partita" && o.partita_id) {
      const p = partite.find((x) => x.id === o.partita_id);
      if (p) return { slot, stato: "partita", partita_id: p.id, posti_totali: p.posti_totali, iscritti: iscrittiCount[p.id] || 0, livello: p.livello || "", creatore: p.creatore_nome || "", completa: p.stato === "completa" };
    }
    return { slot, stato: "privata", nome: o.nome || "Prenotato" };
  });
  res.json({ campo: { id: campo.id, nome: campo.nome, sport: campo.sport, durata_slot: campo.durata_slot }, data, slots });
});
async function slotLiberoValido(campo, data, slot) {
  if (!slotDiCampo(campo).includes(slot)) return "Orario non valido per questo campo" + (campo.ora_min ? ` (dalle ${campo.ora_min})` : "");
  const ex = await db.prepare("SELECT id FROM prenotazioni_campo WHERE campo_id=? AND data=? AND slot=? AND stato='prenotato'").get(campo.id, data, slot);
  if (ex) return "Slot gi\xE0 occupato";
  return null;
}
publicRouter.post("/campi/:id/prenota", async (req, res) => {
  const campo = await db.prepare("SELECT * FROM campi WHERE id=? AND attivo=1").get(req.params.id);
  if (!campo) return res.status(404).json({ error: "Campo non trovato" });
  const { tessera_code, data, slot } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return res.status(400).json({ error: "Data non valida" });
  const err = await slotLiberoValido(campo, data, slot);
  if (err) return res.status(409).json({ error: err });
  const socio = await socioByTessera(tessera_code);
  const nome = socio ? (socio.nome + " " + (socio.cognome || "")).trim() : req.body?.nome || "Ospite";
  const info = await db.prepare("INSERT INTO prenotazioni_campo (campo_id,data,slot,tipo,socio_id,tessera_code,nome,stato) VALUES (?,?,?,?,?,?,?,?)").run(campo.id, data, slot, "privata", socio?.id ?? null, tessera_code || null, nome, "prenotato");
  audit(tessera_code || "ospite", "prenota_campo", "campi", campo.id, `${data} ${slot}`);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});
publicRouter.post("/prenotazioni-campo/:id/annulla", async (req, res) => {
  const p = await db.prepare("SELECT * FROM prenotazioni_campo WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "prenotato") return res.status(404).json({ error: "Prenotazione non trovata" });
  if (p.tessera_code && req.body?.tessera_code && p.tessera_code !== req.body.tessera_code) return res.status(403).json({ error: "Puoi annullare solo le tue prenotazioni" });
  if (p.tipo === "partita" && p.partita_id) {
    await db.prepare("UPDATE partite_aperte SET stato='annullata' WHERE id=?").run(p.partita_id);
  }
  await db.prepare("UPDATE prenotazioni_campo SET stato='annullato' WHERE id=?").run(p.id);
  audit(req.body?.tessera_code || "socio", "annulla_campo", "campi", p.campo_id, `${p.data} ${p.slot}`);
  res.json({ ok: true });
});
async function notifyMancaUno(partitaId) {
  try {
    const p = await db.prepare("SELECT pa.*, c.nome AS campo_nome, c.sport FROM partite_aperte pa JOIN campi c ON c.id=pa.campo_id WHERE pa.id=?").get(partitaId);
    if (!p || p.stato !== "aperta") return;
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
publicRouter.post("/campi/:id/partita", async (req, res) => {
  const campo = await db.prepare("SELECT * FROM campi WHERE id=? AND attivo=1").get(req.params.id);
  if (!campo) return res.status(404).json({ error: "Campo non trovato" });
  const { tessera_code, data, slot, livello, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return res.status(400).json({ error: "Data non valida" });
  const err = await slotLiberoValido(campo, data, slot);
  if (err) return res.status(409).json({ error: err });
  const posti = Math.max(2, Math.min(30, Number(req.body?.posti_totali) || campo.posti_default || 4));
  const socio = await socioByTessera(tessera_code);
  const nome = socio ? (socio.nome + " " + (socio.cognome || "")).trim() : req.body?.nome || "Ospite";
  const pi = await db.prepare("INSERT INTO partite_aperte (campo_id,data,slot,posti_totali,livello,note,stato,creatore_tessera,creatore_nome) VALUES (?,?,?,?,?,?,?,?,?)").run(campo.id, data, slot, posti, livello || null, note || null, "aperta", tessera_code || null, nome);
  const partitaId = Number(pi.lastInsertRowid);
  await db.prepare("INSERT INTO prenotazioni_campo (campo_id,data,slot,tipo,socio_id,tessera_code,nome,stato,partita_id) VALUES (?,?,?,?,?,?,?,?,?)").run(campo.id, data, slot, "partita", socio?.id ?? null, tessera_code || null, nome, "prenotato", partitaId);
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)").run(partitaId, socio?.id ?? null, tessera_code || null, nome);
  audit(tessera_code || "ospite", "apre_partita", "campi", campo.id, `${data} ${slot} \xB7 ${posti} posti`);
  await notifyMancaUno(partitaId);
  res.status(201).json({ ok: true, partita_id: partitaId });
});
publicRouter.get("/campi/partite-aperte", async (req, res) => {
  const data = req.query.data ? String(req.query.data).slice(0, 10) : null;
  const q = data ? await db.prepare("SELECT p.*, c.nome AS campo_nome, c.sport FROM partite_aperte p JOIN campi c ON c.id=p.campo_id WHERE p.stato='aperta' AND p.data=? ORDER BY p.data,p.slot").all(data) : await db.prepare("SELECT p.*, c.nome AS campo_nome, c.sport FROM partite_aperte p JOIN campi c ON c.id=p.campo_id WHERE p.stato='aperta' ORDER BY p.data,p.slot").all();
  const out = [];
  for (const p of q) {
    const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
    out.push({ id: p.id, campo_id: p.campo_id, campo_nome: p.campo_nome, sport: p.sport, data: p.data, slot: p.slot, posti_totali: p.posti_totali, iscritti: n, mancano: Math.max(0, p.posti_totali - n), livello: p.livello || "", note: p.note || "", creatore: p.creatore_nome || "" });
  }
  res.json(out);
});
publicRouter.post("/partite-aperte/:id/unisciti", async (req, res) => {
  const p = await db.prepare("SELECT * FROM partite_aperte WHERE id=?").get(req.params.id);
  if (!p || p.stato !== "aperta") return res.status(409).json({ error: "Partita non disponibile" });
  const { tessera_code } = req.body || {};
  const socio = await socioByTessera(tessera_code);
  if (tessera_code) {
    const gia = await db.prepare("SELECT id FROM partita_iscritti WHERE partita_id=? AND tessera_code=?").get(p.id, tessera_code);
    if (gia) return res.status(409).json({ error: "Sei gi\xE0 iscritto a questa partita" });
  }
  const n = (await db.prepare("SELECT COUNT(*) n FROM partita_iscritti WHERE partita_id=?").get(p.id)).n;
  if (n >= p.posti_totali) return res.status(409).json({ error: "Partita gi\xE0 al completo" });
  const nome = socio ? (socio.nome + " " + (socio.cognome || "")).trim() : req.body?.nome || "Ospite";
  await db.prepare("INSERT INTO partita_iscritti (partita_id,socio_id,tessera_code,nome) VALUES (?,?,?,?)").run(p.id, socio?.id ?? null, tessera_code || null, nome);
  const nuovi = n + 1;
  const completa = nuovi >= p.posti_totali;
  if (completa) await db.prepare("UPDATE partite_aperte SET stato='completa' WHERE id=?").run(p.id);
  audit(tessera_code || "ospite", "unisce_partita", "campi", p.campo_id, `${p.data} ${p.slot}`);
  if (!completa) await notifyMancaUno(p.id);
  res.json({ ok: true, iscritti: nuovi, posti_totali: p.posti_totali, completa });
});

// server/routes/admin.js
init_db();
import { Router as Router2 } from "express";
import { readFileSync, unlinkSync, statSync } from "node:fs";

// server/contest.js
init_db();
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
  "comande",
  // Chiosco: comande + KDS (cassa/cameriere/stazioni)
  "campi"
  // Prenotazione campi (config campi + regole + prospetto prenotazioni)
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

// server/routes/admin.js
import * as XLSX from "xlsx";

// server/vendor/qrcode-generator.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = (function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row = 0; row < moduleCount; row += 1) {
        modules[row] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row][col] = null;
        }
      }
      return modules;
    })(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
        if (_modules[row][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark = !dark;
            }
            _modules[row][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
      throw row + "," + col;
    }
    return _modules[row][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc, r, mr, qrSvg2 = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg2 += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg2 += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg2 += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg2 += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg2 += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg2 += ">";
    qrSvg2 += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg2 += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg2 += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg2 += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg2 += "M" + mc + "," + mr + rect;
        }
      }
    }
    qrSvg2 += '" stroke="transparent" fill="black"/>';
    qrSvg2 += "</svg>";
    return qrSvg2;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "\u2588\u2588": "\u2588",
      "\u2588 ": "\u2580",
      " \u2588": "\u2584",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "\u2588\u2588": "\u2580",
      "\u2588 ": "\u2580",
      " \u2588": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "\u2588";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "\u2588";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("\u2588\u2588");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row, col) ? "black" : "white";
        context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = (function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read2 = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read2();
      const b2 = read2();
      const b3 = read2();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  })();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = (function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark = qrcode2.isDark(row, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrcode2.isDark(row + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row = 0; row < moduleCount - 1; row += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row, col)) count += 1;
        if (qrcode2.isDark(row + 1, col)) count += 1;
        if (qrcode2.isDark(row, col + 1)) count += 1;
        if (qrcode2.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount - 6; row += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount; row += 1) {
        if (qrcode2.isDark(row, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
})();
var QRMath = (function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n) {
    if (n < 1) {
      throw "glog(" + n + ")";
    }
    return LOG_TABLE[n];
  };
  _this.gexp = function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  };
  return _this;
})();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = (function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  })();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = (function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
})();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes2 = qrcode.stringToBytes;
  !(function(c, code) {
    const test = stringToBytes2(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  })("\u53CB", 38726);
  const _bytes = stringToBytes2(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
  };
  const encode = function(n) {
    if (n < 0) {
      throw "n:" + n;
    } else if (n < 26) {
      return 65 + n;
    } else if (n < 52) {
      return 97 + (n - 26);
    } else if (n < 62) {
      return 48 + (n - 52);
    } else if (n == 62) {
      return 43;
    } else if (n == 63) {
      return 47;
    } else {
      throw "n:" + n;
    }
  };
  _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_generator_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// server/qrcode.js
function qrSvg(text, { cellSize = 5, margin = 2, ecc = "M" } = {}) {
  const qr = qrcode_generator_default(0, ecc);
  qr.addData(String(text || ""));
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

// server/routes/admin.js
init_menucat();
init_push();
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
var adminRouter = asyncify(Router2());
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
  const cols = ["tessera_code", "nome", "cognome", "email", "telefono", "data_nascita", "casata_id", "ruolo", "tipo_profilo", "tutore_id", "lingua", "consenso_privacy", "consenso_marketing", "consenso_foto", "notifiche_push", "valida_fino", "soggiorno_dal", "soggiorno_al"];
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
    consenso_privacy=?,consenso_marketing=?,consenso_foto=?,notifiche_push=?,attivo=?,valida_fino=?,soggiorno_dal=?,soggiorno_al=? WHERE id=?`).run(
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
    req.params.id
  );
  if (!["residente", "socio_residente"].includes(tipo)) await db.prepare("UPDATE soci SET host=0, host_ko=0 WHERE id=?").run(req.params.id);
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
  await db.prepare("UPDATE eventi SET titolo=?,sottotitolo=?,descrizione=?,ambiente=?,giorno=?,ora_inizio=?,tipologia=?,artista=?,prezzo=?,serata_id=?,attivo=? WHERE id=?").run(b.titolo, b.sottotitolo ?? "", b.descrizione ?? "", b.ambiente ?? "", b.giorno ?? "", b.ora_inizio ?? null, b.tipologia ?? null, b.artista ?? null, Number(b.prezzo || 0), b.serata_id || null, b.attivo ? 1 : 0, req.params.id);
  audit(req.adminUser.username, "modifica", "eventi", req.params.id);
  res.json({ ok: true });
});
adminRouter.post("/eventi", requireCap("eventi"), async (req, res) => {
  const b = req.body || {};
  if (!b.titolo) return res.status(400).json({ error: "Titolo obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM eventi").get()).n;
  const info = await db.prepare("INSERT INTO eventi (giorno,titolo,sottotitolo,descrizione,ambiente,ora_inizio,tipologia,artista,prezzo,serata_id,tipo,attivo,ordine) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)").run(b.giorno ?? "", b.titolo, b.sottotitolo ?? "", b.descrizione ?? "", b.ambiente ?? "", b.ora_inizio ?? null, b.tipologia ?? null, b.artista ?? null, Number(b.prezzo || 0), b.serata_id || null, b.tipo ?? "serata", ord);
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
  const zona = req.query.zona;
  const zonaWhere = zona === "bar" ? "zona IN ('bar','comune')" : zona === "garden" ? "zona IN ('garden','comune')" : zona === "comune" ? "zona='comune'" : zona ? "zona=?" : "";
  const conds = [];
  const args = [];
  if (area) {
    conds.push("area=?");
    args.push(area);
  }
  if (zonaWhere) {
    conds.push(zonaWhere);
    if (zona && !["bar", "garden", "comune"].includes(zona)) args.push(zona);
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
  const info = await db.prepare("INSERT INTO magazzino_articoli (nome,area,zona,unita,giacenza,punto_riordino,soglia_preavviso,note,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(b.nome, b.area || "chiosco", magNormZona(b.zona), b.unita || "pz", Number(b.giacenza || 0), Number(b.punto_riordino || 0), Number(b.soglia_preavviso || 0), b.note || null, ord, (/* @__PURE__ */ new Date()).toISOString());
  audit(req.adminUser.username, "crea", "magazzino_articoli", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/magazzino/:id", requireCap("magazzino"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE magazzino_articoli SET nome=?,area=?,zona=?,unita=?,punto_riordino=?,soglia_preavviso=?,note=?,aggiornato_at=? WHERE id=?").run(b.nome, b.area || "chiosco", magNormZona(b.zona), b.unita || "pz", Number(b.punto_riordino || 0), Number(b.soglia_preavviso || 0), b.note || null, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
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
async function impegnoTot(articoloId) {
  const r = await db.prepare("SELECT COALESCE(SUM(quantita),0) q FROM magazzino_richieste WHERE articolo_id=? AND stato='impegnata'").get(articoloId);
  return Number(r.q);
}
async function impegnoZona(articoloId, zona) {
  const r = await db.prepare("SELECT COALESCE(SUM(quantita),0) q FROM magazzino_richieste WHERE articolo_id=? AND zona=? AND stato='impegnata'").get(articoloId, zona);
  return Number(r.q);
}
adminRouter.get("/magazzino/zona/:zona", requireCap("magazzino"), async (req, res) => {
  const zona = req.params.zona === "bar" ? "bar" : "garden";
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
  const zona = req.params.zona === "bar" ? "bar" : "garden";
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
  const zona = b.zona === "bar" ? "bar" : "garden";
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
function magNormZona(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s.startsWith("bar")) return "bar";
  if (s.startsWith("gard") || s.startsWith("giard")) return "garden";
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
      await db.prepare("INSERT INTO magazzino_articoli (nome,area,zona,unita,giacenza,punto_riordino,soglia_preavviso,ordine,aggiornato_at) VALUES (?,?,?,?,?,?,?,?,?)").run(nome, area, zona, clean(r.unita) || "pz", num(r.giacenza), num(r.punto_riordino), num(r.soglia_preavviso), ord, now);
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
adminRouter.get("/menu/export", requireCap("comande"), async (req, res) => {
  const m = await db.prepare("SELECT nome,prezzo,stazione,categoria,descrizione,allergeni FROM menu_articoli ORDER BY ordine,id").all();
  const rows = m.map((x) => ({ nome: x.nome, prezzo: Number(x.prezzo), stazione: x.stazione, categoria: x.categoria || "", descrizione: x.descrizione || "", allergeni: x.allergeni || "" }));
  res.json({ filename: "menu.xlsx", mime: XLSX_MIME, b64: xlsxB64(rows, "Menu") });
});
adminRouter.get("/menu", requireCap("comande"), async (req, res) => {
  const rows = await db.prepare("SELECT * FROM menu_articoli ORDER BY ordine,id").all();
  res.json(rows);
});
adminRouter.post("/menu", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM menu_articoli").get()).n;
  const info = await db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,categoria,descrizione,allergeni,magazzino_id,attivo,ordine) VALUES (?,?,?,?,?,?,?,?,?)").run(b.nome, Number(b.prezzo || 0), b.stazione === "cucina" ? "cucina" : "bar", b.categoria || null, b.descrizione || null, b.allergeni || null, b.magazzino_id || null, b.attivo === false ? 0 : 1, ord);
  audit(req.adminUser.username, "crea", "menu_articoli", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/menu/:id", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE menu_articoli SET nome=?,prezzo=?,stazione=?,categoria=?,descrizione=?,allergeni=?,magazzino_id=?,attivo=? WHERE id=?").run(b.nome, Number(b.prezzo || 0), b.stazione === "cucina" ? "cucina" : "bar", b.categoria || null, b.descrizione ?? null, b.allergeni ?? null, b.magazzino_id || null, b.attivo === false ? 0 : 1, req.params.id);
  audit(req.adminUser.username, "modifica", "menu_articoli", req.params.id);
  res.json({ ok: true });
});
function parseMenuFile(fileB64) {
  const json = sheetRows(fileB64);
  const norm = (s) => String(s || "").trim().toLowerCase();
  const alias = { nome: ["nome", "prodotto", "articolo", "name"], prezzo: ["prezzo", "price", "costo"], stazione: ["stazione", "station", "reparto"], categoria: ["categoria", "category"], descrizione: ["descrizione", "description", "desc"], allergeni: ["allergeni", "allergen", "allergens"] };
  return json.map((r) => {
    const keys = Object.keys(r);
    const pick = (al) => {
      const k = keys.find((k2) => al.includes(norm(k2)));
      return k != null ? r[k] : "";
    };
    return { nome: pick(alias.nome), prezzo: pick(alias.prezzo), stazione: pick(alias.stazione), categoria: pick(alias.categoria), descrizione: pick(alias.descrizione), allergeni: pick(alias.allergeni) };
  }).filter((r) => String(r.nome).trim());
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
  const clean = (v) => v == null || String(v).trim() === "" ? null : String(v).trim();
  const catImport = (r, staz, ex) => clean(r.categoria) || ex && ex.categoria || inferCategoria(r.nome) || (staz === "cucina" ? "Cucina" : "Bar");
  if (b.dryRun) return res.json({ ok: true, totale: righe.length, anteprima: righe.slice(0, 12).map((r) => {
    const staz = String(r.stazione || "").toLowerCase().startsWith("cuc") ? "cucina" : "bar";
    return { ...r, prezzo: toNum(r.prezzo), categoria: catImport(r, staz, null) };
  }) });
  let creati = 0, aggiornati = 0;
  if (b.mode === "replace") {
    await db.exec("DELETE FROM menu_articoli;");
  }
  for (const r of righe) {
    const nome = clean(r.nome);
    if (!nome) continue;
    const hasPrezzo = r.prezzo != null && String(r.prezzo).trim() !== "";
    const prezzo = toNum(r.prezzo);
    const stazione = String(r.stazione || "").toLowerCase().startsWith("cuc") ? "cucina" : "bar";
    const descrizione = clean(r.descrizione), allergeni = clean(r.allergeni);
    const ex = await db.prepare("SELECT * FROM menu_articoli WHERE nome=?").get(nome);
    const categoria = catImport(r, r.stazione ? stazione : ex ? ex.stazione : stazione, ex);
    if (ex) {
      await db.prepare("UPDATE menu_articoli SET prezzo=?,stazione=?,categoria=?,descrizione=?,allergeni=? WHERE id=?").run(hasPrezzo ? prezzo : ex.prezzo, r.stazione ? stazione : ex.stazione, categoria, descrizione ?? ex.descrizione, allergeni ?? ex.allergeni, ex.id);
      aggiornati++;
    } else {
      const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM menu_articoli").get()).n;
      await db.prepare("INSERT INTO menu_articoli (nome,prezzo,stazione,categoria,descrizione,allergeni,attivo,ordine) VALUES (?,?,?,?,?,?,1,?)").run(nome, prezzo, stazione, categoria, descrizione, allergeni, ord);
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
  else rows = ordinaCoda(await db.prepare("SELECT * FROM comande WHERE stato NOT IN ('chiusa','annullata') ORDER BY id").all());
  for (const c of rows) c.righe = await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? ORDER BY id").all(c.id);
  res.json(rows);
});
adminRouter.post("/comande", requireCap("comande"), async (req, res) => {
  const b = req.body || {};
  const righe = Array.isArray(b.righe) ? b.righe.filter((r) => r && r.menu_id && Number(r.qta) > 0) : [];
  if (!righe.length) return res.status(400).json({ error: "Aggiungi almeno un articolo" });
  const numero = (await db.prepare("SELECT COALESCE(MAX(numero),0)+1 n FROM comande WHERE date(created_at)=date('now')").get()).n;
  const zona = b.zona === "bar" ? "bar" : "garden";
  const info = await db.prepare("INSERT INTO comande (numero,origine,riferimento,zona,stato,totale,operatore,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(numero, ["tavolo", "bancone", "chiosco", "bar"].includes(b.origine) ? b.origine : zona === "bar" ? "bar" : "tavolo", b.riferimento || null, zona, "aperta", 0, req.adminUser.username, b.note || null, (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString());
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
  const prev = (await db.prepare("SELECT stato FROM comande WHERE id=?").get(req.params.id) || {}).stato;
  await db.prepare("UPDATE comande SET stato=?,updated_at=? WHERE id=?").run(stato, (/* @__PURE__ */ new Date()).toISOString(), req.params.id);
  if (stato === "pronta") {
    await segnaPronta(req.params.id);
    await avvisaProntoSeSelf(req.params.id, prev);
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
  const metodi = ["contanti", "carta", "satispay", "buoni", "altro"];
  const metodo = metodi.includes(req.body?.metodo) ? req.body.metodo : "contanti";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.prepare("UPDATE comande SET stato=?,metodo_pagamento=?,pagata_at=?,updated_at=? WHERE id=?").run("chiusa", metodo, now, now, c.id);
  audit(req.adminUser.username, "chiudi", "comande", c.id, `tot ${c.totale} \xB7 ${metodo}`);
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
  const comande = ordinaCoda(await db.prepare("SELECT * FROM comande WHERE stato IN ('aperta','in_preparazione','pronta') ORDER BY id").all());
  const out = [];
  for (const c of comande) {
    const righe = staz ? await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? AND stazione=? AND stato!='consegnata' ORDER BY id").all(c.id, staz) : await db.prepare("SELECT * FROM comanda_righe WHERE comanda_id=? AND stato!='consegnata' ORDER BY id").all(c.id);
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
  res.json(await db.prepare("SELECT * FROM campi ORDER BY ordine,id").all());
});
adminRouter.post("/campi", requireCap("campi"), async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: "Nome obbligatorio" });
  const ord = (await db.prepare("SELECT COALESCE(MAX(ordine),0)+1 n FROM campi").get()).n;
  const info = await db.prepare("INSERT INTO campi (nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default,attivo,ordine) VALUES (?,?,?,?,?,?,?,?,?)").run(b.nome, b.sport || "pickleball", b.apertura || "09:00", b.chiusura || "22:00", Number(b.durata_slot) || 60, b.ora_min || null, Number(b.posti_default) || 4, b.attivo === false ? 0 : 1, ord);
  audit(req.adminUser.username, "crea", "campi", info.lastInsertRowid, b.nome);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
adminRouter.put("/campi/:id", requireCap("campi"), async (req, res) => {
  const b = req.body || {};
  await db.prepare("UPDATE campi SET nome=?,sport=?,apertura=?,chiusura=?,durata_slot=?,ora_min=?,posti_default=?,attivo=? WHERE id=?").run(b.nome, b.sport || "pickleball", b.apertura || "09:00", b.chiusura || "22:00", Number(b.durata_slot) || 60, b.ora_min || null, Number(b.posti_default) || 4, b.attivo === false ? 0 : 1, req.params.id);
  audit(req.adminUser.username, "modifica", "campi", req.params.id);
  res.json({ ok: true });
});
adminRouter.delete("/campi/:id", requireCap("campi"), async (req, res) => {
  await db.prepare("DELETE FROM partita_iscritti WHERE partita_id IN (SELECT id FROM partite_aperte WHERE campo_id=?)").run(req.params.id);
  await db.prepare("DELETE FROM partite_aperte WHERE campo_id=?").run(req.params.id);
  await db.prepare("DELETE FROM prenotazioni_campo WHERE campo_id=?").run(req.params.id);
  await db.prepare("DELETE FROM campi WHERE id=?").run(req.params.id);
  audit(req.adminUser.username, "cancella", "campi", req.params.id);
  res.json({ ok: true });
});
adminRouter.get("/campi/prenotazioni", requireCap("campi"), async (req, res) => {
  const data = req.query.data ? String(req.query.data).slice(0, 10) : null;
  const rows = data ? await db.prepare("SELECT p.*, c.nome AS campo_nome FROM prenotazioni_campo p JOIN campi c ON c.id=p.campo_id WHERE p.stato='prenotato' AND p.data=? ORDER BY p.slot,c.ordine").all(data) : await db.prepare("SELECT p.*, c.nome AS campo_nome FROM prenotazioni_campo p JOIN campi c ON c.id=p.campo_id WHERE p.stato='prenotato' ORDER BY p.data DESC,p.slot LIMIT 100").all();
  res.json(rows);
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

// server/routes/authuser.js
init_db();
import { Router as Router3 } from "express";
init_push();
var authUserRouter = asyncify(Router3());
var DEV = (process.env.KOINE_ENV || "dev") !== "prod";
async function requireUser(req, res, next) {
  const token = (req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const u = await getUserSession(token);
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
  const token = await createUserSession(socio);
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
  const token = await createUserSession(socio);
  audit(socio.tessera_code, "login_utente", "soci", socio.id);
  const casata = await db.prepare("SELECT nome,colore FROM casate WHERE id=?").get(socio.casata_id) || {};
  res.json({ token, socio: { tessera_code: socio.tessera_code, nome: socio.nome, cognome: socio.cognome, ruolo: socio.ruolo, tipo_profilo: socio.tipo_profilo, casata: casata.nome, colore: casata.colore, notifiche_push: !!socio.notifiche_push } });
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
    res.status(201).json({ token, socio: { tessera_code, nome, cognome, ruolo, tipo_profilo: tipo, notifiche_push: false } });
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

// server/version.js
var VERSION = "4.59";

// build/frontend.html
var frontend_default = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#12324F">
<meta name="description" content="Bussola Residence \u2014 l'app del residence di Fontane Bianche: eventi, sport, Coppa delle Casate, tessera e guida.">
<title>Bussola Residence \u2014 App</title>
<!-- PWA: manifest + service worker iniettati dal server (server/pwa.js) -->
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
.ev-meta{display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:6px;}
.ev-ty{display:inline-block; color:#fff; font-size:.66rem; font-weight:700; letter-spacing:.3px; padding:2px 9px; border-radius:999px; white-space:nowrap;}
.ev-ar{font-size:.72rem; color:var(--ink); font-weight:600;}
.ev-co{font-size:.72rem; color:var(--gold,#B7791F); font-weight:800; white-space:nowrap;}
.evcard p.sub, .evcard .ev-meta{white-space:normal;}
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

/* --- Responsivit\xE0 (v4.41) --- */
/* Su telefono: niente cornice-mockup, l'app riempie lo schermo (esperienza nativa, nessun bordo sprecato).
   Il grazioso "telefono" resta solo su schermi grandi (anteprima desktop). */
@media (max-width: 640px){
  body{ padding:0; align-items:stretch; background:var(--paper); }
  .phone{ width:100%; max-width:none; height:100vh; height:100dvh; max-height:none; border-radius:0; box-shadow:none; }
  .notch{ display:none; }
}
@media (min-width: 900px){ .phone{ width:440px; max-height:900px; } }

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
      <button class="btn navy block" id="gate_register" style="margin-top:8px">\u2728 Non hai un account? Registrati</button>
    </div>
  </div>
</div>

<script>
/* Componente COMANDA condiviso \u2014 una sola presentazione del men\xF9 per ogni contesto.
 * Step 0: chi lo usa carica il men\xF9 (da qualunque fonte) e lo passa qui.
 * Step 1: il men\xF9 viene raggruppato in modo logico e omogeneo (per categoria) e reso IDENTICO
 *         per lo staff (chiosco), per il cliente al tavolo (/ordina) e nell'app soci.
 * Indipendente e riusabile: nessuna dipendenza esterna, CSS auto-iniettato una volta.
 *
 * API:  const c = Comanda.create({ mount, menu, search=true, onChange(cart,total,count) })
 *       c.getRighe() -> [{menu_id, qta}]   c.total()   c.count()   c.clear()   c.setMenu(menu)   c.focusSearch()
 */
window.Comanda = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function eur(n) { return '\u20AC ' + (Number(n) || 0).toFixed(2); }
  function norm(s) { return (s == null ? '' : String(s)).toLowerCase(); }

  // Auto-categorie: se l'articolo non ha \`categoria\` valorizzata, la deduciamo dal NOME
  // cos\xEC la comanda si raggruppa in modo logico (Caffetteria, Bibite, Birre\u2026) come nel men\xF9 stampato,
  // senza dover categorizzare a mano tutto il listino. Una \`categoria\` esplicita vince sempre.
  const CAT_RULES = [
    ['Caffetteria', /caff[e\xE8]|cappucc|macchiat|marocchin|\\blatte\\b|orzo|ginseng|cioccolat|espress|ristrett|decaffe|shakerat|tisana|camomill|t[e\xE8]\\s*cald/i],
    ['Bibite', /acqua|coca|\\bcola\\b|fanta|sprite|aranciat|chinotto|gassosa|gazzosa|\\btonic|spremut|succ|t[e\xE8]\\s*fredd|th[e\xE8]|estath|energy|red\\s*bull|redbull|gatorade|powerade|bibit|cedrat|lemonsoda|oransoda|schweppes/i],
    ['Birre', /birr|\\bbeer\\b|\\bipa\\b|lager|weiss|weizen|\\bpils|stout|moretti|heineken|peroni|ichnusa|\\bcorona\\b|ceres|nastro\\s*azzurro/i],
    ['Aperitivi & Cocktail', /spritz|aperol|campari|negroni|american|mojito|cocktail|\\bgin\\b|vodka|\\brum\\b|tequila|whisk|bacardi|\\bmartini\\b|aperitiv|bitter|crodino|analcolic|\\blimoncell/i],
    ['Vini', /\\bvin[oi]\\b|calice|prosecc|spumant|franciacort|moscato|chardonnay|merlot|bollicin|champagne|champagn/i],
    ['Gelati', /gelat|ghiacciol|magnum|sorbett|granit|\\bstecco\\b|coppett/i],
    ['Snack', /patatin|\\bchips\\b|tarall|nachos|pop\\s*corn|popcorn|arachid|\\bolive\\b|salatin|cracker|pretzel|\\bsnack\\b/i],
    ['Panini & Piatti', /panin|toast|piadin|hamburger|hot\\s*dog|hotdog|pizz|focacc|tramezzin|\\bwrap\\b|insalat|\\bpasta\\b|sandwich|bruschett|tagliere|\\bfritt|arancin/i],
    ['Dolci', /cornetto|brioch|croissant|\\bdolc|\\btorta\\b|crostat|muffin|biscott|tiramis|budino|crep|cr[e\xEA]pe|waffle|nutella|pancake/i],
  ];
  const CAT_ORDER = CAT_RULES.map(r => r[0]).concat(['Bar', 'Cucina']);
  function inferCat(nome) { const s = String(nome == null ? '' : nome); for (const [name, rx] of CAT_RULES) { if (rx.test(s)) return name; } return null; }
  function catOf(m) { return (m.categoria && String(m.categoria).trim()) || inferCat(m.nome) || (m.stazione === 'cucina' ? 'Cucina' : 'Bar'); }
  function catRank(c) { if (c === 'Bar') return 900; if (c === 'Cucina') return 901; const i = CAT_ORDER.indexOf(c); return i < 0 ? 500 : i; }
  function sortCats(arr) { return arr.slice().sort((a, b) => (catRank(a) - catRank(b)) || String(a).localeCompare(String(b))); }
  function group(menu) { const g = {}; (menu || []).forEach(m => { const k = catOf(m); (g[k] = g[k] || []).push(m); }); return g; }

  // CSS iniettato una sola volta: stesso aspetto in ogni contesto (usa le variabili --navy/--gold se presenti).
  function injectCss() {
    if (document.getElementById('cmd-css')) return;
    const st = document.createElement('style'); st.id = 'cmd-css';
    st.textContent = \`
      .cmd{--c-navy:var(--navy,#12324F);--c-gold:var(--gold,#C9A227);--c-line:#cbd2d8}
      .cmd-tools{display:flex;gap:6px;margin-bottom:8px;align-items:center}
      .cmd-q{flex:1;min-width:140px;padding:9px 11px;border:1.5px solid var(--c-line);border-radius:10px;font-size:1rem}
      .cmd-qx{border:1.5px solid var(--c-line);background:#fff;border-radius:10px;width:38px;height:38px;font-weight:700;color:var(--c-navy)}
      .cmd-chips{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:2px;margin-bottom:8px}
      .cmd-chip{border:1.5px solid var(--c-line);background:#fff;color:var(--c-navy);border-radius:999px;padding:6px 14px;font-weight:700;font-size:.85rem;white-space:nowrap;cursor:pointer}
      .cmd-chip.on{background:var(--c-navy);color:#fff;border-color:var(--c-navy)}
      .cmd-list{columns:280px;column-gap:16px}
      .cmd-group{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;margin-bottom:10px}
      .cmd-cat{font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--c-navy);font-size:.8rem;margin:0 0 6px;padding-top:2px}
      .cmd-group:first-child .cmd-cat{padding-top:0}
      .cmd-item{background:#fff;border:1.5px solid var(--c-line);border-radius:12px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center}
      .cmd-info{flex:1;min-width:0}
      .cmd-info b{display:block;color:var(--c-navy)}
      .cmd-desc{font-size:.78rem;color:#555;display:block}
      .cmd-alg{font-size:.7rem;color:#8a6d1f;font-style:italic;display:block}
      .cmd-pz{color:var(--c-gold);font-weight:800;white-space:nowrap;font-size:.92rem}
      .cmd-step{display:flex;gap:6px;align-items:center}
      .cmd-b{border:1.5px solid var(--c-line);background:#fff;border-radius:9px;width:34px;height:34px;font-size:1.15rem;font-weight:800;color:var(--c-navy);line-height:1}
      .cmd-b.add{background:var(--c-gold);color:#fff;border-color:var(--c-gold)}
      .cmd-n{min-width:20px;text-align:center;font-weight:800;color:var(--c-navy)}
      .cmd-empty{color:#777;padding:10px 2px;font-size:.9rem}\`;
    document.head.appendChild(st);
  }

  function create(opts) {
    injectCss();
    const mount = opts.mount;
    let menu = opts.menu || [];
    const useSearch = opts.search !== false;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    const cart = {};
    let selCat = '';

    mount.classList.add('cmd');
    mount.innerHTML = (useSearch
      ? \`<div class="cmd-tools"><input class="cmd-q" placeholder="\u{1F50D} Cerca prodotto\u2026" autocomplete="off"><button class="cmd-qx" title="Pulisci">\u2715</button></div><div class="cmd-chips"></div>\`
      : '') + \`<div class="cmd-list"></div>\`;

    const $ = (sel) => mount.querySelector(sel);
    const listEl = $('.cmd-list');
    const qEl = useSearch ? $('.cmd-q') : null;
    const chipsEl = useSearch ? $('.cmd-chips') : null;

    function cats() { return sortCats([...new Set((menu || []).map(catOf))]); }
    function total() { let t = 0; Object.keys(cart).forEach(id => { const m = menu.find(x => String(x.id) === id); if (m) t += Number(m.prezzo) * cart[id]; }); return t; }
    function count() { let n = 0; Object.keys(cart).forEach(id => n += cart[id]); return n; }
    function fire() { onChange(cart, total(), count()); }

    function itemHTML(m) {
      const q = cart[m.id] || 0;
      return \`<div class="cmd-item"><div class="cmd-info"><b>\${esc(m.nome)}</b>\${m.descrizione ? \`<span class="cmd-desc">\${esc(m.descrizione)}</span>\` : ''}\${m.allergeni ? \`<span class="cmd-alg">Allergeni: \${esc(m.allergeni)}</span>\` : ''}</div><span class="cmd-pz">\${eur(m.prezzo)}</span><div class="cmd-step"><button class="cmd-b" data-cdec="\${m.id}">\u2212</button><b class="cmd-n" data-cn="\${m.id}">\${q}</b><button class="cmd-b add" data-cadd="\${m.id}">+</button></div></div>\`;
    }
    function renderChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = ['', ...cats()].map(c => \`<button class="cmd-chip\${c === selCat ? ' on' : ''}" data-ccat="\${esc(c)}">\${c === '' ? 'Tutti' : esc(c)}</button>\`).join('');
    }
    function renderList() {
      const q = norm(qEl && qEl.value).trim();
      const g = {};
      (menu || []).forEach(m => {
        const k = catOf(m);
        if (selCat && k !== selCat) return;
        if (q && !(norm(m.nome).includes(q) || norm(m.categoria).includes(q) || norm(m.allergeni).includes(q))) return;
        (g[k] = g[k] || []).push(m);
      });
      const keys = sortCats(Object.keys(g));
      // Ogni categoria \xE8 un blocco che NON si spezza tra le colonne: su schermi larghi (cassa/tablet)
      // il men\xF9 si dispone su pi\xF9 colonne e l'operatore non deve scorrere per cercare l'articolo.
      listEl.innerHTML = keys.length
        ? keys.map(cat => \`<div class="cmd-group"><div class="cmd-cat">\${esc(cat)}</div>\${g[cat].map(itemHTML).join('')}</div>\`).join('')
        : \`<p class="cmd-empty">Nessun prodotto\${q ? ' per \u201C' + esc(q) + '\u201D' : ''}.</p>\`;
    }
    function setN(id) { const el = mount.querySelector('[data-cn="' + id + '"]'); if (el) el.textContent = cart[id] || 0; }
    function chg(id, d) {
      const m = menu.find(x => String(x.id) === String(id)); if (!m) return;
      cart[id] = (cart[id] || 0) + d; if (cart[id] <= 0) delete cart[id];
      setN(id); fire();
    }

    // Delegazione: un solo listener per tutto il componente.
    mount.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-cadd],[data-cdec],[data-ccat]'); if (!a) return;
      if (a.dataset.cadd != null) return chg(a.dataset.cadd, 1);
      if (a.dataset.cdec != null) return chg(a.dataset.cdec, -1);
      if (a.dataset.ccat != null) { selCat = a.dataset.ccat; renderChips(); renderList(); }
    });
    if (qEl) qEl.addEventListener('input', renderList);
    if (useSearch) { const x = $('.cmd-qx'); if (x) x.addEventListener('click', () => { if (qEl) { qEl.value = ''; qEl.focus(); } renderList(); }); }

    renderChips(); renderList(); fire();

    return {
      getRighe() { return Object.keys(cart).map(id => ({ menu_id: Number(id), qta: cart[id] })); },
      total, count,
      clear() { Object.keys(cart).forEach(k => delete cart[k]); selCat = ''; renderChips(); renderList(); fire(); },
      setMenu(m) { menu = m || []; Object.keys(cart).forEach(k => delete cart[k]); selCat = ''; renderChips(); renderList(); fire(); },
      focusSearch() { if (qEl) qEl.focus(); },
    };
  }

  // Esposti perch\xE9 PDF stampabile e comanda usino LO STESSO raggruppamento/ordine (nessuno "scalino").
  return { create, group, esc, eur, catOf, inferCat, sortCats };
})();

</script>
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
  if (!r.ok) {
    // Mostra il MESSAGGIO del server (non il codice grezzo). Conserva lo stato in err.status.
    let msg = String(r.status);
    try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
    // 401 con token presente = sessione scaduta/non pi\xF9 valida: ripulisci e riporta al login,
    // cos\xEC invece di un generico "Errore" l'utente vede la schermata di accesso.
    if (r.status === 401 && state.token) {
      state.token = null; state.authed = false; store.set('token', null);
      try { showGate(); } catch {}
    }
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.json();
}
async function loadAll() {
  try {
    const [casate, eventi, risorse, sport, giochi, bussola, luoghi, contest, serate, socio, regolamenti, albo, rifiuti, campi] = await Promise.all([
      api('/casate'), api('/eventi'), api('/risorse'), api('/discipline/sport'),
      api('/discipline/giochi'), api('/bussola'), api('/luoghi').catch(() => SEED.luoghi),
      api('/contest/corrente').catch(() => SEED.contest),
      api('/serate').catch(() => SEED.serate),
      api('/tessera/' + state.tessera).catch(() => SEED.socio),
      api('/regolamenti').catch(() => ({ generali: [], discipline: [] })),
      api('/albo').catch(() => []),
      api('/rifiuti').catch(() => ({ tipi: [], calendari: [] })),
      api('/campi').catch(() => []),
    ]);
    state.data = { casate, eventi, risorse, sport, giochi, bussola, luoghi, contest: contest || null, serate: serate || [], regolamenti: regolamenti || { generali: [], discipline: [] }, albo: albo || [], rifiuti: rifiuti || { tipi: [], calendari: [] }, campi: campi || [] };
    state.socio = socio || SEED.socio;
    state.online = true;
  } catch (e) {
    state.data = { casate: SEED.casate, eventi: SEED.eventi, risorse: SEED.risorse, sport: SEED.sport, giochi: SEED.giochi, bussola: SEED.bussola, luoghi: SEED.luoghi, contest: SEED.contest, serate: SEED.serate, regolamenti: { generali: [], discipline: [] }, albo: [], rifiuti: { tipi: [], calendari: [] }, campi: [] };
    state.socio = SEED.socio;
    state.online = false;
  }
  document.getElementById('banner').classList.toggle('show', !state.online);
  applyProfileGating();
  // Se il socio ha gi\xE0 dato il consenso, riallinea la subscription push (nuovo dispositivo / dopo un deploy).
  if (state.token && state.socio && state.socio.notifiche_push) { subscribePush().catch(() => {}); }
}

// ---- Utility --------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ---- Navigazione ----------------------------------------------------------
// Residente (ex "utente non socio"): niente tornei n\xE9 Coppa, solo eventi/guida/prenotazioni.
// "Non competitore": chi NON \xE8 socio (n\xE9 socio-residente) non vede tornei/Coppa/casata.
function isVisitatore() { const t = String(state.socio?.tipo_profilo || ''); return !['socio', 'socio_residente'].includes(t); }
function isSocio() { const t = String(state.socio?.tipo_profilo || ''); return t === 'socio' || t === 'socio_residente'; }
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
  $('#greetSub').textContent = s.casata ? (T('Casata') + ' ' + s.casata) : T('Benvenuto alla Bussola');
  $('#casataNm').textContent = s.casata || '\u2014';
  $('#casataSh').style.background = s.colore || '#2E6DA4';
}
function evCardHTML(e, withAction) {
  const action = withAction && e.azione
    ? \`<button class="btn gold sm" data-ev="\${e.chiave}" data-act="\${e.azione}">\${e.azione==='sheet-vinile'?T('Proponi'):(e.azione==='sheet-openmic'?T('Salgo'):(e.azione==='go-coppa'?T('Coppa'):T('Info')))}</button>\`
    : \`<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>\`;
  const dlBits = [esc(e.giorno)];
  if (e.ora_inizio) dlBits.push(esc(e.ora_inizio));
  if (e.ambiente) dlBits.push(esc(e.ambiente));
  const dl = dlBits.join(' \xB7 ');
  const meta = [];
  if (e.tipologia) meta.push(\`<span class="ev-ty" style="background:\${e.colore||'var(--navy)'}">\${esc(e.tipologia)}</span>\`);
  if (e.artista) meta.push(\`<span class="ev-ar">\u{1F3A4} \${esc(e.artista)}</span>\`);
  const costo = Number(e.costo || 0);
  if (costo > 0) meta.push(\`<span class="ev-co">\u{1F39F}\uFE0F \u20AC \${costo.toFixed(2)}</span>\`);
  const metaHTML = meta.length ? \`<div class="ev-meta">\${meta.join('')}</div>\` : '';
  return \`<div class="evcard" role="button" tabindex="0" data-open="\${e.chiave}"><span class="stripe" style="background:\${e.colore}"></span><div class="body"><div class="dl">\${dl}</div><h4>\${esc(e.titolo)}</h4><p>\${esc(e.sottotitolo)}</p>\${metaHTML}</div><div class="cta">\${action}</div></div>\`;
}
function renderHome() {
  const evs = state.data.eventi;
  // Il "benvenuto" salta il luned\xEC vuoto: mostra la prima serata con attivit\xE0.
  const first = evs.find(e => e.tipo !== 'libero' && e.chiave !== 'lun') || evs[0];
  const hero = evs.find(e => e.chiave === 'gio') || evs[3] || evs[0];
  $('#s-home').innerHTML = \`
    <div class="welcome"><div class="wl"><div class="eyebrow">\${T('Benvenuti alla Bussola')}</div><h3>\${esc(first.giorno)} \xB7 \${esc(first.titolo)}</h3><p>\${esc(first.sottotitolo)}</p></div><button class="btn gold sm" data-open="\${first.chiave}">\${T('Vedi')}</button></div>
    <div class="hero" data-open="\${hero.chiave}" role="button" tabindex="0"><div class="eyebrow">\${T('Stasera alla Bussola')}</div><h2 class="serif">\${esc(hero.titolo)}</h2><p>\${esc(hero.sottotitolo)}</p><button class="btn gold" data-book="tavolo">\${esc(hero.cta)}</button></div>
    \${hostCardsHTML()}
    <div class="sect-title">\${T('Prenota')}</div>
    <div class="pgrid">
      <div class="ptile" role="button" tabindex="0" data-campi=""><div class="ic">\u{1F3BE}</div><b>\${T('Campi')}</b><span>\${T('prenota o partita')}</span></div>
      <div class="ptile" role="button" tabindex="0" data-partite=""><div class="ic">\u{1F465}</div><b>\${T('Partite aperte')}</b><span>\${T('unisciti')}</span></div>
      <div class="ptile" role="button" tabindex="0" data-book="cowo"><div class="ic">\u{1F4BB}</div><b>\${T('Coworking')}</b><span>\${T('postazione')}</span></div>
      <div class="ptile" role="button" tabindex="0" data-ordina=""><div class="ic">\u{1F354}</div><b>\${T('Ordina')}</b><span>\${T('bar & garden')}</span></div>
    </div>
    \${serateSectionHTML()}
    <div class="sect-title">\${T('Questa settimana')}</div>
    <div>\${evs.map(e => evCardHTML(e, true)).join('')}</div><div style="height:6px"></div>\`;
}
function serateSectionHTML() {
  const list = state.data.serate || [];
  if (!list.length) return '';
  return \`<div class="sect-title">\${T('Serate su prenotazione')}</div>
    <div>\${list.map(s => \`<div class="evcard" role="button" tabindex="0" data-serata="\${s.id}">
      <span class="stripe" style="background:#b14a35"></span>
      <div class="body"><div class="dl">\${esc(s.quando || '')}</div><h4>\${esc(s.titolo)}</h4><p>\u20AC \${esc(String(s.quota))} \${T('a persona')}\${s.posti_liberi != null ? \` \xB7 \${s.posti_liberi} \${T('posti')}\` : ''}</p></div>
      <div class="cta"><button class="btn gold sm" data-serata="\${s.id}">\${T('Prenota')}</button></div></div>\`).join('')}</div>\`;
}
function renderEventi() {
  $('#s-eventi').innerHTML = \`
    <div class="eyebrow" style="margin:4px 2px 2px">\${T('Il cartellone')}</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:4px">\${T('Il programma')}</h2>
    <p class="tiny muted" style="margin-bottom:12px">\${T('Tocca una serata per i dettagli e per prenotare.')}</p>
    <div>\${state.data.eventi.map(e => evCardHTML(e, false)).join('')}</div>
    <div class="note">\${T('Il pomeriggio \xE8 dello sport e delle famiglie; la sera, gli spettacoli che accompagnano la cena.')}</div>\`;
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
      <div class="eyebrow" style="color:#ffe1ac">\${T('Serata dei Clan \xB7 Contest')}\${ct.settimana ? ' \xB7 ' + esc(ct.settimana) : ''}</div>
      <h2 class="serif" style="font-size:1.3rem">\${esc(ct.titolo)}</h2>
      <p style="font-size:.8rem; opacity:.95">\${esc((ct.brief || '').slice(0, 90))}\${(ct.brief || '').length > 90 ? '\u2026' : ''}</p>
      <button class="btn gold sm" style="align-self:flex-start; margin-top:8px">\${T('Apri il contest')}</button>
    </div>\` : '';
  const capCard = isCap ? \`<div class="card" style="background:linear-gradient(135deg,#8a5a12,#6b4406); color:#fff; border:none; margin-top:12px">
      <div class="eyebrow" style="color:#ffe9c2">\${T('Strumenti del capitano')} \xB7 \${esc(mine)}</div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
        <button class="btn sm" style="background:#fff; color:var(--navy); flex:1" data-cap="convoca">\u{1F4E3} \${T('Convoca la casata')}</button>
        <button class="btn sm" style="background:rgba(255,255,255,.2); color:#fff; flex:1" data-cap="serata">\u{1F3C6} \${T('Serata dei Clan')}</button>
      </div></div>\` : '';
  $('#s-coppa').innerHTML = \`
    <div class="eyebrow" style="margin:4px 2px 2px">\${T('La comunit\xE0')}</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">\${T('Coppa delle Casate')}</h2>
    <div class="myclan"><div class="shield" style="background:\${myClan.colore}">\${esc(mine[0]||'A')}</div><div class="info"><h3>\${esc(mine)}</h3><p>\${T('La tua casata')} \xB7 \${esc(myClan.motto||'')}</p></div><div class="posbig"><div class="n">\${myPos||'\u2014'}\xB0</div><div class="l">\${T('posto')}</div></div></div>
    \${contestCard}\${capCard}
    <div class="card" style="margin-top:12px"><div class="eyebrow" style="color:var(--navy)">\${T('Classifica generale')}</div><div style="margin-top:6px">\${sorted.map((c,i)=>\`<div class="rank"><div class="rn">\${i+1}</div><div class="sh" style="background:\${c.colore}"></div><div class="nm">\${esc(c.nome)}</div><div class="bar"><span style="width:\${Math.round(c.punti/max*100)}%; background:\${c.colore}"></span></div><div class="pt">\${c.punti}</div></div>\`).join('')}</div></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--teal); font-size:1.4rem">\u{1F3BE}</div><div style="flex:1"><b>\${T('Campionati sport')}</b><p class="tiny muted">\${T('Gironi, calendario e risultati.')}</p></div><button class="btn navy sm" data-go="sport">\${T('Apri')}</button></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--plum); font-size:1.4rem">\u{1F0CF}</div><div style="flex:1"><b>\${T('Giochi da Tavolo')}</b><p class="tiny muted">\${T('Burraco, scala 40, briscola, scacchi.')}</p></div><button class="btn navy sm" data-go="giochi">\${T('Apri')}</button></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--gold); font-size:1.4rem">\u{1F4DC}</div><div style="flex:1"><b>\${T("Regolamenti & Albo d'Oro")}</b><p class="tiny muted">\${T('Regole di Coppa, Contest e Proposte; le edizioni passate.')}</p></div><button class="btn navy sm" data-sheet="regolamenti">\${T('Apri')}</button></div>\`;
}
function openRegolamenti() {
  const r = state.data.regolamenti || { generali: [], discipline: [] };
  const albo = state.data.albo || [];
  const blocco = (titolo, testo) => \`<div class="card" style="margin-top:10px"><div class="eyebrow" style="color:var(--navy)">\${esc(titolo)}</div><p class="tiny" style="white-space:pre-wrap; margin-top:4px">\${esc(testo || '\u2014')}</p></div>\`;
  const gen = (r.generali || []).map(x => blocco(x.titolo, x.testo)).join('');
  const disc = (r.discipline || []).map(d => blocco(\`\${d.nome}\${d.data_inizio ? ' \xB7 ' + d.data_inizio + (d.data_fine ? '\u2192' + d.data_fine : '') : ''}\`, d.regolamento)).join('');
  const alboHtml = albo.length ? \`<div class="sect-title" style="margin-top:14px">\${T("Albo d'Oro")}</div><div class="card" style="padding:4px 14px">\${albo.map(e => \`<div class="matchrow"><div class="vs">\${esc(e.disciplina_nome)}<div class="ct">\${esc((e.data_inizio || '') + (e.data_fine ? '\u2192' + e.data_fine : ''))}</div></div><div class="sc">\${esc(e.vincitore || '\u2014')}</div></div>\`).join('')}</div>\` : '';
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${T('Regole & storia')}</div><h2>\${T('Regolamenti')}</h2>
    <p class="sub">\${T('Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.')}</p>
    \${gen || \`<p class="tiny muted">\${T('Nessun regolamento generale.')}</p>\`}
    \${disc ? \`<div class="sect-title" style="margin-top:14px">\${T('Discipline')}</div>\` + disc : ''}
    \${alboHtml}
    <button class="btn navy block" style="margin-top:14px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
const RIF_DAYS = [['lun','Lun'],['mar','Mar'],['mer','Mer'],['gio','Gio'],['ven','Ven'],['sab','Sab'],['dom','Dom']];
function rifTextColor(hex){ if(!hex) return '#fff'; const h=hex.replace('#',''); if(h.length<6) return '#fff'; const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),bl=parseInt(h.slice(4,6),16); return (r*0.299+g*0.587+bl*0.114)>150?'#1a1a1a':'#fff'; }
function rifiutiHTML(){
  const data = state.data.rifiuti || { tipi: [], calendari: [] };
  const tipi = data.tipi || [];
  const cal = data.calendari || [];
  if (!tipi.length && !cal.length) {
    return \`<div class="card"><p class="tiny muted">\${T('Calendario non ancora disponibile.')}</p></div>\`;
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
      return \`<div style="flex:1;min-width:30px;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:.6rem;font-weight:700;color:#5c6a73">\${T(lbl)}</div>\${pills}</div>\`;
    }).join('');
    const info = [];
    if (c.inizio_conf || c.fine_conf) info.push(\`\${T('Conferimento')} \${esc(c.inizio_conf||'')}\${c.fine_conf?'\u2013'+esc(c.fine_conf):''}\`);
    if (c.ora_ritiro) info.push(\`\${T('Ritiro dalle')} \${esc(c.ora_ritiro)}\`);
    return \`<div class="card" style="margin-bottom:10px"><div style="font-weight:700;font-size:.85rem;color:var(--navy);margin-bottom:10px">\${esc(c.periodo)}</div><div style="display:flex;gap:3px">\${cells}</div>\${legendChips}\${info.length?\`<div class="tiny muted" style="margin-top:9px">\${info.join(' \xB7 ')}</div>\`:''}</div>\`;
  }).join('');
  return \`<div>\${periods || \`<div class="card"><p class="tiny muted">\${T('Nessun periodo configurato.')}</p></div>\`}</div>\`;
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
    <div class="eyebrow" style="margin:4px 2px 2px">\${T('Guida del residence')}</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">Bussola Residence</h2>
    <div class="sect-title" style="margin-top:2px">\${esc(tr('siamo_qui'))}</div>
    <div class="card" style="padding:4px 14px">\${siamoQui}</div>
    <div class="card" style="background:#fbf4e6; border-color:#ecdcbd; margin-top:11px">
      <div class="benefit" style="border-color:#ecdcbd"><span style="font-size:1.1rem">\u{1F92B}</span><div><b>\${T('Silenzio pomeridiano')}</b><p style="color:#5c4d2a">\${esc(b.orari?.[0]?.dettaglio||'14:00\u201317:00')}</p></div></div>
      <div class="benefit"><span style="font-size:1.1rem">\u{1F319}</span><div><b>\${T('Silenzio notturno')}</b><p style="color:#5c4d2a">\${esc(b.orari?.[1]?.dettaglio||'dopo le 23:30')}</p></div></div>
    </div>
    <div class="sect-title">\${T('Raccolta rifiuti')}</div>\${rifiutiHTML()}
    <div class="sect-title">\${T('Numeri utili & servizi')}</div><div class="card" style="padding:4px 14px">\${rows(b.servizi)}</div>
    <div class="sect-title">\${T('Cosa vedere')}</div><div class="card" style="padding:4px 14px">\${rows(b.vedere)}</div>
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
  const conv = s.next[0] || { a: state.socio.casata, b: '\u2014', wh: T('prossimamente'), court: '' };
  const matchLabel = \`\${conv.a} vs \${conv.b}\`;
  const isOspite = state.socio.tipo_profilo === 'ospite_temporaneo';
  let personal;
  if (st === 'ok') {
    personal = \`<div class="card" style="background:linear-gradient(135deg,#5f9a5c,#3f6b3d); color:#fff; border:none"><div class="eyebrow" style="color:#e8f3e2">\${T('Presenza confermata \u2713')}</div><div style="margin-top:6px"><b style="font-size:.9rem">\${esc(matchLabel)}</b><div class="tiny" style="opacity:.9">\${esc(conv.wh)} \xB7 \${esc(conv.court)}</div></div></div>\`;
  } else if (!isOspite && state.rifiuti >= 3) {
    personal = \`<div class="card" style="background:linear-gradient(135deg,#c0553f,#9c3f2c); color:#fff; border:none"><div class="eyebrow" style="color:#ffd9cf">\${T('Convocazione vincolante')}</div><div style="margin-top:6px"><b>\${esc(matchLabel)}</b><div class="tiny" style="opacity:.9">\${esc(conv.wh)} \xB7 \${esc(conv.court)}</div></div><div class="tiny" style="margin-top:8px">\${T('Hai gi\xE0 declinato tre volte in stagione: questa convocazione \xE8 vincolante.')}</div><button class="btn gold sm" style="margin-top:10px" data-conv="ok" data-key="\${key}">\${T('Confermo')}</button></div>\`;
  } else if (st === 'no') {
    personal = \`<div class="card" style="display:flex; align-items:center; gap:12px"><div style="flex:1"><b>\${T('Hai declinato')}</b><p class="tiny muted">\${esc(matchLabel)}\${isOspite?'' :\` \xB7 \${T('dinieghi')} \${state.rifiuti}/3\`}</p></div><button class="btn gold sm" data-conv="ok" data-key="\${key}">\${T('Ci ripenso')}</button></div>\`;
  } else {
    const footer = isOspite
      ? \`<div class="tiny" style="opacity:.85; margin-top:9px">\${T('Sei nostro ospite: partecipa quando vuoi, nessun obbligo.')}</div>\`
      : \`<div class="tiny" style="opacity:.8; margin-top:9px">\${T('Dinieghi:')} \${state.rifiuti}/3 \xB7 \${T('diventa vincolante solo dopo il terzo')}</div>\`;
    personal = \`<div class="card" style="background:linear-gradient(135deg,var(--navy),#1d4a6e); color:#fff; border:none"><div class="eyebrow" style="color:#ffe1ac">\${T('La tua casata ti invita')}</div><div style="margin-top:6px"><b>\${esc(matchLabel)}</b><div class="tiny" style="opacity:.85">\${esc(conv.wh)} \xB7 \${esc(conv.court)}</div></div><div style="display:flex; gap:8px; margin-top:12px"><button class="btn gold sm" data-conv="ok" data-key="\${key}">\${T('Disponibile')}</button><button class="btn ghost sm" style="color:#fff; border-color:rgba(255,255,255,.45)" data-conv="no" data-key="\${key}">\${T('Non disponibile')}</button></div>\${footer}</div>\`;
  }
  const gironi = s.gironi.map(g => \`<div class="card"><div class="eyebrow" style="color:var(--navy)">\${esc(g.nome)}</div><table class="gtable"><thead><tr><th style="text-align:left; padding-left:2px">\${T('Squadra')}</th><th>\${T('PG')}</th><th>\${T('V')}</th><th>\${T('Pt')}</th></tr></thead><tbody>\${g.rows.map((r,i)=>\`<tr><td class="team"><span class="gpos">\${i+1}</span><span class="d" style="background:\${r.c}"></span>\${esc(r.t)}</td><td>\${r.pg}</td><td>\${r.v}</td><td style="font-weight:700; color:var(--navy)">\${r.pt}</td></tr>\`).join('')}</tbody></table></div>\`).join('');
  const next = \`<div class="sect-title">\${T('Prossime partite')}</div><div class="card" style="padding:4px 14px">\${s.next.map(m=>\`<div class="matchrow"><div class="wh">\${esc(m.wh)}</div><div class="vs">\${esc(m.a)} <small>vs</small> \${esc(m.b)}<div class="ct">\${esc(m.court)}</div></div></div>\`).join('')||\`<p class="tiny muted" style="padding:8px 0">\${T('Calendario in aggiornamento.')}</p>\`}</div>\`;
  const res = \`<div class="sect-title">\${T('Risultati recenti')}</div><div class="card" style="padding:4px 14px">\${s.results.map(m=>\`<div class="matchrow"><div class="vs">\${esc(m.a)} <small>vs</small> \${esc(m.b)}</div><div class="sc">\${esc(m.s)}</div></div>\`).join('')||\`<p class="tiny muted" style="padding:8px 0">\${T('Nessun risultato ancora.')}</p>\`}</div>\`;
  const note = \`<div class="note">\${T('Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.')}</div>\`;
  const head = \`<div class="eyebrow" style="margin:4px 2px 2px">\${dom==='sport'?T('Campionati sociali'):T('Tornei')+' \xB7 Casa di Carta'}</div><h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">\${dom==='sport'?T('Sport & Tornei'):T('Giochi da Tavolo')}</h2>\`;
  el.innerHTML = head + disc + personal + gironi + next + res + note;
}

// ---- Overlay / sheet ------------------------------------------------------
function setSheet(html) { $('#sheetbox').innerHTML = html; }
function showOv() { $('#ov').classList.add('show'); $('.sheet').scrollTop = 0; }
function closeOv() { $('#ov').classList.remove('show'); if (!state.token) showGate(); }
function openEvent(k) {
  const e = state.data.eventi.find(x => x.chiave === k); if (!e) return;
  let btn;
  if (e.azione === 'go-coppa') btn = \`<button class="btn gold block" data-go="coppa">\${esc(e.cta)}</button>\`;
  else if (e.azione) btn = \`<button class="btn gold block" data-sheet="\${e.azione}">\${esc(e.cta)}</button>\`;
  else btn = \`<button class="btn gold block" data-confirm="\${esc(e.titolo)}">\${esc(e.cta)}</button>\`;
  const eyebrowBits = [esc(e.giorno)];
  if (e.ora_inizio) eyebrowBits.push(esc(e.ora_inizio));
  if (e.ambiente) eyebrowBits.push(esc(e.ambiente));
  const info = [];
  if (e.tipologia) info.push(\`<span class="ev-ty" style="background:\${e.colore||'var(--navy)'}">\${esc(e.tipologia)}</span>\`);
  if (e.artista) info.push(\`<span class="ev-ar">\u{1F3A4} \${esc(e.artista)}</span>\`);
  const costo = Number(e.costo || 0);
  info.push(\`<span class="ev-co">\u{1F39F}\uFE0F \${costo > 0 ? '\u20AC ' + costo.toFixed(2) : T('Ingresso libero')}</span>\`);
  const infoHTML = \`<div class="ev-meta" style="margin:6px 0 12px">\${info.join('')}</div>\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:\${e.colore}">\${eyebrowBits.join(' \xB7 ')}</div><h2>\${esc(e.titolo)}</h2>\${infoHTML}<p class="sub">\${esc(e.descrizione)}</p>\${btn}<button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
function openBooking(kind) {
  const b = state.data.risorse.find(r => r.chiave === kind) || SEED.risorse.find(r => r.chiave === kind);
  if (!b) return;
  const days = ['Oggi','Domani','Sab','Dom','Lun'];
  const capNota = b.tipo === 'coworking' ? \`<div class="note">\${T('Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.')}</div>\` : '';
  const personeField = b.tipo === 'tavolo'
    ? \`<div class="field"><label>\${T('Quante persone')}</label><div class="chips" data-group="pers">\${[1,2,3,4,5,6].map((n,i)=>\`<button class="chip\${i===1?' sel':''}" data-chip>\${n}</button>\`).join('')}</div></div>\` : '';
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\${T('Prenotazione')}</div><h2>\${esc(b.nome)}</h2><p class="sub">\${esc(b.sottotitolo)}</p>
    <div class="field"><label>\${T('Giorno')}</label><div class="chips" data-group="day">\${days.map((d,i)=>\`<button class="chip\${i===0?' sel':''}" data-chip>\${T(d)}</button>\`).join('')}</div></div>
    <div class="field"><label>\${T('Turno')}</label><div class="chips" data-group="slot">\${b.slots.map((s,i)=>\`<button class="chip\${i===0?' sel':''}" data-chip>\${esc(s)}</button>\`).join('')}</div></div>
    \${personeField}\${capNota}\${b.nota?\`<div class="note">\${esc(b.nota)}</div>\`:''}
    <button class="btn gold block" style="margin-top:10px" data-do-book="\${b.chiave}">\${T('Conferma prenotazione')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Annulla')}</button>\`);
  showOv();
}
// ---- Host / Casa mia ----
function hostCardsHTML() {
  const s = state.socio || {};
  const t = s.tipo_profilo;
  let out = '';
  if (s.ha_casa) out += \`<div class="card" role="button" tabindex="0" data-casamia="" style="display:flex; align-items:center; gap:12px; background:linear-gradient(135deg,#12324F,#256b65); color:#fff; border:none; margin-bottom:10px"><div style="font-size:1.5rem">\u{1F3E1}</div><div style="flex:1"><b>\${T('Casa mia')}</b><p class="tiny" style="opacity:.9">\${T('Come raggiungere la casa e le regole del soggiorno.')}</p></div><span style="font-size:1.2rem">\u203A</span></div>\`;
  // Visitatore non ancora collegato: qui indica chi lo ospita (campo di ricerca dell'host).
  if (t === 'ospite_temporaneo' && !s.ha_casa) out += \`<div class="card" role="button" tabindex="0" data-collega="" style="display:flex; align-items:center; gap:12px; margin-bottom:10px"><div style="font-size:1.5rem">\u{1F3E1}</div><div style="flex:1"><b>\${T('Collega la tua casa')}</b><p class="tiny muted">\${T('Indica chi ti ospita per vedere indicazioni e regole del soggiorno.')}</p></div><button class="btn navy sm" data-collega="">\${T('Collega')}</button></div>\`;
  // Host attivo OPPURE Residente/Socio-residente che pu\xF2 diventarlo (aggiungendo la prima casa).
  if (s.is_host || ['residente', 'socio_residente'].includes(t)) out += \`<div class="card" role="button" tabindex="0" data-lemiecase="" style="display:flex; align-items:center; gap:12px; margin-bottom:10px"><div style="font-size:1.5rem; color:var(--gold)">\u{1F511}</div><div style="flex:1"><b>\${T('Le mie case')}</b><p class="tiny muted">\${s.is_host ? T('Gestisci le case vacanza che ospiti nel residence.') : T('Aggiungi la tua casa vacanza: potrai accogliere i visitatori.')}</p></div><button class="btn navy sm" data-lemiecase="">\${T('Apri')}</button></div>\`;
  return out;
}
// Visitatore: cerca il proprio host e invia la richiesta (stesso flusso della registrazione, ma sempre disponibile).
async function openCollegaHost() {
  let st = null; try { st = await api('/auth/aggancio/stato'); } catch {}
  // Gi\xE0 collegato (host ha confermato): scarica e mostra "Casa mia".
  if (st && st.collegato) { await refreshSocio(true); return openCasaMia(); }
  if (st && st.richiesta && st.richiesta.stato === 'in_attesa') {
    const hn = (st.richiesta.host_nome || '') + ' ' + (st.richiesta.host_cognome || '');
    setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\u{1F4E8} \${T('Richiesta inviata')}</div><h2>\${T('In attesa di conferma')}</h2>
      <p class="sub">\${T('Abbiamo avvisato')} <b>\${esc(hn.trim())}</b>. \${T('Quando confermer\xE0, comparir\xE0 "Casa mia" con tutte le indicazioni della struttura.')}</p>
      <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
    showOv(); return;
  }
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u{1F3E1} \${T('Il tuo host')}</div><h2>\${T('Chi ti ospita?')}</h2>
    <p class="sub">\${T('Cerca chi ti ospita: ricever\xE0 una notifica e, se conferma, vedrai "Casa mia".')}</p>
    <div class="field"><label>\${T('Nome o cognome dell\\'host')}</label><input id="reg_hq" placeholder="\${T('es. Chiara')}" autocomplete="off"></div>
    <div id="reg_hres"></div>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
  const inp = $('#reg_hq'); if (inp) { inp.oninput = () => regHostCerca(inp.value); setTimeout(() => inp.focus(), 60); }
}
async function openCasaMia() {
  let d;
  try { d = await api('/auth/casa-mia'); } catch (e) { okThen(e.status === 423 ? T('Dati della struttura non disponibili') : (e.message || 'Errore'), false); return; }
  if (!d || !d.collegato) { okThen(T('Casa mia'), false); return; }
  const st = d.struttura;
  const arrivo = (st.lat && st.lng)
    ? \`<div class="matchrow" role="button" tabindex="0" data-map="\${st.lat},\${st.lng}" style="cursor:pointer"><div style="flex:1"><b style="font-size:.9rem">\u{1F4CD} \${esc(st.nome)}</b><div class="ct">\${T('Isolato')} \${esc(st.isolato||'\u2014')} \xB7 \${T('Numero')} \${esc(st.numero||'\u2014')}</div></div><span style="color:var(--teal);font-size:1.1rem">\u2197</span></div>\`
    : \`<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">\${esc(st.nome)}</b><div class="ct">\${T('Isolato')} \${esc(st.isolato||'\u2014')} \xB7 \${T('Numero')} \${esc(st.numero||'\u2014')}</div></div></div>\`;
  const sogg = (d.soggiorno && (d.soggiorno.dal || d.soggiorno.al)) ? \`<div class="note">\${T('Il tuo soggiorno')}: \${T('dal')} \${esc(d.soggiorno.dal||'\u2014')} \${T('al')} \${esc(d.soggiorno.al||'\u2014')}</div>\` : '';
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\u{1F3E1} \${esc(st.nome)}</div><h2>\${T('Casa mia')}</h2>
    <div class="sect-title" style="margin-top:6px">\${T('Come arrivare')}</div><div class="card" style="padding:4px 14px">\${arrivo}</div>
    <div class="sect-title">\${T('Orario di check-out')}</div><div class="card"><b style="font-size:1.1rem; color:var(--navy)">\u{1F559} \${esc(st.check_out||'\u2014')}</b></div>
    <div class="sect-title">\${T('Regole della casa')}</div><div class="card"><p class="tiny" style="white-space:pre-wrap">\${esc(st.regole||'\u2014')}</p></div>
    <div class="card" style="padding:8px 14px"><p class="tiny muted">CIR \${esc(st.cir||'\u2014')} \xB7 CIN \${esc(st.cin||'\u2014')}</p></div>
    \${sogg}
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
async function openLeMieCase() {
  let d;
  try { d = await api('/auth/host/strutture'); } catch (e) { if (e.status !== 401) okThen(e.message || 'Errore', false); return; }
  const list = (d.strutture || []).map(st => st.ko
    ? \`<div class="matchrow"><div style="flex:1"><b>\u26A0\uFE0F \${T('Dati della struttura non disponibili')}</b></div></div>\`
    : \`<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">\u{1F3E1} \${esc(st.nome)}</b><div class="ct">\${T('Orario di check-out')} \${esc(st.check_out||'\u2014')} \xB7 CIR \${esc(st.cir||'\u2014')}</div></div><div style="display:flex; gap:6px"><button class="btn ghost sm" data-strutt-edit="\${st.id}">\${T('Modifica')}</button><button class="btn danger sm" data-strutt-del="\${st.id}">\u{1F5D1}</button></div></div>\`).join('');
  window.__strutture = (d.strutture || []).filter(x => !x.ko);
  // Richieste di aggancio in attesa (le manda il visitatore che si \xE8 auto-registrato) + visitatori gi\xE0 collegati.
  let richieste = [], ospiti = [];
  try { richieste = (await api('/auth/host/richieste')).richieste || []; } catch { richieste = []; }
  try { ospiti = (await api('/auth/host/ospiti')).ospiti || []; } catch { ospiti = []; }
  const nomeStrutt = (id) => { const s = (window.__strutture || []).find(x => String(x.id) === String(id)); return s ? s.nome : ''; };
  const reqList = richieste.map(r => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">\u{1F464} \${esc(r.nome)} \${esc(r.cognome)}</b><div class="ct">\${T('dice di essere tuo ospite')}\${r.soggiorno_dal?' \xB7 '+esc(r.soggiorno_dal)+(r.soggiorno_al?' \u2192 '+esc(r.soggiorno_al):''):''}</div></div><div style="display:flex; gap:6px"><button class="btn gold sm" data-req-ok="\${r.id}">\u2713 \${T('Conferma')}</button><button class="btn ghost sm" data-req-no="\${r.id}">\u2715</button></div></div>\`).join('');
  const ospList = ospiti.map(o => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">\u{1F464} \${esc(o.nome)} \${esc(o.cognome)}</b><div class="ct">\${o.struttura_id?'\u{1F3E1} '+esc(nomeStrutt(o.struttura_id)):''}\${o.soggiorno_dal?' \xB7 '+esc(o.soggiorno_dal)+(o.soggiorno_al?' \u2192 '+esc(o.soggiorno_al):''):''}</div></div><div style="display:flex; gap:6px"><button class="btn ghost sm" data-osp-scollega="\${o.id}">\${T('Scollega')}</button></div></div>\`).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u{1F511} \${T('Le mie case')}</div><h2>\${T('Le tue strutture')}</h2>
    <p class="sub">\${T('Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.')}</p>
    <div class="card" style="padding:4px 14px">\${list || \`<p class="tiny muted" style="padding:8px 0">\${T('Non hai ancora aggiunto strutture.')}</p>\`}</div>
    \${(d.strutture||[]).length < 3 ? \`<button class="btn gold block" style="margin-top:10px" data-strutt-new="">+ \${T('Aggiungi struttura')}</button>\` : ''}
    \${richieste.length ? \`<div class="sect-title" style="margin-top:16px">\${T('Richieste in attesa')}</div>
    <p class="sub">\${T('Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.')}</p>
    <div class="card" style="padding:4px 14px">\${reqList}</div>\` : ''}
    <div class="sect-title" style="margin-top:16px">\${T('I miei visitatori')}</div>
    <p class="sub">\${T('Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.')}</p>
    <div class="card" style="padding:4px 14px">\${ospList || \`<p class="tiny muted" style="padding:8px 0">\${T('Nessun visitatore collegato.')}</p>\`}</div>
    <button class="btn ghost block" style="margin-top:12px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
async function hostApprova(id) {
  const strutture = window.__strutture || [];
  // Serve almeno una casa a cui collegare l'ospite: se manca, guido l'host ad aggiungerla.
  if (!strutture.length) { okThen(T('Aggiungi prima la tua casa, poi conferma l\\'ospite.'), false); setTimeout(openLeMieCase, 300); return; }
  let sid = strutture[0].id;
  if (strutture.length > 1) {
    const nomi = strutture.map((s, i) => \`\${i + 1}. \${s.nome}\`).join('\\n');
    const pick = prompt(T('A quale casa lo colleghi?') + '\\n' + nomi, '1');
    const idx = Math.max(1, Math.min(strutture.length, parseInt(pick || '1', 10))) - 1;
    sid = strutture[idx].id;
  }
  try { await api('/auth/host/richieste/' + id + '/approva', { method: 'POST', body: JSON.stringify({ struttura_id: sid }) }); }
  catch (e) { okThen(e.message || 'Errore', false); return; }
  okThen(T('Ospite collegato')); openLeMieCase();
}
async function hostRifiuta(id) {
  try { await api('/auth/host/richieste/' + id + '/rifiuta', { method: 'POST', body: JSON.stringify({}) }); } catch { okThen('Errore', false); return; }
  openLeMieCase();
}
async function ospiteScollega(id) {
  if (!confirm(T('Scollegare questo visitatore dalla casa?'))) return;
  try { await api('/auth/host/ospiti/' + id + '/scollega', { method: 'POST', body: JSON.stringify({}) }); } catch { okThen('Errore', false); return; }
  openLeMieCase();
}
function openStrutturaForm(id) {
  const st = (window.__strutture || []).find(x => String(x.id) === String(id)) || {};
  const f = (k, ph) => \`<div class="field"><label>\${ph}</label><input id="st_\${k}" value="\${esc(st[k] ?? '')}"></div>\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${id ? T('Modifica') : T('Aggiungi struttura')}</div><h2>\${T('Nome struttura')}</h2>
    \${f('nome', T('Nome struttura'))}
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>\${T('Isolato')}</label><input id="st_isolato" value="\${esc(st.isolato ?? '')}"></div><div class="field" style="flex:1"><label>\${T('Numero')}</label><input id="st_numero" value="\${esc(st.numero ?? '')}"></div></div>
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>Lat</label><input id="st_lat" value="\${esc(st.lat ?? '')}"></div><div class="field" style="flex:1"><label>Lng</label><input id="st_lng" value="\${esc(st.lng ?? '')}"></div></div>
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>CIR</label><input id="st_cir" value="\${esc(st.cir ?? '')}"></div><div class="field" style="flex:1"><label>CIN</label><input id="st_cin" value="\${esc(st.cin ?? '')}"></div></div>
    <div class="field"><label>\${T('Orario di check-out')}</label><input id="st_check_out" value="\${esc(st.check_out ?? '')}" placeholder="10:00"></div>
    <div class="field"><label>\${T('Regole della casa')}</label><textarea id="st_regole" rows="4" style="width:100%; padding:8px 10px; border:1px solid #cbd2d8; border-radius:9px">\${esc(st.regole ?? '')}</textarea></div>
    <button class="btn gold block" data-strutt-save="\${id || ''}">\${T('Salva')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-lemiecase="">\${T('Annulla')}</button>\`);
  showOv();
}
async function strutturaSalva(id) {
  const g = (k) => (document.getElementById('st_' + k) || {}).value || '';
  const body = { nome: g('nome'), isolato: g('isolato'), numero: g('numero'), lat: g('lat'), lng: g('lng'), cir: g('cir'), cin: g('cin'), check_out: g('check_out'), regole: g('regole') };
  if (!body.nome.trim()) { okThen(T('Nome struttura'), false); return; }
  try { await api('/auth/host/strutture' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); } catch (e) { okThen('Errore', false); return; }
  okThen(T('Salva')); openLeMieCase();
}
async function strutturaElimina(id) {
  if (!confirm('Eliminare la struttura?')) return;
  try { await api('/auth/host/strutture/' + id, { method: 'DELETE' }); } catch { okThen('Errore', false); return; }
  openLeMieCase();
}

// ---- Campi (prenotazione slot + partite aperte) ----
function campiDays() {
  const out = []; const g = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const base = new Date(); base.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++) { const d = new Date(base.getTime() + i * 86400000); const iso = d.toISOString().slice(0, 10); out.push({ iso, label: i === 0 ? T('Oggi') : i === 1 ? T('Domani') : \`\${T(g[d.getDay()])} \${d.getDate()}\` }); }
  return out;
}
const sportIcon = (s) => ({ pickleball: '\u{1F3BE}', soft_tennis: '\u{1F3BE}', calcetto: '\u26BD', beach: '\u{1F3D0}' }[s] || '\u{1F3BE}');
async function openCampi(campoId) {
  const campi = state.data.campi || [];
  if (!campi.length) { okThen(T('Prenotazione campi disponibile solo online'), false); return; }
  const sel = (campoId ? campi.find(c => c.id == campoId) : campi.find(c => c.id == state._campoSel)) || campi[0];
  state._campoSel = sel.id;
  const days = campiDays();
  if (!state._campoData || !days.some(d => d.iso === state._campoData)) state._campoData = days[0].iso;
  const data = state._campoData;
  let disp = { slots: [] };
  try { disp = await api(\`/campi/\${sel.id}/disponibilita?data=\${data}\`); } catch { }
  const courtChips = campi.map(c => \`<button class="chip\${c.id === sel.id ? ' sel' : ''}" data-campo-pick="\${c.id}">\${sportIcon(c.sport)} \${esc(c.nome)}</button>\`).join('');
  const dayChips = days.map(d => \`<button class="chip\${d.iso === data ? ' sel' : ''}" data-campo-date="\${d.iso}">\${esc(d.label)}</button>\`).join('');
  const slotHTML = (disp.slots || []).map(s => {
    if (s.stato === 'libero') return \`<div class="matchrow"><div style="flex:1"><b style="font-size:.95rem">\${esc(s.slot)}</b><div class="ct">\${T('Libero')}</div></div><div style="display:flex;gap:6px"><button class="btn gold sm" data-prenota="\${sel.id}|\${s.slot}">\${T('Prenota')}</button><button class="btn ghost sm" data-apri="\${sel.id}|\${s.slot}">\${T('Partita')}</button></div></div>\`;
    if (s.stato === 'partita') { const pieno = s.iscritti >= s.posti_totali; return \`<div class="matchrow"><div style="flex:1"><b style="font-size:.95rem">\${esc(s.slot)}</b><div class="ct">\u{1F465} \${T('Partita aperta')} \xB7 \${s.iscritti}/\${s.posti_totali}\${s.livello ? ' \xB7 ' + esc(s.livello) : ''}\${s.creatore ? ' \xB7 ' + esc(s.creatore) : ''}</div></div>\${pieno ? \`<span class="tag" style="background:#e6f2ea;color:#2e6b45;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">\${T('AL COMPLETO')}</span>\` : \`<button class="btn gold sm" data-unisci="\${s.partita_id}">\${T('Unisciti')}</button>\`}</div>\`; }
    return \`<div class="matchrow" style="opacity:.6"><div style="flex:1"><b style="font-size:.95rem">\${esc(s.slot)}</b><div class="ct">\${T('Occupato')} \xB7 \${esc(s.nome || T('prenotato'))}</div></div><span class="tag" style="background:#eee;color:#888;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">\${T('OCCUPATO')}</span></div>\`;
  }).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\${T('Prenotazione campi')}</div><h2>\${sportIcon(sel.sport)} \${esc(sel.nome)}</h2>
    <div class="field"><label>\${T('Campo')}</label><div class="chips">\${courtChips}</div></div>
    <div class="field"><label>\${T('Giorno')}</label><div class="chips">\${dayChips}</div></div>
    <div class="sect-title" style="margin-top:6px">\${T('Fasce orarie')}</div>
    <div class="card" style="padding:4px 14px">\${slotHTML || \`<p class="tiny muted" style="padding:8px 0">\${T('Nessuno slot per questa data.')}</p>\`}</div>
    <div class="note">\${T('\u201CPrenota\u201D blocca lo slot per te. \u201CPartita\u201D apre una <b>partita aperta</b>: altri soci possono unirsi finch\xE9 non \xE8 al completo.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
async function openPartiteAperte() {
  let list = [];
  try { list = await api('/campi/partite-aperte'); } catch { okThen(T('Disponibile solo online'), false); return; }
  const rows = list.map(p => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.92rem">\${sportIcon(p.sport)} \${esc(p.campo_nome)} \xB7 \${esc(p.slot)}</b><div class="ct">\${esc(dataBella(p.data))} \xB7 \${p.iscritti}/\${p.posti_totali}\${p.livello ? ' \xB7 ' + esc(p.livello) : ''}\${p.mancano ? \` \xB7 \${T(p.mancano > 1 ? 'mancano' : 'manca')} \${p.mancano}\` : ''}</div></div><button class="btn gold sm" data-unisci="\${p.id}">\${T('Unisciti')}</button></div>\`).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--plum)">\${T('Gioca con gli altri')}</div><h2>\u{1F465} \${T('Partite aperte')}</h2>
    <p class="sub">\${T('Unisciti a una partita con posti liberi: quando si completa, \xE8 fatta.')}</p>
    <div class="card" style="padding:4px 14px">\${rows || \`<p class="tiny muted" style="padding:8px 0">\${T('Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!')}</p>\`}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
function dataBella(iso) { try { const [y, m, d] = iso.split('-'); return \`\${d}/\${m}\`; } catch { return iso; } }
async function campoPrenota(v) {
  const [id, slot] = v.split('|');
  try { const r = await fetch(API_BASE + '/api/campi/' + id + '/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: state._campoData, slot }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { okThen(j.error || T('Prenotazione non riuscita'), false); return; } } catch { okThen(T('Errore di rete'), false); return; }
  okThen(\`\${T('Campo prenotato')} \xB7 \${dataBella(state._campoData)} \${slot}\`); openCampi(id);
}
async function campoApri(v) {
  const [id, slot] = v.split('|');
  const campo = (state.data.campi || []).find(c => c.id == id);
  const posti = campo ? campo.posti_default : 4;
  if (!confirm(\`\${T('Apri una partita alle')} \${slot} \${T('con')} \${posti} \${T('posti? Gli altri soci potranno unirsi.')}\`)) return;
  try { const r = await fetch(API_BASE + '/api/campi/' + id + '/partita', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: state._campoData, slot, posti_totali: posti }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { okThen(j.error || T('Non riuscito'), false); return; } } catch { okThen(T('Errore di rete'), false); return; }
  okThen(\`\${T('Partita aperta')} \xB7 \${dataBella(state._campoData)} \${slot}\`); openCampi(id);
}
async function campoUnisci(pid) {
  try { const r = await fetch(API_BASE + '/api/partite-aperte/' + pid + '/unisciti', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { okThen(j.error || T('Non riuscito'), false); return; } okThen(j.completa ? T('Partita al completo, ci vediamo in campo! \u{1F3BE}') : \`\${T('Iscritto!')} \${j.iscritti}/\${j.posti_totali}\`); } catch { okThen(T('Errore di rete'), false); return; }
  if (state._campoSel) openCampi(state._campoSel); else openPartiteAperte();
}
// ---- Tessera salvabile come immagine (logo + residence + nome + numero) ----
function tesseraCardSvg(s) {
  const nome = esc((s.nome || '') + ' ' + (s.cognome || '')).trim();
  const ruolo = esc(s.ruolo || 'Socio');
  const casata = s.casata ? esc(s.casata) : '';
  const code = esc(s.tessera_code || '');
  const qr = qrSvg(s.tessera_code || '').replace('<svg ', '<svg x="486" y="250" width="150" height="150" ');
  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 420" width="680" height="420">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12324F"/><stop offset="1" stop-color="#1d4a6e"/></linearGradient></defs>
    <rect width="680" height="420" rx="28" fill="url(#bg)"/>
    <g transform="translate(44,44)"><circle cx="24" cy="24" r="23" fill="none" stroke="#E0B44A" stroke-width="3"/><path d="M24 6 L29 24 L24 42 L19 24 Z" fill="#E0B44A"/><path d="M6 24 L24 19 L42 24 L24 29 Z" fill="#fff" opacity="0.85"/></g>
    <text x="104" y="60" fill="#fff" font-family="Georgia,serif" font-size="26" font-weight="700">BUSSOLA</text>
    <text x="104" y="82" fill="#E0B44A" font-family="Arial,sans-serif" font-size="13" letter-spacing="2">RESIDENCE \xB7 by KOIN\xC8</text>
    <text x="44" y="210" fill="#fff" font-family="Georgia,serif" font-size="40" font-weight="700">\${nome}</text>
    <text x="44" y="246" fill="#cfe0ee" font-family="Arial,sans-serif" font-size="17">\${ruolo}\${casata ? ' \xB7 Casata ' + casata : ''}</text>
    <text x="44" y="330" fill="#E0B44A" font-family="Arial,sans-serif" font-size="13" letter-spacing="1">TESSERA</text>
    <text x="44" y="360" fill="#fff" font-family="monospace" font-size="30" font-weight="700">\${code}</text>
    <rect x="470" y="234" width="182" height="182" rx="16" fill="#fff"/>
    \${qr}
  </svg>\`;
}
function downloadTessera() {
  const svg = tesseraCardSvg(state.socio || {});
  const durl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.onload = () => {
    const sc = 2, cv = document.createElement('canvas'); cv.width = 680 * sc; cv.height = 420 * sc;
    const ctx = cv.getContext('2d'); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0, 680, 420);
    cv.toBlob((png) => { if (!png) { okThen('Errore immagine', false); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(png); a.download = 'tessera_' + (state.socio?.tessera_code || 'bussola') + '.png'; a.click(); okThen(T('Tessera salvata nelle immagini')); }, 'image/png');
  };
  img.onerror = () => okThen('Errore immagine', false);
  img.src = durl;
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function installHintHTML() {
  const passo = isIOS()
    ? T('Su iPhone/iPad (Safari): tocca Condividi (\u2B06\uFE0F) in basso, poi \u201CAggiungi a Home\u201D.')
    : T('Su Android (Chrome): tocca il menu (\u22EE) in alto a destra, poi \u201CAggiungi a schermata Home\u201D / \u201CInstalla app\u201D.');
  return \`<div class="card"><b style="font-size:.9rem">\u{1F4F2} \${T('Tieni l\u2019app a portata di mano')}</b><p class="tiny muted" style="margin-top:4px">\${passo}</p><p class="tiny muted">\${T('Cos\xEC resta sul telefono con la sua icona, senza cercarla ogni volta.')}</p></div>\`;
}
function openInstallHint() {
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u{1F4F2} \${T('Installa l\u2019app')}</div><h2>\${T('Aggiungi alla schermata Home')}</h2>\${installHintHTML()}<button class="btn gold block" style="margin-top:10px" data-close>\${T('Ho capito')}</button>\`);
  showOv();
}
// ---- Scelta / cambio casata (socio) con tetto di 12 ----
async function openCasata(fromReg) {
  let d; try { d = await api('/auth/casate'); } catch { okThen('Errore', false); return; }
  const cards = (d.casate || []).map(c => \`<div class="matchrow"><div class="shield" style="width:34px;height:34px;min-width:34px;border-radius:9px;background:\${c.colore};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">\${esc((c.nome || 'A')[0])}</div><div style="flex:1;margin-left:10px"><b style="font-size:.9rem">\${esc(c.nome)}</b><div class="ct">\${esc(c.motto || '')} \xB7 \${c.soci}/\${c.capienza} \${T('soci')}</div></div>\${c.mia ? \`<span class="tag" style="background:var(--teal);color:#fff;padding:3px 9px;border-radius:10px;font-size:.62rem">\${T('la tua')}</span>\` : c.pieno ? \`<span class="tiny" style="color:var(--coral)">\${T('al completo')}</span>\` : \`<button class="btn gold sm" data-casata="\${c.id}">\${T('Scegli')}</button>\`}</div>\`).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u{1F6E1}\uFE0F \${T('La tua casata')}</div><h2>\${T('Scegli la casata')}</h2>
    <p class="sub">\${T('Ogni casata accoglie fino a 12 soci. Se \xE8 al completo, scegline un\u2019altra.')}</p>
    <div class="card" style="padding:4px 14px">\${cards || '<p class="tiny muted" style="padding:8px 0">\u2014</p>'}</div>
    <button class="btn ghost block" style="margin-top:10px" data-close>\${fromReg ? T('Pi\xF9 tardi') : T('Chiudi')}</button>\`);
  showOv();
}
async function scegliCasata(id) {
  let r; try { r = await api('/auth/scegli-casata', { method: 'POST', body: JSON.stringify({ casata_id: Number(id) }) }); }
  catch (e) { okThen(e.message || 'Errore', false); return; }
  if (state.socio) state.socio.casata = r.casata;
  okThen(\`\${T('Benvenuto nella casata')} \${r.casata}!\`);
  await enterApp();
}

// ---- Self-order dall'app (loggato): stesso componente e stessa vista del QR al tavolo ----
let ORD_COM = null;
async function openOrdina() {
  let menu; try { menu = await api('/menu'); } catch { okThen(T('Men\xF9 non disponibile'), false); return; }
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u{1F354} \${T('Ordina')}</div><h2>\${T('Ordina e ritira al punto')}</h2>
    <div class="field"><label>\${T('Punto')}</label><select id="ord_punto" style="width:100%;padding:8px 10px;border:1px solid #cbd2d8;border-radius:9px"><option>Bussola Bar</option><option>Bussola Garden</option></select></div>
    <div id="ord_menu" style="max-height:44vh;overflow:auto"></div>
    <div id="ord_tot" style="font-weight:800;margin-top:8px"></div>
    <button class="btn gold block" style="margin-top:8px" id="ord_send" disabled>\${T('Invia ordine')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
  ORD_COM = Comanda.create({
    mount: $('#ord_menu'), menu, search: true,
    onChange: (cart, tot, n) => { const t = $('#ord_tot'); if (t) t.textContent = n ? \`\${n} \${T('prodotti')} \xB7 \${eur(tot)}\` : ''; const s = $('#ord_send'); if (s) s.disabled = !n; }
  });
  $('#ord_send').onclick = ordInvia;
}
async function ordInvia() {
  const righe = ORD_COM ? ORD_COM.getRighe() : [];
  if (!righe.length) return;
  $('#ord_send').disabled = true;
  let r; try { r = await api('/self-order', { method: 'POST', body: JSON.stringify({ punto: $('#ord_punto').value, tessera_code: state.tessera, righe }) }); }
  catch (e) { okThen(e.message || 'Errore', false); $('#ord_send').disabled = false; return; }
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\u2705 \${T('Ordine inviato')}</div><h2>\${T('Comanda')} #\${esc(r.numero)}</h2>
    <p class="sub">\${esc(r.punto)} \xB7 \${eur(r.totale)} \u2014 \${T('si paga in cassa. Ti avvisiamo quando \xE8 pronto.')}</p>
    <button class="btn gold block" style="margin-top:8px" data-close>\${T('Fatto')}</button>\`);
  showOv();
}

async function openTessera() {
  const s = state.socio;
  const pushOn = !!s.notifiche_push;
  let notifHtml = '', convHtml = '';
  if (state.token) {
    try {
      const list = await api('/auth/notifiche');
      notifHtml = \`<div class="sect-title" style="margin-top:12px">\${T('Le mie notifiche')}</div><div class="card" style="padding:4px 14px">\${list.length ? list.map(n => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.82rem">\${esc(n.titolo)}</b><div class="ct">\${esc(n.corpo || '')}</div></div>\${n.letta ? '' : \`<span style="background:var(--gold);color:#fff;padding:2px 8px;border-radius:10px;font-size:.58rem;font-weight:700">\${T('nuovo')}</span>\`}</div>\`).join('') : \`<p class="tiny muted" style="padding:8px 0">\${T('Nessuna notifica.')}</p>\`}</div>\`;
    } catch {}
    try {
      const cs = (await api('/convocazioni/' + state.tessera)).filter(c => c.stato === 'aperta' || c.stato === 'obbligatoria');
      if (cs.length) convHtml = \`<div class="sect-title" style="margin-top:12px">\${T('Le tue convocazioni')}</div><div class="card" style="padding:4px 14px">\${cs.map(c => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.85rem">\${esc(c.disciplina)}</b><div class="ct">\${esc(c.match_label || '')}</div></div><div style="display:flex; gap:6px"><button class="btn gold sm" data-convrisp="\${c.id}|disponibile">\${T('Ci sono')}</button><button class="btn ghost sm" data-convrisp="\${c.id}|non_disponibile">\${T('No')}</button></div></div>\`).join('')}</div>\`;
    } catch {}
  }
  setSheet(\`<div class="grab"></div>
    <div class="tessera"><div class="lab">BUSSOLA \xB7 by KOIN\xC8</div><h2 class="serif" style="color:#fff">\${esc(s.nome)} \${esc(s.cognome||'')}</h2><div class="role">\${esc(s.ruolo||T('Socio'))} \xB7 \${T('Casata')} \${esc(s.casata||'')}</div>
      <div class="qr">\${qrSvg(s.tessera_code)}</div>
      <div class="foot"><span class="tiny" style="opacity:.85">\${T('Tessera')} \${esc(s.tessera_code)}</span><span class="tiny" style="opacity:.85">\${T('Valida fino al')} \${esc((s.valida_fino||'').split('-').reverse().join('/'))}</span></div></div>
    <div class="row" style="gap:8px; margin-top:10px">
      <button class="btn gold sm" style="flex:1" data-savecard>\u{1F4BE} \${T('Salva tessera')}</button>
      <button class="btn ghost sm" style="flex:1" data-install>\u{1F4F2} \${T('Aggiungi alla Home')}</button>
    </div>
    \${['socio', 'socio_residente'].includes(s.tipo_profilo) ? \`<button class="btn navy block" style="margin-top:8px" data-opencasata>\u{1F6E1}\uFE0F \${s.casata ? T('Cambia casata') : T('Scegli la tua casata')}</button>\` : ''}
    <div class="card" style="margin-top:12px; display:flex; align-items:center; gap:12px">
      <div style="flex:1"><b style="font-size:.86rem">\${T('Notifiche casata & eventi')}</b><p class="tiny muted">\${T('Convocazioni, cambi orario e serate. Con il tuo consenso.')}</p></div>
      <button class="btn \${pushOn?'gold':'ghost'} sm" data-push="\${pushOn?'off':'on'}">\${pushOn?T('Attive \u2713'):T('Attiva')}</button>
    </div>
    \${convHtml}\${notifHtml}
    <div class="sect-title" style="margin-top:12px">\${T('Cosa ti d\xE0')}</div>
    <div class="card">
      <div class="benefit"><span class="bic">\u2713</span><div><b>\${T('Giochi la Coppa delle Casate')}</b><p>\${T('Sport, giochi da tavolo e prove artistiche con il tuo clan.')}</p></div></div>
      <div class="benefit"><span class="bic">\u2713</span><div><b>\${T('Inviti della casata')}</b><p>\${T('Rispondi disponibile o no, senza biglietto n\xE9 consumazione obbligatoria.')}</p></div></div>
      <div class="benefit"><span class="bic">\u25CB</span><div><b>\${T('Copertura infortuni')} <span class="tiny" style="color:var(--coral)">\${T('in definizione')}</span></b><p>\${T('Stiamo valutando con la compagnia una copertura per le attivit\xE0 sportive.')}</p></div></div>
      <div class="benefit"><span class="bic">\u2713</span><div><b>\${T("Il tuo posto nell'Albo d'Oro")}</b><p>\${T('I vincitori della stagione restano scritti alla Bussola.')}</p></div></div>
    </div>
    <button class="btn ghost block" style="margin-top:12px" data-logout>\${T('Esci / cambia tessera')}</button>
    <button class="btn navy block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
function openLoginOtp() {
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\${T('Accesso')}</div><h2>\${T('Entra con la tua e-mail')}</h2><p class="sub">\${T('Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.')}</p>
    <div class="field"><label>\${T('La tua e-mail')}</label><input id="ol_email" type="email" placeholder="nome@example.com" value="socio@example.com"></div>
    <div class="err" id="ol_err" style="color:var(--coral); font-size:.75rem; min-height:16px"></div>
    <button class="btn gold block" data-otp-req>\${T('Invia il codice')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Annulla')}</button>\`);
  showOv();
}
async function requestOtp() {
  const email = $('#ol_email').value.trim();
  if (!email.includes('@')) { $('#ol_err').textContent = T('Inserisci un\u2019e-mail valida'); return; }
  let devCode = '';
  try { const r = await api('/auth/request-otp', { method:'POST', body: JSON.stringify({ email }) }); devCode = r.dev_code || ''; } catch {}
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\${T('Verifica')}</div><h2>\${T('Inserisci il codice')}</h2><p class="sub">\${T('Ti abbiamo inviato un codice a')} \${esc(email)}.</p>
    \${devCode?\`<div class="note">\${T('Modalit\xE0 test: il codice \xE8')} <b>\${esc(devCode)}</b> \${T('(in produzione arriva via e-mail/SMS).')}</div>\`:''}
    <div class="field"><label>\${T('Codice a 6 cifre')}</label><input id="ol_code" inputmode="numeric" placeholder="______" value="\${esc(devCode)}"></div>
    <div class="err" id="ol_err" style="color:var(--coral); font-size:.75rem; min-height:16px"></div>
    <button class="btn gold block" data-otp-verify="\${esc(email)}">\${T('Entra')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-login>\${T('Cambia e-mail')}</button>\`);
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
    okThen(T('Bentornato,') + ' ' + r.socio.nome);
  } catch { $('#ol_err').textContent = T('Codice non valido o scaduto'); }
}

// ---- Accesso al primo avvio (gate): tessera principale, e-mail di riserva ------
function showGate() { const g = $('#gate'); if (g) { g.classList.add('show'); const i = $('#gate_tess'); if (i) setTimeout(() => i.focus(), 60); } }
function hideGate() { const g = $('#gate'); if (g) g.classList.remove('show'); }
async function enterApp() {
  await loadAll();
  renderHeader(); renderHome(); renderEventi(); renderCoppa(); renderBussola(); renderDom('sport'); renderDom('giochi');
  applyProfileGating();
  if (state.lang && state.lang !== 'it') applyLang(state.lang);
  // Socio/Residente auto-registrato senza casata: invito (gentile) a sceglierla.
  const s = state.socio || {};
  if (state.token && ['socio', 'socio_residente'].includes(s.tipo_profilo) && !s.casata && !state._casataAsked) {
    state._casataAsked = true; setTimeout(() => openCasata(true), 500);
  }
}
// Aggiorna lo stato del profilo (ha_casa, is_host, casata\u2026) senza ricaricare tutta l'app.
// Usato quando l'app torna in primo piano: se l'host ha appena confermato, la casa "si scarica" da sola.
let _lastRefresh = 0;
async function refreshSocio(force) {
  if (!state.token || !state.tessera) return;
  const now = Date.now();
  if (!force && now - _lastRefresh < 4000) return; _lastRefresh = now;
  let s; try { s = await api('/tessera/' + state.tessera); } catch { return; }
  const eraCasa = !!(state.socio && state.socio.ha_casa);
  state.socio = s;
  renderHeader(); renderHome(); applyProfileGating();
  // Aggancio appena confermato dall'host \u2192 mostra subito "Casa mia" con le indicazioni.
  const ov = $('#ov');
  if (!eraCasa && s.ha_casa && ov && !ov.classList.contains('show')) openCasaMia();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSocio(); });
window.addEventListener('focus', () => refreshSocio());
async function loginTessera() {
  const code = ($('#gate_tess').value || '').trim().toUpperCase();
  const err = $('#gateErr');
  if (err) err.textContent = '';
  if (!code) { if (err) err.textContent = T('Inserisci il codice tessera.'); return; }
  try {
    const r = await api('/auth/login-tessera', { method: 'POST', body: JSON.stringify({ tessera_code: code }) });
    state.token = r.token; state.tessera = r.socio.tessera_code; state.authed = true;
    store.set('token', r.token); store.set('tessera', r.socio.tessera_code);
    hideGate();
    await enterApp();
    if (!store.get('seen', false)) $('#onb').classList.add('show');
  } catch (e) {
    if (err) err.textContent = T('Tessera non trovata. Controlla il codice o usa l\u2019e-mail.');
  }
}
function demoPreview() {   // solo per anteprima: usa la tessera demo e i dati SEED se offline
  state.tessera = 'BR-2026-0001'; store.set('tessera', state.tessera);
  hideGate(); enterApp();
}

// ---- Registrazione guidata (porta d'ingresso dal QR) ----
let REG = {};
function startRegistrazione() { REG = {}; regProfilo(); showOv(); }
function regProfilo() {
  const opt = (val, emoji, tit, desc) => \`<div class="card" role="button" tabindex="0" data-reg-tipo="\${val}" style="display:flex;gap:12px;align-items:center;margin-bottom:8px"><div style="font-size:1.5rem">\${emoji}</div><div style="flex:1"><b>\${tit}</b><p class="tiny muted">\${desc}</p></div><span style="font-size:1.2rem">\u203A</span></div>\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u2728 \${T('Registrati')}</div><h2>\${T('Chi sei?')}</h2>
    <p class="sub">\${T('Rispondi e l\\'app trova il profilo giusto per te.')}</p>
    \${opt('socio', '\u{1F3AB}', T('Sono socio KOIN\xC8'), T('Tesserato: casata, Coppa, inviti.'))}
    \${opt('residente', '\u{1F3E0}', T('Sono residente'), T('Vivo nel residence; posso gestire case vacanza.'))}
    \${opt('socio_residente', '\u{1F3AB}\u{1F3E0}', T('Sono socio e residente'), T('Tutto del socio (casata, Coppa) + gestisco case vacanza.'))}
    \${opt('ospite_temporaneo', '\u{1F9F3}', T('Sono in vacanza (visitatore)'), T('Ospite temporaneo: ti colleghi alla casa del tuo host.'))}
    <button class="btn ghost block" style="margin-top:8px" data-reg-cancel>\${T('Ho gi\xE0 un account')}</button>\`);
}
function regDati(tipo) {
  REG.tipo = tipo;
  const osp = tipo === 'ospite_temporaneo';
  const f = (id, lbl, type) => \`<div class="field"><label>\${lbl}</label><input id="\${id}" \${type ? 'type="' + type + '"' : ''}></div>\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u2728 \${T('Registrati')}</div><h2>\${T('I tuoi dati')}</h2>
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>\${T('Nome')}</label><input id="reg_nome"></div><div class="field" style="flex:1"><label>\${T('Cognome')}</label><input id="reg_cognome"></div></div>
    \${f('reg_email', 'Email', 'email')}
    <p class="tiny muted" style="margin-top:-4px">\${T('Serve per accedere di nuovo con un codice via e-mail.')}</p>
    \${osp ? \`<div class="row" style="gap:8px"><div class="field" style="flex:1"><label>\${T('Soggiorno dal')}</label><input id="reg_dal" type="date"></div><div class="field" style="flex:1"><label>\${T('al')}</label><input id="reg_al" type="date"></div></div>\` : ''}
    <label class="check" style="margin-top:6px"><input type="checkbox" id="reg_privacy"> \${T('Accetto il trattamento dei dati (privacy)')}</label>
    <div class="reg-err tiny" id="regErr" style="color:#c0392b"></div>
    <button class="btn gold block" style="margin-top:8px" data-reg-save>\${T('Crea profilo')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-reg-back>\${T('Indietro')}</button>\`);
}
async function regSalva() {
  const g = (k) => (document.getElementById('reg_' + k) || {}).value || '';
  const err = $('#regErr'); if (err) err.textContent = '';
  const body = { tipo_profilo: REG.tipo, nome: g('nome'), cognome: g('cognome'), email: g('email'), lingua: state.lang || 'it', consenso_privacy: $('#reg_privacy') && $('#reg_privacy').checked };
  if (REG.tipo === 'ospite_temporaneo') { body.soggiorno_dal = g('dal'); body.soggiorno_al = g('al'); }
  if (!body.nome.trim() || !body.cognome.trim()) { if (err) err.textContent = T('Nome e cognome obbligatori'); return; }
  if (!body.consenso_privacy) { if (err) err.textContent = T('Il consenso privacy \xE8 necessario per registrarsi'); return; }
  let r;
  try { r = await api('/auth/registrazione', { method: 'POST', body: JSON.stringify(body) }); }
  catch (e) { if (err) err.textContent = e.message || T('Registrazione non riuscita'); return; }
  // auto-login
  state.token = r.token; state.tessera = r.socio.tessera_code; state.authed = true;
  store.set('token', r.token); store.set('tessera', r.socio.tessera_code);
  REG.code = r.socio.tessera_code;
  await enterApp();
  if (REG.tipo === 'ospite_temporaneo') regHost(); else regFine();
}
function regFine() {
  const socioLike = ['socio', 'socio_residente'].includes(REG.tipo);
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\u2705 \${T('Tutto pronto')}</div><h2>\${T('Benvenuto!')}</h2>
    <p class="sub">\${T('Il tuo profilo \xE8 attivo. Conserva il tuo codice per accedere anche senza e-mail:')}</p>
    <div class="card" style="text-align:center;padding:14px"><div class="tiny muted">\${T('Codice di accesso')}</div><div style="font-size:1.5rem;font-weight:800;letter-spacing:1px;color:var(--navy)">\${esc(REG.code || '')}</div></div>
    <button class="btn gold block" style="margin-top:10px" data-savecard>\u{1F4BE} \${T('Salva la tua tessera (immagine)')}</button>
    \${installHintHTML()}
    \${socioLike ? \`<button class="btn navy block" style="margin-top:8px" data-opencasata>\u{1F6E1}\uFE0F \${T('Scegli la tua casata')}</button>\` : ''}
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Inizia')}</button>\`);
}
function regHost() {
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\u{1F3E1} \${T('Il tuo host')}</div><h2>\${T('Conosci il tuo host?')}</h2>
    <p class="sub">\${T('Cerca chi ti ospita: ricever\xE0 una notifica e, se conferma, vedrai "Casa mia".')}</p>
    <div class="field"><label>\${T('Nome o cognome dell\\'host')}</label><input id="reg_hq" placeholder="\${T('es. Chiara')}" autocomplete="off"></div>
    <div id="reg_hres"></div>
    <button class="btn ghost block" style="margin-top:8px" data-reg-skiphost>\${T('Non lo conosco ora \xB7 salta')}</button>\`);
  const inp = $('#reg_hq');
  if (inp) { inp.oninput = () => regHostCerca(inp.value); setTimeout(() => inp.focus(), 60); }
}
let _regHTimer = null;
function regHostCerca(q) {
  clearTimeout(_regHTimer);
  _regHTimer = setTimeout(async () => {
    const box = $('#reg_hres'); if (!box) return;
    if ((q || '').trim().length < 2) { box.innerHTML = ''; return; }
    let hosts = [];
    try { hosts = (await api('/auth/hosts-cerca?q=' + encodeURIComponent(q))).hosts || []; } catch {}
    box.innerHTML = hosts.length
      ? '<div class="card" style="padding:4px 14px">' + hosts.map(h => \`<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">\${esc(h.nome)} \${esc(h.cognome)}</b></div><button class="btn gold sm" data-reg-host="\${h.id}">\${T('\xC8 lui/lei')}</button></div>\`).join('') + '</div>'
      : \`<p class="tiny muted" style="padding:6px 0">\${T('Nessun host trovato con questo nome.')}</p>\`;
  }, 220);
}
async function regInviaRichiesta(hostId) {
  let r;
  try { r = await api('/auth/aggancio/richiesta', { method: 'POST', body: JSON.stringify({ host_id: Number(hostId) }) }); }
  catch (e) { okThen(e.message || 'Errore', false); return; }
  const nome = r.host ? (r.host.nome + ' ' + r.host.cognome) : '';
  const isReg = !!REG.code;   // durante la registrazione mostro anche codice + installazione; fuori no.
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">\u{1F4E8} \${T('Richiesta inviata')}</div><h2>\${T('In attesa di conferma')}</h2>
    <p class="sub">\${T('Abbiamo avvisato')} <b>\${esc(nome)}</b>. \${T('Quando confermer\xE0, comparir\xE0 "Casa mia" con tutte le indicazioni della struttura.')}</p>
    \${isReg ? \`<div class="card" style="text-align:center;padding:14px"><div class="tiny muted">\${T('Il tuo codice di accesso')}</div><div style="font-size:1.4rem;font-weight:800;letter-spacing:1px;color:var(--navy)">\${esc(REG.code || '')}</div></div>
    <button class="btn gold block" style="margin-top:10px" data-savecard>\u{1F4BE} \${T('Salva la tua tessera (immagine)')}</button>
    \${installHintHTML()}\` : ''}
    <button class="btn ghost block" style="margin-top:8px" data-close>\${isReg ? T('Inizia') : T('Fatto')}</button>\`);
  showOv();
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
  if (on) { try { await subscribePush(); } catch {} } else { try { await unsubscribePush(); } catch {} }
  okThen(on ? T('Notifiche attivate: ti avviseremo per casata ed eventi') : T('Notifiche disattivate'));
}
// --- Web Push (PWA) ---
function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function subscribePush() {
  if (!state.token) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return; // browser senza push \u2192 resta il solo in-app
  let cfg; try { cfg = await api('/push/pubkey'); } catch { return; }
  if (!cfg || !cfg.enabled || !cfg.key) return;                                // push non configurato sul server
  if (typeof Notification !== 'undefined') { const p = await Notification.requestPermission(); if (p !== 'granted') return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.key) });
  await api('/auth/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
}
async function unsubscribePush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); if (state.token) await api('/auth/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: ep }) }); }
  } catch {}
}
const SHEETS = {
  'sheet-vinile': () => \`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">\${T('Marted\xEC')} \xB7 Vinile & Vino</div><h2>\${T('Proponi un vinile')}</h2><p class="sub">\${T('Le proposte di questa settimana diventano la scaletta di marted\xEC prossimo.')}</p>
    <div class="field"><label>\${T('Quale vinile?')}</label><input id="in1" placeholder="\${T('Es. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4')}"></div>
    <div class="field"><label>\${T('I brani che vuoi ascoltare')}</label><input id="in2" placeholder="\${T('Es. Cr\xEAuza de m\xE4, Sid\xFAn')}"></div>
    <div class="field"><label>\${T('Perch\xE9 lo proponi?')}</label><textarea id="in3" placeholder="\${T('In due righe cosa significa per te...')}"></textarea></div>
    <button class="btn gold block" data-proposta="vinile">\${T('Invia la proposta')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Annulla')}</button>\`,
  'sheet-openmic': () => \`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${T('Domenica')} \xB7 Open Mic</div><h2>\${T('Salgo sul palco')}</h2><p class="sub">\${T('Hai tre minuti. Scegli cosa porti sul Bussola Stage.')}</p>
    <div class="field"><label>\${T('La tua esibizione')}</label><div class="chips" data-group="tipo"><button class="chip" data-chip>\u{1F3A4} \${T('Canto')}</button><button class="chip" data-chip>\u{1F3AD} \${T('Monologo')}</button><button class="chip" data-chip>\u{1F604} Stand-up</button><button class="chip" data-chip>\u{1F3B8} \${T('Strumento')}</button></div></div>
    <div class="field"><label>\${T('Titolo / cosa presenti')}</label><input id="in1" placeholder="\${T("Es. 'Caruso' alla chitarra")}"></div>
    <div class="note">\${T('La stand-up \xE8 benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.')}</div>
    <button class="btn gold block" style="margin-top:12px" data-proposta="openmic">\${T('Prenota i miei tre minuti')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Annulla')}</button>\`,
};
function openSheet(id) { setSheet(SHEETS[id]()); showOv(); }
function okThen(msg, ok = true) {
  const icon = ok ? '<path d="M5 13l4 4L19 7"/>' : '<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>';
  const bg = ok ? '' : 'background:var(--coral)';
  const title = ok ? T('Fatto!') : T('Un momento');
  const tail = ok ? T(". Lo trovi nell'app e te lo ricordiamo noi.") : '';
  setSheet(\`<div class="grab"></div><div class="okmsg" style="text-align:center; padding:12px 0 4px"><div class="big" style="\${bg}"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" aria-hidden="true">\${icon}</svg></div><h2 style="text-align:center">\${title}</h2><p class="sub" style="text-align:center">\${esc(msg)}\${tail}</p></div><button class="btn navy block" style="margin-top:6px" data-close>\${ok ? T('Perfetto') : T('Ho capito')}</button>\`);
  showOv();
}
// Lingue: 5 con traduzione fissa salvata (it/en/fr/de/es).
const LANGS = [['it','Italiano','fixed'],['en','English','fixed'],['fr','Fran\xE7ais','fixed'],['de','Deutsch','fixed'],['es','Espa\xF1ol','fixed']];
const I18N = {
  it:{home:'Home',eventi:'Eventi',sport:'Sport',giochi:'Giochi',bussola:'Guida',ciao:'Ciao',testo:'Testo',contrasto:'Contrasto',siamo_qui:'Siamo qui',chiosco:'Chiosco La Bussola',isola:'Isola ecologica',qui:'sei qui',apri_mappa:'Tocca per aprire la mappa'},
  en:{home:'Home',eventi:'Events',sport:'Sport',giochi:'Games',bussola:'Guide',ciao:'Hi',testo:'Text',contrasto:'Contrast',siamo_qui:'You are here',chiosco:'La Bussola kiosk',isola:'Recycling point',qui:'you are here',apri_mappa:'Tap to open the map'},
  fr:{home:'Accueil',eventi:'\xC9v\xE9nements',sport:'Sport',giochi:'Jeux',bussola:'Guide',ciao:'Bonjour',testo:'Texte',contrasto:'Contraste',siamo_qui:'Vous \xEAtes ici',chiosco:'Kiosque La Bussola',isola:'Point de tri',qui:'vous \xEAtes ici',apri_mappa:'Touchez pour ouvrir la carte'},
  de:{home:'Start',eventi:'Events',sport:'Sport',giochi:'Spiele',bussola:'Guide',ciao:'Hallo',testo:'Text',contrasto:'Kontrast',siamo_qui:'Sie sind hier',chiosco:'Kiosk La Bussola',isola:'Wertstoffinsel',qui:'Sie sind hier',apri_mappa:'Zum \xD6ffnen der Karte tippen'},
  es:{home:'Inicio',eventi:'Eventos',sport:'Deporte',giochi:'Juegos',bussola:'Gu\xEDa',ciao:'Hola',testo:'Texto',contrasto:'Contraste',siamo_qui:'Est\xE1s aqu\xED',chiosco:'Quiosco La Bussola',isola:'Punto de reciclaje',qui:'est\xE1s aqu\xED',apri_mappa:'Toca para abrir el mapa'},
};
function tr(k){ return (I18N[state.lang] || I18N.it)[k] || I18N.it[k]; }
// Dizionario stringhe fisse dell'app (chiave = testo italiano esatto). I contenuti
// dinamici (dati/DB) non passano da qui. T() ricade sull'italiano se manca la voce.
const UI = {
  en: {
    'Casata':'House','Benvenuto alla Bussola':'Welcome to La Bussola','Benvenuti alla Bussola':'Welcome to La Bussola',
    'Proponi':'Suggest','Salgo':'On stage','Coppa':'Cup','Info':'Info','Vedi':'View','Stasera alla Bussola':'Tonight at La Bussola',
    'Prenota':'Book','Campi':'Courts','prenota o partita':'book or match','Partite aperte':'Open matches','unisciti':'join',
    'Coworking':'Coworking','postazione':'workspace','Questa settimana':'This week','Serate su prenotazione':'Evenings by reservation',
    'a persona':'per person','posti':'spots','Il cartellone':'The lineup','Il programma':'The program',
    'Tocca una serata per i dettagli e per prenotare.':'Tap an evening for details and to book.',
    'Il pomeriggio \xE8 dello sport e delle famiglie; la sera, gli spettacoli che accompagnano la cena.':'Afternoons are for sport and families; evenings, the shows that go with dinner.',
    'Serata dei Clan \xB7 Contest':'Clans Night \xB7 Contest','Apri il contest':'Open the contest','Strumenti del capitano':'Captain tools',
    'Convoca la casata':'Summon your house','Serata dei Clan':'Clans Night','La comunit\xE0':'The community','Coppa delle Casate':'Houses Cup',
    'La tua casata':'Your house','posto':'place','Classifica generale':'Overall standings','Campionati sport':'Sport championships',
    'Gironi, calendario e risultati.':'Groups, schedule and results.','Apri':'Open','Giochi da Tavolo':'Board games',
    'Burraco, scala 40, briscola, scacchi.':'Burraco, Scala 40, Briscola, chess.',"Regolamenti & Albo d'Oro":'Rules & Hall of Fame',
    'Regole di Coppa, Contest e Proposte; le edizioni passate.':'Cup, Contest and Proposal rules; past editions.',
    "Albo d'Oro":'Hall of Fame','Regole & storia':'Rules & history','Regolamenti':'Rules',
    'Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.':'The rules for the Cup, Contest and Proposals, and the rules of the ongoing disciplines.',
    'Nessun regolamento generale.':'No general rules.','Discipline':'Disciplines','Chiudi':'Close',
    'Calendario non ancora disponibile.':'Calendar not available yet.','Nessun periodo configurato.':'No period configured.',
    'Conferimento':'Drop-off','Ritiro dalle':'Pickup from',
    'Lun':'Mon','Mar':'Tue','Mer':'Wed','Gio':'Thu','Ven':'Fri','Sab':'Sat','Dom':'Sun',
    'Guida del residence':'Residence guide','Silenzio pomeridiano':'Afternoon quiet','Silenzio notturno':'Night quiet',
    'Numeri utili & servizi':'Useful numbers & services','Raccolta rifiuti':'Waste collection','Cosa vedere':'What to see',
    'Presenza confermata \u2713':'Attendance confirmed \u2713','Convocazione vincolante':'Binding call-up',
    'Hai gi\xE0 declinato tre volte in stagione: questa convocazione \xE8 vincolante.':'You\u2019ve already declined three times this season: this call-up is binding.',
    'Confermo':'I confirm','Hai declinato':'You declined','dinieghi':'declines','Ci ripenso':'I\u2019ll reconsider',
    'Sei nostro ospite: partecipa quando vuoi, nessun obbligo.':'You\u2019re our guest: join whenever you like, no obligation.',
    'Dinieghi:':'Declines:','diventa vincolante solo dopo il terzo':'becomes binding only after the third',
    'La tua casata ti invita':'Your house invites you','Disponibile':'Available','Non disponibile':'Not available',
    'Squadra':'Team','PG':'GP','V':'W','Pt':'Pts','Prossime partite':'Upcoming matches','Calendario in aggiornamento.':'Schedule being updated.',
    'Risultati recenti':'Recent results','Nessun risultato ancora.':'No results yet.',
    'Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.':'Every match updates the Cup standings. Format: groups, then semifinals and final.',
    'Campionati sociali':'Club championships','Tornei':'Tournaments','Sport & Tornei':'Sport & Tournaments','Oggi':'Today','Domani':'Tomorrow',
    'Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.':'Limited spots: max 8 in the morning and 8 in the afternoon. The <b>full day</b> takes a spot in both slots.',
    'Quante persone':'How many people','Prenotazione':'Booking','Giorno':'Day','Turno':'Slot','Conferma prenotazione':'Confirm booking','Annulla':'Cancel',
    'Prenotazione campi disponibile solo online':'Court booking available online only','Disponibile solo online':'Available online only','Libero':'Free','Partita':'Match','Partita aperta':'Open match',
    'AL COMPLETO':'FULL','Unisciti':'Join','Occupato':'Occupied','prenotato':'booked','OCCUPATO':'OCCUPIED','Prenotazione campi':'Court booking',
    'Campo':'Court','Fasce orarie':'Time slots','Nessuno slot per questa data.':'No slots for this date.',
    '\u201CPrenota\u201D blocca lo slot per te. \u201CPartita\u201D apre una <b>partita aperta</b>: altri soci possono unirsi finch\xE9 non \xE8 al completo.':'\u201CBook\u201D locks the slot for you. \u201CMatch\u201D opens an <b>open match</b>: other members can join until it\u2019s full.',
    'manca':'missing','mancano':'missing','Gioca con gli altri':'Play with others',
    'Unisciti a una partita con posti liberi: quando si completa, \xE8 fatta.':'Join a match with open spots: once it\u2019s full, you\u2019re set.',
    'Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!':'No open matches right now. Start one yourself from the Courts section!',
    'Prenotazione non riuscita':'Booking failed','Errore di rete':'Network error','Campo prenotato':'Court booked',
    'Apri una partita alle':'Open a match at','con':'with','posti? Gli altri soci potranno unirsi.':'spots? Other members can join.',
    'Non riuscito':'Failed','Partita al completo, ci vediamo in campo! \u{1F3BE}':'Match full, see you on court! \u{1F3BE}','Iscritto!':'Signed up!',
    'Le mie notifiche':'My notifications','Nessuna notifica.':'No notifications.','nuovo':'new','Le tue convocazioni':'Your call-ups',
    'Ci sono':'I\u2019m in','No':'No','Socio':'Member','Tessera':'Card','Valida fino al':'Valid until','Notifiche casata & eventi':'House & events notifications',
    'Convocazioni, cambi orario e serate. Con il tuo consenso.':'Call-ups, schedule changes and evenings. With your consent.',
    'Attive \u2713':'On \u2713','Attiva':'Turn on','Cosa ti d\xE0':'What you get','Giochi la Coppa delle Casate':'You play the Houses Cup',
    'Sport, giochi da tavolo e prove artistiche con il tuo clan.':'Sport, board games and artistic challenges with your clan.',
    'Inviti della casata':'House invitations',
    'Rispondi disponibile o no, senza biglietto n\xE9 consumazione obbligatoria.':'Reply available or not, no ticket or minimum purchase.',
    'Copertura infortuni':'Injury coverage','in definizione':'in progress',
    'Stiamo valutando con la compagnia una copertura per le attivit\xE0 sportive.':'We\u2019re evaluating coverage for sports activities with the insurer.',
    "Il tuo posto nell'Albo d'Oro":'Your place in the Hall of Fame','I vincitori della stagione restano scritti alla Bussola.':'The season\u2019s winners stay recorded at La Bussola.',
    'Esci / cambia tessera':'Log out / change card','Accesso':'Sign in','Entra con la tua e-mail':'Sign in with your email',
    'Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.':'We\u2019ll send you a one-time code (OTP) or a magic link. No password to remember.',
    'La tua e-mail':'Your email','Invia il codice':'Send the code','Inserisci un\u2019e-mail valida':'Enter a valid email',
    'Verifica':'Verify','Inserisci il codice':'Enter the code','Ti abbiamo inviato un codice a':'We sent a code to',
    'Modalit\xE0 test: il codice \xE8':'Test mode: the code is','(in produzione arriva via e-mail/SMS).':'(in production it arrives via email/SMS).',
    'Codice a 6 cifre':'6-digit code','Entra':'Enter','Cambia e-mail':'Change email','Codice non valido o scaduto':'Invalid or expired code',
    'Bentornato,':'Welcome back,','Inserisci il codice tessera.':'Enter your card code.',
    'Tessera non trovata. Controlla il codice o usa l\u2019e-mail.':'Card not found. Check the code or use email.',
    'Notifiche attivate: ti avviseremo per casata ed eventi':'Notifications on: we\u2019ll alert you about your house and events','Notifiche disattivate':'Notifications off',
    'Marted\xEC':'Tuesday','Proponi un vinile':'Suggest a vinyl',
    'Le proposte di questa settimana diventano la scaletta di marted\xEC prossimo.':'This week\u2019s suggestions become next Tuesday\u2019s playlist.',
    'Quale vinile?':'Which vinyl?','Es. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4':'E.g. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4',
    'I brani che vuoi ascoltare':'The tracks you want to hear','Es. Cr\xEAuza de m\xE4, Sid\xFAn':'E.g. Cr\xEAuza de m\xE4, Sid\xFAn',
    'Perch\xE9 lo proponi?':'Why are you suggesting it?','In due righe cosa significa per te...':'In two lines, what it means to you...',
    'Invia la proposta':'Send the suggestion','Domenica':'Sunday','Salgo sul palco':'I\u2019m taking the stage',
    'Hai tre minuti. Scegli cosa porti sul Bussola Stage.':'You have three minutes. Choose what you bring to the Bussola Stage.',
    'La tua esibizione':'Your performance','Canto':'Singing','Monologo':'Monologue','Strumento':'Instrument','Titolo / cosa presenti':'Title / what you present',
    "Es. 'Caruso' alla chitarra":'E.g. \u2018Caruso\u2019 on guitar',
    'La stand-up \xE8 benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.':'Stand-up is welcome, with moderate language: there are families at La Bussola too.',
    'Prenota i miei tre minuti':'Book my three minutes','Fatto!':'Done!','Un momento':'One moment',
    ". Lo trovi nell'app e te lo ricordiamo noi.":'. You\u2019ll find it in the app and we\u2019ll remind you.','Perfetto':'Perfect','Ho capito':'Got it',
    'Scegli la lingua':'Choose the language',"Scegli la lingua dell'app":'Choose the app language',
    'Numeri utili':'Useful numbers','Emergenze & servizi':'Emergencies & services','In caso di necessit\xE0.':'In case of need.',
    'Emergenze (112)':'Emergencies (112)','Numero unico europeo':'Single European number','Capitano':'Captain','Convoca la tua casata':'Summon your house',
    "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).":'No matches to cover right now (requires captain access and a schedule generated by staff).',
    'dispon.':'avail.','Serve gente \u2014 convoca':'Need players \u2014 call up','Convoca giocatori':'Call up players','Chi copre le partite?':'Who covers the matches?',
    'Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.':'Red = fewer available than the minimum. Tap a match to call up individuals.',
    'disponibile':'available','non disp.':'unavail.','in attesa':'pending','Convoca i giocatori':'Call up players',
    'servono':'need','disponibili':'available','Spunta chi vuoi convocare.':'Check who you want to call up.',
    'Convoca i selezionati':'Call up selected','\u2190 Torna alle partite':'\u2190 Back to matches','Seleziona almeno un giocatore':'Select at least one player',
    'Convocati':'Called up','giocatori':'players','Non riesco a convocare ora':'Can\u2019t call up right now',
    'Rilancia la sfida ai tuoi. Forza':'Rally your house. Go','Condividi con la casata':'Share with your house','Vincitore:':'Winner:','Condividi':'Share',
    'Testo copiato: incollalo nel gruppo':'Text copied: paste it in the group','Presenza confermata':'Attendance confirmed',
    'Prenotazione non riuscita: riprova':'Booking failed: try again','Prenotazione registrata':'Booking recorded','pers.':'ppl',
    'Serata su prenotazione':'Evening by reservation','Quota':'Fee','Posti disponibili':'Spots available','Posti esauriti per questa serata.':'Sold out for this evening.',
    'Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriver\xE0 pi\xF9 avanti).':'Limited-capacity booking: the fee is paid at the desk on confirmation (in-app payment coming later).',
    'Sei in lista per':'You\u2019re on the list for','da saldare in cassa':'to pay at the desk','da saldare':'to pay','la serata':'the evening',
    'La tua proposta \xE8 in lista':'Your suggestion is on the list','Sei in scaletta per domenica':'You\u2019re on the lineup for Sunday','Lingua impostata':'Language set',
    'siamo':'we\u2019re','punti':'points','Forza':'Go','la nostra casata':'our house','La sfida di venerd\xEC':'Friday\u2019s challenge','prossimamente':'coming soon',
  },
  fr: {
    'Casata':'Maison','Benvenuto alla Bussola':'Bienvenue \xE0 La Bussola','Benvenuti alla Bussola':'Bienvenue \xE0 La Bussola',
    'Proponi':'Proposer','Salgo':'Sur sc\xE8ne','Coppa':'Coupe','Info':'Info','Vedi':'Voir','Stasera alla Bussola':'Ce soir \xE0 La Bussola',
    'Prenota':'R\xE9server','Campi':'Terrains','prenota o partita':'r\xE9server ou partie','Partite aperte':'Parties ouvertes','unisciti':'rejoindre',
    'Coworking':'Coworking','postazione':'poste','Questa settimana':'Cette semaine','Serate su prenotazione':'Soir\xE9es sur r\xE9servation',
    'a persona':'par personne','posti':'places','Il cartellone':'\xC0 l\u2019affiche','Il programma':'Le programme',
    'Tocca una serata per i dettagli e per prenotare.':'Touchez une soir\xE9e pour les d\xE9tails et pour r\xE9server.',
    'Il pomeriggio \xE8 dello sport e delle famiglie; la sera, gli spettacoli che accompagnano la cena.':'L\u2019apr\xE8s-midi est au sport et aux familles ; le soir, les spectacles qui accompagnent le d\xEEner.',
    'Serata dei Clan \xB7 Contest':'Soir\xE9e des Clans \xB7 Concours','Apri il contest':'Ouvrir le concours','Strumenti del capitano':'Outils du capitaine',
    'Convoca la casata':'Convoquer la maison','Serata dei Clan':'Soir\xE9e des Clans','La comunit\xE0':'La communaut\xE9','Coppa delle Casate':'Coupe des Maisons',
    'La tua casata':'Votre maison','posto':'place','Classifica generale':'Classement g\xE9n\xE9ral','Campionati sport':'Championnats sportifs',
    'Gironi, calendario e risultati.':'Poules, calendrier et r\xE9sultats.','Apri':'Ouvrir','Giochi da Tavolo':'Jeux de soci\xE9t\xE9',
    'Burraco, scala 40, briscola, scacchi.':'Burraco, Scala 40, Briscola, \xE9checs.',"Regolamenti & Albo d'Oro":'R\xE8glements & Palmar\xE8s',
    'Regole di Coppa, Contest e Proposte; le edizioni passate.':'R\xE8gles de la Coupe, du Concours et des Propositions ; \xE9ditions pass\xE9es.',
    "Albo d'Oro":'Palmar\xE8s','Regole & storia':'R\xE8gles & histoire','Regolamenti':'R\xE8glements',
    'Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.':'Les r\xE8gles de la Coupe, du Concours et des Propositions, et les r\xE8glements des disciplines en cours.',
    'Nessun regolamento generale.':'Aucun r\xE8glement g\xE9n\xE9ral.','Discipline':'Disciplines','Chiudi':'Fermer',
    'Calendario non ancora disponibile.':'Calendrier pas encore disponible.','Nessun periodo configurato.':'Aucune p\xE9riode configur\xE9e.',
    'Conferimento':'D\xE9p\xF4t','Ritiro dalle':'Collecte \xE0 partir de',
    'Lun':'Lun','Mar':'Mar','Mer':'Mer','Gio':'Jeu','Ven':'Ven','Sab':'Sam','Dom':'Dim',
    'Guida del residence':'Guide de la r\xE9sidence','Silenzio pomeridiano':'Silence de l\u2019apr\xE8s-midi','Silenzio notturno':'Silence nocturne',
    'Numeri utili & servizi':'Num\xE9ros utiles & services','Raccolta rifiuti':'Collecte des d\xE9chets','Cosa vedere':'\xC0 voir',
    'Presenza confermata \u2713':'Pr\xE9sence confirm\xE9e \u2713','Convocazione vincolante':'Convocation obligatoire',
    'Hai gi\xE0 declinato tre volte in stagione: questa convocazione \xE8 vincolante.':'Vous avez d\xE9j\xE0 d\xE9clin\xE9 trois fois cette saison : cette convocation est obligatoire.',
    'Confermo':'Je confirme','Hai declinato':'Vous avez d\xE9clin\xE9','dinieghi':'refus','Ci ripenso':'Je reconsid\xE8re',
    'Sei nostro ospite: partecipa quando vuoi, nessun obbligo.':'Vous \xEAtes notre invit\xE9 : participez quand vous voulez, sans obligation.',
    'Dinieghi:':'Refus :','diventa vincolante solo dopo il terzo':'devient obligatoire seulement apr\xE8s le troisi\xE8me',
    'La tua casata ti invita':'Votre maison vous invite','Disponibile':'Disponible','Non disponibile':'Indisponible',
    'Squadra':'\xC9quipe','PG':'J','V':'V','Pt':'Pts','Prossime partite':'Prochains matchs','Calendario in aggiornamento.':'Calendrier en cours de mise \xE0 jour.',
    'Risultati recenti':'R\xE9sultats r\xE9cents','Nessun risultato ancora.':'Aucun r\xE9sultat pour l\u2019instant.',
    'Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.':'Chaque match met \xE0 jour le classement de la Coupe. Formule : poules, puis demi-finales et finale.',
    'Campionati sociali':'Championnats du club','Tornei':'Tournois','Sport & Tornei':'Sport & Tournois','Oggi':'Aujourd\u2019hui','Domani':'Demain',
    'Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.':'Places limit\xE9es : max 8 le matin et 8 l\u2019apr\xE8s-midi. La <b>journ\xE9e enti\xE8re</b> occupe une place sur les deux cr\xE9neaux.',
    'Quante persone':'Combien de personnes','Prenotazione':'R\xE9servation','Giorno':'Jour','Turno':'Cr\xE9neau','Conferma prenotazione':'Confirmer la r\xE9servation','Annulla':'Annuler',
    'Prenotazione campi disponibile solo online':'R\xE9servation des terrains disponible en ligne uniquement','Disponibile solo online':'Disponible en ligne uniquement','Libero':'Libre','Partita':'Partie','Partita aperta':'Partie ouverte',
    'AL COMPLETO':'COMPLET','Unisciti':'Rejoindre','Occupato':'Occup\xE9','prenotato':'r\xE9serv\xE9','OCCUPATO':'OCCUP\xC9','Prenotazione campi':'R\xE9servation des terrains',
    'Campo':'Terrain','Fasce orarie':'Cr\xE9neaux','Nessuno slot per questa data.':'Aucun cr\xE9neau pour cette date.',
    '\u201CPrenota\u201D blocca lo slot per te. \u201CPartita\u201D apre una <b>partita aperta</b>: altri soci possono unirsi finch\xE9 non \xE8 al completo.':'\xAB R\xE9server \xBB bloque le cr\xE9neau pour vous. \xAB Partie \xBB ouvre une <b>partie ouverte</b> : d\u2019autres membres peuvent rejoindre tant qu\u2019elle n\u2019est pas compl\xE8te.',
    'manca':'manque','mancano':'manquent','Gioca con gli altri':'Jouez avec les autres',
    'Unisciti a una partita con posti liberi: quando si completa, \xE8 fatta.':'Rejoignez une partie avec des places libres : une fois compl\xE8te, c\u2019est parti.',
    'Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!':'Aucune partie ouverte pour le moment. Lancez-en une depuis la section Terrains !',
    'Prenotazione non riuscita':'\xC9chec de la r\xE9servation','Errore di rete':'Erreur r\xE9seau','Campo prenotato':'Terrain r\xE9serv\xE9',
    'Apri una partita alle':'Ouvrir une partie \xE0','con':'avec','posti? Gli altri soci potranno unirsi.':'places ? D\u2019autres membres pourront rejoindre.',
    'Non riuscito':'\xC9chec','Partita al completo, ci vediamo in campo! \u{1F3BE}':'Partie compl\xE8te, on se voit sur le terrain ! \u{1F3BE}','Iscritto!':'Inscrit !',
    'Le mie notifiche':'Mes notifications','Nessuna notifica.':'Aucune notification.','nuovo':'nouveau','Le tue convocazioni':'Vos convocations',
    'Ci sono':'Je suis l\xE0','No':'Non','Socio':'Membre','Tessera':'Carte','Valida fino al':'Valable jusqu\u2019au','Notifiche casata & eventi':'Notifications maison & \xE9v\xE9nements',
    'Convocazioni, cambi orario e serate. Con il tuo consenso.':'Convocations, changements d\u2019horaire et soir\xE9es. Avec votre consentement.',
    'Attive \u2713':'Activ\xE9es \u2713','Attiva':'Activer','Cosa ti d\xE0':'Ce que \xE7a vous apporte','Giochi la Coppa delle Casate':'Vous jouez la Coupe des Maisons',
    'Sport, giochi da tavolo e prove artistiche con il tuo clan.':'Sport, jeux de soci\xE9t\xE9 et \xE9preuves artistiques avec votre clan.',
    'Inviti della casata':'Invitations de la maison',
    'Rispondi disponibile o no, senza biglietto n\xE9 consumazione obbligatoria.':'R\xE9pondez disponible ou non, sans billet ni consommation obligatoire.',
    'Copertura infortuni':'Couverture accidents','in definizione':'en cours',
    'Stiamo valutando con la compagnia una copertura per le attivit\xE0 sportive.':'Nous \xE9tudions avec l\u2019assureur une couverture pour les activit\xE9s sportives.',
    "Il tuo posto nell'Albo d'Oro":'Votre place au Palmar\xE8s','I vincitori della stagione restano scritti alla Bussola.':'Les vainqueurs de la saison restent inscrits \xE0 La Bussola.',
    'Esci / cambia tessera':'Se d\xE9connecter / changer de carte','Accesso':'Connexion','Entra con la tua e-mail':'Connectez-vous avec votre e-mail',
    'Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.':'Nous vous envoyons un code \xE0 usage unique (OTP) ou un lien magique. Aucun mot de passe \xE0 retenir.',
    'La tua e-mail':'Votre e-mail','Invia il codice':'Envoyer le code','Inserisci un\u2019e-mail valida':'Saisissez un e-mail valide',
    'Verifica':'V\xE9rification','Inserisci il codice':'Saisissez le code','Ti abbiamo inviato un codice a':'Nous avons envoy\xE9 un code \xE0',
    'Modalit\xE0 test: il codice \xE8':'Mode test : le code est','(in produzione arriva via e-mail/SMS).':'(en production il arrive par e-mail/SMS).',
    'Codice a 6 cifre':'Code \xE0 6 chiffres','Entra':'Entrer','Cambia e-mail':'Changer d\u2019e-mail','Codice non valido o scaduto':'Code invalide ou expir\xE9',
    'Bentornato,':'Bon retour,','Inserisci il codice tessera.':'Saisissez le code de la carte.',
    'Tessera non trovata. Controlla il codice o usa l\u2019e-mail.':'Carte introuvable. V\xE9rifiez le code ou utilisez l\u2019e-mail.',
    'Notifiche attivate: ti avviseremo per casata ed eventi':'Notifications activ\xE9es : nous vous pr\xE9viendrons pour la maison et les \xE9v\xE9nements','Notifiche disattivate':'Notifications d\xE9sactiv\xE9es',
    'Marted\xEC':'Mardi','Proponi un vinile':'Proposer un vinyle',
    'Le proposte di questa settimana diventano la scaletta di marted\xEC prossimo.':'Les propositions de cette semaine deviennent la playlist de mardi prochain.',
    'Quale vinile?':'Quel vinyle ?','Es. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4':'Ex. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4',
    'I brani che vuoi ascoltare':'Les morceaux que vous voulez \xE9couter','Es. Cr\xEAuza de m\xE4, Sid\xFAn':'Ex. Cr\xEAuza de m\xE4, Sid\xFAn',
    'Perch\xE9 lo proponi?':'Pourquoi le proposez-vous ?','In due righe cosa significa per te...':'En deux lignes, ce que \xE7a repr\xE9sente pour vous...',
    'Invia la proposta':'Envoyer la proposition','Domenica':'Dimanche','Salgo sul palco':'Je monte sur sc\xE8ne',
    'Hai tre minuti. Scegli cosa porti sul Bussola Stage.':'Vous avez trois minutes. Choisissez ce que vous pr\xE9sentez sur le Bussola Stage.',
    'La tua esibizione':'Votre prestation','Canto':'Chant','Monologo':'Monologue','Strumento':'Instrument','Titolo / cosa presenti':'Titre / ce que vous pr\xE9sentez',
    "Es. 'Caruso' alla chitarra":'Ex. \u2018Caruso\u2019 \xE0 la guitare',
    'La stand-up \xE8 benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.':'Le stand-up est bienvenu, avec un langage mod\xE9r\xE9 : il y a aussi des familles \xE0 La Bussola.',
    'Prenota i miei tre minuti':'R\xE9server mes trois minutes','Fatto!':'C\u2019est fait !','Un momento':'Un instant',
    ". Lo trovi nell'app e te lo ricordiamo noi.":'. Vous le retrouvez dans l\u2019app et nous vous le rappelons.','Perfetto':'Parfait','Ho capito':'Compris',
    'Scegli la lingua':'Choisissez la langue',"Scegli la lingua dell'app":'Choisissez la langue de l\u2019app',
    'Numeri utili':'Num\xE9ros utiles','Emergenze & servizi':'Urgences & services','In caso di necessit\xE0.':'En cas de besoin.',
    'Emergenze (112)':'Urgences (112)','Numero unico europeo':'Num\xE9ro d\u2019urgence europ\xE9en','Capitano':'Capitaine','Convoca la tua casata':'Convoquez votre maison',
    "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).":'Aucun match \xE0 couvrir pour le moment (n\xE9cessite un acc\xE8s capitaine et un calendrier g\xE9n\xE9r\xE9 par le staff).',
    'dispon.':'dispo.','Serve gente \u2014 convoca':'Besoin de joueurs \u2014 convoquer','Convoca giocatori':'Convoquer des joueurs','Chi copre le partite?':'Qui couvre les matchs ?',
    'Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.':'Rouge = moins de disponibles que le minimum. Touchez un match pour convoquer individuellement.',
    'disponibile':'disponible','non disp.':'indispo.','in attesa':'en attente','Convoca i giocatori':'Convoquer les joueurs',
    'servono':'il faut','disponibili':'disponibles','Spunta chi vuoi convocare.':'Cochez qui vous voulez convoquer.',
    'Convoca i selezionati':'Convoquer les s\xE9lectionn\xE9s','\u2190 Torna alle partite':'\u2190 Retour aux matchs','Seleziona almeno un giocatore':'S\xE9lectionnez au moins un joueur',
    'Convocati':'Convoqu\xE9s','giocatori':'joueurs','Non riesco a convocare ora':'Impossible de convoquer maintenant',
    'Rilancia la sfida ai tuoi. Forza':'Relancez le d\xE9fi aux v\xF4tres. Allez','Condividi con la casata':'Partager avec la maison','Vincitore:':'Vainqueur :','Condividi':'Partager',
    'Testo copiato: incollalo nel gruppo':'Texte copi\xE9 : collez-le dans le groupe','Presenza confermata':'Pr\xE9sence confirm\xE9e',
    'Prenotazione non riuscita: riprova':'\xC9chec de la r\xE9servation : r\xE9essayez','Prenotazione registrata':'R\xE9servation enregistr\xE9e','pers.':'pers.',
    'Serata su prenotazione':'Soir\xE9e sur r\xE9servation','Quota':'Participation','Posti disponibili':'Places disponibles','Posti esauriti per questa serata.':'Complet pour cette soir\xE9e.',
    'Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriver\xE0 pi\xF9 avanti).':'R\xE9servation \xE0 places limit\xE9es : la participation se r\xE8gle en caisse \xE0 la confirmation (le paiement in-app arrivera plus tard).',
    'Sei in lista per':'Vous \xEAtes sur la liste pour','da saldare in cassa':'\xE0 r\xE9gler en caisse','da saldare':'\xE0 r\xE9gler','la serata':'la soir\xE9e',
    'La tua proposta \xE8 in lista':'Votre proposition est sur la liste','Sei in scaletta per domenica':'Vous \xEAtes au programme de dimanche','Lingua impostata':'Langue d\xE9finie',
    'siamo':'nous sommes','punti':'points','Forza':'Allez','la nostra casata':'notre maison','La sfida di venerd\xEC':'Le d\xE9fi de vendredi','prossimamente':'bient\xF4t',
  },
  de: {
    'Casata':'Haus','Benvenuto alla Bussola':'Willkommen in La Bussola','Benvenuti alla Bussola':'Willkommen in La Bussola',
    'Proponi':'Vorschlagen','Salgo':'Auf die B\xFChne','Coppa':'Pokal','Info':'Info','Vedi':'Ansehen','Stasera alla Bussola':'Heute Abend in La Bussola',
    'Prenota':'Buchen','Campi':'Pl\xE4tze','prenota o partita':'buchen oder Spiel','Partite aperte':'Offene Spiele','unisciti':'mitmachen',
    'Coworking':'Coworking','postazione':'Arbeitsplatz','Questa settimana':'Diese Woche','Serate su prenotazione':'Abende auf Reservierung',
    'a persona':'pro Person','posti':'Pl\xE4tze','Il cartellone':'Das Programm','Il programma':'Das Programm',
    'Tocca una serata per i dettagli e per prenotare.':'Tippen Sie auf einen Abend f\xFCr Details und zum Buchen.',
    'Il pomeriggio \xE8 dello sport e delle famiglie; la sera, gli spettacoli che accompagnano la cena.':'Der Nachmittag geh\xF6rt dem Sport und den Familien; am Abend die Shows zum Abendessen.',
    'Serata dei Clan \xB7 Contest':'Clan-Abend \xB7 Contest','Apri il contest':'Contest \xF6ffnen','Strumenti del capitano':'Kapit\xE4n-Tools',
    'Convoca la casata':'Haus einberufen','Serata dei Clan':'Clan-Abend','La comunit\xE0':'Die Gemeinschaft','Coppa delle Casate':'H\xE4user-Pokal',
    'La tua casata':'Ihr Haus','posto':'Platz','Classifica generale':'Gesamtwertung','Campionati sport':'Sportmeisterschaften',
    'Gironi, calendario e risultati.':'Gruppen, Spielplan und Ergebnisse.','Apri':'\xD6ffnen','Giochi da Tavolo':'Brettspiele',
    'Burraco, scala 40, briscola, scacchi.':'Burraco, Scala 40, Briscola, Schach.',"Regolamenti & Albo d'Oro":'Regeln & Ehrentafel',
    'Regole di Coppa, Contest e Proposte; le edizioni passate.':'Regeln zu Pokal, Contest und Vorschl\xE4gen; fr\xFChere Ausgaben.',
    "Albo d'Oro":'Ehrentafel','Regole & storia':'Regeln & Geschichte','Regolamenti':'Regeln',
    'Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.':'Die Regeln f\xFCr Pokal, Contest und Vorschl\xE4ge sowie die Regelwerke der laufenden Disziplinen.',
    'Nessun regolamento generale.':'Keine allgemeinen Regeln.','Discipline':'Disziplinen','Chiudi':'Schlie\xDFen',
    'Calendario non ancora disponibile.':'Kalender noch nicht verf\xFCgbar.','Nessun periodo configurato.':'Kein Zeitraum konfiguriert.',
    'Conferimento':'Abgabe','Ritiro dalle':'Abholung ab',
    'Lun':'Mo','Mar':'Di','Mer':'Mi','Gio':'Do','Ven':'Fr','Sab':'Sa','Dom':'So',
    'Guida del residence':'Residenz-Guide','Silenzio pomeridiano':'Mittagsruhe','Silenzio notturno':'Nachtruhe',
    'Numeri utili & servizi':'N\xFCtzliche Nummern & Dienste','Raccolta rifiuti':'M\xFCllabfuhr','Cosa vedere':'Sehenswertes',
    'Presenza confermata \u2713':'Teilnahme best\xE4tigt \u2713','Convocazione vincolante':'Verbindliche Einberufung',
    'Hai gi\xE0 declinato tre volte in stagione: questa convocazione \xE8 vincolante.':'Sie haben diese Saison bereits dreimal abgesagt: Diese Einberufung ist verbindlich.',
    'Confermo':'Best\xE4tigen','Hai declinato':'Sie haben abgesagt','dinieghi':'Absagen','Ci ripenso':'Doch dabei',
    'Sei nostro ospite: partecipa quando vuoi, nessun obbligo.':'Sie sind unser Gast: Machen Sie mit, wann Sie m\xF6chten, ohne Verpflichtung.',
    'Dinieghi:':'Absagen:','diventa vincolante solo dopo il terzo':'wird erst nach dem dritten verbindlich',
    'La tua casata ti invita':'Ihr Haus l\xE4dt Sie ein','Disponibile':'Verf\xFCgbar','Non disponibile':'Nicht verf\xFCgbar',
    'Squadra':'Team','PG':'Sp','V':'S','Pt':'Pkt','Prossime partite':'N\xE4chste Spiele','Calendario in aggiornamento.':'Spielplan wird aktualisiert.',
    'Risultati recenti':'Aktuelle Ergebnisse','Nessun risultato ancora.':'Noch keine Ergebnisse.',
    'Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.':'Jedes Spiel aktualisiert die Pokalwertung. Format: Gruppen, dann Halbfinale und Finale.',
    'Campionati sociali':'Vereinsmeisterschaften','Tornei':'Turniere','Sport & Tornei':'Sport & Turniere','Oggi':'Heute','Domani':'Morgen',
    'Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.':'Begrenzte Pl\xE4tze: max. 8 vormittags und 8 nachmittags. Der <b>ganze Tag</b> belegt einen Platz in beiden Zeitfenstern.',
    'Quante persone':'Wie viele Personen','Prenotazione':'Buchung','Giorno':'Tag','Turno':'Zeitfenster','Conferma prenotazione':'Buchung best\xE4tigen','Annulla':'Abbrechen',
    'Prenotazione campi disponibile solo online':'Platzbuchung nur online verf\xFCgbar','Disponibile solo online':'Nur online verf\xFCgbar','Libero':'Frei','Partita':'Spiel','Partita aperta':'Offenes Spiel',
    'AL COMPLETO':'VOLL','Unisciti':'Mitmachen','Occupato':'Belegt','prenotato':'gebucht','OCCUPATO':'BELEGT','Prenotazione campi':'Platzbuchung',
    'Campo':'Platz','Fasce orarie':'Zeitfenster','Nessuno slot per questa data.':'Keine Zeitfenster f\xFCr dieses Datum.',
    '\u201CPrenota\u201D blocca lo slot per te. \u201CPartita\u201D apre una <b>partita aperta</b>: altri soci possono unirsi finch\xE9 non \xE8 al completo.':'\u201EBuchen\u201C reserviert das Zeitfenster f\xFCr Sie. \u201ESpiel\u201C \xF6ffnet ein <b>offenes Spiel</b>: Andere Mitglieder k\xF6nnen mitmachen, bis es voll ist.',
    'manca':'fehlt','mancano':'fehlen','Gioca con gli altri':'Mit anderen spielen',
    'Unisciti a una partita con posti liberi: quando si completa, \xE8 fatta.':'Treten Sie einem Spiel mit freien Pl\xE4tzen bei: Sobald es voll ist, geht\u2019s los.',
    'Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!':'Derzeit keine offenen Spiele. Starten Sie selbst eines im Bereich Pl\xE4tze!',
    'Prenotazione non riuscita':'Buchung fehlgeschlagen','Errore di rete':'Netzwerkfehler','Campo prenotato':'Platz gebucht',
    'Apri una partita alle':'Ein Spiel \xF6ffnen um','con':'mit','posti? Gli altri soci potranno unirsi.':'Pl\xE4tzen? Andere Mitglieder k\xF6nnen mitmachen.',
    'Non riuscito':'Fehlgeschlagen','Partita al completo, ci vediamo in campo! \u{1F3BE}':'Spiel voll, wir sehen uns auf dem Platz! \u{1F3BE}','Iscritto!':'Angemeldet!',
    'Le mie notifiche':'Meine Benachrichtigungen','Nessuna notifica.':'Keine Benachrichtigungen.','nuovo':'neu','Le tue convocazioni':'Ihre Einberufungen',
    'Ci sono':'Ich bin dabei','No':'Nein','Socio':'Mitglied','Tessera':'Karte','Valida fino al':'G\xFCltig bis','Notifiche casata & eventi':'Haus- & Event-Benachrichtigungen',
    'Convocazioni, cambi orario e serate. Con il tuo consenso.':'Einberufungen, Termin\xE4nderungen und Abende. Mit Ihrer Zustimmung.',
    'Attive \u2713':'Aktiv \u2713','Attiva':'Aktivieren','Cosa ti d\xE0':'Was es Ihnen bringt','Giochi la Coppa delle Casate':'Sie spielen den H\xE4user-Pokal',
    'Sport, giochi da tavolo e prove artistiche con il tuo clan.':'Sport, Brettspiele und k\xFCnstlerische Wettbewerbe mit Ihrem Clan.',
    'Inviti della casata':'Haus-Einladungen',
    'Rispondi disponibile o no, senza biglietto n\xE9 consumazione obbligatoria.':'Antworten Sie verf\xFCgbar oder nicht, ohne Ticket oder Verzehrzwang.',
    'Copertura infortuni':'Unfallversicherung','in definizione':'in Kl\xE4rung',
    'Stiamo valutando con la compagnia una copertura per le attivit\xE0 sportive.':'Wir pr\xFCfen mit der Versicherung eine Deckung f\xFCr Sportaktivit\xE4ten.',
    "Il tuo posto nell'Albo d'Oro":'Ihr Platz auf der Ehrentafel','I vincitori della stagione restano scritti alla Bussola.':'Die Sieger der Saison bleiben in La Bussola verzeichnet.',
    'Esci / cambia tessera':'Abmelden / Karte wechseln','Accesso':'Anmeldung','Entra con la tua e-mail':'Mit Ihrer E-Mail anmelden',
    'Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.':'Wir senden Ihnen einen Einmalcode (OTP) oder einen Magic Link. Kein Passwort zu merken.',
    'La tua e-mail':'Ihre E-Mail','Invia il codice':'Code senden','Inserisci un\u2019e-mail valida':'Geben Sie eine g\xFCltige E-Mail ein',
    'Verifica':'Verifizierung','Inserisci il codice':'Code eingeben','Ti abbiamo inviato un codice a':'Wir haben einen Code gesendet an',
    'Modalit\xE0 test: il codice \xE8':'Testmodus: Der Code lautet','(in produzione arriva via e-mail/SMS).':'(in der Produktion kommt er per E-Mail/SMS).',
    'Codice a 6 cifre':'6-stelliger Code','Entra':'Anmelden','Cambia e-mail':'E-Mail \xE4ndern','Codice non valido o scaduto':'Ung\xFCltiger oder abgelaufener Code',
    'Bentornato,':'Willkommen zur\xFCck,','Inserisci il codice tessera.':'Geben Sie den Kartencode ein.',
    'Tessera non trovata. Controlla il codice o usa l\u2019e-mail.':'Karte nicht gefunden. Pr\xFCfen Sie den Code oder nutzen Sie die E-Mail.',
    'Notifiche attivate: ti avviseremo per casata ed eventi':'Benachrichtigungen aktiv: Wir informieren Sie \xFCber Haus und Events','Notifiche disattivate':'Benachrichtigungen deaktiviert',
    'Marted\xEC':'Dienstag','Proponi un vinile':'Eine Platte vorschlagen',
    'Le proposte di questa settimana diventano la scaletta di marted\xEC prossimo.':'Die Vorschl\xE4ge dieser Woche werden zur Playlist des n\xE4chsten Dienstags.',
    'Quale vinile?':'Welche Platte?','Es. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4':'z. B. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4',
    'I brani che vuoi ascoltare':'Die Titel, die Sie h\xF6ren m\xF6chten','Es. Cr\xEAuza de m\xE4, Sid\xFAn':'z. B. Cr\xEAuza de m\xE4, Sid\xFAn',
    'Perch\xE9 lo proponi?':'Warum schlagen Sie sie vor?','In due righe cosa significa per te...':'In zwei Zeilen, was es Ihnen bedeutet...',
    'Invia la proposta':'Vorschlag senden','Domenica':'Sonntag','Salgo sul palco':'Ich gehe auf die B\xFChne',
    'Hai tre minuti. Scegli cosa porti sul Bussola Stage.':'Sie haben drei Minuten. W\xE4hlen Sie, was Sie auf die Bussola Stage bringen.',
    'La tua esibizione':'Ihr Auftritt','Canto':'Gesang','Monologo':'Monolog','Strumento':'Instrument','Titolo / cosa presenti':'Titel / was Sie pr\xE4sentieren',
    "Es. 'Caruso' alla chitarra":'z. B. \u201ACaruso\u2018 auf der Gitarre',
    'La stand-up \xE8 benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.':'Stand-up ist willkommen, mit gem\xE4\xDFigter Sprache: In La Bussola sind auch Familien.',
    'Prenota i miei tre minuti':'Meine drei Minuten buchen','Fatto!':'Fertig!','Un momento':'Einen Moment',
    ". Lo trovi nell'app e te lo ricordiamo noi.":'. Sie finden es in der App und wir erinnern Sie.','Perfetto':'Perfekt','Ho capito':'Verstanden',
    'Scegli la lingua':'Sprache w\xE4hlen',"Scegli la lingua dell'app":'App-Sprache w\xE4hlen',
    'Numeri utili':'N\xFCtzliche Nummern','Emergenze & servizi':'Notf\xE4lle & Dienste','In caso di necessit\xE0.':'Im Bedarfsfall.',
    'Emergenze (112)':'Notruf (112)','Numero unico europeo':'Einheitliche europ\xE4ische Notrufnummer','Capitano':'Kapit\xE4n','Convoca la tua casata':'Rufen Sie Ihr Haus ein',
    "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).":'Derzeit keine Spiele zu besetzen (erfordert Kapit\xE4n-Zugang und einen vom Staff erstellten Spielplan).',
    'dispon.':'verf.','Serve gente \u2014 convoca':'Spieler n\xF6tig \u2014 einberufen','Convoca giocatori':'Spieler einberufen','Chi copre le partite?':'Wer besetzt die Spiele?',
    'Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.':'Rot = weniger Verf\xFCgbare als das Minimum. Tippen Sie auf ein Spiel, um einzeln einzuberufen.',
    'disponibile':'verf\xFCgbar','non disp.':'nicht verf.','in attesa':'ausstehend','Convoca i giocatori':'Spieler einberufen',
    'servono':'ben\xF6tigt','disponibili':'verf\xFCgbar','Spunta chi vuoi convocare.':'W\xE4hlen Sie aus, wen Sie einberufen m\xF6chten.',
    'Convoca i selezionati':'Ausgew\xE4hlte einberufen','\u2190 Torna alle partite':'\u2190 Zur\xFCck zu den Spielen','Seleziona almeno un giocatore':'W\xE4hlen Sie mindestens einen Spieler',
    'Convocati':'Einberufen','giocatori':'Spieler','Non riesco a convocare ora':'Einberufung derzeit nicht m\xF6glich',
    'Rilancia la sfida ai tuoi. Forza':'Fordern Sie die Ihren heraus. Los','Condividi con la casata':'Mit dem Haus teilen','Vincitore:':'Sieger:','Condividi':'Teilen',
    'Testo copiato: incollalo nel gruppo':'Text kopiert: F\xFCgen Sie ihn in die Gruppe ein','Presenza confermata':'Teilnahme best\xE4tigt',
    'Prenotazione non riuscita: riprova':'Buchung fehlgeschlagen: erneut versuchen','Prenotazione registrata':'Buchung erfasst','pers.':'Pers.',
    'Serata su prenotazione':'Abend auf Reservierung','Quota':'Beitrag','Posti disponibili':'Verf\xFCgbare Pl\xE4tze','Posti esauriti per questa serata.':'Ausverkauft f\xFCr diesen Abend.',
    'Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriver\xE0 pi\xF9 avanti).':'Buchung mit begrenzter Platzzahl: Der Beitrag wird bei Best\xE4tigung an der Kasse bezahlt (In-App-Zahlung folgt sp\xE4ter).',
    'Sei in lista per':'Sie stehen auf der Liste f\xFCr','da saldare in cassa':'an der Kasse zu zahlen','da saldare':'zu zahlen','la serata':'den Abend',
    'La tua proposta \xE8 in lista':'Ihr Vorschlag ist auf der Liste','Sei in scaletta per domenica':'Sie stehen am Sonntag auf dem Programm','Lingua impostata':'Sprache eingestellt',
    'siamo':'wir sind','punti':'Punkte','Forza':'Los','la nostra casata':'unser Haus','La sfida di venerd\xEC':'Die Freitags-Herausforderung','prossimamente':'demn\xE4chst',
  },
  es: {
    'Casata':'Casa','Benvenuto alla Bussola':'Bienvenido a La Bussola','Benvenuti alla Bussola':'Bienvenidos a La Bussola',
    'Proponi':'Proponer','Salgo':'Al escenario','Coppa':'Copa','Info':'Info','Vedi':'Ver','Stasera alla Bussola':'Esta noche en La Bussola',
    'Prenota':'Reservar','Campi':'Pistas','prenota o partita':'reserva o partido','Partite aperte':'Partidas abiertas','unisciti':'\xFAnete',
    'Coworking':'Coworking','postazione':'puesto','Questa settimana':'Esta semana','Serate su prenotazione':'Veladas con reserva',
    'a persona':'por persona','posti':'plazas','Il cartellone':'La cartelera','Il programma':'El programa',
    'Tocca una serata per i dettagli e per prenotare.':'Toca una velada para ver los detalles y reservar.',
    'Il pomeriggio \xE8 dello sport e delle famiglie; la sera, gli spettacoli che accompagnano la cena.':'La tarde es para el deporte y las familias; por la noche, los espect\xE1culos que acompa\xF1an la cena.',
    'Serata dei Clan \xB7 Contest':'Noche de los Clanes \xB7 Concurso','Apri il contest':'Abrir el concurso','Strumenti del capitano':'Herramientas del capit\xE1n',
    'Convoca la casata':'Convoca tu casa','Serata dei Clan':'Noche de los Clanes','La comunit\xE0':'La comunidad','Coppa delle Casate':'Copa de las Casas',
    'La tua casata':'Tu casa','posto':'puesto','Classifica generale':'Clasificaci\xF3n general','Campionati sport':'Campeonatos deportivos',
    'Gironi, calendario e risultati.':'Grupos, calendario y resultados.','Apri':'Abrir','Giochi da Tavolo':'Juegos de mesa',
    'Burraco, scala 40, briscola, scacchi.':'Burraco, Escala 40, Briscola, ajedrez.',"Regolamenti & Albo d'Oro":'Reglamentos y Palmar\xE9s',
    'Regole di Coppa, Contest e Proposte; le edizioni passate.':'Reglas de Copa, Concurso y Propuestas; ediciones pasadas.',
    "Albo d'Oro":'Palmar\xE9s','Regole & storia':'Reglas e historia','Regolamenti':'Reglamentos',
    'Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.':'Las reglas de la Copa, el Concurso y las Propuestas, y los reglamentos de las disciplinas en curso.',
    'Nessun regolamento generale.':'Sin reglamento general.','Discipline':'Disciplinas','Chiudi':'Cerrar',
    'Calendario non ancora disponibile.':'Calendario a\xFAn no disponible.','Nessun periodo configurato.':'Ning\xFAn periodo configurado.',
    'Conferimento':'Entrega','Ritiro dalle':'Recogida desde',
    'Lun':'Lun','Mar':'Mar','Mer':'Mi\xE9','Gio':'Jue','Ven':'Vie','Sab':'S\xE1b','Dom':'Dom',
    'Guida del residence':'Gu\xEDa del residence','Silenzio pomeridiano':'Silencio de la tarde','Silenzio notturno':'Silencio nocturno',
    'Numeri utili & servizi':'N\xFAmeros \xFAtiles y servicios','Raccolta rifiuti':'Recogida de residuos','Cosa vedere':'Qu\xE9 ver',
    'Presenza confermata \u2713':'Asistencia confirmada \u2713','Convocazione vincolante':'Convocatoria obligatoria',
    'Hai gi\xE0 declinato tre volte in stagione: questa convocazione \xE8 vincolante.':'Ya has rechazado tres veces esta temporada: esta convocatoria es obligatoria.',
    'Confermo':'Confirmo','Hai declinato':'Has rechazado','dinieghi':'rechazos','Ci ripenso':'Me lo repienso',
    'Sei nostro ospite: partecipa quando vuoi, nessun obbligo.':'Eres nuestro invitado: participa cuando quieras, sin obligaci\xF3n.',
    'Dinieghi:':'Rechazos:','diventa vincolante solo dopo il terzo':'se vuelve obligatoria solo tras el tercero',
    'La tua casata ti invita':'Tu casa te invita','Disponibile':'Disponible','Non disponibile':'No disponible',
    'Squadra':'Equipo','PG':'PJ','V':'V','Pt':'Pts','Prossime partite':'Pr\xF3ximos partidos','Calendario in aggiornamento.':'Calendario en actualizaci\xF3n.',
    'Risultati recenti':'Resultados recientes','Nessun risultato ancora.':'A\xFAn no hay resultados.',
    'Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.':'Cada partido actualiza la clasificaci\xF3n de la Copa. Formato: grupos, luego semifinales y final.',
    'Campionati sociali':'Campeonatos del club','Tornei':'Torneos','Sport & Tornei':'Deporte y Torneos','Oggi':'Hoy','Domani':'Ma\xF1ana',
    'Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.':'Plazas limitadas: m\xE1ximo 8 por la ma\xF1ana y 8 por la tarde. El <b>d\xEDa completo</b> ocupa una plaza en ambos turnos.',
    'Quante persone':'Cu\xE1ntas personas','Prenotazione':'Reserva','Giorno':'D\xEDa','Turno':'Turno','Conferma prenotazione':'Confirmar reserva','Annulla':'Cancelar',
    'Prenotazione campi disponibile solo online':'Reserva de pistas disponible solo en l\xEDnea','Disponibile solo online':'Disponible solo en l\xEDnea','Libero':'Libre','Partita':'Partido','Partita aperta':'Partida abierta',
    'AL COMPLETO':'COMPLETO','Unisciti':'Unirse','Occupato':'Ocupado','prenotato':'reservado','OCCUPATO':'OCUPADO','Prenotazione campi':'Reserva de pistas',
    'Campo':'Pista','Fasce orarie':'Franjas horarias','Nessuno slot per questa data.':'Sin franjas para esta fecha.',
    '\u201CPrenota\u201D blocca lo slot per te. \u201CPartita\u201D apre una <b>partita aperta</b>: altri soci possono unirsi finch\xE9 non \xE8 al completo.':'\u201CReservar\u201D bloquea la franja para ti. \u201CPartido\u201D abre una <b>partida abierta</b>: otros socios pueden unirse hasta que se complete.',
    'manca':'falta','mancano':'faltan','Gioca con gli altri':'Juega con los dem\xE1s',
    'Unisciti a una partita con posti liberi: quando si completa, \xE8 fatta.':'\xDAnete a una partida con plazas libres: cuando se completa, listo.',
    'Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!':'\xA1Ninguna partida abierta ahora mismo. Abre una t\xFA desde la secci\xF3n Pistas!',
    'Prenotazione non riuscita':'Reserva fallida','Errore di rete':'Error de red','Campo prenotato':'Pista reservada',
    'Apri una partita alle':'Abrir un partido a las','con':'con','posti? Gli altri soci potranno unirsi.':'plazas? Otros socios podr\xE1n unirse.',
    'Non riuscito':'No se pudo','Partita al completo, ci vediamo in campo! \u{1F3BE}':'\xA1Partida completa, nos vemos en la pista! \u{1F3BE}','Iscritto!':'\xA1Inscrito!',
    'Le mie notifiche':'Mis notificaciones','Nessuna notifica.':'Sin notificaciones.','nuovo':'nuevo','Le tue convocazioni':'Tus convocatorias',
    'Ci sono':'Cuenta conmigo','No':'No','Socio':'Socio','Tessera':'Tarjeta','Valida fino al':'V\xE1lida hasta el','Notifiche casata & eventi':'Notificaciones de casa y eventos',
    'Convocazioni, cambi orario e serate. Con il tuo consenso.':'Convocatorias, cambios de horario y veladas. Con tu consentimiento.',
    'Attive \u2713':'Activas \u2713','Attiva':'Activar','Cosa ti d\xE0':'Qu\xE9 te ofrece','Giochi la Coppa delle Casate':'Juegas la Copa de las Casas',
    'Sport, giochi da tavolo e prove artistiche con il tuo clan.':'Deporte, juegos de mesa y pruebas art\xEDsticas con tu clan.',
    'Inviti della casata':'Invitaciones de la casa',
    'Rispondi disponibile o no, senza biglietto n\xE9 consumazione obbligatoria.':'Responde disponible o no, sin entrada ni consumici\xF3n obligatoria.',
    'Copertura infortuni':'Cobertura de lesiones','in definizione':'en definici\xF3n',
    'Stiamo valutando con la compagnia una copertura per le attivit\xE0 sportive.':'Estamos evaluando con la compa\xF1\xEDa una cobertura para las actividades deportivas.',
    "Il tuo posto nell'Albo d'Oro":'Tu lugar en el Palmar\xE9s','I vincitori della stagione restano scritti alla Bussola.':'Los ganadores de la temporada quedan inscritos en La Bussola.',
    'Esci / cambia tessera':'Salir / cambiar tarjeta','Accesso':'Acceso','Entra con la tua e-mail':'Entra con tu correo',
    'Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.':'Te enviamos un c\xF3digo de un solo uso (OTP) o un enlace m\xE1gico. Sin contrase\xF1a que recordar.',
    'La tua e-mail':'Tu correo','Invia il codice':'Enviar el c\xF3digo','Inserisci un\u2019e-mail valida':'Introduce un correo v\xE1lido',
    'Verifica':'Verificaci\xF3n','Inserisci il codice':'Introduce el c\xF3digo','Ti abbiamo inviato un codice a':'Hemos enviado un c\xF3digo a',
    'Modalit\xE0 test: il codice \xE8':'Modo de prueba: el c\xF3digo es','(in produzione arriva via e-mail/SMS).':'(en producci\xF3n llega por correo/SMS).',
    'Codice a 6 cifre':'C\xF3digo de 6 cifras','Entra':'Entrar','Cambia e-mail':'Cambiar correo','Codice non valido o scaduto':'C\xF3digo no v\xE1lido o caducado',
    'Bentornato,':'Bienvenido de nuevo,','Inserisci il codice tessera.':'Introduce el c\xF3digo de la tarjeta.',
    'Tessera non trovata. Controlla il codice o usa l\u2019e-mail.':'Tarjeta no encontrada. Comprueba el c\xF3digo o usa el correo.',
    'Notifiche attivate: ti avviseremo per casata ed eventi':'Notificaciones activadas: te avisaremos sobre tu casa y los eventos','Notifiche disattivate':'Notificaciones desactivadas',
    'Marted\xEC':'Martes','Proponi un vinile':'Prop\xF3n un vinilo',
    'Le proposte di questa settimana diventano la scaletta di marted\xEC prossimo.':'Las propuestas de esta semana forman la lista del pr\xF3ximo martes.',
    'Quale vinile?':'\xBFQu\xE9 vinilo?','Es. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4':'Ej. Fabrizio De Andr\xE9 \u2014 Cr\xEAuza de m\xE4',
    'I brani che vuoi ascoltare':'Las canciones que quieres escuchar','Es. Cr\xEAuza de m\xE4, Sid\xFAn':'Ej. Cr\xEAuza de m\xE4, Sid\xFAn',
    'Perch\xE9 lo proponi?':'\xBFPor qu\xE9 lo propones?','In due righe cosa significa per te...':'En dos l\xEDneas, qu\xE9 significa para ti...',
    'Invia la proposta':'Enviar la propuesta','Domenica':'Domingo','Salgo sul palco':'Subo al escenario',
    'Hai tre minuti. Scegli cosa porti sul Bussola Stage.':'Tienes tres minutos. Elige qu\xE9 llevas al Bussola Stage.',
    'La tua esibizione':'Tu actuaci\xF3n','Canto':'Canto','Monologo':'Mon\xF3logo','Strumento':'Instrumento','Titolo / cosa presenti':'T\xEDtulo / qu\xE9 presentas',
    "Es. 'Caruso' alla chitarra":'Ej. \u2018Caruso\u2019 a la guitarra',
    'La stand-up \xE8 benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.':'El stand-up es bienvenido, con lenguaje moderado: en La Bussola tambi\xE9n hay familias.',
    'Prenota i miei tre minuti':'Reservar mis tres minutos','Fatto!':'\xA1Hecho!','Un momento':'Un momento',
    ". Lo trovi nell'app e te lo ricordiamo noi.":'. Lo tienes en la app y te lo recordamos.','Perfetto':'Perfecto','Ho capito':'Entendido',
    'Scegli la lingua':'Elige el idioma',"Scegli la lingua dell'app":'Elige el idioma de la app',
    'Numeri utili':'N\xFAmeros \xFAtiles','Emergenze & servizi':'Emergencias y servicios','In caso di necessit\xE0.':'En caso de necesidad.',
    'Emergenze (112)':'Emergencias (112)','Numero unico europeo':'N\xFAmero \xFAnico europeo','Capitano':'Capit\xE1n','Convoca la tua casata':'Convoca a tu casa',
    "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).":'Ning\xFAn partido que cubrir por ahora (requiere acceso de capit\xE1n y un calendario generado por el staff).',
    'dispon.':'disp.','Serve gente \u2014 convoca':'Faltan jugadores \u2014 convoca','Convoca giocatori':'Convocar jugadores','Chi copre le partite?':'\xBFQui\xE9n cubre los partidos?',
    'Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.':'Rojo = menos disponibles que el m\xEDnimo. Toca un partido para convocar individualmente.',
    'disponibile':'disponible','non disp.':'no disp.','in attesa':'pendiente','Convoca i giocatori':'Convocar a los jugadores',
    'servono':'hacen falta','disponibili':'disponibles','Spunta chi vuoi convocare.':'Marca a qui\xE9n quieres convocar.',
    'Convoca i selezionati':'Convocar a los seleccionados','\u2190 Torna alle partite':'\u2190 Volver a los partidos','Seleziona almeno un giocatore':'Selecciona al menos un jugador',
    'Convocati':'Convocados','giocatori':'jugadores','Non riesco a convocare ora':'No se puede convocar ahora',
    'Rilancia la sfida ai tuoi. Forza':'Lanza el reto a los tuyos. \xA1Vamos','Condividi con la casata':'Compartir con la casa','Vincitore:':'Ganador:','Condividi':'Compartir',
    'Testo copiato: incollalo nel gruppo':'Texto copiado: p\xE9galo en el grupo','Presenza confermata':'Asistencia confirmada',
    'Prenotazione non riuscita: riprova':'Reserva fallida: int\xE9ntalo de nuevo','Prenotazione registrata':'Reserva registrada','pers.':'pers.',
    'Serata su prenotazione':'Velada con reserva','Quota':'Cuota','Posti disponibili':'Plazas disponibles','Posti esauriti per questa serata.':'Plazas agotadas para esta velada.',
    'Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriver\xE0 pi\xF9 avanti).':'Reserva de plazas limitadas: la cuota se paga en caja al confirmar (el pago in-app llegar\xE1 m\xE1s adelante).',
    'Sei in lista per':'Est\xE1s en la lista para','da saldare in cassa':'a pagar en caja','da saldare':'a pagar','la serata':'la velada',
    'La tua proposta \xE8 in lista':'Tu propuesta est\xE1 en la lista','Sei in scaletta per domenica':'Est\xE1s en el programa del domingo','Lingua impostata':'Idioma establecido',
    'siamo':'estamos','punti':'puntos','Forza':'Vamos','la nostra casata':'nuestra casa','La sfida di venerd\xEC':'El reto del viernes','prossimamente':'pr\xF3ximamente',
  },
};
const UI_HOST = {
  en: { 'Casa mia': 'My stay', 'Le mie case': 'My properties', 'Come arrivare': 'Getting there', 'Regole della casa': 'House rules', 'Orario di check-out': 'Check-out time', 'Apri sulla mappa': 'Open on the map', 'Isolato': 'Block', 'Numero': 'Number', 'Il tuo soggiorno': 'Your stay', 'Aggiungi struttura': 'Add property', 'Modifica': 'Edit', 'Elimina': 'Delete', 'Nome struttura': 'Property name', 'Regole': 'Rules', 'Le tue strutture': 'Your properties', 'Non hai ancora aggiunto strutture.': "You haven't added any properties yet.", 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'The information is encrypted: visible only to you and your linked guests.', 'Dati della struttura non disponibili': 'Property data unavailable', 'dal': 'from', 'al': 'to', 'Gestisci le case vacanza che ospiti nel residence.': 'Manage the holiday homes you host in the residence.', 'Come raggiungere la casa e le regole del soggiorno.': 'How to reach the house and the stay rules.' },
  fr: { 'Casa mia': 'Mon logement', 'Le mie case': 'Mes logements', 'Come arrivare': 'Y arriver', 'Regole della casa': 'R\xE8glement int\xE9rieur', 'Orario di check-out': 'Heure de d\xE9part', 'Apri sulla mappa': 'Ouvrir sur la carte', 'Isolato': '\xCElot', 'Numero': 'Num\xE9ro', 'Il tuo soggiorno': 'Votre s\xE9jour', 'Aggiungi struttura': 'Ajouter un logement', 'Modifica': 'Modifier', 'Elimina': 'Supprimer', 'Nome struttura': 'Nom du logement', 'Regole': 'R\xE8gles', 'Le tue strutture': 'Vos logements', 'Non hai ancora aggiunto strutture.': "Vous n'avez pas encore ajout\xE9 de logement.", 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'Les informations sont chiffr\xE9es : visibles uniquement par vous et vos invit\xE9s li\xE9s.', 'Dati della struttura non disponibili': 'Donn\xE9es du logement indisponibles', 'dal': 'du', 'al': 'au', 'Gestisci le case vacanza che ospiti nel residence.': 'G\xE9rez les logements que vous accueillez dans la r\xE9sidence.', 'Come raggiungere la casa e le regole del soggiorno.': "Comment rejoindre le logement et le r\xE8glement du s\xE9jour." },
  de: { 'Casa mia': 'Meine Unterkunft', 'Le mie case': 'Meine Unterk\xFCnfte', 'Come arrivare': 'Anfahrt', 'Regole della casa': 'Hausordnung', 'Orario di check-out': 'Check-out-Zeit', 'Apri sulla mappa': 'Auf der Karte \xF6ffnen', 'Isolato': 'Block', 'Numero': 'Nummer', 'Il tuo soggiorno': 'Ihr Aufenthalt', 'Aggiungi struttura': 'Unterkunft hinzuf\xFCgen', 'Modifica': 'Bearbeiten', 'Elimina': 'L\xF6schen', 'Nome struttura': 'Name der Unterkunft', 'Regole': 'Regeln', 'Le tue strutture': 'Ihre Unterk\xFCnfte', 'Non hai ancora aggiunto strutture.': 'Sie haben noch keine Unterkunft hinzugef\xFCgt.', 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'Die Daten sind verschl\xFCsselt: nur f\xFCr Sie und Ihre verkn\xFCpften G\xE4ste sichtbar.', 'Dati della struttura non disponibili': 'Unterkunftsdaten nicht verf\xFCgbar', 'dal': 'vom', 'al': 'bis', 'Gestisci le case vacanza che ospiti nel residence.': 'Verwalten Sie die Ferienwohnungen, die Sie in der Anlage anbieten.', 'Come raggiungere la casa e le regole del soggiorno.': 'Wie Sie die Unterkunft erreichen und die Aufenthaltsregeln.' },
  es: { 'Casa mia': 'Mi alojamiento', 'Le mie case': 'Mis alojamientos', 'Come arrivare': 'C\xF3mo llegar', 'Regole della casa': 'Normas de la casa', 'Orario di check-out': 'Hora de salida', 'Apri sulla mappa': 'Abrir en el mapa', 'Isolato': 'Manzana', 'Numero': 'N\xFAmero', 'Il tuo soggiorno': 'Tu estancia', 'Aggiungi struttura': 'A\xF1adir alojamiento', 'Modifica': 'Editar', 'Elimina': 'Eliminar', 'Nome struttura': 'Nombre del alojamiento', 'Regole': 'Normas', 'Le tue strutture': 'Tus alojamientos', 'Non hai ancora aggiunto strutture.': 'A\xFAn no has a\xF1adido alojamientos.', 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'La informaci\xF3n est\xE1 cifrada: visible solo para ti y tus hu\xE9spedes vinculados.', 'Dati della struttura non disponibili': 'Datos del alojamiento no disponibles', 'dal': 'del', 'al': 'al', 'Gestisci le case vacanza che ospiti nel residence.': 'Gestiona las casas vacacionales que alojas en el residence.', 'Come raggiungere la casa e le regole del soggiorno.': 'C\xF3mo llegar a la casa y las normas de la estancia.' },
};

// --- Traduzioni stringhe v4.20\u2192v4.36 (registrazione, host, onboarding, self-order, comanda, eventi) ---
const UI_EXTRA = {"en":{"Ingresso libero":"Free entry","A quale casa lo colleghi?":"Which house do you link them to?","Abbiamo avvisato":"We've notified","Accetto il trattamento dei dati (privacy)":"I accept the processing of my data (privacy)","Aggiungi alla Home":"Add to Home","Aggiungi alla schermata Home":"Add to Home screen","Aggiungi la tua casa vacanza: potrai accogliere i visitatori.":"Add your holiday home: you'll be able to welcome visitors.","Aggiungi prima la tua casa, poi conferma l'ospite.":"Add your home first, then confirm the guest.","Benvenuto nella casata":"Welcome to the house","Benvenuto!":"Welcome!","Cambia casata":"Change house","Cerca chi ti ospita: ricever\xE0 una notifica e, se conferma, vedrai \\"Casa mia\\".":"Search for who's hosting you: they'll get a notification and, if they confirm, you'll see \\"My Home\\".","Chi sei?":"Who are you?","Chi ti ospita?":"Who is hosting you?","Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.":"Whoever wants to be your guest registers and searches for you by name: here you confirm and link them to the home.","Codice di accesso":"Access code","Cognome":"Surname","Collega":"Link","Collega la tua casa":"Link your home","Comanda":"Order","Conferma":"Confirm","Conosci il tuo host?":"Do you know your host?","Cos\xEC resta sul telefono con la sua icona, senza cercarla ogni volta.":"This way it stays on your phone with its icon, no need to look for it each time.","Crea profilo":"Create profile","Fatto":"Done","Ho gi\xE0 un account":"I already have an account","I miei visitatori":"My visitors","I tuoi dati":"Your details","Il consenso privacy \xE8 necessario per registrarsi":"Privacy consent is required to register","Il tuo codice di accesso":"Your access code","Il tuo host":"Your host","Il tuo profilo \xE8 attivo. Conserva il tuo codice per accedere anche senza e-mail:":"Your profile is active. Keep your code to log in even without e-mail:","In attesa di conferma":"Awaiting confirmation","Indica chi ti ospita per vedere indicazioni e regole del soggiorno.":"Tell us who's hosting you to see stay directions and rules.","Indietro":"Back","Inizia":"Start","Installa l\u2019app":"Install the app","Invia ordine":"Send order","Men\xF9 non disponibile":"Menu not available","Nessun host trovato con questo nome.":"No host found with this name.","Nessun visitatore collegato.":"No visitor linked.","Nome":"Name","Nome e cognome obbligatori":"Name and surname required","Nome o cognome dell'host":"Host's first or last name","Non lo conosco ora \xB7 salta":"I don't know it now \xB7 skip","Ogni casata accoglie fino a 12 soci. Se \xE8 al completo, scegline un\u2019altra.":"Each house holds up to 12 members. If it's full, choose another.","Ordina":"Order","Ordina e ritira al punto":"Order and collect at the point","Ordine inviato":"Order sent","Ospite collegato":"Guest linked","Ospite temporaneo: ti colleghi alla casa del tuo host.":"Temporary guest: you link to your host's home.","Pi\xF9 tardi":"Later","Punto":"Point","Quando confermer\xE0, comparir\xE0 \\"Casa mia\\" con tutte le indicazioni della struttura.":"When they confirm, \\"My Home\\" will appear with all the property's directions.","Registrati":"Sign up","Registrazione non riuscita":"Registration failed","Richiesta inviata":"Request sent","Richieste in attesa":"Pending requests","Rispondi e l'app trova il profilo giusto per te.":"Answer and the app finds the right profile for you.","Salva":"Save","Salva la tua tessera (immagine)":"Save your card (image)","Salva tessera":"Save card","Scegli":"Choose","Scegli la casata":"Choose the house","Scegli la tua casata":"Choose your house","Scollega":"Unlink","Scollegare questo visitatore dalla casa?":"Unlink this visitor from the home?","Serve per accedere di nuovo con un codice via e-mail.":"It's used to log in again with a code via e-mail.","Soggiorno dal":"Stay from","Sono in vacanza (visitatore)":"I'm on holiday (visitor)","Sono residente":"I'm a resident","Sono socio KOIN\xC8":"I'm a KOIN\xC8 member","Sono socio e residente":"I'm a member and resident","Su Android (Chrome): tocca il menu (\u22EE) in alto a destra, poi \u201CAggiungi a schermata Home\u201D / \u201CInstalla app\u201D.":"On Android (Chrome): tap the menu (\u22EE) at the top right, then \\"Add to Home screen\\" / \\"Install app\\".","Su iPhone/iPad (Safari): tocca Condividi (\u2B06\uFE0F) in basso, poi \u201CAggiungi a Home\u201D.":"On iPhone/iPad (Safari): tap Share (\u2B06\uFE0F) at the bottom, then \\"Add to Home\\".","Tessera salvata nelle immagini":"Card saved to your photos","Tesserato: casata, Coppa, inviti.":"Member: house, Cup, invitations.","Tieni l\u2019app a portata di mano":"Keep the app within reach","Tutto del socio (casata, Coppa) + gestisco case vacanza.":"Everything a member has (house, Cup) + I manage holiday homes.","Tutto pronto":"All set","Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.":"A visitor has indicated you as host: confirm to link them to the home.","Vivo nel residence; posso gestire case vacanza.":"I live in the residence; I can manage holiday homes.","al completo":"full","bar & garden":"bar & garden","dice di essere tuo ospite":"says they're your guest","es. Chiara":"e.g. Chiara","la tua":"yours","prodotti":"items","si paga in cassa. Ti avvisiamo quando \xE8 pronto.":"pay at the till. We'll let you know when it's ready.","soci":"members","\xC8 lui/lei":"That's them"},"fr":{"Ingresso libero":"Entr\xE9e libre","A quale casa lo colleghi?":"\xC0 quelle maison le rattaches-tu ?","Abbiamo avvisato":"Nous avons pr\xE9venu","Accetto il trattamento dei dati (privacy)":"J'accepte le traitement de mes donn\xE9es (confidentialit\xE9)","Aggiungi alla Home":"Ajouter \xE0 l'accueil","Aggiungi alla schermata Home":"Ajouter \xE0 l'\xE9cran d'accueil","Aggiungi la tua casa vacanza: potrai accogliere i visitatori.":"Ajoute ta maison de vacances : tu pourras accueillir des visiteurs.","Aggiungi prima la tua casa, poi conferma l'ospite.":"Ajoute d'abord ta maison, puis confirme l'invit\xE9.","Benvenuto nella casata":"Bienvenue dans la maison","Benvenuto!":"Bienvenue !","Cambia casata":"Changer de maison","Cerca chi ti ospita: ricever\xE0 una notifica e, se conferma, vedrai \\"Casa mia\\".":"Cherche qui t'h\xE9berge : la personne recevra une notification et, si elle confirme, tu verras \xAB Ma maison \xBB.","Chi sei?":"Qui es-tu ?","Chi ti ospita?":"Qui t'h\xE9berge ?","Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.":"Celui qui veut \xEAtre ton invit\xE9 s'inscrit et te cherche par nom : ici tu confirmes et le rattaches \xE0 la maison.","Codice di accesso":"Code d'acc\xE8s","Cognome":"Nom","Collega":"Rattacher","Collega la tua casa":"Rattache ta maison","Comanda":"Commande","Conferma":"Confirmer","Conosci il tuo host?":"Connais-tu ton h\xF4te ?","Cos\xEC resta sul telefono con la sua icona, senza cercarla ogni volta.":"Ainsi elle reste sur ton t\xE9l\xE9phone avec son ic\xF4ne, sans la chercher \xE0 chaque fois.","Crea profilo":"Cr\xE9er un profil","Fatto":"Termin\xE9","Ho gi\xE0 un account":"J'ai d\xE9j\xE0 un compte","I miei visitatori":"Mes visiteurs","I tuoi dati":"Tes informations","Il consenso privacy \xE8 necessario per registrarsi":"Le consentement \xE0 la confidentialit\xE9 est n\xE9cessaire pour s'inscrire","Il tuo codice di accesso":"Ton code d'acc\xE8s","Il tuo host":"Ton h\xF4te","Il tuo profilo \xE8 attivo. Conserva il tuo codice per accedere anche senza e-mail:":"Ton profil est actif. Conserve ton code pour te connecter m\xEAme sans e-mail :","In attesa di conferma":"En attente de confirmation","Indica chi ti ospita per vedere indicazioni e regole del soggiorno.":"Indique qui t'h\xE9berge pour voir les indications et r\xE8gles du s\xE9jour.","Indietro":"Retour","Inizia":"Commencer","Installa l\u2019app":"Installer l'appli","Invia ordine":"Envoyer la commande","Men\xF9 non disponibile":"Menu non disponible","Nessun host trovato con questo nome.":"Aucun h\xF4te trouv\xE9 avec ce nom.","Nessun visitatore collegato.":"Aucun visiteur rattach\xE9.","Nome":"Pr\xE9nom","Nome e cognome obbligatori":"Pr\xE9nom et nom obligatoires","Nome o cognome dell'host":"Pr\xE9nom ou nom de l'h\xF4te","Non lo conosco ora \xB7 salta":"Je ne le connais pas maintenant \xB7 passer","Ogni casata accoglie fino a 12 soci. Se \xE8 al completo, scegline un\u2019altra.":"Chaque maison accueille jusqu'\xE0 12 membres. Si elle est compl\xE8te, choisis-en une autre.","Ordina":"Commander","Ordina e ritira al punto":"Commande et retire au point","Ordine inviato":"Commande envoy\xE9e","Ospite collegato":"Invit\xE9 rattach\xE9","Ospite temporaneo: ti colleghi alla casa del tuo host.":"Invit\xE9 temporaire : tu te rattaches \xE0 la maison de ton h\xF4te.","Pi\xF9 tardi":"Plus tard","Punto":"Point","Quando confermer\xE0, comparir\xE0 \\"Casa mia\\" con tutte le indicazioni della struttura.":"Quand la personne confirmera, \xAB Ma maison \xBB appara\xEEtra avec toutes les indications du logement.","Registrati":"S'inscrire","Registrazione non riuscita":"\xC9chec de l'inscription","Richiesta inviata":"Demande envoy\xE9e","Richieste in attesa":"Demandes en attente","Rispondi e l'app trova il profilo giusto per te.":"R\xE9ponds et l'appli trouve le profil qui te convient.","Salva":"Enregistrer","Salva la tua tessera (immagine)":"Enregistre ta carte (image)","Salva tessera":"Enregistrer la carte","Scegli":"Choisir","Scegli la casata":"Choisis la maison","Scegli la tua casata":"Choisis ta maison","Scollega":"D\xE9tacher","Scollegare questo visitatore dalla casa?":"D\xE9tacher ce visiteur de la maison ?","Serve per accedere di nuovo con un codice via e-mail.":"Il sert \xE0 te reconnecter avec un code par e-mail.","Soggiorno dal":"S\xE9jour du","Sono in vacanza (visitatore)":"Je suis en vacances (visiteur)","Sono residente":"Je suis r\xE9sident","Sono socio KOIN\xC8":"Je suis membre KOIN\xC8","Sono socio e residente":"Je suis membre et r\xE9sident","Su Android (Chrome): tocca il menu (\u22EE) in alto a destra, poi \u201CAggiungi a schermata Home\u201D / \u201CInstalla app\u201D.":"Sur Android (Chrome) : touche le menu (\u22EE) en haut \xE0 droite, puis \xAB Ajouter \xE0 l'\xE9cran d'accueil \xBB / \xAB Installer l'appli \xBB.","Su iPhone/iPad (Safari): tocca Condividi (\u2B06\uFE0F) in basso, poi \u201CAggiungi a Home\u201D.":"Sur iPhone/iPad (Safari) : touche Partager (\u2B06\uFE0F) en bas, puis \xAB Sur l'\xE9cran d'accueil \xBB.","Tessera salvata nelle immagini":"Carte enregistr\xE9e dans les photos","Tesserato: casata, Coppa, inviti.":"Membre : maison, Coupe, invitations.","Tieni l\u2019app a portata di mano":"Garde l'appli \xE0 port\xE9e de main","Tutto del socio (casata, Coppa) + gestisco case vacanza.":"Tout du membre (maison, Coupe) + je g\xE8re des maisons de vacances.","Tutto pronto":"Tout est pr\xEAt","Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.":"Un visiteur t'a indiqu\xE9 comme h\xF4te : confirme pour le rattacher \xE0 la maison.","Vivo nel residence; posso gestire case vacanza.":"Je vis dans la r\xE9sidence ; je peux g\xE9rer des maisons de vacances.","al completo":"complet","bar & garden":"bar & garden","dice di essere tuo ospite":"dit \xEAtre ton invit\xE9","es. Chiara":"ex. Chiara","la tua":"la tienne","prodotti":"produits","si paga in cassa. Ti avvisiamo quando \xE8 pronto.":"paiement \xE0 la caisse. On te pr\xE9vient quand c'est pr\xEAt.","soci":"membres","\xC8 lui/lei":"C'est lui/elle"},"de":{"Ingresso libero":"Freier Eintritt","A quale casa lo colleghi?":"Welchem Haus ordnest du ihn/sie zu?","Abbiamo avvisato":"Wir haben benachrichtigt","Accetto il trattamento dei dati (privacy)":"Ich stimme der Datenverarbeitung zu (Datenschutz)","Aggiungi alla Home":"Zum Startbildschirm","Aggiungi alla schermata Home":"Zum Startbildschirm hinzuf\xFCgen","Aggiungi la tua casa vacanza: potrai accogliere i visitatori.":"F\xFCge dein Ferienhaus hinzu: Du kannst dann Besucher empfangen.","Aggiungi prima la tua casa, poi conferma l'ospite.":"F\xFCge zuerst dein Haus hinzu, dann best\xE4tige den Gast.","Benvenuto nella casata":"Willkommen im Haus","Benvenuto!":"Willkommen!","Cambia casata":"Haus wechseln","Cerca chi ti ospita: ricever\xE0 una notifica e, se conferma, vedrai \\"Casa mia\\".":"Suche, wer dich beherbergt: Die Person erh\xE4lt eine Benachrichtigung und, wenn sie best\xE4tigt, siehst du \u201EMein Zuhause\\".","Chi sei?":"Wer bist du?","Chi ti ospita?":"Wer beherbergt dich?","Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.":"Wer dein Gast sein m\xF6chte, registriert sich und sucht dich per Namen: Hier best\xE4tigst du und verbindest ihn mit dem Haus.","Codice di accesso":"Zugangscode","Cognome":"Nachname","Collega":"Verbinden","Collega la tua casa":"Verbinde dein Haus","Comanda":"Bestellung","Conferma":"Best\xE4tigen","Conosci il tuo host?":"Kennst du deinen Gastgeber?","Cos\xEC resta sul telefono con la sua icona, senza cercarla ogni volta.":"So bleibt sie mit ihrem Symbol auf dem Telefon, ohne sie jedes Mal zu suchen.","Crea profilo":"Profil erstellen","Fatto":"Fertig","Ho gi\xE0 un account":"Ich habe schon ein Konto","I miei visitatori":"Meine Besucher","I tuoi dati":"Deine Daten","Il consenso privacy \xE8 necessario per registrarsi":"Die Datenschutz-Einwilligung ist f\xFCr die Registrierung erforderlich","Il tuo codice di accesso":"Dein Zugangscode","Il tuo host":"Dein Gastgeber","Il tuo profilo \xE8 attivo. Conserva il tuo codice per accedere anche senza e-mail:":"Dein Profil ist aktiv. Bewahre deinen Code auf, um dich auch ohne E-Mail anzumelden:","In attesa di conferma":"Warten auf Best\xE4tigung","Indica chi ti ospita per vedere indicazioni e regole del soggiorno.":"Gib an, wer dich beherbergt, um Hinweise und Regeln des Aufenthalts zu sehen.","Indietro":"Zur\xFCck","Inizia":"Starten","Installa l\u2019app":"App installieren","Invia ordine":"Bestellung senden","Men\xF9 non disponibile":"Men\xFC nicht verf\xFCgbar","Nessun host trovato con questo nome.":"Kein Gastgeber mit diesem Namen gefunden.","Nessun visitatore collegato.":"Kein Besucher verbunden.","Nome":"Vorname","Nome e cognome obbligatori":"Vor- und Nachname erforderlich","Nome o cognome dell'host":"Vor- oder Nachname des Gastgebers","Non lo conosco ora \xB7 salta":"Ich kenne ihn jetzt nicht \xB7 \xFCberspringen","Ogni casata accoglie fino a 12 soci. Se \xE8 al completo, scegline un\u2019altra.":"Jedes Haus nimmt bis zu 12 Mitglieder auf. Wenn es voll ist, w\xE4hle ein anderes.","Ordina":"Bestellen","Ordina e ritira al punto":"Bestellen und am Punkt abholen","Ordine inviato":"Bestellung gesendet","Ospite collegato":"Gast verbunden","Ospite temporaneo: ti colleghi alla casa del tuo host.":"Vor\xFCbergehender Gast: Du verbindest dich mit dem Haus deines Gastgebers.","Pi\xF9 tardi":"Sp\xE4ter","Punto":"Punkt","Quando confermer\xE0, comparir\xE0 \\"Casa mia\\" con tutte le indicazioni della struttura.":"Sobald best\xE4tigt wird, erscheint \u201EMein Zuhause\\" mit allen Hinweisen zur Unterkunft.","Registrati":"Registrieren","Registrazione non riuscita":"Registrierung fehlgeschlagen","Richiesta inviata":"Anfrage gesendet","Richieste in attesa":"Ausstehende Anfragen","Rispondi e l'app trova il profilo giusto per te.":"Antworte und die App findet das passende Profil f\xFCr dich.","Salva":"Speichern","Salva la tua tessera (immagine)":"Speichere deinen Ausweis (Bild)","Salva tessera":"Ausweis speichern","Scegli":"W\xE4hlen","Scegli la casata":"W\xE4hle das Haus","Scegli la tua casata":"W\xE4hle dein Haus","Scollega":"Trennen","Scollegare questo visitatore dalla casa?":"Diesen Besucher vom Haus trennen?","Serve per accedere di nuovo con un codice via e-mail.":"Er dient dazu, dich erneut mit einem Code per E-Mail anzumelden.","Soggiorno dal":"Aufenthalt ab","Sono in vacanza (visitatore)":"Ich bin im Urlaub (Besucher)","Sono residente":"Ich bin Anwohner","Sono socio KOIN\xC8":"Ich bin KOIN\xC8-Mitglied","Sono socio e residente":"Ich bin Mitglied und Anwohner","Su Android (Chrome): tocca il menu (\u22EE) in alto a destra, poi \u201CAggiungi a schermata Home\u201D / \u201CInstalla app\u201D.":"Auf Android (Chrome): Tippe oben rechts auf das Men\xFC (\u22EE), dann \u201EZum Startbildschirm hinzuf\xFCgen\\" / \u201EApp installieren\\".","Su iPhone/iPad (Safari): tocca Condividi (\u2B06\uFE0F) in basso, poi \u201CAggiungi a Home\u201D.":"Auf iPhone/iPad (Safari): Tippe unten auf Teilen (\u2B06\uFE0F), dann \u201EZum Home-Bildschirm\\".","Tessera salvata nelle immagini":"Ausweis in den Fotos gespeichert","Tesserato: casata, Coppa, inviti.":"Mitglied: Haus, Pokal, Einladungen.","Tieni l\u2019app a portata di mano":"Halte die App griffbereit","Tutto del socio (casata, Coppa) + gestisco case vacanza.":"Alles vom Mitglied (Haus, Pokal) + ich verwalte Ferienh\xE4user.","Tutto pronto":"Alles bereit","Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.":"Ein Besucher hat dich als Gastgeber angegeben: Best\xE4tige, um ihn mit dem Haus zu verbinden.","Vivo nel residence; posso gestire case vacanza.":"Ich wohne in der Residenz; ich kann Ferienh\xE4user verwalten.","al completo":"voll","bar & garden":"Bar & Garden","dice di essere tuo ospite":"gibt an, dein Gast zu sein","es. Chiara":"z. B. Chiara","la tua":"deine","prodotti":"Artikel","si paga in cassa. Ti avvisiamo quando \xE8 pronto.":"Zahlung an der Kasse. Wir sagen Bescheid, wenn es fertig ist.","soci":"Mitglieder","\xC8 lui/lei":"Das ist er/sie"},"es":{"Ingresso libero":"Entrada libre","A quale casa lo colleghi?":"\xBFA qu\xE9 casa lo vinculas?","Abbiamo avvisato":"Hemos avisado","Accetto il trattamento dei dati (privacy)":"Acepto el tratamiento de mis datos (privacidad)","Aggiungi alla Home":"A\xF1adir al inicio","Aggiungi alla schermata Home":"A\xF1adir a la pantalla de inicio","Aggiungi la tua casa vacanza: potrai accogliere i visitatori.":"A\xF1ade tu casa de vacaciones: podr\xE1s acoger a los visitantes.","Aggiungi prima la tua casa, poi conferma l'ospite.":"A\xF1ade primero tu casa y luego confirma al hu\xE9sped.","Benvenuto nella casata":"Bienvenido a la casa","Benvenuto!":"\xA1Bienvenido!","Cambia casata":"Cambiar de casa","Cerca chi ti ospita: ricever\xE0 una notifica e, se conferma, vedrai \\"Casa mia\\".":"Busca a quien te aloja: recibir\xE1 una notificaci\xF3n y, si confirma, ver\xE1s \\"Mi casa\\".","Chi sei?":"\xBFQui\xE9n eres?","Chi ti ospita?":"\xBFQui\xE9n te aloja?","Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.":"Quien quiera ser tu hu\xE9sped se registra y te busca por nombre: aqu\xED lo confirmas y lo vinculas a la casa.","Codice di accesso":"C\xF3digo de acceso","Cognome":"Apellido","Collega":"Vincular","Collega la tua casa":"Vincula tu casa","Comanda":"Comanda","Conferma":"Confirmar","Conosci il tuo host?":"\xBFConoces a tu anfitri\xF3n?","Cos\xEC resta sul telefono con la sua icona, senza cercarla ogni volta.":"As\xED se queda en el tel\xE9fono con su icono, sin buscarla cada vez.","Crea profilo":"Crear perfil","Fatto":"Hecho","Ho gi\xE0 un account":"Ya tengo una cuenta","I miei visitatori":"Mis visitantes","I tuoi dati":"Tus datos","Il consenso privacy \xE8 necessario per registrarsi":"El consentimiento de privacidad es necesario para registrarse","Il tuo codice di accesso":"Tu c\xF3digo de acceso","Il tuo host":"Tu anfitri\xF3n","Il tuo profilo \xE8 attivo. Conserva il tuo codice per accedere anche senza e-mail:":"Tu perfil est\xE1 activo. Guarda tu c\xF3digo para acceder incluso sin correo:","In attesa di conferma":"A la espera de confirmaci\xF3n","Indica chi ti ospita per vedere indicazioni e regole del soggiorno.":"Indica qui\xE9n te aloja para ver las indicaciones y normas de la estancia.","Indietro":"Atr\xE1s","Inizia":"Empezar","Installa l\u2019app":"Instala la app","Invia ordine":"Enviar pedido","Men\xF9 non disponibile":"Men\xFA no disponible","Nessun host trovato con questo nome.":"No se encontr\xF3 ning\xFAn anfitri\xF3n con este nombre.","Nessun visitatore collegato.":"Ning\xFAn visitante vinculado.","Nome":"Nombre","Nome e cognome obbligatori":"Nombre y apellido obligatorios","Nome o cognome dell'host":"Nombre o apellido del anfitri\xF3n","Non lo conosco ora \xB7 salta":"No lo s\xE9 ahora \xB7 omitir","Ogni casata accoglie fino a 12 soci. Se \xE8 al completo, scegline un\u2019altra.":"Cada casa acoge hasta 12 socios. Si est\xE1 completa, elige otra.","Ordina":"Pedir","Ordina e ritira al punto":"Pide y recoge en el punto","Ordine inviato":"Pedido enviado","Ospite collegato":"Hu\xE9sped vinculado","Ospite temporaneo: ti colleghi alla casa del tuo host.":"Hu\xE9sped temporal: te vinculas a la casa de tu anfitri\xF3n.","Pi\xF9 tardi":"M\xE1s tarde","Punto":"Punto","Quando confermer\xE0, comparir\xE0 \\"Casa mia\\" con tutte le indicazioni della struttura.":"Cuando confirme, aparecer\xE1 \\"Mi casa\\" con todas las indicaciones del alojamiento.","Registrati":"Reg\xEDstrate","Registrazione non riuscita":"Registro fallido","Richiesta inviata":"Solicitud enviada","Richieste in attesa":"Solicitudes pendientes","Rispondi e l'app trova il profilo giusto per te.":"Responde y la app encuentra el perfil adecuado para ti.","Salva":"Guardar","Salva la tua tessera (immagine)":"Guarda tu tarjeta (imagen)","Salva tessera":"Guardar tarjeta","Scegli":"Elegir","Scegli la casata":"Elige la casa","Scegli la tua casata":"Elige tu casa","Scollega":"Desvincular","Scollegare questo visitatore dalla casa?":"\xBFDesvincular a este visitante de la casa?","Serve per accedere di nuovo con un codice via e-mail.":"Sirve para acceder de nuevo con un c\xF3digo por correo.","Soggiorno dal":"Estancia desde","Sono in vacanza (visitatore)":"Estoy de vacaciones (visitante)","Sono residente":"Soy residente","Sono socio KOIN\xC8":"Soy socio de KOIN\xC8","Sono socio e residente":"Soy socio y residente","Su Android (Chrome): tocca il menu (\u22EE) in alto a destra, poi \u201CAggiungi a schermata Home\u201D / \u201CInstalla app\u201D.":"En Android (Chrome): toca el men\xFA (\u22EE) arriba a la derecha y luego \\"A\xF1adir a la pantalla de inicio\\" / \\"Instalar app\\".","Su iPhone/iPad (Safari): tocca Condividi (\u2B06\uFE0F) in basso, poi \u201CAggiungi a Home\u201D.":"En iPhone/iPad (Safari): toca Compartir (\u2B06\uFE0F) abajo y luego \\"A\xF1adir a inicio\\".","Tessera salvata nelle immagini":"Tarjeta guardada en las fotos","Tesserato: casata, Coppa, inviti.":"Socio: casa, Copa, invitaciones.","Tieni l\u2019app a portata di mano":"Ten la app a mano","Tutto del socio (casata, Coppa) + gestisco case vacanza.":"Todo lo del socio (casa, Copa) + gestiono casas de vacaciones.","Tutto pronto":"Todo listo","Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.":"Un visitante te ha indicado como anfitri\xF3n: confirma para vincularlo a la casa.","Vivo nel residence; posso gestire case vacanza.":"Vivo en el residence; puedo gestionar casas de vacaciones.","al completo":"completo","bar & garden":"bar & garden","dice di essere tuo ospite":"dice ser tu hu\xE9sped","es. Chiara":"p. ej. Chiara","la tua":"la tuya","prodotti":"productos","si paga in cassa. Ti avvisiamo quando \xE8 pronto.":"se paga en caja. Te avisamos cuando est\xE9 listo.","soci":"socios","\xC8 lui/lei":"Es \xE9l/ella"}};
for (const _l of ['en','fr','de','es']) { UI[_l] = Object.assign(UI[_l] || {}, UI_EXTRA[_l]); }
function T(it){ const d = UI[state.lang]; if (d && d[it] != null) return d[it]; const h = UI_HOST[state.lang]; return (h && h[it]) || it; }
function applyLang(code){
  state.lang = code; store.set('lang_code', code);
  const el = $('#langLbl'); if (el) el.textContent = code.toUpperCase().slice(0,2);
  const src = I18N[code] || I18N.it;
  document.querySelectorAll('.tab').forEach(b => { const k = b.dataset.t; if (src[k]) { const svg = b.querySelector('svg'); b.textContent=''; if (svg) b.appendChild(svg); b.appendChild(document.createTextNode(src[k])); } });
  const lbl = document.querySelector('.a11y .lbl'); if (lbl) lbl.textContent = src.testo || 'Testo';
  const hc = $('#hcBtn'); if (hc) hc.textContent = '\u25D1 ' + (src.contrasto || 'Contrasto');
  // Ridisegno tutte le schermate con i testi tradotti cos\xEC il cambio lingua \xE8 live ovunque.
  try {
    renderHeader(); renderHome(); renderEventi(); renderCoppa(); renderBussola();
    renderDom('sport'); renderDom('giochi');
  } catch {}
}
function openLang() {
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">Lingua \xB7 Language</div><h2>\${T('Scegli la lingua')}</h2><p class="sub">\${T("Scegli la lingua dell'app")}</p>
    <div class="chips" style="flex-direction:column; align-items:stretch">\${LANGS.map(l=>\`<button class="chip" style="text-align:left; display:flex; justify-content:space-between; align-items:center" data-lang="\${l[0]}">\${l[1]}</button>\`).join('')}</div>
    <button class="btn ghost block" style="margin-top:10px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
function openSos() {
  const serv = state.data.bussola?.servizi || SEED.bussola.servizi;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">\${T('Numeri utili')}</div><h2>\${T('Emergenze & servizi')}</h2><p class="sub">\${T('In caso di necessit\xE0.')}</p>
    <div class="card" style="padding:4px 14px">\${serv.map(x=>\`<div class="matchrow"><div style="flex:1"><b style="font-size:.85rem">\${esc(x.titolo)}</b><div class="ct">\${esc(x.dettaglio||'')}</div></div><span class="ct">\${esc(x.distanza||'')}</span></div>\`).join('')}
      <div class="matchrow"><div style="flex:1"><b style="font-size:.85rem; color:var(--coral)">\${T('Emergenze (112)')}</b><div class="ct">\${T('Numero unico europeo')}</div></div></div></div>
    <button class="btn navy block" style="margin-top:12px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}

// ---- Modalit\xE0 CAPITANO ----------------------------------------------------
let _serataText = '', _capPartite = [], _capCurrent = null;
async function openCapConvoca() {
  let partite = [];
  try { partite = await api('/auth/capitano/partite'); } catch {}
  _capPartite = partite;
  if (!partite.length) {
    setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${T('Capitano')} \xB7 \${esc(state.socio.casata || '')}</div><h2>\${T('Convoca la tua casata')}</h2><p class="sub">\${T("Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).")}</p><button class="btn navy block" data-close>\${T('Chiudi')}</button>\`);
    return showOv();
  }
  const rows = partite.map((p, i) => {
    const short = p.disponibili < p.minimo;
    return \`<div class="card" style="padding:12px; margin-bottom:8px">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div style="flex:1"><b style="font-size:.9rem">\${esc(p.disciplina)} \xB7 G\${p.giornata}</b><div class="ct">vs \${esc(p.avversario)}</div></div>
        <div style="text-align:center"><div style="font-family:Georgia,serif; font-weight:700; font-size:1.2rem; color:\${short ? 'var(--coral)' : 'var(--sage)'}">\${p.disponibili}/\${p.minimo}</div><div class="ct">\${T('dispon.')}</div></div>
      </div>
      <button class="btn \${short ? 'gold' : 'ghost'} sm" style="margin-top:8px; width:100%" data-capm="\${i}">\${short ? T('Serve gente \u2014 convoca') : T('Convoca giocatori')}</button>
    </div>\`;
  }).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${T('Capitano')} \xB7 \${esc(state.socio.casata || '')}</div><h2>\${T('Chi copre le partite?')}</h2><p class="sub">\${T('Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.')}</p>\${rows}<button class="btn navy block" style="margin-top:6px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
function openCapMembri(idx) {
  const p = _capPartite[idx]; if (!p) return;
  _capCurrent = p;
  const rows = p.membri.map(m => {
    const conv = m.stato !== 'non_convocato';
    const badge = m.stato === 'disponibile' ? \`<span style="color:var(--sage); font-weight:700">\${T('disponibile')}</span>\`
      : m.stato === 'non_disponibile' ? \`<span style="color:var(--coral)">\${T('non disp.')}</span>\`
      : conv ? \`<span class="muted">\${T('in attesa')}</span>\` : '';
    return \`<label style="display:flex; gap:10px; align-items:center; padding:9px 2px; border-bottom:1px solid var(--line)">
      <input type="checkbox" data-capchk value="\${m.id}" \${conv ? 'disabled checked' : ''} style="width:auto; transform:scale(1.3)">
      <span style="flex:1">\${esc(m.nome)}</span>\${badge}</label>\`;
  }).join('');
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${esc(p.disciplina)} \xB7 G\${p.giornata}</div><h2>\${T('Convoca i giocatori')}</h2><p class="sub">vs \${esc(p.avversario)} \u2014 \${T('servono')} \${p.minimo}, \${T('disponibili')} \${p.disponibili}. \${T('Spunta chi vuoi convocare.')}</p>
    <div class="card" style="padding:2px 14px">\${rows}</div>
    <button class="btn gold block" style="margin-top:12px" data-capsend>\${T('Convoca i selezionati')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-cap="convoca">\${T('\u2190 Torna alle partite')}</button>\`);
  showOv();
}
async function capSendMirata() {
  const ids = [...document.querySelectorAll('[data-capchk]:not(:disabled):checked')].map(c => Number(c.value));
  if (!ids.length) { okThen(T('Seleziona almeno un giocatore')); return; }
  try { const r = await api('/auth/capitano/convoca-mirata', { method: 'POST', body: JSON.stringify({ partita_id: _capCurrent.partita_id, socio_ids: ids }) }); okThen(\`\${T('Convocati')} \${r.convocati} \${T('giocatori')}\`); }
  catch { okThen(T('Non riesco a convocare ora')); }
}
function openCapSerata() {
  const sorted = [...state.data.casate].sort((a, b) => b.punti - a.punti);
  const mine = state.socio.casata; const pos = sorted.findIndex(c => c.nome === mine) + 1;
  const my = sorted.find(c => c.nome === mine) || sorted[0];
  const ct = state.data.contest;
  const titolo = ct ? ct.titolo : T('Serata dei Clan');
  const sfida = ct ? (ct.brief || '') : ((state.data.eventi || []).find(e => e.chiave === 'ven')?.descrizione || T('La sfida di venerd\xEC'));
  _serataText = \`\u{1F3AC} \${T('Serata dei Clan')} \u2014 "\${titolo}"\${ct && ct.settimana ? \` (\${ct.settimana})\` : ''}\\n\${sfida}\\n\${T('Casata')} \${mine}: \${T('siamo')} \${pos}\xB0 \${T('con')} \${my.punti} \${T('punti')}. \${T('Forza')} \${mine}! \u{1F4AA}\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">\${T('Capitano')} \xB7 \${T('Serata dei Clan')}</div><h2>\${esc(titolo)}</h2>
    <div class="card" style="background:linear-gradient(135deg,\${my.colore || '#12324F'},#0d2740); color:#fff; border:none">
      <div class="eyebrow" style="color:#ffe1ac">\${T('Casata')} \${esc(mine)} \xB7 \${pos}\xB0 \${T('posto')} \xB7 \${my.punti} \${T('punti')}</div>
      <p style="font-size:.85rem; opacity:.95; margin-top:6px; white-space:pre-wrap">\${esc(sfida)}</p>
      <p style="font-size:.8rem; opacity:.85; margin-top:8px">\${T('Rilancia la sfida ai tuoi. Forza')} \${esc(mine)}!</p>
    </div>
    <button class="btn gold block" style="margin-top:12px" data-cap="share">\${T('Condividi con la casata')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
function openContest() {
  const ct = state.data.contest; if (!ct) return;
  _serataText = \`\u{1F3AC} \${T('Serata dei Clan')} \u2014 "\${ct.titolo}"\${ct.settimana ? \` (\${ct.settimana})\` : ''}\\n\${ct.brief || ''}\\n\${T('Forza')} \${state.socio.casata || T('la nostra casata')}!\`;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">\${T('Serata dei Clan \xB7 Contest')}\${ct.settimana ? ' \xB7 ' + esc(ct.settimana) : ''}</div><h2>\${esc(ct.titolo)}</h2>
    \${ct.tipo ? \`<p class="sub">\${esc(ct.tipo)}\${ct.stato ? ' \xB7 ' + esc(ct.stato) : ''}</p>\` : ''}
    <div class="card"><p style="font-size:.9rem; line-height:1.5; white-space:pre-wrap">\${esc(ct.brief || '')}</p></div>
    \${ct.vincitore ? \`<div class="note">\u{1F3C6} \${T('Vincitore:')} \${esc(ct.vincitore)}</div>\` : ''}
    <button class="btn gold block" style="margin-top:12px" data-cap="share">\${T('Condividi')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
async function capShare() {
  try { if (navigator.share) { await navigator.share({ title: T('Serata dei Clan'), text: _serataText }); } else { await navigator.clipboard.writeText(_serataText); okThen(T('Testo copiato: incollalo nel gruppo')); } } catch {}
}
async function rispondiConvocazione(id, st) {
  try { await api('/convocazioni/' + id + '/risposta', { method: 'POST', body: JSON.stringify({ stato: st }) }); } catch {}
  okThen(st === 'disponibile' ? T('Presenza confermata') : T('Hai declinato'));
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
    if (!r.ok) return okThen(data.error || T('Prenotazione non riuscita: riprova'), false);  // es. turno/coworking al completo
  } catch { /* offline (anteprima): conferma ottimistica */ }
  okThen(\`\${T('Prenotazione registrata')} \xB7 \${nome}\${day?\` \xB7 \${day} \${slot}\`:''}\${persone?\` \xB7 \${persone} \${T('pers.')}\`:''}\`);
}
// --- Serate speciali a numero chiuso con quota (da saldare) ---
function openSerata(id) {
  const s = (state.data.serate || []).find(x => String(x.id) === String(id)); if (!s) return;
  const esaurita = s.posti_liberi != null && s.posti_liberi <= 0;
  setSheet(\`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">\${T('Serata su prenotazione')}\${s.quando ? ' \xB7 ' + esc(s.quando) : ''}</div><h2>\${esc(s.titolo)}</h2>
    \${s.tema ? \`<p class="sub">\${esc(s.tema)}</p>\` : ''}
    <div class="card"><p style="font-size:.9rem; line-height:1.5">\${esc(s.descrizione || '')}</p>
      <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:.85rem"><b>\${T('Quota')}</b><span>\u20AC \${esc(String(s.quota))} \${T('a persona')}</span></div>
      \${s.posti_liberi != null ? \`<div style="display:flex; justify-content:space-between; font-size:.8rem; color:var(--mute)"><span>\${T('Posti disponibili')}</span><span>\${s.posti_liberi}</span></div>\` : ''}
    </div>
    \${esaurita ? \`<div class="note">\${T('Posti esauriti per questa serata.')}</div>\` : \`
    <div class="field" style="margin-top:10px"><label>\${T('Quante persone')}</label><div class="chips" data-group="serp">\${[1,2,3,4,5,6].map((n,i)=>\`<button class="chip\${i===1?' sel':''}" data-chip>\${n}</button>\`).join('')}</div></div>
    <div class="note">\${T('Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriver\xE0 pi\xF9 avanti).')}</div>
    <button class="btn gold block" style="margin-top:10px" data-do-serata="\${s.id}">\${T('Prenota')} (\u20AC \${esc(String(s.quota))} \${T('a persona')})</button>\`}
    <button class="btn ghost block" style="margin-top:8px" data-close>\${T('Chiudi')}</button>\`);
  showOv();
}
async function prenotaSerata(id) {
  const persone = Number($('[data-group="serp"] .sel')?.textContent || 1) || 1;
  const s = (state.data.serate || []).find(x => String(x.id) === String(id));
  try {
    const headers = { 'Content-Type':'application/json', ...(state.token ? { Authorization:'Bearer '+state.token } : {}) };
    const r = await fetch(API_BASE + '/api/serate/' + id + '/prenota', { method:'POST', headers, body: JSON.stringify({ tessera_code: state.tessera, persone }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return okThen(data.error || T('Prenotazione non riuscita'), false);
    await loadAll();
    return okThen(\`\${T('Sei in lista per')} "\${data.titolo || (s && s.titolo) || T('la serata')}" \xB7 \${persone} \${T('pers.')} \xB7 \u20AC \${data.importo} \${T('da saldare in cassa')}\`);
  } catch {
    const imp = s ? s.quota * persone : 0;
    okThen(\`\${T('Prenotazione registrata')} \xB7 \${persone} \${T('pers.')}\${imp?\` \xB7 \u20AC \${imp} \${T('da saldare')}\`:''}\`);
  }
}
async function doProposta(tipo) {
  const titolo = $('#in1')?.value || '';
  const dettaglio = tipo==='vinile' ? [$('#in2')?.value, $('#in3')?.value].filter(Boolean).join(' \u2014 ') : ($('[data-group="tipo"] .sel')?.textContent || '');
  try { await api('/proposte', { method:'POST', body: JSON.stringify({ tessera_code: state.tessera, tipo, titolo, dettaglio }) }); } catch {}
  okThen(tipo==='vinile' ? T('La tua proposta \xE8 in lista') : T('Sei in scaletta per domenica'));
}
function convOk(key) { state.conv[key] = 'ok'; const [dom]=key.split('/'); renderDom(dom); okThen(T('Presenza confermata')); }
function convNo(key) { state.rifiuti = Math.min(3, state.rifiuti+1); state.conv[key]='no'; const [dom]=key.split('/'); renderDom(dom); }

// ---- Delegazione eventi (un solo listener) --------------------------------
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-open],[data-book],[data-campi],[data-partite],[data-campo-pick],[data-campo-date],[data-prenota],[data-apri],[data-unisci],[data-casamia],[data-lemiecase],[data-collega],[data-strutt-edit],[data-strutt-del],[data-strutt-new],[data-strutt-save],[data-osp-scollega],[data-reg-tipo],[data-reg-cancel],[data-reg-save],[data-reg-back],[data-reg-host],[data-reg-skiphost],[data-req-ok],[data-req-no],[data-savecard],[data-install],[data-opencasata],[data-casata],[data-ordina],[data-sheet],[data-go],[data-close],[data-confirm],[data-chip],[data-do-book],[data-proposta],[data-lang],[data-conv],[data-ev],[data-dom],[data-login],[data-logout],[data-otp-req],[data-otp-verify],[data-push],[data-map],[data-cap],[data-capm],[data-capsend],[data-convrisp],[data-open-contest],[data-serata],[data-do-serata]');
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
  if (t.dataset.casamia != null) return openCasaMia();
  if (t.dataset.lemiecase != null) return openLeMieCase();
  if (t.dataset.collega != null) return openCollegaHost();
  if (t.dataset.struttEdit) return openStrutturaForm(t.dataset.struttEdit);
  if (t.dataset.struttDel) return strutturaElimina(t.dataset.struttDel);
  if (t.dataset.struttNew != null) return openStrutturaForm();
  if (t.dataset.ospScollega) return ospiteScollega(t.dataset.ospScollega);
  if (t.dataset.regTipo) return regDati(t.dataset.regTipo);
  if (t.dataset.regCancel != null) { closeOv(); showGate(); return; }
  if (t.dataset.regSave != null) return regSalva();
  if (t.dataset.regBack != null) return regProfilo();
  if (t.dataset.regHost) return regInviaRichiesta(t.dataset.regHost);
  if (t.dataset.regSkiphost != null) return regFine();
  if (t.dataset.reqOk) return hostApprova(t.dataset.reqOk);
  if (t.dataset.reqNo) return hostRifiuta(t.dataset.reqNo);
  if (t.dataset.savecard != null) return downloadTessera();
  if (t.dataset.install != null) return openInstallHint();
  if (t.dataset.opencasata != null) return openCasata(false);
  if (t.dataset.casata) return scegliCasata(t.dataset.casata);
  if (t.dataset.ordina != null) return openOrdina();
  if (t.dataset.struttSave != null) return strutturaSalva(t.dataset.struttSave);
  if (t.dataset.campi != null) return openCampi();
  if (t.dataset.partite != null) return openPartiteAperte();
  if (t.dataset.campoPick) return openCampi(Number(t.dataset.campoPick));
  if (t.dataset.campoDate) { state._campoData = t.dataset.campoDate; return openCampi(state._campoSel); }
  if (t.dataset.prenota) return campoPrenota(t.dataset.prenota);
  if (t.dataset.apri) return campoApri(t.dataset.apri);
  if (t.dataset.unisci) return campoUnisci(t.dataset.unisci);
  if (t.dataset.book != null) return openBooking(t.dataset.book);
  if (t.dataset.sheet) return t.dataset.sheet === 'regolamenti' ? openRegolamenti() : openSheet(t.dataset.sheet);
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.close != null) return closeOv();
  if (t.dataset.confirm != null) return okThen(T('Prenotazione registrata') + ' \xB7 ' + t.dataset.confirm);
  if (t.dataset.chip != null) { t.parentElement.querySelectorAll('.chip').forEach(c=>c.classList.remove('sel')); t.classList.add('sel'); return; }
  if (t.dataset.doBook) return doBook(t.dataset.doBook);
  if (t.dataset.proposta) return doProposta(t.dataset.proposta);
  if (t.dataset.lang) { applyLang(t.dataset.lang); return okThen(T('Lingua impostata')); }
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
  if (state.token) {
    // Sessione valida: entra direttamente (login-first: serve un accesso vero, non la sola tessera)
    state.authed = true;
    await enterApp();
    if (!store.get('seen', false)) $('#onb').classList.add('show');
    const h = location.hash.replace('#', ''); if (h && document.getElementById('s-' + h)) go(h);
  } else {
    // Nessuna sessione: si parte SEMPRE dall'accesso
    if ($('#gate_tess') && state.tessera) $('#gate_tess').value = state.tessera; // pre-compila l'ultima tessera usata
    showGate();
  }
  // Il service worker \xE8 registrato dai tag PWA iniettati dal server (server/pwa.js).
}
function bindGate() {
  const enter = $('#gate_enter'); if (enter) enter.addEventListener('click', loginTessera);
  const tess = $('#gate_tess'); if (tess) tess.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginTessera(); });
  const email = $('#gate_email'); if (email) email.addEventListener('click', () => { hideGate(); openLoginOtp(); });
  const reg = $('#gate_register'); if (reg) reg.addEventListener('click', () => { hideGate(); startRegistrazione(); });
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
  nav.menu .grp{color:#7f93a6;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.9px;padding:12px 12px 4px;margin-top:6px;border-top:1px solid rgba(255,255,255,.10);}
  nav.menu .grp:first-of-type{margin-top:4px;}
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

        <div class="grp">Persone &amp; accessi</div>
        <button data-v="soci" data-cap="utenti">\u{1F464} Utenti</button>
        <button data-v="operatori" data-cap="operatori">\u{1F511} Operatori &amp; permessi</button>

        <div class="grp">Sport &amp; Coppa</div>
        <button data-v="casate" data-cap="casate">\u{1F6E1}\uFE0F Casate &amp; punti</button>
        <button data-v="discipline" data-cap="discipline">\u{1F3C5} Discipline</button>
        <button data-v="tabellone" data-cap="tabellone">\u{1F3C6} Tabellone</button>
        <button data-v="campi" data-cap="campi">\u{1F3BE} Campi &amp; prenotazioni</button>

        <div class="grp">Serate &amp; Eventi</div>
        <button data-v="eventi" data-cap="eventi">\u{1F3AD} Eventi</button>
        <button data-v="serate" data-cap="serate">\u{1F37D}\uFE0F Serate &amp; cena</button>
        <button data-v="contest" data-cap="contest">\u{1F3AC} Contest Serata Clan</button>
        <button data-v="proposte" data-cap="proposte">\u{1F3B5} Proposte</button>
        <button data-v="avvisi" data-cap="eventi">\u{1F514} Avvisi push</button>

        <div class="grp">Operativit\xE0</div>
        <button data-v="cdc" data-cap="cdc">\u{1F0CF} Casa di Carta</button>

        <div class="grp">Guida &amp; luoghi</div>
        <button data-v="bussola" data-cap="guida">\u{1F9ED} Guida</button>
        <button data-v="luoghi" data-cap="luoghi">\u{1F4CD} Luoghi (Siamo qui)</button>

        <div class="grp">Sistema</div>
        <button data-v="installa" data-cap="guida">\u{1F4F2} Installa app (QR)</button>
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
  // Nasconde l'intestazione di un gruppo se tutte le voci sottostanti sono nascoste.
  const kids = Array.from(document.querySelectorAll('#menu > *'));
  kids.forEach((el, i) => {
    if (!el.classList.contains('grp')) return;
    let visibile = false;
    for (let j = i + 1; j < kids.length; j++) {
      if (kids[j].classList.contains('grp')) break;
      if (kids[j].tagName === 'BUTTON' && kids[j].style.display !== 'none') { visibile = true; break; }
    }
    el.style.display = visibile ? '' : 'none';
  });
}

// ---- Router ----
const VIEWS = {};
async function show(v) {
  document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#viewTitle').textContent = { dashboard:'Cruscotto', soci:'Utenti', casate:'Casate & punti', cdc:'Casa di Carta', discipline:'Discipline', campi:'Campi & prenotazioni', tabellone:'Tabellone', contest:'Contest Serata dei Clan', serate:'Serate & cena', proposte:'Proposte', eventi:'Eventi', avvisi:'Avvisi push', bussola:'Guida', luoghi:'Luoghi (Siamo qui)', operatori:'Operatori & permessi', database:'Database', audit:'Registro attivit\xE0' }[v] || v;
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
  $('#view').innerHTML = \`
    <div class="cards">\${cards.map(c => \`<div class="stat"><div class="n">\${c[1]}</div><div class="l">\${c[0]}</div></div>\`).join('')}</div>
    <div class="panel"><h3>Coppa delle Casate & soci per casata</h3><table><thead><tr><th>Casata</th><th>Punti</th><th></th><th>Soci</th></tr></thead><tbody>
      \${s.per_casata.map(c => \`<tr><td><b>\${esc(c.nome)}</b></td><td>\${c.punti}</td><td><span class="barwrap"><span style="width:\${Math.round(c.punti/max*100)}%;background:\${c.colore}"></span></span></td><td>\${c.soci}</td></tr>\`).join('')}
    </tbody></table></div>\`;
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

// ---- Installa app (QR degli indirizzi PWA) ----
VIEWS.installa = async () => {
  let d; try { d = await api('/pwa-qr'); } catch (e) { $('#view').innerHTML = \`<div class="panel"><p class="err">\${esc(e.message)}</p></div>\`; return; }
  const card = (it) => \`<div class="panel" style="text-align:center;min-width:240px;flex:1">
      <h3 style="margin-bottom:6px">\${esc(it.label)}</h3>
      <div class="qrbox" style="max-width:220px;margin:0 auto">\${it.svg}</div>
      <p class="muted" style="word-break:break-all;margin-top:8px">\${esc(it.url)}</p>
    </div>\`;
  $('#view').innerHTML = \`
    <div class="panel"><h2>\u{1F4F2} Installa le app</h2>
      <p class="muted">Inquadra il QR con la fotocamera del telefono per aprire l'app, poi usa <b>\u201CAggiungi a schermata Home\u201D</b> (Android: Chrome \xB7 iPhone/iPad: Safari) per installarla. Nessuno store, nessun account.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn gold sm" id="qr_print">\u{1F5A8}\uFE0F Stampa / salva PDF</button></div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">\${d.items.map(card).join('')}</div>
    <div class="panel" style="margin-top:14px"><h3>\u{1F354} QR self-order al tavolo</h3>
      <p class="muted" style="margin-bottom:8px">Genera il QR da mettere sul tavolo: il cliente inquadra, vede il men\xF9 del punto e ordina. La comanda entra nella stessa coda dello staff (con priorit\xE0 staff).</p>
      <div class="row"><label>Punto <select id="qo_punto"><option>Bussola Bar</option><option>Bussola Garden</option></select></label><input id="qo_tav" placeholder="n\xB0 tavolo (facolt.)" style="width:150px"><button class="btn gold sm" id="qo_go">Genera QR</button></div>
      <div id="qo_out" style="margin-top:10px"></div></div>\`;
  $('#qo_go').onclick = async () => {
    const r = await api('/qr-ordina?punto=' + encodeURIComponent($('#qo_punto').value) + '&tavolo=' + encodeURIComponent($('#qo_tav').value || ''));
    $('#qo_out').innerHTML = \`<div class="panel" style="text-align:center;max-width:280px"><b>\${esc(r.punto)}\${r.tavolo ? ' \xB7 Tavolo ' + esc(r.tavolo) : ''}</b><div style="max-width:220px;margin:8px auto">\${r.svg}</div><p class="muted" style="word-break:break-all;font-size:.72rem">\${esc(r.url)}</p><button class="btn ghost sm" id="qo_print">\u{1F5A8}\uFE0F Stampa</button></div>\`;
    $('#qo_print').onclick = () => { const w = window.open('', '_blank'); if (!w) { alert('Consenti i popup.'); return; } w.document.write(\`<html><head><title>QR \${esc(r.punto)}</title><style>body{font-family:system-ui,Arial,sans-serif;color:#12324F;text-align:center;padding:30px}svg{width:320px;height:320px}h1{font-size:1.3rem}</style></head><body><h1>\u{1F354} Ordina qui</h1><h2>\${esc(r.punto)}\${r.tavolo ? ' \xB7 Tavolo ' + esc(r.tavolo) : ''}</h2>\${r.svg}<p>Inquadra il QR con la fotocamera e ordina dal tuo telefono.</p><script>window.onload=function(){setTimeout(function(){window.print()},250)}<\\/script></body></html>\`); w.document.close(); };
  };
  $('#qr_print').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) { alert('Consenti i popup per stampare.'); return; }
    w.document.write(\`<html><head><title>Bussola \u2014 Installa app</title><style>
      body{font-family:system-ui,Arial,sans-serif;color:#12324F;padding:24px}
      h1{text-align:center} .g{display:flex;gap:24px;flex-wrap:wrap;justify-content:center;margin-top:16px}
      .c{border:1px solid #cbd2d8;border-radius:12px;padding:16px;text-align:center;width:260px}
      .c h2{margin:0 0 8px;font-size:1.1rem} .c svg{width:200px;height:200px} .u{font-size:.75rem;word-break:break-all;color:#555;margin-top:8px}
    </style></head><body><h1>Bussola Residence \u2014 Installa le app</h1>
      <p style="text-align:center;color:#555">Inquadra il QR e scegli \u201CAggiungi a schermata Home\u201D.</p>
      <div class="g">\${d.items.map(it => \`<div class="c"><h2>\${esc(it.label)}</h2>\${it.svg}<div class="u">\${esc(it.url)}</div></div>\`).join('')}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\\/script></body></html>\`);
    w.document.close();
  };
};

// ---- Operatori & permessi (solo gestore) ----
const CAP_LABEL = { utenti:'Utenti (modifica)', utenti_ins:'Registra utenti', casate:'Casate & punti', cdc:'Casa di Carta', discipline:'Discipline', tabellone:'Tabellone (risultati/archivio)', contest:'Contest', serate:'Serate & cena', proposte:'Proposte', eventi:'Eventi', magazzino:'Crew \xB7 Magazzino', comande:'Crew \xB7 Comande e Cucina', campi:'Campi & prenotazioni' };
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
          <td>\${esc(s.casata_nome||'\u2014')}</td><td>\${esc((s.ruolo||'').replace('_',' '))}\${s.tipo_profilo&&s.tipo_profilo!=='socio'?\`<br><span class="tag mid">\${esc(s.tipo_profilo==='ospite_temporaneo'?'visitatore':s.tipo_profilo.replace('_',' '))}</span>\`:''}</td>
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
async function editSocio(s, all) {
  const isNew = !s;
  // Stato host del profilo (il flag host \xE8 mostrato solo per i Residenti).
  let hostInfo = null;
  if (!isNew) hostInfo = await api('/soci/' + s.id + '/host').catch(() => null);
  const genitori = (all || []).filter(x => x.tipo_profilo === 'genitore');
  const profili = [['socio','Socio'],['residente','Residente'],['socio_residente','Socio residente'],['ospite_temporaneo','Visitatore (non socio)'],['genitore','Genitore'],['under14','Under 14 (figlio)']];
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
      <div><label>Ruolo</label><select id="f_ruolo"><option \${s?.ruolo==='socio'?'selected':''}>socio</option><option \${s?.ruolo==='capitano'?'selected':''}>capitano</option><option \${s?.ruolo==='staff'?'selected':''}>staff</option><option value="non_socio" \${s?.ruolo==='non_socio'?'selected':''}>non socio</option></select></div>
      <div><label>Lingua</label><select id="f_lingua">\${['it','en','fr','de','es','zh','ja'].map(l=>\`<option \${s?.lingua===l?'selected':''}>\${l}</option>\`).join('')}</select></div>
      <div id="validaWrap"><label>Tessera valida fino</label><input id="f_valida" type="date" value="\${esc(s?.valida_fino||'2027-05-01')}"></div>
      <div id="dalWrap"><label>Soggiorno dal</label><input id="f_dal" type="date" value="\${esc(s?.soggiorno_dal||'')}"></div>
      <div id="alWrap"><label>Soggiorno al</label><input id="f_al" type="date" value="\${esc(s?.soggiorno_al||'')}"></div>
    </div>
    <p class="muted" id="ospitenote" style="display:none">Visitatore (non socio): profilo temporaneo con periodo di soggiorno (dal / al) e nessuna tessera annuale. <b>L'aggancio a una casa vacanza avviene su consenso</b>: il visitatore si registra dall'app, cerca il proprio host per nome e invia una richiesta; l'host la conferma dalla sua app ("Le mie case") e solo allora il visitatore vede "Casa mia". Un visitatore creato o modificato qui dal back office resta senza casa collegata.</p>
    <label class="check"><input type="checkbox" id="f_privacy" \${(!s||s.consenso_privacy)?'checked':''}> Consenso privacy (necessario)</label>
    <label class="check"><input type="checkbox" id="f_mktg" \${s?.consenso_marketing?'checked':''}> Consenso comunicazioni marketing</label>
    <label class="check"><input type="checkbox" id="f_foto" \${s?.consenso_foto?'checked':''}> Consenso uso immagini eventi</label>
    <label class="check"><input type="checkbox" id="f_push" \${s?.notifiche_push?'checked':''}> Consenso notifiche (casata & eventi)</label>
    \${isNew?'':'<label class="check"><input type="checkbox" id="f_attivo" '+(s.attivo?'checked':'')+'> Profilo attivo</label>'}
    \${isNew?'':'<div id="hostWrap"><label class="check"><input type="checkbox" id="f_host" '+((hostInfo&&hostInfo.host)?'checked':'')+'> \u{1F511} Profilo <b>host</b> (case vacanza): gestisce fino a 3 strutture dall\\'app'+((hostInfo&&hostInfo.host_ko)?' <span class="tag no">KO integrit\xE0</span>':'')+'</label>'+((hostInfo && hostInfo.strutture && hostInfo.strutture.length)?'<p class="muted">Strutture host: '+hostInfo.strutture.map(x=>x.ko?'\u26A0\uFE0F (dati non leggibili)':esc(x.nome)).join(', ')+' \u2014 modifica dal profilo host in app.</p>':'')+'<p class="muted">Il profilo host \xE8 riservato a <b>Residente</b> e <b>Socio residente</b>: imposta prima il tipo profilo.</p></div>'}
    <p class="muted" id="under14note" style="display:none">Per gli under-14 la responsabilit\xE0 del trattamento \xE8 del genitore indicato: seleziona il genitore e la casata del figlio.</p>
    <div class="err" id="mErr"></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
  const syncTipo = () => {
    const t = $('#f_tipo').value;
    const u = t === 'under14', osp = t === 'ospite_temporaneo', resid = (t === 'residente' || t === 'socio_residente');
    $('#tutoreWrap').style.opacity = u ? '1' : '.5'; $('#under14note').style.display = u ? 'block' : 'none';
    // Visitatore (ospite temporaneo): periodo dal/al, niente tessera annuale.
    $('#dalWrap').style.display = osp ? 'block' : 'none';
    $('#alWrap').style.display = osp ? 'block' : 'none';
    $('#validaWrap').style.display = osp ? 'none' : 'block';
    $('#ospitenote').style.display = osp ? 'block' : 'none';
    // Ruolo: il Visitatore \xE8 "non socio" e il campo si blocca; per gli altri torna modificabile.
    const rr = $('#f_ruolo');
    if (rr) {
      if (osp) { rr.value = 'non_socio'; rr.disabled = true; }
      else { rr.disabled = false; if (rr.value === 'non_socio') rr.value = 'socio'; }
    }
    // Flag host: SOLO per i Residenti; per gli altri nascosto e disattivato.
    const hw = $('#hostWrap');
    if (hw) { hw.style.display = resid ? 'block' : 'none'; if (!resid) { const fh = $('#f_host'); if (fh) fh.checked = false; } }
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
    try {
      await api(isNew?'/soci':'/soci/'+s.id, { method:isNew?'POST':'PUT', body:JSON.stringify(body) });
      if (!isNew && ['residente','socio_residente'].includes($('#f_tipo').value)) {
        // Il flag host vale solo per i Residenti; l'aggancio ospite\u2192struttura NON si fa dal back office.
        await api('/soci/'+s.id+'/host', { method:'PUT', body: JSON.stringify({ host: $('#f_host')?.checked }) }).catch(()=>{});
      }
      closeModal(); show('soci');
    }
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

// ---- Campi & prenotazioni (stile Playtomic) ----
const SPORTS = [['pickleball', 'Pickleball'], ['soft_tennis', 'Soft tennis'], ['calcetto', 'Calcetto'], ['beach', 'Beach volley'], ['tennis', 'Tennis'], ['altro', 'Altro']];
VIEWS.campi = async () => {
  const campi = await api('/campi');
  const oggi = new Date().toISOString().slice(0, 10);
  const sportOpts = (sel) => SPORTS.map(s => \`<option value="\${s[0]}" \${sel === s[0] ? 'selected' : ''}>\${esc(s[1])}</option>\`).join('');
  const rows = campi.map(c => \`<tr>
    <td><input id="cp_n_\${c.id}" value="\${esc(c.nome)}" style="min-width:150px"></td>
    <td><select id="cp_sp_\${c.id}">\${sportOpts(c.sport)}</select></td>
    <td><input id="cp_ap_\${c.id}" value="\${esc(c.apertura)}" style="width:64px"></td>
    <td><input id="cp_ch_\${c.id}" value="\${esc(c.chiusura)}" style="width:64px"></td>
    <td><input id="cp_du_\${c.id}" type="number" value="\${esc(String(c.durata_slot))}" style="width:64px"></td>
    <td><input id="cp_om_\${c.id}" value="\${esc(c.ora_min || '')}" placeholder="\u2014" style="width:64px" title="Regola oraria: prenotabile solo da quest'ora (es. 18:00)"></td>
    <td><input id="cp_pd_\${c.id}" type="number" value="\${esc(String(c.posti_default))}" style="width:56px"></td>
    <td style="text-align:center"><input type="checkbox" id="cp_at_\${c.id}" \${c.attivo ? 'checked' : ''}></td>
    <td class="row"><button class="btn gold sm" data-cpsave="\${c.id}">Salva</button><button class="btn danger sm" data-cpdel="\${c.id}">\u{1F5D1}</button></td>
  </tr>\`).join('');
  const gestione = \`<div class="panel"><h3>\u{1F3BE} Campi</h3>
    <p class="muted" style="font-size:.78rem;margin-bottom:8px">La colonna <b>Da (ora)</b> \xE8 la regola oraria: lasciala vuota per nessun vincolo, oppure metti es. <b>18:00</b> (il calcetto si prenota solo dopo le 18). Gli slot sono lunghi <b>Durata</b> minuti, da <b>Apre</b> a <b>Chiude</b>.</p>
    <table><thead><tr><th>Nome</th><th>Sport</th><th>Apre</th><th>Chiude</th><th>Durata</th><th>Da (ora)</th><th>Posti part.</th><th>Attivo</th><th></th></tr></thead><tbody>\${rows || '<tr><td colspan="9" class="muted">Nessun campo.</td></tr>'}</tbody></table>
    <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px;align-items:center">
      <input id="cp_new_n" placeholder="Nome (es. Campo Pickleball)" style="min-width:180px"><select id="cp_new_sp">\${sportOpts('pickleball')}</select>
      <input id="cp_new_ap" value="09:00" style="width:64px" title="Apertura"><input id="cp_new_ch" value="22:00" style="width:64px" title="Chiusura">
      <input id="cp_new_du" type="number" value="60" style="width:64px" title="Durata slot (min)"><input id="cp_new_om" placeholder="Da (ora)" style="width:80px">
      <input id="cp_new_pd" type="number" value="4" style="width:64px" title="Posti partita"><button class="btn gold sm" id="cp_add">+ Aggiungi</button>
    </div></div>\`;
  const prospetto = \`<div class="panel"><h3>\u{1F4C5} Prenotazioni del giorno <input type="date" id="cp_date" value="\${oggi}" style="margin-left:8px"></h3><div id="cp_pren"></div></div>\`;
  $('#view').innerHTML = gestione + prospetto;

  const loadPren = async () => {
    const d = $('#cp_date').value || oggi;
    const list = await api('/campi/prenotazioni?data=' + d).catch(() => []);
    $('#cp_pren').innerHTML = list.length
      ? \`<table><thead><tr><th>Ora</th><th>Campo</th><th>Tipo</th><th>Prenotato da</th></tr></thead><tbody>\${list.map(p => \`<tr><td><b>\${esc(p.slot)}</b></td><td>\${esc(p.campo_nome)}</td><td>\${p.tipo === 'partita' ? '\u{1F465} Partita aperta' : 'Privata'}</td><td>\${esc(p.nome || '\u2014')}</td></tr>\`).join('')}</tbody></table>\`
      : '<p class="muted">Nessuna prenotazione per questa data.</p>';
  };
  await loadPren();
  $('#cp_date').onchange = loadPren;
  document.querySelectorAll('[data-cpsave]').forEach(b => b.onclick = async () => { const id = b.dataset.cpsave; await api('/campi/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#cp_n_' + id).value, sport: $('#cp_sp_' + id).value, apertura: $('#cp_ap_' + id).value, chiusura: $('#cp_ch_' + id).value, durata_slot: Number($('#cp_du_' + id).value), ora_min: $('#cp_om_' + id).value || null, posti_default: Number($('#cp_pd_' + id).value), attivo: $('#cp_at_' + id).checked }) }); b.textContent = '\u2713'; setTimeout(() => b.textContent = 'Salva', 900); });
  document.querySelectorAll('[data-cpdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il campo e le sue prenotazioni?')) return; await api('/campi/' + b.dataset.cpdel, { method: 'DELETE' }); show('campi'); });
  $('#cp_add').onclick = async () => { if (!$('#cp_new_n').value) { alert('Nome?'); return; } await api('/campi', { method: 'POST', body: JSON.stringify({ nome: $('#cp_new_n').value, sport: $('#cp_new_sp').value, apertura: $('#cp_new_ap').value, chiusura: $('#cp_new_ch').value, durata_slot: Number($('#cp_new_du').value), ora_min: $('#cp_new_om').value || null, posti_default: Number($('#cp_new_pd').value) }) }); show('campi'); };
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
const GIORNI_SETT = ['Luned\xEC', 'Marted\xEC', 'Mercoled\xEC', 'Gioved\xEC', 'Venerd\xEC', 'Sabato', 'Domenica'];
function giornoIdx(g) { const i = GIORNI_SETT.findIndex(d => d.toLowerCase() === String(g || '').trim().toLowerCase()); return i < 0 ? 99 : i; }
// Costo mostrato: quota della serata collegata (se c'\xE8) \u2192 altrimenti prezzo dell'evento \u2192 altrimenti libero.
function costoEvento(e, serate) {
  if (e.serata_id) { const s = (serate || []).find(x => x.id == e.serata_id); if (s && Number(s.quota) > 0) return Number(s.quota); }
  return Number(e.prezzo || 0);
}
function costoLabel(v) { return v > 0 ? '\u20AC ' + Number(v).toFixed(2) : 'Ingresso libero'; }

VIEWS.eventi = async () => {
  const [list, serate] = await Promise.all([api('/eventi'), api('/serate').catch(() => [])]);
  const ordinati = list.slice().sort((a, b) => giornoIdx(a.giorno) - giornoIdx(b.giorno) || (a.ordine - b.ordine));
  const serOpt = (sel) => \`<option value="">\u2014 nessuna (prezzo diretto) \u2014</option>\` + (serate || []).map(s => \`<option value="\${s.id}" \${sel == s.id ? 'selected' : ''}>\${esc(s.titolo)} \xB7 \u20AC \${Number(s.quota || 0).toFixed(2)}</option>\`).join('');
  $('#view').innerHTML = \`<div class="panel"><div class="row" style="justify-content:space-between;align-items:center">
      <h3 style="margin:0">Cartellone settimanale</h3>
      <div class="row"><button class="btn ghost sm" id="ev_new">+ Nuovo evento</button><button class="btn gold sm" id="ev_a3">\u{1F5A8}\uFE0F Locandina A3</button></div></div>
    <p class="muted" style="font-size:.82rem;margin:8px 0">Modello ibrido: qui il ritmo della settimana (giorno, ora, tipologia, artista, prezzo). Se l'evento \xE8 a pagamento con prenotazione/incasso, collegalo a una <b>Serata</b>: la locandina mostrer\xE0 la quota della serata.</p>
    <table><thead><tr><th>Giorno</th><th>Ora</th><th>Evento</th><th>Tipologia / Artista</th><th>Costo</th><th>Attivo</th><th></th></tr></thead><tbody>
    \${ordinati.map(e => \`<tr><td><b>\${esc(e.giorno || '\u2014')}</b></td><td>\${esc(e.ora_inizio || '\u2014')}</td>
      <td><b>\${esc(e.titolo)}</b>\${e.sottotitolo ? \`<br><span class="muted">\${esc(e.sottotitolo)}</span>\` : ''}</td>
      <td>\${esc(e.tipologia || '\u2014')}\${e.artista ? \`<br><span class="muted">\u{1F3A4} \${esc(e.artista)}</span>\` : ''}</td>
      <td>\${e.serata_id ? '\u{1F39F}\uFE0F ' : ''}\${esc(costoLabel(costoEvento(e, serate)))}</td>
      <td>\${e.attivo ? '<span class="tag ok">s\xEC</span>' : '<span class="tag no">no</span>'}</td>
      <td class="row"><button class="btn ghost sm" data-ev="\${e.id}">\u270E</button><button class="btn danger sm" data-evdel="\${e.id}">\u{1F5D1}</button></td></tr>\`).join('')}
  </tbody></table></div>\`;

  const editor = (e) => {
    const isNew = !e;
    e = e || { titolo: '', sottotitolo: '', ambiente: '', descrizione: '', giorno: '', ora_inizio: '', tipologia: '', artista: '', prezzo: 0, serata_id: '', attivo: true };
    modal(\`<h3>\${isNew ? 'Nuovo evento' : 'Modifica evento'}</h3>
      <div class="row"><label style="flex:1">Giorno<select id="e_g"><option value="">\u2014</option>\${GIORNI_SETT.map(d => \`<option \${d === e.giorno ? 'selected' : ''}>\${d}</option>\`).join('')}</select></label>
        <label style="width:110px">Ora inizio<input id="e_h" placeholder="21:00" value="\${esc(e.ora_inizio || '')}"></label></div>
      <label>Titolo evento</label><input id="e_t" value="\${esc(e.titolo || '')}">
      <label>Sottotitolo</label><input id="e_s" value="\${esc(e.sottotitolo || '')}">
      <div class="row"><label style="flex:1">Tipologia serata<input id="e_ty" placeholder="es. Jazz & Cocktail" value="\${esc(e.tipologia || '')}"></label>
        <label style="flex:1">Artista<input id="e_ar" placeholder="es. Trio X" value="\${esc(e.artista || '')}"></label></div>
      <label>Ambiente / luogo</label><input id="e_a" value="\${esc(e.ambiente || '')}">
      <label>Descrizione</label><textarea id="e_d" rows="3">\${esc(e.descrizione || '')}</textarea>
      <div class="row"><label style="width:150px">Prezzo biglietto \u20AC<input id="e_pz" type="number" step="0.01" inputmode="decimal" value="\${Number(e.prezzo || 0)}"></label>
        <label style="flex:1">Collega a Serata a pagamento<select id="e_ser">\${serOpt(e.serata_id)}</select></label>
        <button class="btn ghost sm" id="e_ser_new" style="align-self:flex-end">+ Crea serata</button></div>
      <p class="muted" style="font-size:.78rem">0 = ingresso libero. Se colleghi una Serata, prenotazione e incasso si gestiscono nella sezione <b>Serate</b> e in locandina compare la quota della serata. "<b>+ Crea serata</b>" genera una serata da questo evento (titolo, giorno/ora, quota = prezzo) e la collega qui.</p>
      <label class="check"><input type="checkbox" id="e_on" \${e.attivo ? 'checked' : ''}> Visibile nell'app</label>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>\`);
    $('#mCancel').onclick = closeModal;
    // Crea una serata a pagamento a partire dai campi dell'evento e la collega (senza uscire dall'editor).
    $('#e_ser_new').onclick = async () => {
      const titolo = $('#e_t').value.trim();
      if (!titolo) { alert('Inserisci prima il titolo dell\\'evento.'); return; }
      const giorno = $('#e_g').value, ora = $('#e_h').value;
      const quando = [giorno, ora].filter(Boolean).join(' \xB7 ');
      const quota = Number($('#e_pz').value || 0);
      try {
        const r = await api('/serate', { method: 'POST', body: JSON.stringify({ titolo, quando, tema: $('#e_ty').value, descrizione: $('#e_d').value, quota, capienza: 80 }) });
        const sel = $('#e_ser');
        const opt = document.createElement('option');
        opt.value = r.id; opt.textContent = \`\${titolo} \xB7 \u20AC \${quota.toFixed(2)}\`; opt.selected = true;
        sel.appendChild(opt);
        alert('Serata creata e collegata. Premi Salva per confermare l\\'evento; le prenotazioni si gestiscono nella sezione Serate.');
      } catch (err) { alert('Non riesco a creare la serata: ' + (err.message || 'permesso mancante?')); }
    };
    $('#mSave').onclick = async () => {
      const body = { giorno: $('#e_g').value, ora_inizio: $('#e_h').value, titolo: $('#e_t').value, sottotitolo: $('#e_s').value, tipologia: $('#e_ty').value, artista: $('#e_ar').value, ambiente: $('#e_a').value, descrizione: $('#e_d').value, prezzo: Number($('#e_pz').value || 0), serata_id: $('#e_ser').value || null, attivo: $('#e_on').checked };
      if (!body.titolo) { alert('Titolo obbligatorio'); return; }
      if (isNew) await api('/eventi', { method: 'POST', body: JSON.stringify(body) });
      else await api('/eventi/' + e.id, { method: 'PUT', body: JSON.stringify(body) });
      closeModal(); show('eventi');
    };
  };
  document.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => editor(list.find(x => x.id == b.dataset.ev)));
  document.querySelectorAll('[data-evdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare l\\'evento?')) return; await api('/eventi/' + b.dataset.evdel, { method: 'DELETE' }); show('eventi'); });
  $('#ev_new').onclick = () => editor(null);
  $('#ev_a3').onclick = () => locandinaA3(ordinati.filter(e => e.attivo), serate);
};

// ---- Avvisi push (broadcast del gestore) ----
VIEWS.avvisi = async () => {
  const [stato, casate] = await Promise.all([api('/push/stato').catch(() => ({})), api('/casate').catch(() => [])]);
  const statoBadge = stato.enabled
    ? \`<span class="tag ok">attivo</span> \xB7 \${stato.dispositivi || 0} dispositivi iscritti \xB7 \${stato.consenzienti || 0} soci col consenso\`
    : \`<span class="tag no">non configurato</span> \u2014 imposta le chiavi <b>VAPID_PUBLIC</b>/<b>VAPID_PRIVATE</b> su Render per inviare push reali (intanto l'avviso resta comunque nelle notifiche in-app).\`;
  $('#view').innerHTML = \`<div class="panel"><h3>\u{1F514} Invia un avviso ai soci</h3>
    <p class="muted" style="font-size:.82rem;margin:6px 0">Stato push: \${statoBadge}</p>
    <label>Titolo</label><input id="pb_t" placeholder="Es. Stasera Jazz & Cocktail alle 21:30">
    <label>Messaggio</label><textarea id="pb_c" rows="3" placeholder="Testo dell'avviso\u2026"></textarea>
    <label>Destinatari</label>
    <select id="pb_cas"><option value="">Tutti i soci col consenso</option>\${(casate || []).map(c => \`<option value="\${c.id}">Solo casata \${esc(c.nome)}</option>\`).join('')}</select>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn gold" id="pb_send">Invia avviso</button></div>
    <p class="muted" style="font-size:.78rem;margin-top:8px">L'avviso arriva come notifica push a chi ha attivato le notifiche e installato l'app, e resta sempre visibile nelle notifiche in-app.</p></div>\`;
  $('#pb_send').onclick = async () => {
    const titolo = $('#pb_t').value.trim(); if (!titolo) { alert('Titolo obbligatorio'); return; }
    const body = { titolo, corpo: $('#pb_c').value.trim(), casata_id: $('#pb_cas').value || null };
    try { const r = await api('/push/broadcast', { method: 'POST', body: JSON.stringify(body) });
      alert(\`Avviso inviato a \${r.destinatari} soci\` + (r.enabled ? \` \xB7 \${r.inviati} push consegnate.\` : ' (push non configurato: solo in-app).'));
      $('#pb_t').value = ''; $('#pb_c').value = '';
    } catch (err) { alert('Invio non riuscito: ' + (err.message || '')); }
  };
};

// Locandina A3 orizzontale, elegante, stampabile (o "Salva come PDF"): un evento per riga con
// giorno \xB7 ora \xB7 evento \xB7 tipologia \xB7 artista \xB7 costo. Stesso stile del men\xF9 PDF (logo, oro Bussola).
function locandinaA3(eventi, serate) {
  const logo = \`<svg width="54" height="54" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="none" stroke="#E0B44A" stroke-width="3"/><path d="M24 6 L29 24 L24 42 L19 24 Z" fill="#E0B44A"/><path d="M6 24 L24 19 L42 24 L24 29 Z" fill="#12324F" opacity="0.85"/></svg>\`;
  const righe = (eventi || []).map(e => {
    const costo = costoLabel(costoEvento(e, serate));
    return \`<div class="ev">
      <div class="gg"><div class="d">\${esc(e.giorno || '')}</div><div class="h">\${esc(e.ora_inizio || '')}</div></div>
      <div class="mid"><div class="ti">\${esc(e.titolo || '')}</div>
        \${e.tipologia ? \`<div class="ty">\${esc(e.tipologia)}</div>\` : ''}
        \${e.artista ? \`<div class="ar">\u{1F3A4} \${esc(e.artista)}</div>\` : ''}</div>
      <div class="co">\${esc(costo)}</div></div>\`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare la locandina.'); return; }
  w.document.write(\`<html><head><title>Eventi della settimana</title><style>
    @page{size:A3 landscape;margin:14mm}
    body{font-family:Georgia,'Times New Roman',serif;color:#12324F;margin:0}
    header{display:flex;align-items:center;gap:18px;border-bottom:3px solid #E0B44A;padding-bottom:16px;margin-bottom:22px}
    header .t{flex:1}
    header h1{margin:0;font-size:2.4rem;letter-spacing:2px}
    header .sub{font-size:1rem;letter-spacing:4px;color:#8a6d1f;font-family:Arial,sans-serif}
    header .wk{font-size:1.1rem;font-weight:bold;color:#12324F;font-family:Arial,sans-serif;text-align:right}
    .ev{display:flex;align-items:center;gap:22px;padding:14px 8px;border-bottom:1px solid #e6ddc7;break-inside:avoid}
    .gg{width:230px;flex-shrink:0}
    .gg .d{font-size:1.5rem;font-weight:bold;text-transform:uppercase;letter-spacing:1px}
    .gg .h{font-size:1.15rem;color:#8a6d1f;font-family:Arial,sans-serif}
    .mid{flex:1;min-width:0}
    .mid .ti{font-size:1.7rem;font-weight:bold;line-height:1.1}
    .mid .ty{display:inline-block;margin-top:4px;background:#12324F;color:#fff;font-family:Arial,sans-serif;font-size:.9rem;padding:2px 12px;border-radius:999px}
    .mid .ar{font-size:1.05rem;color:#333;font-family:Arial,sans-serif;margin-top:4px}
    .co{width:210px;flex-shrink:0;text-align:right;font-size:1.5rem;font-weight:bold;color:#8a6d1f;font-family:Arial,sans-serif}
    footer{margin-top:22px;border-top:1px solid #e6ddc7;padding-top:10px;font-size:.85rem;color:#777;font-family:Arial,sans-serif;text-align:center}
  </style></head><body>
    <header>\${logo}<div class="t"><h1>EVENTI DELLA SETTIMANA</h1><div class="sub">BUSSOLA RESIDENCE \xB7 by KOIN\xC8</div></div><div class="wk">Il programma delle serate</div></header>
    \${righe || '<p>Nessun evento attivo in programma.</p>'}
    <footer>Ti aspettiamo alla Bussola \xB7 Prenotazioni e info al chiosco</footer>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\\/script>
  </body></html>\`);
  w.document.close();
}

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

// build/chiosco.html
var chiosco_default = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#12324F">
<title>Bussola Crew</title>
<style>
:root{--navy:#12324F;--gold:#8a5a12;--teal:#256b65;--coral:#b14a35;--ink:#17242c;--paper:#F4F1E9;--line:#E3E1D6;--muted:#5a6670;--ok:#2e6b45;--mid:#8a5a12;--no:#b14a35;--accent:#12324F;}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);font-size:16px}
input,select,button{font-family:inherit;font-size:1rem}
input,select{padding:8px 10px;border:1px solid #cbd2d8;border-radius:9px;background:#fff}
.btn{border:none;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#e9e6dc;color:var(--ink)}
.btn.gold{background:var(--gold);color:#fff}.btn.ghost{background:#fff;border:1.5px solid #cbd2d8}.btn.danger{background:var(--coral);color:#fff}
.btn.sm{padding:6px 10px;font-size:.85rem;border-radius:8px}
.tag{display:inline-block;padding:3px 9px;border-radius:20px;font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;background:#e9e6dc;color:var(--muted)}
.tag.ok{background:#e6f2ea;color:var(--ok)}.tag.mid{background:#f6e9cf;color:var(--mid)}.tag.no{background:#f6e0da;color:var(--no)}
.muted{color:var(--muted)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.panel{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:14px}
.panel h3{color:var(--accent);font-size:1rem;margin-bottom:10px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #f0efe8;font-size:.9rem}th{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.4px}
/* topbar */
#top{background:linear-gradient(135deg,#12324F,#1c4a6e);color:#fff;padding:calc(12px + env(safe-area-inset-top)) 16px 0;position:sticky;top:0;z-index:5}
#top .brand{font-weight:800;letter-spacing:.5px;font-size:1.05rem}
#top .who{font-size:.75rem;opacity:.85}
#tabs{display:flex;gap:4px;margin-top:10px;overflow-x:auto}
#tabs button{background:transparent;border:none;color:#cfe0ee;font-weight:700;padding:10px 14px;border-radius:10px 10px 0 0;cursor:pointer;white-space:nowrap}
#tabs button.on{background:var(--paper);color:var(--navy)}
#view{padding:16px;max-width:1360px;margin:0 auto}
@media (max-width:560px){#view{padding:10px}#top{padding-left:10px;padding-right:10px}.panel{padding:12px}}
/* login */
#login{position:fixed;inset:0;background:radial-gradient(1200px 800px at 50% -10%,#1c3e5c,#0d2137);display:flex;align-items:center;justify-content:center;padding:20px;z-index:20}
#login .card{background:#fff;border-radius:18px;padding:26px;max-width:360px;width:100%}
#login h1{color:var(--navy);font-size:1.3rem;margin-bottom:2px}
#login .sub{color:var(--muted);font-size:.85rem;margin-bottom:16px}
#login label{display:block;font-weight:700;font-size:.8rem;margin:10px 0 4px;color:var(--navy)}
#login input{width:100%}
#loginErr{color:var(--coral);font-size:.85rem;margin-top:8px;min-height:1em}
.hide{display:none!important}
/* board tabelloni (Tavoli / Cucina): griglia che riempie tutto lo spazio + card accattivanti */
.board{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.tcard{border-radius:16px;padding:12px 14px;border:2px solid;position:relative;box-shadow:0 3px 10px rgba(18,50,79,.07);transition:transform .12s,box-shadow .12s;display:flex;flex-direction:column}
.tcard:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(18,50,79,.13)}
.tcard .thd{display:flex;justify-content:space-between;align-items:center;gap:6px}
.tcard .tnum{font-size:1.6rem;font-weight:800;line-height:1}
.tcard .tst{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-top:3px}
.tcard.libero{opacity:.7;box-shadow:none;border-style:dashed}
.tchip{font-size:.8rem;font-weight:800;color:#fff;border-radius:20px;padding:2px 10px;white-space:nowrap}
.split{display:flex;flex-direction:column;gap:12px;min-height:calc(100vh - 150px)}
.split>section{flex:1;min-height:180px;display:flex;flex-direction:column}
.split>section>.shd{display:flex;align-items:center;gap:8px;font-weight:800;color:var(--accent);margin-bottom:8px;position:sticky;top:0}
.tcard .zacc{position:absolute;top:0;left:0;right:0;height:4px;border-radius:14px 14px 0 0}
.tcard.clic{cursor:pointer}
.tref{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 8px;border-radius:9px;font-weight:800;font-size:1.05rem;color:#fff}
.tsub{font-size:.9rem;font-weight:800}
/* modale dettaglio */
.modal{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:16px}
.modal.hide{display:none!important}
.modal .mbg{position:absolute;inset:0;background:rgba(9,20,30,.55)}
.mbox{position:relative;background:#fff;border-radius:18px;max-width:520px;width:100%;max-height:86vh;overflow:auto;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.mbox h3{color:var(--accent);margin-bottom:2px}
.split>section>.board{overflow:auto;align-content:start;padding-bottom:4px}
.split .divider{height:2px;background:repeating-linear-gradient(90deg,var(--line) 0 12px,transparent 12px 20px)}
</style>
</head>
<body>
<div id="login">
  <div class="card">
    <h1>Bussola Crew</h1>
    <div class="sub">Back office operativo \xB7 accesso in base ai permessi</div>
    <label for="u">Operatore</label><input id="u" value="staff" autocomplete="username">
    <label for="p">Password</label><input id="p" type="password" placeholder="password" autocomplete="current-password">
    <label for="zona">Zona di questa postazione</label>
    <select id="zona"><option value="garden">\u{1F33F} Garden \u2014 comande a tavolo</option><option value="bar">\u{1F378} Bar \u2014 comande a nome</option><option value="cucina">\u{1F373} Cucina \u2014 ai fornelli</option><option value="magazzino">\u{1F4E6} Magazzino \u2014 logistica</option></select>
    <div class="sub" style="margin-top:4px">Potrai cambiarla al volo dalla barra in alto, senza rifare l'accesso.</div>
    <button class="btn gold" id="loginBtn" style="width:100%;margin-top:16px">Entra</button>
    <div id="loginErr"></div>
  </div>
</div>

<div id="app" style="display:none">
  <div id="top">
    <div class="row" style="justify-content:space-between">
      <span class="brand">\u{1F9ED} Bussola Crew</span>
      <span class="who" style="display:flex;align-items:center;gap:8px">
        <label style="display:flex;align-items:center;gap:5px;color:#cfe0ee">Zona
          <select id="zonaSwitch" style="padding:4px 8px;border-radius:8px;border:none;font-weight:700"><option value="garden">\u{1F33F} Garden</option><option value="bar">\u{1F378} Bar</option><option value="cucina">\u{1F373} Cucina</option><option value="magazzino">\u{1F4E6} Magazzino</option></select>
        </label>
        <span>\xB7 <span id="whoName"></span> \xB7 <a href="#" id="logout" style="color:#cfe0ee">esci</a></span>
      </span>
    </div>
    <div id="tabs">
      <button data-v="comande" class="on">\u{1F9FE} Comande</button>
      <button data-v="tavoli">\u{1F5FA}\uFE0F Tavoli</button>
      <button data-v="bar">\u{1F378} Bar</button>
      <button data-v="kds">\u{1F373} Cucina</button>
      <button data-v="scorte">\u{1F4CA} Giacenze</button>
      <button data-v="magazzino">\u{1F4E6} Magazzino</button>
      <button data-v="menu">\u{1F354} Men\xF9</button>
      <button data-v="riepilogo">\u{1F4CA} Riepilogo</button>
    </div>
  </div>
  <div id="view"></div>
</div>

<div id="modal" class="modal hide"><div class="mbg" id="modalBg"></div><div class="mbox" id="mbox"></div></div>

<script>
/* Componente COMANDA condiviso \u2014 una sola presentazione del men\xF9 per ogni contesto.
 * Step 0: chi lo usa carica il men\xF9 (da qualunque fonte) e lo passa qui.
 * Step 1: il men\xF9 viene raggruppato in modo logico e omogeneo (per categoria) e reso IDENTICO
 *         per lo staff (chiosco), per il cliente al tavolo (/ordina) e nell'app soci.
 * Indipendente e riusabile: nessuna dipendenza esterna, CSS auto-iniettato una volta.
 *
 * API:  const c = Comanda.create({ mount, menu, search=true, onChange(cart,total,count) })
 *       c.getRighe() -> [{menu_id, qta}]   c.total()   c.count()   c.clear()   c.setMenu(menu)   c.focusSearch()
 */
window.Comanda = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function eur(n) { return '\u20AC ' + (Number(n) || 0).toFixed(2); }
  function norm(s) { return (s == null ? '' : String(s)).toLowerCase(); }

  // Auto-categorie: se l'articolo non ha \`categoria\` valorizzata, la deduciamo dal NOME
  // cos\xEC la comanda si raggruppa in modo logico (Caffetteria, Bibite, Birre\u2026) come nel men\xF9 stampato,
  // senza dover categorizzare a mano tutto il listino. Una \`categoria\` esplicita vince sempre.
  const CAT_RULES = [
    ['Caffetteria', /caff[e\xE8]|cappucc|macchiat|marocchin|\\blatte\\b|orzo|ginseng|cioccolat|espress|ristrett|decaffe|shakerat|tisana|camomill|t[e\xE8]\\s*cald/i],
    ['Bibite', /acqua|coca|\\bcola\\b|fanta|sprite|aranciat|chinotto|gassosa|gazzosa|\\btonic|spremut|succ|t[e\xE8]\\s*fredd|th[e\xE8]|estath|energy|red\\s*bull|redbull|gatorade|powerade|bibit|cedrat|lemonsoda|oransoda|schweppes/i],
    ['Birre', /birr|\\bbeer\\b|\\bipa\\b|lager|weiss|weizen|\\bpils|stout|moretti|heineken|peroni|ichnusa|\\bcorona\\b|ceres|nastro\\s*azzurro/i],
    ['Aperitivi & Cocktail', /spritz|aperol|campari|negroni|american|mojito|cocktail|\\bgin\\b|vodka|\\brum\\b|tequila|whisk|bacardi|\\bmartini\\b|aperitiv|bitter|crodino|analcolic|\\blimoncell/i],
    ['Vini', /\\bvin[oi]\\b|calice|prosecc|spumant|franciacort|moscato|chardonnay|merlot|bollicin|champagne|champagn/i],
    ['Gelati', /gelat|ghiacciol|magnum|sorbett|granit|\\bstecco\\b|coppett/i],
    ['Snack', /patatin|\\bchips\\b|tarall|nachos|pop\\s*corn|popcorn|arachid|\\bolive\\b|salatin|cracker|pretzel|\\bsnack\\b/i],
    ['Panini & Piatti', /panin|toast|piadin|hamburger|hot\\s*dog|hotdog|pizz|focacc|tramezzin|\\bwrap\\b|insalat|\\bpasta\\b|sandwich|bruschett|tagliere|\\bfritt|arancin/i],
    ['Dolci', /cornetto|brioch|croissant|\\bdolc|\\btorta\\b|crostat|muffin|biscott|tiramis|budino|crep|cr[e\xEA]pe|waffle|nutella|pancake/i],
  ];
  const CAT_ORDER = CAT_RULES.map(r => r[0]).concat(['Bar', 'Cucina']);
  function inferCat(nome) { const s = String(nome == null ? '' : nome); for (const [name, rx] of CAT_RULES) { if (rx.test(s)) return name; } return null; }
  function catOf(m) { return (m.categoria && String(m.categoria).trim()) || inferCat(m.nome) || (m.stazione === 'cucina' ? 'Cucina' : 'Bar'); }
  function catRank(c) { if (c === 'Bar') return 900; if (c === 'Cucina') return 901; const i = CAT_ORDER.indexOf(c); return i < 0 ? 500 : i; }
  function sortCats(arr) { return arr.slice().sort((a, b) => (catRank(a) - catRank(b)) || String(a).localeCompare(String(b))); }
  function group(menu) { const g = {}; (menu || []).forEach(m => { const k = catOf(m); (g[k] = g[k] || []).push(m); }); return g; }

  // CSS iniettato una sola volta: stesso aspetto in ogni contesto (usa le variabili --navy/--gold se presenti).
  function injectCss() {
    if (document.getElementById('cmd-css')) return;
    const st = document.createElement('style'); st.id = 'cmd-css';
    st.textContent = \`
      .cmd{--c-navy:var(--navy,#12324F);--c-gold:var(--gold,#C9A227);--c-line:#cbd2d8}
      .cmd-tools{display:flex;gap:6px;margin-bottom:8px;align-items:center}
      .cmd-q{flex:1;min-width:140px;padding:9px 11px;border:1.5px solid var(--c-line);border-radius:10px;font-size:1rem}
      .cmd-qx{border:1.5px solid var(--c-line);background:#fff;border-radius:10px;width:38px;height:38px;font-weight:700;color:var(--c-navy)}
      .cmd-chips{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:2px;margin-bottom:8px}
      .cmd-chip{border:1.5px solid var(--c-line);background:#fff;color:var(--c-navy);border-radius:999px;padding:6px 14px;font-weight:700;font-size:.85rem;white-space:nowrap;cursor:pointer}
      .cmd-chip.on{background:var(--c-navy);color:#fff;border-color:var(--c-navy)}
      .cmd-list{columns:280px;column-gap:16px}
      .cmd-group{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;margin-bottom:10px}
      .cmd-cat{font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--c-navy);font-size:.8rem;margin:0 0 6px;padding-top:2px}
      .cmd-group:first-child .cmd-cat{padding-top:0}
      .cmd-item{background:#fff;border:1.5px solid var(--c-line);border-radius:12px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center}
      .cmd-info{flex:1;min-width:0}
      .cmd-info b{display:block;color:var(--c-navy)}
      .cmd-desc{font-size:.78rem;color:#555;display:block}
      .cmd-alg{font-size:.7rem;color:#8a6d1f;font-style:italic;display:block}
      .cmd-pz{color:var(--c-gold);font-weight:800;white-space:nowrap;font-size:.92rem}
      .cmd-step{display:flex;gap:6px;align-items:center}
      .cmd-b{border:1.5px solid var(--c-line);background:#fff;border-radius:9px;width:34px;height:34px;font-size:1.15rem;font-weight:800;color:var(--c-navy);line-height:1}
      .cmd-b.add{background:var(--c-gold);color:#fff;border-color:var(--c-gold)}
      .cmd-n{min-width:20px;text-align:center;font-weight:800;color:var(--c-navy)}
      .cmd-empty{color:#777;padding:10px 2px;font-size:.9rem}\`;
    document.head.appendChild(st);
  }

  function create(opts) {
    injectCss();
    const mount = opts.mount;
    let menu = opts.menu || [];
    const useSearch = opts.search !== false;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    const cart = {};
    let selCat = '';

    mount.classList.add('cmd');
    mount.innerHTML = (useSearch
      ? \`<div class="cmd-tools"><input class="cmd-q" placeholder="\u{1F50D} Cerca prodotto\u2026" autocomplete="off"><button class="cmd-qx" title="Pulisci">\u2715</button></div><div class="cmd-chips"></div>\`
      : '') + \`<div class="cmd-list"></div>\`;

    const $ = (sel) => mount.querySelector(sel);
    const listEl = $('.cmd-list');
    const qEl = useSearch ? $('.cmd-q') : null;
    const chipsEl = useSearch ? $('.cmd-chips') : null;

    function cats() { return sortCats([...new Set((menu || []).map(catOf))]); }
    function total() { let t = 0; Object.keys(cart).forEach(id => { const m = menu.find(x => String(x.id) === id); if (m) t += Number(m.prezzo) * cart[id]; }); return t; }
    function count() { let n = 0; Object.keys(cart).forEach(id => n += cart[id]); return n; }
    function fire() { onChange(cart, total(), count()); }

    function itemHTML(m) {
      const q = cart[m.id] || 0;
      return \`<div class="cmd-item"><div class="cmd-info"><b>\${esc(m.nome)}</b>\${m.descrizione ? \`<span class="cmd-desc">\${esc(m.descrizione)}</span>\` : ''}\${m.allergeni ? \`<span class="cmd-alg">Allergeni: \${esc(m.allergeni)}</span>\` : ''}</div><span class="cmd-pz">\${eur(m.prezzo)}</span><div class="cmd-step"><button class="cmd-b" data-cdec="\${m.id}">\u2212</button><b class="cmd-n" data-cn="\${m.id}">\${q}</b><button class="cmd-b add" data-cadd="\${m.id}">+</button></div></div>\`;
    }
    function renderChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = ['', ...cats()].map(c => \`<button class="cmd-chip\${c === selCat ? ' on' : ''}" data-ccat="\${esc(c)}">\${c === '' ? 'Tutti' : esc(c)}</button>\`).join('');
    }
    function renderList() {
      const q = norm(qEl && qEl.value).trim();
      const g = {};
      (menu || []).forEach(m => {
        const k = catOf(m);
        if (selCat && k !== selCat) return;
        if (q && !(norm(m.nome).includes(q) || norm(m.categoria).includes(q) || norm(m.allergeni).includes(q))) return;
        (g[k] = g[k] || []).push(m);
      });
      const keys = sortCats(Object.keys(g));
      // Ogni categoria \xE8 un blocco che NON si spezza tra le colonne: su schermi larghi (cassa/tablet)
      // il men\xF9 si dispone su pi\xF9 colonne e l'operatore non deve scorrere per cercare l'articolo.
      listEl.innerHTML = keys.length
        ? keys.map(cat => \`<div class="cmd-group"><div class="cmd-cat">\${esc(cat)}</div>\${g[cat].map(itemHTML).join('')}</div>\`).join('')
        : \`<p class="cmd-empty">Nessun prodotto\${q ? ' per \u201C' + esc(q) + '\u201D' : ''}.</p>\`;
    }
    function setN(id) { const el = mount.querySelector('[data-cn="' + id + '"]'); if (el) el.textContent = cart[id] || 0; }
    function chg(id, d) {
      const m = menu.find(x => String(x.id) === String(id)); if (!m) return;
      cart[id] = (cart[id] || 0) + d; if (cart[id] <= 0) delete cart[id];
      setN(id); fire();
    }

    // Delegazione: un solo listener per tutto il componente.
    mount.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-cadd],[data-cdec],[data-ccat]'); if (!a) return;
      if (a.dataset.cadd != null) return chg(a.dataset.cadd, 1);
      if (a.dataset.cdec != null) return chg(a.dataset.cdec, -1);
      if (a.dataset.ccat != null) { selCat = a.dataset.ccat; renderChips(); renderList(); }
    });
    if (qEl) qEl.addEventListener('input', renderList);
    if (useSearch) { const x = $('.cmd-qx'); if (x) x.addEventListener('click', () => { if (qEl) { qEl.value = ''; qEl.focus(); } renderList(); }); }

    renderChips(); renderList(); fire();

    return {
      getRighe() { return Object.keys(cart).map(id => ({ menu_id: Number(id), qta: cart[id] })); },
      total, count,
      clear() { Object.keys(cart).forEach(k => delete cart[k]); selCat = ''; renderChips(); renderList(); fire(); },
      setMenu(m) { menu = m || []; Object.keys(cart).forEach(k => delete cart[k]); selCat = ''; renderChips(); renderList(); fire(); },
      focusSearch() { if (qEl) qEl.focus(); },
    };
  }

  // Esposti perch\xE9 PDF stampabile e comanda usino LO STESSO raggruppamento/ordine (nessuno "scalino").
  return { create, group, esc, eur, catOf, inferCat, sortCats };
})();

</script>
<script>
/* Bussola Chiosco \u2014 app operativa separata: comande + KDS + magazzino + men\xF9.
   Stesso server/API del back office, ma ambiente e login dedicati agli operatori. */
'use strict';
let TOKEN = null, ME = { gestore: false, caps: [] };
// Zona della postazione (dichiarata al login): 'garden' = comande a tavolo \xB7 'bar' = comande a nome.
let ZONA = (typeof localStorage !== 'undefined' && localStorage.getItem('bussola_zona')) || 'garden';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => '\u20AC ' + Number(n || 0).toFixed(2);
const API_BASE = (typeof window !== 'undefined' && window.KOINE_API) ? String(window.KOINE_API).replace(/\\/$/, '') : '';

async function api(path, opts = {}) {
  const r = await fetch(API_BASE + '/api/admin' + path, { headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }, ...opts });
  if (r.status === 401) { logout(); throw new Error('non autorizzato'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

async function login() {
  $('#loginErr').textContent = '';
  try {
    const res = await fetch(API_BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#u').value, password: $('#p').value }) });
    if (!res.ok) throw new Error('Credenziali non valide');
    const j = await res.json(); TOKEN = j.token;
    ME = await api('/me').catch(() => ({ gestore: false, caps: [] }));
    // Accesso a Bussola Crew: basta UN permesso operativo (comande o magazzino); si vedono solo le zone consentite.
    const zone = allowedZones();
    if (!zone.length) throw new Error('Nessun permesso operativo. Chiedi al gestore l\u2019abilitazione a Comande o Magazzino.');
    filterZoneSelectors(zone);
    $('#login').style.display = 'none'; $('#app').style.display = 'block';
    $('#whoName').textContent = j.user.username;
    const zs = $('#zonaSwitch'); if (zs && !zs.__wired) { zs.__wired = true; zs.onchange = () => setZona(zs.value); }
    const salvata = (() => { try { return localStorage.getItem('bussola_zona'); } catch (_) { return null; } })();
    setZona(zone.includes(salvata) ? salvata : zone[0]);   // parte da una zona consentita
  } catch (e) { $('#loginErr').textContent = e.message; }
}
function logout() { TOKEN = null; ME = { gestore: false, caps: [] }; $('#app').style.display = 'none'; $('#login').style.display = 'flex'; }
// Zone consentite in base ai permessi: comande \u2192 garden/bar/cucina \xB7 magazzino \u2192 magazzino.
function allowedZones() {
  const caps = ME.caps || [];
  const z = [];
  if (ME.gestore || caps.includes('comande')) z.push('garden', 'bar', 'cucina');
  if (ME.gestore || caps.includes('magazzino')) z.push('magazzino');
  return z;
}
// Filtra i selettori zona (login + barra) lasciando solo le zone consentite.
function filterZoneSelectors(zone) {
  ['#login #zona', '#zonaSwitch'].forEach(sel => {
    const el = document.querySelector(sel); if (!el) return;
    Array.from(el.options).forEach(o => { const ok = zone.includes(o.value); o.hidden = !ok; o.disabled = !ok; });
    if (!zone.includes(el.value)) el.value = zone[0];
  });
}
// Cambio zona AL VOLO (stessa persona): resta nelle zone consentite dai permessi.
function setZona(z) {
  const allow = allowedZones();
  ZONA = allow.includes(z) ? z : (allow[0] || 'garden');
  try { localStorage.setItem('bussola_zona', ZONA); } catch (_) {}
  applyZona();
  show(ZONA === 'cucina' ? 'kds' : ZONA === 'magazzino' ? 'magazzino' : 'comande');
}
// Mostra solo i tab pertinenti alla zona corrente:
//  Garden \u2192 Comande+Tavoli+Giacenze \xB7 Bar \u2192 Comande+Bar+Giacenze \xB7 Cucina \u2192 Cucina \xB7 Magazzino \u2192 hub Centrale/Bar/Garden.
function applyZona() {
  const tog = (v, show) => { const el = document.querySelector('#tabs [data-v="' + v + '"]'); if (el) el.classList.toggle('hide', !show); };
  const hasMag = ME.gestore || (ME.caps || []).includes('magazzino');
  tog('comande', ZONA === 'garden' || ZONA === 'bar');
  tog('tavoli', ZONA === 'garden');
  tog('bar', ZONA === 'bar');
  tog('kds', ZONA === 'cucina');
  tog('scorte', hasMag && (ZONA === 'bar' || ZONA === 'garden'));  // "Giacenze": sotto-magazzino della zona
  tog('magazzino', hasMag && ZONA === 'magazzino');                // hub logistica (Centrale/Bar/Garden)
  tog('menu', ZONA === 'garden' || ZONA === 'bar');                // il men\xF9 serve solo dove si prende la comanda
  tog('riepilogo', ZONA === 'garden' || ZONA === 'bar');           // riepilogo comande: solo Garden/Bar
  const z = document.querySelector('#login #zona'); if (z) z.value = ZONA;
  const zs = document.querySelector('#zonaSwitch'); if (zs) zs.value = ZONA;
  applyAccent();
}
// Accento-colore per FUNZIONE: identit\xE0 unica, ma la topbar e i titoli si tingono in base alla zona,
// cos\xEC l'operatore sa sempre "dove si trova". Garden=verde \xB7 Bar=oro \xB7 Cucina=corallo \xB7 Magazzino=navy.
const ZONA_ACCENT = {
  garden:    { a: '#256b65', g1: '#1d5a54', g2: '#2f8a80', nome: 'Garden' },
  bar:       { a: '#8a5a12', g1: '#6e4a12', g2: '#a9791f', nome: 'Bar' },
  cucina:    { a: '#b14a35', g1: '#8f3826', g2: '#c8624b', nome: 'Cucina' },
  magazzino: { a: '#12324f', g1: '#12324F', g2: '#1c4a6e', nome: 'Magazzino' },
};
function applyAccent() {
  const z = ZONA_ACCENT[ZONA] || ZONA_ACCENT.magazzino;
  document.documentElement.style.setProperty('--accent', z.a);
  const top = document.querySelector('#top');
  if (top) top.style.background = \`linear-gradient(135deg, \${z.g1}, \${z.g2})\`;
}

// Scarica un file (base64) restituito da un endpoint di export.
function downloadB64(filename, mime, b64) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = filename || 'export'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function esporta(path) { try { const d = await api(path); downloadB64(d.filename, d.mime, d.b64); } catch (e) { alert('Export non riuscito: ' + (e.message || '')); } }

const VIEWS = {};
async function show(v) {
  if (window.__kdsTimer) { clearInterval(window.__kdsTimer); window.__kdsTimer = null; }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#view').innerHTML = '<p class="muted">Carico\u2026</p>';
  try { await VIEWS[v](); } catch (e) { $('#view').innerHTML = \`<p class="muted">Errore: \${esc(e.message)}</p>\`; }
}

const COM_STATI = { aperta: ['Aperta', 'mid'], in_preparazione: ['In preparazione', 'mid'], pronta: ['Pronta', 'ok'], consegnata: ['Consegnata', 'ok'], chiusa: ['Chiusa', ''], annullata: ['Annullata', 'no'] };
// Badge canale: distingue a colpo d'occhio le comande "self" (cliente) da quelle dello staff.
const canaleBadge = (c) => c.canale === 'self'
  ? \`<span class="tag mid" style="background:#e7f0f6;color:#12324F">\u{1F64B} Self\${c.punto ? ' \xB7 ' + esc(c.punto) : ''}</span>\`
  : \`<span class="tag" style="background:#eef7ee;color:#2e6b3f">\u{1F464} Staff</span>\`;
const METODI = [['contanti', '\u{1F4B6} Contanti'], ['carta', '\u{1F4B3} Carta'], ['satispay', '\u{1F4F1} Satispay'], ['buoni', '\u{1F39F}\uFE0F Buoni'], ['altro', '\u2026 Altro']];
const metodoLabel = (m) => (METODI.find(x => x[0] === m) || [m, m || '\u2014'])[1];
// Chooser del metodo di pagamento alla chiusura (overlay touch-friendly).
function pickMetodo(onPick) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px';
  ov.innerHTML = \`<div style="background:#fff;border-radius:16px;padding:20px;max-width:360px;width:100%">
    <b style="color:var(--navy);font-size:1.05rem">Come ha pagato?</b>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      \${METODI.map(m => \`<button class="btn \${m[0] === 'contanti' ? 'gold' : 'ghost'}" data-m="\${m[0]}" style="padding:14px 10px">\${m[1]}</button>\`).join('')}
    </div>
    <button class="btn ghost" data-m="" style="width:100%;margin-top:10px">Annulla</button></div>\`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const m = b.dataset.m; document.body.removeChild(ov); if (m) onPick(m); });
}

/* ---------- COMANDE (cassa): l'operatore vede il men\xF9 ESATTAMENTE come il cliente ---------- */
VIEWS.comande = async () => {
  const menu = (await api('/menu')).filter(m => m.attivo);
  const garden = ZONA === 'garden';
  // Il pannello self-order (pausa/pressione/ETA/mappa) riguarda il Garden (QR al tavolo): solo l\xEC.
  const so = garden ? await api('/self-order/stato').catch(() => ({ aperto: true, eta_min: 0, config: {} })) : null;
  const cfg = so ? (so.config || {}) : {};

  let soPanel = '';
  if (garden) {
    const etaTxt = so.eta_min > 0 ? \`attesa stimata ~\${so.eta_min} min\` : 'coda libera';
    const bordo = !so.aperto ? 'var(--coral,#C0553F)' : (so.pressione ? 'var(--gold,#8a5a12)' : 'var(--ok,#2e6b45)');
    const statoRiga = !so.aperto
      ? '\u{1F534} <b>sospesi</b> (manuale) \u2014 i clienti col QR non possono ordinare'
      : (so.sospeso_pressione ? '\u{1F7E0} <b>sospesi in automatico</b> \u2014 cucina sotto pressione' : (so.pressione ? '\u{1F7E0} <b>aperti</b> \xB7 \u26A0\uFE0F cucina sotto pressione' : '\u{1F7E2} <b>aperti</b> \xB7 cucina regolare'));
    const pressSpieg = cfg.press_modo === 'tempo' ? \`oltre \${cfg.press_max_minuti} min di attesa stimata\` : \`oltre \${cfg.press_max_comande} comande da smaltire\`;
    soPanel = \`
    <div class="panel" style="border-left:5px solid \${bordo}">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div><b style="color:var(--navy)">\u{1F4F1} Ordini dal telefono (self-order): \${statoRiga}</b>
          <div class="muted" style="font-size:.82rem">\${etaTxt} \xB7 \${so.attive || 0} comande in coda \xB7 pressione: \${pressSpieg}\${cfg.press_auto ? ' \u2192 sospensione automatica' : ' \u2192 solo avviso'}.</div></div>
        <div class="row">
          <button class="btn ghost sm" id="so_cfg">\u2699\uFE0F Regole</button>
          <button class="btn \${so.aperto ? 'danger' : 'gold'} sm" id="so_toggle">\${so.aperto ? '\u23F8\uFE0F Sospendi' : '\u25B6\uFE0F Riapri'}</button>
        </div>
      </div>
      <div id="so_cfgbox" class="hide" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:230px">
            <b style="color:var(--navy);font-size:.9rem">\u{1F525} Pressione cucina</b>
            <label style="display:block;font-size:.8rem;margin-top:6px">Come si misura
              <select id="cf_pmodo"><option value="statico" \${cfg.press_modo !== 'tempo' ? 'selected' : ''}>a numero di comande</option><option value="tempo" \${cfg.press_modo === 'tempo' ? 'selected' : ''}>a tempo reale (attesa)</option></select></label>
            <label style="display:block;font-size:.8rem;margin-top:6px">Soglia comande in coda <input id="cf_pcom" type="number" min="1" value="\${cfg.press_max_comande || 6}" style="width:70px"></label>
            <label style="display:block;font-size:.8rem;margin-top:6px">Attesa massima (min) <input id="cf_pmin" type="number" min="1" value="\${cfg.press_max_minuti || 10}" style="width:70px"></label>
            <label style="display:block;font-size:.8rem;margin-top:6px"><input type="checkbox" id="cf_pauto" \${cfg.press_auto ? 'checked' : ''}> Sospendi automaticamente sotto pressione (altrimenti solo avviso)</label>
          </div>
          <div style="min-width:230px">
            <b style="color:var(--navy);font-size:.9rem">\u23F1\uFE0F Tempo stimato d'attesa</b>
            <label style="display:block;font-size:.8rem;margin-top:6px">Come si calcola
              <select id="cf_emodo"><option value="statico" \${cfg.eta_modo !== 'tempo' ? 'selected' : ''}>stima fissa (\${cfg.eta_base || 3} min + \${cfg.eta_per_item || 2}/articolo)</option><option value="tempo" \${cfg.eta_modo === 'tempo' ? 'selected' : ''}>misura tempo reale (ritmo di smaltimento)</option></select></label>
          </div>
          <div style="min-width:230px">
            <b style="color:var(--navy);font-size:.9rem">\u{1F5FA}\uFE0F Mappa tavoli (Garden)</b>
            <label style="display:block;font-size:.8rem;margin-top:6px">Numero tavoli <input id="cf_tav" type="number" min="1" value="\${cfg.garden_tavoli || 12}" style="width:70px"></label>
            <label style="display:block;font-size:.8rem;margin-top:6px">Rosso dopo (min) <input id="cf_mrosso" type="number" min="1" value="\${cfg.map_rosso_min || 10}" style="width:70px"></label>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn gold sm" id="cf_save">Salva regole</button></div>
      </div>
    </div>\`;
  }

  const entry = garden
    ? \`<label>Tavolo <input id="co_tav" type="number" min="1" inputmode="numeric" placeholder="n\xB0" style="width:100px"></label>\`
    : \`<label>Nome cliente <input id="co_nome" placeholder="es. Mario" style="max-width:220px"></label>\`;

  $('#view').innerHTML = soPanel + \`
    <div class="panel"><h3>\u{1F9FE} Nuova comanda \xB7 \${garden ? '\u{1F33F} Garden (a tavolo)' : '\u{1F378} Bar (a nome)'}</h3>
      <div class="row" style="margin-bottom:8px">\${entry}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <div style="flex:2;min-width:280px">
          \${menu.length ? '<div id="co_menu"></div>' : '<p class="muted">Men\xF9 vuoto. Vai su \u201CMen\xF9\u201D per caricarlo.</p>'}
        </div>
        <div style="flex:1;min-width:230px" class="panel">
          <b style="color:var(--navy)">Comanda</b><div id="co_cart" style="margin-top:6px"></div>
          <div id="co_tot" style="text-align:right;font-weight:800;margin-top:8px"></div>
          <button class="btn gold" id="co_send" style="width:100%;margin-top:8px">\${garden ? '\u{1F33F} Invia (tavolo)' : '\u{1F378} Invia (bar)'}</button>
          <p class="muted" style="font-size:.74rem;margin-top:8px">Lo stato delle comande \xE8 nella tab \${garden ? '\u{1F5FA}\uFE0F <b>Tavoli</b>' : '\u{1F378} <b>Bar</b>'}; i piatti li lavora la postazione \u{1F373} <b>Cucina</b>.</p>
        </div>
      </div></div>\`;

  const renderCart = (cart) => {
    const ids = Object.keys(cart || {});
    $('#co_cart').innerHTML = ids.length
      ? ids.map(id => { const m = menu.find(x => String(x.id) === id); return \`<div style="display:flex;gap:6px;padding:3px 0;font-size:.85rem"><span style="flex:1">\${cart[id]}\xD7 \${esc(m.nome)}</span><span style="width:60px;text-align:right">\${eur(m.prezzo * cart[id])}</span></div>\`; }).join('')
      : '<span class="muted" style="font-size:.85rem">Tocca un prodotto del men\xF9.</span>';
  };
  let CO = null;
  if (menu.length) {
    CO = Comanda.create({ mount: $('#co_menu'), menu, search: true, onChange: (cart, tot) => { $('#co_tot').textContent = 'Totale ' + eur(tot); renderCart(cart); } });
    CO.focusSearch();
  } else { renderCart({}); }
  $('#co_send').onclick = async () => {
    const righe = CO ? CO.getRighe() : [];
    if (!righe.length) { alert('Aggiungi almeno un prodotto.'); return; }
    let riferimento, zona, origine;
    if (garden) { riferimento = ($('#co_tav').value || '').trim(); if (!riferimento) { alert('Indica il numero del tavolo.'); return; } zona = 'garden'; origine = 'tavolo'; }
    else { riferimento = ($('#co_nome').value || '').trim(); if (!riferimento) { alert('Indica il nome del cliente.'); return; } zona = 'bar'; origine = 'bar'; }
    await api('/comande', { method: 'POST', body: JSON.stringify({ origine, zona, riferimento, righe }) });
    show('comande');   // pronto per la comanda successiva; la fotografia \xE8 nella tab Tavoli/Bar
  };
  if (garden) {
    $('#so_toggle').onclick = async () => { await api('/self-order/pausa', { method: 'POST', body: JSON.stringify({ aperto: !so.aperto }) }); show('comande'); };
    $('#so_cfg').onclick = () => $('#so_cfgbox').classList.toggle('hide');
    $('#cf_save').onclick = async () => {
      await api('/self-order/config', { method: 'POST', body: JSON.stringify({
        press_modo: $('#cf_pmodo').value, press_max_comande: Number($('#cf_pcom').value || 6), press_max_minuti: Number($('#cf_pmin').value || 10),
        press_auto: $('#cf_pauto').checked, eta_modo: $('#cf_emodo').value,
        garden_tavoli: Number($('#cf_tav').value || 12), map_rosso_min: Number($('#cf_mrosso').value || 10),
      }) });
      show('comande');
    };
  }
};

/* ---------- KDS ---------- */
// --- Helper condivisi per tabelloni (Cucina / Tavoli / Bar): stato + colore per gruppo di comande ---
const parseTs = (s) => { if (!s) return null; const d = new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z'); return isNaN(d.getTime()) ? null : d; };
const ZCOL = {
  giallo:  { bg: '#fff6e0', bd: '#c79200', tx: '#7a5c00', lb: 'in lavorazione' },
  rosso:   { bg: '#fdecea', bd: '#d64535', tx: '#8a2a20', lb: 'in ritardo' },
  verde:   { bg: '#e8f5ea', bd: '#3f8f4e', tx: '#245c30', lb: 'consegnato' },
  arancio: { bg: '#fdece0', bd: '#d98a2b', tx: '#8a4b12', lb: 'libero' },
};
// Ciclo colore (specifica utente): giallo appena acquisita \xB7 rosso oltre soglia \xB7 verde consegnata \xB7 arancio = libero/base.
function statoGruppo(cs, rossoMin, nowMs) {
  const open = cs.filter(c => ['aperta', 'in_preparazione', 'pronta'].includes(c.stato));
  const delivered = cs.filter(c => c.stato === 'consegnata');
  if (open.length) {
    const ts = open.map(c => parseTs(c.created_at)).filter(Boolean).map(d => d.getTime());
    const since = ts.length ? Math.min(...ts) : null;
    const mins = since != null ? Math.max(0, Math.round((nowMs - since) / 60000)) : null;
    return { key: (mins != null && mins >= rossoMin) ? 'rosso' : 'giallo', since, mins, open, delivered };
  }
  if (delivered.length) {
    const ts = delivered.map(c => parseTs(c.created_at)).filter(Boolean).map(d => d.getTime());
    return { key: 'verde', since: ts.length ? Math.min(...ts) : null, mins: null, open, delivered };
  }
  return { key: 'arancio', since: null, mins: null, open, delivered };
}
const URG = { rosso: 0, giallo: 1, verde: 2, arancio: 3 };
// Accenti-zona (coerenti con la fase di comanda): Garden verde, Bar oro.
const ACC_GARDEN = '#256b65', ACC_BAR = '#8a5a12';
const hhmmOf = (since) => since ? new Date(since).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
const chipOf = (st) => st.mins != null ? \`<span class="tchip" style="background:\${ZCOL[st.key].bd}">\${st.mins}\u2032</span>\` : (st.key === 'verde' ? '<span class="tchip" style="background:#3f8f4e">\u2714</span>' : '');
// Card TAVOLO (mappa Garden): riferimento compatto (chip numero), accento verde, clic per dettaglio.
function tavoloCard(tb) {
  const c = ZCOL[tb.st.key];
  const items = tb.cs.flatMap(x => x.righe || []).map(r => \`\${r.qta}\xD7 \${esc(r.nome)}\`);
  const libero = tb.st.key === 'arancio' && !tb.cs.length;
  const pay = tb.st.key === 'verde' ? \`<button class="btn gold sm" data-tpay="\${tb.st.delivered.map(x => x.id).join(',')}" style="margin-top:8px;width:100%">\u{1F4B6} Incassa</button>\` : '';
  return \`<div class="tcard clic\${libero ? ' libero' : ''}" data-tdetail="\${tb.t}" style="border-color:\${c.bd};background:\${c.bg}">
    <div class="zacc" style="background:\${ACC_GARDEN}"></div>
    <div class="thd" style="margin-top:2px"><span class="row" style="gap:8px"><span class="tref" style="background:\${c.bd}">\${tb.t}</span><span class="tsub" style="color:\${c.tx}">Tavolo</span></span>\${chipOf(tb.st)}</div>
    <div class="tst" style="color:\${c.tx}">\${c.lb}\${tb.st.since ? ' \xB7 ' + hhmmOf(tb.st.since) : ''}</div>
    \${items.length ? \`<div style="margin-top:8px;font-size:.82rem;color:#2a2a2a;line-height:1.45">\${items.slice(0, 5).join('<br>')}\${items.length > 5 ? \`<br><span class="muted">+\${items.length - 5} \u2026</span>\` : ''}</div>\` : (libero ? '<div class="muted" style="margin-top:8px;font-size:.78rem">\u2014 libero \u2014</div>' : '')}
    \${pay}</div>\`;
}
// Card CUCINA (per tavolo/nome): riferimento differenziato Bar (nome, oro) / Garden (n\xB0 tavolo, verde), clic per dettaglio.
function cucinaCard(g) {
  const c = ZCOL[g.st.key];
  const isBar = g.zona === 'bar';
  const acc = isBar ? ACC_BAR : ACC_GARDEN;
  const ref = isBar
    ? \`<span class="row" style="gap:6px"><span class="tsub" style="color:\${c.tx};font-size:1.02rem">\u{1F378} \${esc(g.rif)}</span></span>\`
    : \`<span class="row" style="gap:8px"><span class="tref" style="background:\${c.bd}">\${esc(g.rif)}</span><span class="tsub" style="color:\${c.tx}">Tavolo</span></span>\`;
  const righe = g.comande.flatMap(cm => (cm.righe || []).map(r => ({ cm, r }))).map(({ cm, r }) => \`<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.06)"><span style="flex:1"><b>\${r.qta}\xD7</b> \${esc(r.nome)}\${r.note ? \`<div class="muted" style="font-size:.75rem">\${esc(r.note)}</div>\` : ''}</span>\${r.stato === 'in_coda' ? \`<button class="btn gold sm" data-kr="\${cm.id}|\${r.id}|pronta">Pronta \u2714</button>\` : \`<button class="btn ghost sm" data-kr="\${cm.id}|\${r.id}|consegnata">Consegna \u{1F6CE}</button>\`}</div>\`).join('');
  return \`<div class="tcard clic" data-kdetail="\${g.zona}|\${esc(g.rif)}" style="border-color:\${c.bd};background:\${c.bg}">
    <div class="zacc" style="background:\${acc}"></div>
    <div class="thd" style="margin-top:2px">\${ref}\${chipOf(g.st)}</div>
    <div class="tst" style="color:\${c.tx}">\${c.lb}\${g.st.since ? ' \xB7 ' + hhmmOf(g.st.since) : ''}</div>
    <div style="margin-top:6px">\${righe}</div></div>\`;
}
// ---- Modale dettaglio (clic su una card) ----
function openModal(html) { $('#mbox').innerHTML = html; $('#modal').classList.remove('hide'); const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal; }
function closeModal() { $('#modal').classList.add('hide'); }
document.addEventListener('click', (e) => { if (e.target && e.target.id === 'modalBg') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
function tavoloDetail(tb) {
  const c = ZCOL[tb.st.key];
  const tms = (x) => { const d = parseTs(x.created_at); return d ? d.getTime() : 0; };
  const comande = tb.cs.slice().sort((a, b) => tms(a) - tms(b));
  const blocks = comande.map(cm => {
    const t = parseTs(cm.created_at); const hh = t ? t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const righe = (cm.righe || []).map(r => \`<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid #f4f2ea"><span><b>\${r.qta}\xD7</b> \${esc(r.nome)} \${r.stazione === 'cucina' ? '\u{1F373}' : '\u{1F379}'}\${r.note ? \`<div class="muted" style="font-size:.75rem">\${esc(r.note)}</div>\` : ''}</span><span class="tag \${['pronta', 'consegnata'].includes(r.stato) ? 'ok' : 'mid'}">\${esc(r.stato)}</span></div>\`).join('');
    return \`<div style="margin-top:10px"><div class="muted" style="font-size:.74rem;font-weight:700">Comanda #\${cm.numero || cm.id}\${hh ? ' \xB7 ' + hh : ''}</div>\${righe}<div style="text-align:right;font-weight:800;margin-top:4px">\${eur(cm.totale)}</div></div>\`;
  }).join('') || '<p class="muted">Tavolo libero.</p>';
  const tot = comande.reduce((s, cm) => s + Number(cm.totale || 0), 0);
  const pay = tb.st.key === 'verde' ? \`<button class="btn gold block" data-tpay="\${tb.st.delivered.map(x => x.id).join(',')}" style="margin-top:12px">\u{1F4B6} Incassa \${eur(tot)}</button>\` : '';
  return \`<div class="row" style="justify-content:space-between"><h3>\u{1F37D}\uFE0F Tavolo \${tb.t}</h3><span class="tchip" style="background:\${c.bd}">\${c.lb}</span></div>\${blocks}\${pay}<button class="btn ghost block" data-mclose style="margin-top:8px">Chiudi</button>\`;
}
function cucinaDetail(g) {
  const c = ZCOL[g.st.key];
  const label = g.zona === 'bar' ? ('\u{1F378} ' + esc(g.rif)) : ('\u{1F37D}\uFE0F Tavolo ' + esc(g.rif));
  const righe = g.comande.flatMap(cm => (cm.righe || []).map(r => ({ cm, r }))).map(({ cm, r }) => \`<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f4f2ea"><span><b>\${r.qta}\xD7</b> \${esc(r.nome)}\${r.note ? \`<div class="muted" style="font-size:.75rem">\${esc(r.note)}</div>\` : ''}</span><span class="tag \${r.stato === 'in_coda' ? 'mid' : 'ok'}">\${r.stato === 'in_coda' ? 'da fare' : 'pronta'}</span></div>\`).join('');
  return \`<div class="row" style="justify-content:space-between"><h3>\${label}</h3><span class="tchip" style="background:\${c.bd}">\${c.lb}\${g.st.mins != null ? ' \xB7 ' + g.st.mins + '\u2032' : ''}</span></div><div style="margin-top:8px">\${righe}</div><button class="btn ghost block" data-mclose style="margin-top:10px">Chiudi</button>\`;
}

/* ---------- CUCINA: piatti da cucinare raggruppati per tavolo (Garden) / nome (Bar), per urgenza ---------- */
VIEWS.kds = async () => {
  const cfg = await api('/self-order/config').catch(() => ({}));
  const rMin = Number(cfg.map_rosso_min || 10);
  const render = async () => {
    const q = await api('/kds?stazione=cucina').catch(() => []);   // il bar non ha cucina: qui solo i piatti
    const groups = {};
    for (const c of q) {
      const zona = c.zona === 'bar' ? 'bar' : 'garden';
      const key = zona + '|' + (c.riferimento || '\u2014');
      (groups[key] = groups[key] || { zona, rif: c.riferimento || '\u2014', comande: [] }).comande.push(c);
    }
    const now = Date.now();
    const all = Object.values(groups).map(g => ({ ...g, st: statoGruppo(g.comande, rMin, now) }));
    const byUrg = (a, b) => (URG[a.st.key] - URG[b.st.key]) || ((a.st.since || Infinity) - (b.st.since || Infinity));
    const bar = all.filter(g => g.zona === 'bar').sort(byUrg);
    const garden = all.filter(g => g.zona === 'garden').sort(byUrg);
    // Board diviso a met\xE0: sopra il Bar (a nome), sotto i Tavoli Garden \u2014 stesso ciclo colore.
    $('#view').innerHTML = \`<div class="split">
      <section>
        <div class="shd">\u{1F378} Bar <span class="muted" style="font-weight:400;font-size:.72rem">\xB7 a nome \xB7 \${bar.length} in coda</span></div>
        <div class="board">\${bar.map(cucinaCard).join('') || '<p class="muted">Nessuna comanda bar da cucinare. \u{1F389}</p>'}</div>
      </section>
      <div class="divider"></div>
      <section>
        <div class="shd">\u{1F37D}\uFE0F Tavoli \xB7 Garden <span class="muted" style="font-weight:400;font-size:.72rem">\xB7 a tavolo \xB7 \u{1F7E8}\u2192\u{1F7E5} oltre \${rMin}\u2032 \xB7 \${garden.length} in coda</span></div>
        <div class="board">\${garden.map(cucinaCard).join('') || '<p class="muted">Nessuna comanda tavolo da cucinare. \u{1F389}</p>'}</div>
      </section>
    </div>\`;
    document.querySelectorAll('[data-kr]').forEach(b => b.onclick = async () => { const [cid, rid, st] = b.dataset.kr.split('|'); await api('/comande/' + cid + '/riga/' + rid + '/stato', { method: 'PUT', body: JSON.stringify({ stato: st }) }); render(); });
    document.querySelectorAll('[data-kdetail]').forEach(card => card.onclick = (e) => {
      if (e.target.closest('button')) return;
      const raw = card.dataset.kdetail; const i = raw.indexOf('|'); const zona = raw.slice(0, i), rif = raw.slice(i + 1);
      const g = all.find(x => x.zona === zona && String(x.rif) === rif); if (g) openModal(cucinaDetail(g));
    });
  };
  await render();
  window.__kdsTimer = setInterval(render, 8000);
};

/* ---------- BAR: comande a nome (prepara, consegna, incassa qui) ---------- */
VIEWS.bar = async () => {
  const cfg = await api('/self-order/config').catch(() => ({}));
  const rMin = Number(cfg.map_rosso_min || 10);
  const render = async () => {
    const comande = (await api('/comande').catch(() => [])).filter(c => c.zona === 'bar');
    const now = Date.now();
    const arr = comande.map(c => ({ c, st: statoGruppo([c], rMin, now) }));
    arr.sort((a, b) => (URG[a.st.key] - URG[b.st.key]) || ((a.st.since || Infinity) - (b.st.since || Infinity)));
    const card = ({ c, st }) => {
      const col = ZCOL[st.key];
      const hhmm = st.since ? new Date(st.since).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
      const righe = (c.righe || []).map(r => \`<div style="display:flex;gap:6px;font-size:.85rem;padding:2px 0"><span style="flex:1">\${r.qta}\xD7 \${esc(r.nome)} \${r.stazione === 'cucina' ? '\u{1F373}' : '\u{1F379}'}</span><span class="tag \${r.stato === 'consegnata' || r.stato === 'pronta' ? 'ok' : 'mid'}">\${esc(r.stato)}</span></div>\`).join('');
      const actions = \`\${c.stato === 'aperta' ? \`<button class="btn ghost sm" data-cs="\${c.id}|in_preparazione">\u25B6 Avvia</button>\` : ''}\${c.stato === 'in_preparazione' ? \`<button class="btn ghost sm" data-cs="\${c.id}|pronta">\u2714 Pronta</button>\` : ''}\${c.stato === 'pronta' ? \`<button class="btn ghost sm" data-cs="\${c.id}|consegnata">\u{1F6CE} Consegna</button>\` : ''}<button class="btn gold sm" data-ch="\${c.id}">\u{1F4B6} Incassa</button><button class="btn danger sm" data-can="\${c.id}">\u2715</button>\`;
      return \`<div class="panel" style="border:2px solid \${col.bd};background:\${col.bg};min-width:250px;flex:1 1 250px;max-width:340px;margin:0"><div class="row" style="justify-content:space-between"><b style="color:\${col.tx};font-size:1.05rem">\u{1F378} \${esc(c.riferimento || '\u2014')}</b>\${st.mins != null ? \`<span class="tag" style="background:\${col.bd};color:#fff">\${st.mins}\u2032</span>\` : (st.key === 'verde' ? '<span class="tag ok">\u2714</span>' : '')}</div><div style="font-size:.72rem;color:\${col.tx};font-weight:700">#\${c.numero || c.id}\${hhmm ? ' \xB7 ' + hhmm : ''}</div><div style="margin:8px 0">\${righe}</div><div style="text-align:right;font-weight:800;margin-bottom:6px">\${eur(c.totale)}</div><div class="row">\${actions}</div></div>\`;
    };
    $('#view').innerHTML = \`<div class="panel"><h3>\u{1F378} Bar \xB7 comande a nome <span class="muted" style="font-weight:400;font-size:.72rem;margin-left:8px">\xB7 auto-aggiornamento</span></h3>
      <div class="muted" style="font-size:.76rem">Ordini del bar per nome. <b style="color:#c79200">Giallo</b> in lavorazione \xB7 <b style="color:#d64535">rosso</b> oltre \${rMin}\u2032 \xB7 <b style="color:#3f8f4e">verde</b> consegnato. L'incasso si registra qui.</div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">\${arr.map(card).join('') || '<p class="muted">Nessuna comanda bar attiva.</p>'}</div>\`;
    document.querySelectorAll('[data-cs]').forEach(b => b.onclick = async () => { const [id, st] = b.dataset.cs.split('|'); await api('/comande/' + id + '/stato', { method: 'PUT', body: JSON.stringify({ stato: st }) }); render(); });
    document.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => pickMetodo(async (metodo) => { await api('/comande/' + b.dataset.ch + '/chiudi', { method: 'POST', body: JSON.stringify({ metodo }) }); render(); }));
    document.querySelectorAll('[data-can]').forEach(b => b.onclick = async () => { if (!confirm('Annullare la comanda?')) return; await api('/comande/' + b.dataset.can, { method: 'DELETE' }); render(); });
  };
  await render();
  window.__kdsTimer = setInterval(render, 8000);
};

/* ---------- MAPPA TAVOLI (Bussola Garden) ----------
   Un box per tavolo, ordinato dinamicamente per urgenza. Ciclo colore:
   arancio = libero/base \xB7 giallo = comanda acquisita \xB7 rosso = oltre soglia \xB7 verde = consegnato.
   Un nuovo ordine sul tavolo riparte da giallo; all'incasso torna arancio. */
VIEWS.tavoli = async () => {
  const cfg = await api('/self-order/config').catch(() => ({}));
  const N = Math.max(1, Number(cfg.garden_tavoli || 12));
  const rMin = Number(cfg.map_rosso_min || 10);
  const render = async () => {
    const comande = (await api('/comande').catch(() => [])).filter(c => c.zona !== 'bar');   // solo Garden
    const byTable = {};
    for (const c of comande) {
      const ref = String(c.riferimento || '').trim();
      if (!/^\\d+$/.test(ref)) continue;                       // solo riferimenti numerici = tavoli Garden
      const t = Number(ref); (byTable[t] = byTable[t] || []).push(c);
    }
    const now = Date.now();
    const tables = [];
    for (let t = 1; t <= N; t++) { const cs = byTable[t] || []; tables.push({ t, cs, st: statoGruppo(cs, rMin, now) }); }
    const rank = { rosso: 0, giallo: 1, verde: 2, arancio: 3 };
    tables.sort((a, b) => (rank[a.st.key] - rank[b.st.key]) || ((a.st.since || Infinity) - (b.st.since || Infinity)) || (a.t - b.t));
    $('#view').innerHTML = \`<div class="panel" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><h3 style="margin:0">\u{1F5FA}\uFE0F Mappa tavoli \xB7 Bussola Garden <span class="muted" style="font-weight:400;font-size:.72rem;margin-left:6px">\xB7 \${N} tavoli \xB7 auto-aggiornamento</span></h3>
      <div class="muted" style="font-size:.74rem">\u{1F7E7} libero \xB7 \u{1F7E8} acquisita \xB7 \u{1F7E5} oltre \${rMin}\u2032 \xB7 \u{1F7E9} consegnato</div></div></div>
      <div class="board">\${tables.map(tavoloCard).join('')}</div>\`;
    const bindPay = (root) => root.querySelectorAll('[data-tpay]').forEach(b => b.onclick = () => pickMetodo(async (metodo) => {
      for (const id of String(b.dataset.tpay).split(',').filter(Boolean)) await api('/comande/' + id + '/chiudi', { method: 'POST', body: JSON.stringify({ metodo }) });
      closeModal(); render();
    }));
    bindPay(document);
    document.querySelectorAll('[data-tdetail]').forEach(card => card.onclick = (e) => {
      if (e.target.closest('button')) return;
      const tb = tables.find(x => x.t === Number(card.dataset.tdetail)); if (!tb) return;
      openModal(tavoloDetail(tb)); bindPay($('#mbox'));
    });
  };
  await render();
  window.__kdsTimer = setInterval(render, 8000);
};

/* ---------- MAGAZZINO ---------- */
const MAG_AREE = [['chiosco', 'Chiosco'], ['casa_di_carta', 'Casa di Carta'], ['serata_clan', 'Serata Clan'], ['serate_tema', 'Serate a tema']];
const magAreaLabel = (a) => (MAG_AREE.find(x => x[0] === a) || [a, a])[1];
const magBadge = (s) => s === 'da_riordinare' ? '<span class="tag no">Da riordinare</span>' : s === 'in_esaurimento' ? '<span class="tag mid">In esaurimento</span>' : '<span class="tag ok">OK</span>';
const magZonaBadge = (z) => z === 'bar' ? '<span class="tag" style="background:#e7f0f6;color:#12324F">\u{1F378} Bar</span>' : z === 'garden' ? '<span class="tag" style="background:#eaf5ec;color:#2e6b3f">\u{1F33F} Garden</span>' : '<span class="tag" style="background:#efe9dc;color:#6b5a2f">\u{1F501} Comune</span>';
// ===== MAGAZZINO A DUE LIVELLI (v4.48): hub Centrale / Bar / Garden =====
let MAG_SUB = 'centrale';
const MAG_SUB_LABEL = { centrale: '\u{1F3EC} Centrale', previsione: '\u{1F52E} Previsione', calendario: '\u{1F4C5} Calendario', quadratura: '\u{1F4CA} Quadratura', bar: '\u{1F378} Bar', garden: '\u{1F33F} Garden' };
const magSubbar = () => \`<div class="panel"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
  <b style="color:var(--navy)">\u{1F4E6} Magazzino <span class="muted" style="font-weight:400;font-size:.72rem">\xB7 merce unica al Centrale</span></b>
  <div class="row">\${['centrale', 'previsione', 'calendario', 'quadratura', 'bar', 'garden'].map(k => \`<button class="btn \${MAG_SUB === k ? 'gold' : 'ghost'} sm" data-msub="\${k}">\${MAG_SUB_LABEL[k]}</button>\`).join('')}</div></div></div>\`;
VIEWS.magazzino = async () => {
  if (MAG_SUB === 'centrale') await magCentrale();
  else if (MAG_SUB === 'previsione') await magPrevisione();
  else if (MAG_SUB === 'calendario') await magCalendario();
  else if (MAG_SUB === 'quadratura') await magQuadratura();
  else await magHubZona(MAG_SUB);
  document.querySelectorAll('[data-msub]').forEach(b => b.onclick = () => { MAG_SUB = b.dataset.msub; show('magazzino'); });
};
// ---- Sub-tab QUADRATURA (Fase 4): report mensile flussi + consumi per zona + riconciliazione ----
let MAG_MESE = '';
async function magQuadratura() {
  const q = MAG_MESE ? '?mese=' + MAG_MESE : '';
  const data = await api('/magazzino/quadratura' + q).catch(() => ({ mese: '', articoli: [], totali: {}, mesi: [], chiusa: false }));
  MAG_MESE = data.mese || MAG_MESE;
  const t = data.totali || {};
  const scEl = (v) => v == null ? '<span class="muted">\u2014</span>' : (v === 0 ? '<span class="tag ok">0</span>' : \`<span class="tag no">\${esc(String(v > 0 ? '+' + v : v))}</span>\`);
  const rows = (data.articoli || []).map(a => \`<tr>
    <td><b>\${esc(a.nome)}</b> \${magZonaBadge(a.zona)}</td>
    <td style="text-align:center">\${a.giacenza_iniziale == null ? '\u2014' : esc(String(a.giacenza_iniziale))}</td>
    <td style="text-align:center;color:\${a.carico ? 'var(--teal)' : 'var(--muted)'}">\${esc(String(a.carico))}</td>
    <td style="text-align:center;color:\${a.scarico ? 'var(--coral)' : 'var(--muted)'}">\${esc(String(a.scarico))}</td>
    <td style="text-align:center" class="muted">\${esc(String(a.scarico_bar))} / \${esc(String(a.scarico_garden))}</td>
    <td style="text-align:center"><b>\${esc(String(a.giacenza_finale))}</b></td>
    <td style="text-align:center">\${a.atteso == null ? '\u2014' : esc(String(a.atteso))}</td>
    <td style="text-align:center">\${scEl(a.scostamento)}</td>
  </tr>\`).join('');
  const mesiOpts = (data.mesi || [data.mese]).map(m => \`<option value="\${m}" \${m === data.mese ? 'selected' : ''}>\${esc(m)}</option>\`).join('');
  $('#view').innerHTML = magSubbar() + \`<div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">\u{1F4CA} Quadratura mensile \${data.chiusa ? '<span class="tag ok">chiusa</span>' : '<span class="tag mid">in corso</span>'}</h3>
      <div class="row"><label class="muted" style="font-size:.8rem">Mese</label><select id="mag_mese">\${mesiOpts}</select><button class="btn ghost sm" id="mag_chiudi">\u{1F512} Chiudi mese</button></div></div>
    <p class="muted" style="font-size:.78rem;margin-top:6px">Flussi del mese per articolo e <b>consumi per zona</b> (bar/garden). <b>Atteso</b> = iniziale + carichi \u2212 scarichi; lo <b>scostamento</b> vs la giacenza reale evidenzia rettifiche/cali/anomalie (0 = quadra). L'iniziale c'\xE8 dal mese successivo alla prima chiusura. A fine mese la chiusura \xE8 automatica; puoi anche chiudere qui.</p>
    <div class="row" style="gap:10px;margin-top:8px">
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Carichi</div><div style="font-size:1.3rem;font-weight:800;color:var(--teal)">\${t.carico || 0}</div></div>
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Consumo \u{1F378} Bar</div><div style="font-size:1.3rem;font-weight:800;color:var(--navy)">\${t.scarico_bar || 0}</div></div>
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Consumo \u{1F33F} Garden</div><div style="font-size:1.3rem;font-weight:800;color:var(--navy)">\${t.scarico_garden || 0}</div></div>
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Scostamenti</div><div style="font-size:1.3rem;font-weight:800;color:\${t.scostamenti ? 'var(--coral)' : 'var(--navy)'}">\${t.scostamenti || 0}</div></div></div></div>
    <div class="panel"><table><thead><tr><th>Articolo</th><th>Iniz.</th><th>Carico</th><th>Scarico</th><th>bar/garden</th><th>Finale</th><th>Atteso</th><th>Scost.</th></tr></thead><tbody>\${rows || '<tr><td colspan="8" class="muted">Nessun movimento nel mese.</td></tr>'}</tbody></table></div>\`;
  $('#mag_mese').onchange = (e) => { MAG_MESE = e.target.value; show('magazzino'); };
  $('#mag_chiudi').onclick = async () => { if (!confirm('Chiudere il mese ' + data.mese + '? Registra la giacenza attuale come giacenza di fine mese (base per la riconciliazione del mese successivo).')) return; await api('/magazzino/quadratura/chiudi', { method: 'POST', body: JSON.stringify({ mese: data.mese }) }); show('magazzino'); };
}
// Helper: formatta una data ISO (YYYY-MM-DD) in gg/mm + etichetta relativa (oggi/domani/in ritardo).
function magDataLabel(iso, oggi) {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-'); const dd = d + '/' + m;
  if (oggi) { if (iso < oggi) return dd + ' <span class="tag no">in ritardo</span>'; if (iso === oggi) return dd + ' <span class="tag mid">oggi</span>'; }
  return dd;
}
// ---- Sub-tab CALENDARIO (Fase 3): agenda "da inviare" (previsione) + "consegne attese" (ordini) per data ----
async function magCalendario() {
  const prev = await api('/magazzino/previsione').catch(() => ({ articoli: [], oggi: '', lead_time_giorni: 0 }));
  const ordini = await api('/magazzino/ordini?stato=confermato').catch(() => []);
  const oggi = prev.oggi || new Date().toISOString().slice(0, 10);
  const LEAD = prev.lead_time_giorni || 0;
  // Da inviare: articoli con suggerimento > 0, raggruppati per data d'invio consigliata.
  const daInv = (prev.articoli || []).filter(a => a.suggerito > 0 && a.data_invio_consigliata);
  daInv.sort((a, b) => String(a.data_invio_consigliata).localeCompare(String(b.data_invio_consigliata)));
  const gInv = {}; daInv.forEach(a => { (gInv[a.data_invio_consigliata] = gInv[a.data_invio_consigliata] || []).push(a); });
  const invHtml = Object.keys(gInv).sort().map(dt => \`<div style="margin-bottom:8px"><div style="font-weight:800;color:\${dt <= oggi ? 'var(--coral)' : 'var(--navy)'};font-size:.85rem;margin-bottom:3px">\${magDataLabel(dt, oggi)}</div>\${gInv[dt].map(a => \`<div class="row" style="justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f0efe8"><span>\${magZonaBadge(a.zona)} <b>\${esc(a.nome)}</b> \xB7 ordina <b>\${esc(String(a.suggerito))}</b> \${esc(a.unita)}\${a.in_arrivo ? \` <span class="muted">(\${esc(String(a.in_arrivo))} gi\xE0 in arrivo)</span>\` : ''}</span><div class="row"><input id="cq_\${a.articolo_id}" type="number" value="\${a.suggerito}" style="width:64px"><button class="btn gold sm" data-cord="\${a.articolo_id}">\u2714 Ordina</button></div></div>\`).join('')}</div>\`).join('') || '<p class="muted">Niente da inviare nei prossimi giorni.</p>';
  // Consegne attese: ordini confermati raggruppati per data prevista.
  const gCon = {}; (ordini || []).forEach(o => { const k = o.data_prevista || '\u2014'; (gCon[k] = gCon[k] || []).push(o); });
  const conHtml = Object.keys(gCon).sort().map(dt => \`<div style="margin-bottom:8px"><div style="font-weight:800;color:\${dt !== '\u2014' && dt <= oggi ? 'var(--coral)' : 'var(--navy)'};font-size:.85rem;margin-bottom:3px">\${dt === '\u2014' ? 'senza data' : magDataLabel(dt, oggi)}</div>\${gCon[dt].map(o => \`<div class="row" style="justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f0efe8"><span>\u{1F69A} <b>\${esc(o.nome)}</b> \xB7 \${esc(String(o.quantita))} \${esc(o.unita)}</span><div class="row"><button class="btn gold sm" data-cric="\${o.id}">\u{1F4E5} Ricevi</button><button class="btn ghost sm" data-cann="\${o.id}">Annulla</button></div></div>\`).join('')}</div>\`).join('') || '<p class="muted">Nessuna consegna in programma.</p>';
  $('#view').innerHTML = magSubbar() + \`<div class="panel"><h3>\u{1F4C5} Calendario ordini <span class="muted" style="font-weight:400;font-size:.72rem">\xB7 lead time fornitore \${LEAD} gg</span></h3>
    <p class="muted" style="font-size:.78rem">Per far arrivare la merce in tempo, ogni proposta ha una <b>data d'invio consigliata</b> = data di riordino \u2212 lead time. Le voci in rosso sono da inviare <b>subito</b>. Le consegne attese sono gli ordini gi\xE0 inviati, in arrivo alla data prevista.</p>
    <div class="row" style="margin-top:8px;gap:8px;align-items:center"><label class="muted" style="font-size:.8rem">Lead time fornitore (giorni)</label><input id="mag_lead" type="number" value="\${LEAD}" style="width:80px"><button class="btn ghost sm" id="mag_lead_save">Salva</button></div></div>
    <div class="panel"><h3>\u{1F4E4} Da inviare</h3>\${invHtml}</div>
    <div class="panel"><h3>\u{1F4E5} Consegne attese</h3>\${conHtml}</div>\`;
  $('#mag_lead_save').onclick = async () => { await api('/magazzino/config', { method: 'POST', body: JSON.stringify({ lead_time_giorni: Number($('#mag_lead').value) || 0 }) }); show('magazzino'); };
  document.querySelectorAll('[data-cord]').forEach(b => b.onclick = async () => { const id = b.dataset.cord; const q = Number(($('#cq_' + id) || {}).value); if (!q) { alert('Indica la quantit\xE0.'); return; } await api('/magazzino/ordini', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), quantita: q }) }); show('magazzino'); });
  document.querySelectorAll('[data-cric]').forEach(b => b.onclick = async () => { await api('/magazzino/ordini/' + b.dataset.cric + '/ricevi', { method: 'POST', body: '{}' }); show('magazzino'); });
  document.querySelectorAll('[data-cann]').forEach(b => b.onclick = async () => { await api('/magazzino/ordini/' + b.dataset.cann + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
}
// ---- Sub-tab PREVISIONE (Fase 2): ritmo di consumo \u2192 data-riordino stimata + proposta d'ordine al fornitore ----
async function magPrevisione() {
  const data = await api('/magazzino/previsione').catch(() => ({ finestra_giorni: 14, articoli: [] }));
  const ordini = await api('/magazzino/ordini?stato=confermato').catch(() => []);
  const N = data.finestra_giorni || 14;
  const arts = data.articoli || [];
  const conStorico = arts.filter(a => !a.senza_storico);
  const rows = conStorico.map(a => {
    // \u{1F534} solo se c'\xE8 davvero da ordinare (urgente E suggerito > 0); \u{1F7E1} attenzione se urgente ma gi\xE0 coperto o in avvicinamento; \u{1F7E2} ok.
    const badge = (a.urgente && a.suggerito > 0) ? '<span class="tag no">\u{1F534} riordina</span>'
      : (a.urgente || (a.giorni_residui != null && a.giorni_residui <= N * 2)) ? '<span class="tag mid">\u{1F7E1} attenzione</span>'
      : '<span class="tag ok">\u{1F7E2} ok</span>';
    return \`<tr>
      <td><b>\${esc(a.nome)}</b> \${magZonaBadge(a.zona)}</td>
      <td style="text-align:center">\${esc(String(a.rate))}<span class="muted" style="font-size:.7rem">/gg</span></td>
      <td style="text-align:center"><b>\${esc(String(a.giacenza_effettiva))}</b></td>
      <td style="text-align:center;color:\${a.in_arrivo ? 'var(--teal)' : 'var(--muted)'}">\${esc(String(a.in_arrivo || 0))}</td>
      <td style="text-align:center">\${a.giorni_residui != null ? esc(String(a.giorni_residui)) + ' gg' : '\u2014'}</td>
      <td style="text-align:center">\${a.data_riordino ? esc(a.data_riordino) : '\u2014'}</td>
      <td style="text-align:center">\${badge}</td>
      <td class="row"><input id="oq_\${a.articolo_id}" type="number" value="\${a.suggerito || ''}" placeholder="q.t\xE0" style="width:70px"><button class="btn gold sm" data-ord="\${a.articolo_id}">\u2714 Ordina</button></td>
    </tr>\`;
  }).join('');
  const senza = arts.filter(a => a.senza_storico).length;
  const ordPanel = \`<div class="panel"><h3>\u{1F69A} Ordini al fornitore in corso</h3>\${ordini.length ? ordini.map(o => \`<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span><b>\${esc(o.nome)}</b> \xB7 \${esc(String(o.quantita))} \${esc(o.unita)}\${o.data_prevista ? \` \xB7 <span class="muted">arrivo ~\${esc(o.data_prevista)}</span>\` : ''}</span><div class="row"><button class="btn gold sm" data-oric="\${o.id}">\u{1F4E5} Ricevi</button><button class="btn ghost sm" data-oann="\${o.id}">Annulla</button></div></div>\`).join('') : '<p class="muted">Nessun ordine in corso.</p>'}</div>\`;
  $('#view').innerHTML = magSubbar() + \`<div class="panel"><h3>\u{1F52E} Previsione riordino <span class="muted" style="font-weight:400;font-size:.72rem">\xB7 finestra \${N} giorni</span></h3>
    <p class="muted" style="font-size:.78rem">Dal ritmo di consumo degli ultimi <b>\${N} giorni</b> stimo quando la giacenza effettiva raggiunge il punto di riordino e propongo una quantit\xE0 da ordinare al fornitore (gi\xE0 al netto di ci\xF2 che \xE8 in arrivo). <b>Valida</b> l'ordine con "Ordina": la merce risulter\xE0 <b>in arrivo</b> finch\xE9 non la ricevi (che equivale a un carico del Centrale).</p>
    <div class="row" style="margin-top:8px;gap:8px;align-items:center"><label class="muted" style="font-size:.8rem">Finestra (giorni)</label><input id="mag_fin" type="number" value="\${N}" style="width:80px"><button class="btn ghost sm" id="mag_fin_save">Salva</button></div></div>
    <div class="panel"><table><thead><tr><th>Articolo</th><th>Ritmo</th><th>Disp.eff</th><th>In arrivo</th><th>Residui</th><th>Data riordino</th><th></th><th>Ordine fornitore</th></tr></thead><tbody>\${rows || '<tr><td colspan="8" class="muted">Nessun articolo con storico di consumo. Registra qualche scarico per attivare la previsione.</td></tr>'}</tbody></table>
    \${senza ? \`<p class="muted" style="font-size:.74rem;margin-top:8px">\${senza} articoli senza consumi nella finestra non compaiono (nessun ritmo da stimare).</p>\` : ''}</div>\` + ordPanel;
  $('#mag_fin_save').onclick = async () => { await api('/magazzino/config', { method: 'POST', body: JSON.stringify({ finestra_giorni: Number($('#mag_fin').value) || 14 }) }); show('magazzino'); };
  document.querySelectorAll('[data-ord]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ord; const q = Number(($('#oq_' + id) || {}).value);
    if (!q) { alert('Indica la quantit\xE0 da ordinare.'); return; }
    const a = conStorico.find(x => String(x.articolo_id) === String(id));
    await api('/magazzino/ordini', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), quantita: q, data_prevista: a ? a.data_riordino : null }) });
    show('magazzino');
  });
  document.querySelectorAll('[data-oric]').forEach(b => b.onclick = async () => { await api('/magazzino/ordini/' + b.dataset.oric + '/ricevi', { method: 'POST', body: '{}' }); show('magazzino'); });
  document.querySelectorAll('[data-oann]').forEach(b => b.onclick = async () => { await api('/magazzino/ordini/' + b.dataset.oann + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
}
// ---- Sub-tab CENTRALE: giacenza del centro + import master + richieste da evadere ----
async function magCentrale() {
  const data = await api('/magazzino').catch(() => ({ articoli: [], riepilogo: {}, aree: [] }));
  const impegni = await api('/magazzino/richieste?stato=impegnata').catch(() => []);
  const r = data.riepilogo || {};
  const alert = \`<div class="panel"><div class="row" style="gap:10px">
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Da riordinare</div><div style="font-size:1.5rem;font-weight:800;color:\${r.da_riordinare ? 'var(--coral)' : 'var(--navy)'}">\${r.da_riordinare || 0}</div></div>
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">In esaurimento</div><div style="font-size:1.5rem;font-weight:800;color:\${r.in_esaurimento ? 'var(--gold)' : 'var(--navy)'}">\${r.in_esaurimento || 0}</div></div>
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Articoli</div><div style="font-size:1.5rem;font-weight:800;color:var(--navy)">\${r.totale || 0}</div></div>
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Impegni attivi</div><div style="font-size:1.5rem;font-weight:800;color:\${impegni.length ? 'var(--gold)' : 'var(--navy)'}">\${impegni.length}</div></div></div>
    <p class="muted" style="font-size:.76rem;margin-top:8px">La merce \xE8 <b>unica</b> e sta qui al Centrale. La <b>zona</b> di un articolo \xE8 solo un'abilitazione (chi pu\xF2 usarlo). Bar e Garden non hanno scorta propria: vedono la disponibilit\xE0 in sola lettura, scaricano i consumi (che scendono da qui) e possono <b>impegnare</b> merce. <b>Giac.</b> = fisica \xB7 <b>Imp.</b> = impegnata \xB7 <b>Eff.</b> = effettiva (Giac. \u2212 Imp.), il numero che fa scattare il riordino.</p></div>\`;
  const ricPanel = \`<div class="panel"><h3>\u{1F4CC} Impegni in corso <span class="muted" style="font-weight:400;font-size:.72rem">(merce prenotata dalle zone, non ancora consumata)</span></h3>\${impegni.length ? impegni.map(x => \`<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span>\${x.zona === 'bar' ? '\u{1F378}' : '\u{1F33F}'} <b>\${esc(x.nome)}</b> \xB7 \${esc(String(x.quantita))} \${esc(x.unita)} impegnati per \${esc(x.zona)}</span><button class="btn ghost sm" data-evno="\${x.id}">Rilascia</button></div>\`).join('') : '<p class="muted">Nessun impegno attivo.</p>'}</div>\`;
  const areeOrdine = [...new Set([...MAG_AREE.map(a => a[0]), ...(data.aree || [])])];
  const perArea = areeOrdine.map(area => {
    const arts = (data.articoli || []).filter(a => a.area === area); if (!arts.length) return '';
    const rows = arts.map(a => \`<tr>
      <td><b>\${esc(a.nome)}</b></td><td>\${magZonaBadge(a.zona)}</td><td>\${esc(a.unita)}</td><td style="text-align:center"><b>\${esc(String(a.giacenza))}</b></td><td style="text-align:center;color:\${a.impegno ? 'var(--gold)' : 'var(--muted)'}">\${esc(String(a.impegno || 0))}</td><td style="text-align:center"><b>\${esc(String(a.giacenza_effettiva))}</b></td><td>\${magBadge(a.stato)}</td>
      <td class="row"><input id="mq_\${a.id}" type="number" placeholder="q.t\xE0" style="width:64px"><button class="btn gold sm" data-mv="\${a.id}|carico">+ Carico</button><button class="btn ghost sm" data-mv="\${a.id}|scarico">\u2212 Scarico</button><button class="btn ghost sm" data-mv="\${a.id}|rettifica">= Rettifica</button></td>
    </tr>\`).join('');
    return \`<div class="panel"><h3>\${esc(magAreaLabel(area))}</h3><table><thead><tr><th>Articolo</th><th>Zona</th><th>Unit\xE0</th><th>Giac.</th><th>Imp.</th><th>Eff.</th><th>Stato</th><th>Movimento</th></tr></thead><tbody>\${rows}</tbody></table></div>\`;
  }).join('');
  const areaOpts = MAG_AREE.map(a => \`<option value="\${a[0]}">\${esc(a[1])}</option>\`).join('');
  const imp = \`<div class="panel"><h3>\u2B06\uFE0F Caricamento magazzino (master) da Excel/CSV</h3>
    <p class="muted" style="font-size:.82rem;margin-bottom:8px">Un solo file alimenta il Centrale. Colonne (in qualsiasi ordine): <b>nome</b>, <b>area</b>, <b>zona</b> (<b>bar</b>/<b>garden</b>/<b>comune</b>), <b>unita</b>, <b>giacenza</b>, <b>riordino</b>, <b>preavviso</b>. La zona rende l'articolo disponibile ai sotto-magazzini Bar/Garden (comune = entrambi).</p>
    <div class="row"><input type="file" id="mimp_file" accept=".xlsx,.xls,.csv"><button class="btn ghost sm" id="mimp_tpl">\u2193 Scarica modello CSV</button><button class="btn ghost sm" id="mimp_exp">\u2B07\uFE0F Esporta magazzino (Excel)</button></div>
    <p class="muted" style="font-size:.78rem;margin-top:6px">Esporta lo stato attuale in un Excel nello stesso formato: lo modifichi (anche la colonna <b>zona</b>) e lo ricarichi qui.</p>
    <div id="mimp_prev" style="margin-top:10px"></div></div>\`;
  const nuovo = \`<div class="panel"><h3>+ Nuovo articolo</h3><div class="row">
    <input id="ma_n" placeholder="Nome" style="min-width:160px"><select id="ma_a">\${areaOpts}</select>
    <select id="ma_z"><option value="comune">\u{1F501} Comune</option><option value="bar">\u{1F378} Bar</option><option value="garden">\u{1F33F} Garden</option></select>
    <input id="ma_u" value="pz" style="width:70px"><input id="ma_g" type="number" placeholder="Giac." style="width:90px"><input id="ma_pr" type="number" placeholder="Riordino" style="width:100px"><input id="ma_pa" type="number" placeholder="Preavviso" style="width:100px">
    <button class="btn gold sm" id="ma_add">+ Aggiungi</button></div></div>\`;
  $('#view').innerHTML = magSubbar() + alert + ricPanel + imp + (perArea || '<div class="panel"><p class="muted">Nessun articolo.</p></div>') + nuovo;
  document.querySelectorAll('[data-evno]').forEach(b => b.onclick = async () => { await api('/magazzino/richieste/' + b.dataset.evno + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
  $('#mimp_tpl').onclick = () => {
    const csv = 'nome,area,zona,unita,giacenza,riordino,preavviso\\nBicchieri di carta,chiosco,comune,pz,300,100,150\\nBirra media,chiosco,bar,pz,60,24,40\\nSalsiccia,chiosco,garden,kg,10,3,5\\nCapsule caff\xE8,casa di carta,comune,capsule,120,50,80\\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'modello_magazzino.csv'; a.click();
  };
  $('#mimp_exp').onclick = () => esporta('/magazzino/export');
  const magToB64 = (f) => new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).replace(/^data:[^,]*,/, '')); rd.onerror = rej; rd.readAsDataURL(f); });
  $('#mimp_file').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    $('#mimp_prev').innerHTML = '<p class="muted">Leggo il file\u2026</p>';
    try {
      const b64 = await magToB64(f);
      const dry = await api('/magazzino/import', { method: 'POST', body: JSON.stringify({ fileB64: b64, dryRun: true }) });
      const preview = (dry.anteprima || []).map(x => \`<tr><td>\${esc(x.nome)}</td><td>\${esc(x.area)}</td><td>\${esc(x.zona)}</td><td>\${esc(x.unita)}</td><td>\${esc(String(x.giacenza))}</td><td>\${esc(String(x.punto_riordino))}</td><td>\${esc(String(x.soglia_preavviso))}</td></tr>\`).join('');
      $('#mimp_prev').innerHTML = \`<p class="muted" style="font-size:.82rem">Trovate <b>\${dry.totale}</b> righe. Anteprima:</p>
        <table><thead><tr><th>Nome</th><th>Area</th><th>Zona</th><th>Unit\xE0</th><th>Giac.</th><th>Riordino</th><th>Preavviso</th></tr></thead><tbody>\${preview}</tbody></table>
        <div class="row" style="margin-top:8px"><label><input type="checkbox" id="mimp_repl"> sostituisci l'intero magazzino</label><button class="btn gold" id="mimp_go">Importa \${dry.totale} righe</button></div>\`;
      $('#mimp_go').onclick = async () => { const res = await api('/magazzino/import', { method: 'POST', body: JSON.stringify({ fileB64: b64, mode: $('#mimp_repl').checked ? 'replace' : 'merge' }) }); alert(\`Import completato: \${res.creati} creati, \${res.aggiornati} aggiornati.\`); show('magazzino'); };
    } catch (err) { $('#mimp_prev').innerHTML = \`<p class="muted">\${esc(err.message)}</p>\`; }
  };
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = async () => { const [id, tipo] = b.dataset.mv.split('|'); const q = Number(($('#mq_' + id) || {}).value); if (!($('#mq_' + id).value)) { alert('Indica la quantit\xE0.'); return; } await api('/magazzino/' + id + '/movimento', { method: 'POST', body: JSON.stringify({ tipo, quantita: q }) }); show('magazzino'); });
  $('#ma_add').onclick = async () => { if (!$('#ma_n').value) { alert('Nome?'); return; } await api('/magazzino', { method: 'POST', body: JSON.stringify({ nome: $('#ma_n').value, area: $('#ma_a').value, zona: $('#ma_z').value, unita: $('#ma_u').value || 'pz', giacenza: Number($('#ma_g').value || 0), punto_riordino: Number($('#ma_pr').value || 0), soglia_preavviso: Number($('#ma_pa').value || 0) }) }); show('magazzino'); };
}
// ---- Sub-tab BAR/GARDEN nel hub: sola lettura delle giacenze di zona + richieste (con Evadi) ----
async function magHubZona(zona) {
  const data = await api('/magazzino/zona/' + zona).catch(() => ({ articoli: [], riepilogo: {} }));
  const impegni = await api('/magazzino/richieste?zona=' + zona + '&stato=impegnata').catch(() => []);
  const arts = (data.articoli || []).slice().sort((a, b) => (a.stato === 'da_riordinare' ? -1 : 0));
  const rows = arts.map(a => \`<tr><td><b>\${esc(a.nome)}</b></td><td>\${esc(a.unita)}</td><td style="text-align:center"><b>\${esc(String(a.giacenza))}</b></td><td style="text-align:center;color:\${a.impegno_zona ? 'var(--gold)' : 'var(--muted)'}">\${esc(String(a.impegno_zona || 0))}</td><td>\${magBadge(a.stato)}</td></tr>\`).join('');
  $('#view').innerHTML = magSubbar() + \`<div class="panel"><h3>\${zona === 'bar' ? '\u{1F378} Bar' : '\u{1F33F} Garden'} \xB7 disponibilit\xE0 <span class="muted" style="font-weight:400;font-size:.72rem">(sola lettura dal Centrale \xB7 merce unica)</span></h3>
    <p class="muted" style="font-size:.74rem"><b>Disp.</b> = giacenza effettiva del Centrale (fisica \u2212 impegni) per gli articoli abilitati a questa zona. <b>Imp.</b> = quanto ha impegnato questa zona.</p>
    <table><thead><tr><th>Articolo</th><th>Unit\xE0</th><th>Disp.</th><th>Imp.</th><th>Stato</th></tr></thead><tbody>\${rows || '<tr><td colspan="5" class="muted">Nessun articolo.</td></tr>'}</tbody></table></div>
    <div class="panel"><h3>\u{1F4CC} Impegni di questa zona</h3>\${impegni.length ? impegni.map(x => \`<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span><b>\${esc(x.nome)}</b> \xB7 \${esc(String(x.quantita))} \${esc(x.unita)}</span><button class="btn ghost sm" data-evno="\${x.id}">Rilascia</button></div>\`).join('') : '<p class="muted">Nessun impegno attivo.</p>'}</div>\`;
  document.querySelectorAll('[data-evno]').forEach(b => b.onclick = async () => { await api('/magazzino/richieste/' + b.dataset.evno + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
}

/* ---------- GIACENZE DI ZONA (Bar/Garden): sotto-magazzino operativo \u2014 scarico + richiesta di carico ---------- */
VIEWS.scorte = async () => {
  const zona = ZONA, zonaLabel = zona === 'bar' ? '\u{1F378} Bar' : '\u{1F33F} Garden';
  const render = async () => {
    const data = await api('/magazzino/zona/' + zona).catch(() => ({ articoli: [], riepilogo: {} }));
    const impegni = await api('/magazzino/richieste?zona=' + zona + '&stato=impegnata').catch(() => []);
    const r = data.riepilogo || {}; const arts = data.articoli || [];
    const rank = { da_riordinare: 0, in_esaurimento: 1, ok: 2 };
    arts.sort((a, b) => (rank[a.stato] - rank[b.stato]) || String(a.nome).localeCompare(String(b.nome)));
    const rows = arts.map(a => \`<tr>
      <td><b>\${esc(a.nome)}</b></td><td>\${esc(a.unita)}</td><td style="text-align:center"><b>\${esc(String(a.giacenza))}</b></td>
      <td style="text-align:center;color:\${a.impegno_zona ? 'var(--gold)' : 'var(--muted)'}">\${esc(String(a.impegno_zona || 0))}</td>
      <td>\${magBadge(a.stato)}</td>
      <td class="row"><input id="gq_\${a.articolo_id}" type="number" placeholder="q.t\xE0" style="width:64px"><button class="btn ghost sm" data-gsc="\${a.articolo_id}">\u2212 Scarico</button><button class="btn gold sm" data-grc="\${a.articolo_id}">\u{1F4CC} Impegna</button></td>
    </tr>\`).join('');
    const ric = impegni.map(x => \`<div class="row" style="justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f0efe8"><span><b>\${esc(x.nome)}</b> \xB7 \${esc(String(x.quantita))} \${esc(x.unita)} impegnati</span><button class="btn ghost sm" data-gann="\${x.id}">Rilascia</button></div>\`).join('');
    $('#view').innerHTML = \`<div class="panel"><h3>\u{1F4CA} Giacenze \xB7 \${zonaLabel} <span class="muted" style="font-weight:400;font-size:.72rem;margin-left:6px">\xB7 merce unica al Centrale, qui in sola lettura</span></h3>
      <p class="muted" style="font-size:.76rem">La merce \xE8 una sola, al Centrale. <b>Disp.</b> = giacenza effettiva (fisica \u2212 impegni). A fine servizio <b>scarica</b> le quantit\xE0 usate: scendono dal Centrale. Puoi <b>impegnare</b> merce per il tuo servizio: la prenoti senza spostarla (riduce la disponibilit\xE0 per l'altra zona). Lo scarico libera l'impegno corrispondente.</p>
      <div class="row" style="gap:10px;margin-top:6px">
        <div style="flex:1;min-width:110px"><div class="muted" style="font-size:.72rem">Da riordinare</div><div style="font-size:1.4rem;font-weight:800;color:\${r.da_riordinare ? 'var(--coral)' : 'var(--navy)'}">\${r.da_riordinare || 0}</div></div>
        <div style="flex:1;min-width:110px"><div class="muted" style="font-size:.72rem">In esaurimento</div><div style="font-size:1.4rem;font-weight:800;color:\${r.in_esaurimento ? 'var(--gold)' : 'var(--navy)'}">\${r.in_esaurimento || 0}</div></div>
        <div style="flex:1;min-width:110px"><div class="muted" style="font-size:.72rem">Articoli</div><div style="font-size:1.4rem;font-weight:800;color:var(--navy)">\${r.totale || 0}</div></div></div></div>
      <div class="panel"><table><thead><tr><th>Articolo</th><th>Unit\xE0</th><th>Disp.</th><th>Imp.</th><th>Stato</th><th>Scarico / Impegna</th></tr></thead><tbody>\${rows || '<tr><td colspan="6" class="muted">Nessun articolo per questa zona.</td></tr>'}</tbody></table></div>
      \${impegni.length ? \`<div class="panel"><h3>\u{1F4CC} Impegni in corso</h3>\${ric}</div>\` : ''}\`;
    const q = (id) => Number(($('#gq_' + id) || {}).value);
    document.querySelectorAll('[data-gsc]').forEach(b => b.onclick = async () => { const id = b.dataset.gsc; if (!q(id)) { alert('Indica la quantit\xE0.'); return; } await api('/magazzino/zona/' + zona + '/scarico', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), quantita: q(id) }) }); render(); });
    document.querySelectorAll('[data-grc]').forEach(b => b.onclick = async () => { const id = b.dataset.grc; if (!q(id)) { alert('Indica la quantit\xE0 da impegnare.'); return; } await api('/magazzino/richieste', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), zona, quantita: q(id) }) }); render(); });
    document.querySelectorAll('[data-gann]').forEach(b => b.onclick = async () => { await api('/magazzino/richieste/' + b.dataset.gann + '/annulla', { method: 'POST', body: '{}' }); render(); });
  };
  await render();
};

/* ---------- MEN\xD9 (config + import Excel/CSV) ---------- */
let IMPORT_B64 = null;
// Men\xF9 stampabile (PDF via "Salva come PDF" del browser) con logo, punto vendita, categorie, composizione, allergeni.
function stampaMenuPDF(menu, punto, qr, zona) {
  const attivi = (menu || []).filter(m => m.attivo);
  // Stesso raggruppamento e ordine della comanda: un solo vettore, niente "scalini" tra PDF e ordini.
  const catOf = (window.Comanda && Comanda.catOf) ? Comanda.catOf : (m => m.categoria || (m.stazione === 'cucina' ? 'Cucina' : 'Bar'));
  const sortCats = (window.Comanda && Comanda.sortCats) ? Comanda.sortCats : (a => a.slice());
  const gruppi = {};
  attivi.forEach(m => { const k = catOf(m); (gruppi[k] = gruppi[k] || []).push(m); });
  const cats = sortCats(Object.keys(gruppi));
  // (11) Ordine per punto di stampa: stazione della zona di stampa prima, poi la complementare.
  //      Bar = prodotti "bar" (bevande) \xB7 Garden = prodotti "cucina" (cibo). Ogni categoria eredita
  //      la stazione prevalente dei suoi articoli.
  const primaria = zona === 'bar' ? 'bar' : 'cucina';
  const stazCat = (items) => { const b = items.filter(m => m.stazione === 'bar').length; return b >= (items.length - b) ? 'bar' : 'cucina'; };
  const catsPrim = cats.filter(c => stazCat(gruppi[c]) === primaria);
  const catsCompl = cats.filter(c => stazCat(gruppi[c]) !== primaria);
  const logo = \`<svg width="46" height="46" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="none" stroke="#E0B44A" stroke-width="3"/><path d="M24 6 L29 24 L24 42 L19 24 Z" fill="#E0B44A"/><path d="M6 24 L24 19 L42 24 L24 29 Z" fill="#12324F" opacity="0.85"/></svg>\`;
  const renderCat = (cat) => \`<section><h2>\${esc(cat)}</h2>\${gruppi[cat].map(m => \`
    <div class="item"><div class="line"><span class="nm">\${esc(m.nome)}</span><span class="dots"></span><span class="pz">\${eur(m.prezzo)}</span></div>
    \${m.descrizione ? \`<div class="desc">\${esc(m.descrizione)}</div>\` : ''}
    \${m.allergeni ? \`<div class="alg">Allergeni: \${esc(m.allergeni)}</div>\` : ''}</div>\`).join('')}</section>\`;
  const macro = (titolo, list) => list.length ? \`<div class="zona"><div class="zonahd">\${esc(titolo)}</div>\${list.map(renderCat).join('')}</div>\` : '';
  const labelBar = '\u{1F378} Bussola Bar', labelGarden = '\u{1F37D}\uFE0F Bussola Garden';
  const primLabel = zona === 'bar' ? labelBar : labelGarden;
  const complLabel = zona === 'bar' ? labelGarden : labelBar;
  const body = (macro(primLabel, catsPrim) + macro(complLabel, catsCompl)) || '<p>Nessun articolo attivo.</p>';
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare.'); return; }
  w.document.write(\`<html><head><title>Men\xF9 \xB7 \${esc(punto)}</title><style>
    /* (10) A4 con margini simmetrici \u2192 contenuto sempre centrato sul foglio */
    @page{size:A4;margin:18mm}
    html,body{background:#fff}
    body{font-family:Georgia,'Times New Roman',serif;color:#12324F;margin:0}
    header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #E0B44A;padding-bottom:12px;margin-bottom:16px;break-after:avoid}
    header .t{flex:1}
    header h1{margin:0;font-size:1.5rem;letter-spacing:1px}
    header .punto{font-size:1.05rem;font-weight:bold;color:#12324F;font-family:Arial,sans-serif}
    .zonahd{font-size:1.15rem;font-weight:bold;color:#12324F;font-family:Arial,sans-serif;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid #12324F;break-after:avoid}
    .zona{margin-bottom:6px}
    /* (10) niente salti "zoppi": categorie e singole voci non si spezzano tra due pagine */
    section{margin-bottom:16px;break-inside:avoid;page-break-inside:avoid}
    section h2{font-size:1.05rem;color:#8a6d1f;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e6ddc7;padding-bottom:4px;break-after:avoid}
    .item{margin:8px 0;break-inside:avoid;page-break-inside:avoid}
    .line{display:flex;align-items:baseline}
    .nm{font-weight:bold} .pz{font-weight:bold;white-space:nowrap}
    .dots{flex:1;border-bottom:1px dotted #b9c2ca;margin:0 6px;transform:translateY(-3px)}
    .desc{font-size:.85rem;color:#333;font-family:Arial,sans-serif;margin-top:2px}
    .alg{font-size:.75rem;color:#8a6d1f;font-style:italic;font-family:Arial,sans-serif}
    footer{margin-top:18px;border-top:1px solid #e6ddc7;padding-top:8px;font-size:.72rem;color:#777;font-family:Arial,sans-serif;break-inside:avoid}
    .qr{margin-top:20px;text-align:center;break-inside:avoid}
    .qr svg{width:132px;height:132px}
    .qrcap{font-size:.9rem;color:#12324F;font-family:Arial,sans-serif;margin-top:6px;font-weight:bold}
  </style></head><body>
    <header>\${logo}<div class="t"><h1>BUSSOLA RESIDENCE</h1></div><div class="punto">\${esc(punto)}</div></header>
    \${body}
    \${qr && qr.svg ? \`<div class="qr">\${qr.svg}<div class="qrcap">\${esc(qr.caption || '')}</div></div>\` : ''}
    <footer>Allergeni indicati secondo Reg. UE 1169/2011.</footer>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\\/script>
  </body></html>\`);
  w.document.close();
}

VIEWS.menu = async () => {
  const menu = await api('/menu');
  const rows = menu.map(m => \`<tr>
    <td><input id="mn_n_\${m.id}" value="\${esc(m.nome)}" style="min-width:140px"></td>
    <td><input id="mn_p_\${m.id}" type="number" step="0.01" inputmode="decimal" value="\${esc(String(m.prezzo))}" style="width:74px"></td>
    <td><select id="mn_s_\${m.id}"><option value="bar" \${m.stazione === 'bar' ? 'selected' : ''}>Bar</option><option value="cucina" \${m.stazione === 'cucina' ? 'selected' : ''}>Cucina</option></select></td>
    <td><input id="mn_c_\${m.id}" value="\${esc(m.categoria || '')}" style="width:110px"></td>
    <td><input id="mn_al_\${m.id}" value="\${esc(m.allergeni || '')}" style="width:150px" placeholder="glutine, latte\u2026"></td>
    <td style="text-align:center"><input type="checkbox" id="mn_a_\${m.id}" \${m.attivo ? 'checked' : ''}></td>
    <td class="row"><button class="btn gold sm" data-sv="\${m.id}">Salva</button><button class="btn danger sm" data-del="\${m.id}">\u{1F5D1}</button></td>
  </tr>\`).join('');
  $('#view').innerHTML = \`
    <div class="panel"><h3>\u2B06\uFE0F Importa men\xF9 da Excel/CSV</h3>
      <p class="muted" style="font-size:.82rem;margin-bottom:8px">Colonne riconosciute (in qualsiasi ordine): <b>nome</b>, <b>prezzo</b>, <b>stazione</b> (cucina/bar), <b>categoria</b>, <b>descrizione</b>, <b>allergeni</b>. Puoi caricare un file solo-prezzi o solo-allergeni: i campi mancanti non vengono sovrascritti.</p>
      <div class="row"><input type="file" id="imp_file" accept=".xlsx,.xls,.csv"><button class="btn ghost sm" id="imp_tpl">\u2193 Scarica modello CSV</button><button class="btn ghost sm" id="menu_exp">\u2B07\uFE0F Esporta men\xF9 (Excel)</button></div>
      <div id="imp_prev" style="margin-top:10px"></div></div>
    <div class="panel"><h3>\u{1F5A8}\uFE0F Stampa men\xF9 (PDF)</h3>
      <p class="muted" style="font-size:.82rem;margin-bottom:8px">Genera un men\xF9 stampabile (o \u201CSalva come PDF\u201D) con il logo della Bussola, categorie, descrizione/composizione e allergeni. Include solo gli articoli attivi. Stampa e comanda usano lo <b>stesso</b> raggruppamento. In fondo viene stampato \${ZONA === 'bar' ? 'il <b>QR dell\\'app Bussola</b>' : 'il <b>QR per ordinare dal tavolo</b>'}.</p>
      <div class="row"><span class="muted" style="font-size:.85rem">Punto: <b>\${ZONA === 'bar' ? 'Bussola Bar' : 'Bussola Garden'}</b> (dalla zona della postazione)</span><button class="btn gold sm" id="menu_pdf">\u{1F5A8}\uFE0F Stampa / salva PDF</button></div>
      <p class="muted" style="font-size:.82rem;margin:10px 0 6px">Se hai caricato un men\xF9 senza colonna <b>categoria</b>, il sistema la deduce dal nome (Caffetteria, Bibite, Birre\u2026). Le categorie impostate a mano non vengono toccate.</p>
      <div class="row"><button class="btn ghost sm" id="menu_recat">\u{1F3F7}\uFE0F Ricategorizza automaticamente</button></div></div>
    <div class="panel"><h3>\u{1F354} Men\xF9 del chiosco</h3>
      <table><thead><tr><th>Nome</th><th>Prezzo</th><th>Staz.</th><th>Categoria</th><th>Allergeni</th><th>Attivo</th><th></th></tr></thead><tbody>\${rows || '<tr><td colspan="7" class="muted">Nessun articolo. Importa o aggiungi.</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:10px"><input id="mn_new_n" placeholder="Nome" style="min-width:150px"><input id="mn_new_p" type="number" step="0.01" inputmode="decimal" placeholder="Prezzo" style="width:90px"><select id="mn_new_s"><option value="bar">Bar</option><option value="cucina">Cucina</option></select><input id="mn_new_c" placeholder="Categoria" style="width:120px"><button class="btn gold sm" id="mn_add">+ Aggiungi</button></div></div>\`;

  // salvataggi riga
  document.querySelectorAll('[data-sv]').forEach(b => b.onclick = async () => { const id = b.dataset.sv; await api('/menu/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#mn_n_' + id).value, prezzo: Number($('#mn_p_' + id).value), stazione: $('#mn_s_' + id).value, categoria: $('#mn_c_' + id).value, allergeni: $('#mn_al_' + id).value, attivo: $('#mn_a_' + id).checked }) }); show('menu'); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare l\\'articolo?')) return; await api('/menu/' + b.dataset.del, { method: 'DELETE' }); show('menu'); });
  $('#mn_add').onclick = async () => { if (!$('#mn_new_n').value) { alert('Nome?'); return; } await api('/menu', { method: 'POST', body: JSON.stringify({ nome: $('#mn_new_n').value, prezzo: Number($('#mn_new_p').value || 0), stazione: $('#mn_new_s').value, categoria: $('#mn_new_c').value }) }); show('menu'); };
  $('#menu_pdf').onclick = async () => {
    const punto = ZONA === 'bar' ? 'Bussola Bar' : 'Bussola Garden';
    let qr = null;
    try {
      if (ZONA === 'bar') {
        const d = await api('/pwa-qr'); const soci = (d.items || []).find(x => x.scope === 'soci');
        if (soci) qr = { svg: soci.svg, caption: '\u{1F4F2} Inquadra per l\u2019app Bussola' };
      } else {
        const d = await api('/qr-ordina?punto=' + encodeURIComponent(punto)); // senza tavolo: /ordina chieder\xE0 il numero
        qr = { svg: d.svg, caption: '\u{1F4F1} Inquadra e ordina dal tuo tavolo' };
      }
    } catch (_) {}
    stampaMenuPDF(menu, punto, qr, ZONA);
  };
  $('#menu_recat').onclick = async () => { const r = await api('/menu/ricategorizza', { method: 'POST', body: '{}' }); alert(\`Categorizzati \${r.categorizzati} articoli senza categoria.\`); show('menu'); };

  // template CSV
  $('#menu_exp').onclick = () => esporta('/menu/export');
  $('#imp_tpl').onclick = () => {
    const csv = 'nome,prezzo,stazione,categoria,descrizione,allergeni\\nPanino salsiccia,4.5,cucina,panini,Salsiccia alla griglia,glutine\\nBirra media,4,bar,birre,Bionda alla spina,glutine\\nAcqua 0.5L,1,bar,bibite,Naturale,\\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'modello_menu.csv'; a.click();
  };
  // import: il file va al server (parsing xlsx/csv lato server) \u2192 anteprima (dryRun) \u2192 conferma
  const fileToB64 = (f) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = reject; r.readAsDataURL(f); });
  $('#imp_file').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    $('#imp_prev').innerHTML = '<p class="muted">Leggo il file\u2026</p>';
    try {
      IMPORT_B64 = await fileToB64(f);
      const dry = await api('/menu/import', { method: 'POST', body: JSON.stringify({ fileB64: IMPORT_B64, dryRun: true }) });
      const preview = (dry.anteprima || []).map(r => \`<tr><td>\${esc(r.nome)}</td><td>\${esc(String(r.prezzo))}</td><td>\${esc(r.stazione)}</td><td>\${esc(r.categoria)}</td><td>\${esc(r.allergeni)}</td></tr>\`).join('');
      $('#imp_prev').innerHTML = \`<p class="muted" style="font-size:.82rem">Trovate <b>\${dry.totale}</b> righe. Anteprima:</p>
        <table><thead><tr><th>Nome</th><th>Prezzo</th><th>Staz.</th><th>Categoria</th><th>Allergeni</th></tr></thead><tbody>\${preview}</tbody></table>
        <div class="row" style="margin-top:8px"><label><input type="checkbox" id="imp_repl"> sostituisci l'intero men\xF9</label><button class="btn gold" id="imp_go">Importa \${dry.totale} righe</button></div>\`;
      $('#imp_go').onclick = async () => { const res = await api('/menu/import', { method: 'POST', body: JSON.stringify({ fileB64: IMPORT_B64, mode: $('#imp_repl').checked ? 'replace' : 'merge' }) }); alert(\`Import completato: \${res.creati} creati, \${res.aggiornati} aggiornati.\`); IMPORT_B64 = null; show('menu'); };
    } catch (err) { $('#imp_prev').innerHTML = \`<p class="muted">\${esc(err.message)}</p>\`; }
  };
};

/* ---------- RIEPILOGO comande (nell'ambiente chiosco) ---------- */
VIEWS.riepilogo = async () => {
  const tutte = await api('/comande?stato=tutte').catch(() => []);
  const oggi = new Date().toISOString().slice(0, 10);
  const isOggi = (c) => (c.created_at || '').slice(0, 10) === oggi;
  const ogg = tutte.filter(isOggi);
  const cnt = (st) => ogg.filter(c => c.stato === st).length;
  const incasso = ogg.filter(c => c.stato === 'chiusa').reduce((s, c) => s + Number(c.totale || 0), 0);
  const nPezzi = ogg.reduce((s, c) => s + (c.righe || []).reduce((x, r) => x + Number(r.qta || 0), 0), 0);
  const stat = (l, v, col) => \`<div class="panel" style="flex:1;min-width:140px;margin:0"><div class="muted" style="font-size:.72rem">\${l}</div><div style="font-size:1.6rem;font-weight:800;color:\${col || 'var(--navy)'}">\${v}</div></div>\`;
  // Incasso suddiviso per metodo di pagamento (solo comande chiuse)
  const chiuse = ogg.filter(c => c.stato === 'chiusa');
  const perMetodo = {};
  chiuse.forEach(c => { const m = c.metodo_pagamento || 'contanti'; perMetodo[m] = (perMetodo[m] || 0) + Number(c.totale || 0); });
  const breakdown = METODI.filter(m => perMetodo[m[0]]).map(m => \`<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span>\${m[1]}</span><b>\${eur(perMetodo[m[0]])}</b></div>\`).join('');
  const righe = ogg.slice().reverse().map(c => { const [lbl, cls] = COM_STATI[c.stato] || [c.stato, '']; return \`<tr><td>#\${c.numero || c.id}</td><td>\${esc(c.origine)}\${c.riferimento ? ' ' + esc(c.riferimento) : ''}</td><td>\${(c.righe || []).reduce((x, r) => x + r.qta, 0)} pz</td><td>\${eur(c.totale)}</td><td>\${c.stato === 'chiusa' ? esc(metodoLabel(c.metodo_pagamento || 'contanti')) : '\u2014'}</td><td><span class="tag \${cls}">\${esc(lbl)}</span></td></tr>\`; }).join('');
  $('#view').innerHTML = \`
    <div class="panel"><h3>\u{1F4CA} Riepilogo di oggi</h3>
      <div class="row" style="gap:10px">\${stat('Comande', ogg.length)}\${stat('Chiuse', cnt('chiusa'), 'var(--ok)')}\${stat('In corso', ogg.length - cnt('chiusa') - cnt('annullata'), 'var(--gold)')}\${stat('Pezzi', nPezzi)}\${stat('Incasso', eur(incasso), 'var(--ok)')}</div></div>
    <div class="panel"><h3>\u{1F4B6} Incasso per metodo</h3>\${breakdown || '<p class="muted">Nessuna comanda chiusa oggi.</p>'}\${chiuse.length ? \`<div class="row" style="justify-content:space-between;padding:8px 2px;margin-top:4px"><b style="color:var(--navy)">Totale</b><b style="color:var(--ok)">\${eur(incasso)}</b></div>\` : ''}</div>
    <div class="panel"><h3>Comande di oggi</h3><table><thead><tr><th>#</th><th>Origine</th><th>Pezzi</th><th>Totale</th><th>Pagam.</th><th>Stato</th></tr></thead><tbody>\${righe || '<tr><td colspan="6" class="muted">Nessuna comanda oggi.</td></tr>'}</tbody></table></div>\`;
};

/* ---------- boot ---------- */
$('#loginBtn').onclick = login;
$('#p').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('#logout').onclick = (e) => { e.preventDefault(); logout(); };
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.v));

</script>
</body>
</html>
`;

// build/ordina.html
var ordina_default = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ordina \xB7 Bussola</title>
<style>
  :root{--navy:#12324F;--gold:#C9A227;--bg:#f3efe6;--line:#cbd2d8}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--navy)}
  header{background:linear-gradient(135deg,var(--navy),#1d4a6e);color:#fff;padding:16px 16px 14px;position:sticky;top:0;z-index:5}
  header .br{font-family:Georgia,serif;font-weight:700;font-size:1.2rem;letter-spacing:1px}
  header .sub{font-size:.72rem;letter-spacing:2px;color:#ffe1ac}
  header .punto{margin-top:6px;font-size:.95rem;font-weight:700}
  main{padding:14px 14px 130px;max-width:640px;margin:0 auto}
  .cat{font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);font-size:.82rem;margin:14px 0 6px}
  .item{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center}
  .item .info{flex:1}
  .item b{display:block}
  .item .desc{font-size:.78rem;color:#555}
  .item .alg{font-size:.7rem;color:#8a6d1f;font-style:italic}
  .item .pz{color:var(--gold);font-weight:800;white-space:nowrap}
  .qbtn{border:1.5px solid var(--line);background:#fff;border-radius:9px;width:34px;height:34px;font-size:1.1rem;font-weight:800;color:var(--navy)}
  .qty{min-width:20px;text-align:center;font-weight:800}
  .cartbar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 -6px 18px rgba(0,0,0,.08)}
  .cartbar .tot{flex:1;font-weight:800}
  .btn{border:none;border-radius:12px;padding:12px 16px;font-weight:800;font-size:1rem}
  .btn.gold{background:var(--gold);color:#fff}.btn.gold:disabled{opacity:.5}
  .ok{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:24px;z-index:20}
  .ok.show{display:flex}
  .okbox{background:#fff;border-radius:18px;padding:22px;text-align:center;max-width:360px}
  .okbox .big{font-size:2rem;font-weight:800;color:var(--navy)}
  .muted{color:#666}
</style>
</head>
<body>
  <header><div class="br">BUSSOLA<span class="sub"> \xB7 RESIDENCE</span></div><div class="punto" id="punto">Ordina al tavolo</div></header>
  <main id="menu"><p class="muted">Carico il men\xF9\u2026</p></main>
  <div class="cartbar"><div class="tot" id="tot">Tocca i prodotti per ordinare</div><button class="btn gold" id="send" disabled>Invia ordine</button></div>
  <div class="ok" id="ok"><div class="okbox"><div style="font-size:2.4rem">\u2705</div><h2>Ordine inviato!</h2><div class="muted">Numero comanda</div><div class="big" id="okn">\u2014</div><p class="muted" id="okinfo"></p><button class="btn gold" id="reload">Nuovo ordine</button></div></div>
<script>
/* Componente COMANDA condiviso \u2014 una sola presentazione del men\xF9 per ogni contesto.
 * Step 0: chi lo usa carica il men\xF9 (da qualunque fonte) e lo passa qui.
 * Step 1: il men\xF9 viene raggruppato in modo logico e omogeneo (per categoria) e reso IDENTICO
 *         per lo staff (chiosco), per il cliente al tavolo (/ordina) e nell'app soci.
 * Indipendente e riusabile: nessuna dipendenza esterna, CSS auto-iniettato una volta.
 *
 * API:  const c = Comanda.create({ mount, menu, search=true, onChange(cart,total,count) })
 *       c.getRighe() -> [{menu_id, qta}]   c.total()   c.count()   c.clear()   c.setMenu(menu)   c.focusSearch()
 */
window.Comanda = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function eur(n) { return '\u20AC ' + (Number(n) || 0).toFixed(2); }
  function norm(s) { return (s == null ? '' : String(s)).toLowerCase(); }

  // Auto-categorie: se l'articolo non ha \`categoria\` valorizzata, la deduciamo dal NOME
  // cos\xEC la comanda si raggruppa in modo logico (Caffetteria, Bibite, Birre\u2026) come nel men\xF9 stampato,
  // senza dover categorizzare a mano tutto il listino. Una \`categoria\` esplicita vince sempre.
  const CAT_RULES = [
    ['Caffetteria', /caff[e\xE8]|cappucc|macchiat|marocchin|\\blatte\\b|orzo|ginseng|cioccolat|espress|ristrett|decaffe|shakerat|tisana|camomill|t[e\xE8]\\s*cald/i],
    ['Bibite', /acqua|coca|\\bcola\\b|fanta|sprite|aranciat|chinotto|gassosa|gazzosa|\\btonic|spremut|succ|t[e\xE8]\\s*fredd|th[e\xE8]|estath|energy|red\\s*bull|redbull|gatorade|powerade|bibit|cedrat|lemonsoda|oransoda|schweppes/i],
    ['Birre', /birr|\\bbeer\\b|\\bipa\\b|lager|weiss|weizen|\\bpils|stout|moretti|heineken|peroni|ichnusa|\\bcorona\\b|ceres|nastro\\s*azzurro/i],
    ['Aperitivi & Cocktail', /spritz|aperol|campari|negroni|american|mojito|cocktail|\\bgin\\b|vodka|\\brum\\b|tequila|whisk|bacardi|\\bmartini\\b|aperitiv|bitter|crodino|analcolic|\\blimoncell/i],
    ['Vini', /\\bvin[oi]\\b|calice|prosecc|spumant|franciacort|moscato|chardonnay|merlot|bollicin|champagne|champagn/i],
    ['Gelati', /gelat|ghiacciol|magnum|sorbett|granit|\\bstecco\\b|coppett/i],
    ['Snack', /patatin|\\bchips\\b|tarall|nachos|pop\\s*corn|popcorn|arachid|\\bolive\\b|salatin|cracker|pretzel|\\bsnack\\b/i],
    ['Panini & Piatti', /panin|toast|piadin|hamburger|hot\\s*dog|hotdog|pizz|focacc|tramezzin|\\bwrap\\b|insalat|\\bpasta\\b|sandwich|bruschett|tagliere|\\bfritt|arancin/i],
    ['Dolci', /cornetto|brioch|croissant|\\bdolc|\\btorta\\b|crostat|muffin|biscott|tiramis|budino|crep|cr[e\xEA]pe|waffle|nutella|pancake/i],
  ];
  const CAT_ORDER = CAT_RULES.map(r => r[0]).concat(['Bar', 'Cucina']);
  function inferCat(nome) { const s = String(nome == null ? '' : nome); for (const [name, rx] of CAT_RULES) { if (rx.test(s)) return name; } return null; }
  function catOf(m) { return (m.categoria && String(m.categoria).trim()) || inferCat(m.nome) || (m.stazione === 'cucina' ? 'Cucina' : 'Bar'); }
  function catRank(c) { if (c === 'Bar') return 900; if (c === 'Cucina') return 901; const i = CAT_ORDER.indexOf(c); return i < 0 ? 500 : i; }
  function sortCats(arr) { return arr.slice().sort((a, b) => (catRank(a) - catRank(b)) || String(a).localeCompare(String(b))); }
  function group(menu) { const g = {}; (menu || []).forEach(m => { const k = catOf(m); (g[k] = g[k] || []).push(m); }); return g; }

  // CSS iniettato una sola volta: stesso aspetto in ogni contesto (usa le variabili --navy/--gold se presenti).
  function injectCss() {
    if (document.getElementById('cmd-css')) return;
    const st = document.createElement('style'); st.id = 'cmd-css';
    st.textContent = \`
      .cmd{--c-navy:var(--navy,#12324F);--c-gold:var(--gold,#C9A227);--c-line:#cbd2d8}
      .cmd-tools{display:flex;gap:6px;margin-bottom:8px;align-items:center}
      .cmd-q{flex:1;min-width:140px;padding:9px 11px;border:1.5px solid var(--c-line);border-radius:10px;font-size:1rem}
      .cmd-qx{border:1.5px solid var(--c-line);background:#fff;border-radius:10px;width:38px;height:38px;font-weight:700;color:var(--c-navy)}
      .cmd-chips{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:2px;margin-bottom:8px}
      .cmd-chip{border:1.5px solid var(--c-line);background:#fff;color:var(--c-navy);border-radius:999px;padding:6px 14px;font-weight:700;font-size:.85rem;white-space:nowrap;cursor:pointer}
      .cmd-chip.on{background:var(--c-navy);color:#fff;border-color:var(--c-navy)}
      .cmd-list{columns:280px;column-gap:16px}
      .cmd-group{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;margin-bottom:10px}
      .cmd-cat{font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--c-navy);font-size:.8rem;margin:0 0 6px;padding-top:2px}
      .cmd-group:first-child .cmd-cat{padding-top:0}
      .cmd-item{background:#fff;border:1.5px solid var(--c-line);border-radius:12px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center}
      .cmd-info{flex:1;min-width:0}
      .cmd-info b{display:block;color:var(--c-navy)}
      .cmd-desc{font-size:.78rem;color:#555;display:block}
      .cmd-alg{font-size:.7rem;color:#8a6d1f;font-style:italic;display:block}
      .cmd-pz{color:var(--c-gold);font-weight:800;white-space:nowrap;font-size:.92rem}
      .cmd-step{display:flex;gap:6px;align-items:center}
      .cmd-b{border:1.5px solid var(--c-line);background:#fff;border-radius:9px;width:34px;height:34px;font-size:1.15rem;font-weight:800;color:var(--c-navy);line-height:1}
      .cmd-b.add{background:var(--c-gold);color:#fff;border-color:var(--c-gold)}
      .cmd-n{min-width:20px;text-align:center;font-weight:800;color:var(--c-navy)}
      .cmd-empty{color:#777;padding:10px 2px;font-size:.9rem}\`;
    document.head.appendChild(st);
  }

  function create(opts) {
    injectCss();
    const mount = opts.mount;
    let menu = opts.menu || [];
    const useSearch = opts.search !== false;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    const cart = {};
    let selCat = '';

    mount.classList.add('cmd');
    mount.innerHTML = (useSearch
      ? \`<div class="cmd-tools"><input class="cmd-q" placeholder="\u{1F50D} Cerca prodotto\u2026" autocomplete="off"><button class="cmd-qx" title="Pulisci">\u2715</button></div><div class="cmd-chips"></div>\`
      : '') + \`<div class="cmd-list"></div>\`;

    const $ = (sel) => mount.querySelector(sel);
    const listEl = $('.cmd-list');
    const qEl = useSearch ? $('.cmd-q') : null;
    const chipsEl = useSearch ? $('.cmd-chips') : null;

    function cats() { return sortCats([...new Set((menu || []).map(catOf))]); }
    function total() { let t = 0; Object.keys(cart).forEach(id => { const m = menu.find(x => String(x.id) === id); if (m) t += Number(m.prezzo) * cart[id]; }); return t; }
    function count() { let n = 0; Object.keys(cart).forEach(id => n += cart[id]); return n; }
    function fire() { onChange(cart, total(), count()); }

    function itemHTML(m) {
      const q = cart[m.id] || 0;
      return \`<div class="cmd-item"><div class="cmd-info"><b>\${esc(m.nome)}</b>\${m.descrizione ? \`<span class="cmd-desc">\${esc(m.descrizione)}</span>\` : ''}\${m.allergeni ? \`<span class="cmd-alg">Allergeni: \${esc(m.allergeni)}</span>\` : ''}</div><span class="cmd-pz">\${eur(m.prezzo)}</span><div class="cmd-step"><button class="cmd-b" data-cdec="\${m.id}">\u2212</button><b class="cmd-n" data-cn="\${m.id}">\${q}</b><button class="cmd-b add" data-cadd="\${m.id}">+</button></div></div>\`;
    }
    function renderChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = ['', ...cats()].map(c => \`<button class="cmd-chip\${c === selCat ? ' on' : ''}" data-ccat="\${esc(c)}">\${c === '' ? 'Tutti' : esc(c)}</button>\`).join('');
    }
    function renderList() {
      const q = norm(qEl && qEl.value).trim();
      const g = {};
      (menu || []).forEach(m => {
        const k = catOf(m);
        if (selCat && k !== selCat) return;
        if (q && !(norm(m.nome).includes(q) || norm(m.categoria).includes(q) || norm(m.allergeni).includes(q))) return;
        (g[k] = g[k] || []).push(m);
      });
      const keys = sortCats(Object.keys(g));
      // Ogni categoria \xE8 un blocco che NON si spezza tra le colonne: su schermi larghi (cassa/tablet)
      // il men\xF9 si dispone su pi\xF9 colonne e l'operatore non deve scorrere per cercare l'articolo.
      listEl.innerHTML = keys.length
        ? keys.map(cat => \`<div class="cmd-group"><div class="cmd-cat">\${esc(cat)}</div>\${g[cat].map(itemHTML).join('')}</div>\`).join('')
        : \`<p class="cmd-empty">Nessun prodotto\${q ? ' per \u201C' + esc(q) + '\u201D' : ''}.</p>\`;
    }
    function setN(id) { const el = mount.querySelector('[data-cn="' + id + '"]'); if (el) el.textContent = cart[id] || 0; }
    function chg(id, d) {
      const m = menu.find(x => String(x.id) === String(id)); if (!m) return;
      cart[id] = (cart[id] || 0) + d; if (cart[id] <= 0) delete cart[id];
      setN(id); fire();
    }

    // Delegazione: un solo listener per tutto il componente.
    mount.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-cadd],[data-cdec],[data-ccat]'); if (!a) return;
      if (a.dataset.cadd != null) return chg(a.dataset.cadd, 1);
      if (a.dataset.cdec != null) return chg(a.dataset.cdec, -1);
      if (a.dataset.ccat != null) { selCat = a.dataset.ccat; renderChips(); renderList(); }
    });
    if (qEl) qEl.addEventListener('input', renderList);
    if (useSearch) { const x = $('.cmd-qx'); if (x) x.addEventListener('click', () => { if (qEl) { qEl.value = ''; qEl.focus(); } renderList(); }); }

    renderChips(); renderList(); fire();

    return {
      getRighe() { return Object.keys(cart).map(id => ({ menu_id: Number(id), qta: cart[id] })); },
      total, count,
      clear() { Object.keys(cart).forEach(k => delete cart[k]); selCat = ''; renderChips(); renderList(); fire(); },
      setMenu(m) { menu = m || []; Object.keys(cart).forEach(k => delete cart[k]); selCat = ''; renderChips(); renderList(); fire(); },
      focusSearch() { if (qEl) qEl.focus(); },
    };
  }

  // Esposti perch\xE9 PDF stampabile e comanda usino LO STESSO raggruppamento/ordine (nessuno "scalino").
  return { create, group, esc, eur, catOf, inferCat, sortCats };
})();

</script>
<script>
const qs = new URLSearchParams(location.search);
const PUNTO = qs.get('p') || 'Chiosco';
const TAVOLO = qs.get('t') || '';
document.getElementById('punto').textContent = '\u{1F354} ' + PUNTO + (TAVOLO ? ' \xB7 Tavolo ' + TAVOLO : '');
const eur = n => '\u20AC ' + (Number(n) || 0).toFixed(2);
let COM = null;

function etaLabel(m) { m = Number(m || 0); return m <= 0 ? '' : (m < 60 ? \`~\${m} min\` : \`~\${Math.round(m / 60 * 10) / 10} h\`); }
function setBanner(html, cls) {
  let el = document.getElementById('so_banner');
  if (!el) { el = document.createElement('div'); el.id = 'so_banner'; const m = document.getElementById('menu'); m.parentNode.insertBefore(el, m); }
  const base = 'border-radius:12px;padding:12px 14px;margin:0 0 12px;font-size:.95rem;line-height:1.35;';
  el.style.cssText = cls === 'closed'
    ? base + 'background:#fdecea;border:1px solid #f5c6c2;color:#8a2a20;'
    : base + 'background:#eef6f5;border:1px solid #cfe6e3;color:#12324F;';
  el.innerHTML = html;
}
async function load() {
  // Prima controllo se si pu\xF2 ordinare adesso (chiuso manuale o cucina sotto pressione) e con che attesa.
  let stato = { aperto: true, ordinabile: true, sospeso_pressione: false, eta_min: 0 };
  try { stato = await (await fetch('/api/self-order/stato')).json(); } catch (e) {}
  if (!stato.ordinabile) {
    document.getElementById('menu').innerHTML = '';
    const msg = stato.sospeso_pressione
      ? '\u{1F525} <b>Cucina molto impegnata</b><br>Gli ordini dal telefono sono sospesi per pochi minuti. Rivolgiti allo staff al bancone o riprova a breve.'
      : '\u23F8\uFE0F <b>Ordini sospesi</b><br>In questo momento gli ordini dal telefono non sono attivi. Rivolgiti allo staff al bancone.';
    setBanner(msg, 'closed');
    const s = document.getElementById('send'); if (s) s.style.display = 'none';
    const t = document.getElementById('tot'); if (t) t.textContent = '';
    return;
  }
  const eta = etaLabel(stato.eta_min);
  // Se il QR \xE8 quello generico del men\xF9 (senza tavolo), chiediamo il numero del tavolo.
  if (!TAVOLO) {
    let tb = document.getElementById('so_tav_box');
    if (!tb) { tb = document.createElement('div'); tb.id = 'so_tav_box'; const m = document.getElementById('menu'); m.parentNode.insertBefore(tb, m); }
    tb.style.cssText = 'border-radius:12px;padding:12px 14px;margin:0 0 12px;background:#fff6e0;border:1px solid #e7cf8a;color:#7a5c00;font-size:.95rem';
    tb.innerHTML = '\u{1F37D}\uFE0F <b>A che tavolo sei?</b><br><input id="so_tav" type="number" min="1" inputmode="numeric" placeholder="Numero del tavolo" style="margin-top:8px;padding:9px 11px;border:1.5px solid #cbd2d8;border-radius:10px;font-size:1rem;width:180px">';
  }
  if (eta) setBanner('\u23F1\uFE0F Attesa stimata al momento: <b>' + eta + '</b>', 'eta');
  let menu;
  try { menu = await (await fetch('/api/menu')).json(); }
  catch (e) { document.getElementById('menu').innerHTML = '<p class="muted">Men\xF9 non disponibile.</p>'; return; }
  // Step 0/1: carico il men\xF9 e lo rendo con il componente condiviso (stessa vista dello staff).
  COM = Comanda.create({
    mount: document.getElementById('menu'), menu, search: true,
    onChange: (cart, tot, n) => {
      document.getElementById('tot').textContent = n ? \`\${n} prodotti \xB7 \${eur(tot)}\` : 'Tocca i prodotti per ordinare';
      document.getElementById('send').disabled = !n;
    }
  });
}
document.getElementById('send').onclick = async () => {
  const righe = COM ? COM.getRighe() : [];
  if (!righe.length) return;
  const tavInput = document.getElementById('so_tav');
  const tavolo = TAVOLO || (tavInput ? tavInput.value.trim() : '');
  if (!tavolo) { alert('Indica il numero del tavolo per inviare l\u2019ordine.'); if (tavInput) tavInput.focus(); return; }
  document.getElementById('send').disabled = true;
  let r;
  try { r = await (await fetch('/api/self-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ punto: PUNTO, tavolo, righe }) })).json(); }
  catch (e) { alert('Invio non riuscito, riprova.'); document.getElementById('send').disabled = false; return; }
  if (!r.ok) { alert(r.error || 'Ordini momentaneamente non disponibili.'); document.getElementById('send').disabled = false; return; }
  document.getElementById('okn').textContent = '#' + r.numero;
  const eta = etaLabel(r.eta_min);
  document.getElementById('okinfo').textContent = (r.punto || PUNTO) + (r.tavolo ? ' \xB7 Tavolo ' + r.tavolo : '') + ' \xB7 ' + eur(r.totale) + ' \u2014 si paga in cassa.' + (eta ? ' Pronto tra ' + eta + '.' : '');
  document.getElementById('ok').classList.add('show');
};
document.getElementById('reload').onclick = () => location.reload();
load();

</script>
</body>
</html>
`;

// server/pwa-icons.js
var ICON_192 = "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";
var ICON_512 = "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";
var ICON_180 = "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";

// server/pwa.js
var png192 = Buffer.from(ICON_192, "base64");
var png512 = Buffer.from(ICON_512, "base64");
var png180 = Buffer.from(ICON_180, "base64");
var APPS = {
  socio: { scope: "/", name: "Bussola Residence", short: "Bussola", theme: "#12324F", bg: "#0d2137" },
  admin: { scope: "/admin/", name: "Bussola Back Office", short: "Bussola BO", theme: "#12324F", bg: "#0d2137" },
  chiosco: { scope: "/chiosco/", name: "Bussola Chiosco", short: "Chiosco", theme: "#12324F", bg: "#0d2137" }
};
function manifest(app2) {
  return JSON.stringify({
    name: app2.name,
    short_name: app2.short,
    description: "App del residence Bussola \u2014 by KOIN\xC8",
    start_url: app2.scope,
    scope: app2.scope,
    id: app2.scope,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: app2.bg,
    theme_color: app2.theme,
    lang: "it",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  });
}
function sw(app2) {
  const pfx = "bussola" + app2.scope.replace(/\//g, "_");
  return `const V=${JSON.stringify(String(VERSION))};
const CACHE='${pfx}v'+V;
const START=${JSON.stringify(app2.scope)};
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k.startsWith('${pfx}')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET'){return;}
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')){ e.respondWith(fetch(req).catch(()=>caches.match(req))); return; }
  // App shell + script/stili: NETWORK-FIRST, cos\xEC dopo un deploy si vede subito la versione nuova.
  if(req.mode==='navigate' || ['script','style','document'].includes(req.destination)){
    e.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(req,c));return r;}).catch(()=>caches.match(req).then(m=>m||caches.match(START))));
    return;
  }
  // Altro (immagini, icone): cache-first per velocit\xE0/offline.
  e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{if(res&&res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(req,c));}return res;}).catch(()=>r)));
});
// Web Push: mostra la notifica ricevuta e, al tocco, apre/porta in primo piano l'app.
self.addEventListener('push',e=>{
  let d={}; try{ d=e.data?e.data.json():{}; }catch(_){ d={ title:'Bussola Residence', body:(e.data&&e.data.text&&e.data.text())||'' }; }
  const title=d.title||'Bussola Residence';
  const opts={ body:d.body||'', icon:START+'icons/icon-192.png', badge:START+'icons/icon-192.png', data:{ url:d.url||START }, tag:d.tag||'bussola', renotify:true };
  e.waitUntil(self.registration.showNotification(title,opts));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||START;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){ if('focus'in c){ try{c.navigate&&c.navigate(url);}catch(_){}; return c.focus(); } }
    if(clients.openWindow) return clients.openWindow(url);
  }));
});`;
}
function pwaHead(appKey) {
  const app2 = APPS[appKey];
  const m = app2.scope + "manifest.webmanifest";
  const s = app2.scope + "sw.js";
  return `<link rel="manifest" href="${m}">
<meta name="theme-color" content="${app2.theme}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${app2.short}">
<link rel="apple-touch-icon" href="/pwa/apple-180.png">
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${s}',{scope:'${app2.scope}'}).catch(function(){});});}</script>`;
}
function mountPwa(app2) {
  const send = (res, type, body, sw2) => {
    res.setHeader("Content-Type", type);
    if (sw2) {
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Cache-Control", "no-cache");
    }
    res.send(body);
  };
  app2.get("/pwa/icon-192.png", (req, res) => send(res, "image/png", png192));
  app2.get("/pwa/icon-512.png", (req, res) => send(res, "image/png", png512));
  app2.get("/pwa/apple-180.png", (req, res) => send(res, "image/png", png180));
  app2.get("/manifest.webmanifest", (req, res) => send(res, "application/manifest+json", manifest(APPS.socio)));
  app2.get("/sw.js", (req, res) => send(res, "application/javascript", sw(APPS.socio), true));
  app2.get("/admin/manifest.webmanifest", (req, res) => send(res, "application/manifest+json", manifest(APPS.admin)));
  app2.get("/admin/sw.js", (req, res) => send(res, "application/javascript", sw(APPS.admin), true));
  app2.get("/chiosco/manifest.webmanifest", (req, res) => send(res, "application/manifest+json", manifest(APPS.chiosco)));
  app2.get("/chiosco/sw.js", (req, res) => send(res, "application/javascript", sw(APPS.chiosco), true));
}

// build/entry.mjs
var FRONTEND = frontend_default.replace("</head>", pwaHead("socio") + "\n</head>");
var ADMIN = admin_default.replace("</head>", pwaHead("admin") + "\n</head>");
var CHIOSCO = chiosco_default.replace("</head>", pwaHead("chiosco") + "\n</head>");
var BUILD = true ? "2026-08-18 06:54" : "online";
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
mountPwa(app);
app.get("/api/health", (req, res) => res.json({ ok: true, version: VERSION, build: BUILD, env: process.env.KOINE_ENV || "online", ts: (/* @__PURE__ */ new Date()).toISOString() }));
app.use("/api/auth", authUserRouter);
app.use("/api", publicRouter);
app.use("/api/admin", adminRouter);
var html = (res, body) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(body);
};
app.get(["/", "/index.html"], (req, res) => html(res, FRONTEND));
app.get(["/admin", "/admin/", "/admin/index.html"], (req, res) => html(res, ADMIN));
app.get(["/chiosco", "/chiosco/", "/chiosco/index.html"], (req, res) => html(res, CHIOSCO));
app.get(["/ordina", "/ordina/", "/ordina/index.html"], (req, res) => html(res, ordina_default));
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

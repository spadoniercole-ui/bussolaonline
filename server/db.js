import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { KEY } from './crypto.js';
import { inferCategoria, inferPunto } from './menucat.js';
import { vincitrice } from './tournament.js';

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
// IL NUMERO DI TESSERA.
//
// Formato: RB-000123-4 — sigla, progressivo, cifra di controllo.
//
// Niente anno dentro il numero, e non e' un dettaglio estetico: la tessera identifica una
// PERSONA, non una stagione. Un residente la rinnova solo se la perde, la rovina, smette di
// funzionare, oppure se ha dimenticato le proprie credenziali e va azzerata l'utenza. Mettere
// l'anno nel numero avrebbe significato o cambiarlo a ogni stagione — perdendo il filo di tutto
// quello che quella persona ha fatto — o portarsi dietro un anno sbagliato per anni.
//
// La cifra finale e' un controllo (modulo 11): un numero dettato male al banco viene rifiutato
// subito, invece di risultare "socio non trovato" e far cercare un errore che non c'e'.
function cifraControllo(numero) {
  const somma = String(numero).split("").reduce((acc, d, i) => acc + Number(d) * (i % 6 + 2), 0);
  return String(11 - somma % 11).slice(-1);
}
function formattaTessera(progressivo) {
  const n = String(progressivo).padStart(6, "0");
  return `RB-${n}-${cifraControllo(n)}`;
}
// Accetta il formato nuovo e quello vecchio (BR-2026-0101): le tessere gia' stampate devono
// continuare a funzionare, altrimenti si costringe mezzo residence a rifarsi la card.
function tesseraValida(code) {
  return /^RB-\d{6}-\d$/.test(String(code || "").toUpperCase()) || /^BR-\d{4}-\d{3,6}$/.test(String(code || "").toUpperCase());
}
async function nextTessera() {
  const rows = await db.prepare("SELECT tessera_code FROM soci WHERE tessera_code LIKE 'RB-%'").all();
  let max = 0;
  for (const r of rows) {
    const m = /RB-(\d{6})-\d/.exec(String(r.tessera_code || "").toUpperCase());
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return formattaTessera(max + 1);
}
async function insertSocioUnique(cols, vals) {
  const iCode = cols.indexOf("tessera_code");
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO soci (${cols.join(",")}) VALUES (${placeholders})`;
  let base = await nextTessera();
  let baseNum = parseInt(/RB-(\d{6})-\d/.exec(base)[1], 10);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = formattaTessera(baseNum + attempt);
    const args = vals.slice();
    args[iCode] = code;
    try {
      const info = await db.prepare(sql).run(...args);
      // La tessera nasce registrata: il registro delle emissioni non si popola solo all'avvio,
      // altrimenti chi si iscrive oggi non ha nessuna storia da mostrare domani.
      try {
        await db.prepare("INSERT OR IGNORE INTO tessere (code,socio_id,stato,motivo) VALUES (?,?,'attiva','prima emissione')")
          .run(code, Number(info.lastInsertRowid));
      } catch (_) {
      }
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

  -- Registro storico: la memoria lunga del residence, per le contestazioni. Si scrive e non
  -- si riscrive mai: una prenotazione disdetta aggiunge una riga, non ne corregge una.
  -- Nessuna pulizia periodica tocca questa tabella.
  CREATE TABLE IF NOT EXISTS registro_storico (
    id            INTEGER PRIMARY KEY,
    ts            TEXT NOT NULL DEFAULT (datetime('now')),  -- quando e' stato registrato il fatto
    fatto         TEXT NOT NULL,                            -- prenotazione_creata | prenotazione_cancellata | ...
    servizio      TEXT NOT NULL,                            -- garden | campi | fitness | stage | cdc | coworking | comande
    riferimento   TEXT,                                     -- id o numero della prenotazione/comanda
    socio_id      INTEGER,                                  -- a nome di chi
    intestatario  TEXT,                                     -- nome leggibile, che resta anche se il socio non c'e' piu'
    autore        TEXT,                                     -- CHI ha compiuto l'atto: il socio, un operatore, il gestore
    canale        TEXT,                                     -- app | qr | crew | backoffice
    quando_servizio TEXT,                                   -- data/turno del servizio a cui si riferisce
    importo       REAL,
    dettaglio     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_registro_ts ON registro_storico(ts);
  CREATE INDEX IF NOT EXISTS idx_registro_servizio ON registro_storico(servizio, riferimento);

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
    ordine        INTEGER NOT NULL DEFAULT 0,
    complemento   INTEGER NOT NULL DEFAULT 0,            -- 1 = e' un condimento/aggiunta: non compare da solo nel menu'
    con_condimenti INTEGER NOT NULL DEFAULT 0             -- 1 = dentro questo prodotto compare la riga "condimenti"
  );
  -- Quali complementi si possono spuntare dentro un prodotto. Il legame e' per singolo
  -- prodotto: la maionese sta nel panino, non in tutta la categoria.
  CREATE TABLE IF NOT EXISTS menu_complementi (
    articolo_id    INTEGER NOT NULL REFERENCES menu_articoli(id) ON DELETE CASCADE,
    complemento_id INTEGER NOT NULL REFERENCES menu_articoli(id) ON DELETE CASCADE,
    ordine         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (articolo_id, complemento_id)
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
    non_prima   TEXT,                                     -- HH:MM: la cucina non consegna prima
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
  await addIfMissing("menu_articoli", "zona", "zona TEXT NOT NULL DEFAULT 'bar'");
  // v5.21 — complementi: un prodotto puo' portarsi dietro le sue aggiunte, spuntabili si'/no.
  await addIfMissing("menu_articoli", "complemento", "complemento INTEGER NOT NULL DEFAULT 0");
  // v5.35 — "Necessita condimenti": non si deduce piu' da chi prepara il piatto, e' una spunta
  // sul prodotto. Il gestore la vede nel listino e la mette dove serve, senza che nessuno
  // indovini al posto suo.
  await addIfMissing("menu_articoli", "con_condimenti", "con_condimenti INTEGER NOT NULL DEFAULT 0");
  // v5.38 — alcolici: senza tessera il sistema non sa quanti anni ha chi ordina, e per gli
  // alcolici l'eta' non e' un dettaglio. Il prodotto dichiara se e' alcolico; il resto lo fa
  // chi consegna, avvisato dalla comanda.
  await addIfMissing("menu_articoli", "alcolico", "alcolico INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("comande", "verifica_eta", "verifica_eta INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("comanda_righe", "motivo_storno", "motivo_storno TEXT");
  await addIfMissing("comanda_righe", "stornata_da", "stornata_da TEXT");
  // v5.39 — quanti posti aveva il tavolo prima di accostarne un altro: separando si torna a
  // quel numero invece di sottrarre, cosi' la sala torna sempre come prima.
  await addIfMissing("tavoli", "posti_base", "posti_base INTEGER");
  // v5.45 — la cucina parla alla sala: quando toglie una riga, il tavolo si accende di rosso
  // con un punto esclamativo e il messaggio va letto per primo aprendo il tavolo.
  await addIfMissing("comande", "avviso_cucina", "avviso_cucina TEXT");
  await addIfMissing("comande", "avviso_cucina_at", "avviso_cucina_at TEXT");
  // v5.59 — disdetta tardiva del fitness: l'iscrizione e' annullata ma la lezione resta dovuta.
  // Senza questa colonna, un'annullata e una dovuta erano indistinguibili, e al banco non si
  // sapeva a chi chiedere i soldi.
  await addIfMissing("fitness_prenotazioni", "dovuta", "dovuta INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("fitness_prenotazioni", "annullata_at", "annullata_at TEXT");
  // v5.63 — la tessera come prepagata. Il saldo NON e' un incasso: e' un debito verso il socio,
  // e diventa ricavo solo quando consuma. Per questo i movimenti stanno in una tabella loro,
  // separata dalle comande: a fine stagione si deve poter dire, socio per socio, quanto ha
  // caricato, quanto ha speso e quanto gli si deve ancora.
  await addIfMissing("soci", "prepagata_autorizzata", "prepagata_autorizzata INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("soci", "prepagata_autorizzata_da", "prepagata_autorizzata_da TEXT");
  await addIfMissing("soci", "prepagata_autorizzata_at", "prepagata_autorizzata_at TEXT");
  // Il numero di tessera e' SEQUENZIALE (BR-2026-0101, 0102, ...): perfetto per identificare
  // qualcuno, inutile come credenziale di pagamento — si indovina a voce. Per spendere il
  // credito serve un PIN, che il socio sceglie e che nessuno puo' dedurre dal numero.
  await addIfMissing("soci", "pin_hash", "pin_hash TEXT");
  await addIfMissing("soci", "pin_tentativi", "pin_tentativi INTEGER NOT NULL DEFAULT 0");
  // v5.75 — COMPOSIZIONE DELLE CASATE.
  // Il sesso serve alla quota di rappresentanza: senza, la quota non e' calcolabile. E' un dato
  // sensibile, quindi sta qui per una ragione precisa e per nessun'altra.
  await addIfMissing("soci", "sesso", "sesso TEXT");
  // Il nucleo familiare non si separa mai: chi ha lo stesso codice finisce nella stessa casata.
  // I minori seguono automaticamente il tutore, senza bisogno di scriverlo.
  await addIfMissing("soci", "nucleo", "nucleo TEXT");
  // Chi vuole giocare la Coppa. Chi non risponde non viene assegnato d'ufficio: assegnare
  // qualcuno che non vuole giocare significa ritrovarsi una casata in meno alla sfilata.
  await addIfMissing("soci", "gioca_coppa", "gioca_coppa INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("casate", "schierata", "schierata INTEGER NOT NULL DEFAULT 1");
  // Il capitano: convoca, iscrive la casata ai tornei, risponde. Serve un nome, e serve anche
  // un secondo nome — un capitano assente la sera del torneo e' una casata che non si presenta.
  await addIfMissing("casate", "capitano_socio_id", "capitano_socio_id INTEGER");
  await addIfMissing("casate", "vice_socio_id", "vice_socio_id INTEGER");
  await addIfMissing("piazzole", "file", "file INTEGER");
  await addIfMissing("piazzole", "colonne", "colonne INTEGER");
  // v5.78 — LA SPIAGGIA. Quattro piazzole, ombrelloni numerati, due fasce al giorno.
  //
  // Sulle piazzole non c'e' nessuno della crew: il sistema non ha un arbitro, quindi le regole
  // devono reggersi da sole e ogni gesto deve restare scritto. Il registro non serve a punire
  // qualcuno domani: serve perche' a fine stagione, se una piazzola e' sempre contesa, si sappia
  // se e' un problema di regole o di persone.
  await db.exec(`
  CREATE TABLE IF NOT EXISTS piazzole (
    id       INTEGER PRIMARY KEY,
    nome     TEXT NOT NULL UNIQUE,
    larghezza_m REAL,
    profondita_m REAL,
    -- File e colonne: la piazzola si disegna come le altre piante (Garden, Stage, coworking).
    -- Senza, gli ombrelloni finiscono in una griglia inventata che non somiglia alla spiaggia.
    file INTEGER,
    colonne INTEGER,
    attiva   INTEGER NOT NULL DEFAULT 1,
    ordine   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ombrelloni (
    id          INTEGER PRIMARY KEY,
    piazzola_id INTEGER NOT NULL REFERENCES piazzole(id) ON DELETE CASCADE,
    numero      INTEGER NOT NULL,
    posti       INTEGER NOT NULL DEFAULT 2,
    x           REAL NOT NULL DEFAULT 50,
    y           REAL NOT NULL DEFAULT 50,
    attivo      INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_ombrelloni_piazzola ON ombrelloni(piazzola_id);

  -- Una presa: chi, quale ombrellone, quale fascia, quando ha cominciato e quando ha smesso.
  -- Il nucleo e' scritto qui e non dedotto: se domani la famiglia cambia codice, la storia di
  -- ieri deve restare quella che era.
  CREATE TABLE IF NOT EXISTS ombrellone_prese (
    id           INTEGER PRIMARY KEY,
    ombrellone_id INTEGER NOT NULL REFERENCES ombrelloni(id) ON DELETE CASCADE,
    data         TEXT NOT NULL,
    fascia       TEXT NOT NULL,                  -- mattina | pomeriggio
    socio_id     INTEGER,
    tessera_code TEXT,
    nome         TEXT,
    nucleo       TEXT,
    presa_at     TEXT NOT NULL DEFAULT (datetime('now')),
    scade_at     TEXT,
    rilasciata_at TEXT,
    stato        TEXT NOT NULL DEFAULT 'attiva'  -- attiva | rilasciata | scaduta
  );
  CREATE INDEX IF NOT EXISTS idx_prese_giorno ON ombrellone_prese(data, fascia);

  -- Chiusure: vento, manutenzione, marea.
  CREATE TABLE IF NOT EXISTS piazzole_blocchi (
    id          INTEGER PRIMARY KEY,
    piazzola_id INTEGER NOT NULL REFERENCES piazzole(id) ON DELETE CASCADE,
    data        TEXT NOT NULL,
    fascia      TEXT,
    motivo      TEXT NOT NULL DEFAULT 'vento',
    nota        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Le quattro piazzole del condominio: esistono, e i loro nomi non si inventano.
  try {
    if (await getSetting("piazzole_default", "") !== "v1") {
      const insP = db.prepare("INSERT OR IGNORE INTO piazzole (nome,ordine) VALUES (?,?)");
      const nomi = ["Grande", "Caltagirone", "Piccola", "Quadrata"];
      for (let i = 0; i < nomi.length; i++) await insP.run(nomi[i], i + 1);
      await setSetting("piazzole_default", "v1");
    }
  } catch (_) {
  }
  // LE TESSERE EMESSE. La persona resta la stessa, la card no: si perde, si rovina, smette di
  // funzionare, o va rifatta perche' qualcuno ha dimenticato le credenziali e l'utenza va
  // azzerata. Il numero e' quindi una CREDENZIALE sostituibile, non l'identita'.
  //
  // I numeri vecchi non si cancellano: restano scritti dentro prenotazioni, iscrizioni e
  // comande di anni passati. Qui restano risolvibili — si sa a chi appartenevano — ma marcati
  // revocati, cosi' con quelli non si prenota e non si paga piu'.
  await db.exec(`
  CREATE TABLE IF NOT EXISTS tessere (
    code        TEXT PRIMARY KEY,
    socio_id    INTEGER NOT NULL,
    stato       TEXT NOT NULL DEFAULT 'attiva',      -- attiva | revocata
    emessa_at   TEXT NOT NULL DEFAULT (datetime('now')),
    revocata_at TEXT,
    motivo      TEXT
  )`);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_tessere_socio ON tessere(socio_id)");
  // v5.67 — I CAMPI A PAGAMENTO. Tennis, beach tennis e beach volley non sono come gli altri:
  // chi li gestisce li affitta e ci fa lezione privata, con un listino suo. Gli altri campi
  // restano gratuiti e in mano al chiosco. Il prezzo orario lo prendono TUTTI i campi — anche
  // quelli del chiosco, a zero — perche' domani si puo' decidere di far pagare anche quelli
  // senza rimettere le mani nello schema.
  await addIfMissing("campi", "gestione", "gestione TEXT NOT NULL DEFAULT 'chiosco'");
  await addIfMissing("campi", "prezzo_ora", "prezzo_ora REAL NOT NULL DEFAULT 0");
  await addIfMissing("prenotazioni_campo", "prezzo", "prezzo REAL NOT NULL DEFAULT 0");
  await addIfMissing("prenotazioni_campo", "pagato", "pagato INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("prenotazioni_campo", "tipo_uso", "tipo_uso TEXT NOT NULL DEFAULT 'campo'");
  await db.exec(`
  CREATE TABLE IF NOT EXISTS campi_tariffe (
    id        INTEGER PRIMARY KEY,
    campo_id  INTEGER NOT NULL REFERENCES campi(id) ON DELETE CASCADE,
    etichetta TEXT NOT NULL,
    da_ora    TEXT,                                  -- vuoto = vale tutto il giorno
    a_ora     TEXT,
    tipo_uso  TEXT NOT NULL DEFAULT 'campo',         -- campo | lezione
    prezzo_ora REAL NOT NULL DEFAULT 0,
    attiva    INTEGER NOT NULL DEFAULT 1
  )`);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_tariffe_campo ON campi_tariffe(campo_id)");
  // Il libro degli incassi dei campi a pagamento: sta fuori dal registro storico del residence,
  // perche' quello lo legge il gestore e li' dentro finirebbe il fatturato di un soggetto terzo.
  await db.exec(`
  CREATE TABLE IF NOT EXISTS tornei_ko (
    id        INTEGER PRIMARY KEY,
    nome      TEXT NOT NULL,
    disciplina TEXT,
    gestione  TEXT NOT NULL DEFAULT 'chiosco',        -- chi lo organizza: chiosco | tennis
    posti     INTEGER NOT NULL,                       -- 4, 8, 16, 32: un tabellone deve essere pieno
    quota     REAL NOT NULL DEFAULT 0,
    data      TEXT,
    stato     TEXT NOT NULL DEFAULT 'iscrizioni',     -- iscrizioni | sorteggiato | concluso
    vincitore TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tornei_ko_iscritti (
    id        INTEGER PRIMARY KEY,
    torneo_id INTEGER NOT NULL REFERENCES tornei_ko(id) ON DELETE CASCADE,
    socio_id  INTEGER,
    tessera_code TEXT,
    nome      TEXT NOT NULL,
    pagato    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Il tabellone: una riga per partita, con il turno e la posizione. La partita successiva si
  -- ricava dalla posizione, cosi' il vincitore sale da solo senza che nessuno lo trascini.
  CREATE TABLE IF NOT EXISTS tornei_ko_partite (
    id        INTEGER PRIMARY KEY,
    torneo_id INTEGER NOT NULL REFERENCES tornei_ko(id) ON DELETE CASCADE,
    turno     INTEGER NOT NULL,                       -- 1 = primo turno, poi 2, 3...
    posizione INTEGER NOT NULL,                       -- 0,1,2... dentro il turno
    a_nome    TEXT,
    b_nome    TEXT,
    a_iscritto INTEGER,
    b_iscritto INTEGER,
    vincitore TEXT,
    punteggio TEXT,
    giocata_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ko_partite ON tornei_ko_partite(torneo_id, turno, posizione);

  CREATE TABLE IF NOT EXISTS tennis_incassi (
    id INTEGER PRIMARY KEY,
    prenotazione_id INTEGER,
    campo_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    slot TEXT,
    importo REAL NOT NULL,
    metodo TEXT,
    operatore TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Una-tantum: tennis, beach tennis e beach volley passano al modulo che li affitta.

  // Le tessere gia' in giro entrano nel registro come attive: continuano a funzionare, e da
  // domani si sa che esistono.
  try {
    if (await getSetting("tessere_registro", "") !== "v1") {
      for (const r of await db.prepare("SELECT id,tessera_code FROM soci WHERE tessera_code IS NOT NULL").all()) {
        await db.prepare("INSERT OR IGNORE INTO tessere (code,socio_id,stato,motivo) VALUES (?,?,'attiva','prima emissione')")
          .run(r.tessera_code, r.id);
      }
      await setSetting("tessere_registro", "v1");
    }
  } catch (_) {
  }
  await db.exec(`
  CREATE TABLE IF NOT EXISTS tessera_movimenti (
    id        INTEGER PRIMARY KEY,
    socio_id  INTEGER NOT NULL,
    tipo      TEXT NOT NULL,                       -- ricarica | spesa | rimborso | rettifica
    importo   REAL NOT NULL,                       -- positivo carica, negativo scarica
    saldo_dopo REAL NOT NULL,
    causale   TEXT,
    comanda_id INTEGER,
    operatore TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_tessera_mov ON tessera_movimenti(socio_id, id)");
  // v5.48 — l'OTP diventa un accesso vero: quante volte si e' sbagliato il codice (per
  // fermare chi prova a indovinare), da dove e' stata chiesta, e se la mail e' partita.
  await addIfMissing("otp", "tentativi", "tentativi INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("otp", "ip", "ip TEXT");
  await addIfMissing("otp", "inviata", "inviata INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("otp", "creato_at", "creato_at TEXT");
  await addIfMissing("soci", "email_verificata", "email_verificata INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("comanda_righe", "parent_riga_id", "parent_riga_id INTEGER");
  // v5.27 — ora prima della quale una comanda di cucina non puo' essere consegnata.
  await addIfMissing("comande", "non_prima", "non_prima TEXT");
  await db.exec(`CREATE TABLE IF NOT EXISTS menu_complementi (
    articolo_id    INTEGER NOT NULL,
    complemento_id INTEGER NOT NULL,
    ordine         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (articolo_id, complemento_id)
  );`);
  // Una-tantum: i condimenti che il gestore ha gia' a listino come voci autonome (la categoria
  // "Condimenti extra" in cima al menu') diventano complementi dei piatti che escono dalla
  // cucina. Non si cancella nulla: restano articoli con il loro prezzo e il loro collegamento
  // al magazzino, cambia solo dove si spuntano. Se un abbinamento non va, si toglie dal Crew.
  try {
    if (await getSetting("menu_complementi_backfill", "") !== "v1") {
      const CONDIM = /condiment|aggiunt|complement|extra/i;
      const cond = (await db.prepare("SELECT id,nome,categoria FROM menu_articoli").all())
        .filter((m) => CONDIM.test(String(m.categoria || "")));
      if (cond.length) {
        const ids = cond.map((c) => c.id);
        for (const c of cond) await db.prepare("UPDATE menu_articoli SET complemento=1 WHERE id=?").run(c.id);
        const piatti = await db.prepare("SELECT id FROM menu_articoli WHERE stazione='cucina'").all();
        for (const p of piatti) {
          if (ids.includes(p.id)) continue;
          let o = 0;
          for (const c of cond) {
            await db.prepare("INSERT OR IGNORE INTO menu_complementi (articolo_id,complemento_id,ordine) VALUES (?,?,?)").run(p.id, c.id, o++);
          }
        }
      }
      await setSetting("menu_complementi_backfill", "v1");
    }
  } catch (_) {
  }
  // Una-tantum: chi prepara il prodotto. I menu' caricati da file arrivano quasi sempre con
  // tutto marcato "bar", perche' nessuno compila quella colonna su duecento righe. Il
  // risultato era che nel sistema non esisteva NIENTE di cucina: il panino non compariva al
  // Bar, i condimenti non si spuntavano in nessun piatto e il KDS Cucina restava vuoto.
  // Qui si deduce dal nome e dalla categoria. Se una voce finisce nel posto sbagliato, si
  // corregge dalla colonna "Chi prepara" e da li' in poi vale la scelta del gestore.
  try {
    if (await getSetting("menu_stazione_dedotta", "") !== "v1") {
      const { inferStazione: inferStazione2 } = await import('./menucat.js');
      const arts = await db.prepare("SELECT id,nome,categoria,stazione FROM menu_articoli").all();
      let spostati = 0;
      for (const m of arts) {
        if (m.stazione === "cucina") continue;
        if (inferStazione2(m.nome, m.categoria) !== "cucina") continue;
        await db.prepare("UPDATE menu_articoli SET stazione='cucina' WHERE id=?").run(m.id);
        spostati++;
      }
      await setSetting("menu_stazione_dedotta", "v1");
      // E gia' che si guarda il listino: le voci della categoria dei condimenti diventano
      // aggiunte. E' l'unica spunta che servirebbe al gestore, e gliela si toglie di mezzo.
      // Se una di queste si vende anche da sola, basta togliere la spunta "Compl.".
      const CONDIM = /condiment|aggiunt|complement|salse/i;
      let aggiunte = 0;
      for (const m of arts) {
        if (!CONDIM.test(String(m.categoria || ""))) continue;
        await db.prepare("UPDATE menu_articoli SET complemento=1 WHERE id=?").run(m.id);
        aggiunte++;
      }
      if (spostati) console.log(`  Menu': ${spostati} voci assegnate alla cucina (panini, piatti, fritti).`);
      if (aggiunte) console.log(`  Menu': ${aggiunte} voci segnate come aggiunte (condimenti).`);
    }
  } catch (_) {
  }
  // Una-tantum: le voci che il sistema tratta come condimenti PERCHE' LO DICE LA CATEGORIA
  // devono avere anche la spunta, altrimenti nel listino la colonna Compl. resta vuota su
  // righe che si comportano da aggiunte. Quello che si vede deve dire quello che succede.
  try {
    if (await getSetting("menu_compl_da_categoria", "") !== "v1") {
      const RX = /condiment|aggiunt|complement|\bsalse\b/i;
      const arts5 = await db.prepare("SELECT id,categoria,complemento FROM menu_articoli").all();
      let n5 = 0;
      for (const m of arts5) {
        if (Number(m.complemento) === 1 || !RX.test(String(m.categoria || ""))) continue;
        await db.prepare("UPDATE menu_articoli SET complemento=1 WHERE id=?").run(m.id);
        n5++;
      }
      await setSetting("menu_compl_da_categoria", "v1");
      if (n5) console.log(`  Menu': ${n5} voci in categoria condimenti ora spuntate come aggiunte.`);
    }
  } catch (_) {
  }
  // Una-tantum: quali prodotti sono alcolici. Si deduce dalla categoria e dal nome, come per
  // il resto; poi la colonna resta nel listino e la corregge il gestore.
  try {
    if (await getSetting("menu_alcolici", "") !== "v1") {
      const ALC = /alcolic|birr|vino|vini\b|calice|prosecc|spuman|amar|grappa|distillat|liquor|rum\b|gin\b|vodka|whisky|spritz|apero|cocktail|negroni|mojito|limoncell/i;
      const arts4 = await db.prepare("SELECT id,nome,categoria FROM menu_articoli").all();
      let alc = 0;
      for (const m of arts4) {
        const t = String(m.nome || "") + " " + String(m.categoria || "");
        if (!ALC.test(t)) continue;
        if (/analcolic|senza alcol|0[.,]0/i.test(t)) continue;
        await db.prepare("UPDATE menu_articoli SET alcolico=1 WHERE id=?").run(m.id);
        alc++;
      }
      await setSetting("menu_alcolici", "v1");
      if (alc) console.log(`  Menu': ${alc} prodotti segnati come alcolici (verifica eta' al ritiro).`);
    }
  } catch (_) {
  }
  // Una-tantum: la spunta "Necessita condimenti" parte accesa su cio' che davvero e' un piatto
  // o un panino. NON si guarda la colonna "Chi prepara", che nel listino reale era stata
  // sporcata da un comando in massa (55 voci su 60 marcate cucina, caffe' compreso): si guarda
  // il nome e la categoria, che dicono la verita'. Da li' in poi comanda la spunta, e la mette
  // il gestore.
  try {
    if (await getSetting("menu_con_condimenti", "") !== "v1") {
      const { inferStazione: inferStazione3 } = await import('./menucat.js');
      const CONDIM2 = /condiment|aggiunt|complement|salse/i;
      const arts2 = await db.prepare("SELECT id,nome,categoria,complemento FROM menu_articoli").all();
      let accesi = 0;
      for (const m of arts2) {
        if (Number(m.complemento) === 1 || CONDIM2.test(String(m.categoria || ""))) continue;
        if (inferStazione3(m.nome, m.categoria) !== "cucina") continue;
        await db.prepare("UPDATE menu_articoli SET con_condimenti=1 WHERE id=?").run(m.id);
        accesi++;
      }
      await setSetting("menu_con_condimenti", "v1");
      if (accesi) console.log(`  Menu': ${accesi} prodotti segnati "necessita condimenti" (panini e piatti).`);
    }
  } catch (_) {
  }
  // Una-tantum: i piatti che passano dalla cucina erano stati chiusi nel Garden, e quindi
  // invisibili a chi ordina dal Bar — un panino alle sei di pomeriggio non si poteva chiedere.
  // Cio' che la cucina prepara si vende in tutte e due le aree. Chi vuole tenerne uno solo al
  // Garden lo rimette dalla colonna "Dove si vende".
  try {
    if (await getSetting("menu_cucina_comune", "") !== "v1") {
      await db.exec("UPDATE menu_articoli SET zona='comune' WHERE stazione='cucina' AND zona<>'comune'");
      await setSetting("menu_cucina_comune", "v1");
    }
  } catch (_) {
  }
  try {
    if (await getSetting("menu_zona_backfill", "") !== "v1") {
      const { inferPunto: inferPunto2 } = await import('./menucat.js');
      const arts = await db.prepare("SELECT id,nome,categoria,stazione FROM menu_articoli").all();
      for (const m of arts) {
        const z = m.stazione === "cucina" ? "comune" : inferPunto2(m.nome, m.categoria);
        await db.prepare("UPDATE menu_articoli SET zona=? WHERE id=?").run(z, m.id);
      }
      await setSetting("menu_zona_backfill", "v1");
    }
  } catch (_) {
  }
  try {
    const { inferCategoria: inferCategoria2 } = await import('./menucat.js');
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
  // v4.94 — La simulazione di stagione ha mostrato che 1008 comande non muovono di un'unita'
  // il magazzino: le giacenze restano quelle del carico iniziale e il punto di riordino non
  // scatta mai. Una voce di menu puo' ora essere collegata a un articolo, con la quantita'
  // consumata per ogni pezzo venduto: alla chiusura della comanda lo scarico parte da solo.
  await addIfMissing("menu_articoli", "magazzino_id", "magazzino_id INTEGER");
  await addIfMissing("menu_articoli", "consumo", "consumo REAL NOT NULL DEFAULT 1");
  await addIfMissing("comande", "scaricata", "scaricata INTEGER NOT NULL DEFAULT 0");
  // v5.07 — Contatto di emergenza: un familiare da chiamare. Sta in anagrafica del socio,
  // perche' e' un dato suo, e compare fra i numeri di "Chiedi aiuto".
  await addIfMissing("soci", "emergenza_nome", "emergenza_nome TEXT");
  await addIfMissing("soci", "emergenza_tel", "emergenza_tel TEXT");
  // v5.17 — Un colore per disciplina: nel calendario settimanale, sette giorni per cinque ore
  // sono trentacinque caselle, e distinguere Pilates da Yoga a colpo d'occhio vale piu' di
  // qualunque etichetta. Il colore si sceglie creando il corso.
  await addIfMissing("corsi_fitness", "colore", "colore TEXT");
  try {
    if (await getSetting("fitness_colori_v1", "") !== "v1") {
      const tavolozza = ["#2f6d8a", "#7a5c2e", "#2e6b45", "#8a4a6b", "#b08b3e", "#5f5188"];
      const corsi = await db.prepare("SELECT id FROM corsi_fitness ORDER BY id").all();
      for (let i = 0; i < corsi.length; i++) {
        await db.prepare("UPDATE corsi_fitness SET colore=? WHERE id=? AND (colore IS NULL OR colore='')").run(tavolozza[i % tavolozza.length], corsi[i].id);
      }
      await setSetting("fitness_colori_v1", "v1");
    }
  } catch (_) {
  }
  // v5.14 — Chat di casata. Solo testo, niente allegati: serve a dire "ci sono sabato",
  // "cerco un sostituto", "proviamo con quella formazione". Venti persone al massimo per
  // stanza, piu' il gruppo dei capitani.
  //
  // Sulla riservatezza abbiamo scelto la strada onesta: i messaggi NON sono privati, e lo si
  // dichiara all'ingresso. Nelle casate ci sono minorenni, e una stanza dove nessuno puo'
  // verificare cosa accade e' un rischio che il residence non puo' assumersi. Il gestore vede
  // cio' che viene segnalato, non tutto: la segnalazione e' la chiave che apre, non una porta
  // sempre aperta.
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messaggi (
    id           INTEGER PRIMARY KEY,
    ambito       TEXT NOT NULL DEFAULT 'casata',   -- casata | capitani
    casata_id    INTEGER REFERENCES casate(id) ON DELETE CASCADE,
    socio_id     INTEGER REFERENCES soci(id) ON DELETE SET NULL,
    tessera_code TEXT,
    nome         TEXT NOT NULL,
    testo        TEXT NOT NULL,
    segnalato    INTEGER NOT NULL DEFAULT 0,
    segnalato_da TEXT,
    motivo       TEXT,
    nascosto     INTEGER NOT NULL DEFAULT 0,
    nascosto_da  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_chat ON chat_messaggi(ambito, casata_id, id);
  CREATE INDEX IF NOT EXISTS ix_chat_segn ON chat_messaggi(segnalato, id);
  `);
  } catch (_) {
  }

  // v5.14 — Distinta del menu' e tipo di consumo.
  // Un articolo "a pezzo" (bottiglia, gelato, bustina) si scarica uno a uno ed e' esatto.
  // Un articolo "a peso" (caffe', latte, insalata) non si scarica: da una pianta di lattuga
  // escono tre o quattro piatti a seconda di com'e' fatta. Per quelli si calcola il consumo
  // TEORICO e lo si confronta con la conta reale: la differenza e' l'informazione utile.
  await addIfMissing("magazzino_articoli", "tipo_consumo", "tipo_consumo TEXT NOT NULL DEFAULT 'peso'");
  try {
    // Il tipo si deduce dall'unita' di misura: quello che si conta a pezzi si scarica uno a
    // uno, quello che si misura a peso o a volume no. E' la classificazione giusta nove volte
    // su dieci, e resta modificabile articolo per articolo.
    if (await getSetting("tipo_consumo_v1", "") !== "v1") {
      await db.prepare(
        "UPDATE magazzino_articoli SET tipo_consumo='pezzo' WHERE LOWER(unita) IN ('pz','pezzo','pezzi','n','conf','cf','bottiglia','lattina','bustina','barattolo','scatola','vasetto')"
      ).run();
      await setSetting("tipo_consumo_v1", "v1");
    }
  } catch (_) {
  }
  await addIfMissing("magazzino_articoli", "sfrido_pct", "sfrido_pct REAL NOT NULL DEFAULT 0");
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS menu_distinta (
    id          INTEGER PRIMARY KEY,
    menu_id     INTEGER NOT NULL REFERENCES menu_articoli(id) ON DELETE CASCADE,
    articolo_id INTEGER NOT NULL REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
    quantita    REAL NOT NULL,
    UNIQUE(menu_id, articolo_id)
  );
  CREATE TABLE IF NOT EXISTS consumo_teorico (
    id          INTEGER PRIMARY KEY,
    articolo_id INTEGER NOT NULL REFERENCES magazzino_articoli(id) ON DELETE CASCADE,
    data        TEXT NOT NULL,
    quantita    REAL NOT NULL DEFAULT 0,
    UNIQUE(articolo_id, data)
  );
  `);
  } catch (_) {
  }
  // v5.05 — Richieste di aiuto dall'app. Non e' un allarme automatico: e' un socio che preme
  // un tasto e chiede assistenza, con la sua posizione se la concede. Arriva alla Crew, che e'
  // sul posto, in parallelo alla telefonata al 112 che parte dal telefono.
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS richieste_aiuto (
    id           INTEGER PRIMARY KEY,
    tessera_code TEXT,
    nome         TEXT,
    tipo         TEXT NOT NULL DEFAULT 'aiuto',   -- aiuto | sono_qui
    lat          REAL,
    lng          REAL,
    precisione   REAL,
    nota         TEXT,
    stato        TEXT NOT NULL DEFAULT 'aperta',  -- aperta | presa | chiusa
    preso_da     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    chiusa_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_aiuto_stato ON richieste_aiuto(stato, created_at);
  `);
  } catch (_) {
  }
  // v5.03 — Codice della mappa fornito da Google (Condividi → Incorpora una mappa): si tiene
  // il solo indirizzo dell'iframe, verificato, cosi' la mappa mostrata e' esattamente
  // l'inquadratura scelta dal gestore invece di una approssimazione dalle coordinate.
  await addIfMissing("bussola", "mappa_embed", "mappa_embed TEXT");
  await addIfMissing("luoghi", "mappa_embed", "mappa_embed TEXT");
  // v5.00 — Eventi e serate hanno un LUOGO (bar | garden | stage | altro) e una CAPIENZA.
  // Senza, non si sa dove si tiene una cosa ne' quante persone puo' accogliere: la
  // presentazione di un libro allo Stage e un aperitivo al Bar erano indistinguibili.
  await addIfMissing("eventi", "luogo", "luogo TEXT");
  await addIfMissing("eventi", "occupa_stage", "occupa_stage INTEGER NOT NULL DEFAULT 0");
  await addIfMissing("serate", "luogo", "luogo TEXT");
  try {
    if (await getSetting("eventi_luogo_v1", "") !== "v1") {
      // Si deduce dall'ambiente gia' scritto, dove c'e'.
      await db.prepare("UPDATE eventi SET luogo=LOWER(ambiente) WHERE luogo IS NULL AND ambiente IS NOT NULL AND ambiente<>''").run();
      await db.prepare("UPDATE eventi SET luogo='stage' WHERE luogo IS NULL AND (LOWER(ambiente) LIKE '%stage%' OR tipo='cinema')").run();
      await setSetting("eventi_luogo_v1", "v1");
    }
  } catch (_) {
  }
  // v4.99 — Ritirata la vecchia risorsa "Postazione Coworking": era un secondo sistema di
  // prenotazione parallelo alla sala vera. Chi prenotava di li' non compariva nella sala, il
  // contatore non si muoveva e il socio non ritrovava la propria prenotazione da nessuna parte.
  try {
    if (await getSetting("cowo_unificato", "") !== "v1") {
      await db.prepare("UPDATE risorse SET attivo=0 WHERE chiave='cowo' OR tipo='coworking'").run();
      await setSetting("cowo_unificato", "v1");
    }
  } catch (_) {
  }
  // v4.95 — Cartellone della Coppa ridotto a sei discipline. Con dieci servivano 190 partite
  // in 60 giorni (oltre 3 al giorno) e la stagione si chiudeva senza graduatoria. Le altre
  // vengono spente, non cancellate: i risultati gia' registrati restano.
  try {
    if (await getSetting("coppa_sei_discipline", "") !== "v1") {
      await db.prepare(
        "UPDATE discipline SET attivo=0 WHERE chiave NOT IN ('calcetto','basket','soft','pickle','burraco','scala')"
      ).run();
      await setSetting("coppa_sei_discipline", "v1");
    }
  } catch (_) {
  }
  // v4.95 — Platea: ogni seduta ha una DESTINAZIONE, non solo un tipo.
  //   over70      · la prima fila, riservata agli over 70 fino a esaurimento
  //   garden      · chi ha cenato al primo turno (il secondo turno cena mentre si recita)
  //   spettacolo  · chi viene solo per l'esibizione
  // Le due categorie si alternano per fila (4 Garden, 2 spettacolo) cosi' chi non cena non
  // finisce sempre in fondo.
  await addIfMissing("tavoli", "quota", "quota TEXT");
  // Prenotazione di sedute condivise (coworking): serve sapere quante persone siedono a
  // ciascun tavolo, non solo se il tavolo e' occupato.
  await addIfMissing("prenotazioni_tavolo", "scopo", "scopo TEXT");
  // v4.92 — Le coordinate inserite in v4.89/4.90 erano STIME, non posizioni verificate: il
  // segnaposto della farmacia o della guardia medica cadeva nel posto sbagliato. Un segnaposto
  // sbagliato e' peggio di nessun segnaposto — chi lo segue non trova quello che cerca. Si
  // cancellano quelle ancora identiche ai valori che avevo messo, lasciando intatte quelle che
  // il gestore ha nel frattempo corretto. Le voci tornano righe di testo finche' non si
  // inserisce la posizione vera dal back office.
  try {
    if (await getSetting("bussola_geo_reset_v1", "") !== "v1") {
      const STIMATE = [
        [36.9186, 15.1706], [36.9906, 15.2178], [36.9169, 15.1731], [36.9203, 15.169],
        [36.9192, 15.1712], [37.0596, 15.2933], [37.0759, 15.2743], [37.0594, 15.2933],
        [37.0035, 15.3037], [36.9906, 15.0447]
      ];
      const del = db.prepare("UPDATE bussola SET lat=NULL, lng=NULL WHERE ROUND(lat,4)=ROUND(?,4) AND ROUND(lng,4)=ROUND(?,4)");
      for (const [la, ln] of STIMATE) await del.run(la, ln);
      await setSetting("bussola_geo_reset_v1", "v1");
    }
  } catch (_) {
  }
  // v4.90 — Le coordinate erano nel seed, che pero' NON gira sui database gia' avviati: le
  // voci esistenti restavano senza lat/lng e quindi senza collegamento alle mappe. Si
  // compilano per titolo, una volta sola, e solo dove sono ancora vuote.
  try {
    if (await getSetting("bussola_geo_v1", "") !== "v1") {
      const COORD = [
        ["Farmacia", 36.9186, 15.1706], ["Guardia medica", 36.9906, 15.2178],
        ["Spiaggia", 36.9169, 15.1731], ["Market", 36.9203, 15.169],
        ["Bar & tabacchi", 36.9192, 15.1712], ["Ortigia", 37.0596, 15.2933],
        ["Neapolis", 37.0759, 15.2743], ["Duomo", 37.0594, 15.2933],
        ["Plemmirio", 37.0035, 15.3037], ["Cavagrande", 36.9906, 15.0447]
      ];
      const upd = db.prepare("UPDATE bussola SET lat=?, lng=? WHERE lat IS NULL AND titolo LIKE ?");
      for (const [nome, la, ln] of COORD) await upd.run(la, ln, "%" + nome + "%");
      await setSetting("bussola_geo_v1", "v1");
    }
  } catch (_) {
  }
  // v4.89 — Coordinate sulle voci della guida: farmacia, spiaggia, Ortigia... con lat/lng
  // diventano collegamenti che aprono le mappe del telefono invece di sole righe di testo.
  await addIfMissing("bussola", "lat", "lat REAL");
  await addIfMissing("bussola", "lng", "lng REAL");
  // v4.89 — Fino alla v4.85 il self-order scriveva zona='garden' per OGNI ordine, anche quelli
  // del Bar: e' per questo che una comanda del bar compariva sui tavoli del Garden. Le comande
  // gia' registrate si correggono dal punto, una volta sola.
  try {
    if (await getSetting("comande_zona_fix", "") !== "v1") {
      await db.prepare("UPDATE comande SET zona='bar' WHERE LOWER(punto) LIKE '%bar%' AND zona<>'bar'").run();
      await db.prepare("UPDATE comande SET zona='carta' WHERE LOWER(punto) LIKE '%carta%' AND zona<>'carta'").run();
      await setSetting("comande_zona_fix", "v1");
    }
  } catch (_) {
  }
  // v4.86 — Calendario rifiuti: un flag per periodo. In app si vede solo quello in corso,
  // invece di tutti i periodi uno sotto l'altro.
  await addIfMissing("rifiuti_calendario", "attivo", "attivo INTEGER NOT NULL DEFAULT 1");
  try {
    // Al primo giro tiene acceso solo il primo periodo: mostrarli tutti era il difetto.
    if (await getSetting("rifiuti_attivo_v1", "") !== "v1") {
      const primo = await db.prepare("SELECT id FROM rifiuti_calendario ORDER BY ordine,id LIMIT 1").get();
      if (primo) {
        await db.prepare("UPDATE rifiuti_calendario SET attivo=0").run();
        await db.prepare("UPDATE rifiuti_calendario SET attivo=1 WHERE id=?").run(primo.id);
      }
      await setSetting("rifiuti_attivo_v1", "v1");
    }
  } catch (_) {
  }
  // v4.85 — Le scacchiere sono due e i set sono due, distinti: pedine (dama) e scacchi.
  // La voce unica "Set di pedine e scacchi" li confondeva in un pezzo solo.
  try {
    if (await getSetting("cdc_set_separati", "") !== "v1") {
      const vecchio = await db.prepare("SELECT * FROM cdc_giochi WHERE nome='Set di pedine e scacchi'").get();
      if (vecchio) {
        await db.prepare("UPDATE cdc_giochi SET nome='Set di pedine (dama)' WHERE id=?").run(vecchio.id);
        await db.prepare("INSERT INTO cdc_giochi (nome,categoria,quantita,stato,ordine) VALUES (?,?,?,?,?)")
          .run("Set di scacchi", vecchio.categoria || "scacchi", vecchio.quantita || 2, "ok", (vecchio.ordine || 0) + 1);
      }
      await setSetting("cdc_set_separati", "v1");
    }
  } catch (_) {
  }
  // v4.84 — Prenotazione della SALA. Mancava del tutto: la Casa di Carta non ospita solo
  // giochi e coworking, ma anche riunioni, presentazioni e incontri che occupano lo spazio
  // per intero. Una prenotazione di sala esclude i tavoli nella fascia indicata.
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS prenotazioni_sala (
    id          INTEGER PRIMARY KEY,
    data        TEXT NOT NULL,
    ora_inizio  TEXT NOT NULL,
    ora_fine    TEXT NOT NULL,
    scopo       TEXT NOT NULL DEFAULT 'riunione',   -- riunione | presentazione | corso | altro
    titolo      TEXT,
    richiedente TEXT,
    tessera_code TEXT,
    persone     INTEGER NOT NULL DEFAULT 1,
    esclusiva   INTEGER NOT NULL DEFAULT 1,         -- occupa tutta la sala
    note        TEXT,
    stato       TEXT NOT NULL DEFAULT 'confermata', -- confermata | annullata
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_sala_data ON prenotazioni_sala(data, stato);
  `);
  } catch (_) {
  }
  // v4.83 — Casa di Carta: i tavoli da gioco si prenotano come quelli del Garden, e lo
  // strumento prestato si lega al tavolo su cui verra' usato. Serve a evitare i sit-in e a
  // sapere chi ha lasciato il tavolo in disordine.
  await addIfMissing("cdc_prestiti", "tavolo", "tavolo INTEGER");
  await addIfMissing("prenotazioni_tavolo", "gioco_id", "gioco_id INTEGER");
  // v4.82 — Numero legale sui campi. Senza, la regola della catena e' aggirabile: basta che
  // prenoti uno solo e giochino in sei senza registrarsi. Con il numero legale conviene
  // dichiarare i compagni, perche' altrimenti la prenotazione decade e il campo si libera.
  await addIfMissing("campi", "min_giocatori", "min_giocatori INTEGER NOT NULL DEFAULT 2");
  await addIfMissing("partite_aperte", "decaduta_at", "decaduta_at TEXT");
  try {
    // Default sensato per i campi gia' esistenti: meta' dei posti, almeno due.
    await db.prepare("UPDATE campi SET min_giocatori = MAX(2, (posti_default + 1) / 2) WHERE min_giocatori IS NULL OR min_giocatori < 2").run();
  } catch (_) {
  }
  // v4.81 — Albo d'Oro delle casate. Il gioco delle casate dura una stagione estiva
  // (luglio-agosto) e si chiude entro il 19 agosto, perche' il 20 c'e' la serata delle casate.
  // Alla chiusura la graduatoria si congela, il tabellone si chiude e i primi tre entrano
  // nell'Albo: la prima ha diritto, la stagione dopo, a fregiarsi del simbolo del residence.
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS albo_casate (
    id          INTEGER PRIMARY KEY,
    stagione    TEXT NOT NULL,                        -- es. "2026"
    posizione   INTEGER NOT NULL,
    casata_id   INTEGER,
    casata_nome TEXT NOT NULL,
    punti       INTEGER NOT NULL DEFAULT 0,
    ex_aequo    INTEGER NOT NULL DEFAULT 0,
    chiuso_at   TEXT NOT NULL DEFAULT (datetime('now')),
    chiuso_da   TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_albo ON albo_casate(stagione, posizione, casata_nome);
  `);
  } catch (_) {
  }
  // v4.80 — La Casa di Carta ha la sua zona di magazzino: 'carta'. Prima usava 'cdc' e i suoi
  // prodotti finivano spesso marcati 'comune', mescolandosi con la merce di appoggio.
  try {
    await db.prepare("UPDATE magazzino_articoli SET zona='carta' WHERE zona='cdc'").run();
    await db.prepare("UPDATE magazzino_richieste SET zona='carta' WHERE zona='cdc'").run();
    await db.prepare("UPDATE magazzino_movimenti SET zona='carta' WHERE zona='cdc'").run();
  } catch (_) {
  }
  // v4.79 — Area fitness. Non e' una disciplina (quelle sono tornei della Coppa, con punti e
  // graduatoria) ne' un campo (quelli sono slot gratuiti senza istruttore): ha istruttore,
  // prezzo, durata e un minimo di partecipanti sotto il quale la lezione non si apre.
  // Si paga la SINGOLA lezione, in contanti a fine lezione: nessun abbonamento da gestire.
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS corsi_fitness (
    id             INTEGER PRIMARY KEY,
    nome           TEXT NOT NULL,                     -- pilates, yoga, zumba...
    istruttore     TEXT,
    descrizione    TEXT,
    data_inizio    TEXT,
    data_fine      TEXT,
    giorni         TEXT NOT NULL DEFAULT '[]',        -- JSON: 1=lun ... 7=dom
    ora            TEXT NOT NULL DEFAULT '09:00',
    durata_min     INTEGER NOT NULL DEFAULT 60,
    posti_max      INTEGER NOT NULL DEFAULT 20,
    min_iscritti   INTEGER NOT NULL DEFAULT 10,       -- sotto questo la lezione non si apre
    prezzo         REAL NOT NULL DEFAULT 0,
    masterclass    INTEGER NOT NULL DEFAULT 0,        -- corso interamente "vip"
    prezzo_master  REAL NOT NULL DEFAULT 0,
    attivo         INTEGER NOT NULL DEFAULT 1,
    ordine         INTEGER NOT NULL DEFAULT 0
  );
  -- La singola lezione. Il flag masterclass sta QUI e non solo sul corso: capita che un
  -- istruttore piu' noto tenga una sera sola, e dev'essere rappresentabile senza inventare
  -- un corso apposta.
  CREATE TABLE IF NOT EXISTS fitness_sedute (
    id           INTEGER PRIMARY KEY,
    corso_id     INTEGER NOT NULL REFERENCES corsi_fitness(id) ON DELETE CASCADE,
    data         TEXT NOT NULL,
    ora          TEXT NOT NULL,
    durata_min   INTEGER NOT NULL DEFAULT 60,
    istruttore   TEXT,
    posti_max    INTEGER NOT NULL DEFAULT 20,
    min_iscritti INTEGER NOT NULL DEFAULT 10,
    prezzo       REAL NOT NULL DEFAULT 0,
    masterclass  INTEGER NOT NULL DEFAULT 0,
    titolo       TEXT,                                -- nome della masterclass, se diverso
    stato        TEXT NOT NULL DEFAULT 'programmata', -- programmata | annullata
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_sedute ON fitness_sedute(corso_id, data, ora);
  CREATE TABLE IF NOT EXISTS fitness_prenotazioni (
    id           INTEGER PRIMARY KEY,
    seduta_id    INTEGER NOT NULL REFERENCES fitness_sedute(id) ON DELETE CASCADE,
    socio_id     INTEGER,
    tessera_code TEXT,
    nome         TEXT,
    stato        TEXT NOT NULL DEFAULT 'prenotato',   -- prenotato | annullato
    pagato       INTEGER NOT NULL DEFAULT 0,          -- si incassa in contanti a fine lezione
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_fitpren ON fitness_prenotazioni(seduta_id, stato);
  `);
  } catch (_) {
  }
  // v4.78 — Cinema. La platea dello stage e' la stessa cosa della sala del Garden: posti con
  // una posizione su una pianta, assegnati dal centro verso l'esterno. Invece di duplicare il
  // motore si generalizza: una disposizione appartiene a un AMBIENTE (garden | stage) e un
  // posto ha un TIPO (standard | extra). Cambiano le etichette, non la logica.
  await addIfMissing("tavoli_layout", "ambiente", "ambiente TEXT NOT NULL DEFAULT 'garden'");
  await addIfMissing("tavoli", "tipo", "tipo TEXT NOT NULL DEFAULT 'standard'");
  await addIfMissing("prenotazioni_tavolo", "ambiente", "ambiente TEXT NOT NULL DEFAULT 'garden'");
  await addIfMissing("prenotazioni_tavolo", "proiezione_id", "proiezione_id INTEGER");
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS film (
    id         INTEGER PRIMARY KEY,
    titolo     TEXT NOT NULL,
    regia      TEXT,
    anno       INTEGER,
    durata_min INTEGER,
    genere     TEXT,
    sinossi    TEXT,
    vm         TEXT,                                   -- eta' consigliata / visione
    attivo     INTEGER NOT NULL DEFAULT 1,
    ordine     INTEGER NOT NULL DEFAULT 0
  );
  -- Una proiezione e' un film in una data: e' quella che l'app mostra nel cartellone
  -- settimanale e quella su cui si prenotano i posti in platea.
  CREATE TABLE IF NOT EXISTS proiezioni (
    id         INTEGER PRIMARY KEY,
    film_id    INTEGER REFERENCES film(id),
    data       TEXT NOT NULL,                          -- YYYY-MM-DD
    ora        TEXT NOT NULL DEFAULT '21:30',
    layout_id  INTEGER REFERENCES tavoli_layout(id),   -- disposizione della platea
    note       TEXT,
    stato      TEXT NOT NULL DEFAULT 'programmata',    -- programmata | annullata
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_proiezioni_data ON proiezioni(data);
  `);
  } catch (_) {
  }
  // v4.73 — Tavoli uniti: due tavoli accostati diventano un tavolo solo con i posti sommati.
  // 'uniti' elenca i numeri assorbiti: restano validi (i QR gia' stampati funzionano) ma le
  // comande e le prenotazioni confluiscono sul tavolo che li ha assorbiti.
  await addIfMissing("tavoli", "uniti", "uniti TEXT");
  // v4.72 — Eventi: in alternativa al prezzo d'ingresso si puo' chiedere una consumazione
  // obbligatoria (si entra consumando). 'costo_tipo': nessuno | prezzo | consumazione.
  await addIfMissing("eventi", "costo_tipo", "costo_tipo TEXT NOT NULL DEFAULT 'nessuno'");
  await addIfMissing("eventi", "consumazione", "consumazione TEXT");
  // v4.70 — Tavoli del Garden: entita' vera con posti e posizione sulla pianta.
  // Un LAYOUT e' una disposizione con un nome ("standard", "concerto", "cena unica"...);
  // ogni giorno puo' usarne uno diverso, perche' la sistemazione cambia con la serata.
  // Il NUMERO del tavolo resta l'identita' stabile: e' quello dei QR self-order e di
  // comande.riferimento, quindi non cambia quando si sposta il tavolo sulla pianta.
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS tavoli_layout (
    id          INTEGER PRIMARY KEY,
    nome        TEXT NOT NULL,
    predefinito INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tavoli (
    id        INTEGER PRIMARY KEY,
    layout_id INTEGER NOT NULL REFERENCES tavoli_layout(id) ON DELETE CASCADE,
    numero    INTEGER NOT NULL,
    posti     INTEGER NOT NULL DEFAULT 4,
    forma     TEXT NOT NULL DEFAULT 'tondo',        -- tondo | quadrato | rettangolo
    x         REAL NOT NULL DEFAULT 50,             -- percentuale 0-100 della pianta
    y         REAL NOT NULL DEFAULT 50,
    attivo    INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_tavoli_layout_num ON tavoli(layout_id, numero);
  -- Quale disposizione vale in un certo giorno (se assente vale il layout predefinito).
  CREATE TABLE IF NOT EXISTS tavoli_giorni (
    data      TEXT PRIMARY KEY,
    layout_id INTEGER NOT NULL REFERENCES tavoli_layout(id) ON DELETE CASCADE
  );
  -- Prenotazione della cena al Garden: due turni, tavoli assegnati dal centro alla periferia.
  -- 'tavoli' e' la lista dei numeri occupati: un gruppo numeroso ne puo' occupare piu' d'uno.
  CREATE TABLE IF NOT EXISTS prenotazioni_tavolo (
    id           INTEGER PRIMARY KEY,
    data         TEXT NOT NULL,
    turno        TEXT NOT NULL,                     -- '20:00' | '21:30'
    persone      INTEGER NOT NULL DEFAULT 2,
    tavoli       TEXT NOT NULL DEFAULT '[]',        -- JSON: [numero, ...]
    socio_id     INTEGER,
    tessera_code TEXT,
    nome         TEXT,
    origine      TEXT NOT NULL DEFAULT 'app',       -- app | crew
    stato        TEXT NOT NULL DEFAULT 'prenotato', -- prenotato | annullato
    note         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_prent_giorno ON prenotazioni_tavolo(data, turno, stato);
  `);
  } catch (_) {
  }
  // v4.68 — punti Coppa congelati al momento dell'archiviazione dell'edizione:
  // archiviaEdizione cancella partite e gironi, quindi la graduatoria non e' piu' ricalcolabile.
  await addIfMissing("edizioni", "punti_coppa", "punti_coppa TEXT");
  // v4.67 — regole d'uso dei campi, decise dal gestore nel back office.
  // Il numero di posti resta quello del campo (posti_default): il titolare NON lo sceglie.
  await addIfMissing("campi", "max_slot_prenotazione", "max_slot_prenotazione INTEGER NOT NULL DEFAULT 2");
  await addIfMissing("campi", "max_pren_settimana", "max_pren_settimana INTEGER NOT NULL DEFAULT 3");
  // v4.67 — ogni prenotazione ha un titolare socio; 'aperta_ai_soci' distingue la partita aperta
  // (altri si uniscono fino ai posti del campo) dalla prenotazione riservata al solo titolare.
  await addIfMissing("partite_aperte", "aperta_ai_soci", "aperta_ai_soci INTEGER NOT NULL DEFAULT 1");
  await addIfMissing("partite_aperte", "n_slot", "n_slot INTEGER NOT NULL DEFAULT 1");
  await addIfMissing("partite_aperte", "slot_fine", "slot_fine TEXT");
  await addIfMissing("partite_aperte", "titolare_socio_id", "titolare_socio_id INTEGER");
  await addIfMissing("prenotazioni_campo", "titolare_socio_id", "titolare_socio_id INTEGER");
  try {
    await db.exec(`
  CREATE TABLE IF NOT EXISTS campi_blocchi (
    id        INTEGER PRIMARY KEY,
    campo_id  INTEGER NOT NULL REFERENCES campi(id) ON DELETE CASCADE,
    data      TEXT NOT NULL,                          -- YYYY-MM-DD
    slot_da   TEXT NOT NULL DEFAULT '00:00',          -- HH:MM inclusa
    slot_a    TEXT NOT NULL DEFAULT '23:59',          -- HH:MM inclusa
    motivo    TEXT NOT NULL DEFAULT 'torneo',         -- torneo | manutenzione | evento
    nota      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_blocchi_campo ON campi_blocchi(campo_id, data);
  `);
  } catch (_) {
  }
  try {
    if (await getSetting("campi_categoria_backfill", "") !== "v1") {
      const MAP = { pickleball: "tennis", soft_tennis: "tennis", beach: "volley", calcetto: "calcio" };
      for (const [vecchio, nuovo] of Object.entries(MAP)) {
        await db.prepare("UPDATE campi SET sport=? WHERE sport=?").run(nuovo, vecchio);
      }
      await setSetting("campi_categoria_backfill", "v1");
    }
  } catch (_) {
  }
  try {
    if (await getSetting("campi_default_v1", "") !== "done") {
      const n = await db.prepare("SELECT COUNT(*) c FROM campi").get();
      if (Number(n?.c || 0) === 0) {
        // La gestione si dichiara alla nascita, non si deduce dopo: tennis, beach tennis e
        // beach volley li affitta chi li tiene, gli altri restano gratuiti al chiosco.
        const ins = db.prepare("INSERT INTO campi (nome,sport,apertura,chiusura,durata_slot,ora_min,posti_default,ordine,gestione) VALUES (?,?,?,?,?,?,?,?,?)");
        const DEF = [
          ["Campo Tennis 1", "tennis", "08:00", "22:00", 60, null, 4, 1, "tennis"],
          ["Campo Tennis 2", "tennis", "08:00", "22:00", 60, null, 4, 2, "tennis"],
          ["Campo Beach Volley", "volley", "09:00", "22:00", 60, null, 12, 3, "tennis"],
          ["Campo Calcio a 5", "calcio", "18:00", "23:00", 60, "18:00", 10, 4, "chiosco"],
          ["Campo Basket 3\xD73", "basket", "09:00", "22:00", 60, null, 6, 5, "chiosco"]
        ];
        for (const c of DEF) await ins.run(...c);
      }
      await setSetting("campi_default_v1", "done");
    }
  try {
    if (await getSetting("campi_gestione_tennis", "") !== "v1") {
      // Solo TRE campi stanno nell'area a pagamento: tennis, beach tennis, beach volley. Il
      // touch tennis e il pickleball hanno "tennis" nel nome ma stanno al chiosco, gratuiti —
      // indovinare dal nome li avrebbe portati dalla parte sbagliata. Chi non rientra in questi
      // tre resta al chiosco, e l'assegnazione definitiva la fa il gestore a mano.
      await db.prepare(
        `UPDATE campi SET gestione='tennis'
         WHERE (lower(nome) LIKE '%beach volley%' OR lower(sport)='volley'
             OR lower(nome) LIKE '%beach tennis%'
             OR (lower(nome) LIKE '%tennis%' AND lower(nome) NOT LIKE '%touch%' AND lower(nome) NOT LIKE '%picker%' AND lower(nome) NOT LIKE '%pickle%'))`
      ).run();
      await setSetting("campi_gestione_tennis", "v1");
    }
    // Rimedio: la prima versione portava anche touch tennis e pickleball fra i campi a
    // pagamento, perche' hanno "tennis" nel nome. Non e' cosi': quelli sono del chiosco.
    if (await getSetting("campi_gestione_tennis_fix", "") !== "v1") {
      await db.prepare(
        "UPDATE campi SET gestione='chiosco' WHERE gestione='tennis' AND (lower(nome) LIKE '%touch%' OR lower(nome) LIKE '%picker%' OR lower(nome) LIKE '%pickle%')"
      ).run();
      await setSetting("campi_gestione_tennis_fix", "v1");
    }
  } catch (_) {
  }  } catch (_) {
  }
}
var TURSO_URL, AUTH, url, LOCAL_FILE, IS_REMOTE, DB_PATH, client, flat, db;
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

export { DB_PATH, IS_REMOTE, audit, db, getSetting, initSchema, insertSocioUnique, nextTessera, setSetting, tesseraValida, url };

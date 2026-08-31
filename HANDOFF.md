# Bussola Residence — HANDOFF per nuova chat (stato a v5.90)

> Allega questo file **e lo zip dei sorgenti** (`bussola-src-v5.90.zip`) all'avvio della nuova chat.

---

## 0. Come far ripartire l'assistente

> "Riprendi il lavoro su **Bussola Residence** dallo stato **v5.90**. Ti allego i sorgenti
> (`bussola-src-v5.90.zip`) e questo handoff. Scompatta lo zip in `/home/claude/`, esegui
> `npm install` e `npm test` (attesi 345 verdi), poi prosegui."

### ⚠️ LEZIONE DELLA SESSIONE PRECEDENTE — non ripeterla
Il vecchio handoff diceva che il codice "vive nell'ambiente di lavoro". **Non è vero: il
container si azzera fra una sessione e l'altra.** All'apertura di questa chat esisteva solo
`bussolav4.66.zip`, che contiene il **bundle di deploy** e non i sorgenti: l'intero albero è
stato ricostruito a mano dal bundle, e **gli 87 test sono andati persi** (non finiscono nel
bundle).

**Regola d'ora in avanti: a fine sessione si consegnano SEMPRE due zip** — quello di deploy
(`online/`) e quello dei **sorgenti completi**. Conservali entrambi.

---

## 1. Cos'è il prodotto
PWA per il residence. Stack: **Node/Express + Turso/libSQL**, consegnata come bundle single-file.
Quattro front-end sullo stesso server:
- **`/`** app soci → `public/index.html` + `public/app.js`
- **`/admin/`** back office (solo il gestore imposta) → `admin/index.html` + `admin/admin.js`
- **`/chiosco/`** Bussola Crew, operatività real-time per permesso → `chiosco/`
- **`/ordina`** self-order al tavolo → `ordina/`
- `shared/comanda.js` è il componente comanda incluso in app soci, chiosco e ordina.

Decisione architetturale ferma: **back office solo setup; tutta l'operatività real-time nel Crew.**

## 2. Build / test / consegna (workflow obbligato)
- Versione in **3 file**: `server/version.js` (`var VERSION = "5.90"`), `package.json`,
  `online/package.json` (formato `5.90.0`).
- Build: `npm run build` → `node scripts/build-online.mjs`. Assembla i `<!--#include -->` dei
  quattro `index.html` in `build/*.html`, poi esbuild bundla `build/entry.mjs` →
  `online/bussola.mjs`.
- Test: `npm test` (ribuilda e lancia `node --test tests/*.test.js`) — **345 verdi a v5.90**.
  I test avviano il bundle su porta casuale con DB temporaneo e interrogano le API via HTTP.
- Screenshot: `scripts/shot_v481.mjs` (playwright-core, chromium in `/opt/pw-browsers/`).
  Il server va avviato **detached** (`setsid ... &`) o muore a fine comando bash.
- **Consegna**: zip di `online/` (4 file: `bussola.mjs`, `package.json`, `render.yaml`,
  `.node-version`) — sempre `rm -rf online/data online/node_modules` prima di zippare — **più**
  lo zip dei sorgenti (escludendo `node_modules`, `online/data`, `_raw`, `build`).

## 3. Convenzioni tecniche
- libSQL async: `await db.prepare(sql).get/all/run(...)`.
- Migrazioni: `addIfMissing(tab,col,ddl)` e `db.exec()` dentro `migrate()` in `server/db.js`,
  chiamata da `initSchema()`, che gira anche in testa a `seed()`.
- Backfill una-tantum guardati con `getSetting/setSetting('flag','v1')`.
- **Attenzione** (bug corretto in 4.67): un guard `import.meta.url === file://${process.argv[1]}`
  in un modulo non-entry è **vero anche nel bundle**, perché l'entry è `bussola.mjs`. Va sempre
  accompagnato dal controllo sul nome del file. Era la causa dei campi di default duplicati.
- Permessi (`server/permessi.js`): `requireCap('campi')` ecc. Ruoli: gestore, manager, staff,
  sola_lettura.
- Login demo: gestore/`koine2026` (online: `ADMIN_PASSWORD`), manager/`manager2026`,
  staff/`staff2026`, lettura/`lettura2026`. Tessere demo: `BR-2026-0001` … `BR-2026-0005`,
  `BR-2026-0100`.

## 4. Cosa è stato fatto (da v4.67 a v5.90)
Vedi `CHANGELOG.md`. In sintesi: fix dei campi duplicati; modello prenotazione
"titolare + gli altri si uniscono"; posti fissi decisi dal gestore; regole d'uso
(`max_slot_prenotazione`, `max_pren_settimana`) esposte in back office e verificate dal server;
blocchi campo per torneo/manutenzione/evento; prospetto governance con titolare e partecipanti;
suite di test riscritta.
In **v4.68**: Coppa delle Casate interamente calcolata (niente input manuale), punti congelati
all'archiviazione delle edizioni, pari merito con posizione condivisa calcolata dal server.
In **v4.69**: tre moduli Crew nuovi (Casa di Carta, Campi, Serate), Casa di Carta come zona del
magazzino Centrale, messaggio esplicito a chi non ha permessi operativi. Chiusi i punti 3 e 4.
In **v4.70**: tavoli del Garden come entita' vera (disposizioni per serata, pianta trascinabile
nel Crew, assegnazione dal centro alla periferia, prenotazione cena a due turni). Chiuso il
gruppo C; resta la faccia app della prenotazione (gruppo B).
In **v4.71**: tabellone rifatto nel Crew (gironi affiancati, 3 giornate da 2 partite con data,
foglio gara stampabile da li'); il back office diventa "Tornei" e non replica piu' il tabellone.
In **v5.20**: regole parametriche (`server/parametri.js`, pagina "Regole & parametri", permesso
riservato al gestore), consumazione obbligatoria negli eventi, referenzialita' del database
(`server/referenze.js`). Chiuso il gruppo D.
In **v5.21**: complementi come "di cui" del piatto (tabella `menu_complementi`, colonna
`menu_articoli.complemento`, righe figlie in comanda con `comanda_righe.parent_riga_id`);
dal Bar si ordinano anche i piatti di cucina (`/menu?zona=bar&cucina=1`); "Ordina dal Tavolo"
con numero tavolo precompilato dalla prenotazione; push di conferma della cena; tolte due
diciture dall'app soci. Chiusi i sei punti della lista §8 del vecchio handoff v4.66.
In **v5.22**: il riconoscimento dei condimenti diventa un comando con referto (quanti trovati,
in quali categorie, su quanti piatti) invece di una migrazione silenziosa; abbinamento a
un'intera categoria in un colpo solo.
In **v5.23**: i condimenti si spuntano e basta — nessun prezzo per voce, un supplemento unico
per piatto (parametro `comande_supplemento_complementi`, riga "Supplemento condimenti" in
comanda). Tolta l'eccezione `?cucina=1`: Bar e Garden sono due chiamate allo stesso menu' e la
differenza la fa la colonna "Dove si vende" (Entrambi).
In **v5.24**: cio' che prepara la cucina si vende in tutte e due le aree (migrazione
`menu_cucina_comune`, default in `menuZona`, deduci-punto corretto) — prima i piatti finivano
chiusi nel Garden e al Bar non comparivano. L'ordine al tavolo nell'app passa dalla scansione
del QR (`openQrTavolo`, BarcodeDetector) invece che dal numero digitato; l'ordinazione al
tavolo resta in capo alla Crew.
In **v5.25**: un menu' solo — la Crew usa `/api/admin/menu?ordinabile=1` (stesso elenco del
socio) invece del listino grezzo, e `POST /api/admin/comande` registra i complementi spuntati
dal cameriere con la stessa regola dell'app.
In **v5.26**: niente pulsante quando la serata non ha una CTA (il lunedi' e' giorno di riposo);
se un'azione c'e' ma manca l'etichetta si scrive una parola sensata invece del vuoto.
In **v5.27**: `server/cucina.js` — cio' che prepara la cucina si ordina da OGNI punto per regola
(non piu' per dato: `ordinabileNella`), e prima dell'apertura l'ordine si prende comunque con
l'ora del primo ritiro (`primoRitiro`, colonna `comande.non_prima`, parametri
`cucina_apertura_ora` e `cucina_riscaldamento_minuti`). L'avviso arriva a socio, cameriere e KDS.
In **v5.28**: i condimenti valgono per regola su tutto cio' che esce dalla cucina
(`prendeComplementi`), senza abbinamenti prodotto per prodotto. Al gestore resta una sola
spunta (colonna Compl.). Rimossi tasto 🧩, pannello di abbinamento e rotte
`/menu/:id/complementi` e `/menu/complementi-auto`; la tabella `menu_complementi` non e' piu'
letta da nessuno.
In **v5.29**: `inferStazione` in `server/menucat.js` — chi prepara si deduce da nome/categoria
(migrazione `menu_stazione_dedotta`, import e creazione), perche' i listini arrivano con tutto
marcato "bar" e senza cucina non funzionava niente. La scelta esplicita del gestore vince.
Tolta la tab Comande al Garden: il pannello self-order sta sulla Pianta (`pannelloSelfOrder`,
`collegaSelfOrder`). Il tavolo ha un conto solo, con chiusura di tutte le comande insieme.
In **v5.30**: `PUT /api/admin/menu/:id` e' un aggiornamento PARZIALE — prima ogni Salva dalla
riga del listino azzerava `descrizione` e `magazzino_id`. Un condimento si riconosce anche
dalla categoria (`eCondimento` in `server/cucina.js`), non solo dalla spunta. Corretto
l'indirizzo dei QR tavoli (`/qr-ordina`, non `/../qr-ordina`). Nel Crew solo le discipline
attive; fitness a griglia.
In **v5.31**: il fitness nel Crew usa la STESSA griglia settimanale dell'app soci (stesso
markup `.fitgrid`/`.fitq`, stessi colori di stato). Principio: quando una cosa esiste gia' in
un'app, nell'altra si riproduce uguale — family feeling — invece di reinventarne una versione.
In **v5.32**: traduzioni complete, 540/540 in EN/FR/DE/ES (prima 317). `tests/traduzioni.test.js`
impedisce che il dizionario resti indietro: una `T()` senza traduzione fa fallire `npm test`.
`scripts/audit_traduzioni.mjs` da' il conteggio a mano. NB: i contenuti scritti dal gestore
(titoli serate, cta) vengono dal DB e restano in italiano: servirebbe un campo per lingua.
In **v5.33**: **`server/menu.js` e' il nucleo del menu'** — `daOrdinare({zona})` risponde a
"cosa si ordina qui" e la chiamano TUTTI (app, QR, Crew, stampa). Non aggiungere altre strade:
era il difetto. `diagnosi()` legge i dati veri (tasto Diagnosi nel menu' del Crew). Corretto il
vincolo referenziale su menu_articoli (colonna `menu_id`, non `articolo_id`: non scattava mai) e
l'import "sostituisci" ora si ferma se ci sono comande aperte. `scripts/verifica_ordini.mjs`
percorre la catena ordine → comanda → KDS → scarico magazzino su un DB vero.
In **v5.34**: la diagnosi elenca le **incoerenze** (prodotti la cui stazione non torna con cio'
che sono: nel listino reale 55 voci su 60 erano "cucina", caffe' compreso, per colpa del comando
in massa). `POST /menu/ricalcola-stazione` ripara, con `dryRun` che mostra prima cosa cambia.
`cross-cucina` si ferma se fra le categorie scelte c'e' roba da banco.
In **v5.35**: **i condimenti compaiono dove c'e' la spunta sul prodotto** (colonna
`menu_articoli.con_condimenti`, colonna "Condimenti" nel listino del Crew). NON si deduce piu'
da stazione/categoria: tre tentativi di deduzione sono falliti tutti allo stesso modo. Regola in
`prendeComplementi` (server/menu.js). Migrazione `menu_con_condimenti` accende la spunta su
panini/piatti guardando NOME e CATEGORIA, non la stazione.
In **v5.36**: **`server/registro.js` — registro storico quindicennale** (tabella
`registro_storico`, scheda Registro nel Crew). Si scrive e non si riscrive: una disdetta AGGIUNGE
una riga. Ogni fatto porta chi (`intestatario`), chi ha agito (`autore`) e da dove (`canale`).
Agganciato a: prenotazioni Garden create/cancellate, comande aperte/chiuse/annullate. Da
agganciare ancora: campi, fitness, stage, cdc, coworking. NON aggiungere rotte che modifichino
o cancellino righe del registro. L'avviso della diagnosi menu' compare da solo in cima al listino.
In **v5.37**: corretto `eur is not defined` nell'app soci — il totale dell'ordine non si
aggiornava e "Invia ordine" restava spento, mentre il server calcolava giusto. Da qui
`tests/frontend.test.js`: ogni front-end deve DEFINIRE gli aiutanti che usa (quelli dentro
shared/comanda.js sono in scope chiuso e non valgono). Se un difetto si vede nell'app ma non
nei test, sospettare il browser: le eccezioni nei gestori di evento non si vedono.
In **v5.38**: alcolici (`menu_articoli.alcolico`, `comande.verifica_eta`) — vietati ai minorenni
identificati, avviso alla crew se chi ordina non ha tessera; storno di una singola riga con
motivo obbligatorio (`PUT /comande/righe/:id/storna`) e sostituzione
(`POST /comande/righe/:id/sostituisci`), entrambi nel registro storico; conto diviso per
commensali.
In **v5.39**: separazione di una tavolata **un tavolo per volta** e ritorno esatto ai posti di
partenza (colonna `tavoli.posti_base`: prima si sottraeva, e con una sedia aggiunta in mezzo la
sala non tornava); cambio tavolo a comanda aperta (`PUT /comande/:id/tavolo`, nel registro con
da/a); storno di una riga dalla scheda della cucina (stesso endpoint della sala).
`scripts/verifica_tavoli.mjs` prova unione e separazione su un DB vero.
In **v5.40**: il KDS non riceve piu' la riga "Supplemento condimenti" (e' denaro, non cibo) e
mostra i condimenti RIENTRATI sotto il piatto, con un tasto solo. Regola: in cucina arriva solo
cio' che ha un `menu_id`.
In **v5.41**: `PUT /tavoli/layout/:id` e' PARZIALE — cancella i tavoli assenti solo con
`completo: true` (lo manda l'editor della disposizione). Prima salvare dalla sala cancellava i
tavoli nascosti perche' uniti. Conferma obbligatoria su "Annulla comanda". Parametri
`tavoli_posti_persi_unione`, `sala_soglia_buona`, `sala_soglia_difficile`; il turno porta
`serata` (livello, %, max_tavoli_uniti, consiglio).
In **v5.42**: intestazioni del file menu' riconosciute in modo tollerante (`normIntestazione`),
rifiuto se manca del tutto il prezzo (i nuovi entravano a zero in silenzio), export con
attivo/alcolico/condimenti/complemento in si-no e reimportabile, `PUT /api/admin/menu` salva
piu' righe in un colpo (il Crew accumula le modifiche), divieto di spostare una comanda da o
verso una tavolata unita.
In **v5.43**: tavoli predefiniti QUADRATI da 4; tab "Organizzazione sala"; il ripristino della
pianta dice ad alta voce perche' rifiuta. Corretto l'handler orfano che svuotava la tab Menu':
`tests/frontend.test.js` ora verifica che ogni `$('#x').onclick` abbia un `id="x"` disegnato —
un handler agganciato al vuoto NON toglie un pulsante, blocca tutta la funzione.
In **v5.44**: il rifiuto del ripristino sala ELENCA le prenotazioni che bloccano (prima diceva
solo quante) e chiarisce che annullare una comanda non libera il tavolo. Etichette del registro
storico completate, con ripiego leggibile per i fatti futuri.
In **v5.45**: `PUT /comande/righe/:id/non-servita` — FATTO ma non servito: fuori dal conto ma la
merce SI SCARICA (lo storno invece no: sono due cose diverse, non unificarle). Avviso dalla
cucina alla sala (`comande.avviso_cucina`): tavolo rosso con "!", messaggio in cima al pannello,
si spegne solo con "Ho avvisato il cliente". Conto diviso per persone sedute, arrotondato per
eccesso al centesimo. Spostamento su tavolo prenotato per un turno successivo: permesso, con
avviso di chi ci sara'.
In **v5.46**: la spunta Compl. mostra il verdetto vero — `GET /admin/menu` restituisce `e_condimento` e
`supplemento`. Tolti due tasti morti (Salva per riga, cestino senza handler);
`tests/frontend.test.js` ora cerca anche i `<button data-x>` che nessuno ascolta.
In **v5.47**: quanto costa condire lo dice il PREZZO scritto sui condimenti (`quantoCostaCondire`
in server/menu.js), non un parametro nascosto — il parametro e' solo la rete quando i condimenti
non hanno prezzo. NON bloccare quel campo: uno o quattro allo stesso prezzo e' una scelta
commerciale del gestore. Prezzi diversi fra condimenti: vale il piu' alto, e la diagnosi lo dice.
In **v5.48**: **`server/mail.js` — le e-mail partono davvero** (Resend/Brevo via HTTP, nessuna
libreria nuova). Env: `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`. Senza, modo
"console": la mail finisce nei log. OTP irrobustito: 3 richieste/15 min per indirizzo, 5
tentativi poi il codice si brucia, risposta identica per indirizzi noti e ignoti,
`soci.email_verificata` acceso da chi entra col codice. Registrazione: mail di benvenuto con la
tessera. `GET/POST /api/admin/posta/stato|prova` per vedere e provare.
In **v5.49**: `POST /comande/:id/chiudi` ora SCARICA il magazzino (prima lo faceva solo il cambio
di stato: 8.400 comande chiuse e zero scarichi in simulazione). Simulazione di stagione:
`scripts/stagione-3-scenari.mjs` + `scripts/estrai-simulazioni.mjs`, su DB dedicati in
/home/claude/simdb. MAI simulare sul DB di produzione.
In **v5.50**: la vista Banco usa `/kds?stazione=bar` (prima filtrava per `zona==='bar'`): un
cocktail ordinato a un tavolo non lo vedeva NESSUNA postazione. REGOLA: le code di lavoro
seguono CHI PREPARA, mai la zona. L'incasso invece resta alla zona: il conto del tavolo si paga
al tavolo.
In **v5.51**: `abilitaFold` (Crew e back office) cerca il titolo anche dentro una riga — se si
aggiunge un tasto accanto a un h3, il pannello NON deve smettere di comprimersi. "Comprimi
tutto" aggiunto anche al Crew. Tolto il numero del chiosco dai numeri rapidi.
In **v5.52**: il numero legale dei campi ora si VEDE nell'app (quanti giocatori servono, quanti
mancano, entro che ora): `/campi/partite-aperte` restituisce `numero_legale`. Prima la regola
decadeva la prenotazione senza che nessuno l'avesse mai letta.
In **v5.53**: su una prenotazione RISERVATA il titolare (o la crew) dichiara chi gioca con lui —
`POST/DELETE/GET /api/partite/:id/giocatori` e `POST /api/admin/campi/partite/:id/giocatori`.
"Solo io" = chiuso agli estranei, NON "gioco da solo": prima i compagni non esistevano da
nessuna parte. Soci con tessera (valgono per la Coppa), ospiti col solo nome.
In **v5.54**: la regola che nasconde i pannelli chiusi ora e' `!important` (le righe con
display:flex INLINE vincevano, e "Comprimi tutto" sembrava rotto). `garden_tavoli` e
`garden_posti_per_tavolo` sono parametri. **`verificaSpazio()` in server/tavoli.js**: la pianta
riportata in METRI (`garden_larghezza_m`, `garden_profondita_m`, `garden_ingombro_tavolo_m`,
`garden_corridoio_m`) dice se i tavoli ci stanno, quali sono troppo vicini e quanti ce ne
starebbero. Rotta `GET /api/admin/tavoli/verifica-spazio`.
In **v5.55**: disdetta campo da app (`POST /api/partite/:id/annulla`) e dal banco
(`POST /api/admin/campi/partite/:id/annulla`) — prima non si poteva disdire da nessuna parte.
Verdetto dello spazio separato in "spazio" e "disposizione" (prima "ce ne stanno 16 / non ci
sta" sembrava una contraddizione). La griglia predefinita dispone al PASSO REALE (ingombro +
corridoio), non in percentuale. Lo Stage ha i suoi parametri: `stage_larghezza_m`,
`stage_profondita_m`, `stage_ingombro_seduta_m`, `stage_passo_fila_m`.
In **v5.56**: le fasce gia' finite hanno stato `passato` e la prenotazione all'indietro e'
rifiutata. `adessoInSicilia()` e `fasciaPassata()` in server/tavoli.js: l'ora e' SEMPRE quella
di Europe/Rome, mai quella del server (UTC su Render, due ore di scarto).
In **v5.57**: tre stati per le fasce — `passato` (finita), `in_corso` (cominciata: dall'app non
si prenota, si chiede al banco), libera. `fasciaIniziata()` e `scadenzaGiaPassata()` in
tavoli.js. La risposta di `prenota`/`partita` porta `avviso` quando la scadenza del numero
legale e' gia' passata: senza, il socio leggeva "Fatto!" e dieci minuti dopo non aveva niente.
In **v5.58**: nel testo della verifica spazio le parole seguono l'ambiente (sedute per lo Stage,
mai "tavoli") e l'ARREDO e' escluso dal conto — il palco non e' un posto e non deve chiedere
spazio di passaggio.
In **v5.59**: disdetta fitness dall'app (la rotta c'era, nessuno la chiamava) con regola sul
tempo: `fitness_disdetta_minuti` (30). Oltre il margine l'iscrizione e' annullata ma
`fitness_prenotazioni.dovuta=1`, e il banco la vede in "Disdette tardive" con il tasto incassa.
L'avviso sta nel pannello PRIMA dell'iscrizione, non dopo.
In **v5.60**: comanda gia' pagata = 4 minuti di anticipo in coda (`PAGATA_BOOST_MS` in
selforder.js). Copia di cortesia del conto via e-mail alla chiusura (`inviaRicevuta` in mail.js,
campo facoltativo nella cassa): NON e' lo scontrino, e il testo lo dice — non togliere quella
avvertenza. Il conto del tavolo ora chiude via `/chiudi` con metodo di pagamento, non piu' col
cambio di stato.
In **v5.61**: la copia del conto parte SOLO se l'operatore scrive un indirizzo. L'automatico ai
soci e' un parametro spento (`ricevuta_email_automatica`): acceso, sono 1.700 mail a stagione
nello scenario ottimale, 8-9 a testa.
In **v5.62**: `GET /api/estratto-conto` — spese e servizi gratuiti (a zero) di una tessera. NON
chiamarla /tessera/estratto: `/tessera/:code` la intercetta. Copre solo cio' che e' passato
dalla tessera (nella simulazione: 1.100 comande su 6.063), e la nota lo dichiara.
In **v5.63**: **`server/tessera.js` — prepagata**. DUE interruttori: `tessera_prepagata`
(parametro generale) e, per i MINORENNI, `soci.prepagata_autorizzata` dato in anagrafica con
chi/quando. Saldo in `tessera_movimenti` (saldo scritto in ogni riga). Metodo di pagamento
"tessera" scala il credito. Il credito e' un DEBITO verso il socio, non un ricavo:
`GET /api/admin/tessere/debito` dice quanto si deve ancora.
In **v5.64**: PIN per pagare con la tessera (`soci.pin_hash`). I numeri di tessera sono
PROGRESSIVI e stampati sulla card: identificano, non autorizzano. 5 tentativi e si blocca;
soglia `tessera_pin_oltre` (0 = sempre).
In **v5.65**: `/t/:code` (in build/entry.mjs) e' l'indirizzo unico della tessera: si stampa nel
QR e si scrive nel tag NFC. `leggiTessera()` estrae il numero da testo, URL o QR — i tre
supporti convivono, non si sceglie.
In **v5.66**: numerazione **RB-000123-4** (sigla, progressivo, cifra di controllo) — NIENTE anno:
la tessera e' di una persona, non di una stagione. Tabella `tessere` (code, socio_id, stato):
i numeri vecchi restano risolvibili ma revocati, perche' sono scritti nelle prenotazioni
passate. `POST /admin/soci/:id/nuova-tessera` con motivo e azzeramento credenziali. I codici
`BR-2026-…` restano validi.
In **v5.67**: **modulo Tennis** — `campi.gestione` ('chiosco'|'tennis'), `campi.prezzo_ora` su
TUTTI i campi, tabella `campi_tariffe` (fasce con orario e tipo_uso campo/lezione),
`server/tariffe.js` calcola il prezzo. Permesso `tennis`; il gestore app resta supervisore.
Rotte `/admin/tennis/*`. REGOLA: senza listino il campo e' GRATUITO, non si inventa un prezzo.
ATTENZIONE: le migrazioni una-tantum sui campi devono girare DOPO `campi_default_v1`.
In **v5.68**: corretto `fasce is not defined` (i campi non erano piu' prenotabili: l'eccezione
spezzava openCampi fra il disegno e gli handler). `allowedZones()` in chiosco.js deve elencare
OGNI modulo nuovo, altrimenti esiste ma non lo vede nessuno. `tests/frontend.test.js` cerca ora
anche le variabili usate in `(nome || [])` e mai dichiarate.
In **v5.69**: area tennis = SOLO tennis, beach tennis, beach volley (touch tennis e pickleball
sono del chiosco). Nessun tetto settimanale ne' quota sui campi a pagamento. Il gestore tennis
configura i suoi campi, li blocca e prenota al banco: `PUT /admin/tennis/campi/:id`,
`/admin/tennis/blocchi`, `POST /admin/tennis/prenota` — sempre limitati a `gestione='tennis'`.
NB: `campi_blocchi` usa `slot_da`/`slot_a`, `partite_aperte` usa `titolare_socio_id`.
In **v5.70**: il modulo tennis contiene la gestione COMPLETA — creazione/configurazione campi
(`POST/PUT/DELETE /admin/tennis/campi`), giornata, prenotazione al banco, blocchi, listino,
incassi. I campi `gestione='tennis'` NON si amministrano dalle rotte generali `/admin/campi/:id`
(409, salvo `forza_supervisore`), e quelle creano sempre campi 'chiosco'.
In **v5.71**: gli INCASSI dei campi a pagamento sono invisibili al gestore dell'app (ruolo
'gestore'): niente importi nella giornata, tabella `tennis_incassi` fuori dal registro storico,
`/admin/tennis/incassi` 403 al gestore. NON reintrodurre `registra()` con importo per gli
incassi campi. Tornei KO in `server/tornei.js`: posti 4/8/16/32 (potenza di due, niente bye),
sorteggio cieco una volta sola, il vincitore sale da solo.
In **v5.72**: DUE permessi per i campi a pagamento — `tennis` (gestore: listino + incassi) e
`tennis_campi` (delegato: prenota/blocca, NIENTE listino ne' incassi). `vedeIncassi(req)` e
`requireTennisOperativo` in routes/admin.js. `/admin/campi` e `/admin/campi/prenotazioni`
escludono `gestione='tennis'` per chi non e' gestore. Pannello "Le mie spese" nella tessera
(`openSpese` in app.js) sull'estratto conto.
In **v5.90**: REGOLA — un permesso nuovo va aggiunto in TRE posti, non uno: `permessi.js`
(elenco), `CAP_LABEL` in admin.js (etichetta) e **`allowedZones()` in chiosco.js** (senza,
l'utente entra e non vede nessun modulo). E la SCHERMATA deve nascondere cio' che il server non
manda: un "Incassato 0,00" a chi non ha diritto sembra un dato. `DELETE /auth/notifiche/:id`
per archiviare un avviso.
In **v5.90**: `server/casate_composizione.js` — composizione automatica delle casate.
`soci.sesso` (quota), `soci.nucleo` (mai separato), `soci.gioca_coppa` (niente assegnazione
d'ufficio), `casate.schierata`. ORDINE DEI VINCOLI: nucleo > numero legale > under14/over70 >
quota rosa > fasce d'eta'. Le fasce sono un criterio, NON una quota. Quando un vincolo si rompe
va DICHIARATO con la causa complessiva, non solo il sintomo per casata.
In **v5.90**: casate da `coppa_casata_min` (3) a `coppa_casata_posti` (12), TUTTE schierate.
I vincoli (under14, over70, quota) sono PROPORZIONALI alla dimensione e tassativi solo a casata
piena — non pretendere 2+2+6 da una casata di quattro. Capitano e vice: `proponiCapitani()`
propone per REPERIBILITA' e dice il perche'; la nomina resta un gesto della casata.
In **v5.90**: i parametri hanno TIPI veri — `data`, `dataora`, `ora`, `telefono`, `testo` — e
vanno aggiunti in DUE posti: il disegno del campo in admin.js e la lista in `normalizza()` di
parametri.js. Se manca il secondo, il valore si scrive e sparisce al salvataggio.

## 5. Decisioni aperte (da porre a Ercole)

**RISOLTE in v5.20**: il tetto dei campi (ora quattro regole anti-monopolio parametriche) e
l'Albo d'Oro (chiusura stagione con podio congelato e simbolo del residence alla campionessa).

Il **tetto settimanale è per campo**. Con 3 prenotazioni su ciascuno dei 5 campi un socio arriva
comunque a 15 a settimana. Se l'obiettivo è evitare il monopolio, valutare un **tetto
complessivo** oltre a quello per campo. Domanda già posta, risposta non ancora data.

`archiviaEdizione` scrive nell'Albo d'Oro come vincitore il primo della **classifica combinata
dei gironi**, che può non coincidere con il vincitore della **finale**. Va deciso quale dei due
è quello giusto (probabilmente il secondo).

## 6. Prossimi passi dal backlog
- Magazzino Fasi 2-4 sono fatte (v4.53–4.55); resta il **calendario/alert automatici** già
  coperto — verificare.
- Ondata E: app residence — click casata → appartenenti + capitano; icone; ordinazione divisa
  Bar/Garden; prenotazione tavoli 2 turni.
- Ondata F: eventi con consumazione obbligatoria; referenzialità DB.
- Ondata G: maquillage grafico (note in `claude/BUSSOLA_app_residence_note_grafiche.md`).
- Backlog: sorgente su GitHub (**ora particolarmente urgente**), pagamento self online,
  username `nome.cognome`, QR tessera scansionabile.

## 7. Mappa del codice
- `server/db.js` — schema, `migrate()`, backfill, helper `getSetting/setSetting/audit`.
- `server/routes/public.js` — API dell'app soci, **incluso tutto il blocco campi**.
- `server/routes/admin.js` — API back office: campi, blocchi, prospetto, magazzino, eventi…
- `server/routes/authuser.js` — login socio (tessera / OTP e-mail).
- `server/fitness.js` — **area fitness**: corsi, generazione lezioni, minimo iscritti.
- `server/geo.js` — **lettura delle posizioni** da coordinate e link (Google, Waze, Apple, OSM).
- `server/parametri.js` — **regole di funzionamento**: registro, valori, dipendenze.
- `server/referenze.js` — **referenzialita'**: cosa blocca una cancellazione.
- `server/registro.js` — **memoria lunga**: cosa e' successo, a nome di chi, chi lo ha chiesto.
- `server/menu.js` — **il nucleo del menu'**: cosa si ordina in quale punto, e i condimenti.
- `server/cucina.js` — **orario della cucina**: da che ora si consegna.
- `server/tavoli.js` — **pianta del Garden**: layout, distanza dal centro, assegnazione.
- `shared/comanda.js` — **il menu' come si ordina**: categorie, ricerca, complementi a spunta.
- `server/coppa.js` — **graduatoria della Coppa**: sorgenti, ricalcolo, posizioni ex aequo.
- `server/{auth,seed,tournament,contest,selforder,permessi,crypto,push,pwa,menucat,qrcode}.js`
- `build/entry.mjs` — entry del bundle (monta i router, serve i quattro front-end).
- `tests/api.test.js` — 345 test. `scripts/build-online.mjs`, `scripts/shot_v481.mjs`.

## 8. Stato consegne
- Deploy: **bussolav5.90.zip** (solo `online/`, pulito). Health mostra `"version":"5.90"`.
- Sorgenti: **bussola-src-v5.90.zip**. 345 test verdi.
- Su Render servono le variabili: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD`,
  `STAFF_PASSWORD`, `KOINE_ENC_KEY`, `VAPID_PUBLIC`/`VAPID_PRIVATE`/`VAPID_SUBJECT`.

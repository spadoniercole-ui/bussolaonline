# Bussola Residence — CHANGELOG

## v5.90 — Le maiuscole, e l'host che non avevi chiesto

### La traduzione si fermava sulle maiuscole
Nel tuo database i tipi di rifiuto sono scritti **"PLASTICA"**, non "Plastica". Il vocabolario
cercava la forma esatta, quindi quelle voci restavano in italiano **in mezzo a tutto il resto
tradotto** — SUMMER, Mon, after 23:30 funzionavano, i tipi no.

Ora il confronto ignora maiuscole e minuscole e restituisce il risultato **nella stessa forma
dell'originale**: "PLASTICA E LATTINE" → "PLASTIC AND CANS". Verificato riscrivendo i tipi in
maiuscolo nel database e ricontrollando la schermata.

### 🔴 Chiunque fosse residente poteva gestire immobili
La sezione "Le mie case" compariva a tutti i profili `residente` e `socio_residente`,
**ignorando il flag host**. Il flag esisteva ed era corretto: era l'interfaccia a non guardarlo.

Non è un dettaglio: con quella sezione arriva la responsabilità dei dati dei propri ospiti, che
è una cosa seria e non un di più. Ora la vede **solo chi ha dichiarato di volerla**.

E si attiva dal proprio profilo, con un gesto consapevole: nella tessera c'è **Case vacanza ·
Attiva**. Si può anche spegnere — ma non finché ci sono case collegate, perché spegnere e
lasciare le strutture in giro sarebbe peggio che tenerlo acceso. Chi non vive nel residence non
può attivarlo affatto.

### ⚠️ Gli zip dei sorgenti erano incompleti
Escludevo la cartella `build/` credendola generata: contiene invece **sorgenti** (`entry.mjs` e
i quattro modelli HTML). Senza, `npm run build` fallisce. Il pacchetto **COMPLETO** è verificato
da zero: scompattare, `npm install`, `npm run build`, `npm test`.

### Test
**345 verdi.**

## v5.89 — Anche i dati parlano la lingua dell'app

Il motivo per cui il titolo era tradotto e le righe no: **quelle righe non sono testi dell'app,
sono dati del database**, scritti dal gestore. Il dizionario dell'interfaccia non le vede
nemmeno.

Ora c'è un vocabolario dei termini che si applica ai dati al momento di mostrarli, nelle stesse
cinque lingue dell'app. In tedesco: *Sommer · Biomüll · Plastik und Dosen · Ärztlicher
Notdienst · nach 23:30*.

### Cosa si traduce, e cosa no
Si traducono i **vocabolari chiusi**, che sono piccoli e coprono tutto quello che c'è davvero
nella guida: tipi di rifiuto, giorni, stagioni, categorie di servizio, descrittori dei luoghi
(*cultura*, *natura*, *barocco*, *Area marina protetta*).

**I nomi propri restano**: Ortigia, Cavagrande del Cassibile, Duomo di Siracusa. Ma la parte
descrittiva accanto si traduce — *"Centro storico di Siracusa · cultura"* diventa *"Old town of
Siracusa · culture"* senza che nessuno debba riscrivere quella frase cinque volte.

E le frasi con un orario dentro si traducono a pezzi: *"dopo le 23:30"* → *"after 23:30"*,
*"Dalle 14:00 alle 17:00 — riposo per tutti"* → *"From 14:00 to 17:00 — rest for everyone"*.
Serviva, perché l'orario cambia e la frase no.

### Un test che tiene il vocabolario onesto
Se una lingua ha un termine e un'altra no, quella riga resterebbe in italiano **in mezzo alle
altre tradotte** — peggio che non tradurre niente, perché sembra un errore di dati. Il test
verifica che le quattro lingue abbiano le stesse voci, e che i termini dei dati iniziali ci
siano tutti.

### Test
**342 verdi.**

## v5.88 — Una disposizione appartiene alla sala in cui è nata

Trovato: **"✚ Nuova disposizione" non salvava l'ambiente**. Ogni disposizione creata nasceva
nel Garden, qualunque fosse la sala da cui la si creava.

Quindi: si va nello Stage, si entra in modifica, si crea una nuova disposizione della platea —
e quella platea, con le sue sessantasei sedute da un posto e il palco, finisce **fra le piante
del Garden**. Chi apre il Garden si trova a gestire sedie e non capisce da dove siano arrivate.
È esattamente il percorso che hai fatto.

Ora l'ambiente si scrive alla creazione, e si prende **dalla sala in cui ci si trova**: chi
crea una disposizione la crea sempre dove sta. Se si copia una disposizione esistente senza dire
altro, la copia segue l'originale — copiando una platea si ottiene una platea, non una pianta
del Garden.

Due test: una disposizione creata nello Stage compare fra quelle dello Stage e **il Garden non
se ne accorge nemmeno**.

### Come rimettere a posto il tuo database
La pianta del Garden con il palco è quella disposizione finita nel posto sbagliato. Dal modulo
Garden, **Disposizione → Standard ★** la rimette com'era; se anche la Standard è stata
sovrascritta, **↺ Ripristina predefinita** la ridisegna da capo — e ora rispetta anche le misure
e i passaggi.

### Test
**341 verdi.**

## v5.87 — La pianta ha le proporzioni della sala

### Il pulsante che spariva
*"Non disponibile"*, nella scheda della convocazione, aveva testo bianco su un pulsante che
nello stile nuovo è diventato bianco. Ora dentro le schede scure il pulsante secondario è
trasparente col bordo bianco: un contorno si vede sempre.

### La mappa non è più un rettangolo qualsiasi
Prima il riquadro era alto 64vh e largo quanto il pannello, sempre: una sala quadrata e una
lunga venivano disegnate uguali, e i tavoli finivano dove non sono. Chi guarda la pianta non
riconosceva il posto in cui lavora.

Ora il riquadro prende il **rapporto vero** delle misure — quelle del *"ci sta davvero?"*.
Verificato: 24×9 m → riquadro 1082×406 (rapporto 2,67); 8×20 m → 281×702 (rapporto 0,40).

Se le misure non ci sono resta l'altezza di prima: meglio un rettangolo generico che una
proporzione inventata.

### E i tavoli scalano col riquadro
Conseguenza scoperta guardando: in una sala stretta il riquadro è largo trecento pixel, e
tavoli da cinquanta si accavallavano l'uno sull'altro. Ora la misura scala, ma non sotto la
metà — più piccoli di così il numero non si legge, e una pianta illeggibile non serve a nessuno.

Il calcolo si fa **prima** di disegnare: misurare il riquadro non funzionava, perché quando quel
codice gira il riquadro non è ancora nella pagina.

### Test
**339 verdi.**

## v5.86 — Abbandonata non vuol dire pagata

Il difetto non stava nell'estratto conto: stava tre passi più a monte, ed è più serio di come
si vedeva.

Una comanda mai lavorata, decaduta dopo le ore impostate nel parametro, veniva marcata
**"chiusa"** — e nel sistema "chiusa" significa una cosa sola: **pagata**. Da lì in poi quella
riga si comportava come un incasso vero.

### Cosa toccava
- **L'estratto conto del socio**: € 3,50 per qualcosa che non ha mai avuto. È quello che hai
  visto.
- **Il fatturato del periodo**: il riepilogo sommava tutte le comande "non annullate", quindi
  anche quelle. Un riepilogo che conta soldi mai entrati è peggio di nessun riepilogo.
- **Da oggi anche il magazzino**, visto che dalla 5.49 la chiusura scarica le giacenze: un altro
  paio di settimane e sarebbe uscita merce che nessuno ha mai preparato.

### Cosa cambia
La comanda abbandonata ora si **annulla**, con il motivo scritto nel registro: *"mai lavorata:
abbandonata dopo 6 ore"*. Niente incasso, niente scarico. Se poi qualcuno l'aveva davvero
servita, si riapre — molto meglio di un ammanco che nessuno sa spiegare.

E due controlli in più, perché lo stato da solo non basta come prova: **l'estratto conto e il
riepilogo contano solo le comande con un pagamento registrato**, non quelle semplicemente
chiuse.

Verificato sul caso vero: comanda invecchiata di nove ore → stato *annullata*, estratto conto a
zero.

### Test
**339 verdi.**

## v5.85 — Sei correzioni dalle tue schermate

### La comanda non si perde più per un tocco fuori bersaglio
Un clic sullo sfondo chiudeva la finestra e **cancellava tutte le righe scelte**. Ora la
comanda è una finestra "protetta": chiede conferma. Le schede di sola lettura si chiudono come
prima, perché lì la chiusura rapida è comoda.

### Al Garden si ordina tutto il menù
Il menù era filtrato per zona, quindi al tavolo non comparivano i prodotti del bar e il
cameriere doveva dire *"quello lo vendiamo solo al bar"* — una frase che descrive la nostra
organizzazione, non il desiderio di chi ordina. Ora c'è tutto: le comande sanno già andare alla
stazione giusta, il cocktail al banco e il panino in cucina.

### Il piatto finito si segna dalla comanda
Accanto al **+** c'è una **✖**: segna il prodotto esaurito e lo toglie dal menù per tutti,
subito. Uscire dalla comanda per andare nel menù significava lasciare il cliente ad aspettare —
e intanto un altro tavolo ordinava lo stesso piatto.

### Alla Casa di Carta non si ordina dal tavolo
Via il tasto **Ordina**: lì si gioca, e chi vuole qualcosa va al banco. Libera, unisci e
trasferisci restano, perché i tavoli sono tavoli ovunque.

### 🔴 Il socio non poteva disdire un tavolo
Non esisteva **nessuna rotta** per annullare una prenotazione tavolo dall'app. Si prenotava e
poi si doveva telefonare; se non si telefonava, il tavolo restava occupato tutta la sera da
qualcuno che non veniva, e in sala si vedeva un nome su un tavolo vuoto senza sapere se
aspettare. È il difetto dietro la tua immagine 2.

### 🔴 Ci si iscriveva a lezioni già tenute
Il 30 agosto si poteva prendere posto a una lezione di **luglio**: il calendario la mostrava
ancora perché la griglia parte dalla prima settimana del corso, e nessun controllo guardava la
data. Ora la lezione finita rifiuta, dicendo quando si è tenuta.

### L'elenco delle prenotazioni si apre
Oltre tre voci si mostrano le prossime tre e le altre stanno dietro *"Vedi tutte"*: con dieci
prenotazioni l'elenco mangiava la home.

### Test
**337 verdi.**

## v5.84 — La lingua prima di tutto

Avevi ragione, ed era peggio di come l'hai descritto: nel gate **non c'era nessun selettore di
lingua**, e i testi erano scritti fissi nell'HTML. La barra in alto col tasto IT sta *dentro*
l'app, quindi chi non è ancora entrato non la vede.

Un ospite straniero inquadrava il QR, trovava *"Codice tessera"* e *"Non hai un account?
Registrati"* in italiano, e si fermava lì. Il percorso di registrazione tradotto — che c'era —
non lo raggiungeva nemmeno.

Ora le cinque lingue sono **in cima al gate, prima del benvenuto**, e i testi cambiano tutti:
*Willkommen · Kartennummer · Eintreten · Noch kein Konto? Registrieren*. La scelta si propaga a
tutta la registrazione.

### Un difetto della rimozione di KOINÈ
La sostituzione automatica aveva lasciato **"Ich bin-Mitglied"** e **"Soy socio de"**: pezzi di
frase appesi al nulla. In italiano non si vedevano, in tedesco sì. Corretti a mano — le lingue
non si sistemano con una regex — e c'è ora un test che cerca i segni della mutilazione:
trattino orfano attaccato a una parola, doppio spazio.

Il test ha dovuto imparare due eccezioni vere: in tedesco *"Vor- und Nachname"* è corretto, e
alcune voci finiscono con una preposizione **apposta** perché il codice le completa
(*"La cucina consegna dalle"* + l'orario).

### Il gate nello stile nuovo
Squadrato come il resto, insieme a fogli, campi e chip.

### Test
**335 verdi.**

## v5.83 — Lo stesso linguaggio su tutte le app, e via KOINÈ

Rilascio unico, come chiesto: forma squadrata, bordi da 2 px, niente ombre, azioni a blocco
pieno scuro. Ora vale anche per **Bussola Crew** e per il **back office**, non solo per l'app
dei soci. Due estetiche diverse fra le app dello stesso residence non aiutano nessuno, e quello
che regge la luce in spiaggia regge anche al banco.

### KOINÈ tolto — con una distinzione
**Testi visibili**: via ovunque. *"Sono socio KOINÈ"* → *"Sono socio"*, l'intestazione del gate,
la locandina delle serate, il manifesto della PWA, i commenti dei sorgenti. Un test rilegge i
quattro file e fallisce se ricompare.

**Riferimenti tecnici**: qui rinominare a secco avrebbe fatto danni, e non l'ho fatto.
- `KOINE_DB`, `KOINE_ENC_KEY`, `KOINE_ENV` sono **variabili impostate su Render**: cambiarle nel
  codice senza cambiarle là avrebbe spento il sito al primo riavvio. Restano.
- `window.KOINE_API` ora accetta anche `window.BUSSOLA_API`, e continua a leggere il vecchio
  nome: potrebbe essere già scritto in una pagina che non controlliamo.
- Le chiavi salvate sul telefono passano da `koine_` a `bussola_` **travasando la vecchia**:
  rinominarle a secco avrebbe fatto perdere tessera, lingua e modo semplice a tutti quelli che
  hanno già l'app installata.
- Nome del file di backup e contatto delle notifiche: cambiati, non rompono niente.

### Un difetto che si è visto solo guardando la schermata
Nei parametri **"Accessibilità" compariva due volte**. In un caso la *à* era il carattere
singolo, negli altri una *a* seguita dall'accento combinante: identiche a vedersi, due stringhe
diverse per il raggruppamento. C'è ora un test che confronta i gruppi normalizzati.

### Test
**334 verdi.**

## v5.82 — Forma squadrata, colori pochi, e il sole

Restyle della forma e del colore, non delle funzioni. Il criterio non è il gusto: **questa app
si usa in spiaggia, col sole in faccia e lo schermo al minimo di luminosità.**

### Il contrasto misurato, non valutato a occhio
Rapporto WCAG: 4,5 è il minimo, 7 per stare comodi. Sotto il sole la soglia pratica sale.
Misurando i colori di prima è saltato fuori dove stava il problema:

| | prima | adesso |
|---|---:|---:|
| testo su carta | 14,4 | **18,5** |
| testo tenue | 6,5 | **9,1** |
| azione (oro su carta) | **5,4** | — |
| azione (bianco su oro) | **5,9** | — |
| azione (bianco su navy) | — | **14,6** |
| avviso (bianco su rosso) | — | **7,5** |

Erano proprio i **colori delle azioni** a stare sotto: leggibili in casa, faticosi in spiaggia.
L'oro resta come accento e bordo, non più come fondo di un pulsante da leggere. Le azioni sono
blocchi pieni scuri con testo bianco.

### La forma
Angoli quasi vivi (4 px), **bordi da 2 px**, nessuna ombra. Le ombre morbide spariscono sotto il
sole: quello che resta è il bordo, quindi il bordo deve esserci ed essere spesso. L'eroe è un
blocco di colore pieno — un gradiente al sole diventa una macchia e il testo bianco ci
galleggia sopra.

Area di tocco da **56 px**: al sole e con le mani bagnate serve larga.

### Due regressioni introdotte e corrette subito
Appiattendo l'eroe, *"Prenota un tavolo"* era diventato blu su blu — invisibile. Dentro l'eroe
l'azione ora è bianca. E il tasto **Tessera**, il più toccato di tutti, era rimasto l'unica cosa
tonda e dorata: ora è un blocco bianco pieno.

### Test
**332 verdi.** Il resto dell'app segue una schermata alla volta.

## v5.81 — La home nello stile nuovo (prima schermata)

Una schermata alla volta, come deciso. Questa è la home.

### La griglia dei servizi
Otto voci in una tabella a due colonne con bordi netti, invece di otto cartoncini separati.
Titolo grande, sottotitolo sotto, icona piccola accanto al testo: nella griglia stretta la
larghezza deve andare alle parole, non all'emoji.

Sono diventati **bottoni veri** invece di `div` con `role="button"`: tastiera e lettori di
schermo li trattano per quello che sono senza doverglielo spiegare.

### 🗓 "La tua prenotazione", in cima
È la cosa migliore del mockup, e non è grafica: *"cosa ho oggi?"* è la prima domanda di chi apre
l'app, e la risposta stava sparsa fra tre schermate — Campi, Fitness, Garden. Ora è in cima,
con l'orario e il tasto per annullare. Fino a quattro voci, poi *"e altre N"*.

### Le tre correzioni al mockup
- **Il rosso resta agli avvisi.** Nel sistema significa *qualcosa non va*: tavolo oltre i dieci
  minuti, ombrellone non reso, fascia scaduta. Se diventasse il colore di "Prenota", quel
  significato si perderebbe proprio quando serve. Le azioni restano oro.
- **Niente hairline e maiuscolette da dieci pixel**: l'app la usano soci di ottant'anni, e
  abbiamo un modo semplice apposta. Bordi visibili, testo che si legge.
- Il mockup mostrava *"tessera BR-4192"*: è il vecchio formato, oggi è `RB-000123-4`.

### Test
**332 verdi.**

## v5.80 — Spiaggia: i cinque difetti

### 1. File e colonne
Le misure ora chiedono anche **file e colonne**, come le altre piante. Se non le dichiari si
ricavano dalle misure e dal passo — non da una radice quadrata che non somiglia alla spiaggia.

### 2. Gli ombrelloni si toccano
Ognuno apre una scheda: chi c'è sotto, quanto manca, e i tre gesti che servono — **assegna al
banco** (per chi non ha l'app, altrimenti la spiaggia diventa dei giovani), **libera**, **togli**.

### 3 e 4. Niente ombrelloni senza misure, e niente oltre la capienza
Erano i due difetti veri. Creare ombrelloni in una piazzola di cui non si sa niente significa
disegnare una spiaggia che non esiste — e infatti avevi riempito tre piazzole senza aver messo
una misura. Ora il server rifiuta: *"Prima le misure di Caltagirone: senza, non si sa se gli
ombrelloni ci stanno"*.

E non se ne creano più di quanti ce ne stanno: *"in Grande (22×16 m) ce ne stanno 12 lasciando
1,5 m di passaggio: ne hai già 12 e ne stai aggiungendo 40"*. Il rifiuto arriva **prima** di
crearli, non dopo.

C'è anche **🗑 Svuota**, perché sbagliare il numero deve essere rimediabile — ma non mentre c'è
gente sotto.

### 5. I colori dicono quanto manca
Verde libero · arancione prima metà della fascia · marrone seconda metà · rosso ultima mezz'ora
· e **bordo spesso con "NON RESO"** per chi non ha rilasciato a fine fascia. Ogni ombrellone
occupato mostra i minuti che mancano.

Il criterio è: chi guarda la piazzola vuole sapere **dove si libererà qualcosa fra poco**. È
l'unica cosa che serve a chi aspetta.

### Un difetto trovato mentre lo provavo
Una piazzola chiusa per vento risultava *"4/4 occupati"* su una spiaggia deserta — il conto
includeva gli ombrelloni bloccati — e questo impediva persino di svuotarla.

### Test
**330 verdi.**

## v5.79 — Il modulo Spiaggia, con l'interruttore per spegnerlo

### ⛱️ Piazzole nel Crew, permesso `beach`
Le quattro piazzole con gli ombrelloni, verde libero e rosso occupato, il cambio fascia, la
chiusura per vento e il tasto per liberare un ombrellone quando qualcuno segnala un
disallineamento.

L'intestazione dice cosa è questo modulo e cosa non è: *"sulle piazzole non c'è nessuno di noi:
qui si guarda la situazione, si sistema un disallineamento e si chiude una piazzola quando tira
vento. Il resto dipende da chi dichiara e da chi rilascia."*

### Le misure dicono se ci stanno, non quanti metterne
Larghezza e profondità per piazzola, più l'ingombro di un ombrellone (3 m con i lettini) e il
passaggio (1,5 m). Il tasto **📐 Ci stanno?** dice quanti ce ne starebbero, quali si pestano i
piedi e quali escono dal perimetro.

Ma il numero resta una decisione di chi guarda la spiaggia: alberi, docce e passaggi non li
conosce nessuna formula. Il conto **verifica**, non decide.

### Spenta di serie, e si spegne davvero
`beach_attiva` è **falso** di partenza. Con la gestione spenta il socio non vede nemmeno la
sezione e nessuno può prendere niente — non è una spunta che lascia il modulo acceso a metà.

È l'unico servizio in cui il sistema non può far rispettare niente: si prova una stagione, e se
non dichiarano si spegne senza lasciare ruderi accesi.

### Test
**328 verdi.**

## v5.78 — La spiaggia, e il nucleo familiare in anagrafica

### Nucleo familiare
Campo in anagrafica, con l'elenco dei nuclei già usati per non riscriverli a mano: un codice
storpiato è una famiglia separata. Serve in due posti — la composizione delle casate (non si
separa mai) e la spiaggia (conta come una presa sola). Aggiunto anche il **sesso**, che finora
si poteva salvare solo via API.

### Spiaggia: quattro piazzole, due fasce
Grande, Caltagirone, Piccola, Quadrata. Ombrelloni numerati, disposti sulla mappa come i tavoli.

**Le fasce sono fisse**, non quattro ore da quando arrivi. Con le ore mobili chi prende alle
10:20 libera alle 14:20 — un'ora che non serve a nessuno — e chi arriva alle 15 trova occupato
fino alle 19:20 anche se quello se ne va alle 18.

**Una presa per nucleo**, non per persona: *"uno a testa"* si aggira prendendo l'ombrellone a
nome dei figli. Se la famiglia è numerosa ne prende un altro accanto, e conta come una presa
sola. Il rifiuto lo dice: *"la tua famiglia ha già un ombrellone in questa fascia — se siete in
tanti, prendine un altro accanto"*.

**Due fasce al giorno per nucleo**, poi si riprende domani.

**Niente prenotazione anticipata**: chi arriva prende. Se si prenotasse la sera prima, la
mattina dopo metà spiaggia risulterebbe occupata e sarebbe vuota.

**Rilascio anticipato**: chi va via a mezzogiorno restituisce l'ombrellone. È il gesto che fa
girare la spiaggia più di qualunque regola.

**Chiusura piazzola** per vento, marea o manutenzione.

### Gli ombrelloni si dichiarano, non si calcolano
Il numero non si deduce dalla dimensione della piazzola: le piazzole vere hanno alberi, docce e
passaggi, e una formula direbbe che ce ne stanno quattordici dove ce ne stanno nove.

### Test
**326 verdi.**

## v5.77 — Le tendine vuote erano campi di testo

Un solo difetto spiega tutte e tre le schermate che hai mandato. Il back office disegnava
**qualsiasi** parametro che non fosse numero o interruttore come un **menù a tendina** — e
siccome date, orari e numeri di telefono non hanno opzioni, la tendina era vuota. Non si poteva
scrivere né la chiusura delle formazioni, né il numero del chiosco, né gli orari del calendario
fitness.

Sotto ce n'era un secondo, peggiore: anche scrivendo il valore via API il server lo scartava —
i tipi nuovi finivano nel controllo delle opzioni, che non ne avevano, e tornavano al
predefinito. **Scrivere, salvare e ritrovare il campo vuoto senza capire perché** è il difetto
peggiore di tutti.

Ora ogni parametro ha il suo campo: **data**, **data e ora**, **orario**, **telefono**, testo
libero. Un test verifica che nessun parametro dichiari un tipo che il back office non sa
disegnare — così una tendina vuota non ricompare di nascosto.

### Il numero del chiosco, con l'uso giusto
Il testo di aiuto descriveva ancora il vecchio uso — *"compare fra i numeri rapidi"* — che
abbiamo tolto due settimane fa. Ora dice cosa è davvero:

> Serve per le locandine in bacheca e per chi chiede informazioni: spiegazioni, orari,
> ragguagli. **Ordini e prenotazioni no**: quelle si chiudono a sistema, ed è l'unico modo per
> avere un tavolo o un posto a un evento.

Nei numeri rapidi dell'app restano il 112 e il contatto familiare del socio, che sono gli unici
due che rispondono in un'emergenza.

### Test
**320 verdi.**

## v5.76 — Le casate si schierano sempre, e i vincoli crescono con loro

### Da 3 a 12
Una casata esiste con **tre** persone — quelle che stanno in campo a calcetto o a basket — e si
ferma a **dodici**. Tutte e otto scendono in campo: tenerne fuori qualcuna perché non arriva a
dodici significa avere quattro casate forti e quattro spettatori.

### I vincoli sono proporzionali, non fissi
È il cambio più importante. Pretendere 2 under 14, 2 over 70 e 6 donne da una casata di
**quattro** persone produceva venti problemi che non erano problemi: quella casata stava solo
aspettando di riempirsi.

Ora ogni vincolo si misura sulla dimensione vera e **diventa tassativo solo a casata piena**.
Su 12: 2 under 14, 2 over 70, 6 donne. Su 6: 1, 1, 3. Su 4: 0, 0, 2.

Provato con 34 iscritti: **otto casate in campo, zero problemi dichiarati**. Con 100: otto
casate da dodici, tutti i vincoli rispettati.

### Il capitano si propone, non si nomina
Il capitano non è un premio, è un lavoro: convoca, iscrive la casata ai tornei, risponde. Il
criterio non è l'anzianità né la bravura, è **la reperibilità** — un capitano irraggiungibile la
sera del torneo è una casata che non si presenta.

Il sistema propone e **dice perché**: *"raggiungibile per e-mail e per telefono, residente per
tutta la stagione"*. Propone anche un **vice**, che è la cosa che di solito manca: un capitano
con la febbre non deve costare il torneo. E se in una casata non c'è nessun maggiorenne
raggiungibile, lo dichiara invece di scegliere a caso.

La nomina resta un gesto della casata: il sistema non decide.

### Test
**318 verdi.**

## v5.75 — Come si entra in una casata il primo anno

Il sistema propone la composizione, poi la gente cambia. Aspettare che i soci si associno da
soli, il primo anno, significa arrivare a luglio con tre casate piene e cinque vuote.

### I dati nuovi
- **Sesso** in anagrafica: senza, la quota di rappresentanza non è calcolabile.
- **Nucleo familiare**: chi ha lo stesso codice non viene mai separato. I minori seguono il
  tutore senza bisogno di scriverlo.
- **"Gioca la Coppa"**: chi non lo chiede non viene assegnato d'ufficio. Assegnare qualcuno che
  non vuole giocare significa ritrovarsi una casata in meno alla sfilata.

### I vincoli, e l'ordine in cui cedono
Nuclei uniti, 2 under 14, 2 over 70, metà donne e fasce d'età distribuite **non stanno insieme**
appena i numeri non sono perfetti — e non lo sono mai. L'ordine è scritto nel codice:

1. Il nucleo familiare non si separa **mai**.
2. Numero legale della casata.
3. Under 14 e over 70.
4. Quota di rappresentanza, **sul totale** della casata (50%, arrotondato per difetto: 6 su 12).
5. Distribuzione per fasce d'età: la prima a cedere.

Le fasce sono un **criterio**, non una quota: otto persone in sei fasce non si dividono, e
pretenderlo produrrebbe solo violazioni.

### Quando un vincolo si rompe, si dice — e si dice la causa
Sei casate che segnalano *"manca un over 70"* sono sei righe che non spiegano niente. Il sistema
aggiunge il conto complessivo: **"servono 16 over 70 e ne sono iscritti 10: ne mancano 6.
Nessuna composizione può rimediare: vanno cercati."**

Provato su cento iscritti con venti famiglie: **otto casate da dodici, quota rispettata
ovunque**, nuclei mai separati, e l'unico vincolo violato dichiarato con la sua causa.

### Le casate restano otto
Come hai chiesto: la struttura non si rimodula. Chi non raggiunge il numero legale resta **non
schierata** per la stagione, invece di scendere in campo in sette e falsare il torneo.

### L'anteprima non tocca niente
Si guarda, poi si conferma. Senza conferma esplicita il sistema rifiuta: una composizione
sbagliata su cento persone non si disfa a mano.

### Test
**315 verdi.**

## v5.74 — La settimana si legge per intero

Due righe per giorno, come hai chiesto, e lo spazio recuperato va tutto lì.

Su una riga sola titolo e sottotitolo si contendevano la larghezza e finivano tagliati **tutti e
due**: *"Vi aspettiamo per conos…"* accanto a *"Arrivi, partenze e rip…"*. Due informazioni
mezze non fanno un'informazione.

Ora il titolo ha la sua riga — *"Cinema d'autore sotto le stelle"* si legge intero — e il
sottotitolo sta sotto, con due righe a disposizione se serve. Testo più grande, schede più alte,
più aria fra una e l'altra. I sette giorni stanno comunque in una schermata sola, che era il
motivo per cui la riga compatta esisteva.

### Test
**310 verdi.**

## v5.73 — Il permesso che non apriva niente

### Il delegato dei campi entrava e non vedeva nulla
`tennis_campi` esisteva, il back office lo mostrava, l'utente lo riceveva — e poi il Crew gli
diceva *"il tuo utente non ha ancora nessun permesso operativo"*. L'elenco dei moduli
consentiti conosceva solo `tennis`. È la seconda volta che aggiungo un permesso e mi dimentico
questa riga: sta nell'handoff come regola.

### E la sua schermata mostrava quello che non deve vedere
Entrato, trovava *"Incassato € 0,00"* e la sezione *Listino* vuota: il server non gli mandava i
dati — quello funzionava — ma l'interfaccia lasciava lì i contenitori. **Uno zero a chi non ha
diritto di sapere è peggio del silenzio: sembra un dato, ed è un buco.**

Ora chi ha il solo permesso operativo vede la giornata, prenota al banco e blocca i campi. Non
vede incassi, listino, tariffe, configurazione dei campi né creazione di nuovi campi. E i testi
si adattano: al residence si dice *"gli incassi sono di chi li gestisce"*, a lui *"il listino lo
tiene il gestore del servizio: qui prenoti, disdici e blocchi"*.

### La settimana usa tutto lo spazio
Tolto il riquadro esplicativo in fondo: il calendario si allarga.

### Gli avvisi si possono togliere
La *Presentazione Libro* che ti restava nella tessera è un **avviso push** inviato dal back
office (Eventi → invio a tutti). Non era un difetto, ma non c'era modo di archiviarla: restava
lì per sempre. Ora ogni avviso ha la sua ✕. Una notifica che non si può togliere smette di
essere un avviso e diventa arredamento.

### Test
**310 verdi.**

## v5.72 — Confini netti, e l'estratto conto che mancava

### La crew del chiosco non vede più i campi a pagamento
Comparivano nelle sue tendine — *Prenota al banco* offriva Tennis, Beach tennis e Beach volley
— e non è solo rumore: dava al banco del chiosco prenotazioni che non deve toccare. Ora vede
solo i suoi. Il gestore dell'app li vede tutti, perché è supervisore.

### Due permessi, perché sono due mestieri
- **Tennis: gestore del servizio** (`tennis`) — listino, incassi, configurazione dei campi.
- **Tennis: solo prenotazioni e blocchi** (`tennis_campi`) — prenota, disdice, blocca un campo.
  **Non vede il listino e non vede il fatturato.**

Il gestore può mandare qualcuno a coprire un turno senza per questo mostrargli quanto incassa.
Il rifiuto sul libro degli incassi spiega il perché invece di dire *"permesso insufficiente"*:
un no secco farebbe pensare a un errore di configurazione, mentre qui è voluto.

### 🧾 "Le mie spese" nella tessera
L'avevo costruito e non l'avevo mai messo nell'app: c'era la rotta, non il tasto. Ora è accanto
a *Salva tessera*.

Mostra il totale, il dettaglio per servizio e le ultime voci — **con lo zero dove non si paga**:
*"Sport · 3 volte · compreso"*. È la riga che a fine stagione fa vedere quanto vale la quota. In
fondo, il limite dichiarato: qui c'è solo quello che è passato dalla tessera.

### Test
**310 verdi.**

## v5.71 — Il fatturato del terzo, e i tornei a eliminazione diretta

### Gli incassi dei campi a pagamento non li vede il residence
Chi gestisce tennis, beach tennis e beach volley è un **soggetto terzo**: usa l'app perché è
comodo per tutti, ma quanto incassa non deve arrivare a chi l'app la possiede.

- Il gestore dell'app apre la giornata e vede **chi ha prenotato** — resta supervisore, può
  intervenire su un errore — ma **gli importi spariscono**, riga per riga e nei totali.
- Gli incassi finiscono in un **libro suo**, fuori dal registro storico del residence: quello lo
  legge il gestore, e lì dentro il fatturato di un terzo non ci deve stare.
- `GET /api/admin/tennis/incassi` risponde **403 al gestore**, con il motivo scritto.

Non è una gentilezza: è la differenza fra ospitare un'attività e sorvegliarla.

### 🏆 Tornei a eliminazione diretta
Altra cosa dalla Coppa delle Casate, che è a punti e dura tutta la stagione: qui si gioca una
sera, si perde e si va a casa. Disponibili sia al **chiosco** sia al **tennis**, ognuno vede i
propri.

- **Tabellone da 4, 8, 16 o 32.** Un numero diverso viene rifiutato, e il motivo è scritto: a
  eliminazione diretta ogni turno dimezza, quindi con 6 iscritti qualcuno arriverebbe in finale
  avendo giocato una partita in meno.
- **Iscrizioni** per tessera (socio) o per nome (ospite); a tabellone pieno si chiudono da sole.
- **Sorteggio cieco**, una volta sola, e solo a tabellone completo. Nessuna testa di serie:
  in un torneo di residence è l'unica cosa che nessuno può contestare. Mescolamento
  Fisher-Yates, non l'ordinamento casuale che sbilancia le distribuzioni.
- **Il vincitore sale da solo** nella casella che gli spetta. I turni hanno il nome che userebbe
  una persona: *Quarti*, *Semifinali*, *Finale*.
- Non si registra il risultato di una partita che non ha ancora i due giocatori, e il vincitore
  dev'essere uno dei due che hanno giocato.

### Test
**308 verdi.**

## v5.70 — Il modulo tennis è un modulo, non un abbozzo

Avevo fatto una schermata con listino e incassi e l'avevo chiamata modulo. Non lo era: mancava
tutto il resto, e per creare un campo bisognava passare dal back office — cioè esattamente
quello che non deve succedere.

Ora dentro **🎾 Campi & tariffe** c'è la gestione completa, ripresa da dove già esisteva:

**Dal back office** — creazione e configurazione dei campi: nome, sport, orari, durata della
fascia, posti, quante fasce di fila, minimo giocatori, "non prima delle", prezzo base, e
l'interruttore acceso/spento.

**Dalla crew** — la giornata: chi gioca, quanto deve, chi ha pagato, con incasso e disdetta;
prenotazione al banco per il socio che si presenta; campo indisponibile per manutenzione,
torneo o lezioni.

**Dal fitness** — listino a fasce e incassi.

### I campi dell'area tennis non si creano nel back office
È la parte che avevo sbagliato. Le rotte generali dei campi ora **rifiutano** i campi in
gestione tennis: *"questo campo è dell'area tennis: si gestisce dal suo modulo"*. Il gestore
dell'app resta supervisore e può forzare quando serve davvero — ma deve dichiararlo, non
succede per distrazione.

I campi creati dal back office nascono **sempre** al chiosco.

### E il socio li vede subito
Creato il campo, compare nell'app fra quelli prenotabili, con il suo prezzo. Spento, sparisce —
ed è il modo giusto per toglierlo: un campo con prenotazioni non si cancella, e il sistema lo
dice invece di lasciare prenotazioni orfane.

Un test fa il giro intero: crea, configura, mette il listino, il socio prenota e paga 24 € per
novanta minuti a 16 €/ora, poi lo spegne e sparisce.

### Test
**302 verdi.**

## v5.69 — L'area tennis come l'avevi in mente

La mia versione era più stretta della tua idea. Corretti tre punti.

### Quali campi
**Tre e solo tre**: tennis, beach tennis, beach volley. Il **touch tennis** e il **pickleball**
hanno "tennis" nel nome ma stanno al chiosco, gratuiti — la mia migrazione li portava dalla
parte sbagliata perché indovinava dal nome. C'è ora una correzione che li rimanda indietro sui
database dove era già successo.

### Niente tetto settimanale sui campi a pagamento
Come hai detto: più si gioca più si paga, e limitare chi vuole spendere non ha senso. Il tetto
resta sui campi gratuiti, dove è l'unico modo per distribuire una risorsa che non costa niente.

Sui campi a pagamento **non si mostra nemmeno la quota**: scrivere *"ti restano 2 prenotazioni"*
su un campo che si paga sarebbe una bugia.

### Il gestore fa da sé: back office + crew + incassi
Nel suo modulo ora c'è tutto quello che gli serve senza chiedere niente a nessuno:
- **configurazione dei suoi campi** — orari, durata della fascia, posti, e spegnerne uno;
- **campo indisponibile** — manutenzione, torneo, lezioni tutto il pomeriggio, o semplicemente
  *oggi non lo affitto*: era la ragione principale per cui la gestione doveva stare in mano sua;
- **prenota al banco** per il socio che si presenta, col prezzo preso dal listino;
- **listino e incassi**, come nel fitness.

Il perimetro è stretto e verificato: sui campi del chiosco riceve *"questo campo non è fra i
tuoi"*. Un permesso che apre tutto non è una delega, è un altro gestore.

### Per il socio non cambia niente
Vede i campi e prenota. Che dietro ci siano due gestioni diverse non lo riguarda — l'unica
differenza che vede è il prezzo, quando c'è.

### Test
**299 verdi.**

## v5.68 — I campi non si prenotavano più. Colpa mia, di ieri.

`fasce is not defined`. Aggiungendo la nota sulle fasce già passate ho scritto il nome di una
variabile che non esiste. L'eccezione arrivava **dopo** aver disegnato le fasce orarie e
**prima** di agganciare i tasti: la schermata sembrava a posto — le ore c'erano tutte — ma
*Solo io* e *Apri ai soci* non comparivano, e **nessun campo era prenotabile**, né a pagamento
né gratuito.

È l'errore più insidioso che ci sia: nessun messaggio, nessuna riga rossa, solo tasti che non
ci sono. Verificato in un browser vero: prima 0 tasti, ora 5 e 5.

**C'è ora un test che lo prende**: cerca le variabili usate in `(nome || [])` e mai dichiarate.
Provato rimettendo l'errore: la suite diventa rossa e dice *"queste variabili vengono usate ma
non esistono: fasce"*.

## Il modulo Tennis non compariva a nessuno

Il permesso `tennis` c'era, la schermata pure, ma la zona non era nell'elenco di quelle
consentite: il selettore dei moduli non la mostrava mai. Per vedere qualcosa bisognava dare
anche *"Campi & prenotazioni"* — che è un altro modulo, quello dei campi gratuiti del chiosco,
ed è il motivo per cui ti ritrovavi la stessa identica schermata dell'utente sport.

Ora il permesso `tennis` basta da solo: chi affitta i campi a pagamento non ha bisogno di
toccare quelli del chiosco, e infatti se ci prova riceve *"permesso insufficiente"*.

### Test
**295 verdi.**

## v5.67 — Il modulo Tennis & Beach

**Tennis, beach tennis e beach volley** non sono i campi del chiosco: chi li gestisce li affitta
e ci fa lezione privata, con un listino suo e un incasso suo. Ora hanno un modulo dedicato nel
Crew — **🎾 Campi & tariffe** — con un permesso proprio (`tennis`).

Il **gestore dell'app resta supervisore**: ha tutti i permessi e può intervenire quando serve,
ma il campo quotidiano lo tiene chi affitta.

### Il listino
Fasce con nome, orario e prezzo orario: *"mattina 12 €/h"*, *"sera 18 €/h"*, *"lezione privata
35 €/h"*. La lezione è un tipo d'uso a sé, quindi lo stesso campo alla stessa ora costa
diversamente se è affitto o lezione.

Se una fascia non copre l'orario vale il prezzo base del campo; se non c'è nemmeno quello, il
campo è **gratuito** — e questa è la regola importante: **senza listino non si inventa un
prezzo**.

### La giornata
Chi gioca, su quale campo, quanto deve, chi ha già pagato. Con il totale incassato e quello
ancora da incassare, e un tasto per segnare il pagamento. Ogni incasso finisce nel registro
storico: è denaro, e deve avere un nome e un'ora.

### Prezzo orario su TUTTI i campi
Anche quelli del chiosco, a zero. Come hai chiesto: domani si può decidere di far pagare anche
il calcetto senza rimettere le mani nello schema. Oggi restano gratuiti, e un test lo verifica.

### Un difetto ricorrente, preso di nuovo
La migrazione che assegnava i campi al modulo tennis girava **prima** che i campi predefiniti
venissero creati: su un database nuovo non trovava niente e si marcava come fatta. È la terza
volta in questa serie (condimenti, alcolici, e ora i campi). Ora la gestione si dichiara alla
nascita del campo, e la migrazione gira dopo, per i database già esistenti.

### Test
**294 verdi.**

## v5.66 — RB-000123-4: la tessera è di una persona, non di una stagione

Nuovo formato, come hai indicato: **sigla RB**, progressivo, e una **cifra di controllo**.

**Niente anno dentro il numero**, e non è estetica: mettere il 2026 nel numero significa o
cambiarlo ogni stagione — perdendo il filo di tutto quello che quella persona ha fatto — o
portarsi dietro un anno sbagliato per anni. La tessera identifica una persona; è la *card* a
essere un oggetto che si consuma.

La cifra finale serve al banco: un numero dettato male viene rifiutato subito, invece di
risultare *"socio non trovato"* e far cercare un errore che non c'è.

### La card si rifà, la persona resta
Nuovo comando **rifai tessera**, con il motivo obbligatorio — persa, rovinata, non funziona,
credenziali dimenticate — e la possibilità di **azzerare il PIN** contestualmente, che è
esattamente il caso della tessera host dimenticata.

Il numero vecchio **non si cancella**: è scritto dentro prenotazioni, iscrizioni e comande di
stagioni passate. Resta leggibile nella storia, marcato **revocato**, e non serve più a
prenotare né a pagare. Ogni socio ha ora l'elenco delle tessere che ha avuto e perché.

### Le tessere già stampate continuano a funzionare
Il vecchio formato `BR-2026-…` resta valido ovunque: chi ha già la card in tasca non deve
rifarla. I numeri nuovi partono con RB, e la migrazione di una singola persona si fa quando
capita, col comando di sostituzione.

### Un difetto trovato subito
La cifra di controllo aveva una variabile fuori scope (`acc is not defined`): **nessun socio
poteva essere creato**, e il messaggio era il generico *"tessera duplicata o dati non validi"*.
Ora la causa vera si legge nei log del server.

### Test
**290 verdi.**

## v5.65 — Un identificatore, tre supporti

QR stampato, tag NFC e numero digitato **non sono tre sistemi**: sono lo stesso numero su
supporti diversi. Ora convivono senza che nessuno debba scegliere.

Il ponte è un indirizzo corto: **`/t/BR-2026-0101`**.
- Stampato come QR sulla card: la crew lo inquadra, il socio lo inquadra col proprio telefono.
- Scritto in un tag NFC come URL: chi appoggia la card apre la pagina — **anche da iPhone**, che
  legge i tag NDEF da solo, senza app installata.
- Digitato a mano, quando la card è rimasta in camera.

Il campo della tessera — sia all'ingresso dell'app sia alla cassa — accetta ora **il numero, un
indirizzo incollato o il testo letto dal tag**: estrae il numero da solo. Funziona anche in
minuscolo, perché un tag scritto male non deve far fallire tutto.

### Test
**287 verdi.**

## v5.64 — Il numero di tessera non è una password

Preparando la tessera fisica è saltato fuori il problema vero: **i numeri sono progressivi** —
BR-2026-0101, 0102, 0103 — e stanno **scritti sulla card**. Vanno benissimo per dire *"sono
io"*; come credenziale di pagamento si indovinano a voce.

Con la prepagata accesa, bastava dire un numero al banco per spendere il credito di un altro.

### Il PIN
Per pagare con la tessera ora serve un PIN di 4-6 cifre, che il socio digita lui: è l'unica cosa
che non sta scritta da nessuna parte. Per un ragazzo è anche il modo in cui il genitore sa che
quei soldi li spende lui, non l'amico che gli ha preso la tessera dallo zaino.

- I PIN prevedibili sono rifiutati: *1234*, le cifre tutte uguali, quelli troppo corti.
- **Cinque tentativi sbagliati e la tessera si blocca**: quattro cifre sono diecimila
  combinazioni, e senza limite si provano tutte. Si sblocca al banco.
- La soglia è un parametro (**PIN richiesto oltre €**): a zero si chiede sempre, ed è la scelta
  prudente. Alzarla velocizza i caffè ma apre una porta.

### Test
**285 verdi**, fra cui il blocco dopo cinque tentativi e il rifiuto dei PIN prevedibili.

## v5.63 — La tessera prepagata, con due interruttori

Come hai chiesto: **un parametro generale** accende la prepagata per il residence, e per i
minorenni serve **un secondo consenso** sulla scheda anagrafica. La differenza non è
burocratica — per un adulto è una comodità che sceglie lui, per un ragazzo è denaro spendibile
che qualcuno gli mette in mano, e quel qualcuno deve avere un nome. Il consenso registra **chi
l'ha dato e quando**.

La spunta in anagrafica compare **solo per i minorenni**: mostrarla a un adulto farebbe credere
che serva anche a lui.

### Non è un interruttore che non accende niente
Dietro c'è il saldo vero: **ricarica** al banco (con tetto massimo parametrico), **pagamento**
della comanda scalando il credito, **rimborso** del residuo, e l'elenco dei movimenti con il
saldo scritto dentro ogni riga — così una contestazione si legge senza rifare i conti.

Il saldo non va mai sotto zero: se non basta, il sistema lo dice e suggerisce di pagare la
differenza in un altro modo.

### Il credito è un debito, non un incasso
La ricarica finisce nel registro storico marcata *"anticipo, non ricavo"*, perché diventa
fatturato solo quando il socio consuma. E c'è `GET /api/admin/tessere/debito`, che dice quanto
il residence deve ancora ai soci: a fine stagione quei soldi vanno rimborsati o riportati, e
saperlo a settembre è tardi.

### Un difetto trovato costruendolo
"tessera" non era fra i metodi di pagamento consentiti, quindi diventava **"contanti" in
silenzio**: la comanda risultava incassata, il saldo del socio restava intatto e la cassa non
tornava.

### Test
**282 verdi**, fra cui il doppio consenso: un minorenne con il solo parametro generale non può
caricare, e con l'autorizzazione sì.

## v5.62 — La tessera racconta la stagione

`GET /api/estratto-conto?tessera_code=…` mette insieme tutto quello che un socio ha fatto:
consumazioni al Bar e al Garden con l'importo, lezioni di fitness, e **con lo zero** i campi, i
tavoli e i posti alla platea.

Lo zero non è un riempitivo: dice che quei servizi sono compresi. Un elenco di sole spese
racconta metà della storia — a fine stagione la riga *"Sport · 14 volte · 0,00 €"* è quella che
fa vedere quanto vale la quota.

### Il limite è scritto, non lasciato capire
Nell'estratto c'è solo ciò che è passato **dalla tessera**. Al Bar si serve chiunque e la
maggior parte degli scontrini non ha un nome dietro: nella stagione simulata, su 6.063 comande
solo 1.100 erano riconducibili a un socio. L'estratto lo dice in chiaro, perché un riepilogo
incompleto che si presenta come completo fa pensare che il conto sia sbagliato.

### Due difetti trovati costruendolo
- La rotta non poteva chiamarsi `/tessera/estratto`: più sopra c'è `/tessera/:code`, che
  intercettava "estratto" come se fosse un numero di tessera e rispondeva *"non trovata"*.
- `socioAttivoByTessera` non restituiva il numero di tessera: ogni ricerca fatta per tessera
  tornava vuota, e sembrava che il socio non avesse mai fatto niente.

### Test
**278 verdi**, fra cui quello che verifica che una comanda **senza** tessera non finisca
nell'estratto di nessuno.

## v5.61 — La copia del conto non parte da sola

Misurando l'effetto dell'ultima versione sulla simulazione è venuto fuori un problema che avevo
appena creato: la copia di cortesia partiva **in automatico** a ogni socio riconosciuto. Contati
sulla stagione simulata:

| | comande con socio | mail in stagione | a testa |
|---|---:|---:|---:|
| Contingency | 214 | 214 | 7,1 |
| Normale | 1.100 | 1.100 | 7,6 |
| Ottimale | 1.748 | 1.748 | 8,7 |

Chi prende tre caffè in un giorno riceve tre mail, e in una settimana ha disattivato tutto.

Ora la copia parte **solo se l'operatore scrive un indirizzo** alla cassa — cioè quando il
cliente l'ha chiesta. L'invio automatico ai soci resta disponibile come parametro
(*"Manda la copia del conto ai soci senza chiederlo"*), spento di serie.

### Un difetto nel simulatore
Il generatore casuale può restituire esattamente 1, e l'indice usciva dall'array: la stagione si
interrompeva dopo migliaia di iterazioni, in un punto che sembrava non c'entrare niente.
Corretto.

### Test
**275 verdi.** Uno era intermittente — prendeva il primo socio dell'elenco, che poteva essere
già iscritto alla lezione per via di un altro test: ora ne crea uno suo.

## v5.60 — Chi ha già pagato, e la copia del conto per chi non ha il telefono in mano

### Priorità a chi ha pagato
Hai ragione sul motivo, ed è quello che ho scritto nel codice: non è *"chi paga mangia prima"*,
è che **quell'ordine è già chiuso** — non richiede una seconda visita al tavolo, non occupa la
cassa nel momento di punta, ha alleggerito il lavoro della crew. Il vantaggio è **misurato**
(vale quattro minuti di anticipo in coda), non assoluto: chi aspetta da troppo passa comunque
avanti per la regola contro l'attesa infinita che c'era già.

### La copia di cortesia del conto, per e-mail
Chi ordina col QR il conto ce l'ha già sul telefono. Chi si è fatto servire al tavolo, chi usa
la versione leggera, chi semplicemente non ha inquadrato niente — non ha niente in mano.

Ora al momento dell'incasso c'è un campo **facoltativo** per l'indirizzo. Se il cliente ha la
tessera, l'indirizzo il sistema lo sa già e non chiede niente. La mail arriva con le righe del
conto e il totale, e in fondo, in un riquadro rosso:

> **Questa non è una ricevuta fiscale.** È la copia di cortesia del tuo conto, per averlo sotto
> mano. Lo scontrino fiscale ti viene consegnato al banco: se non l'hai avuto, chiedilo.

La stessa avvertenza è nella schermata della cassa, sotto il campo: *"lo scontrino fiscale va
consegnato lo stesso"*. Un test rilegge il testo della mail e fallisce se quella distinzione
sparisce.

### E il conto del tavolo ora passa dalla cassa
Chiudendo il conto del Garden si faceva un **cambio di stato**: niente metodo di pagamento,
niente ricevuta. Quindi al Garden l'incasso non risultava mai né in contanti né in carta. Ora
passa dalla stessa cassa del banco. L'indirizzo, se dato, si usa una volta sola: quattro comande
dello stesso tavolo non fanno quattro mail.

### Test
**274 verdi.**

## v5.59 — Disdire una lezione, e cosa costa farlo tardi

Stessa storia dei campi: la rotta per annullare un'iscrizione **esisteva**, ma l'app non la
chiamava mai. Chi si iscriveva a una lezione non aveva modo di tirarsi indietro — e non c'era
nessuna regola sul tempo, quindi si poteva sfilarsi un minuto prima con l'istruttore già lì.

### Ora si disdice, e la regola è scritta prima
- Nel pannello della lezione c'è **Disdici**, per chi è iscritto.
- Sotto, sempre visibile **prima** di iscriversi: *"Si disdice senza pagare fino a 30 minuti
  prima. Dopo, la lezione resta dovuta: l'istruttore è già arrivato e il posto non si rivende."*
- Il margine è un parametro del back office (**Disdetta libera fino a**), non un numero scritto
  nell'app. A zero, si disdice sempre gratis.

### La disdetta tardiva non sparisce: resta da incassare
Annullare oltre il margine segna l'iscrizione come **dovuta**. Nel pannello del banco compare un
riquadro *"Disdette tardive · la lezione resta dovuta"* con i nomi e il tasto per incassare —
perché senza quell'elenco la regola sarebbe rimasta sulla carta e nessuno avrebbe saputo a chi
chiedere i soldi.

Quando la disdetta è tardiva, la conferma nell'app lo dice **prima** di procedere, non dopo.

Tutto finisce nel registro storico, con il margine applicato.

### Test
**271 verdi.**

## v5.58 — Nella platea non ci sono tavoli

La finestra dello Stage aveva le sue misure e i suoi ingombri, ma **tre frasi erano rimaste
scritte al Garden**: *"ci stanno 42 tavoli"*, *"Tavoli troppo vicini"*, e il "come li hai messi"
al maschile. Ora tutto il testo segue l'ambiente: sedute, sedute troppo vicine, "come le hai
messe".

### E il palco veniva contato come una seduta
Nella tua schermata la testata diceva **66 posti** e la verifica **67 sedute**: la differenza
era il palco. L'arredo — palco, bancone, una pianta — sta sulla pianta ma non è un posto, e
contarlo chiedeva spazio per qualcosa che nessuno deve raggiungere. Ora è escluso dal conto: i
due numeri coincidono.

### Test
**268 verdi**, fra cui uno che rilegge tutto il testo dello Stage e fallisce se ci trova dentro
la parola "tavolo".

## v5.57 — «Fatto!» deve essere vero

La domanda giusta era: *come faccio ad arrivare a farmi dire "fatto" e a non avere la
prenotazione?* Restava una strada, anche dopo la correzione di ieri.

Alle 21:17 il campo delle 21:00 risulta libero e la fascia non è finita, quindi si poteva
prenotare. Ma **la scadenza del numero legale sta mezz'ora prima dell'inizio** — le 20:30, già
passate. La prenotazione nasceva con la scadenza alle spalle, viveva i dieci minuti di grazia e
poi svaniva. Il socio aveva letto *"Fatto!"* e non aveva più niente.

### Le fasce non prenotabili ora sono bloccate, non nascoste a metà
Tre stati distinti, e ognuno dice la verità:
- **passata** — la fascia è finita: non compare fra quelle prenotabili;
- **in corso** — è cominciata: si vede, in grigio, con scritto *"in corso: chiedila al banco"*.
  Dall'app si prenota solo in anticipo; chi è lì di persona la fa assegnare dalla crew, che ha
  il tasto *Prenota al banco*;
- **libera** — si prenota.

Il server rifiuta entrambi i casi anche se qualcuno ci arriva per altre strade, e nel rifiuto
dice **dove andare**, non solo di no.

### E quando la prenotazione nasce fragile, lo dice
Se la scadenza del numero legale è comunque vicina, la conferma non si limita più a *"Fatto!"*:
aggiunge **"Servono N giocatori e la scadenza è già passata: hai 10 minuti per dire chi gioca,
altrimenti il campo torna libero."** Detto nel momento in cui serve, non dopo.

Verificato alle 21:31 di Siracusa: dalle 08:00 alle 20:00 passate, le 21:00 in corso e rifiutate
con l'indicazione del banco, domani alle 21:00 prenotabile senza avvisi.

### Test
**267 verdi.**

## v5.56 — Alle nove di sera non si prenota il campo delle quattro

Hai ragione, e non era solo un fastidio visivo: quelle fasce si **prenotavano davvero**. La
prenotazione veniva creata e poi decadeva nello stesso istante — la scadenza del numero legale
era passata da ore — lasciando il socio con una prenotazione fantasma e nessuna spiegazione.

Ora una fascia già finita:
- **non compare più** fra quelle prenotabili nell'app;
- **viene rifiutata** dal server, se qualcuno ci prova lo stesso: *"Quella fascia è già passata:
  scegline una più avanti o un altro giorno."*

Sotto l'elenco resta scritto quante ne sono passate, così mezza giornata non sparisce in
silenzio.

### L'ora è quella del residence, non quella del server
Il server sta su un fuso qualsiasi — su Render è UTC — e il Garden sta in Sicilia: **due ore di
scarto**, che su una fascia oraria fanno la differenza fra "si può ancora prenotare" e "sono le
nove di sera". Ora si guarda sempre l'ora di casa (Europe/Rome), con un test che lo verifica
fascia per fascia.

Verificato alle 21:17 di Siracusa: prenotabile solo le 21:00, tutte le altre marcate passate, e
il tentativo sulle 16:00 respinto.

### Test
**266 verdi.** Il vecchio test sulla decadenza prenotava una fascia di ieri per provocarla: ora
prenotare all'indietro è vietato, quindi è stato riscritto sulla regola nuova.

## v5.55 — Prenotare un campo non è più una condanna

### Non si poteva disdire. Da nessuna parte.
La rotta per annullare esisteva, ma lavorava sull'**id della prenotazione** — un numero che
l'app non ha mai in mano, perché la fascia conosce la *partita*. Risultato: dal telefono non
c'era il tasto, e nemmeno la crew poteva farlo. Un campo prenotato per sbaglio restava occupato
fino a sera.

Ora si disdice **dall'app** (tasto *Disdici* sulla propria fascia, accanto a *Chi gioca*) e
**dal banco** (tasto sulla prenotazione del giorno). Con conferma, perché è un gesto che manda a
casa chi aveva già detto di sì, e con la riga nel registro storico: chi ha disdetto, quando.

### «Ce ne stanno 16» ma «non ci sta»: due domande, una sola risposta
Il verdetto confondeva due cose diverse, e sembrava contraddirsi. Non lo era — lo spazio
bastava, era la **disposizione** a essere sbagliata — ma chi legge non deve fare questo
ragionamento da solo. Ora i verdetti sono tre e dicono anche cosa fare:

- **ci sta**
- **lo spazio non basta** → *"in 9×9 m ci stanno 16 tavoli, non 20. Togline 4."*
- **lo spazio basta, la disposizione no** → *"ce ne starebbero 16, ma così come li hai messi non
  ci si passa. Allontanali, oppure usa Ripristina predefinita."*

### E il ripristino ora disegna una sala in cui si passa
Era il difetto sotto il difetto: **la griglia spargeva i tavoli in percentuale** sull'intera
larghezza, mettendoli a 1,8 m dove ne servivano 2,5. Il sistema disegnava da solo una pianta che
poi bocciava. Ora dispone al **passo reale** — ingombro più passaggio — e centra le file sullo
spazio che avanza: dopo il ripristino la verifica dà *ci sta*, zero coppie troppo vicine.

### La platea dello Stage non è il Garden
Usava gli stessi parametri, e il verdetto non voleva dire niente: **una sedia in fila occupa
55 cm, un tavolo con quattro persone intorno ne occupa due**. Lo Stage ha ora le sue misure
(larghezza, profondità, larghezza seduta, distanza fra le file) e la finestra parla di *sedute*,
non di tavoli.

### Test
**265 verdi.**

## v5.54 — Metri veri sotto la pianta

### "Comprimi tutto" chiudeva i pannelli senza chiuderli
Le righe dei parametri hanno `display:flex` scritto **inline**, e lo stile inline batte la regola
che le nasconde. Il pannello risultava chiuso — freccia girata, classe applicata — ma il
contenuto restava lì: 58 elementi ancora visibili e la pagina lunga 4.121 pixel. Ora la regola
vince: dopo "Comprimi tutto" la pagina misura 1.239 pixel e restano solo i titoli.

### Quanti tavoli ha il Garden è un parametro
Numero di tavoli e posti per tavolo si cambiano dal back office. Cambiarli non tocca la sala già
disegnata: serve **Ripristina predefinita** nella pianta, che ridisegna da capo — e che si
rifiuta di farlo se ci sono prenotazioni in piedi, dicendo quali.

## 📐 "Ci sta davvero?"

La pianta è disegnata in **percentuali**, e in percentuale un tavolo in più ci entra sempre. La
realtà no, e te ne accorgi la sera in cui due camerieri non riescono a passare fra i tavoli con
i vassoi.

Ora si scrivono nei parametri le **misure vere della sala** — larghezza e profondità in metri,
prese col metro — più l'**ingombro di un tavolo con le sedie occupate** (di base 2 m: un quadrato
da 80 cm con quattro sedute) e il **passaggio minimo** (0,9 m, sotto il quale non ci si passa con
le mani piene).

Il tasto **📐 Ci sta davvero?** nella pianta riporta tutto in metri e risponde:

> **No, e ti dico di quanto.**
> · Fra 29 coppie di tavoli non passa un cameriere con il vassoio: servono 0,9 m, ce ne sono meno.
> Sala 11 × 8 m · 88 m² — Tavoli disegnati 12 · 48 posti — **Metri quadri per coperto 1,83**

Con 18 × 12 m gli stessi 12 tavoli passano la verifica, con 4,5 m² a coperto.

Dice anche **quanti tavoli ci starebbero davvero**, quali coppie sono troppo vicine e di quanto,
e quali escono dal perimetro. Senza le misure non stima niente: chiede di prenderle.

### Test
**263 verdi.**

## v5.53 — «Solo io» non vuol dire «gioco da solo»

Pippo prenota il campo per sé e per tre amici. **Quei tre non erano scritti da nessuna parte.**
Con *Solo io* il sistema registrava il solo titolare e chiudeva la prenotazione: nessuno poteva
essere aggiunto, perché la partita nasceva già "completa". Al banco non si sapeva chi fosse in
campo, la Coppa non poteva assegnare i punti a chi aveva davvero giocato, e in caso di
infortunio l'unico nome disponibile era quello di Pippo.

L'equivoco era nel modello: **«Solo io» significa chiuso agli estranei, non gioco da solo.** Le
due cose sono diverse, e ora lo sono anche nel sistema.

### Chi li scrive, e dove
- **Il titolare, dal telefono**: sulla propria fascia riservata compare **Chi gioca**, con
  l'elenco e il campo per aggiungere. Solo lui: un altro socio che ci provasse riceve un
  rifiuto.
- **La crew, al banco**: nella scheda Campi ogni prenotazione ha ora il campo *+ Chi gioca* —
  perché quasi sempre i nomi si dicono arrivando, non dal telefono.

### Due modi di aggiungere qualcuno
- Con la **tessera**, se è un socio: il nome è quello vero dell'anagrafica, e vale per la Coppa
  e per i tetti settimanali.
- Con il **solo nome**, se è un ospite senza tessera: gioca lo stesso — i campi sono gratuiti e
  la tessera non è un lasciapassare — ma resta scritto chi c'era in campo.

Non si superano i posti del campo, il titolare non si può togliere da solo (semmai annulla la
prenotazione), e ogni dichiarazione finisce nel registro con chi l'ha scritta.

### Test
**260 verdi**, quattro nuovi: il titolare dichiara soci e ospiti, un estraneo non può, non si
superano i posti, e anche il banco può farlo.

## v5.52 — La regola che ti fa decadere il campo, ora si vede

Costruendo l'esempio pratico sulla dichiarazione dei giocatori è venuto fuori un buco: il
**numero legale** funzionava ma **non era scritto da nessuna parte**. Nell'app si leggeva
*"1/10 · mancano 9"*, che sono i **posti liberi** — non i **6 giocatori** che servono perché la
partita si faccia, e soprattutto non l'ora entro cui servono.

Il socio scopriva la regola trovandosi il campo libero: la prenotazione era decaduta e nessuno
gliel'aveva detto.

Ora sulla fascia e nell'elenco delle partite aperte si legge:

> **Servono 6 giocatori: ne mancano 3 entro le 17:30**

e, quando il minimo è raggiunto, **Si gioca: numero minimo raggiunto**. Tradotto in tutte e
quattro le lingue.

### Test
**256 verdi.**

## v5.51 — Pannelli che non si comprimevano, e un numero che non risponde

### I raggruppamenti non collassavano
Il meccanismo cercava il titolo **come primo figlio** del pannello. Dove ho aggiunto un tasto
accanto al titolo — "Salva le modifiche" nel menù, la diagnosi — il titolo è finito dentro una
riga, e quei pannelli hanno smesso di comprimersi: la freccia ▾ spariva e il clic non faceva
niente. Ora il titolo si cerca dove sta davvero, e il pannello resta comprimibile comunque sia
costruito. Vale sia per il Crew sia per il back office.

### "Comprimi tutto" nel Crew non c'era proprio
Esisteva solo nel back office. In sala, dove si lavora su un telefono e le pagine sono lunghe,
serve di più: ora c'è.

### Via il numero del chiosco dai numeri rapidi
Come hai chiesto. Nei numeri d'emergenza restano **112** e il **contatto personale**, che sono
gli unici due che rispondono davvero. Un numero che squilla a vuoto in un pannello di emergenza
è peggio di un numero che non c'è.

### Test
**256 verdi.**

## v5.50 — Il cocktail ordinato al tavolo non lo vedeva nessuno

Le due postazioni usavano **due criteri diversi**. La cucina filtrava per *chi prepara*
(`stazione=cucina`), il banco per *dove si vende* (`zona=bar`). Da questa asimmetria:

- un **cocktail ordinato a un tavolo del Garden** non compariva né in cucina (la riga è del bar)
  né al banco (la comanda è del Garden): **restava in un ordine che nessuno preparava**, finché
  il cliente non lo reclamava;
- un **panino ordinato al bancone** compariva sulla schermata del banco, che però non deve
  prepararlo — rumore in mezzo al lavoro.

Verificato riproducendo i due casi: il cocktail al tavolo risultava invisibile a entrambe le
postazioni.

Ora **la coda di lavoro segue chi prepara**, da tutte e due le parti. È lo stesso principio del
menù, dove *chi prepara* e *dove si vende* sono due informazioni distinte: applicarlo a metà
lasciava un buco esattamente nel mezzo.

### Cosa cambia sulla schermata del banco
- Arriva **tutto quello che prepara il banco**, da qualunque parte venga l'ordine.
- Ogni scheda dice la provenienza: **🍽️ da portare al tavolo 4** oppure **🍸 al banco**, perché
  cambia il gesto — uno si ritira, l'altro si porta.
- L'**incasso resta a chi tiene il conto**: su una comanda del tavolo il banco vede solo i tasti
  di preparazione, perché quel conto si paga al tavolo.
- Una comanda mista compare a **entrambe** le postazioni, ognuna con le sole righe sue.

### Test
**256 verdi**, tre nuovi: il cocktail del tavolo finisce al banco e non in cucina, il panino del
bancone finisce in cucina e non al banco, la comanda mista si divide correttamente.

## v5.49 — Tre stagioni simulate, e due difetti che solo una stagione poteva scoprire

Simulate tre stagioni intere (80 giorni, 10% / 50% / 75% dei 400 utenti) facendo girare
l'applicativo vero su tre database dedicati. Rileggendo i risultati **dal database** invece che
dai contatori della simulazione sono usciti due difetti che nessun test aveva visto.

### 🔴 Incassare non scaricava il magazzino
C'erano due strade per chiudere una comanda: il **cambio di stato**, che scaricava, e la
**chiusura con incasso**, che non scaricava — ed è quella che si usa dal conto del tavolo, cioè
la strada normale. Risultato della prima simulazione: **8.400 comande chiuse e ZERO movimenti di
scarico**. Le giacenze sarebbero rimaste ferme tutta la stagione e la differenza sarebbe emersa
all'inventario, mesi dopo, senza nessuno in grado di spiegarla.

Ora la chiusura con incasso scarica il magazzino e scrive nel registro storico, come l'altra
strada. Dopo la correzione, le stesse simulazioni producono 746, 3.302 e 4.209 movimenti di
scarico. Un test blocca la divergenza.

### 🟡 I campi non si prenotano oltre 60 giorni
Comportamento voluto (finestra di anticipo), ma il massimo configurabile è 60 giorni: una
stagione non si può pianificare in anticipo. Da rivedere per un residence dove le famiglie
arrivano sapendo già quando giocheranno.

### Cosa dicono le tre stagioni
Il riepilogo completo — conto economico, operatività, situazioni limite e forme contrattuali —
è in `RIEPILOGO-TRE-STAGIONI.md`. In tre righe: sotto il **28% di utenza** la stagione non sta in
piedi; il collo di bottiglia non è la cucina ma **la sala** (due camerieri per 11 tavoli, due
giorni su tre); crescere oltre il 50% senza toccare i turni **aumenta il fatturato e abbassa lo
scontrino medio**, rifiutando metà della domanda.

### Test
**253 verdi.** Nuovi strumenti: `scripts/stagione-3-scenari.mjs` (la simulazione),
`scripts/estrai-simulazioni.mjs` (i numeri letti dal database).

## v5.48 — Le e-mail escono davvero

Il codice di accesso veniva generato, scritto nel database e poi **perso**. In sviluppo tornava
dentro la risposta HTTP — comodo per provare — e in produzione non arrivava a nessuno: chi
sceglieva "entra con l'e-mail" restava fuori, e dai log risultava tutto a posto.

Ora si spedisce. Senza librerie nuove: si parla via HTTP col fornitore (**Resend** o **Brevo**),
così il deploy resta il file unico da copiare su Render. Si accende con tre variabili:
`MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM`. Senza, si resta in modalità *console*: la mail non
parte ma viene scritta per intero nei log — meglio un codice leggibile che un servizio che finge
di aver spedito.

### Un OTP che regge un attacco, non solo una dimostrazione
- **Tre richieste per indirizzo ogni quarto d'ora**: un codice spedito a comando è anche un modo
  per riempire la casella di qualcun altro.
- **Cinque tentativi e il codice si brucia**: sei cifre sono un milione di combinazioni, e senza
  contare i tentativi si indovinano.
- **La risposta è sempre la stessa**, indirizzo noto o no: dire *"questa e-mail non esiste"*
  regalerebbe a chiunque l'elenco degli iscritti. Il codice però parte solo a chi ha un profilo.
- **Chi entra col codice ha l'indirizzo verificato**: ha dimostrato di leggere quella casella.

### Registrarsi serve a qualcosa
Alla registrazione parte l'e-mail di benvenuto **con il numero di tessera** — che serve per
prenotare un campo e iscriversi alle lezioni, e che nessuno ricorda a memoria dopo aver chiuso
la schermata. Con un promemoria: Bar e Garden restano aperti a tutti, la tessera non serve per
consumare.

### E si vede se funziona
`GET /api/admin/posta/stato` dice se la posta è configurata, con quale fornitore, e quante delle
ultime richieste sono partite davvero. `POST /api/admin/posta/prova` manda un messaggio di prova
a un indirizzo scelto. Senza questo, che le mail non partano lo si scopre da un socio rimasto
fuori.

### Test
**252 verdi**, più `scripts/verifica_posta.mjs`, che mette in ascolto un finto fornitore e
controlla cosa gli arriva davvero: destinatario, oggetto, chiave, e il codice presente sia
nell'HTML sia nel testo semplice.

## v5.47 — Il prezzo dei condimenti lo decidi tu

Nella 5.46 avevo bloccato il campo prezzo sui condimenti, perché il conto applicava comunque un
supplemento fisso preso da un parametro. Era la correzione sbagliata: **un euro per condire, che
il cliente ne scelga uno o quattro, è una scelta commerciale** — promozione, richiamo,
marginalità — e nessun software deve impedirla.

Ora comanda il prezzo che scrivi. Condire costa **quello che hai messo sui condimenti**, si paga
una volta sola, e cambiarlo cambia il conto: verificato: panino 6,00 + un condimento da 1,00 →
7,00; + quattro condimenti da 1,00 → 7,00; portati i condimenti a 2,00 → 8,00.

Il campo è di nuovo modificabile, e sotto c'è scritto l'effetto — *condire costa € 1,00* — così
si vede subito cosa si sta decidendo. Il parametro resta solo come rete: vale quando i
condimenti non hanno prezzo, cioè quando non hai ancora detto niente.

### Se i condimenti hanno prezzi diversi
La regola *"tanto per tutti"* resta la tua, quindi vale **il più alto** — fra due letture
possibili si sceglie quella che non regala merce. Ma non resta un'ambiguità silenziosa: la
diagnosi lo dice in chiaro, con i prezzi trovati e quello applicato.

### Test
**247 verdi.**

## v5.46 — Il listino diceva una cosa e il conto ne faceva un'altra

Nel listino i condimenti avevano **prezzo 1,00** e la colonna **Compl. vuota**. Il sistema
intanto li trattava già come aggiunte — li riconosce dalla categoria — e applicava il
supplemento fisso. Verificato sul conto: panino 6,00 più **tre condimenti da 1,00** →
il cliente paga **6,50**. Chi aveva compilato quei prezzi credeva di incassare tre euro.

Il calcolo è quello giusto, sei stato tu a deciderlo. Sbagliata era la schermata, che lasciava
scrivere un numero senza dire che non serviva a niente. Ora sulle righe dei condimenti:

- il **prezzo è bloccato** e sotto c'è scritto quanto vale davvero (*vale € 0,50*), con la
  spiegazione al passaggio del mouse;
- la spunta **Compl. è accesa**, perché quelle voci *sono* aggiunte. Una migrazione mette la
  spunta anche a chi era riconosciuto solo dalla categoria: quello che vedi torna a dire quello
  che succede.

## Due tasti che non facevano niente

Cercando, ne sono saltati fuori altri due nella stessa schermata: il **Salva per riga** (che
avevo sostituito con il salvataggio unico ma lasciato disegnato) e il **cestino**, di cui avevo
cancellato l'handler insieme al blocco vecchio. Si premevano, si illuminavano, non succedeva
nulla — e chi li premeva credeva di aver salvato o cancellato.

Il Salva per riga è sparito; il cestino ora funziona, chiede conferma col nome del prodotto e
mostra il rifiuto del server quando l'articolo è dentro una comanda aperta.

C'è un **test nuovo** che cerca i tasti senza nessuno che li ascolti: se un domani ne resta uno
appeso, la suite lo dice invece di lasciarlo scoprire a chi lavora.

### Test
**246 verdi.**

## v5.45 — La cucina parla alla sala, e il magazzino dice la verità

### 🗑 "Fatto ma non servito" non è uno storno
Erano trattati allo stesso modo, e non lo sono: se il piatto è stato **cucinato** e poi non
servito, la merce è uscita davvero. Con lo storno la giacenza non se ne accorgeva, e
all'inventario restava un ammanco che nessuno sapeva spiegare.

Ora in cucina ci sono due gesti:
- **↩︎ Non si può fare** — ingrediente finito, il piatto non parte: niente conto, **niente
  scarico**.
- **🗑 Fatto ma non servito** — il piatto c'è, il cliente non lo prende: **fuori dal conto,
  dentro allo scarico**. Il motivo è obbligatorio, perché è quello che spiega lo sfrido a fine
  mese.

Un test lo verifica sul magazzino vero: nel primo caso la giacenza non si muove, nel secondo
cala di quello che è stato consumato.

### ❗ Il tavolo si accende
Se la cucina toglie una riga, il tavolo diventa **rosso con un punto esclamativo**, e aprendolo
la **prima cosa che si legge** è il messaggio dalla cucina — cosa è stato tolto, perché, e
"avvisa il cliente". Sotto, in blu, i piatti **da portare in tavola**.

L'avviso non si spegne da solo né aprendo il tavolo: aprirlo non vuol dire aver parlato con
nessuno. Si spegne toccando **✓ Ho avvisato il cliente**.

### Conto diviso: per posti occupati, arrotondato per eccesso
Si divide per le **persone sedute** — la prenotazione le conosce — non per i posti del tavolo,
e il numero si corregge a mano (i bambini che non pagano si tolgono). L'arrotondamento è
**sempre per eccesso al centesimo**, mai il resto sull'ultimo: fare pagare un centesimo in meno
a qualcuno costringe il cameriere a ricordarsi chi è "l'ultimo" mentre quattro persone gli
passano i soldi. La differenza è scritta accanto alla quota: o si restituisce, o resta mancia.

### Spostamento su un tavolo prenotato più tardi
Si fa. Quel turno comincia fra un'ora e mezza e il tavolo adesso è libero: dire di no sarebbe
dire di no a una cosa ragionevole per un problema che non esiste ancora. Ma chi accoglie lo
deve sapere, e il sistema glielo dice: *"il tavolo 7 è prenotato per le 21:30 a nome Rossi"*.

Il **cronometro** non è stato toccato: parte da quando la comanda è nata, quindi un tavolo
spostato resta rosso se aspetta da prima. Era già giusto.

### Test
**243 verdi.**

## v5.44 — Il rifiuto che non diceva cosa liberare

*"Ci sono N prenotazioni attive in questo ambiente: liberale prima di ridisegnare la pianta."*
Quali? Su che data? Il gestore restava a cercarle a mano per tutti i giorni futuri, e — visto che
poco prima aveva annullato una comanda — la conclusione naturale era che il sistema stesse
leggendo quella.

Ora il messaggio **elenca le prenotazioni che bloccano**: giorno, turno, tavolo, nome, coperti.
E chiude l'equivoco più probabile a chiare lettere: *annullare una comanda non libera il tavolo,
sono due cose diverse*. Verificato che sia vero: una comanda annullata **non** blocca il
ripristino, e c'è un test che lo tiene fermo.

## Il registro parlava in codice

Nel registro storico i fatti aggiunti negli ultimi giorni comparivano col nome tecnico —
`comanda_spostata` — perché l'etichetta leggibile non era stata aggiunta all'elenco. Ora ci
sono tutte (**Comanda spostata di tavolo**, **Riga stornata**, **Riga sostituita**), e se domani
se ne registra una nuova senza etichetta compare comunque una parola leggibile invece del nome
della colonna.

### Test
**240 verdi.**

## v5.43 — La tab Menù che mostrava solo un errore

`Cannot set properties of null (setting 'onclick')`, e la schermata vuota. Nella 5.42 avevo
scritto l'handler del tasto **Salva le modifiche** ma il tasto non l'avevo mai disegnato: in
JavaScript quell'errore interrompe tutta la funzione, quindi non mancava un pulsante — non
compariva **niente**. Il Crew non poteva più aprire il menù.

Il tasto ora c'è, in cima al listino, con accanto il contatore delle righe toccate. E c'è un
test nuovo che controlla che **ogni `onclick` punti a un elemento che viene davvero disegnato**:
verificato togliendo la riga del tasto, la suite diventa rossa e dice quale.

## La sala parte da tavoli quadrati da quattro

Come avevi chiesto. Il quadrato si accosta a un altro quadrato e fa una tavolata vera; il tondo,
accostato, lascia buchi e non regge il conto dei posti.

## "Ripristina predefinita" sembrava non funzionare

Funzionava, ma quando il sistema rifiutava — *"ci sono N prenotazioni attive: liberale prima di
ridisegnare la pianta"* — il motivo finiva in una riga grigia piccola in fondo alla pagina, che
nessuno guarda. Un rifiuto va detto in faccia: ora compare.

## Organizzazione sala

La tab "Tavoli & pianta" si chiama **Organizzazione sala**.

## Il testo dell'importazione era rimasto indietro
Elencava sei colonne su undici. Ora dice tutte quelle riconosciute, ricorda che l'intestazione
può essere scritta come viene (*"Prezzo (€)"* va bene) e che è lo **stesso foglio** che esce da
*Esporta menù*: si corregge nel foglio e si rimette dentro. È anche la risposta al "salvalo e
recuperalo da qualche parte" — **l'export è il backup del listino**, e reimportandolo torna
tutto, spunte comprese.

### Test
**239 verdi.**

## v5.42 — Il listino: prezzi che sparivano, un salva solo, export completo

### I prezzi azzerati all'importazione
Le intestazioni del file si confrontavano **esatte**: una colonna chiamata *"Prezzo (€)"* o
*"PREZZO unitario"* non veniva riconosciuta, e i prodotti nuovi entravano tutti a **zero**,
senza che niente lo segnalasse. Ce ne si accorgeva al primo scontrino.

Ora l'intestazione si ripulisce prima di confrontarla — accenti, simboli, parentesi, spazi — e
basta che cominci con la parola giusta. E se nel file **non c'è nessun prezzo leggibile**,
l'importazione si ferma e dice quali colonne ha letto, invece di caricare duecento righe a zero.
Se il gestore vuole davvero un listino senza prezzi, conferma.

### Un solo Salva per tutto il listino
Con duecento righe, un "Salva" per riga vuol dire duecento clic e duecento occasioni di
dimenticarsene una. Le modifiche — testo e spunte — si accumulano nella schermata, un contatore
dice quante righe sono state toccate e non ancora salvate, e **💾 Salva le modifiche** le scrive
tutte insieme. Ogni riga resta un aggiornamento parziale: si tocca solo quello che è stato
mandato, così un salvataggio in blocco non azzera niente.

### L'export contiene tutto
Il foglio esportato porta ora anche **attivo, alcolico (🔞), condimenti e complemento**, come
*sì/no*, e l'importazione li rilegge. Il giro export → correggo nel foglio → reimporto non perde
più le spunte per strada: è il modo più comodo per sistemare duecento righe in un colpo.

### Divieto di trasferimento su una tavolata unita
Come hai scelto: se il tavolo di partenza o quello di arrivo sono accostati ad altri, la comanda
**non si sposta**. Il sistema dice quali tavoli sono uniti e cosa fare — separare, o accostare
quelli che servono — e lascia alla crew il compito di preparare la sala prima di spostare. Se la
pianta del giorno non è leggibile non si blocca niente: si vieta solo quello che si vede davvero.

Il **tavolo guida** resta come sta, per tua indicazione.

### Test
**237 verdi**, fra cui il giro completo export → import, che verifica che le spunte tornino
identiche.

## v5.41 — La pianta che si cancellava da sola

Uniti i tavoli 1 e 2, poi toccato il tavolo 8, poi separati: il tavolo 2 non è tornato. Non era
"non ricomparso" — **era stato cancellato dalla pianta**, e la capienza della sala lo diceva:
48 posti diventati 44 senza che nessuno avesse tolto niente.

La causa è la stessa del "Salva" del listino di due giorni fa. Chi salva dalla sala manda i
tavoli che **vede**, e un tavolo accostato a un altro è nascosto: il salvataggio riscriveva
l'intera pianta con quella lista, e il tavolo nascosto spariva. Bastava correggere i posti di un
altro tavolo per perderlo. Ora l'aggiornamento è **parziale**: un tavolo si cancella solo se chi
salva dichiara di avere la lista completa — cioè dall'editor della disposizione, dove i tavoli si
tolgono apposta.

## ⚠️ "Annulla" chiedeva niente a nessuno

Un dito storto in mezzo al servizio e la comanda spariva, con dentro roba già mangiata. Ora
prima di annullare si vede **cosa si sta per perdere** — numero, righe, importo — e c'è una
riga che indica la strada giusta: se il cliente ha già consumato non si annulla la comanda, si
storna la singola riga.

## Com'è la serata, e quanto si può allargare

Due tavoli da quattro accostati **non fanno otto posti comodi**: gli angoli si perdono e si
mangia col gomito del vicino. Quanti posti costa ogni accostamento è ora un parametro (di
base 2: due tavoli da quattro tengono sei persone).

E la pianta dice in una parola com'è messa la serata — **Facile** sotto il 33% di prenotato,
**Buona** fino al 66%, **Difficile** oltre — perché è quello che dice a chi accoglie quanto
può essere generoso: con la sala mezza vuota una tavolata si allarga su tre tavoli, con la sala
piena si accosta il minimo, altrimenti si brucia la capienza per chi arriva dopo. Il tasto
Unisci si ferma da solo quando si supera il limite della serata, e spiega perché. Le due soglie
sono parametri del back office.

### Test
**232 verdi**, fra cui quello che riproduce esattamente la sequenza segnalata: unisco, tocco un
altro tavolo, separo — e i tavoli devono esserci tutti.

## v5.40 — In cucina si mandano cose da cucinare

Sulla scheda della cucina compariva **"Supplemento condimenti"** con il suo bel tasto
*Pronta ✔*, come se qualcuno dovesse cucinare cinquanta centesimi. È una riga di denaro: serve
al conto, non alla piastra. Non arriva più in cucina — resta in comanda, dov'è giusto che stia,
perché è quello che si paga.

E i condimenti non erano piatti a sé. Un panino con formaggio e verdure grigliate diventava
**tre voci separate con tre tasti**, più il supplemento: quattro righe da segnare "pronta" per
un panino solo. Ora la cucina vede **un piatto, una riga**, con dentro cosa metterci:

```
2×  Panino salsiccia e cipolla caramellata        [Pronta ✔] [↩︎]
      ↳ Formaggio svizzero
      ↳ Verdure grigliate (zucchine, melanzane…)
```

Un tasto solo, perché non si manda in tavola una maionese per conto suo.

### Test
**229 verdi**, fra cui uno che verifica che in cucina arrivi solo roba con un articolo dietro:
se un domani qualcuno ci rimette una riga contabile, la suite se ne accorge.

## v5.39 — Le tre cose che restavano dalle domande della crew

### ↤ Separare una tavolata, un tavolo per volta
Il "Separa" c'era, ma faceva una cosa sola e la faceva male: **sottraeva i posti che aveva
sommato**. Se nel frattempo qualcuno correggeva i posti della tavolata — succede, si aggiunge
una sedia — la separazione lasciava un tavolo con un numero sbagliato, e da lì in poi la sala
non tornava più.

Ora ogni tavolo ricorda quanti posti aveva **prima** di essere accostato, e separando torna a
quel numero. Verificato sul caso peggiore: due tavoli da 4, uniti a 8, una sedia aggiunta a
mano, separati → tornano 4 e 4. Con la vecchia sottrazione uno sarebbe rimasto a 5.

E si stacca **un tavolo per volta**: il gruppo si è presentato in meno, si rende alla sala
quello che non serve e si tiene accostato il resto. Prima si poteva solo sciogliere tutto.

### ➡︎ Cambio tavolo a comanda aperta
Il gruppo si sposta perché al sole non si sta, o si libera un tavolo più grande. Finora la
comanda restava attaccata al tavolo di partenza: a fine turno il conto compariva nel posto
sbagliato, col rischio di presentarlo a chi non aveva mangiato quella roba.

Ora si sposta dal pannello del tavolo. Il conto la segue intatto, e nel registro storico resta
scritto **da dove a dove, quando e chi l'ha spostata** — perché se poi qualcuno contesta il
conto di un tavolo, lo spostamento è l'unica cosa che spiega perché quella comanda sta lì. A
conto chiuso non si sposta più.

### ↩︎ La cucina può togliere una riga che non è in grado di fare
Ingrediente finito, piatto battuto per sbaglio: finora la cucina poteva solo segnare la riga
"pronta" e lasciare il problema alla sala, che se ne accorgeva davanti al cliente. Ora la toglie
dalla propria scheda, con il **motivo obbligatorio** — è lo stesso storno della sala: la riga
resta scritta, esce dal conto, dal KDS e dal magazzino, e finisce nel registro. Il messaggio
ricorda di avvisare la sala: il cliente va informato da una persona, non da un tabellone.

### Test
**228 verdi.**

## v5.38 — Quello che succede dopo che l'ordine è partito

Dalle domande per l'addestramento della crew sono usciti tre buchi veri. Non "miglioramenti":
cose che al banco, durante un servizio, lasciavano l'operatore senza risposta.

### 🔞 Alcolici e maggiore età
Al bar e al Garden si serve chiunque — la tessera identifica gli sportivi e i residenti, **non
è un lasciapassare per consumare** — ma per gli alcolici l'età conta, e finora il sistema non
la guardava mai. Ora:

- a un **minorenne identificato** gli alcolici non si vendono, e non c'è "per tramite di un
  adulto": non è un impegno di spesa, è un divieto di legge;
- **senza tessera** il sistema non sa quanti anni ha chi ordina, e non finge di saperlo:
  l'ordine passa, ma la comanda parte marcata **🔞 verificare la maggiore età**, che chi
  consegna vede sulla scheda. L'età la verifica una persona, guardando in faccia il cliente.

Una migrazione riconosce gli alcolici dal nome e dalla categoria; poi c'è la colonna **🔞** nel
listino, e la scelta del gestore vince sulla deduzione — un cocktail analcolico si corregge con
una spunta, e cambiare il prezzo non la rimette a posto da sola.

### ↩︎ Storno di una riga, e sostituzione
Un articolo finisce mentre la comanda è in cucina, il cliente rinuncia, il cameriere ha battuto
la riga sbagliata: finora si poteva solo **cancellare la comanda intera**, che in mezzo a un
servizio non è una risposta.

Ora si storna la singola riga, **con il motivo obbligatorio** — è quello che vale davanti a una
contestazione. La riga non si cancella: resta nel dettaglio, sbarrata, con il motivo e chi l'ha
stornata. Sparisce dal conto, dal KDS e dallo scarico di magazzino, e finisce nel registro
storico. Con il piatto se ne vanno i suoi condimenti e il suo supplemento.

Se il cliente accetta un'alternativa, la **sostituzione** fa tutto in un gesto: storna la
vecchia, inserisce la nuova con la stessa quantità e aggiorna il conto — così al banco non si
rischia di stornare e dimenticarsi di aggiungere.

A conto chiuso lo storno viene rifiutato: un rimborso dopo l'incasso non è una riga di comanda.

### Conto diviso
Sul conto del tavolo si indica in quanti sono e si legge la quota a testa. Il totale resta uno:
si divide per comodità di chi paga, non si spezza il conto.

### Test
**225 verdi.**

### Le altre domande
*No-show*: i due turni lo rendono un non-problema, niente da fare. *Panino prima delle 16*: già
risolto in v5.27. *Sfrido e rettifica*: il movimento di rettifica esiste già. *Unione tavoli*:
c'è; la **divisione** di una tavolata e il **cambio tavolo a comanda aperta** restano da fare.

## v5.37 — `eur is not defined`

Il supplemento dei condimenti non compariva nel totale. Non era il calcolo: era che **il totale
non si aggiornava affatto**. Nell'app dei soci la riga che lo scrive chiamava `eur(...)`, una
funzione che nell'app **non esisteva** — c'era nel Crew, c'era nella pagina QR, c'era dentro il
componente del menù, ma non nell'app.

L'effetto per chi ordinava: il totale resta vuoto, il supplemento non si vede, e **"Invia
ordine" non si accende mai**. L'effetto per chi cercava il difetto: dal server risultava tutto
corretto — 6,00 + 0,50 = 6,50, verificato mille volte — perché il difetto stava nel browser, e
il browser ingoia l'eccezione dentro il gestore dell'evento senza dire niente a nessuno.

È la ragione per cui abbiamo girato attorno a questa faccenda per giorni guardando dalla parte
sbagliata. Ora la funzione c'è, definita una volta sola: **€ 6,00 → € 6,50** con due condimenti
spuntati, verificato in un browser vero e non a ragionamento.

### Perché non ricapiti
I test sulle API non possono vedere un difetto del browser: girano sul server. C'è ora
`tests/frontend.test.js`, che controlla che ogni front-end **definisca gli aiutanti che usa** —
`eur`, `esc`, `T`, `api`, `setSheet` e compagnia. Le funzioni dentro `shared/comanda.js` non
contano: vivono in uno scope chiuso e dall'esterno si vede solo `Comanda`. Dare per buone le sue
funzioni sarebbe lo stesso errore concettuale del difetto.

Verificato togliendo davvero la definizione di `eur` dal sorgente: la suite diventa rossa e dice
quale front-end chiama cosa senza averlo.

### Un secondo difetto latente
Cercando, è saltato fuori `openVuoiGiocare()`: chiamata nella gestione dei tocchi, mai definita
da nessuna parte. Non esplodeva perché nessun elemento porta l'attributo che la attiva — ma
sarebbe bastato aggiungerlo. Tolta la chiamata e il selettore morto.

### Test
**218 verdi.**

## v5.36 — Il registro storico, e i condimenti che erano solo spenti

### Perché i condimenti non comparivano
Nessun distinguo fra "condimenti" e "complementi": nel sistema la categoria *Condimenti*,
*Condimenti extra* e la spunta Compl. sono la stessa identica cosa, verificato. Le quattro voci
del listino reale erano semplicemente **spente** — colonna Attivo non spuntata — e un prodotto
spento non esiste per nessuno: né come voce del menù, né come casella dentro il panino.

Perché non si debba più cercarlo: **l'avviso ora compare da solo in cima al listino** del Crew,
in rosso, con il motivo e il tasto per aprire la diagnosi. Prima bisognava sapere che esisteva
un tasto e premerlo.

L'etichetta nel menù dice comunque *condimenti* dalla 5.35: era una parola diversa dalla tua, e
già solo per quello valeva la pena cambiarla.

## 📚 Registro storico — la memoria lunga

Davanti a una contestazione — *"io avevo prenotato"*, *"quel conto non l'ho mai fatto"*, *"chi
ha cancellato?"* — la risposta non può essere "mi pare". Ogni fatto lascia ora una riga:
**cosa è successo, quando, a nome di chi, e chi lo ha chiesto**, con il canale (app, QR, crew,
back office) e l'importo.

Tre regole lo rendono una prova e non un elenco:

1. **Si scrive, non si riscrive.** Una prenotazione disdetta **aggiunge** una riga; quella di
   quando fu presa resta intatta. Le due insieme raccontano la storia — una riga corretta a
   posteriori non racconta niente. C'è un test che lo verifica.
2. **Si conserva quindici anni.** Nessuna pulizia periodica tocca la tabella.
3. **Si scrive chi ha chiesto.** Per una contestazione conta se ha disdetto il socio dal
   telefono, un operatore al banco o il gestore dal back office.

Nel Crew c'è la scheda **Registro storico**: si cerca per periodo, servizio, tipo di fatto e
nome (di chi ha prenotato o di chi ha agito), e si esporta in CSV per allegarlo a una risposta
scritta. Si legge soltanto: non esiste alcuna rotta che modifichi o cancelli una riga.

Registrati da subito: prenotazioni del Garden prese e cancellate, comande aperte dall'app, dal
QR e dal cameriere, comande chiuse e annullate.

### Test
**214 verdi.**

## v5.35 — «Necessita condimenti»: una spunta sul prodotto

Avevi ragione, e il problema non erano i dati: era il concetto. Ho provato tre strade per far
comparire i condimenti dentro il piatto — abbinamento uno a uno, poi "tutto quello che esce
dalla cucina", poi la categoria — e tutte e tre **deducevano** invece di lasciar decidere. Ogni
volta bastava che un dato fosse storto (la colonna *Chi prepara* sporcata da un comando in
massa: 55 voci su 60 marcate cucina, caffè compreso) perché la maionese finisse in una tazzina
o non comparisse affatto.

Ora è **una spunta fisica sul prodotto**, nella colonna **Condimenti** del listino. Chi ce l'ha,
nel menù del Bar e del Garden, mostra dentro di sé la riga **«condimenti»**: si tocca e si
aprono le caselle da fleggare, a **€ 0,50 in tutto** qualunque sia il numero. Chi non ce l'ha
non la mostra, e nessuno può attaccargli un condimento nemmeno spedendo l'ordine a mano.

**Chi prepara il piatto non c'entra più.** Un panino marcato "lo faccio al banco" mostra la riga
lo stesso, se ha la spunta; un caffè marcato "cucina" non la mostra, perché la spunta non ce
l'ha. Due test fissano proprio questi due casi.

L'etichetta nel menù dice ora **condimenti**, non "complementi": è la parola che usi tu.

### All'aggiornamento
Una migrazione accende la spunta su panini, piatti, fritti e insalate — **guardando il nome e la
categoria, non la colonna "Chi prepara"**, che nel listino reale è compromessa. Nei log di avvio
comparirà quante ne ha accese. Da lì in poi comandi tu: la colonna è nel listino, la vedi e la
cambi riga per riga.

### Test
**211 verdi.**

## v5.34 — Il caffè espresso non lo prepara la cucina

La diagnosi, girata sul listino vero, ha trovato una cosa più grave dei condimenti: **55 voci su
60 risultavano "preparate dalla cucina"**, caffè espresso compreso. Quelle comande finiscono sul
KDS Cucina, dove nessuno le prepara, e si portano dietro i condimenti dentro la tazzina.

Non è colpa della deduzione automatica — verificata sui nomi reali, manda correttamente caffè,
amaro, granita e gelato al banco. È il comando **"Da preparare, in entrambi i punti"** applicato
a categorie che non c'entravano: cinquanta voci cambiate in un colpo, e nessun modo di
accorgersene se non dal servizio che non funziona.

### Tre interventi
- **La diagnosi lo vede e lo dice**: elenca i prodotti la cui stazione non torna con quello che
  sono, e mette in cima il verdetto in chiaro con i nomi.
- **🔧 Rimetti a posto "Chi prepara"**: ricalcola la stazione su tutto il listino, ma prima
  **mostra l'elenco di cosa cambierebbe** — nome, categoria, da cosa a cosa — e cambia solo dopo
  la conferma. L'anteprima non tocca niente: c'è un test che lo verifica.
- **Il comando in massa ora si ferma**: se fra le categorie scelte ci sono prodotti da banco, li
  conta, ne mostra qualcuno e chiede conferma prima di mandarli in cucina. Si può forzare, ma
  sapendo cosa si sta facendo.

### Sui condimenti del listino reale
Le quattro voci in categoria *Condimenti extra* sono spente, e i loro nomi sono elenchi di
ingredienti ("Formaggio svizzero, mozzarella, prosciutto crudo", "Olive, funghi sott'olio,
melanzane sott'olio, cappuliato"). Somigliano alla **composizione dei panini** finita a listino
come prodotto, non a quattro condimenti da spuntare: come caselle sarebbero illeggibili. È una
decisione di prodotto, non un difetto da correggere in automatico.

### Test
**209 verdi.**

## v5.33 — Il menù vive in un mondo suo

C'è voluta un'analisi seria per vedere che il problema non era una funzione che non andava, ma
**cinque posti che rispondevano alla stessa domanda in cinque modi diversi**: l'app chiedeva il
menù con la zona, la pagina QR senza, il Crew con un parametro, il Crew dal tavolo con due, la
stampa PDF prendeva il listino grezzo. La stessa persona vedeva elenchi diversi a seconda di
dove ordinava, e ogni correzione andava ripetuta cinque volte — o dimenticata quattro.

Ora c'è **`server/menu.js`**: una funzione sola risponde a "cosa si ordina da questo punto, e
cosa ci si spunta dentro". La chiamano l'app dei soci, il QR al tavolo, la comanda della Crew e
la stampa del menù. Se una regola cambia, cambia lì e vale per tutti nello stesso istante. Le
regole erano anche duplicate fra due file: in `server/cucina.js` è rimasto solo l'orario.

Un test verifica che l'elenco del socio e quello di chi batte la comanda **coincidano**, punto
per punto: se un domani divergono, la suite si spegne.

## Due protezioni che non proteggevano niente

**Il vincolo sul menù non è mai scattato.** La regola cercava in `comanda_righe` una colonna
`articolo_id` che non esiste — si chiama `menu_id`. La query andava in errore e il `try/catch`
lo leggeva come "nessun vincolo". Conseguenza: si poteva cancellare un prodotto **dentro una
comanda aperta**, e quella comanda perdeva il collegamento e smetteva di scaricare il
magazzino. In silenzio, fino all'inventario.

**L'import "sostituisci" aggirava la stessa protezione**, facendo `DELETE` di tutto il listino
senza chiedere niente. Ora si ferma, dice quanti prodotti sono dentro comande aperte e cosa
comporterebbe procedere; il gestore può confermare, ma sapendo.

## 🩺 Diagnosi del menù

Per tre versioni ho risposto "adesso c'è" a chi apriva l'app e non vedeva niente, perché
ragionavo sul codice mentre il problema stava nei dati. Nel menù del Crew c'è ora un tasto che
legge il **listino vero** e dice quale condizione non è soddisfatta: quanti condimenti
riconosce, quanti sono spenti, quanti piatti hanno stazione Cucina, quanti prodotti si ordinano
al Bar e quanti al Garden, e per un piatto campione cosa ci troverà dentro il socio. Se qualcosa
non torna lo scrive in chiaro — *"I condimenti che hai sono SPENTI: riaccendili nella colonna
Attivo"* — invece di lasciare indovinare.

## Gli ordini sono davvero acquisiti

Verificata tutta la catena su un database vero, non a parole: l'ordine dal Bar viene accettato,
la comanda esiste nell'elenco della Crew, resta nella zona da cui è partita, porta la riga del
piatto con la quantità giusta, il condimento a prezzo zero e **un solo** supplemento; compare
nel KDS Cucina e non in quello del banco; alla chiusura la giacenza cala davvero (50 → 48 su due
panini) e la comanda si segna scaricata, così non scarica due volte. Lo stesso vale per la
comanda battuta dal cameriere al tavolo. La prova sta in `scripts/verifica_ordini.mjs` e si può
rilanciare quando serve.

## Allineamenti minori
- La pagina QR mostrava tutto il listino, Bar compreso, anche a un tavolo del Garden.
- La comanda della Crew ignorava la zona della postazione.
- La stampa del menù includeva i condimenti come voci ordinabili.

### Test
**207 verdi.**

## v5.32 — L'app parla davvero quattro lingue

Prima di questa versione, delle **540 stringhe** dell'app dei soci ne erano tradotte **317**: due
su cinque restavano in italiano, e in tutte e quattro le lingue mancavano esattamente le stesse
— segno che le traduzioni erano state aggiunte a blocchi e poi non più inseguite.

Il guaio non erano le briciole: mancavano **Home, Settimana, Guida, Cena, Chiama** — cioè la
barra di navigazione — più "Oggi al residence", "Prenota la cena", "Ti hanno convocato",
"Numeri rapidi". Un ospite che sceglieva il tedesco si trovava un'app mezza italiana, e la metà
rimasta in italiano era proprio quella che serve per muoversi. Meglio non offrire una lingua che
offrirla così.

Ora sono **540 su 540** in inglese, francese, tedesco e spagnolo. Tolte anche 96 voci morte:
traduzioni di testi che nell'app non esistono più.

Il tasto **Tessera** in testata era scritto direttamente nell'HTML e non passava dal traduttore:
restava l'unica parola italiana in mezzo a una schermata tedesca. Ora si traduce con le altre.

### Perché non ricapiti
Tappare i buchi non basta: fra due settimane arriva una funzione nuova con venti stringhe e
siamo daccapo. Nel `npm test` ci sono tre controlli nuovi:

- ogni stringa che l'app passa al traduttore **deve** avere una traduzione in tutte e quattro le
  lingue — la suite diventa rossa e dice quali mancano e dove;
- nessuna traduzione vuota, che nasconderebbe il testo invece di tradurlo;
- nessuna voce morta nel dizionario.

Verificato che il controllo scatti davvero, aggiungendo apposta una stringa non tradotta.

### Cosa resta in italiano, e va bene così
I **contenuti che scrive il gestore** — titoli delle serate, sottotitoli, etichette dei
pulsanti degli eventi — vengono dal database e non passano da nessun dizionario: nella
schermata in tedesco si legge ancora "Jazz & Cocktail · Prenota un tavolo". Tradurli
richiederebbe un campo per lingua nel back office: è un lavoro a sé, da decidere.

### Test
**203 verdi.**

## v5.31 — Family feeling: la stessa griglia, non una griglia qualsiasi

Nella 5.30 avevo messo il fitness "a griglia" nel Crew, ma era una griglia di schede: la mia
idea di griglia, non quella che c'è già nell'app dei soci. Sono due prodotti dello stesso
posto, e devono somigliarsi.

Ora il Crew mostra il **calendario settimanale identico**: chip delle settimane, giorni in
colonna, ore in riga, il blocchetto colorato della disciplina. Chi al banco riceve un socio che
dice *"la lezione di giovedì alle sette"* vede la stessa cosa che quel socio ha sul telefono,
nella stessa posizione — non un elenco ordinato in un altro modo.

Il blocchetto porta in più quello che serve a chi lavora: iscritti su posti, e il segno 💶 se
c'è ancora da incassare. La barra colorata a sinistra dice se la lezione è confermata, in
attesa o al completo, con gli stessi colori dell'app. Toccandola si apre il pannello con gli
iscritti, l'incasso di ciascuno e l'iscrizione al banco — le funzioni di prima, raggiunte dallo
stesso gesto del socio.

Sopra la griglia, tre numeri per il turno: quante lezioni ci sono in settimana, quante sono
sotto il minimo e quanto resta da incassare.

### Test
**200 verdi.**

## v5.30 — Il Salva che cancellava quello che non gli avevi detto

Il difetto peggiore di questa tornata non si vedeva: **ogni "Salva" su una riga del listino
azzerava la descrizione del prodotto e il collegamento al magazzino.** La riga manda nome,
prezzo, stazione, punto, categoria, allergeni e attivo — non manda la composizione del piatto
né la distinta, e l'UPDATE riscriveva comunque tutte le colonne con quello che non aveva
ricevuto, cioè vuoto. Chi correggeva un prezzo perdeva lo scarico di giacenza di quel prodotto
e non se ne accorgeva fino all'inventario.

Ora il salvataggio tocca **solo i campi che gli sono stati mandati**. Un test riproduce
esattamente quello che invia la riga del listino e verifica che descrizione e magazzino
sopravvivano.

## I condimenti si riconoscono anche dalla categoria

Legare la funzione a una spunta che qualcuno deve ricordarsi di mettere è lo stesso errore che
ha tenuto il panino fuori dal Bar per tre versioni. Ora una voce in categoria *Condimenti
extra*, *Salse* o *Aggiunte* è un'aggiunta anche senza la spunta: sparisce dall'elenco e
compare dentro i piatti della cucina. La spunta **Compl.** resta la via esplicita, per i casi
che il nome della categoria non copre.

## QR dei tavoli: erano rotti, non assenti

Il tasto rispondeva *"QR non disponibili"* qualunque cosa succedesse. L'indirizzo usato era
`/../qr-ordina`, che il browser normalizza in `/api/qr-ordina` — un percorso che non esiste — e
l'errore veniva ingoiato da un `catch` vuoto. Corretto l'indirizzo; e se qualcosa va storto, il
messaggio ora dice cosa.

## Due cose di forma

- **Discipline nel Crew**: la tendina di chi segna i risultati mostrava anche quelle spente. Ora
  compaiono solo le discipline in cartellone.
- **Fitness a griglia**, come il resto del Crew: prima era una colonna di schede alte quanto lo
  schermo, e per sapere se una lezione aveva raggiunto il minimo bisognava scorrere.

### Test
**200 verdi.**

## v5.29 — Chi prepara il piatto si capisce da solo

Nel listino reale la colonna **Chi prepara** diceva *Bar* su tutto: piatti da dieci euro,
insalate, caprese, panini. Nel sistema non esisteva nemmeno una voce di cucina — ed è la
ragione di tre difetti che sembravano scollegati:

- il Bar non mostrava i panini (la regola della v5.27 aspetta la cucina, e la cucina non c'era);
- i condimenti non comparivano in nessun piatto (stessa ragione);
- il KDS Cucina restava vuoto.

Nessuno marca a mano duecento righe, e infatti non era stato fatto. Ora **chi prepara si deduce
dal nome e dalla categoria**, come già succedeva per la categoria stessa: panini, piatti,
fritti, insalate, verdure e condimenti vanno in cucina; caffè, amari, birre, granite restano al
banco. Vale per il listino già caricato (una migrazione), per quello che si importerà e per i
prodotti creati a mano. La colonna resta: se una voce finisce nel posto sbagliato si corregge, e
**la scelta esplicita del gestore vince sulla deduzione**.

La stessa migrazione segna come aggiunte le voci della categoria dei condimenti, così anche
quell'ultima spunta è tolta di mezzo.

L'anteprima dell'importazione mostra ora la stazione che verrà davvero assegnata: prima
mostrava "bar" per tutto e il gestore approvava un'importazione diversa da quella che sarebbe
avvenuta.

## Al Garden si lavora sulla Pianta

La tab **Comande** del Garden conteneva solo un rimando a un'altra tab. È sparita: la comanda si
prende toccando il tavolo, e il pannello degli **ordini dal QR** (sospendi, pressione cucina,
attesa stimata) è salito sulla Pianta, davanti ai tavoli — è guardando la sala che si decide se
sospendere gli ordini dal telefono, non da una schermata a parte.

## Un tavolo, un conto

Chi comincia col QR e poi chiama il cameriere non deve trovarsi due conti. Le comande dei due
canali finivano già nello stesso posto, ma mancavano il totale e la chiusura: ora il tavolo
mostra **Conto del tavolo** con la somma, quante comande vengono dal telefono e quante dalla
crew, e un tasto **💶 Chiudi il conto** che le chiude tutte insieme. Resta possibile chiuderne
una sola, se serve.

### Test
**198 verdi**, fra cui: un panino importato senza stazione finisce in cucina e da lì compare al
Bar con le sue aggiunte; un amaro resta al banco; se il gestore scrive "bar" su un panino, la
deduzione non lo contraddice.

## v5.28 — I condimenti non stanno nella tazzina del caffè

Avevo messo il tasto di abbinamento **su ogni riga del listino**: caffè espresso, granita, rum
invecchiato. Per far comparire la maionese dentro i panini bisognava aprire un pannello piatto
per piatto e spuntare gli abbinamenti — una configurazione assurda in cambio di una funzione
che vale cinquanta centesimi.

Via tutto. I condimenti sono un insieme solo e si spuntano dentro **quello che esce dalla
cucina**, per regola. Nella tazzina del caffè non ci vanno, perché il caffè lo fa il banco.

### Cosa resta da fare al gestore
Una spunta: nel listino, la colonna **Compl.** dice che quella voce è un'aggiunta. Da quel
momento sparisce dall'elenco e compare dentro ogni piatto della cucina. Nient'altro.

### Cosa è sparito
Il tasto 🧩 da tutte le righe, il pannello di abbinamento, "Applica a tutta la categoria", il
comando "Riconosci i condimenti" e le rotte che li servivano. La tabella degli abbinamenti non
è più letta da nessuno.

La regola sta in `server/cucina.js` insieme alle altre due, ed è la stessa per l'app, per il QR
e per la comanda della Crew. Il server rifiuta un condimento attaccato a un prodotto del banco
anche se l'ordine arriva a mano.

### Test
**195 verdi.** I tre test sui comandi di abbinamento sono stati cancellati: non hanno più
oggetto. Al loro posto due nuovi — le aggiunte compaiono in ogni piatto di cucina e in nessun
prodotto del banco; un condimento spedito su un caffè non entra né in comanda né in conto.

## v5.27 — La cucina serve tutti i punti. Punto.

Per tre versioni il panino al Bar è dipeso da come i prodotti erano marcati nel listino, e ogni
volta bastava un dato storto perché sparisse. Ho continuato a rispondere "adesso c'è" a chi
apriva l'app e non vedeva niente. Smetto di farlo dipendere dai dati: **quello che prepara la
cucina si ordina da ogni punto vendita, per regola di server**. Nessuna configurazione può più
nasconderlo. Solo ciò che si serve al banco — bibite, caffè, alcolici — resta legato all'area
in cui si vende.

La colonna *Dove si vende* continua a esistere e a governare l'ordinamento del menù, ma per i
piatti di cucina non toglie più niente a nessuno. Le regole stanno tutte in `server/cucina.js`,
un file solo, valido per l'app dei soci, per il QR al tavolo e per la comanda della Crew.

## Prima delle 16 l'ordine si prende lo stesso

Nessuno si sente rispondere di no per l'orario. Chi ordina un panino alle 15:40 lo ordina: la
comanda entra, e porta scritta l'ora del primo ritiro. L'ora esce da due parametri —
**apertura della cucina** (16:00) e **minuti di riscaldamento** di piastra e friggitrice (15) —
quindi il primo ritiro è alle 16:15, e si cambia dal registro dei parametri senza toccare il
codice. Passata quell'ora non si avvisa più nessuno.

L'avviso arriva a tutti e tre: al socio nella conferma d'ordine, al cameriere che batte la
comanda (così può dirlo al tavolo prima di andarsene), e alla cucina sulla scheda del KDS —
🔥 *non prima delle 16:15* — perché quella comanda non è in ritardo, è in attesa.

Un ordine di solo banco non aspetta niente: una birra non ha bisogno che la friggitrice sia
calda.

### Test
**196 verdi.** Fra questi, uno che prima passava ora dice il contrario: marcare un panino "solo
Garden" non lo nasconde più al Bar. Era la vecchia regola, ed è stata sostituita.

## v5.26 — Un tasto d'oro che non diceva niente

Nella scheda del lunedì c'era un pulsante dorato **senza testo**. Il lunedì è il giorno di
riposo del residence: non ha una CTA, e non deve averla. L'app però disegnava il bottone
comunque, stampando un'etichetta vuota — un invito a premere qualcosa che non esiste.

Ora il bottone compare solo se c'è davvero qualcosa da fare. E se un domani una serata avesse
un'azione ma la casella dell'etichetta restasse vuota nel back office, l'azione non si perde:
si scrive una parola sensata al posto del nulla.

Stessa correzione sul riquadro "Stasera" in Home, che aveva lo stesso difetto.

## v5.25 — Un menù solo, anche per chi lo batte al tavolo

La comanda che la Crew apre dal tavolo prendeva il **listino grezzo** invece dell'elenco
ordinabile. Risultato: al cameriere ricompariva "Condimenti extra" come categoria, e dentro i
panini non c'era nessuna spunta. C'erano di fatto due menù diversi per lo stesso locale — quello
del socio e quello della Crew — ed è esattamente il contrario del principio per cui il menù è
un nucleo solo.

Ora `/api/admin/menu?ordinabile=1` restituisce quello che vede il socio: condimenti fuori
dall'elenco, aggiunte spuntabili dentro il piatto, supplemento incluso, filtro per punto
vendita. La gestione del listino continua a vedere tutto, complementi compresi — lì serve.

### E la comanda della Crew adesso li registra
Prima li ignorava del tutto: il cameriere poteva anche spuntarli, in cucina non arrivava
niente. Ora seguono la stessa regola dell'app — righe figlie a prezzo zero agganciate al
piatto (che la cucina legge e il magazzino scarica) e **un solo supplemento**, qualunque sia il
numero di spunte.

### Test
**192 verdi**, fra cui: i due elenchi del menù devono coincidere su ciò che si ordina; i
condimenti spuntati dal cameriere arrivano in cucina e in conto come per il socio.

## v5.24 — Il panino si ordina anche dal Bar (davvero, stavolta)

Per tre versioni ho scritto che dal Bar si poteva ordinare un panino, e chi apriva l'app non
ne vedeva nemmeno uno. Il difetto stava in una riga della deduzione automatica del punto
vendita: **tutto quello che passa dalla cucina veniva chiuso nel Garden**. Chi prepara e dove
si vende sono due cose diverse — la cucina fa il panino, ma il panino si vende in tutte e due
le aree. Ora la regola dice questo:

- i piatti già a listino che escono dalla cucina passano a **Entrambi** con una migrazione, senza
  che nessuno debba premere niente;
- un prodotto nuovo di cucina **nasce** vendibile in tutte e due le aree;
- se il gestore ne vuole uno solo al Garden lo dice nella colonna *Dove si vende*, e la sua
  scelta vince sulla regola.

Due test nuovi bloccano il difetto: al Bar devono comparire i piatti della cucina, e la comanda
del Bar deve restare del Bar pur arrivando al KDS Cucina.

## Al tavolo del Garden si ordina col QR, non digitando il numero

Il campo "numero del tavolo" nell'app era una scorciatoia sbagliata: chiedeva al socio un dato
che il locale conosce già, e lo apriva agli errori di battitura. L'ordinazione al tavolo torna
**in capo alla Crew**; nell'app, al suo posto, c'è **📷 Inquadra il QR del tavolo**, che legge il
codice stampato sul tavolo e porta all'ordinazione con il numero giusto già dentro. Se il
telefono non sa leggere i codici, l'app lo dice e rimanda alla fotocamera del telefono.

Nell'app resta l'ordine **al banco**, che non ha bisogno di nessun tavolo.

### Test
**190 verdi.**

## v5.23 — I condimenti si spuntano, non si contano

Un condimento non ha un prezzo suo. Si spunta e basta: chi ne prende uno e chi ne prende
quattro paga **lo stesso supplemento**, una volta per piatto. Il listino del singolo condimento
sparisce dalla schermata di chi ordina — dove prima si leggeva *+ € 0,50 · + € 0,30 · + € 0,80*
ora c'è una riga sola, in cima all'elenco: **€ 0,50 in tutto, quanti che ne scegli**.

Il valore è un **parametro** (Comande → Supplemento condimenti), non il prezzo di ogni voce: si
cambia in un punto e vale per tutto il menù. A zero i condimenti diventano gratis e in conto non
compare niente.

### In cassa e in cucina si vede da dove viene
Le righe dei condimenti restano, ma valgono zero: servono alla cucina per sapere cosa mettere
nel panino e al magazzino per scalare la maionese. Il denaro sta su una riga a sé,
**Supplemento condimenti**, agganciata al piatto — così chi legge il conto capisce l'addebito
invece di trovarsi un panino che costa 6,50 senza spiegazione.

### Il menù è un nucleo solo
Tolta l'eccezione introdotta in 5.21, per cui il Bar si tirava dietro tutta la cucina. Bar e
Garden ora sono **due chiamate identiche allo stesso menù**: la differenza la fa il prodotto,
non la chiamata. Un piatto lavorato che si vende in tutte e due le aree si segna **Entrambi**
nella colonna *Dove si vende* e resta **Cucina** in *Chi prepara*. Le due colonne hanno smesso
di chiamarsi "Staz." e "Punto": adesso dicono quello che sono.

### Grafica
Il collegamento *complementi* stava sulla stessa riga del prezzo e strozzava il nome del
prodotto su quattro righe. Ora va a capo.

### Test
**188 verdi**, fra cui: quattro condimenti costano come uno; il supplemento è una riga sola in
comanda; a supplemento zero non compare nulla.

## v5.22 — I condimenti si riconoscono a comando, non a indovinare

La 5.21 provava a riconoscere i condimenti da sola al primo avvio, cercando una categoria che
somigliasse a "Condimenti extra" e attaccandoli ai piatti con stazione **Cucina**. Sul menù
reale non ha trovato quello che si aspettava: i condimenti sono spariti dall'elenco e non sono
ricomparsi dentro i panini. Il difetto non era l'abbinamento sbagliato — era che **lavorava al
buio e non diceva niente**.

Ora c'è un comando, nel menù del Crew: **🧩 Riconosci i condimenti**. Dice quanti ne ha
trovati, in quali categorie, e a quanti piatti li ha attaccati. Se il conto è zero elenca le
categorie che hai davvero a menù, così si capisce subito che si chiamano in un altro modo. Se
i condimenti li trova ma i piatti no, dice anche quello: vuol dire che nessun articolo ha
stazione Cucina.

### E se i nomi non tornano
Si spunta **Compl.** a mano sulle voci che sono aggiunte, poi si apre **🧩** su un piatto, si
scelgono i condimenti e si preme **Applica a tutta la categoria**: gli stessi condimenti
finiscono su tutti i panini in un colpo solo, senza farli uno per uno.

### Test
**185 verdi.**

## v5.21 — Il condimento sta dentro il panino

La categoria "Condimenti extra" stava **in cima al menù**: la prima cosa che vedeva chi
voleva mangiare erano la maionese e la cipolla, come voci da ordinare per conto loro. Non è
così che si ordina un panino. Ora il condimento è un **"di cui"** del piatto: si tocca
*complementi* nella riga del prodotto e si spunta sì/no, senza quantità — nessuno ordina tre
maionesi, e se prendi due panini la vogliono entrambi.

### Resta un articolo vero
Il complemento non diventa una nota. Mantiene il suo prezzo, il suo collegamento al magazzino
e la sua distinta: in comanda arriva come **riga propria agganciata al piatto**, preparata da
chi prepara il piatto e conteggiata tante volte quanti sono i piatti. Nel Crew si legge
rientrata sotto il piatto, con la freccia. Lo scarico di magazzino la vede come vede tutto il
resto — se avessimo scritto "+ maionese" nelle note, la maionese non sarebbe mai uscita dalla
giacenza.

Si accettano solo i complementi davvero abbinati a quel prodotto: uno spedito da fuori non
entra né in comanda né nel conto.

### Chi decide gli abbinamenti
Nel menù del Crew ogni voce ha ora la spunta **Compl.** (è un'aggiunta: sparisce dall'elenco)
e il tasto **🧩** (quali aggiunte compaiono in quel piatto). Il legame è per singolo prodotto:
la maionese sta nel panino, non in tutta la categoria.

Una migrazione una-tantum riconosce i condimenti già a listino e li abbina ai piatti che
escono dalla cucina, così il menù si sistema da solo. Non cancella niente: se un abbinamento
non va, si toglie dal Crew.

## La cucina apre con il bar

Chi arriva alle 16 e vuole un panino non deve sentirsi dire che la cucina apre alle 19. Il
problema non era un orario — non ce n'era nessuno nel codice — ma il fatto che i panini
appartengono al Garden e **non comparivano nel menù del Bar**. Ora dal Bar si ordina anche
quello che esce dalla cucina, nello stesso carrello. La comanda resta del Bar e non finisce
sulla mappa dei tavoli del Garden; la riga del panino arriva comunque alla Cucina.

## Ordina dal Tavolo

Al posto della spiegazione su come assegniamo i tavoli ("partendo da quelli più al centro")
c'è il tasto che serve: **Ordina dal Tavolo**. In alto si indica il numero del tavolo, perché
l'ordine deve sapere dove sei seduto. Se hai prenotato per oggi il numero è già scritto — è
quello che ti abbiamo assegnato noi — e si corregge se ti hanno spostato.

## La conferma della cena arriva sul telefono

Prenotato il tavolo, parte una notifica con **giorno, turno e tavolo**: la sera la ritrovi
senza riaprire l'app. Se le notifiche non sono attive non cambia nulla, la prenotazione è
fatta lo stesso.

## Due diciture in meno
- *"Posti contati: si prenota e si paga in loco."* — via dalle serate speciali. Ai minorenni
  resta solo quello che serve davvero sapere: fino ai 18 anni le prenota un adulto.
- *"Il programma completo della settimana è nella sezione Eventi."* — via dal fondo del menù.

### Test
**182 verdi.**

## v5.20 — La settimana in una schermata

Sette giorni che si leggono **tutti insieme**, senza scorrere: e' il motivo per cui questa
schermata esiste — il ritmo della settimana si coglie guardandolo intero.

Ogni giorno e' ora **una riga**: sigla del giorno, titolo e sottotitolo **sulla stessa riga**,
l'ora se c'e', e la striscia di colore dell'ambiente. Da 76 pixel a **38** per riga: il
contenuto passa da 700 a 437 pixel e sta dentro lo schermo di un iPhone (844) e di un Android
piu' piccolo (740), verificato su entrambi.

### Come si divide lo spazio
Il titolo tiene fino al 62% della riga e il resto va al sottotitolo. Su sette serate reali,
**sei titoli si leggono per intero**; si accorcia solo *"Cinema d'autore sotto le stelle"*, che
e' il piu' lungo — e proprio li' il posto guadagnato serve a mostrare **il film in programma**,
che e' l'informazione che si cerca.

Il resto — luogo, costo, artista, sinossi — si vede toccando: la riga e' un indice, non una
scheda.

### Test
**178 verdi.**

## v5.19 — Rassegna in home, e la Settimana torna a essere una cosa sola

### Rassegna cinematografica in evidenza
Nuovo tasto in home, con la stessa evidenza delle serate speciali: apre l'elenco dei film della
stagione con regia, anno, durata, genere e sinossi, piu' il tasto per salvarla o stamparla.

### Senza date, per scelta
La rassegna **non mostra le date**, nemmeno quelle gia' fissate. Una serata eccezionale che il
residence vuole promuovere, o semplicemente il maltempo, spostano una proiezione: una data
scritta e poi cambiata vale meno di nessuna data. Una nota lo spiega e indirizza dove il giorno
e' certo — la sezione **Stage**, che e' anche dove si prenota il posto.

### La Settimana e' il ritmo della settimana
Le serate su prenotazione comparivano **in fondo** alla schermata Eventi, ripetendo cio' che la
home mette gia' in evidenza con un tasto: era metterle in ombra due volte invece di valorizzarle
una. Tolte da li'. La schermata si chiama ora **La settimana** (anche nella barra in basso, in
tutte e tre le lingue) e contiene solo il ritmo dei sette giorni, con una riga che rimanda alla
home per serate e rassegna.

Rimossa anche la funzione che le disegnava, per non lasciare codice che non serve piu'.

### Test
**178 verdi**, con la prova che la rassegna resti senza date mentre le proiezioni le conservano.

## v5.18 — Quattro correzioni dal collaudo

### Tornei: solo le discipline in cartellone
L'elenco mostrava tutte e dieci le discipline, comprese le quattro spente, con la possibilita'
di creare un torneo che non si sarebbe mai giocato. Ora si vedono **solo le attive** — sei — con
una riga che ricorda quante restano fuori e dove riattivarle. La disciplina gia' selezionata
resta visibile anche se disattivata, per non perdere un tabellone in corso.

### Campi: la riga per il nuovo campo sta dentro la tabella
Era una fila di caselle sotto la tabella, senza intestazioni: si inserivano numeri senza sapere
quale fosse la durata e quale il numero legale. Ora e' **l'ultima riga della tabella**, con ogni
casella sotto la sua colonna. Valori iniziali allineati alla realta' del residence
(16:00-20:30, 90 minuti, una fascia).

### Eventi: cosa distingueva il martedi' dal lunedi'
**Niente.** L'icona 🎟️ non indicava un costo diverso: segnalava che l'evento e' *collegato a una
serata*, e comparendo accanto a "Ingresso libero" faceva sembrare due righe diverse quando non
lo erano. Ora al posto dell'icona muta c'e' scritto **a quale serata l'evento e' collegato**, e
se quella serata non ha quota lo dice.

### Cinema: la rassegna arriva ai soci
Il cartellone e' l'elenco dei film che il residence **propone**; le serate si fissano dopo. Nel
foglio dello Stage c'e' ora **"La rassegna della stagione"**: tutti i film con regia, anno,
durata, genere e sinossi, e sotto ciascuno la data se gia' decisa oppure *"data da definire"*.
Il tasto **"Salva o stampa la rassegna"** apre una pagina pulita da cui, con Stampa → Salva come
PDF, la si porta via: funziona su Android e iPhone senza installare niente.

### Test
**177 verdi.**

## v5.17 — Il calendario delle lezioni diventa una griglia

### Una fascia fissa, non solo le ore occupate
Il calendario mostrava **solo le righe con lezioni**: cambiava forma ogni settimana e le lezioni
comparivano dove capitava. Ora la griglia parte sempre dalla fascia dichiarata nei parametri
(**16-20** di norma) e si **allarga da sola** se una lezione cade fuori — lo yoga all'alba non
sparisce. Le righe vuote restano: sono quelle che danno al calendario una forma stabile.

### Un colore per disciplina
Scegliendo il colore alla creazione del corso, su una tavolozza di otto tinte distinguibili
anche da chi confonde rosso e verde. Su trentacinque caselle il colore si riconosce **prima del
testo**, ed e' li' che si guadagna tempo.
Il **bordo** continua a dire lo stato: verde confermata, ocra in attesa, rosso al completo.
Cosi' colore e bordo dicono due cose diverse invece di sovrapporsi.

### La stessa griglia nell'app dei soci
Al posto dell'elenco che occupava tutto lo schermo — ottanta lezioni una sotto l'altra, e
l'incastro giorno-ora da trovare a mano — ora c'e' la **stessa griglia settimanale**: sette
colonne strette, i chip delle settimane, e il tocco su una casella che apre la scheda della
lezione con posti, prezzo, quanti mancano per confermarla e il tasto per iscriversi.
Occupa **un terzo** dello spazio di prima.

### Due difetti trovati facendo questa modifica
- Nel back office avevo usato una costante inesistente (`API` invece di `API_BASE`): la
  schermata Fitness mostrava *"Errore: API is not defined"* e basta.
- Piu' serio: **i parametri di tipo "testo" non si potevano cambiare**. Il codice che convalida
  i valori non prevedeva quel tipo, quindi qualunque testo finiva nel controllo delle opzioni e
  **tornava al predefinito**, in silenzio. Riguardava anche il **numero del chiosco**: si
  scriveva, si salvava, e restava vuoto. Corretto, con una prova che lo verifica.

### Test
**176 verdi.**

## v5.16 — Chiosco e isola ecologica come tutti gli altri punti

I due punti "Siamo qui" erano rimasti indietro: il tocco apriva **Google Maps in una scheda
nuova**, buttando il socio fuori dall'applicazione, mentre farmacia e spiaggia aprivano gia' la
mappa dentro. Due comportamenti diversi per la stessa azione.

Ora si comportano allo stesso modo: si tocca, la mappa si apre **a tutto foglio dentro l'app**,
con la scritta di cosa e' quel punto — *"Conferimento rifiuti"*, *"Bar, cucina e ritrovo"* — e
il tasto **Portami li'** per le indicazioni.

### E si impostano con gli stessi strumenti
Anche il back office era rimasto indietro: accettava solo coordinate decimali. Ora la scheda dei
luoghi ha gli stessi strumenti delle voci di guida:
- **coordinate decimali**, con punto o virgola;
- **gradi** copiati dalla barra di Google (`36\u00b058'02.0"N`), convertiti uscendo dal campo;
- **link** incollato, di qualunque servizio;
- **codice della mappa** di Google, con l'anteprima accanto — e le coordinate si ricavano da
  solo, quindi si imposta tutto con un gesto.

Come per la guida, un iframe che non e' di Google viene rifiutato.

### Test
**173 verdi.** I nuovi coprono i gradi convertiti sui luoghi, il codice mappa che salva anche le
coordinate e arriva all'app, e l'iframe estraneo respinto.

## v5.15 — Rimossa la segnalazione al personale

### Perche'
La funzione avvisava la Crew della richiesta di un socio, con la posizione. Erano state
proposte sei mitigazioni — orari di servizio, presa d'atto, interruttore per il gestore,
tracciabilita' — e nessuna regge all'obiezione di fondo:

> Un servizio che riguarda la salute o si presta davvero o non si presta.

Non puo' funzionare dalle ore alle ore secondo la disponibilita' del personale. Non si scarica
con un avviso — *"prendi atto che potrebbe non funzionare proprio quando serve"* e'
l'ammissione che lo strumento non e' adatto, non una tutela. Non si accende e si spegne come
un servizio commerciale. E la tracciabilita' necessaria trasformerebbe un residence vacanziero
in un ufficio con adempimenti.

Le mitigazioni servivano a tenere la funzione riducendo l'esposizione: avere il merito senza
l'onere. E' la posizione peggiore.

### Cosa e' stato tolto
- `POST /api/aiuto` e le rotte di gestione delle richieste;
- il pannello rosso in cima al modulo Comande del Crew;
- la voce nel cruscotto;
- il parametro *"Avvisa anche la Crew"*.

Un test verifica che le rotte **non esistano piu'**: se qualcuno le reintroducesse per buone
intenzioni, si ferma li'.

### Cosa resta, perche' non crea alcun dovere
Tre numeri con tasti grandi: **112**, **un familiare** (dall'anagrafica) e **il chiosco**. La
telefonata la compone il telefono e non passa dai nostri server: se manca il campo non
funziona la chiamata, come sarebbe successo comunque. Non aggiungiamo un servizio, sostituiamo
una rubrica.

In piu' una cosa che aiuta senza promettere: **"Dove mi trovo"** mostra le coordinate **da
leggere all'operatore del 112**. Nel residence le ville si somigliano tutte e chi sta male
spesso non sa dire dov'e'. La posizione resta sul telefono e non viene inviata a nessuno.

La tessera si chiama ora **"Numeri rapidi"** e non piu' "Chiedi aiuto": dice cosa fa invece di
promettere un intervento.

### Anche le presentazioni
Le presentazioni ai soci e agli investitori annunciavano il servizio rimosso. Corrette e
rigenerate: quella agli investitori spiega ora la scelta, perche' aver scartato una funzione
per una ragione seria dice piu' di un elenco di funzioni.

### Test
**171 verdi.**

## v5.14 — Chat delle casate e consumi per confronto

### Magazzino: il teorico non scarica, smentisce
Adottata la logica del confronto. Gli articoli si dividono in due famiglie:

- **a pezzo** (bottiglia, lattina, gelato, bustina): si scaricano uno a uno alla chiusura della
  comanda, ed e' esatto;
- **a peso** (caffe', latte, insalata): **non toccano la giacenza**. Da una pianta di lattuga
  escono tre piatti o quattro, e sette grammi di caffe' sono una media: scaricare un numero
  inventato sporcherebbe i conti. Si accumula invece il **consumo teorico**, sfrido dichiarato
  compreso.

Il tipo si deduce dall'unita' di misura (`g`, `ml`, `kg` → peso; `pz`, `bottiglia`, `conf` →
pezzo) e resta modificabile articolo per articolo.

Nuova voce **⚖️ Consumi** nel back office: teorico contro contato, con lo **scostamento** in
evidenza — verde sotto il 10%, ocra fino al 25%, rosso oltre. Non e' un giudizio, e' un invito
a guardare: non serve che il teorico sia esatto, serve che sia calcolato sempre allo stesso
modo, perche' e' lo scostamento a parlare.

Nuova **distinta** per voce di menu': un caffe' macchiato consuma caffe' *e* latte.

### Chat delle casate
Solo testo, niente allegati, niente collegamenti (che sono il modo piu' comune per portare
altrove chi legge). Serve a dire *"sabato ci sono"*, *"cerco un sostituto"*, *"proviamo con
quella formazione"*.

**Il perimetro e' il controllo di accesso, non la crittografia**: il rischio non e'
l'intercettazione, e' che l'Ortigia legga la strategia dell'Aretusa. Si legge e si scrive solo
nella stanza della propria casata. Il **gruppo capitani** e' riservato a chi ha quel ruolo.

**Sulla riservatezza abbiamo scelto la strada dichiarata.** Nelle casate ci sono minorenni, e
una stanza dove nessuno puo' verificare cosa accade e' un rischio che il residence non puo'
assumersi. Quindi: la prima riga che si legge entrando e' *"Questa chat non e' privata: i
messaggi segnalati vengono letti dal gestore"*. Chiunque puo' **segnalare** un messaggio; il
gestore vede i segnalati **con i messaggi attorno**, perche' una frase isolata spesso non si
capisce — e vede solo quelli, non tutta la conversazione. La differenza fra controllo mirato e
sorveglianza continua e' proprio questa, e va tenuta.
A fine stagione la chat si svuota: sono conversazioni di servizio, non un archivio.

### Due funzioni perse e ritrovate
Riscrivendo lo scarico ho cancellato per sbaglio `chiudiComandeAbbandonate` e
`comandaConRighe`, che stavano dentro il blocco sostituito: dieci prove sono diventate rosse in
un colpo solo, ed e' cosi' che me ne sono accorto. Un confronto automatico fra le funzioni
prima e dopo la modifica ha confermato che non mancava altro.

### Test
**171 verdi.** I nuovi coprono: la chat che non esce dalla propria casata, il rifiuto di
collegamenti e tag, il gruppo capitani riservato, il gestore che vede solo i segnalati con il
contesto, il caffe' che non si scarica ma si accumula, e lo scostamento calcolato.

## v5.13 — Fino ai 18 anni: un vincolo, non un'impostazione

### Tolto il parametro
Esisteva un interruttore — *"I minorenni possono ordinare da soli"* — che poteva **autorizzare
cio' che la legge non autorizza**. Rimosso. Fino ai **18 anni** non si prende un impegno di
spesa, e il sistema non deve poterlo consentire a nessuna condizione: non e' una preferenza del
gestore, e' capacita' di agire.

### E vale fino ai 18, non fino alla soglia dell'interfaccia
Le due cose erano confuse. Ora sono separate:
- **`ragazzi_eta`** (14) decide **quale versione dell'app** si vede — e' una scelta di comodita';
- **18 anni** decide **chi puo' impegnarsi a pagare** — e non si tocca.

Il caso che sfuggiva: un **sedicenne** usa l'app completa (sopra la soglia dei ragazzi) ma non
puo' ordinare, prenotare la cena, iscriversi a una lezione o prenotare una serata. Verificato:
nella sua home mancano **Garden, Bar e Fitness**, la card di stasera non ha il tasto
*"Prenota un tavolo"*, e in Eventi ci sono **zero** tasti Prenota. A un adulto compaiono tutti.

### Restano libere le cose che non costano
Campi (gratuiti, con il loro parametro), partite aperte, Casa di Carta, Stage, Coworking, Coppa
e programma completo: si toglie la possibilita' di spendere, non la partecipazione.

### Test
**165 verdi**, fra cui la prova che l'interruttore **non esiste piu'** e quella sul sedicenne:
rifiuti su bar, cena e serata, e via libera a diciannove anni.

## v5.12 — Al minorenne le serate a pagamento non si propongono nemmeno

In v5.11 il **server** rifiutava la prenotazione di un minorenne, ma l'**app continuava a
mostrargli il tasto**: dalla voce *Stasera* della sua barra si arrivava agli Eventi, e sotto
"Serate su prenotazione" c'erano quattro **Prenota** con quote da 25 a 30 euro a persona.

Offrire un tasto e poi negarlo e' peggio che non offrirlo: mette un ragazzino nella condizione
di impegnare soldi che non sono suoi, e di prendersi un rifiuto per una cosa che gli abbiamo
proposto noi.

Ora, in modo ragazzi:
- la sezione **"Serate su prenotazione"** non mostra i tasti, ma una riga che spiega:
  *"Ci sono serate con posti contati e una quota da pagare: le prenota un adulto per te."*;
- il **foglio delle serate speciali** non ha il tasto;
- e in ogni caso il tocco su una serata **non apre la prenotazione**, da qualunque strada
  arrivi. Tre barriere, piu' quella del server: nessuna e' l'unica.

Il **programma resta visibile per intero** — deve sapere cosa succede al residence — e i prezzi
si leggono: si toglie la possibilita' di impegnarsi, non l'informazione.

### Verificato
Pagina Eventi: **0 tasti "Prenota"** per l'undicenne, **4** per l'adulto.

### Test
**165 verdi.**

## v5.11 — Un minorenne non prende impegni con i soldi di altri

### Niente serate speciali, niente lezioni a pagamento
Le serate hanno una **quota** e le lezioni di fitness un **prezzo**: sono spesa, esattamente
come un'ordinazione al bar. Ora ricadono sotto lo stesso interruttore (`ragazzi_ordini`, di
norma spento) e vengono **rifiutate dal server** con un messaggio che indirizza invece di
respingere: *"La serata la prenota un adulto: ha una quota da pagare."*

Restano libere le cose che non costano nulla: unirsi a una partita, la Coppa, i giochi da
tavolo, il programma.

### La versione non si sceglie, sotto una certa eta'
Il tasto **"Passa alla versione completa"** e' sparito dalla home dei ragazzi **e** dalla barra
dei comandi: per i minorenni la modalita' dipende dall'eta', punto. Un ragazzino che passasse
all'app intera si troverebbe davanti prenotazioni a pagamento e serate con quota, cioe' impegni
presi con i soldi di qualcun altro — e il filtro non servirebbe a niente.

Per gli **anziani** la scelta resta, perche' li' il rischio e' l'opposto: restare bloccati in
una versione che non si sa come cambiare.

### Verificato
Undicenne: nessun tasto per cambiare versione, ne' in home ne' nella barra. Ottantatreenne:
entrambi presenti. La fascia del testo resta a tutti, perche' leggere meglio serve a chiunque.

### Test
**165 verdi.** I nuovi coprono serata e lezione rifiutate al minorenne, l'adulto che passa, e
il gestore che puo' alzare il permesso di spesa se lo ritiene.

## v5.10 — La vecchia scelta bloccava tutti

Un socio del 2015, undici anni, soglia a quattordici: riceveva l'app completa. La causa e' una
mia correzione della v5.08.

Rendendo la scelta della versione **legata alla tessera**, avevo lasciato come ripiego la
vecchia chiave **comune a tutto il telefono**. Quel "passa alla versione completa" premuto una
volta durante le prove restava valido **per chiunque** usasse quell'apparecchio: teneva spenta
la modalita' anche a chi non l'aveva mai toccata, e nessuna soglia poteva riaccenderla.

Ora la vecchia chiave si **butta**, non si riporta sulla tessera: era la scelta di "chiunque
avesse quel telefono", quindi non e' attribuibile a nessuno, e conservarla avrebbe conservato
il blocco.

### Verificati i quattro casi
- 11 anni su telefono "sporco" da una prova precedente → **modo ragazzi**
- 11 anni su telefono pulito → **modo ragazzi**
- 83 anni → **modo semplice**
- adulto → **app completa**

### Test
**163 verdi.**

## v5.09 — Il contatto di emergenza arriva davvero all'app

I due campi c'erano nel modulo dell'anagrafica e la rotta li sapeva salvare — ma il modulo
**non li inviava**: la riga che compone i dati da spedire non li conteneva. Si scriveva il nome
del familiare, si premeva Salva, e non succedeva niente.

La causa e' banale e vale la pena scriverla: la mia modifica cercava
`telefono: $('#f_tel').value,` mentre nel file c'e' `telefono:$('#f_tel').value,` **senza
spazio**. La sostituzione non ha trovato nulla e **non ha segnalato niente** — un difetto
introdotto in silenzio, come gia' successo con `etaDa` e `regoleApp`.

### Verificata tutta la catena, non solo l'API
Modulo del back office → salvataggio → `GET /api/tessera/:code` → foglio **Chiedi aiuto**
dell'app: *"Giulia (figlia)"* compare subito dopo il 112. Il test che avevo scritto passava
perche' chiamava l'API direttamente, saltando proprio il pezzo rotto.

### Test
**163 verdi.**

## v5.08 — Si cambia versione, e si torna indietro

### Il tasto non funzionava, e i due difetti erano lo stesso
"Passa alla versione completa" chiamava **`render()`, una funzione che non esiste**: l'errore
veniva inghiottito e non succedeva niente. Ora ridisegna davvero.

Ed e' anche il motivo per cui il **modo ragazzi non compariva** provandolo con la soglia a 12:
la scelta era **una sola per tutto il telefono**, quindi il tentativo fatto con l'utenza anziana
aveva spento la modalita' semplice per chiunque usasse quell'apparecchio. Ora la scelta e'
**legata alla tessera**: nonno e nipote possono usare lo stesso telefono senza rubarsi la
versione a vicenda.

### La via del ritorno, sempre visibile
Il punto che sollevavi — *"non provochiamo situazioni in cui l'anziano non sa piu' tornare
indietro"* — e' quello che decide se la funzione e' utilizzabile. Il tasto **🪟 Versione** sta
ora accanto ai comandi del testo, sotto l'icona **A±**: e' il posto dove va gia' chi ha
difficolta' a leggere, ed e' raggiungibile da **qualunque schermata**, non solo dalla home.
L'etichetta dice dove si va: *"Versione semplice"* o *"Versione completa"*.

### Verificato il giro completo
Soglia ragazzi portata a 12, socio di 12 anni: home dei ragazzi con la sua barra. Premuto
"Passa alla versione completa": app intera con la barra normale. Premuto **Versione**: si torna
alla versione semplice. Nessun vicolo cieco.

### Test
**163 verdi.**

## v5.07 — Le sei correzioni sui modi semplice e ragazzi

### "Informazioni utili" non funzionava
Le tessere usavano `data-t`, che nell'app e' gestito **solo** sui pulsanti della barra in basso:
il tocco non faceva niente. Ora c'e' `data-vai`, riconosciuto ovunque.

### "Vuoi giocare?" solo se convocato
Compariva sempre. Ora appare **solo quando c'e' una convocazione da confermare**, e dice quante
— altrimenti e' una voce che chiede di cercare qualcosa che non c'e'.

### La cena in un tocco, davvero
Niente scelta di commensali, niente menu': **stasera, tavolo da quattro**, il primo turno con
posto, una schermata e un bottone **Confermo**. Se sono di piu' o di meno lo dicono al
personale — che e' come funziona davvero al Garden.

### La barra in basso segue la modalita'
Usando l'app si finisce in una schermata qualsiasi e le scorciatoie della home sparivano. Ora la
barra porta le stesse voci:
- anziani: **Home · Cena · Info · Aiuto**
- ragazzi: **Home · Giocare · Coppa · Stasera · Guida**

### Numero di un familiare
Nuovi campi in anagrafica — *"In caso di emergenza, chi chiamare"* e il numero — che compaiono
in **Chiedi aiuto** subito dopo il 112: *"Giulia (figlia)"*. Sono dati del socio, quindi stanno
nella sua scheda.

### Ai ragazzi niente "Chiedi aiuto"
Tolto dalla home dei minorenni. Per un anziano e' un servizio; verso un ragazzino sarebbe un
ruolo che non ci compete.

### Gli under non prenotano i campi
Il valore predefinito passa a **NO**: il campo lo prenota un adulto e il ragazzo **gioca**,
unendosi alla partita. Unirsi resta sempre consentito — e' giocare, non impegnare uno spazio —
e c'e' un test che lo verifica, perche' altrimenti l'app per loro non servirebbe a niente.

### Test
**163 verdi.**

## v5.06 — Due soglie, e il modo ragazzi

### Il filtro si alza e si abbassa da tutti e due i lati
Due parametri, non uno: **`semplice_eta`** (70) per gli over e **`ragazzi_eta`** (14) per gli
under. Piu' due interruttori che decidono *quanto* filtrare, invece di una regola fissa:
- **`ragazzi_ordini`** (NO) — ordinare significa spendere;
- **`ragazzi_prenotano_campi`** (SI) — i campi sono gratuiti e sono la ragione per cui i
  ragazzi useranno l'app: spegnerlo la svuota di senso per loro.

### Modo ragazzi
A 14 anni si e' gia' dentro le casate, e il telefono ce l'hanno anche prima. La loro home parte
dalla **casata** — nome, punti, posizione — e prosegue con quello che faranno davvero:
**Vuoi giocare?**, **Prenota un campo**, **Come va la Coppa**, la serata, i giochi da tavolo, e
**Chiedi aiuto**.

### Il divieto sta sul server, non nell'interfaccia
Nascondere un tasto non e' un divieto: chi conosce l'indirizzo lo chiama lo stesso. Le regole
sui minorenni sono applicate da `POST /api/self-order`, `/garden/prenota` e
`/campi/:id/partita`, e il messaggio spiega invece di respingere: *"Per ordinare serve un
adulto: mostra il men\u00f9 a mamma o pap\u00e0"*. Un test verifica proprio che la chiamata
diretta venga rifiutata.

### Correzione importante trovata strada facendo
`loginTessera` racchiudeva in un solo `try` **l'accesso e il disegno dell'app**: un errore di
rendering diventava *"Tessera non trovata"* su una **pagina bianca**, e nei log non compariva
niente. E' cosi' che il modo ragazzi sembrava non funzionare. Ora i due casi sono separati: se
l'app non si disegna lo dice, con il motivo e un tasto per riprovare.
*Da tenere a mente: un catch troppo largo non protegge, nasconde.*

### Test
**162 verdi.** I nuovi coprono le due soglie che arrivano all'app e si spostano dai parametri,
il minorenne che non ordina e non prenota il tavolo ma prenota il campo, la soglia che alzata
gli consente di ordinare, e l'adulto che non e' toccato da nessuna di queste regole.

## v5.05 — Modo semplice e "Chiedi aiuto"

### Una sola app, con meno decisioni
Non una versione light a parte — sarebbe stata da mantenere due volte — ma la **stessa app con
meno passaggi**, che si accende **da sola** in base all'eta' gia' presente in anagrafica
(parametro `semplice_eta`, default 70) e si spegne con un tocco: *"Passa alla versione
completa"*. Chi la trova attiva per sbaglio non resta chiuso fuori da meta' applicazione.

La home semplice ha **quattro voci grandi**, etichettate, senza gesti da imparare:
- **Oggi al residence** — l'appuntamento della giornata in evidenza;
- **Prenota la cena** — per stasera, in un tocco;
- **Vuoi giocare?** — solo per chi e' in una casata: le partite aperte a cui unirsi;
- **Chiedi aiuto**.

### "Chiedi aiuto" — perche' si chiama cosi'
Non *SOS* (sigla che si capisce ma non promette nulla) ne' *Emergenza* (mette ansia a chi la
vede per sbaglio): un **verbo**, che dice cosa succede quando lo premi. Contiene tre cose:
- **Chiama il 112** — la telefonata parte dal telefono e non passa da noi;
- **Chiama il residence** — il numero del chiosco, se impostato nei parametri;
- **Sono qui — avvisa il personale**: manda alla Crew nome e **posizione**, se il socio la
  concede. Chi e' nel villaggio arriva prima dell'ambulanza, ed e' il vero valore del tasto.

La richiesta compare **in cima al modulo Comande** del Crew — la schermata che lo staff guarda
di continuo — con *"Dov'e'"* sulla mappa e *"Ci penso io"*; e nel cruscotto fra le cose che
richiedono una mano. Se la posizione viene negata, la richiesta parte lo stesso.

### Prima fila dichiarata
Allo Stage, chi ha piu' di 70 anni legge ora *"Hai diritto alla prima fila"*. La regola c'era
dalla v4.95 ma era invisibile a chi ne beneficia.

### Correzioni trovate verificando
- L'eta' non arrivava all'app: la sessione la calcolava, ma l'app legge il socio da
  `/api/tessera/:code`, dove non c'era. Ora c'e' — e viaggia **l'eta', non la data di nascita**:
  serve sapere se accendere il modo semplice, non il giorno del compleanno.
- La home semplice scriveva in `#view`, che nell'app dei soci non esiste.

### Test
**158 verdi.** I nuovi coprono l'eta' nella sessione e sulla tessera, la soglia che arriva
all'app, la richiesta di aiuto con e senza posizione, la presa in carico, la comparsa nel
cruscotto e il diritto alla prima fila dichiarato.

## v5.04 — "Questi contenuti sono bloccati": eravamo noi

Il messaggio veniva da Google, ma la causa era nostra. L'applicativo invia una
**Content-Security-Policy** con `default-src 'self'` e **nessuna direttiva `frame-src`**: il
browser, correttamente, rifiutava qualunque riquadro esterno — comprese le mappe. Nessun errore
nei log, solo un rettangolo con la scritta di Google.

Aggiunta la sola apertura necessaria:

```
frame-src https://www.google.com https://maps.google.com https://*.google.com;
img-src ... https://maps.gstatic.com https://*.googleapis.com;
```

Tutto il resto resta chiuso: `default-src 'self'`, nessun altro dominio, e `frame-ancestors
'self'` perche' le nostre pagine non finiscano dentro il sito di qualcun altro.

Cambiata anche la **Referrer-Policy** da `same-origin` a `strict-origin-when-cross-origin`:
con la prima, Google non riceveva l'indirizzo del sito che incorpora la mappa e poteva
rifiutarla comunque. La nuova invia **solo il dominio**, non la pagina.

### Verificato a schermo
La mappa carica: il segnaposto sulla spiaggia di Fontane Bianche, il logo Google, nessuna
violazione della politica di sicurezza nella console del browser.

### Test
**154 verdi**, con una prova sulle intestazioni: le mappe passano, tutto il resto no.

## v5.03 — La mappa e' quella che scegli tu su Google

Ogni voce della Guida ha ora un campo **"Codice mappa di Google"**: su Google Maps si inquadra
il punto come si vuole, poi **Condividi → Incorpora una mappa → Copia HTML**, e si incolla li'.
Nell'app i soci vedono **esattamente quella mappa** — la stessa inquadratura, lo stesso zoom —
invece di una ricostruita dalle coordinate.

### Come e' trattato il codice
Non si memorizza l'HTML cosi' com'e': sarebbe codice di terzi dentro le nostre pagine. Si
**estrae il solo indirizzo dell'iframe** e si verifica che sia davvero `google.com/maps/embed`;
qualunque altro iframe viene **rifiutato** con un messaggio che spiega dove prendere quello
giusto.

### Le coordinate si ricavano da sole
Dentro il codice di Google ci sono anche le coordinate del centro (`!2d` longitudine,
`!3d` latitudine): vengono lette e riempiono Lat e Lng, che servono al tasto **"Portami li'"**
per le indicazioni stradali. Quindi incollando il codice si ottengono **mappa e posizione in un
gesto solo**, senza copiare numeri.

Nel back office, accanto al campo, compare l'**anteprima** della mappa impostata. La mappa si
puo' togliere lasciando le coordinate: la voce resta un collegamento, con la mappa ricostruita.

### Test
**153 verdi.** I tre nuovi verificano: codice di Google accettato con estrazione di indirizzo e
coordinate, iframe estraneo rifiutato senza perdere quello buono, rimozione della mappa che
lascia intatta la posizione.

## v5.02 — Le quattro correzioni, fatte come chieste

### Il "2× 90′" c'era ancora — e la causa era doppia
In v5.01 avevo corretto solo meta' strada:
1. il controllo in prenotazione era **ancora subordinato all'interruttore** "limite di durata":
   spegnendolo tornavano le tre ore;
2. la **disponibilita'** restituiva il numero grezzo della scheda campo, non le fasce ammesse,
   quindi l'app disegnava comunque due chip.

Ora il **tetto in minuti vale sempre** (l'interruttore governa il tetto per socio, non la durata
di una partita) ed e' applicato in tutte e tre le risposte. Su un campo da 90 minuti si vede
**una sola fascia**; su uno da 60, due. E ogni chip scrive il tempo totale — *"2× 60′ · 2 h"* —
cosi' l'assurdo si vede prima di cliccare.

### Al Garden non si mettono in castigo gli ospiti
Il tetto di 8 persone rifiutava coperti che vorremmo servire. Ora le scelte arrivano a **12** e
c'e' **"di piu'…"** per qualunque numero: i gruppi grandi vengono gia' accorpati su piu' tavoli
dal motore, non c'era ragione di fermarli.

### Mappe: il codice di Google, e il clic apre la mappa
Avevo inserito un'anteprima dentro l'elenco, che non era la richiesta. Ora **l'elenco resta
com'era** e il tocco apre la mappa **a tutto foglio**, con il riquadro di Google (senza chiavi)
e il tasto **"Portami li'"** per le indicazioni.

### Sezioni comprimibili: tutte
"Fatta per una, fatta per tutte." Ogni pannello con un titolo e' ora comprimibile **da solo**,
senza doverlo marcare: nel back office (con "Comprimi tutto" / "Espandi tutto") e **nel Crew**,
dove su un telefono serve anche di piu'. Lo stato si ricorda per sezione.

### Test
**150 verdi**, con la prova sul tetto in minuti riscritta: spegnere l'interruttore non riporta
piu' le tre ore, e per averle davvero si alza il numero — apposta.

## v5.01 — Permessi della pianta, campi a tempo, cruscotto per chi lavora

### 🔴 Chi aveva solo "Casa di Carta" non arrivava alla sua sala
La pianta chiedeva il permesso **comande** per qualunque ambiente. Un operatore con il solo
permesso *Casa di Carta* si vedeva rifiutare la propria sala — dare quel permesso non serviva a
niente. Ora **il permesso segue l'ambiente**: Garden → `comande`, Casa di Carta → `cdc`,
Stage → `cinema`. E ciascuno tocca solo il suo: verificato che l'operatore della Casa di Carta
riceva 403 sul Garden e sullo Stage.

### 🔴 Due fasce da 90 minuti fanno tre ore
Avevamo costruito quattro regole contro il blocco dei campi, e poi il sistema stesso proponeva
"2× 90′". Il difetto era che il tetto era espresso in **fasce**, non in tempo.
Nuovo parametro **"Durata massima di una prenotazione (minuti)"** (default 120): le fasce
ammesse si **ricavano** dalla durata del campo. Su un campo da 90 minuti significa una fascia
sola; su uno da 60, due. Il numero sulla scheda del campo resta come tetto ulteriore.

### La Casa di Carta distingue il prima e il dopo le 16
Nel Crew i turni di **coworking** mostrano ora le **postazioni libere per tavolo** e non
"minimo 2 giocatori" — che al coworking non ha senso: si lavora anche da soli. Il tavolo con una
persona non risulta piu' occupato, e il campo persone parte da **1**.
Nell'app le postazioni prenotabili arrivano a **8**: per una riunione si prende tutta la sala.

### Le comande del Garden nascono dal tavolo, e basta
Tolto il secondo compositore dalla tab Comande del Garden: c'era il numero del tavolo da
digitare, ed era il doppione che genera gli errori. Al suo posto il rimando alla Pianta. Al Bar
resta, perche' li' i tavoli non ci sono.

### Sezioni comprimibili
Richiesto e non fatto, ora c'e': nelle pagine lunghe il **titolo del pannello e' un
interruttore**, con "Comprimi tutto" ed "Espandi tutto" in cima. Lo stato viene ricordato per
sezione, cosi' ognuno tiene aperto quello che gli serve.

### La mappa si vede, non si immagina
Nella Guida le voci con posizione mostrano ora la **mappa incorporata** (Google, senza chiavi):
si tocca la voce, si apre la mappa, e sotto resta il collegamento per le indicazioni nell'app di
mappe del telefono.

### Cruscotto rifatto per la Crew
Via il cartellone della Coppa, che sta in "Casate & punti". Al suo posto **"Chi e' atteso
stasera al Garden"**: turno per turno, nome per nome, con il tavolo assegnato — la prima cosa
che serve a chi apre il servizio. Piu' i campi prenotati di oggi con l'orario e chi gioca.

### Test
**150 verdi.** I nuovi coprono i permessi per ambiente e il tetto di durata in minuti.

## v5.00 — Due difetti gravi e la comanda rifatta

### 🔴 Le prenotazioni campi erano rotte
Una mia regressione della v4.93: sostituendo la scelta del giorno nel Garden avevo toccato per
errore anche quella dei **Campi**, dove la variabile non esiste. Risultato: la schermata moriva
con *"soloOggi is not defined"* e non compariva **nessun campo**. Corretto e verificato: 5 campi,
14 fasce prenotabili.

### 🔴 Il coworking era un secondo sistema, parallelo alla sala
La tessera Coworking apriva la **vecchia "risorsa"**, un meccanismo a parte rimasto dalle prime
versioni. Da li' la prenotazione: non compariva nella sala, non muoveva il contatore, e il socio
non la ritrovava piu' da nessuna parte — che e' il modo peggiore in cui un'app puo' trattare
qualcuno.

Ora **la postazione e' una sedia della sala vera**: ha i suoi turni (9-13 e 13-16), il contatore
scende, la prenotazione compare in *"Le mie postazioni"* e si disdice. Il valore predefinito e'
**una postazione**, non due: si prenota per se'. La vecchia risorsa e' ritirata, e la Casa di
Carta mostra ora solo i turni di gioco.

### La comanda, rifatta per il telefono
- **Via gli allergeni**: stanno nel menu' e nella scheda prodotto, a bordo campo allungavano la
  riga senza servire a chi batte la comanda.
- **Icona, nome e descrizione sono cliccabili** e aggiungono: su un telefono il bersaglio non
  puo' essere solo il "+" da 34 px. Ogni voce ha la sua icona, ricavata da categoria e nome.
- Restano prezzo e i due tasti **+ / −**; la riga con qualcosa dentro si evidenzia.

### Il campo nome al Bar
Piu' largo, e con l'icona **📷** per **inquadrare il QR della tessera**: si legge il codice, si
risolve nel nome vero e si scrive quello sulla comanda. Dove il browser non sa leggere i codici
(Safari) chiede il codice a mano invece di lasciare un tasto morto.

### Eventi: luogo e capienza
Nuovi campi **luogo** (Bar · Garden · Stage · Casa di Carta · Campi) e **capienza**, piu'
**"occupa tutto lo Stage"** per le serate come la presentazione di un libro, che bloccano lo
spazio. E' la base per la revisione della sezione Stage.

### Test
**147 verdi.** I nuovi coprono il coworking che aggiorna il contatore e si ritrova, la risorsa
vecchia ritirata, il luogo dell'evento con i valori ammessi, e la tessera che si risolve nel nome.

## v4.98 — La comanda si prende dal tavolo

Proposta accolta, e ha ragione su tutti e quattro i vantaggi. Toccando un tavolo nella pianta
si apre una scheda che e' diventata il centro del servizio:

- **Chi c'e', per nome.** Se il tavolo e' prenotato, in cima compare *"Giulia R. · 4 persone"*
  con il promemoria di chiamarli per nome. Il cameriere arriva sapendo chi sta servendo.
- **🧾 Ordina** apre il compositore gia' intestato al tavolo: *"Comanda · tavolo 6 · per
  Giulia R."*. **Il numero del tavolo non si digita piu'**: era un campo di testo libero, ed
  era la fonte piu' probabile di comande finite sul tavolo sbagliato.
- **Il numero delle persone e' quello vero**, preso dalla prenotazione, non stimato a occhio.
- **Forma, posti e unione tornano subito qui**, nella stessa scheda: non serve piu' passare per
  "Modifica pianta". Erano finiti dietro un interruttore ed era un passo indietro: le cose che
  funzionavano non andavano spostate.
- Le **comande in corso** del tavolo si vedono e si chiudono da qui, come prima.

La zona **`carta`** e' ora accettata anche per le comande: alla Casa di Carta si ordina come al
Garden.

### Sulle coordinate della guida
Ho riprodotto il caso dello screenshot su un'installazione pulita alla 4.97: inseriti
`37.05961` e `15.29064` nei due campi e premuto Salva, il server risponde
`{"ok":true,"lat":37.05961,"lng":15.29064}`, il dato si rilegge dall'app e il badge "senza
posizione" sparisce. Alla 4.97 il percorso funziona: la segnalazione arrivava da una versione
precedente ancora in linea.

### Test
**143 verdi**, invariati: la modifica e' tutta nell'interfaccia del Crew, verificata dal browser
fino alla comanda registrata (#1 · zona garden · tavolo 6 · 2 righe · € 6).

## v4.97 — I gradi incollati nei due campi

### Il caso vero
Nella v4.96 avevo insegnato a leggere i gradi `36\u00b055'07.0"N 15\u00b010'14.2"E` — ma solo se
**scritti insieme** nel campo "incolla". Chi copia dalla barra di Google Maps fa un'altra cosa,
piu' naturale: mette il pezzo della latitudine nel campo **Lat** e quello della longitudine nel
campo **Lng**. Li' nessuno li convertiva, e restavano testo.

Peggio: al salvataggio `Number("37\u00b003'34.6\"N")` non e' un numero, e la posizione veniva
**svuotata in silenzio**. Nessun errore, nessun avviso: il punto spariva e basta.

### Cosa cambia
- I campi **Lat** e **Lng** accettano il **grado singolo** (`37\u00b003'34.6"N`), il decimale col
  punto e quello con la **virgola** italiana. La conversione avviene **uscendo dal campo**: si
  vede il decimale prima di salvare.
- Se per sbaglio la **coppia intera** finisce nel campo Lat, si divide da sola nei due campi.
- Un valore **illeggibile viene rifiutato** con un messaggio che dice cosa si accetta, invece di
  cancellare la posizione senza dirlo.
- **Una sola coordinata non basta**: con la latitudine senza longitudine il punto non esiste, e
  il salvataggio lo dice.

### Test
**143 verdi.** Quattro nuovi, tutti sul caso reale dello screenshot: gradi nei due campi
separati, valore illeggibile rifiutato senza perdere la posizione buona, coordinata singola
rifiutata, coppia incollata in un campo solo che si divide.

## v4.96 — Le posizioni si leggono da qualunque link (Waze compreso)

### Cosa non funzionava, misurato
Provando il lettore con i formati veri, su dieci casi ne leggeva quattro:

| Formato | Prima | Ora |
|---|---|---|
| Coordinate copiate (`36.918610, 15.170620`) | ok | ok |
| Link lungo di Google Maps | ok | ok |
| **Link condiviso dal telefono** (`maps.app.goo.gl`) | **no** | **ok** |
| **Waze** (`waze.com/ul?ll=…`) | **no** | **ok** |
| **Waze live-map** | **no** | **ok** |
| Apple Maps | ok | ok |
| **OpenStreetMap** | **no** | **ok** |
| **Gradi sessagesimali** (`36°55'07.0"N`) | **no** | **ok** |
| **Virgola decimale italiana** (`36,91861 15,17062`) | **letta SBAGLIATA** (36 e 918) | **ok** |
| Testo senza posizione | — | rifiutato con un messaggio |

Il caso peggiore non era un rifiuto ma la **lettura sbagliata**: `36,91861 15,17062` diventava
latitudine 36 e longitudine 918 — coordinate impossibili, o peggio, plausibili e in mezzo al
nulla. Ora la virgola italiana si riconosce prima della coppia separata da virgola.

### I link accorciati ora si seguono
E' il caso piu' comune, perche' e' quello che produce il tasto **Condividi** del telefono:
`maps.app.goo.gl/...` **non contiene le coordinate**, sta solo alla pagina vera. Il browser non
puo' seguirlo (glielo impedisce la politica fra domini), il server si': nuova rotta
`POST /api/admin/geo/risolvi` che apre il link, segue i rimbalzi e legge le coordinate
dall'indirizzo finale o dalla pagina.

Nell'interfaccia non cambia niente: si incolla e si preme **Leggi**. Se il testo contiene gia'
le coordinate la lettura e' immediata; se e' un link corto ci mette un attimo e poi avvisa che
il valore arriva dal link, invitando a controllare con **Verifica sulla mappa**.

### Nuovo modulo
`server/geo.js` — un solo lettore condiviso, usato dalla rotta e dal salvataggio delle voci
della guida, cosi' non ci sono due interpretazioni dello stesso testo.

### Test
**139 verdi.** Tre nuovi: tutti e nove i formati riconosciuti con la stessa posizione, un testo
senza coordinate che viene rifiutato invece di inventarle, e la virgola italiana che non viene
scambiata per due coordinate.

## v4.95 — Le tre decisioni di stagione

### 1. La platea si dimensiona sul primo turno, e non discrimina chi non cena
La platea non insegue piu' i 96 coperti totali: si dimensiona sul **primo turno** del Garden,
perche' chi cena alle 21:30 e' a tavola mentre lo spettacolo e' in corso e non puo' occupare due
posti nello stesso momento. Al secondo turno il sistema lo **dice** invece di tacere.

Ogni seduta ha ora una **destinazione**:
- 🟫 **prima fila · over 70** — riservata, fino a esaurimento;
- 🟩 **chi cena** al primo turno;
- 🟦 **solo spettacolo** — chi viene solo per l'esibizione;
- 🟨 **extra**, che si aprono per ultimi.

Le due quote si **alternano per fila**: ogni 4 posti di chi cena, 2 per chi viene solo a vedere.
Cosi' chi non cena non finisce sistematicamente in fondo — che era il punto. I blocchi sono
parametrici (4 e 2 di default), come la profondita' della prima fila (10 posti).

**La quota e' una precedenza, non un lucchetto**: quando la propria si esaurisce si passa
all'altra. Altrimenti si direbbe "al completo" con mezza platea vuota.

### 2. Sei discipline in cartellone
Con dieci servivano **190 partite in 60 giorni**, oltre tre al giorno: la simulazione ha chiuso
la stagione senza graduatoria. Restano **calcetto, basket, soft tennis, pickleball, burraco e
scala 40** — 114 partite, circa due al giorno, sostenibili. Le altre non sono cancellate ma
**spente**: i risultati registrati restano e si riaccendono se la stagione si allunga.

### 3. Il coworking assegna posti, non tavoli
Un tavolo condiviso ospita ora **piu' prenotazioni finche' ci sono sedie**: prima un coworker
solo occupava quattro posti e due prenotazioni saturavano la sala. Nei turni di **gioco** il
tavolo resta invece intero — a carte non si divide il tavolo con estranei.
Di conseguenza il **minimo di due giocatori vale solo sui turni di gioco**: al coworking si
lavora benissimo da soli.

### Correzione emersa scrivendo le prove
La lettura del socio non restituiva la **data di nascita**: l'eta' risultava sempre sconosciuta
e la prima fila per gli over 70 non sarebbe mai scattata.

### Test
**136 verdi.** I sei nuovi verificano: prima fila agli over 70 e alternanza 4-2 nelle file
successive, posti in platea solo al primo turno di cena, over 70 che siede davanti mentre gli
altri prendono la loro quota, coworking che riempie tutti i posti previsti, tavolo da gioco che
resta intero, sei discipline in cartellone.

## v4.94 — Correzioni nate dalla simulazione di stagione

Sessanta giorni di stagione (2 luglio → 30 agosto, 400 persone) mossi attraverso le API vere,
piu' una prova di picco su un ferragosto pieno. Rapporto completo in
`SIMULAZIONE_STAGIONE_rilievi.md`. Qui le correzioni gia' applicate.

### Scaricare piu' di quanto c'e' passava in silenzio
Uno scarico di 730 unita' su 480 disponibili veniva accettato senza avvisi: la giacenza scendeva
a zero e **250 unita' sparivano dai conti**. Ora lo scarico si accetta ancora — in un bar capita
di aver consumato piu' di quanto risultava — ma la risposta porta un **avviso esplicito** e la
discrepanza viene scritta nella causale del movimento.

### Un turno pieno non e' piu' un vicolo cieco
Al Garden, 105 richieste su 149 venivano rifiutate nella prova di picco, e il socio non sapeva
dove andare. Ora il rifiuto propone fino a **tre alternative reali** — l'altro turno, i giorni
vicini — con i posti effettivamente liberi.

### I posti davanti al palco: si sa subito
La platea ha 52 posti, il Garden serve 96 coperti: nelle sere di spettacolo i posti finiscono
prima dei commensali. Prima la cena veniva confermata in silenzio e il socio lo scopriva la sera
davanti al palco. Ora legge subito **"Cena confermata, ma i posti davanti al palco sono
esauriti"**, oppure quanti posti ha ottenuto e per quale spettacolo.

### La chiusura di stagione dice quante partite mancano
Con 10 discipline servono 190 partite in 60 giorni, cioe' **oltre 3 al giorno**: nella
simulazione la stagione e' finita senza graduatoria. Il pannello di chiusura ora mostra, per
ogni disciplina, **giocate e mancanti**, il totale, e il **ritmo necessario** per arrivare in
fondo — cosi' si decide se ridurre il cartellone invece di scoprirlo il 19 agosto.

### Test
**130 verdi**, di cui tre nati da questi rilievi.

## v4.93 — La home diventa il posto da cui si prenota

### Via il doppione
"Questa settimana" in home era il **clone** della sezione Eventi: la stessa lista, due volte,
in due posti. Rimossa dalla home. Il programma completo resta in **Eventi**, che e' la sua
sezione.

### In home tutto cio' che si prenota
Prima erano cinque tessere e mancavano tre cose che il sistema sa gia' gestire. Ora sono otto,
tutto il prenotabile al netto dei tornei:

**Campi · Partite aperte · Garden · Bar · Fitness · Casa di Carta · Stage · Coworking**

Le ultime tre sono **nuove nell'app dei soci** — il motore c'era da settimane, mancava la faccia:
- **🧘 Fitness** — le prossime lezioni con istruttore, durata, prezzo, iscritti e quanti mancano
  al minimo perche' la lezione parta. Ci si iscrive con un tocco.
- **🎲 Casa di Carta** — il tavolo da gioco a turni: giorno, quante persone, e i quattro turni
  con i tavoli liberi. Ricorda che da soli non si occupa un tavolo.
- **🎬 Stage** — il posto allo spettacolo, con i posti liberi e l'avviso che chi cena al Garden
  ce l'ha gia'.

### Le serate speciali non spariscono piu'
Spostandole in Eventi erano finite in fondo alla pagina, e di fatto sparivano. Ora dalla home
c'e' **✨ Scopri le nostre serate speciali**: apre le quattro serate su prenotazione con quota,
posti liberi, descrizione e il tasto per prenotare.

### Risultato
La home sta **in una schermata sola**: la serata di stasera, le otto cose che si prenotano, il
tasto delle serate. Niente da scorrere per arrivare a quello che serve.

## v4.92 — Le posizioni della guida si inseriscono, non si inventano

### Il problema: le coordinate erano stime mie
Le coordinate messe in v4.89/4.90 per farmacia, guardia medica, spiaggia, Ortigia e le altre
**non erano posizioni verificate**: erano approssimazioni plausibili. Su una voce turistica e'
un fastidio; su una **farmacia** o sulla **guardia medica** e' un danno, perche' chi segue il
segnaposto non trova quello che cerca.

**Un segnaposto sbagliato e' peggio di nessun segnaposto.** Quindi:
- una migrazione **cancella** le coordinate ancora identiche a quelle che avevo inserito,
  lasciando intatte quelle nel frattempo corrette a mano;
- il **seed non inventa piu' posizioni**: le voci nascono senza, e restano righe di testo
  finche' non si inserisce la posizione vera.

### Ogni voce ha la sua scheda, con la posizione
La sezione **Guida** del back office non e' piu' una tabella in sola lettura: ogni voce e' una
scheda con titolo, dettaglio, distanza e **coordinate**, e si salva singolarmente.

Per inserire la posizione ci sono due strade:
- **incollare** le coordinate copiate da Google Maps (`36.9186, 15.1706`) o il **link della
  mappa**, e premere **Leggi**: il sistema le estrae. Riconosce `@lat,lng`, i parametri
  `?q=`/`ll=`, il formato `!3d…!4d…` dei link lunghi e la coppia di numeri semplice;
- **scriverle** direttamente nei due campi.

Poi **🔎 Verifica sulla mappa** apre il punto salvato: se il segnaposto non cade sul posto
giusto, la posizione e' sbagliata. È il passaggio che mancava, e che avrebbe evitato l'errore.

Altri accorgimenti: bordo verde se la voce ha la posizione, **"senza posizione"** se manca, un
contatore in testa alla sezione (*"9 voci senza posizione"*), e le voci della sezione *orari*
escluse perche' non sono luoghi. I **link accorciati** (`maps.app.goo.gl`) non contengono le
coordinate: il messaggio lo dice e spiega cosa fare.

### Convalida lato server
Latitudine oltre 90 o longitudine oltre 180 vengono **rifiutate** con un messaggio esplicito,
e la posizione precedente resta quella buona. La virgola decimale viene accettata.

### Test
**122 verdi.** I nuovi verificano che le voci nascano senza posizione, che la posizione inserita
arrivi ai soci, che le coordinate impossibili siano rifiutate senza rovinare quella buona, e che
si possa togliere una posizione riportando la voce a riga di testo.

## v4.91 — Guida rapida nell'header + documentazione completa

### Guida rapida (dal tasto ? in alto)
Riscritta. Prima elencava tre aree in generale; ora dice **dove si trova** ciascuna cosa e come
si fa: prenotare un campo, cenare al Garden, ordinare al Bar, il programma, la casata, la guida
con i collegamenti alle mappe. Compare da sola al primo accesso e resta sempre disponibile.

### Documentazione (consegnata a parte)
- **Manuale tecnico** — linguaggio, runtime, le quattro dipendenze, database e migrazioni,
  struttura del codice, build e deploy, permessi, i tre motori riusabili, scelte di progetto,
  test e scenari futuri.
- **Manuale operatori** — Crew e back office, 14 capitoli con **26 schermate** prese
  dall'applicativo, tabelle dei permessi e dei colori, e le situazioni ricorrenti.
- **Guida per i soci** — 10 capitoli illustrati, dal primo accesso alle domande frequenti.
- **Sei filmati** delle funzioni principali, registrati dall'app in funzione su schermo di
  telefono, con la spiegazione passo per passo a fianco.

Nuovo script `scripts/genera-manuali.mjs`: rigenera schermate e filmati da un database popolato
per la dimostrazione. Serve a rifare la documentazione quando l'interfaccia cambia, invece di
riscattare tutto a mano.

## v4.90 — Guida georeferenziata davvero, e un solo posto per i tavoli

### Le coordinate non c'erano: il seed non gira sui database avviati
Avevo messo le coordinate **nel seed**, che pero' viene eseguito solo su un database nuovo: le
voci gia' esistenti restavano con `lat/lng` vuoti, quindi niente collegamenti. Ora c'e' una
**migrazione** che le compila per titolo — farmacia, guardia medica, spiaggia, market, bar,
Ortigia, Neapolis, Duomo, Plemmirio, Cavagrande — solo dove sono ancora vuote, una volta sola.
Le altre voci si georeferenziano dal back office con `PUT /api/admin/bussola/:id`.

*Da ricordare: una modifica al seed non arriva a chi il database ce l'ha gia'. Vale per le
coordinate come valeva per i set di scacchi e per la sala da 20 mq.*

### Tavoli e pianta: un posto solo
Avevi ragione: la tab **Tavoli** e la tab **Pianta** mostravano gli stessi tavoli con dati
diversi — una le comande, l'altra le prenotazioni. Ora **la pianta le tiene insieme**:
- 🟩 libero · 🟪 **prenotato** · 🟧 **comanda in corso** · 🟥 **oltre i 10 minuti** · 🟨 extra
  · ⬜ arredo, con i minuti trascorsi scritti sul tavolo;
- **toccando un tavolo servito** si aprono le sue comande con le righe, e si **chiude**, si
  **annulla** o si **libera il tavolo** senza andarle a cercare altrove;
- toccando un tavolo libero lo si prenota al banco, come prima.
La tab Tavoli e' stata rimossa: stesso tavolo, un posto solo dove guardarlo.

### Il tavolo non resta sporco
Una comanda dimenticata restava "aperta" per sempre e teneva il tavolo occupato — e' cosi' che
un tavolo risultava sporco il giorno dopo. Nuovo parametro **"Chiudi da sola una comanda
dimenticata"** (SI, default) con le **ore** dopo le quali chiuderla (6): la chiusura avviene
pigramente quando qualcuno guarda le comande, senza processi da tenere vivi.

### Correzione
La legenda usava una variabile dichiarata piu' sotto, e la pianta del Garden mostrava
*"Cannot access 'rossoMin' before initialization"*. Stesso tipo di errore di ieri con `canvas`:
preso subito perche' lo screenshot si guarda **prima** di consegnare.

### Test
**118 verdi**, con prove su coordinate compilabili dal back office, comanda chiusa che libera il
tavolo e sparisce dall'elenco operativo, e parametri della chiusura automatica.

## v4.89 — Cruscotto operativo, calendario fitness, guida su una riga

### 6. La pianta della Casa di Carta era rotta — e la causa e' un difetto vero
`tavoli_giorni` ha **una riga per data, senza ambiente**: una disposizione assegnata al giorno
per il Garden veniva restituita anche alla Casa di Carta. Ora la ricerca filtra per ambiente.
E quando la pianta non arriva non compare piu' un muto "Pianta non disponibile": si legge
**l'errore** e c'e' il tasto per ridisegnarla.

### 4. Come la comanda del Bar era finita sui tavoli del Garden
Fino alla v4.85 `POST /api/self-order` scriveva **`zona: "garden"` per ogni ordine**, qualunque
fosse il punto (corretto in v4.86). Le comande gia' registrate restavano pero' sbagliate: ora
una migrazione le riallinea dal punto, una volta sola. La mappa mostra solo comande del Garden
ancora aperte, quindi annullarne una la fa sparire dal tavolo.

### 1. Dalla serata si prenota per quella serata
Il tasto "Prenota un tavolo" nella card di stasera apriva il calendario di tutti i giorni: chi
era entrato per **quella** serata finiva a guardare altro. Ora prenota per stasera e lo dice;
per gli altri giorni c'e' la sezione Eventi.

### 5. Area fitness: calendario a griglia
Un elenco di ottanta lezioni una sotto l'altra non si legge. Ora **giorni in colonna, ore in
riga**, e all'incrocio il rettangolo del corso con iscritti, quanti mancano al minimo e prezzo —
verde confermata, ocra in attesa, rosso al completo. Si naviga per settimana e si tocca il
rettangolo per modificare la lezione.

### 3. Il cruscotto diventa una plancia
Erano sei totali storici quasi sempre a zero. Ora:
- **servizio ora**: comande aperte per zona e quante sono oltre i dieci minuti;
- **oggi**: coperti Garden, tavoli Casa di Carta, posti Stage, campi, lezioni con iscritti e
  minimo, spettacoli e riunioni in programma;
- **"Richiede una mano"**: comande in ritardo, articoli sotto scorta, proposte da leggere,
  lezioni sotto il minimo — ognuna con la **scorciatoia** al posto giusto;
- **ponte verso il Crew**: il collegamento diretto all'app operativa.

### 2. Guida piu' compatta e georeferenziata
Numeri utili e punti di interesse stanno su **una riga sola** (nome, luogo e distanza in linea).
Le voci con coordinate diventano **collegamenti che aprono le mappe del telefono**: nuovi campi
`bussola.lat/lng`, modificabili dal back office, gia' popolati per farmacia, spiaggia, Ortigia,
Neapolis, Duomo, Plemmirio e Cavagrande.

### Test
**115 verdi**, con prove su cruscotto, scorte segnalate, disposizione che non passa da un
ambiente all'altro, coordinate della guida e comande riallineate.

## v4.88 — Una pianta sola, e via i doppioni

### Perche' non trovavi "Ripristina predefinita"
L'avevo messo **dentro la modalita' Disposizione**, e in Servizio non c'era. Peggio: il gestore
del tasto veniva agganciato **dopo un `return` anticipato**, quindi in Servizio non funzionava
comunque. Ora e' sempre in vista e sempre attivo — verificato dal browser, non solo dall'API:
otto tavoli vecchi → due tavoli con reception e angolo caffe'.

### Una videata sola (rispondendo alla domanda: no, due non servivano)
"Servizio" e "Disposizione" erano due pagine che mostravano la stessa mappa. Ora e' **una**:
lo stato del turno, la legenda, i tavoli e le prenotazioni sono sempre li'; **✋ Modifica pianta**
e' un interruttore, non una seconda schermata. Gli strumenti di disegno (Salva, + Tavolo, Nuova
disposizione, Usa in questo giorno) compaiono solo mentre si modifica; **QR tavoli** e
**Ripristina predefinita** restano sempre disponibili.

### Il caffe' esce dal Crew
Era la seconda strada che mi avevi indicato ed e' quella giusta: le capsule sono **un articolo
di magazzino come gli altri**, e la conta si fa con la **rettifica** nel modulo Magazzino, dove
carico, scarico e rettifica ci sono gia' per ogni articolo. Tenerne una copia nella Casa di
Carta significava due contabilita' che divergono — ed e' esattamente quello che e' successo.
Pannello rimosso.

### QR self-order in un posto solo
Il blocco QR nel back office duplicava quello della Pianta, che pero' conosce i **tavoli veri**.
Rimosso dal back office, con il rimando alla Pianta.

### Arredo
Reception e angolo caffe' non compaiono piu' fra i tavoli prenotabili della sala: stanno sulla
pianta, dove servono a capire lo spazio.

### Test
**110 verdi**, con la prova che l'arredo resta sulla pianta ma sparisce dall'elenco dei tavoli.

## v4.87 — La pianta obbedisce ai parametri, e la ridondanza sparisce

### I parametri della platea non facevano niente
Cambiare "posti standard" da 40 a 20 non ridisegnava nulla: la platea (come la sala della Casa
di Carta) si crea **una volta sola**, e i database gia' avviati si portavano dietro la vecchia
pianta — ed e' anche il motivo per cui la reception della Casa di Carta era "un mistero": non
esisteva, in quella sala disegnata prima.

Nuovo tasto **↺ Ripristina predefinita** nella Pianta: ridisegna l'ambiente corrente **dai
parametri correnti**. Non si esegue se ci sono prenotazioni attive — prima si liberano, poi si
ridisegna. Le proiezioni vengono sganciate e riagganciate al nuovo layout: cancellarlo
lasciando il riferimento appeso rompeva la platea (preso da un test, non dall'occhio).

### Via la ridondanza dello Stage
Il modulo Cinema ripeteva la stessa griglia di sedute della Pianta. Aveva ragione a sembrare
inutile: ora **la platea sta solo nella Pianta** — con palco, sedute, chi e' a sedere e
prenotazione — e il modulo Cinema tiene il programma e il conto degli ingressi.

### Tocca l'oggetto e prenoti
Nella pianta, in modalita' Servizio, **si tocca un tavolo o una seduta**: se e' libero si apre
la prenotazione al banco proprio su quello, se e' occupato si vede chi c'e' e lo si libera.
Vale per Garden, Casa di Carta e Stage — serve a chi passa dal chiosco e non usa l'app.

### Colori e refusi
- I **posti extra** ora si distinguono anche sulla pianta (ocra), non solo nell'elenco, con la
  legenda sotto l'intestazione.
- **Niente QR nella platea**: le sedute non hanno self-order.
- Nella sala della Casa di Carta i turni mostravano **`[object Object]`**: risolto.

### App dei soci
Nella card di stasera il **bottone sta accanto alla descrizione**, non sotto: si guadagna
un'intera fascia di altezza.

### Test
**109 verdi.** I tre nuovi verificano che il parametro da solo non tocchi una pianta gia'
disegnata (comportamento voluto), che il ripristino la riporti ai valori impostati (20+10 con il
palco, 2 tavoli con reception e angolo caffe'), e che non si ridisegni sotto le prenotazioni
attive.

## v4.86 — Correzioni sostanziali (comanda, Stage, magazzino, rifiuti)

### La comanda del Bar finiva sui tavoli del Garden
Non era la mappa: era `POST /api/self-order`, che scriveva **`zona: "garden"` per ogni ordine**,
qualunque fosse il punto. Ora la zona si deduce dal punto (bar / garden / carta / cucina).
La mappa tavoli inoltre mostra ora solo comande **del Garden e ancora aperte**: prima bastava
"non del bar", e tutto cio' che aveva zona vuota o diversa finiva su un tavolo.

### Lo Stage mostrava il Garden
`GET /api/admin/tavoli/turno` accettava solo `garden` e `carta`: **`stage` ricadeva sul Garden**,
ed e' per questo che la "Platea dello Stage" mostrava dodici tavoli da quattro. Ora:
- **`stage` e' un ambiente vero**, con le sue fasce, che sono gli spettacoli del giorno;
- la platea si dimensiona dai **parametri** — `stage_posti_standard` (40) e
  `stage_posti_extra_n` (12) — invece che da numeri scritti nel codice;
- c'e' il **PALCO** in alto, come riferimento per orientare le sedute: senza, la pianta non si
  capisce;
- **la pianta e' quella del modulo e non si cambia**: dallo Stage non si toccano i tavoli del
  Garden ne' quelli della Casa di Carta, e le disposizioni selezionabili sono solo quelle
  dell'ambiente. Era il senso stesso dei permessi, e l'avevo lasciato aperto.

### Il magazzino si legge nel Magazzino
Tolte le tab **Giacenze** e **Scorte** da Garden, Bar e Casa di Carta: erano lo stesso dato
ripetuto in quattro posti. Chi deve vedere le giacenze riceve il permesso `magazzino` e usa
quel modulo, dove le zone ci sono gia'.

### Calendario rifiuti: un interruttore per periodo
Richiesto e mai fatto. Ogni periodo ha ora un flag **in corso**: nell'app dei soci si vede solo
quello acceso. Sui database esistenti resta acceso il primo, gli altri si spengono.

### Cena al Garden = posti davanti al palco
Non era una domanda da farti: l'avevi gia' spiegato. Nelle sere con spettacolo, chi prenota la
cena prenota **contemporaneamente** i posti in platea, tanti quanti i commensali — una
prenotazione sola. Se la cena salta, saltano anche i posti. Il resto della platea resta a chi
viene solo per l'esibizione, con un **contributo** parametrico (`stage_contributo`, default 2 €;
a zero l'ingresso e' libero) dichiarato dall'API del cartellone.

### Test
**106 verdi.** I nuovi verificano: la zona della comanda dedotta dal punto, lo Stage con la sua
platea da 52 sedute e il palco (e le disposizioni filtrate per ambiente), la cena che porta con
se' i posti e li libera annullandola, il contributo parametrico, il calendario rifiuti filtrato.

## v4.85 — Caffe' agganciato, sala a quattro turni, mappa ovunque, QR dai tavoli veri

### (a) Il riferimento alle capsule non si perde piu'
Il pannello caffe' mostrava una giacenza sua (120) scollegata dal magazzino, e l'articolo si
sceglieva da un elenco dove, aggiungendo altri prodotti, le capsule sparivano fra gli altri.
Ora:
- la **giacenza mostrata e' quella dell'articolo di magazzino**: due numeri che possono
  divergere sono un numero sbagliato. Il contatore interno resta solo come storico delle conte;
- l'articolo si **dichiara una volta** e il pannello dice sempre quale sta guardando; se non e'
  dichiarato lo deduce dal nome ma **avvisa** di confermarlo;
- il **seed crea "Capsule caffe'"** in zona Casa di Carta e lo collega: il riferimento c'e' da
  subito.

### (b) La sala serve due usi, e ha la sua mappa
- **Quattro turni**: `9-13 coworking · 13-16 coworking · 16-18 gioco · 18-20 gioco`. Il
  coworking occupa la sala **fino alle 16**; dalle 16 si gioca. Stessa stanza, stessi tavoli,
  stessa mappa: cambia a cosa serve il turno, e ogni turno lo dichiara.
- **Mappa interattiva anche per Casa di Carta e Stage**, non solo per il Garden: la tab
  **Pianta** compare nei tre moduli e si apre gia' sull'ambiente giusto.
- **L'arredo si vede**: reception (per il futuro check-in host) e angolo caffe' compaiono in
  grigio sulla pianta anche in modalita' servizio. Non sono posti e non entrano nella capienza.
- Nel Crew il modulo si chiama **Stage**, di cui il cinema e' uno degli usi.

### (c) I set sono due
"Set di pedine e scacchi" era una voce sola per due cose: ora **Set di pedine (dama)** e
**Set di scacchi**, per le due scacchiere. Migrazione automatica sui database esistenti.

### (d) QR dei tavoli generati dalla pianta
Il tasto **🔳 QR tavoli** sta ora nella **Pianta** e genera i QR **dei tavoli realmente
disegnati** nella disposizione corrente, per l'ambiente corrente: se sono sei, sono sei. Un QR
per foglio A4. Niente piu' numeri fissi da nessuna parte.

### Test
**101 verdi.** I nuovi verificano i quattro turni con i rispettivi scopi sugli stessi tavoli, la
giacenza del caffe' allineata al magazzino e il riferimento che regge all'aggiunta di altri
prodotti, e i due set separati.

## v4.84 — Cinema nel Crew · Casa di Carta riordinata · prenotazione della sala

### 1. Cinema nel Crew, con permesso proprio
Mancava del tutto. Nuovo permesso **`cinema`** (delegabile agli operatori) e modulo **🎬 Cinema**
nel Crew: le proiezioni in programma, la **platea a colpo d'occhio** (verde libero, ocra extra,
rosso occupato), l'elenco degli ingressi e la **prenotazione al banco** per chi si presenta senza
app. Le rotte del cartellone passano da `eventi` a `cinema`.

### 2. Casa di Carta rimessa in ordine
- **Back office: restano inventario e check attrezzature.** Tolti il pannello caffe' (2.1), il
  registro prelievi (2.2, e' nel Crew) e il coworking (spostato, vedi sotto).
- **Conta capsule (2.1): ora muove il magazzino.** La differenza rispetto alla conta precedente
  esce come **scarico** dell'articolo capsule, zona Casa di Carta. Il caffe' non ha piu' una
  contabilita' sua: la conta e' il rilevamento, il magazzino e' la verita'.
  *Quale* articolo scaricare non si indovina piu' dal nome — in magazzino ce n'era piu' d'uno e
  la prova lo ha colto scaricando quello sbagliato: ora si dichiara una volta dal Crew.
- **Due turni (2.3): 16-18 e 18-20**, al posto dei tre precedenti.
- **Sala dimensionata sullo spazio vero (2.6).** In 18-20 mq, tolti la **reception** per il
  futuro check-in degli host e l'**angolo caffe'**, restano circa 10 mq calpestabili: a 1,2 mq a
  persona seduta fanno **otto posti, cioe' due tavoli da quattro**. Reception e angolo caffe'
  stanno sulla pianta come **arredo**: si vedono, si spostano, non si prenotano.

### 3. Coworking e prenotazione della sala (2.5)
Nuova sezione **💻 Coworking & sala**. Il coworking (posti mattina/pomeriggio) si sposta qui dalla
Casa di Carta. E si aggiunge quello che non era previsto da nessuna parte: **la prenotazione
della sala** per riunioni, presentazioni, corsi. Una prenotazione esclusiva non si sovrappone
**ne' a un'altra riunione ne' ai tavoli gia' prenotati per giocare**, e lo dice con precisione.

### Test
**98 verdi.** I nuovi coprono: permesso cinema isolato su un operatore, platea riempita al banco
e ingresso annullato, sala da 20 mq con due tavoli e l'arredo non prenotabile, sovrapposizione
di riunioni rifiutata, riunione sopra i tavoli da gioco rifiutata, conta capsule che scarica il
magazzino sull'articolo dichiarato.

## v4.83 — La Casa di Carta ha i suoi tavoli · risposta sui tavoli del Garden

### Risposta al quesito rimasto in sospeso
- **Il "12" e' solo il seme.** `garden_tavoli` serve a creare la *prima* disposizione: da v4.73
  la tab Tavoli legge la pianta vera. Il campo "Numero tavoli" era pero' rimasto modificabile
  nella configurazione del Crew senza governare piu' niente — **rimosso**, con un rimando alla
  Pianta.
- **La catena di unioni e' illimitata.** Si possono accorpare tre, quattro tavoli in una
  tavolata: i posti si sommano e l'etichetta diventa `5+6+7`. Un tavolo gia' assorbito non puo'
  essere a sua volta sorgente di un'altra unione, quindi non si creano incroci.

### Tavoli della Casa di Carta
Stesso motore del Garden e della platea, terzo ambiente: `carta`. Otto tavoli da quattro di
partenza, che si spostano e si accorpano dalla **Pianta** (nuovo selettore Garden / Casa di
Carta). Tre turni al giorno (`16:30 · 18:30 · 21:00`, modificabili).

**Contro i sit-in**, gli stessi due strumenti dei campi, tarati sul gioco da tavolo:
- **numero legale** (default 2): da soli non si occupa un tavolo, e se al turno non c'e'
  nessuno il tavolo torna libero;
- **turni al giorno per socio** (default 2): i tavoli girano invece di restare occupati dalla
  mattina alla sera.

API: `GET /api/carta/turni`, `POST /api/carta/prenota`, `GET /api/carta/mie-prenotazioni`,
`POST /api/carta/prenotazioni/:id/annulla`.

### Il gioco prestato si lega al tavolo
`cdc_prestiti.tavolo`: quando si presta uno strumento si indica anche **dove verra' usato**.
Serve a ritrovarlo e a sapere chi ha lasciato il tavolo in disordine.

### Sala nel Crew
Nel modulo Casa di Carta: i turni, i tavoli con chi li occupa, e **sotto ciascun tavolo i giochi
in uso li'**. Prenotazione al banco per chi si presenta senza app.

### Correzione emersa dai test
Una prenotazione fatta **a meno di trenta minuti** dall'orario decadeva all'istante, prima che
chiunque potesse dichiararsi. Ora chi prenota all'ultimo momento — che e' li' di persona — ha
dieci minuti di grazia, **ma non oltre l'inizio del turno**: se l'orario e' cominciato e non c'e'
nessuno, il campo si libera lo stesso.

### Test
**92 verdi.** I nuovi coprono la sala della Casa di Carta (turni, minimo, rotazione dei turni
per socio), la sala della Crew col gioco legato al tavolo, disdetta del socio, la prenotazione
dell'ultimo minuto che non svanisce, e la prova che **Garden, platea e sala giochi restano
indipendenti** pur condividendo lo stesso motore.

## v4.82 — Numero legale: la regola che regge tutte le altre

### Il buco nella v4.81
*"Se unirsi non e' un vincolo, rimane la possibilita' di aggirare la regola: prenota uno,
giocano in sei, e via fino a fine giornata."* Vero. La catena contigua vede solo i giocatori
**dichiarati**: se il gruppo non si registra, il sistema non ha nulla su cui applicarla. Le
regole della 4.81 poggiavano su un presupposto che nessuno era obbligato a rispettare.

### La soluzione: rendere conveniente dichiararsi
Ogni campo ha un **numero legale** (`min_giocatori`, default meta' dei posti, almeno due).
Se **poco prima dell'orario** — trenta minuti, parametrico — i giocatori dichiarati sono meno
del minimo, la **prenotazione decade** e il campo torna libero.

Il gruppo si trova cosi' davanti a due sole strade, e nessuna delle due gli lascia il campo:
- **si dichiarano** → la catena li vede e li ferma alla seconda fascia;
- **non si dichiarano** → alla scadenza perdono lo slot, che passa a chi aspetta.

La decadenza e' **pigra**: si calcola quando qualcuno guarda la disponibilita' o prenota.
Nessun cron, nessun processo da tenere vivo, e lo slot liberato e' immediatamente prenotabile.

### Conseguenza necessaria: anche la riservata dichiara i giocatori
Se il numero legale valesse solo per le partite aperte, chi prenota "Solo io" resterebbe cieco
al sistema — proprio il caso piu' comune. Quindi la prenotazione riservata resta **chiusa agli
estranei** ma il **titolare dichiara i compagni** per tessera:
`POST /api/partite-aperte/:id/aggiungi` (solo il titolare) e
`GET /api/partite-aperte/:id/giocatori`.
Il compagno aggiunto e' un giocatore a tutti gli effetti: gli si applicano tetto giornaliero e
catena, altrimenti basterebbe farsi aggiungere invece di unirsi.

### In app e in back office
La disponibilita' dice per ogni fascia **quanti giocatori mancano e entro che ora**: si avvisa,
non si punisce. Sulla scheda del campo, in back office, la nuova colonna **Min. gioc.**

### Test
**86 verdi.** I cinque nuovi verificano: il numero legale esposto con quanti mancano e la
scadenza, la riservata che dichiara i compagni col solo titolare abilitato, il fatto che
dichiararli **non** aggiri la catena (ne' prenotando ne' facendosi aggiungere), la decadenza a
scadenza superata e la tenuta della prenotazione quando il minimo e' raggiunto.

## v4.81 — Campi: fine del monopolio · Chiusura stagione e Albo d'Oro

### Il trucco delle sei persone
*"Siamo in sei e giochiamo a calcetto. Il primo prenota alle 16, gli altri cinque prenotano gli
slot successivi, e bloccano il campo fino alla chiusura."* Il tetto sul **titolare** non lo ferma:
i titolari sono sei persone diverse, e i campi sono gratis, quindi non rischiano nulla.

La chiave e' che **il sistema sa gia' chi gioca**, non solo chi ha firmato: ogni prenotazione ha
il titolare come primo iscritto e gli altri si aggiungono. Da li' quattro regole, tutte
parametriche e tutte simmetriche — valgono per chiunque, non colpiscono nessuno in particolare:

1. **Il tetto conta chi gioca, non chi prenota.** Una fascia pesa su tutti i partecipanti. Il
   giro dei sei titolari smette di funzionare al primo giro.
2. **Le fasce attaccate contano insieme.** Fasce consecutive in cui compare la stessa persona
   valgono come **una sola occupazione lunga**, soggetta al massimo di fasce consecutive, anche
   se le prenota qualcun altro del gruppo. E' la regola che spegne esattamente il testimone.
   Vale anche quando ci si **unisce** a una partita: era la variante piu' furba.
3. **Tetto giornaliero** (default: una volta al giorno per campo). Dopo aver giocato, quel campo
   passa ad altri — ma **domani si ricomincia**, e su un altro campo si gioca lo stesso.
4. **Finestra di prenotazione** (default 7 giorni). Nessuno si prende mezza stagione il primo
   giorno: la finestra scorre e ogni giorno si apre lo stesso spazio per tutti.

Nessuna delle quattro guarda *chi* sei: guardano quanto campo stai gia' occupando. Chi ha
giocato oggi trova comunque posto domani, e chi non ha mai giocato trova sempre fasce libere —
c'e' un test che verifica proprio questo, cioe' che dopo il tentativo di blocco **restino fasce
libere per gli altri**.

**Test dedicati**: il primo riproduce il trucco a regole spente e verifica che riesca (la falla
esiste davvero), gli altri lo rifanno con le regole accese e verificano che si fermi — con la
quota sui partecipanti, con la catena, unendosi, col tetto giornaliero, con la finestra, e con
tutte insieme.

### Chiusura della stagione e Albo d'Oro delle casate
Il gioco delle casate dura la stagione estiva e si chiude entro il **19 agosto**, perche' il 20
c'e' la serata delle casate. Ora il sistema **propone la chiusura da solo** quando ogni
disciplina in cartellone ha espresso il suo punteggio; finche' manca qualcosa dice **cosa** manca.

Alla chiusura: graduatoria congelata, **tabellone chiuso** (le discipline passano ad archiviate)
e **primi tre posti nell'Albo d'Oro**. La prima classificata porta, la stagione successiva, il
**simbolo del residence** (✧) accanto al nome nell'app dei soci e nella scheda della propria
casata. `GET /api/albo-casate` espone l'Albo ai soci.

**Parita' al primo posto.** Nella prova reale due casate sono arrivate entrambe a 68 punti. Il
sistema applica prima uno spareggio oggettivo — piu' tornei vinti, poi piu' secondi posti — e se
la parita' resta assoluta **non sceglie**: lo dichiara e chiede uno **spareggio alla serata delle
casate**, poi si indica la vincitrice e la chiusura procede. Assegnare il simbolo del residence
a caso sarebbe la cosa peggiore.

### Test
**81 verdi.** I test del motore campi girano ora su una base con le regole anti-monopolio spente,
e le regole hanno prove proprie che le accendono una alla volta: cosi' si vede quale regola
ferma cosa.

## v4.80 — Correzione bloccante + maquillage

### Il corso fitness non si creava (e nemmeno il film)
Segnalato: nell'area fitness il corso non si crea. La causa era mia e valeva per **due**
sezioni: nelle viste di Cinema e Fitness avevo chiamato `openModal()`, che e' la funzione del
**Crew**; nel back office la finestra si apre con `modal()`. La maschera non compariva e la
console diceva "openModal is not defined". Corretto ovunque, insieme alla chiusura dichiarativa
dei bottoni della finestra. Verificato nel browser: corso creato con le sue lezioni, film creato.

*Lezione: i test coprivano l'API — che infatti funzionava — ma non l'apertura della maschera.
Le due schermate nuove erano state provate solo via HTTP.*

### Maquillage
- **a.** Via **"by KOINÈ"** dalle testate di app soci, Crew e back office, dalla tessera
  salvabile e dal login.
- **b.** Sotto "Guida del residence" spariva un secondo **"Bussola Residence"**: ora il titolo
  e' uno solo.
- **c.** Le due righe del **silenzio** diventano **una**, con i due orari affiancati a destra:
  dalla frase intera si estrae solo l'orario.
- **d.** Negli sport via il titolo "Campionati sociali": la disciplina si sceglie da una
  **combo** accanto al titolo. Con dieci discipline le linguette non ci stavano piu'.
- **e.** Via "Il cartellone": resta **"Il programma"**.
- **f.** In home un solo riquadro: tolto il "Benvenuti alla Bussola", resta **quello di stasera**.
- **g.** Nella Casa di Carta **tolta la gestione del caffe'**: le capsule sono merce di
  magazzino come le altre e si gestiscono nella zona Casa di Carta, senza duplicati.
- **h.** Nuova zona di magazzino **`carta`**: i prodotti core della Casa di Carta hanno la loro
  voce e non finiscono piu' fra i "comune". In elenco i **core stanno sopra**, e sotto una riga
  di separazione la merce **comune a tutte le zone**. Gli articoli con la vecchia zona `cdc`
  vengono migrati da soli, e il vecchio nome continua a funzionare nelle chiamate.

### Test
**70 verdi**, con una prova nuova sulla zona `carta`: articolo core distinto dal comune,
compatibilita' del vecchio nome e normalizzazione al salvataggio.

## v4.79 — Area fitness + il film in home

### Area fitness
Non e' una disciplina della Coppa (quelle hanno punti, gironi e graduatoria) ne' un campo
(quelli sono slot gratuiti senza istruttore): e' un'entita' sua, che riusa pero' lo stesso
impianto di prenotazione gia' collaudato.

Il modello segue la realta' che mi hai descritto: **corsi brevi**, anche di una sola settimana,
con istruttore esterno che **vuole i contanti a fine lezione**. Nessun abbonamento, nessun
conteggio di presenze da mantenere.

**Corso**: disciplina, istruttore, descrizione, inizio e fine, giorni della settimana, ora,
durata, posti massimi, minimo di iscritti, prezzo a lezione, flag masterclass con prezzo vip,
attivo. Salvando, **le lezioni si generano da sole** nei giorni scelti fra le due date; la
rigenerazione e' idempotente e non tocca quelle esistenti.

**Masterclass sulla singola lezione**, non solo sul corso: l'istruttore piu' noto che tiene una
sera sola si rappresenta cosi', con titolo, nome e prezzo suoi, senza inventare un corso
apposta. Le altre lezioni del corso restano al loro prezzo — c'e' un test che lo verifica.

**Minimo di iscritti**: sotto la soglia la lezione resta *in attesa* e mostra quanti ne mancano;
raggiunta, diventa *confermata*. La regola si spegne da **Regole & parametri**
(`fitness_minimo`), e allora ogni lezione parte comunque. Secondo parametro:
**prenotazione obbligatoria**.

**Nel Crew** (modulo 🧘 Fitness, permesso `fitness`): per ogni lezione lo stato, gli iscritti,
il tasto **incassa** per chi paga in contanti, l'**iscrizione al banco** per chi si presenta
senza app, e il totale da incassare.

Un corso con iscrizioni attive non si cancella.

### Il film nel cartellone settimanale
La serata cinema porta con se' **il film in programma**: nella card della settimana il socio
legge titolo, regia e durata invece di una descrizione sempre uguale.

### Test
**69 verdi.** Gli otto nuovi coprono: generazione delle lezioni nei giorni scelti senza
doppioni, minimo che tiene la lezione in attesa e conferma al raggiungimento, minimo spento dai
parametri, masterclass sulla singola lezione senza toccare le altre, incasso e iscrizione al
banco, iscrizioni del socio con disdetta solo delle proprie, corso protetto dalla cancellazione,
e il titolo del film nel cartellone.

## v4.78 — Cinema

Avevi ragione: **il motore era gia' pronto**. La platea dello stage e' la stessa cosa della sala
del Garden — posti con una posizione su una pianta, assegnati dal centro verso l'esterno — quindi
invece di duplicarlo l'ho generalizzato. Una disposizione ora appartiene a un **ambiente**
(`garden` | `stage`) e un posto ha un **tipo** (`standard` | `extra`). Cambiano le etichette
(posti invece di tavoli, proiezione invece di turno), non la logica: stesso codice, stessi test.

### Cartellone film
Anagrafica con titolo, regia, anno, durata, genere, visione consigliata e sinossi.
**Stampa in A4** (o PDF da inviare): i film in scheda su due colonne, con sotto ciascuno le date
di programmazione — o "data da definire" se non e' ancora fissata. Un film in cartellone **non
si cancella** finche' ha proiezioni: dice quante sono.

### Proiezioni
Data, ora e film. Il titolo della proiezione piu' vicina e' quello che l'app puo' mostrare nel
cartellone settimanale. Una proiezione con prenotazioni attive non si cancella.

### Platea
Prospetto dei posti con lo stato (standard libero, extra libero, occupato) e l'elenco di chi ha
prenotato con i numeri assegnati. I posti si disegnano e si trascinano come i tavoli del Garden.
- **Posti standard**: 40 di partenza, in file da 10.
- **Posti extra**: 12 in fondo, che **si aprono solo quando gli standard sono esauriti**.
- Parametro **"Posti extra in platea"** (SI/NO, default SI): spento, a standard finiti la
  proiezione risulta al completo. Parametro **"Prenotazione del posto"** per tornare a ingresso
  libero senza smontare nulla.

### API
`GET /api/cinema` (film + prossime proiezioni con posti liberi), `POST /api/cinema/:id/prenota`,
`GET /api/cinema/mie-prenotazioni`; lato gestore `film`, `proiezioni`, `proiezioni/:id/platea`.

### Test
**61 verdi.** I sei nuovi coprono: film in cartellone non cancellabile, platea con standard ed
extra, assegnazione dal posto piu' centrale, apertura degli extra solo a standard esauriti,
"al completo" con gli extra spenti, cartellone pubblico, e la prova che **il Garden e la platea
non si disturbano** pur usando lo stesso motore.

## v4.77 — Home dei soci: spazio recuperato in altezza

- **Casata accanto alla Tessera**, non piu' sotto: la testata scende da tre fasce a **due**.
- **Tessere di prenotazione compatte**: icona a sinistra, titolo e descrizione a destra, su due
  colonne. Occupano circa un terzo dell'altezza della versione quadrata, a parita' di
  leggibilita' e di area di tocco (resta il minimo di 44 px).
- **Serate su prenotazione spostate negli Eventi**, dove sta il resto del cartellone.
- **"Questa settimana" sale**: il programma e' ora visibile senza scorrere, dove prima stava
  sotto la piega insieme alle serate.

## v4.76 — Maquillage, primo passaggio (gruppo F)

### Allineamento: via i gradini fra celle adiacenti
Il difetto nasceva dal `flex-wrap`: schede affiancate con testi di lunghezza diversa finivano ad
altezze diverse, e i contenuti interni scalavano come gradini. Introdotto un impianto
`.cardgrid`:
- la **griglia impone la stessa altezza** a tutta la riga (`align-items:stretch`);
- dentro ogni scheda tre fasce fisse — **titolo in alto, corpo elastico, azioni ancorate in
  fondo** (`margin-top:auto`) — cosi' le parti si allineano fra colonne adiacenti;
- classe `.brk` per URL e nomi lunghi, che prima allargavano la colonna.

### Schermata QR rifatta (l'esempio che avevi indicato)
Le tre schede App Soci / App Chiosco / Back Office ora hanno titoli, QR e indirizzi **sulla
stessa riga**. In piu':
- il **selettore del tavolo legge la disposizione del giorno** invece di essere un campo libero:
  si sceglie fra i tavoli che esistono davvero, unioni comprese;
- **"Tutti i tavoli"** genera in un colpo i QR di tutta la sala;
- **stampa rifatta**: un QR per foglio A4, centrato, con margini uguali e interruzione di pagina
  pulita — niente piu' pagine zoppe.
- Corretto un difetto emerso subito: il QR e' un SVG senza dimensioni proprie e dentro un
  contenitore flex collassava a zero. Ora ha una regola dedicata.

### Mobile piu' denso
Sotto gli 820 px: schede e titoli piu' compatti, tabelle marcate `.fit` che stanno nello schermo
invece di scorrere. Sotto i 420 px: margini ridotti, padding minori, statistiche piu' piccole —
**si guadagna spazio togliendo margini, non rimpicciolendo le aree di tocco**.

### Correzione nei test
Un test iniziava a fallire al cambio di giorno: le date di prova erano consecutive e finivano
nella stessa settimana ISO, sbattendo contro il tetto settimanale per socio. Ora ogni indice
cade in una settimana diversa. Un test che passa il lunedi' e fallisce il martedi' non serve a
niente — il prodotto non c'entrava.

### Testata dell'app dei soci: da cinque fasce a tre
- La fascia **"Testo A / A+ / A++ / Contrasto"** non occupa piu' una riga fissa: si apre
  dall'icona **A±** in alto e ricorda la scelta. Resta a portata di chi ne ha bisogno senza
  rubare lo schermo a tutti gli altri.
- **Chip Tessera e Casata allineati**: stessa larghezza e stesso asse, il badge non galleggia
  piu'.
- **Kicker non piu' ripetuto**: le due card di fila dicevano entrambe "…ALLA BUSSOLA"; ora la
  seconda dice solo "Stasera".
- Corretto un difetto classico: l'attributo `hidden` non bastava, perche' la classe con
  `display:flex` vinceva sullo stile del browser.

## v4.75 — Il back office dice quando il calendario non torna

Segnalato uno schermo dei Tornei con **"2 giornate per girone · 0/8 partite"** invece delle 3
giornate e 12 partite attese.

**Non era una dicitura da correggere: quel pannello diceva il vero.** Su un database appena
creato tutte e dieci le discipline generano 2 gironi da 4, **3 giornate da 2 partite, 12 partite
in tutto** — verificato disciplina per disciplina. Un calendario con 8 partite e 2 giornate
esiste davvero nel database che si sta guardando, ed e' quasi sempre un calendario generato da
una **versione precedente** e mai rigenerato: `generaCalendario` non tocca le discipline finche'
non si preme "Genera / azzera calendario".

Il difetto vero era che il pannello mostrava il numero senza dire che era anomalo. Ora:
- **Tabella per girone** — casate, giornate, partite, con l'esito `regolare` / `da rigenerare`.
- **Avviso in evidenza** quando la struttura non e' quella attesa, con i numeri trovati, la
  spiegazione (calendario di una versione precedente) e il rimedio: premere
  "Genera / azzera calendario", **avvertendo che azzera i risultati** di quella disciplina.

Nessuna rigenerazione automatica: cancellare risultati di nascosto sarebbe peggio del problema.

## v4.74 — App residence (gruppo B)

### Casata → appartenenti e capitano (punto 6)
Toccando una riga della classifica generale si apre la casata: **elenco degli iscritti col
capitano in cima**, segnalato dalla stella e dal badge. Nuova rotta
`GET /api/casate/:id/appartenenti`.
L'elenco espone **solo nome, ruolo e tipo di profilo**: niente e-mail, telefono o date. Serve a
riconoscersi fra soci della stessa casata, non a schedarsi — c'e' un test che blocca i campi
restituiti, cosi' non ci si allarga per distrazione.
La **chat interna** resta dichiarata come prossima versione, come da tua indicazione.

### Ordinazione divisa Bar / Garden (punto 8)
Al posto della tessera unica "Ordina · bar & garden" ora ce ne sono **due**, con percorsi
diversi perche' diverse sono le cose:
- **🍸 Bar** — si ordina e si ritira al banco: menu del Bar (piu' le voci comuni) e via.
- **🍽️ Garden** — prima il **tavolo**, poi il menu.

`GET /api/menu?zona=bar|garden` restituisce le referenze di quel punto piu' le comuni: Bar e
Garden non vendono gli stessi prodotti a due prezzi.

### Prenotazione della cena a due turni, nell'app (punto 8)
Il socio sceglie **giorno**, **quante persone** e il **turno** (20:00 o 21:30), con i posti
liberi e i coperti gia' prenotati sotto ogni turno. **Il tavolo non lo sceglie**: glielo
assegna il sistema partendo dai piu' centrali, secondo la regola gia' costruita in v4.70 — e
la prenotazione compare subito nella Pianta della Crew. In fondo al foglio "Le mie
prenotazioni", con annullamento.

### Icone e dimensioni (punto 8)
Le icone delle tessere della home passano da 1,4 a **2 rem**, con etichette piu' leggibili e
area di tocco doppia. La griglia non e' piu' fissa a 3 colonne ma si adatta alla larghezza:
con cinque tessere non resta piu' una riga sbilanciata.

### Test
**55 verdi.** I due nuovi verificano l'elenco degli appartenenti (capitano in testa, 404 su
casata inesistente, campi esposti) e il menu filtrato per punto (nessuna voce del Garden nel
Bar e viceversa).

## v4.73 — Limature su tabellone e pianta

**1. Giornate dei gironi.** Gia' cosi': 4 casate che si incontrano una volta = **3 giornate da
2 partite**, generate dal round robin e verificate dai test fin dalla v4.71. Nessuna modifica.

**2. Date per singola partita.** La data della **giornata** continua a scrivere entrambe le
righe, ma ogni incontro puo' poi **slittare per conto suo** — meteo, campo occupato,
opportunita'. Nuovo campo data sotto ogni partita e rotta
`PUT /api/admin/partite/:id/quando`. Il foglio gara stampa la data effettiva.

**3. Pianta dei tavoli.**
- **Unione**: due tavoli accostati diventano **un tavolo solo** con i posti sommati. Il numero
  assorbito non sparisce dal mondo: i **QR gia' stampati continuano a funzionare** e le comande
  con quel numero confluiscono sul tavolo che lo ha assorbito. Si separa con un tocco e i posti
  tornano come prima.
- **Tab Tavoli (comande)**: era la vera lacuna. Leggeva un semplice conteggio
  (`garden_tavoli`), quindi disegnava sempre 1..N e ignorava del tutto la pianta. Ora legge
  **la sala del giorno**: i tavoli aggiunti compaiono, quelli assorbiti spariscono dalla mappa,
  e la card mostra numero, unione e posti (`Tavolo + 2 · 8 p`). Nuova rotta
  `GET /api/admin/tavoli/sala` con la mappa `numero scritto -> tavolo che lo serve`.
- I tavoli fuori servizio restano visibili solo in modalita' Disposizione, per rimetterli.

**4. Struttura della fase finale sempre visibile.** Sotto i gironi si vede l'intero tabellone a
scontri diretti **prima che si sblocchi**: ogni casella dice da dove arriva la casata
("1º Girone A", "Vincente quarto 4", "Perdente semifinale 1") e, se la classifica esiste gia',
**chi la occuperebbe oggi**. Gli incroci sono quelli veri del motore: 1º-4º, 2º-3º, 3º-2º,
4º-1º fra i due gironi.

### Correzione
Nella mappa dei numeri, un tavolo fuori servizio si rimappava su se stesso e annullava
l'unione: ora solo i tavoli davvero in sala puntano a se stessi.

### Test
**53 verdi.** I tre nuovi coprono: data di partita che si sposta senza toccare l'altra della
giornata, struttura della fase finale con etichette e occupanti provvisori, unione dei tavoli
con numeri assorbiti ancora raggiungibili e non piu' assegnabili.

## v4.72 — Regole parametriche + consumazione obbligatoria + referenzialita' (gruppo D)

### Le regole diventano parametri (premessa accolta)
Tutto cio' che determina una condizione si accende e si spegne da **Regole & parametri**, nel
back office, e vale per l'intero residence. Un parametro puo' essere SI/NO, un numero o una
scelta, e puo' **dipendere** da un altro: le voci figlie compaiono in grigio e non vengono
applicate finche' l'interruttore sopra di loro e' spento.

Parametri di questa versione:
| Gruppo | Regola | Predefinito |
|---|---|---|
| Campi | Limite di durata per prenotazione | SI (il numero resta sulla scheda del campo) |
| Campi | Tetto di prenotazioni a settimana | SI (idem) |
| Campi | Prenotazione obbligatoria anche per il gioco libero → tempo massimo di utilizzo | NO → 90 min |
| Campi | Partite aperte "gli altri si uniscono" → come si partecipa | SI → ci si unisce **o** si prenota una fascia nuova |
| Sport | Foglio gara stampabile dal Crew | SI |
| Eventi | Eventi a pagamento → come si paga l'ingresso | SI → si sceglie evento per evento |
| Garden | Prenotazione della cena a turni | SI |

I valori vivono nella tabella `impostazioni` (nessuna migrazione). **Aggiungerne uno costa tre
righe**: si dichiara nel registro di `server/parametri.js` e si legge con `await par("chiave")`.
Se un parametro dipende da un interruttore spento, `par()` restituisce da solo il valore neutro:
chi legge non deve ricordarsi di controllare anche il genitore. Il permesso `parametri` e'
**riservato al gestore**, non delegabile: sono le regole di funzionamento del residence.
Le regole attive viaggiano anche verso l'app (`GET /api/campi` le restituisce), cosi'
l'interfaccia non deve indovinare cosa e' acceso.

### Punto 12 — Consumazione obbligatoria
Un evento puo' chiedere, **in alternativa** al prezzo d'ingresso, una consumazione obbligatoria:
si entra consumando. Nuovi campi `eventi.costo_tipo` (nessuno | prezzo | consumazione) e
`eventi.consumazione`. La scelta e' filtrata dai parametri: se e' ammesso un solo modo, l'altro
non si puo' salvare per sbaglio, e con gli eventi a pagamento spenti tutti gli ingressi tornano
liberi. La dicitura compare in back office, nell'app dei soci (🥂) e in locandina A3.

### Punto 13 — Referenzialita' del database
Prima ogni cancellazione portava via in silenzio quello che le stava sotto: eliminare una
disciplina cancellava partite e gironi, un campo cancellava le prenotazioni, un articolo
cancellava i suoi movimenti. Ora la cancellazione **si ferma e dice cosa la blocca e quanto**:
*"Non posso eliminare il campo: prima vanno rimosse 2 prenotazioni attive."*

Radici protette: casate (soci, tornei, esiti), discipline (partite giocate, edizioni
nell'Albo d'Oro), campi (prenotazioni e partite attive), articoli di magazzino (movimenti,
impegni), voci di menu (righe di comanda), giochi (prestiti non rientrati), serate
(prenotazioni non annullate), contest (esiti), disposizioni tavoli (giorni che le usano).
Restano a cascata solo i rami senza vita propria, per esempio un blocco campo.
Nuova rotta `GET /api/admin/referenze/:entita/:id`: l'interfaccia puo' spiegarlo **prima** di
proporre il cestino. La cancellazione GDPR di un socio resta volutamente fuori: li' cancellare
e' il diritto da garantire, non il rischio da evitare.

### Test
**50 verdi.** I nuovi coprono: valori predefiniti e dipendenze dei parametri, riservatezza al
gestore, effetto reale di ogni interruttore (durata, tetto settimanale, partite aperte, cena),
consumazione obbligatoria salvata, filtrata dal modo ammesso e vista dai soci, e sei prove di
referenzialita' con il ramo che blocca e la cancellazione che torna possibile una volta rimosso.

## v4.71 — Il tabellone sta dove si gioca

### La domanda che ha guidato il rilascio
Se i gironi si formano da soli (8 casate → due gironi da 4 → 3 giornate da 2 partite), che senso
ha tenere nel back office una **replica della gestione del tabellone** e la **stampa del foglio
gara**? Nessuno: erano due posti da tenere allineati per la stessa cosa.

### Videata del tabellone rifatta (Crew · modulo Sport)
- I **due gironi affiancati** su schermo largo, uno sotto l'altro sul telefono.
- **Classifica compatta**: colonne strette, il nome della casata e i numeri essenziali.
- Sotto ogni girone le sue **3 giornate**, ciascuna con i **2 incontri** e un **campo data** che
  la crew compila. La data e' unica per giornata e vale per entrambe le partite (nel database
  resta per partita, cosi' un recupero si puo' sempre spostare).
- Contatore per giornata (`1/2`, `2/2`) per vedere a colpo d'occhio cosa manca.
- **Foglio gara stampabile dal Crew**: A4, i due gironi in colonna, giornata per giornata, con
  le caselle vuote e la data (quella fissata, oppure i puntini da riempire a mano).

### Correzione
Il titolo del girone mostrava **"Girone Girone A"**: il nome arriva gia' completo dal database e
veniva preceduto un'altra volta dalla parola. Ora e' "Girone A".

### Back office: da "Tabellone" a "Tornei"
Restano — e sono la sua materia — periodo, stato, regolamento visibile ai soci, genera/azzera
calendario, archiviazione nell'Albo d'Oro, regolamenti generali. Al posto della replica dei
gironi c'e' un **riepilogo di avanzamento** (gironi, giornate per girone, partite giocate) che
rimanda al Crew per il tabellone. Rimossi `gironeHtml` e `stampaGiornata`.

### Test
**35 verdi.** I due nuovi verificano la struttura del girone (4 casate, 6 partite, 3 giornate da
2, nome del girone) e la data di giornata: si applica a entrambe le partite, non tocca le altre
giornate ne' l'altro girone, e si puo' cancellare.

## v4.70 — Tavoli del Garden: pianta trascinabile e riempimento dal centro

Chiude il gruppo **C** (punto 8, seconda meta').

### Il modello prima non c'era
Fino alla v4.69 i tavoli erano soltanto numeri (`1..N` da una impostazione), senza posti ne'
posizione: non c'era nulla su cui applicare una regola spaziale. Ora esiste un'entita' vera.
- **`tavoli_layout`** — una *disposizione* con un nome ("Standard", "Concerto", "Cena unica").
- **`tavoli`** — numero, posti, forma, posizione x/y in percentuale, in servizio si'/no.
- **`tavoli_giorni`** — quale disposizione vale in un certo giorno: la sistemazione cambia con
  la serata, quindi si sceglie per data. In assenza vale la predefinita.
- **`prenotazioni_tavolo`** — data, turno, persone, elenco dei tavoli occupati, origine.

Il **numero del tavolo resta l'identita' stabile**: e' quello dei QR self-order e di
`comande.riferimento`, quindi spostare un tavolo sulla pianta non rompe nulla.

### Dal centro alla periferia
L'assegnazione parte dal **baricentro dei tavoli attivi**: la regola vale con qualunque
disposizione, anche asimmetrica, e si adatta da sola quando la Crew sposta i tavoli — nessun
parametro da configurare. Fra i tavoli liberi che contengono il gruppo si sceglie il piu'
centrale, preferendo quello che spreca meno posti. Se **nessun tavolo basta**, si accorpano i
piu' vicini al centro finche' i posti coprono il gruppo: i gruppi numerosi non sono un caso
speciale da gestire a mano.

### La pianta nel Crew (modulo Garden, tab 🪑 Pianta)
Due modalita' sullo stesso disegno:
- **Servizio** — chi occupa cosa, coperti prenotati e posti liberi del turno, elenco delle
  prenotazioni con annullamento, e **prenotazione al banco**.
- **Disposizione** — i tavoli si **trascinano** (dito o mouse) per riprodurre la sala di
  stasera; toccandone uno si cambiano posti e forma o lo si toglie dal servizio. Si salva, si
  crea una nuova disposizione copiando quella corrente, e si assegna al giorno.

### Prenotazione della cena a due turni
`20:00` e `21:30` (modificabili con l'impostazione `garden_turni`). Il socio indica solo
**persone e turno**, il tavolo glielo assegna il sistema. API: `GET /api/garden/turni`,
`POST /api/garden/prenota`, `GET /api/garden/mie-prenotazioni`,
`POST /api/garden/prenotazioni/:id/annulla`. Serve la tessera di un socio attivo.
La Crew prenota con `POST /api/admin/tavoli/prenota`: senza turno indicato prende il **primo
successivo all'ora corrente**, e puo' sempre spostare a mano l'assegnazione automatica.

*Resta da fare (gruppo B): il percorso di prenotazione dentro l'app dei soci, che oggi passa
dalla risorsa generica "Tavolo per la cena".*

### Correzione
`setPointerCapture` poteva interrompere l'inizio del trascinamento: ora e' difensivo, cosi' la
pianta si sposta sia col dito sia col mouse. Verificato con entrambi.

### Test
**33 verdi.** Gli otto nuovi coprono disposizione predefinita, salvataggio della pianta con
numeri stabili, scelta del tavolo piu' centrale, accorpamento per gruppi grandi, indipendenza e
capienza dei due turni, tessera obbligatoria e annullamento, prenotazione al banco con
spostamento e conflitto, disposizione diversa per serata.

## v4.69 — Crew completo: operatori e permessi non sono piu' un binario morto

Chiude i **punti 4 e 3** dell'elenco originale.

### Il problema
Il Crew mappava su un modulo solo tre permessi (`comande`, `magazzino`, `tabellone`). Un
operatore creato e abilitato a **Casa di Carta**, **Serate** o **Campi** veniva salvato
correttamente ma al login riceveva "Nessun permesso operativo": i permessi esistevano nel back
office e non aprivano nulla.

### Tre moduli nuovi nel Crew
- **📚 Casa di Carta** (cap `cdc`) — conta capsule del caffe' con registrazione del consumo,
  prestiti in corso con presta/riconsegna a un tocco, inventario giochi.
- **🎾 Campi** (cap `campi`) — prenotazioni del giorno con titolare e partecipanti, prenotazione
  al banco per conto di un socio (serve la sua tessera: resta lui il titolare), blocchi campo
  per torneo/manutenzione/evento.
- **🍽️ Serate & cena** (cap `serate`) — coperti prenotati sulla capienza, totale da incassare,
  "segna saldata" e annulla per singola prenotazione.

### Casa di Carta agganciata al Centrale (punto 3)
`cdc` diventa una **zona del magazzino** come Bar e Garden: non un deposito separato, ma
un'abilitazione sulla merce unica del Centrale. Carico, **impegno** (prenota senza spostare
merce) e **scarico** (consuma dal Centrale) funzionano come per le altre zone; la zona vede i
propri articoli piu' i `comune` e non quelli riservati alle altre. Sotto-tab "📚 Casa di Carta"
nell'hub Magazzino e tab "Scorte" nel modulo, per chi ha anche il permesso `magazzino`.

### Nessun operatore senza porta
Chi non ha alcun permesso operativo non riceve piu' un errore generico ma l'elenco esatto dei
moduli a cui puo' essere abilitato.

### Test
**25 verdi.** I tre nuovi verificano che ognuno dei sei permessi operativi apra un modulo, che
un operatore con un solo permesso usi il suo e riceva 403 sugli altri, e che la Casa di Carta
attinga al Centrale rispettando impegni e scarichi.

## v4.68 — Coppa delle Casate: graduatoria interamente calcolata

**Niente piu' inserimento manuale.** Il cartellone aveva un campo "Punti Coppa" editabile per
casata, il tasto "Salva Punti Coppa" e "Applica totali tornei a tutte". Tutto rimosso: resta un
solo tasto, **Ricalcola e riordina**.

Il totale si compone da solo da tre sorgenti, tutte automatiche:
1. **tornei in corso** — `graduatoriaFinale()` della disciplina (12/10/8/6 ai primi quattro,
   4 dal 5º all'8º), quando la finale e' stata giocata;
2. **edizioni archiviate** — nuova colonna `edizioni.punti_coppa`, congelata al momento
   dell'archiviazione. Serviva: `archiviaEdizione` cancella partite e gironi, quindi senza
   congelamento i punti di un torneo archiviato sparivano dalla Coppa;
3. **contest e serate** — `contest_esiti.punti` dei contest il cui esito e' stato assegnato.

`casate.punti` (la colonna letta dall'app dei soci) diventa un **valore derivato**, riscritto da
`ricalcolaCoppa()` a ogni risultato registrato, archiviazione di edizione ed esito di contest
assegnato: il tasto serve solo come riallineamento manuale. `assegnaCoppa` non somma piu' i punti
su `casate.punti` (era un accumulo non ripetibile): li lascia in `contest_esiti` e il ricalcolo
li rilegge, quindi l'operazione e' idempotente.

**Pari merito.** A parita' di punteggio le casate condividono la stessa posizione, con la
numerazione che salta i posti occupati (1, 1, 3 e non 1, 1, 2). La posizione e' calcolata dal
server ed esposta anche da `GET /api/casate`, cosi' l'app dei soci non la ricalcola per conto
suo: back office e app mostrano necessariamente lo stesso numero. Nel cartellone gli ex aequo
sono marcati con `=`.

### Altro
- `PUT /api/admin/casate/:id/punti` risponde ora **410** con la spiegazione, per segnalare il
  cambiamento a eventuali client non aggiornati.
- Il seed non popola piu' punteggi arbitrari: le casate partono da 0 e il ricalcolo deriva
  quanto risulta dai risultati inseriti.
- Nuovo modulo `server/coppa.js`; nuove rotte `POST /api/admin/coppa/ricalcola` e
  `GET /api/admin/coppa/cartellone` (che ora restituisce `graduatoria` con `tornei`, `contest`,
  `punti`, `posizione`, `exAequo`; i vecchi campi `casate` e `totali` restano per compatibilita').
- Test: **22 verdi**, fra cui un torneo giocato per intero che verifica scala dei punti, ex
  aequo, coerenza fra back office e app soci e sopravvivenza dei punti all'archiviazione.

### Da valutare (non toccato)
`archiviaEdizione` registra nell'Albo d'Oro come vincitore il primo della **classifica combinata
dei gironi**, che puo' non coincidere con chi ha vinto la finale. Nella prova end-to-end il
tabellone dava Epipoli e l'Albo d'Oro Neapolis. Comportamento preesistente, va deciso quale dei
due sia quello giusto.

## v4.67 — Prenotazione campi "titolare + gli altri si uniscono"

### Correzione importante (era in v4.66)
- **Campi di default duplicati (10 invece di 5).** Il guard di riga di comando in fondo a
  `server/seed.js` (`import.meta.url === file://${process.argv[1]}`) risulta **vero anche nel
  bundle single-file**, perché l'entry è `bussola.mjs`: partiva un secondo `seed()` non atteso,
  in parallelo con quello dell'entry. Due `migrate()` concorrenti leggevano il flag
  `campi_default_v1` ancora vuoto e inserivano entrambi i 5 campi. Ora il guard verifica anche
  che il file eseguito si chiami `seed.js`. Coperto da test di regressione.

### Modello di prenotazione
Ogni prenotazione ha un **socio titolare identificato dalla tessera**; è l'unico ingresso, sia
per la prenotazione riservata sia per la partita aperta.
- **Posti fissi, decisi dal gestore.** Vale sempre `campi.posti_default`: un eventuale
  `posti_totali` inviato dal client viene ignorato.
- **Solo io** (`POST /api/campi/:id/prenota`) → slot riservato al titolare, nessuno si unisce,
  non compare fra le partite aperte.
- **Apri ai soci** (`POST /api/campi/:id/partita`) → gli altri si uniscono fino ai posti del
  campo. Il titolare è sempre il primo iscritto.
- Anche chi si unisce deve avere una tessera valida di socio attivo.
- L'annullamento libera **tutte** le fasce della prenotazione.

### Regole d'uso (esposte in back office e verificate dal server)
Due nuovi parametri per campo, modificabili solo dal gestore:
- **`max_slot_prenotazione`** (default 2) — durata massima: quante fasce consecutive può
  occupare una singola prenotazione.
- **`max_pren_settimana`** (default 3) — quante prenotazioni può fare lo stesso socio, come
  titolare, in una settimana (lunedì–domenica) **su quel campo**.
Il socio vede la quota residua nel foglio di prenotazione; oltre il tetto la richiesta è
rifiutata con il motivo. *Nota: il tetto è per campo, non complessivo sui cinque campi.*

### Campo impegnato (torneo, manutenzione, evento)
Nuova tabella `campi_blocchi` + pannello in back office. Le fasce dichiarate non sono
prenotabili e appaiono come 🚧 nell'app. È così che si applica la regola "il basket si prenota
solo se non c'è il torneo": il motore Coppa non lega le partite a un campo (`partite` ha solo
`quando` e `luogo` come testo libero), quindi l'impegno va dichiarato.

### Governance
`GET /api/admin/campi/prenotazioni` restituisce **una riga per prenotazione** (non per fascia),
con titolare, partecipanti, fasce occupate e posti liberi. I campi restano **gratuiti**: si
governa l'uso, non un conto.

### Struttura del progetto
- Albero dei sorgenti ricostruito dal bundle v4.66 (il codice della sessione precedente era
  andato perso): `server/` (20 moduli), `public/`, `admin/`, `chiosco/`, `ordina/`,
  `shared/comanda.js`.
- `scripts/build-online.mjs` riscritto: assembla gli `<!--#include -->` nei quattro front-end e
  ribundla con esbuild in `online/bussola.mjs`.
- Fedeltà verificata: ribuildando v4.66, `chiosco.html` e `ordina.html` tornano byte-identici
  agli originali estratti dal bundle.
- **`tests/api.test.js` riscritto da zero: 17 test verdi** end-to-end via HTTP (gli 87
  precedenti non erano recuperabili dal bundle).

### Migrazioni
Automatiche e idempotenti in `migrate()`: colonne `campi.max_slot_prenotazione`,
`campi.max_pren_settimana`, `partite_aperte.{aperta_ai_soci,n_slot,slot_fine,titolare_socio_id}`,
`prenotazioni_campo.titolare_socio_id`, tabella `campi_blocchi`. Nessun intervento manuale sul
database esistente.

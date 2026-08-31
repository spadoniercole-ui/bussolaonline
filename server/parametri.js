// Parametri di funzionamento — le regole che accendono o spengono un comportamento.
//
// Principio: tutto cio' che determina una CONDIZIONE sta qui, non sparso nel codice.
// Un parametro esiste quando la risposta puo' cambiare fra una stagione e l'altra o fra due
// gestori; altrimenti e' una decisione presa, non un parametro.
//
// Aggiungerne uno costa tre righe: si dichiara nel REGISTRO qui sotto e si legge con
// `await par("chiave")`. Il valore vive nella tabella `impostazioni` (chiave/valore), quindi
// non serve nessuna migrazione.
import { getSetting, setSetting } from './db.js';

// tipo: bool | numero | scelta
// dipende_da: la voce compare (ed e' applicata) solo se il parametro indicato e' acceso
const REGISTRO = [
  // ---- Campi ----
  {
    chiave: "campi_limita_durata", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Limite di durata per prenotazione",
    aiuto: "Se spento, un socio puo' prenotare quante fasce consecutive vuole."
  },
  {
    chiave: "campi_durata_massima_minuti", gruppo: "Campi", tipo: "numero", predefinito: 120, min: 30, max: 300,
    etichetta: "Durata massima di una prenotazione (minuti)",
    aiuto: "Il limite vero e' il TEMPO, non il numero di fasce: su un campo da 90 minuti due fasce fanno tre ore, e il tetto sulle fasce non serviva a niente. Da qui si ricava quante fasce si possono prendere su ciascun campo."
  },
  {
    chiave: "campi_limita_settimana", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Tetto di prenotazioni a settimana",
    aiuto: "Se spento, nessun limite settimanale. Serve a evitare che siano sempre gli stessi a occupare il campo; il numero e' sulla scheda del campo."
  },
  {
    chiave: "campi_prenotazione_obbligatoria", gruppo: "Campi", tipo: "bool", predefinito: false,
    etichetta: "Prenotazione obbligatoria anche per il gioco libero",
    aiuto: "Se acceso, il campo si usa solo se prenotato: in app compare la regola e la crew puo' verificare a chi e' assegnata la fascia."
  },
  {
    chiave: "campi_durata_max_minuti", gruppo: "Campi", tipo: "numero", predefinito: 90, min: 15, max: 300,
    dipende_da: "campi_prenotazione_obbligatoria",
    etichetta: "Tempo massimo di utilizzo (minuti)",
    aiuto: "Durata oltre la quale il campo va liberato se c'e' chi aspetta."
  },
  {
    chiave: "campi_numero_legale", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Numero legale: chi gioca va dichiarato",
    aiuto: "Senza questa regola le altre si aggirano: prenota uno e giocano in sei senza registrarsi. Con il numero legale, se poco prima dell'orario i giocatori dichiarati sono meno del minimo del campo, la prenotazione decade e il campo torna libero."
  },
  {
    chiave: "campi_numero_legale_minuti", gruppo: "Campi", tipo: "numero", predefinito: 30, min: 5, max: 180,
    dipende_da: "campi_numero_legale",
    etichetta: "Quanti minuti prima si verifica",
    aiuto: "Con trenta minuti chi aspetta il campo fa in tempo a prenderlo."
  },
  {
    chiave: "campi_quota_su_partecipanti", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Il tetto conta chi gioca, non chi prenota",
    aiuto: "Senza questa regola il tetto si aggira facilmente: basta che a prenotare le fasce successive siano gli altri del gruppo. Con la regola accesa, una fascia pesa su tutti quelli che vi partecipano."
  },
  {
    chiave: "campi_catena", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Le fasce attaccate contano insieme",
    aiuto: "Fasce consecutive in cui gioca la stessa persona valgono come una sola occupazione lunga, anche se le prenota qualcun altro: cosi' un gruppo non pu\u00f2 tenere il campo tutto il pomeriggio passandosi il testimone."
  },
  {
    chiave: "campi_max_giorno", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Tetto giornaliero per socio",
    aiuto: "Oltre al tetto settimanale: quante volte al giorno lo stesso socio pu\u00f2 giocare su uno stesso campo."
  },
  {
    chiave: "campi_max_giorno_n", gruppo: "Campi", tipo: "numero", predefinito: 1, min: 1, max: 6,
    dipende_da: "campi_max_giorno",
    etichetta: "Prenotazioni al giorno per socio",
    aiuto: "Su ciascun campo. Uno significa: una volta al giorno per campo, poi il campo passa ad altri."
  },
  {
    chiave: "campi_finestra", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Finestra di prenotazione",
    aiuto: "Impedisce che qualcuno si prenoti mezza stagione il primo giorno: la finestra scorre in avanti, e tutti trovano lo stesso spazio libero."
  },
  {
    chiave: "campi_finestra_giorni", gruppo: "Campi", tipo: "numero", predefinito: 7, min: 1, max: 60,
    dipende_da: "campi_finestra",
    etichetta: "Giorni di anticipo",
    aiuto: "Quanti giorni prima si pu\u00f2 prenotare una fascia."
  },
  {
    chiave: "campi_unisciti", gruppo: "Campi", tipo: "bool", predefinito: true,
    etichetta: "Partite aperte: gli altri si uniscono",
    aiuto: "Se spento, ogni prenotazione e' riservata al titolare e nessuno puo' aggiungersi."
  },
  {
    chiave: "campi_unisciti_modo", gruppo: "Campi", tipo: "scelta", predefinito: "unisciti_o_nuova",
    dipende_da: "campi_unisciti",
    opzioni: [
      { valore: "unisciti_o_nuova", etichetta: "Ci si unisce oppure si prenota una fascia nuova" },
      { valore: "solo_unisciti", etichetta: "Solo unendosi: niente seconda prenotazione nello stesso giorno" }
    ],
    etichetta: "Come si partecipa",
    aiuto: "Con \"solo unendosi\", chi ha gia' una prenotazione quel giorno su quel campo deve aggregarsi a una partita aperta invece di aprirne un'altra."
  },
  // ---- Comande ----
  {
    chiave: "comande_chiusura_automatica", gruppo: "Comande", tipo: "bool", predefinito: true,
    etichetta: "Chiudi da sola una comanda dimenticata",
    aiuto: "Una comanda lasciata aperta tiene il tavolo occupato all'infinito: dopo le ore indicate viene chiusa da sola, cosi' il tavolo torna pulito il giorno dopo."
  },
  {
    chiave: "comande_ore_abbandono", gruppo: "Comande", tipo: "numero", predefinito: 6, min: 1, max: 48,
    dipende_da: "comande_chiusura_automatica",
    etichetta: "Dopo quante ore",
    aiuto: "Sei ore coprono un servizio intero: quello che resta aperto oltre e' quasi sempre una dimenticanza."
  },
  {
    chiave: "beach_attiva", gruppo: "Spiaggia", tipo: "bool", predefinito: false,
    etichetta: "Gestione degli ombrelloni attiva",
    aiuto: "Spenta di serie, e non e\u2019 prudenza eccessiva: e\u2019 l\u2019unico servizio in cui il sistema non puo\u2019 far rispettare niente. Sulle piazzole non c\u2019e\u2019 nessuno, quindi tutto dipende dal fatto che la gente dichiari e rilasci. Provala una stagione: se non dichiarano, spegnila e non resta nessun rudere acceso."
  },
  {
    chiave: "beach_ingombro_ombrellone_m", gruppo: "Spiaggia", tipo: "numero", predefinito: 3, min: 1.5, max: 6,
    etichetta: "Ingombro di un ombrellone (metri)",
    aiuto: "Il quadrato che occupa l\u2019ombrellone CON i lettini e le persone sotto: non il diametro del telo. Tre metri e\u2019 la misura di un ombrellone con due sdraio."
  },
  {
    chiave: "beach_passaggio_m", gruppo: "Spiaggia", tipo: "numero", predefinito: 1.5, min: 0.8, max: 4,
    etichetta: "Passaggio fra gli ombrelloni (metri)",
    aiuto: "Lo spazio per passare fra due ombrelloni occupati, con le borse e i bambini. Sotto il metro e mezzo si cammina sugli asciugamani degli altri."
  },
  {
    chiave: "beach_mattina_da", gruppo: "Spiaggia", tipo: "ora", predefinito: "08:00",
    etichetta: "Fascia del mattino \u2014 da",
    aiuto: "Le fasce sono FISSE, non quattro ore da quando arrivi. Con le ore mobili chi prende alle 10:20 libera alle 14:20, un orario che non serve a nessuno; e chi arriva alle 15 trova occupato fino alle 19:20 anche se quello se ne va alle 18."
  },
  { chiave: "beach_mattina_a", gruppo: "Spiaggia", tipo: "ora", predefinito: "13:00", etichetta: "Fascia del mattino \u2014 a", aiuto: "Fine della prima fascia." },
  { chiave: "beach_pomeriggio_da", gruppo: "Spiaggia", tipo: "ora", predefinito: "13:00", etichetta: "Fascia del pomeriggio \u2014 da", aiuto: "Inizio della seconda fascia." },
  { chiave: "beach_pomeriggio_a", gruppo: "Spiaggia", tipo: "ora", predefinito: "19:00", etichetta: "Fascia del pomeriggio \u2014 a", aiuto: "Fine della seconda fascia: dopo, gli ombrelloni tornano liberi per il giorno dopo." },
  {
    chiave: "beach_posti_ombrellone", gruppo: "Spiaggia", tipo: "numero", predefinito: 2, min: 1, max: 6,
    etichetta: "Persone per ombrellone",
    aiuto: "Due: oltre, serve il secondo ombrellone. E\u2019 la misura che decide quanti ombrelloni prende un nucleo numeroso \u2014 accostati, e contano come una presa sola."
  },
  {
    chiave: "beach_fasce_al_giorno", gruppo: "Spiaggia", tipo: "numero", predefinito: 2, min: 1, max: 2,
    etichetta: "Fasce al giorno per nucleo",
    aiuto: "Quante volte al giorno un nucleo familiare puo\u2019 prendere un ombrellone. Due: mattina e pomeriggio, e poi basta fino al giorno dopo."
  },
  {
    chiave: "beach_avviso_minuti", gruppo: "Spiaggia", tipo: "numero", predefinito: 15, min: 0, max: 60,
    etichetta: "Avviso prima della scadenza (minuti)",
    aiuto: "Quanto prima si avvisa chi sta sotto l\u2019ombrellone che la fascia sta per finire. Senza avviso, la scadenza arriva addosso a chi e\u2019 li\u2019 in costume e produce solo discussioni."
  },
  {
    chiave: "coppa_quota_rosa", gruppo: "Casate", tipo: "numero", predefinito: 50, min: 0, max: 100,
    etichetta: "Quota di rappresentanza (%)",
    aiuto: "Percentuale minima di donne in ogni casata, arrotondata per DIFETTO. Al 50% su una casata da 12 fanno almeno 6. La quota si misura sul totale della casata, non fascia per fascia: sulle fasce sarebbe quasi sempre impossibile da rispettare."
  },
  {
    chiave: "coppa_casata_posti", gruppo: "Casate", tipo: "numero", predefinito: 12, min: 3, max: 30,
    etichetta: "Massimo giocatori per casata",
    aiuto: "Il tetto di una casata. E\u2019 al massimo che la quota di rappresentanza diventa tassativa: sotto, e\u2019 un obiettivo che si insegue mentre la casata si riempie."
  },
  {
    chiave: "coppa_casata_min", gruppo: "Casate", tipo: "numero", predefinito: 3, min: 2, max: 12,
    etichetta: "Minimo per scendere in campo",
    aiuto: "Quante persone servono perche\u2019 una casata esista. Tre sono quelle che stanno in campo in un calcetto o in un basket: sotto, non si gioca. Le casate si schierano sempre, anche piccole."
  },
  {
    chiave: "coppa_min_under14", gruppo: "Casate", tipo: "numero", predefinito: 2, min: 0, max: 6,
    etichetta: "Under 14 per casata",
    aiuto: "Quanti ragazzi sotto i 14 anni deve avere ogni casata."
  },
  {
    chiave: "coppa_min_over70", gruppo: "Casate", tipo: "numero", predefinito: 2, min: 0, max: 6,
    etichetta: "Over 70 per casata",
    aiuto: "Quanti soci sopra i 70 anni deve avere ogni casata. E' il vincolo piu' difficile da rispettare: se non ce ne sono abbastanza iscritti, il sistema lo dice invece di formare casate irregolari in silenzio."
  },
  {
    chiave: "coppa_chiusura_formazioni", gruppo: "Casate", tipo: "dataora", predefinito: "",
    etichetta: "Chiusura delle formazioni (AAAA-MM-GG HH:MM)",
    aiuto: "Fino a questo momento si entra, si esce e si cambia casata. Dopo, le formazioni si congelano e restano quelle. Vuoto = nessuna scadenza."
  },
  {
    chiave: "coppa_riapertura", gruppo: "Casate", tipo: "data", predefinito: "",
    etichetta: "Riapertura di meta\u2019 stagione (AAAA-MM-GG)",
    aiuto: "Un solo giorno in cui si puo\u2019 cambiare casata, e solo se non si e\u2019 ancora giocato nessun torneo. Riaperture continue trasformano la Coppa in un mercato: chi perde cambia squadra."
  },
  {
    chiave: "tessera_prepagata", gruppo: "Comande", tipo: "bool", predefinito: false,
    etichetta: "La tessera si puo\u2019 usare come prepagata",
    aiuto: "Il socio carica un importo e paga con la tessera fino a esaurimento. Il credito NON e\u2019 un incasso: e\u2019 un debito verso il socio, e diventa ricavo mano a mano che consuma. A fine stagione i saldi residui vanno rimborsati o riportati: decidilo prima di accendere questo interruttore."
  },
  {
    chiave: "tessera_ricarica_massima", gruppo: "Comande", tipo: "numero", predefinito: 100, min: 5, max: 500,
    etichetta: "Ricarica massima (\u20ac)",
    aiuto: "Quanto si puo\u2019 caricare in una volta. Tenerla bassa tiene piccolo anche il problema dei saldi residui a fine stagione."
  },
  {
    chiave: "tessera_pin_oltre", gruppo: "Comande", tipo: "numero", predefinito: 0, min: 0, max: 200,
    etichetta: "PIN richiesto oltre (\u20ac)",
    aiuto: "Sopra questo importo, per pagare con la tessera serve il PIN del socio. A zero il PIN si chiede sempre \u2014 ed e\u2019 la scelta prudente: il numero di tessera e\u2019 scritto sulla card e progressivo, quindi si indovina. Alzarlo velocizza i caffe\u2019 ma apre una porta."
  },
  {
    chiave: "ricevuta_email_automatica", gruppo: "Comande", tipo: "bool", predefinito: false,
    etichetta: "Manda la copia del conto ai soci senza chiederlo",
    aiuto: "Spento (consigliato): la copia parte solo se l'operatore scrive un indirizzo alla cassa. Acceso, ogni socio con e-mail riceve una copia per OGNI comanda \u2014 anche per un caff\u00e8. Tre caff\u00e8 al giorno fanno tre mail al giorno, e in una settimana il socio disattiva le notifiche."
  },
  {
    chiave: "comande_supplemento_complementi", gruppo: "Comande", tipo: "numero", predefinito: 0.5, min: 0, max: 5,
    etichetta: "Supplemento condimenti (euro)",
    aiuto: "I condimenti non hanno un prezzo ciascuno: si spuntano e basta. Chi ne prende uno o quattro paga lo stesso supplemento, una volta per piatto. A zero i condimenti sono gratis."
  },
  {
    chiave: "cucina_apertura_ora", gruppo: "Comande", tipo: "numero", predefinito: 16, min: 0, max: 23,
    etichetta: "Ora di apertura della cucina",
    aiuto: "Prima di quest'ora gli ordini si prendono lo stesso: nessuno si sente dire di no. Si avvisa soltanto che la consegna non puo' essere immediata."
  },
  {
    chiave: "cucina_riscaldamento_minuti", gruppo: "Comande", tipo: "numero", predefinito: 15, min: 0, max: 120,
    etichetta: "Minuti di riscaldamento (piastra e friggitrice)",
    aiuto: "Il tempo che serve alla piastra e alla friggitrice per andare in temperatura. Da qui esce l'ora del primo ritiro possibile: apertura + questi minuti."
  },
  {
    chiave: "garden_tavoli", gruppo: "Garden", tipo: "numero", predefinito: 12, min: 2, max: 60,
    etichetta: "Quanti tavoli ha il Garden",
    aiuto: "Il numero di tavoli della pianta di partenza. Cambiarlo non tocca la sala gia' disegnata: serve il tasto \u201cRipristina predefinita\u201d nella pianta, che ridisegna tutto da capo. Aggiungere tavoli e' sempre possibile; toglierne di gia' prenotati no, e il sistema lo dice."
  },
  {
    chiave: "garden_larghezza_m", gruppo: "Garden", tipo: "numero", predefinito: 18, min: 3, max: 120,
    etichetta: "Larghezza della sala (metri)",
    aiuto: "La misura vera dello spazio, presa col metro. Serve a sapere se i tavoli che hai disegnato ci stanno davvero: sulla pianta in percentuale un tavolo in piu' entra sempre, nella realta' no."
  },
  {
    chiave: "garden_profondita_m", gruppo: "Garden", tipo: "numero", predefinito: 12, min: 3, max: 120,
    etichetta: "Profondita' della sala (metri)",
    aiuto: "L'altra misura dello spazio. Larghezza per profondita' danno i metri quadri su cui si fa il conto."
  },
  {
    chiave: "garden_ingombro_tavolo_m", gruppo: "Garden", tipo: "numero", predefinito: 2, min: 1, max: 4,
    etichetta: "Ingombro di un tavolo con le sedie (metri)",
    aiuto: "Non la misura del piano, ma il quadrato che occupa il tavolo CON le persone sedute: un quadrato da 80 cm con quattro sedie occupa circa due metri per due."
  },
  {
    chiave: "garden_corridoio_m", gruppo: "Garden", tipo: "numero", predefinito: 0.9, min: 0.4, max: 3,
    etichetta: "Passaggio fra i tavoli (metri)",
    aiuto: "Lo spazio che serve a un cameriere con un vassoio per passare fra due tavoli occupati. Sotto i 90 cm non ci si passa con le mani piene."
  },
  {
    chiave: "garden_posti_per_tavolo", gruppo: "Garden", tipo: "numero", predefinito: 4, min: 2, max: 10,
    etichetta: "Posti per tavolo",
    aiuto: "Quante persone siede un tavolo singolo. Quattro e' lo standard: due quadrati accostati fanno una tavolata da sei comodi."
  },
  {
    chiave: "tavoli_posti_persi_unione", gruppo: "Garden", tipo: "numero", predefinito: 2, min: 0, max: 6,
    etichetta: "Posti persi accostando due tavoli",
    aiuto: "Due tavoli da quattro accostati non fanno otto posti comodi: gli angoli si perdono e si mangia col gomito del vicino. Qui si dice quanti posti togliere a ogni accostamento — a due, una tavolata di due tavoli tiene sei persone."
  },
  {
    chiave: "sala_soglia_buona", gruppo: "Garden", tipo: "numero", predefinito: 33, min: 5, max: 95,
    etichetta: "Serata \u201cbuona\u201d oltre il (%) di prenotato",
    aiuto: "Sotto questa percentuale la serata e' Facile: c'e' spazio, si puo' essere generosi accostando i tavoli."
  },
  {
    chiave: "sala_soglia_difficile", gruppo: "Garden", tipo: "numero", predefinito: 66, min: 10, max: 100,
    etichetta: "Serata \u201cdifficile\u201d oltre il (%) di prenotato",
    aiuto: "Oltre questa percentuale i posti scarseggiano: per una tavolata numerosa si accostano meno tavoli possibile, per non bruciare la sala."
  },
  // ---- Sport ----
  {
    chiave: "sport_foglio_gara", gruppo: "Sport", tipo: "bool", predefinito: true,
    etichetta: "Foglio gara stampabile dal Crew",
    aiuto: "Mostra il bottone di stampa nel modulo Sport. Spegnilo se i risultati si prendono solo dal telefono."
  },
  // ---- Eventi ----
  {
    chiave: "eventi_onerosi", gruppo: "Eventi", tipo: "bool", predefinito: true,
    etichetta: "Eventi a pagamento",
    aiuto: "Se spento, tutti gli eventi sono liberi e nella scheda evento non compare nessun costo."
  },
  {
    chiave: "eventi_modo_costo", gruppo: "Eventi", tipo: "scelta", predefinito: "entrambi",
    dipende_da: "eventi_onerosi",
    opzioni: [
      { valore: "prezzo", etichetta: "Solo prezzo d'ingresso" },
      { valore: "consumazione", etichetta: "Solo consumazione obbligatoria" },
      { valore: "entrambi", etichetta: "Si sceglie evento per evento" }
    ],
    etichetta: "Come si paga l'ingresso",
    aiuto: "La consumazione obbligatoria sostituisce il biglietto: si entra consumando."
  },
  // ---- Fitness ----
  {
    chiave: "fitness_minimo", gruppo: "Fitness", tipo: "bool", predefinito: true,
    etichetta: "Minimo di iscritti per aprire la lezione",
    aiuto: "Se acceso, sotto il minimo indicato sulla scheda del corso la lezione resta \"in attesa\" e non parte. Se spento, ogni lezione si tiene comunque. Su una stagione simulata con 400 persone la media e' risultata di ~6-7 iscritti per lezione: un minimo di 10 ne farebbe saltare la maggior parte."
  },
  {
    chiave: "fitness_prenotazione_obbligatoria", gruppo: "Fitness", tipo: "bool", predefinito: true,
    etichetta: "Prenotazione obbligatoria",
    aiuto: "Le attivit\u00e0 con istruttore hanno posti contati: senza prenotazione non si entra."
  },
  {
    chiave: "fitness_disdetta_minuti", gruppo: "Fitness", tipo: "numero", predefinito: 30, min: 0, max: 1440,
    etichetta: "Disdetta libera fino a (minuti prima)",
    aiuto: "Entro questo margine la lezione si disdice senza pagare. Dopo, resta dovuta: l'istruttore \u00e8 gi\u00e0 arrivato e il posto non si rivende piu' a nessuno. A zero, si disdice sempre gratis."
  },
  {
    chiave: "fitness_griglia_da", gruppo: "Fitness", tipo: "ora", predefinito: "16:00",
    etichetta: "Calendario lezioni · prima ora",
    aiuto: "La griglia settimanale parte sempre da questa ora, anche se non ci sono lezioni: cosi' ha una forma stabile e le lezioni si collocano invece di comparire dove capita. Se una lezione e' piu' presto, la griglia si allarga da sola."
  },
  {
    chiave: "fitness_griglia_a", gruppo: "Fitness", tipo: "ora", predefinito: "20:00",
    etichetta: "Calendario lezioni · ultima ora",
    aiuto: "L'ultima ora mostrata. Come sopra: se una lezione e' piu' tardi, la griglia si allarga."
  },
  // ---- Accessibilita' e assistenza ----
  {
    chiave: "semplice_eta", gruppo: "Accessibilit\u00e0", tipo: "numero", predefinito: 70, min: 55, max: 95,
    etichetta: "Da che eta' l'app parte in modo semplice",
    aiuto: "Chi ha almeno questa eta' trova la versione essenziale gia' attiva: poche voci grandi e la prenotazione in un tocco. Resta comunque possibile passare alla versione completa, e viceversa."
  },
  {
    chiave: "ragazzi_eta", gruppo: "Accessibilit\u00e0", tipo: "numero", predefinito: 14, min: 8, max: 17,
    etichetta: "Fino a che eta' l'app parte in modo ragazzi",
    aiuto: "Chi ha fino a questa eta' trova una versione centrata su sport, casata e programma. A 14 anni si e' gia' dentro le casate, e il telefono ce l'hanno anche prima."
  },
  {
    chiave: "ragazzi_prenotano_campi", gruppo: "Accessibilit\u00e0", tipo: "bool", predefinito: false,
    etichetta: "I ragazzi prenotano i campi",
    aiuto: "Di norma no: il campo lo prenota un adulto e il ragazzo gioca, unendosi alla partita. Unirsi resta sempre possibile — e' giocare, non impegnare uno spazio."
  },
  {
    chiave: "aiuto_numero", gruppo: "Accessibilit\u00e0", tipo: "telefono", predefinito: "",
    etichetta: "Numero del chiosco (per locandine e bacheche)",
    aiuto: "Il numero che squilla al chiosco. NON compare piu\u2019 fra i numeri rapidi dell'app \u2014 li\u2019 restano il 112 e il contatto familiare del socio, che sono gli unici due che rispondono in un'emergenza. Serve per le locandine in bacheca e per chi chiede informazioni: spiegazioni, orari, ragguagli. Ordini e prenotazioni no: quelle si chiudono a sistema, ed \u00e8 l'unico modo per avere un tavolo o un posto a un evento."
  },
  {
    chiave: "carta_prenotazione", gruppo: "Casa di Carta", tipo: "bool", predefinito: true,
    etichetta: "Prenotazione del tavolo da gioco",
    aiuto: "I tavoli della Casa di Carta si prenotano a turni, come quelli del Garden: serve a evitare che gli stessi restino seduti tutto il giorno."
  },
  {
    chiave: "carta_numero_legale", gruppo: "Casa di Carta", tipo: "bool", predefinito: true,
    dipende_da: "carta_prenotazione",
    etichetta: "Numero legale al tavolo",
    aiuto: "Se poco prima del turno i giocatori dichiarati sono meno del minimo, il tavolo torna libero."
  },
  {
    chiave: "carta_min_giocatori", gruppo: "Casa di Carta", tipo: "numero", predefinito: 2, min: 1, max: 8,
    dipende_da: "carta_numero_legale",
    etichetta: "Giocatori minimi per tavolo",
    aiuto: "Due basta per quasi tutti i giochi da tavolo."
  },
  {
    chiave: "carta_numero_legale_minuti", gruppo: "Casa di Carta", tipo: "numero", predefinito: 20, min: 5, max: 120,
    dipende_da: "carta_numero_legale",
    etichetta: "Quanti minuti prima si verifica",
    aiuto: "Quanto tempo prima del turno si controlla se il tavolo e' davvero occupato."
  },
  {
    chiave: "carta_max_turni_giorno", gruppo: "Casa di Carta", tipo: "numero", predefinito: 2, min: 1, max: 6,
    dipende_da: "carta_prenotazione",
    etichetta: "Turni al giorno per socio",
    aiuto: "Cosi' i tavoli girano e non restano occupati dagli stessi dalla mattina alla sera."
  },
  // ---- Cinema ----
    {
    chiave: "stage_larghezza_m", gruppo: "Stage", tipo: "numero", predefinito: 10, min: 3, max: 80,
    etichetta: "Larghezza della platea (metri)",
    aiuto: "La misura vera dello spazio davanti al palco. La platea non e' il Garden: le sedute stanno in fila, senza tavolo, e occupano molto meno."
  },
  {
    chiave: "stage_profondita_m", gruppo: "Stage", tipo: "numero", predefinito: 8, min: 3, max: 80,
    etichetta: "Profondita' della platea (metri)",
    aiuto: "Dal palco all'ultima fila. Piu' e' profonda, piu' file ci stanno."
  },
  {
    chiave: "stage_ingombro_seduta_m", gruppo: "Stage", tipo: "numero", predefinito: 0.55, min: 0.4, max: 1.2,
    etichetta: "Larghezza di una seduta (metri)",
    aiuto: "Una sedia da esterno occupa circa 55 cm. E' un'altra cosa rispetto a un tavolo con quattro persone intorno."
  },
  {
    chiave: "stage_passo_fila_m", gruppo: "Stage", tipo: "numero", predefinito: 0.9, min: 0.6, max: 2,
    etichetta: "Distanza fra le file (metri)",
    aiuto: "Da schienale a schienale: sotto i 90 cm non si passa davanti a chi e' gia' seduto."
  },
{
    chiave: "stage_posti_standard", gruppo: "Cinema", tipo: "numero", predefinito: 48, min: 4, max: 200,
    etichetta: "Posti in platea per chi cena",
    aiuto: "Si dimensiona sul PRIMO turno del Garden: il secondo turno cena mentre lo spettacolo e' in corso, quindi non pu\u00f2 occupare anche la platea. Cambiandolo qui, la disposizione si ridisegna con \u201cRipristina predefinita\u201d."
  },
  {
    chiave: "stage_prima_fila_over70", gruppo: "Cinema", tipo: "numero", predefinito: 10, min: 0, max: 40,
    etichetta: "Prima fila riservata agli over 70",
    aiuto: "Quante sedute in prima fila spettano agli over 70, fino a esaurimento. A zero la riserva non esiste."
  },
  {
    chiave: "stage_blocco_garden", gruppo: "Cinema", tipo: "numero", predefinito: 4, min: 1, max: 12,
    etichetta: "Alternanza · posti per chi cena",
    aiuto: "Ogni quanti posti riservati a chi cena si inseriscono quelli per il solo spettacolo."
  },
  {
    chiave: "stage_blocco_spettacolo", gruppo: "Cinema", tipo: "numero", predefinito: 2, min: 0, max: 12,
    etichetta: "Alternanza · posti per il solo spettacolo",
    aiuto: "Con 4 e 2, ogni quattro posti di chi cena ce ne sono due per chi viene solo a vedere: cos\u00ec non finiscono sempre in fondo."
  },
  {
    chiave: "stage_posti_extra_n", gruppo: "Cinema", tipo: "numero", predefinito: 12, min: 0, max: 100,
    etichetta: "Posti extra in platea",
    aiuto: "Le sedute in fondo, che si aprono solo a standard esauriti."
  },
  {
    chiave: "stage_contributo", gruppo: "Cinema", tipo: "numero", predefinito: 2, min: 0, max: 20,
    etichetta: "Contributo per il solo spettacolo (€)",
    aiuto: "Chi cena al Garden ha gia' il suo posto davanti al palco. Chi viene solo per l'esibizione versa questo contributo all'ingresso. Zero = ingresso libero."
  },
  {
    chiave: "cinema_posti_extra", gruppo: "Cinema", tipo: "bool", predefinito: true,
    etichetta: "Posti extra in platea",
    aiuto: "Se acceso, quando i posti standard sono esauriti si aprono anche i posti extra della platea. Se spento, a standard finiti la proiezione risulta al completo."
  },
  {
    chiave: "cinema_prenotazione", gruppo: "Cinema", tipo: "bool", predefinito: true,
    etichetta: "Prenotazione del posto",
    aiuto: "Se spento, il cinema resta a ingresso libero: il cartellone si vede ma non si prenota."
  },
  // ---- Garden ----
  {
    chiave: "garden_prenotazione_cena", gruppo: "Garden", tipo: "bool", predefinito: true,
    etichetta: "Prenotazione della cena a turni",
    aiuto: "Se spento, il Garden non accetta prenotazioni: ci si siede e basta."
  }
];

const perChiave = new Map(REGISTRO.map((p) => [p.chiave, p]));

function normalizza(def, raw) {
  if (raw == null) return def.predefinito;
  if (def.tipo === "bool") return raw === "1" || raw === "true" || raw === true;
  if (def.tipo === "numero") {
    let n = Number(raw);
    if (!Number.isFinite(n)) return def.predefinito;
    if (def.min != null) n = Math.max(def.min, n);
    if (def.max != null) n = Math.min(def.max, n);
    return n;
  }
  // Testo libero: si accetta cosi' com'e', ripulito. Senza questo ramo qualunque valore
  // finiva nel controllo delle opzioni e tornava al predefinito — cioe' i parametri di testo
  // non si potevano cambiare, e non se ne accorgeva nessuno.
  // Testo libero e i suoi parenti: data, ora, data+ora, telefono. Sono tutti testo per il
  // database — cambia solo il campo che si vede nel back office — e vanno accettati qui,
  // altrimenti finiscono nel controllo delle opzioni (che non ne hanno) e tornano al
  // predefinito: il gestore scrive, salva, e ritrova il campo vuoto senza capire perche'.
  if (["testo", "data", "dataora", "ora", "telefono"].includes(def.tipo)) {
    const t = String(raw).trim().slice(0, 120);
    return t || def.predefinito;
  }
  const ok = (def.opzioni || []).some((o) => o.valore === raw);
  return ok ? raw : def.predefinito;
}

// Valore di un parametro. Se dipende da un interruttore spento, restituisce sempre il
// "neutro": cosi' chi legge non deve ricordarsi di controllare anche il genitore.
async function par(chiave) {
  const def = perChiave.get(chiave);
  if (!def) return null;
  if (def.dipende_da) {
    const acceso = await par(def.dipende_da);
    if (!acceso) return def.tipo === "bool" ? false : null;
  }
  return normalizza(def, await getSetting("par_" + chiave, null));
}

async function tuttiParametri() {
  const out = [];
  for (const def of REGISTRO) {
    const grezzo = await getSetting("par_" + def.chiave, null);
    out.push({
      ...def,
      valore: normalizza(def, grezzo),
      personalizzato: grezzo != null,
      // se il genitore e' spento la voce resta visibile ma disattivata, per capire perche'
      attivo: def.dipende_da ? !!await par(def.dipende_da) : true
    });
  }
  return out;
}

async function salvaParametri(patch) {
  const cambiati = [];
  for (const [chiave, valore] of Object.entries(patch || {})) {
    const def = perChiave.get(chiave);
    if (!def) continue;
    const v = def.tipo === "bool" ? (valore ? "1" : "0") : String(normalizza(def, valore));
    await setSetting("par_" + chiave, v);
    cambiati.push(chiave);
  }
  return cambiati;
}

export { REGISTRO, par, salvaParametri, tuttiParametri };

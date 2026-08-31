/* Bussola Residence — front-end utente.
   Legge i dati dalle API del server; se il server non è raggiungibile
   (es. file aperto da solo per anteprima) usa i dati incorporati SEED. */
'use strict';

// Prezzi in euro, con lo stesso formato ovunque. Mancava, e in due punti l'app la chiamava
// lo stesso: il totale dell'ordine e la conferma. L'eccezione veniva ingoiata dal browser, e
// l'effetto visibile era che il totale restava vuoto e "Invia ordine" non si accendeva.
// Da qualunque supporto arrivi, la tessera e' sempre lo stesso numero: qui si estrae, che sia
// stato digitato a mano, letto da un QR o aperto da un tag NFC (che porta un indirizzo, non un
// numero). Senza questo, ogni supporto avrebbe bisogno del suo pezzo di codice.
function leggiTessera(testo) {
  const t = String(testo || "").trim().toUpperCase();
  const m = t.match(/BR-\d{4}-\d{3,6}/);
  return m ? m[0] : "";
}

const eur = (n) => '\u20ac ' + (Number(n) || 0).toFixed(2);

// ---- Stato & preferenze (persistite quando possibile) ---------------------
const store = {
  // Le preferenze salvate sul telefono passano da "koine_" a "bussola_". Si legge la nuova e,
  // se non c'e', si prende la vecchia e la si travasa: rinominare a secco avrebbe fatto perdere
  // tessera, lingua e modo semplice a tutti quelli che hanno gia' l'app installata.
  get(k, d) {
    try {
      let v = localStorage.getItem('bussola_' + k);
      if (v === null) {
        v = localStorage.getItem('koine_' + k);
        if (v !== null) localStorage.setItem('bussola_' + k, v);
      }
      return v === null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('bussola_' + k, JSON.stringify(v)); } catch {} },

};
const state = {
  tessera: store.get('tessera', null),          // nessuna identità finta al primo avvio
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
  socio: { tessera_code: 'RB-000001-4', nome: 'Ercole', cognome: '—', ruolo: 'Socio', tipo_profilo: 'socio', casata: 'Aretusa', colore: '#2E6DA4', valida_fino: '2027-05-01', notifiche_push: true },
  luoghi: [ { chiave:'chiosco', nome:'Chiosco La Bussola', lat:36.967766, lng:15.221669 }, { chiave:'isola', nome:'Isola ecologica', lat:36.967209, lng:15.221206 } ],
  contest: { titolo:'Il mio nome è Bond, James Bond', tipo:'cocktail', settimana:'25–31 agosto', brief:'Dati 3 liquori, un\'acqua tonica e un selz, crea il cocktail della tua casata. I primi 3 in vendita nel weekend; a fine settimana la graduatoria della giuria + il bonus vendite (4/2/1 pezzi venduti) assegna i punti Coppa.', stato:'annunciato', vincitore:null },
  serate: [
    { id:1, chiave:'apertura', titolo:'Apertura di stagione', quando:'Sab 30 maggio · unico turno 20:00', tema:'Presentazione e sfilata dei Clan', descrizione:'Cena unica alle 20:00, poi presentazione e sfilata delle otto casate. 10 punti al clan migliore, votato dagli altri.', quota:25, capienza:120, posti_liberi:120 },
    { id:2, chiave:'tema_luglio', titolo:'Serata a tema · fine luglio', quando:'Sab 25 luglio · 20:00', tema:'Tema da annunciare', descrizione:'La serata a tema di fine luglio: il tema lo svela il CdA. Cena a numero chiuso.', quota:30, capienza:100, posti_liberi:100 },
    { id:3, chiave:'ferragosto', titolo:'Cena di Ferragosto', quando:'Sab 15 agosto · 20:00', tema:'Gran serata', descrizione:'La serata clou dell’estate: cena speciale con musica dal vivo. Posti limitati.', quota:40, capienza:140, posti_liberi:140 },
    { id:4, chiave:'fine_stagione', titolo:'Chiusura di stagione', quando:'Sab 12 settembre · 20:00', tema:'Premiazione Coppa', descrizione:'Cena, premiazione della Coppa delle Casate e Albo d’Oro.', quota:30, capienza:120, posti_liberi:120 },
  ],
  casate: [
    { nome: 'Ortigia', colore: '#B7791F', punti: 66 }, { nome: 'Aretusa', colore: '#2E6DA4', punti: 62 },
    { nome: 'Neapolis', colore: '#C0553F', punti: 54 }, { nome: 'Dionisio', colore: '#6E5AA6', punti: 50 },
    { nome: 'Ciane', colore: '#4d7a4a', punti: 47 }, { nome: 'Plemmirio', colore: '#12324F', punti: 44 },
    { nome: 'Epipoli', colore: '#7A8790', punti: 40 }, { nome: 'Anapo', colore: '#2E7D77', punti: 37 },
  ],
  eventi: [
    { chiave:'lun', giorno:'Lunedì', titolo:'Giornata libera', ambiente:'', colore:'#7A8790', sottotitolo:'Arrivi, partenze e riposo', descrizione:"Nessuna attività in cartellone: il lunedì coincide con il cambio degli ospiti (arrivi e partenze). È il giorno di riposo del residence.", cta:null, azione:null },
    { chiave:'mar', giorno:'Martedì', titolo:'Vinile & Vino', ambiente:'Bussola Garden', colore:'#C0553F', sottotitolo:'Scegli tu la musica della serata', descrizione:'Proponi un vinile, i brani e il perché. Le proposte della settimana diventano la scaletta di quella dopo.', cta:'Proponi un vinile', azione:'sheet-vinile' },
    { chiave:'mer', giorno:'Mercoledì', titolo:"Cinema d'autore sotto le stelle", ambiente:'Bussola Stage', colore:'#12324F', sottotitolo:"Ortigia Film Festival & titoli d'autore", descrizione:"Una proiezione a settimana: opere premiate all'Ortigia Film Festival, alternate a titoli più leggeri ma d'autore.", cta:'Prenota un posto', azione:null },
    { chiave:'gio', giorno:'Giovedì', titolo:'Jazz & Cocktail', ambiente:'Bussola Garden', colore:'#2E7D77', sottotitolo:'La serata-firma · trio live', descrizione:'Trio live acustico, luci basse, cocktail. Si cena prima dello spettacolo.', cta:'Prenota un tavolo', azione:null },
    { chiave:'ven', giorno:'Venerdì', titolo:'Serata dei Clan', ambiente:'Bussola Stage', colore:'#6E5AA6', sottotitolo:'Le otto casate si sfidano', descrizione:'Dall’apericena a tarda sera. Questa settimana: karaoke. Coinvolgi un ospite e la tua casata guadagna punti.', cta:'Vai alla Coppa', azione:'go-coppa' },
    { chiave:'sab', giorno:'Sabato', titolo:'Live Session', ambiente:'Bussola Stage', colore:'#B7791F', sottotitolo:'Band e cantautori emergenti', descrizione:'Band e cantautori emergenti dal vivo sul Bussola Stage.', cta:'Prenota un posto', azione:null },
    { chiave:'dom', giorno:'Domenica', titolo:'Open Mic', ambiente:'Bussola Stage', colore:'#B7791F', sottotitolo:'Tre minuti di palco per te', descrizione:'Microfono aperto: canto, monologo, stand-up (linguaggio moderato) o strumento.', cta:'Salgo sul palco', azione:'sheet-openmic' },
  ],
  risorse: [
    { chiave:'pickleball', nome:'Campo di Pickleball', tipo:'sport', sottotitolo:'Turni da 90′ · gioco 17–20', slots:['17:00–18:30','18:30–20:00'], nota:'Si gioca dalle 17 alle 20, per rispettare il silenzio pomeridiano.' },
    { chiave:'soft', nome:'Campo di Soft tennis', tipo:'sport', sottotitolo:'Turni da 90′ · gioco 17–20', slots:['17:00–18:30','18:30–20:00'], nota:'Si gioca dalle 17 alle 20.' },
    { chiave:'cowo', nome:'Postazione Coworking', tipo:'coworking', sottotitolo:'Casa di Carta · wi-fi e caffè', slots:['Mattina (9–13)','Pomeriggio (14–18)','Giornata intera'], nota:null },
    { chiave:'tavolo', nome:'Tavolo per la cena', tipo:'tavolo', sottotitolo:'~40 coperti · turni 20:00 e 21:30', slots:['20:00','21:30'], nota:'Indica quante persone. All’apertura c’è un unico turno alle 20:00 (segue la sfilata).' },
  ],
  bussola: {
    servizi: [ {titolo:'Farmacia',dettaglio:'Fontane Bianche',distanza:'~600 m'},{titolo:'Guardia medica',dettaglio:'Cassibile',distanza:'~5 km'},{titolo:'Spiaggia',dettaglio:'Fontane Bianche',distanza:'~300 m'},{titolo:'Market & alimentari',dettaglio:'Viale dei Lidi',distanza:'~700 m'},{titolo:'Bar & tabacchi',dettaglio:'Fontane Bianche',distanza:'~500 m'} ],
    vedere: [ {titolo:'Ortigia',dettaglio:'Centro storico · cultura',distanza:'~20 km'},{titolo:'Parco della Neapolis',dettaglio:'Teatro Greco · Orecchio di Dioniso',distanza:'~22 km'},{titolo:'Duomo di Siracusa',dettaglio:'Barocco',distanza:'~20 km'},{titolo:'Riserva del Plemmirio',dettaglio:'Area marina protetta',distanza:'~12 km'},{titolo:'Cavagrande del Cassibile',dettaglio:'Laghetti e sentieri',distanza:'~18 km'} ],
    rifiuti: ['Lun · Organico','Mar · Plastica','Mer · Carta','Gio · Organico','Ven · Vetro','Sab · Indifferenziato'].map(t=>({titolo:t})),
    orari: [ {titolo:'Silenzio pomeridiano',dettaglio:'Dalle 14:00 alle 17:00 — riposo per tutti.'},{titolo:'Silenzio notturno',dettaglio:'Dopo le 23:30 — si abbassano voci e musica.'} ],
  },
  sport: seedDisc([
    ['Pickleball',[['Aretusa','#2E6DA4',3,3,9],['Ortigia','#B7791F',3,2,6],['Ciane','#4d7a4a',3,1,3],['Epipoli','#7A8790',3,0,0]],[['Neapolis','#C0553F',3,2,6],['Dionisio','#6E5AA6',3,2,6],['Plemmirio','#12324F',3,1,3],['Anapo','#2E7D77',3,1,3]],[['Aretusa','Ortigia','Dom 17:30','Campo 1'],['Neapolis','Dionisio','Dom 19:00','Campo 1']],[['Aretusa','Ciane','11–6'],['Ortigia','Epipoli','11–9']]],
    ['Soft tennis',[['Aretusa','#2E6DA4',2,2,6],['Ortigia','#B7791F',2,1,3],['Ciane','#4d7a4a',2,1,3],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,6],['Dionisio','#6E5AA6',2,1,3],['Plemmirio','#12324F',2,1,3],['Anapo','#2E7D77',2,0,0]],[['Aretusa','Plemmirio','Gio 18:00','Campo 1']],[['Neapolis','Anapo','6–2']]],
    ['Basket 3×3',[['Aretusa','#2E6DA4',2,2,4],['Ortigia','#B7791F',2,1,2],['Ciane','#4d7a4a',2,1,2],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,4],['Dionisio','#6E5AA6',2,1,2],['Plemmirio','#12324F',2,1,2],['Anapo','#2E7D77',2,0,0]],[['Aretusa','Ciane','Sab 18:00','Campo residence']],[['Ortigia','Epipoli','21–15']]],
    ['Calcetto a 5',[['Aretusa','#2E6DA4',2,2,6],['Ortigia','#B7791F',2,1,3],['Ciane','#4d7a4a',2,1,3],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,6],['Dionisio','#6E5AA6',2,1,3],['Plemmirio','#12324F',2,0,1],['Anapo','#2E7D77',2,0,1]],[['Aretusa','Epipoli','Ven 18:30','Campo residence']],[['Ortigia','Ciane','5–3']]],
  ]),
  giochi: seedDisc([
    ['Burraco',[['Aretusa','#2E6DA4',3,3,9],['Ortigia','#B7791F',3,2,6],['Ciane','#4d7a4a',3,1,3],['Epipoli','#7A8790',3,0,0]],[['Neapolis','#C0553F',3,2,6],['Dionisio','#6E5AA6',3,2,6],['Plemmirio','#12324F',3,1,3],['Anapo','#2E7D77',3,1,3]],[['Aretusa','Neapolis','Mar 21:00','Casa di Carta']],[['Ciane','Epipoli','2–0']]],
    ['Scala 40',[['Aretusa','#2E6DA4',2,2,6],['Ortigia','#B7791F',2,1,3],['Ciane','#4d7a4a',2,1,3],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,6],['Dionisio','#6E5AA6',2,1,3],['Plemmirio','#12324F',2,0,1],['Anapo','#2E7D77',2,0,1]],[['Aretusa','Epipoli','Gio 21:30','Casa di Carta']],[['Ortigia','Ciane','1–0']]],
    ['Briscola/Scopa',[['Aretusa','#2E6DA4',2,2,4],['Ortigia','#B7791F',2,1,2],['Ciane','#4d7a4a',2,1,2],['Epipoli','#7A8790',2,0,0]],[['Neapolis','#C0553F',2,2,4],['Dionisio','#6E5AA6',2,1,2],['Plemmirio','#12324F',2,1,2],['Anapo','#2E7D77',2,0,0]],[['Aretusa','Ciane','Ven 21:00','Casa di Carta']],[['Ortigia','Epipoli','2–1']]],
    ['Scacchi/Dama',[['Aretusa','#2E6DA4',3,3,6],['Ortigia','#B7791F',3,2,4],['Ciane','#4d7a4a',3,1,2],['Epipoli','#7A8790',3,0,0]],[['Neapolis','#C0553F',3,2,4],['Dionisio','#6E5AA6',3,2,4],['Plemmirio','#12324F',3,1,2],['Anapo','#2E7D77',3,1,2]],[['Aretusa','Ortigia','Lun 21:00','Casa di Carta']],[['Dionisio','Plemmirio','1–0']]],
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
// L'indirizzo del server si puo' impostare da fuori: si accetta il nome nuovo e si continua
// ad accettare quello vecchio, perche' potrebbe essere gia' scritto in una pagina che non
// controlliamo. Rinominare a secco avrebbe rotto quelle installazioni senza avvisare nessuno.
const API_BASE = (typeof window !== 'undefined' && (window.BUSSOLA_API || window.KOINE_API)) ? String(window.BUSSOLA_API || window.KOINE_API).replace(/\/$/, '') : '';
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}), ...(opts.headers || {}) };
  const r = await fetch(API_BASE + '/api' + path, { ...opts, headers });
  if (!r.ok) {
    // Mostra il MESSAGGIO del server (non il codice grezzo). Conserva lo stato in err.status.
    let msg = String(r.status);
    try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
    // 401 con token presente = sessione scaduta/non più valida: ripulisci e riporta al login,
    // così invece di un generico "Errore" l'utente vede la schermata di accesso.
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
  // Se il socio ha già dato il consenso, riallinea la subscription push (nuovo dispositivo / dopo un deploy).
  if (state.token && state.socio && state.socio.notifiche_push) { subscribePush().catch(() => {}); }
}

// ---- Utility --------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ---- Navigazione ----------------------------------------------------------
// Residente (ex "utente non socio"): niente tornei né Coppa, solo eventi/guida/prenotazioni.
// "Non competitore": chi NON è socio (né socio-residente) non vede tornei/Coppa/casata.
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
// La fascia "Testo / contrasto" resta utile ai soci anziani, ma non deve occupare una riga
// fissa in cima: si apre dall'icona A± ed e' ricordata per la volta dopo.
function initModoToggle() {
  const b = document.getElementById('modoBtn');
  if (!b) return;
  const aggiorna = () => {
    if (modoRagazzi()) { b.hidden = true; return; }
    b.hidden = false;
    const semplice = modoSemplice() || modoRagazzi();
    b.textContent = semplice ? '🪟 ' + T('Versione completa') : '🪟 ' + T('Versione semplice');
  };
  aggiorna();
  b.onclick = () => { cambiaModo(!(modoSemplice() || modoRagazzi())); aggiorna(); };
}
function initA11yToggle() {
  const btn = document.getElementById('a11yBtn'), bar = document.getElementById('a11yBar');
  if (!btn || !bar) return;
  const apri = (v) => { bar.hidden = !v; btn.setAttribute('aria-expanded', v ? 'true' : 'false'); try { localStorage.setItem('bussola_a11yopen', v ? '1' : '0'); } catch (e) { } };
  let aperto = false;
  try { aperto = (localStorage.getItem('bussola_a11yopen') ?? localStorage.getItem('koine_a11yopen')) === '1'; } catch (e) { }
  apri(aperto);
  btn.onclick = () => apri(bar.hidden);
}
function renderHeader() {
  const s = state.socio;
  $('#greetName').textContent = tr('ciao') + ', ' + (s.nome || '');
  $('#greetSub').textContent = s.casata ? (T('Casata') + ' ' + s.casata) : T('Benvenuto alla Bussola');
  $('#casataNm').textContent = s.casata || '—';
  $('#casataSh').style.background = s.colore || '#2E6DA4';
}
function evCardHTML(e, withAction) {
  const action = withAction && e.azione
    ? `<button class="btn gold sm" data-ev="${e.chiave}" data-act="${e.azione}">${e.azione==='sheet-vinile'?T('Proponi'):(e.azione==='sheet-openmic'?T('Salgo'):(e.azione==='go-coppa'?T('Coppa'):T('Info')))}</button>`
    : `<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
  const dlBits = [esc(e.giorno)];
  if (e.ora_inizio) dlBits.push(esc(e.ora_inizio));
  if (e.ambiente) dlBits.push(esc(e.ambiente));
  const dl = dlBits.join(' · ');
  const meta = [];
  if (e.tipologia) meta.push(`<span class="ev-ty" style="background:${e.colore||'var(--navy)'}">${esc(e.tipologia)}</span>`);
  if (e.artista) meta.push(`<span class="ev-ar">🎤 ${esc(e.artista)}</span>`);
  // L'ingresso puo' costare un biglietto oppure una consumazione obbligatoria.
  const costo = Number(e.costo || 0);
  if (e.costo_tipo === 'consumazione') meta.push(`<span class="ev-co">🥂 ${esc(e.consumazione || T('consumazione obbligatoria'))}</span>`);
  else if (costo > 0) meta.push(`<span class="ev-co">🎟️ € ${costo.toFixed(2)}</span>`);
  // Serata cinema: al posto del sottotitolo fisso, il film in programma.
  const sotto = e.film ? `🎬 <b>${esc(e.film.titolo)}</b>${e.film.regia ? ' · ' + esc(e.film.regia) : ''}${e.film.durata_min ? " · " + e.film.durata_min + "'" : ''}` : esc(e.sottotitolo);
  const metaHTML = meta.length ? `<div class="ev-meta">${meta.join('')}</div>` : '';
  if (!withAction) {
    // Riga della Settimana: giorno a sinistra, titolo su una riga e sottotitolo sotto. Su una
    // riga sola i due si contendevano lo spazio e finivano tagliati tutti e due; a due righe si
    // leggono per intero e i sette giorni stanno comunque in una schermata. Il resto (luogo,
    // costo, artista) si vede toccando.
    const g = String(e.giorno || '').slice(0, 3);
    const sottoRiga = e.film ? `🎬 ${esc(e.film.titolo)}` : esc(e.sottotitolo || '');
    return `<div class="evrow" role="button" tabindex="0" data-open="${e.chiave}">
      <span class="stripe" style="background:${e.colore}"></span>
      <span class="gg">${esc(g)}</span>
      <span class="tx"><b>${esc(e.titolo)}</b><span class="sub">${sottoRiga}</span></span>
      ${e.ora_inizio ? `<span class="ora">${esc(e.ora_inizio)}</span>` : ''}
      ${action}</div>`;
  }
  return `<div class="evcard" role="button" tabindex="0" data-open="${e.chiave}"><span class="stripe" style="background:${e.colore}"></span><div class="body"><div class="dl">${dl}</div><h4>${esc(e.titolo)}</h4><p>${sotto}</p>${metaHTML}</div><div class="cta">${action}</div></div>`;
}
// Tessera compatta: icona a sinistra, titolo e descrizione a destra. Occupa un terzo
// dell'altezza della versione quadrata a parita' di leggibilita' e di area di tocco.
function ptile(attr, icona, titolo, sotto) {
  const a = attr.includes('=') ? 'data-' + attr : `data-${attr}=""`;
  // Un BOTTONE, non un div con role: la tastiera e i lettori di schermo lo trattano per quello
  // che e' senza doverglielo spiegare. L'icona resta, ma piccola e a lato del titolo: nella
  // griglia a due colonne il testo deve avere la larghezza, non l'emoji.
  return `<button class="ptile" ${a}><b>${icona} ${titolo}</b><span>${sotto}</span></button>`;
}
// ---- Modo semplice ------------------------------------------------------------------------
// Non e' una seconda app: e' la stessa, con meno decisioni. Si accende da sola per chi ha
// l'eta' indicata nei parametri (la data di nascita e' gia' in anagrafica) e si spegne con un
// tocco — chi la trova attiva per sbaglio non deve restare chiuso fuori da meta' applicazione.
// Le soglie arrivano dal server insieme alle regole dei campi: si spostano dai parametri,
// non stanno scritte qui.
function regoleApp() { return ((state.data?.campi || [])[0] || {}).regole || {}; }
// La scelta della versione e' della persona, non del telefono: nonno e nipote possono usare
// lo stesso apparecchio senza rubarsi la modalita' a vicenda.
// La chiave del modo semplice cambia nome: si legge anche la vecchia, perche' chi l'aveva
// scelto non deve ritrovarsi l'app completa senza aver toccato niente.
function chiaveModo() { return 'bussola_semplice_' + (state.tessera || 'anon'); }
function chiaveModoVecchia() { return 'koine_semplice_' + (state.tessera || 'anon'); }
// Niente ripiego sulla vecchia chiave comune: un "passa alla versione completa" premuto una
// volta da chiunque restava valido per tutti quelli che usavano quel telefono, e teneva
// spenta la modalita' anche a chi non l'aveva mai toccata. La si cancella una volta per tutte.
function sceltaModo() {
  // La vecchia chiave comune si butta e basta: era di "chiunque avesse quel telefono", quindi
  // non e' attribuibile a nessuno. Riportarla sulla tessera avrebbe conservato il blocco.
  if (localStorage.getItem('koine_semplice') !== null) localStorage.removeItem('koine_semplice');
  // La scelta per-tessera cambia nome ma non si perde: se c'e' solo la vecchia, si travasa.
  let v = localStorage.getItem(chiaveModo());
  if (v === null) {
    v = localStorage.getItem(chiaveModoVecchia());
    if (v !== null) localStorage.setItem(chiaveModo(), v);
  }
  return v;
}
function modoSemplice() {
  const scelto = sceltaModo();
  if (scelto === '1') return true;
  if (scelto === '0') return false;
  const eta = Number(state.socio?.eta || 0);
  return eta > 0 && eta >= Number(regoleApp().semplice_eta || 70);
}
// Modo ragazzi: la stessa app, centrata su cio' per cui la useranno davvero — lo sport e la
// casata. Le limitazioni riguardano solo la spesa, e sono applicate dal server: nascondere un
// tasto non e' un divieto.
// Per i minorenni la versione NON si sceglie: dipende dall'eta'. Un ragazzino che passa
// all'app intera si ritroverebbe davanti prenotazioni a pagamento e serate con quota — cioe'
// impegni presi con i soldi di qualcun altro. Per gli anziani, invece, la scelta resta:
// li' il rischio e' l'opposto, restare bloccati in una versione che non si sa cambiare.
// Minorenne per la legge, non per l'interfaccia: la soglia dei parametri decide solo quale
// versione dell'app mostrare, questa decide chi puo' impegnarsi a pagare. Un sedicenne usa
// l'app completa ma non prenota una serata da 30 euro.
function minorenne() {
  const eta = Number(state.socio?.eta || 0);
  return eta > 0 && eta < Number(regoleApp().maggiore_eta || 18);
}
function modoRagazzi() {
  const eta = Number(state.socio?.eta || 0);
  return eta > 0 && eta <= Number(regoleApp().ragazzi_eta || 14);
}
function cambiaModo(v) {
  localStorage.setItem(chiaveModo(), v ? '1' : '0');
  closeOv();
  renderHeader(); renderHome(); renderEventi(); renderCoppa(); renderBussola();
  renderDom('sport'); renderDom('giochi');
  applyProfileGating(); adattaBarra();
  const b = document.getElementById('modoBtn');
  if (b) { b.hidden = modoRagazzi(); b.textContent = (modoSemplice() || modoRagazzi()) ? '🪟 ' + T('Versione completa') : '🪟 ' + T('Versione semplice'); }
  go('home');
}

// In modo semplice e ragazzi la barra in basso porta le stesse voci della home: usando l'app
// si finisce in una schermata qualsiasi e le scorciatoie non devono sparire.
function adattaBarra() {
  const bar = document.querySelector('nav[aria-label="Navigazione principale"]');
  if (!bar) return;
  if (!bar.dataset.originale) bar.dataset.originale = bar.innerHTML;
  const semplice = modoSemplice(), ragazzi = modoRagazzi();
  if (!semplice && !ragazzi) { if (bar.innerHTML !== bar.dataset.originale) { bar.innerHTML = bar.dataset.originale; ricollegaBarra(); } return; }
  const voci = ragazzi
    ? [['home', '🏠', T('Home')], ['partite', '🤾', T('Giocare')], ['coppa', '🏆', T('Coppa')], ['eventi', '📅', T('Settimana')], ['bussola', '🧭', T('Guida')]]
    : [['home', '🏠', T('Home')], ['cena', '🍽️', T('Cena')], ['bussola', '🧭', T('Info')], ['aiuto', '📞', T('Chiama')]];
  bar.innerHTML = voci.map(([k, ic, et]) => `<button class="tab${k === 'home' ? ' on' : ''}" data-t="${k}" data-semplice="1"><span style="font-size:1.35rem;line-height:1">${ic}</span>${esc(et)}</button>`).join('');
  ricollegaBarra();
}
function ricollegaBarra() {
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    const k = b.dataset.t;
    if (k === 'cena') return openCenaSubito();
    if (k === 'aiuto') return openAiuto();
    if (k === 'partite') return openPartiteAperte();
    go(k);
  });
}

function eventoDiOggi() {
  const gg = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][new Date().getDay()];
  return (state.data.eventi || []).find(e => String(e.giorno || '').toLowerCase().startsWith(gg)) || null;
}
function renderHomeSemplice() {
  const hero = eventoDiOggi();
  const conv = (state.convocazioni || []).filter(c => !c.risposta);
  const bigTile = (attr, ico, titolo, sotto) => `<button class="bigtile" ${attr}>
      <span class="bt-ico">${ico}</span><span class="bt-txt"><b>${esc(titolo)}</b><span>${esc(sotto)}</span></span>
      <span class="bt-go">›</span></button>`;
  $('#s-home').innerHTML = `
    <div class="card oggi">
      <div class="eyebrow">${T('Oggi al residence')}</div>
      <h2 class="serif">${esc(hero ? hero.titolo : T('Giornata libera'))}</h2>
      ${hero && hero.sottotitolo ? `<p>${esc(hero.sottotitolo)}</p>` : ''}
    </div>
    ${bigTile('data-cena-subito="1"', '🍽️', T('Prenota la cena'), T('per stasera, tavolo da 4'))}
    ${conv.length ? bigTile('data-vai="coppa"', '🎾', T('Ti hanno convocato'), `${conv.length} ${conv.length === 1 ? T('partita da confermare') : T('partite da confermare')}`) : ''}
    ${bigTile('data-vai="bussola"', '🧭', T('Informazioni utili'), T('orari, rifiuti, numeri'))}
    <button class="bigtile aiuto" data-aiuto="1"><span class="bt-ico">📞</span><span class="bt-txt"><b>${T('Numeri rapidi')}</b><span>${T('112 e il tuo contatto di emergenza')}</span></span></button>
    <button class="btn ghost block" style="margin-top:14px" data-modo="0">${T('Passa alla versione completa')}</button>`;
}

function renderHomeRagazzi() {
  const hero = eventoDiOggi();
  const casata = state.socio?.casata;
  const r = regoleApp();
  const mia = (state.data.casate || []).find(c => c.nome === casata);
  const conv = (state.convocazioni || []).filter(c => !c.risposta);
  const bigTile = (attr, ico, titolo, sotto) => `<button class="bigtile" ${attr}>
      <span class="bt-ico">${ico}</span><span class="bt-txt"><b>${esc(titolo)}</b><span>${esc(sotto)}</span></span>
      <span class="bt-go">›</span></button>`;
  $('#s-home').innerHTML = `
    ${mia ? `<div class="card oggi" style="border-left:6px solid ${esc(mia.colore || '#2e6b45')}">
      <div class="eyebrow">${T('La tua casata')}</div>
      <h2 class="serif">${esc(mia.nome)}${mia.campione ? ' ✧' : ''}</h2>
      <p class="sub"><b>${mia.punti}</b> ${T('punti')} · ${T('posizione')} <b>${mia.posizione}</b>${mia.exAequo ? ' ' + T('a pari merito') : ''}</p></div>` : ''}
    ${conv.length ? bigTile('data-vai="coppa"', '🎾', T('Ti hanno convocato'), `${conv.length} ${conv.length === 1 ? T('partita da confermare') : T('partite da confermare')}`) : ''}
    ${bigTile('data-partite="1"', '🤾', T('Partite aperte'), T('unisciti a chi sta giocando'))}
    ${bigTile('data-vai="coppa"', '🏆', T('Come va la Coppa'), T('classifica e prossime partite'))}
    ${state.socio?.casata ? bigTile('data-chat="casata"', '💬', T('Chat della casata'), T('organizzatevi fra voi')) : ''}
    ${hero ? bigTile('data-vai="eventi"', '🎬', T('Stasera'), esc(hero.titolo)) : ''}
    ${bigTile('data-carta="1"', '🎲', T('Giochi da tavolo'), T('alla Casa di Carta'))}
    <div class="note" style="margin-top:12px">${r.ragazzi_prenotano_campi === false ? T('Il campo lo prenota un adulto: tu ti unisci alla partita e giochi.') : ''} ${T('Per il bar, la cena e le serate serve un adulto: fino ai 18 anni non si prenotano cose a pagamento da soli.')}</div>`;
}

function renderHome() {
  if (modoRagazzi()) return renderHomeRagazzi();
  if (modoSemplice()) return renderHomeSemplice();
  const evs = state.data.eventi;
  // Il "benvenuto" salta il lunedì vuoto: mostra la prima serata con attività.
  const first = evs.find(e => e.tipo !== 'libero' && e.chiave !== 'lun') || evs[0];
  const hero = evs.find(e => e.chiave === 'gio') || evs[3] || evs[0];
  $('#s-home').innerHTML = `
    <div class="hero" data-open="${hero.chiave}" role="button" tabindex="0"><div class="eyebrow">${T('Stasera')}</div><h2 class="serif">${esc(hero.titolo)}</h2>
      <div class="herorow"><p>${esc(hero.sottotitolo)}</p>${minorenne() || !String(hero.cta || '').trim() ? '' : `<button class="btn gold" data-gard-oggi="1">${esc(hero.cta)}</button>`}</div></div>
    ${hostCardsHTML()}
    <div id="mieHome"></div>
    <div class="srv">
      <div class="srv-h">${T('Prenota')}</div>
      <div class="srv-g">
      ${ptile('campi', '\ud83c\udfbe', T('Campi'), T('prenota o partita'))}
      ${ptile('partite', '\ud83d\udc65', T('Partite aperte'), T('unisciti'))}
      ${minorenne() ? '' : ptile('ordina="garden"', '\ud83c\udf7d\ufe0f', T('Garden'), T('cena e tavolo'))}
      ${minorenne() ? '' : ptile('ordina="bar"', '\ud83c\udf78', T('Bar'), T('ordina e ritira'))}
      ${minorenne() ? '' : ptile('fitness', '\ud83e\uddd8', T('Fitness'), T('lezioni con istruttore'))}
      ${ptile('carta', '\ud83c\udfb2', T('Casa di Carta'), T('tavolo da gioco'))}
      ${ptile('stage', '\ud83c\udfac', T('Stage'), T('posto allo spettacolo'))}
      ${ptile('cowo', '\ud83d\udcbb', T('Coworking'), T('postazione'))}
      </div></div>
    ${minorenne()
      ? `<div class="note" style="margin-top:12px">${T('Le prenotazioni a pagamento — cena, bar, lezioni e serate — le fa un adulto per te: fino ai 18 anni non si possono prendere impegni di spesa da soli.')}</div>`
      : `<button class="btn navy block" style="margin-top:12px" data-serate-tutte>✨ ${T('Scopri le nostre serate speciali')}</button>`}
    <button class="btn navy block" style="margin-top:10px" data-rassegna="1">🎞️ ${T('Rassegna cinematografica')}</button>
    <div style="height:10px"></div>`;
  mostraMiePrenotazioni();
}
function renderEventi() {
  $('#s-eventi').innerHTML = `
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin:6px 2px 4px">${T('La settimana')}</h2>
    <p class="tiny muted" style="margin-bottom:12px">${minorenne() ? T('Tocca una serata per i dettagli.') : T('Tocca una serata per i dettagli e per prenotare.')}</p>
    <div>${state.data.eventi.map(e => evCardHTML(e, false)).join('')}</div>`;
}
// La posizione arriva dal server: a parita' di punti le casate condividono l'indice.
function posizioneDi(c, sorted, i) { return c.posizione || i + 1; }
function renderCoppa() {
  const sorted = [...state.data.casate].sort((a, b) => (a.posizione || 99) - (b.posizione || 99) || b.punti - a.punti);
  const max = sorted[0].punti || 1;
  const mine = state.socio.casata || '';
  const myClanIdx = sorted.findIndex(c => c.nome === mine);
  const myPos = myClanIdx < 0 ? 0 : posizioneDi(sorted[myClanIdx], sorted, myClanIdx);
  const myClan = sorted.find(c => c.nome === mine) || sorted[0];
  const isCap = String(state.socio.ruolo || '').toLowerCase() === 'capitano';
  const ct = state.data.contest;
  const contestCard = ct ? `<div class="hero" data-open-contest role="button" tabindex="0" style="min-height:120px; margin-top:12px; background:linear-gradient(180deg, rgba(18,50,79,.15), rgba(18,50,79,.9)), linear-gradient(135deg,#6E5AA6,#b14a35)">
      <div class="eyebrow" style="color:#ffe1ac">${T('Serata dei Clan · Contest')}${ct.settimana ? ' · ' + esc(ct.settimana) : ''}</div>
      <h2 class="serif" style="font-size:1.3rem">${esc(ct.titolo)}</h2>
      <p style="font-size:.8rem; opacity:.95">${esc((ct.brief || '').slice(0, 90))}${(ct.brief || '').length > 90 ? '…' : ''}</p>
      <button class="btn gold sm" style="align-self:flex-start; margin-top:8px">${T('Apri il contest')}</button>
    </div>` : '';
  const capCard = isCap ? `<div class="card" style="background:linear-gradient(135deg,#8a5a12,#6b4406); color:#fff; border:none; margin-top:12px">
      <div class="eyebrow" style="color:#ffe9c2">${T('Strumenti del capitano')} · ${esc(mine)}</div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
        <button class="btn sm" style="background:#fff; color:var(--navy); flex:1" data-cap="convoca">📣 ${T('Convoca la casata')}</button>
        <button class="btn sm" style="background:rgba(255,255,255,.2); color:#fff; flex:1" data-cap="serata">🏆 ${T('Serata dei Clan')}</button>
      </div></div>` : '';
  $('#s-coppa').innerHTML = `
    ${state.socio?.casata ? `<button class="btn navy block" style="margin-bottom:12px" data-chat="casata">💬 ${T('Chat della casata')}${isCap ? ' · ' + T('e capitani') : ''}</button>` : ''}
    <div class="eyebrow" style="margin:4px 2px 2px">${T('La comunità')}</div>
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin-bottom:12px">${T('Coppa delle Casate')}</h2>
    <div class="myclan"><div class="shield" style="background:${myClan.colore}">${esc(mine[0]||'A')}</div><div class="info"><h3>${esc(mine)}${myClan.campione ? ' <span style="color:var(--gold)" title="' + T('Migliore casata') + ' ' + esc(myClan.campione_stagione || '') + '">✧</span>' : ''}</h3><p>${T('La tua casata')} · ${esc(myClan.motto||'')}</p></div><div class="posbig"><div class="n">${myPos||'—'}°</div><div class="l">${T('posto')}</div></div></div>
    ${contestCard}${capCard}
    <div class="card" style="margin-top:12px"><div class="eyebrow" style="color:var(--navy)">${T('Classifica generale')}</div><div style="margin-top:6px">${sorted.map((c,i)=>`<div class="rank" role="button" tabindex="0" data-casatamembri="${c.id}" style="cursor:pointer"><div class="rn">${posizioneDi(c,sorted,i)}</div><div class="sh" style="background:${c.colore}"></div><div class="nm">${esc(c.nome)}${c.campione ? ` <span title="${T('Migliore casata')} ${esc(c.campione_stagione || '')}" style="color:var(--gold)">✧</span>` : ''}</div><div class="bar"><span style="width:${Math.round(c.punti/max*100)}%; background:${c.colore}"></span></div><div class="pt">${c.punti}</div></div>`).join('')}</div></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--teal); font-size:1.4rem">🎾</div><div style="flex:1"><b>${T('Campionati sport')}</b><p class="tiny muted">${T('Gironi, calendario e risultati.')}</p></div><button class="btn navy sm" data-go="sport">${T('Apri')}</button></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--plum); font-size:1.4rem">🃏</div><div style="flex:1"><b>${T('Giochi da Tavolo')}</b><p class="tiny muted">${T('Burraco, scala 40, briscola, scacchi.')}</p></div><button class="btn navy sm" data-go="giochi">${T('Apri')}</button></div>
    <div class="card" style="display:flex; align-items:center; gap:12px"><div style="color:var(--gold); font-size:1.4rem">📜</div><div style="flex:1"><b>${T("Regolamenti & Albo d'Oro")}</b><p class="tiny muted">${T('Regole di Coppa, Contest e Proposte; le edizioni passate.')}</p></div><button class="btn navy sm" data-sheet="regolamenti">${T('Apri')}</button></div>`;
}
function openRegolamenti() {
  const r = state.data.regolamenti || { generali: [], discipline: [] };
  const albo = state.data.albo || [];
  const blocco = (titolo, testo) => `<div class="card" style="margin-top:10px"><div class="eyebrow" style="color:var(--navy)">${esc(titolo)}</div><p class="tiny" style="white-space:pre-wrap; margin-top:4px">${esc(testo || '—')}</p></div>`;
  const gen = (r.generali || []).map(x => blocco(x.titolo, x.testo)).join('');
  const disc = (r.discipline || []).map(d => blocco(`${d.nome}${d.data_inizio ? ' · ' + d.data_inizio + (d.data_fine ? '→' + d.data_fine : '') : ''}`, d.regolamento)).join('');
  const alboHtml = albo.length ? `<div class="sect-title" style="margin-top:14px">${T("Albo d'Oro")}</div><div class="card" style="padding:4px 14px">${albo.map(e => `<div class="matchrow"><div class="vs">${esc(e.disciplina_nome)}<div class="ct">${esc((e.data_inizio || '') + (e.data_fine ? '→' + e.data_fine : ''))}</div></div><div class="sc">${esc(e.vincitore || '—')}</div></div>`).join('')}</div>` : '';
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${T('Regole & storia')}</div><h2>${T('Regolamenti')}</h2>
    <p class="sub">${T('Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.')}</p>
    ${gen || `<p class="tiny muted">${T('Nessun regolamento generale.')}</p>`}
    ${disc ? `<div class="sect-title" style="margin-top:14px">${T('Discipline')}</div>` + disc : ''}
    ${alboHtml}
    <button class="btn navy block" style="margin-top:14px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
const RIF_DAYS = [['lun','Lun'],['mar','Mar'],['mer','Mer'],['gio','Gio'],['ven','Ven'],['sab','Sab'],['dom','Dom']];
function rifTextColor(hex){ if(!hex) return '#fff'; const h=hex.replace('#',''); if(h.length<6) return '#fff'; const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),bl=parseInt(h.slice(4,6),16); return (r*0.299+g*0.587+bl*0.114)>150?'#1a1a1a':'#fff'; }
function rifiutiHTML(){
  const data = state.data.rifiuti || { tipi: [], calendari: [] };
  const tipi = data.tipi || [];
  const cal = data.calendari || [];
  if (!tipi.length && !cal.length) {
    return `<div class="card"><p class="tiny muted">${T('Calendario non ancora disponibile.')}</p></div>`;
  }
  const colorOf = (nome) => (tipi.find(t => t.nome === nome) || {}).colore || '#7A8790';
  // iniziali univoche per la pastiglia (in caso di collisione si passa a due lettere)
  const inits = {}; const used = new Set();
  tipi.forEach(t => { const clean = (t.nome || '').replace(/[^0-9A-Za-zÀ-ÿ]/g, ''); let ini = (clean[0] || '?').toUpperCase(); let i = 1; while (used.has(ini) && i < clean.length) { ini = (clean[0] + clean[i]).toUpperCase(); i++; } while (used.has(ini)) ini += '·'; used.add(ini); inits[t.nome] = ini; });
  const norm = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);
  const legendChips = tipi.length ? `<div class="chips" style="margin-top:10px">${tipi.map(t => `<span class="chip" style="cursor:default;background:${esc(t.colore)};color:${rifTextColor(t.colore)};border-color:${esc(t.colore)}"><b style="opacity:.9">${esc(inits[t.nome])}</b> · ${esc(D(t.nome))}</span>`).join('')}</div>` : '';
  const periods = cal.map(c => {
    const g = c.giorni || {};
    const cells = RIF_DAYS.map(([k,lbl]) => {
      const nomi = norm(g[k]);
      const pills = nomi.length
        ? nomi.map(nome => { const col = colorOf(nome); return `<div title="${esc(D(nome))}" style="width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:${esc(col)};color:${rifTextColor(col)};font-size:.62rem;font-weight:800">${esc(inits[nome] || '•')}</div>`; }).join('')
        : `<div style="width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#eef1f3;color:#b5bcc2;font-size:.62rem">–</div>`;
      return `<div style="flex:1;min-width:30px;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:.6rem;font-weight:700;color:#5c6a73">${D(lbl)}</div>${pills}</div>`;
    }).join('');
    const info = [];
    if (c.inizio_conf || c.fine_conf) info.push(`${T('Conferimento')} ${esc(c.inizio_conf||'')}${c.fine_conf?'–'+esc(c.fine_conf):''}`);
    if (c.ora_ritiro) info.push(`${T('Ritiro dalle')} ${esc(c.ora_ritiro)}`);
    return `<div class="card" style="margin-bottom:10px"><div style="font-weight:700;font-size:.85rem;color:var(--navy);margin-bottom:10px">${esc(D(c.periodo))}</div><div style="display:flex;gap:3px">${cells}</div>${legendChips}${info.length?`<div class="tiny muted" style="margin-top:9px">${info.join(' · ')}</div>`:''}</div>`;
  }).join('');
  return `<div>${periods || `<div class="card"><p class="tiny muted">${T('Nessun periodo configurato.')}</p></div>`}</div>`;
}
// Dalla frase intera si tiene solo l'orario: le due righe stanno su una sola.
function oreSilenzio(testo, fallback) {
  const s = String(testo || '');
  const m = s.match(/\d{1,2}[:.]\d{2}\s*[\u2013\u2014-]\s*\d{1,2}[:.]\d{2}/) || s.match(/(dopo|fino)\s+le\s+\d{1,2}[:.]\d{2}/i);
  return m ? m[0] : fallback;
}
function renderBussola() {
  const b = state.data.bussola;
  // Una riga sola: nome, luogo e distanza sulla stessa linea. Con le coordinate la voce
  // diventa un collegamento che apre le mappe del telefono (Apple Maps su iPhone, Google
  // Maps su Android): "geo:" con fallback universale.
  const mappaHref = (x) => x.lat != null && x.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lng}`
    : null;
  // La mappa incorporata (senza chiave) fa vedere DOV'E' invece di far immaginare: si tocca
  // per aprire le indicazioni nell'app di mappe del telefono.

  // Le voci con posizione restano a portata: la mappa si apre a tutto foglio al tocco.
  for (const v of [...(b.servizi || []), ...(b.vedere || [])]) MAPPE[String(v.titolo)] = v;
  const rows = (arr) => (arr || []).map(x => {
    const href = mappaHref(x);
    // I dati passano dal traduttore dei termini: "Guardia medica" e "Centro storico di
    // Siracusa · cultura" arrivano dal database, e senza questo restavano in italiano sotto un
    // titolo inglese.
    const dentro = `<b style="font-size:.84rem">${esc(D(x.titolo))}</b>${x.dettaglio ? `<span class="ct" style="margin-left:6px">${esc(D(x.dettaglio))}</span>` : ''}`;
    const dist = `${x.distanza ? `<span class="ct" style="white-space:nowrap;margin-left:8px">${esc(x.distanza)}</span>` : ''}${href ? '<span class="ct" style="margin-left:6px">↗</span>' : ''}`;
    return href
      ? `<div class="matchrow" role="button" tabindex="0" data-mappa="${esc(String(x.titolo))}" style="cursor:pointer"><span style="flex:1;min-width:0">${dentro}</span>${dist}</div>`
      : `<div class="matchrow"><span style="flex:1;min-width:0">${dentro}</span>${dist}</div>`;
  }).join('');
  const luoghi = state.data.luoghi || SEED.luoghi;
  const iconFor = (k) => k === 'isola' ? '♻️' : '📍';
  const siamoQui = luoghi.map(l => {
    const label = tr(l.chiave) || l.nome;
    const has = l.lat != null && l.lng != null;
    const right = l.chiave === 'chiosco'
      ? `<span style="background:var(--coral);color:#fff;padding:3px 10px;border-radius:12px;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${esc(tr('siamo_qui'))}</span>`
      : `<span style="color:var(--teal);font-size:1.1rem">↗</span>`;
    if (has) MAPPE[label] = { titolo: label, lat: l.lat, lng: l.lng, dettaglio: l.chiave === 'isola' ? T('Conferimento rifiuti') : T('Bar, cucina e ritrovo'), mappa_embed: l.mappa_embed || null };
    return `<div class="matchrow" ${has ? `role="button" tabindex="0" data-mappa="${esc(label)}" style="cursor:pointer"` : ''}><div style="flex:1"><b style="font-size:.9rem">${iconFor(l.chiave)} ${esc(label)}</b>${has ? `<div class="ct">${esc(tr('apri_mappa'))}</div>` : ''}</div>${right}</div>`;
  }).join('');
  $('#s-bussola').innerHTML = `
    <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin:6px 2px 12px">${T('Guida del residence')}</h2>
    <div class="sect-title" style="margin-top:2px">${esc(tr('siamo_qui'))}</div>
    <div class="card" style="padding:4px 14px">${siamoQui}</div>
    <div class="card" style="background:#fbf4e6; border-color:#ecdcbd; margin-top:11px; padding:10px 14px">
      <div style="display:flex; align-items:center; gap:12px">
        <b style="font-size:.86rem; color:var(--navy); white-space:nowrap">${T('Ore di silenzio')}</b>
        <div style="display:flex; gap:14px; flex:1; justify-content:flex-end; flex-wrap:wrap">
          <span style="color:#5c4d2a; font-size:.82rem">🤫 <b>${esc(D(oreSilenzio(b.orari?.[0]?.dettaglio, '14:00–17:00')))}</b></span>
          <span style="color:#5c4d2a; font-size:.82rem">🌙 <b>${esc(D(oreSilenzio(b.orari?.[1]?.dettaglio, 'dopo le 23:30')))}</b></span>
        </div>
      </div>
    </div>
    <div class="sect-title">${T('Raccolta rifiuti')}</div>${rifiutiHTML()}
    <div class="sect-title">${T('Numeri utili & servizi')}</div><div class="card" style="padding:4px 14px">${rows(b.servizi)}</div>
    <div class="sect-title">${T('Cosa vedere')}</div><div class="card" style="padding:4px 14px">${rows(b.vedere)}</div>
    <div style="height:6px"></div>`;
}

/* Sport & Giochi con convocazione */
const DOMAINS = { sport: { cur: 0 }, giochi: { cur: 0 } };
function wireDiscSel() {
  document.querySelectorAll('[data-domsel]').forEach((sel) => sel.onchange = () => {
    const dom = sel.dataset.domsel;
    DOMAINS[dom].cur = Number(sel.value) || 0;
    renderDom(dom);
  });
}
function renderDom(dom) {
  const list = state.data[dom]; if (!list || !list.length) return;
  const D = DOMAINS[dom]; const s = list[D.cur];
  const key = dom + '/' + D.cur; const st = state.conv[key] || 'open';
  const el = document.getElementById('s-' + dom);
  const disc = '';
  const conv = s.next[0] || { a: state.socio.casata, b: '—', wh: T('prossimamente'), court: '' };
  const matchLabel = `${conv.a} vs ${conv.b}`;
  const isOspite = state.socio.tipo_profilo === 'ospite_temporaneo';
  let personal;
  if (st === 'ok') {
    personal = `<div class="card" style="background:linear-gradient(135deg,#5f9a5c,#3f6b3d); color:#fff; border:none"><div class="eyebrow" style="color:#e8f3e2">${T('Presenza confermata ✓')}</div><div style="margin-top:6px"><b style="font-size:.9rem">${esc(matchLabel)}</b><div class="tiny" style="opacity:.9">${esc(conv.wh)} · ${esc(conv.court)}</div></div></div>`;
  } else if (!isOspite && state.rifiuti >= 3) {
    personal = `<div class="card" style="background:linear-gradient(135deg,#c0553f,#9c3f2c); color:#fff; border:none"><div class="eyebrow" style="color:#ffd9cf">${T('Convocazione vincolante')}</div><div style="margin-top:6px"><b>${esc(matchLabel)}</b><div class="tiny" style="opacity:.9">${esc(conv.wh)} · ${esc(conv.court)}</div></div><div class="tiny" style="margin-top:8px">${T('Hai già declinato tre volte in stagione: questa convocazione è vincolante.')}</div><button class="btn gold sm" style="margin-top:10px" data-conv="ok" data-key="${key}">${T('Confermo')}</button></div>`;
  } else if (st === 'no') {
    personal = `<div class="card" style="display:flex; align-items:center; gap:12px"><div style="flex:1"><b>${T('Hai declinato')}</b><p class="tiny muted">${esc(matchLabel)}${isOspite?'' :` · ${T('dinieghi')} ${state.rifiuti}/3`}</p></div><button class="btn gold sm" data-conv="ok" data-key="${key}">${T('Ci ripenso')}</button></div>`;
  } else {
    const footer = isOspite
      ? `<div class="tiny" style="opacity:.85; margin-top:9px">${T('Sei nostro ospite: partecipa quando vuoi, nessun obbligo.')}</div>`
      : `<div class="tiny" style="opacity:.8; margin-top:9px">${T('Dinieghi:')} ${state.rifiuti}/3 · ${T('diventa vincolante solo dopo il terzo')}</div>`;
    personal = `<div class="card" style="background:linear-gradient(135deg,var(--navy),#1d4a6e); color:#fff; border:none"><div class="eyebrow" style="color:#ffe1ac">${T('La tua casata ti invita')}</div><div style="margin-top:6px"><b>${esc(matchLabel)}</b><div class="tiny" style="opacity:.85">${esc(conv.wh)} · ${esc(conv.court)}</div></div><div style="display:flex; gap:8px; margin-top:12px"><button class="btn gold sm" data-conv="ok" data-key="${key}">${T('Disponibile')}</button><button class="btn ghost sm" style="background:transparent; color:#fff; border-color:#fff" data-conv="no" data-key="${key}">${T('Non disponibile')}</button></div>${footer}</div>`;
  }
  const gironi = s.gironi.map(g => `<div class="card"><div class="eyebrow" style="color:var(--navy)">${esc(g.nome)}</div><table class="gtable"><thead><tr><th style="text-align:left; padding-left:2px">${T('Squadra')}</th><th>${T('PG')}</th><th>${T('V')}</th><th>${T('Pt')}</th></tr></thead><tbody>${g.rows.map((r,i)=>`<tr><td class="team"><span class="gpos">${i+1}</span><span class="d" style="background:${r.c}"></span>${esc(r.t)}</td><td>${r.pg}</td><td>${r.v}</td><td style="font-weight:700; color:var(--navy)">${r.pt}</td></tr>`).join('')}</tbody></table></div>`).join('');
  const next = `<div class="sect-title">${T('Prossime partite')}</div><div class="card" style="padding:4px 14px">${s.next.map(m=>`<div class="matchrow"><div class="wh">${esc(m.wh)}</div><div class="vs">${esc(m.a)} <small>vs</small> ${esc(m.b)}<div class="ct">${esc(m.court)}</div></div></div>`).join('')||`<p class="tiny muted" style="padding:8px 0">${T('Calendario in aggiornamento.')}</p>`}</div>`;
  const res = `<div class="sect-title">${T('Risultati recenti')}</div><div class="card" style="padding:4px 14px">${s.results.map(m=>`<div class="matchrow"><div class="vs">${esc(m.a)} <small>vs</small> ${esc(m.b)}</div><div class="sc">${esc(m.s)}</div></div>`).join('')||`<p class="tiny muted" style="padding:8px 0">${T('Nessun risultato ancora.')}</p>`}</div>`;
  const note = `<div class="note">${T('Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.')}</div>`;
  // La scelta della disciplina sta in una combo: con dieci sport le linguette non ci stavano.
  const head = `<div class="row" style="align-items:center; gap:10px; margin:6px 2px 12px">
      <h2 class="serif" style="color:var(--navy); font-size:1.5rem; margin:0; flex:0 0 auto">${dom==='sport'?T('Sport & Tornei'):T('Giochi da Tavolo')}</h2>
      <select class="discsel" data-domsel="${dom}" aria-label="${T('Scegli la disciplina')}" style="flex:1; min-width:0; padding:8px 10px; border:1px solid var(--line); border-radius:10px; background:#fff; font-weight:700; color:var(--navy)">
        ${list.map((d,i)=>`<option value="${i}" ${i===D.cur?'selected':''}>${esc(d.name)}</option>`).join('')}
      </select></div>`;
  el.innerHTML = head + disc + personal + gironi + next + res + note;
  wireDiscSel();
}

// ---- Overlay / sheet ------------------------------------------------------
function setSheet(html) { $('#sheetbox').innerHTML = html; }
function showOv() { $('#ov').classList.add('show'); $('.sheet').scrollTop = 0; }
function closeOv() { $('#ov').classList.remove('show'); if (!state.token) showGate(); }
function openEvent(k) {
  const e = state.data.eventi.find(x => x.chiave === k); if (!e) return;
  // Il bottone esiste solo se c'e' qualcosa da fare. Il lunedi' e' il giorno di riposo: non si
  // prenota niente, e un tasto d'oro vuoto in fondo alla scheda era peggio di nessun tasto.
  // Se invece un'azione c'e' ma manca l'etichetta, si scrive una parola sensata: l'azione
  // resta raggiungibile e non si perde per una casella lasciata vuota nel back office.
  const cta = String(e.cta || '').trim();
  let btn = '';
  if (e.azione === 'go-coppa') btn = `<button class="btn gold block" data-go="coppa">${esc(cta || T('Vai alla Coppa'))}</button>`;
  else if (e.azione) btn = `<button class="btn gold block" data-sheet="${e.azione}">${esc(cta || T('Apri'))}</button>`;
  else if (cta) btn = `<button class="btn gold block" data-confirm="${esc(e.titolo)}">${esc(cta)}</button>`;
  const eyebrowBits = [esc(e.giorno)];
  if (e.ora_inizio) eyebrowBits.push(esc(e.ora_inizio));
  if (e.ambiente) eyebrowBits.push(esc(e.ambiente));
  const info = [];
  if (e.tipologia) info.push(`<span class="ev-ty" style="background:${e.colore||'var(--navy)'}">${esc(e.tipologia)}</span>`);
  if (e.artista) info.push(`<span class="ev-ar">🎤 ${esc(e.artista)}</span>`);
  const costo = Number(e.costo || 0);
  info.push(e.costo_tipo === 'consumazione'
    ? `<span class="ev-co">🥂 ${esc(e.consumazione || T('consumazione obbligatoria'))}</span>`
    : `<span class="ev-co">🎟️ ${costo > 0 ? '€ ' + costo.toFixed(2) : T('Ingresso libero')}</span>`);
  const infoHTML = `<div class="ev-meta" style="margin:6px 0 12px">${info.join('')}</div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:${e.colore}">${eyebrowBits.join(' · ')}</div><h2>${esc(e.titolo)}</h2>${infoHTML}<p class="sub">${esc(e.descrizione)}</p>${btn}<button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
function openBooking(kind) {
  const b = state.data.risorse.find(r => r.chiave === kind) || SEED.risorse.find(r => r.chiave === kind);
  if (!b) return;
  const days = ['Oggi','Domani','Sab','Dom','Lun'];
  const capNota = b.tipo === 'coworking' ? `<div class="note">${T('Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.')}</div>` : '';
  const personeField = b.tipo === 'tavolo'
    ? `<div class="field"><label>${T('Quante persone')}</label><div class="chips" data-group="pers">${[1,2,3,4,5,6].map((n,i)=>`<button class="chip${i===1?' sel':''}" data-chip>${n}</button>`).join('')}</div></div>` : '';
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('Prenotazione')}</div><h2>${esc(b.nome)}</h2><p class="sub">${esc(b.sottotitolo)}</p>
    <div class="field"><label>${T('Giorno')}</label><div class="chips" data-group="day">${days.map((d,i)=>`<button class="chip${i===0?' sel':''}" data-chip>${T(d)}</button>`).join('')}</div></div>
    <div class="field"><label>${T('Turno')}</label><div class="chips" data-group="slot">${b.slots.map((s,i)=>`<button class="chip${i===0?' sel':''}" data-chip>${esc(s)}</button>`).join('')}</div></div>
    ${personeField}${capNota}${b.nota?`<div class="note">${esc(b.nota)}</div>`:''}
    <button class="btn gold block" style="margin-top:10px" data-do-book="${b.chiave}">${T('Conferma prenotazione')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Annulla')}</button>`);
  showOv();
}
// ---- Host / Casa mia ----
function hostCardsHTML() {
  const s = state.socio || {};
  const t = s.tipo_profilo;
  let out = '';
  if (s.ha_casa) out += `<div class="card" role="button" tabindex="0" data-casamia="" style="display:flex; align-items:center; gap:12px; background:linear-gradient(135deg,#12324F,#256b65); color:#fff; border:none; margin-bottom:10px"><div style="font-size:1.5rem">🏡</div><div style="flex:1"><b>${T('Casa mia')}</b><p class="tiny" style="opacity:.9">${T('Come raggiungere la casa e le regole del soggiorno.')}</p></div><span style="font-size:1.2rem">›</span></div>`;
  // Visitatore non ancora collegato: qui indica chi lo ospita (campo di ricerca dell'host).
  if (t === 'ospite_temporaneo' && !s.ha_casa) out += `<div class="card" role="button" tabindex="0" data-collega="" style="display:flex; align-items:center; gap:12px; margin-bottom:10px"><div style="font-size:1.5rem">🏡</div><div style="flex:1"><b>${T('Collega la tua casa')}</b><p class="tiny muted">${T('Indica chi ti ospita per vedere indicazioni e regole del soggiorno.')}</p></div><button class="btn navy sm" data-collega="">${T('Collega')}</button></div>`;
  // SOLO CHI HA DICHIARATO DI FARE L'HOST. Prima bastava essere residente: chi non aveva mai
  // chiesto di gestire case vacanza si ritrovava comunque la sezione, e con essa la
  // responsabilita' dei dati dei propri ospiti — che e' una cosa seria e non un di piu'.
  //
  // Chi cambia idea la attiva dal proprio profilo: e' un gesto consapevole, non un effetto
  // collaterale del tipo di profilo.
  if (s.is_host) out += `<div class="card" role="button" tabindex="0" data-lemiecase="" style="display:flex; align-items:center; gap:12px; margin-bottom:10px"><div style="font-size:1.5rem; color:var(--gold)">🔑</div><div style="flex:1"><b>${T('Le mie case')}</b><p class="tiny muted">${s.is_host ? T('Gestisci le case vacanza che ospiti nel residence.') : T('Aggiungi la tua casa vacanza: potrai accogliere i visitatori.')}</p></div><button class="btn navy sm" data-lemiecase="">${T('Apri')}</button></div>`;
  return out;
}
// Visitatore: cerca il proprio host e invia la richiesta (stesso flusso della registrazione, ma sempre disponibile).
async function openCollegaHost() {
  let st = null; try { st = await api('/auth/aggancio/stato'); } catch {}
  // Già collegato (host ha confermato): scarica e mostra "Casa mia".
  if (st && st.collegato) { await refreshSocio(true); return openCasaMia(); }
  if (st && st.richiesta && st.richiesta.stato === 'in_attesa') {
    const hn = (st.richiesta.host_nome || '') + ' ' + (st.richiesta.host_cognome || '');
    setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">📨 ${T('Richiesta inviata')}</div><h2>${T('In attesa di conferma')}</h2>
      <p class="sub">${T('Abbiamo avvisato')} <b>${esc(hn.trim())}</b>. ${T('Quando confermerà, comparirà "Casa mia" con tutte le indicazioni della struttura.')}</p>
      <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
    showOv(); return;
  }
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">🏡 ${T('Il tuo host')}</div><h2>${T('Chi ti ospita?')}</h2>
    <p class="sub">${T('Cerca chi ti ospita: riceverà una notifica e, se conferma, vedrai "Casa mia".')}</p>
    <div class="field"><label>${T('Nome o cognome dell\'host')}</label><input id="reg_hq" placeholder="${T('es. Chiara')}" autocomplete="off"></div>
    <div id="reg_hres"></div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
  const inp = $('#reg_hq'); if (inp) { inp.oninput = () => regHostCerca(inp.value); setTimeout(() => inp.focus(), 60); }
}
async function openCasaMia() {
  let d;
  try { d = await api('/auth/casa-mia'); } catch (e) { okThen(e.status === 423 ? T('Dati della struttura non disponibili') : (e.message || 'Errore'), false); return; }
  if (!d || !d.collegato) { okThen(T('Casa mia'), false); return; }
  const st = d.struttura;
  const arrivo = (st.lat && st.lng)
    ? `<div class="matchrow" role="button" tabindex="0" data-map="${st.lat},${st.lng}" style="cursor:pointer"><div style="flex:1"><b style="font-size:.9rem">📍 ${esc(st.nome)}</b><div class="ct">${T('Isolato')} ${esc(st.isolato||'—')} · ${T('Numero')} ${esc(st.numero||'—')}</div></div><span style="color:var(--teal);font-size:1.1rem">↗</span></div>`
    : `<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">${esc(st.nome)}</b><div class="ct">${T('Isolato')} ${esc(st.isolato||'—')} · ${T('Numero')} ${esc(st.numero||'—')}</div></div></div>`;
  const sogg = (d.soggiorno && (d.soggiorno.dal || d.soggiorno.al)) ? `<div class="note">${T('Il tuo soggiorno')}: ${T('dal')} ${esc(d.soggiorno.dal||'—')} ${T('al')} ${esc(d.soggiorno.al||'—')}</div>` : '';
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">🏡 ${esc(st.nome)}</div><h2>${T('Casa mia')}</h2>
    <div class="sect-title" style="margin-top:6px">${T('Come arrivare')}</div><div class="card" style="padding:4px 14px">${arrivo}</div>
    <div class="sect-title">${T('Orario di check-out')}</div><div class="card"><b style="font-size:1.1rem; color:var(--navy)">🕙 ${esc(st.check_out||'—')}</b></div>
    <div class="sect-title">${T('Regole della casa')}</div><div class="card"><p class="tiny" style="white-space:pre-wrap">${esc(st.regole||'—')}</p></div>
    <div class="card" style="padding:8px 14px"><p class="tiny muted">CIR ${esc(st.cir||'—')} · CIN ${esc(st.cin||'—')}</p></div>
    ${sogg}
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
async function openLeMieCase() {
  let d;
  try { d = await api('/auth/host/strutture'); } catch (e) { if (e.status !== 401) okThen(e.message || 'Errore', false); return; }
  const list = (d.strutture || []).map(st => st.ko
    ? `<div class="matchrow"><div style="flex:1"><b>⚠️ ${T('Dati della struttura non disponibili')}</b></div></div>`
    : `<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">🏡 ${esc(st.nome)}</b><div class="ct">${T('Orario di check-out')} ${esc(st.check_out||'—')} · CIR ${esc(st.cir||'—')}</div></div><div style="display:flex; gap:6px"><button class="btn ghost sm" data-strutt-edit="${st.id}">${T('Modifica')}</button><button class="btn danger sm" data-strutt-del="${st.id}">🗑</button></div></div>`).join('');
  window.__strutture = (d.strutture || []).filter(x => !x.ko);
  // Richieste di aggancio in attesa (le manda il visitatore che si è auto-registrato) + visitatori già collegati.
  let richieste = [], ospiti = [];
  try { richieste = (await api('/auth/host/richieste')).richieste || []; } catch { richieste = []; }
  try { ospiti = (await api('/auth/host/ospiti')).ospiti || []; } catch { ospiti = []; }
  const nomeStrutt = (id) => { const s = (window.__strutture || []).find(x => String(x.id) === String(id)); return s ? s.nome : ''; };
  const reqList = richieste.map(r => `<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">👤 ${esc(r.nome)} ${esc(r.cognome)}</b><div class="ct">${T('dice di essere tuo ospite')}${r.soggiorno_dal?' · '+esc(r.soggiorno_dal)+(r.soggiorno_al?' → '+esc(r.soggiorno_al):''):''}</div></div><div style="display:flex; gap:6px"><button class="btn gold sm" data-req-ok="${r.id}">✓ ${T('Conferma')}</button><button class="btn ghost sm" data-req-no="${r.id}">✕</button></div></div>`).join('');
  const ospList = ospiti.map(o => `<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">👤 ${esc(o.nome)} ${esc(o.cognome)}</b><div class="ct">${o.struttura_id?'🏡 '+esc(nomeStrutt(o.struttura_id)):''}${o.soggiorno_dal?' · '+esc(o.soggiorno_dal)+(o.soggiorno_al?' → '+esc(o.soggiorno_al):''):''}</div></div><div style="display:flex; gap:6px"><button class="btn ghost sm" data-osp-scollega="${o.id}">${T('Scollega')}</button></div></div>`).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">🔑 ${T('Le mie case')}</div><h2>${T('Le tue strutture')}</h2>
    <p class="sub">${T('Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.')}</p>
    <div class="card" style="padding:4px 14px">${list || `<p class="tiny muted" style="padding:8px 0">${T('Non hai ancora aggiunto strutture.')}</p>`}</div>
    ${(d.strutture||[]).length < 3 ? `<button class="btn gold block" style="margin-top:10px" data-strutt-new="">+ ${T('Aggiungi struttura')}</button>` : ''}
    ${richieste.length ? `<div class="sect-title" style="margin-top:16px">${T('Richieste in attesa')}</div>
    <p class="sub">${T('Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.')}</p>
    <div class="card" style="padding:4px 14px">${reqList}</div>` : ''}
    <div class="sect-title" style="margin-top:16px">${T('I miei visitatori')}</div>
    <p class="sub">${T('Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.')}</p>
    <div class="card" style="padding:4px 14px">${ospList || `<p class="tiny muted" style="padding:8px 0">${T('Nessun visitatore collegato.')}</p>`}</div>
    <button class="btn ghost block" style="margin-top:12px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
async function hostApprova(id) {
  const strutture = window.__strutture || [];
  // Serve almeno una casa a cui collegare l'ospite: se manca, guido l'host ad aggiungerla.
  if (!strutture.length) { okThen(T('Aggiungi prima la tua casa, poi conferma l\'ospite.'), false); setTimeout(openLeMieCase, 300); return; }
  let sid = strutture[0].id;
  if (strutture.length > 1) {
    const nomi = strutture.map((s, i) => `${i + 1}. ${s.nome}`).join('\n');
    const pick = prompt(T('A quale casa lo colleghi?') + '\n' + nomi, '1');
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
  const f = (k, ph) => `<div class="field"><label>${ph}</label><input id="st_${k}" value="${esc(st[k] ?? '')}"></div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${id ? T('Modifica') : T('Aggiungi struttura')}</div><h2>${T('Nome struttura')}</h2>
    ${f('nome', T('Nome struttura'))}
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>${T('Isolato')}</label><input id="st_isolato" value="${esc(st.isolato ?? '')}"></div><div class="field" style="flex:1"><label>${T('Numero')}</label><input id="st_numero" value="${esc(st.numero ?? '')}"></div></div>
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>Lat</label><input id="st_lat" value="${esc(st.lat ?? '')}"></div><div class="field" style="flex:1"><label>Lng</label><input id="st_lng" value="${esc(st.lng ?? '')}"></div></div>
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>CIR</label><input id="st_cir" value="${esc(st.cir ?? '')}"></div><div class="field" style="flex:1"><label>CIN</label><input id="st_cin" value="${esc(st.cin ?? '')}"></div></div>
    <div class="field"><label>${T('Orario di check-out')}</label><input id="st_check_out" value="${esc(st.check_out ?? '')}" placeholder="10:00"></div>
    <div class="field"><label>${T('Regole della casa')}</label><textarea id="st_regole" rows="4" style="width:100%; padding:8px 10px; border:1px solid #cbd2d8; border-radius:9px">${esc(st.regole ?? '')}</textarea></div>
    <button class="btn gold block" data-strutt-save="${id || ''}">${T('Salva')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-lemiecase="">${T('Annulla')}</button>`);
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
  for (let i = 0; i < 7; i++) { const d = new Date(base.getTime() + i * 86400000); const iso = d.toISOString().slice(0, 10); out.push({ iso, label: i === 0 ? T('Oggi') : i === 1 ? T('Domani') : `${T(g[d.getDay()])} ${d.getDate()}` }); }
  return out;
}
const sportIcon = (s) => ({ pickleball: '🎾', soft_tennis: '🎾', calcetto: '⚽', beach: '🏐' }[s] || '🎾');
async function openCampi(campoId) {
  const campi = state.data.campi || [];
  if (!campi.length) { okThen(T('Prenotazione campi disponibile solo online'), false); return; }
  const sel = (campoId ? campi.find(c => c.id == campoId) : campi.find(c => c.id == state._campoSel)) || campi[0];
  state._campoSel = sel.id;
  const days = campiDays();
  if (!state._campoData || !days.some(d => d.iso === state._campoData)) state._campoData = days[0].iso;
  const data = state._campoData;
  let disp = { slots: [] };
  const qs = state.tessera ? `&tessera_code=${encodeURIComponent(state.tessera)}` : '';
  try { disp = await api(`/campi/${sel.id}/disponibilita?data=${data}${qs}`); } catch { }
  const campo = disp.campo || sel;
  const posti = campo.posti_default || sel.posti_default || 4;
  // Il tempo totale scritto sulla chip: "2× 90′ · 3 h" rende evidente quanto campo si occupa.
  const oreDi = (min) => min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60}′`;
  const maxFasce = campo.max_slot_prenotazione || sel.max_slot_prenotazione || 1;
  if (!state._campoFasce || state._campoFasce > maxFasce) state._campoFasce = 1;
  const courtChips = campi.map(c => `<button class="chip${c.id === sel.id ? ' sel' : ''}" data-campo-pick="${c.id}">${sportIcon(c.sport)} ${esc(c.nome)}</button>`).join('');
  const dayChips = days.map(d => `<button class="chip${d.iso === data ? ' sel' : ''}" data-campo-date="${d.iso}">${esc(d.label)}</button>`).join('');
  const fasceChips = maxFasce > 1
    ? `<div class="field"><label>${T('Durata')}</label><div class="chips">${Array.from({ length: maxFasce }, (_, i) => i + 1).map(n => `<button class="chip${n === state._campoFasce ? ' sel' : ''}" data-campo-fasce="${n}">${n}× ${campo.durata_slot || 60}′ <span class="tiny">· ${oreDi(n * (campo.durata_slot || 60))}</span></button>`).join('')}</div></div>`
    : '';
  const q = disp.quota;
  const quotaHTML = q
    ? `<div class="note" style="margin-top:0">${q.residue > 0
        ? `${T('Ti restano')} <b>${q.residue}</b> ${T(q.residue === 1 ? 'prenotazione questa settimana' : 'prenotazioni questa settimana')} ${T('su questo campo')} (${q.usate}/${q.massimo}).`
        : `${T('Hai esaurito le prenotazioni di questa settimana su questo campo')} (${q.usate}/${q.massimo}).`}</div>`
    : '';
  const slotHTML = (disp.slots || []).map(s => {
    if (s.stato === 'libero') return `<div class="matchrow"><div style="flex:1"><b style="font-size:.95rem">${esc(s.slot)}</b><div class="ct">${T('Libero')}</div></div><div style="display:flex;gap:6px"><button class="btn ghost sm" data-prenota="${sel.id}|${s.slot}">${T('Solo io')}</button><button class="btn gold sm" data-apri="${sel.id}|${s.slot}">${T('Apri ai soci')}</button></div></div>`;
    // Le fasce gia' finite non si mostrano: alle nove di sera il campo delle quattro non e'
    // una scelta, e vederselo offrire con "Solo io" e "Apri ai soci" fa pensare che l'app non
    // sappia che ore sono. Quante ne sono passate lo dice una riga sotto l'elenco.
    if (s.stato === 'passato') return '';
    // Gia' cominciata: si vede che c'e' ma non si prenota. Dall'app si prenota in anticipo;
    // chi e' li' di persona la chiede al banco.
    if (s.stato === 'in_corso') return `<div class="matchrow" style="opacity:.55"><div style="flex:1"><b style="font-size:.95rem">${esc(s.slot)}</b><div class="ct">\u23f3 ${T('in corso: chiedila al banco')}</div></div></div>`;
    if (s.stato === 'bloccato') return `<div class="matchrow" style="opacity:.6"><div style="flex:1"><b style="font-size:.95rem">${esc(s.slot)}</b><div class="ct">🚧 ${T('Campo impegnato')}${s.motivo ? ' · ' + esc(s.motivo) : ''}${s.nota ? ' · ' + esc(s.nota) : ''}</div></div><span class="tag" style="background:#f4e6d8;color:#8a5a12;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">${T('NON PRENOTABILE')}</span></div>`;
    if (s.stato === 'partita') { const pieno = s.iscritti >= s.posti_totali; const nl = s.numero_legale; const miaAperta = s.partita_id && state.tessera && (s.titolare_tessera || '').toUpperCase() === String(state.tessera).toUpperCase(); return `<div class="matchrow"><div style="flex:1"><b style="font-size:.95rem">${esc(s.slot)}</b><div class="ct">👥 ${T('Partita aperta')} · ${s.iscritti}/${s.posti_totali}${s.livello ? ' · ' + esc(s.livello) : ''}${s.titolare ? ' · ' + esc(s.titolare) : ''}</div>${nl && !nl.raggiunto ? `<div class="ct" style="color:#b14a35;font-weight:700">${T('Servono')} ${nl.minimo} ${T('giocatori: ne mancano')} ${nl.mancano} ${T('entro le')} ${esc(nl.scade_alle)}</div>` : ''}${nl && nl.raggiunto ? `<div class="ct" style="color:#2e6b45;font-weight:700">${T('Si gioca: numero minimo raggiunto')}</div>` : ''}</div>${pieno ? `<span class="tag" style="background:#e6f2ea;color:#2e6b45;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">${T('AL COMPLETO')}</span>` : `<button class="btn gold sm" data-unisci="${s.partita_id}">${T('Unisciti')}</button>`}${miaAperta ? `<button class="btn ghost sm" style="margin-left:6px;color:#b14a35" data-disdici="${s.partita_id}">${T('Disdici')}</button>` : ''}</div>`; }
        // Riservata non vuol dire "gioco da solo": se e' la tua, puoi dire chi gioca con te.
    const miaRiservata = s.partita_id && state.tessera && (s.titolare_tessera || '').toUpperCase() === String(state.tessera).toUpperCase();
    return `<div class="matchrow"${miaRiservata ? '' : ' style="opacity:.6"'}><div style="flex:1"><b style="font-size:.95rem">${esc(s.slot)}</b><div class="ct">🔒 ${T('Riservata')} · ${esc(s.titolare || '')}${s.iscritti ? ' · ' + s.iscritti + '/' + s.posti_totali : ''}</div></div>${miaRiservata ? `<button class="btn ghost sm" data-chigioca="${s.partita_id}">${T('Chi gioca')}</button><button class="btn ghost sm" style="margin-left:6px;color:#b14a35" data-disdici="${s.partita_id}">${T('Disdici')}</button>` : ''}</div>`;
  }).join('');
  // Quante fasce di oggi sono gia' passate: si dice, invece di far sparire mezza giornata
  // senza spiegazioni.
  // `disp.slots` e' l'elenco vero: ieri avevo scritto `fasce`, che non esiste. L'eccezione
  // arrivava DOPO aver disegnato le righe ma PRIMA di agganciare i tasti, quindi le fasce si
  // vedevano e non si poteva prenotare niente — l'errore piu' insidioso, perche' la schermata
  // sembra a posto.
  const passate = (disp.slots || []).filter((x) => x.stato === 'passato').length;
  const notaPassate = passate
    ? `<p class="muted" style="font-size:.78rem;margin-top:6px">${passate} ${passate === 1 ? T('fascia di oggi è già passata e non si può prenotare.') : T('fasce di oggi sono già passate e non si possono prenotare.')}</p>`
    : '';
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('Prenotazione campi')}</div><h2>${sportIcon(sel.sport)} ${esc(sel.nome)}</h2>
    <div class="field"><label>${T('Campo')}</label><div class="chips">${courtChips}</div></div>
    <div class="field"><label>${T('Giorno')}</label><div class="chips">${dayChips}</div></div>
    ${fasceChips}
    <div class="sect-title" style="margin-top:6px">${T('Fasce orarie')}</div>
    <div class="card" style="padding:4px 14px">${slotHTML || `<p class="tiny muted" style="padding:8px 0">${T('Nessuno slot per questa data.')}</p>`}</div>
    ${quotaHTML}
    <div class="note">${T('Prenoti sempre tu, come titolare. Con <b>Apri ai soci</b> gli altri si uniscono fino a')} <b>${posti}</b> ${T('giocatori; con <b>Solo io</b> lo slot resta riservato. I campi sono gratuiti.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
// CHI GIOCA CON ME. "Solo io" chiude la fascia agli estranei, non vuol dire giocare da soli:
// i compagni vanno scritti, altrimenti al banco non si sa chi c'e' in campo e la Coppa non puo'
// assegnare i punti a chi ha giocato davvero.
// LE MIE SPESE. Tutto quello che il socio ha fatto in residence, con l'importo — e con lo ZERO
// dove non si paga. Lo zero e' il punto: la riga "Sport · 14 volte · gratis" e' quella che a
// fine stagione fa vedere quanto vale la quota. Un elenco di sole spese racconta meta' storia.
// Togliere un avviso letto. Una notifica che non si puo' archiviare smette di essere un
// avviso e diventa arredamento: resta li' finche' il socio non smette di guardare.
async function notificaVia(id) {
  try { await api('/auth/notifiche/' + id, { method: 'DELETE' }); }
  catch (e) { okThen(e.message, false); return; }
  openTessera();
}

// QUELLO CHE HAI PRENOTATO, in cima alla home. E' la prima domanda di chi apre l'app — "cosa
// ho oggi?" — e finora la risposta stava sparsa fra tre schermate: Campi, Fitness, Garden.
async function mostraMiePrenotazioni() {
  const box = $('#mieHome');
  if (!box || !state.tessera) return;
  let d;
  try { d = await api('/mie-prenotazioni?tessera_code=' + encodeURIComponent(state.tessera)); }
  catch { return; }
  if (!d.voci.length) { box.innerHTML = ''; return; }
  const ICO = { campo: '\ud83c\udfbe', garden: '\ud83c\udf7d\ufe0f', fitness: '\ud83e\uddd8', stage: '\ud83c\udfac', carta: '\ud83c\udfb2' };
  // Con tre prenotazioni si vedono tutte; con dieci l'elenco mangia la home e il resto sparisce
  // sotto. Oltre la soglia si mostrano le prime tre — quelle che vengono prima nel tempo, che
  // sono le uniche che servono adesso — e le altre stanno dietro un tocco.
  const SOGLIA = 3;
  const aperto = !!window.__mieAperte;
  const mostrate = aperto ? d.voci : d.voci.slice(0, SOGLIA);
  const nascoste = d.voci.length - mostrate.length;
  const riga = (v) => `<div class="riga">
      <div><b>${ICO[v.tipo] || ''} ${esc(v.titolo)}</b>
        <div class="q">${esc(v.quando)}${v.dettaglio ? ' \u00b7 ' + esc(v.dettaglio) : ''}${v.importo > 0 ? ' \u00b7 ' + eur(v.importo) : ''}</div></div>
      ${v.annulla ? `<button class="btn ghost sm" data-annullapren="${esc(v.annulla.rotta)}">${T('Annulla')}</button>` : ''}
    </div>`;
  box.innerHTML = `<div class="mie">
    <div class="lab">${d.voci.length === 1 ? T('La tua prenotazione') : T('Le tue prenotazioni')}${d.voci.length > 1 ? ` \u00b7 ${d.voci.length}` : ''}</div>
    ${mostrate.map(riga).join('')}
    ${nascoste > 0 || aperto ? `<button class="btn ghost block" style="margin-top:8px" data-mietutte>${
      aperto ? T('Mostra solo le prossime') : `${T('Vedi tutte')} (${d.voci.length})`}</button>` : ''}
  </div>`;
  const bt = box.querySelector('[data-mietutte]');
  if (bt) bt.onclick = () => { window.__mieAperte = !window.__mieAperte; mostraMiePrenotazioni(); };
  box.querySelectorAll('[data-annullapren]').forEach(b => b.onclick = async () => {
    if (!confirm(T('Annullare questa prenotazione?'))) return;
    try { await api(b.dataset.annullapren, { method: 'POST', body: JSON.stringify({ tessera_code: state.tessera }) }); }
    catch (e) { okThen(e.message, false); return; }
    mostraMiePrenotazioni();
  });
}

// Attivare o spegnere la gestione delle case: un gesto consapevole, non un effetto collaterale
// del tipo di profilo.
async function cambiaHost(attivo) {
  if (!attivo && !confirm(T('Disattivare la gestione delle case vacanza?'))) return;
  try { await api('/auth/host', { method: 'POST', body: JSON.stringify({ attivo }) }); }
  catch (e) { okThen(e.message, false); return; }
  // Il profilo si rilegge dal server: "is_host" decide cosa compare in home, e tenerlo in
  // memoria vecchio significherebbe mostrare o nascondere la sezione sbagliata. `refreshSocio`
  // esiste apposta e ridisegna anche la home.
  await refreshSocio(true);
  openTessera();
}

async function openSpese() {
  if (!state.tessera) { okThen(T('Serve la tessera per vedere le tue spese'), false); return; }
  let d;
  try { d = await api('/estratto-conto?tessera_code=' + encodeURIComponent(state.tessera)); }
  catch (e) { okThen(e.message, false); return; }
  const perServizio = (d.per_servizio || []).map(x => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)">
      <span>${esc(x.servizio)} <span class="muted">· ${x.volte} ${x.volte === 1 ? T('volta') : T('volte')}</span></span>
      <b>${x.speso > 0 ? eur(x.speso) : `<span style="color:#2e6b45">${T('compreso')}</span>`}</b></div>`).join('');
  const voci = (d.voci || []).slice(0, 40).map(v => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--line);font-size:.88rem">
      <div style="flex:1"><b>${esc(v.cosa)}</b><div class="ct">${esc(v.data)} · ${esc(v.servizio)}</div></div>
      <span>${v.importo > 0 ? eur(v.importo) : `<span class="muted">${T('gratis')}</span>`}</span></div>`).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('La tua tessera')}</div>
    <h2>${T('Le mie spese')}</h2>
    <p class="sub">${esc(d.socio.nome)} ${esc(d.socio.cognome)} · ${esc(d.socio.tessera)}</p>
    <div class="card" style="padding:10px 14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
        <span>${T('Totale speso')}</span><b style="font-size:1.3rem">${eur(d.totale)}</b></div>
      ${d.volte_gratis ? `<div class="muted" style="font-size:.84rem;margin-top:4px">${T('E')} <b>${d.volte_gratis}</b> ${d.volte_gratis === 1 ? T('volta in cui non hai pagato niente: è compreso.') : T('volte in cui non hai pagato niente: è compreso.')}</div>` : ''}
    </div>
    ${perServizio ? `<h3 style="margin:14px 0 4px">${T('Per servizio')}</h3><div class="card" style="padding:4px 14px">${perServizio}</div>` : ''}
    ${voci ? `<h3 style="margin:14px 0 4px">${T('Le ultime')}</h3><div class="card" style="padding:4px 14px">${voci}</div>` : `<p class="muted">${T('Ancora niente da mostrare.')}</p>`}
    <div class="note" style="margin-top:12px">${T('Qui c’è solo quello che hai fatto con la tessera: al Bar e al Garden si è serviti anche senza, e quelle consumazioni non compaiono.')}</div>
    <button class="btn ghost block" style="margin-top:10px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

async function openChiGioca(partitaId) {
  let d;
  try { d = await api('/partite/' + partitaId + '/giocatori'); } catch (e) { okThen(e.message, false); return; }
  const righe = d.giocatori.map((g, i) => `<div class="matchrow"><div style="flex:1"><b style="font-size:.92rem">${esc(g.nome)}</b><div class="ct">${i === 0 ? T('titolare') : (g.ospite ? T('ospite senza tessera') : T('socio'))}</div></div>${i === 0 ? '' : `<button class="btn ghost sm" data-giocvia="${partitaId}|${g.id}">✕</button>`}</div>`).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('Campo riservato')}</div>
    <h2>${T('Chi gioca con te')}</h2>
    <p class="sub">${esc(d.partita.data)} · ${esc(d.partita.slot)} — ${d.giocatori.length}/${d.partita.posti} ${T('giocatori')}</p>
    <div class="card" style="padding:4px 14px">${righe}</div>
    ${d.posti_liberi > 0 ? `<div class="field" style="margin-top:10px"><label>${T('Aggiungi un giocatore')}</label>
      <input id="gioc_v" placeholder="${T('Nome, oppure tessera BR-…')}">
      <button class="btn gold block" style="margin-top:8px" data-giocadd="${partitaId}">+ ${T('Aggiungi')}</button></div>`
      : `<div class="note" style="margin-top:10px">${T('Il campo è al completo.')}</div>`}
    <div class="note" style="margin-top:10px">${T('Un socio si aggiunge con la tessera e i punti della Coppa gli vengono conteggiati. Un ospite si aggiunge col nome: gioca lo stesso, ma resta scritto chi era in campo.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// Disdire il proprio campo. Prima non c'era modo: una prenotazione sbagliata restava li' e
// il campo era perso per tutti. Si chiede conferma perche' e' un gesto che manda a casa chi
// aveva gia' detto di si'.
async function campoDisdici(partitaId) {
  if (!confirm(T('Disdire questa prenotazione? Il campo torna libero e chi doveva giocare con te va avvisato.'))) return;
  try { await api('/partite/' + partitaId + '/annulla', { method: 'POST', body: JSON.stringify({ tessera_code: state.tessera }) }); }
  catch (e) { okThen(e.message, false); return; }
  closeOv();
  okThen(T('Prenotazione disdetta: il campo è tornato libero.'));
  if (state._campoSel) openCampi(state._campoSel);
}

async function giocatoreAggiungi(partitaId) {
  const v = (($('#gioc_v') || {}).value || '').trim();
  if (!v) { okThen(T('Scrivi il nome di chi gioca, oppure la sua tessera.'), false); return; }
  const corpo = /^(RB|BR)-/i.test(v) ? { giocatore_tessera: v.toUpperCase() } : { nome: v };
  try { await api('/partite/' + partitaId + '/giocatori', { method: 'POST', body: JSON.stringify({ tessera_code: state.tessera, ...corpo }) }); }
  catch (e) { okThen(e.message, false); return; }
  openChiGioca(partitaId);
}
async function giocatoreTogli(v) {
  const [partitaId, iscrittoId] = String(v).split('|');
  try { await api(`/partite/${partitaId}/giocatori/${iscrittoId}?tessera_code=${encodeURIComponent(state.tessera || '')}`, { method: 'DELETE' }); }
  catch (e) { okThen(e.message, false); return; }
  openChiGioca(partitaId);
}

async function openPartiteAperte() {
  let list = [];
  try { list = await api('/campi/partite-aperte'); } catch { okThen(T('Disponibile solo online'), false); return; }
  const rows = list.map(p => `<div class="matchrow"><div style="flex:1"><b style="font-size:.92rem">${sportIcon(p.sport)} ${esc(p.campo_nome)} · ${esc(p.slot)}</b><div class="ct">${esc(dataBella(p.data))} · ${p.iscritti}/${p.posti_totali}${p.livello ? ' · ' + esc(p.livello) : ''}${p.mancano ? ` · ${T(p.mancano > 1 ? 'mancano' : 'manca')} ${p.mancano}` : ''}</div>${p.numero_legale && !p.numero_legale.raggiunto ? `<div class="ct" style="color:#b14a35;font-weight:700">${T('Servono')} ${p.numero_legale.minimo} ${T('giocatori: ne mancano')} ${p.numero_legale.mancano} ${T('entro le')} ${esc(p.numero_legale.scade_alle)}</div>` : ''}</div><button class="btn gold sm" data-unisci="${p.id}">${T('Unisciti')}</button></div>`).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--plum)">${T('Gioca con gli altri')}</div><h2>👥 ${T('Partite aperte')}</h2>
    <p class="sub">${T('Unisciti a una partita con posti liberi: quando si completa, è fatta.')}</p>
    <div class="card" style="padding:4px 14px">${rows || `<p class="tiny muted" style="padding:8px 0">${T('Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!')}</p>`}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
function dataBella(iso) { try { const [y, m, d] = iso.split('-'); return `${d}/${m}`; } catch { return iso; } }
async function campoPrenota(v) { return campoCrea(v, false); }
async function campoApri(v) { return campoCrea(v, true); }
async function campoCrea(v, aperta) {
  const [id, slot] = v.split('|');
  if (!state.tessera) { okThen(T('Serve la tessera di un socio per prenotare'), false); return; }
  const n = Math.max(1, Number(state._campoFasce) || 1);
  const campo = (state.data.campi || []).find(c => c.id == id);
  const posti = campo ? campo.posti_default : 4;
  const quando = `${dataBella(state._campoData)} ${slot}${n > 1 ? ` (${n} ${T('fasce')})` : ''}`;
  const domanda = aperta
    ? `${T('Apri la partita di')} ${quando} ${T('con')} ${posti} ${T('posti? Gli altri soci potranno unirsi.')}`
    : `${T('Prenoti')} ${quando} ${T('solo per te? Nessun altro potrà unirsi.')}`;
  if (!confirm(domanda)) return;
  const rotta = aperta ? '/partita' : '/prenota';
  try {
    const r = await fetch(API_BASE + '/api/campi/' + id + rotta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: state._campoData, slot, n_slot: n }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { okThen(j.error || T('Prenotazione non riuscita'), false); return; }
        // "Fatto!" da solo non basta se la prenotazione vive dieci minuti: il server dice quando
    // e' cosi', e lo si scrive qui, non dopo che il campo e' gia' tornato libero.
    okThen(`${aperta ? T('Partita aperta') : T('Campo prenotato')} \u00b7 ${quando}` + (j.avviso ? `\n\n\u26a0\ufe0f ${j.avviso}` : ''));
  } catch { okThen(T('Errore di rete'), false); return; }
  openCampi(id);
}
async function campoUnisci(pid) {
  try { const r = await fetch(API_BASE + '/api/partite-aperte/' + pid + '/unisciti', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { okThen(j.error || T('Non riuscito'), false); return; } okThen(j.completa ? T('Partita al completo, ci vediamo in campo! 🎾') : `${T('Iscritto!')} ${j.iscritti}/${j.posti_totali}`); } catch { okThen(T('Errore di rete'), false); return; }
  if (state._campoSel) openCampi(state._campoSel); else openPartiteAperte();
}


// ---- Serate speciali: quelle su prenotazione, con posti contati ----
// Erano finite in fondo agli Eventi e di fatto sparivano. Dalla home ci si arriva con un tasto.
function openSerateSpeciali() {
  const list = state.data.serate || [];
  if (!list.length) { okThen(T('Nessuna serata su prenotazione al momento.'), false); return; }
  const riga = (s) => `<div class="matchrow"><div style="flex:1">
      <b style="font-size:.92rem">${esc(s.titolo)}</b>
      <div class="ct">${esc(s.quando || '')} · € ${esc(String(s.quota))} ${T('a persona')}${s.posti_liberi != null ? ` · ${s.posti_liberi} ${T('posti liberi')}` : ''}</div>
      ${s.descrizione ? `<div class="ct">${esc(s.descrizione)}</div>` : ''}</div>
    ${minorenne() ? '' : `<button class="btn gold sm" data-serata="${s.id}">${T('Prenota')}</button>`}</div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">${T('Su prenotazione')}</div>
    <h2>${T('Le serate speciali')}</h2>
    ${minorenne() ? `<p class="sub">${T('Fino ai 18 anni le prenota un adulto per te.')}</p>` : ''}
    <div class="card" style="padding:4px 14px">${list.map(riga).join('')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}



// La mappa si apre a tutto foglio con il codice di Google (senza chiavi), non dentro l'elenco:
// l'anteprima delle voci resta compatta com'era.
const MAPPE = {};
function openMappa(nome) {
  const v = MAPPE[nome] || {};
  // Se il gestore ha incollato il codice di Google, la mappa e' esattamente quella che ha
  // inquadrato lui; altrimenti si ricava dalle coordinate.
  const src = v.mappa_embed
    ? v.mappa_embed
    : `https://maps.google.com/maps?q=${encodeURIComponent(v.lat + ',' + v.lng)}&z=16&hl=it&output=embed`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('Dove si trova')}</div>
    <h2>${esc(nome || '')}</h2>
    ${v.dettaglio ? `<p class="sub">${esc(v.dettaglio)}${v.distanza ? ' · ' + esc(v.distanza) : ''}</p>` : ''}
    <div class="mapbox"><iframe title="${esc(nome || '')}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(src)}"></iframe></div>
    ${v.lat != null ? `<a class="btn navy block" style="margin-top:10px" href="https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}" target="_blank" rel="noopener">🧭 ${T('Portami lì')}</a>` : ''}
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}


// Cena in modo semplice: nessuna scelta da fare. Stasera, tavolo da quattro, il turno con
// posto — e una sola conferma. Chi vuole decidere passa alla versione completa.
async function openCenaSubito() {
  const oggi = new Date().toISOString().slice(0, 10);
  const persone = 4;
  let turni = [];
  try { turni = (await api(`/garden/turni?data=${oggi}`)).turni || []; } catch { }
  const scelto = turni.find(t => t.posti_liberi >= persone) || turni[0];
  if (!scelto) { okThen(T('Stasera il Garden non prende prenotazioni.'), false); return; }
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${T('Cena')}</div>
    <h2>${T('Stasera alle')} ${esc(scelto.turno)}</h2>
    <p class="sub">${T('Tavolo per 4 persone')} · ${esc(dataBella(oggi))}</p>
    <div class="note">${T('Il tavolo lo assegniamo noi. Se siete di più o di meno, lo dite al personale.')}</div>
    <button class="btn gold block" style="margin-top:12px;font-size:1.1rem;padding:16px" id="cs_ok">${T('Confermo')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Annulla')}</button>
    <div id="cs_msg" class="muted" style="font-size:.85rem;margin-top:8px"></div>`);
  showOv();
  $('#cs_ok').onclick = async () => {
    try {
      const r = await fetch(API_BASE + '/api/garden/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: oggi, turno: scelto.turno, persone }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { $('#cs_msg').textContent = j.error || T('Prenotazione non riuscita'); return; }
      setSheet(`<div class="grab"></div><h2>${T('È fatta')}</h2>
        <p class="sub">${T('Stasera alle')} <b>${esc(scelto.turno)}</b> · ${T('tavolo')} <b>${j.tavoli.join(', ')}</b> · 4 ${T('persone')}</p>
        ${j.stage && j.stage.posti ? `<div class="note">🎭 ${T('Hai anche')} ${j.stage.posti.length} ${T('posti davanti al palco')}</div>` : ''}
        <button class="btn gold block" style="margin-top:12px" data-close>${T('Ho capito')}</button>`);
    } catch { $('#cs_msg').textContent = T('Errore di rete'); }
  };
}


// ---- Chat di casata ------------------------------------------------------------------------
// Serve a dire "sabato ci sono", "cerco un sostituto", "proviamo con quella formazione".
// Solo testo. E la prima cosa che si legge entrando e' che non e' una stanza privata: e'
// piu' onesto dirlo che lasciarlo scoprire.
async function openChat(ambito) {
  if (!state.token) { okThen(T('Serve l\'accesso con la tessera'), false); return; }
  state._chatAmbito = ambito || state._chatAmbito || 'casata';
  let d;
  try { d = await api('/auth/chat/' + state._chatAmbito, { auth: true }); }
  catch (e) { okThen(e.message || T('Chat non disponibile'), false); return; }

  const riga = (m) => {
    const mio = m.tessera_code === d.io;
    return `<div class="msg${mio ? ' mio' : ''}">
      ${mio ? '' : `<b>${esc(m.nome)}</b>`}
      <p>${esc(m.testo)}</p>
      <span class="ora">${esc(String(m.created_at || '').slice(11, 16))}${m.segnalato ? ' · ' + T('segnalato') : ''}</span>
      ${mio ? '' : `<button class="segn" data-chat-segnala="${m.id}" title="${T('Segnala')}">⚑</button>`}
    </div>`;
  };
  setSheet(`<div class="grab"></div>
    <div class="eyebrow" style="color:${esc(d.colore || 'var(--teal)')}">${d.ambito === 'capitani' ? '🎖️ ' + T('Capitani') : '🛡️ ' + esc(d.casata || '')}</div>
    <h2>${d.ambito === 'capitani' ? T('Gruppo capitani') : T('La chat della casata')}</h2>
    <div class="note" style="margin-top:0">${esc(d.avviso)}</div>
    ${d.capitano ? `<div class="chips" style="margin:10px 0">
      <button class="chip${d.ambito === 'casata' ? ' sel' : ''}" data-chat="casata">${T('La mia casata')}</button>
      <button class="chip${d.ambito === 'capitani' ? ' sel' : ''}" data-chat="capitani">${T('Capitani')}</button></div>` : ''}
    <div class="chatbox" id="chatbox">${(d.messaggi || []).map(riga).join('') || `<p class="tiny muted" style="text-align:center;padding:18px">${T('Nessun messaggio. Comincia tu.')}</p>`}</div>
    <div class="chatinvio">
      <input id="chat_txt" maxlength="500" placeholder="${T('Scrivi qui…')}" autocomplete="off">
      <button class="btn gold sm" id="chat_send">${T('Invia')}</button>
    </div>
    <div id="chat_msg" class="tiny muted" style="margin-top:6px"></div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
  const box = $('#chatbox'); if (box) box.scrollTop = box.scrollHeight;
  const invia = async () => {
    const t = ($('#chat_txt').value || '').trim();
    if (!t) return;
    try {
      await api('/auth/chat/' + state._chatAmbito, { auth: true, method: 'POST', body: JSON.stringify({ testo: t }) });
      $('#chat_txt').value = '';
      openChat(state._chatAmbito);
    } catch (e) { $('#chat_msg').textContent = e.message; }
  };
  $('#chat_send').onclick = invia;
  $('#chat_txt').onkeydown = (e) => { if (e.key === 'Enter') invia(); };
}
async function chatSegnala(id) {
  if (!confirm(T('Segnalare questo messaggio al gestore? Verrà letto da lui.'))) return;
  const motivo = prompt(T('Perché lo segnali? (facoltativo)')) || '';
  try { await api('/auth/chat/messaggi/' + id + '/segnala', { auth: true, method: 'POST', body: JSON.stringify({ motivo }) }); }
  catch (e) { }
  openChat(state._chatAmbito);
}

// ---- Numeri rapidi --------------------------------------------------------------------
// Non e' un servizio di soccorso e non lo chiamiamo cosi'. Sono tre tasti grandi al posto di
// una rubrica: il 112, un familiare, il chiosco. La telefonata la fa il telefono.
//
// L'unica cosa che aggiungiamo e' la POSIZIONE da leggere all'operatore del 112: chi e' in
// difficolta' spesso non sa dire dove si trova, e nel residence tutte le ville si somigliano.
// Resta sul telefono, non viene inviata a nessuno, e se non si ottiene non cambia niente.
async function openAiuto() {
  let n = { emergenza: '112', residence: null };
  try { n = await api('/aiuto/numeri'); } catch { }
  const fam = state.socio?.emergenza_tel;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:#b14a35">${T('Numeri rapidi')}</div>
    <h2>${T('Chi vuoi chiamare')}</h2>
    <a class="btn sos block" href="tel:112">📞 ${T('112 · emergenze')}</a>
    ${fam ? `<a class="btn navy block" style="margin-top:10px" href="tel:${esc(fam)}">📞 ${esc(state.socio.emergenza_nome || T('Il mio contatto'))}</a>` : ''}
    <button class="btn ghost block" style="margin-top:14px" id="aiuto_dove">📍 ${T('Dove mi trovo')}</button>
    <div id="aiuto_esito" class="note" style="margin-top:10px">${T('Il 112 è il numero unico delle emergenze. Il residence non è un servizio di soccorso: qui ci sono solo i numeri che rispondono davvero, a portata di dito.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
  const box = $('#aiuto_esito');
  $('#aiuto_dove').onclick = () => {
    if (!navigator.geolocation) { box.textContent = T('Il telefono non sa dirmi dove sei.'); return; }
    box.textContent = T('Cerco la posizione…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = pos.coords;
      box.innerHTML = `<b>${T('Leggi questi numeri all\'operatore')}:</b>
        <div style="font-size:1.25rem;font-weight:800;letter-spacing:.02em;margin:6px 0">${c.latitude.toFixed(5)} , ${c.longitude.toFixed(5)}</div>
        <span class="tiny">${T('Precisione')} ±${Math.round(c.accuracy)} m · ${T('la posizione resta sul tuo telefono, non viene inviata a nessuno')}</span>`;
    }, () => { box.textContent = T('Non riesco a ottenere la posizione. Di\' all\'operatore il nome del residence e il numero della villa.'); },
      { enableHighAccuracy: true, timeout: 10000 });
  };
}

// ---- Coworking: postazioni della sala, non tavoli da gioco ----
// Prima questa tessera apriva la vecchia "risorsa" coworking, un sistema a parte: la
// prenotazione non compariva nella sala, il contatore non si muoveva e il socio non
// ritrovava piu' quello che aveva prenotato. Ora e' la stessa sala, con i suoi turni.
async function openCowo() {
  const giorni = gardenGiorni();
  if (!state._cowoData || !giorni.some(d => d.iso === state._cowoData)) state._cowoData = giorni[0].iso;
  const data = state._cowoData;
  let d;
  try { d = await api(`/carta/turni?data=${data}`); } catch { okThen(T('Sala non disponibile'), false); return; }
  const turni = (d.turni || []).filter(t => t.scopo === 'coworking');
  let mie = [];
  if (state.tessera) { try { mie = (await api('/carta/mie-prenotazioni?tessera_code=' + encodeURIComponent(state.tessera))).filter(m => m.scopo === 'coworking'); } catch { } }
  const persone = state._cowoPers || 1;      // una postazione, una persona
  const dayChips = giorni.map(x => `<button class="chip${x.iso === data ? ' sel' : ''}" data-cowo-date="${x.iso}">${esc(x.label)}</button>`).join('');
  const riga = (t) => {
    const pieno = t.posti_liberi <= 0;
    return `<div class="matchrow"><div style="flex:1">
        <b style="font-size:.92rem">💻 ${esc(t.etichetta || t.turno)}</b>
        <div class="ct">${pieno ? T('nessuna postazione libera') : `${t.posti_liberi} ${T('postazioni libere')} ${T('su')} ${t.posti_totali}`}</div></div>
      ${pieno ? `<span class="tag" style="background:#eee;color:#888;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">${T('AL COMPLETO')}</span>`
              : `<button class="btn gold sm" data-cowo-pren="${esc(t.turno)}">${T('Prenota')}</button>`}</div>`;
  };
  const mieHTML = mie.length ? `<div class="sect-title" style="margin-top:10px">${T('Le mie postazioni')}</div>
    <div class="card" style="padding:4px 14px">${mie.map(m => `<div class="matchrow"><div style="flex:1"><b style="font-size:.88rem">${esc(dataBella(m.data))} · ${esc(m.turno)}</b><div class="ct">${m.persone} ${m.persone === 1 ? T('postazione') : T('postazioni')} · ${T('tavolo')} ${m.tavoli.join(', ')}</div></div><button class="btn ghost sm" data-cowo-ann="${m.id}">${T('Annulla')}</button></div>`).join('')}</div>`
    : `<div class="note" style="margin-top:10px">${T('Non hai postazioni prenotate.')}</div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">💻 ${T('Coworking')}</div>
    <h2>${T('La tua postazione')}</h2>
    <div class="field"><label>${T('Giorno')}</label><div class="chips">${dayChips}</div></div>
    <div class="field"><label>${T('Quante postazioni')}</label><div class="chips">${[1, 2, 3, 4, 6, 8].map(n => `<button class="chip${n === persone ? ' sel' : ''}" data-cowo-pers="${n}">${n}</button>`).join('')}</div>
      <p class="tiny muted" style="margin-top:4px">${T('Per una riunione puoi prendere tutta la sala: scegli il numero di postazioni che ti serve.')}</p></div>
    <div class="sect-title" style="margin-top:6px">${T('Turni')}</div>
    <div class="card" style="padding:4px 14px">${turni.map(riga).join('') || `<p class="tiny muted" style="padding:8px 0">${T('Nessun turno di coworking.')}</p>`}</div>
    ${mieHTML}
    <div class="note">${T('Si occupa una sedia, non un tavolo: si lavora anche in una sala condivisa.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
async function cowoPrenota(turno) {
  if (!state.tessera) { okThen(T('Serve la tessera di un socio per prenotare'), false); return; }
  try {
    const r = await fetch(API_BASE + '/api/carta/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: state._cowoData, turno, persone: state._cowoPers || 1 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { okThen(j.error || T('Prenotazione non riuscita'), false); return; }
    okThen(`${T('Postazione al tavolo')} ${j.tavoli.join(', ')} · ${dataBella(state._cowoData)} ${turno}`);
  } catch { okThen(T('Errore di rete'), false); return; }
  openCowo();
}

// ---- Lezioni di fitness ----
// Un elenco di ottanta lezioni una sotto l'altra costringeva a scorrere per trovare
// l'incastro giorno-ora. Qui c'e' la stessa griglia settimanale del back office: sette
// colonne, la fascia oraria fissa dai parametri, e il colore della disciplina — che su
// trentacinque caselle si riconosce prima del testo.
async function openFitness() {
  let d;
  try { d = await api('/fitness'); } catch { okThen(T('Lezioni non disponibili'), false); return; }
  const lez = d.lezioni || [];
  if (!lez.length) { okThen(T('Nessuna lezione in programma.'), false); return; }
  let mie = [];
  if (state.tessera) { try { mie = await api('/fitness/mie-iscrizioni?tessera_code=' + encodeURIComponent(state.tessera)); } catch { } }
  const iscritto = new Set(mie.map(m => m.corso_nome + '|' + m.data + '|' + m.ora));
  FIT_MIE = mie;
  FIT_DISDETTA = Number(d.disdetta_minuti ?? 30);

  // settimane disponibili, come nel back office
  const lunediDi = (iso) => { const dd = new Date(iso + 'T12:00:00Z'); dd.setUTCDate(dd.getUTCDate() - ((dd.getUTCDay() + 6) % 7)); return dd.toISOString().slice(0, 10); };
  const settimane = [...new Set(lez.map(l => lunediDi(l.data)))].sort();
  if (!state._fitSett || !settimane.includes(state._fitSett)) state._fitSett = settimane[0];
  const sett = state._fitSett;
  const giorni = Array.from({ length: 7 }, (_, i) => new Date(new Date(sett + 'T12:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10));

  const oraNum = (o) => Number(String(o || '').slice(0, 2)) || 0;
  const daPar = oraNum(d.griglia_da || '16:00'), aPar = oraNum(d.griglia_a || '20:00');
  const diQuesta = lez.filter(l => giorni.includes(l.data));
  const ore = diQuesta.map(l => oraNum(l.ora));
  const primo = Math.min(daPar, ...(ore.length ? ore : [daPar]));
  const ultimo = Math.max(aPar, ...(ore.length ? ore : [aPar]));
  const righeOre = Array.from({ length: Math.max(1, ultimo - primo + 1) }, (_, i) => String(primo + i).padStart(2, '0') + ':00');

  const perCella = {};
  for (const l of diQuesta) (perCella[l.data + '|' + String(l.ora).slice(0, 2) + ':00'] ??= []).push(l);
  FIT_LEZ = {}; for (const l of lez) FIT_LEZ[l.id] = l;

  const GG = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  const cella = (g, o) => {
    const list = perCella[g + '|' + o] || [];
    if (!list.length) return '<td class="fitv"></td>';
    return `<td class="fitv">${list.map(l => {
      const gia = iscritto.has(l.corso_nome + '|' + l.data + '|' + l.ora);
      const stato = l.completa ? 'pieno' : gia ? 'mio' : l.confermata ? 'ok' : 'attesa';
      return `<button class="fitq ${stato}" style="background:${esc(l.colore || '#2f6d8a')}" data-fitapri="${l.id}" title="${esc(l.corso_nome)} ${esc(l.ora)}">
        <b>${esc((l.titolo || l.corso_nome).slice(0, 9))}</b><span>${esc(l.ora)}</span></button>`;
    }).join('')}</td>`;
  };
  const chipSett = settimane.map(w => `<button class="chip${w === sett ? ' sel' : ''}" data-fitsett="${w}">${w.slice(8)}/${w.slice(5, 7)}</button>`).join('');
  const mieHTML = mie.length ? `<div class="sect-title" style="margin-top:12px">${T('Le mie lezioni')}</div>
    <div class="card" style="padding:4px 14px">${mie.map(m => `<div class="matchrow"><div style="flex:1"><b style="font-size:.88rem">${esc(m.corso_nome)}</b><div class="ct">${esc(dataBella(m.data))} · ${esc(m.ora)}</div></div></div>`).join('')}</div>` : '';

  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">🧘 ${T('Area fitness')}</div>
    <h2>${T('Lezioni con istruttore')}</h2>
    <div class="chips" style="margin-bottom:8px">${chipSett}</div>
    <table class="fitgrid"><thead><tr><th></th>${giorni.map((g, i) => `<th>${GG[i]}<span>${g.slice(8)}</span></th>`).join('')}</tr></thead>
      <tbody>${righeOre.map(o => `<tr><th class="ora">${o.slice(0, 2)}</th>${giorni.map(g => cella(g, o)).join('')}</tr>`).join('')}</tbody></table>
    <p class="tiny muted" style="margin-top:6px">${T('Tocca una lezione per iscriverti. Il colore è la disciplina.')}</p>
    ${mieHTML}
    <div class="note">${T('Si paga la singola lezione, in contanti a fine lezione. Sotto il minimo di iscritti la lezione non parte.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// Dettaglio della lezione toccata: prima di iscriversi si vede cosa si sta prenotando.
var FIT_LEZ = {};
var FIT_MIE = [];      // le mie iscrizioni: servono a sapere se posso disdire
var FIT_DISDETTA = 30; // margine di disdetta, dal back office
function openLezione(id) {
  const l = FIT_LEZ[id];
  if (!l) return;
  // La mia iscrizione a QUESTA lezione, se c'e': senza il suo id non si puo' disdire.
  const mia = FIT_MIE.find((m) => m.corso_nome === l.corso_nome && m.data === l.data && m.ora === l.ora);
  const mioId = mia ? mia.id : null;
  const d = { disdetta_minuti: FIT_DISDETTA };
  const manca = l.minimo && !l.confermata;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:${esc(l.colore || 'var(--teal)')}">${esc(l.corso_nome)}</div>
    <h2>${esc(l.titolo || l.corso_nome)}${l.masterclass ? ' 🌟' : ''}</h2>
    <p class="sub">${esc(dataBella(l.data))} · <b>${esc(l.ora)}</b> · ${l.durata_min}′${l.istruttore ? ' · ' + esc(l.istruttore) : ''}</p>
    <div class="card" style="padding:12px 14px">
      <div class="matchrow"><span style="flex:1">${T('Posti')}</span><b>${l.iscritti}/${l.posti_max}</b></div>
      <div class="matchrow"><span style="flex:1">${T('Prezzo')}</span><b>€ ${Number(l.prezzo).toFixed(2)}</b></div>
      ${manca ? `<div class="matchrow"><span style="flex:1">${T('Per confermare la lezione')}</span><b>${T('mancano')} ${l.mancano}</b></div>` : ''}
    </div>
    ${l.completa
      ? `<div class="note">${T('Lezione al completo.')}</div>`
      : `<button class="btn gold block" style="margin-top:12px" data-fitpren="${l.id}">${T('Iscriviti')}</button>`}
    ${mioId ? `<button class="btn ghost block" style="margin-top:8px;color:#b14a35" data-fitdisd="${mioId}">${T('Disdici')}</button>` : ''}
    ${d.disdetta_minuti > 0 ? `<div class="note" style="margin-top:10px">${T('Si disdice senza pagare fino a')} <b>${d.disdetta_minuti} ${T('minuti prima')}</b>. ${T('Dopo, la lezione resta dovuta: l’istruttore è già arrivato e il posto non si rivende.')}</div>` : ''}
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// Disdire una lezione. Fino al margine non si paga; dopo, la lezione resta dovuta — e lo si
// dice PRIMA di annullare, non dopo.
async function fitnessDisdici(idIscrizione) {
  const tardi = `${T('Attenzione: mancano meno di')} ${FIT_DISDETTA} ${T('minuti all’inizio, quindi la lezione resta dovuta anche se disdici. Procedo?')}`;
  const normale = T('Disdire l’iscrizione a questa lezione?');
  const l = Object.values(FIT_LEZ).find((x) => (FIT_MIE.find((m) => String(m.id) === String(idIscrizione)) || {}).data === x.data);
  const minutiMancanti = l ? (new Date(l.data + 'T' + l.ora + ':00') - new Date()) / 60000 : 9999;
  if (!confirm(minutiMancanti <= FIT_DISDETTA ? tardi : normale)) return;
  let j;
  try {
    const r = await fetch(API_BASE + '/api/fitness/iscrizioni/' + idIscrizione + '/annulla', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tessera_code: state.tessera })
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok) { okThen(j.error || T('Disdetta non riuscita'), false); return; }
  } catch { okThen(T('Errore di rete'), false); return; }
  closeOv();
  okThen(j.messaggio || T('Iscrizione annullata'));
  openFitness();
}

async function fitnessIscrivi(id) {
  if (!state.tessera) { okThen(T('Serve la tessera di un socio per iscriverti'), false); return; }
  try {
    const r = await fetch(API_BASE + '/api/fitness/sedute/' + id + '/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { okThen(j.error || T('Iscrizione non riuscita'), false); return; }
    okThen(j.confermata ? T('Iscrizione confermata') : `${T('Iscritto')} · ${T('mancano')} ${j.mancano} ${T('per confermare la lezione')}`);
  } catch { okThen(T('Errore di rete'), false); return; }
  openFitness();
}

// ---- Tavolo da gioco alla Casa di Carta ----
async function openCarta() {
  const giorni = gardenGiorni();
  if (!state._cartaData || !giorni.some(d => d.iso === state._cartaData)) state._cartaData = giorni[0].iso;
  const data = state._cartaData;
  let d;
  try { d = await api(`/carta/turni?data=${data}`); } catch { okThen(T('Sala non disponibile'), false); return; }
  let mie = [];
  if (state.tessera) { try { mie = await api('/carta/mie-prenotazioni?tessera_code=' + encodeURIComponent(state.tessera)); } catch { } }
  const persone = state._cartaPers || 2;
  const dayChips = giorni.map(x => `<button class="chip${x.iso === data ? ' sel' : ''}" data-carta-date="${x.iso}">${esc(x.label)}</button>`).join('');
  const riga = (t) => {
    const pieno = t.tavoli_liberi <= 0;
    return `<div class="matchrow"><div style="flex:1">
        <b style="font-size:.92rem">${t.scopo === 'coworking' ? '💻' : '🎲'} ${esc(t.etichetta || t.turno)}</b>
        <div class="ct">${pieno ? T('nessun tavolo libero') : `${t.tavoli_liberi} ${T('tavoli liberi')} · ${t.posti_liberi} ${T('posti')}`}</div></div>
      ${pieno ? `<span class="tag" style="background:#eee;color:#888;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">${T('AL COMPLETO')}</span>`
              : `<button class="btn gold sm" data-carta-pren="${esc(t.turno)}">${T('Prenota')}</button>`}</div>`;
  };
  const mieHTML = mie.length ? `<div class="sect-title" style="margin-top:10px">${T('Le mie prenotazioni')}</div>
    <div class="card" style="padding:4px 14px">${mie.map(m => `<div class="matchrow"><div style="flex:1"><b style="font-size:.88rem">${esc(dataBella(m.data))} · ${esc(m.turno)}</b><div class="ct">${m.persone} ${T('persone')} · ${T('tavolo')} ${m.tavoli.join(', ')}${m.gioco ? ' · ' + esc(m.gioco) : ''}</div></div><button class="btn ghost sm" data-carta-ann="${m.id}">${T('Annulla')}</button></div>`).join('')}</div>` : '';
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:#7a5c2e">🎲 ${T('Casa di Carta')}</div>
    <h2>${T('Tavolo da gioco')}</h2>
    <div class="field"><label>${T('Giorno')}</label><div class="chips">${dayChips}</div></div>
    <div class="field"><label>${T('Quante persone')}</label><div class="chips">${[2, 3, 4, 5, 6].map(n => `<button class="chip${n === persone ? ' sel' : ''}" data-carta-pers="${n}">${n}</button>`).join('')}</div></div>
    <div class="sect-title" style="margin-top:6px">${T('Turni')}</div>
    <div class="card" style="padding:4px 14px">${(d.turni || []).filter(t => t.scopo !== 'coworking').map(riga).join('')}</div>
    ${mieHTML}
    <div class="note">${d.minimo ? `${T('Al tavolo servono almeno')} ${d.minimo} ${T('giocatori: da soli non si occupa un tavolo.')}` : T('Il tavolo si prenota a turni.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
async function cartaPrenota(turno) {
  if (!state.tessera) { okThen(T('Serve la tessera di un socio per prenotare'), false); return; }
  try {
    const r = await fetch(API_BASE + '/api/carta/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: state._cartaData, turno, persone: state._cartaPers || 2 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { okThen(j.error || T('Prenotazione non riuscita'), false); return; }
    okThen(`${T('Tavolo')} ${j.tavoli.join(', ')} · ${dataBella(state._cartaData)} ${turno}`);
  } catch { okThen(T('Errore di rete'), false); return; }
  openCarta();
}

// ---- Posto allo Stage (cinema e spettacoli) ----
async function openStage() {
  let d;
  try { d = await api('/cinema'); state._cinema = d; } catch { okThen(T('Programma non disponibile'), false); return; }
  const pr = d.prossime || [];
  if (!pr.length) { okThen(T('Nessuno spettacolo in programma.'), false); return; }
  let mie = [];
  if (state.tessera) { try { mie = await api('/cinema/mie-prenotazioni?tessera_code=' + encodeURIComponent(state.tessera)); } catch { } }
  const riga = (p) => {
    const pieno = p.posti_liberi <= 0;
    return `<div class="matchrow"><div style="flex:1">
        <b style="font-size:.92rem">${esc(p.titolo || T('Spettacolo'))}</b>
        <div class="ct">${esc(dataBella(p.data))} · ${esc(p.ora)}${p.regia ? ' · ' + esc(p.regia) : ''}${p.durata_min ? " · " + p.durata_min + "'" : ''}</div>
        <div class="ct">${pieno ? T('al completo') : `${p.posti_liberi} ${T('posti liberi')}${p.solo_extra ? ' · ' + T('restano solo i posti in fondo') : ''}`}</div></div>
      ${pieno || !d.prenotabile ? '' : `<button class="btn gold sm" data-stagepren="${p.id}">${T('Prenota')}</button>`}</div>`;
  };
  const mieHTML = mie.length ? `<div class="sect-title" style="margin-top:10px">${T('I miei posti')}</div>
    <div class="card" style="padding:4px 14px">${mie.map(m => `<div class="matchrow"><div style="flex:1"><b style="font-size:.88rem">${esc(m.titolo || T('Spettacolo'))}</b><div class="ct">${esc(dataBella(m.data))} · ${esc(m.turno)} · ${T('posti')} ${m.posti.join(', ')}</div></div></div>`).join('')}</div>` : '';
  const over70 = Number(state.socio?.eta || 0) >= 70 && Number(d.prima_fila_over70 || 0) > 0;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:#5f5188">🎬 ${T('Bussola Stage')}</div>
    <h2>${T('Il tuo posto')}</h2>
    ${over70 ? `<div class="note" style="border-left-color:#7a5c2e"><b>${T('Hai diritto alla prima fila')}</b> — ${T('la teniamo per chi ha più di 70 anni, fino a esaurimento. Te la assegniamo da soli.')}</div>` : ''}
    <div class="card" style="padding:4px 14px">${pr.map(riga).join('')}</div>
    ${mieHTML}
    ${(d.film || []).length ? `<button class="btn navy block" style="margin-top:12px" data-rassegna="1">🎞️ ${T('Rassegna cinematografica')} · ${d.film.length} ${T('film')}</button>` : ''}
    <div class="note">${esc(d.nota_contributo || '')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// La rassegna e' l'elenco dei film che il residence propone per la stagione: le serate si
// decidono dopo, e non tutti i film hanno gia' una data. Vale la pena mostrarla comunque —
// e poterla portare via, perche' e' la cosa che si guarda decidendo come passare la settimana.
async function openRassegna() {
  let d;
  try { d = await api('/cinema'); state._cinema = d; } catch { okThen(T('Rassegna non disponibile'), false); return; }
  const film = d.film || [];
  const scheda = (f) => `<div class="matchrow" style="align-items:flex-start">
      <div style="flex:1">
        <b style="font-size:.95rem">${esc(f.titolo)}</b>
        <div class="ct">${[f.regia ? T('di') + ' ' + esc(f.regia) : '', f.anno || '', f.durata_min ? f.durata_min + "'" : '', esc(f.genere || ''), esc(f.vm || '')].filter(Boolean).join(' · ')}</div>
        ${f.sinossi ? `<div class="ct" style="margin-top:4px">${esc(f.sinossi)}</div>` : ''}
      </div></div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:#5f5188">🎞️ ${T('Bussola Stage')}</div>
    <h2>${T('Rassegna cinematografica')}</h2>
    <p class="sub">${T('I film che proponiamo per la stagione.')}</p>
    <div class="card" style="padding:4px 14px;max-height:52vh;overflow:auto">${film.map(scheda).join('') || `<p class="tiny muted" style="padding:12px 0">${T('Rassegna non ancora pubblicata.')}</p>`}</div>
    <div class="note">${T('Le date non sono indicate: una serata speciale o il maltempo possono spostare una proiezione. Il giorno esatto lo trovi in <b>Stage</b>, dove si prenota il posto.')}</div>
    <button class="btn navy block" style="margin-top:10px" data-rassegnastampa="1">🖨️ ${T('Salva o stampa la rassegna')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// "Scaricare" su un telefono vuol dire aprire una pagina pulita e usare Stampa → Salva come
// PDF: funziona su Android e iPhone senza chiedere permessi ne' installare niente.
function stampaRassegna() {
  const d = state._cinema || {};
  const film = d.film || [];
  const w = window.open('', '_blank');
  if (!w) { okThen(T('Consenti le finestre per salvare la rassegna.'), false); return; }
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8">
    <title>${T('Rassegna')} · Bussola Residence</title>
    <style>
      body{font-family:Georgia,serif;color:#12324f;margin:26px;max-width:760px}
      h1{font-size:26px;margin:0 0 2px} .sub{color:#6b7f8f;font-size:13px;margin-bottom:18px;font-family:system-ui,sans-serif}
      article{border-top:1px solid #dfe6ec;padding:12px 0}
      h2{font-size:17px;margin:0 0 3px} .meta{color:#6b7f8f;font-size:12px;font-family:system-ui,sans-serif}
      p{font-size:13px;line-height:1.45;margin:6px 0 4px}
      .data{font-family:system-ui,sans-serif;font-size:12px;font-weight:700;color:#2e6b45}
      @media print{body{margin:12mm}}
    </style></head><body>
    <h1>Bussola Stage — ${T('la rassegna')}</h1>
    <div class="sub">${T('I film della stagione. Le date delle proiezioni si trovano nell\'app, sezione Stage: possono cambiare.')}</div>
    ${film.map(f => `<article><h2>${esc(f.titolo)}</h2>
      <div class="meta">${[f.regia ? 'di ' + esc(f.regia) : '', f.anno || '', f.durata_min ? f.durata_min + "'" : '', esc(f.genere || ''), esc(f.vm || '')].filter(Boolean).join(' · ')}</div>
      ${f.sinossi ? `<p>${esc(f.sinossi)}</p>` : ''}</article>`).join('')}
    </body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch (e) { } }, 400);
}
async function stagePrenota(id) {
  if (!state.tessera) { okThen(T('Serve la tessera di un socio per prenotare'), false); return; }
  const n = Number(prompt(T('Quante persone?'), '2')) || 0;
  if (n < 1) return;
  try {
    const r = await fetch(API_BASE + '/api/cinema/' + id + '/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, persone: n }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { okThen(j.error || T('Prenotazione non riuscita'), false); return; }
    okThen(`${T('Posti')} ${j.posti.join(', ')}`);
  } catch { okThen(T('Errore di rete'), false); return; }
  openStage();
}

// ---- Appartenenti a una casata (con il capitano in evidenza) ----
async function openCasataMembri(id) {
  let d;
  try { d = await api('/casate/' + id + '/appartenenti'); }
  catch { okThen(T('Elenco non disponibile'), false); return; }
  const mio = state.socio && state.socio.casata === d.casata.nome;
  const riga = (m) => `<div class="matchrow"><div style="flex:1">
      <b style="font-size:.88rem">${m.capitano ? '⭐ ' : ''}${esc(m.nome)}</b>
      <div class="ct">${esc(m.ruolo)}</div></div>
    ${m.capitano ? `<span class="tag" style="background:#f4ead6;color:#8a5a12;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">${T('CAPITANO')}</span>` : ''}</div>`;
  setSheet(`<div class="grab"></div>
    <div class="eyebrow" style="color:${d.casata.colore}">${T('Casata')}${mio ? ' · ' + T('la tua') : ''}</div>
    <h2>${esc(d.casata.nome)}</h2>
    <p class="sub">${esc(d.casata.motto || '')} · <b>${d.casata.punti}</b> ${T('punti')}</p>
    <div class="sect-title" style="margin-top:6px">${d.quanti} ${T(d.quanti === 1 ? 'appartenente' : 'appartenenti')}</div>
    <div class="card" style="padding:4px 14px">${d.membri.map(riga).join('') || `<p class="tiny muted" style="padding:8px 0">${T('Nessun iscritto a questa casata.')}</p>`}</div>
    ${d.capitano ? '' : `<div class="note">${T('Questa casata non ha ancora un capitano.')}</div>`}
    <div class="note">${T('La chat interna alla casata arriverà in una prossima versione.')}</div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// ---- Tessera salvabile come immagine (logo + residence + nome + numero) ----
function tesseraCardSvg(s) {
  const nome = esc((s.nome || '') + ' ' + (s.cognome || '')).trim();
  const ruolo = esc(s.ruolo || 'Socio');
  const casata = s.casata ? esc(s.casata) : '';
  const code = esc(s.tessera_code || '');
  const qr = qrSvg(s.tessera_code || '').replace('<svg ', '<svg x="486" y="250" width="150" height="150" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 420" width="680" height="420">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12324F"/><stop offset="1" stop-color="#1d4a6e"/></linearGradient></defs>
    <rect width="680" height="420" rx="28" fill="url(#bg)"/>
    <g transform="translate(44,44)"><circle cx="24" cy="24" r="23" fill="none" stroke="#E0B44A" stroke-width="3"/><path d="M24 6 L29 24 L24 42 L19 24 Z" fill="#E0B44A"/><path d="M6 24 L24 19 L42 24 L24 29 Z" fill="#fff" opacity="0.85"/></g>
    <text x="104" y="60" fill="#fff" font-family="Georgia,serif" font-size="26" font-weight="700">BUSSOLA</text>
    <text x="104" y="82" fill="#E0B44A" font-family="Arial,sans-serif" font-size="13" letter-spacing="2">RESIDENCE</text>
    <text x="44" y="210" fill="#fff" font-family="Georgia,serif" font-size="40" font-weight="700">${nome}</text>
    <text x="44" y="246" fill="#cfe0ee" font-family="Arial,sans-serif" font-size="17">${ruolo}${casata ? ' · Casata ' + casata : ''}</text>
    <text x="44" y="330" fill="#E0B44A" font-family="Arial,sans-serif" font-size="13" letter-spacing="1">TESSERA</text>
    <text x="44" y="360" fill="#fff" font-family="monospace" font-size="30" font-weight="700">${code}</text>
    <rect x="470" y="234" width="182" height="182" rx="16" fill="#fff"/>
    ${qr}
  </svg>`;
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
    ? T('Su iPhone/iPad (Safari): tocca Condividi (⬆️) in basso, poi “Aggiungi a Home”.')
    : T('Su Android (Chrome): tocca il menu (⋮) in alto a destra, poi “Aggiungi a schermata Home” / “Installa app”.');
  return `<div class="card"><b style="font-size:.9rem">📲 ${T('Tieni l’app a portata di mano')}</b><p class="tiny muted" style="margin-top:4px">${passo}</p><p class="tiny muted">${T('Così resta sul telefono con la sua icona, senza cercarla ogni volta.')}</p></div>`;
}
function openInstallHint() {
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">📲 ${T('Installa l’app')}</div><h2>${T('Aggiungi alla schermata Home')}</h2>${installHintHTML()}<button class="btn gold block" style="margin-top:10px" data-close>${T('Ho capito')}</button>`);
  showOv();
}
// ---- Scelta / cambio casata (socio) con tetto di 12 ----
async function openCasata(fromReg) {
  let d; try { d = await api('/auth/casate'); } catch { okThen('Errore', false); return; }
  const cards = (d.casate || []).map(c => `<div class="matchrow"><div class="shield" style="width:34px;height:34px;min-width:34px;border-radius:9px;background:${c.colore};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">${esc((c.nome || 'A')[0])}</div><div style="flex:1;margin-left:10px"><b style="font-size:.9rem">${esc(c.nome)}</b><div class="ct">${esc(c.motto || '')} · ${c.soci}/${c.capienza} ${T('soci')}</div></div>${c.mia ? `<span class="tag" style="background:var(--teal);color:#fff;padding:3px 9px;border-radius:10px;font-size:.62rem">${T('la tua')}</span>` : c.pieno ? `<span class="tiny" style="color:var(--coral)">${T('al completo')}</span>` : `<button class="btn gold sm" data-casata="${c.id}">${T('Scegli')}</button>`}</div>`).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">🛡️ ${T('La tua casata')}</div><h2>${T('Scegli la casata')}</h2>
    <p class="sub">${T('Ogni casata accoglie fino a 12 soci. Se è al completo, scegline un’altra.')}</p>
    <div class="card" style="padding:4px 14px">${cards || '<p class="tiny muted" style="padding:8px 0">—</p>'}</div>
    <button class="btn ghost block" style="margin-top:10px" data-close>${fromReg ? T('Più tardi') : T('Chiudi')}</button>`);
  showOv();
}
async function scegliCasata(id) {
  let r; try { r = await api('/auth/scegli-casata', { method: 'POST', body: JSON.stringify({ casata_id: Number(id) }) }); }
  catch (e) { okThen(e.message || 'Errore', false); return; }
  if (state.socio) state.socio.casata = r.casata;
  okThen(`${T('Benvenuto nella casata')} ${r.casata}!`);
  await enterApp();
}

// ---- Self-order dall'app (loggato): stesso componente e stessa vista del QR al tavolo ----
let ORD_COM = null;
// Bar e Garden sono due percorsi diversi: al Bar si ordina e si ritira al banco, al Garden
// si cena a un tavolo, e il tavolo si prenota per uno dei due turni.
async function openOrdina(punto) {
  const p = punto === 'garden' ? 'garden' : 'bar';
  if (p === 'garden') return openGarden();
  // Quello che prepara la cucina compare anche qui: e' una regola del server, non dipende da
  // come sono marcati i prodotti nel listino. Al Bar si ordina un panino come una birra.
  let menu; try { menu = await api('/menu?zona=bar'); } catch { try { menu = await api('/menu'); } catch { okThen(T('Menù non disponibile'), false); return; } }
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">🍸 ${T('Bussola Bar')}</div><h2>${T('Ordina e ritira al banco')}</h2>
    <div id="ord_menu" style="max-height:52vh;overflow:auto"></div>
    <div id="ord_tot" style="font-weight:800;margin-top:8px"></div>
    <input type="hidden" id="ord_punto" value="Bussola Bar">
    <button class="btn gold block" style="margin-top:8px" id="ord_send" disabled>${T('Invia ordine')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
  ORD_COM = Comanda.create({
    mount: $('#ord_menu'), menu, search: true,
    onChange: (cart, tot, n) => { const t = $('#ord_tot'); if (t) t.textContent = n ? `${n} ${T('prodotti')} · ${eur(tot)}` : ''; const s = $('#ord_send'); if (s) s.disabled = !n; }
  });
  $('#ord_send').onclick = ordInvia;
}

// ---- Garden: prima il tavolo (turno), poi si ordina --------------------------------------
function gardenGiorni() {
  const out = []; const g = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const base = new Date(); base.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++) { const d = new Date(base.getTime() + i * 86400000); const iso = d.toISOString().slice(0, 10); out.push({ iso, label: i === 0 ? T('Oggi') : i === 1 ? T('Domani') : `${T(g[d.getDay()])} ${d.getDate()}` }); }
  return out;
}
async function openGarden(opz) {
  const soloOggi = !!(opz && opz.soloOggi);
  const giorni = gardenGiorni();
  if (!state._gardData || !giorni.some(d => d.iso === state._gardData)) state._gardData = giorni[0].iso;
  const data = state._gardData;
  let turni = null, mie = [];
  try { turni = await api(`/garden/turni?data=${data}`); } catch { }
  if (state.tessera) { try { mie = await api('/garden/mie-prenotazioni?tessera_code=' + encodeURIComponent(state.tessera)); } catch { } }
  const dayChips = giorni.map(d => `<button class="chip${d.iso === data ? ' sel' : ''}" data-gard-date="${d.iso}">${esc(d.label)}</button>`).join('');
  state._gardSoloOggi = soloOggi ? 1 : 0;
  const persone = state._gardPers || 2;
  const turnoBox = (t) => {
    const pieno = t.posti_liberi <= 0;
    return `<div class="matchrow"><div style="flex:1">
        <b style="font-size:.95rem">🕗 ${esc(t.turno)}</b>
        <div class="ct">${pieno ? T('nessun posto libero') : `${t.posti_liberi} ${T('posti liberi')} · ${t.coperti_prenotati} ${T('coperti prenotati')}`}</div></div>
      ${pieno ? `<span class="tag" style="background:#eee;color:#888;padding:4px 10px;border-radius:12px;font-size:.62rem;font-weight:700">${T('AL COMPLETO')}</span>`
              : `<button class="btn gold sm" data-gard-pren="${esc(t.turno)}">${T('Prenota')}</button>`}</div>`;
  };
  const mieHTML = mie.length ? `<div class="sect-title" style="margin-top:10px">${T('Le mie prenotazioni')}</div>
    <div class="card" style="padding:4px 14px">${mie.map(m => `<div class="matchrow"><div style="flex:1"><b style="font-size:.88rem">${esc(dataBella(m.data))} · ${esc(m.turno)}</b><div class="ct">${m.persone} ${T('persone')} · ${T('tavolo')} ${m.tavoli.join(', ')}</div></div><button class="btn ghost sm" data-gard-ann="${m.id}">${T('Annulla')}</button></div>`).join('')}</div>` : '';
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">🍽️ ${T('Bussola Garden')}</div><h2>${T('Cena al tavolo')}</h2>
    ${soloOggi ? `<div class="note" style="margin-top:0">${T('Stai prenotando per stasera')} · <b>${esc(dataBella(data))}</b>. ${T('Per gli altri giorni usa la sezione Eventi.')}</div>` : `<div class="field"><label>${T('Giorno')}</label><div class="chips">${dayChips}</div></div>`}
    <div class="field"><label>${T('Quante persone')}</label>
      <div class="chips">${[2, 3, 4, 5, 6, 8, 10, 12].map(n => `<button class="chip${n === persone ? ' sel' : ''}" data-gard-pers="${n}">${n}</button>`).join('')}
        <button class="chip${persone > 12 ? ' sel' : ''}" data-gard-altri="1">${persone > 12 ? persone : T('di più…')}</button></div>
      <p class="tiny muted" style="margin-top:4px">${T('Per un gruppo numeroso accostiamo più tavoli: indica quante persone siete davvero.')}</p></div>
    <div class="sect-title" style="margin-top:6px">${T('Turni')}</div>
    <div class="card" style="padding:4px 14px">${turni && turni.turni ? turni.turni.map(turnoBox).join('') : `<p class="tiny muted" style="padding:8px 0">${T('Prenotazione non disponibile.')}</p>`}</div>
    ${mieHTML}
    <button class="btn navy block" style="margin-top:10px" data-gard-menu>📷 ${T('Inquadra il QR del tavolo')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
async function gardenPrenota(turno) {
  if (!state.tessera) { okThen(T('Serve la tessera di un socio per prenotare'), false); return; }
  const persone = state._gardPers || 2;
  try {
    const r = await fetch(API_BASE + '/api/garden/prenota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tessera_code: state.tessera, data: state._gardData, turno, persone }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Se il turno e' pieno si propone dove c'e' posto, invece di chiudere e basta.
      const alt = (j.alternative || []).map(a => `${dataBella(a.data)} ${a.turno} (${a.posti_liberi} ${T('posti')})`).join(' · ');
      okThen((j.error || T('Prenotazione non riuscita')) + (alt ? `\n\n${T('C\'è posto')}: ${alt}` : ''), false);
      return;
    }
    // I posti davanti al palco sono meno dei coperti: se finiscono, il socio deve saperlo
    // subito, non scoprirlo la sera davanti allo spettacolo.
    let extra = '';
    if (j.stage) {
      extra = j.stage.errore
        ? `\n\n⚠️ ${T('Cena confermata, ma i posti davanti al palco sono esauriti')}: ${j.stage.errore}`
        : `\n\n🎭 ${T('Hai anche')} ${j.stage.posti.length} ${T('posti davanti al palco')} · ${esc(j.stage.spettacolo)} ${T('alle')} ${esc(j.stage.ora)}`;
    }
    okThen(`${T('Tavolo')} ${j.tavoli.join(', ')} · ${dataBella(state._gardData)} ${turno}${extra}`);
  } catch { okThen(T('Errore di rete'), false); return; }
  openGarden({ soloOggi: !!state._gardSoloOggi });
}
async function gardenAnnulla(id) {
  try { await api('/garden/prenotazioni/' + id + '/annulla', { method: 'POST', body: JSON.stringify({ tessera_code: state.tessera }) }); }
  catch (e) { okThen(e.message || T('Non riuscito'), false); return; }
  openGarden();
}
// Al tavolo del Garden l'ordine lo prende la Crew, oppure si inquadra il QR che sta sul
// tavolo: quel codice porta gia' con se' il numero, quindi nessuno lo digita e nessuno lo
// sbaglia. Chiedere il numero a mano era una scorciatoia che apriva la porta agli errori.
async function openQrTavolo() {
  const vaiA = (testo) => {
    const t = String(testo || '').trim();
    if (!t) return;
    // Il QR del tavolo contiene l'indirizzo completo dell'ordinazione: si va li' e basta.
    try {
      const u = new URL(t, location.origin);
      if (u.origin === location.origin && u.pathname.startsWith('/ordina')) { location.href = u.href; return; }
    } catch { }
    // Se invece il codice porta solo il numero, lo si usa come tavolo del Garden.
    const n = t.match(/\d+/);
    if (n) { location.href = '/ordina?p=' + encodeURIComponent('Bussola Garden') + '&t=' + encodeURIComponent(n[0]); return; }
    okThen(T('Questo codice non è il QR di un tavolo.'), false);
  };
  if (!('BarcodeDetector' in window)) {
    okThen(T('Questo telefono non legge i codici dall’app: apri la fotocamera del telefono e inquadra il QR sul tavolo.'), false);
    return;
  }
  let stream = null;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">🍽️ ${T('Bussola Garden')}</div><h2>${T('Inquadra il QR del tavolo')}</h2>
    <video id="qr_v" autoplay playsinline muted style="width:100%;border-radius:14px;background:#000;max-height:46vh;object-fit:cover"></video>
    <p class="tiny muted" style="margin-top:8px">${T('Il codice è sul tavolo. Da lì l’ordine parte già con il numero giusto.')}</p>
    <div id="qr_msg" class="tiny muted"></div>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
  const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
  const chiudi = $('#ov') && $('#ov').querySelector('[data-close]');
  if (chiudi) chiudi.addEventListener('click', stop, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#qr_v'); v.srcObject = stream;
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const cerca = async () => {
      if (!stream) return;
      try {
        const codici = await det.detect(v);
        if (codici && codici.length) { const testo = codici[0].rawValue; stop(); vaiA(testo); return; }
      } catch { }
      setTimeout(cerca, 300);
    };
    cerca();
  } catch (e) {
    const m = $('#qr_msg');
    if (m) m.textContent = T('Fotocamera non disponibile: apri la fotocamera del telefono e inquadra il QR sul tavolo.');
  }
}

async function ordInvia() {
  const righe = ORD_COM ? ORD_COM.getRighe() : [];
  if (!righe.length) return;
  // In app si ordina solo al banco: il tavolo passa dal QR (pagina /ordina) o dalla Crew.
  $('#ord_send').disabled = true;
  let r; try { r = await api('/self-order', { method: 'POST', body: JSON.stringify({ punto: $('#ord_punto').value, tessera_code: state.tessera, righe }) }); }
  catch (e) { okThen(e.message || 'Errore', false); $('#ord_send').disabled = false; return; }
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">✅ ${T('Ordine inviato')}</div><h2>${T('Comanda')} #${esc(r.numero)}</h2>
    <p class="sub">${esc(r.punto)}${r.tavolo ? ` · ${T('tavolo')} ${esc(r.tavolo)}` : ''} · ${eur(r.totale)} — ${T('si paga in cassa. Ti avvisiamo quando è pronto.')}</p>
    ${r.non_prima ? `<div class="note">🔥 ${T('La cucina consegna dalle')} <b>${esc(r.non_prima)}</b>: ${T('piastra e friggitrice devono scaldarsi. L’ordine è già preso.')}</div>` : ''}
    ${r.verifica_eta ? `<div class="note">🔞 ${T('Ci sono alcolici: al ritiro può esserti chiesto un documento. Sotto i 18 anni non si servono.')}</div>` : ''}
    <button class="btn gold block" style="margin-top:8px" data-close>${T('Fatto')}</button>`);
  showOv();
}

async function openTessera() {
  const s = state.socio;
  const pushOn = !!s.notifiche_push;
  let notifHtml = '', convHtml = '';
  if (state.token) {
    try {
      const list = await api('/auth/notifiche');
      notifHtml = `<div class="sect-title" style="margin-top:12px">${T('Le mie notifiche')}</div><div class="card" style="padding:4px 14px">${list.length ? list.map(n => `<div class="matchrow"><div style="flex:1"><b style="font-size:.82rem">${esc(n.titolo)}</b><div class="ct">${esc(n.corpo || '')}</div></div>${n.letta ? '' : `<span style="background:var(--gold);color:#fff;padding:2px 8px;border-radius:10px;font-size:.58rem;font-weight:700">${T('nuovo')}</span>`}<button class="btn ghost sm" style="margin-left:6px;padding:2px 8px" data-notifvia="${n.id}" title="${T('Togli questo avviso')}">✕</button></div>`).join('') : `<p class="tiny muted" style="padding:8px 0">${T('Nessuna notifica.')}</p>`}</div>`;
    } catch {}
    try {
      const cs = (await api('/convocazioni/' + state.tessera)).filter(c => c.stato === 'aperta' || c.stato === 'obbligatoria');
      if (cs.length) convHtml = `<div class="sect-title" style="margin-top:12px">${T('Le tue convocazioni')}</div><div class="card" style="padding:4px 14px">${cs.map(c => `<div class="matchrow"><div style="flex:1"><b style="font-size:.85rem">${esc(c.disciplina)}</b><div class="ct">${esc(c.match_label || '')}</div></div><div style="display:flex; gap:6px"><button class="btn gold sm" data-convrisp="${c.id}|disponibile">${T('Ci sono')}</button><button class="btn ghost sm" data-convrisp="${c.id}|non_disponibile">${T('No')}</button></div></div>`).join('')}</div>`;
    } catch {}
  }
  setSheet(`<div class="grab"></div>
    <div class="tessera"><div class="lab">BUSSOLA RESIDENCE</div><h2 class="serif" style="color:#fff">${esc(s.nome)} ${esc(s.cognome||'')}</h2><div class="role">${esc(s.ruolo||T('Socio'))} · ${T('Casata')} ${esc(s.casata||'')}</div>
      <div class="qr">${qrSvg(s.tessera_code)}</div>
      <div class="foot"><span class="tiny" style="opacity:.85">${T('Tessera')} ${esc(s.tessera_code)}</span><span class="tiny" style="opacity:.85">${T('Valida fino al')} ${esc((s.valida_fino||'').split('-').reverse().join('/'))}</span></div></div>
    <div class="row" style="gap:8px; margin-top:10px">
      <button class="btn gold sm" style="flex:1" data-savecard>💾 ${T('Salva tessera')}</button>
      <button class="btn ghost sm" style="flex:1" data-install>📲 ${T('Aggiungi alla Home')}</button>
      <button class="btn ghost sm" style="flex:1" data-spese>🧾 ${T('Le mie spese')}</button>
    </div>
    ${['socio', 'socio_residente'].includes(s.tipo_profilo) ? `<button class="btn navy block" style="margin-top:8px" data-opencasata>🛡️ ${s.casata ? T('Cambia casata') : T('Scegli la tua casata')}</button>` : ''}
    <div class="card" style="margin-top:12px; display:flex; align-items:center; gap:12px">
      <div style="flex:1"><b style="font-size:.86rem">${T('Notifiche casata & eventi')}</b><p class="tiny muted">${T('Convocazioni, cambi orario e serate. Con il tuo consenso.')}</p></div>
      <button class="btn ${pushOn?'gold':'ghost'} sm" data-push="${pushOn?'off':'on'}">${pushOn?T('Attive ✓'):T('Attiva')}</button>
    </div>
    ${['residente', 'socio_residente'].includes(s.tipo_profilo) ? `<div class="card" style="margin-top:10px; display:flex; align-items:center; gap:12px">
      <div style="flex:1"><b style="font-size:.86rem">${T('Case vacanza')}</b><p class="tiny muted">${s.is_host ? T('Puoi aggiungere le tue case e accogliere i visitatori.') : T('Attivala se affitti una casa nel residence.')}</p></div>
      <button class="btn ${s.is_host ? 'ghost' : 'gold'} sm" data-host="${s.is_host ? '0' : '1'}">${s.is_host ? T('Disattiva') : T('Attiva')}</button>
    </div>` : ''}
    ${convHtml}${notifHtml}
    <div class="sect-title" style="margin-top:12px">${T('Cosa ti dà')}</div>
    <div class="card">
      <div class="benefit"><span class="bic">✓</span><div><b>${T('Giochi la Coppa delle Casate')}</b><p>${T('Sport, giochi da tavolo e prove artistiche con il tuo clan.')}</p></div></div>
      <div class="benefit"><span class="bic">✓</span><div><b>${T('Inviti della casata')}</b><p>${T('Rispondi disponibile o no, senza biglietto né consumazione obbligatoria.')}</p></div></div>
      <div class="benefit"><span class="bic">○</span><div><b>${T('Copertura infortuni')} <span class="tiny" style="color:var(--coral)">${T('in definizione')}</span></b><p>${T('Stiamo valutando con la compagnia una copertura per le attività sportive.')}</p></div></div>
      <div class="benefit"><span class="bic">✓</span><div><b>${T("Il tuo posto nell'Albo d'Oro")}</b><p>${T('I vincitori della stagione restano scritti alla Bussola.')}</p></div></div>
    </div>
    <button class="btn ghost block" style="margin-top:12px" data-logout>${T('Esci / cambia tessera')}</button>
    <button class="btn navy block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
function openLoginOtp() {
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('Accesso')}</div><h2>${T('Entra con la tua e-mail')}</h2><p class="sub">${T('Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.')}</p>
    <div class="field"><label>${T('La tua e-mail')}</label><input id="ol_email" type="email" placeholder="nome@example.com" value="socio@example.com"></div>
    <div class="err" id="ol_err" style="color:var(--coral); font-size:.75rem; min-height:16px"></div>
    <button class="btn gold block" data-otp-req>${T('Invia il codice')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Annulla')}</button>`);
  showOv();
}
async function requestOtp() {
  const email = $('#ol_email').value.trim();
  if (!email.includes('@')) { $('#ol_err').textContent = T('Inserisci un’e-mail valida'); return; }
  let devCode = '';
  try { const r = await api('/auth/request-otp', { method:'POST', body: JSON.stringify({ email }) }); devCode = r.dev_code || ''; } catch {}
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">${T('Verifica')}</div><h2>${T('Inserisci il codice')}</h2><p class="sub">${T('Ti abbiamo inviato un codice a')} ${esc(email)}.</p>
    ${devCode?`<div class="note">${T('Modalità test: il codice è')} <b>${esc(devCode)}</b> ${T('(in produzione arriva via e-mail/SMS).')}</div>`:''}
    <div class="field"><label>${T('Codice a 6 cifre')}</label><input id="ol_code" inputmode="numeric" placeholder="______" value="${esc(devCode)}"></div>
    <div class="err" id="ol_err" style="color:var(--coral); font-size:.75rem; min-height:16px"></div>
    <button class="btn gold block" data-otp-verify="${esc(email)}">${T('Entra')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-login>${T('Cambia e-mail')}</button>`);
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
function showGate() { try { aggiornaGate(); } catch (e) { } const g = $('#gate'); if (g) { g.classList.add('show'); const i = $('#gate_tess'); if (i) setTimeout(() => i.focus(), 60); } }
function hideGate() { const g = $('#gate'); if (g) g.classList.remove('show'); }
async function enterApp() {
  await loadAll();
  initA11yToggle(); initModoToggle();
  renderHeader(); renderHome(); renderEventi(); renderCoppa(); renderBussola(); renderDom('sport'); renderDom('giochi');
  applyProfileGating(); adattaBarra();
  if (state.lang && state.lang !== 'it') applyLang(state.lang);
  // Socio/Residente auto-registrato senza casata: invito (gentile) a sceglierla.
  const s = state.socio || {};
  if (state.token && ['socio', 'socio_residente'].includes(s.tipo_profilo) && !s.casata && !state._casataAsked) {
    state._casataAsked = true; setTimeout(() => openCasata(true), 500);
  }
}
// Aggiorna lo stato del profilo (ha_casa, is_host, casata…) senza ricaricare tutta l'app.
// Usato quando l'app torna in primo piano: se l'host ha appena confermato, la casa "si scarica" da sola.
let _lastRefresh = 0;
async function refreshSocio(force) {
  if (!state.token || !state.tessera) return;
  const now = Date.now();
  if (!force && now - _lastRefresh < 4000) return; _lastRefresh = now;
  let s; try { s = await api('/tessera/' + state.tessera); } catch { return; }
  const eraCasa = !!(state.socio && state.socio.ha_casa);
  state.socio = s;
  renderHeader(); renderHome(); applyProfileGating(); adattaBarra();
  // Aggancio appena confermato dall'host → mostra subito "Casa mia" con le indicazioni.
  const ov = $('#ov');
  if (!eraCasa && s.ha_casa && ov && !ov.classList.contains('show')) openCasaMia();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSocio(); });
window.addEventListener('focus', () => refreshSocio());
async function loginTessera() {
  // Accetta il numero digitato, ma anche un indirizzo intero: chi appoggia la card NFC o
  // incolla il link della propria tessera non deve stare a estrarne il numero a mano.
  const code = leggiTessera($('#gate_tess').value) || ($('#gate_tess').value || '').trim().toUpperCase();
  const err = $('#gateErr');
  if (err) err.textContent = '';
  if (!code) { if (err) err.textContent = T('Inserisci il codice tessera.'); return; }
  try {
    const r = await api('/auth/login-tessera', { method: 'POST', body: JSON.stringify({ tessera_code: code }) });
    state.token = r.token; state.tessera = r.socio.tessera_code; state.authed = true;
    store.set('token', r.token); store.set('tessera', r.socio.tessera_code);
    hideGate();
  } catch (e) {
    if (err) err.textContent = T('Tessera non trovata. Controlla il codice o usa l’e-mail.');
    return;
  }
  // Da qui in poi l'accesso e' riuscito: un errore di disegno e' un'altra cosa e va detto
  // com'e', non travestito da "tessera non trovata" su una pagina vuota.
  try {
    await enterApp();
    if (!store.get('seen', false)) $('#onb').classList.add('show');
  } catch (e) {
    console.error('enterApp', e);
    $('#s-home').innerHTML = `<div class="card"><b>${T('Qualcosa non ha funzionato nel caricamento.')}</b>
      <p class="sub">${esc(e.message || '')}</p>
      <button class="btn gold block" onclick="location.reload()">${T('Riprova')}</button></div>`;
  }
}
function demoPreview() {   // solo per anteprima: usa la tessera demo e i dati SEED se offline
  state.tessera = 'RB-000001-4'; store.set('tessera', state.tessera);
  hideGate(); enterApp();
}

// ---- Registrazione guidata (porta d'ingresso dal QR) ----
let REG = {};
function startRegistrazione() { REG = {}; regProfilo(); showOv(); }
function regProfilo() {
  const opt = (val, emoji, tit, desc) => `<div class="card" role="button" tabindex="0" data-reg-tipo="${val}" style="display:flex;gap:12px;align-items:center;margin-bottom:8px"><div style="font-size:1.5rem">${emoji}</div><div style="flex:1"><b>${tit}</b><p class="tiny muted">${desc}</p></div><span style="font-size:1.2rem">›</span></div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">✨ ${T('Registrati')}</div><h2>${T('Chi sei?')}</h2>
    <p class="sub">${T('Rispondi e l\'app trova il profilo giusto per te.')}</p>
    ${opt('socio', '🎫', T('Sono socio'), T('Tesserato: casata, Coppa, inviti.'))}
    ${opt('residente', '🏠', T('Sono residente'), T('Vivo nel residence; posso gestire case vacanza.'))}
    ${opt('socio_residente', '🎫🏠', T('Sono socio e residente'), T('Tutto del socio (casata, Coppa) + gestisco case vacanza.'))}
    ${opt('ospite_temporaneo', '🧳', T('Sono in vacanza (visitatore)'), T('Ospite temporaneo: ti colleghi alla casa del tuo host.'))}
    <button class="btn ghost block" style="margin-top:8px" data-reg-cancel>${T('Ho già un account')}</button>`);
}
function regDati(tipo) {
  REG.tipo = tipo;
  const osp = tipo === 'ospite_temporaneo';
  const f = (id, lbl, type) => `<div class="field"><label>${lbl}</label><input id="${id}" ${type ? 'type="' + type + '"' : ''}></div>`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">✨ ${T('Registrati')}</div><h2>${T('I tuoi dati')}</h2>
    <div class="row" style="gap:8px"><div class="field" style="flex:1"><label>${T('Nome')}</label><input id="reg_nome"></div><div class="field" style="flex:1"><label>${T('Cognome')}</label><input id="reg_cognome"></div></div>
    ${f('reg_email', 'Email', 'email')}
    <p class="tiny muted" style="margin-top:-4px">${T('Serve per accedere di nuovo con un codice via e-mail.')}</p>
    ${osp ? `<div class="row" style="gap:8px"><div class="field" style="flex:1"><label>${T('Soggiorno dal')}</label><input id="reg_dal" type="date"></div><div class="field" style="flex:1"><label>${T('al')}</label><input id="reg_al" type="date"></div></div>` : ''}
    <label class="check" style="margin-top:6px"><input type="checkbox" id="reg_privacy"> ${T('Accetto il trattamento dei dati (privacy)')}</label>
    <div class="reg-err tiny" id="regErr" style="color:#c0392b"></div>
    <button class="btn gold block" style="margin-top:8px" data-reg-save>${T('Crea profilo')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-reg-back>${T('Indietro')}</button>`);
}
async function regSalva() {
  const g = (k) => (document.getElementById('reg_' + k) || {}).value || '';
  const err = $('#regErr'); if (err) err.textContent = '';
  const body = { tipo_profilo: REG.tipo, nome: g('nome'), cognome: g('cognome'), email: g('email'), lingua: state.lang || 'it', consenso_privacy: $('#reg_privacy') && $('#reg_privacy').checked };
  if (REG.tipo === 'ospite_temporaneo') { body.soggiorno_dal = g('dal'); body.soggiorno_al = g('al'); }
  if (!body.nome.trim() || !body.cognome.trim()) { if (err) err.textContent = T('Nome e cognome obbligatori'); return; }
  if (!body.consenso_privacy) { if (err) err.textContent = T('Il consenso privacy è necessario per registrarsi'); return; }
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
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">✅ ${T('Tutto pronto')}</div><h2>${T('Benvenuto!')}</h2>
    <p class="sub">${T('Il tuo profilo è attivo. Conserva il tuo codice per accedere anche senza e-mail:')}</p>
    <div class="card" style="text-align:center;padding:14px"><div class="tiny muted">${T('Codice di accesso')}</div><div style="font-size:1.5rem;font-weight:800;letter-spacing:1px;color:var(--navy)">${esc(REG.code || '')}</div></div>
    <button class="btn gold block" style="margin-top:10px" data-savecard>💾 ${T('Salva la tua tessera (immagine)')}</button>
    ${installHintHTML()}
    ${socioLike ? `<button class="btn navy block" style="margin-top:8px" data-opencasata>🛡️ ${T('Scegli la tua casata')}</button>` : ''}
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Inizia')}</button>`);
}
function regHost() {
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">🏡 ${T('Il tuo host')}</div><h2>${T('Conosci il tuo host?')}</h2>
    <p class="sub">${T('Cerca chi ti ospita: riceverà una notifica e, se conferma, vedrai "Casa mia".')}</p>
    <div class="field"><label>${T('Nome o cognome dell\'host')}</label><input id="reg_hq" placeholder="${T('es. Chiara')}" autocomplete="off"></div>
    <div id="reg_hres"></div>
    <button class="btn ghost block" style="margin-top:8px" data-reg-skiphost>${T('Non lo conosco ora · salta')}</button>`);
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
      ? '<div class="card" style="padding:4px 14px">' + hosts.map(h => `<div class="matchrow"><div style="flex:1"><b style="font-size:.9rem">${esc(h.nome)} ${esc(h.cognome)}</b></div><button class="btn gold sm" data-reg-host="${h.id}">${T('È lui/lei')}</button></div>`).join('') + '</div>'
      : `<p class="tiny muted" style="padding:6px 0">${T('Nessun host trovato con questo nome.')}</p>`;
  }, 220);
}
async function regInviaRichiesta(hostId) {
  let r;
  try { r = await api('/auth/aggancio/richiesta', { method: 'POST', body: JSON.stringify({ host_id: Number(hostId) }) }); }
  catch (e) { okThen(e.message || 'Errore', false); return; }
  const nome = r.host ? (r.host.nome + ' ' + r.host.cognome) : '';
  const isReg = !!REG.code;   // durante la registrazione mostro anche codice + installazione; fuori no.
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">📨 ${T('Richiesta inviata')}</div><h2>${T('In attesa di conferma')}</h2>
    <p class="sub">${T('Abbiamo avvisato')} <b>${esc(nome)}</b>. ${T('Quando confermerà, comparirà "Casa mia" con tutte le indicazioni della struttura.')}</p>
    ${isReg ? `<div class="card" style="text-align:center;padding:14px"><div class="tiny muted">${T('Il tuo codice di accesso')}</div><div style="font-size:1.4rem;font-weight:800;letter-spacing:1px;color:var(--navy)">${esc(REG.code || '')}</div></div>
    <button class="btn gold block" style="margin-top:10px" data-savecard>💾 ${T('Salva la tua tessera (immagine)')}</button>
    ${installHintHTML()}` : ''}
    <button class="btn ghost block" style="margin-top:8px" data-close>${isReg ? T('Inizia') : T('Fatto')}</button>`);
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
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return; // browser senza push → resta il solo in-app
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
  'sheet-vinile': () => `<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">${T('Martedì')} · Vinile & Vino</div><h2>${T('Proponi un vinile')}</h2><p class="sub">${T('Le proposte di questa settimana diventano la scaletta di martedì prossimo.')}</p>
    <div class="field"><label>${T('Quale vinile?')}</label><input id="in1" placeholder="${T('Es. Fabrizio De André — Crêuza de mä')}"></div>
    <div class="field"><label>${T('I brani che vuoi ascoltare')}</label><input id="in2" placeholder="${T('Es. Crêuza de mä, Sidún')}"></div>
    <div class="field"><label>${T('Perché lo proponi?')}</label><textarea id="in3" placeholder="${T('In due righe cosa significa per te...')}"></textarea></div>
    <button class="btn gold block" data-proposta="vinile">${T('Invia la proposta')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Annulla')}</button>`,
  'sheet-openmic': () => `<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${T('Domenica')} · Open Mic</div><h2>${T('Salgo sul palco')}</h2><p class="sub">${T('Hai tre minuti. Scegli cosa porti sul Bussola Stage.')}</p>
    <div class="field"><label>${T('La tua esibizione')}</label><div class="chips" data-group="tipo"><button class="chip" data-chip>🎤 ${T('Canto')}</button><button class="chip" data-chip>🎭 ${T('Monologo')}</button><button class="chip" data-chip>😄 Stand-up</button><button class="chip" data-chip>🎸 ${T('Strumento')}</button></div></div>
    <div class="field"><label>${T('Titolo / cosa presenti')}</label><input id="in1" placeholder="${T("Es. 'Caruso' alla chitarra")}"></div>
    <div class="note">${T('La stand-up è benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.')}</div>
    <button class="btn gold block" style="margin-top:12px" data-proposta="openmic">${T('Prenota i miei tre minuti')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Annulla')}</button>`,
};
function openSheet(id) { setSheet(SHEETS[id]()); showOv(); }
function okThen(msg, ok = true) {
  const icon = ok ? '<path d="M5 13l4 4L19 7"/>' : '<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>';
  const bg = ok ? '' : 'background:var(--coral)';
  const title = ok ? T('Fatto!') : T('Un momento');
  const tail = ok ? T(". Lo trovi nell'app e te lo ricordiamo noi.") : '';
  setSheet(`<div class="grab"></div><div class="okmsg" style="text-align:center; padding:12px 0 4px"><div class="big" style="${bg}"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" aria-hidden="true">${icon}</svg></div><h2 style="text-align:center">${title}</h2><p class="sub" style="text-align:center">${esc(msg)}${tail}</p></div><button class="btn navy block" style="margin-top:6px" data-close>${ok ? T('Perfetto') : T('Ho capito')}</button>`);
  showOv();
}
// Lingue: 5 con traduzione fissa salvata (it/en/fr/de/es).
const LANGS = [['it','Italiano','fixed'],['en','English','fixed'],['fr','Français','fixed'],['de','Deutsch','fixed'],['es','Español','fixed']];
const I18N = {
  it:{home:'Home',eventi:'Settimana',sport:'Sport',giochi:'Giochi',bussola:'Guida',ciao:'Ciao',testo:'Testo',contrasto:'Contrasto',siamo_qui:'Siamo qui',chiosco:'Chiosco La Bussola',isola:'Isola ecologica',qui:'sei qui',apri_mappa:'Tocca per aprire la mappa'},
  en:{home:'Home',eventi:'The week',sport:'Sport',giochi:'Games',bussola:'Guide',ciao:'Hi',testo:'Text',contrasto:'Contrast',siamo_qui:'You are here',chiosco:'La Bussola kiosk',isola:'Recycling point',qui:'you are here',apri_mappa:'Tap to open the map'},
  fr:{home:'Accueil',eventi:'La semaine',sport:'Sport',giochi:'Jeux',bussola:'Guide',ciao:'Bonjour',testo:'Texte',contrasto:'Contraste',siamo_qui:'Vous êtes ici',chiosco:'Kiosque La Bussola',isola:'Point de tri',qui:'vous êtes ici',apri_mappa:'Touchez pour ouvrir la carte'},
  de:{home:'Start',eventi:'Events',sport:'Sport',giochi:'Spiele',bussola:'Guide',ciao:'Hallo',testo:'Text',contrasto:'Kontrast',siamo_qui:'Sie sind hier',chiosco:'Kiosk La Bussola',isola:'Wertstoffinsel',qui:'Sie sind hier',apri_mappa:'Zum Öffnen der Karte tippen'},
  es:{home:'Inicio',eventi:'Eventos',sport:'Deporte',giochi:'Juegos',bussola:'Guía',ciao:'Hola',testo:'Texto',contrasto:'Contraste',siamo_qui:'Estás aquí',chiosco:'Quiosco La Bussola',isola:'Punto de reciclaje',qui:'estás aquí',apri_mappa:'Toca para abrir el mapa'},
};
function tr(k){ return (I18N[state.lang] || I18N.it)[k] || I18N.it[k]; }
// Dizionario stringhe fisse dell'app (chiave = testo italiano esatto). I contenuti
// dinamici (dati/DB) non passano da qui. T() ricade sull'italiano se manca la voce.
const UI = {"en": {"(in produzione arriva via e-mail/SMS).": "(in production it arrives via email/SMS).", ". Lo trovi nell'app e te lo ricordiamo noi.": ". You’ll find it in the app and we’ll remind you.", "AL COMPLETO": "FULL", "Accesso": "Sign in", "Albo d'Oro": "Hall of Fame", "Annulla": "Cancel", "Apri": "Open", "Apri il contest": "Open the contest", "Attiva": "Turn on", "Attive ✓": "On ✓", "Bentornato,": "Welcome back,", "Benvenuto alla Bussola": "Welcome to La Bussola", "Burraco, scala 40, briscola, scacchi.": "Burraco, Scala 40, Briscola, chess.", "Calendario in aggiornamento.": "Schedule being updated.", "Calendario non ancora disponibile.": "Calendar not available yet.", "Cambia e-mail": "Change email", "Campi": "Courts", "Campionati sport": "Sport championships", "Campo": "Court", "Campo prenotato": "Court booked", "Canto": "Singing", "Capitano": "Captain", "Casata": "House", "Chi copre le partite?": "Who covers the matches?", "Chiudi": "Close", "Ci ripenso": "I’ll reconsider", "Ci sono": "I’m in", "Classifica generale": "Overall standings", "Codice a 6 cifre": "6-digit code", "Codice non valido o scaduto": "Invalid or expired code", "Condividi": "Share", "Condividi con la casata": "Share with your house", "Conferimento": "Drop-off", "Conferma prenotazione": "Confirm booking", "Confermo": "I confirm", "Convoca giocatori": "Call up players", "Convoca i giocatori": "Call up players", "Convoca i selezionati": "Call up selected", "Convoca la casata": "Summon your house", "Convoca la tua casata": "Summon your house", "Convocati": "Called up", "Convocazione vincolante": "Binding call-up", "Convocazioni, cambi orario e serate. Con il tuo consenso.": "Call-ups, schedule changes and evenings. With your consent.", "Copertura infortuni": "Injury coverage", "Coppa": "Cup", "Coppa delle Casate": "Houses Cup", "Cosa ti dà": "What you get", "Cosa vedere": "What to see", "Coworking": "Coworking", "Dinieghi:": "Declines:", "Discipline": "Disciplines", "Disponibile": "Available", "Disponibile solo online": "Available online only", "Domani": "Tomorrow", "Domenica": "Sunday", "Emergenze & servizi": "Emergencies & services", "Emergenze (112)": "Emergencies (112)", "Entra": "Enter", "Entra con la tua e-mail": "Sign in with your email", "Errore di rete": "Network error", "Es. 'Caruso' alla chitarra": "E.g. ‘Caruso’ on guitar", "Es. Crêuza de mä, Sidún": "E.g. Crêuza de mä, Sidún", "Es. Fabrizio De André — Crêuza de mä": "E.g. Fabrizio De André — Crêuza de mä", "Esci / cambia tessera": "Log out / change card", "Fasce orarie": "Time slots", "Fatto!": "Done!", "Forza": "Go", "Gioca con gli altri": "Play with others", "Giochi da Tavolo": "Board games", "Giochi la Coppa delle Casate": "You play the Houses Cup", "Giorno": "Day", "Gironi, calendario e risultati.": "Groups, schedule and results.", "Guida del residence": "Residence guide", "Hai declinato": "You declined", "Hai già declinato tre volte in stagione: questa convocazione è vincolante.": "You’ve already declined three times this season: this call-up is binding.", "Hai tre minuti. Scegli cosa porti sul Bussola Stage.": "You have three minutes. Choose what you bring to the Bussola Stage.", "Ho capito": "Got it", "I brani che vuoi ascoltare": "The tracks you want to hear", "I vincitori della stagione restano scritti alla Bussola.": "The season’s winners stay recorded at La Bussola.", "Il tuo posto nell'Albo d'Oro": "Your place in the Hall of Fame", "In caso di necessità.": "In case of need.", "In due righe cosa significa per te...": "In two lines, what it means to you...", "Info": "Info", "Inserisci il codice": "Enter the code", "Inserisci il codice tessera.": "Enter your card code.", "Inserisci un’e-mail valida": "Enter a valid email", "Invia il codice": "Send the code", "Invia la proposta": "Send the suggestion", "Inviti della casata": "House invitations", "Iscritto!": "Signed up!", "La comunità": "The community", "La sfida di venerdì": "Friday’s challenge", "La stand-up è benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.": "Stand-up is welcome, with moderate language: there are families at La Bussola too.", "La tua casata": "Your house", "La tua casata ti invita": "Your house invites you", "La tua e-mail": "Your email", "La tua esibizione": "Your performance", "La tua proposta è in lista": "Your suggestion is on the list", "Le mie notifiche": "My notifications", "Le proposte di questa settimana diventano la scaletta di martedì prossimo.": "This week’s suggestions become next Tuesday’s playlist.", "Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.": "The rules for the Cup, Contest and Proposals, and the rules of the ongoing disciplines.", "Le tue convocazioni": "Your call-ups", "Libero": "Free", "Lingua impostata": "Language set", "Martedì": "Tuesday", "Modalità test: il codice è": "Test mode: the code is", "Monologo": "Monologue", "Nessun periodo configurato.": "No period configured.", "Nessun regolamento generale.": "No general rules.", "Nessun risultato ancora.": "No results yet.", "Nessuna notifica.": "No notifications.", "Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!": "No open matches right now. Start one yourself from the Courts section!", "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).": "No matches to cover right now (requires captain access and a schedule generated by staff).", "Nessuno slot per questa data.": "No slots for this date.", "No": "No", "Non disponibile": "Not available", "Non riesco a convocare ora": "Can’t call up right now", "Non riuscito": "Failed", "Notifiche attivate: ti avviseremo per casata ed eventi": "Notifications on: we’ll alert you about your house and events", "Notifiche casata & eventi": "House & events notifications", "Notifiche disattivate": "Notifications off", "Numeri utili": "Useful numbers", "Numeri utili & servizi": "Useful numbers & services", "Numero unico europeo": "Single European number", "Oggi": "Today", "Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.": "Every match updates the Cup standings. Format: groups, then semifinals and final.", "PG": "GP", "Partita al completo, ci vediamo in campo! 🎾": "Match full, see you on court! 🎾", "Partita aperta": "Open match", "Partite aperte": "Open matches", "Perché lo proponi?": "Why are you suggesting it?", "Perfetto": "Perfect", "Posti disponibili": "Spots available", "Posti esauriti per questa serata.": "Sold out for this evening.", "Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.": "Limited spots: max 8 in the morning and 8 in the afternoon. The <b>full day</b> takes a spot in both slots.", "Prenota": "Book", "Prenota i miei tre minuti": "Book my three minutes", "Prenotazione": "Booking", "Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriverà più avanti).": "Limited-capacity booking: the fee is paid at the desk on confirmation (in-app payment coming later).", "Prenotazione campi": "Court booking", "Prenotazione campi disponibile solo online": "Court booking available online only", "Prenotazione non riuscita": "Booking failed", "Prenotazione non riuscita: riprova": "Booking failed: try again", "Prenotazione registrata": "Booking recorded", "Presenza confermata": "Attendance confirmed", "Presenza confermata ✓": "Attendance confirmed ✓", "Proponi": "Suggest", "Proponi un vinile": "Suggest a vinyl", "Prossime partite": "Upcoming matches", "Pt": "Pts", "Quale vinile?": "Which vinyl?", "Quante persone": "How many people", "Quota": "Fee", "Raccolta rifiuti": "Waste collection", "Regolamenti": "Rules", "Regolamenti & Albo d'Oro": "Rules & Hall of Fame", "Regole & storia": "Rules & history", "Regole di Coppa, Contest e Proposte; le edizioni passate.": "Cup, Contest and Proposal rules; past editions.", "Rilancia la sfida ai tuoi. Forza": "Rally your house. Go", "Rispondi disponibile o no, senza biglietto né consumazione obbligatoria.": "Reply available or not, no ticket or minimum purchase.", "Risultati recenti": "Recent results", "Ritiro dalle": "Pickup from", "Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.": "Red = fewer available than the minimum. Tap a match to call up individuals.", "Salgo": "On stage", "Salgo sul palco": "I’m taking the stage", "Scegli la lingua": "Choose the language", "Scegli la lingua dell'app": "Choose the app language", "Sei in lista per": "You’re on the list for", "Sei in scaletta per domenica": "You’re on the lineup for Sunday", "Sei nostro ospite: partecipa quando vuoi, nessun obbligo.": "You’re our guest: join whenever you like, no obligation.", "Seleziona almeno un giocatore": "Select at least one player", "Serata dei Clan": "Clans Night", "Serata dei Clan · Contest": "Clans Night · Contest", "Serata su prenotazione": "Evening by reservation", "Serve gente — convoca": "Need players — call up", "Socio": "Member", "Sport & Tornei": "Sport & Tournaments", "Sport, giochi da tavolo e prove artistiche con il tuo clan.": "Sport, board games and artistic challenges with your clan.", "Spunta chi vuoi convocare.": "Check who you want to call up.", "Squadra": "Team", "Stiamo valutando con la compagnia una copertura per le attività sportive.": "We’re evaluating coverage for sports activities with the insurer.", "Strumenti del capitano": "Captain tools", "Strumento": "Instrument", "Tessera": "Card", "Tessera non trovata. Controlla il codice o usa l’e-mail.": "Card not found. Check the code or use email.", "Testo copiato: incollalo nel gruppo": "Text copied: paste it in the group", "Ti abbiamo inviato un codice a": "We sent a code to", "Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.": "We’ll send you a one-time code (OTP) or a magic link. No password to remember.", "Titolo / cosa presenti": "Title / what you present", "Tocca una serata per i dettagli e per prenotare.": "Tap an evening for details and to book.", "Turno": "Slot", "Un momento": "One moment", "Unisciti": "Join", "Unisciti a una partita con posti liberi: quando si completa, è fatta.": "Join a match with open spots: once it’s full, you’re set.", "V": "W", "Valida fino al": "Valid until", "Verifica": "Verify", "Vincitore:": "Winner:", "a persona": "per person", "con": "with", "da saldare": "to pay", "da saldare in cassa": "to pay at the desk", "dinieghi": "declines", "dispon.": "avail.", "disponibile": "available", "disponibili": "available", "diventa vincolante solo dopo il terzo": "becomes binding only after the third", "giocatori": "players", "in attesa": "pending", "in definizione": "in progress", "la nostra casata": "our house", "la serata": "the evening", "mancano": "missing", "non disp.": "unavail.", "nuovo": "new", "pers.": "ppl", "postazione": "workspace", "posti": "spots", "posti? Gli altri soci potranno unirsi.": "spots? Other members can join.", "posto": "place", "prenota o partita": "book or match", "prossimamente": "coming soon", "punti": "points", "servono": "need", "siamo": "we’re", "unisciti": "join", "← Torna alle partite": "← Back to matches"}, "fr": {"(in produzione arriva via e-mail/SMS).": "(en production il arrive par e-mail/SMS).", ". Lo trovi nell'app e te lo ricordiamo noi.": ". Vous le retrouvez dans l’app et nous vous le rappelons.", "AL COMPLETO": "COMPLET", "Accesso": "Connexion", "Albo d'Oro": "Palmarès", "Annulla": "Annuler", "Apri": "Ouvrir", "Apri il contest": "Ouvrir le concours", "Attiva": "Activer", "Attive ✓": "Activées ✓", "Bentornato,": "Bon retour,", "Benvenuto alla Bussola": "Bienvenue à La Bussola", "Burraco, scala 40, briscola, scacchi.": "Burraco, Scala 40, Briscola, échecs.", "Calendario in aggiornamento.": "Calendrier en cours de mise à jour.", "Calendario non ancora disponibile.": "Calendrier pas encore disponible.", "Cambia e-mail": "Changer d’e-mail", "Campi": "Terrains", "Campionati sport": "Championnats sportifs", "Campo": "Terrain", "Campo prenotato": "Terrain réservé", "Canto": "Chant", "Capitano": "Capitaine", "Casata": "Maison", "Chi copre le partite?": "Qui couvre les matchs ?", "Chiudi": "Fermer", "Ci ripenso": "Je reconsidère", "Ci sono": "Je suis là", "Classifica generale": "Classement général", "Codice a 6 cifre": "Code à 6 chiffres", "Codice non valido o scaduto": "Code invalide ou expiré", "Condividi": "Partager", "Condividi con la casata": "Partager avec la maison", "Conferimento": "Dépôt", "Conferma prenotazione": "Confirmer la réservation", "Confermo": "Je confirme", "Convoca giocatori": "Convoquer des joueurs", "Convoca i giocatori": "Convoquer les joueurs", "Convoca i selezionati": "Convoquer les sélectionnés", "Convoca la casata": "Convoquer la maison", "Convoca la tua casata": "Convoquez votre maison", "Convocati": "Convoqués", "Convocazione vincolante": "Convocation obligatoire", "Convocazioni, cambi orario e serate. Con il tuo consenso.": "Convocations, changements d’horaire et soirées. Avec votre consentement.", "Copertura infortuni": "Couverture accidents", "Coppa": "Coupe", "Coppa delle Casate": "Coupe des Maisons", "Cosa ti dà": "Ce que ça vous apporte", "Cosa vedere": "À voir", "Coworking": "Coworking", "Dinieghi:": "Refus :", "Discipline": "Disciplines", "Disponibile": "Disponible", "Disponibile solo online": "Disponible en ligne uniquement", "Domani": "Demain", "Domenica": "Dimanche", "Emergenze & servizi": "Urgences & services", "Emergenze (112)": "Urgences (112)", "Entra": "Entrer", "Entra con la tua e-mail": "Connectez-vous avec votre e-mail", "Errore di rete": "Erreur réseau", "Es. 'Caruso' alla chitarra": "Ex. ‘Caruso’ à la guitare", "Es. Crêuza de mä, Sidún": "Ex. Crêuza de mä, Sidún", "Es. Fabrizio De André — Crêuza de mä": "Ex. Fabrizio De André — Crêuza de mä", "Esci / cambia tessera": "Se déconnecter / changer de carte", "Fasce orarie": "Créneaux", "Fatto!": "C’est fait !", "Forza": "Allez", "Gioca con gli altri": "Jouez avec les autres", "Giochi da Tavolo": "Jeux de société", "Giochi la Coppa delle Casate": "Vous jouez la Coupe des Maisons", "Giorno": "Jour", "Gironi, calendario e risultati.": "Poules, calendrier et résultats.", "Guida del residence": "Guide de la résidence", "Hai declinato": "Vous avez décliné", "Hai già declinato tre volte in stagione: questa convocazione è vincolante.": "Vous avez déjà décliné trois fois cette saison : cette convocation est obligatoire.", "Hai tre minuti. Scegli cosa porti sul Bussola Stage.": "Vous avez trois minutes. Choisissez ce que vous présentez sur le Bussola Stage.", "Ho capito": "Compris", "I brani che vuoi ascoltare": "Les morceaux que vous voulez écouter", "I vincitori della stagione restano scritti alla Bussola.": "Les vainqueurs de la saison restent inscrits à La Bussola.", "Il tuo posto nell'Albo d'Oro": "Votre place au Palmarès", "In caso di necessità.": "En cas de besoin.", "In due righe cosa significa per te...": "En deux lignes, ce que ça représente pour vous...", "Info": "Info", "Inserisci il codice": "Saisissez le code", "Inserisci il codice tessera.": "Saisissez le code de la carte.", "Inserisci un’e-mail valida": "Saisissez un e-mail valide", "Invia il codice": "Envoyer le code", "Invia la proposta": "Envoyer la proposition", "Inviti della casata": "Invitations de la maison", "Iscritto!": "Inscrit !", "La comunità": "La communauté", "La sfida di venerdì": "Le défi de vendredi", "La stand-up è benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.": "Le stand-up est bienvenu, avec un langage modéré : il y a aussi des familles à La Bussola.", "La tua casata": "Votre maison", "La tua casata ti invita": "Votre maison vous invite", "La tua e-mail": "Votre e-mail", "La tua esibizione": "Votre prestation", "La tua proposta è in lista": "Votre proposition est sur la liste", "Le mie notifiche": "Mes notifications", "Le proposte di questa settimana diventano la scaletta di martedì prossimo.": "Les propositions de cette semaine deviennent la playlist de mardi prochain.", "Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.": "Les règles de la Coupe, du Concours et des Propositions, et les règlements des disciplines en cours.", "Le tue convocazioni": "Vos convocations", "Libero": "Libre", "Lingua impostata": "Langue définie", "Martedì": "Mardi", "Modalità test: il codice è": "Mode test : le code est", "Monologo": "Monologue", "Nessun periodo configurato.": "Aucune période configurée.", "Nessun regolamento generale.": "Aucun règlement général.", "Nessun risultato ancora.": "Aucun résultat pour l’instant.", "Nessuna notifica.": "Aucune notification.", "Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!": "Aucune partie ouverte pour le moment. Lancez-en une depuis la section Terrains !", "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).": "Aucun match à couvrir pour le moment (nécessite un accès capitaine et un calendrier généré par le staff).", "Nessuno slot per questa data.": "Aucun créneau pour cette date.", "No": "Non", "Non disponibile": "Indisponible", "Non riesco a convocare ora": "Impossible de convoquer maintenant", "Non riuscito": "Échec", "Notifiche attivate: ti avviseremo per casata ed eventi": "Notifications activées : nous vous préviendrons pour la maison et les événements", "Notifiche casata & eventi": "Notifications maison & événements", "Notifiche disattivate": "Notifications désactivées", "Numeri utili": "Numéros utiles", "Numeri utili & servizi": "Numéros utiles & services", "Numero unico europeo": "Numéro d’urgence européen", "Oggi": "Aujourd’hui", "Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.": "Chaque match met à jour le classement de la Coupe. Formule : poules, puis demi-finales et finale.", "PG": "J", "Partita al completo, ci vediamo in campo! 🎾": "Partie complète, on se voit sur le terrain ! 🎾", "Partita aperta": "Partie ouverte", "Partite aperte": "Parties ouvertes", "Perché lo proponi?": "Pourquoi le proposez-vous ?", "Perfetto": "Parfait", "Posti disponibili": "Places disponibles", "Posti esauriti per questa serata.": "Complet pour cette soirée.", "Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.": "Places limitées : max 8 le matin et 8 l’après-midi. La <b>journée entière</b> occupe une place sur les deux créneaux.", "Prenota": "Réserver", "Prenota i miei tre minuti": "Réserver mes trois minutes", "Prenotazione": "Réservation", "Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriverà più avanti).": "Réservation à places limitées : la participation se règle en caisse à la confirmation (le paiement in-app arrivera plus tard).", "Prenotazione campi": "Réservation des terrains", "Prenotazione campi disponibile solo online": "Réservation des terrains disponible en ligne uniquement", "Prenotazione non riuscita": "Échec de la réservation", "Prenotazione non riuscita: riprova": "Échec de la réservation : réessayez", "Prenotazione registrata": "Réservation enregistrée", "Presenza confermata": "Présence confirmée", "Presenza confermata ✓": "Présence confirmée ✓", "Proponi": "Proposer", "Proponi un vinile": "Proposer un vinyle", "Prossime partite": "Prochains matchs", "Pt": "Pts", "Quale vinile?": "Quel vinyle ?", "Quante persone": "Combien de personnes", "Quota": "Participation", "Raccolta rifiuti": "Collecte des déchets", "Regolamenti": "Règlements", "Regolamenti & Albo d'Oro": "Règlements & Palmarès", "Regole & storia": "Règles & histoire", "Regole di Coppa, Contest e Proposte; le edizioni passate.": "Règles de la Coupe, du Concours et des Propositions ; éditions passées.", "Rilancia la sfida ai tuoi. Forza": "Relancez le défi aux vôtres. Allez", "Rispondi disponibile o no, senza biglietto né consumazione obbligatoria.": "Répondez disponible ou non, sans billet ni consommation obligatoire.", "Risultati recenti": "Résultats récents", "Ritiro dalle": "Collecte à partir de", "Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.": "Rouge = moins de disponibles que le minimum. Touchez un match pour convoquer individuellement.", "Salgo": "Sur scène", "Salgo sul palco": "Je monte sur scène", "Scegli la lingua": "Choisissez la langue", "Scegli la lingua dell'app": "Choisissez la langue de l’app", "Sei in lista per": "Vous êtes sur la liste pour", "Sei in scaletta per domenica": "Vous êtes au programme de dimanche", "Sei nostro ospite: partecipa quando vuoi, nessun obbligo.": "Vous êtes notre invité : participez quand vous voulez, sans obligation.", "Seleziona almeno un giocatore": "Sélectionnez au moins un joueur", "Serata dei Clan": "Soirée des Clans", "Serata dei Clan · Contest": "Soirée des Clans · Concours", "Serata su prenotazione": "Soirée sur réservation", "Serve gente — convoca": "Besoin de joueurs — convoquer", "Socio": "Membre", "Sport & Tornei": "Sport & Tournois", "Sport, giochi da tavolo e prove artistiche con il tuo clan.": "Sport, jeux de société et épreuves artistiques avec votre clan.", "Spunta chi vuoi convocare.": "Cochez qui vous voulez convoquer.", "Squadra": "Équipe", "Stiamo valutando con la compagnia una copertura per le attività sportive.": "Nous étudions avec l’assureur une couverture pour les activités sportives.", "Strumenti del capitano": "Outils du capitaine", "Strumento": "Instrument", "Tessera": "Carte", "Tessera non trovata. Controlla il codice o usa l’e-mail.": "Carte introuvable. Vérifiez le code ou utilisez l’e-mail.", "Testo copiato: incollalo nel gruppo": "Texte copié : collez-le dans le groupe", "Ti abbiamo inviato un codice a": "Nous avons envoyé un code à", "Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.": "Nous vous envoyons un code à usage unique (OTP) ou un lien magique. Aucun mot de passe à retenir.", "Titolo / cosa presenti": "Titre / ce que vous présentez", "Tocca una serata per i dettagli e per prenotare.": "Touchez une soirée pour les détails et pour réserver.", "Turno": "Créneau", "Un momento": "Un instant", "Unisciti": "Rejoindre", "Unisciti a una partita con posti liberi: quando si completa, è fatta.": "Rejoignez une partie avec des places libres : une fois complète, c’est parti.", "V": "V", "Valida fino al": "Valable jusqu’au", "Verifica": "Vérification", "Vincitore:": "Vainqueur :", "a persona": "par personne", "con": "avec", "da saldare": "à régler", "da saldare in cassa": "à régler en caisse", "dinieghi": "refus", "dispon.": "dispo.", "disponibile": "disponible", "disponibili": "disponibles", "diventa vincolante solo dopo il terzo": "devient obligatoire seulement après le troisième", "giocatori": "joueurs", "in attesa": "en attente", "in definizione": "en cours", "la nostra casata": "notre maison", "la serata": "la soirée", "mancano": "manquent", "non disp.": "indispo.", "nuovo": "nouveau", "pers.": "pers.", "postazione": "poste", "posti": "places", "posti? Gli altri soci potranno unirsi.": "places ? D’autres membres pourront rejoindre.", "posto": "place", "prenota o partita": "réserver ou partie", "prossimamente": "bientôt", "punti": "points", "servono": "il faut", "siamo": "nous sommes", "unisciti": "rejoindre", "← Torna alle partite": "← Retour aux matchs"}, "de": {"(in produzione arriva via e-mail/SMS).": "(in der Produktion kommt er per E-Mail/SMS).", ". Lo trovi nell'app e te lo ricordiamo noi.": ". Sie finden es in der App und wir erinnern Sie.", "AL COMPLETO": "VOLL", "Accesso": "Anmeldung", "Albo d'Oro": "Ehrentafel", "Annulla": "Abbrechen", "Apri": "Öffnen", "Apri il contest": "Contest öffnen", "Attiva": "Aktivieren", "Attive ✓": "Aktiv ✓", "Bentornato,": "Willkommen zurück,", "Benvenuto alla Bussola": "Willkommen in La Bussola", "Burraco, scala 40, briscola, scacchi.": "Burraco, Scala 40, Briscola, Schach.", "Calendario in aggiornamento.": "Spielplan wird aktualisiert.", "Calendario non ancora disponibile.": "Kalender noch nicht verfügbar.", "Cambia e-mail": "E-Mail ändern", "Campi": "Plätze", "Campionati sport": "Sportmeisterschaften", "Campo": "Platz", "Campo prenotato": "Platz gebucht", "Canto": "Gesang", "Capitano": "Kapitän", "Casata": "Haus", "Chi copre le partite?": "Wer besetzt die Spiele?", "Chiudi": "Schließen", "Ci ripenso": "Doch dabei", "Ci sono": "Ich bin dabei", "Classifica generale": "Gesamtwertung", "Codice a 6 cifre": "6-stelliger Code", "Codice non valido o scaduto": "Ungültiger oder abgelaufener Code", "Condividi": "Teilen", "Condividi con la casata": "Mit dem Haus teilen", "Conferimento": "Abgabe", "Conferma prenotazione": "Buchung bestätigen", "Confermo": "Bestätigen", "Convoca giocatori": "Spieler einberufen", "Convoca i giocatori": "Spieler einberufen", "Convoca i selezionati": "Ausgewählte einberufen", "Convoca la casata": "Haus einberufen", "Convoca la tua casata": "Rufen Sie Ihr Haus ein", "Convocati": "Einberufen", "Convocazione vincolante": "Verbindliche Einberufung", "Convocazioni, cambi orario e serate. Con il tuo consenso.": "Einberufungen, Terminänderungen und Abende. Mit Ihrer Zustimmung.", "Copertura infortuni": "Unfallversicherung", "Coppa": "Pokal", "Coppa delle Casate": "Häuser-Pokal", "Cosa ti dà": "Was es Ihnen bringt", "Cosa vedere": "Sehenswertes", "Coworking": "Coworking", "Dinieghi:": "Absagen:", "Discipline": "Disziplinen", "Disponibile": "Verfügbar", "Disponibile solo online": "Nur online verfügbar", "Domani": "Morgen", "Domenica": "Sonntag", "Emergenze & servizi": "Notfälle & Dienste", "Emergenze (112)": "Notruf (112)", "Entra": "Anmelden", "Entra con la tua e-mail": "Mit Ihrer E-Mail anmelden", "Errore di rete": "Netzwerkfehler", "Es. 'Caruso' alla chitarra": "z. B. ‚Caruso‘ auf der Gitarre", "Es. Crêuza de mä, Sidún": "z. B. Crêuza de mä, Sidún", "Es. Fabrizio De André — Crêuza de mä": "z. B. Fabrizio De André — Crêuza de mä", "Esci / cambia tessera": "Abmelden / Karte wechseln", "Fasce orarie": "Zeitfenster", "Fatto!": "Fertig!", "Forza": "Los", "Gioca con gli altri": "Mit anderen spielen", "Giochi da Tavolo": "Brettspiele", "Giochi la Coppa delle Casate": "Sie spielen den Häuser-Pokal", "Giorno": "Tag", "Gironi, calendario e risultati.": "Gruppen, Spielplan und Ergebnisse.", "Guida del residence": "Residenz-Guide", "Hai declinato": "Sie haben abgesagt", "Hai già declinato tre volte in stagione: questa convocazione è vincolante.": "Sie haben diese Saison bereits dreimal abgesagt: Diese Einberufung ist verbindlich.", "Hai tre minuti. Scegli cosa porti sul Bussola Stage.": "Sie haben drei Minuten. Wählen Sie, was Sie auf die Bussola Stage bringen.", "Ho capito": "Verstanden", "I brani che vuoi ascoltare": "Die Titel, die Sie hören möchten", "I vincitori della stagione restano scritti alla Bussola.": "Die Sieger der Saison bleiben in La Bussola verzeichnet.", "Il tuo posto nell'Albo d'Oro": "Ihr Platz auf der Ehrentafel", "In caso di necessità.": "Im Bedarfsfall.", "In due righe cosa significa per te...": "In zwei Zeilen, was es Ihnen bedeutet...", "Info": "Info", "Inserisci il codice": "Code eingeben", "Inserisci il codice tessera.": "Geben Sie den Kartencode ein.", "Inserisci un’e-mail valida": "Geben Sie eine gültige E-Mail ein", "Invia il codice": "Code senden", "Invia la proposta": "Vorschlag senden", "Inviti della casata": "Haus-Einladungen", "Iscritto!": "Angemeldet!", "La comunità": "Die Gemeinschaft", "La sfida di venerdì": "Die Freitags-Herausforderung", "La stand-up è benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.": "Stand-up ist willkommen, mit gemäßigter Sprache: In La Bussola sind auch Familien.", "La tua casata": "Ihr Haus", "La tua casata ti invita": "Ihr Haus lädt Sie ein", "La tua e-mail": "Ihre E-Mail", "La tua esibizione": "Ihr Auftritt", "La tua proposta è in lista": "Ihr Vorschlag ist auf der Liste", "Le mie notifiche": "Meine Benachrichtigungen", "Le proposte di questa settimana diventano la scaletta di martedì prossimo.": "Die Vorschläge dieser Woche werden zur Playlist des nächsten Dienstags.", "Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.": "Die Regeln für Pokal, Contest und Vorschläge sowie die Regelwerke der laufenden Disziplinen.", "Le tue convocazioni": "Ihre Einberufungen", "Libero": "Frei", "Lingua impostata": "Sprache eingestellt", "Martedì": "Dienstag", "Modalità test: il codice è": "Testmodus: Der Code lautet", "Monologo": "Monolog", "Nessun periodo configurato.": "Kein Zeitraum konfiguriert.", "Nessun regolamento generale.": "Keine allgemeinen Regeln.", "Nessun risultato ancora.": "Noch keine Ergebnisse.", "Nessuna notifica.": "Keine Benachrichtigungen.", "Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!": "Derzeit keine offenen Spiele. Starten Sie selbst eines im Bereich Plätze!", "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).": "Derzeit keine Spiele zu besetzen (erfordert Kapitän-Zugang und einen vom Staff erstellten Spielplan).", "Nessuno slot per questa data.": "Keine Zeitfenster für dieses Datum.", "No": "Nein", "Non disponibile": "Nicht verfügbar", "Non riesco a convocare ora": "Einberufung derzeit nicht möglich", "Non riuscito": "Fehlgeschlagen", "Notifiche attivate: ti avviseremo per casata ed eventi": "Benachrichtigungen aktiv: Wir informieren Sie über Haus und Events", "Notifiche casata & eventi": "Haus- & Event-Benachrichtigungen", "Notifiche disattivate": "Benachrichtigungen deaktiviert", "Numeri utili": "Nützliche Nummern", "Numeri utili & servizi": "Nützliche Nummern & Dienste", "Numero unico europeo": "Einheitliche europäische Notrufnummer", "Oggi": "Heute", "Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.": "Jedes Spiel aktualisiert die Pokalwertung. Format: Gruppen, dann Halbfinale und Finale.", "PG": "Sp", "Partita al completo, ci vediamo in campo! 🎾": "Spiel voll, wir sehen uns auf dem Platz! 🎾", "Partita aperta": "Offenes Spiel", "Partite aperte": "Offene Spiele", "Perché lo proponi?": "Warum schlagen Sie sie vor?", "Perfetto": "Perfekt", "Posti disponibili": "Verfügbare Plätze", "Posti esauriti per questa serata.": "Ausverkauft für diesen Abend.", "Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.": "Begrenzte Plätze: max. 8 vormittags und 8 nachmittags. Der <b>ganze Tag</b> belegt einen Platz in beiden Zeitfenstern.", "Prenota": "Buchen", "Prenota i miei tre minuti": "Meine drei Minuten buchen", "Prenotazione": "Buchung", "Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriverà più avanti).": "Buchung mit begrenzter Platzzahl: Der Beitrag wird bei Bestätigung an der Kasse bezahlt (In-App-Zahlung folgt später).", "Prenotazione campi": "Platzbuchung", "Prenotazione campi disponibile solo online": "Platzbuchung nur online verfügbar", "Prenotazione non riuscita": "Buchung fehlgeschlagen", "Prenotazione non riuscita: riprova": "Buchung fehlgeschlagen: erneut versuchen", "Prenotazione registrata": "Buchung erfasst", "Presenza confermata": "Teilnahme bestätigt", "Presenza confermata ✓": "Teilnahme bestätigt ✓", "Proponi": "Vorschlagen", "Proponi un vinile": "Eine Platte vorschlagen", "Prossime partite": "Nächste Spiele", "Pt": "Pkt", "Quale vinile?": "Welche Platte?", "Quante persone": "Wie viele Personen", "Quota": "Beitrag", "Raccolta rifiuti": "Müllabfuhr", "Regolamenti": "Regeln", "Regolamenti & Albo d'Oro": "Regeln & Ehrentafel", "Regole & storia": "Regeln & Geschichte", "Regole di Coppa, Contest e Proposte; le edizioni passate.": "Regeln zu Pokal, Contest und Vorschlägen; frühere Ausgaben.", "Rilancia la sfida ai tuoi. Forza": "Fordern Sie die Ihren heraus. Los", "Rispondi disponibile o no, senza biglietto né consumazione obbligatoria.": "Antworten Sie verfügbar oder nicht, ohne Ticket oder Verzehrzwang.", "Risultati recenti": "Aktuelle Ergebnisse", "Ritiro dalle": "Abholung ab", "Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.": "Rot = weniger Verfügbare als das Minimum. Tippen Sie auf ein Spiel, um einzeln einzuberufen.", "Salgo": "Auf die Bühne", "Salgo sul palco": "Ich gehe auf die Bühne", "Scegli la lingua": "Sprache wählen", "Scegli la lingua dell'app": "App-Sprache wählen", "Sei in lista per": "Sie stehen auf der Liste für", "Sei in scaletta per domenica": "Sie stehen am Sonntag auf dem Programm", "Sei nostro ospite: partecipa quando vuoi, nessun obbligo.": "Sie sind unser Gast: Machen Sie mit, wann Sie möchten, ohne Verpflichtung.", "Seleziona almeno un giocatore": "Wählen Sie mindestens einen Spieler", "Serata dei Clan": "Clan-Abend", "Serata dei Clan · Contest": "Clan-Abend · Contest", "Serata su prenotazione": "Abend auf Reservierung", "Serve gente — convoca": "Spieler nötig — einberufen", "Socio": "Mitglied", "Sport & Tornei": "Sport & Turniere", "Sport, giochi da tavolo e prove artistiche con il tuo clan.": "Sport, Brettspiele und künstlerische Wettbewerbe mit Ihrem Clan.", "Spunta chi vuoi convocare.": "Wählen Sie aus, wen Sie einberufen möchten.", "Squadra": "Team", "Stiamo valutando con la compagnia una copertura per le attività sportive.": "Wir prüfen mit der Versicherung eine Deckung für Sportaktivitäten.", "Strumenti del capitano": "Kapitän-Tools", "Strumento": "Instrument", "Tessera": "Karte", "Tessera non trovata. Controlla il codice o usa l’e-mail.": "Karte nicht gefunden. Prüfen Sie den Code oder nutzen Sie die E-Mail.", "Testo copiato: incollalo nel gruppo": "Text kopiert: Fügen Sie ihn in die Gruppe ein", "Ti abbiamo inviato un codice a": "Wir haben einen Code gesendet an", "Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.": "Wir senden Ihnen einen Einmalcode (OTP) oder einen Magic Link. Kein Passwort zu merken.", "Titolo / cosa presenti": "Titel / was Sie präsentieren", "Tocca una serata per i dettagli e per prenotare.": "Tippen Sie auf einen Abend für Details und zum Buchen.", "Turno": "Zeitfenster", "Un momento": "Einen Moment", "Unisciti": "Mitmachen", "Unisciti a una partita con posti liberi: quando si completa, è fatta.": "Treten Sie einem Spiel mit freien Plätzen bei: Sobald es voll ist, geht’s los.", "V": "S", "Valida fino al": "Gültig bis", "Verifica": "Verifizierung", "Vincitore:": "Sieger:", "a persona": "pro Person", "con": "mit", "da saldare": "zu zahlen", "da saldare in cassa": "an der Kasse zu zahlen", "dinieghi": "Absagen", "dispon.": "verf.", "disponibile": "verfügbar", "disponibili": "verfügbar", "diventa vincolante solo dopo il terzo": "wird erst nach dem dritten verbindlich", "giocatori": "Spieler", "in attesa": "ausstehend", "in definizione": "in Klärung", "la nostra casata": "unser Haus", "la serata": "den Abend", "mancano": "fehlen", "non disp.": "nicht verf.", "nuovo": "neu", "pers.": "Pers.", "postazione": "Arbeitsplatz", "posti": "Plätze", "posti? Gli altri soci potranno unirsi.": "Plätzen? Andere Mitglieder können mitmachen.", "posto": "Platz", "prenota o partita": "buchen oder Spiel", "prossimamente": "demnächst", "punti": "Punkte", "servono": "benötigt", "siamo": "wir sind", "unisciti": "mitmachen", "← Torna alle partite": "← Zurück zu den Spielen"}, "es": {"(in produzione arriva via e-mail/SMS).": "(en producción llega por correo/SMS).", ". Lo trovi nell'app e te lo ricordiamo noi.": ". Lo tienes en la app y te lo recordamos.", "AL COMPLETO": "COMPLETO", "Accesso": "Acceso", "Albo d'Oro": "Palmarés", "Annulla": "Cancelar", "Apri": "Abrir", "Apri il contest": "Abrir el concurso", "Attiva": "Activar", "Attive ✓": "Activas ✓", "Bentornato,": "Bienvenido de nuevo,", "Benvenuto alla Bussola": "Bienvenido a La Bussola", "Burraco, scala 40, briscola, scacchi.": "Burraco, Escala 40, Briscola, ajedrez.", "Calendario in aggiornamento.": "Calendario en actualización.", "Calendario non ancora disponibile.": "Calendario aún no disponible.", "Cambia e-mail": "Cambiar correo", "Campi": "Pistas", "Campionati sport": "Campeonatos deportivos", "Campo": "Pista", "Campo prenotato": "Pista reservada", "Canto": "Canto", "Capitano": "Capitán", "Casata": "Casa", "Chi copre le partite?": "¿Quién cubre los partidos?", "Chiudi": "Cerrar", "Ci ripenso": "Me lo repienso", "Ci sono": "Cuenta conmigo", "Classifica generale": "Clasificación general", "Codice a 6 cifre": "Código de 6 cifras", "Codice non valido o scaduto": "Código no válido o caducado", "Condividi": "Compartir", "Condividi con la casata": "Compartir con la casa", "Conferimento": "Entrega", "Conferma prenotazione": "Confirmar reserva", "Confermo": "Confirmo", "Convoca giocatori": "Convocar jugadores", "Convoca i giocatori": "Convocar a los jugadores", "Convoca i selezionati": "Convocar a los seleccionados", "Convoca la casata": "Convoca tu casa", "Convoca la tua casata": "Convoca a tu casa", "Convocati": "Convocados", "Convocazione vincolante": "Convocatoria obligatoria", "Convocazioni, cambi orario e serate. Con il tuo consenso.": "Convocatorias, cambios de horario y veladas. Con tu consentimiento.", "Copertura infortuni": "Cobertura de lesiones", "Coppa": "Copa", "Coppa delle Casate": "Copa de las Casas", "Cosa ti dà": "Qué te ofrece", "Cosa vedere": "Qué ver", "Coworking": "Coworking", "Dinieghi:": "Rechazos:", "Discipline": "Disciplinas", "Disponibile": "Disponible", "Disponibile solo online": "Disponible solo en línea", "Domani": "Mañana", "Domenica": "Domingo", "Emergenze & servizi": "Emergencias y servicios", "Emergenze (112)": "Emergencias (112)", "Entra": "Entrar", "Entra con la tua e-mail": "Entra con tu correo", "Errore di rete": "Error de red", "Es. 'Caruso' alla chitarra": "Ej. ‘Caruso’ a la guitarra", "Es. Crêuza de mä, Sidún": "Ej. Crêuza de mä, Sidún", "Es. Fabrizio De André — Crêuza de mä": "Ej. Fabrizio De André — Crêuza de mä", "Esci / cambia tessera": "Salir / cambiar tarjeta", "Fasce orarie": "Franjas horarias", "Fatto!": "¡Hecho!", "Forza": "Vamos", "Gioca con gli altri": "Juega con los demás", "Giochi da Tavolo": "Juegos de mesa", "Giochi la Coppa delle Casate": "Juegas la Copa de las Casas", "Giorno": "Día", "Gironi, calendario e risultati.": "Grupos, calendario y resultados.", "Guida del residence": "Guía del residence", "Hai declinato": "Has rechazado", "Hai già declinato tre volte in stagione: questa convocazione è vincolante.": "Ya has rechazado tres veces esta temporada: esta convocatoria es obligatoria.", "Hai tre minuti. Scegli cosa porti sul Bussola Stage.": "Tienes tres minutos. Elige qué llevas al Bussola Stage.", "Ho capito": "Entendido", "I brani che vuoi ascoltare": "Las canciones que quieres escuchar", "I vincitori della stagione restano scritti alla Bussola.": "Los ganadores de la temporada quedan inscritos en La Bussola.", "Il tuo posto nell'Albo d'Oro": "Tu lugar en el Palmarés", "In caso di necessità.": "En caso de necesidad.", "In due righe cosa significa per te...": "En dos líneas, qué significa para ti...", "Info": "Info", "Inserisci il codice": "Introduce el código", "Inserisci il codice tessera.": "Introduce el código de la tarjeta.", "Inserisci un’e-mail valida": "Introduce un correo válido", "Invia il codice": "Enviar el código", "Invia la proposta": "Enviar la propuesta", "Inviti della casata": "Invitaciones de la casa", "Iscritto!": "¡Inscrito!", "La comunità": "La comunidad", "La sfida di venerdì": "El reto del viernes", "La stand-up è benvenuta, con linguaggio moderato: alla Bussola ci sono anche le famiglie.": "El stand-up es bienvenido, con lenguaje moderado: en La Bussola también hay familias.", "La tua casata": "Tu casa", "La tua casata ti invita": "Tu casa te invita", "La tua e-mail": "Tu correo", "La tua esibizione": "Tu actuación", "La tua proposta è in lista": "Tu propuesta está en la lista", "Le mie notifiche": "Mis notificaciones", "Le proposte di questa settimana diventano la scaletta di martedì prossimo.": "Las propuestas de esta semana forman la lista del próximo martes.", "Le regole di Coppa, Contest e Proposte, e i regolamenti delle discipline in corso.": "Las reglas de la Copa, el Concurso y las Propuestas, y los reglamentos de las disciplinas en curso.", "Le tue convocazioni": "Tus convocatorias", "Libero": "Libre", "Lingua impostata": "Idioma establecido", "Martedì": "Martes", "Modalità test: il codice è": "Modo de prueba: el código es", "Monologo": "Monólogo", "Nessun periodo configurato.": "Ningún periodo configurado.", "Nessun regolamento generale.": "Sin reglamento general.", "Nessun risultato ancora.": "Aún no hay resultados.", "Nessuna notifica.": "Sin notificaciones.", "Nessuna partita aperta al momento. Aprine una tu dalla sezione Campi!": "¡Ninguna partida abierta ahora mismo. Abre una tú desde la sección Pistas!", "Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).": "Ningún partido que cubrir por ahora (requiere acceso de capitán y un calendario generado por el staff).", "Nessuno slot per questa data.": "Sin franjas para esta fecha.", "No": "No", "Non disponibile": "No disponible", "Non riesco a convocare ora": "No se puede convocar ahora", "Non riuscito": "No se pudo", "Notifiche attivate: ti avviseremo per casata ed eventi": "Notificaciones activadas: te avisaremos sobre tu casa y los eventos", "Notifiche casata & eventi": "Notificaciones de casa y eventos", "Notifiche disattivate": "Notificaciones desactivadas", "Numeri utili": "Números útiles", "Numeri utili & servizi": "Números útiles y servicios", "Numero unico europeo": "Número único europeo", "Oggi": "Hoy", "Ogni sfida aggiorna la classifica della Coppa. Formula: gironi, poi semifinali e finale.": "Cada partido actualiza la clasificación de la Copa. Formato: grupos, luego semifinales y final.", "PG": "PJ", "Partita al completo, ci vediamo in campo! 🎾": "¡Partida completa, nos vemos en la pista! 🎾", "Partita aperta": "Partida abierta", "Partite aperte": "Partidas abiertas", "Perché lo proponi?": "¿Por qué lo propones?", "Perfetto": "Perfecto", "Posti disponibili": "Plazas disponibles", "Posti esauriti per questa serata.": "Plazas agotadas para esta velada.", "Posti limitati: massimo 8 la mattina e 8 il pomeriggio. La <b>giornata intera</b> occupa un posto in entrambi i turni.": "Plazas limitadas: máximo 8 por la mañana y 8 por la tarde. El <b>día completo</b> ocupa una plaza en ambos turnos.", "Prenota": "Reservar", "Prenota i miei tre minuti": "Reservar mis tres minutos", "Prenotazione": "Reserva", "Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriverà più avanti).": "Reserva de plazas limitadas: la cuota se paga en caja al confirmar (el pago in-app llegará más adelante).", "Prenotazione campi": "Reserva de pistas", "Prenotazione campi disponibile solo online": "Reserva de pistas disponible solo en línea", "Prenotazione non riuscita": "Reserva fallida", "Prenotazione non riuscita: riprova": "Reserva fallida: inténtalo de nuevo", "Prenotazione registrata": "Reserva registrada", "Presenza confermata": "Asistencia confirmada", "Presenza confermata ✓": "Asistencia confirmada ✓", "Proponi": "Proponer", "Proponi un vinile": "Propón un vinilo", "Prossime partite": "Próximos partidos", "Pt": "Pts", "Quale vinile?": "¿Qué vinilo?", "Quante persone": "Cuántas personas", "Quota": "Cuota", "Raccolta rifiuti": "Recogida de residuos", "Regolamenti": "Reglamentos", "Regolamenti & Albo d'Oro": "Reglamentos y Palmarés", "Regole & storia": "Reglas e historia", "Regole di Coppa, Contest e Proposte; le edizioni passate.": "Reglas de Copa, Concurso y Propuestas; ediciones pasadas.", "Rilancia la sfida ai tuoi. Forza": "Lanza el reto a los tuyos. ¡Vamos", "Rispondi disponibile o no, senza biglietto né consumazione obbligatoria.": "Responde disponible o no, sin entrada ni consumición obligatoria.", "Risultati recenti": "Resultados recientes", "Ritiro dalle": "Recogida desde", "Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.": "Rojo = menos disponibles que el mínimo. Toca un partido para convocar individualmente.", "Salgo": "Al escenario", "Salgo sul palco": "Subo al escenario", "Scegli la lingua": "Elige el idioma", "Scegli la lingua dell'app": "Elige el idioma de la app", "Sei in lista per": "Estás en la lista para", "Sei in scaletta per domenica": "Estás en el programa del domingo", "Sei nostro ospite: partecipa quando vuoi, nessun obbligo.": "Eres nuestro invitado: participa cuando quieras, sin obligación.", "Seleziona almeno un giocatore": "Selecciona al menos un jugador", "Serata dei Clan": "Noche de los Clanes", "Serata dei Clan · Contest": "Noche de los Clanes · Concurso", "Serata su prenotazione": "Velada con reserva", "Serve gente — convoca": "Faltan jugadores — convoca", "Socio": "Socio", "Sport & Tornei": "Deporte y Torneos", "Sport, giochi da tavolo e prove artistiche con il tuo clan.": "Deporte, juegos de mesa y pruebas artísticas con tu clan.", "Spunta chi vuoi convocare.": "Marca a quién quieres convocar.", "Squadra": "Equipo", "Stiamo valutando con la compagnia una copertura per le attività sportive.": "Estamos evaluando con la compañía una cobertura para las actividades deportivas.", "Strumenti del capitano": "Herramientas del capitán", "Strumento": "Instrumento", "Tessera": "Tarjeta", "Tessera non trovata. Controlla il codice o usa l’e-mail.": "Tarjeta no encontrada. Comprueba el código o usa el correo.", "Testo copiato: incollalo nel gruppo": "Texto copiado: pégalo en el grupo", "Ti abbiamo inviato un codice a": "Hemos enviado un código a", "Ti inviamo un codice usa-e-getta (OTP) o un link magico. Nessuna password da ricordare.": "Te enviamos un código de un solo uso (OTP) o un enlace mágico. Sin contraseña que recordar.", "Titolo / cosa presenti": "Título / qué presentas", "Tocca una serata per i dettagli e per prenotare.": "Toca una velada para ver los detalles y reservar.", "Turno": "Turno", "Un momento": "Un momento", "Unisciti": "Unirse", "Unisciti a una partita con posti liberi: quando si completa, è fatta.": "Únete a una partida con plazas libres: cuando se completa, listo.", "V": "V", "Valida fino al": "Válida hasta el", "Verifica": "Verificación", "Vincitore:": "Ganador:", "a persona": "por persona", "con": "con", "da saldare": "a pagar", "da saldare in cassa": "a pagar en caja", "dinieghi": "rechazos", "dispon.": "disp.", "disponibile": "disponible", "disponibili": "disponibles", "diventa vincolante solo dopo il terzo": "se vuelve obligatoria solo tras el tercero", "giocatori": "jugadores", "in attesa": "pendiente", "in definizione": "en definición", "la nostra casata": "nuestra casa", "la serata": "la velada", "mancano": "faltan", "non disp.": "no disp.", "nuovo": "nuevo", "pers.": "pers.", "postazione": "puesto", "posti": "plazas", "posti? Gli altri soci potranno unirsi.": "plazas? Otros socios podrán unirse.", "posto": "puesto", "prenota o partita": "reserva o partido", "prossimamente": "próximamente", "punti": "puntos", "servono": "hacen falta", "siamo": "estamos", "unisciti": "únete", "← Torna alle partite": "← Volver a los partidos"}};
const UI_HOST = {
  en: { 'Casa mia': 'My stay', 'Le mie case': 'My properties', 'Come arrivare': 'Getting there', 'Regole della casa': 'House rules', 'Orario di check-out': 'Check-out time', 'Apri sulla mappa': 'Open on the map', 'Isolato': 'Block', 'Numero': 'Number', 'Il tuo soggiorno': 'Your stay', 'Aggiungi struttura': 'Add property', 'Modifica': 'Edit', 'Elimina': 'Delete', 'Nome struttura': 'Property name', 'Regole': 'Rules', 'Le tue strutture': 'Your properties', 'Non hai ancora aggiunto strutture.': "You haven't added any properties yet.", 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'The information is encrypted: visible only to you and your linked guests.', 'Dati della struttura non disponibili': 'Property data unavailable', 'dal': 'from', 'al': 'to', 'Gestisci le case vacanza che ospiti nel residence.': 'Manage the holiday homes you host in the residence.', 'Come raggiungere la casa e le regole del soggiorno.': 'How to reach the house and the stay rules.' },
  fr: { 'Casa mia': 'Mon logement', 'Le mie case': 'Mes logements', 'Come arrivare': 'Y arriver', 'Regole della casa': 'Règlement intérieur', 'Orario di check-out': 'Heure de départ', 'Apri sulla mappa': 'Ouvrir sur la carte', 'Isolato': 'Îlot', 'Numero': 'Numéro', 'Il tuo soggiorno': 'Votre séjour', 'Aggiungi struttura': 'Ajouter un logement', 'Modifica': 'Modifier', 'Elimina': 'Supprimer', 'Nome struttura': 'Nom du logement', 'Regole': 'Règles', 'Le tue strutture': 'Vos logements', 'Non hai ancora aggiunto strutture.': "Vous n'avez pas encore ajouté de logement.", 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'Les informations sont chiffrées : visibles uniquement par vous et vos invités liés.', 'Dati della struttura non disponibili': 'Données du logement indisponibles', 'dal': 'du', 'al': 'au', 'Gestisci le case vacanza che ospiti nel residence.': 'Gérez les logements que vous accueillez dans la résidence.', 'Come raggiungere la casa e le regole del soggiorno.': "Comment rejoindre le logement et le règlement du séjour." },
  de: { 'Casa mia': 'Meine Unterkunft', 'Le mie case': 'Meine Unterkünfte', 'Come arrivare': 'Anfahrt', 'Regole della casa': 'Hausordnung', 'Orario di check-out': 'Check-out-Zeit', 'Apri sulla mappa': 'Auf der Karte öffnen', 'Isolato': 'Block', 'Numero': 'Nummer', 'Il tuo soggiorno': 'Ihr Aufenthalt', 'Aggiungi struttura': 'Unterkunft hinzufügen', 'Modifica': 'Bearbeiten', 'Elimina': 'Löschen', 'Nome struttura': 'Name der Unterkunft', 'Regole': 'Regeln', 'Le tue strutture': 'Ihre Unterkünfte', 'Non hai ancora aggiunto strutture.': 'Sie haben noch keine Unterkunft hinzugefügt.', 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'Die Daten sind verschlüsselt: nur für Sie und Ihre verknüpften Gäste sichtbar.', 'Dati della struttura non disponibili': 'Unterkunftsdaten nicht verfügbar', 'dal': 'vom', 'al': 'bis', 'Gestisci le case vacanza che ospiti nel residence.': 'Verwalten Sie die Ferienwohnungen, die Sie in der Anlage anbieten.', 'Come raggiungere la casa e le regole del soggiorno.': 'Wie Sie die Unterkunft erreichen und die Aufenthaltsregeln.' },
  es: { 'Casa mia': 'Mi alojamiento', 'Le mie case': 'Mis alojamientos', 'Come arrivare': 'Cómo llegar', 'Regole della casa': 'Normas de la casa', 'Orario di check-out': 'Hora de salida', 'Apri sulla mappa': 'Abrir en el mapa', 'Isolato': 'Manzana', 'Numero': 'Número', 'Il tuo soggiorno': 'Tu estancia', 'Aggiungi struttura': 'Añadir alojamiento', 'Modifica': 'Editar', 'Elimina': 'Eliminar', 'Nome struttura': 'Nombre del alojamiento', 'Regole': 'Normas', 'Le tue strutture': 'Tus alojamientos', 'Non hai ancora aggiunto strutture.': 'Aún no has añadido alojamientos.', 'Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.': 'La información está cifrada: visible solo para ti y tus huéspedes vinculados.', 'Dati della struttura non disponibili': 'Datos del alojamiento no disponibles', 'dal': 'del', 'al': 'al', 'Gestisci le case vacanza che ospiti nel residence.': 'Gestiona las casas vacacionales que alojas en el residence.', 'Come raggiungere la casa e le regole del soggiorno.': 'Cómo llegar a la casa y las normas de la estancia.' },
};

// --- Traduzioni stringhe v4.20→v4.36 (registrazione, host, onboarding, self-order, comanda, eventi) ---
const UI_EXTRA = {"en": {"112 e il tuo contatto di emergenza": "112 and your emergency contact", "112 · emergenze": "112 · emergencies", "A quale casa lo colleghi?": "Which house do you link them to?", "Abbiamo avvisato": "We've notified", "Accetto il trattamento dei dati (privacy)": "I accept the processing of my data (privacy)", "Aggiungi": "Add", "Aggiungi alla Home": "Add to Home", "Aggiungi alla schermata Home": "Add to Home screen", "Aggiungi la tua casa vacanza: potrai accogliere i visitatori.": "Add your holiday home: you'll be able to welcome visitors.", "Aggiungi prima la tua casa, poi conferma l'ospite.": "Add your home first, then confirm the guest.", "Aggiungi struttura": "Add property", "Aggiungi un giocatore": "Add a player", "Al tavolo servono almeno": "The table needs at least", "Ancora niente da mostrare.": "Nothing to show yet.", "Annullare questa prenotazione?": "Cancel this booking?", "Apri ai soci": "Open to members", "Apri la partita di": "Open the game of", "Area fitness": "Fitness area", "Attenzione: mancano meno di": "Careful: there are less than", "Attivala se affitti una casa nel residence.": "Turn it on if you rent out a home in the residence.", "Bar": "Bar", "Bar, cucina e ritrovo": "Bar, kitchen and meeting point", "Benvenuto nella casata": "Welcome to the house", "Benvenuto!": "Welcome!", "Bussola Bar": "Bussola Bar", "Bussola Garden": "Bussola Garden", "Bussola Stage": "Bussola Stage", "C'è posto": "There's room", "CAPITANO": "CAPTAIN", "Cambia casata": "Change house", "Campo impegnato": "Court in use", "Campo riservato": "Reserved court", "Capitani": "Captains", "Casa di Carta": "Casa di Carta", "Casa mia": "My Home", "Case vacanza": "Holiday homes", "Cena": "Dinner", "Cena al tavolo": "Dinner at the table", "Cena confermata, ma i posti davanti al palco sono esauriti": "Dinner confirmed, but the seats in front of the stage are sold out", "Cerca chi ti ospita: riceverà una notifica e, se conferma, vedrai \"Casa mia\".": "Search for who's hosting you: they'll get a notification and, if they confirm, you'll see \"My Home\".", "Cerco la posizione…": "Finding your location…", "Chat della casata": "House chat", "Chat non disponibile": "Chat not available", "Chi gioca": "Who plays", "Chi gioca con te": "Who is playing with you", "Chi sei?": "Who are you?", "Chi ti ospita?": "Who is hosting you?", "Chi vuoi chiamare": "Who do you want to call", "Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.": "Whoever wants to be your guest registers and searches for you by name: here you confirm and link them to the home.", "Chiama": "Call", "Ci sono alcolici: al ritiro può esserti chiesto un documento. Sotto i 18 anni non si servono.": "This order contains alcohol: you may be asked for ID on collection. Not served under 18.", "Codice di accesso": "Access code", "Cognome": "Surname", "Collega": "Link", "Collega la tua casa": "Link your home", "Comanda": "Order", "Come arrivare": "Getting there", "Come raggiungere la casa e le regole del soggiorno.": "How to reach the house and the rules of your stay.", "Come va la Coppa": "How the Cup is going", "Conferimento rifiuti": "Waste collection", "Conferma": "Confirm", "Conosci il tuo host?": "Do you know your host?", "Consenti le finestre per salvare la rassegna.": "Allow pop-ups to save the film season.", "Così resta sul telefono con la sua icona, senza cercarla ogni volta.": "This way it stays on your phone with its icon, no need to look for it each time.", "Crea profilo": "Create profile", "Dati della struttura non disponibili": "Property details not available", "Disattiva": "Turn off", "Disattivare la gestione delle case vacanza?": "Turn off holiday home management?", "Disdetta non riuscita": "Cancellation failed", "Disdici": "Cancel", "Disdire l’iscrizione a questa lezione?": "Cancel your booking for this class?", "Disdire questa prenotazione? Il campo torna libero e chi doveva giocare con te va avvisato.": "Cancel this booking? The court goes back to free and whoever was going to play with you needs to be told.", "Dopo, la lezione resta dovuta: l’istruttore è già arrivato e il posto non si rivende.": "After that the class is still owed: the instructor has already arrived and the spot cannot be resold.", "Dove mi trovo": "Where I am", "Dove si trova": "Where it is", "Durata": "Duration", "E": "And", "Elenco non disponibile": "List not available", "Fatto": "Done", "Fino ai 18 anni le prenota un adulto per te.": "Under 18, an adult books them for you.", "Fino ai 18 anni le prenotazioni a pagamento le fa un adulto per te.": "Under 18, paid bookings are made by an adult for you.", "Fitness": "Fitness", "Fotocamera non disponibile: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Camera not available: open your phone's camera and scan the QR on the table.", "Garden": "Garden", "Gestisci le case vacanza che ospiti nel residence.": "Manage the holiday homes you host in the residence.", "Giocare": "Play", "Giochi da tavolo": "Board games", "Giornata libera": "Free day", "Gruppo capitani": "Captains' group", "Guida": "Guide", "Hai anche": "You also have", "Hai diritto alla prima fila": "You're entitled to the front row", "Hai esaurito le prenotazioni di questa settimana su questo campo": "You've used up this week's bookings on this court", "Ho già un account": "I already have an account", "Home": "Home", "I film che proponiamo per la stagione.": "The films we're showing this season.", "I film della stagione. Le date delle proiezioni si trovano nell'app, sezione Stage: possono cambiare.": "The season's films. Screening dates are in the app, Stage section: they can change.", "I miei posti": "My seats", "I miei visitatori": "My visitors", "I tuoi dati": "Your details", "Il 112 è il numero unico delle emergenze. Il residence non è un servizio di soccorso: qui ci sono solo i numeri che rispondono davvero, a portata di dito.": "112 is the single emergency number. The residence is not a rescue service: these are only the numbers that actually answer, within reach.", "Il campo lo prenota un adulto: tu ti unisci alla partita e giochi.": "An adult books the court: you join the game and play.", "Il campo è al completo.": "The court is full.", "Il codice è sul tavolo. Da lì l’ordine parte già con il numero giusto.": "The code is on the table. From there the order starts with the right number already.", "Il consenso privacy è necessario per registrarsi": "Privacy consent is required to register", "Il mio contatto": "My contact", "Il tavolo lo assegniamo noi. Se siete di più o di meno, lo dite al personale.": "We assign the table. If you're more or fewer, just tell the staff.", "Il tavolo si prenota a turni.": "The table is booked in sessions.", "Il telefono non sa dirmi dove sei.": "Your phone can't tell me where you are.", "Il tuo codice di accesso": "Your access code", "Il tuo host": "Your host", "Il tuo posto": "Your seat", "Il tuo profilo è attivo. Conserva il tuo codice per accedere anche senza e-mail:": "Your profile is active. Keep your code to log in even without e-mail:", "Il tuo soggiorno": "Your stay", "In attesa di conferma": "Awaiting confirmation", "Indica chi ti ospita per vedere indicazioni e regole del soggiorno.": "Tell us who's hosting you to see stay directions and rules.", "Indietro": "Back", "Informazioni utili": "Useful information", "Ingresso libero": "Free entry", "Inizia": "Start", "Inquadra il QR del tavolo": "Scan the table's QR code", "Installa l’app": "Install the app", "Invia": "Send", "Invia ordine": "Send order", "Iscritto": "Signed up", "Iscriviti": "Sign up", "Iscrizione annullata": "Booking cancelled", "Iscrizione confermata": "Sign-up confirmed", "Iscrizione non riuscita": "Sign-up failed", "Isolato": "Block", "La chat della casata": "The house chat", "La chat interna alla casata arriverà in una prossima versione.": "The house's internal chat is coming in a future version.", "La cucina consegna dalle": "The kitchen serves from", "La mia casata": "My house", "La settimana": "The week", "La tua postazione": "Your desk", "La tua prenotazione": "Your booking", "La tua tessera": "Your card", "Le date non sono indicate: una serata speciale o il maltempo possono spostare una proiezione. Il giorno esatto lo trovi in <b>Stage</b>, dove si prenota il posto.": "Dates aren't listed: a special evening or bad weather can move a screening. You'll find the exact day under <b>Stage</b>, where seats are booked.", "Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.": "The information is encrypted: visible only to you and your linked guests.", "Le mie case": "My homes", "Le mie lezioni": "My classes", "Le mie postazioni": "My desks", "Le mie prenotazioni": "My bookings", "Le mie spese": "My spending", "Le prenotazioni a pagamento — cena, bar, lezioni e serate — le fa un adulto per te: fino ai 18 anni non si possono prendere impegni di spesa da soli.": "Paid bookings — dinner, bar, classes and evenings — are made by an adult for you: under 18 you can't commit to spending on your own.", "Le serate con quota le prenota un adulto per te.": "Evenings with a fee are booked by an adult for you.", "Le serate speciali": "Special evenings", "Le tue prenotazioni": "Your bookings", "Le tue strutture": "Your properties", "Le ultime": "Most recent", "Leggi questi numeri all'operatore": "Read these numbers to the operator", "Lezione al completo.": "Class is full.", "Lezioni con istruttore": "Classes with an instructor", "Lezioni non disponibili": "Classes not available", "Menù non disponibile": "Menu not available", "Migliore casata": "Best house", "Modifica": "Edit", "Mostra solo le prossime": "Show only the next ones", "NON PRENOTABILE": "NOT BOOKABLE", "Nessun host trovato con questo nome.": "No host found with this name.", "Nessun iscritto a questa casata.": "No members in this house.", "Nessun messaggio. Comincia tu.": "No messages. Start the conversation.", "Nessun turno di coworking.": "No coworking sessions.", "Nessun visitatore collegato.": "No visitor linked.", "Nessuna lezione in programma.": "No classes scheduled.", "Nessuna serata su prenotazione al momento.": "No bookable evenings at the moment.", "Nessuno spettacolo in programma.": "No shows scheduled.", "Nome": "Name", "Nome e cognome obbligatori": "Name and surname required", "Nome o cognome dell'host": "Host's first or last name", "Nome struttura": "Property name", "Nome, oppure tessera BR-…": "Name, or card BR-…", "Non hai ancora aggiunto strutture.": "You haven't added any properties yet.", "Non hai postazioni prenotate.": "You have no desks booked.", "Non lo conosco ora · salta": "I don't know it now · skip", "Non riesco a ottenere la posizione. Di' all'operatore il nome del residence e il numero della villa.": "I can't get your location. Tell the operator the name of the residence and the villa number.", "Numeri rapidi": "Quick numbers", "Numero": "Number", "Oggi al residence": "Today at the residence", "Ogni casata accoglie fino a 12 soci. Se è al completo, scegline un’altra.": "Each house holds up to 12 members. If it's full, choose another.", "Orario di check-out": "Check-out time", "Ordina e ritira al banco": "Order and collect at the counter", "Ordine inviato": "Order sent", "Ore di silenzio": "Quiet hours", "Ospite collegato": "Guest linked", "Ospite temporaneo: ti colleghi alla casa del tuo host.": "Temporary guest: you link to your host's home.", "Passa alla versione completa": "Switch to the full version", "Per confermare la lezione": "To confirm the class", "Per gli altri giorni usa la sezione Eventi.": "For other days use the Events section.", "Per il bar, la cena e le serate serve un adulto: fino ai 18 anni non si prenotano cose a pagamento da soli.": "The bar, dinner and evening events need an adult: under 18 you can't book paid things on your own.", "Per servizio": "By service", "Per un gruppo numeroso accostiamo più tavoli: indica quante persone siete davvero.": "For a large group we put tables together: tell us how many you really are.", "Per una riunione puoi prendere tutta la sala: scegli il numero di postazioni che ti serve.": "For a meeting you can take the whole room: choose how many desks you need.", "Perché lo segnali? (facoltativo)": "Why are you reporting it? (optional)", "Più tardi": "Later", "Portami lì": "Take me there", "Postazione al tavolo": "Desk at the table", "Posti": "Places", "Precisione": "Accuracy", "Prenota la cena": "Book dinner", "Prenotazione disdetta: il campo è tornato libero.": "Booking cancelled: the court is free again.", "Prenotazione non disponibile.": "Booking not available.", "Prenoti": "Booking", "Prenoti sempre tu, come titolare. Con <b>Apri ai soci</b> gli altri si uniscono fino a": "You always book as the holder. With <b>Open to members</b> others join up to", "Prezzo": "Price", "Programma non disponibile": "Programme not available", "Puoi aggiungere le tue case e accogliere i visitatori.": "You can add your homes and welcome visitors.", "Qualcosa non ha funzionato nel caricamento.": "Something went wrong while loading.", "Quando confermerà, comparirà \"Casa mia\" con tutte le indicazioni della struttura.": "When they confirm, \"My Home\" will appear with all the property's directions.", "Quante persone siete?": "How many of you are there?", "Quante persone?": "How many people?", "Quante postazioni": "How many desks", "Questa casata non ha ancora un capitano.": "This house doesn't have a captain yet.", "Questo codice non è il QR di un tavolo.": "This code isn't a table QR code.", "Questo telefono non legge i codici dall’app: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "This phone can't read codes from the app: open your phone's camera and scan the QR on the table.", "Qui c’è solo quello che hai fatto con la tessera: al Bar e al Garden si è serviti anche senza, e quelle consumazioni non compaiono.": "This only covers what you did with your card: at the Bar and Garden you can be served without it, and those items don’t appear here.", "Rassegna": "Film season", "Rassegna cinematografica": "Film season", "Rassegna non ancora pubblicata.": "Film season not published yet.", "Rassegna non disponibile": "Film season not available", "Registrati": "Sign up", "Registrazione non riuscita": "Registration failed", "Regole della casa": "House rules", "Richiesta inviata": "Request sent", "Richieste in attesa": "Pending requests", "Riprova": "Try again", "Riservata": "Reserved", "Rispondi e l'app trova il profilo giusto per te.": "Answer and the app finds the right profile for you.", "Sala non disponibile": "Room not available", "Salva": "Save", "Salva la tua tessera (immagine)": "Save your card (image)", "Salva o stampa la rassegna": "Save or print the film season", "Salva tessera": "Save card", "Scegli": "Choose", "Scegli la casata": "Choose the house", "Scegli la disciplina": "Choose the discipline", "Scegli la tua casata": "Choose your house", "Scollega": "Unlink", "Scollegare questo visitatore dalla casa?": "Unlink this visitor from the home?", "Scopri le nostre serate speciali": "Discover our special evenings", "Scrivi il nome di chi gioca, oppure la sua tessera.": "Write the name of who plays, or their card.", "Scrivi qui…": "Write here…", "Segnala": "Report", "Segnalare questo messaggio al gestore? Verrà letto da lui.": "Report this message to the manager? They will read it.", "Serve l'accesso con la tessera": "Card access is required", "Serve la tessera di un socio per iscriverti": "A member's card is needed to sign up", "Serve la tessera di un socio per prenotare": "A member's card is needed to book", "Serve la tessera per vedere le tue spese": "You need your card to see your spending", "Serve per accedere di nuovo con un codice via e-mail.": "It's used to log in again with a code via e-mail.", "Servono": "Needs", "Settimana": "Week", "Si disdice senza pagare fino a": "Free cancellation up to", "Si gioca: numero minimo raggiunto": "The match is on: minimum reached", "Si occupa una sedia, non un tavolo: si lavora anche in una sala condivisa.": "You take a chair, not a table: you can work in a shared room too.", "Si paga la singola lezione, in contanti a fine lezione. Sotto il minimo di iscritti la lezione non parte.": "You pay per class, in cash at the end. Below the minimum sign-ups the class doesn't run.", "Soggiorno dal": "Stay from", "Solo io": "Just me", "Sono in vacanza (visitatore)": "I'm on holiday (visitor)", "Sono residente": "I'm a resident", "Sono socio": "I'm a member", "Sono socio e residente": "I'm a member and resident", "Spettacolo": "Show", "Stage": "Stage", "Stai prenotando per stasera": "You're booking for tonight", "Stasera": "Tonight", "Stasera alle": "Tonight at", "Stasera il Garden non prende prenotazioni.": "The Garden isn't taking bookings tonight.", "Su Android (Chrome): tocca il menu (⋮) in alto a destra, poi “Aggiungi a schermata Home” / “Installa app”.": "On Android (Chrome): tap the menu (⋮) at the top right, then \"Add to Home screen\" / \"Install app\".", "Su iPhone/iPad (Safari): tocca Condividi (⬆️) in basso, poi “Aggiungi a Home”.": "On iPhone/iPad (Safari): tap Share (⬆️) at the bottom, then \"Add to Home\".", "Su prenotazione": "By reservation", "Tavolo": "Table", "Tavolo da gioco": "Games table", "Tavolo per 4 persone": "Table for 4", "Tessera salvata nelle immagini": "Card saved to your photos", "Tesserato: casata, Coppa, inviti.": "Member: house, Cup, invitations.", "Ti hanno convocato": "You've been called up", "Ti restano": "You have left", "Tieni l’app a portata di mano": "Keep the app within reach", "Tocca una lezione per iscriverti. Il colore è la disciplina.": "Tap a class to sign up. The colour is the discipline.", "Tocca una serata per i dettagli.": "Tap an evening for details.", "Togli questo avviso": "Dismiss this notice", "Totale speso": "Total spent", "Turni": "Sessions", "Tutto del socio (casata, Coppa) + gestisco case vacanza.": "Everything a member has (house, Cup) + I manage holiday homes.", "Tutto pronto": "All set", "Un socio si aggiunge con la tessera e i punti della Coppa gli vengono conteggiati. Un ospite si aggiunge col nome: gioca lo stesso, ma resta scritto chi era in campo.": "A member is added with their card, so Cup points count for them. A guest is added by name: they play all the same, but it stays written who was on court.", "Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.": "A visitor has indicated you as host: confirm to link them to the home.", "Vai alla Coppa": "Go to the Cup", "Vedi tutte": "See all", "Versione completa": "Full version", "Versione semplice": "Simple version", "Vivo nel residence; posso gestire case vacanza.": "I live in the residence; I can manage holiday homes.", "a pari merito": "tied", "al": "to", "al completo": "full", "alla Casa di Carta": "at the Casa di Carta", "alle": "at", "cena e tavolo": "dinner and table", "classifica e prossime partite": "standings and upcoming matches", "compreso": "included", "consumazione obbligatoria": "one drink included", "coperti prenotati": "covers booked", "dal": "from", "di": "by", "di più…": "more…", "dice di essere tuo ospite": "says they're your guest", "e capitani": "and captains", "entro le": "by", "es. Chiara": "e.g. Chiara", "fasce": "slots", "fasce di oggi sono già passate e non si possono prenotare.": "slots from today have already gone by and cannot be booked.", "fascia di oggi è già passata e non si può prenotare.": "slot from today has already gone by and cannot be booked.", "film": "films", "giocatori": "players", "giocatori: da soli non si occupa un tavolo.": "players: you don't take a table on your own.", "giocatori: ne mancano": "players: still missing", "giocatori; con <b>Solo io</b> lo slot resta riservato. I campi sono gratuiti.": "players; with <b>Just me</b> the slot stays reserved. The courts are free.", "gratis": "free", "in corso: chiedila al banco": "in progress: ask at the counter", "la posizione resta sul tuo telefono, non viene inviata a nessuno": "your location stays on your phone, it isn't sent to anyone", "la rassegna": "the film season", "la teniamo per chi ha più di 70 anni, fino a esaurimento. Te la assegniamo da soli.": "we keep it for over-70s, while seats last. We assign it to you ourselves.", "la tua": "yours", "lezioni con istruttore": "classes with an instructor", "minuti all’inizio, quindi la lezione resta dovuta anche se disdici. Procedo?": "minutes to the start, so the class is owed even if you cancel. Go ahead?", "minuti prima": "minutes before", "nessun posto libero": "no seats available", "nessun tavolo libero": "no free tables", "nessuna postazione libera": "no desks available", "orari, rifiuti, numeri": "hours, waste, numbers", "ordina e ritira": "order and collect", "organizzatevi fra voi": "organise among yourselves", "ospite senza tessera": "guest without card", "partita da confermare": "match to confirm", "partite da confermare": "matches to confirm", "per confermare la lezione": "to confirm the class", "per stasera, tavolo da 4": "for tonight, table for 4", "persone": "people", "piastra e friggitrice devono scaldarsi. L’ordine è già preso.": "the grill and fryer need to heat up. Your order has already been taken.", "posizione": "position", "postazioni": "desks", "postazioni libere": "desks available", "posti davanti al palco": "seats in front of the stage", "posti liberi": "seats available", "posto allo spettacolo": "a seat at the show", "prodotti": "items", "restano solo i posti in fondo": "only seats at the back are left", "segnalato": "reported", "si paga in cassa. Ti avvisiamo quando è pronto.": "pay at the till. We'll let you know when it's ready.", "soci": "members", "socio": "member", "solo per te? Nessun altro potrà unirsi.": "just for yourself? No one else will be able to join.", "su": "of", "su questo campo": "on this court", "tavoli liberi": "tables free", "tavolo": "table", "tavolo da gioco": "games table", "titolare": "holder", "unisciti a chi sta giocando": "join those already playing", "volta": "time", "volta in cui non hai pagato niente: è compreso.": "time you paid nothing: it’s included.", "volte": "times", "volte in cui non hai pagato niente: è compreso.": "times you paid nothing: it’s included.", "È fatta": "All done", "È lui/lei": "That's them"}, "fr": {"112 e il tuo contatto di emergenza": "112 et votre contact d’urgence", "112 · emergenze": "112 · urgences", "A quale casa lo colleghi?": "À quelle maison le rattaches-tu ?", "Abbiamo avvisato": "Nous avons prévenu", "Accetto il trattamento dei dati (privacy)": "J'accepte le traitement de mes données (confidentialité)", "Aggiungi": "Ajouter", "Aggiungi alla Home": "Ajouter à l'accueil", "Aggiungi alla schermata Home": "Ajouter à l'écran d'accueil", "Aggiungi la tua casa vacanza: potrai accogliere i visitatori.": "Ajoute ta maison de vacances : tu pourras accueillir des visiteurs.", "Aggiungi prima la tua casa, poi conferma l'ospite.": "Ajoute d'abord ta maison, puis confirme l'invité.", "Aggiungi struttura": "Ajouter un logement", "Aggiungi un giocatore": "Ajouter un joueur", "Al tavolo servono almeno": "À la table il faut au moins", "Ancora niente da mostrare.": "Rien à montrer pour l’instant.", "Annullare questa prenotazione?": "Annuler cette réservation ?", "Apri ai soci": "Ouvrir aux membres", "Apri la partita di": "Ouvrir la partie de", "Area fitness": "Espace fitness", "Attenzione: mancano meno di": "Attention : il reste moins de", "Attivala se affitti una casa nel residence.": "Activez-la si vous louez un logement dans la résidence.", "Bar": "Bar", "Bar, cucina e ritrovo": "Bar, cuisine et point de rencontre", "Benvenuto nella casata": "Bienvenue dans la maison", "Benvenuto!": "Bienvenue !", "Bussola Bar": "Bussola Bar", "Bussola Garden": "Bussola Garden", "Bussola Stage": "Bussola Stage", "C'è posto": "Il y a de la place", "CAPITANO": "CAPITAINE", "Cambia casata": "Changer de maison", "Campo impegnato": "Terrain occupé", "Campo riservato": "Terrain réservé", "Capitani": "Capitaines", "Casa di Carta": "Casa di Carta", "Casa mia": "Chez moi", "Case vacanza": "Locations de vacances", "Cena": "Dîner", "Cena al tavolo": "Dîner à table", "Cena confermata, ma i posti davanti al palco sono esauriti": "Dîner confirmé, mais les places devant la scène sont épuisées", "Cerca chi ti ospita: riceverà una notifica e, se conferma, vedrai \"Casa mia\".": "Cherche qui t'héberge : la personne recevra une notification et, si elle confirme, tu verras « Ma maison ».", "Cerco la posizione…": "Recherche de la position…", "Chat della casata": "Chat de la maison", "Chat non disponibile": "Chat indisponible", "Chi gioca": "Qui joue", "Chi gioca con te": "Qui joue avec vous", "Chi sei?": "Qui es-tu ?", "Chi ti ospita?": "Qui t'héberge ?", "Chi vuoi chiamare": "Qui voulez-vous appeler", "Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.": "Celui qui veut être ton invité s'inscrit et te cherche par nom : ici tu confirmes et le rattaches à la maison.", "Chiama": "Appeler", "Ci sono alcolici: al ritiro può esserti chiesto un documento. Sotto i 18 anni non si servono.": "Cette commande contient de l'alcool : une pièce d'identité peut vous être demandée au retrait. Pas de service avant 18 ans.", "Codice di accesso": "Code d'accès", "Cognome": "Nom", "Collega": "Rattacher", "Collega la tua casa": "Rattache ta maison", "Comanda": "Commande", "Come arrivare": "Comment venir", "Come raggiungere la casa e le regole del soggiorno.": "Comment rejoindre la maison et les règles du séjour.", "Come va la Coppa": "Où en est la Coupe", "Conferimento rifiuti": "Dépôt des déchets", "Conferma": "Confirmer", "Conosci il tuo host?": "Connais-tu ton hôte ?", "Consenti le finestre per salvare la rassegna.": "Autorisez les fenêtres pour enregistrer le cycle.", "Così resta sul telefono con la sua icona, senza cercarla ogni volta.": "Ainsi elle reste sur ton téléphone avec son icône, sans la chercher à chaque fois.", "Crea profilo": "Créer un profil", "Dati della struttura non disponibili": "Données du logement indisponibles", "Disattiva": "Désactiver", "Disattivare la gestione delle case vacanza?": "Désactiver la gestion des locations ?", "Disdetta non riuscita": "Annulation impossible", "Disdici": "Annuler", "Disdire l’iscrizione a questa lezione?": "Annuler votre inscription à ce cours ?", "Disdire questa prenotazione? Il campo torna libero e chi doveva giocare con te va avvisato.": "Annuler cette réservation ? Le terrain redevient libre et il faut prévenir ceux qui devaient jouer avec vous.", "Dopo, la lezione resta dovuta: l’istruttore è già arrivato e il posto non si rivende.": "Après, le cours reste dû : le moniteur est déjà arrivé et la place ne se revend plus.", "Dove mi trovo": "Où je suis", "Dove si trova": "Où ça se trouve", "Durata": "Durée", "E": "Et", "Elenco non disponibile": "Liste indisponible", "Fatto": "Terminé", "Fino ai 18 anni le prenota un adulto per te.": "Avant 18 ans, un adulte réserve pour vous.", "Fino ai 18 anni le prenotazioni a pagamento le fa un adulto per te.": "Avant 18 ans, les réservations payantes sont faites par un adulte pour vous.", "Fitness": "Fitness", "Fotocamera non disponibile: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Appareil photo indisponible : ouvrez l'appareil photo du téléphone et scannez le QR sur la table.", "Garden": "Garden", "Gestisci le case vacanza che ospiti nel residence.": "Gérez les maisons de vacances que vous accueillez dans la résidence.", "Giocare": "Jouer", "Giochi da tavolo": "Jeux de société", "Giornata libera": "Journée libre", "Gruppo capitani": "Groupe des capitaines", "Guida": "Guide", "Hai anche": "Vous avez aussi", "Hai diritto alla prima fila": "Vous avez droit au premier rang", "Hai esaurito le prenotazioni di questa settimana su questo campo": "Vous avez épuisé vos réservations de la semaine sur ce terrain", "Ho già un account": "J'ai déjà un compte", "Home": "Accueil", "I film che proponiamo per la stagione.": "Les films que nous proposons pour la saison.", "I film della stagione. Le date delle proiezioni si trovano nell'app, sezione Stage: possono cambiare.": "Les films de la saison. Les dates des projections sont dans l'app, section Scène : elles peuvent changer.", "I miei posti": "Mes places", "I miei visitatori": "Mes visiteurs", "I tuoi dati": "Tes informations", "Il 112 è il numero unico delle emergenze. Il residence non è un servizio di soccorso: qui ci sono solo i numeri che rispondono davvero, a portata di dito.": "Le 112 est le numéro unique d'urgence. La résidence n'est pas un service de secours : ce sont seulement les numéros auxquels on répond, à portée de doigt.", "Il campo lo prenota un adulto: tu ti unisci alla partita e giochi.": "Un adulte réserve le terrain : vous rejoignez la partie et vous jouez.", "Il campo è al completo.": "Le terrain est complet.", "Il codice è sul tavolo. Da lì l’ordine parte già con il numero giusto.": "Le code est sur la table. De là, la commande part déjà avec le bon numéro.", "Il consenso privacy è necessario per registrarsi": "Le consentement à la confidentialité est nécessaire pour s'inscrire", "Il mio contatto": "Mon contact", "Il tavolo lo assegniamo noi. Se siete di più o di meno, lo dite al personale.": "C'est nous qui attribuons la table. Si vous êtes plus ou moins nombreux, dites-le au personnel.", "Il tavolo si prenota a turni.": "La table se réserve par créneaux.", "Il telefono non sa dirmi dove sei.": "Le téléphone ne peut pas me dire où vous êtes.", "Il tuo codice di accesso": "Ton code d'accès", "Il tuo host": "Ton hôte", "Il tuo posto": "Votre place", "Il tuo profilo è attivo. Conserva il tuo codice per accedere anche senza e-mail:": "Ton profil est actif. Conserve ton code pour te connecter même sans e-mail :", "Il tuo soggiorno": "Votre séjour", "In attesa di conferma": "En attente de confirmation", "Indica chi ti ospita per vedere indicazioni e regole del soggiorno.": "Indique qui t'héberge pour voir les indications et règles du séjour.", "Indietro": "Retour", "Informazioni utili": "Informations utiles", "Ingresso libero": "Entrée libre", "Inizia": "Commencer", "Inquadra il QR del tavolo": "Scannez le QR de la table", "Installa l’app": "Installer l'appli", "Invia": "Envoyer", "Invia ordine": "Envoyer la commande", "Iscritto": "Inscrit", "Iscriviti": "S'inscrire", "Iscrizione annullata": "Inscription annulée", "Iscrizione confermata": "Inscription confirmée", "Iscrizione non riuscita": "Inscription échouée", "Isolato": "Îlot", "La chat della casata": "Le chat de la maison", "La chat interna alla casata arriverà in una prossima versione.": "Le chat interne à la maison arrivera dans une prochaine version.", "La cucina consegna dalle": "La cuisine sert à partir de", "La mia casata": "Ma maison", "La settimana": "La semaine", "La tua postazione": "Votre poste", "La tua prenotazione": "Votre réservation", "La tua tessera": "Votre carte", "Le date non sono indicate: una serata speciale o il maltempo possono spostare una proiezione. Il giorno esatto lo trovi in <b>Stage</b>, dove si prenota il posto.": "Les dates ne sont pas indiquées : une soirée spéciale ou le mauvais temps peuvent déplacer une projection. Le jour exact se trouve dans <b>Scène</b>, où l'on réserve sa place.", "Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.": "Les informations sont chiffrées : visibles seulement par vous et vos invités liés.", "Le mie case": "Mes maisons", "Le mie lezioni": "Mes cours", "Le mie postazioni": "Mes postes", "Le mie prenotazioni": "Mes réservations", "Le mie spese": "Mes dépenses", "Le prenotazioni a pagamento — cena, bar, lezioni e serate — le fa un adulto per te: fino ai 18 anni non si possono prendere impegni di spesa da soli.": "Les réservations payantes — dîner, bar, cours et soirées — sont faites par un adulte pour vous : avant 18 ans on ne s'engage pas seul sur une dépense.", "Le serate con quota le prenota un adulto per te.": "Les soirées payantes sont réservées par un adulte pour vous.", "Le serate speciali": "Les soirées spéciales", "Le tue prenotazioni": "Vos réservations", "Le tue strutture": "Vos logements", "Le ultime": "Les dernières", "Leggi questi numeri all'operatore": "Lisez ces chiffres à l'opérateur", "Lezione al completo.": "Cours complet.", "Lezioni con istruttore": "Cours avec moniteur", "Lezioni non disponibili": "Cours indisponibles", "Menù non disponibile": "Menu non disponible", "Migliore casata": "Meilleure maison", "Modifica": "Modifier", "Mostra solo le prossime": "Afficher seulement les prochaines", "NON PRENOTABILE": "NON RÉSERVABLE", "Nessun host trovato con questo nome.": "Aucun hôte trouvé avec ce nom.", "Nessun iscritto a questa casata.": "Aucun inscrit dans cette maison.", "Nessun messaggio. Comincia tu.": "Aucun message. Lancez-vous.", "Nessun turno di coworking.": "Aucun créneau de coworking.", "Nessun visitatore collegato.": "Aucun visiteur rattaché.", "Nessuna lezione in programma.": "Aucun cours au programme.", "Nessuna serata su prenotazione al momento.": "Aucune soirée sur réservation pour le moment.", "Nessuno spettacolo in programma.": "Aucun spectacle au programme.", "Nome": "Prénom", "Nome e cognome obbligatori": "Prénom et nom obligatoires", "Nome o cognome dell'host": "Prénom ou nom de l'hôte", "Nome struttura": "Nom du logement", "Nome, oppure tessera BR-…": "Nom, ou carte BR-…", "Non hai ancora aggiunto strutture.": "Vous n'avez pas encore ajouté de logement.", "Non hai postazioni prenotate.": "Vous n'avez aucun poste réservé.", "Non lo conosco ora · salta": "Je ne le connais pas maintenant · passer", "Non riesco a ottenere la posizione. Di' all'operatore il nome del residence e il numero della villa.": "Impossible d'obtenir la position. Dites à l'opérateur le nom de la résidence et le numéro de la villa.", "Numeri rapidi": "Numéros rapides", "Numero": "Numéro", "Oggi al residence": "Aujourd'hui à la résidence", "Ogni casata accoglie fino a 12 soci. Se è al completo, scegline un’altra.": "Chaque maison accueille jusqu'à 12 membres. Si elle est complète, choisis-en une autre.", "Orario di check-out": "Heure de départ", "Ordina e ritira al banco": "Commander et retirer au comptoir", "Ordine inviato": "Commande envoyée", "Ore di silenzio": "Heures de silence", "Ospite collegato": "Invité rattaché", "Ospite temporaneo: ti colleghi alla casa del tuo host.": "Invité temporaire : tu te rattaches à la maison de ton hôte.", "Passa alla versione completa": "Passer à la version complète", "Per confermare la lezione": "Pour confirmer le cours", "Per gli altri giorni usa la sezione Eventi.": "Pour les autres jours, utilisez la section Événements.", "Per il bar, la cena e le serate serve un adulto: fino ai 18 anni non si prenotano cose a pagamento da soli.": "Le bar, le dîner et les soirées demandent un adulte : avant 18 ans on ne réserve pas seul ce qui est payant.", "Per servizio": "Par service", "Per un gruppo numeroso accostiamo più tavoli: indica quante persone siete davvero.": "Pour un grand groupe nous rapprochons plusieurs tables : indiquez combien vous êtes vraiment.", "Per una riunione puoi prendere tutta la sala: scegli il numero di postazioni che ti serve.": "Pour une réunion vous pouvez prendre toute la salle : choisissez le nombre de postes nécessaires.", "Perché lo segnali? (facoltativo)": "Pourquoi le signalez-vous ? (facultatif)", "Più tardi": "Plus tard", "Portami lì": "M'y emmener", "Postazione al tavolo": "Poste à la table", "Posti": "Places", "Precisione": "Précision", "Prenota la cena": "Réserver le dîner", "Prenotazione disdetta: il campo è tornato libero.": "Réservation annulée : le terrain est de nouveau libre.", "Prenotazione non disponibile.": "Réservation indisponible.", "Prenoti": "Vous réservez", "Prenoti sempre tu, come titolare. Con <b>Apri ai soci</b> gli altri si uniscono fino a": "Vous réservez toujours en tant que titulaire. Avec <b>Ouvrir aux membres</b>, les autres se joignent jusqu'à", "Prezzo": "Prix", "Programma non disponibile": "Programme indisponible", "Puoi aggiungere le tue case e accogliere i visitatori.": "Vous pouvez ajouter vos logements et accueillir des visiteurs.", "Qualcosa non ha funzionato nel caricamento.": "Un problème est survenu au chargement.", "Quando confermerà, comparirà \"Casa mia\" con tutte le indicazioni della struttura.": "Quand la personne confirmera, « Ma maison » apparaîtra avec toutes les indications du logement.", "Quante persone siete?": "Combien êtes-vous ?", "Quante persone?": "Combien de personnes ?", "Quante postazioni": "Combien de postes", "Questa casata non ha ancora un capitano.": "Cette maison n'a pas encore de capitaine.", "Questo codice non è il QR di un tavolo.": "Ce code n'est pas le QR d'une table.", "Questo telefono non legge i codici dall’app: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Ce téléphone ne lit pas les codes depuis l'app : ouvrez l'appareil photo du téléphone et scannez le QR sur la table.", "Qui c’è solo quello che hai fatto con la tessera: al Bar e al Garden si è serviti anche senza, e quelle consumazioni non compaiono.": "Ici il n’y a que ce que vous avez fait avec la carte : au Bar et au Garden on est servi même sans, et ces consommations n’apparaissent pas.", "Rassegna": "Cycle", "Rassegna cinematografica": "Cycle de cinéma", "Rassegna non ancora pubblicata.": "Cycle pas encore publié.", "Rassegna non disponibile": "Cycle indisponible", "Registrati": "S'inscrire", "Registrazione non riuscita": "Échec de l'inscription", "Regole della casa": "Règles de la maison", "Richiesta inviata": "Demande envoyée", "Richieste in attesa": "Demandes en attente", "Riprova": "Réessayer", "Riservata": "Réservée", "Rispondi e l'app trova il profilo giusto per te.": "Réponds et l'appli trouve le profil qui te convient.", "Sala non disponibile": "Salle indisponible", "Salva": "Enregistrer", "Salva la tua tessera (immagine)": "Enregistre ta carte (image)", "Salva o stampa la rassegna": "Enregistrer ou imprimer le cycle", "Salva tessera": "Enregistrer la carte", "Scegli": "Choisir", "Scegli la casata": "Choisis la maison", "Scegli la disciplina": "Choisissez la discipline", "Scegli la tua casata": "Choisis ta maison", "Scollega": "Détacher", "Scollegare questo visitatore dalla casa?": "Détacher ce visiteur de la maison ?", "Scopri le nostre serate speciali": "Découvrez nos soirées spéciales", "Scrivi il nome di chi gioca, oppure la sua tessera.": "Écrivez le nom de qui joue, ou sa carte.", "Scrivi qui…": "Écrivez ici…", "Segnala": "Signaler", "Segnalare questo messaggio al gestore? Verrà letto da lui.": "Signaler ce message au gestionnaire ? Il en prendra connaissance.", "Serve l'accesso con la tessera": "L'accès avec la carte est nécessaire", "Serve la tessera di un socio per iscriverti": "Il faut la carte d'un membre pour s'inscrire", "Serve la tessera di un socio per prenotare": "Il faut la carte d'un membre pour réserver", "Serve la tessera per vedere le tue spese": "Il faut votre carte pour voir vos dépenses", "Serve per accedere di nuovo con un codice via e-mail.": "Il sert à te reconnecter avec un code par e-mail.", "Servono": "Il faut", "Settimana": "Semaine", "Si disdice senza pagare fino a": "Annulation gratuite jusqu’à", "Si gioca: numero minimo raggiunto": "Le match aura lieu : minimum atteint", "Si occupa una sedia, non un tavolo: si lavora anche in una sala condivisa.": "On occupe une chaise, pas une table : on travaille aussi dans une salle partagée.", "Si paga la singola lezione, in contanti a fine lezione. Sotto il minimo di iscritti la lezione non parte.": "On paie le cours à l'unité, en espèces à la fin. En dessous du minimum d'inscrits, le cours n'a pas lieu.", "Soggiorno dal": "Séjour du", "Solo io": "Moi seul", "Sono in vacanza (visitatore)": "Je suis en vacances (visiteur)", "Sono residente": "Je suis résident", "Sono socio": "Je suis membre", "Sono socio e residente": "Je suis membre et résident", "Spettacolo": "Spectacle", "Stage": "Scène", "Stai prenotando per stasera": "Vous réservez pour ce soir", "Stasera": "Ce soir", "Stasera alle": "Ce soir à", "Stasera il Garden non prende prenotazioni.": "Ce soir le Garden ne prend pas de réservations.", "Su Android (Chrome): tocca il menu (⋮) in alto a destra, poi “Aggiungi a schermata Home” / “Installa app”.": "Sur Android (Chrome) : touche le menu (⋮) en haut à droite, puis « Ajouter à l'écran d'accueil » / « Installer l'appli ».", "Su iPhone/iPad (Safari): tocca Condividi (⬆️) in basso, poi “Aggiungi a Home”.": "Sur iPhone/iPad (Safari) : touche Partager (⬆️) en bas, puis « Sur l'écran d'accueil ».", "Su prenotazione": "Sur réservation", "Tavolo": "Table", "Tavolo da gioco": "Table de jeu", "Tavolo per 4 persone": "Table pour 4 personnes", "Tessera salvata nelle immagini": "Carte enregistrée dans les photos", "Tesserato: casata, Coppa, inviti.": "Membre : maison, Coupe, invitations.", "Ti hanno convocato": "On vous a convoqué", "Ti restano": "Il vous reste", "Tieni l’app a portata di mano": "Garde l'appli à portée de main", "Tocca una lezione per iscriverti. Il colore è la disciplina.": "Touchez un cours pour vous inscrire. La couleur indique la discipline.", "Tocca una serata per i dettagli.": "Touchez une soirée pour les détails.", "Togli questo avviso": "Retirer cet avis", "Totale speso": "Total dépensé", "Turni": "Créneaux", "Tutto del socio (casata, Coppa) + gestisco case vacanza.": "Tout du membre (maison, Coupe) + je gère des maisons de vacances.", "Tutto pronto": "Tout est prêt", "Un socio si aggiunge con la tessera e i punti della Coppa gli vengono conteggiati. Un ospite si aggiunge col nome: gioca lo stesso, ma resta scritto chi era in campo.": "Un membre s'ajoute avec sa carte, et les points de la Coupe lui sont comptés. Un invité s'ajoute par son nom : il joue quand même, mais on garde trace de qui était sur le terrain.", "Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.": "Un visiteur t'a indiqué comme hôte : confirme pour le rattacher à la maison.", "Vai alla Coppa": "Aller à la Coupe", "Vedi tutte": "Voir toutes", "Versione completa": "Version complète", "Versione semplice": "Version simple", "Vivo nel residence; posso gestire case vacanza.": "Je vis dans la résidence ; je peux gérer des maisons de vacances.", "a pari merito": "à égalité", "al": "au", "al completo": "complet", "alla Casa di Carta": "à la Casa di Carta", "alle": "à", "cena e tavolo": "dîner et table", "classifica e prossime partite": "classement et prochains matchs", "compreso": "compris", "consumazione obbligatoria": "consommation obligatoire", "coperti prenotati": "couverts réservés", "dal": "du", "di": "de", "di più…": "plus…", "dice di essere tuo ospite": "dit être ton invité", "e capitani": "et capitaines", "entro le": "avant", "es. Chiara": "ex. Chiara", "fasce": "créneaux", "fasce di oggi sono già passate e non si possono prenotare.": "créneaux d'aujourd'hui sont déjà passés et ne peuvent pas être réservés.", "fascia di oggi è già passata e non si può prenotare.": "créneau d'aujourd'hui est déjà passé et ne peut pas être réservé.", "film": "films", "giocatori": "joueurs", "giocatori: da soli non si occupa un tavolo.": "joueurs : on n'occupe pas une table tout seul.", "giocatori: ne mancano": "joueurs : il en manque", "giocatori; con <b>Solo io</b> lo slot resta riservato. I campi sono gratuiti.": "joueurs ; avec <b>Moi seul</b> le créneau reste réservé. Les terrains sont gratuits.", "gratis": "gratuit", "in corso: chiedila al banco": "en cours : demandez au comptoir", "la posizione resta sul tuo telefono, non viene inviata a nessuno": "la position reste sur votre téléphone, elle n'est envoyée à personne", "la rassegna": "le cycle", "la teniamo per chi ha più di 70 anni, fino a esaurimento. Te la assegniamo da soli.": "nous la réservons aux plus de 70 ans, dans la limite des places. Nous vous l'attribuons nous-mêmes.", "la tua": "la tienne", "lezioni con istruttore": "cours avec moniteur", "minuti all’inizio, quindi la lezione resta dovuta anche se disdici. Procedo?": "minutes avant le début, le cours reste donc dû même si vous annulez. On continue ?", "minuti prima": "minutes avant", "nessun posto libero": "aucune place libre", "nessun tavolo libero": "aucune table libre", "nessuna postazione libera": "aucun poste libre", "orari, rifiuti, numeri": "horaires, déchets, numéros", "ordina e ritira": "commander et retirer", "organizzatevi fra voi": "organisez-vous entre vous", "ospite senza tessera": "invité sans carte", "partita da confermare": "match à confirmer", "partite da confermare": "matchs à confirmer", "per confermare la lezione": "pour confirmer le cours", "per stasera, tavolo da 4": "pour ce soir, table de 4", "persone": "personnes", "piastra e friggitrice devono scaldarsi. L’ordine è già preso.": "la plancha et la friteuse doivent chauffer. Votre commande est déjà prise.", "posizione": "position", "postazioni": "postes", "postazioni libere": "postes libres", "posti davanti al palco": "places devant la scène", "posti liberi": "places libres", "posto allo spettacolo": "place au spectacle", "prodotti": "produits", "restano solo i posti in fondo": "il ne reste que les places du fond", "segnalato": "signalé", "si paga in cassa. Ti avvisiamo quando è pronto.": "paiement à la caisse. On te prévient quand c'est prêt.", "soci": "membres", "socio": "membre", "solo per te? Nessun altro potrà unirsi.": "seulement pour vous ? Personne d'autre ne pourra se joindre.", "su": "sur", "su questo campo": "sur ce terrain", "tavoli liberi": "tables libres", "tavolo": "table", "tavolo da gioco": "table de jeu", "titolare": "titulaire", "unisciti a chi sta giocando": "rejoignez ceux qui jouent", "volta": "fois", "volta in cui non hai pagato niente: è compreso.": "fois où vous n’avez rien payé : c’est compris.", "volte": "fois", "volte in cui non hai pagato niente: è compreso.": "fois où vous n’avez rien payé : c’est compris.", "È fatta": "C'est fait", "È lui/lei": "C'est lui/elle"}, "de": {"112 e il tuo contatto di emergenza": "112 und dein Notfallkontakt", "112 · emergenze": "112 · Notruf", "A quale casa lo colleghi?": "Welchem Haus ordnest du ihn/sie zu?", "Abbiamo avvisato": "Wir haben benachrichtigt", "Accetto il trattamento dei dati (privacy)": "Ich stimme der Datenverarbeitung zu (Datenschutz)", "Aggiungi": "Hinzufügen", "Aggiungi alla Home": "Zum Startbildschirm", "Aggiungi alla schermata Home": "Zum Startbildschirm hinzufügen", "Aggiungi la tua casa vacanza: potrai accogliere i visitatori.": "Füge dein Ferienhaus hinzu: Du kannst dann Besucher empfangen.", "Aggiungi prima la tua casa, poi conferma l'ospite.": "Füge zuerst dein Haus hinzu, dann bestätige den Gast.", "Aggiungi struttura": "Objekt hinzufügen", "Aggiungi un giocatore": "Spieler hinzufügen", "Al tavolo servono almeno": "Am Tisch braucht es mindestens", "Ancora niente da mostrare.": "Noch nichts zu zeigen.", "Annullare questa prenotazione?": "Diese Buchung stornieren?", "Apri ai soci": "Für Mitglieder öffnen", "Apri la partita di": "Spiel öffnen:", "Area fitness": "Fitnessbereich", "Attenzione: mancano meno di": "Achtung: es sind weniger als", "Attivala se affitti una casa nel residence.": "Aktiviere sie, wenn du eine Wohnung in der Anlage vermietest.", "Bar": "Bar", "Bar, cucina e ritrovo": "Bar, Küche und Treffpunkt", "Benvenuto nella casata": "Willkommen im Haus", "Benvenuto!": "Willkommen!", "Bussola Bar": "Bussola Bar", "Bussola Garden": "Bussola Garden", "Bussola Stage": "Bussola Stage", "C'è posto": "Es ist Platz", "CAPITANO": "KAPITÄN", "Cambia casata": "Haus wechseln", "Campo impegnato": "Platz belegt", "Campo riservato": "Reservierter Platz", "Capitani": "Kapitäne", "Casa di Carta": "Casa di Carta", "Casa mia": "Mein Zuhause", "Case vacanza": "Ferienwohnungen", "Cena": "Abendessen", "Cena al tavolo": "Abendessen am Tisch", "Cena confermata, ma i posti davanti al palco sono esauriti": "Abendessen bestätigt, aber die Plätze vor der Bühne sind ausverkauft", "Cerca chi ti ospita: riceverà una notifica e, se conferma, vedrai \"Casa mia\".": "Suche, wer dich beherbergt: Die Person erhält eine Benachrichtigung und, wenn sie bestätigt, siehst du „Mein Zuhause\".", "Cerco la posizione…": "Position wird gesucht…", "Chat della casata": "Haus-Chat", "Chat non disponibile": "Chat nicht verfügbar", "Chi gioca": "Wer spielt", "Chi gioca con te": "Wer mit dir spielt", "Chi sei?": "Wer bist du?", "Chi ti ospita?": "Wer beherbergt dich?", "Chi vuoi chiamare": "Wen möchtest du anrufen", "Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.": "Wer dein Gast sein möchte, registriert sich und sucht dich per Namen: Hier bestätigst du und verbindest ihn mit dem Haus.", "Chiama": "Anrufen", "Ci sono alcolici: al ritiro può esserti chiesto un documento. Sotto i 18 anni non si servono.": "Die Bestellung enthält Alkohol: bei der Abholung kann ein Ausweis verlangt werden. Unter 18 wird nicht ausgeschenkt.", "Codice di accesso": "Zugangscode", "Cognome": "Nachname", "Collega": "Verbinden", "Collega la tua casa": "Verbinde dein Haus", "Comanda": "Bestellung", "Come arrivare": "Anfahrt", "Come raggiungere la casa e le regole del soggiorno.": "So erreichst du das Haus, und die Regeln des Aufenthalts.", "Come va la Coppa": "Wie steht der Pokal", "Conferimento rifiuti": "Müllabgabe", "Conferma": "Bestätigen", "Conosci il tuo host?": "Kennst du deinen Gastgeber?", "Consenti le finestre per salvare la rassegna.": "Erlaube Pop-ups, um die Filmreihe zu speichern.", "Così resta sul telefono con la sua icona, senza cercarla ogni volta.": "So bleibt sie mit ihrem Symbol auf dem Telefon, ohne sie jedes Mal zu suchen.", "Crea profilo": "Profil erstellen", "Dati della struttura non disponibili": "Objektdaten nicht verfügbar", "Disattiva": "Ausschalten", "Disattivare la gestione delle case vacanza?": "Verwaltung der Ferienwohnungen ausschalten?", "Disdetta non riuscita": "Absage fehlgeschlagen", "Disdici": "Absagen", "Disdire l’iscrizione a questa lezione?": "Anmeldung für diese Stunde absagen?", "Disdire questa prenotazione? Il campo torna libero e chi doveva giocare con te va avvisato.": "Diese Buchung absagen? Der Platz wird wieder frei, und wer mit dir spielen wollte, muss Bescheid bekommen.", "Dopo, la lezione resta dovuta: l’istruttore è già arrivato e il posto non si rivende.": "Danach bleibt die Stunde geschuldet: der Trainer ist schon da und der Platz lässt sich nicht mehr vergeben.", "Dove mi trovo": "Wo ich bin", "Dove si trova": "Wo es liegt", "Durata": "Dauer", "E": "Und", "Elenco non disponibile": "Liste nicht verfügbar", "Fatto": "Fertig", "Fino ai 18 anni le prenota un adulto per te.": "Unter 18 bucht ein Erwachsener für dich.", "Fino ai 18 anni le prenotazioni a pagamento le fa un adulto per te.": "Unter 18 macht ein Erwachsener die kostenpflichtigen Buchungen für dich.", "Fitness": "Fitness", "Fotocamera non disponibile: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Kamera nicht verfügbar: öffne die Kamera des Telefons und scanne den QR-Code auf dem Tisch.", "Garden": "Garden", "Gestisci le case vacanza che ospiti nel residence.": "Verwalte die Ferienhäuser, die du in der Residenz beherbergst.", "Giocare": "Spielen", "Giochi da tavolo": "Brettspiele", "Giornata libera": "Freier Tag", "Gruppo capitani": "Kapitänsgruppe", "Guida": "Guide", "Hai anche": "Du hast außerdem", "Hai diritto alla prima fila": "Du hast Anrecht auf die erste Reihe", "Hai esaurito le prenotazioni di questa settimana su questo campo": "Deine Buchungen dieser Woche für diesen Platz sind aufgebraucht", "Ho già un account": "Ich habe schon ein Konto", "Home": "Start", "I film che proponiamo per la stagione.": "Die Filme, die wir für die Saison zeigen.", "I film della stagione. Le date delle proiezioni si trovano nell'app, sezione Stage: possono cambiare.": "Die Filme der Saison. Die Vorführtermine stehen in der App unter Bühne: sie können sich ändern.", "I miei posti": "Meine Plätze", "I miei visitatori": "Meine Besucher", "I tuoi dati": "Deine Daten", "Il 112 è il numero unico delle emergenze. Il residence non è un servizio di soccorso: qui ci sono solo i numeri che rispondono davvero, a portata di dito.": "112 ist die einheitliche Notrufnummer. Die Residenz ist kein Rettungsdienst: das sind nur die Nummern, unter denen wirklich jemand antwortet, griffbereit.", "Il campo lo prenota un adulto: tu ti unisci alla partita e giochi.": "Ein Erwachsener bucht den Platz: du schließt dich dem Spiel an.", "Il campo è al completo.": "Der Platz ist voll.", "Il codice è sul tavolo. Da lì l’ordine parte già con il numero giusto.": "Der Code liegt auf dem Tisch. Von dort startet die Bestellung schon mit der richtigen Nummer.", "Il consenso privacy è necessario per registrarsi": "Die Datenschutz-Einwilligung ist für die Registrierung erforderlich", "Il mio contatto": "Mein Kontakt", "Il tavolo lo assegniamo noi. Se siete di più o di meno, lo dite al personale.": "Den Tisch teilen wir zu. Wenn ihr mehr oder weniger seid, sagt es dem Personal.", "Il tavolo si prenota a turni.": "Der Tisch wird in Schichten gebucht.", "Il telefono non sa dirmi dove sei.": "Das Telefon kann mir nicht sagen, wo du bist.", "Il tuo codice di accesso": "Dein Zugangscode", "Il tuo host": "Dein Gastgeber", "Il tuo posto": "Dein Platz", "Il tuo profilo è attivo. Conserva il tuo codice per accedere anche senza e-mail:": "Dein Profil ist aktiv. Bewahre deinen Code auf, um dich auch ohne E-Mail anzumelden:", "Il tuo soggiorno": "Dein Aufenthalt", "In attesa di conferma": "Warten auf Bestätigung", "Indica chi ti ospita per vedere indicazioni e regole del soggiorno.": "Gib an, wer dich beherbergt, um Hinweise und Regeln des Aufenthalts zu sehen.", "Indietro": "Zurück", "Informazioni utili": "Nützliche Infos", "Ingresso libero": "Freier Eintritt", "Inizia": "Starten", "Inquadra il QR del tavolo": "QR-Code des Tisches scannen", "Installa l’app": "App installieren", "Invia": "Senden", "Invia ordine": "Bestellung senden", "Iscritto": "Angemeldet", "Iscriviti": "Anmelden", "Iscrizione annullata": "Anmeldung storniert", "Iscrizione confermata": "Anmeldung bestätigt", "Iscrizione non riuscita": "Anmeldung fehlgeschlagen", "Isolato": "Block", "La chat della casata": "Der Haus-Chat", "La chat interna alla casata arriverà in una prossima versione.": "Der hausinterne Chat kommt in einer späteren Version.", "La cucina consegna dalle": "Die Küche liefert ab", "La mia casata": "Mein Haus", "La settimana": "Die Woche", "La tua postazione": "Dein Arbeitsplatz", "La tua prenotazione": "Deine Buchung", "La tua tessera": "Deine Karte", "Le date non sono indicate: una serata speciale o il maltempo possono spostare una proiezione. Il giorno esatto lo trovi in <b>Stage</b>, dove si prenota il posto.": "Termine sind nicht angegeben: ein besonderer Abend oder schlechtes Wetter können eine Vorführung verschieben. Den genauen Tag findest du unter <b>Bühne</b>, wo der Platz gebucht wird.", "Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.": "Die Angaben sind verschlüsselt: sichtbar nur für dich und deine verknüpften Gäste.", "Le mie case": "Meine Häuser", "Le mie lezioni": "Meine Kurse", "Le mie postazioni": "Meine Arbeitsplätze", "Le mie prenotazioni": "Meine Buchungen", "Le mie spese": "Meine Ausgaben", "Le prenotazioni a pagamento — cena, bar, lezioni e serate — le fa un adulto per te: fino ai 18 anni non si possono prendere impegni di spesa da soli.": "Kostenpflichtige Buchungen — Abendessen, Bar, Kurse und Abende — macht ein Erwachsener für dich: unter 18 kann man keine Ausgaben allein eingehen.", "Le serate con quota le prenota un adulto per te.": "Abende mit Beitrag bucht ein Erwachsener für dich.", "Le serate speciali": "Die besonderen Abende", "Le tue prenotazioni": "Deine Buchungen", "Le tue strutture": "Deine Objekte", "Le ultime": "Die letzten", "Leggi questi numeri all'operatore": "Lies diese Zahlen dem Notrufdienst vor", "Lezione al completo.": "Kurs ist ausgebucht.", "Lezioni con istruttore": "Kurse mit Trainer", "Lezioni non disponibili": "Kurse nicht verfügbar", "Menù non disponibile": "Menü nicht verfügbar", "Migliore casata": "Bestes Haus", "Modifica": "Bearbeiten", "Mostra solo le prossime": "Nur die nächsten zeigen", "NON PRENOTABILE": "NICHT BUCHBAR", "Nessun host trovato con questo nome.": "Kein Gastgeber mit diesem Namen gefunden.", "Nessun iscritto a questa casata.": "Keine Mitglieder in diesem Haus.", "Nessun messaggio. Comincia tu.": "Keine Nachrichten. Fang du an.", "Nessun turno di coworking.": "Keine Coworking-Zeiten.", "Nessun visitatore collegato.": "Kein Besucher verbunden.", "Nessuna lezione in programma.": "Keine Kurse geplant.", "Nessuna serata su prenotazione al momento.": "Zurzeit keine Abende mit Reservierung.", "Nessuno spettacolo in programma.": "Keine Vorstellungen geplant.", "Nome": "Vorname", "Nome e cognome obbligatori": "Vor- und Nachname erforderlich", "Nome o cognome dell'host": "Vor- oder Nachname des Gastgebers", "Nome struttura": "Name des Objekts", "Nome, oppure tessera BR-…": "Name oder Karte BR-…", "Non hai ancora aggiunto strutture.": "Du hast noch keine Objekte hinzugefügt.", "Non hai postazioni prenotate.": "Du hast keine Arbeitsplätze gebucht.", "Non lo conosco ora · salta": "Ich kenne ihn jetzt nicht · überspringen", "Non riesco a ottenere la posizione. Di' all'operatore il nome del residence e il numero della villa.": "Ich kann die Position nicht ermitteln. Nenne dem Notrufdienst den Namen der Residenz und die Nummer der Villa.", "Numeri rapidi": "Schnellwahl", "Numero": "Nummer", "Oggi al residence": "Heute in der Residenz", "Ogni casata accoglie fino a 12 soci. Se è al completo, scegline un’altra.": "Jedes Haus nimmt bis zu 12 Mitglieder auf. Wenn es voll ist, wähle ein anderes.", "Orario di check-out": "Check-out-Zeit", "Ordina e ritira al banco": "Bestellen und an der Theke abholen", "Ordine inviato": "Bestellung gesendet", "Ore di silenzio": "Ruhezeiten", "Ospite collegato": "Gast verbunden", "Ospite temporaneo: ti colleghi alla casa del tuo host.": "Vorübergehender Gast: Du verbindest dich mit dem Haus deines Gastgebers.", "Passa alla versione completa": "Zur Vollversion wechseln", "Per confermare la lezione": "Um den Kurs zu bestätigen", "Per gli altri giorni usa la sezione Eventi.": "Für andere Tage nutze den Bereich Veranstaltungen.", "Per il bar, la cena e le serate serve un adulto: fino ai 18 anni non si prenotano cose a pagamento da soli.": "Für Bar, Abendessen und Abendveranstaltungen braucht es einen Erwachsenen: unter 18 kann man kostenpflichtige Angebote nicht allein buchen.", "Per servizio": "Nach Bereich", "Per un gruppo numeroso accostiamo più tavoli: indica quante persone siete davvero.": "Für eine große Gruppe stellen wir Tische zusammen: sag uns, wie viele ihr wirklich seid.", "Per una riunione puoi prendere tutta la sala: scegli il numero di postazioni che ti serve.": "Für ein Meeting kannst du den ganzen Raum nehmen: wähle die Zahl der Arbeitsplätze.", "Perché lo segnali? (facoltativo)": "Warum meldest du sie? (optional)", "Più tardi": "Später", "Portami lì": "Hinbringen", "Postazione al tavolo": "Platz am Tisch", "Posti": "Plätze", "Precisione": "Genauigkeit", "Prenota la cena": "Abendessen buchen", "Prenotazione disdetta: il campo è tornato libero.": "Buchung abgesagt: der Platz ist wieder frei.", "Prenotazione non disponibile.": "Buchung nicht verfügbar.", "Prenoti": "Du buchst", "Prenoti sempre tu, come titolare. Con <b>Apri ai soci</b> gli altri si uniscono fino a": "Du buchst immer als Inhaber. Mit <b>Für Mitglieder öffnen</b> kommen andere dazu, bis zu", "Prezzo": "Preis", "Programma non disponibile": "Programm nicht verfügbar", "Puoi aggiungere le tue case e accogliere i visitatori.": "Du kannst deine Wohnungen eintragen und Gäste empfangen.", "Qualcosa non ha funzionato nel caricamento.": "Beim Laden ist etwas schiefgegangen.", "Quando confermerà, comparirà \"Casa mia\" con tutte le indicazioni della struttura.": "Sobald bestätigt wird, erscheint „Mein Zuhause\" mit allen Hinweisen zur Unterkunft.", "Quante persone siete?": "Wie viele seid ihr?", "Quante persone?": "Wie viele Personen?", "Quante postazioni": "Wie viele Arbeitsplätze", "Questa casata non ha ancora un capitano.": "Dieses Haus hat noch keinen Kapitän.", "Questo codice non è il QR di un tavolo.": "Dieser Code ist kein Tisch-QR-Code.", "Questo telefono non legge i codici dall’app: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Dieses Telefon liest keine Codes aus der App: öffne die Kamera des Telefons und scanne den QR-Code auf dem Tisch.", "Qui c’è solo quello che hai fatto con la tessera: al Bar e al Garden si è serviti anche senza, e quelle consumazioni non compaiono.": "Hier steht nur, was du mit der Karte gemacht hast: an der Bar und im Garden wird man auch ohne bedient, und das taucht hier nicht auf.", "Rassegna": "Filmreihe", "Rassegna cinematografica": "Filmreihe", "Rassegna non ancora pubblicata.": "Filmreihe noch nicht veröffentlicht.", "Rassegna non disponibile": "Filmreihe nicht verfügbar", "Registrati": "Registrieren", "Registrazione non riuscita": "Registrierung fehlgeschlagen", "Regole della casa": "Hausordnung", "Richiesta inviata": "Anfrage gesendet", "Richieste in attesa": "Ausstehende Anfragen", "Riprova": "Erneut versuchen", "Riservata": "Reserviert", "Rispondi e l'app trova il profilo giusto per te.": "Antworte und die App findet das passende Profil für dich.", "Sala non disponibile": "Raum nicht verfügbar", "Salva": "Speichern", "Salva la tua tessera (immagine)": "Speichere deinen Ausweis (Bild)", "Salva o stampa la rassegna": "Filmreihe speichern oder drucken", "Salva tessera": "Ausweis speichern", "Scegli": "Wählen", "Scegli la casata": "Wähle das Haus", "Scegli la disciplina": "Disziplin wählen", "Scegli la tua casata": "Wähle dein Haus", "Scollega": "Trennen", "Scollegare questo visitatore dalla casa?": "Diesen Besucher vom Haus trennen?", "Scopri le nostre serate speciali": "Entdecke unsere besonderen Abende", "Scrivi il nome di chi gioca, oppure la sua tessera.": "Schreib den Namen des Spielers oder seine Karte.", "Scrivi qui…": "Hier schreiben…", "Segnala": "Melden", "Segnalare questo messaggio al gestore? Verrà letto da lui.": "Diese Nachricht dem Betreiber melden? Er wird sie lesen.", "Serve l'accesso con la tessera": "Zugang mit Karte erforderlich", "Serve la tessera di un socio per iscriverti": "Zur Anmeldung wird eine Mitgliedskarte benötigt", "Serve la tessera di un socio per prenotare": "Zum Buchen wird eine Mitgliedskarte benötigt", "Serve la tessera per vedere le tue spese": "Für deine Ausgaben brauchst du deine Karte", "Serve per accedere di nuovo con un codice via e-mail.": "Er dient dazu, dich erneut mit einem Code per E-Mail anzumelden.", "Servono": "Es braucht", "Settimana": "Woche", "Si disdice senza pagare fino a": "Kostenlos stornierbar bis", "Si gioca: numero minimo raggiunto": "Das Spiel findet statt: Mindestzahl erreicht", "Si occupa una sedia, non un tavolo: si lavora anche in una sala condivisa.": "Man belegt einen Stuhl, keinen Tisch: man arbeitet auch in einem geteilten Raum.", "Si paga la singola lezione, in contanti a fine lezione. Sotto il minimo di iscritti la lezione non parte.": "Bezahlt wird pro Kurs, bar am Ende. Unter der Mindestzahl an Anmeldungen findet der Kurs nicht statt.", "Soggiorno dal": "Aufenthalt ab", "Solo io": "Nur ich", "Sono in vacanza (visitatore)": "Ich bin im Urlaub (Besucher)", "Sono residente": "Ich bin Anwohner", "Sono socio": "Ich bin Mitglied", "Sono socio e residente": "Ich bin Mitglied und Anwohner", "Spettacolo": "Vorstellung", "Stage": "Bühne", "Stai prenotando per stasera": "Du buchst für heute Abend", "Stasera": "Heute Abend", "Stasera alle": "Heute Abend um", "Stasera il Garden non prende prenotazioni.": "Heute Abend nimmt der Garden keine Reservierungen an.", "Su Android (Chrome): tocca il menu (⋮) in alto a destra, poi “Aggiungi a schermata Home” / “Installa app”.": "Auf Android (Chrome): Tippe oben rechts auf das Menü (⋮), dann „Zum Startbildschirm hinzufügen\" / „App installieren\".", "Su iPhone/iPad (Safari): tocca Condividi (⬆️) in basso, poi “Aggiungi a Home”.": "Auf iPhone/iPad (Safari): Tippe unten auf Teilen (⬆️), dann „Zum Home-Bildschirm\".", "Su prenotazione": "Nur mit Reservierung", "Tavolo": "Tisch", "Tavolo da gioco": "Spieltisch", "Tavolo per 4 persone": "Tisch für 4 Personen", "Tessera salvata nelle immagini": "Ausweis in den Fotos gespeichert", "Tesserato: casata, Coppa, inviti.": "Mitglied: Haus, Pokal, Einladungen.", "Ti hanno convocato": "Du wurdest aufgestellt", "Ti restano": "Dir bleiben", "Tieni l’app a portata di mano": "Halte die App griffbereit", "Tocca una lezione per iscriverti. Il colore è la disciplina.": "Tippe auf einen Kurs, um dich anzumelden. Die Farbe steht für die Disziplin.", "Tocca una serata per i dettagli.": "Tippe auf einen Abend für Details.", "Togli questo avviso": "Diesen Hinweis entfernen", "Totale speso": "Insgesamt ausgegeben", "Turni": "Schichten", "Tutto del socio (casata, Coppa) + gestisco case vacanza.": "Alles vom Mitglied (Haus, Pokal) + ich verwalte Ferienhäuser.", "Tutto pronto": "Alles bereit", "Un socio si aggiunge con la tessera e i punti della Coppa gli vengono conteggiati. Un ospite si aggiunge col nome: gioca lo stesso, ma resta scritto chi era in campo.": "Ein Mitglied wird mit der Karte hinzugefügt, so zählen die Pokalpunkte. Ein Gast wird mit dem Namen hinzugefügt: er spielt trotzdem, aber es bleibt festgehalten, wer auf dem Platz war.", "Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.": "Ein Besucher hat dich als Gastgeber angegeben: Bestätige, um ihn mit dem Haus zu verbinden.", "Vai alla Coppa": "Zum Pokal", "Vedi tutte": "Alle anzeigen", "Versione completa": "Vollversion", "Versione semplice": "Einfache Version", "Vivo nel residence; posso gestire case vacanza.": "Ich wohne in der Residenz; ich kann Ferienhäuser verwalten.", "a pari merito": "punktgleich", "al": "bis", "al completo": "voll", "alla Casa di Carta": "im Casa di Carta", "alle": "um", "cena e tavolo": "Abendessen und Tisch", "classifica e prossime partite": "Tabelle und nächste Spiele", "compreso": "inbegriffen", "consumazione obbligatoria": "Verzehrpflicht", "coperti prenotati": "reservierte Gedecke", "dal": "vom", "di": "von", "di più…": "mehr…", "dice di essere tuo ospite": "gibt an, dein Gast zu sein", "e capitani": "und Kapitäne", "entro le": "bis", "es. Chiara": "z. B. Chiara", "fasce": "Zeitfenster", "fasce di oggi sono già passate e non si possono prenotare.": "Zeitfenster von heute sind schon vorbei und nicht mehr buchbar.", "fascia di oggi è già passata e non si può prenotare.": "Zeitfenster von heute ist schon vorbei und nicht mehr buchbar.", "film": "Filme", "giocatori": "Spieler", "giocatori: da soli non si occupa un tavolo.": "Spieler: allein belegt man keinen Tisch.", "giocatori: ne mancano": "Spieler: es fehlen noch", "giocatori; con <b>Solo io</b> lo slot resta riservato. I campi sono gratuiti.": "Spielern; mit <b>Nur ich</b> bleibt der Slot reserviert. Die Plätze sind kostenlos.", "gratis": "gratis", "in corso: chiedila al banco": "läuft gerade: frag an der Theke", "la posizione resta sul tuo telefono, non viene inviata a nessuno": "die Position bleibt auf deinem Telefon, sie wird an niemanden gesendet", "la rassegna": "die Filmreihe", "la teniamo per chi ha più di 70 anni, fino a esaurimento. Te la assegniamo da soli.": "wir halten sie für über 70-Jährige frei, solange Plätze da sind. Wir weisen sie dir selbst zu.", "la tua": "deine", "lezioni con istruttore": "Kurse mit Trainer", "minuti all’inizio, quindi la lezione resta dovuta anche se disdici. Procedo?": "Minuten bis zum Beginn, die Stunde bleibt also auch bei Absage geschuldet. Fortfahren?", "minuti prima": "Minuten vorher", "nessun posto libero": "kein Platz frei", "nessun tavolo libero": "kein Tisch frei", "nessuna postazione libera": "kein Arbeitsplatz frei", "orari, rifiuti, numeri": "Zeiten, Müll, Nummern", "ordina e ritira": "bestellen und abholen", "organizzatevi fra voi": "organisiert euch untereinander", "ospite senza tessera": "Gast ohne Karte", "partita da confermare": "Spiel zu bestätigen", "partite da confermare": "Spiele zu bestätigen", "per confermare la lezione": "um den Kurs zu bestätigen", "per stasera, tavolo da 4": "für heute Abend, Tisch für 4", "persone": "Personen", "piastra e friggitrice devono scaldarsi. L’ordine è già preso.": "Grillplatte und Fritteuse müssen aufheizen. Deine Bestellung ist schon aufgenommen.", "posizione": "Platz", "postazioni": "Arbeitsplätze", "postazioni libere": "freie Arbeitsplätze", "posti davanti al palco": "Plätze vor der Bühne", "posti liberi": "freie Plätze", "posto allo spettacolo": "Platz bei der Vorstellung", "prodotti": "Artikel", "restano solo i posti in fondo": "nur noch Plätze hinten frei", "segnalato": "gemeldet", "si paga in cassa. Ti avvisiamo quando è pronto.": "Zahlung an der Kasse. Wir sagen Bescheid, wenn es fertig ist.", "soci": "Mitglieder", "socio": "Mitglied", "solo per te? Nessun altro potrà unirsi.": "nur für dich? Niemand sonst kann dazukommen.", "su": "von", "su questo campo": "auf diesem Platz", "tavoli liberi": "freie Tische", "tavolo": "Tisch", "tavolo da gioco": "Spieltisch", "titolare": "Inhaber", "unisciti a chi sta giocando": "schließ dich den Spielenden an", "volta": "Mal", "volta in cui non hai pagato niente: è compreso.": "Mal hast du nichts bezahlt: es ist inbegriffen.", "volte": "Mal", "volte in cui non hai pagato niente: è compreso.": "Mal hast du nichts bezahlt: es ist inbegriffen.", "È fatta": "Erledigt", "È lui/lei": "Das ist er/sie"}, "es": {"112 e il tuo contatto di emergenza": "112 y tu contacto de emergencia", "112 · emergenze": "112 · emergencias", "A quale casa lo colleghi?": "¿A qué casa lo vinculas?", "Abbiamo avvisato": "Hemos avisado", "Accetto il trattamento dei dati (privacy)": "Acepto el tratamiento de mis datos (privacidad)", "Aggiungi": "Añadir", "Aggiungi alla Home": "Añadir al inicio", "Aggiungi alla schermata Home": "Añadir a la pantalla de inicio", "Aggiungi la tua casa vacanza: potrai accogliere i visitatori.": "Añade tu casa de vacaciones: podrás acoger a los visitantes.", "Aggiungi prima la tua casa, poi conferma l'ospite.": "Añade primero tu casa y luego confirma al huésped.", "Aggiungi struttura": "Añadir alojamiento", "Aggiungi un giocatore": "Añadir un jugador", "Al tavolo servono almeno": "En la mesa hacen falta al menos", "Ancora niente da mostrare.": "Todavía no hay nada que mostrar.", "Annullare questa prenotazione?": "¿Anular esta reserva?", "Apri ai soci": "Abrir a los socios", "Apri la partita di": "Abrir el partido de", "Area fitness": "Zona fitness", "Attenzione: mancano meno di": "Atención: faltan menos de", "Attivala se affitti una casa nel residence.": "Actívala si alquilas una casa en el residence.", "Bar": "Bar", "Bar, cucina e ritrovo": "Bar, cocina y punto de encuentro", "Benvenuto nella casata": "Bienvenido a la casa", "Benvenuto!": "¡Bienvenido!", "Bussola Bar": "Bussola Bar", "Bussola Garden": "Bussola Garden", "Bussola Stage": "Bussola Stage", "C'è posto": "Hay sitio", "CAPITANO": "CAPITÁN", "Cambia casata": "Cambiar de casa", "Campo impegnato": "Pista ocupada", "Campo riservato": "Pista reservada", "Capitani": "Capitanes", "Casa di Carta": "Casa di Carta", "Casa mia": "Mi casa", "Case vacanza": "Casas vacacionales", "Cena": "Cena", "Cena al tavolo": "Cena en la mesa", "Cena confermata, ma i posti davanti al palco sono esauriti": "Cena confirmada, pero los asientos delante del escenario están agotados", "Cerca chi ti ospita: riceverà una notifica e, se conferma, vedrai \"Casa mia\".": "Busca a quien te aloja: recibirá una notificación y, si confirma, verás \"Mi casa\".", "Cerco la posizione…": "Buscando la ubicación…", "Chat della casata": "Chat de la casa", "Chat non disponibile": "Chat no disponible", "Chi gioca": "Quién juega", "Chi gioca con te": "Quién juega contigo", "Chi sei?": "¿Quién eres?", "Chi ti ospita?": "¿Quién te aloja?", "Chi vuoi chiamare": "A quién quieres llamar", "Chi vuole essere tuo ospite si registra e ti cerca per nome: qui confermi e lo colleghi alla casa.": "Quien quiera ser tu huésped se registra y te busca por nombre: aquí lo confirmas y lo vinculas a la casa.", "Chiama": "Llamar", "Ci sono alcolici: al ritiro può esserti chiesto un documento. Sotto i 18 anni non si servono.": "Hay alcohol en el pedido: al recogerlo pueden pedirte un documento. No se sirve a menores de 18 años.", "Codice di accesso": "Código de acceso", "Cognome": "Apellido", "Collega": "Vincular", "Collega la tua casa": "Vincula tu casa", "Comanda": "Comanda", "Come arrivare": "Cómo llegar", "Come raggiungere la casa e le regole del soggiorno.": "Cómo llegar a la casa y las normas de la estancia.", "Come va la Coppa": "Cómo va la Copa", "Conferimento rifiuti": "Depósito de residuos", "Conferma": "Confirmar", "Conosci il tuo host?": "¿Conoces a tu anfitrión?", "Consenti le finestre per salvare la rassegna.": "Permite las ventanas emergentes para guardar el ciclo.", "Così resta sul telefono con la sua icona, senza cercarla ogni volta.": "Así se queda en el teléfono con su icono, sin buscarla cada vez.", "Crea profilo": "Crear perfil", "Dati della struttura non disponibili": "Datos del alojamiento no disponibles", "Disattiva": "Desactivar", "Disattivare la gestione delle case vacanza?": "¿Desactivar la gestión de casas vacacionales?", "Disdetta non riuscita": "No se ha podido anular", "Disdici": "Anular", "Disdire l’iscrizione a questa lezione?": "¿Anular tu inscripción a esta clase?", "Disdire questa prenotazione? Il campo torna libero e chi doveva giocare con te va avvisato.": "¿Anular esta reserva? La pista vuelve a estar libre y hay que avisar a quien iba a jugar contigo.", "Dopo, la lezione resta dovuta: l’istruttore è già arrivato e il posto non si rivende.": "Después la clase se debe igualmente: el instructor ya ha llegado y la plaza no se revende.", "Dove mi trovo": "Dónde estoy", "Dove si trova": "Dónde está", "Durata": "Duración", "E": "Y", "Elenco non disponibile": "Lista no disponible", "Fatto": "Hecho", "Fino ai 18 anni le prenota un adulto per te.": "Hasta los 18 años las reserva un adulto por ti.", "Fino ai 18 anni le prenotazioni a pagamento le fa un adulto per te.": "Hasta los 18 años, las reservas de pago las hace un adulto por ti.", "Fitness": "Fitness", "Fotocamera non disponibile: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Cámara no disponible: abre la cámara del teléfono y escanea el QR de la mesa.", "Garden": "Garden", "Gestisci le case vacanza che ospiti nel residence.": "Gestiona las casas de vacaciones que acoges en el residence.", "Giocare": "Jugar", "Giochi da tavolo": "Juegos de mesa", "Giornata libera": "Día libre", "Gruppo capitani": "Grupo de capitanes", "Guida": "Guía", "Hai anche": "También tienes", "Hai diritto alla prima fila": "Tienes derecho a la primera fila", "Hai esaurito le prenotazioni di questa settimana su questo campo": "Has agotado las reservas de esta semana en esta pista", "Ho già un account": "Ya tengo una cuenta", "Home": "Inicio", "I film che proponiamo per la stagione.": "Las películas que proponemos para la temporada.", "I film della stagione. Le date delle proiezioni si trovano nell'app, sezione Stage: possono cambiare.": "Las películas de la temporada. Las fechas de las proyecciones están en la app, sección Escenario: pueden cambiar.", "I miei posti": "Mis asientos", "I miei visitatori": "Mis visitantes", "I tuoi dati": "Tus datos", "Il 112 è il numero unico delle emergenze. Il residence non è un servizio di soccorso: qui ci sono solo i numeri che rispondono davvero, a portata di dito.": "El 112 es el número único de emergencias. El residence no es un servicio de rescate: estos son solo los números que de verdad contestan, a mano.", "Il campo lo prenota un adulto: tu ti unisci alla partita e giochi.": "Un adulto reserva la pista: tú te unes al partido y juegas.", "Il campo è al completo.": "La pista está completa.", "Il codice è sul tavolo. Da lì l’ordine parte già con il numero giusto.": "El código está en la mesa. Desde ahí el pedido sale ya con el número correcto.", "Il consenso privacy è necessario per registrarsi": "El consentimiento de privacidad es necesario para registrarse", "Il mio contatto": "Mi contacto", "Il tavolo lo assegniamo noi. Se siete di più o di meno, lo dite al personale.": "La mesa la asignamos nosotros. Si sois más o menos, decídselo al personal.", "Il tavolo si prenota a turni.": "La mesa se reserva por turnos.", "Il telefono non sa dirmi dove sei.": "El teléfono no puede decirme dónde estás.", "Il tuo codice di accesso": "Tu código de acceso", "Il tuo host": "Tu anfitrión", "Il tuo posto": "Tu asiento", "Il tuo profilo è attivo. Conserva il tuo codice per accedere anche senza e-mail:": "Tu perfil está activo. Guarda tu código para acceder incluso sin correo:", "Il tuo soggiorno": "Tu estancia", "In attesa di conferma": "A la espera de confirmación", "Indica chi ti ospita per vedere indicazioni e regole del soggiorno.": "Indica quién te aloja para ver las indicaciones y normas de la estancia.", "Indietro": "Atrás", "Informazioni utili": "Información útil", "Ingresso libero": "Entrada libre", "Inizia": "Empezar", "Inquadra il QR del tavolo": "Escanea el QR de la mesa", "Installa l’app": "Instala la app", "Invia": "Enviar", "Invia ordine": "Enviar pedido", "Iscritto": "Inscrito", "Iscriviti": "Inscribirse", "Iscrizione annullata": "Inscripción anulada", "Iscrizione confermata": "Inscripción confirmada", "Iscrizione non riuscita": "Inscripción fallida", "Isolato": "Manzana", "La chat della casata": "El chat de la casa", "La chat interna alla casata arriverà in una prossima versione.": "El chat interno de la casa llegará en una próxima versión.", "La cucina consegna dalle": "La cocina sirve desde las", "La mia casata": "Mi casa", "La settimana": "La semana", "La tua postazione": "Tu puesto", "La tua prenotazione": "Tu reserva", "La tua tessera": "Tu tarjeta", "Le date non sono indicate: una serata speciale o il maltempo possono spostare una proiezione. Il giorno esatto lo trovi in <b>Stage</b>, dove si prenota il posto.": "Las fechas no se indican: una velada especial o el mal tiempo pueden mover una proyección. El día exacto está en <b>Escenario</b>, donde se reserva el asiento.", "Le informazioni sono cifrate: visibili solo a te e ai tuoi ospiti collegati.": "La información está cifrada: solo la ves tú y tus huéspedes vinculados.", "Le mie case": "Mis casas", "Le mie lezioni": "Mis clases", "Le mie postazioni": "Mis puestos", "Le mie prenotazioni": "Mis reservas", "Le mie spese": "Mis gastos", "Le prenotazioni a pagamento — cena, bar, lezioni e serate — le fa un adulto per te: fino ai 18 anni non si possono prendere impegni di spesa da soli.": "Las reservas de pago — cena, bar, clases y veladas — las hace un adulto por ti: hasta los 18 años no se asumen gastos por cuenta propia.", "Le serate con quota le prenota un adulto per te.": "Las veladas con cuota las reserva un adulto por ti.", "Le serate speciali": "Las veladas especiales", "Le tue prenotazioni": "Tus reservas", "Le tue strutture": "Tus alojamientos", "Le ultime": "Los últimos", "Leggi questi numeri all'operatore": "Lee estos números al operador", "Lezione al completo.": "Clase completa.", "Lezioni con istruttore": "Clases con instructor", "Lezioni non disponibili": "Clases no disponibles", "Menù non disponibile": "Menú no disponible", "Migliore casata": "Mejor casa", "Modifica": "Editar", "Mostra solo le prossime": "Mostrar solo las próximas", "NON PRENOTABILE": "NO RESERVABLE", "Nessun host trovato con questo nome.": "No se encontró ningún anfitrión con este nombre.", "Nessun iscritto a questa casata.": "Nadie inscrito en esta casa.", "Nessun messaggio. Comincia tu.": "Ningún mensaje. Empieza tú.", "Nessun turno di coworking.": "Ningún turno de coworking.", "Nessun visitatore collegato.": "Ningún visitante vinculado.", "Nessuna lezione in programma.": "Ninguna clase programada.", "Nessuna serata su prenotazione al momento.": "Ninguna velada con reserva por ahora.", "Nessuno spettacolo in programma.": "Ningún espectáculo programado.", "Nome": "Nombre", "Nome e cognome obbligatori": "Nombre y apellido obligatorios", "Nome o cognome dell'host": "Nombre o apellido del anfitrión", "Nome struttura": "Nombre del alojamiento", "Nome, oppure tessera BR-…": "Nombre o tarjeta BR-…", "Non hai ancora aggiunto strutture.": "Aún no has añadido alojamientos.", "Non hai postazioni prenotate.": "No tienes puestos reservados.", "Non lo conosco ora · salta": "No lo sé ahora · omitir", "Non riesco a ottenere la posizione. Di' all'operatore il nome del residence e il numero della villa.": "No consigo la ubicación. Dile al operador el nombre del residence y el número de la villa.", "Numeri rapidi": "Números rápidos", "Numero": "Número", "Oggi al residence": "Hoy en el residence", "Ogni casata accoglie fino a 12 soci. Se è al completo, scegline un’altra.": "Cada casa acoge hasta 12 socios. Si está completa, elige otra.", "Orario di check-out": "Hora de salida", "Ordina e ritira al banco": "Pide y recoge en la barra", "Ordine inviato": "Pedido enviado", "Ore di silenzio": "Horas de silencio", "Ospite collegato": "Huésped vinculado", "Ospite temporaneo: ti colleghi alla casa del tuo host.": "Huésped temporal: te vinculas a la casa de tu anfitrión.", "Passa alla versione completa": "Cambiar a la versión completa", "Per confermare la lezione": "Para confirmar la clase", "Per gli altri giorni usa la sezione Eventi.": "Para los demás días usa la sección Eventos.", "Per il bar, la cena e le serate serve un adulto: fino ai 18 anni non si prenotano cose a pagamento da soli.": "Para el bar, la cena y las veladas hace falta un adulto: hasta los 18 años no se reservan cosas de pago por tu cuenta.", "Per servizio": "Por servicio", "Per un gruppo numeroso accostiamo più tavoli: indica quante persone siete davvero.": "Para un grupo numeroso juntamos varias mesas: indica cuántos sois realmente.", "Per una riunione puoi prendere tutta la sala: scegli il numero di postazioni che ti serve.": "Para una reunión puedes tomar toda la sala: elige cuántos puestos necesitas.", "Perché lo segnali? (facoltativo)": "¿Por qué lo denuncias? (opcional)", "Più tardi": "Más tarde", "Portami lì": "Llévame allí", "Postazione al tavolo": "Puesto en la mesa", "Posti": "Plazas", "Precisione": "Precisión", "Prenota la cena": "Reservar la cena", "Prenotazione disdetta: il campo è tornato libero.": "Reserva anulada: la pista vuelve a estar libre.", "Prenotazione non disponibile.": "Reserva no disponible.", "Prenoti": "Reservas", "Prenoti sempre tu, come titolare. Con <b>Apri ai soci</b> gli altri si uniscono fino a": "Siempre reservas tú, como titular. Con <b>Abrir a los socios</b> los demás se unen hasta", "Prezzo": "Precio", "Programma non disponibile": "Programa no disponible", "Puoi aggiungere le tue case e accogliere i visitatori.": "Puedes añadir tus casas y acoger a los visitantes.", "Qualcosa non ha funzionato nel caricamento.": "Algo no funcionó al cargar.", "Quando confermerà, comparirà \"Casa mia\" con tutte le indicazioni della struttura.": "Cuando confirme, aparecerá \"Mi casa\" con todas las indicaciones del alojamiento.", "Quante persone siete?": "¿Cuántos sois?", "Quante persone?": "¿Cuántas personas?", "Quante postazioni": "Cuántos puestos", "Questa casata non ha ancora un capitano.": "Esta casa aún no tiene capitán.", "Questo codice non è il QR di un tavolo.": "Este código no es el QR de una mesa.", "Questo telefono non legge i codici dall’app: apri la fotocamera del telefono e inquadra il QR sul tavolo.": "Este teléfono no lee códigos desde la app: abre la cámara del teléfono y escanea el QR de la mesa.", "Qui c’è solo quello che hai fatto con la tessera: al Bar e al Garden si è serviti anche senza, e quelle consumazioni non compaiono.": "Aquí solo está lo que has hecho con la tarjeta: en el Bar y en el Garden se sirve también sin ella, y esas consumiciones no aparecen.", "Rassegna": "Ciclo", "Rassegna cinematografica": "Ciclo de cine", "Rassegna non ancora pubblicata.": "Ciclo aún no publicado.", "Rassegna non disponibile": "Ciclo no disponible", "Registrati": "Regístrate", "Registrazione non riuscita": "Registro fallido", "Regole della casa": "Normas de la casa", "Richiesta inviata": "Solicitud enviada", "Richieste in attesa": "Solicitudes pendientes", "Riprova": "Reintentar", "Riservata": "Reservada", "Rispondi e l'app trova il profilo giusto per te.": "Responde y la app encuentra el perfil adecuado para ti.", "Sala non disponibile": "Sala no disponible", "Salva": "Guardar", "Salva la tua tessera (immagine)": "Guarda tu tarjeta (imagen)", "Salva o stampa la rassegna": "Guardar o imprimir el ciclo", "Salva tessera": "Guardar tarjeta", "Scegli": "Elegir", "Scegli la casata": "Elige la casa", "Scegli la disciplina": "Elige la disciplina", "Scegli la tua casata": "Elige tu casa", "Scollega": "Desvincular", "Scollegare questo visitatore dalla casa?": "¿Desvincular a este visitante de la casa?", "Scopri le nostre serate speciali": "Descubre nuestras veladas especiales", "Scrivi il nome di chi gioca, oppure la sua tessera.": "Escribe el nombre de quien juega, o su tarjeta.", "Scrivi qui…": "Escribe aquí…", "Segnala": "Denunciar", "Segnalare questo messaggio al gestore? Verrà letto da lui.": "¿Denunciar este mensaje al gestor? Él lo leerá.", "Serve l'accesso con la tessera": "Se requiere acceso con la tarjeta", "Serve la tessera di un socio per iscriverti": "Se necesita la tarjeta de un socio para inscribirse", "Serve la tessera di un socio per prenotare": "Se necesita la tarjeta de un socio para reservar", "Serve la tessera per vedere le tue spese": "Necesitas tu tarjeta para ver tus gastos", "Serve per accedere di nuovo con un codice via e-mail.": "Sirve para acceder de nuevo con un código por correo.", "Servono": "Hacen falta", "Settimana": "Semana", "Si disdice senza pagare fino a": "Se anula sin pagar hasta", "Si gioca: numero minimo raggiunto": "Se juega: mínimo alcanzado", "Si occupa una sedia, non un tavolo: si lavora anche in una sala condivisa.": "Se ocupa una silla, no una mesa: también se trabaja en una sala compartida.", "Si paga la singola lezione, in contanti a fine lezione. Sotto il minimo di iscritti la lezione non parte.": "Se paga cada clase, en efectivo al final. Por debajo del mínimo de inscritos la clase no se hace.", "Soggiorno dal": "Estancia desde", "Solo io": "Solo yo", "Sono in vacanza (visitatore)": "Estoy de vacaciones (visitante)", "Sono residente": "Soy residente", "Sono socio": "Soy socio", "Sono socio e residente": "Soy socio y residente", "Spettacolo": "Espectáculo", "Stage": "Escenario", "Stai prenotando per stasera": "Estás reservando para esta noche", "Stasera": "Esta noche", "Stasera alle": "Esta noche a las", "Stasera il Garden non prende prenotazioni.": "Esta noche el Garden no acepta reservas.", "Su Android (Chrome): tocca il menu (⋮) in alto a destra, poi “Aggiungi a schermata Home” / “Installa app”.": "En Android (Chrome): toca el menú (⋮) arriba a la derecha y luego \"Añadir a la pantalla de inicio\" / \"Instalar app\".", "Su iPhone/iPad (Safari): tocca Condividi (⬆️) in basso, poi “Aggiungi a Home”.": "En iPhone/iPad (Safari): toca Compartir (⬆️) abajo y luego \"Añadir a inicio\".", "Su prenotazione": "Con reserva", "Tavolo": "Mesa", "Tavolo da gioco": "Mesa de juego", "Tavolo per 4 persone": "Mesa para 4 personas", "Tessera salvata nelle immagini": "Tarjeta guardada en las fotos", "Tesserato: casata, Coppa, inviti.": "Socio: casa, Copa, invitaciones.", "Ti hanno convocato": "Te han convocado", "Ti restano": "Te quedan", "Tieni l’app a portata di mano": "Ten la app a mano", "Tocca una lezione per iscriverti. Il colore è la disciplina.": "Toca una clase para inscribirte. El color es la disciplina.", "Tocca una serata per i dettagli.": "Toca una velada para ver los detalles.", "Togli questo avviso": "Quitar este aviso", "Totale speso": "Total gastado", "Turni": "Turnos", "Tutto del socio (casata, Coppa) + gestisco case vacanza.": "Todo lo del socio (casa, Copa) + gestiono casas de vacaciones.", "Tutto pronto": "Todo listo", "Un socio si aggiunge con la tessera e i punti della Coppa gli vengono conteggiati. Un ospite si aggiunge col nome: gioca lo stesso, ma resta scritto chi era in campo.": "Un socio se añade con su tarjeta y los puntos de la Copa le cuentan. Un invitado se añade con el nombre: juega igual, pero queda escrito quién estaba en la pista.", "Un visitatore ti ha indicato come host: conferma per agganciarlo alla casa.": "Un visitante te ha indicado como anfitrión: confirma para vincularlo a la casa.", "Vai alla Coppa": "Ir a la Copa", "Vedi tutte": "Ver todas", "Versione completa": "Versión completa", "Versione semplice": "Versión sencilla", "Vivo nel residence; posso gestire case vacanza.": "Vivo en el residence; puedo gestionar casas de vacaciones.", "a pari merito": "empatados", "al": "al", "al completo": "completo", "alla Casa di Carta": "en la Casa di Carta", "alle": "a las", "cena e tavolo": "cena y mesa", "classifica e prossime partite": "clasificación y próximos partidos", "compreso": "incluido", "consumazione obbligatoria": "consumición obligatoria", "coperti prenotati": "cubiertos reservados", "dal": "del", "di": "de", "di più…": "más…", "dice di essere tuo ospite": "dice ser tu huésped", "e capitani": "y capitanes", "entro le": "antes de las", "es. Chiara": "p. ej. Chiara", "fasce": "franjas", "fasce di oggi sono già passate e non si possono prenotare.": "franjas de hoy ya han pasado y no se pueden reservar.", "fascia di oggi è già passata e non si può prenotare.": "franja de hoy ya ha pasado y no se puede reservar.", "film": "películas", "giocatori": "jugadores", "giocatori: da soli non si occupa un tavolo.": "jugadores: solo no se ocupa una mesa.", "giocatori: ne mancano": "jugadores: faltan", "giocatori; con <b>Solo io</b> lo slot resta riservato. I campi sono gratuiti.": "jugadores; con <b>Solo yo</b> la franja queda reservada. Las pistas son gratuitas.", "gratis": "gratis", "in corso: chiedila al banco": "en curso: pídela en la barra", "la posizione resta sul tuo telefono, non viene inviata a nessuno": "la ubicación se queda en tu teléfono, no se envía a nadie", "la rassegna": "el ciclo", "la teniamo per chi ha più di 70 anni, fino a esaurimento. Te la assegniamo da soli.": "la reservamos para los mayores de 70 años, hasta agotarse. Te la asignamos nosotros.", "la tua": "la tuya", "lezioni con istruttore": "clases con instructor", "minuti all’inizio, quindi la lezione resta dovuta anche se disdici. Procedo?": "minutos para el inicio, así que la clase se debe aunque la anules. ¿Continúo?", "minuti prima": "minutos antes", "nessun posto libero": "ninguna plaza libre", "nessun tavolo libero": "ninguna mesa libre", "nessuna postazione libera": "ningún puesto libre", "orari, rifiuti, numeri": "horarios, residuos, números", "ordina e ritira": "pide y recoge", "organizzatevi fra voi": "organizaos entre vosotros", "ospite senza tessera": "invitado sin tarjeta", "partita da confermare": "partido por confirmar", "partite da confermare": "partidos por confirmar", "per confermare la lezione": "para confirmar la clase", "per stasera, tavolo da 4": "para esta noche, mesa para 4", "persone": "personas", "piastra e friggitrice devono scaldarsi. L’ordine è già preso.": "la plancha y la freidora deben calentarse. Tu pedido ya está tomado.", "posizione": "posición", "postazioni": "puestos", "postazioni libere": "puestos libres", "posti davanti al palco": "asientos delante del escenario", "posti liberi": "plazas libres", "posto allo spettacolo": "asiento en el espectáculo", "prodotti": "productos", "restano solo i posti in fondo": "solo quedan asientos al fondo", "segnalato": "denunciado", "si paga in cassa. Ti avvisiamo quando è pronto.": "se paga en caja. Te avisamos cuando esté listo.", "soci": "socios", "socio": "socio", "solo per te? Nessun altro potrà unirsi.": "¿solo para ti? Nadie más podrá unirse.", "su": "de", "su questo campo": "en esta pista", "tavoli liberi": "mesas libres", "tavolo": "mesa", "tavolo da gioco": "mesa de juego", "titolare": "titular", "unisciti a chi sta giocando": "únete a quienes ya juegan", "volta": "vez", "volta in cui non hai pagato niente: è compreso.": "vez en que no has pagado nada: está incluido.", "volte": "veces", "volte in cui non hai pagato niente: è compreso.": "veces en que no has pagado nada: está incluido.", "È fatta": "Hecho", "È lui/lei": "Es él/ella"}};
for (const _l of ['en','fr','de','es']) { UI[_l] = Object.assign(UI[_l] || {}, UI_EXTRA[_l]); }
// TRADURRE I DATI, NON SOLO L'INTERFACCIA.
//
// Le voci della guida — servizi, rifiuti, punti di interesse — non sono testi dell'app: sono
// dati del database, scritti dal gestore. Per questo il titolo "Waste collection" era tradotto
// e le righe sotto restavano "Lun · Organico": il dizionario dell'interfaccia non le vede
// nemmeno.
//
// Qui si traducono i TERMINI, non le frasi: i tipi di rifiuto, i giorni, le categorie di
// servizio, i descrittori dei luoghi. Sono vocabolari chiusi e piccoli, e coprono tutto quello
// che c'e' davvero nella guida. Quello che non e' in elenco passa immutato — un nome proprio
// come "Ortigia" o "Cavagrande del Cassibile" non si traduce, e va bene cosi'.
const TERMINI = {
  en: {
    Organico: 'Food waste', Plastica: 'Plastic', Carta: 'Paper', Vetro: 'Glass', Indifferenziato: 'General waste',
    Lun: 'Mon', Mar: 'Tue', Mer: 'Wed', Gio: 'Thu', Ven: 'Fri', Sab: 'Sat', Dom: 'Sun',
    ESTIVO: 'SUMMER', INVERNALE: 'WINTER',
    Farmacia: 'Pharmacy', 'Guardia medica': 'Out-of-hours doctor', Spiaggia: 'Beach',
    'Market & alimentari': 'Grocery shop', 'Bar & tabacchi': 'Cafe & tobacconist',
    'Centro storico': 'Old town', cultura: 'culture', natura: 'nature', barocco: 'baroque',
    'Luogo di culto': 'Place of worship', 'Area marina protetta': 'Marine protected area',
    'Teatro Greco': 'Greek Theatre', 'Laghetti e sentieri': 'Pools and trails',
    'Chiosco La Bussola': 'La Bussola kiosk', 'Isola ecologica': 'Recycling point',
    'Estivo': 'Summer',
    'Invernale': 'Winter',
    'Plastica e lattine': 'Plastic and cans',
    'Carta e cartone': 'Paper and cardboard',
    'Vetro e barattoli': 'Glass and jars',
    'dopo': 'after',
    'Dalle': 'From',
    'alle': 'to',
    'riposo per tutti': 'rest for everyone',
    'si abbassano voci e musica': 'voices and music turned down'
  },
  fr: {
    Organico: 'Déchets alimentaires', Plastica: 'Plastique', Carta: 'Papier', Vetro: 'Verre', Indifferenziato: 'Ordures ménagères',
    Lun: 'Lun', Mar: 'Mar', Mer: 'Mer', Gio: 'Jeu', Ven: 'Ven', Sab: 'Sam', Dom: 'Dim',
    ESTIVO: 'ÉTÉ', INVERNALE: 'HIVER',
    Farmacia: 'Pharmacie', 'Guardia medica': 'Garde médicale', Spiaggia: 'Plage',
    'Market & alimentari': 'Épicerie', 'Bar & tabacchi': 'Café & tabac',
    'Centro storico': 'Centre historique', cultura: 'culture', natura: 'nature', barocco: 'baroque',
    'Luogo di culto': 'Lieu de culte', 'Area marina protetta': 'Aire marine protégée',
    'Teatro Greco': 'Théâtre grec', 'Laghetti e sentieri': 'Bassins et sentiers',
    'Chiosco La Bussola': 'Kiosque La Bussola', 'Isola ecologica': 'Déchetterie',
    'Estivo': 'Été',
    'Invernale': 'Hiver',
    'Plastica e lattine': 'Plastique et canettes',
    'Carta e cartone': 'Papier et carton',
    'Vetro e barattoli': 'Verre et bocaux',
    'dopo': 'après',
    'Dalle': 'De',
    'alle': 'à',
    'riposo per tutti': 'repos pour tous',
    'si abbassano voci e musica': 'on baisse les voix et la musique'
  },
  de: {
    Organico: 'Biomüll', Plastica: 'Plastik', Carta: 'Papier', Vetro: 'Glas', Indifferenziato: 'Restmüll',
    Lun: 'Mo', Mar: 'Di', Mer: 'Mi', Gio: 'Do', Ven: 'Fr', Sab: 'Sa', Dom: 'So',
    ESTIVO: 'SOMMER', INVERNALE: 'WINTER',
    Farmacia: 'Apotheke', 'Guardia medica': 'Ärztlicher Notdienst', Spiaggia: 'Strand',
    'Market & alimentari': 'Lebensmittelladen', 'Bar & tabacchi': 'Café & Tabakladen',
    'Centro storico': 'Altstadt', cultura: 'Kultur', natura: 'Natur', barocco: 'Barock',
    'Luogo di culto': 'Sakralbau', 'Area marina protetta': 'Meeresschutzgebiet',
    'Teatro Greco': 'Griechisches Theater', 'Laghetti e sentieri': 'Naturbecken und Wege',
    'Chiosco La Bussola': 'Kiosk La Bussola', 'Isola ecologica': 'Wertstoffhof',
    'Estivo': 'Sommer',
    'Invernale': 'Winter',
    'Plastica e lattine': 'Plastik und Dosen',
    'Carta e cartone': 'Papier und Karton',
    'Vetro e barattoli': 'Glas und Gläser',
    'dopo': 'nach',
    'Dalle': 'Von',
    'alle': 'bis',
    'riposo per tutti': 'Ruhe für alle',
    'si abbassano voci e musica': 'Stimmen und Musik leiser'
  },
  es: {
    Organico: 'Orgánico', Plastica: 'Plástico', Carta: 'Papel', Vetro: 'Vidrio', Indifferenziato: 'Resto',
    Lun: 'Lun', Mar: 'Mar', Mer: 'Mié', Gio: 'Jue', Ven: 'Vie', Sab: 'Sáb', Dom: 'Dom',
    ESTIVO: 'VERANO', INVERNALE: 'INVIERNO',
    Farmacia: 'Farmacia', 'Guardia medica': 'Servicio médico de urgencia', Spiaggia: 'Playa',
    'Market & alimentari': 'Supermercado', 'Bar & tabacchi': 'Bar y estanco',
    'Centro storico': 'Centro histórico', cultura: 'cultura', natura: 'naturaleza', barocco: 'barroco',
    'Luogo di culto': 'Lugar de culto', 'Area marina protetta': 'Área marina protegida',
    'Teatro Greco': 'Teatro Griego', 'Laghetti e sentieri': 'Lagunas y senderos',
    'Chiosco La Bussola': 'Quiosco La Bussola', 'Isola ecologica': 'Punto limpio',
    'Estivo': 'Verano',
    'Invernale': 'Invierno',
    'Plastica e lattine': 'Plástico y latas',
    'Carta e cartone': 'Papel y cartón',
    'Vetro e barattoli': 'Vidrio y tarros',
    'dopo': 'después de',
    'Dalle': 'De',
    'alle': 'a',
    'riposo per tutti': 'descanso para todos',
    'si abbassano voci e musica': 'se bajan voces y música'
  }
};

// Traduce un dato del database. Prima prova la frase intera, poi i pezzi separati da "·" o
// "e": "Centro storico di Siracusa · cultura" diventa "Old town of Siracusa · culture" senza
// che nessuno debba scrivere quella frase in cinque lingue.
function D(testo) {
  const t = String(testo == null ? '' : testo);
  if (!t || state.lang === 'it') return t;
  const dz = TERMINI[state.lang];
  if (!dz) return t;
  // Il confronto NON distingue maiuscole e minuscole, e restituisce il risultato nella stessa
  // forma dell'originale. Nel database i tipi di rifiuto possono essere scritti "PLASTICA" o
  // "Plastica" a seconda di chi li ha inseriti: cercare solo la forma esatta lasciava in
  // italiano proprio le voci scritte in maiuscolo, in mezzo a tutto il resto tradotto.
  const comeEra = (orig, tradotto) => {
    if (orig === orig.toUpperCase() && orig !== orig.toLowerCase()) return tradotto.toUpperCase();
    return tradotto;
  };
  const cerca = (frase) => {
    if (dz[frase]) return dz[frase];
    const giu = frase.toLowerCase();
    for (const [it, tr] of Object.entries(dz)) {
      if (it.toLowerCase() === giu) return comeEra(frase, tr);
    }
    return null;
  };
  const diretto = cerca(t);
  if (diretto) return diretto;
  // Frasi con un orario dentro: la struttura e' fissa, cambia solo l'ora. Tradurle a pezzi
  // eviterebbe di dover scrivere in cinque lingue ogni possibile orario.
  const dopo = /^dopo le (\d{1,2}[:.]\d{2})$/i.exec(t.trim());
  if (dopo) return `${dz['dopo'] || 'dopo'} ${dopo[1]}`;
  const fascia = /^dalle (\d{1,2}[:.]\d{2}) alle (\d{1,2}[:.]\d{2})(.*)$/i.exec(t.trim());
  if (fascia) {
    const coda = String(fascia[3] || '').replace(/^\s*—\s*/, '');
    return `${dz['Dalle'] || 'Dalle'} ${fascia[1]} ${dz['alle'] || 'alle'} ${fascia[2]}${coda ? ' — ' + (dz[coda.trim()] || coda.trim()) : ''}`;
  }
  return t.split(/(\s·\s)/).map(pezzo => {
    if (pezzo === ' · ') return pezzo;
    const p = pezzo.trim();
    const dritto = cerca(p);
    if (dritto) return pezzo.replace(p, dritto);
    // "Centro storico di Siracusa": si traduce la parte nota e si lascia il nome proprio.
    for (const [it, tr] of Object.entries(dz)) {
      if (p.toLowerCase().startsWith(it.toLowerCase() + ' ')) {
        return pezzo.replace(p, comeEra(p.slice(0, it.length), tr) + p.slice(it.length));
      }
    }
    return pezzo;
  }).join('');
}

function T(it){ const d = UI[state.lang]; if (d && d[it] != null) return d[it]; const h = UI_HOST[state.lang]; return (h && h[it]) || it; }
function applyLang(code){
  state.lang = code; store.set('lang_code', code);
  const el = $('#langLbl'); if (el) el.textContent = code.toUpperCase().slice(0,2);
  const src = I18N[code] || I18N.it;
  document.querySelectorAll('.tab').forEach(b => { const k = b.dataset.t; if (src[k]) { const svg = b.querySelector('svg'); b.textContent=''; if (svg) b.appendChild(svg); b.appendChild(document.createTextNode(src[k])); } });
  const lbl = document.querySelector('.a11y .lbl'); if (lbl) lbl.textContent = src.testo || 'Testo';
  // Il tasto "Tessera" in testata sta nell'HTML e non passa da T(): si traduce qui, altrimenti
  // resta l'unica parola italiana in mezzo a una schermata tradotta.
  const tsBtn = document.getElementById('tesseraBtn');
  if (tsBtn && tsBtn.lastChild && tsBtn.lastChild.nodeType === 3) tsBtn.lastChild.nodeValue = T('Tessera');
  const hc = $('#hcBtn'); if (hc) hc.textContent = '◑ ' + (src.contrasto || 'Contrasto');
  // Ridisegno tutte le schermate con i testi tradotti così il cambio lingua è live ovunque.
  try {
    renderHeader(); renderHome(); renderEventi(); renderCoppa(); renderBussola();
    renderDom('sport'); renderDom('giochi');
  } catch {}
}
// IL GATE PARLA LA LINGUA DELL'OSPITE. Qui dentro non si e' ancora entrati: la barra in alto
// col tasto IT non esiste, e i testi erano scritti fissi in italiano dentro l'HTML. Un ospite
// straniero apriva il QR, trovava "Codice tessera" e "Non hai un account? Registrati" e si
// fermava li' — il percorso di registrazione tradotto non lo raggiungeva nemmeno.
const GATE_TESTI = {
  it: { t1: 'Benvenuto', t2: 'Entra con la tua tessera per vedere il tuo profilo, la Coppa e gli inviti della casata.', t3: 'Codice tessera', entra: 'Entra', email: 'Non ho la tessera · accedi con e-mail', reg: '\u2728 Non hai un account? Registrati' },
  en: { t1: 'Welcome', t2: 'Sign in with your card to see your profile, the Cup and your house invitations.', t3: 'Card number', entra: 'Enter', email: "I don't have a card · sign in by e-mail", reg: '\u2728 No account yet? Register' },
  fr: { t1: 'Bienvenue', t2: 'Entrez avec votre carte pour voir votre profil, la Coupe et les invitations de votre maison.', t3: 'Num\u00e9ro de carte', entra: 'Entrer', email: "Je n'ai pas de carte \u00b7 se connecter par e-mail", reg: '\u2728 Pas encore de compte ? Inscrivez-vous' },
  de: { t1: 'Willkommen', t2: 'Mit deiner Karte anmelden: Profil, Pokal und Einladungen deines Hauses.', t3: 'Kartennummer', entra: 'Eintreten', email: 'Ich habe keine Karte \u00b7 per E-Mail anmelden', reg: '\u2728 Noch kein Konto? Registrieren' },
  es: { t1: 'Bienvenido', t2: 'Entra con tu tarjeta para ver tu perfil, la Copa y las invitaciones de tu casa.', t3: 'N\u00famero de tarjeta', entra: 'Entrar', email: 'No tengo tarjeta \u00b7 entrar con correo', reg: '\u2728 \u00bfA\u00fan no tienes cuenta? Reg\u00edstrate' }
};

function aggiornaGate() {
  const t = GATE_TESTI[state.lang] || GATE_TESTI.it;
  const metti = (id, testo) => { const el = $(id); if (el) el.textContent = testo; };
  metti('#gate_t1', t.t1); metti('#gate_t2', t.t2); metti('#gate_t3', t.t3);
  metti('#gate_enter', t.entra); metti('#gate_email', t.email); metti('#gate_register', t.reg);
  const box = $('#gateLang');
  if (box) {
    box.innerHTML = LANGS.map(([code, nome]) =>
      `<button type="button" data-gatelang="${code}" aria-pressed="${state.lang === code}">${esc(nome)}</button>`).join('');
    box.querySelectorAll('[data-gatelang]').forEach(b => b.onclick = () => {
      applyLang(b.dataset.gatelang);
      aggiornaGate();
    });
  }
}

function openLang() {
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--teal)">Lingua · Language</div><h2>${T('Scegli la lingua')}</h2><p class="sub">${T("Scegli la lingua dell'app")}</p>
    <div class="chips" style="flex-direction:column; align-items:stretch">${LANGS.map(l=>`<button class="chip" style="text-align:left; display:flex; justify-content:space-between; align-items:center" data-lang="${l[0]}">${l[1]}</button>`).join('')}</div>
    <button class="btn ghost block" style="margin-top:10px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
function openSos() {
  const serv = state.data.bussola?.servizi || SEED.bussola.servizi;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">${T('Numeri utili')}</div><h2>${T('Emergenze & servizi')}</h2><p class="sub">${T('In caso di necessità.')}</p>
    <div class="card" style="padding:4px 14px">${serv.map(x=>`<div class="matchrow"><div style="flex:1"><b style="font-size:.85rem">${esc(x.titolo)}</b><div class="ct">${esc(x.dettaglio||'')}</div></div><span class="ct">${esc(x.distanza||'')}</span></div>`).join('')}
      <div class="matchrow"><div style="flex:1"><b style="font-size:.85rem; color:var(--coral)">${T('Emergenze (112)')}</b><div class="ct">${T('Numero unico europeo')}</div></div></div></div>
    <button class="btn navy block" style="margin-top:12px" data-close>${T('Chiudi')}</button>`);
  showOv();
}

// ---- Modalità CAPITANO ----------------------------------------------------
let _serataText = '', _capPartite = [], _capCurrent = null;
async function openCapConvoca() {
  let partite = [];
  try { partite = await api('/auth/capitano/partite'); } catch {}
  _capPartite = partite;
  if (!partite.length) {
    setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${T('Capitano')} · ${esc(state.socio.casata || '')}</div><h2>${T('Convoca la tua casata')}</h2><p class="sub">${T("Nessuna partita da coprire al momento (serve l'accesso da capitano e un calendario generato dallo staff).")}</p><button class="btn navy block" data-close>${T('Chiudi')}</button>`);
    return showOv();
  }
  const rows = partite.map((p, i) => {
    const short = p.disponibili < p.minimo;
    return `<div class="card" style="padding:12px; margin-bottom:8px">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div style="flex:1"><b style="font-size:.9rem">${esc(p.disciplina)} · G${p.giornata}</b><div class="ct">vs ${esc(p.avversario)}</div></div>
        <div style="text-align:center"><div style="font-family:Georgia,serif; font-weight:700; font-size:1.2rem; color:${short ? 'var(--coral)' : 'var(--sage)'}">${p.disponibili}/${p.minimo}</div><div class="ct">${T('dispon.')}</div></div>
      </div>
      <button class="btn ${short ? 'gold' : 'ghost'} sm" style="margin-top:8px; width:100%" data-capm="${i}">${short ? T('Serve gente — convoca') : T('Convoca giocatori')}</button>
    </div>`;
  }).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${T('Capitano')} · ${esc(state.socio.casata || '')}</div><h2>${T('Chi copre le partite?')}</h2><p class="sub">${T('Rosso = mancano disponibili rispetto al minimo. Tocca una partita per convocare i singoli.')}</p>${rows}<button class="btn navy block" style="margin-top:6px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
function openCapMembri(idx) {
  const p = _capPartite[idx]; if (!p) return;
  _capCurrent = p;
  const rows = p.membri.map(m => {
    const conv = m.stato !== 'non_convocato';
    const badge = m.stato === 'disponibile' ? `<span style="color:var(--sage); font-weight:700">${T('disponibile')}</span>`
      : m.stato === 'non_disponibile' ? `<span style="color:var(--coral)">${T('non disp.')}</span>`
      : conv ? `<span class="muted">${T('in attesa')}</span>` : '';
    return `<label style="display:flex; gap:10px; align-items:center; padding:9px 2px; border-bottom:1px solid var(--line)">
      <input type="checkbox" data-capchk value="${m.id}" ${conv ? 'disabled checked' : ''} style="width:auto; transform:scale(1.3)">
      <span style="flex:1">${esc(m.nome)}</span>${badge}</label>`;
  }).join('');
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${esc(p.disciplina)} · G${p.giornata}</div><h2>${T('Convoca i giocatori')}</h2><p class="sub">vs ${esc(p.avversario)} — ${T('servono')} ${p.minimo}, ${T('disponibili')} ${p.disponibili}. ${T('Spunta chi vuoi convocare.')}</p>
    <div class="card" style="padding:2px 14px">${rows}</div>
    <button class="btn gold block" style="margin-top:12px" data-capsend>${T('Convoca i selezionati')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-cap="convoca">${T('← Torna alle partite')}</button>`);
  showOv();
}
async function capSendMirata() {
  const ids = [...document.querySelectorAll('[data-capchk]:not(:disabled):checked')].map(c => Number(c.value));
  if (!ids.length) { okThen(T('Seleziona almeno un giocatore')); return; }
  try { const r = await api('/auth/capitano/convoca-mirata', { method: 'POST', body: JSON.stringify({ partita_id: _capCurrent.partita_id, socio_ids: ids }) }); okThen(`${T('Convocati')} ${r.convocati} ${T('giocatori')}`); }
  catch { okThen(T('Non riesco a convocare ora')); }
}
function openCapSerata() {
  const sorted = [...state.data.casate].sort((a, b) => (a.posizione || 99) - (b.posizione || 99) || b.punti - a.punti);
  const mine = state.socio.casata;
  const idx = sorted.findIndex(c => c.nome === mine);
  const pos = idx < 0 ? 0 : posizioneDi(sorted[idx], sorted, idx);
  const my = sorted.find(c => c.nome === mine) || sorted[0];
  const ct = state.data.contest;
  const titolo = ct ? ct.titolo : T('Serata dei Clan');
  const sfida = ct ? (ct.brief || '') : ((state.data.eventi || []).find(e => e.chiave === 'ven')?.descrizione || T('La sfida di venerdì'));
  _serataText = `🎬 ${T('Serata dei Clan')} — "${titolo}"${ct && ct.settimana ? ` (${ct.settimana})` : ''}\n${sfida}\n${T('Casata')} ${mine}: ${T('siamo')} ${pos}° ${T('con')} ${my.punti} ${T('punti')}. ${T('Forza')} ${mine}! 💪`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--gold)">${T('Capitano')} · ${T('Serata dei Clan')}</div><h2>${esc(titolo)}</h2>
    <div class="card" style="background:linear-gradient(135deg,${my.colore || '#12324F'},#0d2740); color:#fff; border:none">
      <div class="eyebrow" style="color:#ffe1ac">${T('Casata')} ${esc(mine)} · ${pos}° ${T('posto')} · ${my.punti} ${T('punti')}</div>
      <p style="font-size:.85rem; opacity:.95; margin-top:6px; white-space:pre-wrap">${esc(sfida)}</p>
      <p style="font-size:.8rem; opacity:.85; margin-top:8px">${T('Rilancia la sfida ai tuoi. Forza')} ${esc(mine)}!</p>
    </div>
    <button class="btn gold block" style="margin-top:12px" data-cap="share">${T('Condividi con la casata')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
function openContest() {
  const ct = state.data.contest; if (!ct) return;
  _serataText = `🎬 ${T('Serata dei Clan')} — "${ct.titolo}"${ct.settimana ? ` (${ct.settimana})` : ''}\n${ct.brief || ''}\n${T('Forza')} ${state.socio.casata || T('la nostra casata')}!`;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">${T('Serata dei Clan · Contest')}${ct.settimana ? ' · ' + esc(ct.settimana) : ''}</div><h2>${esc(ct.titolo)}</h2>
    ${ct.tipo ? `<p class="sub">${esc(ct.tipo)}${ct.stato ? ' · ' + esc(ct.stato) : ''}</p>` : ''}
    <div class="card"><p style="font-size:.9rem; line-height:1.5; white-space:pre-wrap">${esc(ct.brief || '')}</p></div>
    ${ct.vincitore ? `<div class="note">🏆 ${T('Vincitore:')} ${esc(ct.vincitore)}</div>` : ''}
    <button class="btn gold block" style="margin-top:12px" data-cap="share">${T('Condividi')}</button>
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
  showOv();
}
async function capShare() {
  try { if (navigator.share) { await navigator.share({ title: T('Serata dei Clan'), text: _serataText }); } else { await navigator.clipboard.writeText(_serataText); okThen(T('Testo copiato: incollalo nel gruppo')); } } catch {}
}
async function rispondiConvocazione(id, st) {
  try { await api('/convocazioni/' + id + '/risposta', { method: 'POST', body: JSON.stringify({ stato: st }) }); } catch {}
  okThen(st === 'disponibile' ? T('Presenza confermata') : T('Hai declinato'));
}

// QR semplice (segnaposto grafico — in produzione libreria QR reale)
function qrSvg(text) {
  let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let cells = '';
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) { h = (h * 1103515245 + 12345) & 0x7fffffff; if ((h >> 6) & 1) cells += `<rect x="${8+x*7}" y="${8+y*7}" width="7" height="7"/>`; }
  const finder = (x,y)=>`<rect x="${x}" y="${y}" width="21" height="21"/><rect x="${x+4}" y="${y+4}" width="13" height="13" fill="#fff"/><rect x="${x+7}" y="${y+7}" width="7" height="7" fill="#12324F"/>`;
  return `<svg viewBox="0 0 100 100" shape-rendering="crispEdges" aria-label="QR tessera"><rect width="100" height="100" fill="#fff"/><g fill="#12324F">${finder(6,6)}${finder(73,6)}${finder(6,73)}${cells}</g></svg>`;
}

// ---- Accessibilità --------------------------------------------------------
function applyScale(v) {
  document.documentElement.style.setProperty('--scale', v);
  // La dimensione va applicata alla radice (html): così TUTTI i testi in rem scalano davvero.
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
  okThen(`${T('Prenotazione registrata')} · ${nome}${day?` · ${day} ${slot}`:''}${persone?` · ${persone} ${T('pers.')}`:''}`);
}
// --- Serate speciali a numero chiuso con quota (da saldare) ---
function openSerata(id) {
  const s = (state.data.serate || []).find(x => String(x.id) === String(id)); if (!s) return;
  const esaurita = s.posti_liberi != null && s.posti_liberi <= 0;
  setSheet(`<div class="grab"></div><div class="eyebrow" style="color:var(--coral)">${T('Serata su prenotazione')}${s.quando ? ' · ' + esc(s.quando) : ''}</div><h2>${esc(s.titolo)}</h2>
    ${s.tema ? `<p class="sub">${esc(s.tema)}</p>` : ''}
    <div class="card"><p style="font-size:.9rem; line-height:1.5">${esc(s.descrizione || '')}</p>
      <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:.85rem"><b>${T('Quota')}</b><span>€ ${esc(String(s.quota))} ${T('a persona')}</span></div>
      ${s.posti_liberi != null ? `<div style="display:flex; justify-content:space-between; font-size:.8rem; color:var(--mute)"><span>${T('Posti disponibili')}</span><span>${s.posti_liberi}</span></div>` : ''}
    </div>
    ${esaurita ? `<div class="note">${T('Posti esauriti per questa serata.')}</div>` : `
    <div class="field" style="margin-top:10px"><label>${T('Quante persone')}</label><div class="chips" data-group="serp">${[1,2,3,4,5,6].map((n,i)=>`<button class="chip${i===1?' sel':''}" data-chip>${n}</button>`).join('')}</div></div>
    <div class="note">${T('Prenotazione a numero chiuso: la quota si salda in cassa alla conferma (il pagamento in-app arriverà più avanti).')}</div>
    <button class="btn gold block" style="margin-top:10px" data-do-serata="${s.id}">${T('Prenota')} (€ ${esc(String(s.quota))} ${T('a persona')})</button>`}
    <button class="btn ghost block" style="margin-top:8px" data-close>${T('Chiudi')}</button>`);
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
    return okThen(`${T('Sei in lista per')} "${data.titolo || (s && s.titolo) || T('la serata')}" · ${persone} ${T('pers.')} · € ${data.importo} ${T('da saldare in cassa')}`);
  } catch {
    const imp = s ? s.quota * persone : 0;
    okThen(`${T('Prenotazione registrata')} · ${persone} ${T('pers.')}${imp?` · € ${imp} ${T('da saldare')}`:''}`);
  }
}
async function doProposta(tipo) {
  const titolo = $('#in1')?.value || '';
  const dettaglio = tipo==='vinile' ? [$('#in2')?.value, $('#in3')?.value].filter(Boolean).join(' — ') : ($('[data-group="tipo"] .sel')?.textContent || '');
  try { await api('/proposte', { method:'POST', body: JSON.stringify({ tessera_code: state.tessera, tipo, titolo, dettaglio }) }); } catch {}
  okThen(tipo==='vinile' ? T('La tua proposta è in lista') : T('Sei in scaletta per domenica'));
}
function convOk(key) { state.conv[key] = 'ok'; const [dom]=key.split('/'); renderDom(dom); okThen(T('Presenza confermata')); }
function convNo(key) { state.rifiuti = Math.min(3, state.rifiuti+1); state.conv[key]='no'; const [dom]=key.split('/'); renderDom(dom); }

// ---- Delegazione eventi (un solo listener) --------------------------------
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-open],[data-book],[data-campi],[data-partite],[data-chigioca],[data-spese],[data-notifvia],[data-host],[data-disdici],[data-fitdisd],[data-giocadd],[data-giocvia],[data-campo-pick],[data-campo-date],[data-campo-fasce],[data-prenota],[data-apri],[data-unisci],[data-casamia],[data-lemiecase],[data-collega],[data-strutt-edit],[data-strutt-del],[data-strutt-new],[data-strutt-save],[data-osp-scollega],[data-reg-tipo],[data-reg-cancel],[data-reg-save],[data-reg-back],[data-reg-host],[data-reg-skiphost],[data-req-ok],[data-req-no],[data-savecard],[data-install],[data-opencasata],[data-casata],[data-casatamembri],[data-chat],[data-chat-segnala],[data-vai],[data-cena-subito],[data-partite],[data-aiuto],[data-modo],[data-mappa],[data-gard-oggi],[data-serate-tutte],[data-fitness],[data-cowo],[data-cowo-date],[data-cowo-pers],[data-cowo-pren],[data-cowo-ann],[data-carta],[data-stage],[data-fitpren],[data-fitapri],[data-rassegna],[data-rassegnastampa],[data-fitsett],[data-carta-date],[data-carta-pers],[data-carta-pren],[data-carta-ann],[data-stagepren],[data-ordina],[data-gard-oggi],[data-gard-date],[data-gard-pers],[data-gard-altri],[data-gard-pren],[data-gard-ann],[data-gard-menu],[data-sheet],[data-go],[data-close],[data-confirm],[data-chip],[data-do-book],[data-proposta],[data-lang],[data-conv],[data-ev],[data-dom],[data-login],[data-logout],[data-otp-req],[data-otp-verify],[data-push],[data-map],[data-cap],[data-capm],[data-capsend],[data-convrisp],[data-open-contest],[data-serata],[data-do-serata]');
  if (!t) return;
  if (t.dataset.doSerata != null) return prenotaSerata(t.dataset.doSerata);
  if (t.dataset.serata != null) {
    // Ovunque si arrivi, per un minorenne la serata si guarda ma non si prenota.
    if (minorenne()) { okThen(T('Le serate con quota le prenota un adulto per te.'), false); return; }
    return openSerata(t.dataset.serata);
  }
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
  if (t.dataset.casatamembri) return openCasataMembri(t.dataset.casatamembri);
  // Dalla serata di stasera si prenota per stasera: offrire altri giorni disperde chi era
  // entrato con l'intenzione di partecipare a QUELLA serata. Gli altri giorni stanno in Eventi.
  if (t.dataset.chat != null) return openChat(t.dataset.chat || 'casata');
  if (t.dataset.chatSegnala) return chatSegnala(t.dataset.chatSegnala);
  if (t.dataset.vai) return go(t.dataset.vai);
  if (t.dataset.cenaSubito) return openCenaSubito();
  if (t.dataset.partite != null) return openPartiteAperte();
  if (t.dataset.aiuto) return openAiuto();
  if (t.dataset.modo) return cambiaModo(t.dataset.modo === '1');
  if (t.dataset.mappa) return openMappa(t.dataset.mappa);
  if (t.dataset.serateTutte != null) return openSerateSpeciali();
  if (t.dataset.fitness != null) return openFitness();
  if (t.dataset.rassegna) return openRassegna();
  if (t.dataset.rassegnastampa) return stampaRassegna();
  if (t.dataset.fitapri) return openLezione(Number(t.dataset.fitapri));
  if (t.dataset.fitsett) { state._fitSett = t.dataset.fitsett; return openFitness(); }
  if (t.dataset.fitpren) return fitnessIscrivi(t.dataset.fitpren);
  if (t.dataset.fitdisd) return fitnessDisdici(t.dataset.fitdisd);
  if (t.dataset.cowo != null) return openCowo();
  if (t.dataset.cowoDate) { state._cowoData = t.dataset.cowoDate; return openCowo(); }
  if (t.dataset.cowoPers) { state._cowoPers = Number(t.dataset.cowoPers); return openCowo(); }
  if (t.dataset.cowoPren) return cowoPrenota(t.dataset.cowoPren);
  if (t.dataset.cowoAnn) return api('/carta/prenotazioni/' + t.dataset.cowoAnn + '/annulla', { method: 'POST', body: JSON.stringify({ tessera_code: state.tessera }) }).then(openCowo).catch(() => openCowo());
  if (t.dataset.carta != null) return openCarta();
  if (t.dataset.cartaDate) { state._cartaData = t.dataset.cartaDate; return openCarta(); }
  if (t.dataset.cartaPers) { state._cartaPers = Number(t.dataset.cartaPers); return openCarta(); }
  if (t.dataset.cartaPren) return cartaPrenota(t.dataset.cartaPren);
  if (t.dataset.cartaAnn) return api('/carta/prenotazioni/' + t.dataset.cartaAnn + '/annulla', { method: 'POST', body: JSON.stringify({ tessera_code: state.tessera }) }).then(openCarta).catch(() => openCarta());
  if (t.dataset.stage != null) return openStage();
  if (t.dataset.stagepren) return stagePrenota(t.dataset.stagepren);
  if ((t.dataset.gardOggi || t.dataset.ordina || t.dataset.fitness != null || t.dataset.cenaSubito) && minorenne()) { okThen(T('Fino ai 18 anni le prenotazioni a pagamento le fa un adulto per te.'), false); return; }
  if (t.dataset.gardOggi) { state._gardData = new Date().toISOString().slice(0, 10); return openGarden({ soloOggi: true }); }
  if (t.dataset.gardDate) { state._gardData = t.dataset.gardDate; return openGarden(); }
  if (t.dataset.gardPers) { state._gardPers = Number(t.dataset.gardPers); return openGarden({ soloOggi: !!state._gardSoloOggi }); }
  if (t.dataset.gardAltri) {
    const n = Number(prompt(T('Quante persone siete?'), String(state._gardPers || 14)) || 0);
    if (n > 0) state._gardPers = n;
    return openGarden({ soloOggi: !!state._gardSoloOggi });
  }
  if (t.dataset.gardPren) return gardenPrenota(t.dataset.gardPren);
  if (t.dataset.gardAnn) return gardenAnnulla(t.dataset.gardAnn);
  if (t.dataset.gardMenu != null) return openQrTavolo();
  if (t.dataset.ordina != null) return openOrdina(t.dataset.ordina);
  if (t.dataset.struttSave != null) return strutturaSalva(t.dataset.struttSave);
  if (t.dataset.campi != null) return openCampi();
  if (t.dataset.partite != null) return openPartiteAperte();
  if (t.dataset.campoPick) return openCampi(Number(t.dataset.campoPick));
  if (t.dataset.campoDate) { state._campoData = t.dataset.campoDate; return openCampi(state._campoSel); }
  if (t.dataset.campoFasce) { state._campoFasce = Number(t.dataset.campoFasce) || 1; return openCampi(state._campoSel); }
  if (t.dataset.prenota) return campoPrenota(t.dataset.prenota);
  if (t.dataset.apri) return campoApri(t.dataset.apri);
  if (t.dataset.unisci) return campoUnisci(t.dataset.unisci);
  if (t.dataset.chigioca) return openChiGioca(t.dataset.chigioca);
  if (t.dataset.spese != null) return openSpese();
  if (t.dataset.notifvia) return notificaVia(t.dataset.notifvia);
  if (t.dataset.host) return cambiaHost(t.dataset.host === '1');
  if (t.dataset.disdici) return campoDisdici(t.dataset.disdici);
  if (t.dataset.giocadd) return giocatoreAggiungi(t.dataset.giocadd);
  if (t.dataset.giocvia) return giocatoreTogli(t.dataset.giocvia);
  if (t.dataset.book != null) return openBooking(t.dataset.book);
  if (t.dataset.sheet) return t.dataset.sheet === 'regolamenti' ? openRegolamenti() : openSheet(t.dataset.sheet);
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.close != null) return closeOv();
  if (t.dataset.confirm != null) return okThen(T('Prenotazione registrata') + ' · ' + t.dataset.confirm);
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
    // Arrivo da /t/BR-…: e' la card appoggiata o inquadrata. Si precompila e si spiega, invece
    // di far ritrovare il socio davanti a un campo vuoto dopo aver appoggiato la tessera.
    const daCard = leggiTessera(new URLSearchParams(location.search).get('t') || '');
    if (daCard && $('#gate_tess')) {
      $('#gate_tess').value = daCard;
      history.replaceState(null, '', location.pathname);
    } else if ($('#gate_tess') && state.tessera) $('#gate_tess').value = state.tessera; // pre-compila l'ultima tessera usata
    showGate();
  }
  // Il service worker è registrato dai tag PWA iniettati dal server (server/pwa.js).
}
function bindGate() {
  const enter = $('#gate_enter'); if (enter) enter.addEventListener('click', loginTessera);
  const tess = $('#gate_tess'); if (tess) tess.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginTessera(); });
  const email = $('#gate_email'); if (email) email.addEventListener('click', () => { hideGate(); openLoginOtp(); });
  const reg = $('#gate_register'); if (reg) reg.addEventListener('click', () => { hideGate(); startRegistrazione(); });
  const demo = $('#gate_demo'); if (demo) demo.addEventListener('click', demoPreview);
}
init();


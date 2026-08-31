/* Bussola Chiosco — app operativa separata: comande + KDS + magazzino + menù.
   Stesso server/API del back office, ma ambiente e login dedicati agli operatori. */
'use strict';
let TOKEN = null, ME = { gestore: false, caps: [] }, PAR = {};
// Zona della postazione (dichiarata al login): 'garden' = comande a tavolo · 'bar' = comande a nome.
let ZONA = (typeof localStorage !== 'undefined' && localStorage.getItem('bussola_zona')) || 'garden';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => '€ ' + Number(n || 0).toFixed(2);
// L'indirizzo del server si puo' impostare da fuori: si accetta il nome nuovo e si continua
// ad accettare quello vecchio, perche' potrebbe essere gia' scritto in una pagina che non
// controlliamo. Rinominare a secco avrebbe rotto quelle installazioni senza avvisare nessuno.
const API_BASE = (typeof window !== 'undefined' && (window.BUSSOLA_API || window.KOINE_API)) ? String(window.BUSSOLA_API || window.KOINE_API).replace(/\/$/, '') : '';

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
    // Regole di funzionamento decise dal gestore: qui servono per mostrare o meno certi comandi.
    try { PAR = Object.fromEntries((await api('/parametri')).map(p => [p.chiave, p.valore])); } catch (_) { PAR = {}; }
    // Accesso a Bussola Crew: basta UN permesso operativo (comande o magazzino); si vedono solo le zone consentite.
    const zone = allowedZones();
    if (!zone.length) throw new Error('Il tuo utente non ha ancora nessun permesso operativo. Chiedi al gestore di abilitarti ad almeno uno di questi moduli: ' + Object.values(CAP_MODULO).join(' · ') + '.');
    filterZoneSelectors(zone);
    $('#login').style.display = 'none'; $('#app').style.display = 'block';
    $('#whoName').textContent = j.user.username;
    const zs = $('#zonaSwitch'); if (zs && !zs.__wired) { zs.__wired = true; zs.onchange = () => setZona(zs.value); }
    // Modulo iniziale: l'ultimo usato su questo dispositivo (se ancora consentito) → altrimenti il primo consentito.
    const salvata = (() => { try { return localStorage.getItem('bussola_zona'); } catch (_) { return null; } })();
    setZona(zone.includes(salvata) ? salvata : zone[0]);
  } catch (e) { $('#loginErr').textContent = e.message; }
}
function logout() { TOKEN = null; ME = { gestore: false, caps: [] }; $('#app').style.display = 'none'; $('#login').style.display = 'flex'; }
// Zone consentite in base ai permessi: comande → garden/bar/cucina · magazzino → magazzino.
function allowedZones() {
  const caps = ME.caps || [];
  const z = [];
  if (ME.gestore || caps.includes('comande')) z.push('garden', 'bar', 'cucina');
  if (ME.gestore || caps.includes('magazzino')) z.push('magazzino');
  if (ME.gestore || caps.includes('tabellone')) z.push('sport');   // risultati live
  if (ME.gestore || caps.includes('campi')) z.push('campi');       // prenotazioni campi al banco
  // Il modulo tennis vive col SUO permesso: chi affitta i campi a pagamento non ha bisogno di
  // avere anche quelli gratuiti del chiosco. Senza questa riga il modulo esisteva ma non
  // compariva a nessuno, e per vederlo bisognava dare anche "campi" — che e' un'altra cosa.
  // Il delegato al banco ha "tennis_campi" e non "tennis": senza questa riga entrava e non
  // vedeva nessun modulo, con il messaggio "non hai ancora nessun permesso operativo" — cioe'
  // il permesso c'era ma non apriva niente.
  if (ME.gestore || caps.includes('tennis') || caps.includes('tennis_campi')) z.push('tennis');
  if (ME.gestore || caps.includes('beach')) z.push('beach');                       // piazzole e ombrelloni
  if (ME.gestore || caps.includes('serate')) z.push('serate');     // serate & cena: incassi e presenze
  if (ME.gestore || caps.includes('cdc')) z.push('cdc');           // Casa di Carta
  if (ME.gestore || caps.includes('fitness')) z.push('fitness');   // lezioni con istruttore
  if (ME.gestore || caps.includes('cinema')) z.push('cinema');     // platea e ingressi
  return z;
}
// Ogni permesso operativo ha il suo modulo: serve a spiegare a chi resta fuori cosa gli manca.
const CAP_MODULO = { comande: 'Comande (Garden/Bar/Cucina)', magazzino: 'Magazzino', tabellone: 'Sport', campi: 'Campi', tennis: 'Tennis & Beach', beach: 'Spiaggia', serate: 'Serate & cena', cdc: 'Casa di Carta', fitness: 'Area fitness', cinema: 'Stage (cinema e spettacoli)' };
// Selettore modulo nel topbar: mostra solo le opzioni consentite e SPARISCE se c'è un solo modulo.
function filterZoneSelectors(zone) {
  const el = document.querySelector('#zonaSwitch');
  if (!el) return;
  Array.from(el.options).forEach(o => { const ok = zone.includes(o.value); o.hidden = !ok; o.disabled = !ok; });
  if (!zone.includes(el.value)) el.value = zone[0];
  const wrap = el.closest('label') || el;   // se un solo modulo, il selettore non serve → nascondilo
  wrap.style.display = zone.length > 1 ? '' : 'none';
}
// Cambio zona AL VOLO (stessa persona): resta nelle zone consentite dai permessi.
function setZona(z) {
  const allow = allowedZones();
  ZONA = allow.includes(z) ? z : (allow[0] || 'garden');
  try { localStorage.setItem('bussola_zona', ZONA); } catch (_) {}
  applyZona();
  const PRIMA = { garden: 'pianta', cucina: 'kds', magazzino: 'magazzino', sport: 'sport', campi: 'campi', tennis: 'tennis', beach: 'beach', serate: 'serate', cdc: 'cdc', fitness: 'fitness', cinema: 'cinema' };
  show(PRIMA[ZONA] || 'comande');
}
// Mostra solo i tab pertinenti alla zona corrente:
//  Garden → Comande+Tavoli+Giacenze · Bar → Comande+Bar+Giacenze · Cucina → Cucina · Magazzino → hub Centrale/Bar/Garden.
function applyZona() {
  const tog = (v, show) => { const el = document.querySelector('#tabs [data-v="' + v + '"]'); if (el) el.classList.toggle('hide', !show); };
  const hasMag = ME.gestore || (ME.caps || []).includes('magazzino');
  // Al Garden la comanda si prende dal tavolo, nella Pianta: una tab che rimanda a un'altra
  // tab non serve a niente. Il pannello degli ordini dal QR e' salito sulla Pianta, dove sta
  // chi lavora. Al Bar la tab resta: li' la comanda si batte a nome, non a tavolo.
  tog('comande', ZONA === 'bar');
  tog('tavoli', false);        // fusa nella Pianta: stesso tavolo, un posto solo dove guardarlo
  tog('pianta', ['garden', 'cdc', 'cinema'].includes(ZONA));
  tog('bar', ZONA === 'bar');
  tog('kds', ZONA === 'cucina');
  tog('scorte', false);        // il magazzino si legge nel suo modulo, non da ogni zona
  tog('magazzino', hasMag && ZONA === 'magazzino');                // hub logistica (Centrale/Bar/Garden)
  tog('sport', ZONA === 'sport');                                  // modulo Sport (risultati live)
  tog('campi', ZONA === 'campi');
  tog('tennis', ZONA === 'tennis');
  tog('beach', ZONA === 'beach');
  tog('tornei', ZONA === 'tennis' || ZONA === 'campi');            // tabelloni a eliminazione diretta                                // campi a pagamento: listino e incassi
  tog('serate', ZONA === 'serate');
  tog('cdc', ZONA === 'cdc');
  tog('fitness', ZONA === 'fitness');
  tog('cinema', ZONA === 'cinema');
  tog('scortecdc', false);     // idem per la Casa di Carta
  tog('menu', ZONA === 'garden' || ZONA === 'bar');                // il menù serve solo dove si prende la comanda
  tog('riepilogo', ZONA === 'garden' || ZONA === 'bar');           // riepilogo comande: solo Garden/Bar
  tog('registro', ZONA === 'garden' || ZONA === 'bar');            // memoria lunga: dove si prenota e si incassa
  const z = document.querySelector('#login #zona'); if (z) z.value = ZONA;
  const zs = document.querySelector('#zonaSwitch'); if (zs) zs.value = ZONA;
  applyAccent();
}
// Accento-colore per FUNZIONE: identità unica, ma la topbar e i titoli si tingono in base alla zona,
// così l'operatore sa sempre "dove si trova". Garden=verde · Bar=oro · Cucina=corallo · Magazzino=navy.
const ZONA_ACCENT = {
  garden:    { a: '#256b65', g1: '#1d5a54', g2: '#2f8a80', nome: 'Garden' },
  bar:       { a: '#8a5a12', g1: '#6e4a12', g2: '#a9791f', nome: 'Bar' },
  cucina:    { a: '#b14a35', g1: '#8f3826', g2: '#c8624b', nome: 'Cucina' },
  magazzino: { a: '#12324f', g1: '#12324F', g2: '#1c4a6e', nome: 'Magazzino' },
  sport:     { a: '#5b3f8a', g1: '#463170', g2: '#6b4ea0', nome: 'Sport' },
  campi:     { a: '#2e6b45', g1: '#245437', g2: '#3d8a5a', nome: 'Campi' },
  serate:    { a: '#a0356b', g1: '#7d2853', g2: '#b8497f', nome: 'Serate' },
  cdc:       { a: '#7a5c2e', g1: '#5f4723', g2: '#96733d', nome: 'Casa di Carta' },
  fitness:   { a: '#2f7d8a', g1: '#245e68', g2: '#3f9daa', nome: 'Fitness' },
  cinema:    { a: '#4a3f6b', g1: '#372f52', g2: '#5f5188', nome: 'Stage' },
};
function applyAccent() {
  const z = ZONA_ACCENT[ZONA] || ZONA_ACCENT.magazzino;
  document.documentElement.style.setProperty('--accent', z.a);
  const top = document.querySelector('#top');
  if (top) top.style.background = `linear-gradient(135deg, ${z.g1}, ${z.g2})`;
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
// Le sezioni si comprimono anche qui: su un telefono una pagina lunga si scorre male.
function abilitaFold() {
  const chiave = 'crew_fold_' + (ZONA || '') + '_' + (window.__tab || '');
  let chiusi = [];
  try { chiusi = JSON.parse(localStorage.getItem(chiave) || '[]'); } catch (e) { }
  const pannelli = [];
  // Il titolo non e' sempre il primo figlio: dove c'e' un tasto accanto (Salva, Diagnosi) sta
  // dentro una riga. Cercandolo solo come "primo figlio" quei pannelli smettevano di
  // comprimersi, e la freccia spariva senza che nessuno capisse perche'.
  document.querySelectorAll('#view .panel').forEach((box) => {
    const h = box.querySelector(':scope > h3, :scope > b, :scope > .row > h3, :scope > div > h3');
    if (!h) return;
    // Si marca il contenitore di primo livello del titolo: e' quello che resta visibile.
    let testa = h;
    while (testa.parentElement !== box) testa = testa.parentElement;
    testa.classList.add('fold-testa');
    const nome = (h.textContent || '').trim().slice(0, 30).replace(/\s+/g, '_');
    box.dataset.fold = nome;
    pannelli.push(box);
    if (chiusi.includes(nome)) box.classList.add('chiuso');
    h.style.cursor = 'pointer';
    h.onclick = () => { box.classList.toggle('chiuso'); salva(); };
  });
  const salva = () => {
    const ora = pannelli.filter((x) => x.classList.contains('chiuso')).map((x) => x.dataset.fold);
    try { localStorage.setItem(chiave, JSON.stringify(ora)); } catch (e) { }
  };
  // "Comprimi tutto" c'era solo nel back office: in sala, dove si lavora su un telefono, serve
  // di piu'.
  if (pannelli.length > 1 && !document.querySelector('.foldbar')) {
    const bar = document.createElement('div');
    bar.className = 'foldbar';
    bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin:0 0 8px';
    bar.innerHTML = '<button class="btn ghost sm" id="fold_tutti">Comprimi tutto</button><button class="btn ghost sm" id="fold_apri">Espandi tutto</button>';
    $('#view').prepend(bar);
    $('#fold_tutti').onclick = () => { pannelli.forEach((x) => x.classList.add('chiuso')); salva(); };
    $('#fold_apri').onclick = () => { pannelli.forEach((x) => x.classList.remove('chiuso')); salva(); };
  }
}
async function show(v) {
  if (window.__kdsTimer) { clearInterval(window.__kdsTimer); window.__kdsTimer = null; }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#view').innerHTML = '<p class="muted">Carico…</p>';
  window.__tab = v;
  try { await VIEWS[v](); } catch (e) { $('#view').innerHTML = `<p class="muted">Errore: ${esc(e.message)}</p>`; }
  try { abilitaFold(); } catch (e) { }
}

const COM_STATI = { aperta: ['Aperta', 'mid'], in_preparazione: ['In preparazione', 'mid'], pronta: ['Pronta', 'ok'], consegnata: ['Consegnata', 'ok'], chiusa: ['Chiusa', ''], annullata: ['Annullata', 'no'] };
// Badge canale: distingue a colpo d'occhio le comande "self" (cliente) da quelle dello staff.
const canaleBadge = (c) => c.canale === 'self'
  ? `<span class="tag mid" style="background:#e7f0f6;color:#12324F">🙋 Self${c.punto ? ' · ' + esc(c.punto) : ''}</span>`
  : `<span class="tag" style="background:#eef7ee;color:#2e6b3f">👤 Staff</span>`;
const METODI = [['contanti', '💶 Contanti'], ['carta', '💳 Carta'], ['satispay', '📱 Satispay'], ['buoni', '🎟️ Buoni'], ['altro', '… Altro'], ['tessera', '\ud83e\udeaa Tessera']];
const metodoLabel = (m) => (METODI.find(x => x[0] === m) || [m, m || '—'])[1];
// Chooser del metodo di pagamento alla chiusura (overlay touch-friendly).
function pickMetodo(onPick) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px';
  // La copia di cortesia per posta: serve a chi NON ha ordinato col QR e quindi non ha niente
  // sul telefono — gli anziani, chi usa la versione leggera, chi si e' fatto servire e basta.
  // Se il cliente ha la tessera l'indirizzo lo sa gia' il sistema; altrimenti si scrive qui,
  // e se non lo si scrive non succede niente: e' un di piu', non un passaggio obbligato.
  ov.innerHTML = `<div style="background:#fff;border-radius:16px;padding:20px;max-width:360px;width:100%">
    <b style="color:var(--navy);font-size:1.05rem">Come ha pagato?</b>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      ${METODI.map(m => `<button class="btn ${m[0] === 'contanti' ? 'gold' : 'ghost'}" data-m="${m[0]}" style="padding:14px 10px">${m[1]}</button>`).join('')}
    </div>
    <label class="muted" style="display:block;font-size:.8rem;margin-top:12px">Copia del conto per e-mail <span style="opacity:.7">(facoltativa)</span>
      <input id="pm_mail" type="email" placeholder="indirizzo del cliente" style="width:100%;margin-top:4px"></label>
    <p class="muted" style="font-size:.72rem;margin:6px 0 0">È una copia di cortesia: <b>lo scontrino fiscale va consegnato lo stesso</b>.</p>
    <button class="btn ghost" data-m="" style="width:100%;margin-top:10px">Annulla</button></div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const m = b.dataset.m;
    const mail = (ov.querySelector('#pm_mail') || {}).value || '';
    // Con la tessera serve sapere QUALE: si scala il saldo di qualcuno, non si incassa e basta.
    let tess = '', pin = '';
    if (m === 'tessera') {
      // Il campo accetta il numero digitato, il QR inquadrato o l'indirizzo che arriva dal tag
      // NFC: sono lo stesso identificatore su tre supporti diversi.
      const grezzo = prompt('Tessera di chi paga: digita il numero, inquadra il QR o appoggia la card') || '';
      const m = grezzo.trim().toUpperCase().match(/BR-\d{4}-\d{3,6}/);
      tess = m ? m[0] : grezzo.trim();
      if (!tess) return;
      // Il PIN lo digita il socio, non l'operatore: e' l'unica cosa che sta solo in testa a lui.
      pin = (prompt('Fai digitare il PIN al socio (4-6 cifre)') || '').trim();
    }
    document.body.removeChild(ov);
    if (m) onPick(m, mail.trim(), tess, pin);
  });
}

/* ---------- COMANDE (cassa): l'operatore vede il menù ESATTAMENTE come il cliente ---------- */
/* ---------- Ordini dal QR: il pannello sta dove si lavora, cioe' sulla Pianta ----------
   Stava in una tab a se' che, al Garden, non conteneva altro che un rimando alla Pianta.
   Chi sospende gli ordini dal telefono lo fa guardando i tavoli, non un'altra schermata. */
async function statoSelfOrder() {
  return api('/self-order/stato').catch(() => ({ aperto: true, eta_min: 0, config: {} }));
}
function pannelloSelfOrder(so) {
  const cfg = so.config || {};
    const etaTxt = so.eta_min > 0 ? `attesa stimata ~${so.eta_min} min` : 'coda libera';
    const bordo = !so.aperto ? 'var(--coral,#C0553F)' : (so.pressione ? 'var(--gold,#8a5a12)' : 'var(--ok,#2e6b45)');
    const statoRiga = !so.aperto
      ? '🔴 <b>sospesi</b> (manuale) — i clienti col QR non possono ordinare'
      : (so.sospeso_pressione ? '🟠 <b>sospesi in automatico</b> — cucina sotto pressione' : (so.pressione ? '🟠 <b>aperti</b> · ⚠️ cucina sotto pressione' : '🟢 <b>aperti</b> · cucina regolare'));
    const pressSpieg = cfg.press_modo === 'tempo' ? `oltre ${cfg.press_max_minuti} min di attesa stimata` : `oltre ${cfg.press_max_comande} comande da smaltire`;
  return `
    <div class="panel" style="border-left:5px solid ${bordo}">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div><b style="color:var(--navy)">📱 Ordini dal telefono (self-order): ${statoRiga}</b>
          <div class="muted" style="font-size:.82rem">${etaTxt} · ${so.attive || 0} comande in coda · pressione: ${pressSpieg}${cfg.press_auto ? ' → sospensione automatica' : ' → solo avviso'}.</div></div>
        <div class="row">
          <button class="btn ghost sm" id="so_cfg">⚙️ Regole</button>
          <button class="btn ${so.aperto ? 'danger' : 'gold'} sm" id="so_toggle">${so.aperto ? '⏸️ Sospendi' : '▶️ Riapri'}</button>
        </div>
      </div>
      <div id="so_cfgbox" class="hide" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:230px">
            <b style="color:var(--navy);font-size:.9rem">🔥 Pressione cucina</b>
            <label style="display:block;font-size:.8rem;margin-top:6px">Come si misura
              <select id="cf_pmodo"><option value="statico" ${cfg.press_modo !== 'tempo' ? 'selected' : ''}>a numero di comande</option><option value="tempo" ${cfg.press_modo === 'tempo' ? 'selected' : ''}>a tempo reale (attesa)</option></select></label>
            <label style="display:block;font-size:.8rem;margin-top:6px">Soglia comande in coda <input id="cf_pcom" type="number" min="1" value="${cfg.press_max_comande || 6}" style="width:70px"></label>
            <label style="display:block;font-size:.8rem;margin-top:6px">Attesa massima (min) <input id="cf_pmin" type="number" min="1" value="${cfg.press_max_minuti || 10}" style="width:70px"></label>
            <label style="display:block;font-size:.8rem;margin-top:6px"><input type="checkbox" id="cf_pauto" ${cfg.press_auto ? 'checked' : ''}> Sospendi automaticamente sotto pressione (altrimenti solo avviso)</label>
          </div>
          <div style="min-width:230px">
            <b style="color:var(--navy);font-size:.9rem">⏱️ Tempo stimato d'attesa</b>
            <label style="display:block;font-size:.8rem;margin-top:6px">Come si calcola
              <select id="cf_emodo"><option value="statico" ${cfg.eta_modo !== 'tempo' ? 'selected' : ''}>stima fissa (${cfg.eta_base || 3} min + ${cfg.eta_per_item || 2}/articolo)</option><option value="tempo" ${cfg.eta_modo === 'tempo' ? 'selected' : ''}>misura tempo reale (ritmo di smaltimento)</option></select></label>
          </div>
          <div style="min-width:230px">
            <b style="color:var(--navy);font-size:.9rem">🗺️ Mappa tavoli (Garden)</b>
            <p class="muted" style="font-size:.74rem;margin-top:6px">I tavoli del Garden non si contano piu' qui: si disegnano nella <b>Pianta</b>, dove si aggiungono, si spostano e si accorpano.</p>
            <label style="display:block;font-size:.8rem;margin-top:6px">Rosso dopo (min) <input id="cf_mrosso" type="number" min="1" value="${cfg.map_rosso_min || 10}" style="width:70px"></label>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn gold sm" id="cf_save">Salva regole</button></div>
      </div>
    </div>`;
}
function collegaSelfOrder(so, tornaA) {
  if ($('#so_toggle')) $('#so_toggle').onclick = async () => { await api('/self-order/pausa', { method: 'POST', body: JSON.stringify({ aperto: !so.aperto }) }); show(tornaA); };
  if ($('#so_cfg')) $('#so_cfg').onclick = () => $('#so_cfgbox').classList.toggle('hide');
  if ($('#cf_save')) $('#cf_save').onclick = async () => {
    await api('/self-order/config', { method: 'POST', body: JSON.stringify({
      press_modo: $('#cf_pmodo').value, press_max_comande: Number($('#cf_pcom').value || 6), press_max_minuti: Number($('#cf_pmin').value || 10),
      press_auto: $('#cf_pauto').checked, eta_modo: $('#cf_emodo').value, map_rosso_min: Number($('#cf_mrosso').value || 10),
    }) });
    show(tornaA);
  };
}

VIEWS.comande = async () => {
  // Lo stesso elenco che vede il socio: condimenti fuori dalle categorie e spuntabili dentro
  // il piatto. Se qui si usasse il listino grezzo, al tavolo ricomparirebbero come voci a se'.
  // Con la zona della postazione: al Bar si vede il Bar (piu' la cucina, che serve tutti i
  // punti), al Garden il Garden. Senza, l'operatore vedeva un elenco diverso dal socio.
  const menu = await api('/menu?ordinabile=1&zona=' + (ZONA === 'bar' ? 'bar' : 'garden'));
  const garden = ZONA === 'garden';
  const entry = garden
    ? `<label>Tavolo <input id="co_tav" type="number" min="1" inputmode="numeric" placeholder="n°" style="width:100px"></label>`
    : `<label style="flex:1;min-width:260px">Nome cliente
        <span style="display:flex;gap:6px;align-items:center">
          <input id="co_nome" placeholder="Cognome, oppure inquadra la tessera" style="flex:1;min-width:200px">
          <button class="btn ghost sm" id="co_scan" title="Inquadra il QR della tessera" style="padding:6px 10px;font-size:1.1rem">📷</button>
        </span></label>`;

  if (garden) {
    // Al Garden la tab Comande non c'e' piu': la comanda si prende dal tavolo, nella Pianta,
    // e il pannello degli ordini dal QR e' salito li' sopra. Se qualcuno ci arriva lo stesso
    // (link vecchio, tasto indietro), lo si porta dove si lavora invece di mostrargli una
    // pagina che rimanda a un'altra pagina.
    show('pianta');
    return;
  }
  $('#view').innerHTML = `
    <div class="panel"><h3>🧾 Nuova comanda · ${garden ? '🌿 Garden (a tavolo)' : '🍸 Bar (a nome)'}</h3>
      <div class="row" style="margin-bottom:8px">${entry}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <div style="flex:2;min-width:280px">
          ${menu.length ? '<div id="co_menu"></div>' : '<p class="muted">Menù vuoto. Vai su “Menù” per caricarlo.</p>'}
        </div>
        <div style="flex:1;min-width:230px" class="panel">
          <b style="color:var(--navy)">Comanda</b><div id="co_cart" style="margin-top:6px"></div>
          <div id="co_tot" style="text-align:right;font-weight:800;margin-top:8px"></div>
          <button class="btn gold" id="co_send" style="width:100%;margin-top:8px">${garden ? '🌿 Invia (tavolo)' : '🍸 Invia (bar)'}</button>
          <p class="muted" style="font-size:.74rem;margin-top:8px">Lo stato delle comande è nella tab ${garden ? '🗺️ <b>Tavoli</b>' : '🍸 <b>Bar</b>'}; i piatti li lavora la postazione 🍳 <b>Cucina</b>.</p>
        </div>
      </div></div>`;

  const renderCart = (cart) => {
    const ids = Object.keys(cart || {});
    $('#co_cart').innerHTML = ids.length
      ? ids.map(id => { const m = menu.find(x => String(x.id) === id); return `<div style="display:flex;gap:6px;padding:3px 0;font-size:.85rem"><span style="flex:1">${cart[id]}× ${esc(m.nome)}</span><span style="width:60px;text-align:right">${eur(m.prezzo * cart[id])}</span></div>`; }).join('')
      : '<span class="muted" style="font-size:.85rem">Tocca un prodotto del menù.</span>';
  };
  let CO = null;
  if (menu.length) {
    CO = Comanda.create({ mount: $('#co_menu'), menu, search: true, onChange: (cart, tot) => { $('#co_tot').textContent = 'Totale ' + eur(tot); renderCart(cart); } });
    CO.focusSearch();
  } else { renderCart({}); }
  // Scansione della tessera: si evita di digitare il cognome e si prende quello vero.
  if ($('#co_scan')) $('#co_scan').onclick = () => scansionaTessera(async (codice) => {
    const el = $('#co_nome');
    if (!el) return;
    el.value = codice;
    try {
      const s2 = await api('/soci/tessera/' + encodeURIComponent(codice)).catch(() => null);
      if (s2 && s2.nome) el.value = (s2.nome + ' ' + (s2.cognome || '')).trim();
    } catch (_) { }
  });
  $('#co_send').onclick = async () => {
    const righe = CO ? CO.getRighe() : [];
    if (!righe.length) { alert('Aggiungi almeno un prodotto.'); return; }
    let riferimento, zona, origine;
    if (garden) { riferimento = ($('#co_tav').value || '').trim(); if (!riferimento) { alert('Indica il numero del tavolo.'); return; } zona = 'garden'; origine = 'tavolo'; }
    else { riferimento = ($('#co_nome').value || '').trim(); if (!riferimento) { alert('Indica il nome del cliente.'); return; } zona = 'bar'; origine = 'bar'; }
    const r = await api('/comande', { method: 'POST', body: JSON.stringify({ origine, zona, riferimento, righe }) });
    if (r && r.avviso) alert('🔥 ' + r.avviso);
    show('comande');   // pronto per la comanda successiva; la fotografia è nella tab Tavoli/Bar
  };
  if (garden) {
    $('#so_toggle').onclick = async () => { await api('/self-order/pausa', { method: 'POST', body: JSON.stringify({ aperto: !so.aperto }) }); show('comande'); };
    $('#so_cfg').onclick = () => $('#so_cfgbox').classList.toggle('hide');
    $('#cf_save').onclick = async () => {
      await api('/self-order/config', { method: 'POST', body: JSON.stringify({
        press_modo: $('#cf_pmodo').value, press_max_comande: Number($('#cf_pcom').value || 6), press_max_minuti: Number($('#cf_pmin').value || 10),
        press_auto: $('#cf_pauto').checked, eta_modo: $('#cf_emodo').value,
        map_rosso_min: Number($('#cf_mrosso').value || 10),
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
// Ciclo colore (specifica utente): giallo appena acquisita · rosso oltre soglia · verde consegnata · arancio = libero/base.
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
const chipOf = (st) => st.mins != null ? `<span class="tchip" style="background:${ZCOL[st.key].bd}">${st.mins}′</span>` : (st.key === 'verde' ? '<span class="tchip" style="background:#3f8f4e">✔</span>' : '');
// Card TAVOLO (mappa Garden): riferimento compatto (chip numero), accento verde, clic per dettaglio.
function tavoloCard(tb) {
  const c = ZCOL[tb.st.key];
  const items = tb.cs.flatMap(x => x.righe || []).map(r => `${r.qta}× ${esc(r.nome)}`);
  const libero = tb.st.key === 'arancio' && !tb.cs.length;
  const pay = tb.st.key === 'verde' ? `<button class="btn gold sm" data-tpay="${tb.st.delivered.map(x => x.id).join(',')}" style="margin-top:8px;width:100%">💶 Incassa</button>` : '';
  return `<div class="tcard clic${libero ? ' libero' : ''}" data-tdetail="${tb.t}" style="border-color:${c.bd};background:${c.bg}">
    <div class="zacc" style="background:${ACC_GARDEN}"></div>
    <div class="thd" style="margin-top:2px"><span class="row" style="gap:8px"><span class="tref" style="background:${c.bd}">${tb.t}</span><span class="tsub" style="color:${c.tx}">Tavolo${(tb.uniti && tb.uniti.length) ? ' + ' + tb.uniti.join(' + ') : ''}${tb.posti ? ' · ' + tb.posti + ' p' : ''}</span></span>${chipOf(tb.st)}</div>
    <div class="tst" style="color:${c.tx}">${c.lb}${tb.st.since ? ' · ' + hhmmOf(tb.st.since) : ''}</div>
    ${items.length ? `<div style="margin-top:8px;font-size:.82rem;color:#2a2a2a;line-height:1.45">${items.slice(0, 5).join('<br>')}${items.length > 5 ? `<br><span class="muted">+${items.length - 5} …</span>` : ''}</div>` : (libero ? '<div class="muted" style="margin-top:8px;font-size:.78rem">— libero —</div>' : '')}
    ${pay}</div>`;
}
// Card CUCINA (per tavolo/nome): riferimento differenziato Bar (nome, oro) / Garden (n° tavolo, verde), clic per dettaglio.
function cucinaCard(g) {
  const c = ZCOL[g.st.key];
  const isBar = g.zona === 'bar';
  const acc = isBar ? ACC_BAR : ACC_GARDEN;
  const ref = isBar
    ? `<span class="row" style="gap:6px"><span class="tsub" style="color:${c.tx};font-size:1.02rem">🍸 ${esc(g.rif)}</span></span>`
    : `<span class="row" style="gap:8px"><span class="tref" style="background:${c.bd}">${esc(g.rif)}</span><span class="tsub" style="color:${c.tx}">Tavolo</span></span>`;
  // Un piatto, una riga. I condimenti si leggono DENTRO il piatto — è lì che vanno — e non
  // hanno un tasto loro: nessuno manda "in tavola" una maionese per conto suo. Prima erano
  // quattro voci separate con quattro tasti, e in mezzo il supplemento, che è una riga di
  // denaro e in cucina non c'entra niente.
  const tutte = g.comande.flatMap(cm => (cm.righe || []).map(r => ({ cm, r })));
  const figlieDi = (id) => tutte.filter(x => Number(x.r.parent_riga_id) === Number(id)).map(x => x.r);
  const righe = tutte.filter(({ r }) => !r.parent_riga_id).map(({ cm, r }) => {
    const dentro = figlieDi(r.id);
    return `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.06)">
      <span style="flex:1"><b>${r.qta}×</b> ${esc(r.nome)}${dentro.length ? `<div style="font-size:.78rem;color:#5a5346;margin-top:2px">${dentro.map(f => '\u21b3 ' + esc(f.nome)).join('<br>')}</div>` : ''}${r.note ? `<div class="muted" style="font-size:.75rem">${esc(r.note)}</div>` : ''}</span>
      ${r.stato === 'in_coda' ? `<button class="btn gold sm" data-kr="${cm.id}|${r.id}|pronta">Pronta \u2714</button>` : `<button class="btn ghost sm" data-kr="${cm.id}|${r.id}|consegnata">Consegna \ud83d\udece</button>`}
      <button class="btn ghost sm" data-kstorna="${r.id}" title="Non si pu\u00f2 fare: il piatto non parte, niente conto e niente scarico">\u21a9\ufe0e</button>
      <button class="btn ghost sm" data-knons="${r.id}" title="Gi\u00e0 fatto ma non servito: esce dal conto, la merce resta scaricata">\ud83d\uddd1</button></div>`;
  }).join('');
  // Se l'ordine e' arrivato prima che la piastra fosse calda, la cucina deve saperlo: non e'
  // in ritardo, e' in attesa dell'ora di consegna concordata con chi ha ordinato.
  const attesa = g.comande.map(cm => cm.non_prima).filter(Boolean).sort().pop();
  return `<div class="tcard clic" data-kdetail="${g.zona}|${esc(g.rif)}" style="border-color:${c.bd};background:${c.bg}">
    <div class="zacc" style="background:${acc}"></div>
    <div class="thd" style="margin-top:2px">${ref}${chipOf(g.st)}</div>
    <div class="tst" style="color:${c.tx}">${c.lb}${g.st.since ? ' · ' + hhmmOf(g.st.since) : ''}</div>
    ${attesa ? `<div class="tst" style="color:#B7791F;font-weight:800">🔥 non prima delle ${esc(attesa)}</div>` : ''}
    ${g.comande.some(cm => Number(cm.verifica_eta) === 1) ? '<div class="tst" style="color:#C0553F;font-weight:800">🔞 alcolici · verificare la maggiore età</div>' : ''}
    <div style="margin-top:6px">${righe}</div></div>`;
}
// ---- Modale dettaglio (clic su una card) ----
function openModal(html, opt) { $('#modal').dataset.protetta = (opt && opt.protetta) ? '1' : '';  $('#mbox').innerHTML = html; $('#modal').classList.remove('hide'); const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal; }
function closeModal() { $('#modal').classList.add('hide'); }
// UN CLIC A VUOTO NON DEVE COSTARE L'ORDINE. Su una finestra dove si e' composto qualcosa —
// una comanda con sei righe scelte una a una — chiudere per un tocco fuori bersaglio significa
// rifare tutto. Le finestre "protette" chiedono conferma; le altre si chiudono come prima,
// perche' su una scheda di sola lettura la chiusura rapida e' comoda.
function chiediSeChiudere() {
  const m = $('#modal');
  if (m && m.dataset.protetta === '1') {
    if (!confirm('Chiudere senza inviare? Le righe scelte finora vanno perse.')) return;
  }
  closeModal();
}
document.addEventListener('click', (e) => { if (e.target && e.target.id === 'modalBg') chiediSeChiudere(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiediSeChiudere(); });
function tavoloDetail(tb) {
  const c = ZCOL[tb.st.key];
  const tms = (x) => { const d = parseTs(x.created_at); return d ? d.getTime() : 0; };
  const comande = tb.cs.slice().sort((a, b) => tms(a) - tms(b));
  const blocks = comande.map(cm => {
    const t = parseTs(cm.created_at); const hh = t ? t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const righe = (cm.righe || []).map(r => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid #f4f2ea${r.parent_riga_id ? ';padding-left:18px' : ''}"><span>${r.parent_riga_id ? '<span class="muted">↳</span> ' : `<b>${r.qta}×</b> `}${esc(r.nome)} ${r.parent_riga_id ? '' : (r.stazione === 'cucina' ? '🍳' : '🍹')}${r.note ? `<div class="muted" style="font-size:.75rem">${esc(r.note)}</div>` : ''}</span><span class="tag ${['pronta', 'consegnata'].includes(r.stato) ? 'ok' : 'mid'}">${esc(r.stato)}</span></div>`).join('');
    return `<div style="margin-top:10px"><div class="muted" style="font-size:.74rem;font-weight:700">Comanda #${cm.numero || cm.id}${hh ? ' · ' + hh : ''}</div>${righe}<div style="text-align:right;font-weight:800;margin-top:4px">${eur(cm.totale)}</div></div>`;
  }).join('') || '<p class="muted">Tavolo libero.</p>';
  const tot = comande.reduce((s, cm) => s + Number(cm.totale || 0), 0);
  const pay = tb.st.key === 'verde' ? `<button class="btn gold block" data-tpay="${tb.st.delivered.map(x => x.id).join(',')}" style="margin-top:12px">💶 Incassa ${eur(tot)}</button>` : '';
  return `<div class="row" style="justify-content:space-between"><h3>🍽️ Tavolo ${tb.t}</h3><span class="tchip" style="background:${c.bd}">${c.lb}</span></div>${blocks}${pay}<button class="btn ghost block" data-mclose style="margin-top:8px">Chiudi</button>`;
}
function cucinaDetail(g) {
  const c = ZCOL[g.st.key];
  const label = g.zona === 'bar' ? ('🍸 ' + esc(g.rif)) : ('🍽️ Tavolo ' + esc(g.rif));
  const righe = g.comande.flatMap(cm => (cm.righe || []).map(r => ({ cm, r }))).map(({ cm, r }) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f4f2ea"><span><b>${r.qta}×</b> ${esc(r.nome)}${r.note ? `<div class="muted" style="font-size:.75rem">${esc(r.note)}</div>` : ''}</span><span class="tag ${r.stato === 'in_coda' ? 'mid' : 'ok'}">${r.stato === 'in_coda' ? 'da fare' : 'pronta'}</span></div>`).join('');
  return `<div class="row" style="justify-content:space-between"><h3>${label}</h3><span class="tchip" style="background:${c.bd}">${c.lb}${g.st.mins != null ? ' · ' + g.st.mins + '′' : ''}</span></div><div style="margin-top:8px">${righe}</div><button class="btn ghost block" data-mclose style="margin-top:10px">Chiudi</button>`;
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
      const key = zona + '|' + (c.riferimento || '—');
      (groups[key] = groups[key] || { zona, rif: c.riferimento || '—', comande: [] }).comande.push(c);
    }
    const now = Date.now();
    const all = Object.values(groups).map(g => ({ ...g, st: statoGruppo(g.comande, rMin, now) }));
    const byUrg = (a, b) => (URG[a.st.key] - URG[b.st.key]) || ((a.st.since || Infinity) - (b.st.since || Infinity));
    const bar = all.filter(g => g.zona === 'bar').sort(byUrg);
    const garden = all.filter(g => g.zona === 'garden').sort(byUrg);
    // Board diviso a metà: sopra il Bar (a nome), sotto i Tavoli Garden — stesso ciclo colore.
    $('#view').innerHTML = `<div class="split">
      <section>
        <div class="shd">🍸 Bar <span class="muted" style="font-weight:400;font-size:.72rem">· a nome · ${bar.length} in coda</span></div>
        <div class="board">${bar.map(cucinaCard).join('') || '<p class="muted">Nessuna comanda bar da cucinare. 🎉</p>'}</div>
      </section>
      <div class="divider"></div>
      <section>
        <div class="shd">🍽️ Tavoli · Garden <span class="muted" style="font-weight:400;font-size:.72rem">· a tavolo · 🟨→🟥 oltre ${rMin}′ · ${garden.length} in coda</span></div>
        <div class="board">${garden.map(cucinaCard).join('') || '<p class="muted">Nessuna comanda tavolo da cucinare. 🎉</p>'}</div>
      </section>
    </div>`;
    document.querySelectorAll('[data-kr]').forEach(b => b.onclick = async () => { const [cid, rid, st] = b.dataset.kr.split('|'); await api('/comande/' + cid + '/riga/' + rid + '/stato', { method: 'PUT', body: JSON.stringify({ stato: st }) }); render(); });
    // La cucina può togliere una riga che non è in grado di fare: ingrediente finito, piatto
    // sbagliato. Prima poteva solo segnarla "pronta" e lasciare il problema alla sala, che se
    // ne accorgeva davanti al cliente. Il motivo è obbligatorio, e la riga resta scritta.
    // "Gia' fatto ma non servito" non e' uno storno: il piatto e' stato cucinato, la merce e'
    // uscita. Fuori dal conto, ma il magazzino la scarica lo stesso — altrimenti all'inventario
    // resta un ammanco che nessuno sa spiegare.
    document.querySelectorAll('[data-knons]').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const motivo = prompt('Il piatto \u00e8 stato fatto ma non servito. Cosa \u00e8 successo?\n(il cliente ha rinunciato, sbagliato tavolo, arrivato freddo\u2026)');
      if (motivo == null || !motivo.trim()) return;
      try { await api('/comande/righe/' + b.dataset.knons + '/non-servita', { method: 'PUT', body: JSON.stringify({ motivo: motivo.trim() }) }); }
      catch (err) { alert(err.message); return; }
      alert('Tolto dal conto. La merce resta scaricata dal magazzino: il piatto \u00e8 stato fatto.\nLa sala vede il tavolo acceso in rosso.');
      show('kds');
    });
    document.querySelectorAll('[data-kstorna]').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const motivo = prompt('Perché questa riga non si può fare?\n(ingrediente finito, piatto sbagliato…)');
      if (motivo == null || !motivo.trim()) return;
      try { await api('/comande/righe/' + b.dataset.kstorna + '/storna', { method: 'PUT', body: JSON.stringify({ motivo: motivo.trim() }) }); }
      catch (err) { alert(err.message); return; }
      alert('Riga tolta dalla comanda e dal conto. Avvisa la sala: il cliente va informato.');
      show('kds');
    });
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
    // IL BANCO PREPARA QUELLO CHE PREPARA IL BANCO, da qualunque parte arrivi l'ordine.
    // Prima questa schermata filtrava per ZONA: mostrava tutte le comande del bancone (anche i
    // panini, che li fa la cucina) e NON mostrava il cocktail ordinato a un tavolo del Garden —
    // che la cucina a sua volta non vede, perche' lei filtra per stazione. Quel cocktail non lo
    // vedeva nessuno: restava in un ordine che nessuno preparava, finche' il cliente non lo
    // reclamava. E' lo stesso principio del menu': chi prepara e dove si vende sono due cose
    // diverse, e la coda di lavoro segue CHI PREPARA.
    const comande = await api('/kds?stazione=bar').catch(() => []);
    const now = Date.now();
    const arr = comande.map(c => ({ c, st: statoGruppo([c], rMin, now) }));
    arr.sort((a, b) => (URG[a.st.key] - URG[b.st.key]) || ((a.st.since || Infinity) - (b.st.since || Infinity)));
    const card = ({ c, st }) => {
      const col = ZCOL[st.key];
      const hhmm = st.since ? new Date(st.since).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
      // Da dove arriva: al banco si ritira, al tavolo si porta. Cambia il gesto, non la coda.
      const alTavolo = c.zona !== 'bar';
      const provenienza = alTavolo
        ? `<span class="tag" style="background:#1d4e79;color:#fff">\ud83c\udf7d\ufe0f da portare al tavolo ${esc(String(c.riferimento || '?'))}</span>`
        : `<span class="tag" style="background:#8a6d1f;color:#fff">\ud83c\udf78 al banco${c.nome ? ' \u00b7 ' + esc(c.nome) : ''}</span>`;
      const righe = (c.righe || []).map(r => `<div style="display:flex;gap:6px;font-size:.85rem;padding:2px 0${r.parent_riga_id ? ';padding-left:16px' : ''}"><span style="flex:1">${r.parent_riga_id ? '<span class="muted">\u21b3</span> ' : r.qta + '\u00d7 '}${esc(r.nome)}</span><span class="tag ${r.stato === 'consegnata' || r.stato === 'pronta' ? 'ok' : 'mid'}">${esc(r.stato)}</span></div>`).join('');
      // L'incasso resta a chi tiene il conto: una comanda del tavolo si paga al tavolo, e dal
      // banco si vede solo per prepararla.
      const azioni = `${c.stato === 'aperta' ? `<button class="btn ghost sm" data-cs="${c.id}|in_preparazione">\u25b6 Avvia</button>` : ''}` +
        `${c.stato === 'in_preparazione' ? `<button class="btn gold sm" data-cs="${c.id}|pronta">Pronta \u2714</button>` : ''}` +
        `${c.stato === 'pronta' ? `<button class="btn ghost sm" data-cs="${c.id}|consegnata">${alTavolo ? 'Portata \ud83c\udf7d\ufe0f' : 'Consegnata \ud83d\udece\ufe0f'}</button>` : ''}` +
        `${alTavolo ? '' : `<button class="btn gold sm" data-ch="${c.id}">\ud83d\udcb6 Incassa</button><button class="btn danger sm" data-can="${c.id}">Annulla</button>`}`;
      return `<div class="panel" style="border:2px solid ${col.bd};background:${col.bg};min-width:250px;flex:1 1 250px;max-width:340px;margin:0">
        <div class="row" style="justify-content:space-between;align-items:center"><b>#${esc(String(c.numero))}</b><span class="muted" style="font-size:.75rem">${hhmm}</span></div>
        <div style="margin:4px 0">${provenienza}</div>
        <div style="margin-top:4px">${righe}</div>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${azioni}</div></div>`;
    };
    const alTavolo = arr.filter(x => x.c.zona !== 'bar').length;
    $('#view').innerHTML = `<div class="panel"><h3>\ud83c\udf78 Banco \u00b7 da preparare <span class="muted" style="font-weight:400;font-size:.72rem;margin-left:8px">\u00b7 auto-aggiornata</span></h3>
      <div class="muted" style="font-size:.76rem">Tutto quello che prepara il banco, <b>da qualunque parte arrivi l'ordine</b>: ${alTavolo ? `<b>${alTavolo}</b> ${alTavolo === 1 ? 'ordine' : 'ordini'} da portare a un tavolo del Garden` : 'al momento solo ordini al banco'}. <b style="color:#c79200">Giallo</b> in lavorazione \u00b7 <b style="color:#d64535">rosso</b> oltre ${rMin}\u2032.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">${arr.map(card).join('') || '<p class="muted">Niente da preparare al banco. \ud83c\udf89</p>'}</div></div>`;
    document.querySelectorAll('[data-cs]').forEach(b => b.onclick = async () => { const [id, st] = b.dataset.cs.split('|'); await api('/comande/' + id + '/stato', { method: 'PUT', body: JSON.stringify({ stato: st }) }); render(); });
    document.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => pickMetodo(async (metodo, email, tessera_code, pin) => { const r = await api('/comande/' + b.dataset.ch + '/chiudi', { method: 'POST', body: JSON.stringify({ metodo, email, tessera_code, pin }) }); if (r && r.ricevuta_inviata) alert('Copia del conto inviata a ' + r.ricevuta_a + '.\nLo scontrino fiscale va consegnato lo stesso.'); render(); }));
    document.querySelectorAll('[data-can]').forEach(b => b.onclick = async () => { if (!confirm('Annullare la comanda?')) return; await api('/comande/' + b.dataset.can + '/stato', { method: 'PUT', body: JSON.stringify({ stato: 'annullata' }) }); render(); });
  };
  await render();
  window.__kdsTimer = setInterval(render, 8000);
};

/* ---------- MAPPA TAVOLI (Bussola Garden) ----------
   Un box per tavolo, ordinato dinamicamente per urgenza. Ciclo colore:
   arancio = libero/base · giallo = comanda acquisita · rosso = oltre soglia · verde = consegnato.
   Un nuovo ordine sul tavolo riparte da giallo; all'incasso torna arancio. */
VIEWS.tavoli = async () => {
  const cfg = await api('/self-order/config').catch(() => ({}));
  const rMin = Number(cfg.map_rosso_min || 10);
  // La sala e' quella disegnata nella Pianta: i tavoli aggiunti compaiono, quelli assorbiti da
  // un'unione spariscono ma le loro comande confluiscono sul tavolo che li ha assorbiti.
  const sala = await api('/tavoli/sala').catch(() => null);
  const render = async () => {
    // Solo comande del GARDEN e ancora aperte: prima bastava "non del bar", e le comande
    // senza zona o di altri punti finivano sui tavoli.
    const APERTE = ['aperta', 'in_preparazione', 'pronta'];
    const comande = (await api('/comande').catch(() => [])).filter(c => c.zona === 'garden' && APERTE.includes(c.stato));
    const verso = (sala && sala.verso) || {};
    const byTable = {};
    for (const c of comande) {
      const ref = String(c.riferimento || '').trim();
      if (!/^\d+$/.test(ref)) continue;                       // solo riferimenti numerici = tavoli Garden
      const t = Number(verso[ref] != null ? verso[ref] : ref);  // il numero del QR punta al tavolo reale
      (byTable[t] = byTable[t] || []).push(c);
    }
    const now = Date.now();
    const elenco = (sala && sala.tavoli && sala.tavoli.length)
      ? sala.tavoli
      : Array.from({ length: Math.max(1, Number(cfg.garden_tavoli || 12)) }, (_, i) => ({ numero: i + 1, posti: null, uniti: [] }));
    const tables = elenco.map(x => { const cs = byTable[x.numero] || []; return { t: x.numero, posti: x.posti, uniti: x.uniti || [], cs, st: statoGruppo(cs, rMin, now) }; });
    const rank = { rosso: 0, giallo: 1, verde: 2, arancio: 3 };
    tables.sort((a, b) => (rank[a.st.key] - rank[b.st.key]) || ((a.st.since || Infinity) - (b.st.since || Infinity)) || (a.t - b.t));
    $('#view').innerHTML = `<div class="panel" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><h3 style="margin:0">🗺️ Mappa tavoli · Bussola Garden <span class="muted" style="font-weight:400;font-size:.72rem;margin-left:6px">· ${tables.length} tavoli${sala ? ' · ' + esc(sala.layout.nome) : ''} · auto-aggiornamento</span></h3>
      <div class="muted" style="font-size:.74rem">🟧 libero · 🟨 acquisita · 🟥 oltre ${rMin}′ · 🟩 consegnato</div></div></div>
      <div class="board">${tables.map(tavoloCard).join('')}</div>`;
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

/* ---------- SPORT: tabellone e risultati (Coppa delle Casate) — modulo operativo ----------
   Il tabellone vive QUI, non nel back office: i gironi si formano da soli (8 casate → due
   gironi da 4 → 3 giornate da 2 partite), quindi replicarne la gestione altrove non serve.
   Nel back office restano i TORNEI: periodo, stato, regolamento, archiviazione, Albo d'Oro.
   Impianto: i due gironi affiancati, classifica compatta, e sotto le giornate del girone. */
let SPORT_DISC = null;
const spDot = (c) => `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${/^#|rgb/.test(String(c || '')) ? esc(c) : '#' + esc(String(c || '888'))};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,.2)"></span>`;
// "Girone A" arriva gia' col suo nome per esteso: non anteporre un'altra volta la parola.
const nomeGirone = (n) => /girone/i.test(String(n || '')) ? String(n) : 'Girone ' + String(n || '');

VIEWS.sport = async () => {
  // Solo le discipline in cartellone quest'anno: se il gestore ne ha spente sei, non deve
  // ritrovarsele nella tendina di chi segna i risultati in campo.
  const disc = ((await api('/discipline').catch(() => [])) || []).filter(d => d.attivo !== 0);
  const usabili = disc.filter(d => d.stato !== 'archiviato');
  if (!disc.find(d => d.id === SPORT_DISC)) SPORT_DISC = (usabili[0] || disc[0] || {}).id || null;
  const cur = disc.find(d => d.id === SPORT_DISC);
  const opt = disc.map(d => `<option value="${d.id}" ${d.id === SPORT_DISC ? 'selected' : ''}>${d.dominio === 'giochi' ? '🎲' : '🏅'} ${esc(d.nome)}${d.stato === 'archiviato' ? ' · archiviata' : d.stato === 'in_corso' ? ' · in corso' : ''}</option>`).join('');
  const head = `<div class="panel"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">🏆 Tabellone · ${cur ? esc(cur.nome) : 'Sport'}</h3>
      <div class="row" style="gap:6px;align-items:center">
        ${disc.length ? `<select id="sp_disc" style="min-width:170px">${opt}</select>` : ''}
        ${PAR.sport_foglio_gara === false ? '' : '<button class="btn ghost sm" id="sp_print" title="Foglio gara da portare in campo">🖨️ Foglio gara</button>'}
      </div></div></div>`;
  if (!cur) { $('#view').innerHTML = head + '<div class="panel"><p class="muted">Nessuna disciplina disponibile. Il gestore la crea nel back office.</p></div>'; wireDisc(); return; }
  const t = await api('/tabellone/' + cur.id).catch(() => ({ gironi: [], fasi: {}, completo: false }));
  if (!t.gironi || !t.gironi.length) {
    $('#view').innerHTML = head + `<div class="panel"><p class="muted">Calendario non ancora generato per <b>${esc(cur.nome)}</b>. Si genera dal back office, sezione Tornei.</p></div>`; wireDisc(); return;
  }
  window.__spTab = t;
  window.__spDiscNome = cur.nome;

  // --- una partita: due casate, due punteggi, salva + foto referto
  const matchRow = (p, label) => {
    const giocata = p.stato === 'giocata';
    const pari = !!label && giocata && p.gol_a != null && p.gol_a === p.gol_b;
    const acc = pari ? 'var(--coral)' : giocata ? 'var(--ok)' : 'var(--gold)';
    return `<div class="mrow" style="border-left:3px solid ${acc};background:#fff;border-radius:10px;padding:8px 10px;margin-bottom:6px">
      ${label ? `<div style="font-size:.66rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">${esc(label)}${pari ? ' · ⚠️ serve un vincitore' : ''}</div>` : ''}
      <div class="row" style="gap:6px;align-items:center">
        <span style="flex:1;font-weight:700;font-size:.86rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.casa_a)}</span>
        <input id="ga_${p.id}" type="number" min="0" inputmode="numeric" value="${p.gol_a != null ? esc(String(p.gol_a)) : ''}" style="width:42px;text-align:center;padding:4px">
        <span class="muted">:</span>
        <input id="gb_${p.id}" type="number" min="0" inputmode="numeric" value="${p.gol_b != null ? esc(String(p.gol_b)) : ''}" style="width:42px;text-align:center;padding:4px">
        <span style="flex:1;font-weight:700;font-size:.86rem;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.casa_b)}</span>
        <button class="btn gold sm" data-sp-save="${p.id}" style="padding:4px 10px">${giocata ? '✓' : 'Salva'}</button>
        <button class="btn ghost sm" data-sp-foto="${p.id}" title="Foto referto" style="padding:4px 8px">📷</button>
      </div>
      <div class="row" style="gap:6px;align-items:center;margin-top:5px">
        <span class="muted" style="font-size:.7rem">Si gioca il</span>
        <input type="date" value="${esc(p.quando || '')}" data-sp-pdata="${p.id}" style="padding:2px 5px;font-size:.74rem" title="Sposta solo questa partita">
      </div></div>`;
  };

  // --- un girone: classifica compatta + le sue 3 giornate, ognuna con la data
  const gironeCol = (g) => {
    const cls = (g.classifica || []).map((c, i) => `<tr>
      <td style="text-align:center;width:18px;color:var(--muted)">${i + 1}</td>
      <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${spDot(c.colore)}<b style="font-size:.84rem">${esc(c.nome)}</b></td>
      <td style="text-align:center;width:26px">${esc(String(c.pg || 0))}</td>
      <td style="text-align:center;width:46px;font-size:.8rem">${esc(String(c.gf || 0))}-${esc(String(c.gs || 0))}</td>
      <td style="text-align:center;width:26px"><b>${esc(String(c.pt || 0))}</b></td></tr>`).join('');
    const giornate = [...new Set((g.partite || []).map(p => p.giornata))].sort((a, b) => a - b);
    const blocchi = giornate.map(n => {
      const ps = g.partite.filter(p => p.giornata === n);
      const data = (ps.find(p => p.quando) || {}).quando || '';
      const fatte = ps.filter(p => p.stato === 'giocata').length;
      return `<div style="border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:10px;background:#fbfaf6">
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
          <b style="font-size:.8rem;color:var(--accent)">Giornata ${n}<span class="muted" style="font-weight:400"> · ${fatte}/${ps.length}</span></b>
          <input type="date" value="${esc(data)}" data-sp-data="${g.id}|${n}" style="padding:3px 6px;font-size:.78rem" title="Data della giornata">
        </div>
        ${ps.map(p => matchRow(p)).join('')}</div>`;
    }).join('');
    return `<div class="panel" style="margin:0">
      <h3 style="margin:0 0 8px">${esc(nomeGirone(g.nome))}</h3>
      <table style="font-size:.85rem"><thead><tr><th style="width:18px"></th><th>Casata</th><th style="width:26px">G</th><th style="width:46px">Gol</th><th style="width:26px">Pt</th></tr></thead><tbody>${cls}</tbody></table>
      <div style="margin-top:10px">${blocchi}</div></div>`;
  };

  // Due colonne su schermo largo, una sotto l'altra sul telefono.
  const gironiHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-bottom:12px">
    ${t.gironi.map(gironeCol).join('')}</div>`;

  // --- fase finale
  const fasi = t.fasi || {};
  const faseDef = [['quarti', 'Quarto di finale'], ['semifinali', 'Semifinale'], ['finale3', 'Finale 3º/4º'], ['finale1', 'Finale 1º/2º']];
  const gironiTot = t.gironi.reduce((n, g) => n + (g.partite || []).length, 0);
  const gironiMancanti = t.gironi.reduce((n, g) => n + (g.partite || []).filter(p => p.stato !== 'giocata' || p.gol_a == null).length, 0);
  const blocks = faseDef.map(([k, label]) => {
    const arr = fasi[k] || []; if (!arr.length) return '';
    return `<div style="font-weight:800;color:var(--accent);margin:10px 0 6px;font-size:.82rem">${esc(label)}</div>${arr.map((p, i) => matchRow(p, arr.length > 1 ? label + ' ' + (i + 1) : label)).join('')}`;
  }).join('');
  // Struttura sempre visibile: ogni casella dice da dove arriva la casata e, se la classifica
  // esiste gia', chi la occuperebbe oggi. Si vede dove si e' diretti prima che si sblocchi.
  const cella = (s2) => s2.provvisorio
    ? `<b style="font-size:.86rem">${esc(s2.provvisorio)}</b> <span class="muted" style="font-size:.68rem">(${esc(s2.etichetta)})</span>`
    : `<span class="muted" style="font-size:.82rem;font-style:italic">${esc(s2.etichetta)}</span>`;
  const scontro = (x, titolo) => `<div style="border:1px solid var(--line);border-left:3px solid var(--muted);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:#fff">
      <div style="font-size:.66rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">${esc(titolo)}</div>
      <div style="margin-top:3px">${cella(x.a)}</div>
      <div class="muted" style="font-size:.7rem;margin:1px 0">contro</div>
      <div>${cella(x.b)}</div></div>`;
  const st = t.struttura;
  const schema = st ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
      <div><div style="font-weight:800;color:var(--accent);font-size:.8rem;margin-bottom:6px">Quarti</div>${st.quarti.map(q => scontro(q, 'Quarto ' + q.slot)).join('')}</div>
      <div><div style="font-weight:800;color:var(--accent);font-size:.8rem;margin-bottom:6px">Semifinali</div>${st.semifinali.map(q => scontro(q, 'Semifinale ' + q.slot)).join('')}</div>
      <div><div style="font-weight:800;color:var(--accent);font-size:.8rem;margin-bottom:6px">Finali</div>${scontro(st.finale1, 'Finale 1º/2º')}${scontro(st.finale3, 'Finale 3º/4º')}</div>
    </div>` : '';
  const avviso = t.hasFinale ? '' : `<div class="row" style="gap:8px;align-items:center;background:#fff;border:1px dashed var(--muted);border-radius:12px;padding:10px;margin-bottom:10px">
        <div style="font-size:1.3rem">⏳</div>
        <div><b style="font-size:.9rem">Non ancora sbloccata.</b> <span class="muted" style="font-size:.8rem">${gironiMancanti > 0 ? `Mancano <b>${gironiMancanti}</b> partite su ${gironiTot} nei gironi; gli accoppiamenti qui sotto sono quelli che risulterebbero con la classifica di adesso.` : 'Gironi completati: la fase finale si sta generando, riapri la scheda.'}</span></div></div>`;
  const statoFinale = (t.hasFinale && blocks) ? (schema + '<div style="margin-top:10px">' + blocks + '</div>') : (avviso + schema);
  const finaliHtml = `<div class="panel"><h3>🏆 Fase finale</h3>
    <p class="muted" style="font-size:.76rem;margin-bottom:6px">Incroci fra i gironi (1º-4º, 2º-3º, 3º-2º, 4º-1º) → semifinali → finali. In caso di pareggio serve un vincitore.</p>${statoFinale}</div>`;

  let gradHtml = '';
  if (t.graduatoria && t.graduatoria.length) {
    gradHtml = `<div class="panel"><h3>🏅 Graduatoria finale · punti Coppa</h3>
      <table><thead><tr><th>Pos.</th><th>Casata</th><th>Punti</th></tr></thead><tbody>${t.graduatoria.map(r => `<tr><td style="text-align:center"><b>${esc(String(r.posizione))}</b></td><td><b>${esc(r.nome)}</b></td><td style="text-align:center"><b style="color:var(--gold)">${esc(String(r.punti))}</b></td></tr>`).join('')}</tbody></table>
      <p class="muted" style="font-size:.74rem;margin-top:6px">Confluiscono da soli nel cartellone della Coppa.</p></div>`;
  }

  $('#view').innerHTML = head + gironiHtml + finaliHtml + gradHtml;
  wireDisc();
  document.querySelectorAll('[data-sp-save]').forEach(b => b.onclick = async () => {
    const id = b.dataset.spSave;
    const a = $('#ga_' + id).value, bb = $('#gb_' + id).value;
    if (a === '' || bb === '') { alert('Inserisci entrambi i punteggi.'); return; }
    try { await api('/partite/' + id, { method: 'PUT', body: JSON.stringify({ gol_a: Number(a), gol_b: Number(bb) }) }); show('sport'); }
    catch (e) { alert('Errore: ' + e.message); }
  });
  document.querySelectorAll('[data-sp-foto]').forEach(b => b.onclick = () => fotoPartita(b.dataset.spFoto));
  document.querySelectorAll('[data-sp-pdata]').forEach(inp => inp.onchange = async () => {
    try { await api('/partite/' + inp.dataset.spPdata + '/quando', { method: 'PUT', body: JSON.stringify({ quando: inp.value }) }); }
    catch (e) { alert('Data non salvata: ' + e.message); }
  });
  document.querySelectorAll('[data-sp-data]').forEach(inp => inp.onchange = async () => {
    const [gid, n] = inp.dataset.spData.split('|');
    try { await api('/tabellone/' + SPORT_DISC + '/giornata', { method: 'PUT', body: JSON.stringify({ girone_id: Number(gid), giornata: Number(n), quando: inp.value }) }); }
    catch (e) { alert('Data non salvata: ' + e.message); }
  });
  if ($('#sp_print')) $('#sp_print').onclick = () => stampaFoglioGara(window.__spTab, window.__spDiscNome);
  function wireDisc() { const s = $('#sp_disc'); if (s) s.onchange = () => { SPORT_DISC = Number(s.value); show('sport'); }; }
};

// Foglio gara: si stampa da qui, dove si gioca. Una pagina A4 per disciplina, giornata per
// giornata, con le caselle vuote per segnare i risultati a mano quando manca il telefono.
function stampaFoglioGara(t, nomeDisc) {
  const riga = (p) => `<tr><td class="sq">${esc(p.casa_a)}</td><td class="box"></td><td class="sep">:</td><td class="box"></td><td class="sq r">${esc(p.casa_b)}</td></tr>`;
  const gironi = (t.gironi || []).map(g => {
    const giornate = [...new Set((g.partite || []).map(p => p.giornata))].sort((a, b) => a - b);
    const blocchi = giornate.map(n => {
      const ps = g.partite.filter(p => p.giornata === n);
      const data = (ps.find(p => p.quando) || {}).quando || '';
      return `<div class="gio"><div class="giohd">Giornata ${n} <span class="data">${data ? esc(data) : 'data ____ / ____ / ______'}</span></div>
        <table class="mt">${ps.map(riga).join('')}</table></div>`;
    }).join('');
    return `<div class="gir"><h2>${esc(nomeGirone(g.nome))}</h2>${blocchi}</div>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti le finestre pop-up per stampare il foglio.'); return; }
  w.document.write(`<html><head><title>Foglio gara · ${esc(nomeDisc || '')}</title><style>
    @page{size:A4;margin:18mm}
    *{box-sizing:border-box}
    body{font-family:Georgia,'Times New Roman',serif;color:#12324F;margin:0}
    header{border-bottom:2px solid #E0B44A;padding-bottom:10px;margin-bottom:14px}
    header h1{margin:0;font-size:1.5rem;letter-spacing:1px}
    header .meta{font-family:Arial,sans-serif;font-size:.82rem;color:#5a6b75;margin-top:4px}
    .wrap{display:flex;gap:18px}
    .gir{flex:1;break-inside:avoid}
    .gir h2{font-family:Arial,sans-serif;font-size:1rem;margin:0 0 8px;padding-bottom:4px;border-bottom:2px solid #12324F}
    .gio{margin-bottom:12px;break-inside:avoid}
    .giohd{font-family:Arial,sans-serif;font-size:.8rem;font-weight:bold;margin-bottom:4px}
    .giohd .data{font-weight:normal;color:#5a6b75;margin-left:6px}
    table.mt{width:100%;border-collapse:collapse}
    table.mt td{padding:6px 2px;font-size:.86rem;border-bottom:1px solid #e6ddc7}
    td.sq{width:38%}
    td.sq.r{text-align:right}
    td.box{width:34px;height:26px;border:1.5px solid #12324F;border-radius:4px}
    td.sep{width:14px;text-align:center;color:#8a8a8a}
    footer{margin-top:18px;border-top:1px solid #e6ddc7;padding-top:8px;font-family:Arial,sans-serif;font-size:.76rem;color:#777}
  </style></head><body>
    <header><h1>${esc(nomeDisc || 'Torneo')} · foglio gara</h1>
      <div class="meta">Coppa delle Casate · Bussola Residence — segnare i risultati e riportarli in app · Staff: __________________</div></header>
    <div class="wrap">${gironi}</div>
    <footer>I punti Coppa (12 · 10 · 8 · 6 ai primi quattro, 4 dal 5º all'8º) si calcolano da soli al termine delle finali.</footer>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\\/script>
  </body></html>`);
  w.document.close();
}

// Camera/allegato: scatta o sceglie un'immagine e restituisce il dataURL.
function pickImage(cb) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => cb(String(rd.result)); rd.readAsDataURL(f); };
  inp.click();
}
// Foto referto della partita (evidenza anti-contestazione) — scattata dalla crew a bordo campo.
async function fotoPartita(id) {
  const list = await api('/allegati?entita=partita&entita_id=' + id).catch(() => []);
  const thumbs = list.length ? list.map(a => `<button class="btn ghost sm" data-vf="${a.id}">📷 ${esc(a.created_at || '')}</button>`).join(' ') : '<span class="muted">Nessuna foto allegata.</span>';
  openModal(`<h3>📷 Foto referto · partita #${esc(String(id))}</h3>
    <p class="muted" style="font-size:.8rem">Scatta o allega la foto del tabellino per certificare il risultato.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">${thumbs}</div>
    <div class="row" style="justify-content:space-between"><button class="btn gold sm" data-addf>📷 Scatta / allega</button><button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
  const add = $('#mbox').querySelector('[data-addf]');
  if (add) add.onclick = () => pickImage(async (d) => { try { await api('/allegati', { method: 'POST', body: JSON.stringify({ entita: 'partita', entita_id: String(id), immagine: d }) }); fotoPartita(id); } catch (e) { alert('Errore: ' + e.message); } });
  $('#mbox').querySelectorAll('[data-vf]').forEach(b => b.onclick = async () => { const r = await api('/allegati/' + b.dataset.vf + '/foto'); const w = window.open('', '_blank'); if (w) { w.document.write('<img src="' + r.foto + '" style="max-width:100%">'); w.document.close(); } });
}

/* ---------- MAGAZZINO ---------- */
const MAG_AREE = [['chiosco', 'Chiosco'], ['casa_di_carta', 'Casa di Carta'], ['serata_clan', 'Serata Clan'], ['serate_tema', 'Serate a tema']];
const magAreaLabel = (a) => (MAG_AREE.find(x => x[0] === a) || [a, a])[1];
const magBadge = (s) => s === 'negativa' ? '<span class="tag no">⚠ negativa</span>' : s === 'da_riordinare' ? '<span class="tag no">Da riordinare</span>' : s === 'in_esaurimento' ? '<span class="tag mid">In esaurimento</span>' : '<span class="tag ok">OK</span>';
const magZonaBadge = (z) => z === 'bar' ? '<span class="tag" style="background:#e7f0f6;color:#12324F">🍸 Bar</span>' : z === 'garden' ? '<span class="tag" style="background:#eaf5ec;color:#2e6b3f">🌿 Garden</span>' : (z === 'carta' || z === 'cdc') ? '<span class="tag" style="background:#f2ece0;color:#7a5c2e">📚 Carta</span>' : '<span class="tag" style="background:#efe9dc;color:#6b5a2f">🔁 Comune</span>';
// ===== MAGAZZINO A DUE LIVELLI (v4.48): hub Centrale / Bar / Garden =====
let MAG_SUB = 'centrale';
const MAG_SUB_LABEL = { centrale: '🏬 Centrale', previsione: '🔮 Previsione', calendario: '📅 Calendario', quadratura: '📊 Quadratura', bar: '🍸 Bar', garden: '🌿 Garden', carta: '📚 Casa di Carta' };
const magSubbar = () => `<div class="panel"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
  <b style="color:var(--navy)">📦 Magazzino <span class="muted" style="font-weight:400;font-size:.72rem">· merce unica al Centrale</span></b>
  <div class="row">${['centrale', 'previsione', 'calendario', 'quadratura', 'bar', 'garden', 'carta'].map(k => `<button class="btn ${MAG_SUB === k ? 'gold' : 'ghost'} sm" data-msub="${k}">${MAG_SUB_LABEL[k]}</button>`).join('')}</div></div></div>`;
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
  const scEl = (v) => v == null ? '<span class="muted">—</span>' : (v === 0 ? '<span class="tag ok">0</span>' : `<span class="tag no">${esc(String(v > 0 ? '+' + v : v))}</span>`);
  const rows = (data.articoli || []).map(a => `<tr>
    <td><b>${esc(a.nome)}</b> ${magZonaBadge(a.zona)}</td>
    <td style="text-align:center">${a.giacenza_iniziale == null ? '—' : esc(String(a.giacenza_iniziale))}</td>
    <td style="text-align:center;color:${a.carico ? 'var(--teal)' : 'var(--muted)'}">${esc(String(a.carico))}</td>
    <td style="text-align:center;color:${a.scarico ? 'var(--coral)' : 'var(--muted)'}">${esc(String(a.scarico))}</td>
    <td style="text-align:center" class="muted">${esc(String(a.scarico_bar))} / ${esc(String(a.scarico_garden))}</td>
    <td style="text-align:center"><b>${esc(String(a.giacenza_finale))}</b></td>
    <td style="text-align:center">${a.atteso == null ? '—' : esc(String(a.atteso))}</td>
    <td style="text-align:center">${scEl(a.scostamento)}</td>
  </tr>`).join('');
  const mesiOpts = (data.mesi || [data.mese]).map(m => `<option value="${m}" ${m === data.mese ? 'selected' : ''}>${esc(m)}</option>`).join('');
  $('#view').innerHTML = magSubbar() + `<div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">📊 Quadratura mensile ${data.chiusa ? '<span class="tag ok">chiusa</span>' : '<span class="tag mid">in corso</span>'}</h3>
      <div class="row"><label class="muted" style="font-size:.8rem">Mese</label><select id="mag_mese">${mesiOpts}</select><button class="btn ghost sm" id="mag_chiudi">🔒 Chiudi mese</button></div></div>
    <p class="muted" style="font-size:.78rem;margin-top:6px">Flussi del mese per articolo e <b>consumi per zona</b> (bar/garden). <b>Atteso</b> = iniziale + carichi − scarichi; lo <b>scostamento</b> vs la giacenza reale evidenzia rettifiche/cali/anomalie (0 = quadra). L'iniziale c'è dal mese successivo alla prima chiusura. A fine mese la chiusura è automatica; puoi anche chiudere qui.</p>
    <div class="row" style="gap:10px;margin-top:8px">
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Carichi</div><div style="font-size:1.3rem;font-weight:800;color:var(--teal)">${t.carico || 0}</div></div>
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Consumo 🍸 Bar</div><div style="font-size:1.3rem;font-weight:800;color:var(--navy)">${t.scarico_bar || 0}</div></div>
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Consumo 🌿 Garden</div><div style="font-size:1.3rem;font-weight:800;color:var(--navy)">${t.scarico_garden || 0}</div></div>
      <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Scostamenti</div><div style="font-size:1.3rem;font-weight:800;color:${t.scostamenti ? 'var(--coral)' : 'var(--navy)'}">${t.scostamenti || 0}</div></div></div></div>
    <div class="panel"><table><thead><tr><th>Articolo</th><th>Iniz.</th><th>Carico</th><th>Scarico</th><th>bar/garden</th><th>Finale</th><th>Atteso</th><th>Scost.</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">Nessun movimento nel mese.</td></tr>'}</tbody></table></div>`;
  $('#mag_mese').onchange = (e) => { MAG_MESE = e.target.value; show('magazzino'); };
  $('#mag_chiudi').onclick = async () => { if (!confirm('Chiudere il mese ' + data.mese + '? Registra la giacenza attuale come giacenza di fine mese (base per la riconciliazione del mese successivo).')) return; await api('/magazzino/quadratura/chiudi', { method: 'POST', body: JSON.stringify({ mese: data.mese }) }); show('magazzino'); };
}
// Helper: formatta una data ISO (YYYY-MM-DD) in gg/mm + etichetta relativa (oggi/domani/in ritardo).
function magDataLabel(iso, oggi) {
  if (!iso) return '—';
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
  const invHtml = Object.keys(gInv).sort().map(dt => `<div style="margin-bottom:8px"><div style="font-weight:800;color:${dt <= oggi ? 'var(--coral)' : 'var(--navy)'};font-size:.85rem;margin-bottom:3px">${magDataLabel(dt, oggi)}</div>${gInv[dt].map(a => `<div class="row" style="justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f0efe8"><span>${magZonaBadge(a.zona)} <b>${esc(a.nome)}</b> · ordina <b>${esc(String(a.suggerito))}</b> ${esc(a.unita)}${a.in_arrivo ? ` <span class="muted">(${esc(String(a.in_arrivo))} già in arrivo)</span>` : ''}</span><div class="row"><input id="cq_${a.articolo_id}" type="number" value="${a.suggerito}" style="width:64px"><button class="btn gold sm" data-cord="${a.articolo_id}">✔ Ordina</button></div></div>`).join('')}</div>`).join('') || '<p class="muted">Niente da inviare nei prossimi giorni.</p>';
  // Consegne attese: ordini confermati raggruppati per data prevista.
  const gCon = {}; (ordini || []).forEach(o => { const k = o.data_prevista || '—'; (gCon[k] = gCon[k] || []).push(o); });
  const conHtml = Object.keys(gCon).sort().map(dt => `<div style="margin-bottom:8px"><div style="font-weight:800;color:${dt !== '—' && dt <= oggi ? 'var(--coral)' : 'var(--navy)'};font-size:.85rem;margin-bottom:3px">${dt === '—' ? 'senza data' : magDataLabel(dt, oggi)}</div>${gCon[dt].map(o => `<div class="row" style="justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f0efe8"><span>🚚 <b>${esc(o.nome)}</b> · ${esc(String(o.quantita))} ${esc(o.unita)}</span><div class="row"><button class="btn gold sm" data-cric="${o.id}">📥 Ricevi</button><button class="btn ghost sm" data-cann="${o.id}">Annulla</button></div></div>`).join('')}</div>`).join('') || '<p class="muted">Nessuna consegna in programma.</p>';
  $('#view').innerHTML = magSubbar() + `<div class="panel"><h3>📅 Calendario ordini <span class="muted" style="font-weight:400;font-size:.72rem">· lead time fornitore ${LEAD} gg</span></h3>
    <p class="muted" style="font-size:.78rem">Per far arrivare la merce in tempo, ogni proposta ha una <b>data d'invio consigliata</b> = data di riordino − lead time. Le voci in rosso sono da inviare <b>subito</b>. Le consegne attese sono gli ordini già inviati, in arrivo alla data prevista.</p>
    <div class="row" style="margin-top:8px;gap:8px;align-items:center"><label class="muted" style="font-size:.8rem">Lead time fornitore (giorni)</label><input id="mag_lead" type="number" value="${LEAD}" style="width:80px"><button class="btn ghost sm" id="mag_lead_save">Salva</button></div></div>
    <div class="panel"><h3>📤 Da inviare</h3>${invHtml}</div>
    <div class="panel"><h3>📥 Consegne attese</h3>${conHtml}</div>`;
  $('#mag_lead_save').onclick = async () => { await api('/magazzino/config', { method: 'POST', body: JSON.stringify({ lead_time_giorni: Number($('#mag_lead').value) || 0 }) }); show('magazzino'); };
  document.querySelectorAll('[data-cord]').forEach(b => b.onclick = async () => { const id = b.dataset.cord; const q = Number(($('#cq_' + id) || {}).value); if (!q) { alert('Indica la quantità.'); return; } await api('/magazzino/ordini', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), quantita: q }) }); show('magazzino'); });
  document.querySelectorAll('[data-cric]').forEach(b => b.onclick = async () => { await api('/magazzino/ordini/' + b.dataset.cric + '/ricevi', { method: 'POST', body: '{}' }); show('magazzino'); });
  document.querySelectorAll('[data-cann]').forEach(b => b.onclick = async () => { await api('/magazzino/ordini/' + b.dataset.cann + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
}
// ---- Sub-tab PREVISIONE (Fase 2): ritmo di consumo → data-riordino stimata + proposta d'ordine al fornitore ----
async function magPrevisione() {
  const data = await api('/magazzino/previsione').catch(() => ({ finestra_giorni: 14, articoli: [] }));
  const ordini = await api('/magazzino/ordini?stato=confermato').catch(() => []);
  const N = data.finestra_giorni || 14;
  const arts = data.articoli || [];
  const conStorico = arts.filter(a => !a.senza_storico);
  const rows = conStorico.map(a => {
    // 🔴 solo se c'è davvero da ordinare (urgente E suggerito > 0); 🟡 attenzione se urgente ma già coperto o in avvicinamento; 🟢 ok.
    const badge = (a.urgente && a.suggerito > 0) ? '<span class="tag no">🔴 riordina</span>'
      : (a.urgente || (a.giorni_residui != null && a.giorni_residui <= N * 2)) ? '<span class="tag mid">🟡 attenzione</span>'
      : '<span class="tag ok">🟢 ok</span>';
    return `<tr>
      <td><b>${esc(a.nome)}</b> ${magZonaBadge(a.zona)}</td>
      <td style="text-align:center">${esc(String(a.rate))}<span class="muted" style="font-size:.7rem">/gg</span></td>
      <td style="text-align:center"><b>${esc(String(a.giacenza_effettiva))}</b></td>
      <td style="text-align:center;color:${a.in_arrivo ? 'var(--teal)' : 'var(--muted)'}">${esc(String(a.in_arrivo || 0))}</td>
      <td style="text-align:center">${a.giorni_residui != null ? esc(String(a.giorni_residui)) + ' gg' : '—'}</td>
      <td style="text-align:center">${a.data_riordino ? esc(a.data_riordino) : '—'}</td>
      <td style="text-align:center">${badge}</td>
      <td class="row"><input id="oq_${a.articolo_id}" type="number" value="${a.suggerito || ''}" placeholder="q.tà" style="width:70px"><button class="btn gold sm" data-ord="${a.articolo_id}">✔ Ordina</button></td>
    </tr>`;
  }).join('');
  const senza = arts.filter(a => a.senza_storico).length;
  const ordPanel = `<div class="panel"><h3>🚚 Ordini al fornitore in corso</h3>${ordini.length ? ordini.map(o => `<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span><b>${esc(o.nome)}</b> · ${esc(String(o.quantita))} ${esc(o.unita)}${o.data_prevista ? ` · <span class="muted">arrivo ~${esc(o.data_prevista)}</span>` : ''}</span><div class="row"><button class="btn gold sm" data-oric="${o.id}">📥 Ricevi</button><button class="btn ghost sm" data-oann="${o.id}">Annulla</button></div></div>`).join('') : '<p class="muted">Nessun ordine in corso.</p>'}</div>`;
  $('#view').innerHTML = magSubbar() + `<div class="panel"><h3>🔮 Previsione riordino <span class="muted" style="font-weight:400;font-size:.72rem">· finestra ${N} giorni</span></h3>
    <p class="muted" style="font-size:.78rem">Dal ritmo di consumo degli ultimi <b>${N} giorni</b> stimo quando la giacenza effettiva raggiunge il punto di riordino e propongo una quantità da ordinare al fornitore (già al netto di ciò che è in arrivo). <b>Valida</b> l'ordine con "Ordina": la merce risulterà <b>in arrivo</b> finché non la ricevi (che equivale a un carico del Centrale).</p>
    <div class="row" style="margin-top:8px;gap:8px;align-items:center"><label class="muted" style="font-size:.8rem">Finestra (giorni)</label><input id="mag_fin" type="number" value="${N}" style="width:80px"><button class="btn ghost sm" id="mag_fin_save">Salva</button></div></div>
    <div class="panel"><table><thead><tr><th>Articolo</th><th>Ritmo</th><th>Disp.eff</th><th>In arrivo</th><th>Residui</th><th>Data riordino</th><th></th><th>Ordine fornitore</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">Nessun articolo con storico di consumo. Registra qualche scarico per attivare la previsione.</td></tr>'}</tbody></table>
    ${senza ? `<p class="muted" style="font-size:.74rem;margin-top:8px">${senza} articoli senza consumi nella finestra non compaiono (nessun ritmo da stimare).</p>` : ''}</div>` + ordPanel;
  $('#mag_fin_save').onclick = async () => { await api('/magazzino/config', { method: 'POST', body: JSON.stringify({ finestra_giorni: Number($('#mag_fin').value) || 14 }) }); show('magazzino'); };
  document.querySelectorAll('[data-ord]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ord; const q = Number(($('#oq_' + id) || {}).value);
    if (!q) { alert('Indica la quantità da ordinare.'); return; }
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
  const alert = `<div class="panel"><div class="row" style="gap:10px">
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Da riordinare</div><div style="font-size:1.5rem;font-weight:800;color:${r.da_riordinare ? 'var(--coral)' : 'var(--navy)'}">${r.da_riordinare || 0}</div></div>
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">In esaurimento</div><div style="font-size:1.5rem;font-weight:800;color:${r.in_esaurimento ? 'var(--gold)' : 'var(--navy)'}">${r.in_esaurimento || 0}</div></div>
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Articoli</div><div style="font-size:1.5rem;font-weight:800;color:var(--navy)">${r.totale || 0}</div></div>
    <div style="flex:1;min-width:120px"><div class="muted" style="font-size:.72rem">Impegni attivi</div><div style="font-size:1.5rem;font-weight:800;color:${impegni.length ? 'var(--gold)' : 'var(--navy)'}">${impegni.length}</div></div></div>
    <p class="muted" style="font-size:.76rem;margin-top:8px">La merce è <b>unica</b> e sta qui al Centrale. La <b>zona</b> di un articolo è solo un'abilitazione (chi può usarlo). Bar e Garden non hanno scorta propria: vedono la disponibilità in sola lettura, scaricano i consumi (che scendono da qui) e possono <b>impegnare</b> merce. <b>Giac.</b> = fisica · <b>Imp.</b> = impegnata · <b>Eff.</b> = effettiva (Giac. − Imp.), il numero che fa scattare il riordino.</p></div>`;
  const ricPanel = `<div class="panel"><h3>📌 Impegni in corso <span class="muted" style="font-weight:400;font-size:.72rem">(merce prenotata dalle zone, non ancora consumata)</span></h3>${impegni.length ? impegni.map(x => `<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span>${x.zona === 'bar' ? '🍸' : '🌿'} <b>${esc(x.nome)}</b> · ${esc(String(x.quantita))} ${esc(x.unita)} impegnati per ${esc(x.zona)}</span><button class="btn ghost sm" data-evno="${x.id}">Rilascia</button></div>`).join('') : '<p class="muted">Nessun impegno attivo.</p>'}</div>`;
  const areeOrdine = [...new Set([...MAG_AREE.map(a => a[0]), ...(data.aree || [])])];
  const perArea = areeOrdine.map(area => {
    const arts = (data.articoli || []).filter(a => a.area === area); if (!arts.length) return '';
    const rows = arts.map(a => `<tr>
      <td><b>${esc(a.nome)}</b></td><td>${magZonaBadge(a.zona)}</td><td>${esc(a.unita)}</td><td style="text-align:center"><b>${esc(String(a.giacenza))}</b></td><td style="text-align:center;color:${a.impegno ? 'var(--gold)' : 'var(--muted)'}">${esc(String(a.impegno || 0))}</td><td style="text-align:center"><b>${esc(String(a.giacenza_effettiva))}</b></td><td>${magBadge(a.stato)}</td>
      <td class="row"><input id="mq_${a.id}" type="number" placeholder="q.tà" style="width:64px"><button class="btn gold sm" data-mv="${a.id}|carico">+ Carico</button><button class="btn ghost sm" data-mv="${a.id}|scarico">− Scarico</button><button class="btn ghost sm" data-mv="${a.id}|rettifica">= Rettifica</button></td>
    </tr>`).join('');
    return `<div class="panel"><h3>${esc(magAreaLabel(area))}</h3><table><thead><tr><th>Articolo</th><th>Zona</th><th>Unità</th><th>Giac.</th><th>Imp.</th><th>Eff.</th><th>Stato</th><th>Movimento</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  const areaOpts = MAG_AREE.map(a => `<option value="${a[0]}">${esc(a[1])}</option>`).join('');
  const imp = `<div class="panel"><h3>⬆️ Caricamento magazzino (master) da Excel/CSV</h3>
    <p class="muted" style="font-size:.82rem;margin-bottom:8px">Un solo file alimenta il Centrale. Colonne (in qualsiasi ordine): <b>nome</b>, <b>area</b>, <b>zona</b> (<b>bar</b>/<b>garden</b>/<b>comune</b>), <b>unita</b>, <b>giacenza</b>, <b>riordino</b>, <b>preavviso</b>. La zona rende l'articolo disponibile ai sotto-magazzini Bar/Garden (comune = entrambi).</p>
    <div class="row"><input type="file" id="mimp_file" accept=".xlsx,.xls,.csv"><button class="btn ghost sm" id="mimp_tpl">↓ Scarica modello CSV</button><button class="btn ghost sm" id="mimp_exp">⬇️ Esporta magazzino (Excel)</button></div>
    <p class="muted" style="font-size:.78rem;margin-top:6px">Esporta lo stato attuale in un Excel nello stesso formato: lo modifichi (anche la colonna <b>zona</b>) e lo ricarichi qui.</p>
    <div id="mimp_prev" style="margin-top:10px"></div></div>`;
  const nuovo = `<div class="panel"><h3>+ Nuovo articolo</h3><div class="row">
    <input id="ma_n" placeholder="Nome" style="min-width:160px"><select id="ma_a">${areaOpts}</select>
    <select id="ma_z"><option value="bar">🍸 Bar</option><option value="garden">🌿 Garden</option><option value="carta">📚 Casa di Carta</option><option value="comune">🔁 Comune (a tutte le zone)</option></select>
    <input id="ma_u" value="pz" style="width:70px"><input id="ma_g" type="number" placeholder="Giac." style="width:90px"><input id="ma_pr" type="number" placeholder="Riordino" style="width:100px"><input id="ma_pa" type="number" placeholder="Preavviso" style="width:100px">
    <button class="btn gold sm" id="ma_add">+ Aggiungi</button></div></div>`;
  $('#view').innerHTML = magSubbar() + alert + ricPanel + imp + (perArea || '<div class="panel"><p class="muted">Nessun articolo.</p></div>') + nuovo;
  document.querySelectorAll('[data-evno]').forEach(b => b.onclick = async () => { await api('/magazzino/richieste/' + b.dataset.evno + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
  $('#mimp_tpl').onclick = () => {
    const csv = 'nome,area,zona,unita,giacenza,riordino,preavviso\nBicchieri di carta,chiosco,comune,pz,300,100,150\nBirra media,chiosco,bar,pz,60,24,40\nSalsiccia,chiosco,garden,kg,10,3,5\nCapsule caffè,casa di carta,comune,capsule,120,50,80\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'modello_magazzino.csv'; a.click();
  };
  $('#mimp_exp').onclick = () => esporta('/magazzino/export');
  const magToB64 = (f) => new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).replace(/^data:[^,]*,/, '')); rd.onerror = rej; rd.readAsDataURL(f); });
  $('#mimp_file').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    $('#mimp_prev').innerHTML = '<p class="muted">Leggo il file…</p>';
    try {
      const b64 = await magToB64(f);
      const dry = await api('/magazzino/import', { method: 'POST', body: JSON.stringify({ fileB64: b64, dryRun: true }) });
      const preview = (dry.anteprima || []).map(x => `<tr><td>${esc(x.nome)}</td><td>${esc(x.area)}</td><td>${esc(x.zona)}</td><td>${esc(x.unita)}</td><td>${esc(String(x.giacenza))}</td><td>${esc(String(x.punto_riordino))}</td><td>${esc(String(x.soglia_preavviso))}</td></tr>`).join('');
      $('#mimp_prev').innerHTML = `<p class="muted" style="font-size:.82rem">Trovate <b>${dry.totale}</b> righe. Anteprima:</p>
        <table><thead><tr><th>Nome</th><th>Area</th><th>Zona</th><th>Unità</th><th>Giac.</th><th>Riordino</th><th>Preavviso</th></tr></thead><tbody>${preview}</tbody></table>
        <div class="row" style="margin-top:8px"><label><input type="checkbox" id="mimp_repl"> sostituisci l'intero magazzino</label><button class="btn gold" id="mimp_go">Importa ${dry.totale} righe</button></div>`;
      $('#mimp_go').onclick = async () => { const res = await api('/magazzino/import', { method: 'POST', body: JSON.stringify({ fileB64: b64, mode: $('#mimp_repl').checked ? 'replace' : 'merge' }) }); alert(`Import completato: ${res.creati} creati, ${res.aggiornati} aggiornati.`); show('magazzino'); };
    } catch (err) { $('#mimp_prev').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  };
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = async () => { const [id, tipo] = b.dataset.mv.split('|'); const q = Number(($('#mq_' + id) || {}).value); if (!($('#mq_' + id).value)) { alert('Indica la quantità.'); return; } await api('/magazzino/' + id + '/movimento', { method: 'POST', body: JSON.stringify({ tipo, quantita: q }) }); show('magazzino'); });
  $('#ma_add').onclick = async () => { if (!$('#ma_n').value) { alert('Nome?'); return; } await api('/magazzino', { method: 'POST', body: JSON.stringify({ nome: $('#ma_n').value, area: $('#ma_a').value, zona: $('#ma_z').value, unita: $('#ma_u').value || 'pz', giacenza: Number($('#ma_g').value || 0), punto_riordino: Number($('#ma_pr').value || 0), soglia_preavviso: Number($('#ma_pa').value || 0) }) }); show('magazzino'); };
}
// ---- Sub-tab BAR/GARDEN nel hub: sola lettura delle giacenze di zona + richieste (con Evadi) ----
async function magHubZona(zona) {
  const data = await api('/magazzino/zona/' + zona).catch(() => ({ articoli: [], riepilogo: {} }));
  const impegni = await api('/magazzino/richieste?zona=' + zona + '&stato=impegnata').catch(() => []);
  const rank = { da_riordinare: 0, in_esaurimento: 1, ok: 2 };
  const arts = (data.articoli || []).slice().sort((a, b) => (rank[a.stato] - rank[b.stato]) || String(a.nome).localeCompare(String(b.nome)));
  // I prodotti "core" della zona stanno sopra; sotto, separata da una riga, la merce comune
  // a tutte le zone: e' roba di appoggio, non il cuore di questo punto.
  const core = arts.filter(a => (a.zona_art || a.zona) !== 'comune');
  const comuni = arts.filter(a => (a.zona_art || a.zona) === 'comune');
  const riga = (a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.unita)}</td><td style="text-align:center"><b>${esc(String(a.giacenza))}</b></td><td style="text-align:center;color:${a.impegno_zona ? 'var(--gold)' : 'var(--muted)'}">${esc(String(a.impegno_zona || 0))}</td><td>${magBadge(a.stato)}</td></tr>`;
  const separatore = (core.length && comuni.length)
    ? `<tr><td colspan="5" style="border-top:2px solid var(--accent);padding-top:8px;font-size:.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Comune a tutte le zone</td></tr>`
    : '';
  const rows = core.map(riga).join('') + separatore + comuni.map(riga).join('');
  const ZLAB = { bar: '🍸 Bar', garden: '🌿 Garden', carta: '📚 Casa di Carta' };
  $('#view').innerHTML = magSubbar() + `<div class="panel"><h3>${ZLAB[zona] || esc(zona)} · disponibilità <span class="muted" style="font-weight:400;font-size:.72rem">(sola lettura dal Centrale · merce unica)</span></h3>
    <p class="muted" style="font-size:.74rem"><b>Disp.</b> = giacenza effettiva del Centrale (fisica − impegni) per gli articoli abilitati a questa zona. <b>Imp.</b> = quanto ha impegnato questa zona.</p>
    <table><thead><tr><th>Articolo</th><th>Unità</th><th>Disp.</th><th>Imp.</th><th>Stato</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Nessun articolo.</td></tr>'}</tbody></table></div>
    <div class="panel"><h3>📌 Impegni di questa zona</h3>${impegni.length ? impegni.map(x => `<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span><b>${esc(x.nome)}</b> · ${esc(String(x.quantita))} ${esc(x.unita)}</span><button class="btn ghost sm" data-evno="${x.id}">Rilascia</button></div>`).join('') : '<p class="muted">Nessun impegno attivo.</p>'}</div>`;
  document.querySelectorAll('[data-evno]').forEach(b => b.onclick = async () => { await api('/magazzino/richieste/' + b.dataset.evno + '/annulla', { method: 'POST', body: '{}' }); show('magazzino'); });
}

/* ---------- GIACENZE DI ZONA (Bar/Garden): sotto-magazzino operativo — scarico + richiesta di carico ---------- */
VIEWS.scorte = async () => {
  const zona = ZONA === 'cdc' ? 'carta' : ZONA;
  const zonaLabel = { bar: '🍸 Bar', garden: '🌿 Garden', carta: '📚 Casa di Carta' }[zona] || zona;
  const render = async () => {
    const data = await api('/magazzino/zona/' + zona).catch(() => ({ articoli: [], riepilogo: {} }));
    const impegni = await api('/magazzino/richieste?zona=' + zona + '&stato=impegnata').catch(() => []);
    const r = data.riepilogo || {}; const arts = data.articoli || [];
    const rank = { da_riordinare: 0, in_esaurimento: 1, ok: 2 };
    arts.sort((a, b) => (rank[a.stato] - rank[b.stato]) || String(a.nome).localeCompare(String(b.nome)));
    // Prima i prodotti core della zona, poi — sotto una linea — la merce comune.
    const ordinati = [...arts.filter(a => (a.zona_art || a.zona) !== 'comune'), ...arts.filter(a => (a.zona_art || a.zona) === 'comune')];
    const primoComune = arts.filter(a => (a.zona_art || a.zona) !== 'comune').length;
    const rows = ordinati.map((a, i) => `${(i === primoComune && primoComune > 0 && i < ordinati.length) ? `<tr><td colspan="6" style="border-top:2px solid var(--accent);padding-top:8px;font-size:.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Comune a tutte le zone</td></tr>` : ''}<tr>
      <td><b>${esc(a.nome)}</b></td><td>${esc(a.unita)}</td><td style="text-align:center"><b>${esc(String(a.giacenza))}</b></td>
      <td style="text-align:center;color:${a.impegno_zona ? 'var(--gold)' : 'var(--muted)'}">${esc(String(a.impegno_zona || 0))}</td>
      <td>${magBadge(a.stato)}</td>
      <td class="row"><input id="gq_${a.articolo_id}" type="number" placeholder="q.tà" style="width:64px"><button class="btn ghost sm" data-gsc="${a.articolo_id}">− Scarico</button><button class="btn gold sm" data-grc="${a.articolo_id}">📌 Impegna</button></td>
    </tr>`).join('');
    const ric = impegni.map(x => `<div class="row" style="justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f0efe8"><span><b>${esc(x.nome)}</b> · ${esc(String(x.quantita))} ${esc(x.unita)} impegnati</span><button class="btn ghost sm" data-gann="${x.id}">Rilascia</button></div>`).join('');
    $('#view').innerHTML = `<div class="panel"><h3>📊 Giacenze · ${zonaLabel} <span class="muted" style="font-weight:400;font-size:.72rem;margin-left:6px">· merce unica al Centrale, qui in sola lettura</span></h3>
      <p class="muted" style="font-size:.76rem">La merce è una sola, al Centrale. <b>Disp.</b> = giacenza effettiva (fisica − impegni). A fine servizio <b>scarica</b> le quantità usate: scendono dal Centrale. Puoi <b>impegnare</b> merce per il tuo servizio: la prenoti senza spostarla (riduce la disponibilità per l'altra zona). Lo scarico libera l'impegno corrispondente.</p>
      <div class="row" style="gap:10px;margin-top:6px">
        <div style="flex:1;min-width:110px"><div class="muted" style="font-size:.72rem">Da riordinare</div><div style="font-size:1.4rem;font-weight:800;color:${r.da_riordinare ? 'var(--coral)' : 'var(--navy)'}">${r.da_riordinare || 0}</div></div>
        <div style="flex:1;min-width:110px"><div class="muted" style="font-size:.72rem">In esaurimento</div><div style="font-size:1.4rem;font-weight:800;color:${r.in_esaurimento ? 'var(--gold)' : 'var(--navy)'}">${r.in_esaurimento || 0}</div></div>
        <div style="flex:1;min-width:110px"><div class="muted" style="font-size:.72rem">Articoli</div><div style="font-size:1.4rem;font-weight:800;color:var(--navy)">${r.totale || 0}</div></div></div></div>
      <div class="panel"><table><thead><tr><th>Articolo</th><th>Unità</th><th>Disp.</th><th>Imp.</th><th>Stato</th><th>Scarico / Impegna</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Nessun articolo per questa zona.</td></tr>'}</tbody></table></div>
      ${impegni.length ? `<div class="panel"><h3>📌 Impegni in corso</h3>${ric}</div>` : ''}`;
    const q = (id) => Number(($('#gq_' + id) || {}).value);
    document.querySelectorAll('[data-gsc]').forEach(b => b.onclick = async () => { const id = b.dataset.gsc; if (!q(id)) { alert('Indica la quantità.'); return; } await api('/magazzino/zona/' + zona + '/scarico', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), quantita: q(id) }) }); render(); });
    document.querySelectorAll('[data-grc]').forEach(b => b.onclick = async () => { const id = b.dataset.grc; if (!q(id)) { alert('Indica la quantità da impegnare.'); return; } await api('/magazzino/richieste', { method: 'POST', body: JSON.stringify({ articolo_id: Number(id), zona, quantita: q(id) }) }); render(); });
    document.querySelectorAll('[data-gann]').forEach(b => b.onclick = async () => { await api('/magazzino/richieste/' + b.dataset.gann + '/annulla', { method: 'POST', body: '{}' }); render(); });
  };
  await render();
};

/* ---------- MENÙ (config + import Excel/CSV) ---------- */
let IMPORT_B64 = null;
// Menù stampabile (PDF via "Salva come PDF" del browser) con logo, punto vendita, categorie, composizione, allergeni.
function stampaMenuPDF(menu, punto, qr, zona) {
  const attivi = (menu || []).filter(m => m.attivo);
  // Stesso raggruppamento e ordine della comanda: un solo vettore, niente "scalini" tra PDF e ordini.
  const catOf = (window.Comanda && Comanda.catOf) ? Comanda.catOf : (m => m.categoria || (m.stazione === 'cucina' ? 'Cucina' : 'Bar'));
  const sortCats = (window.Comanda && Comanda.sortCats) ? Comanda.sortCats : (a => a.slice());
  // (11) Ordine per PUNTO di stampa: prima i prodotti del punto di stampa (+ i 'comune'), poi la
  //      complementare. Il punto è il campo menù `zona` (bar/garden/comune), distinto dalla stazione.
  const primaria = zona === 'bar' ? 'bar' : 'garden';
  const puntoOf = (m) => (m.zona === 'garden' || m.zona === 'comune') ? m.zona : 'bar';
  const inPrim = (m) => { const z = puntoOf(m); return z === primaria || z === 'comune'; };
  const primItems = attivi.filter(inPrim);
  const complItems = attivi.filter(m => !inPrim(m));
  const logo = `<svg width="46" height="46" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="none" stroke="#E0B44A" stroke-width="3"/><path d="M24 6 L29 24 L24 42 L19 24 Z" fill="#E0B44A"/><path d="M6 24 L24 19 L42 24 L24 29 Z" fill="#12324F" opacity="0.85"/></svg>`;
  const renderCat = (cat, items) => `<section><h2>${esc(cat)}</h2>${items.map(m => `
    <div class="item"><div class="line"><span class="nm">${esc(m.nome)}</span><span class="dots"></span><span class="pz">${eur(m.prezzo)}</span></div>
    ${m.descrizione ? `<div class="desc">${esc(m.descrizione)}</div>` : ''}
    ${m.allergeni ? `<div class="alg">Allergeni: ${esc(m.allergeni)}</div>` : ''}</div>`).join('')}</section>`;
  const blockCats = (items) => { const g = {}; items.forEach(m => { const k = catOf(m); (g[k] = g[k] || []).push(m); }); return sortCats(Object.keys(g)).map(c => renderCat(c, g[c])).join(''); };
  const macro = (titolo, items) => items.length ? `<div class="zona"><div class="zonahd">${esc(titolo)}</div>${blockCats(items)}</div>` : '';
  const labelBar = '🍸 Bussola Bar', labelGarden = '🍽️ Bussola Garden';
  const primLabel = zona === 'bar' ? labelBar : labelGarden;
  const complLabel = zona === 'bar' ? labelGarden : labelBar;
  const body = (macro(primLabel, primItems) + macro(complLabel, complItems)) || '<p>Nessun articolo attivo.</p>';
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare.'); return; }
  w.document.write(`<html><head><title>Menù · ${esc(punto)}</title><style>
    /* (10) A4 con margini simmetrici → contenuto sempre centrato sul foglio */
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
    <header>${logo}<div class="t"><h1>BUSSOLA RESIDENCE</h1></div><div class="punto">${esc(punto)}</div></header>
    ${body}
    ${qr && qr.svg ? `<div class="qr">${qr.svg}<div class="qrcap">${esc(qr.caption || '')}</div></div>` : ''}
    <footer>Allergeni indicati secondo Reg. UE 1169/2011.</footer>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
  </body></html>`);
  w.document.close();
}

VIEWS.menu = async () => {
  const menu = await api('/menu');
  // L'avviso non si va a cercare: se qualcosa non torna, sta in cima al listino. Nel caso
  // reale i condimenti erano SPENTI e nessuno poteva accorgersene guardando i panini.
  const dg = await api('/menu/diagnosi').catch(() => ({ problemi: [] }));
  const avviso = (dg.problemi || []).length
    ? `<div class="panel" style="border-left:4px solid #C0553F;background:#fdf1e7">
        <b style="color:#8a3a2a">\u26a0\ufe0f Il men\u00f9 non funziona come dovrebbe</b>
        ${dg.problemi.map(x => `<div style="margin-top:4px;font-size:.88rem">${esc(x)}</div>`).join('')}
        <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="menu_diag2">\ud83e\ude7a Apri la diagnosi</button></div>
      </div>` : '';
  const rows = menu.map(m => `<tr>
    <td><input id="mn_n_${m.id}" value="${esc(m.nome)}" style="min-width:140px"></td>
    <td><input id="mn_p_${m.id}" type="number" step="0.01" inputmode="decimal" value="${esc(String(m.prezzo))}" style="width:74px"${m.e_condimento ? ` title="Quanto costa condire: questo prezzo si paga una volta sola, che il cliente scelga un condimento o quattro."` : ''}>
      ${m.e_condimento ? `<div class="muted" style="font-size:.66rem">condire costa ${eur(m.supplemento || 0)}</div>` : ''}</td>
    <td><select id="mn_s_${m.id}"><option value="bar" ${m.stazione === 'bar' ? 'selected' : ''}>Bar</option><option value="cucina" ${m.stazione === 'cucina' ? 'selected' : ''}>Cucina</option></select></td>
    <td><select id="mn_z_${m.id}"><option value="bar" ${(m.zona || 'bar') === 'bar' ? 'selected' : ''}>🍸 Bar</option><option value="garden" ${m.zona === 'garden' ? 'selected' : ''}>🍽️ Garden</option><option value="comune" ${m.zona === 'comune' ? 'selected' : ''}>🔁 Entrambi</option></select></td>
    <td><input id="mn_c_${m.id}" value="${esc(m.categoria || '')}" style="width:110px"></td>
    <td><input id="mn_al_${m.id}" value="${esc(m.allergeni || '')}" style="width:150px" placeholder="glutine, latte…"></td>
    <td style="text-align:center"><input type="checkbox" id="mn_a_${m.id}" ${m.attivo ? 'checked' : ''}></td>
    <td style="text-align:center"><input type="checkbox" data-mnalc="${m.id}" ${m.alcolico ? 'checked' : ''} title="Bevanda alcolica: sotto i 18 anni non si serve, e senza tessera la comanda avvisa chi consegna"></td>
    <td style="text-align:center"><input type="checkbox" data-mncond="${m.id}" ${m.con_condimenti ? 'checked' : ''} title="Dentro questo prodotto compare la riga «condimenti» da fleggare"></td>
    <td style="text-align:center"><input type="checkbox" data-mncomp="${m.id}" ${m.e_condimento ? 'checked' : ''} ${m.e_condimento && !m.complemento ? 'title="Lo è per via della categoria «' + esc(m.categoria || '') + '»: per toglierlo cambia categoria"' : 'title="È un\'aggiunta: si spunta dentro i piatti, non si ordina da sola"'}></td>
    <td class="row"><button class="btn danger sm" data-del="${m.id}">🗑</button></td>
  </tr>`).join('');
  $('#view').innerHTML = avviso + `
    <div class="panel"><h3>⬆️ Importa menù da Excel/CSV</h3>
      <p class="muted" style="font-size:.82rem;margin-bottom:8px">Colonne riconosciute (in qualsiasi ordine): <b>nome</b>, <b>prezzo</b>, <b>stazione</b> (cucina/bar), <b>punto</b>, <b>categoria</b>, <b>descrizione</b>, <b>allergeni</b>, <b>attivo</b>, <b>alcolico</b>, <b>condimenti</b>, <b>complemento</b> (questi quattro come s\u00ec/no). L'intestazione pu\u00f2 essere scritta come viene: \u201cPrezzo (\u20ac)\u201d o \u201cPREZZO unitario\u201d vanno bene. \u00c8 lo stesso foglio che esce da <b>Esporta men\u00f9</b>: si corregge nel foglio e si rimette dentro. Puoi caricare un file solo-prezzi o solo-allergeni: i campi mancanti non vengono sovrascritti.</p>
      <div class="row"><input type="file" id="imp_file" accept=".xlsx,.xls,.csv"><button class="btn ghost sm" id="imp_tpl">↓ Scarica modello CSV</button><button class="btn ghost sm" id="menu_exp">⬇️ Esporta menù (Excel)</button></div>
      <div id="imp_prev" style="margin-top:10px"></div></div>
    <div class="panel"><h3>🖨️ Stampa menù (PDF)</h3>
      <p class="muted" style="font-size:.82rem;margin-bottom:8px">Genera un menù stampabile (o “Salva come PDF”) con il logo della Bussola, categorie, descrizione/composizione e allergeni. Include solo gli articoli attivi. Stampa e comanda usano lo <b>stesso</b> raggruppamento. In fondo viene stampato ${ZONA === 'bar' ? 'il <b>QR dell\'app Bussola</b>' : 'il <b>QR per ordinare dal tavolo</b>'}.</p>
      <div class="row"><span class="muted" style="font-size:.85rem">Punto: <b>${ZONA === 'bar' ? 'Bussola Bar' : 'Bussola Garden'}</b> (dalla zona della postazione)</span><button class="btn gold sm" id="menu_pdf">🖨️ Stampa / salva PDF</button></div>
      <p class="muted" style="font-size:.82rem;margin:10px 0 6px">Se hai caricato un menù senza colonna <b>categoria</b>, il sistema la deduce dal nome (Caffetteria, Bibite, Birre…). Le categorie impostate a mano non vengono toccate.</p>
      <div class="row"><button class="btn ghost sm" id="menu_diag">\ud83e\ude7a Diagnosi del men\u00f9</button><button class="btn ghost sm" id="menu_recat">🏷️ Ricategorizza automaticamente</button><button class="btn ghost sm" id="menu_punto">🍸🍽️ Deduci Punto (Bar/Garden)</button><button class="btn ghost sm" id="menu_cross">🍳 Da preparare, in entrambi i punti</button></div>
      <p class="muted" style="font-size:.78rem;margin-top:6px">"Deduci Punto" assegna a ogni prodotto il punto vendita (Bar o Garden) da nome/categoria: utile per smistare al volo un menù caricato tutto come "bar". Poi correggi i casi particolari nella colonna <b>Punto</b>.</p>
      
      <p class="muted" style="font-size:.78rem;margin-top:6px">"Da preparare, in entrambi i punti" serve ai prodotti che richiedono una lavorazione e si vendono sia al Bar sia al Garden (panini, fritti, gelati sfusi): li segna <i>Cucina</i> + <i>Entrambi</i> in un colpo solo. Scegli tu le categorie: il resto del menù non si tocca.</p></div>
    <div class="panel"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">🍔 Menù del chiosco</h3>
        <div class="row" style="gap:8px;align-items:center">
          <span class="muted" id="menu_tocchi" style="font-size:.82rem"></span>
          <button class="btn gold" id="menu_salva">💾 Salva le modifiche</button>
        </div>
      </div>
      <p class="muted" style="font-size:.8rem;margin-bottom:8px">Ogni prodotto porta due informazioni indipendenti: <b>Chi lo prepara</b> (banco o cucina — è quello che smista al KDS) e <b>Dove si vende</b> (Bar, Garden o entrambi). Un panino lo fa la cucina ma si vende in tutti e due i punti: <i>Cucina</i> + <i>Entrambi</i>. <b>🔞</b> = bevanda alcolica: sotto i 18 anni non si serve, e a chi ordina senza tessera la comanda ricorda di verificare l'età. <b>Condimenti</b> = dentro questo prodotto compare la riga «condimenti», con le aggiunte da fleggare. Mettila sui panini e sui piatti: è questa spunta a decidere, niente altro. <b>Compl.</b> = questa voce <i>è</i> un'aggiunta (maionese, insalata): sparisce dall'elenco e diventa una delle caselle. Il <b>prezzo delle aggiunte</b> e' quanto costa condire: si paga <b>una volta sola</b>, che il cliente ne scelga una o quattro. Lo decidi tu — un euro per condire e' una scelta commerciale, non un tecnicismo. Se le aggiunte hanno prezzi diversi vale il piu' alto; a zero condire e' gratis.</p>
      <table><thead><tr><th>Nome</th><th>Prezzo</th><th>Chi prepara</th><th>Dove si vende</th><th>Categoria</th><th>Allergeni</th><th>Attivo</th><th>🔞</th><th>Condimenti</th><th>Compl.</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="muted">Nessun articolo. Importa o aggiungi.</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:10px"><input id="mn_new_n" placeholder="Nome" style="min-width:150px"><input id="mn_new_p" type="number" step="0.01" inputmode="decimal" placeholder="Prezzo" style="width:90px"><select id="mn_new_s"><option value="bar">Bar</option><option value="cucina">Cucina</option></select><select id="mn_new_z"><option value="bar">🍸 Bar</option><option value="garden">🍽️ Garden</option><option value="comune">🔁 Entrambi</option></select><input id="mn_new_c" placeholder="Categoria" style="width:120px"><button class="btn gold sm" id="mn_add">+ Aggiungi</button></div></div>`;

  // salvataggi riga
  // Niente piu' un salvataggio per ogni riga e per ogni spunta: le modifiche si accumulano
  // qui e si scrivono tutte insieme con "Salva le modifiche". Con duecento righe, un tasto per
  // riga vuol dire duecento clic e duecento occasioni di dimenticarsene una.
  const TOCCHI = new Map();
  const segna = (id, campo, valore) => {
    const r = TOCCHI.get(Number(id)) || { id: Number(id) };
    r[campo] = valore;
    TOCCHI.set(Number(id), r);
    const t = $('#menu_tocchi');
    if (t) t.textContent = `${TOCCHI.size} ${TOCCHI.size === 1 ? 'riga modificata' : 'righe modificate'} \u2014 non ancora salvate`;
  };
  // Il cestino era rimasto senza handler: si premeva e non succedeva niente. Cancellare un
  // prodotto passa comunque dal controllo referenziale, che si oppone se e' in una comanda
  // aperta — quindi il messaggio del server va mostrato, non ingoiato.
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const nome = ($('#mn_n_' + b.dataset.del) || {}).value || 'questo articolo';
    if (!confirm(`Eliminare \u201c${nome}\u201d dal listino?`)) return;
    try { await api('/menu/' + b.dataset.del, { method: 'DELETE' }); }
    catch (e) { alert(e.message); return; }
    show('menu');
  });
  document.querySelectorAll('[data-mnalc]').forEach(c => c.onchange = () => segna(c.dataset.mnalc, 'alcolico', c.checked));
  document.querySelectorAll('[data-mncond]').forEach(c => c.onchange = () => segna(c.dataset.mncond, 'con_condimenti', c.checked));
  document.querySelectorAll('[data-mncomp]').forEach(c => c.onchange = () => segna(c.dataset.mncomp, 'complemento', c.checked));
  // Anche i campi scritti: si segnano quando si esce dalla casella.
  for (const [pref, campo, conv] of [['mn_n_', 'nome', String], ['mn_p_', 'prezzo', Number], ['mn_c_', 'categoria', String], ['mn_al_', 'allergeni', String]]) {
    document.querySelectorAll(`[id^="${pref}"]`).forEach(el => el.onchange = () => segna(el.id.slice(pref.length), campo, conv(el.value)));
  }
  document.querySelectorAll('[id^="mn_s_"]').forEach(el => el.onchange = () => segna(el.id.slice(5), 'stazione', el.value));
  document.querySelectorAll('[id^="mn_z_"]').forEach(el => el.onchange = () => segna(el.id.slice(5), 'zona', el.value));
  document.querySelectorAll('[id^="mn_a_"]').forEach(el => el.onchange = () => segna(el.id.slice(5), 'attivo', el.checked));
  if ($('#menu_salva')) $('#menu_salva').onclick = async () => {
    if (!TOCCHI.size) { alert('Non c\u2019\u00e8 niente da salvare.'); return; }
    const r = await api('/menu', { method: 'PUT', body: JSON.stringify({ righe: [...TOCCHI.values()] }) });
    alert(`Salvate ${r.salvati} righe.`);
    show('menu');
  };
  $('#menu_cross').onclick = async () => {
    const d = await api('/menu/cross-cucina', { method: 'POST', body: '{}' });
    openModal(`<h3 style="margin-top:0">🍳 Da preparare, in entrambi i punti</h3>
      <p class="muted" style="font-size:.82rem">Scegli le categorie dei prodotti che richiedono una lavorazione e si vendono sia al Bar sia al Garden. Diventano <b>Cucina</b> + <b>Entrambi</b>: si ordinano da tutti e due i punti e la riga arriva sempre al KDS Cucina. Le altre categorie non si toccano.</p>
      <div style="max-height:44vh;overflow:auto;margin:10px 0">${(d.categorie || []).map(c => `<label style="display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid #f0ede4">
        <input type="checkbox" data-xcat="${esc(c)}" style="width:20px;height:20px"><span>${esc(c)}</span></label>`).join('') || '<p class="muted">Nessuna categoria a menù.</p>'}</div>
      <div class="row"><button class="btn gold" id="cross_go">Applica</button><button class="btn ghost" data-mclose>Annulla</button></div>`);
    $('#cross_go').onclick = async () => {
      const cats = [...document.querySelectorAll('[data-xcat]')].filter(x => x.checked).map(x => x.dataset.xcat);
      if (!cats.length) { alert('Scegli almeno una categoria.'); return; }
      let r;
      try { r = await api('/menu/cross-cucina', { method: 'POST', body: JSON.stringify({ categorie: cats }) }); }
      catch (e) {
        // Il server si ferma se fra le categorie scelte c'e' roba da banco: si spiega e si
        // lascia decidere, invece di mandare il caffe' al KDS Cucina in silenzio.
        if (!/si servono al banco/i.test(e.message || '')) { alert(e.message); return; }
        if (!confirm(e.message + '\n\nProcedo lo stesso?')) return;
        r = await api('/menu/cross-cucina', { method: 'POST', body: JSON.stringify({ categorie: cats, forza: true }) });
      }
      alert(`${r.aggiornati} prodotti ora sono Cucina + Entrambi.` + (r.nomi && r.nomi.length ? '\n\n· ' + r.nomi.join('\n· ') : ''));
      closeModal(); show('menu');
    };
  };
  $('#menu_pdf').onclick = async () => {
    const punto = ZONA === 'bar' ? 'Bussola Bar' : 'Bussola Garden';
    let qr = null;
    try {
      if (ZONA === 'bar') {
        const d = await api('/pwa-qr'); const soci = (d.items || []).find(x => x.scope === 'soci');
        if (soci) qr = { svg: soci.svg, caption: '📲 Inquadra per l’app Bussola' };
      } else {
        const d = await api('/qr-ordina?punto=' + encodeURIComponent(punto)); // senza tavolo: /ordina chiederà il numero
        qr = { svg: d.svg, caption: '📱 Inquadra e ordina dal tuo tavolo' };
      }
    } catch (_) {}
    // Si stampa quello che si ordina davvero: stesso elenco del socio, condimenti esclusi
    // (sono una spunta dentro il piatto, non una voce del menu' stampato).
    const daStampare = await api('/menu?ordinabile=1&zona=' + (ZONA === 'bar' ? 'bar' : 'garden'));
    stampaMenuPDF(daStampare, punto, qr, ZONA);
  };
  // La diagnosi legge i dati veri e dice cosa non torna, invece di lasciare indovinare.
  $('#menu_diag').onclick = async () => {
    const d = await api('/menu/diagnosi');
    const riga = (k, v) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${k}</span><b>${v}</b></div>`;
    const verdetto = d.problemi.length
      ? `<div style="background:#fdf1e7;border-left:4px solid #C0553F;padding:10px 12px;border-radius:0 8px 8px 0;margin-bottom:10px">${d.problemi.map(p => `<div>\u26a0\ufe0f ${esc(p)}</div>`).join('')}</div>`
      : `<div style="background:#eaf3ec;border-left:4px solid #2e6b45;padding:10px 12px;border-radius:0 8px 8px 0;margin-bottom:10px">\u2705 Il men\u00f9 \u00e8 a posto: i condimenti si spuntano dentro i piatti e i piatti si ordinano da tutti e due i punti.</div>`;
    openModal(`<h3 style="margin-top:0">\ud83e\ude7a Diagnosi del men\u00f9</h3>
      ${verdetto}
      ${riga('Voci a listino', d.totale + ' (' + d.attivi + ' attive, ' + d.spenti + ' spente)')}
      ${riga('Condimenti riconosciuti', d.condimenti.length ? esc(d.condimenti.join(', ')) : '\u2014')}
      ${d.condimenti_spenti.length ? riga('Condimenti SPENTI', esc(d.condimenti_spenti.join(', '))) : ''}
      ${riga('Piatti preparati dalla cucina', d.piatti_cucina)}
      ${riga('Prodotti del banco', d.prodotti_banco)}
      ${riga('Si ordinano al Bar', d.ordinabili_al_bar)}
      ${riga('Si ordinano al Garden', d.ordinabili_al_garden)}
      ${d.esempio ? `<p class="muted" style="font-size:.82rem;margin-top:10px">Esempio: in <b>${esc(d.esempio.nome)}</b> il socio trova ${d.esempio.complementi.length ? esc(d.esempio.complementi.join(', ')) : 'nessuna aggiunta'}.</p>` : ''}
      <p class="muted" style="font-size:.78rem">Categorie a men\u00f9: ${esc(d.categorie.join(' \u00b7 ')) || '\u2014'}</p>
      <div class="row" style="margin-top:10px">${(d.incoerenze || []).length ? '<button class="btn gold sm" id="diag_fix">\ud83d\udd27 Rimetti a posto \u201cChi prepara\u201d</button>' : ''}<button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
    const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal;
    // Riparazione con anteprima: prima si vede cosa cambierebbe, poi si decide.
    if ($('#diag_fix')) $('#diag_fix').onclick = async () => {
      const pre = await api('/menu/ricalcola-stazione', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
      if (!pre.cambierebbero) { alert('Non c\'\u00e8 niente da correggere.'); return; }
      const righe = pre.elenco.slice(0, 25).map(x => `\u00b7 ${x.nome} (${x.categoria}): ${x.ora} \u2192 ${x.dovrebbe}`).join('\n');
      if (!confirm(`Cambierebbero ${pre.cambierebbero} prodotti:\n\n${righe}${pre.elenco.length > 25 ? '\n\u2026 e altri ' + (pre.elenco.length - 25) : ''}\n\nProcedo?`)) return;
      const r = await api('/menu/ricalcola-stazione', { method: 'POST', body: '{}' });
      alert(`Corretti ${r.corretti} prodotti. Ricontrolla la colonna \u201cChi prepara\u201d: le eccezioni si sistemano a mano.`);
      closeModal(); show('menu');
    };
  };
  $('#menu_recat').onclick = async () => { const r = await api('/menu/ricategorizza', { method: 'POST', body: '{}' }); alert(`Categorizzati ${r.categorizzati} articoli senza categoria.`); show('menu'); };
  $('#menu_punto').onclick = async () => { if (!confirm('Assegnare il Punto (Bar/Garden) a tutti gli articoli in base a nome/categoria? Le scelte manuali verranno ricalcolate.')) return; const r = await api('/menu/deduci-punto', { method: 'POST', body: '{}' }); alert(`Punto assegnato: ${r.garden} Garden, ${r.bar} Bar. Rivedi i casi particolari nella colonna Punto.`); show('menu'); };

  // template CSV
  $('#menu_exp').onclick = () => esporta('/menu/export');
  $('#imp_tpl').onclick = () => {
    const csv = 'nome,prezzo,stazione,categoria,descrizione,allergeni\nPanino salsiccia,4.5,cucina,panini,Salsiccia alla griglia,glutine\nBirra media,4,bar,birre,Bionda alla spina,glutine\nAcqua 0.5L,1,bar,bibite,Naturale,\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'modello_menu.csv'; a.click();
  };
  // import: il file va al server (parsing xlsx/csv lato server) → anteprima (dryRun) → conferma
  const fileToB64 = (f) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = reject; r.readAsDataURL(f); });
  $('#imp_file').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    $('#imp_prev').innerHTML = '<p class="muted">Leggo il file…</p>';
    try {
      IMPORT_B64 = await fileToB64(f);
      const dry = await api('/menu/import', { method: 'POST', body: JSON.stringify({ fileB64: IMPORT_B64, dryRun: true }) });
      const preview = (dry.anteprima || []).map(r => `<tr><td>${esc(r.nome)}</td><td>${esc(String(r.prezzo))}</td><td>${esc(r.stazione)}</td><td>${esc(r.categoria)}</td><td>${esc(r.allergeni)}</td></tr>`).join('');
      $('#imp_prev').innerHTML = `<p class="muted" style="font-size:.82rem">Trovate <b>${dry.totale}</b> righe. Anteprima:</p>
        <table><thead><tr><th>Nome</th><th>Prezzo</th><th>Staz.</th><th>Categoria</th><th>Allergeni</th></tr></thead><tbody>${preview}</tbody></table>
        <div class="row" style="margin-top:8px"><label><input type="checkbox" id="imp_repl"> sostituisci l'intero menù</label><button class="btn gold" id="imp_go">Importa ${dry.totale} righe</button></div>`;
      $('#imp_go').onclick = async () => {
        const invia = (forza) => api('/menu/import', { method: 'POST', body: JSON.stringify({ fileB64: IMPORT_B64, mode: $('#imp_repl').checked ? 'replace' : 'merge', forza }) });
        try {
          const res = await invia(false);
          alert(`Import completato: ${res.creati} creati, ${res.aggiornati} aggiornati.`); show('menu');
        } catch (e) {
          // Il server rifiuta di azzerare il listino se ci sono comande aperte: si spiega
          // perche', e si lascia al gestore la scelta, invece di fare danno in silenzio.
          if (!/comande ancora aperte/i.test(e.message || '')) { alert(e.message); return; }
          if (!confirm(e.message + '\n\nProcedo lo stesso?')) return;
          const res = await invia(true);
          alert(`Import completato: ${res.creati} creati, ${res.aggiornati} aggiornati.`); show('menu');
        }
      };
    } catch (err) { $('#imp_prev').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  };
};

/* ---------- TENNIS & BEACH: i campi che si pagano ----------
   Non sono i campi del chiosco. Qui si affitta e si fa lezione privata, con un listino proprio
   e un incasso proprio: chi li gestisce vede la giornata, chi ha pagato e chi no, e tiene il
   suo tariffario senza passare dal gestore dell'app. */
VIEWS.tennis = async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const data = window.__tennisData || oggi;
  const [campi, giornata, blocchi] = await Promise.all([
    api('/tennis/campi').catch(() => []),
    api('/tennis/giornata?data=' + data).catch(() => ({ righe: [], incassato: 0, da_incassare: 0 })),
    api('/tennis/blocchi?data=' + data).catch(() => [])
  ]);

  // Chi sta al banco per il gestore non vede i soldi: il server non glieli manda, e la
  // schermata non deve mostrarne il posto vuoto. Un "Incassato € 0,00" a chi non ha diritto di
  // saperlo e' peggio del silenzio: sembra un dato, ed e' un buco.
  const vedeSoldi = giornata && Object.prototype.hasOwnProperty.call(giornata, 'incassato');

  // ---- la giornata: chi gioca, quanto deve, chi ha pagato ----
  const riga = (r) => `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1">
        <b>${esc(r.slot)} · ${esc(r.campo)}</b>${r.tipo_uso === 'lezione' ? ' <span class="tag" style="background:#1d4e79;color:#fff">lezione</span>' : ''}
        <div class="muted" style="font-size:.82rem">${esc(r.nome || r.tessera_code || '—')}</div>
      </div>
      <div style="text-align:right;min-width:150px">
        ${!vedeSoldi ? ''
          : Number(r.prezzo) > 0
            ? `<b>${eur(r.prezzo)}</b> <button class="btn ${r.pagato ? 'ghost' : 'gold'} sm" data-tenpag="${r.id}|${r.pagato ? 0 : 1}">${r.pagato ? '✓ incassato' : '💶 incassa'}</button>`
            : '<span class="muted">gratuito</span>'}
        <button class="btn danger sm" data-tendisd="${r.partita_id || ''}">Disdici</button>
      </div></div>`;

  // ---- la scheda di un campo: la stessa configurazione del back office, qui dentro ----
  const scheda = (c) => `<div class="panel"><div class="row" style="justify-content:space-between;align-items:center">
      <h3 style="margin:0">${esc(c.nome)} ${c.attivo ? '' : '<span class="tag" style="background:#999;color:#fff">spento</span>'}</h3>
      ${vedeSoldi ? `<button class="btn ghost sm" data-tenedit="${c.id}">⚙︎ Configura</button>` : ''}
    </div>
    <div class="muted" style="font-size:.82rem">${esc(c.sport || '')} · ${esc(c.apertura)}–${esc(c.chiusura)} · fascia ${c.durata_slot}′ · ${c.posti_default} posti · max ${c.max_slot_prenotazione} fasce di fila</div>
    ${!vedeSoldi ? '' : `<div style="margin-top:8px"><b style="font-size:.9rem">Listino</b>
      ${(c.listino || []).length
        ? (c.listino || []).map(t => `<div class="row" style="justify-content:space-between;font-size:.85rem;padding:2px 0">
            <span>${esc(t.etichetta)}${t.da_ora ? ` <span class="muted">(${esc(t.da_ora)}–${esc(t.a_ora || '')})</span>` : ''}${t.tipo_uso === 'lezione' ? ' <span class="muted">· lezione</span>' : ''}</span>
            <span><b>${eur(t.prezzo_ora)}</b>/h <button class="btn ghost sm" data-tendel="${t.id}">✕</button></span></div>`).join('')
        : '<p class="muted" style="font-size:.82rem">Nessuna tariffa: senza listino questo campo resta gratuito.</p>'}
    </div>
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
      <input id="tt_e_${c.id}" placeholder="Nome (es. sera)" style="min-width:120px">
      <input id="tt_da_${c.id}" placeholder="dalle" style="width:70px">
      <input id="tt_a_${c.id}" placeholder="alle" style="width:70px">
      <select id="tt_t_${c.id}"><option value="campo">campo</option><option value="lezione">lezione privata</option></select>
      <input id="tt_p_${c.id}" type="number" step="0.5" placeholder="€/ora" style="width:80px">
      <button class="btn gold sm" data-tenadd="${c.id}">+ Tariffa</button>
    </div>`}</div>`;

  $('#view').innerHTML = `
    <div class="panel"><h3>🎾 La giornata</h3>
      <p class="muted" style="font-size:.82rem">${vedeSoldi
        ? 'I tuoi campi: tennis, beach tennis, beach volley. Si affittano e si paga — il listino lo tieni tu.'
        : 'I campi in gestione: tennis, beach tennis, beach volley. Qui prenoti, disdici e blocchi.'}</p>
      <div class="row" style="gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap">
        <input type="date" id="ten_data" value="${data}">
        ${vedeSoldi
          ? `<span class="muted">Incassato <b>${eur(giornata.incassato || 0)}</b> · da incassare <b style="color:${(giornata.da_incassare || 0) > 0 ? '#b14a35' : 'inherit'}">${eur(giornata.da_incassare || 0)}</b>${giornata.quanti_da_incassare ? ` (${giornata.quanti_da_incassare})` : ''}</span>`
          : `<span class="muted" style="font-size:.82rem">${esc(giornata.nota || 'Gli incassi li vede chi gestisce il servizio.')}</span>`}
      </div>
      ${(giornata.righe || []).length ? (giornata.righe || []).map(riga).join('') : '<p class="muted">Nessuna prenotazione per questa data.</p>'}
    </div>

    <div class="panel"><h3>🎫 Prenota al banco</h3>
      <p class="muted" style="font-size:.82rem">Serve la tessera del socio: resta lui il titolare. Il prezzo lo calcola il listino.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select id="tp_campo">${campi.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
        <input id="tp_slot" placeholder="18:00" style="width:80px">
        <input id="tp_tess" placeholder="Tessera socio" style="min-width:150px">
        <select id="tp_uso"><option value="campo">campo</option><option value="lezione">lezione privata</option></select>
        <button class="btn gold sm" id="ten_pren">Prenota</button>
      </div></div>

    <div class="panel"><h3>🚧 Campo indisponibile</h3>
      <p class="muted" style="font-size:.82rem">Manutenzione, torneo, lezioni tutto il pomeriggio, o semplicemente oggi non lo affitti.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select id="tb_campo">${campi.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
        <input id="tb_da" value="09:00" style="width:70px"> – <input id="tb_a" value="22:00" style="width:70px">
        <select id="tb_m"><option value="manutenzione">manutenzione</option><option value="torneo">torneo</option><option value="lezioni">lezioni</option><option value="chiuso">chiuso</option></select>
        <button class="btn gold sm" id="ten_blocca">+ Blocca</button>
      </div>
      ${(blocchi || []).length ? (blocchi || []).map(b => `<div class="row" style="justify-content:space-between;font-size:.85rem;padding:4px 0;border-bottom:1px solid var(--line)">
        <span>${esc(b.campo)} · ${esc(b.dalle)}–${esc(b.alle)} · ${esc(b.motivo || '')}</span>
        <button class="btn ghost sm" data-tenblkdel="${b.id}">✕</button></div>`).join('')
        : '<p class="muted" style="font-size:.82rem;margin-top:6px">Nessun blocco per questa data.</p>'}
    </div>

    ${campi.map(scheda).join('')}

    ${!vedeSoldi ? '' : `<div class="panel"><h3>➕ Nuovo campo</h3>
      <p class="muted" style="font-size:.82rem">I campi dell'area tennis si creano <b>qui</b>, non nel back office del residence: là ci sono i campi gratuiti del chiosco, che hanno regole diverse. Appena creato, il socio lo vede nell'app.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <input id="nc_nome" placeholder="Nome del campo" style="min-width:160px">
        <select id="nc_sport"><option value="tennis">tennis</option><option value="beach tennis">beach tennis</option><option value="volley">beach volley</option></select>
        <input id="nc_ap" value="08:00" style="width:70px"> – <input id="nc_ch" value="22:00" style="width:70px">
        <input id="nc_slot" type="number" value="60" style="width:70px" title="durata della fascia in minuti">
        <input id="nc_posti" type="number" value="4" style="width:64px" title="posti">
        <button class="btn gold sm" id="ten_new">+ Crea campo</button>
      </div></div>`}`;

  $('#ten_data').onchange = () => { window.__tennisData = $('#ten_data').value; show('tennis'); };

  if ($('#ten_new')) $('#ten_new').onclick = async () => {
    const corpo = {
      nome: ($('#nc_nome').value || '').trim(), sport: $('#nc_sport').value,
      apertura: $('#nc_ap').value, chiusura: $('#nc_ch').value,
      durata_slot: Number($('#nc_slot').value) || 60, posti_default: Number($('#nc_posti').value) || 4
    };
    if (!corpo.nome) { alert('Dai un nome al campo.'); return; }
    try { await api('/tennis/campi', { method: 'POST', body: JSON.stringify(corpo) }); }
    catch (e) { alert(e.message); return; }
    show('tennis');
  };

  // Configurazione completa di un campo: la stessa del back office, ma sui campi suoi.
  document.querySelectorAll('[data-tenedit]').forEach(b => b.onclick = () => {
    const c = campi.find(x => String(x.id) === String(b.dataset.tenedit));
    if (!c) return;
    openModal(`<h3 style="margin-top:0">⚙︎ ${esc(c.nome)}</h3>
      <div class="grid2" style="gap:8px">
        <label>Nome<input id="cf_nome" value="${esc(c.nome)}"></label>
        <label>Sport<input id="cf_sport" value="${esc(c.sport || '')}"></label>
        <label>Apre<input id="cf_ap" value="${esc(c.apertura)}"></label>
        <label>Chiude<input id="cf_ch" value="${esc(c.chiusura)}"></label>
        <label>Durata fascia (min)<input id="cf_slot" type="number" value="${c.durata_slot}"></label>
        <label>Posti<input id="cf_posti" type="number" value="${c.posti_default}"></label>
        <label>Fasce di fila<input id="cf_max" type="number" value="${c.max_slot_prenotazione}"></label>
        <label>Minimo giocatori<input id="cf_min" type="number" value="${c.min_giocatori}"></label>
        <label>Non prima delle<input id="cf_oramin" value="${esc(c.ora_min || '')}" placeholder="vuoto = sempre"></label>
        <label>Prezzo base €/ora<input id="cf_prezzo" type="number" step="0.5" value="${Number(c.prezzo_ora || 0)}"></label>
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="cf_attivo" ${c.attivo ? 'checked' : ''}> Campo attivo (spento non compare nell'app)</label>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn gold sm" id="cf_salva">Salva</button>
        <button class="btn danger sm" id="cf_del">🗑 Elimina</button>
        <button class="btn ghost sm" data-mclose>Chiudi</button>
      </div>`);
    $('#cf_salva').onclick = async () => {
      try {
        await api('/tennis/campi/' + c.id, { method: 'PUT', body: JSON.stringify({
          nome: $('#cf_nome').value, sport: $('#cf_sport').value,
          apertura: $('#cf_ap').value, chiusura: $('#cf_ch').value,
          durata_slot: Number($('#cf_slot').value), posti_default: Number($('#cf_posti').value),
          max_slot_prenotazione: Number($('#cf_max').value), min_giocatori: Number($('#cf_min').value),
          ora_min: $('#cf_oramin').value, prezzo_ora: Number($('#cf_prezzo').value),
          attivo: $('#cf_attivo').checked
        }) });
      } catch (e) { alert(e.message); return; }
      closeModal(); show('tennis');
    };
    $('#cf_del').onclick = async () => {
      if (!confirm(`Eliminare ${c.nome}? Se ci sono prenotazioni non si può: si spegne.`)) return;
      try { await api('/tennis/campi/' + c.id, { method: 'DELETE' }); }
      catch (e) { alert(e.message); return; }
      closeModal(); show('tennis');
    };
  });

  $('#ten_pren').onclick = async () => {
    const corpo = {
      campo_id: Number($('#tp_campo').value), data,
      slot: $('#tp_slot').value, tessera_code: ($('#tp_tess').value || '').trim(),
      tipo_uso: $('#tp_uso').value
    };
    if (!corpo.tessera_code) { alert('Serve la tessera del socio: resta lui il titolare.'); return; }
    try { const r = await api('/tennis/prenota', { method: 'POST', body: JSON.stringify(corpo) }); alert(r.prezzo > 0 ? `Prenotato · ${eur(r.prezzo)} da incassare.` : 'Prenotato.'); }
    catch (e) { alert(e.message); return; }
    show('tennis');
  };
  $('#ten_blocca').onclick = async () => {
    try {
      await api('/tennis/blocchi', { method: 'POST', body: JSON.stringify({
        campo_id: Number($('#tb_campo').value), data,
        dalle: $('#tb_da').value, alle: $('#tb_a').value, motivo: $('#tb_m').value
      }) });
    } catch (e) { alert(e.message); return; }
    show('tennis');
  };
  document.querySelectorAll('[data-tenblkdel]').forEach(b => b.onclick = async () => {
    await api('/tennis/blocchi/' + b.dataset.tenblkdel, { method: 'DELETE' });
    show('tennis');
  });
  document.querySelectorAll('[data-tenpag]').forEach(b => b.onclick = async () => {
    const [id, v] = b.dataset.tenpag.split('|');
    await api('/tennis/prenotazioni/' + id + '/pagato', { method: 'PUT', body: JSON.stringify({ pagato: v === '1' }) });
    show('tennis');
  });
  document.querySelectorAll('[data-tendisd]').forEach(b => b.onclick = async () => {
    if (!b.dataset.tendisd) { alert('Prenotazione senza partita collegata.'); return; }
    if (!confirm('Disdire questa prenotazione? Il campo torna libero.')) return;
    try { await api('/campi/partite/' + b.dataset.tendisd + '/annulla', { method: 'POST', body: '{}' }); }
    catch (e) { alert(e.message); return; }
    show('tennis');
  });
  document.querySelectorAll('[data-tenadd]').forEach(b => b.onclick = async () => {
    const id = b.dataset.tenadd;
    try {
      await api('/tennis/campi/' + id + '/tariffe', { method: 'POST', body: JSON.stringify({
        etichetta: ($('#tt_e_' + id) || {}).value || '',
        da_ora: ($('#tt_da_' + id) || {}).value || '',
        a_ora: ($('#tt_a_' + id) || {}).value || '',
        tipo_uso: ($('#tt_t_' + id) || {}).value || 'campo',
        prezzo_ora: Number(($('#tt_p_' + id) || {}).value || 0)
      }) });
    } catch (e) { alert(e.message); return; }
    show('tennis');
  });
  document.querySelectorAll('[data-tendel]').forEach(b => b.onclick = async () => {
    if (!confirm('Togliere questa tariffa?')) return;
    await api('/tennis/tariffe/' + b.dataset.tendel, { method: 'DELETE' });
    show('tennis');
  });
};

/* ---------- SPIAGGIA: piazzole e ombrelloni ----------
   Sulle piazzole non c'e' nessuno della crew. Questo modulo non "gestisce" la spiaggia: la
   guarda da lontano, sistema un disallineamento quando qualcuno segnala, e chiude una piazzola
   quando tira vento. Tutto il resto dipende dal fatto che la gente dichiari e rilasci — ed e'
   il motivo per cui l'intera gestione ha un interruttore per spegnerla. */
VIEWS.beach = async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const data = window.__beachData || oggi;
  const fascia = window.__beachFascia || '';
  const d = await api('/spiaggia?data=' + data + (fascia ? '&fascia=' + fascia : '')).catch(() => null);
  if (!d) { $('#view').innerHTML = '<div class="panel"><p class="muted">Spiaggia non disponibile.</p></div>'; return; }

  // IL COLORE DICE QUANTO MANCA, non da quanto sono li'. Chi guarda la piazzola vuole sapere
  // dove si liberera' qualcosa fra poco: e' l'unica cosa che serve a chi aspetta.
  const COLORI = {
    libero:        { bg: '#eaf3ec', bd: '#2e6b45', tx: '#1f4a30', et: 'libero' },
    inizio:        { bg: '#fdf1e7', bd: '#d98324', tx: '#8a5214', et: 'inizio fascia' },
    seconda_meta:  { bg: '#f3e9df', bd: '#8a5a2b', tx: '#5c3a18', et: 'seconda metà' },
    in_scadenza:   { bg: '#fdecea', bd: '#b14a35', tx: '#8a2a20', et: 'ultima mezz’ora' },
    scaduto:       { bg: '#fdecea', bd: '#b14a35', tx: '#8a2a20', et: 'scaduto' },
    occupato:      { bg: '#f3e9df', bd: '#8a5a2b', tx: '#5c3a18', et: 'occupato' },
    bloccato:      { bg: '#eceff1', bd: '#90a4ae', tx: '#546e7a', et: 'piazzola chiusa' }
  };

  const omb = (o) => {
    const c = COLORI[o.stato_uso] || COLORI.libero;
    const alert = o.non_rilasciato;
    return `<button data-ombsel="${o.id}" title="${esc(o.preso_da || c.et)}"
      style="width:52px;height:52px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;
             background:${alert ? '#fdecea' : c.bg};border:${alert ? '3px' : '2px'} solid ${alert ? '#b14a35' : c.bd};color:${c.tx};font-size:.72rem;font-weight:700;padding:0">
      <span style="font-size:.9rem">${o.numero}</span>
      ${alert ? '<span style="font-size:.55rem;font-weight:900;color:#b14a35">NON RESO</span>'
        : o.minuti_alla_fine != null && o.stato_uso !== 'libero' ? `<span style="font-size:.55rem;font-weight:600">${o.minuti_alla_fine}′</span>` : ''}
    </button>`;
  };

  const legenda = Object.entries(COLORI).filter(([k]) => ['libero', 'inizio', 'seconda_meta', 'in_scadenza'].includes(k))
    .map(([, c]) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:.74rem;margin-right:10px">
      <span style="width:12px;height:12px;border-radius:3px;background:${c.bg};border:2px solid ${c.bd};display:inline-block"></span>${c.et}</span>`).join('') +
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:.74rem"><span style="width:12px;height:12px;border-radius:3px;background:#fdecea;border:3px solid #b14a35;display:inline-block"></span><b style="color:#b14a35">non reso a fine fascia</b></span>`;

  $('#view').innerHTML = `
    <div class="panel"><h3>⛱️ Piazzole</h3>
      <p class="muted" style="font-size:.82rem">Sulle piazzole non c'è nessuno di noi: qui si guarda la situazione, si sistema un disallineamento e si chiude una piazzola quando tira vento. Il resto dipende da chi dichiara e da chi rilascia.</p>
      <div class="row" style="gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <input type="date" id="be_data" value="${data}">
        ${(d.fasce || []).map(f => `<button class="btn ${f.fascia === d.fascia ? 'gold' : 'ghost'} sm" data-befascia="${f.fascia}">${f.fascia} ${esc(f.da)}–${esc(f.a)}${f.in_corso ? ' · in corso' : ''}</button>`).join('')}
      </div>
      <div style="margin-top:10px">${legenda}</div></div>

    ${d.piazzole.map(p => `<div class="panel">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">${esc(p.nome)} <span class="muted" style="font-weight:400;font-size:.82rem">· ${p.occupati}/${p.totale} occupati${p.larghezza_m ? ` · ${p.larghezza_m}×${p.profondita_m} m` : ' · <b style="color:#b14a35">misure mancanti</b>'}</span></h3>
        <div class="row" style="gap:6px">
          <button class="btn ghost sm" data-beverifica="${p.id}">📐 Ci stanno?</button>
          <button class="btn ghost sm" data-beconf="${p.id}">⚙︎ Misure</button>
        </div>
      </div>
      ${p.bloccata ? `<div style="background:#fdecea;border-left:4px solid #b14a35;border-radius:0 8px 8px 0;padding:8px 10px;margin:8px 0">
        <b style="color:#8a2a20">Chiusa · ${esc(p.bloccata.motivo)}</b>${p.bloccata.nota ? ' — ' + esc(p.bloccata.nota) : ''}</div>` : ''}
      ${p.ombrelloni.length
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${p.ombrelloni.map(omb).join('')}</div>`
        : `<p class="muted" style="font-size:.82rem;margin-top:6px">${p.larghezza_m ? 'Nessun ombrellone: aggiungili qui sotto.' : 'Prima le misure: senza, non si sa se gli ombrelloni ci stanno.'}</p>`}
      <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <input id="be_n_${p.id}" type="number" min="1" max="40" value="6" style="width:70px">
        <button class="btn ghost sm" data-beadd="${p.id}" ${p.larghezza_m ? '' : 'disabled title="Prima le misure"'}>+ Ombrelloni</button>
        ${p.ombrelloni.length ? `<button class="btn ghost sm" data-besvuota="${p.id}">🗑 Svuota</button>` : ''}
        <select id="be_m_${p.id}"><option value="vento">vento</option><option value="marea">marea</option><option value="manutenzione">manutenzione</option></select>
        <button class="btn danger sm" data-beblocca="${p.id}">Chiudi la piazzola oggi</button>
      </div></div>`).join('')}`;

  $('#be_data').onchange = () => { window.__beachData = $('#be_data').value; show('beach'); };
  document.querySelectorAll('[data-befascia]').forEach(b => b.onclick = () => { window.__beachFascia = b.dataset.befascia; show('beach'); });

  // Toccare un ombrellone: e' il gesto che mancava. Da qui si assegna al banco chi non ha
  // l'app, si libera chi non c'e' piu', si toglie un ombrellone messo per sbaglio.
  const tutti = d.piazzole.flatMap(p => p.ombrelloni.map(o => ({ ...o, piazzola: p.nome })));
  document.querySelectorAll('[data-ombsel]').forEach(b => b.onclick = () => {
    const o = tutti.find(x => String(x.id) === String(b.dataset.ombsel));
    if (!o) return;
    openModal(`<h3 style="margin-top:0">⛱️ ${esc(o.piazzola)} · ombrellone ${o.numero}</h3>
      <p class="muted" style="font-size:.84rem">${o.libero ? 'Libero.' : `Preso da <b>${esc(o.preso_da || '—')}</b>${o.minuti_alla_fine != null ? ` · mancano ${o.minuti_alla_fine} minuti` : ''}`}${o.non_rilasciato ? ' · <b style="color:#b14a35">non reso a fine fascia</b>' : ''}</p>
      ${o.libero ? `<div class="field"><label>Assegna al banco (per chi non ha l'app)</label>
        <input id="ob_tess" placeholder="Tessera del socio">
        <button class="btn gold block" style="margin-top:8px" data-obassegna="${o.id}">Assegna</button></div>` : ''}
      ${o.presa_id ? `<button class="btn ghost block" style="margin-top:8px" data-oblibera="${o.presa_id}">Libera l'ombrellone</button>` : ''}
      ${o.libero ? `<button class="btn danger block" style="margin-top:8px" data-obtogli="${o.id}">🗑 Togli questo ombrellone</button>` : ''}
      <button class="btn ghost block" style="margin-top:8px" data-mclose>Chiudi</button>`);
    const b1 = $('#mbox').querySelector('[data-obassegna]');
    if (b1) b1.onclick = async () => {
      const t = ($('#ob_tess').value || '').trim();
      if (!t) { alert('Serve la tessera del socio.'); return; }
      try { await api('/spiaggia/assegna', { method: 'POST', body: JSON.stringify({ tessera_code: t, ombrellone_id: o.id, fascia: d.fascia }) }); }
      catch (e) { alert(e.message); return; }
      closeModal(); show('beach');
    };
    const b2 = $('#mbox').querySelector('[data-oblibera]');
    if (b2) b2.onclick = async () => {
      if (!confirm('Liberare questo ombrellone? Fallo solo se sei sicuro che non ci sia più nessuno: sulla piazzola non c\'è nessuno di noi a controllare.')) return;
      await api('/spiaggia/prese/' + o.presa_id + '/chiudi', { method: 'PUT', body: JSON.stringify({ motivo: 'liberato dal banco' }) });
      closeModal(); show('beach');
    };
    const b3 = $('#mbox').querySelector('[data-obtogli]');
    if (b3) b3.onclick = async () => {
      if (!confirm('Togliere l\'ombrellone ' + o.numero + '?')) return;
      try { await api('/spiaggia/ombrelloni/' + o.id, { method: 'DELETE' }); }
      catch (e) { alert(e.message); return; }
      closeModal(); show('beach');
    };
  });

  document.querySelectorAll('[data-beadd]').forEach(b => b.onclick = async () => {
    const q = Number(($('#be_n_' + b.dataset.beadd) || {}).value) || 1;
    try { await api('/spiaggia/piazzole/' + b.dataset.beadd + '/ombrelloni', { method: 'POST', body: JSON.stringify({ quanti: q }) }); }
    catch (e) { alert(e.message); return; }
    show('beach');
  });
  document.querySelectorAll('[data-besvuota]').forEach(b => b.onclick = async () => {
    if (!confirm('Togliere tutti gli ombrelloni di questa piazzola?')) return;
    try { await api('/spiaggia/piazzole/' + b.dataset.besvuota + '/ombrelloni', { method: 'DELETE' }); }
    catch (e) { alert(e.message); return; }
    show('beach');
  });
  document.querySelectorAll('[data-beblocca]').forEach(b => b.onclick = async () => {
    const motivo = ($('#be_m_' + b.dataset.beblocca) || {}).value || 'vento';
    if (!confirm('Chiudere la piazzola per ' + motivo + '? Nessuno potrà prendere un ombrellone.')) return;
    await api('/spiaggia/blocchi', { method: 'POST', body: JSON.stringify({ piazzola_id: Number(b.dataset.beblocca), data, motivo }) });
    show('beach');
  });
  document.querySelectorAll('[data-beconf]').forEach(b => b.onclick = () => {
    const p = d.piazzole.find(x => String(x.id) === String(b.dataset.beconf));
    openModal(`<h3 style="margin-top:0">⚙︎ ${esc(p.nome)}</h3>
      <p class="muted" style="font-size:.82rem">Misure, file e colonne: servono a disegnare la piazzola come le altre piante. Il numero di ombrelloni però lo decidi tu guardando la spiaggia — alberi, docce e passaggi non li conosce nessuna formula.</p>
      <div class="grid2" style="gap:8px">
        <label>Nome<input id="bp_nome" value="${esc(p.nome)}"></label>
        <label>Larghezza (m)<input id="bp_l" type="number" step="0.5" value="${p.larghezza_m ?? ''}"></label>
        <label>Profondità (m)<input id="bp_p" type="number" step="0.5" value="${p.profondita_m ?? ''}"></label>
        <label>File<input id="bp_f" type="number" min="1" value="${p.file ?? ''}" placeholder="dalle misure"></label>
        <label>Colonne<input id="bp_c" type="number" min="1" value="${p.colonne ?? ''}" placeholder="dalle misure"></label>
      </div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn gold sm" id="bp_salva">Salva</button>
        <button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
    $('#bp_salva').onclick = async () => {
      await api('/spiaggia/piazzole/' + p.id, { method: 'PUT', body: JSON.stringify({
        nome: $('#bp_nome').value,
        larghezza_m: Number($('#bp_l').value) || null, profondita_m: Number($('#bp_p').value) || null,
        file: Number($('#bp_f').value) || null, colonne: Number($('#bp_c').value) || null
      }) });
      closeModal(); show('beach');
    };
  });
  document.querySelectorAll('[data-beverifica]').forEach(b => b.onclick = async () => {
    const v = await api('/spiaggia/piazzole/' + b.dataset.beverifica + '/verifica').catch(() => null);
    if (!v) return;
    if (v.misure_mancanti) { alert(v.nota); return; }
    const ok = !v.problemi.length;
    openModal(`<h3 style="margin-top:0">📐 ${esc(v.piazzola)}</h3>
      <div style="background:${ok ? '#eaf3ec' : '#fdecea'};border-left:5px solid ${ok ? '#2e6b45' : '#b14a35'};border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px">
        <b style="color:${ok ? '#2e6b45' : '#8a2a20'}">${esc(v.verdetto)}</b>
        ${v.problemi.map(x => `<div style="margin-top:4px">· ${esc(x)}</div>`).join('')}</div>
      <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>Piazzola</span><b>${v.misure.larghezza_m} × ${v.misure.profondita_m} m · ${v.misure.mq} m²</b></div>
      <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>Ombrelloni disposti</span><b>${v.disposti}</b></div>
      <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>Ce ne stanno (indicativo)</span><b>${v.capienza_indicativa} · ${v.persone} persone</b></div>
      <p class="muted" style="font-size:.78rem;margin-top:8px">${esc(v.nota)} Il conto usa ${v.regole.ingombro_m} m di ingombro e ${v.regole.passaggio_m} m di passaggio.</p>
      <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
  });
};

/* ---------- TORNEI A ELIMINAZIONE DIRETTA ----------
   Altra cosa dalla Coppa delle Casate: qui si gioca una sera, si perde e si va a casa. Il
   tabellone e' 4/8/16/32 perche' a eliminazione diretta ogni turno dimezza: con un numero
   diverso qualcuno arriverebbe in finale avendo giocato una partita in meno. */
VIEWS.tornei = async () => {
  const gest = ZONA === 'tennis' ? 'tennis' : 'chiosco';
  const lista = await api('/tornei?gestione=' + gest).catch(() => []);
  const apertoId = window.__torneoAperto || (lista[0] && lista[0].id);
  const tab = apertoId ? await api('/tornei/' + apertoId).catch(() => null) : null;

  const partita = (p) => `<div class="row" style="justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1;font-size:.9rem">
        ${p.a_nome ? `<b${p.vincitore === p.a_nome ? '' : ' style="font-weight:400"'}>${esc(p.a_nome)}</b>` : '<span class="muted">— in attesa —</span>'}
        <span class="muted"> vs </span>
        ${p.b_nome ? `<b${p.vincitore === p.b_nome ? '' : ' style="font-weight:400"'}>${esc(p.b_nome)}</b>` : '<span class="muted">— in attesa —</span>'}
        ${p.punteggio ? `<span class="muted"> · ${esc(p.punteggio)}</span>` : ''}
      </div>
      ${p.a_nome && p.b_nome && !p.vincitore
        ? `<div class="row" style="gap:4px">
            <input id="pt_${p.id}" placeholder="6-3" style="width:70px;font-size:.85rem">
            <button class="btn ghost sm" data-vince="${p.id}|${esc(p.a_nome)}">${esc(p.a_nome)}</button>
            <button class="btn ghost sm" data-vince="${p.id}|${esc(p.b_nome)}">${esc(p.b_nome)}</button>
          </div>`
        : p.vincitore ? `<span class="tag ok">passa ${esc(p.vincitore)}</span>` : ''}
    </div>`;

  $('#view').innerHTML = `
    <div class="panel"><h3>🏆 Tornei a eliminazione diretta</h3>
      <p class="muted" style="font-size:.82rem">Si gioca una sera: iscrizioni, sorteggio cieco, e avanti fino alla finale. Il tabellone è da <b>4, 8, 16 o 32</b>: a eliminazione diretta ogni turno dimezza, e con un numero diverso qualcuno passerebbe il turno senza giocare.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <input id="nt_nome" placeholder="Nome del torneo" style="min-width:160px">
        <input id="nt_disc" placeholder="Disciplina" style="width:130px">
        <select id="nt_posti"><option>4</option><option>8</option><option>16</option><option>32</option></select>
        <input id="nt_data" type="date">
        <button class="btn gold sm" id="nt_crea">+ Crea torneo</button>
      </div>
      ${lista.length ? `<div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">${lista.map(t => `<button class="btn ${String(t.id) === String(apertoId) ? 'gold' : 'ghost'} sm" data-tsel="${t.id}">${esc(t.nome)} <span class="muted">${t.posti}</span></button>`).join('')}</div>` : ''}
    </div>

    ${tab ? `<div class="panel">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">${esc(tab.torneo.nome)}</h3>
        <span class="tag ${tab.torneo.stato === 'concluso' ? 'ok' : 'mid'}">${esc(tab.torneo.stato)}</span>
      </div>
      ${tab.torneo.vincitore ? `<p style="font-size:1.05rem;margin:8px 0"><b>🏆 ${esc(tab.torneo.vincitore)}</b></p>` : ''}
      ${tab.torneo.stato === 'iscrizioni' ? `
        <p class="muted" style="font-size:.85rem">Iscritti <b>${tab.iscritti.length}</b> su ${tab.torneo.posti}${tab.posti_liberi ? ` · mancano ${tab.posti_liberi}` : ' · il tabellone è pieno'}</p>
        <div style="margin:6px 0">${tab.iscritti.map(i => `<span class="tag" style="margin:2px">${esc(i.nome)} <button class="btn ghost sm" data-tisdel="${i.id}" style="padding:0 4px">✕</button></span>`).join('') || '<span class="muted">Nessun iscritto.</span>'}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <input id="ti_v" placeholder="Nome, oppure tessera" style="min-width:170px">
          <button class="btn ghost sm" id="ti_add">+ Iscrivi</button>
          ${tab.posti_liberi === 0 ? '<button class="btn gold sm" id="ti_sort">🎲 Sorteggia il tabellone</button>' : '<span class="muted" style="font-size:.82rem">Il sorteggio si fa a tabellone pieno.</span>'}
        </div>` : ''}
      ${tab.torneo.stato !== 'iscrizioni' ? tab.turni.map(t => `<div style="margin-top:12px">
        <b style="color:var(--navy)">${esc(t.nome)}</b>
        ${t.partite.map(partita).join('')}</div>`).join('') : ''}
    </div>` : ''}`;

  $('#nt_crea').onclick = async () => {
    const nome = ($('#nt_nome').value || '').trim();
    if (!nome) { alert('Dai un nome al torneo.'); return; }
    try {
      const r = await api('/tornei', { method: 'POST', body: JSON.stringify({
        nome, disciplina: $('#nt_disc').value, posti: Number($('#nt_posti').value),
        data: $('#nt_data').value, gestione: gest
      }) });
      window.__torneoAperto = r.id;
    } catch (e) { alert(e.message); return; }
    show('tornei');
  };
  document.querySelectorAll('[data-tsel]').forEach(b => b.onclick = () => { window.__torneoAperto = b.dataset.tsel; show('tornei'); });
  if ($('#ti_add')) $('#ti_add').onclick = async () => {
    const v = ($('#ti_v').value || '').trim();
    if (!v) { alert('Scrivi il nome, oppure la tessera.'); return; }
    const corpo = /^(RB|BR)-/i.test(v) ? { tessera_code: v.toUpperCase() } : { nome: v };
    try { await api('/tornei/' + apertoId + '/iscritti', { method: 'POST', body: JSON.stringify(corpo) }); }
    catch (e) { alert(e.message); return; }
    show('tornei');
  };
  document.querySelectorAll('[data-tisdel]').forEach(b => b.onclick = async () => {
    await api('/tornei/' + apertoId + '/iscritti/' + b.dataset.tisdel, { method: 'DELETE' });
    show('tornei');
  });
  if ($('#ti_sort')) $('#ti_sort').onclick = async () => {
    if (!confirm('Sorteggiare il tabellone? Il sorteggio è cieco e si fa una volta sola.')) return;
    try { await api('/tornei/' + apertoId + '/sorteggia', { method: 'POST', body: '{}' }); }
    catch (e) { alert(e.message); return; }
    show('tornei');
  };
  document.querySelectorAll('[data-vince]').forEach(b => b.onclick = async () => {
    const i = b.dataset.vince.indexOf('|');
    const id = b.dataset.vince.slice(0, i), chi = b.dataset.vince.slice(i + 1);
    try {
      const r = await api('/tornei/partite/' + id, { method: 'PUT', body: JSON.stringify({
        vincitore: chi, punteggio: (($('#pt_' + id) || {}).value || '').trim()
      }) });
      if (r.finale) alert('🏆 ' + r.vincitore + ' vince il torneo.');
    } catch (e) { alert(e.message); return; }
    show('tornei');
  });
};

/* ---------- REGISTRO STORICO: la memoria lunga, per le contestazioni ---------- */
// Non e' un elenco di log: e' la risposta a "io avevo prenotato", "quel conto non l'ho mai
// fatto", "chi ha cancellato?". Si cerca per persona, periodo, servizio e tipo di fatto, e si
// esporta per allegarlo a una risposta scritta. Si legge soltanto: qui dentro non si modifica
// niente, altrimenti smetterebbe di essere una prova.
var REG_F = { dal: '', al: '', servizio: '', fatto: '', chi: '' };
VIEWS.registro = async () => {
  const q = new URLSearchParams(Object.entries(REG_F).filter(([, v]) => v)).toString();
  const righe = await api('/registro' + (q ? '?' + q : '')).catch(() => []);
  const ETICHETTE = {
    prenotazione_creata: '📗 Prenotazione presa', prenotazione_cancellata: '📕 Prenotazione cancellata',
    prenotazione_modificata: '📙 Prenotazione modificata', servizio_reso: '✅ Servizio reso',
    comanda_aperta: '🧾 Comanda aperta', comanda_chiusa: '💶 Comanda chiusa', comanda_annullata: '🚫 Comanda annullata',
    iscrizione: '📗 Iscrizione', iscrizione_annullata: '📕 Iscrizione annullata',
    comanda_spostata: '➡️ Comanda spostata di tavolo',
    riga_stornata: '↩️ Riga stornata', riga_sostituita: '🔄 Riga sostituita'
  };
  // Se domani si registra un fatto nuovo e ci si dimentica l'etichetta, meglio una parola
  // leggibile che il nome tecnico della colonna: "comanda_spostata" non lo capisce nessuno.
  const etichettaDi = (f) => ETICHETTE[f] || String(f || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const corpo = righe.map(r => {
    let d = '';
    try { d = r.dettaglio ? Object.entries(JSON.parse(r.dettaglio)).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`).join(' · ') : ''; } catch { d = esc(r.dettaglio || ''); }
    return `<tr>
      <td style="white-space:nowrap">${esc((r.ts || '').replace('T', ' ').slice(0, 16))}</td>
      <td>${etichettaDi(r.fatto)}</td>
      <td>${esc(r.servizio)}${r.riferimento ? ' <b>#' + esc(String(r.riferimento)) + '</b>' : ''}</td>
      <td>${esc(r.intestatario || '—')}</td>
      <td>${esc(r.autore || '—')}${r.canale ? ` <span class="muted">(${esc(r.canale)})</span>` : ''}</td>
      <td>${esc(r.quando_servizio || '—')}</td>
      <td style="text-align:right">${r.importo != null ? eur(r.importo) : ''}</td>
      <td class="muted" style="font-size:.78rem">${esc(d)}</td></tr>`;
  }).join('');
  $('#view').innerHTML = `<div class="panel">
      <h3 style="margin-top:0">📚 Registro storico</h3>
      <p class="muted" style="font-size:.82rem">Cosa è successo, quando, a nome di chi e <b>chi lo ha chiesto</b>. Si conserva quindici anni e non si modifica: una prenotazione disdetta aggiunge una riga, non ne corregge una. Serve davanti a una contestazione sul servizio o sul conto.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin:10px 0">
        <label>Dal<br><input type="date" id="rg_dal" value="${esc(REG_F.dal)}"></label>
        <label>Al<br><input type="date" id="rg_al" value="${esc(REG_F.al)}"></label>
        <label>Servizio<br><select id="rg_serv">
          <option value="">tutti</option>
          ${['garden', 'campi', 'fitness', 'stage', 'cdc', 'coworking', 'comande'].map(x => `<option ${REG_F.servizio === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select></label>
        <label>Fatto<br><select id="rg_fatto">
          <option value="">tutti</option>
          ${Object.keys(ETICHETTE).map(k => `<option value="${k}" ${REG_F.fatto === k ? 'selected' : ''}>${etichettaDi(k).replace(/^\S+ /, '')}</option>`).join('')}
        </select></label>
        <label>Nome o numero<br><input id="rg_chi" value="${esc(REG_F.chi)}" placeholder="socio, operatore, n° comanda"></label>
        <button class="btn gold sm" id="rg_cerca">Cerca</button>
        <button class="btn ghost sm" id="rg_reset">Azzera</button>
        <button class="btn ghost sm" id="rg_csv">↓ Esporta (CSV)</button>
      </div>
      <p class="muted" style="font-size:.8rem">${righe.length} ${righe.length === 1 ? 'riga' : 'righe'}${righe.length >= 300 ? ' (mostrate le più recenti: restringi il periodo per vedere il resto)' : ''}</p>
      <table><thead><tr><th>Quando</th><th>Fatto</th><th>Servizio</th><th>A nome di</th><th>Chi lo ha fatto</th><th>Per il</th><th>Importo</th><th>Dettagli</th></tr></thead>
        <tbody>${corpo || '<tr><td colspan="8" class="muted">Nessuna registrazione per questi filtri.</td></tr>'}</tbody></table>
    </div>`;
  $('#rg_cerca').onclick = () => {
    REG_F = { dal: $('#rg_dal').value, al: $('#rg_al').value, servizio: $('#rg_serv').value, fatto: $('#rg_fatto').value, chi: $('#rg_chi').value.trim() };
    show('registro');
  };
  $('#rg_reset').onclick = () => { REG_F = { dal: '', al: '', servizio: '', fatto: '', chi: '' }; show('registro'); };
  // L'esportazione serve ad allegare la prova a una risposta scritta.
  $('#rg_csv').onclick = () => {
    const intest = ['quando', 'fatto', 'servizio', 'riferimento', 'a_nome_di', 'chi_lo_ha_fatto', 'canale', 'per_il', 'importo', 'dettaglio'];
    const csv = [intest.join(';')].concat(righe.map(r => [r.ts, r.fatto, r.servizio, r.riferimento, r.intestatario, r.autore, r.canale, r.quando_servizio, r.importo, (r.dettaglio || '').replace(/[;\n]/g, ' ')].map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';'))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'registro-storico.csv';
    a.click();
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
  const stat = (l, v, col) => `<div class="panel" style="flex:1;min-width:140px;margin:0"><div class="muted" style="font-size:.72rem">${l}</div><div style="font-size:1.6rem;font-weight:800;color:${col || 'var(--navy)'}">${v}</div></div>`;
  // Incasso suddiviso per metodo di pagamento (solo comande chiuse)
  const chiuse = ogg.filter(c => c.stato === 'chiusa');
  const perMetodo = {};
  chiuse.forEach(c => { const m = c.metodo_pagamento || 'contanti'; perMetodo[m] = (perMetodo[m] || 0) + Number(c.totale || 0); });
  const breakdown = METODI.filter(m => perMetodo[m[0]]).map(m => `<div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid #f0efe8"><span>${m[1]}</span><b>${eur(perMetodo[m[0]])}</b></div>`).join('');
  const righe = ogg.slice().reverse().map(c => { const [lbl, cls] = COM_STATI[c.stato] || [c.stato, '']; return `<tr><td>#${c.numero || c.id}</td><td>${esc(c.origine)}${c.riferimento ? ' ' + esc(c.riferimento) : ''}</td><td>${(c.righe || []).reduce((x, r) => x + r.qta, 0)} pz</td><td>${eur(c.totale)}</td><td>${c.stato === 'chiusa' ? esc(metodoLabel(c.metodo_pagamento || 'contanti')) : '—'}</td><td><span class="tag ${cls}">${esc(lbl)}</span></td></tr>`; }).join('');
  $('#view').innerHTML = `
    <div class="panel"><h3>📊 Riepilogo di oggi</h3>
      <div class="row" style="gap:10px">${stat('Comande', ogg.length)}${stat('Chiuse', cnt('chiusa'), 'var(--ok)')}${stat('In corso', ogg.length - cnt('chiusa') - cnt('annullata'), 'var(--gold)')}${stat('Pezzi', nPezzi)}${stat('Incasso', eur(incasso), 'var(--ok)')}</div></div>
    <div class="panel"><h3>💶 Incasso per metodo</h3>${breakdown || '<p class="muted">Nessuna comanda chiusa oggi.</p>'}${chiuse.length ? `<div class="row" style="justify-content:space-between;padding:8px 2px;margin-top:4px"><b style="color:var(--navy)">Totale</b><b style="color:var(--ok)">${eur(incasso)}</b></div>` : ''}</div>
    <div class="panel"><h3>Comande di oggi</h3><table><thead><tr><th>#</th><th>Origine</th><th>Pezzi</th><th>Totale</th><th>Pagam.</th><th>Stato</th></tr></thead><tbody>${righe || '<tr><td colspan="6" class="muted">Nessuna comanda oggi.</td></tr>'}</tbody></table></div>`;
};

/* ---------- boot ---------- */
$('#loginBtn').onclick = login;
$('#p').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('#logout').onclick = (e) => { e.preventDefault(); logout(); };
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.v));


// ===== MODULO CAMPI (cap 'campi') — prenotazioni del giorno e prenotazione al banco =========
const oggiISO = () => new Date().toISOString().slice(0, 10);
let CAMPI_DATA = '';
VIEWS.campi = async () => {
  const data = CAMPI_DATA || (CAMPI_DATA = oggiISO());
  const [campi, pren, blocchi] = await Promise.all([
    api('/campi').catch(() => []),
    api('/campi/prenotazioni?data=' + data).catch(() => []),
    api('/campi/blocchi?data=' + data).catch(() => [])
  ]);
  const righe = pren.map(p => {
    const ora = p.slot_da === p.slot_a ? esc(p.slot_da) : `${esc(p.slot_da)}–${esc(p.slot_a)}`;
    const nomi = (p.partecipanti || []).map(x => esc(x.nome)).join(', ');
    const cap = p.posti_totali ? `${(p.partecipanti || []).length}/${p.posti_totali}` : '';
    return `<div class="card" style="padding:10px 12px;margin-bottom:8px">
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
        <b style="color:var(--navy)">${ora} · ${esc(p.campo_nome)}</b>
        <span class="tag">${p.aperta_ai_soci ? '👥 Aperta' : '🔒 Riservata'} ${cap}</span>
      </div>
      <div style="font-size:.85rem;margin-top:4px">Titolare <b>${esc(p.titolare || '—')}</b></div>
      ${nomi ? `<div class="muted" style="font-size:.8rem">Con: ${nomi}</div>` : '<div class="muted" style="font-size:.8rem">Nessun altro giocatore dichiarato</div>'}
      ${p.partita_id ? `<div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
        <input id="gj_${p.partita_id}" placeholder="Nome, oppure tessera" style="min-width:150px;font-size:.85rem">
        <button class="btn ghost sm" data-gioc="${p.partita_id}">+ Chi gioca</button>
        <button class="btn danger sm" data-discampo="${p.partita_id}">Disdici</button>
      </div>` : ''}
    </div>`;
  }).join('');
  const bl = blocchi.map(b => `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
      <span>🚧 <b>${esc(b.campo_nome)}</b> ${esc(b.slot_da)}–${esc(b.slot_a)} <span class="muted">${esc(b.motivo)}</span></span>
      <button class="btn danger sm" data-cbldel="${b.id}">🗑</button></div>`).join('');
  const opts = campi.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  $('#view').innerHTML = `
    <div class="panel"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <b style="color:var(--navy)">🎾 Campi</b>
      <input type="date" id="cw_data" value="${data}">
    </div>
    <p class="muted" style="font-size:.78rem;margin-top:6px">I campi sono gratuiti: qui si vede <b>chi usa</b> e a chi fare riferimento. Ogni prenotazione ha un titolare socio.</p></div>
    <div class="panel"><b style="color:var(--navy)">Prenotazioni del giorno</b>
      <div style="margin-top:8px">${righe || '<p class="muted">Nessuna prenotazione per questa data.</p>'}</div></div>
    <div class="panel"><b style="color:var(--navy)">🎫 Prenota al banco</b>
      <p class="muted" style="font-size:.78rem;margin:6px 0">Serve la tessera del socio che prenota: resta lui il titolare.</p>
      <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center">
        <select id="cw_campo">${opts}</select>
        <select id="cw_slot"><option>—</option></select>
        <input id="cw_tess" placeholder="Tessera socio" style="min-width:150px">
        <select id="cw_tipo"><option value="1">👥 Aperta ai soci</option><option value="0">🔒 Riservata</option></select>
        <button class="btn gold sm" id="cw_book">Prenota</button>
      </div>
      <div id="cw_msg" class="muted" style="font-size:.8rem;margin-top:6px"></div></div>
    <div class="panel"><b style="color:var(--navy)">🚧 Campo impegnato</b>
      <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0">
        <select id="cw_bcampo">${opts}</select>
        <input id="cw_bda" value="09:00" style="width:70px"><span class="muted">–</span><input id="cw_ba" value="22:00" style="width:70px">
        <select id="cw_bmot"><option value="torneo">torneo</option><option value="manutenzione">manutenzione</option><option value="evento">evento</option></select>
        <button class="btn gold sm" id="cw_bloc">+ Blocca</button>
      </div>
      <div>${bl || '<p class="muted">Nessun blocco per questa data.</p>'}</div></div>`;

  const caricaSlot = async () => {
    const id = $('#cw_campo').value;
    const d = await api(`/../campi/${id}/disponibilita?data=${$('#cw_data').value}`).catch(() => ({ slots: [] }));
    const liberi = (d.slots || []).filter(s => s.stato === 'libero');
    $('#cw_slot').innerHTML = liberi.length ? liberi.map(s => `<option value="${s.slot}">${s.slot}</option>`).join('') : '<option value="">nessuna fascia libera</option>';
  };
  await caricaSlot();
  $('#cw_campo').onchange = caricaSlot;
  $('#cw_data').onchange = () => { CAMPI_DATA = $('#cw_data').value; show('campi'); };
  // Chi gioca con il titolare: quasi sempre lo dicono arrivando al banco. Un socio si scrive
  // con la tessera (cosi' vale per la Coppa), un ospite col solo nome: chi non e' tesserato
  // gioca lo stesso, ma resta scritto chi c'era.
  // Disdire dal banco: capita di continuo, e prima non si poteva. Si dice cosa si sta per
  // liberare, perche' un campo tolto per sbaglio manda a casa quattro persone.
  document.querySelectorAll('[data-discampo]').forEach(b => b.onclick = async () => {
    const riga = b.closest('div');
    const testo = riga ? (riga.parentElement.textContent || '').trim().split('\n')[0] : '';
    if (!confirm(`Disdire questa prenotazione?\n${testo}\n\nIl campo torna libero e chi doveva giocare va avvisato.`)) return;
    try { await api('/campi/partite/' + b.dataset.discampo + '/annulla', { method: 'POST', body: '{}' }); }
    catch (e) { alert(e.message); return; }
    show('campi');
  });
  document.querySelectorAll('[data-gioc]').forEach(b => b.onclick = async () => {
    const id = b.dataset.gioc;
    const v = (($('#gj_' + id) || {}).value || '').trim();
    if (!v) { alert('Scrivi il nome di chi gioca, oppure la sua tessera.'); return; }
    const corpo = /^(RB|BR)-/i.test(v) ? { giocatore_tessera: v.toUpperCase() } : { nome: v };
    try { await api('/campi/partite/' + id + '/giocatori', { method: 'POST', body: JSON.stringify(corpo) }); }
    catch (e) { alert(e.message); return; }
    show('campi');
  });
  $('#cw_book').onclick = async () => {
    const tess = $('#cw_tess').value.trim().toUpperCase();
    const slot = $('#cw_slot').value;
    if (!tess) { $('#cw_msg').textContent = 'Serve la tessera del socio.'; return; }
    if (!slot) { $('#cw_msg').textContent = 'Nessuna fascia libera selezionata.'; return; }
    const aperta = $('#cw_tipo').value === '1';
    try {
      const r = await fetch(API_BASE + '/api/campi/' + $('#cw_campo').value + (aperta ? '/partita' : '/prenota'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tessera_code: tess, data: $('#cw_data').value, slot, n_slot: 1 })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { $('#cw_msg').textContent = j.error || 'Prenotazione non riuscita.'; return; }
      show('campi');
    } catch (e) { $('#cw_msg').textContent = 'Errore di rete.'; }
  };
  $('#cw_bloc').onclick = async () => {
    await api('/campi/blocchi', { method: 'POST', body: JSON.stringify({ campo_id: Number($('#cw_bcampo').value), data: $('#cw_data').value, slot_da: $('#cw_bda').value, slot_a: $('#cw_ba').value, motivo: $('#cw_bmot').value }) });
    show('campi');
  };
  document.querySelectorAll('[data-cbldel]').forEach(b => b.onclick = async () => { await api('/campi/blocchi/' + b.dataset.cbldel, { method: 'DELETE' }); show('campi'); });
};

// ===== MODULO SERATE & CENA (cap 'serate') — presenze e incassi al banco ====================
let SERATA_SEL = null;
VIEWS.serate = async () => {
  const serate = await api('/serate').catch(() => []);
  if (!serate.length) { $('#view').innerHTML = '<div class="panel"><p class="muted">Nessuna serata configurata. Le serate si creano nel back office.</p></div>'; return; }
  if (!SERATA_SEL || !serate.some(s => s.id === SERATA_SEL)) SERATA_SEL = serate[0].id;
  const s = serate.find(x => x.id === SERATA_SEL);
  const pren = await api(`/serate/${s.id}/prenotazioni`).catch(() => []);
  const attive = pren.filter(p => p.stato !== 'annullata');
  const coperti = attive.reduce((n, p) => n + Number(p.persone || 0), 0);
  const daIncassare = pren.filter(p => p.stato === 'da_saldare').reduce((n, p) => n + Number(p.importo || 0), 0);
  const chips = serate.map(x => `<button class="btn ${x.id === SERATA_SEL ? 'gold' : 'ghost'} sm" data-sersel="${x.id}">${esc(x.titolo)}</button>`).join('');
  const righe = pren.map(p => {
    const stato = p.stato === 'saldata' ? '<span class="tag ok">saldata</span>' : p.stato === 'annullata' ? '<span class="tag">annullata</span>' : '<span class="tag no">da saldare</span>';
    return `<div class="card" style="padding:10px 12px;margin-bottom:8px">
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
        <b>${esc(p.nome || p.tessera_code || '—')}</b>${stato}
      </div>
      <div class="muted" style="font-size:.82rem">${esc(String(p.persone || 0))} persone · ${eur(p.importo)}</div>
      <div class="row" style="gap:6px;margin-top:6px">
        ${p.stato !== 'saldata' ? `<button class="btn gold sm" data-sersald="${p.id}">💶 Segna saldata</button>` : ''}
        ${p.stato !== 'annullata' ? `<button class="btn ghost sm" data-serann="${p.id}">Annulla</button>` : ''}
      </div></div>`;
  }).join('');
  $('#view').innerHTML = `
    <div class="panel"><b style="color:var(--navy)">🍽️ Serate & cena</b>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${chips}</div></div>
    <div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><b style="color:var(--navy)">${esc(s.titolo)}</b><div class="muted" style="font-size:.82rem">${esc(s.quando || s.data || '')}</div></div>
        <div style="text-align:right">
          <div><b>${coperti}</b><span class="muted">/${esc(String(s.capienza || 0))} coperti</span></div>
          <div class="muted" style="font-size:.82rem">da incassare <b>${eur(daIncassare)}</b></div>
        </div></div></div>
    <div class="panel"><b style="color:var(--navy)">Prenotati</b>
      <div style="margin-top:8px">${righe || '<p class="muted">Nessuna prenotazione.</p>'}</div></div>`;
  document.querySelectorAll('[data-sersel]').forEach(b => b.onclick = () => { SERATA_SEL = Number(b.dataset.sersel); show('serate'); });
  document.querySelectorAll('[data-sersald]').forEach(b => b.onclick = async () => { await api('/serate-prenotazioni/' + b.dataset.sersald, { method: 'PUT', body: JSON.stringify({ stato: 'saldata' }) }); show('serate'); });
  document.querySelectorAll('[data-serann]').forEach(b => b.onclick = async () => { if (!confirm('Annullare la prenotazione?')) return; await api('/serate-prenotazioni/' + b.dataset.serann, { method: 'PUT', body: JSON.stringify({ stato: 'annullata' }) }); show('serate'); });
};

// ===== MODULO CASA DI CARTA (cap 'cdc') — caffè, giochi, prestiti ===========================
VIEWS.cdc = async () => {
  // Le capsule sono un articolo di magazzino come gli altri: la conta si fa con la rettifica
  // nel modulo Magazzino, dove ci sono carico, scarico e rettifica per ogni articolo. Tenerne
  // una copia qui significava due contabilita' che divergono, ed e' quello che e' successo.
  const [giochi, prestiti] = await Promise.all([
    api('/cdc/giochi').catch(() => []),
    api('/cdc/prestiti').catch(() => [])
  ]);
  const fuori = prestiti.filter(p => !p.ora_fine);
  const gopts = giochi.map(g => `<option value="${g.id}">${esc(g.nome)}</option>`).join('');
  $('#view').innerHTML = `
    <div class="panel"><b style="color:var(--navy)">🎲 Prestiti in corso (${fuori.length})</b>
      <div style="margin-top:8px">${fuori.map(p => `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(p.gioco_nome)}</b> <span class="muted">· ${esc(p.giocatore || '—')}${p.tavolo ? ' · tavolo ' + esc(String(p.tavolo)) : ''} · dalle ${esc(p.ora_inizio || '')}</span></span>
        <button class="btn gold sm" data-cdcret="${p.id}">↩︎ Riconsegna</button></div>`).join('') || '<p class="muted">Nessun gioco fuori.</p>'}</div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <select id="cdc_gioco">${gopts}</select>
        <input id="cdc_chi" placeholder="Chi lo prende" style="min-width:130px">
        <select id="cdc_tav"><option value="">— tavolo —</option></select>
        <button class="btn gold sm" id="cdc_presta">+ Presta</button>
      </div>
      <p class="muted" style="font-size:.76rem;margin-top:6px">Il <b>tavolo</b> dice dove il gioco viene usato: serve a ritrovarlo e a sapere chi ha lasciato il tavolo in disordine.</p></div>
    <div class="panel"><b style="color:var(--navy)">🪑 Tavoli della sala</b>
      <div id="cdc_sala" class="muted" style="margin-top:8px">caricamento…</div></div>
    <div class="panel"><b style="color:var(--navy)">📚 Inventario giochi</b>
      <div style="margin-top:8px">${giochi.map(g => `<div class="row" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)">
        <span>${esc(g.nome)} <span class="muted">· ${esc(g.categoria || '')}</span></span>
        <span class="tag ${g.stato === 'ok' ? 'ok' : 'no'}">${esc(g.stato)} · ${esc(String(g.quantita))}</span></div>`).join('') || '<p class="muted">Inventario vuoto.</p>'}</div></div>`;
  $('#cdc_presta').onclick = async () => {
    const sel = $('#cdc_gioco'); if (!sel || !sel.value) { alert('Nessun gioco in inventario.'); return; }
    const nome = sel.options[sel.selectedIndex].textContent;
    const ora = new Date().toTimeString().slice(0, 5);
    await api('/cdc/prestiti', { method: 'POST', body: JSON.stringify({ gioco_id: Number(sel.value), gioco_nome: nome, giocatore: $('#cdc_chi').value, ora_inizio: ora, tavolo: ($('#cdc_tav') || {}).value || null }) });
    show('cdc');
  };
  renderSalaCarta();
  document.querySelectorAll('[data-cdcret]').forEach(b => b.onclick = async () => {
    await api('/cdc/prestiti/' + b.dataset.cdcret, { method: 'PUT', body: JSON.stringify({ ora_fine: new Date().toTimeString().slice(0, 5) }) });
    show('cdc');
  });
};

// La sala della Casa di Carta: stessi tavoli del Garden, altro ambiente. Si vede chi occupa
// cosa, quali giochi sono su quale tavolo, e si prenota al banco.
async function renderSalaCarta() {
  const box = $('#cdc_sala'); if (!box) return;
  const d = await api('/carta/sala' + (CARTA_TURNO ? '?turno=' + encodeURIComponent(CARTA_TURNO) : '')).catch(() => null);
  if (!d) { box.textContent = 'Sala non disponibile.'; return; }
  CARTA_TURNO = d.turno;
  const sel = $('#cdc_tav');
  if (sel) sel.innerHTML = '<option value="">— tavolo —</option>' + d.tavoli.map(t => `<option value="${t.numero}">Tavolo ${t.numero}</option>`).join('');
  // Nei turni di coworking si contano le SEDIE: un tavolo con una persona non e' "occupato".
  const cowo = (d.turni || []).find(x => (typeof x === 'string' ? x : x.turno) === d.turno)?.scopo === 'coworking';
  const chip = (t) => {
    const liberi = t.posti_liberi != null ? t.posti_liberi : (t.libero ? t.posti : 0);
    const occupato = cowo ? liberi <= 0 : !t.libero;
    return `<div style="border:1px solid var(--line);border-left:4px solid ${occupato ? '#b14a35' : liberi < t.posti ? '#c88a2e' : '#2e6b45'};border-radius:10px;padding:8px 10px;margin-bottom:6px;background:#fff">
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
        <b>Tavolo ${t.numero}</b>
        <span class="muted" style="font-size:.78rem">${cowo
          ? `${liberi}/${t.posti} postazioni libere`
          : occupato ? esc(t.nome || 'occupato') + ' · ' + (t.persone || '?') + 'p' : t.posti + ' posti liberi'}</span>
      </div>
      ${(t.prestiti || []).length ? `<div class="muted" style="font-size:.78rem;margin-top:4px">🎲 ${t.prestiti.map(p => esc(p.gioco_nome) + ' (' + esc(p.giocatore || '—') + ')').join(' · ')}</div>` : ''}
    </div>`;
  };
  box.innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${d.turni.map(t => { const v = typeof t === 'string' ? t : t.turno; const lab = typeof t === 'string' ? t : (t.etichetta || t.turno); const ico = (typeof t === 'object' && t.scopo === 'coworking') ? '💻' : '🕗';
        return `<button class="btn ${v === d.turno ? 'gold' : 'ghost'} sm" data-carta-turno="${esc(v)}">${ico} ${esc(lab)}</button>`; }).join('')}
      ${cowo
        ? '<span class="muted" style="font-size:.76rem;align-self:center">postazioni singole · si lavora anche da soli</span>'
        : (d.minimo ? `<span class="muted" style="font-size:.76rem;align-self:center">minimo ${d.minimo} giocatori</span>` : '')}
    </div>
    ${d.tavoli.map(chip).join('')}
    ${d.prestiti_senza_tavolo.length ? `<p class="muted" style="font-size:.78rem">Senza tavolo: ${d.prestiti_senza_tavolo.map(p => esc(p.gioco_nome)).join(', ')}</p>` : ''}
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
      <input id="carta_chi" placeholder="Tessera o nome" style="min-width:140px">
      <input id="carta_p" type="number" min="1" value="${cowo ? 1 : 2}" style="width:64px" title="${cowo ? 'Postazioni' : 'Persone'}">
      <button class="btn gold sm" id="carta_pren">+ ${cowo ? 'Prenota postazione' : 'Prenota tavolo'}</button>
    </div><div id="carta_msg" class="muted" style="font-size:.78rem;margin-top:4px"></div>`;
  document.querySelectorAll('[data-carta-turno]').forEach(b => b.onclick = () => { CARTA_TURNO = b.dataset.cartaTurno; renderSalaCarta(); });
  $('#carta_pren').onclick = async () => {
    const v = ($('#carta_chi').value || '').trim();
    const body = { data: oggiISO(), turno: CARTA_TURNO, persone: Number($('#carta_p').value) || 2 };
    if (/^(RB|BR)-/i.test(v)) body.tessera_code = v.toUpperCase(); else body.nome = v || 'Ospite';
    try { await api('/carta/prenota', { method: 'POST', body: JSON.stringify(body) }); renderSalaCarta(); }
    catch (e) { $('#carta_msg').textContent = e.message; }
  };
}
let CARTA_TURNO = '';

// Scorte della Casa di Carta: e' una zona del magazzino Centrale, come Bar e Garden.
VIEWS.scortecdc = async () => { await magHubZona('carta'); };

// ===== PIANTA DEL GARDEN: disposizione trascinabile + prenotazioni per turno ===============
// Due modalita' sullo stesso disegno:
//   SERVIZIO  → si vede chi occupa cosa e si prenota al banco
//   DISPOSIZIONE → si trascinano i tavoli per adattare la sala alla serata, poi si salva
// La regola "dal centro alla periferia" e' calcolata sul baricentro dei tavoli attivi: cambia
// da sola quando la Crew sposta i tavoli, senza nessuna configurazione.
let PIANTA = { data: '', turno: '', modo: 'servizio', layoutId: null, tavoli: [], sporco: false, sel: null, ambiente: 'garden' };

VIEWS.pianta = async () => {
  if (!PIANTA.data) PIANTA.data = oggiISO();
  // La pianta segue il modulo da cui la si apre: Garden, Casa di Carta o Stage.
  // L'ambiente e' quello del modulo da cui si entra, e non si cambia: chi ha il permesso dello
  // Stage non deve poter spostare i tavoli del Garden. E' il senso stesso dei permessi.
  PIANTA.ambiente = { garden: 'garden', cdc: 'carta', cinema: 'stage' }[ZONA] || 'garden';
  const [conf, turnoDati, comandeZona] = await Promise.all([
    api('/tavoli/layout?ambiente=' + PIANTA.ambiente).catch(() => ({ layout: [], giorni: [], turni: ['20:00', '21:30'] })),
    api(`/tavoli/turno?data=${PIANTA.data}&ambiente=${PIANTA.ambiente}${PIANTA.turno ? '&turno=' + encodeURIComponent(PIANTA.turno) : ''}`).catch((e) => ({ __errore: e.message })),
    // Le comande aperte del punto: sulla pianta un tavolo puo' essere prenotato, servito o
    // entrambe le cose. Tenerle in una tab separata voleva dire guardare due volte lo stesso
    // tavolo in due posti diversi.
    api('/comande').catch(() => [])
  ]);
  if (!turnoDati || turnoDati.__errore) {
    // Un messaggio muto non aiuta nessuno: si dice cosa e' andato storto e si offre la via d'uscita.
    $('#view').innerHTML = `<div class="panel"><p class="err">Pianta non disponibile: ${esc((turnoDati && turnoDati.__errore) || 'errore sconosciuto')}</p>
      <p class="muted" style="font-size:.8rem">Puoi ridisegnarla dai parametri correnti.</p>
      <button class="btn gold sm" id="p_reset0">↺ Ripristina predefinita</button></div>`;
    $('#p_reset0').onclick = async () => {
      try { await api('/tavoli/layout/rigenera', { method: 'POST', body: JSON.stringify({ ambiente: PIANTA.ambiente }) }); show('pianta'); }
      catch (e) { alert(e.message); }
    };
    return;
  }
  PIANTA.turno = turnoDati.turno;
  PIANTA.layoutId = turnoDati.layout.id;
  if (PIANTA.modo === 'disposizione' && !PIANTA.sporco) {
    const l = (conf.layout || []).find(x => x.id === PIANTA.layoutId);
    PIANTA.tavoli = (l ? l.tavoli : []).map(t => ({ ...t }));
  }

  const turniBtn = (turnoDati.turni || []).map(t => {
    const v = typeof t === 'string' ? t : t.turno;
    const lab = typeof t === 'string' ? t : (t.etichetta || t.turno);
    const ico = (typeof t === 'object' && t.scopo === 'coworking') ? '💻' : '🕗';
    return `<button class="btn ${v === PIANTA.turno ? 'gold' : 'ghost'} sm" data-ptur="${esc(v)}">${ico} ${esc(lab)}</button>`;
  }).join('');
  const layoutOpts = (conf.layout || []).map(l => `<option value="${l.id}" ${l.id === PIANTA.layoutId ? 'selected' : ''}>${esc(l.nome)}${l.predefinito ? ' ★' : ''}</option>`).join('');

  const testa = `<div class="panel"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <b style="color:var(--navy)">🗺️ ${PIANTA.ambiente === 'carta' ? 'Sala della Casa di Carta' : PIANTA.ambiente === 'stage' ? 'Platea dello Stage' : 'Pianta del Garden'}</b>
      <div class="row" style="gap:6px;align-items:center">
    <span class="tag" style="background:rgba(0,0,0,.06)">${PIANTA.ambiente === 'garden' ? '🌿 Garden' : PIANTA.ambiente === 'carta' ? '📚 Casa di Carta' : '🎭 Stage'}</span>
        <input type="date" id="p_data" value="${PIANTA.data}">
        <button class="btn ${PIANTA.modo === 'disposizione' ? 'gold' : 'ghost'} sm" id="p_edit" title="Sposta e modifica i tavoli">${PIANTA.modo === 'disposizione' ? '✓ Sto modificando' : '✋ Modifica pianta'}</button>
      </div></div>
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
      ${turniBtn}
      <span style="flex:1"></span>
      <label class="muted" style="font-size:.78rem">Disposizione <select id="p_layout">${layoutOpts}</select></label>
    </div></div>`;

  // Comande aperte su questo punto, indicizzate per tavolo.
  const zonaComande = PIANTA.ambiente === 'carta' ? 'carta' : 'garden';
  const APERTE = ['aperta', 'in_preparazione', 'pronta'];
  const perTavolo = {};
  for (const c of (Array.isArray(comandeZona) ? comandeZona : [])) {
    if (c.zona !== zonaComande || !APERTE.includes(c.stato)) continue;
    const rif = String(c.riferimento || '').trim();
    if (!/^\d+$/.test(rif)) continue;
    (perTavolo[Number(rif)] ??= []).push(c);
  }
  const rossoMin = Number((conf.map_rosso_min ?? 10));
  // Un messaggio dalla cucina accende il tavolo: e' la cosa piu' urgente che la sala puo'
  // vedere sulla pianta, perche' dietro c'e' un cliente che aspetta un piatto che non arriva.
  const avvisoDi = (numero) => {
    const cs = perTavolo[Number(numero)] || [];
    const c = cs.find(x => x.avviso_cucina);
    return c ? c.avviso_cucina : null;
  };

  // Una sola videata. Lo stato del turno c'e' sempre; gli strumenti di disegno compaiono
  // quando si sta modificando, ma la pagina e la mappa restano quelle: non serve una seconda
  // schermata che mostra le stesse cose.
  const stato = `<div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span>Turno <b>${esc(PIANTA.turno)}</b> · <b>${turnoDati.coperti_prenotati}</b> ${PIANTA.ambiente === 'stage' ? 'in sala' : 'coperti prenotati'}</span>
        <span class="muted">${turnoDati.posti_liberi} posti liberi su ${turnoDati.posti_totali}</span>
        ${turnoDati.serata ? `<span class="tag" style="background:${turnoDati.serata.livello === 'difficile' ? '#C0553F' : turnoDati.serata.livello === 'buona' ? '#B7791F' : '#2e6b45'};color:#fff" title="${esc(turnoDati.serata.consiglio)}">Serata ${esc(turnoDati.serata.etichetta)} · ${turnoDati.serata.pieno}%</span>` : ''}
      </div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        ${PIANTA.modo === 'disposizione' ? `
          <button class="btn gold sm" id="p_salva">💾 Salva</button>
          <button class="btn ghost sm" id="p_addt">+ ${PIANTA.ambiente === 'stage' ? 'Seduta' : 'Tavolo'}</button>
          <button class="btn ghost sm" id="p_nuovo">✚ Nuova disposizione</button>
          <button class="btn ghost sm" id="p_giorno">📌 Usa in questo giorno</button>` : ''}
        ${PIANTA.ambiente === 'stage' ? '' : '<button class="btn ghost sm" id="p_qr" title="QR self-order dei tavoli disegnati">🔳 QR tavoli</button>'}
        <button class="btn ghost sm" id="p_reset">↺ Ripristina predefinita</button>
        <button class="btn ghost sm" id="p_spazio" title="Riporta la pianta alle misure vere della sala">\ud83d\udcd0 Ci sta davvero?</button>
      </div>
      <p class="muted" style="font-size:.76rem;margin-top:6px">${PIANTA.modo === 'disposizione'
        ? `Trascina ${PIANTA.ambiente === 'stage' ? 'le sedute' : 'i tavoli'}; tocca per cambiarne i posti o toglierli dal servizio. <b>I numeri non cambiano</b>: restano quelli dei QR e delle comande. La disposizione decide anche l'ordine di riempimento, che va sempre <b>dal centro verso l'esterno</b>.`
        : PIANTA.ambiente === 'stage'
          ? `🟫 prima fila <b>over 70</b> · 🟩 <b>chi cena</b> al primo turno · 🟦 <b>solo spettacolo</b> · 🟨 extra · 🟥 occupato — le due quote si alternano per fila, così chi non cena non finisce in fondo. <b>Tocca una seduta per assegnarla al banco.</b>`
          : `🟩 libero · 🟪 prenotato · 🟧 comanda in corso · 🟥 oltre ${rossoMin}′ · 🟨 extra · ⬜ arredo — <b>tocca un tavolo</b>: se e' servito chiudi la comanda, se e' libero lo prenoti`}</p>
      <div id="p_msg" class="muted" style="font-size:.8rem;margin-top:4px"></div></div>`;

  // In disposizione si vedono anche i tavoli fuori servizio (per rimetterli); in servizio no.
  const sorgente = (PIANTA.modo === 'disposizione' ? PIANTA.tavoli : turnoDati.tavoli).filter(t => PIANTA.modo === 'disposizione' || t.attivo !== 0);
  // Quanto e' largo il disegno rispetto a una sala "normale": sotto i 700 px i tavoli si
  // rimpiccioliscono, ma non oltre la meta' — sotto quella soglia il numero non si legge piu' e
  // una pianta illeggibile non serve a nessuno.
  // Le proporzioni della sala servono PRIMA di disegnare i tavoli, perche' decidono quanto
  // grandi vanno fatti: in un riquadro largo trecento pixel un tavolo da cinquanta copre il
  // vicino.
  let rapportoSala = 0;
  try {
    const vs = await api('/tavoli/verifica-spazio?ambiente=' + PIANTA.ambiente).catch(() => null);
    if (vs && vs.sala && vs.sala.larghezza_m && vs.sala.profondita_m) {
      rapportoSala = Number(vs.sala.larghezza_m) / Number(vs.sala.profondita_m);
    }
  } catch (e) { }

  // Si CALCOLA, non si misura: quando questa riga gira il riquadro non e' ancora nella pagina,
  // e misurarlo restituiva sempre il valore di ripiego — quindi i tavoli non si rimpicciolivano
  // mai. La larghezza e' quella del pannello, limitata dal rapporto della sala.
  const largoStimato = (() => {
    const disponibile = Math.max(280, (window.innerWidth || 1000) - 120);
    if (!rapportoSala) return disponibile;
    return Math.min(disponibile, window.innerHeight * 0.78 * rapportoSala);
  })();
  const scalaPianta = Math.max(0.5, Math.min(1, largoStimato / 700));
  const box = sorgente.map(t => {
    const occupato = PIANTA.modo === 'servizio' && !t.libero;
    const palco = (t.tipo || 'standard') === 'arredo' && t.numero === 99;
    // La misura del tavolo scala col riquadro: in una sala stretta e profonda il riquadro e'
    // largo trecento pixel, e tavoli da cinquanta si accavallavano l'uno sull'altro. Il
    // fattore si calcola una volta sola (`scalaPianta`) sulla larghezza vera del disegno.
    const raggio = Math.round(scalaPianta * (palco ? 30 : (t.tipo || 'standard') === 'arredo' ? 22 : 22 + Math.min(16, Number(t.posti) * 2)));
    const arredo = (t.tipo || 'standard') === 'arredo';
    const cs = perTavolo[t.numero] || [];
    const st = cs.length ? statoGruppo(cs, rossoMin, Date.now()) : null;
    const extra = (t.tipo || 'standard') === 'extra';
    // Il colore racconta prima il servizio (comanda in corso o in ritardo), poi la prenotazione.
    // In platea il colore dice anche A CHI spetta la seduta: prima fila over 70, chi cena,
    // chi viene solo per lo spettacolo. Senza, la regola non si vedrebbe.
    const perQuota = { over70: '#7a5c2e', garden: '#2e6b45', spettacolo: '#2f6d8a' };
    const bg = arredo ? '#8d8477' : PIANTA.modo === 'disposizione'
      ? (t.attivo === 0 ? '#d9d4c6' : extra ? '#b08b3e' : 'var(--accent)')
      : avvisoDi(t.numero) ? '#b14a35'
      : st ? (st.key === 'rosso' ? '#b14a35' : st.key === 'giallo' ? '#c88a2e' : '#2e6b45')
      : occupato ? '#b14a35'
      : extra ? '#b08b3e'
      : (PIANTA.ambiente === 'stage' && t.quota) ? perQuota[t.quota]
      : '#2e6b45';
    return `<div class="tv" data-tv="${t.numero}" style="position:absolute;left:${t.x}%;top:${t.y}%;transform:translate(-50%,-50%);
        width:${palco ? 200 : raggio * 2}px;height:${palco ? 44 : raggio * 2}px;border-radius:${t.forma === 'quadrato' ? '10px' : t.forma === 'rettangolo' ? '10px/26px' : '50%'};
        background:${bg};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-weight:800;font-size:.85rem;box-shadow:0 2px 6px rgba(0,0,0,.25);cursor:${arredo ? 'default' : PIANTA.modo === 'disposizione' ? 'grab' : 'pointer'};touch-action:none;user-select:none" ${(PIANTA.modo === 'servizio' && !arredo) ? `data-pren="${t.numero}"` : ''}>
        ${avvisoDi(t.numero) ? '<span style="position:absolute;top:-6px;right:-6px;background:#fff;color:#b14a35;border:2px solid #b14a35;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:900">!</span>' : ''}
        <span>${arredo ? (t.numero === 99 ? '🎭' : t.numero === 90 ? '🛎️' : '☕') : t.numero + ((t.uniti && t.uniti.length) ? '+' + t.uniti.join('+') : '')}</span>
        <span style="font-weight:500;font-size:.62rem;opacity:.9">${arredo ? (t.numero === 99 ? 'PALCO' : t.numero === 90 ? 'reception' : 'caffè')
          : st ? (st.mins != null ? st.mins + '′' : 'in corso')
          : occupato ? esc((t.nome || '').split(' ')[0]) : t.posti + ' p'}</span>
      </div>`;
  }).join('');

  const prenBox = `<div class="panel"><b style="color:var(--navy)">Prenotazioni del turno</b>
      <div style="margin-top:8px">${(turnoDati.prenotazioni || []).map(p => `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(p.nome || '—')}</b> <span class="muted">· ${p.persone}p · tavoli ${p.tavoli.join(', ')} · ${p.origine === 'crew' ? 'al banco' : 'app'}</span></span>
        <button class="btn ghost sm" data-pann="${p.id}">Annulla</button></div>`).join('') || '<p class="muted">Nessuna prenotazione per questo turno.</p>'}</div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <input id="p_nome" placeholder="Nome o tessera" style="min-width:140px">
        <input id="p_pers" type="number" min="1" value="2" style="width:70px" title="Persone">
        <button class="btn gold sm" id="p_pren">+ Prenota al banco</button>
      </div><div id="p_msg2" class="muted" style="font-size:.8rem;margin-top:6px"></div></div>`;

  // Gli ordini che arrivano dal QR si governano qui, davanti ai tavoli: e' guardando la sala
  // che si decide se sospenderli. Al Garden e basta — al Carta e allo Stage non c'e' self-order.
  const soG = PIANTA.ambiente === 'garden' && PIANTA.modo === 'servizio' ? await statoSelfOrder() : null;
  // LA MAPPA HA LE PROPORZIONI DELLA SALA. Un rettangolo fisso alto 64vh disegna una sala
  // quadrata come una lunga, e i tavoli finiscono dove non sono: chi guarda la pianta non
  // riconosce il posto in cui lavora. Se le misure ci sono, il riquadro prende il loro
  // rapporto; se non ci sono, resta l'altezza di prima — meglio un rettangolo generico che una
  // proporzione inventata.
  let propAula = 'height:64vh;';
  try {
    const v = await api('/tavoli/verifica-spazio?ambiente=' + PIANTA.ambiente).catch(() => null);
    if (v && v.sala && v.sala.larghezza_m && v.sala.profondita_m) {
      // Una sala stretta e profonda non ci sta in altezza: si limita l'ALTEZZA e si stringe la
      // larghezza di conseguenza, invece di allargare il riquadro e falsare il rapporto.
      const rap = Number(v.sala.larghezza_m) / Number(v.sala.profondita_m);
      rapportoSala = rap;
      propAula = `aspect-ratio:${v.sala.larghezza_m} / ${v.sala.profondita_m};max-height:78vh;` +
        `width:min(100%, calc(78vh * ${rap.toFixed(3)}));margin:0 auto;`;
    }
  } catch (e) { }
  $('#view').innerHTML = testa + (soG ? pannelloSelfOrder(soG) : '') + stato + `
    <div class="panel"><div id="p_canvas" style="position:relative;${propAula}min-height:300px;border-radius:var(--r);
      background:repeating-linear-gradient(45deg,#f2efe6,#f2efe6 12px,#eeeade 12px,#eeeade 24px);border:var(--bordo) solid var(--line);overflow:hidden">
      <div style="position:absolute;left:50%;top:6px;transform:translateX(-50%);font-size:.68rem;color:#9a917c;letter-spacing:2px">INGRESSO</div>
      ${box}
    </div></div>` + prenBox;

  // --- interazioni
  $('#p_data').onchange = () => { PIANTA.data = $('#p_data').value; PIANTA.sporco = false; show('pianta'); };
  // I QR si generano DAI TAVOLI DISEGNATI: se sono sei, sono sei. Nessun numero fisso.
  if ($('#p_qr')) $('#p_qr').onclick = () => stampaQrTavoli(sorgente.filter(t => (t.tipo || 'standard') !== 'arredo' && t.attivo !== 0), PIANTA.ambiente);
  document.querySelectorAll('[data-ptur]').forEach(b => b.onclick = () => { PIANTA.turno = b.dataset.ptur; show('pianta'); });
  $('#p_edit').onclick = () => { PIANTA.modo = PIANTA.modo === 'disposizione' ? 'servizio' : 'disposizione'; PIANTA.sporco = false; show('pianta'); };
  $('#p_layout').onchange = async () => {
    await api('/tavoli/giorno', { method: 'PUT', body: JSON.stringify({ data: PIANTA.data, layout_id: Number($('#p_layout').value) }) });
    PIANTA.sporco = false; show('pianta');
  };
  document.querySelectorAll('[data-pann]').forEach(b => b.onclick = async () => {
    if (!confirm('Annullare la prenotazione?')) return;
    await api('/tavoli/prenotazioni/' + b.dataset.pann, { method: 'PUT', body: JSON.stringify({ stato: 'annullato' }) });
    show('pianta');
  });
  if ($('#p_pren')) $('#p_pren').onclick = async () => {
    const v = $('#p_nome').value.trim();
    const body = { data: PIANTA.data, turno: PIANTA.turno, persone: Number($('#p_pers').value) || 2 };
    if (/^(RB|BR)-/i.test(v)) body.tessera_code = v.toUpperCase(); else body.nome = v || 'Ospite';
    try { await api('/tavoli/prenota', { method: 'POST', body: JSON.stringify(body) }); show('pianta'); }
    catch (e) { $('#p_msg2').textContent = e.message; }
  };

  // La pianta e' in percentuali: un tavolo in piu' ci entra sempre. Qui la si riporta alle
  // misure vere della sala, prese col metro, e si guarda se con i passaggi liberi ci sta.
  if ($('#p_spazio')) $('#p_spazio').onclick = async () => {
    const v = await api('/tavoli/verifica-spazio?ambiente=' + PIANTA.ambiente).catch(() => null);
    if (!v) { alert('Verifica non disponibile per questo ambiente.'); return; }
    if (v.misure_mancanti) { alert('Prima scrivi le misure della sala nei parametri: larghezza e profondit\u00e0 in metri.'); return; }
    const ok = !v.problemi.length;
    const riga = (et, val) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${et}</span><b>${val}</b></div>`;
    openModal(`<h3 style="margin-top:0">\ud83d\udcd0 Ci sta davvero?</h3>
      <div style="background:${ok ? '#eaf3ec' : '#fdecea'};border-left:5px solid ${ok ? '#2e6b45' : '#b14a35'};border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px">
        <b style="color:${ok ? '#2e6b45' : '#8a2a20'}">${esc((v.verdetto || '').charAt(0).toUpperCase() + (v.verdetto || '').slice(1))}</b>${v.cosa_fare ? `<div style="margin-top:6px">${esc(v.cosa_fare)}</div>` : ''}
        ${v.problemi.map(x => `<div style="margin-top:4px">\u00b7 ${esc(x)}</div>`).join('')}
      </div>
      ${riga('Sala', v.sala.larghezza_m + ' \u00d7 ' + v.sala.profondita_m + ' m \u00b7 ' + v.sala.mq + ' m\u00b2')}
      ${riga((v.cosa === 'sedute' ? 'Sedute disegnate' : 'Tavoli disegnati'), v.disegnati + (v.cosa === 'sedute' ? '' : ' \u00b7 ' + v.posti_disegnati + ' posti'))}
      ${riga('Ce ne stanno', v.capienza_teorica + (v.cosa === 'sedute' ? '' : ' \u00b7 ' + v.posti_teorici + ' posti'))}
      ${riga('Metri quadri per coperto', v.mq_per_coperto == null ? '\u2014' : v.mq_per_coperto)}
      ${v.troppo_vicini.length ? `<p class="muted" style="font-size:.8rem;margin-top:8px">${v.cosa === 'sedute' ? 'Sedute troppo vicine' : 'Tavoli troppo vicini'}: ${v.troppo_vicini.slice(0, 6).map(x => x.a + '\u2013' + x.b + ' (' + x.luce + ' m)').join(', ')}</p>` : ''}
      <p class="muted" style="font-size:.78rem;margin-top:8px">Il conto usa ${v.regole.ingombro_tavolo_m} m di ingombro ${v.cosa === 'sedute' ? 'per seduta' : 'per tavolo <b>con le sedie occupate</b>'} e ${v.regole.corridoio_m} m di ${v.cosa === 'sedute' ? 'distanza fra le file' : 'passaggio'}. Si cambiano nei parametri, se la tua sala \u00e8 fatta diversamente.</p>
      <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
  };
  $('#p_reset').onclick = async () => {
    if (!confirm('Ridisegnare la pianta predefinita di questo ambiente dai parametri correnti? Le disposizioni personalizzate di questo ambiente vengono perse.')) return;
    try {
      await api('/tavoli/layout/rigenera', { method: 'POST', body: JSON.stringify({ ambiente: PIANTA.ambiente }) });
      PIANTA.sporco = false; show('pianta');
    } catch (e) {
      // Prima il motivo finiva in una riga grigia in fondo alla pagina, che nessuno guarda:
      // il tasto sembrava semplicemente non funzionare. Un rifiuto va detto in faccia.
      alert(e.message);
      if ($('#p_msg')) $('#p_msg').textContent = e.message;
    }
  };
  // In servizio il tocco su un tavolo (o su una seduta) apre la prenotazione al banco proprio
  // su quello: serve a chi passa dal chiosco e non usa l'app.
  if (soG) collegaSelfOrder(soG, 'pianta');

  if (PIANTA.modo === 'servizio') {
    // Il tavolo e' il punto di partenza di tutto. Toccandolo si vede chi lo occupa (e lo si
    // chiama per nome), si prende la comanda senza digitare il numero del tavolo, si prenota,
    // si cambia forma e si accorpa. Prima queste cose stavano in tre posti diversi.
    document.querySelectorAll('#p_canvas [data-pren]').forEach(el => el.onclick = () => {
      const n = Number(el.dataset.pren);
      const t = (turnoDati.tavoli || []).find(x => x.numero === n);
      if (!t) return;
      const cs = perTavolo[n] || [];
      const pren = (turnoDati.prenotazioni || []).find(x => (x.tavoli || []).includes(n));
      const chi = pren ? (pren.nome || '') : '';
      const stage = PIANTA.ambiente === 'stage';
      const forme = ['tondo', 'quadrato', 'rettangolo'];
      const zonaC = PIANTA.ambiente === 'carta' ? 'carta' : 'garden';

      // Il conto del tavolo e' UNO: chi ha iniziato col QR e ha proseguito chiamando la crew
      // non deve trovarsi due conti alla fine. Qui dentro ci sono tutte le comande di quel
      // tavolo, da qualunque parte siano arrivate, e si chiudono insieme.
      const totaleTavolo = cs.reduce((t, c) => t + Number(c.totale || 0), 0);
      const daQr = cs.filter(c => c.canale === 'self').length;
      const comandeHTML = cs.length ? `<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:6px">
          <div class="row" style="justify-content:space-between;align-items:baseline">
            <b style="font-size:.86rem">Conto del tavolo</b>
            <b style="font-size:1.05rem;color:var(--navy)">${eur(totaleTavolo)}</b>
          </div>
          <div class="muted" style="font-size:.78rem">${cs.length} ${cs.length === 1 ? 'comanda' : 'comande'}${daQr ? ` · ${daQr} dal QR, ${cs.length - daQr} dalla crew` : ''} — si pagano insieme.</div>
          ${cs.map(c => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
            <div class="row" style="justify-content:space-between"><b>#${esc(String(c.numero))} ${c.canale === 'self' ? '📱' : '🧾'}</b><span class="muted">${esc(c.stato)} · ${eur(c.totale || 0)}</span></div>
            <div class="muted" style="font-size:.8rem">${(c.righe || []).map(r => `${r.parent_riga_id ? '↳ ' : r.qta + '× '}${esc(r.nome)}`).join(' · ')}</div>
            <div style="margin-top:4px">${(c.righe || []).filter(r => !r.parent_riga_id).map(r => r.stato === 'stornata'
              ? `<div class="muted" style="font-size:.78rem;text-decoration:line-through">${r.qta}× ${esc(r.nome)} — ${esc(r.motivo_storno || 'stornata')}</div>`
              : `<div class="row" style="justify-content:space-between;align-items:center;font-size:.8rem;padding:2px 0"><span>${r.qta}× ${esc(r.nome)}</span><button class="btn ghost sm" data-storna="${r.id}" title="Articolo finito, riga sbagliata, cliente che rinuncia">↩︎ storna</button></div>`).join('')}</div>
            <div class="row" style="gap:6px;margin-top:6px">
              <button class="btn ghost sm" data-cchiudi="${c.id}">✓ Chiudi solo questa</button>
              <button class="btn ghost sm" data-cmuovi="${c.id}">➡︎ Sposta a un altro tavolo</button>
              <button class="btn danger sm" data-cann="${c.id}">Annulla</button></div></div>`).join('')}
          <div class="row" style="align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
            <label style="font-size:.82rem">Diviso per <input id="cnt_div" type="number" min="1" value="${(pren && pren.persone) || t.posti_usati || t.posti || 2}" style="width:56px" title="Quante persone dividono il conto: se ci sono bambini che non pagano, correggi"></label>
            <b id="cnt_quota" style="color:var(--navy)"></b>
          </div>
          <button class="btn gold block" style="margin-top:8px" data-contochiudi="${cs.map(c => c.id).join(',')}">💶 Chiudi il conto · ${eur(totaleTavolo)}</button>
        </div>` : '';

      openModal(`<h3>${stage ? 'Seduta' : 'Tavolo'} ${n}${(t.uniti && t.uniti.length) ? ' + ' + t.uniti.join(' + ') : ''}</h3>
        <p class="muted" style="font-size:.84rem;margin-top:-4px">${t.posti} ${t.posti === 1 ? 'posto' : 'posti'}${t.tipo === 'extra' ? ' · extra' : ''} · ${esc(PIANTA.turno)}</p>
        ${(() => {
          // La prima cosa da leggere aprendo un tavolo. In rosso quello che la cucina ha tolto
          // (c'e' un cliente da avvisare); in blu i piatti pronti da portare. Il resto viene dopo.
          const conAvviso = cs.filter(x => x.avviso_cucina);
          const pronte = cs.filter(x => x.stato === 'pronta');
          let box = '';
          for (const x of conAvviso) {
            box += `<div style="background:#fdecea;border-left:5px solid #b14a35;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px">
              <b style="color:#8a2a20">Dalla cucina \u00b7 comanda #${esc(String(x.numero))}</b>
              <div style="margin-top:2px">${esc(x.avviso_cucina)}</div>
              <button class="btn ghost sm" style="margin-top:8px" data-avvletto="${x.id}">\u2713 Ho avvisato il cliente</button></div>`;
          }
          if (pronte.length) {
            box += `<div style="background:#e8eef5;border-left:5px solid #1d4e79;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px">
              <b style="color:#1d4e79">\ud83d\udece\ufe0f Da portare in tavola</b>
              <div style="margin-top:2px">${pronte.map(x => 'comanda #' + esc(String(x.numero))).join(' \u00b7 ')}</div></div>`;
          }
          return box;
        })()}
        ${chi ? `<div style="background:#eaf3ec;border-left:4px solid #2e6b45;border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:10px">
            <b style="color:var(--navy)">${esc(chi)}</b> · ${pren.persone} ${pren.persone === 1 ? 'persona' : 'persone'}
            <div class="muted" style="font-size:.78rem">Chiamali per nome: sanno di essere attesi.</div></div>` : ''}
        <!-- Alla Casa di Carta e in platea non si ordina dal tavolo: li' si gioca e si guarda
             uno spettacolo, e chi vuole qualcosa va al banco. Un tasto "Ordina" che apre un
             menu' dove non si serve fa perdere tempo e basta. Tutto il resto — libera, unisci,
             trasferisci — resta, perche' i tavoli sono tavoli ovunque. -->
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
          ${(stage || PIANTA.ambiente === 'carta') ? '' : '<button class="btn gold sm" id="tv_ordina">🧾 Ordina</button>'}
          ${chi ? '<button class="btn ghost sm" id="tv_libera">🧹 Libera</button>'
                : '<button class="btn navy sm" id="tv_pren">👤 Prenota</button>'}
        </div>
        ${comandeHTML}
        ${stage ? '' : `<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:6px">
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <label class="muted" style="font-size:.8rem">Posti <input id="tv_p" type="number" min="1" value="${t.posti}" style="width:62px"></label>
            <label class="muted" style="font-size:.8rem">Forma <select id="tv_f">${forme.map(f => `<option value="${f}" ${t.forma === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
            <button class="btn ghost sm" id="tv_applica">Applica</button>
          </div>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${(t.uniti && t.uniti.length)
              ? `<span class="muted" style="font-size:.8rem">Unito con <b>${t.uniti.join(', ')}</b></span>
                 ${t.uniti.map(u => `<button class="btn ghost sm" data-stacca="${u}" title="Rende il tavolo ${u} alla sala, tiene accostato il resto">↤ stacca ${u}</button>`).join('')}
                 <button class="btn ghost sm" id="tv_sep">✂️ Separa tutti</button>`
              : `<label class="muted" style="font-size:.8rem">Unisci al <select id="tv_u">${(turnoDati.tavoli || []).filter(z => z.numero !== n && z.tipo !== 'arredo' && !(z.uniti || []).length).map(z => `<option value="${z.numero}">${z.numero} · ${z.posti} p</option>`).join('') || '<option value="">—</option>'}</select></label><button class="btn ghost sm" id="tv_unisci">🔗 Unisci</button>`}
          </div></div>`}
        <div id="tv_msg" class="muted" style="font-size:.8rem;margin-top:8px"></div>
        <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
      const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal;

      // L'avviso si spegne quando l'operatore dichiara di aver parlato col cliente: non da solo
      // dopo tot secondi, e non aprendo il tavolo — aprirlo non vuol dire aver avvisato nessuno.
      document.querySelectorAll('[data-avvletto]').forEach(b => b.onclick = async () => {
        await api('/comande/' + b.dataset.avvletto + '/avviso-letto', { method: 'PUT', body: '{}' });
        closeModal(); show('pianta');
      });
      const agisci = async (id, stato) => { await api('/comande/' + id + '/stato', { method: 'PUT', body: JSON.stringify({ stato }) }); closeModal(); show('pianta'); };
      document.querySelectorAll('[data-cchiudi]').forEach(x => x.onclick = () => agisci(x.dataset.cchiudi, 'chiusa'));
      // "Annulla" buttava via la comanda senza chiedere niente: un dito storto in mezzo al
      // servizio e il conto del tavolo spariva, con dentro roba gia' mangiata. Ora si dice
      // cosa si sta per perdere — numero, importo, quante righe — e si chiede conferma.
      document.querySelectorAll('[data-cann]').forEach(x => x.onclick = () => {
        const c = cs.find(z => String(z.id) === String(x.dataset.cann));
        const righe = c ? (c.righe || []).filter(r => !r.parent_riga_id && r.stato !== 'stornata') : [];
        const elenco = righe.slice(0, 6).map(r => `\u00b7 ${r.qta}\u00d7 ${r.nome}`).join('\n');
        const testo = `ANNULLARE la comanda #${c ? c.numero : ''} del tavolo ${n}?\n\n${elenco}${righe.length > 6 ? '\n\u2026 e altre ' + (righe.length - 6) : ''}\n\nImporto: ${c ? eur(c.totale) : ''}\n\nLa comanda sparisce dal conto del tavolo. Se il cliente ha gia' consumato, questa NON e' la strada: usa \u201cstorna\u201d sulla singola riga.`;
        if (!confirm(testo)) return;
        agisci(x.dataset.cann, 'annullata');
      });
      // Il gruppo si sposta: al sole non si sta, si libera un tavolo piu' grande, due tavolate
      // si accorpano. La comanda deve seguirli, altrimenti a fine turno il conto si presenta a
      // chi non ha mangiato quella roba.
      document.querySelectorAll('[data-cmuovi]').forEach(b => b.onclick = async () => {
        const dove = prompt('Su quale tavolo si spostano?');
        if (dove == null || !String(dove).trim()) return;
        let r;
        try { r = await api('/comande/' + b.dataset.cmuovi + '/tavolo', { method: 'PUT', body: JSON.stringify({ riferimento: String(dove).trim() }) }); }
        catch (e) { alert(e.message); return; }
        // Se il tavolo di arrivo e' gia' prenotato per un altro turno, lo spostamento si fa
        // lo stesso ma chi accoglie deve saperlo.
        if (r && r.avviso) alert(r.avviso);
        closeModal(); show('pianta');
      });
      // Il conto diviso: la crew dice in quanti sono e legge la quota, senza fare i conti a
      // mente davanti al tavolo. Il totale resta uno: si divide solo per comodita' di chi paga.
      // Si divide per i POSTI OCCUPATI, non per i posti del tavolo: se sono in tre a un tavolo
      // da quattro, si divide per tre. E si arrotonda SEMPRE PER ECCESSO al centesimo: fare
      // pagare a qualcuno un centesimo in meno costringe il cameriere a ricordarsi chi e'
      // "l'ultimo" mentre quattro persone gli passano i soldi. La differenza o si restituisce
      // o resta mancia.
      const quota = () => {
        const n = Math.max(1, Number(($('#cnt_div') || {}).value) || 1);
        const q = $('#cnt_quota');
        if (!q) return;
        if (n <= 1) { q.textContent = ''; return; }
        const aTesta = Math.ceil((totaleTavolo / n) * 100) / 100;
        const scarto = Math.round((aTesta * n - totaleTavolo) * 100) / 100;
        q.innerHTML = `${eur(aTesta)} a testa` + (scarto > 0
          ? ` <span class="muted" style="font-weight:400">(${eur(aTesta * n)} in tutto \u00b7 ${eur(scarto)} in pi\u00f9: resto o mancia)</span>`
          : '');
      };
      if ($('#cnt_div')) { $('#cnt_div').oninput = quota; quota(); }
      // Storno di una riga: serve il motivo, perche' e' quello che vale davanti a una
      // contestazione. Funziona anche se la comanda e' gia' in cucina.
      document.querySelectorAll('[data-storna]').forEach(b => b.onclick = async () => {
        const motivo = prompt('Perché si storna questa riga?\n(articolo finito, riga sbagliata, il cliente rinuncia…)');
        if (motivo == null || !motivo.trim()) return;
        try { await api('/comande/righe/' + b.dataset.storna + '/storna', { method: 'PUT', body: JSON.stringify({ motivo: motivo.trim() }) }); }
        catch (e) { alert(e.message); return; }
        closeModal(); show('pianta');
      });
      // Un conto solo: si chiudono tutte insieme, comprese quelle arrivate dal QR.
      const bottoneConto = document.querySelector('[data-contochiudi]');
      // Il conto del tavolo chiudeva con un cambio di stato: niente metodo di pagamento, niente
      // ricevuta. Passa dalla stessa cassa del banco, altrimenti al Garden l'incasso non si sa
      // mai come e' entrato e il cliente non ha nessuna copia.
      if (bottoneConto) bottoneConto.onclick = () => {
        const ids = bottoneConto.dataset.contochiudi.split(',').filter(Boolean);
        if (!confirm(`Chiudere il conto del tavolo ${n}? Sono ${ids.length} ${ids.length === 1 ? 'comanda' : 'comande'}, pagate insieme.`)) return;
        pickMetodo(async (metodo, email, tessera_code, pin) => {
          let inviata = null;
          for (const id of ids) {
            const r = await api('/comande/' + id + '/chiudi', { method: 'POST', body: JSON.stringify({ metodo, email, tessera_code, pin }) });
            // L'indirizzo si usa una volta sola: il cliente non vuole quattro mail per un conto.
            if (r && r.ricevuta_inviata && !inviata) { inviata = r.ricevuta_a; email = ''; }
          }
          if (inviata) alert('Copia del conto inviata a ' + inviata + '.\nLo scontrino fiscale va consegnato lo stesso.');
          closeModal(); show('pianta');
        });
      };

      if ($('#tv_ordina')) $('#tv_ordina').onclick = () => apriComandaTavolo(n, chi, zonaC);
      if ($('#tv_libera')) $('#tv_libera').onclick = async () => {
        if (!confirm('Liberare il tavolo?')) return;
        await api('/tavoli/prenotazioni/' + pren.id, { method: 'PUT', body: JSON.stringify({ stato: 'annullato' }) });
        closeModal(); show('pianta');
      };
      if ($('#tv_pren')) $('#tv_pren').onclick = () => apriPrenotaTavolo(n, t);

      // Forma, posti e unione si fanno da qui: non serve piu' passare in "Modifica pianta".
      const salvaPianta = async (cambia) => {
        const base = (PIANTA.tavoli && PIANTA.tavoli.length) ? PIANTA.tavoli : (turnoDati.tavoli || []);
        const tavoli = base.map(x => ({ numero: x.numero, posti: x.posti, forma: x.forma, x: x.x, y: x.y, attivo: x.attivo === 0 ? false : true, uniti: x.uniti || [], tipo: x.tipo, quota: x.quota }));
        cambia(tavoli);
        try {
          await api('/tavoli/layout/' + turnoDati.layout.id, { method: 'PUT', body: JSON.stringify({ tavoli }) });
          closeModal(); PIANTA.sporco = false; show('pianta');
        } catch (e) { $('#tv_msg').textContent = e.message; }
      };
      if ($('#tv_applica')) $('#tv_applica').onclick = () => salvaPianta((tav) => {
        const x = tav.find(z => z.numero === n); if (!x) return;
        x.posti = Math.max(1, Number($('#tv_p').value) || x.posti);
        x.forma = $('#tv_f').value;
      });
      if ($('#tv_unisci')) $('#tv_unisci').onclick = () => {
        const altro = Number(($('#tv_u') || {}).value);
        if (!altro) { $('#tv_msg').textContent = 'Nessun tavolo libero da unire.'; return; }
        const sr = turnoDati.serata || { max_tavoli_uniti: 3, etichetta: '', consiglio: '' };
        const gia = 1 + ((t.uniti || []).length);
        if (gia >= sr.max_tavoli_uniti) {
          alert(`Serata ${sr.etichetta}: non accostare piu' di ${sr.max_tavoli_uniti} tavoli.\n\n${sr.consiglio}`);
          return;
        }
        salvaPianta((tav) => {
          const a = tav.find(z => z.numero === n), b2 = tav.find(z => z.numero === altro);
          if (!a || !b2) return;
          // Si ricorda quanti posti aveva il tavolo PRIMA di accostarne un altro. Separando si
          // torna a quel numero, invece di sottrarre: se qualcuno nel frattempo corregge i
          // posti (capita, quando si aggiunge una sedia), la sottrazione lascia un tavolo con
          // un numero sbagliato e la sala non torna piu'.
          if (a.posti_base == null) a.posti_base = Number(a.posti);
          if (b2.posti_base == null) b2.posti_base = Number(b2.posti);
          // Due tavoli da quattro accostati non fanno otto posti comodi: gli angoli si perdono
          // e si mangia col gomito del vicino. Quanti toglierne lo dice un parametro.
          a.posti = Math.max(1, Number(a.posti) + Number(b2.posti) - (Number(turnoDati.posti_persi_unione) || 0));
          a.uniti = [...(a.uniti || []), b2.numero, ...(b2.uniti || [])];
          a.forma = 'rettangolo';
          b2.attivo = false; b2.uniti = [];
        });
      };
      // Si stacca un tavolo per volta: il gruppo si e' presentato in meno, si rende alla sala
      // quello che non serve e si tiene il resto accostato.
      document.querySelectorAll('[data-stacca]').forEach(x => x.onclick = () => {
        const num = Number(x.dataset.stacca);
        salvaPianta((tav) => {
          const a = tav.find(z => z.numero === n), b2 = tav.find(z => z.numero === num);
          if (!a || !b2) return;
          b2.attivo = true;
          b2.posti = b2.posti_base != null ? Number(b2.posti_base) : Number(b2.posti);
          a.uniti = (a.uniti || []).filter(v => Number(v) !== num);
          a.posti = Math.max(1, Number(a.posti) - Number(b2.posti));
          if (!a.uniti.length) {
            if (a.posti_base != null) a.posti = Number(a.posti_base);
            a.forma = 'tondo';
          }
        });
      });
      if ($('#tv_sep')) $('#tv_sep').onclick = () => salvaPianta((tav) => {
        const a = tav.find(z => z.numero === n); if (!a) return;
        for (const num of (a.uniti || [])) {
          const b2 = tav.find(z => z.numero === num);
          if (b2) { b2.attivo = true; if (b2.posti_base != null) b2.posti = Number(b2.posti_base); }
        }
        a.uniti = [];
        if (a.posti_base != null) a.posti = Number(a.posti_base);
        a.forma = 'tondo';
      });
    });
    return;
  }

  if (PIANTA.modo !== 'disposizione') return;

  // --- trascinamento (pointer events: funziona con dito e mouse)
  const canvas = $('#p_canvas');
  canvas.querySelectorAll('.tv').forEach(el => {
    let drag = null;
    el.addEventListener('pointerdown', (ev) => {
      // La cattura tiene il trascinamento anche se il dito esce dal tavolo, ma non e'
      // indispensabile: se il browser la rifiuta si continua lo stesso.
      try { el.setPointerCapture(ev.pointerId); } catch (_) { }
      const r = canvas.getBoundingClientRect();
      drag = { moved: false, r };
      el.style.cursor = 'grabbing';
      ev.preventDefault();
    });
    el.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      drag.moved = true;
      const x = Math.max(3, Math.min(97, ((ev.clientX - drag.r.left) / drag.r.width) * 100));
      const y = Math.max(5, Math.min(95, ((ev.clientY - drag.r.top) / drag.r.height) * 100));
      el.style.left = x + '%'; el.style.top = y + '%';
      const t = PIANTA.tavoli.find(z => z.numero === Number(el.dataset.tv));
      if (t) { t.x = Math.round(x * 10) / 10; t.y = Math.round(y * 10) / 10; }
      PIANTA.sporco = true;
    });
    const fine = (ev) => {
      if (!drag) return;
      el.style.cursor = 'grab';
      const eraDrag = drag.moved; drag = null;
      if (!eraDrag) apriTavolo(Number(el.dataset.tv));
      else if ($('#p_msg')) $('#p_msg').textContent = 'Disposizione modificata: ricordati di salvare.';
    };
    el.addEventListener('pointerup', fine);
    el.addEventListener('pointercancel', fine);
  });

  if ($('#p_addt')) $('#p_addt').onclick = () => {
    const n = PIANTA.tavoli.reduce((m, t) => Math.max(m, t.numero), 0) + 1;
    PIANTA.tavoli.push({ numero: n, posti: 4, forma: 'tondo', x: 50, y: 50, attivo: 1 });
    PIANTA.sporco = true; show('pianta');
  };
  if ($('#p_salva')) $('#p_salva').onclick = async () => {
    try {
      // Qui la lista e' completa davvero: nell'editor i tavoli si aggiungono e si tolgono.
      await api('/tavoli/layout/' + PIANTA.layoutId, { method: 'PUT', body: JSON.stringify({ tavoli: PIANTA.tavoli, completo: true }) });
      PIANTA.sporco = false;
      $('#p_msg').textContent = '✓ Disposizione salvata.';
    } catch (e) { $('#p_msg').textContent = 'Salvataggio non riuscito: ' + e.message; }
  };
  if ($('#p_nuovo')) $('#p_nuovo').onclick = async () => {
    const nome = prompt('Nome della disposizione (es. "Concerto", "Cena unica")');
    if (!nome) return;
    // L'ambiente si dichiara: una disposizione creata nello Stage e' dello Stage, non del Garden.
    const r = await api('/tavoli/layout', { method: 'POST', body: JSON.stringify({ nome, copia_da: PIANTA.layoutId, ambiente: PIANTA.ambiente }) });
    await api('/tavoli/giorno', { method: 'PUT', body: JSON.stringify({ data: PIANTA.data, layout_id: r.id }) });
    PIANTA.sporco = false; show('pianta');
  };
  if ($('#p_giorno')) $('#p_giorno').onclick = async () => {
    await api('/tavoli/giorno', { method: 'PUT', body: JSON.stringify({ data: PIANTA.data, layout_id: PIANTA.layoutId }) });
    $('#p_msg').textContent = '✓ Questa disposizione vale per il ' + PIANTA.data + '.';
  };
};

// Scheda del singolo tavolo in modalita' disposizione: posti, forma, fuori servizio.
function apriTavolo(numero) {
  const t = PIANTA.tavoli.find(z => z.numero === numero);
  if (!t) return;
  openModal(`<h3 style="margin-bottom:8px">Tavolo ${t.numero}</h3>
    <label style="display:block;font-size:.82rem;margin-bottom:6px">Posti <input id="tv_p" type="number" min="1" value="${t.posti}" style="width:80px"></label>
    <label style="display:block;font-size:.82rem;margin-bottom:6px">Forma
      <select id="tv_f"><option value="tondo" ${t.forma === 'tondo' ? 'selected' : ''}>tondo</option><option value="quadrato" ${t.forma === 'quadrato' ? 'selected' : ''}>quadrato</option><option value="rettangolo" ${t.forma === 'rettangolo' ? 'selected' : ''}>rettangolo</option></select></label>
    <label style="display:block;font-size:.82rem;margin-bottom:10px"><input type="checkbox" id="tv_a" ${t.attivo === 0 ? '' : 'checked'}> in servizio stasera</label>
    ${(t.uniti && t.uniti.length)
      ? `<div class="row" style="gap:8px;align-items:center;margin-bottom:10px;background:#f4efe2;border-radius:10px;padding:8px">
          <span style="font-size:.8rem">Unito con <b>${t.uniti.join(', ')}</b></span>
          <button class="btn ghost sm" id="tv_sep">✂️ Separa</button></div>`
      : `<div class="row" style="gap:6px;align-items:center;margin-bottom:10px">
          <label style="font-size:.82rem">Unisci al tavolo <select id="tv_u">${PIANTA.tavoli.filter(z => z.numero !== t.numero && z.attivo !== 0 && !(z.uniti || []).length).map(z => `<option value="${z.numero}">${z.numero} · ${z.posti} p</option>`).join('') || '<option value="">nessuno</option>'}</select></label>
          <button class="btn ghost sm" id="tv_unisci">🔗 Unisci</button></div>`}
    <div class="row" style="gap:8px">
      <button class="btn gold sm" id="tv_ok">Applica</button>
      <button class="btn danger sm" id="tv_del">🗑 Togli il tavolo</button>
      <button class="btn ghost sm" id="tv_no">Chiudi</button>
    </div>`);
  // Unire due tavoli accostati: restano un tavolo solo, con i posti sommati. Il numero
  // assorbito non sparisce dal mondo — i QR gia' stampati continuano a funzionare e le
  // comande finiscono sul tavolo che lo ha assorbito.
  if ($('#tv_unisci')) $('#tv_unisci').onclick = () => {
    const altro = Number(($('#tv_u') || {}).value);
    const b = PIANTA.tavoli.find(z => z.numero === altro);
    if (!b) { alert('Nessun tavolo libero da unire.'); return; }
    t.posti = Number(t.posti) + Number(b.posti);
    t.uniti = [...(t.uniti || []), b.numero, ...(b.uniti || [])];
    t.forma = 'rettangolo';
    b.attivo = 0; b.uniti = [];
    PIANTA.sporco = true; closeModal(); show('pianta');
  };
  if ($('#tv_sep')) $('#tv_sep').onclick = () => {
    for (const n of (t.uniti || [])) {
      const b = PIANTA.tavoli.find(z => z.numero === n);
      if (b) { b.attivo = 1; t.posti = Math.max(1, Number(t.posti) - Number(b.posti)); }
    }
    t.uniti = [];
    PIANTA.sporco = true; closeModal(); show('pianta');
  };
  $('#tv_ok').onclick = () => {
    t.posti = Math.max(1, Number($('#tv_p').value) || 4);
    t.forma = $('#tv_f').value;
    t.attivo = $('#tv_a').checked ? 1 : 0;
    PIANTA.sporco = true; closeModal(); show('pianta');
  };
  $('#tv_del').onclick = () => {
    PIANTA.tavoli = PIANTA.tavoli.filter(z => z.numero !== numero);
    PIANTA.sporco = true; closeModal(); show('pianta');
  };
  $('#tv_no').onclick = closeModal;
}

// ===== MODULO FITNESS (cap 'fitness') — iscritti e incasso a fine lezione ==================
// Il Crew guarda le lezioni con la STESSA griglia dell'app dei soci: settimana, giorni in
// colonna, ore in riga, il colore della disciplina. Chi al banco riceve un socio che dice "la
// lezione di giovedi' alle sette" deve vedere la stessa cosa che vede lui sul telefono, non
// un elenco ordinato in un altro modo. Toccando una lezione si aprono iscrizioni e incassi.
var FIT_SETT = null;
var FIT_LEZ = {};
VIEWS.fitness = async () => {
  const sedute = await api('/fitness/sedute').catch(() => []);
  if (!sedute.length) { $('#view').innerHTML = '<div class="panel"><p class="muted">Nessuna lezione in programma. I corsi si creano nel back office.</p></div>'; return; }
  FIT_LEZ = {}; for (const s of sedute) FIT_LEZ[s.id] = s;

  const lunediDi = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const settimane = [...new Set(sedute.map(s => lunediDi(s.data)))].sort();
  if (!settimane.includes(FIT_SETT)) FIT_SETT = settimane[0];
  const giorni = Array.from({ length: 7 }, (_, i) => new Date(new Date(FIT_SETT + 'T12:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10));

  const oraNum = (o) => Number(String(o || '').slice(0, 2)) || 0;
  const diQuesta = sedute.filter(s => giorni.includes(s.data));
  const ore = diQuesta.map(s => oraNum(s.ora));
  const primo = Math.min(16, ...(ore.length ? ore : [16]));
  const ultimo = Math.max(20, ...(ore.length ? ore : [20]));
  const righeOre = Array.from({ length: Math.max(1, ultimo - primo + 1) }, (_, i) => String(primo + i).padStart(2, '0') + ':00');

  const perCella = {};
  for (const s of diQuesta) (perCella[s.data + '|' + String(s.ora).slice(0, 2) + ':00'] ??= []).push(s);

  const GG = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  const cella = (g, o) => {
    const list = perCella[g + '|' + o] || [];
    if (!list.length) return '<td class="fitv"></td>';
    return `<td class="fitv">${list.map(s => {
      const stato = s.completa ? 'pieno' : s.confermata ? 'ok' : 'attesa';
      const daInc = Number(s.da_incassare || 0);
      return `<button class="fitq ${stato}" style="background:${esc(s.colore || '#2f6d8a')}" data-fitapri="${s.id}" title="${esc(s.corso_nome)} ${esc(s.ora)} · ${s.iscritti}/${s.posti_max}">
        <b>${esc((s.titolo || s.corso_nome).slice(0, 12))}</b><span>${esc(s.ora)} · ${s.iscritti}/${s.posti_max}${daInc > 0 ? ' · 💶' : ''}</span></button>`;
    }).join('')}</td>`;
  };
  const chipSett = settimane.map(w => `<button class="btn ${w === FIT_SETT ? 'gold' : 'ghost'} sm" data-fitsett="${w}">${w.slice(8)}/${w.slice(5, 7)}</button>`).join('');
  // Quello che al banco serve sapere a colpo d'occhio, senza aprire niente.
  const daIncassareTot = diQuesta.reduce((t, s) => t + Number(s.da_incassare || 0), 0);
  const inAttesa = diQuesta.filter(s => !s.confermata).length;

  $('#view').innerHTML = `<div class="panel">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">🧘 Lezioni con istruttore</h3>
        <div class="row" style="gap:6px">${chipSett}</div>
      </div>
      <div class="muted" style="font-size:.82rem;margin:6px 0 10px">${diQuesta.length} lezioni in settimana · ${inAttesa} sotto il minimo · da incassare <b>${eur(daIncassareTot)}</b></div>
      <table class="fitgrid"><thead><tr><th></th>${giorni.map((g, i) => `<th>${GG[i]}<span>${g.slice(8)}</span></th>`).join('')}</tr></thead>
        <tbody>${righeOre.map(o => `<tr><th class="ora">${o.slice(0, 2)}</th>${giorni.map(g => cella(g, o)).join('')}</tr>`).join('')}</tbody></table>
      <p class="muted" style="font-size:.78rem;margin-top:8px">Tocca una lezione per iscrivere al banco e incassare. Il colore è la disciplina; la barra a sinistra dice se è confermata, in attesa o al completo.</p>
    </div>`;
  document.querySelectorAll('[data-fitsett]').forEach(b => b.onclick = () => { FIT_SETT = b.dataset.fitsett; show('fitness'); });
  document.querySelectorAll('[data-fitapri]').forEach(b => b.onclick = () => apriLezione(Number(b.dataset.fitapri)));
};

// Dettaglio della lezione: iscritti, incassi, iscrizione al banco.
function apriLezione(id) {
  const s = FIT_LEZ[id];
  if (!s) return;
  const stato = s.completa ? '<span class="tag no">al completo</span>'
    : s.confermata ? '<span class="tag ok">confermata</span>'
    : `<span class="tag" style="background:#f4ead6;color:#8a5a12">in attesa · mancano ${s.mancano}</span>`;
  const righe = (s.elenco || []).map(i => `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
      <span>${esc(i.nome || i.tessera_code || '—')}</span>
      <button class="btn ${i.pagato ? 'ghost' : 'gold'} sm" data-fitpag="${i.id}|${i.pagato ? 0 : 1}">${i.pagato ? '✓ pagato' : '💶 incassa'}</button>
    </div>`).join('');
  openModal(`<h3 style="margin-top:0">${esc(s.titolo || s.corso_nome)}${s.masterclass ? ' 🌟' : ''}</h3>
    <p class="muted" style="font-size:.84rem;margin-top:-6px">${esc(s.data)} · ${esc(s.ora)} · ${s.durata_min}′${s.istruttore ? ' · ' + esc(s.istruttore) : ''}</p>
    <div class="row" style="justify-content:space-between;align-items:center">${stato}<span class="muted">${s.iscritti}/${s.posti_max} · ${eur(s.prezzo)}</span></div>
    <div style="margin-top:8px;max-height:40vh;overflow:auto">${righe || '<p class="muted">Nessun iscritto.</p>'}
      ${(s.disdette_dovute || []).length ? `<div style="margin-top:10px;background:#fdf1e7;border-left:4px solid #C0553F;border-radius:0 8px 8px 0;padding:8px 10px">
        <b style="color:#8a3a2a;font-size:.85rem">Disdette tardive \u00b7 la lezione resta dovuta</b>
        ${s.disdette_dovute.map(x => `<div class="row" style="justify-content:space-between;align-items:center;font-size:.85rem;padding:3px 0">
          <span>${esc(x.nome || x.tessera_code || '\u2014')}</span>
          <button class="btn gold sm" data-fitpag="${x.id}|1">\ud83d\udcb6 incassa ${eur(s.prezzo)}</button></div>`).join('')}
      </div>` : ''}</div>
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <input id="fit_t_${s.id}" placeholder="Tessera o nome" style="min-width:150px">
      <button class="btn gold sm" data-fitadd="${s.id}">+ Iscrivi al banco</button>
      <span class="muted" style="font-size:.82rem">da incassare <b>${eur(s.da_incassare)}</b></span>
    </div>
    <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-mclose>Chiudi</button></div>`);
  const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal;
  document.querySelectorAll('[data-fitpag]').forEach(b => b.onclick = async () => {
    const [id, v] = b.dataset.fitpag.split('|');
    await api('/fitness/prenotazioni/' + id, { method: 'PUT', body: JSON.stringify({ pagato: v === '1' }) });
    show('fitness');
  });
  document.querySelectorAll('[data-fitadd]').forEach(b => b.onclick = async () => {
    const v = ($('#fit_t_' + b.dataset.fitadd) || {}).value || '';
    const body = /^BR-/i.test(v.trim()) ? { tessera_code: v.trim().toUpperCase() } : { nome: v.trim() || 'Ospite' };
    try { await api('/fitness/sedute/' + b.dataset.fitadd + '/iscrivi', { method: 'POST', body: JSON.stringify(body) }); show('fitness'); }
    catch (e) { alert(e.message); }
  });
}


// ===== MODULO CINEMA (cap 'cinema') — platea e ingressi ====================================
let CINE_SEL = null;
VIEWS.cinema = async () => {
  const pr = (await api('/proiezioni').catch(() => [])).filter(p => p.stato !== 'annullata');
  if (!pr.length) { $('#view').innerHTML = '<div class="panel"><p class="muted">Nessuna proiezione in programma. Il cartellone si compone nel back office.</p></div>'; return; }
  if (!CINE_SEL || !pr.some(p => p.id === CINE_SEL)) CINE_SEL = pr[0].id;
  const d = await api('/proiezioni/' + CINE_SEL + '/platea');
  const chips = pr.map(p => `<button class="btn ${p.id === CINE_SEL ? 'gold' : 'ghost'} sm" data-cinesel="${p.id}">${esc(p.data.slice(8) + '/' + p.data.slice(5, 7))} · ${esc(p.titolo || '—')}</button>`).join('');
  $('#view').innerHTML = `
    <div class="panel"><b style="color:var(--navy)">🎭 Stage</b>
      <p class="muted" style="font-size:.78rem;margin-top:4px">La <b>platea</b> — palco, sedute, chi è a sedere e prenotazione al banco toccando la seduta — sta nella tab <b>Pianta</b>. Qui il programma e il conto degli ingressi, senza ripetere la stessa mappa due volte.</p></div>
    <div class="panel"><b style="color:var(--navy)">🎬 Proiezioni e spettacoli</b>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${chips}</div></div>
    <div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><b style="color:var(--navy)">${esc(d.proiezione.titolo || '')}</b>
          <div class="muted" style="font-size:.82rem">${esc(d.proiezione.data)} · ${esc(d.proiezione.ora)}</div></div>
        <div style="text-align:right"><b>${d.coperti_prenotati}</b> <span class="muted">in sala</span>
          <div class="muted" style="font-size:.82rem">${d.standard_liberi} standard liberi · ${d.posti_liberi} in tutto</div></div>
      </div></div>
    <div class="panel"><b style="color:var(--navy)">🎟️ Ingressi</b>
      <div style="margin-top:8px">${(d.prenotazioni || []).map(p => `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(p.nome || '—')}</b> <span class="muted">· ${p.persone}p · posti ${p.tavoli.join(', ')}${/cena/i.test(p.note || '') ? ' · con cena' : ''}</span></span>
        <button class="btn ghost sm" data-cineann="${p.id}">Annulla</button></div>`).join('') || '<p class="muted">Nessun ingresso prenotato.</p>'}</div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <input id="cine_chi" placeholder="Tessera o nome" style="min-width:140px">
        <input id="cine_p" type="number" min="1" value="2" style="width:64px">
        <button class="btn gold sm" id="cine_add">+ Metti a sedere</button>
      </div><div id="cine_msg" class="muted" style="font-size:.8rem;margin-top:6px"></div></div>`;
  document.querySelectorAll('[data-cinesel]').forEach(b => b.onclick = () => { CINE_SEL = Number(b.dataset.cinesel); show('cinema'); });
  document.querySelectorAll('[data-cineann]').forEach(b => b.onclick = async () => {
    if (!confirm('Annullare l\'ingresso?')) return;
    await api('/proiezioni/prenotazioni/' + b.dataset.cineann, { method: 'PUT', body: '{}' });
    show('cinema');
  });
  $('#cine_add').onclick = async () => {
    const v = ($('#cine_chi').value || '').trim();
    const body = { persone: Number($('#cine_p').value) || 1 };
    if (/^(RB|BR)-/i.test(v)) body.tessera_code = v.toUpperCase(); else body.nome = v || 'Ospite';
    try { await api('/proiezioni/' + CINE_SEL + '/prenota', { method: 'POST', body: JSON.stringify(body) }); show('cinema'); }
    catch (e) { $('#cine_msg').textContent = e.message; }
  };
};

// QR self-order dei tavoli realmente presenti nella disposizione: uno per foglio A4.
async function stampaQrTavoli(tavoli, ambiente) {
  if (!tavoli.length) { alert('Nessun tavolo nella disposizione.'); return; }
  const punto = ambiente === 'carta' ? 'Casa di Carta' : 'Bussola Garden';
  const out = [];
  let errore = '';
  for (const t of tavoli) {
    // L'indirizzo giusto e' `/qr-ordina`: api() antepone gia' /api/admin. Con `/../qr-ordina`
    // il browser normalizzava in /api/qr-ordina, che non esiste — e l'errore, ingoiato dal
    // catch, lasciava solo un "QR non disponibili" che non diceva niente a nessuno.
    try { out.push(await api(`/qr-ordina?punto=${encodeURIComponent(punto)}&tavolo=${t.numero}`)); }
    catch (e) { errore = e.message || String(e); }
  }
  if (!out.length) { alert('QR non generati' + (errore ? ': ' + errore : '.')); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare.'); return; }
  const pagina = (r) => `<section><div class="k">Ordina qui</div><h1>${esc(r.punto)}</h1>
      <h2>Tavolo ${esc(String(r.tavolo))}</h2><div class="qr">${r.svg}</div>
      <p>Inquadra il QR con la fotocamera e ordina dal tuo telefono.</p></section>`;
  w.document.write(`<html><head><title>QR tavoli</title><style>
    @page{size:A4;margin:20mm}
    body{font-family:Georgia,'Times New Roman',serif;color:#12324F;margin:0}
    section{height:calc(297mm - 40mm);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;break-after:page}
    section:last-child{break-after:auto}
    .k{font-family:Arial,sans-serif;letter-spacing:4px;font-size:.8rem;color:#9a8a5f;text-transform:uppercase}
    h1{font-size:2rem;margin:6px 0 0} h2{font-family:Arial,sans-serif;font-size:1.1rem;margin:4px 0 0;color:#5a6b75}
    .qr{margin:22px 0} .qr svg{width:280px;height:280px}
    p{font-family:Arial,sans-serif;font-size:.9rem;color:#5a6b75;max-width:70%}
  </style></head><body>${out.map(pagina).join('')}
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
  w.document.close();
}

// Comanda presa DAL TAVOLO: il numero non si digita, e' quello che hai toccato. Con il nome
// di chi ha prenotato in testa, cosi' si serve chiamando le persone per come si chiamano.
async function apriComandaTavolo(numero, chi, zona) {
  // TUTTO IL MENU', non solo quello della zona. Il cliente e' al Garden e chiede uno spritz:
  // che lo prepari il banco e' un fatto nostro, non suo. Filtrare per zona costringeva il
  // cameriere a dire "quello lo vendiamo solo al bar" — una frase che descrive la nostra
  // organizzazione, non il desiderio di chi ordina. Le comande sanno gia' andare alla stazione
  // giusta: il cocktail al banco, il panino in cucina.
  const menu = await api('/menu?ordinabile=1').catch(() => []);
  if (!menu.length) { alert('Menù vuoto: caricalo dalla tab Menù.'); return; }
  openModal(`<h3>🧾 Comanda · tavolo ${numero}</h3>
    ${chi ? `<p class="muted" style="margin-top:-4px">per <b>${esc(chi)}</b></p>` : ''}
    <div id="ct_menu" style="max-height:46vh;overflow:auto"></div>
    <div id="ct_cart" style="margin-top:8px"></div>
    <div id="ct_tot" style="text-align:right;font-weight:800;margin-top:6px"></div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn gold" id="ct_invia" disabled>Invia in cucina</button>
      <button class="btn ghost" data-mclose>Annulla</button></div>
    <div id="ct_msg" class="muted" style="font-size:.8rem;margin-top:6px"></div>`, { protetta: true });
  const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal;
  const disegnaCarrello = (cart) => {
    const ids = Object.keys(cart || {});
    $('#ct_cart').innerHTML = ids.length
      ? ids.map(id => { const m = menu.find(x => String(x.id) === id); return `<div class="row" style="justify-content:space-between;font-size:.86rem;padding:2px 0"><span>${cart[id]}× ${esc(m.nome)}</span><span>${eur(m.prezzo * cart[id])}</span></div>`; }).join('')
      : '<span class="muted" style="font-size:.85rem">Tocca un prodotto del menù.</span>';
  };
  const CO = Comanda.create({
    mount: $('#ct_menu'), menu, search: true,
    // Il piatto finito si spegne da qui: il cameriere e' al tavolo, uscire dalla comanda per
    // andare nel menu' vorrebbe dire lasciare il cliente ad aspettare — e intanto un altro
    // tavolo ordina lo stesso piatto.
    esaurito: async (m) => {
      try { await api('/menu/' + m.id, { method: 'PUT', body: JSON.stringify({ attivo: false }) }); }
      catch (e) { alert(e.message); return; }
      const i = menu.findIndex(x => x.id === m.id);
      if (i >= 0) menu.splice(i, 1);
      closeModal();
      alert(m.nome + ' segnato esaurito: non compare piu\u0300 nel men\u00f9.');
    },
    onChange: (cart, tot, n) => { $('#ct_tot').textContent = 'Totale ' + eur(tot); disegnaCarrello(cart); $('#ct_invia').disabled = !n; }
  });
  disegnaCarrello({});
  $('#ct_invia').onclick = async () => {
    const righe = CO.getRighe();
    if (!righe.length) return;
    try {
      const r = await api('/comande', { method: 'POST', body: JSON.stringify({ origine: 'tavolo', zona, riferimento: String(numero), nome: chi || null, righe }) });
      // Il cameriere deve poterlo dire al cliente prima di andarsene dal tavolo.
      if (r && r.avviso) alert('🔥 ' + r.avviso);
      closeModal(); show('pianta');
    } catch (e) { $('#ct_msg').textContent = e.message; }
  };
}

// Prenotazione al banco per un tavolo preciso: si tocca il tavolo, non si sceglie da un elenco.
function apriPrenotaTavolo(numero, t) {
  const stage = PIANTA.ambiente === 'stage';
  openModal(`<h3>${stage ? 'Seduta' : 'Tavolo'} ${numero} · ${esc(PIANTA.turno)}</h3>
    <p class="muted" style="font-size:.82rem;margin-top:-4px">${t.posti} ${t.posti === 1 ? 'posto' : 'posti'}${t.tipo === 'extra' ? ' · extra' : ''}</p>
    <label style="display:block;font-size:.82rem;margin-bottom:6px">Nome o tessera <input id="pr_chi" placeholder="BR-2026-0001 oppure Sig. Rossi"></label>
    <label style="display:block;font-size:.82rem;margin-bottom:10px">Persone <input id="pr_p" type="number" min="1" value="${Math.min(2, t.posti)}" style="width:80px"></label>
    <div class="row" style="gap:8px"><button class="btn gold sm" id="pr_ok">Prenota</button><button class="btn ghost sm" data-mclose>Annulla</button></div>
    <div id="pr_msg" class="muted" style="font-size:.8rem;margin-top:6px"></div>`);
  const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = closeModal;
  $('#pr_ok').onclick = async () => {
    const v = ($('#pr_chi').value || '').trim();
    const body = { data: PIANTA.data, turno: PIANTA.turno, persone: Number($('#pr_p').value) || 1, tavoli: [numero] };
    if (/^(RB|BR)-/i.test(v)) body.tessera_code = v.toUpperCase(); else body.nome = v || 'Ospite';
    const rotta = PIANTA.ambiente === 'carta' ? '/carta/prenota' : stage ? null : '/tavoli/prenota';
    try {
      if (rotta) await api(rotta, { method: 'POST', body: JSON.stringify(body) });
      else {
        const pr = (await api('/proiezioni').catch(() => [])).find(x => x.data === PIANTA.data && x.ora === PIANTA.turno);
        if (!pr) throw new Error('Nessuno spettacolo in questa fascia.');
        await api('/proiezioni/' + pr.id + '/prenota', { method: 'POST', body: JSON.stringify(body) });
      }
      closeModal(); show('pianta');
    } catch (e) { $('#pr_msg').textContent = e.message; }
  };
}

// Lettura del QR della tessera con la fotocamera. Usa il lettore di codici del browser quando
// c'e' (Chrome su Android), altrimenti spiega come fare invece di lasciare un tasto morto.
async function scansionaTessera(quando) {
  if (!('BarcodeDetector' in window)) {
    const manuale = prompt('Questo browser non sa leggere i codici dalla fotocamera.\nDigita o incolla il codice della tessera:');
    if (manuale) quando(manuale.trim().toUpperCase());
    return;
  }
  let stream = null;
  openModal(`<h3>📷 Inquadra la tessera</h3>
    <video id="sc_v" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000"></video>
    <p class="muted" style="font-size:.8rem;margin-top:8px">Tieni il QR della tessera dentro il riquadro.</p>
    <div class="row" style="gap:8px"><button class="btn ghost sm" data-mclose>Annulla</button></div>
    <div id="sc_msg" class="muted" style="font-size:.8rem;margin-top:6px"></div>`);
  const chiudi = () => { if (stream) stream.getTracks().forEach(t => t.stop()); closeModal(); };
  const cb = $('#mbox').querySelector('[data-mclose]'); if (cb) cb.onclick = chiudi;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#sc_v'); v.srcObject = stream;
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const cerca = async () => {
      if (!stream) return;
      try {
        const codici = await det.detect(v);
        if (codici && codici.length) {
          const testo = String(codici[0].rawValue || '').trim();
          const m = testo.match(/BR-\d{4}-\d{4}/i);
          chiudi();
          quando((m ? m[0] : testo).toUpperCase());
          return;
        }
      } catch (_) { }
      setTimeout(cerca, 300);
    };
    cerca();
  } catch (e) {
    $('#sc_msg').textContent = 'Fotocamera non disponibile: ' + (e.message || e);
  }
}

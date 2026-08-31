/* Back office Bussola Residence — SPA minimale su fetch/API. */
'use strict';
let TOKEN = null, USER = null, PAR = {}, CASATE = [], ME = { ruolo: '', gestore: false, caps: [] };
const can = (cap) => ME.gestore || (ME.caps || []).includes(cap);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Base API: nell'app Staff (APK) è iniettato window.KOINE_API con l'indirizzo del server online;
// nel back office web resta vuoto (chiamate relative allo stesso server).
// L'indirizzo del server si puo' impostare da fuori: si accetta il nome nuovo e si continua
// ad accettare quello vecchio, perche' potrebbe essere gia' scritto in una pagina che non
// controlliamo. Rinominare a secco avrebbe rotto quelle installazioni senza avvisare nessuno.
const API_BASE = (typeof window !== 'undefined' && (window.BUSSOLA_API || window.KOINE_API)) ? String(window.BUSSOLA_API || window.KOINE_API).replace(/\/$/, '') : '';

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
    await caricaParametri();
    show('dashboard');
  } catch (e) { $('#loginErr').textContent = e.message; }
}
function logout() { TOKEN = null; USER = null; ME = { ruolo: '', gestore: false, caps: [] }; $('#app').style.display = 'none'; $('#login').style.display = 'flex'; }

// Mostra nel menu solo le voci consentite dai permessi (il Cruscotto è sempre visibile).
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
  $('#viewTitle').textContent = { dashboard:'Cruscotto', soci:'Utenti', casate:'Casate & punti', cdc:'Casa di Carta', sala:'Coworking & sala', discipline:'Discipline', campi:'Campi & prenotazioni', tabellone:'Tornei', contest:'Contest Serata dei Clan', serate:'Serate & cena', proposte:'Proposte', eventi:'Eventi', avvisi:'Avvisi push', bussola:'Guida', luoghi:'Luoghi (Siamo qui)', operatori:'Operatori & permessi', cinema:'Cinema', fitness:'Area fitness', installa:'Installa app (QR)', parametri:'Regole & parametri', database:'Database', audit:'Registro attività' }[v] || v;
  $('#view').innerHTML = '<p class="muted">Carico…</p>';
  window.__view = v;
  try { await VIEWS[v](); } catch (e) { $('#view').innerHTML = `<p class="muted">Errore: ${esc(e.message)}</p>`; }
  try { abilitaFold(); } catch (e) { }
}

// ---- Cruscotto ----
// ---- Cruscotto: cosa succede adesso, e cosa chiede una mano ----
// Prima erano sei totali storici quasi sempre a zero. Un cruscotto serve a decidere: qui c'e'
// il servizio in corso, la giornata di oggi area per area, e le cose che richiedono un
// intervento — ognuna con la scorciatoia al posto giusto, back office o Crew.
VIEWS.dashboard = async () => {
  const [c, s] = await Promise.all([api('/cruscotto'), api('/stats').catch(() => null)]);
  const CREW = (window.BUSSOLA_API || window.KOINE_API || '') + '/chiosco/';
  const box = (n, l, col, extra) => `<div class="stat"${extra || ''}><div class="n" ${col ? `style="color:${col}"` : ''}>${n}</div><div class="l">${l}</div></div>`;
  const g = c.giornata;

  const avvisi = c.attenzione.length
    ? `<div class="panel" style="border-left:4px solid var(--gold)"><h3>⚠️ Richiede una mano</h3>
        ${c.attenzione.map(a => `<div class="row" style="justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)">
          <span>${esc(a.testo)}</span>
          ${a.vai === 'chiosco' ? `<a class="btn ghost sm" href="${CREW}" target="_blank">Apri il Crew ↗</a>`
            : `<button class="btn ghost sm" data-vai="${esc(a.vai)}">Vai</button>`}
        </div>`).join('')}
      </div>`
    : `<div class="panel"><h3>✅ Tutto in ordine</h3><p class="muted">Nessuna comanda in ritardo, nessun articolo sotto scorta, niente in attesa di risposta.</p></div>`;

  const riga = (etichetta, valore, nota) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
      <span>${etichetta}</span><span><b>${valore}</b>${nota ? ` <span class="muted">${nota}</span>` : ''}</span></div>`;

  const lez = g.lezioni.map(l => `<div class="row" style="justify-content:space-between;padding:5px 0">
      <span>${esc(l.ora)} · <b>${esc(l.nome)}</b></span>
      <span>${l.iscritti}/${l.posti_max} ${l.confermata ? '<span class="tag ok">confermata</span>' : `<span class="tag mid">mancano ${Math.max(0, l.min_iscritti - l.iscritti)}</span>`}</span></div>`).join('');
  const spet = [...g.proiezioni.map(p => `🎬 ${esc(p.ora)} · ${esc(p.titolo || 'proiezione')}`),
                ...g.sala.map(p => `🗓️ ${esc(p.ora_inizio)}–${esc(p.ora_fine)} · ${esc(p.titolo || p.scopo)}`)].join('<br>');

  // Il cartellone della Coppa non sta piu' qui: si guarda in "Casate & punti". Al suo posto
  // cio' che serve a chi apre il servizio: chi e' atteso, dove, e cosa e' rimasto indietro.
  const listaOspiti = (arr) => arr.length
    ? arr.map(o => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(o.nome || '—')}</b> <span class="muted">· ${o.persone} p</span></span>
        <span class="muted">${(o.tavoli || []).length ? 'tav. ' + o.tavoli.join(', ') : ''}</span></div>`).join('')
    : '<p class="muted">Nessuno atteso.</p>';

  $('#view').innerHTML = `
    <div class="cards">
      ${box(c.servizio.comande_aperte, 'comande aperte', c.servizio.in_ritardo ? 'var(--danger)' : null)}
      ${box(c.servizio.in_ritardo, 'in ritardo', c.servizio.in_ritardo ? 'var(--danger)' : 'var(--ok)')}
      ${box(g.garden_coperti, 'coperti Garden oggi')}
      ${box(g.campi, 'campi prenotati oggi')}
      ${box(g.stage_posti, 'posti Stage oggi')}
      ${box(c.soci, 'soci attivi')}
    </div>
    ${avvisi}
    <div class="panel" data-fold="attesi"><h3>🍽️ Chi è atteso stasera al Garden</h3>
      <div class="grid2">
        ${(c.turni_garden || []).map(t => `<div>
          <b style="color:var(--navy)">Turno ${esc(t.turno)}</b> <span class="muted">· ${t.coperti}/${t.posti} coperti</span>
          <div style="margin-top:6px">${listaOspiti(t.ospiti)}</div></div>`).join('')}
      </div>
      <div class="row" style="margin-top:10px"><a class="btn gold sm" href="${CREW}" target="_blank">Apri Bussola Crew ↗</a></div>
    </div>
    <div class="grid2">
      <div class="panel" data-fold="servizio"><h3>🍸 Servizio ora <span class="muted" style="font-weight:400;font-size:13px">· ${esc(c.ora)}</span></h3>
        ${c.servizio.per_zona.map(z => riga(esc(z.zona), z.n, z.n ? 'comande aperte' : '—')).join('')}
      </div>
      <div class="panel" data-fold="giornata"><h3>📅 Il resto della giornata</h3>
        ${riga('Tavoli Casa di Carta', g.carta_tavoli)}
        ${riga('Posti allo Stage', g.stage_posti)}
        ${riga('Prenotazioni campi', g.campi)}
        ${spet ? `<p style="margin-top:8px;font-size:13px">${spet}</p>` : '<p class="muted" style="margin-top:8px">Nessuno spettacolo o riunione in programma.</p>'}
      </div>
    </div>
    <div class="grid2">
      <div class="panel" data-fold="lezioni"><h3>🧘 Lezioni di oggi</h3>${lez || '<p class="muted">Nessuna lezione.</p>'}</div>
      <div class="panel" data-fold="scorte"><h3>📦 Sotto scorta</h3>
        ${c.scorte.length ? c.scorte.map(a => riga(esc(a.nome), a.giacenza, `punto di riordino ${a.punto_riordino}`)).join('') : '<p class="muted">Nessun articolo sotto il punto di riordino.</p>'}
        ${c.scorte.length ? '<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-vai="magazzino">Vai al magazzino</button></div>' : ''}
      </div>
    </div>
    ${(c.campi_oggi || []).length ? `<div class="panel" data-fold="campioggi"><h3>🎾 Campi di oggi</h3>
      ${c.campi_oggi.map(x => riga(`${esc(x.slot)} · ${esc(x.campo)}`, esc(x.nome || '—'))).join('')}</div>` : ''}
    ${c.coppa.partite_da_giocare ? `<div class="panel"><p class="muted">🏆 Coppa: <b>${c.coppa.partite_da_giocare}</b> partite ancora da giocare. <button class="btn ghost sm" data-vai="casate">Vai al cartellone</button></p></div>` : ''}`;
  document.querySelectorAll('[data-vai]').forEach(b => b.onclick = () => show(b.dataset.vai));
};


// ---- Confronto teorico / reale ----
// Il numero teorico non serve a scaricare: serve a essere smentito dalla conta. La colonna
// che conta e' lo SCOSTAMENTO, non il valore assoluto — uno scarto stabile e' fisiologico,
// uno che cambia all'improvviso e' un fatto da guardare.
VIEWS.confronto = async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const setteFa = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const da = window.__cda || setteFa, a = window.__cdb || oggi;
  const d = await api(`/magazzino/confronto?da=${da}&a=${a}`);
  const col = (p) => p == null ? '' : Math.abs(p) < 10 ? 'var(--ok)' : Math.abs(p) < 25 ? 'var(--gold)' : 'var(--danger)';
  $('#view').innerHTML = `
    <div class="panel" data-fold="confronto"><h3>⚖️ Consumi: teorico e reale</h3>
      <p class="muted">${esc(d.nota)}</p>
      <div class="row" style="gap:8px;align-items:flex-end;margin:10px 0">
        <div><label>Dal</label><input type="date" id="cd_da" value="${esc(d.da)}"></div>
        <div><label>Al</label><input type="date" id="cd_a" value="${esc(d.a)}"></div>
        <button class="btn gold sm" id="cd_go">Aggiorna</button>
      </div>
      <table class="fit"><thead><tr><th>Articolo</th><th>Teorico</th><th>Contato</th><th>Scostamento</th><th>Sfrido dichiarato</th></tr></thead>
      <tbody>${(d.righe || []).map(r => `<tr>
        <td><b>${esc(r.nome)}</b> <span class="muted">${esc(r.unita || '')}</span></td>
        <td>${r.teorico}</td><td>${r.reale}</td>
        <td style="color:${col(r.scarto_pct)};font-weight:700">${r.scarto > 0 ? '+' : ''}${r.scarto}${r.scarto_pct != null ? ` <span style="font-weight:400">(${r.scarto_pct > 0 ? '+' : ''}${r.scarto_pct}%)</span>` : ''}</td>
        <td class="muted">${r.sfrido_pct || 0}%</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessun consumo nel periodo. Il teorico si popola quando le comande vengono chiuse e le voci di menù hanno una distinta.</td></tr>'}</tbody></table>
      <p class="muted" style="font-size:13px;margin-top:10px">Come si legge: <b>teorico</b> è quanto sarebbe uscito secondo le ricette, sfrido compreso.
      <b>Contato</b> è quanto è uscito davvero, dagli scarichi e dalle rettifiche. Verde sotto il 10%, ocra fino al 25%, rosso oltre:
      non è un giudizio, è un invito a guardare.</p>
    </div>`;
  $('#cd_go').onclick = () => { window.__cda = $('#cd_da').value; window.__cdb = $('#cd_a').value; show('confronto'); };
};

// ---- Database (voce dedicata, solo gestore): stato persistenza + backup ----
VIEWS.database = async () => {
  const info = await api('/db/info');
  const tag = info.persistente ? '<span class="tag ok">persistente ✓</span>' : '<span class="tag no">NON persistente — i dati si azzerano al riavvio</span>';
  const dim = info.size_kb ? ` · ${info.size_kb} KB` : '';
  $('#view').innerHTML = `<div class="panel"><h3>Database & backup</h3>
      <p class="muted" style="margin-bottom:8px">Tipo: <b>${esc(info.tipo || '')}</b> ${tag}<br>Sorgente: <b>${esc(info.path)}</b>${dim} · ${info.soci} soci</p>
      ${info.persistente ? '' : '<p class="muted" style="margin-bottom:8px">Per rendere permanenti i dati: collega un database gestito (Turso) o monta un disco su Render (vedi runbook).</p>'}
      <button class="btn gold sm" id="db_backup">⬇︎ Scarica backup (.db)</button>
      <span class="muted" id="db_msg" style="margin-left:8px"></span>
      <p class="muted" style="margin-top:12px;font-size:13px">Su database gestito (Turso) i backup/point-in-time sono del provider; il download .db è per la modalità file locale.</p></div>`;
  $('#db_backup').onclick = async () => {
    $('#db_msg').textContent = 'preparo…';
    try {
      const r = await fetch(API_BASE + '/api/admin/db/backup', { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      const blob = await r.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'bussola-backup-' + new Date().toISOString().slice(0, 10) + '.db'; a.click();
      $('#db_msg').textContent = 'scaricato ✓';
    } catch (e) { $('#db_msg').textContent = String(e.message || e); }
  };
};


// Un QR per foglio, centrato e con margini uguali: si ritaglia e si mette sul tavolo.
function stampaQr(lista) {
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare.'); return; }
  const pagina = (r) => `<section>
      <div class="k">Ordina qui</div>
      <h1>${esc(r.punto)}</h1>
      ${r.tavolo ? `<h2>Tavolo ${esc(String(r.tavolo))}</h2>` : ''}
      <div class="qr">${r.svg}</div>
      <p>Inquadra il QR con la fotocamera e ordina dal tuo telefono.</p>
    </section>`;
  w.document.write(`<html><head><title>QR self-order</title><style>
    @page{size:A4;margin:20mm}
    body{font-family:Georgia,'Times New Roman',serif;color:#12324F;margin:0}
    section{height:calc(297mm - 40mm);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;break-after:page}
    section:last-child{break-after:auto}
    .k{font-family:Arial,sans-serif;letter-spacing:4px;font-size:.8rem;color:#9a8a5f;text-transform:uppercase}
    h1{font-size:2rem;margin:6px 0 0}
    h2{font-family:Arial,sans-serif;font-size:1.1rem;margin:4px 0 0;color:#5a6b75;font-weight:600}
    .qr{margin:22px 0}
    .qr svg{width:280px;height:280px}
    p{font-family:Arial,sans-serif;font-size:.9rem;color:#5a6b75;max-width:70%}
  </style></head><body>${lista.map(pagina).join('')}
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
  w.document.close();
}

// ---- Installa app (QR degli indirizzi PWA) ----
VIEWS.installa = async () => {
  let d; try { d = await api('/pwa-qr'); } catch (e) { $('#view').innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; return; }
  // Righe fisse dentro ogni scheda (titolo · QR · indirizzo): i QR restano sulla stessa linea
  // anche quando i nomi o gli indirizzi hanno lunghezze diverse.
  const card = (it) => `<div class="panel">
      <h3 style="margin-bottom:0;text-align:center">${esc(it.label)}</h3>
      <div class="grow"><div class="qrbox" style="max-width:200px;margin:12px auto">${it.svg}</div></div>
      <div class="foot"><p class="muted brk" style="text-align:center;margin:0;font-size:12px">${esc(it.url)}</p></div>
    </div>`;
  $('#view').innerHTML = `
    <div class="panel" data-fold="installa"><h3>📲 Installa le app</h3>
      <p class="muted">Inquadra il QR con la fotocamera del telefono per aprire l'app, poi usa <b>“Aggiungi a schermata Home”</b> (Android: Chrome · iPhone/iPad: Safari) per installarla. Nessuno store, nessun account.</p>
      <div class="row" style="justify-content:flex-end;margin-bottom:0"><button class="btn gold sm" id="qr_print">🖨️ Stampa / salva PDF</button></div>
    </div>
    <div class="cardgrid">${d.items.map(card).join('')}</div>
    <div class="panel" data-fold="qr"><h3>🍔 QR self-order al tavolo</h3>
      <p class="muted">I QR dei tavoli si generano nell'app <b>Bussola Crew · tab Pianta</b>, dove ci sono i tavoli veri della disposizione: se ne aggiungi uno il QR c'è, se ne unisci due sparisce quello assorbito. Qui non si duplica.</p>
    </div>`;
  $('#qr_print').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) { alert('Consenti i popup per stampare.'); return; }
    w.document.write(`<html><head><title>Bussola — Installa app</title><style>
      body{font-family:system-ui,Arial,sans-serif;color:#12324F;padding:24px}
      h1{text-align:center} .g{display:flex;gap:24px;flex-wrap:wrap;justify-content:center;margin-top:16px}
      .c{border:1px solid #cbd2d8;border-radius:12px;padding:16px;text-align:center;width:260px}
      .c h2{margin:0 0 8px;font-size:1.1rem} .c svg{width:200px;height:200px} .u{font-size:.75rem;word-break:break-all;color:#555;margin-top:8px}
    </style></head><body><h1>Bussola Residence — Installa le app</h1>
      <p style="text-align:center;color:#555">Inquadra il QR e scegli “Aggiungi a schermata Home”.</p>
      <div class="g">${d.items.map(it => `<div class="c"><h2>${esc(it.label)}</h2>${it.svg}<div class="u">${esc(it.url)}</div></div>`).join('')}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
    w.document.close();
  };
};

// ---- Operatori & permessi (solo gestore) ----
const CAP_LABEL = { utenti:'Utenti (modifica)', utenti_ins:'Registra utenti', casate:'Casate & punti', cdc:'Casa di Carta', sala:'Coworking & sala', discipline:'Discipline', tabellone:'Sport · risultati (Crew) + tabellone', contest:'Contest', serate:'Serate & cena', proposte:'Proposte', eventi:'Eventi', magazzino:'Crew · Magazzino', comande:'Crew · Comande e Cucina', campi:'Campi & prenotazioni', tennis:'Tennis: gestore del servizio', tennis_campi:'Tennis: solo prenotazioni e blocchi' };
VIEWS.operatori = async () => {
  const d = await api('/operatori');
  const caps = d.caps_delegabili;
  const ruoloTag = (r) => r === 'gestore' ? '<span class="tag ok">gestore</span>' : r === 'manager' ? '<span class="tag mid">manager</span>' : r === 'sola_lettura' ? '<span class="tag no">sola lettura</span>' : '<span class="tag mid">staff</span>';
  $('#view').innerHTML = `
    <div class="panel"><h3>Operatori</h3>
      <p class="muted" style="margin-bottom:10px">Il <b>gestore</b> può tutto (password via <b>ADMIN_PASSWORD</b>). Il <b>manager</b> sovraintende l'operatività (niente inserimenti/cancellazioni né funzioni strutturali). Lo <b>staff</b> ha i permessi spuntati qui sotto.</p>
      <table><thead><tr><th>Utente</th><th>Ruolo</th><th>Permessi</th><th></th></tr></thead><tbody>
      ${d.operatori.map(o => `<tr><td><b>${esc(o.username)}</b></td><td>${ruoloTag(o.ruolo)}</td>
        <td class="muted">${o.ruolo === 'gestore' ? 'tutto' : o.ruolo === 'manager' ? 'template manager' : o.ruolo === 'sola_lettura' ? 'solo lettura' : (o.permessi.map(c => CAP_LABEL[c] || c).join(', ') || '—')}</td>
        <td style="white-space:nowrap">${o.ruolo === 'gestore' ? '' : `<button class="btn ghost sm" data-oedit="${o.id}">✎</button> <button class="btn danger sm" data-odel="${o.id}">🗑</button>`}</td></tr>`).join('')}
      </tbody></table>
      <button class="btn gold sm" id="o_new" style="margin-top:12px">+ Nuovo operatore</button>
    </div>`;
  $('#o_new').onclick = () => openOperatore(null, caps);
  document.querySelectorAll('[data-oedit]').forEach(b => b.onclick = () => openOperatore(d.operatori.find(x => x.id == b.dataset.oedit), caps));
  document.querySelectorAll('[data-odel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare questo operatore?')) return; await api('/operatori/' + b.dataset.odel, { method: 'DELETE' }); show('operatori'); });
};
function openOperatore(o, caps) {
  const isNew = !o;
  const sel = new Set(o?.permessi || []);
  modal(`<h3>${isNew ? 'Nuovo operatore' : 'Modifica operatore'}</h3>
    <div class="grid2">
      <div><label>Username</label><input id="o_user" value="${esc(o?.username || '')}" ${isNew ? '' : 'disabled'}></div>
      <div><label>Ruolo</label><select id="o_ruolo"><option value="staff" ${o?.ruolo === 'staff' ? 'selected' : ''}>staff (permessi a flag)</option><option value="manager" ${o?.ruolo === 'manager' ? 'selected' : ''}>manager (template)</option><option value="sola_lettura" ${o?.ruolo === 'sola_lettura' ? 'selected' : ''}>sola lettura</option></select></div>
      <div><label>Password ${isNew ? '' : '(lascia vuoto per non cambiarla)'}</label><input id="o_pwd" type="password" placeholder="${isNew ? 'password' : '••••••'}"></div>
    </div>
    <div id="o_capsWrap"><label>Permessi (solo per ruolo staff)</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${caps.map(c => `<label class="check" style="margin:0"><input type="checkbox" class="o_cap" value="${c}" ${sel.has(c) ? 'checked' : ''}> ${esc(CAP_LABEL[c] || c)}</label>`).join('')}</div>
    </div>
    <div class="err" id="o_err"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>`);
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
    $('#view').innerHTML = `
      <div class="row"><input id="q" placeholder="Cerca nome, email, tessera…" style="max-width:280px" value="${esc(q)}"><button class="btn ghost sm" id="search">Cerca</button>${can('utenti_ins') ? '<button class="btn gold sm" id="new">+ Nuovo utente</button>' : ''}</div>
      <div class="panel"><table><thead><tr><th>Tessera</th><th>Nome</th><th>Casata</th><th>Ruolo</th><th>Consensi</th><th>Stato</th><th></th></tr></thead><tbody>
        ${list.map(s => `<tr>
          <td>${esc(s.tessera_code)}</td><td><b>${esc(s.nome)} ${esc(s.cognome)}</b><br><span class="muted">${esc(s.email||'')}</span></td>
          <td>${esc(s.casata_nome||'—')}</td><td>${esc((s.ruolo||'').replace('_',' '))}${s.tipo_profilo&&s.tipo_profilo!=='socio'?`<br><span class="tag mid">${esc(s.tipo_profilo==='ospite_temporaneo'?'visitatore':s.tipo_profilo.replace('_',' '))}</span>`:''}</td>
          <td>${s.consenso_privacy?'<span class="tag ok">privacy</span> ':''}${s.consenso_marketing?'<span class="tag mid">mktg</span> ':''}${s.consenso_foto?'<span class="tag mid">foto</span>':''}</td>
          <td>${s.attivo?'<span class="tag ok">attivo</span>':'<span class="tag no">inattivo</span>'}</td>
          <td style="white-space:nowrap"><button class="btn ghost sm" data-edit="${s.id}">✎</button> <button class="btn ghost sm" data-exp="${s.id}">⬇︎</button> ${can('utenti_del') ? `<button class="btn danger sm" data-del="${s.id}">🗑</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">Nessun socio.</td></tr>'}
      </tbody></table></div>`;
    $('#search').onclick = () => render($('#q').value);
    $('#q').onkeydown = (e) => { if (e.key === 'Enter') render($('#q').value); };
    if ($('#new')) $('#new').onclick = () => editSocio(null, list);
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSocio(list.find(x => x.id == b.dataset.edit), list));
    document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => exportSocio(b.dataset.exp));
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => delSocio(b.dataset.del, render));
  };
  await render();
};
function casataOptions(sel) { return `<option value="">— nessuna —</option>` + CASATE.map(c => `<option value="${c.id}" ${sel==c.id?'selected':''}>${esc(c.nome)}</option>`).join(''); }
async function editSocio(s, all) {
  const isNew = !s;
  // Stato host del profilo (il flag host è mostrato solo per i Residenti).
  let hostInfo = null;
  if (!isNew) hostInfo = await api('/soci/' + s.id + '/host').catch(() => null);
  const genitori = (all || []).filter(x => x.tipo_profilo === 'genitore');
  const profili = [['socio','Socio'],['residente','Residente'],['socio_residente','Socio residente'],['ospite_temporaneo','Visitatore (non socio)'],['genitore','Genitore'],['under14','Under 14 (figlio)']];
  // I nuclei gia' usati: si sceglie da quelli invece di riscrivere il codice a mano e
  // sbagliarlo — un codice storpiato e' una famiglia separata.
  const nucleiNoti = [...new Set((all || []).map(x => x.nucleo).filter(Boolean))].sort();
  const tutOpts = `<option value="">— nessuno —</option>` + genitori.map(g => `<option value="${g.id}" ${s?.tutore_id==g.id?'selected':''}>${esc(g.nome)} ${esc(g.cognome)}</option>`).join('');
  modal(`<h3>${isNew?'Nuovo profilo':'Modifica profilo'}</h3>
    <div class="grid2">
      <div><label>Nome*</label><input id="f_nome" value="${esc(s?.nome||'')}"></div>
      <div><label>Cognome*</label><input id="f_cognome" value="${esc(s?.cognome||'')}"></div>
      <div><label>Email</label><input id="f_email" value="${esc(s?.email||'')}"></div>
      <div><label>Telefono</label><input id="f_tel" value="${esc(s?.telefono||'')}"></div>
      <div class="grid2">
        <div><label>In caso di emergenza, chi chiamare</label><input id="f_emn" value="${esc(s?.emergenza_nome||'')}" placeholder="es. Giulia (figlia)"></div>
        <div><label>Il suo numero</label><input id="f_emt" value="${esc(s?.emergenza_tel||'')}" placeholder="333 1234567"></div>
      </div>
      <p class="muted" style="font-size:.78rem">Compare nel tasto <b>Chiedi aiuto</b> dell'app, accanto al 112. Utile soprattutto per i soci anziani.</p>
      <div><label>Data di nascita</label><input id="f_nasc" type="date" value="${esc(s?.data_nascita||'')}"></div>
      <div><label>Sesso</label><select id="f_sesso">
        <option value="" ${!s?.sesso?'selected':''}>— da indicare —</option>
        <option value="F" ${s?.sesso==='F'?'selected':''}>F</option>
        <option value="M" ${s?.sesso==='M'?'selected':''}>M</option>
      </select></div>
      <div style="grid-column:1/-1"><label>Nucleo familiare</label>
        <input id="f_nucleo" list="nuclei_noti" value="${esc(s?.nucleo||'')}" placeholder="es. Rossi-villa12">
        <datalist id="nuclei_noti">${nucleiNoti.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
        <p class="muted" style="font-size:.78rem;margin:2px 0 0">Chi ha lo stesso codice viaggia insieme: non si separa nella composizione delle casate, e in spiaggia conta come una presa sola. Un codice qualsiasi, purché uguale per tutti i familiari.</p>
      </div>
      <div><label>Casata</label><select id="f_casata">${casataOptions(s?.casata_id)}</select></div>
      <div><label>Tipo profilo</label><select id="f_tipo">${profili.map(p=>`<option value="${p[0]}" ${s?.tipo_profilo===p[0]?'selected':''}>${p[1]}</option>`).join('')}</select></div>
      <div id="tutoreWrap"><label>Genitore (per Under 14)</label><select id="f_tutore">${tutOpts}</select></div>
      <div id="prepWrap" style="grid-column:1/-1">
        <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
          <input type="checkbox" id="f_prep" ${s?.prepagata_autorizzata ? 'checked' : ''} style="margin-top:3px">
          <span><b>Puo' pagare con la tessera prepagata</b>
            <div class="muted" style="font-size:.78rem">Per un minorenne serve il consenso di chi ne risponde: qui non si sta scegliendo una comodita', si sta mettendo denaro spendibile in mano a un ragazzo. Per un adulto basta il parametro generale del residence e questa spunta non serve.</div>
          </span></label>
      </div>
      <div><label>Ruolo</label><select id="f_ruolo"><option ${s?.ruolo==='socio'?'selected':''}>socio</option><option ${s?.ruolo==='capitano'?'selected':''}>capitano</option><option ${s?.ruolo==='staff'?'selected':''}>staff</option><option value="non_socio" ${s?.ruolo==='non_socio'?'selected':''}>non socio</option></select></div>
      <div><label>Lingua</label><select id="f_lingua">${['it','en','fr','de','es','zh','ja'].map(l=>`<option ${s?.lingua===l?'selected':''}>${l}</option>`).join('')}</select></div>
      <div id="validaWrap"><label>Tessera valida fino</label><input id="f_valida" type="date" value="${esc(s?.valida_fino||'2027-05-01')}"></div>
      <div id="dalWrap"><label>Soggiorno dal</label><input id="f_dal" type="date" value="${esc(s?.soggiorno_dal||'')}"></div>
      <div id="alWrap"><label>Soggiorno al</label><input id="f_al" type="date" value="${esc(s?.soggiorno_al||'')}"></div>
    </div>
    <p class="muted" id="ospitenote" style="display:none">Visitatore (non socio): profilo temporaneo con periodo di soggiorno (dal / al) e nessuna tessera annuale. <b>L'aggancio a una casa vacanza avviene su consenso</b>: il visitatore si registra dall'app, cerca il proprio host per nome e invia una richiesta; l'host la conferma dalla sua app ("Le mie case") e solo allora il visitatore vede "Casa mia". Un visitatore creato o modificato qui dal back office resta senza casa collegata.</p>
    <label class="check"><input type="checkbox" id="f_privacy" ${(!s||s.consenso_privacy)?'checked':''}> Consenso privacy (necessario)</label>
    <label class="check"><input type="checkbox" id="f_mktg" ${s?.consenso_marketing?'checked':''}> Consenso comunicazioni marketing</label>
    <label class="check"><input type="checkbox" id="f_foto" ${s?.consenso_foto?'checked':''}> Consenso uso immagini eventi</label>
    <label class="check"><input type="checkbox" id="f_push" ${s?.notifiche_push?'checked':''}> Consenso notifiche (casata & eventi)</label>
    ${isNew?'':'<label class="check"><input type="checkbox" id="f_attivo" '+(s.attivo?'checked':'')+'> Profilo attivo</label>'}
    ${isNew?'':'<div id="hostWrap"><label class="check"><input type="checkbox" id="f_host" '+((hostInfo&&hostInfo.host)?'checked':'')+'> 🔑 Profilo <b>host</b> (case vacanza): gestisce fino a 3 strutture dall\'app'+((hostInfo&&hostInfo.host_ko)?' <span class="tag no">KO integrità</span>':'')+'</label>'+((hostInfo && hostInfo.strutture && hostInfo.strutture.length)?'<p class="muted">Strutture host: '+hostInfo.strutture.map(x=>x.ko?'⚠️ (dati non leggibili)':esc(x.nome)).join(', ')+' — modifica dal profilo host in app.</p>':'')+'<p class="muted">Il profilo host è riservato a <b>Residente</b> e <b>Socio residente</b>: imposta prima il tipo profilo.</p></div>'}
    <p class="muted" id="under14note" style="display:none">Per gli under-14 la responsabilità del trattamento è del genitore indicato: seleziona il genitore e la casata del figlio.</p>
    <div class="err" id="mErr"></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>`);
  const syncTipo = () => {
    const t = $('#f_tipo').value;
    const u = t === 'under14', osp = t === 'ospite_temporaneo', resid = (t === 'residente' || t === 'socio_residente');
    $('#tutoreWrap').style.opacity = u ? '1' : '.5'; $('#under14note').style.display = u ? 'block' : 'none';
    // Il consenso alla prepagata riguarda SOLO i minorenni: per un adulto basta il parametro
    // generale, e mostrargli una spunta in piu' farebbe credere che serva anche a lui.
    const nato = $('#f_nasc') ? $('#f_nasc').value : '';
    const minore = nato ? (Date.now() - new Date(nato + 'T00:00:00Z').getTime()) / 31557600000 < 18 : u;
    if ($('#prepWrap')) $('#prepWrap').style.display = minore ? 'block' : 'none';
    // Visitatore (ospite temporaneo): periodo dal/al, niente tessera annuale.
    $('#dalWrap').style.display = osp ? 'block' : 'none';
    $('#alWrap').style.display = osp ? 'block' : 'none';
    $('#validaWrap').style.display = osp ? 'none' : 'block';
    $('#ospitenote').style.display = osp ? 'block' : 'none';
    // Ruolo: il Visitatore è "non socio" e il campo si blocca; per gli altri torna modificabile.
    const rr = $('#f_ruolo');
    if (rr) {
      if (osp) { rr.value = 'non_socio'; rr.disabled = true; }
      else { rr.disabled = false; if (rr.value === 'non_socio') rr.value = 'socio'; }
    }
    // Flag host: SOLO per i Residenti; per gli altri nascosto e disattivato.
    const hw = $('#hostWrap');
    if (hw) { hw.style.display = resid ? 'block' : 'none'; if (!resid) { const fh = $('#f_host'); if (fh) fh.checked = false; } }
  };
  $('#f_tipo').onchange = syncTipo;
  // Anche la data di nascita decide: e' quella a dire se e' un minorenne, non il tipo profilo.
  if ($('#f_nasc')) $('#f_nasc').onchange = syncTipo;
  syncTipo();
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => {
    const osp = $('#f_tipo').value === 'ospite_temporaneo';
    const body = {
      nome:$('#f_nome').value, cognome:$('#f_cognome').value, email:$('#f_email').value, telefono:$('#f_tel').value,
      emergenza_nome:($('#f_emn')||{}).value||null, emergenza_tel:($('#f_emt')||{}).value||null,
      data_nascita:$('#f_nasc').value, casata_id:$('#f_casata').value||null, ruolo:$('#f_ruolo').value, lingua:$('#f_lingua').value,
      tipo_profilo:$('#f_tipo').value, tutore_id: $('#f_tipo').value==='under14' ? ($('#f_tutore').value||null) : null,
      prepagata_autorizzata: $('#f_prep') ? $('#f_prep').checked : undefined,
      sesso: $('#f_sesso') ? ($('#f_sesso').value || null) : undefined,
      nucleo: $('#f_nucleo') ? (($('#f_nucleo').value || '').trim() || null) : undefined,
      // Ospite temporaneo: nessuna tessera annuale, ma periodo di soggiorno dal/al.
      valida_fino: osp ? null : $('#f_valida').value,
      soggiorno_dal: osp ? ($('#f_dal').value||null) : null, soggiorno_al: osp ? ($('#f_al').value||null) : null,
      consenso_privacy:$('#f_privacy').checked, consenso_marketing:$('#f_mktg').checked,
      consenso_foto:$('#f_foto').checked, notifiche_push:$('#f_push').checked, attivo: isNew ? true : $('#f_attivo').checked,
    };
    try {
      await api(isNew?'/soci':'/soci/'+s.id, { method:isNew?'POST':'PUT', body:JSON.stringify(body) });
      if (!isNew && ['residente','socio_residente'].includes($('#f_tipo').value)) {
        // Il flag host vale solo per i Residenti; l'aggancio ospite→struttura NON si fa dal back office.
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
  if (!confirm('Cancellare il socio e i suoi dati (diritto all\'oblio GDPR)? Operazione irreversibile.')) return;
  await api('/soci/' + id, { method: 'DELETE' }); render();
}

// ---- Casate ----
VIEWS.casate = async () => {
  // Graduatoria interamente calcolata: nessun campo da compilare, nessun salvataggio.
  let cart = await api('/coppa/cartellone').catch(() => ({ graduatoria: [], discipline: [], celle: {} }));
  const dom = (d) => d === 'giochi' ? '🎲' : '🏅';

  const render = () => {
    const grad = cart.graduatoria || [];
    const disc = cart.discipline || [];
    const celle = cart.celle || {};
    const cols = disc.map(d => `<th style="text-align:center;min-width:64px"><div style="font-weight:700;font-size:11px;line-height:1.15">${esc(d.nome)}</div><div style="font-size:17px;margin-top:2px">${dom(d.dominio)}</div></th>`).join('');
    const medaglia = (pos) => pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `<span class="muted">${pos}</span>`;
    const rows = grad.map(c => {
      const cells = disc.map(d => { const v = (celle[d.id] || {})[c.id]; return `<td style="text-align:center">${v ? `<b>${v}</b>` : '<span class="muted">·</span>'}</td>`; }).join('');
      return `<tr><td style="text-align:center;white-space:nowrap">${medaglia(c.posizione)}${c.exAequo ? ' <span class="muted" title="a pari merito" style="font-size:11px">=</span>' : ''}</td>
        <td style="text-align:left;white-space:nowrap"><b>${esc(c.nome)}</b> <span class="muted">${esc(c.motto || '')}</span></td>
        <td style="text-align:center;font-size:1.05rem"><b style="color:var(--navy)">${c.punti}</b></td>
        <td style="text-align:center">${c.tornei ? c.tornei : '<span class="muted">·</span>'}</td>
        <td style="text-align:center">${c.contest ? c.contest : '<span class="muted">·</span>'}</td>${cells}</tr>`;
    }).join('');
    $('#view').innerHTML = `<div class="panel"><h3>🏆 Coppa delle Casate · cartellone e graduatoria</h3>
      <p class="muted" style="font-size:13px;margin-bottom:8px">Questa è <b>l'unica graduatoria</b>, ed è quella che vedono i soci nell'app. <b>Non si inserisce nulla a mano</b>: il totale si compone da solo da <b>Tornei</b> (12/10/8/6 ai primi 4, 4 dal 5º all'8º, dai risultati inseriti nel Crew, comprese le edizioni già archiviate) e da <b>Contest</b> (le serate i cui punti sono stati assegnati alla Coppa). A parità di punteggio le casate condividono la stessa posizione. Le colonne per disciplina, a destra, sono il dettaglio e scorrono lateralmente.</p>
      <div style="overflow:auto"><table><thead><tr><th style="text-align:center">#</th><th style="text-align:left">Casata</th><th style="text-align:center">Totale</th><th style="text-align:center">Tornei</th><th style="text-align:center">Contest</th>${cols}</tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Nessuna casata.</td></tr>'}</tbody></table></div>
      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <button class="btn gold" id="ca_recalc">↻ Ricalcola e riordina</button>
        <span class="muted" id="ca_msg" style="font-size:13px">Il ricalcolo avviene già da solo a ogni risultato, archiviazione ed esito di contest.</span>
      </div></div><div id="ca_chiusura"></div><div id="ca_chat"></div>`;
    // Chiusura della stagione: il sistema la propone quando ogni disciplina ha espresso i suoi
    // punti, e manda i primi tre nell'Albo d'Oro.
    // Moderazione della chat: si vede cio' che e' stato segnalato, con il contesto attorno.
    api('/chat/segnalati').then((ch2) => {
      const box = $('#ca_chat'); if (!box) return;
      const righe = (ch2.segnalati || []).map(m => `<div style="border:1px solid var(--line);border-left:4px solid ${m.nascosto ? '#999' : 'var(--danger)'};border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span><b>${esc(m.nome)}</b> <span class="muted">· ${esc(m.casata)} · ${esc(String(m.created_at || '').slice(0, 16))}</span>
            ${m.motivo ? `<div class="muted" style="font-size:13px">segnalato da ${esc(m.segnalato_da || '')}: “${esc(m.motivo)}”</div>` : ''}</div>
          <div class="row" style="gap:6px">
            ${m.nascosto ? `<span class="tag">nascosto</span><button class="btn ghost sm" data-chatrip="${m.id}">Ripristina</button>`
                         : `<button class="btn danger sm" data-chatnas="${m.id}">Nascondi</button><button class="btn ghost sm" data-chatok="${m.id}">Va bene</button>`}
          </div></div>
        <div style="margin-top:8px;background:#faf7f0;border-radius:8px;padding:8px 10px">
          ${(m.contesto || []).map(c => `<div style="font-size:13px;padding:2px 0;${c.id === m.id ? 'font-weight:700;color:var(--danger)' : 'color:var(--muted)'}"><b>${esc(c.nome)}:</b> ${esc(c.testo)}</div>`).join('')}
        </div></div>`).join('');
      box.innerHTML = `<div class="panel"><h3>💬 Chat delle casate · moderazione</h3>
        <p class="muted">Non leggi tutta la chat: leggi <b>ciò che viene segnalato</b>, con i messaggi immediatamente attorno perché una frase isolata spesso non si capisce. Nelle casate ci sono minorenni, e ai soci è scritto in chiaro che la chat non è privata.<br>
        Messaggi in archivio: <b>${ch2.messaggi_totali}</b>.</p>
        ${righe || '<p class="muted">Nessuna segnalazione.</p>'}
        <div class="row" style="margin-top:10px;align-items:center;gap:8px">
          <label class="muted" style="font-size:13px">Svuota la chat scritta prima del <input type="date" id="ca_chatdata"></label>
          <button class="btn ghost sm" id="ca_chatsvuota">Svuota</button>
        </div></div>`;
      document.querySelectorAll('[data-chatnas]').forEach(b => b.onclick = async () => { await api('/chat/messaggi/' + b.dataset.chatnas, { method: 'PUT', body: JSON.stringify({ azione: 'nascondi' }) }); show('casate'); });
      document.querySelectorAll('[data-chatrip]').forEach(b => b.onclick = async () => { await api('/chat/messaggi/' + b.dataset.chatrip, { method: 'PUT', body: JSON.stringify({ azione: 'ripristina' }) }); show('casate'); });
      document.querySelectorAll('[data-chatok]').forEach(b => b.onclick = async () => { await api('/chat/messaggi/' + b.dataset.chatok, { method: 'PUT', body: JSON.stringify({ azione: 'archivia' }) }); show('casate'); });
      if ($('#ca_chatsvuota')) $('#ca_chatsvuota').onclick = async () => {
        const d = $('#ca_chatdata').value;
        if (!d || !confirm('Cancellare tutti i messaggi scritti prima del ' + d + '? Non si torna indietro.')) return;
        await api('/chat/svuota', { method: 'POST', body: JSON.stringify({ prima_del: d }) });
        show('casate');
      };
    }).catch(() => { });
    api('/coppa/chiusura').then((ch) => {
      const box = $('#ca_chiusura'); if (!box) return;
      const podio = (ch.graduatoria || []).filter(c => c.posizione <= 3);
      const albo = (ch.albo || []).map(a => `<tr><td><b>${esc(a.stagione)}</b></td>${[1, 2, 3].map(pos => { const r = a.podio.find(x => x.posizione === pos); return `<td>${r ? (pos === 1 ? '🥇 ' : pos === 2 ? '🥈 ' : '🥉 ') + esc(r.casata_nome) + ` <span class="muted">${r.punti}</span>` : '—'}</td>`; }).join('')}</tr>`).join('');
      box.innerHTML = `<div class="panel" data-fold="chiusura"><h3>🏛️ Chiusura stagione e Albo d'Oro</h3>
        ${ch.gia_chiusa
          ? `<p class="muted">La stagione <b>${esc(ch.stagione)}</b> è già chiusa. La graduatoria resta visibile fino alla prossima.</p>`
          : ch.spareggio
            ? `<p><b>Parità assoluta al primo posto</b> fra ${ch.spareggio.map(c => `<b>${esc(c.nome)}</b>`).join(' e ')}: stessi punti (${ch.spareggio[0].punti}), stessi tornei vinti (${ch.spareggio[0].ori}). Il sistema non sceglie a caso il simbolo del residence: serve uno <b>spareggio alla serata delle casate</b>.</p>
               <div class="row" style="margin-top:8px;align-items:center"><label>Vincitrice dello spareggio <select id="ca_vinc">${ch.spareggio.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
                 <button class="btn gold" id="ca_chiudi">🏛️ Chiudi la stagione ${esc(ch.stagione)}</button></div>`
          : ch.pronta
            ? `<p><b>Tutte le discipline hanno espresso il loro punteggio.</b> La stagione può chiudersi: la graduatoria si congela, il tabellone si chiude e questi tre entrano nell'Albo d'Oro.</p>
               <div class="row" style="gap:14px;flex-wrap:wrap">${podio.map(c => `<div class="stat" style="flex:1;min-width:150px"><div class="n">${c.posizione === 1 ? '🥇' : c.posizione === 2 ? '🥈' : '🥉'} ${esc(c.nome)}</div><div class="l">${c.punti} punti${c.exAequo ? ' · a pari merito' : ''}</div></div>`).join('')}</div>
               <p class="muted" style="margin-top:8px">La prima classificata avrà diritto, la stagione successiva, a fregiarsi del <b>simbolo del residence</b> come migliore casata dell'anno.</p>
               <div class="row" style="margin-top:10px"><button class="btn gold" id="ca_chiudi">🏛️ Chiudi la stagione ${esc(ch.stagione)}</button>
                 <span class="muted">Operazione definitiva: archivia i tornei e congela la graduatoria.</span></div>`
            : `<p class="muted">La stagione non è ancora chiudibile: mancano <b>${ch.partite_mancanti} partite</b> in ${ch.mancanti.length} discipline. Il tasto comparirà da solo quando ogni disciplina avrà espresso il suo punteggio.</p>
               <table class="fit"><thead><tr><th>Disciplina</th><th>Giocate</th><th>Mancano</th></tr></thead><tbody>
               ${ch.mancanti.map(m => `<tr><td>${esc(m.nome)}</td><td>${m.giocate}/${m.partite}</td><td><b>${m.mancano}</b></td></tr>`).join('')}</tbody></table>
               <p class="muted" style="font-size:13px">Con una stagione di 60 giorni servono circa <b>${Math.ceil(ch.partite_mancanti / 60 * 10) / 10} partite al giorno</b> per arrivare in fondo: se il ritmo non è sostenibile, conviene ridurre le discipline in cartellone invece di lasciarle a metà.</p>`}
        ${albo ? `<table class="fit" style="margin-top:12px"><thead><tr><th>Stagione</th><th>1ª</th><th>2ª</th><th>3ª</th></tr></thead><tbody>${albo}</tbody></table>` : ''}
        ${ch.campione ? `<p class="muted" style="margin-top:8px">Campione in carica: <b>${esc(ch.campione.casata_nome)}</b> (stagione ${esc(ch.campione.stagione)}) — nell'app porta il simbolo del residence.</p>` : ''}
      </div>`;
      const btn = $('#ca_chiudi');
      if (btn) btn.onclick = async () => {
        if (!confirm(`Chiudere la stagione ${ch.stagione}? La graduatoria viene congelata e i tornei archiviati. Non si torna indietro.`)) return;
        try { const r = await api('/coppa/chiudi', { method: 'POST', body: JSON.stringify({ stagione: ch.stagione, vincitrice: ($('#ca_vinc') || {}).value || null }) }); alert('Stagione chiusa. Nell\'Albo d\'Oro: ' + r.podio.map(x => x.nome).join(', ')); show('casate'); }
        catch (e) { alert(e.message); }
      };
    }).catch(() => { });
    $('#ca_recalc').onclick = async () => {
      const b = $('#ca_recalc'); b.disabled = true; b.textContent = 'Ricalcolo…';
      try {
        const r = await api('/coppa/ricalcola', { method: 'POST' });
        cart = { graduatoria: r.graduatoria, discipline: r.discipline, celle: r.celle };
        render();
        $('#ca_msg').textContent = r.cambiate ? `Aggiornate ${r.cambiate} casate.` : 'Graduatoria già allineata.';
      } catch (e) {
        b.disabled = false; b.textContent = '↻ Ricalcola e riordina';
        alert('Ricalcolo non riuscito: ' + (e.message || e));
      }
    };
  };
  render();
};

// ---- Prenotazioni (sport, tavolo, eventi). Il coworking è nella sezione Casa di Carta. ----
VIEWS.prenotazioni = async () => {
  const list = await api('/prenotazioni');
  $('#view').innerHTML = `<div class="panel"><h3>Prenotazioni recenti</h3>
    <p class="muted" style="margin-bottom:10px">Le postazioni coworking e la gestione della Casa di Carta (caffè, giochi, check) sono nella sezione <b>🃏 Casa di Carta</b>.</p>
    <table><thead><tr><th>Quando</th><th>Risorsa</th><th>Socio</th><th>Giorno/Turno</th><th>Stato</th></tr></thead><tbody>
    ${list.map(p => `<tr><td class="muted">${esc(p.created_at)}</td><td><b>${esc(p.risorsa_nome||'')}</b></td>
      <td>${esc((p.nome||'Ospite')+' '+(p.cognome||''))}<br><span class="muted">${esc(p.tessera_code||'')}</span></td>
      <td>${esc(p.giorno||'')} ${esc(p.turno||'')}</td><td><span class="tag ok">${esc(p.stato)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessuna prenotazione.</td></tr>'}
  </tbody></table></div>`;
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
    img.onerror = () => alert('Impossibile leggere l\'immagine');
    img.src = URL.createObjectURL(file);
  };
  inp.click();
}

// ---- Casa di Carta: coworking + caffè (magazzino capsule) + inventario giochi + prelievi + check ----
VIEWS.cdc = async () => {
  const [giochi, checks] = await Promise.all([api('/cdc/giochi'), api('/cdc/check')]);
  const catLabel = { carte: 'Carte', gioco_tavolo: 'Gioco da tavolo', scacchi: 'Scacchi/Dama', altro: 'Altro' };
  const giochiRows = giochi.map(g => `<tr>
      <td><input id="gnome_${g.id}" value="${esc(g.nome)}" style="min-width:150px"></td>
      <td><select id="gcat_${g.id}">${Object.keys(catLabel).map(k => `<option value="${k}" ${g.categoria === k ? 'selected' : ''}>${catLabel[k]}</option>`).join('')}</select></td>
      <td><input id="gqta_${g.id}" type="number" min="0" value="${g.quantita}" style="width:60px"></td>
      <td><select id="gstato_${g.id}">${['ok', 'danneggiato', 'mancante'].map(s => `<option value="${s}" ${g.stato === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input id="gnote_${g.id}" value="${esc(g.note || '')}" placeholder="pezzi mancanti…" style="min-width:140px"></td>
      <td style="white-space:nowrap"><button class="btn gold sm" data-gsave="${g.id}">Salva</button> <button class="btn danger sm" data-gdel="${g.id}">🗑</button></td>
    </tr>`).join('');
  const checkRows = checks.map(c => `<tr><td>${esc(c.data)}</td><td>${esc(c.operatore || '')}</td><td>${c.caffe_giacenza ?? '—'}</td><td>${c.esito === 'ok' ? '<span class="tag ok">ok</span>' : '<span class="tag no">anomalie</span>'}</td><td class="muted">${esc([c.strumenti_note, c.arredi_note].filter(Boolean).join(' · '))}</td><td>${c.has_foto ? `<button class="btn ghost sm" data-cfoto="${c.id}">📷 Vedi</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nessun check registrato.</td></tr>';

  $('#view').innerHTML = `
    <div class="panel" data-fold="cdc"><h3>🃏 Casa di Carta</h3>
      <p class="muted">Qui restano l'<b>inventario</b> e il <b>check attrezzature</b>. Il resto è operatività e sta nell'app <b>Bussola Crew · modulo Casa di Carta</b>: conta capsule (che scarica il magazzino), prestito dei giochi con il tavolo, prenotazione dei tavoli. Le <b>capsule</b> sono merce di magazzino, zona Casa di Carta; il <b>coworking e le prenotazioni della sala</b> hanno la loro sezione.</p>
    </div>

    <div class="panel"><h3>🎲 Inventario giochi (uso libero) <button class="btn ghost sm" id="g_print" style="float:right">🖨️ Stampa modulo prelievo</button></h3>
      <table><thead><tr><th>Gioco</th><th>Categoria</th><th>Q.tà</th><th>Stato</th><th>Note</th><th></th></tr></thead><tbody>${giochiRows}</tbody></table>
      <div class="row" style="margin-top:10px;align-items:flex-end">
        <input id="ng_nome" placeholder="Nuovo gioco" style="max-width:200px">
        <select id="ng_cat">${Object.keys(catLabel).map(k => `<option value="${k}">${catLabel[k]}</option>`).join('')}</select>
        <input id="ng_qta" type="number" min="1" value="1" style="width:70px">
        <button class="btn gold sm" id="ng_add">+ Aggiungi</button>
      </div>
    </div>

    <div class="panel"><h3>✅ Check strumenti & arredi (datati) <button class="btn gold sm" id="ck_new" style="float:right">+ Nuovo check</button></h3>
      <p class="muted" style="margin-bottom:8px">A ogni prelievo della macchina del caffè: verifica magazzino caffè, stato strumenti (mazzi, giochi, scacchiere) e arredi. Ogni check è datato; puoi allegare la foto della scheda cartacea.</p>
      <table><thead><tr><th>Data</th><th>Operatore</th><th>Caffè</th><th>Esito</th><th>Note</th><th>Scheda</th></tr></thead><tbody>${checkRows}</tbody></table>
    </div>`;

  document.querySelectorAll('[data-gsave]').forEach(b => b.onclick = async () => { const id = b.dataset.gsave; await api('/cdc/giochi/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#gnome_' + id).value, categoria: $('#gcat_' + id).value, quantita: $('#gqta_' + id).value, stato: $('#gstato_' + id).value, note: $('#gnote_' + id).value }) }); b.textContent = '✓'; setTimeout(() => b.textContent = 'Salva', 1000); });
  document.querySelectorAll('[data-gdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il gioco dall\'inventario?')) return; await api('/cdc/giochi/' + b.dataset.gdel, { method: 'DELETE' }); show('cdc'); });
  $('#ng_add').onclick = async () => { if (!$('#ng_nome').value) return; await api('/cdc/giochi', { method: 'POST', body: JSON.stringify({ nome: $('#ng_nome').value, categoria: $('#ng_cat').value, quantita: $('#ng_qta').value }) }); show('cdc'); };
  $('#g_print').onclick = () => stampaModuloPrelievo(giochi);
  $('#ck_new').onclick = () => openCheck(cfg);
  document.querySelectorAll('[data-cfoto]').forEach(b => b.onclick = async () => { const r = await api('/cdc/check/' + b.dataset.cfoto + '/foto'); modal(`<h3>Scheda check</h3><img src="${r.foto}" style="max-width:100%;border-radius:8px"><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Chiudi</button></div>`); $('#mCancel').onclick = closeModal; });
};
function openPrestito(giochi) {
  const opts = giochi.map(g => `<option value="${g.id}|${esc(g.nome)}">${esc(g.nome)}</option>`).join('');
  const ora = new Date().toTimeString().slice(0, 5);
  modal(`<h3>Registra prelievo</h3>
    <div class="grid2">
      <div><label>Gioco</label><select id="pk_g">${opts || '<option>—</option>'}</select></div>
      <div><label>Giocatore</label><input id="pk_gioc" placeholder="Nome del giocatore"></div>
      <div><label>Ora inizio</label><input id="pk_in" value="${ora}"></div>
      <div><label>Ora fine (facolt.)</label><input id="pk_out" placeholder="—"></div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => { const [id, nome] = ($('#pk_g').value || '|').split('|'); await api('/cdc/prestiti', { method: 'POST', body: JSON.stringify({ gioco_id: Number(id) || null, gioco_nome: nome || '', giocatore: $('#pk_gioc').value, ora_inizio: $('#pk_in').value, ora_fine: $('#pk_out').value }) }); closeModal(); show('cdc'); };
}
function openCheck(cfg) {
  let foto = null;
  modal(`<h3>Nuovo check (datato)</h3>
    <div class="grid2">
      <div><label>Data</label><input id="ck_data" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div><label>Caffè · capsule contate</label><input id="ck_caffe" type="number" min="0" placeholder="es. 55"></div>
    </div>
    <label>Stato strumenti (mazzi, giochi da tavolo, scacchiere — pezzi mancanti/danneggiati)</label><textarea id="ck_str" rows="2"></textarea>
    <label>Arredi (tavoli, sedie, illuminazione…)</label><textarea id="ck_arr" rows="2"></textarea>
    <label>Esito</label><select id="ck_es"><option value="ok">ok</option><option value="anomalie">anomalie</option></select>
    <div class="row" style="margin-top:10px;align-items:center"><button class="btn ghost sm" id="ck_foto">📷 Foto scheda cartacea</button><span class="muted" id="ck_fname"></span></div>
    <div class="err" id="ck_err"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva check</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#ck_foto').onclick = () => pickPhoto(d => { foto = d; $('#ck_fname').textContent = 'foto acquisita ✓'; });
  $('#mSave').onclick = async () => {
    try { await api('/cdc/check', { method: 'POST', body: JSON.stringify({ data: $('#ck_data').value, caffe_giacenza: $('#ck_caffe').value, strumenti_note: $('#ck_str').value, arredi_note: $('#ck_arr').value, esito: $('#ck_es').value, foto }) }); closeModal(); show('cdc'); }
    catch (e) { $('#ck_err').textContent = e.message; }
  };
}
function stampaModuloPrelievo(giochi) {
  const disponibili = giochi.map(g => esc(g.nome)).join(' · ');
  const righe = Array.from({ length: 14 }).map(() => `<tr><td style="height:34px"></td><td></td><td></td><td></td></tr>`).join('');
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Modulo prelievo giochi — Casa di Carta</title>
    <style>@page{margin:16mm} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#17242c}
      h1{font-family:Georgia,serif;color:#12324F;margin:0} .hd{border-bottom:2px solid #12324F;padding-bottom:8px;margin-bottom:8px}
      .meta{color:#5a6b75;font-size:13px;margin-top:4px} table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #bcc4cb;padding:6px 8px;font-size:13px;text-align:left} th{background:#f2efe6;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
      .disp{margin-top:10px;font-size:12px;color:#5a6b75} @media print{button{display:none}}</style></head>
    <body><div class="hd"><h1>Casa di Carta · Modulo prelievo giochi</h1>
      <div class="meta">Uso libero previa compilazione. Il giocatore scrive il gioco prelevato e l'ora di inizio; alla riconsegna indica l'ora di fine. Data: ____ / ____ / ______</div></div>
      <table><thead><tr><th>Gioco prelevato</th><th>Giocatore</th><th>Ora inizio</th><th>Ora fine</th></tr></thead><tbody>${righe}</tbody></table>
      <div class="disp"><b>Giochi disponibili:</b> ${disponibili || '—'}</div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 14px">Stampa</button>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti le finestre pop-up per stampare il modulo.'); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch (_) {} }, 300);
}

// ---- Campi & prenotazioni (stile Playtomic) ----
// Tipologie di CAMPO (raggruppano più discipline): un campo Tennis ospita pickleball, soft tennis, tennis…
const SPORTS = [['tennis', 'Tennis (pickleball · soft tennis · tennis)'], ['volley', 'Volley (beach volley)'], ['calcio', 'Calcio (calcetto · calcio a 5)'], ['basket', 'Basket'], ['altro', 'Altro']];
// Vecchi valori → nuove categorie (retrocompatibilità con campi già salvati).
const SPORT_ALIAS = { pickleball: 'tennis', soft_tennis: 'tennis', tennis: 'tennis', beach: 'volley', volley: 'volley', calcetto: 'calcio', calcio: 'calcio', basket: 'basket' };
const sportCat = (v) => SPORT_ALIAS[v] || (SPORTS.some(s => s[0] === v) ? v : 'altro');
VIEWS.campi = async () => {
  const campi = await api('/campi');
  const oggi = new Date().toISOString().slice(0, 10);
  const sportOpts = (sel) => SPORTS.map(s => `<option value="${s[0]}" ${sportCat(sel) === s[0] ? 'selected' : ''}>${esc(s[1])}</option>`).join('');
  const rows = campi.map(c => `<tr>
    <td><input id="cp_n_${c.id}" value="${esc(c.nome)}" style="min-width:150px"></td>
    <td><select id="cp_sp_${c.id}">${sportOpts(c.sport)}</select></td>
    <td><input id="cp_ap_${c.id}" value="${esc(c.apertura)}" style="width:64px"></td>
    <td><input id="cp_ch_${c.id}" value="${esc(c.chiusura)}" style="width:64px"></td>
    <td><input id="cp_du_${c.id}" type="number" value="${esc(String(c.durata_slot))}" style="width:64px"></td>
    <td><input id="cp_om_${c.id}" value="${esc(c.ora_min || '')}" placeholder="—" style="width:64px" title="Regola oraria: prenotabile solo da quest'ora (es. 18:00)"></td>
    <td><input id="cp_pd_${c.id}" type="number" min="2" value="${esc(String(c.posti_default))}" style="width:56px" title="Numero massimo di giocatori: vale per tutte le prenotazioni di questo campo"></td>
    <td><input id="cp_mg_${c.id}" type="number" min="1" value="${esc(String(c.min_giocatori == null ? 2 : c.min_giocatori))}" style="width:56px" title="Numero legale: sotto questi giocatori dichiarati la prenotazione decade poco prima dell'orario"></td>
    <td><input id="cp_ms_${c.id}" type="number" min="1" value="${esc(String(c.max_slot_prenotazione == null ? 2 : c.max_slot_prenotazione))}" style="width:56px" title="Durata massima: quante fasce consecutive può prenotare un socio"></td>
    <td><input id="cp_mw_${c.id}" type="number" min="1" value="${esc(String(c.max_pren_settimana == null ? 3 : c.max_pren_settimana))}" style="width:56px" title="Quante prenotazioni a settimana può fare lo stesso socio su questo campo"></td>
    <td style="text-align:center"><input type="checkbox" id="cp_at_${c.id}" ${c.attivo ? 'checked' : ''}></td>
    <td class="row"><button class="btn gold sm" data-cpsave="${c.id}">Salva</button><button class="btn danger sm" data-cpdel="${c.id}">🗑</button></td>
  </tr>`).join('');
  const gestione = `<div class="panel"><h3>🎾 Campi</h3>
    <p class="muted" style="font-size:.78rem;margin-bottom:8px"><b>Da (ora)</b> è la regola oraria: vuota = nessun vincolo, oppure es. <b>18:00</b> (il calcetto si prenota solo dopo le 18). Gli slot durano <b>Durata</b> minuti, da <b>Apre</b> a <b>Chiude</b>.<br>
    <b>Posti</b> è il numero di giocatori della prenotazione: lo decidi tu qui, il socio non lo cambia. <b>Min. gioc.</b> è il <b>numero legale</b>: se poco prima dell'orario i giocatori dichiarati sono meno di così, la prenotazione decade e il campo torna libero — è quello che rende conveniente dichiarare chi gioca. <b>Max fasce</b> limita la durata di una singola prenotazione, <b>Max/sett.</b> quante prenotazioni può fare lo stesso socio in una settimana su questo campo: servono a evitare che siano sempre gli stessi a occupare il campo.</p>
    <table><thead><tr><th>Nome</th><th>Sport</th><th>Apre</th><th>Chiude</th><th>Durata</th><th>Da (ora)</th><th>Posti</th><th>Min. gioc.</th><th>Max fasce</th><th>Max/sett.</th><th>Attivo</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="12" class="muted">Nessun campo.</td></tr>'}
      <!-- La riga per il nuovo campo sta DENTRO la tabella: ogni casella cade sotto la sua
           intestazione, e si capisce cosa si sta scrivendo senza doverlo indovinare. Prima era
           una fila di caselle sotto la tabella, senza nomi. -->
      <tr style="background:#faf7f0;border-top:2px solid var(--line)">
        <td><input id="cp_new_n" placeholder="es. Campo Tennis" style="width:100%"></td>
        <td><select id="cp_new_sp" style="width:100%">${sportOpts('tennis')}</select></td>
        <td><input id="cp_new_ap" value="16:00" style="width:100%"></td>
        <td><input id="cp_new_ch" value="20:30" style="width:100%"></td>
        <td><input id="cp_new_du" type="number" value="90" style="width:100%"></td>
        <td><input id="cp_new_om" placeholder="—" style="width:100%"></td>
        <td><input id="cp_new_pd" type="number" value="4" style="width:100%"></td>
        <td><input id="cp_new_mg" type="number" value="2" style="width:100%"></td>
        <td><input id="cp_new_ms" type="number" value="1" style="width:100%"></td>
        <td><input id="cp_new_mw" type="number" value="3" style="width:100%"></td>
        <td class="muted" style="font-size:12px">sì</td>
        <td><button class="btn gold sm" id="cp_add">+ Aggiungi</button></td>
      </tr></tbody></table></div>`;
  const campoOpts = campi.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  const blocchi = `<div class="panel"><h3>🚧 Campo impegnato (torneo, manutenzione, evento)</h3>
    <p class="muted" style="font-size:.78rem;margin-bottom:8px">Le fasce dichiarate qui <b>non sono prenotabili</b> dai soci. È così che si applica la regola del basket: quando il campo ospita il torneo, lo blocchi e resta libero solo il resto della giornata.</p>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
      <select id="bl_campo">${campoOpts}</select>
      <input type="date" id="bl_data" value="${oggi}">
      <input id="bl_da" value="09:00" style="width:64px" title="Dalle"><span class="muted">–</span><input id="bl_a" value="22:00" style="width:64px" title="Alle">
      <select id="bl_motivo"><option value="torneo">torneo</option><option value="manutenzione">manutenzione</option><option value="evento">evento</option></select>
      <input id="bl_nota" placeholder="Nota (facoltativa)" style="min-width:160px">
      <button class="btn gold sm" id="bl_add">+ Blocca</button>
    </div>
    <div id="bl_list"></div></div>`;
  const prospetto = `<div class="panel"><h3>📅 Prenotazioni del giorno <input type="date" id="cp_date" value="${oggi}" style="margin-left:8px"></h3>
    <p class="muted" style="font-size:.78rem;margin-bottom:8px">Ogni riga è una prenotazione: <b>titolare</b> (a lui si fa riferimento) e <b>chi si è unito</b>. I campi sono gratuiti: qui si governa solo l'uso, non un conto.</p>
    <div id="cp_pren"></div></div>`;
  $('#view').innerHTML = gestione + blocchi + prospetto;

  const loadPren = async () => {
    const d = $('#cp_date').value || oggi;
    const list = await api('/campi/prenotazioni?data=' + d).catch(() => []);
    $('#cp_pren').innerHTML = list.length
      ? `<table><thead><tr><th>Ora</th><th>Campo</th><th>Tipo</th><th>Titolare</th><th>Partecipanti</th></tr></thead><tbody>${list.map(p => {
          const ora = p.slot_da === p.slot_a ? esc(p.slot_da) : `${esc(p.slot_da)}–${esc(p.slot_a)}`;
          const tipo = p.aperta_ai_soci ? '👥 Aperta ai soci' : '🔒 Riservata';
          const occupati = p.partecipanti ? p.partecipanti.length : 0;
          const cap = p.posti_totali ? ` <span class="muted">(${occupati}/${p.posti_totali})</span>` : '';
          const nomi = (p.partecipanti || []).map(x => esc(x.nome)).join(', ');
          return `<tr><td><b>${ora}</b>${p.fasce > 1 ? ` <span class="muted">${p.fasce} fasce</span>` : ''}</td><td>${esc(p.campo_nome)}</td><td>${tipo}${cap}</td><td><b>${esc(p.titolare || '—')}</b></td><td>${nomi || '<span class="muted">—</span>'}</td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="muted">Nessuna prenotazione per questa data.</p>';
  };
  const loadBlocchi = async () => {
    const list = await api('/campi/blocchi').catch(() => []);
    $('#bl_list').innerHTML = list.length
      ? `<table><thead><tr><th>Data</th><th>Campo</th><th>Fascia</th><th>Motivo</th><th>Nota</th><th></th></tr></thead><tbody>${list.map(b => `<tr><td>${esc(b.data)}</td><td>${esc(b.campo_nome)}</td><td>${esc(b.slot_da)}–${esc(b.slot_a)}</td><td>${esc(b.motivo)}</td><td>${esc(b.nota || '')}</td><td><button class="btn danger sm" data-bldel="${b.id}">🗑</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Nessun blocco attivo.</p>';
    document.querySelectorAll('[data-bldel]').forEach(x => x.onclick = async () => { await api('/campi/blocchi/' + x.dataset.bldel, { method: 'DELETE' }); await loadBlocchi(); await loadPren(); });
  };
  await loadPren();
  await loadBlocchi();
  $('#cp_date').onchange = loadPren;
  $('#bl_add').onclick = async () => {
    await api('/campi/blocchi', { method: 'POST', body: JSON.stringify({ campo_id: Number($('#bl_campo').value), data: $('#bl_data').value, slot_da: $('#bl_da').value, slot_a: $('#bl_a').value, motivo: $('#bl_motivo').value, nota: $('#bl_nota').value || null }) });
    $('#bl_nota').value = '';
    await loadBlocchi();
  };
  document.querySelectorAll('[data-cpsave]').forEach(b => b.onclick = async () => { const id = b.dataset.cpsave; await api('/campi/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#cp_n_' + id).value, sport: $('#cp_sp_' + id).value, apertura: $('#cp_ap_' + id).value, chiusura: $('#cp_ch_' + id).value, durata_slot: Number($('#cp_du_' + id).value), ora_min: $('#cp_om_' + id).value || null, posti_default: Number($('#cp_pd_' + id).value), min_giocatori: Number($('#cp_mg_' + id).value), max_slot_prenotazione: Number($('#cp_ms_' + id).value), max_pren_settimana: Number($('#cp_mw_' + id).value), attivo: $('#cp_at_' + id).checked }) }); b.textContent = '✓'; setTimeout(() => b.textContent = 'Salva', 900); });
  document.querySelectorAll('[data-cpdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il campo e le sue prenotazioni?')) return; await api('/campi/' + b.dataset.cpdel, { method: 'DELETE' }); show('campi'); });
  $('#cp_add').onclick = async () => { if (!$('#cp_new_n').value) { alert('Nome?'); return; } await api('/campi', { method: 'POST', body: JSON.stringify({ nome: $('#cp_new_n').value, sport: $('#cp_new_sp').value, apertura: $('#cp_new_ap').value, chiusura: $('#cp_new_ch').value, durata_slot: Number($('#cp_new_du').value), ora_min: $('#cp_new_om').value || null, posti_default: Number($('#cp_new_pd').value), min_giocatori: Number($('#cp_new_mg').value), max_slot_prenotazione: Number($('#cp_new_ms').value), max_pren_settimana: Number($('#cp_new_mw').value) }) }); show('campi'); };
};

// ---- Proposte ----
VIEWS.proposte = async () => {
  const list = await api('/proposte');
  const render = () => `<div class="panel"><h3>Proposte (Vinile & Open Mic)</h3><table><thead><tr><th>Tipo</th><th>Titolo</th><th>Da</th><th>Stato</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td>${esc(p.tipo)}</td><td><b>${esc(p.titolo||'')}</b><br><span class="muted">${esc(p.dettaglio||'')}</span></td>
      <td>${esc((p.nome||'Ospite')+' '+(p.cognome||''))}</td><td><span class="tag ${p.stato==='in_scaletta'?'ok':p.stato==='scartata'?'no':'mid'}">${esc(p.stato)}</span></td>
      <td style="white-space:nowrap"><button class="btn gold sm" data-st="${p.id}|in_scaletta">In scaletta</button> <button class="btn ghost sm" data-st="${p.id}|scartata">Scarta</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessuna proposta.</td></tr>'}
  </tbody></table></div>`;
  $('#view').innerHTML = render();
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
    const [id, stato] = b.dataset.st.split('|'); await api('/proposte/' + id, { method:'PUT', body:JSON.stringify({ stato }) }); show('proposte');
  });
};

// ---- Eventi ----
const GIORNI_SETT = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
function giornoIdx(g) { const i = GIORNI_SETT.findIndex(d => d.toLowerCase() === String(g || '').trim().toLowerCase()); return i < 0 ? 99 : i; }
// Costo mostrato: quota della serata collegata (se c'è) → altrimenti prezzo dell'evento → altrimenti libero.
// L'ingresso puo' costare un prezzo oppure una consumazione obbligatoria: si entra consumando.
function costoEvento(e, serate) {
  if (e.costo_tipo === 'consumazione') return { tipo: 'consumazione', testo: e.consumazione || '1 consumazione obbligatoria' };
  if (e.serata_id) { const s = (serate || []).find(x => x.id == e.serata_id); if (s && Number(s.quota) > 0) return { tipo: 'prezzo', valore: Number(s.quota) }; }
  return { tipo: Number(e.prezzo || 0) > 0 ? 'prezzo' : 'nessuno', valore: Number(e.prezzo || 0) };
}
function costoLabel(c) {
  if (!c || c.tipo === 'nessuno') return 'Ingresso libero';
  if (c.tipo === 'consumazione') return '🥂 ' + esc(c.testo);
  return '€ ' + Number(c.valore).toFixed(2);
}

VIEWS.eventi = async () => {
  const [list, serate] = await Promise.all([api('/eventi'), api('/serate').catch(() => [])]);
  const ordinati = list.slice().sort((a, b) => giornoIdx(a.giorno) - giornoIdx(b.giorno) || (a.ordine - b.ordine));
  const serOpt = (sel) => `<option value="">— nessuna (prezzo diretto) —</option>` + (serate || []).map(s => `<option value="${s.id}" ${sel == s.id ? 'selected' : ''}>${esc(s.titolo)} · € ${Number(s.quota || 0).toFixed(2)}</option>`).join('');
  $('#view').innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between;align-items:center">
      <h3 style="margin:0">Cartellone settimanale</h3>
      <div class="row"><button class="btn ghost sm" id="ev_new">+ Nuovo evento</button><button class="btn gold sm" id="ev_a3">🖨️ Locandina A3</button></div></div>
    <p class="muted" style="font-size:.82rem;margin:8px 0">Modello ibrido: qui il ritmo della settimana (giorno, ora, tipologia, artista, prezzo). Se l'evento è a pagamento con prenotazione/incasso, collegalo a una <b>Serata</b>: la locandina mostrerà la quota della serata.</p>
    <table><thead><tr><th>Giorno</th><th>Ora</th><th>Evento</th><th>Tipologia / Artista</th><th>Luogo</th><th>Costo</th><th>Attivo</th><th></th></tr></thead><tbody>
    ${ordinati.map(e => `<tr><td><b>${esc(e.giorno || '—')}</b></td><td>${esc(e.ora_inizio || '—')}</td>
      <td><b>${esc(e.titolo)}</b>${e.sottotitolo ? `<br><span class="muted">${esc(e.sottotitolo)}</span>` : ''}</td>
      <td>${esc(e.tipologia || '—')}${e.artista ? `<br><span class="muted">🎤 ${esc(e.artista)}</span>` : ''}</td>
      <td>${e.luogo ? `<span class="tag">${esc(e.luogo === 'carta' ? 'Casa di Carta' : e.luogo)}</span>` : '<span class="muted">—</span>'}${e.capienza ? ` <span class="muted">${e.capienza} p</span>` : ''}${e.occupa_stage ? ' <span class="tag mid">stage riservato</span>' : ''}</td>
      <td>${costoLabel(costoEvento(e, serate))}${(() => {
        const ser = e.serata_id ? (serate || []).find(x => x.id == e.serata_id) : null;
        return ser ? `<div class="muted" style="font-size:12px">🎟️ collegato a <b>${esc(ser.titolo)}</b>${Number(ser.quota) > 0 ? '' : ' (senza quota)'}</div>` : '';
      })()}</td>
      <td>${e.attivo ? '<span class="tag ok">sì</span>' : '<span class="tag no">no</span>'}</td>
      <td class="row"><button class="btn ghost sm" data-ev="${e.id}">✎</button><button class="btn danger sm" data-evdel="${e.id}">🗑</button></td></tr>`).join('')}
  </tbody></table></div>`;

  const editor = (e) => {
    const isNew = !e;
    e = e || { titolo: '', sottotitolo: '', ambiente: '', descrizione: '', giorno: '', ora_inizio: '', tipologia: '', artista: '', prezzo: 0, serata_id: '', attivo: true };
    modal(`<h3>${isNew ? 'Nuovo evento' : 'Modifica evento'}</h3>
      <div class="row"><label style="flex:1">Giorno<select id="e_g"><option value="">—</option>${GIORNI_SETT.map(d => `<option ${d === e.giorno ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label style="width:110px">Ora inizio<input id="e_h" placeholder="21:00" value="${esc(e.ora_inizio || '')}"></label></div>
      <label>Titolo evento</label><input id="e_t" value="${esc(e.titolo || '')}">
      <label>Sottotitolo</label><input id="e_s" value="${esc(e.sottotitolo || '')}">
      <div class="row"><label style="flex:1">Tipologia serata<input id="e_ty" placeholder="es. Jazz & Cocktail" value="${esc(e.tipologia || '')}"></label>
        <label style="flex:1">Artista<input id="e_ar" placeholder="es. Trio X" value="${esc(e.artista || '')}"></label></div>
      <label>Ambiente / luogo</label><input id="e_a" value="${esc(e.ambiente || '')}">
      <label>Descrizione</label><textarea id="e_d" rows="3">${esc(e.descrizione || '')}</textarea>
      ${PAR.eventi_onerosi === false ? '<p class="muted" style="font-size:.78rem">Gli eventi a pagamento sono <b>disattivati</b> nei Parametri: tutti gli ingressi sono liberi.</p>' : `
      <div class="grid2">
        <div><label>Luogo</label><select id="e_luogo">${['', 'bar', 'garden', 'stage', 'carta', 'campi', 'altro'].map(l => `<option value="${l}" ${(e.luogo || '') === l ? 'selected' : ''}>${l === '' ? '— non indicato —' : l === 'carta' ? 'Casa di Carta' : l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('')}</select></div>
        <div><label>Capienza (persone)</label><input id="e_cap" type="number" min="0" value="${e.capienza ?? ''}" placeholder="senza limite"></div>
      </div>
      <label class="check"><input type="checkbox" id="e_occstage" ${e.occupa_stage ? 'checked' : ''}> occupa <b>tutto lo Stage</b> (es. presentazione di un libro): nessun altro posto prenotabile quella sera</label>
      <p class="muted" style="font-size:.78rem">Il <b>luogo</b> dice dove si tiene e quante persone può accogliere. Al Garden la capienza sono i coperti; allo Stage i posti della platea.</p>
      <label>Ingresso</label>
      <div class="row" style="gap:14px;align-items:center;flex-wrap:wrap">
        <label class="check"><input type="radio" name="e_ct" value="nessuno" ${(e.costo_tipo || 'nessuno') === 'nessuno' ? 'checked' : ''}> Libero</label>
        ${PAR.eventi_modo_costo !== 'consumazione' ? `<label class="check"><input type="radio" name="e_ct" value="prezzo" ${e.costo_tipo === 'prezzo' ? 'checked' : ''}> Prezzo d'ingresso</label>` : ''}
        ${PAR.eventi_modo_costo !== 'prezzo' ? `<label class="check"><input type="radio" name="e_ct" value="consumazione" ${e.costo_tipo === 'consumazione' ? 'checked' : ''}> Consumazione obbligatoria</label>` : ''}
      </div>
      <div class="row" style="margin-top:8px">
        <label style="width:150px">Prezzo €<input id="e_pz" type="number" step="0.01" inputmode="decimal" value="${Number(e.prezzo || 0)}"></label>
        <label style="flex:1">Testo della consumazione<input id="e_cons" placeholder="1 consumazione obbligatoria" value="${esc(e.consumazione || '')}"></label>
      </div>
      <div class="row" style="margin-top:8px"><label style="flex:1">Collega a Serata a pagamento<select id="e_ser">${serOpt(e.serata_id)}</select></label>
        <button class="btn ghost sm" id="e_ser_new" style="align-self:flex-end">+ Crea serata</button></div>
      <p class="muted" style="font-size:.78rem">Con la <b>consumazione obbligatoria</b> non si paga un biglietto: si entra consumando, e in app e in locandina compare il testo che scrivi qui. Se colleghi una Serata, prenotazione e incasso si gestiscono nella sezione <b>Serate</b>.</p>`}
      <label class="check"><input type="checkbox" id="e_on" ${e.attivo ? 'checked' : ''}> Visibile nell'app</label>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>`);
    $('#mCancel').onclick = closeModal;
    // Crea una serata a pagamento a partire dai campi dell'evento e la collega (senza uscire dall'editor).
    $('#e_ser_new').onclick = async () => {
      const titolo = $('#e_t').value.trim();
      if (!titolo) { alert('Inserisci prima il titolo dell\'evento.'); return; }
      const giorno = $('#e_g').value, ora = $('#e_h').value;
      const quando = [giorno, ora].filter(Boolean).join(' · ');
      const quota = Number($('#e_pz').value || 0);
      try {
        const r = await api('/serate', { method: 'POST', body: JSON.stringify({ titolo, quando, tema: $('#e_ty').value, descrizione: $('#e_d').value, quota, capienza: 80 }) });
        const sel = $('#e_ser');
        const opt = document.createElement('option');
        opt.value = r.id; opt.textContent = `${titolo} · € ${quota.toFixed(2)}`; opt.selected = true;
        sel.appendChild(opt);
        alert('Serata creata e collegata. Premi Salva per confermare l\'evento; le prenotazioni si gestiscono nella sezione Serate.');
      } catch (err) { alert('Non riesco a creare la serata: ' + (err.message || 'permesso mancante?')); }
    };
    $('#mSave').onclick = async () => {
      const ct = document.querySelector('input[name="e_ct"]:checked');
      const body = { giorno: $('#e_g').value, ora_inizio: $('#e_h').value, titolo: $('#e_t').value, sottotitolo: $('#e_s').value, tipologia: $('#e_ty').value, artista: $('#e_ar').value, ambiente: $('#e_a').value, descrizione: $('#e_d').value,
        costo_tipo: ct ? ct.value : 'nessuno', prezzo: Number(($('#e_pz') || {}).value || 0), consumazione: ($('#e_cons') || {}).value || '',
        luogo: ($('#e_luogo') || {}).value || null, capienza: ($('#e_cap') || {}).value, occupa_stage: ($('#e_occstage') || {}).checked,
        serata_id: ($('#e_ser') || {}).value || null, attivo: $('#e_on').checked };
      if (!body.titolo) { alert('Titolo obbligatorio'); return; }
      if (isNew) await api('/eventi', { method: 'POST', body: JSON.stringify(body) });
      else await api('/eventi/' + e.id, { method: 'PUT', body: JSON.stringify(body) });
      closeModal(); show('eventi');
    };
  };
  document.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => editor(list.find(x => x.id == b.dataset.ev)));
  document.querySelectorAll('[data-evdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare l\'evento?')) return; await api('/eventi/' + b.dataset.evdel, { method: 'DELETE' }); show('eventi'); });
  $('#ev_new').onclick = () => editor(null);
  $('#ev_a3').onclick = () => locandinaA3(ordinati.filter(e => e.attivo), serate);
};

// ---- Avvisi push (broadcast del gestore) ----
VIEWS.avvisi = async () => {
  const [stato, casate] = await Promise.all([api('/push/stato').catch(() => ({})), api('/casate').catch(() => [])]);
  const statoBadge = stato.enabled
    ? `<span class="tag ok">attivo</span> · ${stato.dispositivi || 0} dispositivi iscritti · ${stato.consenzienti || 0} soci col consenso`
    : `<span class="tag no">non configurato</span> — imposta le chiavi <b>VAPID_PUBLIC</b>/<b>VAPID_PRIVATE</b> su Render per inviare push reali (intanto l'avviso resta comunque nelle notifiche in-app).`;
  $('#view').innerHTML = `<div class="panel"><h3>🔔 Invia un avviso ai soci</h3>
    <p class="muted" style="font-size:.82rem;margin:6px 0">Stato push: ${statoBadge}</p>
    <label>Titolo</label><input id="pb_t" placeholder="Es. Stasera Jazz & Cocktail alle 21:30">
    <label>Messaggio</label><textarea id="pb_c" rows="3" placeholder="Testo dell'avviso…"></textarea>
    <label>Destinatari</label>
    <select id="pb_cas"><option value="">Tutti i soci col consenso</option>${(casate || []).map(c => `<option value="${c.id}">Solo casata ${esc(c.nome)}</option>`).join('')}</select>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn gold" id="pb_send">Invia avviso</button></div>
    <p class="muted" style="font-size:.78rem;margin-top:8px">L'avviso arriva come notifica push a chi ha attivato le notifiche e installato l'app, e resta sempre visibile nelle notifiche in-app.</p></div>`;
  $('#pb_send').onclick = async () => {
    const titolo = $('#pb_t').value.trim(); if (!titolo) { alert('Titolo obbligatorio'); return; }
    const body = { titolo, corpo: $('#pb_c').value.trim(), casata_id: $('#pb_cas').value || null };
    try { const r = await api('/push/broadcast', { method: 'POST', body: JSON.stringify(body) });
      alert(`Avviso inviato a ${r.destinatari} soci` + (r.enabled ? ` · ${r.inviati} push consegnate.` : ' (push non configurato: solo in-app).'));
      $('#pb_t').value = ''; $('#pb_c').value = '';
    } catch (err) { alert('Invio non riuscito: ' + (err.message || '')); }
  };
};

// Locandina A3 orizzontale, elegante, stampabile (o "Salva come PDF"): un evento per riga con
// giorno · ora · evento · tipologia · artista · costo. Stesso stile del menù PDF (logo, oro Bussola).
function locandinaA3(eventi, serate) {
  const logo = `<svg width="54" height="54" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="none" stroke="#E0B44A" stroke-width="3"/><path d="M24 6 L29 24 L24 42 L19 24 Z" fill="#E0B44A"/><path d="M6 24 L24 19 L42 24 L24 29 Z" fill="#12324F" opacity="0.85"/></svg>`;
  const righe = (eventi || []).map(e => {
    const costo = costoLabel(costoEvento(e, serate));
    return `<div class="ev">
      <div class="gg"><div class="d">${esc(e.giorno || '')}</div><div class="h">${esc(e.ora_inizio || '')}</div></div>
      <div class="mid"><div class="ti">${esc(e.titolo || '')}</div>
        ${e.tipologia ? `<div class="ty">${esc(e.tipologia)}</div>` : ''}
        ${e.artista ? `<div class="ar">🎤 ${esc(e.artista)}</div>` : ''}</div>
      <div class="co">${costo}</div></div>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare la locandina.'); return; }
  w.document.write(`<html><head><title>Eventi della settimana</title><style>
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
    <header>${logo}<div class="t"><h1>EVENTI DELLA SETTIMANA</h1><div class="sub">BUSSOLA RESIDENCE</div></div><div class="wk">Il programma delle serate</div></header>
    ${righe || '<p>Nessun evento attivo in programma.</p>'}
    <footer>Ti aspettiamo alla Bussola · Prenotazioni e info al chiosco</footer>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
  </body></html>`);
  w.document.close();
}

// ---- Bussola ----
const RIF_DAYS = [['lun', 'Lun'], ['mar', 'Mar'], ['mer', 'Mer'], ['gio', 'Gio'], ['ven', 'Ven'], ['sab', 'Sab'], ['dom', 'Dom']];
// normalizza il valore di un giorno in un ARRAY di tipi (retro-compat: stringa singola o vuoto)
function rifNorm(v) { if (Array.isArray(v)) return v.filter(Boolean); if (v == null || v === '') return []; return [String(v)]; }
function rifTxt(hex) { if (!hex) return '#fff'; const h = hex.replace('#', ''); if (h.length < 6) return '#fff'; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1a1a1a' : '#fff'; }
function rifGrad(cols) { if (!cols.length) return '#fff'; if (cols.length === 1) return cols[0]; const n = cols.length; return 'linear-gradient(180deg,' + cols.map((c, i) => `${c} ${Math.round(i / n * 100)}%, ${c} ${Math.round((i + 1) / n * 100)}%`).join(', ') + ')'; }
VIEWS.bussola = async () => {
  const list = await api('/bussola');
  const rif = await api('/rifiuti').catch(() => ({ tipi: [], calendari: [] }));
  const colorBy = {}; rif.tipi.forEach(t => colorBy[t.nome] = t.colore);
  const legenda = `<div class="panel"><h3>♻️ Rifiuti · legenda (tipo e colore)</h3>
    <table><thead><tr><th>Tipo</th><th>Colore</th><th></th></tr></thead><tbody>
      ${rif.tipi.map(t => `<tr><td><input id="rt_n_${t.id}" value="${esc(t.nome)}" style="min-width:160px"></td><td><input type="color" id="rt_c_${t.id}" value="${esc(t.colore)}"></td><td style="white-space:nowrap"><button class="btn gold sm" data-rtsave="${t.id}">Salva</button> <button class="btn danger sm" data-rtdel="${t.id}">🗑</button></td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:10px"><input id="rt_new_n" placeholder="Nuovo tipo (es. Organico)" style="max-width:220px"><input type="color" id="rt_new_c" value="#7A8790"><button class="btn gold sm" id="rt_add">+ Aggiungi</button></div></div>`;
  const periodBlocks = rif.calendari.map(c => {
    const matrix = rif.tipi.length ? `<table class="rc_matrix" style="width:100%;border-collapse:collapse;margin-top:4px">
      <thead><tr><th style="text-align:left;padding:4px 8px;font-size:.72rem;color:var(--muted)">Rifiuto</th>${RIF_DAYS.map(([, l]) => `<th style="text-align:center;padding:4px 2px;font-size:.72rem;color:var(--muted)">${l}</th>`).join('')}</tr></thead>
      <tbody>${rif.tipi.map(t => `<tr>
        <td style="padding:5px 8px;white-space:nowrap"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(t.colore)};vertical-align:middle;margin-right:7px;border:1px solid rgba(0,0,0,.12)"></span><b style="font-size:.82rem">${esc(t.nome)}</b></td>
        ${RIF_DAYS.map(([d]) => { const on = rifNorm((c.giorni || {})[d]).includes(t.nome); return `<td style="text-align:center;padding:3px"><button type="button" class="rc_tog${on ? ' active' : ''}" data-per="${esc(c.periodo)}" data-day="${d}" data-tipo="${esc(t.nome)}" data-col="${esc(t.colore)}" aria-pressed="${on}" title="${esc(t.nome)} · ${d}" style="width:26px;height:26px;border-radius:7px;cursor:pointer;font-size:.8rem;font-weight:800;line-height:1;padding:0">${on ? '✓' : ''}</button></td>`; }).join('')}
      </tr>`).join('')}</tbody></table>` : `<p class="muted" style="font-size:.8rem">Prima aggiungi almeno un tipo di rifiuto nella legenda qui sopra.</p>`;
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:14px">
      <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <label class="check" style="margin:0" title="Solo i periodi accesi si vedono nell'app dei soci"><input type="checkbox" id="rc_on_${esc(c.periodo)}" ${c.attivo === false ? '' : 'checked'}> <b style="font-size:1rem;color:var(--navy)">${esc(c.periodo)}</b></label>
        ${c.attivo === false ? '<span class="tag">non in corso</span>' : '<span class="tag ok">in corso</span>'}
        <span class="muted" style="font-size:.78rem;margin-left:6px">Conferimento</span>
        <input id="rc_ini_${esc(c.periodo)}" value="${esc(c.inizio_conf || '')}" style="width:64px" placeholder="18:30"><span class="muted">–</span><input id="rc_fin_${esc(c.periodo)}" value="${esc(c.fine_conf || '')}" style="width:64px" placeholder="21:30">
        <span class="muted" style="font-size:.78rem">· Ritiro</span><input id="rc_rit_${esc(c.periodo)}" value="${esc(c.ora_ritiro || '')}" style="width:64px" placeholder="22:00">
        <span style="flex:1"></span>
        <button class="btn gold sm" data-rcsave="${esc(c.periodo)}">Salva</button> <button class="btn danger sm" data-rcdel="${esc(c.periodo)}">🗑</button>
      </div>
      ${matrix}
    </div>`;
  }).join('');
  const calendario = `<div class="panel"><h3>♻️ Rifiuti · calendario conferimento</h3>
    <p class="muted" style="margin-bottom:12px"><b>Nell'app dei soci si vede solo il periodo acceso</b>: spunta quello in corso e spegni gli altri, invece di mostrarli tutti uno sotto l'altro. Per ogni periodo imposta gli orari e <b>clicca le caselle</b>: ogni riga è un rifiuto, ogni colonna un giorno. Un giorno può avere più rifiuti (es. venerdì: Carta <i>e</i> Vetro). La casella accesa mostra il colore della legenda.</p>
    ${periodBlocks || `<p class="muted">Nessun periodo. Aggiungine uno qui sotto.</p>`}
    <div class="row" style="margin-top:6px"><input id="rc_new_per" placeholder="Nuovo periodo (es. Invernale)" style="max-width:220px"><button class="btn gold sm" id="rc_add">+ Aggiungi periodo</button></div></div>`;
  // Ogni voce ha la sua scheda: testi e COORDINATE. Senza coordinate la voce resta una riga di
  // testo; con le coordinate diventa un collegamento che apre le mappe del telefono.
  const voci = list.filter(b => b.sezione !== 'rifiuti');
  const senzaGeo = voci.filter(b => b.sezione !== 'orari' && (b.lat == null || b.lng == null)).length;
  const scheda = (b) => {
    const geo = b.lat != null && b.lng != null;
    const orari = b.sezione === 'orari';
    return `<div style="border:1px solid var(--line);border-left:4px solid ${geo || orari ? 'var(--ok)' : 'var(--gold)'};border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#fff">
      <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span class="tag">${esc(b.sezione)}</span>
        <input id="bv_t_${b.id}" value="${esc(b.titolo)}" style="min-width:180px;font-weight:700">
        <input id="bv_d_${b.id}" value="${esc(b.dettaglio || '')}" placeholder="Dettaglio" style="flex:1;min-width:160px">
        <input id="bv_km_${b.id}" value="${esc(b.distanza || '')}" placeholder="Distanza" style="width:100px">
        <span style="flex:1"></span>
        <button class="btn gold sm" data-bvsave="${b.id}">Salva</button>
        <button class="btn danger sm" data-del="${b.id}">🗑</button>
      </div>
      ${orari ? '<p class="muted" style="font-size:.78rem;margin:0">Voce informativa: non ha una posizione sulla mappa.</p>' : `
      <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
        <label class="muted" style="font-size:.78rem">Lat <input id="bv_lat_${b.id}" value="${corto(b.lat)}" placeholder="latitudine" style="width:110px"></label>
        <label class="muted" style="font-size:.78rem">Lng <input id="bv_lng_${b.id}" value="${corto(b.lng)}" placeholder="longitudine" style="width:110px"></label>
        <input id="bv_inc_${b.id}" placeholder="…oppure incolla il link (Google Maps, Waze, Apple Maps) o le coordinate" style="flex:1;min-width:240px">
        <button class="btn ghost sm" data-bvinc="${b.id}">Leggi</button>
        ${geo ? `<a class="btn ghost sm" href="https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}" target="_blank" rel="noopener">🔎 Verifica sulla mappa</a>`
              : '<span class="tag mid">senza posizione</span>'}
      </div>
      <div id="bv_nota_${b.id}" class="muted" style="font-size:.74rem;margin-top:4px"></div>
      <div class="row" style="gap:8px;align-items:flex-start;flex-wrap:wrap;margin-top:8px">
        <label class="muted" style="flex:1;min-width:260px;font-size:.78rem">Codice mappa di Google <i>(Condividi → Incorpora una mappa → Copia HTML)</i>
          <textarea id="bv_emb_${b.id}" rows="2" placeholder="&lt;iframe src=&quot;https://www.google.com/maps/embed?pb=…&quot;&gt;&lt;/iframe&gt;" style="width:100%;font-family:monospace;font-size:11px">${esc(b.mappa_embed || '')}</textarea></label>
        ${b.mappa_embed ? `<div style="flex:0 0 220px"><iframe src="${esc(b.mappa_embed)}" style="width:220px;height:130px;border:1px solid var(--line);border-radius:8px" loading="lazy"></iframe>
          <div class="muted" style="font-size:.72rem;text-align:center">mappa impostata</div></div>` : ''}
      </div>`}
    </div>`;
  };
  $('#view').innerHTML = legenda + calendario + `<div class="panel" data-fold="guida"><h3>🧭 Contenuti della guida</h3>
    <p class="muted">Ogni voce può avere una <b>posizione</b>: con le coordinate, nell'app dei soci diventa un collegamento che apre le mappe del telefono.<br>
    <b>Come si indica la posizione:</b> incolla quello che hai e premi <b>Leggi</b>. Vanno bene le <b>coordinate</b> copiate da Google Maps (tasto destro sul punto → clic sulle coordinate), il <b>link della mappa</b>, il link <b>condiviso dal telefono</b> anche se accorciato, e i link di <b>Waze</b>, <b>Apple Maps</b> e <b>OpenStreetMap</b>. Riconosce anche i gradi (36°55'07.0"N 15°10'14.2"E) e la virgola decimale italiana.<br>
    Dopo aver salvato, usa <b>Verifica sulla mappa</b>: se il segnaposto non cade sul posto giusto, la posizione è sbagliata.<br>
    <b>Mappa esatta:</b> su Google Maps scegli l'inquadratura che vuoi, poi <b>Condividi → Incorpora una mappa → Copia HTML</b> e incolla il codice nel riquadro della voce. È quella mappa che vedranno i soci; le coordinate per le indicazioni si ricavano da sola.</p>
    ${senzaGeo ? `<div class="row" style="background:#fdf6e6;border-left:4px solid var(--gold);padding:10px 12px;border-radius:0 8px 8px 0;margin-bottom:12px"><b>${senzaGeo} voci senza posizione.</b> <span class="muted">Finché non hanno le coordinate restano righe di testo, senza collegamento alla mappa.</span></div>` : ''}
    ${voci.map(scheda).join('') || '<p class="muted">Nessuna voce.</p>'}
    <h3 style="margin-top:18px">Aggiungi una voce</h3>
    <div class="row"><select id="b_sez"><option value="servizi">servizi</option><option value="vedere">vedere</option><option value="orari">orari</option></select>
      <input id="b_tit" placeholder="Titolo"><input id="b_det" placeholder="Dettaglio"><input id="b_dist" placeholder="Distanza" style="max-width:110px">
      <input id="b_geo" placeholder="Coordinate o link Google Maps" style="min-width:220px">
      <button class="btn gold sm" id="b_add">+ Aggiungi</button></div>
  </div>`;
  // caselle matrice: accese col colore del rifiuto, spente su fondo bianco
  const styleTog = (btn) => { const on = btn.classList.contains('active'); const col = btn.dataset.col || '#7A8790'; if (on) { btn.style.background = col; btn.style.border = '1.5px solid ' + col; btn.style.color = rifTxt(col); btn.textContent = '✓'; } else { btn.style.background = '#fff'; btn.style.border = '1.5px solid #cbd2d8'; btn.style.color = ''; btn.textContent = ''; } };
  document.querySelectorAll('.rc_tog').forEach(btn => { styleTog(btn); btn.onclick = () => { btn.classList.toggle('active'); btn.setAttribute('aria-pressed', btn.classList.contains('active')); styleTog(btn); }; });
  // legenda
  document.querySelectorAll('[data-rtsave]').forEach(b => b.onclick = async () => { const id = b.dataset.rtsave; await api('/rifiuti/tipo/' + id, { method: 'PUT', body: JSON.stringify({ nome: $('#rt_n_' + id).value, colore: $('#rt_c_' + id).value }) }); show('bussola'); });
  document.querySelectorAll('[data-rtdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il tipo di rifiuto?')) return; await api('/rifiuti/tipo/' + b.dataset.rtdel, { method: 'DELETE' }); show('bussola'); });
  $('#rt_add').onclick = async () => { if (!$('#rt_new_n').value) return; await api('/rifiuti/tipo', { method: 'POST', body: JSON.stringify({ nome: $('#rt_new_n').value, colore: $('#rt_new_c').value }) }); show('bussola'); };
  // calendario
  document.querySelectorAll('[data-rcsave]').forEach(b => b.onclick = async () => {
    const per = b.dataset.rcsave; const giorni = {};
    RIF_DAYS.forEach(([d]) => giorni[d] = [...document.querySelectorAll(`.rc_tog.active[data-per="${CSS.escape(per)}"][data-day="${d}"]`)].map(x => x.dataset.tipo));
    const gv = (p) => (document.getElementById('rc_' + p + '_' + per) || {}).value || '';
    const on = document.getElementById('rc_on_' + per);
    await api('/rifiuti/calendario/' + encodeURIComponent(per), { method: 'PUT', body: JSON.stringify({ inizio_conf: gv('ini'), fine_conf: gv('fin'), ora_ritiro: gv('rit'), giorni, attivo: on ? on.checked : true }) });
    b.textContent = '✓'; setTimeout(() => b.textContent = 'Salva', 1000);
  });
  document.querySelectorAll('[data-rcdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il periodo?')) return; await api('/rifiuti/calendario/' + encodeURIComponent(b.dataset.rcdel), { method: 'DELETE' }); show('bussola'); });
  $('#rc_add').onclick = async () => { const per = ($('#rc_new_per').value || '').trim(); if (!per) return; await api('/rifiuti/calendario/' + encodeURIComponent(per), { method: 'PUT', body: JSON.stringify({ giorni: {} }) }); show('bussola'); };
  // "Leggi" estrae le coordinate da quello che e' stato incollato e riempie i due campi.
  document.querySelectorAll('[data-bvinc]').forEach(b => b.onclick = async () => {
    const id = b.dataset.bvinc;
    const testo = $('#bv_inc_' + id).value;
    if (!testo.trim()) return;
    // Prima si prova qui (istantaneo), poi si chiede al server, che sa seguire i link corti.
    let c = parseCoords(testo);
    const eti = b.textContent;
    if (!c) {
      b.textContent = '…'; b.disabled = true;
      try { c = await api('/geo/risolvi', { method: 'POST', body: JSON.stringify({ testo }) }); }
      catch (e) { alert(e.message || 'Non riesco a leggere una posizione da questo testo.'); }
      b.textContent = eti; b.disabled = false;
    }
    if (!c || c.lat == null) return;
    $('#bv_lat_' + id).value = Number(c.lat).toFixed(5);
    $('#bv_lng_' + id).value = Number(c.lng).toFixed(5);
    $('#bv_inc_' + id).value = '';
    const nota = $('#bv_nota_' + id);
    if (nota) nota.textContent = c.origine === 'testo' ? '' : `Letto seguendo il link. Controlla con “Verifica sulla mappa”.`;
  });
  // Conversione al volo: incollando i gradi nel campo, uscendo si legge il decimale. E se
  // per sbaglio la coppia intera finisce in Lat, si divide da sola nei due campi.
  const convertiCampo = (id, asse) => {
    const el = $(`#bv_${asse}_${id}`); if (!el) return;
    el.onblur = () => {
      const v = (el.value || '').trim(); if (!v) return;
      if (asse === 'lat') {
        const coppia = parseCoords(v);
        const soloUno = /^[\d.,\s°'"NSEWOnsewo-]+$/.test(v) && !/[,;]\s*-?\d+[.,]\d/.test(v);
        if (coppia && !soloUno) {
          el.value = coppia.lat.toFixed(5);
          const l = $(`#bv_lng_${id}`); if (l) l.value = coppia.lng.toFixed(5);
          return;
        }
      }
      const n = gradiADecimale(v, asse);
      if (n != null) el.value = n.toFixed(5);
    };
  };
  document.querySelectorAll('[data-bvsave]').forEach(b => { convertiCampo(b.dataset.bvsave, 'lat'); convertiCampo(b.dataset.bvsave, 'lng'); });
  document.querySelectorAll('[data-bvsave]').forEach(b => b.onclick = async () => {
    const id = b.dataset.bvsave;
    const incollato = ($('#bv_inc_' + id) || {}).value;
    const c = incollato ? parseCoords(incollato) : null;   // se ha incollato senza premere Leggi
    const lat = c ? c.lat : ($('#bv_lat_' + id) || {}).value;
    const lng = c ? c.lng : ($('#bv_lng_' + id) || {}).value;
    const emb = $('#bv_emb_' + id);
    await api('/bussola/' + id, { method: 'PUT', body: JSON.stringify({
      titolo: $('#bv_t_' + id).value, dettaglio: $('#bv_d_' + id).value,
      distanza: $('#bv_km_' + id).value, lat, lng,
      ...(emb ? { mappa_embed: emb.value } : {})
    }) });
    show('bussola');
  });
  $('#b_add').onclick = async () => {
    const c = parseCoords($('#b_geo').value);
    await api('/bussola', { method: 'POST', body: JSON.stringify({ sezione: $('#b_sez').value, titolo: $('#b_tit').value, dettaglio: $('#b_det').value, distanza: $('#b_dist').value, lat: c ? c.lat : null, lng: c ? c.lng : null }) });
    show('bussola');
  };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('/bussola/' + b.dataset.del, { method: 'DELETE' }); show('bussola'); });
};

// ---- Luoghi "Siamo qui" ----
// Accetta quello che l'operatore ha sotto mano: le coordinate copiate da Google Maps
// ("36.918, 15.170"), il link della mappa (/@lat,lng oppure ?q= oppure !3d!4d dei link lunghi),
// o un link "place" completo. I link accorciati (maps.app.goo.gl) NON contengono le coordinate:
// in quel caso si apre il link e si copiano dalla barra dell'indirizzo.
function parseCoords(s) {
  if (!s) return null;
  const m = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
    || s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    || s.match(/[?&](?:q|ll|daddr|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
    || s.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function corto(v) { return v == null ? '' : Number(v).toFixed(5); }
// Un solo valore: decimale (punto o virgola) oppure grado singolo 37°03'34.6"N.
// Riconosce il codice della mappa incollato per sbaglio nel campo del link.
function leggiEmbedLocale(t) {
  const s = String(t || '');
  const m = s.match(/src\s*=\s*["']([^"']+)["']/i);
  const url = (m ? m[1] : s).trim();
  if (!/^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed\?/i.test(url)) return null;
  const lng = url.match(/!2d(-?\d+(?:\.\d+)?)/), lat = url.match(/!3d(-?\d+(?:\.\d+)?)/);
  return { src: url, lat: lat ? Number(lat[1]) : null, lng: lng ? Number(lng[1]) : null };
}
function gradiADecimale(t, asse) {
  const s = String(t || '').trim();
  const g = s.match(/^(\d{1,3})\s*°\s*(\d{1,2})?\s*['\u2032]?\s*([\d.,]+)?\s*["\u2033]?\s*([NSEWOnsewo])?$/);
  if (g) {
    const v = Number(g[1]) + Number(g[2] || 0) / 60 + Number(String(g[3] || 0).replace(',', '.')) / 3600;
    const d = (g[4] || '').toUpperCase();
    return Number.isFinite(v) ? (d === 'S' || d === 'W' || d === 'O' ? -v : v) : null;
  }
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (asse === 'lat' && Math.abs(n) > 90) return null;
  if (asse === 'lng' && Math.abs(n) > 180) return null;
  return n;
}
VIEWS.luoghi = async () => {
  const list = await api('/luoghi');
  $('#view').innerHTML = `
    <div class="panel"><h3>Punti "Siamo qui" — coordinate</h3>
      <p class="muted" style="margin-bottom:12px">Si impostano <b>come le voci della Guida</b>: coordinate decimali, gradi copiati da Google, link incollato, oppure il <b>codice della mappa</b> (Condividi → Incorpora una mappa → Copia HTML), da cui le coordinate si ricavano da sole.<br>
      Nell'app il socio tocca la voce e la mappa si apre <b>dentro l'applicazione</b>, con il tasto per farsi accompagnare.</p>
      ${list.map(l => `<div class="card" style="border:1px solid var(--line);padding:14px;margin-bottom:12px">
        <div class="row" style="margin-bottom:8px"><b style="color:var(--navy)">${esc(l.chiave === 'chiosco' ? '📍' : '♻️')} ${esc(l.nome)}</b></div>
        <div class="grid2">
          <div><label>Nome</label><input id="n_${l.id}" value="${esc(l.nome)}"></div>
          <div><label>Incolla link o coordinate</label><input id="p_${l.id}" placeholder="es. 37.0335, 15.2969 oppure link Maps"></div>
          <div><label>Latitudine</label><input id="lat_${l.id}" value="${l.lat ?? ''}" placeholder="latitudine, anche in gradi"></div>
          <div><label>Longitudine</label><input id="lng_${l.id}" value="${l.lng ?? ''}" placeholder="longitudine, anche in gradi"></div>
        </div>
        <div class="row" style="gap:8px;align-items:flex-start;flex-wrap:wrap;margin-top:8px">
          <label class="muted" style="flex:1;min-width:260px;font-size:.78rem">Codice mappa di Google <i>(Condividi → Incorpora una mappa → Copia HTML)</i>
            <textarea id="emb_${l.id}" rows="2" placeholder="&lt;iframe src=&quot;https://www.google.com/maps/embed?pb=…&quot;&gt;&lt;/iframe&gt;" style="width:100%;font-family:monospace;font-size:11px">${esc(l.mappa_embed || '')}</textarea></label>
          ${l.mappa_embed ? `<div style="flex:0 0 200px"><iframe src="${esc(l.mappa_embed)}" style="width:200px;height:120px;border:1px solid var(--line);border-radius:8px" loading="lazy"></iframe>
            <div class="muted" style="font-size:.72rem;text-align:center">mappa impostata</div></div>` : ''}
        </div>
        <div class="row" style="margin-top:10px;align-items:center">
          <button class="btn gold sm" data-save="${l.id}">Salva</button>
          <a class="btn ghost sm" id="prev_${l.id}" href="https://www.google.com/maps?q=${l.lat ?? ''},${l.lng ?? ''}" target="_blank" style="text-decoration:none">Anteprima mappa ↗</a>
          <span class="muted" id="ok_${l.id}"></span>
        </div>
      </div>`).join('')}
    </div>`;
  list.forEach(l => {
    const pasteEl = document.getElementById('p_' + l.id);
    pasteEl.addEventListener('input', () => {
      const c = parseCoords(pasteEl.value);
      if (c) { $('#lat_' + l.id).value = c.lat; $('#lng_' + l.id).value = c.lng; return; }
      const e = leggiEmbedLocale(pasteEl.value);
      if (e) { const emb = $('#emb_' + l.id); if (emb) emb.value = pasteEl.value; if (e.lat != null) { $('#lat_' + l.id).value = e.lat; $('#lng_' + l.id).value = e.lng; } }
    });
    for (const asse of ['lat', 'lng']) {
      const el = $('#' + asse + '_' + l.id);
      if (el) el.onblur = () => { const n = gradiADecimale(el.value, asse); if (n != null) el.value = n.toFixed(5); };
    }
    document.getElementById('prev_' + l.id).onclick = (e) => { e.preventDefault(); window.open('https://www.google.com/maps?q=' + $('#lat_' + l.id).value + ',' + $('#lng_' + l.id).value, '_blank'); };
    document.querySelector(`[data-save="${l.id}"]`).onclick = async () => {
      try {
        await api('/luoghi/' + l.id, { method: 'PUT', body: JSON.stringify({
          nome: $('#n_' + l.id).value, lat: $('#lat_' + l.id).value, lng: $('#lng_' + l.id).value,
          mappa_embed: ($('#emb_' + l.id) || {}).value ?? ''
        }) });
        show('luoghi');
      } catch (e) { $('#ok_' + l.id).textContent = e.message; }
    };
  });
};

// ---- Discipline parametriche ----
VIEWS.discipline = async () => {
  const list = await api('/discipline');
  const row = (d) => `<tr>
    <td>${esc(d.dominio)}</td>
    <td><input id="dn_${d.id}" value="${esc(d.nome)}" style="min-width:150px"></td>
    <td style="text-align:center"><input type="checkbox" id="da_${d.id}" ${d.attivo?'checked':''}></td>
    <td><input type="number" id="dmin_${d.id}" value="${d.min_giocatori}" style="width:60px"></td>
    <td><input type="number" id="dmax_${d.id}" value="${d.max_giocatori}" style="width:60px"></td>
    <td><input type="number" id="dpv_${d.id}" value="${d.punti_vitt}" style="width:55px"></td>
    <td><input type="number" id="dpp_${d.id}" value="${d.punti_par}" style="width:55px"></td>
    <td style="white-space:nowrap"><button class="btn gold sm" data-dsave="${d.id}">Salva</button> ${can('discipline_del') ? `<button class="btn danger sm" data-ddel="${d.id}">🗑</button>` : ''}</td>
  </tr>`;
  $('#view').innerHTML = `
    <div class="panel"><h3>Discipline — attiva/disattiva e partecipanti</h3>
      <p class="muted" style="margin-bottom:10px">Disattiva una disciplina per non giocarla quest'anno (resta in archivio). Min/Max = partecipanti per casata a partita; i punti in graduatoria si assegnano per <b>vittoria</b> e per <b>pareggio</b>.</p>
      <table><thead><tr><th>Dominio</th><th>Nome</th><th>Attiva</th><th>Min</th><th>Max</th><th>Punti vittoria</th><th>Punti pareggio</th><th></th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table>
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
    </div>`;
  document.querySelectorAll('[data-dsave]').forEach(b => b.onclick = async () => {
    const id = b.dataset.dsave;
    await api('/discipline/' + id, { method:'PUT', body: JSON.stringify({ nome:$('#dn_'+id).value, attivo:$('#da_'+id).checked, min_giocatori:$('#dmin_'+id).value, max_giocatori:$('#dmax_'+id).value, punti_vitt:$('#dpv_'+id).value, punti_par:$('#dpp_'+id).value }) });
    b.textContent='✓'; setTimeout(()=>b.textContent='Salva',1200);
  });
  document.querySelectorAll('[data-ddel]').forEach(b => b.onclick = async () => { if(!confirm('Eliminare la disciplina (e i suoi gironi/partite)?'))return; await api('/discipline/'+b.dataset.ddel,{method:'DELETE'}); show('discipline'); });
  $('#nd_add').onclick = async () => {
    try { await api('/discipline', { method:'POST', body: JSON.stringify({ dominio:$('#nd_dom').value, chiave:$('#nd_chiave').value, nome:$('#nd_nome').value, attivo:true, min_giocatori:$('#nd_min').value, max_giocatori:$('#nd_max').value }) }); show('discipline'); }
    catch(e){ $('#nd_err').textContent = e.message; }
  };
};

// ---- Tornei: periodo, stato, regolamento, calendario, archiviazione, Albo d'Oro ----
// Il TABELLONE (gironi, giornate, date, risultati, foglio gara) sta nel Crew, non qui:
// i gironi si formano da soli dalle 8 casate, quindi replicarne la gestione era inutile
// e creava due posti da tenere allineati.
// Vista SOLA LETTURA del girone: classifica + calendario con i risultati registrati.
// L'INSERIMENTO risultati NON è qui: si fa nell'app Bussola Crew (modulo Sport). Qui il gestore imposta e consulta.
VIEWS.tabellone = async () => {
  const discs = await api('/discipline');
  if (!discs.length) { $('#view').innerHTML = '<p class="muted">Nessuna disciplina.</p>'; return; }
  let cur = discs[0].id;
  const render = async () => {
    const t = await api('/tabellone/' + cur);
    const disc = (await api('/discipline')).find(d => d.id == cur) || {};   // fresco (periodo/regolamento)
    const edz = await api('/tabellone/' + cur + '/edizioni').catch(() => []);
    const giornate = [...new Set(t.gironi.flatMap(g => g.partite.map(p => p.giornata)))].sort((a, b) => a - b);
    const scoreOf = (p) => p.stato === 'giocata' ? `<b>${esc(String(p.gol_a ?? '') + ' – ' + String(p.gol_b ?? ''))}</b>` : '<span class="muted">– : –</span>';
    const faseBlk = (arr, label) => (arr && arr.length) ? `<div style="margin-top:8px"><b class="muted">${esc(label)}</b>${arr.map(p => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0"><span style="flex:1;text-align:right">${esc(p.casa_a)}</span><span style="min-width:64px;text-align:center">${scoreOf(p)}</span><span style="flex:1">${esc(p.casa_b)}</span></div>`).join('')}</div>` : '';
    const fasi = t.fasi || {};
    const finali = t.hasFinale ? `<div class="panel"><h3>Fase finale · Coppa <span class="tag mid">sola lettura · risultati dal Crew</span></h3>
      ${faseBlk(fasi.quarti, 'Quarti (incroci 1-4, 2-3, 3-2, 4-1)')}${faseBlk(fasi.semifinali, 'Semifinali')}${faseBlk(fasi.finale3, 'Finale 3º/4º')}${faseBlk(fasi.finale1, 'Finale 1º/2º')}
      ${t.graduatoria ? `<div style="margin-top:10px"><b class="muted">Graduatoria finale · punti Coppa</b><table><thead><tr><th>Pos</th><th>Casata</th><th>Punti</th></tr></thead><tbody>${t.graduatoria.map(r => `<tr><td>${r.posizione}</td><td><b>${esc(r.nome)}</b></td><td><b>${r.punti}</b></td></tr>`).join('')}</tbody></table></div>` : ''}</div>` : '';
    const statoTag = { preparazione: 'mid', in_corso: 'ok', archiviato: 'no' }[disc.stato] || 'mid';
    const settings = `<div class="panel"><h3>Periodo, stato e regolamento <span class="tag ${statoTag}">${esc(disc.stato || 'preparazione')}</span></h3>
      <div class="grid2">
        <div><label>Inizio periodo</label><input id="tb_di" type="date" value="${esc(disc.data_inizio || '')}"></div>
        <div><label>Fine periodo</label><input id="tb_df" type="date" value="${esc(disc.data_fine || '')}"></div>
        <div><label>Stato</label><select id="tb_stato">${['preparazione', 'in_corso', 'archiviato'].map(s => `<option ${disc.stato === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      </div>
      <label>Regolamento (visibile in app ai soci)</label><textarea id="tb_reg" rows="4" placeholder="Regole del torneo di questa disciplina…">${esc(disc.regolamento || '')}</textarea>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <button class="btn gold sm" id="tb_setSave">Salva impostazioni</button>
        <button class="btn ghost sm" id="tb_archivia">📚 Archivia edizione (Albo d'Oro)</button>
      </div></div>`;
    const albo = edz.length ? `<div class="panel"><h3>Albo d'Oro — edizioni archiviate</h3><table><thead><tr><th>Periodo</th><th>Vincitrice</th><th>Archiviata</th></tr></thead><tbody>
      ${edz.map(e => `<tr><td>${esc((e.data_inizio || '') + (e.data_fine ? ' → ' + e.data_fine : '')) || '—'}</td><td><b>${esc(e.vincitore || '—')}</b></td><td class="muted">${esc(e.archiviata_at || '')}</td></tr>`).join('')}</tbody></table></div>` : '';
    const regs = await api('/regolamenti').catch(() => []);
    const regsPanel = `<div class="panel"><h3>Regolamenti generali (visibili in app)</h3>
      ${regs.map(r => `<div style="margin-bottom:10px"><label>${esc(r.titolo)}</label><textarea id="rg_${esc(r.chiave)}" rows="3">${esc(r.testo || '')}</textarea>
        <button class="btn gold sm" data-rgsave="${esc(r.chiave)}" style="margin-top:6px">Salva</button></div>`).join('') || '<p class="muted">Nessun regolamento.</p>'}</div>`;
    // Riepilogo essenziale: il tabellone vero (gironi, giornate, risultati, foglio gara)
    // vive nel Crew, dove si gioca. Qui basta sapere a che punto e' il torneo.
    const nPartite = t.gironi.reduce((n, g) => n + g.partite.length, 0);
    const nGiocate = t.gironi.reduce((n, g) => n + g.partite.filter(p => p.stato === 'giocata').length, 0);
    // Struttura attesa con 8 casate: due gironi da 4, girone all'italiana = 3 giornate da 2
    // partite, quindi 6 partite per girone. Se i numeri non tornano il calendario e' stato
    // generato da una versione precedente: si rigenera e torna in riga.
    const dettaglio = t.gironi.map(g => {
      const gio = [...new Set(g.partite.map(p => p.giornata))].length;
      const ok = g.classifica.length === 4 && g.partite.length === 6 && gio === 3;
      return { nome: g.nome, casate: g.classifica.length, partite: g.partite.length, giornate: gio, ok };
    });
    const anomalo = dettaglio.some(d => !d.ok) || t.gironi.length !== 2;
    const avviso = anomalo
      ? `<div class="panel" style="border-left:4px solid var(--gold)">
          <b>⚠️ Calendario non standard</b>
          <p class="muted" style="font-size:13px;margin-top:4px">Con 8 casate ci si aspetta <b>2 gironi da 4</b>, cioè <b>3 giornate da 2 partite</b> per girone (6 per girone, 12 in tutto). Qui non è così: ${dettaglio.map(d => `<b>${esc(d.nome)}</b> ${d.casate} casate · ${d.partite} partite · ${d.giornate} giornate`).join(' · ')}.<br>
          Di solito succede quando il calendario è stato generato da una versione precedente: premi <b>“Genera / azzera calendario”</b> per rifarlo con il motore attuale. <i>Attenzione: azzera i risultati di questa disciplina.</i></p></div>`
      : '';
    const avanzamento = t.gironi.length
      ? avviso + `<div class="panel" data-fold="avanzamento"><h3>Avanzamento</h3>
          <div class="row" style="gap:18px;flex-wrap:wrap;align-items:center">
            <div><b style="font-size:1.4rem">${t.gironi.length}</b> <span class="muted">gironi</span></div>
            <div><b style="font-size:1.4rem">${giornate.length}</b> <span class="muted">giornate per girone</span></div>
            <div><b style="font-size:1.4rem">${nGiocate}/${nPartite}</b> <span class="muted">partite giocate</span></div>
            ${t.hasFinale ? '<span class="tag ok">fase finale in corso</span>' : '<span class="tag mid">gironi in corso</span>'}
          </div>
          <table style="margin-top:10px"><thead><tr><th>Girone</th><th>Casate</th><th>Giornate</th><th>Partite</th><th></th></tr></thead><tbody>
            ${dettaglio.map(d => `<tr><td><b>${esc(d.nome)}</b></td><td>${d.casate}</td><td>${d.giornate}</td><td>${d.partite}</td><td>${d.ok ? '<span class="tag ok">regolare</span>' : '<span class="tag no">da rigenerare</span>'}</td></tr>`).join('')}
          </tbody></table>
          <p class="muted" style="font-size:13px;margin-top:8px">Il <b>tabellone</b> — calendario, date delle giornate, risultati e <b>foglio gara da stampare</b> — sta nell'app <b>Bussola Crew · modulo Sport</b>, dove si gioca. Qui il gestore imposta il torneo e lo archivia.</p>
        </div>`
      : '<div class="panel"><p class="muted">Nessun calendario per questa disciplina: premi “Genera”.</p></div>';
    $('#view').innerHTML = `
      <div class="row">
        <select id="tb_disc">${discs.filter(d => d.attivo || d.id == cur).map(d => `<option value="${d.id}" ${d.id == cur ? 'selected' : ''}>${d.dominio} · ${esc(d.nome)}${d.attivo ? '' : ' (disattivata)'}</option>`).join('')}</select>
        ${discs.some(d => !d.attivo) ? `<span class="muted" style="font-size:13px;align-self:center">${discs.filter(d => !d.attivo).length} discipline fuori cartellone non sono elencate — si riattivano da <b>Discipline</b>.</span>` : ''}
        ${can('tabellone_reset') ? '<button class="btn ghost sm" id="tb_gen">↻ Genera / azzera calendario</button>' : ''}
        ${t.completo ? '<span class="tag ok">gironi completi</span>' : ''}
      </div>
      ${settings}
      ${avanzamento}
      ${finali}${albo}${regsPanel}`;
    $('#tb_disc').onchange = (e) => { cur = e.target.value; render(); };
    if ($('#tb_gen')) $('#tb_gen').onclick = async () => { if (!confirm('Rigenerare il calendario AZZERA i risultati di questa disciplina. Procedo?')) return; await api('/tabellone/' + cur + '/genera', { method: 'POST' }); render(); };
    $('#tb_setSave').onclick = async () => { await api('/tabellone/' + cur + '/impostazioni', { method: 'PUT', body: JSON.stringify({ data_inizio: $('#tb_di').value, data_fine: $('#tb_df').value, stato: $('#tb_stato').value, regolamento: $('#tb_reg').value }) }); render(); };
    $('#tb_archivia').onclick = async () => { if (!confirm("Archiviare l'edizione corrente nell'Albo d'Oro e azzerare il calendario di questa disciplina?")) return; try { const r = await api('/tabellone/' + cur + '/archivia', { method: 'POST' }); alert('Edizione archiviata · vince ' + (r.vincitore || '—')); render(); } catch (e) { alert(e.message); } };
    document.querySelectorAll('[data-rgsave]').forEach(b => b.onclick = async () => { const k = b.dataset.rgsave; const r = regs.find(x => x.chiave === k) || {}; await api('/regolamenti/' + k, { method: 'PUT', body: JSON.stringify({ titolo: r.titolo, testo: $('#rg_' + k).value }) }); b.textContent = '✓'; setTimeout(() => b.textContent = 'Salva', 1000); });
    // (inserimento risultati rimosso dal back office: si fa nell'app Bussola Crew · modulo Sport)
  };
  await render();
};

// Foto dei punteggi dei tornei (allegati): evita contestazioni sulla veridicità dei dati.
async function openFotoPartita(id) {
  const list = await api('/allegati?entita=partita&entita_id=' + id).catch(() => []);
  const thumbs = list.length ? list.map(a => `<button class="btn ghost sm" data-afoto="${a.id}">📷 ${esc(a.created_at)}</button>`).join(' ') : '<span class="muted">Nessuna foto allegata.</span>';
  modal(`<h3>Foto referto · partita #${esc(String(id))}</h3>
    <p class="muted" style="font-size:13px">Evidenza dei risultati (sola consultazione). Le foto si <b>scattano dall'app Bussola Crew</b> a bordo campo.</p>
    <div id="af_list" style="display:flex;gap:6px;flex-wrap:wrap">${thumbs}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost sm" id="mCancel">Chiudi</button></div>`);
  $('#mCancel').onclick = closeModal;
  document.querySelectorAll('[data-afoto]').forEach(b => b.onclick = async () => { const r = await api('/allegati/' + b.dataset.afoto + '/foto'); const w = window.open('', '_blank'); if (w) { w.document.write('<img src="' + r.foto + '" style="max-width:100%">'); w.document.close(); } });
}


// ---- Parametri di funzionamento ----
// Le regole che accendono o spengono un comportamento: quello che oggi e' una scelta, domani
// puo' essere un'altra. Le voci figlie compaiono solo quando il loro interruttore e' acceso.
async function caricaParametri() {
  try {
    const list = await api('/parametri');
    PAR = Object.fromEntries(list.map(p => [p.chiave, p.valore]));
    return list;
  } catch (_) { PAR = {}; return []; }
}
VIEWS.parametri = async () => {
  const list = await caricaParametri();
  const gruppi = [...new Set(list.map(p => p.gruppo))];
  const campo = (p) => {
    if (p.tipo === 'bool') return `<label class="check" style="margin:0"><input type="checkbox" class="p_in" data-pk="${esc(p.chiave)}" data-pt="bool" ${p.valore ? 'checked' : ''}> <b>${p.valore ? 'SÌ' : 'NO'}</b></label>`;
    if (p.tipo === 'numero') return `<input class="p_in" data-pk="${esc(p.chiave)}" data-pt="numero" type="number" ${p.min != null ? `min="${p.min}"` : ''} ${p.max != null ? `max="${p.max}"` : ''} value="${esc(String(p.valore ?? p.predefinito))}" style="width:110px">`;
    // Un parametro di TESTO non e' una scelta fra opzioni: senza `opzioni` diventava una
    // tendina vuota, e il gestore non poteva scrivere ne' una data ne' un numero di telefono.
    // Il tipo decide il campo: data, ora, telefono, testo libero.
    if (p.tipo === 'data') return `<input class="p_in" data-pk="${esc(p.chiave)}" data-pt="testo" type="date" value="${esc(p.valore ?? p.predefinito ?? '')}" style="width:100%">`;
    if (p.tipo === 'dataora') return `<input class="p_in" data-pk="${esc(p.chiave)}" data-pt="testo" type="datetime-local" value="${esc(String(p.valore ?? p.predefinito ?? '').replace(' ', 'T').slice(0, 16))}" style="width:100%">`;
    if (p.tipo === 'ora') return `<input class="p_in" data-pk="${esc(p.chiave)}" data-pt="testo" type="time" value="${esc(p.valore ?? p.predefinito ?? '')}" style="width:100%">`;
    if (p.tipo === 'telefono') return `<input class="p_in" data-pk="${esc(p.chiave)}" data-pt="testo" type="tel" inputmode="tel" placeholder="+39 …" value="${esc(p.valore ?? p.predefinito ?? '')}" style="width:100%">`;
    if (p.tipo === 'testo' && !(p.opzioni || []).length) return `<input class="p_in" data-pk="${esc(p.chiave)}" data-pt="testo" type="text" value="${esc(p.valore ?? p.predefinito ?? '')}" style="width:100%">`;
    return `<select class="p_in" data-pk="${esc(p.chiave)}" data-pt="scelta">${(p.opzioni || []).map(o => `<option value="${esc(o.valore)}" ${o.valore === (p.valore ?? p.predefinito) ? 'selected' : ''}>${esc(o.etichetta)}</option>`).join('')}</select>`;
  };
  const blocchi = gruppi.map(g => `<div class="panel"><h3>${esc(g)}</h3>
    ${list.filter(p => p.gruppo === g).map(p => `<div style="display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line);${p.attivo ? '' : 'opacity:.45'}">
      <div style="flex:1">
        <b style="font-size:.95rem">${p.dipende_da ? '↳ ' : ''}${esc(p.etichetta)}</b>
        ${p.personalizzato ? '' : '<span class="tag mid" style="margin-left:6px">predefinito</span>'}
        <div class="muted" style="font-size:.8rem;margin-top:2px">${esc(p.aiuto || '')}${p.attivo ? '' : ' <i>— non applicato: l\'interruttore da cui dipende è spento.</i>'}</div>
      </div>
      <div style="min-width:180px;text-align:right">${campo(p)}</div>
    </div>`).join('')}</div>`).join('');
  $('#view').innerHTML = `<div class="panel"><h3>⚙️ Regole di funzionamento</h3>
      <p class="muted" style="font-size:13px">Tutto ciò che determina una condizione si accende e si spegne da qui, e vale per l'intero residence. Le voci con <b>↳</b> dipendono dall'interruttore sopra di loro: se quello è spento, non vengono applicate.</p>
    </div>${blocchi}
    <div class="row" style="gap:8px;margin-top:4px;align-items:center">
      <button class="btn gold" id="p_save">💾 Salva le regole</button>
      <span class="muted" id="p_msg" style="font-size:13px"></span>
    </div>`;
  $('#p_save').onclick = async () => {
    const body = {};
    document.querySelectorAll('.p_in').forEach(el => {
      const k = el.dataset.pk;
      body[k] = el.dataset.pt === 'bool' ? el.checked : el.dataset.pt === 'numero' ? Number(el.value) : el.value;
    });
    try {
      const r = await api('/parametri', { method: 'PUT', body: JSON.stringify(body) });
      PAR = Object.fromEntries((r.parametri || []).map(p => [p.chiave, p.valore]));
      show('parametri');
      setTimeout(() => { const m = $('#p_msg'); if (m) m.textContent = '✓ Regole salvate.'; }, 60);
    } catch (e) { $('#p_msg').textContent = 'Non salvate: ' + e.message; }
  };
  // le voci figlie si accendono/spengono subito, senza salvare
  document.querySelectorAll('.p_in[data-pt="bool"]').forEach(el => el.onchange = () => {
    const b = el.closest('div').querySelector('b'); if (b) b.textContent = el.checked ? 'SÌ' : 'NO';
  });
};


// ---- Cinema: film, cartellone stampabile, proiezioni, platea ----
// La platea usa lo stesso motore della sala del Garden: posti su una pianta, assegnati dal
// centro verso l'esterno. Cambiano le etichette (posti invece di tavoli, proiezione invece
// di turno), non la logica.
VIEWS.cinema = async () => {
  const [film, proiezioni] = await Promise.all([api('/film'), api('/proiezioni').catch(() => [])]);
  const oggi = new Date().toISOString().slice(0, 10);
  const rows = film.map(f => `<tr>
      <td><b>${esc(f.titolo)}</b>${f.vm ? ` <span class="tag mid">${esc(f.vm)}</span>` : ''}<div class="muted">${esc(f.sinossi || '')}</div></td>
      <td>${esc(f.regia || '—')}</td><td>${f.anno || '—'}</td><td>${f.durata_min ? f.durata_min + "'" : '—'}</td><td>${esc(f.genere || '—')}</td>
      <td>${f.attivo ? '<span class="tag ok">sì</span>' : '<span class="tag">no</span>'}</td>
      <td class="row" style="margin:0"><button class="btn ghost sm" data-fedit="${f.id}">✎</button><button class="btn danger sm" data-fdel="${f.id}">🗑</button></td></tr>`).join('');
  const opts = film.filter(f => f.attivo).map(f => `<option value="${f.id}">${esc(f.titolo)}</option>`).join('');
  const pr = proiezioni.map(p => `<tr>
      <td><b>${esc(p.data)}</b> · ${esc(p.ora)}</td>
      <td>${esc(p.titolo || '—')}</td>
      <td>${p.prenotati}/${p.posti_totali}${p.standard_liberi <= 0 && p.posti_liberi > 0 ? ' <span class="tag mid">solo extra</span>' : ''}</td>
      <td>${p.stato === 'annullata' ? '<span class="tag no">annullata</span>' : '<span class="tag ok">in programma</span>'}</td>
      <td class="row" style="margin:0"><button class="btn ghost sm" data-pplatea="${p.id}">🎟️ Platea</button><button class="btn danger sm" data-pdel="${p.id}">🗑</button></td></tr>`).join('');
  $('#view').innerHTML = `
    <div class="panel" data-fold="film"><h3>🎬 Cartellone film</h3>
      <p class="muted">L'elenco dei film della stagione. Quelli attivi si possono mettere in programmazione qui sotto, e il titolo della proiezione più vicina compare nel cartellone settimanale dell'app.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn gold sm" id="cin_print">🖨️ Stampa cartellone (PDF)</button></div>
      <table class="fit"><thead><tr><th>Film</th><th>Regia</th><th>Anno</th><th>Durata</th><th>Genere</th><th>Attivo</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Nessun film in cartellone.</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:12px"><button class="btn gold sm" id="f_new">+ Aggiungi film</button></div>
    </div>
    <div class="panel" data-fold="proiezioni"><h3>📅 Proiezioni</h3>
      <div class="row">
        <input type="date" id="pr_data" value="${oggi}"><input id="pr_ora" value="21:30" style="width:80px">
        <select id="pr_film">${opts || '<option value="">— nessun film attivo —</option>'}</select>
        <button class="btn gold sm" id="pr_add">+ Programma</button>
      </div>
      <table class="fit"><thead><tr><th>Quando</th><th>Film</th><th>Posti</th><th>Stato</th><th></th></tr></thead><tbody>${pr || '<tr><td colspan="5" class="muted">Nessuna proiezione programmata.</td></tr>'}</tbody></table>
      <p class="muted" style="margin-top:8px">La <b>platea</b> si disegna come la sala del Garden, nell'app Crew: i posti si trascinano e si marcano come <b>standard</b> o <b>extra</b>. I posti extra si aprono solo quando gli standard sono esauriti, e si spengono del tutto da <b>Regole & parametri</b>.</p>
      <div id="pr_out"></div></div>`;

  const editFilm = (f) => {
    modal(`<h3>${f ? 'Modifica film' : 'Nuovo film'}</h3>
      <label>Titolo</label><input id="f_t" value="${esc(f?.titolo || '')}">
      <div class="grid2"><div><label>Regia</label><input id="f_r" value="${esc(f?.regia || '')}"></div>
        <div><label>Anno</label><input id="f_a" type="number" value="${f?.anno || ''}"></div></div>
      <div class="grid2"><div><label>Durata (min)</label><input id="f_d" type="number" value="${f?.durata_min || ''}"></div>
        <div><label>Genere</label><input id="f_g" value="${esc(f?.genere || '')}"></div></div>
      <label>Visione</label><input id="f_v" placeholder="es. per tutti · VM14" value="${esc(f?.vm || '')}">
      <label>Sinossi</label><textarea id="f_s" rows="3">${esc(f?.sinossi || '')}</textarea>
      <label class="check"><input type="checkbox" id="f_on" ${f && !f.attivo ? '' : 'checked'}> in cartellone</label>
      <div class="row" style="margin-top:10px"><button class="btn gold" id="f_save">Salva</button><button class="btn ghost" data-mchiudi>Annulla</button></div>`);
    $('#f_save').onclick = async () => {
      const body = { titolo: $('#f_t').value, regia: $('#f_r').value, anno: $('#f_a').value, durata_min: $('#f_d').value, genere: $('#f_g').value, vm: $('#f_v').value, sinossi: $('#f_s').value, attivo: $('#f_on').checked };
      if (!body.titolo) { alert('Titolo?'); return; }
      await api(f ? '/film/' + f.id : '/film', { method: f ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal(); show('cinema');
    };
  };
  $('#f_new').onclick = () => editFilm(null);
  document.querySelectorAll('[data-fedit]').forEach(b => b.onclick = () => editFilm(film.find(x => x.id == b.dataset.fedit)));
  document.querySelectorAll('[data-fdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Eliminare il film?')) return;
    try { await api('/film/' + b.dataset.fdel, { method: 'DELETE' }); show('cinema'); } catch (e) { alert(e.message); }
  });
  $('#pr_add').onclick = async () => {
    if (!$('#pr_film').value) { alert('Serve almeno un film attivo.'); return; }
    await api('/proiezioni', { method: 'POST', body: JSON.stringify({ data: $('#pr_data').value, ora: $('#pr_ora').value, film_id: Number($('#pr_film').value) }) });
    show('cinema');
  };
  document.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Eliminare la proiezione?')) return;
    try { await api('/proiezioni/' + b.dataset.pdel, { method: 'DELETE' }); show('cinema'); } catch (e) { alert(e.message); }
  });
  document.querySelectorAll('[data-pplatea]').forEach(b => b.onclick = async () => {
    const d = await api('/proiezioni/' + b.dataset.pplatea + '/platea');
    const posto = (t) => `<span title="${t.libero ? 'libero' : esc(t.nome || 'prenotato')}" style="display:inline-block;width:22px;height:22px;margin:2px;border-radius:5px;font-size:10px;line-height:22px;text-align:center;color:#fff;background:${t.libero ? (t.tipo === 'extra' ? '#b08b3e' : '#2e6b45') : '#b14a35'}">${t.numero}</span>`;
    $('#pr_out').innerHTML = `<div class="panel" style="margin-top:12px"><b>🎟️ ${esc(d.proiezione.titolo || '')} · ${esc(d.proiezione.data)} ${esc(d.proiezione.ora)}</b>
      <p class="muted" style="margin:6px 0">${d.coperti_prenotati} prenotati · ${d.standard_liberi} standard liberi · ${d.posti_liberi} liberi in tutto
      &nbsp;<span class="tag ok">standard</span> <span class="tag mid">extra</span> <span class="tag no">occupato</span></p>
      <div>${[...d.tavoli].sort((a, b) => a.numero - b.numero).map(posto).join('')}</div>
      ${d.prenotazioni.length ? `<table class="fit" style="margin-top:10px"><thead><tr><th>Chi</th><th>Persone</th><th>Posti</th></tr></thead><tbody>${d.prenotazioni.map(p => `<tr><td>${esc(p.nome || '—')}</td><td>${p.persone}</td><td>${p.tavoli.join(', ')}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
  });
  $('#cin_print').onclick = () => stampaCartellone(film.filter(f => f.attivo), proiezioni);
};

// Cartellone da appendere o da mandare: A4, i film in scheda, le date sotto.
function stampaCartellone(film, proiezioni) {
  const w = window.open('', '_blank');
  if (!w) { alert('Consenti i popup per stampare.'); return; }
  const quando = (f) => proiezioni.filter(p => p.film_id === f.id && p.stato !== 'annullata').map(p => `${p.data.split('-').reverse().slice(0, 2).join('/')} · ${p.ora}`).join(' — ');
  const scheda = (f) => `<article>
      <h3>${esc(f.titolo)}</h3>
      <div class="meta">${[f.regia ? 'di ' + esc(f.regia) : '', f.anno || '', f.durata_min ? f.durata_min + "'" : '', esc(f.genere || ''), esc(f.vm || '')].filter(Boolean).join(' · ')}</div>
      ${f.sinossi ? `<p>${esc(f.sinossi)}</p>` : ''}
      <div class="data">${quando(f) || 'data da definire'}</div>
    </article>`;
  w.document.write(`<html><head><title>Cinema sotto le stelle — cartellone</title><style>
    @page{size:A4;margin:16mm}
    body{font-family:Georgia,'Times New Roman',serif;color:#12324F;margin:0}
    header{text-align:center;border-bottom:2px solid #E0B44A;padding-bottom:10px;margin-bottom:14px}
    header .k{font-family:Arial,sans-serif;letter-spacing:5px;font-size:.7rem;color:#9a8a5f;text-transform:uppercase}
    header h1{margin:6px 0 0;font-size:1.8rem}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
    article{break-inside:avoid;border-bottom:1px solid #e6ddc7;padding:8px 0}
    article h3{margin:0;font-size:1.05rem}
    .meta{font-family:Arial,sans-serif;font-size:.72rem;color:#5a6b75;margin-top:2px}
    article p{font-size:.8rem;margin:5px 0 0;color:#333}
    .data{font-family:Arial,sans-serif;font-size:.75rem;font-weight:bold;color:#8a5f18;margin-top:5px}
    footer{margin-top:16px;text-align:center;font-family:Arial,sans-serif;font-size:.74rem;color:#777}
  </style></head><body>
    <header><div class="k">Bussola Residence</div><h1>Cinema d'autore sotto le stelle</h1></header>
    <div class="grid">${film.map(scheda).join('')}</div>
    <footer>Proiezioni allo Stage · posto prenotabile dall'app · in caso di maltempo la serata slitta.</footer>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
  </body></html>`);
  w.document.close();
}


// ---- Area fitness: corsi con istruttore, lezioni, iscritti, incassi ----
// Non e' una disciplina della Coppa ne' un campo: ha istruttore, prezzo e un minimo di
// iscritti sotto il quale la lezione non parte. Si paga la singola lezione, in contanti.
const FIT_GIORNI = [[1,'lun'],[2,'mar'],[3,'mer'],[4,'gio'],[5,'ven'],[6,'sab'],[7,'dom']];
let FIT_SETT = null;
// Tavolozza dei corsi: colori distinguibili anche da chi confonde rosso e verde, e sobri
// abbastanza da stare accanto all'oro del residence.
var COLORI_CORSO = ['#2f6d8a', '#7a5c2e', '#2e6b45', '#8a4a6b', '#b08b3e', '#5f5188', '#b14a35', '#3f7d6a'];
VIEWS.fitness = async () => {
  const [corsi, sedute, pub] = await Promise.all([
    api('/fitness/corsi'), api('/fitness/sedute').catch(() => []),
    fetch(API_BASE + '/api/fitness').then(r => r.json()).catch(() => ({}))
  ]);
  const FIT_PAR = { griglia_da: pub.griglia_da || '16:00', griglia_a: pub.griglia_a || '20:00' };
  const eur2 = (v) => '€ ' + Number(v || 0).toFixed(2);
  const righe = corsi.map(c => `<tr>
      <td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${esc(c.colore || '#2f6d8a')};margin-right:7px;vertical-align:middle"></span><b>${esc(c.nome)}</b>${c.masterclass ? ' <span class="tag mid">masterclass</span>' : ''}<div class="muted">${esc(c.descrizione || '')}</div></td>
      <td>${esc(c.istruttore || '—')}</td>
      <td>${esc(c.data_inizio || '—')}<div class="muted">${esc(c.data_fine || '')}</div></td>
      <td>${c.giorni.map(g => (FIT_GIORNI.find(x => x[0] === g) || [0, '?'])[1]).join(' ') || '—'}<div class="muted">${esc(c.ora)} · ${c.durata_min}′</div></td>
      <td>${c.posti_max}<div class="muted">min ${c.min_iscritti}</div></td>
      <td>${eur2(c.prezzo)}${c.masterclass ? `<div class="muted">vip ${eur2(c.prezzo_master)}</div>` : ''}</td>
      <td>${c.lezioni}</td>
      <td>${c.attivo ? '<span class="tag ok">sì</span>' : '<span class="tag">no</span>'}</td>
      <td class="row" style="margin:0"><button class="btn ghost sm" data-cfedit="${c.id}">✎</button><button class="btn danger sm" data-cfdel="${c.id}">🗑</button></td></tr>`).join('');
  // Calendario a griglia: giorni in colonna, ore in riga, e all'incrocio il corso. Un elenco
  // di ottanta lezioni una sotto l'altra non si legge; una griglia si guarda.
  // La griglia ha una fascia FISSA (di norma 16-20, dai parametri): cosi' il calendario ha
  // sempre la stessa forma e le lezioni si collocano, invece di comparire dove capita. Se una
  // lezione cade fuori dalla fascia — lo yoga all'alba — la griglia si allarga da sola.
  const oraNum = (o) => Number(String(o || '').slice(0, 2)) || 0;
  const daPar = oraNum(FIT_PAR.griglia_da || '16:00'), aPar = oraNum(FIT_PAR.griglia_a || '20:00');
  const oreLez = sedute.map(s => oraNum(s.ora));
  const primo = Math.min(daPar, ...(oreLez.length ? oreLez : [daPar]));
  const ultimo = Math.max(aPar, ...(oreLez.length ? oreLez : [aPar]));
  const oreUsate = Array.from({ length: Math.max(1, ultimo - primo + 1) }, (_, i) => String(primo + i).padStart(2, '0') + ':00');
  const settimane = [...new Set(sedute.map(s => {
    const d = new Date(s.data + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }))].sort();
  if (!FIT_SETT || !settimane.includes(FIT_SETT)) FIT_SETT = settimane[0] || null;
  const giorniSett = FIT_SETT ? Array.from({ length: 7 }, (_, i) => new Date(new Date(FIT_SETT + 'T12:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10)) : [];
  const perCella = {};
  for (const s2 of sedute) (perCella[s2.data + '|' + String(s2.ora || '').slice(0, 2) + ':00'] ??= []).push(s2);
  const cella = (giorno, ora) => {
    const list = perCella[giorno + '|' + ora] || [];
    if (!list.length) return '<td></td>';
    return `<td style="padding:3px">${list.map(s2 => {
      // Il COLORE dice la disciplina (si riconosce a colpo d'occhio su 35 caselle), il BORDO
      // dice lo stato: verde confermata, ocra in attesa, rosso al completo.
      const col = s2.colore || '#2f6d8a';
      const bordo = s2.completa ? '#b14a35' : s2.confermata ? '#2e6b45' : '#b08b3e';
      return `<div data-sedit="${s2.id}" title="${esc(s2.corso_nome)} · ${esc(s2.ora)} · ${esc(s2.istruttore || '')}" style="cursor:pointer;background:${col};color:#fff;border-radius:8px;padding:5px 7px;margin-bottom:3px;line-height:1.15;border-left:5px solid ${bordo}">
        <div style="font-weight:800;font-size:.74rem">${esc(s2.titolo || s2.corso_nome)}${s2.masterclass ? ' 🌟' : ''}</div>
        <div style="font-size:.64rem;opacity:.92">${esc(s2.ora)} · ${s2.iscritti}/${s2.posti_max}${s2.minimo && !s2.confermata ? ` · −${s2.mancano}` : ''} · € ${Number(s2.prezzo || 0).toFixed(2)}</div>
      </div>`;
    }).join('')}</td>`;
  };
  const GG = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const griglia = FIT_SETT ? `<table class="fit" style="table-layout:fixed"><thead><tr><th style="width:56px"></th>
      ${giorniSett.map((g, i) => `<th style="text-align:center">${GG[i]}<div class="muted" style="font-weight:400">${g.slice(8)}/${g.slice(5, 7)}</div></th>`).join('')}</tr></thead>
    <tbody>${oreUsate.map(o => `<tr><td style="vertical-align:top;font-weight:700;color:var(--muted);font-size:12px">${esc(o)}</td>${giorniSett.map(g => cella(g, o)).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nessuna lezione in programma.</p>';
  const navSett = settimane.map(w => `<button class="btn ${w === FIT_SETT ? 'gold' : 'ghost'} sm" data-fitsett="${w}">${w.slice(8)}/${w.slice(5, 7)}</button>`).join('');

  $('#view').innerHTML = `
    <div class="panel" data-fold="corsi"><h3>🧘 Corsi</h3>
      <p class="muted">Pilates, yoga, zumba: corsi brevi con istruttore, spesso di una sola settimana. Si paga <b>la singola lezione</b>, in contanti a fine lezione. Sotto il <b>minimo di iscritti</b> la lezione non parte — la regola si spegne da <b>Regole & parametri</b>. La <b>masterclass</b> è una lezione con un nome che tira e un prezzo più alto: si può marcare anche una singola lezione, senza creare un corso apposta.</p>
      <table class="fit"><thead><tr><th>Disciplina</th><th>Istruttore</th><th>Periodo</th><th>Giorni</th><th>Posti</th><th>Prezzo</th><th>Lezioni</th><th>Attivo</th><th></th></tr></thead>
        <tbody>${righe || '<tr><td colspan="9" class="muted">Nessun corso.</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:12px"><button class="btn gold sm" id="cf_new">+ Nuovo corso</button></div></div>
    <div class="panel" data-fold="lezioni"><h3>📆 Calendario delle lezioni</h3>
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <span class="muted" style="font-size:13px">Settimana dal</span>${navSett}
        <span style="flex:1"></span>
        <span class="muted" style="font-size:12px">bordo:</span><span class="tag ok">confermata</span><span class="tag mid">in attesa</span><span class="tag no">al completo</span>
        <span class="muted" style="font-size:12px;margin-left:8px">colore: disciplina</span>
      </div>
      ${griglia}
      <p class="muted" style="font-size:13px;margin-top:8px">Tocca una lezione per cambiarne ora, istruttore, posti, prezzo o per marcarla come masterclass.</p>
      <p class="muted" style="margin-top:8px">Gli iscritti e l'incasso si gestiscono a bordo campo nell'app <b>Bussola Crew · modulo Fitness</b> (permesso “Fitness”).</p></div>`;

  const edit = (c) => {
    modal(`<h3>${c ? 'Modifica corso' : 'Nuovo corso'}</h3>
      <div class="grid2"><div><label>Disciplina</label><input id="cf_n" value="${esc(c?.nome || '')}" placeholder="Pilates, Yoga, Zumba…"></div>
        <div><label>Istruttore</label><input id="cf_i" value="${esc(c?.istruttore || '')}"></div></div>
      <label>Descrizione</label><input id="cf_d" value="${esc(c?.descrizione || '')}">
      <div class="grid2"><div><label>Inizio corso</label><input type="date" id="cf_da" value="${esc(c?.data_inizio || '')}"></div>
        <div><label>Fine corso</label><input type="date" id="cf_a" value="${esc(c?.data_fine || '')}"></div></div>
      <label>Giorni della settimana</label>
      <div class="row">${FIT_GIORNI.map(([n, l]) => `<label class="check" style="margin:0"><input type="checkbox" class="cf_g" value="${n}" ${c && c.giorni.includes(n) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="grid2"><div><label>Ora</label><input id="cf_o" value="${esc(c?.ora || '18:00')}"></div>
        <div><label>Durata lezione (min)</label><input id="cf_du" type="number" value="${c?.durata_min || 60}"></div></div>
      <label>Colore nel calendario</label>
      <div class="row" id="cf_colori" style="gap:8px;flex-wrap:wrap">
        ${COLORI_CORSO.map(col => `<button type="button" class="cfcol" data-col="${col}" style="width:34px;height:34px;border-radius:8px;background:${col};border:3px solid ${(c?.colore || '#2f6d8a') === col ? 'var(--navy)' : 'transparent'};cursor:pointer"></button>`).join('')}
        <input type="hidden" id="cf_col" value="${esc(c?.colore || COLORI_CORSO[0])}">
      </div>
      <p class="muted" style="font-size:.76rem">Serve a distinguere le discipline nel calendario settimanale, dove le caselle sono trentacinque: il colore si riconosce prima del testo.</p>
      <div class="grid2"><div><label>Posti massimi per seduta</label><input id="cf_pm" type="number" value="${c?.posti_max || 20}"></div>
        <div><label>Minimo iscritti</label><input id="cf_mi" type="number" value="${c?.min_iscritti ?? 6}"><div class="muted" style="font-size:.74rem">Con ~400 presenze la media e' 6-7 per lezione.</div></div></div>
      <div class="grid2"><div><label>Prezzo a lezione €</label><input id="cf_pr" type="number" step="0.01" value="${Number(c?.prezzo || 0)}"></div>
        <div><label>Prezzo masterclass €</label><input id="cf_pv" type="number" step="0.01" value="${Number(c?.prezzo_master || 0)}"></div></div>
      <label class="check"><input type="checkbox" id="cf_mc" ${c?.masterclass ? 'checked' : ''}> corso interamente masterclass (usa il prezzo vip)</label>
      <label class="check"><input type="checkbox" id="cf_on" ${c && !c.attivo ? '' : 'checked'}> attivo</label>
      <p class="muted">Salvando, le lezioni nei giorni scelti fra inizio e fine vengono <b>generate da sole</b>. Quelle già create non vengono toccate.</p>
      <div class="row" style="margin-top:10px"><button class="btn gold" id="cf_save">Salva</button><button class="btn ghost" data-mchiudi>Annulla</button></div>`);
    document.querySelectorAll('.cfcol').forEach(b => b.onclick = () => {
      $('#cf_col').value = b.dataset.col;
      document.querySelectorAll('.cfcol').forEach(x => x.style.borderColor = 'transparent');
      b.style.borderColor = 'var(--navy)';
    });
    $('#cf_save').onclick = async () => {
      const body = {
        nome: $('#cf_n').value, istruttore: $('#cf_i').value, descrizione: $('#cf_d').value,
        data_inizio: $('#cf_da').value, data_fine: $('#cf_a').value,
        giorni: [...document.querySelectorAll('.cf_g:checked')].map(x => Number(x.value)),
        ora: $('#cf_o').value, durata_min: Number($('#cf_du').value), posti_max: Number($('#cf_pm').value),
        min_iscritti: Number($('#cf_mi').value), prezzo: Number($('#cf_pr').value),
        prezzo_master: Number($('#cf_pv').value), masterclass: $('#cf_mc').checked, attivo: $('#cf_on').checked,
        colore: ($('#cf_col') || {}).value || null
      };
      if (!body.nome) { alert('Indica la disciplina.'); return; }
      const r = await api(c ? '/fitness/corsi/' + c.id : '/fitness/corsi', { method: c ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal(); show('fitness');
      if (r && r.error) alert(r.error);
    };
  };
  $('#cf_new').onclick = () => edit(null);
  document.querySelectorAll('[data-cfedit]').forEach(b => b.onclick = () => edit(corsi.find(x => x.id == b.dataset.cfedit)));
  document.querySelectorAll('[data-cfdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Eliminare il corso e le sue lezioni?')) return;
    try { await api('/fitness/corsi/' + b.dataset.cfdel, { method: 'DELETE' }); show('fitness'); } catch (e) { alert(e.message); }
  });
  document.querySelectorAll('[data-fitsett]').forEach(b => b.onclick = () => { FIT_SETT = b.dataset.fitsett; show('fitness'); });
  document.querySelectorAll('[data-sedit]').forEach(b => b.onclick = () => {
    const s = sedute.find(x => x.id == b.dataset.sedit);
    modal(`<h3>Lezione del ${esc(s.data)}</h3>
      <div class="grid2"><div><label>Ora</label><input id="se_o" value="${esc(s.ora)}"></div>
        <div><label>Istruttore</label><input id="se_i" value="${esc(s.istruttore || '')}"></div></div>
      <div class="grid2"><div><label>Posti massimi</label><input id="se_p" type="number" value="${s.posti_max}"></div>
        <div><label>Minimo iscritti</label><input id="se_m" type="number" value="${s.min_iscritti}"></div></div>
      <div class="grid2"><div><label>Prezzo €</label><input id="se_pr" type="number" step="0.01" value="${Number(s.prezzo)}"></div>
        <div><label>Titolo (se masterclass)</label><input id="se_t" value="${esc(s.titolo || '')}"></div></div>
      <label class="check"><input type="checkbox" id="se_mc" ${s.masterclass ? 'checked' : ''}> questa lezione è una masterclass</label>
      <div class="row" style="margin-top:10px"><button class="btn gold" id="se_save">Salva</button>
        <button class="btn danger" id="se_ann">Annulla la lezione</button><button class="btn ghost" data-mchiudi>Chiudi</button></div>`);
    const salva = (extra) => api('/fitness/sedute/' + s.id, { method: 'PUT', body: JSON.stringify({ ora: $('#se_o').value, istruttore: $('#se_i').value, posti_max: Number($('#se_p').value), min_iscritti: Number($('#se_m').value), prezzo: Number($('#se_pr').value), masterclass: $('#se_mc').checked, titolo: $('#se_t').value, ...extra }) }).then(() => { closeModal(); show('fitness'); });
    $('#se_save').onclick = () => salva({});
    $('#se_ann').onclick = () => { if (confirm('Annullare questa lezione?')) salva({ stato: 'annullata' }); };
  });
};


// ---- Coworking & sala: la Casa di Carta come spazio, non solo come giochi ----
// Di mattina e' coworking, il pomeriggio si gioca, e ogni tanto serve tutta per una riunione
// o una presentazione: quest'ultimo caso non era previsto da nessuna parte.
VIEWS.sala = async () => {
  const d = await api('/sala');
  const oggi = new Date().toISOString().slice(0, 10);
  const scopoLabel = { riunione: '👥 Riunione', presentazione: '📊 Presentazione', corso: '🎓 Corso', altro: '📌 Altro' };
  const righe = (d.prenotazioni || []).map(p => `<tr>
      <td><b>${esc(p.data)}</b><div class="muted">${esc(p.ora_inizio)}–${esc(p.ora_fine)}</div></td>
      <td>${scopoLabel[p.scopo] || esc(p.scopo)}<div class="muted">${esc(p.titolo || '')}</div></td>
      <td>${esc(p.richiedente || '—')}</td><td>${p.persone}</td>
      <td>${p.esclusiva ? '<span class="tag mid">sala intera</span>' : '<span class="tag">parziale</span>'}</td>
      <td><button class="btn danger sm" data-saladel="${p.id}">🗑</button></td></tr>`).join('');
  const cw = d.coworking || { giorni: [], max: 8 };
  const cell = (u, max) => `<span class="tag ${u >= max ? 'no' : u >= max - 2 ? 'mid' : 'ok'}">${u}/${max}</span>`;
  const cwRows = (cw.giorni || []).map(g => `<tr><td><b>${esc(g.giorno)}</b></td><td>${cell(g.mattina, cw.max)}</td><td>${cell(g.pomeriggio, cw.max)}</td></tr>`).join('');
  $('#view').innerHTML = `
    <div class="panel" data-fold="coworking"><h3>💻 Coworking</h3>
      <p class="muted">Posti occupati per giornata, mattina e pomeriggio (massimo ${cw.max} per fascia). Le postazioni si prenotano dall'app dei soci.</p>
      ${cwRows ? `<table class="fit"><thead><tr><th>Giorno</th><th>Mattina</th><th>Pomeriggio</th></tr></thead><tbody>${cwRows}</tbody></table>` : '<p class="muted">Nessuna prenotazione coworking.</p>'}
    </div>
    <div class="panel" data-fold="sala"><h3>🗓️ Prenotazione della sala</h3>
      <p class="muted">Riunioni, presentazioni, corsi: occupano lo spazio per intero. Una prenotazione <b>esclusiva</b> non si sovrappone né a un'altra riunione né ai tavoli già prenotati per giocare — i turni di gioco sono ${(d.turni_gioco || []).join(' e ')}.</p>
      <div class="row" style="flex-wrap:wrap;align-items:flex-end">
        <div><label>Data</label><input type="date" id="sl_data" value="${oggi}"></div>
        <div><label>Dalle</label><input id="sl_da" value="09:00" style="width:80px"></div>
        <div><label>Alle</label><input id="sl_a" value="11:00" style="width:80px"></div>
        <div><label>Scopo</label><select id="sl_sc">${(d.scopi || []).map(x => `<option value="${x}">${scopoLabel[x] || x}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:160px"><label>Titolo</label><input id="sl_t" placeholder="Assemblea condominiale…"></div>
        <div><label>Richiedente</label><input id="sl_r" style="width:150px"></div>
        <div><label>Persone</label><input id="sl_p" type="number" min="1" value="6" style="width:80px"></div>
        <button class="btn gold sm" id="sl_add">+ Prenota sala</button>
      </div>
      <div id="sl_msg" class="err"></div>
      <table class="fit" style="margin-top:12px"><thead><tr><th>Quando</th><th>Scopo</th><th>Richiedente</th><th>Pers.</th><th>Spazio</th><th></th></tr></thead>
        <tbody>${righe || '<tr><td colspan="6" class="muted">Nessuna sala prenotata.</td></tr>'}</tbody></table>
    </div>`;
  $('#sl_add').onclick = async () => {
    $('#sl_msg').textContent = '';
    try {
      await api('/sala', { method: 'POST', body: JSON.stringify({
        data: $('#sl_data').value, ora_inizio: $('#sl_da').value, ora_fine: $('#sl_a').value,
        scopo: $('#sl_sc').value, titolo: $('#sl_t').value, richiedente: $('#sl_r').value,
        persone: Number($('#sl_p').value) || 1
      }) });
      show('sala');
    } catch (e) { $('#sl_msg').textContent = e.message; }
  };
  document.querySelectorAll('[data-saladel]').forEach(b => b.onclick = async () => {
    if (!confirm('Annullare la prenotazione della sala?')) return;
    await api('/sala/' + b.dataset.saladel, { method: 'DELETE' }); show('sala');
  });
};

// ---- Contest Serata dei Clan ----
function contestForm(c) {
  const tipi = ['cocktail', 'karaoke', 'recitazione', 'sfilata', 'altro'];
  return `<div class="grid2">
      <div><label>Titolo della serata</label><input id="c_tit" value="${esc(c?.titolo || '')}" placeholder="Es. Il mio nome è Bond, James Bond"></div>
      <div><label>Tipo</label><select id="c_tipo">${tipi.map(t => `<option ${c?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label>Settimana</label><input id="c_sett" value="${esc(c?.settimana || '')}" placeholder="Es. 25–31 agosto"></div>
      <div><label>Stato</label><select id="c_stato">${['annunciato', 'in_corso', 'concluso'].map(s => `<option ${c?.stato === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>
    <label>Consegna (testo libero) + supporti a disposizione</label>
    <textarea id="c_brief" rows="5" placeholder="Descrivi la sfida e gli eventuali supporti (bar, karaoke, palco…)">${esc(c?.brief || '')}</textarea>
    ${c ? `<label>Vincitore (a fine settimana)</label><input id="c_vin" value="${esc(c.vincitore || '')}" placeholder="Casata vincitrice">
    <label class="check"><input type="checkbox" id="c_att" ${c.attivo ? 'checked' : ''}> Attivo (mostrato nell'app)</label>` : ''}`;
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
  $('#view').innerHTML = `
    <div class="panel"><h3>Nuovo contest (lo lancia il CdA la settimana prima)</h3>${contestForm(null)}
      <div class="err" id="c_err"></div>
      <button class="btn gold sm" id="c_add" style="margin-top:10px">Lancia il contest</button></div>
    <div class="panel"><h3>Contest</h3><table><thead><tr><th>Settimana</th><th>Titolo</th><th>Tipo</th><th>Stato</th><th>Attivo</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td>${esc(c.settimana || '')}</td><td><b>${esc(c.titolo)}</b>${c.vincitore ? `<br><span class="tag ok">🏆 ${esc(c.vincitore)}</span>` : ''}</td><td>${esc(c.tipo || '')}</td><td>${esc(c.stato)}${c.esito_assegnato ? ' <span class="tag ok">punti versati</span>' : ''}</td><td>${c.attivo ? '<span class="tag ok">sì</span>' : '<span class="tag no">no</span>'}</td><td style="white-space:nowrap"><button class="btn gold sm" data-cesito="${c.id}">🏅 Esito</button> <button class="btn ghost sm" data-cedit="${c.id}">✎</button> <button class="btn danger sm" data-cdel="${c.id}">🗑</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nessun contest.</td></tr>'}
    </tbody></table>
    <p class="muted" style="margin-top:8px;font-size:13px">🏅 <b>Esito</b>: la giuria stila la graduatoria (punti per posizione) e si aggiunge il bonus vendite <b>4/2/1</b> alle prime tre casate per pezzi venduti. Poi “Assegna alla Coppa” versa i punti (una volta sola).</p></div>`;
  $('#c_add').onclick = async () => {
    try { await api('/contest', { method: 'POST', body: JSON.stringify(contestBody($('#view'), false)) }); show('contest'); }
    catch (e) { $('#c_err').textContent = e.message; }
  };
  document.querySelectorAll('[data-cedit]').forEach(b => b.onclick = () => {
    const c = list.find(x => x.id == b.dataset.cedit);
    modal(`<h3>Modifica contest</h3>${contestForm(c)}<div class="err" id="c_merr"></div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>`);
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => {
      try { await api('/contest/' + c.id, { method: 'PUT', body: JSON.stringify(contestBody($('#modalBox'), true)) }); closeModal(); show('contest'); }
      catch (e) { $('#c_merr').textContent = e.message; }
    };
  });
  document.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => { if (!confirm('Eliminare il contest?')) return; await api('/contest/' + b.dataset.cdel, { method: 'DELETE' }); show('contest'); });
  document.querySelectorAll('[data-cesito]').forEach(b => b.onclick = () => openEsito(b.dataset.cesito));
};

// Esito/voto della Serata dei Clan: posizione di giuria + pezzi venduti → punti → Coppa.
async function openEsito(id) {
  const e = await api('/contest/' + id + '/esito');
  const scalaTxt = (e.scala || []).join(', ');
  const rows = e.righe.map(r => `<tr>
      <td><span class="sh" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${esc(r.colore || '#ccc')};vertical-align:middle"></span> ${esc(r.casata)}</td>
      <td><input id="pos_${r.casata_id}" type="number" min="1" max="8" value="${r.posizione ?? ''}" style="width:60px;text-align:center" ${e.assegnato ? 'disabled' : ''}></td>
      <td><input id="pez_${r.casata_id}" type="number" min="0" value="${r.pezzi_venduti ?? 0}" style="width:80px;text-align:center" ${e.assegnato ? 'disabled' : ''}></td>
      <td style="text-align:center"><b id="pt_${r.casata_id}">${r.punti || 0}</b></td>
    </tr>`).join('');
  modal(`<h3>Esito — ${esc(e.contest.titolo)}</h3>
    <p class="muted" style="font-size:13px;margin-bottom:8px">Assegna la <b>posizione</b> di giuria (1 = primo) e i <b>pezzi venduti</b> per casata. I punti = punti della posizione + bonus vendite (4/2/1 alle prime 3 per pezzi).</p>
    <label>Punti per posizione (1°,2°,3°,…) — modificabili</label>
    <input id="e_scala" value="${esc(scalaTxt)}" ${e.assegnato ? 'disabled' : ''} placeholder="10, 6, 4, 3, 2, 1, 1, 1">
    <table style="margin-top:10px"><thead><tr><th>Casata</th><th>Pos. giuria</th><th>Pezzi venduti</th><th>Punti</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="err" id="e_err"></div>
    ${e.assegnato ? `<div class="tag ok" style="margin-top:10px">✅ Punti già versati in Coppa · vince ${esc(e.contest.vincitore || '—')}</div>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button class="btn ghost sm" id="mCancel">Chiudi</button>
      ${e.assegnato ? '' : `<button class="btn ghost sm" id="e_calc">Calcola e salva</button>
      <button class="btn gold sm" id="e_assegna">Assegna alla Coppa</button>`}
    </div>`);
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
    if (!confirm('Assegnare i punti alla Coppa? L’operazione è definitiva.')) return;
    try { await api('/contest/' + id + '/esito', { method: 'POST', body: JSON.stringify(raccogli()) });
      const r = await api('/contest/' + id + '/assegna', { method: 'POST' });
      closeModal(); show('contest'); alert(`Assegnati ${r.totale} punti · vince ${r.vincitore || '—'}`);
    } catch (err) { $('#e_err').textContent = err.message; }
  };
}

// ---- Serate & cena ----
function serataForm(s) {
  return `<div class="grid2">
      <div><label>Titolo</label><input id="s_tit" value="${esc(s?.titolo || '')}" placeholder="Es. Cena di Ferragosto"></div>
      <div><label>Quando (etichetta)</label><input id="s_quando" value="${esc(s?.quando || '')}" placeholder="Es. Sab 15 agosto · 20:00"></div>
      <div><label>Data</label><input id="s_data" type="date" value="${esc(s?.data || '')}"></div>
      <div><label>Tema</label><input id="s_tema" value="${esc(s?.tema || '')}" placeholder="Es. Gran serata"></div>
      <div><label>Quota € a persona</label><input id="s_quota" type="number" min="0" step="0.5" value="${esc(String(s?.quota ?? 0))}"></div>
      <div><label>Capienza (coperti)</label><input id="s_cap" type="number" min="1" value="${esc(String(s?.capienza ?? 80))}"></div>
    </div>
    <label>Descrizione</label><textarea id="s_desc" rows="3">${esc(s?.descrizione || '')}</textarea>
    ${s ? `<label class="check"><input type="checkbox" id="s_att" ${s.attivo ? 'checked' : ''}> Attiva (mostrata nell'app)</label>` : ''}`;
}
// Legge i campi DENTRO il contenitore indicato (evita la collisione di ID fra il form
// "Nuova serata" sempre presente e il form della finestra di modifica → prima causava l'azzeramento).
function serataBody(root = document) {
  const q = (id) => root.querySelector(id);
  return { titolo: q('#s_tit').value, quando: q('#s_quando').value, data: q('#s_data').value, tema: q('#s_tema').value,
    descrizione: q('#s_desc').value, quota: Number(q('#s_quota').value) || 0, capienza: Number(q('#s_cap').value) || 80,
    attivo: q('#s_att') ? q('#s_att').checked : true };
}
VIEWS.serate = async () => {
  const list = await api('/serate');
  $('#view').innerHTML = `
    <div class="panel"><h3>Nuova serata a prenotazione</h3>${serataForm(null)}
      <div class="err" id="s_err"></div>
      <button class="btn gold sm" id="s_add" style="margin-top:10px">Crea serata</button></div>
    <div class="panel"><h3>Serate (turni cena 20:00 e 21:30 · pagamento in cassa)</h3>
      <table><thead><tr><th>Quando</th><th>Titolo</th><th>Quota</th><th>Prenotati</th><th>Da incassare</th><th>Attiva</th><th></th></tr></thead><tbody>
      ${list.map(s => `<tr><td>${esc(s.quando || s.data || '')}</td><td><b>${esc(s.titolo)}</b>${s.tema ? `<br><span class="muted">${esc(s.tema)}</span>` : ''}</td>
        <td>€ ${esc(String(s.quota))}</td><td>${s.coperti_prenotati}/${s.capienza}</td><td>€ ${esc(String(s.da_incassare || 0))}</td>
        <td>${s.attivo ? '<span class="tag ok">sì</span>' : '<span class="tag no">no</span>'}</td>
        <td style="white-space:nowrap"><button class="btn gold sm" data-spren="${s.id}">👥 Prenotati</button> <button class="btn ghost sm" data-sedit="${s.id}">✎</button> <button class="btn danger sm" data-sdel="${s.id}">🗑</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nessuna serata.</td></tr>'}
    </tbody></table></div>`;
  $('#s_add').onclick = async () => {
    try { await api('/serate', { method: 'POST', body: JSON.stringify(serataBody($('#view'))) }); show('serate'); }
    catch (e) { $('#s_err').textContent = e.message; }
  };
  document.querySelectorAll('[data-fitsett]').forEach(b => b.onclick = () => { FIT_SETT = b.dataset.fitsett; show('fitness'); });
  document.querySelectorAll('[data-sedit]').forEach(b => b.onclick = () => {
    const s = list.find(x => x.id == b.dataset.sedit);
    modal(`<h3>Modifica serata</h3>${serataForm(s)}<div class="err" id="s_merr"></div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Annulla</button><button class="btn gold sm" id="mSave">Salva</button></div>`);
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
  modal(`<h3>Prenotati — ${esc(s?.titolo || 'Serata')}</h3>
    <table><thead><tr><th>Nome</th><th>Pers.</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td>${esc(p.nome || '')}<br><span class="muted">${esc(p.tessera_code || '')}</span></td><td>${p.persone}</td><td>€ ${esc(String(p.importo))}</td><td>${badge(p.stato)}</td>
      <td style="white-space:nowrap">${p.stato !== 'saldata' ? `<button class="btn gold sm" data-pset="${p.id}|saldata">Segna saldata</button>` : ''} ${p.stato !== 'annullata' ? `<button class="btn ghost sm" data-pset="${p.id}|annullata">Annulla</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessuna prenotazione.</td></tr>'}
    </tbody></table>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="mCancel">Chiudi</button></div>`);
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
  $('#view').innerHTML = `<div class="panel"><h3>Registro attività (accountability GDPR)</h3><table><thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Entità</th><th>Dettaglio</th></tr></thead><tbody>
    ${list.map(a => `<tr><td class="muted">${esc(a.ts)}</td><td>${esc(a.utente)}</td><td><b>${esc(a.azione)}</b></td><td>${esc(a.entita)} ${esc(a.entita_id||'')}</td><td class="muted">${esc(a.dettaglio||'')}</td></tr>`).join('')}
  </tbody></table></div>`;
};

// ---- Modal helpers ----
// Rende comprimibili i pannelli marcati con data-fold, ricordando cosa era chiuso.
function abilitaFold() {
  const chiave = 'bussola_fold_' + (window.__view || '');
  let chiusi = [];
  try { chiusi = JSON.parse(localStorage.getItem(chiave) || '[]'); } catch (e) { }
  // Ogni pannello con un titolo e' comprimibile: non serve marcarlo a mano.
  // Il titolo non e' sempre figlio diretto del pannello: dove c'e' un tasto accanto sta dentro
  // una riga, e quei pannelli smettevano di comprimersi senza che si capisse perche'.
  document.querySelectorAll('#view .panel').forEach((box) => {
    const h = box.querySelector(':scope > h3, :scope > .row > h3, :scope > div > h3');
    if (!h) return;
    let testa = h;
    while (testa.parentElement !== box) testa = testa.parentElement;
    testa.classList.add('fold-testa');
    if (!box.dataset.fold) box.dataset.fold = (h.textContent || '').trim().slice(0, 30).replace(/\s+/g, '_');
  });
  const pannelli = [...document.querySelectorAll('#view .panel[data-fold]')];
  pannelli.forEach((p) => {
    const nome = p.dataset.fold;
    if (chiusi.includes(nome)) p.classList.add('chiuso');
    const h = p.querySelector('h3');
    if (!h) return;
    h.style.cursor = 'pointer';
    h.onclick = () => {
      p.classList.toggle('chiuso');
      const ora = pannelli.filter((x) => x.classList.contains('chiuso')).map((x) => x.dataset.fold);
      try { localStorage.setItem(chiave, JSON.stringify(ora)); } catch (e) { }
    };
  });
  if (pannelli.length > 1 && !document.querySelector('.foldbar')) {
    const bar = document.createElement('div');
    bar.className = 'foldbar';
    bar.innerHTML = '<button class="btn ghost sm" id="fold_tutti">Comprimi tutto</button><button class="btn ghost sm" id="fold_apri">Espandi tutto</button>';
    $('#view').prepend(bar);
    $('#fold_tutti').onclick = () => { pannelli.forEach((p) => p.classList.add('chiuso')); try { localStorage.setItem(chiave, JSON.stringify(pannelli.map((x) => x.dataset.fold))); } catch (e) { } };
    $('#fold_apri').onclick = () => { pannelli.forEach((p) => p.classList.remove('chiuso')); try { localStorage.setItem(chiave, '[]'); } catch (e) { } };
  }
}
function modal(html) {
  $('#modalBox').innerHTML = html;
  $('#modal').classList.add('show');
  // Chiusura dichiarativa: basta marcare un bottone con data-mchiudi.
  $('#modalBox').querySelectorAll('[data-mchiudi]').forEach((b) => b.onclick = closeModal);
}
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

// Mostra la versione REALMENTE online (dal server), così sappiamo cosa è pubblicato
(async () => {
  try {
    const h = await fetch(API_BASE + '/api/health').then(r => r.json());
    $('#verline').textContent = h.version ? `versione online: v${h.version}${h.build && h.build !== 'online' ? ' · ' + h.build : ''}` : 'versione online: sconosciuta (build vecchia — da aggiornare)';
  } catch { $('#verline').textContent = 'server non raggiungibile'; }
})();


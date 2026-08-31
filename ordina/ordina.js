const qs = new URLSearchParams(location.search);
const PUNTO = qs.get('p') || 'Chiosco';
const TAVOLO = qs.get('t') || '';
document.getElementById('punto').textContent = '🍔 ' + PUNTO + (TAVOLO ? ' · Tavolo ' + TAVOLO : '');
const eur = n => '€ ' + (Number(n) || 0).toFixed(2);
let COM = null;

function etaLabel(m) { m = Number(m || 0); return m <= 0 ? '' : (m < 60 ? `~${m} min` : `~${Math.round(m / 60 * 10) / 10} h`); }
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
  // Prima controllo se si può ordinare adesso (chiuso manuale o cucina sotto pressione) e con che attesa.
  let stato = { aperto: true, ordinabile: true, sospeso_pressione: false, eta_min: 0 };
  try { stato = await (await fetch('/api/self-order/stato')).json(); } catch (e) {}
  if (!stato.ordinabile) {
    document.getElementById('menu').innerHTML = '';
    const msg = stato.sospeso_pressione
      ? '🔥 <b>Cucina molto impegnata</b><br>Gli ordini dal telefono sono sospesi per pochi minuti. Rivolgiti allo staff al bancone o riprova a breve.'
      : '⏸️ <b>Ordini sospesi</b><br>In questo momento gli ordini dal telefono non sono attivi. Rivolgiti allo staff al bancone.';
    setBanner(msg, 'closed');
    const s = document.getElementById('send'); if (s) s.style.display = 'none';
    const t = document.getElementById('tot'); if (t) t.textContent = '';
    return;
  }
  const eta = etaLabel(stato.eta_min);
  // Se il QR è quello generico del menù (senza tavolo), chiediamo il numero del tavolo.
  if (!TAVOLO) {
    let tb = document.getElementById('so_tav_box');
    if (!tb) { tb = document.createElement('div'); tb.id = 'so_tav_box'; const m = document.getElementById('menu'); m.parentNode.insertBefore(tb, m); }
    tb.style.cssText = 'border-radius:12px;padding:12px 14px;margin:0 0 12px;background:#fff6e0;border:1px solid #e7cf8a;color:#7a5c00;font-size:.95rem';
    tb.innerHTML = '🍽️ <b>A che tavolo sei?</b><br><input id="so_tav" type="number" min="1" inputmode="numeric" placeholder="Numero del tavolo" style="margin-top:8px;padding:9px 11px;border:1.5px solid #cbd2d8;border-radius:10px;font-size:1rem;width:180px">';
  }
  if (eta) setBanner('⏱️ Attesa stimata al momento: <b>' + eta + '</b>', 'eta');
  let menu;
  // Il punto da cui si ordina lo dice il QR: senza, la pagina mostrava tutto il listino, Bar
  // compreso, anche a un tavolo del Garden.
  const zonaQR = /bar/i.test(PUNTO || '') ? 'bar' : 'garden';
  try { menu = await (await fetch('/api/menu?zona=' + zonaQR)).json(); }
  catch (e) { document.getElementById('menu').innerHTML = '<p class="muted">Menù non disponibile.</p>'; return; }
  // Step 0/1: carico il menù e lo rendo con il componente condiviso (stessa vista dello staff).
  COM = Comanda.create({
    mount: document.getElementById('menu'), menu, search: true,
    onChange: (cart, tot, n) => {
      document.getElementById('tot').textContent = n ? `${n} prodotti · ${eur(tot)}` : 'Tocca i prodotti per ordinare';
      document.getElementById('send').disabled = !n;
    }
  });
}
document.getElementById('send').onclick = async () => {
  const righe = COM ? COM.getRighe() : [];
  if (!righe.length) return;
  const tavInput = document.getElementById('so_tav');
  const tavolo = TAVOLO || (tavInput ? tavInput.value.trim() : '');
  if (!tavolo) { alert('Indica il numero del tavolo per inviare l’ordine.'); if (tavInput) tavInput.focus(); return; }
  document.getElementById('send').disabled = true;
  let r;
  try { r = await (await fetch('/api/self-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ punto: PUNTO, tavolo, righe }) })).json(); }
  catch (e) { alert('Invio non riuscito, riprova.'); document.getElementById('send').disabled = false; return; }
  if (!r.ok) { alert(r.error || 'Ordini momentaneamente non disponibili.'); document.getElementById('send').disabled = false; return; }
  document.getElementById('okn').textContent = '#' + r.numero;
  const eta = etaLabel(r.eta_min);
  document.getElementById('okinfo').textContent = (r.punto || PUNTO) + (r.tavolo ? ' · Tavolo ' + r.tavolo : '') + ' · ' + eur(r.totale) + ' — si paga in cassa.' + (eta ? ' Pronto tra ' + eta + '.' : '');
  document.getElementById('ok').classList.add('show');
};
document.getElementById('reload').onclick = () => location.reload();
load();


/* Componente COMANDA condiviso — una sola presentazione del menù per ogni contesto.
 * Step 0: chi lo usa carica il menù (da qualunque fonte) e lo passa qui.
 * Step 1: il menù viene raggruppato in modo logico e omogeneo (per categoria) e reso IDENTICO
 *         per lo staff (chiosco), per il cliente al tavolo (/ordina) e nell'app soci.
 * Indipendente e riusabile: nessuna dipendenza esterna, CSS auto-iniettato una volta.
 *
 * API:  const c = Comanda.create({ mount, menu, search=true, onChange(cart,total,count) })
 *       c.getRighe() -> [{menu_id, qta}]   c.total()   c.count()   c.clear()   c.setMenu(menu)   c.focusSearch()
 */
window.Comanda = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function eur(n) { return '€ ' + (Number(n) || 0).toFixed(2); }
  function norm(s) { return (s == null ? '' : String(s)).toLowerCase(); }

  // Auto-categorie: se l'articolo non ha `categoria` valorizzata, la deduciamo dal NOME
  // così la comanda si raggruppa in modo logico (Caffetteria, Bibite, Birre…) come nel menù stampato,
  // senza dover categorizzare a mano tutto il listino. Una `categoria` esplicita vince sempre.
  const CAT_RULES = [
    ['Caffetteria', /caff[eè]|cappucc|macchiat|marocchin|\blatte\b|orzo|ginseng|cioccolat|espress|ristrett|decaffe|shakerat|tisana|camomill|t[eè]\s*cald/i],
    ['Bibite', /acqua|coca|\bcola\b|fanta|sprite|aranciat|chinotto|gassosa|gazzosa|\btonic|spremut|succ|t[eè]\s*fredd|th[eè]|estath|energy|red\s*bull|redbull|gatorade|powerade|bibit|cedrat|lemonsoda|oransoda|schweppes/i],
    ['Birre', /birr|\bbeer\b|\bipa\b|lager|weiss|weizen|\bpils|stout|moretti|heineken|peroni|ichnusa|\bcorona\b|ceres|nastro\s*azzurro/i],
    ['Aperitivi & Cocktail', /spritz|aperol|campari|negroni|american|mojito|cocktail|\bgin\b|vodka|\brum\b|tequila|whisk|bacardi|\bmartini\b|aperitiv|bitter|crodino|analcolic|\blimoncell/i],
    ['Vini', /\bvin[oi]\b|calice|prosecc|spumant|franciacort|moscato|chardonnay|merlot|bollicin|champagne|champagn/i],
    ['Gelati', /gelat|ghiacciol|magnum|sorbett|granit|\bstecco\b|coppett/i],
    ['Snack', /patatin|\bchips\b|tarall|nachos|pop\s*corn|popcorn|arachid|\bolive\b|salatin|cracker|pretzel|\bsnack\b/i],
    ['Panini & Piatti', /panin|toast|piadin|hamburger|hot\s*dog|hotdog|pizz|focacc|tramezzin|\bwrap\b|insalat|\bpasta\b|sandwich|bruschett|tagliere|\bfritt|arancin/i],
    ['Dolci', /cornetto|brioch|croissant|\bdolc|\btorta\b|crostat|muffin|biscott|tiramis|budino|crep|cr[eê]pe|waffle|nutella|pancake/i],
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
    st.textContent = `
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
      .cmd-item{background:#fff;border:1.5px solid var(--c-line);border-radius:12px;padding:6px 10px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .cmd-item.sel{border-color:var(--c-gold,#8a5f18);background:#fdfaf3}
      .cmd-tap{flex:1;display:flex;align-items:center;gap:10px;background:none;border:0;padding:8px 2px;text-align:left;cursor:pointer;min-height:44px;font:inherit;color:inherit}
      .cmd-ico{font-size:1.5rem;line-height:1;flex:0 0 auto}
      .cmd-info{flex:1;min-width:0}
      .cmd-info b{display:block;color:var(--c-navy)}
      .cmd-desc{font-size:.78rem;color:#555;display:block}

      .cmd-pz{color:var(--c-gold);font-weight:800;white-space:nowrap;font-size:.92rem}
      .cmd-step{display:flex;gap:6px;align-items:center}
      .cmd-b{border:1.5px solid var(--c-line);background:#fff;border-radius:9px;width:34px;height:34px;font-size:1.15rem;font-weight:800;color:var(--c-navy);line-height:1}
      .cmd-b.add{background:var(--c-gold);color:#fff;border-color:var(--c-gold)}
      /* "Esaurito" sta accanto al piu', ma smorzato: e' un gesto che si fa una volta ogni
         tanto e non deve competere con quello che si fa cento volte a sera. */
      .cmd-b.out{background:#fff;color:#9E2B20;border-color:#9E2B20;font-size:.9rem;opacity:.75}
      .cmd-b.out:hover{opacity:1}
      .cmd-n{min-width:20px;text-align:center;font-weight:800;color:var(--c-navy)}
      .cmd-empty{color:#777;padding:10px 2px;font-size:.9rem}
      .cmd-more{width:100%;background:none;border:0;color:var(--c-navy);font-size:.76rem;font-weight:700;text-decoration:underline;padding:4px 0 2px;cursor:pointer;text-align:left}
      .cmd-comp{width:100%;border-top:1px dashed var(--c-line);margin-top:6px;padding-top:6px}
      .cmd-comp[hidden]{display:none}
      .cmd-comp label{display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:.86rem;color:var(--c-navy);min-height:36px;cursor:pointer}
      .cmd-comp input{width:20px;height:20px;flex:0 0 auto}
      .cmd-comp .cmd-suppl{font-size:.76rem;color:#6b6257;padding:2px 2px 6px;font-weight:700}
      .cmd-badge{font-size:.72rem;color:#6b6257;display:block;margin-top:2px}`;
    document.head.appendChild(st);
  }

  function create(opts) {
    injectCss();
    const mount = opts.mount;
    let menu = opts.menu || [];
    const useSearch = opts.search !== false;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    const cart = {};
    const comp = {};   // menu_id -> [id complementi spuntati]
    let selCat = '';

    mount.classList.add('cmd');
    mount.innerHTML = (useSearch
      ? `<div class="cmd-tools"><input class="cmd-q" placeholder="🔍 Cerca prodotto…" autocomplete="off"><button class="cmd-qx" title="Pulisci">✕</button></div><div class="cmd-chips"></div>`
      : '') + `<div class="cmd-list"></div>`;

    const $ = (sel) => mount.querySelector(sel);
    const listEl = $('.cmd-list');
    const qEl = useSearch ? $('.cmd-q') : null;
    const chipsEl = useSearch ? $('.cmd-chips') : null;

    function cats() { return sortCats([...new Set((menu || []).map(catOf))]); }
    function total() {
      let t = 0;
      Object.keys(cart).forEach(id => {
        const m = menu.find(x => String(x.id) === id); if (!m) return;
        t += Number(m.prezzo) * cart[id];
        // Il supplemento e' del piatto: si paga una volta, che i condimenti siano uno o quattro.
        if ((comp[id] || []).length) t += supplDi(m) * cart[id];
      });
      return t;
    }
    function count() { let n = 0; Object.keys(cart).forEach(id => n += cart[id]); return n; }
    function fire() { onChange(cart, total(), count()); }

    // Un'icona per capire al volo di che si tratta, ricavata da categoria e nome.
    function iconaDi(m) {
      const t = ((m.categoria || '') + ' ' + (m.nome || '')).toLowerCase();
      if (/caff|espress|cappucc/.test(t)) return '\u2615';
      if (/birr/.test(t)) return '\ud83c\udf7a';
      if (/vino|calice|spritz|cocktail|amar|gin|apero/.test(t)) return '\ud83c\udf78';
      if (/acqua|bibit|cola|succo|analcol/.test(t)) return '\ud83e\udd64';
      if (/gelat|sorbet/.test(t)) return '\ud83c\udf68';
      if (/dolc|torta|brioch|cornett/.test(t)) return '\ud83c\udf70';
      if (/panin|toast|sandwich|hamburg/.test(t)) return '\ud83e\udd6a';
      if (/pizz|focacc/.test(t)) return '\ud83c\udf55';
      if (/past|primo|spaghett/.test(t)) return '\ud83c\udf5d';
      if (/pesce|frutti di mare|cozz/.test(t)) return '\ud83d\udc1f';
      if (/carne|grigl|secondo/.test(t)) return '\ud83c\udf56';
      if (/insalat|verdur|contorn/.test(t)) return '\ud83e\udd57';
      if (/patat|frit|snack|arancin/.test(t)) return '\ud83c\udf5f';
      return '\ud83c\udf7d\ufe0f';
    }
    // Il "di cui" del piatto: le aggiunte si spuntano, non si contano. Nessuno ordina
    // "tre maionesi": o la vuoi o non la vuoi, e se prendi due panini la vogliono entrambi.
    function compDi(m) { return Array.isArray(m.complementi) ? m.complementi : []; }
    function scelti(id) { return comp[id] || (comp[id] = []); }
    function supplDi(m) { return Number(m.supplemento_complementi) || 0; }
    function compHTML(m) {
      const list = compDi(m);
      if (!list.length) return '';
      const sel = scelti(m.id);
      const s = supplDi(m);
      const righe = list.map(c => `<label><input type="checkbox" data-ccomp="${m.id}|${c.id}"${sel.includes(Number(c.id)) ? ' checked' : ''}><span>${esc(c.nome)}</span></label>`).join('');
      const nota = s > 0
        ? `<div class="cmd-suppl">${eur(s)} in tutto, quanti che ne scegli</div>`
        : `<div class="cmd-suppl">Senza supplemento</div>`;
      return `<button class="cmd-more" data-cmore="${m.id}">condimenti ▾</button>
        <div class="cmd-comp" data-cbox="${m.id}" hidden>${nota}${righe}</div>`;
    }
    function labelScelti(m) {
      const sel = scelti(m.id); if (!sel.length) return '';
      const nomi = compDi(m).filter(c => sel.includes(Number(c.id))).map(c => c.nome);
      return nomi.length ? '+ ' + nomi.join(', ') : '';
    }
    function itemHTML(m) {
      const q = cart[m.id] || 0;
      // Icona e descrizione sono CLICCABILI e aggiungono: su un telefono il bersaglio non
      // puo' essere solo il "+" da 34 px. Gli allergeni non compaiono: sono nel menu', e a
      // bordo campo allungano la riga senza servire a chi batte la comanda.
      return `<div class="cmd-item${q ? ' sel' : ''}"><button class="cmd-tap" data-cadd="${m.id}" aria-label="Aggiungi ${esc(m.nome)}">
          <span class="cmd-ico">${esc(iconaDi(m))}</span>
          <span class="cmd-info"><b>${esc(m.nome)}</b>${m.descrizione ? `<span class="cmd-desc">${esc(m.descrizione)}</span>` : ''}<span class="cmd-badge" data-cbadge="${m.id}">${esc(labelScelti(m))}</span></span>
        </button>
        <span class="cmd-pz">${eur(m.prezzo)}</span>
        <div class="cmd-step"><button class="cmd-b" data-cdec="${m.id}">−</button><b class="cmd-n" data-cn="${m.id}">${q}</b><button class="cmd-b add" data-cadd="${m.id}">+</button></div>
        ${compHTML(m)}</div>`;
    }
    function renderChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = ['', ...cats()].map(c => `<button class="cmd-chip${c === selCat ? ' on' : ''}" data-ccat="${esc(c)}">${c === '' ? 'Tutti' : esc(c)}</button>`).join('');
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
      // Ogni categoria è un blocco che NON si spezza tra le colonne: su schermi larghi (cassa/tablet)
      // il menù si dispone su più colonne e l'operatore non deve scorrere per cercare l'articolo.
      listEl.innerHTML = keys.length
        ? keys.map(cat => `<div class="cmd-group"><div class="cmd-cat">${esc(cat)}</div>${g[cat].map(itemHTML).join('')}</div>`).join('')
        : `<p class="cmd-empty">Nessun prodotto${q ? ' per “' + esc(q) + '”' : ''}.</p>`;
    }
    function setN(id) { const el = mount.querySelector('[data-cn="' + id + '"]'); if (el) el.textContent = cart[id] || 0; }
    function chg(id, d) {
      const m = menu.find(x => String(x.id) === String(id)); if (!m) return;
      cart[id] = (cart[id] || 0) + d; if (cart[id] <= 0) delete cart[id];
      setN(id); fire();
    }

    // Delegazione: un solo listener per tutto il componente.
    mount.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-cadd],[data-cdec],[data-ccat],[data-cmore]'); if (!a) return;
      if (a.dataset.cmore != null) {
        const box = mount.querySelector('[data-cbox="' + a.dataset.cmore + '"]');
        if (box) { box.hidden = !box.hidden; a.textContent = box.hidden ? 'condimenti ▾' : 'condimenti ▴'; }
        return;
      }
      if (a.dataset.cadd != null) return chg(a.dataset.cadd, 1);
      if (a.dataset.cdec != null) return chg(a.dataset.cdec, -1);
      if (a.dataset.ccat != null) { selCat = a.dataset.ccat; renderChips(); renderList(); }
    });
    // Spuntare un complemento su un piatto che non hai ancora scelto significa volerlo: si
    // aggiunge il piatto. Altrimenti la maionese resterebbe spuntata su niente.
    mount.addEventListener('change', (ev) => {
      const el = ev.target.closest('[data-ccomp]'); if (!el) return;
      const [mid, cid] = el.dataset.ccomp.split('|');
      const sel = scelti(mid); const n = Number(cid);
      const i = sel.indexOf(n);
      if (el.checked && i < 0) sel.push(n); else if (!el.checked && i >= 0) sel.splice(i, 1);
      const m = menu.find(x => String(x.id) === String(mid));
      const badge = mount.querySelector('[data-cbadge="' + mid + '"]');
      if (badge && m) badge.textContent = labelScelti(m);
      if (el.checked && !cart[mid]) return chg(mid, 1);
      fire();
    });
    if (qEl) qEl.addEventListener('input', renderList);
    if (useSearch) { const x = $('.cmd-qx'); if (x) x.addEventListener('click', () => { if (qEl) { qEl.value = ''; qEl.focus(); } renderList(); }); }

    renderChips(); renderList(); fire();

    return {
      getRighe() { return Object.keys(cart).map(id => ({ menu_id: Number(id), qta: cart[id], complementi: (comp[id] || []).slice() })); },
      total, count,
      clear() { Object.keys(cart).forEach(k => delete cart[k]); Object.keys(comp).forEach(k => delete comp[k]); selCat = ''; renderChips(); renderList(); fire(); },
      setMenu(m) { menu = m || []; Object.keys(cart).forEach(k => delete cart[k]); Object.keys(comp).forEach(k => delete comp[k]); selCat = ''; renderChips(); renderList(); fire(); },
      focusSearch() { if (qEl) qEl.focus(); },
    };
  }

  // Esposti perché PDF stampabile e comanda usino LO STESSO raggruppamento/ordine (nessuno "scalino").
  return { create, group, esc, eur, catOf, inferCat, sortCats };
})();


// Gli aiutanti condivisi: se un front-end ne chiama uno che non ha, si rompe in silenzio.
//
// È l'errore che è costato di più. Nell'app dei soci il totale dell'ordine chiamava `eur(...)`,
// che nell'app non esisteva: il browser sollevava l'eccezione dentro il gestore dell'evento,
// nessuno la vedeva, e per chi ordinava l'effetto era che il totale restava vuoto, il
// supplemento dei condimenti non compariva e "Invia ordine" non si accendeva mai. Dal server
// risultava tutto corretto — ed è il motivo per cui l'abbiamo cercato per giorni dalla parte
// sbagliata.
//
// I test sulle API non possono vederlo: girano sul server, il difetto sta nel browser. Qui si
// controllano i nomi che i tre front-end si passano fra loro e che è facile dare per scontati:
// se uno li usa, deve averli.
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// Le funzioncine di servizio che ricorrono ovunque. Non è l'elenco di tutto il codice: è
// l'elenco di quello che si scrive a memoria dando per scontato che ci sia.
const AIUTANTI = [
  "eur", "esc", "T", "api", "show", "showOv", "closeOv", "setSheet", "okThen",
  "openModal", "closeModal", "hhmmOf", "chipOf", "minorenne"
];

// Ogni front-end deve definire da sé quello che usa. Le funzioni dentro shared/comanda.js NON
// contano: vivono in uno scope chiuso e dall'esterno si vede solo `Comanda`. Dare per buone le
// sue funzioni era lo stesso errore concettuale del difetto che questo test deve prendere.
const FRONTEND = [
  ["app dei soci", "../public/app.js"],
  ["Crew", "../chiosco/chiosco.js"],
  ["pagina QR", "../ordina/ordina.js"]
];

function definisce(src, nome) {
  return new RegExp(
    "(?:function\\s+" + nome + "\\s*\\(" +
    "|(?:const|let|var)\\s+" + nome + "\\s*=" +
    "|\\b" + nome + "\\s*\\([^)]*\\)\\s*\\{)"
  ).test(src);
}
// Chiamate vere: `nome(` non preceduto da un punto (che sarebbe un metodo di un oggetto).
function chiama(src, nome) {
  return new RegExp("(^|[^\\w$.])" + nome + "\\s*\\(", "m").test(src);
}

for (const [etichetta, file] of FRONTEND) {
  test(etichetta + ": ha tutti gli aiutanti che usa", () => {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const mancanti = AIUTANTI.filter((n) => chiama(src, n) && !definisce(src, n));
    assert.deepEqual(mancanti, [],
      "\n" + etichetta + " (" + file + ") chiama " + mancanti.map((x) => x + "()").join(", ") + " ma non lo definisce.\n" +
      "Nel browser non si vede nessun errore: il pezzo di schermata smette semplicemente di funzionare.\n");
  });
}

// La prova che il controllo serve davvero: sul sorgente di ieri, che chiamava eur() senza
// averlo, questo test sarebbe stato rosso.
test("il controllo si accorge di un aiutante mancante", () => {
  const finto = "function f(){ const t = document.querySelector('#x'); t.textContent = eur(3); }";
  assert.ok(chiama(finto, "eur"), "la chiamata si riconosce");
  assert.ok(!definisce(finto, "eur"), "e l'assenza della definizione pure");
});

// ---- Un handler agganciato al vuoto svuota la schermata ---------------------------------
// La tab Menù del Crew mostrava soltanto "Errore: Cannot set properties of null (setting
// 'onclick')": avevo scritto l'handler di un tasto che poi non veniva disegnato. In JavaScript
// quell'errore interrompe tutta la funzione, quindi non è che manca un pulsante — è che non
// compare NIENTE. Qui si controlla che ogni `$('#tizio').onclick = ...` abbia un `id="tizio"`
// da qualche parte nello stesso file.
test("Crew: ogni onclick punta a un elemento che viene disegnato", () => {
  const src = readFileSync(new URL("../chiosco/chiosco.js", import.meta.url), "utf8");
  const html = src + readFileSync(new URL("../chiosco/index.html", import.meta.url), "utf8");
  const orfani = [];
  for (const m of src.matchAll(/\$\('#([A-Za-z_][\w-]*)'\)\s*\.\s*onclick\s*=/g)) {
    const id = m[1];
    // Con la guardia `if ($('#x'))` davanti, l'assenza è già gestita.
    const prima = src.slice(Math.max(0, m.index - 40), m.index);
    if (prima.includes("if ($('#" + id + "'))")) continue;
    if (!new RegExp('id="' + id + '"').test(html) && !new RegExp("id='" + id + "'").test(html)) orfani.push(id);
  }
  assert.deepEqual(orfani, [],
    "\nQuesti tasti hanno un handler ma non vengono mai disegnati: " + orfani.join(", ") +
    "\nNel browser l'errore blocca tutta la funzione e la schermata resta vuota.\n");
});

// ---- Un tasto che non fa niente è peggio di un tasto che manca ---------------------------
// Nel listino era rimasto un "Salva" per riga di cui avevo tolto l'handler: chi lo premeva
// vedeva accendersi il pulsante e non succedeva nulla — e credeva di aver salvato.
test("Crew: nessun tasto senza qualcosa che lo ascolti", () => {
  const src = readFileSync(new URL("../chiosco/chiosco.js", import.meta.url), "utf8");
  const morti = [];
  // Attributi `data-x="..."` usati su un <button>: da qualche parte deve esserci un
  // querySelectorAll('[data-x]') o un closest('[data-x]') che li raccolga.
  for (const m of src.matchAll(/<button[^>]*\sdata-([a-z][\w-]*)=/g)) {
    const attr = m[1];
    const usato = src.includes("[data-" + attr + "]");
    if (!usato && !morti.includes(attr)) morti.push(attr);
  }
  assert.deepEqual(morti, [],
    "\nQuesti tasti non hanno nessuno che li ascolti: " + morti.join(", ") +
    "\nChi li preme crede di aver fatto qualcosa e invece non succede niente.\n");
});


// ---- Variabili usate e mai dichiarate ---------------------------------------------------
// `const passate = (fasce || [])...` dove `fasce` non esisteva: l'eccezione arrivava DOPO
// aver disegnato le fasce orarie e PRIMA di agganciare i tasti, quindi la schermata sembrava a
// posto ma non si poteva prenotare niente. E' l'errore piu' insidioso di tutti, perche' non si
// vede: nessun messaggio, nessuna riga rossa, solo tasti che non ci sono.
//
// Qui si controllano i nomi che compaiono in `(nome || [])` e simili: se non sono dichiarati
// da nessuna parte nel file, e' quel difetto.
test("app dei soci: nessuna variabile usata senza esistere", () => {
  const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const dichiarate = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) dichiarate.add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const par of m[1].split(",")) {
      const n = par.trim().replace(/[=:].*$/, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) dichiarate.add(n);
    }
  }
  for (const m of src.matchAll(/\bfor\s*\((?:const|let|var)\s+(?:\[([^\]]*)\]|([A-Za-z_$][\w$]*))/g)) {
    for (const n of (m[1] || m[2] || "").split(",")) {
      const v = n.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(v)) dichiarate.add(v);
    }
  }
  const orfane = [];
  // Il modo di dire "questa cosa potrebbe non esserci": se il nome non e' dichiarato, non
  // potrebbe — non esiste proprio, e il ramo con `|| []` non salva nessuno.
  for (const m of src.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\|\|\s*(?:\[\]|\{\})\s*\)/g)) {
    const nome = m[1];
    if (!dichiarate.has(nome) && !orfane.includes(nome)) orfane.push(nome);
  }
  assert.deepEqual(orfane, [],
    "\nQueste variabili vengono usate ma non esistono: " + orfane.join(", ") +
    "\nNel browser l'eccezione blocca la funzione a meta': la schermata si vede, i tasti non funzionano.\n");
});

// ---- I dati della guida seguono la lingua dell'app --------------------------------------
// Le voci della guida — servizi, rifiuti, luoghi — sono DATI del database, non testi dell'app:
// il dizionario dell'interfaccia non li vede. Per questo il titolo "Waste collection" era
// tradotto e sotto restava "Lun · Organico".
test("il vocabolario dei dati copre tutte le lingue dell'app", () => {
  const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const blocco = src.slice(src.indexOf("const TERMINI = {"));
  const lingue = ["en", "fr", "de", "es"];
  const chiaviPer = {};
  for (const l of lingue) {
    const i = blocco.indexOf(`\n  ${l}: {`);
    assert.ok(i > 0, `manca la lingua ${l} nel vocabolario dei dati`);
    const fine = blocco.indexOf("\n  }", i);
    // Si parte DOPO l'intestazione della lingua, altrimenti "en:" finisce fra i termini.
    const corpo = blocco.slice(blocco.indexOf("{", i) + 1, fine);
    chiaviPer[l] = [...corpo.matchAll(/(?:^|,)\s*'?([^':,\n{}]+?)'?\s*:/g)].map((m) => m[1].trim());
  }
  // Una lingua a cui manca un termine mostrerebbe quella riga in italiano in mezzo alle altre
  // tradotte: peggio che non tradurre niente, perché sembra un errore di dati.
  const base = new Set(chiaviPer.en);
  for (const l of lingue.slice(1)) {
    const mancanti = [...base].filter((k) => !chiaviPer[l].includes(k));
    assert.deepEqual(mancanti, [], `alla lingua ${l} mancano: ${mancanti.join(', ')}`);
  }
  // E i termini che compaiono nei dati iniziali devono esserci tutti.
  const seed = readFileSync(new URL("../server/seed.js", import.meta.url), "utf8");
  for (const parola of ['Farmacia', 'Guardia medica', 'Spiaggia', 'Organico', 'Indifferenziato']) {
    if (!seed.includes(parola)) continue;
    assert.ok(base.has(parola), `"${parola}" è nei dati iniziali ma non nel vocabolario: resterebbe in italiano`);
  }
});

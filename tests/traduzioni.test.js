// Il dizionario non puo' piu' restare indietro rispetto all'app.
//
// A un certo punto due stringhe su cinque non erano tradotte in nessuna delle quattro lingue,
// e fra queste c'era la barra di navigazione: Home, Settimana, Guida, Cena, Chiama. Un ospite
// che sceglieva il tedesco si trovava un'app mezza italiana, e la meta' rimasta in italiano
// era proprio quella che serve per muoversi. Meglio non offrire una lingua che offrirla cosi'.
//
// Non e' successo per cattiva volonta': le traduzioni si aggiungono a blocchi, poi arriva una
// funzione nuova con venti stringhe e nessuno torna indietro a completarle. Questo test rende
// la dimenticanza impossibile: chi aggiunge una `T('...')` senza traduzione vede la suite
// diventare rossa, con l'elenco di cosa manca e in quale lingua.
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const LINGUE = ["en", "fr", "de", "es"];
const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

// Tutte le stringhe che l'app passa al traduttore.
function chiaviUsate() {
  const out = new Set();
  for (const m of src.matchAll(/\bT\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
    out.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return out;
}

// I due dizionari dell'app, uniti come li unisce l'app stessa a runtime.
function dizionari() {
  const iUI = src.indexOf("const UI = {");
  const UI = JSON.parse(src.slice(src.indexOf("{", iUI), src.indexOf("};", iUI) + 1));
  const iEx = src.indexOf("const UI_EXTRA = {");
  const EX = JSON.parse(src.slice(src.indexOf("{", iEx), src.lastIndexOf("}", src.indexOf("\n", iEx)) + 1));
  const out = {};
  for (const l of LINGUE) out[l] = Object.assign({}, UI[l] || {}, EX[l] || {});
  return out;
}

test("ogni stringa dell'app ha una traduzione in tutte le lingue offerte", () => {
  const chiavi = chiaviUsate();
  const dz = dizionari();
  assert.ok(chiavi.size > 400, "il conteggio delle stringhe non deve rompersi in silenzio");
  const guasti = [];
  for (const l of LINGUE) {
    const mancano = [...chiavi].filter((k) => dz[l][k] == null);
    if (mancano.length) {
      guasti.push(`${l}: mancano ${mancano.length} traduzioni → ` + mancano.slice(0, 8).map((k) => JSON.stringify(k)).join(", ") + (mancano.length > 8 ? " …" : ""));
    }
  }
  assert.deepEqual(guasti, [], "\n" + guasti.join("\n") +
    "\n\nHai aggiunto testo nuovo all'app: aggiungilo anche a UI_EXTRA in public/app.js, in tutte e quattro le lingue.\n");
});

test("nessuna traduzione vuota: una stringa vuota nasconde il testo invece di tradurlo", () => {
  const dz = dizionari();
  for (const l of LINGUE) {
    const vuote = Object.entries(dz[l]).filter(([, v]) => typeof v !== "string" || !v.trim()).map(([k]) => k);
    assert.deepEqual(vuote, [], `${l}: traduzioni vuote per ${vuote.join(", ")}`);
  }
});

test("il dizionario non porta voci morte: testo tradotto che nell'app non esiste piu'", () => {
  const chiavi = chiaviUsate();
  const dz = dizionari();
  // Non e' un errore grave, ma un dizionario che cresce di zavorra e' un dizionario che
  // nessuno rilegge piu': meglio accorgersene subito.
  for (const l of LINGUE) {
    const morte = Object.keys(dz[l]).filter((k) => !chiavi.has(k));
    assert.deepEqual(morte, [], `${l}: ${morte.length} voci non piu' usate dall'app → ` + morte.slice(0, 8).join(", "));
  }
});

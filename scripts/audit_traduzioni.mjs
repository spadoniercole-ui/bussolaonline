// Quante stringhe passano dal traduttore, e quante hanno davvero una traduzione.
import { readFileSync } from 'node:fs';
const src = readFileSync('public/app.js', 'utf8');
// tutte le chiamate T('...') / T("...")
const chiavi = new Set();
for (const m of src.matchAll(/\bT\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) chiavi.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
console.log('stringhe passate a T():', chiavi.size);

// dizionari: si estraggono valutando gli oggetti UI e UI_EXTRA
const iUI = src.indexOf('const UI = {');
const fineUI = src.indexOf('};', iUI) + 1;
const iEx = src.indexOf('const UI_EXTRA = {');
const rigaEx = src.slice(iEx, src.indexOf('\n', iEx));
const UI = eval('(' + src.slice(iUI + 'const UI = '.length, fineUI) + ')');
const UI_EXTRA = JSON.parse(rigaEx.slice(rigaEx.indexOf('{'), rigaEx.lastIndexOf('}') + 1));
for (const l of ['en', 'fr', 'de', 'es']) UI[l] = Object.assign(UI[l] || {}, UI_EXTRA[l] || {});

for (const l of ['en', 'fr', 'de', 'es']) {
  const d = UI[l] || {};
  const mancanti = [...chiavi].filter(k => d[k] == null);
  console.log(`${l}: tradotte ${chiavi.size - mancanti.length}/${chiavi.size} · mancano ${mancanti.length}`);
}
// chiavi nel dizionario che non sono piu' usate da nessuna parte
const inutili = Object.keys(UI.en || {}).filter(k => !chiavi.has(k));
console.log('voci nel dizionario EN non piu\u2019 usate:', inutili.length);
const mancEn = [...chiavi].filter(k => (UI.en || {})[k] == null);
if (process.env.ELENCO) { console.log('---MANCANTI---'); for (const k of mancEn) console.log(JSON.stringify(k)); }
if (process.env.MORTE) { console.log('---MORTE---'); for (const k of inutili) console.log(JSON.stringify(k)); }

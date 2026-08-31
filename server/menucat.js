// Chi lo prepara si capisce da cosa e': un panino, un piatto, un'insalata, una frittura
// passano dalla piastra o dalla friggitrice; un caffe' e una birra si danno al banco. Il
// gestore non deve segnalarlo voce per voce — un listino di duecento righe non si marca a
// mano, e infatti nessuno lo fa. Se la deduzione sbaglia su una voce, si corregge dalla
// colonna "Chi prepara": la scelta esplicita resta l'ultima parola.
function inferStazione(nome, categoria) {
  const s = String(nome || "") + " " + String(categoria || "");
  return STAZIONE_CUCINA_RX.test(s) ? "cucina" : "bar";
}
function inferCategoria(nome) {
  const s = String(nome == null ? "" : nome);
  for (const [name, rx] of CAT_RULES) {
    if (rx.test(s)) return name;
  }
  return null;
}
function inferPunto(nome, categoria) {
  const s = String(nome || "") + " " + String(categoria || "");
  return PUNTO_GARDEN_RX.test(s) ? "garden" : "bar";
}
function categoriaArticolo({ categoria, nome, stazione } = {}) {
  const esplicita = categoria && String(categoria).trim();
  return esplicita || inferCategoria(nome) || (stazione === "cucina" ? "Cucina" : "Bar");
}
function ordinaCategorie(arr) {
  const rank = (c) => {
    if (c === "Bar") return 900;
    if (c === "Cucina") return 901;
    const i = CATEGORIE_ORDINE.indexOf(c);
    return i < 0 ? 500 : i;
  };
  return arr.slice().sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}
var CAT_RULES, CATEGORIE_ORDINE, PUNTO_GARDEN_RX, STAZIONE_CUCINA_RX;
CAT_RULES = [
  ["Caffetteria", /caff[eè]|cappucc|macchiat|marocchin|\blatte\b|orzo|ginseng|cioccolat|espress|ristrett|decaffe|shakerat|tisana|camomill|t[eè]\s*cald/i],
  ["Bibite", /acqua|coca|\bcola\b|fanta|sprite|aranciat|chinotto|gassosa|gazzosa|\btonic|spremut|succ|t[eè]\s*fredd|th[eè]|estath|energy|red\s*bull|redbull|gatorade|powerade|bibit|cedrat|lemonsoda|oransoda|schweppes/i],
  ["Birre", /birr|\bbeer\b|\bipa\b|lager|weiss|weizen|\bpils|stout|moretti|heineken|peroni|ichnusa|\bcorona\b|ceres|nastro\s*azzurro/i],
  ["Aperitivi & Cocktail", /spritz|aperol|campari|negroni|american|mojito|cocktail|\bgin\b|vodka|\brum\b|tequila|whisk|bacardi|\bmartini\b|aperitiv|bitter|crodino|analcolic|\blimoncell/i],
  ["Vini", /\bvin[oi]\b|calice|prosecc|spumant|franciacort|moscato|chardonnay|merlot|bollicin|champagn/i],
  ["Gelati", /gelat|ghiacciol|magnum|sorbett|granit|\bstecco\b|coppett/i],
  ["Snack", /patatin|\bchips\b|tarall|nachos|pop\s*corn|popcorn|arachid|\bolive\b|salatin|cracker|pretzel|\bsnack\b/i],
  ["Panini & Piatti", /panin|toast|piadin|hamburger|hot\s*dog|hotdog|pizz|focacc|tramezzin|\bwrap\b|insalat|\bpasta\b|sandwich|bruschett|tagliere|\bfritt|arancin/i],
  ["Dolci", /cornetto|brioch|croissant|\bdolc|\btorta\b|crostat|muffin|biscott|tiramis|budino|crep|cr[eê]pe|waffle|nutella|pancake/i]
];
CATEGORIE_ORDINE = CAT_RULES.map((r) => r[0]).concat(["Bar", "Cucina"]);
PUNTO_GARDEN_RX = /panin|toast|piadin|hamburger|cheeseburger|hot\s*dog|hotdog|pizz|focacc|tramezzin|\bwrap\b|insalat|\bpasta\b|bruschett|tagliere|\bfritt|arancin|panell|crocch|wurstel|petto\s*di\s*pollo|cotolett|\bpiatt|contorn|combo|bambini|salsicc|melanzan|\bkebab\b/i;

// Tutto cio' che va cucinato, assemblato o fritto. I condimenti stanno qui perche' sono
// ingredienti del piatto: li mette la stessa mano che fa il panino.
STAZIONE_CUCINA_RX = /panin|toast|piadin|hamburger|cheeseburger|hot\s*dog|hotdog|pizz|focacc|tramezzin|\bwrap\b|insalat|\bpasta\b|bruschett|tagliere|\bfritt|arancin|panell|crocch|wurstel|cotolett|\bpiatt|contorn|combo|salsicc|melanzan|\bkebab\b|caprese|cous\s*cous|\briso\b|verdur|grigliat|\bcarne\b|\bpollo\b|tagliat|straccett|condiment|\bprimi\b|\bsecondi\b|\bfettina\b|\bcosciotto\b|\bpetto\b|\bpatatine\s*fritte\b|\bhot\b/i;

export { CATEGORIE_ORDINE, categoriaArticolo, inferCategoria, inferPunto, inferStazione, ordinaCategorie };

// Le regole della cucina, in un posto solo.
//
// Due decisioni del gestore, prese una volta e valide ovunque si ordini — app dei soci, QR al
// tavolo, comanda battuta dalla Crew:
//
// 1) QUELLO CHE PREPARA LA CUCINA SI ORDINA DA TUTTI I PUNTI. Un panino lo fa la cucina, ma
//    chi e' al bar alle sei di pomeriggio deve poterlo chiedere. Per tre versioni questo e'
//    dipeso da come i prodotti erano marcati nel listino, e bastava un dato storto perche' il
//    panino sparisse dal Bar. Non e' piu' un dato: e' una regola. Solo cio' che esce dal banco
//    (bibite, caffe', alcolici) resta legato al punto in cui si vende.
//
// 2) NESSUNO SI SENTE DIRE DI NO PER L'ORARIO. Prima dell'apertura della cucina l'ordine si
//    prende lo stesso: si avvisa soltanto che la consegna non puo' essere immediata, perche'
//    piastra e friggitrice devono andare in temperatura. L'ora del primo ritiro e' apertura +
//    minuti di riscaldamento.
import { par } from './parametri.js';

// NB: chi si ordina dove, e quali condimenti si spuntano in cosa, NON stanno piu' qui: sono
// nel nucleo del menu' (server/menu.js). Erano duplicati in due file, ed e' il modo piu'
// sicuro per farli divergere. Qui resta solo l'orario: da che ora la cucina consegna.

function hhmm(ore, minuti) {
  const h = Math.floor(ore + Math.floor(minuti / 60));
  const m = minuti % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// L'ora prima della quale una comanda di cucina non si consegna. `null` se non c'e' nulla da
// aspettare: o non c'e' cucina nell'ordine, o la cucina e' gia' aperta da un pezzo.
async function primoRitiro(haCucina, adesso = new Date()) {
  if (!haCucina) return null;
  const apertura = Number(await par("cucina_apertura_ora"));
  const riscaldo = Number(await par("cucina_riscaldamento_minuti"));
  if (!Number.isFinite(apertura)) return null;
  const pronta = hhmm(apertura, Number.isFinite(riscaldo) ? riscaldo : 0);
  const oraOra = adesso.getHours() * 60 + adesso.getMinutes();
  const oraPronta = apertura * 60 + (Number.isFinite(riscaldo) ? riscaldo : 0);
  // Dopo l'ora del primo ritiro non si avvisa piu' nessuno: la piastra e' calda.
  return oraOra >= oraPronta ? null : pronta;
}

function avvisoRitiro(nonPrima) {
  if (!nonPrima) return null;
  return `Ordine preso. La cucina consegna dalle ${nonPrima}: piastra e friggitrice devono scaldarsi.`;
}

export { avvisoRitiro, primoRitiro };

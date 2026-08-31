import { db, getSetting, setSetting } from './db.js';

var STAFF_BOOST_MS = 3 * 60 * 1e3;
var STARVE_MS = 10 * 60 * 1e3;
var ETA_MAX_MIN = 45;
var RATE_WINDOW_MIN = 20;
// Chi ha gia' pagato passa avanti. Non e' "chi paga mangia prima": e' che quell'ordine e' gia'
// chiuso, non richiede una seconda visita al tavolo, non occupa la cassa nel momento di punta —
// ha alleggerito il lavoro della crew, e questo si riconosce. Il vantaggio e' misurato (pochi
// minuti), non assoluto: chi aspetta da troppo passa comunque avanti per la regola sotto.
var PAGATA_BOOST_MS = 4 * 60 * 1e3;

function tsEffettivo(c, nowMs) {
  const base = Date.parse(c.created_at || "") || 0;
  let eff = base - (c.canale === "staff" ? STAFF_BOOST_MS : 0);
  if (c.pagata_at || (c.metodo_pagamento && c.stato !== "annullata")) eff -= PAGATA_BOOST_MS;
  if (c.canale !== "staff") {
    const wait = nowMs - base;
    if (wait > STARVE_MS) eff -= wait - STARVE_MS;
  }
  return eff;
}
function ordinaCoda(rows) {
  const now = Date.now();
  return rows.slice().sort((a, b) => tsEffettivo(a, now) - tsEffettivo(b, now) || a.id - b.id);
}
async function getConfig() {
  const g = async (k, d) => await getSetting(k, d);
  return {
    aperto: await g("self_order_aperto", "1") !== "0",
    // interruttore manuale (master)
    eta_modo: await g("so_eta_modo", "statico"),
    // statico | tempo
    eta_base: Number(await g("so_eta_base", "3")) || 3,
    // minuti base (modalità statica)
    eta_per_item: Number(await g("so_eta_per_item", "2")) || 2,
    // minuti per articolo (modalità statica)
    press_modo: await g("so_press_modo", "statico"),
    // statico | tempo
    press_max_comande: Number(await g("so_press_max_comande", "6")) || 6,
    // soglia (modalità statica): comande da smaltire
    press_max_minuti: Number(await g("so_press_max_minuti", "10")) || 10,
    // soglia (modalità tempo): attesa massima ammessa
    press_auto: await g("so_press_auto", "0") === "1",
    // se on: sotto pressione sospende in automatico; se off: solo avviso
    // Mappa tavoli (Bussola Garden): numero di tavoli e soglie di colore (minuti di attesa) per box.
    garden_tavoli: Math.max(1, Number(await g("garden_tavoli", "12")) || 12),
    map_giallo_min: Number(await g("map_giallo_min", "5")) || 5,
    // oltre → giallo
    map_rosso_min: Number(await g("map_rosso_min", "10")) || 10
    // oltre → rosso
  };
}
async function setConfig(patch) {
  const map = {
    eta_modo: "so_eta_modo",
    eta_base: "so_eta_base",
    eta_per_item: "so_eta_per_item",
    press_modo: "so_press_modo",
    press_max_comande: "so_press_max_comande",
    press_max_minuti: "so_press_max_minuti",
    press_auto: "so_press_auto",
    garden_tavoli: "garden_tavoli",
    map_giallo_min: "map_giallo_min",
    map_rosso_min: "map_rosso_min"
  };
  for (const [k, key] of Object.entries(map)) {
    if (patch[k] === void 0) continue;
    let v = patch[k];
    if (k === "press_auto") v = v ? "1" : "0";
    await setSetting(key, String(v));
  }
}
async function pendingItems() {
  const r = await db.prepare("SELECT COALESCE(SUM(cr.qta),0) n FROM comanda_righe cr JOIN comande c ON c.id=cr.comanda_id WHERE c.stato IN ('aperta','in_preparazione') AND cr.stato='in_coda'").get();
  return Number(r.n || 0);
}
async function activeOrders() {
  const r = await db.prepare("SELECT COUNT(*) n FROM comande WHERE stato IN ('aperta','in_preparazione')").get();
  return Number(r.n || 0);
}
async function serviceRatePerMin() {
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60 * 1e3).toISOString();
  const r = await db.prepare("SELECT COALESCE(SUM(cr.qta),0) n FROM comanda_righe cr JOIN comande c ON c.id=cr.comanda_id WHERE c.pronta_at IS NOT NULL AND c.pronta_at >= ?").get(since);
  const done = Number(r.n || 0);
  return done > 0 ? done / RATE_WINDOW_MIN : 0;
}
async function etaMin(cfg) {
  cfg = cfg || await getConfig();
  const pending = await pendingItems();
  if (cfg.eta_modo === "tempo") {
    const rate = await serviceRatePerMin();
    if (rate > 0) return Math.max(1, Math.min(ETA_MAX_MIN, Math.ceil(pending / rate)));
  }
  return Math.min(ETA_MAX_MIN, cfg.eta_base + pending * cfg.eta_per_item);
}
async function pressione(cfg) {
  cfg = cfg || await getConfig();
  if (cfg.press_modo === "tempo") return await etaMin(cfg) > cfg.press_max_minuti;
  return await activeOrders() >= cfg.press_max_comande;
}
async function statoCompleto() {
  const cfg = await getConfig();
  const eta = await etaMin(cfg);
  const press = await pressione(cfg);
  const attive = await activeOrders();
  const sospeso_pressione = cfg.aperto && cfg.press_auto && press;
  const ordinabile = cfg.aperto && !sospeso_pressione;
  return {
    aperto: cfg.aperto,
    ordinabile,
    sospeso_pressione,
    pressione: press,
    eta_min: eta,
    attive,
    config: cfg
  };
}
async function setSelfOrderAperto(v) {
  await setSetting("self_order_aperto", v ? "1" : "0");
}

export { etaMin, getConfig, ordinaCoda, pressione, setConfig, setSelfOrderAperto, statoCompleto };

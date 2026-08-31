// LA TESSERA COME PREPAGATA.
//
// Due interruttori, non uno, e la differenza non e' burocratica:
//
//   · **Un adulto** basta che il residence abbia acceso la prepagata nei parametri generali.
//     E' lui a decidere per se': carica quello che vuole e lo spende.
//
//   · **Un minorenne** ha bisogno anche del consenso di chi ne risponde, dato in anagrafica.
//     Perche' qui non si sta comprando una comodita': si sta mettendo del denaro spendibile in
//     mano a un ragazzo. Il genitore che carica venti euro sulla tessera del figlio sta
//     decidendo un tetto, e quel tetto deve averlo scelto lui — non arrivare per default
//     perche' il gestore ha acceso una spunta valida per tutti.
//
// IL CREDITO NON E' UN INCASSO. La ricarica e' un debito verso il socio; diventa ricavo mano a
// mano che consuma. Per questo i movimenti stanno in una tabella loro: a fine stagione si deve
// poter dire, socio per socio, quanto ha caricato, quanto ha speso e quanto gli si deve.
import { db } from './db.js';
import { par } from './parametri.js';
import { hashPassword, verifyPassword } from './auth.js';

function eMinorenne(socio) {
  if (!socio?.data_nascita) return false;
  const nato = new Date(socio.data_nascita + "T00:00:00Z").getTime();
  if (!Number.isFinite(nato)) return false;
  return (Date.now() - nato) / 31557600000 < 18;
}

// Puo' usare la prepagata? Risponde sempre anche PERCHE' no: un "non si puo'" senza motivo
// manda la crew a cercare il gestore.
async function statoPrepagata(socio) {
  const accesa = String(await par("tessera_prepagata")) === "true" || (await par("tessera_prepagata")) === true;
  if (!accesa) {
    return { attiva: false, motivo: "La prepagata non e' attiva in questo residence.", minorenne: eMinorenne(socio) };
  }
  if (eMinorenne(socio) && Number(socio.prepagata_autorizzata) !== 1) {
    return {
      attiva: false, minorenne: true,
      motivo: "Per un minorenne serve il consenso di chi ne risponde: si attiva in anagrafica, sulla scheda del ragazzo."
    };
  }
  return { attiva: true, minorenne: eMinorenne(socio), motivo: null };
}

async function saldo(socioId) {
  const r = await db.prepare("SELECT saldo_dopo FROM tessera_movimenti WHERE socio_id=? ORDER BY id DESC LIMIT 1").get(socioId);
  return Number(r?.saldo_dopo || 0);
}

// Un movimento, con il saldo scritto dentro la riga. Ricalcolare il saldo sommando tutto va
// bene finche' i movimenti sono pochi; scriverlo al momento significa che ogni riga dice quanto
// c'era dopo, e una contestazione si legge senza rifare i conti.
async function muovi({ socioId, tipo, importo, causale, comandaId = null, operatore = null }) {
  const prima = await saldo(socioId);
  const dopo = Math.round((prima + Number(importo)) * 100) / 100;
  if (dopo < -0.001) return { ok: false, error: `Saldo insufficiente: ci sono ${prima.toFixed(2)} \u20ac.`, saldo: prima };
  await db.prepare(
    "INSERT INTO tessera_movimenti (socio_id,tipo,importo,saldo_dopo,causale,comanda_id,operatore) VALUES (?,?,?,?,?,?,?)"
  ).run(socioId, tipo, Number(importo), dopo, causale || null, comandaId, operatore);
  return { ok: true, saldo: dopo, prima };
}

async function movimenti(socioId, limite = 50) {
  return db.prepare(
    "SELECT tipo,importo,saldo_dopo,causale,operatore,created_at FROM tessera_movimenti WHERE socio_id=? ORDER BY id DESC LIMIT ?"
  ).all(socioId, Math.min(200, Math.max(1, Number(limite) || 50)));
}

// Quanto deve ancora il residence ai soci: e' un debito, e a fine stagione va saldato o
// riportato. Serve al gestore per non trovarsi la sorpresa a settembre.
async function debitoVersoISoci() {
  const righe = await db.prepare(
    `SELECT m.socio_id, s.nome, s.cognome, s.tessera_code, m.saldo_dopo FROM tessera_movimenti m
     JOIN soci s ON s.id = m.socio_id
     WHERE m.id = (SELECT MAX(id) FROM tessera_movimenti WHERE socio_id = m.socio_id)`
  ).all();
  const conCredito = righe.filter((r) => Number(r.saldo_dopo) > 0);
  return {
    soci: conCredito.map((r) => ({ nome: `${r.nome} ${r.cognome}`, tessera: r.tessera_code, saldo: Number(r.saldo_dopo) })),
    totale: Number(conCredito.reduce((s, r) => s + Number(r.saldo_dopo), 0).toFixed(2))
  };
}

// IL PIN. Il numero di tessera si legge sulla card, si fotografa, e soprattutto si indovina:
// e' sequenziale. Va benissimo per dire "sono io", non per autorizzare una spesa. Il PIN e'
// l'unica cosa che sta solo in testa al socio — e per un ragazzo e' anche il modo in cui il
// genitore sa che quei soldi li spende lui e non l'amico che gli ha preso la tessera.
//
// Cinque tentativi sbagliati e il PIN si blocca: quattro cifre sono diecimila combinazioni, e
// senza un limite si provano tutte.
var PIN_MAX_TENTATIVI = 5;

async function impostaPin(socioId, pin) {
  const p = String(pin || "").trim();
  if (!/^\d{4,6}$/.test(p)) return { ok: false, error: "Il PIN e' di 4-6 cifre." };
  if (/^(\d)\1+$/.test(p) || ["1234", "0000", "123456"].includes(p)) {
    return { ok: false, error: "Scegli un PIN meno prevedibile: 1234 e le cifre tutte uguali sono le prime che si provano." };
  }
  await db.prepare("UPDATE soci SET pin_hash=?, pin_tentativi=0 WHERE id=?").run(await hashPassword(p), socioId);
  return { ok: true };
}

async function verificaPin(socio, pin) {
  if (!socio.pin_hash) return { ok: false, error: "Su questa tessera non c'e' ancora un PIN: si imposta dall'app o al banco." };
  if (Number(socio.pin_tentativi) >= PIN_MAX_TENTATIVI) {
    return { ok: false, error: "PIN bloccato dopo troppi tentativi sbagliati: va reimpostato al banco." };
  }
  const ok = await verifyPassword(String(pin || ""), socio.pin_hash);
  if (!ok) {
    await db.prepare("UPDATE soci SET pin_tentativi=pin_tentativi+1 WHERE id=?").run(socio.id);
    const restano = PIN_MAX_TENTATIVI - Number(socio.pin_tentativi) - 1;
    return { ok: false, error: `PIN sbagliato.${restano > 0 ? ` Restano ${restano} tentativi.` : " La tessera e' bloccata."}` };
  }
  if (Number(socio.pin_tentativi) > 0) await db.prepare("UPDATE soci SET pin_tentativi=0 WHERE id=?").run(socio.id);
  return { ok: true };
}

export { debitoVersoISoci, eMinorenne, impostaPin, movimenti, muovi, saldo, statoPrepagata, verificaPin };

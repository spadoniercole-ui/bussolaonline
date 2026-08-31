// LE E-MAIL CHE ESCONO DAVVERO.
//
// Fino a qui il codice OTP veniva generato, scritto nel database e poi... niente. In sviluppo
// tornava dentro la risposta HTTP (comodo per provare), in produzione si perdeva: nessuno
// poteva accedere con l'e-mail, perche' quel codice non arrivava a nessuno.
//
// Qui si spedisce sul serio. Nessuna libreria nuova: si parla via HTTP con il fornitore, con
// `fetch`, cosi' il bundle resta il file unico che si copia su Render.
//
// COME SI ACCENDE (variabili d'ambiente):
//   MAIL_PROVIDER = resend | brevo | console        (senza, e' "console")
//   MAIL_API_KEY  = la chiave del fornitore
//   MAIL_FROM     = "Bussola Residence <noreply@iltuodominio.it>"
//   MAIL_REPLY_TO = (facoltativo) dove rispondono i soci
//
// In modalita' "console" la mail non parte: viene scritta nei log del server, per intero.
// Serve in sviluppo, e serve anche in produzione il primo giorno — meglio un codice nei log
// che un servizio che finge di aver spedito.
const PROVIDER = String(process.env.MAIL_PROVIDER || "console").toLowerCase();
const API_KEY = process.env.MAIL_API_KEY || "";
const FROM = process.env.MAIL_FROM || "Bussola Residence <noreply@bussola.local>";
const REPLY_TO = process.env.MAIL_REPLY_TO || "";

// Il fornitore e' configurato davvero? Se manca la chiave si resta in console: meglio un log
// leggibile che una spedizione che fallisce in silenzio a ogni richiesta.
function mailAttiva() {
  return PROVIDER !== "console" && !!API_KEY;
}

function daNomeEmail(s) {
  const m = String(s).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { nome: m[1] || "", email: m[2] } : { nome: "", email: String(s).trim() };
}

// Il testo semplice non e' un ripiego: c'e' chi legge la posta senza HTML, e il codice deve
// restare leggibile anche li'.
function soloTesto(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function viaResend({ a, oggetto, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [a], subject: oggetto, html, text: soloTesto(html), ...(REPLY_TO ? { reply_to: REPLY_TO } : {}) })
  });
  if (!r.ok) throw new Error("Resend " + r.status + ": " + (await r.text()).slice(0, 200));
  return true;
}

async function viaBrevo({ a, oggetto, html }) {
  const f = daNomeEmail(FROM);
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: f.email, name: f.nome || "Bussola Residence" },
      to: [{ email: a }],
      subject: oggetto,
      htmlContent: html,
      textContent: soloTesto(html),
      ...(REPLY_TO ? { replyTo: { email: daNomeEmail(REPLY_TO).email } } : {})
    })
  });
  if (!r.ok) throw new Error("Brevo " + r.status + ": " + (await r.text()).slice(0, 200));
  return true;
}

// Spedisce. Non lancia mai: chi la chiama deve poter decidere cosa dire all'utente sapendo se
// e' partita o no, ma un fornitore che non risponde non deve far fallire una registrazione.
async function invia({ a, oggetto, html }) {
  const dest = String(a || "").trim();
  if (!dest.includes("@")) return { inviata: false, motivo: "indirizzo non valido" };
  if (!mailAttiva()) {
    console.log(`\n\u2709\ufe0f  [posta non configurata] a: ${dest}\n    ${oggetto}\n${soloTesto(html).split("\n").map((r) => "    " + r).join("\n")}\n`);
    return { inviata: false, motivo: "console" };
  }
  try {
    if (PROVIDER === "resend") await viaResend({ a: dest, oggetto, html });
    else if (PROVIDER === "brevo") await viaBrevo({ a: dest, oggetto, html });
    else return { inviata: false, motivo: "fornitore sconosciuto: " + PROVIDER };
    return { inviata: true };
  } catch (e) {
    console.error("posta:", e && e.message);
    return { inviata: false, motivo: String(e && e.message).slice(0, 160) };
  }
}

// La cornice delle e-mail: sobria, leggibile anche in bianco e nero, senza immagini remote
// (che i client bloccano e che farebbero sembrare il codice un allegato mancante).
function cornice(titolo, corpo) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1b2733">
    <div style="background:#12314b;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">
      <div style="letter-spacing:.16em;font-size:12px;opacity:.85">BUSSOLA RESIDENCE</div>
      <div style="font-size:19px;font-weight:700;margin-top:2px">${titolo}</div>
    </div>
    <div style="background:#faf8f3;padding:22px;border:1px solid #e6e1d6;border-top:0;border-radius:0 0 12px 12px">${corpo}</div>
    <p style="color:#8a8578;font-size:11px;text-align:center;margin-top:14px">
      Messaggio automatico: a questo indirizzo non risponde nessuno.</p>
  </div>`;
}

async function inviaCodice(a, codice, minuti) {
  return invia({
    a,
    oggetto: `${codice} \u00e8 il tuo codice di accesso \u00b7 Bussola Residence`,
    html: cornice("Il tuo codice di accesso", `
      <p style="margin-top:0">Scrivi questo codice nell'app per entrare:</p>
      <p style="font-size:34px;font-weight:800;letter-spacing:.22em;background:#fff;border:2px dashed #c9a227;border-radius:10px;padding:14px;text-align:center;margin:14px 0">${codice}</p>
      <p>Vale <b>${minuti} minuti</b>, poi scade. Si usa una volta sola.</p>
      <p style="color:#6b6257;font-size:13px">Se non hai chiesto tu di entrare, ignora questo messaggio: senza il codice non succede niente.</p>`)
  });
}

async function inviaBenvenuto(a, { nome, tessera }) {
  return invia({
    a,
    oggetto: "Benvenuto alla Bussola \u00b7 la tua tessera",
    html: cornice("Benvenuto" + (nome ? ", " + nome : ""), `
      <p style="margin-top:0">La tua registrazione \u00e8 fatta. Questo \u00e8 il numero della tua tessera:</p>
      <p style="font-size:24px;font-weight:800;letter-spacing:.12em;background:#fff;border:1px solid #e6e1d6;border-radius:10px;padding:12px;text-align:center;margin:14px 0">${tessera}</p>
      <p>Serve per prenotare un campo, iscriverti alle lezioni e partecipare alla Coppa delle Casate.
      Puoi entrare nell'app con la tessera, oppure con questa e-mail e un codice che ti arriva qui.</p>
      <p style="color:#6b6257;font-size:13px">Bar e Garden sono aperti a tutti: la tessera non serve per consumare.</p>`)
  });
}

// LA COPIA DI CORTESIA DEL CONTO. Non e' lo scontrino: quello resta un documento fiscale che
// esce dal registratore e si consegna a mano. Questa e' la copia che il cliente puo' rileggere
// domani, quando non ricorda cosa ha preso o vuole controllare un importo — e serve soprattutto
// a chi non ordina col QR e quindi non ha niente sul telefono: gli anziani, chi usa la versione
// leggera, chi si e' fatto servire al tavolo e basta.
//
// La differenza fra le due cose e' scritta dentro il messaggio, non lasciata capire.
async function inviaRicevuta(a, { numero, data, punto, righe, totale, metodo }) {
  const riga = (r) => `<tr>
    <td style="padding:4px 0">${r.qta}\u00d7 ${r.nome}</td>
    <td style="padding:4px 0;text-align:right;white-space:nowrap">\u20ac ${Number(r.prezzo * r.qta).toFixed(2)}</td></tr>`;
  return invia({
    a,
    oggetto: `Il tuo conto alla Bussola \u00b7 #${numero}`,
    html: cornice("Copia di cortesia del conto", `
      <p style="margin-top:0">${data}${punto ? " \u00b7 " + punto : ""} \u00b7 comanda <b>#${numero}</b></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
        ${righe.map(riga).join("")}
        <tr><td style="padding:10px 0 0;border-top:2px solid #12314b"><b>Totale</b></td>
            <td style="padding:10px 0 0;border-top:2px solid #12314b;text-align:right"><b>\u20ac ${Number(totale).toFixed(2)}</b></td></tr>
      </table>
      <p style="color:#6b6257;font-size:13px">Pagato ${metodo === "carta" ? "con carta" : metodo === "contanti" ? "in contanti" : ""}.</p>
      <div style="background:#fdf1e7;border-left:4px solid #C0553F;border-radius:0 8px 8px 0;padding:10px 12px;margin-top:14px">
        <b style="color:#8a3a2a">Questa non \u00e8 una ricevuta fiscale.</b>
        <div style="margin-top:4px;font-size:13px">\u00c8 la copia di cortesia del tuo conto, per averlo sotto mano.
        Lo scontrino fiscale ti viene consegnato al banco: se non l'hai avuto, chiedilo.</div>
      </div>`)
  });
}

export { cornice, invia, inviaBenvenuto, inviaCodice, inviaRicevuta, mailAttiva, soloTesto };

// La posta parte davvero? Si mette in ascolto un finto fornitore e si guarda cosa gli arriva:
// senza questa prova si sa solo che il codice viene scritto nel database, non che qualcuno lo
// riceve — ed è esattamente l'errore che c'era prima.
import { createServer } from 'node:http';

const ricevute = [];
const finto = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    ricevute.push({ url: req.url, auth: !!req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"finto"}');
  });
});
await new Promise((r) => finto.listen(8899, r));

// Si punta il modulo al finto fornitore riscrivendo l'indirizzo di Resend.
process.env.MAIL_PROVIDER = 'resend';
process.env.MAIL_API_KEY = 'chiave-di-prova';
process.env.MAIL_FROM = 'Bussola Residence <noreply@bussola.test>';
const vero = globalThis.fetch;
globalThis.fetch = (u, o) => vero(String(u).replace('https://api.resend.com', 'http://127.0.0.1:8899'), o);

const mail = await import('../server/mail.js');
console.log('posta configurata:', mail.mailAttiva());
const esito = await mail.inviaCodice('socio@example.test', '482913', 10);
console.log('esito invio      :', JSON.stringify(esito));
const m = ricevute[0];
console.log('il fornitore ha ricevuto:');
console.log('  destinatario :', (m.body.to || []).join(', '));
console.log('  oggetto      :', m.body.subject);
console.log('  chiave usata :', m.auth ? 'sì' : 'NO');
console.log('  il codice c’è nel testo:', String(m.body.text).includes('482913') ? 'sì' : 'NO');
console.log('  il codice c’è nell’HTML:', String(m.body.html).includes('482913') ? 'sì' : 'NO');
console.log('\ntesto della mail come la legge chi non vede l’HTML:');
console.log(String(m.body.text).split('\n').map((r) => '  ' + r).join('\n'));
finto.close();

import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = 'http://127.0.0.1:5600';
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const call = async (p,o={}) => (await fetch(base+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})},body:o.body?JSON.stringify(o.body):undefined})).json();
const tk = (await call('/api/admin/login',{method:'POST',body:{username:'gestore',password:'shot-admin'}})).token;
const films = [
  ['Nuovo Cinema Paradiso','Giuseppe Tornatore',1988,155,'drammatico','Un regista torna al paese e ritrova il proiezionista che gli insegnò il cinema.'],
  ['Il Postino','Michael Radford',1994,108,'commedia','Un postino di un’isola del Sud impara la poesia da Pablo Neruda.'],
  ['La Grande Bellezza','Paolo Sorrentino',2013,142,'drammatico','Roma vista da un giornalista mondano alla soglia dei 65 anni.'],
  ['Kaos','Taviani',1984,188,'drammatico','Quattro novelle siciliane di Pirandello.'],
  ['Baarìa','Giuseppe Tornatore',2009,150,'storico','Cinquant’anni di Sicilia attraverso una famiglia di Bagheria.'],
  ['Divorzio all’italiana','Pietro Germi',1961,105,'commedia','Un barone siciliano cerca la via legale per liberarsi della moglie.'],
  ['Il Gattopardo','Luchino Visconti',1963,187,'storico','La Sicilia dell’Unità vista dal principe di Salina.'],
  ['Sedotta e abbandonata','Pietro Germi',1964,118,'commedia','L’onore di una famiglia siciliana messo alla prova.'],
  ['Stromboli','Roberto Rossellini',1950,107,'drammatico','Una donna approda su un’isola di pescatori.'],
  ['L’avventura','Michelangelo Antonioni',1960,143,'drammatico','Una scomparsa fra le Eolie e ciò che resta dopo.']
];
for (const [titolo,regia,anno,durata_min,genere,sinossi] of films) await call('/api/admin/film',{method:'POST',token:tk,body:{titolo,regia,anno,durata_min,genere,sinossi}});
const lista = await call('/api/admin/film',{token:tk});
const gg = (n) => new Date(Date.now()+n*864e5).toISOString().slice(0,10);
for (let i=0;i<4;i++) await call('/api/admin/proiezioni',{method:'POST',token:tk,body:{film_id:lista[i].id,data:gg(3+i*7),ora:'21:30'}});
const pr = (await call('/api/admin/proiezioni',{token:tk}))[0];
for (const t of ['BR-2026-0001','BR-2026-0002','BR-2026-0003']) await call(`/api/cinema/${pr.id}/prenota`,{method:'POST',body:{tessera_code:t,persone:2}});
const p = await b.newPage({ viewport:{width:1280,height:1000} });
await p.goto(base+'/admin/',{waitUntil:'networkidle'});
await p.fill('#u','gestore'); await p.fill('#p','shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
await p.click('button[data-v="cinema"]'); await p.waitForTimeout(1800);
await p.click('[data-pplatea]'); await p.waitForTimeout(1200);
await p.screenshot({ path:'/tmp/cinema.png', fullPage:true });
const ctx = p.context();
const [pop] = await Promise.all([ ctx.waitForEvent('page'), p.click('#cin_print') ]);
await pop.waitForLoadState('domcontentloaded'); await pop.waitForTimeout(1000);
await pop.emulateMedia({ media:'print' });
await pop.screenshot({ path:'/tmp/cartellone.png', fullPage:true });
await b.close(); console.log('ok');

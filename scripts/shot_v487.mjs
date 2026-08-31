import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base='http://127.0.0.1:5986';
const dir = readdirSync('/opt/pw-browsers').find(d=>d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath:`/opt/pw-browsers/${dir}/chrome-linux/chrome`, args:['--no-sandbox'] });
const call = async (p,o={}) => (await fetch(base+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})},body:o.body?JSON.stringify(o.body):undefined})).json();
const tk = (await call('/api/admin/login',{method:'POST',body:{username:'gestore',password:'shot-admin'}})).token;
const oggi = new Date().toISOString().slice(0,10);
// parametri come li ha impostati lui: 20 + 10
await call('/api/admin/parametri',{method:'PUT',token:tk,body:{stage_posti_standard:20, stage_posti_extra_n:10, stage_contributo:2.5}});
await call('/api/admin/tavoli/layout/rigenera',{method:'POST',token:tk,body:{ambiente:'stage'}});
const f = await call('/api/admin/film',{method:'POST',token:tk,body:{titolo:'Bianco Rosso e Verdone',regia:'Verdone'}});
await call('/api/admin/proiezioni',{method:'POST',token:tk,body:{film_id:f.id,data:oggi,ora:'21:30'}});
await call('/api/garden/prenota',{method:'POST',body:{tessera_code:'BR-2026-0001',data:oggi,turno:'20:00',persone:4}});
const p = await b.newPage({ viewport:{width:1000,height:1000} });
await p.goto(base+'/chiosco/',{waitUntil:'networkidle'});
await p.fill('#u','gestore'); await p.fill('#p','shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
await p.selectOption('#zonaSwitch','cinema'); await p.waitForTimeout(1500);
await p.click('#tabs [data-v="pianta"]'); await p.waitForTimeout(2000);
await p.screenshot({path:'/tmp/stage2.png', fullPage:true});
// clic su una seduta libera → prenotazione al banco
const libera = await p.$('[data-pren="15"]');
if (libera) { await libera.click(); await p.waitForTimeout(800); await p.screenshot({path:'/tmp/stage_click.png'}); }
await b.close(); console.log('ok');

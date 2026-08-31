import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base='http://127.0.0.1:5950';
const dir = readdirSync('/opt/pw-browsers').find(d=>d.startsWith('chromium-'));
const b = await chromium.launch({ executablePath:`/opt/pw-browsers/${dir}/chrome-linux/chrome`, args:['--no-sandbox'] });
const call = async (p,o={}) => (await fetch(base+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})},body:o.body?JSON.stringify(o.body):undefined})).json();
const tk = (await call('/api/admin/login',{method:'POST',body:{username:'gestore',password:'shot-admin'}})).token;
for (const d of await call('/api/admin/discipline',{token:tk})) {
  let tb = await call(`/api/admin/tabellone/${d.id}`,{token:tk});
  if (!tb.gironi.length) await call(`/api/admin/tabellone/${d.id}/genera`,{method:'POST',token:tk});
  for (let g=0; g<8; g++) {
    tb = await call(`/api/admin/tabellone/${d.id}`,{token:tk});
    const da=[...(tb.gironi||[]).flatMap(x=>x.partite||[]),...Object.values(tb.fasi||{}).flat()].filter(p=>p&&p.stato!=='giocata');
    if (!da.length) break;
    for (const p of da) await call('/api/admin/partite/'+p.id,{method:'PUT',token:tk,body:{gol_a:2+(p.id%2),gol_b:1}});
  }
}
const p = await b.newPage({ viewport:{width:1280,height:1000} });
await p.goto(base+'/admin/',{waitUntil:'networkidle'});
await p.fill('#u','gestore'); await p.fill('#p','shot-admin'); await p.click('#loginBtn'); await p.waitForTimeout(1800);
await p.click('button[data-v="casate"]'); await p.waitForTimeout(2200);
await p.screenshot({path:'/tmp/chiusura.png', fullPage:true});
await b.close(); console.log('ok');

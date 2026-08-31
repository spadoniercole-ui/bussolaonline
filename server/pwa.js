import { cache, load } from './auth.js';
import { url } from './db.js';
import { ICON_180, ICON_192, ICON_512 } from './pwa-icons.js';
import { notifica } from './routes/authuser.js';
import { VERSION } from './version.js';

var png192 = Buffer.from(ICON_192, "base64");
var png512 = Buffer.from(ICON_512, "base64");
var png180 = Buffer.from(ICON_180, "base64");
var APPS = {
  socio: { scope: "/", name: "Bussola Residence", short: "Bussola", theme: "#12324F", bg: "#0d2137" },
  admin: { scope: "/admin/", name: "Bussola Back Office", short: "Bussola BO", theme: "#12324F", bg: "#0d2137" },
  chiosco: { scope: "/chiosco/", name: "Bussola Chiosco", short: "Chiosco", theme: "#12324F", bg: "#0d2137" }
};
function manifest(app2) {
  return JSON.stringify({
    name: app2.name,
    short_name: app2.short,
    description: "App del residence Bussola",
    start_url: app2.scope,
    scope: app2.scope,
    id: app2.scope,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: app2.bg,
    theme_color: app2.theme,
    lang: "it",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  });
}
function sw(app2) {
  const pfx = "bussola" + app2.scope.replace(/\//g, "_");
  return `const V=${JSON.stringify(String(VERSION))};
const CACHE='${pfx}v'+V;
const START=${JSON.stringify(app2.scope)};
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k.startsWith('${pfx}')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET'){return;}
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')){ e.respondWith(fetch(req).catch(()=>caches.match(req))); return; }
  // App shell + script/stili: NETWORK-FIRST, cos\xEC dopo un deploy si vede subito la versione nuova.
  if(req.mode==='navigate' || ['script','style','document'].includes(req.destination)){
    e.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(req,c));return r;}).catch(()=>caches.match(req).then(m=>m||caches.match(START))));
    return;
  }
  // Altro (immagini, icone): cache-first per velocit\xE0/offline.
  e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{if(res&&res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(req,c));}return res;}).catch(()=>r)));
});
// Web Push: mostra la notifica ricevuta e, al tocco, apre/porta in primo piano l'app.
self.addEventListener('push',e=>{
  let d={}; try{ d=e.data?e.data.json():{}; }catch(_){ d={ title:'Bussola Residence', body:(e.data&&e.data.text&&e.data.text())||'' }; }
  const title=d.title||'Bussola Residence';
  const opts={ body:d.body||'', icon:START+'icons/icon-192.png', badge:START+'icons/icon-192.png', data:{ url:d.url||START }, tag:d.tag||'bussola', renotify:true };
  e.waitUntil(self.registration.showNotification(title,opts));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||START;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){ if('focus'in c){ try{c.navigate&&c.navigate(url);}catch(_){}; return c.focus(); } }
    if(clients.openWindow) return clients.openWindow(url);
  }));
});`;
}
function pwaHead(appKey) {
  const app2 = APPS[appKey];
  const m = app2.scope + "manifest.webmanifest";
  const s = app2.scope + "sw.js";
  return `<link rel="manifest" href="${m}">
<meta name="theme-color" content="${app2.theme}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${app2.short}">
<link rel="apple-touch-icon" href="/pwa/apple-180.png">
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${s}',{scope:'${app2.scope}'}).catch(function(){});});}</script>`;
}
function mountPwa(app2) {
  const send = (res, type, body, sw2) => {
    res.setHeader("Content-Type", type);
    if (sw2) {
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Cache-Control", "no-cache");
    }
    res.send(body);
  };
  app2.get("/pwa/icon-192.png", (req, res) => send(res, "image/png", png192));
  app2.get("/pwa/icon-512.png", (req, res) => send(res, "image/png", png512));
  app2.get("/pwa/apple-180.png", (req, res) => send(res, "image/png", png180));
  app2.get("/manifest.webmanifest", (req, res) => send(res, "application/manifest+json", manifest(APPS.socio)));
  app2.get("/sw.js", (req, res) => send(res, "application/javascript", sw(APPS.socio), true));
  app2.get("/admin/manifest.webmanifest", (req, res) => send(res, "application/manifest+json", manifest(APPS.admin)));
  app2.get("/admin/sw.js", (req, res) => send(res, "application/javascript", sw(APPS.admin), true));
  app2.get("/chiosco/manifest.webmanifest", (req, res) => send(res, "application/manifest+json", manifest(APPS.chiosco)));
  app2.get("/chiosco/sw.js", (req, res) => send(res, "application/javascript", sw(APPS.chiosco), true));
}

export { mountPwa, pwaHead };

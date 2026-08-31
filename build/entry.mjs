import express from "express";
import frontend_default from "./frontend.html";
import admin_default from "./admin.html";
import chiosco_default from "./chiosco.html";
import ordina_default from "./ordina.html";
import { cache } from '../server/auth.js';
import { initSchema } from '../server/db.js';
import { mountPwa, pwaHead } from '../server/pwa.js';
import { adminRouter } from '../server/routes/admin.js';
import { authUserRouter } from '../server/routes/authuser.js';
import { publicRouter } from '../server/routes/public.js';
import { seed } from '../server/seed.js';
import { VERSION } from '../server/version.js';

var FRONTEND = frontend_default.replace("</head>", pwaHead("socio") + "\n</head>");
var ADMIN = admin_default.replace("</head>", pwaHead("admin") + "\n</head>");
var CHIOSCO = chiosco_default.replace("</head>", pwaHead("chiosco") + "\n</head>");
var BUILD = typeof BUILD_TS !== "undefined" ? BUILD_TS : "online";
var MAJOR = Number(process.versions.node.split(".")[0]);
if (Number.isNaN(MAJOR) || MAJOR < 22) {
  console.error("\n  Serve Node.js 22 o superiore. Versione attuale: " + process.version + "\n  Scarica Node 22 LTS da https://nodejs.org\n");
  process.exit(1);
}
var PORT = process.env.PORT || 4e3;
await initSchema();
await seed();
var app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Le mappe di Google sono l'unico contenuto esterno che accettiamo, e solo dentro un
  // riquadro: senza "frame-src" la nostra stessa politica di sicurezza le bloccava, e il
  // socio leggeva "Questi contenuti sono bloccati" al posto della mappa.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https://maps.gstatic.com https://*.googleapis.com; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; " +
    "frame-src https://www.google.com https://maps.google.com https://*.google.com; " +
    "frame-ancestors 'self'"
  );
  next();
});
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
mountPwa(app);
app.get("/api/health", (req, res) => res.json({ ok: true, version: VERSION, build: BUILD, env: process.env.KOINE_ENV || "online", ts: (/* @__PURE__ */ new Date()).toISOString() }));
app.use("/api/auth", authUserRouter);
app.use("/api", publicRouter);
app.use("/api/admin", adminRouter);
var html = (res, body) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(body);
};
app.get(["/", "/index.html"], (req, res) => html(res, FRONTEND));
app.get(["/admin", "/admin/", "/admin/index.html"], (req, res) => html(res, ADMIN));
app.get(["/chiosco", "/chiosco/", "/chiosco/index.html"], (req, res) => html(res, CHIOSCO));
app.get(["/ordina", "/ordina/", "/ordina/index.html"], (req, res) => html(res, ordina_default));
// LA TESSERA, DA QUALUNQUE SUPPORTO ARRIVI. Un solo indirizzo corto — /t/BR-2026-0101 — che
// funziona per tutti e tre i modi di portarla in giro:
//   · stampata come QR: la crew la inquadra, il socio la inquadra col suo telefono;
//   · scritta in un tag NFC come URL: qualunque telefono che appoggi la card apre questa
//     pagina, iPhone compresi (lo fanno da soli, senza app installata);
//   · digitata a mano, quando la card e' rimasta in camera.
// Sono lo stesso identificatore su supporti diversi: non serve scegliere, convivono.
app.get("/t/:code", (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  res.redirect(302, "/?t=" + encodeURIComponent(code));
});
app.use((req, res) => res.status(404).json({ error: "Non trovato" }));
app.use((err, req, res, next) => {
  console.error("Errore API:", err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Errore interno" });
});
app.listen(PORT, () => {
  console.log("\n  Bussola Residence \xB7 by KOIN\xC8 \u2014 online");
  console.log(`  App ospiti:   porta ${PORT}, percorso /`);
  console.log(`  Back office:  porta ${PORT}, percorso /admin/`);
});

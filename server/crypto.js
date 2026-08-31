import crypto from "node:crypto";
import { DEV } from './routes/authuser.js';

var RAW = process.env.KOINE_ENC_KEY || "";
var ENC_IS_DEV_KEY = !RAW;
var KEYSOURCE = RAW || "KOINE-DEV-ENC-KEY-do-not-use-in-produzione";
var KEY = crypto.createHash("sha256").update(KEYSOURCE, "utf8").digest();
if (ENC_IS_DEV_KEY && (process.env.KOINE_ENV || "dev") === "prod") {
  console.warn("[crypto] ATTENZIONE: KOINE_ENC_KEY non impostata in produzione \u2014 i dati host userebbero una chiave di sviluppo.");
}
function encryptJSON(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}
function decryptJSON(blob) {
  const buf = Buffer.from(String(blob || ""), "base64");
  if (buf.length < 28) throw new Error("blob cifrato non valido");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(pt.toString("utf8"));
}
function tryDecryptJSON(blob) {
  try {
    return decryptJSON(blob);
  } catch (_) {
    return null;
  }
}

export { KEY, encryptJSON, tryDecryptJSON };

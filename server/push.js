import webpush from "web-push";
import { db } from './db.js';

function pushEnabled() {
  return ENABLED;
}
function publicKey() {
  return ENABLED ? PUB : null;
}
async function saveSubscription(socioId, sub) {
  if (!sub || !sub.endpoint) return false;
  const k = sub.keys || {};
  try {
    await db.prepare("INSERT OR REPLACE INTO push_sub (endpoint,socio_id,p256dh,auth,created_at) VALUES (?,?,?,?,datetime('now'))").run(sub.endpoint, socioId, k.p256dh || "", k.auth || "");
    return true;
  } catch (_) {
    return false;
  }
}
async function removeSubscription(endpoint) {
  if (endpoint) {
    try {
      await db.prepare("DELETE FROM push_sub WHERE endpoint=?").run(endpoint);
    } catch (_) {
    }
  }
}
async function sendToSubs(subs, payload) {
  if (!ENABLED || !subs.length) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, data);
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) await removeSubscription(s.endpoint);
    }
  }
  return sent;
}
async function sendToSocio(socioId, payload) {
  if (!ENABLED) return 0;
  const subs = await db.prepare("SELECT endpoint,p256dh,auth FROM push_sub WHERE socio_id=?").all(socioId);
  return sendToSubs(subs, payload);
}
async function sendToSoci(socioIds, payload) {
  if (!ENABLED || !socioIds || !socioIds.length) return 0;
  const uniq = [...new Set(socioIds.filter(Boolean).map(Number))];
  const rows = [];
  for (const id of uniq) {
    const subs = await db.prepare("SELECT endpoint,p256dh,auth FROM push_sub WHERE socio_id=?").all(id);
    rows.push(...subs);
  }
  return sendToSubs(rows, payload);
}
var PUB, PRIV, SUBJ, ENABLED;
PUB = process.env.VAPID_PUBLIC || process.env.VAPID_PUBLIC_KEY || "";
PRIV = process.env.VAPID_PRIVATE || process.env.VAPID_PRIVATE_KEY || "";
SUBJ = process.env.VAPID_SUBJECT || "mailto:info@bussolavillage.it";
ENABLED = false;
if (PUB && PRIV) {
  try {
    webpush.setVapidDetails(SUBJ, PUB, PRIV);
    ENABLED = true;
  } catch (e) {
    console.error("VAPID non valido:", e?.message || e);
  }
}

export { publicKey, pushEnabled, removeSubscription, saveSubscription, sendToSoci, sendToSocio };

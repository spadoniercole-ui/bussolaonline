import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from './db.js';

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && timingSafeEqual(test, ref);
}
var TTL = 8 * 60 * 60 * 1e3;
var cache = /* @__PURE__ */ new Map();
async function persist(token, kind, data, exp) {
  cache.set(token, { kind, data, exp });
  try {
    await db.prepare("INSERT OR REPLACE INTO sessioni (token,kind,dati,exp) VALUES (?,?,?,?)").run(token, kind, JSON.stringify(data), exp);
  } catch (_) {
  }
}
async function load(token, kind) {
  if (!token) return null;
  const c = cache.get(token);
  if (c && c.kind === kind) {
    if (Date.now() > c.exp) {
      await drop(token);
      return null;
    }
    return c.data;
  }
  let row = null;
  try {
    row = await db.prepare("SELECT kind,dati,exp FROM sessioni WHERE token=?").get(token);
  } catch (_) {
    row = null;
  }
  if (!row || row.kind !== kind) return null;
  const exp = Number(row.exp);
  if (Date.now() > exp) {
    await drop(token);
    return null;
  }
  let data;
  try {
    data = JSON.parse(row.dati);
  } catch (_) {
    return null;
  }
  cache.set(token, { kind, data, exp });
  return data;
}
async function drop(token) {
  cache.delete(token);
  try {
    await db.prepare("DELETE FROM sessioni WHERE token=?").run(token);
  } catch (_) {
  }
}
async function createSession(user) {
  const token = randomBytes(24).toString("hex");
  await persist(token, "admin", { id: user.id, username: user.username, ruolo: user.ruolo, permessi: user.permessi ?? null }, Date.now() + TTL);
  return token;
}
async function getSession(token) {
  return load(token, "admin");
}
async function destroySession(token) {
  await drop(token);
}
async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = await getSession(token);
    if (!user) return res.status(401).json({ error: "Autenticazione richiesta" });
    req.adminUser = user;
    next();
  } catch (_) {
    res.status(401).json({ error: "Autenticazione richiesta" });
  }
}
async function createUserSession(socio) {
  const token = randomBytes(24).toString("hex");
  await persist(token, "user", { id: socio.id, tessera_code: socio.tessera_code, nome: socio.nome }, Date.now() + TTL);
  return token;
}
async function getUserSession(token) {
  return load(token, "user");
}
function genOtp() {
  return String(randomBytes(3).readUIntBE(0, 3) % 1e6).padStart(6, "0");
}

export { cache, createSession, createUserSession, destroySession, genOtp, getUserSession, hashPassword, load, requireAdmin, verifyPassword };

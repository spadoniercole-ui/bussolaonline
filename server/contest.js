import { audit, db } from './db.js';

var SCALA_DEFAULT = [10, 6, 4, 3, 2, 1, 1, 1];
var SCALA_SFILATA = [10, 0, 0, 0, 0, 0, 0, 0];
var BONUS_VENDITE = [4, 2, 1];
function scalaDi(contest) {
  if (contest?.punti_scala) {
    try {
      const a = JSON.parse(contest.punti_scala);
      if (Array.isArray(a)) return a;
    } catch (_) {
    }
  }
  return contest?.tipo === "sfilata" ? SCALA_SFILATA : SCALA_DEFAULT;
}
async function salvaEsito(contestId, righe, scalaOverride) {
  const contest = await db.prepare("SELECT * FROM contest WHERE id=?").get(contestId);
  if (!contest) throw new Error("Contest non trovato");
  if (contest.esito_assegnato) throw new Error("Esito gi\xE0 assegnato alla Coppa: non modificabile");
  const scala = Array.isArray(scalaOverride) ? scalaOverride : scalaDi(contest);
  const venditori = righe.filter((r) => Number(r.pezzi_venduti) > 0).sort((a, b) => Number(b.pezzi_venduti) - Number(a.pezzi_venduti) || Number(a.casata_id) - Number(b.casata_id));
  const bonusPer = /* @__PURE__ */ new Map();
  venditori.slice(0, 3).forEach((r, i) => bonusPer.set(Number(r.casata_id), BONUS_VENDITE[i]));
  const up = db.prepare(`INSERT INTO contest_esiti (contest_id,casata_id,posizione,pezzi_venduti,punti)
                         VALUES (?,?,?,?,?)
                         ON CONFLICT(contest_id,casata_id) DO UPDATE SET
                           posizione=excluded.posizione, pezzi_venduti=excluded.pezzi_venduti, punti=excluded.punti`);
  const out = [];
  for (const r of righe) {
    const pos = Number(r.posizione) || null;
    const pezzi = Number(r.pezzi_venduti) || 0;
    const placement = pos && pos >= 1 && scala[pos - 1] != null ? scala[pos - 1] : 0;
    const bonus = bonusPer.get(Number(r.casata_id)) || 0;
    const punti = placement + bonus;
    await up.run(contestId, r.casata_id, pos, pezzi, punti);
    out.push({ casata_id: Number(r.casata_id), posizione: pos, pezzi_venduti: pezzi, placement, bonus, punti });
  }
  if (Array.isArray(scalaOverride)) {
    await db.prepare("UPDATE contest SET punti_scala=? WHERE id=?").run(JSON.stringify(scalaOverride), contestId);
  }
  await db.prepare("UPDATE contest SET stato='in_corso' WHERE id=? AND stato='annunciato'").run(contestId);
  audit("staff", "esito_contest", "contest", contestId, `${out.length} casate`);
  return out;
}
async function assegnaCoppa(contestId) {
  const contest = await db.prepare("SELECT * FROM contest WHERE id=?").get(contestId);
  if (!contest) throw new Error("Contest non trovato");
  if (contest.esito_assegnato) throw new Error("Punti gi\xE0 assegnati");
  const esiti = await db.prepare("SELECT * FROM contest_esiti WHERE contest_id=?").all(contestId);
  if (!esiti.length) throw new Error("Nessun esito salvato: registra prima la graduatoria");
  // I punti NON si sommano qui: restano in contest_esiti e il totale della Coppa
  // li rilegge a ogni ricalcolo (vedi server/coppa.js). Marcare l'esito come assegnato
  // e' quindi un'operazione idempotente.
  let totale = 0;
  for (const e of esiti) totale += Number(e.punti) || 0;
  const primo = esiti.filter((e) => e.posizione === 1)[0];
  const vincitore = primo ? (await db.prepare("SELECT nome FROM casate WHERE id=?").get(primo.casata_id))?.nome : null;
  await db.prepare("UPDATE contest SET stato='concluso', esito_assegnato=1, vincitore=? WHERE id=?").run(vincitore || null, contestId);
  audit("staff", "assegna_coppa", "contest", contestId, `${totale} punti \xB7 vince ${vincitore || "\u2014"}`);
  return { totale, vincitore, casate: esiti.length };
}
async function esitoCorrente(contestId) {
  const contest = await db.prepare("SELECT * FROM contest WHERE id=?").get(contestId);
  if (!contest) return null;
  const casate = await db.prepare("SELECT id,nome,colore FROM casate ORDER BY nome").all();
  const esiti = new Map((await db.prepare("SELECT * FROM contest_esiti WHERE contest_id=?").all(contestId)).map((e) => [e.casata_id, e]));
  return {
    contest,
    scala: scalaDi(contest),
    assegnato: !!contest.esito_assegnato,
    righe: casate.map((c) => {
      const e = esiti.get(c.id);
      return {
        casata_id: c.id,
        casata: c.nome,
        colore: c.colore,
        posizione: e?.posizione ?? null,
        pezzi_venduti: e?.pezzi_venduti ?? 0,
        punti: e?.punti ?? 0
      };
    })
  };
}

export { assegnaCoppa, esitoCorrente, salvaEsito };

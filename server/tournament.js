import { db } from './db.js';

var ORDINE_CASATE = ["Aretusa", "Ortigia", "Neapolis", "Dionisio", "Ciane", "Plemmirio", "Epipoli", "Anapo"];
async function casateByName() {
  const rows = await db.prepare("SELECT id,nome FROM casate").all();
  const m = {};
  rows.forEach((r) => m[r.nome] = r.id);
  return m;
}
function roundRobinRounds(teams) {
  const arr = teams.slice();
  if (arr.length % 2 === 1) arr.push(null);
  const n = arr.length;
  const fixed = arr[0];
  let rest = arr.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const line = [fixed, ...rest];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = line[i], b = line[n - 1 - i];
      if (a != null && b != null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  return rounds;
}
async function generaCalendario(disciplinaId) {
  const disc = await db.prepare("SELECT id FROM discipline WHERE id=?").get(disciplinaId);
  if (!disc) throw new Error("Disciplina inesistente");
  await db.prepare("DELETE FROM partite WHERE disciplina_id=?").run(disciplinaId);
  const oldGironi = await db.prepare("SELECT id FROM gironi WHERE disciplina_id=?").all(disciplinaId);
  for (const g of oldGironi) await db.prepare("DELETE FROM classifica WHERE girone_id=?").run(g.id);
  await db.prepare("DELETE FROM gironi WHERE disciplina_id=?").run(disciplinaId);
  const idByName = await casateByName();
  const nomi = [
    ...ORDINE_CASATE.filter((n) => idByName[n]),
    ...Object.keys(idByName).filter((n) => !ORDINE_CASATE.includes(n))
  ];
  const off = nomi.length ? ((disciplinaId - 1) % nomi.length + nomi.length) % nomi.length : 0;
  const rot = nomi.slice(off).concat(nomi.slice(0, off));
  const gA = rot.filter((_, i) => i % 2 === 0).slice(0, 4);
  const gB = rot.filter((_, i) => i % 2 === 1).slice(0, 4);
  const insGir = db.prepare("INSERT INTO gironi (disciplina_id,nome) VALUES (?,?)");
  const insCla = db.prepare("INSERT INTO classifica (girone_id,casata_id) VALUES (?,?)");
  const insPar = db.prepare(`INSERT INTO partite (disciplina_id,girone_id,fase,giornata,casata_a_id,casata_b_id,casa_a,casa_b,stato)
    VALUES (?,?,?,?,?,?,?,?, 'da_giocare')`);
  for (const [nome, sq] of [["Girone A", gA], ["Girone B", gB]]) {
    if (!sq.length) continue;
    const gid = (await insGir.run(disciplinaId, nome)).lastInsertRowid;
    for (const n of sq) await insCla.run(gid, idByName[n]);
    const giornate = roundRobinRounds(sq);
    for (let ri = 0; ri < giornate.length; ri++) {
      for (const [a, b] of giornate[ri]) await insPar.run(disciplinaId, gid, "girone", ri + 1, idByName[a], idByName[b], a, b);
    }
  }
  await db.prepare("UPDATE discipline SET stato='in_corso' WHERE id=?").run(disciplinaId);
  return getTabellone(disciplinaId);
}
async function classificaCombinata(disciplinaId) {
  return await db.prepare(`SELECT ca.nome, ca.colore, c.pt, c.v, c.p, c.pg, c.gf, c.gs
    FROM classifica c JOIN casate ca ON ca.id=c.casata_id JOIN gironi g ON g.id=c.girone_id
    WHERE g.disciplina_id=? ORDER BY c.pt DESC, (c.gf-c.gs) DESC, c.gf DESC, ca.nome`).all(disciplinaId);
}
async function archiviaEdizione(disciplinaId) {
  const d = await db.prepare("SELECT id,nome,dominio,data_inizio,data_fine FROM discipline WHERE id=?").get(disciplinaId);
  if (!d) throw new Error("Disciplina inesistente");
  const cl = await classificaCombinata(disciplinaId);
  const vincitore = cl[0]?.nome || null;
  // I punti Coppa vanno congelati ORA: subito dopo si cancellano partite e gironi
  // e graduatoriaFinale() non potrebbe piu' ricostruirli.
  const grad = await graduatoriaFinale(disciplinaId).catch(() => null);
  const puntiCoppa = grad ? JSON.stringify(grad.map((r) => ({ casata_id: r.id, nome: r.nome, posizione: r.posizione, punti: r.punti }))) : null;
  await db.prepare("INSERT INTO edizioni (disciplina_id,disciplina_nome,dominio,data_inizio,data_fine,vincitore,classifica,punti_coppa) VALUES (?,?,?,?,?,?,?,?)").run(d.id, d.nome, d.dominio, d.data_inizio || null, d.data_fine || null, vincitore, JSON.stringify(cl), puntiCoppa);
  await db.prepare("DELETE FROM partite WHERE disciplina_id=?").run(disciplinaId);
  const g = await db.prepare("SELECT id FROM gironi WHERE disciplina_id=?").all(disciplinaId);
  for (const x of g) await db.prepare("DELETE FROM classifica WHERE girone_id=?").run(x.id);
  await db.prepare("DELETE FROM gironi WHERE disciplina_id=?").run(disciplinaId);
  await db.prepare("UPDATE discipline SET stato='preparazione' WHERE id=?").run(disciplinaId);
  return { vincitore, casate: cl.length };
}
async function recomputeGirone(gironeId) {
  const disc = await db.prepare(`SELECT d.punti_vitt pv, d.punti_par pp FROM gironi g JOIN discipline d ON d.id=g.disciplina_id WHERE g.id=?`).get(gironeId);
  const rows = await db.prepare("SELECT casata_id FROM classifica WHERE girone_id=?").all(gironeId);
  const st = {};
  rows.forEach((r) => st[r.casata_id] = { pg: 0, v: 0, p: 0, gf: 0, gs: 0, pt: 0 });
  const partite = await db.prepare("SELECT * FROM partite WHERE girone_id=? AND stato='giocata'").all(gironeId);
  for (const m of partite) {
    const A = st[m.casata_a_id], B = st[m.casata_b_id];
    if (!A || !B) continue;
    A.pg++;
    B.pg++;
    A.gf += m.gol_a;
    A.gs += m.gol_b;
    B.gf += m.gol_b;
    B.gs += m.gol_a;
    if (m.gol_a > m.gol_b) {
      A.v++;
      A.pt += disc.pv;
    } else if (m.gol_a < m.gol_b) {
      B.v++;
      B.pt += disc.pv;
    } else {
      A.p++;
      B.p++;
      A.pt += disc.pp;
      B.pt += disc.pp;
    }
  }
  const upd = db.prepare("UPDATE classifica SET pg=?,v=?,p=?,gf=?,gs=?,pt=? WHERE girone_id=? AND casata_id=?");
  for (const cid of Object.keys(st)) {
    const s = st[cid];
    await upd.run(s.pg, s.v, s.p, s.gf, s.gs, s.pt, gironeId, cid);
  }
}
async function registraRisultato(partitaId, golA, golB) {
  const m = await db.prepare("SELECT * FROM partite WHERE id=?").get(partitaId);
  if (!m) throw new Error("Partita inesistente");
  await db.prepare("UPDATE partite SET gol_a=?,gol_b=?,punteggio=?,stato='giocata' WHERE id=?").run(golA, golB, `${golA}\u2013${golB}`, partitaId);
  if (m.girone_id) await recomputeGirone(m.girone_id);
  await avanzaFaseFinale(m.disciplina_id);
  return true;
}
var COPPA_PUNTI = { 1: 12, 2: 10, 3: 8, 4: 6, altri: 4 };
var vincitrice = (m) => m.gol_a == null || m.gol_b == null || m.gol_a === m.gol_b ? null : m.gol_a > m.gol_b ? { id: m.casata_a_id, nome: m.casa_a } : { id: m.casata_b_id, nome: m.casa_b };
var perdente = (m) => m.gol_a == null || m.gol_b == null || m.gol_a === m.gol_b ? null : m.gol_a > m.gol_b ? { id: m.casata_b_id, nome: m.casa_b } : { id: m.casata_a_id, nome: m.casa_a };
async function faseMatches(disciplinaId, fase) {
  return db.prepare("SELECT * FROM partite WHERE disciplina_id=? AND fase=? ORDER BY giornata,id").all(disciplinaId, fase);
}
async function insFinale(disciplinaId, fase, slot, a, b) {
  await db.prepare(`INSERT INTO partite (disciplina_id,girone_id,fase,giornata,casata_a_id,casata_b_id,casa_a,casa_b,stato)
    VALUES (?,?,?,?,?,?,?,?, 'da_giocare')`).run(disciplinaId, null, fase, slot, a.id, b.id, a.nome, b.nome);
}
async function avanzaFaseFinale(disciplinaId) {
  const gironi = await db.prepare("SELECT id FROM gironi WHERE disciplina_id=? ORDER BY nome").all(disciplinaId);
  if (gironi.length !== 2) return;
  const gironiCompleti = (await db.prepare("SELECT count(*) n FROM partite WHERE disciplina_id=? AND fase='girone' AND stato!='giocata'").get(disciplinaId)).n === 0 && (await db.prepare("SELECT count(*) n FROM partite WHERE disciplina_id=? AND fase='girone'").get(disciplinaId)).n > 0;
  if (!gironiCompleti) return;
  if (!(await faseMatches(disciplinaId, "quarti")).length) {
    const A = await classificaOrdinata(gironi[0].id), B = await classificaOrdinata(gironi[1].id);
    if (A.length >= 4 && B.length >= 4) {
      const coppie = [[A[0], B[3]], [A[1], B[2]], [A[2], B[1]], [A[3], B[0]]];
      for (let i = 0; i < 4; i++) await insFinale(disciplinaId, "quarti", i + 1, { id: coppie[i][0].casata_id, nome: coppie[i][0].nome }, { id: coppie[i][1].casata_id, nome: coppie[i][1].nome });
    }
    return;
  }
  const quarti = await faseMatches(disciplinaId, "quarti");
  const quartiOk = quarti.length === 4 && quarti.every((m) => vincitrice(m));
  if (quartiOk && !(await faseMatches(disciplinaId, "semifinale")).length) {
    const w = quarti.map(vincitrice);
    await insFinale(disciplinaId, "semifinale", 1, w[0], w[3]);
    await insFinale(disciplinaId, "semifinale", 2, w[1], w[2]);
    return;
  }
  const semi = await faseMatches(disciplinaId, "semifinale");
  const semiOk = semi.length === 2 && semi.every((m) => vincitrice(m));
  if (semiOk && !(await faseMatches(disciplinaId, "finale1")).length) {
    await insFinale(disciplinaId, "finale1", 1, vincitrice(semi[0]), vincitrice(semi[1]));
    await insFinale(disciplinaId, "finale3", 1, perdente(semi[0]), perdente(semi[1]));
  }
}
async function graduatoriaFinale(disciplinaId) {
  const f1 = (await faseMatches(disciplinaId, "finale1"))[0];
  const f3 = (await faseMatches(disciplinaId, "finale3"))[0];
  if (!f1 || !vincitrice(f1) || !f3 || !vincitrice(f3)) return null;
  const quarti = await faseMatches(disciplinaId, "quarti");
  const eliminatiQuarti = quarti.map(perdente).filter(Boolean);
  const out = [
    { posizione: 1, punti: COPPA_PUNTI[1], ...vincitrice(f1) },
    { posizione: 2, punti: COPPA_PUNTI[2], ...perdente(f1) },
    { posizione: 3, punti: COPPA_PUNTI[3], ...vincitrice(f3) },
    { posizione: 4, punti: COPPA_PUNTI[4], ...perdente(f3) }
  ];
  eliminatiQuarti.forEach((e, i) => out.push({ posizione: 5 + i, punti: COPPA_PUNTI.altri, ...e }));
  return out;
}
async function classificaOrdinata(gironeId) {
  return await db.prepare(`SELECT c.*, ca.nome, ca.colore FROM classifica c JOIN casate ca ON ca.id=c.casata_id
    WHERE c.girone_id=? ORDER BY c.pt DESC, (c.gf-c.gs) DESC, c.gf DESC, ca.nome`).all(gironeId);
}

// Struttura della fase finale, disegnabile ANCHE prima che si sblocchi: ogni casella dice da
// dove arrivera' la casata (1ª del girone A, vincente del quarto 2...) e, se la classifica
// esiste gia', chi la occuperebbe oggi. Cosi' si vede subito dove si e' diretti.
async function strutturaFinale(disciplinaId) {
  const gironi = await db.prepare("SELECT id,nome FROM gironi WHERE disciplina_id=? ORDER BY nome").all(disciplinaId);
  if (gironi.length !== 2) return null;
  const cls = [await classificaOrdinata(gironi[0].id), await classificaOrdinata(gironi[1].id)];
  const lettera = ["A", "B"];
  // provvisorio: chi sta in quella posizione adesso (null se il girone non e' ancora popolato)
  const daGirone = (gi, pos) => {
    const r = cls[gi][pos];
    return { etichetta: `${pos + 1}\u00ba ${gironi[gi].nome || "Girone " + lettera[gi]}`, provvisorio: r ? r.nome : null };
  };
  const giocata = async (fase, slot) => {
    const m = (await faseMatches(disciplinaId, fase)).find((x) => x.giornata === slot);
    return m || null;
  };
  const daVincente = async (fase, slot, testo) => {
    const m = await giocata(fase, slot);
    const w = m ? vincitrice(m) : null;
    return { etichetta: testo, provvisorio: w ? w.nome : null };
  };
  const daPerdente = async (fase, slot, testo) => {
    const m = await giocata(fase, slot);
    const l = m ? perdente(m) : null;
    return { etichetta: testo, provvisorio: l ? l.nome : null };
  };

  const quarti = [
    { slot: 1, a: daGirone(0, 0), b: daGirone(1, 3) },
    { slot: 2, a: daGirone(0, 1), b: daGirone(1, 2) },
    { slot: 3, a: daGirone(0, 2), b: daGirone(1, 1) },
    { slot: 4, a: daGirone(0, 3), b: daGirone(1, 0) }
  ];
  for (const q of quarti) q.partita = await giocata("quarti", q.slot);

  const semifinali = [
    { slot: 1, a: await daVincente("quarti", 1, "Vincente quarto 1"), b: await daVincente("quarti", 4, "Vincente quarto 4") },
    { slot: 2, a: await daVincente("quarti", 2, "Vincente quarto 2"), b: await daVincente("quarti", 3, "Vincente quarto 3") }
  ];
  for (const s2 of semifinali) s2.partita = await giocata("semifinale", s2.slot);

  const finale1 = { slot: 1, a: await daVincente("semifinale", 1, "Vincente semifinale 1"), b: await daVincente("semifinale", 2, "Vincente semifinale 2"), partita: await giocata("finale1", 1) };
  const finale3 = { slot: 1, a: await daPerdente("semifinale", 1, "Perdente semifinale 1"), b: await daPerdente("semifinale", 2, "Perdente semifinale 2"), partita: await giocata("finale3", 1) };
  return { quarti, semifinali, finale1, finale3 };
}

async function getTabellone(disciplinaId) {
  await avanzaFaseFinale(disciplinaId);
  const gironiRows = await db.prepare("SELECT id,nome FROM gironi WHERE disciplina_id=? ORDER BY nome").all(disciplinaId);
  const gironi = [];
  for (const g of gironiRows) {
    gironi.push({
      id: g.id,
      nome: g.nome,
      classifica: await classificaOrdinata(g.id),
      partite: await db.prepare("SELECT id,giornata,casa_a,casa_b,gol_a,gol_b,stato,quando,luogo FROM partite WHERE girone_id=? ORDER BY giornata,id").all(g.id)
    });
  }
  const nGir = (await db.prepare("SELECT count(*) n FROM partite WHERE disciplina_id=? AND fase='girone'").get(disciplinaId)).n;
  const tuttiGiocati = nGir > 0 && (await db.prepare("SELECT count(*) n FROM partite WHERE disciplina_id=? AND fase='girone' AND stato!='giocata'").get(disciplinaId)).n === 0;
  const selFase = (fase) => db.prepare("SELECT id,giornata,casa_a,casa_b,gol_a,gol_b,stato,fase,quando,luogo FROM partite WHERE disciplina_id=? AND fase=? ORDER BY giornata,id").all(disciplinaId, fase);
  const fasi = {
    quarti: await selFase("quarti"),
    semifinali: await selFase("semifinale"),
    finale3: await selFase("finale3"),
    finale1: await selFase("finale1")
  };
  const hasFinale = fasi.quarti.length > 0;
  const graduatoria = await graduatoriaFinale(disciplinaId);
  const struttura = await strutturaFinale(disciplinaId);
  return { gironi, fasi, hasFinale, struttura, graduatoria, completo: tuttiGiocati };
}

export { archiviaEdizione, generaCalendario, getTabellone, graduatoriaFinale, registraRisultato, strutturaFinale, vincitrice };

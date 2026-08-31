// I numeri si leggono dal DATABASE della simulazione, non dai contatori dello script: se il
// sistema ha registrato qualcosa di diverso da quello che credevo di aver chiesto, voglio
// saperlo adesso e non in stagione.
import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync } from 'node:fs';

const out = {};
for (const s of ['contingency', 'normale', 'ottimale']) {
  const db = createClient({ url: 'file:/home/claude/simdb/' + s + '.db' });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  const uno = async (sql, args = []) => (await q(sql, args))[0] || {};

  const inc = await uno("SELECT COUNT(*) n, COALESCE(SUM(totale),0) tot FROM comande WHERE stato='chiusa'");
  const perZona = await q("SELECT zona, COUNT(*) n, COALESCE(SUM(totale),0) tot FROM comande WHERE stato='chiusa' GROUP BY zona");
  const perMetodo = await q("SELECT metodo_pagamento m, COUNT(*) n, COALESCE(SUM(totale),0) tot FROM comande WHERE stato='chiusa' GROUP BY metodo_pagamento");
  const righe = await uno("SELECT COUNT(*) n, COALESCE(SUM(prezzo*qta),0) v FROM comanda_righe WHERE stato<>'stornata'");
  const stornate = await uno("SELECT COUNT(*) n, COALESCE(SUM(prezzo*qta),0) v FROM comanda_righe WHERE stato='stornata'");
  const nonServ = await uno("SELECT COUNT(*) n, COALESCE(SUM(prezzo*qta),0) v FROM comanda_righe WHERE stato='non_servita'");
  const topProdotti = await q(`SELECT nome, SUM(qta) q, SUM(prezzo*qta) v FROM comanda_righe
     WHERE stato NOT IN ('stornata') AND prezzo>0 GROUP BY nome ORDER BY v DESC LIMIT 8`);
  const mov = await q("SELECT tipo, COUNT(*) n, COALESCE(SUM(quantita),0) q FROM magazzino_movimenti GROUP BY tipo");
  const giacenze = await q("SELECT nome, giacenza, punto_riordino FROM magazzino_articoli ORDER BY giacenza ASC LIMIT 5");
  const prenT = await uno("SELECT COUNT(*) n, COALESCE(SUM(persone),0) p FROM prenotazioni_tavolo WHERE stato='prenotato'");
  const prenAnn = await uno("SELECT COUNT(*) n FROM prenotazioni_tavolo WHERE stato='annullato'");
  const campi = await uno("SELECT COUNT(*) n FROM prenotazioni_campo WHERE stato='prenotato'");
  const registro = await q("SELECT fatto, COUNT(*) n FROM registro_storico GROUP BY fatto ORDER BY n DESC");
  const giorniServizio = await uno("SELECT COUNT(DISTINCT date(created_at)) n FROM comande");
  const puntaGiorno = await q(`SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(totale),0) tot
     FROM comande WHERE stato='chiusa' GROUP BY date(created_at) ORDER BY tot DESC LIMIT 3`);

  out[s] = {
    scenario: JSON.parse(readFileSync('/home/claude/sim/' + s + '.json', 'utf8')),
    db: {
      comandeChiuse: Number(inc.n), incasso: Number(inc.tot),
      perZona: perZona.map((r) => ({ zona: r.zona, n: Number(r.n), tot: Number(r.tot) })),
      perMetodo: perMetodo.map((r) => ({ metodo: r.m, n: Number(r.n), tot: Number(r.tot) })),
      righeVendute: Number(righe.n), valoreRighe: Number(righe.v),
      stornate: { n: Number(stornate.n), v: Number(stornate.v) },
      nonServite: { n: Number(nonServ.n), v: Number(nonServ.v) },
      topProdotti: topProdotti.map((r) => ({ nome: r.nome, q: Number(r.q), v: Number(r.v) })),
      movimenti: mov.map((r) => ({ tipo: r.tipo, n: Number(r.n), q: Number(r.q) })),
      giacenzeBasse: giacenze.map((r) => ({ nome: r.nome, giacenza: Number(r.giacenza), riordino: Number(r.punto_riordino) })),
      prenotazioniTavolo: Number(prenT.n), copertiPrenotati: Number(prenT.p), prenotazioniAnnullate: Number(prenAnn.n),
      prenotazioniCampo: Number(campi),
      registro: registro.map((r) => ({ fatto: r.fatto, n: Number(r.n) })),
      giorniServizio: Number(giorniServizio.n),
      giorniMigliori: puntaGiorno.map((r) => ({ data: r.d, comande: Number(r.n), incasso: Number(r.tot) }))
    }
  };
}
writeFileSync('/home/claude/sim/estratto.json', JSON.stringify(out, null, 1));
for (const [s, v] of Object.entries(out)) {
  console.log(`\n### ${s}`);
  console.log(' incasso da DB      :', v.db.incasso.toFixed(2), '· comande chiuse', v.db.comandeChiuse, '· giorni', v.db.giorniServizio);
  console.log(' per zona           :', v.db.perZona.map((z) => `${z.zona}: ${z.tot.toFixed(0)} (${z.n})`).join(' · '));
  console.log(' pagamenti          :', v.db.perMetodo.map((m) => `${m.metodo}: ${m.tot.toFixed(0)}`).join(' · '));
  console.log(' righe vendute      :', v.db.righeVendute, '· stornate', v.db.stornate.n, `(${v.db.stornate.v.toFixed(2)})`, '· non servite', v.db.nonServite.n, `(${v.db.nonServite.v.toFixed(2)})`);
  console.log(' primi prodotti     :', v.db.topProdotti.slice(0, 4).map((p) => `${p.nome} ${p.q}pz/${p.v.toFixed(0)}€`).join(' · '));
  console.log(' magazzino movimenti:', v.db.movimenti.map((m) => `${m.tipo}: ${m.n}`).join(' · '));
  console.log(' registro storico   :', v.db.registro.map((r) => `${r.fatto}: ${r.n}`).join(' · '));
  console.log(' giorno migliore    :', v.db.giorniMigliori[0] ? `${v.db.giorniMigliori[0].data} — ${v.db.giorniMigliori[0].incasso.toFixed(0)}€ su ${v.db.giorniMigliori[0].comande} comande` : '—');
}

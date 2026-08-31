// Lettura di una posizione da quello che l'operatore ha in mano: coordinate copiate, link di
// Google Maps, Waze, Apple Maps, OpenStreetMap. Sta sul server e non nel browser per una
// ragione precisa: i link CORTI (maps.app.goo.gl, goo.gl/maps, waze.com/ul/...) non contengono
// le coordinate, e vanno seguiti fino alla pagina vera. Il browser non puo' farlo (glielo
// impedisce la politica di sicurezza fra domini), il server si'.

// Gradi sessagesimali: 36°55'07.0"N 15°10'14.2"E — e' il formato che Google mostra a schermo.
function daGradi(testo) {
  const re = /(\d{1,3})[°\s]+(\d{1,2})['\u2032\s]+([\d.]+)["\u2033\s]*([NSEWOns])/g;
  const trovati = [];
  let m;
  while ((m = re.exec(testo)) !== null) {
    const val = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
    const dir = m[4].toUpperCase();
    trovati.push({ val: (dir === "S" || dir === "W" || dir === "O") ? -val : val, dir });
  }
  if (trovati.length < 2) return null;
  const lat = trovati.find((t) => "NS".includes(t.dir)) || trovati[0];
  const lng = trovati.find((t) => "EWO".includes(t.dir)) || trovati[1];
  return { lat: lat.val, lng: lng.val };
}

// Un SOLO valore: "37.0596", "37,0596" oppure il grado singolo 37\u00b003'34.6"N.
// Serve perche' i due campi Lat e Lng sono separati, e chi copia dalla barra di Google
// incolla il grado in ciascuno: senza questa conversione restava li' come testo.
function leggiSingola(input, asse) {
  if (input == null || String(input).trim() === "") return null;
  const t = String(input).trim();
  const g = t.match(/^(\d{1,3})\s*[\u00b0]\s*(\d{1,2})?\s*['\u2032]?\s*([\d.,]+)?\s*["\u2033]?\s*([NSEWOnsewo])?$/);
  if (g) {
    const val = Number(g[1]) + Number(g[2] || 0) / 60 + Number(String(g[3] || 0).replace(",", ".")) / 3600;
    const dir = (g[4] || "").toUpperCase();
    const segno = (dir === "S" || dir === "W" || dir === "O") ? -1 : 1;
    return Number.isFinite(val) ? Number((val * segno).toFixed(6)) : null;
  }
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (asse === "lat" && Math.abs(n) > 90) return null;
  if (asse === "lng" && Math.abs(n) > 180) return null;
  return n;
}

function valida(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

// Legge le coordinate da un testo. Non fa rete: e' la parte pura.
function leggiCoordinate(input) {
  if (!input) return null;
  const grezzo = String(input).trim();
  // %2C e simili: senza decodifica i link di Waze non si leggono.
  let s = grezzo;
  try { s = decodeURIComponent(grezzo); } catch (_) { }

  const gradi = daGradi(s);
  if (gradi) return valida(gradi.lat, gradi.lng);

  // Virgola come separatore decimale all'italiana ("36,91861 15,17062"): due numeri separati
  // da spazio. Va riconosciuto PRIMA della coppia con la virgola, altrimenti "36,91861" viene
  // letto come due coordinate diverse — ed e' un errore silenzioso, il peggiore.
  const ita = s.match(/^\s*(-?\d{1,3},\d+)\s+(-?\d{1,3},\d+)\s*$/);
  if (ita) return valida(parseFloat(ita[1].replace(",", ".")), parseFloat(ita[2].replace(",", ".")));

  const schemi = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,                       // Google: /@lat,lng,17z
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,                      // Google: link lungo
    /[?&](?:q|ll|daddr|saddr|query|sll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,  // Apple, Google
    /\bll[.=](-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,                // Waze: to=ll.lat,lng
    /[?&]latlng=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    // Il segnaposto va letto PRIMA della vista: #map= contiene il centro della mappa, che e'
    // arrotondato, mentre mlat/mlon sono il punto esatto.
    /[?&]mlat=(-?\d+(?:\.\d+)?)[^]*?[?&]mlon=(-?\d+(?:\.\d+)?)/,     // OSM segnaposto
    /#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/,                // OpenStreetMap, vista
    /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,  // "lat, lng" e basta
    /(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)/                     // coppia dentro un testo
  ];
  for (const re of schemi) {
    const m = s.match(re);
    if (m) {
      const r = valida(parseFloat(m[1]), parseFloat(m[2]));
      if (r) return r;
    }
  }
  return null;
}

// Google Maps sa produrre il codice della mappa: Condividi → Incorpora una mappa → copia HTML.
// Quel codice contiene esattamente l'inquadratura scelta, quindi conviene tenerlo. Non si
// memorizza pero' l'HTML cosi' com'e' — sarebbe codice altrui dentro la nostra pagina: si
// estrae il solo indirizzo dell'iframe e si verifica che sia davvero di Google.
function leggiEmbed(input) {
  const testo = String(input || "").trim();
  if (!testo) return null;
  const m = testo.match(/src\s*=\s*["']([^"']+)["']/i);
  const url = (m ? m[1] : testo).trim();
  if (!/^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed\?/i.test(url)) return null;
  // Dentro il parametro pb ci sono anche le coordinate del centro (!2d = longitudine,
  // !3d = latitudine): servono per il tasto "Portami li'".
  const lng = url.match(/!2d(-?\d+(?:\.\d+)?)/);
  const lat = url.match(/!3d(-?\d+(?:\.\d+)?)/);
  return {
    src: url,
    lat: lat ? Number(Number(lat[1]).toFixed(6)) : null,
    lng: lng ? Number(Number(lng[1]).toFixed(6)) : null
  };
}

const ACCORCIATORI = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+\/\?cid|waze\.com\/ul|ul\.waze\.com|osm\.org\/go)/i;

// Legge le coordinate seguendo, se serve, un link accorciato fino alla pagina vera.
async function risolviPosizione(input) {
  const diretto = leggiCoordinate(input);
  if (diretto) return { ...diretto, origine: "testo" };

  const s = String(input || "").trim();
  if (!/^https?:\/\//i.test(s)) return { errore: "Non riesco a leggere una posizione da questo testo." };

  try {
    const r = await fetch(s, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BussolaResidence/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    // Le coordinate stanno quasi sempre nell'indirizzo finale dopo i rimbalzi.
    const daUrl = leggiCoordinate(r.url);
    if (daUrl) return { ...daUrl, origine: "link risolto", url: r.url };
    // Altrimenti si cercano nella pagina.
    const html = (await r.text()).slice(0, 300000);
    const daPagina = leggiCoordinate(html);
    if (daPagina) return { ...daPagina, origine: "pagina", url: r.url };
    return { errore: "Il link si apre ma non contiene coordinate leggibili. Aprilo nel browser e copia le coordinate dalla barra dell'indirizzo.", url: r.url };
  } catch (e) {
    return { errore: `Non sono riuscito ad aprire il link (${String(e.message || e).slice(0, 60)}). Copia le coordinate a mano.` };
  }
}

export { ACCORCIATORI, leggiCoordinate, leggiEmbed, leggiSingola, risolviPosizione };

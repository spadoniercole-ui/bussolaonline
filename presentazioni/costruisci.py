#!/usr/bin/env python3
"""
Costruisce le presentazioni come UN SOLO FILE HTML ciascuna, con dentro tutto: stile, codice,
immagini e voce. Il motivo e' pratico: una presentazione va inviata per posta o via chat e deve
partire con un doppio clic sul telefono di chi la riceve. Se dipende da una cartella di
immagini accanto, arriva vuota — ed e' esattamente quello che succedeva.

Scelte:
· immagini e audio incorporati come data URI (base64): nessun file esterno, nessuna rete;
· la voce e' audio REGISTRATO, non sintetizzato dal browser: cosi' suona uguale per tutti e
  funziona anche su Safari e sui telefoni, dove la sintesi e' inaffidabile;
· resta una ricaduta sulla sintesi vocale se l'audio non partisse, e i sottotitoli sono sempre
  a schermo: la presentazione si segue anche in silenzio, in treno o in una sala rumorosa.
"""
import base64, hashlib, json, os, pathlib, re, subprocess, sys

BASE = pathlib.Path('/tmp/pres')
USCITA = pathlib.Path('/tmp/pres/dist')
USCITA.mkdir(exist_ok=True)

STILE = (BASE / 'stile.css').read_text()

EXTRA_CSS = """
/* Telefono: la presentazione si guarda in verticale, quindi immagine sopra e testo sotto,
   comandi grandi abbastanza da centrarli con il pollice. */
@media (max-width:900px){
  .top{padding:9px 14px}
  .top .titolo{display:none}
  .marchio{font-size:.85rem}
  .scena{display:block; padding:12px 16px 4px; overflow-y:auto; -webkit-overflow-scrolling:touch}
  .scena figure{margin-bottom:14px}
  /* L'immagine non deve mangiarsi la slide: titolo e punti devono restare leggibili
     senza scorrere, perche' su un telefono nessuno scorre una presentazione. */
  /* senza questo la figura eredita l'altezza piena del layout a due colonne e spinge
     titolo ed elenco fuori dallo schermo */
  .scena figure{height:auto; margin-bottom:10px}
  .scena figure.telefono img{max-height:30vh; border-width:5px; border-radius:14px}
  .scena figure.schermo img{max-height:26vh}
  .scena h2{font-size:1.22rem; margin-bottom:9px; line-height:1.2}
  .scena ul li{font-size:.86rem; margin:6px 0; padding-left:20px}
  .occhiello{font-size:.62rem; margin-bottom:6px}
  .numeri{gap:14px} .numeri div{min-width:88px}
  .numeri b{font-size:1.6rem}
  .cc{padding:0 12px 4px; min-height:0}
  .cc p{font-size:.82rem; padding:7px 11px; max-height:20vh; overflow:auto; line-height:1.42}
  .avviso{margin:0 12px 6px; font-size:.78rem}
  .pulsanti button{width:48px; height:48px}
  .pulsanti .play{width:60px; height:60px}
  .pallini{max-width:100%; justify-content:center; margin:10px 0 0; width:100%}
}
/* Schermata di avvio: serve un tocco dell'utente perche' i telefoni non fanno partire
   l'audio da soli. Meglio chiederlo in modo esplicito che sembrare rotti. */
.avvio{position:fixed; inset:0; background:rgba(9,22,36,.96); display:flex; align-items:center;
  justify-content:center; z-index:50; padding:24px}
.avvio .box{max-width:520px; text-align:center}
.avvio h1{font-family:Georgia,serif; font-weight:400; font-size:clamp(1.6rem,4vw,2.4rem); margin:0 0 10px}
.avvio p{color:#b9c9d6; line-height:1.55; margin:0 0 22px}
.avvio button{background:var(--oro); color:#22180a; border:0; border-radius:999px;
  padding:15px 34px; font-size:1.05rem; font-weight:700; cursor:pointer}
.avvio .muto{background:transparent; color:#b9c9d6; border:1px solid var(--linea); margin-top:12px;
  font-weight:400; font-size:.9rem; padding:11px 22px}
"""

MOTORE = r"""
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  window.Presentazione = function (config) {
    var slides = config.slides;
    var i = 0, inRiproduzione = false, muto = false, timer = null;
    var audio = new Audio();
    audio.preload = 'none';

    // Ricaduta: se per qualunque ragione la traccia non parte, si prova la sintesi del
    // browser; se manca anche quella, la slide avanza a tempo. In nessun caso ci si blocca.
    function parla(s, fine) {
      if (muto) { timer = setTimeout(fine, Math.max(3500, s.voce.length * 48)); return; }
      if (s.audio) {
        audio.src = s.audio;
        audio.onended = fine;
        audio.onerror = function () { sintesi(s, fine); };
        var p = audio.play();
        if (p && p.catch) p.catch(function () { sintesi(s, fine); });
        return;
      }
      sintesi(s, fine);
    }
    function sintesi(s, fine) {
      if (!window.speechSynthesis) { timer = setTimeout(fine, Math.max(3500, s.voce.length * 48)); return; }
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(s.voce);
        u.lang = 'it-IT'; u.rate = 0.98;
        var voci = speechSynthesis.getVoices().filter(function (v) { return /^it/i.test(v.lang); });
        var f = voci.filter(function (v) { return /alice|elsa|federica|paola|female|donna/i.test(v.name); })[0];
        if (f || voci[0]) u.voice = f || voci[0];
        u.onend = fine;
        speechSynthesis.speak(u);
      } catch (e) { timer = setTimeout(fine, Math.max(3500, s.voce.length * 48)); }
    }
    function zitto() {
      clearTimeout(timer);
      try { audio.pause(); audio.currentTime = 0; } catch (e) {}
      if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
    }

    function disegna() {
      var s = slides[i];
      var scena = $('#scena');
      scena.className = 'scena ' + (s.tipo || 'immagine');
      var testo = '<div class="testo' + (s.img ? '' : ' grande') + '">'
        + '<div class="occhiello">' + (s.occhiello || '') + '</div><h2>' + s.titolo + '</h2>'
        + (s.punti ? '<ul>' + s.punti.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' : '')
        + (s.numeri ? '<div class="numeri">' + s.numeri.map(function (n) { return '<div><b>' + n[0] + '</b><span>' + n[1] + '</span></div>'; }).join('') + '</div>' : '')
        + '</div>';
      scena.innerHTML = (s.img ? '<figure class="' + (s.taglio || 'telefono') + '"><img src="' + s.img + '" alt=""></figure>' : '') + testo;
      $('#sottotitolo').textContent = s.voce;
      $('#indice').textContent = (i + 1) + ' / ' + slides.length;
      $('#barra').style.width = (i / (slides.length - 1) * 100) + '%';
      var pal = document.querySelectorAll('.pallino');
      for (var k = 0; k < pal.length; k++) pal[k].classList.toggle('on', k === i);
      scena.scrollTop = 0;
    }

    function riproduci() {
      inRiproduzione = true;
      $('#playBtn').textContent = '⏸';
      disegna();
      parla(slides[i], function () {
        if (!inRiproduzione) return;
        timer = setTimeout(function () {
          if (i < slides.length - 1) { i++; riproduci(); } else ferma(true);
        }, 600);
      });
    }
    function ferma(fine) {
      inRiproduzione = false; zitto();
      $('#playBtn').textContent = fine ? '↻' : '▶';
      if (fine) i = 0;
    }
    function vai(n) {
      zitto();
      i = Math.max(0, Math.min(slides.length - 1, n));
      if (inRiproduzione) riproduci(); else disegna();
    }

    document.body.insertAdjacentHTML('afterbegin',
      '<div class="wrap">'
      + '<header class="top"><div class="marchio"><span class="bussola">✦</span> <b>BUSSOLA</b> <span class="sub">RESIDENCE</span></div>'
      + '<div class="titolo">' + config.titolo + '</div><div class="indice" id="indice"></div></header>'
      + '<main class="scena" id="scena"></main>'
      + '<div class="cc"><p id="sottotitolo"></p></div>'
      + '<footer class="comandi"><div class="progresso"><span id="barra"></span></div>'
      + '<div class="pulsanti"><button id="prevBtn" aria-label="Precedente">⟨</button>'
      + '<button id="playBtn" class="play" aria-label="Riproduci">▶</button>'
      + '<button id="nextBtn" aria-label="Successiva">⟩</button>'
      + '<button id="mutoBtn" aria-label="Silenzia">🔊</button>'
      + '<div class="pallini">' + slides.map(function (_, k) { return '<button class="pallino" data-k="' + k + '" aria-label="Slide ' + (k + 1) + '"></button>'; }).join('') + '</div>'
      + '</div></footer></div>'
      + '<div class="avvio" id="avvio"><div class="box"><h1>' + config.titolo0 + '</h1>'
      + '<p>' + config.intro + '</p>'
      + '<button id="avviaBtn">▶ Avvia la presentazione</button><br>'
      + '<button id="avviaMuto" class="muto">Guarda senza audio</button></div></div>');

    $('#playBtn').onclick = function () { inRiproduzione ? ferma(false) : riproduci(); };
    $('#prevBtn').onclick = function () { vai(i - 1); };
    $('#nextBtn').onclick = function () { vai(i + 1); };
    $('#mutoBtn').onclick = function () {
      muto = !muto;
      $('#mutoBtn').textContent = muto ? '🔇' : '🔊';
      if (inRiproduzione) riproduci();
    };
    var pal = document.querySelectorAll('.pallino');
    for (var k = 0; k < pal.length; k++) (function (b) { b.onclick = function () { vai(Number(b.dataset.k)); }; })(pal[k]);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') vai(i + 1);
      else if (e.key === 'ArrowLeft') vai(i - 1);
      else if (e.key === ' ') { e.preventDefault(); $('#playBtn').click(); }
    });

    // L'avvio passa da un tocco: e' quello che sblocca l'audio sui telefoni.
    $('#avviaBtn').onclick = function () { $('#avvio').remove(); riproduci(); };
    $('#avviaMuto').onclick = function () {
      muto = true; $('#mutoBtn').textContent = '🔇';
      $('#avvio').remove(); riproduci();
    };
    disegna();
  };
})();
"""

def rigenera_voce(nome, slides):
    """Registra la voce solo per le slide il cui testo e' cambiato.

    Il confronto e' su un'impronta del testo salvata accanto al file audio: se il testo non
    e' cambiato la traccia non si rifa'. Cosi' correggere una frase costa pochi secondi
    invece di rigenerare tutta la presentazione."""
    cartella = BASE / 'audio'
    cartella.mkdir(exist_ok=True)
    impronte_file = cartella / (nome + '.impronte.json')
    impronte = json.loads(impronte_file.read_text()) if impronte_file.exists() else {}
    nuove, rifatte = dict(impronte), 0
    for k, s in enumerate(slides):
        testo = re.sub(r'\s+', ' ', s['voce']).strip()
        chiave = '%02d' % k
        impronta = hashlib.sha1(testo.encode('utf-8')).hexdigest()[:16]
        mp3 = cartella / ('%s-%02d.mp3' % (nome, k))
        if mp3.exists() and impronte.get(chiave) == impronta:
            continue
        try:
            from gtts import gTTS
            grezzo = str(mp3) + '.raw.mp3'
            gTTS(testo, lang='it', tld='it').save(grezzo)
            # ricompressione: 28 kbps mono bastano per il parlato e alleggeriscono molto il file
            try:
                import imageio_ffmpeg
                ff = imageio_ffmpeg.get_ffmpeg_exe()
                r = subprocess.run([ff, '-y', '-loglevel', 'error', '-i', grezzo,
                                    '-ac', '1', '-ar', '22050', '-b:a', '28k', str(mp3)],
                                   capture_output=True)
                if r.returncode != 0 or not mp3.exists():
                    os.replace(grezzo, mp3)
                elif os.path.exists(grezzo):
                    os.remove(grezzo)
            except Exception:
                os.replace(grezzo, mp3)
            nuove[chiave] = impronta
            rifatte += 1
        except Exception as e:
            print('   ⚠ voce slide %d non registrata (%s): resta quella di prima' % (k + 1, e))
    impronte_file.write_text(json.dumps(nuove))
    if rifatte:
        print('   voce rigenerata per %d slide' % rifatte)
    return rifatte


def dataurl(percorso, mime):
    return 'data:' + mime + ';base64,' + base64.b64encode(pathlib.Path(percorso).read_bytes()).decode()

INTRO = {
    '1-soci': ('Il residence in tasca',
               'Una guida di sei minuti all’app della Bussola: cosa puoi prenotare, come funziona, e perché conviene. '
               'C’è una voce che ti accompagna — alza il volume, o scegli di guardarla in silenzio: i testi restano a schermo.'),
    '2-crew': ('Bussola Crew',
               'Otto minuti sull’app del servizio: comande dal tavolo, pianta della sala, campi, fitness, magazzino. '
               'Tutto quello che serve per lavorare dal primo giorno. Con voce, o in silenzio con i sottotitoli.'),
    '3-investitori': ('Bussola Residence',
                      'Dieci minuti sulla piattaforma: cosa fa, com’è costruita, quanto costa tenerla in esercizio e dove può andare. '
                      'Dati misurati, non stimati. Con commento parlato o in sola lettura.'),
}

TEMPLATE = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d2438">
<title>%(titolo_pagina)s</title>
<style>%(stile)s</style>
</head>
<body>
<script>%(motore)s</script>
<script>Presentazione(%(dati)s);</script>
</body>
</html>
"""

totale = 0
for nome in ['1-soci', '2-crew', '3-investitori']:
    dati = json.loads((BASE / (nome + '.json')).read_text(encoding='utf-8'))
    if '--senza-voce' not in sys.argv:
        rigenera_voce(nome, dati['slides'])
    for k, s in enumerate(dati['slides']):
        if s.get('img'):
            s['img'] = dataurl(BASE / s['img'], 'image/jpeg')
        a = BASE / 'audio' / ('%s-%02d.mp3' % (nome, k))
        if a.exists():
            s['audio'] = dataurl(a, 'audio/mpeg')
    t0, intro = INTRO[nome]
    dati['titolo0'] = t0
    dati['intro'] = intro
    html = TEMPLATE % {
        'titolo_pagina': 'Bussola Residence — ' + dati['titolo'],
        'stile': STILE + EXTRA_CSS,
        'motore': MOTORE,
        'dati': json.dumps(dati, ensure_ascii=False),
    }
    out = USCITA / ('Bussola-%s.html' % nome.split('-', 1)[1])
    out.write_text(html, encoding='utf-8')
    mb = out.stat().st_size / 1024 / 1024
    totale += mb
    print('%-34s %5.1f MB · %2d slide' % (out.name, mb, len(dati['slides'])))
print('%-34s %5.1f MB' % ('TOTALE', totale))

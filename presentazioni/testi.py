#!/usr/bin/env python3
"""
TESTI DELLE PRESENTAZIONI — esporta e reimporta

    python3 testi.py esporta     → crea TESTI-soci.txt, TESTI-crew.txt, TESTI-investitori.txt
    python3 testi.py importa     → rilegge i .txt e aggiorna i .json

I file .txt si aprono con qualunque editor (Blocco note, TextEdit) e sono fatti per essere
modificati a mano: una riga per campo, niente parentesi, niente virgole da rispettare.

La riga VOCE e' quella che la voce legge e che compare come sottotitolo: cambiando quella
cambiano entrambe le cose. Dopo l'importazione, `costruisci.py` rigenera l'audio SOLO delle
slide il cui testo e' cambiato — le altre restano quelle di prima, quindi la rigenerazione
dura pochi secondi invece di rifare tutto.
"""
import json, pathlib, re, sys

BASE = pathlib.Path(__file__).parent
DECK = {'1-soci': 'TESTI-soci.txt', '2-crew': 'TESTI-crew.txt', '3-investitori': 'TESTI-investitori.txt'}

INTESTAZIONE = """# ============================================================================
# {titolo}
# ----------------------------------------------------------------------------
# Modifica liberamente il testo dopo i due punti. Regole semplici:
#   · non cancellare le righe "### SLIDE n"
#   · VOCE:  e' cio' che la voce legge e che si vede come sottotitolo
#   · PUNTO: una riga per ogni elenco; puoi aggiungerne o togliere
#   · per il grassetto usa <b>cosi</b>
#   · le righe che iniziano con # sono note e vengono ignorate
# Quando hai finito, salva e rimanda il file.
# ============================================================================

"""


def esporta():
    for nome, out in DECK.items():
        d = json.loads((BASE / (nome + '.json')).read_text(encoding='utf-8'))
        righe = [INTESTAZIONE.format(titolo=d['titolo'].upper())]
        for i, s in enumerate(d['slides'], 1):
            righe.append('### SLIDE %d' % i)
            if s.get('occhiello'):
                righe.append('OCCHIELLO: ' + s['occhiello'])
            righe.append('TITOLO: ' + s['titolo'])
            for p in s.get('punti') or []:
                righe.append('PUNTO: ' + p)
            for n in s.get('numeri') or []:
                righe.append('NUMERO: %s | %s' % (n[0], n[1]))
            if s.get('img'):
                righe.append('# immagine: %s  (non modificare)' % s['img'])
            righe.append('VOCE: ' + re.sub(r'\s+', ' ', s['voce']).strip())
            righe.append('')
        (BASE / out).write_text('\n'.join(righe), encoding='utf-8')
        print('scritto %-26s %2d slide' % (out, len(d['slides'])))


def importa():
    for nome, src in DECK.items():
        f = BASE / src
        if not f.exists():
            print('salto %s (non trovato)' % src)
            continue
        d = json.loads((BASE / (nome + '.json')).read_text(encoding='utf-8'))
        blocchi = [b for b in re.split(r'^### SLIDE \d+\s*$', f.read_text(encoding='utf-8'), flags=re.M)[1:]]
        if len(blocchi) != len(d['slides']):
            print('⚠ %s: %d slide nel testo ma %d nella presentazione — non importo, controlla i "### SLIDE"'
                  % (src, len(blocchi), len(d['slides'])))
            continue
        cambi = 0
        for s, b in zip(d['slides'], blocchi):
            punti, numeri = [], []
            for riga in b.splitlines():
                riga = riga.strip()
                if not riga or riga.startswith('#'):
                    continue
                if riga.startswith('OCCHIELLO:'):
                    s['occhiello'] = riga[10:].strip()
                elif riga.startswith('TITOLO:'):
                    if s['titolo'] != riga[7:].strip():
                        cambi += 1
                    s['titolo'] = riga[7:].strip()
                elif riga.startswith('PUNTO:'):
                    punti.append(riga[6:].strip())
                elif riga.startswith('NUMERO:'):
                    a, _, bb = riga[7:].partition('|')
                    numeri.append([a.strip(), bb.strip()])
                elif riga.startswith('VOCE:'):
                    nuova = riga[5:].strip()
                    if s['voce'] != nuova:
                        cambi += 1
                    s['voce'] = nuova
            if punti:
                s['punti'] = punti
            elif 'punti' in s:
                del s['punti']
            if numeri:
                s['numeri'] = numeri
        (BASE / (nome + '.json')).write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
        print('aggiornato %-18s %d modifiche' % (nome + '.json', cambi))
    print('\nOra esegui:  python3 costruisci.py')
    print('(rigenera la voce solo per le slide cambiate, poi ricostruisce i file da inviare)')


if __name__ == '__main__':
    azione = sys.argv[1] if len(sys.argv) > 1 else ''
    if azione == 'esporta':
        esporta()
    elif azione == 'importa':
        importa()
    else:
        print(__doc__)

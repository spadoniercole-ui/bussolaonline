// Il contrasto si misura, non si valuta a occhio — e sotto il sole conta piu' di tutto il
// resto. Rapporto WCAG: 4.5 e' il minimo per il testo normale, 7 per leggere comodi. In pieno
// sole la soglia pratica sale: sotto 7 si fatica, sotto 4.5 non si legge.
const luce = (hex) => {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => {
    const x = parseInt(c.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const rapporto = (a, b) => {
  const [x, y] = [luce(a), luce(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const coppie = process.argv[2] === 'nuovo'
  ? [
    ['testo su carta', '#101418', '#FFFFFF'],
    ['testo tenue su carta', '#3c4a54', '#FFFFFF'],
    ['bianco su navy (azione)', '#FFFFFF', '#102A43'],
    ['bianco su rosso (avviso)', '#FFFFFF', '#9E2B20'],
    ['bordo su carta', '#101418', '#FFFFFF']
  ]
  : [
    ['testo su carta', '#17242c', '#F7F4EC'],
    ['tenue su carta', '#4a5a64', '#F7F4EC'],
    ['oro su carta (azione)', '#8a5a12', '#F7F4EC'],
    ['bianco su oro', '#FFFFFF', '#8a5a12'],
    ['bianco su navy', '#FFFFFF', '#12324F']
  ];
console.log(process.argv[2] === 'nuovo' ? '--- proposta ---' : '--- oggi ---');
for (const [nome, f, b] of coppie) {
  const r = rapporto(f, b);
  console.log(' ', nome.padEnd(26), r.toFixed(2), r >= 7 ? '✓ comodo anche al sole' : r >= 4.5 ? '~ leggibile, fatica al sole' : '✗ sotto la soglia');
}

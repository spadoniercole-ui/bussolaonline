// Build del bundle single-file per il deploy online (Render).
//   1. assembla i quattro front-end: <dir>/index.html + <!--#include ...--> -> build/*.html
//   2. esbuild bundla build/entry.mjs -> online/bussola.mjs (HTML caricati come testo)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => join(ROOT, ...p);

const FRONTENDS = [
  { dir: 'public', out: 'frontend.html' },
  { dir: 'admin', out: 'admin.html' },
  { dir: 'chiosco', out: 'chiosco.html' },
  { dir: 'ordina', out: 'ordina.html' },
];

mkdirSync(r('build'), { recursive: true });
for (const f of FRONTENDS) {
  const html = readFileSync(r(f.dir, 'index.html'), 'utf8').replace(
    /<!--#include ([\w./-]+)-->/g,
    (_, p) => readFileSync(r(p), 'utf8').replace(/\n$/, '')
  );
  writeFileSync(r('build', f.out), html);
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

mkdirSync(r('online'), { recursive: true });
await esbuild.build({
  entryPoints: [r('build/entry.mjs')],
  outfile: r('online/bussola.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  loader: { '.html': 'text' },
  define: { BUILD_TS: JSON.stringify(stamp) },
  legalComments: 'none',
});

console.log('bundle scritto in online/bussola.mjs · build', stamp);
console.log('Deploy: i 4 file di online/ vanno nella RADICE del repository, non in una sottocartella.');

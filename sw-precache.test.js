/* Guarda do service worker — rode com:  node sw-precache.test.js

   Dois erros que só aparecem SEM REDE (ou seja, na frente do operador):

   1. Arquivo novo que o painel PRECISA e que ficou fora do precache.
      Aconteceu com painel-calc.js: o painel.js passou a depender dele, mas ele
      não estava na lista — offline, `classify()` estouraria em toda chamada.

   2. Caminho no precache apontando pra arquivo que não existe mais (renomeado
      ou removido). O `cache.addAll` falha INTEIRO se um item 404, então um
      caminho podre derruba todo o cache offline, não só aquele arquivo.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');
let passed = 0;
const falhas = [];

/* caminhos '/painelpoker/xxx' listados no precache */
const precache = [...sw.matchAll(/'\/painelpoker\/([^']+)'/g)].map(m => m[1]);
const noPrecache = new Set(precache);

/* ── 1. todo caminho do precache existe no disco? ── */
console.log('\ncaminhos do precache existem?');
for (const rel of precache) {
  if (fs.existsSync(__dirname + '/' + rel)) { passed++; }
  else { falhas.push('precache aponta pra arquivo inexistente: ' + rel); console.log('  ✗ ' + rel); }
}
console.log('  ✓ ' + passed + ' de ' + precache.length + ' caminhos conferem');

/* ── 2. todo <script src> local do index.html está no precache? ──
   Se o painel carrega, ele precisa offline. */
console.log('\nscripts do index.html estão no precache?');
{
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1])
    .filter(s => !/^https?:|^\/\//.test(s));      // ignora CDN
  for (const s of srcs) {
    const rel = s.replace(/^\.?\//, '');
    if (noPrecache.has(rel)) { passed++; console.log('  ✓ ' + rel); }
    else { falhas.push('script carregado mas FORA do precache: ' + rel); console.log('  ✗ ' + rel + ' — fora do precache'); }
  }
}

/* ── 3. o <link rel=stylesheet> local também ── */
console.log('\nCSS do index.html está no precache?');
{
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1])
    .filter(s => !/^https?:|^\/\//.test(s));
  for (const h of hrefs) {
    const rel = h.replace(/^\.?\//, '');
    if (noPrecache.has(rel)) { passed++; console.log('  ✓ ' + rel); }
    else { falhas.push('CSS carregado mas FORA do precache: ' + rel); console.log('  ✗ ' + rel + ' — fora do precache'); }
  }
}

/* ── 4. SW_VERSION existe e é semver ──
   É o que invalida o cache das abas abertas. Sem bump, o operador continua com
   o CSS/JS antigo mesmo depois do deploy — HTML novo + CSS velho = layout quebrado. */
console.log('\nSW_VERSION:');
{
  const m = sw.match(/const SW_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
  assert.ok(m, 'SW_VERSION não encontrada ou fora do formato x.y.z');
  passed++; console.log('  ✓ ' + m[1] + ' (lembre: incremente a CADA mudança em arquivo precacheado)');
}

console.log(`\n${passed} verificações passaram.`);
if (falhas.length) {
  console.error('\n' + falhas.length + ' problema(s):');
  falhas.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

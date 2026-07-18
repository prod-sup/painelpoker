/* Tiles do hub — rode com:  node hub-tiles.test.js

   O BUG QUE ISTO TRAVA
   --------------------
   Os tiles com "céu próprio" no tema escuro usam
       linear-gradient(160deg, <cor escura>, var(--bg-raise) N%)
   No dark, --bg-raise é #111412 e o gradiente é sutil. No LIGHT, --bg-raise
   vira #ffffff — e sem uma regra `html.light` própria o mesmo gradiente vira
   um borrão de marrom-quase-preto para branco puro atravessado na diagonal.

   Foi o que aconteceu com a Suprema TV: ela tinha o gradiente escuro e ficou
   FORA da lista de overrides claros (GU e Learn tinham). O tile era o único
   que não era nem claro como os irmãos nem assumidamente escuro como A
   Constelação — e lia como sujeira.

   Regra: todo tile com gradiente escuro OU declara override em html.light, OU
   é assumidamente escuro nos dois temas (e aí precisa inverter a cor do texto).
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const css = fs.readFileSync(__dirname + '/hub.css', 'utf8');
let passed = 0;
const falhas = [];

/* tiles que definem background com gradiente de cor ESCURA (#0x/#1x) */
const escuros = [...css.matchAll(
  /^\.(t-[\w-]+)\{background:\s*linear-gradient\(160deg,\s*(#[0-9a-f]{6})/gmi
)].map(m => ({ classe: m[1], cor: m[2] }));

console.log('\ntiles com céu escuro precisam de contraparte no tema claro:');
assert.ok(escuros.length >= 3, 'esperava achar ao menos 3 tiles com gradiente escuro, achei ' + escuros.length);

for (const { classe, cor } of escuros) {
  const temLight = new RegExp('html\\.light \\.' + classe + '\\{background:').test(css);
  const assumeEscuro = new RegExp('html\\.light \\.' + classe + '\\{color:').test(css);
  if (temLight || assumeEscuro) {
    passed++;
    console.log('  ✓ ' + classe + ' (' + cor + ') → ' +
      (temLight ? 'vira papel no claro' : 'assumidamente escuro nos dois temas'));
  } else {
    falhas.push(classe + ' tem gradiente escuro (' + cor + ') e NENHUMA regra html.light — ' +
                'no tema claro vira borrão até #ffffff');
    console.log('  ✗ ' + classe + ' — sem contraparte clara');
  }
}

/* o caso concreto, nomeado: a TV não pode voltar a ficar de fora */
console.log('\no caso que originou o teste:');
{
  assert.ok(/^\.t-tv\{background:\s*linear-gradient/m.test(css), '.t-tv deveria ter céu escuro');
  passed++; console.log('  ✓ .t-tv tem céu escuro (tema dark)');
  assert.ok(/html\.light \.t-tv\{background:/.test(css),
    '.t-tv PRECISA de override em html.light — sem ele o cartão vira borrão marrom→branco');
  passed++; console.log('  ✓ .t-tv tem override no tema claro');
}

/* a contraparte clara tem que ser SUAVE: alfa baixo sobre --bg-raise.
   Uma cor opaca aqui recriaria o problema com outra roupa. */
console.log('\nos overrides claros são lavagens suaves:');
{
  const lights = [...css.matchAll(/html\.light \.(t-[\w-]+)\{background:\s*linear-gradient\(160deg,\s*rgba\(([^)]+)\)/g)];
  assert.ok(lights.length >= 3, 'esperava ao menos 3 overrides claros');
  for (const m of lights) {
    const alfa = parseFloat(m[2].split(',')[3]);
    assert.ok(alfa > 0 && alfa <= 0.20,
      m[1] + ': a lavagem clara deveria ter alfa ≤ 0.20, tem ' + alfa);
    passed++; console.log('  ✓ ' + m[1] + ' — alfa ' + alfa);
  }
}

console.log(`\n${passed} verificações passaram.`);
if (falhas.length) {
  console.error('\n' + falhas.length + ' problema(s):');
  falhas.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

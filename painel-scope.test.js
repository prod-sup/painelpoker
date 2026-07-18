/* Guarda de escopo — rode com:  node painel-scope.test.js

   POR QUE ESTE TESTE EXISTE
   -------------------------
   painel.js tem ~300 funções e ~150 variáveis num ÚNICO escopo global. Nesse
   tamanho, declarar duas vezes o mesmo nome não dá erro nenhum: por hoisting, a
   ÚLTIMA declaração vence, silenciosamente, no arquivo inteiro.

   Foi exatamente o que aconteceu com `escHtml`. A versão completa (escapa & < >
   " ') estava no topo; 1.500 linhas abaixo alguém declarou outra que NÃO escapa
   aspas. A segunda venceu, e todo `title="${escHtml(nome)}"` virou porta de XSS
   armazenado — nome de torneio vem da planilha que o operador envia.

   Encapsular painel.js num módulo resolveria de vez, mas exige smoke test no
   navegador. Este teste é a rede que dá 90% da segurança com 0% do risco: ele
   FALHA se um nome for declarado duas vezes no topo de qualquer painel.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const ARQUIVOS = [
  'painel.js', 'admin.js', 'hub.js', 'eventos.js', 'tv.js',
  'dashboard-mesa-cash.js', 'criacao-noturna.js', 'conf-dia.js',
  'suprema-auth.js', 'radar-core.js', 'gu-parser.js',
  'painel-calc.js', 'painel-actions.js',
];

let passed = 0, falhas = 0;

/* Declarações em COLUNA ZERO = escopo do arquivo. Indentadas estão dentro de
   função/bloco e podem repetir sem se atropelar. */
function topLevelDecls(src) {
  const decls = new Map();   // nome -> [linhas]
  src.split(/\r?\n/).forEach((linha, i) => {
    const m = linha.match(/^(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/);
    if (!m) return;
    // `function` dentro de string/comentário não começa em coluna 0 na prática
    const nome = m[1];
    if (!decls.has(nome)) decls.set(nome, []);
    decls.get(nome).push(i + 1);
  });
  return decls;
}

console.log('\nnomes declarados duas vezes no escopo do arquivo:');
for (const arq of ARQUIVOS) {
  let src;
  try { src = fs.readFileSync(__dirname + '/' + arq, 'utf8'); }
  catch (e) { continue; }                       // arquivo opcional/ausente
  const decls = topLevelDecls(src);
  const dups = [...decls].filter(([, linhas]) => linhas.length > 1);
  if (dups.length) {
    falhas++;
    console.log('  ✗ ' + arq);
    for (const [nome, linhas] of dups) {
      console.log('      "' + nome + '" declarado nas linhas ' + linhas.join(', ') +
                  ' — a ÚLTIMA vence em TODO o arquivo');
    }
  } else {
    passed++;
    /* 0 declarações em coluna 0 = o arquivo já vive dentro de um IIFE/módulo,
       que é justamente o alvo. Não confundir com "não verificado". */
    console.log(decls.size === 0
      ? '  ✓ ' + arq + ' (já encapsulado — sem escopo global exposto)'
      : '  ✓ ' + arq + ' (' + decls.size + ' nomes no topo, nenhum repetido)');
  }
}

/* A guarda precisa DE FATO pegar o caso — teste que nunca falha não protege. */
console.log('\na própria guarda pega uma duplicata?');
{
  const fonteComBug = [
    'function escHtml(s){ return completo(s); }',
    'var x = 1;',
    'function escHtml(s){ return fraco(s); }',   // a segunda vence
  ].join('\n');
  const dups = [...topLevelDecls(fonteComBug)].filter(([, l]) => l.length > 1);
  assert.strictEqual(dups.length, 1, 'a guarda deveria acusar 1 duplicata');
  assert.strictEqual(dups[0][0], 'escHtml', 'e deveria apontar escHtml');
  assert.deepStrictEqual(dups[0][1], [1, 3], 'nas linhas 1 e 3');
  passed++; console.log('  ✓ pega o bug original do escHtml (linhas 1 e 3)');

  // e não pode acusar declaração INDENTADA (dentro de função, escopo separado)
  const semBug = 'function a(){\n  const t = 1;\n}\nfunction b(){\n  const t = 2;\n}';
  const dups2 = [...topLevelDecls(semBug)].filter(([, l]) => l.length > 1);
  assert.strictEqual(dups2.length, 0, 'não pode acusar variável local repetida');
  passed++; console.log('  ✓ não acusa `const t` local em duas funções (falso positivo)');
}

/* O caso concreto que originou tudo: escHtml precisa escapar aspas, senão
   qualquer interpolação em atributo (title="...", value="...") abre XSS. */
console.log('\nescHtml escapa o que precisa:');
{
  const src = fs.readFileSync(__dirname + '/painel.js', 'utf8');
  const m = src.match(/^function escHtml\([\s\S]*?\n\}/m);
  assert.ok(m, 'escHtml não encontrada em painel.js');
  const escHtml = new Function('return ' + m[0])();

  const casos = [
    ['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'],
    ['"', '&quot;'], ["'", '&#39;'],
  ];
  for (const [entrada, esperado] of casos) {
    assert.strictEqual(escHtml(entrada), esperado,
      `escHtml('${entrada}') deveria dar '${esperado}'`);
    passed++; console.log(`  ✓ ${entrada} vira ${esperado}`);
  }

  // o payload real: nome de torneio quebrando um atributo
  const payload = 'Main Event" onmouseover=alert(1) x="';
  const saida = escHtml(payload);
  assert.ok(!saida.includes('"'),
    'escHtml deixou aspa crua passar — atributo pode ser quebrado');
  passed++; console.log('  ✓ nome de torneio malicioso não quebra o atributo');
}

console.log(`\n${passed} verificações passaram.`);
if (falhas) {
  console.error(`\n${falhas} arquivo(s) com nome duplicado no escopo do topo.`);
  process.exit(1);
}

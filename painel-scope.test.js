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
  'painel-calc.js', 'painel-actions.js', 'criacao-calc.js',
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

/* TODO escHtml do repo tem que escapar os 5 caracteres.
   Existem várias cópias (painel.js, criacao-noturna.js, radar-core.js) porque
   radar-core é carregado por `new Function` nos testes e não pode importar
   módulo. Cópia não é o problema — cópia DIVERGENTE é. Estavam divergindo: duas
   delas deixavam a aspa simples passar crua. Esta guarda impede a próxima. */
console.log('\ntodo escHtml do repo escapa os 5 caracteres:');
{
  const casos = [
    ['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'],
    ['"', '&quot;'], ["'", '&#39;'],
  ];
  let achou = 0;
  for (const arq of ARQUIVOS) {
    let src;
    try { src = fs.readFileSync(__dirname + '/' + arq, 'utf8'); } catch (e) { continue; }
    const m = src.match(/function escHtml\s*\([\s\S]*?\n?\s*\}/);
    if (!m) continue;
    achou++;
    let fn;
    try { fn = new Function('return ' + m[0])(); }
    catch (e) { falhas.push(arq + ': escHtml não pôde ser avaliada'); continue; }

    const ruins = casos.filter(([entrada, esperado]) => fn(entrada) !== esperado)
                       .map(([c]) => c);
    if (ruins.length) {
      falhas.push(arq + ': escHtml NÃO escapa ' + ruins.join(' '));
      console.log('  ✗ ' + arq + ' — não escapa: ' + ruins.join(' '));
    } else {
      passed++; console.log('  ✓ ' + arq);
    }

    // o payload real: nome de torneio quebrando um atributo
    const saida = fn('Main Event" onmouseover=alert(1) x=\'y');
    if (saida.includes('"') || saida.includes("'")) {
      falhas.push(arq + ': aspa crua passa — atributo pode ser quebrado');
    } else { passed++; }
  }
  assert.ok(achou >= 2, 'esperava encontrar escHtml em pelo menos 2 arquivos, achei ' + achou);
  console.log('  ✓ ' + achou + ' implementações verificadas');
  passed++;
}

console.log(`\n${passed} verificações passaram.`);
if (falhas) {
  console.error(`\n${falhas} arquivo(s) com nome duplicado no escopo do topo.`);
  process.exit(1);
}

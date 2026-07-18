/* Chaves de linha do Admin — rode com:  node admin-keys.test.js

   O PROBLEMA QUE ISTO TRAVA
   -------------------------
   O painel sufixa a chave com '_px' na madrugada que aparece no quadro de HOJE
   mas roda amanhã (`proxCronograma`). Esses cards SÃO fixáveis pelo operador,
   então existem registros gravados sob 'rk_..._px' no Firebase.

   O admin gera a chave SEM o sufixo (não conhece proxCronograma) e o comentário
   dele afirmava "Idêntico ao painel" — não era. Resultado: todo registro '_px'
   ficava invisível pra auditoria, que subcontava fixações de madrugada em
   silêncio.

   A correção não replica a lógica de proxCronograma no admin: só faz a busca
   reconhecer a chave alternativa. Ordem importa — base > _altKeys > '_px' — pra
   nunca sobrescrever dado correto, só preencher lacuna.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/admin.js', 'utf8');
let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name + ' = ' + JSON.stringify(got));
}

/* extrai as duas funções reais do admin.js (sem DOM/Firebase) */
function extrair(nome) {
  const m = src.match(new RegExp('function ' + nome + '\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, nome + ' não encontrada em admin.js');
  return new Function('return ' + m[0])();
}
const pickByKey = extrair('pickByKey');
const rowKey = extrair('rowKey');

/* a rowKey do painel, pra comparar */
function rowKeyPainel(row) {
  const s = `${row.nome}|${row.hora}|${row.buyin}|${row.garantido}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'rk_' + Math.abs(h) + (row.proxCronograma ? '_px' : '');
}

const ev = { nome: '#AS 50K Madrugada', hora: '01:00', buyin: 200, garantido: 50000 };

/* ── 1. a divergência que originou o bug ── */
console.log('\na divergência entre painel e admin:');
{
  const hoje = { ...ev };
  const prox = { ...ev, proxCronograma: true };
  eq(rowKey(hoje), rowKeyPainel(hoje), 'card normal: as chaves batem');
  eq(rowKey(prox) !== rowKeyPainel(prox), true, 'card PRÓX. CRONOGRAMA: as chaves DIVERGEM');
  eq(rowKeyPainel(prox), rowKey(prox) + '_px', 'o painel só acrescenta o sufixo _px');
}

/* ── 2. a busca recupera o registro que estava sendo perdido ── */
console.log('\nrecuperação do registro _px:');
{
  const key = rowKey(ev);                    // chave do admin, sem sufixo
  const r = {};
  // o operador fixou o card PRÓX. CRONOGRAMA: o painel gravou sob a chave _px
  const fixed = { [key + '_px']: { by: 'brian', at: 123 } };

  eq(pickByKey(fixed, key, r), { by: 'brian', at: 123 }, 'acha a fixação gravada sob _px');
  eq(pickByKey({}, key, r), null, 'mapa vazio continua null');
  eq(pickByKey(null, key, r), null, 'mapa nulo não quebra');
}

/* ── 3. ORDEM: o _px NUNCA pode sobrescrever dado da chave base ──
   Esta é a garantia que torna a correção segura: ela só preenche lacuna. */
console.log('\nordem de precedência (o que torna a correção segura):');
{
  const key = rowKey(ev);
  const r = { _altKeys: [key + '_alt'] };

  eq(pickByKey({ [key]: 'BASE', [key + '_px']: 'PX' }, key, r), 'BASE',
     'chave base vence o _px');
  eq(pickByKey({ [key + '_alt']: 'ALT', [key + '_px']: 'PX' }, key, r), 'ALT',
     'alias ao vivo vence o _px');
  eq(pickByKey({ [key]: 'BASE', [key + '_alt']: 'ALT' }, key, r), 'BASE',
     'chave base vence o alias ao vivo');
  eq(pickByKey({ [key + '_px']: 'PX' }, key, r), 'PX',
     'o _px só entra quando não há mais nada');
}

/* ── 4. valores falsy legítimos não podem ser tratados como ausência ──
   premiação 0 e field 0 são dados REAIS: se `pick` os descartasse, a auditoria
   trocaria um zero verdadeiro por "sem dado". */
console.log('\nzero é dado, não ausência:');
{
  const key = rowKey(ev);
  const r = {};
  eq(pickByKey({ [key]: 0 }, key, r), 0, 'premiação 0 na chave base');
  eq(pickByKey({ [key + '_px']: 0 }, key, r), 0, 'field 0 na chave _px');
  eq(pickByKey({ [key]: null, [key + '_px']: 5 }, key, r), 5, 'null na base cai pro _px');
}

console.log(`\n${passed} testes passaram.`);

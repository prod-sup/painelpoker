/* Testes do MULTIDAY do painel — rode com:  node painel-multiday.test.js

   POR QUE ESTE TESTE EXISTE
   -------------------------
   Um multiday é UM torneio jogado em vários dias (Dia 1A, 1B, 1C… + Dia 2). O
   garantido e o arrecadado são do torneio INTEIRO — quem fecha esse valor é o
   Dia 2. Se um flight de Dia 1 carregasse garantido, o total do dia contaria o
   mesmo prêmio uma vez por flight e a performance sairia inflada. Isso não dá
   erro nenhum na tela: só um número errado no fechamento.

   Sem jsdom de propósito (mesma receita do painel-actions/gu-parser): as funções
   puras são extraídas do painel.js e avaliadas isoladas.
========================================================================= */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name);
}
function ok(cond, name) { assert.ok(cond, name); passed++; console.log('  ✓ ' + name); }

/* ── carrega só as funções que interessam (o painel.js inteiro tem efeito colateral) ── */
const SRC = fs.readFileSync('painel.js', 'utf8');
function fatia(nome) {
  const i = SRC.indexOf('function ' + nome + '(');
  assert.ok(i > -1, 'função não encontrada em painel.js: ' + nome);
  // o corpo começa DEPOIS da lista de parâmetros (que pode ter chaves: buildManualRow
  // desestrutura o argumento) — fecha os parênteses primeiro, só então procura o '{'
  let p = SRC.indexOf('(', i), par = 0, q = p;
  for (; q < SRC.length; q++) {
    if (SRC[q] === '(') par++;
    else if (SRC[q] === ')') { par--; if (par === 0) break; }
  }
  // varre chaves até fechar o corpo da função
  let nivel = 0, k = SRC.indexOf('{', q);
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') nivel++;
    else if (SRC[k] === '}') { nivel--; if (nivel === 0) break; }
  }
  return SRC.slice(i, k + 1);
}
const ctx = { RAW_ROWS: [], getField: () => null };
vm.createContext(ctx);
['isMultidayFlight', 'isMultidayFinal', 'isMultiday', 'multidayBadgeText',
 'multidaySuffix', 'multidayGrupoKey', 'buildManualRow'].forEach(n => {
  vm.runInContext(fatia(n), ctx);
});

/* ── 1. o flight de Dia 1 NÃO carrega valor ── */
console.log('\nDia 1 (flight):');
{
  const r = ctx.buildManualRow({
    nome: 'SPS Mystery Multiday', hora: '20:00',
    garantido: 200000,            // mesmo INFORMADO, tem que ser descartado
    buyin: 300, tipo: 'Main Event', etapa: 'd1', flight: 'b',
  });
  eq(r.garantido, null, 'garantido do flight é descartado (o valor é do Dia 2)');
  eq(r.nome, 'SPS Mystery Multiday · Dia 1B', 'nome ganha a etapa e o flight em maiúscula');
  eq(r.buyin, 300, 'buy-in do flight é real e fica');
  eq(r.premiacao, null, 'flight nasce sem arrecadado');
  eq(r.mdEtapa, 'd1', 'marcado como flight');
  eq(r.mdFlight, 'B', 'flight normalizado');
  eq(r.mdGrupo, 'SPS MYSTERY MULTIDAY', 'grupo = nome do multiday em caixa alta');
  ok(ctx.isMultidayFlight(r), 'isMultidayFlight reconhece');
  ok(!ctx.isMultidayFinal(r), 'não é final');
  eq(ctx.multidayBadgeText(r), 'DIA 1B', 'etiqueta do card');
}

/* ── 2. o Dia 2 carrega o valor do multiday inteiro ── */
console.log('\nDia 2 (final):');
{
  const r = ctx.buildManualRow({
    nome: 'SPS Mystery Multiday', hora: '19:00',
    garantido: 200000, buyin: 300, tipo: 'Main Event', etapa: 'd2', flight: '',
  });
  eq(r.garantido, 200000, 'garantido fica no Dia 2');
  eq(r.nome, 'SPS Mystery Multiday · Dia 2', 'nome ganha a etapa');
  eq(r.mdEtapa, 'd2', 'marcado como final');
  eq(r.mdFlight, null, 'final não tem letra de flight');
  eq(ctx.multidayBadgeText(r), 'DIA 2', 'etiqueta do card');
  ok(!ctx.isMultidayFlight(r), 'final NÃO é flight (senão perderia o valor)');
}

/* ── 3. flights e final do mesmo torneio se amarram pelo grupo ── */
console.log('\namarração flights ↔ final:');
{
  const base = { nome: 'SPS Mystery Multiday', hora: '20:00', garantido: 200000, buyin: 300, tipo: '' };
  const a = ctx.buildManualRow({ ...base, etapa: 'd1', flight: 'A' });
  const b = ctx.buildManualRow({ ...base, etapa: 'd1', flight: 'C' });
  const f = ctx.buildManualRow({ ...base, etapa: 'd2', flight: '' });
  eq(a.mdGrupo, f.mdGrupo, 'flight A e a final compartilham o grupo');
  eq(b.mdGrupo, f.mdGrupo, 'flight C e a final compartilham o grupo');
  ok(a.nome !== b.nome, 'flights do mesmo multiday têm nomes distintos (identidade nome+hora)');
}

/* ── 4. evento normal segue exatamente como era ── */
console.log('\nevento normal (sem etapa):');
{
  const r = ctx.buildManualRow({ nome: 'Mystery Bounty Especial', hora: '21:00', garantido: 50000, buyin: 55, tipo: '' });
  eq(r.nome, 'Mystery Bounty Especial', 'nome intacto — nenhum sufixo');
  eq(r.garantido, 50000, 'garantido intacto');
  eq(r.mdEtapa, null, 'sem etapa de multiday');
  ok(!ctx.isMultiday(r), 'não é multiday');
}

/* ── 5. o formulário do drawer tem os campos que o painel.js procura ── */
console.log('\ncampos do formulário (index.html):');
{
  const html = fs.readFileSync('index.html', 'utf8');
  ['addtEtapa', 'addtFlight', 'addtFlightWrap', 'addtEtapaHint'].forEach(id => {
    ok(html.includes('id="' + id + '"'), 'index.html tem #' + id);
  });
  ok(/value="d1"/.test(html) && /value="d2"/.test(html), 'select oferece Dia 1 e Dia 2');
}

console.log(`\n${passed} verificações passaram.`);

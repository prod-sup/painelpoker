/* Testes do MULTIDAY — rode com:  node multiday.test.js

   POR QUE ESTE TESTE EXISTE
   -------------------------
   Um multiday é UM torneio jogado em vários dias (Dia 1A, 1B, 1C… + Dia 2). O
   garantido e o arrecadado são do torneio INTEIRO — quem fecha esse valor é o
   Dia 2. Se um flight de Dia 1 carregasse garantido, o total do dia contaria o
   mesmo prêmio uma vez por flight e a performance sairia inflada. Isso não dá
   erro nenhum na tela: só um número errado no fechamento.

   O multiday é CRIADO no admin (admin.js → saveAddTorneio) e LIDO no painel
   (painel.js), que recebe a linha por painel/<data>/manualRows. Os dois lados
   são cobertos aqui, porque quebrar qualquer um deles reintroduz o valor dobrado.

   Sem jsdom de propósito (mesma receita do painel-actions/admin-keys): as funções
   puras são extraídas do fonte e avaliadas isoladas; o que não é extraível vira
   asserção sobre o fonte.
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

const ADMIN  = fs.readFileSync(__dirname + '/admin.js', 'utf8');
const PAINEL = fs.readFileSync(__dirname + '/painel.js', 'utf8');

/* extrai `function nome(...){...}` de um fonte, fechando parênteses e chaves */
function fatia(src, nome) {
  const i = src.indexOf('function ' + nome + '(');
  assert.ok(i > -1, 'função não encontrada: ' + nome);
  let p = src.indexOf('(', i), par = 0, q = p;
  for (; q < src.length; q++) {
    if (src[q] === '(') par++;
    else if (src[q] === ')') { par--; if (par === 0) break; }
  }
  let nivel = 0, k = src.indexOf('{', q);
  for (; k < src.length; k++) {
    if (src[k] === '{') nivel++;
    else if (src[k] === '}') { nivel--; if (nivel === 0) break; }
  }
  return src.slice(i, k + 1);
}
function carrega(src, nomes) {
  const ctx = {};
  vm.createContext(ctx);
  nomes.forEach(n => vm.runInContext(fatia(src, n), ctx));
  return ctx;
}

/* ── 1. ADMIN — nome e grupo das etapas ── */
console.log('\nadmin · nome da etapa na grade:');
{
  const A = carrega(ADMIN, ['multidaySuffix', 'multidayGrupoKey']);
  eq('SPS Mystery Multiday' + A.multidaySuffix('d1', 'B'), 'SPS Mystery Multiday · Dia 1B', 'flight vira "· Dia 1B"');
  eq('SPS Mystery Multiday' + A.multidaySuffix('d2', ''),  'SPS Mystery Multiday · Dia 2',  'final vira "· Dia 2"');
  eq('Mystery Bounty' + A.multidaySuffix('', ''), 'Mystery Bounty', 'evento normal não ganha sufixo');
  eq(A.multidayGrupoKey(' SPS Mystery Multiday '), 'SPS MYSTERY MULTIDAY', 'grupo normalizado (caixa alta, sem espaços)');
  eq(A.multidayGrupoKey('SPS Mystery Multiday'), A.multidayGrupoKey('sps mystery multiday'), 'flights e final caem no mesmo grupo');
  ok(A.multidaySuffix('d1', 'A') !== A.multidaySuffix('d1', 'B'), 'flights diferentes → nomes diferentes (identidade nome+hora)');
}

/* ── 2. ADMIN — o flight não pode gravar valor ── */
console.log('\nadmin · flight de Dia 1 entra sem valor:');
{
  const src = fatia(ADMIN, 'saveAddTorneio');
  // a gravação (row + nós) foi extraída pra _gravarTorneioManual, que saveAddTorneio
  // chama uma vez por dia no modo "vários dias". As regras de valor seguem lá.
  const grava = fatia(ADMIN, '_gravarTorneioManual');
  ok(/const\s+isFlight\s*=\s*etapa\s*===\s*'d1'/.test(src), 'saveAddTorneio marca o flight');
  ok(/const\s+gar\s*=\s*isFlight\s*\?\s*null\s*:/.test(src),  'garantido é forçado a null no flight');
  ok(/const\s+prem\s*=\s*isFlight\s*\?\s*null\s*:/.test(src), 'arrecadado é forçado a null no flight');
  // os nós só são gravados quando != null — com gar/prem nulos, nada vai pro Firebase
  ok(/if\(ctx\.gar\s*!=\s*null\)/.test(grava),  'garantido só é gravado quando existe');
  ok(/if\(ctx\.prem\s*!=\s*null\)/.test(grava), 'arrecadado só é gravado quando existe');
  ok(/mdEtapa:/.test(grava) && /mdFlight:/.test(grava) && /mdGrupo:/.test(grava), 'a row leva os 3 marcadores do multiday');
  ok(/etapa\s*===\s*'d1'\s*&&\s*!flight/.test(src), 'exige a letra do flight no Dia 1');
}

/* ── 3. PAINEL — leitura dos marcadores ── */
console.log('\npainel · reconhece a etapa:');
{
  const P = carrega(PAINEL, ['isMultidayFlight', 'isMultidayFinal', 'isMultiday', 'multidayBadgeText']);
  const flight = { nome: 'SPS Mystery Multiday · Dia 1B', mdEtapa: 'd1', mdFlight: 'B', mdGrupo: 'SPS MYSTERY MULTIDAY' };
  const final  = { nome: 'SPS Mystery Multiday · Dia 2',  mdEtapa: 'd2', mdFlight: null, mdGrupo: 'SPS MYSTERY MULTIDAY' };
  const normal = { nome: 'Mystery Bounty Especial' };
  ok(P.isMultidayFlight(flight), 'flight reconhecido');
  ok(!P.isMultidayFlight(final), 'a final NÃO é flight (senão perderia o valor)');
  ok(P.isMultidayFinal(final), 'final reconhecida');
  ok(!P.isMultiday(normal), 'evento normal segue normal');
  eq(P.multidayBadgeText(flight), 'DIA 1B', 'etiqueta do flight');
  eq(P.multidayBadgeText(final),  'DIA 2',  'etiqueta da final');
  eq(P.multidayBadgeText(normal), '',       'evento normal não ganha etiqueta');
}

/* ── 4. PAINEL — o flight fica fora dos valores e do fechamento ── */
console.log('\npainel · flight fora dos números:');
{
  // fechamento do dia: sem esta exceção o painel NUNCA fecharia com um flight na grade
  const dayComplete = fatia(PAINEL, 'sheetsDayComplete');
  ok(/!isMultidayFlight\(r\)/.test(dayComplete), 'flight não segura o fechamento do dia');
  // resumo de turno: flight não é "pendente de arrecadado"
  const resumo = fatia(PAINEL, 'generateShiftSummary');
  ok(/!isMultidayFlight\(r\)/.test(resumo), 'flight não entra em "pendentes"');
  // o card do flight não pode oferecer campo de arrecadado
  ok(/mdFlight\s*=\s*isMultidayFlight\(t\)/.test(PAINEL), 'render marca o flight');
  ok(/mdFlightRow\s*\?\s*mdSoField/.test(PAINEL), 'linha compacta troca o input de arrecadado por "no Dia 2"');
}

/* ── 5. o modal do admin tem os campos ── */
console.log('\nadmin.html · campos do modal:');
{
  const html = fs.readFileSync(__dirname + '/admin.html', 'utf8');
  ['addEtapa', 'addFlight', 'addFlightWrap', 'addEtapaHint'].forEach(id => {
    ok(html.includes('id="' + id + '"'), 'admin.html tem #' + id);
  });
  ok(/value="d1"/.test(html) && /value="d2"/.test(html), 'select oferece Dia 1 e Dia 2');
  // a ação precisa estar no despachante, senão o select não reage a nada
  const acts = fs.readFileSync(__dirname + '/admin-actions.js', 'utf8');
  ok(/'syncAddEtapa'/.test(acts), 'syncAddEtapa está na lista de ações do admin');
  ok(/function syncAddEtapa\(/.test(ADMIN), 'syncAddEtapa existe no admin.js');
}

console.log(`\n${passed} verificações passaram.`);

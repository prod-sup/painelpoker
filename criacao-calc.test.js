/* Testes do criacao-calc.js — rode com:  node criacao-calc.test.js

   Estes números viram a receita que o turno da noite usa pra CRIAR o torneio.
   Fee errado aqui = torneio criado com rake errado, e ninguém percebe até
   alguém conferir na mão.
========================================================================= */
const assert = require('assert');
const C = require('./criacao-calc.js');

let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name + ' = ' + JSON.stringify(got));
}

/* ── 1. parsing do valor cru ── */
console.log('\nparsing do valor cru:');
{
  eq(C.parseRaw(0.1),        0.1,   'número passa direto');
  eq(C.parseRaw('10%'),      0.1,   'texto com % vira fração');
  eq(C.parseRaw('10'),       10,    'texto sem % NÃO vira fração');
  /* BUG REAL corrigido: o código antigo fazia só `.replace(',','.')`, virando
     "1.234.56", e parseFloat cortava em 1.234 — erro de MIL VEZES. */
  eq(C.parseRaw('R$ 1.234,56'), 1234.56, 'dinheiro BR com milhar (era 1.234)');
  eq(C.parseRaw('1.234.567,89'), 1234567.89, 'milhar duplo');
  eq(C.parseRaw('1.234'),   1.234, 'só ponto continua decimal (não vira 1234)');
  eq(C.parseRaw('0,25'),     0.25,  'vírgula decimal BR');
  eq(C.parseRaw(''),         null,  'vazio');
  eq(C.parseRaw(null),       null,  'null');
  eq(C.parseRaw('abc'),      null,  'texto não numérico');
  eq(C.parseRaw(NaN),        null,  'NaN');
  eq(C.parseRaw(Infinity),   null,  'Infinity');
}

/* ── 2. fee/admin: fração declarada ── */
console.log('\nfee como fração (o caso sem ambiguidade):');
{
  eq(C.rawToPctFee(50, 0.1),   0.1,  '0.1 = 10% em qualquer buy-in');
  eq(C.rawToPctFee(50, '10%'), 0.1,  '"10%" = 10% em qualquer buy-in');
  eq(C.rawToPctFee(50, 0),     0,    'zero');
  eq(C.rawToPctFee(50, null),  0,    'sem valor');
  eq(C.rawToPctFee(0, 10),     0,    'sem buy-in não inventa %');
}

/* ── 3. ⚠ AMBIGUIDADE DO ">= 1" — DECISÃO PENDENTE DA OPERAÇÃO ⚠ ──
   O código trata número >= 1 em campo de FEE como DÓLAR ABSOLUTO, e o mesmo
   número em campo de EARLY BIRD como PERCENTUAL. Os dois não podem estar certos
   se a planilha usa a mesma convenção nas duas colunas.

   Estes testes pinam o comportamento ATUAL — não o desejado. Se a operação
   confirmar que a planilha escreve percentual como número puro também nos
   campos de fee, o rawToPctFee muda e ESTES testes devem falhar de propósito. */
console.log('\n⚠ ambiguidade do ">= 1" (comportamento ATUAL, decisão pendente):');
{
  // com buy-in 100 as duas leituras coincidem — por isso passou despercebido
  eq(C.rawToPctFee(100, 10), 0.1, 'buy-in 100: "10" dá 10% (as duas leituras batem)');

  // fora de 100, divergem
  eq(C.rawToPctFee(50, 10),  0.2,  'buy-in 50: "10" vira 20% (leitura DÓLAR)');
  eq(C.rawToPctFee(50, 2),   0.04, 'buy-in 50: "2" vira 4% (leitura DÓLAR)');
  eq(C.rawToPctFee(200, 10), 0.05, 'buy-in 200: "10" vira 5% (leitura DÓLAR)');

  // o MESMO "20" no early bird é lido como PERCENTUAL — regra oposta
  eq(C.earlyPct(20), 0.2, 'early bird: "20" vira 20% (leitura PERCENTUAL)');

  // a contradição, explícita:
  const feeLe  = C.rawToPctFee(50, 20);   // 20/50 = 0.4
  const earlyLe = C.earlyPct(20);         // 20/100 = 0.2
  eq(feeLe !== earlyLe, true, 'o mesmo "20" dá 40% no fee e 20% no early bird');
}

/* ── 4. early bird ── */
console.log('\nearly bird:');
{
  eq(C.earlyPct(0.2),   0.2, 'fração declarada');
  eq(C.earlyPct('20%'), 0.2, 'texto com %');
  eq(C.earlyPct(0),     0,   'zero');
  eq(C.earlyPct(null),  0,   'sem valor');
  eq(C.earlyChips(20, 30000), 6000, '20% de 30.000 fichas = 6.000');
  eq(C.earlyChips(20, null),  null, 'sem stack não calcula fichas');
  eq(C.earlyChips(0, 30000),  null, 'sem early bird não calcula fichas');
}

/* ── 5. conversão de moeda ──
   BRL_RATE é multiplicador FIXO da operação (5), não cotação ao vivo. Entra por
   parâmetro pra isso ficar explícito no ponto de uso. */
console.log('\nconversão de moeda:');
{
  eq(C.toCurrency(100, 'usd', 5), 100, 'em dólar não converte');
  eq(C.toCurrency(100, 'brl', 5), 500, 'em real multiplica pela taxa da casa');
  eq(C.toCurrency(null, 'brl', 5), null, 'null continua null');
  eq(C.toCurrency(undefined, 'brl', 5), null, 'undefined vira null');
}

/* ── 6. dinheiro sobre o buy-in ── */
console.log('\nvalor em dinheiro:');
{
  eq(C.moneyOf(100, 0.1),  10,    '10% de 100');
  eq(C.moneyOf(55, 0.12),  6.6,   '12% de 55 arredonda a 2 casas');
  eq(C.moneyOf(null, 0.1), null,  'sem buy-in');
}

/* ── 7. texto de porcentagem ── */
console.log('\ntexto de %:');
{
  eq(C.pctText(0.1),   '10%',   '10%');
  eq(C.pctText(0.125), '12,5%', 'decimal em padrão BR');
  eq(C.pctText(0.02),  '2%',    '2%');
}

console.log(`\n${passed} testes passaram.`);

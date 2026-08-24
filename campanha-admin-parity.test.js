/* Paridade admin.js ⇄ campanha-core.js — rode com:  node campanha-admin-parity.test.js

   POR QUÊ
   -------
   O campanha-core.js é um PORT FIEL das funções puras do admin.js (classify, nhKey,
   rowKey, pickByKey, netFactorOf, RATES). O board da campanha PRECISA bater 100% com o
   dashboard do admin — se alguém mexe na regra do admin (ex.: muda o limite de "main"
   de 20k, o hash da rowKey, ou uma taxa) e ESQUECE de espelhar no core, os dois divergem
   em SILÊNCIO (o telão passa a mostrar número diferente do admin).

   Este teste EXTRAI as funções puras direto do texto do admin.js (brace-matching, sem
   rodar o boot dele) e do campanha-core, e prova que dão a MESMA saída numa bateria de
   entradas. Divergiu → o teste quebra e aponta ONDE. É o guarda-drift do #8 sem ter que
   refatorar o admin.js de produção (cujo pipeline é acoplado a estado global e DOM).
   ========================================================================= */
'use strict';
const fs = require('fs');
const assert = require('assert');

const adminSrc = fs.readFileSync(__dirname + '/admin.js', 'utf8');
const core = require(__dirname + '/campanha-core.js');

let passed = 0;
const falhas = [];
function ok(nome, cond, extra) { if (cond) passed++; else falhas.push(nome + (extra ? ' — ' + extra : '')); }

/* Extrai `function NOME(...){...}` do texto por contagem de chaves (as 4 funções alvo
   não têm chave solta em string; regex quantifier {n,m} e template ${} são balanceados). */
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('não achei `function ' + name + '` no admin.js (assinatura mudou?)');
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return (0, eval)('(' + src.slice(i, k + 1) + ')'); }
  }
  throw new Error('chaves não fecharam para ' + name);
}

let admin;
try {
  admin = {
    classify: extractFn(adminSrc, 'classify'),
    nhKey: extractFn(adminSrc, 'nhKey'),
    rowKey: extractFn(adminSrc, 'rowKey'),
    pickByKey: extractFn(adminSrc, 'pickByKey'),
    guRatesOf: extractFn(adminSrc, 'guRatesOf'),
    guNormNome: extractFn(adminSrc, 'guNormNome'),
  };
  // RATES + netFactorOf do admin (arrow que usa DASH_RATES global)
  const ratesM = adminSrc.match(/DASH_RATES_DEFAULT\s*=\s*(\{[^}]*\})/);
  admin.rates = (0, eval)('(' + ratesM[1] + ')');
  const nfM = adminSrc.match(/netFactorOf\s*=\s*(\([^)]*\)\s*=>[^;\n]+)/);
  global.DASH_RATES = admin.rates;                      // o arrow do admin fecha sobre este global
  admin.netFactorOf = (0, eval)('(' + nfM[1] + ')');
  admin.isCampRate = (nome) => /^\s*SPS\b/i.test(nome || '');
  ok('extração das funções puras do admin.js', true);
  /* NÃO PODE VOLTAR: taxa por categoria como fonte de rake. O admin.js não pode
     derivar rake/admin fee do NOME do torneio — só das colunas FEE/ADMIN FEE da
     GU (guRatesOf) ou do mapa painel/guFees. Um `DASH_RATES.adminPct` ou
     `netFactorOf(...)` alimentando adminFrac/rakeFrac de novo é a regressão que
     este teste existe pra pegar. */
  const estimaAdmin = /adminFrac\s*=\s*[^;\n]*DASH_RATES\.adminPct/.test(adminSrc);
  const estimaRake  = /rakeFrac\s*=\s*[^;\n]*netFactorOf\s*\(/.test(adminSrc);
  ok('admin.js NÃO estima admin fee por nome/categoria', !estimaAdmin);
  ok('admin.js NÃO estima rake por categoria', !estimaRake);
} catch (e) {
  ok('extração das funções puras do admin.js', false, e.message);
}

if (admin) {
  /* ── classify: mesma categoria em todos os ramos ── */
  const rowsCls = [
    { tipo: 'Main Event' }, { tipo: 'side ev' }, { tipo: 'Satélite' },
    { nome: 'SPS X seat Y' }, { nome: 'Satelite do Main' }, { nome: 'satélite' },
    { garantido: 25000 }, { garantido: 20000 }, { garantido: 19999 }, { garantido: 0 },
    { tipo: 'MAIN', garantido: 100 }, { nome: 'Bounty', garantido: 50000 }, {},
    // SPT é satélite mesmo com tipo/garantido de Main (regra da casa)
    { nome: 'SPT Turbo', garantido: 50000 }, { nome: 'SPT Main', tipo: 'Main Event' }, { nome: 'spt' },
    // satélites reais do SPT têm "SPT" no FIM do nome ("3 Seats SPT", "4 Seats SPT")
    { nome: '3 Seats SPT' }, { nome: '4 Seats SPT', tipo: 'Main Event', garantido: 99000 }, { nome: 'Satélite SPT #2' },
  ];
  let clsOk = true, clsBad = '';
  rowsCls.forEach((r) => { if (admin.classify(r) !== core.classify(r)) { clsOk = false; clsBad = JSON.stringify(r) + ' → admin=' + admin.classify(r) + ' core=' + core.classify(r); } });
  ok('classify: paridade em todos os ramos', clsOk, clsBad);

  /* ── nhKey: acentos, espaços múltiplos, formatos de hora ── */
  const nhCases = [
    ['SPS Batalhão HR', '20:00'], ['  Multi   Espaço  ', '9:05'], ['Café', '21:30:12'],
    ['SÃO PAULO', ''], ['x', '7:5'], ['ÁÉÍ Ôç', '00:00'],
  ];
  let nhOk = true, nhBad = '';
  nhCases.forEach(([n, h]) => { if (admin.nhKey(n, h) !== core.nhKey(n, h)) { nhOk = false; nhBad = n + '|' + h + ' → admin=' + admin.nhKey(n, h) + ' core=' + core.nhKey(n, h); } });
  ok('nhKey: paridade (acentos/espaços/hora)', nhOk, nhBad);

  /* ── rowKey: mesmo hash ── */
  const rkCases = [
    { nome: 'SPS 1M Battle', hora: '20:00', buyin: 500, garantido: 1000000 },
    { nome: 'A', hora: '', buyin: null, garantido: 0 },
    { nome: 'Çãé', hora: '9:9', buyin: 33, garantido: 25000 },
  ];
  let rkOk = true, rkBad = '';
  rkCases.forEach((r) => { if (admin.rowKey(r) !== core.rowKey(r)) { rkOk = false; rkBad = JSON.stringify(r) + ' → admin=' + admin.rowKey(r) + ' core=' + core.rowKey(r); } });
  ok('rowKey: mesmo hash', rkOk, rkBad);

  /* ── pickByKey: chave direta, _altKeys, sufixo _px ── */
  const map = { rk_1: 'direto', rk_alt: 'viaAlt', 'rk_2_px': 'viaPx' };
  const pkCases = [
    [map, 'rk_1', {}], [map, 'rk_x', { _altKeys: ['rk_alt'] }], [map, 'rk_2', {}], [map, 'nada', {}], [null, 'rk_1', {}],
  ];
  let pkOk = true, pkBad = '';
  pkCases.forEach(([m, k, r]) => { if (admin.pickByKey(m, k, r) !== core.pickByKey(m, k, r)) { pkOk = false; pkBad = k; } });
  ok('pickByKey: direto/_altKeys/_px', pkOk, pkBad);

  /* ── RATES + netFactorOf: mesmos números ── */
  ok('RATES_DEFAULT idênticos', JSON.stringify(admin.rates) === JSON.stringify(core.RATES_DEFAULT),
    'admin=' + JSON.stringify(admin.rates) + ' core=' + JSON.stringify(core.RATES_DEFAULT));
  let nfOk = true, nfBad = '';
  [['sat', false], ['sat', true], ['main', true], ['main', false], ['side', true], ['side', false]].forEach(([cat, camp]) => {
    const a = admin.netFactorOf(cat, camp), b = core.netFactorOf(cat, camp, core.RATES_DEFAULT);
    if (a !== b) { nfOk = false; nfBad = cat + '/' + camp + ' → admin=' + a + ' core=' + b; }
  });
  ok('netFactorOf: mesmo fator (cat × campanha)', nfOk, nfBad);

  /* ── isCampRate: SÓ SPS (SPT é satélite, sem admin fee) ── */
  let icOk = true;
  ['SPS Main', 'SPT Turbo', 'spS x', 'Normal', ' SPS ', 'ASPS'].forEach((n) => {
    if (admin.isCampRate(n) !== core.isCampRate(n)) icOk = false;
  });
  ok('isCampRate: admin ⇄ core igual', icOk);
  ok('isCampRate: SPS = admin fee', admin.isCampRate('SPS Main') === true && core.isCampRate('SPS Main') === true);
  ok('isCampRate: "SPS … +SPT" É SPS = admin fee', admin.isCampRate('SPS 75K Plus+SPT') === true && core.isCampRate('SPS 75K Plus+SPT') === true);
  ok('isSPS: "SPS … +SPT" É SPS', core.isSPS('SPS 75K Plus+SPT') === true);
  ok('classify: "SPS 75K Plus+SPT" (crossover) NÃO é satélite (é SPS c/ admin)', admin.classify({ nome: 'SPS 75K Plus+SPT', garantido: 75000 }) !== 'sat' && core.classify({ nome: 'SPS 75K Plus+SPT', garantido: 75000 }) !== 'sat');
  ok('classify: "3 Seats SPT" (satélite puro) vira satélite', admin.classify({ nome: '3 Seats SPT', garantido: 99000 }) === 'sat' && core.classify({ nome: '3 Seats SPT', garantido: 99000 }) === 'sat');
  ok('isCampRate: "3 Seats SPT" (satélite puro) NÃO tem admin fee', admin.isCampRate('3 Seats SPT') === false && core.isCampRate('3 Seats SPT') === false);

  /* ── FEE DA GU: admin ⇄ core têm que ler as colunas do MESMO jeito ──
     É daqui que sai o rake de todo mundo desde que a GU virou a fonte. Se um
     lado passar a arredondar, ignorar o ADMIN FEE ou tratar 0 como vazio, o
     telão e o dashboard divergem em silêncio — exatamente o que este arquivo
     existe pra impedir. */
  const feeCases = [
    { fee: 0.10, adminFee: 0.02 },   // SPS padrão → 12%
    { fee: 0.08, adminFee: 0.02 },   // high stakes → 10%
    { fee: 0.05, adminFee: 0 },      // satélite → 5%
    { fee: 0, adminFee: 0 },         // freeroll → 0% (0 é valor, não "vazio")
    { fee: 10, adminFee: 2 },        // digitado em % inteiro → 12%
    { fee: '0,05', adminFee: null }, // vírgula decimal, admin vazio
    { fee: null, adminFee: 0.02 },   // sem FEE = sem dado da GU → null
    { fee: undefined, adminFee: undefined },
    { fee: '', adminFee: '' },
    { fee: 'abc', adminFee: 'x' },
    { fee: -0.1, adminFee: 0 },      // lixo → null
    { fee: 1.5, adminFee: 0 },       // 150% de rake → null
    {},
  ];
  let feeOk = true, feeBad = '';
  feeCases.forEach((c) => {
    const a = admin.guRatesOf(c), b = core.guRates(c);
    const eq = (a === null && b === null) ||
               (a && b && a.fee === b.fee && a.admin === b.admin && a.total === b.total);
    if (!eq) { feeOk = false; feeBad = JSON.stringify(c) + ' → admin=' + JSON.stringify(a) + ' core=' + JSON.stringify(b); }
  });
  ok('guRates (FEE+ADMIN FEE da GU): admin ⇄ core igual', feeOk, feeBad);
  const spsGu = admin.guRatesOf({ fee: 0.10, adminFee: 0.02 });
  ok('guRates: FEE e ADMIN FEE somam a retenção da casa', !!spsGu && Math.abs(spsGu.total - 0.12) < 1e-9);
  ok('guRates: freeroll (FEE 0) é 0%, não "sem dado"', admin.guRatesOf({ fee: 0, adminFee: 0 }) !== null);
  ok('guRates: linha sem as colunas devolve null (sem rake, fora da receita)', admin.guRatesOf({ nome: 'x' }) === null);

  /* ── NORMALIZAÇÃO DO NOME: admin ⇄ core ⇄ gu-parser ──
     O mapa `painel/guFees` é gravado pelo painel com as chaves normalizadas pelo
     normText do gu-parser, e consultado pelo admin (guNormNome) e pelo core
     (guNormNome). Se as três divergirem, o histórico simplesmente não casa e
     volta a ficar sem rake — EM SILÊNCIO, que é o pior modo de falhar. */
  const nomes = ['SPS 43-M 50K WarmUp', ' Corujão ', 'SPS 7.5K Sônic', 'ÁGUIA #AS', '4 Seats Battle HR', ''];
  let nOk = true, nBad = '';
  nomes.forEach((n) => {
    const a = admin.guNormNome(n), b = core.guNormNome(n);
    if (a !== b) { nOk = false; nBad = JSON.stringify(n) + ' → admin=' + JSON.stringify(a) + ' core=' + JSON.stringify(b); }
  });
  ok('guNormNome: admin ⇄ core igual (chave do mapa guFees)', nOk, nBad);
  ok('guNormNome tira acento e caixa', core.guNormNome('SPS Sônic') === 'sps sonic');
  ok('guNormNome apara as bordas', core.guNormNome('  Corujão  ') === 'corujao');

  /* guFromMap é o resgate do histórico — e não pode virar chute pra nome que
     não está no mapa. */
  const mapa = { 'sps 43-m 50k warmup': { f: 0.10, a: 0.02 } };
  ok('guFromMap acha pelo nome normalizado', core.guFromMap(mapa, 'SPS 43-M 50K WarmUp').total === 0.12);
  ok('guFromMap NÃO chuta nome fora do mapa', core.guFromMap(mapa, 'Torneio Desconhecido') === null);
  ok('guFromMap sem mapa devolve null', core.guFromMap(null, 'SPS 43-M 50K WarmUp') === null);
}

console.log('\n' + (falhas.length ? '❌' : '✅') + ' paridade admin⇄core: ' + passed + ' checagens passaram' +
  (falhas.length ? ', ' + falhas.length + ' DIVERGIRAM:\n  - ' + falhas.join('\n  - ') +
    '\n\n  >>> admin.js e campanha-core.js SAÍRAM DE SINCRONIA. Espelhe a mudança no core.' : ''));
process.exit(falhas.length ? 1 : 0);

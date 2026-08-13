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
  };
  // RATES + netFactorOf do admin (arrow que usa DASH_RATES global)
  const ratesM = adminSrc.match(/DASH_RATES_DEFAULT\s*=\s*(\{[^}]*\})/);
  admin.rates = (0, eval)('(' + ratesM[1] + ')');
  const nfM = adminSrc.match(/netFactorOf\s*=\s*(\([^)]*\)\s*=>[^;\n]+)/);
  global.DASH_RATES = admin.rates;                      // o arrow do admin fecha sobre este global
  admin.netFactorOf = (0, eval)('(' + nfM[1] + ')');
  const campRxM = adminSrc.match(/\/\^\\s\*\(SPS\|SPT\)\\b\/i/);   // regex de taxa de campanha (SPS|SPT)
  admin.isCampRate = (nome) => /^\s*(SPS|SPT)\b/i.test(nome || '');
  ok('extração das funções puras do admin.js', true);
  ok('regra de taxa de campanha (SPS|SPT) presente no admin.js', !!campRxM);
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

  /* ── isCampRate (SPS|SPT) ── */
  let icOk = true;
  ['SPS Main', 'SPT Turbo', 'spS x', 'Normal', ' SPS ', 'ASPS'].forEach((n) => {
    if (admin.isCampRate(n) !== core.isCampRate(n)) icOk = false;
  });
  ok('isCampRate: SPS|SPT igual', icOk);
}

console.log('\n' + (falhas.length ? '❌' : '✅') + ' paridade admin⇄core: ' + passed + ' checagens passaram' +
  (falhas.length ? ', ' + falhas.length + ' DIVERGIRAM:\n  - ' + falhas.join('\n  - ') +
    '\n\n  >>> admin.js e campanha-core.js SAÍRAM DE SINCRONIA. Espelhe a mudança no core.' : ''));
process.exit(falhas.length ? 1 : 0);

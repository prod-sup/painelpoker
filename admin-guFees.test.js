/* Mapa de FEE da GU no admin — rode com:  node admin-guFees.test.js

   POR QUÊ ESTE ARQUIVO EXISTE
   ---------------------------
   O rake do sistema vem SÓ das colunas FEE e ADMIN FEE da planilha da GU. Pro
   HISTÓRICO (dias gravados antes de o painel guardar essas colunas na linha),
   quem responde é o mapa `painel/guFees`. Duas coisas sustentam esse mapa, e as
   duas falham em SILÊNCIO se alguém mexer sem querer:

   1. O CORTE DA CONSULTA. O nó `painel` tem as datas ('YYYY-MM-DD') e mais dois
      filhos: 'globalMtt' (o .xlsx INTEIRO da Global em base64 — megabytes) e
      'guFees'. A consulta do admin é ordenada por chave, então sem um endAt ela
      arrasta os dois. Isso já custava o download da planilha completa a cada
      abertura do admin. O corte é lexicográfico e é isso que este teste prova.

   2. A REDE quando o mapa não existe. Antes do primeiro upload da Global o nó
      `painel/guFees` não existe; o admin busca a planilha da GU direto na fonte
      e monta o mapa sozinho (ensureGuFeeMap). Sem isso o histórico inteiro
      apareceria como "sem fee".
   ========================================================================= */
'use strict';
const fs = require('fs');

const adminSrc = fs.readFileSync(__dirname + '/admin.js', 'utf8');
const adminHtml = fs.readFileSync(__dirname + '/admin.html', 'utf8');

let pass = 0;
const falhas = [];
function ok(nome, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + nome); }
  else falhas.push(nome + (extra ? ' — ' + extra : ''));
}

/* ── 1. ORDEM LEXICOGRÁFICA: '9999' separa data de nome ────────────────────
   É a premissa inteira do corte. Se ela não valer, ou o admin volta a baixar o
   globalMtt, ou (pior) perde dias do histórico. */
console.log('corte da consulta por chave:');
{
  const DATE_MAX = '9999';
  const datas = ['2020-01-01', '2026-08-24', '2099-12-31', '2026-06-25'];
  const naoDatas = ['globalMtt', 'guFees'];
  ok('toda data de grade fica ABAIXO do corte', datas.every(d => d <= DATE_MAX), datas.filter(d => d > DATE_MAX).join(','));
  ok('globalMtt e guFees ficam ACIMA do corte (não são baixados)', naoDatas.every(k => k > DATE_MAX), naoDatas.filter(k => k <= DATE_MAX).join(','));
  // o piso: com histórico completo o startAt é '0' e não pode cortar data nenhuma
  ok("startAt('0') não corta nenhuma data", datas.every(d => d >= '0'));
}

/* ── 2. O CORTE ESTÁ MESMO NO CÓDIGO ──
   A premissa acima só serve se a query usar o endAt. Se alguém remover, o custo
   volta sem nenhum sintoma visível — que é exatamente o modo de falha caro. */
console.log('\nconsulta do admin:');
{
  const q = adminSrc.match(/db\.ref\('painel'\)\.orderByKey\(\)[^;\n]*/);
  ok('a consulta de `painel` existe', !!q);
  ok('e usa endAt pra barrar os filhos não-data', !!q && /\.endAt\(/.test(q[0]), q ? q[0] : '');
  ok('guFees é lido em consulta PRÓPRIA (não vem junto com as datas)', /db\.ref\('painel\/guFees'\)\.once/.test(adminSrc));
  ok('o globalMtt NÃO é lido pelo admin em lugar nenhum', !/ref\(\s*['"`]painel\/globalMtt/.test(adminSrc));
}

/* ── 3. REDE: montar o mapa da própria planilha da GU ── */
console.log('\nrede quando painel/guFees ainda não existe:');
{
  ok('ensureGuFeeMap existe', /function\s+ensureGuFeeMap\s*\(/.test(adminSrc));
  ok('ela busca a planilha publicada da GU', /fetchGuSheetBuffer\s*\(/.test(adminSrc));
  ok('e monta o índice com o parser compartilhado', /guFeeIndexFromWorkbook\s*\(/.test(adminSrc));
  ok('só roda se o mapa estiver VAZIO (não baixa à toa)', /GU_FEE_MAP\.size\s*\|\|\s*_guFeeFetchTried/.test(adminSrc));
  ok('grava o resultado pra próxima abertura não baixar de novo', /ref\('painel\/guFees'\)\.set\(/.test(adminSrc));
  ok('é chamada no carregamento dos dados', /await\s+ensureGuFeeMap\(\)/.test(adminSrc));
  // sem o gu-parser na página, fetchGuSheetBuffer/guFeeIndexFromWorkbook não existem
  ok('admin.html carrega o gu-parser.js', /<script[^>]+src="gu-parser\.js"/.test(adminHtml));
  ok('e o carrega ANTES do admin.js', adminHtml.indexOf('gu-parser.js') < adminHtml.indexOf('src="admin.js"'));
}

/* ── 4. NADA DE ESTIMATIVA ──
   O mapa é consulta pelo nome, com o valor que a GU digitou. Se ele virar um
   "chuta 10% quando não achar", perdemos tudo que a mudança comprou. */
console.log('\no mapa não pode virar estimativa:');
{
  const fn = adminSrc.match(/function\s+guRatesRow\s*\([\s\S]*?\n\}/);
  ok('guRatesRow existe', !!fn);
  ok('e devolve null quando o nome não está no mapa', !!fn && /return\s+hit\s*\?[\s\S]*?:\s*null;/.test(fn[0]), fn ? fn[0] : '');
  ok('linha sem fee é CONTADA em semFee (não some da tela)', /semFee\+\+/.test(adminSrc));
  ok('e a premiação que ficou de fora é reportada', /semFeePrem\s*\+=/.test(adminSrc));
}

console.log('\n' + (falhas.length ? '❌' : '✅') + ' mapa de fee da GU: ' + pass + ' checagens passaram' +
  (falhas.length ? ', ' + falhas.length + ' FALHARAM:\n  - ' + falhas.join('\n  - ') : ''));
process.exit(falhas.length ? 1 : 0);

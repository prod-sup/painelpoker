/* Testes do campanha-core.js — rode com:  node campanha-core.test.js

   Travam a fidelidade "bater 100%" com o dashboard do admin:
   - GATE de premiação: premiação-fantasma (sem premBy ao vivo nem premPor no
     snapshot) NÃO entra no total e é contada em excludedNoStamp.
   - FILTRO: só SPS entra; SPT e regulares ficam de fora (SPT NÃO é a campanha).
   - MATEMÁTICA: arrecadado bruto, rake, admin fee, overlay, cobertura, ticket,
     perf — números conferidos à mão contra as fórmulas do admin.js.
*/
'use strict';
const C = require('./campanha-core.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
function near(a, b, msg, tol) { tol = tol == null ? 0.01 : tol; ok(a != null && Math.abs(a - b) <= tol, msg + ' = ' + b + (a != null ? ' (saiu ' + (Math.round(a * 100) / 100) + ')' : ' (saiu ' + a + ')')); }

/* Snapshot: rows já finalizadas. premPor marca premiação REALMENTE coletada.

   fee/adminFee: as colunas FEE e ADMIN FEE que a GU preenche e o painel grava na
   linha — a ÚNICA fonte de rake do sistema. A fixture usa 10% + 2% (o que a GU
   cobra nos SPS) porque é sobre isso que as contas abaixo foram escritas.
   `opts.semFee` simula linha ANTIGA, gravada antes de o painel guardar essas
   colunas. */
function snapRow(nome, hora, buyin, garantido, premiacao, opts) {
  opts = opts || {};
  const r = { nome: nome, hora: hora, buyin: buyin, garantido: garantido, tipo: opts.tipo || '' };
  if (!opts.semFee) {
    r.fee = opts.fee != null ? opts.fee : 0.10;
    r.adminFee = opts.adminFee != null ? opts.adminFee : (/^\s*SPS\b/i.test(nome) ? 0.02 : 0);
  }
  if (premiacao != null) r.premiacao = premiacao;
  if (opts.premPor) r.premPor = opts.premPor;      // carimbo de coleta (libera a premiação do snapshot)
  if (opts.id) r.id = opts.id;
  return r;
}

const FROM = '2026-08-01', TO = '2026-09-20';

console.log('\ngate de premiação + filtro SPS:');
{
  const days = {
    '2026-08-05': { snap: { rows: {
      k1: snapRow('SPS 61-L 50K Plus', '12:00', 100, 50000, 51000, { premPor: 'op', id: 'E1' }),  // SPS fechado, bate GTD
      k2: snapRow('SPS Turbo', '20:00', 50, 10000, 8000, { premPor: 'op', id: 'E2' }),             // SPS fechado, overlay
      k3: snapRow('Regular Daily', '21:00', 30, 5000, 6000, { premPor: 'op' }),                    // NÃO-SPS → filtrado
      k4: snapRow('SPT Bounty', '19:00', 55, 50000, 60000, { premPor: 'op' }),                     // SPT → filtrado (SPT NÃO)
      k5: snapRow('SPS Ghost', '22:00', 40, 3000, 9999, {}),                                       // SPS SEM premPor → fantasma
    } } },
  };
  const { rows, totals } = C.computeCampaign(days, FROM, TO, { filter: C.isSPS });

  const nomes = rows.map(r => r.nome).sort();
  ok(nomes.length === 3, 'só 3 linhas SPS (61-L, Turbo, Ghost) — Regular e SPT fora');
  ok(!nomes.includes('SPT Bounty'), 'SPT excluído (não é a campanha)');
  ok(!nomes.includes('Regular Daily'), 'não-SPS excluído');

  const ghost = rows.find(r => r.nome === 'SPS Ghost');
  ok(ghost && ghost.premiacao == null, 'premiação-fantasma da Ghost foi ZERADA pelo gate');
  ok(totals.excludedNoStamp && totals.excludedNoStamp.count === 1, 'fantasma contado em excludedNoStamp (1)');
  near(totals.excludedNoStamp.value, 9999, 'valor-fantasma registrado');

  // ── totais conferidos à mão ──
  ok(totals.torneios === 3, 'torneios = 3');
  ok(totals.fechados === 2, 'fechados = 2 (61-L e Turbo; Ghost ficou aberto)');
  near(totals.totalGarantido, 63000, 'garantido total (50000+10000+3000)');
  near(totals.totalPremiacao, 59000, 'premiação total (51000+8000)');
  near(totals.totalOverlay, -2000, 'overlay total (só a Turbo: 8000-10000)');

  // gross = prem/netFactor (SPS = campanha = 0,88)
  const gross = 51000 / 0.88 + 8000 / 0.88;               // 67045.4545
  near(totals.arrecadadoBruto, gross, 'arrecadado bruto');
  near(totals.rake, gross * 0.10, 'rake (10% após tirar 2% admin)');       // rakeFrac = (1-0.88)-0.02 = 0.10
  near(totals.adminFee, gross * 0.02, 'admin fee (2% do bruto, só SPS)');
  ok(totals.adminEvents === 2, 'admin fee em 2 eventos');
  near(totals.receitaCasa, gross * 0.12, 'receita da casa (rake+admin = 12%)');
  near(totals.margem, gross * 0.12 - 2000, 'margem real (receita − overlay coberto)');

  // ações = round(prem/(buyin*netFactor)); entradas = soma
  const acoes1 = Math.round(51000 / (100 * 0.88));        // 580
  const acoes2 = Math.round(8000 / (50 * 0.88));          // 182
  ok(totals.entradas === acoes1 + acoes2, 'entradas = ' + (acoes1 + acoes2));
  near(totals.ticketMedio, gross / (acoes1 + acoes2), 'ticket médio (bruto/entradas)');
  near(totals.fieldMedio, (acoes1 + acoes2) / 2, 'field médio (entradas/fechados)');

  near(totals.cobertura, 59000 / 63000 * 100, 'cobertura (prem/gtd %)');
  near(totals.overlayPctGar, 2000 / 63000 * 100, 'overlay % do gtd');
  near(totals.perfMedia, (2 + (-20)) / 2, 'perf média ((+2 e −20)/2)');   // 61-L +2%, Turbo −20%

  // categoria: 61-L é main (gtd>=20k), Turbo e Ghost são side
  ok(totals.porCategoria.main.n === 1 && totals.porCategoria.side.n === 1, 'por categoria: 1 main fechado, 1 side fechado');
}

console.log('\npainel ao vivo sobrepõe o snapshot (premiação digitada hoje):');
{
  const days = {
    '2026-08-10': {
      snap: { rows: { kA: snapRow('SPS Live', '18:00', 100, 20000, null, {}) } },   // ainda sem premiação
      day: {
        sheet: { rows: [{ nome: 'SPS Live', hora: '18:00', buyin: 100, garantido: 20000 }] },
        premiacao: {}, premBy: {}, field: {},
      },
    },
  };
  // premiação só entra COM carimbo premBy — senão o gate barra
  const key = C.rowKey({ nome: 'SPS Live', hora: '18:00', buyin: 100, garantido: 20000 });
  days['2026-08-10'].day.premiacao[key] = 25000;
  days['2026-08-10'].day.premBy[key] = { by: 'operador', at: 1 };

  const { totals } = C.computeCampaign(days, FROM, TO, { filter: C.isSPS });
  ok(totals.fechados === 1, 'evento ao vivo com carimbo entra como fechado');
  near(totals.totalPremiacao, 25000, 'premiação ao vivo (25000) sobrepõe o snapshot vazio');
}

console.log('\npremiação ao vivo SEM carimbo é barrada (anti-fantasma ao vivo):');
{
  const key = C.rowKey({ nome: 'SPS NoStamp', hora: '19:00', buyin: 100, garantido: 20000 });
  const days = {
    '2026-08-10': {
      snap: { rows: { kB: snapRow('SPS NoStamp', '19:00', 100, 20000, null, {}) } },
      day: { sheet: { rows: [{ nome: 'SPS NoStamp', hora: '19:00', buyin: 100, garantido: 20000 }] },
             premiacao: {}, premBy: {} },
    },
  };
  days['2026-08-10'].day.premiacao[key] = 30000;   // valor SEM premBy
  const { totals } = C.computeCampaign(days, FROM, TO, { filter: C.isSPS });
  ok(totals.fechados === 0, 'sem premBy → NÃO conta como fechado');
  near(totals.totalPremiacao, 0, 'premiação sem carimbo não entra no total');
}

console.log('\nfora do range da campanha:');
{
  const days = {
    '2026-07-31': { snap: { rows: { k: snapRow('SPS Antiga', '20:00', 100, 20000, 22000, { premPor: 'op' }) } } },
    '2026-09-21': { snap: { rows: { k: snapRow('SPS Depois', '20:00', 100, 20000, 22000, { premPor: 'op' }) } } },
  };
  const { totals } = C.computeCampaign(days, FROM, TO, { filter: C.isSPS });
  ok(totals.torneios === 0, 'eventos fora de 01/08–20/09 não entram');
}

/* ── SEM FEE DA GU: fora da receita, mas CONTADO ──
   Linha antiga (gravada antes de o painel guardar FEE/ADMIN FEE) não tem como
   dizer quanto a casa reteve. O sistema não inventa 10%: tira a linha da receita
   e devolve `semFee`/`semFeePrem` pra tela poder avisar. E o mapa `guFees` que o
   painel publica resolve exatamente esse caso — pelo valor da GU, não por
   estimativa. */
console.log('\nlinha sem FEE da GU:');
{
  const days = {
    '2026-08-06': { snap: { rows: {
      k1: snapRow('SPS Com Fee', '12:00', 100, 50000, 51000, { premPor: 'op' }),
      k2: snapRow('SPS Sem Fee', '13:00', 100, 50000, 44000, { premPor: 'op', semFee: true }),
    } } },
  };
  const t = C.computeCampaign(days, FROM, TO, { filter: C.isSPS }).totals;
  ok(t.semFee === 1, 'linha sem fee é CONTADA (semFee = 1)');
  near(t.semFeePrem, 44000, 'a premiação que ficou de fora é reportada');
  near(t.arrecadadoBruto, 51000 / 0.88, 'só a linha COM fee entra no arrecadado');

  // o mapa guFees (painel/guFees) resgata a linha antiga — com o valor da GU
  const mapa = { 'sps sem fee': { f: 0.10, a: 0.02 } };
  const t2 = C.computeCampaign(days, FROM, TO, { filter: C.isSPS, guFees: mapa }).totals;
  ok(t2.semFee === 0, 'com o mapa da GU, nenhuma linha fica sem fee');
  near(t2.arrecadadoBruto, (51000 + 44000) / 0.88, 'as duas entram no arrecadado');
  ok(C.guNormNome('SPS Sem Fee') === 'sps sem fee', 'guNormNome bate com a chave do mapa');
  ok(C.guFromMap(mapa, 'SPS Sem Fee').total === 0.12, 'guFromMap devolve o fee da GU');
  ok(C.guFromMap(mapa, 'Outro Torneio') === null, 'nome fora do mapa não chuta fee');
}

console.log('\n' + (fail === 0 ? '✅ ' : '❌ ') + pass + ' testes passaram' + (fail ? ', ' + fail + ' FALHARAM' : '') + '\n');
process.exit(fail ? 1 : 0);

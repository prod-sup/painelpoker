/* Testes do analytics-core.js — rode com:  node --test  (ou node analytics-core.test.js)
   O motor é PURO (require direto, sem browser). Cobre a agregação temporal do
   histórico diário: totais, séries por dia, ranking por operador e o overlay real
   (o buraco = max(0, garantido - prizePool)), que é o número que interessa. */
const test = require('node:test');
const assert = require('node:assert');
const A = require('./analytics-core.js');

/* histórico de exemplo: 2 dias + _meta (que deve ser ignorado) */
const HIST = {
  _meta: { count: 3, periodoFim: '2026-07-21' },
  d_2026_07_20: [
    { nome: 'Main A', date: '2026-07-20', overlay: 60000, garantido: 50000, field: 100, perf: 20, operador: 'Ana' },
    { nome: 'Side B', date: '2026-07-20', overlay: 30000, garantido: 40000, field: 50, perf: -25, operador: 'Ana' },
  ],
  // forma OBJETO (o RTDB às vezes devolve {0:..,1:..} em vez de array)
  d_2026_07_21: { 0: { nome: 'Main C', date: '2026-07-21', overlay: 80000, garantido: 80000, field: 120, perf: 0, operador: 'Bruno' } },
};

test('ignora _meta e conta os dias reais', () => {
  const r = A.aggregate(HIST);
  assert.strictEqual(r.totals.days, 2);
  assert.strictEqual(r.days.length, 2);
});

test('totais somam prize pool, garantido, field e eventos', () => {
  const { totals } = A.aggregate(HIST);
  assert.strictEqual(totals.events, 3);
  assert.strictEqual(totals.prizePool, 170000);   // 60k+30k+80k
  assert.strictEqual(totals.garantido, 170000);   // 50k+40k+80k
  assert.strictEqual(totals.field, 270);          // 100+50+120
});

test('overlay real = max(0, garantido - prizePool), só o Side B tem buraco', () => {
  const { totals, worst } = A.aggregate(HIST);
  assert.strictEqual(totals.overlayDeficit, 10000);   // 0 + (40k-30k) + 0
  assert.strictEqual(worst.length, 1);
  assert.strictEqual(worst[0].nome, 'Side B');
  assert.strictEqual(worst[0].deficit, 10000);
});

test('série por dia vem ordenada e com avgPerf', () => {
  const { days } = A.aggregate(HIST);
  assert.strictEqual(days[0].date, '2026-07-20');
  assert.strictEqual(days[1].date, '2026-07-21');
  assert.strictEqual(days[0].events, 2);
  assert.strictEqual(days[0].avgPerf, -2.5);          // (20 + -25)/2
  assert.strictEqual(days[1].avgPerf, 0);
  assert.strictEqual(days[0].prizePool, 90000);
});

test('lida com a forma objeto do RTDB (d_2026_07_21)', () => {
  const { days } = A.aggregate(HIST);
  assert.strictEqual(days[1].events, 1);
  assert.strictEqual(days[1].field, 120);
});

test('ranking por operador ordena por eventos, com prize e deficit', () => {
  const { byOperator } = A.aggregate(HIST);
  assert.strictEqual(byOperator[0].operador, 'Ana');   // 2 eventos
  assert.strictEqual(byOperator[0].events, 2);
  assert.strictEqual(byOperator[0].prizePool, 90000);
  assert.strictEqual(byOperator[0].overlayDeficit, 10000);
  assert.strictEqual(byOperator[1].operador, 'Bruno');
  assert.strictEqual(byOperator[1].events, 1);
});

test('melhor performance rankeia por perf desc', () => {
  const { best } = A.aggregate(HIST);
  assert.strictEqual(best[0].nome, 'Main A');   // perf 20
  assert.strictEqual(best[0].perf, 20);
});

test('histórico vazio não quebra', () => {
  const r = A.aggregate({});
  assert.strictEqual(r.totals.days, 0);
  assert.strictEqual(r.totals.prizePool, 0);
  assert.deepStrictEqual(r.days, []);
  assert.deepStrictEqual(r.worst, []);
});

test('registro sem operador cai em "—" e campos faltando viram 0', () => {
  const r = A.aggregate({ d_2026_07_22: [{ nome: 'X', date: '2026-07-22', overlay: 5000, garantido: 5000 }] });
  assert.strictEqual(r.byOperator[0].operador, '—');
  assert.strictEqual(r.days[0].field, 0);
  assert.strictEqual(r.days[0].overlayDeficit, 0);
});

test('fmtBRL agrupa milhares', () => {
  assert.strictEqual(A.fmtBRL(1234567), '1.234.567');
  assert.strictEqual(A.fmtBRL(0), '0');
});

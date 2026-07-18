/* =========================================================================
   PAINEL-CALC — a matemática de dinheiro do Painel do Dia, PURA.

   POR QUÊ ESTE ARQUIVO EXISTE
   ---------------------------
   Estes números vão pra tela e o operador decide em cima deles. O multiplicador
   de Side Event SEM campanha ficou documentado como 0.95 enquanto o código fazia
   0.90 — 5,5% de diferença nas Ações — e ninguém percebeu, porque NADA travava
   esse valor. Aqui trava: `painel-calc.test.js` pina cada regra.

   Sem DOM, sem Firebase, sem estado: entra número, sai número. É o que permite
   rodar em Node (`node painel-calc.test.js`) sem bundler nem navegador — mesma
   receita do gu-parser.js e do radar-core.js.

   COMO USAR
   ---------
   No navegador o arquivo publica `window.PainelCalc`. Em Node, `module.exports`.
   ========================================================================= */
(function (root) {
  'use strict';

  /* ── CATEGORIA ──
     Prioriza a coluna "Tipo" da planilha (tolerante a "Main event", "Satelite"
     sem acento); sem ela, cai na heurística: Seats → satélite, garantido alto →
     main, senão side. */
  function classify(row) {
    const tipoRaw = (row.tipo || '').toString().trim().toLowerCase();
    if (tipoRaw) {
      if (tipoRaw.includes('main')) return 'main';
      if (tipoRaw.includes('side')) return 'side';
      if (tipoRaw.includes('sat')) return 'sat';   // cobre "satélite" e "satelite"
    }
    const n = (row.nome || '').toLowerCase();
    if (n.includes('seats') || n.includes('seat ') || n.includes('satelite') || n.includes('satélite')) return 'sat';
    if ((row.garantido || 0) >= 20000) return 'main';
    return 'side';
  }

  /* ── CAMPANHA ──
     #AS, SPT, SPS no nome (com ou sem o "+" na frente). */
  function hasCampanha(row) {
    const n = (row.nome || '').toUpperCase();
    return n.includes('#AS') || n.includes('SPT') || n.includes('SPS');
  }

  /* ── RAKE ──
     Satélite 5%; com campanha 12%; o resto 10%. */
  function calcRake(row) {
    if (classify(row) === 'sat') return 0.05;
    if (hasCampanha(row)) return 0.12;
    return 0.10;
  }

  /* ── MULTIPLICADOR DO BUY-IN LÍQUIDO (rake factor) ──
     Main Event ............... × 0.88
     Satélite ................. × 0.95
     Side Event COM campanha .. × 0.88
     Side Event SEM campanha .. × 0.90   ← confirmado; já esteve documentado
                                            como 0.95 e divergia do código. */
  function rakeFactor(cat, isCamp) {
    if (cat === 'main') return 0.88;
    if (cat === 'sat') return 0.95;
    return isCamp ? 0.88 : 0.90;
  }

  /* ── AÇÕES = premiação ÷ buy-in líquido ──
     Antes da premiação sair, o `field` (entradas) é a melhor estimativa.
     Devolve null quando não dá pra afirmar nada — a tela mostra "—" em vez de
     um número inventado. */
  function acoes(opts) {
    const prem = num(opts.premiacao), buyin = num(opts.buyin), field = num(opts.field);
    const cat = opts.cat, isCamp = !!opts.isCamp;
    if (buyin != null && buyin > 0) {
      const liq = buyin * rakeFactor(cat, isCamp);
      if (prem != null && prem > 0 && liq > 0) return round1(prem / liq);
      if (field != null && field > 0) return field;   // estimativa pré-premiação
    }
    return null;
  }

  /* ── OVERLAY = premiação − garantido ──
     Negativo = overlay (a casa cobre a diferença); positivo = excedente. */
  function calcOverlay(prem, gar) {
    const p = num(prem), g = num(gar);
    if (p == null || !(p > 0) || g == null || !(g > 0)) return null;
    return p - g;
  }

  /* ── PERFORMANCE = (premiação − garantido) ÷ garantido, em % ── */
  function perf(prem, gar) {
    const p = num(prem), g = num(gar);
    if (p == null || !(p > 0) || g == null || !(g > 0)) return null;
    return ((p - g) / g) * 100;
  }

  /* ── PARSE DE NÚMERO BR ──
     "R$ 1.234,56" → 1234.56. Ponto é milhar e vírgula é decimal quando os dois
     aparecem; só vírgula também é decimal. */
  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (s === '') return null;
    s = s.replace(/^R\$\s*/i, '').replace(/\s/g, '');
    const hasComma = s.includes(','), hasDot = s.includes('.');
    if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
    else if (hasComma) s = s.replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function num(v) { return typeof v === 'number' ? (isFinite(v) ? v : null) : toNumber(v); }
  function round1(n) { return Math.round(n * 10) / 10; }

  const api = { classify, hasCampanha, calcRake, rakeFactor, acoes, calcOverlay, perf, toNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PainelCalc = api;
})(typeof self !== 'undefined' ? self : this);

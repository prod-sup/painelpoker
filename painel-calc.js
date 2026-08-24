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

  /* ── FEE DA GU (fonte da verdade do rake) ──
     `fee` e `adminFee` são as colunas FEE e ADMIN FEE da planilha da GU, que o
     parser cola em cada linha da grade. FEE é o rake do torneio; ADMIN FEE é a
     taxa administrativa. O que a casa retém da entrada é a SOMA das duas.

     Isto SUBSTITUI a adivinhação por nome/categoria. A regra antiga (satélite
     5% / #AS,SPT,SPS 12% / resto 10%) errava tudo que fugia do padrão: freeroll
     cobrando 10% quando é 0%, high stakes a 12% quando é 8%+2%, "Start Free"
     a 10% quando é satélite de 5%.

     A regra antiga SOBREVIVE como rede — e só isso. Linhas gravadas no Firebase
     ANTES desta mudança não têm as colunas, e o histórico do admin precisa
     continuar somando. Use `rakeSource()` pra saber qual das duas respondeu. */
  function guFrac(v) {
    const n = num(v);
    if (n == null || !isFinite(n) || n < 0) return null;
    const f = n > 1 ? n / 100 : n;      // "10" digitado no lugar de 0,10
    return f >= 1 ? null : f;           // 100% de rake é erro de digitação
  }
  /* {fee, admin, total} quando a linha traz o fee da GU; null quando não traz. */
  function guRates(row) {
    if (!row) return null;
    const fee = guFrac(row.fee);
    if (fee == null) return null;       // sem FEE não há dado da GU (admin sozinho não basta)
    const admin = guFrac(row.adminFee) || 0;
    // arredonda o RUÍDO do float: 0,10 + 0,02 dá 0,12000000000000001, e esse
    // resto vaza pra tudo que multiplica ou formata a taxa depois
    const total = Math.round((fee + admin) * 1e6) / 1e6;
    return total >= 1 ? null : { fee: fee, admin: admin, total: total };
  }
  /* 'gu' = veio da planilha · 'estimado' = caiu na regra por nome/categoria */
  function rakeSource(row) { return guRates(row) ? 'gu' : 'estimado'; }

  /* ── RAKE (retenção total da casa) ──
     GU manda; sem GU, satélite 5% · com campanha 12% · o resto 10%. */
  function calcRake(row) {
    const gu = guRates(row);
    if (gu) return gu.total;
    if (classify(row) === 'sat') return 0.05;
    if (hasCampanha(row)) return 0.12;
    return 0.10;
  }

  /* ── MULTIPLICADOR DO BUY-IN LÍQUIDO PELA CATEGORIA — A REDE ──
     ATENÇÃO: esta função NÃO enxerga o FEE da GU. Ela só sabe categoria e
     campanha, então responde apenas por linha SEM as colunas FEE/ADMIN FEE.
     Quem tem a linha na mão deve chamar `rakeFactorOf(row)` logo abaixo, que
     passa pelo calcRake e portanto pela GU.
       Satélite .............. × 0.95  (5%)
       Campanha (#AS/SPT/SPS)  × 0.88  (12%)
       Demais (inclui Main) .. × 0.90  (10%)
     O desconto depende de satélite/campanha, NÃO de "ser Main": antes o Main
     levava um 0.88 fixo (12%) que divergia do calcRake ("o resto 10%") e inflava
     as ações — ex.: 25K WarmUp (Main sem campanha, buy-in 110, prem 30.591) dava
     316 em vez de 309 corretos (30.591 ÷ (110 × 0.90) = 309). */
  function rakeFactor(cat, isCamp) {
    if (cat === 'sat') return 0.95;
    if (isCamp) return 0.88;
    return 0.90;
  }

  /* Mesmo multiplicador, mas a partir da LINHA — é esta que o painel deve usar,
     porque só ela enxerga o FEE da GU. `rakeFactor(cat,isCamp)` acima ficou pra
     quem só tem categoria na mão (calculadora manual, dados antigos). */
  function rakeFactorOf(row) {
    return 1 - calcRake(row);
  }

  /* ── AÇÕES = premiação ÷ buy-in líquido ──
     Antes da premiação sair, o `field` (entradas) é a melhor estimativa.
     Devolve null quando não dá pra afirmar nada — a tela mostra "—" em vez de
     um número inventado. */
  function acoes(opts) {
    const prem = num(opts.premiacao), buyin = num(opts.buyin), field = num(opts.field);
    const cat = opts.cat, isCamp = !!opts.isCamp;
    if (buyin != null && buyin > 0) {
      // opts.row traz o fee da GU; sem ele, cai no multiplicador por categoria
      const gu = guRates(opts.row);
      const liq = buyin * (gu ? (1 - gu.total) : rakeFactor(cat, isCamp));
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

  const api = { classify, hasCampanha, guRates, rakeSource, calcRake, rakeFactor, rakeFactorOf, acoes, calcOverlay, perf, toNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PainelCalc = api;
})(typeof self !== 'undefined' ? self : this);

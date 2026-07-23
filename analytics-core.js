/* ── SUPREMA OS · ANALYTICS (motor puro) ────────────────────────────────────
   Cruza o tempo: pega os snapshots diários que o Painel já grava em
   `historico/d_AAAA_MM_DD/` (array de registros por torneio) e agrega em séries
   e rankings. Função PURA — sem DOM, sem Firebase — testável em Node, no mesmo
   espírito de radar-core / painel-calc / suprema-insights.

   Semântica dos campos do histórico (ver appendTodayToHistorico no painel.js):
     overlay   = prize pool TOTAL gerado no evento
     garantido = garantia do evento
     premiacao = buy-in por jogador
     field     = nº de jogadores
     perf      = (prizePool - gtd) / gtd × 100
   "Overlay real" (o buraco que a casa cobre) = max(0, garantido - prizePool).

   API:
     SupremaAnalytics.aggregate(historico)  ->  { days, totals, byOperator, worst, best }
     SupremaAnalytics.fmtBRL(n)             ->  "1.234"
── */
(function (global) {
  'use strict';

  var round = function (n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; };
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; }

  function fmtBRL(n) {
    n = num(n);
    var neg = n < 0; n = Math.abs(Math.round(n));
    var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + s;
  }

  /* historico: objeto { d_2026_07_20: [rec,...], d_2026_07_21: [...], _meta: {...} } */
  function aggregate(historico) {
    historico = historico || {};
    var days = [];
    var opMap = {};            // operador -> agregado
    var allRecs = [];          // pra rankings (pior/melhor evento)

    Object.keys(historico).forEach(function (key) {
      if (key.charAt(0) === '_') return;                 // pula _meta
      var recs = historico[key];
      if (!recs) return;
      // o RTDB pode devolver array OU objeto {0:..,1:..}
      var list = Array.isArray(recs) ? recs : Object.keys(recs).map(function (k) { return recs[k]; });
      list = list.filter(Boolean);
      if (!list.length) return;

      var date = list[0].date || key.replace(/^d_/, '').replace(/_/g, '-');
      var d = { date: date, events: 0, prizePool: 0, garantido: 0, overlayDeficit: 0, field: 0, perfSum: 0, perfN: 0 };

      list.forEach(function (r) {
        var prize = num(r.overlay);        // prize pool total
        var gtd = num(r.garantido);
        var deficit = Math.max(0, gtd - prize);
        d.events += 1;
        d.prizePool += prize;
        d.garantido += gtd;
        d.overlayDeficit += deficit;
        d.field += num(r.field);
        if (r.perf != null && isFinite(num(r.perf))) { d.perfSum += num(r.perf); d.perfN += 1; }

        var op = (r.operador || '—');
        var o = opMap[op] || (opMap[op] = { operador: op, events: 0, prizePool: 0, overlayDeficit: 0, perfSum: 0, perfN: 0 });
        o.events += 1; o.prizePool += prize; o.overlayDeficit += deficit;
        if (r.perf != null && isFinite(num(r.perf))) { o.perfSum += num(r.perf); o.perfN += 1; }

        allRecs.push({ nome: r.nome || 'Torneio', date: date, hora: r.hora || null, prizePool: prize, garantido: gtd,
          deficit: deficit, field: num(r.field), perf: r.perf != null ? num(r.perf) : null, operador: op });
      });

      d.avgPerf = d.perfN ? round(d.perfSum / d.perfN, 1) : null;
      delete d.perfSum; delete d.perfN;
      days.push(d);
    });

    days.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    // totais
    var totals = { days: days.length, events: 0, prizePool: 0, garantido: 0, overlayDeficit: 0, field: 0, avgPerf: null };
    var perfSum = 0, perfN = 0;
    days.forEach(function (d) {
      totals.events += d.events; totals.prizePool += d.prizePool; totals.garantido += d.garantido;
      totals.overlayDeficit += d.overlayDeficit; totals.field += d.field;
      if (d.avgPerf != null) { perfSum += d.avgPerf; perfN += 1; }
    });
    totals.avgPerf = perfN ? round(perfSum / perfN, 1) : null;

    // por operador (ordenado por eventos)
    var byOperator = Object.keys(opMap).map(function (k) {
      var o = opMap[k];
      o.avgPerf = o.perfN ? round(o.perfSum / o.perfN, 1) : null;
      delete o.perfSum; delete o.perfN;
      return o;
    }).sort(function (a, b) { return b.events - a.events; });

    // rankings de evento: maior overlay (pior) e melhor performance
    var worst = allRecs.slice().filter(function (r) { return r.deficit > 0; })
      .sort(function (a, b) { return b.deficit - a.deficit; }).slice(0, 10);
    var best = allRecs.slice().filter(function (r) { return r.perf != null; })
      .sort(function (a, b) { return b.perf - a.perf; }).slice(0, 10);

    // ── por TORNEIO (seção Grade): cada evento recorrente somado no tempo, pra
    //    ver qual sustenta e qual drena a grade. Ordenado pelo buraco (deficit). ──
    var evMap = {};
    allRecs.forEach(function (r) {
      var e = evMap[r.nome] || (evMap[r.nome] = { nome: r.nome, runs: 0, garantido: 0, prizePool: 0, deficit: 0, ovCount: 0, field: 0, perfSum: 0, perfN: 0 });
      e.runs += 1; e.garantido += r.garantido; e.prizePool += r.prizePool; e.deficit += r.deficit; e.field += r.field;
      if (r.deficit > 0) e.ovCount += 1;
      if (r.perf != null) { e.perfSum += r.perf; e.perfN += 1; }
    });
    var byEvent = Object.keys(evMap).map(function (k) {
      var e = evMap[k];
      e.garantidoAvg = e.runs ? round(e.garantido / e.runs, 0) : 0;
      e.prizePoolAvg = e.runs ? round(e.prizePool / e.runs, 0) : 0;
      e.fieldAvg = e.runs ? round(e.field / e.runs, 0) : 0;
      e.avgPerf = e.perfN ? round(e.perfSum / e.perfN, 1) : null;
      e.ovRate = e.runs ? round(e.ovCount / e.runs * 100, 0) : 0;   // % das vezes que deu overlay
      delete e.perfSum; delete e.perfN;
      return e;
    }).sort(function (a, b) { return (b.deficit - a.deficit) || (b.runs - a.runs); });

    // ── por HORÁRIO (seção Heatmap): onde o overlay se concentra na grade do dia,
    //    por faixa de hora (HH). Só entra registro com hora conhecida. ──
    var hourMap = {};
    allRecs.forEach(function (r) {
      var h = (r.hora != null && String(r.hora).length >= 2) ? String(r.hora).slice(0, 2) : null;
      if (h == null || !/^\d\d$/.test(h)) return;
      var o = hourMap[h] || (hourMap[h] = { hour: h, runs: 0, garantido: 0, prizePool: 0, deficit: 0, ovCount: 0 });
      o.runs += 1; o.garantido += r.garantido; o.prizePool += r.prizePool; o.deficit += r.deficit;
      if (r.deficit > 0) o.ovCount += 1;
    });
    var byHour = Object.keys(hourMap).map(function (k) {
      var o = hourMap[k];
      o.ovRate = o.runs ? round(o.ovCount / o.runs * 100, 0) : 0;
      return o;
    }).sort(function (a, b) { return a.hour < b.hour ? -1 : 1; });

    return { days: days, totals: totals, byOperator: byOperator, worst: worst, best: best, byEvent: byEvent, byHour: byHour };
  }

  var API = { aggregate: aggregate, fmtBRL: fmtBRL };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.SupremaAnalytics = API;
})(typeof window !== 'undefined' ? window : globalThis);

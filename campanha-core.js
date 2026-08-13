/* =========================================================================
   CAMPANHA-CORE — motor PURO de agregação da campanha (testável em Node).

   POR QUÊ
   -------
   O board da campanha (campanha.html) precisa mostrar TOTAIS que BATEM 100%
   com o dashboard do Admin. A única forma de garantir isso sem divergir é
   reusar a MESMA lógica de agregação — não reimplementar as fórmulas.

   Este arquivo é um PORT FIEL das funções puras do admin.js:
     • classify / nhKey / rowKey / pickByKey ...... identidade e categoria
     • mergeDayInto ............................... snapshot + painel → allData
     • flatRows ................................... allData → linhas (com o GATE
       de premiação que impede o total inflar ~5× com premiação-fantasma)
     • aggregate .................................. linhas → KPIs (espelha buildDash)

   Referências de linha citadas apontam pro admin.js no momento do port. Se a
   lógica do admin mudar, ESTE arquivo é o gêmeo a atualizar (candidato natural
   a unificação futura: admin.js passar a consumir este módulo).

   Filtro da campanha: SÓ eventos com prefixo **SPS** (não SPT). A regra de
   RAKE/ADMIN-FEE por linha segue a do admin (campanha = SPS|SPT) — pra um
   evento SPS o número é idêntico ao do admin; o board só inclui o subconjunto.

   PURO: nada de DOM, Firebase ou globals. Tudo entra por parâmetro.
   ========================================================================= */
(function (root) {
  'use strict';

  var RATES_DEFAULT = { normal: 0.90, campanha: 0.88, sat: 0.95, adminPct: 0.02 };

  /* Campanha SPS: prefixo SPS no começo do nome (não pega SPT). */
  function isSPS(nome) { return /^\s*SPS\b/i.test(String(nome || '')); }
  /* Regra de campanha do ADMIN (rake/admin-fee): SPS OU SPT. Mantida idêntica
     pra o cálculo por-linha bater com o dashboard. */
  function isCampRate(nome) { return /^\s*(SPS|SPT)\b/i.test(String(nome || '')); }

  /* admin.js classify() @L104 — categoria por tipo, senão por nome/garantido. */
  function classify(r) {
    var t = (r.tipo || '').toLowerCase();
    if (t.indexOf('main') > -1) return 'main';
    if (t.indexOf('side') > -1) return 'side';
    if (t.indexOf('sat') > -1) return 'sat';
    var n = (r.nome || '').toLowerCase();
    if (n.indexOf('seat') > -1 || n.indexOf('satelit') > -1 || n.indexOf('satélite') > -1) return 'sat';
    if ((r.garantido || 0) >= 20000) return 'main';
    return 'side';
  }

  /* admin.js nhKey() @L420 — nome+hora normalizados (dedup por ocorrência). */
  function nhKey(nome, hora) {
    var n = String(nome || '').trim().toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    var h = String(hora || '').trim().replace(/^(\d{1,2}):(\d{2}).*$/, function (_, hh, mm) {
      return hh.padStart(2, '0') + ':' + mm;
    });
    return n + '|' + h;
  }

  /* admin.js rowKey() @L599 — hash nome|hora|buyin|garantido. NÃO tem sufixo _px
     (conceito só do painel; pickByKey cobre a diferença). */
  function rowKey(r) {
    var s = (r.nome) + '|' + (r.hora) + '|' + (r.buyin) + '|' + (r.garantido);
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return 'rk_' + Math.abs(h);
  }

  /* admin.js pickByKey() @L591 — busca com alias (chave viva pode divergir da do snapshot). */
  function pickByKey(map, key, r) {
    if (!map) return null;
    if (map[key] != null) return map[key];
    var alt = (r && r._altKeys) || [];
    for (var i = 0; i < alt.length; i++) if (map[alt[i]] != null) return map[alt[i]];
    if (map[key + '_px'] != null) return map[key + '_px'];
    return null;
  }

  function netFactorOf(cat, isCamp, rates) {
    return cat === 'sat' ? rates.sat : (isCamp ? rates.campanha : rates.normal);
  }

  function newDay() {
    return { rows: {}, fixed: {}, ids: {}, field: {}, prem: {}, guar: {}, buy: {}, premBy: {} };
  }

  /* admin.js mergeDayInto() @L430 — snapshot (rows prontas) + painel ao vivo
     (sheet + overlays) dentro de allData[date]. Muta e retorna allData. */
  function mergeDayInto(allData, date, snap, day) {
    // 1. snapshot
    if (snap && snap.rows && typeof snap.rows === 'object') {
      if (!allData[date]) allData[date] = newDay();
      Object.keys(snap.rows).forEach(function (k) {
        var r = snap.rows[k];
        if (!r || typeof r !== 'object') return;
        allData[date].rows[k] = Object.assign({}, r, {
          _key: k, _snap: true, _snapPrem: (r.premiacao != null ? r.premiacao : null),
        });
        if (r.premiacao != null) allData[date].prem[k] = r.premiacao;
        if (r.field != null) allData[date].field[k] = r.field;
        if (r.id) allData[date].ids[k] = { val: r.id, by: r.fixadoPor || '' };
        if (r.fixadoPor) allData[date].fixed[k] = { by: r.fixadoPor, at: r.fixadoEm || 0 };
      });
    }

    // 2. painel ao vivo
    if (day && typeof day === 'object') {
      if (!allData[date]) allData[date] = newDay();
      var existingByNomeHora = {};
      Object.keys(allData[date].rows).forEach(function (k) {
        var r = allData[date].rows[k];
        if (r && r.nome && r.hora) existingByNomeHora[nhKey(r.nome, r.hora)] = k;
      });

      var arr = (day.sheet && Array.isArray(day.sheet.rows)) ? day.sheet.rows : [];
      arr.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var mergeKey = nhKey(r.nome, r.hora);
        var existingK = existingByNomeHora[mergeKey];
        if (existingK) {
          var ex = allData[date].rows[existingK];
          if (!ex.buyin) ex.buyin = r.buyin;
          if (!ex.garantido) ex.garantido = r.garantido;
          if (!ex.late && r.late) ex.late = r.late;
          var kAlt = rowKey(r);
          if (kAlt !== existingK) (ex._altKeys || (ex._altKeys = [])).push(kAlt);
        } else {
          var k = rowKey(r);
          if (!allData[date].rows[k]) {
            allData[date].rows[k] = Object.assign({}, r, { _key: k });
            existingByNomeHora[mergeKey] = k;
          }
        }
      });

      var over = function (src, dst, wrap) {
        Object.keys(src || {}).forEach(function (k) { var v = src[k]; if (v != null) dst[k] = wrap ? wrap(v) : v; });
      };
      Object.keys(day.premiacao || {}).forEach(function (k) {
        var v = day.premiacao[k];
        if (v != null) { allData[date].prem[k] = v; if (allData[date].rows[k]) allData[date].rows[k].premiacao = v; }
      });
      over(day.fixed, allData[date].fixed, function (v) { return typeof v === 'object' ? v : { by: '', at: 0 }; });
      Object.keys(day.premBy || {}).forEach(function (k) { var v = day.premBy[k]; if (v) allData[date].premBy[k] = typeof v === 'object' ? v : { by: '', at: 0 }; });
      Object.keys(day.ids || {}).forEach(function (k) { var v = day.ids[k]; if (v != null) allData[date].ids[k] = typeof v === 'object' ? v : { val: v, by: '' }; });
      Object.keys(day.field || {}).forEach(function (k) {
        var v = day.field[k];
        if (v != null) { allData[date].field[k] = v; if (allData[date].rows[k]) allData[date].rows[k].field = v; }
      });
      Object.keys(day.garantido || {}).forEach(function (k) { var v = day.garantido[k]; if (v != null) allData[date].guar[k] = v; });
      Object.keys(day.buyin || {}).forEach(function (k) { var v = day.buyin[k]; if (v != null) allData[date].buy[k] = v; });

      // torneios manuais (admin) — entram como linhas normais
      if (day.manualRows && typeof day.manualRows === 'object') {
        Object.keys(day.manualRows).forEach(function (k) {
          var r = day.manualRows[k];
          if (!r || typeof r !== 'object' || !r.nome) return;
          allData[date].rows[k] = Object.assign({}, r, { _key: k, manual: true });
          if (r.field != null && allData[date].field[k] == null) allData[date].field[k] = r.field;
          if (r.garantido != null && allData[date].guar[k] == null) allData[date].guar[k] = r.garantido;
        });
      }
    }
    return allData;
  }

  /* admin.js flatRows() @L611 — allData → linhas, com o GATE de premiação
     (premBy ao vivo / premPor no snapshot) que impede premiação-fantasma inflar
     o total. auditData: nó `auditoria` (usado só no desempate do dedup). opts.filter
     (opcional) filtra as linhas ANTES do dedup — o board passa isSPS. */
  function flatRows(allData, auditData, fromDate, toDate, opts) {
    opts = opts || {};
    var filterFn = opts.filter || null;
    var getAudit = function (date, key) { return (auditData && auditData[date] && auditData[date][key]) || null; };
    var out = [];
    var flatExcl = { count: 0, value: 0, dates: {} };

    Object.keys(allData).forEach(function (date) {
      if (fromDate && date < fromDate) return;
      if (toDate && date > toDate) return;
      var day = allData[date];
      if (!day || !day.rows) return;
      var seenInDay = {};
      Object.keys(day.rows).forEach(function (key) {
        var r = day.rows[key];
        if (!r || typeof r !== 'object') return;
        var dedupeKey = nhKey(r.nome, r.hora);
        if (seenInDay[dedupeKey]) return;
        seenInDay[dedupeKey] = true;

        var pick = function (map) { return pickByKey(map, key, r); };

        // ── GATE de premiação (admin.js @L636) ──────────────────────────────
        var _pbGate = pick(day.premBy);
        var _hasPremBy = _pbGate != null && _pbGate !== false && _pbGate !== '';
        var livePrem = _hasPremBy ? (pick(day.prem) != null ? pick(day.prem) : null) : null;
        var _snapHasPremPor = r.premPor != null && r.premPor !== false && r.premPor !== '';
        var prem = livePrem != null ? livePrem
          : ((r._snap && _snapHasPremPor) ? (r._snapPrem != null ? r._snapPrem : null) : null);
        if (prem == null && r._snap && r._snapPrem != null && !_snapHasPremPor && !_hasPremBy) {
          flatExcl.count++; flatExcl.value += (+r._snapPrem || 0); flatExcl.dates[date] = true;
        }

        var gar = pick(day.guar); if (gar == null) gar = (r.garantido != null ? r.garantido : null);
        var idRaw = pick(day.ids);
        var idVal = (typeof idRaw === 'object' && idRaw) ? (idRaw.val || '') : (idRaw || '');
        var field = pick(day.field); if (field == null) field = (r.field != null ? r.field : null);
        var buyin = pick(day.buy); if (buyin == null) buyin = (r.buyin != null ? r.buyin : null);

        var cat = classify(r);
        var diff = (prem != null && gar != null) ? prem - gar : null;
        var ov = (diff != null && diff < 0) ? diff : null;
        var perf = (prem != null && gar != null && gar > 0) ? Math.round(((prem - gar) / gar) * 10000) / 100 : null;
        var isNF = String(idVal).toUpperCase() === 'NF';
        var status = isNF ? 'nf' : (prem != null ? 'fechado' : 'aberto');

        if (!r.nome) return;

        var isCamp = isCampRate(r.nome);
        var netFactor = netFactorOf(cat, isCamp, opts.rates || RATES_DEFAULT);
        var acoes = (prem != null && buyin) ? Math.round(prem / (buyin * netFactor)) : null;

        var row = {
          date: date, key: key, nome: r.nome || '', hora: r.hora || '', late: r.late || '',
          tipo: r.tipo || '', cat: cat, garantido: gar, buyin: buyin, netFactor: netFactor,
          premiacao: prem, overlay: ov, perf: perf, field: field, acoes: acoes,
          id: idVal, status: status,
        };
        if (filterFn && !filterFn(row.nome, row)) return;
        out.push(row);
      });
    });

    // DEDUP CROSS-DATA (admin.js @L734) — mesma ocorrência da madrugada em dois dias
    var civilOf = function (date, hora) {
      var m = String(hora || '').match(/^(\d{1,2}):(\d{2})/);
      var mins = m ? (+m[1]) * 60 + (+m[2]) : 9999;
      if (mins < 330) { var d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
      return date;
    };
    var score = function (r) { return (getAudit(r.date, r.key) ? 4 : 0) + (r.premiacao != null ? 2 : 0) + (r.id ? 1 : 0); };
    var byOcc = {};
    out.forEach(function (r) {
      var k = civilOf(r.date, r.hora) + '|' + nhKey(r.nome, r.hora);
      var prev = byOcc[k];
      if (!prev || score(r) > score(prev)) byOcc[k] = r;
    });
    var result = Object.keys(byOcc).map(function (k) { return byOcc[k]; });
    result.excludedNoStamp = { count: flatExcl.count, value: flatExcl.value, dates: Object.keys(flatExcl.dates).sort() };
    return result;
  }

  /* admin.js buildDash() @L1394-1483 — agrega as linhas nos KPIs. SEM enrichWithAudit
     (o dashboard não enriquece; as correções já voltam pros nós ao vivo). */
  function aggregate(rows, rates) {
    rates = rates || RATES_DEFAULT;
    var closed = rows.filter(function (r) { return r.premiacao != null; });
    var totalGar = rows.reduce(function (s, r) { return s + (r.garantido || 0); }, 0);
    var totalPrem = closed.reduce(function (s, r) { return s + (r.premiacao || 0); }, 0);
    var totalOv = closed.reduce(function (s, r) { return s + (r.overlay || 0); }, 0);
    var perfRows = closed.filter(function (r) { return r.perf != null; });
    var avgPerf = perfRows.length ? perfRows.reduce(function (s, r) { return s + r.perf; }, 0) / perfRows.length : null;

    var dias = {};
    rows.forEach(function (r) { dias[r.date] = true; });
    var nDias = Object.keys(dias).length;

    var grossSum = 0, rakeSum = 0, adminSum = 0, entradas = 0, adminEvents = 0;
    var mk = function () { return { gross: 0, rake: 0, admin: 0, ov: 0, gar: 0, prem: 0, n: 0 }; };
    var catAgg = { main: mk(), side: mk(), sat: mk() };
    rows.forEach(function (r) { var c = catAgg[r.cat]; if (c && r.garantido) c.gar += r.garantido; });
    closed.forEach(function (r) {
      if (r.premiacao == null || !r.netFactor) return;
      var gross = r.premiacao / r.netFactor;
      var isCamp = isCampRate(r.nome);
      var adminFrac = isCamp ? rates.adminPct : 0;
      var rakeFrac = Math.max(0, (1 - r.netFactor) - adminFrac);
      var gRake = gross * rakeFrac, gAdmin = gross * adminFrac;
      grossSum += gross; adminSum += gAdmin; rakeSum += gRake;
      if (r.acoes) entradas += r.acoes;
      if (adminFrac > 0) adminEvents++;
      var c = catAgg[r.cat];
      if (c) { c.gross += gross; c.rake += gRake; c.admin += gAdmin; c.prem += r.premiacao; if (r.overlay) c.ov += r.overlay; c.n++; }
    });
    var houseSum = rakeSum + adminSum;
    var rakePct = grossSum > 0 ? rakeSum / grossSum * 100 : 0;
    var housePct = grossSum > 0 ? houseSum / grossSum * 100 : 0;
    var cobertura = totalGar > 0 ? (totalPrem / totalGar * 100) : 0;
    var overlayPctGar = totalGar > 0 ? Math.abs(totalOv) / totalGar * 100 : 0;
    var margem = houseSum - Math.abs(totalOv);
    var ticket = entradas > 0 ? grossSum / entradas : 0;
    var fieldMed = closed.length ? entradas / closed.length : 0;
    var rakeDiaReal = nDias > 0 ? houseSum / nDias : houseSum;

    return {
      torneios: rows.length, fechados: closed.length, dias: nDias,
      totalGarantido: totalGar, totalPremiacao: totalPrem, totalOverlay: totalOv,
      arrecadadoBruto: grossSum, rake: rakeSum, adminFee: adminSum, adminEvents: adminEvents,
      receitaCasa: houseSum, margem: margem, entradas: entradas,
      ticketMedio: ticket, fieldMedio: fieldMed, perfMedia: avgPerf,
      cobertura: cobertura, overlayPctGar: overlayPctGar, rakePct: rakePct, housePct: housePct,
      rakeDiaReal: rakeDiaReal, porCategoria: catAgg,
      excludedNoStamp: rows.excludedNoStamp || null,
    };
  }

  /* Conveniência: recebe { [date]: {snap, day} }, um range e (opcional) filtro,
     e devolve { rows, totals }. É o que o board chama depois de baixar os dias. */
  function computeCampaign(days, fromDate, toDate, opts) {
    opts = opts || {};
    var rates = opts.rates || RATES_DEFAULT;
    var allData = {};
    Object.keys(days || {}).forEach(function (date) {
      mergeDayInto(allData, date, days[date] && days[date].snap, days[date] && days[date].day);
    });
    var rows = flatRows(allData, opts.auditData || {}, fromDate, toDate, { filter: opts.filter, rates: rates });
    var totals = aggregate(rows, rates);
    totals.excludedNoStamp = rows.excludedNoStamp;
    return { rows: rows, totals: totals, allData: allData };
  }

  root.CampanhaCore = {
    RATES_DEFAULT: RATES_DEFAULT,
    isSPS: isSPS, isCampRate: isCampRate,
    classify: classify, nhKey: nhKey, rowKey: rowKey, pickByKey: pickByKey, netFactorOf: netFactorOf,
    mergeDayInto: mergeDayInto, flatRows: flatRows, aggregate: aggregate, computeCampaign: computeCampaign,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CampanhaCore;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

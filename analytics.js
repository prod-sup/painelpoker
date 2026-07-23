/* ── Suprema Analytics ── página do BI histórico ─────────────────────────────
   Lê o nó `historico` (fechamentos diários do Painel), passa pelo motor puro
   analytics-core.js e desenha KPIs + gráficos (Chart.js) + rankings. Chrome via
   SupremaShell; dados via SupremaDB (fachada do Firebase, defer-safe).

   Cores das séries VALIDADAS p/ daltonismo (dataviz): teal = magnitude (prize
   pool / eventos / campo), âmbar = déficit (overlay real). Garantido NÃO é série
   — é meta, então vira LINHA DE REFERÊNCIA neutra tracejada (evita o gráfico de
   dois eixos, que inventa correlação). Uma escala Y por gráfico, sempre. */
(function () {
  'use strict';
  var A = window.SupremaAnalytics;
  var fmt = A ? A.fmtBRL : function (n) { return String(n); };
  var $ = function (id) { return document.getElementById(id); };
  var SM = window.SupremaMotion;

  /* ── chrome: relógio, operador, tema (ids vêm da shell) ── */
  function tickClock() {
    var el = $('navTime'); if (!el) return;
    el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function chrome() {
    tickClock(); setInterval(tickClock, 30000);
    // operador
    try {
      var s = SupremaAuth.getSession && SupremaAuth.getSession();
      var name = (s && (s.apelido || s.nome || s.email)) || '—';
      var nm = $('opName'), av = $('opAvatar');
      if (nm) nm.textContent = String(name).split('@')[0];
      if (av) av.textContent = String(name).trim().charAt(0).toUpperCase() || '?';
    } catch (e) {}
    // tema (chave compartilhada + sync entre abas)
    var html = document.documentElement;
    var paint = function () { var b = $('darkToggle'); if (b) b.textContent = html.classList.contains('dark') ? '☀️' : '🌙'; };
    paint();
    $('darkToggle') && $('darkToggle').addEventListener('click', function () {
      var dark = html.classList.toggle('dark');
      localStorage.setItem('suprema_dark_mode', dark ? '1' : '0'); paint();
      if (window.__redraw) window.__redraw();   // gráficos re-tema
    });
    addEventListener('storage', function (e) {
      if (e.key !== 'suprema_dark_mode' || e.newValue == null) return;
      html.classList.toggle('dark', e.newValue === '1'); paint();
      if (window.__redraw) window.__redraw();
    });
  }
  function setSync(on) {
    var el = $('syncStatus'); if (!el) return;
    el.classList.toggle('online', !!on);
    var lbl = el.querySelector('.sync-label'); if (lbl) lbl.textContent = on ? 'Sincronizado' : 'Offline';
  }

  /* ── paleta do tema pros gráficos (série teal + âmbar, validadas) ── */
  function palette() {
    var dark = document.documentElement.classList.contains('dark');
    return {
      teal:  dark ? '#12ab9b' : '#0f9d8f',                              // prize pool / eventos / campo
      amber: dark ? '#cf8020' : '#d97706',                             // overlay real (déficit)
      ref:   dark ? 'rgba(233,238,235,.5)' : 'rgba(29,29,31,.42)',     // garantido = meta (neutro)
      grid:  dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)',
      ink:   dark ? '#8b968f' : '#86868b',
      tip:   dark ? '#0b0d0c' : '#1d1d1f',
    };
  }

  var _charts = [];
  function destroyCharts() { _charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); _charts = []; }

  /* opções-base compartilhadas (grid recessivo, tooltip estilizado, sem legenda
     nativa — a legenda é HTML no card, mais controlável). */
  function baseOpts(p, moneyTip) {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: p.tip, titleColor: '#fff', bodyColor: '#e9e9ec',
          borderWidth: 0, padding: 11, cornerRadius: 12, boxPadding: 6,
          usePointStyle: true, titleFont: { size: 11, weight: '600' }, bodyFont: { size: 12 },
          callbacks: moneyTip ? {
            label: function (ctx) { return ' ' + ctx.dataset.label + ': R$ ' + fmt(ctx.parsed.y); }
          } : {
            label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y); }
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: p.ink, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 14 } },
        y: { grid: { color: p.grid }, border: { display: false }, beginAtZero: true,
             ticks: { color: p.ink, font: { size: 10 }, maxTicksLimit: 6,
                      callback: function (v) { return moneyTip ? fmt(v) : v; } } },
      },
    };
  }

  var _agg = null;
  function drawCharts(days) {
    if (!window.Chart || !days.length) return;
    destroyCharts();
    var p = palette();
    var labels = days.map(function (d) { return d.date.slice(5); });   // MM-DD

    // ── DINHEIRO: prize pool (área teal) + garantido (meta, linha tracejada
    //    neutra) + overlay real (barras âmbar). TUDO em R$ → uma escala só. ──
    _charts.push(new Chart($('chartMoney'), {
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'Overlay real', data: days.map(function (d) { return d.overlayDeficit; }),
            backgroundColor: p.amber, borderRadius: 4, borderSkipped: false, maxBarThickness: 26, order: 3 },
          { type: 'line', label: 'Prize pool', data: days.map(function (d) { return d.prizePool; }),
            borderColor: p.teal, backgroundColor: p.teal + '22', borderWidth: 2, tension: .35, fill: true,
            order: 1, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: p.teal, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 },
          { type: 'line', label: 'Garantido (meta)', data: days.map(function (d) { return d.garantido; }),
            borderColor: p.ref, borderDash: [5, 5], borderWidth: 1.5, tension: 0, fill: false, order: 2, pointRadius: 0, pointHoverRadius: 0 },
        ],
      }, options: baseOpts(p, true),
    }));

    // ── EVENTOS por dia (barras teal, escala própria) ──
    _charts.push(new Chart($('chartEvents'), {
      data: { labels: labels, datasets: [
        { type: 'bar', label: 'Eventos', data: days.map(function (d) { return d.events; }),
          backgroundColor: p.teal, borderRadius: 4, borderSkipped: false, maxBarThickness: 26 } ] },
      options: baseOpts(p, false),
    }));

    // ── CAMPO por dia (área teal, escala própria) ──
    _charts.push(new Chart($('chartField'), {
      data: { labels: labels, datasets: [
        { type: 'line', label: 'Campo', data: days.map(function (d) { return d.field; }),
          borderColor: p.teal, backgroundColor: p.teal + '22', borderWidth: 2, tension: .35, fill: true,
          pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: p.teal, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 } ] },
      options: baseOpts(p, false),
    }));
  }

  function paint(agg) {
    _agg = agg;
    var t = agg.totals, days = agg.days;

    // período
    var per = $('period'); per.classList.remove('is-error');
    if (days.length) per.textContent = 'De ' + days[0].date + ' a ' + days[days.length - 1].date + ' · ' + t.days + ' dia(s) fechado(s)';
    else per.textContent = 'Sem histórico ainda — os fechamentos do Painel aparecem aqui.';

    // KPIs
    $('kpis').innerHTML = [
      kpi('Prize pool total', 'R$ ' + fmt(t.prizePool), 'acc', 'teal', t.events + ' eventos'),
      kpi('Garantido total', 'R$ ' + fmt(t.garantido), '', 'ink', ''),
      kpi('Overlay real', 'R$ ' + fmt(t.overlayDeficit), 'warn', 'amber', 'o buraco coberto pela casa'),
      kpi('Campo total', fmt(t.field), 'pos', 'teal', 'jogadores'),
      kpi('Performance média', t.avgPerf == null ? '—' : (t.avgPerf + '%'), t.avgPerf >= 0 ? 'pos' : 'warn', 'gold', 'prize vs garantido'),
      kpi('Dias fechados', String(t.days), '', 'ink', ''),
    ].join('');

    // tabelas
    $('opTable').innerHTML = agg.byOperator.length ? tableOp(agg.byOperator) : empty('👥', 'Sem dados por operador.');
    $('worstTable').innerHTML = agg.worst.length ? tableWorst(agg.worst) : empty('🎉', 'Nenhum overlay no período.');

    // gráficos (precisa do Chart.js — pode estar deferido)
    window.__redraw = function () { drawCharts(days); };
    if (window.Chart) drawCharts(days);
    else { var t0 = Date.now(); (function wait() { if (window.Chart) drawCharts(days); else if (Date.now() - t0 < 8000) setTimeout(wait, 120); })(); }

    // motion: números rolam + cartões surgem (uma vez)
    if (SM) { try { SM.countUp('.kpi .k-val'); } catch (e) {} }
  }

  /* ── janela de tempo: filtra o histórico cru pelos N dias mais recentes e
     re-agrega (rankings e totais acompanham a janela). 0 = tudo. ── */
  var _histRaw = {}, _range = 30;
  function applyRange() {
    var keys = Object.keys(_histRaw).filter(function (k) { return k.charAt(0) !== '_' && _histRaw[k]; }).sort();
    var sub;
    if (_range > 0 && keys.length > _range) {
      sub = {}; keys.slice(-_range).forEach(function (k) { sub[k] = _histRaw[k]; });
    } else sub = _histRaw;
    paint(A.aggregate(sub));
  }
  function wireRange() {
    var box = $('range'); if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-range]'); if (!b) return;
      _range = parseInt(b.getAttribute('data-range'), 10) || 0;
      [].forEach.call(box.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      applyRange();
    });
  }

  /* ── helpers de HTML ── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function empty(icon, msg) { return '<div class="empty"><span class="big">' + icon + '</span>' + esc(msg) + '</div>'; }
  function kpi(label, val, cls, accent, sub) {
    return '<div class="kpi" data-accent="' + accent + '"><div class="k-label">' + esc(label) + '</div>'
      + '<div class="k-val ' + (cls || '') + '">' + esc(val) + '</div>'
      + (sub ? '<div class="k-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function tableOp(rows) {
    var max = rows.reduce(function (m, o) { return Math.max(m, o.prizePool || 0); }, 0) || 1;
    return '<table><thead><tr><th>Operador</th><th class="num">Eventos</th><th class="num">Prize pool</th><th class="num">Overlay</th><th class="num">Perf</th></tr></thead><tbody>'
      + rows.map(function (o, i) {
        var pct = Math.max(3, Math.round((o.prizePool || 0) / max * 100));
        return '<tr><td class="op-cell"><span class="rank' + (i === 0 ? ' top' : '') + '">' + (i + 1) + '</span>' + esc(o.operador) + '</td>'
          + '<td class="num">' + o.events + '</td>'
          + '<td class="num barcell"><span class="fill" style="width:' + pct + '%"></span><span>R$ ' + fmt(o.prizePool) + '</span></td>'
          + '<td class="num ' + (o.overlayDeficit > 0 ? 'neg' : '') + '">R$ ' + fmt(o.overlayDeficit) + '</td>'
          + '<td class="num ' + (o.avgPerf >= 0 ? 'pos' : 'neg') + '">' + (o.avgPerf == null ? '—' : o.avgPerf + '%') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function tableWorst(rows) {
    return '<table><thead><tr><th>Evento</th><th>Dia</th><th class="num">Garantido</th><th class="num">Prize pool</th><th class="num">Overlay</th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr><td>' + esc(r.nome) + '</td><td>' + esc(r.date.slice(5)) + '</td><td class="num">R$ ' + fmt(r.garantido)
          + '</td><td class="num">R$ ' + fmt(r.prizePool) + '</td><td class="num neg">R$ ' + fmt(r.deficit) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ── skeleton inicial (evita "salto" e mostra que está carregando) ── */
  function skeletonKpis() {
    var cells = ['teal', 'ink', 'amber', 'teal', 'gold', 'ink'];
    $('kpis').innerHTML = cells.map(function (a) {
      return '<div class="kpi is-loading" data-accent="' + a + '"><div class="k-label sk" style="width:60%;height:11px">&nbsp;</div><div class="k-val sk">&nbsp;</div></div>';
    }).join('');
  }

  /* ── dados via SupremaDB (defer-safe: espera o firebase) ── */
  function initData() {
    if (!window.SupremaDB || !SupremaDB.init()) { setTimeout(initData, 300); return; }
    SupremaDB.requireUser(function () {
      setSync(true);
      SupremaDB.getValue('historico').then(function (hist) { _histRaw = hist || {}; applyRange(); })
        .catch(function (e) {
          console.error('[analytics] falha ao ler historico:', e);
          var why = (e && (e.code || e.message)) ? ' (' + (e.code || e.message) + ')' : '';
          var per = $('period'); per.classList.add('is-error');
          per.textContent = 'Não foi possível ler o histórico' + why + '.';
          $('kpis').innerHTML = '';
        });
    });
    if (SupremaDB.onConnection) SupremaDB.onConnection(function (ok) { setSync(ok); });
  }

  /* ── Copiloto: snapshot do histórico agregado ── */
  function wireCopiloto() {
    if (!window.SupremaCopiloto) return;
    SupremaCopiloto.setSnapshot(function () {
      if (!_agg) return { painel: 'Analytics', obs: 'histórico ainda não carregado' };
      return {
        painel: 'Analytics (histórico)',
        janela: _range ? ('últimos ' + _range + ' dias') : 'tudo',
        totais: _agg.totals,
        porDia: _agg.days.slice(-30),
        porOperador: _agg.byOperator,
        maioresOverlays: _agg.worst,
      };
    });
  }

  /* ── navegação de seções (a unificação) ────────────────────────────────────
     Uma aba por superfície de inteligência. O indicador-pílula desliza pro tab
     ativo (transform/width, barato) e a seção que entra faz um fade-up com
     cascata. Redesenha os gráficos ao voltar pra Visão Geral (canvas escondido
     perde o tamanho). Roving tabindex + setas = navegação por teclado. */
  function wireSections() {
    var tabs = [].slice.call(document.querySelectorAll('.sectab'));
    var ind = document.querySelector('.sectab-ind');
    var bar = document.querySelector('.sectabs');
    if (!tabs.length || !bar) return;

    function moveInd(tab) {
      if (!ind || !tab) return;
      ind.style.width = tab.offsetWidth + 'px';
      ind.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
    }
    function activate(tab, focus) {
      var sec = tab.getAttribute('data-sec');
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      [].forEach.call(document.querySelectorAll('.section'), function (s) {
        if (s.id === 'sec-' + sec) {
          s.hidden = false; s.classList.add('is-active', 'enter');
          setTimeout(function () { s.classList.remove('enter'); }, 660);
        } else { s.hidden = true; s.classList.remove('is-active', 'enter'); }
      });
      moveInd(tab);
      try { tab.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {}
      if (focus) tab.focus();
      if (sec === 'overview' && window.__redraw) window.__redraw();  // canvas voltou a ser visível
    }

    tabs.forEach(function (t) { t.addEventListener('click', function () { activate(t); }); });
    bar.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(document.activeElement); if (i < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
        activate(tabs[n], true);
      }
    });

    var active = document.querySelector('.sectab.is-active') || tabs[0];
    moveInd(active);
    // re-mede depois que fontes/layout assentam e em resize
    addEventListener('load', function () { moveInd(document.querySelector('.sectab.is-active') || tabs[0]); });
    addEventListener('resize', function () { moveInd(document.querySelector('.sectab.is-active') || tabs[0]); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    chrome(); skeletonKpis(); wireRange(); wireSections(); initData(); wireCopiloto();
    if (SM) { try { SM.aurora('.hero', { tint1: 'rgba(15,157,143,.20)', tint2: 'rgba(217,119,6,.10)' }); } catch (e) {} }
  });
})();

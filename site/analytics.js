/* ── Suprema Analytics ── página do BI histórico ─────────────────────────────
   Lê o nó `historico` (fechamentos diários do Painel), passa pelo motor puro
   analytics-core.js e desenha KPIs + gráficos (Chart.js) + rankings. Chrome via
   SupremaShell; dados via SupremaDB (fachada do Firebase, defer-safe). */
(function () {
  'use strict';
  var A = window.SupremaAnalytics;
  var fmt = A ? A.fmtBRL : function (n) { return String(n); };
  var $ = function (id) { return document.getElementById(id); };

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

  /* ── cores do tema pros gráficos ── */
  function css(v, fb) { return (getComputedStyle(document.documentElement).getPropertyValue(v) || fb).trim() || fb; }
  function palette() {
    var dark = document.documentElement.classList.contains('dark');
    return {
      acc: css('--acc-bright', '#14b8a6'),
      gold: dark ? '#c9a84c' : '#8f6b2d',
      warn: '#e8933d',
      grid: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)',
      ink: dark ? '#a6b0aa' : '#6e6e73',
    };
  }

  var _charts = [];
  function destroyCharts() { _charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); _charts = []; }

  var _agg = null;
  function render(hist) {
    _agg = A.aggregate(hist);
    var t = _agg.totals, days = _agg.days;

    // período
    if (days.length) $('period').textContent = 'De ' + days[0].date + ' a ' + days[days.length - 1].date + ' · ' + t.days + ' dia(s) fechado(s)';
    else { $('period').textContent = 'Sem histórico ainda — os fechamentos do Painel aparecem aqui.'; }

    // KPIs
    $('kpis').innerHTML = [
      kpi('Prize pool total', 'R$ ' + fmt(t.prizePool), 'acc', t.events + ' eventos'),
      kpi('Garantido total', 'R$ ' + fmt(t.garantido), '', ''),
      kpi('Overlay real', 'R$ ' + fmt(t.overlayDeficit), 'warn', 'o buraco coberto pela casa'),
      kpi('Campo total', fmt(t.field), 'pos', 'jogadores'),
      kpi('Performance média', t.avgPerf == null ? '—' : (t.avgPerf + '%'), t.avgPerf >= 0 ? 'pos' : 'warn', 'prize vs garantido'),
      kpi('Dias fechados', String(t.days), '', ''),
    ].join('');

    // tabelas
    $('opTable').innerHTML = _agg.byOperator.length ? tableOp(_agg.byOperator) : '<div class="empty">Sem dados por operador.</div>';
    $('worstTable').innerHTML = _agg.worst.length ? tableWorst(_agg.worst) : '<div class="empty">Nenhum overlay no período. 🎉</div>';

    // gráficos (precisa do Chart.js — pode estar deferido)
    window.__redraw = function () { drawCharts(days); };
    if (window.Chart) drawCharts(days);
    else { var t0 = Date.now(); (function wait() { if (window.Chart) drawCharts(days); else if (Date.now() - t0 < 8000) setTimeout(wait, 120); })(); }
  }

  function drawCharts(days) {
    if (!window.Chart || !days.length) return;
    destroyCharts();
    var p = palette();
    var labels = days.map(function (d) { return d.date.slice(5); });   // MM-DD
    var opts = function (extra) {
      return Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: p.ink, boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { grid: { color: p.grid }, ticks: { color: p.ink, font: { size: 10 } } },
          y: { grid: { color: p.grid }, ticks: { color: p.ink, font: { size: 10 } } },
        },
      }, extra || {});
    };
    // dinheiro: prize pool (linha acc) vs garantido (linha gold) + overlay real (barra warn)
    _charts.push(new Chart($('chartMoney'), {
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'Overlay real', data: days.map(function (d) { return d.overlayDeficit; }), backgroundColor: p.warn + '55', borderColor: p.warn, borderWidth: 1, order: 3 },
          { type: 'line', label: 'Prize pool', data: days.map(function (d) { return d.prizePool; }), borderColor: p.acc, backgroundColor: p.acc + '22', tension: .3, fill: true, order: 1, pointRadius: 2 },
          { type: 'line', label: 'Garantido', data: days.map(function (d) { return d.garantido; }), borderColor: p.gold, borderDash: [5, 4], tension: .3, fill: false, order: 2, pointRadius: 0 },
        ],
      }, options: opts(),
    }));
    // eventos (barra) + campo (linha, eixo próprio)
    _charts.push(new Chart($('chartEvents'), {
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'Eventos', data: days.map(function (d) { return d.events; }), backgroundColor: p.acc + '99', yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Campo', data: days.map(function (d) { return d.field; }), borderColor: p.gold, tension: .3, yAxisID: 'y1', order: 1, pointRadius: 2 },
        ],
      },
      options: opts({
        scales: {
          x: { grid: { color: p.grid }, ticks: { color: p.ink, font: { size: 10 } } },
          y: { position: 'left', grid: { color: p.grid }, ticks: { color: p.ink, font: { size: 10 } }, beginAtZero: true },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: p.ink, font: { size: 10 } }, beginAtZero: true },
        },
      }),
    }));
  }

  /* ── helpers de HTML ── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function kpi(label, val, cls, sub) {
    return '<div class="kpi"><div class="k-label">' + esc(label) + '</div><div class="k-val ' + (cls || '') + '">' + esc(val) + '</div>' + (sub ? '<div class="k-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function tableOp(rows) {
    return '<table><thead><tr><th>Operador</th><th class="num">Eventos</th><th class="num">Prize pool</th><th class="num">Overlay</th><th class="num">Perf</th></tr></thead><tbody>'
      + rows.map(function (o) {
        return '<tr><td>' + esc(o.operador) + '</td><td class="num">' + o.events + '</td><td class="num">R$ ' + fmt(o.prizePool)
          + '</td><td class="num ' + (o.overlayDeficit > 0 ? 'neg' : '') + '">R$ ' + fmt(o.overlayDeficit)
          + '</td><td class="num ' + (o.avgPerf >= 0 ? 'pos' : 'neg') + '">' + (o.avgPerf == null ? '—' : o.avgPerf + '%') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function tableWorst(rows) {
    return '<table><thead><tr><th>Evento</th><th>Dia</th><th class="num">Garantido</th><th class="num">Prize pool</th><th class="num">Overlay</th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr><td>' + esc(r.nome) + '</td><td>' + esc(r.date.slice(5)) + '</td><td class="num">R$ ' + fmt(r.garantido)
          + '</td><td class="num">R$ ' + fmt(r.prizePool) + '</td><td class="num neg">R$ ' + fmt(r.deficit) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ── dados via SupremaDB (defer-safe: espera o firebase) ── */
  function initData() {
    if (!window.SupremaDB || !SupremaDB.init()) { setTimeout(initData, 300); return; }
    SupremaDB.requireUser(function () {
      setSync(true);
      SupremaDB.getValue('historico').then(function (hist) { render(hist || {}); })
        .catch(function () { $('period').textContent = 'Não foi possível ler o histórico.'; });
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
        totais: _agg.totals,
        porDia: _agg.days.slice(-30),
        porOperador: _agg.byOperator,
        maioresOverlays: _agg.worst,
      };
    });
  }

  document.addEventListener('DOMContentLoaded', function () { chrome(); initData(); wireCopiloto(); });
})();

/* =========================================================================
   SUPREMA TV — CAMPANHA SPS · CONTROL ROOM (tela única).

   FONTE (bate 100% com o dashboard do admin): as MESMAS que o admin.loadAll usa
   — snapshots/<data> + painel/<data> do range da campanha, fundidos pelo
   campanha-core (motor testado). Filtro: só SPS.

   COST-SAFE: histórico via .once (imutável); HOJE ao vivo por-filho (premiacao,
   premBy, field, garantido, buyin, manualRows, sheet) — nunca o nó-dia inteiro.

   TELA: por decisão do Brian, o board mostra APENAS o painel-mãe (control room),
   composição multi-painel cinematográfica. As demais cenas serão construídas em
   volta desta depois. Nada de rotação automática aqui.
   ========================================================================= */
'use strict';
console.info('[SUPREMA TV · SPS] control room — no ar');

var CAMP_DEFAULT = { nome: 'SPS', inicio: '2026-08-01', fim: '2026-09-20', meta: null, metaMetric: 'arrecadado' };
var CAMP = Object.assign({}, CAMP_DEFAULT);

var SNAP_BY = {};     // date -> snapshots/<date>
var PAINEL_BY = {};   // date -> painel/<date>
var AUDIT = {};       // admin-only; board (usuário 'tv') não lê auditoria
var ROWS = [];        // linhas SPS da última agregação
var GRADE = [];       // grade da GU (Global MTTS) — TODOS os SPS da semana (fonte da TV)
var T = null;         // últimos totais agregados
var _liveWired = false, _recT = null, _revealed = false;
var OV_ALERT_PCT = 8;          // overlay acima de 8% do garantido → alerta pulsante
var _closedKeys = null;        // rastro de eventos SPS já fechados (p/ toast "acabou de fechar")

/* ── helpers ─────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function isDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
function nowSPDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function clampTo() { var t = nowSPDate(); return t < CAMP.fim ? t : CAMP.fim; }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
function fmtDMY(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || ''); }
function moneyNum(v) { return Math.round(v || 0).toLocaleString('pt-BR'); }
function intNum(v) { return Math.round(v || 0).toLocaleString('pt-BR'); }
function fmtMoney(v) { return 'R$ ' + moneyNum(v); }
function fmtMoneyK(v) { v = v || 0; var a = Math.abs(v); if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'; if (a >= 1e3) return 'R$ ' + Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil'; return 'R$ ' + Math.round(v).toLocaleString('pt-BR'); }
function pctSigned(v) { return (v > 0 ? '+' : '') + (v || 0).toFixed(1).replace('.', ',') + '%'; }
function pctPlain(v) { return (v || 0).toFixed(1).replace('.', ',') + '%'; }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function shortName(n) { return String(n || '').replace(/^\s*SPS\s*/i, '').trim() || n; }
/* nome com SPS SEMPRE presente (Brian pediu) */
function fullName(n) { var s = String(n || '').trim(); return /^\s*SPS\b/i.test(s) ? s : ('SPS ' + s); }
/* chave nome+hora (casar grade da GU com dados ao vivo) */
function nhk(nome, hora) { return String(nome || '').trim().toLowerCase() + '|' + String(hora || '').trim().replace(/^(\d{1,2}):(\d{2}).*/, '$1:$2'); }
/* Main event / Side event (sat cai em side) */
function catKey(r) { return (r && r.cat === 'main') ? 'main' : 'side'; }
function catLabel(r) { return catKey(r) === 'main' ? 'Main Event' : 'Side Event'; }
function evBadge(r) { return '<span class="ev-badge ev-' + catKey(r) + '">' + catLabel(r) + '</span>'; }
function evTag(r) { var k = catKey(r); return '<i class="ev-tag ev-' + k + '" title="' + catLabel(r) + '">' + (k === 'main' ? 'MAIN' : 'SIDE') + '</i>'; }
/* meta padrão do evento: horário · buy-in · (+extra). Garantido/premiação vão no valor grande. */
function evMeta(r, extra) {
  var b = [];
  if (r.hora) b.push(esc(String(r.hora)));
  if (r.buyin) b.push('buy-in ' + fmtMoney(r.buyin));
  if (extra) b.push(extra);
  return b.join(' · ');
}
/* janela da semana (rolling 7 dias até hoje) */
function weekFrom() { var d = new Date(nowSPDate() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10); }
function inWeek(r) { return r && r.date >= weekFrom() && r.date <= nowSPDate(); }
/* operador que preencheu (painel/<data>/premBy[rowKey]) — igual à Suprema TV */
function operatorOf(r) {
  if (/[?&]demo=1/.test(location.search)) {
    var DN = ['Bruno', 'Carla', 'Diego', 'Duda', 'Rafa'], s = (r && r.nome) || '', h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return DN[Math.abs(h) % DN.length];
  }
  if (!r || !r.date || !r.key) return null;
  var day = PAINEL_BY[r.date]; if (!day || !day.premBy) return null;
  var raw = day.premBy[r.key]; if (raw == null) raw = day.premBy[r.key + '_px'];
  if (raw == null || raw === false || raw === '') return null;
  var by = typeof raw === 'string' ? raw : (raw && raw.by) || null;
  if (!by) return null;
  return String(by).split('@')[0].split(/[.\s]/)[0].replace(/^\w/, function (c) { return c.toUpperCase(); });
}
function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function seriePerf(t) { return t && t.totalGarantido > 0 ? (t.totalPremiacao / t.totalGarantido - 1) * 100 : 0; }

/* ── boot / dados ────────────────────────────────────────────── */
function initData() {
  if (!window.SupremaDB || !SupremaDB.init()) { setTimeout(initData, 300); return; }
  SupremaDB.requireUser(function () {
    console.info('[SUPREMA TV] auth ok — carregando');
    loadConfig()
      .then(loadHistory)
      .then(function () { recompute(); wireLive(); })
      .catch(function (e) { console.error('[SUPREMA TV] falha', e); showOff('Não deu pra carregar', 'Verifique a conexão — o canal tenta de novo sozinho.'); setTimeout(function () { loadHistory().then(recompute).catch(function () {}); }, 8000); });
    loadGrade();
    var lastGlobalAt = null;
    SupremaDB.watch('painel/globalMtt/at', function (snap) { var at = snap.val(); if (at == null || ('' + at) === ('' + lastGlobalAt)) return; lastGlobalAt = '' + at; loadGrade(); });
    SupremaDB.watch('campanhas/sps', function (snap) {
      var c = snap.val(); if (!c || typeof c !== 'object') return;
      var prevInicio = CAMP.inicio;
      CAMP = Object.assign({}, CAMP_DEFAULT, c); applyIdentity();
      if (CAMP.inicio !== prevInicio) loadHistory().then(recompute); else recompute();
    });
  });
  startClock(); wireFs(); mountBackground();
}
function loadConfig() {
  return SupremaDB.getValue('campanhas/sps').then(function (c) {
    if (c && typeof c === 'object') CAMP = Object.assign({}, CAMP_DEFAULT, c);
    applyIdentity();
  }).catch(function () {});
}
function loadHistory() {
  var from = CAMP.inicio, rr = SupremaDB.rawRef;
  return Promise.all([
    rr('snapshots').orderByKey().startAt(from).once('value'),
    rr('painel').orderByKey().startAt(from).once('value'),
  ]).then(function (res) {
    var s = res[0].val() || {}, p = res[1].val() || {};
    SNAP_BY = {}; PAINEL_BY = {};
    Object.keys(s).forEach(function (d) { if (isDate(d)) SNAP_BY[d] = s[d]; });
    Object.keys(p).forEach(function (d) { if (isDate(d)) PAINEL_BY[d] = p[d]; });
  });
}
/* grade da GU (Global MTTS) — TODOS os SPS da semana, com hora/nome/buyin/garantido/cat/dateISO */
function loadGrade() {
  if (typeof parseGlobalWeekAsync !== 'function' || typeof buildModel !== 'function' || !window.SupremaDB) return;
  SupremaDB.getValue('painel/globalMtt').then(function (v) {
    if (!v || !v.data) return;
    return parseGlobalWeekAsync(v.data, 'MTTS BRAZIL').then(function (parsed) {
      var model = buildModel(parsed, {});
      GRADE = (model.events || []).filter(function (e) { return CampanhaCore.isSPS(e.nome); });
      console.info('[SPS] grade da GU: ' + GRADE.length + ' eventos SPS na semana');
      if (_revealed) applyStatic();
    });
  }).catch(function (e) { console.warn('[SPS] grade Global falhou', e && (e.message || e)); });
}

function wireLive() {
  if (_liveWired) return;
  var today = nowSPDate();
  if (today < CAMP.inicio || today > CAMP.fim) return;
  _liveWired = true;
  var day = PAINEL_BY[today] = PAINEL_BY[today] || {};
  var lastSheetAt = null;
  SupremaDB.watch('painel/' + today + '/sheet/uploadedAt', function (snap) {
    var at = snap.val(); if (at == null || ('' + at) === ('' + lastSheetAt)) return;
    lastSheetAt = '' + at;
    SupremaDB.getValue('painel/' + today + '/sheet').then(function (v) { day.sheet = v; scheduleRecompute(); });
  });
  ['premiacao', 'premBy', 'field', 'garantido', 'buyin', 'manualRows'].forEach(function (node) {
    SupremaDB.watch('painel/' + today + '/' + node, function (snap) { day[node] = snap.val(); scheduleRecompute(); });
  });
  // VEM AÍ — grade SPS de amanhã ao vivo (quando a criação noturna publica)
  var tmr = isoAddDays(today, 1), lastTmrAt = null;
  SupremaDB.watch('painel/' + tmr + '/sheet/uploadedAt', function (snap) {
    var at = snap.val(); if (at == null || ('' + at) === ('' + lastTmrAt)) return;
    lastTmrAt = '' + at;
    SupremaDB.getValue('painel/' + tmr + '/sheet').then(function (v) { (PAINEL_BY[tmr] = PAINEL_BY[tmr] || {}).sheet = v; scheduleRecompute(); });
  });
  setLive(true);
}
function scheduleRecompute() { clearTimeout(_recT); _recT = setTimeout(recompute, 400); }
function recompute() {
  if (!window.CampanhaCore) return;
  var today = clampTo(), days = {};
  var okD = function (d) { return isDate(d) && d >= CAMP.inicio && d <= today; };
  Object.keys(SNAP_BY).forEach(function (d) { if (okD(d)) (days[d] = days[d] || {}).snap = SNAP_BY[d]; });
  Object.keys(PAINEL_BY).forEach(function (d) { if (okD(d)) (days[d] = days[d] || {}).day = PAINEL_BY[d]; });
  var res = CampanhaCore.computeCampaign(days, CAMP.inicio, today, { filter: CampanhaCore.isSPS, auditData: AUDIT });
  ROWS = res.rows;
  onData(res.totals);
}

/* ── identidade ──────────────────────────────────────────────── */
function applyIdentity() {
  var nome = String(CAMP.nome || 'SPS').toUpperCase();
  var yr = (CAMP.inicio || '').slice(0, 4) || '';
  setTxt('c_kicker', 'CAMPANHA ' + nome + (yr ? ' · ' + yr : ''));
  setTxt('c_serieName', nome);
  setTxt('che-period', fmtDMY(CAMP.inicio) + ' – ' + fmtDMY(CAMP.fim));
}

/* ── entrada de dados ────────────────────────────────────────── */
function onData(t) {
  if (!t) return;
  T = t;
  if (t.torneios <= 0) { if (!_revealed) showOff('Sem resultados SPS ainda', 'Assim que houver eventos SPS de ' + fmtDMY(CAMP.inicio) + ' em diante, eles entram no ar aqui.'); return; }
  applyStatic();
  detectClosures();
  if (!_revealed) reveal();
}
function reveal() {
  _revealed = true;
  var off = document.querySelector('.scene-off'); if (off) { off.classList.remove('is-active'); off.hidden = true; }
  var c = document.querySelector('.scene-control'); if (c) { c.hidden = false; c.classList.add('is-active'); }
  startDirector();
  renderTicker(); setInterval(renderTicker, 120000);
}

/* ═══════════ DIRETOR (rotação entre as telas) ═══════════ */
var SCENES = [
  { id: 'control', dwell: 15000, enter: enterControl },
  { id: 'today', dwell: 12000, enter: enterToday },
  { id: 'coming', dwell: 11000, enter: enterComing },
  { id: 'journey', dwell: 13000, enter: enterJourney },
  { id: 'ranking', dwell: 12000, enter: enterRanking },
  { id: 'giants', dwell: 12000, enter: enterGiants },
  { id: 'records', dwell: 12000, enter: enterRecords },
  { id: 'team', dwell: 11000, enter: enterTeam },
];
var _si = 0, _dirT = null, _dirStarted = false;
function startDirector() {
  if (_dirStarted) return; _dirStarted = true;
  var r = $('tvRot'); if (r) { r.hidden = false; r.innerHTML = SCENES.map(function (_, i) { return '<i data-i="' + i + '"></i>'; }).join(''); }
  _si = 0; updateRot(0);
  if (SCENES[0].enter) requestAnimationFrame(function () { requestAnimationFrame(SCENES[0].enter); });
  scheduleScene(0);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleScene(_si); });
}
function updateRot(i) {
  document.querySelectorAll('#tvRot i').forEach(function (d, k) { d.classList.toggle('on', k === i); if (k === i) d.style.setProperty('--dwell', (SCENES[i].dwell / 1000) + 's'); });
}
function scheduleScene(i) { clearTimeout(_dirT); _dirT = setTimeout(function () { gotoScene(_si + 1); }, SCENES[i].dwell); }
function triggerWipe() {
  if (reduced()) return;
  var w = $('tvWipe'); if (!w) return;
  w.classList.remove('run'); void w.offsetWidth; w.classList.add('run');
  setTimeout(function () { w.classList.remove('run'); }, 1060);
}
function gotoScene(i) {
  i = ((i % SCENES.length) + SCENES.length) % SCENES.length;
  var cur = document.querySelector('.scene.is-active');
  var next = document.querySelector('.scene[data-scene="' + SCENES[i].id + '"]');
  if (!next) { _si = i; scheduleScene(i); return; }
  if (cur !== next) {
    if (cur) { cur.classList.remove('is-active'); cur.classList.add('is-leaving'); var c = cur; setTimeout(function () { c.classList.remove('is-leaving'); c.hidden = true; }, 1350); }
    next.hidden = false; void next.offsetWidth; next.classList.remove('is-leaving'); next.classList.add('is-active');
  }
  _si = i; updateRot(i);
  if (SCENES[i].enter) requestAnimationFrame(function () { requestAnimationFrame(SCENES[i].enter); });
  scheduleScene(i);
}
function showOff(title, sub) {
  var c = document.querySelector('.scene-control'); if (c) { c.classList.remove('is-active'); c.hidden = true; }
  var o = document.querySelector('.scene-off'); if (o) { o.hidden = false; o.classList.add('is-active'); }
  setTxt('offTitle', title); setTxt('offSub', sub);
}

/* ── números animáveis do control ────────────────────────────── */
var VNUM = {
  c_perf: [function (t) { return seriePerf(t); }, pctSigned],
  c_arr: [function (t) { return t.arrecadadoBruto; }, moneyNum],
  c_arrM: [function (t) { return t.arrecadadoBruto; }, fmtMoneyK],
  c_garM: [function (t) { return t.totalGarantido; }, fmtMoneyK],
  c_arrT: [function (t) { return t.arrecadadoBruto; }, moneyNum],
  c_rakeT: [function (t) { return t.rake; }, moneyNum],
  c_adminT: [function (t) { return t.adminFee; }, moneyNum],
  c_ovT: [function (t) { return Math.abs(t.totalOverlay); }, moneyNum],
  c_perfT: [function (t) { return seriePerf(t); }, pctSigned],
};
function valOf(key) { var s = VNUM[key]; return s ? s[0](T) : 0; }
function fmtOf(key, v) { var s = VNUM[key]; return s ? s[1](v) : String(v); }
function setTxt(id, s) { var el = $(id); if (el) el.textContent = s; }
function setHTML(id, s) { var el = $(id); if (el) el.innerHTML = s; }

function applyStatic() {
  Object.keys(VNUM).forEach(function (k) { document.querySelectorAll('[data-num="' + k + '"]').forEach(function (el) { el.textContent = fmtOf(k, valOf(k)); }); });
  fillControl(T);
  renderJourney();
  renderRanking();
  renderToday();
  renderComing();
  renderGiants();
  renderRecords();
  renderTeam();
}

/* #9 toast "acabou de fechar" — detecta SPS de HOJE que fecharam desde o último recompute */
function detectClosures() {
  var todayISO = /[?&]demo=1/.test(location.search) ? null : nowSPDate();
  var closed = ROWS.filter(function (r) { return r.premiacao != null && (todayISO == null || r.date === todayISO); });
  var keyOf = function (r) { return r.date + '|' + r.nome + '|' + r.hora; };
  if (_closedKeys == null) { _closedKeys = {}; closed.forEach(function (r) { _closedKeys[keyOf(r)] = true; }); return; }  // 1ª carga: só semeia
  closed.forEach(function (r) {
    var k = keyOf(r);
    if (!_closedKeys[k]) { _closedKeys[k] = true; toast(r); }
  });
}
function toast(r) {
  var wrap = $('tvToasts'); if (!wrap || reduced()) return;
  var el = document.createElement('div');
  el.className = 'tv-toast';
  el.innerHTML = '<span class="tt-dot"></span><div class="tt-body"><div class="tt-h">Evento fechou</div>' +
    '<div class="tt-n">' + esc(shortName(r.nome)) + '</div></div><span class="tt-v">' + fmtMoneyK(r.premiacao) + '</span>';
  wrap.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 7000);
  while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
}

/* progresso da campanha (dia atual / total) */
function campaignProgress() {
  var total = daysBetween(CAMP.inicio, CAMP.fim) + 1;
  var elapsed = Math.max(1, Math.min(total, daysBetween(CAMP.inicio, clampTo()) + 1));
  return { elapsed: elapsed, total: total, pct: elapsed / total * 100 };
}
/* projeção linear no ritmo atual (fim da série) */
function projections(t) {
  var pr = campaignProgress(), f = pr.elapsed > 0 ? pr.total / pr.elapsed : 1;
  return { arr: t.arrecadadoBruto * f, rake: t.rake * f, admin: t.adminFee * f, rec: t.receitaCasa * f };
}

/* série diária a partir das ROWS — todas as métricas por dia (mesma lógica do core) */
function dailySeries() {
  var by = {};
  var get = function (d) { return by[d] = by[d] || { arr: 0, rake: 0, admin: 0, ov: 0, house: 0, prem: 0, gar: 0 }; };
  ROWS.forEach(function (r) {
    var o = get(r.date);
    if (r.garantido) o.gar += r.garantido;
    if (r.premiacao == null || !r.netFactor) return;
    var g = r.premiacao / r.netFactor;
    var isCamp = window.CampanhaCore && CampanhaCore.isCampRate(r.nome);
    var adminFrac = isCamp ? 0.02 : 0;
    var rakeFrac = Math.max(0, (1 - r.netFactor) - adminFrac);
    o.arr += g; o.rake += g * rakeFrac; o.admin += g * adminFrac; o.house += g * (1 - r.netFactor);
    o.prem += r.premiacao; if (r.overlay) o.ov += Math.abs(r.overlay);
  });
  return Object.keys(by).sort().map(function (d) { var o = by[d]; o.date = d; return o; });
}
function cumulative(days, key) { var s = 0, out = []; days.forEach(function (d) { s += d[key]; out.push(s); }); return out; }
/* série cumulativa de performance = (∑prem / ∑gar − 1)·100 por dia */
function cumPerfSeries(days) {
  var cp = 0, cg = 0, out = [];
  days.forEach(function (d) { cp += d.prem; cg += d.gar; out.push(cg > 0 ? (cp / cg - 1) * 100 : 0); });
  return out;
}
function areaPath(vals, w, h, pad) {
  pad = pad == null ? 4 : pad;
  if (!vals.length) return { line: '', area: '' };
  if (vals.length === 1) vals = [0, vals[0]];
  var mx = Math.max.apply(null, vals) || 1, n = vals.length;
  var X = function (i) { return (i / (n - 1)) * w; };
  var Y = function (v) { return h - pad - (v / mx) * (h - 2 * pad); };
  var line = vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
  return { line: line, area: line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z' };
}
/* linhas de grade horizontais discretas (estilo terminal financeiro) */
function gridLines(w, h, rows, cls) {
  var s = '', r = rows || 3;
  for (var i = 1; i <= r; i++) { var y = (h * i / (r + 1)).toFixed(1); s += '<line class="' + cls + '" x1="0" y1="' + y + '" x2="' + w + '" y2="' + y + '"/>'; }
  return s;
}
/* mini-sparkline TERMINAL (linha fina + baseline + ponto "agora"; sem área/glow) */
function renderSpark(metric, vals, stroke, gid) {
  var svg = document.querySelector('[data-spark="' + metric + '"]'); if (!svg) return;
  var p = areaPath(vals, 120, 38, 5);
  var dot = '';
  if (vals.length) {
    var mx = Math.max.apply(null, vals) || 1;
    var ly = 38 - 5 - (vals[vals.length - 1] / mx) * (38 - 10);
    dot = '<circle cx="120" cy="' + ly.toFixed(1) + '" r="2.1" fill="' + stroke + '"/>';
  }
  svg.innerHTML = '<line class="sp-base" x1="0" y1="36.5" x2="120" y2="36.5"/>' +
    '<path class="sp-line" d="' + p.line + '" fill="none" stroke="' + stroke + '"/>' + dot;
}
function renderCharts() {
  var days = dailySeries();
  var arr = cumulative(days, 'arr'), house = cumulative(days, 'house');
  var hc = $('heroChart');
  if (hc) {
    var p = areaPath(arr, 600, 260, 12);
    hc.innerHTML = '<defs><linearGradient id="hgArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(201,168,76,.12)"/><stop offset="100%" stop-color="rgba(201,168,76,0)"/></linearGradient></defs>' +
      gridLines(600, 260, 3, 'ch-grid') +
      '<path class="ch-area" d="' + p.area + '"/><path class="ch-line" d="' + p.line + '"/>';
  }
  var fc = $('fcChart');
  if (fc) {
    var q = areaPath(house, 320, 100, 8);
    fc.innerHTML = '<defs><linearGradient id="fgArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(44,199,158,.1)"/><stop offset="100%" stop-color="rgba(44,199,158,0)"/></linearGradient></defs>' +
      gridLines(320, 100, 2, 'cf-grid') +
      '<path class="cf-area" d="' + q.area + '"/><path class="cf-pathline" d="' + q.line + '"/>';
  }
  setTxt('cf-sparklast', fmtMoneyK(house.length ? house[house.length - 1] : 0));

  // faixa de totais — uma sparkline por métrica (cores dark-safe)
  renderSpark('arr', cumulative(days, 'arr'), '#e4c47c', 'spg_arr');
  renderSpark('rake', cumulative(days, 'rake'), '#2cc79e', 'spg_rake');
  renderSpark('admin', cumulative(days, 'admin'), '#6ea6ff', 'spg_admin');
  renderSpark('ov', cumulative(days, 'ov'), '#ef6f63', 'spg_ov');
  renderSpark('perf', cumPerfSeries(days), '#c9a84c', 'spg_perf');

  // tendências REAIS — dia mais recente vs. média diária (aceleração, estilo DX-R)
  var lastVsAvg = function (key) {
    if (days.length < 2) return { up: 1, pct: 0 };
    var vals = days.map(function (d) { return d[key]; });
    var avg = vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
    var last = vals[vals.length - 1];
    return { up: last >= avg ? 1 : -1, pct: avg > 0 ? (last - avg) / avg * 100 : 0 };
  };
  var ta = lastVsAvg('arr'), tr = lastVsAvg('rake'), tad = lastVsAvg('admin'), to = lastVsAvg('ov');
  setTrend('tr_arr', ta.up, false, ta.pct);
  setTrend('tr_rake', tr.up, false, tr.pct);
  setTrend('tr_admin', tad.up, false, tad.pct);
  setTrend('tr_ov', to.up, true, to.pct);                   // menos overlay = melhor (cor invertida)
  setTrend('tr_perf', seriePerf(T) >= 0 ? 1 : -1, false, null);
}
/* up = seta; good decide a COR (verde bom/vermelho ruim, invert p/ overlay); pct = ritmo vs média */
function setTrend(id, up, invert, pct) {
  var el = $(id); if (!el) return;
  var good = invert ? up < 0 : up >= 0;
  var arrow = up >= 0 ? '▲' : '▼';
  el.innerHTML = arrow + (pct == null ? '' : '<span class="mtile-pct">' + Math.abs(pct).toFixed(0) + '%</span>');
  el.classList.toggle('good', good); el.classList.toggle('bad', !good);
}

/* eventos SPS de HOJE (aparecem conforme o operador preenche no painel do dia) */
function todayTop3() {
  var pool = ROWS.filter(function (r) { return r.premiacao != null; });
  var day = /[?&]demo=1/.test(location.search) ? pool.slice()   // demo: mostra 3 (sem data real)
    : pool.filter(function (r) { return r.date === nowSPDate(); });
  return day.sort(function (a, b) { return (b.premiacao || 0) - (a.premiacao || 0); }).slice(0, 3);
}
function renderTodayTop3() {
  var el = $('today-top3'); if (!el) return;
  var top = todayTop3();
  if (!top.length) { el.innerHTML = '<div class="ct-empty"><span class="ct-empty-dot"></span>Aguardando o primeiro SPS de hoje no painel…</div>'; return; }
  el.innerHTML = top.map(function (r, i) {
    return '<div class="ct-card" data-r="' + (i + 1) + '"><div class="ct-rank">' + (i + 1) + '</div>' +
      '<div class="ct-body"><div class="ct-name">' + esc(shortName(r.nome)) + '</div>' +
      '<div class="ct-meta">' + (r.hora ? esc(String(r.hora)) + ' · ' : '') + (r.field ? intNum(r.field) + ' entradas' : (r.status === 'aberto' ? 'em andamento' : '—')) + '</div></div>' +
      '<div class="ct-prem">' + fmtMoneyK(r.premiacao) + '</div></div>';
  }).join('');
}

/* ── CONTROL ROOM — preenche o painel-mãe ───────────────────── */
function fillControl(t) {
  var pr = campaignProgress();
  setTxt('c_cob', pctPlain(t.cobertura));
  setTxt('c_arrK', fmtMoneyK(t.arrecadadoBruto));
  setTxt('c_entK', intNum(t.entradas));
  setTxt('c_entSub', 'ticket ' + fmtMoney(t.ticketMedio));
  setTxt('che-days', 'Dia ' + pr.elapsed + ' de ' + pr.total + ' · ' + intNum(t.dias) + ' dias com jogo');

  // projeção no ritmo atual (linear pelos dias decorridos)
  var proj = pr.elapsed > 0 ? t.arrecadadoBruto / pr.elapsed * pr.total : t.arrecadadoBruto;
  var projHtml = '<span class="che-proj-dot"></span>Projeção fim da série · <b>' + fmtMoney(proj) + '</b>';
  if (CAMP.meta && CAMP.meta > 0) projHtml += ' · <b>' + Math.round(proj / CAMP.meta * 100) + '%</b> da meta';
  setHTML('che-proj', projHtml);

  // #1 barra ritmo vs meta (só se a meta estiver definida)
  var cm = $('che-meta');
  if (cm && CAMP.meta && CAMP.meta > 0) {
    cm.hidden = false;
    setTxt('che-meta-pct', Math.round(t.arrecadadoBruto / CAMP.meta * 100) + '% da meta');
    var fill = $('che-meta-fill'); if (fill) fill.style.width = clamp(t.arrecadadoBruto / CAMP.meta * 100, 0, 100).toFixed(1) + '%';
    var pj = $('che-meta-proj'); if (pj) pj.style.left = clamp(proj / CAMP.meta * 100, 0, 100).toFixed(1) + '%';
  } else if (cm) { cm.hidden = true; }

  // #3 alerta de overlay acima do limite
  var ovTile = document.querySelector('.mtile[data-tone=ov]');
  if (ovTile) {
    var alert = t.overlayPctGar > OV_ALERT_PCT;
    ovTile.classList.toggle('alert', alert);
    var dot = ovTile.querySelector('.mtile-alert-dot');
    if (alert && !dot) { dot = document.createElement('div'); dot.className = 'mtile-alert-dot'; ovTile.appendChild(dot); }
    else if (!alert && dot) { dot.remove(); }
  }

  renderTodayTop3();
  setTxt('cttl-day', 'Dia ' + pr.elapsed + ' / ' + pr.total);

  // totais DETALHADOS — contexto por métrica (curto, quebra em 2 linhas)
  setTxt('sb_arr', fmtMoneyK(t.dias ? t.arrecadadoBruto / t.dias : 0) + '/dia · ' + intNum(t.entradas) + ' entr.');
  setTxt('sb_rake', pctPlain(t.rakePct) + ' do arrec. · ' + fmtMoneyK(t.dias ? t.rake / t.dias : 0) + '/dia');
  setTxt('sb_admin', t.adminEvents + ' eventos · 2% buy-in');
  setTxt('sb_ov', pctPlain(t.overlayPctGar) + ' do garantido · ' + intNum(t.fechados) + ' fech.');
  setTxt('sb_perf', 'cob. ' + pctPlain(t.cobertura) + ' · méd. ' + pctSigned(t.perfMedia == null ? 0 : t.perfMedia));

  setTxt('cf-perf', pctSigned(seriePerf(t)));
  setTxt('cf-cobpct', pctPlain(t.cobertura));
  var cob = $('cf-cob'); if (cob) cob.style.width = clamp(t.cobertura, 0, 100).toFixed(1) + '%';

  var topG = ROWS.filter(function (r) { return r.garantido; }).sort(function (a, b) { return (b.garantido || 0) - (a.garantido || 0); });
  var st = $('cst-table');
  if (st) st.innerHTML = '<div class="cst-row h"><span class="r">#</span><span class="nm">Evento</span><span class="pr">garantido</span></div>' +
    topG.slice(0, 5).map(function (r, i) {
      return '<div class="cst-row' + (i < 3 ? ' top' : '') + '"><span class="r">' + (i + 1) + '</span>' +
        '<div class="cst-ev"><div class="cst-nm">' + evTag(r) + esc(fullName(r.nome)) + '</div>' +
        '<div class="cst-sub">' + evMeta(r, r.field ? intNum(r.field) + ' jog.' : null) + '</div></div>' +
        '<span class="pr">' + fmtMoneyK(r.garantido) + '</span></div>';
    }).join('');

  renderCharts();
}

/* ── animações de entrada (números sendo "construídos") ──────── */
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function spin(el, key, dur) {
  if (!el || !T) return;
  var to = valOf(key), fmt = function (v) { return fmtOf(key, v); };
  if (reduced()) { el.textContent = fmt(to); return; }
  dur = dur || 1150; var t0 = null;
  function step(ts) { if (t0 == null) t0 = ts; var p = Math.min(1, (ts - t0) / dur); el.textContent = fmt(to * easeOut(p)); if (p < 1) requestAnimationFrame(step); }
  requestAnimationFrame(step);
}
function spinScene(sceneId) {
  document.querySelectorAll('.scene[data-scene="' + sceneId + '"] [data-num]').forEach(function (el) { spin(el, el.getAttribute('data-num')); });
}
function grow(el, pct) { if (!el) return; el.style.setProperty('--w', '0%'); void el.offsetWidth; el.style.setProperty('--w', pct); }
function drawLine(el) {
  if (!el) return;
  if (reduced()) { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; return; }
  try {
    var L = el.getTotalLength();
    el.style.transition = 'none'; el.style.strokeDasharray = L; el.style.strokeDashoffset = L;
    void el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 1.7s cubic-bezier(.22,1,.36,1)';
    el.style.strokeDashoffset = 0;
  } catch (e) {}
}
function enterControl() {
  spinScene('control');
  var cob = $('cf-cob'); if (cob && T) { cob.style.width = '0%'; void cob.offsetWidth; cob.style.width = clamp(T.cobertura, 0, 100).toFixed(1) + '%'; }
  // desenha as linhas (draw-in) e depois deixa respirando (CSS)
  drawLine(document.querySelector('#heroChart .ch-line'));
  drawLine(document.querySelector('#fcChart .cf-pathline'));
  document.querySelectorAll('.mtile-spark .sp-line').forEach(function (el, i) { setTimeout(function () { drawLine(el); }, 120 * i); });
}

/* ── TELA 2 — Jornada por dia (onda) ── */
var WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return 'M' + pts[0].x + ' ' + pts[0].y + ' L' + pts[0].x + ' ' + pts[0].y;
  var d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
  }
  return d;
}
var WEEKDAY_FULL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
var MONTH_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function dateExt(iso) { var d = new Date(iso + 'T12:00:00Z'); return WEEKDAY_FULL[d.getUTCDay()] + ' · ' + d.getUTCDate() + ' de ' + MONTH_FULL[d.getUTCMonth()]; }
/* TELA 2 — Jornada dia a dia, dados por extenso (data completa + valores cheios) */
function renderJourney() {
  if (!T) return;
  var el = $('jn-list'); if (!el) return;
  var days = dailySeries();
  var n = days.length; if (!n) { el.innerHTML = '<div class="tday-empty"><span class="ct-empty-dot"></span>Sem dias com jogo ainda…</div>'; return; }
  var vals = days.map(function (d) { return d.arr; });
  var total = vals.reduce(function (s, v) { return s + v; }, 0);
  var best = Math.max.apply(null, vals.concat(0)), bestIdx = vals.indexOf(best);
  setTxt('jn-total', fmtMoney(T.arrecadadoBruto));
  setTxt('jn-avg', fmtMoney(n ? total / n : 0));
  setTxt('jn-best', fmtMoney(best));
  var todayISO = nowSPDate();
  var evByDay = {}; ROWS.forEach(function (r) { evByDay[r.date] = (evByDay[r.date] || 0) + 1; });
  var ordered = days.slice().reverse();   // dia mais recente no topo
  el.innerHTML = ordered.map(function (d, i) {
    var w = clamp((d.arr / (best || 1)) * 100, 3, 100).toFixed(1);
    var isNow = d.date === todayISO, isBest = days.indexOf(d) === bestIdx;
    var badge = isNow ? '<span class="jn-badge now">hoje</span>' : (isBest ? '<span class="jn-badge best">melhor dia</span>' : '');
    return '<div class="jn-row' + (isNow ? ' is-now' : '') + '" style="--i:' + i + '">' +
      '<div class="jn-date"><b>' + dateExt(d.date) + '</b>' + badge + '</div>' +
      '<div class="jn-barwrap"><div class="jn-bar"><i style="width:' + w + '%"></i></div></div>' +
      '<div class="jn-metrics">' +
        '<div class="jn-m"><span>Arrecadado</span><b>' + fmtMoney(d.arr) + '</b></div>' +
        '<div class="jn-m"><span>Receita da casa</span><b>' + fmtMoney(d.house) + '</b></div>' +
        '<div class="jn-m"><span>Eventos</span><b>' + (evByDay[d.date] || 0) + '</b></div>' +
      '</div></div>';
  }).join('');
  var foot = $('jn-foot');
  if (foot) {
    var pj = projections(T);
    foot.hidden = false;
    setTxt('jp-arr', fmtMoney(pj.arr)); setTxt('jp-rake', fmtMoney(pj.rake)); setTxt('jp-rec', fmtMoney(pj.rec));
    var mw = $('jp-meta-wrap');
    if (CAMP.meta && CAMP.meta > 0) { if (mw) mw.hidden = false; setTxt('jp-meta', fmtMoney(CAMP.meta)); }
    else if (mw) mw.hidden = true;
  }
}
/* TELA 3 — Tier da Semana: TOP 5 maiores GARANTIDOS SPS da semana (rolling 7 dias) */
function renderRanking() {
  var el = $('tier-list'); if (!el) return;
  var wk = ROWS.filter(function (r) { return r.garantido && inWeek(r); })
               .sort(function (a, b) { return (b.garantido || 0) - (a.garantido || 0); });
  var seen = {}, top = [];
  wk.forEach(function (r) { var k = r.nome + '|' + r.hora; if (seen[k]) return; seen[k] = 1; if (top.length < 5) top.push(r); });
  if (!top.length) { el.innerHTML = '<div class="tier-empty"><span class="ct-empty-dot"></span>Sem garantidos SPS nesta semana ainda…</div>'; return; }
  var max = top[0].garantido || 1;
  el.innerHTML = top.map(function (r, i) {
    var w = clamp((r.garantido / max) * 100, 8, 100).toFixed(1);
    var meta = evMeta(r, r.field ? intNum(r.field) + ' jog.' : (r.status === 'aberto' ? 'a acontecer' : null));
    return '<div class="tier-row" data-r="' + (i + 1) + '" style="--i:' + i + '">' +
      '<div class="tier-rank">' + (i + 1) + '</div>' +
      '<div class="tier-body"><div class="tier-name">' + esc(fullName(r.nome)) + evBadge(r) + '</div>' +
      '<div class="tier-meta">' + meta + '</div>' +
      '<div class="tier-bar"><i style="width:' + w + '%"></i></div></div>' +
      '<div class="tier-val"><span class="tier-val-lbl">garantido</span><b>' + fmtMoneyK(r.garantido) + '</b></div></div>';
  }).join('');
}
function enterRanking() { renderRanking(); }   // rebuild p/ reiniciar a entrada encenada (CSS tv-rise)

/* ── TELA — Eventos SPS de HOJE (arrecadado preenchido) + operador que lançou ── */
function avatarLetter(name) { var l = String(name || '?').trim().charAt(0).toUpperCase() || '?'; return '<i class="tday-av">' + l + '</i>'; }
function renderToday() {
  var el = $('today-events'); if (!el) return;
  var isDemo = /[?&]demo=1/.test(location.search), t = nowSPDate();
  // TODOS os SPS de hoje da grade da GU (fechados + a acontecer); mescla o ao vivo do painel
  var pool, grToday = GRADE.filter(function (e) { return e.dateISO === t; });
  if (grToday.length && !isDemo) {
    var live = {}; ROWS.forEach(function (r) { if (r.date === t) live[nhk(r.nome, r.hora)] = r; });
    pool = grToday.map(function (e) {
      var r = live[nhk(e.nome, e.hora)] || {};
      return { nome: e.nome, hora: e.hora, cat: e.cat, date: t,
        garantido: (r.garantido != null ? r.garantido : e.garantido),
        buyin: (r.buyin != null ? r.buyin : e.buyin),
        premiacao: (r.premiacao != null ? r.premiacao : null),
        field: r.field, perf: r.perf, key: r.key, status: r.status };
    });
  } else {
    pool = ROWS.filter(function (r) { return isDemo || r.date === t; });
  }
  pool.sort(function (a, b) {
    var af = a.premiacao != null, bf = b.premiacao != null;
    if (af !== bf) return af ? -1 : 1;                                   // fechados primeiro
    if (af) return (b.premiacao || 0) - (a.premiacao || 0);             // fechados por premiação
    return String(a.hora || '~').localeCompare(String(b.hora || '~'));  // abertos por horário
  });
  if (!pool.length) { el.innerHTML = '<div class="tday-empty"><span class="ct-empty-dot"></span>Nenhum SPS na grade de hoje ainda…</div>'; return; }
  el.innerHTML = pool.slice(0, 12).map(function (r, i) {
    var op = operatorOf(r), closed = r.premiacao != null;
    var perf = r.perf != null ? pctSigned(r.perf) : null, perfCls = r.perf == null ? '' : (r.perf >= 0 ? 'pos' : 'neg');
    var stats = closed
      ? '<div class="tday-stat"><span>Garantido</span><b>' + fmtMoneyK(r.garantido) + '</b></div>' +
        '<div class="tday-stat"><span>Premiação</span><b class="hi">' + fmtMoneyK(r.premiacao) + '</b></div>' +
        '<div class="tday-stat"><span>Jogadores</span><b>' + (r.field ? intNum(r.field) : '—') + '</b></div>' +
        '<div class="tday-stat"><span>Performance</span><b class="' + perfCls + '">' + (perf || '—') + '</b></div>'
      : '<div class="tday-stat"><span>Garantido</span><b>' + fmtMoneyK(r.garantido) + '</b></div>' +
        '<div class="tday-stat"><span>Buy-in</span><b>' + (r.buyin ? fmtMoney(r.buyin) : '—') + '</b></div>' +
        '<div class="tday-stat"><span>Jogadores</span><b>' + (r.field ? intNum(r.field) : '—') + '</b></div>' +
        '<div class="tday-stat"><span>Status</span><b class="wait">a acontecer</b></div>';
    return '<div class="tday-card" data-cat="' + catKey(r) + '" data-status="' + (closed ? 'done' : 'open') + '" style="--i:' + i + '">' +
      '<div class="tday-top">' + evBadge(r) + '<span class="tday-hora">' + (r.hora ? esc(String(r.hora)) : '') + (r.buyin ? ' · buy-in ' + fmtMoney(r.buyin) : '') + '</span></div>' +
      '<div class="tday-name">' + esc(fullName(r.nome)) + '</div>' +
      '<div class="tday-stats">' + stats + '</div>' +
      (closed
        ? (op ? '<div class="tday-by">' + avatarLetter(op) + '<span><b>' + esc(op) + '</b> lançou</span></div>' : '<div class="tday-by tday-anon"><span>preenchido no painel</span></div>')
        : '<div class="tday-by tday-anon"><span>aguardando resultado</span></div>') +
      '</div>';
  }).join('');
}
function enterToday() { renderToday(); }

/* ── TELA — VEM AÍ: eventos SPS do dia seguinte (grade de amanhã) ── */
function isoAddDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function tomorrowRows() {
  var tmr = isoAddDays(nowSPDate(), 1);
  if (/[?&]demo=1/.test(location.search)) return [
    { nome: 'SPS 500K Main Event', hora: '20:00', garantido: 500000, buyin: 1000, cat: 'main', date: tmr, premiacao: null },
    { nome: 'SPS 100K Battle HR', hora: '21:00', garantido: 100000, buyin: 500, cat: 'main', date: tmr, premiacao: null },
    { nome: 'SPS 40K Sonic+76-M', hora: '19:30', garantido: 40000, buyin: 76, cat: 'side', date: tmr, premiacao: null },
    { nome: 'SPS 25K Plus+33-M', hora: '22:00', garantido: 25000, buyin: 33, cat: 'side', date: tmr, premiacao: null },
    { nome: 'SPS Sat Main Event', hora: '18:00', garantido: 5000, buyin: 22, cat: 'sat', date: tmr, premiacao: null },
  ];
  var g = GRADE.filter(function (e) { return e.dateISO === tmr; });
  if (g.length) return g.map(function (e) { return { nome: e.nome, hora: e.hora, garantido: e.garantido, buyin: e.buyin, cat: e.cat, date: e.dateISO, premiacao: null }; });
  if (!window.CampanhaCore) return [];
  var day = PAINEL_BY[tmr]; if (!day) return [];
  var days = {}; days[tmr] = { day: day };
  try { return CampanhaCore.computeCampaign(days, tmr, tmr, { filter: CampanhaCore.isSPS, auditData: {} }).rows || []; } catch (e) { return []; }
}
function renderComing() {
  var el = $('coming-events'); if (!el) return;
  var rows = tomorrowRows().slice();
  rows.sort(function (a, b) { return String(a.hora || '~').localeCompare(String(b.hora || '~')); });
  if (!rows.length) { el.innerHTML = '<div class="tday-empty"><span class="ct-empty-dot"></span>Grade SPS de amanhã ainda não publicada…</div>'; return; }
  el.innerHTML = rows.slice(0, 10).map(function (r, i) {
    return '<div class="coming-card" data-cat="' + catKey(r) + '" style="--i:' + i + '">' +
      '<div class="coming-hora">' + (r.hora ? esc(String(r.hora)) : '—') + '</div>' +
      '<div class="coming-body"><div class="coming-name">' + esc(fullName(r.nome)) + evBadge(r) + '</div>' +
      '<div class="coming-meta">Garantido <b>' + fmtMoneyK(r.garantido) + '</b>' + (r.buyin ? ' · buy-in ' + fmtMoney(r.buyin) : '') + '</div></div>' +
      '</div>';
  }).join('');
}
function enterComing() { renderComing(); }

/* ── TELA — Gigantes da Semana: maiores PREMIAÇÕES SPS da semana (estilo TV) ── */
function renderGiants() {
  var el = $('giants-list'); if (!el) return;
  var wk = ROWS.filter(function (r) { return r.premiacao != null && inWeek(r); }).sort(function (a, b) { return (b.premiacao || 0) - (a.premiacao || 0); });
  var seen = {}, top = [];
  wk.forEach(function (r) { var k = r.nome + '|' + r.hora; if (seen[k]) return; seen[k] = 1; if (top.length < 5) top.push(r); });
  if (!top.length) { el.innerHTML = '<div class="tier-empty"><span class="ct-empty-dot"></span>Sem gigantes SPS nesta semana ainda…</div>'; return; }
  var max = top[0].premiacao || 1;
  el.innerHTML = top.map(function (r, i) {
    var w = clamp((r.premiacao / max) * 100, 8, 100).toFixed(1);
    var meta = evMeta(r, 'gar. ' + fmtMoneyK(r.garantido));
    return '<div class="tier-row giant-row" data-r="' + (i + 1) + '" style="--i:' + i + '">' +
      '<div class="tier-rank">' + (i + 1) + '</div>' +
      '<div class="tier-body"><div class="tier-name">' + esc(fullName(r.nome)) + evBadge(r) + '</div>' +
      '<div class="tier-meta">' + meta + '</div><div class="tier-bar"><i style="width:' + w + '%"></i></div></div>' +
      '<div class="tier-val"><span class="tier-val-lbl">premiação</span><b>' + fmtMoneyK(r.premiacao) + '</b></div></div>';
  }).join('');
}
function enterGiants() { renderGiants(); }

/* ── TICKER (barrinha do rodapé) — resumo de hoje + eventos que vão ocorrer, idêntico à TV ── */
function renderTicker() {
  var wrap = $('ticker'), track = $('tickerTrack'); if (!wrap || !track) return;
  var t = nowSPDate(), isDemo = /[?&]demo=1/.test(location.search);
  var todayRows = ROWS.filter(function (r) { return isDemo || r.date === t; });
  var closed = todayRows.filter(function (r) { return r.premiacao != null; });
  var prem = closed.reduce(function (s, r) { return s + (r.premiacao || 0); }, 0);
  var field = todayRows.reduce(function (s, r) { return s + (r.field || 0); }, 0);
  var resumo = '<span class="tk-item tk-sum">HOJE · ' + closed.length + ' eventos SPS · ' + fmtMoney(prem) + ' em premiação · ' + intNum(field) + ' jogadores</span>';
  // "vão ocorrer": SPS de hoje ainda em aberto + a grade de amanhã
  var up = todayRows.filter(function (r) { return r.premiacao == null; }).concat(tomorrowRows());
  up.sort(function (a, b) { return (a.date + (a.hora || '~')).localeCompare(b.date + (b.hora || '~')); });
  var evItems = up.slice(0, 24).map(function (e) {
    return '<span class="tk-item"><b>' + (e.hora || '--:--') + '</b> ' + esc(fullName(e.nome)) +
      (e.buyin ? ' <i>· buy-in ' + fmtMoney(e.buyin) + '</i>' : '') +
      (e.garantido != null ? ' <em>' + fmtMoney(e.garantido) + ' gtd</em>' : '') + '</span>';
  }).join('<span class="tk-sep">♦</span>');
  var block = resumo + '<span class="tk-sep">♠</span>' + (evItems || '<span class="tk-item">Grade SPS chegando…</span>');
  track.innerHTML = block + '<span class="tk-sep">♠</span>' + block + '<span class="tk-sep">♠</span>';
  wrap.hidden = false;
  requestAnimationFrame(function () { track.style.animationDuration = Math.max(30, Math.round(track.scrollWidth / 2 / 90)) + 's'; });
}

/* ── TELA — Recordes da Semana (maior premiação + maior público SPS), estilo TV ── */
function renderRecords() {
  var el = $('records-grid'); if (!el) return;
  var wk = ROWS.filter(inWeek);
  var topPrem = wk.filter(function (r) { return r.premiacao != null; }).sort(function (a, b) { return (b.premiacao || 0) - (a.premiacao || 0); })[0];
  var topField = wk.filter(function (r) { return r.field != null; }).sort(function (a, b) { return (b.field || 0) - (a.field || 0); })[0];
  var card = function (label, r, big, bigLbl) {
    if (!r) return '<div class="rec-card" style="--i:0"><div class="rec-lbl">' + label + '</div><div class="rec-empty">Sem recorde ainda</div></div>';
    var op = operatorOf(r);
    return '<div class="rec-card" data-cat="' + catKey(r) + '" style="--i:0"><div class="rec-lbl">' + label + '</div>' +
      '<div class="rec-big">' + big + '</div><div class="rec-biglbl">' + bigLbl + '</div>' +
      '<div class="rec-name">' + evBadge(r) + esc(fullName(r.nome)) + '</div>' +
      '<div class="rec-meta">' + evMeta(r, 'gar. ' + fmtMoneyK(r.garantido)) + '</div>' +
      (op ? '<div class="rec-by">' + avatarLetter(op) + '<span><b>' + esc(op) + '</b> lançou</span></div>' : '') + '</div>';
  };
  el.innerHTML = card('Maior premiação da semana', topPrem, topPrem ? fmtMoney(topPrem.premiacao) : '—', 'em prêmios') +
                 card('Maior público da semana', topField, topField ? intNum(topField.field) : '—', 'jogadores');
}
function enterRecords() { renderRecords(); }

/* ── TELA — Quem Construiu a Série (créditos dos operadores que lançaram SPS) ── */
function renderTeam() {
  var el = $('team-list'); if (!el) return;
  var count = {};
  ROWS.filter(function (r) { return inWeek(r) && r.premiacao != null; }).forEach(function (r) { var op = operatorOf(r); if (op) count[op] = (count[op] || 0) + 1; });
  var arr = Object.keys(count).map(function (k) { return { name: k, n: count[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
  if (!arr.length) { el.innerHTML = '<div class="tier-empty"><span class="ct-empty-dot"></span>Sem lançamentos SPS registrados nesta semana…</div>'; return; }
  var max = arr[0].n || 1;
  el.innerHTML = arr.map(function (o, i) {
    var w = clamp((o.n / max) * 100, 12, 100).toFixed(0);
    return '<div class="team-card" style="--i:' + i + '">' + avatarLetter(o.name) +
      '<div class="team-body"><div class="team-name">' + esc(o.name) + '</div>' +
      '<div class="team-bar"><i style="width:' + w + '%"></i></div></div>' +
      '<div class="team-n"><b>' + o.n + '</b><span>evento' + (o.n > 1 ? 's' : '') + '</span></div></div>';
  }).join('');
}
function enterTeam() { renderTeam(); }
function enterJourney() { renderJourney(); }

/* ── chrome ──────────────────────────────────────────────────── */
function setLive(on) { var b = $('liveBadge'); if (b) b.hidden = !on; }
function startClock() {
  var el = $('clock'); if (!el) return;
  var tick = function () { el.textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()); };
  tick(); setInterval(tick, 1000);
}
function wireFs() {
  var b = $('fsBtn'); if (!b) return;
  b.addEventListener('click', function () {
    if (!document.fullscreenElement) (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
    else (document.exitFullscreen || function () {}).call(document);
  });
}

/* ── fundo: O FELTRO da Suprema TV (WebGL névoa + partículas) — config idêntica ao canal (tv.js) ── */
function mountBackground() {
  var GOLD = '#e6c34f';
  var toCanvas2D = function () {
    if (window.SupremaMotion && SupremaMotion.network)
      SupremaMotion.network('.tv-bg', { c1: GOLD, c2: '#22d47e', maxNodes: 64, linkDist: 150, isDark: function () { return true; } });
  };
  if (typeof SupremaFeltro === 'undefined') { toCanvas2D(); return; }
  var f = SupremaFeltro.mount('.tv-bg', { bg: '#0b0c10', gold: GOLD, felt: '#22d47e', onFallback: toCanvas2D });
  if (f) console.info('[SUPREMA TV · SPS] fundo O Feltro no ar — tier "' + (f.tier && f.tier()) + '"');
}

/* ── (legado) aura 2D — substituída pelo Feltro; mantida como no-op se o #ambient sumiu ── */
function ambientBg() {
  var cv = $('ambient'); if (!cv) return;
  var ctx = cv.getContext('2d');
  var dpr = Math.min(2, window.devicePixelRatio || 1), W = 0, H = 0;
  var COL = [[201, 168, 76], [14, 120, 80], [63, 121, 216]];
  var blobs = [], parts = [], t = 0, raf = 0;
  for (var i = 0; i < 3; i++) blobs.push({ x: Math.random(), y: Math.random(), r: Math.random() * .28 + .38, c: COL[i], ph: Math.random() * 6.28 });
  for (var j = 0; j < 54; j++) parts.push({ x: Math.random(), y: Math.random(), z: Math.random() * .7 + .3, s: Math.random() * .5 + .1 });
  function size() { W = cv.width = Math.floor(window.innerWidth * dpr); H = cv.height = Math.floor(window.innerHeight * dpr); }
  size(); window.addEventListener('resize', size, { passive: true });
  function draw(moving) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach(function (b) {
      var cx = (b.x + Math.sin(t * .6 + b.ph) * .13) * W, cy = (b.y + Math.cos(t * .5 + b.ph) * .13) * H;
      var rr = b.r * Math.min(W, H) * (1 + Math.sin(t + b.ph) * .08);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, 'rgba(' + b.c.join(',') + ',0.13)'); g.addColorStop(1, 'rgba(' + b.c.join(',') + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
    parts.forEach(function (p) {
      if (moving) { p.y -= p.s * .0007; if (p.y < 0) p.y = 1; }
      ctx.fillStyle = 'rgba(242,220,148,' + (0.05 * p.z) + ')';
      ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.z * 1.6 * dpr, 0, 6.2832); ctx.fill();
    });
  }
  if (reduced()) { draw(false); return; }
  function frame() { t += 0.0032; draw(true); raf = document.hidden ? 0 : requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !raf) raf = requestAnimationFrame(frame); });
}

/* ── MODO DEMO (?demo=1) — preview sem Firebase/login. Números FICTÍCIOS. ── */
function bootDemo() {
  CAMP.meta = 6000000; CAMP.metaMetric = 'arrecadado';   // meta fictícia p/ ver barra/linha de meta
  startClock(); wireFs(); applyIdentity(); mountBackground();
  var t = {
    torneios: 168, fechados: 142, dias: 11,
    totalGarantido: 3850000, totalPremiacao: 3610000, totalOverlay: -420000,
    arrecadadoBruto: 4102000, rake: 410200, adminFee: 82040, adminEvents: 142,
    receitaCasa: 492240, margem: 350240, entradas: 38650,
    ticketMedio: 106.1, fieldMedio: 272, perfMedia: 6.4,
    cobertura: 93.8, overlayPctGar: 10.9, rakePct: 10.0, housePct: 12.0, rakeDiaReal: 44749,
    porCategoria: { main: { gross: 1650000 }, side: { gross: 1980000 }, sat: { gross: 472000 } },
  };
  ROWS = [
    { nome: 'SPS 500K Main Event', premiacao: 512000, garantido: 500000, field: 1840, netFactor: 0.88, date: '2026-08-01' },
    { nome: 'SPS 200K High Roller', premiacao: 236000, garantido: 200000, field: 410, netFactor: 0.88, date: '2026-08-03' },
    { nome: 'SPS 100K Plus', premiacao: 118500, garantido: 100000, field: 2100, netFactor: 0.90, date: '2026-08-05' },
    { nome: 'SPS Bounty Hunter 80K', premiacao: 92300, garantido: 80000, field: 1560, netFactor: 0.90, date: '2026-08-07' },
    { nome: 'SPS Turbo 50K', premiacao: 61200, garantido: 50000, field: 980, netFactor: 0.90, date: '2026-08-09' },
    { nome: 'SPS Mystery 40K', premiacao: 47800, garantido: 40000, field: 1220, netFactor: 0.90, date: '2026-08-11' },
  ];
  setLive(true);
  onData(t);
  // demo: simula um evento fechando ao vivo ~4,5s depois (mostra o toast)
  setTimeout(function () {
    ROWS.push({ nome: 'SPS Sunday Special 60K', premiacao: 66000, garantido: 60000, field: 920, netFactor: 0.9, date: '2026-08-11', hora: '20:00', perf: 10 });
    applyStatic(); detectClosures();
  }, 4500);
}

function boot() { if (/[?&]demo=1/.test(location.search)) bootDemo(); else initData(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

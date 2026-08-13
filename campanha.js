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

// garantidoSerie = garantido TOTAL PLANEJADO dos 51 dias da série (não dá pra derivar dos dados,
// que só têm até a semana atual). Valor conhecido da SPS 2026; o admin pode sobrescrever em campanhas/sps.
var CAMP_DEFAULT = { nome: 'SPS', inicio: '2026-08-01', fim: '2026-09-20', meta: null, metaMetric: 'arrecadado', garantidoSerie: 100444500 };
var CAMP = Object.assign({}, CAMP_DEFAULT);

var SNAP_BY = {};     // date -> snapshots/<date>
var PAINEL_BY = {};   // date -> painel/<date>
var AUDIT = {};       // admin-only; board (usuário 'tv') não lê auditoria
var ROWS = [];        // linhas SPS da última agregação
var GRADE = [];       // grade da GU (Global MTTS) — TODOS os SPS da semana (fonte da TV)
var AVISOS = [];      // avisos da casa (hub/avisos), igual à TV
var FELTRO = null;    // instância do Feltro (WebGL) — usada pro pulso/boom na troca de cena
var T = null;         // últimos totais agregados
var _liveWired = false, _recT = null, _revealed = false;
var _dataReady = false, _bgReady = false;   // o loader só sai quando DADOS e FUNDO (vídeo) estiverem prontos
var OV_ALERT_PCT = 8;          // overlay acima de 8% do garantido → alerta pulsante
var _closedKeys = null;        // rastro de eventos SPS já fechados (p/ toast "acabou de fechar")

/* ── helpers ─────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function isDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
function nowSPDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function nowSPMin() { var s = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); var m = s.match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function horaMin(h) { var m = String(h || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
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
/* chave de EVENTO p/ dedup dos "maiores": tira o "SPS" e o código de dia (ex.: "19-M",
   "60-M"), pra o MESMO torneio recorrente na semana não repetir na lista. */
function eventKey(nome) {
  return String(nome || '').replace(/^\s*SPS\s*/i, '')
    .replace(/\b\d{1,3}\s*-\s*M\b/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
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
/* Performance da SÉRIE (agregada) = Total ARRECADADO ÷ Total GARANTIDO (dos eventos já
   rodados) − 1, em %. Ex.: arrecadou R$ 25,96 mi sobre R$ 22,98 mi de garantido → +13,0%.
   É a razão dos TOTAIS (eventos grandes pesam pelo tamanho) — NÃO a média por evento
   (perfMedia, onde cada evento pesava igual). Pedido do Brian: mostrar a da série, não a média. */
function seriePerf(t) { return (t && t.totalGarantido > 0) ? (t.arrecadadoBruto / t.totalGarantido - 1) * 100 : 0; }

/* Total GARANTIDO da SÉRIE = soma do garantido de TODOS os eventos SPS conhecidos,
   inclusive os que ainda NÃO aconteceram. Une os já jogados (ROWS, do início até hoje)
   com os agendados na grade da GU (GRADE, dias futuros da série), deduplicando por
   data|nome|hora — assim o número reflete o garantido planejado da série inteira, não só
   o que já rolou. Cobertura/forecast continuam usando o garantido já jogado (t.totalGarantido). */
function serieGarantido() {
  var seen = {}, total = 0, n = 0;
  var add = function (d, nome, hora, gar) {
    var k = (d || '') + '|' + nhk(nome, hora);
    if (seen[k]) return; seen[k] = 1; n++; total += (gar || 0);
  };
  ROWS.forEach(function (r) { add(r.date, r.nome, r.hora, r.garantido); });
  GRADE.forEach(function (e) { var d = e.dateISO || e.date; if (d && d >= CAMP.inicio && d <= CAMP.fim) add(d, e.nome, e.hora, e.garantido); });
  return { total: total, n: n };
}

/* Meta da série (métrica = arrecadado). REGRA (Brian): a meta = garantido total dos
   eventos + 20% (a casa mira arrecadar 20% acima do que garantiu pagar). Ex.: garantido
   planejado ~100,4 mi → meta ~120,5 mi. Base do garantido = CAMP.garantidoSerie (planejado
   da série); na falta dele, a soma dos eventos conhecidos (serieGarantido) ou o já-jogado
   (t.totalGarantido). Se o admin configurar em campanhas/sps uma meta MAIOR, ela prevalece. */
var META_MARGIN = 0.20;   // meta = garantido total × (1 + 20%)
function effectiveMeta(t) {
  var gar = (CAMP.garantidoSerie != null ? +CAMP.garantidoSerie : 0) || 0;
  var known = serieGarantido().total || 0;
  if (known > gar) gar = known;
  if (t && t.totalGarantido > gar) gar = t.totalGarantido;
  var floor = gar * (1 + META_MARGIN);
  var m = (CAMP.meta != null && +CAMP.meta > 0) ? +CAMP.meta : 0;
  return Math.max(m, floor);
}

/* Maiores eventos que ainda VÃO acontecer: grade da GU (de hoje até o fim da série),
   só SPS com garantido, deduplicados por evento (eventKey — mesmo torneio recorrente
   entra uma vez) e ordenados do maior garantido pro menor. */
function biggestUpcoming() {
  var isDemo = /[?&]demo=1/.test(location.search), t = nowSPDate(), seen = {}, pool;
  if (isDemo && !GRADE.length) {
    pool = ROWS.slice();
  } else {
    pool = GRADE.filter(function (e) { var d = e.dateISO || e.date; return d && d >= t && d <= CAMP.fim; })
      .map(function (e) { return { nome: e.nome, hora: e.hora, garantido: e.garantido, buyin: e.buyin, cat: e.cat, date: e.dateISO || e.date }; });
  }
  return pool.filter(function (r) { return r.garantido; })
    .sort(function (a, b) { return (b.garantido || 0) - (a.garantido || 0); })
    .filter(function (r) { var k = eventKey(r.nome); if (!k || seen[k]) return false; seen[k] = 1; return true; });
}

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
    SupremaDB.watch('hub/avisos', function (snap) {
      var v = snap.val() || {};
      AVISOS = Object.keys(v).map(function (k) { return v[k]; }).filter(function (a) { return a && a.titulo && !a.off && !a.hidden; }).slice(-6);
      if (_revealed) applyStatic();
    });
    SupremaDB.watch('campanhas/sps', function (snap) {
      var c = snap.val(); if (!c || typeof c !== 'object') return;
      var prevInicio = CAMP.inicio;
      CAMP = Object.assign({}, CAMP_DEFAULT, c); applyIdentity();
      if (CAMP.inicio !== prevInicio) loadHistory().then(recompute); else recompute();
    });
  });
  startClock(); wireFs(); mountBackground();
  // watchdog: nunca ficar preso pra sempre no "montando" — se em 14s não revelou, avisa
  setTimeout(function () {
    if (_revealed) return;
    if (!window.SupremaDB || !SupremaDB.ready || !SupremaDB.ready()) showOff('Sintonizando…', 'Sem conexão com o servidor. Confira a internet e o login — o canal tenta de novo sozinho.');
    else showOff('Aguardando dados da série', 'Conectado, mas ainda sem eventos SPS no período. Assim que entrar dado, o board sobe sozinho.');
  }, 14000);
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
  _dataReady = true; maybeReveal();   // só revela quando o fundo (vídeo) também estiver pronto
}
/* o board só "sobe" quando DADOS e FUNDO estão prontos — evita ver o telão montando sem o vídeo */
function maybeReveal() { if (_dataReady && _bgReady && !_revealed) reveal(); }
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
  { id: 'today', dwell: 22000, enter: enterToday },       // rola (grade cheia)
  { id: 'coming', dwell: 16000, enter: enterComing },     // rola
  { id: 'journey', dwell: 15000, enter: enterJourney },   // gráfico de barras (cabe inteiro)
  { id: 'week', dwell: 18000, enter: enterWeek },         // A Semana Inteira — rola
  // 'ranking' (Tier da Semana) removido da rotação a pedido do Brian.
];
var _si = 0, _dirT = null, _dirStarted = false;
/* loops por cena (auto-scroll / hero cíclico) — limpos a cada troca de cena */
var _sceneTimers = [], _scrollRAF = null;
function stopSceneLoops() { _sceneTimers.forEach(function (t) { clearInterval(t); }); _sceneTimers = []; if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; } }
/* telas com mais conteúdo descem sozinhas (estilo "s-roll" da TV) */
function autoScrollList(el, dwellMs) {
  if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
  if (!el || reduced()) return;
  el.scrollTop = 0;
  requestAnimationFrame(function () {
    var max = el.scrollHeight - el.clientHeight;
    if (max <= 6) return;
    // auto-scroll CONTÍNUO (vai-e-volta em loop) enquanto a cena está no ar: topo→desce→
    // fim→sobe→repete, com pausa nas pontas. Velocidade constante (~85px/s) p/ ler sempre igual.
    var HOLD = 2400, LEG = Math.max(3600, max / 85 * 1000), cycle = (HOLD + LEG) * 2, t0 = null;
    (function step(ts) {
      if (!el.isConnected || el.offsetParent === null) { _scrollRAF = null; return; }  // cena saiu → para sozinho
      if (t0 == null) t0 = ts;
      var pos = (ts - t0) % cycle, y;
      if (pos < HOLD) y = 0;
      else if (pos < HOLD + LEG) y = (pos - HOLD) / LEG;
      else if (pos < HOLD + LEG + HOLD) y = 1;
      else y = 1 - (pos - HOLD - LEG - HOLD) / LEG;
      el.scrollTop = max * y;
      _scrollRAF = requestAnimationFrame(step);
    })();
  });
}
function startDirector() {
  if (_dirStarted) return; _dirStarted = true;
  var r = $('tvRot'); if (r) { r.hidden = false; r.innerHTML = SCENES.map(function (_, i) { return '<i data-i="' + i + '"></i>'; }).join(''); }
  // deep-link opcional: ?scene=<id> abre direto naquela cena (útil p/ QA e p/ fixar uma tela na TV)
  var want = (location.search.match(/[?&]scene=([a-z]+)/i) || [])[1];
  var start = 0; if (want) { SCENES.forEach(function (s, i) { if (s.id === want) start = i; }); }
  _si = start; updateRot(start);
  var first = document.querySelector('.scene[data-scene="' + SCENES[start].id + '"]');
  if (first) { var off = document.querySelector('.scene.is-active'); if (off && off !== first) { off.classList.remove('is-active'); off.hidden = true; } first.hidden = false; first.classList.add('is-active'); }
  if (SCENES[start].enter) requestAnimationFrame(function () { requestAnimationFrame(SCENES[start].enter); });
  scheduleScene(start);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleScene(_si); });
  // navegação manual pelas setas do teclado (← anterior / → próxima) — reinicia o timer da cena
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); clearTimeout(_dirT); gotoScene(_si + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); clearTimeout(_dirT); gotoScene(_si - 1); }
  });
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
  stopSceneLoops();
  i = ((i % SCENES.length) + SCENES.length) % SCENES.length;
  var guard = 0;
  while (SCENES[i].skip && SCENES[i].skip() && guard++ < SCENES.length) { i = (i + 1) % SCENES.length; }   // pula cenas sem conteúdo (ex.: avisos vazios)
  var cur = document.querySelector('.scene.is-active');
  var next = document.querySelector('.scene[data-scene="' + SCENES[i].id + '"]');
  if (!next) { _si = i; scheduleScene(i); return; }
  if (cur !== next) {
    triggerWipe();                                 // wipe cinematográfico no corte (item 5)
    if (FELTRO && FELTRO.pulse) FELTRO.pulse();   // "explosão" de luz na névoa a cada corte (igual à TV)
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
  c_perf: [function (t) { return t && t.perfMedia != null ? t.perfMedia : 0; }, pctSigned],   // card grande = MÉDIA por evento (Brian pediu manter aqui)
  c_arr: [function (t) { return t.arrecadadoBruto; }, moneyNum],
  c_arrM: [function (t) { return t.arrecadadoBruto; }, fmtMoneyK],
  c_garM: [function (t) { return CAMP.garantidoSerie != null ? CAMP.garantidoSerie : t.totalGarantido; }, fmtMoneyK],
  c_garT: [function (t) { return t.totalGarantido; }, moneyNum],
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
  renderWeek();
}

/* #9 toast "acabou de fechar" — detecta SPS de HOJE que fecharam desde o último recompute */
function detectClosures() {
  var todayISO = /[?&]demo=1/.test(location.search) ? null : nowSPDate();
  var closed = ROWS.filter(function (r) { return r.premiacao != null && (todayISO == null || r.date === todayISO); });
  var keyOf = function (r) { return r.date + '|' + r.nome + '|' + r.hora; };
  if (_closedKeys == null) { _closedKeys = {}; closed.forEach(function (r) { _closedKeys[keyOf(r)] = true; }); return; }  // 1ª carga: só semeia
  closed.forEach(function (r) {
    var k = keyOf(r);
    if (!_closedKeys[k]) { _closedKeys[k] = true; showBoom(r); }
  });
}
/* #boom full-screen — quando um SPS fecha, comemora IGUAL À SUPREMA TV:
   confete em canvas + chip "PREMIAÇÃO CONFIRMADA" + valor em count-up + "superou/bateu o garantido". */
function boomHTML(r) {
  var op = operatorOf(r), gar = r.garantido || 0, diff = (r.premiacao || 0) - gar;
  var sub = gar > 0
    ? (diff > 0 ? 'superou o garantido de ' + fmtMoney(gar) + ' em <b>' + fmtMoney(diff) + '</b>'
                : 'bateu o garantido de ' + fmtMoney(gar))
    : 'em premiação';
  return '<canvas id="confettiCv" aria-hidden="true"></canvas>' +
    '<div class="boom-stage">' +
    '<div class="boom-chip">🎉 PREMIAÇÃO CONFIRMADA</div>' +
    '<div class="boom-name">' + evBadge(r) + esc(fullName(r.nome)) + '</div>' +
    '<div class="boom-big"><span class="pre">R$</span><span id="boomVal">0</span></div>' +
    '<div class="boom-lbl">' + sub + (r.field ? ' · ' + intNum(r.field) + ' jogadores' : '') + '</div>' +
    (op ? '<div class="boom-by">' + avatarLetter(op) + '<span><b>' + esc(op) + '</b> lançou</span></div>' : '') +
    '</div>';
}
/* count-up do valor (ease-out cúbico), respeitando reduced-motion */
function boomCountUp(id, to, ms) {
  var el = $(id); if (!el) return;
  if (reduced()) { el.textContent = moneyNum(to); return; }
  var t0 = null;
  function step(ts) {
    if (t0 == null) t0 = ts;                                  // t0 vem do 1º rAF (mesma base de tempo)
    var p = Math.max(0, Math.min(1, (ts - t0) / ms));         // clamp [0,1] — nunca estoura p/ negativo
    el.textContent = moneyNum(to * (1 - Math.pow(1 - p, 3))); // ease-out cúbico
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
/* confete em canvas — leve, autolimitado, cores da casa (idêntico à Suprema TV) */
function boomConfetti(cv, ms) {
  if (!cv || reduced()) return;
  var ctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
  var W = cv.width = window.innerWidth * dpr, H = cv.height = window.innerHeight * dpr;
  var COLORS = ['#e8c884', '#e6c34f', '#22d47e', '#f4a9ba', '#5aa8ff', '#f0ede8'];
  var P = []; for (var i = 0; i < 150; i++) P.push({
    x: Math.random() * W, y: -Math.random() * H * .4,
    vx: (Math.random() - .5) * 2.4 * dpr, vy: (1.6 + Math.random() * 2.6) * dpr,
    w: (5 + Math.random() * 7) * dpr, h: (8 + Math.random() * 10) * dpr,
    rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .18, c: COLORS[(Math.random() * COLORS.length) | 0],
  });
  var t0 = performance.now();
  (function frame(t) {
    if (!cv.isConnected || t - t0 > ms) return;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, Math.max(0, (ms - (t - t0)) / 1500));
    P.forEach(function (p) {
      p.x += p.vx + Math.sin(t / 450 + p.rot) * .7 * dpr; p.y += p.vy; p.rot += p.vr;
      if (p.y > H + 30) { p.y = -20; p.x = Math.random() * W; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    requestAnimationFrame(frame);
  })(t0);
}
var _boomQ = [], _boomActive = false;
function showBoom(r) { if (r && r.premiacao != null) { _boomQ.push(r); if (!_boomActive) nextBoom(); } }
function nextBoom() {
  var el = $('boom'); if (!el || !_boomQ.length) { _boomActive = false; return; }
  _boomActive = true;
  var r = _boomQ.shift();
  clearTimeout(_dirT);                                 // pausa a rotação enquanto o boom toca
  el.innerHTML = boomHTML(r);
  el.hidden = false; void el.offsetWidth; el.classList.add('run');
  requestAnimationFrame(function () {
    boomConfetti(document.getElementById('confettiCv'), 9000);   // confete por 9s (igual TV)
    boomCountUp('boomVal', r.premiacao, 1500);                    // valor sobe em count-up
  });
  setTimeout(function () {
    el.classList.remove('run');
    setTimeout(function () {
      el.hidden = true;
      if (_boomQ.length) nextBoom();
      else { _boomActive = false; if (_dirStarted) scheduleScene(_si); }   // retoma a rotação
    }, 700);
  }, 11000);                                           // ~12s no total (igual TV)
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
    '<path class="sp-line" pathLength="1" d="' + p.line + '" fill="none" stroke="' + stroke + '"/>' + dot;
}
function renderCharts() {
  var days = dailySeries();
  var arr = cumulative(days, 'arr'), house = cumulative(days, 'house');
  var hc = $('heroChart');
  if (hc) {
    var p = areaPath(arr, 600, 260, 12);
    hc.innerHTML = '<defs><linearGradient id="hgArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(201,168,76,.12)"/><stop offset="100%" stop-color="rgba(201,168,76,0)"/></linearGradient></defs>' +
      gridLines(600, 260, 3, 'ch-grid') +
      '<path class="ch-area" d="' + p.area + '"/><path class="ch-line" pathLength="1" d="' + p.line + '"/>';
  }
  var fc = $('fcChart');
  if (fc) {
    var q = areaPath(house, 320, 100, 8);
    fc.innerHTML = '<defs><linearGradient id="fgArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(44,199,158,.1)"/><stop offset="100%" stop-color="rgba(44,199,158,0)"/></linearGradient></defs>' +
      gridLines(320, 100, 2, 'cf-grid') +
      '<path class="cf-area" d="' + q.area + '"/><path class="cf-pathline" pathLength="1" d="' + q.line + '"/>';
  }
  setTxt('cf-sparklast', fmtMoneyK(house.length ? house[house.length - 1] : 0));

  // faixa de totais — uma sparkline por métrica (cores dark-safe)
  renderSpark('gar', cumulative(days, 'gar'), '#c9a84c', 'spg_gar');
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
  var tg = lastVsAvg('gar'), to = lastVsAvg('ov');
  setTrend('tr_gar', tg.up, false, tg.pct);
  // Total Arrecadado → % = PERFORMANCE DA SÉRIE (arrecadado ÷ garantido dos eventos rodados − 1)
  var perfSerie = T && T.totalGarantido > 0 ? (T.arrecadadoBruto / T.totalGarantido - 1) * 100 : 0;
  setTrend('tr_arr', perfSerie >= 0 ? 1 : -1, false, perfSerie);
  // Rake e Admin → sem % (nem seta)
  setTrend('tr_rake', 0, false, false);
  setTrend('tr_admin', 0, false, false);
  // Total Overlay → % = ÍNDICE DE OVERLAY (overlay ÷ garantido dos eventos rodados)
  setTrend('tr_ov', to.up, true, T ? T.overlayPctGar : 0);
  setTrend('tr_perf', seriePerf(T) >= 0 ? 1 : -1, false, null);
}
/* up = seta; good decide a COR (verde bom/vermelho ruim, invert p/ overlay); pct = valor a mostrar.
   pct === false → esconde o indicador inteiro (sem seta, sem %). pct == null → só a seta. */
function setTrend(id, up, invert, pct) {
  var el = $(id); if (!el) return;
  if (pct === false) { el.innerHTML = ''; el.classList.remove('good', 'bad'); return; }
  var good = invert ? up < 0 : up >= 0;
  var arrow = up >= 0 ? '▲' : '▼';
  var a = Math.abs(pct);
  var num = pct == null ? '' : '<span class="mtile-pct">' + (a < 10 ? a.toFixed(1).replace('.', ',') : a.toFixed(0)) + '%</span>';
  el.innerHTML = arrow + num;
  el.classList.toggle('good', good); el.classList.toggle('bad', !good);
}

/* eventos SPS ROLANDO AGORA — os que já começaram (hora ≤ agora) e ainda não fecharam.
   Fallbacks p/ nunca ficar vazio: próximos a começar hoje → maiores já fechados hoje. */
/* "late continua aberto" = o horário de fim do late reg (campo `late`, HH:MM) ainda não passou.
   Trata late que cruza a meia-noite (ex.: começa 23:00, late até 01:00). */
function lateStillOpen(r, nowM) {
  var s = horaMin(r.hora), l = horaMin(r.late);
  if (l == null || nowM == null) return false;         // sem hora de late definida → não é "rolando agora"
  if (s != null && l < s) l += 1440;                   // late passou da meia-noite
  var now = nowM; if (s != null && now < s) now += 1440;
  return now >= (s == null ? now : s) && now < l;      // já começou e late ainda aberto
}
function runningNow() {
  var isDemo = /[?&]demo=1/.test(location.search), t = nowSPDate(), nowM = nowSPMin();
  // grade de HOJE mesclada com o ao vivo do painel (traz `late` da grade e do painel)
  var pool, grToday = GRADE.filter(function (e) { return e.dateISO === t; });
  if (grToday.length && !isDemo) {
    var live = {}; ROWS.forEach(function (r) { if (r.date === t) live[nhk(r.nome, r.hora)] = r; });
    pool = grToday.map(function (e) {
      var r = live[nhk(e.nome, e.hora)] || {};
      return { nome: e.nome, hora: e.hora, late: (r.late != null && r.late !== '' ? r.late : e.late), cat: e.cat, date: t,
        garantido: (r.garantido != null ? r.garantido : e.garantido), buyin: (r.buyin != null ? r.buyin : e.buyin),
        premiacao: (r.premiacao != null ? r.premiacao : null), field: r.field, status: r.status };
    });
  } else {
    pool = ROWS.filter(function (r) { return isDemo || r.date === t; });
  }
  // ROLANDO AGORA = arrecadado NÃO preenchido (premiacao == null) E late ainda aberto (agora < fim do late).
  var live2 = pool.filter(function (r) { return r.premiacao == null && (isDemo ? true : lateStillOpen(r, nowM)); });
  live2.sort(function (a, b) { return (horaMin(b.hora) || 0) - (horaMin(a.hora) || 0); });
  if (live2.length) return { mode: 'live', list: live2.slice(0, 3) };
  // Nada rolando agora → A SEGUIR HOJE: eventos de hoje que ainda VÃO começar (sem arrecadado,
  // hora ainda por vir), do mais cedo pro mais tarde. Se não houver nenhum, cai no estado vazio.
  var next = pool.filter(function (r) {
    if (r.premiacao != null) return false;                 // já fechou
    var hm = horaMin(r.hora);
    return isDemo || hm == null || hm >= nowM;              // ainda vai começar hoje
  }).sort(function (a, b) { return (horaMin(a.hora) || 9999) - (horaMin(b.hora) || 9999); });
  return { mode: next.length ? 'next' : 'empty', list: next.slice(0, 3) };
}
function renderTodayTop3() {
  var el = $('today-top3'); if (!el) return;
  var res = runningNow(), top = res.list, live = res.mode === 'live';
  var titleEl = document.querySelector('.ctrl-today .ct-head > span');
  if (titleEl) titleEl.textContent = live ? 'Rolando agora' : 'A seguir hoje';
  var head = $('ct-live-badge');
  if (head) { head.className = 'ct-live' + (live ? '' : ' soon'); head.innerHTML = live ? '<i></i>ROLANDO AGORA' : '<i></i>A SEGUIR HOJE'; }
  if (!top.length) {
    el.innerHTML = '<div class="ct-empty"><span class="ct-empty-dot"></span>' +
      (live ? 'Nenhum SPS rolando agora — late reg aberto aparece aqui ao vivo…'
            : 'Sem SPS previsto pra hoje — os próximos aparecem aqui…') + '</div>';
    return;
  }
  el.innerHTML = top.map(function (r, i) {
    var val = r.garantido ? fmtMoneyK(r.garantido) : '—';
    var meta = live
      ? ((r.hora ? esc(String(r.hora)) + ' · ' : '') + (r.field ? intNum(r.field) + ' jogadores · late aberto' : 'late aberto'))
      : ((r.hora ? 'às ' + esc(String(r.hora)) : 'horário a confirmar') + (r.buyin ? ' · buy-in ' + fmtMoney(r.buyin) : '') + ' · a começar');
    return '<div class="ct-card" data-r="' + (i + 1) + '"' + (live ? ' data-live="1"' : '') + '><div class="ct-rank">' + (i + 1) + '</div>' +
      '<div class="ct-body"><div class="ct-name">' + esc(shortName(r.nome)) + '</div>' +
      '<div class="ct-meta">' + meta + '</div></div>' +
      '<div class="ct-prem ct-gar">' + val + '</div></div>';
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
  var meta = effectiveMeta(t);   // meta com PISO no garantido total da série (ver effectiveMeta)
  // Projeção fim da série = a META da série (garantido total + 20% ≈ 120 mi).
  // % da meta = ARRECADADO BRUTO ACUMULADO ÷ META. Bate com a barra "Ritmo vs. meta".
  var projHtml = '<span class="che-proj-dot"></span>Projeção fim da série · <b>' + fmtMoney(meta) + '</b>';
  if (meta > 0) projHtml += ' · <b>' + Math.round(t.arrecadadoBruto / meta * 100) + '%</b> da meta';
  setHTML('che-proj', projHtml);

  // #1 barra ritmo vs meta (a meta sempre existe — piso no garantido total da série)
  var cm = $('che-meta');
  if (cm && meta > 0) {
    cm.hidden = false;
    setTxt('che-meta-pct', Math.round(t.arrecadadoBruto / meta * 100) + '%');   // só o número — o rótulo já diz "vs. meta" (evita colar)
    var fill = $('che-meta-fill'); if (fill) fill.style.width = clamp(t.arrecadadoBruto / meta * 100, 0, 100).toFixed(1) + '%';
    var pj = $('che-meta-proj'); if (pj) pj.style.left = clamp(proj / meta * 100, 0, 100).toFixed(1) + '%';
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
  setTxt('sb_gar', 'dos ' + intNum(t.fechados) + ' eventos que já rodaram');
  setTxt('sb_arr', fmtMoneyK(t.dias ? t.arrecadadoBruto / t.dias : 0) + '/dia · ' + intNum(t.entradas) + ' jog.');
  setTxt('sb_rake', pctPlain(t.rakePct) + ' do arrec. · ' + fmtMoneyK(t.dias ? t.rake / t.dias : 0) + '/dia');
  setTxt('sb_admin', t.adminEvents + ' eventos · 2% buy-in');
  setTxt('sb_ov', fmtMoneyK(t.dias ? Math.abs(t.totalOverlay) / t.dias : 0) + '/dia · ' + intNum(t.fechados) + ' fech.');
  // Performance da série = arrecadado ÷ garantido (agregado); o sub dá o contexto (cobertura + nº rodados)
  setTxt('sb_perf', 'arrec. ÷ gar. de ' + intNum(t.fechados) + ' fech. · cob. ' + pctPlain(t.cobertura));

  setTxt('cf-perf', pctSigned(seriePerf(t)));
  // COBERTURA DA SÉRIE = quanto do garantido TOTAL planejado (100,4M) já foi arrecadado
  var _garSerie = CAMP.garantidoSerie != null ? CAMP.garantidoSerie : t.totalGarantido;
  var _cobSerie = _garSerie > 0 ? (t.arrecadadoBruto / _garSerie * 100) : 0;
  setTxt('cf-cobpct', pctPlain(_cobSerie));
  var cob = $('cf-cob'); if (cob) cob.style.width = clamp(_cobSerie, 0, 100).toFixed(1) + '%';

  // Maiores eventos — os MAIORES garantidos que ainda VÃO acontecer (grade da GU),
  // sem repetir o mesmo torneio recorrente (dedup por eventKey). Mostra data · hora.
  var topG = biggestUpcoming();
  var st = $('cst-table');
  if (st) st.innerHTML = '<div class="cst-row h"><span class="r">#</span><span class="nm">Evento</span><span class="pr">garantido</span></div>' +
    (topG.length ? topG.slice(0, 5).map(function (r, i) {
      var quando = (r.date ? fmtDMY(r.date).slice(0, 5) : '') + (r.hora ? ((r.date ? ' · ' : '') + esc(String(r.hora))) : '');
      var sub = quando + (r.buyin ? ' · buy-in ' + fmtMoney(r.buyin) : '');
      return '<div class="cst-row' + (i < 3 ? ' top' : '') + '"><span class="r">' + (i + 1) + '</span>' +
        '<div class="cst-ev"><div class="cst-nm">' + evTag(r) + esc(fullName(r.nome)) + '</div>' +
        '<div class="cst-sub">' + (sub || evMeta(r)) + '</div></div>' +
        '<span class="pr">' + fmtMoneyK(r.garantido) + '</span></div>';
    }).join('') : '<div class="ct-empty"><span class="ct-empty-dot"></span>Grade SPS futura ainda não publicada…</div>');

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
/* count-up genérico (ease-out) p/ números fora do mapa do spin() — ex.: topo da Jornada (item 3).
   Parte do valor ATUAL exibido (não do 0), então uma atualização AO VIVO no meio da cena sobe
   suave em vez de piscar pro 0. A entrada da cena zera antes (enterJourney) p/ ter o reveal 0→valor. */
function countTo(el, to, fmt, ms) {
  if (!el) return;
  if (reduced()) { el.textContent = fmt(to); return; }
  var raw = String(el.textContent || '').replace(/[^\d]/g, ''), from = raw ? parseFloat(raw) : 0;
  if (!isFinite(from)) from = 0;
  ms = ms || 1150; var t0 = null;
  (function step(ts) { if (t0 == null) t0 = ts; var p = Math.min(1, (ts - t0) / ms); el.textContent = fmt(from + (to - from) * easeOut(p)); if (p < 1) requestAnimationFrame(step); })(performance.now());
}
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
  var cob = $('cf-cob'); if (cob && T) { var gs = CAMP.garantidoSerie != null ? CAMP.garantidoSerie : T.totalGarantido; var cs = gs > 0 ? (T.arrecadadoBruto / gs * 100) : 0; cob.style.width = '0%'; void cob.offsetWidth; cob.style.width = clamp(cs, 0, 100).toFixed(1) + '%'; }
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
/* topo "redondo" do eixo Y (1/1.5/2/2.5/3/4/5/6/8/10 × 10^k) com folga p/ o rótulo acima da barra */
function niceMax(v) {
  if (!(v > 0)) return 1;
  var base = Math.pow(10, Math.floor(Math.log10(v))), steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10], f = v / base;
  for (var i = 0; i < steps.length; i++) if (f <= steps[i] * 0.9) return steps[i] * base;
  return 10 * base;
}
/* TELA 2 — Jornada dia a dia = GRÁFICO DE BARRAS do arrecadado/dia, com eixo-Y, linhas-guia e
   linha de média (dataviz). Cabe a série INTEIRA numa tela só, sem scroll nem corte. */
function renderJourney() {
  if (!T) return;
  var el = $('jn-list'); if (!el) return;
  var days = dailySeries();
  var n = days.length; if (!n) { el.innerHTML = '<div class="tday-empty"><span class="ct-empty-dot"></span>Sem dias com jogo ainda…</div>'; return; }
  var vals = days.map(function (d) { return d.arr; });
  var total = vals.reduce(function (s, v) { return s + v; }, 0);
  var best = Math.max.apply(null, vals.concat(0)), bestIdx = vals.indexOf(best);
  var avg = n ? total / n : 0;
  countTo($('jn-total'), T.arrecadadoBruto, fmtMoney);   // sobe de 0 a cada entrada da cena (item 3)
  countTo($('jn-avg'), avg, fmtMoney);
  countTo($('jn-best'), best, fmtMoney);
  var todayISO = nowSPDate();
  var max = niceMax(best);
  // divisões "redondas" do eixo conforme o dígito líder do topo
  var lead = +(max / Math.pow(10, Math.floor(Math.log10(max) + 1e-9))).toFixed(2);
  var DIV = ({ 1: 4, 1.5: 3, 2: 4, 2.5: 5, 3: 3, 4: 4, 5: 5, 6: 6, 8: 4, 10: 5 })[lead] || 4;
  var axis = '', grid = '';
  for (var t = 0; t <= DIV; t++) {
    var f = (t / DIV * 100).toFixed(3) + '%';
    axis += '<span class="jc-tick" style="--f:' + f + '">' + (t === 0 ? '0' : fmtMoneyK(max * t / DIV)) + '</span>';
    grid += '<i class="jc-gl' + (t === 0 ? ' is-base' : '') + '" style="--f:' + f + '"></i>';
  }
  var showEvery = Math.max(1, Math.ceil(n / 16));   // com muitos dias, espaça os rótulos de data
  var dense = n > 20;   // muitos dias → o rótulo de valor vira VERTICAL (não sobrepõe)
  var bars = days.map(function (d, i) {
    var h = clamp(d.arr / max * 100, 0.8, 100).toFixed(2);
    var isNow = d.date === todayISO, isBest = i === bestIdx, isRecord = isBest && isNow;   // hoje==melhor = recorde ao vivo
    var showVal = true;   // TODAS as barras mostram o total acima (não só o melhor dia)
    return '<div class="jc-col' + (isNow ? ' is-now' : '') + (isBest ? ' is-best' : '') + (isRecord ? ' is-record' : '') + '" style="--i:' + i + '">' +
      '<div class="jc-bar" style="--h:' + h + '%">' +
        (isRecord ? '<span class="jc-tag record">★ recorde</span>' : (isBest ? '<span class="jc-tag">melhor dia</span>' : (isNow ? '<span class="jc-tag now">hoje</span>' : ''))) +
        (showVal ? '<span class="jc-val">' + fmtMoneyK(d.arr) + '</span>' : '') +
      '</div></div>';
  }).join('');
  var xaxis = days.map(function (d, i) {
    var isNow = d.date === todayISO, isBest = i === bestIdx;
    var dd = d.date.slice(8, 10) + '/' + d.date.slice(5, 7);
    var show = isNow || isBest || i === 0 || i === n - 1 || (i % showEvery === 0);
    return '<span class="jc-day' + (isNow || isBest ? ' is-hi' : '') + (show ? '' : ' is-dim') + '">' + dd + '</span>';
  }).join('');
  var avgF = clamp(avg / max * 100, 0, 100).toFixed(2) + '%';
  el.innerHTML =
    '<div class="jc-plot' + (dense ? ' is-dense' : '') + '" style="--n:' + n + '">' +
      '<div class="jc-frame">' +
        '<div class="jc-yaxis">' + axis + '</div>' +
        '<div class="jc-area">' +
          '<div class="jc-grid" aria-hidden="true">' + grid + '</div>' +
          (avg > 0 ? '<div class="jc-avg" style="--f:' + avgF + '"><span>média · ' + fmtMoneyK(avg) + '</span></div>' : '') +
          '<div class="jc-bars">' + bars + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="jc-xaxis">' + xaxis + '</div>' +
    '</div>';
  // rodapé de projeção escondido na jornada (a projeção fim-da-série já aparece no hero do control)
  var foot = $('jn-foot'); if (foot) foot.hidden = true;
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
function enterRanking() { renderRanking(); autoScrollList($('tier-list'), SCENES[_si].dwell); }

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
function enterToday() { renderToday(); autoScrollList($('today-events'), SCENES[_si].dwell); }

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
function enterComing() { renderComing(); autoScrollList($('coming-events'), SCENES[_si].dwell); }

/* ── TELA — Gigantes da Semana: maiores PREMIAÇÕES SPS da semana (estilo TV) ── */
/* ── HERO cíclico (1 tela por item): Gigantes e Recordes ── */
function heroHTML(item) {
  return '<div class="hero-stage">' +
    (item.rank ? '<div class="hero-rank">' + item.rank + '</div>' : '') +
    '<div class="hero-kicker">' + item.kicker + '</div>' +
    '<div class="hero-name">' + evBadge({ cat: item.cat }) + esc(fullName(item.nome)) + '</div>' +
    '<div class="hero-big">' + item.big + '</div><div class="hero-biglbl">' + item.bigLbl + '</div>' +
    '<div class="hero-meta">' + item.meta + '</div>' +
    (item.by ? '<div class="hero-by">' + avatarLetter(item.by) + '<span><b>' + esc(item.by) + '</b> lançou</span></div>' : '') +
    '</div>';
}
function renderHeroInto(id, item) {
  var el = $(id); if (!el) return;
  el.innerHTML = item ? heroHTML(item) : '<div class="tier-empty"><span class="ct-empty-dot"></span>Sem dados nesta semana ainda…</div>';
}
function cycleHero(id, items) {
  if (!items.length) { renderHeroInto(id, null); return; }
  var i = 0; renderHeroInto(id, items[0]);
  if (items.length < 2) return;
  var per = Math.max(3500, Math.floor((SCENES[_si].dwell || 12000) / items.length));
  _sceneTimers.push(setInterval(function () { i = (i + 1) % items.length; renderHeroInto(id, items[i]); }, per));
}
function giantItems() {
  var wk = ROWS.filter(function (r) { return r.premiacao != null && inWeek(r); }).sort(function (a, b) { return (b.premiacao || 0) - (a.premiacao || 0); });
  var seen = {}, top = [];
  wk.forEach(function (r) { var k = r.nome + '|' + r.hora; if (seen[k]) return; seen[k] = 1; if (top.length < 5) top.push(r); });
  return top.map(function (r, i) {
    return { rank: i + 1, kicker: 'Gigante da semana · #' + (i + 1), nome: r.nome, cat: r.cat,
      big: fmtMoney(r.premiacao), bigLbl: 'em premiação',
      meta: evMeta(r, 'gar. ' + fmtMoneyK(r.garantido) + ' · ' + fmtDMY(r.date).slice(0, 5)), by: operatorOf(r) };
  });
}
function renderGiants() { var it = giantItems(); renderHeroInto('giants-hero', it[0] || null); }
function enterGiants() { cycleHero('giants-hero', giantItems()); }

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

/* ── TELA — Recordes da Semana: 1 tela por recorde (maior premiação / maior público) ── */
function recordItems() {
  var wk = ROWS.filter(inWeek);
  var tp = wk.filter(function (r) { return r.premiacao != null; }).sort(function (a, b) { return (b.premiacao || 0) - (a.premiacao || 0); })[0];
  var tf = wk.filter(function (r) { return r.field != null; }).sort(function (a, b) { return (b.field || 0) - (a.field || 0); })[0];
  var out = [];
  if (tp) out.push({ kicker: 'Maior premiação da semana', nome: tp.nome, cat: tp.cat, big: fmtMoney(tp.premiacao), bigLbl: 'em prêmios', meta: evMeta(tp, 'gar. ' + fmtMoneyK(tp.garantido)), by: operatorOf(tp) });
  if (tf) out.push({ kicker: 'Maior público da semana', nome: tf.nome, cat: tf.cat, big: intNum(tf.field), bigLbl: 'jogadores', meta: evMeta(tf, tf.premiacao != null ? 'prêmio ' + fmtMoneyK(tf.premiacao) : 'gar. ' + fmtMoneyK(tf.garantido)), by: operatorOf(tf) });
  return out;
}
function renderRecords() { var it = recordItems(); renderHeroInto('records-hero', it[0] || null); }
function enterRecords() { cycleHero('records-hero', recordItems()); }

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
function enterTeam() { renderTeam(); autoScrollList($('team-list'), SCENES[_si].dwell); }

/* ── TELA — A Semana Inteira: todos os SPS da semana agrupados por dia (grade da GU) ── */
function renderWeek() {
  var el = $('week-grid'); if (!el) return;
  var byDay = {}, src = GRADE.length ? GRADE : ROWS;
  src.forEach(function (e) { var d = e.dateISO || e.date; if (!d) return; (byDay[d] = byDay[d] || []).push(e); });
  var days = Object.keys(byDay).sort();
  var sum = $('week-summary');
  if (!days.length) {
    if (sum) sum.hidden = true;
    el.innerHTML = '<div class="tier-empty"><span class="ct-empty-dot"></span>Grade SPS da semana chegando…</div>';
    return;
  }
  // agregados da semana p/ o resumo + escala das barras
  var perDay = days.map(function (d) {
    var evs = byDay[d];
    return { d: d, evs: evs, gar: evs.reduce(function (s, e) { return s + (e.garantido || 0); }, 0) };
  });
  var totGarWeek = perDay.reduce(function (s, x) { return s + x.gar; }, 0);
  var totEvWeek = perDay.reduce(function (s, x) { return s + x.evs.length; }, 0);
  var maxGar = perDay.reduce(function (m, x) { return Math.max(m, x.gar); }, 0) || 1;
  var best = perDay.slice().sort(function (a, b) { return b.gar - a.gar; })[0];
  var avgGar = totGarWeek / perDay.length;

  if (sum) {
    sum.hidden = false;
    var bestWd = WEEKDAY_FULL[new Date(best.d + 'T12:00:00Z').getUTCDay()];
    sum.innerHTML =
      '<div class="wk-sum-i"><span>Garantido da semana</span><b>' + fmtMoneyK(totGarWeek) + '</b></div>' +
      '<div class="wk-sum-i"><span>Eventos SPS</span><b>' + intNum(totEvWeek) + ' <i>· ' + perDay.length + ' dias</i></b></div>' +
      '<div class="wk-sum-i"><span>Média por dia</span><b>' + fmtMoneyK(avgGar) + '</b></div>' +
      '<div class="wk-sum-i wk-sum-best"><span>Melhor dia</span><b>' + bestWd + ' <i>· ' + fmtMoneyK(best.gar) + '</i></b></div>';
  }

  el.innerHTML = perDay.map(function (x, i) {
    var d = x.d, evs = x.evs, totGar = x.gar;
    var biggest = evs.slice().sort(function (a, b) { return (b.garantido || 0) - (a.garantido || 0); })[0];
    var isNow = d === nowSPDate();
    var isBest = d === best.d && totGar > 0;
    var wd = WEEKDAY_FULL[new Date(d + 'T12:00:00Z').getUTCDay()];
    var barPct = Math.max(4, Math.round(totGar / maxGar * 100));
    return '<div class="wk-card' + (isNow ? ' is-now' : '') + (isBest ? ' is-best' : '') + '" style="--i:' + i + '">' +
      (isBest ? '<span class="wk-flag">Melhor dia</span>' : '') +
      '<div class="wk-day">' + wd + '<small>' + d.slice(8, 10) + '/' + d.slice(5, 7) + (isNow ? ' · hoje' : '') + '</small></div>' +
      '<div class="wk-stats"><div class="wk-n"><b>' + evs.length + '</b><span>eventos SPS</span></div>' +
      '<div class="wk-n"><b>' + fmtMoneyK(totGar) + '</b><span>garantido total</span></div></div>' +
      (biggest ? '<div class="wk-top"><span>Maior</span> ' + esc(fullName(biggest.nome)) + ' · ' + fmtMoneyK(biggest.garantido) + '</div>' : '') +
      '</div>';
  }).join('');
}
/* A semana cabe inteira na tela (7 dias em 1 linha) — sem auto-scroll (é uma TV, nada rola) */
function enterWeek() { renderWeek(); }

/* ── TELA — Avisos da Casa (hub/avisos), igual à TV ── */
function renderAvisos() {
  var el = $('avisos-list'); if (!el) return;
  if (!AVISOS.length) { el.innerHTML = '<div class="tier-empty"><span class="ct-empty-dot"></span>Sem avisos da casa no momento…</div>'; return; }
  el.innerHTML = AVISOS.map(function (a, i) {
    return '<div class="aviso-card" style="--i:' + i + '"><div class="aviso-h">' + esc(a.titulo || '') + '</div>' +
      (a.texto || a.msg ? '<div class="aviso-t">' + esc(a.texto || a.msg) + '</div>' : '') + '</div>';
  }).join('');
}
function enterAvisos() { renderAvisos(); autoScrollList($('avisos-list'), SCENES[_si].dwell); }
/* gráfico de barras — cabe inteiro, sem scroll */
function enterJourney() {
  if (!reduced()) ['jn-total', 'jn-avg', 'jn-best'].forEach(function (id) { var e = $(id); if (e) e.textContent = 'R$ 0'; });   // reveal 0→valor na entrada
  renderJourney();
}

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

/* ── fundo: VÍDEO em LOOP NATIVO (1 só vídeo) ─────────────────────────────────
   Em TV (Tizen/Samsung) o <video> vive num plano de hardware que IGNORA `opacity`.
   Por isso o crossfade de 2 vídeos NÃO funciona lá: o 2º vídeo (sem frame ainda,
   opacity ignorada) virava um plano AZUL sobre o 1º — mesmo o 1º decodificando bem.
   Solução robusta: UM vídeo, `loop` NATIVO — confiável na TV e no PC. Fica
   `display:none` até confirmar playback REAL (aí vira `.vid-live`); se não tocar,
   fica o PNG (.tv-hero-img), NUNCA a tela azul. */
function mountBackground() {
  var markBg = function () { if (!_bgReady) { _bgReady = true; maybeReveal(); } };   // fundo pronto → libera o loader
  setTimeout(markBg, 7000);                              // fallback: nunca trava o loader
  var a = $('heroVidA'), b = $('heroVidB');
  if (b) { try { b.pause(); b.removeAttribute('src'); if (b.parentNode) b.parentNode.removeChild(b); } catch (e) {} }   // mata o 2º vídeo (plano azul em TV)
  if (!a) { markBg(); return; }
  if (reduced()) { try { a.pause(); } catch (e) {} markBg(); return; }   // PNG (.tv-hero-img) é o fundo
  a.muted = true; a.playsInline = true; a.loop = true;
  a.setAttribute('muted', ''); a.setAttribute('playsinline', ''); a.setAttribute('loop', '');
  var hero = document.querySelector('.tv-hero'), shown = false;
  var playSafe = function () { try { var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} };
  var showVideo = function () {                           // só exibe (display:block via .vid-live) com playback REAL confirmado
    if (!shown) { shown = true; if (hero) hero.classList.add('vid-live'); requestAnimationFrame(function () { a.classList.add('is-front'); }); }
    markBg();
  };
  a.addEventListener('playing', showVideo);
  a.addEventListener('timeupdate', function () { if (a.currentTime > 0.12) showVideo(); });
  a.addEventListener('canplay', markBg);
  a.addEventListener('error', markBg);                   // codec/rede falhou → fica o PNG (sem azul)
  var src0 = a.querySelector('source'); if (src0) src0.addEventListener('error', markBg);
  setTimeout(function () { if (!shown) markBg(); }, 4500);
  playSafe();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) playSafe(); else { try { a.pause(); } catch (e) {} } });
  console.info('[SUPREMA TV · SPS] fundo em vídeo (loop nativo, 1 vídeo) no ar');
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

/* DIAGNÓSTICO da TV (?diag=1) — mostra na tela o browser e o que ele suporta, pra saber EXATAMENTE
   o que quebra na Samsung sem adivinhar. Feito só com px/inline (renderiza até em Chromium velho). */
function showDiag() {
  var v = document.createElement('video');
  var cp = function (c) { try { return v.canPlayType('video/mp4; codecs="' + c + '"') || 'NÃO'; } catch (e) { return '?'; } };
  var sup = function (p, val) { try { return (window.CSS && CSS.supports && CSS.supports(p, val)) ? 'OK' : 'NÃO'; } catch (e) { return '?'; } };
  var flexGap = 'NÃO';
  try {
    var f = document.createElement('div'); f.style.cssText = 'display:flex;flex-direction:column;gap:10px;position:absolute;visibility:hidden';
    f.appendChild(document.createElement('div')); f.appendChild(document.createElement('div'));
    (document.body || document.documentElement).appendChild(f);
    flexGap = (f.scrollHeight >= 10) ? 'OK' : 'NÃO'; if (f.parentNode) f.parentNode.removeChild(f);
  } catch (e) {}
  var rows = [
    ['UA', navigator.userAgent || '?'],
    ['Tela', window.innerWidth + '×' + window.innerHeight + ' · DPR ' + (window.devicePixelRatio || 1)],
    ['clamp()', sup('width', 'clamp(1px,1vw,2px)')],
    ['min()/max()', sup('width', 'min(1px,2px)')],
    ['flex gap', flexGap],
    ['var()', sup('color', 'var(--x,#000)')],
    ['object-fit', sup('object-fit', 'cover')],
    ['backdrop-filter', (sup('backdrop-filter', 'blur(1px)') === 'OK' || sup('-webkit-backdrop-filter', 'blur(1px)') === 'OK') ? 'OK' : 'NÃO'],
    ['mask svg', (sup('-webkit-mask', 'url("x")') === 'OK' || sup('mask', 'url("x")') === 'OK') ? 'OK' : 'NÃO'],
    ['bg-clip:text', (sup('-webkit-background-clip', 'text') === 'OK' || sup('background-clip', 'text') === 'OK') ? 'OK' : 'NÃO'],
    ['H264 baseline', cp('avc1.42E01E')],
    ['H264 main', cp('avc1.4D401F')],
    ['H264 high', cp('avc1.64001F')],
  ];
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#05070a;color:#fff;font-family:monospace;font-size:20px;line-height:1.7;padding:32px;overflow:auto';
  var html = '<div style="font-size:28px;color:#e6c34f;margin-bottom:16px">DIAGNOSTICO - Suprema Campanha</div>';
  for (var i = 0; i < rows.length; i++) {
    var k = rows[i][0], val = String(rows[i][1]);
    var bad = (val === 'NÃO' || val === '' || val === '?');
    var color = (k === 'UA' || k === 'Tela') ? '#8aa0aa' : (bad ? '#ef6f63' : '#38e79a');
    html += '<div style="word-break:break-all"><b style="color:#c9a84c">' + k + ':</b> <span style="color:' + color + '">' + val + '</span></div>';
  }
  d.innerHTML = html;
  (document.body || document.documentElement).appendChild(d);
}
function boot() {
  // TVs cortam ~3-5% das bordas (overscan) → marca `tv-device` p/ o CSS aplicar margem segura.
  // Detecta pela UA; `?tv=1` força, `?tv=0` desliga (caso a detecção erre num modelo).
  var noTV = /[?&]tv=0/.test(location.search);
  var isTV = !noTV && (/[?&]tv=1/.test(location.search) || /Tizen|SMART-?TV|SmartTV|Web[O0]S|NetCast|HbbTV|VIDAA|BRAVIA|Maple|CrKey|AFT|GoogleTV/i.test(navigator.userAgent || ''));
  if (isTV) document.documentElement.classList.add('tv-device');
  if (/[?&]diag=1/.test(location.search)) { showDiag(); return; }
  if (/[?&]demo=1/.test(location.search)) bootDemo(); else initData();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

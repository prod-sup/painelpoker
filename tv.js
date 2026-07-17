/* =========================================================================
   SUPREMA TV — o canal da casa. Um broadcast em tela cheia que anuncia a
   grade como um comercial: cenas rotativas com o que está AO VIVO agora
   (premiação real e field em tempo real, direto do Painel do Dia), quem
   CRIOU cada evento (Criação Noturna — o momento "eu criei esse evento"),
   os gigantes da semana, as rotas de ticket, os eventos futuros e os
   créditos da equipe da noite.

   FONTES (tudo tempo real, via SupremaDB):
     painel/globalMtt ................. a Global MTT (o motor radar-core.js parseia)
     eventos/linksOverride ............ correções de vínculo do Radar
     painel/<hoje>/premiacao|field|premBy  premiação real, jogadores e quem lançou
     painel/<hoje>/criacaoNoturna/done     quem criou cada evento de hoje
     painel/<amanhã>/criacaoNoturna/done   progresso da GU criando amanhã, ao vivo

   Depende de: gu-parser.js, radar-core.js, suprema-db.js, suprema-auth.js,
   suprema-motion.js, ensureXLSX.
========================================================================= */
'use strict';

console.info('[SupremaTV] tv.js v1.0 — no ar');

let MODEL = null, LAST_PARSED = null, OVERRIDES = {};
const LIVE = { prem:{}, field:{}, premBy:{}, doneToday:{}, doneTomorrow:{} };
let DAY_ISO = null;
let _dayOffs = [];

/* ═══════════════════ dados ao vivo ═══════════════════ */

let _lastAt = null;
function initData(){
  if (!window.SupremaDB || !SupremaDB.init()){ setTimeout(initData, 300); return; }
  SupremaDB.requireUser(() => {
    console.info('[SupremaTV] auth ok — sintonizando');
    SupremaDB.watch('painel/globalMtt/at', snap => {
      const at = snap.val();
      if (!at || `${at}` === `${_lastAt}`) return;
      _lastAt = `${at}`;
      loadSharedGlobal();
    });
    SupremaDB.watch('eventos/linksOverride', snap => {
      OVERRIDES = snap.val() || {};
      if (LAST_PARSED) MODEL = buildModel(LAST_PARSED, OVERRIDES);
    });
    attachDayListeners();
  });
}

/* listeners do DIA (premiação/field/criadores) — reancorados quando a grade vira */
function attachDayListeners(){
  if (!window.SupremaDB || !SupremaDB.ready()) return;   // ainda sintonizando
  const today = gradeTodayISO();
  if (today === DAY_ISO) return;
  DAY_ISO = today;
  _dayOffs.forEach(off => { try{ off(); }catch(e){} });
  const tomorrow = isoAddDays(today, 1);
  _dayOffs = [
    SupremaDB.watch(`painel/${today}/premiacao`, s => { LIVE.prem = s.val() || {}; }),
    SupremaDB.watch(`painel/${today}/field`,     s => { LIVE.field = s.val() || {}; }),
    SupremaDB.watch(`painel/${today}/premBy`,    s => { LIVE.premBy = s.val() || {}; }),
    SupremaDB.watch(`painel/${today}/criacaoNoturna/done`,    s => { LIVE.doneToday = s.val() || {}; }),
    SupremaDB.watch(`painel/${tomorrow}/criacaoNoturna/done`, s => { LIVE.doneTomorrow = s.val() || {}; }),
  ];
  console.info('[SupremaTV] ancorado no dia', today);
}

async function loadSharedGlobal(){
  try{
    const v = await SupremaDB.getValue('painel/globalMtt');
    if (!v || !v.data) return;
    await ensureXLSX();
    const matrix = readSheetMatrix(b64ToBuf(v.data), 'MTTS BRAZIL');
    if (!matrix) return;
    LAST_PARSED = parseGlobalWeek(matrix);
    MODEL = buildModel(LAST_PARSED, OVERRIDES);
    console.info(`[SupremaTV] programação carregada — ${MODEL.events.length} eventos na semana`);
    if (!_onAir){ _onAir = true; playNext(); }
  }catch(err){ console.error('[SupremaTV] falha ao carregar a Global', err); }
}

/* premiação/field/quem-lançou do Painel do Dia, pela MESMA chave (rowKey) */
function liveOf(e){
  const rk = painelRowKey(e);
  const premByRaw = LIVE.premBy[rk] ?? LIVE.premBy[rk + '_px'];
  return {
    prem:  LIVE.prem[rk]  ?? LIVE.prem[rk + '_px']  ?? null,
    field: LIVE.field[rk] ?? LIVE.field[rk + '_px'] ?? null,
    premBy: typeof premByRaw === 'string' ? premByRaw : (premByRaw && premByRaw.by) || null,
  };
}

/* ═══════════════════ helpers de cena ═══════════════════ */

/* título cinético: cada palavra entra por baixo, em cascata */
function kinetic(text, base){
  return String(text).split(/\s+/).map((w, i) =>
    `<span class="kw-clip"><span class="kw" style="--i:${(base||0)+i}">${escHtml(w)}</span></span>`).join(' ');
}
function statHtml(label, value, cls, extra){
  return `<div class="tv-stat ${cls||''}" style="--i:${extra||0}">
    <span class="v tv-count">${value}</span><span class="l">${label}</span></div>`;
}
function creditHtml(e, lv){
  const bits = [];
  if (e.createdBy) bits.push(`<span class="credit-chip maker"><span class="cc-av">${escHtml(String(e.createdBy).trim().charAt(0).toUpperCase())}</span> criado por <b>${escHtml(e.createdBy)}</b></span>`);
  if (lv && lv.premBy) bits.push(`<span class="credit-chip">premiação por <b>${escHtml(lv.premBy)}</b></span>`);
  return bits.length ? `<div class="tv-credits">${bits.join('')}</div>` : '';
}
function suitWatermark(suit){
  return `<span class="suit-mark" aria-hidden="true">${suit}</span>`;
}

/* ═══════════════════ compositor de cenas ═══════════════════ */

function composeScenes(){
  attachDayListeners();                              // se a grade virou, reancora
  const scenes = [];
  const today = todayWeekdayPT();
  const todays = MODEL.events.filter(e => e.weekday === today);
  matchCreators(MODEL.events, LIVE.doneToday, today);

  const withSt = todays.map(e => ({ e, st: statusOf(e) }));
  const liveNow = withSt.filter(x => x.st.k === 'live')
    .sort((a,b) => (b.e.garantido||0) - (a.e.garantido||0));
  const upcoming = withSt.filter(x => x.st.k === 'soon' || x.st.k === 'upcoming')
    .sort((a,b) => a.e.abs - b.e.abs);

  /* 1 — vinheta da casa */
  scenes.push({ cls:'s-brand', dur:7000, html:`
    <div class="b-mark shine">♠</div>
    <h1 class="b-title">${kinetic('SUPREMA TV')}</h1>
    <p class="b-sub" style="--i:3">${escHtml(today.replace('-FEIRA',''))} · ${fmtDateShort(MODEL.dates[today])} — a grade de hoje, ao vivo</p>` });

  /* 2 — holofote nos AO VIVO (um por cena, com premiação real + field + criador) */
  liveNow.slice(0, 3).forEach(({e, st}) => {
    const lv = liveOf(e);
    scenes.push({ cls:'s-spot ' + CAT_META[e.cat].cls, dur:12000, html:`
      ${suitWatermark(CAT_META[e.cat].suit)}
      <div class="tv-chip live" style="--i:0"><i class="pulse"></i>AO VIVO AGORA${e.late ? ` · LATE ATÉ ${e.late}` : ''}</div>
      <h1 class="spot-title">${kinetic(e.nome, 1)}</h1>
      ${e.camp ? `<div class="tv-chip camp" style="--i:3">✦ CAMPANHA ${CAMP_LABEL[e.camp]}</div>` : ''}
      <div class="tv-stats">
        ${e.garantido != null ? statHtml('garantido', fmtMoney(e.garantido), 's-gtd', 4) : ''}
        ${lv.prem != null ? statHtml('premiação atual', fmtMoney(lv.prem), 's-prem', 5) : ''}
        ${lv.field != null ? statHtml('jogadores', NF_INT.format(lv.field), 's-field', 6) : ''}
        ${e.buyin != null ? statHtml('buy-in', fmtMoneyFull(e.buyin), '', 7) : ''}
      </div>
      ${creditHtml(e, lv)}` });
  });

  /* 3 — a seguir hoje */
  if (upcoming.length){
    scenes.push({ cls:'s-list', dur:12000, html:`
      <h2 class="sc-kicker" style="--i:0">A SEGUIR HOJE</h2>
      <div class="tv-rows">${upcoming.slice(0, 7).map(({e, st}, i) => `
        <div class="tv-row" style="--i:${i+1}">
          <span class="tr-hora">${e.hora}</span>
          <span class="tr-suit ${CAT_META[e.cat].cls}">${CAT_META[e.cat].suit}</span>
          <span class="tr-nome">${escHtml(shortName(e.nome))}${e.camp ? ` <em class="tr-camp">✦ ${CAMP_LABEL[e.camp]}</em>` : ''}</span>
          <span class="tr-gtd">${e.garantido != null ? fmtMoney(e.garantido) : ''}</span>
          <span class="tr-in">${st.k === 'soon' ? 'em ' + fmtIn(st.inMin) : ''}</span>
        </div>`).join('')}</div>` });
  }

  /* 4 — os gigantes da semana (top 5 GTD) */
  const top5 = [...MODEL.events].filter(e => e.garantido != null)
    .sort((a,b) => b.garantido - a.garantido).slice(0, 5);
  if (top5.length){
    scenes.push({ cls:'s-week', dur:12000, html:`
      <h2 class="sc-kicker" style="--i:0">OS GIGANTES DA SEMANA</h2>
      <div class="tv-rank">${top5.map((e, i) => `
        <div class="rank-row ${i === 0 ? 'first' : ''}" style="--i:${i+1}">
          <span class="rk-pos">${i+1}</span>
          <span class="rk-body"><span class="rk-nome">${escHtml(shortName(e.nome))}</span>
            <span class="rk-sub">${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} · ${e.hora}${e.buyin != null ? ' · buy-in ' + fmtMoneyFull(e.buyin) : ''}</span></span>
          <span class="rk-gtd tv-count">${fmtMoney(e.garantido)}</span>
        </div>`).join('')}</div>` });
  }

  /* 5 — comece pequeno, jogue grande (principais rotas de ticket de hoje) */
  const routeTargets = todays.filter(e => e.satCount > 0)
    .sort((a,b) => b.satCount - a.satCount || (b.garantido||0) - (a.garantido||0)).slice(0, 3);
  if (routeTargets.length){
    scenes.push({ cls:'s-routes', dur:12000, html:`
      <h2 class="sc-kicker" style="--i:0">COMECE PEQUENO, JOGUE GRANDE</h2>
      <div class="tv-routes">${routeTargets.map((t, i) => {
        const sats = MODEL.events.filter(s => s.targetId === t.id).sort((a,b) => (a.buyin??Infinity) - (b.buyin??Infinity));
        const cheap = sats[0];
        return `<div class="tv-route" style="--i:${i+1}">
          <span class="tvr-from">♦ ${sats.length} satélite${sats.length > 1 ? 's' : ''}${cheap && cheap.buyin != null ? ` · desde <b>${fmtMoneyFull(cheap.buyin)}</b>` : ''}</span>
          <span class="tvr-arrow"><i></i>🎟<i></i></span>
          <span class="tvr-to">${CAT_META[t.cat].suit} ${escHtml(shortName(t.nome))}<small>${t.hora}${t.garantido != null ? ' · GTD ' + fmtMoney(t.garantido) : ''}</small></span>
        </div>`;
      }).join('')}</div>` });
  }

  /* 6 — vem aí (eventos futuros, P&D) */
  const futs = MODEL.futures.slice(0, 3);
  if (futs.length){
    const todayISO = gradeTodayISO();
    scenes.push({ cls:'s-future', dur:11000, html:`
      <h2 class="sc-kicker gold" style="--i:0">VEM AÍ</h2>
      <div class="tv-futs">${futs.map((f, i) => {
        const days = f.dateISO ? isoDayNumber(f.dateISO) - isoDayNumber(todayISO) : null;
        return `<div class="tv-fut" style="--i:${i+1}">
          <span class="tf-when">${days == null ? 'EM BREVE' : days <= 0 ? 'HOJE' : days === 1 ? 'AMANHÃ' : 'EM ' + days + ' DIAS'}${f.dateISO ? ' · ' + fmtDateShort(f.dateISO).toUpperCase() : ''}</span>
          <span class="tf-nome">${escHtml(shortName(f.nome))}</span>
          ${f.garantido != null ? `<span class="tf-gtd tv-count">${fmtMoney(f.garantido)}</span><span class="tf-gl">garantidos</span>` : ''}
        </div>`;
      }).join('')}</div>` });
  }

  /* 7 — quem construiu a noite (créditos da equipe + progresso da GU ao vivo) */
  const makerCount = {};
  Object.values(LIVE.doneToday || {}).forEach(v => {
    if (v && v.by) makerCount[v.by] = (makerCount[v.by] || 0) + 1;
  });
  const makers = Object.entries(makerCount).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const tomorrowDay = WEEKDAYS_PT[isoWeekdayIdx(isoAddDays(gradeTodayISO(), 1))];
  const tomorrowTotal = MODEL.events.filter(e => e.weekday === tomorrowDay).length;
  const tomorrowDone = Object.keys(LIVE.doneTomorrow || {}).length;
  if (makers.length || (tomorrowTotal && tomorrowDone)){
    scenes.push({ cls:'s-team', dur:12000, html:`
      <h2 class="sc-kicker" style="--i:0">QUEM CONSTRUIU A NOITE</h2>
      ${makers.length ? `<div class="tv-makers">${makers.map(([name, n], i) => `
        <div class="maker" style="--i:${i+1}">
          <span class="mk-av">${escHtml(String(name).trim().charAt(0).toUpperCase())}</span>
          <span class="mk-name">${escHtml(name)}</span>
          <span class="mk-n">${n} evento${n > 1 ? 's' : ''}</span>
        </div>`).join('')}</div>` : ''}
      ${tomorrowTotal && tomorrowDone ? `
        <div class="gu-progress" style="--i:${makers.length + 2}">
          <span class="gp-label">🌙 A GU está montando ${tomorrowDay.replace('-FEIRA','').toLowerCase()} agora:</span>
          <span class="gp-bar"><b style="width:${Math.min(100, Math.round(tomorrowDone / tomorrowTotal * 100))}%"></b></span>
          <span class="gp-n">${tomorrowDone} de ${tomorrowTotal} eventos criados</span>
        </div>` : ''}` });
  }

  renderTicker(upcoming.map(x => x.e));
  return scenes;
}

/* ═══════════════════ motor de exibição ═══════════════════ */

let _onAir = false, _scenes = [], _idx = 0, _timer = null;
function playNext(){
  if (!MODEL){ _timer = setTimeout(playNext, 2000); return; }
  if (_idx >= _scenes.length){ _scenes = composeScenes(); _idx = 0; }
  const sc = _scenes[_idx++];
  if (!sc){ _timer = setTimeout(playNext, 3000); return; }
  const stage = document.getElementById('stage');
  stage.innerHTML = `<section class="scene ${sc.cls}">${sc.html}
    <i class="scene-progress" style="animation-duration:${sc.dur}ms"></i></section>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = stage.firstElementChild;
    if (el) el.classList.add('in');
    SupremaMotion.countUp('.tv-count', { duration:1500 });
  }));
  clearTimeout(_timer);
  _timer = setTimeout(playNext, sc.dur);
}

/* ticker: a fita de eventos de hoje correndo no rodapé */
function renderTicker(upcoming){
  const wrap = document.getElementById('tickerWrap');
  const track = document.getElementById('tickerTrack');
  if (!upcoming.length){ wrap.hidden = true; return; }
  const items = upcoming.map(e =>
    `<span class="tk-item"><b>${e.hora}</b> ${escHtml(shortName(e.nome))}${e.garantido != null ? ` <em>${fmtMoney(e.garantido)}</em>` : ''}</span>`
  ).join('<span class="tk-sep">♦</span>');
  track.innerHTML = items + '<span class="tk-sep">♠</span>' + items + '<span class="tk-sep">♠</span>';
  wrap.hidden = false;
  /* velocidade proporcional ao conteúdo: ~90px/s */
  requestAnimationFrame(() => {
    track.style.animationDuration = Math.max(30, Math.round(track.scrollWidth / 2 / 90)) + 's';
  });
}

/* ═══════════════════ chrome: relógio, badge ao vivo, fullscreen ═══════════════════ */
function tick(){
  const n = spNow();
  document.getElementById('tvClock').textContent =
    `${String(Math.floor(n.minutes/60)).padStart(2,'0')}:${String(n.minutes%60).padStart(2,'0')}:${String(n.seconds).padStart(2,'0')}`;
}
setInterval(tick, 1000); tick();

setInterval(() => {
  if (!MODEL) return;
  const today = todayWeekdayPT();
  const live = MODEL.events.filter(e => e.weekday === today && statusOf(e).k === 'live').length;
  const badge = document.getElementById('tvLiveBadge');
  badge.hidden = live === 0;
  if (live) document.getElementById('tvLiveN').textContent = `${live} AO VIVO`;
  document.getElementById('tvToday').textContent =
    `${today.replace('-FEIRA','')} · ${MODEL.dates[today] ? fmtDateShort(MODEL.dates[today]) : ''}`;
}, 5000);

document.getElementById('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

/* fundo: a rede de nós da casa, na paleta do canal (dourado + feltro) */
document.addEventListener('DOMContentLoaded', () => {
  SupremaMotion.network('.tv-bg', { c1:'#c9a84c', c2:'#22d47e', maxNodes:64, linkDist:150, isDark: () => true });
  initData();
});

/* =========================================================================
   SUPREMA TV — o canal da casa. Broadcast em cenas rotativas que anuncia a
   grade como um comercial: AO VIVO com premiação real e field, quem CRIOU
   cada evento (com o avatar do hub), gigantes da semana, rotas de ticket,
   eventos futuros, RECORDES da semana, avisos da casa e créditos da equipe.

   EXTRAS v1.1:
     🎉 CELEBRAÇÃO — premiação lançada que BATE o garantido interrompe a
        programação com cena especial + confete (1× por evento/dia).
     👤 AVATARES — o `face` do hub/leaderboard aparece nos créditos.
     🏆 RECORDES — maior premiação/field da semana (snapshots/) e quem mais
        criou eventos nos últimos 7 dias (criacaoNoturna/done).
     🎛 CONTROLE REMOTO — tv.html?remote=1 vira o controle (pausar, pular,
        fixar evento). Estado em tv/control, a TV obedece ao vivo.
     📣 AVISOS — hub/avisos (os mesmos do Admin) ganham cena própria.

   FONTES (tudo tempo real, via SupremaDB):
     painel/globalMtt · eventos/linksOverride · painel/<hoje>/premiacao|field|premBy
     painel/<hoje±>/criacaoNoturna/done · snapshots/<dia> · hub/leaderboard
     hub/avisos · tv/control

   Depende de: gu-parser.js, radar-core.js, suprema-db.js, suprema-auth.js,
   suprema-motion.js, ensureXLSX.
========================================================================= */
'use strict';

console.info('[SupremaTV] tv.js v1.1 — no ar (celebração, recordes, controle remoto)');

let MODEL = null, LAST_PARSED = null, OVERRIDES = {};
const LIVE = { prem:{}, field:{}, premBy:{}, doneToday:{}, doneTomorrow:{} };
let DAY_ISO = null;
let _dayOffs = [];
let FACES = {};                       // normText(nome) → emoji do hub/leaderboard
let RECORDS = null;                   // {topPrem, topField, topMaker}
let AVISOS = [];                      // avisos da casa (hub/avisos)
let CTRL = {};                        // tv/control — o controle remoto manda

/* modo controle: a MESMA página vira o controle remoto no celular */
const REMOTE = new URLSearchParams(location.search).get('remote') === '1';
if (REMOTE) document.documentElement.classList.add('remote');

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
    SupremaDB.watch('hub/avisos', snap => {
      const v = snap.val() || {};
      AVISOS = Object.values(v).filter(a => a && a.titulo && !a.off && !a.hidden).slice(-4);
    });
    wireControl();
    attachDayListeners();
    loadFaces(); loadRecords();
    setInterval(() => { loadFaces(); loadRecords(); }, 3600000);   // 1×/hora basta
  });
}

/* listeners do DIA (premiação/field/criadores) — reancorados quando a grade vira */
let _premDay = null;                  // primeira foto do dia não celebra (é carga, não conquista)
function attachDayListeners(){
  if (!window.SupremaDB || !SupremaDB.ready()) return;   // ainda sintonizando
  const today = gradeTodayISO();
  if (today === DAY_ISO) return;
  DAY_ISO = today;
  _dayOffs.forEach(off => { try{ off(); }catch(e){} });
  const tomorrow = isoAddDays(today, 1);
  _dayOffs = [
    SupremaDB.watch(`painel/${today}/premiacao`, s => {
      const val = s.val() || {};
      const prev = LIVE.prem;
      LIVE.prem = val;
      if (_premDay !== today){ _premDay = today; return; }
      maybeCelebrate(prev, val);
    }),
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
    if (REMOTE){ renderRemote(); return; }
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

/* ── avatares reais: o `face` que cada operador escolheu no hub ── */
async function loadFaces(){
  try{
    const lb = await SupremaDB.getValue('hub/leaderboard');
    const map = {};
    Object.values(lb || {}).forEach(u => { if (u && u.name && u.face) map[normText(u.name)] = u.face; });
    FACES = map;
  }catch(e){}
}
function avatarHtml(name, cls){
  const f = FACES[normText(name)];
  return `<span class="${cls}${f ? ' has-face' : ''}">${f ? f : escHtml(String(name).trim().charAt(0).toUpperCase())}</span>`;
}

/* ── recordes da semana: snapshots (premiação/field) + done da GU (criadores) ── */
async function loadRecords(){
  try{
    const today = gradeTodayISO();
    let topPrem = null, topField = null;
    const makerWeek = {};
    for (let i = 0; i < 7; i++){
      const iso = isoAddDays(today, -i);
      const [snap, done] = await Promise.all([
        SupremaDB.getValue('snapshots/' + iso).catch(() => null),
        SupremaDB.getValue(`painel/${iso}/criacaoNoturna/done`).catch(() => null),
      ]);
      if (snap && snap.rows) Object.values(snap.rows).forEach(r => {
        if (!r) return;
        if (typeof r.premiacao === 'number' && (!topPrem || r.premiacao > topPrem.val))
          topPrem = { val: r.premiacao, nome: r.nome || '', iso };
        const fld = r.field != null && isFinite(+r.field) ? +r.field : null;
        if (fld != null && (!topField || fld > topField.val))
          topField = { val: fld, nome: r.nome || '', iso };
      });
      if (done) Object.values(done).forEach(v => { if (v && v.by) makerWeek[v.by] = (makerWeek[v.by] || 0) + 1; });
    }
    const top = Object.entries(makerWeek).sort((a,b) => b[1] - a[1])[0] || null;
    RECORDS = { topPrem, topField, topMaker: top ? { name: top[0], n: top[1] } : null };
  }catch(e){ console.warn('[SupremaTV] recordes indisponíveis', e); }
}

/* ═══════════════════ helpers de cena ═══════════════════ */

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
  if (e.createdBy) bits.push(`<span class="credit-chip maker">${avatarHtml(e.createdBy, 'cc-av')} criado por <b>${escHtml(e.createdBy)}</b></span>`);
  if (lv && lv.premBy) bits.push(`<span class="credit-chip">premiação por <b>${escHtml(lv.premBy)}</b></span>`);
  return bits.length ? `<div class="tv-credits">${bits.join('')}</div>` : '';
}
function suitWatermark(suit){
  return `<span class="suit-mark" aria-hidden="true">${suit}</span>`;
}
/* duração da cena por VOLUME DE CONTEÚDO, não fixa — era a causa raiz do "muito
   rápido": uma lista de 7 linhas cortava no mesmo relógio que um holofote com
   1 número. Conta palavras do HTML (aproxima o esforço de leitura) e escala
   entre min/max por tipo de cena. */
function sceneDuration(html, min, max){
  const words = String(html).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(min, Math.min(max, 2600 + words * 220));
}
/* cena de holofote (usada na rotação, no PIN do controle e na celebração) */
function spotlightHtml(e, st){
  const lv = liveOf(e);
  const chip =
    st.k === 'live' ? `<div class="tv-chip live" style="--i:0"><i class="pulse"></i>AO VIVO AGORA${e.late ? ` · LATE ATÉ ${e.late}` : ''}</div>` :
    st.k === 'soon' ? `<div class="tv-chip live" style="--i:0">COMEÇA EM ${fmtIn(st.inMin).toUpperCase()}</div>` :
    st.k === 'upcoming' ? `<div class="tv-chip live" style="--i:0">HOJE ÀS ${e.hora}</div>` : '';
  return `${suitWatermark(CAT_META[e.cat].suit)}
    ${chip}
    <h1 class="spot-title">${kinetic(e.nome, 1)}</h1>
    ${e.camp ? `<div class="tv-chip camp" style="--i:3">✦ CAMPANHA ${CAMP_LABEL[e.camp]}</div>` : ''}
    <div class="tv-stats">
      ${e.garantido != null ? statHtml('garantido', fmtMoney(e.garantido), 's-gtd', 4) : ''}
      ${lv.prem != null ? statHtml('premiação atual', fmtMoney(lv.prem), 's-prem', 5) : ''}
      ${lv.field != null ? statHtml('jogadores', NF_INT.format(lv.field), 's-field', 6) : ''}
      ${e.buyin != null ? statHtml('buy-in', fmtMoneyFull(e.buyin), '', 7) : ''}
    </div>
    ${creditHtml(e, lv)}`;
}

/* ═══════════════════ compositor de cenas ═══════════════════ */

let _compositions = 0;                                // conta as voltas do loop (marca não toca toda vez)
function composeScenes(){
  attachDayListeners();                              // se a grade virou, reancora
  _compositions++;
  const segments = [];                               // as cenas de "conteúdo" (a live e a marca entram na hora de montar a ordem)
  const today = todayWeekdayPT();
  const todays = MODEL.events.filter(e => e.weekday === today);
  matchCreators(MODEL.events, LIVE.doneToday, today);

  const withSt = todays.map(e => ({ e, st: statusOf(e) }));
  const liveNow = withSt.filter(x => x.st.k === 'live')
    .sort((a,b) => (b.e.garantido||0) - (a.e.garantido||0));
  const upcoming = withSt.filter(x => x.st.k === 'soon' || x.st.k === 'upcoming')
    .sort((a,b) => a.e.abs - b.e.abs);

  /* vinheta da casa — NÃO toca toda volta (repetitivo em horas de telão); só
     abre a 1ª composição e depois a cada 3 */
  const brandScene = (_compositions % 3 === 1) ? { cls:'s-brand', dur:7000, html:`
    <div class="b-mark shine">♠</div>
    <h1 class="b-title">${kinetic('SUPREMA TV')}</h1>
    <p class="b-sub" style="--i:3">${escHtml(today.replace('-FEIRA',''))} · ${fmtDateShort(MODEL.dates[today])} — a grade de hoje, ao vivo</p>` } : null;

  /* holofotes AO VIVO — montados aqui, mas INTERCALADOS na rotação lá embaixo
     (antes despejavam os 3 no início e sumiam por 2 min; um canal traz o "ao
     vivo" de volta ao longo do loop) */
  const liveScenes = liveNow.slice(0, 3).map(({e, st}) => {
    const html = spotlightHtml(e, st);
    return { cls:'s-spot ' + CAT_META[e.cat].cls, dur: sceneDuration(html, 10000, 15000), html };
  });

  /* 3 — a seguir hoje */
  if (upcoming.length){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">A SEGUIR HOJE</h2>
      <div class="tv-rows">${upcoming.slice(0, 7).map(({e, st}, i) => `
        <div class="tv-row" style="--i:${i+1}">
          <span class="tr-hora">${e.hora}</span>
          <span class="tr-suit ${CAT_META[e.cat].cls}">${CAT_META[e.cat].suit}</span>
          <span class="tr-nome">${escHtml(shortName(e.nome))}${e.camp ? ` <em class="tr-camp">✦ ${CAMP_LABEL[e.camp]}</em>` : ''}</span>
          <span class="tr-gtd">${e.garantido != null ? fmtMoney(e.garantido) : ''}</span>
          <span class="tr-in">${st.k === 'soon' ? 'em ' + fmtIn(st.inMin) : ''}</span>
        </div>`).join('')}</div>`;
    segments.push({ cls:'s-list', dur: sceneDuration(html, 10000, 20000), html });
  }

  /* 3b — campanhas em destaque (a Global tem #AS/+SPS/+SPT — a TV nunca dava
     palco especial pra elas, só um badge pequeno dentro do holofote) */
  const campToday = todays.filter(e => e.camp);
  if (campToday.length){
    const groups = {};
    campToday.forEach(e => { (groups[e.camp] = groups[e.camp] || []).push(e); });
    const order = ['AS', 'SPS', 'SPT'].filter(c => groups[c]);
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker gold" style="--i:0">CAMPANHAS EM DESTAQUE</h2>
      <div class="tv-camps">${order.map((c, gi) => `
        <div class="tv-camp-group" style="--i:${gi+1}">
          <div class="tc-tag">✦ ${CAMP_LABEL[c]}</div>
          <div class="tc-list">${groups[c].sort((a,b) => a.abs - b.abs).map(e => `
            <div class="tc-row">
              <span class="tc-hora">${e.hora}</span>
              <span class="tc-suit ${CAT_META[e.cat].cls}">${CAT_META[e.cat].suit}</span>
              <span class="tc-nome">${escHtml(shortName(e.nome))}</span>
              ${e.garantido != null ? `<span class="tc-gtd">${fmtMoney(e.garantido)}</span>` : ''}
            </div>`).join('')}</div>
        </div>`).join('')}</div>`;
    segments.push({ cls:'s-camps', dur: sceneDuration(html, 9000, 16000), html });
  }

  /* 4 — os gigantes da semana (top 5 GTD) */
  const top5 = [...MODEL.events].filter(e => e.garantido != null)
    .sort((a,b) => b.garantido - a.garantido).slice(0, 5);
  if (top5.length){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">OS GIGANTES DA SEMANA</h2>
      <div class="tv-rank">${top5.map((e, i) => `
        <div class="rank-row ${i === 0 ? 'first' : ''}" style="--i:${i+1}">
          <span class="rk-pos">${i+1}</span>
          <span class="rk-body"><span class="rk-nome">${escHtml(shortName(e.nome))}</span>
            <span class="rk-sub">${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} · ${e.hora}${e.buyin != null ? ' · buy-in ' + fmtMoneyFull(e.buyin) : ''}</span></span>
          <span class="rk-gtd tv-count">${fmtMoney(e.garantido)}</span>
        </div>`).join('')}</div>`;
    segments.push({ cls:'s-week', dur: sceneDuration(html, 10000, 18000), html });
  }

  /* 4b — a semana inteira (visão macro que faltava: até aqui só "hoje" tinha
     cena própria — um canal precisa dar contexto do que vem nos outros dias) */
  {
    const gtdByDay = {}; let gtdMax = 0;
    WEEK_ORDER.forEach(day => {
      const g = MODEL.events.filter(e => e.weekday === day).reduce((s,e) => s + (e.garantido || 0), 0);
      gtdByDay[day] = g;
      if (g > gtdMax) gtdMax = g;
    });
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">A SEMANA INTEIRA</h2>
      <div class="tv-week">${WEEK_ORDER.map((day, i) => {
        const iso = MODEL.dates[day];
        const n = MODEL.events.filter(e => e.weekday === day).length;
        const pct = gtdMax > 0 ? Math.round((gtdByDay[day] / gtdMax) * 100) : 0;
        return `<div class="tv-day ${day === today ? 'is-today' : ''}" style="--i:${i+1}">
          <span class="td-wd">${WEEKDAY_SHORT[isoWeekdayIdx(iso)]}</span>
          <span class="td-d">${+iso.slice(8)}</span>
          <span class="td-n">${n} evento${n === 1 ? '' : 's'}</span>
          <i class="td-bar" aria-hidden="true"><b style="width:${pct}%"></b></i>
          <span class="td-gtd">${fmtMoney(gtdByDay[day])}</span>
        </div>`;
      }).join('')}</div>`;
    segments.push({ cls:'s-grid', dur: sceneDuration(html, 10000, 16000), html });
  }

  /* 5 — os recordes da semana (snapshots + GU) */
  if (RECORDS && (RECORDS.topPrem || RECORDS.topField || RECORDS.topMaker)){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker gold" style="--i:0">OS RECORDES DA SEMANA</h2>
      <div class="tv-records">
        ${RECORDS.topPrem ? `<div class="tv-record" style="--i:1">
          <span class="rec-ico">🏆</span><span class="rec-label">MAIOR PREMIAÇÃO</span>
          <span class="rec-val tv-count">${fmtMoney(RECORDS.topPrem.val)}</span>
          <span class="rec-sub">${escHtml(shortName(RECORDS.topPrem.nome))} · ${WEEKDAY_SHORT[isoWeekdayIdx(RECORDS.topPrem.iso)]}</span></div>` : ''}
        ${RECORDS.topField ? `<div class="tv-record" style="--i:2">
          <span class="rec-ico">👥</span><span class="rec-label">MAIOR FIELD</span>
          <span class="rec-val tv-count">${NF_INT.format(RECORDS.topField.val)}</span>
          <span class="rec-sub">jogadores · ${escHtml(shortName(RECORDS.topField.nome))} · ${WEEKDAY_SHORT[isoWeekdayIdx(RECORDS.topField.iso)]}</span></div>` : ''}
        ${RECORDS.topMaker ? `<div class="tv-record" style="--i:3">
          <span class="rec-ico">${avatarHtml(RECORDS.topMaker.name, 'rec-av')}</span><span class="rec-label">MAIS EVENTOS CRIADOS</span>
          <span class="rec-val">${escHtml(RECORDS.topMaker.name)}</span>
          <span class="rec-sub">${RECORDS.topMaker.n} eventos nos últimos 7 dias 🌙</span></div>` : ''}
      </div>`;
    segments.push({ cls:'s-records', dur: sceneDuration(html, 9000, 15000), html });
  }

  /* 6 — comece pequeno, jogue grande (principais rotas de ticket de hoje) */
  const routeTargets = todays.filter(e => e.satCount > 0)
    .sort((a,b) => b.satCount - a.satCount || (b.garantido||0) - (a.garantido||0)).slice(0, 3);
  if (routeTargets.length){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">COMECE PEQUENO, JOGUE GRANDE</h2>
      <div class="tv-routes">${routeTargets.map((t, i) => {
        const sats = MODEL.events.filter(s => s.targetId === t.id).sort((a,b) => (a.buyin??Infinity) - (b.buyin??Infinity));
        const cheap = sats[0];
        return `<div class="tv-route" style="--i:${i+1}">
          <span class="tvr-from">♦ ${sats.length} satélite${sats.length > 1 ? 's' : ''}${cheap && cheap.buyin != null ? ` · desde <b>${fmtMoneyFull(cheap.buyin)}</b>` : ''}</span>
          <span class="tvr-arrow"><i></i>🎟<i></i></span>
          <span class="tvr-to">${CAT_META[t.cat].suit} ${escHtml(shortName(t.nome))}<small>${t.hora}${t.garantido != null ? ' · GTD ' + fmtMoney(t.garantido) : ''}</small></span>
        </div>`;
      }).join('')}</div>`;
    segments.push({ cls:'s-routes', dur: sceneDuration(html, 9000, 15000), html });
  }

  /* 7 — vem aí (eventos futuros, P&D) */
  const futs = MODEL.futures.slice(0, 3);
  if (futs.length){
    const todayISO = gradeTodayISO();
    const html = `${suitWatermark('✦')}
      <h2 class="sc-kicker gold" style="--i:0">VEM AÍ</h2>
      <div class="tv-futs">${futs.map((f, i) => {
        const days = f.dateISO ? isoDayNumber(f.dateISO) - isoDayNumber(todayISO) : null;
        return `<div class="tv-fut" style="--i:${i+1}">
          <span class="tf-when">${days == null ? 'EM BREVE' : days <= 0 ? 'HOJE' : days === 1 ? 'AMANHÃ' : 'EM ' + days + ' DIAS'}${f.dateISO ? ' · ' + fmtDateShort(f.dateISO).toUpperCase() : ''}</span>
          <span class="tf-nome">${escHtml(shortName(f.nome))}</span>
          ${f.garantido != null ? `<span class="tf-gtd tv-count">${fmtMoney(f.garantido)}</span><span class="tf-gl">garantidos</span>` : ''}
        </div>`;
      }).join('')}</div>`;
    segments.push({ cls:'s-future', dur: sceneDuration(html, 9000, 15000), html });
  }

  /* 8 — avisos da casa (os mesmos que o Admin edita pro hub) */
  if (AVISOS.length){
    const ICO = { info:'ℹ️', alerta:'⚠️', evento:'📅', promo:'✦', novidade:'✨' };
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">AVISOS DA CASA</h2>
      <div class="tv-avisos">${AVISOS.map((a, i) => `
        <div class="tv-aviso" style="--i:${i+1}">
          <span class="av-ico">${ICO[normText(a.tipo)] || '📣'}</span>
          <span class="av-body"><b>${escHtml(a.titulo)}</b>${a.texto || a.msg || a.desc ? `<small>${escHtml(a.texto || a.msg || a.desc)}</small>` : ''}</span>
        </div>`).join('')}</div>`;
    segments.push({ cls:'s-avisos', dur: sceneDuration(html, 9000, 18000), html });
  }

  /* 9 — quem construiu a noite (créditos da equipe + progresso da GU ao vivo) */
  const makerCount = {};
  Object.values(LIVE.doneToday || {}).forEach(v => {
    if (v && v.by) makerCount[v.by] = (makerCount[v.by] || 0) + 1;
  });
  const makers = Object.entries(makerCount).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const tomorrowDay = WEEKDAYS_PT[isoWeekdayIdx(isoAddDays(gradeTodayISO(), 1))];
  const tomorrowTotal = MODEL.events.filter(e => e.weekday === tomorrowDay).length;
  const tomorrowDone = Object.keys(LIVE.doneTomorrow || {}).length;
  if (makers.length || (tomorrowTotal && tomorrowDone)){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">QUEM CONSTRUIU A NOITE</h2>
      ${makers.length ? `<div class="tv-makers">${makers.map(([name, n], i) => `
        <div class="maker" style="--i:${i+1}">
          ${avatarHtml(name, 'mk-av')}
          <span class="mk-name">${escHtml(name)}</span>
          <span class="mk-n">${n} evento${n > 1 ? 's' : ''}</span>
        </div>`).join('')}</div>` : ''}
      ${tomorrowTotal && tomorrowDone ? `
        <div class="gu-progress" style="--i:${makers.length + 2}">
          <span class="gp-label">🌙 A GU está montando ${tomorrowDay.replace('-FEIRA','').toLowerCase()} agora:</span>
          <span class="gp-bar"><b style="width:${Math.min(100, Math.round(tomorrowDone / tomorrowTotal * 100))}%"></b></span>
          <span class="gp-n">${tomorrowDone} de ${tomorrowTotal} eventos criados</span>
        </div>` : ''}`;
    segments.push({ cls:'s-team', dur: sceneDuration(html, 9000, 16000), html });
  }

  /* ── monta a ORDEM final: marca (quando toca) → segmentos com os holofotes
     AO VIVO intercalados a cada ~2 blocos, e o que sobrar de live no fim ── */
  const scenes = [];
  if (brandScene) scenes.push(brandScene);
  let li = 0;
  segments.forEach((seg, i) => {
    if (li < liveScenes.length && i % 2 === 0) scenes.push(liveScenes[li++]);
    scenes.push(seg);
  });
  while (li < liveScenes.length) scenes.push(liveScenes[li++]);

  renderTicker(upcoming.map(x => x.e));
  return scenes;
}

/* ═══════════════════ motor de exibição ═══════════════════ */

let _onAir = false, _scenes = [], _idx = 0, _timer = null;
function renderScene(sc){
  const stage = document.getElementById('stage');
  /* CROSSFADE de transmissão: em vez de trocar o innerHTML (que deixava um
     FLASH PRETO entre cenas — a antiga sumia antes de a nova aparecer), a nova
     entra POR CIMA e a antiga esmaece junto. Sobreposição só de opacity/
     transform, sem custo de layout. countUp tem guarda __spCount, então os
     números da cena que está saindo não re-animam. */
  const outgoing = Array.from(stage.querySelectorAll('.scene'));
  const el = document.createElement('section');
  el.className = 'scene ' + sc.cls;
  el.innerHTML = sc.html + (sc.dur ? `<i class="scene-progress" style="animation-duration:${sc.dur}ms"></i>` : '');
  stage.appendChild(el);
  outgoing.forEach(prev => {
    prev.classList.remove('in');
    prev.classList.add('out');
    setTimeout(() => { if (prev.isConnected) prev.remove(); }, 1400);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('in');
    SupremaMotion.countUp('.tv-count', { duration:1500 });
  }));
}
function playNext(){
  if (REMOTE) return;
  if (CTRL.pause || CTRL.pin) return;                // o controle manda
  if (!MODEL){ _timer = setTimeout(playNext, 2000); return; }
  if (_idx >= _scenes.length){ _scenes = composeScenes(); _idx = 0; }
  const sc = _scenes[_idx++];
  if (!sc){ _timer = setTimeout(playNext, 3000); return; }
  renderScene(sc);
  clearTimeout(_timer);
  _timer = setTimeout(playNext, sc.dur);
}

/* ── 🎉 CELEBRAÇÃO: premiação lançada que BATE o garantido fura a fila ── */
const _celebrated = new Set();
function maybeCelebrate(prev, cur){
  if (!MODEL || REMOTE) return;
  const today = todayWeekdayPT();
  const byRk = new Map();
  MODEL.events.filter(e => e.weekday === today).forEach(e => byRk.set(painelRowKey(e), e));
  Object.entries(cur).forEach(([key, val]) => {
    if (typeof val !== 'number' || prev[key] === val) return;
    const ev = byRk.get(key) || byRk.get(key.replace(/_px$/, ''));
    if (!ev || ev.garantido == null || ev.garantido <= 0) return;
    if (val < ev.garantido) return;                  // ainda não bateu
    const stamp = DAY_ISO + '|' + key;
    if (_celebrated.has(stamp)) return;
    _celebrated.add(stamp);
    celebrate(ev, val);
  });
}
function celebrate(ev, val){
  if (CTRL.pause || CTRL.pin) return;                // controle tem prioridade
  clearTimeout(_timer);
  const lv = liveOf(ev);
  const diff = val - ev.garantido;
  renderScene({ cls:'s-boom ' + CAT_META[ev.cat].cls, dur:12000, html:`
    <canvas id="confettiCv" aria-hidden="true"></canvas>
    ${suitWatermark(CAT_META[ev.cat].suit)}
    <div class="tv-chip boom" style="--i:0">🎉 PREMIAÇÃO CONFIRMADA</div>
    <h1 class="spot-title">${kinetic(ev.nome, 1)}</h1>
    <div class="boom-val tv-count">${fmtMoney(val)}</div>
    <div class="boom-sub" style="--i:4">${diff > 0
      ? `superou o garantido de ${fmtMoney(ev.garantido)} em <b>${fmtMoney(diff)}</b>`
      : `bateu o garantido de ${fmtMoney(ev.garantido)}`}</div>
    ${creditHtml(ev, lv)}` });
  requestAnimationFrame(() => confetti(document.getElementById('confettiCv'), 9000));
  _timer = setTimeout(playNext, 12000);
}
/* confete em canvas: leve, autolimitado, cores da casa */
function confetti(cv, ms){
  if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  const COLORS = ['#e8c884','#c9a84c','#22d47e','#f4a9ba','#5aa8ff','#f0ede8'];
  const P = Array.from({ length: 150 }, () => ({
    x: Math.random()*W, y: -Math.random()*H*.4,
    vx: (Math.random()-.5)*2.4*dpr, vy: (1.6+Math.random()*2.6)*dpr,
    w: (5+Math.random()*7)*dpr, h: (8+Math.random()*10)*dpr,
    rot: Math.random()*Math.PI, vr: (Math.random()-.5)*.18,
    c: COLORS[(Math.random()*COLORS.length)|0],
  }));
  const t0 = performance.now();
  (function frame(t){
    if (!cv.isConnected || t - t0 > ms) return;
    ctx.clearRect(0, 0, W, H);
    const fade = Math.min(1, Math.max(0, (ms - (t - t0)) / 1500));
    ctx.globalAlpha = fade;
    P.forEach(p => {
      p.x += p.vx + Math.sin(t/450 + p.rot)*0.7*dpr;
      p.y += p.vy; p.rot += p.vr;
      if (p.y > H + 30) { p.y = -20; p.x = Math.random()*W; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    requestAnimationFrame(frame);
  })(t0);
}

/* ── 🎛 CONTROLE REMOTO: a TV obedece o nó tv/control ── */
let _ctrlReady = false;
function wireControl(){
  SupremaDB.watch('tv/control', snap => {
    const v = snap.val() || {};
    const prev = CTRL;
    CTRL = v;
    const chip = document.getElementById('pauseChip');
    if (chip) chip.hidden = !v.pause;
    if (REMOTE){ renderRemote(); return; }           // o controle só espelha o estado
    if (!_ctrlReady){ _ctrlReady = true; if (v.pin) showPin(); return; }
    if (v.pin && v.pin !== prev.pin){ showPin(); return; }
    if (!v.pin && prev.pin){ clearTimeout(_timer); playNext(); return; }
    if (v.pause && !prev.pause){ clearTimeout(_timer); return; }
    if (!v.pause && prev.pause){ clearTimeout(_timer); playNext(); return; }
    if (v.skip !== prev.skip && !v.pause && !v.pin){ clearTimeout(_timer); playNext(); }
  });
}
function showPin(){
  clearTimeout(_timer);
  if (!MODEL) return;
  const ev = MODEL.events.find(e => evKey(e) === CTRL.pin);
  if (!ev){ playNext(); return; }
  matchCreators(MODEL.events, LIVE.doneToday, todayWeekdayPT());
  renderScene({ cls:'s-spot pinned ' + CAT_META[ev.cat].cls, html:
    spotlightHtml(ev, statusOf(ev)) + '<div class="pin-tag">📌 destaque fixado pelo controle</div>' });
}

/* ── a interface do controle (tv.html?remote=1, no celular) ── */
function ctrlSet(patch){
  const by = ((SupremaAuth.getSession && SupremaAuth.getSession()) || {}).email || 'controle';
  SupremaDB.update('tv/control', { ...patch, by, at: Date.now() })
    .catch(err => console.error('[SupremaTV] controle falhou', err));
}
function renderRemote(){
  const stage = document.getElementById('stage');
  const today = todayWeekdayPT();
  const todays = MODEL ? MODEL.events.filter(e => e.weekday === today) : [];
  stage.innerHTML = `<div class="remote-ui">
    <h1>🎛 Controle da Suprema TV</h1>
    <p class="rc-state">${CTRL.pause ? '⏸ pausada' : CTRL.pin ? '📌 destaque fixado' : '▶ programação normal'}</p>
    <div class="rc-row">
      <button class="rc-btn ${CTRL.pause ? 'on' : ''}" id="rcPause">${CTRL.pause ? '▶ Retomar' : '⏸ Pausar'}</button>
      <button class="rc-btn" id="rcSkip">⏭ Próxima cena</button>
      ${CTRL.pin ? '<button class="rc-btn warn" id="rcUnpin">📌 Soltar destaque</button>' : ''}
    </div>
    <h2>Fixar um evento de hoje no telão</h2>
    <div class="rc-list">${todays.length ? todays.map(e => `
      <button class="rc-ev ${CTRL.pin === evKey(e) ? 'on' : ''}" data-pin="${escHtml(evKey(e))}">
        <span class="rce-hora">${e.hora}</span>
        <span class="rce-nome">${escHtml(shortName(e.nome))}</span>
        <span class="rce-pin">${CTRL.pin === evKey(e) ? '📌 no ar' : 'fixar'}</span>
      </button>`).join('') : '<p class="rc-state">carregando a grade…</p>'}</div>
  </div>`;
  const q = id => stage.querySelector('#' + id);
  if (q('rcPause')) q('rcPause').addEventListener('click', () => ctrlSet({ pause: !CTRL.pause }));
  if (q('rcSkip'))  q('rcSkip').addEventListener('click', () => ctrlSet({ skip: Date.now() }));
  if (q('rcUnpin')) q('rcUnpin').addEventListener('click', () => ctrlSet({ pin: null }));
  stage.querySelectorAll('.rc-ev').forEach(b => b.addEventListener('click', () => {
    ctrlSet({ pin: CTRL.pin === b.dataset.pin ? null : b.dataset.pin, pause: false });
  }));
}

/* ticker: a fita de eventos de hoje correndo no rodapé */
function renderTicker(upcoming){
  const wrap = document.getElementById('tickerWrap');
  const track = document.getElementById('tickerTrack');
  if (REMOTE || !upcoming.length){ wrap.hidden = true; return; }
  const items = upcoming.map(e =>
    `<span class="tk-item"><b>${e.hora}</b> ${escHtml(shortName(e.nome))}${e.garantido != null ? ` <em>${fmtMoney(e.garantido)}</em>` : ''}</span>`
  ).join('<span class="tk-sep">♦</span>');
  track.innerHTML = items + '<span class="tk-sep">♠</span>' + items + '<span class="tk-sep">♠</span>';
  wrap.hidden = false;
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
  if (!REMOTE) SupremaMotion.network('.tv-bg', { c1:'#c9a84c', c2:'#22d47e', maxNodes:64, linkDist:150, isDark: () => true });
  initData();
});

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
      if (!at){ showOffAir('sem-global'); return; }   // nó vazio: ninguém subiu a Global ainda
      if (`${at}` === `${_lastAt}`) return;
      _lastAt = `${at}`;
      loadSharedGlobal();
    });
    /* rede lenta ou regra negada: o watcher acima nunca dispara e o telão
       ficaria eternamente em "sintonizando…". Mesmo prazo do Radar. */
    setTimeout(() => { if (!MODEL) showOffAir('sem-sinal'); }, 12000);
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
    if (!v || !v.data){ showOffAir('sem-global'); return; }
    /* parse no Worker: uma Global nova chegando no meio de uma cena NÃO pode
       travar a transmissão (ver parseGlobalWeekAsync em radar-core.js) */
    LAST_PARSED = await parseGlobalWeekAsync(v.data, 'MTTS BRAZIL');
    MODEL = buildModel(LAST_PARSED, OVERRIDES);
    console.info(`[SupremaTV] programação carregada — ${MODEL.events.length} eventos na semana`);
    if (REMOTE){ renderRemote(); return; }
    _offAir = null;                                  // o sinal voltou
    if (!_onAir){ _onAir = true; playNext(); }
  }catch(err){
    console.error('[SupremaTV] falha ao carregar a Global', err);
    showOffAir('falha');
  }
}

/* ── CANAL FORA DO AR ── A TV não tinha estado de erro: sem Global no nó, o
   watcher só dava `return` e o telão ficava eternamente em "sintonizando a
   grade…" — ninguém na operação sabia dizer se era lentidão ou falha. Um canal
   ANUNCIA que está fora do ar. Volta sozinho: o watcher do `at` continua vivo e
   chama loadSharedGlobal quando a Global aparecer.
   Só vale ANTES de entrar no ar — se a grade sumir com a TV já transmitindo,
   segurar a última programação conhecida é melhor que apagar o telão. */
let _offAir = null;
const OFF_AIR = {
  'sem-global': { t:'Nenhuma grade publicada',
                  s:'Assim que a operação subir a Global MTT no Painel do Dia, a programação entra no ar sozinha.' },
  'sem-sinal':  { t:'Sem sinal',
                  s:'Não consegui alcançar a grade compartilhada. Continuo tentando reconectar.' },
  'falha':      { t:'Falha ao sintonizar',
                  s:'A Global chegou, mas não consegui ler a aba MTTS BRAZIL dela.' },
};
function showOffAir(reason){
  if (REMOTE || _onAir || _offAir === reason) return;
  _offAir = reason;
  clearTimeout(_timer);
  const c = OFF_AIR[reason] || OFF_AIR['sem-sinal'];
  /* fora do ar a sala PERDE A COR: sem categoria no palco, a névoa vai pro
     cinza e o calor cai a zero. A ausência de cor é parte do recado. */
  if (FELTRO) FELTRO.heat(0);
  renderScene({ cls:'s-brand s-offair', accent:'#8b9088', html:`
    <div class="b-mark offair-mark">♠</div>
    <h1 class="b-title offair-title">${escHtml(c.t)}</h1>
    <p class="b-sub" style="--i:2">${escHtml(c.s)}</p>
    <p class="offair-hint" style="--i:3">Pode deixar o telão ligado — a TV volta ao ar sozinha.</p>` });
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

/* ═══════════════════ português ═══════════════════
   Concordância num lugar só. Estava montada À MÃO em sete pontos, e a conta
   chegou: `bateu${n>1?'ram':''}` cuspiu "15 BATEURAM O GARANTIDO" no telão —
   o radical é "bat-", então o plural é "bateram", não "bateu"+"ram".
   O segundo erro era mais silencioso: `${n > 1 ? 's' : ''}` dá "0 evento", e
   zero em português pede PLURAL ("0 eventos"). Um ponto do arquivo já usava a
   forma certa (`n === 1 ? '' : 's'`) e os outros não — o arquivo se contradizia.
   Quem escreve texto pra tela não devia estar decidindo isto de novo a cada vez. */
const pl = (n, um, muitos) => (n === 1 ? um : muitos);
const conta = (n, um, muitos) => `${NF_INT.format(n)} ${pl(n, um, muitos)}`;

/* premiação SEMPRE EXATA — o valor que o operador preencheu, nunca abreviado.
   fmtMoney (radar-core) vira "R$ 9,9 mil" e come os centavos; aqui mostramos o
   número cheio, na MESMA regra de casas do Painel do Dia: inteiro sem decimais,
   com centavos mostra os dois. Só a premiação usa isto — garantido/records seguem
   abreviados (é manchete de telão). */
function fmtPrem(v){
  if (v == null || !isFinite(v)) return '—';
  const dec = v % 1 === 0 ? 0 : 2;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: 2 });
}

/* nome de operador pra tela: o Painel do Dia grava e-mail em alguns nós */
function nomeCurto(s){ return String(s || '').split('@')[0].trim(); }

/* ═══════════════════ performance do evento ═══════════════════
   A pergunta que a operação faz olhando o telão não é "quanto pagou", é "PASSOU
   do garantido ou a casa cobriu?". Premiação sozinha não responde: R$ 2,7 mil é
   ótimo num GTD de 2 mil e ruim num de 5 mil. O percentual responde.
   Overlay (premiação abaixo do garantido) não é ERRO — é a casa bancando a
   diferença, que faz parte do negócio. Por isso ele é dourado e não vermelho:
   vermelho aqui viraria alarme falso, e ainda brigaria com o vermelho do AO VIVO. */
function perfEvento(e, lv){
  if (e.garantido == null || e.garantido <= 0 || lv.prem == null) return null;
  return { pct: (lv.prem / e.garantido - 1) * 100, bateu: lv.prem >= e.garantido };
}
function fmtPerf(pct){
  const v = Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  /* sinal de menos DE VERDADE (U+2212), não hífen: num número grande em mono o
     hífen fica curto demais e some a 4 metros */
  return (pct >= 0 ? '+' : '−') + v.toLocaleString('pt-BR') + '%';
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
/* ── etiqueta de categoria ──
   A casa pede que TODA linha diga, em palavra, se é Main / Side / Satélite — não
   só a cor do naipe. A 3-6 metros de distância a cor sozinha não classifica; o
   nome curto ao lado do naipe classifica. É o mesmo naipe+cor da família que a
   operação já lê no Radar, agora com rótulo. */
const CAT_SHORT = { main:'MAIN EVENT', side:'SIDE EVENT', sat:'SATÉLITE' };
function catTag(cat){
  const m = CAT_META[cat]; if (!m) return '';
  return `<span class="cat-tag ${m.cls}"><i>${m.suit}</i><b>${CAT_SHORT[cat]}</b></span>`;
}
/* os eventos FUTUROS chegam com `tipo` cru (a Global não normaliza a coluna de
   tipo no rodapé) — mesma regra do parser: radical decide, desconhecido vira side */
function catFromTipo(tipo){
  const t = normText(tipo);
  if (t.includes('main')) return 'main';
  if (t.includes('sat'))  return 'sat';
  if (t.includes('side')) return 'side';
  return t ? 'side' : null;
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
      ${lv.prem != null ? statHtml('premiação atual', fmtPrem(lv.prem), 's-prem', 5) : ''}
      ${lv.field != null ? statHtml('jogadores', NF_INT.format(lv.field), 's-field', 6) : ''}
      ${e.buyin != null ? statHtml('buy-in', fmtMoneyFull(e.buyin), '', 7) : ''}
    </div>
    ${creditHtml(e, lv)}`;
}

/* ═══════════════════ O ROLO ═══════════════════
   As cenas de lista sangravam pra fora do telão: a de campanhas não tinha
   limite nenhum (numa sexta com 16 eventos #AS, listava os 16) e, como .scene é
   flex centralizado, o excesso vazava por cima do relógio E por baixo do ticker
   ao mesmo tempo.

   A saída ÓBVIA seria truncar em N, ou quebrar em páginas ("A SEGUIR 1/3").
   Nenhuma das duas presta: truncar esconde metade do dia, e paginar transforma
   o canal num PowerPoint. Um canal não passa slides.

   Então a grade CORRE. É o mesmo dispositivo do ticker do rodapé — que já é a
   linguagem da casa — girado 90°. O que isso compra:
   · nada é truncado e nada é paginado: o dia inteiro passa, inteiro;
   · a lista SÓ SE MEXE QUANDO PRECISA. Cinco eventos ficam parados; dezesseis
     correm. O movimento vira a informação "tem mais coisa aqui embaixo", em vez
     de enfeite — e o dia cheio PARECE cheio, do outro lado da sala;
   · a duração da cena passa a ser consequência do conteúdo: a velocidade de
     leitura é constante, o relógio é que se ajusta.

   O CSS não tem como saber a altura do conteúdo, então a distância (--roll) e a
   duração (--roll-ms) são medidas no render, uma vez por cena. */
const ROLO_ESPERA = 2200;                     // parado antes de começar a correr: dá tempo de achar o topo
const ROLO_RESPIRO = 2600;                    // parado no fim: dá tempo de ler as últimas linhas
const ROLO_TETO = 48000;                      // nenhuma cena sequestra o loop
/* px por segundo, proporcional à tela (~54px/s num 1080p): a linha tem altura
   em vh, então a velocidade tem que acompanhar ou a leitura muda com o telão */
function roloVel(){ return innerHeight * 0.05; }

function ajustaRolo(el, durBase){
  const box = el.querySelector('.tv-scroll');
  const track = box && box.querySelector('.tv-roll');
  if (!box || !track) return durBase;
  /* offsetHeight, NÃO scrollHeight: a medição roda antes da classe .in, quando as
     linhas ainda estão em transform:translateY(26px) — e transform de descendente
     ENTRA na área de overflow rolável do ancestral. Com scrollHeight, uma lista de
     4 eventos que cabia folgada acusava 26px de excesso e saía rolando: a régua
     estava medindo a animação de entrada em vez do conteúdo. offsetHeight é o
     layout, e layout não enxerga transform. */
  const excesso = track.offsetHeight - box.clientHeight;
  if (excesso <= 2){
    /* coube inteiro: fica PARADO e SEM máscara — a máscara existe pra suavizar a
       linha que entra; numa lista parada ela só desbotaria a primeira e a última
       de graça */
    track.style.setProperty('--roll-ms', '0ms');
    return durBase;
  }
  const correr = (excesso / roloVel()) * 1000;
  box.classList.add('rolando');
  track.style.setProperty('--roll', `-${Math.round(excesso)}px`);
  track.style.setProperty('--roll-ms', `${Math.round(correr)}ms`);
  return Math.min(ROLO_TETO, ROLO_ESPERA + correr + ROLO_RESPIRO);
}
/* o stagger de entrada é por tempo, não por posição: com 40 linhas o --i faria
   a última esperar 4,4s pra aparecer. Depois da 9ª ninguém está olhando o
   stagger — está olhando o rolo. */
function iCap(i){ return Math.min(i, 9); }

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
  const brandScene = (_compositions % 3 === 1) ? { cls:'s-brand', dur:7000, accent:GOLD, html:`
    <div class="b-mark shine">♠</div>
    <h1 class="b-title">${kinetic('SUPREMA TV')}</h1>
    <p class="b-sub" style="--i:3">${escHtml(today.replace('-FEIRA',''))} · ${fmtDateShort(MODEL.dates[today])} — a grade de hoje, ao vivo</p>` } : null;

  /* holofotes AO VIVO — montados aqui, mas INTERCALADOS na rotação lá embaixo
     (antes despejavam os 3 no início e sumiam por 2 min; um canal traz o "ao
     vivo" de volta ao longo do loop) */
  const liveScenes = liveNow.slice(0, 3).map(({e, st}) => {
    const html = spotlightHtml(e, st);
    return { cls:'s-spot ' + CAT_META[e.cat].cls, dur: sceneDuration(html, 10000, 15000),
             accent: CAT_ACCENT[e.cat], html };
  });

  /* 3 — a seguir hoje: o DIA INTEIRO correndo (o slice(0,7) escondia o resto) */
  if (upcoming.length){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">A SEGUIR HOJE
        <em class="sc-cnt">${conta(upcoming.length, 'evento', 'eventos')} até o fim do dia</em></h2>
      <div class="tv-scroll"><div class="tv-rows tv-roll">${upcoming.map(({e, st}, i) => `
        <div class="tv-row" style="--i:${iCap(i+1)}">
          <span class="tr-hora">${e.hora}</span>
          ${catTag(e.cat)}
          <span class="tr-nome">${escHtml(shortName(e.nome))}${e.camp ? ` <em class="tr-camp">✦ ${CAMP_LABEL[e.camp]}</em>` : ''}</span>
          <span class="tr-buyin">${e.buyin != null ? 'buy-in ' + fmtMoneyFull(e.buyin) : ''}</span>
          <span class="tr-gtd">${e.garantido != null ? fmtMoney(e.garantido) : ''}</span>
          <span class="tr-in">${st.k === 'soon' ? 'em ' + fmtIn(st.inMin) : ''}</span>
        </div>`).join('')}</div></div>`;
    segments.push({ cls:'s-list s-roll', dur: sceneDuration(html, 10000, 20000), accent:GOLD, html });
  }

  /* 3b — JÁ ROLOU HOJE: o fecho do dia, que faltava.
     A TV só sabia falar do que VEM. Quem entra na sala às 22h não tinha como
     saber como foi o dia — e premiação final contra garantido é a melhor
     notícia que a casa tem pra dar. Do mais recente pro mais antigo. */
  const jaRolou = withSt.filter(x => x.st.k === 'past')
    .map(x => ({ e: x.e, lv: liveOf(x.e) }))
    .filter(x => x.lv.prem != null)
    .sort((a, b) => b.e.abs - a.e.abs);
  if (jaRolou.length){
    const bateram = jaRolou.filter(x => x.e.garantido != null && x.lv.prem >= x.e.garantido).length;
    const pago = jaRolou.reduce((s, x) => s + x.lv.prem, 0);
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">JÁ ROLOU HOJE
        <em class="sc-cnt">${conta(jaRolou.length, 'evento', 'eventos')} · ${fmtMoney(pago)} em premiação</em>
        ${bateram ? `<em class="sc-cnt felt">✦ ${bateram} ${pl(bateram, 'bateu', 'bateram')} o garantido</em>` : ''}</h2>
      <div class="tv-scroll"><div class="tv-done-list tv-roll">${jaRolou.map(({e, lv}, i) => {
        const p = perfEvento(e, lv);
        const quem = nomeCurto(lv.premBy);
        return `<div class="tv-done" style="--i:${iCap(i+1)}">
          <span class="dn-hora">${e.hora}</span>
          <span class="dn-suit ${CAT_META[e.cat].cls}">${CAT_META[e.cat].suit}</span>
          <span class="dn-body">
            <span class="dn-nome">${escHtml(shortName(e.nome))}${e.camp ? ` <em class="tr-camp">✦ ${CAMP_LABEL[e.camp]}</em>` : ''}</span>
            <span class="dn-sub">${[
              e.buyin != null ? `buy-in ${fmtMoneyFull(e.buyin)}` : null,
              e.garantido != null ? `garantido ${fmtMoney(e.garantido)}` : null,
              lv.field != null ? `${conta(lv.field, 'jogador', 'jogadores')}` : null,
            ].filter(Boolean).join(' · ')}</span>
          </span>
          <span class="dn-prem${p && p.bateu ? ' bateu' : ''}">${fmtPrem(lv.prem)}</span>
          <span class="dn-perf${p ? (p.bateu ? ' bateu' : ' overlay') : ''}">${p ? fmtPerf(p.pct) : ''}
            <small>${p ? (p.bateu ? 'sobre o GTD' : 'de overlay') : 'sem garantido'}</small></span>
          <span class="dn-by">${quem
            ? `${avatarHtml(quem, 'dn-av')}<small>${escHtml(quem)} lançou</small>`
            : '<small class="dn-sem">premiação sem autor</small>'}</span>
        </div>`;
      }).join('')}</div></div>`;
    segments.push({ cls:'s-list s-roll s-done', dur: sceneDuration(html, 9000, 18000), accent:'#22d47e', html });
  }

  /* 3b — campanhas em destaque (a Global tem #AS/+SPS/+SPT — a TV nunca dava
     palco especial pra elas, só um badge pequeno dentro do holofote) */
  /* ERA AQUI QUE O TELÃO RASGAVA: a lista de cada campanha não tinha limite
     nenhum. Numa sexta com 16 eventos #AS, os 16 entravam — e o excesso vazava
     por cima do relógio e por baixo do ticker. Continua trazendo TODOS: agora
     eles correm (ver "O ROLO" acima) em vez de estourar a caixa. */
  const campToday = todays.filter(e => e.camp);
  if (campToday.length){
    const groups = {};
    campToday.forEach(e => { (groups[e.camp] = groups[e.camp] || []).push(e); });
    const order = ['AS', 'SPS', 'SPT'].filter(c => groups[c]);
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker gold" style="--i:0">CAMPANHAS EM DESTAQUE
        <em class="sc-cnt">${conta(campToday.length, 'evento', 'eventos')} hoje</em></h2>
      <div class="tv-scroll"><div class="tv-camps tv-roll">${order.map((c, gi) => {
        const evs = groups[c].sort((a,b) => a.abs - b.abs);
        const gtd = evs.reduce((s,e) => s + (e.garantido || 0), 0);
        /* dentro da campanha, a categoria manda: Main na frente, depois Side,
           depois Satélite — a mesma ordem de leitura do resto do canal */
        const byCat = {};
        evs.forEach(e => { (byCat[e.cat] = byCat[e.cat] || []).push(e); });
        const cats = ['main','side','sat'].filter(k => byCat[k]);
        return `<div class="tv-camp-group" style="--i:${iCap(gi+1)}">
          <div class="tc-tag">✦ ${CAMP_LABEL[c]}<em>${conta(evs.length, 'evento', 'eventos')} · ${fmtMoney(gtd)} GTD</em></div>
          <div class="tc-cats">${cats.map(k => `
            <div class="tc-cat ${CAT_META[k].cls}">
              <div class="tc-cat-head">${catTag(k)}<span class="tc-cat-n">${conta(byCat[k].length, 'evento', 'eventos')}</span></div>
              <div class="tc-list">${byCat[k].map(e => `
                <div class="tc-row">
                  <span class="tc-hora">${e.hora}</span>
                  <span class="tc-nome">${escHtml(shortName(e.nome))}</span>
                  <span class="tc-buyin">${e.buyin != null ? 'buy-in ' + fmtMoneyFull(e.buyin) : ''}</span>
                  <span class="tc-gtd">${e.garantido != null ? fmtMoney(e.garantido) : ''}</span>
                </div>`).join('')}</div>
            </div>`).join('')}</div>
        </div>`;
      }).join('')}</div></div>`;
    segments.push({ cls:'s-camps s-roll', dur: sceneDuration(html, 9000, 18000), accent:'#f4a9ba', html });
  }

  /* 4 — os gigantes da semana (top 5 GTD)
     Cada gigante ganha o TELÃO INTEIRO, um por um (holofote com nome, GTD, dia,
     buy-in e categoria), e no fim entra o tier completo com os cinco. Antes eram
     só cinco linhas de lista — os maiores torneios da semana mereciam palco. */
  const top5 = [...MODEL.events].filter(e => e.garantido != null)
    .sort((a,b) => b.garantido - a.garantido).slice(0, 5);
  const GIANTS_SOLO = 3;                              // top 3 no holofote; o resto só no tier
  top5.slice(0, GIANTS_SOLO).forEach((e, i) => {
    const html = `${suitWatermark(CAT_META[e.cat].suit)}
      <div class="giant-rank" style="--i:0"><b>Nº ${i+1}</b><span>GIGANTE DA SEMANA</span></div>
      <h1 class="spot-title giant-title">${kinetic(e.nome, 1)}</h1>
      <div class="giant-cat" style="--i:3">${catTag(e.cat)}${e.camp ? ` <span class="tr-camp">✦ ${CAMP_LABEL[e.camp]}</span>` : ''}</div>
      <div class="tv-stats">
        ${statHtml('garantido', fmtMoney(e.garantido), 's-gtd', 4)}
        ${e.buyin != null ? statHtml('buy-in', fmtMoneyFull(e.buyin), '', 5) : ''}
        <div class="tv-stat s-when" style="--i:6">
          <span class="v">${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} · ${e.hora}</span>
          <span class="l">quando</span></div>
      </div>`;
    segments.push({ cls:'s-giant ' + CAT_META[e.cat].cls, dur: sceneDuration(html, 8000, 11000),
                    accent: CAT_ACCENT[e.cat], html });
  });
  if (top5.length){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker gold" style="--i:0">O TIER DA SEMANA
        <em class="sc-cnt">os ${top5.length} maiores garantidos</em></h2>
      <div class="tv-rank">${top5.map((e, i) => `
        <div class="rank-row ${i === 0 ? 'first' : ''}" style="--i:${i+1}">
          <span class="rk-pos">${i+1}</span>
          <span class="rk-body"><span class="rk-nome">${escHtml(shortName(e.nome))}</span>
            <span class="rk-sub">${catTag(e.cat)} · ${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} · ${e.hora}${e.buyin != null ? ' · buy-in ' + fmtMoneyFull(e.buyin) : ''}</span></span>
          <span class="rk-gtd tv-count">${fmtMoney(e.garantido)}</span>
        </div>`).join('')}</div>`;
    segments.push({ cls:'s-week', dur: sceneDuration(html, 10000, 18000), accent:GOLD, html });
  }

  /* 4b — a semana inteira (visão macro que faltava: até aqui só "hoje" tinha
     cena própria — um canal precisa dar contexto do que vem nos outros dias) */
  {
    /* a barra de cada dia deixa de ser um bloco dourado só de tamanho: agora ela
       mostra a COMPOSIÇÃO do dia (quanto de GTD é Main, Side, Satélite), na cor
       da família. A altura ainda diz "que dia é o maior"; a cor diz "de quê". */
    const gtdByDay = {}, mixByDay = {}; let gtdMax = 0, gtdWeek = 0, nWeek = 0;
    WEEK_ORDER.forEach(day => {
      const evs = MODEL.events.filter(e => e.weekday === day);
      const mix = { main:0, side:0, sat:0 };
      evs.forEach(e => { mix[e.cat] += (e.garantido || 0); });
      const g = mix.main + mix.side + mix.sat;
      gtdByDay[day] = g; mixByDay[day] = mix; gtdWeek += g; nWeek += evs.length;
      if (g > gtdMax) gtdMax = g;
    });
    /* LINHAS horizontais, não colunas: num telão 16:9 a barra que corre pro
       LADO é a leitura natural (é a língua do ticker) — as colunas verticais
       ficavam magras, com rótulo espremido embaixo. Uma linha por dia: o dia
       forte salta pelo comprimento, a cor diz de que ele é feito. */
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker gold" style="--i:0">A SEMANA INTEIRA
        <em class="sc-cnt">${conta(nWeek, 'evento', 'eventos')} · ${fmtMoney(gtdWeek)} garantidos</em></h2>
      <div class="tv-week-legend" style="--i:1" aria-hidden="true">${catTag('main')}${catTag('side')}${catTag('sat')}</div>
      <div class="tv-week">${WEEK_ORDER.map((day, i) => {
        const iso = MODEL.dates[day];
        const n = MODEL.events.filter(e => e.weekday === day).length;
        const g = gtdByDay[day];
        const pct = gtdMax > 0 && g > 0 ? Math.max(4, Math.round((g / gtdMax) * 100)) : 0;
        const mix = mixByDay[day], tot = g || 1;
        return `<div class="tv-day ${day === today ? 'is-today' : ''}" style="--i:${i+2}">
          <span class="td-wd">${WEEKDAY_SHORT[isoWeekdayIdx(iso)]}<b>${+iso.slice(8)}</b>${day === today ? '<em class="td-live">HOJE</em>' : ''}</span>
          <span class="td-n">${n ? conta(n, 'evento', 'eventos') : '—'}</span>
          <i class="td-bar" aria-hidden="true">${pct ? `<span class="td-fill" style="width:${pct}%">
            <b class="c-main" style="flex:${mix.main / tot}"></b><b class="c-side" style="flex:${mix.side / tot}"></b><b class="c-sat" style="flex:${mix.sat / tot}"></b>
          </span>` : ''}</i>
          <span class="td-gtd">${g ? fmtMoney(g) : ''}</span>
        </div>`;
      }).join('')}</div>`;
    segments.push({ cls:'s-grid', dur: sceneDuration(html, 10000, 16000), accent:GOLD, html });
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
    segments.push({ cls:'s-records', dur: sceneDuration(html, 9000, 15000), accent:GOLD, html });
  }

  /* 6 — comece pequeno, jogue grande (principais rotas de ticket de hoje) */
  const routeTargets = todays.filter(e => e.satCount > 0)
    .sort((a,b) => b.satCount - a.satCount || (b.garantido||0) - (a.garantido||0));
  if (routeTargets.length){
    const html = `${suitWatermark('♥')}
      <h2 class="sc-kicker" style="--i:0">COMECE PEQUENO, JOGUE GRANDE
        <em class="sc-cnt">${conta(routeTargets.length, 'torneio', 'torneios')} com rota de ticket hoje</em></h2>
      <div class="tv-scroll"><div class="tv-routes tv-roll">${routeTargets.map((t, i) => {
        const sats = MODEL.events.filter(s => s.targetId === t.id).sort((a,b) => (a.buyin??Infinity) - (b.buyin??Infinity));
        const cheap = sats[0];
        return `<div class="tv-route" style="--i:${iCap(i+1)}">
          <span class="tvr-from">
            <span class="tvr-sat">♦ ${conta(sats.length, 'satélite', 'satélites')}</span>
            ${cheap && cheap.buyin != null ? `<span class="tvr-buy">buy-in de <b>${fmtMoneyFull(cheap.buyin)}</b></span>` : ''}
          </span>
          <span class="tvr-arrow"><i></i>🎟<i></i></span>
          <span class="tvr-to">
            <span class="tvr-to-top">${catTag(t.cat)}<span class="tvr-nome">${escHtml(shortName(t.nome))}</span></span>
            <small>${t.hora}${t.garantido != null ? ' · GTD ' + fmtMoney(t.garantido) : ''}${t.buyin != null ? ' · buy-in ' + fmtMoneyFull(t.buyin) : ''}</small></span>
        </div>`;
      }).join('')}</div></div>`;
    /* rota de ticket é assunto de SATÉLITE — a névoa vai pro violeta da família */
    segments.push({ cls:'s-routes s-roll', dur: sceneDuration(html, 9000, 15000), accent: CAT_ACCENT.sat, html });
  }

  /* 7 — vem aí (eventos futuros, P&D)
     O primeiro futuro é o HERÓI da cena — o que está mais perto de acontecer
     ganha metade do telão, com contagem regressiva grande. Os outros dois entram
     como cartas menores ao lado. Antes eram três cartões iguais; "vem aí" pede um
     que puxe o olho. */
  /* re-filtra o passado AQUI, não só no buildModel: o telão fica ligado por
     horas e o dia vira com o MODEL parado — sem isso, à meia-noite um "HOJE"
     virava mentira até alguém subir Global nova */
  const todayISO = gradeTodayISO();
  const futs = MODEL.futures.filter(f => !f.dateISO || f.dateISO >= todayISO).slice(0, 3);
  if (futs.length){
    const whenOf = f => {
      const days = f.dateISO ? isoDayNumber(f.dateISO) - isoDayNumber(todayISO) : null;
      const rel = days == null ? 'EM BREVE' : days <= 0 ? 'HOJE' : days === 1 ? 'AMANHÃ' : 'EM ' + days + ' DIAS';
      return { rel, days };
    };
    const [hero, ...rest] = futs;
    const hw = whenOf(hero); const hcat = catFromTipo(hero.tipo);
    const heroHtml = `<div class="tv-fut-hero" style="--i:1">
      <span class="tfh-when"><b>${hw.rel}</b>${hero.dateISO ? `<span>${fmtDateShort(hero.dateISO).toUpperCase()}</span>` : ''}</span>
      <span class="tfh-nome">${escHtml(hero.nome)}</span>
      <div class="tfh-meta">${hcat ? catTag(hcat) : ''}${hero.buyin != null ? `<span class="tfh-buy">buy-in ${fmtMoneyFull(hero.buyin)}</span>` : ''}</div>
      ${hero.garantido != null ? `<span class="tfh-gtd tv-count">${fmtMoney(hero.garantido)}</span><span class="tfh-gl">garantidos</span>` : ''}
    </div>`;
    const restHtml = rest.length ? `<div class="tv-fut-rest">${rest.map((f, i) => {
      const w = whenOf(f); const c = catFromTipo(f.tipo);
      return `<div class="tv-fut" style="--i:${i+2}">
        <span class="tf-when">${w.rel}${f.dateISO ? ' · ' + fmtDateShort(f.dateISO).toUpperCase() : ''}</span>
        <span class="tf-nome">${escHtml(shortName(f.nome))}</span>
        <div class="tf-meta">${c ? catTag(c) : ''}${f.buyin != null ? `<span class="tf-buy">buy-in ${fmtMoneyFull(f.buyin)}</span>` : ''}</div>
        ${f.garantido != null ? `<span class="tf-gtd tv-count">${fmtMoney(f.garantido)}</span><span class="tf-gl">garantidos</span>` : ''}
      </div>`;
    }).join('')}</div>` : '';
    const html = `${suitWatermark('✦')}
      <h2 class="sc-kicker gold" style="--i:0">VEM AÍ</h2>
      <div class="tv-futs${rest.length ? '' : ' solo'}">${heroHtml}${restHtml}</div>`;
    segments.push({ cls:'s-future', dur: sceneDuration(html, 9000, 15000), accent:'#f4a9ba', html });
  }

  /* 8 — avisos da casa (os mesmos que o Admin edita pro hub) */
  if (AVISOS.length){
    const ICO = { info:'ℹ️', alerta:'⚠️', evento:'📅', promo:'✦', novidade:'✨' };
    const html = `${suitWatermark('♣')}
      <h2 class="sc-kicker gold" style="--i:0">AVISOS DA CASA
        <em class="sc-cnt">${conta(AVISOS.length, 'recado', 'recados')} da operação</em></h2>
      <div class="tv-avisos">${AVISOS.map((a, i) => {
        const tp = normText(a.tipo);
        return `<div class="tv-aviso tp-${tp || 'info'}" style="--i:${i+1}">
          <span class="av-ico">${ICO[tp] || '📣'}</span>
          <span class="av-body">
            <span class="av-tag">${escHtml((a.tipo || 'aviso').toUpperCase())}</span>
            <b>${escHtml(a.titulo)}</b>
            ${a.texto || a.msg || a.desc ? `<small>${escHtml(a.texto || a.msg || a.desc)}</small>` : ''}
          </span>
        </div>`;
      }).join('')}</div>`;
    segments.push({ cls:'s-avisos', dur: sceneDuration(html, 9000, 18000), accent:GOLD, html });
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
          <span class="mk-n">${conta(n, 'evento', 'eventos')}</span>
        </div>`).join('')}</div>` : ''}
      ${tomorrowTotal && tomorrowDone ? `
        <div class="gu-progress" style="--i:${makers.length + 2}">
          <span class="gp-label">🌙 A GU está montando ${tomorrowDay.replace('-FEIRA','').toLowerCase()} agora:</span>
          <span class="gp-bar"><b style="width:${Math.min(100, Math.round(tomorrowDone / tomorrowTotal * 100))}%"></b></span>
          <span class="gp-n">${tomorrowDone} de ${tomorrowTotal} eventos criados</span>
        </div>` : ''}`;
    /* violeta da Criação Noturna (--sup-p-gu) — é o time dela que está no palco */
    segments.push({ cls:'s-team', dur: sceneDuration(html, 9000, 16000), accent: CAT_ACCENT.sat, html });
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

/* as cores das categorias, iguais às de tv.css (--main-c/--side-c/--sat-c) — é
   a mesma família que a operação já lê nas linhas do Radar. O fundo passa a
   falar essa língua junto com o texto. */
const GOLD = '#c9a84c';
const CAT_ACCENT = { main:'#f06050', side:'#5aa8ff', sat:'#b888f0' };

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
  el.innerHTML = sc.html;
  stage.appendChild(el);
  /* a duração é medida DEPOIS de montar: numa cena de rolo ela é consequência
     do tamanho da lista, não um número escolhido antes de saber o que tem nela
     (ver "O ROLO"). A barra de progresso só entra agora porque precisa saber
     por quanto tempo correr. */
  const dur = sc.dur ? ajustaRolo(el, sc.dur) : 0;
  if (dur) el.insertAdjacentHTML('beforeend', `<i class="scene-progress" style="animation-duration:${dur}ms"></i>`);
  outgoing.forEach(prev => {
    prev.classList.remove('in');
    prev.classList.add('out');
    setTimeout(() => { if (prev.isConnected) prev.remove(); }, 1400);
  });
  /* o fundo entra no corte junto com a cena: a onda de choque marca o corte de
     transmissão e a névoa migra pra cor da categoria que está subindo */
  if (FELTRO){
    FELTRO.pulse();
    FELTRO.accent(sc.accent || GOLD);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('in');
    SupremaMotion.countUp('.tv-count', { duration:1500 });
  }));
  return dur;
}
function playNext(){
  if (REMOTE) return;
  if (CTRL.pause || CTRL.pin) return;                // o controle manda
  if (!MODEL){ _timer = setTimeout(playNext, 2000); return; }
  if (_idx >= _scenes.length){ _scenes = composeScenes(); _idx = 0; }
  const sc = _scenes[_idx++];
  if (!sc){ _timer = setTimeout(playNext, 3000); return; }
  /* o relógio da cena vem do renderScene, não do sc.dur: numa lista que corre,
     quem manda na duração é o tamanho da lista */
  const dur = renderScene(sc);
  clearTimeout(_timer);
  _timer = setTimeout(playNext, dur || sc.dur || 8000);
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
  renderScene({ cls:'s-boom ' + CAT_META[ev.cat].cls, dur:12000, accent: CAT_ACCENT[ev.cat], html:`
    <canvas id="confettiCv" aria-hidden="true"></canvas>
    ${suitWatermark(CAT_META[ev.cat].suit)}
    <div class="tv-chip boom" style="--i:0">🎉 PREMIAÇÃO CONFIRMADA</div>
    <h1 class="spot-title">${kinetic(ev.nome, 1)}</h1>
    <div class="boom-val tv-count">${fmtPrem(val)}</div>
    <div class="boom-sub" style="--i:4">${diff > 0
      ? `superou o garantido de ${fmtMoney(ev.garantido)} em <b>${fmtMoney(diff)}</b>`
      : `bateu o garantido de ${fmtMoney(ev.garantido)}`}</div>
    ${creditHtml(ev, lv)}` });
  /* a sala inteira acende: bloom dourado na névoa e os motes disparam pra cima.
     O confete em canvas continua por cima — um é o AMBIENTE, o outro é o evento. */
  if (FELTRO) FELTRO.boom();
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
  renderScene({ cls:'s-spot pinned ' + CAT_META[ev.cat].cls, accent: CAT_ACCENT[ev.cat], html:
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
  /* a sala esquenta com a casa: grade parada = névoa fria; dois ou mais
     torneios rolando = calor no máximo. Quem entra na sala LÊ isso de longe,
     antes de conseguir ler qualquer texto. */
  if (FELTRO && !_offAir) FELTRO.heat(Math.min(1, live / 2));
}, 5000);

document.getElementById('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

/* o chrome acorda com o mouse e dorme sozinho — num telão, ponteiro e botão
   parados na tela são sujeira permanente na imagem */
let _awake = 0;
addEventListener('pointermove', () => {
  document.body.classList.add('tv-awake');
  clearTimeout(_awake);
  _awake = setTimeout(() => document.body.classList.remove('tv-awake'), 2500);
}, { passive:true });

/* ═══════════════════ fundo: O FELTRO (WebGL) ═══════════════════
   O fundo deixou de ser decoração e virou parte da transmissão: a névoa se
   tinge com a categoria da cena no ar, esquenta quando tem torneio AO VIVO,
   estala a cada corte e explode em dourado quando uma premiação bate o
   garantido. Ver suprema-feltro.js.

   A rede de nós continua existindo como REDE DE SEGURANÇA: sem WebGL, com o
   shader falhando ou com a máquina não dando conta nem no tier mais baixo, o
   Feltro chama onFallback e o canal volta pro fundo antigo em canvas 2D.
   Escape manual pro operador: tv.html?feltro=0 */
let FELTRO = null;
function mountBackground(){
  const paraOCanvas2D = () => {
    FELTRO = null;
    SupremaMotion.network('.tv-bg', { c1:'#c9a84c', c2:'#22d47e', maxNodes:64, linkDist:150, isDark: () => true });
  };
  if (new URLSearchParams(location.search).get('feltro') === '0'){ paraOCanvas2D(); return; }
  FELTRO = SupremaFeltro.mount('.tv-bg', {
    bg:'#0b0c10', gold:'#c9a84c', felt:'#22d47e',
    onFallback: paraOCanvas2D,
  });
  if (FELTRO) console.info(`[SupremaTV] fundo O Feltro no ar — tier "${FELTRO.tier()}"`);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!REMOTE) mountBackground();
  initData();
});

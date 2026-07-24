/* ============================================================
   PAINEL DO DIA - JS extraido do index.html.
   Externo por FLUIDEZ: o V8 compila script externo em streaming
   (fora da main thread) e o sw.js cacheia este arquivo separado -
   mudou JS, o HTML de 90KB nao invalida junto.
   Carregado no fim do <body>: o DOM acima ja existe quando roda.
   ============================================================ */

/* =========================================================================
   VÍDEO DE FUNDO DA TELA DE BOAS-VINDAS — casa de cartas em 3D, embutido em base64
   (arquivo único auto-contido, sem depender de hospedagem externa). Cortado pra remover
   a marca d'água do material de referência e com crossfade no fim pra dar loop suave.
========================================================================= */
/* ── Vídeo de fundo da tela de boas-vindas — LAZY + libera memória ao fechar ──
   Antes: bg.mp4 era baixado e DECODIFICADO na memória em todo carregamento (mesmo
   pra quem nem via a tela), com preload="auto", e ficava residente pra sempre.
   Agora: só carrega quando a tela realmente aparece, PAUSA fora de foco e LIBERA
   a memória (removeAttribute('src')+load()) ao sair. Em máquinas com pouca RAM,
   conexão em economia de dados ou movimento reduzido, nem carrega. */
(function welcomeVideoManager(){
  const video = document.getElementById('welcomeVideo');
  const overlay = document.getElementById('operatorOverlay');
  if(!video || !overlay) return;

  const conn = navigator.connection || {};
  const lowResources =
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    conn.saveData === true ||
    /(^|-)2g$/.test(conn.effectiveType || '') ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let loaded = false;
  function load(){
    if(loaded || lowResources) return;
    loaded = true;
    try{
      video.src = 'bg.mp4';
      const show = () => video.classList.add('ready');
      video.addEventListener('canplay', show, {once:true});
      video.addEventListener('loadeddata', show, {once:true});
      const p = video.play();
      if(p !== undefined) p.catch(() => {
        const retry = () => { video.play().catch(()=>{}); document.removeEventListener('click', retry); document.removeEventListener('keydown', retry); };
        document.addEventListener('click', retry, {once:true});
        document.addEventListener('keydown', retry, {once:true});
      });
    }catch(e){ console.warn('Vídeo de boas-vindas não carregou.', e); }
  }
  function release(){
    if(!loaded) return;
    loaded = false;
    try{ video.pause(); video.removeAttribute('src'); video.load(); video.classList.remove('ready'); }catch(e){}
  }
  const sync = () => { overlay.classList.contains('open') ? load() : release(); };
  new MutationObserver(sync).observe(overlay, {attributes:true, attributeFilter:['class']});
  sync();

  document.addEventListener('visibilitychange', () => {
    if(document.hidden){ if(!video.paused) video.pause(); }
    else if(loaded && overlay.classList.contains('open')){ video.play().catch(()=>{}); }
  });
})();

/* heroVideo: pausa quando sai da tela / aba oculta (o arquivo pode nem existir —
   nesse caso é inofensivo). Evita decodificar frames fora de vista. */
(function heroVideoManager(){
  const hero = document.getElementById('heroVideo');
  if(!hero || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(entries => {
    entries.forEach(e => {
      if(e.isIntersecting) hero.play?.().catch(()=>{});
      else if(!hero.paused) hero.pause();
    });
  }, {threshold:0.01}).observe(hero);
  document.addEventListener('visibilitychange', () => { if(document.hidden && !hero.paused) hero.pause(); });
})();

/* ── PERF: congela animações quando a janela perde o foco ──────────────────
   Quando o painel está aberto mas você está usando OUTRO app, não há motivo pra
   manter animações rodando — elas só mantêm a GPU/compositor ativos e deixam o
   resto do PC lento. Aqui pausamos tudo no blur e retomamos no focus. */
(function freezeAnimationsWhenBlurred(){
  const set = frozen => document.body.classList.toggle('win-blurred', frozen);
  window.addEventListener('blur',  () => set(true));
  window.addEventListener('focus', () => set(false));
  document.addEventListener('visibilitychange', () => set(document.hidden));
  if(!document.hasFocus()) set(true); // já entra congelado se abriu sem foco
})();

/* ── PERF: congela animações após inatividade ──────────────────────────────
   win-blurred só cobre a JANELA sem foco. Mas o painel também fica FOCADO e
   parado por longos períodos (operador observando, ou trabalhando na mesma tela
   sem mexer no painel) — e aí toda animação infinite continua a 60fps, segurando
   o compositor à toa. Após 60s sem interação, ligamos body.sp-idle (pausa CSS,
   ver painel.css). Contrato idêntico ao prefers-reduced-motion: nada de
   informação se perde (cores/labels de atraso seguem visíveis, só o movimento
   para); qualquer pointer/tecla/scroll retoma na hora. */
(function freezeAnimationsWhenIdle(){
  const IDLE_MS = 60000;
  let timer = null, lastReset = 0;
  const sleep = () => document.body.classList.add('sp-idle');
  const arm   = () => { clearTimeout(timer); timer = setTimeout(sleep, IDLE_MS); };
  const onActivity = () => {
    if(document.body.classList.contains('sp-idle')){ // acordou de fato
      document.body.classList.remove('sp-idle'); arm(); lastReset = Date.now(); return;
    }
    const now = Date.now();                          // em uso: rearmar no máx 1x/s
    if(now - lastReset < 1000) return;               // (pointermove dispara dezenas de vezes/s)
    lastReset = now; arm();
  };
  ['pointerdown','pointermove','keydown','wheel','touchstart'].forEach(ev =>
    window.addEventListener(ev, onActivity, {passive:true}));
  window.addEventListener('scroll', onActivity, {passive:true, capture:true});
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) clearTimeout(timer);         // aba oculta: browser já freia; não precisa timer
    else { document.body.classList.remove('sp-idle'); arm(); }
  });
  if(document.hasFocus()) arm();
})();

/* =========================================================================
   STATE
========================================================================= */
let RAW_ROWS = [];        // raw parsed rows from the sheet
/* Índice _key → row. Os listeners do Firebase faziam RAW_ROWS.find() dentro de
   forEach (cada evento de premiação/field/garantido varria o array inteiro por
   chave, pra CADA chave) — O(chaves × linhas) num dia cheio. O índice é
   reconstruído junto com RAW_ROWS (ver setRawRows) e derruba isso pra O(chaves). */
let ROW_BY_KEY = new Map();
function rowByKey(key){ return ROW_BY_KEY.get(key); }
function reindexRows(){ ROW_BY_KEY = new Map(RAW_ROWS.map(r => [r._key, r])); }
let UPCOMING = [];
let _compactMode = localStorage.getItem('suprema_compact_mode_v1') === '1';        // open tournaments (no premiação yet)
let RESULTS = [];         // closed tournaments (premiação filled)
let UNFIXED = [];         // not-fixed tournaments (any status, no Ações/owner)
let activeUpcomingCat = new Set(['all']); // Set: permite múltiplos filtros ativos ao mesmo tempo (ex.: Main Event + Satélite)
let nameSearchQuery = '';
let activeResultsCat = 'all';
let upcomingPremFilter = 'all'; // 'all' | 'sem' | 'com'
let upcomingCampFilter = 'all'; // 'all' | 'AS' | 'SPS' | 'SPT' — filtra por tipo específico de campanha, não só "tem ou não"
let resultsNameSearchQuery = '';
let timeFilterMin = null; // minutos desde meia-noite, ou null = filtro de horário desativado

/* =========================================================================
   DECLARAÇÕES ANTECIPADAS — todas as let/const globais declaradas aqui para
   evitar "Cannot access X before initialization" (TDZ do JS)
========================================================================= */
// Storage keys
const FIXED_STORE_KEY            = 'suprema_fixed_v1';
const PREM_BY_STORE_KEY          = 'suprema_prem_by_v1';
const ID_STORE_KEY               = 'suprema_ids_v1';
const FIELD_STORE_KEY            = 'suprema_field_v1';
const GARANTIDO_STORE_KEY        = 'suprema_garantido_v1';
const CHECKLIST_STORE_KEY        = 'suprema_checklist_v1';
const CONFHOJE_STORE_KEY         = 'suprema_confhoje_v1';
const FB_RETENTION_DAYS          = 45; // fechamento semanal + auditoria da diretoria acontecem em cima
                                        // dos nós painel/<data> — 14 dias dava margem apertada se um
                                        // fechamento atrasasse; 45 cobre folgado um ciclo mensal inteiro
const SHIFT_REPORT_STORE_KEY     = 'suprema_shift_report_v1';
// Maps (inicializados com Object.assign após as funções de storage estarem prontas)
let FIXED_MAP                    = {};
let PREM_BY_MAP                  = {}; // quem preencheu premiação/field de cada torneio — { by, at } — usado só pra exibir "responsável" nos Resultados, não conta como "fixado"
let ID_MAP                       = {};
let FIELD_MAP                    = {};
let GARANTIDO_MAP                = {};
// Chaves de premiação que JÁ apareceram no nó `premiacao` do Firebase nesta sessão.
// A reconciliação só pode anular uma premiação cuja chave FOI vista e depois SUMIU
// (exclusão real do operador). Uma chave que nunca esteve no nó — premiação da planilha,
// ou premiação reatada por nome+hora após o garantido mudar a chave — não é "apagada",
// só "não vive no nó". Sem isso, o total aparecia e ia baixando até zerar no F5.
let PREM_FB_KEYS_SEEN            = new Set();
/* TORNEIOS MANUAIS — eventos criados às pressas que não estão na Global.
   Vivem em nó PRÓPRIO (painel/<data>/manualRows) e são fundidos na planilha a cada ingest.
   Nó próprio (em vez de só gravar dentro do sheet) porque um re-upload da Global SUBSTITUI
   o sheet inteiro — os manuais sumiriam junto. Assim eles sobrevivem e voltam no merge.
   Depois do merge o caminho é IDÊNTICO ao da planilha: card, KPI, snapshot, parceiro e
   auditoria (o admin lê painel/<data>/sheet.rows, e o setSharedSheet publica o conjunto fundido). */
/* "estamos online AGORA?" — lido pelo diagnóstico. undefined até o 1º handshake do
   Firebase (não é offline: é "ainda não sei"), pra não acusar queda em todo carregamento. */
let FB_CONNECTED                 = undefined;
let MANUAL_ROWS                  = {};   // { id: row }
let LAST_SHEET_ROWS              = [];   // planilha PURA (sem manuais) — base pro merge
let LAST_SHEET_FILENAME          = '';
let CHECKLIST_MAP                = {};
let CONFHOJE_MAP                 = {};
let LAST_APPLIED_SHEET_SIGNATURE = null;
let LAST_PARSE_WARNINGS          = [];
// Firebase
let FB_BASE_PATH                 = '';
let fbDb                         = null;
let fbReady                      = false;
let offlineBannerTimer           = null;
// Estado geral
let MY_LAST_UPLOAD_AT            = null;
let SHIFT_REPORT_TEXT            = '';
let SHIFT_REPORT_REMOTE_PENDING  = null;
let LAST_CONF_AMANHA             = null;
let CASH_TABLE_MATRIX_CACHE      = {};
let CASH_TABLE_WORKBOOK          = null;
let CASH_TABLE_LAST_LOADED_AT    = null;
let LAST_PROGRESS_DONE           = null;
const _debouncedFieldSave = {};
const _debouncedIdSave    = {};
let LAST_CASH_TABLE_RESULTS      = [];
let YESTERDAY_METRICS            = null;
let YESTERDAY_LOAD_STARTED       = false;
let HOVERED_CARD_KEY             = null;
let LAST_KNOWN_DATE              = null; // inicializado após todayPathSP()
let CONFHOJE_ITEMS               = [];
let CONFHOJE_META                = null; // diagnóstico da última leitura (linhas lidas, sem horário, duplicados) — pra avisar o operador sem depender só do toast
let CONFHOJE_SEARCH              = '';   // busca rápida dentro do checklist de hoje
let CONFHOJE_HIDE_DONE           = false; // true = esconde os já conferidos, sobrando só o que falta
let ROLLOVER_HELD_TOAST          = false; // aviso único de "virada segurada esperando o último card" (declarado aqui em cima pra não cair em TDZ como o _opFilter)
let LAST_CONF_AMANHA_            = null;
let _opFilter                    = 'all'; // 'all' | 'me' | 'partner' — movido pra cá (era declarado só perto do fim do arquivo) porque
                                           // renderUpcoming() usa essa variável e pode rodar durante a restauração do sheet local,
                                           // antes do script chegar na declaração original — 'let' em TDZ vira ReferenceError nesse caso
// Observers — declarados antes de renderUnfixed/renderUpcoming
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  });
}, {threshold:0.1});
const animVisibilityIO = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    entry.target.classList.toggle('anim-offscreen', !entry.isIntersecting);
  });
}, {rootMargin:'200px 0px'});
// tfDisplayText — usado em ingest antes do bloco TIME FILTER
const tfDisplayText = document.getElementById('tfDisplayText');

/* =========================================================================
   HELPERS
========================================================================= */
const SP_TZ = 'America/Sao_Paulo';

/* escapa HTML para uso seguro em innerHTML */
function escHtml(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* hora/minuto atuais SEMPRE no fuso de Brasília, independente do fuso configurado no dispositivo do usuário.
   usa Intl.DateTimeFormat (suportado nativamente, não depende de libs externas) */
function nowInSP(){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SP_TZ, hour12: false,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;
  return {
    year: parseInt(get('year'),10),
    month: parseInt(get('month'),10),
    day: parseInt(get('day'),10),
    hour: parseInt(get('hour'),10) % 24, // "24" às vezes vem no lugar de "00" em alguns runtimes
    minute: parseInt(get('minute'),10),
    second: parseInt(get('second'),10),
  };
}
/* minutos desde meia-noite, hora de Brasília, agora */
function nowMinutesSP(){
  const n = nowInSP();
  return n.hour * 60 + n.minute;
}
/* PONTO ÚNICO da regra de madrugada: 00:00–05:29 ainda pertence ao dia operacional anterior
   (a grade de torneios vai de 06:10 a 05:30). Aceita um {hour,minute} opcional pra testes.
   Toda decisão de "que dia é agora" no painel passa por aqui — não reimplemente a expressão. */
function isMadrugadaSP(n){
  n = n || nowInSP();
  return n.hour < 5 || (n.hour === 5 && n.minute < 30);
}

/* debounce genérico: atrasa a execução até a pessoa parar de digitar por `wait` ms — usado nas buscas
   por nome (Agenda/Resultados/Servidores), que com a planilha cheia reconstroem até ~150 cards a cada
   chamada. Sem isso, digitar rápido (ex: "harmony") reconstruiria a lista inteira uma vez por letra,
   na maioria das vezes descartando o resultado antes mesmo dele aparecer na tela. */
function debounce(fn, wait){
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* setInterval "consciente de visibilidade": pula a execução enquanto a aba está oculta.
   OTIMIZAÇÃO: usa um único listener de visibilitychange centralizado (em vez de um por
   chamada), evitando que 6 chamadas acumulem 6 listeners e disparem 6x ao alternar abas. */
const _visibilitySubscribers = [];
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){
    _visibilitySubscribers.forEach(fn => { try{ fn(); }catch(e){} });
    // Restaura todos os previews de cards ao voltar para a aba
    // Garante que Alt+Tab não deixe Excedente/Ações/Perf apagados
    RAW_ROWS.forEach(r => {
      if(r.premiacao != null || FIELD_MAP[r._key] != null){
        renderCardOverlayPreview(r._key, r, r.premiacao, FIELD_MAP[r._key]);
      }
    });
  }
});
function setVisibilityAwareInterval(fn, ms){
  const id = setInterval(() => {
    if(document.visibilityState === 'visible') fn();
  }, ms);
  _visibilitySubscribers.push(fn); // executa imediatamente ao voltar a ficar visível
  return id;
}

/* ── agendador de UI coalescido ──
   A CAUSA RAIZ do painel pesado: no carregamento, CADA listener do Firebase
   (premiação, fixed, premBy, ids, field, garantido…) dispara uma vez ao anexar
   e cada um chamava renderResults()/renderUpcoming() DIRETO — 6-8 rebuilds
   completos do DOM em sequência, com centenas de cards cada. Em uso, cada
   edição de outro operador repetia o rebuild.
   Aqui os pedidos viram FLAGS ('results', 'upcoming', 'unfixed', 'stats') e um
   único flush 40ms depois faz cada trabalho UMA vez, na ordem certa. As guardas
   de digitação/eco são avaliadas NO FLUSH — o estado que vale é o de agora, não
   o de quando o evento chegou. */
const _uiPending = new Set();
let _uiFlushTimer = null;
function scheduleUI(...parts){
  parts.forEach(p => _uiPending.add(p));
  if(_uiFlushTimer != null) return;
  _uiFlushTimer = setTimeout(flushUI, 40);
}
function flushUI(){
  _uiFlushTimer = null;
  const parts = new Set(_uiPending);
  _uiPending.clear();
  if(parts.has('unfixed')){
    UNFIXED = computeUnfixed();
    const el = document.getElementById('statUnfixed');
    if(el) el.textContent = UNFIXED.length;
  }
  if(parts.has('stats')){ computeStats(); updateProgress(); }
  if(parts.has('unfixed')) renderUnfixed();
  if(parts.has('results')) renderResults();
  if(parts.has('upcoming') && !isTypingInCard() && !window._suppressRenderUpcoming) renderUpcoming();
}

const fmtBRL = (v, decimals=0) => {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toLocaleString('pt-BR', {minimumFractionDigits:decimals, maximumFractionDigits:decimals});
};
const fmtBuyin = (v) => {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return v === 0 ? "Free" : "R$ " + fmtBRL(v, v % 1 === 0 ? 0 : 2);
};
// overlay = premiação - garantido; usado tanto no card normal quanto na linha compacta
const calcOverlay = (prem, gar) => {
  if (isNaN(prem) || !(prem > 0) || !(gar > 0)) return null;
  return prem - gar;
};
const fmtOverlay = (overlay) => {
  const abs = Math.abs(overlay);
  return (overlay < 0 ? '-R$' : '+R$') + fmtBRL(abs, abs % 1 === 0 ? 0 : 2);
};
const fmtCompact = (v) => {
  if (v === null || v === undefined || isNaN(v)) return "R$ 0";
  if (Math.abs(v) >= 1000000) return "R$ " + (v/1000000).toFixed(2).replace('.', ',') + "M";
  if (Math.abs(v) >= 1000) return "R$ " + (v/1000).toFixed(0) + "K";
  return "R$ " + fmtBRL(v);
};

/* Vídeo decorativo do herói (opcional). Quando há arquivo, ele substitui o leque de cartas SVG;
   quando não há, o leque continua — o erro nunca quebra o painel.

   PRA LIGAR: exporte o vídeo, salve na mesma pasta e ponha o nome aqui (ex: 'hero.mp4'/'hero.webm').
   Com null (padrão) NENHUMA requisição é feita. Antes o src era fixo em 'hero.mp4' e o arquivo
   nunca existiu: todo carregamento, de todo operador, gastava um request e sujava o console
   com um 404 — por nada. */
const HERO_VIDEO_SRC = null;
(function initHeroVideo(){
  if(!HERO_VIDEO_SRC) return;
  const video = document.getElementById('heroVideo');
  const wrap  = document.getElementById('heroCards');
  if(!video || !wrap) return;
  video.addEventListener('loadeddata', () => {
    wrap.classList.add('has-video');
    video.play().catch(() => {}); // autoplay mudo é permitido; se bloquear, sem problema
  }, {once:true});
  video.addEventListener('error', () => { wrap.classList.remove('has-video'); }, {once:true});
  video.src = HERO_VIDEO_SRC;
})();

/* respeita a preferência do sistema por menos movimento — usada pelas animações feitas em JS
   (as feitas em CSS já são neutralizadas pelo bloco global @media prefers-reduced-motion) */
function prefersReducedMotion(){
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* count-up dos KPIs do topo: anima do valor anterior até o novo (easeOutCubic, ~700ms) em vez de
   trocar o número seco. Guarda o valor cru em data-rawVal pra a próxima animação partir de onde parou.
   Robusto offline (rAF puro, sem depender de lib externa) e cai pro valor final se reduced-motion. */
function animateCount(el, to, format){
  if(!el) return;
  format = format || (v => String(Math.round(v)));
  const from = parseFloat(el.dataset.rawVal || '0') || 0;
  el.dataset.rawVal = to;
  if(el._countRAF) cancelAnimationFrame(el._countRAF);
  if(prefersReducedMotion() || from === to || !isFinite(to)){ el.textContent = format(to); return; }
  const dur = 700, start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * eased);
    if(p < 1) el._countRAF = requestAnimationFrame(tick);
    else el.textContent = format(to);
  };
  el._countRAF = requestAnimationFrame(tick);
}
function excelTimeToString(v){
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    // already "HH:MM" or "HH:MM:SS"
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    if (m) return m[1].padStart(2,'0') + ':' + m[2];
    return v;
  }
  if (typeof v === 'number') {
    // excel time fraction of a day
    const totalMinutes = Math.round(v * 24 * 60);
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
  }
  if (v instanceof Date) {
    return String(v.getHours()).padStart(2,'0') + ':' + String(v.getMinutes()).padStart(2,'0');
  }
  return String(v);
}
/* parse de número BR ("R$ 1.234,56" → 1234.56) — regra em painel-calc.js */
function toNumber(v){ return PainelCalc.toNumber(v); }

/* a planilha usa -1 (e variações como "-1", "-1.0") como valor "vazio/sentinela" em colunas como
   Nome Usuário e PERF % quando o evento ainda não aconteceu — trata isso como ausência de dado real */
function sanitizeText(v){
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '-1' || s === '-1.0' || s === '-') return null;
  return s;
}

/* classify: prioriza a coluna "Tipo" da planilha (tolerante a grafias como "Main event", "Satelite" sem acento);
   senão usa heurística (Seats -> satélite, Garantido >= 20000 -> main, senão side) */
function classify(row){ return PainelCalc.classify(row); }
const CAT_LABEL = {main:'Main Event', side:'Side Event', sat:'Satélite'};
const CAT_SUIT = {main:'♠', side:'♣', sat:'♦'};

/* Detecta se um torneio tem campanha ativa: #AS, SPT, SPS no nome */
function hasCampanha(row){ return PainelCalc.hasCampanha(row); }

/* qual campanha específica bate com o nome do torneio ('AS' | 'SPS' | 'SPT') — usado pelo filtro
   de campanha, que deixa escolher uma campanha em particular em vez de só "tem ou não tem" */
function campanhaTipoDe(row){
  const n = (row.nome || '').toUpperCase();
  if (n.includes('#AS')) return 'AS';
  if (n.includes('SPS')) return 'SPS'; // cobre "SPS" e "+SPS"
  if (n.includes('SPT')) return 'SPT'; // cobre "SPT" e "+SPT"
  return null;
}

/* Calcula rake baseado na categoria e campanha */
function calcRake(row){
  const cat = classify(row);
  if(cat === 'sat') return 0.05;
  if(hasCampanha(row)) return 0.12;
  return 0.10;
}

/* (calcOverlayCard removida: era código MORTO e QUEBRADO — ninguém a chamava e
   ela lia `cat`/`isCamp` como variáveis livres, nunca declaradas, então a
   primeira chamada teria dado ReferenceError. Pior: o nome parecia o cálculo
   canônico de overlay e convidava ao reuso. O cálculo de verdade é
   PainelCalc.acoes()/calcOverlay(), em painel-calc.js, coberto por teste.) */
/* ficha de poker mini, usada no lugar de um emoji genérico no badge "Rolando agora" —
   reforça a identidade do produto em vez de um 🔴 sem relação com o tema */
const MINI_CHIP_SVG = `<svg class="mini-chip" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.18"/><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.7"/></svg>`;

/* coroa usada para destacar Main Events em qualquer badge/card */
const CROWN_SVG = `<svg class="crown-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.5 1.5 7l5.4 4L12 4l5.1 7 5.4-4-1.5 10.5a1 1 0 0 1-1 .85H4a1 1 0 0 1-1-.85Z"/><rect x="3.3" y="19" width="17.4" height="2.2" rx="1"/></svg>`;

/* antecedência mínima (em minutos) com que cada categoria deve ser fixada antes do horário do evento */
const LEAD_MIN = {main:60, side:60, sat:30};

/* define se um evento PRECISA ser fixado: Main e Satélite sempre; Side Event só quando marcado em azul na planilha
   usada pelo alerta vermelho "Não fixados" — a marcação azul NÃO afeta o filtro "O que fixar até HH:MM" (ver renderUpcoming) */
function mustFix(row, cat){
  if (cat === 'main' || cat === 'sat') return true;
  if (cat === 'side'){
    // marcado em azul na planilha OU garantido >= 3000
    if (row.highlighted) return true;
    const gtd = row.garantido ?? getGarantidoEffective(row._key);
    if (gtd != null && gtd >= 3000) return true;
  }
  return false;
}

function showToast(msg, isError=false){
  const t = document.getElementById('toast');
  document.getElementById('toastText').textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  t.querySelector('.toast-icon-ok').style.display = isError ? 'none' : '';
  t.querySelector('.toast-icon-err').style.display = isError ? '' : 'none';
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(()=> t.classList.remove('show'), 3600);
}

/* simple stable hash for row identity (name+hora+buyin) used as localStorage key */
function rowKey(row){
  const s = `${row.nome}|${row.hora}|${row.buyin}|${row.garantido}`;
  let h = 0;
  for (let i=0; i<s.length; i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  // card do PRÓX. CRONOGRAMA ganha sufixo próprio: o mesmo evento pode existir no quadro como
  // madrugada de HOJE (card normal) e como madrugada de AMANHÃ (prox) com valores idênticos —
  // sem o sufixo as chaves colidiriam e fixar um marcaria o outro
  return 'rk_' + Math.abs(h) + (row.proxCronograma ? '_px' : '');
}

/* checa quantos torneios JÁ FIXADOS (ou com ID preenchido) na planilha atual deixariam de existir na
   nova planilha — a chave de cada torneio (rowKey) depende de nome+hora+buyin+garantido, então qualquer
   ajuste nesses valores entre uma planilha e outra (ex: garantido corrigido depois de fechar o pote)
   muda a chave e "perde" o vínculo com quem já fixou aquele torneio, mesmo sem o operador perceber.
   Só vale a pena rodar essa checagem se já havia uma planilha carregada antes (RAW_ROWS.length > 0). */
function countOrphanedFixedKeys(newRows){
  if (!RAW_ROWS.length) return 0;
  const newKeys = new Set(newRows.map(r => rowKey(r)));
  let orphaned = 0;
  RAW_ROWS.forEach(r => {
    const hadWork = isFixed(r._key) || !!getId(r._key);
    if (hadWork && !newKeys.has(r._key)) orphaned++;
  });
  return orphaned;
}

/* data de hoje por extenso em pt-BR, sempre no fuso de Brasília — ex: "sexta-feira, 19 de junho de 2026" */
function dataPorExtensoSP(){
  const dias = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const n = nowInSP();
  // dia da semana calculado a partir da data (ano/mês/dia) já no fuso de SP, via UTC neutro pra evitar reintroduzir o fuso do navegador
  const weekday = new Date(Date.UTC(n.year, n.month - 1, n.day)).getUTCDay();
  return `${dias[weekday]}, ${n.day} de ${meses[n.month - 1]} de ${n.year}`;
}

/* timeToMinutes (HH:MM -> minutos) vem de gu-parser.js */

/* minutos desde meia-noite -> "HH:MM", com wrap em 24h */
function minutesToHHMM(min){
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}

/* "rolando agora": o torneio já começou e ainda está dentro do late registration (ou, sem late
   informado, dentro de um teto de 3h após o início — janela de fallback razoável pra torneios de
   poker). Função única reaproveitada tanto no card individual quanto no filtro "Rolando agora". */
function isRunningNow(t, nowMin){
  if (gradeDaysAhead() > 0) return false; // grade já é do dia seguinte: nada dela está "rolando agora"
  const startMin = timeToMinutes(t.hora);
  const lateMin = timeToMinutes(t.late);
  const endMin = lateMin !== null ? lateMin : (startMin !== null ? startMin + 180 : null);
  return startMin !== null && endMin !== null && nowMin >= startMin && nowMin <= endMin;
}

/* status de tempo do evento comparado ao agora: 'late' (já passou do PRAZO-LIMITE de fixar, ou seja
   horaEvento - antecedência), 'soon' (dentro da janela de antecedência, mas o prazo ainda não venceu), ou null.
   ex: torneio às 01:00 com antecedência de 60min -> prazo-limite é 00:00. Se já são 00:05, já está
   atrasado (late), mesmo o torneio em si só começando às 01:00 — uma vez atrasado, o aviso permanece
   até o evento ser marcado como fixado, sem expirar sozinho */
/* relógio OPERACIONAL: a madrugada (00:00–05:30) acontece no FIM do dia da grade, não no começo —
   sem esse deslocamento, um card de 00:00 às 9h da manhã aparecia como "atrasado há 638min" */
function opMinutes(min){
  return (min !== null && min <= 330) ? min + 1440 : min; // <= 05:30 → +24h
}
/* quantos dias a GRADE exibida está À FRENTE do dia operacional do relógio. Quando o cronograma
   fecha 100% e a Global do dia seguinte é carregada antes da virada (05:30), LAST_KNOWN_DATE
   avança mas o relógio ainda é do dia anterior — sem esse desconto, todos os eventos do dia novo
   anteriores à hora atual apareciam como "atrasados" na hora do upload */
function gradeDaysAhead(){
  try{
    if (typeof LAST_KNOWN_DATE === 'undefined' || !LAST_KNOWN_DATE) return 0;
    const today = todayPathSP();
    if (LAST_KNOWN_DATE <= today) return 0;
    const p = s => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y, m-1, d); };
    return Math.max(0, Math.round((p(LAST_KNOWN_DATE) - p(today)) / 86400000));
  }catch(e){ return 0; }
}
/* relógio operacional JÁ ajustado pro dia da grade — todo cálculo de atraso/em breve usa este */
function opNowMinutes(){
  return opMinutes(nowMinutesSP()) - 1440 * gradeDaysAhead();
}
function timeStatus(hhmm, cat){
  const evMinRaw = timeToMinutes(hhmm);
  if (evMinRaw === null) return null;
  const evMin = opMinutes(evMinRaw);
  const lead = LEAD_MIN[cat] ?? 30;
  const nowMin = opNowMinutes();
  const deadline = evMin - lead;       // horário em que o torneio PRECISA estar fixado
  const diffToDeadline = deadline - nowMin;
  if (diffToDeadline < 0) return 'late';
  if (diffToDeadline <= lead) return 'soon'; // dentro da janela de antecedência, contando até o prazo
  return null;
}

/* status de urgência exibido no card (e usado pelo filtro de status "Atrasado"/"Em breve"): null se o
   torneio já foi fixado ou nem precisa ser fixado (Side Event sem marcação) — mantém o filtro 100%
   consistente com o que o card realmente mostra, reaproveitando a mesma regra em vez de duplicá-la. */
/* ── Histórico do torneio ── */
let _historico = {};

function loadHistorico(){
  if(!fbReady) return;
  fbDb.ref('historico').once('value').then(snap => {
    const raw = snap.val()||{};
    _historico = {};
    Object.values(raw).forEach(day => {
      if(!day||typeof day!=='object') return;
      Object.values(day).forEach(r => {
        if(!r||!r.nome) return;
        if(!_historico[r.nome]) _historico[r.nome] = [];
        _historico[r.nome].push(r);
      });
    });
    Object.keys(_historico).forEach(n => {
      _historico[n].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    });
  }).catch(()=>{});
}

function buildHistTooltip(nome){
  const hist = _historico[nome];
  if(!hist||!hist.length) return '';
  const last5 = hist.slice(0,5);
  const ovCount = last5.filter(h=>(h.perf??0)<0).length;
  const alertBadge = ovCount>=3?`<span class="tcard-hist-badge alert">⚠ OV ${ovCount}/${last5.length}x</span>`:'';
  const rows = last5.map(h=>{
    const perf=h.perf??null;
    const cls=perf!=null?(perf>=0?'pos':'neg'):'';
    const [,m,d]=(h.date||'--').split('-');
    return `<div class="tcard-hist-row">
      <span class="tcard-hist-date">${d||'?'}/${m||'?'}</span>
      <span class="tcard-hist-perf ${cls}">${perf!=null?(perf>=0?'+':'')+perf.toFixed(1)+'%':'—'}</span>
      ${perf!=null&&perf<0?'<span style="font-size:10px;color:var(--red)">OV</span>':'<span style="font-size:10px;color:var(--felt-bright)">✓</span>'}
    </div>`;
  }).join('');
  return `<div class="tcard-hist-tooltip">
    <div class="tcard-hist-title">Últimas ${last5.length} rodadas ${alertBadge}</div>${rows}
  </div>`;
}

/* ══ 1. Resumo de passagem de turno ══ */
function generateShiftSummary(){
  if(!RAW_ROWS.length){ showToast('Nenhum dado no turno.', true); return; }

  const n       = nowInSP();
  const dateStr = `${String(n.day).padStart(2,'0')}/${String(n.month).padStart(2,'0')}/${n.year}`;
  const timeStr = `${String(n.hour).padStart(2,'0')}:${String(n.minute).padStart(2,'0')}`;
  const op      = OPERATOR_NAME || 'Operador';

  const closed   = RESULTS.filter(r => r.premiacao != null);
  const total    = RAW_ROWS.length;
  const nfCount  = RAW_ROWS.filter(r => getId(r._key).toUpperCase() === 'NF').length;
  const ovTotal  = closed.reduce((s,r) => s + ((r.premiacao||0) - (r.garantido||0)), 0);
  const premTotal= closed.reduce((s,r) => s + (r.premiacao||0), 0);

  // Maior overlay e maior excedente
  const withOv  = closed.filter(r => r.premiacao < r.garantido).sort((a,b) => (a.premiacao-a.garantido)-(b.premiacao-b.garantido));
  const withExc = closed.filter(r => r.premiacao > r.garantido).sort((a,b) => (b.premiacao-b.garantido)-(a.premiacao-a.garantido));
  const piorOv  = withOv[0];
  const melhorE = withExc[0];

  const lines = [
    `🎯 *Relatório de Turno — ${dateStr}*`,
    `⏰ Gerado às ${timeStr} por ${op}`,
    ``,
    `📊 *Resumo*`,
    `• Torneios: ${total} total | ${closed.length} fechados | ${nfCount} NF`,
    `• Premiação total: R$ ${fmtBRL(premTotal,2)}`,
    `• Overlay acumulado: ${ovTotal < 0 ? '-' : '+'}R$ ${fmtBRL(Math.abs(ovTotal),2)}`,
    ``,
  ];

  if(piorOv){
    const ov = piorOv.premiacao - piorOv.garantido;
    lines.push(`🔴 *Maior overlay:* ${piorOv.nome} (${piorOv.hora}) — R$ ${fmtBRL(Math.abs(ov),2)}`);
  }
  if(melhorE){
    const exc = melhorE.premiacao - melhorE.garantido;
    lines.push(`🟢 *Maior excedente:* ${melhorE.nome} (${melhorE.hora}) — +R$ ${fmtBRL(exc,2)}`);
  }
  if(closed.length < total){
    const abertos = RAW_ROWS.filter(r => r.premiacao == null && getId(r._key).toUpperCase() !== 'NF');
    if(abertos.length){
      lines.push(``);
      lines.push(`⏳ *Pendentes (${abertos.length}):*`);
      abertos.slice(0,5).forEach(r => lines.push(`• ${r.nome} (${r.hora})`));
      if(abertos.length > 5) lines.push(`• ...e mais ${abertos.length-5}`);
    }
  }
  lines.push(``);
  lines.push(`✅ Turno encerrado.`);

  const txt = lines.join(String.fromCharCode(10));
  // Abrir drawer de relatório e preencher
  const ta = document.getElementById('shiftReportText');
  if(ta){
    ta.value = txt;
    openDrawer('shiftReportDrawerOverlay');
  }
  // Copiar para clipboard
  navigator.clipboard.writeText(txt).then(()=>{
    showToast('✓ Resumo de turno copiado para a área de transferência!');
    logActivity('Resumo de turno gerado e copiado');
  }).catch(()=> showToast('✓ Resumo gerado no drawer de relatório'));
}

/* ══ 8. Comparativo dia vs média histórica ══ */
function updateVsMedia(){
  const el = document.getElementById('statVsMedia');
  if(!el) return;
  if(!Object.keys(_historico).length){ el.textContent=''; return; }

  // Calcular overlay médio por dia dos últimos 30 dias
  const hoje = nowInSP();
  const hojeStr = `${hoje.year}-${String(hoje.month).padStart(2,'0')}-${String(hoje.day).padStart(2,'0')}`;
  let totalOvHist = 0, diasHist = 0;

  fbDb.ref('historico').orderByKey().limitToLast(30).once('value').then(snap=>{
    const data = snap.val()||{};
    Object.entries(data).forEach(([dayKey, torneios])=>{
      if(!torneios||typeof torneios!=='object') return;
      if(dayKey === `d_${hojeStr.replace(/-/g,'_')}`) return; // pular hoje
      let ovDia = 0;
      Object.values(torneios).forEach(t=>{ if(t&&t.perf!=null) ovDia += (t.overlay||0)-(t.garantido||0); });
      if(ovDia !== 0){ totalOvHist += ovDia; diasHist++; }
    });
    if(!diasHist){ el.textContent=''; return; }
    const mediaOv = totalOvHist / diasHist;
    const hojeOv = RESULTS.reduce((s,r)=>s+((r.premiacao||0)-(r.garantido||0)),0);
    const diff = hojeOv - mediaOv;
    const sign = diff >= 0 ? '+' : '';
    el.textContent = `vs média: ${sign}R$ ${fmtBRL(Math.abs(diff),0)}`;
    el.style.color = diff >= 0 ? 'var(--felt-bright)' : 'var(--red)';
  }).catch(()=>{});
}

/* ── Log de atividade ── */
const _activityLog=[];

function logActivity(text){
  const n=nowInSP();
  const time=`${String(n.hour).padStart(2,'0')}:${String(n.minute).padStart(2,'0')}`;
  _activityLog.unshift({time,text});
  if(_activityLog.length>50) _activityLog.pop();
  const badge=document.querySelector('#activityBtn .activity-badge');
  if(badge) badge.textContent=_activityLog.length;
  const log=document.getElementById('activityLog');
  if(log?.classList.contains('open')) renderActivityItems();
}

function renderActivityItems(){
  const el=document.querySelector('#activityLog .activity-items');
  if(!el) return;
  el.innerHTML=_activityLog.map(e=>`<div class="activity-item"><span class="activity-time">${e.time}</span><span class="activity-text">${e.text}</span></div>`).join('')||'<div style="color:var(--ink-soft);font-size:11px;padding:4px 0">Nenhuma atividade ainda.</div>';
}

function toggleActivityLog(){
  const log=document.getElementById('activityLog');
  const btn=document.getElementById('activityBtn');
  if(!log) return;
  const open=log.classList.toggle('open');
  if(btn) btn.style.display=open?'none':'flex';
  if(open) renderActivityItems();
}

function cardTimeFlag(t){
  const cat = classify(t);
  const needsFix = mustFix(t, cat);
  const fixed = isFixed(t._key);
  return (fixed || !needsFix) ? null : timeStatus(t.hora, cat);
}

/* monta a mensagem do badge de tempo mostrando o PRAZO-LIMITE real (horaEvento - antecedência) em vez de só
   "Xmin de antecedência" — assim fica claro o horário exato em que precisava/precisa estar fixado, não só a regra.
   ex: torneio às 01:00, Side (60min antecedência) -> prazo é 00:00. Atrasado -> "Devia ter sido fixado às 00:00".
   Em breve -> "Fixar até 00:00 (faltam 25min)" */
function timeFlagMessage(hhmm, cat, flag){
  const evMin = opMinutes(timeToMinutes(hhmm)); // mesmo relógio operacional do timeStatus — madrugada = fim do dia
  const lead = LEAD_MIN[cat] ?? 30;
  const deadline = evMin - lead;
  const deadlineLabel = minutesToHHMM(((deadline % 1440) + 1440) % 1440);
  if (flag === 'late'){
    const nowMin = opNowMinutes();
    const lateBy = nowMin - deadline; // minutos desde o prazo
    const lateLabel = lateBy > 0 && lateBy <= 720 ? ` (${lateBy}min atrás)` : ''; // esconde o contador além de 12h (provável virada de dia, não atraso real do dia)
    return `⏰ Devia ter sido fixado até ${deadlineLabel}${lateLabel}`;
  }
  if (flag === 'soon'){
    const nowMin = opNowMinutes();
    const remaining = deadline - nowMin;
    const remainingLabel = remaining >= 0 && remaining <= 720 ? ` (faltam ${remaining}min)` : '';
    return `⏳ Fixar até ${deadlineLabel}${remainingLabel}`;
  }
  return '';
}

/* monta a lista de horários reais de início dos torneios cadastrados (sem duplicar), ordenada — é nela que
   as setas ‹ › do filtro de busca se apoiam, assim elas sempre param exatamente num horário que tem
   torneio de verdade, mesmo com horários quebrados como 07:45, 11:15, 14:30 etc., em vez de saltar de
   30 em 30min "no vácuo" */
function buildCheckpoints(){
  const set = new Set();
  RAW_ROWS.forEach(r => {
    const evMin = timeToMinutes(r.hora);
    if (evMin === null) return;
    set.add(((evMin % 1440)+1440)%1440);
  });
  return Array.from(set).sort((a,b)=>a-b);
}

/* a partir de um horário base, acha o próximo (ou anterior) checkpoint real da lista — com wrap em 24h */
function nextCheckpoint(baseMin, direction){
  const checkpoints = buildCheckpoints();
  if (checkpoints.length === 0){
    // sem torneios carregados ainda: cai de volta pro salto fixo de 30min
    return ((baseMin + direction*30) % 1440 + 1440) % 1440;
  }
  if (direction > 0){
    const next = checkpoints.find(c => c > baseMin);
    return next !== undefined ? next : checkpoints[0]; // wrap pro primeiro checkpoint do dia seguinte
  } else {
    const prevList = checkpoints.filter(c => c < baseMin);
    return prevList.length ? prevList[prevList.length-1] : checkpoints[checkpoints.length-1];
  }
}

/* WEEKDAYS_PT/EN vêm de gu-parser.js (parser compartilhado, carregado antes deste arquivo) */

/* soma n dias a uma data ISO (AAAA-MM-DD). Meio-dia UTC evita borda de fuso. */
function addDaysISO(iso, n){
  const [y,m,d] = iso.split('-').map(Number);
  const ref = new Date(Date.UTC(y, m-1, d, 12, 0, 0));
  ref.setUTCDate(ref.getUTCDate() + n);
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth()+1).padStart(2,'0')}-${String(ref.getUTCDate()).padStart(2,'0')}`;
}
/* nome do dia da semana (pt) de uma data ISO — base do parsing da Global por data (não por relógio) */
function weekdayPtFromISO(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return WEEKDAYS_PT[new Date(Date.UTC(y, m-1, d, 12, 0, 0)).getUTCDay()];
}

/* =========================================================================
   FILE PARSING
========================================================================= */
const fileInput = document.getElementById('fileInput');

/* ── Global MTT: chave do turno (reseta à meia-noite de Brasília, hora 00:00) ── */
const GLOBAL_UPLOADED_KEY = 'suprema_global_uploaded_v1';

function globalTurnKey(){
  // Turno começa às 06:10 e vai até 05:30 do dia seguinte.
  // Para fins de "uma vez por turno", usamos a data SP do momento.
  return `global_${todayPathSP()}`;
}

function markGlobalUploaded(){
  try { localStorage.setItem(GLOBAL_UPLOADED_KEY, globalTurnKey()); } catch(e){}
}

function wasGlobalUploadedToday(){
  try { return localStorage.getItem(GLOBAL_UPLOADED_KEY) === globalTurnKey(); } catch(e){ return false; }
}

function setGlobalBtnUploaded(){
  const label = document.getElementById('uploadGlobalBtnLabel');
  const btnEl = document.getElementById('uploadGlobalBtn');
  if(!label || !btnEl) return;
  label.textContent = '✓ Carregada';
  btnEl.style.background = 'var(--felt)';
  btnEl.style.color = '#fff';
  btnEl.title = 'Global já carregada neste turno. Clique para recarregar se necessário.';
}

function resetGlobalBtnStyle(){
  const label = document.getElementById('uploadGlobalBtnLabel');
  const btnEl = document.getElementById('uploadGlobalBtn');
  if(!label || !btnEl) return;
  label.textContent = 'Carregar Global MTT';
  btnEl.style.background = '';
  btnEl.style.color = '';
  btnEl.title = '';
}

/* ── Botão "Global MTT" — carrega a Global e alimenta o painel direto ── */
document.getElementById('uploadGlobalBtn').addEventListener('click', () => {
  document.getElementById('fileInputGlobal').click();
});

document.getElementById('fileInputGlobal').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const label  = document.getElementById('uploadGlobalBtnLabel');
  const btnEl  = document.getElementById('uploadGlobalBtn');
  label.textContent = 'Lendo...';
  btnEl.disabled = true;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await ensureXLSX();               // SheetJS sob demanda
    const arrayBuffer = await file.arrayBuffer();
    const matrix = readSheetMatrix(arrayBuffer, 'MTTS BRAZIL');
    if (!matrix) throw new Error('Aba "MTTS BRAZIL" não encontrada.');
    // ── QUAL DIA DA GRADE ESTA GLOBAL DEVE ALIMENTAR? ─────────────────────
    // Regra à prova de loop: o dia é decidido pela DATA que o painel mostra
    // (LAST_KNOWN_DATE), NÃO pelo relógio. Se o cronograma atual está 100% fixado,
    // a Global SEMPRE avança para o próximo dia — assim "preenchi tudo e subi a
    // Global" nunca repete o mesmo dia (era o bug: todayWeekdayName devolvia o mesmo
    // dia da semana até as 05:30). Se ainda há card aberto, recarrega o MESMO dia.
    const gradeFlipped = todayPathSP() > LAST_KNOWN_DATE; // 05:30 passou e o dia civil já virou
    const relevantNow  = RAW_ROWS.filter(r => mustFix(r, classify(r)));
    const dayComplete  = relevantNow.length > 0 && relevantNow.every(r => isFixed(r._key));
    let baseDate;
    if (gradeFlipped)     baseDate = todayPathSP();                 // grade virou por relógio → dia novo
    else if (dayComplete) baseDate = addDaysISO(LAST_KNOWN_DATE, 1);// terminou o dia → PRÓXIMO dia
    else                  baseDate = LAST_KNOWN_DATE;              // em andamento → recarrega o mesmo
    const weekdayPt = weekdayPtFromISO(baseDate);
    const section   = extractGlobalDaySection(matrix, weekdayPt, 1);
    if (!section || (!section.main.length && !section.side.length && !section.sat.length)){
      showToast(`Nenhum torneio para "${weekdayPt}" nessa planilha.`, true);
      label.textContent = 'Carregar Global MTT'; btnEl.disabled = false;
      e.target.value = ''; return;
    }
    // planilha válida: compartilha o arquivo com a equipe (painel/globalMtt)
    publishSharedGlobal(arrayBuffer, file.name);
    // próximo dia da grade: a madrugada de HOJE (00:00–02:00) vive na seção de amanhã da Global —
    // esses eventos entram no quadro atual pra serem fixados com antecedência (late register)
    const nextSection = extractGlobalDaySection(matrix, weekdayPtFromISO(addDaysISO(baseDate, 1)), 1);
    const rows = globalSectionToRows(section, nextSection);
    if (!rows.length){
      showToast('Nenhum torneio extraído da Global.', true);
      label.textContent = 'Carregar Global MTT'; btnEl.disabled = false;
      e.target.value = ''; return;
    }
    // ── TROCAR O NÓ DO DIA CONFORME O CASO ────────────────────────────────
    // Em todos os casos que trocam de dia, a virada acontece ANTES da ingestão: a
    // Global nova nasce no nó do dia novo e os dados do dia antigo ficam intactos no
    // nó deles — cronogramas nunca se misturam.
    if (gradeFlipped){
      // grade virou (05:30+) e ainda pode haver card aberto do cronograma atual — confirmar
      const pendentes = relevantNow.filter(r => !isFixed(r._key)).length;
      if (pendentes > 0){
        const ok = window.confirm(
          `O dia mudou e a Global deve ser atualizada, mas ainda existem ${pendentes} card(s) EM ABERTO do cronograma atual.\n\n` +
          `Deseja realmente trocar?\n\n` +
          `• OK — o painel vira para o novo dia agora. Tudo que já foi preenchido fica salvo no dia dele.\n` +
          `• Cancelar — continue preenchendo os cards e suba a Global depois que fechar o último.`
        );
        if (!ok){
          label.textContent = 'Carregar Global MTT'; btnEl.disabled = false;
          e.target.value = ''; return;
        }
      }
      ROLLOVER_HELD_TOAST = false;
      LAST_KNOWN_DATE = baseDate;
      resetDay(baseDate); // salva snapshot do dia antigo, limpa o quadro e aponta o Firebase pro dia novo
    } else if (dayComplete && baseDate !== LAST_KNOWN_DATE){
      // cronograma atual 100% fixado e ainda no mesmo dia civil (madrugada ou não): avançamos
      // pro próximo dia da grade AGORA. O nó antigo ganha o marcador rolledTo pra aba do parceiro
      // seguir junto sem recarregar a página.
      ROLLOVER_HELD_TOAST = false;
      LAST_KNOWN_DATE = baseDate;
      if (fbReady && fbDb){ try{ fbDb.ref(`${FB_BASE_PATH}/rolledTo`).set(baseDate); }catch(err2){} }
      resetDay(baseDate);
    }
    finishUpload(rows, `Global MTT — ${weekdayPt} (${file.name})`);
    document.getElementById('globalUpdatePrompt')?.remove(); // prompt de "atualize a Global" cumprido
    markGlobalUploaded();
    setGlobalBtnUploaded();
    showToast(`✓ Global carregada — ${rows.length} torneios de ${weekdayPt}`);
    // Salvar snapshot inicial no Firebase logo após carregar
    setTimeout(() => saveSnapshotToFirebase('global_upload'), 2000);
  } catch (err) {
    console.error('Erro ao ler Global:', err);
    showToast('Erro ao ler a planilha Global: ' + err.message, true);
    label.textContent = 'Carregar Global MTT';
  } finally {
    btnEl.disabled = false;
    e.target.value = '';
  }
});

// Restaurar visual do botão se já foi carregada neste turno
if(wasGlobalUploadedToday()) setGlobalBtnUploaded();

/* Converte a section {main, side, sat} da Global para o formato de row do painel.
   IMPORTANTE (não misturar cronogramas): na Global, a madrugada de HOJE (00:00–05:30) vive no
   TOPO da seção de AMANHÃ — as linhas de madrugada da seção de hoje são do cronograma de ontem.
   Por isso: da seção de hoje entram só os horários 05:31+, e a madrugada até 02:00 vem da seção
   de amanhã (nextSection), marcada com proxCronograma pra ganhar badge no card. Assim os eventos
   com late register já aparecem pra fixar enquanto o cronograma atual termina. */
function globalSectionToRows(section, nextSection){
  const rows = [];
  const toRow = (it, tipo, proxCronograma) => ({
    nome:      it.nome,
    hora:      it.hora,
    garantido: it.garantido ?? null,
    buyin:     it.buyin    ?? null,
    late:      it.late     || null,
    premiacao: null,
    tipo:      tipo,
    explicitNF: false,
    proxCronograma: !!proxCronograma,
  });
  const PROX_CUTOFF = 2*60; // 02:00 — regra do Brian: só eventos com início até 02:00 entram pra fixar
  const isProxMadrugada = it => { const m = timeToMinutes(it.hora); return m !== null && m <= PROX_CUTOFF; };
  // seção de hoje COMPLETA, incluindo a madrugada do topo (00:00–05:30) — a agenda do dia
  // começa às 00:00, na ordem em que a operação trabalha
  section.main.forEach(it => rows.push(toRow(it, 'Main Event')));
  section.side.forEach(it => rows.push(toRow(it, 'Side Event')));
  section.sat.forEach(it  => rows.push(toRow(it, 'SAT')));
  // seção de amanhã: madrugada de hoje com início até 02:00 — entram SÓ pra fixação antecipada
  // (late register), com badge; premiação/field desses eventos ficam pro quadro do próximo dia.
  // Side events seguem a regra de sempre (só se fixa garantido >= 3000) — os pequenos nem entram,
  // já que esses cards não servem pra mais nada além de fixar
  if (nextSection){
    nextSection.main.filter(isProxMadrugada).forEach(it => rows.push(toRow(it, 'Main Event', true)));
    nextSection.side.filter(it => isProxMadrugada(it) && (it.garantido ?? 0) >= 3000)
      .forEach(it => rows.push(toRow(it, 'Side Event', true)));
    nextSection.sat.filter(isProxMadrugada).forEach(it  => rows.push(toRow(it, 'SAT', true)));
  }
  // ordena: dia de hoje em ordem civil (00:00 → 23:59, madrugada no topo), e os cards do
  // PRÓX. CRONOGRAMA sempre por último (são a madrugada do dia seguinte, vêm depois das 23h)
  rows.sort((a, b) => {
    const ma = (timeToMinutes(a.hora) ?? 9999) + (a.proxCronograma ? 1440 : 0);
    const mb = (timeToMinutes(b.hora) ?? 9999) + (b.proxCronograma ? 1440 : 0);
    return ma - mb;
  });
  return rows;
}

document.getElementById('summaryBtn').addEventListener('click', () => {
  if (!RAW_ROWS.length){
    showToast('Carregue a planilha do dia primeiro.', true);
    return;
  }
  const text = buildDaySummaryText();
  copyToClipboard(text, null, 'Resumo do dia copiado — pronto para colar no grupo.');
});

let PENDING_UPLOAD = null;
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await ensureXLSX();               // SheetJS sob demanda: baixa só na 1ª importação
    const rows = await parseFile(file);
    if (!rows.length) {
      showToast('Não encontramos torneios nesse arquivo.', true);
      showSheetWarnings(LAST_PARSE_WARNINGS);
    } else {
      const orphaned = countOrphanedFixedKeys(rows);
      const totalFixedToday = RAW_ROWS.filter(r => isFixed(r._key) || !!getId(r._key)).length;
      const significant = orphaned >= 3 && totalFixedToday > 0 && (orphaned / totalFixedToday) > 0.25;
      if (significant){
        PENDING_UPLOAD = {rows, filename: file.name};
        document.getElementById('reuploadWarnText').textContent =
          `Essa planilha tem ${rows.length} torneios, mas ${orphaned} torneio${orphaned>1?'s':''} já marcado${orphaned>1?'s':''} hoje não aparece${orphaned>1?'m':''} nela — o vínculo seria perdido.`;
        document.getElementById('reuploadWarnOverlay').classList.add('open');
        fileInput.value = '';
        return;
      }
      finishUpload(rows, file.name);
    }
  } catch (err) {
    console.error(err);
    showToast('Não foi possível ler esse arquivo.', true);
  } finally {
    fileInput.value = '';
  }
});
function finishUpload(rows, filename){
  logActivity(`Planilha <b>${filename||'Global'}</b> carregada — ${rows.length} torneios`, '📋');
  ingest(rows, filename);
  showToast(`"${filename}" carregada — ${rows.length} torneios.`);
  showSheetWarnings(LAST_PARSE_WARNINGS);
}
document.getElementById('reuploadWarnCancel').addEventListener('click', () => {
  document.getElementById('reuploadWarnOverlay').classList.remove('open');
  PENDING_UPLOAD = null;
});
document.getElementById('reuploadWarnConfirm').addEventListener('click', () => {
  document.getElementById('reuploadWarnOverlay').classList.remove('open');
  if (PENDING_UPLOAD) finishUpload(PENDING_UPLOAD.rows, PENDING_UPLOAD.filename);
  PENDING_UPLOAD = null;
});

/* mostra a lista de avisos de validação coletados durante o parse (colunas/células ausentes).
   não bloqueia o uso do painel — é só um aviso pra a pessoa saber que algo pode estar incompleto. */
function showSheetWarnings(warnings){
  const box = document.getElementById('sheetWarnings');
  const list = document.getElementById('sheetWarningsList');
  if (!warnings || !warnings.length){ box.hidden = true; return; }
  list.innerHTML = warnings.map(w => `<li>${w}</li>`).join('');
  box.hidden = false;
}
document.getElementById('sheetWarningsClose').addEventListener('click', () => {
  document.getElementById('sheetWarnings').hidden = true;
});

function parseFile(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = (evt) => {
      try{
        const data = evt.target.result;
        const wb = XLSX.read(data, {type:'binary', cellDates:false, cellStyles:true});
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, {header:1, defval:null, raw:true});
        resolve(rowsFromMatrix(json, sheet));
      }catch(err){ reject(err); }
    };
    reader.readAsBinaryString(file);
  });
}

/* detecta se uma célula está pintada com o azul usado para marcar Side Events a fixar (#C9DAF8, com tolerância pra variações de tema/tint) */
function isBlueFill(sheet, rowIdx0, colIdx0){
  if (!sheet || typeof XLSX === 'undefined') return false;
  const addr = XLSX.utils.encode_cell({r: rowIdx0, c: colIdx0});
  const cell = sheet[addr];
  if (!cell || !cell.s) return false;
  const fillColors = [cell.s.fgColor, cell.s.bgColor].filter(Boolean);
  for (const fg of fillColors){
    if (!fg || !fg.rgb) continue;
    const rgb = String(fg.rgb).toUpperCase().replace(/^FF/, ''); // remove prefixo alpha se houver
    if (rgb.length < 6) continue;
    // aceita o azul exato do Google Sheets (C9DAF8) e variações próximas conhecidas
    const knownBlues = ['C9DAF8', '9FC5E8', 'A4C2F4', 'CFE2F3'];
    if (knownBlues.includes(rgb)) return true;
    // heurística de fallback para tons de azul claro/pastel (cobre variações de tema/tint do Excel):
    // canal azul claramente o mais forte, vermelho e verde altos (tom pastel, não saturado) e luminosidade alta
    const r = parseInt(rgb.slice(0,2),16), g = parseInt(rgb.slice(2,4),16), b = parseInt(rgb.slice(4,6),16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)){
      const isPastelBlue = b > 200 && b > r + 15 && b > g + 5 && r > 150 && g > 180;
      if (isPastelBlue) return true;
    }
  }
  return false;
}

/* expects header row: Torneios, Hora, Late Register, Garantido, Buy-in, Premiação, Overlay, Ações, PERF %, Nome Usuário, Hora(check), Status, Tipo */
// preenchido a cada parse com avisos de colunas essenciais ausentes — o handler de upload lê isso
// depois de processar, pra avisar o usuário especificamente o que faltou (em vez de um erro genérico)

function rowsFromMatrix(matrix, sheet){
  LAST_PARSE_WARNINGS = [];
  if (!matrix.length) return [];
  // find header row (first row containing "Torneios" in any cell)
  let headerIdx = matrix.findIndex(r => r.some(c => String(c||'').trim().toLowerCase().startsWith('torneio')));
  if (headerIdx === -1) headerIdx = 0;
  const header = matrix[headerIdx].map(h => String(h||'').trim().toLowerCase());

  const idx = {
    nome: header.findIndex(h => h.startsWith('torneio')),
    hora: header.findIndex(h => h === 'hora'),
    late: header.findIndex((h,i) => h.includes('late')),
    garantido: header.findIndex(h => h.includes('garantido')),
    buyin: header.findIndex(h => h.includes('buy')),
    premiacao: header.findIndex(h => h.includes('premia')),
    overlay: header.findIndex(h => h.includes('overlay')),
    field: header.findIndex(h => h.trim() === 'field'),
    acoes: header.findIndex(h => h.includes('ações') || h.includes('acoes')),
    perf: header.findIndex(h => h.includes('perf')),
    tipo: header.findIndex(h => h.trim() === 'tipo' || h.includes('tipo de evento')),
  };

  // colunas essenciais pro painel funcionar de verdade — sem elas, o resultado fica incompleto ou vazio.
  // não bloqueia o carregamento (algumas planilhas legítimas podem não ter todas), só avisa especificamente.
  const essentialChecks = [
    [idx.nome === -1, 'Coluna "Torneios" não encontrada — nenhum torneio será carregado.'],
    [idx.hora === -1, 'Coluna "Hora" não encontrada — horários, busca por horário e alertas de atraso não vão funcionar.'],
    [idx.garantido === -1, 'Coluna "Garantido" não encontrada — totais e performance ficarão incompletos.'],
    [idx.tipo === -1, 'Coluna "Tipo" não encontrada — Main/Side/Satélite serão classificados só pelo nome do torneio, podendo errar.'],
  ];
  essentialChecks.forEach(([cond, msg]) => { if (cond) LAST_PARSE_WARNINGS.push(msg); });
  // second "hora" occurrence = check time (after the first match)
  const horaIdxs = header.reduce((acc,h,i)=>{ if(h==='hora') acc.push(i); return acc; },[]);
  const checkIdx = horaIdxs.length > 1 ? horaIdxs[1] : -1;

  const out = [];
  let missingHora = 0, missingGarantido = 0, missingTipo = 0;
  for (let i = headerIdx+1; i < matrix.length; i++){
    const r = matrix[i];
    if (!r || idx.nome === -1) continue;
    const nome = r[idx.nome];
    if (!nome || String(nome).trim() === '') continue;

    const premiacaoRaw = idx.premiacao > -1 ? r[idx.premiacao] : null;
    const isExplicitNF = typeof premiacaoRaw === 'string' && premiacaoRaw.trim().toUpperCase() === 'NF';
    const premNum = isExplicitNF ? null : (idx.premiacao > -1 ? toNumber(premiacaoRaw) : null);
    const tipoVal = idx.tipo > -1 ? (r[idx.tipo] ? String(r[idx.tipo]).trim() : null) : null;
    const blue = isBlueFill(sheet, i, idx.nome);
    const horaVal = idx.hora > -1 ? excelTimeToString(r[idx.hora]) : null;
    const garantidoVal = idx.garantido > -1 ? toNumber(r[idx.garantido]) : null;

    // pula linhas-divisor de seção dentro da própria planilha do dia (ex: "SATÉLITES 5%") — têm nome
    // preenchido mas nenhum dado real de torneio (sem hora, garantido OU tipo); um torneio de verdade
    // sempre tem pelo menos um desses três preenchidos
    if (!horaVal && garantidoVal === null && !tipoVal) continue;

    if (idx.hora > -1 && !horaVal) missingHora++;
    if (idx.garantido > -1 && garantidoVal === null) missingGarantido++;
    if (idx.tipo > -1 && !tipoVal) missingTipo++;

    out.push({
      nome: String(nome).trim(),
      hora: horaVal,
      late: idx.late > -1 ? excelTimeToString(r[idx.late]) : null,
      garantido: garantidoVal,
      buyin: idx.buyin > -1 ? toNumber(r[idx.buyin]) : null,
      premiacao: premNum,
      // premiação que veio da COLUNA da planilha (nunca é escrita no nó premiacao do FB).
      // A reconciliação do listener não pode anulá-la só porque a chave não está no nó —
      // era isso que fazia o total "aparecer e ir baixando até zerar" no F5.
      premFromSheet: premNum != null,
      explicitNF: isExplicitNF,
      overlay: idx.overlay > -1 ? toNumber(r[idx.overlay]) : null,
      field: idx.field > -1 ? toNumber(r[idx.field]) : null,
      acoes: idx.acoes > -1 ? r[idx.acoes] : null,
      perf: idx.perf > -1 ? toNumber(r[idx.perf]) : null,
      check: checkIdx > -1 ? excelTimeToString(r[checkIdx]) : null,
      tipo: tipoVal,
      highlighted: blue,
    });
  }
  // avisos sobre linhas individuais com dado faltando (a coluna existe, mas algumas células estão vazias)
  if (missingHora > 0) LAST_PARSE_WARNINGS.push(`${missingHora} torneio${missingHora>1?'s':''} sem horário preenchido.`);
  if (missingGarantido > 0) LAST_PARSE_WARNINGS.push(`${missingGarantido} torneio${missingGarantido>1?'s':''} sem valor de Garantido.`);
  if (missingTipo > 0) LAST_PARSE_WARNINGS.push(`${missingTipo} torneio${missingTipo>1?'s':''} sem Tipo definido (serão classificados pelo nome).`);
  return out;
}

/* =========================================================================
   AUTH — Cadastro e Login com email @suprema.group
   Firebase path: users/{emailKey}/{ nome, sobrenome, apelido, email, pwHash, createdAt }
   Sessão: localStorage 'suprema_session_v1' — expira em 1 ano.
========================================================================= */
const AUTH_STORE_KEY = 'suprema_session_v1';
const OPERATOR_STORE_KEY = 'suprema_operator_v1';

function getSession(){
  try{
    const s = JSON.parse(localStorage.getItem(AUTH_STORE_KEY) || 'null');
    if(!s || !s.email || !s.expiresAt) return null;
    if(Date.now() > s.expiresAt){ localStorage.removeItem(AUTH_STORE_KEY); return null; }
    return s;
  }catch(e){ return null; }
}
function saveSession(data){
  try{
    localStorage.setItem(AUTH_STORE_KEY, JSON.stringify({
      ...data, expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000
    }));
  }catch(e){}
}
/* delega pro SupremaAuth (já carregado antes deste arquivo): a cópia local
   removia SÓ a sessão e DEIXAVA o 'suprema_trusted_admin' pra trás — então o
   logout de um admin não o deslogava de fato: recognize() seguia devolvendo
   isAdmin:true por "admin confiável neste navegador". Em máquina compartilhada
   da operação, o próximo usuário herdava isso. O clearSession do módulo limpa
   as DUAS chaves. Fallback só pra não quebrar se o módulo faltar. */
function clearSession(){
  try{
    if (window.SupremaAuth && SupremaAuth.clearSession){ SupremaAuth.clearSession(); return; }
  }catch(e){}
  try{ localStorage.removeItem(AUTH_STORE_KEY); }catch(e){}
}

/* PBKDF2-SHA256 (Web Crypto), salt aleatório por usuário — mesma lógica do admin.html.
   Mantém o hash legado (DJB2+salt fixo) apenas para verificar/migrar contas antigas. */
const PBKDF2_ITER = 150000;
function bufToHex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hexToBytes(hex){
  const bytes = new Uint8Array(hex.length / 2);
  for(let i=0;i<bytes.length;i++) bytes[i] = parseInt(hex.substr(i*2,2), 16);
  return bytes;
}
async function hashPassword(pw, saltHex){
  saltHex = saltHex || bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:hexToBytes(saltHex), iterations:PBKDF2_ITER, hash:'SHA-256'}, keyMat, 256);
  return `pbkdf2v2$${PBKDF2_ITER}$${saltHex}$${bufToHex(bits)}`;
}
/* formato antigo: o salt era codificado como texto UTF-8 do próprio hex em vez de decodificado
   pros bytes originais — reduzia a entropia efetiva do salt. Mantido só pra verificar/migrar
   hashes já salvos no Firebase; nenhuma conta nova volta a usar isso. */
async function hashPasswordLegacySalt(pw, saltHex){
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:enc.encode(saltHex), iterations:PBKDF2_ITER, hash:'SHA-256'}, keyMat, 256);
  return `pbkdf2$${PBKDF2_ITER}$${saltHex}$${bufToHex(bits)}`;
}
function legacyHashPassword(pw){
  let h = 5381;
  for(let i=0;i<pw.length;i++){ h = ((h<<5)+h) ^ pw.charCodeAt(i); h |= 0; }
  const salt = 'suprema2024';
  let h2 = h;
  for(let i=0;i<salt.length;i++){ h2 = ((h2<<5)+h2) ^ salt.charCodeAt(i); h2 |= 0; }
  return 'h2_' + Math.abs(h).toString(36) + '_' + Math.abs(h2).toString(36);
}
async function verifyPassword(pw, storedHash, onMigrate){
  if(!storedHash) return true;
  if(storedHash.startsWith('pbkdf2v2$')){
    const [,,saltHex] = storedHash.split('$');
    return (await hashPassword(pw, saltHex)) === storedHash;
  }
  if(storedHash.startsWith('pbkdf2$')){
    const [,,saltHex] = storedHash.split('$');
    const ok = (await hashPasswordLegacySalt(pw, saltHex)) === storedHash;
    if(ok && onMigrate) onMigrate(await hashPassword(pw)); // migra pro salt correto no próximo login
    return ok;
  }
  // conta importada manualmente no Firebase com SHA-256 puro (64 hex, sem prefixo) — sem esse
  // caso o login recusava a senha CERTA pra sempre; migra pro pbkdf2 no primeiro login que passar
  if(/^[0-9a-f]{64}$/i.test(storedHash)){
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    const ok = bufToHex(digest) === storedHash.toLowerCase();
    if(ok && onMigrate) onMigrate(await hashPassword(pw));
    return ok;
  }
  const ok = storedHash === legacyHashPassword(pw);
  if(ok && onMigrate) onMigrate(await hashPassword(pw));
  return ok;
}
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 5*60*1000;
function loginLockRemaining(user){
  if(!user?.loginLockUntil) return 0;
  return Math.max(0, user.loginLockUntil - Date.now());
}
function emailToKey(email){
  return email.toLowerCase().trim().replace(/\./g,'_dot_').replace(/@/g,'_at_');
}

let _session = getSession();
let OPERATOR_NAME = _session ? (_session.apelido || _session.nome || _session.email) : '';

/* ── MODO LEITURA (ver ≠ editar) ──
   O acesso a ESTE painel já passou pelo guard; aqui separamos quem VÊ de quem
   EDITA. canEdit('painel') falso (e não-admin) ⇒ modo leitura: toda escrita é
   bloqueada por roGuard (a defesa real, junto das regras do RTDB) e a UI de
   edição é travada por CSS (html.ro) com um banner. Sessão nova traz o mapa
   `edit`; se a edição for revogada com a pessoa ONLINE, o suprema-auth já a
   ejeta (revalidateAccess vigia access|edit ao vivo). */
let PANEL_RO = false;
try { PANEL_RO = !!_session && !(window.SupremaAuth && SupremaAuth.canEdit && SupremaAuth.canEdit('painel')); }
catch(e){ PANEL_RO = false; }
if (PANEL_RO) document.documentElement.classList.add('ro');
let _roToastAt = 0;
/* chame no TOPO de cada função de escrita disparada pelo usuário: bloqueia e
   avisa (no máx. 1 toast a cada 2,5s). Retorna true quando bloqueou. */
function roGuard(){
  if(!PANEL_RO) return false;
  const now = Date.now();
  if(now - _roToastAt > 2500){
    _roToastAt = now;
    try{ showToast('👁 Modo leitura — a edição está com a operação. Fale com um admin para liberar.', true); }catch(e){}
  }
  return true;
}
function mountReadonlyBanner(){
  if(!PANEL_RO || document.getElementById('roBanner')) return;
  const b = document.createElement('div');
  b.id = 'roBanner'; b.setAttribute('role','status');
  b.innerHTML = '<span class="ro-ico" aria-hidden="true">👁</span>' +
    '<span><b>Modo leitura.</b> Você acompanha o painel ao vivo, mas as edições estão com a operação. ' +
    '<span class="ro-hint">Fale com um admin para liberar a edição.</span></span>';
  (document.body || document.documentElement).prepend(b);
}
if(PANEL_RO){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountReadonlyBanner);
  else mountReadonlyBanner();
}

function promptOperatorNameIfNeeded(){
  if(_session) return;
  // A tela de login do painel não existe mais: sem sessão, o lugar é o hub.
  location.replace('hub.html');
}

/* ── Tab switcher com animação de indicador deslizante ── */
function switchAuthTab(tab){
  document.getElementById('panelLogin').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('panelRecovery').style.display = tab === 'recovery' ? '' : 'none';
  document.getElementById('tabLogin').classList.add('active');
  updateTabIndicator('login');
  ['loginError','recoveryMsg'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.hidden = true;
  });
  if(tab !== 'recovery'){
    const step2 = document.getElementById('recoveryStep2');
    if(step2) step2.style.display = 'none';
    const lbl = document.getElementById('recoveryBtnLabel');
    if(lbl) lbl.textContent = 'Enviar código';
    const inp = document.getElementById('recoveryEmail');
    if(inp) inp.disabled = false;
  }
}
function updateTabIndicator(tab){
  const indicator = document.getElementById('authTabIndicator');
  const btn = document.getElementById('tabLogin');
  if(!indicator || !btn) return;
  indicator.style.width = btn.offsetWidth + 'px';
  indicator.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
}

/* ── Validação de senha ── */
function validatePassword(pw){
  if(pw.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if(!/[a-z]/.test(pw)) return 'A senha precisa ter pelo menos 1 letra minúscula.';
  if(!/[^a-zA-Z0-9]/.test(pw)) return 'A senha precisa ter pelo menos 1 caractere especial (ex: @, #, !, %).';
  return null;
}

function showAuthError(panelId, msg){
  const el = document.getElementById(panelId);
  if(!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.className = 'auth-error';
  // shake curto pra dar feedback físico do erro (re-dispara mesmo se já estava na tela)
  requestAnimationFrame(() => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); });
}

/* mostrar/ocultar senha — regra password-toggle: campo de senha sempre com toggle visível */
function togglePassVisibility(inputId, btn){
  const inp = document.getElementById(inputId);
  if(!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  btn.innerHTML = show
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.5 10.5 0 0 1 12 19c-6.5 0-10-7-10-7a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A9.9 9.9 0 0 1 12 4c6.5 0 10 7 10 7a19.8 19.8 0 0 1-3.22 4.31"/><path d="m2 2 20 20"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  inp.focus();
}

/* aviso de Caps Lock ativo enquanto digita a senha — evita o clássico "senha incorreta" por caixa alta */
function authCapsHint(event, hintId){
  const hint = document.getElementById(hintId || 'loginCapsHint');
  if(!hint || !event.getModifierState) return;
  hint.hidden = !event.getModifierState('CapsLock');
}

/* ── Login ── */
function doLogin(){
  const email = (document.getElementById('loginEmail').value||'').trim().toLowerCase();
  const pw = (document.getElementById('loginPassword').value||'');
  document.getElementById('loginError').hidden = true;

  if(!email || !pw){ showAuthError('loginError','Preencha email e senha.'); return; }
  if(!email.endsWith('@suprema.group')){ showAuthError('loginError','Use seu email @suprema.group.'); return; }
  if(!fbReady){ showAuthError('loginError','Sem conexão com o servidor. Tente em instantes.'); return; }

  const btn = document.getElementById('loginBtn');
  const btnSpan = btn?.querySelector('span');
  if(btn){ btn.disabled = true; if(btnSpan) btnSpan.textContent = 'Entrando...'; }

  const userRef = fbDb.ref(`users/${emailToKey(email)}`);
  userRef.once('value').then(async snap => {
    const reset = () => { if(btn){ btn.disabled = false; if(btnSpan) btnSpan.textContent = 'Entrar'; } };
    if(!snap.exists()){ reset(); showAuthError('loginError','Email não cadastrado. Crie sua conta.'); return; }
    const user = snap.val();

    const remaining = loginLockRemaining(user);
    if(remaining > 0){
      reset();
      showAuthError('loginError', `Muitas tentativas. Tente novamente em ${Math.ceil(remaining/60000)} min.`);
      return;
    }

    const ok = await verifyPassword(pw, user.pwHash, newHash => userRef.update({pwHash:newHash}));
    if(!ok){
      const attempts = (user.loginAttempts||0) + 1;
      const patch = {loginAttempts: attempts};
      if(attempts >= LOGIN_MAX_ATTEMPTS){ patch.loginLockUntil = Date.now()+LOGIN_LOCK_MS; patch.loginAttempts = 0; }
      await userRef.update(patch);
      reset();
      showAuthError('loginError', attempts >= LOGIN_MAX_ATTEMPTS
        ? `Muitas tentativas. Login bloqueado por ${LOGIN_LOCK_MS/60000} min.`
        : 'Senha incorreta.');
      return;
    }
    if(user.loginAttempts || user.loginLockUntil) userRef.update({loginAttempts:0, loginLockUntil:null});

    reset();
    const displayName = user.apelido || user.nome || email;
    finishLogin(email, user, displayName);
  }).catch(() => {
    if(btn){ btn.disabled = false; if(btnSpan) btnSpan.textContent = 'Entrar'; }
    showAuthError('loginError','Falha ao conectar. Tente novamente.');
  });
}

/* ─────────────────────────────────────────────────────────────────
   ADMIN — Emails com acesso à área administrativa.
   Para adicionar um admin: inclua o email na lista abaixo.
   O link "♠ Admin" fica visível para todos, mas o conteúdo
   só carrega para os emails desta lista.
──────────────────────────────────────────────────────────────── */

/* Roteamento hash — #admin ↔ painel */
function routeHash(){
  const isAdm = location.hash === '#admin';
  ['hero','nao-fixados','agenda','resultados','learn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = isAdm ? 'none' : '';
  });
  const adm = document.getElementById('adminPage');
  if(adm){
    if(isAdm){
      adm.style.display = 'block';
      // Verifica se usuário tem permissão
      if(!_session || !isAdmin(_session.email)){
        adm.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:70vh;text-align:center;gap:16px;padding:40px;">
            <div style="font-size:48px;">♠</div>
            <div style="font-size:22px;font-weight:700;color:var(--ink)">Área Restrita</div>
            <div style="font-size:14px;color:var(--ink-soft);max-width:340px;line-height:1.6">Esta área é exclusiva para administradores do Suprema Poker.<br>Faça login com uma conta autorizada.</div>
            <a href="#" onclick="location.hash='';return false;" style="margin-top:8px;padding:10px 24px;border-radius:10px;background:var(--felt);color:#fff;text-decoration:none;font-size:13px;font-weight:700;">← Voltar ao Painel</a>
          </div>`;
        return;
      }
      // Admin autorizado — inicializa
      if(typeof initAdminPage === 'function') initAdminPage();
    } else {
      adm.style.display = 'none';
    }
  }
}
window.addEventListener('hashchange', routeHash);

/* ── Funções que foram removidas com o admin mas ainda são referenciadas ── */

// isAdmin — verifica se email é administrador
const ADMIN_EMAILS = [
  'brian@suprema.group',
  'admin@suprema.group',
  'brian.rodrigues@suprema.group',
];
function isAdmin(email){ return ADMIN_EMAILS.includes((email||'').toLowerCase()); }

// revealAdminNav — link para admin.html no nav (admin está em página separada)
function revealAdminNav(){
  const link = document.getElementById('adminNavLink');
  if(link) link.style.display = '';
}

// initAdminPage — admin está em admin.html, não mais embutido
function initAdminPage(){ /* admin movido para admin.html */ }

// loadMesasCashFromB64 — carrega planilha de mesas cash a partir de base64 (vinda do Firebase)
function loadMesasCashFromB64(b64, filename, uploadedAt, fromRemote, uploadedBy){
  if(!b64) return;
  if(CASH_TABLE_LAST_LOADED_AT && CASH_TABLE_LAST_LOADED_AT === uploadedAt) return; // já carregada
  CASH_TABLE_LAST_LOADED_AT = uploadedAt;
  // SheetJS sob demanda: esta carga vem de um listener do Firebase (não de um
  // gesto do usuário), então garantimos o XLSX aqui dentro antes de ler.
  ensureXLSX().then(() => {
    const arrayBuffer = base64ToArrayBuffer(b64);
    const wb = XLSX.read(arrayBuffer, {type:'array', cellDates:false});
    CASH_TABLE_WORKBOOK = wb;
    CASH_TABLE_MATRIX_CACHE = {};
    const when = uploadedAt ? new Date(uploadedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
    // atualiza o rótulo de forma persistente — antes só um toast passageiro avisava, e ao reabrir
    // a gaveta depois o rótulo continuava mostrando "Carregar planilha..." como se nada tivesse vindo
    const label = document.getElementById('cashTablesFileLabel');
    const labelBox = document.getElementById('cashTablesUploadLabel');
    if(label && labelBox){
      label.textContent = fromRemote
        ? `${filename || 'Mesas Cash'}${uploadedBy ? ' — compartilhada por ' + uploadedBy : ''}${when ? ' às ' + when : ''}`
        : filename || label.textContent;
      labelBox.classList.add('is-loaded');
    }
    if(fromRemote){
      showToast(`Mesas cash recebidas${when ? ' ('+when+')' : ''}${uploadedBy ? ' — enviada por ' + uploadedBy : ' — planilha compartilhada pelo parceiro'}`);
    }
    populateCashServerSelect();
    if(CASH_TABLE_WORKBOOK) runCashTableSearch(); // se já tinha modalidade/blind preenchidos, busca na hora com a planilha recém-chegada
  }).catch(e => {
    CASH_TABLE_LAST_LOADED_AT = null;   // deixa tentar de novo quando o XLSX chegar
    console.error('Erro ao carregar mesas cash do Firebase:', e);
  });
}

/* ── Listener de notificações do usuário logado (erros, avisos, mensagens do admin) ── */
function initUserNotifListener(){
  if(!fbReady || !_session) return;
  const emailKey = _session.email.toLowerCase().replace(/\./g,'_dot_').replace(/@/g,'_at_');
  fbDb.ref(`userNotifs/${emailKey}`).on('value', snap => {
    const notifs = snap.val();
    if(!notifs) return;
    // Verificar se há notificações não justificadas que bloqueiam o operador
    const pending = Object.entries(notifs).filter(([id,n]) => n && !n.justified && !n.resolved && n.blocked);
    if(pending.length > 0){
      // Bloquear o painel — mostrar modal de justificativa
      showJustifModal(pending, emailKey);
      return;
    }
    // Notificações normais (sem bloqueio)
    Object.entries(notifs).forEach(([id, n]) => {
      if(!n || n.seen || n.justified || n.resolved) return;
      fbDb.ref(`userNotifs/${emailKey}/${id}/seen`).set(true).catch(()=>{});
      showToast(n.msg || '⚠ Nova notificação do admin: ' + (n.typeLabel||'Verifique o painel admin.'), true);
    });
  });
}

function showJustifModal(pending, emailKey){
  const existing = document.getElementById('justifBlockModal');
  if(existing) existing.remove();

  const notif   = pending[0][1];
  const notifId = pending[0][0];
  const extra   = pending.length - 1;

  // Formatar data
  const dateLabel = notif.date ? notif.date.split('-').reverse().join('/') : '';
  const sentTime  = notif.sentAt ? new Date(notif.sentAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';

  const modal = document.createElement('div');
  modal.id = 'justifBlockModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

  // CSS injetado — usa os tokens reais do app (--card, --ink, --felt, --radius-*,
  // --shadow-*) em vez de cores hardcoded, então acompanha automaticamente o tema
  // claro/escuro do painel. Visual calmo e direto, sem stripe animada nem glow vermelho.
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #justifBlockModal{
      background: rgba(20,22,20,.32);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
      animation: jm-fade .25s var(--ease);
    }
    @keyframes jm-fade{ from{opacity:0} to{opacity:1} }
    @keyframes jm-up{ from{opacity:0;transform:translateY(22px) scale(.96)} to{opacity:1;transform:none} }
    .jm-box{
      background: var(--card);
      border: 1px solid var(--hairline);
      border-radius: var(--radius-lg);
      max-width: 460px; width: 100%;
      box-shadow: var(--shadow-lg);
      animation: jm-up .42s var(--ease-expo);
      overflow: hidden;
      font-family: var(--text);
    }
    @media (prefers-reduced-motion: reduce){
      .jm-box{ animation-duration:.001ms; filter:none; }
    }
    .jm-body{ padding: 30px 30px 26px; }
    .jm-seal{
      width: 44px; height: 44px; border-radius: 12px;
      background: var(--warn-bg);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 18px;
    }
    .jm-seal svg{ width: 22px; height: 22px; color: var(--warn-text); }
    .jm-title{ font-family:var(--display); font-size: 19px; font-weight: 700; color: var(--ink); letter-spacing: -.02em; margin-bottom: 5px; }
    .jm-sub{ font-size: 13px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 22px; }
    .jm-card{
      background: var(--card-elevated);
      border: 1px solid var(--hairline);
      border-radius: var(--radius-md); padding: 16px 18px; margin-bottom: 18px;
    }
    .jm-card-type{
      display: inline-flex; align-items: center;
      font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      color: var(--warn-text); background: var(--warn-bg);
      border-radius: 99px; padding: 3px 10px; margin-bottom: 10px;
    }
    .jm-card-torneio{ font-size: 15px; font-weight: 600; color: var(--ink); margin-bottom: 6px; letter-spacing: -.01em; }
    .jm-card-desc{ font-size: 13px; color: var(--ink-soft); line-height: 1.55; }
    .jm-card-meta{
      display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px;
      border-top: 1px solid var(--hairline);
    }
    .jm-card-meta span{ font-size: 11px; color: var(--ink-soft); }
    .jm-card-meta b{ color: var(--ink); font-weight: 600; }
    .jm-label{
      font-size: 11px; font-weight: 600; color: var(--ink-soft);
      margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;
    }
    .jm-char-count{ font-size: 11px; color: var(--ink-soft); font-weight: 500; }
    .jm-char-count.ok{ color: var(--felt-bright); }
    .jm-textarea{
      width: 100%; padding: 12px 14px;
      background: var(--card-elevated); border: 1px solid var(--hairline-strong);
      border-radius: var(--radius-sm); font-size: 13.5px; color: var(--ink);
      resize: none; line-height: 1.55; font-family: var(--text);
      transition: border-color .2s, box-shadow .2s; outline: none;
    }
    .jm-textarea:focus{ border-color: var(--felt-bright); box-shadow: 0 0 0 3px var(--felt-soft); }
    .jm-textarea::placeholder{ color: var(--ink-soft); opacity: .7; }
    .jm-err{
      font-size: 12px; color: var(--red);
      background: var(--red-soft); border: 1px solid transparent;
      border-radius: 8px; padding: 9px 12px; margin-top: 8px; display: none;
    }
    .jm-footer{ padding: 0 30px 28px; }
    .jm-btn{
      width: 100%; padding: 13px;
      border-radius: var(--radius-sm); border: none; cursor: pointer;
      background: linear-gradient(135deg, var(--felt) 0%, var(--felt-bright) 100%);
      color: #fff; font-family: var(--text); font-size: 14px; font-weight: 700; letter-spacing: -.005em;
      transition: transform .15s var(--ease), box-shadow .15s var(--ease), opacity .15s;
      box-shadow: 0 4px 16px -6px rgba(24,163,107,.4);
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .jm-btn:hover:not(:disabled){ transform: translateY(-1px); box-shadow: 0 6px 22px -6px rgba(24,163,107,.5); }
    .jm-btn:active:not(:disabled){ transform: translateY(0); }
    .jm-btn:disabled{ opacity: .5; cursor: not-allowed; transform: none; }
    .jm-btn svg{ width:16px; height:16px; flex:none; }
    .jm-extra{
      font-size: 12px; color: var(--ink-soft);
      background: var(--card-elevated); border: 1px solid var(--hairline);
      border-radius: 8px; padding: 8px 12px; margin-bottom: 16px;
      display: flex; align-items: center; gap: 7px;
    }
    .jm-extra svg{ width:14px; height:14px; flex:none; color: var(--ink-soft); }
    @keyframes jm-spin{ to{ transform: rotate(360deg) } }
    .jm-spin{ width:15px;height:15px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:jm-spin .6s linear infinite;flex:none; }
  `;
  document.head.appendChild(styleEl);

  modal.innerHTML = `
    <div class="jm-box">
      <div class="jm-body">
        <div class="jm-seal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="jm-title">Justificativa necessária</div>
        <div class="jm-sub">O admin sinalizou uma pendência no seu acesso. Leia abaixo e explique o que aconteceu para liberar o painel novamente.</div>

        <div class="jm-card">
          <div class="jm-card-type">${escHtml(notif.typeLabel||notif.type||'Erro operacional')}</div>
          <div class="jm-card-torneio">${escHtml(notif.torneio||'Torneio não especificado')}</div>
          ${notif.desc ? `<div class="jm-card-desc">${escHtml(notif.desc)}</div>` : ''}
          <div class="jm-card-meta">
            ${dateLabel ? `<span><b>Data</b> ${dateLabel}</span>` : ''}
            ${sentTime  ? `<span><b>Enviado</b> ${sentTime}</span>` : ''}
            <span><b>Por</b> ${escHtml(notif.sentBy||'Administrador')}</span>
          </div>
        </div>

        ${extra > 0 ? `<div class="jm-extra"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Há mais ${extra} notificação${extra>1?'ões':''} pendente${extra>1?'s':''} após esta.</div>` : ''}

        <div class="jm-label">
          <span>Sua justificativa</span>
          <span class="jm-char-count" id="jCharCount">mínimo 10 caracteres</span>
        </div>
        <textarea class="jm-textarea" id="justifText" rows="4"
          placeholder="Descreva o que ocorreu, a causa e como foi ou será corrigido..."
          oninput="(function(v){const c=document.getElementById('jCharCount');if(c){c.textContent=v.length>=10?v.length+' caracteres':'mínimo 10 caracteres';c.className='jm-char-count'+(v.length>=10?' ok':'');}})(this.value)"></textarea>
        <div class="jm-err" id="justifErr"></div>
      </div>

      <div class="jm-footer">
        <button class="jm-btn" id="justifSubmitBtn" onclick="submitJustif('${emailKey}','${notifId}')">
          <span id="justifBtnLabel">Enviar justificativa</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('justifText')?.focus(), 300);
}

/* (o escHtml completo — que também escapa " e ' — mora nos HELPERS, no topo do
   arquivo. Havia uma segunda declaração aqui que, por hoisting, sobrescrevia a
   primeira no arquivo inteiro e deixava aspas passarem batido em contexto de
   atributo. Removida: use sempre a do topo.) */

async function submitJustif(emailKey, notifId){
  const text = document.getElementById('justifText')?.value?.trim();
  const errEl = document.getElementById('justifErr');
  if(!text || text.length < 10){
    if(errEl){errEl.textContent='Justificativa muito curta. Descreva o ocorrido.';errEl.style.display='block';}
    return;
  }
  if(!fbReady){ if(errEl){errEl.textContent='Sem conexão. Tente novamente.';errEl.style.display='block';} return; }
  const btn = document.getElementById('justifSubmitBtn');
  const lbl = document.getElementById('justifBtnLabel');
  if(btn){ btn.disabled=true; }
  if(lbl){ lbl.innerHTML='<div class="jm-spin"></div> Enviando...'; }
  try {
    await fbDb.ref(`userNotifs/${emailKey}/${notifId}`).update({
      justified:     true,
      justification: text,
      justifiedAt:   Date.now(),
      justifiedBy:   OPERATOR_NAME || _session?.email || '',
    });
    await fbDb.ref(`users/${emailKey}/pendingNotif`).remove();
    document.getElementById('justifBlockModal')?.remove();
    showToast('✓ Justificativa enviada — aguarde a aprovação do admin');
  } catch(e){
    if(errEl){errEl.textContent='Erro ao enviar: '+e.message;errEl.style.display='block';}
    if(btn){btn.disabled=false;}
    if(lbl){lbl.textContent='Enviar justificativa';}
  }
}

function finishLogin(email, user, displayName){
  saveSession({ email, nome:user.nome, sobrenome:user.sobrenome, apelido:user.apelido, displayName });
  _session = getSession();
  OPERATOR_NAME = displayName;
  // traz o ícone escolhido (salvo no perfil no Firebase) pro localStorage, pra seguir o
  // operador em qualquer dispositivo — assim a barra de presença mostra o mesmo avatar.
  if(user.avatar){ try{ localStorage.setItem(UP_AVATAR_KEY, user.avatar); }catch(e){} }
  // conquistas do hub: título equipado (tag) e moldura equipada (frame), pra espelhar na presença
  try{
    if(user.tag != null) localStorage.setItem(UP_TITLE_KEY, user.tag); else localStorage.removeItem(UP_TITLE_KEY);
    if(user.frame != null) localStorage.setItem(UP_TIER_KEY, String(user.frame));
  }catch(e){}
  document.getElementById('opBadge').textContent = displayName;
  document.getElementById('operatorOverlay').classList.remove('open');
  refreshMyPresenceName();
  // sem moldura equipada explícita? usa o tier já calculado pelo hub no leaderboard (a mais alta desbloqueada)
  if(user.frame == null && fbReady){
    fbDb.ref(`hub/leaderboard/${emailToKey(email)}/tier`).once('value').then(s => {
      const t = s.val();
      if(t != null){ try{ localStorage.setItem(UP_TIER_KEY, String(t)); }catch(e){} refreshMyPresenceName(); }
    }).catch(()=>{});
  }
  showWelcomeBack(displayName, user);
  setTimeout(maybeShowNotifBanner, 2000);
  setTimeout(initUserNotifListener, 1000);
  if(isAdmin(email)) revealAdminNav();
}

function showWelcomeBack(displayName, user){
  const overlay = document.getElementById('wbOverlay');
  const card = document.getElementById('wbCard');
  const avatar = document.getElementById('wbAvatar');
  const greetingEl = document.getElementById('wbGreeting');
  const nameEl = document.getElementById('wbName');
  const subEl = document.getElementById('wbSub');
  if(!overlay) return;

  // Saudação por hora
  const h = nowInSP().hour;
  const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';

  // Iniciais para avatar
  const initials = (displayName||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  avatar.textContent = initials;

  greetingEl.textContent = `${greeting} · Suprema Poker`;
  nameEl.textContent = displayName;

  const n = nowInSP();
  const hhmm = String(n.hour).padStart(2,'0') + ':' + String(n.minute).padStart(2,'0');
  subEl.textContent = `${dataPorExtensoSP().split(',')[0]} · ${hhmm}`;

  overlay.style.display = '';
  // anima entrada
  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateX(-50%) translateY(0)';
  });

  // some automaticamente em 4s
  setTimeout(() => {
    card.style.opacity = '0';
    card.style.transform = 'translateX(-50%) translateY(16px)';
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
  }, 4000);
}

/* ── Recuperação de senha ── */
let _recoveryEmail = null;
let _recoveryCodeExpected = null;
let _recoveryCodeExpiry = 0;

function generateRecoveryCode(){ return String(Math.floor(100000 + Math.random() * 900000)); }

async function doRecovery(){
  const emailEl = document.getElementById('recoveryEmail');
  const btn = document.getElementById('recoveryBtn');
  const btnLbl = document.getElementById('recoveryBtnLabel');
  const msgEl = document.getElementById('recoveryMsg');
  msgEl.hidden = true;

  // Passo 2: o código já foi enviado, agora verifica e redefine
  if(_recoveryEmail && _recoveryCodeExpected){
    const code = (document.getElementById('recoveryCode').value||'').trim();
    const newPw = (document.getElementById('recoveryNewPw').value||'');
    if(code !== _recoveryCodeExpected || Date.now() > _recoveryCodeExpiry){
      msgEl.textContent = 'Código inválido ou expirado. Tente novamente.';
      msgEl.hidden = false;
      return;
    }
    const pwErr = validatePassword(newPw);
    if(pwErr){ msgEl.textContent = pwErr; msgEl.hidden = false; return; }
    if(!fbReady){ msgEl.textContent = 'Sem conexão.'; msgEl.hidden = false; return; }
    btn.disabled = true; btnLbl.textContent = 'Salvando...';
    try{
      await fbDb.ref(`users/${emailToKey(_recoveryEmail)}/pwHash`).set(await hashPassword(newPw));
      // limpa o token do Firebase
      await fbDb.ref(`passwordReset/${emailToKey(_recoveryEmail)}`).remove();
      _recoveryEmail = null; _recoveryCodeExpected = null;
      showToast('Senha redefinida! Faça login com a nova senha.');
      switchAuthTab('login');
    }catch(e){
      msgEl.textContent = 'Erro ao salvar. Tente novamente.';
      msgEl.hidden = false;
    }finally{ btn.disabled = false; btnLbl.textContent = 'Redefinir senha'; }
    return;
  }

  // Passo 1: envia o código por Firebase (simula envio — exibe na tela por falta de email backend)
  const email = (emailEl.value||'').trim().toLowerCase();
  if(!email.endsWith('@suprema.group')){ msgEl.textContent = 'Use seu email @suprema.group.'; msgEl.hidden = false; return; }
  if(!fbReady){ msgEl.textContent = 'Sem conexão.'; msgEl.hidden = false; return; }
  btn.disabled = true; btnLbl.textContent = 'Verificando...';
  try{
    const snap = await fbDb.ref(`users/${emailToKey(email)}`).once('value');
    if(!snap.exists()){ msgEl.textContent = 'Email não cadastrado.'; msgEl.hidden = false; btn.disabled = false; btnLbl.textContent = 'Enviar código'; return; }
    const code = generateRecoveryCode();
    const expiry = Date.now() + 15 * 60 * 1000; // 15 min
    // Salva o código no Firebase — um admin pode consultar firebase console para ver o código
    // Em produção com EmailJS, aqui enviaria o email. Por ora o código aparece no console Firebase.
    await fbDb.ref(`passwordReset/${emailToKey(email)}`).set({ code, expiry, email, requestedAt: firebase.database.ServerValue.TIMESTAMP });
    _recoveryEmail = email;
    _recoveryCodeExpected = code;
    _recoveryCodeExpiry = expiry;
    // Mostra passo 2
    emailEl.disabled = true;
    document.getElementById('recoveryStep2').style.display = '';
    btnLbl.textContent = 'Redefinir senha';
    msgEl.className = 'auth-success';
    msgEl.textContent = `Código gerado: ${code} (válido por 15min). Em produção será enviado ao email.`;
    msgEl.hidden = false;
    setTimeout(() => { msgEl.hidden = true; }, 8000);
  }catch(e){
    msgEl.textContent = 'Erro. Tente novamente.';
    msgEl.hidden = false;
  }finally{ btn.disabled = false; }
}

/* ── Cadastro: removido do painel — criar conta acontece no hub (hub.html) ── */

/* ── Tela de sucesso pós-cadastro ── */
function showWelcomeSuccess(displayName, email){
  const ws = document.getElementById('welcomeSuccess');
  if(!ws) return;
  document.getElementById('wsName').textContent = displayName;
  document.getElementById('wsEmail').textContent = email;
  const n = nowInSP();
  const h = String(n.hour).padStart(2,'0') + ':' + String(n.minute).padStart(2,'0');
  document.getElementById('wsTurno').textContent = dataPorExtensoSP().split(',')[0] + ' · ' + h;
  ws.style.display = 'flex';
  launchConfetti();
}
function closeWelcomeSuccess(){
  document.getElementById('operatorOverlay').classList.remove('open');
  document.getElementById('welcomeSuccess').style.display = 'none';
  showToast(`Bem-vindo ao painel, ${OPERATOR_NAME}! 🎉`);
}

/* ── Confetti ── */
function launchConfetti(){
  const container = document.getElementById('wsConfetti');
  if(!container) return;
  container.innerHTML = '';
  const colors = ['#22d47e','#0c5c3f','#c9a84c','#ffffff','#a0ffcc','#18a36b'];
  for(let i = 0; i < 60; i++){
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 1.5;
    const duration = 2.5 + Math.random() * 2;
    const size = 5 + Math.random() * 8;
    piece.style.cssText = `left:${left}%;background:${color};width:${size}px;height:${size}px;animation-duration:${duration}s;animation-delay:${delay}s;border-radius:${Math.random() > 0.5 ? '50%' : '2px'};`;
    container.appendChild(piece);
  }
}

/* ── Badge na nav ── */
/* O perfil do operador agora mora no hub (hub.html#perfil): experiência única
   pra editar apelido, tag, avatar e ver progresso. O painel só aponta pra lá. */
document.getElementById('opBadge')?.addEventListener('click', () => {
  if(_session){
    location.href = 'hub.html#perfil';
  } else {
    const overlay = document.getElementById('operatorOverlay');
    overlay.classList.add('open');
    document.getElementById('welcomeSuccess').style.display = 'none';
    document.getElementById('welcomeCloseBtn').hidden = false;
    switchAuthTab('login');
    setTimeout(() => updateTabIndicator('login'), 50);
  }
});
document.getElementById('welcomeCloseBtn').addEventListener('click', () => {
  document.getElementById('operatorOverlay').classList.remove('open');
});
if(OPERATOR_NAME) document.getElementById('opBadge').textContent = OPERATOR_NAME;
if(_session) setTimeout(initUserNotifListener, 1500);
if(_session && isAdmin(_session.email)) revealAdminNav();
// mostra botão 2FA se já tem sessão ativa
if(_session){
}

const _legacyForm = document.getElementById('operatorForm');
if(_legacyForm) _legacyForm.addEventListener('submit', e => e.preventDefault());

promptOperatorNameIfNeeded();

/* =========================================================================
   PERFIL DO USUÁRIO
========================================================================= */
const UP_AVATAR_KEY = 'suprema_user_avatar_v1';
let UP_PENDING_ERROR = null; // { key, desc } — erro pendente de justificativa

function getUserAvatar(){
  try{ return localStorage.getItem(UP_AVATAR_KEY) || null; }catch(e){ return null; }
}
function setUserAvatar(v){
  try{ localStorage.setItem(UP_AVATAR_KEY, v); }catch(e){}
  if(fbReady && _session) fbDb.ref(`users/${emailToKey(_session.email)}/avatar`).set(v);
}

/* Progressão do operador (conquistas) — a experiência mora no hub, mas o painel
   espelha o TÍTULO (tag equipada) e a MOLDURA (tier de XP) pra mostrar na presença.
   Só leitura: nada aqui altera o progresso, só reflete o que o hub já calculou. */
const UP_TITLE_KEY = 'suprema_user_title_v1'; // id da tag equipada (ex.: 'grinder')
const UP_TIER_KEY  = 'suprema_user_frame_v1'; // tier da moldura (0..7) — mesmo nome que o hub usa
const OPERATOR_TITLES = {
  novato:'Novato na mesa', regular:'Regular', operador:'Operador', grinder:'Grinder',
  tubarao:'Tubarão', especialista:'Especialista', highroller:'High Roller', controlador:'Controlador',
  arquiteto:'Arquiteto', mestremesas:'Mestre das Mesas', supervisor:'Supervisor', veterano:'Veterano',
  lenda:'Lenda da casa', imortal:'Imortal', tita:'Titã Suprema'
};
function getUserTitle(){ // nome legível da tag equipada, ou null
  try{ const id = localStorage.getItem(UP_TITLE_KEY); return id ? (OPERATOR_TITLES[id] || null) : null; }catch(e){ return null; }
}
function getUserTier(){ // 0..7, ou null se ainda não sabemos
  try{ const v = localStorage.getItem(UP_TIER_KEY); return v == null || v === '' ? null : Math.max(0, Math.min(7, +v)); }catch(e){ return null; }
}

function openUserProfile(){
  if(!_session) return;
  const overlay = document.getElementById('userProfileOverlay');
  const panel = document.getElementById('userProfilePanel');
  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    panel.style.transform = 'translateX(0)';
    panel.style.opacity = '1';
  });
  renderUserProfile();
}
function closeUserProfile(){
  const panel = document.getElementById('userProfilePanel');
  panel.style.transform = 'translateX(20px)';
  panel.style.opacity = '0';
  setTimeout(() => { document.getElementById('userProfileOverlay').style.display = 'none'; }, 320);
}

function renderUserProfile(){
  if(!_session) return;
  const s = _session;

  // Header
  document.getElementById('upName').textContent = s.displayName || s.nome || '—';
  document.getElementById('upEmail').textContent = s.email || '—';

  // Avatar
  const avatar = getUserAvatar() || (s.displayName||'?').slice(0,2).toUpperCase();
  const avatarEl = document.getElementById('upAvatarContent');
  if(avatarEl) avatarEl.textContent = avatar;

  // Info list (com selo de admin e data de cadastro, quando existirem)
  const info = [
    { label: 'Nome completo', val: `${s.nome||''} ${s.sobrenome||''}`.trim() || '—' },
    { label: 'Apelido', val: s.apelido || '—' },
    { label: 'Email', val: s.email || '—' },
  ];
  if (s.createdAt) info.push({ label: 'Conta criada em', val: new Date(s.createdAt).toLocaleDateString('pt-BR') });
  if (s.admin) info.push({ label: 'Acesso', val: '', badge: 'ADMIN' });
  document.getElementById('upInfoList').innerHTML = info.map(item =>
    `<div class="up-info-row">
      <span class="k">${item.label}</span>
      ${item.badge ? `<span class="up-badge-admin">${item.badge}</span>` : `<span class="v">${escHtml(item.val)}</span>`}
    </div>`
  ).join('');

  // Atividade de hoje: fixações + premiações preenchidas por mim, em ordem cronológica inversa
  const fixIco  = '<span class="up-tl-ico fix"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  const premIco = '<span class="up-tl-ico prem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5H10.75a1.75 1.75 0 0 0 0 3.5H14.5"/></svg></span>';
  const eventos = [];
  RAW_ROWS.forEach(r => {
    const k = r._key;
    if (fixedBy(k) === OPERATOR_NAME){
      const v = FIXED_MAP[k];
      eventos.push({ at: (v && typeof v === 'object' && v.at) || 0, ico: fixIco,
        txt: `Fixou <b>${escHtml(r.nome)}</b>`, sub: `${r.hora||'—'}${getId(k) ? ' · ID '+escHtml(getId(k)) : ''}` });
    }
    const pb = PREM_BY_MAP[k];
    const pbName = pb && typeof pb === 'object' ? pb.by : pb;
    if (pbName === OPERATOR_NAME && r.premiacao != null){
      eventos.push({ at: (pb && typeof pb === 'object' && pb.at) || 0, ico: premIco,
        txt: `Premiação de <b>${escHtml(r.nome)}</b>`, sub: `R$ ${fmtBRL(r.premiacao, 0)}` });
    }
  });
  eventos.sort((a,b) => (b.at||0) - (a.at||0));

  // Stats do dia
  const nFix  = eventos.filter(e => e.ico === fixIco).length;
  const nPrem = eventos.filter(e => e.ico === premIco).length;
  const nTotal = RAW_ROWS.filter(r => mustFix(r, classify(r))).length;
  document.getElementById('upStats').innerHTML = `
    <div class="up-stat"><b>${nFix}</b><span>Fixados</span></div>
    <div class="up-stat"><b>${nPrem}</b><span>Premiações</span></div>
    <div class="up-stat"><b>${nTotal}</b><span>Cards do dia</span></div>`;

  const myCardsEl = document.getElementById('upMyCards');
  if(!eventos.length){
    myCardsEl.innerHTML = '<div style="padding:14px 16px;font-size:13px;color:var(--ink-soft);">Nenhuma atividade sua registrada hoje ainda — fixações e premiações aparecem aqui.</div>';
  } else {
    myCardsEl.innerHTML = eventos.map(e => {
      const hhmm = e.at ? new Date(e.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="up-tl-row">${e.ico}<div class="up-tl-txt">${e.txt}<small>${e.sub}</small></div><span class="up-tl-time">${hhmm}</span></div>`;
    }).join('');
  }
}

function upPickEmoji(){
  const picker = document.getElementById('upEmojiPicker');
  const atual = getUserAvatar();
  const emojis = ['🎯','🃏','♠️','♣️','♦️','♥️','🎲','🏆','⚡','🌟','🦁','🐯','🦊','🐺','🦅','🔥','💎','🥇','🎭','🚀','👑','🌙','⚔️','🛡️','🎱','🎰','🎮','💡','🏅','😎'];
  picker.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Escolha seu ícone</div>
    <div class="up-picker-grid">${emojis.map(e =>
      `<button class="up-picker-btn${e === atual ? ' selected' : ''}" onclick="upSetEmoji('${e}')" aria-label="Usar ${e} como ícone">${e}</button>`
    ).join('')}</div>`;
  picker.classList.toggle('open');
}
function upSetEmoji(e){
  setUserAvatar(e);
  const el = document.getElementById('upAvatarContent');
  if(el) el.textContent = e;
  // marca a seleção no grid antes de fechar — feedback imediato do que foi escolhido
  document.querySelectorAll('#upEmojiPicker .up-picker-btn').forEach(b => b.classList.toggle('selected', b.textContent === e));
  setTimeout(() => document.getElementById('upEmojiPicker').classList.remove('open'), 260);
  showToast('Ícone atualizado!');
  // atualiza badge na nav
  document.getElementById('opBadge').textContent = OPERATOR_NAME;
  // reescreve a presença já com o novo ícone, pra aparecer na barra pros outros na hora
  refreshMyPresenceName();
}

/* Sair/Trocar conta: o login mora no hub (hub.html) — limpa a sessão e volta pra lá */
function upChangeAccount(){
  clearSession();
  location.href = 'hub.html';
}
function doLogout(){ upLogout(); }
function upLogout(){
  if(!confirm('Sair da sua conta?')) return;
  clearSession();
  location.href = 'hub.html';
}

// Feedback de erro — chamado quando operador preenche dado incorreto
function triggerCardErrorFeedback(key, desc){
  UP_PENDING_ERROR = { key, desc };
  const feedbackEl = document.getElementById('upErrorFeedback');
  document.getElementById('upErrorDesc').textContent = desc;
  feedbackEl.style.display = '';
  openUserProfile();
  // scrolla até o feedback
  setTimeout(() => feedbackEl.scrollIntoView({behavior:'smooth', block:'center'}), 400);
}
function upDenyError(){
  document.getElementById('upErrorFeedback').style.display = 'none';
  UP_PENDING_ERROR = null;
}
function upAcceptError(){
  const just = document.getElementById('upJustificativa').value.trim();
  if(!just){ showToast('Descreva o motivo do erro antes de confirmar.', true); return; }
  if(!UP_PENDING_ERROR) return;
  // salva a justificativa no Firebase
  const log = { key: UP_PENDING_ERROR.key, desc: UP_PENDING_ERROR.desc, justificativa: just,
    operador: OPERATOR_NAME, at: Date.now() };
  if(fbReady) fbDb.ref(`${FB_BASE_PATH}/errorLog/${Date.now()}`).set(log);
  showToast('Justificativa registrada. Pode continuar.');
  document.getElementById('upErrorFeedback').style.display = 'none';
  document.getElementById('upJustificativa').value = '';
  UP_PENDING_ERROR = null;
  closeUserProfile();
}

/* =========================================================================
   FIXED STATE — Firebase Realtime Database (compartilhado entre todos que
   abrem o painel) + localStorage como cache local instantâneo/offline.
   Mantém a mesma interface (isFixed/setFixed/getId/setId) usada pelo resto
   do código, então só esse bloco muda — nada mais precisa saber que existe Firebase.
========================================================================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAFy1GtRaJE3LHC1Rjtmq0uw2JC8bviXes",
  authDomain: "design-1-53c00.firebaseapp.com",
  databaseURL: "https://design-1-53c00-default-rtdb.firebaseio.com",
  projectId: "design-1-53c00",
  storageBucket: "design-1-53c00.firebasestorage.app",
  messagingSenderId: "140511032441",
  appId: "1:140511032441:web:dcf970125bbf5eec53d0a8"
};
// dados de um dia ficam isolados em /painel/AAAA-MM-DD — assim a planilha de um dia não mistura com a de outro
function todayPathSP(){
  // Dia OPERACIONAL, não civil: o turno vai até 05:30 da manhã seguinte (mesma regra da
  // Conferência de amanhã). Entre 00:00 e 05:29 ainda estamos no "dia" de ontem — sem esse
  // corte, quem preenchia garantido/field/premiação de madrugada gravava em painel/<dia novo>
  // enquanto o parceiro (com a aba aberta desde a noite) lia painel/<dia velho>: os dados
  // "sumiam" um pro outro. Agora todos os clientes apontam pro mesmo nó durante o turno inteiro.
  const n = nowInSP();
  const ref = new Date(Date.UTC(n.year, n.month - 1, n.day, 12, 0, 0));
  if (isMadrugadaSP(n)) ref.setUTCDate(ref.getUTCDate() - 1);
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}-${String(ref.getUTCDate()).padStart(2, '0')}`;
}
FB_BASE_PATH    = `painel/${todayPathSP()}`;
LAST_KNOWN_DATE = todayPathSP();

/* =========================================================================
   LIMPEZA AUTOMÁTICA DE DIAS ANTIGOS
   Como FB_BASE_PATH é por data (painel/AAAA-MM-DD), cada dia de uso cria um nó novo
   no Firebase que nunca era apagado — depois de meses de uso isso vira um banco de
   dados crescendo indefinidamente. Mantém uma janela de retenção (padrão 14 dias —
   bem mais que o 1 dia que a comparação "vs ontem" precisa) e apaga só o que for mais
   antigo que isso. Roda no máximo uma vez por sessão, com atraso aleatório pra reduzir
   a chance dos dois operadores tentarem limpar a mesma coisa ao mesmo tempo.
========================================================================= */

function cleanupOldDailyNodes(){
  if (!fbReady) return;
  fbDb.ref('painel').once('value').then(snap => {
    const data = snap.val();
    if (!data) return;
    const n = nowInSP();
    const todayUTC = Date.UTC(n.year, n.month-1, n.day);
    Object.keys(data).forEach(dateKey => {
      const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return; // ignora qualquer chave que não seja data (proteção contra estrutura inesperada)
      const keyUTC = Date.UTC(+m[1], +m[2]-1, +m[3]);
      const ageDays = (todayUTC - keyUTC) / 86400000;
      if (ageDays > FB_RETENTION_DAYS){
        fbDb.ref(`painel/${dateKey}`).remove().catch(() => {}); // falha silenciosa — não é crítico, tenta de novo na próxima sessão
      }
    });
  }).catch(() => {}); // sem permissão de leitura na raiz, ou offline — não é crítico, só não limpa dessa vez
}

function loadFixedMap(){
  try{ return JSON.parse(localStorage.getItem(FIXED_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveFixedMapLocal(map){
  try{ localStorage.setItem(FIXED_STORE_KEY, JSON.stringify(map)); }catch(e){}
}
function loadPremByMap(){
  try{ return JSON.parse(localStorage.getItem(PREM_BY_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function savePremByMapLocal(map){
  try{ localStorage.setItem(PREM_BY_STORE_KEY, JSON.stringify(map)); }catch(e){}
}
function loadIdMap(){
  try{ return JSON.parse(localStorage.getItem(ID_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveIdMapLocal(map){
  try{ localStorage.setItem(ID_STORE_KEY, JSON.stringify(map)); }catch(e){}
}
function loadFieldMap(){
  try{ return JSON.parse(localStorage.getItem(FIELD_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveFieldMapLocal(map){
  try{ localStorage.setItem(FIELD_STORE_KEY, JSON.stringify(map)); }catch(e){}
}
function loadGarantidoMap(){
  try{ return JSON.parse(localStorage.getItem(GARANTIDO_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveGarantidoMapLocal(map){
  try{ localStorage.setItem(GARANTIDO_STORE_KEY, JSON.stringify(map)); }catch(e){}
}
function loadChecklistMap(){
  try{ return JSON.parse(localStorage.getItem(CHECKLIST_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveChecklistMapLocal(map){
  try{ localStorage.setItem(CHECKLIST_STORE_KEY, JSON.stringify(map)); }catch(e){}
}
function loadConfHojeMap(){
  try{ return JSON.parse(localStorage.getItem(CONFHOJE_STORE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveConfHojeMapLocal(map){
  try{ localStorage.setItem(CONFHOJE_STORE_KEY, JSON.stringify(map)); }catch(e){}
}

/* ── Inicializa maps com dados do localStorage (funções já disponíveis aqui) ── */
Object.assign(FIXED_MAP,     loadFixedMap());
Object.assign(PREM_BY_MAP,   loadPremByMap());
Object.assign(ID_MAP,        loadIdMap());
Object.assign(FIELD_MAP,     loadFieldMap());
Object.assign(GARANTIDO_MAP, loadGarantidoMap());
Object.assign(CHECKLIST_MAP, loadChecklistMap());
Object.assign(CONFHOJE_MAP,  loadConfHojeMap());

// Firebase entra em modo "best effort": se o SDK não carregar (sem internet, CDN bloqueado etc),
// o painel continua funcionando 100% local, só sem sincronizar com o parceiro.

function setSyncBadge(state){
  // state: 'online' | 'offline' | 'connecting'
  const el = document.getElementById('syncStatus');
  if (el){
    const label = el.querySelector('.sync-label');
    el.classList.toggle('offline',    state === 'offline');
    el.classList.toggle('connecting', state === 'connecting');
    el.classList.toggle('online',     state === 'online');
    if (label) label.textContent = state === 'online'     ? 'Sincronizado'
                                 : state === 'connecting' ? 'Conectando...'
                                 : 'Offline';
  }

  // faixa de alerta no topo: só aparece depois de 5s contínuos offline (evita "piscar" em quedas
  // rápidas de conexão que se resolvem sozinhas) e some na hora assim que reconectar
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  if (state === 'offline'){
    if (!offlineBannerTimer){
      offlineBannerTimer = setTimeout(() => {
        banner.hidden = false;
        requestAnimationFrame(() => banner.classList.add('show'));
      }, 5000);
    }
  } else {
    clearTimeout(offlineBannerTimer);
    offlineBannerTimer = null;
    banner.classList.remove('show');
  }
}
/* listener da planilha compartilhada — extraído pra função porque precisa ser RE-registrado
   sempre que FB_BASE_PATH muda (virada de dia, restauração de dia segurado): antes ele era
   registrado uma única vez no carregamento e ficava preso no nó do dia antigo, então depois
   da virada a aba do parceiro nunca recebia a Global nova sem recarregar a página */
let SHEET_LISTENER_PATH = null; // path onde o listener está registrado agora, pra poder desligar
function registerSheetListener(){
  if(!fbReady || !fbDb) return;
  if(SHEET_LISTENER_PATH) fbDb.ref(`${SHEET_LISTENER_PATH}/sheet/uploadedAt`).off();
  if(SHEET_LISTENER_PATH !== FB_BASE_PATH) window._painelSheetLastTs = null; // trocou de dia
  SHEET_LISTENER_PATH = FB_BASE_PATH;
  // ECONOMIA DE BANDA: observa só o timestamp (uploadedAt, um número); baixa a grade
  // (rows, pesada) com .once() SÓ quando muda. Antes o .on('value') no nó inteiro
  // rebaixava a grade toda a cada reconexão. A dedup por assinatura continua igual.
  fbDb.ref(`${FB_BASE_PATH}/sheet/uploadedAt`).on('value', tsSnap => {
    const ts = tsSnap.val();
    if(!ts || `${ts}` === `${window._painelSheetLastTs}`) return;
    window._painelSheetLastTs = `${ts}`;
    fbDb.ref(`${FB_BASE_PATH}/sheet`).once('value').then(snap => {
    const data = snap.val();
    if(!data || !Array.isArray(data.rows) || !data.rows.length) return;
    const sig = `${data.uploadedAt}|${data.rows.length}`;
    if(sig === LAST_APPLIED_SHEET_SIGNATURE) return; // já temos essa versão
    LAST_APPLIED_SHEET_SIGNATURE = sig;
    if(data.uploadedAt) window.SHEET_UPLOAD_DATE = new Date(data.uploadedAt)
      .toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
    // Backup das premiações antes de recarregar a sheet — por _key E por nome|hora.
    // O _key é um hash de nome|hora|buyin|garantido (ver rowKey): corrigir o garantido
    // depois de fechar o pote MUDA a chave e orfanava a premiação já preenchida — o que
    // zerava "Pago em premiações"/"fechados". O fallback por nome+hora (identidade estável)
    // reata o vínculo. Em memória só (sem regravar no FB) pra não arriscar premiar o torneio
    // errado num eventual empate de nome+hora.
    const premBackup = {}, premByNH = {};
    RAW_ROWS.forEach(r => {
      if(r.premiacao != null){
        premBackup[r._key] = r.premiacao;
        if(r.nome && r.hora) premByNH[`${r.nome}|${r.hora}`] = r.premiacao;
      }
    });
    ingest(data.rows, data.filename || '', true);
    // Restaurar premiações após ingest (não perder dados já preenchidos)
    let premChanged = false;
    RAW_ROWS.forEach(r => {
      if(r.premiacao != null) return;
      let val = premBackup[r._key];                                   // 1) mesma chave
      if(val == null && r.nome && r.hora) val = premByNH[`${r.nome}|${r.hora}`]; // 2) garantido mudou → nome+hora
      if(val != null){ r.premiacao = val; premChanged = true; }
    });
    if(premChanged){
      RESULTS  = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
      UPCOMING = [...RAW_ROWS];
      computeStats(); updateProgress(); // sem isto os KPIs ficavam no valor velho (R$ 0) com RESULTS já cheio
      renderResults();
      if(!isTypingInCard() && !window._suppressRenderUpcoming) renderUpcoming();
    }
    // Só avisa se foi outra pessoa que enviou (não a própria sessão)
    if(!MY_LAST_UPLOAD_AT || Math.abs(data.uploadedAt - MY_LAST_UPLOAD_AT) > 15000){
      showToast(`Planilha "${data.filename || 'Global'}" recebida (${data.rows.length} torneios)`);
    }
    }).catch(()=>{ window._painelSheetLastTs = null; });
  });
}

/* Roda cb assim que houver usuário do Firebase Auth (agora, se já restaurou; senão
   quando restaurar). Serve pra NÃO anexar listeners que exigem auth antes do token
   existir: numa recarga, o token demora um instante e, se o listener sobe antes, o
   RTDB nega a leitura e CANCELA o listener — a premiação vinha "0 fechados" até
   religar por acaso. Espelha o guard que o hub já tem. */
function whenAuthed(cb){
  try{
    var a = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
    if(!a || a.currentUser){ cb(); return; }
    var off = a.onAuthStateChanged(function(u){ if(u){ if(off) off(); cb(); } });
  }catch(e){ try{ cb(); }catch(_){ } }
}

function initFirebaseSync(){
  try{
    if(typeof firebase === 'undefined'){ setSyncBadge('offline'); return; }
    firebase.initializeApp(FIREBASE_CONFIG);
    // Cutover email/senha (Fase 4): sem login anônimo. O token de acesso vem da
    // sessão real do Firebase Auth (email/senha) que o hub deixa persistida por
    // origem — quem logou no hub já chega autenticado aqui.
    // progressão do Suprema OS: abrir o painel conta XP na jornada do operador
    firebase.auth().onAuthStateChanged(u => {
      if(u && !window.__spTracked){ window.__spTracked = true; try{ SupremaAuth.trackUse('painel'); }catch(e){} }
    });
    fbDb    = firebase.database();
    fbReady = true;
    setSyncBadge('connecting');

    // ── Conexão ──────────────────────────────────────────────────────────
    let _connected = false;
    fbDb.ref('.info/connected').on('value', snap => {
      if(snap.val() === true){
        if(!_connected){
          _connected = true;
          // Disparar callbacks de presença (só quando conexão confirmada)
          (window._onConnected || []).forEach(fn => { try{ fn(); }catch(e){} });
          window._onConnected = [];
        }
        FB_CONNECTED = true;
        setSyncBadge('online');
      } else if(_connected){
        // Só mostra reconectando se já esteve online (não no false inicial)
        FB_CONNECTED = false;
        setSyncBadge('connecting');
      }
      // o `_connected` acima é block-scoped (e mistura "já conectou uma vez" com "está online
      // agora"); o FB_CONNECTED é de módulo e só responde "estamos online?" — é o que o
      // diagnóstico lê. Fica `undefined` até o 1º handshake, pra não acusar queda no load.
      if(typeof scheduleDiagnostico === 'function') scheduleDiagnostico();
    });
    // Timeout: se não conectar em 15s marca offline
    setTimeout(() => { if(!_connected) setSyncBadge('offline'); }, 15000);

    // ── Sheet (planilha compartilhada) ───────────────────────────────────
    registerSheetListener();

    // ── Premiação ─────────────────────────────────────────────────────────
    // só anexa com auth viva: senão, numa recarga, o RTDB nega a leitura e cancela
    // o listener — e a premiação some ("0 fechados") até religar por acaso.
    whenAuthed(() => {
    fbDb.ref(`${FB_BASE_PATH}/premiacao`).on('value', snap => {
      const data = snap.val() || {};
      let changed = false;
      // Aplicar novas premiações
      Object.entries(data).forEach(([key, val]) => {
        const row = rowByKey(key);
        if(row && row.premiacao !== val){
          row.premiacao = val; changed = true;
          try {
            const pm = JSON.parse(localStorage.getItem('suprema_prem_v1') || '{}');
            pm[key] = val;
            localStorage.setItem('suprema_prem_v1', JSON.stringify(pm));
          } catch(e){}
          if(changed){
            const r2 = rowByKey(key);
            if(r2) logActivity(`<b>${'Parceiro'}</b> preencheu premiação de <b>${r2.nome}</b>: R$ ${fmtBRL(val,0)}`, '🔄');
          }
          const inp = document.querySelector(`.tcard-prem-input[data-key="${key}"]`);
          if(inp && document.activeElement !== inp){
            // Formatar como BRL ao receber do Firebase
            inp.value = val != null ? fmtBRL(val, val % 1 === 0 ? 0 : 2) : '';
          }
          renderCardOverlayPreview(key, row, val, getField(key));
        }
      });
      // Remover premiações apagadas pelo parceiro — mas SÓ quando o nó tem dados.
      // Nó vazio (dia novo/virada, ou ainda não populado) NÃO significa "tudo apagado":
      // antes, isso zerava as premiações que vieram da própria planilha (elas apareciam
      // e sumiam). "Ausente" só conta como exclusão quando há um mapa real no Firebase.
      const premHasData = Object.keys(data).length > 0;
      if(premHasData) RAW_ROWS.forEach(r => {
        // só anula se a chave JÁ esteve no nó e agora sumiu (exclusão real do operador).
        // planilha (premFromSheet) ou reatada por nome+hora nunca estiveram no nó → não tocar.
        if(r.premiacao != null && !r.premFromSheet && PREM_FB_KEYS_SEEN.has(r._key) && data[r._key] == null){ r.premiacao = null; changed = true; }
      });
      Object.keys(data).forEach(k => PREM_FB_KEYS_SEEN.add(k));
      if(changed || RAW_ROWS.length){
        RESULTS  = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
        UPCOMING = [...RAW_ROWS];
        // os renders vão pro agendador: se fixed/field/garantido chegarem na mesma
        // rajada (típico do load), o rebuild pesado roda UMA vez, não uma por nó
        scheduleUI('unfixed', 'stats', 'results', 'upcoming');
      }
    });
    });  // fim do whenAuthed (premiação)

    // ── Fixados ───────────────────────────────────────────────────────────
    fbDb.ref(`${FB_BASE_PATH}/fixed`).on('value', snap => {
      FIXED_MAP = snap.val() || {};
      saveFixedMapLocal(FIXED_MAP);
      if(RAW_ROWS.length) scheduleUI('unfixed', 'stats', 'results', 'upcoming');
    });

    // ── Responsável por premiação/field (exibido nos Resultados) ─────────
    fbDb.ref(`${FB_BASE_PATH}/premBy`).on('value', snap => {
      PREM_BY_MAP = snap.val() || {};
      savePremByMapLocal(PREM_BY_MAP);
      if(RAW_ROWS.length) scheduleUI('results');
    });

    // ── Torneios manuais ──────────────────────────────────────────────────
    // Nó próprio pra sobreviver ao re-upload da Global (que substitui o sheet inteiro).
    // Ao chegar/mudar, refunde a grade — assim o parceiro vê o torneio na hora e o F5
    // não perde nada. fromRemote=true no reingest: NÃO republica (evitaria eco infinito).
    fbDb.ref(`${FB_BASE_PATH}/manualRows`).on('value', snap => {
      MANUAL_ROWS = snap.val() || {};
      reingestComManuais();
      renderManualList();
    });

    // ── IDs dos eventos ───────────────────────────────────────────────────
    fbDb.ref(`${FB_BASE_PATH}/ids`).on('value', snap => {
      ID_MAP = snap.val() || {};
      saveIdMapLocal(ID_MAP);
      document.querySelectorAll('.id-input').forEach(inp => {
        const raw = ID_MAP[inp.dataset.key];
        const v = (typeof raw === 'object' && raw) ? (raw.val || '') : (raw || '');
        if(document.activeElement !== inp) inp.value = v;
      });
      applyIdDuplicateChecks();
      // Patch in-place se possível — nunca recriar se há input em foco
      const _aeId = document.activeElement;
      const _typingNow = _aeId && (_aeId.classList.contains('id-input') || _aeId.classList.contains('tcard-prem-input') || _aeId.classList.contains('tcard-field-input'));
      if(!_typingNow){
        let allPatched = true;
        Object.keys(ID_MAP).forEach(key => { if(!patchCardFields(key)) allPatched = false; });
        // patchCardFields falha pra qualquer id de torneio que não esteja visível agora (filtrado,
        // modo compacto, etc.) — isso é normal, não significa que precisa reconstruir a agenda.
        // Só força renderUpcoming se não for eco da própria escrita (senão marcar NF, por exemplo,
        // reconstruía o grid inteiro à toa e os cards "sumiam" até revelar de novo)
        if(!allPatched && RAW_ROWS.length && !window._suppressRenderUpcoming) scheduleUI('unfixed', 'stats', 'results', 'upcoming');
      } else {
        // Só patch do card sem recriar
        Object.keys(ID_MAP).forEach(key => patchCardFields(key));
      }
    });

    // ── Field (jogadores) ─────────────────────────────────────────────────
    fbDb.ref(`${FB_BASE_PATH}/field`).on('value', snap => {
      FIELD_MAP = snap.val() || {};
      saveFieldMapLocal(FIELD_MAP);
      document.querySelectorAll('.tcard-field-input').forEach(inp => {
        const v = FIELD_MAP[inp.dataset.key];
        if(document.activeElement !== inp) inp.value = v != null ? v : '';
        const row = rowByKey(inp.dataset.key);
        if(row) row.field = v != null ? v : null;
      });
      if(RAW_ROWS.length) scheduleUI('results', 'upcoming');
    });

    // ── Garantido editado ─────────────────────────────────────────────────
    fbDb.ref(`${FB_BASE_PATH}/garantido`).on('value', snap => {
      const data = snap.val() || {};
      Object.entries(data).forEach(([key, val]) => {
        GARANTIDO_MAP[key] = val;
        const row = rowByKey(key);
        if(row) row.garantido = val;
        const wrap = document.querySelector(`.tcard-garantido-wrap[data-key="${key}"]`);
        if(wrap && document.activeElement !== wrap.querySelector('.tcard-garantido-input')){
          const disp = wrap.querySelector('.tcard-garantido-display');
          if(disp) disp.textContent = fmtGarantidoBRL(val);
          wrap.classList.add('tcard-garantido-edited');
        }
      });
      saveGarantidoMapLocal(GARANTIDO_MAP);
      if(RAW_ROWS.length) scheduleUI('stats', 'results');
      else computeStats();
    });

    // ── Checklist e Conf. hoje ────────────────────────────────────────────
    fbDb.ref(`${FB_BASE_PATH}/checklist`).on('value', snap => {
      CHECKLIST_MAP = snap.val() || {};
      saveChecklistMapLocal(CHECKLIST_MAP);
      renderChecklist();
    });
    fbDb.ref(`${FB_BASE_PATH}/confhoje`).on('value', snap => {
      CONFHOJE_MAP = snap.val() || {};
      saveConfHojeMapLocal(CONFHOJE_MAP);
      renderConfHoje();
    });

    // ── Virada antecipada (madrugada) ─────────────────────────────────────
    // Espelha o listener de reinitDayListeners: uma aba aberta desde a noite precisa
    // ouvir o rolledTo já no carregamento, senão nunca segue a virada antecipada feita
    // por outra aba (o parceiro ficaria preso no quadro do dia que já fechou).
    fbDb.ref(`${FB_BASE_PATH}/rolledTo`).on('value', snap => {
      const novo = snap.val();
      if (typeof novo === 'string' && novo > LAST_KNOWN_DATE){
        showToast(`📅 Painel virou para ${novo} — Global nova carregada.`);
        ROLLOVER_HELD_TOAST = false;
        LAST_KNOWN_DATE = novo;
        resetDay(novo);
      }
    });

    // ── Relatório de turno ────────────────────────────────────────────────
    fbDb.ref('relatorioTurno/texto').on('value', snap => {
      const remote = snap.val() || '';
      if(SHIFT_REPORT_REMOTE_PENDING !== null) return; // evita piscar durante edição local
      const ta = document.getElementById('shiftReportText');
      if(ta && document.activeElement !== ta) ta.value = remote;
      SHIFT_REPORT_TEXT = remote;
    });

    // ── Mesas cash ────────────────────────────────────────────────────────
    // ECONOMIA DE BANDA: observa só o timestamp (uploadedAt, um número). O arquivo
    // (XLSX em base64, pesado) só é baixado com .once() QUANDO muda. Antes, o
    // .on('value') no nó inteiro rebaixava o XLSX a cada reconexão/tab-wake — foi o
    // que estourou a cota de download do Firebase (10GB/mês).
    fbDb.ref('mesasCash/uploadedAt').on('value', snap => {
      const at = snap.val();
      if(!at) return;
      const key = `${at}`;
      if(window._lastMesasCashKey === key) return;
      fbDb.ref('mesasCash').once('value').then(s => {
        const data = s.val();
        if(!data || !data.data) return;
        window._lastMesasCashKey = key;
        loadMesasCashFromB64(data.data, data.filename || '', data.uploadedAt, /*fromRemote=*/true, data.uploadedBy || '');
      }).catch(()=>{});
    });

    // ── Presença ─────────────────────────────────────────────────────────
    // ECONOMIA DE BANDA: em vez de .on('value') no nó inteiro (que rebaixa TODAS
    // as sessões a cada heartbeat de qualquer um — tráfego O(N²) do nó cheio),
    // ouvimos por filho. Cada evento traz só a sessão que mudou (~100 bytes),
    // mantido num cache local; a renderização (avatares + badges "está
    // preenchendo") é idêntica e chega na mesma hora.
    window._presenceCache = window._presenceCache || {};
    const _presRef = fbDb.ref('presence');
    const _presUpsert = snap => { window._presenceCache[snap.key] = snap.val(); renderPresence(window._presenceCache); };
    _presRef.on('child_added',   _presUpsert);
    _presRef.on('child_changed', _presUpsert);
    _presRef.on('child_removed', snap => { delete window._presenceCache[snap.key]; renderPresence(window._presenceCache); });

    // ── Digitação no relatório ────────────────────────────────────────────
    fbDb.ref('relatorioTurno/typing').on('value', snap => {
      const data = snap.val() || {};
      const others = Object.entries(data)
        .filter(([id]) => id !== PRESENCE_SESSION_ID)
        .filter(([,v]) => v && Date.now() - v.at < 8000)
        .map(([,v]) => v.name || 'Alguém');
      const el = document.getElementById('shiftTypingIndicator');
      if(el) el.textContent = others.length ? `${others[0]} está digitando...` : '';
    });

    // ── Limpeza automática de dias antigos ────────────────────────────────
    setTimeout(cleanupOldDailyNodes, 10000 + Math.random() * 30000);

    // ── Carregar dados iniciais após conexão ──────────────────────────────
    setTimeout(loadSavedPremiacoes,  500);
    setTimeout(loadSavedGarantidos,  600);
    setTimeout(loadSavedGarantidos,  700);

    initPresence();

  }catch(e){
    console.warn('Firebase indisponível, painel funcionando só localmente.', e);
    fbReady = false;
    setSyncBadge('offline');
  }
}

/* =========================================================================
   PRESENÇA EM TEMPO REAL — quem está com o painel aberto agora, tipo Google Sheets.
   Cada aba/sessão escreve seu nome em presence/{sessionId} e usa onDisconnect() pra se
   remover sozinha quando a aba fecha ou a conexão cai (recurso nativo do Realtime
   Database pra exatamente esse caso — não depende de "beforeunload", que é pouco confiável).
   Não é por dia (painel/AAAA-MM-DD) porque presença é sobre "agora", não sobre o dia operacional.

   PROTEÇÃO CONTRA "PRESENÇA FANTASMA": onDisconnect() depende do servidor perceber que a conexão
   caiu, o que pode demorar ou falhar em casos como wifi caindo de repente, notebook hibernando, ou
   o app/aba sendo fechado à força — nesses casos a sessão pode ficar "presa" no Firebase mostrando
   alguém que não está mais lá. Pra evitar isso: cada sessão renova seu timestamp (heartbeat) a cada
   minuto, e renderPresence ignora qualquer sessão cujo timestamp esteja há mais de 3 minutos sem
   renovar (3x o intervalo do heartbeat — folga generosa contra pequenos atrasos de rede).
========================================================================= */
const PRESENCE_SESSION_ID = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
const PRESENCE_STALE_MS = 3 * 60 * 1000; // sessão sem heartbeat há mais de 3min é considerada offline
// payload de presença: leva também o ícone que o operador escolheu no card dele,
// pra barra de presença mostrar o mesmo avatar (emoji) em vez de só as iniciais.
function myPresencePayload(){
  const p = { name: OPERATOR_NAME || 'Alguém', at: firebase.database.ServerValue.TIMESTAMP };
  const av = getUserAvatar();
  if (av) p.avatar = av;
  const tier = getUserTier();
  if (tier != null) p.tier = tier;      // moldura conquistada (0..7)
  const title = getUserTitle();
  if (title) p.title = title;           // título equipado (nome legível)
  return p;
}
let _presenceArmed = false;
function initPresence(){
  if (!fbReady) return;
  const myRef = fbDb.ref(`presence/${PRESENCE_SESSION_ID}`);
  /* ── registro SÓ com auth viva ──
     O set inicial rodava no _onConnected sem esperar a restauração (assíncrona)
     da sessão do Firebase Auth. Negado, o nó nunca nascia com `name` — e a regra
     `newData.hasChild('name')` passava a derrubar TODOS os heartbeats update({at})
     e os sets de `editing` dali em diante (o permission_denied de 60 em 60s no
     console). O arm() registra o onDisconnect e o payload completo juntos. */
  const arm = () => {
    myRef.onDisconnect().remove();
    myRef.set(myPresencePayload()).then(() => { _presenceArmed = true; }).catch(() => {});
  };
  window._onConnected = window._onConnected || [];
  window._onConnected.push(() => {
    if (firebase.auth && firebase.auth().currentUser) arm();
    else if (firebase.auth){
      let done = false;
      firebase.auth().onAuthStateChanged(u => { if (u && !done){ done = true; arm(); } });
    }
  });
  // heartbeat: renova o timestamp periodicamente, pra renderPresence saber que essa
  // sessão ainda está realmente ativa (não só "nunca foi removida"). Vai de SET com
  // o payload completo, não update({at}): se o registro inicial falhou (rede, auth),
  // o set SE CURA sozinho — sempre passa no hasChild('name') da regra.
  setInterval(() => {
    if (!fbReady || !(firebase.auth && firebase.auth().currentUser)) return;
    if (!_presenceArmed) myRef.onDisconnect().remove();   // re-arma junto com a cura
    myRef.set(myPresencePayload()).then(() => { _presenceArmed = true; }).catch(() => { _presenceArmed = false; });
  }, 60*1000);
}
function refreshMyPresenceName(){
  if (!fbReady) return;
  fbDb.ref(`presence/${PRESENCE_SESSION_ID}`).set(myPresencePayload());
}
function renderPresence(all){
  const wrap = document.getElementById('presenceWrap');
  if (!wrap) return;
  const now = Date.now();
  const sessions = Object.entries(all)
    .filter(([id]) => id)
    .filter(([id, v]) => v && typeof v.at === 'number' && (now - v.at) < PRESENCE_STALE_MS);
  if (!sessions.length){ wrap.hidden = true; return; }
  wrap.hidden = false;

  // ── Typing indicators por card ──
  // Remover badges anteriores
  document.querySelectorAll('.card-editing-badge').forEach(el => el.remove());
  // Mostrar quem está editando cada card (exceto eu mesmo)
  sessions.forEach(([sid, v]) => {
    if(sid === PRESENCE_SESSION_ID) return; // ignorar minha própria sessão
    if(!v?.editing?.key || (now - v.editing.at) > 8000) return; // expirado
    const key  = v.editing.key;
    const name = (v.name || 'Alguém').split(' ')[0]; // primeiro nome
    const field = v.editing.field || 'campo';
    const card  = document.querySelector(`.tcard[data-key="${key}"]`);
    if(!card) return;
    const badge = document.createElement('div');
    badge.className = 'card-editing-badge';
    const icon = v.avatar || name.charAt(0).toUpperCase();
    badge.innerHTML = `<span class="ceb-avatar">${icon}</span><span class="ceb-text">${name} está preenchendo...</span>`;
    card.appendChild(badge);
  });

  // agrupa por nome para o nav — guarda ícone (emoji), moldura (tier) e título do operador
  const byName = {};
  sessions.forEach(([id, v]) => {
    const name = (v && v.name) || 'Alguém';
    if (!byName[name]) byName[name] = { avatar:null, tier:null, title:null };
    const e = byName[name];
    if (v && v.avatar && !e.avatar) e.avatar = v.avatar;
    if (v && typeof v.tier === 'number' && e.tier == null) e.tier = v.tier;
    if (v && v.title && !e.title) e.title = v.title;
  });
  const names = Object.keys(byName);
  const colors = ['var(--main-bright)','var(--side-bright)','var(--sat-bright)','var(--felt-bright)','var(--gold)'];
  wrap.innerHTML = names.slice(0,5).map((name, i) => {
    const e = byName[name];
    const av = e.avatar;
    const initials = name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const color = colors[i % colors.length];
    // se o operador escolheu um emoji, mostra ele; senão cai nas iniciais
    const content = av ? `<span class="presence-emoji">${av}</span>` : initials;
    // moldura conquistada (tier) vira a borda do avatar; título aparece no hover
    const tierAttr = e.tier != null ? ` data-tier="${e.tier}"` : '';
    const tip = e.title ? `${name} · ${e.title} — no painel agora` : `${name} está no painel agora`;
    return `<span class="presence-avatar${av ? ' has-emoji' : ''}"${tierAttr} style="background:${color}" title="${escHtml(tip).replace(/"/g,'&quot;')}">${content}</span>`;
  }).join('') + (names.length > 5 ? `<span class="presence-avatar presence-more">+${names.length-5}</span>` : '');
}
// reavalia staleness periodicamente mesmo sem nenhuma mudança no Firebase — senão uma sessão que
// "morreu silenciosamente" só some da tela quando outra pessoa entrar/sair (o que dispara o listener).
// Pausa enquanto a aba está oculta (só afeta os avatares na tela, ninguém perde nada esperando)
setVisibilityAwareInterval(() => {
  if (!fbReady) return;
  // Sem rede: reavalia staleness com o cache mantido pelos listeners por filho.
  // (renderPresence filtra por PRESENCE_STALE_MS, então sessões que morreram em
  // silêncio somem da tela sozinhas.) Poda entradas velhas pra o cache não crescer.
  const cache = window._presenceCache || (window._presenceCache = {});
  const cutoff = Date.now() - PRESENCE_STALE_MS;
  for (const id in cache) { const v = cache[id]; if (!v || typeof v.at !== 'number' || v.at < cutoff) delete cache[id]; }
  renderPresence(cache);
}, 60*1000);

/* =========================================================================
   CHECKLIST DIÁRIO — itens fixos definidos pela operação, divididos em MTT e SAT.
   O estado (marcado/desmarcado) é o que sincroniza via Firebase; a lista de itens em si é fixa no código.
========================================================================= */
const CHECKLIST_DATA = [
  'Enviar Texto Mkt',
  'Planilha de conferência 2026',
  'Metas',
  'Criar lobby fictício!',
  'Relatório de turno',
  'Eventos privados',
];

/* =========================================================================
   LISTA DE SERVIDORES — referência estática (liga, ID, moeda). Não sincroniza
   (não muda durante o dia), só é exibida/filtrada localmente.
========================================================================= */
const SERVER_DATA = [
  {liga:'G.U', id:113, moeda:'Dolar 1'},
  {liga:'Suprema', id:106, moeda:'Reais'},
  {liga:'Principal', id:107, moeda:'Reais'},
  {liga:'Suprema E.U', id:111, moeda:'Dolar 0.8'},
  {liga:'Suprema Peru', id:127, moeda:'Soles 3.5'},
  {liga:'Suprema Union', id:128, moeda:'Reais'},
  {liga:'New Union', id:131, moeda:''},
  {liga:'Suprema Asia', id:132, moeda:'Dolar 0.8'},
  {liga:'Suprema Poker', id:135, moeda:'Dolar 0.8'},
  {liga:'Suprema México', id:136, moeda:'Dolar 18'},
  {liga:'Suprema Argentina', id:137, moeda:'Dolar 0.8'},
  {liga:'Suprema Panama', id:145, moeda:'Dolar 0.8'},
  {liga:'Suprema Colombia', id:147, moeda:'Reais'},
  {liga:'Suprema Venezuela', id:148, moeda:'Dolar 0.8'},
  {liga:'Suprema R Dominicana', id:149, moeda:'Dolar 0.8'},
  {liga:'Suprema Bolívia', id:150, moeda:'Boliviano 13'},
  {liga:'Suprema Costa Rica', id:163, moeda:'Dolar 0.8'},
  {liga:'Suprema KZ', id:164, moeda:'Tenge 450'},
  {liga:'Re-Stars', id:165, moeda:'Reais'},
  {liga:'Uruguai', id:204, moeda:'Dolar 0.8'},
  {liga:'Suprema USA FN', id:166, moeda:'Dolar 0.8'},
  {liga:'Suprema SX USD', id:173, moeda:'Dolar 0.8'},
  {liga:'Suprema Canada', id:174, moeda:'Dolar 0.8'},
];

// FIXED_MAP[key] guarda { by: "nome de quem fixou", at: timestamp } em vez de só `true` —
// assim dá pra mostrar quem fixou cada torneio. isFixed aceita os dois formatos (objeto novo
// ou o `true` antigo de antes dessa mudança) pra não quebrar marcações já existentes no Firebase.
function isFixed(key){ return !!FIXED_MAP[key]; }
function fixedBy(key){
  const v = FIXED_MAP[key];
  return (v && typeof v === 'object') ? (v.by || '') : '';
}
function fixedAt(key){
  const v = FIXED_MAP[key];
  if(!v || typeof v !== 'object' || !v.at) return '';
  const d = new Date(v.at);
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${h}:${m}`;
}
/* Suprime o próximo eco dos listeners do Firebase por alguns segundos — chamada sempre que
   ESTE cliente grava algo (premiação, ID, fixado, field). Sem isso, cada escrita volta pelo
   próprio listener em tempo real e força uma reconstrução completa da agenda, destruindo e
   recriando todos os cards à toa (é a causa raiz de cards "sumindo" até revelar de novo). */
function suppressUpcomingEcho(){
  window._suppressRenderUpcoming = true;
  clearTimeout(window._suppressTimer);
  window._suppressTimer = setTimeout(() => { window._suppressRenderUpcoming = false; }, 4000);
}

function setFixed(key, val){
  if (roGuard()) return;
  if (val) FIXED_MAP[key] = { by: OPERATOR_NAME || 'Alguém', at: Date.now() };
  else delete FIXED_MAP[key];
  saveFixedMapLocal(FIXED_MAP); // grava local na hora (instantâneo, sem esperar rede)
  if (fbReady){
    suppressUpcomingEcho();
    fbDb.ref(`${FB_BASE_PATH}/fixed/${key}`).set(val ? FIXED_MAP[key] : null)
      .catch(err => {
        console.error('Firebase: falha ao salvar fixado', err);
        showToast('Marcado só neste navegador — falha ao sincronizar com seu parceiro.', true);
      });
  }
}
// PREM_BY_MAP[key] guarda quem preencheu premiação/field de cada torneio — { by, at } —
// usado só pra exibir "responsável" no painel de Resultados. Independente do FIXED_MAP:
// preencher premiação/field não conta como "fixar" (isso continua exigindo o checkbox Fix).
function premBy(key){
  const v = PREM_BY_MAP[key];
  return (v && typeof v === 'object') ? (v.by || '') : '';
}
function premByAt(key){
  const v = PREM_BY_MAP[key];
  if(!v || typeof v !== 'object' || !v.at) return '';
  const d = new Date(v.at);
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${h}:${m}`;
}
function stampPremBy(key){
  if (PANEL_RO) return;
  PREM_BY_MAP[key] = { by: OPERATOR_NAME || 'Alguém', at: Date.now() };
  savePremByMapLocal(PREM_BY_MAP);
  if (fbReady){
    fbDb.ref(`${FB_BASE_PATH}/premBy/${key}`).set(PREM_BY_MAP[key]).catch(() => {}); // falha silenciosa — não é crítico, "responsável" já ficou salvo localmente
  }
}
function getId(key){
  const v = ID_MAP[key];
  return (typeof v === 'object' && v !== null) ? (v.val || '') : (v || '');
}
function getIdBy(key){
  const v = ID_MAP[key];
  return (typeof v === 'object' && v !== null) ? (v.by || '') : '';
}
/* quem "é dono" do torneio pra fins do filtro Meus/Parceiro — prioriza quem fixou,
   depois quem preencheu premiação/field, depois quem preencheu o ID */
function cardResponsibleName(key){
  return fixedBy(key) || premBy(key) || getIdBy(key) || '';
}
function setId(key, val){
  if (roGuard()) return;
  if(val){
    ID_MAP[key] = { val, by: OPERATOR_NAME || 'Alguém', at: Date.now() };
  } else {
    delete ID_MAP[key];
  }
  saveIdMapLocal(ID_MAP);
  applyIdDuplicateChecks();
  // Debounce: salvar no Firebase só após 500ms sem digitar
  clearTimeout(_debouncedIdSave[key]);
  if(fbReady) fbDb.ref(`presence/${PRESENCE_SESSION_ID}/editing`).set({key, field:'id', at:Date.now()}).catch(()=>{});
  _debouncedIdSave[key] = setTimeout(() => {
    if(!fbReady) return;
    suppressUpcomingEcho();
    fbDb.ref(`${FB_BASE_PATH}/ids/${key}`).set(val ? ID_MAP[key] : null)
      .catch(err => console.error('Firebase: falha ao salvar ID', err));
    fbDb.ref(`presence/${PRESENCE_SESSION_ID}/editing`).remove().catch(()=>{});
  }, 250);
}

function getField(key){ return FIELD_MAP[key] != null ? FIELD_MAP[key] : ''; }
function setField(key, val){
  if (roGuard()) return;
  const n = val === '' || val == null ? null : parseInt(val, 10);
  // Atualização em memória é imediata (preview instantâneo, sem custo de I/O)…
  if(n != null && !isNaN(n)) FIELD_MAP[key] = n;
  else delete FIELD_MAP[key];
  const row = rowByKey(key);
  if(row) row.field = (n != null && !isNaN(n)) ? n : null;
  // …mas o localStorage (síncrono, bate no disco) e o Firebase (rede) NÃO podem rodar
  // a cada tecla — era isso que travava ao digitar. Publica "editando" 1x por rajada.
  if(fbReady && !_debouncedFieldSave[key]){
    fbDb.ref(`presence/${PRESENCE_SESSION_ID}/editing`).set({key, field:'field', at:Date.now()}).catch(()=>{});
  }
  clearTimeout(_debouncedFieldSave[key]);
  _debouncedFieldSave[key] = setTimeout(() => {
    _debouncedFieldSave[key] = null;
    saveFieldMapLocal(FIELD_MAP); // grava no disco só quando parou de digitar
    if(n != null && !isNaN(n)) stampPremBy(key); // responsável exibido nos Resultados
    if(fbReady){
      suppressUpcomingEcho();
      fbDb.ref(`${FB_BASE_PATH}/field/${key}`).set(n != null && !isNaN(n) ? n : null);
      fbDb.ref(`presence/${PRESENCE_SESSION_ID}/editing`).remove().catch(()=>{});
    }
  }, 200);
}

/* Garantido: usa o valor da planilha como base, mas permite override manual no card.
   O override fica salvo em Firebase + localStorage por dia. */
function getGarantidoEffective(key){
  // override manual prevalece sobre a planilha
  if(GARANTIDO_MAP[key] != null) return GARANTIDO_MAP[key];
  const row = rowByKey(key);
  return row?.garantido ?? null;
}
function setGarantidoOverride(key, val){
  if (roGuard()) return;
  const n = val === '' || val == null ? null : parseFloat(String(val).replace(/[^\d.,]/g,'').replace(',','.'));
  if(n != null && !isNaN(n) && n > 0){
    GARANTIDO_MAP[key] = n;
    // também atualiza o row em memória para que computeStats e exports usem o valor correto
    const row = rowByKey(key);
    if(row) row.garantido = n;
    if(fbReady) fbDb.ref(`${FB_BASE_PATH}/garantido/${key}`).set(n);
  } else if(val === '' || val == null){
    delete GARANTIDO_MAP[key];
    // restaura o valor original da planilha
    if(fbReady) fbDb.ref(`${FB_BASE_PATH}/garantido/${key}`).remove();
  }
  saveGarantidoMapLocal(GARANTIDO_MAP);
  computeStats();
}

/* VALIDADOR DE ID DUPLICADO — percorre todos os IDs já preenchidos (ID_MAP) e marca visualmente
   (borda vermelha + aviso permanente, não um toast passageiro) qualquer campo cujo valor apareça em
   mais de um torneio diferente. Roda sempre que algum ID muda (local ou vindo do Firebase do parceiro)
   e também depois de cada render, pra cobrir os cards recém-criados na tela. */
function applyIdDuplicateChecks(){
  // agrupa: valor do ID (normalizado) -> lista de keys de torneio que usam esse valor
  const byValue = {};
  Object.entries(ID_MAP).forEach(([key, entry]) => {
    // ID_MAP pode guardar string ou {val, by, at}
    const norm = (typeof entry === 'object' && entry !== null)
      ? String(entry.val || '').trim()
      : String(entry || '').trim();
    if (!norm || norm.toUpperCase() === 'NF') return; // NF não é duplicata
    if (!byValue[norm]) byValue[norm] = [];
    byValue[norm].push(key);
  });
  const duplicatedKeys = new Set();
  Object.values(byValue).forEach(keys => {
    if (keys.length > 1) keys.forEach(k => duplicatedKeys.add(k));
  });

  document.querySelectorAll('.id-input[data-key]').forEach(inp => {
    const key = inp.dataset.key;
    const isDup = duplicatedKeys.has(key);
    inp.classList.toggle('id-duplicate', isDup);
    // o aviso fica no <span class="id-dup-warning"> logo depois do .copy-row que contém o input
    const warningEl = inp.closest('.copy-row')?.nextElementSibling;
    if (warningEl && warningEl.classList.contains('id-dup-warning')){
      if (isDup){
        const idVal = getId(key); // já retorna string normalizada
        const sameIdKeys = byValue[idVal.trim()] || [];
        const otherCount = Math.max(0, sameIdKeys.length - 1); // nunca negativo
        warningEl.hidden = false;
        warningEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>ID repetido em ${otherCount} outro${otherCount>1?'s':''} torneio${otherCount>1?'s':''}`;
      } else {
        warningEl.hidden = true;
        warningEl.innerHTML = '';
      }
    }
  });
}

// checklist: mesmo padrão de FIXED_MAP (objeto {by, at} por item), mas vive em FB_BASE_PATH/checklist —
// como FB_BASE_PATH já é por data (painel/AAAA-MM-DD), o checklist reseta sozinho todo dia automaticamente
function isChecklistDone(itemId){ return !!CHECKLIST_MAP[itemId]; }
function checklistDoneBy(itemId){
  const v = CHECKLIST_MAP[itemId];
  return (v && typeof v === 'object') ? (v.by || '') : '';
}
function setChecklistItem(itemId, val){
  if (roGuard()) return;
  if (val) CHECKLIST_MAP[itemId] = { by: OPERATOR_NAME || 'Alguém', at: Date.now() };
  else delete CHECKLIST_MAP[itemId];
  // progressão: item do checklist do turno concluído = ação na jornada do operador
  if (val) try{ SupremaAuth.trackAction('checklist'); }catch(e){}
  saveChecklistMapLocal(CHECKLIST_MAP);
  if (fbReady){
    fbDb.ref(`${FB_BASE_PATH}/checklist/${itemId}`).set(val ? CHECKLIST_MAP[itemId] : null)
      .catch(err => {
        console.error('Firebase: falha ao salvar checklist', err);
        showToast('Marcado só neste navegador — falha ao sincronizar com seu parceiro.', true);
      });
  }
}

// conferência de hoje (Ferramenta 3): mesmo padrão, path separado FB_BASE_PATH/confhoje
function isConfHojeDone(itemId){ return !!CONFHOJE_MAP[itemId]; }
function confHojeDoneBy(itemId){
  const v = CONFHOJE_MAP[itemId];
  return (v && typeof v === 'object') ? (v.by || '') : '';
}
function setConfHojeItem(itemId, val){
  if (roGuard()) return;
  if (val) CONFHOJE_MAP[itemId] = { by: OPERATOR_NAME || 'Alguém', at: Date.now() };
  else delete CONFHOJE_MAP[itemId];
  saveConfHojeMapLocal(CONFHOJE_MAP);
  if (fbReady){
    fbDb.ref(`${FB_BASE_PATH}/confhoje/${itemId}`).set(val ? CONFHOJE_MAP[itemId] : null)
      .catch(err => {
        console.error('Firebase: falha ao salvar conferência', err);
        showToast('Marcado só neste navegador — falha ao sincronizar com seu parceiro.', true);
      });
  }
}

/* publica a planilha recém-carregada pro Firebase, pra quem mais abrir o painel hoje recebê-la sem precisar
   subir o arquivo de novo. Firebase rejeita valores "undefined" dentro de objetos, então sanitiza antes de enviar
   (campos vindos direto da célula crua, como "acoes", podem vir undefined em vez de null) */

function setSharedSheet(rows, filename){
  if (!fbReady || PANEL_RO) return;
  const safeRows = rows.map(r => {
    const clean = {};
    Object.keys(r).forEach(k => { clean[k] = r[k] === undefined ? null : r[k]; });
    return clean;
  });
  const uploadedAt = Date.now();
  MY_LAST_UPLOAD_AT = uploadedAt;
  LAST_APPLIED_SHEET_SIGNATURE = uploadedAt + '|' + safeRows.length; // marca como "já aplicada" pra não re-disparar no próprio listener
  // count: o hub mostra "N torneios" no tile lendo SÓ este número (sem baixar as rows)
  fbDb.ref(`${FB_BASE_PATH}/sheet`).set({ rows: safeRows, count: safeRows.length, filename: filename || '', uploadedAt })
    .catch(err => {
      console.error('Firebase: falha ao publicar planilha', err);
      showToast('Planilha carregada, mas não foi possível compartilhar com seu parceiro — verifique a internet.', true);
    });
}

// Restaurar planilha + dados dos cards do localStorage (instantâneo, sem esperar Firebase)
(function restoreSheetFromLocal(){
  try {
    const storeKey = 'suprema_sheet_v1_' + todayPathSP();
    const saved = localStorage.getItem(storeKey);
    if(!saved) return;
    const data = JSON.parse(saved);
    if(!data || !data.rows || data.rows.length < 10) return; // sheet corrompida
    // Turno máximo de 22h (cobre o turno que passa da meia-noite)
    if(Date.now() - data.savedAt > 22 * 60 * 60 * 1000) return;

    // 1. Carregar a sheet
    ingest(data.rows, data.filename || '', /*fromRemote=*/true);

    // 2. Restaurar premiações salvas (prioridade: snapshot da sheet > localStorage separado)
    const premMap = data.premiacaoMap || JSON.parse(localStorage.getItem('suprema_prem_v1') || '{}');
    Object.entries(premMap).forEach(([key, val]) => {
      const row = rowByKey(key);
      if(row && val > 0){
        row.premiacao = val;
        const inp = document.querySelector(`.tcard-prem-input[data-key="${key}"]`);
        if(inp) inp.value = val;
        renderCardOverlayPreview(key, row, val, getField(key));
      }
    });

    // 3. Restaurar field
    const fieldMap = data.fieldMap || {};
    Object.entries(fieldMap).forEach(([key, val]) => {
      FIELD_MAP[key] = val;
      const row = rowByKey(key);
      if(row) row.field = val;
    });

    // 4. Restaurar IDs
    const idMap = data.idMap || {};
    Object.assign(ID_MAP, idMap);

    // 5. Restaurar garantidos sobrescritos
    const garantidoMap = data.garantidoMap || {};
    Object.entries(garantidoMap).forEach(([key, val]) => {
      GARANTIDO_MAP[key] = val;
    });

    // 6. Recalcular RESULTS/UPCOMING com premiações restauradas
    RESULTS  = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
    UPCOMING = [...RAW_ROWS];
    UNFIXED  = computeUnfixed();
    document.getElementById('statUnfixed').textContent = UNFIXED.length;
    updateProgress();
    renderUnfixed();
    renderUpcoming();
    renderResults();
    computeStats();

    const count = Object.keys(premMap).length;
    const savedAt = new Date(data.savedAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
    document.getElementById('heroEyebrowText').textContent =
      `Painel restaurado (salvo às ${savedAt})${count > 0 ? ` — ${count} premiações recuperadas` : ''}`;
    // Resetar filtros para o padrão ao restaurar
    activeUpcomingCat  = new Set(['all']);
    upcomingPremFilter = 'all';
    upcomingCampFilter = 'all';
    document.querySelectorAll('#upcomingFilters .chip').forEach(c => c.classList.remove('active'));
    const allCatChip  = document.querySelector('#upcomingFilters .chip[data-cat="all"]');
    const allPremChip = document.querySelector('#upcomingFilters .chip[data-prem="all"]');
    const allCampChip = document.querySelector('#upcomingFilters .chip[data-camp="all"]');
    if(allCatChip)  allCatChip.classList.add('active');
    if(allPremChip) allPremChip.classList.add('active');
    if(allCampChip) allCampChip.classList.add('active');
  } catch(e){ console.error('Erro ao restaurar sheet local:', e); }
})();

/* O Firebase agora carrega com `defer` (fora do caminho crítico). Deferred scripts rodam
   DEPOIS do parse do body e ANTES do DOMContentLoaded — então esperar esse evento garante
   que `firebase` já existe. Se painel.js rodar após o parse (readyState != loading), o SDK
   já carregou e chamamos direto. Mantém o fallback offline de initFirebaseSync intacto. */
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFirebaseSync);
else initFirebaseSync();

/* bfcache: o Chrome congela o WebSocket do RTDB ao guardar a página no back-forward
   cache e loga "WebSocket connection failed / already in CLOSING state" no console.
   Desconectar de forma limpa ANTES de entrar no cache (pagehide persistido) e religar
   ao voltar (pageshow persistido) elimina o ruído sem perder a elegibilidade ao bfcache. */
window.addEventListener('pagehide', (e) => {
  if (e.persisted && fbReady) { try{ firebase.database().goOffline(); }catch(_){} }
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted && fbReady) { try{ firebase.database().goOnline(); }catch(_){} }
});

/* "Não fixados" no hero: o número é escrito por textContent em vários pontos do código —
   em vez de espalhar a regra de urgência por todos eles, um observer único reage à mudança:
   >0 pinta o número de vermelho (classe .neg já existente) e mostra a legenda "precisam de ação". */
(function(){
  const el = document.getElementById('statUnfixed');
  if(!el) return;
  const hint = document.getElementById('cmpUnfixedHint');
  const apply = () => {
    const n = parseInt(el.textContent, 10) || 0;
    const card = el.closest('.hstat');
    if(card) card.classList.toggle('neg', n > 0);
    if(hint) hint.hidden = n === 0;
  };
  new MutationObserver(apply).observe(el, {childList:true, characterData:true, subtree:true});
  apply();
})();

detectHeldDayOnLoad(); // recarregou a página com o dia anterior ainda incompleto? volta pro quadro segurado
setTimeout(loadHistorico, 3000);

/* dia OPERACIONAL anterior (todayPathSP - 1), pro caso de restaurar um dia segurado após reload.
   ATENÇÃO: não confundir com yesterdayPathSP() (mais abaixo), que usa o dia CIVIL e serve às
   métricas "vs ontem" — os dois divergem durante a madrugada (00:00–05:29) */
function prevOperationalDaySP(){
  const [y, m, d] = todayPathSP().split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  ref.setUTCDate(ref.getUTCDate() - 1);
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}-${String(ref.getUTCDate()).padStart(2, '0')}`;
}

/* A "virada segurada" (não trocar de dia enquanto o último card não for preenchido) precisa
   sobreviver a recarregamento de página: sem isso, um F5 depois das 05:30 iniciava a aba direto
   no dia novo e o quadro pendente de ontem sumia da tela (os dados ficavam no Firebase, mas
   invisíveis pra operação). Aqui, no carregamento: se o dia anterior tem planilha com cards
   obrigatórios ainda não fixados E o dia novo ainda não tem planilha própria, o painel volta
   a apontar pro dia anterior — e a troca acontece pelo fluxo normal quando o último card fechar. */
async function detectHeldDayOnLoad(){
  if (!fbReady || !fbDb) return;
  try{
    const ontem = prevOperationalDaySP();
    const [sheetSnap, fixedSnap] = await Promise.all([
      fbDb.ref(`painel/${ontem}/sheet`).once('value'),
      fbDb.ref(`painel/${ontem}/fixed`).once('value'),
    ]);
    const sheet = sheetSnap.val();
    if (!sheet || !Array.isArray(sheet.rows) || !sheet.rows.length) return; // ontem não teve quadro
    const fixed = fixedSnap.val() || {};
    const pendentes = sheet.rows.filter(r => {
      try{ return mustFix(r, classify(r)) && !fixed[rowKey(r)]; }catch(e){ return false; }
    });
    if (!pendentes.length) return; // ontem fechou completo — dia novo segue normal
    // se o dia novo JÁ tem planilha própria, alguém já virou e subiu a Global — não voltar atrás
    const todaySnap = await fbDb.ref(`${FB_BASE_PATH}/sheet`).once('value');
    const todaySheet = todaySnap.val();
    if (todaySheet && Array.isArray(todaySheet.rows) && todaySheet.rows.length) return;
    // restaurar o dia segurado: mesmo mecanismo comprovado do resetDay, na direção oposta
    FB_BASE_PATH = `painel/${ontem}`;
    LAST_KNOWN_DATE = ontem;
    LAST_APPLIED_SHEET_SIGNATURE = null; // força o listener a re-aplicar a sheet de ontem
    ROLLOVER_HELD_TOAST = true;          // já avisamos aqui, checkStaleness não precisa repetir
    registerSheetListener();
    reinitDayListeners();
    showToast(`🕐 Quadro de ${ontem} restaurado — faltam ${pendentes.length} card(s) pra fechar o dia. O painel vira quando o último for preenchido.`);
  }catch(e){ console.error('Erro ao detectar dia segurado:', e); }
}

// 13/14. Registrar Service Worker (PWA + modo offline)
if('serviceWorker' in navigator){
  // SW novo assumiu (postMessage do activate) — banner fixo com recarga em um clique,
  // pra nenhuma aba continuar operando com código antigo sem perceber
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'sw-updated'){
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:var(--ink,#111);color:#fff;padding:10px 18px;border-radius:99px;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;display:flex;gap:10px;align-items:center';
      bar.innerHTML = `Nova versão do painel (v${e.data.version}) — <u>clique para atualizar</u>`;
      bar.addEventListener('click', () => location.reload());
      document.body.appendChild(bar);
    }
  });
  navigator.serviceWorker.register('sw.js')
    .then(reg=>{
      console.log('[SW] Registrado:', reg.scope);
      // Verificar se há atualização disponível
      reg.addEventListener('updatefound', ()=>{
        const newSW = reg.installing;
        newSW.addEventListener('statechange', ()=>{
          if(newSW.state==='installed' && navigator.serviceWorker.controller){
            showToast('🔄 Atualização disponível — recarregue para aplicar');
          }
        });
      });
    })
    .catch(err=> console.warn('[SW] Falha ao registrar:', err));
} // carregar histórico para tooltips dos cards

/* gera o texto: Nome <tab> Hora <tab> R$ Buy-in <tab> Data por extenso <tab> ID */
function buildCopyText(row, key){
  const id = getId(key) || '';
  const buyinTxt = row.buyin === 0 ? "R$ 0,00" : "R$ " + fmtBRL(row.buyin, 2);
  const dataTxt = dataPorExtensoSP();
  return [row.nome, row.hora || '', buyinTxt, dataTxt, id].join('\t');
}

/* monta um resumo do dia em texto puro, pronto pra colar num grupo de WhatsApp: totais do topo,
   torneios fechados (com performance) e o que ainda está pendente de fixar. Usa os mesmos dados
   já calculados na tela (RAW_ROWS/RESULTS/UNFIXED), então reflete exatamente o que está sendo mostrado. */
function buildDaySummaryText(){
  const dataTxt = dataPorExtensoSP();
  const lines = [];
  lines.push(`📋 *Suprema Poker — Resumo do dia* (${dataTxt})`);
  lines.push('');

  const garantidoTotal = RAW_ROWS.reduce((s,r) => s + (r.garantido || 0), 0);
  const premiacaoTotal = RESULTS.reduce((s,r) => s + (r.premiacao || 0), 0);
  const relevant = RAW_ROWS.filter(r => mustFix(r, classify(r)));
  const fixedCount = relevant.filter(r => isFixed(r._key)).length;
  const closedCount = relevant.filter(r => r.premiacao !== null && r.premiacao !== undefined).length;

  lines.push(`Garantido total: R$ ${fmtBRL(garantidoTotal)}`);
  lines.push(`Pago em premiações: R$ ${fmtBRL(premiacaoTotal, 2)}`);
  lines.push(`Fixados: ${fixedCount}/${relevant.length} · Fechados: ${closedCount}/${relevant.length}`);
  lines.push('');

  if (RESULTS.length){
    lines.push('✅ *Fechados:*');
    RESULTS.slice().sort((a,b)=> (timeToMinutes(a.hora)??9999) - (timeToMinutes(b.hora)??9999)).forEach(r => {
      const hasNumbers = r.garantido != null && r.garantido !== 0 && r.premiacao != null;
      const pct = hasNumbers ? ((r.premiacao - r.garantido) / r.garantido) * 100 : null;
      const pctTxt = pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
      lines.push(`• ${r.nome} — R$ ${fmtBRL(r.premiacao, 2)}${pctTxt}`);
    });
    lines.push('');
  }

  if (UNFIXED.length){
    lines.push('⏳ *Pendente de fixar agora:*');
    UNFIXED.slice().sort((a,b)=> (timeToMinutes(a.hora)??9999) - (timeToMinutes(b.hora)??9999)).forEach(r => {
      lines.push(`• ${r.nome} — ${r.hora || '—'}`);
    });
  }

  return lines.join(String.fromCharCode(10));
}

async function copyToClipboard(text, btnEl, successMsg){
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); }catch(e2){}
    document.body.removeChild(ta);
  }
  if (btnEl){
    const original = btnEl.innerHTML;
    btnEl.classList.add('copied');
    btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>Copiado</span>`;
    setTimeout(()=>{ btnEl.classList.remove('copied'); btnEl.innerHTML = original; }, 1800);
  }
  showToast(successMsg || 'Linha copiada — pronta para colar.');
}

/* =========================================================================
   INGEST — single source feeds Unfixed + Agenda + Resultados
========================================================================= */
function computeUnfixed(){
  return RAW_ROWS.filter(r => {
    if (isFixed(r._key)) return false;
    const cat = classify(r);
    if (!mustFix(r, cat)) return false; // Side Event sem marcação azul nunca entra no alerta

    // marcador explícito de "não formou" -> sempre alerta, independente da hora
    if (r.explicitNF) return true;
    // preencher premiação/field é registrar resultado, não é assumir responsabilidade por fixar —
    // só o checkbox "Fix" (isFixed, checado acima) tira o torneio do alerta de "não fixados"

    // dentro da janela de antecedência (perto da hora) ou já passou do horário sem ações registradas —
    // "responsável definido" não existe mais na planilha (isFixed, checado acima, já cobre esse sinal
    // a partir do estado do próprio painel, que é a fonte de verdade agora)
    const flag = timeStatus(r.hora, cat);
    if (flag === 'late' || flag === 'soon'){
      const acoesNum = toNumber(r.acoes);
      const hasAction = acoesNum !== null && acoesNum > 0;
      return !hasAction;
    }
    return false;
  });
}

/* atualiza a barra de progresso "X de Y fixados" — conta sobre TODOS os torneios que precisam ser
   fixados no dia (mustFix), não só os que estão dentro da janela de tempo agora (diferente de UNFIXED).
   assim a barra cresce de forma estável ao longo do dia, sem pular pra trás quando um torneio sai da janela */
function updateProgress(){
  const block = document.getElementById('progressBlock');
  if (!RAW_ROWS.length){ block.hidden = true; return; }
  const relevant = RAW_ROWS.filter(r => mustFix(r, classify(r)));
  const total = relevant.length;
  if (total === 0){ block.hidden = true; return; }
  const done = relevant.filter(r => isFixed(r._key)).length;
  const pct = Math.round((done / total) * 100);
  block.hidden = false;
  const countEl = document.getElementById('progressCount');
  countEl.textContent = `${done} de ${total} fixados`;
  if (LAST_PROGRESS_DONE !== null && done !== LAST_PROGRESS_DONE){
    countEl.classList.remove('pop');
    void countEl.offsetWidth; // força reflow pra poder reiniciar a animação mesmo se já estava rodando
    countEl.classList.add('pop');
  }
  const wasIncomplete = LAST_PROGRESS_DONE !== null && LAST_PROGRESS_DONE < total;
  LAST_PROGRESS_DONE = done;
  const fill = document.getElementById('progressFill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('complete', done === total);
  // último card acabou de ser fixado (nesta aba ou pelo parceiro, via sync do Firebase):
  if (done === total && wasIncomplete){
    if (todayPathSP() > LAST_KNOWN_DATE){
      // a grade já virou (05:30+) e a troca de dia estava SEGURADA esperando este card —
      // agora sim vira o painel pro novo dia (pausa curta pro operador ver o 100%)
      showToast('✅ Último card preenchido — virando o painel para o novo dia...');
      ROLLOVER_HELD_TOAST = false;
      setTimeout(() => checkStaleness(), 1200);
    } else {
      // antes das 05:30: só avisa pra subir a Global nova se já passou da meia-noite
      maybeNotifyGlobalRefresh();
    }
  }
}

function maybeNotifyGlobalRefresh(){
  if (!isMadrugadaSP()) return; // mesmo corte de sempre — só avisa entre 00:00 e 05:29
  if (document.getElementById('globalRefreshBanner')) return; // já está na tela
  showToast('🃏 Último card preenchido! Suba a Global atualizada pra renovar os cards.');
  const bar = document.createElement('div');
  bar.id = 'globalRefreshBanner';
  bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:var(--gold,#c08000);color:#000;padding:12px 20px;border-radius:99px;font-size:13px;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;display:flex;gap:10px;align-items:center;max-width:90vw';
  bar.innerHTML = '🃏 Último card preenchido e já passou das 00:00 — <u>clique aqui para subir a Global atualizada</u> e renovar os cards.<span id="globalRefreshDismiss" style="margin-left:6px;padding:2px 8px;border-radius:99px;background:rgba(0,0,0,.15);font-weight:800">✕</span>';
  bar.addEventListener('click', () => {
    bar.remove();
    // abre direto o seletor de arquivo da Global — mesmo fluxo do botão "Global MTT" da nav
    document.getElementById('fileInputGlobal')?.click();
  });
  bar.querySelector('#globalRefreshDismiss').addEventListener('click', (e) => {
    e.stopPropagation(); // só dispensa, sem abrir o seletor de arquivo
    bar.remove();
  });
  document.body.appendChild(bar);
}

/* progresso de resultados fechados: quantos dos torneios "relevantes" (mustFix — Main/Satélite/Side marcado)
   já têm premiação lançada (fecharam), sobre o total do dia. Side Event sem marcação não entra no total,
   senão o denominador fica artificialmente alto com torneios que nunca foram prioridade de acompanhar. */
/* progresso de resultados fechados: quantos dos torneios "relevantes" (mustFix — Main/Satélite/Side marcado)
   já têm premiação lançada (fecharam), sobre o total do dia. Mostrado como texto discreto ao lado da
   descrição da seção — Side Event sem marcação não entra no total, senão o denominador fica artificialmente
   alto com torneios que nunca foram prioridade de acompanhar. */
function updateResultsProgress(){
  const el = document.getElementById('resultsProgressInline');
  if (!el) return;
  if (!RAW_ROWS.length){ el.textContent = ''; return; }
  const relevant = RAW_ROWS.filter(r => mustFix(r, classify(r)));
  const total = relevant.length;
  if (total === 0){ el.textContent = ''; return; }
  const done = relevant.filter(r => r.premiacao !== null && r.premiacao !== undefined).length;
  el.textContent = `· ${done}/${total} fechados`;
}

/* migra o trabalho já feito (fix, ID, field, garantido, premiação) quando um re-upload do MESMO dia
   muda a chave de um torneio — rowKey depende de nome|hora|buyin|garantido, então uma GU com garantido
   corrigido (ou buy-in reformatado) trocava a chave e o painel "esquecia" quem já estava fixado,
   marcando tudo de novo como atrasado. O casamento é por nome+hora e só acontece quando é inequívoco
   (exatamente 1 candidato de cada lado), pra nunca migrar pro torneio errado. */
function migrateOrphanedWork(newRows){
  if (!RAW_ROWS.length || !newRows?.length) return 0;
  const ident = r => `${String(r.nome||'').trim().toUpperCase()}|${r.hora||''}|${r.proxCronograma?'px':''}`;
  const newByIdent = new Map();
  newRows.forEach(r => newByIdent.set(ident(r), newByIdent.has(ident(r)) ? null : r)); // null = ambíguo
  const oldByIdent = new Map();
  RAW_ROWS.forEach(r => oldByIdent.set(ident(r), oldByIdent.has(ident(r)) ? null : r));
  const newKeys = new Set(newRows.map(r => rowKey(r)));
  let premLocal = {};
  try{ premLocal = JSON.parse(localStorage.getItem('suprema_prem_v1')||'{}'); }catch(e){}
  let migrated = 0;
  oldByIdent.forEach((oldRow, k) => {
    if (!oldRow) return;                    // nome+hora duplicado no quadro antigo — ambíguo, não arrisca
    const oldKey = oldRow._key;
    if (newKeys.has(oldKey)) return;        // a chave sobreviveu ao re-upload, nada a migrar
    const target = newByIdent.get(k);
    if (!target) return;                    // sem correspondente único no quadro novo
    const newKey = rowKey(target);
    if (newKey === oldKey) return;
    const hadWork = FIXED_MAP[oldKey] != null || ID_MAP[oldKey] != null || FIELD_MAP[oldKey] != null ||
                    GARANTIDO_MAP[oldKey] != null || oldRow.premiacao != null;
    if (!hadWork) return;
    [[FIXED_MAP,'fixed'], [ID_MAP,'ids'], [FIELD_MAP,'field'], [GARANTIDO_MAP,'garantido']].forEach(([map, node]) => {
      if (map[oldKey] == null || map[newKey] != null) return;
      map[newKey] = map[oldKey]; delete map[oldKey];
      if (fbReady && fbDb){
        try{
          fbDb.ref(`${FB_BASE_PATH}/${node}/${newKey}`).set(map[newKey]);
          fbDb.ref(`${FB_BASE_PATH}/${node}/${oldKey}`).remove();
        }catch(e){}
      }
    });
    // premiação vive na própria row + nó próprio no Firebase + backup local
    if (oldRow.premiacao != null){
      if (target.premiacao == null) target.premiacao = oldRow.premiacao;
      if (premLocal[oldKey] != null && premLocal[newKey] == null){ premLocal[newKey] = premLocal[oldKey]; delete premLocal[oldKey]; }
      if (fbReady && fbDb){
        try{
          fbDb.ref(`${FB_BASE_PATH}/premiacao/${newKey}`).set(oldRow.premiacao);
          fbDb.ref(`${FB_BASE_PATH}/premiacao/${oldKey}`).remove();
        }catch(e){}
      }
    }
    migrated++;
  });
  if (migrated){
    saveFixedMapLocal(FIXED_MAP); saveIdMapLocal(ID_MAP); saveFieldMapLocal(FIELD_MAP); saveGarantidoMapLocal(GARANTIDO_MAP);
    try{ localStorage.setItem('suprema_prem_v1', JSON.stringify(premLocal)); }catch(e){}
  }
  return migrated;
}

/* Re-sincroniza a premiação salva no Firebase com as linhas recém-carregadas.
   Sem isto havia uma corrida de ORDEM: o listener de premiação podia disparar ANTES
   de a planilha existir (RAW_ROWS vazio) — os valores não tinham em qual linha entrar
   e o .on('value') não re-dispara só porque a planilha chegou depois. Resultado: o
   painel mostrava "0 fechados" mesmo com as premiações salvas e com as chaves certas.
   Chamado ao fim de todo ingest (carregou planilha → puxa a premiação de novo). */
function resyncPremiacaoFromFirebase(){
  whenAuthed(() => {
    if(!fbReady || !fbDb || !RAW_ROWS.length) return;
    fbDb.ref(`${FB_BASE_PATH}/premiacao`).once('value').then(s => {
      const data = s.val() || {};
      let ch = false;
      RAW_ROWS.forEach(r => {
        if(data[r._key] != null && r.premiacao !== data[r._key]){ r.premiacao = data[r._key]; ch = true; }
      });
      const applyRerender = () => {
        RESULTS  = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
        UPCOMING = [...RAW_ROWS];
        UNFIXED  = computeUnfixed();
        const el = document.getElementById('statUnfixed'); if(el) el.textContent = UNFIXED.length;
        computeStats(); updateProgress(); renderResults();
        if(!isTypingInCard() && !window._suppressRenderUpcoming) renderUpcoming();
      };
      if(ch) applyRerender();
      // RESGATE POR SNAPSHOT: uma grade nova subida no meio do dia muda o rowKey (depende de
      // garantido/buy-in) e orfana as premiações já preenchidas (guardadas sob a chave antiga) →
      // "R$ 0 / 0 fechados". O snapshot automático (snapshots/<data>) guarda cada torneio com
      // nome+hora+premiacao: reatamos pela identidade estável e RE-GRAVAMOS na chave nova pra
      // persistir (não some no próximo F5). Só roda quando ainda há linhas órfãs, casamento
      // nome+hora inequívoco (1 candidato de cada lado), e nunca sobrescreve valor já preenchido.
      recoverPremiacaoFromSnapshot(applyRerender);
    }).catch(()=>{});
  });
}

function recoverPremiacaoFromSnapshot(applyRerender){
  if(!fbReady || !fbDb || !RAW_ROWS.length) return;
  const orphans = RAW_ROWS.filter(r => r.premiacao == null && !r.explicitNF);
  if(!orphans.length) return; // nada órfão → não busca snapshot (economiza banda)
  const date = (FB_BASE_PATH.split('/')[1]) || todayPathSP();
  const norm = (nome, hora) => `${String(nome||'').trim().toUpperCase()}|${hora||''}`;
  fbDb.ref(`snapshots/${date}`).once('value').then(s => {
    const snap = s.val();
    if(!snap || !snap.rows) return;
    const snapRows = Array.isArray(snap.rows) ? snap.rows : Object.values(snap.rows);
    // índice nome+hora → premiação do snapshot; marca ambíguos (mesma identidade repetida) como null
    const byIdent = new Map();
    snapRows.forEach(sr => {
      if(sr.premiacao == null) return;
      const id = norm(sr.nome, sr.hora);
      byIdent.set(id, byIdent.has(id) ? null : sr.premiacao);
    });
    if(!byIdent.size) return;
    // linhas atuais com identidade duplicada também são ambíguas → não arrisca
    const curCount = new Map();
    RAW_ROWS.forEach(r => { const id = norm(r.nome, r.hora); curCount.set(id, (curCount.get(id)||0)+1); });
    let recovered = 0;
    orphans.forEach(r => {
      const id = norm(r.nome, r.hora);
      if(curCount.get(id) !== 1) return;      // duplicado no quadro atual → ambíguo
      const val = byIdent.get(id);
      if(val == null) return;                 // sem match único no snapshot
      r.premiacao = val; recovered++;
      try{ const pm = JSON.parse(localStorage.getItem('suprema_prem_v1')||'{}'); pm[r._key] = val; localStorage.setItem('suprema_prem_v1', JSON.stringify(pm)); }catch(e){}
      // re-grava na CHAVE NOVA pra persistir (a antiga fica órfã, inofensiva; a reconciliação
      // por SEEN não a anula porque a chave nova nunca "sumiu" do nó)
      try{ fbDb.ref(`${FB_BASE_PATH}/premiacao/${r._key}`).set(val); }catch(e){}
    });
    if(recovered){
      logActivity(`♻️ ${recovered} premiaç${recovered>1?'ões':'ão'} reatada${recovered>1?'s':''} do snapshot após a grade nova (vínculo restaurado por nome+hora)`, '💾');
      if(typeof applyRerender === 'function') applyRerender();
    }
  }).catch(()=>{});
}

/* =========================================================================
   TORNEIOS MANUAIS — adicionar evento que não está na Global
========================================================================= */

/* identidade estável de um torneio (mesma usada no resgate de premiação):
   nome+hora. NÃO usar rowKey aqui — o hash inclui garantido/buy-in, que mudam. */
function manualIdent(r){
  return `${String(r?.nome || '').trim().toUpperCase()}|${r?.hora || ''}`;
}

/* Funde os torneios manuais na planilha. Idempotente: se o torneio já existe na grade
   (mesmo nome+hora), NÃO duplica — cobre tanto o reingest do conjunto já publicado quanto
   o caso do evento manual entrar na Global depois (aí a planilha vence e o manual some da
   lista sem virar linha dupla). */
function mergeManualRows(rows){
  const manuais = Object.values(MANUAL_ROWS || {}).filter(m => m && m.nome);
  if (!manuais.length) return rows;
  const jaTem = new Set(rows.map(manualIdent));
  const extras = manuais.filter(m => !jaTem.has(manualIdent(m)));
  return extras.length ? rows.concat(extras) : rows;
}

/* Republica a grade (planilha + manuais) pro Firebase. É isto que faz o torneio manual
   aparecer pro parceiro E na auditoria do admin (que lê painel/<data>/sheet.rows). */
function publishGradeComManuais(){
  if (!LAST_SHEET_ROWS.length) return;         // sem planilha carregada não há o que publicar
  setSharedSheet(mergeManualRows(LAST_SHEET_ROWS), LAST_SHEET_FILENAME);
}

/* Reprocessa a grade a partir da planilha pura + manuais atuais (sem republicar). */
function reingestComManuais(){
  if (!LAST_SHEET_ROWS.length) return;
  ingest(LAST_SHEET_ROWS.slice(), LAST_SHEET_FILENAME, /*fromRemote=*/true);
}

/* Monta a row do torneio manual com a MESMA forma de uma linha parseada da planilha
   (ver o out.push do parser) — qualquer campo faltando aqui vira `undefined` lá na frente. */
function buildManualRow({nome, hora, garantido, buyin, tipo}){
  return {
    nome: String(nome).trim(),
    hora: hora || null,
    late: null,
    garantido: garantido != null ? garantido : null,
    buyin: buyin != null ? buyin : null,
    premiacao: null,
    premFromSheet: false,
    explicitNF: false,
    overlay: null,
    field: null,
    acoes: null,
    perf: null,
    check: null,
    tipo: tipo || null,          // vazio => classify() deduz por nome/garantido
    highlighted: false,
    _manual: true,               // marca a origem (separa a planilha pura no ingest)
    _by: (typeof OPERATOR_NAME !== 'undefined' && OPERATOR_NAME) ? OPERATOR_NAME : '',
    _at: Date.now(),
  };
}

/* Adiciona um torneio manual. Grava no nó próprio, funde na grade e republica. */
async function addManualTournament(dados){
  if (roGuard()) return;
  const row = buildManualRow(dados);
  const id = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  MANUAL_ROWS[id] = row;                       // otimista: a UI responde na hora
  reingestComManuais();
  publishGradeComManuais();
  renderManualList();
  if (fbReady && fbDb) {
    try { await fbDb.ref(`${FB_BASE_PATH}/manualRows/${id}`).set(row); }
    catch(e){
      delete MANUAL_ROWS[id];                  // não conseguiu gravar → desfaz pra não mentir
      reingestComManuais(); renderManualList();
      throw e;
    }
  }
  logActivity(`➕ <b>${escHtml(row._by || 'Alguém')}</b> adicionou o torneio manual <b>${escHtml(row.nome)}</b> (${escHtml(row.hora || '--:--')})`, '➕');
  return id;
}

/* Remove um torneio manual (adicionado por engano). O trabalho já feito no card
   (premiação/ID/fixado) fica órfão no Firebase, inofensivo — a linha some da grade. */
async function removeManualTournament(id){
  if (roGuard()) return;
  const row = MANUAL_ROWS[id];
  if (!row) return;
  delete MANUAL_ROWS[id];
  reingestComManuais();
  publishGradeComManuais();
  renderManualList();
  if (fbReady && fbDb) {
    try { await fbDb.ref(`${FB_BASE_PATH}/manualRows/${id}`).remove(); } catch(e){}
  }
  logActivity(`➖ Torneio manual <b>${escHtml(row.nome)}</b> removido da grade`, '➖');
}

function ingest(rows, filename, fromRemote=false){
  // Proteção: ignorar sheets com menos de 5 torneios (provavelmente corrompida ou parcial)
  if(!rows || rows.length < 5){
    console.warn('ingest: sheet ignorada (menos de 5 rows)', rows?.length);
    return;
  }
  // Torneios manuais entram AQUI e daqui pra frente são indistinguíveis dos da planilha.
  // Guardamos a planilha PURA (sem manuais) como base: o `rows` que chega pode já vir com os
  // manuais dentro (o setSharedSheet publica o conjunto fundido, e o parceiro reingere isso).
  // Separar por `_manual` mantém o merge idempotente — não duplica e não cresce a cada ciclo.
  if (filename) LAST_SHEET_FILENAME = filename;
  LAST_SHEET_ROWS = rows.filter(r => !(r && r._manual));
  rows = mergeManualRows(LAST_SHEET_ROWS);

  // re-upload do mesmo dia com valores ajustados: transfere o trabalho já feito pras chaves novas
  const _migrated = migrateOrphanedWork(rows);
  if (_migrated) logActivity(`♻️ Re-upload: ${_migrated} torneio${_migrated>1?'s':''} já trabalhado${_migrated>1?'s':''} tiveram o vínculo preservado (fix/ID/valores migrados pra planilha nova)`);
  RAW_ROWS = rows.map(r => ({...r, _key: rowKey(r)}));
  reindexRows();
  // planilha carregada → re-puxa a premiação salva no Firebase (corrige a corrida de ordem)
  resyncPremiacaoFromFirebase();
  // Persistir sheet + dados dos cards no localStorage (restauração imediata ao recarregar)
  try {
    const storeKey = 'suprema_sheet_v1_' + todayPathSP();
    if(!rows || rows.length < 5) return; // não salvar sheet corrompida
    localStorage.setItem(storeKey, JSON.stringify({
      rows, filename, savedAt: Date.now(),
      // Snapshot dos dados preenchidos nos cards no momento do save
      premiacaoMap: {...(JSON.parse(localStorage.getItem('suprema_prem_v1') || '{}'))},
      fieldMap:     {...FIELD_MAP},
      idMap:        {...ID_MAP},
      garantidoMap: {...GARANTIDO_MAP},
    }));
    // Limpar dias antigos
    const yesterday = (() => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
    for(let i=localStorage.length-1; i>=0; i--){
      const k = localStorage.key(i);
      if(k && k.startsWith('suprema_sheet_v1_') && k !== storeKey && !k.includes(yesterday))
        localStorage.removeItem(k);
    }
  } catch(e){}

  RESULTS = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
  UPCOMING = [...RAW_ROWS];

  // não fixado: só eventos que precisam ser fixados (mustFix), dentro da janela de antecedência por categoria,
  // ou marcados explicitamente (NF / status aguardando). Um checkbox marcado manualmente tira o evento daqui sempre.
  UNFIXED = computeUnfixed();

  // publica a planilha pro Firebase só quando o upload foi feito NESTE navegador — quando a planilha chegou
  // do parceiro (fromRemote=true) não republica, senão os dois ficariam reenviando um pro outro em loop
  if (!fromRemote) setSharedSheet(rows, filename);

  // pré-preenche o display de horário com o relógio atual de Brasília (sem ativar o filtro automaticamente)
  const tfDisplayTextEl = document.getElementById('tfDisplayText');
  if (tfDisplayTextEl && tfDisplayTextEl.textContent === '--:--'){
    tfDisplayTextEl.textContent = minutesToHHMM(nowMinutesSP());
  }

  document.getElementById('emptyState').hidden = true;
  document.getElementById('heroStats').hidden = false;
  document.getElementById('heroEyebrow').classList.remove('empty');
  document.getElementById('heroEyebrowText').textContent = filename ? `Painel atualizado — ${filename}` : 'Painel atualizado';
  document.getElementById('heroSub').textContent = `${rows.length} torneios carregados — ${RESULTS.length} já fechados, ${UPCOMING.length} na agenda.`;

  computeStats();
  renderUnfixed();
  renderUpcoming();
  renderResults();

  document.getElementById('footerMeta').textContent = `${rows.length} TORNEIOS · ARQUIVO: ${(filename||'').toUpperCase()}`;

  // reveal sections that may have been hidden (first upload) or refresh content already visible (re-upload)
  [document.querySelector('#nao-fixados'), document.querySelector('#agenda'), document.querySelector('#resultados')].forEach(sec=>{
    if (!sec) return;
    sec.querySelectorAll('.reveal').forEach(el=>{
      if (el.classList.contains('in')) return; // already visible, keep as-is on re-upload
      io.observe(el);
    });
  });
}

function renderOverlayChart(){
  const container = document.getElementById('overlayChart');
  if(!container) return;
  const closed = RESULTS.filter(r => r.premiacao != null && r.garantido != null);
  if(!closed.length){ container.hidden = true; return; }

  const DAY_START = 5*60;
  const sorted = [...closed].sort((a,b)=>{
    const ma = timeToMinutes(a.hora)??9999, mb = timeToMinutes(b.hora)??9999;
    return (ma>=DAY_START?ma:ma+1440) - (mb>=DAY_START?mb:mb+1440);
  });

  // Calcular overlay acumulado
  let acum = 0;
  const bars = sorted.map(r => {
    const ov = r.premiacao - r.garantido;
    acum += ov;
    return { nome: r.nome, hora: r.hora, ov, acum, cat: classify(r) };
  });

  const maxAbs = Math.max(...bars.map(b => Math.abs(b.acum)), 1);
  const hasOverlay = bars.some(b => b.acum < 0);

  container.hidden = false;
  container.innerHTML = `
    <div class="oc-title">
      Overlay acumulado no turno
      <span class="oc-total ${acum < 0 ? 'neg' : 'pos'}">${acum < 0 ? '– R$ '+fmtBRL(Math.abs(acum),0) : '+ R$ '+fmtBRL(acum,0)}</span>
    </div>
    <div class="oc-bars">
      ${bars.map((b,i) => {
        const pct = Math.round(Math.abs(b.acum) / maxAbs * 100);
        const isNeg = b.acum < 0;
        const color = isNeg ? 'var(--red)' : 'var(--felt-bright)';
        return `<div class="oc-bar-wrap" title="${b.nome} (${b.hora})
Overlay acum: ${b.acum>=0?'+':''}R$ ${fmtBRL(b.acum,0)}">
          <div class="oc-bar-track">
            <div class="oc-bar-fill" style="width:${pct}%;background:${color};opacity:${0.4+0.6*(i+1)/bars.length}"></div>
          </div>
          <div class="oc-bar-val ${isNeg?'neg':'pos'}">${b.acum>=0?'+':''}${fmtBRL(b.acum,0)}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="oc-legend">
      <span class="oc-leg pos">● Acima do GTD</span>
      <span class="oc-leg neg">● Com overlay</span>
    </div>
  `;
}

function computeStats(){
  // getGarantidoEffective respeita overrides manuais; exclui NF
  const garantidoTotal = RAW_ROWS.reduce((s,r) => {
    const id = getId(r._key);
    if(id.toUpperCase() === 'NF' || r.explicitNF) return s;
    return s + (getGarantidoEffective(r._key) || 0);
  }, 0);
  const premiacaoTotal = RESULTS.reduce((s,r)=> s + (r.premiacao||0), 0);
  // overlay total: usa a coluna "Overlay" da planilha quando preenchida manualmente; quando vazia mas
  // o torneio já tem Premiação e Garantido, calcula sozinho (Premiação − Garantido, só conta quando
  // negativo) — mesma regra já usada na performance de cada card, evitando sub-representar o overlay
  // real do dia só porque a coluna manual nem sempre é preenchida
  const overlayTotal = RAW_ROWS.reduce((s,r) => {
    if (r.overlay != null && r.overlay < 0) return s + r.overlay;
    if (r.overlay == null && r.garantido != null && r.garantido > 0 && r.premiacao != null){
      const calc = r.premiacao - r.garantido;
      if (calc < 0) return s + calc;
    }
    return s;
  }, 0);

  // count-up nos KPIs — anima do valor anterior até o novo em vez de trocar seco
  animateCount(document.getElementById('statGarantido'), garantidoTotal, fmtCompact);
  animateCount(document.getElementById('statPremiacao'), premiacaoTotal, v => "R$ " + fmtBRL(v, v % 1 !== 0 ? 2 : 0));
  animateCount(document.getElementById('statOverlay'), overlayTotal, v => Math.round(v) === 0 ? "R$ 0" : "– R$ " + fmtBRL(Math.abs(v), 2));
  document.getElementById('statOverlayWrap').classList.toggle('neg', overlayTotal < 0);
  document.getElementById('statUnfixed').textContent = UNFIXED.length;
  updateProgress();

  renderYesterdayComparison({garantidoTotal, premiacaoTotal, overlayTotal});
  renderFechoRings();

  // o diagnóstico olha exatamente o mesmo estado que acabou de virar número na tela;
  // pendurar aqui (com debounce) garante que ele nunca fique falando de dados velhos
  if(typeof scheduleDiagnostico === 'function') scheduleDiagnostico();
}

/* ── FECHO DO DIA (ref. getfluently, no registro de FERRAMENTA) ──
   Três anéis que respondem ao ESTADO (não ao scroll): Dia completo (fechados),
   Fixados e Saúde do dia (% dos fechados que bateram o GTD). Preenchem com
   transição quando os números mudam — mesma leitura periférica que a barra de
   progresso dava, agora de relance e com a saúde do overlay junto. ── */
var _fechoBuilt = false; // var (hoisted): renderFechoRings roda antes desta linha via restoreSheetFromLocal → ingest → computeStats
function fechoRingCard(tone, pct, val, unit, label){
  const R = 46, C = 2 * Math.PI * R;
  pct = Math.max(0, Math.min(1, pct || 0));
  return `<div class="fr-card t-${tone}">
    <svg class="fr-ring" viewBox="0 0 108 108" aria-hidden="true">
      <circle class="fr-bg" cx="54" cy="54" r="${R}"></circle>
      <circle class="fr-fg" cx="54" cy="54" r="${R}" style="--circ:${C.toFixed(1)};--pct:${pct.toFixed(3)}"></circle>
    </svg>
    <div class="fr-center"><b>${val}</b><span>${escHtml(unit)}</span></div>
    <div class="fr-label">${escHtml(label)}</div>
  </div>`;
}
function renderFechoRings(){
  const el = document.getElementById('fechoDia');
  const ringsEl = document.getElementById('fechoRings');
  if(!el || !ringsEl) return;
  const relevant = RAW_ROWS.filter(r => mustFix(r, classify(r)));
  const total = relevant.length;
  if(!total){ el.hidden = true; _fechoBuilt = false; return; }
  const fixados  = relevant.filter(r => isFixed(r._key)).length;
  const fechRows = relevant.filter(r => r.premiacao != null);
  const fechados = fechRows.length;
  // saúde: dos fechados, quantos bateram o garantido (sem GTD conta como ok)
  const bateram = fechRows.filter(r => r.garantido == null || r.premiacao >= r.garantido).length;
  const saude   = fechados ? bateram / fechados : 1;
  const rings = [
    { tone:'done',   pct: fechados/total, val:`${fechados}/${total}`, unit:'fechados', label:'Dia completo' },
    { tone:'fix',    pct: fixados/total,  val:`${fixados}/${total}`,  unit:'fixados',  label:'Fixados' },
    { tone:'health', pct: saude,          val:`${Math.round(saude*100)}%`, unit:'no GTD', label:'Saúde do dia' },
  ];
  el.hidden = false;
  if(!_fechoBuilt){
    // primeira montagem: nasce VAZIO (sem .in) e preenche no próximo frame
    ringsEl.innerHTML = rings.map(r => fechoRingCard(r.tone, r.pct, r.val, r.unit, r.label)).join('');
    _fechoBuilt = true;
    requestAnimationFrame(() => el.classList.add('in'));
  }else{
    // atualizações seguintes: só muda --pct e o valor → transição suave do compositor
    const cards = ringsEl.querySelectorAll('.fr-card');
    rings.forEach((r,i) => {
      const c = cards[i]; if(!c) return;
      const fg = c.querySelector('.fr-fg'); if(fg) fg.style.setProperty('--pct', r.pct.toFixed(3));
      const b = c.querySelector('.fr-center b'); if(b && b.textContent !== r.val) b.textContent = r.val;
      c.className = `fr-card t-${r.tone}`;
    });
  }
}

/* ── COACH DO DIA — os achados do motor de diagnóstico como cards que falam com
   o operador (não uma lista num drawer). Top 3 por severidade; sem achados e com
   o motor já carregado, mostra o card de "sob controle". ── */
function renderCoach(){
  const el = document.getElementById('fechoCoach');
  if(!el) return;
  if(!RAW_ROWS.length || typeof SupremaInsights === 'undefined'){ el.innerHTML = ''; return; }
  const ico = n => (window.SupremaMotion && SupremaMotion.icon) ? SupremaMotion.icon(n) : '';
  const ICO  = { critico:'alert-circle', atencao:'alert-tri', info:'info' };
  const TONE = { critico:'crit', atencao:'warn', info:'info' };
  const top = (DIAG_ACHADOS || []).slice(0, 3);
  if(!top.length){
    el.innerHTML = `<article class="cch-card t-ok">
      <span class="cch-ic">${ico('seal-check')}</span>
      <div class="cch-body"><b>Dia sob controle</b><p>Nenhum ponto de atenção agora — segue o jogo.</p></div>
    </article>`;
    return;
  }
  el.innerHTML = top.map(a =>
    `<article class="cch-card t-${TONE[a.sev]||'info'}">
      <span class="cch-ic">${ico(ICO[a.sev]||'info')}</span>
      <div class="cch-body"><b>${escHtml(a.titulo || '')}</b><p>${escHtml(a.acao || a.porque || '')}</p></div>
    </article>`).join('');
}

/* =========================================================================
   COMPARAÇÃO COM ONTEM — lê a planilha que ficou salva no Firebase do dia anterior
   (painel/AAAA-MM-DD/sheet, mesmo nó onde a planilha de hoje é salva) e recalcula as
   mesmas métricas, só pra comparar — não fica escutando em tempo real, é uma leitura
   única (.once) já que o dia anterior não muda mais. Se ninguém tiver subido planilha
   ontem (ou o painel for novo), os indicadores simplesmente não aparecem.
========================================================================= */
function yesterdayPathSP(){
  const n = nowInSP();
  const ref = new Date(Date.UTC(n.year, n.month-1, n.day, 12, 0, 0));
  ref.setUTCDate(ref.getUTCDate() - 1);
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth()+1).padStart(2,'0')}-${String(ref.getUTCDate()).padStart(2,'0')}`;
}
function loadYesterdayMetricsIfNeeded(){
  if (YESTERDAY_LOAD_STARTED || !fbReady) return;
  YESTERDAY_LOAD_STARTED = true;
  const path = `painel/${yesterdayPathSP()}/sheet`;
  fbDb.ref(path).once('value').then(snap => {
    const data = snap.val();
    if (!data || !data.rows || !data.rows.length){ YESTERDAY_METRICS = null; return; }
    const rows = data.rows;
    const garantidoTotal = rows.reduce((s,r)=> s + (r.garantido||0), 0);
    const premiacaoTotal = rows.filter(r => r.premiacao != null).reduce((s,r)=> s + (r.premiacao||0), 0);
    const overlayTotal = rows.reduce((s,r) => {
      if (r.overlay != null && r.overlay < 0) return s + r.overlay;
      if (r.overlay == null && r.garantido != null && r.garantido > 0 && r.premiacao != null){
        const calc = r.premiacao - r.garantido;
        if (calc < 0) return s + calc;
      }
      return s;
    }, 0);
    YESTERDAY_METRICS = {garantidoTotal, premiacaoTotal, overlayTotal};
    computeStats(); // reaplica agora que já temos os números de ontem pra comparar
  }).catch(() => { YESTERDAY_METRICS = null; });
}
/* mostra ↑/↓X% comparado a ontem; "flat" quando a diferença for desprezível (<1%) ou quando
   ontem não tinha valor base (divisão por zero não faz sentido aqui) */
function renderYesterdayComparison(today){
  loadYesterdayMetricsIfNeeded();
  const pairs = [
    ['cmpGarantido', today.garantidoTotal, YESTERDAY_METRICS?.garantidoTotal],
    ['cmpPremiacao', today.premiacaoTotal, YESTERDAY_METRICS?.premiacaoTotal],
    ['cmpOverlay', Math.abs(today.overlayTotal), Math.abs(YESTERDAY_METRICS?.overlayTotal || 0)],
  ];
  pairs.forEach(([elId, todayVal, yestVal]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!YESTERDAY_METRICS || yestVal == null || yestVal === 0){ el.hidden = true; return; }
    const diffPct = ((todayVal - yestVal) / yestVal) * 100;
    const isOverlay = elId === 'cmpOverlay'; // overlay: "subir" é ruim (mais prejuízo), inverte a cor
    el.hidden = false;
    if (Math.abs(diffPct) < 1){
      el.className = 'hstat-compare flat';
      el.textContent = '≈ igual a ontem';
    } else {
      const up = diffPct > 0;
      const good = isOverlay ? !up : up;
      el.className = `hstat-compare ${good ? 'up' : 'down'}`;
      el.textContent = `${up ? '↑' : '↓'} ${Math.abs(diffPct).toFixed(0)}% vs ontem`;
    }
  });
}

/* =========================================================================
   RENDER — Unfixed banner (top priority, baseado em hora real)
========================================================================= */
function renderUnfixed(){
  const section = document.getElementById('nao-fixados');
  const grid = document.getElementById('unfixedGrid');
  grid.querySelectorAll('.ucard').forEach(el => animVisibilityIO.unobserve(el)); // limpa observação antes de destruir os cards antigos
  grid.innerHTML = '';

  if (UNFIXED.length === 0){
    section.hidden = true;
    document.getElementById('statUnfixed').textContent = '0';
    return;
  }
  section.hidden = false;

  // ordena: atrasados primeiro, depois "em breve", depois o resto — por horário
  const withFlag = UNFIXED.map(r => ({row:r, cat: classify(r), flag: timeStatus(r.hora, classify(r))}));
  withFlag.sort((a,b)=>{
    const order = {late:0, soon:1, null:2};
    const oa = order[a.flag===null?'null':a.flag], ob = order[b.flag===null?'null':b.flag];
    if (oa !== ob) return oa - ob;
    return (timeToMinutes(a.row.hora) ?? 9999) - (timeToMinutes(b.row.hora) ?? 9999);
  });

  document.getElementById('unfixedCount').textContent = UNFIXED.length;

  const fragment = document.createDocumentFragment();

  // No modo compacto, não mostrar os ucards de flag
  if(!_compactMode){
  withFlag.forEach(({row:r, cat, flag}) => {
    const key = r._key;
    const card = document.createElement('div');
    card.className = `ucard${flag === 'late' ? ' is-late-pulse' : ''}`;
    card.dataset.key = key;
    const flagHtml = flag === 'late' || flag === 'soon'
      ? `<span class="time-flag ${flag}">${timeFlagMessage(r.hora, cat, flag)}</span>`
      : '';
    const crownHtml = cat === 'main' ? `<span class="crown" title="Main Event">${CROWN_SVG}</span>` : '';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span class="cat-pill" style="background:var(--${cat}-soft); color:var(--${cat})">${crownHtml}<span class="cat-suit">${CAT_SUIT[cat]}</span>${CAT_LABEL[cat]}</span>
        ${cat === 'side' && !r.highlighted && r.garantido >= 3000 ? `<span style="font-size:9px;font-weight:700;letter-spacing:.05em;padding:2px 7px;border-radius:99px;background:rgba(201,168,76,.12);color:var(--gold);border:1px solid rgba(201,168,76,.2)">GTD R$ ${fmtBRL(r.garantido)}</span>` : ''}
        ${r._manual ? `<span class="tcard-manual-badge" title="Torneio adicionado à mão — não veio da Global">MANUAL</span>` : ''}
        ${r.premiacao != null ? `<span class="tcard-prem-badge">✓ R$ ${fmtBRL(r.premiacao, r.premiacao % 1 === 0 ? 0 : 2)}</span>` : ''}
      </div>
      <div class="nm">${r.nome}</div>
      <div class="meta"><span>${r.hora || '—'}</span><span>${fmtBuyin(r.buyin)}</span>${r.garantido != null ? `<span style="color:var(--gold);font-size:11px">R$ ${fmtBRL(r.garantido)}</span>` : ''}</div>
      ${flagHtml}
      <div class="copy-row">
        <input type="text" class="id-input" placeholder="ID do evento" value="${getId(key)}" data-key="${key}">
        <button class="copy-btn" data-key="${key}" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          <span>Copiar</span>
        </button>
      </div>
      <span class="id-dup-warning" hidden></span>
      <label class="fix-check" style="margin-top:6px;">
        <input type="checkbox" data-key="${key}" class="fix-toggle">
        <span>Marcar como fixado</span>
      </label>
    `;
    fragment.appendChild(card);
  });
  } // fim if(!_compactMode)

  grid.appendChild(fragment);

  observeAnimatedCards(grid); // liga/desliga pulso de atrasado conforme entra/sai da tela
  wireCardInteractions(grid);
}

/* =========================================================================
   RENDER — Upcoming cards
========================================================================= */


function renderUpcoming(){
  const grid = document.getElementById('upcomingGrid');
  grid.querySelectorAll('.tcard').forEach(el => animVisibilityIO.unobserve(el)); // limpa observação antes de destruir os cards antigos
  grid.innerHTML = '';
  const nowMin = nowMinutesSP(); // usado pelo filtro "Rolando agora" e pra marcar cada card como em andamento (não mais usado na ordenação, que agora é cronológica fixa)
  // activeUpcomingCat é um Set — permite múltiplos filtros ativos ao mesmo tempo (ex.: Main Event + Satélite).
  // Um torneio passa se bater com QUALQUER filtro selecionado (OR entre os chips ativos).
  let filtered = activeUpcomingCat.has('all') ? UPCOMING : UPCOMING.filter(t => {
    const cat = classify(t);
    for (const c of activeUpcomingCat){
      if (c === 'running' && isRunningNow(t, nowMin)) return true;
      if (c === 'late' && cardTimeFlag(t) === 'late') return true;
      if (c === 'soon' && cardTimeFlag(t) === 'soon') return true;
      if (c === cat) return true;
    }
    return false;
  });

  // Filtro "Meus"/"Parceiro": quem mexeu no torneio (fixou, preencheu premiação/field ou ID).
  // _opFilter e upcomingPremFilter existiam como variáveis mas nunca eram aplicados no filtro de verdade.
  if (_opFilter !== 'all'){
    const me = (OPERATOR_NAME || '').trim().toLowerCase();
    filtered = filtered.filter(t => {
      const owner = cardResponsibleName(t._key).trim().toLowerCase();
      if (!owner) return false;
      return _opFilter === 'me' ? owner === me : owner !== me;
    });
  }
  if (upcomingPremFilter !== 'all'){
    filtered = filtered.filter(t => upcomingPremFilter === 'com' ? t.premiacao != null : t.premiacao == null);
  }
  if (upcomingCampFilter !== 'all'){
    filtered = filtered.filter(t => campanhaTipoDe(t) === upcomingCampFilter);
  }

  if (nameSearchQuery){
    // busca por nome: contém o termo digitado, sem diferenciar maiúsculas/minúsculas nem acentos
    // (assim "omax" acha "OmaX", "bounty" acha "Bounty" etc, sem precisar digitar igualzinho)
    const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const q = norm(nameSearchQuery);
    filtered = filtered.filter(t => {
      const n = norm(t.nome);
      return terms.every(term => n.includes(term));
    });
  }

  if (timeFilterMin !== null){
    // busca simples por horário de início: mostra só os torneios que começam EXATAMENTE no horário escolhido,
    // de qualquer categoria, fixados ou não — é um buscador, não uma lista de pendências
    // (quem precisa de aviso de atrasado/em breve já aparece separado no alerta vermelho "Não fixados" lá em cima)
    filtered = filtered.filter(t => timeToMinutes(t.hora) === timeFilterMin);
  }

  updateFilterSummary(filtered.length);

  const tfCount = document.getElementById('tfCount');
  if (timeFilterMin !== null){
    tfCount.hidden = false;
    tfCount.textContent = filtered.length === 0 ? 'nenhum' : `${filtered.length} torneio${filtered.length>1?'s':''}`;
    tfCount.classList.toggle('zero', filtered.length === 0);
  } else {
    tfCount.hidden = true;
  }

  if (filtered.length === 0){
    const catLabels = {running:'rolando agora', late:'atrasado', soon:'em breve', main:'Main Event', side:'Side Event', sat:'Satélite'};
    const isAllActive = activeUpcomingCat.has('all');
    const activeLabels = [...activeUpcomingCat].map(c => catLabels[c]).filter(Boolean);
    const catSuffix = isAllActive ? '' : activeLabels.length ? ` (${activeLabels.join(' + ')})` : ' nessa categoria';
    const hasStatusFilter = !isAllActive && [...activeUpcomingCat].some(c => c === 'running' || c === 'late' || c === 'soon');
    const msg = nameSearchQuery
      ? `Nenhum torneio com "${nameSearchQuery}" no nome${timeFilterMin !== null ? ` às ${minutesToHHMM(timeFilterMin)}` : ''}${catSuffix}.`
      : timeFilterMin !== null
        ? `Nenhum torneio começando às ${minutesToHHMM(timeFilterMin)}${catSuffix}.`
        : hasStatusFilter
          ? `Nenhum torneio${catSuffix} agora. 🎉`
          : `Nenhum torneio em aberto${catSuffix}.`;
    grid.innerHTML = `<div class="grid-cards-empty">${msg}</div>`;
    return;
  }

  // ordem do dia de trabalho: 00:00 → 23:59 (madrugada de hoje no topo), com os cards do
  // PRÓX. CRONOGRAMA sempre no FIM — eles são a madrugada do dia seguinte, vêm depois das 23h
  filtered = [...filtered].sort((a, b) => {
    const ma = (timeToMinutes(a.hora) ?? 9999) + (a.proxCronograma ? 1440 : 0);
    const mb = (timeToMinutes(b.hora) ?? 9999) + (b.proxCronograma ? 1440 : 0);
    return ma - mb;
  });

  // monta todos os cards num DocumentFragment (fora do DOM ativo) e insere tudo de uma vez no final —
  // evita um reflow/repaint por card (até ~117 com a planilha cheia), deixando a troca de filtro/busca
  // visivelmente mais rápida sem mudar nenhum pixel do resultado final
  const fragment = document.createDocumentFragment();
  let proxDividerAdded = false; // separador visual antes do primeiro card do PRÓX. CRONOGRAMA
  filtered.forEach((t, idx) => {
    const cat = classify(t);
    const needsFix = mustFix(t, cat);
    const key = t._key;
    const fixed = isFixed(key);
    const currentId = getId(key);
    const isNF = currentId.toUpperCase() === 'NF' || t.explicitNF;
    const flag = cardTimeFlag(t);
    const isRunning = isRunningNow(t, nowMin);
    // ── Modo compacto ──
    if(_compactMode){
      if(idx === 0){
        const wrap = document.createElement('div');
        wrap.className = 'compact-table-wrap';
        const tbl = document.createElement('table');
        tbl.className = 'compact-table';
        tbl.setAttribute('aria-label', 'Torneios em aberto (modo compacto)');
        tbl.innerHTML = '<caption class="sr-only">Torneios em aberto, modo compacto</caption>'
          + '<thead><tr>'
          + '<th scope="col" style="width:4px;padding:0"></th>'
          + '<th scope="col" style="min-width:200px">Torneio</th>'
          + '<th scope="col" style="width:65px;text-align:center">Hora</th>'
          + '<th scope="col" style="width:100px;text-align:right">GTD</th>'
          + '<th scope="col" style="width:120px">Premiação</th>'
          + '<th scope="col" style="width:100px;text-align:right">Overlay</th>'
          + '<th scope="col" style="width:80px">Field</th>'
          + '<th scope="col" style="width:132px">ID</th>'
          + '<th scope="col" style="width:36px;text-align:center">Fix</th>'
          + '</tr></thead><tbody id="compactTbody"></tbody>';
        wrap.appendChild(tbl);
        fragment.appendChild(wrap);
      }

      const tbody = fragment.querySelector('#compactTbody') || document.getElementById('compactTbody');
      if(!tbody) return;

      if (t.proxCronograma && !proxDividerAdded){
        proxDividerAdded = true;
        const divTr = document.createElement('tr');
        divTr.innerHTML = '<td colspan="9" style="padding:10px 8px 6px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#60a5fa;border-top:2px solid rgba(96,165,250,.35)">Próx. cronograma — madrugada de amanhã · somente fixação</td>';
        tbody.appendChild(divTr);
      }

      const premVal  = t.premiacao;
      const garVal   = t.garantido;
      const fieldVal = getField(key);
      const ovc      = calcOverlay(premVal, garVal);
      const catColor = cat==='main'?'var(--main-bright)':cat==='sat'?'var(--sat-bright)':'var(--side-bright)';
      const premFmt  = premVal != null ? fmtBRL(premVal, premVal%1===0?0:2) : '';
      const ovCls    = ovc!=null?(ovc<0?' neg':' pos'):'';
      const ovTxt    = ovc!=null?fmtOverlay(ovc):'\u2014';

      const tr = document.createElement('tr');
      tr.dataset.key = key;
      if(fixed) tr.classList.add('is-fixed');
      if(isNF)  tr.classList.add('is-nf');

      const catTd   = '<td style="width:4px;padding:0"><span class="ctr-cat-bar" style="background:'+catColor+'"></span></td>';
      const nomeTd  = '<td class="ctr-nome" title="'+escHtml(t.nome||'')+'">'+escHtml(t.nome||'\u2014')
                    + (t._manual ? ' <span class="tcard-manual-badge" title="Adicionado \u00e0 m\u00e3o \u2014 n\u00e3o veio da Global">MANUAL</span>' : '')
                    + (t.proxCronograma ? ' <span style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;background:rgba(96,165,250,.14);color:#60a5fa;letter-spacing:.04em">PR\u00d3X. CRONOGRAMA</span>' : '')
                    + '</td>';
      const horaTd  = '<td class="ctr-hora">'+(t.hora||'\u2014')+'</td>';
      const garTd   = '<td class="ctr-gar">'+(garVal!=null?'R$'+fmtBRL(garVal,0):'\u2014')+'</td>';
      // card do pr\u00f3ximo cronograma: s\u00f3 fixa\u00e7\u00e3o \u2014 premia\u00e7\u00e3o/field pertencem ao quadro do dia seguinte
      const soFixar = '<td style="padding:3px 5px;color:var(--ink-soft);font-size:11px;font-style:italic" title="Evento do pr\u00f3ximo cronograma \u2014 premia\u00e7\u00e3o e field entram no quadro do pr\u00f3ximo dia">s\u00f3 fixar</td>';
      const premTd  = t.proxCronograma ? soFixar
                    : '<td style="padding:3px 5px"><input class="ctr-inp tcard-prem-input'+(premVal!=null?' has-value':'')+'"'
                    + ' data-key="'+key+'" type="text" inputmode="decimal"'
                    + ' placeholder="R$ \u2014" value="'+premFmt+'"'
                    + ' oninput="onCardPremiacaoInput(this)"'
                    + ' onblur="formatPremInput(this)" onfocus="this.select()"></td>';
      const ovTd    = t.proxCronograma ? '<td class="ctr-ov" id="tci-ov-'+key+'">\u2014</td>'
                    : '<td class="ctr-ov'+ovCls+'" id="tci-ov-'+key+'">'+ovTxt+'</td>';
      const fieldTd = t.proxCronograma ? '<td style="padding:3px 5px;color:var(--ink-soft)">\u2014</td>'
                    : '<td style="padding:3px 5px"><input class="ctr-inp tcard-field-input"'
                    + ' data-key="'+key+'" type="number" min="0"'
                    + ' placeholder="\u2014" value="'+(fieldVal!=null?fieldVal:'')+'"></td>';
      const idTd    = '<td style="padding:3px 5px"><div style="display:flex;gap:4px;align-items:center">'
                    + '<input class="ctr-inp-id id-input'+(currentId?' has-value':'')+'" style="flex:1;min-width:0"'
                    + ' data-key="'+key+'" type="text"'
                    + ' placeholder="ID" value="'+escHtml(currentId)+'">'
                    + '<button class="copy-btn ctr-copy-btn" data-key="'+key+'" type="button" title="Copiar dados do torneio">'
                    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
                    + '</button></div></td>';
      // Side Event que não precisa ser fixado (needsFix=false): mostra o checkbox já "marcado"
      // visualmente, mas esmaecido e desabilitado — não é uma marcação real de responsabilidade,
      // só indica que não há nada pra fazer aqui.
      const fixTd   = needsFix
        ? '<td style="text-align:center;padding:3px"><input type="checkbox" class="fix-toggle"'+(fixed?' checked':'')
          + ' data-key="'+key+'" style="width:15px;height:15px;accent-color:var(--felt);cursor:pointer"></td>'
        : '<td style="text-align:center;padding:3px"><input type="checkbox" checked disabled'
          + ' title="Não precisa ser fixado" style="width:15px;height:15px;accent-color:var(--ink-soft);opacity:.4;cursor:default"></td>';
      tr.innerHTML = catTd+nomeTd+horaTd+garTd+premTd+ovTd+fieldTd+idTd+fixTd;
      tbody.appendChild(tr);
      return;
    }

    if (t.proxCronograma && !proxDividerAdded){
      proxDividerAdded = true;
      const divider = document.createElement('div');
      divider.style.cssText = 'grid-column:1/-1;padding:14px 4px 4px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#60a5fa;border-top:2px solid rgba(96,165,250,.35);margin-top:8px';
      divider.textContent = 'Próx. cronograma — madrugada de amanhã · somente fixação';
      fragment.appendChild(divider);
    }
    const el = document.createElement('div');
    el.className = `tcard reveal${fixed ? ' is-fixed' : ''}${isNF ? ' is-nf' : ''}${flag==='soon' ? ' is-soon' : ''}${flag==='late' ? ' is-late' : ''}${isRunning ? ' is-running' : ''}`;
    el.dataset.key = key;
    el.style.setProperty('--cat-bright', `var(--${cat}-bright)`);
    // entrada escalonada (cascata), tipo Apple — limitada aos primeiros 18 cards pra não atrasar a lista inteira
    // quando há muitos torneios; os demais entram juntos logo em seguida
    el.style.transitionDelay = `${Math.min(idx, 18) * 28}ms`;
    const flagHtml = flag === 'late' || flag === 'soon'
      ? `<span class="time-flag ${flag}">${timeFlagMessage(t.hora, cat, flag)}</span>`
      : '';
    const runningHtml = isRunning ? `<span class="time-flag running">${MINI_CHIP_SVG} Rolando agora</span>` : '';
    const notNeededHtml = (!needsFix && !fixed)
      ? `<span class="time-flag not-needed">Não selecionado para fixar</span>`
      : '';
    const crownHtml = cat === 'main' ? CROWN_SVG : '';
    const cardNowMin = nowMinutesSP();
    const evMin = opMinutes(timeToMinutes(t.hora)); // relógio operacional: madrugada = fim do dia da grade
    let countdownHtml = '';
    if(evMin !== null && !fixed){
      const diff = evMin - (opMinutes(cardNowMin) - 1440 * gradeDaysAhead()); // desconta grade adiantada (dia seguinte carregado cedo)
      const absDiff = Math.abs(diff);
      if(diff > 0 && diff <= 120){
        const h = Math.floor(absDiff/60), m = absDiff%60;
        const label = h > 0 ? `${h}h ${m}min` : `${m}min`;
        countdownHtml = `<span class="tcard-countdown soon" data-evmin="${evMin}">falta ${label}</span>`;
      } else if(diff < 0 && diff >= -180){
        countdownHtml = `<span class="tcard-countdown late" data-evmin="${evMin}">há ${Math.floor(absDiff/60) > 0 ? Math.floor(absDiff/60)+'h ' : ''}${absDiff%60}min</span>`;
      }
    }
    const nfBannerHtml = isNF ? `
      <div class="tcard-nf-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        Não formou
      </div>` : '';
    const nfBadgeHtml = isNF ? `<span class="tcard-nf-badge">NF</span>` : '';
    el.innerHTML = `
      ${nfBannerHtml}
      <div class="tcard-top">
        <div>
          <div class="tcard-name-row">${crownHtml}<div class="tcard-name">${t.nome}</div>${nfBadgeHtml}${t._manual ? '<span class="tcard-manual-badge" title="Torneio adicionado à mão — criado às pressas, não veio da Global">MANUAL</span>' : ''}${t.proxCronograma ? '<span class="tcard-campanha-badge" style="background:rgba(96,165,250,.14);color:#60a5fa" title="Evento da madrugada — pertence à seção do próximo dia na Global, fixar com antecedência (late register)">PRÓX. CRONOGRAMA</span>' : ''}${buildHistTooltip(t.nome)}</div>
          <span class="cat-tag ${cat}"><span class="cat-suit">${CAT_SUIT[cat]}</span>${CAT_LABEL[cat]}</span>
          ${runningHtml}${flagHtml}${notNeededHtml}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <div class="tcard-time">${t.hora || '—'}</div>
          ${countdownHtml}
        </div>
      </div>
      <div class="tcard-grid">
        <div class="tcard-field">
          <div class="k">Garantido</div>
          <div class="v gold">${getGarantidoEffective(key) != null ? 'R$ '+fmtBRL(getGarantidoEffective(key)) : (t.garantido!=null ? 'R$ '+fmtBRL(t.garantido) : '—')}</div>
        </div>
        <div class="tcard-field"><div class="k">Buy-in</div><div class="v">${fmtBuyin(t.buyin)}</div></div>
      </div>
      ${(()=>{
  if(!t.late) return '';
  const lateMin = timeToMinutes(t.late);
  const nowM = nowMinutesSP();
  const diff = lateMin != null ? lateMin - nowM : null;
  const showTimer = diff != null && diff >= 0 && diff <= 60;
  return `<div class="tcard-late" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    Late até <b>${t.late}</b>
    ${showTimer ? `<span class="late-timer${diff<=5?' urgent':''}" data-latemin="${lateMin}"><span class="late-timer-icon">⏱</span> fecha em ${diff}min</span>` : ''}
  </div>`;
})()}
      ${t.proxCronograma ? `
      <!-- Card do próximo cronograma: SÓ fixação — premiação/field pertencem ao dia seguinte
           e serão preenchidos no quadro dele, senão os dados cairiam no nó do dia errado -->
      <div class="tcard-late" style="opacity:.75">Somente fixação — premiação e field entram no quadro do próximo dia.</div>
      ` : `
      <!-- Campos operacionais: Premiação + Field -->
      <div class="tcard-op-fields">
        <div class="tcard-op-field">
          <label class="tcard-prem-label">Premiação (R$)</label>
          <input type="text" inputmode="decimal" placeholder="—" class="tcard-prem-input" data-key="${key}"
            value="${t.premiacao != null ? fmtBRL(t.premiacao, t.premiacao % 1 === 0 ? 0 : 2) : ''}"
            oninput="onCardPremiacaoInput(this)"
            onfocus="this.select()"
            onblur="formatPremInput(this)">
          ${hasCampanha(t) ? `<span class="tcard-campanha-badge">#AS</span>` : ''}
        </div>
        <div class="tcard-op-field">
          <label class="tcard-prem-label">Field (jogadores)</label>
          <input type="number" step="1" min="0" placeholder="—" class="tcard-field-input" data-key="${key}"
            value="${getField(key) || ''}"
            oninput="onCardFieldInput(this)">
        </div>
      </div>
      <!-- Preview calculado: overlay, ações, performance -->
      <div class="tcard-overlay-preview" id="tcard-ov-${key}"></div>`}
      <div class="copy-row">
        <input type="text" class="id-input" placeholder="ID do evento" value="${getId(key)}" data-key="${key}">
        <button class="copy-btn" data-key="${key}" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          <span>Copiar</span>
        </button>
      </div>
      <span class="id-dup-warning" hidden></span>
      <div class="tcard-status-row">
        <label class="fix-check">
          <input type="checkbox" data-key="${key}" class="fix-toggle" ${fixed ? 'checked' : ''}>
          <span>${fixed ? (fixedBy(key) ? `Fixado por ${fixedBy(key)}${fixedAt(key) ? ` · <span class="fixed-at">${fixedAt(key)}</span>` : ''}` : 'Fixado') : 'Marcar como fixado'}</span>
        </label>
      </div>
    `;
    fragment.appendChild(el);
  });
  grid.appendChild(fragment);

  // dispara a transição de entrada (cascata) só DEPOIS que os cards já estão no DOM no estado "oculto" —
  // sem isso o navegador aplicaria opacity:1 direto, sem nenhuma transição visível
  requestAnimationFrame(() => {
    grid.querySelectorAll('.tcard.reveal').forEach(el => el.classList.add('in'));
  });

  observeAnimatedCards(grid); // liga/desliga pulso de atrasado/rolando agora conforme entra/sai da tela
  wireCardInteractions(grid);
}

/* liga inputs de ID, botões de copiar e checkboxes de fixado dentro de um container */
/* rastreia qual card está sob o mouse agora — usado pelo atalho de teclado F (marcar/desmarcar fixado)
   pra saber em qual torneio aplicar sem precisar de um sistema de foco/seleção mais complexo */
document.addEventListener('mouseover', (e) => {
  const card = e.target.closest('.tcard[data-key], .ucard[data-key]');
  HOVERED_CARD_KEY = card ? card.dataset.key : null;
});

function wireCardInteractions(container){
  container.querySelectorAll('.id-input').forEach(inp => {
    inp.addEventListener('blur', () => {
      const val = inp.value.trim();
      setId(inp.dataset.key, val);
      // atualiza visual de NF dinamicamente
      const card = inp.closest('.tcard');
      if(card){
        const isNF = val.toUpperCase() === 'NF';
        card.classList.toggle('is-nf', isNF);
        // atualiza ou cria o banner
        let banner = card.querySelector('.tcard-nf-banner');
        let badge = card.querySelector('.tcard-nf-badge');
        if(isNF && !banner){
          const b = document.createElement('div');
          b.className = 'tcard-nf-banner';
          b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Não formou`;
          card.prepend(b);
        } else if(!isNF && banner){ banner.remove(); }
        const nameRow = card.querySelector('.tcard-name-row');
        if(isNF && nameRow && !badge){
          const sp = document.createElement('span');
          sp.className = 'tcard-nf-badge'; sp.textContent = 'NF';
          nameRow.appendChild(sp);
        } else if(!isNF && badge){ badge.remove(); }
        // recalcula garantido total excluindo NF
        computeStats();
      } else {
        // modo compacto: não tem .tcard, mas a linha da tabela também precisa refletir o NF
        const tr = inp.closest('tr[data-key]');
        if(tr){
          tr.classList.toggle('is-nf', val.toUpperCase() === 'NF');
          computeStats();
        }
      }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ inp.blur(); }
    });
  });
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const row = rowByKey(key);
      if (!row) return;
      copyToClipboard(buildCopyText(row, key), btn);
    });
  });
  // field input — salva no Firebase ao sair do campo
  container.querySelectorAll('.tcard-field-input').forEach(inp => {
    inp.addEventListener('blur', () => setField(inp.dataset.key, inp.value.trim()));
    inp.addEventListener('keydown', e => { if(e.key === 'Enter') inp.blur(); });
  });
  container.querySelectorAll('.fix-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const key = chk.dataset.key;
      setFixed(key, chk.checked);
      // recomputa a lista de "Não fixados" na hora — é o que precisa voltar rápido quando
      // o operador desmarca por engano, pra não ficar confuso achando que não funcionou
      UNFIXED = computeUnfixed();
      document.getElementById('statUnfixed').textContent = UNFIXED.length;
      updateProgress();
      renderUnfixed();
      // Atualiza só o card/linha que mudou, sem reconstruir a agenda inteira — um renderUpcoming()
      // aqui fazia TODOS os cards refazerem o fade de entrada por causa de um único checkbox,
      // parecendo lento. patchCardFields cobre o card normal; modo compacto é uma linha de tabela.
      if(!patchCardFields(key)){
        document.querySelectorAll(`.compact-table tbody tr[data-key="${key}"]`).forEach(tr => {
          tr.classList.toggle('is-fixed', chk.checked);
        });
      }
    });
  });
  applyIdDuplicateChecks(); // marca duplicatas já existentes assim que os cards entram na tela
}

/* =========================================================================
   RENDER — Results list
========================================================================= */
/* filtro atual de Resultados (categoria + busca por nome) — extraído pra ser reutilizado tanto pela
   renderização na tela quanto pela exportação em planilha, garantindo que os dois sempre batam */
function getFilteredResults(){
  let filtered = activeResultsCat === 'all' ? RESULTS : RESULTS.filter(r => classify(r) === activeResultsCat);
  if (resultsNameSearchQuery){
    const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const q = norm(resultsNameSearchQuery);
    filtered = filtered.filter(r => norm(r.nome).includes(q));
  }
  return filtered;
}

function renderResults(){
  const list = document.getElementById('resultList');
  list.innerHTML = '';
  updateResultsProgress();

  const headRow = document.createElement('div');
  headRow.className = 'rrow head';
  headRow.innerHTML = `
    <div>Torneio</div>
    <div class="c-buyin">Buy-in</div>
    <div class="c-garantido">Garantido</div>
    <div>Premiação</div>
    <div class="c-late">Overlay</div>
    <div>Performance</div>
  `;
  list.appendChild(headRow);

  let filtered = getFilteredResults();

  if (filtered.length === 0){
    const msg = resultsNameSearchQuery
      ? `Nenhum resultado com "${resultsNameSearchQuery}" no nome${activeResultsCat !== 'all' ? ' nessa categoria' : ''}.`
      : `Nenhum resultado fechado${activeResultsCat !== 'all' ? ' nessa categoria' : ''} ainda.`;
    list.appendChild(Object.assign(document.createElement('div'), {className:'result-list-empty', textContent:msg}));
    return;
  }

  // mesma otimização da Agenda: monta as linhas fora do DOM ativo e insere tudo de uma vez
  const fragment = document.createDocumentFragment();
  filtered.forEach((r) => {
    const cat = classify(r);
    // performance sempre calculada por aqui: (premiação - garantido) / garantido — nunca usa a coluna
    // "PERF %" da planilha. Essa coluna vinha em formatos inconsistentes dependendo de como a célula foi
    // preenchida no Excel (fração vs número "pronto"), o que causava casos como 27,2% virando 2720%.
    // Calculando sempre a partir de Garantido/Premiação (números confiáveis e sem ambiguidade de formato),
    // o resultado é sempre correto.
    const hasNumbers = r.garantido != null && r.garantido !== 0 && r.premiacao != null;
    const pct = hasNumbers ? ((r.premiacao - r.garantido) / r.garantido) * 100 : 0;
    const isPos = pct >= 0;
    const clamped = Math.max(-100, Math.min(100, pct));
    const radius = 13;
    const circumference = 2 * Math.PI * radius;
    const ratio = Math.min(1, Math.abs(clamped) / 60);
    const offset = circumference * (1 - ratio);

    const row = document.createElement('div');
    row.className = 'rrow';
    const crownHtml = cat === 'main' ? CROWN_SVG : '';
    // responsável exibido: prioriza quem preencheu premiação/field (é quem de fato fechou o resultado);
    // cai pra quem marcou o "Fix" só se por algum motivo não houver premBy registrado (dado legado)
    const responsibleName = premBy(r._key) || fixedBy(r._key);
    const responsibleAt   = premBy(r._key) ? premByAt(r._key) : fixedAt(r._key);
    row.innerHTML = `
      <div class="nm">
        <div class="name-line"><span class="cat-suit-dot ${cat}">${CAT_SUIT[cat]}</span>${crownHtml}<span class="name">${r.nome}</span></div>
        <span class="who">${responsibleName
          ? `<span class="who-avatar">${responsibleName.charAt(0).toUpperCase()}</span><span class="who-name">${responsibleName}</span>${responsibleAt ? `<span class="who-sep">·</span><span class="fixed-at">${responsibleAt}</span>` : ''}`
          : '<span class="who-anon">Sem responsável</span>'}${r.field != null ? `<span class="who-sep">·</span>${fmtBRL(r.field,0)} jog.` : ''}${r.check ? `<span class="who-sep">·</span>check ${r.check}` : ''}</span>
      </div>
      <div class="cell dim c-buyin">${fmtBuyin(r.buyin)}</div>
      <div class="cell dim c-garantido">${r.garantido!=null ? 'R$ '+fmtBRL(r.garantido) : '—'}</div>
      <div class="cell gold">${r.premiacao!=null ? 'R$ '+fmtBRL(r.premiacao, 2) : '—'}</div>
      <div class="cell dim c-late">${r.overlay && r.overlay < 0 ? `<span class="badge-overlay">– R$ ${fmtBRL(Math.abs(r.overlay))}</span>` : '—'}</div>
      <div class="perf-wrap">
        ${hasNumbers ? `
        <svg class="perf-ring ${isPos ? '' : 'neg'}" viewBox="0 0 32 32">
          <circle class="bg" cx="16" cy="16" r="${radius}"></circle>
          <circle class="fg" cx="16" cy="16" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}" data-offset="${offset}"></circle>
        </svg>
        <span class="perf-pct ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${pct.toFixed(1)}%</span>
        ` : `<span class="perf-pct" style="color:var(--ink-soft)">—</span>`}
      </div>
    `;
    fragment.appendChild(row);
  });
  list.appendChild(fragment);

  // animate rings shortly after render
  requestAnimationFrame(()=>{
    list.querySelectorAll('.fg').forEach(c => {
      const offset = c.getAttribute('data-offset');
      setTimeout(()=>{ c.style.strokeDashoffset = offset; }, 60);
    });
  });
}

/* =========================================================================
   RELATÓRIO DE ACOMPANHAMENTO — agrupado por categoria, horário crescente.
   Formato: Main Events → Side Events → Satélites, cada grupo com cabeçalho
   colorido, totalizador de linha ao final de cada grupo, e sumário geral.
========================================================================= */
function calcAcoesForRow(row){
  const prem = row.premiacao;
  const field = row.field != null ? row.field : FIELD_MAP[row._key];
  if(field != null && field > 0) return parseFloat(field);
  if(!prem || !row.buyin) return null;
  const cat = classify(row);
  const rake = calcRake(row);
  const isCamp = hasCampanha(row);
  const rakeFactor2 = cat === 'main' ? 0.88 : cat === 'sat' ? 0.95 : (isCamp ? 0.88 : 0.9);
  const buyinLiq = parseFloat(row.buyin) * rakeFactor2;
  if(!buyinLiq) return null;
  return Math.round((prem / buyinLiq) * 10) / 10;
}

/* Cores e estilos por categoria */
const CAT_COLORS = {
  main: { header:'1A472A', sub:'2D6A4F', soft:'C8E6C9', font:'FFFFFF', label:'♠ MAIN EVENTS' },
  side: { header:'1A3A5C', sub:'2E5984', soft:'BBDEFB', font:'FFFFFF', label:'♣ SIDE EVENTS' },
  sat:  { header:'4A1A6B', sub:'6A2F9B', soft:'E1BEE7', font:'FFFFFF', label:'♦ SATÉLITES'  },
};
const COL_HEADERS = ['Torneio', 'Hora', 'Late Reg.', 'Tipo', 'Garantido', 'Buy-in', 'Premiação', 'Overlay', 'Field', 'Ações', 'Perf. %', 'Fixado por', 'ID', 'Status'];
const COL_WIDTHS  = [32, 7, 12, 13, 13, 11, 13, 12, 8, 8, 9, 18, 12, 11];

function buildRowData(r, dateLabel){
  const cat = classify(r);
  const prem = r.premiacao;
  const gar  = getGarantidoEffective(r._key) ?? r.garantido;  // override > planilha
  // Overlay = déficit real: só preenchido quando premiação < garantido (pool não atingiu o GTD)
  // Quando premiação >= garantido o evento superou o GTD — não há overlay, campo fica vazio
  const diff    = (prem != null && gar != null) ? prem - gar : null;
  const overlay = diff != null && diff < 0 ? diff : null;  // null quando positivo = sem overlay
  const perf    = (prem != null && gar != null && gar > 0) ? Math.round(((prem-gar)/gar)*1000)/10 : null;
  const acoes   = calcAcoesForRow(r);
  const field   = r.field != null ? r.field : (FIELD_MAP[r._key] ?? null);
  const id      = getId(r._key) || '';
  const isNFrow = id.toUpperCase() === 'NF' || r.explicitNF;
  const status  = isNFrow ? 'Não formou' : (prem != null ? 'Fechado' : 'Aberto');
  return { r, cat, gar, prem, overlay, perf, acoes, field, id, isNFrow, status,
    cells: [r.nome||'', r.hora||'', r.late||'', CAT_LABEL[cat]||'',
            gar??'', r.buyin??'', prem??'', overlay??'', field??'', acoes??'', perf??'',
            fixedBy(r._key)||'', id, status] };
}

function exportAcompanhamentoXlsx(rawRowsOverride, dateOverride, multiSheet){
  const source = rawRowsOverride || RAW_ROWS;
  const n = nowInSP();
  const dateLabel = dateOverride || `${String(n.day).padStart(2,'0')}/${String(n.month).padStart(2,'0')}/${n.year}`;
  const dateFile  = (dateOverride||`${String(n.day).padStart(2,'0')}-${String(n.month).padStart(2,'0')}-${n.year}`).replace(/\//g,'-');

  if(!source.length){ showToast('Nenhum dado para exportar.', true); return null; }

  const DAY_START = 5*60;
  const sortByTime = arr => [...arr].sort((a,b)=>{
    const ma = timeToMinutes(a.hora)??9999, mb = timeToMinutes(b.hora)??9999;
    return (ma>=DAY_START?ma:ma+1440)-(mb>=DAY_START?mb:mb+1440);
  });

  const groups = [
    { key:'main', rows: sortByTime(source.filter(r=>classify(r)==='main')) },
    { key:'side', rows: sortByTime(source.filter(r=>classify(r)==='side')) },
    { key:'sat',  rows: sortByTime(source.filter(r=>classify(r)==='sat'))  },
  ].filter(g=>g.rows.length);

  /* Monta array de arrays (AoA) para o sheet */
  const aoa = [];
  // Linha de título do dia
  aoa.push([`RELATÓRIO DE ACOMPANHAMENTO — ${dateLabel}`]);
  aoa.push([]); // espaço

  const styleMap = {}; // addr → style

  const setCellStyle = (ri, ci, style) => {
    styleMap[XLSX.utils.encode_cell({r:ri,c:ci})] = style;
  };

  const totalsByGroup = {};

  groups.forEach(g=>{
    const cc = CAT_COLORS[g.key];
    // Cabeçalho de grupo
    const groupHeaderRow = aoa.length;
    aoa.push([cc.label]);
    // Cabeçalho de colunas
    const colHeaderRow = aoa.length;
    aoa.push(COL_HEADERS);

    let sumGar=0, sumPrem=0, sumOverlay=0, countRows=0;

    g.rows.forEach(r=>{
      const d = buildRowData(r, dateLabel);
      const dataRow = aoa.length;
      aoa.push(d.cells);
      countRows++;
      if(d.gar) sumGar += d.gar;
      if(d.prem) sumPrem += d.prem;
      if(d.overlay!=null) sumOverlay += d.overlay;

      // estilo de status
      if(d.isNFrow){
        for(let c=0;c<d.cells.length;c++){
          styleMap[XLSX.utils.encode_cell({r:dataRow,c})] = {font:{color:{rgb:'888888'},italic:true}, fill:{fgColor:{rgb:'F5F5F5'}}};
        }
      } else if(d.overlay!=null && d.overlay<0){
        styleMap[XLSX.utils.encode_cell({r:dataRow,c:7})] = {font:{bold:true,color:{rgb:'C62828'}}};
      } else if(d.perf!=null){
        styleMap[XLSX.utils.encode_cell({r:dataRow,c:10})] = {font:{bold:true,color:{rgb:d.perf>=0?'1B5E20':'C62828'}}};
      }
    });

    // Linha de total do grupo
    const totalRow = aoa.length;
    const totGarLabel = sumGar>0 ? `R$ ${fmtBRL(sumGar,0)}` : '—';
    const totPremLabel = sumPrem>0 ? `R$ ${fmtBRL(sumPrem,0)}` : '—';
    const totOvLabel = sumOverlay!==0 ? `R$ ${fmtBRL(sumOverlay,0)}` : '—';
    aoa.push([`Total (${countRows})`, '', '', '', totGarLabel, '', totPremLabel, totOvLabel, '', '', '', '', '', '']);
    styleMap[XLSX.utils.encode_cell({r:totalRow,c:0})] = {font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:cc.sub}}};
    for(let c=1;c<14;c++) styleMap[XLSX.utils.encode_cell({r:totalRow,c})] = {fill:{fgColor:{rgb:cc.soft}}};

    aoa.push([]); // espaço entre grupos

    // Aplica estilos de cabeçalho de grupo e colunas
    styleMap[XLSX.utils.encode_cell({r:groupHeaderRow,c:0})] = {font:{bold:true,color:{rgb:'FFFFFF'},sz:13},fill:{fgColor:{rgb:cc.header}}};
    for(let c=0;c<COL_HEADERS.length;c++){
      styleMap[XLSX.utils.encode_cell({r:colHeaderRow,c})] = {font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:cc.sub}},alignment:{horizontal:'center'}};
    }
    totalsByGroup[g.key] = {sumGar,sumPrem,sumOverlay,count:countRows};
  });

  // Sumário geral
  aoa.push(['SUMÁRIO']);
  const sumRow = aoa.length-1;
  styleMap[XLSX.utils.encode_cell({r:sumRow,c:0})] = {font:{bold:true,color:{rgb:'FFFFFF'},sz:12},fill:{fgColor:{rgb:'1A472A'}}};

  const allGar = groups.reduce((s,g)=>s+(totalsByGroup[g.key]?.sumGar||0),0);
  const allPrem = groups.reduce((s,g)=>s+(totalsByGroup[g.key]?.sumPrem||0),0);
  const allOv = groups.reduce((s,g)=>s+(totalsByGroup[g.key]?.sumOverlay||0),0);

  aoa.push(['Garantido total', `R$ ${fmtBRL(allGar,0)}`]);
  aoa.push(['Premiação total', `R$ ${fmtBRL(allPrem,0)}`]);
  aoa.push(['Overlay total', allOv < 0 ? `R$ ${fmtBRL(Math.abs(allOv),0)} (déficit)` : 'Sem overlay']);
  aoa.push(['Performance geral', allGar>0 ? `${(((allPrem-allGar)/allGar)*100).toFixed(1)}%` : '—']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = COL_WIDTHS.map(w=>({wch:w}));
  // merge linha de título
  ws['!merges'] = ws['!merges']||[];
  ws['!merges'].push({s:{r:0,c:0},e:{r:0,c:COL_HEADERS.length-1}});
  // aplica estilos
  Object.entries(styleMap).forEach(([addr,style])=>{
    if(!ws[addr]) ws[addr]={t:'s',v:''};
    ws[addr].s = style;
  });
  // estilo da linha de título
  if(ws['A1']) ws['A1'].s = {font:{bold:true,color:{rgb:'FFFFFF'},sz:14},fill:{fgColor:{rgb:'0A3D27'}},alignment:{horizontal:'center'}};

  if(multiSheet) return { ws, name: `Acomp ${dateFile}`.slice(0,31) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Acompanhamento ${dateFile}`.slice(0,31));
  XLSX.writeFile(wb, `Acompanhamento_${dateFile}.xlsx`);
  const total = groups.reduce((s,g)=>s+g.rows.length,0);
  showToast(`Relatório de ${total} torneios exportado em 3 grupos!`);
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   AUTO-SAVE DO RELATÓRIO — salva XLSX no Firebase quando o último
   card do dia é preenchido (premiação + field + ID todos completos)
══════════════════════════════════════════════════════════════════ */

// Verificar se todos os cards principais (Main + Side com GTD≥3k) estão fechados
function isDayComplete(){
  if(!RAW_ROWS.length) return false;
  const mustClose = RAW_ROWS.filter(r => mustFix(r, classify(r)));
  if(!mustClose.length) return false;
  return mustClose.every(r =>
    r.premiacao != null &&
    (FIELD_MAP[r._key] != null || r.field != null) &&
    getId(r._key) !== ''
  );
}

// Converter workbook para base64
function wbToBase64(wb){
  const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  let bin = '';
  new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

// Salvar XLSX no Firebase em relatorios/{data}/acompanhamento
async function saveReportToFirebase(silent=false){
  if(PANEL_RO){ if(!silent) roGuard(); return; }
  if(!fbReady){ if(!silent) showToast('Firebase não conectado.', true); return; }
  if(!RAW_ROWS.length){ if(!silent) showToast('Nenhum dado para salvar.', true); return; }

  try {
    const n = nowInSP();
    const dateLabel = `${String(n.day).padStart(2,'0')}/${String(n.month).padStart(2,'0')}/${n.year}`;
    const dateFile  = `${n.year}-${String(n.month).padStart(2,'0')}-${String(n.day).padStart(2,'0')}`;
    const dateKey   = dateFile; // YYYY-MM-DD

    // Gerar o workbook (sem fazer download)
    const source = RAW_ROWS;
    const DAY_START = 5*60;
    const sortByTime = arr => [...arr].sort((a,b)=>{
      const ma = timeToMinutes(a.hora)??9999, mb = timeToMinutes(b.hora)??9999;
      return (ma>=DAY_START?ma:ma+1440)-(mb>=DAY_START?mb:mb+1440);
    });
    const groups = [
      { key:'main', rows: sortByTime(source.filter(r=>classify(r)==='main')) },
      { key:'side', rows: sortByTime(source.filter(r=>classify(r)==='side')) },
      { key:'sat',  rows: sortByTime(source.filter(r=>classify(r)==='sat'))  },
    ].filter(g=>g.rows.length);

    const aoa = [];
    aoa.push([`RELATÓRIO DE ACOMPANHAMENTO — ${dateLabel}`]);
    aoa.push([]);
    const totalsByGroup = {};

    groups.forEach(g=>{
      aoa.push([CAT_LABEL[g.key]||g.key]);
      aoa.push(COL_HEADERS);
      let sumGar=0, sumPrem=0, sumOv=0, count=0;
      g.rows.forEach(r=>{
        const d = buildRowData(r, dateLabel);
        aoa.push(d.cells);
        count++;
        if(d.gar)  sumGar  += d.gar;
        if(d.prem) sumPrem += d.prem;
        if(d.overlay != null) sumOv += d.overlay;
      });
      aoa.push([`Total (${count})`, '', '', '', `R$ ${fmtBRL(sumGar,0)}`, '', `R$ ${fmtBRL(sumPrem,0)}`, sumOv!==0?`R$ ${fmtBRL(sumOv,0)}`:'—', '', '', '', '', '', '']);
      aoa.push([]);
      totalsByGroup[g.key] = {sumGar, sumPrem, sumOv, count};
    });

    const allGar  = groups.reduce((s,g)=>s+(totalsByGroup[g.key]?.sumGar||0),0);
    const allPrem = groups.reduce((s,g)=>s+(totalsByGroup[g.key]?.sumPrem||0),0);
    const allOv   = groups.reduce((s,g)=>s+(totalsByGroup[g.key]?.sumOv||0),0);
    aoa.push(['SUMÁRIO']);
    aoa.push(['Garantido total',  `R$ ${fmtBRL(allGar,0)}`]);
    aoa.push(['Premiação total',  `R$ ${fmtBRL(allPrem,0)}`]);
    aoa.push(['Overlay total',    allOv<0 ? `R$ ${fmtBRL(Math.abs(allOv),0)} (déficit)` : 'Sem overlay']);
    aoa.push(['Performance geral', allGar>0 ? `${(((allPrem-allGar)/allGar)*100).toFixed(1)}%` : '—']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = COL_WIDTHS.map(w=>({wch:w}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Acomp ${dateLabel}`.replace(/\//g,'-').slice(0,31));

    const b64 = wbToBase64(wb);
    const total = groups.reduce((s,g)=>s+g.rows.length,0);
    const closed = RAW_ROWS.filter(r=>r.premiacao!=null).length;

    await fbDb.ref(`relatorios/${dateKey}/acompanhamento`).set({
      b64,
      filename:    `Acompanhamento_${dateFile}.xlsx`,
      savedAt:     Date.now(),
      savedBy:     OPERATOR_NAME || 'Painel',
      totalCards:  total,
      closedCards: closed,
      dateLabel,
      allGar, allPrem, allOv,
    });

    if(!silent){
      showToast(`✓ Relatório salvo no servidor (${closed} torneios fechados)`);
    }
    return true;
  } catch(e){
    console.error('saveReportToFirebase error:', e);
    if(!silent) showToast('Erro ao salvar relatório: ' + e.message, true);
    return false;
  }
}

// Checar se o dia está completo após qualquer preenchimento
let _lastDayCompleteCheck = false;
function checkDayComplete(){
  if(PANEL_RO) return;                 // viewer não dispara o autosave do relatório
  if(!RAW_ROWS.length) return;
  const complete = isDayComplete();
  if(complete && !_lastDayCompleteCheck){
    _lastDayCompleteCheck = true;
    // Aguardar 3s para garantir que o último save chegou ao Firebase
    setTimeout(async () => {
      // Trava distribuída: só um operador salva, mesmo se os dois fecharem o último card juntos
      if(fbReady){
        const lockRef = fbDb.ref(`${FB_BASE_PATH}/_autoSaveLock`);
        try{
          const result = await lockRef.transaction(curr => {
            if(curr && Date.now() - curr < 10000) return; // já travado nos últimos 10s — aborta
            return Date.now();
          });
          if(!result.committed) return; // outro operador já está salvando
        }catch(e){ /* segue mesmo se a trava falhar */ }
      }
      const ok = await saveReportToFirebase(true); // silent
      if(ok){
        showToast('🏁 Último card preenchido — relatório do dia salvo automaticamente no servidor!');
      }
    }, 3000);
  } else if(!complete){
    _lastDayCompleteCheck = false;
  }
}

/* Exportação legacy */
async function exportResultsXlsx(){ await ensureXLSX(); exportAcompanhamentoXlsx(); }
document.getElementById('exportResultsBtn').addEventListener('click', exportResultsXlsx);
document.getElementById('snapshotBtn')?.addEventListener('click', () => saveSnapshotToFirebase('manual'));
document.getElementById('saveReportBtn')?.addEventListener('click', () => saveReportToFirebase(false));
document.getElementById('multiDayReportBtn')?.addEventListener('click', openMultiDayReport);

/* =========================================================================
   NAME SEARCH
========================================================================= */
const nameSearchInput = document.getElementById('nameSearchInput');
const nameSearchClear = document.getElementById('nameSearchClear');
const debouncedRenderUpcoming = debounce(renderUpcoming, 200);
nameSearchInput.addEventListener('input', () => {
  nameSearchQuery = nameSearchInput.value.trim();
  nameSearchClear.hidden = !nameSearchQuery;
  debouncedRenderUpcoming();
});
nameSearchClear.addEventListener('click', () => {
  nameSearchInput.value = '';
  nameSearchQuery = '';
  nameSearchClear.hidden = true;
  renderUpcoming();
  nameSearchInput.focus();
});

const resultsNameSearchInput = document.getElementById('resultsNameSearchInput');
const resultsNameSearchClear = document.getElementById('resultsNameSearchClear');
const debouncedRenderResults = debounce(renderResults, 200);
resultsNameSearchInput.addEventListener('input', () => {
  resultsNameSearchQuery = resultsNameSearchInput.value.trim();
  resultsNameSearchClear.hidden = !resultsNameSearchQuery;
  debouncedRenderResults();
});
resultsNameSearchClear.addEventListener('click', () => {
  resultsNameSearchInput.value = '';
  resultsNameSearchQuery = '';
  resultsNameSearchClear.hidden = true;
  renderResults();
  resultsNameSearchInput.focus();
});

/* =========================================================================
   FILTER CHIPS
========================================================================= */
/* Multi-seleção: clicar em "Todos" limpa os outros filtros; clicar em qualquer filtro específico
   faz toggle (liga/desliga) e mantém os demais ativos — permite combinar, por exemplo,
   Main Event + Satélite ao mesmo tempo. Se todos forem desligados, volta pra "Todos" sozinho. */
function setUpcomingCat(cat, btn){
  if(cat === 'all'){
    activeUpcomingCat = new Set(['all']);
  } else {
    activeUpcomingCat.delete('all');
    if(activeUpcomingCat.has(cat)) activeUpcomingCat.delete(cat);
    else activeUpcomingCat.add(cat);
    if(activeUpcomingCat.size === 0) activeUpcomingCat.add('all');
  }
  document.querySelectorAll('#upcomingFilters .chip[data-cat]').forEach(c => {
    c.classList.toggle('active', activeUpcomingCat.has(c.dataset.cat));
  });
  renderUpcoming();
}
function setUpcomingPrem(prem, btn){
  document.querySelectorAll('#upcomingFilters .chip-prem').forEach(c => c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  upcomingPremFilter = prem;
  renderUpcoming();
}

function setUpcomingCamp(tipo, btn){
  document.querySelectorAll('#upcomingFilters .chip-camp').forEach(c => c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  upcomingCampFilter = tipo;
  renderUpcoming();
}

/* resumo "X de Y torneios" + botão Limpar: só aparece quando algum filtro está fora do padrão,
   pra ninguém achar que a lista "sumiu" quando na verdade tem 4 filtros ativos empilhados */
function anyUpcomingFilterActive(){
  return !activeUpcomingCat.has('all')
    || upcomingPremFilter !== 'all'
    || upcomingCampFilter !== 'all'
    || _opFilter !== 'all'
    || !!nameSearchQuery
    || timeFilterMin !== null;
}
function updateFilterSummary(shownCount){
  const box = document.getElementById('filterSummary');
  if (!box) return;
  if (!anyUpcomingFilterActive()){ box.hidden = true; return; }
  box.hidden = false;
  document.getElementById('filterSummaryText').textContent =
    shownCount === 0
      ? `Nenhum torneio passa nos filtros ativos (${UPCOMING.length} no total)`
      : `Mostrando ${shownCount} de ${UPCOMING.length} torneios`;
}
function clearAllUpcomingFilters(){
  activeUpcomingCat  = new Set(['all']);
  upcomingPremFilter = 'all';
  upcomingCampFilter = 'all';
  _opFilter          = 'all';
  nameSearchQuery    = '';
  timeFilterMin      = null;
  // reflete o reset na UI de cada filtro
  document.querySelectorAll('#upcomingFilters .chip').forEach(c => c.classList.remove('active','active-me','active-partner'));
  document.querySelector('#upcomingFilters .chip[data-cat="all"]')?.classList.add('active');
  document.querySelector('#upcomingFilters .chip[data-prem="all"]')?.classList.add('active');
  document.querySelector('#upcomingFilters .chip[data-camp="all"]')?.classList.add('active');
  // modo compacto é visualização, não filtro — não reseta, só restaura o visual do botão
  if (_compactMode) document.getElementById('compactToggleBtn')?.classList.add('active');
  const searchInput = document.getElementById('nameSearchInput');
  if (searchInput){ searchInput.value = ''; }
  const searchClear = document.getElementById('nameSearchClear');
  if (searchClear){ searchClear.hidden = true; }
  const tfClear = document.getElementById('tfClear');
  if (tfClear){ tfClear.hidden = true; }
  renderUpcoming();
}

function setResultsCat(cat, btn){
  document.querySelectorAll('#resultsFilters .chip').forEach(c=>c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  activeResultsCat = cat;
  renderResults();
}
// (upcomingFilters não usa mais o listener delegado: cada chip já tem onclick próprio,
// e chamar setUpcomingCat duas vezes por clique desfaria o toggle de multi-seleção)
document.getElementById('resultsFilters')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('.chip');
  if (!btn || !btn.dataset.cat) return;
  setResultsCat(btn.dataset.cat, btn);
});

/* =========================================================================
   TIME FILTER BAR — "o que fixar até HH:MM" (sempre horário de Brasília)
========================================================================= */
const tfDisplay = document.getElementById('tfDisplay');
const tfClearBtn = document.getElementById('tfClear');
const tfSheetOverlay = document.getElementById('tfSheetOverlay');
const tfSheet = document.getElementById('tfSheet');
const tfWheelHour = document.getElementById('tfWheelHour');
const tfWheelMin = document.getElementById('tfWheelMin');

const WHEEL_ITEM_H = 36;
const MINUTE_STEPS = Array.from({length:12}, (_,i)=>i*5); // 00,05,10...55 — granularidade fina pra acertar horários quebrados (07:45, 11:15 etc), as setas ‹ › já pulam direto pros checkpoints reais

function buildWheel(container, items, formatFn){
  container.innerHTML = '';
  const spacerTop = document.createElement('div');
  spacerTop.className = 'tf-wheel-spacer';
  container.appendChild(spacerTop);
  items.forEach(val => {
    const el = document.createElement('div');
    el.className = 'tf-wheel-item';
    el.dataset.value = val;
    el.textContent = formatFn(val);
    container.appendChild(el);
  });
  const spacerBottom = document.createElement('div');
  spacerBottom.className = 'tf-wheel-spacer';
  container.appendChild(spacerBottom);
}
buildWheel(tfWheelHour, Array.from({length:24}, (_,i)=>i), v => String(v).padStart(2,'0'));
buildWheel(tfWheelMin, MINUTE_STEPS, v => String(v).padStart(2,'0'));

function scrollWheelTo(container, value, smooth=true){
  const items = Array.from(container.querySelectorAll('.tf-wheel-item'));
  const idx = items.findIndex(el => Number(el.dataset.value) === value);
  if (idx === -1) return;
  container.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
}

function highlightWheelSelection(container){
  const items = Array.from(container.querySelectorAll('.tf-wheel-item'));
  const centerIdx = Math.round(container.scrollTop / WHEEL_ITEM_H);
  items.forEach((el, i) => el.classList.toggle('is-selected', i === centerIdx));
}
function readWheelValue(container){
  const items = Array.from(container.querySelectorAll('.tf-wheel-item'));
  const centerIdx = Math.round(container.scrollTop / WHEEL_ITEM_H);
  const clamped = Math.max(0, Math.min(items.length - 1, centerIdx));
  return Number(items[clamped]?.dataset.value ?? 0);
}

let wheelScrollTimer = null;
function onWheelScroll(container){
  highlightWheelSelection(container);
  clearTimeout(wheelScrollTimer);
  wheelScrollTimer = setTimeout(() => highlightWheelSelection(container), 80);
}
tfWheelHour.addEventListener('scroll', () => onWheelScroll(tfWheelHour), {passive:true});
tfWheelMin.addEventListener('scroll', () => onWheelScroll(tfWheelMin), {passive:true});

// clique direto em um item da roda também seleciona (além de arrastar/rolar)
[tfWheelHour, tfWheelMin].forEach(wheel => {
  wheel.addEventListener('click', (e) => {
    const item = e.target.closest('.tf-wheel-item');
    if (!item) return;
    scrollWheelTo(wheel, Number(item.dataset.value));
  });
});

function openTimeSheet(){
  const base = timeFilterMin !== null ? timeFilterMin : nowMinutesSP();
  let hh = Math.floor(base / 60);
  // arredonda o minuto pro múltiplo de 5 mais próximo (granularidade da roda)
  let mm = Math.round((base % 60) / 5) * 5;
  if (mm === 60){ mm = 0; hh = (hh + 1) % 24; }
  scrollWheelTo(tfWheelHour, hh, false);
  scrollWheelTo(tfWheelMin, mm, false);
  setTimeout(() => { highlightWheelSelection(tfWheelHour); highlightWheelSelection(tfWheelMin); }, 50);
  tfSheetOverlay.classList.add('open');
  tfDisplay.setAttribute('aria-expanded', 'true');
}
function closeTimeSheet(){
  tfSheetOverlay.classList.remove('open');
  tfDisplay.setAttribute('aria-expanded', 'false');
}
function confirmTimeSheet(){
  const hh = readWheelValue(tfWheelHour);
  const mm = readWheelValue(tfWheelMin);
  setTimeFilter(hh*60 + mm);
  closeTimeSheet();
}

tfDisplay.addEventListener('click', openTimeSheet);
document.getElementById('tfSheetDone').addEventListener('click', confirmTimeSheet);
tfSheetOverlay.addEventListener('click', (e) => { if (e.target === tfSheetOverlay) closeTimeSheet(); });

function setTimeFilter(min){
  timeFilterMin = min;
  tfDisplayText.textContent = minutesToHHMM(min);
  tfClearBtn.hidden = false;
  renderUpcoming();
}
function clearTimeFilter(){
  timeFilterMin = null;
  tfClearBtn.hidden = true;
  renderUpcoming();
}

document.getElementById('tfPrev').addEventListener('click', () => {
  const base = timeFilterMin !== null ? timeFilterMin : nowMinutesSP();
  setTimeFilter(nextCheckpoint(base, -1));
});
document.getElementById('tfNext').addEventListener('click', () => {
  const base = timeFilterMin !== null ? timeFilterMin : nowMinutesSP();
  setTimeFilter(nextCheckpoint(base, 1));
});
document.getElementById('tfNow').addEventListener('click', () => {
  setTimeFilter(nowMinutesSP());
});
tfClearBtn.addEventListener('click', clearTimeFilter);

/* =========================================================================
   CHECKLIST DRAWER
========================================================================= */
// id estável por item: grupo + texto (slug simples) — usado como chave no Firebase, então precisa ser
// previsível e não mudar entre carregamentos, mesmo que a ordem dos itens no array mude no futuro
function checklistItemId(label){
  const slug = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  return `item__${slug}`;
}

function renderChecklist(){
  const container = document.getElementById('checklistItemsMain');
  container.innerHTML = '';
  let totalDone = 0, totalAll = 0;
  CHECKLIST_DATA.forEach(label => {
    const itemId = checklistItemId(label);
    const done = isChecklistDone(itemId);
    const by = checklistDoneBy(itemId);
    totalAll++; if (done) totalDone++;
    const row = document.createElement('label');
    row.className = `checklist-item${done ? ' is-done' : ''}`;
    row.innerHTML = `
      <input type="checkbox" data-item-id="${itemId}" ${done ? 'checked' : ''}>
      <span class="checklist-item-label">${label}</span>
      ${done && by ? `<span class="checklist-item-by">${by}</span>` : ''}
    `;
    container.appendChild(row);
  });
  document.querySelectorAll('#checklistDrawer .checklist-item input').forEach(inp => {
    inp.addEventListener('change', () => {
      setChecklistItem(inp.dataset.itemId, inp.checked);
      renderChecklist();
    });
  });
  const badge = document.getElementById('checklistBadge');
  badge.hidden = false;
  badge.textContent = `${totalDone}/${totalAll}`;
}
renderChecklist();

/* Drawer aberto = página coberta pelo vidro fosco. body.sp-covered congela as
   animações de fundo (CSS em painel.css) — cada frame animado sob o
   backdrop-filter re-borra a viewport inteira, que era o FPS baixo das
   ferramentas em PC fraco. O vídeo do hero também pausa (decodificar frame
   novo = re-blur), guardando se estava tocando pra retomar só nesse caso. */
function syncCoveredState(){
  const covered = !!document.querySelector('.drawer-overlay.open');
  document.body.classList.toggle('sp-covered', covered);
  const video = document.getElementById('heroVideo');
  if(video){
    if(covered){
      if(!video.paused){ video.__resumeAfterDrawer = true; video.pause(); }
    }else if(video.__resumeAfterDrawer){
      video.__resumeAfterDrawer = false;
      video.play?.().catch(()=>{});
    }
  }
}
function openDrawer(overlayId){
  document.getElementById(overlayId).classList.add('open');
  syncCoveredState();
}
function closeDrawer(overlayId){
  document.getElementById(overlayId).classList.remove('open');
  syncCoveredState();
}
document.getElementById('checklistToggle').addEventListener('click', () => openDrawer('checklistDrawerOverlay'));
document.getElementById('checklistDrawerClose').addEventListener('click', () => closeDrawer('checklistDrawerOverlay'));
document.getElementById('checklistDrawerOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'checklistDrawerOverlay') closeDrawer('checklistDrawerOverlay');
});

/* =========================================================================
   SERVERS DRAWER
========================================================================= */
function renderServerTable(query){
  const table = document.getElementById('serverTable');
  const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q = norm(query || '');
  const rows = q ? SERVER_DATA.filter(s => norm(s.liga).includes(q) || String(s.id).includes(q) || norm(s.moeda).includes(q)) : SERVER_DATA;

  table.innerHTML = `<div class="server-row head"><div>Liga</div><div>ID</div><div>Moeda</div></div>`;
  if (!rows.length){
    table.innerHTML += `<div class="server-empty">Nenhum servidor encontrado.</div>`;
    return;
  }
  rows.forEach(s => {
    const row = document.createElement('div');
    row.className = 'server-row';
    row.innerHTML = `<div class="liga">${s.liga}</div><div class="sid">${s.id}</div><div class="moeda">${s.moeda || '—'}</div>`;
    table.appendChild(row);
  });
}
renderServerTable('');

document.getElementById('serversToggle').addEventListener('click', () => openDrawer('serversDrawerOverlay'));
document.getElementById('serversDrawerClose').addEventListener('click', () => closeDrawer('serversDrawerOverlay'));
document.getElementById('serversDrawerOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'serversDrawerOverlay') closeDrawer('serversDrawerOverlay');
});
document.getElementById('serverSearchInput').addEventListener('input', (e) => {
  renderServerTable(e.target.value);
});

/* =========================================================================
   ROTINA DO TURNO
========================================================================= */
document.getElementById('routineToggle').addEventListener('click', () => openDrawer('routineDrawerOverlay'));
document.getElementById('routineDrawerClose').addEventListener('click', () => closeDrawer('routineDrawerOverlay'));
document.getElementById('routineDrawerOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'routineDrawerOverlay') closeDrawer('routineDrawerOverlay');
});

/* =========================================================================
   DIAGNÓSTICO — liga o motor (suprema-insights.js) ao painel

   O motor é PURO: não conhece Firebase nem DOM. Aqui a gente só tira o retrato do
   estado e desenha o resultado. Toda a lógica de "o que é problema" mora lá, testada
   no Node — porque regra que fala de dinheiro não pode depender de eu abrir o navegador.
========================================================================= */
let DIAG_ACHADOS = [];

function diagContexto(){
  return {
    rows: RAW_ROWS,
    historico: _historico,
    idMap: ID_MAP,
    avisosPlanilha: LAST_PARSE_WARNINGS,
    // _connected só vira true depois do 1º handshake; undefined = ainda não sabemos
    // (não é "offline", senão o painel acusaria queda em todo carregamento)
    conectado: FB_CONNECTED,
    nowMin: nowMinutesSP(),
    garantidoEfetivo: r => getGarantidoEffective(r._key) ?? r.garantido ?? null,
    estaFixado: r => isFixed(r._key),
  };
}

function runDiagnostico(){
  if (typeof SupremaInsights === 'undefined') return;   // defer: pode não ter chegado ainda
  DIAG_ACHADOS = SupremaInsights.analisar(diagContexto());
  const r = SupremaInsights.resumo(DIAG_ACHADOS);
  const badge = document.getElementById('diagBadge');
  if (badge){
    const n = r.critico + r.atencao;                    // "info" não puxa a atenção do turno
    badge.textContent = n;
    badge.hidden = n === 0;
    badge.classList.toggle('has-critico', r.critico > 0);
  }
  if (document.getElementById('diagDrawerOverlay')?.classList.contains('open')) renderDiagnostico();
  renderCoach();                                       // coach do dia no hero (fora do drawer)
}
/* re-analisa sem custo: colado nos mesmos momentos em que os números já mudam.
   `var` (não `const`) DE PROPÓSITO: computeStats (via restoreSheetFromLocal) e o
   callback de conexão do Firebase podem rodar ANTES desta linha, no load. As
   duas chamadas se protegem com `typeof scheduleDiagnostico === 'function'` —
   guarda que só é segura com `var` (sobe como undefined). Como `const`, a mesma
   leitura caía na Temporal Dead Zone e lançava ReferenceError, quebrando o
   ingest inteiro ("Cannot access 'scheduleDiagnostico' before initialization"). */
var scheduleDiagnostico = debounce(runDiagnostico, 400);

const DIAG_CAT_LABEL = { operacional:'Operação', tecnico:'Técnico', preditivo:'Antecipação' };
const DIAG_SEV_LABEL = { critico:'Crítico', atencao:'Atenção', info:'Info' };

function renderDiagnostico(){
  const list = document.getElementById('diagList');
  const sum  = document.getElementById('diagSummary');
  if (!list) return;
  const r = (typeof SupremaInsights !== 'undefined') ? SupremaInsights.resumo(DIAG_ACHADOS) : {total:0,critico:0,atencao:0,info:0};

  sum.innerHTML = r.total
    ? ['critico','atencao','info'].filter(s => r[s]).map(s =>
        `<span class="diag-chip ${s}"><span class="n">${r[s]}</span> ${DIAG_SEV_LABEL[s]}</span>`).join('')
    : '<span class="diag-chip limpo">✓ Nada pendente</span>';

  if (!r.total){
    list.innerHTML = `<div class="diag-empty">
      <div class="t">✓ Tudo em ordem</div>
      <div class="s">Nenhum evento aberto fora de hora, nenhuma premiação fora da faixa, nenhum ID repetido e nada no histórico pedindo atenção agora. Isto atualiza sozinho — se algo sair do lugar, o número aparece no botão do topo.</div>
    </div>`;
    return;
  }

  // agrupa por categoria preservando a ordem por severidade que o motor já devolveu
  const porCat = {};
  DIAG_ACHADOS.forEach(a => (porCat[a.cat] = porCat[a.cat] || []).push(a));
  list.innerHTML = ['operacional','tecnico','preditivo'].filter(c => porCat[c]).map(cat => `
    <div class="diag-cat">${DIAG_CAT_LABEL[cat]}</div>
    ${porCat[cat].map(a => `
      <div class="diag-item ${a.sev}">
        <div class="diag-head">
          <span class="diag-sev ${a.sev}">${DIAG_SEV_LABEL[a.sev]}</span>
          <span class="diag-titulo">${escHtml(a.titulo)}</span>
        </div>
        <div class="diag-porque">${escHtml(a.porque)}</div>
        <div class="diag-acao">${escHtml(a.acao)}</div>
        ${a.key ? `<button type="button" class="diag-goto" data-goto="${escHtml(a.key)}">Ver o card</button>` : ''}
      </div>`).join('')}
  `).join('');

  list.querySelectorAll('.diag-goto').forEach(b => {
    b.addEventListener('click', () => diagIrParaCard(b.dataset.goto));
  });
}

/* leva até o card e pisca — sem isso o achado vira "procure agulha no palheiro" */
function diagIrParaCard(key){
  closeDrawer('diagDrawerOverlay');
  setTimeout(() => {
    const el = document.querySelector(`.tcard[data-key="${key}"], .ucard[data-key="${key}"], tr[data-key="${key}"]`);
    if (!el){ showToast('O card não está na visão atual — troque o filtro da Agenda.', true); return; }
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    el.classList.remove('diag-target');
    void el.offsetWidth;                      // reinicia a animação se clicarem duas vezes
    el.classList.add('diag-target');
    setTimeout(() => el.classList.remove('diag-target'), 2600);
  }, 260);
}

document.getElementById('diagToggle')?.addEventListener('click', () => {
  runDiagnostico();
  renderDiagnostico();
  openDrawer('diagDrawerOverlay');
});
document.getElementById('diagDrawerClose')?.addEventListener('click', () => closeDrawer('diagDrawerOverlay'));
document.getElementById('diagDrawerOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'diagDrawerOverlay') closeDrawer('diagDrawerOverlay');
});

/* ── Drawer: adicionar torneio manual ─────────────────────────────────── */
document.getElementById('addTorneioToggle')?.addEventListener('click', () => {
  openDrawer('addTorneioDrawerOverlay');
  renderManualList();
  setTimeout(() => document.getElementById('addtNome')?.focus(), 80);
});
document.getElementById('addTorneioDrawerClose')?.addEventListener('click', () => closeDrawer('addTorneioDrawerOverlay'));
document.getElementById('addTorneioDrawerOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'addTorneioDrawerOverlay') closeDrawer('addTorneioDrawerOverlay');
});

/* aceita "50.000", "50000", "R$ 1.500,50" — mesma tolerância do input de premiação */
function parseValorBRL(s){
  s = String(s || '').trim().replace(/R\$\s*/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "50.000" = milhar, não decimal
  const n = parseFloat(s);
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

function addtMsg(txt, cls){
  const el = document.getElementById('addtMsg');
  if (!el) return;
  el.textContent = txt || '';
  el.className = 'addt-msg' + (cls ? ' ' + cls : '');
}

function renderManualList(){
  const list = document.getElementById('addtList');
  const count = document.getElementById('addtCount');
  const badge = document.getElementById('addTorneioBadge');
  if (!list) return;
  const entries = Object.entries(MANUAL_ROWS || {})
    .filter(([, r]) => r && r.nome)
    .sort((a, b) => String(a[1].hora || '').localeCompare(String(b[1].hora || '')));
  if (count) count.textContent = entries.length;
  if (badge){ badge.textContent = entries.length; badge.hidden = entries.length === 0; }
  if (!entries.length){
    list.innerHTML = '<div class="addt-empty">Nenhum torneio manual hoje. Os que você adicionar aparecem aqui.</div>';
    return;
  }
  list.innerHTML = entries.map(([id, r]) => {
    const gtd = r.garantido != null ? 'GTD R$ ' + fmtBRL(r.garantido, 0) : 'sem GTD';
    const bi  = r.buyin != null ? 'BI R$ ' + fmtBRL(r.buyin, r.buyin % 1 ? 2 : 0) : 'sem BI';
    return `<div class="addt-item">
      <div class="addt-item-main">
        <div class="addt-item-nome">${escHtml(r.nome)}</div>
        <div class="addt-item-meta">${escHtml(r.hora || '--:--')} · ${gtd} · ${bi}</div>
        ${r._by ? `<div class="addt-item-by">por ${escHtml(r._by)}</div>` : ''}
      </div>
      <button type="button" class="addt-remove" data-mid="${escHtml(id)}">Remover</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.addt-remove').forEach(b => {
    b.addEventListener('click', () => {
      const r = MANUAL_ROWS[b.dataset.mid];
      if (!r) return;
      if (!confirm(`Remover "${r.nome}" (${r.hora || '--:--'}) da grade de hoje?`)) return;
      removeManualTournament(b.dataset.mid);
    });
  });
}

document.getElementById('addTorneioForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const $ = id => document.getElementById(id);
  const nomeEl = $('addtNome'), horaEl = $('addtHora');
  const nome = nomeEl.value.trim();
  const hora = horaEl.value;
  const garantido = parseValorBRL($('addtGarantido').value);
  const buyin = parseValorBRL($('addtBuyin').value);
  const tipo = $('addtTipo').value;

  [nomeEl, horaEl].forEach(el => el.classList.remove('addt-invalid'));
  if (!nome){ nomeEl.classList.add('addt-invalid'); nomeEl.focus(); return addtMsg('Dê um nome ao evento.', 'err'); }
  if (!hora){ horaEl.classList.add('addt-invalid'); horaEl.focus(); return addtMsg('Informe o horário.', 'err'); }

  // a grade precisa existir: os manuais são fundidos NA planilha do dia
  if (!LAST_SHEET_ROWS.length) return addtMsg('Carregue a Global MTT de hoje antes de adicionar torneios.', 'err');

  // nome+hora é a identidade do torneio no painel inteiro — duplicar quebraria o casamento
  // da premiação e a auditoria (dois eventos indistinguíveis)
  const ident = manualIdent({nome, hora});
  if (RAW_ROWS.some(r => manualIdent(r) === ident))
    return addtMsg('Já existe um torneio com esse nome e horário na grade de hoje.', 'err');

  const btn = $('addtSubmit');
  btn.disabled = true; addtMsg('adicionando…');
  try{
    await addManualTournament({nome, hora, garantido, buyin, tipo});
    addtMsg(`✓ "${nome}" entrou na grade das ${hora}.`, 'ok');
    showToast(`✓ Torneio "${nome}" adicionado à grade de hoje`);
    document.getElementById('addTorneioForm').reset();
    nomeEl.focus(); // pronto pro próximo (o operador costuma adicionar mais de um)
  }catch(err){
    addtMsg('Falha ao salvar: ' + (err?.message || 'sem conexão'), 'err');
  }finally{
    btn.disabled = false;
  }
});

/* =========================================================================
   RELATÓRIO DE TURNO
   Uma única caixa de texto livre, tipo bloco de notas — sem campos estruturados. Fica salva num
   caminho FIXO do Firebase (não dentro de FB_BASE_PATH, que é por data), porque o operador reaproveita
   o relatório de ontem como modelo e vai editando em cima — diferente do resto do painel, isso NÃO
   reseta sozinho todo dia. Sincronizado em tempo real com o parceiro, igual tudo mais.
========================================================================= */
function shiftReportTemplate(){
  const n = nowInSP();
  const h = String(n.hour).padStart(2,'0') + ':' + String(n.minute).padStart(2,'0');
  const data = dataPorExtensoSP();
  return `RELATÓRIO DE TURNO — ${data.toUpperCase()}
Operador: ${OPERATOR_NAME || '—'}
Início: ${h}

━━━ ABERTURA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Planilha carregada: 
Planilha Global conferida: 

━━━ OCORRÊNCIAS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 

━━━ MESAS CASH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 

━━━ OVERLAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 

━━━ FECHAMENTO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Encerramento: 
Observações para o próximo turno: 
`;
}

function loadShiftReportLocal(){
  try{ return localStorage.getItem(SHIFT_REPORT_STORE_KEY) || ''; }catch(e){ return ''; }
}
SHIFT_REPORT_TEXT = loadShiftReportLocal() || '';
function saveShiftReportLocal(text){
  try{ localStorage.setItem(SHIFT_REPORT_STORE_KEY, text); }catch(e){}
}

function saveShiftReportText(text){
  SHIFT_REPORT_TEXT = text;
  saveShiftReportLocal(text);
  const statusEl = document.getElementById('shiftReportSaveStatus');
  if (fbReady){
    fbDb.ref('relatorioTurno/texto').set(text).then(() => {
      if (statusEl){
        statusEl.textContent = 'Salvo';
        statusEl.classList.add('saved');
      }
    }).catch(err => {
      console.error('Firebase: falha ao salvar relatório de turno', err);
      if (statusEl){ statusEl.textContent = 'Salvo só neste navegador'; statusEl.classList.remove('saved'); }
    });
  } else if (statusEl){
    statusEl.textContent = 'Salvo só neste navegador (sem conexão)';
    statusEl.classList.remove('saved');
  }
}
const debouncedSaveShiftReport = debounce(saveShiftReportText, 500);

const shiftReportTextarea = document.getElementById('shiftReportText');
shiftReportTextarea.value = SHIFT_REPORT_TEXT;
shiftReportTextarea.addEventListener('input', () => {
  const statusEl = document.getElementById('shiftReportSaveStatus');
  if (statusEl){ statusEl.textContent = 'Salvando...'; statusEl.classList.remove('saved'); }
  debouncedSaveShiftReport(shiftReportTextarea.value);
});
shiftReportTextarea.addEventListener('blur', () => {
  SHIFT_REPORT_REMOTE_PENDING = null;
  document.getElementById('shiftReportConflictBanner').hidden = true;
});

document.getElementById('copyShiftReportBtn').addEventListener('click', () => {
  copyToClipboard(shiftReportTextarea.value, document.getElementById('copyShiftReportBtn'), 'Relatório copiado.');
});

// botão de template
document.getElementById('shiftReportTemplateBtn')?.addEventListener('click', () => {
  if(shiftReportTextarea.value.trim() && !confirm('Substituir o conteúdo atual pelo template padrão?')) return;
  const tmpl = shiftReportTemplate();
  shiftReportTextarea.value = tmpl;
  saveShiftReportText(tmpl);
  showToast('Template aplicado.');
});

document.getElementById('shiftReportShowRemoteBtn').addEventListener('click', () => {
  if (SHIFT_REPORT_REMOTE_PENDING === null) return;
  if (!confirm('Isso vai substituir o que você está digitando pela versão que seu parceiro salvou. O que você tem escrito agora será perdido. Continuar?')) return;
  shiftReportTextarea.value = SHIFT_REPORT_REMOTE_PENDING;
  SHIFT_REPORT_TEXT = SHIFT_REPORT_REMOTE_PENDING;
  saveShiftReportLocal(SHIFT_REPORT_REMOTE_PENDING);
  SHIFT_REPORT_REMOTE_PENDING = null;
  document.getElementById('shiftReportConflictBanner').hidden = true;
});

document.getElementById('shiftReportToggle').addEventListener('click', () => openDrawer('shiftReportDrawerOverlay'));
document.getElementById('shiftReportDrawerClose').addEventListener('click', () => closeDrawer('shiftReportDrawerOverlay'));
document.getElementById('shiftReportDrawerOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'shiftReportDrawerOverlay') closeDrawer('shiftReportDrawerOverlay');
});

/* =========================================================================
   CONFERÊNCIA DO DIA (GU) — módulo movido para conf-dia.js (carregado
   depois deste arquivo no index.html). Usa o gu-parser.js compartilhado.
========================================================================= */

/* =========================================================================
   CALCULADORA DE OVERLAY
   Reproduz exatamente a fórmula da planilha de conferência terceira: cada linha
   (Buy-in/Rebuys/Add-on) entra no pote já com o rake descontado por unidade
   (valor_liquido = valor_bruto × (1 - rake%); total_linha = ações × valor_liquido).
   Overlay = Pote − Garantido, mas só é exibido quando Pote < Garantido — igual à
   planilha original, que deixa a célula em branco quando o pote cobre o garantido.
   Rake: Main/Side = 10% (12% com campanha #AS/+SPS/+SPT) · Satélite = sempre 5%.
========================================================================= */
function ovcRakePercent(){
  const cat = document.getElementById('ovcCategoria').value;
  const campanha = document.getElementById('ovcCampanha').checked;
  if (cat === 'sat') return 0.05; // satélite sempre 5%, campanha não altera
  return campanha ? 0.12 : 0.10;
}
function ovcNum(id){
  const v = parseFloat(document.getElementById(id).value);
  return isNaN(v) ? 0 : v;
}
function ovcCalculate(){
  const rake = ovcRakePercent();
  document.getElementById('ovcRakeNote').textContent = `Rake aplicado: ${(rake*100).toFixed(0)}%`;

  const lines = [
    {acoesId:'ovcBuyinAcoes', valorId:'ovcBuyinValor', totalId:'ovcBuyinTotal'},
    {acoesId:'ovcRebuysAcoes', valorId:'ovcRebuysValor', totalId:'ovcRebuysTotal'},
    {acoesId:'ovcAddonAcoes', valorId:'ovcAddonValor', totalId:'ovcAddonTotal'},
  ];
  let pote = 0;
  lines.forEach(l => {
    const acoes = ovcNum(l.acoesId);
    const valor = ovcNum(l.valorId);
    const valorLiquido = valor * (1 - rake);
    const total = acoes * valorLiquido;
    pote += total;
    const totalEl = document.getElementById(l.totalId);
    totalEl.innerHTML = (acoes || valor)
      ? `R$ ${fmtBRL(total, 2)} <small>(${fmtBRL(acoes,0)} × R$${fmtBRL(valorLiquido,2)})</small>`
      : '—';
  });

  const garantido = ovcNum('ovcGarantido');
  document.getElementById('ovcPote').textContent = `R$ ${fmtBRL(pote, 2)}`;
  document.getElementById('ovcGarantidoOut').textContent = `R$ ${fmtBRL(garantido, 2)}`;

  const row = document.getElementById('ovcOverlayRow');
  const out = document.getElementById('ovcOverlayOut');
  const labelEl = document.getElementById('ovcOverlayLabel');

  if(garantido > 0 && pote < garantido){
    const overlay = garantido - pote;
    out.textContent = `-R$ ${fmtBRL(overlay, 2)}`;
    if(labelEl) labelEl.textContent = 'Overlay';
    row.classList.add('has-overlay'); row.classList.remove('no-overlay');
  } else if(garantido > 0){
    const excess = pote - garantido;
    out.textContent = excess > 0 ? `+R$ ${fmtBRL(excess, 2)} acima` : 'Sem overlay 🎉';
    if(labelEl) labelEl.textContent = 'Resultado';
    row.classList.add('no-overlay'); row.classList.remove('has-overlay');
  } else {
    out.textContent = '—';
    if(labelEl) labelEl.textContent = 'Overlay';
    row.classList.remove('has-overlay','no-overlay');
  }

  ovcAutoApplyToCard(pote);
}

/* Quando um torneio da agenda está selecionado no seletor da calculadora, o Pote arrecadado
   é aplicado automaticamente na premiação daquele card — evita ter que copiar o valor à mão.
   Debounced pra não gravar no Firebase a cada tecla digitada. */
function ovcAutoApplyToCard(pote){
  const key = document.getElementById('ovcTorneioSelect')?.value;
  const badge = document.getElementById('ovcSyncBadge');
  clearTimeout(window._ovcApplyTimer);
  if(!key || !(pote > 0)){
    if(badge) badge.classList.remove('show');
    return;
  }
  const tRow = rowByKey(key);
  if(!tRow) return;
  window._ovcApplyTimer = setTimeout(() => {
    applyPremiacaoValue(key, pote, `<b>${OPERATOR_NAME||'Você'}</b> preencheu premiação de <b>${tRow.nome||key}</b> via Calculadora de Overlay: R$ ${fmtBRL(pote,0)}`);
    if(badge){
      badge.querySelector('span').textContent = `Pote aplicado à premiação de "${tRow.nome}"`;
      badge.classList.add('show', 'pulse');
      setTimeout(() => badge.classList.remove('pulse'), 600);
    }
  }, 500);
}

document.querySelectorAll('#overlayCalcDrawer input, #overlayCalcDrawer select').forEach(el => {
  el.addEventListener('input', ovcCalculate);
  el.addEventListener('change', ovcCalculate);
});
ovcCalculate();

/* limpa todos os campos da calculadora — chamada tanto pelo botão "Limpar" quanto automaticamente
   ao fechar a gaveta, como camada extra de proteção contra o bug de valores "grudados" de um cálculo
   anterior contaminando o próximo sem o operador perceber */
function ovcClear(){
  ['ovcGarantido','ovcBuyinAcoes','ovcBuyinValor','ovcRebuysAcoes','ovcRebuysValor','ovcAddonAcoes','ovcAddonValor'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.getElementById('ovcCategoria').value = 'main';
  document.getElementById('ovcCampanha').checked = false;
  const sel = document.getElementById('ovcTorneioSelect');
  if(sel) sel.value = '';
  document.getElementById('ovcTourMatch')?.classList.remove('show');
  document.getElementById('ovcTourNotFound')?.classList.remove('show');
  const ai = document.getElementById('ovcAutoInfo');
  if(ai){ ai.innerHTML = ''; ai.hidden = true; }
  ovcCalculate();
}
document.getElementById('ovcClearBtn').addEventListener('click', () => {
  ovcClear();
  showToast('Calculadora limpa.');
});

/* ── Garantido editável nos cards ── */
function fmtGarantidoBRL(n){
  // 24780.80 → "R$ 24.780,80"
  if(n == null || isNaN(n)) return '—';
  return 'R$ ' + Number(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function parseGarantidoInput(str){
  // aceita: "24780,80" | "24.780,80" | "R$ 24.780,80" | "24780.80"
  const clean = String(str||'').replace(/R\$\s*/g,'').trim().replace(/\./g,'').replace(',','.');
  return parseFloat(clean);
}

function startEditGarantido(displayEl){
  const wrap  = displayEl.closest('.tcard-garantido-wrap');
  const input = wrap.querySelector('.tcard-garantido-input');
  const key   = input.dataset.key;
  const current = getGarantidoEffective(key);
  // mostra o número bruto para edição (sem R$ e pontos) → mais fácil digitar
  input.value = current != null ? String(current).replace('.',',') : '';
  displayEl.style.display = 'none';
  input.style.display = '';
  input.focus();
  input.select();
  // marca que está em edição ativa
  input._editing = true;
}

function onGarantidoInput(input){
  // formata enquanto digita
  const raw = input.value;
  // não interrompe digitação — só mostra preview formatado no placeholder
  // salva com debounce
  clearTimeout(input._saveTimer);
  input._saveTimer = setTimeout(() => {
    const n = parseGarantidoInput(raw);
    if(!isNaN(n) && n > 0){
      _applyGarantidoValue(input, n);
    }
  }, 800);
}

function onGarantidoKeydown(e){
  if(e.key === 'Enter'){
    e.preventDefault();
    const n = parseGarantidoInput(e.target.value);
    if(!isNaN(n) && n > 0) _applyGarantidoValue(e.target, n);
    else closeGarantidoInput(e.target);
  }
  if(e.key === 'Escape'){
    cancelEditGarantido(e.target);
  }
}

function _applyGarantidoValue(input, n){
  const key  = input.dataset.key;
  const wrap = input.closest('.tcard-garantido-wrap');
  const disp = wrap.querySelector('.tcard-garantido-display');
  setGarantidoOverride(key, n);
  disp.textContent = fmtGarantidoBRL(n);
  wrap.classList.add('tcard-garantido-edited');
  const row = rowByKey(key);
  if(row) renderCardOverlayPreview(key, row, row.premiacao, getField(key));
  ovcPopulateTournamentSelect();
  // formata o input também
  input.value = fmtGarantidoBRL(n);
  // fecha o input após Enter; ao perder foco (incluindo Alt+Tab) NÃO fecha
  // — só fecha explicitamente
}

function closeGarantidoInput(input){
  const wrap = input.closest('.tcard-garantido-wrap');
  if(!wrap) return;
  const disp = wrap.querySelector('.tcard-garantido-display');
  input.style.display = 'none';
  disp.style.display = '';
  input._editing = false;
}

function onGarantidoBlur(input){
  // Alt+Tab → visibilitychange, não fechar o input
  // Só salva se saiu do campo de verdade (clicou em outro elemento no mesmo documento)
  // relatedTarget é null quando a janela perde foco → ignora
  // relatedTarget é algo dentro do painel → salva e fecha
  setTimeout(() => {
    // após o timeout, verifica se o foco foi para outro elemento dentro da página
    // se o documento perdeu foco (Alt+Tab), document.hasFocus() === false
    if(!document.hasFocus()){
      // janela perdeu foco (Alt+Tab, outra app) — NÃO fecha o input nem descarta o valor
      return;
    }
    // saiu para outro elemento na página → salva e fecha
    const raw = input.value;
    const n = parseGarantidoInput(raw);
    if(!isNaN(n) && n > 0) _applyGarantidoValue(input, n);
    closeGarantidoInput(input);
  }, 50);
}

function cancelEditGarantido(input){
  const wrap  = input.closest('.tcard-garantido-wrap');
  const display = wrap.querySelector('.tcard-garantido-display');
  input.style.display = 'none';
  display.style.display = '';
  input._editing = false;
}

// alias para o onblur inline do HTML
function commitGarantido(input){ onGarantidoBlur(input); }

// Carrega overrides de garantido do Firebase ao iniciar
function loadSavedGarantidos(){
  if(!fbReady) return;
  fbDb.ref(`${FB_BASE_PATH}/garantido`).once('value').then(snap => {
    const data = snap.val();
    if(!data) return;
    Object.entries(data).forEach(([key, val]) => {
      GARANTIDO_MAP[key] = val;
      const row = rowByKey(key);
      if(row) row.garantido = val;
      // atualiza display no DOM se já renderizado
      const wrap = document.querySelector(`.tcard-garantido-wrap[data-key="${key}"]`);
      if(wrap){
        const display = wrap.querySelector('.tcard-garantido-display');
        if(display) display.textContent = 'R$ ' + fmtBRL(val);
        wrap.classList.add('tcard-garantido-edited');
      }
    });
    saveGarantidoMapLocal(GARANTIDO_MAP);
    computeStats();
    ovcPopulateTournamentSelect();
  });
}

// Firebase listener em tempo real para garantido

/* aplica um valor de premiação a um torneio (por _key) e propaga pra tudo que depende dela —
   usada tanto pela digitação manual no card quanto pelo auto-preenchimento da Calculadora de Overlay */
function applyPremiacaoValue(key, premiacaoVal, activityMsg){
  if (roGuard()) return;
  const row = rowByKey(key);
  if(!row) return;
  row.premiacao = premiacaoVal;
  stampPremBy(key); // quem preencheu a premiação vira o responsável exibido nos Resultados
  if(fbReady){
    suppressUpcomingEcho();
    fbDb.ref(`${FB_BASE_PATH}/premiacao/${key}`).set(premiacaoVal);
  }
  // Persistir premiação no localStorage (garantia mesmo sem Firebase)
  try {
    const pm = JSON.parse(localStorage.getItem('suprema_prem_v1') || '{}');
    pm[key] = premiacaoVal;
    localStorage.setItem('suprema_prem_v1', JSON.stringify(pm));
  } catch(e){}
  // Recalcular RESULTS e UPCOMING
  RESULTS  = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
  UPCOMING = [...RAW_ROWS];
  UNFIXED  = computeUnfixed();
  document.getElementById('statUnfixed').textContent = UNFIXED.length;
  computeStats(); // o operador digitar uma premiação precisa refletir em "Pago em premiações"/Overlay na hora
  updateProgress();
  renderUnfixed();
  // Atualizar card in-place — sem remover do DOM
  renderCardOverlayPreview(key, row, premiacaoVal, getField(key));
  // Sincronizar o(s) input(s) de premiação visíveis (card normal + linha compacta)
  document.querySelectorAll(`.tcard-prem-input[data-key="${key}"]`).forEach(inp => {
    if(document.activeElement !== inp){
      inp.value = fmtBRL(premiacaoVal, premiacaoVal%1===0?0:2);
      inp.classList.add('has-value');
    }
  });
  // Atualizar badge de premiação
  const _badge = document.querySelector(`.tcard[data-key="${key}"] .tcard-prem-badge`);
  if(_badge){
    _badge.textContent = '✓ R$ ' + fmtBRL(premiacaoVal, premiacaoVal%1===0?0:2);
  } else {
    const _catDiv = document.querySelector(`.tcard[data-key="${key}"] .tcard-cat`);
    if(_catDiv){ const _b=document.createElement('span'); _b.className='tcard-prem-badge'; _b.textContent='✓ R$ '+fmtBRL(premiacaoVal,0); _catDiv.appendChild(_b); }
  }
  // Atualizar classe do card
  const _card = document.querySelector(`.tcard[data-key="${key}"]`);
  if(_card) _card.classList.toggle('has-premiacao', true);
  debouncedRenderResults();
  computeStats();
  appendTodayToHistorico();
  if(activityMsg) logActivity(activityMsg, '💰');
  checkDayComplete();
}

/* Marca o torneio como "Não formou" — reaproveita o mecanismo já existente do campo ID
   (getId(key)==='NF' é checado em todo o app pra decidir se um card é NF), só que disparado
   a partir do campo Premiação, que é onde os operadores realmente costumam digitar "NF". */
function markExplicitNF(key){
  setId(key, 'NF');
  document.querySelectorAll(`.id-input[data-key="${key}"]`).forEach(inp => { inp.value = 'NF'; });
  document.querySelectorAll(`.tcard[data-key="${key}"]`).forEach(card => {
    card.classList.add('is-nf');
    if(!card.querySelector('.tcard-nf-banner')){
      const b = document.createElement('div');
      b.className = 'tcard-nf-banner';
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Não formou`;
      card.prepend(b);
    }
    const nameRow = card.querySelector('.tcard-name-row');
    if(nameRow && !card.querySelector('.tcard-nf-badge')){
      const sp = document.createElement('span');
      sp.className = 'tcard-nf-badge'; sp.textContent = 'NF';
      nameRow.appendChild(sp);
    }
  });
  document.querySelectorAll(`.compact-table tbody tr[data-key="${key}"]`).forEach(tr => tr.classList.add('is-nf'));
  computeStats();
  showToast('Marcado como "Não formou".');
}

/* rede contra erro de digitação: premiação muito fora do garantido (dedo a mais / a menos)
   ganha borda amarela + toast na hora, em vez de só aparecer errada no fechamento da semana.
   É AVISO, não bloqueio — valores fora da faixa existem de verdade (overlay pesado, prêmio extra) */
function warnIfPremSuspeita(input, row, val){
  const gar = getGarantidoEffective(row._key) ?? row.garantido;
  if (gar == null || gar <= 0) return;
  const suspeito = val > gar * 5 || val < gar * 0.2;
  input.classList.toggle('prem-suspeita', suspeito);
  if (suspeito && input._lastWarnVal !== val){
    input._lastWarnVal = val;
    showToast(`⚠ Premiação de ${row.nome}: R$ ${fmtBRL(val,0)} está muito fora do garantido (R$ ${fmtBRL(gar,0)}) — confira se não foi erro de digitação.`, true);
  }
}

function onCardPremiacaoInput(input){
  const key = input.dataset.key;
  const row = rowByKey(key);
  if(!row) return;
  // parsePremInput entende "2543,20", "2.543,20", "2543.20"
  const premiacaoVal = parsePremInput(input);
  // Renderiza preview imediatamente com o valor atual do input
  renderCardOverlayPreview(key, row, premiacaoVal != null ? premiacaoVal : row.premiacao, getField(key));
  clearTimeout(input._saveTimer);
  input._saveTimer = setTimeout(() => {
    // "NF" digitado na premiação é um atalho comum pra marcar não formou — em vez de tentar
    // interpretar como número (e não fazer nada, como acontecia antes), aplica o marcador de NF
    // e limpa o campo (NF não é um valor de premiação, o marcador fica no campo ID)
    if(input.value.trim().toUpperCase() === 'NF'){
      markExplicitNF(key);
      input.value = '';
      return;
    }
    const premiacaoVal = parsePremInput(input);
    if(premiacaoVal != null && premiacaoVal > 0){
      warnIfPremSuspeita(input, row, premiacaoVal);
      applyPremiacaoValue(key, premiacaoVal, `<b>${OPERATOR_NAME||'Você'}</b> preencheu premiação de <b>${row?.nome||key}</b>: R$ ${fmtBRL(premiacaoVal,0)}`);
    } else if(input.value.trim() === '' && row.premiacao){
      // input apagado — mantém preview com valor salvo, não descarta
      renderCardOverlayPreview(key, row, row.premiacao, getField(key));
    } else {
      row.premiacao = null;
      if(fbReady) fbDb.ref(`${FB_BASE_PATH}/premiacao/${key}`).remove();
      // Remover do localStorage também
      try {
        const pm = JSON.parse(localStorage.getItem('suprema_prem_v1') || '{}');
        delete pm[key];
        localStorage.setItem('suprema_prem_v1', JSON.stringify(pm));
      } catch(e){}
    }
  }, 300);
}

function onCardFieldInput(input){
  const key = input.dataset.key;
  const val = input.value.trim();
  setField(key, val);
  const row = rowByKey(key);
  if(!row) return;
  // Patch in-place — não recriar o card
  renderCardOverlayPreview(key, row, row.premiacao, val ? parseInt(val,10) : null);
}

/* Calcula e exibe o preview de overlay/ações/perf no card.
   Field = quantidade de jogadores (usado no cálculo de ações)
   Ações = quantas ações foram geradas (calculado via buyin ou field) */
function renderCardOverlayPreview(key, row, premiacaoVal, fieldVal){
  const el = document.getElementById(`tcard-ov-${key}`);
  if(!el) return;

  const prem  = parseFloat(premiacaoVal);
  const field = parseInt(fieldVal);       // jogadores
  const gar   = row.garantido || 0;
  const buyin = parseFloat(row.buyin) || 0;
  const cat   = classify(row);
  const rake  = calcRake(row);
  const isCamp = hasCampanha(row);

  // Sempre exibe os 3 campos — mostra "—" quando sem dados

  /* Ações = premiação ÷ buy-in líquido. A regra (multiplicador por categoria,
     estimativa por field, quando devolver null) mora em painel-calc.js, coberta
     por painel-calc.test.js — foi aqui que o 0.90 divergiu do comentário sem
     ninguém notar. Não reimplemente: chame o módulo. */
  const acoes = PainelCalc.acoes({ premiacao: prem, buyin, field, cat, isCamp });

  // Overlay — sempre visível
  const overlay = calcOverlay(prem, gar);
  const ovFinal = overlay != null
    ? `<div class="tcard-ov-cell">
        <span class="tcard-ov-label">${overlay < 0 ? 'Overlay' : 'Excedente'}</span>
        <span class="tcard-ov-val ${overlay < 0 ? 'negative' : 'positive'}">${fmtOverlay(overlay)}</span>
       </div>`
    : `<div class="tcard-ov-cell">
        <span class="tcard-ov-label">Overlay</span>
        <span class="tcard-ov-val muted">—</span>
       </div>`;

  // Ações — sempre visível
  const acoesFinal = acoes != null
    ? `<div class="tcard-ov-cell">
        <span class="tcard-ov-label">Ações</span>
        <span class="tcard-ov-val gold">${fmtBRL(acoes,0)}</span>
       </div>`
    : `<div class="tcard-ov-cell">
        <span class="tcard-ov-label">Ações</span>
        <span class="tcard-ov-val muted">—</span>
       </div>`;

  // Perf — sempre visível
  const perf2 = (!isNaN(prem) && prem > 0 && gar > 0) ? ((prem - gar) / gar) * 100 : null;
  const perfFinal = perf2 != null
    ? `<div class="tcard-ov-cell">
        <span class="tcard-ov-label">Perf.</span>
        <span class="tcard-ov-val ${perf2 >= 0 ? 'positive' : 'negative'}">${perf2 >= 0 ? '+' : ''}${perf2.toFixed(1)}%</span>
       </div>`
    : `<div class="tcard-ov-cell">
        <span class="tcard-ov-label">Perf.</span>
        <span class="tcard-ov-val muted">—</span>
       </div>`;

  el.innerHTML = ovFinal + acoesFinal + perfFinal;

  // Atualizar overlay na linha compacta se existir
  const tciOv = document.getElementById('tci-ov-' + key);
  if(tciOv){
    tciOv.className = 'ctr-ov' + (overlay!=null?(overlay<0?' neg':' pos'):'');
    tciOv.textContent = overlay!=null ? fmtOverlay(overlay) : '—';
  }
}

// carrega premiações salvas do Firebase ao iniciar
function loadSavedPremiacoes(){
  if(!fbReady) return;
  fbDb.ref(`${FB_BASE_PATH}/premiacao`).once('value').then(snap => {
    const data = snap.val();
    if(!data) return;
    Object.entries(data).forEach(([key, val]) => {
      const row = rowByKey(key);
      if(row){
        // Firebase é fonte de verdade — sempre aplica (pode ter dados mais recentes do parceiro)
        row.premiacao = val;
        // Atualizar localStorage para manter em sincronia
        try {
          const pm = JSON.parse(localStorage.getItem('suprema_prem_v1') || '{}');
          pm[key] = val;
          localStorage.setItem('suprema_prem_v1', JSON.stringify(pm));
        } catch(e){}
        const inp = document.querySelector(`.tcard-prem-input[data-key="${key}"]`);
        if(inp && document.activeElement !== inp) inp.value = val;
        renderCardOverlayPreview(key, row, val, getField(key));
      }
    });
    RESULTS  = RAW_ROWS.filter(r => r.premiacao !== null && r.premiacao !== undefined);
    UPCOMING = [...RAW_ROWS];
    computeStats();
    renderResults();
    if(!isTypingInCard()) renderUpcoming();
  });
  // também carrega field
  fbDb.ref(`${FB_BASE_PATH}/field`).once('value').then(snap => {
    const data = snap.val();
    if(!data) return;
    Object.entries(data).forEach(([key, val]) => {
      FIELD_MAP[key] = val;
      const row = rowByKey(key);
      if(row) row.field = val;
      const inp = document.querySelector(`.tcard-field-input[data-key="${key}"]`);
      if(inp && !inp.value) inp.value = val;
      if(row) renderCardOverlayPreview(key, row, row.premiacao, val);
    });
    saveFieldMapLocal(FIELD_MAP);
  });
}
function ovcSaveToHistory(){
  const sel = document.getElementById('ovcTorneioSelect');
  const row = sel?.value ? rowByKey(sel.value) : null;
  const nome = row?.nome || document.getElementById('ovcGarantidoOut').textContent !== 'R$ 0,00' ? (row?.nome || 'Torneio manual') : null;
  if(!nome){ showToast('Selecione um torneio antes de salvar.', true); return; }
  const garantido = ovcNum('ovcGarantido');
  if(!garantido){ showToast('Preencha o garantido antes de salvar.', true); return; }
  const pote = parseFloat(document.getElementById('ovcPote').textContent.replace(/[^\d,]/g,'').replace(',','.')) || 0;
  const overlayEl = document.getElementById('ovcOverlayOut');
  const overlayText = overlayEl.textContent;
  const hasOverlay = overlayEl.closest('#ovcOverlayRow')?.classList.contains('has-overlay');
  const entry = {
    nome, garantido, pote: Math.round(pote * 100)/100,
    overlay: overlayText,
    hasOverlay: !!hasOverlay,
    operador: OPERATOR_NAME || 'Operador',
    at: Date.now(),
    hora: row?.hora || '',
  };
  const id = 'ov_' + entry.at;
  if(fbReady){
    fbDb.ref(`${FB_BASE_PATH}/overlayHistory/${id}`).set(entry)
      .then(() => { showToast('Overlay salvo no histórico.'); ovcRenderHistory(); })
      .catch(() => showToast('Salvo só neste navegador.', true));
  } else {
    showToast('Sem conexão — não foi possível salvar.', true);
    return;
  }
}

function ovcRenderHistory(){
  const container = document.getElementById('ovcHistoryList');
  if(!container) return;
  if(!fbReady){ container.innerHTML = '<div style="font-size:12px;color:var(--ink-soft);text-align:center;padding:12px 0;">Sem conexão.</div>'; return; }
  fbDb.ref(`${FB_BASE_PATH}/overlayHistory`).once('value').then(snap => {
    const data = snap.val();
    if(!data){ container.innerHTML = '<div style="font-size:13px;color:var(--ink-soft);text-align:center;padding:16px 0;">Nenhum cálculo salvo ainda.</div>'; return; }
    const entries = Object.entries(data).map(([id,e]) => ({...e,id})).sort((a,b) => b.at - a.at);
    container.innerHTML = entries.map(e => {
      const t = new Date(e.at);
      const hhmm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
      const overlayColor = e.hasOverlay ? 'var(--red)' : 'var(--felt)';
      return `<div style="padding:10px 12px;border-radius:10px;background:var(--bg);border:1px solid var(--hairline);display:flex;align-items:flex-start;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:650;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(e.nome)}</div>
          <div style="font-size:11.5px;color:var(--ink-soft);font-family:var(--mono);margin-top:2px;">
            ${e.hora ? e.hora + ' · ' : ''}Garantido R$ ${fmtBRL(e.garantido,0)} · Pote R$ ${fmtBRL(e.pote,2)}
          </div>
          <div style="font-size:11px;color:var(--ink-soft);margin-top:2px;">${e.operador} · ${hhmm}</div>
        </div>
        <div style="font-size:13px;font-weight:700;color:${overlayColor};white-space:nowrap;text-align:right;">${escHtml(e.overlay)}</div>
      </div>`;
    }).join('');
  });
}

document.getElementById('ovcSaveHistBtn')?.addEventListener('click', ovcSaveToHistory);
document.getElementById('ovcClearHistBtn')?.addEventListener('click', () => {
  if(!confirm('Limpar todo o histórico de overlay do dia?')) return;
  if(fbReady) fbDb.ref(`${FB_BASE_PATH}/overlayHistory`).remove().then(() => { ovcRenderHistory(); showToast('Histórico limpo.'); });
});

// carrega histórico quando a gaveta abre
document.getElementById('overlayCalcToggle').addEventListener('click', () => {
  openDrawer('overlayCalcDrawerOverlay');
  ovcRenderHistory();
});

document.getElementById('overlayCalcDrawerClose').addEventListener('click', () => {
  closeDrawer('overlayCalcDrawerOverlay');
  // não limpa ao fechar — mantém o estado para o operador poder reabrir sem perder o cálculo
});
document.getElementById('overlayCalcDrawerOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlayCalcDrawerOverlay'){
    closeDrawer('overlayCalcDrawerOverlay');
  }
});
document.getElementById('ovcCopyBtn').addEventListener('click', () => {
  const sel = document.getElementById('ovcTorneioSelect');
  const row = sel?.value ? rowByKey(sel.value) : null;
  const nome = row?.nome || 'Torneio';
  const rakePct = (ovcRakePercent()*100).toFixed(0);
  const pote = document.getElementById('ovcPote').textContent;
  const garantido = document.getElementById('ovcGarantidoOut').textContent;
  const overlay = document.getElementById('ovcOverlayOut').textContent;
  const text = `${nome}\nRake: ${rakePct}%\nColocou no pote: ${pote}\nGarantido: ${garantido}\nOverlay: ${overlay}`;
  copyToClipboard(text, null, 'Resultado da calculadora copiado.');
});

/* =========================================================================
   UTILITÁRIOS DE PLANILHA — normText, readSheetMatrix, cellToHHMM,
   timeToMinutes e allWeekdayNamesNorm vêm de gu-parser.js (parser
   compartilhado com a Criação Noturna, carregado antes deste arquivo).
   Aqui fica só o que é ESPECÍFICO da grade MTTS BRAZIL do painel.
========================================================================= */
/* acha os índices de linha onde cada dia da semana começa, na coluna A (col índice 0) —
   mesmo padrão usado nas duas planilhas (Global e Liga Principal), só muda o idioma do nome do dia.
   NOME PRÓPRIO deste arquivo: o gu-parser tem um findWeekdaySectionRange de outra assinatura
   (por índice da coluna do nome) — este aqui é o da grade MTTS BRAZIL, colunas fixas A/C */
function findGlobalSectionRange(matrix, weekdayName){
  const norm = normText(weekdayName);
  // linha de CABEÇALHO de seção = nome do dia na coluna A e também na coluna do nome (C) ou C vazia.
  // A coluna A sozinha não basta: a Global repete o dia ("   QUINTA-FEIRA") como rótulo decorativo
  // em várias linhas de torneio, e isso não pode contar como início de seção nem como duplicata
  const isHeaderRow = (row) => {
    const a = row && row[0], c = row && row[2];
    if (!(typeof a === 'string' && normText(a) === norm)) return false;
    return c === null || c === undefined || c === '' || (typeof c === 'string' && normText(c) === norm);
  };
  let startRow = -1, endRow = matrix.length, duplicate = false;
  for (let i = 0; i < matrix.length; i++){
    if (isHeaderRow(matrix[i])){
      if (startRow === -1) startRow = i;
      else { duplicate = true; break; } // um segundo CABEÇALHO do mesmo dia mais abaixo — ambíguo, avisar
    }
  }
  if (startRow === -1) return null;
  // procura o início do próximo dia da semana (qualquer um dos 7 nomes) depois de startRow, pra fechar o range
  const allNames = [...WEEKDAYS_PT, ...WEEKDAYS_EN].map(normText);
  for (let i = startRow+1; i < matrix.length; i++){
    const a = matrix[i] && matrix[i][0];
    if (typeof a === 'string' && allNames.includes(normText(a)) && normText(a) !== norm){
      endRow = i;
      break;
    }
  }
  return {startRow, endRow, duplicate};
}

/* cellToHHMM (fração de dia/Date/string → "HH:MM") vem de gu-parser.js */

/* extrai Main/Side/Sat da seção de um dia da Global MTT (MTTS BRAZIL), já dividido pelo multiplicador */
function extractGlobalDaySection(matrix, weekdayName, divisor){
  const range = findGlobalSectionRange(matrix, weekdayName);
  if (!range) return null;
  const main = [], side = [], sat = [], unknown = [], semHora = [], aposGap = [];
  let currentGroupHeader = null; // cabeçalho do grupo de satélite atual (coluna A), propagado até a próxima linha em branco
  let lastHora = null; // Excel mescla a célula de horário quando várias linhas compartilham o mesmo horário —
                        // SheetJS só devolve o valor na primeira linha da mesclagem, as outras vêm null mesmo
                        // a planilha estando correta; herda o último horário visto até o próximo separador em branco
  let emptyCount = 0;
  for (let i = range.startRow; i < range.endRow; i++){
    const row = matrix[i];
    if (!row || row.every(v => v === null || v === undefined || v === '' || v === ' ')){
      currentGroupHeader = null;
      lastHora = null;
      emptyCount++;
      // Bloco grande de linhas vazias separa a grade dos "torneios especiais" — a leitura para aqui,
      // mas NÃO em silêncio: tudo que parece torneio dali pra baixo é registrado em aposGap, pra
      // avisar o operador que existem linhas depois do vão que ficaram de fora
      if(emptyCount >= 5){
        for (let j = i; j < range.endRow; j++){
          const r = matrix[j];
          if (!r) continue;
          // início da zona de EVENTOS FUTUROS (data serial/Date na coluna A, ou o rótulo
          // "EVENTOS FUTUROS"/"P&D"): dali pra baixo é tudo futuro, não é torneio do dia —
          // encerra o scan sem virar aviso
          const a = r[0];
          if (a instanceof Date || (typeof a === 'number' && a > 40000 && a < 60000)) break;
          if (isFutureSectionLabel(a) || isFutureSectionLabel(r[2])) break;
          const nm = r[2];
          const hr = cellToHHMM(r[1]);
          if (typeof nm === 'string' && nm.trim() && hr && !allWeekdayNamesNorm().includes(normText(nm))){
            aposGap.push({nome: nm.trim(), hora: hr});
          }
        }
        break;
      }
      continue;
    }
    emptyCount = 0; // resetar contador de vazias
    const colA = row[0];
    let hora = cellToHHMM(row[1]);
    const nome = row[2];
    const tipo = row[3];
    const garantidoRaw = row[6];
    const buyinRaw = row[7];
    const lateHH = cellToHHMM(row[17]); // coluna R da Global = fim do late register (fração de dia)

    // FIM DA GRADE: o rótulo "EVENTOS FUTUROS" (ou "P&D") abre a seção de eventos futuros
    // no rodapé da Global — dali pra baixo NADA é torneio do dia. Encerra a leitura aqui
    // (sem virar aviso de "sem horário"/"após o vão"), igual ao P&D na aba G MTTS.
    if (isFutureSectionLabel(colA) || isFutureSectionLabel(nome)) break;

    // Pular linhas onde colA é uma data (torneios especiais/futuros — não são da grade regular)
    // SheetJS representa datas como Date objects ou números seriais Excel (>40000)
    if (colA instanceof Date || (typeof colA === 'number' && colA > 40000 && colA < 60000)) continue;
    // Também pular se colA é string no formato de data "YYYY-MM-DD"
    if (typeof colA === 'string' && /^\d{4}-\d{2}-\d{2}/.test(colA.trim())) continue;

    // linha totalmente vazia = separador entre grupos de satélite, fecha o grupo atual
    if (!nome && !hora && (colA === null || colA === undefined)){ currentGroupHeader = null; continue; }

    // Linha de cabeçalho do dia: o nome do dia aparece na coluna do NOME do torneio (col C) —
    // só essa linha é pulada. IMPORTANTE: a coluna A repete o nome do dia ("   QUINTA-FEIRA")
    // como rótulo decorativo em VÁRIAS linhas de torneio reais, então colA com nome de dia
    // NÃO pode derrubar a linha (esse era o bug que fazia dezenas de torneios sumirem do relatório)
    if (typeof nome === 'string' && allWeekdayNamesNorm().includes(normText(nome))) continue;

    // coluna A preenchida com texto que não é nome de dia = início de um novo grupo de satélite
    if (typeof colA === 'string' && colA.trim() && !allWeekdayNamesNorm().includes(normText(colA))){
      currentGroupHeader = colA.trim();
    }

    if (!nome || typeof nome !== 'string') continue;
    if (['SÁBADO','DOMINGO','SATÉLITE','SATELLITE'].includes(nome.trim().toUpperCase())) continue;
    if (normText(nome) === 'suspenso') continue;
    // célula de horário mesclada no Excel: herda o último horário visto no bloco atual em vez de
    // marcar como "sem horário" (a planilha está certa, só a leitura crua da célula vem vazia)
    if (!hora && lastHora) hora = lastHora;
    else if (hora) lastHora = hora;
    // nome de torneio válido mas sem horário reconhecível de forma alguma (nem herdado) — não descartar
    // em silêncio: guarda separado pra avisar que um torneio ficou de fora por falta de horário
    if (!hora){ semHora.push({nome: nome.trim(), hora: row[1], tipo}); continue; }
    // arredondado a 2 casas aqui (não só na exibição) pra não gravar dízima de ponto flutuante
    // (ex: 199.99999999999997) na planilha exportada
    const garantido = typeof garantidoRaw === 'number' ? Math.round((garantidoRaw / divisor) * 100) / 100 : null;
    const buyin = typeof buyinRaw === 'number' ? Math.round((buyinRaw / divisor) * 100) / 100 : null;
    const entry = {nome: nome.trim(), hora, garantido, buyin, late: lateHH || null, groupHeader: currentGroupHeader};
    // classificação TOLERANTE por radical (a Global é digitada a mão: "Main event", "MAIN",
    // "Satelite" sem acento, "Satellite", "SAT"...). Casar string exata jogava tudo isso pra
    // "unknown" e o torneio sumia do relatório. Só um tipo realmente fora dos radicais vira unknown.
    const tipoNorm = normText(tipo);
    if (tipoNorm.includes('main')) main.push(entry);
    else if (tipoNorm.includes('side')) side.push(entry);
    else if (tipoNorm.includes('sat')) sat.push(entry);
    // tipo não bate com nenhuma categoria conhecida (typo na Global, coluna deslocada etc.) — não descartar
    // em silêncio: guarda como "unknown" pra quem chamou poder avisar que um torneio ficou de fora
    else unknown.push({...entry, tipo});
  }
  const extractedCount = main.length + side.length + sat.length + unknown.length;
  return {main, side, sat, unknown, semHora, aposGap, duplicateSection: range.duplicate, rowsInSection: range.endRow - range.startRow, extractedCount};
}

/* allWeekdayNamesNorm vem de gu-parser.js */

/* autoteste do parser da Global: roda uma vez por carregamento com uma mini-planilha embutida
   que reproduz as armadilhas do arquivo real — nome do dia repetido como rótulo decorativo na
   coluna A (o bug que derrubou dezenas de torneios do relatório), lixo na coluna A ("Total GTD",
   números), linha "suspenso", horário mesclado, tipo não reconhecido, grupo de satélite e
   torneio depois do vão de linhas vazias. Se uma edição futura quebrar qualquer regra dessas,
   o alerta aparece no carregamento — não numa conferência errada em produção */
(function extractGlobalSelfTest(){
  const H14 = 14/24, H16 = 16/24, H10 = 10/24, H11 = 11/24, H12 = 12/24, H13 = 13/24;
  const fx = [
    ['QUINTA-FEIRA', null, 'QUINTA-FEIRA', null, null, null, null, null],          // cabeçalho real da seção
    ['QUINTA-FEIRA', H14, '#AS Teste Main', 'Main Event', null, null, 25000, 110], // colA decorativa NÃO pode derrubar a linha
    ['Total GTD', H16, 'Teste Main 2', 'Main Event', null, null, 40000, 75],       // lixo na colA
    ['   QUINTA-FEIRA', H16, 'suspenso', null, null, null, null, 800],             // suspenso é pulado
    [null, H10, 'Teste Side', 'Side Event', null, null, 1000, 10],
    [null, null, 'Teste Side Mesclado', 'Side Event', null, null, 500, 5],         // herda o horário 10:00 da linha acima
    [null, H11, 'Teste Tipo Errado', 'Tipo Inexistente', null, null, 100, 1],      // vai pro bucket unknown, não some
    [null, null, null, null, null, null, null, null],
    ['#Grupo Sat', H12, 'Teste Sat', 'SAT', null, null, 60, 0.8],                  // colA vira cabeçalho de grupo
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],                              // 5º vazia → corta a leitura
    [null, H13, 'Depois do Vao', 'Side Event', null, null, 100, 1],                // tem que aparecer em aposGap
    ['SEXTA-FEIRA', null, 'SEXTA-FEIRA', null, null, null, null, null],            // fecha a seção
  ];
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  try{
    const s = extractGlobalDaySection(fx, 'QUINTA-FEIRA', 5);
    check(s !== null, 'seção QUINTA-FEIRA não encontrada');
    if (s){
      check(s.main.length === 2, `main: esperado 2, saiu ${s.main.length}`);
      check(s.side.length === 2, `side: esperado 2, saiu ${s.side.length}`);
      check(s.sat.length === 1, `sat: esperado 1, saiu ${s.sat.length}`);
      check(s.unknown.length === 1, `unknown: esperado 1, saiu ${s.unknown.length}`);
      check(s.semHora.length === 0, `semHora: esperado 0, saiu ${s.semHora.length}`);
      check(s.aposGap.length === 1, `aposGap: esperado 1, saiu ${s.aposGap.length}`);
      check(!s.duplicateSection, 'rótulos decorativos contaram como seção duplicada');
      check(s.main[0] && s.main[0].nome === '#AS Teste Main', 'linha com colA decorativa foi descartada (bug da coluna A voltou!)');
      check(s.main[0] && s.main[0].garantido === 5000, `divisor 5: esperado 5000, saiu ${s.main[0] && s.main[0].garantido}`);
      check(s.side[1] && s.side[1].hora === '10:00', `horário mesclado não herdado: ${s.side[1] && s.side[1].hora}`);
      check(s.sat[0] && s.sat[0].groupHeader === '#Grupo Sat', 'cabeçalho de grupo de satélite não capturado');
    }
  }catch(e){ failures.push('exceção no parser: ' + e.message); }
  if (failures.length){
    console.error('FALHA no autoteste do parser da Global:', failures);
    setTimeout(() => { try{ showToast('⚠ ERRO INTERNO no leitor da Global — NÃO confie na Conferência antes de revisar! Veja o console.', true); }catch(e){} }, 1500);
  }
})();

/* =========================================================================
   FERRAMENTA 3 — CHECKLIST DE CONFERÊNCIA DE HOJE
   Lê a mesma planilha Global MTT, mas pega a seção do dia da semana de HOJE (não amanhã) —
   monta uma lista de apoio (Main/Side/Satélite, em ordem de horário) pra ir marcando enquanto
   confere cada torneio manualmente no app da Suprema vs a Global. Compartilhado via Firebase,
   reseta sozinho todo dia (mesmo padrão do checklist diário, path separado FB_BASE_PATH/confhoje).
========================================================================= */

function todayWeekdayName(lang){
  // mesmo corte de turno das 05:30 usado em todayPathSP/confAmanhaTurno: de madrugada,
  // "hoje" ainda é o dia de ontem — senão o checklist puxava a seção do dia seguinte
  // da Global logo após a meia-noite, no meio do turno
  const n = nowInSP();
  const ref = new Date(Date.UTC(n.year, n.month-1, n.day, 12, 0, 0));
  if (isMadrugadaSP(n)) ref.setUTCDate(ref.getUTCDate() - 1);
  const idx = ref.getUTCDay();
  return lang === 'en' ? WEEKDAYS_EN[idx] : WEEKDAYS_PT[idx];
}

/* id estável por item, baseado em categoria+horário+nome — usado como chave no Firebase */
function confHojeItemId(cat, hora, nome){
  const slug = normText(`${cat}-${hora}-${nome}`).replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  return slug;
}

document.getElementById('globalTodayFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await ensureXLSX();                 // SheetJS sob demanda
  const arrayBuffer = await file.arrayBuffer();
  processGlobalToday(arrayBuffer, file.name);
  // compartilha o arquivo com a equipe (painel/globalMtt) — ninguém precisa subir de novo
  publishSharedGlobal(arrayBuffer, file.name);
  e.target.value = '';
});
function processGlobalToday(arrayBuffer, fileName){
  const label = document.getElementById('globalTodayFileLabel');
  const labelBox = label.closest('.routine-upload');
  label.textContent = 'Lendo...';
  try{
    const matrix = readSheetMatrix(arrayBuffer, 'MTTS BRAZIL');
    const weekdayPt = todayWeekdayName('pt');
    const section = extractGlobalDaySection(matrix, weekdayPt, 1); // sem dividir — aqui é só conferência de presença, mostra o valor cru da Global

    if (!section){
      document.getElementById('confHojeList').innerHTML = `<div class="diff-row">Não encontrei a seção "${weekdayPt}" nessa planilha.</div>`;
      label.textContent = 'Carregar planilha Global MTT de hoje (.xlsx)';
      return;
    }
    if (section.duplicateSection){
      showToast(`Atenção: "${weekdayPt}" aparece mais de uma vez nessa planilha — confira se pegou a seção certa.`, true);
    }
    if (section.unknown.length){
      showToast(`Atenção: ${section.unknown.length} torneio(s) com tipo não reconhecido na coluna D ficaram de fora da lista.`, true);
    }
    if (section.semHora.length){
      showToast(`Atenção: ${section.semHora.length} torneio(s) sem horário reconhecível ficaram de fora da lista.`, true);
    }
    if (section.aposGap.length){
      showToast(`Atenção: ${section.aposGap.length} linha(s) com cara de torneio depois do bloco de linhas vazias ficaram de fora — ${section.aposGap.map(it=>it.nome).slice(0,3).join(', ')}${section.aposGap.length>3?'…':''}`, true);
    }
    CONFHOJE_ITEMS = [];
    section.main.forEach(it => CONFHOJE_ITEMS.push({...it, cat:'main', id: confHojeItemId('main', it.hora, it.nome)}));
    section.side.forEach(it => CONFHOJE_ITEMS.push({...it, cat:'side', id: confHojeItemId('side', it.hora, it.nome)}));
    section.sat.forEach(it => CONFHOJE_ITEMS.push({...it, cat:'sat', id: confHojeItemId('sat', it.hora, it.nome)}));
    // tipo não reconhecido não fica de fora do checklist — aparece numa seção separada pra não sumir da conferência
    section.unknown.forEach(it => CONFHOJE_ITEMS.push({...it, cat:'unknown', id: confHojeItemId('unknown', it.hora, it.nome)}));
    CONFHOJE_ITEMS.sort((a,b) => (timeToMinutes(a.hora)??9999) - (timeToMinutes(b.hora)??9999));

    // mesmo nome+horário duas vezes = provável erro de leitura da planilha
    const seen = new Map();
    CONFHOJE_ITEMS.forEach(it => {
      const key = `${normText(it.nome)}|${it.hora}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    });
    const duplicateNames = [...seen.entries()].filter(([,c]) => c > 1).map(([k]) => k.split('|')[0]);
    if (duplicateNames.length){
      showToast(`Atenção: torneio(s) repetido(s) na lista — ${duplicateNames.join(', ')}. Confira a Global.`, true);
    }
    CONFHOJE_META = {
      weekdayPt, rowsInSection: section.rowsInSection, extractedCount: section.extractedCount,
      semHoraCount: section.semHora.length, duplicateNames
    };

    label.textContent = fileName;
    labelBox.classList.add('is-loaded');
    showToast(`Lista de hoje carregada — ${CONFHOJE_ITEMS.length} torneios.`);
    renderConfHojeList();
  }catch(err){
    console.error('Erro ao ler Global de hoje:', err);
    showToast('Não foi possível ler essa planilha.', true);
    label.textContent = 'Carregar planilha Global MTT de hoje (.xlsx)';
  }
}

function renderConfHoje(){ renderConfHojeList(); }
function renderConfHojeList(){
  const listEl = document.getElementById('confHojeList');
  const progressEl = document.getElementById('confHojeProgress');
  if (!CONFHOJE_ITEMS.length){ listEl.innerHTML = ''; progressEl.hidden = true; document.getElementById('confHojeControls').hidden = true; return; }

  const total = CONFHOJE_ITEMS.length;
  const done = CONFHOJE_ITEMS.filter(it => isConfHojeDone(it.id)).length;
  progressEl.hidden = false;
  document.getElementById('confHojeProgressCount').textContent = `${done} de ${total} conferidos`;
  document.getElementById('confHojeProgressFill').style.width = `${Math.round((done/total)*100)}%`;

  const catLabel = {main:'Main Events', side:'Side Events', sat:'Satélites', unknown:'⚠ Tipo não reconhecido (verifique a coluna D na Global)'};
  let html = '';
  if (CONFHOJE_META){
    const m = CONFHOJE_META;
    html += `<div class="diff-summary">
      <span class="diff-pill ok">Dia calculado: ${escHtml(m.weekdayPt)}</span>
      <span class="diff-pill ok">${m.extractedCount} torneios de ${m.rowsInSection} linhas na seção</span>
      ${m.semHoraCount ? `<span class="diff-pill" style="background:#e85d5d33;color:#e85d5d">⚠ ${m.semHoraCount} sem horário</span>` : ''}
      ${m.duplicateNames.length ? `<span class="diff-pill" style="background:#e85d5d33;color:#e85d5d">⚠ repetido: ${escHtml(m.duplicateNames.join(', '))}</span>` : ''}
    </div>`;
  }
  // busca + ocultar conferidos só afetam o que aparece na lista — o progresso acima continua
  // contando a lista inteira, senão marcaria 100% com metade dos torneios escondidos pela busca
  document.getElementById('confHojeControls').hidden = false;
  const q = normText(CONFHOJE_SEARCH);
  const visible = it => {
    if (CONFHOJE_HIDE_DONE && isConfHojeDone(it.id)) return false;
    if (q && !normText(it.nome).includes(q) && !String(it.hora||'').includes(q)) return false;
    return true;
  };
  let shownCount = 0;
  ['main','side','sat','unknown'].forEach(cat => {
    const items = CONFHOJE_ITEMS.filter(it => it.cat === cat && visible(it));
    if (!items.length) return;
    shownCount += items.length;
    html += `<div class="conf-section-title"${cat === 'unknown' ? ' style="color:#e85d5d"' : ''}>${catLabel[cat]}</div>`;
    items.forEach(it => {
      const isDone = isConfHojeDone(it.id);
      const by = confHojeDoneBy(it.id);
      html += `
        <label class="conf-item${isDone ? ' is-done' : ''}">
          <input type="checkbox" data-conf-id="${it.id}" ${isDone ? 'checked' : ''}>
          <span class="conf-item-time">${it.hora}</span>
          <span class="conf-item-label">${it.nome}</span>
          ${isDone && by ? `<span class="conf-item-by">${by}</span>` : ''}
        </label>
      `;
    });
  });
  const hiddenCount = total - shownCount;
  if (hiddenCount > 0){
    html += `<div class="conf-hoje-hint">${
      shownCount === 0
        ? (q ? `Nenhum torneio bate com "${escHtml(CONFHOJE_SEARCH)}".` : 'Todos os torneios já foram conferidos. 🎉')
        : `${hiddenCount} torneio${hiddenCount>1?'s':''} oculto${hiddenCount>1?'s':''}${CONFHOJE_HIDE_DONE ? ' (já conferidos' + (q ? ' ou fora da busca' : '') + ')' : ' pela busca'}.`
    }</div>`;
  }
  listEl.innerHTML = html;
  listEl.querySelectorAll('.conf-item input').forEach(inp => {
    inp.addEventListener('change', () => {
      setConfHojeItem(inp.dataset.confId, inp.checked);
      renderConfHojeList();
    });
  });
}

document.getElementById('confHojeSearchInput').addEventListener('input', (e) => {
  CONFHOJE_SEARCH = e.target.value.trim();
  renderConfHojeList();
});
document.getElementById('confHojeHideDoneBtn').addEventListener('click', (e) => {
  CONFHOJE_HIDE_DONE = !CONFHOJE_HIDE_DONE;
  e.currentTarget.classList.toggle('active', CONFHOJE_HIDE_DONE);
  renderConfHojeList();
});

/* =========================================================================
   GERAR CONFERÊNCIA DE AMANHÃ
   Monta a planilha "Conferência 2026" do próximo dia a partir da Global MTT — Torneio,
   Horário, Garantido, Buy-in (em "dólar": valor cru da Global em Reais ÷ 5, multiplicador
   Brazil — é assim que a operação trata esse valor, sem conversão de câmbio real nenhuma).
   Janela: do horário 06:10 de amanhã até 05:30 do dia seguinte a amanhã (cobre a madrugada
   de fechamento de turno) — Main, Side e Satélite seguem a mesma janela.
========================================================================= */
/* CONF_WINDOW_START_MIN / CONF_WINDOW_END_MIN vêm de gu-parser.js */

/* ponto único da regra de turno (00:00→05:30) — usado por tudo que decide "qual é o dia de amanhã":
   captura o instante UMA vez e devolve tanto o offset quanto a data já calculada, pra nada que dependa
   disso (nome do dia, seções, nome do arquivo exportado) rodar `new Date()` de novo em outro instante
   e correr o risco de virar o relógio no meio do cálculo (ex: exatamente às 05:30:00) */
function confAmanhaTurno(nOverride){
  const n = nOverride || nowInSP(); // nOverride só é usado pelo autoteste, pra simular horários específicos
  // Entre 00:00 e 05:29 ainda é o turno de "hoje" — amanhã = dia atual do calendário
  // A partir de 05:30 começa novo turno — amanhã = dia seguinte
  const isMadrugada = isMadrugadaSP(n);
  const tomorrowOffset = isMadrugada ? 0 : 1;
  const dayAfterOffset = isMadrugada ? 1 : 2;
  const refTomorrow = new Date(Date.UTC(n.year, n.month-1, n.day, 12, 0, 0));
  refTomorrow.setUTCDate(refTomorrow.getUTCDate() + tomorrowOffset);
  const refDayAfter = new Date(Date.UTC(n.year, n.month-1, n.day, 12, 0, 0));
  refDayAfter.setUTCDate(refDayAfter.getUTCDate() + dayAfterOffset);
  return { n, isMadrugada, refTomorrow, refDayAfter };
}
function tomorrowWeekdayName(lang, turno){
  const { refTomorrow } = turno || confAmanhaTurno();
  const idx = refTomorrow.getUTCDay();
  return lang === 'en' ? WEEKDAYS_EN[idx] : WEEKDAYS_PT[idx];
}
function dayAfterTomorrowWeekdayName(lang, turno){
  const { refDayAfter } = turno || confAmanhaTurno();
  const idx = refDayAfter.getUTCDay();
  return lang === 'en' ? WEEKDAYS_EN[idx] : WEEKDAYS_PT[idx];
}
/* dd-mm-aaaa do dia de "amanhã" (mesma regra de turno) — usado no nome do arquivo exportado */
function tomorrowDateLabel(turno){
  const { refTomorrow } = turno || confAmanhaTurno();
  return `${String(refTomorrow.getUTCDate()).padStart(2,'0')}-${String(refTomorrow.getUTCMonth()+1).padStart(2,'0')}-${refTomorrow.getUTCFullYear()}`;
}

/* autoteste da regra de turno: roda uma vez a cada carregamento da página com horários simulados.
   Se qualquer edição futura quebrar o corte das 05:30, a virada de mês ou o cálculo do dia da semana,
   um alerta vermelho aparece na hora — em vez de a operação descobrir com uma planilha errada */
(function confTurnoSelfTest(){
  // {agora simulado} → {dateLabel esperado pra "amanhã", dia da semana esperado}
  const cases = [
    // 30/06 é uma terça em 2026? não importa: o esperado é derivado por Date.UTC, o teste valida o OFFSET e a formatação
    { n:{year:2026, month:7, day:1, hour:14, minute:0}, label:'02-07-2026', desc:'tarde comum → amanhã = dia seguinte' },
    { n:{year:2026, month:7, day:1, hour:2,  minute:0}, label:'01-07-2026', desc:'madrugada (02:00) → amanhã = dia atual' },
    { n:{year:2026, month:7, day:1, hour:5,  minute:29}, label:'01-07-2026', desc:'05:29 ainda é turno de hoje' },
    { n:{year:2026, month:7, day:1, hour:5,  minute:30}, label:'02-07-2026', desc:'05:30 em ponto vira o turno' },
    { n:{year:2026, month:7, day:31, hour:20, minute:0}, label:'01-08-2026', desc:'virada de mês' },
    { n:{year:2026, month:12, day:31, hour:20, minute:0}, label:'01-01-2027', desc:'virada de ano' },
    { n:{year:2026, month:1, day:1, hour:3, minute:0}, label:'01-01-2026', desc:'madrugada de ano novo ainda é turno de 31/12' },
  ];
  const failures = [];
  cases.forEach(c => {
    const turno = confAmanhaTurno({...c.n, second:0});
    const got = tomorrowDateLabel(turno);
    if (got !== c.label) failures.push(`${c.desc}: esperado ${c.label}, saiu ${got}`);
    // consistência interna: refDayAfter tem que ser exatamente refTomorrow + 1 dia
    if (turno.refDayAfter.getTime() - turno.refTomorrow.getTime() !== 86400000){
      failures.push(`${c.desc}: dia-depois-de-amanhã não é amanhã+1`);
    }
  });
  if (failures.length){
    console.error('FALHA no autoteste da Conferência de amanhã:', failures);
    // toast pode ainda não existir tão cedo no carregamento — garante o aviso nos dois canais
    setTimeout(() => { try{ showToast('⚠ ERRO INTERNO na lógica da Conferência de amanhã — NÃO exporte antes de revisar! Veja o console.', true); }catch(e){} }, 1500);
  }
})();

/* monta as 3 seções aplicando a janela 06:10(amanhã) -> 05:30(dia seguinte): cada categoria pega os
   itens de amanhã com horário >= 06:10, mais os itens do dia seguinte com horário <= 05:30 (madrugada
   que "pertence" ao fechamento do turno de amanhã). Main e Side ficam em ordem cronológica simples.
   Satélite é agrupado pelo cabeçalho do grupo na Global (groupHeader, ex: "#AS Battle HR+SPS") — dentro
   de cada grupo os horários ficam em ordem; os grupos entre si ficam ordenados pelo primeiro horário. */
function buildConfAmanhaSections(sectionTomorrow, sectionDayAfter){
  function inWindow(list){
    return list.filter(it => (timeToMinutes(it.hora) ?? -1) >= CONF_WINDOW_START_MIN);
  }
  function inWindowNextDay(list){
    return list.filter(it => {
      const m = timeToMinutes(it.hora);
      return m !== null && m <= CONF_WINDOW_END_MIN;
    });
  }
  function chronoSort(list){
    return [...list].sort((a,b) => {
      const ma = timeToMinutes(a.hora) ?? 9999;
      const mb = timeToMinutes(b.hora) ?? 9999;
      const orderA = ma >= CONF_WINDOW_START_MIN ? ma : ma + 1440;
      const orderB = mb >= CONF_WINDOW_START_MIN ? mb : mb + 1440;
      return orderA - orderB;
    });
  }

  // Excluir torneios do tipo "X Seats" (satélites internos de seat — não entram na conferência)
  const mainAll = chronoSort([...(sectionTomorrow ? inWindow(sectionTomorrow.main) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.main) : [])]);
  const sideAll = chronoSort([...(sectionTomorrow ? inWindow(sectionTomorrow.side) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.side) : [])]);
  // satélite NÃO é reordenado por horário — fica na ordem original de leitura da Global (linha por linha),
  // que é como os grupos aparecem na planilha real de referência (ex: Reentry, depois WarmUp, depois
  // Battle HR...). Cada grupo já vem internamente em ordem de horário crescente por natureza da planilha.
  const satAll = [...(sectionTomorrow ? inWindow(sectionTomorrow.sat) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.sat) : [])];
  // agrupa satélites por groupHeader, preservando a ordem de primeira aparição de cada grupo
  const satGroupsOrder = [];
  const satGroupsMap = {};
  satAll.forEach(it => {
    const key = it.groupHeader || it.nome;
    if (!satGroupsMap[key]){ satGroupsMap[key] = []; satGroupsOrder.push(key); }
    satGroupsMap[key].push(it);
  });
  const satGroups = satGroupsOrder.map(key => ({header: key, items: satGroupsMap[key]}));

  // torneios com tipo não reconhecido (coluna D) dentro da mesma janela de horário — não some,
  // fica visível permanentemente na tela/export em vez de só um toast que pode passar despercebido
  const unknownAll = [...(sectionTomorrow ? inWindow(sectionTomorrow.unknown) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.unknown) : [])];

  // mesmo nome+horário aparecendo 2x geralmente indica erro de leitura da planilha (linha mesclada,
  // grupo de satélite duplicado etc.) — sinaliza pra o operador desconfiar em vez de exportar sem avisar
  const seen = new Map();
  [...mainAll, ...sideAll, ...satAll].forEach(it => {
    const key = `${normText(it.nome)}|${it.hora}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicateNames = [...seen.entries()].filter(([,count]) => count > 1).map(([key]) => key.split('|')[0]);

  // buraco entre janelas: torneio começando entre 05:31 e 06:09 não entra em NENHUMA conferência
  // (a janela é 06:10 → 05:30) — se existir um, precisa aparecer como aviso, não sumir do mapa
  const inGap = it => { const m = timeToMinutes(it.hora); return m !== null && m > CONF_WINDOW_END_MIN && m < CONF_WINDOW_START_MIN; };
  const allTom = sectionTomorrow ? [...sectionTomorrow.main, ...sectionTomorrow.side, ...sectionTomorrow.sat, ...sectionTomorrow.unknown] : [];
  const allAfter = sectionDayAfter ? [...sectionDayAfter.main, ...sectionDayAfter.side, ...sectionDayAfter.sat, ...sectionDayAfter.unknown] : [];
  const foraJanela = [...allTom.filter(inGap), ...allAfter.filter(inGap)];

  return { main: mainAll, side: sideAll, satGroups, unknown: unknownAll, duplicateNames, foraJanela, total: mainAll.length + sideAll.length + satAll.length };
}

/* renderiza as 3 seções na tela, no mesmo estilo de tabela já usado na lista da Conferência de hoje
   — sem gerar nenhum arquivo, só mostra direto no painel pra você copiar/conferir visualmente */
function renderConfAmanha(sections, weekdayLabel, dateLabel, meta){
  const resultEl = document.getElementById('confAmanhaResult');
  LAST_CONF_AMANHA = {sections, weekdayLabel, dateLabel, meta}; // guardado pra o botão de exportar usar sem reler a planilha nem recalcular a data
  if (!sections.total){
    resultEl.innerHTML = `<div class="diff-row">Nenhum torneio encontrado na janela 06:10–05:30 pra ${weekdayLabel}.</div>`;
    return;
  }

  const row = (it) => `
    <div class="conf-amanha-row">
      <span class="ca-nome">${it.nome}</span>
      <span class="ca-hora">${it.hora}</span>
      <span class="ca-val">$ ${fmtBRL(it.garantido, 2)}</span>
      <span class="ca-val">$ ${fmtBRL(it.buyin, 2)}</span>
    </div>`;

  let html = `
    <div class="diff-summary">
      <span class="diff-pill ok">${weekdayLabel} · ${sections.total} torneios</span>
      <span class="diff-pill ok">Main ${sections.main.length} · Side ${sections.side.length} · Sat ${sections.satGroups.reduce((a,g)=>a+g.items.length,0)}</span>
      <span class="diff-pill ok">06:10 → 05:30 · ${dateLabel}</span>
      ${meta ? `<span class="diff-pill ok">${meta.extractedCount} torneios de ${meta.rowsInSection} linhas nas seções</span>` : ''}
      ${meta && meta.semHoraCount ? `<span class="diff-pill" style="background:#e85d5d33;color:#e85d5d">⚠ ${meta.semHoraCount} sem horário</span>` : ''}
      ${sections.duplicateNames.length ? `<span class="diff-pill" style="background:#e85d5d33;color:#e85d5d">⚠ repetido: ${escHtml(sections.duplicateNames.join(', '))}</span>` : ''}
    </div>
    ${meta && meta.semHoraItems && meta.semHoraItems.length ? `
    <div class="diff-row" style="color:#e85d5d">⚠ Sem horário reconhecível — valor bruto da célula entre parênteses:<br>
      ${meta.semHoraItems.map(it => `${escHtml(it.nome)} (tipo: "${escHtml(it.tipo ?? '')}", célula: ${escHtml(JSON.stringify(it.hora))})`).join('<br>')}
    </div>` : ''}
    ${meta && meta.aposGapItems && meta.aposGapItems.length ? `
    <div class="diff-row" style="color:#e85d5d">⚠ Linhas com cara de torneio DEPOIS do bloco de linhas vazias (fora do relatório — se forem torneios reais, feche o vão na Global e recarregue):<br>
      ${meta.aposGapItems.map(it => `${escHtml(it.hora)} · ${escHtml(it.nome)}`).join('<br>')}
    </div>` : ''}
    ${meta && meta.foraJanela && meta.foraJanela.length ? `
    <div class="diff-row" style="color:#e85d5d">⚠ Começam entre 05:31 e 06:09 — fora da janela de qualquer conferência (adicione manualmente se necessário):<br>
      ${meta.foraJanela.map(it => `${escHtml(it.hora)} · ${escHtml(it.nome)}`).join('<br>')}
    </div>` : ''}
    <button class="routine-download" id="exportConfAmanhaBtn" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M12 15l-4-4M12 15l4-4"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>
      Exportar planilha (.xlsx)
    </button>
    <div class="conf-amanha-head">
      <span>Torneio</span><span>Horário</span><span>Garantido</span><span>Buy in</span>
    </div>`;

  if (sections.main.length){
    html += `<div class="conf-section-title">Main Events</div>`;
    html += sections.main.map(row).join('');
  }
  if (sections.side.length){
    html += `<div class="conf-section-title">Side Events</div>`;
    html += sections.side.map(row).join('');
  }
  if (sections.satGroups.length){
    html += `<div class="conf-section-title">Satélites</div>`;
    sections.satGroups.forEach(g => {
      html += g.items.map(row).join('');
      html += `<div class="conf-amanha-spacer"></div>`; // linha em branco separando cada grupo de satélite, igual ao formato original
    });
  }
  if (sections.unknown.length){
    html += `<div class="conf-section-title" style="color:#e85d5d">⚠ Tipo não reconhecido (verifique a coluna D na Global) — não incluídos no total acima</div>`;
    html += sections.unknown.map(it => `
      <div class="conf-amanha-row">
        <span class="ca-nome">${it.nome} <em style="opacity:.6">(tipo: "${it.tipo ?? ''}")</em></span>
        <span class="ca-hora">${it.hora}</span>
        <span class="ca-val">$ ${fmtBRL(it.garantido, 2)}</span>
        <span class="ca-val">$ ${fmtBRL(it.buyin, 2)}</span>
      </div>`).join('');
  }
  resultEl.innerHTML = html;
  document.getElementById('exportConfAmanhaBtn').addEventListener('click', exportConfAmanhaXlsx);
}

/* exporta a Conferência de amanhã pra .xlsx, mantendo a mesma estrutura visual mostrada na tela:
   Main Events, depois Side Events, depois Satélites com linha em branco separando cada grupo —
   igual ao formato da planilha "Conferência 2026" real que o operador cola no dia a dia */

async function exportConfAmanhaXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  if (!LAST_CONF_AMANHA || !LAST_CONF_AMANHA.sections.total){
    showToast('Carregue a Global e gere a Conferência de amanhã primeiro.', true);
    return;
  }
  const { sections, weekdayLabel, dateLabel } = LAST_CONF_AMANHA;

  // trava anti-dado-velho: se o turno virou desde que a planilha foi lida (ex: leu às 05:00,
  // exportou às 06:00), o "amanhã" da tela não é mais o "amanhã" real — bloqueia e pede releitura
  const dateLabelAgora = tomorrowDateLabel(confAmanhaTurno());
  if (dateLabelAgora !== dateLabel){
    showToast(`O turno virou desde que a planilha foi lida (era ${dateLabel}, agora seria ${dateLabelAgora}). Recarregue a Global antes de exportar.`, true);
    return;
  }

  // confirmação final: último olhar humano no dia/data/totais antes de gerar o arquivo
  const satCount = sections.satGroups.reduce((a,g)=>a+g.items.length,0);
  const metaExp = LAST_CONF_AMANHA.meta || {};
  const alertas = [];
  if (sections.unknown.length) alertas.push(`⚠ ${sections.unknown.length} torneio(s) com tipo não reconhecido irão em seção separada!`);
  if (metaExp.semHoraCount) alertas.push(`⚠ ${metaExp.semHoraCount} torneio(s) SEM horário ficaram DE FORA!`);
  if (metaExp.aposGapItems && metaExp.aposGapItems.length) alertas.push(`⚠ ${metaExp.aposGapItems.length} linha(s) depois do vão de linhas vazias ficaram DE FORA!`);
  if (metaExp.foraJanela && metaExp.foraJanela.length) alertas.push(`⚠ ${metaExp.foraJanela.length} torneio(s) entre 05:31-06:09 ficaram DE FORA (fora da janela)!`);
  const ok = window.confirm(
    `Exportar Conferência de amanhã?\n\n` +
    `Dia: ${weekdayLabel} · ${dateLabel}\n` +
    `Main: ${sections.main.length} · Side: ${sections.side.length} · Satélites: ${satCount}\n` +
    `Total: ${sections.total} torneios` +
    (alertas.length ? `\n\n${alertas.join('\n')}` : '')
  );
  if (!ok) return;

  const header = ['Torneio', 'Horário', 'Garantido', 'Buy in'];
  const rows = [header];
  const pushRow = (it) => rows.push([it.nome, it.hora, it.garantido, it.buyin]);
  const blankRow = () => rows.push([]);

  sections.main.forEach(pushRow);
  if (sections.main.length) blankRow();
  sections.side.forEach(pushRow);
  if (sections.side.length) blankRow();
  sections.satGroups.forEach(g => {
    g.items.forEach(pushRow);
    blankRow();
  });
  if (sections.unknown.length){
    blankRow();
    rows.push(['TIPO NÃO RECONHECIDO — verificar coluna D na Global antes de fechar a conferência']);
    sections.unknown.forEach(it => rows.push([it.nome, it.hora, it.garantido, it.buyin, it.tipo ?? '']));
  }
  // linha de checagem no rodapé: quem receber a planilha consegue conferir se nada foi cortado
  blankRow();
  rows.push([`Total: ${sections.total} torneios (Main ${sections.main.length} · Side ${sections.side.length} · Sat ${sections.satGroups.reduce((a,g)=>a+g.items.length,0)}) — ${weekdayLabel} ${dateLabel}`]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:30},{wch:10},{wch:14},{wch:12}];
  const wb = XLSX.utils.book_new();
  // dateLabel vem de quando a planilha foi lida (renderConfAmanha), não do instante do clique —
  // assim nome do arquivo e conteúdo nunca podem divergir por causa da hora de exportar
  const sheetName = (weekdayLabel || 'Conferência').slice(0,31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `Conferencia_${dateLabel}.xlsx`);
  showToast('Conferência de amanhã exportada.');
}

document.getElementById('globalTomorrowFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await ensureXLSX();                 // SheetJS sob demanda
  const arrayBuffer = await file.arrayBuffer();
  processGlobalTomorrow(arrayBuffer, file.name);
  // compartilha o arquivo com a equipe (painel/globalMtt) — ninguém precisa subir de novo
  publishSharedGlobal(arrayBuffer, file.name);
  e.target.value = '';
});
function processGlobalTomorrow(arrayBuffer, fileName){
  const label = document.getElementById('globalTomorrowFileLabel');
  const labelBox = label.closest('.routine-upload');
  const resultEl = document.getElementById('confAmanhaResult');
  label.textContent = 'Lendo...';
  try{
    const matrix = readSheetMatrix(arrayBuffer, 'MTTS BRAZIL');
    // turno calculado UMA vez aqui (leitura da planilha) e reaproveitado no export — assim o nome do
    // arquivo e o dia usado pra montar as seções nunca podem divergir por causa da hora do clique
    const turno = confAmanhaTurno();
    const weekdayTomorrowPt = tomorrowWeekdayName('pt', turno);
    const weekdayDayAfterPt = dayAfterTomorrowWeekdayName('pt', turno);
    const dateLabel = tomorrowDateLabel(turno);
    // divisor 5: multiplicador "Brazil" da Global — mesma conta de sempre, sem conversão de câmbio real
    const sectionTomorrow = extractGlobalDaySection(matrix, weekdayTomorrowPt, 5);
    const sectionDayAfter = extractGlobalDaySection(matrix, weekdayDayAfterPt, 5);

    if (!sectionTomorrow){
      resultEl.innerHTML = `<div class="diff-row">Não encontrei a seção "${weekdayTomorrowPt}" nessa planilha. Confira se é a aba/arquivo certo.</div>`;
      label.textContent = 'Carregar planilha Global MTT (.xlsx)';
      return;
    }
    if (!sectionDayAfter){
      showToast(`Atenção: não encontrei a seção "${weekdayDayAfterPt}" — a madrugada de fechamento (até 05:30) pode estar faltando no relatório.`, true);
    }
    if (sectionTomorrow.duplicateSection || (sectionDayAfter && sectionDayAfter.duplicateSection)){
      showToast(`Atenção: nome de dia da semana duplicado na planilha — confira se as seções "${weekdayTomorrowPt}"/"${weekdayDayAfterPt}" usadas são as certas.`, true);
    }
    const unknownCount = sectionTomorrow.unknown.length + (sectionDayAfter ? sectionDayAfter.unknown.length : 0);
    if (unknownCount){
      showToast(`Atenção: ${unknownCount} torneio(s) com tipo não reconhecido na coluna D ficaram de fora do relatório.`, true);
    }
    const semHoraCount = sectionTomorrow.semHora.length + (sectionDayAfter ? sectionDayAfter.semHora.length : 0);
    if (semHoraCount){
      showToast(`Atenção: ${semHoraCount} torneio(s) sem horário reconhecível ficaram de fora do relatório.`, true);
    }
    const aposGapItems = [...sectionTomorrow.aposGap, ...(sectionDayAfter ? sectionDayAfter.aposGap : [])];
    if (aposGapItems.length){
      showToast(`Atenção: ${aposGapItems.length} linha(s) com cara de torneio existem DEPOIS do bloco de linhas vazias e ficaram de fora — confira a lista vermelha.`, true);
    }

    const sections = buildConfAmanhaSections(sectionTomorrow, sectionDayAfter);
    if (sections.duplicateNames.length){
      showToast(`Atenção: torneio(s) repetido(s) na lista — ${sections.duplicateNames.join(', ')}. Confira a Global.`, true);
    }
    if (sections.foraJanela.length){
      showToast(`Atenção: ${sections.foraJanela.length} torneio(s) começam entre 05:31 e 06:09 — fora da janela de QUALQUER conferência. Veja a lista vermelha.`, true);
    }
    const meta = {
      rowsInSection: sectionTomorrow.rowsInSection + (sectionDayAfter ? sectionDayAfter.rowsInSection : 0),
      extractedCount: sectionTomorrow.extractedCount + (sectionDayAfter ? sectionDayAfter.extractedCount : 0),
      semHoraCount,
      semHoraItems: [...sectionTomorrow.semHora, ...(sectionDayAfter ? sectionDayAfter.semHora : [])],
      aposGapItems,
      foraJanela: sections.foraJanela
    };
    label.textContent = fileName;
    labelBox.classList.add('is-loaded');
    renderConfAmanha(sections, weekdayTomorrowPt, dateLabel, meta);
    showToast(`Global lida — ${sections.total} torneios na janela de amanhã.`);
  }catch(err){
    console.error('Erro ao gerar Conferência de amanhã:', err);
    showToast('Não foi possível ler essa planilha.', true);
    label.textContent = 'Carregar planilha Global MTT (.xlsx)';
  }
}

/* =========================================================================
   GLOBAL COMPARTILHADA — o arquivo Global MTT inteiro (base64) num caminho
   FIXO do Firebase (painel/globalMtt): um operador sobe, o resto da equipe
   usa nas Conferências sem resubir. Mesmo padrão da planilha de Mesas Cash.
========================================================================= */
let SHARED_GLOBAL = null; // {buf, filename, at, by}
window.SHARED_GLOBAL = null;
function publishSharedGlobal(arrayBuffer, filename){
  if (!fbReady) return;
  try{
    const b64 = arrayBufferToBase64(arrayBuffer);
    fbDb.ref('painel/globalMtt').set({data: b64, filename, at: Date.now(), by: OPERATOR_NAME || 'Alguém'})
      .catch(err => console.warn('Firebase: falha ao compartilhar a Global', err));
  }catch(e){ console.warn('não foi possível compartilhar a Global', e); }
}
window.publishSharedGlobal = publishSharedGlobal;
function sharedGlobalAge(at){
  const h = (Date.now() - at) / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(h*60))} min` : `${Math.round(h)}h`;
}
/* pinta todos os botões "usar a Global compartilhada" (das 3 conferências) */
function paintSharedGlobalBtns(){
  document.querySelectorAll('.shared-global-btn').forEach(btn => {
    if (!SHARED_GLOBAL){ btn.hidden = true; return; }
    const stale = (Date.now() - SHARED_GLOBAL.at) / 3600000 >= 12;
    btn.hidden = false;
    btn.classList.toggle('is-stale', stale);
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v13M12 21l-4-4M12 21l4-4"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/></svg>`
      + `<span>Usar a Global compartilhada — <b>${escHtml(SHARED_GLOBAL.filename)}</b> (${escHtml(SHARED_GLOBAL.by)}, há ${sharedGlobalAge(SHARED_GLOBAL.at)})`
      + `${stale ? ' · <b>+12h, confira se há versão mais nova</b>' : ''}</span>`;
  });
}
function attachSharedGlobal(){
  if (window.__sharedGlobalAttached || !fbReady) return;
  window.__sharedGlobalAttached = true;
  // ECONOMIA DE BANDA: observa só o timestamp (at). O arquivo (base64 pesado) só é
  // baixado com .once() QUANDO muda. Antes, .on('value') no nó inteiro rebaixava a
  // Global inteira a cada reconexão — parte do que estourou a cota de download.
  fbDb.ref('painel/globalMtt/at').on('value', s => {
    const at = s.val();
    if (!at){ SHARED_GLOBAL = null; window.SHARED_GLOBAL = null; paintSharedGlobalBtns(); return; }
    const key = `${at}`;
    if (window._lastSharedGlobalKey === key) return;
    fbDb.ref('painel/globalMtt').once('value').then(snap => {
      const v = snap.val();
      try{
        SHARED_GLOBAL = (v && v.data)
          ? {buf: base64ToArrayBuffer(v.data), filename: v.filename || 'Global MTT.xlsx', at: v.at || 0, by: v.by || 'alguém'}
          : null;
      }catch(e){ console.warn('Global compartilhada corrompida', e); SHARED_GLOBAL = null; }
      window._lastSharedGlobalKey = key;
      window.SHARED_GLOBAL = SHARED_GLOBAL;
      paintSharedGlobalBtns();
    }).catch(()=>{});
  });
}
attachSharedGlobal();
const sharedGlobalRetry = setInterval(() => { attachSharedGlobal(); if (window.__sharedGlobalAttached) clearInterval(sharedGlobalRetry); }, 2000);

document.getElementById('confHojeSharedBtn')?.addEventListener('click', async () => {
  if (!SHARED_GLOBAL){ showToast('Nenhuma Global compartilhada disponível.', true); return; }
  await ensureXLSX();                 // SheetJS sob demanda
  processGlobalToday(SHARED_GLOBAL.buf.slice(0), SHARED_GLOBAL.filename);
});
document.getElementById('confAmanhaSharedBtn')?.addEventListener('click', async () => {
  if (!SHARED_GLOBAL){ showToast('Nenhuma Global compartilhada disponível.', true); return; }
  await ensureXLSX();                 // SheetJS sob demanda
  processGlobalTomorrow(SHARED_GLOBAL.buf.slice(0), SHARED_GLOBAL.filename);
});

/* =========================================================================
   BUSCADOR DE MESAS CASH
   Lê a planilha de configuração de mesas Cash (separada da planilha do dia) e permite
   buscar por modalidade + blinds do formulário do Digisac — o painel já divide por 5
   sozinho (mesma conta usada em todo o resto do painel pra converter valores da Global)
   e mostra todas as variações de mesa que batem com aquele blind na modalidade escolhida.
========================================================================= */
const CASH_TABLE_SHEETS = {
  'MESAS PLO4 - OK': 'PLO4',
  'MESAS PLO4 BOMB - ok': 'PLO4 Bomb',
  'MESAS PLO5 - ok': 'PLO5',
  'MESAS PLO5 BOMB - ok': 'PLO5 Bomb',
  'MESAS PLO6 - ok': 'PLO6',
  'MESAS PLO6 - bomb - ok': 'PLO6 Bomb',
  'MESAS NLH': 'NLH',
  'MESAS NLH 8P': 'NLH 8P',
  'MESAS SWAP': 'SWAP',
  'MESAS SWAP 4P': 'SWAP 4P',
  'MESAS SWAP 5P': 'SWAP 5P',
  'MESAS SWAP 6P': 'SWAP 6P',
  'MESAS PLO4 HI/LO': 'PLO4 HI/LO',
  'MESAS PLO5 HI/LO': 'PLO5 HI/LO',
  'MESAS PLO6 HI/LO': 'PLO6 HI/LO',
};

/* a planilha original tem um bug de digitação no Excel: em várias modalidades, o BLIND das mesas
   Golden/Titan/Caribe/Monaco foi autocorrigido pro Excel virar DATA (ex: "1/2" virou 1º de fevereiro),
   corrompendo o valor real. Confirmado manualmente com o operador: Golden=1/2, Titan=2/4, Caribe=3/6,
   Monaco=5/10 — essa tabela substitui o valor corrompido sempre que o nome da mesa começar com um
   desses prefixos E o BLINDS vier como objeto de data (sinal inequívoco de corrupção). */
const CASH_TABLE_BLIND_FIXES = [
  {prefix:'golden', small:1, big:2},
  {prefix:'titan', small:2, big:4},
  {prefix:'caribe', small:3, big:6},
  {prefix:'monaco', small:5, big:10},
];

/* extrai small/big blind de uma célula BLINDS — string tipo "0.2/0.4", ou corrige se vier corrompida
   como data (ver CASH_TABLE_BLIND_FIXES acima) */
function parseCashBlinds(raw, nomeMesa){
  if (typeof raw === 'string' && raw.includes('/')){
    const parts = raw.split('/');
    const small = parseFloat(parts[0].replace(',', '.'));
    const big = parseFloat(parts[1].replace(',', '.'));
    if (!isNaN(small) && !isNaN(big)) return {small, big};
  }
  // BLINDS corrompido (veio como número serial de data do Excel, ou string de data) — tenta corrigir pelo nome da mesa
  const normNome = normText(nomeMesa);
  const fix = CASH_TABLE_BLIND_FIXES.find(f => normNome.startsWith(f.prefix));
  if (fix) return {small: fix.small, big: fix.big};
  return null;
}

document.getElementById('cashTablesFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const label = document.getElementById('cashTablesFileLabel');
  const labelBox = document.getElementById('cashTablesUploadLabel');
  label.textContent = 'Lendo...';
  // deixa o navegador pintar "Lendo..." antes de travar a thread com o parse do XLSX (planilha com
  // 23 abas, pode ser bem pesada) — mesmo princípio aplicado no upload da planilha do dia
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try{
    await ensureXLSX();               // SheetJS sob demanda
    const arrayBuffer = await file.arrayBuffer();
    CASH_TABLE_WORKBOOK = XLSX.read(arrayBuffer, {type:'array', cellDates:false});
    CASH_TABLE_MATRIX_CACHE = {};
    label.textContent = file.name;
    labelBox.classList.add('is-loaded');
    showToast('Planilha de Mesas Cash carregada.');
    runCashTableSearch(); // se já tinha modalidade/blind preenchidos, busca na hora
    // outro respiro antes da conversão pra base64 (também pesada, ~45 blocos pra um arquivo de
    // ~1.4MB) — sem isso, essa segunda etapa travaria a thread logo em seguida à primeira
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    publishCashTableWorkbook(arrayBuffer, file.name); // compartilha com qualquer operador, pra sempre — não precisa subir de novo
  }catch(err){
    console.error('Erro ao ler Mesas Cash:', err);
    showToast('Não foi possível ler essa planilha.', true);
    label.textContent = 'Carregar planilha de Mesas Cash (.xlsx)';
  }
});

/* publica a planilha de Mesas Cash inteira (em base64) num caminho FIXO do Firebase — fora de
   FB_BASE_PATH (que é por data), porque essa planilha é config de mesas, quase não muda, e o
   objetivo é subir uma vez por turno (ou nem isso) pra todo operador usar, sem resubir todo dia */
function arrayBufferToBase64(buffer){
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // processa em blocos pra não estourar o limite de argumentos do apply em arquivos grandes
  for (let i = 0; i < bytes.length; i += chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function publishCashTableWorkbook(arrayBuffer, filename){
  if (!fbReady) { showToast('Carregado só neste navegador — sem conexão pra compartilhar com seu parceiro.', true); return; }
  const b64 = arrayBufferToBase64(arrayBuffer);
  fbDb.ref('mesasCash').set({ data: b64, filename, uploadedAt: Date.now(), uploadedBy: OPERATOR_NAME || 'Alguém' })
    .then(() => showToast('Planilha compartilhada — outros operadores já podem usar sem subir de novo.'))
    .catch(err => {
      console.error('Firebase: falha ao publicar Mesas Cash', err);
      showToast('Carregado aqui, mas não foi possível compartilhar com seu parceiro.', true);
    });
}
function base64ToArrayBuffer(b64){
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function getCashTableMatrix(sheetKey){
  if (CASH_TABLE_MATRIX_CACHE[sheetKey]) return CASH_TABLE_MATRIX_CACHE[sheetKey];
  if (!CASH_TABLE_WORKBOOK) return null;
  const sheetName = CASH_TABLE_WORKBOOK.SheetNames.find(n => n === sheetKey) || CASH_TABLE_WORKBOOK.SheetNames.find(n => normText(n) === normText(sheetKey));
  if (!sheetName) return null;
  const ws = CASH_TABLE_WORKBOOK.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
  CASH_TABLE_MATRIX_CACHE[sheetKey] = matrix;
  return matrix;
}

/* acha a linha de cabeçalho procurando "NOME MESA" na 2ª coluna — a posição varia entre abas
   (linha 3 em algumas, linha 6 em outras), então não dá pra fixar um número */
function findCashTableHeaderRow(matrix){
  for (let i = 0; i < Math.min(matrix.length, 20); i++){
    const row = matrix[i];
    if(!row) continue;
    // Verificar qualquer célula da linha que seja "NOME MESA" ou "NOME"
    for(let c = 0; c < Math.min(row.length, 5); c++){
      if(row[c] && normText(String(row[c])).includes('nome')) return i;
    }
  }
  return -1;
}

function findBlindCol(matrix, headerRow){
  // Procurar coluna "BLINDS" no header dinamicamente
  const header = matrix[headerRow] || [];
  for(let c = 0; c < header.length; c++){
    if(header[c] && normText(String(header[c])).includes('blind')) return c;
  }
  return 8; // fallback: coluna padrão
}

function searchCashTables(sheetKey, blindSmall, blindBig){
  const matrix = getCashTableMatrix(sheetKey);
  if (!matrix) return null;
  const headerRow = findCashTableHeaderRow(matrix);
  if (headerRow === -1) return [];

  // Detectar colunas dinamicamente a partir do header
  const header = matrix[headerRow] || [];
  const colIdx = {};
  header.forEach((cell, c) => {
    if(!cell) return;
    const n = normText(String(cell));
    if(n.includes('blind'))    colIdx.blinds  = c;
    if(n.includes('nome'))     colIdx.nome    = c;
    if(n === 'max' || n.includes('max')) colIdx.max = c;
    if(n.includes('double') || n.includes('db')) colIdx.db = c;
    if(n.includes('cucuru'))   colIdx.cucuru  = c;
    if(n.includes('bomb'))     colIdx.bomb    = c;
    if(n.includes('buy'))      colIdx.buyin   = c;
  });

  // Fallback para colunas padrão (NLH/PLO)
  const C = {
    nome:   colIdx.nome   ?? 1,
    db:     colIdx.db     ?? 3,
    cucuru: colIdx.cucuru ?? 4,
    bomb:   colIdx.bomb   ?? 5,
    max:    colIdx.max    ?? 6,
    blinds: colIdx.blinds ?? 8,
    buyin:  colIdx.buyin  ?? 10,
  };

  const results = [];
  for (let i = headerRow+1; i < matrix.length; i++){
    const row = matrix[i];
    if (!row || !row[C.nome]) continue;
    const nome = String(row[C.nome]).trim();
    const blinds = parseCashBlinds(row[C.blinds], nome);
    if (!blinds) continue;
    if (Math.abs(blinds.small - blindSmall) > 0.001 || Math.abs(blinds.big - blindBig) > 0.001) continue;
    results.push({
      nome,
      maxTable: row[C.max],
      doubleBoard: row[C.db],
      cucurucho: row[C.cucuru],
      bombPot: row[C.bomb],
      buyin: row[C.buyin],
    });
  }
  return results;
}

function renderCashTableResults(results, blindSmall, blindBig){
  const resultEl = document.getElementById('cashTablesResult');
  document.getElementById('cashTableChecklist').hidden = true;
  LAST_CASH_TABLE_RESULTS = results || [];
  if (!results || !results.length){
    // tenta sugerir o blind mais próximo na planilha
    const sheetKey = document.getElementById('ctModalidade').value;
    const matrix = getCashTableMatrix(sheetKey);
    let suggestion = '';
    if(matrix){
      const headerRow = findCashTableHeaderRow(matrix);
      if(headerRow !== -1){
        let closest = null, closestDist = Infinity;
        for(let i = headerRow+1; i < matrix.length; i++){
          const row = matrix[i];
          if(!row || !row[1]) continue;
          const blinds = parseCashBlinds(row[8], String(row[1]));
          if(!blinds) continue;
          const dist = Math.abs(blinds.big - blindBig);
          if(dist < closestDist){ closestDist = dist; closest = blinds; }
        }
        if(closest && closestDist < blindBig * 0.5){
          suggestion = `<div style="margin-top:10px;font-size:12px;color:var(--warn-text);background:var(--warn-bg);border-radius:8px;padding:8px 12px;">
            Blind mais próximo disponível: <strong>${fmtBRL(closest.small,2)}/${fmtBRL(closest.big,2)}</strong>
          </div>`;
        }
      }
    }
    resultEl.innerHTML = `<div class="ct-empty-state">Nenhuma mesa com blind ${fmtBRL(blindSmall,2)}/${fmtBRL(blindBig,2)} nessa modalidade.${suggestion}</div>`;
    return;
  }
  const head = `
    <div class="ct-table-row" style="border:none; padding:0 14px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-soft); cursor:default;">
      <span>Nome da mesa</span><span style="text-align:center;">Máx.</span><span style="text-align:center;">DB</span><span style="text-align:center;">Cucurucho</span><span style="text-align:center;">Bomb</span>
    </div>`;
  const rows = results.map((r, idx) => `
    <div class="ct-table-row" data-idx="${idx}" tabindex="0">
      <span class="ct-nome">${r.nome}</span>
      <span class="ct-tag">${r.maxTable ?? '—'}p</span>
      <span class="ct-tag ${normText(r.doubleBoard)==='sim' ? 'yes' : ''}">${r.doubleBoard ?? '—'}</span>
      <span class="ct-tag ${r.cucurucho && normText(r.cucurucho)!=='nao' ? 'yes' : ''}">${r.cucurucho ?? '—'}</span>
      <span class="ct-tag ${r.bombPot && normText(r.bombPot)!=='nao' ? 'yes' : ''}">${r.bombPot ?? '—'}</span>
    </div>`).join('');
  resultEl.innerHTML = `<div class="ct-result-count">${results.length} mesa${results.length>1?'s':''} encontrada${results.length>1?'s':''} · clique numa mesa pra ver o que ativar</div>${head}<div class="ct-table-list">${rows}</div>`;

  resultEl.querySelectorAll('.ct-table-list .ct-table-row').forEach(el => {
    const open = () => {
      resultEl.querySelectorAll('.ct-table-row.selected').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      renderCashTableChecklist(results[parseInt(el.dataset.idx,10)]);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

/* monta a "checklist de ativação" pra mesa escolhida — junta o que veio do formulário (já convertido)
   com os dados da própria mesa na planilha (max jogadores, double board etc) */
function renderCashTableChecklist(table){
  const el = document.getElementById('cashTableChecklist');
  const small = parseFloat(document.getElementById('ctBlindSmall').value);
  const big = parseFloat(document.getElementById('ctBlindBig').value);
  const anteRaw = parseFloat(document.getElementById('ctAnte').value);
  const buyinBB = parseInt(document.getElementById('ctBuyinBB').value, 10);
  const players = document.getElementById('ctPlayers').value;
  const vpipPctRaw = parseFloat(document.getElementById('ctVpipPct').value);
  const password = document.getElementById('ctPassword').checked;
  const straddle = document.getElementById('ctStraddle').checked;
  const cucuruchoMult = document.getElementById('ctCucurucho').value; // select travado: '', '1'..'5'
  const bombPotMult = document.getElementById('ctBombPot').value; // select travado: '', '2'..'5'

  const convBig = big / getCashTableDivisor();
  const antePct = (!isNaN(anteRaw) && convBig > 0) ? Math.round(((anteRaw/getCashTableDivisor()) / convBig) * 1000) / 10 : null;

  // VPIP: limite de ativação no app é 45%, mesmo o cliente pedindo até 95% — mãos sempre fixas em 20,
  // não dependem do que foi pedido (regra confirmada com o operador)
  const VPIP_MAX_PCT = 45;
  const VPIP_HANDS = 20;
  const vpipCapped = !isNaN(vpipPctRaw) && vpipPctRaw > VPIP_MAX_PCT;
  const vpipFinalPct = !isNaN(vpipPctRaw) ? Math.min(vpipPctRaw, VPIP_MAX_PCT) : null;

  // Buy-in: usa o intervalo da própria mesa na planilha (ex: "20 - 40")
  // 100bb NÃO dobra o valor — a mesa já tem o buy-in configurado corretamente na planilha
  let buyinLabel = table.buyin != null ? String(table.buyin).trim() : '—';
  if (buyinBB === 100) {
    // apenas exibe o buy-in da mesa sem modificar
    buyinLabel = table.buyin != null ? String(table.buyin).trim() + ' (plano 100bb)' : '—';
  }

  // compara o Nº de players pedido no formulário com a capacidade real da mesa escolhida — quando
  // são diferentes, o operador precisa lembrar de ajustar isso manualmente no app (a mesa do plano
  // já vem com uma capacidade fixa, que não muda sozinha conforme o pedido do cliente)
  const playersNum = players ? parseInt(players, 10) : null;
  const maxTableNum = table.maxTable != null ? parseInt(table.maxTable, 10) : null;
  const playersMismatch = playersNum != null && maxTableNum != null && playersNum !== maxTableNum;

  const items = [
    {label: 'Mesa', value: table.nome},
    {label: 'Blind', value: `${fmtBRL(small/getCashTableDivisor(),2)} / ${fmtBRL(convBig,2)}`},
    {label: 'Buy-in', value: buyinLabel},
    {label: 'Máx. jogadores', value: table.maxTable != null ? `${table.maxTable}p` : '—'},
  ];
  if (playersMismatch){
    items.push({label:'Nº jogadores informado', value: `${playersNum} pedido, mesa é pra ${maxTableNum} — ajustar manualmente no app`, warn:true});
  } else if (players){
    items.push({label:'Nº jogadores informado', value: players});
  }
  if (antePct != null) items.push({label:'Ante', value: `${fmtBRL(antePct,0)}% do BB — ativar manualmente`, warn:true});
  if (straddle) items.push({label:'Straddle', value:'Ativar manualmente', warn:true});
  if (cucuruchoMult) items.push({label:'Cucurucho', value:`${cucuruchoMult}x BB — ativar manualmente`, warn:true});
  // Bomb Pot pedido pelo cliente: limite sempre usado é 100% das mãos (não varia conforme o pedido)
  if (bombPotMult) items.push({label:'Bomb Pot', value:`${bombPotMult}x BB, 100% das mãos — ativar manualmente`, warn:true});
  if (vpipFinalPct != null){
    items.push({
      label: 'VPIP',
      value: vpipCapped
        ? `Cliente pediu ${fmtBRL(vpipPctRaw,0)}% — ativar ${VPIP_MAX_PCT}% (limite máximo), ${VPIP_HANDS} mãos`
        : `${fmtBRL(vpipFinalPct,0)}%, ${VPIP_HANDS} mãos`,
      warn: true,
    });
  }
  items.push({label:'Senha', value: password ? 'Ativar (com senha)' : 'Sem senha'});
  if (normText(table.doubleBoard) === 'sim') items.push({label:'Double Board', value:'Ativar', warn:true});
  if (table.cucurucho && normText(table.cucurucho) !== 'nao') items.push({label:'Cucurucho (mesa)', value: table.cucurucho, warn:true});
  if (table.bombPot && normText(table.bombPot) !== 'nao') items.push({label:'Bomb Pot (mesa)', value: table.bombPot, warn:true});

  el.innerHTML = `
    <div class="ct-checklist-title">
      <span>O que ativar no app</span>
      <button class="copy-btn" id="ctChecklistCopyBtn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
        <span>Copiar</span>
      </button>
    </div>
    <div class="ct-checklist-grid">
      ${items.map(it => `
        <div class="ct-checklist-item${it.warn ? ' warn' : ''}">
          <span class="ct-ci-label">${it.label}</span>
          <span class="ct-ci-value">${it.value}</span>
        </div>`).join('')}
    </div>
  `;
  el.hidden = false;
  el.scrollIntoView({behavior:'smooth', block:'nearest'});
  // texto simples pra colar em chat/whatsapp — mesmo conteúdo da checklist visual
  const checklistText = items.map(it => `${it.label}: ${it.value}`).join('\n');
  document.getElementById('ctChecklistCopyBtn').addEventListener('click', (e) => {
    copyToClipboard(checklistText, e.currentTarget);
  });
}

/* Mapa de divisores por servidor (atualizado conforme regras operacionais confirmadas):
   Peru (Soles 3.5) → ÷3.5  |  Colombia (Reais) → ÷5  |  Argentina (Dolar 0.8) → ÷0.8
   Os demais seguem a moeda — Reais=÷5, Dolar X=÷X, Soles X=÷X, etc. */
const SERVER_DIVISOR_MAP = {
  'reais':        5,
  'dolar 1':      1,
  'dolar 0.8':    0.8,
  'soles 3.5':    3.5,
  'boliviano 13': 13,
  'tenge 450':    450,
  '':             5,
};
function getDivisorForMoeda(moeda){
  const k = String(moeda||'').trim().toLowerCase();
  if(k in SERVER_DIVISOR_MAP) return SERVER_DIVISOR_MAP[k];
  // fallback: extrai o número do fim — "Dolar 0.8" → 0.8
  const m = k.match(/([\d.]+)$/);
  if(m){ const n = parseFloat(m[1]); if(!isNaN(n) && n > 0) return n; }
  return 5;
}
function getCashTableDivisor(){
  const sel = document.getElementById('ctServidor');
  if(!sel || !sel.value) return 5;
  const server = SERVER_DATA.find(s => s.liga === sel.value);
  return server ? getDivisorForMoeda(server.moeda) : 5;
}

function populateCashServerSelect(){ /* servidor removido da UI */ }
populateCashServerSelect();

function runCashTableSearch(){
  const sheetKey = document.getElementById('ctModalidade').value;
  const small = parseFloat(document.getElementById('ctBlindSmall').value);
  const big = parseFloat(document.getElementById('ctBlindBig').value);
  const convertedEl = document.getElementById('ctConverted');
  const resultEl = document.getElementById('cashTablesResult');

  if (isNaN(small) || isNaN(big)){
    convertedEl.hidden = true;
    resultEl.innerHTML = '';
    document.getElementById('cashTableChecklist').hidden = true;
    return;
  }
  const divisor = getCashTableDivisor();
  const convSmall = small / divisor;
  const convBig = big / divisor;
  convertedEl.hidden = false;
  const sel = document.getElementById('ctServidor');
  const serverLabel = sel?.value || 'servidor';
  convertedEl.textContent = `${fmtBRL(small,2)}/${fmtBRL(big,2)} ÷ ${divisor} (${serverLabel}) → mesa ${fmtBRL(convSmall,2)}/${fmtBRL(convBig,2)}`;

  if (!CASH_TABLE_WORKBOOK){
    resultEl.innerHTML = `<div class="ct-empty-state">Carregue a planilha de Mesas Cash primeiro.</div>`;
    return;
  }
  const results = searchCashTables(sheetKey, convSmall, convBig);
  renderCashTableResults(results, convSmall, convBig);
}

['ctModalidade', 'ctBlindSmall', 'ctBlindBig'].forEach(id => {
  document.getElementById(id).addEventListener('input', runCashTableSearch);
  document.getElementById(id).addEventListener('change', runCashTableSearch);
});
// esses campos não mudam QUAIS mesas aparecem na busca (não afetam blind/modalidade), só recalculam
// a checklist da mesa já selecionada — então só rerenderizam a checklist, sem refazer a busca inteira
['ctAnte', 'ctBuyinBB', 'ctPlayers', 'ctVpipPct', 'ctPassword', 'ctStraddle', 'ctCucurucho', 'ctBombPot'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const selected = document.querySelector('#cashTablesResult .ct-table-row.selected');
    if (selected) renderCashTableChecklist(LAST_CASH_TABLE_RESULTS[parseInt(selected.dataset.idx,10)]);
  });
  document.getElementById(id).addEventListener('change', () => {
    const selected = document.querySelector('#cashTablesResult .ct-table-row.selected');
    if (selected) renderCashTableChecklist(LAST_CASH_TABLE_RESULTS[parseInt(selected.dataset.idx,10)]);
  });
});

// Limpar formulário — reseta tudo pra montar o próximo pedido do zero, sem apagar campo por campo
// (mesma ideia do botão "Limpar" da Calculadora de Overlay). Não apaga a planilha carregada.
document.getElementById('ctClearBtn').addEventListener('click', () => {
  document.getElementById('ctModalidade').selectedIndex = 0;
  document.getElementById('ctPlayers').value = '';
  document.getElementById('ctBlindSmall').value = '';
  document.getElementById('ctBlindBig').value = '';
  document.getElementById('ctAnte').value = '';
  document.getElementById('ctBuyinBB').selectedIndex = 0;
  document.getElementById('ctVpipPct').value = '';
  document.getElementById('ctPassword').checked = false;
  document.getElementById('ctStraddle').checked = false;
  document.getElementById('ctCucurucho').selectedIndex = 0;
  document.getElementById('ctBombPot').selectedIndex = 0;
  document.getElementById('ctConverted').hidden = true;
  document.getElementById('cashTablesResult').innerHTML = '';
  document.getElementById('cashTableChecklist').hidden = true;
  LAST_CASH_TABLE_RESULTS = [];
  showToast('Formulário de Mesas Cash limpo.');
});

document.getElementById('cashTablesToggle').addEventListener('click', () => openDrawer('cashTablesDrawerOverlay'));
document.getElementById('cashTablesDrawerClose').addEventListener('click', () => closeDrawer('cashTablesDrawerOverlay'));
document.getElementById('cashTablesDrawerOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'cashTablesDrawerOverlay') closeDrawer('cashTablesDrawerOverlay');
});

/* =========================================================================
   ATALHOS DE TECLADO GLOBAIS
   Esc fecha qualquer gaveta/modal aberto (sempre o mais "de cima" primeiro, pra não fechar
   tudo de uma vez se houver mais de um aberto). Ctrl/Cmd+F foca a busca por nome da Agenda
   em vez de abrir a busca nativa do navegador — mais útil nesse contexto de uso o turno inteiro.
========================================================================= */
const ALL_DRAWER_OVERLAY_IDS = ['checklistDrawerOverlay', 'serversDrawerOverlay', 'routineDrawerOverlay', 'overlayCalcDrawerOverlay', 'overlayProjDrawerOverlay', 'cashTablesDrawerOverlay', 'shiftReportDrawerOverlay', 'guConfDrawerOverlay', 'addTorneioDrawerOverlay', 'diagDrawerOverlay'];

/* =========================================================================
   HISTÓRICO DE TORNEIOS
========================================================================= */

/* Grava os resultados do dia no histórico permanente (historico/d_AAAA_MM_DD/).
   Semântica alinhada com a planilha histórica:
   - overlay = prize pool TOTAL gerado (= r.premiacao digitado pelo operador)
   - premiacao = buy-in por jogador (r.buyin da grade)
   - field = jogadores
   - perf = (prize_pool - gtd) / gtd × 100
   - acoes = calculado via fórmula de buy-in */
function appendTodayToHistorico(){
  if(!fbReady || PANEL_RO || !RAW_ROWS.length) return;
  const n = nowInSP();
  const ds = `${n.year}-${String(n.month).padStart(2,'0')}-${String(n.day).padStart(2,'0')}`;
  const recs = RAW_ROWS.filter(r => r.premiacao != null && r.premiacao > 0).map(r => {
    const prizePool  = r.premiacao;                              // prize pool total
    const gtd        = getGarantidoEffective(r._key) ?? r.garantido ?? 0;
    const buyin      = r.buyin;                                  // buy-in por jogador
    const fieldVal   = r.field ?? FIELD_MAP[r._key] ?? null;
    const perf       = gtd > 0 ? Math.round(((prizePool - gtd) / gtd) * 1000) / 10 : null;
    const acoes      = calcAcoesForRow(r);
    return {
      nome:      r.nome,
      date:      ds,
      dia:       null,
      hora:      r.hora || null,
      late:      r.late || null,
      garantido: gtd,
      /* ?? null em TUDO que pode faltar: o RTDB rejeita `undefined` com throw
         SÍNCRONO (o .catch do set não pega) — uma linha manual sem buy-in
         derrubava a gravação do dia inteiro no histórico */
      premiacao: buyin ?? null,     // buy-in (alinhado com planilha histórica)
      overlay:   prizePool ?? null, // prize pool total (alinhado com planilha histórica)
      field:     fieldVal,
      acoes:     acoes ?? null,
      perf:      perf,
      operador:  OPERATOR_NAME || null,
      fixadoPor: fixedBy(r._key) || null,
      id:        getId(r._key) || null,
    };
  });
  if(!recs.length) return;
  const dayKey = `historico/d_${ds.replace(/-/g,'_')}`;
  fbDb.ref(dayKey).set(recs).catch(()=>{});
  // Atualiza metadados
  fbDb.ref('historico/_meta').transaction(m => {
    if(!m) return m;
    m.count = (m.count || 0) + recs.length;
    if(!m.periodoFim || ds > m.periodoFim) m.periodoFim = ds;
    return m;
  });
}

document.addEventListener('keydown', (e) => {
  if (typeof e.key !== 'string') return; // autofill/IME disparam keydown sem key
  if (e.key === 'Escape'){
    // fecha o sheet de horário, se estiver aberto (tem seu próprio overlay separado das gavetas)
    const tfSheet = document.getElementById('tfSheetOverlay');
    if (tfSheet && tfSheet.classList.contains('open')){
      tfSheet.classList.remove('open');
      return;
    }
    // fecha o modal de nome do operador, se estiver com nome já definido (não fecha na primeira visita obrigatória)
    const opOverlay = document.getElementById('operatorOverlay');
    if (opOverlay && opOverlay.classList.contains('open') && OPERATOR_NAME){
      opOverlay.classList.remove('open');
      return;
    }
    // fecha a primeira gaveta aberta encontrada
    const openDrawerId = ALL_DRAWER_OVERLAY_IDS.find(id => document.getElementById(id)?.classList.contains('open'));
    if (openDrawerId){ closeDrawer(openDrawerId); return; }
    // sem nada pra fechar: se o filtro de horário estiver ativo, Esc limpa ele (atalho rápido de "ver tudo")
    if (timeFilterMin !== null){ clearTimeFilter(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'){
    const nameInput = document.getElementById('nameSearchInput');
    if (nameInput){
      e.preventDefault();
      nameInput.focus();
      nameInput.select();
    }
    return;
  }
  // F sozinho (sem Ctrl/Cmd) marca/desmarca como fixado o card que está sob o mouse no momento —
  // só funciona fora de campos de texto, pra não atrapalhar quem está digitando um ID ou nome
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey){
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (isTyping || !HOVERED_CARD_KEY) return;
    const toggle = document.querySelector(`.fix-toggle[data-key="${HOVERED_CARD_KEY}"]`);
    if (toggle){
      e.preventDefault();
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change', {bubbles:true}));
    }
  }
});

const nav = document.getElementById('nav');
const progressBar = document.getElementById('progressBar');
let scrollTicking = false;
window.addEventListener('scroll', () => {
  // 1 cálculo por frame de tela (rAF). Faz TODAS as leituras antes das escritas pra
  // não forçar reflow síncrono no meio do frame — causa comum de "mini travadas".
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const h = document.documentElement;
    const scrollY = window.scrollY;                 // leitura
    const max = h.scrollHeight - h.clientHeight;    // leitura
    nav.classList.toggle('scrolled', scrollY > 8);  // escrita
    progressBar.style.transform = 'scaleX(' + (max > 0 ? scrollY / max : 0).toFixed(4) + ')'; // escrita (compositor puro)
    scrollTicking = false;
  });
}, {passive:true});

/* Scroll-spy via IntersectionObserver — destaca no nav a seção em foco SEM ler
   getBoundingClientRect a cada frame de scroll (isso forçava reflow e travava de leve).
   A seção que cruza uma banda fina perto do topo vira a ativa. Seções ocultas
   (#nao-fixados quando vazio) simplesmente nunca intersectam. */
const spyLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')].map(a => ({
  a, id: a.getAttribute('href').slice(1)
}));
if ('IntersectionObserver' in window){
  const _spyById = {};
  spyLinks.forEach(({a, id}) => { _spyById[id] = a; });
  const spyIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting){
        spyLinks.forEach(({a}) => a.classList.remove('active'));
        _spyById[e.target.id]?.classList.add('active');
      }
    });
  }, { rootMargin: '-14% 0px -80% 0px', threshold: 0 });
  spyLinks.forEach(({id}) => { const s = document.getElementById(id); if (s) spyIO.observe(s); });
}

document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* pausa animação de pulsar (atrasado/rolando agora) em cards fora da viewport — economiza GPU sem
   mudar nada visualmente pro que está realmente na tela. margem de 200px evita pausar/retomar bem na
   borda da tela durante o scroll, o que ficaria perceptível. roda de novo após cada render da Agenda/
   alerta, já que os cards são recriados do zero a cada vez (ver renderUpcoming/renderUnfixed). */

function observeAnimatedCards(container){
  container.querySelectorAll('.tcard.is-late, .tcard.is-running, .ucard.is-late-pulse').forEach(el => {
    animVisibilityIO.observe(el);
  });
}

function tick(){
  const n = nowInSP();
  const dd = String(n.day).padStart(2,'0');
  const months = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const hh = String(n.hour).padStart(2,'0');
  const mm = String(n.minute).padStart(2,'0');
  document.getElementById('navTime').textContent = `${dd} ${months[n.month - 1]} · ${hh}:${mm}`;
  // atualiza countdowns só se há cards visíveis
  const nowMin = opNowMinutes(); // relógio operacional ajustado à grade — data-evmin já vem deslocado do render
  const countdownEls = document.querySelectorAll('.tcard-countdown[data-evmin]');
  if(!countdownEls.length) return;
  countdownEls.forEach(el => {
    const evMin = parseInt(el.dataset.evmin, 10);
    const diff = evMin - nowMin;
    const abs = Math.abs(diff);
    if(diff > 0 && diff <= 120){
      const h = Math.floor(abs/60), m = abs%60;
      el.textContent = 'falta ' + (h > 0 ? h+'h '+m+'min' : m+'min');
      el.className = 'tcard-countdown soon';
    } else if(diff < 0 && diff >= -180){
      el.textContent = 'há ' + (Math.floor(abs/60) > 0 ? Math.floor(abs/60)+'h ' : '') + abs%60+'min';
      el.className = 'tcard-countdown late';
    } else {
      el.remove();
    }
  });
}
tick();
setVisibilityAwareInterval(tick, 1000*60); // 60s é suficiente para countdown

/* recalcula quem entra no alerta (a janela de antecedência muda com o relógio) e reordena/re-renderiza,
   sem precisar de novo upload — é o timer mais caro do painel (até 2 renders completos de ~150 cards),
   então pausar enquanto a aba está oculta é o que mais reduz consumo de CPU em segundo plano */
let _lastTickSignature = '';
setVisibilityAwareInterval(() => {
  if (!RAW_ROWS.length) return;
  // Só re-renderiza se o estado VISÍVEL mudou desde o último tick.
  // A assinatura antiga incluía nowMin — que muda a cada tick por definição —
  // então o guard nunca pulava e a agenda inteira era reconstruída por minuto.
  // O que muda o desenho dos cards com o relógio são os FLAGS (em breve/atrasado/
  // rolando) e a lista de não-fixados: é isso que entra na assinatura agora.
  const nowMin = nowMinutesSP();
  const newUnfixed = computeUnfixed();
  const flagsSig = UPCOMING.map(t =>
    (cardTimeFlag(t) || '-') + (isRunningNow(t, nowMin) ? 'r' : '')).join('');
  const sig = `${flagsSig}|${newUnfixed.map(t => t._key || t.nome).join(',')}|${RESULTS.length}|${Object.keys(FIXED_MAP).length}`;
  if(sig === _lastTickSignature) return;
  _lastTickSignature = sig;
  UNFIXED = newUnfixed;
  document.getElementById('statUnfixed').textContent = UNFIXED.length;
  updateProgress();
  renderUnfixed();
  // esse timer roda a cada 60s independente de qualquer edição — sem essa checagem, ele podia
  // reconstruir a agenda inteira bem no meio de uma digitação de premiação/field, fazendo os
  // cards "sumirem" sem nenhuma relação direta com a ação do operador (mesma causa já corrigida
  // nos listeners do Firebase, só que esse é um timer puro, não eco de escrita)
  if(!isTypingInCard() && !window._suppressRenderUpcoming) renderUpcoming();
}, 1000*60);

/* =========================================================================
   1. NOTIFICAÇÕES DE BROWSER — alerta de torneio próximo de fixar
   Usa a Notification API nativa do browser. Só funciona se o usuário conceder
   permissão. Verificamos a cada 60s (junto com o recálculo de pendências) se
   algum torneio entrou na janela de alerta nos últimos 2 minutos.
========================================================================= */
const NOTIF_ALERTED = new Set(); // evita repetir a mesma notificação

function requestNotifPermission(){
  Notification.requestPermission().then(p => {
    if(p === 'granted'){
      showToast('Alertas de torneio ativados — você será avisado mesmo com o painel minimizado.');
      localStorage.setItem('suprema_notif_asked','granted');
    } else {
      showToast('Permissão de notificação negada — você pode ativar depois nas configurações do navegador.', true);
      localStorage.setItem('suprema_notif_asked','denied');
    }
    document.getElementById('notifBanner').classList.remove('show');
  });
}
function dismissNotifBanner(){
  document.getElementById('notifBanner').classList.remove('show');
  localStorage.setItem('suprema_notif_asked','dismissed');
}
function maybeShowNotifBanner(){
  const asked = localStorage.getItem('suprema_notif_asked');
  if(asked) return; // já perguntamos antes
  if(!('Notification' in window)) return; // browser não suporta
  if(Notification.permission === 'granted') return; // já tem
  // mostra o banner suavemente após 30s de uso, não na cara dura ao entrar
  setTimeout(() => {
    const asked2 = localStorage.getItem('suprema_notif_asked');
    if(!asked2) document.getElementById('notifBanner').classList.add('show');
  }, 30000);
}
/* Beep discreto via Web Audio API — sem dependências externas */
function playAlertBeep(urgent = false){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = urgent ? 880 : 660;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.03);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.22);
    if(urgent){
      // dois beeps para urgente
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.32);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.52);
    }
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (urgent ? 0.55 : 0.25));
    osc.onended = () => ctx.close();
  }catch(e){}
}

function sendTournamentNotification(torneio, minutesLeft){
  if(!('Notification' in window)) return;
  if(Notification.permission !== 'granted') return;
  if(NOTIF_ALERTED.has(torneio._key)) return;
  NOTIF_ALERTED.add(torneio._key);
  const body = minutesLeft <= 0 ? 'Hora de fixar agora!' : `${minutesLeft} min para fixar`;
  const n = new Notification(`♠ ${torneio.nome}`, {
    body,
    icon: 'https://suprema-poker.netlify.app/favicon.ico',
    badge: 'https://suprema-poker.netlify.app/favicon.ico',
    tag: torneio._key, // agrupa notificações do mesmo torneio
    requireInteraction: minutesLeft <= 5, // fica na tela até interagir se urgente
  });
  n.onclick = () => { window.focus(); n.close(); };
  // auto-fecha não-urgentes após 8s
  if(minutesLeft > 5) setTimeout(() => n.close(), 8000);
}
function checkTournamentNotifications(){
  if(!RAW_ROWS.length || !UPCOMING || !UPCOMING.length) return; // nada carregado ainda
  if(Notification.permission !== 'granted') return;
  const now = nowInSP();
  const nowMin = now.hour * 60 + now.minute;
  UPCOMING.forEach(r => {
    if(isFixed(r._key)) return;
    const horaMin = timeToMinutes(r.hora);
    if(horaMin === null) return;
    const isSat = (r.tipo||'').toLowerCase().includes('sat');
    const windowMin = isSat ? 30 : 60;
    const minutesUntilDeadline = (horaMin - windowMin) - nowMin;
    // notifica quando entrar na janela (0-2 min atrás para não perder) ou quando urgente (5 min)
    if(minutesUntilDeadline >= -2 && minutesUntilDeadline <= 2){
      sendTournamentNotification(r, Math.max(0, minutesUntilDeadline));
      playAlertBeep(false);
    } else if(minutesUntilDeadline === 5){
      sendTournamentNotification(r, 5);
      playAlertBeep(true); // dois beeps para urgente
    }
  });
}
// hook nas verificações periódicas existentes
setVisibilityAwareInterval(checkTournamentNotifications, 60000);
// pede permissão depois que o operador já entrou no painel — dispara no login/cadastro

/* =========================================================================
   2. HISTÓRICO DE FIXAÇÃO — já implementado no fixedAt() acima, e exibido
   nos cards. Adicionalmente, o export XLSX já incluía o nome — agora inclui
   também o horário de fixação (já capturado no FIXED_MAP[key].at).
========================================================================= */

/* =========================================================================
   3. ATALHOS DE TECLADO EXPANDIDOS
   Novos: R = Relatório de Turno, C = Mesas Cash, O = Calculadora Overlay,
   H = Conferência de Hoje, A = foca busca na Agenda,
   N = vai pra aba Não Fixados, Shift+R = Resultados
========================================================================= */
document.addEventListener('keydown', e => {
  // ignora se estiver digitando em algum input/textarea
  const tag = document.activeElement?.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // ignora se alguma gaveta estiver aberta (as ações de gaveta têm seus próprios atalhos)
  const anyDrawerOpen = ALL_DRAWER_OVERLAY_IDS.some(id =>
    document.getElementById(id)?.classList.contains('open')
  );
  switch(e.key){
    case 'r': case 'R':
      if(e.shiftKey){
        // Shift+R → aba Resultados
        document.querySelector('[data-tab="results"]')?.click();
      } else {
        // R → Relatório de Turno
        openDrawer('shiftReportDrawerOverlay');
      }
      break;
    
    case 's': case 'S':
      if(!anyDrawerOpen) openDrawer('serversDrawerOverlay');
      break;
    case 'c': case 'C':
      if(!anyDrawerOpen) openDrawer('cashTablesDrawerOverlay');
      break;
    case 'o': case 'O':
      if(!anyDrawerOpen) openDrawer('overlayCalcDrawerOverlay');
      break;
    
    case 'Escape':
      ALL_DRAWER_OVERLAY_IDS.forEach(id => closeDrawer(id));
      break;
  }
});

/* =========================================================================
   4. EXPORT DO RELATÓRIO DE TURNO COMO PDF
   Usa a impressão nativa do browser (window.print) com uma @media print
   escondendo tudo exceto o conteúdo do relatório — resultado é um PDF
   limpo com logo da Suprema, data e o texto do relatório.
========================================================================= */
(function setupPrintStyle(){
  const style = document.createElement('style');
  style.textContent = `
    @media print {
      body > *:not(#printArea){ display:none!important; }
      #printArea{
        display:block!important;
        font-family:'Courier New',monospace;font-size:13px;line-height:1.7;
        color:#000;white-space:pre-wrap;padding:32px;
      }
      #printArea h2{font-family:sans-serif;font-size:18px;margin:0 0 4px;color:#000}
      #printArea .print-sub{font-family:sans-serif;font-size:11px;color:#555;margin-bottom:20px;}
      #printArea .print-sep{border:none;border-top:1px solid #ccc;margin:12px 0;}
    }
  `;
  document.head.appendChild(style);
  // create hidden print area
  const div = document.createElement('div');
  div.id = 'printArea';
  div.style.display = 'none';
  document.body.appendChild(div);
})();

function exportReportAsPDF(){
  const text = document.getElementById('shiftReportText')?.value || '';
  if(!text.trim()){ showToast('Relatório vazio — escreva algo antes de exportar.', true); return; }
  const printArea = document.getElementById('printArea');
  const n = nowInSP();
  const dateStr = `${String(n.day).padStart(2,'0')}/${String(n.month).padStart(2,'0')}/${n.year}`;
  printArea.innerHTML = `
    <h2>♠ Suprema Poker</h2>
    <div class="print-sub">Relatório de Turno · ${dateStr} · Operador: ${OPERATOR_NAME || '—'}</div>
    <hr class="print-sep">
    ${text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}
  `;
  window.print();
}

// Adiciona botão de export PDF na gaveta do relatório
(function addPDFButton(){
  // usa getElementById em vez de querySelector encadeado pra evitar falha silenciosa
  const drawerBody = document.getElementById('shiftReportDrawer')?.querySelector('.drawer-body');
  const footerEl = drawerBody?.querySelector('.sr-footer');
  if(!footerEl){
    console.warn('addPDFButton: .sr-footer não encontrado — botão PDF não adicionado');
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'routine-download';
  btn.style.cssText = 'background:var(--bg-deep);color:var(--ink-soft);border:1px solid var(--hairline-strong);box-shadow:none;flex:none;padding:12px 16px;';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> PDF`;
  btn.onclick = exportReportAsPDF;
  footerEl.insertBefore(btn, footerEl.firstChild);
})();

/* =========================================================================
   5. TYPING INDICATOR no Relatório de Turno
   Publica um nó temporário no Firebase enquanto o operador está digitando,
   com debounce de 3s pra desaparecer depois de parar. O parceiro vê os dots
   animados enquanto o outro está ativamente editando.
========================================================================= */
const TYPING_PATH = `relatorioTurno/typing/${PRESENCE_SESSION_ID}`;
let typingTimeout = null;
let isShowingTypingIndicator = false;

function setTypingActive(active){
  if(!fbReady || PANEL_RO) return;
  if(active){
    fbDb.ref(TYPING_PATH).set({
      name: OPERATOR_NAME || 'Parceiro',
      at: firebase.database.ServerValue.TIMESTAMP
    }).catch(() => {});
    // auto-remove depois de 8s mesmo sem blur (proteção contra aba fechada sem blur)
    fbDb.ref(TYPING_PATH).onDisconnect().remove();
  } else {
    fbDb.ref(TYPING_PATH).remove().catch(() => {});
  }
}

// watch for partner typing
(function watchPartnerTyping(){
  if(!fbReady || !fbDb) return; // Firebase pode não ter inicializado se offline
  // typing listener centralizado em initFirebaseSync
})();

const shiftTextarea = document.getElementById('shiftReportText');
if(shiftTextarea){
  shiftTextarea.addEventListener('input', () => {
    setTypingActive(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => setTypingActive(false), 3000);
  });
  shiftTextarea.addEventListener('blur', () => {
    clearTimeout(typingTimeout);
    setTypingActive(false);
  });
}

/* Registro do Service Worker consolidado no bloco 13/14 (mais acima) — este bloco duplicado
   usava caminho absoluto '/sw.js', que aponta pra fora do escopo /painelpoker/ no GitHub Pages */

/* =========================================================================
   MODO DARK/LIGHT
   Persiste no localStorage. Toggle na nav alterna entre os dois modos.
   A classe .dark no <html> ativa as variáveis CSS do tema escuro.
========================================================================= */
(function initDarkMode(){
  const saved = localStorage.getItem('suprema_dark_mode');
  // padrão: dark se o sistema preferir dark, ou se tiver salvo
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved !== null ? saved === '1' : prefersDark;
  if(isDark) document.documentElement.classList.add('dark');
  paintDark(document.getElementById('darkToggle'), isDark);
})();

/* pinta o switch (sol|pílula|lua). Usa o helper compartilhado da shell quando
   presente; sem ele, cai no glifo antigo pra não quebrar. */
function paintDark(btn, isDark){
  if(!btn) return;
  if(window.SupremaShell && SupremaShell.paintSwitch) SupremaShell.paintSwitch(btn, isDark);
  else btn.textContent = isDark ? '☀️' : '🌙';
}

document.getElementById('darkToggle')?.addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('suprema_dark_mode', isDark ? '1' : '0');
  paintDark(document.getElementById('darkToggle'), isDark);
});

/* Ecossistema: se o tema mudar em outra aba/página (hub, admin...), acompanha na hora */
window.addEventListener('storage', e => {
  if(e.key !== 'suprema_dark_mode' || e.newValue === null) return;
  const isDark = e.newValue === '1';
  document.documentElement.classList.toggle('dark', isDark);
  paintDark(document.getElementById('darkToggle'), isDark);
});

/* ── Gaveta neumórfica (menu lateral) ── aditiva ao nav de topo */
(function neuMenu(){
  const open = document.getElementById('nmOpen');
  const drawer = document.getElementById('nmDrawer');
  const back = document.getElementById('nmBackdrop');
  if(!open || !drawer || !back) return;
  const show = () => {
    back.hidden = false; requestAnimationFrame(() => back.classList.add('show'));
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
    open.setAttribute('aria-expanded','true');
  };
  const hide = () => {
    back.classList.remove('show'); drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true'); open.setAttribute('aria-expanded','false');
    setTimeout(() => { back.hidden = true; }, 320);
  };
  open.addEventListener('click', show);
  back.addEventListener('click', hide);
  document.getElementById('nmClose')?.addEventListener('click', hide);
  drawer.querySelectorAll('.nm-item').forEach(a => a.addEventListener('click', hide));
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && drawer.classList.contains('open')) hide(); });
})();

/* =========================================================================
   AVISO DE PLANILHA DESATUALIZADA APÓS MEIA-NOITE
   A planilha do dia (RAW_ROWS) tem um campo uploadedAt do Firebase.
   Se a data do upload for diferente da data atual no fuso de SP, mostramos
   um aviso — tanto na calculadora de overlay quanto como toast ao abrir.
   Também verificamos periodicamente (a cada 5min) se virou o dia.
========================================================================= */

function isSheetStale(){
  if(!RAW_ROWS.length) return false; // sem planilha carregada, não há o que validar
  // compara com o dia que o PAINEL está mostrando (LAST_KNOWN_DATE), não com todayPathSP():
  // após a virada antecipada da madrugada os dois divergem até as 05:30 e a planilha nova
  // seria marcada como velha por engano
  if(window.SHEET_UPLOAD_DATE && window.SHEET_UPLOAD_DATE !== LAST_KNOWN_DATE) return true;
  return false;
}

/* todos os cards obrigatórios do quadro atual já foram fixados? (quadro vazio conta como "sim",
   não há nada pendente segurando a virada) */
function allCardsDone(rows, isFixedFn){
  rows = rows || RAW_ROWS;               // parâmetros opcionais só pro autoteste injetar fixtures
  isFixedFn = isFixedFn || (k => isFixed(k));
  if (!rows.length) return true;
  const relevant = rows.filter(r => mustFix(r, classify(r)));
  if (!relevant.length) return true;
  return relevant.every(r => isFixedFn(r._key));
}

/* autoteste da regra que SEGURA a virada de dia: roda uma vez por carregamento com quadros
   simulados — se alguma edição futura mudar o mustFix, o rowKey (_px) ou o allCardsDone de um
   jeito que solte a virada com card aberto (ou trave pra sempre), o alerta aparece na hora */
(function rolloverSelfTest(){
  const mk = (nome, hora, tipo, garantido, prox) => {
    const r = {nome, hora, tipo, garantido, buyin: 10, premiacao: null, proxCronograma: !!prox};
    r._key = rowKey(r);
    return r;
  };
  const main  = mk('T Main', '14:00', 'Main Event', 25000);
  const sideP = mk('T Side 500', '15:00', 'Side Event', 500);     // pequeno: não exige fixação
  const sideG = mk('T Side 8K', '16:00', 'Side Event', 8000);     // grande: exige
  const sat   = mk('T Sat', '17:00', 'SAT', 100);
  const prox  = mk('T Prox 5K', '01:00', 'Side Event', 5000, true);
  const board = [main, sideP, sideG, sat, prox];
  const fixedSet = new Set();
  const isFx = k => fixedSet.has(k);
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  try{
    check(allCardsDone([], isFx) === true, 'quadro vazio deveria liberar a virada');
    check(allCardsDone(board, isFx) === false, 'quadro todo aberto deveria segurar a virada');
    fixedSet.add(main._key); fixedSet.add(sideG._key); fixedSet.add(sat._key);
    check(allCardsDone(board, isFx) === false, 'card PRÓX. aberto deveria segurar a virada');
    fixedSet.add(prox._key);
    check(allCardsDone(board, isFx) === true, 'side pequeno (<3k) aberto NÃO deveria segurar a virada');
    // rowKey: o gêmeo prox do mesmo evento precisa ter chave própria
    const gemeoNormal = mk('T Prox 5K', '01:00', 'Side Event', 5000, false);
    check(gemeoNormal._key !== prox._key && prox._key.endsWith('_px'), 'chave _px do PRÓX. colidiu com o card normal gêmeo');
  }catch(e){ failures.push('exceção: ' + e.message); }
  if (failures.length){
    console.error('FALHA no autoteste da virada de dia:', failures);
    setTimeout(() => { try{ showToast('⚠ ERRO INTERNO na regra da virada de dia — revise antes de operar! Veja o console.', true); }catch(e){} }, 1500);
  }
})();
function checkStaleness(){
  const today = todayPathSP();
  // ">" (não "!==") — depois de uma virada antecipada de madrugada, LAST_KNOWN_DATE fica à
  // FRENTE de todayPathSP() até as 05:30; nesse caso não há nada a virar (e nunca voltar atrás)
  if(today > LAST_KNOWN_DATE){
    // A virada da grade (05:30) NÃO derruba o quadro enquanto o último card do dia não for
    // preenchido — o turno termina o trabalho no dia antigo (dados continuam indo pro nó certo)
    // e a troca acontece na hora em que o último card for fixado (ver updateProgress)
    if (!allCardsDone()){
      if (!ROLLOVER_HELD_TOAST){
        ROLLOVER_HELD_TOAST = true;
        const relevant = RAW_ROWS.filter(r => mustFix(r, classify(r)));
        const pendentes = relevant.filter(r => !isFixed(r._key)).length;
        showToast(`🕐 Grade virou (05:30), mas ainda faltam ${pendentes} card(s) — o painel troca de dia quando o último for preenchido.`);
      }
    } else {
      ROLLOVER_HELD_TOAST = false;
      LAST_KNOWN_DATE = today;
      resetDay();
    }
  }
  // atualiza banner na calculadora de overlay
  const banner = document.getElementById('ovcStaleBanner');
  if(banner) banner.classList.toggle('show', isSheetStale());
}
setVisibilityAwareInterval(checkStaleness, 5 * 60 * 1000);

/* ── Reset completo ao virar o dia ─────────────────────────────────────────
   Chamado automaticamente pela checkStaleness e também ao carregar nova Global.
   Reseta: fixados, IDs, field, premiações, garantidos, RAW_ROWS.
   Atualiza FB_BASE_PATH para o novo dia e re-registra todos os listeners.
──────────────────────────────────────────────────────────────────────────── */
function resetDay(forcedDate){
  // forcedDate: usado pela virada antecipada da madrugada, quando o dia novo é o dia CIVIL
  // de hoje e todayPathSP() (corte das 05:30) ainda devolveria o dia antigo
  const newPath = `painel/${forcedDate || todayPathSP()}`;
  const pathChanged = newPath !== FB_BASE_PATH;

  // 0. Salvar snapshot do dia anterior antes de limpar
  if(RAW_ROWS.length && fbReady){
    saveSnapshotToFirebase('day_end').catch(()=>{});
  }

  // 1. Limpar todos os maps de estado do dia anterior
  FIXED_MAP     = {};  saveFixedMapLocal({});
  PREM_BY_MAP   = {};  savePremByMapLocal({});
  ID_MAP        = {};  saveIdMapLocal({});
  FIELD_MAP     = {};  saveFieldMapLocal({});
  GARANTIDO_MAP = {};  saveGarantidoMapLocal({});
  CHECKLIST_MAP = {};  saveChecklistMapLocal({});

  // 2. Limpar premiações do localStorage (dia novo = dados novos)
  try { localStorage.removeItem('suprema_prem_v1'); } catch(e){}

  // 3. Limpar RAW_ROWS e re-renderizar (tela em branco até nova Global)
  RAW_ROWS = []; RESULTS = []; UPCOMING = []; UNFIXED = []; reindexRows();
  renderUnfixed(); renderUpcoming(); renderResults();
  computeStats(); updateProgress();

  // 4. Atualizar FB_BASE_PATH para o novo dia
  FB_BASE_PATH = newPath;

  // 5. Re-registrar listeners no novo path (desconectar o antigo é automático
  //    pois o Firebase SDK limpa listeners órfãos)
  if(pathChanged && fbReady){
    // Re-inicializar sincronização no novo path
    reinitDayListeners();
  }

  // 6. Resetar signature para aceitar nova sheet do dia
  LAST_APPLIED_SHEET_SIGNATURE = null;

  // 6b. Resetar botão da Global e pedir nova carga
  resetGlobalBtnStyle();
  showGlobalUpdatePrompt();

  // Atualizar data no nav
  const dateEl = document.getElementById('navTime');
  if(dateEl) dateEl.textContent = dataPorExtensoSP ? dataPorExtensoSP() : '';

  showToast('🌅 Novo dia — fixados e dados resetados. Carregue a planilha Global para hoje.');
}

/* ══════════════════════════════════════════════════════════════════
   PATCH DE CARD — atualiza campos sem recriar o card
   Evita perda de foco e flickering durante digitação do parceiro
══════════════════════════════════════════════════════════════════ */
function buildFixerRowHTML(key){
  const fixed  = isFixed(key);
  const fixer  = fixedBy(key);
  const filler = getIdBy(key);
  const showFiller = filler && (!fixed || filler !== fixer);
  let html = '';
  if(showFiller){
    html += `<div class="tcard-fixer-avatar" style="background:linear-gradient(135deg,#3b82f6,#1d4ed8)">${filler.charAt(0).toUpperCase()}</div>
    <div class="tcard-fixer-info">
      <span class="tcard-fixer-name" style="color:var(--blue,#60a5fa)">${filler}</span>
      <span class="tcard-fixer-at">Preencheu o ID</span>
    </div>`;
    if(fixed && fixer) html += '<span style="color:var(--ink-soft);margin:0 6px;font-size:10px">·</span>';
  }
  if(fixed && fixer){
    html += `<div class="tcard-fixer-avatar">${fixer.charAt(0).toUpperCase()}</div>
    <div class="tcard-fixer-info">
      <span class="tcard-fixer-name">${fixer}</span>
      <span class="tcard-fixer-at">Fixou${fixedAt(key) ? ' · '+fixedAt(key) : ''}</span>
    </div>`;
  }
  return html;
}

// Retorna true se o usuário está digitando em qualquer campo de card


/* ══ 5. Modo compacto ══ */
function toggleCompactMode(){
  _compactMode = !_compactMode;
  localStorage.setItem('suprema_compact_mode_v1', _compactMode ? '1' : '0');
  syncCompactToggleBtn();
  renderUpcoming(); // redesenhar com modo compacto ativo
}
// reflete o estado no botão — atualiza só o <span> do rótulo, não o botão inteiro,
// senão o textContent apagaria o ícone SVG que vive dentro dele
function syncCompactToggleBtn(){
  const btn = document.getElementById('compactToggleBtn');
  if(btn){
    btn.classList.toggle('active', _compactMode);
    const label = document.getElementById('compactToggleLabel');
    if(label) label.textContent = _compactMode ? 'Cards' : 'Compacto';
  }
}
syncCompactToggleBtn(); // aplica o estado restaurado do localStorage assim que a página carrega

/* ══ 7. Filtro por operador ══ */
function setOpFilter(mode){
  _opFilter = (_opFilter === mode) ? 'all' : mode;
  document.getElementById('opFilterMe')?.classList.toggle('active-me', _opFilter==='me');
  document.getElementById('opFilterPartner')?.classList.toggle('active-partner', _opFilter==='partner');
  renderUpcoming();
}

/* ══ 8. Undo stack (desfazer premiação) ══ */
const _undoStack = []; // [{key, nome, oldVal, oldFmt}]
let _undoToastTimer = null;

function pushUndo(key, nome, oldVal){
  _undoStack.push({key, nome, oldVal});
  if(_undoStack.length > 20) _undoStack.shift();
  showUndoToast(nome, oldVal);
}

function showUndoToast(nome, oldVal){
  clearTimeout(_undoToastTimer);
  document.querySelector('.undo-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  const label = oldVal != null ? `R$ ${fmtBRL(oldVal,2)}` : 'vazio';
  toast.innerHTML = `<span>Premiação de <b>${escHtml(nome.split(' ').slice(0,3).join(' '))}</b> alterada</span>
    <button onclick="doUndo()">↩ Desfazer</button>`;
  document.body.appendChild(toast);
  _undoToastTimer = setTimeout(()=>toast.remove(), 6000);
}

function doUndo(){
  const last = _undoStack.pop();
  if(!last) return;
  document.querySelector('.undo-toast')?.remove();
  clearTimeout(_undoToastTimer);
  const row = rowByKey(last.key);
  if(!row) return;
  // Restaurar valor anterior
  row.premiacao = last.oldVal;
  if(fbReady){
    if(last.oldVal != null) fbDb.ref(`${FB_BASE_PATH}/premiacao/${last.key}`).set(last.oldVal);
    else fbDb.ref(`${FB_BASE_PATH}/premiacao/${last.key}`).remove();
  }
  // Atualizar input
  const inp = document.querySelector(`.tcard-prem-input[data-key="${last.key}"]`);
  if(inp) inp.value = last.oldVal != null ? fmtBRL(last.oldVal, last.oldVal%1===0?0:2) : '';
  renderCardOverlayPreview(last.key, row, last.oldVal, getField(last.key));
  showToast(`↩ Desfeito: premiação de ${last.nome.split(' ').slice(0,3).join(' ')}`);
  logActivity(`Desfez premiação de <b>${last.nome}</b>`);
}

// Ctrl+Z global
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey) && e.key==='z' && !isTypingInCard()){
    e.preventDefault();
    doUndo();
  }
});

function isTypingInCard(){
  const ae = document.activeElement;
  if(!ae) return false;
  return ae.classList.contains('tcard-prem-input')
      || ae.classList.contains('tcard-field-input')
      || ae.classList.contains('id-input');
}

/* (versão antiga de formatPremInput que formatava em centavos foi removida — era código morto,
   sobrescrito por esta declaração de mesmo nome logo abaixo) */
function formatPremInput(inp){
  // Formata o valor ao sair do campo: "2543,20" → "2.543,20"
  const val = parsePremInput(inp);
  if(val != null){
    inp.value = fmtBRL(val, val % 1 === 0 ? 0 : 2);
  } else if(inp.value.trim()){
    // Valor inválido — não apaga, deixa o usuário corrigir
  }
}

function parsePremInput(inp){
  // Extrai número de "R$ 1.500,00" ou "1500" ou "1500.50"
  let s = inp.value.trim();
  // Remove "R$", espaços
  s = s.replace(/R\$\s*/g,'');
  // Se tem vírgula como decimal (formato pt-BR: 1.500,00)
  if(s.includes(',')) {
    s = s.replace(/\./g,'').replace(',','.');  // remove pontos de milhar, troca vírgula
  }
  const num = parseFloat(s);
  return isNaN(num) || num <= 0 ? null : Math.round(num * 100) / 100;
}

function patchCardFields(key){
  const card = document.querySelector(`.tcard[data-key="${key}"]`);
  if(!card) return false;
  const row = rowByKey(key);
  if(!row) return false;
  const fixed  = isFixed(key);
  const fixer  = fixedBy(key);
  const filler = getIdBy(key);
  const cat    = classify(row);

  // Badge premiação
  let badge = card.querySelector('.tcard-prem-badge');
  if(row.premiacao != null){
    if(!badge){
      badge = document.createElement('span');
      badge.className = 'tcard-prem-badge';
      const catDiv = card.querySelector('.tcard-cat > div');
      if(catDiv) catDiv.appendChild(badge);
    }
    badge.textContent = '✓ R$ ' + fmtBRL(row.premiacao, row.premiacao % 1 === 0 ? 0 : 2);
  } else if(badge){ badge.remove(); }

  // Inputs — só se não estiver em foco
  const premInp = card.querySelector('.tcard-prem-input');
  if(premInp && document.activeElement !== premInp && row.premiacao != null)
    premInp.value = row.premiacao;

  const fieldInp = card.querySelector('.tcard-field-input');
  if(fieldInp && document.activeElement !== fieldInp){
    const fv = FIELD_MAP[key];
    fieldInp.value = fv != null ? fv : '';
  }

  const idInp = card.querySelector('.id-input');
  if(idInp && document.activeElement !== idInp) idInp.value = getId(key);

  // Fixer row
  let fixerRow = card.querySelector('.tcard-fixer-row');
  if(fixed || filler){
    if(!fixerRow){
      fixerRow = document.createElement('div');
      fixerRow.className = 'tcard-fixer-row';
      const statusRow = card.querySelector('.tcard-status-row');
      if(statusRow) statusRow.before(fixerRow);
    }
    fixerRow.innerHTML = buildFixerRowHTML(key);
  } else if(fixerRow){ fixerRow.remove(); }

  // Checkbox
  const chk = card.querySelector('.fix-toggle');
  if(chk) chk.checked = fixed;
  const chkLabel = card.querySelector('.fix-check span');
  if(chkLabel) chkLabel.textContent = fixed ? 'Fixado' : 'Marcar como fixado';

  // Classe do card — NUNCA reescrever card.className inteiro aqui: isso apagava a classe "in"
  // da animação de entrada (adicionada só uma vez, no render completo, via requestAnimationFrame),
  // fazendo o .reveal voltar pro estado oculto (opacity:0) e o card sumir de vista sem nenhuma
  // reconstrução acontecer — bug raiz de "card sumindo" que sobrevivia mesmo com os cards intactos
  // no DOM. Só ajusta as classes que esta função realmente controla.
  card.classList.toggle('is-fixed', fixed);
  card.classList.toggle('must-fix', mustFix(row,cat) && !fixed);
  card.classList.toggle('has-premiacao', row.premiacao != null);

  return true;
}

/* Render agrupado — evita cascata de renders quando múltiplos listeners disparam juntos */
function scheduleRenderAll(){
  /* delega pro agendador unificado (scheduleUI, no topo do arquivo): um só
     caminho de flush pra rajadas de listeners, seja no load ou na virada.
     A regra de sempre atualizar KPIs mesmo com card em foco (o bug do "Pago em
     premiações" congelado em R$ 0) mora lá: 'stats' nunca é barrado, só o
     rebuild de 'upcoming'. */
  _lastTickSignature = '';
  scheduleUI('unfixed', 'stats', 'results', 'upcoming');
}

/* Re-registra apenas os listeners que dependem do FB_BASE_PATH (por dia) */
function reinitDayListeners(){
  if(!fbReady || !fbDb) return;

  // Remover listeners antigos do dia anterior antes de re-registrar
  // (evita duplicação de listeners ao virar o dia)
  ['premiacao','fixed','premBy','ids','field','garantido','checklist','confhoje','rolledTo','manualRows'].forEach(node => {
    fbDb.ref(`${FB_BASE_PATH}/${node}`).off();
  });

  // Torneios manuais do dia novo (os de ontem não vêm junto — o nó é por data)
  MANUAL_ROWS = {};
  fbDb.ref(`${FB_BASE_PATH}/manualRows`).on('value', snap => {
    MANUAL_ROWS = snap.val() || {};
    reingestComManuais();
    renderManualList();
  });

  // Sheet — re-registra no novo path (o listener antigo ficava preso no nó do dia anterior
  // e a aba nunca recebia a Global nova depois da virada sem recarregar)
  registerSheetListener();

  // Virada antecipada (madrugada): quando alguém fecha o dia 100% e sobe a Global do próximo
  // dia antes das 05:30, o nó antigo ganha o marcador rolledTo — esta aba segue junto pro dia
  // novo sem recarregar. Cobre também F5 durante a madrugada (o load começa no nó antigo).
  fbDb.ref(`${FB_BASE_PATH}/rolledTo`).on('value', snap => {
    const novo = snap.val();
    if (typeof novo === 'string' && novo > LAST_KNOWN_DATE){
      showToast(`📅 Painel virou para ${novo} — Global nova carregada.`);
      ROLLOVER_HELD_TOAST = false;
      LAST_KNOWN_DATE = novo;
      resetDay(novo);
    }
  });

  // Premiação — só anexa com auth viva (mesmo motivo do listener do load)
  whenAuthed(() => {
  fbDb.ref(`${FB_BASE_PATH}/premiacao`).on('value', snap => {
    const data = snap.val() || {};
    let changed = false;
    Object.entries(data).forEach(([key, val]) => {
      const row = rowByKey(key);
      if(row && row.premiacao !== val){ row.premiacao = val; changed = true;
        try{ const pm=JSON.parse(localStorage.getItem('suprema_prem_v1')||'{}'); pm[key]=val; localStorage.setItem('suprema_prem_v1',JSON.stringify(pm)); }catch(e){}
        const inp = document.querySelector(`.tcard-prem-input[data-key="${key}"]`);
        if(inp && document.activeElement !== inp){
          inp.value = val != null ? fmtBRL(val, val % 1 === 0 ? 0 : 2) : '';
        }
        renderCardOverlayPreview(key, row, val, getField(key));
      }
    });
    // só reconcilia exclusões quando o nó tem dados (ver comentário no listener gêmeo):
    // nó vazio não é "tudo apagado", senão zera as premiações vindas da planilha
    const premHasData = Object.keys(data).length > 0;
    if(premHasData) RAW_ROWS.forEach(r => { if(r.premiacao!=null && !r.premFromSheet && PREM_FB_KEYS_SEEN.has(r._key) && data[r._key]==null){ r.premiacao=null; changed=true; } });
    Object.keys(data).forEach(k => PREM_FB_KEYS_SEEN.add(k));
    if(changed||RAW_ROWS.length){
      RESULTS  = RAW_ROWS.filter(r=>r.premiacao!==null&&r.premiacao!==undefined);
      UPCOMING = [...RAW_ROWS];
      // SEMPRE re-renderiza: o próprio scheduleRenderAll decide o que barrar (só o rebuild
      // dos cards respeita foco/eco). Gatear aqui fora congelava os KPIs em R$ 0.
      scheduleRenderAll();
    }
  });
  });  // fim do whenAuthed (premiação)

  // Fixados
  fbDb.ref(`${FB_BASE_PATH}/fixed`).on('value', snap => {
    FIXED_MAP = snap.val() || {}; saveFixedMapLocal(FIXED_MAP);
    if(RAW_ROWS.length && !window._suppressRenderUpcoming) scheduleRenderAll();
  });

  // Responsável por premiação/field (exibido só nos Resultados — não afeta os cards da
  // agenda, então não precisa de scheduleRenderAll/renderUpcoming aqui. Chamar isso a
  // cada preenchimento de premiação/field reconstruía a agenda inteira à toa, fazendo
  // os cards "sumirem" até o IntersectionObserver revelar de novo)
  fbDb.ref(`${FB_BASE_PATH}/premBy`).on('value', snap => {
    PREM_BY_MAP = snap.val() || {}; savePremByMapLocal(PREM_BY_MAP);
    if(RAW_ROWS.length) scheduleUI('results');
  });

  // IDs
  fbDb.ref(`${FB_BASE_PATH}/ids`).on('value', snap => {
    ID_MAP = snap.val() || {}; saveIdMapLocal(ID_MAP);
    document.querySelectorAll('.id-input').forEach(inp => {
      const v = ID_MAP[inp.dataset.key]||'';
      if(document.activeElement !== inp) inp.value = v;
    });
    applyIdDuplicateChecks();
    // só reconstrói a agenda se não for o eco da própria escrita e ninguém estiver digitando —
    // sem isso, marcar NF (ou qualquer ID) reconstruía o grid inteiro à toa, fazendo os cards
    // "sumirem" até o IntersectionObserver revelar de novo (mesma causa já corrigida no premBy)
    if(RAW_ROWS.length && !isTypingInCard() && !window._suppressRenderUpcoming) scheduleRenderAll();
  });

  // Field
  fbDb.ref(`${FB_BASE_PATH}/field`).on('value', snap => {
    FIELD_MAP = snap.val() || {}; saveFieldMapLocal(FIELD_MAP);
    document.querySelectorAll('.tcard-field-input').forEach(inp => {
      const v = FIELD_MAP[inp.dataset.key];
      if(document.activeElement !== inp) inp.value = v!=null?v:'';
      const row = rowByKey(inp.dataset.key);
      if(row) row.field = v!=null?v:null;
    });
    if(RAW_ROWS.length) scheduleUI('results');
  });

  // Garantido
  fbDb.ref(`${FB_BASE_PATH}/garantido`).on('value', snap => {
    const data = snap.val() || {};
    Object.entries(data).forEach(([key, val]) => {
      GARANTIDO_MAP[key] = val;
      const row = rowByKey(key);
      if(row) row.garantido = val;
      const wrap = document.querySelector(`.tcard-garantido-wrap[data-key="${key}"]`);
      if(wrap && document.activeElement !== wrap.querySelector('.tcard-garantido-input')){
        const disp = wrap.querySelector('.tcard-garantido-display');
        if(disp) disp.textContent = fmtGarantidoBRL(val);
        wrap.classList.add('tcard-garantido-edited');
      }
    });
    saveGarantidoMapLocal(GARANTIDO_MAP);
    if(RAW_ROWS.length) scheduleUI('stats', 'results');
    else computeStats();
  });

  // Checklist e confhoje
  fbDb.ref(`${FB_BASE_PATH}/checklist`).on('value', snap => {
    CHECKLIST_MAP = snap.val()||{}; saveChecklistMapLocal(CHECKLIST_MAP); renderChecklist();
  });
  fbDb.ref(`${FB_BASE_PATH}/confhoje`).on('value', snap => {
    CONFHOJE_MAP = snap.val()||{}; saveConfHojeMapLocal(CONFHOJE_MAP); renderConfHoje();
  });
}

function showGlobalUpdatePrompt(){
  // Mostrar prompt persistente pedindo nova Global
  let prompt = document.getElementById('globalUpdatePrompt');
  if(!prompt){
    prompt = document.createElement('div');
    prompt.id = 'globalUpdatePrompt';
    prompt.innerHTML = `
      <div class="gup-icon">🌅</div>
      <div class="gup-text">
        <strong>Virada da grade (05:30) — atualize a Global</strong>
        <span>A grade de torneios do dia fechou. Turno da noite: carregue a Global MTT do novo dia antes da troca das 07:00.</span>
      </div>
      <button class="gup-btn" onclick="document.getElementById('fileInputGlobal').click();document.getElementById('globalUpdatePrompt').remove()">
        Carregar agora
      </button>
      <button class="gup-close" onclick="this.closest('#globalUpdatePrompt').remove()" aria-label="Fechar">✕</button>
    `;
    document.body.appendChild(prompt);
    // Animar entrada
    requestAnimationFrame(() => prompt.classList.add('show'));
  }
}

// hook no upload de planilha — salva a data do upload
const _origIngest = typeof ingest === 'function' ? ingest : null;
if(_origIngest){
  window.ingest = function(rows, filename, fromRemote){
    // LAST_KNOWN_DATE = dia que o painel aponta (após virada antecipada difere de todayPathSP)
    window.SHEET_UPLOAD_DATE = LAST_KNOWN_DATE || todayPathSP();
    return _origIngest(rows, filename, fromRemote);
  };
}
// hook no carregamento via Firebase também
const _origFbSheet = fbReady ? null : 'pending'; // será configurado após Firebase init

/* =========================================================================
   SNAPSHOT DE DADOS — salva estado completo dos cards no Firebase
   Estrutura: painel/{data}/snapshot/{key} = {nome, hora, tipo, garantido,
   premiacao, overlay, perf, field, id, fixadoPor, fixadoEm}
========================================================================= */

function buildSnapshotRows(){
  return RAW_ROWS.map(r => {
    const key  = r._key;
    const prem = r.premiacao;
    const gar  = getGarantidoEffective(key) ?? r.garantido;
    const diff = (prem != null && gar != null) ? prem - gar : null;
    const overlay = diff != null && diff < 0 ? diff : (diff != null && diff >= 0 ? diff : null);
    const perf = (prem != null && gar != null && gar > 0)
      ? Math.round(((prem - gar) / gar) * 1000) / 10 : null;
    return {
      nome:      r.nome      || '',
      hora:      r.hora      || '',
      late:      r.late      || null,
      tipo:      r.tipo      || classify(r),
      garantido: gar         ?? null,
      buyin:     r.buyin     ?? null,
      premiacao: prem        ?? null,
      overlay:   overlay     ?? null,
      perf:      perf        ?? null,
      field:     FIELD_MAP[key] ?? r.field ?? null,
      id:        getId(key)  || null,
      fixadoPor: fixedBy(key) || null,
      fixadoEm:  fixedAt(key) || null,
      status:    (getId(key)||'').toUpperCase() === 'NF' || r.explicitNF
                   ? 'NF' : (prem != null ? 'Fechado' : 'Aberto'),
    };
  });
}

async function saveSnapshotToFirebase(trigger='manual'){
  if(!fbReady || !RAW_ROWS.length) return;
  // a data do snapshot vem do nó ATIVO (FB_BASE_PATH), não do relógio: com a virada segurada
  // até o último card, o quadro na tela pode ser do dia anterior — salvar com todayPathSP()
  // gravaria os dados de ontem embaixo da data de hoje e bagunçaria o fechamento semanal
  const date = (FB_BASE_PATH.split('/')[1]) || todayPathSP();
  const rows = buildSnapshotRows();
  const snapshot = {
    savedAt: Date.now(),
    trigger,
    totalTorneios: rows.length,
    rows: Object.fromEntries(rows.map((r,i) => [r.id || `t${i}`, r])),
  };
  try {
    // SALVAGUARDA: o snapshot é a rede de recuperação das premiações (reatadas por nome+hora
    // quando uma grade nova troca as chaves). Premiação preenchida não DIMINUI ao longo do dia —
    // uma queda significa que os cards estão órfãos (bug da chave volátil). Nunca deixar um
    // snapshot automático gravar MENOS premiação por cima de um mais rico, ou perderíamos a fonte.
    // Só o manual força (o operador decide conscientemente).
    if(trigger !== 'manual'){
      const novoQtd = rows.filter(r => r.premiacao != null).length;
      const prev = (await fbDb.ref(`snapshots/${date}`).once('value')).val();
      if(prev && prev.rows){
        const prevRows = Array.isArray(prev.rows) ? prev.rows : Object.values(prev.rows);
        const prevQtd = prevRows.filter(r => r && r.premiacao != null).length;
        if(prevQtd > novoQtd){
          console.warn(`[snapshot] ignorado (${trigger}): teria reduzido premiações de ${prevQtd} → ${novoQtd}. Preservando a fonte de recuperação.`);
          return;
        }
      }
    }
    await fbDb.ref(`snapshots/${date}`).set(snapshot);
    if(trigger === 'manual') showToast(`✓ Snapshot salvo — ${rows.length} torneios`);
  } catch(e){
    console.error('Snapshot error', e);
    if(trigger === 'manual') showToast('Falha ao salvar snapshot', true);
  }
}

// Auto-snapshot: salvar a cada 15 min se há dados, e ao fechar a aba
setVisibilityAwareInterval(() => {
  if(RAW_ROWS.length && fbReady) saveSnapshotToFirebase('auto');
}, 15 * 60 * 1000);

window.addEventListener('beforeunload', () => {
  if(RAW_ROWS.length && fbReady) saveSnapshotToFirebase('beforeunload');
});

/* ── Relatório multi-dia ── */
async function openMultiDayReport(){
  if(!fbReady){ showToast('Firebase não conectado', true); return; }

  // Montar modal
  let modal = document.getElementById('multiDayModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'multiDayModal';
    modal.innerHTML = `
      <div class="mdr-box">
        <div class="mdr-head">
          <div>
            <div class="mdr-title">📊 Relatório multi-dia</div>
            <div class="mdr-sub">Escolha o período e exporte os dados dos cards</div>
          </div>
          <button class="mdr-close" onclick="document.getElementById('multiDayModal').classList.remove('open')">✕</button>
        </div>
        <div class="mdr-controls">
          <div class="mdr-field">
            <label>De</label>
            <input type="date" id="mdrFrom">
          </div>
          <div class="mdr-field">
            <label>Até</label>
            <input type="date" id="mdrTo">
          </div>
          <button class="mdr-load" onclick="loadMultiDayData()">Carregar</button>
          <button class="mdr-export" id="mdrExportBtn" onclick="exportMultiDay()" disabled>Exportar XLSX</button>
        </div>
        <div id="mdrStatus" class="mdr-status"></div>
        <div id="mdrPreview" class="mdr-preview"></div>
      </div>
    `;
    document.body.appendChild(modal);
    // Datas padrão: últimos 7 dias
    const today = todayPathSP();
    const d = new Date(); d.setDate(d.getDate()-6);
    const from = d.toISOString().slice(0,10);
    document.getElementById('mdrFrom').value = from;
    document.getElementById('mdrTo').value = today;
  }
  modal.classList.add('open');
}

let _mdrData = {};

async function loadMultiDayData(){
  const from = document.getElementById('mdrFrom').value;
  const to   = document.getElementById('mdrTo').value;
  const status = document.getElementById('mdrStatus');
  const preview = document.getElementById('mdrPreview');
  const exportBtn = document.getElementById('mdrExportBtn');

  if(!from || !to){ showToast('Selecione o período', true); return; }
  status.textContent = 'Carregando...';
  preview.innerHTML = '';
  exportBtn.disabled = true;
  _mdrData = {};

  try {
    const snap = await fbDb.ref('snapshots').orderByKey().startAt(from).endAt(to).once('value');
    const data = snap.val() || {};
    _mdrData = data;
    const dates = Object.keys(data).sort();

    if(!dates.length){
      status.textContent = 'Nenhum dado encontrado para o período.';
      return;
    }

    // Sumário por dia
    let html = '<table class="mdr-table"><thead><tr><th>Data</th><th>Torneios</th><th>Fechados</th><th>GTD Total</th><th>Premiação Total</th><th>Overlay</th></tr></thead><tbody>';
    dates.forEach(date => {
      const rows = Object.values(data[date].rows || {});
      const closed = rows.filter(r => r.premiacao != null);
      const gtd = rows.reduce((s,r) => s + (r.garantido||0), 0);
      const prem = closed.reduce((s,r) => s + (r.premiacao||0), 0);
      const ov = closed.reduce((s,r) => s + (r.overlay||0), 0);
      const [y,m,d] = date.split('-');
      const label = `${d}/${m}/${y}`;
      html += `<tr>
        <td><strong>${label}</strong></td>
        <td>${rows.length}</td>
        <td>${closed.length}</td>
        <td>R$ ${fmtBRL(gtd,0)}</td>
        <td>${prem > 0 ? 'R$ '+fmtBRL(prem,0) : '—'}</td>
        <td class="${ov < 0 ? 'mdr-neg' : ''}">${ov !== 0 ? 'R$ '+fmtBRL(ov, ov%1===0?0:2) : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    preview.innerHTML = html;
    status.textContent = `${dates.length} dia(s) encontrado(s) — ${dates[0]} até ${dates[dates.length-1]}`;
    exportBtn.disabled = false;
  } catch(e){
    status.textContent = 'Erro ao carregar: ' + e.message;
  }
}

async function exportMultiDay(){
  await ensureXLSX();                 // SheetJS sob demanda
  const dates = Object.keys(_mdrData).sort();
  if(!dates.length){ showToast('Carregue os dados primeiro', true); return; }

  const wb = XLSX.utils.book_new();

  // Uma aba por dia
  dates.forEach(date => {
    const snap = _mdrData[date];
    const rows = Object.values(snap.rows || {});
    if(!rows.length) return;

    const [y,m,d] = date.split('-');
    const dateLabel = `${d}/${m}/${y}`;

    const aoa = [
      [`RELATÓRIO — ${dateLabel} — salvo em ${new Date(snap.savedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`],
      [],
      ['Torneio','Hora','Tipo','Garantido','Buy-in','Premiação','Overlay','Perf%','Field','ID','Fixado por','Fixado em','Status'],
    ];

    const DAY_START = 5*60;
    const sorted = [...rows].sort((a,b) => {
      const ma = timeToMinutes(a.hora)??9999, mb = timeToMinutes(b.hora)??9999;
      return (ma>=DAY_START?ma:ma+1440) - (mb>=DAY_START?mb:mb+1440);
    });

    sorted.forEach(r => aoa.push([
      r.nome||'', r.hora||'', r.tipo||'',
      r.garantido??'', r.buyin??'',
      r.premiacao??'', r.overlay??'',
      r.perf != null ? r.perf/100 : '',  // formato percentual no Excel
      r.field??'', r.id||'',
      r.fixadoPor||'', r.fixadoEm||'',
      r.status||'',
    ]));

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [28,8,12,12,10,12,12,8,8,10,16,14,10].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, dateLabel.replace(/\//g,'-'));
  });

  // Aba de sumário geral
  const sumAoa = [['SUMÁRIO DO PERÍODO'],[]
    ,['Data','Torneios','Fechados','GTD Total','Premiação Total','Overlay','Perf%']];
  dates.forEach(date => {
    const rows = Object.values(_mdrData[date].rows||{});
    const closed = rows.filter(r=>r.premiacao!=null);
    const gtd = rows.reduce((s,r)=>s+(r.garantido||0),0);
    const prem = closed.reduce((s,r)=>s+(r.premiacao||0),0);
    const ov = closed.reduce((s,r)=>s+(r.overlay||0),0);
    const [y,m,d] = date.split('-');
    sumAoa.push([`${d}/${m}/${y}`, rows.length, closed.length, gtd, prem||'', ov||'',
      gtd>0&&prem>0 ? (prem-gtd)/gtd : '']);
  });
  const sumWs = XLSX.utils.aoa_to_sheet(sumAoa);
  XLSX.utils.book_append_sheet(wb, sumWs, 'Sumário');

  const from = dates[0].slice(5).replace('-','-');
  const to   = dates[dates.length-1].slice(5).replace('-','-');
  XLSX.writeFile(wb, `Relatorio_${from}_a_${to}.xlsx`);
  showToast(`✓ ${dates.length} dia(s) exportado(s)`);
}

/* =========================================================================
   CALCULADORA DE OVERLAY — INTEGRADA COM A AGENDA
   O select de torneio lista todos os torneios carregados (RAW_ROWS).
   Ao selecionar um, preenche o garantido automaticamente.
   Valida se o garantido informado bate com o card da agenda.
   Se não houver planilha carregada, mostra aviso específico.
========================================================================= */
/* ── Calculadora de Overlay — seletor de torneio ── */
function ovcPopulateTournamentSelect(){
  const sel = document.getElementById('ovcTorneioSelect');
  if(!sel) return;

  // guarda seleção atual para tentar restaurar depois
  const prev = sel.value;

  sel.innerHTML = '<option value="">— Selecione um torneio do dia —</option>';

  if(!RAW_ROWS.length) return;

  // ordena cronologicamente (05:00 → 04:59 do dia seguinte)
  const DAY_START = 5 * 60;
  const rows = RAW_ROWS
    .filter(r => r.nome && r.garantido > 0)
    .slice()
    .sort((a, b) => {
      const ma = timeToMinutes(a.hora) || 0;
      const mb = timeToMinutes(b.hora) || 0;
      return (ma >= DAY_START ? ma : ma + 1440) - (mb >= DAY_START ? mb : mb + 1440);
    });

  rows.forEach(r => {
    const cat = classify(r);
    const opt = document.createElement('option');
    opt.value = r._key;
    const horaStr = r.hora ? ` ${r.hora}` : '';
    const catLabel = { main: '♠', side: '♣', sat: '♦' }[cat] || '';
    opt.textContent = `${catLabel} ${horaStr}  ${r.nome}  —  R$ ${fmtBRL(r.garantido, 0)}`;
    sel.appendChild(opt);
  });

  // restaura seleção anterior se ainda existe
  if(prev) sel.value = prev;
}

function ovcOnSelectChange(){
  const sel = document.getElementById('ovcTorneioSelect');
  const matchEl  = document.getElementById('ovcTourMatch');
  const notFoundEl = document.getElementById('ovcTourNotFound');
  const matchText = document.getElementById('ovcTourMatchText');
  const aiEl = document.getElementById('ovcAutoInfo');

  // esconde banners e info
  matchEl.classList.remove('show');
  notFoundEl.classList.remove('show');
  if(aiEl){ aiEl.innerHTML = ''; aiEl.hidden = true; }

  if(!sel.value) return;

  const row = rowByKey(sel.value);
  if(!row){ notFoundEl.classList.add('show'); return; }

  // ── Categoria ──
  const autoCat = classify(row);
  const catSelect = document.getElementById('ovcCategoria');
  if(catSelect) catSelect.value = autoCat;

  // ── Garantido ──
  document.getElementById('ovcGarantido').value = row.garantido;
  matchText.textContent = `Garantido R$ ${fmtBRL(row.garantido, 0)} preenchido — ${CAT_LABEL[autoCat]}${row.hora ? ' · ' + row.hora : ''}`;
  matchEl.classList.add('show');

  // ── Card de info premium ──
  if(aiEl){
    aiEl.innerHTML = `
      <div class="ovc-tic-cat" style="background:var(--${autoCat})"></div>
      <div class="ovc-tic-body">
        <div class="ovc-tic-name">${escHtml(row.nome)}</div>
        <div class="ovc-tic-meta">
          ${row.hora ? `<span>${row.hora}</span>` : ''}
          <span class="ovc-tic-garantido">R$ ${fmtBRL(row.garantido, 0)}</span>
          <span class="ovc-tic-cat-pill" style="background:var(--${autoCat}-soft);color:var(--${autoCat})">${CAT_LABEL[autoCat]}</span>
        </div>
      </div>
      <button class="ovc-tic-copy" onclick="ovcCopyTourneyField('${row._key}','nome')">Nome</button>
      <button class="ovc-tic-copy" onclick="ovcCopyTourneyField('${row._key}','garantido')">Garantido</button>`;
    aiEl.hidden = false;
  }

  ovcCalculate();
}

/* copia nome/garantido do torneio selecionado na calculadora — busca pelo _key em vez de
   embutir o texto direto no onclick, que quebrava o HTML quando o nome tinha aspas */
function ovcCopyTourneyField(key, field){
  const r = rowByKey(key);
  if(!r) return;
  const text = field === 'garantido' ? `R$ ${fmtBRL(r.garantido, 0)}` : (r.nome || '');
  navigator.clipboard.writeText(text).then(() => showToast(field === 'garantido' ? 'Copiado.' : 'Nome copiado.'));
}

// Repopula o select sempre que a planilha for carregada/atualizada
const _origRenderUpcoming = renderUpcoming;
window.renderUpcoming = function(){
  _origRenderUpcoming();
  ovcPopulateTournamentSelect();
};

// Popula já na abertura se tiver dados
ovcPopulateTournamentSelect();

// exibe a data do dia no cabeçalho da calculadora
(function initOvcDate(){
  const el = document.getElementById('ovcDateDisplay');
  if(el) el.textContent = dataPorExtensoSP();
})();

// limpa o select ao limpar a calculadora
// ovcClear já limpa tudo inclusive select e banners — wrapper mantido por compatibilidade
const _origOvcClear = typeof ovcClear === 'function' ? ovcClear : null;

/* =========================================================================
   MURAL — CHAT ESTILO WHATSAPP
   Firebase paths:
     'avisos/{id}' — mensagens de texto e links (persiste para sempre)
     'avisos_storage/{id}' — metadados de imagens (URL do Firebase Storage)
   Quem pode enviar: apenas o administrador (PIN verificado via hash)
   Quem pode ver: todos os operadores
   Imagens: enviadas pro Firebase Storage, URL salva no Firebase DB
========================================================================= */

/* =========================================================================
   PROJEÇÃO DE OVERLAY — ferramenta ao vivo
   Fluxo: informa as pré-inscritas de um Main Event e vai atualizando as
   entradas de 30 em 30 min. O painel projeta o campo final, calcula o
   ponto de equilíbrio (entradas pra zerar o garantido) e sinaliza overlay.

   Modelo de premiação (alinhado ao card de overlay existente):
     pool por entrada = buyin × fator de premiação
       Main:                 × 0,88
       Satélite:             × 0,95
       Side COM campanha:    × 0,88
       Side SEM campanha:    × 0,90
   ponto de equilíbrio = teto(garantido ÷ pool por entrada)

   Persiste em localStorage por dia (reseta sozinho no dia seguinte, no fuso SP).
========================================================================= */
(function(){
  const LS_KEY = 'index_overlay_proj_v1';
  const DAY_START = 5 * 60; // grade do dia começa 05:00 (igual ao resto do painel)

  let OPJ = { date: '', events: [] };

  // ── helpers de tempo (sempre no fuso de Brasília) ──
  function opjTodayKey(){ const n = nowInSP(); return `${n.year}-${String(n.month).padStart(2,'0')}-${String(n.day).padStart(2,'0')}`; }
  function opjNowMin(){ const n = nowInSP(); return n.hour * 60 + n.minute; }
  function opjNowClock(){ const n = nowInSP(); return `${String(n.hour).padStart(2,'0')}:${String(n.minute).padStart(2,'0')}`; }
  // minutos decorridos desde o início do torneio, tolerando a virada de meia-noite
  function opjElapsed(startTime){
    const s = timeToMinutes(startTime); if(s == null) return null;
    let d = opjNowMin() - s;
    if(d < -720) d += 1440;   // já passou da meia-noite
    if(d >  720) d -= 1440;
    return d;
  }

  // ── fator de premiação por categoria (espelha renderCardOverlayPreview) ──
  function opjPoolFactor(ev){
    if(ev.poolOverride != null && ev.poolOverride > 0) return ev.poolOverride;
    if(ev.cat === 'main') return 0.88;
    if(ev.cat === 'sat')  return 0.95;
    return ev.campanha ? 0.88 : 0.90; // side
  }

  // ── núcleo do cálculo/projeção de um evento ──
  function opjCompute(ev){
    const buyin = parseFloat(ev.buyin) || 0;
    const gtd   = parseFloat(ev.gtd)   || 0;
    const preReg = Math.max(0, parseInt(ev.preReg, 10) || 0);
    const lateReg = Math.max(0, parseInt(ev.lateRegMin, 10) || 0);
    const slowdown = (ev.slowdown != null ? ev.slowdown : 0.62);
    const factor = opjPoolFactor(ev);
    const poolPer = buyin * factor;                       // R$ por entrada no pote
    const breakEven = poolPer > 0 ? Math.ceil(gtd / poolPer) : null;

    // pontos: t=0 (pré-inscritas) + snapshots (mins desde o início)
    const snaps = (ev.snapshots || []).slice().sort((a,b)=>a.mins-b.mins);
    const points = [{ mins:0, entries:preReg }].concat(snaps.map(s=>({mins:s.mins, entries:s.entries})));
    const last = points[points.length - 1];
    const current = last.entries;
    const elapsed = last.mins;
    const remaining = Math.max(0, lateReg - elapsed);
    const started = opjElapsed(ev.startTime) != null && opjElapsed(ev.startTime) >= 0;

    // ── estimativa de ritmo (entradas por minuto) ──
    let rate = null, rateSrc = null;
    if(points.length >= 2 && elapsed > 0){
      const prev = points[points.length - 2];
      const dt = last.mins - prev.mins;
      if(dt > 0){ rate = (last.entries - prev.entries) / dt; rateSrc = 'recente'; }
      if(rate == null || rate < 0){ rate = (current - preReg) / elapsed; rateSrc = 'média'; } // fallback geral
    }

    // ── projeção do campo final ──
    let projLikely, projOpt, projPess, projMode;
    if(rate != null){
      const base = current;
      projOpt    = Math.round(base + rate * remaining * 1.0);
      projLikely = Math.round(base + rate * remaining * slowdown);
      projPess   = Math.round(base + rate * remaining * slowdown * 0.6);
      projMode = 'ritmo';
    } else {
      // sem histórico de ritmo: usa multiplicador sobre as pré-inscritas
      const mult = ev.preRegMult || 2.4;
      projLikely = Math.round(preReg * mult);
      projOpt    = Math.round(preReg * mult * 1.25);
      projPess   = Math.round(preReg * mult * 0.75);
      projMode = 'estimativa';
    }
    projLikely = Math.max(projLikely, current);
    projOpt    = Math.max(projOpt, projLikely);
    projPess   = Math.max(projPess, current);

    const poolNow    = current    * poolPer;
    const poolProj   = projLikely * poolPer;
    const overlayNow  = poolNow  - gtd;
    const overlayProj = poolProj - gtd;
    const missing = breakEven != null ? Math.max(0, breakEven - current) : null;

    // ETA até o ponto de equilíbrio no ritmo atual, comparado ao fechamento
    let etaMin = null, willMakeInTime = null;
    if(rate != null && rate > 0 && missing != null && missing > 0){
      etaMin = missing / rate;
      willMakeInTime = etaMin <= remaining;
    }

    // ── status ──
    let status;
    if(breakEven == null || (buyin <= 0 && gtd <= 0)){
      status = { key:'idle', label:'Preencha buy-in e garantido' };
    } else if(current >= breakEven){
      status = { key:'batido', label:'Garantido batido' };
    } else if(projLikely >= breakEven && (willMakeInTime !== false)){
      status = { key:'ok', label:'No caminho' };
    } else if(projOpt >= breakEven){
      status = { key:'risco', label:'Limítrofe — risco de overlay' };
    } else {
      status = { key:'overlay', label:'Overlay provável' };
    }

    return { buyin, gtd, preReg, lateReg, factor, poolPer, breakEven, points, current, elapsed,
      remaining, started, rate, rateSrc, projLikely, projOpt, projPess, projMode,
      poolNow, poolProj, overlayNow, overlayProj, missing, etaMin, willMakeInTime, status };
  }

  // ── mini-gráfico SVG (entradas × tempo, com meta e projeção) ──
  function opjChart(c){
    const W = 520, H = 172, padL = 34, padR = 46, padT = 12, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const xMaxMin = Math.max(c.lateReg, c.elapsed, 30);
    const yMax = Math.max(c.breakEven || 0, c.projOpt || 0, c.current || 0, 10) * 1.12;
    const X = m => padL + (Math.min(m, xMaxMin) / xMaxMin) * plotW;
    const Y = e => padT + plotH - (Math.min(e, yMax) / yMax) * plotH;

    // linha real
    const pts = c.points.map(p => [X(p.mins), Y(p.entries)]);
    const linePath = pts.map((p,i)=> (i?'L':'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    // comprimento aproximado pra animar o traçado
    let len = 0; for(let i=1;i<pts.length;i++){ len += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); }
    len = Math.max(len, 1);

    // projeção: do ponto atual até (lateReg, projLikely)
    const cur = pts[pts.length - 1];
    const projX = X(xMaxMin), projLY = Y(c.projLikely), projOY = Y(c.projOpt), projPY = Y(c.projPess);
    const projLine = `M ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} L ${projX.toFixed(1)} ${projLY.toFixed(1)}`;
    const band = `M ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} L ${projX.toFixed(1)} ${projOY.toFixed(1)} L ${projX.toFixed(1)} ${projPY.toFixed(1)} Z`;

    // meta (break-even)
    const metaY = c.breakEven != null ? Y(c.breakEven) : null;
    const metaLine = metaY != null ? `<line class="opj-meta-line" x1="${padL}" y1="${metaY.toFixed(1)}" x2="${(W-padR).toFixed(1)}" y2="${metaY.toFixed(1)}"/>
        <text class="opj-chart-lbl" fill="var(--gold)" x="${(W-padR+3).toFixed(1)}" y="${(metaY+3).toFixed(1)}">meta ${fmtBRL(c.breakEven,0)}</text>` : '';

    const dots = pts.map((p,i)=> `<circle class="opj-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" style="animation-delay:${(0.35+i*0.08).toFixed(2)}s;transform-origin:${p[0].toFixed(1)}px ${p[1].toFixed(1)}px"/>`).join('');

    // eixos guia
    const closeX = X(c.lateReg);
    const axisX = `<line x1="${padL}" y1="${(padT+plotH).toFixed(1)}" x2="${(W-padR).toFixed(1)}" y2="${(padT+plotH).toFixed(1)}" stroke="var(--hairline-strong)" stroke-width="1"/>`;
    const closeMark = `<line x1="${closeX.toFixed(1)}" y1="${padT}" x2="${closeX.toFixed(1)}" y2="${(padT+plotH).toFixed(1)}" stroke="var(--hairline-strong)" stroke-width="1" stroke-dasharray="2 3"/>
        <text class="opj-chart-axis" text-anchor="middle" x="${closeX.toFixed(1)}" y="${(H-6)}">fecha reg.</text>`;
    const originLbl = `<text class="opj-chart-axis" text-anchor="start" x="${padL}" y="${(H-6)}">início</text>`;
    const yTop = `<text class="opj-chart-axis" text-anchor="end" x="${(padL-4)}" y="${(padT+8)}">${fmtBRL(Math.round(yMax),0)}</text>`;

    return `<svg class="opj-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico de entradas ao longo do tempo">
      ${axisX}${closeMark}${originLbl}${yTop}${metaLine}
      <path class="opj-band" d="${band}"/>
      <path class="opj-proj-line" d="${projLine}"/>
      <circle class="opj-proj-dot" cx="${projX.toFixed(1)}" cy="${projLY.toFixed(1)}" r="3.2"/>
      <path class="opj-actual-line" d="${linePath}" style="--len:${len.toFixed(0)}"/>
      ${dots}
    </svg>`;
  }

  // ── render de um card ──
  function opjRenderCard(ev){
    const c = opjCompute(ev);
    const catLabel = { main:'Main Event', side:'Side Event', sat:'Satélite' }[ev.cat] || 'Evento';
    const catSym = { main:'♠', side:'♣', sat:'♦' }[ev.cat] || '';
    const sub = `${catSym} ${ev.startTime || '--:--'} · buy-in R$ ${fmtBRL(c.buyin,0)} · GTD R$ ${fmtBRL(c.gtd,0)}`;

    const ovProjCls = c.overlayProj >= 0 ? 'pos' : 'neg';
    const ovProjTxt = (c.overlayProj >= 0 ? '+R$ ' : '−R$ ') + fmtBRL(Math.abs(Math.round(c.overlayProj)),0);
    const statusVal = c.status.key === 'overlay'
        ? '−R$ ' + fmtBRL(Math.abs(Math.round(c.overlayProj)),0)
      : c.status.key === 'batido'
        ? '+R$ ' + fmtBRL(Math.abs(Math.round(c.overlayNow)),0)
        : '';

    // texto de ritmo/eta
    let paceNote = '';
    if(c.rate != null){
      const per30 = Math.round(c.rate * 30);
      paceNote = `Ritmo ${c.rateSrc}: <b>${per30}</b> entradas/30min · projeção por <b>${c.projMode}</b> (fecha em ${Math.max(0,Math.round(c.remaining))} min).`;
      if(c.missing > 0 && c.etaMin != null){
        paceNote += c.willMakeInTime
          ? ` No ritmo atual bate a meta em ~${Math.round(c.etaMin)} min.`
          : ` No ritmo atual <b>não</b> bate a meta antes de fechar.`;
      }
    } else if(!c.started){
      paceNote = `Antes do início — projeção por estimativa sobre as pré-inscritas. Atualize as entradas quando a late reg abrir.`;
    } else {
      paceNote = `Registre a 1ª atualização de entradas pra calcular o ritmo.`;
    }

    // timeline
    let tl = '';
    const snaps = (ev.snapshots||[]).slice().sort((a,b)=>a.mins-b.mins);
    if(!snaps.length){
      tl = `<div class="opj-tl-empty">Sem atualizações ainda. Registre as entradas atuais acima.</div>`;
    } else {
      let prevE = c.preReg;
      tl = snaps.map(s => {
        const d = s.entries - prevE; prevE = s.entries;
        const pool = s.entries * c.poolPer; const ov = pool - c.gtd;
        const ovCls = ov >= 0 ? 'pos' : 'neg';
        const ovTxt = (ov >= 0 ? '+' : '−') + fmtBRL(Math.abs(Math.round(ov)),0);
        const deltaTxt = d === 0 ? '±0' : (d > 0 ? '+'+d : String(d));
        return `<div class="opj-tl-row">
          <span class="opj-tl-clock">${s.clock || ''}</span>
          <span class="opj-tl-entries">${fmtBRL(s.entries,0)} <span style="font-weight:400;color:var(--ink-soft);font-size:10px">entradas</span></span>
          <span class="opj-tl-delta ${d===0?'zero':''}">${deltaTxt}</span>
          <span class="opj-tl-ov ${ovCls}">R$ ${ovTxt}</span>
        </div>`;
      }).join('');
    }

    const chart = (c.buyin > 0 && c.gtd > 0)
      ? `<div class="opj-chart-wrap">${opjChart(c)}</div>`
      : '';

    return `<div class="opj-card" data-id="${escHtml(ev.id)}">
      <div class="opj-card-head">
        <svg class="opj-card-crown" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.5 1.5 7l5.4 4L12 4l5.1 7 5.4-4-1.5 10.5a1 1 0 0 1-1 .85H4a1 1 0 0 1-1-.85Z"/><rect x="3.3" y="19" width="17.4" height="2.2" rx="1"/></svg>
        <div class="opj-card-titles">
          <div class="opj-card-name" title="${escHtml(ev.nome)}">${escHtml(ev.nome || 'Sem nome')}</div>
          <div class="opj-card-sub">${escHtml(sub)}</div>
        </div>
        <button class="opj-card-x" type="button" data-act="remove" title="Remover">✕</button>
      </div>

      <div class="opj-status opj-s-${c.status.key}">
        <span class="opj-status-dot"></span>
        <span class="opj-status-txt">${c.status.label}</span>
        ${statusVal ? `<span class="opj-status-val">${statusVal}</span>` : ''}
      </div>

      <div class="opj-metrics">
        <div class="opj-metric">
          <div class="opj-metric-label">Ponto equil.</div>
          <div class="opj-metric-val gold">${c.breakEven != null ? fmtBRL(c.breakEven,0) : '—'}</div>
          <div class="opj-metric-sub">entradas p/ zerar</div>
        </div>
        <div class="opj-metric">
          <div class="opj-metric-label">Entradas</div>
          <div class="opj-metric-val">${fmtBRL(c.current,0)}</div>
          <div class="opj-metric-sub">${c.missing != null && c.missing > 0 ? 'faltam '+fmtBRL(c.missing,0) : (c.breakEven!=null?'meta batida':'—')}</div>
        </div>
        <div class="opj-metric">
          <div class="opj-metric-label">Projeção</div>
          <div class="opj-metric-val">${fmtBRL(c.projLikely,0)}</div>
          <div class="opj-metric-sub">${fmtBRL(c.projPess,0)}–${fmtBRL(c.projOpt,0)}</div>
        </div>
        <div class="opj-metric">
          <div class="opj-metric-label">Overlay proj.</div>
          <div class="opj-metric-val ${ovProjCls}">${ovProjTxt}</div>
          <div class="opj-metric-sub">${c.overlayProj >= 0 ? 'excedente' : 'a cobrir'}</div>
        </div>
      </div>

      ${chart}

      <div class="opj-log-input">
        <input type="number" inputmode="numeric" min="0" step="1" placeholder="entradas agora" data-inp="entries" aria-label="Entradas atuais">
        <button class="opj-btn opj-btn-primary" type="button" data-act="log">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Registrar
        </button>
      </div>
      <div class="opj-note">${paceNote}</div>

      <div class="opj-timeline">
        <div class="opj-tl-title"><span>Linha do tempo</span>${snaps.length?`<button class="opj-tl-clear" type="button" data-act="clearlog">limpar</button>`:''}</div>
        ${tl}
      </div>

      <details class="opj-settings">
        <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>Ajustes do torneio</summary>
        <div class="opj-set-grid">
          <label class="opj-set-field full"><span>Nome</span><input type="text" data-set="nome" value="${escHtml(ev.nome||'')}"></label>
          <label class="opj-set-field"><span>Buy-in (R$)</span><input type="number" step="0.01" data-set="buyin" value="${ev.buyin ?? ''}"></label>
          <label class="opj-set-field"><span>Garantido (R$)</span><input type="number" step="0.01" data-set="gtd" value="${ev.gtd ?? ''}"></label>
          <label class="opj-set-field"><span>Categoria</span>
            <select data-set="cat">
              <option value="main" ${ev.cat==='main'?'selected':''}>♠ Main Event</option>
              <option value="side" ${ev.cat==='side'?'selected':''}>♣ Side Event</option>
              <option value="sat"  ${ev.cat==='sat'?'selected':''}>♦ Satélite</option>
            </select>
          </label>
          <label class="opj-set-field"><span>Início (HH:MM)</span><input type="text" placeholder="20:00" data-set="startTime" value="${escHtml(ev.startTime||'')}"></label>
          <label class="opj-set-field"><span>Pré-inscritas</span><input type="number" step="1" min="0" data-set="preReg" value="${ev.preReg ?? ''}"></label>
          <label class="opj-set-field"><span>Late reg (min)</span><input type="number" step="5" min="0" data-set="lateRegMin" value="${ev.lateRegMin ?? ''}"></label>
          <label class="opj-set-check"><input type="checkbox" data-set="campanha" ${ev.campanha?'checked':''}> Campanha (#AS / +SPS / +SPT)</label>
          <label class="opj-set-field full"><span>Desaceleração da projeção — <span class="opj-slow-val">${Math.round((ev.slowdown!=null?ev.slowdown:0.62)*100)}%</span> do ritmo atual até o fim</span>
            <input type="range" min="30" max="100" step="5" data-set="slowdown" value="${Math.round((ev.slowdown!=null?ev.slowdown:0.62)*100)}">
          </label>
          <label class="opj-set-field full"><span>Fator de premiação (opcional — sobrepõe o padrão da categoria)</span>
            <input type="number" step="0.01" min="0" max="1" placeholder="auto (${opjPoolFactor(ev).toFixed(2)})" data-set="poolOverride" value="${ev.poolOverride ?? ''}"></label>
        </div>
      </details>
    </div>`;
  }

  function opjRender(){
    const list = document.getElementById('opjList');
    if(!list) return;
    if(!OPJ.events.length){
      list.innerHTML = `<div class="opj-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 3.5-3.5 3 3L21 7"/></svg>
        <p>Nenhum Main Event em acompanhamento.<br>Puxe um da planilha ou crie um manual pra começar.</p>
      </div>`;
      return;
    }
    list.innerHTML = OPJ.events.map(opjRenderCard).join('');
  }

  // ── persistência (reseta por dia, fuso SP) ──
  function opjSave(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(OPJ)); }catch(e){} }
  function opjLoad(){
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }catch(e){}
    const today = opjTodayKey();
    if(saved && saved.date === today && Array.isArray(saved.events)){
      OPJ = saved;
    } else {
      OPJ = { date: today, events: [] };
      opjSave();
    }
  }

  function opjFindEv(id){ return OPJ.events.find(e => e.id === id); }

  // ── ações ──
  function opjAddManual(seed){
    const ev = Object.assign({
      id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      nome: 'Novo Main Event', buyin: null, gtd: null, cat: 'main', campanha: false,
      startTime: '', lateRegMin: 120, preReg: 0, slowdown: 0.62, poolOverride: null,
      snapshots: []
    }, seed || {});
    OPJ.events.unshift(ev);
    opjSave(); opjRender();
  }

  function opjLogEntries(id, val){
    const ev = opjFindEv(id); if(!ev) return;
    const n = parseInt(val, 10);
    if(isNaN(n) || n < 0){ showToast('Informe um número de entradas válido.', true); return; }
    const elapsed = opjElapsed(ev.startTime);
    // antes do início (ou sem horário) → atualiza as pré-inscritas
    if(elapsed == null || elapsed < 0){
      ev.preReg = n;
      opjSave(); opjRender();
      showToast(elapsed == null ? 'Pré-inscritas atualizadas (defina o horário de início).' : 'Antes do início — pré-inscritas atualizadas.');
      return;
    }
    const mins = Math.max(0, Math.round(elapsed));
    const clock = opjNowClock();
    ev.snapshots = ev.snapshots || [];
    // se já houver snapshot nos últimos 5 min, substitui em vez de duplicar
    const near = ev.snapshots.find(s => Math.abs(s.mins - mins) <= 5);
    if(near){ near.entries = n; near.mins = mins; near.clock = clock; }
    else ev.snapshots.push({ mins, entries: n, clock });
    opjSave(); opjRender();
    showToast('Entradas registradas às ' + clock + '.');
  }

  function opjSetField(id, field, value){
    const ev = opjFindEv(id); if(!ev) return;
    if(field === 'campanha'){ ev.campanha = !!value; }
    else if(field === 'cat'){ ev.cat = value; }
    else if(field === 'nome' || field === 'startTime'){ ev[field] = value; }
    else if(field === 'slowdown'){ ev.slowdown = Math.max(0.3, Math.min(1, (parseInt(value,10)||62)/100)); }
    else if(field === 'poolOverride'){ ev.poolOverride = value === '' ? null : parseFloat(value); }
    else { ev[field] = value === '' ? (field==='preReg'||field==='lateRegMin'?0:null) : parseFloat(value); }
    opjSave();
  }

  // ── select de Main Events da planilha ──
  function opjPopulatePick(){
    const sel = document.getElementById('opjPickSelect');
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Puxar Main Event da planilha —</option>';
    if(typeof RAW_ROWS === 'undefined' || !RAW_ROWS.length) return;
    const rows = RAW_ROWS
      .filter(r => r.nome && r.garantido > 0 && classify(r) === 'main')
      .slice()
      .sort((a,b)=>{
        const ma = timeToMinutes(a.hora) || 0, mb = timeToMinutes(b.hora) || 0;
        return (ma>=DAY_START?ma:ma+1440) - (mb>=DAY_START?mb:mb+1440);
      });
    if(!rows.length){
      const o = document.createElement('option'); o.value=''; o.disabled=true;
      o.textContent = 'Nenhum Main Event na planilha carregada'; sel.appendChild(o);
      return;
    }
    rows.forEach(r => {
      const o = document.createElement('option');
      o.value = r._key;
      o.textContent = `♠ ${r.hora||'--:--'}  ${r.nome}  —  R$ ${fmtBRL(r.garantido,0)}`;
      sel.appendChild(o);
    });
    if(prev) sel.value = prev;
  }

  function opjAddFromPick(){
    const sel = document.getElementById('opjPickSelect');
    const key = sel && sel.value;
    if(!key){ showToast('Selecione um Main Event da planilha.', true); return; }
    if(OPJ.events.some(e => e.srcKey === key)){ showToast('Esse torneio já está em acompanhamento.', true); return; }
    const row = rowByKey(key);
    if(!row){ showToast('Torneio não encontrado.', true); return; }
    opjAddManual({
      nome: row.nome, buyin: row.buyin ?? null, gtd: row.garantido ?? null,
      cat: classify(row), campanha: hasCampanha(row), startTime: row.hora || '',
      srcKey: key
    });
    sel.value = '';
  }

  // ── delegação de eventos no container ──
  function opjBindList(){
    const list = document.getElementById('opjList');
    if(!list) return;

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if(!btn) return;
      const card = e.target.closest('.opj-card'); if(!card) return;
      const id = card.dataset.id;
      const act = btn.dataset.act;
      if(act === 'remove'){
        const ev = opjFindEv(id);
        OPJ.events = OPJ.events.filter(x => x.id !== id);
        opjSave(); opjRender();
        showToast('Torneio removido.');
      } else if(act === 'log'){
        const inp = card.querySelector('[data-inp="entries"]');
        opjLogEntries(id, inp && inp.value);
      } else if(act === 'clearlog'){
        const ev = opjFindEv(id); if(ev){ ev.snapshots = []; opjSave(); opjRender(); }
      }
    });

    // Enter no campo de entradas registra
    list.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && e.target.matches('[data-inp="entries"]')){
        const card = e.target.closest('.opj-card');
        if(card) opjLogEntries(card.dataset.id, e.target.value);
      }
    });

    // ajustes (change ao sair do campo) — re-render só quando afeta o cálculo
    list.addEventListener('change', (e) => {
      const el = e.target.closest('[data-set]'); if(!el) return;
      const card = e.target.closest('.opj-card'); if(!card) return;
      const field = el.dataset.set;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      opjSetField(card.dataset.id, field, val);
      opjRender();
    });

    // feedback ao vivo no slider de desaceleração (sem re-render pesado)
    list.addEventListener('input', (e) => {
      const el = e.target.closest('[data-set="slowdown"]'); if(!el) return;
      const lbl = el.closest('.opj-set-field').querySelector('.opj-slow-val');
      if(lbl) lbl.textContent = el.value + '%';
    });
  }

  // ── wiring de abertura/fechamento ──
  function opjInit(){
    opjLoad();
    opjBindList();
    opjRender();

    const dateEl = document.getElementById('opjDateDisplay');
    if(dateEl && typeof dataPorExtensoSP === 'function') dateEl.textContent = dataPorExtensoSP();

    const toggle = document.getElementById('overlayProjToggle');
    if(toggle) toggle.addEventListener('click', () => {
      // vira o dia? recarrega/limpa
      if(OPJ.date !== opjTodayKey()) opjLoad();
      opjPopulatePick();
      opjRender();
      openDrawer('overlayProjDrawerOverlay');
    });
    document.getElementById('overlayProjDrawerClose')?.addEventListener('click', () => closeDrawer('overlayProjDrawerOverlay'));
    document.getElementById('overlayProjDrawerOverlay')?.addEventListener('click', (e) => {
      if(e.target.id === 'overlayProjDrawerOverlay') closeDrawer('overlayProjDrawerOverlay');
    });
    document.getElementById('opjAddPickBtn')?.addEventListener('click', opjAddFromPick);
    document.getElementById('opjAddManualBtn')?.addEventListener('click', () => opjAddManual());

    // repopula o select sempre que a planilha for (re)carregada
    if(typeof window.renderUpcoming === 'function'){
      const _prev = window.renderUpcoming;
      window.renderUpcoming = function(){ _prev.apply(this, arguments); opjPopulatePick(); };
    }
    opjPopulatePick();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', opjInit);
  else opjInit();
})();

/* ── ⌘K Command Palette: busca de torneios de hoje ────────────────────────────
   O painel pluga sua busca no buscador global do OS (suprema-palette.js). Lê a
   grade viva (UPCOMING) na hora da busca; "abrir" leva ao card e pisca, reusando
   o mesmo diagIrParaCard() do diagnóstico. Navegação e tema já vêm de fábrica. */
document.addEventListener('DOMContentLoaded', () => {
  if (!window.SupremaPalette) return;
  const pnorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const catNome = { main:'Main Event', side:'Side Event', sat:'Satélite' };
  SupremaPalette.register({
    id: 'torneios', group: 'Torneios de hoje',
    search(q){
      const nq = pnorm(q);
      if (!nq || !Array.isArray(UPCOMING)) return [];   // vazio: deixa a palette limpa (nav+ações)
      return UPCOMING
        .filter(t => pnorm(`${t.nome || ''} ${t.hora || ''}`).includes(nq))
        .slice(0, 8)
        .map(t => {
          const cat = classify(t);
          return {
            title: t.nome || 'Torneio',
            sub: `${t.hora || '—'} · ${catNome[cat] || 'Side Event'}${t.garantido != null ? ' · R$ ' + fmtBRL(t.garantido) : ''}`,
            icon: CAT_SUIT[cat] || '♠',
            hint: 'ver card',
            run: () => diagIrParaCard(t._key)
          };
        });
    }
  });
});

/* ── Copiloto de IA: snapshot do estado do Painel do Dia ─────────────────────
   Entrega ao Copiloto (suprema-copiloto.js) um retrato compacto do dia: totais
   do hero, grade viva (UPCOMING) e os achados do motor de diagnóstico. É o mesmo
   estado estruturado que o suprema-insights já produz — a IA só ganha a voz. */
document.addEventListener('DOMContentLoaded', () => {
  if (!window.SupremaCopiloto) return;
  SupremaCopiloto.setSnapshot(() => {
    const snap = { painel: 'Painel do Dia', data: (typeof BASE_DATE !== 'undefined' ? BASE_DATE : null) };
    // totais do hero
    try {
      snap.totais = {
        garantido: document.getElementById('statGarantido')?.textContent?.trim(),
        premiacao: document.getElementById('statPremiacao')?.textContent?.trim(),
        overlay:   document.getElementById('statOverlay')?.textContent?.trim(),
        naoFixados:document.getElementById('statUnfixed')?.textContent?.trim()
      };
    } catch (e) {}
    // grade viva (limita p/ caber no prompt): nome, hora, categoria, garantido, premiação, field
    try {
      if (Array.isArray(UPCOMING)) {
        snap.torneios = UPCOMING.slice(0, 120).map(t => ({
          nome: t.nome, hora: t.hora, categoria: classify(t),
          garantido: t.garantido, premiacao: t.premiacao,
          field: (typeof getField === 'function' ? getField(t._key) : undefined) || t.field,
          fixado: (typeof isFixed === 'function' ? isFixed(t._key) : undefined)
        }));
      }
    } catch (e) {}
    // diagnóstico (o motor puro já achou os problemas)
    try {
      if (window.SupremaInsights && typeof buildInsightsInput === 'function') {
        const found = SupremaInsights.analyze(buildInsightsInput());
        if (Array.isArray(found)) snap.diagnostico = found.slice(0, 20).map(f => ({ titulo: f.titulo || f.title, acao: f.acao || f.action }));
      }
    } catch (e) {}
    return snap;
  });
});

/* =========================================================================
   RADAR DE EVENTOS — a vitrine da grade pro Marketing e pro Atendimento.

   MODELO MENTAL: escolha o DIA → a AGENDA do dia em linhas (hora | evento |
   números | status, com o divisor "AGORA") → as ROTAS DE TICKET (satélite →
   🎟 → torneio-alvo) → os EVENTOS FUTUROS (a seção P&D depois de domingo).

   O MOTOR (parser semanal, vínculos em 3 degraus, status, formatação) mora
   em radar-core.js — compartilhado com a Suprema TV (tv.html). Este arquivo
   é só a UI do Radar: agenda, rotas, filtros, copiar-pro-chat, card de
   divulgação, correção manual (admin) e estado na URL.

   DADOS: painel/globalMtt (a Global que a operação sobe no Painel do Dia) +
   eventos/linksOverride (correções manuais). Fallback local sem publicar.

   Depende de: gu-parser.js, radar-core.js, suprema-db.js, suprema-auth.js,
   suprema-motion.js, ensureXLSX (suprema-xlsx.js).
========================================================================= */
'use strict';

/* carimbo de versão: primeiro a rodar — se este log não aparecer no console,
   o navegador está servindo um eventos.js antigo (cache/upload pendente) */
console.info('[Radar] eventos.js v3.0 — motor extraído pro radar-core; TV unificada em tv.html');

/* modo TV unificado: a Suprema TV é um painel próprio agora — quem chegar
   pelo antigo ?tv=1 é levado pra lá */
if (new URLSearchParams(location.search).get('tv') === '1') location.replace('tv.html');

/* ═══════════════════ estado + URL ═══════════════════ */

let MODEL = null;                                    // {events, futures, dates, byId}
let META = null;                                     // {filename, at, by}
let LAST_PARSED = null;                              // pra reconstruir quando um override chega
let OVERRIDES = {};
const state = { camp:'all', cat:'all', q:'', day:null, open:null };

const IS_ADMIN = (() => { try { return !!SupremaAuth.recognize().isAdmin; } catch(e){ return false; } })();

/* ── AO VIVO: premiação/field do Painel do Dia nas linhas de HOJE ──
   O Radar era cego pro dia acontecendo: mostrava só o garantido estático da
   planilha, enquanto a TV já lia painel/<hoje>/premiacao|field. A vitrine que o
   Marketing olha agora mostra a premiação ATUAL (e acende quando bate o GTD).
   Mesma ponte da TV: painelRowKey casa a linha da Global com o nó do Painel. */
const LIVE = { prem:{}, field:{} };
let LIVE_DAY = null, _liveOffs = [];
function attachLiveDay(){
  if (!window.SupremaDB || !SupremaDB.ready()) return;
  const today = gradeTodayISO();
  if (today === LIVE_DAY) return;                    // já ancorado neste dia
  LIVE_DAY = today;
  _liveOffs.forEach(off => { try{ off(); }catch(e){} });
  _liveOffs = [
    SupremaDB.watch(`painel/${today}/premiacao`, s => { LIVE.prem  = s.val() || {}; updateLiveNums(); }),
    SupremaDB.watch(`painel/${today}/field`,     s => { LIVE.field = s.val() || {}; updateLiveNums(); }),
  ];
}
function liveOf(e){
  const rk = painelRowKey(e);
  return {
    prem:  LIVE.prem[rk]  ?? LIVE.prem[rk + '_px']  ?? null,
    field: LIVE.field[rk] ?? LIVE.field[rk + '_px'] ?? null,
  };
}
/* patch cirúrgico (não re-renderiza a agenda — rota aberta/foco sobrevivem) */
function updateLiveNums(){
  if (!MODEL || state.day !== todayWeekdayPT()) return;
  document.querySelectorAll('#agendaList .row[data-id]').forEach(row => {
    const e = MODEL.byId.get(row.dataset.id);
    const slot = row.querySelector('.r-livenums');
    if (!e || !slot) return;
    const lv = liveOf(e);
    if (lv.prem == null && lv.field == null){ slot.hidden = true; return; }
    const bateu = lv.prem != null && e.garantido != null && e.garantido > 0 && lv.prem >= e.garantido;
    const html = [
      lv.prem != null ? `<b>${fmtMoney(lv.prem)}</b>` : '',
      lv.field != null ? `${NF_INT.format(lv.field)} j.` : '',
    ].filter(Boolean).join(' · ') + (bateu ? ' ✦' : '');
    slot.hidden = false;
    slot.classList.toggle('bateu', bateu);
    slot.title = bateu ? 'Premiação atual — bateu o garantido' : 'Premiação/field ao vivo (Painel do Dia)';
    if (slot.innerHTML !== html) slot.innerHTML = html;
  });
}

/* estado ↔ URL (?dia=SEX&camp=AS&cat=sat&q=...): abrir um link filtrado já
   filtrado, e todo clique atualiza a URL (replaceState — não polui o histórico) */
const SHORT_BY_DAY = {'SEGUNDA-FEIRA':'SEG','TERÇA-FEIRA':'TER','QUARTA-FEIRA':'QUA','QUINTA-FEIRA':'QUI','SEXTA-FEIRA':'SEX','SÁBADO':'SAB','DOMINGO':'DOM'};
const DAY_BY_SHORT = Object.fromEntries(Object.entries(SHORT_BY_DAY).map(([d,s]) => [s, d]));
function readStateFromURL(){
  const q = new URLSearchParams(location.search);
  const dia = (q.get('dia') || '').toUpperCase().replace('Á','A');
  if (DAY_BY_SHORT[dia]) state.day = DAY_BY_SHORT[dia];
  const camp = (q.get('camp') || '').toUpperCase();
  if (['AS','SPS','SPT','NONE'].includes(camp)) state.camp = camp === 'NONE' ? 'none' : camp;
  const cat = (q.get('cat') || '').toLowerCase();
  if (['main','side','sat'].includes(cat)) state.cat = cat;
  if (q.get('q')) state.q = q.get('q');
  /* ?ev=<evKey>: link direto pra UM evento com a rota já aberta. A chave é a
     evKey (dia|hora|nome), a MESMA dos overrides — estável entre re-uploads da
     Global, ao contrário do id sequencial. Resolvido só depois do modelo pronto
     (openFromURL), porque agora não existe evento nenhum ainda. */
  if (q.get('ev')) state.linkEv = q.get('ev');
}
function writeStateToURL(){
  try{
    const q = new URLSearchParams();
    if (state.day && state.day !== todayWeekdayPT()) q.set('dia', SHORT_BY_DAY[state.day]);
    if (state.camp !== 'all') q.set('camp', state.camp === 'none' ? 'none' : state.camp);
    if (state.cat !== 'all') q.set('cat', state.cat);
    if (state.q) q.set('q', state.q);
    /* o evento aberto entra na URL: é o que faz o link ser COMPARTILHÁVEL — o
       Atendimento cola "olha esse aqui" no chat da equipe e o outro abre já na
       rota certa. Sem isto a URL só levava ao dia filtrado. */
    if (state.open){ const e = MODEL && MODEL.byId.get(state.open); if (e) q.set('ev', evKey(e)); }
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }catch(e){}
}

let _lastAt = null;
function initData(){
  if (!window.SupremaDB || !SupremaDB.init()){ setTimeout(initData, 300); return; }
  /* ESPERAR o Firebase Auth restaurar a sessão ANTES de anexar qualquer listener:
     listener anexado sem token leva permission_denied e o RTDB o CANCELA em
     silêncio — a página ficava presa no "Distribuindo as cartas…" pra sempre
     (mesma armadilha documentada no hub.js). requireUser também manda re-logar
     no hub (?reauth=1) se a sessão do Firebase não existir mais. */
  console.info('[Radar] aguardando o Firebase Auth restaurar a sessão…');
  SupremaDB.requireUser(() => {
    console.info('[Radar] auth ok — anexando listeners');
    SupremaDB.watch('painel/globalMtt/at', snap => {
      const at = snap.val();
      console.info('[Radar] painel/globalMtt/at =', at);
      if (!at){ showEmpty(); return; }         // nó vazio: ninguém subiu a Global ainda
      if (`${at}` === `${_lastAt}`) return;
      _lastAt = `${at}`;
      loadSharedGlobal();
    });
    /* correções manuais dos vínculos — chegam/mudam ao vivo pra todo mundo */
    SupremaDB.watch('eventos/linksOverride', snap => {
      OVERRIDES = snap.val() || {};
      if (LAST_PARSED){ MODEL = buildModel(LAST_PARSED, OVERRIDES); renderAll(); }
    });
    SupremaDB.onConnection(ok => setSync(ok));
    attachLiveDay();                                 // premiação/field de hoje, ao vivo
    /* rede lenta/regra negada: depois de 12s sem dado, troca o loading pelo
       estado vazio (que tem o fallback de ler o arquivo local) */
    setTimeout(() => { if (!MODEL) showEmpty(); }, 12000);
  });
  setSync(true);
}

async function loadSharedGlobal(){
  try{
    const v = await SupremaDB.getValue('painel/globalMtt');
    if (!v || !v.data){ showEmpty(); return; }
    META = { filename: v.filename || 'Global MTT.xlsx', at: v.at || 0, by: v.by || 'alguém' };
    /* parse no Worker: atob + XLSX.read numa Global grande travavam a aba
       (ver parseGlobalWeekAsync em radar-core.js) */
    applyParsed(await parseGlobalWeekAsync(v.data, 'MTTS BRAZIL'));
  }catch(err){
    console.error('[Radar] falha ao carregar a Global compartilhada', err);
    showEmpty();
  }
}

let _firstRender = true;
function applyParsed(parsed){
  if (!parsed){ showEmpty(); return; }
  LAST_PARSED = parsed;
  MODEL = buildModel(LAST_PARSED, OVERRIDES);
  console.info(`[Radar] Global aplicada — ${MODEL.events.length} eventos na semana, ${MODEL.futures.length} futuros`);
  if (!MODEL.events.length && !MODEL.futures.length){ showEmpty(); return; }
  /* ?ev= manda no dia: se o link aponta pra um evento da quinta, abre na quinta,
     não em "hoje". Resolvido aqui porque só agora existe modelo pra procurar. */
  const linkAlvo = state.linkEv ? MODEL.events.find(e => evKey(e) === state.linkEv) : null;
  if (linkAlvo) state.day = linkAlvo.weekday;
  if (!state.day) state.day = todayWeekdayPT();
  document.getElementById('loading').hidden = true;
  document.getElementById('emptyState').hidden = true;
  document.getElementById('content').hidden = false;
  maybeShowGlobalDiff();
  renderAll();
  if (_firstRender){
    _firstRender = false;
    if (linkAlvo){ openFromURL(linkAlvo); state.linkEv = null; }
    else scrollAgendaToNow();
  }
}

/* ── O QUE MUDOU NA GLOBAL ──
   Re-upload da Global era caixa-preta: evento sumiu? horário mudou? GTD subiu?
   Ninguém sabia sem re-conferir a semana inteira. O Radar agora guarda um
   resumo da Global anterior (localStorage) e, quando chega uma nova, mostra o
   diff — o Marketing confere SÓ o que mudou.
   Chave por dia+nome (não evKey, que embute a hora — mudança de horário viraria
   um falso "removido + adicionado"); nomes repetidos no dia ganham sufixo pela
   ordem de horário. */
const DIFF_KEY = 'radar_global_diff_v1';
const DIFF_SEEN_KEY = 'radar_global_diff_seen_v1';
function diffSnapshot(){
  const snap = {};
  const seen = {};
  [...MODEL.events].sort((a,b) => a.abs - b.abs).forEach(e => {
    let k = `${e.weekday}|${normText(e.nome)}`;
    if (seen[k] != null){ seen[k]++; k += '#' + seen[k]; } else seen[k] = 0;
    snap[k] = { h: e.hora, g: e.garantido, b: e.buyin, n: e.nome, d: e.weekday };
  });
  return snap;
}
function maybeShowGlobalDiff(){
  const el = document.getElementById('globalDiff');
  if (!el || !META || !META.at) return;
  let prev = null;
  try{ prev = JSON.parse(localStorage.getItem(DIFF_KEY) || 'null'); }catch(e){}
  const snap = diffSnapshot();
  try{ localStorage.setItem(DIFF_KEY, JSON.stringify({ at: META.at, snap })); }catch(e){}
  el.hidden = true;
  if (!prev || !prev.snap || `${prev.at}` === `${META.at}`) return;
  if (localStorage.getItem(DIFF_SEEN_KEY) === `${META.at}`) return;   // já dispensado
  const added = [], removed = [], changed = [];
  Object.entries(snap).forEach(([k, v]) => {
    const o = prev.snap[k];
    if (!o){ added.push(v); return; }
    const muda = [];
    if (o.h !== v.h) muda.push(`${o.h} → ${v.h}`);
    if (o.g !== v.g) muda.push(`GTD ${fmtMoney(o.g)} → ${fmtMoney(v.g)}`);
    if (o.b !== v.b) muda.push(`buy-in ${fmtMoneyFull(o.b)} → ${fmtMoneyFull(v.b)}`);
    if (muda.length) changed.push({ ...v, muda });
  });
  Object.entries(prev.snap).forEach(([k, v]) => { if (!snap[k]) removed.push(v); });
  if (!added.length && !removed.length && !changed.length) return;
  const li = (v, extra) => `<li><b>${WEEKDAY_SHORT[isoWeekdayIdx(MODEL.dates[v.d] || gradeTodayISO())] || v.d}</b> ${escHtml(shortName(v.n))}${extra ? ` <span class="gd-m">${extra}</span>` : ''}</li>`;
  const MAXL = 10;
  el.innerHTML = `<div class="gd-banner" role="status">
    <span class="gd-ico">📋</span>
    <div class="gd-body">
      <b>Global nova${META.by ? ` (${escHtml(META.by)})` : ''}:</b>
      ${[added.length ? `+${conta2(added.length, 'evento', 'eventos')}` : '',
         removed.length ? `${conta2(removed.length, 'removido', 'removidos')}` : '',
         changed.length ? `${conta2(changed.length, 'alterado', 'alterados')}` : ''].filter(Boolean).join(' · ')}
      <details class="gd-det"><summary>ver o que mudou</summary>
        ${changed.length ? `<p class="gd-h">Alterados</p><ul>${changed.slice(0, MAXL).map(v => li(v, v.muda.map(escHtml).join(' · '))).join('')}${changed.length > MAXL ? `<li class="gd-more">+${changed.length - MAXL}…</li>` : ''}</ul>` : ''}
        ${added.length ? `<p class="gd-h">Novos</p><ul>${added.slice(0, MAXL).map(v => li(v, `${v.h}${v.g != null ? ' · GTD ' + fmtMoney(v.g) : ''}`)).join('')}${added.length > MAXL ? `<li class="gd-more">+${added.length - MAXL}…</li>` : ''}</ul>` : ''}
        ${removed.length ? `<p class="gd-h">Removidos</p><ul>${removed.slice(0, MAXL).map(v => li(v, v.h)).join('')}${removed.length > MAXL ? `<li class="gd-more">+${removed.length - MAXL}…</li>` : ''}</ul>` : ''}
      </details>
    </div>
    <button class="gd-close" data-gd-close title="Dispensar" aria-label="Dispensar o resumo de mudanças">✕</button>
  </div>`;
  el.hidden = false;
  el.querySelector('[data-gd-close]').addEventListener('click', () => {
    el.hidden = true;
    try{ localStorage.setItem(DIFF_SEEN_KEY, `${META.at}`); }catch(e){}
  });
}
const conta2 = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

/* abre a rota do evento do ?ev= e rola até ela — o outro lado do link
   compartilhável (writeStateToURL grava o ?ev=, este lê no boot) */
function openFromURL(ev){
  toggleRow(ev.id);
  const row = document.querySelector(`.row[data-id="${ev.id}"]`);
  if (row) row.scrollIntoView({ block:'center', behavior:'smooth' });
}

/* fallback: ler um arquivo local sem publicar nada */
document.getElementById('localFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try{
    /* o arquivo local segue no caminho síncrono: é uma ação manual e pontual,
       o operador está esperando por ela, e o Worker fala em base64 (o formato
       em que a Global vem do Firebase), não em File */
    await ensureXLSX();
    const matrix = readSheetMatrix(await file.arrayBuffer(), 'MTTS BRAZIL');
    if (!matrix) throw new Error('aba "MTTS BRAZIL" não encontrada');
    META = { filename: file.name, at: Date.now(), by: 'você (arquivo local)' };
    applyParsed(parseGlobalWeek(matrix));
  }catch(err){ alert('Não consegui ler essa planilha: ' + err.message); }
  e.target.value = '';
});
document.querySelectorAll('[data-local-upload]').forEach(b =>
  b.addEventListener('click', () => document.getElementById('localFile').click()));

function showEmpty(){
  document.getElementById('loading').hidden = true;
  if (!MODEL) document.getElementById('emptyState').hidden = false;
}

function setSync(ok){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.classList.toggle('on', !!ok);        /* mesmas classes dos outros painéis */
  el.classList.toggle('off', !ok);
  el.querySelector('.sync-label').textContent = ok ? 'Ao vivo' : 'Reconectando…';
}

/* ═══════════════════ filtros ═══════════════════ */

/* ═══════════════════ BUSCA ═══════════════════
   Era `normText(nome).includes(q)`: substring pura no nome. Três buracos que a
   operação sentia todo dia e ninguém reportava (a pessoa só desiste e rola a
   lista): "warmup 50k" não achava "#AS 50K WarmUp" porque a ORDEM não bate;
   "50 mil" não achava nada porque a Global escreve "50K"; e "satelite" não
   achava satélite nenhum porque a categoria não estava no texto.

   Agora: cada token da busca precisa aparecer em ALGUM lugar do evento (nome,
   campanha, categoria, hora, grupo do satélite), em qualquer ordem. */

/* "50k", "50 mil", "50.000" e "50000" são a MESMA coisa pra quem procura um
   torneio. Os dois lados viram a mesma etiqueta canônica, então tanto faz o que
   a pessoa digita ou como a planilha escreveu. */
function canonNumero(txt){
  return String(txt)
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/g, (_, n) => String(Math.round(parseFloat(n.replace(',', '.')) * 1000)))
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:mi|milhao|milhoes)\b/g, (_, n) => String(Math.round(parseFloat(n.replace(',', '.')) * 1000000)))
    .replace(/(\d)\.(\d{3})\b/g, '$1$2');            // 50.000 → 50000 (depois do k/mil: "1.5k" continua 1500)
}
/* como a operação FALA × como a planilha escreve */
const BUSCA_SINONIMOS = {
  sat:'satelite', sats:'satelite', satelites:'satelite', satellite:'satelite',
  ko:'k', pko:'pko', freeze:'freezeout', hr:'highroller', high:'highroller',
  main:'main', side:'side', gtd:'garantido', bounty:'bounty',
};
function buscaTokens(s){
  return canonNumero(normText(s))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean)
    .map(t => BUSCA_SINONIMOS[t] || t);
}
/* o texto inteiro do evento, achatado. Cacheado no próprio objeto: o modelo é
   reconstruído a cada Global nova, então o cache morre junto — sem invalidação
   pra esquecer. */
function eventoHaystack(e){
  if (!e.__hay){
    e.__hay = ' ' + buscaTokens([
      e.nome,
      e.camp ? CAMP_LABEL[e.camp] : '',
      CAT_META[e.cat].label,                        // "Satélite", "Main Event", "Side Event"
      e.hora,
      e.groupHeader || '',
    ].join(' ')).join(' ') + ' ';
  }
  return e.__hay;
}
/* o futuro (P&D) não tem categoria nem grupo — só nome, campanha e hora */
function futuroHaystack(f){
  if (!f.__hay){
    f.__hay = ' ' + buscaTokens([f.nome, f.camp ? CAMP_LABEL[f.camp] : '', f.tipo || '', f.hora || ''].join(' ')).join(' ') + ' ';
  }
  return f.__hay;
}
let _qStr = null, _qToks = [];
function queryTokens(q){
  if (q !== _qStr){ _qStr = q; _qToks = buscaTokens(q || ''); }
  return _qToks;
}
function matchBusca(hay, q){
  const toks = queryTokens(q);
  if (!toks.length) return true;
  return toks.every(t => /^\d+$/.test(t)
    /* NÚMERO exige a palavra inteira: sem isso "50000" casava dentro de
       "250000" e de "1500000", e procurar o 50K trazia o 250K e o 1,5 mi
       junto. É pra isto que o haystack tem espaço nas pontas. */
    ? hay.includes(' ' + t + ' ')
    /* PALAVRA casa por pedaço: "warm" tem que achar "WarmUp", e é assim que
       alguém encontra o torneio sem lembrar o nome exato. */
    : hay.includes(t));
}

function matches(ev){
  if (state.camp === 'none' && ev.camp) return false;
  if (state.camp !== 'all' && state.camp !== 'none' && ev.camp !== state.camp) return false;
  if (state.cat !== 'all' && ev.cat !== state.cat) return false;
  if (state.q && !matchBusca(eventoHaystack(ev), state.q)) return false;
  return true;
}
function temFiltroAtivo(){ return state.camp !== 'all' || state.cat !== 'all' || !!state.q; }

/* pinta um grupo de chips: classe (visual), aria-checked (semântica) e roving
   tabindex (só o ativo entra no Tab; dentro do grupo navega-se com as setas).
   Antes só a classe era tocada — o grupo inteiro era invisível pro leitor de
   tela e cada chip roubava uma parada do Tab. */
function paintChips(groupId, key){
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => {
    const on = c.dataset[key] === state[key];
    c.classList.toggle('on', on);
    c.setAttribute('aria-checked', String(on));
    c.tabIndex = on ? 0 : -1;
  });
}
function wireChipGroup(groupId, key){
  const group = document.getElementById(groupId);
  const pick = (val, focus) => {
    if (!val || state[key] === val) return;
    state[key] = val;
    paintChips(groupId, key);
    writeStateToURL(); renderContent();
    if (focus){
      const el = group.querySelector(`.chip[data-${key}="${val}"]`);
      if (el) el.focus();
    }
  };
  group.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => pick(ch.dataset[key])));
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const chips = [...group.querySelectorAll('.chip')];
    const at = chips.findIndex(c => c.dataset[key] === state[key]);
    pick(chips[((at === -1 ? 0 : at) + step + chips.length) % chips.length].dataset[key], true);
  });
}
function wireFilters(){
  wireChipGroup('campChips', 'camp');
  wireChipGroup('catChips', 'cat');
  let qTimer = null;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); writeStateToURL(); renderContent(); }, 180);
  });
}
/* reflete na UI o estado que veio da URL */
function syncFilterUI(){
  paintChips('campChips', 'camp');
  paintChips('catChips', 'cat');
  document.getElementById('searchInput').value = state.q;
}

/* ═══════════════════ render ═══════════════════ */

function renderAll(){
  if (!MODEL) return;
  renderMeta();
  renderHero();
  renderDayBar();
  renderContent();
}
/* o que muda com filtro/dia — hero e barra de dias ficam de fora */
function renderContent(){
  state.open = null;
  renderAgenda();
  renderRoutes();
  renderFutures();
}

function campBadge(camp){
  return camp ? `<span class="badge b-camp">✦ ${CAMP_LABEL[camp]}</span>` : '';
}
/* variante do torneio (HR/Turbo/KO…) visível na linha: é o sufixo que separa os
   irmãos da mesma família — e o que o veto de vínculo usa (variantOf, radar-core).
   Vê-la de relance ajuda a conferir os vínculos sem abrir linha por linha. */
const VARIANT_LABEL = { hr:'HR', turbo:'TURBO', ko:'KO', mystery:'MYSTERY', deep:'DEEP' };
function variantChip(e){
  const v = variantOf(e.nome);
  return v ? `<em class="r-var" title="Variante identificada no nome">${VARIANT_LABEL[v] || v.toUpperCase()}</em>` : '';
}

function renderMeta(){
  const el = document.getElementById('sourceMeta');
  if (!META){ el.hidden = true; return; }
  const h = (Date.now() - META.at) / 3600000;
  const age = h < 1 ? `${Math.max(1, Math.round(h*60))} min` : `${Math.round(h)}h`;
  el.hidden = false;
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
    <b>${escHtml(META.filename)}</b> · ${escHtml(META.by)} · há ${age}`;
}

function renderHero(){
  const evs = MODEL.events;
  const today = todayWeekdayPT();
  const live = evs.filter(e => statusOf(e).k === 'live').length;
  const hoje = evs.filter(e => e.weekday === today).length;
  const gtdWeek = evs.reduce((s,e) => s + (e.garantido || 0), 0);
  document.getElementById('statLive').textContent = NF_INT.format(live);
  document.getElementById('statToday').textContent = NF_INT.format(hoje);
  document.getElementById('statFut').textContent = NF_INT.format(MODEL.futures.length);
  document.getElementById('statGtd').textContent = fmtMoney(gtdWeek);
  document.getElementById('liveDot').classList.toggle('has-live', live > 0);
  if (!renderHero._counted){ renderHero._counted = true; SupremaMotion.countUp('#statLive, #statToday, #statFut'); }
}

/* ── barra de dias: a navegação principal + mini-barras de GTD (a leitura
   instantânea do peso da semana; um matiz só — dourado = dinheiro) ── */
function renderDayBar(){
  const wrap = document.getElementById('dayBar');
  const today = todayWeekdayPT();
  /* a mini-barra agora é EMPILHADA por categoria (Main/Side/Sat nas cores da
     família) — a mesma leitura do "A SEMANA INTEIRA" da TV: o tamanho diz qual
     é o dia forte, a cor diz de quê ele é feito */
  const gtdByDay = {}, mixByDay = {};
  let gtdMax = 0;
  WEEK_ORDER.forEach(day => {
    const mix = { main:0, side:0, sat:0 };
    MODEL.events.filter(e => e.weekday === day).forEach(e => { mix[e.cat] += (e.garantido || 0); });
    const g = mix.main + mix.side + mix.sat;
    gtdByDay[day] = g; mixByDay[day] = mix;
    if (g > gtdMax) gtdMax = g;
  });
  wrap.innerHTML = WEEK_ORDER.map(day => {
    const iso = MODEL.dates[day];
    const n = MODEL.events.filter(e => e.weekday === day).length;
    const pct = gtdMax > 0 ? Math.round((gtdByDay[day] / gtdMax) * 100) : 0;
    const on = day === state.day;
    /* roving tabindex: só o dia selecionado entra na ordem do Tab; dentro do
       grupo quem navega são as setas (padrão de radiogroup) */
    return `<button class="day-pill ${on ? 'on' : ''} ${day === today ? 'is-today' : ''}"
      role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}"
      data-day="${day}" ${n ? '' : 'disabled'}
      title="${day}: ${n} eventos · ${fmtMoney(gtdByDay[day])} garantidos"
      aria-label="${day}${day === today ? ' (hoje)' : ''}, ${n} evento${n === 1 ? '' : 's'}, ${fmtMoney(gtdByDay[day])} garantidos">
      <span class="dp-wd">${WEEKDAY_SHORT[isoWeekdayIdx(iso)]}</span>
      <span class="dp-d">${+iso.slice(8)}</span>
      <span class="dp-n">${n || '·'}</span>
      <i class="dp-bar" aria-hidden="true"><span class="dp-fill" style="width:${pct}%">
        <b class="c-main" style="flex:${mixByDay[day].main || 0}"></b><b class="c-side" style="flex:${mixByDay[day].side || 0}"></b><b class="c-sat" style="flex:${mixByDay[day].sat || 0}"></b>
      </span></i>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.day-pill').forEach(p => p.addEventListener('click', () => pickDay(p.dataset.day)));
}
function pickDay(day, focus){
  if (!day || state.day === day) return;
  state.day = day;
  writeStateToURL();
  renderDayBar();
  renderContent();
  if (focus){
    const el = document.querySelector(`.day-pill[data-day="${day}"]`);
    if (el) el.focus();
  }
}
/* setas/Home/End dentro do grupo de dias — pula os dias vazios (disabled), que
   não são alvo válido de seleção */
document.getElementById('dayBar').addEventListener('keydown', (e) => {
  const step = { ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1 }[e.key];
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  const pills = [...document.querySelectorAll('.day-pill:not(:disabled)')];
  if (!pills.length) return;
  e.preventDefault();
  if (e.key === 'Home'){ pickDay(pills[0].dataset.day, true); return; }
  if (e.key === 'End'){ pickDay(pills[pills.length-1].dataset.day, true); return; }
  const at = pills.findIndex(p => p.dataset.day === state.day);
  const next = pills[((at === -1 ? 0 : at) + step + pills.length) % pills.length];
  pickDay(next.dataset.day, true);
});

/* ── AGENDA do dia: linhas verticais, divisor AGORA, ao vivo aceso ── */
function renderAgenda(){
  const day = state.day;
  const iso = MODEL.dates[day];
  const evs = MODEL.events.filter(e => e.weekday === day && matches(e));
  const all = MODEL.events.filter(e => e.weekday === day);
  const gtd = evs.reduce((s,e) => s + (e.garantido || 0), 0);
  const today = day === todayWeekdayPT();
  const now = spNow();
  const nowAbs = absMin(now.iso, now.minutes);

  const head = document.getElementById('agendaHead');
  head.innerHTML = `
    <h2>${escHtml(day.replace('-FEIRA',''))}<span class="ah-date">${fmtDateShort(iso)}</span>
      ${today ? '<span class="today-tag">HOJE</span>' : ''}</h2>
    <span class="ah-sub">${evs.length}${evs.length !== all.length ? ` de ${all.length}` : ''} evento${evs.length === 1 ? '' : 's'} · <b>${fmtMoney(gtd)}</b> garantidos</span>
    ${evs.length ? `<span class="ah-tools">
      <button class="btn-sm ghost" data-day-csv title="Exportar as linhas visíveis pra planilha (CSV)">⬇ CSV</button>
      <button class="btn-sm ghost" data-day-promo title="Baixar os cards de divulgação dos maiores GTD do dia">🖼 Destaques do dia</button>
    </span>` : ''}`;

  const list = document.getElementById('agendaList');
  if (!evs.length){ list.innerHTML = agendaVaziaHtml(all.length); return; }
  let html = '', nowMarkPlaced = !today;
  evs.forEach(e => {
    const st = statusOf(e);
    if (!nowMarkPlaced && e.abs > nowAbs){
      html += nowDividerHtml(now);
      nowMarkPlaced = true;
    }
    html += rowHtml(e, st);
  });
  if (!nowMarkPlaced) html += nowDividerHtml(now);
  list.innerHTML = html;
  updateLiveNums();                                  // premiação/field ao vivo nas linhas de hoje
}
/* ferramentas do dia: CSV das linhas visíveis + cards dos destaques em lote */
document.getElementById('agendaHead').addEventListener('click', (e) => {
  if (!MODEL) return;
  if (e.target.closest('[data-day-csv]')) exportDayCsv();
  else if (e.target.closest('[data-day-promo]')) batchPromoDay();
});
function visibleDayEvents(){
  return MODEL.events.filter(e => e.weekday === state.day && matches(e));
}
function exportDayCsv(){
  const evs = visibleDayEvents();
  if (!evs.length){ toast('Nada visível pra exportar', true); return; }
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['data','dia','hora','categoria','variante','campanha','nome','buy-in','garantido','destino do ticket'].join(';')];
  evs.forEach(e => {
    const t = e.targetId ? MODEL.byId.get(e.targetId) : null;
    rows.push([
      e.dateISO, WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)], e.hora,
      CAT_META[e.cat].label, variantOf(e.nome) || '', e.camp ? CAMP_LABEL[e.camp] : '',
      cell(e.nome), e.buyin ?? '', e.garantido ?? '',
      cell(t ? t.nome : (e.targetGroup || '')),
    ].join(';'));
  });
  /* BOM: sem ele o Excel pt-BR abre o arquivo com acentuação quebrada */
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `radar-${SHORT_BY_DAY[state.day].toLowerCase()}-${MODEL.dates[state.day]}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`CSV com ${evs.length} evento${evs.length === 1 ? '' : 's'} baixado ⬇`);
}
function batchPromoDay(){
  const picks = visibleDayEvents().filter(e => e.garantido != null)
    .sort((a,b) => b.garantido - a.garantido).slice(0, 5);
  if (!picks.length){ toast('Nenhum evento com garantido visível neste dia', true); return; }
  picks.forEach((e, i) => {
    const cv = buildPromoCanvas(promoSpecFromEvent(e));
    const slug = normText(e.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'evento';
    /* downloads escalonados: alguns navegadores engolem cliques de download em
       sequência imediata */
    setTimeout(() => {
      const a = document.createElement('a');
      a.download = `suprema-${String(i+1).padStart(2,'0')}-${slug}.png`;
      a.href = cv.toDataURL('image/png');
      a.click();
    }, i * 350);
  });
  toast(`${picks.length} card${picks.length === 1 ? '' : 's'} dos maiores GTD do dia baixando 🖼`);
}
/* ── BUSCA VAZIA COM SAÍDA ──
   "Nenhum evento passa nos filtros atuais." é um beco sem saída: a pessoa
   procurou um torneio que EXISTE — só que na quinta — e a tela responde nada,
   sem dizer nem que ele existe nem como chegar nele. O Radar tem a SEMANA
   INTEIRA na mão; esconder isso é desperdício. Agora ele diz onde está e leva. */
function agendaVaziaHtml(totalNoDia){
  if (!totalNoDia && !temFiltroAtivo())
    return `<p class="section-empty">Nenhum evento neste dia na Global desta semana.</p>`;
  const noutros = WEEK_ORDER.filter(d => d !== state.day)
    .map(d => ({ d, n: MODEL.events.filter(e => e.weekday === d && matches(e)).length }))
    .filter(x => x.n > 0);
  const total = noutros.reduce((s, x) => s + x.n, 0);
  return `<div class="ag-vazia">
    <p class="av-titulo">Nada ${state.q ? `para “${escHtml(state.q)}”` : 'com esses filtros'}${totalNoDia ? ' neste dia' : ''}.</p>
    ${noutros.length ? `
      <p class="av-sub">Mas ${total === 1 ? 'tem 1 evento' : `tem ${total} eventos`} em outro${noutros.length > 1 ? 's' : ''} dia${noutros.length > 1 ? 's' : ''} da semana:</p>
      <div class="av-dias">${noutros.map(x => `
        <button class="av-dia" data-ir="${x.d}" aria-label="Ir para ${x.d}, ${x.n} resultado${x.n > 1 ? 's' : ''}">
          <b>${WEEKDAY_SHORT[isoWeekdayIdx(MODEL.dates[x.d])]}</b><span>${x.n}</span>
        </button>`).join('')}</div>`
    : `<p class="av-sub">E nenhum outro dia da semana tem — confira a busca ou os filtros.</p>`}
    <button class="btn-sm ghost" data-limpar>✕ Limpar filtros</button>
  </div>`;
}
function limparFiltros(){
  state.camp = 'all'; state.cat = 'all'; state.q = '';
  syncFilterUI(); writeStateToURL(); renderContent();
}

function nowDividerHtml(now){
  const hh = String(Math.floor(now.minutes/60)).padStart(2,'0'), mm = String(now.minutes%60).padStart(2,'0');
  return `<div class="now-divider" id="nowDivider" aria-label="Agora são ${hh}:${mm}"><i></i><span>AGORA · ${hh}:${mm}</span><i></i></div>`;
}
/* o único pedaço da linha que muda com o RELÓGIO — isolado pra que o refresh
   por minuto possa reescrever só isto (ver refreshAgendaStatus) */
function statusHtml(e, st){
  return st.k === 'live' ? `<span class="r-live"><i class="pulse"></i>AO VIVO${e.late ? `<small>late até ${e.late}</small>` : ''}</span>` :
         st.k === 'soon' ? `<span class="r-soon">em ${fmtIn(st.inMin)}</span>` : '';
}
function rowHtml(e, st){
  const target = e.targetId ? MODEL.byId.get(e.targetId) : null;
  const link =
    target ? `<span class="r-ticket" title="Premia ticket para ${escHtml(target.nome)}">🎟 → ${escHtml(target.nome)}${e.overridden ? ' <em class="r-fixed" title="Vínculo corrigido manualmente">✓ corrigido</em>' : ''}</span>` :
    e.targetGroup ? `<span class="r-ticket" title="Destino declarado na planilha (fora da grade desta semana)">🎟 → ${escHtml(e.targetGroup)} <em class="r-offgrid">fora da grade</em></span>` :
    e.satCount ? `<span class="r-ticket in">🎟 ${contaR(e.satCount, 'satélite classifica', 'satélites classificam')}</span>` : '';
  /* A LINHA INTEIRA continua clicável (é o alvo confortável no mouse), mas quem
     carrega a semântica é o CHEVRON — agora um <button> de verdade, com
     aria-expanded/aria-controls. Antes o <article> só tinha handler de clique:
     no teclado não havia como abrir rota nenhuma, e o leitor de tela não tinha
     o que anunciar. Botão aninhado dentro de role="button" seria inválido, por
     isso a linha permanece um container sem role. */
  return `<article class="row has-detail ${st.k} ${CAT_META[e.cat].cls}" data-id="${e.id}">
    <span class="r-time">${e.hora}</span>
    <span class="r-suit" title="${CAT_META[e.cat].label}">${CAT_META[e.cat].suit}</span>
    <div class="r-main">
      <div class="r-name">${escHtml(e.nome)}${variantChip(e)}${campBadge(e.camp)}</div>
      ${link ? `<div class="r-link">${link}</div>` : ''}
    </div>
    <div class="r-nums">
      <span class="r-livenums" hidden></span>
      <span class="r-gtd">${e.garantido != null ? fmtMoney(e.garantido) : ''}</span>
      <span class="r-buyin">${e.buyin != null ? fmtMoneyFull(e.buyin) : ''}</span>
    </div>
    <span class="r-status">${statusHtml(e, st)}</span>
    <button class="r-copy" data-copy="${e.id}" title="Copiar pro chat" aria-label="Copiar informações de ${escHtml(e.nome)} pro chat">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
    </button>
    <button class="r-chev" aria-expanded="false" aria-controls="detail-${e.id}"
      aria-label="Ver a rota do ticket de ${escHtml(e.nome)}">›</button>
  </article>`;
}

/* ── REFRESH POR MINUTO, SEM RECONSTRUIR A LISTA ──
   renderAgenda() reescrevia list.innerHTML inteiro a cada 60s. Efeitos colaterais
   reais: (1) a rota que o operador tinha aberto SUMIA sozinha — e como state.open
   continuava apontando pra linha, o clique seguinte nela só "fechava" um detalhe
   que já não existia, exigindo dois cliques pra reabrir; (2) seleção de texto e
   foco de teclado morriam no meio da leitura; (3) os spans de glow do
   suprema-motion eram recriados do zero. A ordem das linhas não muda com o
   relógio — só o status e a posição do divisor AGORA. É só isso que tocamos. */
function refreshAgendaStatus(){
  const list = document.getElementById('agendaList');
  if (!list || !MODEL) return;
  const rows = list.querySelectorAll('.row[data-id]');
  if (!rows.length) return;
  const now = spNow();
  const nowAbs = absMin(now.iso, now.minutes);
  let firstFuture = null;
  rows.forEach(row => {
    const e = MODEL.byId.get(row.dataset.id);
    if (!e) return;
    const st = statusOf(e);
    if (!firstFuture && e.abs > nowAbs) firstFuture = row;
    if (!row.classList.contains(st.k)){
      row.classList.remove('live','soon','upcoming','past');
      row.classList.add(st.k);
    }
    const slot = row.querySelector('.r-status');
    const html = statusHtml(e, st);
    if (slot && slot.innerHTML !== html) slot.innerHTML = html;
  });
  /* o divisor AGORA desce conforme os eventos ficam pra trás */
  const div = document.getElementById('nowDivider');
  if (!div) return;                                  // dia que não é hoje: não existe divisor
  const hh = String(Math.floor(now.minutes/60)).padStart(2,'0'), mm = String(now.minutes%60).padStart(2,'0');
  const label = div.querySelector('span');
  if (label) label.textContent = `AGORA · ${hh}:${mm}`;
  div.setAttribute('aria-label', `Agora são ${hh}:${mm}`);
  if (firstFuture){
    if (firstFuture.previousElementSibling !== div) list.insertBefore(div, firstFuture);
  } else if (list.lastElementChild !== div){
    list.appendChild(div);
  }
}

/* clique na agenda: copiar, salvar correção, gerar card, ou expandir a rota */
document.getElementById('agendaList').addEventListener('click', (e) => {
  if (!MODEL) return;
  const irDia = e.target.closest('[data-ir]');
  if (irDia){ pickDay(irDia.dataset.ir); return; }          // "está na quinta" → vai pra quinta
  const limpar = e.target.closest('[data-limpar]');
  if (limpar){ limparFiltros(); return; }
  const copyBtn = e.target.closest('.r-copy');
  if (copyBtn){ copyEvent(copyBtn.dataset.copy); return; }
  const copy2 = e.target.closest('[data-copy2]');
  if (copy2){ copyEvent(copy2.dataset.copy2, copy2.dataset.fmt); return; }
  const linkBtn = e.target.closest('[data-link]');
  if (linkBtn){ copyLink(linkBtn.dataset.link); return; }
  const fixSave = e.target.closest('[data-fix-save]');
  if (fixSave){ saveOverride(fixSave.dataset.fixSave); return; }
  const fixClear = e.target.closest('[data-fix-clear]');
  if (fixClear){ clearOverride(fixClear.dataset.fixClear); return; }
  const promoBtn = e.target.closest('[data-promo]');
  if (promoBtn){ makePromoCard(promoSpecFromEvent(MODEL.byId.get(promoBtn.dataset.promo))); return; }
  if (e.target.closest('.row-detail')) return;      // cliques soltos no detalhe não fecham
  const row = e.target.closest('.row.has-detail');
  if (!row) return;
  toggleRow(row.dataset.id);
});
/* busca dentro do select de correção (admin): remonta as <option> filtrando por
   nome, pra não encarar a semana inteira no dropdown */
document.getElementById('agendaList').addEventListener('input', (e) => {
  const q = e.target.closest('.rd-fix-q');
  if (!q || !MODEL) return;
  const id = q.id.replace('fixQ-', '');
  const sat = MODEL.byId.get(id);
  const sel = document.getElementById('fixSel-' + id);
  if (sat && sel) sel.innerHTML = fixOptionsHtml(sat, OVERRIDES[fbKey(evKey(sat))], q.value.trim());
});

/* abre/fecha a rota de UMA linha (um detalhe aberto por vez). Estado visual e
   estado ARIA andam juntos — o chevron é o botão que o leitor de tela anuncia. */
function toggleRow(id){
  const existing = document.querySelector('.row-detail');
  if (existing) existing.remove();
  document.querySelectorAll('.row.open').forEach(r => {
    r.classList.remove('open');
    const chev = r.querySelector('.r-chev');
    if (chev) chev.setAttribute('aria-expanded', 'false');
  });
  if (state.open === id){ state.open = null; writeStateToURL(); return; }
  const row = document.querySelector(`.row[data-id="${id}"]`);
  if (!row) { state.open = null; writeStateToURL(); return; }
  state.open = id;
  row.classList.add('open');
  const chev = row.querySelector('.r-chev');
  if (chev) chev.setAttribute('aria-expanded', 'true');
  row.insertAdjacentHTML('afterend',
    `<div class="row-detail" id="detail-${id}" role="region" aria-label="Rota do ticket">${detailHtml(MODEL.byId.get(id))}</div>`);
  writeStateToURL();          // a rota aberta entra na URL (link compartilhável)
}

function detailHtml(e){
  if (!e) return '';
  let flow = '';
  if (e.cat === 'sat' && e.targetId){
    const t = MODEL.byId.get(e.targetId);
    const chain = t.cat === 'sat';
    flow = `<div class="rd-flow">
      <span class="rd-node">♦ ${escHtml(shortName(e.nome))}<small>${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} ${e.hora} · buy-in ${fmtMoneyFull(e.buyin)}</small></span>
      <span class="rd-arrow"><span class="ticket-chip">🎟 ${t.buyin != null ? fmtMoney(t.buyin) : 'ticket'}</span></span>
      <span class="rd-node tgt">${CAT_META[t.cat].suit} ${escHtml(t.nome)}<small>${WEEKDAY_SHORT[isoWeekdayIdx(t.dateISO)]} ${t.hora} · ${chain ? `buy-in ${fmtMoneyFull(t.buyin)}` : `GTD ${fmtMoney(t.garantido)}`}</small></span>
    </div>
    <p class="rd-note">${chain
      ? `Cadeia de classificação: este satélite dá entrada no <b>próximo estágio</b> (${escHtml(shortName(t.nome))}) — clique nele na agenda pra seguir a rota.`
      : `Quem vencer o satélite ganha o ticket de <b>${t.buyin != null ? fmtMoneyFull(t.buyin) : 'entrada'}</b> — acesso direto ao torneio-alvo.`}</p>`;
  } else if (e.cat === 'sat' && e.targetGroup){
    flow = `<div class="rd-flow">
      <span class="rd-node">♦ ${escHtml(shortName(e.nome))}<small>${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} ${e.hora} · buy-in ${fmtMoneyFull(e.buyin)}</small></span>
      <span class="rd-arrow"><span class="ticket-chip">🎟 ticket</span></span>
      <span class="rd-node tgt">✦ ${escHtml(e.targetGroup)}<small>série / evento fora da grade desta semana</small></span>
    </div>
    <p class="rd-note">A planilha agrupa este satélite sob <b>${escHtml(e.targetGroup)}</b> — o destino não é um torneio da grade semanal (série ou evento live).</p>`;
  } else if (e.cat !== 'sat'){
    const sats = MODEL.events.filter(s => s.targetId === e.id);
    if (sats.length){
      flow = `<div class="rd-flow">
        <span class="rd-sats">${sats.map(s =>
          `<span class="rd-node">♦ ${escHtml(shortName(s.nome))}<small>${WEEKDAY_SHORT[isoWeekdayIdx(s.dateISO)]} ${s.hora} · ${fmtMoneyFull(s.buyin)}</small></span>`).join('')}</span>
        <span class="rd-arrow"><span class="ticket-chip">🎟 ${e.buyin != null ? fmtMoney(e.buyin) : 'ticket'}</span></span>
        <span class="rd-node tgt">${CAT_META[e.cat].suit} ${escHtml(e.nome)}<small>${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} ${e.hora} · GTD ${fmtMoney(e.garantido)}</small></span>
      </div>
      <p class="rd-note">${sats.length} caminho${sats.length > 1 ? 's' : ''} barato${sats.length > 1 ? 's' : ''} até este torneio — o ticket vale <b>${e.buyin != null ? fmtMoneyFull(e.buyin) : 'a entrada'}</b>.</p>`;
    } else {
      flow = `<p class="rd-note">Nenhum satélite ligado a este evento nesta semana.</p>`;
    }
  } else {
    flow = `<p class="rd-note">Satélite sem destino identificado na planilha (sem grupo na coluna A e sem alvo por nome).</p>`;
  }
  return flow + rdActionsHtml(e);
}

/* explica em uma frase POR QUE a heurística ligou o satélite onde ligou — o
   admin decidia no escuro, sobrescrevendo sem saber o que estava corrigindo.
   Lê o linkWhy que o radar-core agora guarda. */
function linkWhyHtml(e){
  const w = e.linkWhy;
  if (!w) return '';
  if (e.overridden) return `<p class="rd-why fixed">✓ Alvo definido à mão por um admin — a heurística está sendo ignorada aqui.</p>`;
  if (w.via === 'header') return `<p class="rd-why">Ligado pelo <b>cabeçalho do grupo</b> na planilha (“${escHtml(w.grupo)}”) — é a declaração explícita da Global, não um palpite.</p>`;
  if (w.via === 'tokens') return `<p class="rd-why">Ligado por <b>nome parecido</b> (${w.toks.map(t => `<code>${escHtml(t)}</code>`).join(' ')}) — confiança ${w.score}. Confira se é o alvo certo.</p>`;
  if (w.via === 'grupo') return `<p class="rd-why">Sem torneio na grade com esse nome — o grupo “${escHtml(w.grupo)}” virou destino nomeado (série/live fora da semana).</p>`;
  if (w.via === 'nenhum'){
    const q = w.quase ? MODEL.byId.get(w.quase.id) : null;
    return `<p class="rd-why warn">Nenhum alvo identificado.${q ? ` O mais perto foi <b>${escHtml(shortName(q.nome))}</b> (confiança ${w.quase.score}, abaixo do corte).` : ''} Ligue à mão se souber o destino.</p>`;
  }
  return '';
}

/* barra de ações do detalhe: link, copiar, card e correção do vínculo (admin) */
function rdActionsHtml(e){
  let html = `<div class="rd-actions">
    <div class="rd-copy-group">
      <button class="btn-sm" data-copy2="${e.id}" data-fmt="full" title="Bloco completo pro chat">📋 Copiar</button>
      <button class="btn-sm ghost" data-copy2="${e.id}" data-fmt="curto" title="Só hora, buy-in e garantido">✂️ Resumo</button>
      ${e.cat === 'sat' && (e.targetId || e.targetGroup) ? `<button class="btn-sm ghost" data-copy2="${e.id}" data-fmt="rota" title="Só a rota do ticket">🎟 Rota</button>` : ''}
      <button class="btn-sm ghost" data-link="${e.id}" title="Link direto pra este evento">🔗 Link</button>
    </div>
    <button class="btn-sm gold" data-promo="${e.id}">🖼 Card de divulgação</button>`;
  if (IS_ADMIN && e.cat === 'sat'){
    const key = fbKey(evKey(e));
    const cur = OVERRIDES[key];
    /* o palpite automático fica NOMEADO na frente do select: o admin vê o que a
       heurística escolheu e por quê antes de trocar, em vez de só sobrescrever */
    html += `<div class="rd-fix-box">
      ${linkWhyHtml(e)}
      <span class="rd-fix">
        <label class="rd-fix-lbl">Corrigir alvo:</label>
        <input type="search" class="rd-fix-q" id="fixQ-${e.id}" placeholder="filtrar torneios…" aria-label="Filtrar torneios do dia" autocomplete="off">
        <select class="rd-fix-sel" id="fixSel-${e.id}" aria-label="Corrigir alvo do satélite">${fixOptionsHtml(e, cur)}</select>
        <button class="btn-sm" data-fix-save="${e.id}">Salvar vínculo</button>
        ${cur ? `<button class="btn-sm ghost" data-fix-clear="${e.id}">✕ remover correção</button><small class="rd-fix-by">por ${escHtml(cur.by || 'admin')}</small>` : ''}
      </span>
    </div>`;
  }
  return html + `</div>`;
}
/* opções do select de correção — extraídas pra que a busca (fixQ) possa
   remontá-las filtrando por nome, sem a lista inteira da semana na cara */
function fixOptionsHtml(e, cur, filtro){
  const f = filtro ? buscaTokens(filtro) : [];
  const opts = [`<option value="">— automático (heurística) —</option>`,
                `<option value="none" ${cur && cur.target === 'none' ? 'selected' : ''}>sem alvo / fora da grade</option>`];
  WEEK_ORDER.forEach(day => {
    const evs = MODEL.events.filter(t => t.weekday === day && t.id !== e.id &&
      (!f.length || f.every(tok => eventoHaystack(t).includes(tok))));
    if (!evs.length) return;
    opts.push(`<optgroup label="${day}">` + evs.map(t => {
      const k = evKey(t);
      return `<option value="${escHtml(k)}" ${cur && cur.target === k ? 'selected' : ''}>${CAT_META[t.cat].suit} ${t.hora} ${escHtml(shortName(t.nome))}</option>`;
    }).join('') + `</optgroup>`);
  });
  return opts.join('');
}

function saveOverride(id){
  const sat = MODEL.byId.get(id);
  const sel = document.getElementById('fixSel-' + id);
  if (!sat || !sel) return;
  const val = sel.value;
  const key = fbKey(evKey(sat));
  if (!val){ clearOverride(id); return; }             // "automático" = sem override
  const tEv = val !== 'none' ? MODEL.events.find(t => evKey(t) === val) : null;
  const payload = {
    target: val,
    targetName: tEv ? tEv.nome : null,
    by: (SupremaAuth.getSession() || {}).email || 'admin',
    at: Date.now(),
  };
  SupremaDB.set(`eventos/linksOverride/${key}`, payload)
    .then(() => toast('Vínculo corrigido — vale pra todo mundo ✓'))
    .catch(err => { console.error('[Radar] override falhou', err); toast('Não consegui salvar (permissão?)', true); });
}
function clearOverride(id){
  const sat = MODEL.byId.get(id);
  if (!sat) return;
  SupremaDB.remove(`eventos/linksOverride/${fbKey(evKey(sat))}`)
    .then(() => toast('Correção removida — voltou ao automático'))
    .catch(err => { console.error('[Radar] remover override falhou', err); toast('Não consegui remover (permissão?)', true); });
}

function scrollAgendaToNow(){
  const el = document.getElementById('nowDivider');
  if (el) el.scrollIntoView({ block:'center' });
}

/* ── COPIAR PRO CHAT ──
   Quem responde jogador raramente quer o dossiê inteiro: às vezes é só "que
   horas e quanto", às vezes só "como chego nesse via satélite". Um bloco só,
   que a pessoa editava à mão toda vez, virou três formatos:
     full  — tudo (o padrão de antes)
     curto — hora, buy-in e garantido; a resposta rápida de balcão
     rota  — só o caminho do ticket (só faz sentido em satélite com destino) */
const contaR = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
function linhaRota(e){
  const t = e.targetId ? MODEL.byId.get(e.targetId) : null;
  if (t) return `🎟 Premia ticket${t.buyin != null ? ` de ${fmtMoneyFull(t.buyin)}` : ''} para: ${t.nome} — ${WEEKDAY_SHORT[isoWeekdayIdx(t.dateISO)]} às ${t.hora}`;
  if (e.targetGroup) return `🎟 Classifica para: ${e.targetGroup}`;
  if (e.cat !== 'sat'){
    const sats = MODEL.events.filter(s => s.targetId === e.id);
    if (sats.length){
      const cheap = sats.reduce((m,s) => (s.buyin ?? Infinity) < (m.buyin ?? Infinity) ? s : m, sats[0]);
      return `🎟 ${contaR(sats.length, 'satélite classifica', 'satélites classificam')} — dá pra entrar às ${cheap.hora}${cheap.buyin != null ? ` por ${fmtMoneyFull(cheap.buyin)}` : ''}`;
    }
  }
  return null;
}
function copyTextFor(e, fmt){
  const dia = `${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} ${fmtDateShort(e.dateISO)}`;
  const nums = [];
  if (e.garantido != null) nums.push(`GTD ${fmtMoney(e.garantido)}`);
  if (e.buyin != null) nums.push(`Buy-in ${fmtMoneyFull(e.buyin)}`);

  if (fmt === 'curto'){
    return `${CAT_META[e.cat].suit} ${e.nome} · ${dia} às ${e.hora}${nums.length ? ' · ' + nums.join(' · ') : ''}`;
  }
  if (fmt === 'rota'){
    const r = linhaRota(e);
    return `${CAT_META[e.cat].suit} ${e.nome}\n${r || 'Sem rota de ticket identificada para este evento.'}`;
  }
  // full (padrão)
  const L = [`${CAT_META[e.cat].suit} ${e.nome}`];
  L.push(`🗓 ${dia} às ${e.hora}${e.late ? ` (late register até ${e.late})` : ''}`);
  if (nums.length) L.push(`💰 ${nums.join(' · ')}`);
  if (e.camp) L.push(`✦ Campanha ${CAMP_LABEL[e.camp]}`);
  const r = linhaRota(e);
  if (r) L.push(r);
  return L.join('\n');
}
function copyEvent(id, fmt){
  const e = MODEL.byId.get(id);
  if (!e) return;
  copiar(copyTextFor(e, fmt), { curto:'Resumo copiado ✓', rota:'Rota copiada ✓' }[fmt] || 'Copiado — é só colar no chat ✓');
}
/* copia texto pra área de transferência com fallback e toast */
function copiar(text, msg){
  const done = () => toast(msg || 'Copiado ✓');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(() => { legacyCopy(text); done(); });
  } else { legacyCopy(text); done(); }
}
/* link direto pra ESTE evento: escreve o ?ev= na URL e copia. Como writeStateToURL
   já reflete a rota aberta, basta ler o location depois de garantir o estado. */
function copyLink(id){
  const e = MODEL.byId.get(id);
  if (!e) return;
  const q = new URLSearchParams();
  q.set('dia', SHORT_BY_DAY[e.weekday]);
  q.set('ev', evKey(e));
  const url = location.origin + location.pathname + '?' + q.toString();
  copiar(url, 'Link copiado — leva direto a este evento 🔗');
}
function legacyCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); }catch(e){}
  ta.remove();
}

/* toast minimalista (feedback de copiar/salvar) */
let _toastTimer = null;
function toast(msg, isErr){
  let el = document.getElementById('radarToast');
  if (!el){
    el = document.createElement('div');
    el.id = 'radarToast'; el.setAttribute('role','status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ── ROTAS DE TICKET: um card por destino (evento da grade OU grupo nomeado
   fora da grade), conexão em CSS puro ── */
function renderRoutes(){
  const day = state.day;
  const sats = MODEL.events.filter(e => e.weekday === day && e.cat === 'sat' && matches(e));
  const byTarget = new Map();                        // id do evento OU 'g:'+grupo → sats[]
  const orphans = [];
  sats.forEach(s => {
    const key = s.targetId || (s.targetGroup ? 'g:' + s.targetGroup : null);
    if (!key){ orphans.push(s); return; }
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(s);
  });
  const realKeys = [...byTarget.keys()].filter(k => !k.startsWith('g:'))
    .sort((a,b) => MODEL.byId.get(a).abs - MODEL.byId.get(b).abs);
  const groupKeys = [...byTarget.keys()].filter(k => k.startsWith('g:')).sort();

  const wrap = document.getElementById('routesWrap');
  document.getElementById('routesEmpty').hidden = byTarget.size > 0 || orphans.length > 0;

  const realHtml = realKeys.map(key => {
    const t = MODEL.byId.get(key);
    const list = byTarget.get(key).sort((a,b) => a.abs - b.abs);
    const otherDay = t.weekday !== day ? `<span class="badge b-day">${WEEKDAY_SHORT[isoWeekdayIdx(t.dateISO)]}</span>` : '';
    const chain = t.cat === 'sat' ? `<span class="badge b-chain" title="Este destino também é satélite — a rota continua a partir dele">etapa ↷</span>` : '';
    return `<article class="route">
      <div class="rt-sats">${satRowsHtml(list)}</div>
      <div class="rt-link" aria-hidden="true"><span class="ticket-chip">🎟 ${t.buyin != null ? fmtMoney(t.buyin) : 'ticket'}</span></div>
      <div class="rt-target ${CAT_META[t.cat].cls}">
        <div class="rt-tname">${CAT_META[t.cat].suit} ${escHtml(t.nome)}${campBadge(t.camp)}${otherDay}${chain}</div>
        <div class="rt-tsub">${t.hora}${t.garantido != null ? ` · GTD <b>${fmtMoney(t.garantido)}</b>` : ''}${t.buyin != null ? ` · Buy-in ${fmtMoneyFull(t.buyin)}` : ''}</div>
      </div>
    </article>`;
  }).join('');

  const groupHtml = groupKeys.map(key => {
    const name = key.slice(2);
    const list = byTarget.get(key).sort((a,b) => a.abs - b.abs);
    return `<article class="route offgrid">
      <div class="rt-sats">${satRowsHtml(list)}</div>
      <div class="rt-link" aria-hidden="true"><span class="ticket-chip">🎟 ticket</span></div>
      <div class="rt-target">
        <div class="rt-tname">✦ ${escHtml(name)}</div>
        <div class="rt-tsub">série / evento fora da grade desta semana</div>
      </div>
    </article>`;
  }).join('');

  /* ── ÓRFÃOS: de nota de rodapé a ALERTA ──
     Satélite sem destino é o ÚNICO sinal de que a Global tem um furo que a
     operação precisa consertar. Vivia numa linha cinza no fim das rotas, onde
     ninguém olha. Agora é um bloco no topo, e cada órfão é um chip que ABRE a
     rota daquele satélite na agenda — pro admin ligar à mão ali mesmo. Pra quem
     não é admin continua sendo informação (não há o que corrigir), mas visível. */
  const orphansHtml = orphans.length ? `
    <div class="rt-alert" role="${IS_ADMIN ? 'alert' : 'note'}">
      <div class="rt-alert-head">
        <span class="rt-alert-ico">⚠️</span>
        <b>${contaR(orphans.length, 'satélite sem destino', 'satélites sem destino')}</b>
        <span class="rt-alert-sub">${IS_ADMIN ? 'clique pra abrir a rota e ligar à mão' : 'a Global não declarou o alvo — avise a operação'}</span>
      </div>
      <div class="rt-alert-chips">${orphans.sort((a,b) => a.abs - b.abs).map(s =>
        `<button class="rt-orphan" data-open-sat="${s.id}" title="Abrir a rota de ${escHtml(s.nome)}">
          <span class="ro-hora">${s.hora}</span>${escHtml(shortName(s.nome))}</button>`).join('')}</div>
    </div>` : '';

  wrap.innerHTML = linkHealthHtml(sats) + orphansHtml + realHtml + groupHtml;
}
/* ── SAÚDE DOS VÍNCULOS ──
   O linkWhy sempre soube COMO cada satélite foi ligado (cabeçalho / heurística
   com score / grupo / órfão / corrigido) — mas só aparecia clicando linha por
   linha. Agora é uma régua no topo das Rotas: o caso OmaX teria sido pego numa
   conferência de 10 segundos, antes do telão. Os de score baixo são chips que
   abrem a rota direto — o suspeito a um clique da correção. */
const HEALTH_SCORE_CORTE = 6;
function linkHealthHtml(sats){
  if (!sats.length) return '';
  const n = { header:0, tokens:0, grupo:0, nenhum:0, fixed:0 };
  const suspeitos = [];
  sats.forEach(s => {
    if (s.overridden){ n.fixed++; return; }
    const w = s.linkWhy || {};
    n[w.via] = (n[w.via] || 0) + 1;
    if (w.via === 'tokens' && w.score < HEALTH_SCORE_CORTE) suspeitos.push(s);
  });
  const parts = [];
  if (n.header) parts.push(`<span class="lh-part ok" title="Declarados pelo cabeçalho de grupo da planilha — a fonte mais confiável">${n.header} pelo cabeçalho</span>`);
  if (n.tokens) parts.push(`<span class="lh-part ${suspeitos.length ? 'warn' : ''}" title="Ligados por nome parecido (heurística)">${n.tokens} por nome${suspeitos.length ? ` · ${suspeitos.length} com confiança baixa ⚠` : ''}</span>`);
  if (n.grupo)  parts.push(`<span class="lh-part" title="Destino nomeado fora da grade desta semana">${n.grupo} fora da grade</span>`);
  if (n.nenhum) parts.push(`<span class="lh-part warn" title="Sem destino identificado — ver alerta abaixo">${n.nenhum} sem destino</span>`);
  if (n.fixed)  parts.push(`<span class="lh-part fixed" title="Vínculo definido à mão por um admin">${n.fixed} à mão ✓</span>`);
  return `<div class="rt-health" role="note" aria-label="Saúde dos vínculos dos satélites do dia">
    <span class="lh-title">Vínculos:</span> ${parts.join('<i class="lh-sep">·</i>')}
    ${suspeitos.length ? `<span class="lh-chips">${suspeitos.sort((a,b) => a.abs - b.abs).map(s =>
      `<button class="rt-orphan warn" data-open-sat="${s.id}" title="Confiança ${s.linkWhy.score} — abrir e conferir o alvo">
        <span class="ro-hora">${s.hora}</span>${escHtml(shortName(s.nome))}</button>`).join('')}</span>` : ''}
  </div>`;
}
/* chip de órfão → abre a linha dele na agenda (e rola até lá) */
document.getElementById('routesWrap').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open-sat]');
  if (!b || !MODEL) return;
  const ev = MODEL.byId.get(b.dataset.openSat);
  if (ev) openFromURL(ev);
});
function satRowsHtml(list){
  return list.map(s => `<div class="rt-sat" title="${escHtml(s.nome)}">
    <span class="rt-hora">${s.hora}</span>
    <span class="rt-nome">${escHtml(shortName(s.nome))}</span>
    <span class="rt-buyin">${s.buyin != null ? fmtMoneyFull(s.buyin) : ''}</span>
  </div>`).join('');
}

/* ── FUTUROS (P&D depois de domingo) ── */
let FUT_SHOWN = [];
function renderFutures(){
  const wrap = document.getElementById('futGrid');
  const today = gradeTodayISO();
  FUT_SHOWN = MODEL.futures.filter(f => {
    /* futuro datado que já passou sai da vitrine (o buildModel filtra no parse,
       mas a aba pode atravessar a virada do dia com o MODEL parado) */
    if (f.dateISO && f.dateISO < today) return false;
    if (state.camp === 'none' && f.camp) return false;
    if (state.camp !== 'all' && state.camp !== 'none' && f.camp !== state.camp) return false;
    /* MESMA busca da agenda: o futuro tinha ficado com o `includes` antigo, e
       era o tipo de divergência que ninguém nota até alguém procurar "50 mil" e
       achar na agenda mas não no P&D */
    if (state.q && !matchBusca(futuroHaystack(f), state.q)) return false;
    return true;
  });
  document.getElementById('futEmpty').hidden = FUT_SHOWN.length > 0;
  wrap.innerHTML = FUT_SHOWN.map((f, i) => {
    const days = f.dateISO ? isoDayNumber(f.dateISO) - isoDayNumber(today) : null;
    const when = days == null ? 'data a definir'
      : days <= 0 ? 'é hoje!' : days === 1 ? 'amanhã' : `em ${days} dias`;
    const [ , m, d ] = (f.dateISO || '----------').split('-');
    return `<article class="fut-card">
      <div class="fut-date">
        ${f.dateISO ? `<span class="d">${+d}</span><span class="m">${MONTHS_PT[+m-1]}</span>` : '<span class="d">?</span>'}
      </div>
      <div class="fut-body">
        <div class="fut-when">${when}${f.hora ? ` · ${f.hora}` : ''}</div>
        <h3 class="fut-nome">${escHtml(f.nome)}${campBadge(f.camp)}</h3>
        <div class="fut-nums">
          ${f.garantido != null ? `<span class="fn-gtd">GTD <b>${fmtMoney(f.garantido)}</b></span>` : ''}
          ${f.buyin != null ? `<span>Buy-in ${fmtMoneyFull(f.buyin)}</span>` : ''}
          ${f.tipo ? `<span>${escHtml(f.tipo)}</span>` : ''}
        </div>
      </div>
      <button class="fut-share" data-share-fut="${i}" title="Card de divulgação (PNG)" aria-label="Gerar card de divulgação">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L7 20"/></svg>
      </button>
    </article>`;
  }).join('');
}
document.getElementById('futGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-share-fut]');
  if (!b) return;
  const f = FUT_SHOWN[+b.dataset.shareFut];
  if (f) makePromoCard(promoSpecFromFuture(f));
});

/* ═══════════════════ CARD DE DIVULGAÇÃO (PNG via canvas) ═══════════════════
   1080×1350 (4:5, feed) na identidade da casa: noite, framboesa + dourado,
   nome grande, GTD em destaque e a rota do ticket quando existir. */

function promoSpecFromEvent(e){
  if (!e) return null;
  const t = e.targetId ? MODEL.byId.get(e.targetId) : null;
  const sats = e.cat !== 'sat' ? MODEL.events.filter(s => s.targetId === e.id) : [];
  const cheap = sats.length ? sats.reduce((m,s) => (s.buyin ?? Infinity) < (m.buyin ?? Infinity) ? s : m, sats[0]) : null;
  return {
    nome: e.nome,
    quando: `${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} · ${fmtDateShort(e.dateISO).toUpperCase()} · ${e.hora}`,
    gtd: e.garantido, buyin: e.buyin, camp: e.camp, suit: CAT_META[e.cat].suit,
    rota: t ? `Classifique pelo satélite: ticket de ${t.buyin != null ? fmtMoneyFull(t.buyin) : 'entrada'} para ${shortName(t.nome)}`
      : e.targetGroup ? `Vale vaga em: ${e.targetGroup}`
      : cheap ? `🎟 Satélites desde ${cheap.buyin != null ? fmtMoneyFull(cheap.buyin) : '—'} (às ${cheap.hora})`
      : null,
  };
}
function promoSpecFromFuture(f){
  const when = f.dateISO
    ? `${WEEKDAY_SHORT[isoWeekdayIdx(f.dateISO)]} · ${fmtDateShort(f.dateISO).toUpperCase()}${f.hora ? ' · ' + f.hora : ''}`
    : 'EM BREVE';
  return { nome: f.nome, quando: when, gtd: f.garantido, buyin: f.buyin, camp: f.camp, suit: '✦', rota: null };
}

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, maxW){
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach(w => {
    const probe = line ? line + ' ' + w : w;
    if (ctx.measureText(probe).width > maxW && line){ lines.push(line); line = w; }
    else line = probe;
  });
  if (line) lines.push(line);
  return lines;
}

/* desenha o card e DEVOLVE o canvas — separado do preview pra permitir o modo
   em lote (Destaques do dia baixa vários sem abrir modal um a um) */
function buildPromoCanvas(spec){
  const W = 1080, H = 1350, PAD = 84;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const DISPLAY = '"SF Pro Display","Segoe UI",system-ui,sans-serif';
  const MONO = '"SF Mono","Cascadia Mono",ui-monospace,monospace';

  /* fundo: a noite da casa */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#150b0f'); bg.addColorStop(.75, '#120d12'); bg.addColorStop(1, '#0e0c10');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W*.82, -80, 60, W*.82, -80, 780);
  g.addColorStop(0, 'rgba(216,96,122,.34)'); g.addColorStop(1, 'rgba(216,96,122,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W*.08, H+60, 60, W*.08, H+60, 720);
  g.addColorStop(0, 'rgba(201,168,76,.26)'); g.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  /* naipes de fundo, quase invisíveis */
  ctx.fillStyle = 'rgba(255,255,255,.028)';
  [['♠',120,300,210],['♦',830,520,260],['♣',180,1050,230],['♥',760,1180,180]].forEach(([s,x,y,fs]) => {
    ctx.font = `${fs}px ${DISPLAY}`; ctx.fillText(s, x, y);
  });
  /* moldura fina dourada */
  ctx.strokeStyle = 'rgba(201,168,76,.34)'; ctx.lineWidth = 2;
  roundRectPath(ctx, 34, 34, W-68, H-68, 34); ctx.stroke();

  /* topo: marca */
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#c9a84c';
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.save(); ctx.translate(PAD, 132);
  ctx.fillText('♦', 0, 0);
  ctx.font = `700 27px ${DISPLAY}`;
  ctx.fillText('S U P R E M A   P O K E R', 44, -1);
  ctx.restore();

  let y = 236;
  /* pílula de campanha */
  if (spec.camp){
    const label = `✦  CAMPANHA ${CAMP_LABEL[spec.camp]}`;
    ctx.font = `700 26px ${DISPLAY}`;
    const w = ctx.measureText(label).width + 56;
    ctx.fillStyle = 'rgba(216,96,122,.16)';
    roundRectPath(ctx, PAD, y-44, w, 62, 31); ctx.fill();
    ctx.strokeStyle = 'rgba(216,96,122,.5)'; ctx.lineWidth = 2; roundRectPath(ctx, PAD, y-44, w, 62, 31); ctx.stroke();
    ctx.fillStyle = '#f4a9ba';
    ctx.fillText(label, PAD+28, y);
    y += 92;
  }

  /* nome do evento */
  ctx.fillStyle = '#f2edf0';
  ctx.font = `800 76px ${DISPLAY}`;
  const nameLines = wrapText(ctx, `${spec.suit} ${spec.nome}`, W - PAD*2);
  nameLines.slice(0, 4).forEach(l => { ctx.fillText(l, PAD, y+62); y += 88; });
  y += 26;

  /* quando */
  ctx.fillStyle = '#f4a9ba';
  ctx.font = `700 34px ${MONO}`;
  ctx.fillText(spec.quando, PAD, y+30); y += 96;

  /* GTD gigante */
  if (spec.gtd != null){
    ctx.fillStyle = 'rgba(242,237,240,.55)';
    ctx.font = `700 30px ${DISPLAY}`;
    ctx.fillText('G A R A N T I D O', PAD, y+22);
    ctx.fillStyle = '#e8c884';
    ctx.font = `800 148px ${DISPLAY}`;
    ctx.fillText(fmtMoney(spec.gtd), PAD, y+178);
    y += 254;
  }
  if (spec.buyin != null){
    ctx.fillStyle = 'rgba(242,237,240,.72)';
    ctx.font = `600 40px ${DISPLAY}`;
    ctx.fillText(`Buy-in ${fmtMoneyFull(spec.buyin)}`, PAD, y+30);
    y += 92;
  }

  /* rota do ticket */
  if (spec.rota){
    const boxY = Math.min(y+16, H-280);
    ctx.fillStyle = 'rgba(201,168,76,.10)';
    roundRectPath(ctx, PAD, boxY, W-PAD*2, 130, 24); ctx.fill();
    ctx.strokeStyle = 'rgba(201,168,76,.4)'; ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    roundRectPath(ctx, PAD, boxY, W-PAD*2, 130, 24); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e8c884';
    ctx.font = `700 32px ${DISPLAY}`;
    const rl = wrapText(ctx, `🎟 ${spec.rota}`, W - PAD*2 - 76);
    rl.slice(0, 2).forEach((l, i) => ctx.fillText(l, PAD+38, boxY+56+i*44));
  }

  /* rodapé */
  ctx.fillStyle = 'rgba(242,237,240,.42)';
  ctx.font = `600 26px ${DISPLAY}`;
  ctx.fillText('Jogue com responsabilidade · app Suprema Poker', PAD, H-84);
  return cv;
}
function makePromoCard(spec){
  if (!spec) return;
  /* ANTES baixava direto: se o nome cortava em 4 linhas ou a rota não cabia, a
     pessoa só descobria abrindo o PNG na pasta — e refazia. Agora ABRE UM
     PREVIEW: vê o card, baixa OU copia pra área de transferência (colar direto
     no chat sem passar por arquivo). */
  const cv = buildPromoCanvas(spec);
  const slug = normText(spec.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'evento';
  showPromoPreview(cv, `suprema-${slug}.png`);
}

/* modal de preview do card — <dialog> nativo (escapa do overflow, fecha no ESC,
   trap de foco de graça) */
function showPromoPreview(cv, filename){
  let dlg = document.getElementById('promoDlg');
  if (!dlg){
    dlg = document.createElement('dialog');
    dlg.id = 'promoDlg';
    dlg.innerHTML = `
      <div class="promo-preview">
        <img id="promoImg" alt="Prévia do card de divulgação">
        <div class="promo-actions">
          <button class="btn-sm gold" data-promo-dl>⬇ Baixar PNG</button>
          <button class="btn-sm" data-promo-copy>📋 Copiar imagem</button>
          <button class="btn-sm ghost" data-promo-close>Fechar</button>
        </div>
        <p class="promo-hint">Confira o corte do nome e a rota antes de publicar. Copiar cola direto no chat, sem baixar.</p>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {          // clicar no backdrop fecha
      if (e.target === dlg) dlg.close();
    });
    dlg.querySelector('[data-promo-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-promo-dl]').addEventListener('click', () => {
      const a = document.createElement('a');
      a.download = dlg._filename;
      a.href = dlg._canvas.toDataURL('image/png');
      a.click();
      toast('Card baixado 🖼');
    });
    dlg.querySelector('[data-promo-copy]').addEventListener('click', async () => {
      try{
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write)
          throw new Error('sem suporte a copiar imagem');
        const blob = await new Promise(res => dlg._canvas.toBlob(res, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Imagem copiada — cole no chat ✓');
      }catch(err){
        console.warn('[Radar] copiar imagem falhou', err);
        toast('Seu navegador não deixa copiar imagem — use Baixar', true);
      }
    });
  }
  dlg._canvas = cv;
  dlg._filename = filename;
  dlg.querySelector('#promoImg').src = cv.toDataURL('image/png');
  dlg.showModal();
}

/* ═══════════════════ chrome: relógio, tema, operador ═══════════════════ */
function tickClock(){
  const n = spNow();
  const el = document.getElementById('navTime');
  if (el) el.textContent =
    `${String(Math.floor(n.minutes/60)).padStart(2,'0')}:${String(n.minutes%60).padStart(2,'0')}:${String(n.seconds).padStart(2,'0')}`;
}
setInterval(tickClock, 1000); tickClock();
/* status "AO VIVO"/divisor AGORA acompanham o relógio — patch cirúrgico por
   minuto (renderAgenda() aqui reconstruía a lista e derrubava a rota aberta) */
setInterval(() => { if (MODEL){ renderHero(); refreshAgendaStatus(); attachLiveDay(); } }, 60000);

(function themeAndUser(){
  const html = document.documentElement;
  const apply = dark => { html.classList.toggle('dark', dark); document.getElementById('darkToggle').textContent = dark ? '🌙' : '☀️'; };
  apply(SupremaAuth.wireThemeSync(apply));
  document.getElementById('darkToggle').addEventListener('click', () => {
    const dark = !html.classList.contains('dark');
    SupremaAuth.setThemePref(dark); apply(dark);
  });
  const s = SupremaAuth.getSession && SupremaAuth.getSession();
  const name = (s && (s.name || s.email)) || '—';
  document.getElementById('opName').textContent = String(name).split('@')[0];
  document.getElementById('opAvatar').textContent = String(name).trim().charAt(0).toUpperCase() || '?';
})();

/* ═══════════════════ boot ═══════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  readStateFromURL();
  wireFilters();
  syncFilterUI();
  initData();
});

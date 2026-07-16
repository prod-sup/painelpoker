/* =========================================================================
   RADAR DE EVENTOS — a vitrine da grade pro Marketing e pro Atendimento.

   O QUE É
   -------
   Uma visão SEMANAL da Global MTT (aba "MTTS BRAZIL"): o que está rolando
   agora, o que vem ao longo da semana e os eventos futuros (a seção
   "EVENTOS FUTUROS"/P&D depois de domingo). Ninguém aqui edita nada — é
   leitura pura, bonita e filtrável (campanha #AS/+SPS/+SPT, categoria).

   DE ONDE VÊM OS DADOS
   --------------------
   Do arquivo Global compartilhado que a operação já sobe no Painel do Dia
   (painel/globalMtt, base64 no Firebase via SupremaDB). Um operador sobe,
   o Marketing vê — sem planilha por e-mail. Há também um fallback local
   ("ler minha Global") que parseia no navegador sem publicar nada.

   A CONSTELAÇÃO (ref. MotionSites "Network Hero")
   -----------------------------------------------
   Satélites premiam TICKET pro torneio-alvo. O vínculo é inferido por
   heurística de nome (tokens do nome do satélite + cabeçalho do grupo na
   coluna A vs. nomes dos Main/Side do dia e da semana) e desenhado como um
   grafo: nós conectados por curvas, com o ticket (valor = buy-in do alvo)
   pendurado no meio da linha. Hover/clique dá spotlight no caminho.

   Depende de: gu-parser.js (normText, cellToHHMM, timeToMinutes,
   readSheetMatrix, isFutureSectionLabel, WEEKDAYS_PT), suprema-db.js,
   suprema-auth.js, suprema-motion.js, ensureXLSX (suprema-xlsx.js).
========================================================================= */
'use strict';

/* ═══════════════════ utilidades ═══════════════════ */

function escHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const NF_INT = new Intl.NumberFormat('pt-BR');
function fmtMoney(v){
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1000000) return 'R$ ' + (v/1000000).toLocaleString('pt-BR', {maximumFractionDigits:1}) + ' mi';
  if (v >= 1000)    return 'R$ ' + (v/1000).toLocaleString('pt-BR', {maximumFractionDigits:v%1000?1:0}) + ' mil';
  return 'R$ ' + v.toLocaleString('pt-BR', {maximumFractionDigits:2});
}
function fmtMoneyFull(v){
  if (v == null || !isFinite(v)) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', {maximumFractionDigits:2});
}

/* ── relógio de São Paulo (a grade vive nesse fuso) ── */
const SP_FMT = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo', hour12:false,
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'});
function spNow(){
  const parts = {};
  SP_FMT.formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { iso, minutes: (parseInt(parts.hour,10)%24)*60 + parseInt(parts.minute,10), seconds: parseInt(parts.second,10) };
}
function isoAddDays(iso, n){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d + n));
  return dt.toISOString().slice(0,10);
}
function isoDayNumber(iso){ const [y,m,d] = iso.split('-').map(Number); return Date.UTC(y, m-1, d) / 86400000; }
/* minuto absoluto (dias desde epoch × 1440 + minuto do dia) — permite comparar
   horários entre dias sem aritmética de fuso */
function absMin(iso, minutes){ return isoDayNumber(iso) * 1440 + minutes; }
function isoWeekdayIdx(iso){ const [y,m,d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)).getUTCDay(); } // 0=domingo
const MONTHS_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const WEEKDAY_SHORT = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
function fmtDateShort(iso){ const [,m,d] = iso.split('-').map(Number); return `${d} ${MONTHS_PT[m-1]}`; }

/* grade operacional: o dia vira às 05:30 — antes disso ainda é "ontem" */
const GRADE_FLIP_MIN = 5*60 + 30;
function gradeTodayISO(){
  const now = spNow();
  return now.minutes < GRADE_FLIP_MIN ? isoAddDays(now.iso, -1) : now.iso;
}

/* ── campanhas — mesmo radar do Painel do Dia (#AS / SPS / SPT no nome) ── */
function campOf(nome){
  const n = String(nome||'').toUpperCase();
  if (n.includes('#AS')) return 'AS';
  if (n.includes('SPS')) return 'SPS';
  if (n.includes('SPT')) return 'SPT';
  return null;
}
const CAMP_LABEL = { AS:'#AS', SPS:'+SPS', SPT:'+SPT' };
const CAT_META = {
  main: { label:'Main Event', suit:'♠', cls:'c-main' },
  side: { label:'Side Event', suit:'♣', cls:'c-side' },
  sat:  { label:'Satélite',   suit:'♦', cls:'c-sat'  },
};

/* ═══════════════════ parser semanal da Global (MTTS BRAZIL) ═══════════════════
   Mesmas regras do extrator do Painel do Dia (coluna A decorativa, horário
   mesclado herdado, "suspenso" pulado, tipo por radical), mas varrendo a
   SEMANA INTEIRA de uma vez e coletando os EVENTOS FUTUROS (linhas com data
   na coluna A / depois do rótulo "EVENTOS FUTUROS"/P&D) em vez de descartá-los. */

function excelSerialToISO(v){
  if (v instanceof Date) return v.toISOString().slice(0,10);
  if (typeof v === 'number' && v > 40000 && v < 60000)
    return new Date(Date.UTC(1899,11,30) + Math.round(v)*86400000).toISOString().slice(0,10);
  if (typeof v === 'string'){
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const br = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (br){
      const y = br[3].length === 2 ? '20'+br[3] : br[3];
      return `${y}-${String(br[2]).padStart(2,'0')}-${String(br[1]).padStart(2,'0')}`;
    }
  }
  return null;
}

function parseGlobalWeek(matrix){
  const days = {};                    // 'SEGUNDA-FEIRA' → {main:[], side:[], sat:[]}
  const futures = [];
  const weekdayNames = allWeekdayNamesNorm();
  let currentDay = null;              // nome PT do dia da seção atual
  let currentGroupHeader = null;
  let lastHora = null;
  let futureMode = false;             // depois do rótulo EVENTOS FUTUROS/P&D

  const ptFromAny = (name) => {
    const n = normText(name);
    let i = WEEKDAYS_PT.findIndex(w => normText(w) === n);
    if (i === -1) i = WEEKDAYS_EN.findIndex(w => normText(w) === n);
    return i === -1 ? null : WEEKDAYS_PT[i];
  };

  for (let i = 0; i < matrix.length; i++){
    const row = matrix[i];
    if (!row || row.every(v => v === null || v === undefined || v === '' || v === ' ')){
      currentGroupHeader = null; lastHora = null; continue;
    }
    const colA = row[0];
    let hora = cellToHHMM(row[1]);
    const nome = row[2];
    const tipo = row[3];
    const garantidoRaw = row[6];
    const buyinRaw = row[7];
    const lateHH = cellToHHMM(row[17]);

    /* cabeçalho de dia: o nome do dia na PRÓPRIA coluna do nome (col C) */
    if (typeof nome === 'string' && weekdayNames.includes(normText(nome))){
      currentDay = ptFromAny(nome);
      if (currentDay && !days[currentDay]) days[currentDay] = { main:[], side:[], sat:[] };
      currentGroupHeader = null; lastHora = null; futureMode = false;
      continue;
    }

    /* rótulo EVENTOS FUTUROS / P&D → daqui pra baixo (até o próximo dia) é futuro */
    if (isFutureSectionLabel(colA) || isFutureSectionLabel(nome)){ futureMode = true; currentGroupHeader = null; continue; }

    /* linha com DATA na coluna A = evento futuro datado (o rodapé da Global) */
    const futISO = excelSerialToISO(colA);
    if (futISO || futureMode){
      if (typeof nome === 'string' && nome.trim() && !weekdayNames.includes(normText(nome))){
        futures.push({
          dateISO: futISO,                     // pode ser null (futuro sem data explícita)
          nome: nome.trim(),
          hora: hora,
          tipo: typeof tipo === 'string' ? tipo.trim() : null,
          garantido: typeof garantidoRaw === 'number' ? Math.round(garantidoRaw*100)/100 : null,
          buyin: typeof buyinRaw === 'number' ? Math.round(buyinRaw*100)/100 : null,
        });
      }
      continue;
    }

    if (!currentDay) continue;
    const bucket = days[currentDay];

    /* coluna A textual que não é dia = cabeçalho de grupo de satélite */
    if (typeof colA === 'string' && colA.trim() && !weekdayNames.includes(normText(colA))){
      currentGroupHeader = colA.trim();
    }
    if (!nome || typeof nome !== 'string') continue;
    if (['SÁBADO','DOMINGO','SATÉLITE','SATELLITE'].includes(nome.trim().toUpperCase())) continue;
    if (normText(nome) === 'suspenso') continue;
    if (!hora && lastHora) hora = lastHora;
    else if (hora) lastHora = hora;
    if (!hora) continue;

    const entry = {
      nome: nome.trim(), hora,
      garantido: typeof garantidoRaw === 'number' ? Math.round(garantidoRaw*100)/100 : null,
      buyin: typeof buyinRaw === 'number' ? Math.round(buyinRaw*100)/100 : null,
      late: lateHH || null,
      groupHeader: currentGroupHeader,
    };
    const tipoNorm = normText(tipo);
    if (tipoNorm.includes('main')) bucket.main.push(entry);
    else if (tipoNorm.includes('side')) bucket.side.push(entry);
    else if (tipoNorm.includes('sat')) bucket.sat.push(entry);
    /* tipo desconhecido: pro Marketing tratamos como side (não some da vitrine) */
    else if (tipoNorm) bucket.side.push(entry);
  }
  return { days, futures };
}

/* ═══════════════════ modelo: datas, status e vínculos ═══════════════════ */

/* semana Mon→Sun contendo o dia da GRADE de hoje */
function weekDates(){
  const today = gradeTodayISO();
  const dow = isoWeekdayIdx(today);                 // 0=dom
  const monday = isoAddDays(today, -((dow + 6) % 7));
  const map = {};                                    // 'SEGUNDA-FEIRA' → iso
  for (let i = 0; i < 7; i++){
    const iso = isoAddDays(monday, i);
    map[WEEKDAYS_PT[isoWeekdayIdx(iso)]] = iso;
  }
  return map;
}

/* palavras que não identificam um alvo (sat/mega/ticket/etc.) */
const LINK_STOP = new Set(['sat','sats','satelite','satelites','satellite','mega','super','hyper','turbo',
  'ticket','tickets','tkt','seat','seats','step','freeroll','qualifier','ao','de','do','da','das','dos',
  'em','no','na','the','to','for','pra','para','gtd','garantido','evento','event','edicao','edition',
  'as','sps','spt','com','sem','max','and','e']);
function linkTokens(s){
  return normText(s).replace(/[^a-z0-9]+/g,' ').split(/\s+/)
    .filter(t => t.length >= 2 && !LINK_STOP.has(t) && !/^\d{1,2}h$/.test(t));
}
function nameHour(s){
  const m = String(s||'').toUpperCase().match(/(\d{1,2})\s*H(?:S|RS)?\b/);
  return m ? parseInt(m[1],10) : null;
}

/* liga cada satélite ao torneio-alvo mais provável (mesmo dia primeiro, depois
   o resto da semana pra frente). Score por sobreposição de tokens do nome do
   sat + cabeçalho do grupo vs. o nome do alvo; bônus por hora citada no nome. */
function linkSatellites(events){
  const targets = events.filter(e => e.cat !== 'sat');
  events.filter(e => e.cat === 'sat').forEach(sat => {
    const satToks = new Set([...linkTokens(sat.nome), ...linkTokens(sat.groupHeader || '')]);
    const satHour = nameHour(sat.nome) ?? nameHour(sat.groupHeader || '');
    let best = null, bestScore = 0;
    targets.forEach(t => {
      if (t.abs <= sat.abs) return;                 // alvo tem que começar DEPOIS do satélite
      let score = 0;
      const tToks = linkTokens(t.nome);
      tToks.forEach(tok => { if (satToks.has(tok)) score += Math.min(4, tok.length); });
      if (satHour != null && timeToMinutes(t.hora) != null &&
          Math.floor(timeToMinutes(t.hora)/60) === satHour) score += 3;
      if (t.dateISO === sat.dateISO) score += 1.5;   // leve preferência pelo mesmo dia
      if (t.cat === 'main') score += 0.5;
      if (score > bestScore){ bestScore = score; best = t; }
    });
    if (best && bestScore >= 4){
      sat.targetId = best.id;
      best.satCount = (best.satCount || 0) + 1;
    }
  });
}

function buildModel(parsed){
  const dates = weekDates();
  const events = [];
  let seq = 0;
  Object.keys(parsed.days).forEach(day => {
    const iso = dates[day];
    if (!iso) return;
    ['main','side','sat'].forEach(cat => {
      parsed.days[day][cat].forEach(e => {
        const m = timeToMinutes(e.hora);
        if (m == null) return;
        events.push({
          ...e, id: 'ev' + (seq++), cat, weekday: day, dateISO: iso,
          startMin: m, abs: absMin(iso, m), camp: campOf(e.nome),
          satCount: 0, targetId: null,
        });
      });
    });
  });
  events.sort((a,b) => a.abs - b.abs);
  linkSatellites(events);

  const futures = parsed.futures
    .map(f => ({ ...f, camp: campOf(f.nome) }))
    .filter((f, i, arr) => arr.findIndex(x => x.nome === f.nome && x.dateISO === f.dateISO) === i)
    .sort((a,b) => String(a.dateISO||'9999').localeCompare(String(b.dateISO||'9999')));
  return { events, futures, dates };
}

function statusOf(ev){
  const now = spNow();
  const n = absMin(now.iso, now.minutes);
  let lateAbs = ev.late != null && timeToMinutes(ev.late) != null
    ? absMin(ev.dateISO, timeToMinutes(ev.late)) : ev.abs + 90;
  if (lateAbs < ev.abs) lateAbs += 1440;             // late que cruza a meia-noite
  if (n >= ev.abs && n <= lateAbs) return { k:'live', left: lateAbs - n };
  if (n < ev.abs){
    const inMin = ev.abs - n;
    return { k: inMin <= 120 ? 'soon' : 'upcoming', inMin };
  }
  return { k:'past' };
}

/* ═══════════════════ estado + dados ═══════════════════ */

let MODEL = null;                                    // {events, futures, dates}
let META = null;                                     // {filename, at, by}
const state = { camp:'all', cat:'all', q:'', day:null };

let _lastAt = null;
function initData(){
  if (!window.SupremaDB || !SupremaDB.init()){ setTimeout(initData, 300); return; }
  SupremaDB.watch('painel/globalMtt/at', snap => {
    const at = snap.val();
    if (!at || `${at}` === `${_lastAt}`) return;
    _lastAt = `${at}`;
    loadSharedGlobal();
  });
  setSync(true);
  SupremaDB.onConnection(ok => setSync(ok));
}

function b64ToBuf(b64){
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function loadSharedGlobal(){
  try{
    const v = await SupremaDB.getValue('painel/globalMtt');
    if (!v || !v.data){ showEmpty(); return; }
    META = { filename: v.filename || 'Global MTT.xlsx', at: v.at || 0, by: v.by || 'alguém' };
    await ensureXLSX();
    const matrix = readSheetMatrix(b64ToBuf(v.data), 'MTTS BRAZIL');
    applyMatrix(matrix);
  }catch(err){
    console.error('Radar: falha ao carregar a Global compartilhada', err);
    showEmpty();
  }
}

function applyMatrix(matrix){
  if (!matrix){ showEmpty(); return; }
  MODEL = buildModel(parseGlobalWeek(matrix));
  if (!MODEL.events.length && !MODEL.futures.length){ showEmpty(); return; }
  if (!state.day) state.day = WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  document.getElementById('loading').hidden = true;
  document.getElementById('emptyState').hidden = true;
  document.getElementById('content').hidden = false;
  renderAll();
}

/* fallback: ler um arquivo local sem publicar nada */
document.getElementById('localFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try{
    await ensureXLSX();
    const matrix = readSheetMatrix(await file.arrayBuffer(), 'MTTS BRAZIL');
    if (!matrix) throw new Error('aba "MTTS BRAZIL" não encontrada');
    META = { filename: file.name, at: Date.now(), by: 'você (arquivo local)' };
    applyMatrix(matrix);
  }catch(err){ alert('Não consegui ler essa planilha: ' + err.message); }
  e.target.value = '';
});
document.querySelectorAll('[data-local-upload]').forEach(b =>
  b.addEventListener('click', () => document.getElementById('localFile').click()));

function showEmpty(){
  document.getElementById('loading').hidden = true;
  if (!MODEL){ document.getElementById('emptyState').hidden = false; }
}

function setSync(ok){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.classList.toggle('off', !ok);
  el.querySelector('.sync-label').textContent = ok ? 'Ao vivo' : 'Reconectando…';
}

/* ═══════════════════ filtros ═══════════════════ */

function matches(ev){
  if (state.camp === 'none' && ev.camp) return false;
  if (state.camp !== 'all' && state.camp !== 'none' && ev.camp !== state.camp) return false;
  if (state.cat !== 'all' && ev.cat !== state.cat) return false;
  if (state.q && !normText(ev.nome).includes(normText(state.q))) return false;
  return true;
}

function wireFilters(){
  document.querySelectorAll('#campChips .chip').forEach(ch => ch.addEventListener('click', () => {
    state.camp = ch.dataset.camp;
    document.querySelectorAll('#campChips .chip').forEach(c => c.classList.toggle('on', c === ch));
    renderAll();
  }));
  document.querySelectorAll('#catChips .chip').forEach(ch => ch.addEventListener('click', () => {
    state.cat = ch.dataset.cat;
    document.querySelectorAll('#catChips .chip').forEach(c => c.classList.toggle('on', c === ch));
    renderAll();
  }));
  let qTimer = null;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderAll(); }, 180);
  });
}

/* ═══════════════════ render ═══════════════════ */

function campBadge(ev){
  return ev.camp ? `<span class="badge b-camp"><span class="spark">✦</span>${CAMP_LABEL[ev.camp]}</span>` : '';
}
function catBadge(cat){
  const m = CAT_META[cat];
  return `<span class="badge b-cat ${m.cls}"><span class="suit">${m.suit}</span>${m.label}</span>`;
}

function renderAll(){
  if (!MODEL) return;
  renderMeta();
  renderHero();
  renderNow();
  renderWeek();
  renderDayPills();
  renderGraph();
  renderFutures();
  /* motion nos elementos recém-criados */
  SupremaMotion.glow('.ev-card, .fut-card, .node');
  SupremaMotion.reveal('.ev-card, .fut-card, .day-block');
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
  const today = WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  const live = evs.filter(e => statusOf(e).k === 'live').length;
  const hoje = evs.filter(e => e.weekday === today).length;
  const gtdWeek = evs.reduce((s,e) => s + (e.garantido || 0), 0);
  const els = { statLive: live, statToday: hoje, statFut: MODEL.futures.length };
  Object.keys(els).forEach(id => { document.getElementById(id).textContent = NF_INT.format(els[id]); });
  document.getElementById('statGtd').textContent = fmtMoney(gtdWeek);
  document.getElementById('liveDot').classList.toggle('has-live', live > 0);
  if (!renderHero._counted){ renderHero._counted = true; SupremaMotion.countUp('#statLive, #statToday, #statFut'); }
}

/* ── AGORA: rolando + começa em breve ── */
function renderNow(){
  const wrap = document.getElementById('nowGrid');
  const rows = MODEL.events.filter(matches).map(e => ({ e, st: statusOf(e) }))
    .filter(x => x.st.k === 'live' || x.st.k === 'soon')
    .sort((a,b) => (a.st.k === 'live' ? 0 : 1) - (b.st.k === 'live' ? 0 : 1) || a.e.abs - b.e.abs);
  document.getElementById('nowEmpty').hidden = rows.length > 0;
  wrap.innerHTML = rows.map(({e, st}) => {
    const target = e.targetId ? MODEL.events.find(t => t.id === e.targetId) : null;
    const stHtml = st.k === 'live'
      ? `<span class="live-tag"><span class="pulse"></span>EM ANDAMENTO${e.late ? ` · late até ${e.late}` : ''}</span>`
      : `<span class="soon-tag">começa em ${st.inMin >= 60 ? Math.floor(st.inMin/60)+'h'+String(st.inMin%60).padStart(2,'0') : st.inMin + ' min'}</span>`;
    return `<article class="ev-card ${st.k}" data-id="${e.id}">
      <div class="ev-top">${stHtml}<span class="ev-hora">${e.hora}</span></div>
      <h3 class="ev-nome">${escHtml(e.nome)}</h3>
      <div class="ev-badges">${catBadge(e.cat)}${campBadge(e)}</div>
      <div class="ev-nums">
        ${e.garantido != null ? `<div class="num"><span class="k">GTD</span><span class="v">${fmtMoney(e.garantido)}</span></div>` : ''}
        ${e.buyin != null ? `<div class="num"><span class="k">Buy-in</span><span class="v">${fmtMoneyFull(e.buyin)}</span></div>` : ''}
      </div>
      ${target ? ticketStrip(target) : (e.cat !== 'sat' && e.satCount ? feederStrip(e) : '')}
    </article>`;
  }).join('');
  wireCardClicks(wrap);
}

function ticketStrip(target){
  return `<div class="ticket-strip" title="Este satélite premia ticket para ${escHtml(target.nome)}">
    <span class="tk"><svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"/><path d="M15 6v12"/></svg>
    Ticket ${target.buyin != null ? fmtMoneyFull(target.buyin) : ''}</span>
    <span class="arrow">→</span>
    <span class="tgt">${escHtml(target.nome)} <small>${WEEKDAY_SHORT[isoWeekdayIdx(target.dateISO)]} ${target.hora}</small></span>
  </div>`;
}
function feederStrip(ev){
  return `<div class="ticket-strip in" title="Satélites que premiam ticket para este evento">
    <span class="tk"><svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"/><path d="M15 6v12"/></svg>
    ${ev.satCount} satélite${ev.satCount > 1 ? 's' : ''} classificam</span></div>`;
}

/* ── SEMANA: um bloco por dia, strip horizontal ── */
const WEEK_ORDER = ['SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA','QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO','DOMINGO'];
function renderWeek(){
  const wrap = document.getElementById('weekWrap');
  const today = WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  const nowAbs = (() => { const n = spNow(); return absMin(n.iso, n.minutes); })();
  wrap.innerHTML = WEEK_ORDER.map(day => {
    const iso = MODEL.dates[day];
    const evs = MODEL.events.filter(e => e.weekday === day && matches(e));
    if (!evs.length) return '';
    const gtd = evs.reduce((s,e) => s + (e.garantido || 0), 0);
    const isPast = evs.every(e => statusOf(e).k === 'past');
    const isToday = day === today;
    return `<section class="day-block ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}" id="day-${day}">
      <header class="day-head">
        <div class="day-name">${day.replace('-FEIRA','')}${isToday ? '<span class="today-tag">HOJE</span>' : ''}</div>
        <div class="day-sub">${fmtDateShort(iso)} · ${evs.length} evento${evs.length > 1 ? 's' : ''} · <b>${fmtMoney(gtd)}</b> GTD</div>
      </header>
      <div class="day-strip">${evs.map(e => {
        const st = statusOf(e);
        const target = e.targetId ? MODEL.events.find(t => t.id === e.targetId) : null;
        return `<article class="ev-card mini ${st.k} ${CAT_META[e.cat].cls}" data-id="${e.id}" data-day="${e.weekday}">
          <div class="ev-top"><span class="ev-hora">${e.hora}</span>${st.k === 'live' ? '<span class="live-tag"><span class="pulse"></span>AO VIVO</span>' : ''}</div>
          <h4 class="ev-nome">${escHtml(e.nome)}</h4>
          <div class="ev-badges">${catBadge(e.cat)}${campBadge(e)}</div>
          <div class="ev-nums">
            ${e.garantido != null ? `<div class="num"><span class="k">GTD</span><span class="v">${fmtMoney(e.garantido)}</span></div>` : ''}
            ${e.buyin != null ? `<div class="num"><span class="k">Buy-in</span><span class="v">${fmtMoneyFull(e.buyin)}</span></div>` : ''}
          </div>
          ${target ? `<div class="mini-ticket">🎟 → ${escHtml(target.nome)}</div>` :
            (e.satCount ? `<div class="mini-ticket in">🎟 ${e.satCount} sat${e.satCount > 1 ? 's' : ''} classificam</div>` : '')}
        </article>`;
      }).join('')}</div>
    </section>`;
  }).join('') || '<p class="section-empty">Nenhum evento passa nos filtros atuais.</p>';
  wireCardClicks(wrap);
}

/* clicar num card leva pra constelação do dia com o nó em spotlight */
function wireCardClicks(root){
  root.querySelectorAll('.ev-card[data-id]').forEach(card => card.addEventListener('click', () => {
    const ev = MODEL.events.find(e => e.id === card.dataset.id);
    if (!ev) return;
    state.day = ev.weekday;
    renderDayPills();
    renderGraph(ev.id);
    document.getElementById('graphSection').scrollIntoView({ behavior:'smooth', block:'start' });
  }));
}

/* ── pills de dia (controlam a constelação) ── */
function renderDayPills(){
  const wrap = document.getElementById('dayPills');
  const today = WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  wrap.innerHTML = WEEK_ORDER.map(day => {
    const n = MODEL.events.filter(e => e.weekday === day).length;
    return `<button class="pill ${day === state.day ? 'on' : ''}" data-day="${day}" ${n ? '' : 'disabled'}>
      ${WEEKDAY_SHORT[isoWeekdayIdx(MODEL.dates[day])]}${day === today ? '<i class="dot"></i>' : ''}</button>`;
  }).join('');
  wrap.querySelectorAll('.pill').forEach(p => p.addEventListener('click', () => {
    state.day = p.dataset.day;
    renderDayPills();
    renderGraph();
  }));
}

/* ── CONSTELAÇÃO: satélites → alvos com curvas e ticket no meio ── */
function renderGraph(focusId){
  const stage = document.getElementById('graphStage');
  const day = state.day;
  const sats = MODEL.events.filter(e => e.weekday === day && e.cat === 'sat' && matches(e));
  const targetIds = new Set(sats.map(s => s.targetId).filter(Boolean));
  /* alvos: os do dia (main/side) + alvos de outros dias referenciados pelos sats */
  const targets = MODEL.events.filter(e =>
    e.cat !== 'sat' && (targetIds.has(e.id) || (e.weekday === day && matches(e))));
  /* ordena alvos por hora; sats agrupados na ordem dos alvos (linhas curtas) */
  targets.sort((a,b) => a.abs - b.abs);
  const order = new Map(targets.map((t,i) => [t.id, i]));
  sats.sort((a,b) => (order.get(a.targetId) ?? 99) - (order.get(b.targetId) ?? 99) || a.abs - b.abs);

  document.getElementById('graphEmpty').hidden = sats.length + targets.length > 0;
  stage.innerHTML = `
    <svg id="graphSvg" aria-hidden="true"></svg>
    <div class="g-col g-sats">
      <div class="g-col-label">♦ Satélites — o caminho barato</div>
      ${sats.map(s => nodeHtml(s, 'sat')).join('') || '<p class="g-none">Sem satélites neste dia.</p>'}
    </div>
    <div class="g-col g-targets">
      <div class="g-col-label">♠ Torneios-alvo — onde o ticket entra</div>
      ${targets.map(t => nodeHtml(t, 'target')).join('') || '<p class="g-none">Sem Main/Side neste dia.</p>'}
    </div>
    <div id="ticketChips"></div>`;
  requestAnimationFrame(() => drawGraphLines(sats, targets, focusId));

  stage.querySelectorAll('.node').forEach(node => {
    node.addEventListener('mouseenter', () => spotlight(node.dataset.id, true));
    node.addEventListener('mouseleave', () => spotlight(null, false));
    node.addEventListener('click', () => spotlight(node.dataset.id, true, true));
  });
  if (focusId) spotlight(focusId, true, true);
}

function nodeHtml(e, kind){
  const st = statusOf(e);
  const otherDay = e.weekday !== state.day ? `<span class="badge b-day">${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]}</span>` : '';
  return `<article class="node n-${kind} ${CAT_META[e.cat].cls} ${st.k} ${(!e.targetId && kind === 'sat') ? 'unlinked' : ''}" data-id="${e.id}">
    <div class="ev-top"><span class="ev-hora">${e.hora}</span>${st.k === 'live' ? '<span class="live-tag"><span class="pulse"></span>AO VIVO</span>' : ''}${otherDay}</div>
    <h4 class="ev-nome">${escHtml(e.nome)}</h4>
    <div class="ev-badges">${catBadge(e.cat)}${campBadge(e)}</div>
    <div class="ev-nums">
      ${e.garantido != null ? `<div class="num"><span class="k">GTD</span><span class="v">${fmtMoney(e.garantido)}</span></div>` : ''}
      ${e.buyin != null ? `<div class="num"><span class="k">Buy-in</span><span class="v">${fmtMoneyFull(e.buyin)}</span></div>` : ''}
    </div>
    ${kind === 'sat' && !e.targetId ? '<div class="mini-ticket dim">🎟 alvo a confirmar</div>' : ''}
    ${kind === 'target' && e.satCount ? `<div class="mini-ticket in">🎟 ${e.satCount} caminho${e.satCount > 1 ? 's' : ''} de satélite</div>` : ''}
  </article>`;
}

let GRAPH_LINKS = [];
function drawGraphLines(sats, targets, focusId){
  const stage = document.getElementById('graphStage');
  const svg = document.getElementById('graphSvg');
  const chips = document.getElementById('ticketChips');
  if (!stage || !svg) return;
  const sr = stage.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${sr.width} ${stage.scrollHeight}`);
  svg.setAttribute('width', sr.width); svg.setAttribute('height', stage.scrollHeight);
  GRAPH_LINKS = [];
  let paths = '', chipHtml = '';
  sats.forEach(s => {
    if (!s.targetId) return;
    const a = stage.querySelector(`.node[data-id="${s.id}"]`);
    const b = stage.querySelector(`.node[data-id="${s.targetId}"]`);
    if (!a || !b) return;
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    const x1 = ar.right - sr.left, y1 = ar.top - sr.top + ar.height/2 + stage.scrollTop;
    const x2 = br.left - sr.left,  y2 = br.top - sr.top + br.height/2 + stage.scrollTop;
    const mx = (x1 + x2) / 2;
    const target = MODEL.events.find(t => t.id === s.targetId);
    paths += `<path class="g-link" data-sat="${s.id}" data-target="${s.targetId}"
      d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
    chipHtml += `<span class="ticket-chip" data-sat="${s.id}" data-target="${s.targetId}"
      style="left:${mx}px;top:${(y1+y2)/2}px"
      title="${escHtml(s.nome)} premia ticket de ${target && target.buyin != null ? fmtMoneyFull(target.buyin) : 'entrada'} para ${escHtml(target ? target.nome : '')}">
      🎟${target && target.buyin != null ? ' ' + fmtMoney(target.buyin) : ''}</span>`;
    GRAPH_LINKS.push({ sat: s.id, target: s.targetId });
  });
  svg.innerHTML = paths;
  chips.innerHTML = chipHtml;
  if (focusId) spotlight(focusId, true, true);
}

let _pinned = null;
function spotlight(id, on, pin){
  const stage = document.getElementById('graphStage');
  if (!stage) return;
  if (pin) _pinned = (_pinned === id) ? null : id;
  const active = on ? id : _pinned;
  stage.classList.toggle('focusing', !!active);
  if (!active){
    stage.querySelectorAll('.on').forEach(el => el.classList.remove('on'));
    return;
  }
  const related = new Set([active]);
  GRAPH_LINKS.forEach(l => {
    if (l.sat === active) related.add(l.target);
    if (l.target === active) related.add(l.sat);
  });
  stage.querySelectorAll('.node').forEach(n => n.classList.toggle('on', related.has(n.dataset.id)));
  stage.querySelectorAll('.g-link, .ticket-chip').forEach(el =>
    el.classList.toggle('on', el.dataset.sat === active || el.dataset.target === active));
}

let _graphResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_graphResizeTimer);
  _graphResizeTimer = setTimeout(() => { if (MODEL) renderGraph(); }, 200);
});

/* ── FUTUROS (P&D depois de domingo) ── */
function renderFutures(){
  const wrap = document.getElementById('futGrid');
  const today = gradeTodayISO();
  const futs = MODEL.futures.filter(f => {
    if (state.camp === 'none' && f.camp) return false;
    if (state.camp !== 'all' && state.camp !== 'none' && f.camp !== state.camp) return false;
    if (state.q && !normText(f.nome).includes(normText(state.q))) return false;
    return true;
  });
  document.getElementById('futEmpty').hidden = futs.length > 0;
  wrap.innerHTML = futs.map(f => {
    const days = f.dateISO ? isoDayNumber(f.dateISO) - isoDayNumber(today) : null;
    const when = days == null ? 'data a definir'
      : days <= 0 ? 'é hoje!' : days === 1 ? 'amanhã' : `em ${days} dias`;
    const [ , m, d ] = (f.dateISO || '----------').split('-');
    return `<article class="fut-card">
      <div class="fut-date">
        ${f.dateISO ? `<span class="d">${+d}</span><span class="m">${MONTHS_PT[+m-1]}</span>` : '<span class="d">?</span>'}
        <span class="count">${when}</span>
      </div>
      <div class="fut-body">
        <h3 class="ev-nome">${escHtml(f.nome)}</h3>
        <div class="ev-badges">
          ${f.tipo ? `<span class="badge b-cat">${escHtml(f.tipo)}</span>` : ''}
          ${f.camp ? `<span class="badge b-camp"><span class="spark">✦</span>${CAMP_LABEL[f.camp]}</span>` : ''}
          ${f.hora ? `<span class="badge b-hora">${f.hora}</span>` : ''}
        </div>
        <div class="ev-nums">
          ${f.garantido != null ? `<div class="num"><span class="k">GTD</span><span class="v big">${fmtMoney(f.garantido)}</span></div>` : ''}
          ${f.buyin != null ? `<div class="num"><span class="k">Buy-in</span><span class="v">${fmtMoneyFull(f.buyin)}</span></div>` : ''}
        </div>
      </div>
    </article>`;
  }).join('');
  SupremaMotion.tilt('.fut-card', { max: 4 });
}

/* ═══════════════════ chrome: relógio, tema, operador ═══════════════════ */
function tickClock(){
  const n = spNow();
  const el = document.getElementById('navTime');
  if (el) el.textContent =
    `${String(Math.floor(n.minutes/60)).padStart(2,'0')}:${String(n.minutes%60).padStart(2,'0')}:${String(n.seconds).padStart(2,'0')}`;
  /* status "AO VIVO" muda com o relógio — re-render leve por minuto */
}
setInterval(tickClock, 1000); tickClock();
setInterval(() => { if (MODEL){ renderHero(); renderNow(); } }, 60000);

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
  wireFilters();
  initData();
});

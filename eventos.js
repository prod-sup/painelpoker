/* =========================================================================
   RADAR DE EVENTOS — a vitrine da grade pro Marketing e pro Atendimento.

   MODELO MENTAL (v2, redesenho): escolha o DIA → a AGENDA do dia em linhas
   verticais (hora | evento | números | status, com o divisor "AGORA") →
   as ROTAS DE TICKET (satélite → 🎟 → torneio-alvo, um card por alvo) →
   os EVENTOS FUTUROS (a seção P&D depois de domingo). Nada se repete em
   três lugares; só o dia selecionado vai pro DOM.

   DE ONDE VÊM OS DADOS
   --------------------
   Do arquivo Global compartilhado que a operação já sobe no Painel do Dia
   (painel/globalMtt, base64 no Firebase via SupremaDB). Um operador sobe,
   o Marketing vê — sem planilha por e-mail. Fallback local ("ler minha
   Global") parseia no navegador sem publicar nada.

   VÍNCULO SATÉLITE → ALVO: heurística de tokens do nome + cabeçalho do
   grupo (coluna A, propaga até linha em branco) + hora citada no nome
   ("19H"). Ticket = buy-in do alvo.

   Depende de: gu-parser.js (normText, cellToHHMM, timeToMinutes,
   readSheetMatrix, isFutureSectionLabel, WEEKDAYS_PT/EN), suprema-db.js,
   suprema-auth.js, suprema-motion.js, ensureXLSX (suprema-xlsx.js).
========================================================================= */
'use strict';

/* carimbo de versão: primeiro a rodar — se este log não aparecer no console,
   o navegador está servindo um eventos.js antigo (cache/upload pendente) */
console.info('[Radar] eventos.js v2.0 — agenda por dia + rotas de ticket');

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
  return new Date(Date.UTC(y, m-1, d + n)).toISOString().slice(0,10);
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

  const byId = new Map(events.map(e => [e.id, e]));
  const futures = parsed.futures
    .map(f => ({ ...f, camp: campOf(f.nome) }))
    .filter((f, i, arr) => arr.findIndex(x => x.nome === f.nome && x.dateISO === f.dateISO) === i)
    .sort((a,b) => String(a.dateISO||'9999').localeCompare(String(b.dateISO||'9999')));
  return { events, futures, dates, byId };
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
function fmtIn(min){
  return min >= 60 ? `${Math.floor(min/60)}h${String(min%60).padStart(2,'0')}` : `${min} min`;
}

/* ═══════════════════ estado + dados ═══════════════════ */

let MODEL = null;                                    // {events, futures, dates, byId}
let META = null;                                     // {filename, at, by}
const state = { camp:'all', cat:'all', q:'', day:null, open:null };

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
    console.info('[Radar] auth ok — anexando listener da Global compartilhada');
    SupremaDB.watch('painel/globalMtt/at', snap => {
      const at = snap.val();
      console.info('[Radar] painel/globalMtt/at =', at);
      if (!at){ showEmpty(); return; }         // nó vazio: ninguém subiu a Global ainda
      if (`${at}` === `${_lastAt}`) return;
      _lastAt = `${at}`;
      loadSharedGlobal();
    });
    SupremaDB.onConnection(ok => setSync(ok));
    /* rede lenta/regra negada: depois de 12s sem dado, troca o loading pelo
       estado vazio (que tem o fallback de ler o arquivo local) */
    setTimeout(() => { if (!MODEL) showEmpty(); }, 12000);
  });
  setSync(true);
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
    console.error('[Radar] falha ao carregar a Global compartilhada', err);
    showEmpty();
  }
}

let _firstRender = true;
function applyMatrix(matrix){
  if (!matrix){ showEmpty(); return; }
  MODEL = buildModel(parseGlobalWeek(matrix));
  console.info(`[Radar] Global aplicada — ${MODEL.events.length} eventos na semana, ${MODEL.futures.length} futuros`);
  if (!MODEL.events.length && !MODEL.futures.length){ showEmpty(); return; }
  if (!state.day) state.day = WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  document.getElementById('loading').hidden = true;
  document.getElementById('emptyState').hidden = true;
  document.getElementById('content').hidden = false;
  renderAll();
  if (_firstRender){ _firstRender = false; scrollAgendaToNow(); }
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
  if (!MODEL) document.getElementById('emptyState').hidden = false;
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
    renderContent();
  }));
  document.querySelectorAll('#catChips .chip').forEach(ch => ch.addEventListener('click', () => {
    state.cat = ch.dataset.cat;
    document.querySelectorAll('#catChips .chip').forEach(c => c.classList.toggle('on', c === ch));
    renderContent();
  }));
  let qTimer = null;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderContent(); }, 180);
  });
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
  document.getElementById('statLive').textContent = NF_INT.format(live);
  document.getElementById('statToday').textContent = NF_INT.format(hoje);
  document.getElementById('statFut').textContent = NF_INT.format(MODEL.futures.length);
  document.getElementById('statGtd').textContent = fmtMoney(gtdWeek);
  document.getElementById('liveDot').classList.toggle('has-live', live > 0);
  if (!renderHero._counted){ renderHero._counted = true; SupremaMotion.countUp('#statLive, #statToday, #statFut'); }
}

/* ── barra de dias: a navegação principal ── */
const WEEK_ORDER = ['SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA','QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO','DOMINGO'];
function renderDayBar(){
  const wrap = document.getElementById('dayBar');
  const today = WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  wrap.innerHTML = WEEK_ORDER.map(day => {
    const iso = MODEL.dates[day];
    const n = MODEL.events.filter(e => e.weekday === day).length;
    return `<button class="day-pill ${day === state.day ? 'on' : ''} ${day === today ? 'is-today' : ''}"
      data-day="${day}" ${n ? '' : 'disabled'} aria-label="${day}, ${n} eventos">
      <span class="dp-wd">${WEEKDAY_SHORT[isoWeekdayIdx(iso)]}</span>
      <span class="dp-d">${+iso.slice(8)}</span>
      <span class="dp-n">${n || '·'}</span>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.day-pill').forEach(p => p.addEventListener('click', () => {
    if (state.day === p.dataset.day) return;
    state.day = p.dataset.day;
    renderDayBar();
    renderContent();
  }));
}

/* ── AGENDA do dia: linhas verticais, divisor AGORA, ao vivo aceso ── */
function renderAgenda(){
  const day = state.day;
  const iso = MODEL.dates[day];
  const evs = MODEL.events.filter(e => e.weekday === day && matches(e));
  const all = MODEL.events.filter(e => e.weekday === day);
  const gtd = evs.reduce((s,e) => s + (e.garantido || 0), 0);
  const today = day === WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())];
  const now = spNow();
  const nowAbs = absMin(now.iso, now.minutes);

  const head = document.getElementById('agendaHead');
  head.innerHTML = `
    <h2>${escHtml(day.replace('-FEIRA',''))}<span class="ah-date">${fmtDateShort(iso)}</span>
      ${today ? '<span class="today-tag">HOJE</span>' : ''}</h2>
    <span class="ah-sub">${evs.length}${evs.length !== all.length ? ` de ${all.length}` : ''} evento${evs.length === 1 ? '' : 's'} · <b>${fmtMoney(gtd)}</b> garantidos</span>`;

  const list = document.getElementById('agendaList');
  if (!evs.length){
    list.innerHTML = `<p class="section-empty">Nenhum evento ${all.length ? 'passa nos filtros atuais' : 'neste dia'}.</p>`;
    return;
  }
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
}
function nowDividerHtml(now){
  const hh = String(Math.floor(now.minutes/60)).padStart(2,'0'), mm = String(now.minutes%60).padStart(2,'0');
  return `<div class="now-divider" id="nowDivider" aria-label="Agora são ${hh}:${mm}"><i></i><span>AGORA · ${hh}:${mm}</span><i></i></div>`;
}
function rowHtml(e, st){
  const target = e.targetId ? MODEL.byId.get(e.targetId) : null;
  const hasDetail = !!(target || e.satCount);
  const statusHtml =
    st.k === 'live' ? `<span class="r-live"><i class="pulse"></i>AO VIVO${e.late ? `<small>late até ${e.late}</small>` : ''}</span>` :
    st.k === 'soon' ? `<span class="r-soon">em ${fmtIn(st.inMin)}</span>` : '';
  const link =
    target ? `<span class="r-ticket" title="Premia ticket para ${escHtml(target.nome)}">🎟 → ${escHtml(target.nome)}</span>` :
    e.satCount ? `<span class="r-ticket in">🎟 ${e.satCount} satélite${e.satCount > 1 ? 's' : ''} classificam</span>` : '';
  return `<article class="row ${st.k} ${CAT_META[e.cat].cls} ${hasDetail ? 'has-detail' : ''}" data-id="${e.id}">
    <span class="r-time">${e.hora}</span>
    <span class="r-suit" title="${CAT_META[e.cat].label}">${CAT_META[e.cat].suit}</span>
    <div class="r-main">
      <div class="r-name">${escHtml(e.nome)}${campBadge(e.camp)}</div>
      ${link ? `<div class="r-link">${link}</div>` : ''}
    </div>
    <div class="r-nums">
      <span class="r-gtd">${e.garantido != null ? fmtMoney(e.garantido) : ''}</span>
      <span class="r-buyin">${e.buyin != null ? fmtMoneyFull(e.buyin) : ''}</span>
    </div>
    ${statusHtml}
    ${hasDetail ? '<span class="r-chev" aria-hidden="true">›</span>' : ''}
  </article>`;
}

/* clique numa linha com vínculo → expande a rota do ticket ali mesmo */
document.getElementById('agendaList').addEventListener('click', (e) => {
  const row = e.target.closest('.row.has-detail');
  if (!row || !MODEL) return;
  const id = row.dataset.id;
  const existing = document.getElementById('rowDetail');
  if (existing) existing.remove();
  document.querySelectorAll('.row.open').forEach(r => r.classList.remove('open'));
  if (state.open === id){ state.open = null; return; }
  state.open = id;
  row.classList.add('open');
  row.insertAdjacentHTML('afterend', `<div class="row-detail" id="rowDetail">${detailHtml(MODEL.byId.get(id))}</div>`);
});
function detailHtml(e){
  if (!e) return '';
  if (e.cat === 'sat' && e.targetId){
    const t = MODEL.byId.get(e.targetId);
    return `<div class="rd-flow">
      <span class="rd-node">♦ ${escHtml(shortName(e.nome))}<small>${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} ${e.hora} · buy-in ${fmtMoneyFull(e.buyin)}</small></span>
      <span class="rd-arrow"><span class="ticket-chip">🎟 ${t.buyin != null ? fmtMoney(t.buyin) : 'ticket'}</span></span>
      <span class="rd-node tgt">${CAT_META[t.cat].suit} ${escHtml(t.nome)}<small>${WEEKDAY_SHORT[isoWeekdayIdx(t.dateISO)]} ${t.hora} · GTD ${fmtMoney(t.garantido)}</small></span>
    </div>
    <p class="rd-note">Quem vencer o satélite ganha o ticket de <b>${t.buyin != null ? fmtMoneyFull(t.buyin) : 'entrada'}</b> — acesso direto ao torneio-alvo.</p>`;
  }
  const sats = MODEL.events.filter(s => s.targetId === e.id);
  if (!sats.length) return '';
  return `<div class="rd-flow">
    <span class="rd-sats">${sats.map(s =>
      `<span class="rd-node">♦ ${escHtml(shortName(s.nome))}<small>${WEEKDAY_SHORT[isoWeekdayIdx(s.dateISO)]} ${s.hora} · ${fmtMoneyFull(s.buyin)}</small></span>`).join('')}</span>
    <span class="rd-arrow"><span class="ticket-chip">🎟 ${e.buyin != null ? fmtMoney(e.buyin) : 'ticket'}</span></span>
    <span class="rd-node tgt">${CAT_META[e.cat].suit} ${escHtml(e.nome)}<small>${WEEKDAY_SHORT[isoWeekdayIdx(e.dateISO)]} ${e.hora} · GTD ${fmtMoney(e.garantido)}</small></span>
  </div>
  <p class="rd-note">${sats.length} caminho${sats.length > 1 ? 's' : ''} barato${sats.length > 1 ? 's' : ''} até este torneio — o ticket vale <b>${e.buyin != null ? fmtMoneyFull(e.buyin) : 'a entrada'}</b>.</p>`;
}
function shortName(nome){
  return nome.length > 44 ? nome.slice(0, 42).trimEnd() + '…' : nome;
}

function scrollAgendaToNow(){
  const el = document.getElementById('nowDivider');
  if (el) el.scrollIntoView({ block:'center' });
}

/* ── ROTAS DE TICKET: um card por alvo, conexão em CSS puro ── */
function renderRoutes(){
  const day = state.day;
  const sats = MODEL.events.filter(e => e.weekday === day && e.cat === 'sat' && matches(e));
  const byTarget = new Map();                        // targetId → sats[]
  const orphans = [];
  sats.forEach(s => {
    if (s.targetId){
      if (!byTarget.has(s.targetId)) byTarget.set(s.targetId, []);
      byTarget.get(s.targetId).push(s);
    } else orphans.push(s);
  });
  const targets = [...byTarget.keys()].map(id => MODEL.byId.get(id)).sort((a,b) => a.abs - b.abs);

  const wrap = document.getElementById('routesWrap');
  document.getElementById('routesEmpty').hidden = targets.length > 0 || orphans.length > 0;
  wrap.innerHTML = targets.map(t => {
    const list = byTarget.get(t.id).sort((a,b) => a.abs - b.abs);
    const otherDay = t.weekday !== day ? `<span class="badge b-day">${WEEKDAY_SHORT[isoWeekdayIdx(t.dateISO)]}</span>` : '';
    return `<article class="route">
      <div class="rt-sats">
        ${list.map(s => `<div class="rt-sat" title="${escHtml(s.nome)}">
          <span class="rt-hora">${s.hora}</span>
          <span class="rt-nome">${escHtml(shortName(s.nome))}</span>
          <span class="rt-buyin">${s.buyin != null ? fmtMoneyFull(s.buyin) : ''}</span>
        </div>`).join('')}
      </div>
      <div class="rt-link" aria-hidden="true"><span class="ticket-chip">🎟 ${t.buyin != null ? fmtMoney(t.buyin) : 'ticket'}</span></div>
      <div class="rt-target ${CAT_META[t.cat].cls}">
        <div class="rt-tname">${CAT_META[t.cat].suit} ${escHtml(t.nome)}${campBadge(t.camp)}${otherDay}</div>
        <div class="rt-tsub">${t.hora} · GTD <b>${fmtMoney(t.garantido)}</b>${t.buyin != null ? ` · Buy-in ${fmtMoneyFull(t.buyin)}` : ''}</div>
      </div>
    </article>`;
  }).join('') + (orphans.length ? `
    <p class="rt-orphans">♦ ${orphans.length} satélite${orphans.length > 1 ? 's' : ''} sem alvo identificado na planilha:
      ${orphans.map(s => `<span class="rt-orphan" title="${escHtml(s.nome)}">${s.hora} ${escHtml(shortName(s.nome))}</span>`).join('')}</p>` : '');
}

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
    </article>`;
  }).join('');
}

/* ═══════════════════ chrome: relógio, tema, operador ═══════════════════ */
function tickClock(){
  const n = spNow();
  const el = document.getElementById('navTime');
  if (el) el.textContent =
    `${String(Math.floor(n.minutes/60)).padStart(2,'0')}:${String(n.minutes%60).padStart(2,'0')}:${String(n.seconds).padStart(2,'0')}`;
}
setInterval(tickClock, 1000); tickClock();
/* status "AO VIVO"/divisor AGORA acompanham o relógio — refresh leve por minuto,
   só das partes que mudam (hero + agenda do dia; rotas/futuros não têm status) */
setInterval(() => { if (MODEL){ renderHero(); renderAgenda(); } }, 60000);

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

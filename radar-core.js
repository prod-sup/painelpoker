/* =========================================================================
   RADAR-CORE — o motor compartilhado da leitura semanal da Global MTT.
   Usado pelo Radar de Eventos (eventos.html) e pela Suprema TV (tv.html):
   parser da semana inteira (aba MTTS BRAZIL), vínculo satélite → alvo em
   3 degraus, datas/status da grade e formatação. UM lugar só — se a Global
   mudar, ajusta aqui e as duas páginas acompanham (mesmo espírito do
   gu-parser.js, que este arquivo REQUER carregado antes: normText,
   cellToHHMM, timeToMinutes, isFutureSectionLabel, WEEKDAYS_PT/EN).
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
  return new Date(Date.UTC(y, m-1, d + n)).toISOString().slice(0,10);
}
function isoDayNumber(iso){ const [y,m,d] = iso.split('-').map(Number); return Date.UTC(y, m-1, d) / 86400000; }
/* minuto absoluto (dias desde epoch × 1440 + minuto do dia) — permite comparar
   horários entre dias sem aritmética de fuso */
function absMin(iso, minutes){ return isoDayNumber(iso) * 1440 + minutes; }
function isoWeekdayIdx(iso){ const [y,m,d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)).getUTCDay(); } // 0=domingo
const MONTHS_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const WEEKDAY_SHORT = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
const WEEK_ORDER = ['SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA','QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO','DOMINGO'];
function fmtDateShort(iso){ const [,m,d] = iso.split('-').map(Number); return `${d} ${MONTHS_PT[m-1]}`; }

/* grade operacional: o dia vira às 05:30 — antes disso ainda é "ontem" */
const GRADE_FLIP_MIN = 5*60 + 30;
function gradeTodayISO(){
  const now = spNow();
  return now.minutes < GRADE_FLIP_MIN ? isoAddDays(now.iso, -1) : now.iso;
}
function todayWeekdayPT(){ return WEEKDAYS_PT[isoWeekdayIdx(gradeTodayISO())]; }

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

function shortName(nome){
  return nome.length > 44 ? nome.slice(0, 42).trimEnd() + '…' : nome;
}

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

/* palavras que não identificam um alvo: estrutura (sat/mega/ticket/step…) e
   RUÍDO DE MARCA — "suprema"/"poker" estão em tudo e já ligaram satélite do
   SPT num FreeRoll por causa do token "suprema" solto */
const LINK_STOP = new Set(['sat','sats','satelite','satelites','satellite','mega','super','hyper','turbo',
  'ticket','tickets','tkt','seat','seats','step','steps','freeroll','qualifier','ao','de','do','da','das','dos',
  'em','no','na','the','to','for','pra','para','gtd','garantido','evento','event','edicao','edition',
  'as','sps','spt','com','sem','max','and','e','suprema','poker']);
function linkTokens(s){
  return normText(s).replace(/[^a-z0-9]+/g,' ').split(/\s+/)
    .filter(t => t.length >= 2 && !LINK_STOP.has(t) && !/^\d{1,2}h$/.test(t));
}
function nameHour(s){
  const m = String(s||'').toUpperCase().match(/(\d{1,2})\s*H(?:S|RS)?\b/);
  return m ? parseInt(m[1],10) : null;
}
/* nome "amassado" (sem acento/espaço/pontuação) pra teste de continência */
function squashName(s){ return normText(s).replace(/[^a-z0-9]+/g,''); }

/* O CABEÇALHO DO GRUPO (coluna A) é a declaração EXPLÍCITA do destino na
   Global — vence qualquer heurística. Procura um evento da semana com o nome
   do cabeçalho; pode ser OUTRO SATÉLITE (cadeia real: Step → Mega Sat → Main). */
function headerTarget(sat, events){
  if (!sat.groupHeader) return null;
  const gh = squashName(sat.groupHeader);
  const ghToks = linkTokens(sat.groupHeader);
  if (!gh) return null;
  let best = null, bestRank = -1;
  events.forEach(t => {
    if (t.id === sat.id) return;
    const tn = squashName(t.nome);
    const exact = tn.includes(gh) || gh.includes(tn);
    let tokHit = false;
    if (!exact && ghToks.length){
      const tToks = new Set(linkTokens(t.nome));
      const hits = ghToks.filter(tok => tToks.has(tok)).length;
      tokHit = hits >= Math.max(1, Math.ceil(ghToks.length * 0.6)) &&
               ghToks.some(tok => tok.length >= 3 && tToks.has(tok));
    }
    if (!exact && !tokHit) return;
    /* ranking: casamento exato > por tokens; começa depois do sat > antes; mais cedo > mais tarde */
    const rank = (exact ? 4 : 2) + (t.abs > sat.abs ? 1 : 0);
    if (rank > bestRank || (rank === bestRank && best && t.abs < best.abs)){ bestRank = rank; best = t; }
  });
  return best;
}

/* liga cada satélite ao torneio-alvo: 1º o cabeçalho do grupo (fonte da
   verdade da planilha); 2º heurística de tokens distintivos (Main/Side, mesmo
   dia primeiro); 3º sem evento na grade → o grupo vira DESTINO NOMEADO
   (targetGroup) — série/live fora da semana, nunca um chute.
   (satCount é recalculado DEPOIS, em buildModel, já com os overrides.) */
function linkSatellites(events){
  const targets = events.filter(e => e.cat !== 'sat');
  events.filter(e => e.cat === 'sat').forEach(sat => {
    const viaHeader = headerTarget(sat, events);
    if (viaHeader){ sat.targetId = viaHeader.id; return; }
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
    } else if (sat.groupHeader && !squashName(sat.nome).includes(squashName(sat.groupHeader))){
      /* o próprio cabeçalho do grupo não pode ser "destino" de si mesmo
         (a linha-mãe do grupo herda o header com o mesmo nome) */
      sat.targetGroup = sat.groupHeader;
    }
  });
}

/* ── CORREÇÃO MANUAL (admin): eventos/linksOverride/<chave do sat> =
   {target:<chave do alvo>|'none', targetName, by, at}. A chave é estável
   entre re-uploads da Global: dia|hora|nome normalizado. ── */
function evKey(e){ return `${e.weekday}|${e.hora}|${normText(e.nome)}`; }
function fbKey(k){ return k.replace(/[.#$/\[\]]/g, '_'); }

function applyOverrides(events, overrides){
  if (!overrides) return;
  const byKey = new Map(events.map(e => [evKey(e), e]));
  events.forEach(e => {
    if (e.cat !== 'sat') return;
    const o = overrides[fbKey(evKey(e))];
    if (!o || !o.target) return;
    e.overridden = true;
    if (o.target === 'none'){ e.targetId = null; e.targetGroup = null; return; }
    const t = byKey.get(o.target);
    if (t && t.id !== e.id){ e.targetId = t.id; e.targetGroup = null; }
    else if (o.targetName){ e.targetId = null; e.targetGroup = o.targetName; }
  });
}

function buildModel(parsed, overrides){
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
          satCount: 0, targetId: null, targetGroup: null, overridden: false,
        });
      });
    });
  });
  events.sort((a,b) => a.abs - b.abs);
  linkSatellites(events);
  applyOverrides(events, overrides);
  const byId = new Map(events.map(e => [e.id, e]));
  events.forEach(e => {                       // satCount só DEPOIS dos overrides
    if (e.cat === 'sat' && e.targetId){
      const t = byId.get(e.targetId);
      if (t) t.satCount++;
    }
  });

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

/* ═══════════════════ pontes pros nós do Painel do Dia e da GU ═══════════════════ */

/* a MESMA chave que o Painel do Dia usa nos nós premiacao/field/premBy
   (painel.js rowKey): hash de nome|hora|buyin|garantido. Os campos daqui vêm
   da mesma planilha com o mesmo tratamento, então a chave bate. */
function painelRowKey(e){
  const s = `${e.nome}|${e.hora}|${e.buyin}|${e.garantido}`;
  let h = 0;
  for (let i = 0; i < s.length; i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  return 'rk_' + Math.abs(h);
}

/* casa o "done" da Criação Noturna (chave `normText(nome)|hora`, nomes da aba
   G MTTS) com os eventos da semana (nomes da MTTS BRAZIL): mesma hora + nome
   parecido (continência amassada ou ≥60% dos tokens). Devolve quantos casaram. */
function matchCreators(events, doneMap, weekday){
  if (!doneMap) return 0;
  let hits = 0;
  const dayEvents = events.filter(e => e.weekday === weekday);
  Object.entries(doneMap).forEach(([key, val]) => {
    const cut = key.lastIndexOf('|');
    if (cut === -1) return;
    const nomeNorm = key.slice(0, cut);
    const hora = key.slice(cut + 1);
    const sq = squashName(nomeNorm);
    const toks = linkTokens(nomeNorm);
    const ev = dayEvents.find(e => {
      if (e.hora !== hora) return false;
      const esq = squashName(e.nome);
      if (esq.includes(sq) || sq.includes(esq)) return true;
      if (!toks.length) return false;
      const eToks = new Set(linkTokens(e.nome));
      return toks.filter(t => eToks.has(t)).length >= Math.max(1, Math.ceil(toks.length * 0.6));
    });
    if (ev && val && val.by){ ev.createdBy = val.by; hits++; }
  });
  return hits;
}

function b64ToBuf(b64){
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

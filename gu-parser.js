/* =========================================================================
   GU-PARSER — parser compartilhado da aba "G MTTS" da Global MTT (a planilha
   que a GU usa pra criar os eventos, valores JÁ EM DÓLAR, dias em inglês,
   cabeçalho em duas linhas). Extraído de criacao-noturna.html pra existir em
   UM lugar só: se a GU mudar a planilha, ajusta aqui e todas as páginas que
   incluírem <script src="gu-parser.js"></script> acompanham.
   Requer a lib XLSX (SheetJS) carregada na página.
========================================================================= */

/* Real = dólar × 5 (multiplicador Brazil da operação) */
const BRL_RATE = 5;

/* dia da grade: janela 06:10 → 05:30 do dia seguinte */
const CONF_WINDOW_START_MIN = 6*60 + 10;
const CONF_WINDOW_END_MIN = 5*60 + 30;

const WEEKDAYS_PT = ['DOMINGO','SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA','QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO'];
const WEEKDAYS_EN = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];

function normText(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }
function allWeekdayNamesNorm(){ return [...WEEKDAYS_PT, ...WEEKDAYS_EN].map(normText); }

/* rótulo que abre a seção de EVENTOS FUTUROS no rodapé da Global — marca o FIM
   da grade do dia. A GU usa "P&D" na aba G MTTS e "EVENTOS FUTUROS" na MTTS BRAZIL;
   os dois parsers reconhecem ambos pra não vazar evento futuro como aviso. */
function isFutureSectionLabel(v){
  const n = normText(v);
  return n === 'p&d' || n === 'eventos futuros' || n === 'evento futuro';
}

function cellToHHMM(v){
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number'){
    const totalMin = Math.round(v * 24 * 60);
    return `${String(Math.floor(totalMin/60)%24).padStart(2,'0')}:${String(totalMin%60).padStart(2,'0')}`;
  }
  if (typeof v === 'string'){
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;
  }
  return null;
}
/* aceita "HH:MM" e também prefixos tipo "HH:MM:SS" — o painel depende do formato permissivo */
function timeToMinutes(hhmm){
  if (hhmm === null || hhmm === undefined || hhmm === '') return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1])*60 + (+m[2]) : null;
}
function readSheetMatrix(arrayBuffer, sheetNameContains){
  const wb = XLSX.read(arrayBuffer, {type:'array', cellDates:false});
  let sheetName = wb.SheetNames.find(n => normText(n).includes(normText(sheetNameContains)));
  if (!sheetName) sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, raw:true, defval:null});
}
/* seção do dia na G MTTS: a linha de CABEÇALHO do dia é a que tem o nome do dia
   ("MONDAY") na PRÓPRIA coluna do nome do torneio (MTT MARKETING). A coluna A
   não serve de critério: ela repete o dia como rótulo decorativo em linhas de
   torneio reais e fica VAZIA em alguns cabeçalhos reais (WEDNESDAY/SUNDAY na
   planilha de produção). A checagem precisa ser estrita (célula igual ao dia),
   porque satélite com célula mesclada vem null e não pode contar como cabeçalho. */
function findWeekdaySectionRange(matrix, weekdayName, nameIdx){
  const norm = normText(weekdayName);
  const allNames = allWeekdayNamesNorm();
  const dayAt = (row) => {
    const c = row && row[nameIdx];
    return typeof c === 'string' && allNames.includes(normText(c)) ? normText(c) : null;
  };
  let startRow = -1, endRow = matrix.length, duplicate = false;
  for (let i = 0; i < matrix.length; i++){
    if (dayAt(matrix[i]) === norm){
      if (startRow === -1) startRow = i;
      else { duplicate = true; break; }
    }
  }
  if (startRow === -1) return null;
  for (let i = startRow+1; i < matrix.length; i++){
    const d = dayAt(matrix[i]);
    if (d && d !== norm){ endRow = i; break; }
  }
  return {startRow, endRow, duplicate};
}
/* ── RECEITA COMPLETA ──
   A Global tem ~30 colunas (MTT, TYPE, Game Type, K.O, Max Table, Prize Pool,
   Buy-in, Reentry, Stack, Add-on, Fee, Structure, Chips, Late Reg...) — tudo
   que a pessoa digita no app pra criar a mesa. Em vez de fixar 30 índices,
   achamos a LINHA DE CABEÇALHO na planilha e mapeamos as colunas pelo nome:
   se a GU adicionar/mover coluna, continua funcionando. */
function findHeaderCols(matrix){
  const clean = v => typeof v === 'string' && v.trim() ? v.replace(/\s+/g,' ').trim() : '';
  for (let i = 0; i < Math.min(matrix.length, 80); i++){
    const row = matrix[i];
    if (!row) continue;
    const norm = row.map(c => typeof c === 'string' ? normText(c) : '');
    const mttIdx = norm.findIndex(x => x === 'mtt');
    if (mttIdx >= 0 && norm.some(x => x === 'tipo' || x === 'type') && norm.some(x => x.includes('buy'))){
      // na Global real o cabeçalho ocupa DUAS linhas ("BLINDS UP (min)" em cima,
      // "Early game / Pós Late Reg. / Final Table..." embaixo) — mescla as duas,
      // mas só se a linha de baixo não for já uma linha de torneio (coluna MTT vazia)
      const next = matrix[i+1] || [];
      const merge = !clean(next[mttIdx]);
      const width = Math.max(row.length, merge ? next.length : 0);
      const cols = [];
      for (let c = 0; c < width; c++){
        const label = [clean(row[c]), merge ? clean(next[c]) : ''].filter(Boolean).join(' — ');
        if (label) cols.push({idx: c, label});
      }
      return cols;
    }
  }
  return null;
}
/* campos que já têm coluna própria na visão resumida — não repetir no detalhe.
   O "MTT" curto (nome interno, sem o garantido) FICA na receita: é diferente do
   MTT MARKETING que usamos como nome do torneio. Fusos de outros países saem. */
function isCoreLabel(label){
  const n = normText(label);
  return n.includes('mtt marketing') || n === 'tipo' || n === 'type' || n === 'day' || n === 'hora' || n === 'horario' || n === 'time' || n.includes('(utc');
}
/* localiza as colunas-chave pelo nome no cabeçalho da G MTTS */
function guIdx(headerCols){
  const find = pred => { const c = headerCols.find(c => pred(normText(c.label))); return c ? c.idx : -1; };
  const name = find(n => n.includes('mtt marketing'));
  const shortName = find(n => n === 'mtt');
  return {
    hora: find(n => n === 'hora' || n === 'horario'),
    name: name >= 0 ? name : shortName,
    shortName,
    tipo: find(n => n === 'type' || n === 'tipo'),
    prize: find(n => n.includes('prize pool') || n.includes('guaranteed')),
    buyin: find(n => n === 'buy-in' || n === 'buy in' || n === 'buyin'),
    hourLate: find(n => n.includes('hour late') || n.includes('hora late'))
  };
}
/* formata um valor de célula da receita pelo TIPO do cabeçalho:
   frações de dia viram HH:MM só em colunas de horário; frações em colunas de
   fee/payout viram %; o resto fica como está na planilha (é o que se digita no app) */
function fmtExtraVal(label, v){
  if (v === null || v === undefined || v === '') return '—';
  const n = normText(label);
  if (typeof v === 'number'){
    const isPct = /fee|payout|early bird/.test(n);
    const isTime = /late reg|hour|break|horari|early game|pos late|final table/.test(n);
    if (v > 0 && v < 1){
      if (isPct) return (Math.round(v*10000)/100).toLocaleString('pt-BR') + '%';
      if (isTime) return cellToHHMM(v);
      return (Math.round(v*100)/100).toLocaleString('pt-BR');
    }
    return v.toLocaleString('pt-BR', {maximumFractionDigits:2});
  }
  return String(v).trim();
}

/* classifica a coluna TYPE de forma TOLERANTE — a GU digita a mão e varia a grafia
   ("Main event", "MAIN", "Satelite" sem acento, "Satellite", "SAT", "Side"...). Em vez de
   casar string exata (que jogava tudo pra "tipo não reconhecido"), normaliza e procura o
   radical. Mesma lógica do classify() do painel.js — mantidas em sincronia de propósito. */
function classifyGuTipo(tipo){
  const t = normText(tipo);
  if (!t) return null;
  if (t.includes('main')) return 'main';
  if (t.includes('side')) return 'side';
  if (t.includes('sat'))  return 'sat'; // cobre SAT, satélite, satelite, satellite
  return null;
}

function extractGuDaySection(matrix, weekdayEn, headerCols){
  const gi = guIdx(headerCols);
  const range = findWeekdaySectionRange(matrix, weekdayEn, gi.name);
  if (!range) return null;
  const main = [], side = [], sat = [], unknown = [], semHora = [], aposGap = [];
  // na G MTTS o nome de marketing (MTT MARKETING) vem mesclado quando um grupo de
  // satélites tem vários horários — herda o último visto até a próxima linha vazia
  let lastGroupName = null, lastHora = null, emptyCount = 0;
  const num = v => typeof v === 'number' ? Math.round(v*100)/100 : null;
  const str = v => typeof v === 'string' && v.trim() ? v.replace(/\s+/g,' ').trim() : null;
  for (let i = range.startRow; i < range.endRow; i++){
    const row = matrix[i];
    if (!row || row.every(v => v === null || v === undefined || v === '' || v === ' ')){
      lastGroupName = null; lastHora = null; emptyCount++;
      if (emptyCount >= 5){
        for (let j = i; j < range.endRow; j++){
          const r = matrix[j];
          if (!r) continue;
          const nm = str(r[gi.name]) || str(r[gi.shortName]);
          // rótulo de eventos futuros também encerra o scan pós-vão: dali pra baixo é tudo futuro
          if (isFutureSectionLabel(nm)) break;
          const hr = cellToHHMM(r[gi.hora]);
          if (nm && hr && !allWeekdayNamesNorm().includes(normText(nm))) aposGap.push({nome:nm, hora:hr});
        }
        break;
      }
      continue;
    }
    emptyCount = 0;
    let hora = cellToHHMM(row[gi.hora]);
    const nomeMkt = str(row[gi.name]);
    const nomeCurto = str(row[gi.shortName]);
    const tipo = str(row[gi.tipo]);
    const cat = classifyGuTipo(tipo); // 'main' | 'side' | 'sat' | null (tolerante à grafia)
    // "P&D" / "EVENTOS FUTUROS" — seção de eventos FUTUROS que fecha o cronograma da
    // Global (a linha repete o rótulo em várias colunas e o que vem depois tem DATA na
    // coluna A). Não é torneio do dia: é o FIM da grade — para aqui, sem virar aviso
    if (isFutureSectionLabel(nomeMkt) || isFutureSectionLabel(nomeCurto)) break;
    if (nomeMkt && allWeekdayNamesNorm().includes(normText(nomeMkt))) continue; // cabeçalho do dia
    if (nomeMkt) lastGroupName = nomeMkt;
    // linha separadora "MTT / SATELLITE" que abre o bloco de satélites — não é torneio
    if (['mtt','satellite','satelite'].includes(normText(nomeMkt || '')) || ['satellite','satelite'].includes(normText(nomeCurto || ''))) continue;
    const nome = (cat === 'sat' ? (nomeCurto || nomeMkt) : (nomeMkt || nomeCurto));
    if (!nome) continue;
    if (normText(nome) === 'suspenso') continue;
    if (!hora && lastHora) hora = lastHora;
    else if (hora) lastHora = hora;
    if (!hora){ semHora.push({nome, hora:row[gi.hora], tipo}); continue; }
    // G MTTS: PRIZE POOL USD e BUY-IN já são em dólar — sem divisão nenhuma
    const garantido = num(row[gi.prize]);
    const buyin = num(row[gi.buyin]);
    const lateHH = gi.hourLate >= 0 ? cellToHHMM(row[gi.hourLate]) : null;
    // receita completa: TODAS as colunas do cabeçalho, valor cru da célula
    const extra = {};
    headerCols.forEach(({idx, label}) => {
      if (isCoreLabel(label)) return;
      let v = row[idx];
      if (v instanceof Date) v = cellToHHMM((v.getHours()*60 + v.getMinutes())/1440);
      if (typeof v === 'string') v = v.trim();
      if (v !== null && v !== undefined && v !== '') extra[label] = v;
    });
    const entry = {nome, hora, garantido, buyin, late:lateHH, groupHeader: cat === 'sat' ? lastGroupName : null, extra};
    if (cat === 'main') main.push(entry);
    else if (cat === 'side') side.push(entry);
    else if (cat === 'sat') sat.push(entry);
    else if (tipo) unknown.push({...entry, tipo}); // tipo preenchido mas fora dos radicais conhecidos
    // tipo vazio + nome presente: linha decorativa/rótulo — ignorada em silêncio só se não tiver valores
    else if (garantido !== null || buyin !== null) unknown.push({...entry, tipo: tipo ?? ''});
  }
  return {main, side, sat, unknown, semHora, aposGap, duplicateSection: range.duplicate};
}

/* janela 06:10(amanhã) → 05:30(dia seguinte): mesma montagem da Conferência de amanhã */
function buildSections(sectionTomorrow, sectionDayAfter){
  const inWindow = list => list.filter(it => (timeToMinutes(it.hora) ?? -1) >= CONF_WINDOW_START_MIN);
  const inWindowNextDay = list => list.filter(it => { const m = timeToMinutes(it.hora); return m !== null && m <= CONF_WINDOW_END_MIN; });
  const chronoSort = list => [...list].sort((a,b) => {
    const ma = timeToMinutes(a.hora) ?? 9999, mb = timeToMinutes(b.hora) ?? 9999;
    return (ma >= CONF_WINDOW_START_MIN ? ma : ma+1440) - (mb >= CONF_WINDOW_START_MIN ? mb : mb+1440);
  });
  const main = chronoSort([...(sectionTomorrow ? inWindow(sectionTomorrow.main) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.main) : [])]);
  const side = chronoSort([...(sectionTomorrow ? inWindow(sectionTomorrow.side) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.side) : [])]);
  const sat = [...(sectionTomorrow ? inWindow(sectionTomorrow.sat) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.sat) : [])];
  const unknown = [...(sectionTomorrow ? inWindow(sectionTomorrow.unknown) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.unknown) : [])];
  return { main, side, sat, unknown };
}

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
/* lê o .xlsx UMA vez. Existe separado do readSheetMatrix porque o painel precisa
   de DUAS abas do mesmo arquivo (MTTS BRAZIL pra grade + G MTTS pro FEE) e
   parsear 3 MB duas vezes trava a interface no clique do upload. */
function readWorkbook(arrayBuffer){
  return XLSX.read(arrayBuffer, {type:'array', cellDates:false});
}
/* matriz de uma aba de um workbook já lido. `strict` NÃO cai na primeira aba
   quando o nome não existe — quem procura a G MTTS precisa saber que ela falta,
   em vez de receber a MTTS BRAZIL silenciosamente e ler as colunas erradas. */
function workbookMatrix(wb, sheetNameContains, strict){
  if (!wb || !wb.SheetNames) return null;
  let sheetName = wb.SheetNames.find(n => normText(n).includes(normText(sheetNameContains)));
  if (!sheetName){ if (strict) return null; sheetName = wb.SheetNames[0]; }
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, raw:true, defval:null});
}
function readSheetMatrix(arrayBuffer, sheetNameContains){
  return workbookMatrix(readWorkbook(arrayBuffer), sheetNameContains, false);
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
/* rótulo da coluna TYPE/categoria — TOLERANTE à grafia da GU: "TYPE", "TIPO",
   "TIPO DE TORNEIO", "Categoria"... Um lugar só decide o que é a coluna TYPE
   (o gate do cabeçalho E o guIdx usam esta função), então nunca mais diverge.
   NUNCA casa "Game Type" (coluna diferente, com slot próprio na receita) — era
   a armadilha do match frouxo. RAIZ DO PROBLEMA RECORRENTE: o match EXATO
   (=== 'type') virava -1 quando a GU renomeava a coluna, e aí TODO torneio caía
   no fallback por garantido (≥20k = main, resto = side) → Main Event virava Side
   e a divisão do turno quebrava, sem aviso nenhum. */
function isTypeLabel(n){
  if (/game/.test(n)) return false;                       // "Game Type" não é a coluna TYPE
  return n === 'type' || n === 'tipo'
      || /(^|[^a-z])(type|tipo)([^a-z]|$)/.test(n)         // "tipo de torneio", "type —…"
      || /categoria|category/.test(n);
}
function findHeaderCols(matrix){
  const clean = v => typeof v === 'string' && v.trim() ? v.replace(/\s+/g,' ').trim() : '';
  for (let i = 0; i < Math.min(matrix.length, 80); i++){
    const row = matrix[i];
    if (!row) continue;
    const norm = row.map(c => typeof c === 'string' ? normText(c) : '');
    const mttIdx = norm.findIndex(x => x === 'mtt');
    // ÂNCORA do cabeçalho = MTT + BUY-IN. A coluna TYPE deixou de ser obrigatória
    // aqui de propósito: se a GU remover/renomear o TYPE além do reconhecível, o
    // cabeçalho AINDA é achado, o guIdx.tipo vira -1 e a classificação cai no
    // fallback por nome/garantido COM aviso (tipoColMissing) — em vez de rejeitar
    // a planilha inteira com "cabeçalho não encontrado". Prize/guarantido entram
    // como âncora extra pra não casar uma linha solta que só tenha "mtt" e "buy".
    const hasBuy = norm.some(x => x.includes('buy'));
    const hasAnchor = norm.some(isTypeLabel) || norm.some(x => x.includes('prize') || x.includes('guarant'));
    if (mttIdx >= 0 && hasBuy && hasAnchor){
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
/* rótulo da coluna FEE (o rake do torneio). NUNCA casa "ADMIN FEE" (coluna
   própria, somada por fora) nem "EARLY BIRD" — as duas contêm "fee"/"bird" e
   confundi-las inverteria a conta da casa. */
function isFeeLabel(n){
  if (/admin|adm\.?\s*fee|early/.test(n)) return false;
  return n === 'fee' || /(^|[^a-z])fee([^a-z]|$)/.test(n) || /(^|[^a-z])rake([^a-z]|$)/.test(n);
}
/* rótulo da coluna ADMIN FEE — a GU escreve "ADMIN FEE" na G MTTS e "ADM FEE"
   em relatório; as duas grafias valem. */
function isAdminFeeLabel(n){
  return /(^|[^a-z])(admin|adm)\.?\s*fee/.test(n);
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
    tipo: find(isTypeLabel),                                  // tolerante à grafia (ver isTypeLabel)
    prize: find(n => n.includes('prize pool') || n.includes('guaranteed')),
    buyin: find(n => /buy[\s-]?in/.test(n) && !n.includes('size')),
    fee: find(isFeeLabel),                                    // FEE = rake do torneio (fração)
    adminFee: find(isAdminFeeLabel),                          // ADMIN FEE = taxa administrativa (fração)
    hourLate: find(n => n.includes('hour late') || n.includes('hora late'))
  };
}

/* ══ FEE / ADMIN FEE DA GU ══════════════════════════════════════════════════
   O rake NÃO é mais deduzido do nome/categoria: quem manda são as colunas FEE e
   ADMIN FEE da G MTTS, preenchidas pela GU evento a evento. A retenção da casa é
   a SOMA das duas (ex.: SPS = 10% + 2%); o freeroll vem 0% e o high stakes 8%,
   casos que nenhuma regra por nome acertava.

   POR QUE UM ÍNDICE, E NÃO LEITURA DIRETA
   O Painel do Dia lê a aba MTTS BRAZIL (em reais), que NÃO tem essas colunas —
   só a G MTTS (em dólar) tem. As duas abas descrevem os MESMOS torneios, então
   casamos por nome + horário. Medido na planilha de produção: 850 de 852.

   ARMADILHA DO BLOCO DE SATÉLITE: ali as colunas trocam de papel — a MTT
   MARKETING passa a guardar o EVENTO-ALVO ("SPS 42-M Reentry") e o nome do
   satélite ("4 Seats Reentry") fica na coluna MTT curta. Por isso indexamos
   pelas DUAS colunas de nome; sem isso 49 satélites por grade ficavam de fora. */

/* célula de fee -> fração. Aceita 0,1 (o formato da GU), "10%" e 10 (quem digita
   o percentual inteiro). Devolve null pra célula vazia/lixo — 0 é valor VÁLIDO
   (freeroll) e não pode virar null. */
function guFeeFrac(v){
  if (v === null || v === undefined || v === '') return null;
  let n;
  if (typeof v === 'number') n = v;
  else {
    const s = String(v).trim().replace(/%/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    n = parseFloat(s);
    if (String(v).includes('%')) n = n / 100;
  }
  if (!isFinite(n) || n < 0) return null;
  if (n > 1) n = n / 100;
  return n >= 1 ? null : n;      // 100% de rake não existe: é erro de digitação
}

/* índice {nome+hora -> {fee, admin}} a partir da matriz da aba G MTTS */
function buildGuFeeIndex(matrix){
  if (!matrix || !matrix.length) return null;
  const headerCols = findHeaderCols(matrix);
  if (!headerCols) return null;
  const gi = guIdx(headerCols);
  if (gi.fee < 0) return null;                 // sem a coluna FEE não há o que indexar
  const dias = allWeekdayNamesNorm();
  const byKey = new Map(), byName = new Map();
  let count = 0;
  for (let i = 0; i < matrix.length; i++){
    const row = matrix[i];
    if (!row) continue;
    const fee   = guFeeFrac(row[gi.fee]);
    const admin = gi.adminFee >= 0 ? guFeeFrac(row[gi.adminFee]) : null;
    if (fee === null) continue;                // linha decorativa / cabeçalho
    const horaCell = gi.hora >= 0 ? row[gi.hora] : null;
    const min = typeof horaCell === 'number' ? Math.round(horaCell * 1440) : timeToMinutes(cellToHHMM(horaCell));
    // Em linha de SATÉLITE a MTT MARKETING NÃO é o nome do torneio: é o
    // EVENTO-ALVO ("SPS 42-M Reentry" na linha de "4 Seats Reentry"). Indexar
    // ela ali gravava o alvo com o fee do SATÉLITE (5%) e colidia com o fee de
    // verdade do próprio alvo (12%) — 86 nomes com dois fees na planilha de
    // produção. Em satélite, vale só a coluna MTT curta.
    const ehSat = gi.tipo >= 0 && classifyGuTipo(row[gi.tipo]) === 'sat';
    const colsNome = ehSat ? [gi.shortName] : [gi.name, gi.shortName];
    const nomes = [];
    colsNome.forEach(ci => {
      if (ci < 0) return;
      const v = row[ci];
      if (typeof v !== 'string' || !v.trim()) return;
      const n = normText(v);
      if (n && dias.indexOf(n) < 0 && nomes.indexOf(n) < 0) nomes.push(n);
    });
    if (!nomes.length) continue;
    const val = {fee: fee, admin: admin === null ? 0 : admin};
    nomes.forEach(n => {
      if (min !== null && !byKey.has(n + '|' + min)) byKey.set(n + '|' + min, val);
      if (!byName.has(n)) byName.set(n, val);
    });
    count++;
  }
  return count ? {byKey: byKey, byName: byName, count: count} : null;
}

/* índice de FEE a partir de um workbook já lido. Só a aba G MTTS serve: se ela
   não veio no arquivo, devolve null (quem chamou avisa) em vez de ler a aba
   errada. */
function guFeeIndexFromWorkbook(wb){
  const matrix = workbookMatrix(wb, 'g mtts', true);
  return matrix ? buildGuFeeIndex(matrix) : null;
}

/* consulta o índice: nome + "HH:MM". Cai pro nome sozinho quando o horário do
   dia difere (a G MTTS repete o mesmo evento em vários dias com o mesmo fee).
   Devolve {fee, admin, total} ou null — null significa "a GU não disse", e o
   chamador decide o que fazer. */
function guFeeOf(index, nome, hora){
  if (!index || !nome) return null;
  const n = normText(nome);
  const min = timeToMinutes(hora);
  let hit = (min !== null) ? index.byKey.get(n + '|' + min) : null;
  if (!hit) hit = index.byName.get(n) || null;
  if (!hit || hit.fee === null || hit.fee === undefined) return null;
  const fee = hit.fee, admin = hit.admin || 0;
  return {fee: fee, admin: admin, total: fee + admin};
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
   radical. Mesma lógica do classify() do painel.js — mantidas em sincronia de propósito.

   Regra da operação: Main e Satélite são os ÚNICOS casos especiais; qualquer outro
   TYPE PREENCHIDO é Side Event por eliminação (PKO/Bounty/Turbo/Freezeout/… são Side).
   Por isso o default é 'side' — igual ao tail do classify() do painel. O split
   com/sem Admin Fee sai das colunas de fee, não do TYPE.
   TYPE VAZIO é a exceção: na G MTTS é linha decorativa/rótulo, então volta null e cai
   na rede de segurança "tipo não reconhecido" (não vira Side sozinho). */
function classifyGuTipo(tipo){
  const t = normText(tipo);
  if (!t) return null;                  // sem TYPE: rede de segurança, não classifica
  if (t.includes('main')) return 'main';
  if (t.includes('side')) return 'side';
  if (t.includes('sat'))  return 'sat'; // cobre SAT, satélite, satelite, satellite
  return 'side';                        // TYPE preenchido fora dos radicais = Side por eliminação
}

/* TYPE VAZIO na coluna D: a GU às vezes deixa a célula em branco em torneio real
   (#AS Bounty, #AS Battle PKO, #AS Sonic…). Antes isso caía em "tipo não reconhecido"
   e o torneio ficava FORA da divisão do turno. Aqui deduzimos pelo NOME/garantido —
   a MESMA heurística do classify() do painel.js, mantidas em sincronia:
   nome de satélite → sat; garantido gordo (≥20k) → main; senão Side. */
function classifyGuFallback(nome, garantido) {
  const n = normText(nome);
  if (n.includes('seats') || n.includes('seat ') || n.includes('satelite') || n.includes('satellite')) return 'sat';
  if ((garantido || 0) >= 20000) return 'main';
  return 'side';
}

function extractGuDaySection(matrix, weekdayEn, headerCols){
  const gi = guIdx(headerCols);
  const range = findWeekdaySectionRange(matrix, weekdayEn, gi.name);
  if (!range) return null;
  const main = [], side = [], sat = [], unknown = [], semHora = [], aposGap = [], semTipo = [], suspensos = [];
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
    // TORNEIO SUSPENSO — reconhece a palavra "suspenso/suspensa/suspensão" em QUALQUER
    // célula de nome (ou no TYPE) e NÃO deixa criar: vira item informativo (nome real +
    // motivo), sem ID e sem "criado". Antes a linha era simplesmente descartada, então o
    // torneio sumia sem explicar por quê. Preserva o texto CRU da GU pra nada ficar oculto.
    const isSusp = s => normText(s || '').includes('suspens');
    if (isSusp(nomeMkt) || isSusp(nomeCurto) || isSusp(tipo)){
      const carrier = [nomeMkt, nomeCurto, tipo].find(isSusp) || 'Suspenso';   // a célula que traz o marcador (+ motivo, se houver)
      const real = [nomeMkt, nomeCurto].find(s => s && !isSusp(s));            // o nome de verdade, se estiver na outra coluna
      suspensos.push({
        nome: real || carrier,               // nome real quando existe; senão o próprio texto marcado
        motivo: real ? carrier : '',         // se o nome veio da outra coluna, o texto marcado é o "porquê"
        hora: hora || null,                  // pode não ter horário — tudo bem, é informativo
        tipo: tipo || null
      });
      continue;
    }
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
    // `tipo` = valor CRU da coluna TYPE (ex.: "Side Event"); guardado no entry pra
    // quem quiser exibir TYPE como coluna (Criação Noturna) sem reparsear. Aditivo:
    // consumidores antigos ignoram. `extra` continua sem colunas core (não duplica).
    // FEE/ADMIN FEE da própria linha da G MTTS — aqui não precisa de índice
    // nenhum, a coluna está do lado. Quem consome (painel/admin) usa a SOMA.
    const fee = gi.fee >= 0 ? guFeeFrac(row[gi.fee]) : null;
    const adminFee = gi.adminFee >= 0 ? guFeeFrac(row[gi.adminFee]) : null;
    const entry = {nome, hora, garantido, buyin, late:lateHH, tipo: tipo || null, fee, adminFee, groupHeader: cat === 'sat' ? lastGroupName : null, extra};
    if (cat === 'main') main.push(entry);
    else if (cat === 'side') side.push(entry);
    else if (cat === 'sat') sat.push(entry);
    /* TYPE VAZIO, mas é torneio de VERDADE (tem horário E valores): NÃO pode ficar de
       fora da divisão do turno. Deduz pelo nome/garantido e registra em semTipo, que
       vira aviso "confira a coluna D" — incluído no trabalho, mas sinalizado. */
    else if (garantido !== null || buyin !== null) {
      const alt = classifyGuFallback(nome, garantido);
      if (alt === 'main') main.push(entry);
      else if (alt === 'sat') sat.push({...entry, groupHeader: lastGroupName});
      else side.push(entry);
      semTipo.push({nome, hora, cat: alt});
    }
    // TYPE vazio E sem valores: linha decorativa/rótulo — ignorada em silêncio
  }
  // coluna TYPE não achada no cabeçalho: TUDO passou pelo fallback por nome/garantido.
  // Sinaliza pra virar aviso GRITANTE (antes isso era silencioso — a origem do bug crônico).
  return {main, side, sat, unknown, semHora, aposGap, semTipo, suspensos, tipoColMissing: gi.tipo < 0, duplicateSection: range.duplicate};
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
  const semTipo = [...(sectionTomorrow ? inWindow(sectionTomorrow.semTipo) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.semTipo) : [])];
  // suspensos: informativos — mantém os que estão na janela E também os sem horário (não some ninguém)
  const suspInWin = list => (list || []).filter(it => { const m = timeToMinutes(it.hora); return it.hora == null || m === null ? true : m >= CONF_WINDOW_START_MIN; });
  const suspensos = [...(sectionTomorrow ? suspInWin(sectionTomorrow.suspensos) : []), ...(sectionDayAfter ? inWindowNextDay(sectionDayAfter.suspensos || []) : [])];
  const tipoColMissing = !!(sectionTomorrow && sectionTomorrow.tipoColMissing);
  return { main, side, sat, unknown, semTipo, suspensos, tipoColMissing };
}

/* =========================================================================
   FONTE AUTOMÁTICA DA GLOBAL — a planilha da GU publicada na web (aba G MTTS
   → "Publicar na web" como XLSX). Mora aqui, junto do parser, porque DUAS
   páginas puxam o MESMO link: a Criação Noturna (grade de amanhã) e a
   Conferência do dia, no Painel (grade de hoje). Em dois lugares, um dia
   divergiriam — e ninguém perceberia até a conferência estar lendo de uma
   planilha e a criação de outra.
   O link é público mas expõe SÓ a aba G MTTS (single=true); o resto do
   documento continua privado.
   Trocar de planilha sem redeploy: localStorage 'cn_sheet_url'.
   Desligar o auto-sync (nas duas pontas): localStorage 'cn_autosync' = '0'.
========================================================================= */
const GU_SHEET_XLSX_URL_DEFAULT = 'https://docs.google.com/spreadsheets/d/1GMcEG3-J1Bg8nDvivHh6yAbVv914eJJA5rDT7DuYXck/pub?gid=1114105684&single=true&output=xlsx';

function guSheetXlsxUrl(){
  try{ return localStorage.getItem('cn_sheet_url') || GU_SHEET_XLSX_URL_DEFAULT; }
  catch(e){ return GU_SHEET_XLSX_URL_DEFAULT; }
}
function guAutoSyncEnabled(){
  try{ return localStorage.getItem('cn_autosync') !== '0'; }catch(e){ return true; }
}
/* baixa o .xlsx publicado e devolve o ArrayBuffer CRU — quem chamou manda pro
   mesmo caminho de extração do upload manual, então não existe parsing
   paralelo "do automático". Garante o SheetJS carregado antes de voltar.
   Estoura Error em falha de rede/HTTP: quem chamou decide o que dizer. */
async function fetchGuSheetBuffer(){
  const base = guSheetXlsxUrl();
  if (!base) throw new Error('Sem link do Google Sheets configurado.');
  if (typeof ensureXLSX === 'function') await ensureXLSX();
  else if (typeof XLSX === 'undefined') throw new Error('A biblioteca de planilhas não carregou — recarregue a página.');
  // cache-buster p/ o cache DO NAVEGADOR (o cache do "Publicar na web" é do Google e não dá pra furar)
  const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + '_gu=' + Date.now();
  const resp = await fetch(url, { cache:'no-store', redirect:'follow' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.arrayBuffer();
}

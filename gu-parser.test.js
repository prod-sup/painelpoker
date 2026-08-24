/* Testes do gu-parser.js — rode com:  node gu-parser.test.js
   Cobre os casos que já quebraram (ou quase) em produção:
   - cabeçalho em DUAS linhas ("BLINDS UP (min)" + "Early game")
   - satélite com nome de grupo mesclado (célula null herda o grupo)
   - nome do dia decorativo na coluna A (não pode abrir seção)
   - linhas depois do vão de 5 linhas vazias ficam de fora (aposGap)
   - janela da grade 06:10 → 05:30 no buildSections
   Se a GU mudar o layout da G MTTS, ajuste a fixture e rode antes de publicar. */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/gu-parser.js', 'utf8');
const api = {};
new Function('api', src + `
;Object.assign(api, {normText, cellToHHMM, timeToMinutes, findHeaderCols,
  findWeekdaySectionRange, guIdx, isCoreLabel, fmtExtraVal, extractGuDaySection,
  buildSections, CONF_WINDOW_START_MIN, CONF_WINDOW_END_MIN, BRL_RATE,
  isFeeLabel, isAdminFeeLabel, guFeeFrac, buildGuFeeIndex, guFeeOf,
  workbookMatrix, guFeeIndexFromWorkbook, guFeeFromExtra});`)(api);

let passed = 0;
function ok(cond, name){ assert.ok(cond, name); passed++; console.log('  ✓ ' + name); }

/* ── fixture: G MTTS mínima com cabeçalho de 2 linhas e uma segunda-feira ── */
const H1 = ['HORA','MTT','MTT MARKETING','TYPE','PRIZE POOL USD','BUY-IN','HOUR LATE REG','FEE','ADMIN FEE','EARLY BIRD','CHIPS','BLINDS UP (min)'];
const H2 = [null,  null, null,            null,  null,            null,    null,           null, null,       null,        null,   'Early game'];
const matrix = [
  ['G MTTS'], [],
  H1, H2,
  [null, null, 'MONDAY', null],
  // "MONDAY" decorativo na coluna A de uma linha REAL de torneio — não pode abrir seção
  ['14:00', '#AS', '#AS 50K WarmUp', 'Main Event', 50000, 30, '17:00', 0.10, 0.02, 0.2, 50000, 12],
  ['08:00', '#S1', 'Side Mananha',   'Side Event', 1000,  11, '10:00', 0.10, null, null, 25000, 10],
  ['05:00', '#S2', 'Side Madrugada', 'Side Event', 500,   5,  '06:00', 0.10, null, null, 20000, 8],
  [null, null, 'MTT', 'SATELLITE'], // separador do bloco de satélite
  ['15:00', 'SAT A1', 'GRUPO SAT A', 'SAT', 100, 5,  null, 0.10, null, null, 10000, 5],
  ['16:00', 'SAT A2', null,          'SAT', 100, 5,  null, 0.10, null, null, 10000, 5], // mesclado: herda GRUPO SAT A
  [], [], [], [], [], // 5 linhas vazias = fim da seção útil
  ['22:00', '#GAP', 'Depois do vão', 'Side Event', 999, 9],
  [null, null, 'TUESDAY', null],
  ['12:00', '#T1', 'Side de Terça', 'Side Event', 700, 7, null, 0.10, null, null, 15000, 8]
];

console.log('findHeaderCols');
const cols = api.findHeaderCols(matrix);
ok(cols && cols.length >= 12, 'acha o cabeçalho');
ok(cols.some(c => c.label === 'BLINDS UP (min) — Early game'), 'mescla as duas linhas do cabeçalho');

console.log('guIdx');
const gi = api.guIdx(cols);
ok(gi.name === 2 && gi.tipo === 3 && gi.prize === 4 && gi.buyin === 5, 'mapeia as colunas-chave pelo nome');

console.log('findWeekdaySectionRange');
ok(api.findWeekdaySectionRange(matrix, 'MONDAY', gi.name).startRow === 4, 'seção abre no cabeçalho do dia (coluna MTT MARKETING), não no rótulo decorativo');
ok(api.findWeekdaySectionRange(matrix, 'FRIDAY', gi.name) === null, 'dia inexistente retorna null');

console.log('extractGuDaySection');
const sec = api.extractGuDaySection(matrix, 'MONDAY', cols);
ok(sec.main.length === 1 && sec.main[0].nome === '#AS 50K WarmUp', 'Main Event extraído');
ok(sec.side.length === 2, 'Side Events extraídos');
ok(sec.sat.length === 2, 'satélites extraídos');
ok(sec.sat[1].groupHeader === 'GRUPO SAT A', 'satélite mesclado herda o grupo');
ok(sec.sat[1].nome === 'SAT A2', 'satélite usa o nome curto da coluna MTT');
ok(sec.aposGap.length === 1 && sec.aposGap[0].nome === 'Depois do vão', 'linha após o vão de 5 vazias vai pro aviso, não pra lista');
ok(sec.main[0].extra['FEE'] === 0.10 && sec.main[0].extra['EARLY BIRD'] === 0.2, 'receita completa preservada (extra)');
ok(!('MTT MARKETING' in sec.main[0].extra), 'colunas core não duplicam na receita');

console.log('classificação tolerante da coluna TYPE (grafias que a GU digita a mão)');
const variantes = [
  ['G MTTS'], [],
  H1, H2,
  [null, null, 'WEDNESDAY', null],
  ['09:00', '#V1', 'Main minúsculo',  'main event', 10000, 20, null, 0.10, null, null, 10000, 8],
  ['10:00', '#V2', 'Main caixa alta', 'MAIN EVENT',  10000, 20, null, 0.10, null, null, 10000, 8],
  ['11:00', '#V3', 'Side sem "event"','Side',        1000,  10, null, 0.10, null, null, 10000, 8],
  ['12:00', 'SAT V4', 'Satelite sem acento', 'Satelite', 100, 5, null, 0.10, null, null, 10000, 5],
  ['13:00', 'SAT V5', 'Satellite EN',        'Satellite',100, 5, null, 0.10, null, null, 10000, 5],
  ['14:00', '#V6', 'Tipo de verdade estranho', 'Bounty', 500, 5, null, 0.10, null, null, 10000, 5],
  // TYPE PREENCHIDO fora dos radicais = Side por eliminação (regra da operação)
  ['15:00', '#V7', 'PKO qualquer',              'PKO',    800, 8, null, 0.10, null, null, 10000, 5],
  /* TYPE VAZIO com valores (o caso real: #AS Bounty, #AS Battle PKO, #AS Sonic) —
     NÃO pode ficar fora da divisão: entra classificado pelo nome/garantido. */
  ['16:00', '#V8', 'Sem TYPE mas com valores',  '',       500, 5, null, 0.10, null, null, 10000, 5],
  ['17:00', '#V9', 'SEATS pro Main',            '',       100, 5, null, 0.10, null, null, 10000, 5],
  ['18:00', '#V10','Sem TYPE garantido gordo',  '',     50000, 30, null, 0.10, null, null, 10000, 5]
];
const vcols = api.findHeaderCols(variantes);
const vsec = api.extractGuDaySection(variantes, 'WEDNESDAY', vcols);
ok(vsec.side.length === 4 && vsec.side[0].nome === 'Side sem "event"',
  '"Side", "Bounty" e "PKO" (TYPE preenchido fora dos radicais) caem em Side por eliminação');
ok(vsec.side.some(it => it.nome === 'Tipo de verdade estranho') && vsec.side.some(it => it.nome === 'PKO qualquer'),
  'Bounty e PKO viram Side, não desconhecido');
ok(vsec.unknown.length === 0, 'nada mais fica em "tipo não reconhecido" — tudo entra na divisão');

console.log('TYPE VAZIO na coluna D: entra na divisão, classificado pelo nome/garantido');
ok(vsec.side.some(it => it.nome === 'Sem TYPE mas com valores'), 'TYPE vazio + garantido pequeno → Side');
ok(vsec.sat.some(it => it.nome === 'SEATS pro Main'), 'TYPE vazio + nome com SEATS → Satélite');
ok(vsec.main.some(it => it.nome === 'Sem TYPE garantido gordo'), 'TYPE vazio + garantido ≥20k → Main');
ok(vsec.main.length === 3, 'Main = os 2 por TYPE + o deduzido pelo garantido');
ok(vsec.sat.length === 3, 'Satélite = os 2 por TYPE + o deduzido pelo nome');
ok(vsec.semTipo.length === 3, 'os 3 sem TYPE viram AVISO de conferência (não erro que exclui)');
ok(vsec.semTipo.every(x => x.nome && x.hora && x.cat), 'o aviso diz nome, horário e onde caiu');

console.log('buildSections (janela 06:10 → 05:30)');
const secTue = api.extractGuDaySection(matrix, 'TUESDAY', cols);
const built = api.buildSections(sec, secTue);
ok(built.side.some(it => it.nome === 'Side Mananha'), 'horário ≥ 06:10 do dia entra');
ok(!built.side.some(it => it.nome === 'Side Madrugada'), '05:00 do PRÓPRIO dia fica de fora (pertence à véspera)');
ok(built.side.some(it => it.nome === 'Side de Terça') === false, '12:00 do dia seguinte fica de fora (só madrugada ≤ 05:30 entra)');

console.log('semTipo sobrevive a buildSections (aviso de TYPE ausente chega até a Criação Noturna)');
const builtVar = api.buildSections(vsec, null);
ok(Array.isArray(builtVar.semTipo) && builtVar.semTipo.length === vsec.semTipo.length, 'buildSections propaga o semTipo da seção, não descarta');

console.log('coluna TYPE renomeada / ausente (a origem do bug crônico)');
/* cabeçalho com a coluna TYPE RENOMEADA para "TIPO DE TORNEIO" e com uma coluna
   "GAME TYPE" logo ao lado — o match tem que achar a TYPE e IGNORAR a Game Type. */
const HR1 = ['HORA','MTT','MTT MARKETING','TIPO DE TORNEIO','GAME TYPE','PRIZE POOL USD','BUY-IN','FEE'];
const renomeada = [
  ['G MTTS'], [], HR1, [null],
  [null, null, 'THURSDAY', null],
  ['20:00', '#R1', 'Main renomeado', 'Main Event', 'NLH', 30000, 50, 0.10],
  ['21:00', '#R2', 'Side renomeado', 'Side Event', 'PLO5', 2000, 15, 0.10]
];
const rcols = api.findHeaderCols(renomeada);
ok(rcols, 'acha o cabeçalho mesmo com a coluna TYPE renomeada');
const rgi = api.guIdx(rcols);
ok(rgi.tipo === 3, 'guIdx aponta pra "TIPO DE TORNEIO", NÃO pra "GAME TYPE"');
const rsec = api.extractGuDaySection(renomeada, 'THURSDAY', rcols);
ok(rsec && rsec.main.length === 1 && rsec.side.length === 1, 'Main/Side classificados certo pela coluna renomeada');
ok(rsec.tipoColMissing === false, 'coluna TYPE encontrada → sem flag de ausência');

/* cabeçalho SEM nenhuma coluna TYPE-ish: tem que sinalizar tipoColMissing pra virar aviso,
   e ainda assim classificar tudo pelo fallback (nada some da divisão). */
const HS1 = ['HORA','MTT','MTT MARKETING','PRIZE POOL USD','BUY-IN','FEE'];
const semColuna = [
  ['G MTTS'], [], HS1, [null],
  [null, null, 'FRIDAY', null],
  ['20:00', '#F1', 'Sem coluna type gordo', 50000, 50, 0.10],
  ['21:00', '#F2', 'Sem coluna type magro', 1000, 10, 0.10]
];
const scols = api.findHeaderCols(semColuna);
ok(scols && api.guIdx(scols).tipo === -1, 'sem coluna TYPE-ish acha o cabeçalho (âncora PRIZE) e tipo fica -1');
const ssec = api.extractGuDaySection(semColuna, 'FRIDAY', scols);
ok(ssec.tipoColMissing === true, 'coluna TYPE ausente → flag tipoColMissing pra virar aviso');
ok(ssec.main.length === 1 && ssec.side.length === 1, 'mesmo sem TYPE, tudo entra na divisão pelo fallback (nada some)');

console.log('formatadores');
ok(api.cellToHHMM(0.25) === '06:00', 'fração de dia vira HH:MM');
ok(api.timeToMinutes('06:10') === 370, 'HH:MM vira minutos');
ok(api.fmtExtraVal('FEE', 0.1) === '10%', 'fração em coluna de fee vira %');
ok(api.fmtExtraVal('HOUR LATE REG', 0.5) === '12:00', 'fração em coluna de horário vira HH:MM');

/* ══ FEE / ADMIN FEE — o rake vem DAQUI, não do nome do torneio ═══════════
   O Painel do Dia lê a aba MTTS BRAZIL, que não tem essas colunas; o índice
   abaixo é o que leva o FEE da G MTTS até lá, casado por nome+hora. Se ele
   parar de casar, o painel volta a ESTIMAR o rake sem avisar ninguém. */
console.log('colunas de FEE');
ok(api.isFeeLabel('fee') === true, 'FEE é coluna de fee');
ok(api.isFeeLabel('admin fee') === false, 'ADMIN FEE NÃO é a coluna FEE (tem slot próprio)');
ok(api.isFeeLabel('early bird') === false, 'EARLY BIRD não é fee');
ok(api.isAdminFeeLabel('admin fee') === true, 'ADMIN FEE reconhecida');
ok(api.isAdminFeeLabel('adm fee') === true, '"ADM FEE" (grafia curta da GU) reconhecida');
ok(api.isAdminFeeLabel('fee') === false, 'FEE sozinha não é admin fee');
const giFee = api.guIdx(cols);
ok(giFee.fee === 7 && giFee.adminFee === 8, 'guIdx acha FEE e ADMIN FEE pelo rótulo');

console.log('guFeeFrac');
ok(api.guFeeFrac(0.1) === 0.1, 'fração da GU passa direto');
ok(api.guFeeFrac(0) === 0, 'ZERO é valor válido (freeroll) — não pode virar null');
ok(api.guFeeFrac(10) === 0.1, 'percentual inteiro (10) vira 0,10');
ok(api.guFeeFrac('8%') === 0.08, 'texto com % vira fração');
ok(api.guFeeFrac('0,05') === 0.05, 'vírgula decimal vira fração');
ok(api.guFeeFrac(null) === null && api.guFeeFrac('') === null, 'célula vazia = sem dado');
ok(api.guFeeFrac('n/a') === null && api.guFeeFrac(-1) === null, 'lixo e negativo = sem dado');
ok(api.guFeeFrac(1) === null, '100% de rake é erro de digitação, não taxa');

console.log('índice de FEE (nome+hora)');
const idx = api.buildGuFeeIndex(matrix);
ok(idx && idx.count >= 5, 'indexa as linhas com FEE');
const f1 = api.guFeeOf(idx, '#AS 50K WarmUp', '14:00');
ok(f1 && f1.fee === 0.10 && f1.admin === 0.02, 'acha FEE e ADMIN FEE pelo nome de marketing + hora');
ok(Math.abs(f1.total - 0.12) < 1e-9, 'total = FEE + ADMIN FEE (o que a casa retém)');
const f2 = api.guFeeOf(idx, 'Side Mananha', '08:00');
ok(f2 && f2.fee === 0.10 && f2.admin === 0, 'ADMIN FEE vazia conta como 0, não como "sem dado"');
/* ARMADILHA DO SATÉLITE: no bloco SAT a MTT MARKETING guarda o GRUPO e o nome do
   satélite fica na coluna MTT curta. Indexar só pela marketing perdia 49 satélites
   por grade na planilha de produção. */
const fSat = api.guFeeOf(idx, 'SAT A2', '16:00');
ok(fSat && fSat.fee === 0.10, 'satélite casa pela coluna MTT curta (marketing vem mesclada/nula)');
ok(api.guFeeOf(idx, '#AS 50K WarmUp', null) !== null, 'sem hora, cai no casamento só por nome');
ok(api.guFeeOf(idx, 'Torneio que não existe', '14:00') === null, 'nome desconhecido devolve null (não chuta)');
ok(api.guFeeOf(idx, 'MONDAY', '00:00') === null, 'nome de DIA nunca entra no índice');
ok(api.buildGuFeeIndex(semColuna) !== null, 'planilha sem TYPE ainda indexa o FEE');

/* ── COLISÃO ALVO × SATÉLITE ──
   Na linha de satélite a MTT MARKETING guarda o EVENTO-ALVO, não o nome do
   torneio. Indexar ela ali gravava o alvo com o fee do SATÉLITE (5%) por cima
   do fee de verdade dele (12%) — 86 nomes com dois fees na planilha real. Hoje
   só empatava porque o horário desempatava; bastava um satélite rodar no mesmo
   horário do alvo pra o Main sair com 5% de rake.

   A ORDEM IMPORTA nesta fixture: o satélite de SEGUNDA alimenta um Main que só
   roda no DOMINGO, então o bloco de satélite vem ANTES da linha do alvo. Como o
   índice é "primeiro que entra vence", sem a correção o alvo herdava o 5% do
   satélite — e com o horário dos dois batendo, nem o desempate por hora salvava.
   Com o alvo listado primeiro o bug fica ESCONDIDO, e o teste não valeria nada. */
const HC = ['HORA','MTT','MTT MARKETING','TYPE','PRIZE POOL USD','BUY-IN','FEE','ADMIN FEE'];
const colisao = [
  ['G MTTS'], [], HC, [null],
  [null, null, 'MONDAY', null],
  ['12:00', 'Side Qualquer', 'Side Qualquer', 'Side Event', 1000, 10, 0.10, 0],
  [null, null, 'MTT', 'SATELLITE'],
  // satélite de SEGUNDA com o alvo (que roda no DOMINGO) na coluna de marketing
  ['21:00', '4 Seats Alvo', 'SPS 99-M Alvo', 'SAT', 400, 10, 0.05, 0],
  [null, null, 'SUNDAY', null],
  // o alvo de verdade, MESMO HORÁRIO, mas DEPOIS do satélite na planilha
  ['21:00', 'SPS Alvo', 'SPS 99-M Alvo', 'Main Event', 50000, 100, 0.10, 0.02]
];
const idxCol = api.buildGuFeeIndex(colisao);
const alvo = api.guFeeOf(idxCol, 'SPS 99-M Alvo', '21:00');
ok(alvo && alvo.fee === 0.10 && alvo.admin === 0.02, 'evento-alvo mantém o PRÓPRIO fee (12%) mesmo com o satélite listado antes dele');
const satCol = api.guFeeOf(idxCol, '4 Seats Alvo', '21:00');
ok(satCol && satCol.fee === 0.05, 'satélite no mesmo horário continua achando o fee dele (5%)');
ok(api.guFeeOf(idx, 'GRUPO SAT A', '15:00') === null, 'nome de grupo do bloco SAT não vira torneio no índice');

/* ── ARQUIVO SEM A ABA G MTTS ──
   O readSheetMatrix histórico cai na PRIMEIRA aba quando não acha a que pediu —
   ótimo pra grade (tolera renomeação), fatal pra procurar o FEE: leria a MTTS
   BRAZIL achando que é a G MTTS e mapearia colunas erradas. Por isso a busca do
   fee é `strict`. Sem a aba, o índice tem que vir NULL pra o painel avisar que o
   rake saiu estimado — nunca inventar número. */
const wbSemGMTTS = { SheetNames: ['MTTS BRAZIL'], Sheets: {} };
ok(api.workbookMatrix(wbSemGMTTS, 'g mtts', true) === null, 'strict: aba ausente devolve null, NÃO a primeira aba');
ok(api.guFeeIndexFromWorkbook(wbSemGMTTS) === null, 'arquivo sem G MTTS não gera índice de FEE (dispara o aviso)');

/* ── FEE VINDO DO `extra` (Liga Principal) ──
   A Liga Principal não sai da G MTTS: vem da planilha "GRADE TORNEIOS - LIGA
   PRINCIPAL" da GU, pré-carregada em liga-principal-data.js, com as colunas
   guardadas no `extra` de cada evento. Era o último canto do painel estimando
   rake por categoria. Usa os MESMOS predicados de rótulo da G MTTS, então não
   existe uma segunda definição de "coluna de fee" pra divergir. */
console.log('FEE vindo do extra (Liga Principal)');
const exLiga = api.guFeeFromExtra({ 'MTT': 'Corujão', 'FEE': 0.1, 'ADMIN FEE': 0, 'CHIPS': 50000 });
ok(exLiga && exLiga.fee === 0.1 && exLiga.admin === 0 && exLiga.total === 0.1, 'lê FEE/ADMIN FEE do extra');
const exSat = api.guFeeFromExtra({ 'MTT': '2 Vagas Sunday', 'FEE': 0.05, 'ADMIN FEE': 0 });
ok(exSat && exSat.total === 0.05, 'satélite da Liga Principal sai 5% da planilha, não da heurística de nome');
const exAdm = api.guFeeFromExtra({ 'FEE': 0.1, 'ADM FEE': 0.02 });
ok(exAdm && exAdm.total === 0.12, 'grafia "ADM FEE" também conta (mesmo predicado da G MTTS)');
ok(api.guFeeFromExtra({ 'FEE': 0.1 }).total === 0.1, 'sem coluna de admin, admin é 0');
ok(api.guFeeFromExtra({ 'FEE': 0, 'ADMIN FEE': 0 }).total === 0, 'freeroll (FEE 0) continua sendo valor, não vazio');
ok(api.guFeeFromExtra({ 'EARLY BIRD': 0.2, 'CHIPS': 50000 }) === null, 'extra sem coluna de fee devolve null (EARLY BIRD não é fee)');
ok(api.guFeeFromExtra(null) === null && api.guFeeFromExtra(undefined) === null, 'extra ausente devolve null');

console.log('FEE na linha extraída');
const secFee = api.extractGuDaySection(matrix, 'MONDAY', cols);
const warm = secFee.main.find(t => t.nome === '#AS 50K WarmUp');
ok(warm && warm.fee === 0.10 && warm.adminFee === 0.02, 'extractGuDaySection cola FEE/ADMIN FEE na linha');

console.log(`\n${passed} testes OK ✅`);

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
  buildSections, CONF_WINDOW_START_MIN, CONF_WINDOW_END_MIN, BRL_RATE});`)(api);

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

console.log('formatadores');
ok(api.cellToHHMM(0.25) === '06:00', 'fração de dia vira HH:MM');
ok(api.timeToMinutes('06:10') === 370, 'HH:MM vira minutos');
ok(api.fmtExtraVal('FEE', 0.1) === '10%', 'fração em coluna de fee vira %');
ok(api.fmtExtraVal('HOUR LATE REG', 0.5) === '12:00', 'fração em coluna de horário vira HH:MM');

console.log(`\n${passed} testes OK ✅`);

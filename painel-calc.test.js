/* Testes do painel-calc.js — rode com:  node painel-calc.test.js

   Estes números são os que o operador lê na tela pra decidir. O caso que
   motivou o arquivo: o multiplicador de Side Event SEM campanha estava
   documentado como 0.95 e implementado como 0.90, e a divergência sobreviveu
   porque nada travava o valor. Agora trava.
========================================================================= */
const assert = require('assert');
const C = require('./painel-calc.js');

let passed = 0;
function eq(got, exp, name) {
  assert.strictEqual(got, exp, `${name}: esperado ${exp}, veio ${got}`);
  passed++; console.log('  ✓ ' + name + ' = ' + got);
}
function ok(cond, name) { assert.ok(cond, name); passed++; console.log('  ✓ ' + name); }

/* ── 1. multiplicador do buy-in líquido = 1 − (FEE + ADMIN FEE da GU) ──
   Só existe multiplicador quando a GU disse o fee. A antiga `rakeFactor(cat,
   isCamp)` — satélite 0.95 / campanha 0.88 / resto 0.90 — foi REMOVIDA junto com
   a estimativa; se alguém a trouxer de volta, este teste denuncia. */
console.log('\nmultiplicador do buy-in líquido:');
{
  eq(typeof C.rakeFactor, 'undefined', 'rakeFactor(cat,isCamp) NÃO existe mais (não estimar)');
  eq(C.rakeFactorOf({ fee: 0.10, adminFee: 0 }),    0.90, 'FEE 10% → 0.90');
  eq(C.rakeFactorOf({ fee: 0.10, adminFee: 0.02 }), 0.88, 'FEE 10% + ADMIN 2% → 0.88');
  eq(C.rakeFactorOf({ fee: 0.05, adminFee: 0 }),    0.95, 'satélite FEE 5% → 0.95');
  eq(C.rakeFactorOf({ fee: 0, adminFee: 0 }),       1,    'freeroll → 1 (entrada inteira vai pro pote)');
  eq(C.rakeFactorOf({ nome: 'SPS sem fee' }),       null, 'sem FEE da GU não há multiplicador');
}

/* ── 2. Ações: premiação ÷ buy-in líquido ── */
console.log('\ncálculo de Ações:');
{
  const gu = (fee, admin) => ({ fee: fee, adminFee: admin || 0 });
  // 50.000 ÷ (500 × 0.90) = 111.1
  eq(C.acoes({ premiacao: 50000, buyin: 500, row: gu(0.10) }), 111.1, 'FEE 10%');
  // 50.000 ÷ (500 × 0.88) = 113.6
  eq(C.acoes({ premiacao: 50000, buyin: 500, row: gu(0.10, 0.02) }), 113.6, 'FEE 10% + ADMIN 2%');
  // 25K WarmUp real: 30.591 ÷ (110 × 0.90) = 309.0 (antes dava 316 com 0.88)
  eq(C.acoes({ premiacao: 30591, buyin: 110, row: gu(0.10) }), 309.0, 'WarmUp: 309, não 316');
  // 10.000 ÷ (50 × 0.95) = 210.5
  eq(C.acoes({ premiacao: 10000, buyin: 50, row: gu(0.05) }), 210.5, 'satélite');

  // SEM fee da GU não há divisor: a tela mostra "—" em vez de um número plausível
  eq(C.acoes({ premiacao: 50000, buyin: 500, row: {} }), null, 'sem FEE não calcula ações pela premiação');
  eq(C.acoes({ premiacao: 50000, buyin: 500, cat: 'side', isCamp: false }), null, 'categoria sozinha não basta (não estima)');
  // `field` é contagem de entradas: independe de rake, continua valendo
  eq(C.acoes({ premiacao: 50000, buyin: 500, field: 120, row: {} }), 120, 'sem FEE, o field ainda responde');

  // o fee da GU muda a conta — é por isso que ele não pode ser chutado
  eq(C.acoes({ premiacao: 30591, buyin: 110, row: gu(0.08) }), 302.3, 'FEE 8% dá 302.3, não 309');
}

/* ── 3. Ações: quando NÃO dá pra afirmar, devolve null (tela mostra "—") ── */
console.log('\nAções sem dado suficiente:');
{
  eq(C.acoes({ premiacao: 50000, buyin: 0,    cat: 'main' }), null, 'buy-in zero não vira divisão por zero');
  eq(C.acoes({ premiacao: 50000, buyin: null, cat: 'main' }), null, 'sem buy-in');
  eq(C.acoes({ premiacao: null,  buyin: 500,  cat: 'main' }), null, 'sem premiação nem field');
  eq(C.acoes({ premiacao: 0,     buyin: 500,  cat: 'main' }), null, 'premiação zero não conta');
  // antes da premiação sair, o field é a estimativa (independe de rake)
  eq(C.acoes({ premiacao: null, field: 87, buyin: 500, row: { fee: 0.10 } }), 87, 'usa field como estimativa');
  // premiação real vence a estimativa: 50.000 ÷ (500 × 0.90) = 111.1
  eq(C.acoes({ premiacao: 50000, field: 87, buyin: 500, row: { fee: 0.10 } }), 111.1, 'premiação real vence o field');
  // ...mas SÓ com o fee da GU; sem ele a premiação não vira ações e o field responde
  eq(C.acoes({ premiacao: 50000, field: 87, buyin: 500, row: {} }), 87, 'sem FEE, cai no field em vez de estimar o rake');
}

/* ── 4. Overlay = premiação − garantido ── */
console.log('\noverlay:');
{
  eq(C.calcOverlay(45000, 50000), -5000, 'premiação abaixo do garantido = overlay negativo');
  eq(C.calcOverlay(60000, 50000),  10000, 'premiação acima = excedente positivo');
  eq(C.calcOverlay(50000, 50000),  0,     'bateu exato = zero');
  eq(C.calcOverlay(null,  50000),  null,  'sem premiação = null, não zero');
  eq(C.calcOverlay(50000, 0),      null,  'sem garantido = null');
}

/* ── 5. Performance ── */
console.log('\nperformance %:');
{
  eq(C.perf(60000, 50000), 20,  '+20% acima do garantido');
  eq(C.perf(45000, 50000), -10, '-10% abaixo');
  eq(C.perf(50000, 0),     null, 'sem garantido não divide por zero');
}

/* ── 6. Categoria ── */
console.log('\nclassificação:');
{
  eq(C.classify({ tipo: 'Main Event' }),  'main', 'pela coluna Tipo');
  eq(C.classify({ tipo: 'Main event' }),  'main', 'tolerante a caixa');
  eq(C.classify({ tipo: 'Satelite' }),    'sat',  'satélite sem acento');
  eq(C.classify({ tipo: 'Satélite' }),    'sat',  'satélite com acento');
  eq(C.classify({ nome: '5 Seats WarmUp' }), 'sat', 'heurística: Seats vira satélite');
  eq(C.classify({ nome: 'Torneio X', garantido: 20000 }), 'main', 'garantido alto vira main');
  eq(C.classify({ nome: 'Torneio X', garantido: 5000 }),  'side', 'o resto é side');
}

/* ── 7. Campanha ── */
console.log('\ncampanha:');
{
  eq(C.hasCampanha({ nome: '#AS 50K Sunday' }), true,  '#AS');
  eq(C.hasCampanha({ nome: 'Torneio +SPS' }),   true,  '+SPS');
  eq(C.hasCampanha({ nome: 'Torneio SPT' }),    true,  'SPT');
  eq(C.hasCampanha({ nome: 'Torneio comum' }),  false, 'sem campanha');
}

/* ── 8. Rake ── */
/* Sem FEE da GU NÃO existe rake. A regra por nome/categoria (satélite 5% ·
   #AS/SPT/SPS 12% · resto 10%) saiu do sistema: ela devolvia número plausível e
   errado, indistinguível do certo na tela. Estes casos são exatamente os que ela
   respondia — todos têm que dar null agora. */
console.log('\nrake — linha SEM as colunas da GU:');
{
  eq(C.calcRake({ tipo: 'Satelite', nome: '#AS Sat' }),   null, 'satélite sem FEE não vira 5%');
  eq(C.calcRake({ tipo: 'Main Event', nome: '#AS 50K' }), null, 'campanha sem FEE não vira 12%');
  eq(C.calcRake({ tipo: 'Main Event', nome: '50K' }),     null, 'sem FEE não vira 10%');
  eq(C.rakeSource({ tipo: 'Main Event', nome: '50K' }),   null, 'sem FEE não há fonte de rake');
}

/* ── 8b. RAKE DA GU — a regra de verdade ──
   FEE e ADMIN FEE são colunas da planilha da GU. Quando a linha as traz, elas
   MANDAM: a retenção da casa é a soma das duas. Cada caso abaixo é um torneio
   real da grade em que a regra por nome/categoria dava outro número. */
console.log('\nrake — FEE + ADMIN FEE da GU (manda sobre a categoria):');
{
  eq(C.rakeSource({ nome: 'x', fee: 0.10 }), 'gu', 'linha com FEE tem fonte "gu"');
  eq(C.calcRake({ nome: 'x', fee: 0.10 }), 0.10, 'FEE sozinho já é rake (ADMIN vazio = 0)');
  eq(C.calcRake({ nome: 'SPS 43-M 50K WarmUp', fee: 0.10, adminFee: 0.02 }), 0.12, 'SPS padrão: 10% + 2%');
  // SPS 20-H 500K HighS: a regra por nome cobrava 12%; a GU cobra 8% + 2%
  eq(C.calcRake({ nome: 'SPS 20-H 500K HighS', fee: 0.08, adminFee: 0.02 }), 0.10, 'high stakes: 8% + 2% (a regra por nome dava 12%)');
  // FreeRoll Suprema: a regra por nome cobrava 10% de um torneio sem entrada
  eq(C.calcRake({ nome: 'FreeRoll Suprema', fee: 0, adminFee: 0 }), 0, 'freeroll é 0% (a regra por nome dava 10%)');
  // Start Free: satélite que a heurística por nome não reconhecia
  eq(C.calcRake({ nome: 'Start Free', tipo: 'Side Event', fee: 0.05, adminFee: 0 }), 0.05, 'satélite fora do padrão de nome: 5%');
  // SPS 15K Freeze: SPS sem admin fee cheio
  eq(C.calcRake({ nome: 'SPS 15K Freeze', fee: 0.08, adminFee: 0.02 }), 0.10, 'SPS com fee reduzido não vira 12% só por ser SPS');
  // a GU vence até quando a categoria diria outra coisa
  eq(C.calcRake({ tipo: 'Satelite', nome: '#AS Sat', fee: 0.10, adminFee: 0 }), 0.10, 'GU vence a regra de satélite');
  // célula lixo/vazia NÃO pode ser lida como 0% nem virar estimativa: é ausência
  eq(C.calcRake({ tipo: 'Main Event', nome: '#AS 50K', fee: null }),  null, 'FEE vazio = sem rake (não vira 0% nem 12%)');
  eq(C.calcRake({ tipo: 'Main Event', nome: '#AS 50K', fee: 'n/a' }), null, 'FEE ilegível = sem rake');
  // 1,5 na planilha é 1,5% (mesma leitura de "10" = 10%); o absurdo que vira null é >= 100%
  eq(C.calcRake({ nome: 'x', fee: 1.5 }), 0.015, 'FEE 1.5 lê como 1,5%');
  eq(C.calcRake({ nome: 'x', fee: 1 }),    null,  '100% de rake é erro de digitação, não taxa');
  eq(C.calcRake({ nome: 'x', fee: -0.1 }), null, 'FEE negativo = sem rake');
}

/* ── 9. Parse de número BR ── */
console.log('\nparse de número BR:');
{
  eq(C.toNumber('R$ 1.234,56'), 1234.56, 'R$ com milhar e decimal');
  eq(C.toNumber('1.234'),       1.234,   'só ponto = decimal padrão');
  eq(C.toNumber('1234,5'),      1234.5,  'só vírgula = decimal BR');
  eq(C.toNumber(''),            null,    'vazio');
  eq(C.toNumber(null),          null,    'null');
  eq(C.toNumber('abc'),         null,    'texto não numérico');
  eq(C.toNumber(42),            42,      'número passa direto');
}

console.log(`\n${passed} testes passaram.`);

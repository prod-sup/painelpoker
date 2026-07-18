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

/* ── 1. multiplicadores: o valor de cada categoria ── */
console.log('\nrake factor por categoria:');
{
  eq(C.rakeFactor('main', false), 0.88, 'Main Event');
  eq(C.rakeFactor('main', true),  0.88, 'Main Event com campanha (campanha não muda)');
  eq(C.rakeFactor('sat',  false), 0.95, 'Satélite');
  eq(C.rakeFactor('side', true),  0.88, 'Side COM campanha');
  eq(C.rakeFactor('side', false), 0.90, 'Side SEM campanha (0.90, NÃO 0.95)');
}

/* ── 2. Ações: premiação ÷ buy-in líquido ── */
console.log('\ncálculo de Ações:');
{
  // 50.000 ÷ (500 × 0.90) = 111.1
  eq(C.acoes({ premiacao: 50000, buyin: 500, cat: 'side', isCamp: false }), 111.1, 'side sem campanha');
  // 50.000 ÷ (500 × 0.88) = 113.6
  eq(C.acoes({ premiacao: 50000, buyin: 500, cat: 'side', isCamp: true }), 113.6, 'side com campanha');
  // 50.000 ÷ (500 × 0.88) = 113.6
  eq(C.acoes({ premiacao: 50000, buyin: 500, cat: 'main', isCamp: false }), 113.6, 'main');
  // 10.000 ÷ (50 × 0.95) = 210.5
  eq(C.acoes({ premiacao: 10000, buyin: 50, cat: 'sat', isCamp: false }), 210.5, 'satélite');

  // a divergência que passou despercebida, explícita: 111.1 (0.90) vs 105.3 (0.95)
  const a90 = C.acoes({ premiacao: 50000, buyin: 500, cat: 'side', isCamp: false });
  const a95 = Math.round((50000 / (500 * 0.95)) * 10) / 10;
  eq(a90, 111.1, 'com 0.90 (correto)');
  eq(a95, 105.3, 'com 0.95 (o que o comentário dizia)');
  eq(Math.round((a90 - a95) * 10) / 10, 5.8, 'a divergência valia 5,8 ações');
}

/* ── 3. Ações: quando NÃO dá pra afirmar, devolve null (tela mostra "—") ── */
console.log('\nAções sem dado suficiente:');
{
  eq(C.acoes({ premiacao: 50000, buyin: 0,    cat: 'main' }), null, 'buy-in zero não vira divisão por zero');
  eq(C.acoes({ premiacao: 50000, buyin: null, cat: 'main' }), null, 'sem buy-in');
  eq(C.acoes({ premiacao: null,  buyin: 500,  cat: 'main' }), null, 'sem premiação nem field');
  eq(C.acoes({ premiacao: 0,     buyin: 500,  cat: 'main' }), null, 'premiação zero não conta');
  // antes da premiação sair, o field é a estimativa
  eq(C.acoes({ premiacao: null, field: 87, buyin: 500, cat: 'main' }), 87, 'usa field como estimativa');
  // premiação real vence a estimativa
  eq(C.acoes({ premiacao: 50000, field: 87, buyin: 500, cat: 'main' }), 113.6, 'premiação real vence o field');
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
console.log('\nrake:');
{
  eq(C.calcRake({ tipo: 'Satelite', nome: '#AS Sat' }), 0.05, 'satélite é 5% mesmo com campanha no nome');
  eq(C.calcRake({ tipo: 'Main Event', nome: '#AS 50K' }), 0.12, 'com campanha 12%');
  eq(C.calcRake({ tipo: 'Main Event', nome: '50K' }),     0.10, 'sem campanha 10%');
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

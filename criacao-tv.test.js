/* Modo TV da Criação Noturna — rode com:  node criacao-tv.test.js

   O fundo WebGL (O Feltro) só vale a pena se CARREGAR ESTADO — é o que separa
   "ter shader" de parecer transmissão. As quatro entradas são dirigidas por
   `tvDriveFeltro`, e um erro ali não dá tela de erro: o telão simplesmente
   mente sobre o turno (sala fria com a noite atrasada, ou explodindo em loop).

   O teste extrai a função REAL do criacao-noturna.js e injeta um Feltro falso
   que grava as chamadas. Sem DOM, sem WebGL.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/criacao-noturna.js', 'utf8');
const m = src.match(/function tvDriveFeltro\([\s\S]*?\n\}/);
assert.ok(m, 'tvDriveFeltro não encontrada em criacao-noturna.js');

let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name + ' = ' + JSON.stringify(got));
}

/* monta um ambiente com os globais que a função lê */
function ambiente(itens, pctAnterior) {
  const chamadas = { heat: [], accent: [], pulse: 0, boom: 0 };
  const feltro = {
    heat(v) { chamadas.heat.push(v); return feltro; },
    accent(c) { chamadas.accent.push(c); return feltro; },
    pulse() { chamadas.pulse++; return feltro; },
    boom() { chamadas.boom++; return feltro; },
  };
  const DONE = {};
  itens.forEach((it, i) => { if (it.done) DONE['k' + i] = true; });
  const ctx = {
    TV_FELTRO: feltro,
    _tvPctAnterior: pctAnterior === undefined ? null : pctAnterior,
    DONE,
    itemKey: it => 'k' + itens.indexOf(it),
    urgency: it => (it.done ? null : it.urg || null),
  };
  const fn = new Function('ctx', `
    let TV_FELTRO = ctx.TV_FELTRO, _tvPctAnterior = ctx._tvPctAnterior;
    const DONE = ctx.DONE, itemKey = ctx.itemKey, urgency = ctx.urgency;
    ${m[0]}
    return (pct, all) => { tvDriveFeltro(pct, all); return _tvPctAnterior; };
  `)(ctx);
  return { fn, chamadas };
}

const item = (urg, done) => ({ urg, done: !!done });

/* ── 1. heat normaliza pelo total PENDENTE ──
   3 atrasados em 5 é pânico; 3 em 80 não é. Sem normalizar, uma grade grande
   nunca esquentaria e uma pequena viveria vermelha. */
console.log('\nheat normaliza pelo tamanho da grade:');
{
  const poucos = ambiente([item('late'), item('late'), item('late'), item(null), item(null)]);
  poucos.fn(0, [item('late'), item('late'), item('late'), item(null), item(null)]);

  const muitos = [];
  for (let i = 0; i < 80; i++) muitos.push(item(i < 3 ? 'late' : null));
  const grande = ambiente(muitos);
  grande.fn(0, muitos);

  eq(poucos.chamadas.heat[0] > grande.chamadas.heat[0], true,
     '3 atrasados em 5 esquenta mais que 3 em 80');
  eq(grande.chamadas.heat[0] < 0.2, true, '3 em 80 mantém a sala fria');
}

/* ── 2. atraso pesa o dobro do risco ── */
console.log('\natraso pesa mais que risco:');
{
  const comAtraso = ambiente([item('late'), item(null), item(null), item(null)]);
  comAtraso.fn(0, [item('late'), item(null), item(null), item(null)]);
  const comRisco = ambiente([item('warn'), item(null), item(null), item(null)]);
  comRisco.fn(0, [item('warn'), item(null), item(null), item(null)]);
  eq(comAtraso.chamadas.heat[0], 0.5, '1 atrasado em 4 pendentes = 0.5');
  eq(comRisco.chamadas.heat[0], 0.25, '1 em risco em 4 pendentes = 0.25');
}

/* ── 3. heat nunca passa de 1 (o shader espera 0..1) ── */
console.log('\nheat fica no intervalo do shader:');
{
  const todos = [item('late'), item('late'), item('late')];
  const a = ambiente(todos); a.fn(0, todos);
  eq(a.chamadas.heat[0] <= 1, true, 'tudo atrasado não estoura 1');
  eq(a.chamadas.heat[0], 1, 'satura em 1');
}

/* ── 4. divisão por zero: grade toda criada ── */
console.log('\nsem pendentes não divide por zero:');
{
  const tudoFeito = [item(null, true), item(null, true)];
  const a = ambiente(tudoFeito); a.fn(100, tudoFeito);
  eq(Number.isFinite(a.chamadas.heat[0]), true, 'heat continua número finito');
  eq(a.chamadas.heat[0], 0, 'sala fria: não há o que atrasar');
}

/* ── 5. a cor conta a história do turno ── */
console.log('\naccent por estado do turno:');
{
  const ok = [item(null), item(null)];
  let a = ambiente(ok); a.fn(50, ok);
  eq(a.chamadas.accent[0], '#22d47e', 'no prazo: verde-feltro');

  const atrasado = [item('late'), item(null)];
  a = ambiente(atrasado); a.fn(50, atrasado);
  eq(a.chamadas.accent[0], '#e0a33c', 'com atraso: âmbar');

  const feito = [item(null, true)];
  a = ambiente(feito); a.fn(100, feito);
  eq(a.chamadas.accent[0], '#c9a84c', 'fechado: dourado da casa');
}

/* ── 6. pulse e boom: o corte e a celebração ──
   O risco real aqui é o boom disparar a CADA render enquanto ninguém mexe —
   o telão explodindo em loop dourado a noite toda. */
console.log('\npulse no corte, boom só na virada:');
{
  const its = [item(null), item(null)];

  let a = ambiente(its, null);           // primeira pintura
  a.fn(50, its);
  eq([a.chamadas.pulse, a.chamadas.boom], [0, 0], 'abrir o telão não pulsa nem explode');

  a = ambiente(its, 40);                 // progrediu
  a.fn(50, its);
  eq([a.chamadas.pulse, a.chamadas.boom], [1, 0], 'torneio criado = pulse');

  a = ambiente(its, 50);                 // nada mudou
  a.fn(50, its);
  eq([a.chamadas.pulse, a.chamadas.boom], [0, 0], 're-render sem progresso não dispara nada');

  a = ambiente(its, 95);                 // fechou
  a.fn(100, its);
  eq([a.chamadas.pulse, a.chamadas.boom], [0, 1], 'chegar a 100% = boom');

  a = ambiente(its, 100);                // segue em 100 (sync repetido)
  a.fn(100, its);
  eq([a.chamadas.pulse, a.chamadas.boom], [0, 0], 'ficar em 100% NÃO explode de novo');
}

/* ── 7. sem Feltro (lite / sem WebGL) não pode quebrar o telão ── */
console.log('\nsem Feltro o modo TV continua de pé:');
{
  const fn = new Function('ctx', `
    let TV_FELTRO = null, _tvPctAnterior = null;
    const DONE = {}, itemKey = it => 'k', urgency = () => null;
    ${m[0]}
    return (pct, all) => tvDriveFeltro(pct, all);
  `)({});
  fn(50, [item(null)]);
  passed++; console.log('  ✓ TV_FELTRO nulo sai sem estourar');
}

console.log(`\n${passed} testes passaram.`);

/* Entrega do dia confirmada pelo TURNO — rode com:  node painel-entrega-turno.test.js

   POR QUÊ ESTE ARQUIVO EXISTE
   ---------------------------
   Trocar a GU tira o cronograma da tela de todo mundo, então a virada só acontece
   quando cada pessoa do turno confirma. O risco dessa regra não é ela deixar de
   contar um voto — é ela TRAVAR: se a contagem exigir confirmação de quem já foi
   embora, ou contar duas abas da mesma pessoa como duas pessoas, o turno noturno
   fica preso sem conseguir virar o dia, às 5 da manhã, sem ninguém pra ajudar.

   Por isso o que está testado aqui é, quase todo, ANTI-TRAVAMENTO:
     1. duas abas da mesma pessoa = UM voto;
     2. quem esfriou o heartbeat (fechou a aba, notebook hibernou) sai da conta;
     3. eu conto sempre, mesmo antes do meu primeiro heartbeat subir;
     4. nome com acento/caixa diferente é a MESMA pessoa (a chave do voto);
     5. com todos confirmados, `faltamConfirmar` devolve vazio (é o que fecha).
   ========================================================================= */
'use strict';
const fs = require('fs');
const vm = require('vm');

const painelSrc = fs.readFileSync(__dirname + '/painel.js', 'utf8');

let pass = 0;
const falhas = [];
function ok(nome, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + nome); }
  else falhas.push(nome + (extra ? ' — ' + extra : ''));
}

/* extrai `function NOME(...){...}` do texto por contagem de chaves */
function corpoFn(src, nome) {
  const i = src.indexOf('function ' + nome + '(');
  if (i < 0) throw new Error('não achei `function ' + nome + '` em painel.js');
  let d = 0, aberto = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { d++; aberto = true; }
    else if (src[k] === '}') { d--; if (aberto && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('chaves não fecharam para ' + nome);
}

const TRES_MIN = 3 * 60 * 1000;
const ctx = {
  console, Map, String, Array, Object, Date,
  PRESENCE_STALE_MS: TRES_MIN,
  OPERATOR_NAME: 'Thainã',
  PANEL_RO_BASE: false,
  window: { _presenceCache: {} },
};
vm.createContext(ctx);
vm.runInContext(
  corpoFn(painelSrc, 'votoKey') + '\n' +
  corpoFn(painelSrc, 'operadoresDoTurno') + '\n' +
  corpoFn(painelSrc, 'faltamConfirmar'), ctx);

const agora = Date.now();
const sessao = (name, idadeMs) => ({ name, at: agora - (idadeMs || 0) });

console.log('votoKey — uma pessoa é uma pessoa só:');
{
  ok('acento e caixa não criam pessoa nova',
    ctx.votoKey('Thainã') === ctx.votoKey('THAINA') && ctx.votoKey('Thainã') === ctx.votoKey('thaina'));
  ok('sobrenome faz parte da identidade', ctx.votoKey('Ana Paula') !== ctx.votoKey('Ana Souza'));
  ok('vazio não quebra', typeof ctx.votoKey(null) === 'string' && ctx.votoKey(null).length > 0);
}

console.log('operadoresDoTurno — quem precisa confirmar:');
{
  ctx.window._presenceCache = {
    s1: sessao('Thainã'),
    s2: sessao('Thainã'),            // MESMA pessoa, segunda aba
    s3: sessao('Bruno'),
  };
  const turno = ctx.operadoresDoTurno();
  ok('duas abas da mesma pessoa contam UMA vez', turno.length === 2, 'contou ' + turno.length);

  ctx.window._presenceCache = {
    s1: sessao('Thainã'),
    s3: sessao('Bruno', TRES_MIN + 1000),   // heartbeat frio: foi embora
  };
  ok('quem esfriou o heartbeat sai da conta (não trava a virada)',
    ctx.operadoresDoTurno().length === 1, JSON.stringify(ctx.operadoresDoTurno()));

  ctx.window._presenceCache = {};           // meu heartbeat ainda não subiu
  const so = ctx.operadoresDoTurno();
  ok('eu conto sempre, mesmo sem heartbeat meu no cache',
    so.length === 1 && so[0].k === ctx.votoKey('Thainã'));

  ctx.window._presenceCache = { s9: sessao('Bruno'), sx: { name: 'Zé' } };  // sx sem `at`
  ok('sessão sem timestamp é ignorada (registro corrompido não trava)',
    ctx.operadoresDoTurno().length === 2, JSON.stringify(ctx.operadoresDoTurno()));

  // TV / modo leitura: aparece nos avatares, mas não decide — senão uma tela ligada
  // num canto da sala segura a virada do turno inteiro e ninguém entende por quê
  ctx.window._presenceCache = {
    s1: sessao('Thainã'),
    tv: Object.assign(sessao('TV Sala'), { ro: true }),
  };
  const semTv = ctx.operadoresDoTurno();
  ok('sessão em modo leitura NÃO entra na conta',
    semTv.length === 1 && semTv[0].nome === 'Thainã', JSON.stringify(semTv));

  ctx.PANEL_RO_BASE = true;                 // EU sou a TV
  ctx.window._presenceCache = { s2: sessao('Bruno') };
  const euTv = ctx.operadoresDoTurno();
  ok('se EU sou a sessão de leitura, não me incluo',
    euTv.length === 1 && euTv[0].nome === 'Bruno', JSON.stringify(euTv));
  ctx.PANEL_RO_BASE = false;
}

console.log('faltamConfirmar — o que fecha (ou não) a votação:');
{
  ctx.window._presenceCache = { s1: sessao('Thainã'), s2: sessao('Bruno'), s3: sessao('Ana Paula') };
  const kT = ctx.votoKey('Thainã'), kB = ctx.votoKey('Bruno'), kA = ctx.votoKey('Ana Paula');

  const soProponente = { confirmados: { [kT]: { nome: 'Thainã', at: agora } } };
  ok('com só o proponente, faltam os outros dois', ctx.faltamConfirmar(soProponente).length === 2);

  const todos = { confirmados: {
    [kT]: { nome: 'Thainã', at: agora },
    [kB]: { nome: 'Bruno', at: agora },
    [kA]: { nome: 'Ana Paula', at: agora },
  } };
  ok('com todos confirmados, não falta ninguém (fecha)', ctx.faltamConfirmar(todos).length === 0);

  // Bruno confirmou e FOI EMBORA; Ana ainda está e já confirmou → tem que fechar
  ctx.window._presenceCache = { s1: sessao('Thainã'), s3: sessao('Ana Paula'), s2: sessao('Bruno', TRES_MIN + 1) };
  ok('quem saiu depois de votar não segura nada', ctx.faltamConfirmar(todos).length === 0);

  // Alguém ENTROU no turno no meio da votação: passa a ser exigido (é o certo —
  // acabou de chegar e o cronograma vai sumir da tela dele)
  ctx.window._presenceCache = { s1: sessao('Thainã'), s2: sessao('Bruno'), s3: sessao('Ana Paula'), s4: sessao('Carlos') };
  const faltaCarlos = ctx.faltamConfirmar(todos);
  ok('quem chega no meio entra na conta', faltaCarlos.length === 1 && faltaCarlos[0].nome === 'Carlos');

  ok('proposta sem confirmados não explode', ctx.faltamConfirmar({}).length === 4);
  ok('proposta nula não explode', ctx.faltamConfirmar(null).length === 4);
}

/* ═══════════════════════════════════════════════════════════════════════════
   aindaNaoComecou — a trava final contra "arrecadado preenchido sozinho".
   Torneio que ainda não começou não pode ter arrecadado COLETADO. É o que teria
   barrado o caso real: 01:41 da madrugada, "2 Seats SPT" das 09:00 aparecendo
   com R$ 165,30. Vale só nos caminhos AUTOMÁTICOS — o que o operador digita à
   mão é decisão dele e não passa por aqui.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('aindaNaoComecou — o que é impossível ter arrecadado:');
{
  const ctx2 = { console, Math };
  vm.createContext(ctx2);
  // opMinutes é a régua do dia operacional (<= 05:30 vai pro fim do dia, +1440);
  // copiada do painel de propósito, pra o teste falhar se a régua mudar lá.
  vm.runInContext(
    'function timeToMinutes(h){ const m = String(h||"").match(/^(\\d{1,2}):(\\d{2})/); return m ? (+m[1])*60 + (+m[2]) : null; }\n' +
    'function opMinutes(min){ return (min !== null && min <= 330) ? min + 1440 : min; }\n' +
    // `var` (não `let`): só var vira propriedade do contexto do vm, e é assim que
    // o teste consegue mexer no relógio de fora (ctx2.AGORA = ...)
    'var AGORA = 0; function opNowMinutes(){ return AGORA; }\n' +
    corpoFn(painelSrc, 'aindaNaoComecou'), ctx2);

  /* CENÁRIO DO BUG REAL: 01:41 da madrugada com a grade JÁ VIRADA para o dia
     seguinte (entrega antecipada). Aí `gradeDaysAhead()` vale 1 e o relógio
     operacional desconta 1440 — 01:41 volta a ser o COMEÇO do dia novo, e os
     torneios das 09:00/11:00 ainda estão inteiros pela frente. */
  ctx2.AGORA = ctx2.opMinutes(1 * 60 + 41) - 1440;   // = 101

  ok('torneio das 09:00 às 01:41, grade já virada = ainda não começou (o caso real)',
    ctx2.aindaNaoComecou({ nome: '2 Seats SPT', hora: '09:00' }) === true);
  ok('torneio das 11:00 no mesmo instante = ainda não começou',
    ctx2.aindaNaoComecou({ nome: '2 Seats SPT', hora: '11:00' }) === true);
  ok('card do PRÓX. CRONOGRAMA nunca recebe arrecadado automático',
    ctx2.aindaNaoComecou({ nome: 'X', hora: '23:00', proxCronograma: true }) === true);
  ok('sem horário reconhecível não bloqueia (não inventa regra)',
    ctx2.aindaNaoComecou({ nome: 'Y', hora: null }) === false);
  ok('linha nula não explode', ctx2.aindaNaoComecou(null) === false);

  /* MESMA HORA, grade AINDA no dia anterior (ninguém entregou): 01:41 é o FIM do
     dia operacional, então o 09:00 daquela grade já aconteceu de manhã. A régua
     tem que enxergar os dois casos, senão bloquearia resgate legítimo. */
  ctx2.AGORA = ctx2.opMinutes(1 * 60 + 41);          // = 1541
  ok('01:41 sem virada: o 09:00 daquela grade já passou (deixa reatar)',
    ctx2.aindaNaoComecou({ nome: '2 Seats SPT', hora: '09:00' }) === false);
  ok('01:00 às 01:41 já começou (não bloqueia)',
    ctx2.aindaNaoComecou({ nome: '#AS 10K Plus', hora: '01:00' }) === false);

  // meio da tarde: o dia já correu, quase nada é "futuro"
  ctx2.AGORA = ctx2.opMinutes(20 * 60);            // 20:00
  ok('às 20:00 o torneio das 09:00 já começou (deixa reatar)',
    ctx2.aindaNaoComecou({ nome: '2 Seats SPT', hora: '09:00' }) === false);
  ok('às 20:00 a madrugada seguinte (02:00) ainda não começou',
    ctx2.aindaNaoComecou({ nome: 'Z', hora: '02:00' }) === true);
}

console.log('');
if (falhas.length) {
  console.log(pass + ' ok, ' + falhas.length + ' FALHA(S):');
  falhas.forEach(f => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log(pass + ' verificações passaram.');
}

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
     5. com todos confirmados, `faltamConfirmar` devolve vazio (é o que fecha);
     6. FOI DESCANSAR (01/09/2026): a pessoa sai pro intervalo com a aba aberta, a
        máquina não dorme e o heartbeat segue batendo — ela parecia presente e
        travava a troca até a proposta expirar em 20 min. Agora, com a votação de
        pé há mais de ENTREGA_IDLE_MS, quem não encostou no painel desde que ela
        abriu sai da conta (vai pra `ausentes`, que não bloqueia);
     7. VISITA A DIA PASSADO (01/09/2026): quem está vendo o cronograma de ontem
        não recebe a barra de votação, então era um voto pendente que NUNCA podia
        ser dado. Agora não entra na conta;
     8. RELÓGIO DA MÁQUINA: o `at` da presença é hora do SERVIDOR. Comparado com
        Date.now() de um PC adiantado, todo mundo parecia offline e o dia virava
        sem votação nenhuma. As contas passam por nowSrv().
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

/* mesma ideia, para `const NOME = (args) => { ... }` (calcOverlay é assim) */
function corpoConst(src, nome) {
  const i = src.indexOf('const ' + nome + ' = (');
  if (i < 0) throw new Error('não achei `const ' + nome + '` em painel.js');
  let d = 0, aberto = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { d++; aberto = true; }
    else if (src[k] === '}') { d--; if (aberto && d === 0) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('chaves não fecharam para ' + nome);
}

const TRES_MIN   = 3 * 60 * 1000;
const QUATRO_MIN = 4 * 60 * 1000;
const ctx = {
  console, Map, String, Array, Object, Date,
  PRESENCE_STALE_MS: TRES_MIN,
  ENTREGA_IDLE_MS: QUATRO_MIN,
  OPERATOR_NAME: 'Thainã',
  PANEL_RO_BASE: false,
  VIEW_MODE_DATE: null,
  window: { _presenceCache: {} },
};
vm.createContext(ctx);
// `_srvSkew` e `_ultimaInteracao` são `let` no painel (não viram propriedade do
// contexto do vm). Aqui entram como `var` pra o teste poder mexer no relógio e na
// "última interação" de fora — as FUNÇÕES são as de verdade, tiradas do painel.js.
vm.runInContext(
  'var _srvSkew = 0;\n' +
  'var _ultimaInteracao = Date.now();\n' +
  corpoFn(painelSrc, 'nowSrv') + '\n' +
  corpoFn(painelSrc, 'minhaUltimaInteracaoSrv') + '\n' +
  corpoFn(painelSrc, 'votoKey') + '\n' +
  corpoFn(painelSrc, 'operadoresDoTurno') + '\n' +
  corpoFn(painelSrc, 'faltamConfirmar'), ctx);

const agora = Date.now();
const sessao = (name, idadeMs) => ({ name, at: agora - (idadeMs || 0) });
/* sessão com carimbo de última interação: `inativaHa` = há quanto tempo a pessoa
   não encosta no painel (o heartbeat continua fresco — é o caso do intervalo). */
const sessaoAtiva = (name, inativaHa) => ({ name, at: agora, act: agora - (inativaHa || 0) });
// atalhos: faltamConfirmar agora devolve {faltam, ausentes}
const faltam   = p => ctx.faltamConfirmar(p).faltam;
const ausentes = p => ctx.faltamConfirmar(p).ausentes;

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

  const soProponente = { at: agora, confirmados: { [kT]: { nome: 'Thainã', at: agora } } };
  ok('com só o proponente, faltam os outros dois', faltam(soProponente).length === 2);

  const todos = { at: agora, confirmados: {
    [kT]: { nome: 'Thainã', at: agora },
    [kB]: { nome: 'Bruno', at: agora },
    [kA]: { nome: 'Ana Paula', at: agora },
  } };
  ok('com todos confirmados, não falta ninguém (fecha)', faltam(todos).length === 0);

  // Bruno confirmou e FOI EMBORA; Ana ainda está e já confirmou → tem que fechar
  ctx.window._presenceCache = { s1: sessao('Thainã'), s3: sessao('Ana Paula'), s2: sessao('Bruno', TRES_MIN + 1) };
  ok('quem saiu depois de votar não segura nada', faltam(todos).length === 0);

  // Alguém ENTROU no turno no meio da votação: passa a ser exigido (é o certo —
  // acabou de chegar e o cronograma vai sumir da tela dele)
  ctx.window._presenceCache = { s1: sessao('Thainã'), s2: sessao('Bruno'), s3: sessao('Ana Paula'), s4: sessao('Carlos') };
  const faltaCarlos = faltam(todos);
  ok('quem chega no meio entra na conta', faltaCarlos.length === 1 && faltaCarlos[0].nome === 'Carlos');

  ok('proposta sem confirmados não explode', faltam({}).length === 4);
  ok('proposta nula não explode', faltam(null).length === 4);
}

/* ═══════════════════════════════════════════════════════════════════════════
   FOI DESCANSAR — o travamento que motivou a mudança de 01/09/2026.
   O operador sai pro intervalo e deixa a aba aberta. A máquina não hiberna, o
   heartbeat continua batendo de minuto em minuto: pra votação ele estava
   "presente" e os outros ficavam presos até a proposta expirar em 20 min.
   O sinal que separa os dois casos é o `act` — última interação DE VERDADE.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('faltamConfirmar — quem foi descansar não trava a virada:');
{
  const kT = ctx.votoKey('Thainã');
  const soEu = quando => ({ at: quando, confirmados: { [kT]: { nome: 'Thainã', at: quando } } });

  // Bruno com a aba aberta e SEM encostar no painel desde antes da votação abrir
  ctx.window._presenceCache = { s1: sessaoAtiva('Thainã', 0), s2: sessaoAtiva('Bruno', 30 * 60 * 1000) };

  // ...mas a votação acabou de abrir: ninguém é descartado antes do prazo de graça
  const nova = soEu(agora);
  ok('nos primeiros minutos ninguém é descartado (prazo de graça)',
    faltam(nova).length === 1 && faltam(nova)[0].nome === 'Bruno');
  ok('e ninguém é marcado como ausente ainda', ausentes(nova).length === 0);

  // ...votação de pé há mais de 4 min: Bruno sai da conta e a troca pode fechar
  const velha = soEu(agora - (QUATRO_MIN + 30 * 1000));
  ok('depois de ENTREGA_IDLE_MS, quem não encostou no painel sai da conta (DESTRAVA)',
    faltam(velha).length === 0, JSON.stringify(faltam(velha)));
  ok('e ele aparece em `ausentes`, pra virar linha no log (não some calado)',
    ausentes(velha).length === 1 && ausentes(velha)[0].nome === 'Bruno');

  // quem ESTÁ trabalhando (encostou depois que a votação abriu) continua bloqueando
  ctx.window._presenceCache = { s1: sessaoAtiva('Thainã', 0), s2: sessaoAtiva('Bruno', 10 * 1000) };
  ok('quem encostou no painel DEPOIS da votação abrir continua sendo esperado',
    faltam(velha).length === 1 && faltam(velha)[0].nome === 'Bruno');

  // sessão de cliente antigo (sem `act`) nunca é descartada — na dúvida, espera
  ctx.window._presenceCache = { s1: sessaoAtiva('Thainã', 0), s2: sessao('Bruno') };
  ok('sessão sem `act` (aba de versão antiga) nunca é descartada por inatividade',
    faltam(velha).length === 1 && ausentes(velha).length === 0);

  // duas abas da mesma pessoa: basta UMA estar sendo usada pra ela contar presente
  ctx.window._presenceCache = {
    s1: sessaoAtiva('Thainã', 0),
    s2: sessaoAtiva('Bruno', 30 * 60 * 1000),   // notebook esquecido na mesa
    s3: sessaoAtiva('Bruno', 5 * 1000),         // celular na mão, ativo agora
  };
  ok('a aba ATIVA da pessoa manda: ela segue sendo esperada',
    faltam(velha).length === 1 && faltam(velha)[0].nome === 'Bruno');
}

/* ═══════════════════════════════════════════════════════════════════════════
   VISITA A DIA PASSADO — quem está vendo o cronograma de ontem não recebe a
   barra de votação (avaliarProposta sai antes de desenhar). Se ainda assim
   entrasse na conta, seria um voto pendente que NUNCA poderia ser dado.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('visita a dia passado não vota (e não trava):');
{
  ctx.window._presenceCache = { s1: sessaoAtiva('Thainã', 0), s2: sessaoAtiva('Bruno', 0) };

  // a presença de quem visita é publicada com ro:true (myPresencePayload)
  ctx.window._presenceCache.s2.ro = true;
  const semVisitante = ctx.operadoresDoTurno();
  ok('quem está visitando um dia passado sai da conta',
    semVisitante.length === 1 && semVisitante[0].nome === 'Thainã', JSON.stringify(semVisitante));
  delete ctx.window._presenceCache.s2.ro;

  // e EU, se estiver visitando, também não me incluo
  ctx.VIEW_MODE_DATE = '2026-08-31';
  ctx.window._presenceCache = { s2: sessaoAtiva('Bruno', 0) };
  const euVisitando = ctx.operadoresDoTurno();
  ok('se EU estou visitando, não me incluo na votação',
    euVisitando.length === 1 && euVisitando[0].nome === 'Bruno', JSON.stringify(euVisitando));
  ctx.VIEW_MODE_DATE = null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RELÓGIO DA MÁQUINA — `at` é hora do SERVIDOR. Comparado com Date.now() num PC
   adiantado, TODAS as outras sessões pareciam velhas: operadoresDoTurno()
   devolvia só a própria pessoa, `turno.length > 1` dava falso lá em
   confirmarEntregaDoDia e o dia virava SEM votação nenhuma.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('relógio desregulado não apaga o turno:');
{
  ctx.window._presenceCache = { s1: sessaoAtiva('Thainã', 0), s2: sessaoAtiva('Bruno', 0), s3: sessaoAtiva('Ana Paula', 0) };
  ok('relógio certo: o turno inteiro conta', ctx.operadoresDoTurno().length === 3);

  // PC 10 min ADIANTADO em relação ao servidor → skew negativo corrige a conta
  ctx._srvSkew = -10 * 60 * 1000;
  ok('PC 10 min adiantado: o turno continua inteiro (antes sobrava só eu)',
    ctx.operadoresDoTurno().length === 3, JSON.stringify(ctx.operadoresDoTurno()));

  // PC 10 min ATRASADO → skew positivo; quem de fato esfriou continua saindo
  ctx._srvSkew = 10 * 60 * 1000;
  ctx.window._presenceCache = {
    s1: { name: 'Thainã', at: agora + 10 * 60 * 1000, act: agora + 10 * 60 * 1000 },
    s2: { name: 'Bruno',  at: agora + 10 * 60 * 1000 - (TRES_MIN + 1000), act: agora },
  };
  ok('PC 10 min atrasado: quem realmente esfriou ainda sai da conta',
    ctx.operadoresDoTurno().length === 1, JSON.stringify(ctx.operadoresDoTurno()));
  ctx._srvSkew = 0;
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

/* ═══════════════════════════════════════════════════════════════════════════
   overlayDoDia — overlay não pode aparecer em card em branco.
   Relatado pelo operador: "Step Punta Cana 1M", 09:30, garantido R$75, arrecadado
   VAZIO, e mesmo assim a coluna mostrava −R$75. Vinha da regra do freeroll
   (buy-in 0 = a casa paga o garantido inteiro), que é certa DEPOIS do torneio
   acontecer e vira projeção assustadora antes dele começar.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('overlayDoDia — overlay só quando existe base real:');
{
  const ctx3 = { console, Math, Number, isNaN, String };
  vm.createContext(ctx3);
  vm.runInContext(
    'function timeToMinutes(h){ const m = String(h||"").match(/^(\\d{1,2}):(\\d{2})/); return m ? (+m[1])*60 + (+m[2]) : null; }\n' +
    'function opMinutes(min){ return (min !== null && min <= 330) ? min + 1440 : min; }\n' +
    'var AGORA = 0; function opNowMinutes(){ return AGORA; }\n' +
    corpoFn(painelSrc, 'aindaNaoComecou') + '\n' +
    corpoConst(painelSrc, 'calcOverlay') + '\n' +
    corpoFn(painelSrc, 'overlayDoDia'), ctx3);

  const step = { nome: 'Step Punta Cana 1M', hora: '09:30', buyin: 0 };   // freeroll/step manual
  const normal = { nome: '3K Plus', hora: '09:00', buyin: 30 };

  ctx3.AGORA = ctx3.opMinutes(1 * 60 + 41) - 1440;      // 01:41, grade já virada → 09:30 é futuro
  ok('freeroll ANTES de começar e sem arrecadado NÃO tem overlay (o bug reportado)',
    ctx3.overlayDoDia(null, 75, step) === null);
  ok('freeroll antes de começar, mas com valor lançado, respeita o operador',
    ctx3.overlayDoDia(40, 75, step) === -35);
  ok('torneio normal sem arrecadado nunca teve overlay',
    ctx3.overlayDoDia(null, 3000, normal) === null);

  ctx3.AGORA = ctx3.opMinutes(20 * 60);                  // 20:00 — o dia correu
  ok('freeroll DEPOIS de começar tem overlay = −garantido (regra preservada)',
    ctx3.overlayDoDia(null, 75, step) === -75);
  ok('torneio normal com arrecadado abaixo do gtd',
    ctx3.overlayDoDia(2000, 3000, normal) === -1000);
  ok('torneio normal com arrecadado acima do gtd vira excedente',
    ctx3.overlayDoDia(3500, 3000, normal) === 500);
  ok('sem garantido não há overlay', ctx3.overlayDoDia(100, 0, normal) === null);
  ok('linha sem buy-in (dado faltando) não vira freeroll',
    ctx3.overlayDoDia(null, 75, { nome: 'X', hora: '09:30' }) === null);
}

console.log('');
if (falhas.length) {
  console.log(pass + ' ok, ' + falhas.length + ' FALHA(S):');
  falhas.forEach(f => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log(pass + ' verificações passaram.');
}

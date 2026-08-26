/* Fee da GU no Painel do Dia — rode com:  node painel-fee-gu.test.js

   POR QUÊ ESTE ARQUIVO EXISTE
   ---------------------------
   O rake vem SÓ das colunas FEE e ADMIN FEE da GU. Quando uma linha chega sem
   elas (planilha subida antes da mudança, localStorage antigo, painel
   desatualizado do parceiro), o rake fica `null` — e aí some TUDO que depende
   dele. O caso caro é a Calculadora de Overlay: o Pote alimenta a premiação do
   card por `ovcAutoApplyToCard`, e sem rake a função saía antes de chamá-la.
   Sintoma relatado: "a calculadora não está mais puxando pro card".

   Duas defesas, as duas testadas aqui:
     1. hidratarFeeGU — completa a linha pelo mapa `painel/guFees` (valor da GU,
        consultado pelo nome; NÃO é estimativa por categoria).
     2. ovcCalculate — mesmo sem rake precisa chamar ovcAutoApplyToCard, pra o
        badge de "aplicado no card" não ficar de pé mentindo.
   ========================================================================= */
'use strict';
const fs = require('fs');
const vm = require('vm');

const painelSrc = fs.readFileSync(__dirname + '/painel.js', 'utf8');
const guSrc = fs.readFileSync(__dirname + '/gu-parser.js', 'utf8');

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

/* sandbox com as duas funções puras do painel + um GU_FEE_MAP controlado */
const ctx = { console, Map, String, Array, Object, GU_FEE_MAP: new Map() };
vm.createContext(ctx);
vm.runInContext(corpoFn(painelSrc, 'guNormNome') + '\n' + corpoFn(painelSrc, 'hidratarFeeGU'), ctx);

console.log('hidratarFeeGU — completar a linha pelo mapa da GU:');
{
  ctx.GU_FEE_MAP = new Map([
    ['sps 43-m 50k warmup', { f: 0.10, a: 0.02 }],
    ['freeroll suprema', { f: 0, a: 0 }],
    ['4 seats warmup', { f: 0.05, a: 0 }],
  ]);

  const linhas = [
    { nome: 'SPS 43-M 50K WarmUp' },                       // sem fee → completa
    { nome: 'FreeRoll Suprema' },                          // fee 0 é VALOR
    { nome: '4 Seats WarmUp' },
    { nome: 'SPS 43-M 50K WarmUp', fee: 0.08, adminFee: 0.02 }, // JÁ tem → nao mexe
    { nome: 'Torneio Fora do Mapa' },                      // nao inventa
  ];
  const n = ctx.hidratarFeeGU(linhas);

  ok('completa só as linhas que faltavam', n === 3, 'completou ' + n);
  ok('pega FEE e ADMIN FEE do mapa', linhas[0].fee === 0.10 && linhas[0].adminFee === 0.02);
  ok('FEE 0 (freeroll) é valor, não ausência', linhas[1].fee === 0 && linhas[1].adminFee === 0);
  ok('satélite vem 5% do mapa', linhas[2].fee === 0.05);
  ok('NÃO sobrescreve linha que já traz o fee', linhas[3].fee === 0.08, 'virou ' + linhas[3].fee);
  ok('nome fora do mapa fica SEM fee (não inventa)', linhas[4].fee === undefined);

  // mapa vazio nao pode "limpar" nem quebrar
  ctx.GU_FEE_MAP = new Map();
  const intactas = [{ nome: 'X', fee: 0.1 }, { nome: 'Y' }];
  ok('mapa vazio não altera nada', ctx.hidratarFeeGU(intactas) === 0 && intactas[0].fee === 0.1);
  ok('aguenta entrada inválida', ctx.hidratarFeeGU(null) === 0);
}

/* ── A CHAVE DO MAPA ──
   O mapa é gravado pelo painel com as chaves normalizadas pelo normText do
   gu-parser. Se o guNormNome do painel divergir, NADA casa e o sintoma volta
   sem nenhum erro na tela. */
console.log('\nnormalização do nome (chave do mapa):');
{
  const gu = {};
  new Function('api', guSrc + ';api.normText = normText;')(gu);
  const nomes = ['SPS 43-M 50K WarmUp', '  Corujão  ', 'SPS 7.5K Sônic', 'ÁGUIA #AS', '4 Seats Battle HR', ''];
  let igual = true, bad = '';
  nomes.forEach(n => {
    const a = ctx.guNormNome(n), b = gu.normText(n);
    if (a !== b) { igual = false; bad = JSON.stringify(n) + ' painel=' + JSON.stringify(a) + ' gu-parser=' + JSON.stringify(b); }
  });
  ok('guNormNome do painel == normText do gu-parser', igual, bad);
  ok('tira acento e caixa', ctx.guNormNome('SPS Sônic') === 'sps sonic');
  ok('apara as bordas', ctx.guNormNome('  Corujão  ') === 'corujao');
}

/* ── A REGRESSÃO EM SI ──
   ovcCalculate tem DOIS caminhos de saída (com rake e sem rake). Os dois
   precisam passar por ovcAutoApplyToCard: é ela que sincroniza o pote com a
   premiação do card e controla o badge. O caminho "sem rake" saía antes. */
console.log('\ncalculadora de overlay -> card:');
{
  const fn = corpoFn(painelSrc, 'ovcCalculate');
  const chamadas = (fn.match(/ovcAutoApplyToCard\s*\(/g) || []).length;
  ok('ovcCalculate chama ovcAutoApplyToCard nos DOIS caminhos', chamadas >= 2, 'achou ' + chamadas + ' chamada(s)');

  // e a chamada do caminho sem rake tem que vir ANTES do return dele
  const semRake = fn.slice(fn.indexOf('if (rake == null)'));
  const posApply = semRake.indexOf('ovcAutoApplyToCard');
  const posReturn = semRake.indexOf('return;');
  ok('no caminho sem rake, aplica ANTES de sair', posApply > -1 && posApply < posReturn,
     'apply@' + posApply + ' return@' + posReturn);

  ok('ingest hidrata o fee antes de renderizar', /hidratarFeeGU\(RAW_ROWS\)/.test(painelSrc));
  ok('o painel busca o mapa no Firebase', /ref\('painel\/guFees'\)/.test(painelSrc));
  ok('e monta da planilha da GU se o nó nao existir', /fetchGuSheetBuffer\(\)/.test(painelSrc));
}

/* ── BOTAO "IR PARA O CARD" ──────────────────────────────────────────────────
   Ele mora DENTRO do #ovcSyncBadge, e o badge so ganhava .show depois que o
   pote era aplicado na premiacao. Resultado: enquanto o operador PREENCHIA a
   calculadora, nao existia botao pra saltar ao card. O estado 'linked' resolve
   isso — badge visivel e neutro desde a selecao do torneio.
   Aqui os estados rodam DE VERDADE contra um DOM de mentira. */
console.log('\nbadge do vinculo com o card (estados reais):');
{
  function elStub() {
    const cls = new Set();
    const span = { textContent: '' };
    return {
      classList: {
        add: (...c) => c.forEach(x => cls.add(x)),
        remove: (...c) => c.forEach(x => cls.delete(x)),
        contains: (c) => cls.has(c),
      },
      querySelector: () => span,
      _span: span,
      _cls: cls,
    };
  }

  const badge = elStub();
  const select = { value: '' };
  const aplicados = [];
  const ctx2 = {
    console, Set, setTimeout, clearTimeout, window: {},
    OPERATOR_NAME: 'Op',
    fmtBRL: (n) => String(n),
    rowByKey: (k) => (k === 'k1' ? { nome: 'SPS 43-M 50K WarmUp' } : null),
    applyPremiacaoValue: (k, v) => aplicados.push([k, v]),
    document: { getElementById: (id) => (id === 'ovcSyncBadge' ? badge : id === 'ovcTorneioSelect' ? select : null) },
  };
  vm.createContext(ctx2);
  vm.runInContext(corpoFn(painelSrc, 'ovcSetBadge') + '\n' + corpoFn(painelSrc, 'ovcAutoApplyToCard'), ctx2);

  // 1) torneio escolhido, pote AINDA zero (operador digitando)
  select.value = 'k1';
  ctx2.ovcAutoApplyToCard(0);
  ok('preenchendo: badge VISIVEL (botao "Ir para o card" a mao)', badge._cls.has('show'));
  ok('preenchendo: estado neutro, sem verde de sucesso', badge._cls.has('linked'));
  ok('preenchendo: texto nao afirma que aplicou', !/aplicado/i.test(badge._span.textContent), badge._span.textContent);
  ok('preenchendo: NAO grava premiacao no card', aplicados.length === 0);

  // 2) sem torneio escolhido: badge some (nao ha card pra ir)
  select.value = '';
  ctx2.ovcAutoApplyToCard(0);
  ok('sem torneio: badge escondido', !badge._cls.has('show'));

  // 3) torneio + pote > 0 -> a calculadora NAO grava no card (Brian: nenhum valor
  //    entra no arrecadado sozinho). Badge segue visivel e NEUTRO ('linked'); nao ha
  //    mais estado 'applied' nem escrita na premiacao.
  select.value = 'k1';
  aplicados.length = 0;
  ctx2.ovcAutoApplyToCard(1000);
  ok('com pote: badge continua visivel', badge._cls.has('show'));
  ok('com pote: continua neutro (nao ha mais "aplicado")', badge._cls.has('linked'));
  ok('com pote: NAO grava premiacao no card', aplicados.length === 0);
  ok('com pote: texto nao afirma que aplicou', !/aplicado/i.test(badge._span.textContent), badge._span.textContent);

  // 4) torneio que nao existe na agenda nao pode deixar badge fantasma
  select.value = 'inexistente';
  ctx2.ovcAutoApplyToCard(1000);
  ok('torneio inexistente: badge escondido', !badge._cls.has('show'));
}

console.log('\nfiacao do botao:');
{
  ok('o botao existe no HTML', /id="ovcGoToCardBtn"/.test(fs.readFileSync(__dirname + '/index.html', 'utf8')));
  ok('e esta ligado ao ovcGoToCard', /ovcGoToCardBtn'\)\?\.addEventListener\('click', ovcGoToCard\)/.test(painelSrc));
  ok('a selecao do torneio ja acende o badge', /ovcSetBadge\('linked', row\.nome\)/.test(painelSrc));
  ok('limpar a calculadora apaga o badge', /ovcSetBadge\('none'\)/.test(painelSrc));
  const css = fs.readFileSync(__dirname + '/painel.css', 'utf8');
  ok('o CSS tem o estado neutro .linked', /\.ovc-sync-badge\.linked\{/.test(css));
  ok('e esconde o check no estado neutro', /\.ovc-sync-badge\.linked > svg\{\s*display:none/.test(css));
}

console.log('\n' + (falhas.length ? '❌' : '✅') + ' fee da GU no painel: ' + pass + ' checagens passaram' +
  (falhas.length ? ', ' + falhas.length + ' FALHARAM:\n  - ' + falhas.join('\n  - ') : ''));
process.exit(falhas.length ? 1 : 0);

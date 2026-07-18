/* Testes do painel-actions.js — rode com:  node painel-actions.test.js

   O despachante substituiu 44 handlers inline do index.html. Um erro aqui não
   dá tela de erro: o botão simplesmente PARA DE FUNCIONAR, e isso só aparece
   com o operador no meio do turno. Então a lógica de despacho é testada.

   Sem jsdom de propósito: o repo não tem dependências (mesma receita do
   gu-parser/radar-core). O DOM abaixo é o mínimo que o despachante usa —
   addEventListener, closest, getAttribute, event.target/type.
========================================================================= */
const assert = require('assert');
const fs = require('fs');

let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name);
}

/* ── DOM mínimo ── */
function makeEl(attrs, parent) {
  const el = {
    attrs: attrs || {},
    parent: parent || null,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    closest(sel) {
      const key = sel.replace(/^\[|\]$/g, '');
      let n = this;
      while (n) { if (n.getAttribute && n.getAttribute(key) !== null) return n; n = n.parent; }
      return null;
    },
  };
  return el;
}

/* carrega o despachante com um document/window falsos */
function load() {
  const listeners = {};
  const doc = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    _els: {},
    getElementById(id) { return this._els[id] || null; },
  };
  const win = {};
  const warns = [];
  const console_ = { warn: (...a) => warns.push(a.join(' ')) };
  const src = fs.readFileSync(__dirname + '/painel-actions.js', 'utf8');
  new Function('document', 'window', 'console', src)(doc, win, console_);
  const fire = (type, target) => {
    (listeners[type] || []).forEach(fn => fn({ type, target }));
  };
  return { doc, win, fire, warns };
}

/* ── 1. despacho simples: chama a global de mesmo nome ── */
console.log('\ndespacho básico:');
{
  const { win, fire } = load();
  let chamou = null;
  win.toggleCompactMode = function () { chamou = 'sim'; };
  fire('click', makeEl({ 'data-act': 'toggleCompactMode' }));
  eq(chamou, 'sim', 'clique aciona a função pelo data-act');
}

/* ── 2. argumento e elemento: a assinatura original era fn(arg, el) ── */
console.log('\nassinatura fn(arg, elemento):');
{
  const { win, fire } = load();
  let recebeu = null;
  win.setUpcomingCat = function (arg, el) { recebeu = { arg, temEl: !!el }; };
  const el = makeEl({ 'data-act': 'setUpcomingCat', 'data-arg': 'soon' });
  fire('click', el);
  eq(recebeu, { arg: 'soon', temEl: true }, 'passa o data-arg e o elemento');
}
{
  const { win, fire } = load();
  let args = null;
  win.toggleActivityLog = function (...a) { args = a; };
  fire('click', makeEl({ 'data-act': 'toggleActivityLog' }));
  eq(args, [], 'sem data-arg, chama sem argumentos');
}

/* ── 3. clique num FILHO do botão também conta (delegação real) ── */
console.log('\ndelegação a partir de filho:');
{
  const { win, fire } = load();
  let chamou = 0;
  win.doLogin = function () { chamou++; };
  const botao = makeEl({ 'data-act': 'doLogin' });
  const icone = makeEl({}, botao);          // <svg> dentro do <button>
  fire('click', icone);
  eq(chamou, 1, 'clique no ícone dentro do botão aciona a ação');
}

/* ── 4. change não pode disparar ação de click (e vice-versa) ── */
console.log('\nseparação click × change:');
{
  const { win, fire } = load();
  let click = 0, change = 0;
  win.toggleCompactMode = () => click++;
  win.ovcOnSelectChange = () => change++;
  const btn = makeEl({ 'data-act': 'toggleCompactMode' });
  const sel = makeEl({ 'data-act': 'ovcOnSelectChange', 'data-act-on': 'change' });

  fire('change', btn);   // botão de click recebendo change: ignora
  eq(click, 0, 'change não dispara ação de click');
  fire('click', sel);    // select de change recebendo click: ignora
  eq(change, 0, 'click não dispara ação de change');
  fire('click', btn);  eq(click, 1, 'click dispara ação de click');
  fire('change', sel); eq(change, 1, 'change dispara ação de change');
}

/* ── 5. clique fora de qualquer [data-act] não faz nada ── */
console.log('\nclique solto:');
{
  const { fire, warns } = load();
  fire('click', makeEl({}));
  eq(warns, [], 'clique sem data-act não avisa nem quebra');
}

/* ── 6. ação sem função: avisa em vez de estourar ── */
console.log('\nação sem função:');
{
  const { fire, warns } = load();
  fire('click', makeEl({ 'data-act': 'funcaoQueNaoExiste' }));
  eq(warns.length, 1, 'avisa no console');
  eq(warns[0].includes('funcaoQueNaoExiste'), true, 'o aviso diz qual ação faltou');
}

/* ── 7. backdrop do perfil: só fecha clicando no FUNDO ──
   Era onclick="if(event.target===this)closeUserProfile()". Se isso quebrar, o
   modal fecha ao clicar dentro dele — some com o que o operador está lendo. */
console.log('\nbackdrop do perfil:');
{
  const { win, fire } = load();
  let fechou = 0;
  win.closeUserProfile = () => fechou++;
  const fundo = makeEl({ 'data-act': 'closeProfileBackdrop' });
  const cartao = makeEl({}, fundo);

  fire('click', cartao);
  eq(fechou, 0, 'clique DENTRO do cartão não fecha');
  fire('click', fundo);
  eq(fechou, 1, 'clique no fundo fecha');
}

/* ── 8. ações locais que substituíram DOM inline no atributo ── */
console.log('\nações locais:');
{
  const { doc, fire } = load();
  const overlay = { style: { display: 'block' } };
  doc._els['wbOverlay'] = overlay;
  fire('click', makeEl({ 'data-act': 'hideWelcomeOverlay' }));
  eq(overlay.style.display, 'none', 'hideWelcomeOverlay esconde o overlay');
}
{
  const { doc, fire } = load();
  let cliques = 0;
  doc._els['fileInputGlobal'] = { click: () => cliques++ };
  fire('click', makeEl({ 'data-act': 'openGlobalFilePicker' }));
  eq(cliques, 1, 'openGlobalFilePicker abre o seletor de arquivo');
}
{
  const { doc, fire } = load();   // elemento ausente não pode estourar
  fire('click', makeEl({ 'data-act': 'hideWelcomeOverlay' }));
  fire('click', makeEl({ 'data-act': 'openGlobalFilePicker' }));
  eq(true, true, 'elemento ausente não quebra a página');
}

console.log(`\n${passed} testes passaram.`);

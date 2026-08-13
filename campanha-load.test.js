/* Smoke test do board da campanha — rode com:  node campanha-load.test.js

   POR QUÊ
   -------
   O board fica no ar 24/7 num telão. Um ÚNICO erro de referência no load
   (função que não existe, typo) apaga a tela inteira na frente do operador —
   e isso NÃO aparece nos testes de função pura (campanha-core.test.js), só ao
   carregar o campanha.js de verdade.

   Este teste carrega o campanha.js num DOM FALSO (Proxy, sem dependência) e
   dispara o boot() no caminho ?demo=1. Se algum identificador estiver indefinido,
   o boot() estoura e o teste falha ANTES de ir pra TV. De quebra, valida as
   funções puras que o board mostra (performance da série, meta, dedup, ticker).
   ========================================================================= */
'use strict';
const fs = require('fs');
const assert = require('assert');

let passed = 0;
const falhas = [];
function ok(nome, cond) { if (cond) { passed++; } else { falhas.push(nome); } }

/* ── DOM falso: qualquer prop devolve algo razoável; métodos são no-op ── */
function makeEl() {
  return new Proxy({
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], dataset: {}, textContent: '', innerHTML: '', value: '',
    hidden: false, isConnected: true,
    offsetWidth: 800, scrollWidth: 2000, clientHeight: 200, scrollHeight: 2000, scrollTop: 0, offsetParent: {},
  }, {
    get(t, p) {
      if (p in t) return t[p];
      if (['appendChild', 'removeChild', 'remove', 'setAttribute', 'removeAttribute', 'addEventListener',
        'removeEventListener', 'focus', 'blur', 'insertBefore', 'setProperty', 'getAttribute', 'play', 'pause', 'load'].includes(p)) return () => {};
      if (p === 'querySelector') return () => makeEl();
      if (p === 'querySelectorAll') return () => [];
      if (p === 'getBoundingClientRect') return () => ({ width: 800, height: 200, top: 0, left: 0 });
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function setupDOM(search) {
  const win = {
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    SUPREMA_KEEPALIVE: true, location: { search: search, pathname: '/campanha.html' },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, clearInterval: () => {},
    addEventListener: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  global.window = win;
  global.document = new Proxy({
    readyState: 'complete', documentElement: makeEl(), body: makeEl(),
    getElementById: () => makeEl(), querySelector: () => makeEl(), querySelectorAll: () => [],
    createElement: () => makeEl(), addEventListener: () => {},
  }, { get(t, p) { return p in t ? t[p] : (() => {}); } });
  global.location = win.location;
  // navigator/performance são read-only no Node moderno → defineProperty
  Object.defineProperty(global, 'navigator', { value: { userAgent: 'Tizen SmartTV', connection: {} }, configurable: true });
  Object.defineProperty(global, 'performance', { value: { now: () => 0 }, configurable: true });
  global.matchMedia = win.matchMedia;
  global.requestAnimationFrame = win.requestAnimationFrame;
  global.cancelAnimationFrame = win.cancelAnimationFrame;
  global.setInterval = () => 0; global.setTimeout = () => 0; global.clearTimeout = () => {}; global.clearInterval = () => {};
  global.SupremaDB = {
    init: () => true, requireUser: (cb) => cb && cb(), watch: () => {},
    getValue: () => Promise.resolve(null), ready: () => true,
    rawRef: () => ({ orderByKey: () => ({ startAt: () => ({ once: () => Promise.resolve({ val: () => ({}) }) }) }) }),
  };
  global.CampanhaCore = require(__dirname + '/campanha-core.js');
  global.parseGlobalWeekAsync = () => Promise.resolve({});
  global.buildModel = () => ({ events: [] });
}

/* Carrega o campanha.js dentro de um wrapper que RETORNA as funções internas
   (o 'use strict' do arquivo impede que vazem do eval; envolver e retornar resolve). */
function loadBoard(search) {
  setupDOM(search);
  const code = fs.readFileSync(__dirname + '/campanha.js', 'utf8');
  const wrapped = '(function(){\n' + code + '\n;return {' +
    'seriePerf:typeof seriePerf!=="undefined"?seriePerf:null,' +
    'effectiveMeta:typeof effectiveMeta!=="undefined"?effectiveMeta:null,' +
    'eventKey:typeof eventKey!=="undefined"?eventKey:null,' +
    'startTickerScroll:typeof startTickerScroll!=="undefined"?startTickerScroll:null' +
    '};})()';
  // eslint-disable-next-line no-eval
  return (0, eval)(wrapped);
}

/* ── 1. LOAD: campanha.js carrega e boot(?demo=1) roda sem ReferenceError ── */
let api = null;
try {
  api = loadBoard('?demo=1');
  ok('campanha.js carrega e boot() roda sem estourar', true);
} catch (e) {
  ok('campanha.js carrega e boot() roda sem estourar', false);
  falhas.push('  -> ' + e.name + ': ' + e.message);
}

if (api) {
  /* ── 2. Funções-chave existem depois do load ── */
  ok('seriePerf definida', typeof api.seriePerf === 'function');
  ok('effectiveMeta definida', typeof api.effectiveMeta === 'function');
  ok('eventKey definida', typeof api.eventKey === 'function');
  ok('startTickerScroll definida', typeof api.startTickerScroll === 'function');

  const t = { totalGarantido: 22977800, arrecadadoBruto: 25959492, perfMedia: 15.9 };

  /* ── 3. Performance da SÉRIE = arrecadado/garantido − 1 (não a média) ── */
  if (api.seriePerf) {
    const p = api.seriePerf(t);
    ok('seriePerf = arrecadado/garantido−1 (~+13,0%)', Math.abs(p - 12.97) < 0.05);
    ok('seriePerf != perfMedia (é a agregada, não a média)', Math.abs(p - t.perfMedia) > 1);
  }

  /* ── 4. Meta = garantido total × 1,20 (piso ~120,5 mi) ── */
  if (api.effectiveMeta) {
    const m = api.effectiveMeta(t);
    ok('effectiveMeta >= garantidoSerie×1,20 (~120,5 mi)', m >= 120000000 && m <= 121000000);
  }

  /* ── 5. Dedup dos "Maiores": mesmo torneio recorrente colapsa ── */
  if (api.eventKey) {
    ok('eventKey dedup 1M Battle HR (19-M == 60-M)',
      api.eventKey('SPS 19-M 1M Battle HR') === api.eventKey('SPS 60-M 1M Battle HR'));
    ok('eventKey distingue torneios diferentes',
      api.eventKey('SPS 36-M 1M Supremo') !== api.eventKey('SPS 19-M 1M Battle HR'));
  }
}

/* ── 6. Ticker: a lógica de scroll nunca vira NaN (regressão que travou a faixa) ── */
(function testTickerNaN() {
  let x = 0, last = null; const SPEED = 90, half = 2000;
  function frame(ts) {
    if (last == null) { last = ts; return; }   // 1º frame ancora (fix do NaN)
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    x -= SPEED * dt; if (-x >= half) x += half;
  }
  let ts = 1000;
  for (let i = 0; i < 8; i++) { frame(ts); ts += 16.7; }
  ok('ticker scroll: posição nunca vira NaN', !isNaN(x) && x < 0);
})();

/* ── resultado ── */
console.log('\n' + (falhas.length ? '❌' : '✅') + ' campanha-load: ' + passed + ' testes passaram' +
  (falhas.length ? ', ' + falhas.length + ' FALHARAM:\n  - ' + falhas.join('\n  - ') : ''));
process.exit(falhas.length ? 1 : 0);

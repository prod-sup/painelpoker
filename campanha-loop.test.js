/* Emenda do loop do fundo (campanha.js → seamLoop) — rode com:
     node campanha-loop.test.js

   POR QUE ESTE TESTE EXISTE
   -------------------------
   O clipe de fundo tem ~8s: a volta do loop acontece umas 450x por hora. Nessa
   frequência a emenda precisa ser INVISÍVEL — qualquer coisa que se anuncie
   (escurecer, piscar) deixa de ser transição e vira tique. A solução é corte
   coberto: fotografa o quadro no ar, rebobina ATRÁS da foto, dissolve.

   Nada disso dá erro quando quebra — só volta a aparecer o tranco, ou pior, um
   still preto cobrindo o telão. Por isso as três garantias são testadas aqui:
     1. o still só aparece se a foto tiver imagem de verdade;
     2. a rebobinada acontece ESCONDIDA (depois de segurar o quadro);
     3. o recorte da foto bate com o do vídeo (senão a imagem "pula" de lugar).
========================================================================= */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name);
}
function perto(got, exp, tol, name) {
  assert.ok(Math.abs(got - exp) <= tol, `${name}: esperado ~${exp}, veio ${got}`);
  passed++; console.log('  ✓ ' + name + ' = ' + Math.round(got * 10) / 10);
}
function ok(cond, name) { assert.ok(cond, name); passed++; console.log('  ✓ ' + name); }

const SRC = fs.readFileSync(__dirname + '/campanha.js', 'utf8');
function fatia(nome) {
  const i = SRC.indexOf('function ' + nome + '(');
  assert.ok(i > -1, 'função não encontrada: ' + nome);
  let p = SRC.indexOf('(', i), par = 0, q = p;
  for (; q < SRC.length; q++) {
    if (SRC[q] === '(') par++;
    else if (SRC[q] === ')') { par--; if (par === 0) break; }
  }
  let nivel = 0, k = SRC.indexOf('{', q);
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') nivel++;
    else if (SRC[k] === '}') { nivel--; if (nivel === 0) break; }
  }
  return SRC.slice(i, k + 1);
}

/* ── bancada: vídeo, canvas, véu e relógio falsos ── */
function bancada(o) {
  o = o || {};
  const box = o.box || { width: 1280, height: 720 };
  const desenhos = [];
  const cls = el => ({ add: c => el.cls.add(c), remove: c => el.cls.delete(c) });

  const still = {
    cls: new Set(), width: 0, height: 0, offsetWidth: 1,
    getBoundingClientRect: () => ({ width: box.width, height: box.height }),
    getContext: () => (o.semCanvas ? null : {
      drawImage(...a) { desenhos.push(a.slice(1)); },      // guarda o recorte pedido
      getImageData(x, y, w, h) {
        if (o.fotoPreta) return { data: new Uint8ClampedArray(w * h * 4) };   // tudo 0
        const d = new Uint8ClampedArray(w * h * 4).fill(200);
        return { data: d };
      },
    }),
  };
  still.classList = cls(still);
  Object.defineProperty(still, 'segurando', { get: () => still.cls.has('is-holding') });

  const dip = { cls: new Set() };
  dip.classList = cls(dip);
  Object.defineProperty(dip, 'escuro', { get: () => dip.cls.has('is-dim') });

  const video = {
    duration: o.duration != null ? o.duration : 8.04,
    currentTime: 0, paused: false,
    videoWidth: o.vw || 1440, videoHeight: o.vh || 1080,
    _h: {},
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
    fire(t) { (this._h[t] || []).forEach(fn => fn()); },
  };

  const rafs = [], timers = [];
  let plays = 0;
  const ctx = {
    $: id => (id === 'heroStill' ? still : id === 'heroDip' ? dip : null),
    reduced: () => !!o.reduced,
    document: { hidden: false, addEventListener() {} },
    requestAnimationFrame: fn => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  vm.createContext(ctx);
  vm.runInContext(fatia('seamLoop'), ctx);
  ctx.seamLoop(video, () => { plays++; });

  return {
    still, dip, video, rafs, timers, desenhos,
    plays: () => plays,
    /* põe o vídeo num instante e dispara o timeupdate, como o navegador faria */
    tick(t) { video.currentTime = t; video.fire('timeupdate'); },
    /* roda os rAF pendentes (uma rodada) */
    frame() { const fila = rafs.splice(0, rafs.length); fila.forEach(fn => fn()); },
    /* roda o próximo timer agendado */
    timer() { const t = timers.shift(); if (t) t.fn(); return t; },
  };
}

/* ── 1. longe do fim: ninguém acorda ── */
console.log('\nmeio do clipe:');
{
  const b = bancada();
  b.tick(2); b.tick(5); b.tick(6.5);
  eq(b.rafs.length, 0, 'nenhum rAF armado a 1,5s do fim (o vigia liga só na última 1,2s)');
  ok(!b.still.segurando, 'still invisível');
}

/* ── 2. o vigia liga perto do fim e espera o quadro certo ── */
console.log('\nvigia quadro a quadro:');
{
  const b = bancada();
  b.tick(7.1);                                   // faltam 0,94s → dentro da janela
  eq(b.rafs.length, 1, 'rAF armado ao entrar na última 1,2s');
  b.video.currentTime = 7.5; b.frame();          // ainda faltam 0,54s
  ok(!b.still.segurando, 'não emenda cedo — ainda tem vídeo pra mostrar');
  eq(b.rafs.length, 1, 'segue vigiando no frame seguinte');
  b.video.currentTime = 8.00; b.frame();         // faltam 0,04s (< CUT)
  ok(b.still.segurando, 'emenda no último instante (perde ~80ms de clipe, não 250ms)');
}

/* ── 3. o corte é coberto: segura o quadro, rebobina atrás, dissolve ── */
console.log('\ncorte coberto:');
{
  const b = bancada();
  b.tick(7.1); b.video.currentTime = 8.01; b.frame();
  ok(b.still.segurando, 'still entra segurando o quadro (sem transição: é cópia da tela)');
  eq(b.video.currentTime, 0, 'vídeo rebobinou ESCONDIDO atrás do still');
  eq(b.plays(), 1, 'play() rechamado (nem toda TV retoma sozinha)');
  b.frame();                                     // rAF do dissolve
  ok(!b.still.segurando, 'still é solto → dissolve pro vídeo já rodando do início');
  ok(b.dip.escuro === false, 'o brilho da tela nunca muda: nada de véu no caminho feliz');
}

/* ── 4. o recorte da foto bate com o object-fit:cover do vídeo ── */
console.log('\nenquadramento da foto:');
{
  // caixa 16:9 (1280x720) com vídeo 4:3 (1440x1080): cover corta em cima/embaixo
  const b = bancada({ box: { width: 1280, height: 720 }, vw: 1440, vh: 1080 });
  b.tick(7.1); b.video.currentTime = 8.01; b.frame();
  const [sx, sy, sw, sh, dx, dy, dw, dh] = b.desenhos[0];
  perto(sw, 1440, 1, 'largura da fonte = largura inteira do vídeo (cover pela largura)');
  perto(sh, 810, 1, 'altura da fonte recortada pra 16:9');
  perto(sx, 0, 1, 'sem corte lateral (centralizado)');
  perto(sy, (1080 - 810) * 0.34, 1, 'corte vertical em 34% — o mesmo object-position do vídeo');
  eq([dx, dy, dw, dh], [0, 0, 1280, 720], 'desenha preenchendo o canvas');
  eq([b.still.width, b.still.height], [1280, 720], 'bitmap na proporção da caixa (não distorce)');
}

/* ── 5. foto preta (plano de hardware da TV): NUNCA mostra o still ── */
console.log('\nquando a TV não deixa fotografar:');
{
  const b = bancada({ fotoPreta: true });
  b.tick(7.1); b.video.currentTime = 8.01; b.frame();
  ok(!b.still.segurando, 'still preto jamais vai pra tela (seria o fade-pro-preto que evitamos)');
  ok(b.dip.escuro, 'cai na sombra rasa');
  eq(b.video.currentTime, 8.01, 'ainda não rebobinou — a virada espera o ponto mais escuro');
  b.timer();                                     // fim do escurecimento
  eq(b.video.currentTime, 0, 'rebobina no ponto mais escuro da sombra');
  b.frame();
  ok(!b.dip.escuro, 'sombra clareia depois da virada');
}

/* ── 6. sem canvas nenhum: ainda assim o loop vira ── */
console.log('\nsem canvas:');
{
  const b = bancada({ semCanvas: true });
  b.tick(7.1); b.video.currentTime = 8.01; b.frame();
  ok(!b.still.segurando, 'sem contexto 2d, sem still');
  ok(b.dip.escuro, 'plano B assume');
}

/* ── 7. trava anti-redisparo ── */
console.log('\ntrava:');
{
  const b = bancada();
  b.tick(7.1); b.video.currentTime = 8.01; b.frame();
  const antes = b.plays();
  b.tick(0.02); b.frame();                       // vídeo já voltou ao início
  eq(b.plays(), antes, 'a mesma volta não emenda duas vezes');
}

/* ── 8. casos em que não vale emendar ── */
console.log('\nsem emenda:');
{
  const curto = bancada({ duration: 2 });
  curto.tick(1.9);
  eq(curto.rafs.length, 0, 'clipe de 2s: loop nativo puro');

  const semDur = bancada({ duration: NaN });
  semDur.tick(10);
  eq(semDur.rafs.length, 0, 'duração desconhecida não arma nada');

  const inf = bancada({ duration: Infinity });
  inf.tick(10);
  eq(inf.rafs.length, 0, 'stream infinito não arma nada');

  const parado = bancada();
  parado.video.paused = true; parado.tick(7.5);
  eq(parado.rafs.length, 0, 'vídeo pausado (aba oculta) não arma nada');

  const red = bancada({ reduced: true });
  red.tick(7.9);
  eq(red.rafs.length, 0, 'prefers-reduced-motion: nem escuta o vídeo');
}

/* ── 9. marcação e CSS ── */
console.log('\nmarcação e CSS:');
{
  const html = fs.readFileSync(__dirname + '/campanha.html', 'utf8');
  ok(/id="heroStill"/.test(html) && /id="heroDip"/.test(html), 'campanha.html tem o still e o véu');
  const hero = html.slice(html.indexOf('<div class="tv-hero"'), html.indexOf('<!-- névoa'));
  ok(hero.includes('heroStill') && hero.includes('heroDip'),
     'os dois vivem DENTRO do .tv-hero — emendam o fundo, nunca o palco');

  const css = fs.readFileSync(__dirname + '/campanha.css', 'utf8');
  ok(/\.tv-hero-still\.is-holding\{[^}]*transition:none/.test(css),
     'segurar o quadro é INSTANTÂNEO (com transição, apareceria um flash)');
  /* O still TEM que ficar abaixo do scrim que escurece o vídeo. Acima dele, a foto
     entra mais clara que o vídeo e a emenda vira um salto de brilho — foi assim que
     saiu na primeira montagem, e só apareceu comparando as duas telas lado a lado. */
  const zStill = (css.match(/\.tv-hero-still\{[^}]*z-index:(\d+)/) || [])[1];
  const zScrim = (css.match(/html\.tv-device \.tv-hero::after\{[^}]*z-index:(\d+)/) || [])[1];
  ok(zStill != null && zScrim != null && Number(zStill) < Number(zScrim),
     'still (z' + zStill + ') pinta ABAIXO do scrim (z' + zScrim + ') — mesmo brilho do vídeo');

  const dis = (css.match(/\.tv-hero-still\{[^}]*transition:opacity ([\d.]+)s/) || [])[1];
  ok(parseFloat(dis) >= 0.6 && parseFloat(dis) <= 1.2,
     'dissolve de ' + dis + 's — lê como dissolve e cabe num ciclo de 8s');
  // o plano B tem que ser RASO: a cada 8s, escurecer forte é pior que o corte
  const alfas = (css.match(/\.tv-hero-dip\{[^}]*background:[^;]+/) || [''])[0]
    .match(/rgba\([^)]+,\s*\.(\d+)\)/g) || [];
  ok(alfas.length > 0 && alfas.every(a => parseFloat('0.' + a.match(/\.(\d+)\)/)[1]) <= 0.4),
     'sombra do plano B no máximo ~40% (nada de fade pro preto): ' + alfas.join(' '));
}

console.log(`\n${passed} verificações passaram.`);

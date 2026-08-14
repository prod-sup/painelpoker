/* Emenda do loop do fundo (campanha.js → seamLoop) — rode com:
     node campanha-loop.test.js

   POR QUE ESTE TESTE EXISTE
   -------------------------
   O `loop` nativo volta ao primeiro frame de um quadro pro outro e no telão isso
   aparece como um tranco a cada volta. A emenda esconde a virada atrás de um véu:
   escurece, rebobina NO ESCURO, clareia devagar.

   Tudo aqui é TEMPO — e tempo errado não dá erro, só volta a aparecer o tranco:
   se a rebobinada cair DEPOIS do fim, o loop nativo já deu o corte; se cair cedo
   demais, o telão perde segundos de vídeo; se o véu não abrir, o fundo fica preto.
   Por isso a lógica é testada com relógio falso, sem navegador.
========================================================================= */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name);
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

/* ── bancada: vídeo, véu e relógio falsos ── */
function bancada(opts) {
  opts = opts || {};
  const dip = {
    cls: new Set(),
    classList: { add(c){ dip.cls.add(c); }, remove(c){ dip.cls.delete(c); } },
    get dim(){ return dip.cls.has('is-dim'); },
  };
  const video = {
    duration: opts.duration != null ? opts.duration : 30,
    currentTime: 0,
    _h: {},
    addEventListener(t, fn){ (this._h[t] = this._h[t] || []).push(fn); },
    fire(t){ (this._h[t] || []).forEach(fn => fn()); },
  };
  const timers = [];
  let plays = 0;
  const ctx = {
    $: id => (id === 'heroDip' ? dip : null),
    reduced: () => !!opts.reduced,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    requestAnimationFrame: fn => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(fatia('seamLoop'), ctx);
  ctx.seamLoop(video, () => { plays++; });
  return {
    dip, video, timers,
    plays: () => plays,
    /* avança o vídeo e dispara o timeupdate, como o navegador faria */
    tick(t){ video.currentTime = t; video.fire('timeupdate'); },
    /* roda o timer agendado (a rebobinada) */
    corre(){ const t = timers.shift(); if (t) t.fn(); return t; },
  };
}

/* ── 1. longe do fim: nada acontece ── */
console.log('\nmeio do vídeo:');
{
  const b = bancada({ duration: 30 });
  b.tick(5); b.tick(20); b.tick(28.5);
  ok(!b.dip.dim, 'véu fechado só perto do fim (a 1,5s ainda não)');
  eq(b.timers.length, 0, 'nenhuma rebobinada agendada');
}

/* ── 2. perto do fim: véu fecha e a rebobinada cai ANTES do fim real ── */
console.log('\nemenda:');
{
  const b = bancada({ duration: 30 });
  b.tick(29.1);                                   // faltam 0,9s
  ok(b.dip.dim, 'véu fecha ao entrar na janela de 1s');
  eq(b.timers.length, 1, 'rebobinada agendada');
  const atraso = b.timers[0].ms;
  ok(atraso > 0 && atraso < 900, 'rebobina antes do fim (' + atraso + 'ms < 900ms que faltavam)');
  ok(atraso >= 800, 'mas quase no fim (' + atraso + 'ms) — não corta vídeo à toa');
  b.corre();
  eq(b.video.currentTime, 0, 'vídeo voltou ao início');
  eq(b.plays(), 1, 'play() rechamado (autoplay não continua sozinho em toda TV)');
  ok(!b.dip.dim, 'véu abre logo após a virada (a lentidão está no CSS, não aqui)');
}

/* ── 3. o mesmo fim não dispara duas vezes ── */
console.log('\ntrava anti-redisparo:');
{
  const b = bancada({ duration: 30 });
  b.tick(29.1); b.tick(29.4); b.tick(29.8);       // timeupdate dispara ~4x/s
  eq(b.timers.length, 1, 'uma rebobinada só, mesmo com vários timeupdate na janela');
}

/* ── 4. vídeo curto / sem duração: loop nativo puro ── */
console.log('\nsem emenda quando não vale a pena:');
{
  const curto = bancada({ duration: 4 });
  curto.tick(3.5);
  ok(!curto.dip.dim, 'vídeo de 4s não ganha véu (véu de 1s a cada 4s seria pior que o corte)');

  const semDur = bancada({ duration: NaN });
  semDur.tick(10);
  ok(!semDur.dip.dim, 'duração desconhecida não fecha o véu');

  const inf = bancada({ duration: Infinity });
  inf.tick(10);
  ok(!inf.dip.dim, 'stream infinito não fecha o véu');
}

/* ── 5. reduced-motion: nem escuta o vídeo ── */
console.log('\nprefers-reduced-motion:');
{
  const b = bancada({ duration: 30, reduced: true });
  b.tick(29.1);
  ok(!b.dip.dim, 'sem véu (o fundo já é o PNG parado)');
  eq(b.timers.length, 0, 'sem timers');
}

/* ── 6. o véu existe no HTML e é só do fundo ── */
console.log('\nmarcação e CSS:');
{
  const html = fs.readFileSync(__dirname + '/campanha.html', 'utf8');
  ok(/id="heroDip"/.test(html), 'campanha.html tem #heroDip');
  const heroBlock = html.slice(html.indexOf('<div class="tv-hero"'), html.indexOf('</div>\n\n<!-- névoa'));
  ok(heroBlock.includes('heroDip'), 'véu vive DENTRO do .tv-hero — escurece o fundo, nunca o palco');
  const css = fs.readFileSync(__dirname + '/campanha.css', 'utf8');
  ok(/\.tv-hero-dip\{[^}]*opacity:0/.test(css), 'véu nasce invisível');
  const ida  = (css.match(/\.tv-hero-dip\.is-dim\{[^}]*transition:opacity ([\d.]+)s/) || [])[1];
  const volta= (css.match(/\.tv-hero-dip\{[^}]*transition:opacity ([\d.]+)s/) || [])[1];
  ok(parseFloat(volta) > parseFloat(ida), 'abre (' + volta + 's) mais devagar do que fecha (' + ida + 's) — respiração, não piscada');
}

console.log(`\n${passed} verificações passaram.`);

/* ═══════════════════════════════════════════════════════════════════════════
   HUB-MOTION — camada de movimento refinada do hub (Anime.js v4)

   Filosofia Apple / minimalismo editorial: o movimento é sentido, não visto.
   Entrada do hero em cascata suave, reveal on-scroll dos cards e do grid,
   ao entrar no viewport — nunca tudo de uma vez, nunca espetáculo.

   Regras que este módulo respeita à risca:
   · anima só transform e opacity (GPU, sem reflow);
   · IntersectionObserver, nunca listener de scroll;
   · degrada com elegância — se a lib não carregou ou o usuário pediu menos
     movimento, tudo aparece imediatamente (nada fica preso invisível);
   · não toca em nenhum id/comportamento do hub.js — é puramente visual.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var A = window.anime;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sem a lib ou com movimento reduzido: garante que nada fique escondido e sai.
  if (!A || !A.animate || reduce) return;

  var animate = A.animate, stagger = A.stagger;
  var EASE = 'cubicBezier(0.16, 1, 0.3, 1)';   // o "ease out expo" da Apple

  // Estado inicial aplicado por JS (não por CSS): sem JS, o conteúdo aparece normal.
  function hide(els, y) {
    for (var i = 0; i < els.length; i++) {
      els[i].style.opacity = '0';
      els[i].style.transform = 'translateY(' + (y || 14) + 'px)';
      els[i].style.willChange = 'transform, opacity';
    }
  }
  function clearWill(els) {
    for (var i = 0; i < els.length; i++) els[i].style.willChange = '';
  }

  /* ── Entrada do hero em cascata ────────────────────────────────────────────
     saudação → título → subtítulo → chips. Roda quando o hub aparece (depois
     que o gate some), então observamos o hero entrar em tela também. */
  function heroIntro() {
    var hero = document.querySelector('.hero');
    if (!hero || hero.dataset.introDone) return;
    hero.dataset.introDone = '1';
    var seq = [];
    ['.hero-hello', '.hero h1', '.hero p', '.hero-ops', '.wx'].forEach(function (sel) {
      var el = hero.parentNode.querySelector(sel) || document.querySelector(sel);
      if (el && !el.hidden) seq.push(el);
    });
    if (!seq.length) return;
    hide(seq, 16);
    animate(seq, {
      opacity: [0, 1],
      translateY: [16, 0],
      duration: 900,
      delay: stagger(90),
      ease: EASE,
      onComplete: function () { clearWill(seq); }
    });
  }

  /* ── Reveal on-scroll ──────────────────────────────────────────────────────
     tiles do grid (em cascata) e cada board entram ao cruzar o viewport. */
  function revealOnScroll() {
    var tiles = Array.prototype.slice.call(document.querySelectorAll('.grid .tile'));
    var boards = Array.prototype.slice.call(document.querySelectorAll('.boards .board'));
    var myday = document.querySelector('.myday');
    var groups = [];
    if (tiles.length) groups.push({ els: tiles, staggered: true });
    boards.forEach(function (b) { groups.push({ els: [b], staggered: false }); });
    if (myday && !myday.hidden) groups.push({ els: [myday], staggered: false });

    if (!('IntersectionObserver' in window)) return;  // sem IO: fica tudo visível

    groups.forEach(function (g) { hide(g.els, 18); });

    function reveal(g) {
      if (!g || g.__done) return;
      g.__done = true;
      animate(g.els, {
        opacity: [0, 1],
        translateY: [18, 0],
        duration: 760,
        delay: g.staggered ? stagger(70) : 0,
        ease: EASE,
        onComplete: function () { clearWill(g.els); }
      });
    }

    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        reveal(entry.target.__mgroup);
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -6% 0px' });

    groups.forEach(function (g) {
      // observa o primeiro elemento do grupo como gatilho da cascata inteira
      g.els[0].__mgroup = g;
      io.observe(g.els[0]);
    });

    /* rede de segurança: nada pode ficar preso invisível. Se em 2,5s um grupo
       ainda não revelou (fold estranho, IO que não disparou), revela mesmo assim. */
    setTimeout(function () { groups.forEach(reveal); }, 2500);
  }

  /* ── Disparo ────────────────────────────────────────────────────────────────
     O gate de login cobre tudo no boot. Rodamos o hero-intro quando o hub fica
     visível: se não há gate (sessão viva) roda logo; senão espera o gate sumir. */
  function start() {
    revealOnScroll();
    var gate = document.getElementById('gate');
    if (!gate || gate.hidden) { heroIntro(); return; }
    // gate presente: observa o atributo hidden pra disparar quando ele fechar
    var mo = new MutationObserver(function () {
      if (gate.hidden) { mo.disconnect(); requestAnimationFrame(heroIntro); }
    });
    mo.observe(gate, { attributes: true, attributeFilter: ['hidden'] });
    // rede de segurança: se em 6s o gate ainda não fechou (ex.: já logado mas o
    // atributo nunca muda), revela o hero mesmo assim
    setTimeout(heroIntro, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

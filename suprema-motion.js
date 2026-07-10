/* =========================================================================
   SUPREMA-MOTION — linguagem de motion compartilhada do Suprema OS.
   Referências do MotionSites (Mouse Trail CTA, Nike Hover, scroll reveals):
   cursor-glow nos cards e reveal com stagger no scroll, iguais aos do hub.

   Uso (qualquer produto, depois de incluir <script src="suprema-motion.js">):
     SupremaMotion.glow('.card, .kpi');                  // pode chamar no head
     SupremaMotion.reveal('.card');                       // precisa do DOM pronto
     :root{ --sp-tint: rgba(79,142,247,.14) }             // tinta do glow (opcional)

   Craft/perf: glow por DELEGAÇÃO (um listener por página, span injetado no
   primeiro hover, posição via CSS vars — nada de layout por frame); reveal por
   IntersectionObserver (a classe sp-reveal só entra via JS: sem JS nada some).
   Desliga sozinho em touch e em prefers-reduced-motion.
========================================================================= */
(function (global) {
  'use strict';

  var fine = global.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches;
  var calm = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var cssDone = false;
  function injectCss() {
    if (cssDone || !document.head) return;
    cssDone = true;
    var s = document.createElement('style');
    s.textContent =
      '.sp-glow{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;' +
        'background:radial-gradient(240px circle at var(--sp-mx,50%) var(--sp-my,50%),' +
        'var(--sp-tint,rgba(216,181,109,.14)),transparent 68%);' +
        'transition:opacity .35s ease}' +
      '.sp-has-glow:hover>.sp-glow{opacity:1}' +
      'html.sp-reveal .sp-to-reveal{opacity:0;transform:translateY(14px)}' +
      'html.sp-reveal .sp-to-reveal.sp-in{opacity:1;transform:none;' +
        'transition:opacity .65s cubic-bezier(.22,.61,.36,1),transform .65s cubic-bezier(.22,.61,.36,1);' +
        'transition-delay:var(--sp-d,0ms)}' +
      '@media (prefers-reduced-motion:reduce){html.sp-reveal .sp-to-reveal{opacity:1;transform:none;transition:none}}';
    document.head.appendChild(s);
  }

  /* brilho que segue o cursor dentro dos cards que casam com `selector` */
  function glow(selector) {
    if (!fine || calm) return;
    injectCss();
    document.addEventListener('pointermove', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (!el) return;
      if (!el.__spGlow) {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        var g = document.createElement('span');
        g.className = 'sp-glow';
        g.setAttribute('aria-hidden', 'true');
        el.appendChild(g);
        el.classList.add('sp-has-glow');
        el.__spGlow = g;
      }
      var r = el.getBoundingClientRect();
      el.style.setProperty('--sp-mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--sp-my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* entrada com stagger no scroll pros elementos que casam com `selector` */
  function reveal(selector) {
    if (calm || !('IntersectionObserver' in global)) return;
    injectCss();
    var els = document.querySelectorAll(selector);
    if (!els.length) return;
    document.documentElement.classList.add('sp-reveal');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('sp-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    var i = 0;
    els.forEach(function (el) {
      // elemento oculto agora (aba/section fechada, display:none) fica DE FORA:
      // marcar pra reveal deixaria ele preso em opacity:0 até a aba abrir
      if (!el.getClientRects().length) return;
      el.classList.add('sp-to-reveal');
      el.style.setProperty('--sp-d', (i++ % 6) * 90 + 'ms');
      io.observe(el);
    });
  }

  global.SupremaMotion = { glow: glow, reveal: reveal };
})(window);

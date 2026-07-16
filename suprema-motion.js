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
      '@media (prefers-reduced-motion:reduce){html.sp-reveal .sp-to-reveal{opacity:1;transform:none;transition:none}}' +
      /* naipes à deriva no fundo (a atmosfera do hub, compartilhada) */
      '.sp-ambient{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}' +
      '.sp-ambient span{position:absolute;font-size:var(--fs,120px);line-height:1;user-select:none;' +
        'color:var(--sp-amb,rgba(24,163,107,.07));animation:sp-drift 26s ease-in-out infinite}' +
      '.sp-ambient span:nth-child(2n){color:var(--sp-amb2,rgba(216,181,109,.06))}' +
      '@keyframes sp-drift{0%,100%{transform:translateY(0) rotate(var(--rot,0deg))}50%{transform:translateY(-26px) rotate(calc(var(--rot,0deg) + 4deg))}}' +
      'body.win-blurred .sp-ambient span{animation-play-state:paused}' +
      '@media (prefers-reduced-motion:reduce){.sp-ambient span{animation:none}}' +
      /* cursor de trabalho: fichas caindo perto do ponteiro enquanto algo processa */
      'body.sp-busy, body.sp-busy *{cursor:progress !important}' +
      '.sp-busy-chips{position:fixed;z-index:99999;width:34px;height:44px;pointer-events:none;' +
        'opacity:0;transition:opacity .2s ease}' +
      '.sp-busy-chips.on{opacity:1}' +
      '.sp-busy-chips i{position:absolute;left:50%;top:0;width:15px;height:15px;margin-left:-7.5px;border-radius:50%;' +
        'background:radial-gradient(circle at 35% 30%, var(--sp-chip,#d8b56d), color-mix(in srgb, var(--sp-chip,#d8b56d) 60%, #000 30%));' +
        'border:2px dashed rgba(255,255,255,.65);box-shadow:0 2px 6px rgba(0,0,0,.35);' +
        'animation:sp-chip-fall 1s linear infinite}' +
      '.sp-busy-chips i:nth-child(2){animation-delay:.33s;--hue:1}' +
      '.sp-busy-chips i:nth-child(3){animation-delay:.66s}' +
      '.sp-busy-chips i:nth-child(2){background:radial-gradient(circle at 35% 30%, #18a36b, #0c5c3f)}' +
      '.sp-busy-chips i:nth-child(3){background:radial-gradient(circle at 35% 30%, #4f8ef7, #2a5cb8)}' +
      '@keyframes sp-chip-fall{0%{transform:translateY(-6px) scale(.7);opacity:0}' +
        '25%{opacity:1;transform:translateY(6px) scale(1) rotate(40deg)}' +
        '80%{opacity:1}100%{transform:translateY(34px) scale(.9) rotate(140deg);opacity:0}}' +
      '@media (prefers-reduced-motion:reduce){.sp-busy-chips{display:none}}' +
      /* barra de progresso de leitura no topo (dashboards longos) */
      '.sp-progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:9999;pointer-events:none;' +
        'transform:scaleX(0);transform-origin:0 50%;will-change:transform;' +
        'background:linear-gradient(90deg,var(--sp-prog,var(--sp-tint,#d8b56d)),' +
        'color-mix(in srgb, var(--sp-prog, #d8b56d) 55%, #fff 25%))}' +
      /* botão magnético: só a volta é suave; enquanto puxa, é inline sem transição */
      '.sp-magnetic{transition:transform .3s cubic-bezier(.22,1,.36,1)}' +
      '.sp-magnetic.sp-mag-on{transition:none}' +
      /* aurora: mesh de gradiente lento atrás do hero, na tinta do produto */
      '.sp-aurora{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;border-radius:inherit}' +
      '.sp-aurora::before,.sp-aurora::after{content:"";position:absolute;inset:-45%;filter:blur(48px);' +
        'background:radial-gradient(closest-side,var(--sp-au1,rgba(79,142,247,.22)),transparent 70%);' +
        'animation:sp-aurora 20s ease-in-out infinite;will-change:transform}' +
      '.sp-aurora::after{background:radial-gradient(closest-side,var(--sp-au2,rgba(216,181,109,.18)),transparent 70%);' +
        'animation-duration:27s;animation-direction:reverse}' +
      '@keyframes sp-aurora{0%,100%{transform:translate(-8%,-6%) scale(1)}50%{transform:translate(10%,9%) scale(1.18)}}' +
      'body.win-blurred .sp-aurora::before,body.win-blurred .sp-aurora::after{animation-play-state:paused}' +
      '@media (prefers-reduced-motion:reduce){.sp-aurora::before,.sp-aurora::after{animation:none}}' +
      /* skeleton shimmer: percepção de velocidade enquanto os dados chegam */
      '.sp-shimmer{position:relative;overflow:hidden;background:color-mix(in srgb, var(--ink-faint, #888) 16%, transparent);border-radius:8px}' +
      '.sp-shimmer::after{content:"";position:absolute;inset:0;transform:translateX(-100%);' +
        'background:linear-gradient(90deg,transparent,color-mix(in srgb, var(--ink, #fff) 12%, transparent),transparent);' +
        'animation:sp-shimmer 1.4s ease-in-out infinite}' +
      '@keyframes sp-shimmer{100%{transform:translateX(100%)}}' +
      '@media (prefers-reduced-motion:reduce){.sp-shimmer::after{animation:none}}';
    document.head.appendChild(s);
  }

  /* ── atmosfera: naipes à deriva atrás do conteúdo, como no hub.
     As cores vêm de --sp-amb/--sp-amb2 (cada página define as suas). ── */
  function ambient() {
    injectCss();
    if (document.querySelector('.sp-ambient')) return;
    var wrap = document.createElement('div');
    wrap.className = 'sp-ambient';
    wrap.setAttribute('aria-hidden', 'true');
    var suits = ['♠', '♦', '♣', '♥', '♠', '♦'];
    var pos = [
      { l: '4%',  t: '16%', fs: 150, rot: '-14deg', d: 0 },
      { l: '84%', t: '8%',  fs: 110, rot: '10deg',  d: 4 },
      { l: '70%', t: '58%', fs: 170, rot: '-6deg',  d: 8 },
      { l: '14%', t: '68%', fs: 120, rot: '14deg',  d: 12 },
      { l: '46%', t: '30%', fs: 90,  rot: '-20deg', d: 16 },
      { l: '32%', t: '86%', fs: 100, rot: '8deg',   d: 20 }
    ];
    suits.forEach(function (su, i) {
      var p = pos[i], el = document.createElement('span');
      el.textContent = su;
      el.style.cssText = 'left:' + p.l + ';top:' + p.t + ';--fs:' + p.fs + 'px;--rot:' + p.rot + ';animation-delay:' + p.d + 's';
      wrap.appendChild(el);
    });
    var add = function () { document.body.prepend(wrap); };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  }

  /* ── cursor de loading: fichas caem na ponta do mouse enquanto a página
     trabalha. busy(true/false) manual; busyAuto() liga sozinho em uploads
     (o timeout só dispara quando a main thread libera = parse terminou);
     busyWatch(sel, cls) espelha um loader existente (ex.: '#loader','on'). ── */
  var busyEl = null, busyMx = 0, busyMy = 0, busyRaf = 0, busyWired = false;
  function busyFollow() {
    if (!busyEl) return;
    busyEl.style.transform = 'translate(' + (busyMx + 16) + 'px,' + (busyMy + 10) + 'px)';
    busyRaf = document.body.classList.contains('sp-busy') ? requestAnimationFrame(busyFollow) : 0;
  }
  function busy(on) {
    if (!fine || calm || !document.body) return;
    injectCss();
    if (on && !busyEl) {
      busyEl = document.createElement('div');
      busyEl.className = 'sp-busy-chips';
      busyEl.setAttribute('aria-hidden', 'true');
      busyEl.innerHTML = '<i></i><i></i><i></i>';
      document.body.appendChild(busyEl);
      if (!busyWired) {
        busyWired = true;
        document.addEventListener('pointermove', function (e) { busyMx = e.clientX; busyMy = e.clientY; }, { passive: true });
      }
    }
    document.body.classList.toggle('sp-busy', !!on);
    if (busyEl) busyEl.classList.toggle('on', !!on);
    if (on && !busyRaf) busyRaf = requestAnimationFrame(busyFollow);
  }
  function busyAuto() {
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.type !== 'file' || !t.files || !t.files.length) return;
      busy(true);
      var t0 = Date.now();
      var tick = function () { if (Date.now() - t0 > 700) busy(false); else setTimeout(tick, 120); };
      setTimeout(tick, 120);
    }, true);
  }
  function busyWatch(selector, className) {
    var wire = function () {
      var el = document.querySelector(selector);
      if (!el || !('MutationObserver' in global)) return;
      new MutationObserver(function () { busy(el.classList.contains(className)); })
        .observe(el, { attributes: true, attributeFilter: ['class'] });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  }

  /* brilho que segue o cursor dentro dos cards que casam com `selector`.
     Perf: getBoundingClientRect é CARO em página grande (força layout) —
     o rect é medido uma vez por hover e reaproveitado; scroll/resize
     invalidam o cache de todo mundo via contador de época. */
  var rectEpoch = 0;
  var epochWired = false;
  function wireEpoch() {
    if (epochWired) return;
    epochWired = true;
    addEventListener('scroll', function () { rectEpoch++; }, { passive: true, capture: true });
    addEventListener('resize', function () { rectEpoch++; }, { passive: true });
  }
  function glow(selector) {
    if (!fine || calm) return;
    injectCss();
    wireEpoch();
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
      if (!el.__spRect || el.__spEpoch !== rectEpoch) {
        el.__spRect = el.getBoundingClientRect();
        el.__spEpoch = rectEpoch;
      }
      var r = el.__spRect;
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

  /* ── TILT 3D + PARALLAX (ref. MotionSites: cartas/objetos que inclinam
     seguindo o cursor) ── aplica rotateX/rotateY no alvo conforme a posição do
     ponteiro dentro do `host`. Filhos com translateZ ganham parallax de
     profundidade de graça (o host precisa de transform-style:preserve-3d).
     Perf: um rAF por alvo, vars CSS (nada de layout por frame). Desliga em
     touch e prefers-reduced-motion. tilt('.deck', {host:'.hero', max:7}) */
  function tilt(selector, opts) {
    if (!fine || calm) return;
    opts = opts || {};
    var max = opts.max || 7;
    wireEpoch();
    document.querySelectorAll(selector).forEach(function (el) {
      var host = opts.host ? (el.closest(opts.host) || document.querySelector(opts.host)) : el.parentElement;
      if (!host || el.__spTilt) return;
      el.__spTilt = true;
      var raf = 0, tx = 0, ty = 0, hostRect = null, hostEpoch = -1;
      var apply = function () {
        raf = 0;
        el.style.setProperty('--tiltX', tx.toFixed(2) + 'deg');
        el.style.setProperty('--tiltY', ty.toFixed(2) + 'deg');
      };
      host.addEventListener('pointermove', function (e) {
        if (!hostRect || hostEpoch !== rectEpoch) { hostRect = host.getBoundingClientRect(); hostEpoch = rectEpoch; }
        var r = hostRect;
        var nx = (e.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
        var ny = (e.clientY - r.top) / r.height - 0.5;
        ty = nx * max * 2;      // rotateY acompanha o eixo horizontal
        tx = -ny * max * 2;     // rotateX acompanha o vertical (invertido)
        if (!raf) raf = requestAnimationFrame(apply);
      }, { passive: true });
      host.addEventListener('pointerleave', function () {
        tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(apply);
      }, { passive: true });
    });
  }

  /* ── COUNT-UP (ref. MotionSites / dashboards premium): os números "rolam"
     de 0 até o valor quando entram na tela, UMA vez. Lê o texto final do próprio
     elemento (ex.: "R$ 12.345", "56%", "1,2k"), preserva prefixo/sufixo e o
     formato pt-BR. SEGURANÇA: o último frame reescreve o texto ORIGINAL
     literalmente — se o parse falhar, o elemento fica intacto (nada é animado).
     Perf: um rAF curto por elemento, dispara uma vez via IntersectionObserver. */
  function parseNum(txt){
    var m = String(txt).match(/-?[\d.,]*\d/);
    if(!m) return null;
    var token = m[0];
    var core = token.replace(/\./g,'').replace(',', '.');   // pt-BR: '.' milhar, ',' decimal
    var val = parseFloat(core);
    if(!isFinite(val)) return null;
    var dec = (token.split(',')[1] || '').length;
    return { val: val, dec: dec, i: m.index, len: token.length };
  }
  function countUp(selector, opts){
    if(calm || !('IntersectionObserver' in global)) return;   // reduced-motion: mostra o valor final direto
    opts = opts || {};
    var dur = opts.duration || 900;
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(!en.isIntersecting) return;
        var el = en.target; io.unobserve(el);
        if(el.__spCount) return; el.__spCount = true;
        var original = el.textContent;
        var p = parseNum(original);
        if(!p){ return; }                                   // sem número → deixa como está
        var prefix = original.slice(0, p.i), suffix = original.slice(p.i + p.len);
        var fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits:p.dec, maximumFractionDigits:p.dec });
        var t0 = 0;
        function step(ts){
          if(!t0) t0 = ts;
          var k = Math.min(1, (ts - t0) / dur);
          var eased = 1 - Math.pow(1 - k, 3);               // easeOutCubic
          if(k >= 1){ el.textContent = original; return; }  // frame final = texto original, exato
          el.textContent = prefix + fmt.format(p.val * eased) + suffix;
          requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { rootMargin:'0px 0px -8% 0px' });
    document.querySelectorAll(selector).forEach(function(el){
      if(el.getClientRects().length) io.observe(el);
    });
  }

  /* ── BOTÃO MAGNÉTICO (clássico MotionSites): o alvo é atraído levemente pro
     cursor no hover; solta com mola ao sair. Perf: rAF só durante o hover,
     transform inline (nada de layout). Desliga em touch e reduced-motion. */
  function magnetic(selector, opts){
    if(!fine || calm) return;
    opts = opts || {};
    var strength = opts.strength || 0.35, max = opts.max || 14;
    document.querySelectorAll(selector).forEach(function(el){
      if(el.__spMag) return; el.__spMag = true;
      el.classList.add('sp-magnetic');
      var raf = 0, tx = 0, ty = 0, rect = null;
      var apply = function(){ raf = 0; el.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px)'; };
      el.addEventListener('pointerenter', function(){ rect = el.getBoundingClientRect(); el.classList.add('sp-mag-on'); });
      el.addEventListener('pointermove', function(e){
        if(!rect) rect = el.getBoundingClientRect();
        var dx = e.clientX - (rect.left + rect.width/2);
        var dy = e.clientY - (rect.top + rect.height/2);
        tx = Math.max(-max, Math.min(max, dx * strength));
        ty = Math.max(-max, Math.min(max, dy * strength));
        if(!raf) raf = requestAnimationFrame(apply);
      }, { passive:true });
      el.addEventListener('pointerleave', function(){
        rect = null; tx = 0; ty = 0; el.classList.remove('sp-mag-on'); el.style.transform = '';
      });
    });
  }

  /* ── BARRA DE PROGRESSO DE SCROLL (ref. reading progress): fita fina no topo.
     Perf: listener passivo + transform:scaleX. tint via --sp-prog. ── */
  function scrollProgress(opts){
    injectCss();
    if(document.querySelector('.sp-progress')) return;
    opts = opts || {};
    var bar = document.createElement('div');
    bar.className = 'sp-progress'; bar.setAttribute('aria-hidden','true');
    if(opts.tint) bar.style.setProperty('--sp-prog', opts.tint);
    var add = function(){ document.body.appendChild(bar); };
    if(document.body) add(); else document.addEventListener('DOMContentLoaded', add);
    var raf = 0;
    function upd(){
      raf = 0;
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? (h.scrollTop / max) : 0).toFixed(4) + ')';
    }
    addEventListener('scroll', function(){ if(!raf) raf = requestAnimationFrame(upd); }, { passive:true });
    addEventListener('resize', function(){ if(!raf) raf = requestAnimationFrame(upd); }, { passive:true });
  }

  /* ── AURORA: mesh de gradiente lento atrás de um hero, na tinta do produto.
     Injeta uma camada .sp-aurora como primeiro filho do alvo (o conteúdo fica
     por cima). Perf: 100% CSS/GPU, pausa em blur, estático em reduced-motion.
     aurora('.hero', { tint1:'rgba(...)', tint2:'rgba(...)' }) ── */
  function aurora(selector, opts){
    injectCss();
    opts = opts || {};
    document.querySelectorAll(selector).forEach(function(host){
      if(host.__spAurora) return; host.__spAurora = true;
      if(getComputedStyle(host).position === 'static') host.style.position = 'relative';
      var layer = document.createElement('div');
      layer.className = 'sp-aurora'; layer.setAttribute('aria-hidden','true');
      if(opts.tint1) layer.style.setProperty('--sp-au1', opts.tint1);
      if(opts.tint2) layer.style.setProperty('--sp-au2', opts.tint2);
      host.prepend(layer);
      // garante que o conteúdo do hero fique acima da camada
      [].forEach.call(host.children, function(c){
        if(c !== layer && getComputedStyle(c).position === 'static') c.style.position = 'relative';
      });
    });
  }

  /* ── SKELETON: marca/desmarca shimmer de carregamento num elemento. ── */
  function skeleton(el, on){
    injectCss();
    if(typeof el === 'string'){ document.querySelectorAll(el).forEach(function(e){ skeleton(e, on); }); return; }
    if(el) el.classList.toggle('sp-shimmer', on !== false);
  }

  global.SupremaMotion = {
    glow: glow, reveal: reveal, tilt: tilt,
    ambient: ambient, busy: busy, busyAuto: busyAuto, busyWatch: busyWatch,
    countUp: countUp, magnetic: magnetic, scrollProgress: scrollProgress,
    aurora: aurora, skeleton: skeleton
  };
})(window);

/* ── hub-anim.js — camada PREMIUM de animação (GSAP) ───────────────────────────
   • billboard: título revelado LETRA a letra (flip 3D + blur), entrada em cascata
     do hello / tagline / chips / CTA.
   • fileiras: título em letras + capas entrando no scroll (ScrollTrigger).
   • re-anima o título quando o hub.js personaliza com o nome do operador.

   Degradação graciosa: o <head> só marca 'gsap-ready' quando NÃO há reduced-motion;
   se o GSAP não carregar, um fallback tira a classe e tudo aparece. Cards são
   escondidos/revelados só via JS (com clearProps) pra não travar o hover CSS. */
(function(){
  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !window.gsap){ root.classList.remove('gsap-ready'); return; }
  var gsap = window.gsap;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

  /* quebra o texto de um elemento em <span class="ltr">, preservando filhos
     (ex.: o <span class="os"> do "OS") e os espaços. Devolve os spans de letra. */
  function splitLetters(el){
    var letters = [];
    (function walk(node){
      Array.prototype.slice.call(node.childNodes).forEach(function(child){
        if (child.nodeType === 3){
          var text = child.textContent, frag = document.createDocumentFragment();
          for (var i=0;i<text.length;i++){
            var ch = text[i];
            if (ch === ' '){ frag.appendChild(document.createTextNode(' ')); continue; }
            var s = document.createElement('span'); s.className = 'ltr'; s.textContent = ch;
            frag.appendChild(s); letters.push(s);
          }
          child.parentNode.replaceChild(frag, child);
        } else if (child.nodeType === 1){
          walk(child);
        }
      });
    })(el);
    return letters;
  }

  function revealTitle(el, opts){
    var letters = splitLetters(el);
    el.style.opacity = 1;
    return gsap.from(letters, Object.assign({
      yPercent: 120, autoAlpha: 0, rotationX: -90, transformOrigin: '50% 100%',
      filter: 'blur(6px)', duration: 0.9, ease: 'power4.out', stagger: 0.035,
      onComplete: function(){ gsap.set(letters, { clearProps: 'transform,filter' }); }
    }, opts || {}));
  }

  document.addEventListener('DOMContentLoaded', function(){
    var hero    = document.querySelector('.hero');
    var title   = document.getElementById('heroTitle');
    var tagline = document.querySelector('.hero > p');
    var cta     = document.querySelectorAll('.hero-cta .hero-btn');
    var chips   = document.querySelectorAll('.hero-ops .ho-chip');
    var hello   = document.getElementById('heroHello');

    /* ── entrada cinematográfica do billboard ── */
    var tl = gsap.timeline({ defaults:{ ease:'power4.out' } });
    if (hello && !hello.hidden) tl.from(hello, { y:14, autoAlpha:0, duration:.6 }, 0);
    if (title) tl.add(revealTitle(title), 0.05);
    if (tagline){ tagline.style.opacity = 1; tl.from(tagline, { y:16, autoAlpha:0, duration:.7 }, '-=.55'); }
    if (cta.length)   tl.from(cta,   { y:18, autoAlpha:0, duration:.6, stagger:.09 }, '-=.5');
    if (chips.length) tl.from(chips, { y:10, autoAlpha:0, duration:.5, stagger:.06 }, '-=.55');

    /* re-anima quando o hub.js troca o título pelo nome do operador */
    if (title){
      var obs = new MutationObserver(function(){
        obs.disconnect();
        title.style.opacity = 1;
        revealTitle(title, { duration:.8, stagger:.03 });
        obs.observe(title, { childList:true });
      });
      obs.observe(title, { childList:true });
    }

    /* ── fileiras: título (slide-up limpo) + capas entrando no scroll ──
       Robusto: nada de split por letra aqui (frágil se o trigger não completa);
       o efeito de LETRA fica reservado ao headline do billboard. ── */
    if (window.ScrollTrigger){
      gsap.utils.toArray('.grid .row').forEach(function(row){
        var rt = row.querySelector('.row-title');
        var cards = row.querySelectorAll('.tile');
        if (rt) gsap.set(rt, { autoAlpha:0, y:18 });
        gsap.set(cards, { autoAlpha:0, y:32, scale:.95 });   // pré-esconde só via JS
        var rtl = gsap.timeline({ scrollTrigger:{ trigger: row, start:'top 88%', once:true } });
        if (rt) rtl.to(rt, { autoAlpha:1, y:0, duration:.5, ease:'power3.out', clearProps:'transform' }, 0);
        rtl.to(cards, {
          autoAlpha:1, y:0, scale:1, duration:.6, ease:'power3.out', stagger:.07,
          clearProps:'transform'   // libera o transform pro hover CSS (scale) voltar a funcionar
        }, 0.12);
      });
      ScrollTrigger.refresh();
    }
  });
})();

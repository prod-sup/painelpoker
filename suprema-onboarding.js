/* =========================================================================
   SUPREMA-ONBOARDING — tour guiado (spotlight) de primeira visita.
   Compartilhado por todos os produtos do Suprema OS. Sem dependências.

   Uso:
     SupremaOnboarding.start('painel', [
       { el:'#uploadGlobalBtn', title:'Comece por aqui', text:'…', side:'bottom' },
       { el:'#routineToggle',   title:'Conferências',    text:'…' },
       ...
     ]);

   - Roda UMA vez por página (gate em localStorage: suprema_onboarding_<id>).
   - Passo com elemento inexistente é pulado em silêncio.
   - Respeita prefers-reduced-motion e o tema atual (dark/light).
   - Reabrir manualmente: SupremaOnboarding.restart('painel', steps).
========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'suprema_onboarding_';
  var injected = false;
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function seen(id)  { try { return localStorage.getItem(KEY + id) === '1'; } catch (e) { return true; } }
  function mark(id)  { try { localStorage.setItem(KEY + id, '1'); } catch (e) {} }

  /* tema: painéis usam html.dark (opt-in); o hub usa html.light (opt-in, dark é o default).
     Resolve o tema efetivo pra estilar o balão de forma legível nos dois. */
  function isDark() {
    var c = document.documentElement.classList;
    if (c.contains('dark')) return true;
    if (c.contains('light')) return false;
    try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; }
  }

  function injectCSS() {
    if (injected) return; injected = true;
    var css =
      '.sob-root{position:fixed;inset:0;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",sans-serif;}' +
      '.sob-root[hidden]{display:none;}' +
      '.sob-mask{position:fixed;border-radius:14px;box-shadow:0 0 0 9999px rgba(6,10,8,.66);transition:all .4s cubic-bezier(.22,1,.36,1);pointer-events:none;}' +
      '.sob-ring{position:fixed;border-radius:16px;border:2px solid var(--sob-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--sob-accent) 25%,transparent);transition:all .4s cubic-bezier(.22,1,.36,1);pointer-events:none;}' +
      '.sob-catch{position:fixed;inset:0;pointer-events:auto;background:transparent;}' +
      '.sob-pop{position:fixed;width:min(320px,calc(100vw - 32px));background:var(--sob-bg);color:var(--sob-ink);border:1px solid var(--sob-bd);border-radius:16px;padding:18px 18px 15px;box-shadow:0 20px 60px -12px rgba(0,0,0,.5);opacity:0;transform:translateY(8px);transition:opacity .3s var(--sob-ease),transform .3s var(--sob-ease);pointer-events:auto;}' +
      '.sob-pop.in{opacity:1;transform:none;}' +
      '.sob-kicker{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--sob-accent);margin-bottom:8px;}' +
      '.sob-kicker .s{font-size:12px;}' +
      '.sob-title{font-size:16.5px;font-weight:680;letter-spacing:-.01em;margin:0 0 6px;line-height:1.2;}' +
      '.sob-text{font-size:13.5px;line-height:1.55;color:var(--sob-ink-soft);margin:0;}' +
      '.sob-foot{display:flex;align-items:center;gap:10px;margin-top:16px;}' +
      '.sob-dots{display:flex;gap:5px;flex:1;}' +
      '.sob-dot{width:6px;height:6px;border-radius:50%;background:var(--sob-bd);transition:all .3s var(--sob-ease);}' +
      '.sob-dot.on{background:var(--sob-accent);width:16px;border-radius:99px;}' +
      '.sob-skip{background:none;border:none;color:var(--sob-ink-soft);font:inherit;font-size:12.5px;cursor:pointer;padding:6px 4px;border-radius:8px;}' +
      '.sob-skip:hover{color:var(--sob-ink);}' +
      '.sob-next{background:var(--sob-accent);color:var(--sob-on-accent);border:none;font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:8px 16px;border-radius:10px;transition:filter .2s var(--sob-ease),transform .1s var(--sob-ease);}' +
      '.sob-next:hover{filter:brightness(1.08);}' +
      '.sob-next:active{transform:scale(.97);}' +
      '.sob-skip:focus-visible,.sob-next:focus-visible{outline:2px solid var(--sob-accent);outline-offset:2px;}' +
      '@media (prefers-reduced-motion: reduce){.sob-mask,.sob-ring,.sob-pop{transition:none;}}';
    var s = document.createElement('style');
    s.id = 'sob-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function run(id, steps, opts) {
    opts = opts || {};
    steps = (steps || []).filter(function (st) { return st && st.el; });
    if (!steps.length) return;
    injectCSS();

    var accent = opts.accent || '#18a36b';
    var dark = isDark();

    var root = document.createElement('div');
    root.className = 'sob-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.style.setProperty('--sob-accent', accent);
    root.style.setProperty('--sob-on-accent', '#fff');
    root.style.setProperty('--sob-ease', 'cubic-bezier(.22,1,.36,1)');
    root.style.setProperty('--sob-bg', dark ? '#181b19' : '#ffffff');
    root.style.setProperty('--sob-ink', dark ? '#e8ede9' : '#1d1d1f');
    root.style.setProperty('--sob-ink-soft', dark ? '#9aa79d' : '#5c5c62');
    root.style.setProperty('--sob-bd', dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)');

    var catcher = document.createElement('div'); catcher.className = 'sob-catch';
    var mask = document.createElement('div'); mask.className = 'sob-mask';
    var ring = document.createElement('div'); ring.className = 'sob-ring';
    var pop = document.createElement('div'); pop.className = 'sob-pop';
    root.appendChild(catcher); root.appendChild(mask); root.appendChild(ring); root.appendChild(pop);
    document.body.appendChild(root);

    var i = 0, curEl = null;

    function cleanup() {
      window.removeEventListener('resize', reposition, true);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      if (typeof opts.onDone === 'function') { try { opts.onDone(); } catch (e) {} }
    }
    function finish() { mark(id); cleanup(); }

    function stepEl(st) {
      try { return typeof st.el === 'string' ? document.querySelector(st.el) : st.el; } catch (e) { return null; }
    }
    // avança até um passo cujo elemento exista de fato
    function nextValid(from) {
      for (var k = from; k < steps.length; k++) { if (stepEl(steps[k])) return k; }
      return -1;
    }

    function place() {
      var st = steps[i];
      curEl = stepEl(st);
      if (!curEl) { finish(); return; }
      var pad = 8;
      var r = curEl.getBoundingClientRect();
      var vw = innerWidth, vh = innerHeight;
      // spotlight
      mask.style.left = (r.left - pad) + 'px'; mask.style.top = (r.top - pad) + 'px';
      mask.style.width = (r.width + pad * 2) + 'px'; mask.style.height = (r.height + pad * 2) + 'px';
      ring.style.left = (r.left - pad) + 'px'; ring.style.top = (r.top - pad) + 'px';
      ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = (r.height + pad * 2) + 'px';
      // posiciona o balão: lado preferido, com flip quando não cabe
      var pw = Math.min(320, vw - 32), ph = pop.offsetHeight || 180, gap = 16;
      var side = st.side || (r.left > vw * 0.55 ? 'left' : r.bottom + ph + gap < vh ? 'bottom' : 'top');
      var left, top;
      if (side === 'left')  { left = r.left - pw - gap;  top = r.top + r.height / 2 - ph / 2; }
      else if (side === 'right') { left = r.right + gap; top = r.top + r.height / 2 - ph / 2; }
      else if (side === 'top')   { left = r.left + r.width / 2 - pw / 2; top = r.top - ph - gap; }
      else { left = r.left + r.width / 2 - pw / 2; top = r.bottom + gap; }
      // se o lado preferido estoura, tenta o oposto/central
      if (left < 12) left = 12;
      if (left + pw > vw - 12) left = vw - pw - 12;
      if (top < 12) top = r.bottom + gap;
      if (top + ph > vh - 12) top = Math.max(12, r.top - ph - gap);
      if (top + ph > vh - 12) top = Math.max(12, (vh - ph) / 2);
      pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.style.width = pw + 'px';
    }

    function reposition() { if (curEl) place(); }

    function render() {
      var valid = nextValid(i);
      if (valid === -1) { finish(); return; }
      i = valid;
      var st = steps[i];
      var last = nextValid(i + 1) === -1;
      var dots = steps.map(function (_, k) { return '<span class="sob-dot' + (k === i ? ' on' : '') + '"></span>'; }).join('');
      pop.innerHTML =
        '<span class="sob-kicker"><span class="s">♠</span>' + (opts.label || 'Tour rápido') + ' · ' + (i + 1) + '/' + steps.length + '</span>' +
        '<h3 class="sob-title">' + esc(st.title || '') + '</h3>' +
        '<p class="sob-text">' + esc(st.text || '') + '</p>' +
        '<div class="sob-foot"><div class="sob-dots">' + dots + '</div>' +
        '<button type="button" class="sob-skip">' + (last ? '' : 'Pular') + '</button>' +
        '<button type="button" class="sob-next">' + (last ? 'Concluir' : 'Próximo') + '</button></div>';
      pop.querySelector('.sob-next').addEventListener('click', function () { advance(); });
      var skip = pop.querySelector('.sob-skip');
      if (last) skip.style.visibility = 'hidden';
      skip.addEventListener('click', finish);
      // rola o alvo pra vista antes de posicionar
      var el = stepEl(st);
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } catch (e) {} }
      // posiciona no próximo frame — com fallback de timeout porque em aba de
      // segundo plano o requestAnimationFrame não dispara e o balão/spotlight
      // ficariam sem posição
      var applied = false;
      var apply = function () { if (applied) return; applied = true; place(); pop.classList.add('in'); };
      requestAnimationFrame(apply);
      setTimeout(apply, 90);
    }

    function advance() {
      var nxt = nextValid(i + 1);
      if (nxt === -1) { finish(); return; }
      i = nxt; pop.classList.remove('in');
      setTimeout(render, reduce ? 0 : 120);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
    }

    catcher.addEventListener('click', function (e) { e.stopPropagation(); }); // bloqueia cliques no fundo
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKey, true);
    render();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var API = {
    /* roda só na primeira visita da página */
    start: function (id, steps, opts) {
      if (!id || seen(id)) return false;
      // espera o layout assentar (fontes, animações de entrada) antes de medir
      var go = function () { setTimeout(function () { run(id, steps, opts); }, (opts && opts.delay) || 600); };
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go, { once: true });
      return true;
    },
    /* reabre manualmente, ignorando o gate (ex: botão "rever tour") */
    restart: function (id, steps, opts) { try { localStorage.removeItem(KEY + id); } catch (e) {} run(id, steps, opts); },
    seen: seen,
    reset: function (id) { try { localStorage.removeItem(KEY + id); } catch (e) {} }
  };

  global.SupremaOnboarding = API;
})(window);

/* ── SUPREMA OS · COMMAND PALETTE (⌘K) ─────────────────────────────────────
   O buscador global do OS: abre com ⌘K / Ctrl+K em qualquer painel e salta pra
   qualquer produto, torneio, operador ou ação. É a peça que faz um conjunto de
   telas virar sistema — e só foi barata porque a shell (S1) já unificou o chrome.

   Autossuficiente: injeta o próprio CSS (glass escuro, identidade Suprema OS
   independente do tema do painel — igual a um Spotlight), trata teclado/foco e
   respeita prefers-reduced-motion. Sem dependência de framework.

   Cada painel PLUGA seus dados via provider:
     SupremaPalette.register({
       id:'torneios', group:'Torneios',
       search(q){ return [{ title, sub, hint, run(){…} }, …]; }
     });
   A navegação entre produtos e o tema já vêm de fábrica, então incluir o script
   sozinho já entrega ⌘K útil. Carregue com defer — o listener sobe no load. ── */
(function (global) {
  'use strict';
  if (global.SupremaPalette) return;

  var providers = [];
  var RECENT_KEY = 'suprema_palette_recent_v1';

  function norm(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* ── CSS (glass escuro, uma injeção) ── */
  function injectCss(){
    if (document.getElementById('sp-palette-css')) return;
    var reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var css = [
      '.spp-back{position:fixed;inset:0;z-index:2147483000;display:flex;justify-content:center;align-items:flex-start;',
      '  padding:12vh 16px 16px;background:rgba(6,10,8,.55);opacity:0;pointer-events:none;transition:opacity .18s ease}',
      '.spp-back.on{opacity:1;pointer-events:auto}',
      '@supports (backdrop-filter:blur(2px)){.spp-back{backdrop-filter:blur(6px) saturate(120%);-webkit-backdrop-filter:blur(6px) saturate(120%)}}',
      '.spp-panel{width:min(640px,100%);max-height:70vh;display:flex;flex-direction:column;overflow:hidden;',
      '  background:linear-gradient(180deg,#141917,#0e1210);border:1px solid rgba(255,255,255,.1);border-radius:16px;',
      '  box-shadow:0 24px 60px -12px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.4);',
      '  font-family:var(--sup-text,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);color:#eef2ef;',
      '  transform:translateY(-8px) scale(.99);opacity:0;transition:transform .2s cubic-bezier(.16,1,.3,1),opacity .2s}',
      '.spp-back.on .spp-panel{transform:none;opacity:1}',
      reduce ? '.spp-back,.spp-panel{transition:none!important}' : '',
      '.spp-in{display:flex;align-items:center;gap:11px;padding:15px 18px;border-bottom:1px solid rgba(255,255,255,.08)}',
      '.spp-in svg{width:18px;height:18px;flex:none;color:#18a36b}',
      '.spp-in input{flex:1;min-width:0;background:none;border:none;outline:none;color:#eef2ef;font-size:16px;',
      '  font-family:inherit;letter-spacing:-.01em}',
      '.spp-in input::placeholder{color:#6d766f}',
      '.spp-in kbd{font-family:var(--sup-mono,ui-monospace,monospace);font-size:10.5px;color:#a6b0aa;',
      '  border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:2px 6px;background:rgba(255,255,255,.04)}',
      '.spp-list{overflow-y:auto;padding:6px;scrollbar-width:thin}',
      '.spp-group{font-family:var(--sup-mono,ui-monospace,monospace);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;',
      '  color:#6d766f;padding:11px 12px 5px}',
      '.spp-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;',
      '  scroll-margin:8px}',
      '.spp-item .spp-ico{width:26px;height:26px;flex:none;display:grid;place-content:center;border-radius:8px;',
      '  background:rgba(255,255,255,.05);color:#c9a84c;font-size:14px;border:1px solid rgba(255,255,255,.07)}',
      '.spp-item .spp-tt{flex:1;min-width:0}',
      '.spp-item .spp-t{font-size:14px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.spp-item .spp-s{font-size:11.5px;color:#a6b0aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
      '.spp-item .spp-hint{font-family:var(--sup-mono,ui-monospace,monospace);font-size:10.5px;color:#6d766f;flex:none}',
      '.spp-item.on,.spp-item:hover{background:rgba(24,163,107,.16)}',
      '.spp-item.on .spp-ico{background:rgba(24,163,107,.2);color:#2bd393;border-color:rgba(43,211,147,.3)}',
      '.spp-item mark{background:none;color:#2bd393;font-weight:700}',
      '.spp-empty{padding:34px 16px;text-align:center;color:#6d766f;font-size:13.5px}',
      '.spp-foot{display:flex;gap:16px;padding:9px 16px;border-top:1px solid rgba(255,255,255,.07);',
      '  font-family:var(--sup-mono,ui-monospace,monospace);font-size:10px;color:#6d766f}',
      '.spp-foot b{color:#a6b0aa;font-weight:600}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'sp-palette-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ── estado + DOM ── */
  var back, input, list, items = [], active = 0, lastFocus = null;

  function build(){
    injectCss();
    back = document.createElement('div');
    back.className = 'spp-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'Buscar no Suprema OS');
    back.innerHTML =
      '<div class="spp-panel">'
      + '<div class="spp-in">'
      +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
      +   '<input type="text" placeholder="Buscar produto, torneio, operador ou ação…" autocomplete="off" spellcheck="false" aria-label="Busca">'
      +   '<kbd>esc</kbd>'
      + '</div>'
      + '<div class="spp-list" role="listbox"></div>'
      + '<div class="spp-foot"><span><b>↑↓</b> navegar</span><span><b>enter</b> abrir</span><span><b>esc</b> fechar</span></div>'
      + '</div>';
    document.body.appendChild(back);
    input = back.querySelector('input');
    list = back.querySelector('.spp-list');

    back.addEventListener('click', function (e){ if (e.target === back) close(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', onKey);
  }

  /* ── coleta de resultados dos providers ── */
  function collect(q){
    var groups = [];
    providers.forEach(function (p){
      var res;
      try { res = p.search(q) || []; } catch (e){ res = []; }
      if (res.length) groups.push({ group: p.group || '', items: res });
    });
    return groups;
  }

  function highlight(text, q){
    text = esc(text);
    if (!q) return text;
    var i = norm(text).indexOf(norm(q));
    if (i < 0) return text;
    return text.slice(0, i) + '<mark>' + text.slice(i, i + q.length) + '</mark>' + text.slice(i + q.length);
  }

  function render(){
    var q = input.value.trim();
    var groups = collect(q);
    items = [];
    var html = '';
    if (!groups.length){
      list.innerHTML = '<div class="spp-empty">Nada encontrado' + (q ? ' para “' + esc(q) + '”' : '') + '.</div>';
      return;
    }
    groups.forEach(function (g){
      if (g.group) html += '<div class="spp-group">' + esc(g.group) + '</div>';
      g.items.forEach(function (it){
        var idx = items.length;
        items.push(it);
        html += '<div class="spp-item" role="option" data-i="' + idx + '">'
          + '<span class="spp-ico">' + (it.icon || '♠') + '</span>'
          + '<span class="spp-tt"><span class="spp-t">' + highlight(it.title || '', q) + '</span>'
          + (it.sub ? '<span class="spp-s">' + highlight(it.sub, q) + '</span>' : '') + '</span>'
          + (it.hint ? '<span class="spp-hint">' + esc(it.hint) + '</span>' : '')
          + '</div>';
      });
    });
    list.innerHTML = html;
    active = 0;
    paintActive();
    [].forEach.call(list.querySelectorAll('.spp-item'), function (el){
      el.addEventListener('click', function (){ run(+el.dataset.i); });
      el.addEventListener('mousemove', function (){ if (active !== +el.dataset.i){ active = +el.dataset.i; paintActive(); } });
    });
  }

  function paintActive(){
    var els = list.querySelectorAll('.spp-item');
    [].forEach.call(els, function (el, i){ el.classList.toggle('on', i === active); });
    if (els[active]) els[active].scrollIntoView({ block: 'nearest' });
  }

  function onKey(e){
    if (e.key === 'ArrowDown'){ e.preventDefault(); if (items.length){ active = (active + 1) % items.length; paintActive(); } }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); if (items.length){ active = (active - 1 + items.length) % items.length; paintActive(); } }
    else if (e.key === 'Enter'){ e.preventDefault(); run(active); }
    else if (e.key === 'Escape'){ e.preventDefault(); close(); }
  }

  function run(i){
    var it = items[i];
    if (!it || typeof it.run !== 'function') return;
    close();
    try { it.run(); } catch (e){ /* silencioso */ }
  }

  function open(){
    if (!back) build();
    lastFocus = document.activeElement;
    back.classList.add('on');
    input.value = '';
    render();
    setTimeout(function (){ input.focus(); }, 30);
  }
  function close(){
    if (!back) return;
    back.classList.remove('on');
    if (lastFocus && lastFocus.focus){ try { lastFocus.focus(); } catch (e){} }
  }
  function toggle(){ (back && back.classList.contains('on')) ? close() : open(); }

  /* ── atalho global ⌘K / Ctrl+K ── */
  document.addEventListener('keydown', function (e){
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault(); toggle();
    }
  });

  function register(p){ if (p && typeof p.search === 'function') providers.push(p); }

  /* ── provider de fábrica: NAVEGAÇÃO entre produtos ── */
  var here = (location.pathname.split('/').pop() || 'index.html');
  var PRODUCTS = [
    { title:'Painel do Dia',    sub:'Operação diária',           href:'index.html',                icon:'♠', kw:'painel dia agenda torneios grade' },
    { title:'Criação Noturna',  sub:'GU do dia seguinte',        href:'criacao-noturna.html',      icon:'☾', kw:'criacao noturna gu receita' },
    { title:'Radar de Eventos', sub:'Marketing & Atendimento',   href:'eventos.html',              icon:'♦', kw:'radar eventos marketing atendimento agenda' },
    { title:'Suprema TV',       sub:'Broadcast · telão',         href:'tv.html',                   icon:'♠', kw:'tv telao broadcast tela' },
    { title:'Cash Intelligence',sub:'Mesas cash · BI',           href:'dashboard-mesa-cash.html',  icon:'♣', kw:'cash mesas dashboard bi receita' },
    { title:'Admin',            sub:'Gestão & RBAC',             href:'admin.html',                icon:'♦', kw:'admin gestao usuarios permissao auditoria' },
    { title:'Hub',              sub:'Todos os produtos',         href:'hub.html',                  icon:'♠', kw:'hub inicio produtos os' }
  ];
  register({
    id: 'nav', group: 'Ir para',
    search: function (q){
      var nq = norm(q);
      return PRODUCTS.filter(function (p){
        if (p.href === here) return false;                 // não oferece a página atual
        if (!nq) return true;
        return norm(p.title + ' ' + p.sub + ' ' + p.kw).indexOf(nq) >= 0;
      }).slice(0, 8).map(function (p){
        return { title: p.title, sub: p.sub, icon: p.icon, hint: 'abrir', run: function (){ location.href = p.href; } };
      });
    }
  });

  /* ── provider de fábrica: AÇÕES rápidas (tema) ── */
  register({
    id: 'acoes', group: 'Ações',
    search: function (q){
      var out = [];
      var nq = norm(q);
      var isDark = document.documentElement.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
      var themeItem = { title: isDark ? 'Tema claro' : 'Tema escuro', sub: 'Alternar a aparência', icon: isDark ? '☀' : '☾', hint: 'tema',
        run: function (){ var b = document.getElementById('darkToggle') || document.getElementById('themeToggle') || document.getElementById('themeBtn'); if (b) b.click(); } };
      if (!nq || norm('tema claro escuro aparencia theme').indexOf(nq) >= 0) out.push(themeItem);
      return out;
    }
  });

  global.SupremaPalette = { open: open, close: close, toggle: toggle, register: register };
})(window);

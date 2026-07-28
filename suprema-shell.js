/* ── SUPREMA OS · SHELL (chrome compartilhado) ─────────────────────────────
   Fecha a lacuna S1 da análise de produto: antes eram 6 <nav> inline
   divergentes, um por painel, sem nada compartilhado — cada correção do chrome
   precisava ser repetida (ou divergia). Agora a ESTRUTURA do nav mora aqui; cada
   painel só passa a sua identidade (marca, subtítulo, links) e ferramentas.

   Renderiza EXATAMENTE os mesmos ids/classes que os painéis já usavam —
   presenceWrap, syncStatus, navTime, opBadge/opName/opAvatar, darkToggle — então
   o JS de comportamento de cada painel continua funcionando SEM mudança.

   DOIS modos de uso:

   1) mountNav — para painéis do dialeto simples (eventos, criação): a shell
      monta o <nav> inteiro. SÍNCRONO, na posição do nav:
        <nav id="supNav"></nav>
        <script>SupremaShell.mountNav('#supNav', { mark, sub, links, tools, … });</script>

   2) mountControls — para painéis de chrome RICO (painel do dia): o painel mantém
      seu <nav> à mão (marca com fichas, grupo de links externos, cluster de
      ferramentas, ordem própria) e só troca os 5 controles-padrão por um
      placeholder que a shell preenche NA ORDEM do painel — zero mudança visual:
        <div class="nav-right">
          <span id="supControls"></span>   <!-- vira presence+opBadge+sync+time+toggle -->
          <div class="nav-tools">…</div>   <!-- ferramentas do painel, inline -->
        </div>
        <script>SupremaShell.mountControls('#supControls', {
          order:['presence','opBadge','sync','time','toggle'],
          presenceTag:'div', opBadge:'text', opTitle:'Clique para trocar usuário',
          syncClass:'connecting', syncTitle:'…', syncLabel:'Conectando...',
          toggleTitle:'Alternar modo escuro/claro', toggleGlyph:'🌙'
        });</script>

   Assim uma mudança nos controles-padrão (ex.: um sino de avisos no nav) acontece
   AQUI uma vez e vale pra todos — inclusive o painel — sem tocar no visual dele.
── */
(function (global) {
  'use strict';

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

  /* markup interno do sup-switch (trilho degradê + nuvens + knob com emoji
     sol/lua) — estático; o estado mora no aria-pressed do botão e o CSS
     (suprema-tokens.css) faz o resto. Fonte ÚNICA pra todos os painéis:
     shell chama aqui; hub/admin/cash referenciam. */
  var CLOUD_PATH = 'M30,45 Q35,25 50,25 Q65,25 70,45 Q80,45 85,50 Q90,55 85,60 Q80,65 75,60 Q65,60 60,65 Q55,70 50,65 Q45,70 40,65 Q35,60 25,60 Q20,65 15,60 Q10,55 15,50 Q20,45 30,45';
  var SWITCH_INNER =
      '<span class="sw-clouds" aria-hidden="true">'
    +   '<svg class="sw-cloud sw-cloud1" viewBox="0 0 100 100"><path d="' + CLOUD_PATH + '"/></svg>'
    +   '<svg class="sw-cloud sw-cloud2" viewBox="0 0 100 100"><path d="' + CLOUD_PATH + '"/></svg>'
    + '</span>'
    + '<span class="sw-knob"></span>';

  /* aplica o switch a um botão de tema existente: garante a classe, injeta o
     markup uma vez e reflete o estado. dark=true → modo escuro. Idempotente:
     pode ser chamado a cada troca de tema sem duplicar o markup. */
  function paintSwitch(btn, dark){
    if (!btn) return;
    btn.classList.add('sup-switch');
    if (!btn.querySelector('.sw-knob')) btn.innerHTML = SWITCH_INNER;
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  /* ── builders de cada controle-padrão (defaults = dialeto eventos/criação) ── */
  var CTRL = {
    presence: function (o){
      var tag = o.presenceTag || 'span';
      return '<' + tag + ' class="presence-wrap" id="presenceWrap"'
        + (o.presenceTitle ? ' title="' + esc(o.presenceTitle) + '"' : '')
        + ' hidden></' + tag + '>';
    },
    sync: function (o){
      return '<span class="sync-status' + (o.syncClass ? ' ' + o.syncClass : '') + '" id="syncStatus"'
        + (o.syncTitle ? ' title="' + esc(o.syncTitle) + '"' : '') + '>'
        + '<span class="sync-dot"></span><span class="sync-label">' + (o.syncLabel || 'Conectando…') + '</span></span>';
    },
    time: function (o){
      return '<span class="nav-time" id="navTime"' + (o.timeTitle ? ' title="' + esc(o.timeTitle) + '"' : '') + '></span>';
    },
    opBadge: function (o){
      var title = ' title="' + esc(o.opTitle || 'Sessão ativa') + '"';
      if (o.opBadge === 'text')   // botão de texto simples (painel do dia)
        return '<button class="op-badge" id="opBadge"' + title + '></button>';
      return '<button class="op-badge" id="opBadge"' + title + '><span class="avatar" id="opAvatar">?</span><span id="opName">—</span></button>';
    },
    toggle: function (o){
      return '<button class="sup-switch" id="darkToggle" aria-pressed="false" title="' + esc(o.toggleTitle || 'Alternar modo claro/escuro') + '">' + SWITCH_INNER + '</button>';
    }
  };

  /* devolve os controles-padrão concatenados na ordem pedida (default = dialeto
     eventos/criação: presence, sync, time, opBadge, toggle). */
  function controls(opts){
    opts = opts || {};
    var order = opts.order || ['presence', 'sync', 'time', 'opBadge', 'toggle'];
    return order.map(function (k){ return CTRL[k] ? CTRL[k](opts) : ''; }).join('');
  }

  function linkTag(l){
    if (!l || !l.href) return '';
    return '<a href="' + esc(l.href) + '"'
      + (l.title ? ' title="' + esc(l.title) + '"' : '')
      + (l.id ? ' id="' + esc(l.id) + '"' : '')
      + (l.cls ? ' class="' + esc(l.cls) + '"' : '')
      + '>' + (l.label || '') + '</a>';
  }

  /* innerHTML do <nav> completo (dialeto simples). Usa controls() com o default
     eventos/criação — o cluster direito sai idêntico ao que era inline. */
  function navHTML(cfg){
    cfg = cfg || {};
    var links = (cfg.links || []).map(linkTag).join('');
    return '<div class="nav-inner">'
      +   '<div class="brand">'
      +     (cfg.mark || '')
      +     '<span class="brand-text">' + (cfg.brandText || 'Suprema OS') + '</span>'
      +     (cfg.sub ? '<span class="brand-sub">' + cfg.sub + '</span>' : '')
      +   '</div>'
      +   '<div class="nav-links">' + links + '</div>'
      +   '<div class="nav-right">'
      +     (cfg.tools || '')
      +     controls({
              presenceTitle: cfg.presenceTitle || 'Operadores online agora',
              syncLabel: cfg.syncLabel || 'Conectando…',
              timeTitle: cfg.timeTitle,
              opTitle: cfg.opTitle
            })
      +   '</div>'
      + '</div>';
  }

  function mountNav(target, cfg){
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (el) el.innerHTML = navHTML(cfg);
    return el;
  }

  /* substitui o placeholder pelos controles-padrão como IRMÃOS diretos (outerHTML),
     preservando o flex do .nav-right. Roda síncrono, logo após o placeholder. */
  function mountControls(target, opts){
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (el) el.outerHTML = controls(opts || {});
  }

  /* ── MENU MOBILE (drawer) ──────────────────────────────────────────────
     No celular os links de navegação entre painéis somem (não cabem no header)
     — então todo painel ganha um botão ☰ que abre um drawer com TODOS os
     produtos que a pessoa acessa + tema + sair. Um lugar só (shell), igual em
     todos. Chame `SupremaShell.mobileMenu({ current:'gu' })` depois de montar o
     nav. Idempotente (cria uma vez). */
  var PANEL_ACCENT = {
    painel:'#18a36b', gu:'#8c5cc6', cash:'#4f8ef7', eventos:'#b3475d',
    learn:'#e8933d', analytics:'#4f8ef7', tv:'#c9a84c', pipe:'#b3475d',
    admin:'#c9a84c', org:'#c9a84c'
  };
  function panelHref(p){ return p.external ? p.url : (p.file || (p.id === 'hub' ? 'hub.html' : '')); }
  function mobileMenu(opts){
    opts = opts || {};
    var current = opts.current || '';
    var Auth = global.SupremaAuth;
    if (document.getElementById('supMobBtn')) return;   // já instalado

    // botão ☰ (só aparece no mobile, via CSS)
    var btn = document.createElement('button');
    btn.id = 'supMobBtn'; btn.className = 'sup-mob-btn'; btn.type = 'button';
    btn.setAttribute('aria-label', 'Abrir menu de navegação');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    document.body.appendChild(btn);

    // painéis que a pessoa acessa (deny-by-default já resolvido no canAccess)
    var panels = (Auth && Auth.PANELS ? Auth.PANELS : []).filter(function (p){
      if (p.adminOnly) return !!(Auth && Auth.canAccess && Auth.canAccess(p.id));
      return !Auth || !Auth.canAccess ? true : Auth.canAccess(p.id);
    });
    function row(p){
      var here = p.id === current;
      var accent = PANEL_ACCENT[p.id] || '#c9a84c';
      var href = panelHref(p);
      var ext = p.external ? ' target="_blank" rel="noopener"' : '';
      return '<a class="sup-mob-row' + (here ? ' here' : '') + '" href="' + esc(href) + '"' + ext
        + (here ? ' aria-current="page"' : '') + ' style="--rc:' + accent + '">'
        +   '<span class="rc-dot"></span>'
        +   '<span class="rc-lab">' + esc(p.label) + (p.external ? ' <span class="rc-ext">↗</span>' : '') + '</span>'
        +   (here ? '<span class="rc-here">você está aqui</span>' : '<span class="rc-go">›</span>')
        + '</a>';
    }
    var dark = !!(Auth && Auth.isDarkPreferred && Auth.isDarkPreferred());
    var drawer = document.createElement('div');
    drawer.id = 'supMobDrawer'; drawer.className = 'sup-mob-drawer'; drawer.hidden = true;
    drawer.innerHTML =
        '<div class="smd-scrim" data-smd-close></div>'
      + '<aside class="smd-panel" role="dialog" aria-modal="true" aria-label="Navegação">'
      +   '<div class="smd-head">'
      +     '<span class="smd-brand">♠ Suprema OS</span>'
      +     '<button class="smd-x" type="button" aria-label="Fechar menu" data-smd-close>✕</button>'
      +   '</div>'
      +   '<div class="smd-scroll">'
      +   '<div class="smd-sec-label">Ir para</div>'
      +   '<nav class="smd-list">' + panels.map(row).join('')
      +     '<a class="sup-mob-row" href="hub.html" style="--rc:#c9a84c"><span class="rc-dot"></span><span class="rc-lab">♠ Hub — todos os produtos</span><span class="rc-go">›</span></a>'
      +   '</nav>'
      +   (opts.extra && opts.extra.items && opts.extra.items.length
          ? '<div class="smd-sec-label">' + esc(opts.extra.label || 'Ferramentas') + '</div>'
            + '<div class="smd-list">' + opts.extra.items.map(function (t){
                return '<button class="sup-mob-row smd-tool" type="button" data-act="' + esc(t.act) + '"'
                  + (t.arg ? ' data-arg="' + esc(t.arg) + '"' : '') + '>'
                  + '<span class="rc-glyph">' + (t.glyph || '•') + '</span>'
                  + '<span class="rc-lab">' + esc(t.label) + '</span><span class="rc-go">›</span></button>';
              }).join('') + '</div>'
          : '')
      +   '</div>'
      +   '<div class="smd-foot">'
      +     '<button class="smd-act" type="button" data-smd-theme aria-pressed="' + (dark ? 'true' : 'false') + '">'
      +       '<span class="sa-ic">' + (dark ? '☀️' : '🌙') + '</span><span data-smd-theme-lab>' + (dark ? 'Modo claro' : 'Modo escuro') + '</span>'
      +     '</button>'
      +     '<button class="smd-act danger" type="button" data-smd-logout><span class="sa-ic">⏻</span>Sair</button>'
      +   '</div>'
      + '</aside>';
    document.body.appendChild(drawer);

    function open(){ drawer.hidden = false; document.body.classList.add('smd-open'); btn.setAttribute('aria-expanded','true');
      requestAnimationFrame(function(){ drawer.classList.add('on'); }); }
    function close(){ drawer.classList.remove('on'); btn.setAttribute('aria-expanded','false'); document.body.classList.remove('smd-open');
      setTimeout(function(){ drawer.hidden = true; }, 260); }
    btn.addEventListener('click', function(){ drawer.hidden ? open() : close(); });
    // fecha ao tocar no scrim/✕, num link de painel, ou numa ferramenta (a ação
    // dela — via delegação [data-act] do document — abre por cima)
    drawer.addEventListener('click', function(e){
      if (e.target.closest('[data-smd-close]') || e.target.closest('.sup-mob-row')) close();
    });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !drawer.hidden) close(); });

    // tema no drawer (mesma fonte de verdade dos painéis)
    drawer.querySelector('[data-smd-theme]').addEventListener('click', function(){
      var nowDark = !document.documentElement.classList.contains('dark');
      document.documentElement.classList.toggle('dark', nowDark);
      if (Auth && Auth.setThemePref) Auth.setThemePref(nowDark);
      this.setAttribute('aria-pressed', nowDark ? 'true' : 'false');
      this.querySelector('.sa-ic').textContent = nowDark ? '☀️' : '🌙';
      this.querySelector('[data-smd-theme-lab]').textContent = nowDark ? 'Modo claro' : 'Modo escuro';
      // repinta qualquer sup-switch existente no header
      document.querySelectorAll('.sup-switch').forEach(function(sw){ paintSwitch(sw, nowDark); });
    });
    drawer.querySelector('[data-smd-logout]').addEventListener('click', function(){
      try { if (Auth && Auth.clearSession) Auth.clearSession(); } catch(e){}
      try { if (global.firebase && firebase.auth) { firebase.auth().signOut().then(go, go); return; } } catch(e){}
      go();
      function go(){ location.href = 'hub.html'; }
    });
  }

  global.SupremaShell = { navHTML: navHTML, mountNav: mountNav, controls: controls, mountControls: mountControls, switchInner: SWITCH_INNER, paintSwitch: paintSwitch, mobileMenu: mobileMenu };
})(window);

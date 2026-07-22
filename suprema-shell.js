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
      return '<button class="icon-btn" id="darkToggle" title="' + esc(o.toggleTitle || 'Alternar modo claro/escuro') + '">' + (o.toggleGlyph || '☀️') + '</button>';
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

  global.SupremaShell = { navHTML: navHTML, mountNav: mountNav, controls: controls, mountControls: mountControls };
})(window);

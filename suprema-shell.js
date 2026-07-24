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

  /* markup interno do sup-switch (sol | pílula | lua) — estático; o estado mora
     no aria-pressed do botão e o CSS (suprema-tokens.css) faz o resto. Fonte
     ÚNICA pra todos os painéis: shell chama aqui; hub/admin/cash referenciam. */
  var SWITCH_INNER =
      '<svg class="sw-flank sw-sun" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"/></svg>'
    + '<span class="sw-pill"><span class="sw-knob"></span></span>'
    + '<svg class="sw-flank sw-moon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/></svg>';

  /* aplica o switch a um botão de tema existente: garante a classe, injeta o
     markup uma vez e reflete o estado. dark=true → modo escuro. Idempotente:
     pode ser chamado a cada troca de tema sem duplicar o markup. */
  function paintSwitch(btn, dark){
    if (!btn) return;
    btn.classList.add('sup-switch');
    if (!btn.querySelector('.sw-pill')) btn.innerHTML = SWITCH_INNER;
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
      return '<button class="icon-btn sup-switch" id="darkToggle" aria-pressed="false" title="' + esc(o.toggleTitle || 'Alternar modo claro/escuro') + '">' + SWITCH_INNER + '</button>';
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

  global.SupremaShell = { navHTML: navHTML, mountNav: mountNav, controls: controls, mountControls: mountControls, switchInner: SWITCH_INNER, paintSwitch: paintSwitch };
})(window);

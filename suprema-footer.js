/* =========================================================================
   SUPREMA-FOOTER — rodapé de marca compartilhado por todos os painéis.

   POR QUE ISSO EXISTE
   -------------------
   O rodapé (redes sociais + wordmark) é o mesmo em 7 painéis. Em vez de colar
   o markup em cada HTML (7 chances de divergir), este módulo injeta um <footer>
   único + o <style> escopado uma vez só. Mudou o link/cor aqui, muda em todo lado.

   COMO USAR
   ---------
   Basta incluir <script defer src="suprema-footer.js"></script> no painel. Ele
   se auto-injeta no fim do <body> ao carregar. Para NÃO renderizar num painel
   específico (ex.: telão/broadcast), defina window.SUPREMA_NO_FOOTER = true antes
   do script, ou dê ao <body> o atributo data-no-footer.

   PSICOLOGIA / DESIGN
   -------------------
   · Rodapé é CHROME, não herói: fica quieto (tinta suave), e só ACENDE em dourado
     champagne no hover — o dourado é recompensa/premium, usado com parcimônia.
   · Theme-aware: consome os tokens da marca (--sup-gold / --gold), então acompanha
     claro/escuro sem media query própria; fallback embutido se os tokens faltarem.
   · Ícones inline (sem request externo, respeita a CSP dos painéis) e com rótulo
     textual ao lado — reconhecimento > memória, e acessível a leitor de tela.
========================================================================= */
(function () {
  'use strict';

  if (window.__supremaFooterInjected) return;
  if (window.SUPREMA_NO_FOOTER) return;

  function boot() {
    if (window.__supremaFooterInjected) return;
    var body = document.body;
    if (!body) return;
    if (body.hasAttribute('data-no-footer')) return;
    window.__supremaFooterInjected = true;

    injectStyle();

    var footer = document.createElement('footer');
    footer.className = 'suprema-footer';
    footer.setAttribute('role', 'contentinfo');
    footer.innerHTML =
      '<div class="sf-inner">' +
        '<div class="sf-brand">' +
          '<span class="sf-mark">Suprema<span class="sf-mark-os">OS</span></span>' +
          '<span class="sf-tagline">Sistema operacional da operação</span>' +
        '</div>' +
        '<nav class="sf-social" aria-label="Redes sociais da Suprema">' +
          link('https://www.instagram.com/supremapoker.br', 'Instagram', '@supremapoker.br', ICON.instagram) +
          link('https://www.tiktok.com/@supremagaming', 'TikTok', '@supremagaming', ICON.tiktok) +
          link('https://www.linkedin.com/company/supremagaming/', 'LinkedIn', 'Suprema Gaming', ICON.linkedin) +
        '</nav>' +
      '</div>' +
      '<div class="sf-legal">© ' + new Date().getFullYear() + ' Suprema — uso interno da operação.</div>';

    body.appendChild(footer);
  }

  function link(href, network, handle, svg) {
    return '<a class="sf-link" href="' + href + '" target="_blank" rel="noopener noreferrer" ' +
      'aria-label="' + network + ' — ' + handle + '">' +
      '<span class="sf-ico" aria-hidden="true">' + svg + '</span>' +
      '<span class="sf-txt"><span class="sf-net">' + network + '</span>' +
      '<span class="sf-handle">' + handle + '</span></span>' +
      '</a>';
  }

  var ICON = {
    instagram:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>' +
      '<circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
      '<path d="M16.5 3c.4 2 1.6 3.4 3.5 3.7v2.5c-1.3.1-2.5-.2-3.6-.8v5.9c0 3.2-2.3 5.7-5.5 5.7-3 0-5.4-2.3-5.4-5.3 0-3.1 2.7-5.6 5.9-5.1v2.7c-.4-.1-.8-.2-1.2-.2-1.5 0-2.6 1.1-2.6 2.6 0 1.5 1.1 2.6 2.5 2.6 1.5 0 2.6-1.1 2.6-2.8V3h3.3z"/></svg>',
    linkedin:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
      '<path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0-.02-5zM3 9.5h4v11H3v-11zm6 0h3.8v1.5h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.75v5.7h-4v-5c0-1.2-.02-2.75-1.9-2.75-1.9 0-2.2 1.3-2.2 2.66v5.09H9v-11z"/></svg>'
  };

  function injectStyle() {
    if (document.getElementById('suprema-footer-style')) return;
    var css =
      '.suprema-footer{' +
        'margin-top:clamp(48px,8vw,96px);padding:28px clamp(16px,4vw,48px) 30px;' +
        'border-top:1px solid var(--sup-hairline,rgba(0,0,0,.08));' +
        'font-family:var(--sup-text,"Segoe UI",system-ui,sans-serif);' +
        'background:var(--sup-footer-bg,transparent);' +
      '}' +
      '.suprema-footer .sf-inner{' +
        'max-width:1200px;margin:0 auto;display:flex;flex-wrap:wrap;gap:20px 32px;' +
        'align-items:center;justify-content:space-between;' +
      '}' +
      '.suprema-footer .sf-brand{display:flex;flex-direction:column;gap:2px;min-width:0}' +
      '.suprema-footer .sf-mark{' +
        'font-family:var(--sup-display,var(--sup-text,system-ui));' +
        'font-weight:800;font-size:18px;letter-spacing:-.01em;line-height:1;' +
        'color:var(--sup-ink,#1d1d1f);' +
      '}' +
      '.suprema-footer .sf-mark-os{margin-left:5px;color:var(--gold,var(--sup-gold,#8f6c14))}' +
      '.suprema-footer .sf-tagline{' +
        'font-size:11.5px;letter-spacing:.02em;color:var(--sup-ink-soft,#6e6e73)}' +
      '.suprema-footer .sf-social{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}' +
      '.suprema-footer .sf-link{' +
        'display:inline-flex;align-items:center;gap:9px;text-decoration:none;' +
        'padding:8px 13px;border-radius:12px;' +
        'border:1px solid var(--sup-hairline,rgba(0,0,0,.08));' +
        'color:var(--sup-ink-soft,#6e6e73);background:transparent;' +
        'transition:color .25s var(--sup-ease,ease),border-color .25s var(--sup-ease,ease),' +
        'background .25s var(--sup-ease,ease),transform .25s var(--sup-ease,ease);' +
      '}' +
      '.suprema-footer .sf-link:hover{' +
        'color:var(--gold,var(--sup-gold,#8f6c14));' +
        'border-color:color-mix(in srgb,var(--gold,#8f6c14) 45%,transparent);' +
        'background:color-mix(in srgb,var(--gold,#8f6c14) 8%,transparent);' +
        'transform:translateY(-1px);' +
      '}' +
      '.suprema-footer .sf-ico{display:inline-flex;width:20px;height:20px;flex:none}' +
      '.suprema-footer .sf-ico svg{width:100%;height:100%}' +
      '.suprema-footer .sf-txt{display:flex;flex-direction:column;line-height:1.2}' +
      '.suprema-footer .sf-net{font-size:13px;font-weight:600;color:var(--sup-ink,#1d1d1f)}' +
      '.suprema-footer .sf-link:hover .sf-net{color:var(--gold,var(--sup-gold,#8f6c14))}' +
      '.suprema-footer .sf-handle{font-size:11px;color:var(--sup-ink-faint,#86868b)}' +
      '.suprema-footer .sf-legal{' +
        'max-width:1200px;margin:18px auto 0;font-size:11px;' +
        'color:var(--sup-ink-faint,#86868b);text-align:center}' +
      '@media (max-width:640px){' +
        '.suprema-footer .sf-inner{flex-direction:column;align-items:flex-start;gap:16px}' +
        '.suprema-footer .sf-social{width:100%}' +
        '.suprema-footer .sf-link{flex:1 1 auto;justify-content:center}' +
      '}';
    var style = document.createElement('style');
    style.id = 'suprema-footer-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

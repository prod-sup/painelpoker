/* =========================================================================
   PAINEL-ACTIONS — despachante de ações do Painel do Dia.

   POR QUÊ
   -------
   O index.html tinha 42 handlers inline (onclick="setUpcomingCat('soon',this)").
   Isso amarrava o markup a funções que precisam ser globais PRA SEMPRE, e
   `unsafe-inline` no CSP é obrigatório enquanto eles existirem.

   Agora o HTML declara a intenção e este arquivo executa:
       <button data-act="setUpcomingCat" data-arg="soon">

   A função é resolvida em `window` NA HORA DO CLIQUE — então a ordem de
   carregamento não importa, e o painel.js pode ser encapsulado depois: basta
   exportar os nomes listados em ACTIONS (é a lista completa do que o HTML usa).

   Um clique só é tratado se o alvo (ou um ancestral) tiver [data-act], então
   um listener no document cobre a página inteira, inclusive markup criado
   depois — sem religar nada.
   ========================================================================= */
(function () {
  'use strict';

  /* Ações que não são simplesmente "chame a global de mesmo nome". */
  const LOCAL = {
    /* fecha o perfil só quando o clique é no fundo, não no cartão */
    closeProfileBackdrop(el, arg, ev) {
      if (ev.target === el && typeof window.closeUserProfile === 'function') window.closeUserProfile();
    },
    /* eram DOM inline no atributo; viraram ação nomeada */
    hideWelcomeOverlay() {
      const o = document.getElementById('wbOverlay');
      if (o) o.style.display = 'none';
    },
    openGlobalFilePicker() {
      const i = document.getElementById('fileInputGlobal');
      if (i) i.click();
    },
  };

  /* Globais do painel.js que o HTML aciona. Se o painel.js for encapsulado,
     ESTA é a lista que precisa continuar exposta em window. */
  const ACTIONS = [
    'setUpcomingCat', 'setUpcomingCamp', 'setUpcomingPrem', 'setResultsCat',
    'clearAllUpcomingFilters', 'setOpFilter', 'toggleCompactMode', 'toggleActivityLog',
    'switchAuthTab', 'doLogin', 'doRecovery', 'togglePassVisibility',
    'closeUserProfile', 'upPickEmoji', 'upLogout', 'upChangeAccount',
    'upAcceptError', 'upDenyError', 'closeWelcomeSuccess',
    'requestNotifPermission', 'dismissNotifBanner', 'ovcOnSelectChange',
  ];

  function run(el, ev) {
    const act = el.getAttribute('data-act');
    if (!act) return;
    const arg = el.getAttribute('data-arg');

    if (LOCAL[act]) { LOCAL[act](el, arg, ev); return; }

    const fn = window[act];
    if (typeof fn !== 'function') {
      console.warn('[painel-actions] ação sem função:', act);
      return;
    }
    /* assinatura original: fn(arg, elemento) quando havia argumento no HTML,
       fn() quando não havia. Mantida igual pra não mexer no painel.js. */
    if (arg === null) fn.call(window);
    else fn.call(window, arg, el);
  }

  function handler(ev) {
    /* alvo pode não ser Element (document, nó de texto em engines antigas) */
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    const el = t.closest('[data-act]');
    if (!el) return;
    /* eventos diferentes não podem se atropelar: um [data-act-on="change"] só
       responde a change, e o resto só a click. */
    const want = el.getAttribute('data-act-on') || 'click';
    if (want !== ev.type) return;
    run(el, ev);
  }

  document.addEventListener('click', handler);
  document.addEventListener('change', handler);
})();

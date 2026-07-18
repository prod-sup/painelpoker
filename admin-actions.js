/* =========================================================================
   ADMIN-ACTIONS — despachante de ações do painel Admin.

   POR QUÊ
   -------
   O admin.html tinha 92 handlers inline — o maior número de qualquer painel.
   Eles amarram o markup a funções que precisam ser globais pra sempre e
   obrigam `unsafe-inline` no CSP, justamente na tela de maior privilégio.

   Agora o HTML declara a intenção:
       <button data-act="setAuditPeriod" data-arg="week">

   Mesma mecânica do painel-actions.js: a função é resolvida em `window` NA HORA
   DO CLIQUE, então ordem de carregamento não importa e o admin.js pode ser
   encapsulado depois — basta manter exposto o que está em ACTIONS.

   TIPOS: o HTML só carrega texto, mas `setGp(90,this)` e `setCnPeriod(1)`
   recebiam NÚMERO. Argumento puramente numérico é convertido de volta pra
   número; o resto continua string ('week', 'moAddOp', 'premiacao').
   ========================================================================= */
(function () {
  'use strict';

  /* Ações que não são "chame a global de mesmo nome" — cada uma existia como
     código solto dentro do atributo. */
  const LOCAL = {
    /* era: buildFieldTrend();document.getElementById('moFieldTrend').classList.add('open') */
    openFieldTrend() {
      if (typeof window.buildFieldTrend === 'function') window.buildFieldTrend();
      const mo = document.getElementById('moFieldTrend');
      if (mo) mo.classList.add('open');
    },
    /* era: nav('criacao', document.querySelector('.ntab[onclick*=criacao]'));return false
       ATENÇÃO: o seletor original procurava a aba PELO PRÓPRIO onclick. Com os
       handlers inline removidos, aquele seletor não acharia mais nada — por isso
       ele virou [data-act="nav"][data-arg="criacao"]. */
    goCriacao(el, arg, ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      const aba = document.querySelector('.ntab[data-act="nav"][data-arg="criacao"]');
      if (typeof window.nav === 'function') window.nav('criacao', aba);
    },
    /* era: if(event.key==='Enter')doLogin() */
    loginOnEnter(el, arg, ev) {
      if (ev && ev.key === 'Enter' && typeof window.doLogin === 'function') window.doLogin();
    },
    /* eram: debounced('grade',renderGrade,150) / debounced('cn',renderCn,150)
       — passavam REFERÊNCIA de função, que não cabe num data-attribute. */
    debouncedGrade() {
      if (typeof window.debounced === 'function') window.debounced('grade', window.renderGrade, 150);
    },
    debouncedCn() {
      if (typeof window.debounced === 'function') window.debounced('cn', window.renderCn, 150);
    },
    /* eram: blockOp(this.dataset.key,this.dataset.name) e forceUnblockOp(idem).
       Os dados já estão no próprio elemento — lê de lá em vez de montar chamada. */
    blockOpFromEl(el) {
      if (typeof window.blockOp === 'function') window.blockOp(el.dataset.key, el.dataset.name);
    },
    forceUnblockOpFromEl(el) {
      if (typeof window.forceUnblockOp === 'function') window.forceUnblockOp(el.dataset.key, el.dataset.name);
    },
  };

  /* Globais do admin.js que o HTML aciona. Se o admin.js for encapsulado, ESTA
     é a lista que precisa continuar exposta em window. */
  const ACTIONS = [
    'nav', 'doLogin', 'doLogout', 'toggleDark',
    'setDp', 'setGp', 'setCnPeriod', 'setAuditPeriod',
    'renderGrade', 'renderCn', 'loadAudit', 'loadCriacao',
    'openAddOp', 'createOp', 'confirmBlockOp', 'backfillUidIndex',
    'openAdminLog', 'openJustifs', 'openNotifHistory', 'openOpRanking',
    'openOverlayHeatmap', 'openAuditSummary', 'openInsightSettings',
    'buildAuditSummary', 'buildFieldTrend', 'buildMonthProjection',
    'saveAudit', 'saveAviso', 'saveHubLink', 'saveHubEvent', 'saveHubPatch',
    'saveInsightSettings', 'resetAvisoForm',
    'sendNotif', 'selNotifType', 'batchApprove', 'batchDeselect', 'batchNotifyAnomalias',
    'toggleSoAnomalia', 'toggleCnErros',
    'exportAuditXlsx', 'exportAuditSummaryXlsx', 'exportGradeXlsx', 'exportCnXlsx',
    'exportMonthXlsx', 'exportAllTimeXlsx', 'exportToSheets', 'copyAppsScript',
    'previewCleanup', 'runCleanup', 'closeMo', 'maskBRL',
    'openAuditEditByEl', 'openNotifByEl',
    /* acionadas por markup que o próprio admin.js gera (tabelas, listas) — a
       delegação cobre elemento criado depois, então não precisam religar nada */
    'goToAuditFor', 'toggleAccess', 'toggleAviso', 'editAviso', 'removeAviso',
    'removeHubLink', 'removeHubEvent', 'resolveNotif',
    'markCnError', 'clearCnError', 'notifyCnError',
    'toggleCheckAll', 'updateBatchActions',
    'blockOp', 'forceUnblockOp',
  ];

  /* '90' → 90, mas 'week'/'moAddOp' continuam string */
  function coerce(v) {
    if (v === null) return null;
    return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }

  function run(el, ev) {
    const act = el.getAttribute('data-act');
    if (!act) return;
    const argRaw = el.getAttribute('data-arg');

    if (LOCAL[act]) { LOCAL[act](el, argRaw, ev); return; }

    const fn = window[act];
    if (typeof fn !== 'function') {
      console.warn('[admin-actions] ação sem função:', act);
      return;
    }
    /* assinatura original: fn(arg, elemento) quando havia argumento,
       fn(elemento) quando o HTML passava só `this`, fn() quando não passava nada. */
    const arg2 = el.getAttribute('data-arg2');
    if (argRaw === null) {
      if (el.hasAttribute('data-act-self')) fn.call(window, el);
      else fn.call(window);
    } else if (arg2 !== null) {
      fn.call(window, coerce(argRaw), coerce(arg2));   // ex.: resolveNotif(opKey, nid)
    } else {
      fn.call(window, coerce(argRaw), el);
    }
  }

  function handler(ev) {
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    const el = t.closest('[data-act]');
    if (!el) return;
    const want = el.getAttribute('data-act-on') || 'click';
    if (want !== ev.type) return;
    run(el, ev);
  }

  ['click', 'change', 'input', 'keydown'].forEach(tipo =>
    document.addEventListener(tipo, handler));
})();

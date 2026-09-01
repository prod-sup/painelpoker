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
    'nav', 'doLogin', 'doLogout', 'toggleDark', 'toggleTbMenu',
    'setDp', 'setGp', 'setCnPeriod', 'setAuditPeriod',
    'renderGrade', 'renderCn', 'loadAudit', 'loadCriacao',
    'openAddOp', 'createOp', 'confirmBlockOp', 'backfillUidIndex',
    'openAdminLog', 'openJustifs', 'openNotifHistory', 'openAlertas', 'setAlertasPeriod', 'toggleOpRanking',
    'buildOpRanking', 'buildHeatmap', 'filterOps', 'openAuditSummary', 'openInsightSettings',
    'buildAuditSummary', 'buildFieldTrend', 'buildMonthProjection',
    'saveAudit', 'openAddTorneio', 'saveAddTorneio', 'syncAddEtapa', 'openCampanhaCfg', 'saveCampanhaCfg', 'saveAviso', 'saveHubLink', 'saveHubEvent', 'saveHubPatch',
    'saveInsightSettings', 'resetAvisoForm',
    'sendNotif', 'selNotifType', 'batchApprove', 'batchDeselect', 'batchNotifyAnomalias', 'approveAllAudit',
    'toggleSoAnomalia', 'toggleCnErros',
    'exportAuditXlsx', 'exportAuditSummaryXlsx', 'exportGradeXlsx', 'exportCnXlsx',
    'exportMonthXlsx', 'exportAllTimeXlsx', 'exportToSheets', 'copyAppsScript',
    'previewCleanup', 'runCleanup', 'previewCleanupUntil', 'runCleanupUntil', 'closeMo', 'maskBRL',
    'openAuditEditByEl', 'openNotifByEl',
    /* 🗑 de QUALQUER linha da auditoria (tombstone em painel/<data>/auditHidden)
       e o Restaurar da faixa. ESCRITA: ficam FORA do LIMITED_ALLOW de propósito,
       o admin limitado não apaga nada. Substituíram o removeAddedTorneioByEl,
       que só sabia excluir a linha adicionada à mão. */
    'removeAuditRowByEl', 'restoreHiddenAudit',
    /* acionadas por markup que o próprio admin.js gera (tabelas, listas) — a
       delegação cobre elemento criado depois, então não precisam religar nada */
    'goToAuditFor', 'toggleAccess', 'toggleAviso', 'editAviso', 'removeAviso',
    'removeHubLink', 'restoreHubLink', 'removeHubEvent', 'resolveNotif',
    'markCnError', 'clearCnError', 'notifyCnError',
    'toggleCheckAll', 'updateBatchActions',
    'blockOp', 'forceUnblockOp',
    'openOpLevelByEl', 'setLvQuick', 'saveOpLevel', 'openOpAccessByEl',
  ];

  /* '90' → 90, mas 'week'/'moAddOp' continuam string */
  function coerce(v) {
    if (v === null) return null;
    return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }

  /* ── ADMIN LIMITADO (só leitura) ──────────────────────────────────────
     O admin NÃO-Suprema pode: navegar, ver/renderizar/abrir modais de leitura,
     filtrar períodos e EXPORTAR os XLSX. Nada que ALTERE dado. É um ALLOWLIST:
     o que não estiver aqui é bloqueado (bloquear é o default seguro — liberar uma
     escrita por engano seria falha). As regras do RTDB são a autoridade real; isto
     é a trava de UI que evita cliques que só falhariam no servidor. */
  const LIMITED_ALLOW = new Set([
    'nav', 'doLogin', 'doLogout', 'toggleDark', 'toggleTbMenu', 'toggleOpRanking', 'loginOnEnter',
    'setDp', 'setGp', 'setCnPeriod', 'setAuditPeriod',
    'renderGrade', 'renderCn', 'loadAudit', 'loadCriacao', 'debouncedGrade', 'debouncedCn',
    'goCriacao', 'goToAuditFor',
    'openAdminLog', 'openJustifs', 'openNotifHistory', 'openAlertas', 'setAlertasPeriod', 'toggleOpRanking', 'buildOpRanking', 'buildHeatmap',
    'openAuditSummary', 'openInsightSettings',
    'buildAuditSummary', 'buildFieldTrend', 'buildMonthProjection',
    'toggleSoAnomalia', 'toggleCnErros', 'toggleCheckAll', 'updateBatchActions', 'filterOps',
    // loadManualList só LÊ painel/<data>/manualRows pra montar a lista do modal — a
    // exclusão (removeManualByEl) fica de fora e continua barrada no modo leitura
    'loadManualList',
    'previewCleanup', 'previewCleanupUntil', 'closeMo', 'maskBRL', 'openCampanhaCfg',
    // EXPORTAR XLSX (leitura → arquivo). exportToSheets fica FORA: escreve no Sheets.
    'exportAuditXlsx', 'exportAuditSummaryXlsx', 'exportGradeXlsx', 'exportCnXlsx',
    'exportMonthXlsx', 'exportAllTimeXlsx', 'exportSqlite', 'copyAppsScript',
  ]);
  let _roToastAt = 0, _roToastEl = null;
  function roToast(msg) {
    try {
      if (!document.body) return;
      if (!_roToastEl) {
        var st = document.createElement('style');
        st.textContent = '.sp-ro-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,10px);z-index:99999;' +
          'max-width:min(92vw,440px);padding:11px 18px;border-radius:14px;pointer-events:none;text-align:center;' +
          'background:rgba(20,18,14,.96);border:1px solid rgba(247,148,29,.5);color:#f4ede0;' +
          'font:600 13px/1.4 "Segoe UI",system-ui,sans-serif;box-shadow:0 14px 40px -12px rgba(0,0,0,.7);' +
          'opacity:0;transition:opacity .25s ease,transform .25s ease}.sp-ro-toast.on{opacity:1;transform:translate(-50%,0)}';
        document.head.appendChild(st);
        _roToastEl = document.createElement('div');
        _roToastEl.className = 'sp-ro-toast';
        _roToastEl.setAttribute('role', 'status');
        document.body.appendChild(_roToastEl);
      }
      _roToastEl.textContent = msg;
      _roToastEl.classList.add('on');
      clearTimeout(roToast._t);
      roToast._t = setTimeout(function () { _roToastEl.classList.remove('on'); }, 3400);
    } catch (e) { console.warn(msg); }
  }
  function limitedBlocked(act) {
    try {
      var A = window.SupremaAuth;
      if (!A || !A.isLimitedAdmin) return false;
      var r = A.recognize ? A.recognize() : null;
      if (!r || !A.isLimitedAdmin(r.email)) return false;   // não é admin limitado → não bloqueia
      if (LIMITED_ALLOW.has(act)) return false;
      // ação de escrita: bloqueia + avisa (no máx. 1 toast a cada 2,5s)
      if (Date.now() - _roToastAt > 2500) {
        _roToastAt = Date.now();
        roToast('Modo leitura — só o Admin Suprema altera dados. Você pode consultar e exportar os XLSX.');
      }
      return true;
    } catch (e) { return false; }
  }

  function run(el, ev) {
    const act = el.getAttribute('data-act');
    if (!act) return;
    if (limitedBlocked(act)) return;   // admin limitado: barra qualquer ação que não seja leitura/export
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

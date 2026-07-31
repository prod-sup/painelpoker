/* =========================================================================
   SUPREMA-XLSX — carregamento SOB DEMANDA do SheetJS (xlsx.full.min.js, 861KB).

   POR QUÊ
   -------
   Antes cada painel baixava os 861KB no load (<script defer src="xlsx...">),
   mesmo pra quem nunca exporta nem importa planilha. Agora o arquivo só é
   injetado na PRIMEIRA vez que uma exportação/importação precisa dele.

   COMO USAR
   ---------
   Nos pontos de entrada (handlers de `change` de <input file>, cliques de
   "Exportar", e listeners que recebem planilha do Firebase), faça:
       await ensureXLSX();        // garante window.XLSX carregado
   ...ANTES de tocar em qualquer `XLSX.*`. Chamadas concorrentes compartilham
   a mesma promise; se já estiver carregado, resolve na hora. Todo o caminho
   SÍNCRONO depois do await fica coberto (não precisa gatear cada XLSX.utils).

   Substitui o <script defer src="xlsx.full.min.js"> nas páginas por
   <script defer src="suprema-xlsx.js">. O arquivo xlsx.full.min.js continua
   no repositório e no cache do service worker — só deixa de baixar no boot.
========================================================================= */
(function (global) {
  'use strict';
  if (global.ensureXLSX) return;

  var SRC = 'xlsx.full.min.js';
  var pending = null;

  global.ensureXLSX = function ensureXLSX() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (pending) return pending;
    pending = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = function () {
        if (global.XLSX) resolve(global.XLSX);
        else { pending = null; reject(new Error('xlsx carregou mas XLSX não inicializou')); }
      };
      s.onerror = function () {
        pending = null;                 // permite nova tentativa no próximo uso
        global.__xlsxFail = true;       // sinal legado que a Criação Noturna já lê
        reject(new Error('falha ao carregar ' + SRC));
      };
      document.head.appendChild(s);
    });
    return pending;
  };

  /* ── Variante COM ESTILO (xlsx-js-style) — só pra EXPORTAR bonito ───────────
     O build community ignora `.s` (cor/negrito/borda somem). O xlsx-js-style é
     um SheetJS 0.18.5 + estilos. Ele reatribui window.XLSX ao carregar (tem um
     `var XLSX` no topo), então capturamos esse build em window.XLSXStyle e
     RESTAURAMOS o community pra window.XLSX — assim os IMPORTS não trocam de
     parser (evita surpresa em produção). Carrega sob demanda (425KB), como o
     community: só quem exporta baixa. */
  var STYLE_SRC = 'vendor/xlsx-js-style.min.js';
  var stylePending = null;
  global.ensureXLSXStyle = function ensureXLSXStyle() {
    if (global.XLSXStyle) return Promise.resolve(global.XLSXStyle);
    if (stylePending) return stylePending;
    stylePending = global.ensureXLSX().then(function (community) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = STYLE_SRC;
        s.async = true;
        s.onload = function () {
          var styled = global.XLSX;            // o bundle reatribuiu window.XLSX
          global.XLSXStyle = styled;
          if (community) global.XLSX = community;   // devolve o community pros imports
          if (styled && styled.utils) resolve(styled);
          else { stylePending = null; reject(new Error('xlsx-js-style carregou mas não inicializou')); }
        };
        s.onerror = function () { stylePending = null; reject(new Error('falha ao carregar ' + STYLE_SRC)); };
        document.head.appendChild(s);
      });
    });
    return stylePending;
  };
})(window);

/* ============================================================
   MODO LEVE — liga html.lite em PC/conexão fraca pra cortar os
   efeitos que mais custam GPU (backdrop-filter e animação
   contínua). O CSS do modo leve vive no suprema-tokens.css
   (bloco html.lite), que todos os painéis carregam.

   Precisa rodar CEDO: inclua como <script src="scripts/lite.js">
   SÍNCRONO no <head> (sem defer), antes do primeiro paint, pra
   não haver flash do visual pesado antes do downgrade.

   Gatilhos automáticos: pouca RAM (deviceMemory <= 4), saveData
   ligado, ou rede 2g/slow-2g — os mesmos sinais que o painel já
   usava pra decidir o vídeo de fundo, agora valendo pra todo o
   visual. Override manual (útil pra PC fixo sabidamente fraco e
   pra teste): ?lite=1 / ?lite=0 na URL (fica gravado), ou
   localStorage 'suprema_lite' = '1' | '0'.
   ============================================================ */
(function () {
  try {
    var forced = null;
    try {
      var q = new URLSearchParams(location.search);
      if (q.has('lite')) forced = q.get('lite') !== '0';
      var ls = localStorage.getItem('suprema_lite');
      if (forced === null && ls !== null) forced = ls === '1';
      // ?lite na URL vira preferência gravada — persiste entre visitas
      if (q.has('lite')) localStorage.setItem('suprema_lite', forced ? '1' : '0');
    } catch (e) {}

    var lite = forced;
    if (lite === null) {
      var c = navigator.connection || {};
      lite =
        (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
        c.saveData === true ||
        /(^|-)(2g|slow-2g)$/.test(c.effectiveType || '');
    }
    if (lite) document.documentElement.classList.add('lite');
  } catch (e) {}
})();

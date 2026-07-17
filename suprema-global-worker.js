/* =========================================================================
   SUPREMA-GLOBAL-WORKER — o parse da Global MTT fora da main thread.

   O QUE ESTAVA ERRADO: `b64ToBuf` (atob + laço byte a byte sobre centenas de
   KB) e `XLSX.read` são SÍNCRONOS e caros. Rodando na main thread:
     · no Radar, a aba congela enquanto a Global chega;
     · na Suprema TV é pior — a transmissão GAGUEJA toda vez que a operação
       sobe uma Global nova, no meio de uma cena, num telão que a sala inteira
       está olhando.

   Aqui dentro roda a cadeia inteira (base64 → ArrayBuffer → XLSX → matriz →
   parseGlobalWeek) e volta só o `{days, futures}` já pronto — um objeto
   pequeno, barato de clonar. O buildModel fica na main thread porque é rápido
   e depende dos overrides, que mudam ao vivo.

   Reaproveita os MESMOS arquivos das páginas em vez de duplicar regra: o
   gu-parser é livre de DOM de propósito, e é isso que permite importá-lo aqui.
   Se a Global mudar, muda num lugar só e o Worker acompanha junto.

   Protocolo:
     ← { id, b64, sheet }
     → { id, parsed:{days,futures} }  |  { id, error:'…' }

   Quem chama é `parseGlobalWeekAsync` (radar-core.js), que já traz o caminho
   síncrono de volta como rede de segurança.
========================================================================= */
'use strict';

importScripts('xlsx.full.min.js', 'gu-parser.js', 'radar-core.js');

self.onmessage = function (e) {
  const msg = e.data || {};
  const id = msg.id;
  try {
    const matrix = readSheetMatrix(b64ToBuf(msg.b64), msg.sheet);
    if (!matrix) throw new Error('aba "' + msg.sheet + '" não encontrada na Global');
    self.postMessage({ id: id, parsed: parseGlobalWeek(matrix) });
  } catch (err) {
    self.postMessage({ id: id, error: String((err && err.message) || err) });
  }
};

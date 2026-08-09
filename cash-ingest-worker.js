/* Web Worker do ingest — roda o parse do xlsx em segundo plano pra NÃO travar a UI.
   Recebe {file}; devolve {type:'progress',m,p} durante e {type:'done',res} no fim
   (ou {type:'error',msg}). A lógica pesada vive no cash-ingest.js (worker-safe). */
importScripts('cash-ingest.js');
self.onmessage=function(e){
  var file=e.data && e.data.file; if(!file){ self.postMessage({type:'error',msg:'sem arquivo'}); return; }
  self.CashIngest.parse(file,{onProgress:function(m,p){ self.postMessage({type:'progress',m:m,p:p}); }})
    .then(function(res){ self.postMessage({type:'done',res:res}); })
    .catch(function(err){ self.postMessage({type:'error',msg:(err&&err.message)||String(err)}); });
};

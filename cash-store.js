/* ══════════════════════════════════════════════════════════════════════════
   cash-store.js — armazenamento COMPARTILHADO do roster (todo mundo vê)
   ---------------------------------------------------------------------------
   O roster tem PII (nomes/IDs) → não pode ir pro repo público. Vai pro Firebase
   Storage (autenticado), comprimido (gzip no navegador). Um índice pequeno das
   semanas mora no RTDB. Cada dispositivo baixa a semana UMA vez e cacheia em
   IndexedDB (egress controlado). Fala com o backend só pela fachada SupremaDB —
   ao migrar pro servidor interno, troca só o suprema-db.js.

   API:
     CashStore.available()                         -> bool (SupremaDB + Storage prontos)
     CashStore.publish(roster, {onProgress})       -> Promise<weekKey>  (sobe + indexa + cacheia)
     CashStore.listWeeks()                          -> Promise<[{key,week,seats,tables,updatedAt,by}]>
     CashStore.load(weekKey, {onProgress})          -> Promise<roster>  (cache→Storage→gunzip)
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var INDEX='cashRosterIndex';           // nó pequeno no RTDB (metadados por semana)
var DIR='cash-roster/';                 // pasta no Storage
var DBN='suprema-cash', STORE='roster', IDBV=1;

function db(){ return (window.SupremaDB && SupremaDB.ready && SupremaDB.ready()) ? SupremaDB : null; }
function available(){ var d=db(); return !!(d && d.storageOk && d.storageOk()); }
function gzipOk(){ return typeof CompressionStream==='function' && typeof DecompressionStream==='function'; }
function weekKey(meta){ var w=(meta&&meta.week)||''; var k=w.replace(/[^\d]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,''); return k||('semana-'+(meta&&meta.generated||'').slice(0,10)); }

// ── IndexedDB (cache do blob gzip por semana) ───────────────────────────────
function idb(){ return new Promise(function(res,rej){ var r=indexedDB.open(DBN,IDBV);
  r.onupgradeneeded=function(){ var d=r.result; if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE); };
  r.onsuccess=function(){res(r.result);}; r.onerror=function(){rej(r.error);}; }); }
function idbGet(key){ return idb().then(function(d){ return new Promise(function(res,rej){ var t=d.transaction(STORE,'readonly').objectStore(STORE).get(key); t.onsuccess=function(){res(t.result);}; t.onerror=function(){rej(t.error);}; }); }); }
function idbSet(key,val){ return idb().then(function(d){ return new Promise(function(res,rej){ var t=d.transaction(STORE,'readwrite').objectStore(STORE).put(val,key); t.onsuccess=function(){res();}; t.onerror=function(){rej(t.error);}; }); }); }

// ── gzip / gunzip via streams (sem libs) ────────────────────────────────────
function gzip(str){ var blob=new Blob([str]); var s=blob.stream().pipeThrough(new CompressionStream('gzip')); return new Response(s).blob(); }
function gunzip(blob){ var s=blob.stream().pipeThrough(new DecompressionStream('gzip')); return new Response(s).text(); }

// ── publicar (após o ingest do xlsx) ────────────────────────────────────────
function publish(roster, opts){
  opts=opts||{}; var onP=opts.onProgress||function(){};
  var d=db(); if(!d) return Promise.reject(new Error('SupremaDB offline'));
  if(!available()) return Promise.reject(new Error('Firebase Storage indisponível (SDK/regra).'));
  if(!gzipOk()) return Promise.reject(new Error('Navegador sem CompressionStream.'));
  var key=weekKey(roster.meta), path=DIR+key+'.json.gz';
  onP('Compactando roster…',10);
  var json=JSON.stringify(roster);
  return gzip(json).then(function(blob){
    onP('Enviando '+(blob.size/1e6).toFixed(1)+' MB pro Storage…',35);
    return idbSet(key,blob).then(function(){ return d.storagePut(path, blob, {contentType:'application/gzip'}); });
  }).then(function(){
    onP('Registrando a semana…',85);
    var by=''; try{ by=(window.SupremaAuth&&SupremaAuth.getSession&&(SupremaAuth.getSession()||{}).email)||''; }catch(e){}
    return d.set(INDEX+'/'+key, { key:key, week:roster.meta.week||key, seats:roster.meta.seats||0,
      tables:roster.meta.cashTables||0, updatedAt:Date.now(), by:by });
  }).then(function(){ onP('Publicado.',100); return key; });
}

// ── listar semanas disponíveis ──────────────────────────────────────────────
function listWeeks(){ var d=db(); if(!d) return Promise.resolve([]);
  return d.getValue(INDEX).then(function(v){ if(!v) return [];
    return Object.keys(v).map(function(k){return v[k];}).sort(function(a,b){return (b.updatedAt||0)-(a.updatedAt||0);}); })
    .catch(function(){ return []; }); }

// ── carregar uma semana (cache → Storage) ───────────────────────────────────
function load(key, opts){ opts=opts||{}; var onP=opts.onProgress||function(){};
  onP('Procurando no cache…',5);
  return idbGet(key).then(function(blob){
    if(blob){ onP('Lendo do cache…',40); return blob; }
    var d=db(); if(!d||!available()) throw new Error('Semana não está no cache e o Storage está indisponível.');
    onP('Baixando do Storage…',20);
    return d.storageDownload(DIR+key+'.json.gz').then(function(b){ return idbSet(key,b).then(function(){return b;}); });
  }).then(function(blob){ onP('Descompactando…',70); return gunzip(blob); })
    .then(function(txt){ onP('Pronto.',100); return JSON.parse(txt); });
}

// ── cache LOCAL sempre (rede de segurança: sobrevive ao F5 mesmo sem Firebase) ──
var LAST='__last__';
function cacheLocal(roster){ if(!gzipOk()) return Promise.resolve(null); var key=weekKey(roster.meta);
  return gzip(JSON.stringify(roster)).then(function(blob){ return idbSet(key,blob).then(function(){ return idbSet(LAST,key).then(function(){ return key; }); }); }); }
function restoreLast(){ return idbGet(LAST).then(function(key){ if(!key) return null;
  return idbGet(key).then(function(blob){ if(!blob) return null; return gunzip(blob).then(function(t){ return JSON.parse(t); }); }); })
  .catch(function(){ return null; }); }
function listLocal(){ return idb().then(function(d){ return new Promise(function(res){ var out=[]; var os=d.transaction(STORE,'readonly').objectStore(STORE);
  var cur=os.openKeyCursor?os.openKeyCursor():os.openCursor(); cur.onsuccess=function(e){ var c=e.target.result; if(c){ if(c.key!==LAST)out.push(String(c.key)); c.continue(); } else res(out); }; cur.onerror=function(){res(out);}; }); }).catch(function(){return [];}); }

window.CashStore={ available:available, gzipOk:gzipOk, publish:publish, listWeeks:listWeeks, load:load, weekKey:weekKey,
  cacheLocal:cacheLocal, restoreLast:restoreLast, listLocal:listLocal, loadLocal:function(key){ return idbGet(key).then(function(b){ if(!b)throw new Error('não está no cache'); return gunzip(b).then(function(t){return JSON.parse(t);}); }); } };
})();

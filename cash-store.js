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
var INDEX='cashRosterIndex';           // nó pequeno no RTDB (metadados + digest escalar por semana)
var DIR='cash-roster/';                 // pasta no Storage
var DBN='suprema-cash', STORE='roster', IDBV=1;
var DIGEST_PREFIX='digest:';           // prefixo da chave do digest no IndexedDB (mesmo store)

function db(){ if(!window.SupremaDB) return null; try{ SupremaDB.init(); }catch(e){} return (SupremaDB.ready&&SupremaDB.ready())?SupremaDB:null; }
function authUser(){ try{ return !!(window.firebase&&firebase.auth&&firebase.auth().currentUser); }catch(e){ return false; } }
// exige o usuário REAL do Firebase (o mesmo que já autoriza o RTDB). NÃO faz login
// anônimo de propósito — isso enfraqueceria a regra `auth != null` do Storage (PII).
// Espera o auth RESTAURAR (é assíncrono) antes de desistir.
function ensureAuth(){
  return new Promise(function(resolve,reject){
    if(!(window.firebase&&firebase.auth)){ reject(new Error('SDK de auth ausente')); return; }
    var a=firebase.auth(); if(a.currentUser){ resolve(a.currentUser); return; }
    var done=false, off=null;
    var to=setTimeout(function(){ if(done)return; done=true; if(off)off(); reject(new Error('sem usuário do Firebase — faça login pelo hub e recarregue')); }, 8000);
    try{ off=a.onAuthStateChanged(function(u){ if(done)return; if(u){ done=true; clearTimeout(to); if(off)off(); resolve(u); } }); }
    catch(e){ clearTimeout(to); reject(e); }
  });
}
function authEmail(){ try{ var u=firebase.auth().currentUser; return u?(u.email||u.uid):null; }catch(e){ return null; } }
function available(){ var d=db(); return !!(d && d.storageOk && d.storageOk()); }
// explica POR QUE não dá pra compartilhar (mostrado no status)
function reason(){ if(!window.SupremaDB)return 'módulo SupremaDB ausente'; try{SupremaDB.init();}catch(e){}
  if(!(SupremaDB.ready&&SupremaDB.ready()))return 'Firebase não conectado';
  if(!SupremaDB.storageOk())return 'SDK do Storage não carregado — republique o dashboard-mesa-cash.html';
  return 'ok'; }
function gzipOk(){ return typeof CompressionStream==='function' && typeof DecompressionStream==='function'; }
function weekKey(meta){ var w=(meta&&meta.week)||''; var k=w.replace(/[^\d]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,''); return k||('semana-'+(meta&&meta.generated||'').slice(0,10)); }

// ── DIGEST por semana (o que resolve a escala) ──────────────────────────────
// O roster completo (nomes + todas as mesas) é pesado e cresce sem parar. As
// Tendências/Retenção NÃO precisam dele: precisam só de métricas escalares + o
// conjunto de IDs que jogaram (e quais perderam = "fish"). Esse digest é ~100×
// menor que o roster e não carrega PII de nome. Fica: escalares no índice RTDB
// (baixados de graça no listWeeks) e IDs num arquivo .digest.json.gz pequeno.
function vals(o){ o=o||{}; return Object.keys(o).map(function(k){return o[k];}); }
function buildDigest(roster){
  var T=vals(roster&&roster.tables), fee=0,buyin=0,seats=0,hands=0, net={};
  for(var i=0;i<T.length;i++){ var t=T[i]; fee+=t.fee||0; buyin+=t.buyin||0; hands+=t.hands||0;
    var ro=t.roster||[]; for(var j=0;j<ro.length;j++){ var s=ro[j]; seats++; var id=+s.id; net[id]=(net[id]||0)+(s.w||0); } }
  var ids=Object.keys(net).map(Number), winners=0,losers=0,netTot=0, fish=[];
  for(var k=0;k<ids.length;k++){ var v=net[ids[k]]; netTot+=v; if(v>0.001)winners++; else if(v<-0.001){losers++; fish.push(ids[k]);} }
  var meta=(roster&&roster.meta)||{};
  return { key:weekKey(meta), week:meta.week||weekKey(meta), rake:fee, buyin:buyin, seats:seats, hands:hands,
    tables:T.length, players:ids.length, winners:winners, losers:losers, netTot:netTot,
    takeRate:buyin?fee/buyin*100:0, ids:ids, fish:fish };
}
// registro do índice RTDB: SÓ escalares (sem ids/fish — esses vão pro arquivo digest)
function indexRecord(key, roster, digest, by){
  var m=(roster&&roster.meta)||{};
  return { key:key, week:m.week||key, seats:m.seats||0, tables:m.cashTables||0, updatedAt:Date.now(), by:by,
    rake:Math.round(digest.rake), buyin:Math.round(digest.buyin), hands:digest.hands,
    players:digest.players, winners:digest.winners, losers:digest.losers,
    netTot:Math.round(digest.netTot), takeRate:+digest.takeRate.toFixed(3) };
}

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
  var key=weekKey(roster.meta), path=DIR+key+'.json.gz', dpath=DIR+key+'.digest.json.gz';
  var digest=buildDigest(roster);
  onP('Autenticando…',5);
  var json=JSON.stringify(roster);
  return ensureAuth().then(function(){ onP('Compactando roster…',10); return gzip(json); }).then(function(blob){
    onP('Enviando '+(blob.size/1e6).toFixed(1)+' MB pro Storage…',30);
    return idbSet(key,blob).then(function(){ return d.storagePut(path, blob, {contentType:'application/gzip'}); })
      .catch(function(e){ throw new Error('Storage negou o upload ('+((e&&e.code)||(e&&e.message)||e)+') — verifique as regras do Storage'); });
  }).then(function(){
    // digest pequeno (métricas + ids/fish p/ retenção) — Tendências lê ISSO, não o roster inteiro.
    // Não é crítico: se falhar, o índice ainda tem os escalares p/ os gráficos.
    onP('Enviando resumo da semana…',70);
    return gzip(JSON.stringify(digest)).then(function(dblob){
      return idbSet(DIGEST_PREFIX+key,dblob).then(function(){ return d.storagePut(dpath, dblob, {contentType:'application/gzip'}); });
    }).catch(function(e){ console.warn('digest upload falhou (não crítico)',e); });
  }).then(function(){
    onP('Registrando a semana…',88);
    var by=''; try{ by=(window.SupremaAuth&&SupremaAuth.getSession&&(SupremaAuth.getSession()||{}).email)||''; }catch(e){}
    return d.set(INDEX+'/'+key, indexRecord(key, roster, digest, by))
      .catch(function(e){ throw new Error('índice RTDB negou ('+((e&&e.message)||e)+') — publique a regra cashRosterIndex no RTDB'); });
  }).then(function(){ onP('Publicado.',100); return key; })
  .catch(function(err){ var u=authEmail(); throw new Error(((err&&err.message)||String(err))+(u?' [logado: '+u+']':' [SEM login Firebase]')); });
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
    return ensureAuth().then(function(){ return d.storageDownload(DIR+key+'.json.gz'); }).then(function(b){ return idbSet(key,b).then(function(){return b;}); });
  }).then(function(blob){ onP('Descompactando…',70); return gunzip(blob); })
    .then(function(txt){ onP('Pronto.',100); return JSON.parse(txt); });
}

// ── carregar só o DIGEST de uma semana (leve — p/ Tendências/Retenção) ──────
// cache-first; ~100× menor que o roster. Se não existir (semana antiga, sem
// digest publicado), rejeita — o chamador degrada sem retenção pra essa semana.
function loadDigest(key){
  return idbGet(DIGEST_PREFIX+key).then(function(blob){
    if(blob) return blob;
    var d=db(); if(!d||!available()) throw new Error('digest indisponível (offline)');
    return ensureAuth().then(function(){ return d.storageDownload(DIR+key+'.digest.json.gz'); })
      .then(function(b){ return idbSet(DIGEST_PREFIX+key,b).then(function(){ return b; }); });
  }).then(function(blob){ return gunzip(blob); }).then(function(txt){ return JSON.parse(txt); });
}

// ── cache LOCAL sempre (rede de segurança: sobrevive ao F5 mesmo sem Firebase) ──
var LAST='__last__';
function cacheLocal(roster){ if(!gzipOk()) return Promise.resolve(null); var key=weekKey(roster.meta);
  // guarda o roster completo E o digest leve (retenção offline sem reabrir o blob)
  return gzip(JSON.stringify(roster)).then(function(blob){ return idbSet(key,blob); })
    .then(function(){ return gzip(JSON.stringify(buildDigest(roster))).then(function(db){ return idbSet(DIGEST_PREFIX+key,db); }).catch(function(){}); })
    .then(function(){ return idbSet(LAST,key).then(function(){ return key; }); }); }
function restoreLast(){ return idbGet(LAST).then(function(key){ if(!key) return null;
  return idbGet(key).then(function(blob){ if(!blob) return null; return gunzip(blob).then(function(t){ return JSON.parse(t); }); }); })
  .catch(function(){ return null; }); }
function listLocal(){ return idb().then(function(d){ return new Promise(function(res){ var out=[]; var os=d.transaction(STORE,'readonly').objectStore(STORE);
  var cur=os.openKeyCursor?os.openKeyCursor():os.openCursor(); cur.onsuccess=function(e){ var c=e.target.result; if(c){ if(c.key!==LAST)out.push(String(c.key)); c.continue(); } else res(out); }; cur.onerror=function(){res(out);}; }); }).catch(function(){return [];}); }

window.CashStore={ available:available, reason:reason, gzipOk:gzipOk, publish:publish, listWeeks:listWeeks, load:load, weekKey:weekKey,
  buildDigest:buildDigest, loadDigest:loadDigest,
  cacheLocal:cacheLocal, restoreLast:restoreLast, listLocal:listLocal, loadLocal:function(key){ return idbGet(key).then(function(b){ if(!b)throw new Error('não está no cache'); return gunzip(b).then(function(t){return JSON.parse(t);}); }); } };
})();

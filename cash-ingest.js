/* ══════════════════════════════════════════════════════════════════════════
   cash-ingest.js — leitor de streaming do xlsx NO NAVEGADOR (sem SheetJS)
   ---------------------------------------------------------------------------
   O relatório Suprema tem a aba "Grand Union Game Detail" com 1,27 GB — o
   SheetJS não abre isso no navegador. Aqui a gente lê o .xlsx como um zip,
   acha só as abas que interessa e descomprime EM STREAMING (DecompressionStream
   'deflate-raw'), parseando linha a linha sem segurar o arquivo todo na memória.
   Porta client-side do tools/build-roster.js.

   API:
     CashIngest.supported()  -> bool (DecompressionStream disponível)
     CashIngest.parse(file, {onProgress}) -> Promise<{ roster, gameStats }>
       roster    = { meta, tables:{ gameId:{...resumo..., roster:[{n,id,ag,club,bi,w,fee,h,rk}] } } }
       gameStats = linhas cruas da Game Statistics (p/ a pipeline de agregados/rake)
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var CASH_EXCLUDE=/^(SNG|MTT|TLT)/i;
function isCash(t){ t=String(t||'').trim(); return t && !CASH_EXCLUDE.test(t) && t.toUpperCase()!=='RODEO'; }

function supported(){ return typeof DecompressionStream==='function'; }

// ── leitura de blobs ────────────────────────────────────────────────────────
function readBytes(blob){ return blob.arrayBuffer().then(function(b){return new Uint8Array(b);}); }
function u16(dv,o){ return dv.getUint16(o,true); }
function u32(dv,o){ return dv.getUint32(o,true); }

// End Of Central Directory → offset/size do diretório central
function findEOCD(file){
  var tail=Math.min(file.size, 66000);
  return readBytes(file.slice(file.size-tail)).then(function(buf){
    var dv=new DataView(buf.buffer);
    for(var i=buf.length-22;i>=0;i--){
      if(dv.getUint32(i,true)===0x06054b50){
        var cdSize=u32(dv,i+12), cdOff=u32(dv,i+16), entries=u16(dv,i+10);
        // ZIP64? offsets 0xFFFFFFFF indicam que precisaria do EOCD64 (não esperado aqui, <4GB)
        return {cdOff:cdOff,cdSize:cdSize,entries:entries};
      }
    }
    throw new Error('EOCD não encontrado — arquivo não parece um .xlsx válido.');
  });
}
// diretório central → mapa nome->entrada
function readCentralDir(file){
  return findEOCD(file).then(function(e){
    return readBytes(file.slice(e.cdOff, e.cdOff+e.cdSize)).then(function(buf){
      var dv=new DataView(buf.buffer), o=0, map={};
      while(o+46<=buf.length && dv.getUint32(o,true)===0x02014b50){
        var method=u16(dv,o+10), compSize=u32(dv,o+20), nameLen=u16(dv,o+28), extraLen=u16(dv,o+30), commLen=u16(dv,o+32), lho=u32(dv,o+42);
        var name=new TextDecoder().decode(buf.subarray(o+46,o+46+nameLen));
        map[name]={method:method,compSize:compSize,lho:lho};
        o+=46+nameLen+extraLen+commLen;
      }
      return {file:file,map:map};
    });
  });
}
// blob dos bytes comprimidos de uma entrada (lê o local header p/ achar o início dos dados)
function entryBlob(zip, name){
  var e=zip.map[name]; if(!e) return Promise.reject(new Error('entrada não encontrada no xlsx: '+name));
  return readBytes(zip.file.slice(e.lho, e.lho+30)).then(function(buf){
    var dv=new DataView(buf.buffer);
    var nameLen=u16(dv,26), extraLen=u16(dv,28);
    var dataStart=e.lho+30+nameLen+extraLen;
    return {blob:zip.file.slice(dataStart, dataStart+e.compSize), method:e.method};
  });
}
// inflar entrada inteira -> string (p/ workbook, sharedStrings, sheets pequenas)
function inflateToString(zip, name){
  return entryBlob(zip,name).then(function(x){
    if(x.method===0) return x.blob.text();
    var s=x.blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    var reader=s.getReader(), dec=new TextDecoder('utf-8'), out='';
    return (function pump(){ return reader.read().then(function(r){ if(r.done){ out+=dec.decode(); return out; } out+=dec.decode(r.value,{stream:true}); return pump(); }); })();
  });
}
// inflar entrada em STREAMING -> onLine chamado por linha <row>...</row> (p/ a Game Detail gigante)
function inflateRows(zip, name, onRow, onBytes){
  return entryBlob(zip,name).then(function(x){
    var stream = x.method===0 ? x.blob.stream() : x.blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    var reader=stream.getReader(), dec=new TextDecoder('utf-8'), buf='', bytes=0;
    return (function pump(){ return reader.read().then(function(r){
      if(r.done){ return; }
      bytes+=r.value.length; if(onBytes)onBytes(bytes);
      buf+=dec.decode(r.value,{stream:true});
      var idx;
      while((idx=buf.indexOf('</row>'))>=0){ var row=buf.slice(0,idx+6); buf=buf.slice(idx+6); onRow(row); }
      return pump();
    }); })();
  });
}

// ── parsing de células (mesma lógica do build-roster.js) ───────────────────
function ci(ref){ var s=ref.replace(/\d+/g,''), n=0; for(var i=0;i<s.length;i++)n=n*26+(s.charCodeAt(i)-64); return n-1; }
function loadSharedStrings(str){
  var ss=[], re=/<si>([\s\S]*?)<\/si>/g, m;
  while((m=re.exec(str))){ ss.push(m[1].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")); }
  return ss;
}
function parseCells(inner, ss){
  var cells={}, cre=/<c r="([A-Z]+)\d+"(?:[^>]*?(t="s"))?[^>]*>(?:<v>([^<]*)<\/v>)?/g, cm;
  while((cm=cre.exec(inner))){ if(cm[3]===undefined)continue; var i=ci(cm[1]); cells[i]=cm[2]?ss[+cm[3]]:+cm[3]; }
  return cells;
}
function firstCell(inner, ss){
  var m=inner.match(/<c r="A\d+"(?:[^>]*?(t="s"))?[^>]*>(?:<v>([^<]*)<\/v>)?/);
  if(!m||m[2]===undefined) return undefined;
  return m[1]?ss[+m[2]]:+m[2];
}

// mapeia nomes de aba -> arquivo sheetN.xml
function sheetFiles(zip){
  return Promise.all([inflateToString(zip,'xl/workbook.xml'), inflateToString(zip,'xl/_rels/workbook.xml.rels')]).then(function(a){
    var wb=a[0], rels=a[1], name2rid={}, rid2file={}, m;
    var re1=/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g; while((m=re1.exec(wb)))name2rid[m[1]]=m[2];
    var re2=/Id="([^"]+)"[^>]*Target="(worksheets\/sheet\d+\.xml)"/g; while((m=re2.exec(rels)))rid2file[m[1]]='xl/'+m[2];
    return {of:function(n){return rid2file[name2rid[n]];}, wb:wb};
  });
}

// ══════════════════════════════ PARSE PRINCIPAL ════════════════════════════
function parse(file, opts){
  opts=opts||{}; var onP=opts.onProgress||function(){};
  if(!supported()) return Promise.reject(new Error('Seu navegador não suporta DecompressionStream. Use Chrome/Edge atualizado.'));
  var zip, sf, ss, GAMEDET='Grand Union Game Detail', GAMESTAT='Grand Union Game Statistics';
  onP('Abrindo planilha…',2);
  return readCentralDir(file).then(function(z){ zip=z; return sheetFiles(zip); }).then(function(s){
    sf=s;
    if(!sf.of(GAMESTAT)) throw new Error('Aba "'+GAMESTAT+'" não encontrada. É o relatório certo?');
    onP('Lendo textos compartilhados…',6);
    return inflateToString(zip,'xl/sharedStrings.xml');
  }).then(function(sstr){
    ss=loadSharedStrings(sstr); onP('Lendo mesas (Game Statistics)…',12);
    return inflateToString(zip, sf.of(GAMESTAT));
  }).then(function(gsXml){
    // ── Game Statistics: resumo por Game ID (só cash) + linhas cruas p/ pipeline ──
    var tables={}, cashIds={}, gameStats=[], re=/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, m;
    while((m=re.exec(gsXml))){
      if(m[1]==='1')continue;
      var c=parseCells(m[2],ss); var gt=c[7]; if(gt===undefined)continue;
      // linha crua p/ a pipeline existente (nomes de coluna que ela espera)
      gameStats.push({
        'Game ID':c[4],'Game Name':c[5],'Creator Name':c[6],'Game Type':c[7],
        'Start Time':c[8],'End Time':c[9],'Duration':c[10],'Fee Rate':c[11],'Fee':c[12],
        'Admin Fee Rate':c[13],'Admin Fee':c[14],'Total Buyin':c[15],'Players':c[16],'Hands':c[17],
        'Buy-in Min(GU)':c[20],'Buy-in Max(GU)':c[21],'Small Blind(GU)':c[22],'Big Blind(GU)':c[23],'Ante(GU)':c[24],
        'Jackpot Fee(GU)':c[31],'Jackpot Payout(GU)':c[32]
      });
      if(!isCash(gt))continue;
      var id=String(c[4]); cashIds[id]=1;
      tables[id]={id:+id,name:c[5]||'',creator:c[6]||'',type:gt,start:c[8]||'',end:c[9]||'',dur:c[10]||'',
        feeRate:+c[11]||0,fee:+c[12]||0,buyin:+c[15]||0,players:+c[16]||0,hands:+c[17]||0,
        bMin:+c[20]||0,bMax:+c[21]||0,sb:+c[22]||0,bb:+c[23]||0,ante:+c[24]||0,jp:+c[31]||0,roster:[]};
    }
    onP('Lendo jogadores (Game Detail — arquivo grande)…',20);
    // ── Game Detail em streaming: roster por mesa cash ──
    var detName=sf.of(GAMEDET);
    if(!detName){ // sem Game Detail → só resumo (sem roster)
      return finalize(tables, gameStats, sf.wb, 0);
    }
    var det=zip.map[detName], totalComp=det?det.compSize:0;
    var curId=null, skip=true, seats=0, lastPct=20;
    return inflateRows(zip, detName, function(row){
      var mm=row.match(/<row[^>]*>([\s\S]*)<\/row>/); if(!mm)return; var inner=mm[1];
      var a0=firstCell(inner,ss);
      if(typeof a0==='string' && a0.indexOf('Game Name:')>=0){
        var head=a0.split(/\s+Creator:/)[0]; var ids=head.match(/\((\d+)\)/g);
        curId = ids&&ids.length ? ids[ids.length-1].replace(/[()]/g,'') : null;
        skip = !(curId && cashIds[curId]); return;
      }
      if(skip||!curId) return;
      if(typeof a0!=='number') return;
      var c=parseCells(inner,ss); if(typeof c[5]!=='number')return;
      var t=tables[curId]; if(!t)return;
      t.roster.push({n:c[4]||'',id:c[5],ag:c[7]||'',club:c[3]||'',bi:+c[10]||0,w:+c[11]||0,fee:+c[12]||0,h:+c[14]||0,rk:+c[29]||0});
      seats++;
    }, function(bytes){
      if(totalComp){ var p=20+Math.min(74, Math.round(bytes/totalComp*74)); if(p>lastPct){lastPct=p; onP('Lendo jogadores… '+(bytes/1e6|0)+' MB',p);} }
    }).then(function(){ return finalize(tables, gameStats, sf.wb, seats); });
  });
}
function finalize(tables, gameStats, wb, seats){
  var withR=0, n=0; for(var id in tables){ n++; if(tables[id].roster.length){ withR++; tables[id].roster.sort(function(a,b){return (b.w||0)-(a.w||0);}); } }
  var wkm=(wb.match(/Range: ([\d-]+ [\d:]+) to ([\d-]+ [\d:]+)/)||[]);
  var week = wkm.length ? (wkm[1].slice(0,10)+'…'+wkm[2].slice(0,10)) : '';
  var meta={ week:week, generated:new Date().toISOString(), cashTables:n, tablesWithRoster:withR, seats:seats };
  return { roster:{meta:meta, tables:tables}, gameStats:gameStats };
}

// funciona tanto na thread principal (window) quanto dentro de um Web Worker (self)
var G=(typeof self!=='undefined')?self:window;
G.CashIngest={ supported:supported, parse:parse,
  // exposto p/ teste isolado
  _readCentralDir:readCentralDir, _inflateToString:inflateToString, _sheetFiles:sheetFiles, _loadSS:loadSharedStrings };
})();

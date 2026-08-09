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

// Start/End Time no relatório vêm como SERIAL de data do Excel (número) — não como
// texto. Converte pra ISO "AAAA-MM-DD HH:MM" (mesma matemática do toDate do
// dashboard, hora LOCAL p/ bater com as datas do pipeline diário). Sem isso o
// período da semana (min/max start) não era reconhecido e caía no fallback com a
// data de geração ("semana-<hoje>"). Também conserta o start exibido no drawer/perfil.
function pad2(n){ n=String(n); return n.length<2?('0'+n):n; }
function toISO(v){
  var d=null;
  if(typeof v==='number'){ d=new Date(Math.round((v-25569)*86400*1000)); }
  else { var s=String(v==null?'':v).trim(); if(!s)return ''; var t=new Date(s.replace(' ','T')); if(!isNaN(t)) d=t; else return s; }
  if(!d||isNaN(d))return '';
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes());
}

// ── SCHEMA DAS COLUNAS (fonte única) ────────────────────────────────────────
// Índices 0-based das abas do relatório Grand Union. Antes espalhados como c[4],
// c[5]… em 3 lugares — se a Suprema mudar o layout, ajustar AQUI (e espelhar em
// tools/build-roster.js). SCHEMA_VERSION vai no meta do roster p/ detectar formato
// antigo numa migração futura.
var SCHEMA_VERSION=1;
var GS={ id:4,name:5,creator:6,type:7,start:8,end:9,dur:10,feeRate:11,fee:12,
  adminFeeRate:13,adminFee:14,buyin:15,players:16,hands:17,
  bMin:20,bMax:21,sb:22,bb:23,ante:24,jpFee:31,jpPayout:32 };
var GD={ club:3,name:4,id:5,agent:7,buyin:10,win:11,fee:12,hands:14,rank:29 };

// IMPORT AUTO-ADAPTÁVEL: em vez de confiar cegamente na POSIÇÃO, resolve cada
// coluna pelo NOME no cabeçalho (linha 1) e cai na posição fixa só se o nome não
// existir. Se o relatório reordenar colunas mantendo os nomes, o import se conserta
// sozinho; se uma coluna CRÍTICA sumir pelo nome, vira erro (identificação garantida).
var GS_NAMES={ id:'Game ID', name:'Game Name', creator:'Creator Name', type:'Game Type',
  start:'Start Time', end:'End Time', dur:'Duration', feeRate:'Fee Rate', fee:'Fee',
  adminFeeRate:'Admin Fee Rate', adminFee:'Admin Fee', buyin:'Total Buyin', players:'Players', hands:'Hands',
  bMin:'Buy-in Min(GU)', bMax:'Buy-in Max(GU)', sb:'Small Blind(GU)', bb:'Big Blind(GU)', ante:'Ante(GU)',
  jpFee:'Jackpot Fee(GU)', jpPayout:'Jackpot Payout(GU)' };
var GS_CRITICAL={ type:1, start:1, fee:1, buyin:1, players:1, hands:1 }; // nomes 100% confirmados
function resolveCols(header){
  var byName={}; if(header) for(var k in header){ var nm=String(header[k]).trim().toLowerCase(); if(nm && byName[nm]==null) byName[nm]=+k; }
  var cols={}, issues=[];
  for(var f in GS){ var want=GS_NAMES[f];
    var got = want!=null ? byName[String(want).toLowerCase()] : null;
    if(got!=null){ cols[f]=got; }
    else { cols[f]=GS[f];   // fallback: posição fixa
      if(GS_CRITICAL[f] && header) issues.push({sev:'error', msg:'Coluna "'+want+'" não foi encontrada pelo nome no cabeçalho — usando a posição fixa '+(GS[f]+1)+'. O layout do relatório pode ter mudado; confira os valores.'});
    }
  }
  return { cols:cols, issues:issues };
}
// mantido p/ teste isolado (retorna só as issues)
function validateHeader(h){ return resolveCols(h).issues; }

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
    var tables={}, cashIds={}, gameStats=[], header=null, re=/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, m;
    var rr0=resolveCols(null), col=rr0.cols, headerIssues=rr0.issues;   // defaults = posição fixa
    while((m=re.exec(gsXml))){
      if(m[1]==='1'){ header=parseCells(m[2],ss); var rr=resolveCols(header); col=rr.cols; headerIssues=rr.issues; continue; }
      var c=parseCells(m[2],ss); var gt=c[col.type]; if(gt===undefined)continue;
      // linha crua p/ a pipeline existente (nomes de coluna que ela espera)
      gameStats.push({
        'Game ID':c[col.id],'Game Name':c[col.name],'Creator Name':c[col.creator],'Game Type':c[col.type],
        'Start Time':c[col.start],'End Time':c[col.end],'Duration':c[col.dur],'Fee Rate':c[col.feeRate],'Fee':c[col.fee],
        'Admin Fee Rate':c[col.adminFeeRate],'Admin Fee':c[col.adminFee],'Total Buyin':c[col.buyin],'Players':c[col.players],'Hands':c[col.hands],
        'Buy-in Min(GU)':c[col.bMin],'Buy-in Max(GU)':c[col.bMax],'Small Blind(GU)':c[col.sb],'Big Blind(GU)':c[col.bb],'Ante(GU)':c[col.ante],
        'Jackpot Fee(GU)':c[col.jpFee],'Jackpot Payout(GU)':c[col.jpPayout]
      });
      if(!isCash(gt))continue;
      var id=String(c[col.id]); cashIds[id]=1;
      tables[id]={id:+id,name:c[col.name]||'',creator:c[col.creator]||'',type:gt,start:toISO(c[col.start]),end:toISO(c[col.end]),dur:c[col.dur]||'',
        feeRate:+c[col.feeRate]||0,fee:+c[col.fee]||0,buyin:+c[col.buyin]||0,players:+c[col.players]||0,hands:+c[col.hands]||0,
        bMin:+c[col.bMin]||0,bMax:+c[col.bMax]||0,sb:+c[col.sb]||0,bb:+c[col.bb]||0,ante:+c[col.ante]||0,jp:+c[col.jpFee]||0,roster:[]};
    }
    onP('Lendo jogadores (Game Detail — arquivo grande)…',20);
    // ── Game Detail em streaming: roster por mesa cash ──
    var detName=sf.of(GAMEDET);
    if(!detName){ // sem Game Detail → só resumo (sem roster)
      return finalize(tables, gameStats, sf.wb, 0, headerIssues);
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
      var c=parseCells(inner,ss); if(typeof c[GD.id]!=='number')return;
      var t=tables[curId]; if(!t)return;
      t.roster.push({n:c[GD.name]||'',id:c[GD.id],ag:c[GD.agent]||'',club:c[GD.club]||'',bi:+c[GD.buyin]||0,w:+c[GD.win]||0,fee:+c[GD.fee]||0,h:+c[GD.hands]||0,rk:+c[GD.rank]||0});
      seats++;
    }, function(bytes){
      if(totalComp){ var p=20+Math.min(74, Math.round(bytes/totalComp*74)); if(p>lastPct){lastPct=p; onP('Lendo jogadores… '+(bytes/1e6|0)+' MB',p);} }
    }).then(function(){ return finalize(tables, gameStats, sf.wb, seats, headerIssues); });
  });
}
function finalize(tables, gameStats, wb, seats, headerIssues){
  var withR=0, n=0, minD=null, maxD=null;
  // acumuladores da validação de consistência (roster × resumo das mesas)
  var aggFeeT=0,aggFeeR=0,aggJp=0,aggWin=0,aggPlayersT=0,aggSeats=0,badFeeTables=0,dupIds=0,seen={};
  for(var id in tables){ n++; var t=tables[id];
    if(seen[t.id])dupIds++; else seen[t.id]=1;
    if(t.roster.length){ withR++; t.roster.sort(function(a,b){return (b.w||0)-(a.w||0);});
      var sf=0,sw=0; for(var i=0;i<t.roster.length;i++){ sf+=t.roster[i].fee||0; sw+=t.roster[i].w||0; }
      aggFeeT+=t.fee||0; aggFeeR+=sf; aggJp+=t.jp||0; aggWin+=sw; aggPlayersT+=t.players||0; aggSeats+=t.roster.length;
      if((t.fee||0)>0 && Math.abs(sf-(t.fee||0))/(t.fee||1) > 0.02) badFeeTables++;
    }
    var s=String(t.start||'').trim().slice(0,10); if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ if(!minD||s<minD)minD=s; if(!maxD||s>maxD)maxD=s; }
  }
  // período REAL dos dados (menor/maior data de início das mesas) — exato, sem depender do cabeçalho
  var week = (minD&&maxD) ? (minD+'…'+maxD) : '';

  // ── VALIDAÇÃO (precisão + consistência) — o que garante que as visões formam certo ──
  // Header issues são de IDENTIFICAÇÃO (coluna certa). As checagens abaixo são
  // OBJETIVAS (não dependem de nome): usam invariantes que o próprio dashboard
  // assume — Σfee(roster)=fee(mesa) e Σresultado ≈ −(rake+jackpot).
  var issues=(headerIssues||[]).slice();
  if(n>0 && withR===0) issues.push({sev:'error', msg:n+' mesas cash lidas, mas 0 com jogadores — o parse do Game Detail quebrou. Telas de jogador/ecologia ficam vazias.'});
  if(!week) issues.push({sev:'error', msg:'Nenhuma data de início válida — as visões diárias não podem ser formadas.'});
  if(dupIds>0) issues.push({sev:'warn', msg:dupIds+' Game ID(s) duplicado(s) no relatório — risco de contagem dobrada.'});
  if(withR>0){
    var feeDev=aggFeeT>0?Math.abs(aggFeeR-aggFeeT)/aggFeeT:0;
    if(feeDev>0.01) issues.push({sev:'warn', msg:'Soma do fee por jogador diverge '+(feeDev*100).toFixed(1)+'% do fee das mesas — a coluna Fee do Game Detail pode estar deslocada.'});
    var winExp=-(aggFeeT+aggJp), winDev=Math.abs(aggWin-winExp)/Math.max(Math.abs(winExp),1);
    if(winDev>0.03) issues.push({sev:'warn', msg:'Soma dos resultados dos jogadores não bate com −(rake+jackpot) — desvio '+(winDev*100).toFixed(1)+'%. Resultados/ecologia podem sair inconsistentes.'});
    var plDev=aggPlayersT>0?Math.abs(aggSeats-aggPlayersT)/aggPlayersT:0;
    if(plDev>0.03) issues.push({sev:'warn', msg:'Contagem de jogadores do roster diverge '+(plDev*100).toFixed(1)+'% do resumo das mesas.'});
    if(badFeeTables>0) issues.push({sev:'warn', msg:badFeeTables+' mesa(s) com fee do roster ≠ fee do resumo (>2%).'});
  }
  var hasErr=issues.some(function(x){return x.sev==='error';});
  var validation={ level: hasErr?'error':(issues.length?'warn':'ok'), issues:issues,
    stats:{ cashTables:n, tablesWithRoster:withR, feeSummary:Math.round(aggFeeT), feeRoster:Math.round(aggFeeR),
      winSum:Math.round(aggWin), winExpected:Math.round(-(aggFeeT+aggJp)), seats:aggSeats, playersSummary:aggPlayersT } };

  // rosterEmpty = achou mesas cash mas NENHUMA casou com o Game Detail (formato
  // do título mudou) — mantido como flag separada p/ o gate de publicação.
  var meta={ week:week, generated:new Date().toISOString(), schemaVersion:SCHEMA_VERSION,
    cashTables:n, tablesWithRoster:withR, seats:seats, rosterEmpty:(n>0 && withR===0), validation:validation };
  return { roster:{meta:meta, tables:tables}, gameStats:gameStats };
}

// funciona tanto na thread principal (window) quanto dentro de um Web Worker (self)
var G=(typeof self!=='undefined')?self:window;
G.CashIngest={ supported:supported, parse:parse,
  // exposto p/ teste isolado
  _readCentralDir:readCentralDir, _inflateToString:inflateToString, _sheetFiles:sheetFiles, _loadSS:loadSharedStrings,
  _finalize:finalize, _validateHeader:validateHeader, _resolveCols:resolveCols, _toISO:toISO };
})();

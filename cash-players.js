/* ══════════════════════════════════════════════════════════════════════════
   cash-players.js — Explorador de Mesas · Perfil de Jogador · Ecologia
   ---------------------------------------------------------------------------
   Consome o "roster" (índice por Game ID gerado do relatório Grand Union Game
   Detail pelo pré-processador tools/build-roster.js). Cada mesa cash traz o
   resumo + a lista EXATA de quem jogou (buyin, resultado, fee, mãos, clube).
   PII (nomes/IDs de jogador) NUNCA vai pro repo público: o arquivo é carregado
   do Firebase Storage (autenticado) e cacheado em IndexedDB, ou de arquivo local.
   Valores da planilha são GU (moeda virtual) → exibidos em BRL (× GU_TO_BRL).
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

var GU_TO_BRL = (window.GU_TO_BRL!=null?+window.GU_TO_BRL:5);   // régua única (definida no dashboard-mesa-cash.js)
var CASH_EXCLUDE = /^(SNG|MTT|TLT)/i;

// ── estado ────────────────────────────────────────────────────────────────
var R = null;                    // { meta, tables:{ id:{...,roster:[...]} } }
var TABLES = [];                 // Object.values(R.tables) achatado p/ listagem
var PLAYERS = null;              // Map id -> agregado do jogador
var AGENTS = null, CLUBS = null; // Map nome -> agregado
var ECO = null;                  // sumário da ecologia

// ── helpers ─────────────────────────────────────────────────────────────────
function brl(v, d){ v=(+v||0)*GU_TO_BRL; return v.toLocaleString('pt-BR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0}); }
function br(v, d){ d=d==null?0:d; return (+v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fk(v){ v=(+v||0)*GU_TO_BRL; return Math.abs(v)>=1e6?br(v/1e6,1)+' mi':Math.abs(v)>=1e3?br(v/1e3,1)+' mil':br(Math.round(v)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function el(id){ return document.getElementById(id); }
function pct(a,b){ return b?(a/b*100):0; }
// ── IDENTIDADE (chave única e estável) ──────────────────────────────────────
// pid: ID do jogador SEMPRE no mesmo tipo (número quando numérico). Antes o mesmo
// jogador podia rachar em dois agregados (string x number) e o perfil não abria.
function pid(x){ var n=+x; return Number.isFinite(n)&&String(x).trim()!==''?n:String(x==null?'':x).trim(); }
// nome de exibição normalizado (trim + espaços colapsados) e chave case-insensitive.
// Agente/clube não têm ID na planilha → "Golden " e "golden" viravam entradas
// diferentes; agora fundem pela chave e mostram o 1º nome visto.
function nname(x){ return String(x==null?'':x).trim().replace(/\s+/g,' '); }
function nkey(x){ return nname(x).toUpperCase(); }
// OVERRIDES de fusão manual (agente/clube não têm ID na planilha). Mapa
// chave(upper) → nome canônico. Persistido no navegador (localStorage). Brian
// funde "Golden HU"/"GoldenHU" numa entrada só. resolveName aplica na agregação.
var OVERRIDES={agents:{},clubs:{}};
function loadOverrides(){ try{ var o=JSON.parse(localStorage.getItem('cashOverrides')||'{}'); OVERRIDES={agents:o.agents||{},clubs:o.clubs||{}}; }catch(e){ OVERRIDES={agents:{},clubs:{}}; } }
function saveOverrides(){ try{ localStorage.setItem('cashOverrides',JSON.stringify(OVERRIDES)); }catch(e){} }
function resolveName(kind, raw){ var d=nname(raw)||'—'; var canon=OVERRIDES[kind] && OVERRIDES[kind][nkey(d)]; return canon?nname(canon):d; }
loadOverrides();
function stakeLabel(t){ if(t.sb&&t.bb) return brl(t.sb,t.sb<1?2:0)+'/'+brl(t.bb,t.bb<1?2:0); if(t.bb) return brl(t.bb,t.bb<1?2:0)+' BB'; return '—'; }
function typeClean(t){ return String(t||'').trim(); }
function durMin(t){ var raw=String(t.dur||'').trim(); if(!raw) return 0;
  var days=0, m=raw.match(/^(\d+)\s*d\s*/i); if(m){ days=+m[1]; raw=raw.slice(m[0].length); }
  var s=raw.split(':'); var h=+s[0]||0, mi=+s[1]||0; return days*1440 + h*60 + mi; }

// ══════════════════════════════ AGREGAÇÕES (lazy) ══════════════════════════
function buildAggregates(){
  PLAYERS = new Map(); AGENTS = new Map(); CLUBS = new Map();
  var winners=0, losers=0, evenP=0, totalNet=0, totalFee=0, totalBuyin=0, seats=0;
  for(var i=0;i<TABLES.length;i++){
    var t=TABLES[i], ro=t.roster||[];
    for(var j=0;j<ro.length;j++){
      var s=ro[j]; seats++;
      // jogador
      var p=PLAYERS.get(s.id);
      if(!p){ p={id:s.id,name:s.n,club:s.club,ag:s.ag,tables:0,buyin:0,net:0,fee:0,hands:0,win:0,loss:0,best:-1e18,worst:1e18}; PLAYERS.set(s.id,p); }
      p.tables++; p.buyin+=s.bi||0; p.net+=s.w||0; p.fee+=s.fee||0; p.hands+=s.h||0;
      if((s.w||0)>0)p.win++; else if((s.w||0)<0)p.loss++;
      if((s.w||0)>p.best)p.best=s.w||0; if((s.w||0)<p.worst)p.worst=s.w||0;
      if(!p.name&&s.n)p.name=s.n; if(!p.club&&s.club)p.club=s.club;
      // agente (chave estável case-insensitive + overrides de fusão; nome = canônico/1º visto)
      var ad=resolveName('agents', s.ag), ak=nkey(ad)||'—', a=AGENTS.get(ak); if(!a){ a={name:ad,players:new Set(),seats:0,fee:0,net:0,buyin:0}; AGENTS.set(ak,a); }
      a.players.add(s.id); a.seats++; a.fee+=s.fee||0; a.net+=s.w||0; a.buyin+=s.bi||0;
      // clube (idem)
      var cd=resolveName('clubs', s.club), ck=nkey(cd)||'—', c=CLUBS.get(ck); if(!c){ c={name:cd,players:new Set(),seats:0,fee:0,net:0,buyin:0}; CLUBS.set(ck,c); }
      c.players.add(s.id); c.seats++; c.fee+=s.fee||0; c.net+=s.w||0; c.buyin+=s.bi||0;
      totalFee+=s.fee||0; totalBuyin+=s.bi||0;
    }
  }
  PLAYERS.forEach(function(p){ p.net=+p.net.toFixed(2); if(p.net>0.001)winners++; else if(p.net<-0.001)losers++; else evenP++; totalNet+=p.net; });
  ECO={ players:PLAYERS.size, winners:winners, losers:losers, even:evenP, seats:seats,
        totalNet:totalNet, totalFee:totalFee, totalBuyin:totalBuyin,
        agents:AGENTS.size, clubs:CLUBS.size };
}
function ensureAgg(){ if(!PLAYERS) buildAggregates(); }

// ── segmentação de jogador (whale/pro/recreativo/regular) + concentração ────
function segmentPlayers(){
  ensureAgg();
  var arr=[].concat(Array.from(PLAYERS.values()));
  var feeSorted=arr.slice().sort(function(a,b){return b.fee-a.fee;});
  var whaleIdx=Math.max(0,Math.floor(arr.length*0.01));
  var whaleCut=feeSorted.length?feeSorted[Math.min(whaleIdx,feeSorted.length-1)].fee:Infinity;
  var segs={pro:0,whale:0,rec:0,reg:0}, segFee={pro:0,whale:0,rec:0,reg:0}, segNet={pro:0,whale:0,rec:0,reg:0};
  arr.forEach(function(p){
    var seg;
    if(p.net>0 && p.tables>=5 && p.hands>=300 && (p.win/(p.tables||1))>=0.55) seg='pro';      // ganhador consistente (pro/bot suspeito)
    else if(p.fee>=whaleCut && whaleCut>0) seg='whale';                                        // top 1% de rake gerado
    else if(p.net<0) seg='rec';                                                                // recreativo (perde — sustenta o jogo)
    else seg='reg';
    p.seg=seg; segs[seg]++; segFee[seg]+=p.fee; segNet[seg]+=p.net;
  });
  // concentração de rake
  var totFee=arr.reduce(function(a,p){return a+p.fee;},0);
  function topShare(frac){ var k=Math.max(1,Math.ceil(arr.length*frac)); var s=0; for(var i=0;i<k;i++)s+=feeSorted[i].fee; return {k:k,share:pct(s,totFee)}; }
  return {segs:segs,segFee:segFee,segNet:segNet,totFee:totFee,c1:topShare(0.01),c5:topShare(0.05),c10:topShare(0.10)};
}

// ── detecção de conluio / chip-dumping (heads-up: sinal limpo de transferência) ──
function buildCollusion(){
  var pairs=new Map();
  for(var i=0;i<TABLES.length;i++){
    var ro=TABLES[i].roster||[]; if(ro.length!==2)continue;         // foco em HU
    var p=ro[0], q=ro[1]; var lo=Math.min(p.id,q.id), hi=Math.max(p.id,q.id);
    var loP=p.id===lo?p:q, hiP=p.id===lo?q:p; var key=lo+'|'+hi;
    var e=pairs.get(key); if(!e){ e={loN:loP.n,hiN:hiP.n,loClub:loP.club,hiClub:hiP.club,games:0,net:0,loWins:0,hiWins:0,vol:0}; pairs.set(key,e); }
    e.games++; e.net+=loP.w||0; e.vol+=Math.abs(loP.w||0);
    if((loP.w||0)>0)e.loWins++; else if((loP.w||0)<0)e.hiWins++;
  }
  var flagged=[];
  pairs.forEach(function(e){
    var total=e.loWins+e.hiWins; if(e.games<4||!total)return;
    var dir=Math.max(e.loWins,e.hiWins)/total;                       // 1 = sempre o mesmo ganha
    if(dir>=0.8){ var loWon=e.loWins>e.hiWins;
      flagged.push({winner:loWon?e.loN:e.hiN, loser:loWon?e.hiN:e.loN, winnerClub:loWon?e.loClub:e.hiClub, loserClub:loWon?e.hiClub:e.loClub,
        games:e.games, dir:dir, transfer:Math.abs(e.net)}); }
  });
  flagged.sort(function(a,b){return b.transfer-a.transfer;});
  return flagged;
}

// ══════════════════════════════ CARREGAMENTO ═══════════════════════════════
function setRoster(obj){
  R=obj; TABLES=Object.values(R.tables||{}); PLAYERS=null; AGENTS=null; CLUBS=null; ECO=null;
  // pré-computa uns campos de mesa p/ ordenação/exibição
  TABLES.forEach(function(t){
    var ro=t.roster||[]; var big=null, small=null, net=0;
    for(var k=0;k<ro.length;k++){ ro[k].id=pid(ro[k].id); net+=ro[k].w||0; if(!big||ro[k].w>big.w)big=ro[k]; if(!small||ro[k].w<small.w)small=ro[k]; }
    t._net=net; t._big=big; t._small=small; t._rc=ro.length; t._durm=durMin(t); t._stake=stakeLabel(t);
  });
  renderMesas(); renderEco(); renderRake(); renderIntegridade(); var mp=el('mpBody'); if(mp)mp.innerHTML=playerPrompt();
  var meta=R.meta||{};
  document.querySelectorAll('.mx-week').forEach(function(e){ e.textContent = meta.week ? ('Semana '+meta.week) : (meta.sample?'Amostra':'Roster carregado'); });
}
function loadFromFile(file){
  var st=el('mxStatus'); if(st)st.textContent='Lendo arquivo…';
  var rd=new FileReader();
  rd.onload=function(e){ try{ setRoster(JSON.parse(e.target.result)); if(st)st.textContent='Carregado: '+TABLES.length+' mesas, '+(ECO?ECO.players:'?')+' jogadores.'; }
    catch(err){ if(st)st.textContent='Erro ao ler JSON: '+err.message; } };
  rd.onerror=function(){ if(st)st.textContent='Falha ao ler o arquivo.'; };
  rd.readAsText(file);
}
window.cashRosterLoadFile=function(inp){ if(inp&&inp.files&&inp.files[0])loadFromFile(inp.files[0]); };
// runner reutilizável: parse do .xlsx em Web Worker (não trava a UI), fallback p/
// thread principal. Retorna Promise<{roster, gameStats}>. Usado pelo "Importar
// Semana" (alimenta TUDO) e pela aba Mesas.
function runIngest(file, onProgress){
  onProgress=onProgress||function(){};
  return new Promise(function(resolve,reject){
    if(!window.CashIngest||!CashIngest.supported()){ reject(new Error('Navegador sem suporte a leitura em streaming (use Chrome/Edge atualizado).')); return; }
    var fellBack=false;
    function mainThread(){ CashIngest.parse(file,{onProgress:onProgress}).then(resolve).catch(reject); }
    if(typeof Worker==='function'){
      try{
        var w=new Worker('cash-ingest-worker.js');
        w.onmessage=function(ev){ var d=ev.data||{};
          if(d.type==='progress')onProgress(d.m,d.p);
          else if(d.type==='done'){ w.terminate(); resolve(d.res); }
          else if(d.type==='error'){ w.terminate(); reject(new Error(d.msg)); }
        };
        w.onerror=function(e){ if(fellBack)return; fellBack=true; w.terminate(); console.warn('worker falhou, thread principal',e); mainThread(); };
        w.postMessage({file:file}); return;
      }catch(e){ console.warn('sem worker, thread principal',e); }
    }
    mainThread();
  });
}
window.cashRunIngest=runIngest;
// alimenta as telas de jogador + salva local + compartilha (Importar Semana e aba Mesas usam)
window.cashFeedRoster=function(roster){
  setRoster(roster);
  var meta=(roster&&roster.meta)||{};
  var note=function(msg){ [el('mxStatus'),el('validarStatus')].forEach(function(e){ if(e)e.innerHTML+=' <span style="color:var(--ink3)">· '+msg+'</span>'; }); };
  // GUARDA: qualquer ERRO de validação (roster vazio, coluna deslocada, sem data
  // válida…) NÃO publica pra todos — não sobrescreve uma semana boa com dado ruim.
  // Ainda cacheia local p/ inspeção. Os detalhes já aparecem no relatório de
  // validação da aba Importar Semana (renderValidationReport).
  var val=meta.validation||{};
  if(meta.rosterEmpty || val.level==='error'){
    var why = meta.rosterEmpty
      ? (meta.cashTables||0)+' mesas cash, mas 0 com jogadores — formato do Game Detail pode ter mudado'
      : 'a validação encontrou erros (veja a aba Importar Semana)';
    [el('mxStatus'),el('validarStatus')].forEach(function(e){ if(e)e.innerHTML+=' <span style="color:#ef4444;font-weight:700">· ⚠ '+why+'. NÃO publicado pra todos.</span>'; });
    if(window.CashStore&&CashStore.cacheLocal)CashStore.cacheLocal(roster).catch(function(e){console.warn('cacheLocal',e);});
    return;
  }
  if(window.CashStore&&CashStore.cacheLocal)CashStore.cacheLocal(roster).then(function(){ if(el('mtrendBody'))renderTendencias(); }).catch(function(e){console.warn('cacheLocal',e);});
  if(window.CashStore&&CashStore.available&&CashStore.available()){
    note('publicando pra todos…');
    CashStore.publish(roster,{onProgress:function(){}}).then(function(k){ note('✓ publicado pra todos ('+k+')'); refreshWeeks(); if(el('mtrendBody'))renderTendencias(); })
      .catch(function(e){ note('falha ao publicar: '+e.message); console.warn('publish',e); });
  } else {
    note('salvo neste navegador (não compartilhado: '+(window.CashStore&&CashStore.reason?CashStore.reason():'Storage indisponível')+')');
  }
};
// wrapper com UI (aba Mesas — botão secundário)
window.cashIngestFile=function(inp, onDone){
  var file=inp&&inp.files&&inp.files[0]; if(!file)return;
  var st=el('mxStatus'), bar=el('mxProgress');
  var setSt=function(m){ if(st)st.textContent=m; }, setBar=function(p){ if(bar)bar.style.width=(p||0)+'%'; };
  setSt('Lendo '+(file.name||'planilha')+' ('+(file.size/1e6|0)+' MB)…'); setBar(2);
  runIngest(file,function(m,p){ setSt(m); setBar(p); }).then(function(res){
    setBar(100); window.cashFeedRoster(res.roster);
    setSt('Pronto: '+TABLES.length+' mesas, '+(ECO?ECO.players.toLocaleString('pt-BR'):'?')+' jogadores.');
    if(typeof onDone==='function'){ try{ onDone(res); }catch(e){ console.error(e); } }
  }).catch(function(err){ setBar(0); setSt('Erro: '+((err&&err.message)||err)); });
};
// permite carregar via fetch (dev harness / Storage já baixado)
window.cashRosterLoadURL=function(url){ return fetch(url).then(function(r){return r.json();}).then(setRoster); };
window.cashRosterSet=setRoster;

// ══════════════════════════════ EXPLORADOR DE MESAS ════════════════════════
var mxState={ q:'', type:'', sort:'fee', page:0, per:40 };
function tableTypes(){ var s={}; TABLES.forEach(function(t){ s[typeClean(t.type)]=1; }); return Object.keys(s).sort(); }
function renderMesasControls(){
  var host=el('mxControls'); if(!host)return;
  var opts='<option value="">Todos os tipos</option>'+tableTypes().map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('');
  host.innerHTML=
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">'
    +'<input id="mxSearch" placeholder="Buscar por Game ID, nome da mesa ou jogador…" oninput="cashMx(\'q\',this.value)" '
    +'style="flex:1;min-width:220px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--surf);color:var(--ink);padding:0 12px;font-size:12px">'
    +'<select onchange="cashMx(\'type\',this.value)" style="height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--surf);color:var(--ink);padding:0 8px;font-size:12px">'+opts+'</select>'
    +'<select onchange="cashMx(\'sort\',this.value)" style="height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--surf);color:var(--ink);padding:0 8px;font-size:12px">'
      +'<option value="fee">Ordenar: mais rake</option><option value="players">mais jogadores</option>'
      +'<option value="net">jogadores +ganharam</option><option value="netd">jogadores +perderam</option>'
      +'<option value="recent">mais recentes</option></select>'
    +'</div>';
}
window.cashMx=function(k,v){ mxState[k]=v; mxState.page=0; renderMesasList(); };
function filteredTables(){
  var q=mxState.q.trim().toLowerCase(), ty=mxState.type;
  var arr=TABLES.filter(function(t){
    if(ty && typeClean(t.type)!==ty) return false;
    if(!q) return true;
    if(String(t.id).indexOf(q)>=0) return true;
    if((t.name||'').toLowerCase().indexOf(q)>=0) return true;
    // busca por jogador dentro da mesa
    var ro=t.roster||[]; for(var i=0;i<ro.length;i++){ if((ro[i].n||'').toLowerCase().indexOf(q)>=0) return true; }
    return false;
  });
  var s=mxState.sort;
  arr.sort(function(a,b){
    if(s==='players') return b._rc-a._rc;
    if(s==='net') return b._net-a._net;
    if(s==='netd') return a._net-b._net;
    if(s==='recent') return String(b.start).localeCompare(String(a.start));
    return (b.fee||0)-(a.fee||0);
  });
  return arr;
}
function renderMesas(){ renderMesasControls(); renderMesasList(); }
function renderMesasList(){
  var host=el('mxList'); if(!host)return;
  if(!R){ host.innerHTML=emptyRoster(); return; }
  var arr=filteredTables();
  var total=arr.length, per=mxState.per, page=mxState.page, start=page*per;
  var slice=arr.slice(start,start+per);
  var head='<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 6px">'
    +'<div style="font-size:11px;color:var(--ink3)">'+br(total)+' mesa(s) · mostrando '+(total?start+1:0)+'–'+Math.min(start+per,total)+'</div></div>';
  var rows=slice.map(function(t){
    var netCls=t._net>0?'r':(t._net<0?'g':''); // jogadores ganharam = ruim p/ casa (r vermelho? aqui só cor neutra)
    var winner=t._big?esc(t._big.n)+' +'+brl(t._big.w):'—';
    return '<tr onclick="cashMxOpen(\''+t.id+'\')" style="cursor:pointer">'
      +'<td class="m" style="color:var(--ink3)">'+t.id+'</td>'
      +'<td class="b">'+esc(t.name||'—')+'</td>'
      +'<td>'+esc(typeClean(t.type))+'</td>'
      +'<td class="m">'+t._stake+'</td>'
      +'<td class="r m">'+t._rc+'</td>'
      +'<td class="r b">R$ '+brl(t.fee)+'</td>'
      +'<td class="r m">'+(t.feeRate||0)+'%</td>'
      +'<td class="r m" style="color:var(--ink3)">'+esc((t._durm/60).toFixed(1))+'h</td>'
      +'<td class="m" style="color:var(--ink3)">'+winner+'</td>'
      +'</tr>';
  }).join('');
  var pager='';
  var pages=Math.ceil(total/per);
  if(pages>1){ pager='<div style="display:flex;gap:6px;justify-content:center;margin:12px 0">'
    +'<button '+(page<=0?'disabled':'')+' onclick="cashMxPage('+(page-1)+')" class="mx-pg">‹ Anterior</button>'
    +'<span style="font-size:11px;color:var(--ink3);align-self:center">Página '+(page+1)+'/'+pages+'</span>'
    +'<button '+(page>=pages-1?'disabled':'')+' onclick="cashMxPage('+(page+1)+')" class="mx-pg">Próxima ›</button></div>'; }
  host.innerHTML=head+'<div class="tw"><table class="t"><thead><tr>'
    +'<th>ID</th><th>Mesa</th><th>Tipo</th><th>Stake</th><th class="r">Jog.</th><th class="r">Rake</th><th class="r">Fee%</th><th class="r">Dur.</th><th>Maior ganho</th>'
    +'</tr></thead><tbody>'+(rows||'<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--ink3)">Nenhuma mesa encontrada.</td></tr>')+'</tbody></table></div>'+pager;
}
window.cashMxPage=function(p){ mxState.page=p; renderMesasList(); try{el('mxList').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){} };

// ── drawer de detalhe da mesa ───────────────────────────────────────────────
window.cashMxOpen=function(id){
  var t=R.tables[id]; if(!t)return;
  var ro=(t.roster||[]).slice().sort(function(a,b){return (b.w||0)-(a.w||0);});
  var totBuyin=0,totFee=0,totNet=0,totHands=0; ro.forEach(function(s){totBuyin+=s.bi||0;totFee+=s.fee||0;totNet+=s.w||0;totHands+=s.h||0;});
  var kc=function(l,v,s){ return '<div style="flex:1;min-width:110px"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)">'+l+'</div><div style="font-size:15px;font-weight:800;color:var(--ink)">'+v+'</div><div style="font-size:10px;color:var(--ink3)">'+(s||'')+'</div></div>'; }
  var head='<div style="display:flex;flex-wrap:wrap;gap:14px;padding:4px 0 12px;border-bottom:1px solid var(--bdr);margin-bottom:12px">'
    +kc('Mesa',esc(t.name||'—'),'ID '+t.id+' · '+esc(typeClean(t.type)))
    +kc('Stake',t._stake||stakeLabel(t),'ante '+brl(t.ante,t.ante<1?2:0))
    +kc('Rake','R$ '+brl(t.fee),'fee rate '+(t.feeRate||0)+'%')
    +kc('Jogadores',t.roster.length,br(totHands)+' mãos')
    +kc('Duração',(durMin(t)/60).toFixed(1)+'h',String(t.start||'').trim()+'')
    +kc('Buy-in','R$ '+brl(t.bMin,t.bMin<1?2:0)+'–'+brl(t.bMax,t.bMax<1?2:0),'na mesa')
    +'</div>';
  var body=ro.map(function(s,i){
    var wc=(s.w||0)>0?'style="color:#22c55e;font-weight:800"':((s.w||0)<0?'style="color:#ef4444;font-weight:800"':'');
    return '<tr>'+'<td class="m" style="color:var(--ink3)">'+(i+1)+'</td>'
      +'<td class="b">'+esc(s.n)+'</td>'
      +'<td style="color:var(--ink3)">'+esc(s.club||'—')+'</td>'
      +'<td style="color:var(--ink3)">'+esc(s.ag||'—')+'</td>'
      +'<td class="r m">R$ '+brl(s.bi)+'</td>'
      +'<td class="r" '+wc+'>'+((s.w||0)>=0?'+':'')+'R$ '+brl(s.w)+'</td>'
      +'<td class="r m">R$ '+brl(s.fee,2)+'</td>'
      +'<td class="r m">'+br(s.h)+'</td>'
      +'</tr>';
  }).join('');
  var foot='<tr style="border-top:2px solid var(--bdr);font-weight:800"><td></td><td>Total</td><td></td><td></td>'
    +'<td class="r m">R$ '+brl(totBuyin)+'</td><td class="r">'+(totNet>=0?'+':'')+'R$ '+brl(totNet)+'</td><td class="r m">R$ '+brl(totFee,2)+'</td><td class="r m">'+br(totHands)+'</td></tr>';
  var html='<div class="mx-drawer-inner">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
      +'<div style="font-size:13px;font-weight:800">Quem jogou nesta mesa</div>'
      +'<div style="display:flex;gap:6px"><button onclick="cashExportTable(\''+t.id+'\')" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">⬇ XLSX</button>'
      +'<button onclick="cashMxClose()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">Fechar ✕</button></div>'
    +'</div>'+head
    +'<div class="tw"><table class="t"><thead><tr><th>#</th><th>Jogador</th><th>Clube</th><th>Agente</th><th class="r">Buy-in</th><th class="r">Resultado</th><th class="r">Fee</th><th class="r">Mãos</th></tr></thead>'
    +'<tbody>'+body+foot+'</tbody></table></div></div>';
  var d=el('mxDrawer'); d.innerHTML=html; d.classList.add('open'); document.body.style.overflow='hidden';
};
window.cashMxClose=function(){ var d=el('mxDrawer'); if(d){d.classList.remove('open');d.innerHTML='';} document.body.style.overflow=''; };

// ── modal de fusão de agentes/clubes (overrides) ────────────────────────────
window.cashOpenOverrides=function(){
  var ta='width:100%;height:120px;border-radius:8px;border:1px solid var(--bdr);background:var(--surf);color:var(--ink);padding:8px;font-size:12px;font-family:inherit';
  var toLines=function(kind){ var o=OVERRIDES[kind]||{}; return Object.keys(o).map(function(k){return k+' => '+o[k];}).join('\n'); };
  var d=el('mxDrawer'); if(!d)return;
  d.innerHTML='<div class="mx-drawer-inner">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:14px;font-weight:800">Fundir agentes / clubes</div>'
    +'<button onclick="cashMxClose()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">Fechar ✕</button></div>'
    +'<div style="font-size:11px;color:var(--ink3);margin-bottom:10px">Uma linha por fusão: <b>VARIANTE =&gt; NOME CANÔNICO</b>. Ex.: <code>GOLDENHU =&gt; Golden HU</code>. A variante é comparada sem diferenciar maiúsculas. (Salvo neste navegador.)</div>'
    +'<div style="font-size:12px;font-weight:700;margin:6px 0 2px">Agentes</div><textarea id="ovAgents" style="'+ta+'">'+esc(toLines('agents'))+'</textarea>'
    +'<div style="font-size:12px;font-weight:700;margin:10px 0 2px">Clubes</div><textarea id="ovClubs" style="'+ta+'">'+esc(toLines('clubs'))+'</textarea>'
    +'<div style="margin-top:10px"><button onclick="cashSaveOverrides()" style="background:var(--gold);border:none;border-radius:8px;color:#000;height:34px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:700">Salvar e recalcular</button></div>'
    +'</div>';
  d.classList.add('open'); document.body.style.overflow='hidden';
};
window.cashSaveOverrides=function(){
  var parse=function(txt){ var o={}; (txt||'').split('\n').forEach(function(ln){ var i=ln.indexOf('=>'); if(i<0)return; var k=nkey(ln.slice(0,i)); var v=nname(ln.slice(i+2)); if(k&&v)o[k]=v; }); return o; };
  OVERRIDES={agents:parse((el('ovAgents')||{}).value), clubs:parse((el('ovClubs')||{}).value)};
  saveOverrides();
  PLAYERS=null; AGENTS=null; CLUBS=null; ECO=null;   // força re-agregação com as fusões
  cashMxClose(); renderEco();
};

// ══════════════════════════════ PERFIL DE JOGADOR ══════════════════════════
function playerPrompt(){ return '<div style="text-align:center;padding:40px 16px;color:var(--ink3);font-size:12px">Busque um jogador por nome ou ID para ver todas as mesas dele na semana.</div>'; }
window.cashMpSearch=function(v){
  ensureAgg(); var q=(v||'').trim().toLowerCase(); var host=el('mpBody'); if(!host)return;
  if(!q){ host.innerHTML=playerPrompt(); return; }
  var hits=[]; PLAYERS.forEach(function(p){ if(String(p.id)===q || (p.name||'').toLowerCase().indexOf(q)>=0) hits.push(p); });
  hits.sort(function(a,b){return b.fee-a.fee;});
  if(!hits.length){ host.innerHTML='<div style="text-align:center;padding:32px;color:var(--ink3)">Nenhum jogador encontrado.</div>'; return; }
  if(hits.length>1 && String(hits[0].id)!==q){
    host.innerHTML='<div style="font-size:11px;color:var(--ink3);margin-bottom:8px">'+hits.length+' jogadores — clique para abrir:</div>'
      +hits.slice(0,40).map(function(p){return '<button onclick="cashMpOpen('+p.id+')" style="display:block;width:100%;text-align:left;background:var(--surf);border:1px solid var(--bdr);border-radius:8px;padding:8px 12px;margin-bottom:6px;cursor:pointer;color:var(--ink)"><b>'+esc(p.name)+'</b> <span style="color:var(--ink3)">· ID '+p.id+' · '+esc(p.club||'—')+' · '+p.tables+' mesas · rake R$ '+brl(p.fee)+'</span></button>';}).join('');
    return;
  }
  cashMpOpen(hits[0].id);
};
window.cashMpOpen=function(id){
  ensureAgg(); var p=PLAYERS.get(pid(id)); var host=el('mpBody'); if(!p){host.innerHTML='<div style="padding:24px;color:var(--ink3)">Jogador não encontrado.</div>';return;}
  // mesas do jogador
  var mine=[]; for(var i=0;i<TABLES.length;i++){ var ro=TABLES[i].roster||[]; for(var j=0;j<ro.length;j++){ if(ro[j].id===p.id){ mine.push({t:TABLES[i],s:ro[j]}); break; } } }
  mine.sort(function(a,b){return String(b.t.start).localeCompare(String(a.t.start));});
  var kc=function(l,v,s,c){ return '<div class="kpi'+(c?' '+c:'')+'"><div class="kl">'+l+'</div><div class="kv">'+v+'</div><div class="ks">'+(s||'')+'</div></div>'; }
  var netCls=p.net>0?'c-green':(p.net<0?'c-amber':'');
  var kpis='<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">'
    +kc('Resultado líquido',(p.net>=0?'+':'')+'R$ '+brl(p.net),p.win+'V / '+p.loss+'D',netCls)
    +kc('Rake gerado','R$ '+brl(p.fee),'o que ele rendeu à casa','hero')
    +kc('Mesas',p.tables,br(p.hands)+' mãos')
    +kc('Buy-in total','R$ '+brl(p.buyin),'volume movimentado')
    +kc('Maior ganho','+R$ '+brl(p.best),'numa mesa')
    +kc('Maior perda','R$ '+brl(p.worst),'numa mesa')
    +'</div>';
  var head='<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">'
    +'<div><div style="font-size:18px;font-weight:800">'+esc(p.name)+'</div>'
    +'<div style="font-size:11px;color:var(--ink3)">ID '+p.id+' · Clube '+esc(p.club||'—')+' · Agente '+esc(p.ag||'—')+'</div></div>'
    +'<div style="display:flex;gap:6px"><button onclick="cashExportPlayer('+p.id+')" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">⬇ XLSX</button>'
    +'<button onclick="cashMpSearch(\'\')" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">Nova busca</button></div></div>';
  var rows=mine.map(function(m){
    var s=m.s,t=m.t; var wc=(s.w||0)>0?'style="color:#22c55e;font-weight:800"':((s.w||0)<0?'style="color:#ef4444;font-weight:800"':'');
    return '<tr onclick="cashMxOpen(\''+t.id+'\')" style="cursor:pointer"><td class="m" style="color:var(--ink3)">'+String(t.start||'').trim().slice(5,16)+'</td>'
      +'<td class="b">'+esc(t.name||'—')+'</td><td>'+esc(typeClean(t.type))+'</td><td class="m">'+stakeLabel(t)+'</td>'
      +'<td class="r m">R$ '+brl(s.bi)+'</td><td class="r" '+wc+'>'+((s.w||0)>=0?'+':'')+'R$ '+brl(s.w)+'</td>'
      +'<td class="r m">R$ '+brl(s.fee,2)+'</td><td class="r m">'+br(s.h)+'</td></tr>';
  }).join('');
  host.innerHTML=head+kpis
    +'<div id="mpTraj"></div>'
    +'<div class="card" style="margin-top:12px"><div class="ct">Mesas jogadas ('+mine.length+')</div>'
    +'<div class="tw"><table class="t"><thead><tr><th>Início</th><th>Mesa</th><th>Tipo</th><th>Stake</th><th class="r">Buy-in</th><th class="r">Resultado</th><th class="r">Fee</th><th class="r">Mãos</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  renderPlayerTrajectory(p.id);
};

// ── TRAJETÓRIA CROSS-SEMANA (identificação = seguir a pessoa no tempo) ───────
// Usa os digests de TODAS as semanas (ids/net/fee) — sem reabrir rosters. Some
// rake/resultado vitalício, semanas ativas, e desenha a evolução do resultado.
var _allDigests=null, _allDigestsPromise=null;
function ensureAllDigests(){
  if(_allDigests) return Promise.resolve(_allDigests);
  if(_allDigestsPromise) return _allDigestsPromise;
  var online=!!(window.CashStore&&CashStore.available&&CashStore.available());
  var getList = online ? CashStore.listWeeks().then(function(l){return (l||[]).map(function(w){return w.key;});})
                       : (window.CashStore&&CashStore.listLocal?CashStore.listLocal():Promise.resolve([]));
  _allDigestsPromise = getList.then(function(keys){
    keys=(keys||[]).filter(Boolean);
    var loadOne=function(k){ return online
      ? CashStore.loadDigest(k).catch(function(){return null;})
      : CashStore.loadLocal(k).then(function(r){return CashStore.buildDigest(r);}).catch(function(){return null;}); };
    return Promise.all(keys.map(loadOne)).then(function(ds){
      _allDigests=ds.filter(Boolean).sort(function(a,b){return String(a.key).localeCompare(String(b.key));});
      return _allDigests;
    });
  }).catch(function(){ _allDigests=[]; return _allDigests; });
  return _allDigestsPromise;
}
window.cashInvalidateDigests=function(){ _allDigests=null; _allDigestsPromise=null; };
function renderPlayerTrajectory(playerId){
  var host=el('mpTraj'); if(!host)return;
  var pidN=pid(playerId);
  host.innerHTML='<div class="card" style="margin-top:12px;color:var(--ink3);font-size:11px;padding:16px">Carregando trajetória multi-semana…</div>';
  ensureAllDigests().then(function(ds){
    if(!ds||ds.length<2){ host.innerHTML=''; return; }   // só faz sentido com 2+ semanas
    var lifeNet=0, lifeFee=0, weeksActive=0, firstW=null, lastW=null, rows=[];
    ds.forEach(function(d){
      var idx=(d.ids||[]).indexOf(pidN);
      if(idx<0){ rows.push({week:d.week,active:false}); return; }
      var net=(d.net&&d.net[idx])||0, fee=(d.fee&&d.fee[idx])||0;
      lifeNet+=net; lifeFee+=fee; weeksActive++; if(!firstW)firstW=d.week; lastW=d.week;
      rows.push({week:d.week,active:true,net:net,fee:fee});
    });
    if(!weeksActive){ host.innerHTML=''; return; }
    var pts=rows.filter(function(r){return r.active;}).map(function(r){return {x:r.week,y:Math.round(r.net*GU_TO_BRL)};});
    var spark = pts.length>=2 ? svgLine(pts,{color:'var(--gold)',zero:true,fmt:function(v){return 'R$ '+fmtK(v);}}) : '';
    var kc=function(l,v,s,c){ return '<div class="kpi'+(c?' '+c:'')+'"><div class="kl">'+l+'</div><div class="kv">'+v+'</div><div class="ks">'+(s||'')+'</div></div>'; };
    var netCls=lifeNet>0?'c-green':(lifeNet<0?'c-amber':'');
    var kpis='<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">'
      +kc('Semanas ativo',br(weeksActive),'de '+ds.length+' publicadas')
      +kc('Rake vitalício','R$ '+brl(lifeFee),'somando todas as semanas','hero')
      +kc('Resultado vitalício',(lifeNet>=0?'+':'')+'R$ '+brl(lifeNet),'acumulado',netCls)
      +kc('Primeira semana',esc(String(firstW||'—').slice(0,10)),'')
      +kc('Última semana',esc(String(lastW||'—').slice(0,10)),'')
      +'</div>';
    var trows=rows.map(function(r){ if(!r.active) return '<tr style="opacity:.5"><td class="m">'+esc(String(r.week).slice(0,10))+'</td><td colspan="2" style="color:var(--ink3)">não jogou</td></tr>';
      var wc=r.net>0?'style="color:#22c55e;font-weight:800"':(r.net<0?'style="color:#ef4444;font-weight:800"':'');
      return '<tr><td class="m">'+esc(String(r.week).slice(0,10))+'</td><td class="r" '+wc+'>'+(r.net>=0?'+':'')+'R$ '+brl(r.net)+'</td><td class="r m">R$ '+brl(r.fee)+'</td></tr>'; }).join('');
    host.innerHTML='<div class="card" style="margin-top:12px"><div class="ct">Trajetória — todas as semanas</div>'
      +'<div class="cs">Segue este jogador ao longo do tempo (dos resumos, sem reabrir rosters)</div>'
      +kpis
      +(spark?'<div style="margin-top:10px"><div style="font-size:11px;font-weight:700;margin-bottom:4px">Resultado por semana (R$)</div>'+spark+'</div>':'')
      +'<div class="tw" style="margin-top:10px"><table class="t"><thead><tr><th>Semana</th><th class="r">Resultado</th><th class="r">Rake</th></tr></thead><tbody>'+trows+'</tbody></table></div></div>';
  }).catch(function(){ host.innerHTML=''; });
}

// ══════════════════════════════ ECOLOGIA ═══════════════════════════════════
function barRow(label, val, max, sub, color){
  var w=max?Math.max(2,Math.round(val/max*100)):0;
  return '<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span class="b" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">'+esc(label)+'</span><span style="color:var(--ink3)">'+sub+'</span></div>'
    +'<div style="height:7px;border-radius:4px;background:var(--surf2,rgba(128,128,128,.15))"><div style="height:100%;border-radius:4px;width:'+w+'%;background:'+(color||'var(--gold)')+'"></div></div></div>';
}
function renderEco(){
  var host=el('mecoBody'); if(!host)return; if(!R){ host.innerHTML=emptyRoster(); return; }
  ensureAgg();
  var kc=function(l,v,s,c){ return '<div class="kpi'+(c?' '+c:'')+'"><div class="kl">'+l+'</div><div class="kv">'+v+'</div><div class="ks">'+(s||'')+'</div></div>'; }
  var wr=pct(ECO.winners,ECO.players), lr=pct(ECO.losers,ECO.players);
  var kpis='<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">'
    +kc('Jogadores únicos',br(ECO.players),ECO.seats.toLocaleString('pt-BR')+' assentos','hero')
    +kc('Perderam',br(ECO.losers),lr.toFixed(1)+'% do total','c-green')
    +kc('Ganharam',br(ECO.winners),wr.toFixed(1)+'% do total','c-amber')
    +kc('Rake total','R$ '+brl(ECO.totalFee),'gerado pelos jogadores')
    +kc('Resultado líquido dos jogadores',(ECO.totalNet>=0?'+':'')+'R$ '+brl(ECO.totalNet),'≈ −(rake+jackpot) num jogo saudável')
    +'</div>';
  // top jogadores por rake gerado
  var byFee=[...PLAYERS.values()].sort(function(a,b){return b.fee-a.fee;}).slice(0,12);
  var maxFee=byFee.length?byFee[0].fee:0;
  var topRake='<div class="card"><div class="ct">Quem gera o rake (top jogadores)</div><div class="cs">De onde vem a receita da casa</div><div style="margin-top:10px">'
    +byFee.map(function(p){return barRow(p.name+' · '+(p.club||'—'), p.fee, maxFee, 'R$ '+brl(p.fee)+' · '+p.tables+' mesas');}).join('')+'</div></div>';
  // maiores perdedores (sustentam o jogo) e ganhadores (drenam)
  var byNet=[...PLAYERS.values()].filter(function(p){return p.tables>=2;});
  var losersArr=byNet.slice().sort(function(a,b){return a.net-b.net;}).slice(0,10);
  var winnersArr=byNet.slice().sort(function(a,b){return b.net-a.net;}).slice(0,10);
  var tbl=function(title,arr,pos){ return '<div class="card"><div class="ct">'+title+'</div><div class="tw"><table class="t"><thead><tr><th>Jogador</th><th>Clube</th><th class="r">Resultado</th><th class="r">Rake</th><th class="r">Mesas</th></tr></thead><tbody>'
    +arr.map(function(p){var wc=pos?'style="color:#ef4444;font-weight:800"':'style="color:#22c55e;font-weight:800"';return '<tr onclick="cashMpOpen('+p.id+')" style="cursor:pointer"><td class="b">'+esc(p.name)+'</td><td style="color:var(--ink3)">'+esc(p.club||'—')+'</td><td class="r" '+wc+'>'+(p.net>=0?'+':'')+'R$ '+brl(p.net)+'</td><td class="r m">R$ '+brl(p.fee)+'</td><td class="r m">'+p.tables+'</td></tr>';}).join('')
    +'</tbody></table></div></div>'; };
  // agentes e clubes por rake
  var byAg=[...AGENTS.values()].sort(function(a,b){return b.fee-a.fee;}).slice(0,12); var maxAg=byAg.length?byAg[0].fee:0;
  var byCl=[...CLUBS.values()].sort(function(a,b){return b.fee-a.fee;}).slice(0,12); var maxCl=byCl.length?byCl[0].fee:0;
  var agCard='<div class="card"><div class="ct">Rake por agente (top)</div><div style="margin-top:10px">'+byAg.map(function(a){return barRow(a.name,a.fee,maxAg,'R$ '+brl(a.fee)+' · '+a.players.size+' jog.');}).join('')+'</div></div>';
  var clCard='<div class="card"><div class="ct">Rake por clube (top)</div><div style="margin-top:10px">'+byCl.map(function(c){return barRow(c.name,c.fee,maxCl,'R$ '+brl(c.fee)+' · '+c.players.size+' jog.');}).join('')+'</div></div>';
  // segmentação + concentração
  var sg=segmentPlayers();
  var segMeta={pro:{l:'Pros / bots suspeitos',c:'#ef4444',d:'ganham consistente — drenam'},whale:{l:'Whales (top 1% rake)',c:'var(--gold)',d:'maiores geradores de receita'},rec:{l:'Recreativos',c:'#22c55e',d:'perdem — sustentam o jogo'},reg:{l:'Regulares',c:'var(--ink3)',d:'resultado próximo de zero'}};
  var segCard='<div class="card"><div class="ct">Segmentação de jogadores</div><div class="cs">Quem é quem no ecossistema</div><div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:8px">'
    +['whale','rec','pro','reg'].map(function(k){var m=segMeta[k];return '<div class="kpi"><div class="kl" style="color:'+m.c+'">'+m.l+'</div><div class="kv">'+br(sg.segs[k])+'</div><div class="ks">'+m.d+' · rake R$ '+brl(sg.segFee[k])+'</div></div>';}).join('')+'</div></div>';
  var concCard='<div class="card"><div class="ct">Concentração de rake</div><div class="cs" style="margin-bottom:8px">Quanto do rake vem de poucos jogadores — concentração alta = frágil</div>'
    +barRow('Top 1% dos jogadores ('+sg.c1.k+')',sg.c1.share,100,sg.c1.share.toFixed(1)+'% do rake')
    +barRow('Top 5% ('+sg.c5.k+')',sg.c5.share,100,sg.c5.share.toFixed(1)+'% do rake')
    +barRow('Top 10% ('+sg.c10.k+')',sg.c10.share,100,sg.c10.share.toFixed(1)+'% do rake')
    +'</div>';
  host.innerHTML=kpis
    +'<div style="margin-top:12px">'+segCard+'</div>'
    +'<div class="g2" style="margin-top:12px">'+topRake+agCard+'</div>'
    +'<div class="g2" style="margin-top:12px">'+tbl('Maiores perdedores (sustentam o jogo)',losersArr,true)+tbl('Maiores ganhadores (drenam a mesa)',winnersArr,false)+'</div>'
    +'<div class="g2" style="margin-top:12px">'+clCard+concCard+'</div>'
    +'<div class="card" style="margin-top:12px"><div class="ct">Saúde do ecossistema</div><div class="cs" style="margin-top:8px;line-height:1.6">'
      +'<b>'+lr.toFixed(0)+'%</b> perderam e <b>'+wr.toFixed(0)+'%</b> ganharam. Saudável = maioria perdendo pouco (recreativos) e poucos ganhando. '
      +'Veja a aba <b>Integridade</b> pra pares suspeitos de chip-dumping. '
      +'<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">'
      +'<button onclick="cashExportEco()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">⬇ Exportar ecologia (XLSX)</button>'
      +'<button onclick="cashOpenOverrides()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">⚙ Fundir agentes/clubes</button>'
      +'</div></div></div>';
}

// ══════════════════════════════ INTEGRIDADE (conluio / chip-dumping) ═══════
function renderIntegridade(){
  var host=el('mintBody'); if(!host)return; if(!R){ host.innerHTML=emptyRoster(); return; }
  var flags=buildCollusion();
  var kc=function(l,v,s,c){ return '<div class="kpi'+(c?' '+c:'')+'"><div class="kl">'+l+'</div><div class="kv">'+v+'</div><div class="ks">'+(s||'')+'</div></div>'; };
  var huTables=TABLES.filter(function(t){return (t.roster||[]).length===2;}).length;
  var kpis='<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">'
    +kc('Pares suspeitos (HU)',br(flags.length),'≥4 partidas, ≥80% num só lado',flags.length?'c-amber':'')
    +kc('Mesas heads-up analisadas',br(huTables),'base da detecção')
    +'</div>';
  var body=flags.slice(0,80).map(function(x){
    return '<tr><td class="b" style="color:#22c55e">'+esc(x.winner)+'</td><td style="color:var(--ink3)">'+esc(x.winnerClub||'—')+'</td>'
      +'<td class="b" style="color:#ef4444">'+esc(x.loser)+'</td><td style="color:var(--ink3)">'+esc(x.loserClub||'—')+'</td>'
      +'<td class="r m">'+x.games+'</td><td class="r m">'+(x.dir*100).toFixed(0)+'%</td><td class="r b">R$ '+brl(x.transfer)+'</td></tr>';
  }).join('');
  var table=flags.length? '<div class="card"><div class="ct">Pares heads-up com transferência unidirecional</div><div class="cs">Um jogador quase sempre perde pro mesmo adversário em HU — padrão clássico de chip-dumping. Investigar, não é prova.</div>'
    +'<div style="margin:8px 0"><button onclick="cashExportCollusion()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">⬇ Exportar (XLSX)</button></div>'
    +'<div class="tw"><table class="t"><thead><tr><th>Ganhador</th><th>Clube</th><th>Perdedor</th><th>Clube</th><th class="r">Partidas</th><th class="r">Direção</th><th class="r">Transferido</th></tr></thead><tbody>'+body+'</tbody></table></div></div>'
    : '<div class="card" style="text-align:center;padding:32px;color:var(--ink3)">Nenhum par heads-up com padrão suspeito nesta semana. ✅</div>';
  host.innerHTML=kpis+table;
}

// ══════════════════════════════ RAKE REAL + STAKES ════════════════════════
function stakeKey(t){ if(t.sb&&t.bb) return brl(t.sb,t.sb<1?2:0)+'/'+brl(t.bb,t.bb<1?2:0); if(t.bb) return brl(t.bb,t.bb<1?2:0)+' BB'; return '—'; }
function renderRake(){
  var host=el('mrakeBody'); if(!host)return; if(!R){ host.innerHTML=emptyRoster(); return; }
  var totFee=0,totBuyin=0,totHands=0,totMin=0,n=0;
  var byStake={}, byRate={}, byType={}, byDepth={};
  TABLES.forEach(function(t){
    var fee=t.fee||0, buyin=t.buyin||0, hands=t.hands||0, mins=durMin(t);
    totFee+=fee; totBuyin+=buyin; totHands+=hands; totMin+=mins; n++;
    // stake exato
    var sk=stakeKey(t); (byStake[sk]||(byStake[sk]={k:sk,tables:0,fee:0,buyin:0,players:0,hands:0,bb:t.bb})).tables++;
    byStake[sk].fee+=fee; byStake[sk].buyin+=buyin; byStake[sk].players+=t.players||0; byStake[sk].hands+=hands;
    // fee rate nominal (configurado)
    var rr=t.feeRate||0; var rk=rr+'%'; (byRate[rk]||(byRate[rk]={k:rk,rate:rr,tables:0,fee:0,buyin:0,hands:0})).tables++;
    byRate[rk].fee+=fee; byRate[rk].buyin+=buyin; byRate[rk].hands+=hands;
    // tipo
    var ty=typeClean(t.type); (byType[ty]||(byType[ty]={k:ty,tables:0,fee:0,buyin:0,hands:0})).tables++;
    byType[ty].fee+=fee; byType[ty].buyin+=buyin; byType[ty].hands+=hands;
    // profundidade de stack (buy-in máx em BBs)
    var depth=t.bb?(t.bMax/t.bb):0; var db=depth<=40?'≤40 BB (curto)':depth<=100?'40–100 BB':depth<=200?'100–200 BB (deep)':'200 BB+ (muito deep)';
    (byDepth[db]||(byDepth[db]={k:db,ord:depth<=40?0:depth<=100?1:depth<=200?2:3,tables:0,fee:0,buyin:0})).tables++;
    byDepth[db].fee+=fee; byDepth[db].buyin+=buyin;
  });
  var takeRate=totBuyin?totFee/totBuyin*100:0;
  var feePerHand=totHands?totFee/totHands:0;
  var feePerHour=totMin?totFee/(totMin/60):0;
  var kc=function(l,v,s,c){ return '<div class="kpi'+(c?' '+c:'')+'"><div class="kl">'+l+'</div><div class="kv">'+v+'</div><div class="ks">'+(s||'')+'</div></div>'; };
  var kpis='<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">'
    +kc('Rake total','R$ '+brl(totFee),br(n)+' mesas cash','hero')
    +kc('Take rate',takeRate.toFixed(2)+'%','fee ÷ buy-in movimentado')
    +kc('Fee / mão','R$ '+brl(feePerHand,2),br(totHands)+' mãos')
    +kc('Fee / hora-mesa','R$ '+brl(feePerHour,0),'rake por hora de mesa aberta')
    +'</div>';
  // tabela por stake
  var stakes=Object.values(byStake).sort(function(a,b){return b.fee-a.fee;});
  var stakeTbl='<div class="card"><div class="ct">Rake por stake exato (SB/BB)</div><div class="cs">Onde está o núcleo de receita — stake real, não só o BB</div>'
    +'<div class="tw"><table class="t"><thead><tr><th>Stake</th><th class="r">Mesas</th><th class="r">Jogadores</th><th class="r">Rake</th><th class="r">% do rake</th><th class="r">Fee/mesa</th></tr></thead><tbody>'
    +stakes.map(function(s){return '<tr><td class="b m">'+esc(s.k)+'</td><td class="r m">'+br(s.tables)+'</td><td class="r m">'+br(s.players)+'</td><td class="r b">R$ '+brl(s.fee)+'</td><td class="r m">'+pct(s.fee,totFee).toFixed(1)+'%</td><td class="r m">R$ '+brl(s.fee/s.tables)+'</td></tr>';}).join('')
    +'</tbody></table></div></div>';
  // fee rate nominal — detecta configuração/vazamento
  var rates=Object.values(byRate).sort(function(a,b){return a.rate-b.rate;});
  var maxRateFee=Math.max.apply(null,rates.map(function(r){return r.fee;}).concat([1]));
  var rateCard='<div class="card"><div class="ct">Rake configurado (Fee Rate nominal)</div><div class="cs">% de rake que cada mesa foi setada — mesas em 0% ou baixo são vazamento controlável</div><div style="margin-top:10px">'
    +rates.map(function(r){ var eff=r.buyin?r.fee/r.buyin*100:0; return barRow(r.k+' nominal', r.fee, maxRateFee, br(r.tables)+' mesas · R$ '+brl(r.fee)+' · efetivo '+eff.toFixed(2)+'%', r.rate<=0?'#ef4444':(r.rate<3?'#f59e0b':'var(--gold)')); }).join('')
    +'</div></div>';
  // tipo
  var types=Object.values(byType).sort(function(a,b){return b.fee-a.fee;}); var maxTyFee=Math.max.apply(null,types.map(function(t){return t.fee;}).concat([1]));
  var typeCard='<div class="card"><div class="ct">Rake por tipo de jogo</div><div style="margin-top:10px">'
    +types.map(function(t){return barRow(t.k,t.fee,maxTyFee,br(t.tables)+' mesas · R$ '+brl(t.fee));}).join('')+'</div></div>';
  // profundidade
  var depths=Object.values(byDepth).sort(function(a,b){return a.ord-b.ord;}); var maxDep=Math.max.apply(null,depths.map(function(d){return d.fee;}).concat([1]));
  var depthCard='<div class="card"><div class="ct">Profundidade de stack (buy-in máx em BBs)</div><div class="cs">Deep gera pote maior → mais rake por mesa</div><div style="margin-top:10px">'
    +depths.map(function(d){return barRow(d.k,d.fee,maxDep,br(d.tables)+' mesas · R$ '+brl(d.fee)+' · R$ '+brl(d.fee/d.tables)+'/mesa');}).join('')+'</div></div>';
  host.innerHTML=kpis+stakeTbl+'<div class="g2" style="margin-top:12px">'+rateCard+typeCard+'</div>'+'<div style="margin-top:12px">'+depthCard+'</div>';
}

// ══════════════════════════════ TENDÊNCIAS MULTI-SEMANA + RETENÇÃO ═════════
// Digest compacto de uma semana (métricas + conjunto de IDs p/ retenção). Sem nomes.
// Fonte única: CashStore.buildDigest (a mesma forma que é publicada). Fallback inline
// só se o CashStore não tiver carregado.
function weekDigest(roster){
  if(window.CashStore && CashStore.buildDigest) return CashStore.buildDigest(roster);
  var T=Object.values(roster.tables||{}); var fee=0,buyin=0,seats=0,hands=0, net={}, pf={};
  for(var i=0;i<T.length;i++){ var t=T[i]; fee+=t.fee||0; buyin+=t.buyin||0; hands+=t.hands||0;
    var ro=t.roster||[]; for(var j=0;j<ro.length;j++){ var s=ro[j]; seats++; var id=+s.id; net[id]=(net[id]||0)+(s.w||0); pf[id]=(pf[id]||0)+(s.fee||0); } }
  var ids=Object.keys(net).map(Number); var winners=0,losers=0,netTot=0, netArr=[], feeArr=[];
  for(var k=0;k<ids.length;k++){ var v=net[ids[k]]; netTot+=v; if(v>0.001)winners++; else if(v<-0.001)losers++; netArr.push(Math.round(v)); feeArr.push(Math.round(pf[ids[k]]||0)); }
  return { key:weekKeyOf(roster), week:(roster.meta&&roster.meta.week)||weekKeyOf(roster),
    rake:fee, buyin:buyin, seats:seats, hands:hands, tables:T.length, players:ids.length,
    winners:winners, losers:losers, netTot:netTot, takeRate:buyin?fee/buyin*100:0, ids:ids, net:netArr, fee:feeArr };
}
function weekKeyOf(roster){ return (window.CashStore&&CashStore.weekKey)?CashStore.weekKey(roster.meta):((roster.meta&&roster.meta.week)||'semana'); }
// fração (%) do rake vinda do top-`frac` dos jogadores (feeArr = fees por jogador do digest)
function topShare(feeArr, frac){ if(!feeArr||!feeArr.length)return 0;
  var arr=feeArr.slice().sort(function(a,b){return b-a;}); var tot=0; for(var i=0;i<arr.length;i++)tot+=arr[i];
  if(tot<=0)return 0; var k=Math.max(1,Math.ceil(arr.length*frac)); var s=0; for(var j=0;j<k;j++)s+=arr[j];
  return s/tot*100; }

// gráfico de linha SVG (uma série, uma escala — regra dataviz). pts=[{x:label,y:num}]
function svgLine(pts, opts){
  opts=opts||{}; var w=opts.w||520, h=opts.h||150, pad=28, color=opts.color||'var(--gold)';
  if(!pts.length) return '<div style="color:var(--ink3);font-size:11px;padding:16px">sem dados</div>';
  var ys=pts.map(function(p){return p.y;}); var mn=Math.min.apply(null,ys), mx=Math.max.apply(null,ys);
  if(opts.zero)mn=Math.min(0,mn); if(mx===mn)mx=mn+1;
  var X=function(i){ return pad + (pts.length<=1? (w-2*pad)/2 : i*(w-2*pad)/(pts.length-1)); };
  var Y=function(v){ return h-pad - (v-mn)/(mx-mn)*(h-2*pad); };
  var d=pts.map(function(p,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(p.y).toFixed(1);}).join(' ');
  var area='M'+X(0)+' '+(h-pad)+' '+pts.map(function(p,i){return 'L'+X(i).toFixed(1)+' '+Y(p.y).toFixed(1);}).join(' ')+' L'+X(pts.length-1)+' '+(h-pad)+' Z';
  var dots=pts.map(function(p,i){return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="4" fill="'+color+'"></circle>';}).join('');
  // alvo de hover invisível bem maior que o marcador (regra dataviz) — segura o tooltip
  var hit=pts.map(function(p,i){return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="12" fill="transparent" style="cursor:pointer"><title>'+esc(String(p.x).slice(0,10))+': '+esc(opts.fmt?opts.fmt(p.y):p.y)+'</title></circle>';}).join('');
  var labels=pts.map(function(p,i){return '<text x="'+X(i).toFixed(1)+'" y="'+(h-8)+'" text-anchor="middle" font-size="9" fill="var(--ink3)">'+esc(String(p.x).slice(5))+'</text>';}).join('');
  var yTop='<text x="4" y="'+(pad-6)+'" font-size="9" fill="var(--ink3)">'+esc(opts.fmt?opts.fmt(mx):mx)+'</text>';
  var yBot='<text x="4" y="'+(h-pad+3)+'" font-size="9" fill="var(--ink3)">'+esc(opts.fmt?opts.fmt(mn):mn)+'</text>';
  return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;height:auto;overflow:visible">'
    +'<path d="'+area+'" fill="'+color+'" opacity="0.10"/>'
    +'<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    +dots+hit+labels+yTop+yBot+'</svg>';
}

var _digests=null;
// ESCALA: online, os gráficos saem só do índice RTDB (escalares já baixados no
// listWeeks — download ZERO de roster). A retenção precisa dos IDs por semana →
// baixa só os arquivos digest (leves, cache-first), NUNCA o roster inteiro. Isso
// deixa o custo O(nº de semanas × poucos KB) em vez de O(semanas × roster cheio).
function renderTendencias(){
  var host=el('mtrendBody'); if(!host)return;
  host.innerHTML='<div class="card" style="text-align:center;padding:32px;color:var(--ink3)">Carregando semanas publicadas…</div>';
  var online = !!(window.CashStore&&CashStore.available&&CashStore.available());
  if(online){
    // 1) índice → escalares → desenha os gráficos JÁ (sem baixar nenhum roster)
    CashStore.listWeeks().then(function(list){
      list=(list||[]).filter(function(w){return w&&w.key;});
      if(!list.length){ host.innerHTML=emptyRoster(); return; }
      _digests = list.map(function(w){ return {
        key:w.key, week:w.week||w.key, rake:+w.rake||0, buyin:+w.buyin||0, seats:+w.seats||0,
        hands:+w.hands||0, tables:+w.tables||0, players:+w.players||0, winners:+w.winners||0,
        losers:+w.losers||0, netTot:+w.netTot||0, takeRate:+w.takeRate||0, ids:null, net:null, fee:null };
      }).sort(function(a,b){return String(a.key).localeCompare(String(b.key));});
      drawTendencias();
      // 2) retenção/concentração: busca só os digests (ids/net/fee), cache-first, e redesenha
      Promise.all(_digests.map(function(d){
        return CashStore.loadDigest(d.key).then(function(g){ d.ids=g.ids||[]; d.net=g.net||[]; d.fee=g.fee||[]; }).catch(function(){ /* sem digest p/ essa semana */ });
      })).then(function(){ drawTendencias(); });
    }).catch(function(e){ host.innerHTML='<div class="card" style="padding:24px;color:var(--ink3)">Erro ao carregar semanas: '+esc(e.message)+'</div>'; });
    return;
  }
  // offline (1 dispositivo, poucas semanas): cai no cache local — carrega os blobs
  var getKeys = window.CashStore?CashStore.listLocal():Promise.resolve([]);
  getKeys.then(function(keys){
    keys=(keys||[]).filter(Boolean);
    if(!keys.length){ host.innerHTML=emptyRoster(); return; }
    return Promise.all(keys.map(function(k){ return CashStore.loadLocal(k).then(function(r){return weekDigest(r);}).catch(function(){return null;}); }))
      .then(function(ds){ _digests=ds.filter(Boolean).sort(function(a,b){return String(a.key).localeCompare(String(b.key));}); drawTendencias(); });
  }).catch(function(e){ host.innerHTML='<div class="card" style="padding:24px;color:var(--ink3)">Erro ao carregar semanas: '+esc(e.message)+'</div>'; });
}
// ── delta chip (variação vs semana anterior) — dataviz: mudança-no-tempo como
// headline (stat tile), SEMPRE com seta (não cor sozinha). goodUp=true p/ todas
// as métricas aqui (rake/jogadores/take/assentos: subir é bom pra operação).
function deltaChip(cur, prev, mode){
  var up, txt;
  if(mode==='pp'){ var d=cur-prev; up=d>0.005?1:(d<-0.005?-1:0); txt=(d>=0?'+':'−')+Math.abs(d).toFixed(2)+' pp'; }
  else { if(!prev){ return '<span style="font-size:10.5px;color:var(--ink3)">novo</span>'; }
    var p=(cur-prev)/Math.abs(prev)*100; up=p>0.05?1:(p<-0.05?-1:0); txt=(p>=0?'+':'−')+Math.abs(p).toFixed(1)+'%'; }
  var col=up>0?'#22c55e':(up<0?'#ef4444':'var(--ink3)');
  var arrow=up>0?'▲':(up<0?'▼':'▬');
  return '<span style="font-size:11px;font-weight:800;color:'+col+'">'+arrow+' '+txt+'</span>';
}
// card "semana atual vs anterior" — stat tiles com delta (forma certa p/ comparar 2 pontos)
function weekDeltaCard(prev, last, ret){
  var tile=function(l, val, chip, sub){ return '<div class="kpi"><div class="kl">'+l+'</div><div class="kv">'+val+'</div><div class="ks">'+chip+(sub?' · '+sub:'')+'</div></div>'; };
  var tiles=''
    + tile('Rake', 'R$ '+brl(last.rake), deltaChip(last.rake, prev.rake, 'pct'), 'antes R$ '+brl(prev.rake))
    + tile('Jogadores únicos', br(last.players), deltaChip(last.players, prev.players, 'pct'), 'antes '+br(prev.players))
    + tile('Take rate', last.takeRate.toFixed(2)+'%', deltaChip(last.takeRate, prev.takeRate, 'pp'), 'antes '+prev.takeRate.toFixed(2)+'%')
    + tile('Assentos', br(last.seats), deltaChip(last.seats, prev.seats, 'pct'), 'antes '+br(prev.seats));
  if(ret){
    tiles += tile('Retenção', ret.retPct.toFixed(1)+'%', '<span style="font-size:10.5px;color:var(--ink3)">'+br(ret.returning)+' voltaram · '+br(ret.churn)+' saíram</span>', br(ret.newP)+' novos');
    tiles += tile('Retenção de fish', ret.fishRetPct.toFixed(1)+'%', '<span style="font-size:10.5px;color:#22c55e">recreativos que voltaram</span>', 'liquidez sustentável');
  }
  return '<div class="card" style="margin-bottom:12px"><div class="ct">Semana atual vs anterior</div>'
    +'<div class="cs">'+esc(String(last.week))+' comparada com '+esc(String(prev.week))+'</div>'
    +'<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-top:8px">'+tiles+'</div></div>';
}
function drawTendencias(){
  var host=el('mtrendBody'); var D=_digests||[];
  if(!D.length){ host.innerHTML=emptyRoster(); return; }
  var last=D[D.length-1];
  if(D.length<2){
    host.innerHTML='<div class="card" style="margin-bottom:12px"><div class="ct">1 semana publicada</div><div class="cs">Tendências e retenção comparam semana a semana. Publique <b>pelo menos 2 semanas</b> pra ativar. Abaixo, o retrato da semana atual.</div></div>'
      + snapshotCard(last);
    return;
  }
  // tendências (small multiples, uma escala cada — regra dataviz)
  var pR=D.map(function(d){return {x:d.key,y:Math.round(d.rake*GU_TO_BRL)};});
  var pP=D.map(function(d){return {x:d.key,y:d.players};});
  var pT=D.map(function(d){return {x:d.key,y:+d.takeRate.toFixed(2)};});
  // saúde do ecossistema: % que perde (fish) — dos escalares, sempre disponível
  var pF=D.map(function(d){return {x:d.key,y:d.players?+(d.losers/d.players*100).toFixed(1):0};});
  // concentração: fração do rake vinda do top-1% dos jogadores — precisa dos fees do digest
  var haveFee=D.every(function(d){return d.fee&&d.fee.length;});
  var pC=haveFee?D.map(function(d){return {x:d.key,y:+topShare(d.fee,0.01).toFixed(1)};}):null;
  var trends='<div class="card"><div class="ct">Tendências por semana</div><div class="cs">Cada gráfico tem UMA escala (comparável de verdade)</div>'
    +'<div class="g2" style="margin-top:10px">'
    +'<div><div style="font-size:11px;font-weight:700;margin-bottom:4px">Rake (R$)</div>'+svgLine(pR,{color:'var(--gold)',zero:true,fmt:function(v){return 'R$ '+fmtK(v);}})+'</div>'
    +'<div><div style="font-size:11px;font-weight:700;margin-bottom:4px">Jogadores únicos</div>'+svgLine(pP,{color:'#4e79a7',zero:true,fmt:function(v){return br(v);}})+'</div>'
    +'</div>'
    +'<div class="g2" style="margin-top:10px">'
    +'<div><div style="font-size:11px;font-weight:700;margin-bottom:4px">Take rate (%)</div>'+svgLine(pT,{color:'#59a14f',fmt:function(v){return v+'%';}})+'</div>'
    +'<div><div style="font-size:11px;font-weight:700;margin-bottom:4px">Perdedores / recreativos (%)</div>'+svgLine(pF,{color:'#f28e2b',zero:true,fmt:function(v){return v+'%';}})+'</div>'
    +'</div>'
    +(pC?'<div style="margin-top:10px"><div style="font-size:11px;font-weight:700;margin-bottom:4px">Concentração de rake — top 1% dos jogadores (%)</div>'
       +'<div style="font-size:10px;color:var(--ink3);margin-bottom:2px">Subindo = receita mais dependente de poucos = mais frágil</div>'
       +svgLine(pC,{color:'#b07aa1',zero:true,fmt:function(v){return v+'%';}})+'</div>':'')
    +'</div>';
  // retenção semana a semana — só pares onde os IDs (digest) já chegaram
  var ret=[]; for(var i=1;i<D.length;i++){ if(D[i-1].ids&&D[i].ids) ret.push(retentionBetween(D[i-1],D[i])); }
  var pending=D.some(function(d){return d.ids==null;});
  var retCard;
  if(!ret.length){
    retCard='<div class="card"><div class="ct">Retenção semana a semana</div><div class="cs">'
      +(pending?'Carregando os resumos das semanas…':'Sem resumo (digest) publicado ainda p/ calcular retenção — republique as semanas pra ativar.')+'</div></div>';
  } else {
    var rowsRet=ret.map(function(r){ return '<tr><td class="b m">'+esc(r.to.slice(5))+'</td>'
      +'<td class="r m">'+br(r.returning)+'</td><td class="r m">'+r.retPct.toFixed(1)+'%</td>'
      +'<td class="r m" style="color:#22c55e">'+r.fishRetPct.toFixed(1)+'%</td>'
      +'<td class="r m" style="color:#4e79a7">'+br(r.newP)+'</td>'
      +'<td class="r m" style="color:#ef4444">'+br(r.churn)+'</td></tr>'; }).join('');
    retCard='<div class="card"><div class="ct">Retenção semana a semana</div><div class="cs">Recreativo (fish) que volta = liquidez sustentável. Churn alto de fish = alerta.'
      +(pending?' <span style="color:var(--ink3)">(carregando semanas restantes…)</span>':'')+'</div>'
      +'<div class="tw"><table class="t"><thead><tr><th>Semana</th><th class="r">Voltaram</th><th class="r">Retenção</th><th class="r">Retenção fish</th><th class="r">Novos</th><th class="r">Saíram</th></tr></thead><tbody>'+rowsRet+'</tbody></table></div>'
      +'<div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Fish = jogador com resultado líquido negativo na semana anterior. "Retenção fish" é a fração deles que jogou de novo.</div></div>';
  }
  // headline: semana atual vs anterior (usa a retenção prev→last se os IDs chegaram)
  var prev=D[D.length-2];
  var lastRet=(prev.ids&&last.ids)?retentionBetween(prev,last):null;
  var deltaCard=weekDeltaCard(prev,last,lastRet);
  var online=!!(window.CashStore&&CashStore.available&&CashStore.available());
  var toolbar=online?'<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px">'
    +'<button onclick="cashManageWeeks()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px" title="Ver/remover semanas publicadas (limpar órfãos)">☰ Semanas</button>'
    +'<button id="cashBackfillBtn" onclick="cashBackfill()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px" title="Regera os resumos (digest) de semanas antigas p/ retenção/perfil funcionarem retroativo">⟳ Regerar resumos das semanas</button></div>':'';
  host.innerHTML=toolbar+deltaCard+trends+'<div style="margin-top:12px">'+retCard+'</div>';
}
// gerenciar semanas publicadas (remover órfãos/rótulos errados)
window.cashManageWeeks=function(){
  var d=el('mxDrawer'); if(!d)return;
  d.innerHTML='<div class="mx-drawer-inner">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:14px;font-weight:800">Semanas publicadas</div>'
    +'<button onclick="cashMxClose()" style="background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">Fechar ✕</button></div>'
    +'<div style="font-size:11px;color:var(--ink3);margin-bottom:10px">Remover uma semana apaga o índice, o arquivo do Storage e o cache. Use p/ limpar órfãos (ex.: rótulo de data errado antes da correção).</div>'
    +'<div id="mwList">Carregando…</div></div>';
  d.classList.add('open'); document.body.style.overflow='hidden';
  cashRenderWeeksList();
};
function cashRenderWeeksList(){
  var host=el('mwList'); if(!host)return;
  var src=(window.CashStore&&CashStore.available&&CashStore.available())?CashStore.listWeeks():Promise.resolve([]);
  src.then(function(list){
    list=list||[];
    if(!list.length){ host.innerHTML='<div style="color:var(--ink3);padding:16px">Nenhuma semana publicada.</div>'; return; }
    host.innerHTML=list.map(function(w){ return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--bdr);border-radius:8px;padding:8px 12px;margin-bottom:6px">'
      +'<div style="min-width:0"><b>'+esc(w.week||w.key)+'</b><div style="font-size:10.5px;color:var(--ink3)">chave '+esc(w.key)+' · '+(w.seats||0).toLocaleString('pt-BR')+' assentos'+(w.by?' · '+esc(w.by):'')+'</div></div>'
      +'<button onclick="cashRemoveWeek(\''+esc(w.key)+'\')" style="background:none;border:1px solid #ef4444;border-radius:8px;color:#ef4444;height:30px;padding:0 12px;cursor:pointer;font-size:12px;white-space:nowrap">✕ Remover</button></div>'; }).join('');
  }).catch(function(e){ host.innerHTML='<div style="color:#ef4444;padding:16px">Erro: '+esc(e.message)+'</div>'; });
}
window.cashRemoveWeek=function(key){
  if(!(window.CashStore&&CashStore.removeWeek)){ alert('Indisponível.'); return; }
  if(!confirm('Remover a semana "'+key+'"?\nApaga índice, arquivo do Storage e cache. Não dá pra desfazer.'))return;
  CashStore.removeWeek(key).then(function(){
    if(window.cashInvalidateDigests)cashInvalidateDigests();
    cashRenderWeeksList(); refreshWeeks(); if(el('mtrendBody'))renderTendencias();
  }).catch(function(e){ alert('Falha ao remover: '+((e&&e.message)||e)); });
};
// backfill: regera os digests de semanas publicadas antes da camada de digest
window.cashBackfill=function(){
  if(!(window.CashStore&&CashStore.backfillDigests&&CashStore.available&&CashStore.available())){ alert('Regerar resumos precisa do Firebase conectado.'); return; }
  var btn=el('cashBackfillBtn'); if(btn){ btn.disabled=true; btn.textContent='Regerando…'; }
  CashStore.backfillDigests(function(m){ if(btn)btn.textContent=m; }).then(function(r){
    if(window.cashInvalidateDigests)cashInvalidateDigests();
    renderTendencias();
    alert('Resumos regenerados: '+(r.done||0)+'/'+(r.total||0)+' semana(s).');
  }).catch(function(e){ if(btn){btn.disabled=false;btn.textContent='⟳ Regerar resumos das semanas';} alert('Falha ao regerar: '+((e&&e.message)||e)); });
};
// retenção via CONJUNTOS de IDs (leve): a=semana anterior, b=atual. fish = IDs
// que perderam na semana anterior (a.net[i]<0, paralelo a a.ids).
function retentionBetween(a,b){
  var prev=a.ids||[], aNet=a.net||[], curSet={}; var cur=b.ids||[];
  for(var c=0;c<cur.length;c++)curSet[cur[c]]=1;
  var prevSet={}; for(var p=0;p<prev.length;p++)prevSet[prev[p]]=1;
  var returning=0, fishPrev=0, fishBack=0;
  for(var i=0;i<prev.length;i++){ var back=curSet[prev[i]]; if(back)returning++;
    if((aNet[i]||0)<0){ fishPrev++; if(back)fishBack++; } }
  var newP=0; for(var j=0;j<cur.length;j++){ if(!prevSet[cur[j]])newP++; }
  return { to:b.key, returning:returning, retPct:prev.length?returning/prev.length*100:0,
    fishRetPct:fishPrev?fishBack/fishPrev*100:0, newP:newP, churn:prev.length-returning };
}
function snapshotCard(d){
  var kc=function(l,v,s,c){ return '<div class="kpi'+(c?' '+c:'')+'"><div class="kl">'+l+'</div><div class="kv">'+v+'</div><div class="ks">'+(s||'')+'</div></div>'; };
  return '<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">'
    +kc('Semana',esc(String(d.week)),d.tables+' mesas','hero')
    +kc('Rake','R$ '+brl(d.rake),'take '+d.takeRate.toFixed(2)+'%')
    +kc('Jogadores',br(d.players),d.seats.toLocaleString('pt-BR')+' assentos')
    +kc('Perderam',br(d.losers),(d.players?d.losers/d.players*100:0).toFixed(0)+'%','c-green')
    +kc('Ganharam',br(d.winners),(d.players?d.winners/d.players*100:0).toFixed(0)+'%','c-amber')
    +'</div>';
}
function fmtK(v){ return Math.abs(v)>=1e6?br(v/1e6,1)+' mi':Math.abs(v)>=1e3?br(v/1e3,0)+' mil':br(Math.round(v)); }

// ══════════════════════════════ EXPORT XLSX ════════════════════════════════
function saveSheets(sheets, filename){
  var fn=window.ensureXLSX?window.ensureXLSX():Promise.reject(new Error('XLSX indisponível'));
  return fn.then(function(XLSX){
    var wb=XLSX.utils.book_new();
    sheets.forEach(function(s){ var ws=XLSX.utils.aoa_to_sheet(s.rows); XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0,31)); });
    XLSX.writeFile(wb, filename);
  }).catch(function(e){ alert('Falha ao exportar: '+e.message); });
}
window.cashExportTable=function(id){ var t=R&&R.tables[id]; if(!t)return;
  var rows=[['Jogador','ID','Clube','Agente','Buy-in (R$)','Resultado (R$)','Fee (R$)','Mãos','Ranking']];
  (t.roster||[]).slice().sort(function(a,b){return (b.w||0)-(a.w||0);}).forEach(function(s){ rows.push([s.n,s.id,s.club,s.ag,+(s.bi*GU_TO_BRL).toFixed(2),+(s.w*GU_TO_BRL).toFixed(2),+(s.fee*GU_TO_BRL).toFixed(2),s.h,s.rk]); });
  saveSheets([{name:'Mesa '+id,rows:rows}], 'mesa-'+id+'.xlsx');
};
window.cashExportPlayer=function(id){ ensureAgg(); var p=PLAYERS.get(pid(id)); if(!p)return;
  var rows=[['Início','Mesa','ID Mesa','Tipo','Stake','Buy-in (R$)','Resultado (R$)','Fee (R$)','Mãos']];
  TABLES.forEach(function(t){ var ro=t.roster||[]; for(var i=0;i<ro.length;i++){ if(ro[i].id===p.id){ var s=ro[i]; rows.push([String(t.start||'').trim(),t.name,t.id,typeClean(t.type),stakeLabel(t),+(s.bi*GU_TO_BRL).toFixed(2),+(s.w*GU_TO_BRL).toFixed(2),+(s.fee*GU_TO_BRL).toFixed(2),s.h]); break; } } });
  saveSheets([{name:esc(p.name).slice(0,20)||('jogador '+p.id),rows:rows}], 'jogador-'+p.id+'.xlsx');
};
window.cashExportEco=function(){ ensureAgg(); var sg=segmentPlayers();
  var seg=[['Segmento','Jogadores','Rake (R$)','Resultado líq. (R$)']];
  ['whale','rec','pro','reg'].forEach(function(k){ seg.push([k,sg.segs[k],+(sg.segFee[k]*GU_TO_BRL).toFixed(2),+(sg.segNet[k]*GU_TO_BRL).toFixed(2)]); });
  var pl=[['Jogador','ID','Clube','Agente','Segmento','Mesas','Mãos','Buy-in (R$)','Resultado (R$)','Rake gerado (R$)']];
  Array.from(PLAYERS.values()).sort(function(a,b){return b.fee-a.fee;}).forEach(function(p){ pl.push([p.name,p.id,p.club,p.ag,p.seg||'',p.tables,p.hands,+(p.buyin*GU_TO_BRL).toFixed(2),+(p.net*GU_TO_BRL).toFixed(2),+(p.fee*GU_TO_BRL).toFixed(2)]); });
  saveSheets([{name:'Segmentos',rows:seg},{name:'Jogadores',rows:pl}], 'ecologia-'+((R.meta&&R.meta.week)||'semana').replace(/[^\d]/g,'-')+'.xlsx');
};
window.cashExportCollusion=function(){ var f=buildCollusion();
  var rows=[['Ganhador','Clube ganhador','Perdedor','Clube perdedor','Partidas HU','Direção %','Transferido (R$)']];
  f.forEach(function(x){ rows.push([x.winner,x.winnerClub,x.loser,x.loserClub,x.games,+(x.dir*100).toFixed(0),+(x.transfer*GU_TO_BRL).toFixed(2)]); });
  saveSheets([{name:'Chip-dumping HU',rows:rows}], 'integridade-'+((R.meta&&R.meta.week)||'semana').replace(/[^\d]/g,'-')+'.xlsx');
};

// ── estados vazios ──────────────────────────────────────────────────────────
function emptyRoster(){ return '<div class="card" style="text-align:center;padding:40px 16px">'
  +'<div style="font-size:26px;color:var(--ink3);margin-bottom:8px">🃏</div>'
  +'<div style="font-size:12px;color:var(--ink3);line-height:1.7;max-width:540px;margin:0 auto">'
    +'<b>Nenhuma semana carregada nesta sessão.</b><br>'
    +'Vá na aba <b>Mesas</b> e escolha uma <b>semana já publicada</b> no seletor — carrega na hora, sem subir nada.<br>'
    +'Só existe upload quando chega um relatório <b>novo</b> (aba Mesas → <b>Subir planilha .xlsx</b>). '
    +'Publicada uma vez, todos só escolhem no seletor — <b>ninguém sobe de novo</b>.'
  +'</div></div>'; }

// ══════════════════════════════ COMPARTILHAMENTO (Firebase Storage) ════════
// Após o ingest do xlsx, publica o roster pra todo mundo ver (se o Storage estiver ok).
window.cashOnIngest=function(res){
  var st=el('mxStatus');
  if(!window.CashStore || !CashStore.available() || !CashStore.gzipOk()){
    if(st)st.textContent+=' · (só nesta sessão — Storage indisponível p/ compartilhar)';
    return;
  }
  if(st)st.textContent+=' · publicando pra todos…';
  CashStore.publish(res.roster,{onProgress:function(m,p){ if(st)st.textContent='Compartilhando: '+m+' ('+p+'%)'; }})
    .then(function(key){ if(st)st.textContent='✓ Semana publicada ('+key+') — todos com acesso já veem.'; refreshWeeks(); })
    .catch(function(err){ if(st)st.textContent='Roster carregado nesta sessão. Falha ao publicar: '+err.message; console.error(err); });
};
// seletor de semanas (carrega do Storage/cache)
function refreshWeeks(){
  var sel=el('mxWeekPicker'); if(!sel || !window.CashStore) return;
  CashStore.listWeeks().then(function(list){
    if(!list.length){ sel.innerHTML='<option value="">— nenhuma semana publicada —</option>'; return; }
    sel.innerHTML='<option value="">Escolher semana publicada…</option>'+list.map(function(w){
      return '<option value="'+esc(w.key)+'">'+esc(w.week||w.key)+' · '+(w.seats||0).toLocaleString('pt-BR')+' assentos</option>'; }).join('');
  }).catch(function(){});
}
window.cashLoadWeek=function(key){
  if(!key||!window.CashStore)return; var st=el('mxStatus'); if(st)st.textContent='Carregando semana…';
  CashStore.load(key,{onProgress:function(m,p){ if(st)st.textContent=m+' ('+p+'%)'; }})
    .then(function(roster){ setRoster(roster); if(st)st.textContent='Semana carregada: '+TABLES.length+' mesas, '+(ECO?ECO.players.toLocaleString('pt-BR'):'?')+' jogadores.'; })
    .catch(function(err){ if(st)st.textContent='Erro ao carregar: '+err.message; });
};

// estados vazios ao abrir (antes de qualquer upload)
function init(){ if(el('mxList')&&!R){ renderMesasControls(); el('mxList').innerHTML=emptyRoster(); } if(el('mecoBody')&&!R)el('mecoBody').innerHTML=emptyRoster(); if(el('mrakeBody')&&!R)el('mrakeBody').innerHTML=emptyRoster(); if(el('mintBody')&&!R)el('mintBody').innerHTML=emptyRoster(); if(el('mpBody')&&!R)el('mpBody').innerHTML=playerPrompt();
  if(el('mtrendBody'))renderTendencias();
  // F5: restaura a última semana do cache local na hora (independe do Firebase)
  if(!R && window.CashStore && CashStore.restoreLast){
    CashStore.restoreLast().then(function(roster){ if(roster && !R){ setRoster(roster); var st=el('mxStatus'); if(st)st.textContent='Restaurado do cache local ('+TABLES.length+' mesas). Semanas publicadas aparecem no seletor.'; } }).catch(function(){});
  }
  // lista semanas publicadas (aguarda o SupremaDB conectar)
  var sel=el('mxWeekPicker');
  if(sel){ var tries=0; var t=setInterval(function(){ tries++;
    if(window.CashStore&&CashStore.available()){ clearInterval(t); refreshWeeks(); }
    else if(tries>20){ clearInterval(t); if(/carregando/.test(sel.textContent))sel.innerHTML='<option value="">— nenhuma semana publicada ainda —</option>'; }
  },500); } }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init); else init();

// expõe pra debug/dev
window.cashRefreshTrends=renderTendencias;
window.CashPlayers={ setRoster:setRoster, loadURL:window.cashRosterLoadURL, refreshTrends:renderTendencias, get:function(){return {R:R,ECO:ECO,PLAYERS:PLAYERS};} };
})();

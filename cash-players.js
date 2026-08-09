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

var GU_TO_BRL = 5;               // mesma régua do dashboard-mesa-cash.js
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
function fk(v){ v=(+v||0)*GU_TO_BRL; return Math.abs(v)>=1e6?(v/1e6).toFixed(2)+'M':Math.abs(v)>=1e3?(v/1e3).toFixed(1)+'k':Math.round(v); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function el(id){ return document.getElementById(id); }
function pct(a,b){ return b?(a/b*100):0; }
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
      // agente
      var ak=s.ag||'—', a=AGENTS.get(ak); if(!a){ a={name:ak,players:new Set(),seats:0,fee:0,net:0,buyin:0}; AGENTS.set(ak,a); }
      a.players.add(s.id); a.seats++; a.fee+=s.fee||0; a.net+=s.w||0; a.buyin+=s.bi||0;
      // clube
      var ck=s.club||'—', c=CLUBS.get(ck); if(!c){ c={name:ck,players:new Set(),seats:0,fee:0,net:0,buyin:0}; CLUBS.set(ck,c); }
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
    for(var k=0;k<ro.length;k++){ net+=ro[k].w||0; if(!big||ro[k].w>big.w)big=ro[k]; if(!small||ro[k].w<small.w)small=ro[k]; }
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
// entry-point ÚNICO: sobe o .xlsx completo (com Game Detail) → parse streaming → telas.
// onDone(result) recebe { roster, gameStats } p/ quem quiser alimentar a pipeline de agregados.
window.cashIngestFile=function(inp, onDone){
  var file=inp&&inp.files&&inp.files[0]; if(!file)return;
  var st=el('mxStatus')||el('validarStatus');
  var setSt=function(msg){ if(st)st.textContent=msg; };
  if(!window.CashIngest||!CashIngest.supported()){ setSt('Navegador sem suporte a leitura em streaming (use Chrome/Edge atualizado).'); return; }
  var bar=el('mxProgress'); var setBar=function(p){ if(bar)bar.style.width=(p||0)+'%'; };
  setSt('Lendo '+(file.name||'planilha')+' ('+(file.size/1e6|0)+' MB)…'); setBar(2);
  var onOk=function(res){
    setRoster(res.roster); setBar(100);
    setSt('Pronto: '+TABLES.length+' mesas, '+(ECO?ECO.players.toLocaleString('pt-BR'):'?')+' jogadores, '+(res.roster.meta.seats||0).toLocaleString('pt-BR')+' assentos.');
    // rede de segurança: salva local SEMPRE (sobrevive ao F5, mesmo sem Firebase)
    if(window.CashStore&&CashStore.cacheLocal){ CashStore.cacheLocal(res.roster).catch(function(e){console.warn('cacheLocal',e);}); }
    if(typeof onDone==='function'){ try{ onDone(res); }catch(e){ console.error('onDone',e); } }
  };
  var onErr=function(err){ setBar(0); setSt('Erro: '+((err&&err.message)||err)); console.error('cashIngest',err); };
  // Web Worker: parse em segundo plano → a interface NÃO congela. Fallback: thread principal.
  var useWorker=(typeof Worker==='function');
  if(useWorker){
    try{
      var w=new Worker('cash-ingest-worker.js');
      w.onmessage=function(ev){ var d=ev.data||{};
        if(d.type==='progress'){ setSt(d.m); setBar(d.p); }
        else if(d.type==='done'){ w.terminate(); onOk(d.res); }
        else if(d.type==='error'){ w.terminate(); onErr(new Error(d.msg)); }
      };
      w.onerror=function(e){ w.terminate(); console.warn('worker falhou, usando thread principal',e); mainThread(); };
      w.postMessage({file:file});
      return;
    }catch(e){ console.warn('sem worker, thread principal',e); }
  }
  mainThread();
  function mainThread(){
    CashIngest.parse(file,{onProgress:function(msg,pct){ setSt(msg); setBar(pct); }}).then(onOk).catch(onErr);
  }
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
  ensureAgg(); var p=PLAYERS.get(+id)||PLAYERS.get(id); var host=el('mpBody'); if(!p){host.innerHTML='<div style="padding:24px;color:var(--ink3)">Jogador não encontrado.</div>';return;}
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
    +'<div class="card" style="margin-top:12px"><div class="ct">Mesas jogadas ('+mine.length+')</div>'
    +'<div class="tw"><table class="t"><thead><tr><th>Início</th><th>Mesa</th><th>Tipo</th><th>Stake</th><th class="r">Buy-in</th><th class="r">Resultado</th><th class="r">Fee</th><th class="r">Mãos</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
};

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
      +'<button onclick="cashExportEco()" style="margin-top:8px;background:none;border:1px solid var(--bdr);border-radius:8px;color:var(--ink);height:30px;padding:0 12px;cursor:pointer;font-size:12px">⬇ Exportar ecologia (XLSX)</button></div></div>';
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
window.cashExportPlayer=function(id){ ensureAgg(); var p=PLAYERS.get(+id)||PLAYERS.get(id); if(!p)return;
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
window.CashPlayers={ setRoster:setRoster, loadURL:window.cashRosterLoadURL, get:function(){return {R:R,ECO:ECO,PLAYERS:PLAYERS};} };
})();

/* ══════════════════════════════════════════════════════════════
   SUPREMA POKER — Admin (standalone, premium rebuild)
══════════════════════════════════════════════════════════════ */

/* ── CONFIG ─────────────────────────────────────────────────── */
/* config do Firebase: fonte ÚNICA no suprema-db.js (SupremaDB.CONFIG) */
const ADMIN_EMAILS = [
  'brian@suprema.group','admin@suprema.group','brian.rodrigues@suprema.group'
];
const COL_HEADERS = ['Torneio','Hora','Late Reg.','Tipo','Garantido','Buy-in','Arrecadado','Overlay','Field','Ações','Perf. %','Fixou','ID','Status'];
const COL_WIDTHS  = [32,7,12,13,13,11,13,12,8,8,9,18,12,11];
const CAT_COLORS  = {
  main:{ header:'1A472A', sub:'2D6A4F', soft:'C8E6C9', label:'♠ MAIN EVENTS' },
  side:{ header:'1A3A5C', sub:'2E5984', soft:'BBDEFB', label:'♣ SIDE EVENTS' },
  sat: { header:'4A1A6B', sub:'6A2F9B', soft:'E1BEE7', label:'♦ SATÉLITES'   },
};

/* ── STATE ──────────────────────────────────────────────────── */
let db=null, fbOk=false;
let _email='', _name='';
let _allData={};   // { date: { rows:{}, fixed:{}, ids:{}, field:{} } }
let _dp=30, _gp=30;
let _dpFrom=null, _dpTo=null;   // range custom do dashboard (calendário) — vence o _dp quando setado
let _gradeRows=[];
let _auditRows=[];
let _toastTm;

/* ── UTILS ──────────────────────────────────────────────────── */
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/* ── modo escuro — compartilha a preferência com painel e criação ── */
function paintDarkBtn(){
  const b = document.getElementById('darkToggle');
  if(b) b.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
}
function toggleDark(){
  const on = document.documentElement.classList.toggle('dark');
  localStorage.setItem('suprema_dark_mode', on ? '1' : '0');
  paintDarkBtn();
}
paintDarkBtn();
// ecossistema: tema trocado em outro painel/aba reflete aqui na hora
window.addEventListener('storage', e => {
  if(e.key !== 'suprema_dark_mode' || e.newValue === null) return;
  document.documentElement.classList.toggle('dark', e.newValue === '1');
  paintDarkBtn();
});
const brl = (v,d=2) => v==null||isNaN(v)?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const brlk = v => { if(v==null||isNaN(v))return'—'; const a=Math.abs(v),s=v<0?'-':''; return a>=1e6?s+'R$'+brl(a/1e6,1)+'M':a>=1e3?s+'R$'+brl(a/1e3,0)+'K':s+'R$'+brl(a,0); };
const pct  = (v,d=2) => v==null?'—':(v>=0?'+':'')+Number(v).toFixed(d)+'%';

// ── TAXAS DA CASA (config, não mais chumbado) ────────────────────────────
// netFactor = fração da entrada que vira prize pool. A casa fica com (1−netFactor).
// Regra padrão: normal 10% rake · campanha (SPS) 10% rake + 2% admin ·
// satélite 5% rake (SPT entra aqui — é satélite, sem admin fee).
// Editável no card "Metas & taxas" → nó adminDashConfig.
const DASH_RATES_DEFAULT={normal:0.90, campanha:0.88, sat:0.95, adminPct:0.02};
let DASH_RATES={...DASH_RATES_DEFAULT};
const netFactorOf=(cat,isCamp)=> cat==='sat'?DASH_RATES.sat:(isCamp?DASH_RATES.campanha:DASH_RATES.normal);
/* ── RAKE DA GU ──
   FEE e ADMIN FEE são colunas da planilha da GU. O painel grava as duas em cada
   linha (row.fee / row.adminFee) e elas viajam pro Firebase, então o dashboard
   soma EXATAMENTE o que a GU cobrou — em vez de deduzir do nome, que errava
   freeroll (0%), high stakes (8%) e satélite fora do padrão.
   DASH_RATES virou REDE: só responde por linha sem essas colunas (histórico
   anterior à mudança). */
/* AUTOCONTIDA de propósito: campanha-admin-parity.test.js extrai esta função do
   TEXTO do admin.js e a roda isolada, provando que ela dá a mesma saída que a
   CampanhaCore.guRates. Se ela passar a depender de um helper de fora, o
   guarda-drift entre o dashboard e o telão para de funcionar. */
function guRatesOf(r){
  const frac = v => {
    const x = (typeof v === 'number') ? v : parseFloat(v);
    if (v == null || v === '' || !isFinite(x) || x < 0) return null;
    const f = x > 1 ? x / 100 : x;      // "10" digitado no lugar de 0,10
    return f >= 1 ? null : f;           // 100% de rake é erro de digitação
  };
  if (!r) return null;
  const fee = frac(r.fee);
  if (fee == null) return null;         // sem FEE não há dado da GU
  const admin = frac(r.adminFee) || 0;
  // arredonda o RUÍDO do float (0,10 + 0,02 = 0,12000000000000001)
  const total = Math.round((fee + admin) * 1e6) / 1e6;
  return total >= 1 ? null : { fee: fee, admin: admin, total: total };
}
// ── METAS DA DASHBOARD (rake/dia mínimo, overlay% máximo) → nó adminDashGoals ──
const DASH_GOALS_DEFAULT={rakeDia:0, overlayPct:5};
let DASH_GOALS={...DASH_GOALS_DEFAULT};
let _dashSettingsLoaded=false;
async function loadDashSettings(){
  try{ const lg=JSON.parse(localStorage.getItem('adminDashGoals')||'null'); if(lg)DASH_GOALS=Object.assign({},DASH_GOALS_DEFAULT,lg); }catch(_){}
  try{ const lc=JSON.parse(localStorage.getItem('adminDashConfig')||'null'); if(lc)DASH_RATES=Object.assign({},DASH_RATES_DEFAULT,lc); }catch(_){}
  if(typeof db!=='undefined' && db){
    try{
      const [g,c]=await Promise.all([
        db.ref('adminDashGoals').once('value').then(s=>s.val()),
        db.ref('adminDashConfig').once('value').then(s=>s.val()),
      ]);
      if(g)DASH_GOALS=Object.assign({},DASH_GOALS_DEFAULT,g);
      if(c)DASH_RATES=Object.assign({},DASH_RATES_DEFAULT,c);
    }catch(e){ console.error('loadDashSettings',e); }
  }
}
async function saveDashSettings(goalsPatch, ratesPatch){
  if(goalsPatch){ DASH_GOALS=Object.assign({},DASH_GOALS,goalsPatch); try{localStorage.setItem('adminDashGoals',JSON.stringify(DASH_GOALS));}catch(_){}
    if(db){ try{await db.ref('adminDashGoals').update(goalsPatch);}catch(e){console.error(e);} } }
  if(ratesPatch){ DASH_RATES=Object.assign({},DASH_RATES,ratesPatch); try{localStorage.setItem('adminDashConfig',JSON.stringify(DASH_RATES));}catch(_){}
    if(db){ try{await db.ref('adminDashConfig').update(ratesPatch);}catch(e){console.error(e);} } }
}

// ── CAMPANHAS (resultados por série) ─────────────────────────────────────
// Config vive em campanhas/<slug> (o MESMO nó que o telão lê — campanha.js).
// Cada campanha tem um PREFIXO (SPS, SPT…) que define quais eventos entram
// (nome começa com o prefixo). O FINANCEIRO por linha é da regra da casa, não
// da campanha: SPS = campanha (0,88 → 10% rake + 2% admin) · SPT = satélite
// (0,95 → 5% rake, SEM admin fee, como qualquer satélite). Ou seja, o SPT é
// tratado como campanha aqui, mas contabilizado como satélite.
// garantidoSerie = garantido planejado (não dá pra derivar dos dados; null =
// usa o já jogado). Meta (arrecadado) = garantido × (1+20%), regra do Brian.
const CAMP_DEFAULTS=[
  // "SPS … +SPT" É SPS (com admin fee) → entra normalmente no card SPS.
  { nome:'SPS', slug:'sps', prefix:'SPS', inicio:'2026-08-01', fim:'2026-09-20', meta:null, metaMetric:'arrecadado', garantidoSerie:100444500 },
  // SPT (Suprema Poker Tour) roda o ANO TODO — sem janela fixa (continuous).
  // match:'word' → casa "SPT" em qualquer posição (ex.: "3 Seats SPT", "4 Seats SPT").
  // notPattern → NÃO conta "+SPT" (crossover SPS que dá seat) — esse é SPS, não SPT.
  { nome:'SPT · Suprema Poker Tour', slug:'spt', prefix:'SPT', match:'word', notPattern:'\\+\\s*SPT\\b', inicio:null, fim:null, continuous:true, meta:null, metaMetric:'arrecadado', garantidoSerie:null, note:'Satélites puros do SPT · roda o ano todo · 5% rake · sem admin fee' },
];
const CAMP_BASE={ meta:null, metaMetric:'arrecadado', garantidoSerie:null };   // defaults p/ config vinda do Firebase
const CAMP_META_MARGIN=0.20;
let _campaigns=[];                    // configs carregadas de campanhas/*
// O dashboard só carrega 60 dias em _allData (egress). Mas campanhas contínuas
// (SPT roda o ano todo) precisam do HISTÓRICO INTEIRO. _campAllData guarda esse
// histórico completo (snapshots + painel do 1º dia do Suprema OS até hoje),
// carregado UMA vez por sessão e montado com o MESMO motor do telão
// (CampanhaCore.mergeDayInto). A seção de campanhas usa _campAllData quando
// pronto; enquanto isso, cai no _allData (60d) pra pintar rápido.
let _campAllData=null, _campDataLoading=false, _campDataTried=false;
async function loadCampaignData(){
  if(_campAllData || _campDataLoading) return _campAllData;
  _campDataTried=true;   // marca a tentativa ANTES dos guards: nunca re-dispara em loop, mesmo em falha
  if(typeof db==='undefined' || !db || typeof CampanhaCore==='undefined') return null;
  _campDataLoading=true;
  try{
    // + auditoria INTEIRA: a seção aplica enrichWithAudit (igual à aba Auditoria),
    //   então precisa do nó auditoria carregado. Só carrega se ainda não veio
    //   (não clobbera edições feitas nesta sessão pela aba Auditoria).
    const needAudit = !_auditData || Object.keys(_auditData).length===0;
    const [s,p,au]=await Promise.all([
      db.ref('snapshots').once('value').then(x=>x.val()||{}),   // 1º dia → hoje (sem startAt)
      db.ref('painel').once('value').then(x=>x.val()||{}),
      needAudit ? db.ref('auditoria').once('value').then(x=>x.val()||{}) : Promise.resolve(null),
    ]);
    if(au && needAudit) _auditData = au;
    const isDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d);
    const dates={};
    Object.keys(s).forEach(d=>{ if(isDate(d)) dates[d]=1; });
    Object.keys(p).forEach(d=>{ if(isDate(d)) dates[d]=1; });
    const allData={};
    Object.keys(dates).forEach(d=> CampanhaCore.mergeDayInto(allData, d, s[d]||null, p[d]||null));
    _campAllData=allData;
  }catch(e){ console.error('loadCampaignData',e); }
  finally{ _campDataLoading=false; }
  return _campAllData;
}
async function loadCampaigns(){
  // Começa SEMPRE com SPS + SPT (defaults). O Firebase (campanhas/<slug>)
  // SOBRESCREVE janela/garantido dessas e pode ADICIONAR outras campanhas.
  // Assim o SPT aparece como campanha mesmo sem config, e o Brian ajusta depois.
  const bySlug={};
  CAMP_DEFAULTS.forEach(d=>{ bySlug[d.slug]=Object.assign({},d); });
  try{
    if(typeof db!=='undefined' && db){
      const val=await db.ref('campanhas').once('value').then(s=>s.val());
      if(val && typeof val==='object'){
        Object.keys(val).forEach(slug=>{ const c=val[slug]; if(!c || typeof c!=='object') return;
          const base=bySlug[slug]||Object.assign({},CAMP_BASE);
          const merged=Object.assign({},base,c,{slug});
          if(!merged.prefix) merged.prefix=String(merged.nome||slug||'').trim().split(/\s+/)[0].toUpperCase();
          bySlug[slug]=merged;
        });
      }
    }
  }catch(e){ console.error('loadCampaigns',e); }
  const list=Object.keys(bySlug).map(k=>bySlug[k]);
  // ordena por início (mais recente primeiro), depois slug pra estabilidade
  list.sort((a,b)=>String(b.inicio||'').localeCompare(String(a.inicio||''))||String(a.slug).localeCompare(String(b.slug)));
  _campaigns=list;
}
// Parse valor em formato pt-BR ("400.708,00" ou "308500") → número (400708)
const parseBRL = raw => {
  const s = String(raw??'').trim().replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.');
  if(s==='') return NaN;
  return parseFloat(s);
};
// oninput: mantém só dígitos, ponto e vírgula enquanto digita
const maskBRL = el => { el.value = el.value.replace(/[^\d.,]/g,''); };
// onblur: normaliza para exibição pt-BR (ex: "400708" → "400.708,00")
const fmtBRLInput = el => { const v = parseBRL(el.value); el.value = isNaN(v) ? '' : brl(v,2); };
const nowSP = () => { const d=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dago  = n => { const d=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})); d.setDate(d.getDate()-n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const eKey  = e => e.toLowerCase().replace(/\./g,'_dot_').replace(/@/g,'_at_');
const fmtDate = d => { const [y,m,dd]=d.split('-'); return `${dd}/${m}/${y}`; };

function toast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='show'+(type?' '+type:'');
  clearTimeout(_toastTm); _toastTm=setTimeout(()=>{t.className=''},3500);
}

function classify(r){
  const n=(r.nome||'').toLowerCase();
  const t=(r.tipo||'').toLowerCase();
  if(t.includes('main'))return'main';
  if(t.includes('side'))return'side';
  if(t.includes('sat'))return'sat';
  if(n.includes('seat')||n.includes('satelit')||n.includes('satélite'))return'sat';
  // Satélite puro do SPT ("N Seats SPT") = satélite. Mas "+SPT" é um CROSSOVER:
  // evento SPS que também dá seat de SPT — esse é SPS (main/side, COM admin fee),
  // NÃO satélite. Por isso o /\bspt\b/ exclui o "+SPT".
  if(/\bspt\b/.test(n) && !/\+\s*spt\b/.test(n))return'sat';
  if((r.garantido||0)>=20000)return'main';
  return'side';
}

// Badge do TIMING da fixação (cedo / no prazo / atrasado) pra pontuar o operador.
// fixLeadMin = min antes do início; regra vem do flatRows (prazo = início − lead).
function fixTimingBadge(r){
  if(!r.fixTiming || !Number.isFinite(r.fixLeadMin)) return '';
  const m = r.fixLeadMin;
  const ante = m < 0 ? `${Math.abs(m)}min após início`
             : m >= 120 ? `${(m/60).toFixed(1).replace('.',',')}h antes`
             : `${m}min antes`;
  const map = { ok:['var(--green)','no prazo'], atrasado:['var(--red)','atrasado'], cedo:['#3b82f6','cedo demais'] };
  const [c,lbl] = map[r.fixTiming] || ['var(--ink3)',''];
  return `<span class="fix-timing ${r.fixTiming}" style="display:block;font-size:9px;font-weight:700;color:${c}" title="Fixou ${ante} do início — ${lbl}">${ante} · ${lbl}</span>`;
}

function catBadge(cat){
  const m={main:'<span class="badge badge-main">♠ Main</span>',
           side:'<span class="badge badge-side">♣ Side</span>',
           sat:'<span class="badge badge-sat">♦ Sat</span>'};
  return m[cat]||'—';
}

/* ── LABELS / ORDENAÇÃO COMPARTILHADOS ───────────────────────── */
const CAT_LABEL    = {main:'Main Event', side:'Side Event', sat:'Satélite'};
const catLabel     = c => CAT_LABEL[c] || c || '';
const STATUS_LABEL = {fechado:'Fechado', nf:'Não formou', aberto:'Aberto'};
const statusLabel  = s => STATUS_LABEL[s] || s || '';
const statusBadge  = s => s==='fechado' ? '<span class="badge badge-closed">Fechado</span>'
                        : s==='nf'      ? '<span class="badge badge-nf">NF</span>'
                        :                 '<span class="badge badge-open">Aberto</span>';
// Ordena torneios pela hora tratando o "dia da grade" (vira às 05:30): horários antes
// das 05:00 pertencem à madrugada do dia seguinte e vão para o fim da lista.
const DAY_START  = 5*60;
const sortByTime = arr => [...arr].sort((a,b)=>{
  const ma=timeMin(a.hora)??9999, mb=timeMin(b.hora)??9999;
  return (ma>=DAY_START?ma:ma+1440)-(mb>=DAY_START?mb:mb+1440);
});
// Side Events: ordem de relógio pura (00:00→23:59), igual à agenda do painel —
// sem a rotação do "dia da grade" (que empurrava a madrugada pro fim e fazia a
// lista parecer que começava às 05:00)
const sortByClock = arr => [...arr].sort((a,b)=>(timeMin(a.hora)??9999)-(timeMin(b.hora)??9999));

/* ── HASH DE SENHA ──────────────────────────────────────────────
   PBKDF2-SHA256 (Web Crypto), salt aleatório por usuário.
   Mantém compat com o hash legado (DJB2+salt fixo, "h2_...") apenas
   para permitir migração transparente no login — nunca para novas contas.
   IMPORTANTE: a mesma lógica precisa existir em index.html (ver hashPassword). */
const PBKDF2_ITER = 150000;
function bufToHex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hexToBytes(hex){
  const bytes = new Uint8Array(hex.length / 2);
  for(let i=0;i<bytes.length;i++) bytes[i] = parseInt(hex.substr(i*2,2), 16);
  return bytes;
}
async function pbkdf2Hash(pw, saltHex){
  saltHex = saltHex || bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:hexToBytes(saltHex), iterations:PBKDF2_ITER, hash:'SHA-256'}, keyMat, 256);
  return `pbkdf2v2$${PBKDF2_ITER}$${saltHex}$${bufToHex(bits)}`;
}
/* formato antigo: o salt era codificado como texto UTF-8 do próprio hex em vez de decodificado
   pros bytes originais — reduzia a entropia efetiva do salt. Mantido só pra verificar/migrar
   hashes já salvos no Firebase; nenhuma conta nova volta a usar isso. */
async function pbkdf2HashLegacySalt(pw, saltHex){
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:enc.encode(saltHex), iterations:PBKDF2_ITER, hash:'SHA-256'}, keyMat, 256);
  return `pbkdf2$${PBKDF2_ITER}$${saltHex}$${bufToHex(bits)}`;
}
function legacyHash(s){
  let h=5381;
  for(let i=0;i<s.length;i++){h=((h<<5)+h)^s.charCodeAt(i);h|=0;}
  const salt='suprema2024';let h2=h;
  for(let i=0;i<salt.length;i++){h2=((h2<<5)+h2)^salt.charCodeAt(i);h2|=0;}
  return 'h2_'+Math.abs(h).toString(36)+'_'+Math.abs(h2).toString(36);
}
// Compat com chamadas antigas (hashStr) usadas na criação de conta — sempre gera hash novo.
async function hashStr(s){ return pbkdf2Hash(s); }
// Verifica senha contra hash salvo, migrando hash legado (DJB2 ou salt mal-codificado) pro formato atual.
async function verifyPassword(pw, storedHash, onMigrate){
  if(!storedHash) return true; // conta sem senha definida ainda
  if(storedHash.startsWith('pbkdf2v2$')){
    const [,,saltHex] = storedHash.split('$');
    return (await pbkdf2Hash(pw, saltHex)) === storedHash;
  }
  if(storedHash.startsWith('pbkdf2$')){
    const [,,saltHex] = storedHash.split('$');
    const ok = (await pbkdf2HashLegacySalt(pw, saltHex)) === storedHash;
    if(ok && onMigrate) onMigrate(await pbkdf2Hash(pw));
    return ok;
  }
  // conta importada manualmente no Firebase com SHA-256 puro (64 hex, sem prefixo) — sem esse
  // caso o login recusava a senha CERTA pra sempre; migra pro pbkdf2 no primeiro login que passar
  if(/^[0-9a-f]{64}$/i.test(storedHash)){
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    const ok = bufToHex(digest) === storedHash.toLowerCase();
    if(ok && onMigrate) onMigrate(await pbkdf2Hash(pw));
    return ok;
  }
  const ok = storedHash === legacyHash(pw);
  if(ok && onMigrate) onMigrate(await pbkdf2Hash(pw));
  return ok;
}

/* ── RATE LIMITING DE LOGIN ─────────────────────────────────────
   Contador de tentativas e bloqueio temporário guardados no próprio
   registro do usuário no Firebase (não em localStorage), para não ser
   burlável apenas limpando o navegador. */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 5*60*1000; // 5 minutos
function loginLockRemaining(user){
  if(!user?.loginLockUntil) return 0;
  return Math.max(0, user.loginLockUntil - Date.now());
}

/* ── FIREBASE ───────────────────────────────────────────────── */
function initFb(){
  try{
    firebase.initializeApp(SupremaDB.CONFIG);
    // Cutover email/senha (Fase 4): sem login anônimo. O token de acesso vem da
    // sessão real do Firebase Auth (email/senha) que o hub deixa persistida por
    // origem — quem logou no hub já chega autenticado aqui.
    // progressão do Suprema OS: abrir o admin conta XP na jornada do operador
    firebase.auth().onAuthStateChanged(function(u){
      if(u && !window.__spTracked){ window.__spTracked = true; try{ SupremaAuth.trackUse('admin'); }catch(e){} }
    });
    db=firebase.database();
    fbOk=true;
  }catch(e){console.error('Firebase init',e);}
}

/* ── LOGIN ──────────────────────────────────────────────────── */
async function doLogin(){
  const email=document.getElementById('lEmail').value.trim().toLowerCase();
  const pass=document.getElementById('lPass').value;
  const btn=document.getElementById('lBtn');
  const err=document.getElementById('lErr');
  err.textContent='';
  if(!email||!pass){err.textContent='Preencha email e senha.';return;}
  if(!fbOk){err.textContent='Firebase não conectado.';return;}
  btn.disabled=true;btn.textContent='Verificando...';
  const userRef=db.ref(`users/${eKey(email)}`);
  try{
    const snap=await userRef.once('value');
    const user=snap.val();
    if(!user){err.textContent='Usuário não encontrado.';btn.disabled=false;btn.textContent='Entrar';return;}

    const remaining=loginLockRemaining(user);
    if(remaining>0){
      err.textContent=`Muitas tentativas. Tente novamente em ${Math.ceil(remaining/60000)} min.`;
      btn.disabled=false;btn.textContent='Entrar';return;
    }

    const ok = await verifyPassword(pass, user.pwHash, newHash=>userRef.update({pwHash:newHash}));
    if(!ok){
      const attempts=(user.loginAttempts||0)+1;
      const patch={loginAttempts:attempts};
      if(attempts>=LOGIN_MAX_ATTEMPTS){ patch.loginLockUntil=Date.now()+LOGIN_LOCK_MS; patch.loginAttempts=0; }
      await userRef.update(patch);
      err.textContent = attempts>=LOGIN_MAX_ATTEMPTS
        ? `Muitas tentativas. Login bloqueado por ${LOGIN_LOCK_MS/60000} min.`
        : 'Senha incorreta.';
      btn.disabled=false;btn.textContent='Entrar';return;
    }
    if(user.loginAttempts||user.loginLockUntil) await userRef.update({loginAttempts:0,loginLockUntil:null});

    if(!ADMIN_EMAILS.includes(email)&&!user.admin){err.textContent='Acesso negado — apenas administradores.';btn.disabled=false;btn.textContent='Entrar';return;}
    // login manual bem-sucedido: grava a sessão compartilhada do Suprema OS
    // (assim os outros produtos reconhecem, e o admin fica confiável neste navegador)
    SupremaAuth.saveSession({ email, nome:user.nome, sobrenome:user.sobrenome, apelido:user.apelido, displayName:user.apelido||user.nome||email });
    await enterApp(email, user.apelido||user.nome||email.split('@')[0]);
  }catch(e){err.textContent='Erro: '+e.message;btn.disabled=false;btn.textContent='Entrar';}
}

/* espera o Firebase Auth RESTAURAR a sessão antes da 1ª leitura. Sem isso, no
   mobile (restauração mais lenta) o db.ref().once() corria na frente do token,
   as regras estritas (Fase 4) negavam e o loader ficava girando pra sempre.
   Mesmo gate que o painel.js já usa. Fallback de 4s pra nunca travar. */
function authReady(){
  return new Promise(function(resolve){
    var a = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
    if(!a || a.currentUser) return resolve();
    var done = false;
    var off = a.onAuthStateChanged(function(u){ if(u){ done = true; if(off) off(); resolve(); } });
    setTimeout(function(){ if(!done){ if(off) off(); resolve(); } }, 4000);
  });
}

/* entra no painel admin (caminho único de sucesso: login manual ou sessão) */
async function enterApp(email, name){
  _email=email;_name=name;
  document.getElementById('adminName').textContent=_name;
  document.getElementById('loginWrap').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('loader').classList.add('on');
  // try/finally: o loader SEMPRE desliga, mesmo se a leitura falhar (senão fica
  // "carregando" pra sempre). authReady() garante o token antes de ler.
  try{
    await authReady();
    await loadAll();
    initDates();
    await loadAudit();   // a aba inicial (Acompanhamento) precisa disto
    watchLiveGrade();    // acompanha em tempo real o dia atual + amanhã (GU)
  }catch(e){
    console.error('enterApp/load', e);
    try{ toast('Falha ao carregar. Verifique sua conexão e o login no hub.','err'); }catch(_){}
  }finally{
    document.getElementById('loader').classList.remove('on');
  }
  // o resto sai do caminho crítico: a primeira tela já está de pé,
  // operadores/usuários/notificações carregam quando a thread sobrar
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 350));
  idle(async () => { await loadOps(); await loadUsers(); loadPendingNotifs(); refreshAlertasBadge(); });
}

/* ── RECONHECIMENTO AUTOMÁTICO ──
   Se chego aqui já logado como admin (ou como admin confiável neste navegador),
   o painel entra DIRETO — sem pedir login de novo. É o que faz o "clicar em
   Admin pela Criação" funcionar como uma hub real. */
async function autoEnterFromSession(){
  const r = SupremaAuth.recognize();
  if(!r.email) return;                             // não reconhecido: o guard já mandou pro hub
  const email = r.email.toLowerCase();
  if(!r.isAdmin){
    // reconhecido mas fora da lista fixa: pode ser admin por flag no Firebase — confirma;
    // não sendo, volta pro hub com o aviso (operador comum não vê tela de login do admin)
    try{
      await authReady();   // token pronto: senão a regra nega e um admin-por-flag cairia como "sem acesso"
      const snap = await db.ref(`users/${eKey(email)}`).once('value');
      const u = snap.val();
      if(u && u.admin) return enterApp(email, u.apelido||u.nome||email.split('@')[0]);
    }catch(e){ /* sem leitura: trata como sem acesso */ }
    location.replace('hub.html#sem-acesso');
    return;
  }
  // admin da lista da casa: entra na hora (sem esperar leitura do Firebase)
  if(SupremaAuth.isAdminEmail(email)){
    const nm = (r.session && (r.session.displayName||r.session.apelido||r.session.nome)) || email.split('@')[0];
    if(r.trustedOnly){ // sem sessão viva: reconstrói do Firebase pra manter tudo em sincronia
      try{
        await authReady();
        const snap = await db.ref(`users/${eKey(email)}`).once('value');
        const u = snap.val() || {};
        SupremaAuth.saveSession({ email, nome:u.nome, sobrenome:u.sobrenome, apelido:u.apelido, displayName:u.apelido||u.nome||email });
        return enterApp(email, u.apelido||u.nome||email.split('@')[0]);
      }catch(e){ /* offline: entra com o que temos */ }
    }
    return enterApp(email, nm);
  }
}

function doLogout(){
  // sair do admin encerra a sessão compartilhada e o reconhecimento de admin:
  // volta pro hub, o ecossistema inteiro exige login de novo
  SupremaAuth.clearSession();
  _email='';_name='';_allData={};
  location.replace('hub.html');
  document.getElementById('loginWrap').style.display='flex';
  document.getElementById('app').style.display='none';
  document.getElementById('lEmail').value='';
  document.getElementById('lPass').value='';
  document.getElementById('lErr').textContent='';
  document.getElementById('lBtn').disabled=false;
  document.getElementById('lBtn').textContent='Entrar';
}

/* ── LOAD ALL DATA ──────────────────────────────────────────── */
// Estrutura confirmada do Firebase:
// painel/{date}/sheet.rows → array de torneios (buyin,garantido,hora,nome,tipo)
// painel/{date}/premiacao  → {rk_XXX: valor}
// painel/{date}/fixed      → {rk_XXX: {at, by}}
// painel/{date}/ids        → {rk_XXX: "string"} ou {rk_XXX: {val,by,at}}
// painel/{date}/field      → {rk_XXX: valor}
// painel/{date}/garantido  → {rk_XXX: valor} (sobrescrito)
// snapshots/{date}/rows    → objeto completo com tudo pronto

let _loadAllFull = false;   // true depois que o backup puxou o histórico inteiro
async function loadAll(fullHistory){
  if(!fbOk)return;
  if(fullHistory) _loadAllFull = true;
  _allData={};

  // Janela de 60 dias por padrão: as chaves são datas ISO, então orderByKey
  // corta no servidor — sem isso o admin baixava o histórico INTEIRO do banco
  // a cada abertura (custo de rede/memória crescendo pra sempre). O backup
  // é a exceção: chama loadAll(true) e leva tudo.
  const since = _loadAllFull ? null : dago(60);
  const painelQ = since ? db.ref('painel').orderByKey().startAt(since)    : db.ref('painel');
  const snapQ   = since ? db.ref('snapshots').orderByKey().startAt(since) : db.ref('snapshots');
  const [snapSnap, painelSnapPar] = await Promise.all([
    snapQ.once('value'),
    painelQ.once('value'),
  ]);
  // parse dia-a-dia via helper compartilhado (mesma lógica p/ carga inicial e live)
  const snapRaw  = snapSnap.val()||{};
  Object.entries(snapRaw).forEach(([date,snap])=> mergeDayInto(date, snap, null));
  const painelRaw = painelSnapPar.val()||{};
  Object.entries(painelRaw).forEach(([date,day])=> mergeDayInto(date, null, day));
}

/* CHAVE nome+hora NORMALIZADA pra dedup/merge — tolerante às diferenças de grafia
   entre o snapshot e o painel ao vivo. hora "0:00"/"00:00:00" vira "00:00" (o 00:00
   da madrugada era o caso que duplicava: representações diferentes de meia-noite
   escapavam do dedup e o evento repetia na lista); nome sem acento/caixa/espaço extra. */
function nhKey(nome, hora){
  const n = String(nome||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ');
  const h = String(hora||'').trim().replace(/^(\d{1,2}):(\d{2}).*$/, (_,hh,mm)=>`${hh.padStart(2,'0')}:${mm}`);
  return `${n}|${h}`;
}
/* Faz o merge de UM dia (snapshot + painel) dentro de _allData[date]. É a MESMA
   lógica que o loadAll usava inline — extraída pra ser reusada pelo refresh ao
   vivo (que reprocessa só o dia que mudou, sem rebaixar os 60 dias). `snap` é o
   nó snapshots/<date> ({rows}); `day` é o nó painel/<date> ({sheet,premiacao,…}).
   Chamável com um ou ambos (null pula a parte correspondente). */
function mergeDayInto(date, snap, day){
  // 1. snapshot (rows prontas) — só cria o dia se houver rows válidas (como no original)
  if(snap && snap.rows && typeof snap.rows==='object'){
    if(!_allData[date]) _allData[date]={rows:{},fixed:{},ids:{},field:{},prem:{},guar:{},buy:{},premBy:{}};
    Object.entries(snap.rows).forEach(([k,r])=>{
      if(!r||typeof r!=='object')return;
      // _snap: veio de um snapshot já finalizado. Nesse ponto o painel JÁ removeu toda premiação
      // sem carimbo, então a premiação do snapshot é confiável mesmo sem premBy (dias passados).
      // _snapPrem GUARDA essa premiação LIMPA numa chave própria, porque logo abaixo o nó ao vivo
      // (day.premiacao, L455) sobrescreve rows[k].premiacao/prem[k] — e um valor-fantasma sem premBy
      // no nó ao vivo (inclusive no snapshot automático de HOJE) poluiria a fonte confiável.
      _allData[date].rows[k]={...r,_key:k,_snap:true,_snapPrem:(r.premiacao!=null?r.premiacao:null)};
      if(r.premiacao!=null) _allData[date].prem[k]=r.premiacao;
      if(r.field!=null)     _allData[date].field[k]=r.field;
      if(r.id)              _allData[date].ids[k]={val:r.id,by:r.fixadoPor||''};
      if(r.fixadoPor)       _allData[date].fixed[k]={by:r.fixadoPor,at:r.fixadoEm||0};
    });
  }

  // 2. painel ao vivo — complementa/sobrepõe o snapshot
  if(day && typeof day==='object'){
    if(!_allData[date]) _allData[date]={rows:{},fixed:{},ids:{},field:{},prem:{},guar:{},buy:{},premBy:{}};
    // sheet.rows é ARRAY — converter para objeto com rk_ keys
    // Merge por nome+hora (não recalcula hash) para evitar duplicar o mesmo torneio
    // quando o garantido muda entre o snapshot e o painel ao vivo (hash diferente)
    const existingByNomeHora = {};
    Object.entries(_allData[date].rows).forEach(([k,r])=>{
      if(r?.nome && r?.hora) existingByNomeHora[nhKey(r.nome, r.hora)] = k;
    });

    const arr = Array.isArray(day.sheet?.rows) ? day.sheet.rows : [];
    arr.forEach(r=>{
      if(!r||typeof r!=='object')return;
      const mergeKey = nhKey(r.nome, r.hora);
      const existingK = existingByNomeHora[mergeKey];
      if(existingK){
        // Já existe (veio do snapshot) — não duplicar, só garantir que os dados base estão completos
        if(!_allData[date].rows[existingK].buyin) _allData[date].rows[existingK].buyin = r.buyin;
        if(!_allData[date].rows[existingK].garantido) _allData[date].rows[existingK].garantido = r.garantido;
        if(!_allData[date].rows[existingK].late && r.late) _allData[date].rows[existingK].late = r.late;
        // FEE/ADMIN FEE: snapshot antigo (gravado antes desta mudança) não os tem,
        // mas o nó `sheet` ao vivo do mesmo dia pode ter — completa em vez de estimar
        if(_allData[date].rows[existingK].fee == null && r.fee != null) _allData[date].rows[existingK].fee = r.fee;
        if(_allData[date].rows[existingK].adminFee == null && r.adminFee != null) _allData[date].rows[existingK].adminFee = r.adminFee;
        // A chave rk_ do painel ao vivo pode divergir da do snapshot (o hash inclui o garantido,
        // que muda entre os dois) — o ID/premiação/field digitados no card ficam gravados sob a
        // chave ao vivo. Guardar como alias pra busca achar os dados do evento em qualquer chave.
        const kAlt = rowKey(r);
        if(kAlt !== existingK){
          const row = _allData[date].rows[existingK];
          (row._altKeys || (row._altKeys = [])).push(kAlt);
        }
      } else {
        const k = rowKey(r);
        if(!_allData[date].rows[k]){
          _allData[date].rows[k]={...r,_key:k};
          existingByNomeHora[mergeKey] = k;
        }
      }
    });

    // Dados preenchidos — sobrepor o que veio do snapshot
    Object.entries(day.premiacao||{}).forEach(([k,v])=>{
      if(v!=null) _allData[date].prem[k]=v;
      if(_allData[date].rows[k]) _allData[date].rows[k].premiacao=v;
    });
    Object.entries(day.fixed||{}).forEach(([k,v])=>{
      if(v) _allData[date].fixed[k]=typeof v==='object'?v:{by:'',at:0};
    });
    // quem preencheu o ARRECADADO (premiação coletada) — nó painel/<data>/premBy = {by,at}
    Object.entries(day.premBy||{}).forEach(([k,v])=>{
      if(v) _allData[date].premBy[k]=typeof v==='object'?v:{by:'',at:0};
    });
    Object.entries(day.ids||{}).forEach(([k,v])=>{
      if(v!=null) _allData[date].ids[k]=typeof v==='object'?v:{val:v,by:''};
    });
    Object.entries(day.field||{}).forEach(([k,v])=>{
      if(v!=null){
        _allData[date].field[k]=v;
        if(_allData[date].rows[k]) _allData[date].rows[k].field=v;
      }
    });
    Object.entries(day.garantido||{}).forEach(([k,v])=>{
      if(v!=null) _allData[date].guar[k]=v;
    });
    // Buy-in corrigido na auditoria (painel/<data>/buyin) — sobrepõe o buy-in da planilha
    Object.entries(day.buyin||{}).forEach(([k,v])=>{
      if(v!=null) _allData[date].buy[k]=v;
    });

    // Torneios ADICIONADOS na auditoria (painel/<date>/manualRows) — só admin lê. Entram como
    // linhas normais, iguais ao snapshot; premiação/field/garantido vêm dos nós overlay já
    // processados acima. Não estão em sheet.rows, então não aparecem na grade ao vivo.
    if(day.manualRows && typeof day.manualRows==='object'){
      Object.entries(day.manualRows).forEach(([k,r])=>{
        if(!r || typeof r!=='object' || !r.nome) return;
        _allData[date].rows[k]={...r,_key:k,manual:true};
        if(r.field!=null && _allData[date].field[k]==null) _allData[date].field[k]=r.field;
        if(r.garantido!=null && _allData[date].guar[k]==null) _allData[date].guar[k]=r.garantido;
      });
    }
  }
}

/* ── GRADE AO VIVO (tempo real, cost-safe) ──────────────────────────────────
   O admin agora ACOMPANHA em tempo real o que os operadores preenchem — mas SÓ
   no dia atual e no de amanhã (a GU da noite). O histórico de 60 dias segue via
   .once (raramente muda). Assim o admin fica ao vivo sem rebaixar 60 dias a cada
   tecla (o egress que estourou antes — ver o cuidado no painel.js). Um listener
   por nó-dia (pequeno), debounce, e re-render só da aba de Acompanhamento. */
let _liveWired = false; const _liveT = {}; const _liveDay = {};
function refreshDayLive(date){
  clearTimeout(_liveT[date]);
  _liveT[date] = setTimeout(async () => {
    if(!fbOk) return;
    try{
      // snapshots/<date> costuma nem existir durante o dia (é escrito no fecho) — leitura barata
      const snapS = await db.ref('snapshots/'+date).once('value');
      delete _allData[date];                      // reprocessa o dia do zero (evita lixo de chaves antigas)
      mergeDayInto(date, snapS.val(), _liveDay[date] || null);
      // re-renderiza só se a tela de Acompanhamento estiver aberta (é a "grade")
      if(document.getElementById('pageAudit')?.classList.contains('active')) loadAudit();
      refreshAlertasBadge();   // novos comportamentos suspeitos acendem o sino na hora
    }catch(e){ /* negado/offline: mantém o que já tem */ }
  }, 1000);
}
function watchLiveGrade(){
  if(_liveWired || !fbOk) return; _liveWired = true;
  // hoje + amanhã (dago(-1) = +1 dia): cobre a operação do dia e a GU da noite
  [nowSP(), dago(-1)].forEach(date => {
    /* POR FILHO, não o nó-dia inteiro: o `.on('value')` em painel/<date> re-baixava
       o dia COMPLETO — com a planilha (sheet.rows, o filho pesado) dentro — a cada
       tecla de premiação de qualquer operador, ×2 dias. É a mesma família do egress
       que já estourou a cota. A planilha segue o protocolo da casa: observa só o
       uploadedAt e baixa com .once() QUANDO muda; os filhos pequenos (premiação,
       fixados, ids, field, garantido) ficam ao vivo — são eles que mudam o dia todo. */
    const day = _liveDay[date] = {};
    let lastSheetAt = null;
    db.ref(`painel/${date}/sheet/uploadedAt`).on('value', s => {
      const at = s.val();
      if(at == null || `${at}` === `${lastSheetAt}`) return;
      lastSheetAt = `${at}`;
      db.ref(`painel/${date}/sheet`).once('value')
        .then(ss => { day.sheet = ss.val(); refreshDayLive(date); })
        .catch(() => { lastSheetAt = null; });
    });
    ['premiacao','fixed','premBy','ids','field','garantido','buyin','manualRows'].forEach(node => {
      db.ref(`painel/${date}/${node}`).on('value', s => { day[node] = s.val(); refreshDayLive(date); });
    });
  });
}

/* Busca um valor pela chave da linha, tolerando as chaves ALTERNATIVAS que o
   mesmo evento pode ter no Firebase. São duas fontes de divergência:

   1. _altKeys — a chave do painel AO VIVO difere da do snapshot (o hash inclui
      o garantido, que muda entre os dois).
   2. sufixo '_px' — o painel marca com `proxCronograma` a madrugada que aparece
      no quadro de HOJE mas roda amanhã, e sufixa a chave (rowKey em painel.js).
      Esses cards SÃO fixáveis pelo operador, então existem registros gravados
      sob 'rk_..._px' que o admin nunca encontrava: a auditoria os perdia em
      silêncio. O admin não replica a lógica de proxCronograma — só reconhece a
      chave.

   Ordem importa: a chave base vence, o '_px' fica por ÚLTIMO. Assim isto só
   PREENCHE onde não havia dado, nunca sobrescreve o que já estava certo. */
function pickByKey(map, key, r){
  if(!map) return null;
  if(map[key] != null) return map[key];
  for(const ak of ((r && r._altKeys) || [])) if(map[ak] != null) return map[ak];
  if(map[key + '_px'] != null) return map[key + '_px'];
  return null;
}

function rowKey(r){
  /* ATENÇÃO: NÃO é idêntico ao painel — o painel acrescenta '_px' quando
     row.proxCronograma. O admin não conhece esse conceito; quem cobre a
     diferença é o pickByKey acima. (O comentário antigo dizia "idêntico" e
     escondia a divergência.) */
  const s=`${r.nome}|${r.hora}|${r.buyin}|${r.garantido}`;
  let h=0;
  for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}
  return 'rk_'+Math.abs(h);
}

/* ── FLAT ROWS (para análise) ───────────────────────────────── */
function flatRows(fromDate, toDate){
  const out=[];
  // AUDITORIA DO GATE: premiação de snapshot descartada por não ter carimbo de coleta
  // (premPor no snapshot nem premBy ao vivo). São os valores-fantasma da coluna "Premiação"
  // da planilha em snapshots antigos — que ANTES inflavam o Arrecadado. Contamos pra nunca
  // descartar em silêncio: se sobrar algum dia que o Brian reconheça como fechado de verdade,
  // ele vê aqui em vez de o número simplesmente sumir.
  const _flatExcl={count:0,value:0,dates:new Set()};
  Object.entries(_allData).forEach(([date,day])=>{
    if(fromDate&&date<fromDate)return;
    if(toDate&&date>toDate)return;
    // Deduplicar por nome+hora dentro do mesmo dia (proteção contra hash divergente
    // entre snapshot e painel ao vivo, que gera keys diferentes pro mesmo torneio)
    const seenInDay = new Set();
    Object.entries(day.rows).forEach(([key,r])=>{
      if(!r||typeof r!=='object')return;
      const dedupeKey = nhKey(r.nome, r.hora); // normalizado: pega meia-noite em qualquer grafia
      if(seenInDay.has(dedupeKey)) return; // já processado este torneio neste dia
      seenInDay.add(dedupeKey);

      // Busca com alias: os dados digitados no card podem estar sob a chave ao vivo
      // (r._altKeys) em vez da chave do snapshot — sem isso o ID do card não aparecia
      const pick = map => pickByKey(map, key, r);
      // Premiação (ARRECADADO): regra ÚNICA, igual à do painel. Duas fontes distintas:
      //  1) nó AO VIVO (day.prem/rows[k].premiacao) — só vale se ALGUÉM carimbou (premBy). Sem carimbo
      //     = fantasma (coluna "Premiação" da planilha, legado, migração de chave) → NÃO exibe.
      //  2) SNAPSHOT finalizado (_snapPrem) — já limpo pelo painel antes de arquivar, confiável mesmo
      //     sem premBy. Usa a CÓPIA preservada, não pick(day.prem), que o nó ao vivo pode ter sobrescrito.
      // Assim o Fechado-fantasma some do admin sem apagar o histórico dos dias já fechados.
      const _pbGate = pick(day.premBy);
      const _hasPremBy = _pbGate != null && _pbGate !== false && _pbGate !== '';
      const livePrem = _hasPremBy ? (pick(day.prem) ?? null) : null;
      // SNAPSHOT também exige prova de coleta: o snapshot grava `premPor` (premBy do painel)
      // POR LINHA — só existe quando um operador DIGITOU o arrecadado. Snapshots antigos foram
      // arquivados por uma versão do painel que ainda deixava a coluna "Premiação" da planilha
      // (prize pool anunciado, nunca coletado) entrar — sem premPor. Sem esta trava, cada dia
      // arquivado somava premiação-fantasma da planilha e o total inflava (~5×). Como o premBy
      // sempre existiu, toda premiação COLETADA real tem premPor → o histórico verdadeiro fica.
      const _snapHasPremPor = r.premPor != null && r.premPor !== false && r.premPor !== '';
      const prem = livePrem ?? ((r._snap && _snapHasPremPor) ? (r._snapPrem ?? null) : null);
      // valor de snapshot que EXISTIA mas foi barrado por falta de carimbo — registra pra auditoria
      if(prem==null && r._snap && r._snapPrem!=null && !_snapHasPremPor && !_hasPremBy){
        _flatExcl.count++; _flatExcl.value += (+r._snapPrem||0); _flatExcl.dates.add(date);
      }
      // Garantido: sobrescrito ou da planilha
      const gar  = pick(day.guar)??r.garantido??null;
      // ID
      const idRaw = pick(day.ids);
      const idVal = typeof idRaw==='object'&&idRaw ? (idRaw.val||'') : (idRaw||'');
      const idBy  = typeof idRaw==='object'&&idRaw ? (idRaw.by||'') : '';
      // Fixado
      const fixRaw = pick(day.fixed);
      const fixBy  = typeof fixRaw==='object'&&fixRaw ? (fixRaw.by||'') :
                     fixRaw===true ? 'Sim' : '';
      // `at` só vale se for timestamp numérico de verdade — senão dava "Invalid Date"/"NaNmin"
      // (ex.: registros antigos sem hora, ou ServerValue não resolvido no snapshot).
      const _ms = x => {
        if(!x || typeof x!=='object' || x.at == null) return null;
        const n = Number(x.at);
        if(isFinite(n) && n > 0) return n;          // ms epoch (número ou string numérica)
        const d = Date.parse(x.at);                 // aceita também data/hora em texto (ISO)
        return isFinite(d) ? d : null;
      };
      const hm  = ms => new Date(ms).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'});
      const fixAtMs = _ms(fixRaw);
      // hora que fixou: do timestamp do nó `fixed`; se não der, usa a hora salva no snapshot (fixadoEm)
      const fixAt  = fixAtMs ? hm(fixAtMs) : (r.fixadoEm || '');
      // Arrecadado — quem preencheu a premiação coletada e quando
      const pbRaw  = _pbGate;
      const premBy = typeof pbRaw==='object'&&pbRaw ? (pbRaw.by||'') : '';
      const pbMs   = _ms(pbRaw);
      const premByAt = pbMs ? hm(pbMs) : '';
      const cat = classify(r);
      // TIMING DA FIXAÇÃO — quanto ANTES do início o torneio foi fixado, e se foi cedo/no prazo/atrasado.
      // Prazo ideal = início − lead (Main/Side 60min, Satélite 30min). fixLeadMin>0 = fixou antes do início.
      let fixLeadMin = null, fixTiming = '';
      if(fixAtMs && /^\d{1,2}:\d{2}$/.test(r.hora||'')){
        const [Y,Mo,Da] = date.split('-').map(Number);
        const [hh,mm] = r.hora.split(':').map(Number);
        const dayOff = (hh*60+mm) < 330 ? 1 : 0;                 // madrugada (<05:30) começa no dia civil seguinte
        const startMs = Date.UTC(Y, Mo-1, Da+dayOff, hh+3, mm);  // São Paulo = UTC−3 (sem horário de verão no Brasil)
        const lm = Math.round((startMs - fixAtMs)/60000);
        if(Number.isFinite(lm)){
          fixLeadMin = lm;
          const lead = cat==='sat' ? 30 : 60;
          if(fixLeadMin < lead)            fixTiming = 'atrasado';  // fixou depois do prazo (início − lead)
          else if(fixLeadMin > lead + 180) fixTiming = 'cedo';     // fixou mais de 3h antes do prazo
          else                             fixTiming = 'ok';
        }
      }
      // Field
      const field  = pick(day.field)??r.field??null;
      // buy-in corrigido na auditoria vence a planilha. Sobe pra cá (antes era declarado
      // junto das AÇÕES, mais abaixo) porque o overlay agora depende dele — ver freeroll.
      const buyin = pick(day.buy) ?? r.buyin ?? null;
      /* FREEROLL = buy-in ZERO. A casa PAGA o garantido inteiro do próprio bolso, então
         ele é custo real e tem que aparecer como overlay NEGATIVO — não como zero.
         O detalhe que faz isto funcionar: num freeroll não existe arrecadação pra
         alguém lançar, então o `arrecadado` fica null pra sempre e o overlay nunca era
         calculado (diff exige prem != null) — o custo ficava invisível na auditoria.
         Aqui o arrecadado do freeroll vale 0 POR NATUREZA, e o overlay sai
         0 − garantido = −garantido, sempre negativo, sem depender de digitação.
         Não é forçado a −garantido: um "FreeBuy" (buy-in 0 com rebuy/add-on, ex.:
         "FreeBuy Supremo" gtd 220) arrecada de verdade, e aí o overlay é a diferença
         real — e some se a arrecadação cobrir o garantido.
         O teste é `buyin === 0` e NUNCA o nome: a grade tem 18 torneios "Freeze", que
         casam com /free/i e são PAGOS (ex.: "4 Seats Freeze", buy-in 0,80).
         `=== 0` e não `!buyin`: buy-in ausente (null) é dado faltando, não freeroll.
         `premOv` é local do overlay de propósito — mexer no `prem` marcaria o freeroll
         como "fechado" no status e entraria nos totais de arrecadação como coleta real. */
      const ehFreeroll = buyin === 0;
      const premOv = ehFreeroll ? (prem ?? 0) : prem;
      // Cálculos
      const diff   = premOv!=null&&gar!=null ? premOv-gar : null;
      const ov     = diff!=null&&diff<0 ? diff : null;
      const perf   = prem!=null&&gar!=null&&gar>0 ? Math.round(((prem-gar)/gar)*10000)/100 : null;
      const isNF   = idVal.toUpperCase()==='NF';
      const status = isNF?'nf':prem!=null?'fechado':'aberto';

      // Só incluir se tem dados relevantes (nome existe)
      if(!r.nome)return;
      // Próximo cronograma (madrugada de amanhã) não deve aparecer na auditoria de hoje
      // — aparece apenas no dia correto quando o arrecadado for coletado
      if(r.proxCronograma) return;

      // AÇÕES = total de entradas (com re-entries) que gerou a premiação. A premiação é
      // o LÍQUIDO (a parte da entrada que vai pro prize pool); o fator líquido depende de
      // ser "campanha" (prefixo SPS antes do nome do evento) e de ser satélite:
      //   com campanha 0,88 · sem campanha 0,90 · satélite 0,95
      // "+"/série no Main NÃO é campanha — só o prefixo SPS conta.
      // SPT é satélite (0,95) e cai pelo cat==='sat', não por campanha.
      // Ex.: 750 Plus (side sem campanha) prem R$1.068,30 ÷ (R$1 × 0,90) = 1.187 ações.
      // Rake e admin fee da linha: FEE + ADMIN FEE da GU quando vieram na linha;
      // senão a taxa por categoria (rede pro histórico). Gravados na row pra que
      // ninguém adiante refaça a conta pelo nome e as duas divirjam.
      const isCampanha = /^\s*SPS\b/i.test(r.nome||'');
      const guR = guRatesOf(r);
      const adminFrac = guR ? guR.admin : (isCampanha ? DASH_RATES.adminPct : 0);
      const rakeFrac  = guR ? guR.fee   : Math.max(0, (1 - netFactorOf(cat, isCampanha)) - adminFrac);
      const netFactor = Math.round((1 - (rakeFrac + adminFrac)) * 1e6) / 1e6;
      const acoes = prem!=null && buyin && netFactor>0 ? Math.round(prem/(buyin*netFactor)) : null;
      out.push({
        date, key,
        nome:r.nome||'', hora:r.hora||'', late:r.late||'',
        tipo:r.tipo||'', cat,
        garantido:gar, buyin, netFactor,
        rakeFrac, adminFrac, rakeSource: guR ? 'gu' : 'estimado',
        premiacao:prem, overlay:ov, perf, field, acoes,
        id:idVal, idBy, fixBy, fixAt, premBy, premByAt, fixLeadMin, fixTiming, status,
        manual: !!r.manual,   // veio de manualRows → card adicionado à mão (Central de Alertas)
      });
    });
  });

  // DEDUP CROSS-DATA — a MESMA ocorrência da madrugada às vezes é gravada em DOIS dias de
  // grade (a virada das 05:30 e a grade do dia seguinte que ainda lista o 00:00), e o evento
  // aparecia repetido na auditoria em dois cabeçalhos de dia. Resolve pela DATA CIVIL real do
  // evento (grade +1 dia quando é madrugada <05:30) + nome/hora normalizados: mesma ocorrência
  // vira UMA linha. Ocorrências em NOITES diferentes têm data civil diferente → as duas ficam
  // (não são dup). Mantém a linha MAIS "forte": já auditada > com premiação > com ID > primeira.
  const civilOf = (date, hora) => {
    const m = String(hora||'').match(/^(\d{1,2}):(\d{2})/);
    const mins = m ? (+m[1])*60 + (+m[2]) : 9999;
    if (mins < 330){ const d = new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); }
    return date;
  };
  const score = r => (getAuditEntry(r.date, r.key)?4:0) + (r.premiacao!=null?2:0) + (r.id?1:0);
  const byOcc = new Map();
  for (const r of out){
    const k = `${civilOf(r.date, r.hora)}|${nhKey(r.nome, r.hora)}`;
    const prev = byOcc.get(k);
    if (!prev || score(r) > score(prev)) byOcc.set(k, r);
  }
  const result=[...byOcc.values()];
  // expõe a auditoria do gate sem quebrar quem só itera o array
  result.excludedNoStamp={ count:_flatExcl.count, value:_flatExcl.value, dates:[..._flatExcl.dates].sort() };
  return result;
}

/* ── NAVIGATION ─────────────────────────────────────────────── */
function nav(id,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  // sincroniza o estado ativo em TODOS os gatilhos de navegação (sidebar + barra
  // inferior do mobile), casando por data-arg — assim clicar em qualquer um dos
  // dois acende os dois. Antes só o botão clicado ficava ativo.
  document.querySelectorAll('.ntab,.mtab').forEach(b=>
    b.classList.toggle('active', b.getAttribute('data-arg')===id));
  // destinos secundários (fora da barra inferior) acendem o botão "Mais"
  const more=document.getElementById('mtabMore');
  if(more) more.classList.toggle('active', ['criacao','backup','avisos'].includes(id));
  closeNavSheet();                                 // fecha a folha de navegação do mobile
  closeFilterSheet();                              // fecha a folha de filtros do mobile
  closeTbMenu();                                   // fecha o menu de ações se estava aberto
  const pg=document.getElementById('page'+id.charAt(0).toUpperCase()+id.slice(1));
  if(pg)pg.classList.add('active');
  if(id==='dashboard'){ buildDash(); if(!_dashSettingsLoaded){ _dashSettingsLoaded=true; Promise.all([loadDashSettings(),loadCampaigns()]).then(()=>buildDash()); } }
  if(id==='backup')initBackup(); // initBackup já faz loadAll() internamente
  if(id==='grade')renderGrade();
  if(id==='audit')loadAudit();
  if(id==='criacao')loadCriacao();
  if(id==='operadores')buildOpRanking();   // ranking inline (o card só aparece ao expandir)
  if(id==='avisos')initAvisos();
}

/* Menu de ações da topbar no mobile (Resumo, Notificações, Log, Justificativas,
   links e Sair). No desktop a .tb-actions já aparece inline; no celular ela vira
   uma folha que desce, aberta pelo botão ⋯. */
function toggleTbMenu(){
  const box=document.getElementById('tbActions');
  const bd=document.getElementById('tbMenuBackdrop');
  const more=document.querySelector('.tb-more');
  if(!box)return;
  const open=!box.classList.contains('open');
  box.classList.toggle('open',open);
  if(bd){ if(open) bd.removeAttribute('hidden'); else bd.setAttribute('hidden',''); }
  if(more) more.setAttribute('aria-expanded',open?'true':'false');
}
function closeTbMenu(){
  const box=document.getElementById('tbActions');
  if(box&&box.classList.contains('open')) toggleTbMenu();
}

/* Folha de navegação do mobile (botão "Mais" da barra inferior): destinos
   secundários que não cabem nas 5 colunas fixas. Slide de baixo pra cima. */
function toggleNavSheet(){
  const sheet=document.getElementById('navSheet');
  const bd=document.getElementById('navSheetBackdrop');
  const more=document.getElementById('mtabMore');
  if(!sheet)return;
  const open=!sheet.classList.contains('open');
  sheet.classList.toggle('open',open);
  sheet.setAttribute('aria-hidden',open?'false':'true');
  if(bd){ if(open) bd.removeAttribute('hidden'); else bd.setAttribute('hidden',''); }
  if(more) more.setAttribute('aria-expanded',open?'true':'false');
}
function closeNavSheet(){
  const sheet=document.getElementById('navSheet');
  if(sheet&&sheet.classList.contains('open')) toggleNavSheet();
}

/* ── FILTROS COMO BOTTOM SHEET (mobile) ──────────────────────────────────────
   No celular os filtros de cada página deixam de empilhar full-width (jogando os
   dados pra baixo da dobra) e passam a morar numa folha acionada pelo botão
   "Filtros" da barra de ações, com contador de filtros ativos. Padrão iOS/Linear.
   Genérico: injeta cabeçalho/rodapé em cada .filters e um gatilho em cada
   .ph-actions — no desktop tudo isso fica display:none e os filtros seguem inline. */
function initMobileFilters(){
  document.querySelectorAll('.page').forEach(function(pg){
    var filters=pg.querySelector('.filters');
    var actions=pg.querySelector('.ph-actions');
    if(!filters) return;
    if(!filters.querySelector('.fs-head')){
      var head=document.createElement('div');
      head.className='fs-head';
      head.innerHTML='<span class="fs-grab" aria-hidden="true"></span><span class="fs-title">Filtros</span>'+
        '<button type="button" class="fs-x" data-act="closeFilterSheet" aria-label="Fechar filtros">✕</button>';
      filters.insertBefore(head, filters.firstChild);
      var foot=document.createElement('div');
      foot.className='fs-foot';
      foot.innerHTML='<button type="button" class="btn btn-gold" data-act="applyFilterSheet">Ver resultados</button>';
      filters.appendChild(foot);
    }
    if(actions && !actions.querySelector('.filters-trigger')){
      var t=document.createElement('button');
      t.type='button'; t.className='btn btn-ghost filters-trigger';
      t.setAttribute('data-act','toggleFilterSheet');
      t.setAttribute('aria-haspopup','dialog');
      t.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" style="stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filtros <span class="ft-count" hidden></span>';
      actions.appendChild(t);
    }
  });
  if(!document.getElementById('filterSheetBackdrop')){
    var bd=document.createElement('div');
    bd.id='filterSheetBackdrop'; bd.className='fs-backdrop';
    bd.setAttribute('data-act','closeFilterSheet'); bd.hidden=true;
    document.body.appendChild(bd);
  }
  if(!window.__fsCountBound){
    window.__fsCountBound=true;
    document.addEventListener('change', function(e){ if(e.target.closest && e.target.closest('.filters')) refreshFilterCount(); });
    document.addEventListener('input', function(e){ if(e.target.closest && e.target.closest('.filters')) refreshFilterCount(); });
  }
  refreshFilterCount();
}
function refreshFilterCount(){
  document.querySelectorAll('.page').forEach(function(pg){
    var filters=pg.querySelector('.filters');
    var cnt=pg.querySelector('.ft-count');
    if(!filters||!cnt) return;
    var n=0;
    filters.querySelectorAll('input,select').forEach(function(el){
      if(el.closest('.fs-head')||el.closest('.fs-foot')) return;
      if(el.tagName==='SELECT'){ if(el.selectedIndex>0) n++; }
      else if(el.value && String(el.value).trim()) n++;
    });
    if(n>0){ cnt.textContent=n; cnt.hidden=false; } else { cnt.textContent=''; cnt.hidden=true; }
  });
}
function toggleFilterSheet(){
  var f=document.querySelector('.page.active .filters');
  if(!f) return;
  var bd=document.getElementById('filterSheetBackdrop');
  var open=!f.classList.contains('sheet-open');
  f.classList.toggle('sheet-open',open);
  if(bd){ if(open) bd.hidden=false; else bd.hidden=true; }
  document.body.classList.toggle('fs-lock',open);
}
function closeFilterSheet(){
  var f=document.querySelector('.page.active .filters.sheet-open');
  var bd=document.getElementById('filterSheetBackdrop');
  if(f) f.classList.remove('sheet-open');
  if(bd) bd.hidden=true;
  document.body.classList.remove('fs-lock');
  refreshFilterCount();
}
/* "Ver resultados": APLICA os filtros (dispara a Busca da página — loadAudit/
   loadCriacao via o botão dourado do cabeçalho) e fecha a folha. Sem isso o
   sheet só fechava e os filtros de Categoria/Status/Operador/Busca não pegavam. */
function applyFilterSheet(){
  var pg=document.querySelector('.page.active');
  var searchBtn=pg?pg.querySelector('.ph-actions .btn-gold:not(.filters-trigger)'):null;
  closeFilterSheet();
  if(searchBtn) searchBtn.click();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initMobileFilters);
else initMobileFilters();

/* Ranking de operadores: dobra/expande o card inline dentro da aba Operadores.
   Substitui o antigo modal (moOpRanking) e o botão da topbar. */
function toggleOpRanking(){
  const card=document.getElementById('opRankingCard');
  const btn=document.getElementById('opRankToggle');
  if(!card)return;
  const show=card.hasAttribute('hidden');
  if(show){ card.removeAttribute('hidden'); buildOpRanking(); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  else card.setAttribute('hidden','');
  if(btn) btn.classList.toggle('btn-gold', show);
}

/* ══ AUDITORIA DA CRIAÇÃO NOTURNA (GU) ═══════════════════════════
   Lê painel/{dia}/criacaoNoturna de cada dia do período (sheet + done + ids +
   audit) e monta: KPIs do período, performance por operador e a lista torneio
   a torneio. "Marcar erro" grava em .../audit/{key} — a página da criação
   escuta esse nó e mostra o alerta pro turno na hora. */
let _cnRows = [], _cnSoErros = false;
const cnNorm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
// MESMA chave da página de criação (itemKey) — é o elo entre as duas telas
const cnKey = it => `${cnNorm(it.nome)}|${it.hora}`.replace(/[.#$\[\]\/]/g,'_');
function setCnPeriod(n){
  document.getElementById('cnFrom').value = dago(n-1);
  document.getElementById('cnTo').value = nowSP();
  loadCriacao();
}
function toggleCnErros(){
  _cnSoErros = !_cnSoErros;
  document.getElementById('btnCnSoErros').classList.toggle('btn-gold', _cnSoErros);
  renderCn();
}
function cnDates(){
  const from = document.getElementById('cnFrom').value, to = document.getElementById('cnTo').value;
  if(!from || !to) return [];
  const out = [], d = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z');
  while(d <= end && out.length < 62){ out.push(d.toISOString().slice(0,10)); d.setUTCDate(d.getUTCDate()+1); }
  return out;
}
/* Busca+monta as linhas da Criação Noturna de um conjunto de datas, SEM renderizar.
   Extraído do loadCriacao pra a Central de Alertas reaproveitar a MESMA lógica
   (mesmas anomalias em cnAnoms) sem tocar na aba Criação. */
async function fetchCnRows(dates){
  const snaps = await Promise.all(dates.map(d => db.ref(`painel/${d}/criacaoNoturna`).once('value').then(s => ({d, v: s.val()})).catch(()=>({d, v:null}))));
  const rows = [];
  snaps.forEach(({d, v}) => {
    if(!v || !v.sheet || !v.sheet.json) return;
    let data; try{ data = JSON.parse(v.sheet.json); }catch(e){ return; }
    const done = v.done||{}, ids = v.ids||{}, audit = v.audit||{};
    const sheetAt = v.sheet.at || null;
    const changedNames = new Set((data.changes||[]).map(c => cnNorm(c.nome)));
    [['main','Main Event'],['side','Side Event'],['sat','Satélite']].forEach(([k,label]) => (data[k]||[]).forEach(it => {
      const key = cnKey(it);
      const idRaw = ids[key];
      const doneAt = (done[key]&&done[key].at)||null;
      // início real do evento: madrugada (≤05:30) pertence ao dia SEGUINTE da grade
      let startMs = null;
      const hm = /^(\d{1,2}):(\d{2})$/.exec(it.hora||'');
      if(hm){
        const min = (+hm[1])*60 + (+hm[2]);
        const ref = new Date(d + 'T12:00:00Z');
        if(min <= 330) ref.setUTCDate(ref.getUTCDate()+1);
        // horário da grade é relógio de Brasília (UTC-3)
        startMs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), +hm[1]+3, +hm[2]);
      }
      rows.push({date:d, key, nome:it.nome, hora:it.hora, cat:label,
        doneBy:(done[key]&&done[key].by)||'', doneAt, dur:(done[key]&&done[key].dur)||null,
        id: idRaw ? (idRaw.val !== undefined ? idRaw.val : idRaw) : '', audit: audit[key]||null,
        aposInicio: !!(doneAt && startMs && doneAt > startMs),
        alteradoPos: !!(doneAt && sheetAt && doneAt < sheetAt && changedNames.has(cnNorm(it.nome)))});
    }));
  });
  return rows;
}
async function loadCriacao(){
  if(!document.getElementById('cnFrom').value) setCnPeriodDefaults();
  const dates = cnDates();
  if(!dates.length){ toast('Escolha o período','err'); return; }
  // skeleton shimmer enquanto o Firebase responde (percepção de velocidade)
  document.getElementById('cnKpi').innerHTML = Array.from({length:6}, () =>
    '<div class="kpi"><div class="kpi-label sp-shimmer" style="height:11px;width:60%">&nbsp;</div>' +
    '<div class="kpi-val sp-shimmer" style="height:26px;width:45%;margin:8px 0">&nbsp;</div>' +
    '<div class="kpi-sub sp-shimmer" style="height:10px;width:80%">&nbsp;</div></div>').join('');
  _cnRows = await fetchCnRows(dates);
  // popula o filtro de operador com quem realmente criou no período
  // (ler de _cnRows, NÃO de um `rows` local: a busca mora no fetchCnRows desde que
  //  a Central de Alertas passou a reaproveitá-la — o `rows` daqui deixou de existir
  //  e o ReferenceError abortava loadCriacao antes do renderCn, deixando a aba
  //  eternamente nos esqueletos de carregamento)
  const sel = document.getElementById('cnOp'), cur = sel.value;
  const ops = [...new Set(_cnRows.map(r => r.doneBy).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos</option>' + ops.map(o => `<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('');
  renderCn();
}
function setCnPeriodDefaults(){
  document.getElementById('cnFrom').value = dago(6);
  document.getElementById('cnTo').value = nowSP();
}
/* anomalias detectadas SOZINHAS (sem o admin caçar): criado sem ID, criado
   depois do horário de início, tempo de criação 3× acima da média, e receita
   alterada pela GU DEPOIS do torneio já criado (precisa revisar no app) */
function cnAnoms(r, avgDur){
  const out = [];
  if(!r.doneBy) return out;
  if(!r.id) out.push('sem ID');
  if(r.aposInicio) out.push('criado após o início');
  if(r.dur && avgDur && r.dur > 3*avgDur && r.dur > 5*60000) out.push('tempo 3× acima da média');
  if(r.alteradoPos) out.push('receita alterada após criar');
  return out;
}
function cnAvgDur(rows){
  const ds = rows.map(r => r.dur).filter(Boolean);
  return ds.length ? ds.reduce((a,b)=>a+b,0)/ds.length : null;
}
function cnFiltered(){
  const op = document.getElementById('cnOp').value, q = cnNorm(document.getElementById('cnSearch').value);
  const avg = cnAvgDur(_cnRows);
  return _cnRows.filter(r =>
    (!op || r.doneBy === op) &&
    (!q || cnNorm(r.nome).includes(q)) &&
    (!_cnSoErros || (r.audit && r.audit.status === 'erro') || cnAnoms(r, avg).length));
}
function cnFmtDur(ms){ if(!ms) return ''; const m = ms/60000; return m < 1 ? Math.round(ms/1000)+'s' : m.toFixed(1)+'m'; }
function renderCn(){
  const rows = cnFiltered();
  const criados = rows.filter(r => r.doneBy);
  const comId = criados.filter(r => r.id);
  const erros = rows.filter(r => r.audit && r.audit.status === 'erro');
  const durs = criados.map(r => r.dur).filter(Boolean);
  const avg = durs.length ? durs.reduce((a,b)=>a+b,0)/durs.length : null;
  const pct = (a,b) => b ? Math.round(a/b*100)+'%' : '—';
  document.getElementById('cnKpi').innerHTML = `
    <div class="kpi b"><div class="kpi-label">Torneios no período</div><div class="kpi-val">${rows.length}</div><div class="kpi-sub">${new Set(rows.map(r=>r.date)).size} dia(s) de grade</div></div>
    <div class="kpi g"><div class="kpi-label">Criados</div><div class="kpi-val">${criados.length}</div><div class="kpi-sub">${pct(criados.length, rows.length)} da grade</div></div>
    <div class="kpi ${comId.length===criados.length?'g':''}"><div class="kpi-label">Com ID Pokerbyte</div><div class="kpi-val">${pct(comId.length, criados.length)}</div><div class="kpi-sub">${comId.length} de ${criados.length} criados</div></div>
    <div class="kpi p"><div class="kpi-label">Tempo médio de criação</div><div class="kpi-val">${avg?cnFmtDur(avg):'—'}</div><div class="kpi-sub">${durs.length} com tempo medido (modo foco)</div></div>
    <div class="kpi ${erros.length?'r':'g'}"><div class="kpi-label">Erros de criação</div><div class="kpi-val">${erros.length}</div><div class="kpi-sub">taxa ${pct(erros.length, criados.length)} sobre os criados</div></div>
    ${(() => { const avgA = cnAvgDur(_cnRows); const an = rows.filter(r => cnAnoms(r, avgA).length).length; return `<div class="kpi ${an?'r':'g'}"><div class="kpi-label">Anomalias automáticas</div><div class="kpi-val">${an}</div><div class="kpi-sub">sem ID · após início · tempo 3× · alterado pós-criação</div></div>`; })()}`;
  if(window.SupremaMotion) SupremaMotion.countUp('#cnKpi .kpi-val');   // números "rolam" ao aparecer
  // ── performance por operador ──
  const byOp = {};
  criados.forEach(r => {
    const o = byOp[r.doneBy] || (byOp[r.doneBy] = {criados:0, comId:0, durs:[], erros:0});
    o.criados++; if(r.id) o.comId++; if(r.dur) o.durs.push(r.dur);
    if(r.audit && r.audit.status === 'erro') o.erros++;
  });
  const opRows = Object.entries(byOp).sort((a,b) => b[1].criados - a[1].criados);
  document.getElementById('cnOpsTable').innerHTML = `
    <thead><tr><th>Operador</th><th class="r">Criados</th><th class="r">Com ID</th><th class="r">Tempo médio</th><th class="r">Erros</th><th class="r">Taxa de erro</th><th class="r">Ritmo (torneios/dia)</th></tr></thead>
    <tbody>${opRows.length ? opRows.map(([o, s]) => {
      const oa = s.durs.length ? s.durs.reduce((a,b)=>a+b,0)/s.durs.length : null;
      const dias = new Set(criados.filter(r=>r.doneBy===o).map(r=>r.date)).size || 1;
      return `<tr>
        <td><b>${esc(o)}</b></td>
        <td class="r mono">${s.criados}</td>
        <td class="r mono">${pct(s.comId, s.criados)}</td>
        <td class="r mono">${oa?cnFmtDur(oa):'—'}</td>
        <td class="r mono" style="${s.erros?'color:var(--red);font-weight:700':''}">${s.erros}</td>
        <td class="r mono" style="${s.erros?'color:var(--red)':''}">${pct(s.erros, s.criados)}</td>
        <td class="r mono">${(s.criados/dias).toFixed(1)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" style="color:var(--ink3)">Nenhum torneio criado no período.</td></tr>'}</tbody>`;
  // ── torneio a torneio ──
  document.getElementById('cnTable').innerHTML = `
    <thead><tr><th>Data</th><th>Torneio</th><th>Cat.</th><th>Horário</th><th>Criado por</th><th>Quando</th><th class="r">Tempo</th><th>ID</th><th>Auditoria</th><th></th></tr></thead>
    <tbody>${rows.length ? rows.map((r, i) => {
      const when = r.doneAt ? new Date(r.doneAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}) : '';
      const anoms = cnAnoms(r, cnAvgDur(_cnRows));
      const aud = (r.audit && r.audit.status === 'erro'
        ? `<span style="color:var(--red);font-weight:700" title="por ${esc(r.audit.by||'—')}">⚠ erro</span>${r.audit.motivo?`<div style="font-size:11px;color:var(--ink3);max-width:200px;white-space:normal">${esc(r.audit.motivo)}</div>`:''}`
        : (r.doneBy ? '<span style="color:var(--green)">✓ ok</span>' : '<span style="color:var(--ink3)">—</span>'))
        + (anoms.length ? `<div style="font-size:11px;color:var(--amber);font-weight:600;max-width:200px;white-space:normal">⚡ ${anoms.map(esc).join(' · ')}</div>` : '');
      const btn = r.audit && r.audit.status === 'erro'
        ? `<button class="btn btn-gold btn-sm" data-act="notifyCnError" data-arg="${i}">📨 Notificar</button> <button class="btn btn-ghost btn-sm" data-act="clearCnError" data-arg="${i}">Desfazer</button>`
        : (r.doneBy ? `<button class="btn btn-ghost btn-sm" data-act="markCnError" data-arg="${i}">⚠ Marcar erro</button>` : '');
      return `<tr data-cni="${i}">
        <td class="mono">${r.date.slice(5).split('-').reverse().join('/')}</td>
        <td style="max-width:260px;white-space:normal"><b>${esc(r.nome)}</b></td>
        <td>${r.cat}</td>
        <td class="mono">${esc(r.hora)}</td>
        <td>${r.doneBy ? esc(r.doneBy) : '<span style="color:var(--ink3)">não criado</span>'}</td>
        <td class="mono">${when}</td>
        <td class="r mono">${cnFmtDur(r.dur)}</td>
        <td class="mono">${r.id ? esc(r.id) : '<span style="color:var(--amber)">sem ID</span>'}</td>
        <td>${aud}</td>
        <td class="r">${btn}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="10" style="color:var(--ink3)">Nada no período (a criação noturna começou a gravar nesses nós a partir de julho/2026).</td></tr>'}</tbody>`;
  window._cnView = rows; // índice usado pelos botões
}
function markCnError(i){
  const r = window._cnView[i];
  const motivo = prompt(`Erro de criação em "${r.nome}" (${r.hora}, criado por ${r.doneBy}).\n\nDescreva o erro — o operador vê esse motivo na página da criação:`);
  if(motivo === null) return;
  const payload = {status:'erro', motivo: motivo.trim().slice(0,200), by:_name||'Admin', at:Date.now()};
  db.ref(`painel/${r.date}/criacaoNoturna/audit/${r.key}`).set(payload);
  db.ref(`painel/${r.date}/criacaoNoturna/log`).push({by:`Admin ${_name||''}`.trim(), at:Date.now(), action:'marcou ERRO de criação', detail:`${r.nome} — ${payload.motivo||'sem motivo'}`});
  r.audit = payload; renderCn();
  toast(`⚠ Erro marcado — ${r.doneBy} vê o alerta na página da criação`,'ok');
  // já abre a notificação oficial (a MESMA que aparece no painel do operador,
  // com bloqueio até justificar) pré-preenchida com o motivo
  notifyCnError(window._cnView.indexOf(r));
}
/* notificação de erro de criação — reaproveita o fluxo oficial do admin
   (openNotif/sendNotif → userNotifs + pendingNotif): o operador recebe no
   painel exatamente a mesma mensagem/bloqueio das outras auditorias */
function notifyCnError(i){
  const r = window._cnView[i];
  if(!r) return;
  openNotif({nome:`${r.nome} (${r.hora} · grade ${r.date.slice(5).split('-').reverse().join('/')})`, date:r.date, key:r.key, fixBy:r.doneBy});
  // pré-seleciona o tipo "Erro de criação (GU)" e preenche a descrição com o motivo
  setTimeout(() => {
    const btn = [...document.querySelectorAll('.notif-type-btn')].find(b => (b.getAttribute('onclick')||'').includes("'criacao'"));
    if(btn) selNotifType('criacao', btn);
    if(r.audit && r.audit.motivo){
      document.getElementById('notifDesc').value = r.audit.motivo;
      if(typeof updateNotifPreview === 'function') updateNotifPreview();
    }
  }, 50);
}
function clearCnError(i){
  const r = window._cnView[i];
  db.ref(`painel/${r.date}/criacaoNoturna/audit/${r.key}`).remove();
  db.ref(`painel/${r.date}/criacaoNoturna/log`).push({by:`Admin ${_name||''}`.trim(), at:Date.now(), action:'desfez erro de criação', detail:r.nome});
  r.audit = null; renderCn();
  toast('Erro desfeito','ok');
}
async function exportCnXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  const rows = cnFiltered();
  if(!rows.length){ toast('Nada pra exportar','err'); return; }
  const aoa = [['Data','Torneio','Categoria','Horário','Criado por','Quando','Tempo (min)','ID Pokerbyte','Auditoria','Motivo do erro','Marcado por'],
    ...rows.map(r => [r.date, r.nome, r.cat, r.hora, r.doneBy, r.doneAt?new Date(r.doneAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'',
      r.dur?Math.round(r.dur/6000)/10:'', r.id, r.audit&&r.audit.status==='erro'?'ERRO':(r.doneBy?'OK':''), (r.audit&&r.audit.motivo)||'', (r.audit&&r.audit.by)||''])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:11},{wch:34},{wch:11},{wch:8},{wch:16},{wch:18},{wch:10},{wch:14},{wch:9},{wch:30},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Criação GU');
  XLSX.writeFile(wb, `AuditoriaCriacao_${document.getElementById('cnFrom').value}_${document.getElementById('cnTo').value}.xlsx`);
}

// Drill-down: pula da Grade/Dashboard direto pra Auditoria já filtrada pelo torneio,
// fechando o ciclo "detectei problema no gráfico → fui investigar as rodadas".
function goToAuditFor(nome){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(b=>b.classList.remove('active'));
  document.getElementById('pageAudit')?.classList.add('active');
  /* a aba é achada pelo data-act/data-arg. Antes o seletor era
     `.ntab[onclick*="'audit'"]`, casando pelo PRÓPRIO atributo onclick — com os
     handlers inline removidos ele não acharia mais nada, e o `?.` engoliria a
     falha em silêncio (a aba simplesmente não acenderia). */
  document.querySelector('.ntab[data-act="nav"][data-arg="audit"]')?.classList.add('active');
  const search = document.getElementById('auSearch');
  if(search) search.value = nome;
  // Auditoria por padrão olha os últimos 7 dias — abrir um período maior pra achar o torneio
  const from = document.getElementById('auFrom');
  if(from && from.value > dago(60)) from.value = dago(60);
  loadAudit();
}

/* ── INIT DATES ─────────────────────────────────────────────── */
function initDates(){
  const to=nowSP();
  const from=dago(6);
  ['auFrom','auTo'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el)el.value=i%2===0?from:to;
  });
  // popular operadores no select
  const ops=new Set();
  Object.values(_allData).forEach(day=>{
    Object.values(day.fixed).forEach(f=>{
      if(typeof f==='object'&&f?.by)ops.add(f.by);
    });
  });
  const sel=document.getElementById('auOp');
  if(sel){
    sel.innerHTML='<option value="">Todos</option>';
    [...ops].sort().forEach(op=>sel.innerHTML+=`<option value="${esc(op)}">${esc(op)}</option>`);
  }
}

/* ══════════════════════════════════════════════════════════════
   AUDITORIA — ACOMPANHAMENTO (visual idêntico ao painel)
══════════════════════════════════════════════════════════════ */
async function loadAudit(){
  const from=document.getElementById('auFrom')?.value||dago(6);
  const to  =document.getElementById('auTo')?.value||nowSP();
  const catF=document.getElementById('auCat')?.value||'';
  const stF =document.getElementById('auStatus')?.value||'';
  const opF =document.getElementById('auOp')?.value||'';
  const qF  =(document.getElementById('auSearch')?.value||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

  await Promise.all([loadAuditData()]);
  let rows=enrichWithAudit(flatRows(from,to));
  if(catF)rows=rows.filter(r=>r.cat===catF);
  if(stF) rows=rows.filter(r=>r.status===stF);
  if(opF) rows=rows.filter(r=>r.fixBy===opF||r.idBy===opF);
  if(qF)  rows=rows.filter(r=>r.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(qF));

  _auditRows=rows;

  // Agrupar por dia
  const byDate={};
  rows.forEach(r=>{
    if(!byDate[r.date])byDate[r.date]=[];
    byDate[r.date].push(r);
  });

  const dates=Object.keys(byDate).sort().reverse();
  const el=document.getElementById('auditResult');

  if(!dates.length){
    el.innerHTML=`<div class="empty"><div class="empty-icon">🔍</div><h3>Nenhum dado encontrado</h3><p>Ajuste o período ou os filtros</p></div>`;
    return;
  }

  try{ el.innerHTML=dates.map(date=>{
    const dayRows=byDate[date];
    const groups=[
      {cat:'main',rows:sortByTime(dayRows.filter(r=>r.cat==='main'))},
      {cat:'side',rows:sortByClock(dayRows.filter(r=>r.cat==='side'))},
      {cat:'sat', rows:sortByTime(dayRows.filter(r=>r.cat==='sat'))},
    ].filter(g=>g.rows.length);

    const allGar=dayRows.reduce((s,r)=>s+(r.garantido||0),0);
    const allPrem=dayRows.filter(r=>r.premiacao!=null).reduce((s,r)=>s+(r.premiacao||0),0);
    const allOv=dayRows.reduce((s,r)=>s+(r.overlay||0),0);
    const closed=dayRows.filter(r=>r.status==='fechado').length;
    // Status de auditoria do dia
    const totalDay = dayRows.length;
    const auditedDay = dayRows.filter(r=>r._audited).length;
    const semPrem = dayRows.filter(r=>r.status==='aberto').length;
    const dayStatusHtml = `
      <div style="display:flex;gap:10px;font-size:10.5px;color:var(--ink3);margin-left:auto">
        ${auditedDay>0?`<span style="color:var(--green)">✓ ${auditedDay} auditado${auditedDay>1?'s':''}</span>`:''}
        ${auditedDay<totalDay?`<span style="color:var(--amber)">⏳ ${totalDay-auditedDay} pendente${totalDay-auditedDay>1?'s':''}</span>`:''}
        ${semPrem>0?`<span style="color:var(--ink3)">📭 ${semPrem} sem premiação</span>`:''}
      </div>`;
    const groupsHtml=groups.map(g=>{
      const cc=CAT_COLORS[g.cat];
      let sumGar=0,sumPrem=0,sumOv=0,count=0;
      const rowsHtml=g.rows.map(r=>{
        const isNF=r.status==='nf';
        const hasOv=r.overlay!=null&&r.overlay<0;
        const cls=isNF?'nf':hasOv?'overlay':'';
        count++;
        if(r.garantido)sumGar+=r.garantido;
        if(r.premiacao)sumPrem+=r.premiacao;
        if(r.overlay)sumOv+=r.overlay;
        // 11. Detectar anomalias automaticamente (mesma regra da Central de Alertas)
        const anomalias = resultAnoms(r);
        const hasAnomalia = anomalias.length > 0 && !r._audited;
        const trCls = [cls, r._audited?'audit-edited':'', hasAnomalia?'anomalia':''].filter(Boolean).join(' ');
        const anomaliaHtml = hasAnomalia ? `<span title="${anomalias.join(', ')}" style="font-size:9px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:1px 5px;margin-left:4px">⚠ ${anomalias[0]}</span>` : '';
        return `<tr class="${trCls}" data-key="${r.key}" data-date="${r.date}">
          <td class="au-check"><input type="checkbox" class="row-check" data-key="${r.key}" data-date="${r.date}"
            style="accent-color:var(--gold);width:14px;height:14px"
            data-act="updateBatchActions" data-act-on="change"></td>
          <td class="nm" style="max-width:200px">${esc(r.nome)}${r.manual?'<span class="au-manual" title="Adicionado à mão pela ferramenta Adicionar torneio — não veio da Global">MANUAL</span>':''}${anomaliaHtml}</td>
          <td class="mono" data-label="Hora">${esc(r.hora)}</td>
          <td class="mono" data-label="Late">${esc(r.late)}</td>
          <td class="r mono" data-label="GTD">${r.garantido!=null?'R$ '+brl(r.garantido):'—'}</td>
          <td class="r mono" data-label="Buy-in">${r.buyin!=null?'R$ '+brl(r.buyin):'—'}</td>
          <td class="r mono ${r._audited&&r._auditEntry&&r._auditEntry.status==='corrigido'&&r._auditEntry.premiacaoOriginal!==r.premiacao?'c-gold':''}" data-label="Arrecadado">${r.premiacao!=null?'R$ '+brl(r.premiacao,2):'—'}</td>
          <td class="r mono ov-val" data-label="Overlay">${r.overlay!=null?'R$ '+brl(r.overlay,2):'—'}</td>
          <td class="r mono ${r._audited&&r._auditEntry&&r._auditEntry.status==='corrigido'&&r._auditEntry.fieldOriginal!==r.field?'c-gold':''}" data-label="Field">${r.field!=null?r.field:'—'}</td>
          <td class="r mono" data-label="Perf.">${r.perf!=null?`<span class="perf ${r.perf>=0?'pos':'neg'}">${pct(r.perf,2)}</span>`:'—'}</td>
          <td class="c-ink2" data-label="Fixou">${r.fixBy?`${esc(r.fixBy)}${r.fixAt?`<span style="display:block;font-size:9px;color:var(--ink3);font-family:var(--mono)">${esc(r.fixAt)}</span>`:''}${fixTimingBadge(r)}`:'—'}</td>
          <td class="c-ink2" data-label="Arrecadou">${r.premBy?`${esc(r.premBy)}${r.premByAt?`<span style="display:block;font-size:9px;color:var(--ink3);font-family:var(--mono)">${esc(r.premByAt)}</span>`:''}`:'—'}</td>
          <td class="mono c-ink2" data-label="ID">${esc(r.id)}</td>
          <td class="au-status" data-label="Status">${statusBadge(r.status)}</td>
          <td class="au-actions" style="display:flex;gap:5px;align-items:center">
            <button class="audit-edit-btn ${r._audited?'auditado':''}"
              data-key="${r.key}" data-date="${r.date}"
              data-act="openAuditEditByEl" data-act-self>
              ${r._audited ? '✓ Auditado' : '✏ Editar'}
            </button>
            <button class="btn-notif"
              data-nome="${esc(r.nome)}" data-date="${r.date}" data-fixby="${esc(r.premBy||r.fixBy||r.idBy||'')}" data-key="${r.key}"
              data-act="openNotifByEl" data-act-self>⚠ Notif</button>
            ${r.manual ? `<button class="btn-del-manual" title="Excluir este torneio adicionado à mão"
              data-key="${r.key}" data-date="${r.date}"
              data-act="removeAddedTorneioByEl" data-act-self aria-label="Excluir ${esc(r.nome)}">🗑</button>` : ''}
          </td>
        </tr>`;
      }).join('');

      return `<div class="audit-group">
        <div class="audit-group-header ${g.cat}">
          ${cc.label}
          <span class="audit-group-count">${count} torneio${count>1?'s':''}</span>
        </div>
        <div class="audit-scroll">
        <table class="audit-table">
          <thead><tr>
            <th style="width:32px"><input type="checkbox" id="checkAll" data-act="toggleCheckAll" data-act-self data-act-on="change" style="accent-color:var(--gold);width:14px;height:14px"></th>
            <th>Torneio</th><th>Hora</th><th>Late</th>
            <th class="r">GTD</th><th class="r">Buy-in</th><th class="r">Arrecadado</th>
            <th class="r">Overlay</th><th class="r">Field</th><th class="r">Perf.</th>
            <th>Fixou</th><th>Arrecadou</th><th>ID</th><th>Status</th><th>Auditoria</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        </div>
        <div class="audit-total">
          <span>Total (${count})</span>
          <span>GTD <strong>R$ ${brl(sumGar)}</strong></span>
          ${sumPrem?`<span>Arrecadado <strong>R$ ${brl(sumPrem)}</strong></span>`:''}
          ${sumOv?`<span>Overlay <strong class="c-red">R$ ${brl(sumOv)}</strong></span>`:''}
        </div>
      </div>`;
    }).join('');

    return `<div class="audit-day">
      <div class="audit-day-header">
        <div>
          <div class="audit-day-title">${fmtDate(date)}</div>
          <div class="audit-day-meta">${dayRows.length} torneio${dayRows.length>1?'s':''} · ${closed} fechado${closed>1?'s':''}</div>
        </div>
        <div style="display:flex;gap:20px;font-size:11px;font-family:var(--mono);color:var(--ink2)">
          ${allGar?`<span>GTD <strong class="c-gold">R$ ${brl(allGar)}</strong></span>`:''}
          ${allPrem?`<span>Arrec <strong class="c-green">R$ ${brl(allPrem)}</strong></span>`:''}
          ${allOv<0?`<span>Overlay <strong class="c-red">R$ ${brl(allOv)}</strong></span>`:''}
        </div>
      </div>
      ${groupsHtml}
    </div>`;
  }).join('');
  }catch(renderErr){
    console.error('[loadAudit] RENDER ERROR:', renderErr);
    el.innerHTML=`<div style="color:var(--red);padding:20px">Erro ao renderizar: ${renderErr.message}</div>`;
  }
}

/* ── DASHBOARD ───────────────────────────────────────────────── */
function setDp(n,btn){
  _dp=n; _dpFrom=null; _dpTo=null;                 // um preset limpa o range custom do calendário
  const f=document.getElementById('dpFrom'), t=document.getElementById('dpTo');
  if(f)f.value=''; if(t)t.value='';
  document.querySelectorAll('#dashTabs .ptab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  buildDash();
}
/* calendário: aplica um intervalo de datas exato (vence os presets 1d/7d/30d/90d) */
function applyDpRange(){
  const f=document.getElementById('dpFrom'), t=document.getElementById('dpTo');
  if(!f||!t||!f.value||!t.value) return;           // só aplica com as DUAS datas
  _dpFrom = f.value<=t.value ? f.value : t.value;  // tolera inverter início/fim
  _dpTo   = f.value<=t.value ? t.value : f.value;
  document.querySelectorAll('#dashTabs .ptab').forEach(b=>b.classList.remove('active'));
  buildDash();
}

async function buildDashCn(){
  const el = document.getElementById('dashCnKpi');
  if(!el) return;
  try{
    const s = await cnStatsByOp(dago(29), nowSP());
    const pct = (a,b) => b ? Math.round(a/b*100)+'%' : '—';
    const avg = s.durN ? (s.durSum/s.durN/60000) : null;
    const topOp = Object.entries(s.byOp).sort((a,b)=>b[1].criados-a[1].criados)[0];
    el.innerHTML = `
      <div class="kpi g"><div class="kpi-label">Torneios criados</div><div class="kpi-val">${s.criados}</div><div class="kpi-sub">${pct(s.criados,s.total)} da grade · ${s.dias} noite(s)</div></div>
      <div class="kpi b"><div class="kpi-label">Com ID Pokerbyte</div><div class="kpi-val">${pct(s.comId,s.criados)}</div><div class="kpi-sub">${s.comId} de ${s.criados}</div></div>
      <div class="kpi p"><div class="kpi-label">Tempo médio</div><div class="kpi-val">${avg?avg.toFixed(1)+'m':'—'}</div><div class="kpi-sub">${s.durN} medidos no modo foco</div></div>
      <div class="kpi ${s.erros?'r':'g'}"><div class="kpi-label">Erros de criação</div><div class="kpi-val">${s.erros}</div><div class="kpi-sub">taxa ${pct(s.erros,s.criados)}</div></div>
      <div class="kpi"><div class="kpi-label">Top criador</div><div class="kpi-val" style="font-size:20px">${topOp?esc(topOp[0]):'—'}</div><div class="kpi-sub">${topOp?topOp[1].criados+' criados':'sem dados'}</div></div>`;
  }catch(e){ el.innerHTML = '<div class="kpi"><div class="kpi-label">Erro ao carregar</div><div class="kpi-sub">'+esc(e.message)+'</div></div>'; }
}
// Tooltip flutuante compartilhado pros cards [data-tip]. Delegação no document
// (sobrevive aos re-renders do dashKpi) + segue o cursor com position:fixed.
let _tipBound=false;
function initKpiTips(){
  if(_tipBound)return; _tipBound=true;
  let t=document.getElementById('supTip');
  if(!t){ t=document.createElement('div'); t.id='supTip'; t.className='sup-tip'; document.body.appendChild(t); }
  const place=e=>{
    const pad=15, w=t.offsetWidth, h=t.offsetHeight;
    let x=e.clientX+pad, y=e.clientY+pad;
    if(x+w>innerWidth-8)  x=e.clientX-w-pad;
    if(y+h>innerHeight-8) y=e.clientY-h-pad;
    t.style.left=Math.max(8,x)+'px'; t.style.top=Math.max(8,y)+'px';
  };
  document.addEventListener('mouseover',e=>{
    const el=e.target.closest && e.target.closest('[data-tip]');
    if(el){ t.innerHTML=el.getAttribute('data-tip')||''; t.classList.add('on'); place(e); }
  });
  document.addEventListener('mousemove',e=>{ if(t.classList.contains('on'))place(e); });
  document.addEventListener('mouseout',e=>{
    const el=e.target.closest && e.target.closest('[data-tip]');
    if(el && !el.contains(e.relatedTarget)) t.classList.remove('on');
  });
}
function buildDash(){
  buildDashCn();
  const from=_dpFrom||dago(_dp), to=_dpTo||nowSP();
  const spanDays=_dpFrom?(Math.round((new Date(to)-new Date(from))/86400000)+1):_dp;
  const janela=_dpFrom?`${from.slice(8,10)}/${from.slice(5,7)}–${to.slice(8,10)}/${to.slice(5,7)}`:`${_dp}d janela`;
  const rows=flatRows(from,to);
  const closed=rows.filter(r=>r.premiacao!=null);
  const withOv=closed.filter(r=>r.overlay!=null&&r.overlay<0);
  const totalGar=rows.reduce((s,r)=>s+(r.garantido||0),0);
  const totalPrem=closed.reduce((s,r)=>s+(r.premiacao||0),0);
  const totalOv=closed.reduce((s,r)=>s+(r.overlay||0),0);
  const avgPerf=closed.filter(r=>r.perf!=null).length?
    closed.filter(r=>r.perf!=null).reduce((s,r)=>s+r.perf,0)/closed.filter(r=>r.perf!=null).length:null;

  const nfRows   = rows.filter(r=>r.status==='nf');
  const dias     = [...new Set(rows.map(r=>r.date))].length;
  const totalGarSum = rows.reduce((s,r)=>s+(r.garantido||0),0);
  const cobertura = totalGarSum>0?(totalPrem/totalGarSum*100):0;

  // ── ARRECADADO + RAKE + ADMIN FEE ──────────────────────────────────────
  // A premiação é o LÍQUIDO (parte da entrada que vira prize pool). O bruto
  // arrecadado = premiação ÷ netFactor. A casa fica com (1−netFactor):
  //   normal netFactor 0,90 → 10% rake · campanha 0,88 → 10% rake + 2% admin ·
  //   satélite 0,95 → 5% rake. Admin fee em evento SPS (inclui "SPS … +SPT",
  //   que É SPS main/side com admin fee). Satélite PURO do SPT ("N Seats SPT")
  //   não é SPS → 5% sem admin. Só rows FECHADAS (têm prem).
  //   ISSO É A REDE. Quando a linha traz FEE/ADMIN FEE da GU (o normal desde a
  //   mudança), flatRows já gravou rakeFrac/adminFrac e é isso que vale aqui.
  let grossSum=0, rakeSum=0, adminSum=0, entradas=0, adminEvents=0;
  const catAgg={main:{gross:0,rake:0,admin:0,ov:0,gar:0,prem:0,n:0},side:{gross:0,rake:0,admin:0,ov:0,gar:0,prem:0,n:0},sat:{gross:0,rake:0,admin:0,ov:0,gar:0,prem:0,n:0}};
  rows.forEach(r=>{ const c=catAgg[r.cat]; if(c && r.garantido) c.gar+=r.garantido; });
  closed.forEach(r=>{
    if(r.premiacao==null || !r.netFactor) return;
    const gross    = r.premiacao / r.netFactor;
    const adminFrac= r.adminFrac != null ? r.adminFrac
                   : (/^\s*SPS\b/i.test(r.nome||'') ? DASH_RATES.adminPct : 0);
    const rakeFrac = r.rakeFrac != null ? r.rakeFrac
                   : Math.max(0, (1 - r.netFactor) - adminFrac);
    const gRake=gross*rakeFrac, gAdmin=gross*adminFrac;
    grossSum += gross; adminSum += gAdmin; rakeSum += gRake;
    if(r.acoes) entradas += r.acoes;
    if(adminFrac>0) adminEvents++;
    const c=catAgg[r.cat];
    if(c){ c.gross+=gross; c.rake+=gRake; c.admin+=gAdmin; c.prem+=r.premiacao; if(r.overlay)c.ov+=r.overlay; c.n++; }
  });
  const houseSum = rakeSum + adminSum;                       // receita da casa (rake+admin)
  const rakePct  = grossSum>0 ? rakeSum/grossSum*100 : 0;
  const housePct = grossSum>0 ? houseSum/grossSum*100 : 0;
  const overlayPctGar = totalGar>0 ? Math.abs(totalOv)/totalGar*100 : 0;   // overlay como % do GTD
  const margem   = houseSum - Math.abs(totalOv);             // margem real: receita − overlay coberto
  const ticket   = entradas>0 ? grossSum/entradas : 0;       // arrecadado por entrada
  const fieldMed = closed.length ? entradas/closed.length : 0;
  const rakeDiaReal = dias>0 ? houseSum/dias : houseSum;     // receita da casa por dia
  // metas + semáforo
  const gOvl = +DASH_GOALS.overlayPct||0, gRakeDia = +DASH_GOALS.rakeDia||0;
  const ovlOK  = gOvl>0 ? overlayPctGar<=gOvl : null;
  const rakeOK = gRakeDia>0 ? rakeDiaReal>=gRakeDia : null;
  const garByCat = {main:catAgg.main.gar,side:catAgg.side.gar,sat:catAgg.sat.gar};
  const intBR = n => Math.round(n||0).toLocaleString('pt-BR');
  // tooltip flutuante (HTML rico em data-tip; renderizado pelo initKpiTips).
  // Sem aspas duplas no conteúdo → seguro dentro de data-tip="...".
  const tRow=(k,v)=>`<div class='tip-l'><span>${k}</span><b>${v}</b></div>`;
  const tCard=(head,big,rows,foot)=>`<div class='tip-h'>${head}</div><div class='tip-b'>${big}</div>${rows.join('')}${foot?`<div class='tip-f'>${foot}</div>`:''}`;
  const garTip = tCard('Garantido prometido','R$ '+brl(totalGar,0),[
    tRow('Main','R$ '+brl(garByCat.main,0)), tRow('Side','R$ '+brl(garByCat.side,0)), tRow('Satélite','R$ '+brl(garByCat.sat,0)),
  ],`Premiação cobre ${cobertura.toFixed(0)}% do garantido`);
  const arrTip = tCard('Arrecadado (bruto)','R$ '+brl(grossSum,0),[
    tRow('Premiação','R$ '+brl(totalPrem,0)), tRow('Rake','R$ '+brl(rakeSum,0)), tRow('Admin fee','R$ '+brl(adminSum,0)), tRow('Entradas',intBR(entradas)),
  ],`A casa fica com ${housePct.toFixed(1)}% do arrecadado`);
  const rakeTip = tCard('Rake gerado','R$ '+brl(rakeSum,0),[
    tRow('Admin fee','R$ '+brl(adminSum,0)), tRow('Receita da casa','R$ '+brl(houseSum,0)),
  ],`Média de ${rakePct.toFixed(1)}% do arrecadado`);
  const admTip = tCard('Admin fee gerado','R$ '+brl(adminSum,0),[
    tRow('Eventos c/ admin',intBR(adminEvents)), tRow('Taxa',(DASH_RATES.adminPct*100).toFixed(0)+'% do buy-in'),
  ],'Eventos SPS (inclui SPS +SPT) — satélites puros do SPT não têm admin fee');
  const houseTip = tCard('Receita da casa','R$ '+brl(houseSum,0),[
    tRow('Rake','R$ '+brl(rakeSum,0)), tRow('Admin fee','R$ '+brl(adminSum,0)),
    tRow('Overlay coberto','−R$ '+brl(Math.abs(totalOv),0)), tRow('Margem real','R$ '+brl(margem,0)),
  ],`${housePct.toFixed(1)}% do arrecadado · R$ ${brl(rakeDiaReal,0)}/dia`);
  const margTip = tCard('Margem real','R$ '+brl(margem,0),[
    tRow('Receita da casa','R$ '+brl(houseSum,0)), tRow('Overlay','−R$ '+brl(Math.abs(totalOv),0)),
  ],'O que sobra pra casa depois de cobrir o garantido');
  const tickTip = tCard('Ticket médio','R$ '+brl(ticket,0),[
    tRow('Arrecadado','R$ '+brl(grossSum,0)), tRow('Entradas',intBR(entradas)), tRow('Field médio',intBR(fieldMed)+'/torneio'),
  ],'Quanto cada entrada colocou em média');
  initKpiTips();

  document.getElementById('dashKpi').innerHTML=`
    <div class="kpi"><div class="kpi-label">Torneios</div><div class="kpi-val">${rows.length}</div><div class="kpi-sub">${dias} dia${dias>1?'s':''} · ${janela}</div></div>
    <div class="kpi"><div class="kpi-label">Fechados</div><div class="kpi-val">${closed.length}</div><div class="kpi-sub">${rows.length?Math.round(closed.length/rows.length*100):0}% do total</div></div>
    <div class="kpi b" data-tip="${garTip}"><div class="kpi-label">Garantido</div><div class="kpi-val">${brlk(totalGar)}</div><div class="kpi-sub">GTD prometido · passe o mouse p/ detalhe</div></div>
    <div class="kpi b" data-tip="${arrTip}"><div class="kpi-label">Arrecadado (bruto)</div><div class="kpi-val">${brlk(grossSum)}</div><div class="kpi-sub">${intBR(entradas)} entradas · casa ${housePct.toFixed(1)}%</div></div>
    <div class="kpi g"><div class="kpi-label">Premiação total</div><div class="kpi-val">${brlk(totalPrem)}</div><div class="kpi-sub">Cobertura ${cobertura.toFixed(0)}% do GTD</div></div>
    <div class="kpi g" data-tip="${rakeTip}"><div class="kpi-label">Rake gerado</div><div class="kpi-val">${brlk(rakeSum)}</div><div class="kpi-sub">${rakePct.toFixed(1)}% do arrecadado · +admin = ${brlk(houseSum)}</div></div>
    <div class="kpi p" data-tip="${admTip}"><div class="kpi-label">Admin fee</div><div class="kpi-val">${brlk(adminSum)}</div><div class="kpi-sub">${adminEvents} evento(s) SPS · ${(DASH_RATES.adminPct*100).toFixed(0)}% do buy-in</div></div>
    <div class="kpi ${rakeOK==null?'g':rakeOK?'g':'r'}" data-tip="${houseTip}"><div class="kpi-label">Receita da casa</div><div class="kpi-val">${brlk(houseSum)}</div><div class="kpi-sub">R$ ${brl(rakeDiaReal,0)}/dia${gRakeDia>0?` · meta ≥ ${brlk(gRakeDia)} ${rakeOK?'✓':'✗'}`:''}</div></div>
    <div class="kpi ${margem>=0?'g':'r'}" data-tip="${margTip}"><div class="kpi-label">Margem real</div><div class="kpi-val">${brlk(margem)}</div><div class="kpi-sub">receita − overlay coberto</div></div>
    <div class="kpi b" data-tip="${tickTip}"><div class="kpi-label">Ticket médio</div><div class="kpi-val">${brlk(ticket)}</div><div class="kpi-sub">field médio ${intBR(fieldMed)}/torneio</div></div>
    <div class="kpi ${ovlOK==null?'r':ovlOK?'g':'r'}"><div class="kpi-label">Overlay total</div><div class="kpi-val">${brlk(Math.abs(totalOv))}</div><div class="kpi-sub">${overlayPctGar.toFixed(1)}% do GTD${gOvl>0?` · meta ≤ ${gOvl}% ${ovlOK?'✓':'✗'}`:''}</div></div>
    <div class="kpi b"><div class="kpi-label">Perf. média</div><div class="kpi-val">${avgPerf!=null?pct(avgPerf):'—'}</div><div class="kpi-sub">vs garantido prometido</div></div>
    <div class="kpi p"><div class="kpi-label">NF no período</div><div class="kpi-val">${nfRows.length}</div><div class="kpi-sub">${rows.length?Math.round(nfRows.length/rows.length*100):0}% não formaram</div></div>
  `;
  // ── alerta proativo + quebra por categoria + settings (metas/taxas) ──
  renderDashAlert(overlayPctGar, gOvl, totalOv, rakeDiaReal, gRakeDia, rows.excludedNoStamp);
  renderDashCampaigns();
  renderDashCatBreakdown(catAgg);
  renderDashSettings();

  // Top overlay
  const byName={};
  closed.forEach(r=>{
    if(!byName[r.nome])byName[r.nome]={nome:r.nome,cat:r.cat,gar:0,prem:0,ov:0,n:0};
    byName[r.nome].gar+=r.garantido||0;
    byName[r.nome].prem+=r.premiacao||0;
    if(r.overlay)byName[r.nome].ov+=r.overlay;
    byName[r.nome].n++;
  });
  const top=Object.values(byName).filter(v=>v.ov<0).sort((a,b)=>a.ov-b.ov).slice(0,10);
  const maxOv=Math.abs(Math.min(...top.map(v=>v.ov),-1));
  document.getElementById('dashOverlayTable').innerHTML=top.length?top.map(v=>{
    const perf=v.gar>0?(v.prem-v.gar)/v.gar*100:null;
    const barPct=Math.round(Math.abs(v.ov)/maxOv*100);
    return `<tr>
      <td class="nm">${esc(v.nome)}</td>
      <td>${catBadge(v.cat)}</td>
      <td class="r mono">${brlk(v.gar/v.n)}</td>
      <td class="r mono">${brlk(v.prem/v.n)}</td>
      <td class="r mono c-red">${brlk(v.ov)}</td>
      <td class="r">${perf!=null?`<span class="perf neg">${pct(perf)}</span>`:'—'}</td>
      <td style="min-width:80px"><div class="bar"><div class="bar-fill" style="width:${barPct}%;background:var(--red)"></div></div></td>
      <td><button class="btn btn-ghost btn-sm" data-act="goToAuditFor" data-arg="${esc(v.nome)}">🔍 Auditar</button></td>
    </tr>`;
  }).join(''):`<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink3)">Sem overlay no período</td></tr>`;

  // ── Insights inteligentes ──
  buildInsights(rows, closed, spanDays);
  // ── Projeção do mês ──
  buildMonthProjection();

  // ── 11. Comparativo semana a semana ──
  buildWeeklyComparison();

  // ── Overlay por horário + Tendência de field (antes eram modais na topbar) ──
  buildHeatmap();
  buildFieldTrend();
}

// Alerta proativo: overlay acima do teto ou receita/dia abaixo da meta.
function renderDashAlert(ovlPct, gOvl, totalOv, rakeDia, gRakeDia, excl){
  const el=document.getElementById('dashAlert'); if(!el)return;
  const a=[];
  if(gOvl>0 && ovlPct>gOvl) a.push({t:`Overlay em ${ovlPct.toFixed(1)}% do garantido — acima do teto de ${gOvl}%`,
    s:`R$ ${brl(Math.abs(totalOv),0)} pagos pela casa além do arrecadado. Revisar garantidos e fields dos eventos que mais estouram.`});
  if(gRakeDia>0 && rakeDia<gRakeDia) a.push({t:`Receita da casa em R$ ${brl(rakeDia,0)}/dia — abaixo da meta de ${brlk(gRakeDia)}`,
    s:`Faltam R$ ${brl(gRakeDia-rakeDia,0)}/dia. Puxar arrecadação (field) ou revisar a estrutura de rake.`});
  // Transparência do gate: premiação de snapshot barrada por falta de carimbo de coleta.
  // Espera-se >0 quando há dias antigos com fantasma da planilha (o que foi corrigido) — só é
  // "erro" se o Brian reconhecer algum desses dias como fechado REAL. Nunca é descarte silencioso.
  if(excl && excl.count>0){
    const dd=excl.dates||[];
    const per=dd.length?` em ${dd.length} dia${dd.length>1?'s':''} (${dd.slice(0,6).map(fmtDate).join(', ')}${dd.length>6?'…':''})`:'';
    a.push({info:true, t:`${excl.count} premiaç${excl.count>1?'ões':'ão'} de snapshot sem carimbo foram excluídas — R$ ${brl(excl.value,0)}${per}`,
      s:`São valores da coluna "Premiação" da planilha em snapshots antigos (nunca coletados). Se você reconhece algum desses dias como fechado de verdade, me avise para reprocessar.`});
  }
  if(!a.length){ el.innerHTML=''; el.style.display='none'; return; }
  el.style.display='';
  el.innerHTML=a.map(x=>{
    const c = x.info ? 'var(--ink3)' : 'var(--red)';
    const ic= x.info ? 'ℹ' : '⚠';
    return `<div class="card" style="border:1px solid ${c};background:color-mix(in srgb,${c} 8%,transparent);margin-bottom:12px;display:flex;gap:12px;align-items:center;padding:12px 14px">
    <div style="font-size:22px;color:${c};line-height:1">${ic}</div>
    <div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:800;color:var(--ink)">${esc(x.t)}</div><div style="font-size:11px;color:var(--ink2);margin-top:1px">${esc(x.s)}</div></div>
  </div>`;}).join('');
}

// Receita por categoria (Main/Side/Satélite): onde o dinheiro entra e onde o overlay corrói.
function renderDashCatBreakdown(catAgg){
  const el=document.getElementById('dashCatBreakdown'); if(!el)return;
  const cats=[{k:'main',n:'Main'},{k:'side',n:'Side'},{k:'sat',n:'Satélite'}];
  const tot={gross:0,rake:0,admin:0,ov:0,gar:0};
  cats.forEach(c=>{const x=catAgg[c.k];tot.gross+=x.gross;tot.rake+=x.rake;tot.admin+=x.admin;tot.ov+=x.ov;tot.gar+=x.gar;});
  const row=(n,x,bold)=>{const house=x.rake+x.admin, marg=house-Math.abs(x.ov);
    return `<tr${bold?' style="font-weight:700;border-top:2px solid var(--border)"':''}>
      <td class="nm">${n}</td>
      <td class="r mono">${brlk(x.gar)}</td><td class="r mono">${brlk(x.gross)}</td>
      <td class="r mono c-green">${brlk(x.rake)}</td><td class="r mono">${brlk(x.admin)}</td>
      <td class="r mono ${x.ov<0?'c-red':''}">${brlk(x.ov)}</td>
      <td class="r mono ${marg>=0?'c-green':'c-red'}">${brlk(marg)}</td></tr>`;};
  el.innerHTML=`<div class="tbl-wrap"><table>
    <thead><tr><th>Categoria</th><th class="r">GTD</th><th class="r">Arrecadado</th><th class="r">Rake</th><th class="r">Admin</th><th class="r">Overlay</th><th class="r">Margem</th></tr></thead>
    <tbody>${cats.map(c=>row(c.n,catAgg[c.k])).join('')}${row('Total',tot,true)}</tbody></table></div>`;
}

// Resultados das campanhas: cada série (SPS na janela do festival, SPT o ano
// todo) com os MESMOS números do telão — motor testado campanha-core, filtro
// por prefixo. Cada card abre um drill-down por torneio com link pra auditoria.
function renderDashCampaigns(){
  const el=document.getElementById('dashCampaigns'); if(!el) return;
  if(typeof CampanhaCore==='undefined'){ el.innerHTML='<div style="font-size:12px;color:var(--ink3)">Motor da campanha (campanha-core.js) não carregou.</div>'; return; }
  if(!_campaigns.length){ el.innerHTML='<div style="font-size:12px;color:var(--ink3)">Nenhuma campanha configurada.</div>'; return; }
  const today=nowSP();
  const stat=(lab,val,cls)=>`<div><div style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);margin-bottom:3px">${lab}</div><div class="mono ${cls||''}" style="font-size:16px;font-weight:800;color:var(--ink)">${val}</div></div>`;
  const pill=(txt,bg,fg)=>`<span style="font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:${bg};color:${fg}">${txt}</span>`;
  // matcher da campanha: 'prefix' (SPS no começo — igual ao isSPS/telão) ou
  // 'word' (SPT em qualquer posição, ex.: "3 Seats SPT", "4 Seats SPT").
  const campMatcher=cmp=>{
    const esc1=s=>String(s||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const term=esc1(cmp.prefix||cmp.slug);
    if(!term) return ()=>false;
    const re = cmp.match==='word' ? new RegExp('\\b'+term+'\\b','i') : new RegExp('^\\s*'+term+'\\b','i');
    // exclusão: notMatch (palavra) ou notPattern (regex crua, ex.: SPT exclui "+SPT")
    const notRe = cmp.notMatch ? new RegExp('\\b'+esc1(cmp.notMatch)+'\\b','i')
                : cmp.notPattern ? new RegExp(cmp.notPattern,'i') : null;
    return nome=>{ const n=String(nome||''); return re.test(n) && (!notRe || !notRe.test(n)); };
  };
  const intBR=n=>Math.round(n||0).toLocaleString('pt-BR');
  const fmtDshort=d=>d?`${d.slice(8,10)}/${d.slice(5,7)}`:'—';
  // Fonte de dados: histórico COMPLETO quando pronto (_campAllData), senão os
  // 60 dias do dashboard (_allData) pra pintar rápido. Campanhas contínuas (SPT)
  // dependem do histórico completo — dispara a carga única e re-renderiza.
  const DATA = _campAllData || _allData;
  const fullReady = !!_campAllData;
  const needsFull = _campaigns.some(c=> c.continuous || (!c.inicio && !c.fim) || (c.inicio && c.inicio < dago(60)));
  if(needsFull && !fullReady && !_campDataLoading && !_campDataTried){ loadCampaignData().then(()=>renderDashCampaigns()); }
  el.innerHTML=_campaigns.map(cmp=>{
    const pfx=cmp.prefix || String(cmp.nome||cmp.slug||'').trim().split(/\s+/)[0];
    // continuous = roda o ano todo (SPT): sem janela → pega TODOS os eventos do prefixo.
    const isCont = cmp.continuous || (!cmp.inicio && !cmp.fim);
    // Corta em HOJE (igual ao clampTo do telão): "resultado" não inclui evento que
    // ainda não rodou. Sem isso, a madrugada de amanhã (já fixada) entraria como aberta.
    const toClamp = isCont ? today : ((cmp.fim && cmp.fim < today) ? cmp.fim : today);
    let rows=CampanhaCore.flatRows(DATA, _auditData||{}, isCont?null:cmp.inicio, toClamp, {filter:campMatcher(cmp), rates:DASH_RATES});
    // aplica correções de auditoria (premiação/garantido/field auditados), igual à aba Auditoria
    if(typeof enrichWithAudit==='function') rows=enrichWithAudit(rows).map(r=> (r.premiacao!=null && r.status==='aberto') ? {...r, status:'fechado'} : r);
    const t=CampanhaCore.aggregate(rows, DASH_RATES);
    // Meta (arrecadado) = garantido planejado × (1+margem); nunca menor que o já jogado; meta manual maior prevalece.
    let garBase=(cmp.garantidoSerie!=null?+cmp.garantidoSerie:0)||0;
    if(t.totalGarantido>garBase) garBase=t.totalGarantido;
    let meta=Math.round(garBase*(1+CAMP_META_MARGIN));
    if(cmp.meta!=null && +cmp.meta>meta) meta=+cmp.meta;
    const prog=meta>0?(t.arrecadadoBruto/meta*100):0;
    const rangeLabel = isCont ? 'roda o ano todo' : `${fmtDshort(cmp.inicio)} → ${fmtDshort(cmp.fim)}`;
    const st = isCont            ? pill('Em curso','rgba(34,197,94,.16)','var(--green)')
             : today<cmp.inicio  ? pill('Agendada','rgba(59,130,246,.15)','#3b82f6')
             : today>cmp.fim     ? pill('Encerrada','var(--s2,rgba(0,0,0,.08))','var(--ink3)')
             :                     pill('Em curso','rgba(34,197,94,.16)','var(--green)');
    // enquanto o histórico completo não chega, campanha contínua ainda está com dados parciais (60d)
    const loadingFull = (isCont || (cmp.inicio && cmp.inicio<dago(60))) && !fullReady;
    const loadHint = loadingFull ? `<span style="font-size:10px;color:var(--gold)">⏳ carregando histórico completo…</span>` : '';
    const emptyMsg = loadingFull ? `Carregando o histórico do 1º dia até hoje…`
                   : isCont ? `Sem eventos ${esc(pfx)} nos dados carregados.` : `Sem eventos ${esc(pfx)} na janela desta campanha.`;
    const empty = t.torneios===0 ? `<div style="font-size:12px;color:var(--ink3);margin-top:4px">${emptyMsg}</div>` : '';
    const note = cmp.note ? `<span style="font-size:10.5px;color:var(--ink3)">${esc(cmp.note)}</span>` : '';

    // ── Drill-down por torneio: cada evento com o financeiro por linha, e 🔍 que
    //    salta pra aba Auditoria já filtrada pelo torneio (goToAuditFor). ──
    const sorted = rows.slice().sort((a,b)=> String(b.date).localeCompare(String(a.date)) || String(a.hora).localeCompare(String(b.hora)));
    const trs = sorted.map(r=>{
      // rake/admin já resolvidos por CampanhaCore.flatRows (GU ou estimativa)
      const adminFrac=r.adminFrac!=null?r.adminFrac:(CampanhaCore.isCampRate(r.nome)?DASH_RATES.adminPct:0);
      const rakeFrac=r.rakeFrac!=null?r.rakeFrac:Math.max(0,(1-(r.netFactor||0))-adminFrac);
      const gross=r.premiacao!=null&&r.netFactor?r.premiacao/r.netFactor:null;
      const gRake=gross!=null?gross*rakeFrac:null;
      const gAdmin=gross!=null?gross*adminFrac:null;
      const rateLbl=`${(rakeFrac*100).toFixed(0)}%${adminFrac>0?' + '+(adminFrac*100).toFixed(0)+'%':''}`;
      const tag = r.status!=='fechado' ? ` <span style="font-size:9px;color:var(--ink3)">(${r.status})</span>` : '';
      const auMark = r._audited ? ` <span title="Auditado" style="font-size:9px;color:var(--green);font-weight:700">✓ aud.</span>` : '';
      return `<tr${r.status!=='fechado'?' style="opacity:.72"':''}>
        <td class="mono">${fmtDshort(r.date)}</td>
        <td class="mono">${esc(r.hora||'—')}</td>
        <td class="nm">${esc(r.nome)}${auMark}${tag}</td>
        <td class="r mono">${r.garantido!=null?brlk(r.garantido):'—'}</td>
        <td class="r mono">${r.buyin!=null?'R$'+brl(r.buyin,0):'—'}</td>
        <td class="r mono">${rateLbl}</td>
        <td class="r mono">${r.acoes!=null?intBR(r.acoes):'—'}</td>
        <td class="r mono">${gross!=null?brlk(gross):'—'}</td>
        <td class="r mono c-green">${gRake!=null?brlk(gRake):'—'}</td>
        <td class="r mono">${gAdmin!=null?(gAdmin>0?brlk(gAdmin):'R$0'):'—'}</td>
        <td class="r mono ${r.overlay<0?'c-red':''}">${r.overlay!=null?brlk(r.overlay):'—'}</td>
        <td class="r mono">${r.perf!=null?pct(r.perf):'—'}</td>
        <td><button class="btn btn-ghost btn-sm" data-act="goToAuditFor" data-arg="${esc(r.nome)}" title="Abrir na auditoria">🔍</button></td>
      </tr>`;
    }).join('');
    const table = rows.length ? `<details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--gold);user-select:none;list-style:none">▸ Ver ${rows.length} torneio${rows.length>1?'s':''} · clique 🔍 pra auditar</summary>
      <div class="tbl-wrap" style="margin-top:8px">
        <table>
          <thead><tr>
            <th>Data</th><th>Início</th><th>Torneio</th><th class="r">Garantido</th><th class="r">Buy-in</th>
            <th class="r">Rake · admin</th><th class="r">Ações</th><th class="r">Arrecadado</th>
            <th class="r">Rake R$</th><th class="r">Admin R$</th><th class="r">Overlay</th><th class="r">Perf</th><th></th>
          </tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    </details>` : '';

    return `<div style="border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:12px;background:var(--s1)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:15px;font-weight:800;color:var(--ink)">${esc(cmp.nome||cmp.slug)}</span>
          <span style="font-size:11px;color:var(--ink3)">${rangeLabel}</span>
          ${note}
          ${loadHint}
        </div>${st}
      </div>
      ${meta>0 ? `<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink2);margin-bottom:5px">
          <span>Arrecadado <b style="color:var(--ink)">${brlk(t.arrecadadoBruto)}</b> · meta ${brlk(meta)}</span>
          <span style="font-weight:800;color:${prog>=100?'var(--green)':'var(--gold)'}">${prog.toFixed(0)}%</span>
        </div>
        <div style="height:8px;border-radius:6px;background:var(--s2,rgba(0,0,0,.08));overflow:hidden"><div style="height:100%;width:${Math.max(0,Math.min(100,prog))}%;background:linear-gradient(90deg,var(--gold),#c9a84c)"></div></div>
      </div>` : `<div style="margin-bottom:14px;font-size:11px;color:var(--ink3)">Sem meta definida · arrecadado <b style="color:var(--ink)">${brlk(t.arrecadadoBruto)}</b> <span style="opacity:.7">(defina o garantido da série em campanhas/${esc(cmp.slug)} pra ver o progresso)</span></div>`}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:14px 12px">
        ${stat('Arrecadado', brlk(t.arrecadadoBruto))}
        ${stat('Rake', brlk(t.rake))}
        ${stat('Admin fee', brlk(t.adminFee))}
        ${stat('Receita da casa', brlk(t.receitaCasa))}
        ${stat('Premiação', brlk(t.totalPremiacao))}
        ${stat('Overlay', brlk(t.totalOverlay), t.totalOverlay<0?'c-red':'')}
        ${stat('Cobertura', t.totalGarantido>0?(t.cobertura||0).toFixed(0)+'%':'—')}
        ${stat('Torneios', t.fechados+'/'+t.torneios)}
      </div>${empty}${table}
    </div>`;
  }).join('');
}

// Editor de metas + taxas (salva no Firebase; re-renderiza a dashboard).
function renderDashSettings(){
  const el=document.getElementById('dashSettings'); if(!el)return;
  const g=DASH_GOALS, r=DASH_RATES;
  const inp=(id,val,step)=>`<input id="${id}" type="number" step="${step||'1'}" value="${val}" style="width:78px;height:32px;border:1px solid var(--border);border-radius:8px;background:var(--s1);color:var(--ink);text-align:right;padding:0 8px;font-weight:700">`;
  const fld=(lab,ctrl)=>`<div><div style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px">${lab}</div><div style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2)">${ctrl}</div></div>`;
  const sep=`<div style="width:1px;align-self:stretch;background:var(--border)"></div>`;
  el.innerHTML=`
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end">
      ${fld('Meta rake/dia (mín)','R$ '+inp('dgRakeDia',g.rakeDia,'100'))}
      ${fld('Teto overlay (% GTD)',inp('dgOvl',g.overlayPct,'0.5')+' %')}
      ${sep}
      ${fld('Casa retém — normal',inp('drNormal',((1-r.normal)*100).toFixed(1),'0.5')+' %')}
      ${fld('Casa retém — campanha',inp('drCamp',((1-r.campanha)*100).toFixed(1),'0.5')+' %')}
      ${fld('Casa retém — satélite',inp('drSat',((1-r.sat)*100).toFixed(1),'0.5')+' %')}
      ${fld('Admin fee (na campanha)',inp('drAdmin',(r.adminPct*100).toFixed(1),'0.5')+' %')}
      <button class="btn btn-gold btn-sm" data-act="saveDashSettingsFromUI">Salvar</button>
    </div>
    <div style="font-size:10.5px;color:var(--ink3);margin-top:9px">"Casa retém" = fração da entrada que NÃO vai pro prize (rake + admin). <b>Estas taxas são a REDE:</b> o rake de cada torneio vem das colunas FEE e ADMIN FEE da planilha da GU. Só evento sem essas colunas (histórico antigo, Liga Principal) cai nos valores acima. Salvo no Firebase, vale pra todos os painéis.</div>`;
}
function saveDashSettingsFromUI(){
  const num=id=>{const e=document.getElementById(id);const v=e?parseFloat(String(e.value).replace(',','.')):NaN;return isFinite(v)?v:0;};
  const clampF=p=>Math.min(0.999,Math.max(0,1-p/100));   // % retido → netFactor
  const goals={ rakeDia:Math.max(0,num('dgRakeDia')), overlayPct:Math.max(0,num('dgOvl')) };
  const rates={ normal:clampF(num('drNormal')), campanha:clampF(num('drCamp')), sat:clampF(num('drSat')), adminPct:Math.max(0,Math.min(0.5,num('drAdmin')/100)) };
  saveDashSettings(goals, rates).then(()=>{ try{buildDash();}catch(_){}} );
}

function buildWeeklyComparison(){
  const el = document.getElementById('weeklyComparison');
  if(!el) return;

  // Últimas 4 semanas
  const weeks = [];
  for(let w=0;w<4;w++){
    const from = dago(7*(w+1));
    const to   = dago(7*w);
    const rows = flatRows(from, to).filter(r=>r.premiacao!=null);
    if(!rows.length){ weeks.push(null); continue; }
    const gar   = rows.reduce((s,r)=>s+(r.garantido||0),0);
    const prem  = rows.reduce((s,r)=>s+(r.premiacao||0),0);
    const ov    = rows.reduce((s,r)=>s+(r.overlay||0),0);
    const house = rows.reduce((s,r)=>s+((r.premiacao!=null&&r.netFactor)?(r.premiacao/r.netFactor-r.premiacao):0),0); // rake+admin
    const perf  = gar>0?(prem-gar)/gar*100:null;
    const nf    = flatRows(from,to).filter(r=>r.status==='nf').length;
    const [fy,fm,fd] = from.split('-');
    const [ty,tm,td] = to.split('-');
    weeks.push({label:`${fd}/${fm}–${td}/${tm}`, gar, prem, ov, house, perf, n:rows.length, nf});
  }

  const valid = weeks.filter(Boolean);
  if(valid.length < 2){ el.innerHTML='<div style="color:var(--ink3);font-size:12px;padding:12px 0">Dados insuficientes para comparativo (mínimo 2 semanas).</div>'; return; }

  // Trend da perf entre semana atual e anterior
  const curr = weeks[0], prev = weeks[1];
  const perfDiff = curr&&prev&&curr.perf!=null&&prev.perf!=null ? curr.perf-prev.perf : null;
  const ovDiff   = curr&&prev ? curr.ov-prev.ov : null;
  const houseDiff= curr&&prev ? curr.house-prev.house : null;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:14px">
      ${perfDiff!=null?`<div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Perf. vs semana anterior</div>
        <div style="font-size:20px;font-weight:800;font-family:var(--mono);color:${perfDiff>=0?'var(--green)':'var(--red)'}">${perfDiff>=0?'+':''}${perfDiff.toFixed(1)}%</div>
      </div>`:''}
      ${ovDiff!=null?`<div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Overlay vs semana anterior</div>
        <div style="font-size:20px;font-weight:800;font-family:var(--mono);color:${ovDiff<=0?'var(--green)':'var(--red)'}">${ovDiff<=0?'':'+'}${brlk(ovDiff)}</div>
      </div>`:''}
      ${houseDiff!=null?`<div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Receita da casa vs semana anterior</div>
        <div style="font-size:20px;font-weight:800;font-family:var(--mono);color:${houseDiff>=0?'var(--green)':'var(--red)'}">${houseDiff>=0?'+':''}${brlk(houseDiff)}</div>
      </div>`:''}
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Semana</th><th class="r">Fechados</th>
          <th class="r">GTD total</th><th class="r">Premiação</th>
          <th class="r">Rake+Admin</th><th class="r">Overlay</th><th class="r">Perf.</th><th class="r">NF</th>
        </tr></thead>
        <tbody>${weeks.map((w,i)=>w?`<tr style="${i===0?'font-weight:700':''}">
          <td class="mono c-ink2">${w.label}</td>
          <td class="r mono">${w.n}</td>
          <td class="r mono">${brlk(w.gar)}</td>
          <td class="r mono">${brlk(w.prem)}</td>
          <td class="r mono c-green">${brlk(w.house)}</td>
          <td class="r mono ${w.ov<0?'c-red':'c-green'}">${brlk(w.ov)}</td>
          <td class="r"><span class="perf ${w.perf>=0?'pos':'neg'}">${w.perf!=null?pct(w.perf):'—'}</span></td>
          <td class="r mono ${w.nf>3?'c-red':'c-ink3'}">${w.nf}</td>
        </tr>`:'<tr><td colspan="8" style="color:var(--ink3);font-size:11px;padding:6px 10px">Sem dados</td></tr>').join('')}</tbody>
      </table>
    </div>`;
}

// Limiares configuráveis de detecção de anomalias (⚙ Limiares no card de Insights).
// Antes eram constantes fixas no código — agora ficam salvas no navegador do admin.
const INSIGHT_CFG_DEFAULT = { overlayDia:500, overlayTaxa:60, nfMin:5, perfDiff:3 };
function getInsightCfg(){
  try{ return {...INSIGHT_CFG_DEFAULT, ...JSON.parse(localStorage.getItem('suprema_insight_cfg')||'{}')}; }
  catch(e){ return {...INSIGHT_CFG_DEFAULT}; }
}
function openInsightSettings(){
  const cfg = getInsightCfg();
  document.getElementById('cfgOverlayDia').value = cfg.overlayDia;
  document.getElementById('cfgOverlayTaxa').value = cfg.overlayTaxa;
  document.getElementById('cfgNfMin').value = cfg.nfMin;
  document.getElementById('cfgPerfDiff').value = cfg.perfDiff;
  document.getElementById('moInsightSettings').classList.add('open');
}
function saveInsightSettings(){
  const cfg = {
    overlayDia:  parseFloat(document.getElementById('cfgOverlayDia').value)  || INSIGHT_CFG_DEFAULT.overlayDia,
    overlayTaxa: parseFloat(document.getElementById('cfgOverlayTaxa').value) || INSIGHT_CFG_DEFAULT.overlayTaxa,
    nfMin:       parseFloat(document.getElementById('cfgNfMin').value)      || INSIGHT_CFG_DEFAULT.nfMin,
    perfDiff:    parseFloat(document.getElementById('cfgPerfDiff').value)   || INSIGHT_CFG_DEFAULT.perfDiff,
  };
  localStorage.setItem('suprema_insight_cfg', JSON.stringify(cfg));
  closeMo('moInsightSettings');
  toast('✓ Limiares salvos','ok');
  buildDash();
}

function buildInsights(rows, closed, days){
  const el = document.getElementById('dashInsights');
  if(!el) return;
  const cfg = getInsightCfg();
  const insights = [];

  // 1. Taxa de fechamento
  const closeRate = rows.length ? closed.length/rows.length : 0;
  if(closeRate < 0.5 && rows.length > 10)
    insights.push({type:'warn', icon:'⚠️', text:`Taxa de fechamento baixa: apenas <b>${Math.round(closeRate*100)}%</b> dos torneios têm premiação registrada nos últimos ${days} dias.`});

  // 2. Pior dia da semana por overlay
  const byDay = {};
  closed.forEach(r=>{
    const d = new Date(r.date+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long'});
    if(!byDay[d]) byDay[d]={ov:0,n:0};
    byDay[d].ov += r.overlay||0; byDay[d].n++;
  });
  const worstDay = Object.entries(byDay).sort((a,b)=>a[1].ov-b[1].ov)[0];
  if(worstDay && worstDay[1].ov < -cfg.overlayDia)
    insights.push({type:'warn', icon:'📅', text:`<b>${worstDay[0]}</b> é o dia com maior overlay acumulado: R$ ${brl(Math.abs(worstDay[1].ov))} em ${worstDay[1].n} torneio${worstDay[1].n>1?'s':''}.`});

  // 3. Torneio com overlay recorrente
  const byName = {};
  closed.forEach(r=>{
    if(!byName[r.nome]) byName[r.nome]={ov:0,n:0,ovCount:0};
    byName[r.nome].ov += r.overlay||0;
    byName[r.nome].n++;
    if(r.overlay<0) byName[r.nome].ovCount++;
  });
  const chronic = Object.entries(byName)
    .filter(([,v])=>v.n>=3&&v.ovCount/v.n>=cfg.overlayTaxa/100)
    .sort((a,b)=>a[1].ov-b[1].ov).slice(0,2);
  chronic.forEach(([nome,v])=>
    insights.push({type:'alert', icon:'🔴', text:`<b>${esc(nome)}</b>: overlay em ${Math.round(v.ovCount/v.n*100)}% das rodadas (${v.ovCount}/${v.n}). Revisar GTD.`})
  );

  // 4. Melhor torneio (maior excedente médio)
  const best = Object.entries(byName)
    .filter(([,v])=>v.n>=2&&v.ov>0)
    .sort((a,b)=>b[1].ov-a[1].ov)[0];
  if(best)
    insights.push({type:'ok', icon:'🏆', text:`<b>${esc(best[0])}</b> é o torneio mais rentável: +R$ ${brl(best[1].ov)} acumulado em ${best[1].n} rodadas.`});

  // 5. Trend de perf (últimos 7d vs anteriores)
  if(days >= 14){
    const mid = dago(Math.floor(days/2));
    const recent  = closed.filter(r=>r.date>=mid&&r.perf!=null);
    const earlier = closed.filter(r=>r.date<mid&&r.perf!=null);
    const avgR = recent.length  ? recent.reduce((s,r)=>s+r.perf,0)/recent.length  : null;
    const avgE = earlier.length ? earlier.reduce((s,r)=>s+r.perf,0)/earlier.length : null;
    if(avgR!=null&&avgE!=null){
      const diff = avgR - avgE;
      if(Math.abs(diff)>cfg.perfDiff)
        insights.push({type: diff>0?'ok':'warn', icon: diff>0?'📈':'📉',
          text:`Performance ${diff>0?'melhorou':'piorou'} <b>${Math.abs(diff).toFixed(1)}%</b> na segunda metade do período (${avgR.toFixed(1)}% vs ${avgE.toFixed(1)}%).`});
    }
  }

  // 6. Alertas de operacional
  const nfCount = rows.filter(r=>r.status==='nf').length;
  if(nfCount > cfg.nfMin)
    insights.push({type:'warn', icon:'🚫', text:`<b>${nfCount}</b> torneios marcados como NF no período. Verificar se GTDs estão calibrados.`});

  // 12. Alertas de calibração de GTD (torneios com overlay crônico)
  const byName12 = {};
  rows.filter(r=>r.premiacao!=null).forEach(r=>{
    if(!byName12[r.nome]) byName12[r.nome]={nome:r.nome,cat:r.cat,n:0,ovN:0,gar:0};
    byName12[r.nome].n++;
    byName12[r.nome].gar += r.garantido||0;
    if(r.overlay!=null&&r.overlay<0) byName12[r.nome].ovN++;
  });
  Object.values(byName12)
    .filter(v=>v.n>=3&&v.ovN/v.n>=cfg.overlayTaxa/100)
    .sort((a,b)=>b.ovN/b.n-a.ovN/a.n)
    .slice(0,3)
    .forEach(v=>{
      const avgGar = v.gar/v.n;
      insights.push({
        type:'alert', icon:'🎯',
        text:`<b>Calibração recomendada:</b> <b>${esc(v.nome)}</b> teve overlay em ${v.ovN}/${v.n} rodadas. GTD médio atual: R$ ${brl(avgGar)}. Considere reduzir o garantido.`
      });
    });

  if(!insights.length){
    el.innerHTML=`<div style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--ink3);padding:12px 0">${typeIcon('ok')}Nenhuma anomalia detectada no período.</div>`;
    return;
  }

  const colors = {ok:'var(--green)',warn:'var(--amber)',alert:'var(--red)'};
  const bgs    = {ok:'var(--greenf)',warn:'var(--amberf)',alert:'var(--redf)'};
  el.innerHTML = insights.map(ins=>`
    <div style="display:flex;gap:10px;padding:10px 12px;background:${bgs[ins.type]};border:1px solid ${colors[ins.type]}22;border-radius:8px;margin-bottom:7px;font-size:12px;line-height:1.5">
      <span style="flex:none;color:${colors[ins.type]}">${typeIcon(ins.type)}</span>
      <span style="color:var(--ink2)">${ins.text}</span>
    </div>`).join('');
}

// Ícone semântico único por tipo (ok=verde, warn=âmbar, alert=vermelho) — consistência
// com o sistema de ícones SVG stroke usado na sidebar/topbar, no lugar do emoji por item.
const _ICON_SVG_ATTRS = 'width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
function typeIcon(type){
  if(type==='alert') return `<svg viewBox="0 0 24 24" ${_ICON_SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  if(type==='warn')  return `<svg viewBox="0 0 24 24" ${_ICON_SVG_ATTRS}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  return `<svg viewBox="0 0 24 24" ${_ICON_SVG_ATTRS}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
}

/* ── GRADE ───────────────────────────────────────────────────── */
function setGp(n,btn){
  _gp=n;
  document.querySelectorAll('#gradeTabs .ptab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderGrade();
}

function renderGrade(){
  const cat=document.getElementById('gradeCat')?.value||'';
  const sort=document.getElementById('gradeSort')?.value||'ov_desc';
  const q=(document.getElementById('gradeSearch')?.value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  const closed=flatRows(dago(_gp),nowSP()).filter(r=>r.premiacao!=null);
  const byName={};
  closed.forEach(r=>{
    if(cat&&r.cat!==cat)return;
    const normNome=r.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(q&&!normNome.includes(q))return;
    if(!byName[r.nome])byName[r.nome]={nome:r.nome,cat:r.cat,runs:0,gar:0,prem:0,ov:0,ovCount:0};
    byName[r.nome].runs++;
    byName[r.nome].gar+=r.garantido||0;
    byName[r.nome].prem+=r.premiacao||0;
    if(r.overlay){byName[r.nome].ov+=r.overlay;if(r.overlay<0)byName[r.nome].ovCount++;}
  });

  _gradeRows=Object.values(byName).map(v=>({
    ...v,
    avgGar:v.gar/v.runs,
    avgPrem:v.prem/v.runs,
    avgPerf:v.gar>0?(v.prem-v.gar)/v.gar*100:null,
    ovRate: v.runs>0?v.ovCount/v.runs:0,  // taxa de rodadas com overlay
    risk: v.runs<3?'baixo dados': v.ovCount/v.runs>=0.6?'alto': v.ovCount/v.runs>=0.3?'médio':'baixo',
  }));

  if(sort==='ov_desc') _gradeRows.sort((a,b)=>a.ov-b.ov);
  else if(sort==='perf_asc') _gradeRows.sort((a,b)=>(a.avgPerf??0)-(b.avgPerf??0));
  else if(sort==='perf_desc') _gradeRows.sort((a,b)=>(b.avgPerf??0)-(a.avgPerf??0));
  else if(sort==='runs') _gradeRows.sort((a,b)=>b.runs-a.runs);

  document.getElementById('gradeCount').textContent=`${_gradeRows.length} torneio${_gradeRows.length!==1?'s':''}`;
  const maxOv=Math.abs(Math.min(..._gradeRows.map(v=>v.ov),-1));

  document.getElementById('gradeBody').innerHTML=_gradeRows.length?_gradeRows.map(v=>{
    const barPct=v.ov<0?Math.round(Math.abs(v.ov)/maxOv*100):0;
    const riskColor = v.risk==='alto'?'var(--red)':v.risk==='médio'?'var(--amber)':'var(--green)';
    return `<tr>
      <td class="nm">${esc(v.nome)}</td>
      <td>${catBadge(v.cat)}</td>
      <td class="r mono">${v.runs}</td>
      <td class="r mono">${brlk(v.avgGar)}</td>
      <td class="r mono">${brlk(v.avgPrem)}</td>
      <td class="r">${v.avgPerf!=null?`<span class="perf ${v.avgPerf>=0?'pos':'neg'}">${pct(v.avgPerf)}</span>`:'—'}</td>
      <td class="r mono ${v.ov<0?'c-red':''}">${v.ov!==0?brlk(v.ov):'—'}</td>
      <td class="r mono" style="color:${riskColor}">${Math.round(v.ovRate*100)}%</td>
      <td><span style="font-size:10px;font-weight:700;color:${riskColor};background:${riskColor}18;border:1px solid ${riskColor}33;padding:2px 8px;border-radius:99px">${v.risk.toUpperCase()}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-act="goToAuditFor" data-arg="${esc(v.nome)}">🔍 Auditar</button></td>
    </tr>`;
  }).join(''):`<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--ink3)">Nenhum dado</td></tr>`;
}

/* ── OPERADORES ──────────────────────────────────────────────────
   Render em CARDS (#opCards), casando com o admin.html/admin.css novos.
   O JS original dos cards nunca foi commitado (só HTML+CSS) — esta é a
   reconstrução do "esqueleto seguro": só dados 100% confiáveis (nome, email,
   tags admin/suspenso, acesso por painel via accessRow, busca, suspender/
   reativar). KPIs/notificações/motivos ficam de fora de propósito, pra não
   inventar cálculo. Reusa toggleAccess/toggleEdit/blockOp/forceUnblockOp. */
async function loadOps(){
  if(!fbOk)return;
  const host=document.getElementById('opCards');
  if(!host)return;                          // null-safe: sobrevive se o HTML divergir
  host.innerHTML=`<div class="op-loading">Carregando…</div>`;
  try{
    const snap=await db.ref('users').once('value');
    const users=snap.val()||{};
    const rows=Object.entries(users).map(([k,u])=>({key:k,...u}));
    rows.sort((a,b)=>{
      const admDiff=(b.admin?1:0)-(a.admin?1:0);   // admins primeiro
      if(admDiff) return admDiff;
      return (a.apelido||a.nome||a.email||a.key).localeCompare(b.apelido||b.nome||b.email||b.key,'pt-BR');
    });
    const cnt=document.getElementById('opCount');
    if(cnt) cnt.textContent=`${rows.length} cadastrado${rows.length!==1?'s':''}`;
    const stats=await opStats30d(users);
    host.innerHTML=rows.map(u=>opCardHtml(u,stats)).join('')||`<div class="op-loading">Nenhum operador cadastrado.</div>`;
    const s=document.getElementById('opSearch'); if(s&&s.value) filterOps(s);   // reaplica busca corrente
  }catch(e){ host.innerHTML=`<div class="op-loading" style="color:var(--red)">${esc(e.message||e)}</div>`; }
}

/* KPIs 30 dias — REAPROVEITA a MESMA conta do Ranking de operadores (openOpRanking)
   e do ranking de grade: flatRows do período (chave fixBy||idBy), notificações de
   erro casadas por email→nome, e o lado da Criação Noturna (cnStatsByOp). Nada
   inventado — são as métricas que o admin já usa, agora por card.
   Cache de 60s: loadOps roda de novo a cada toggle de acesso, e não vale refazer
   os fetches (Firebase) a cada clique. */
let _opStatsCache=null, _opStatsAt=0;
async function opStats30d(usersMap){
  if(_opStatsCache && Date.now()-_opStatsAt < 60000) return _opStatsCache;
  const map={};
  const get=op=>map[op]||(map[op]={total:0,comId:0,semPrem:0,overlay:0,gar:0,prem:0,notifs:0,cnCriados:0,cnErros:0});
  try{
    flatRows(dago(30), nowSP()).forEach(r=>{
      const op=r.fixBy||r.idBy; if(!op) return;
      const o=get(op);
      o.total++;
      if(r.id && r.id.toUpperCase()!=='NF' && String(r.id).trim()) o.comId++;
      if(r.status==='aberto') o.semPrem++;
      if(r.overlay!=null && r.overlay<0) o.overlay++;
      if(r.garantido>0){ o.gar+=r.garantido; if(r.premiacao!=null) o.prem+=r.premiacao; }
    });
  }catch(e){}
  // ERROS sinalizados pelo admin (notificações), casados email→nome via users
  try{
    const um=usersMap||_allUsers||{};
    const all=await getAllNotifsCached();
    Object.entries(all).forEach(([emailKey,notifs])=>{
      const u=um[emailKey]||{}; const name=u.apelido||u.nome||'';
      if(name && map[name]) map[name].notifs+=Object.keys(notifs||{}).length;
    });
  }catch(e){}
  // lado da Criação Noturna (GU): criados e erros de criação
  try{
    const cn=await cnStatsByOp(dago(30), nowSP());
    Object.entries(cn.byOp||{}).forEach(([name,s])=>{ const o=get(name); o.cnCriados=s.criados||0; o.cnErros=s.erros||0; });
  }catch(e){}
  Object.values(map).forEach(o=>{
    o.trabalhados=o.total+(o.cnCriados||0);
    o.erros=(o.notifs||0)+(o.cnErros||0);
    o.perf=o.gar>0?(o.prem-o.gar)/o.gar*100:null;   // premiação vs garantido (mesma fórmula do ranking de grade)
    o.idRate=o.total>0?o.comId/o.total*100:null;
  });
  _opStatsCache=map; _opStatsAt=Date.now();
  return map;
}
/* zera o cache quando um evento muda os números (suspensão gera notificação) */
function invalidateOpStats(){ _opStatsCache=null; }

function opCardHtml(u, stats){
  const email=u.email||(u.key.replace(/_dot_/g,'.').replace(/_at_/g,'@'));
  const name=u.apelido||u.nome||email;
  const suspenso=!!u.pendingNotif;
  const initials=((name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('')||'?').toUpperCase();
  const search=`${name} ${email} ${u.nome||''}`.toLowerCase();
  const tags=`${u.admin?'<span class="op-tag adm">Admin</span>':''}${suspenso?'<span class="op-tag sus">Suspenso</span>':''}`;
  const st=(stats&&stats[name])||{};
  const perf=st.perf, notifs=st.notifs||0, cnErros=st.cnErros||0, overlay=st.overlay||0, trab=st.trabalhados||0;
  const idRate=st.idRate, semPrem=st.semPrem||0, total=st.total||0;
  const perfCls=perf==null?'':(perf<0?'bad':'good');
  const perfTxt=perf==null?'—':`${perf>0?'+':''}${Math.round(perf)}%`;
  const idTxt=idRate==null?'—':`${Math.round(idRate)}%`;
  const idCls=idRate==null?'':(idRate>=90?'good':idRate<60?'bad':'warn');
  // barrinha de qualidade: quanto do trabalho passou sem erro/overlay/notificação
  const problemas=(overlay||0)+(notifs||0)+(cnErros||0)+(semPrem||0);
  const base=Math.max(total+(st.cnCriados||0),1);
  const qualidade=Math.max(0,Math.min(100,Math.round((1-problemas/base)*100)));
  const qCls=qualidade>=85?'good':qualidade<60?'bad':'warn';
  const semAtividade = (total+(st.cnCriados||0))===0;
  const qualityBlock = semAtividade
    ? `<div class="op-quality"><div class="op-quality-bar"><span style="width:0%"></span></div><div class="op-quality-tag" style="color:var(--ink3)">sem atividade (30d)</div></div>`
    : `<div class="op-quality" title="Índice de qualidade: rodadas sem overlay, sem notificação, com premiação e sem erro de criação">
      <div class="op-quality-bar"><span class="${qCls}" style="width:${qualidade}%"></span></div>
      <div class="op-quality-tag ${qCls}">${qualidade}% limpo</div>
    </div>`;
  const kpis=`${qualityBlock}
    <div class="op-kpis">
    <div class="op-kpi"><div class="v">${trab}</div><div class="l">Trabalhados 30d</div></div>
    <div class="op-kpi ${perfCls}" title="Premiação vs garantido (mesma fórmula do ranking)"><div class="v">${perfTxt}</div><div class="l">Performance</div></div>
    <div class="op-kpi ${idCls}" title="Torneios com ID de evento preenchido (30 dias)"><div class="v">${idTxt}</div><div class="l">Taxa de ID</div></div>
    <div class="op-kpi${semPrem>3?' warn':''}" title="Torneios ainda em aberto / sem premiação registrada"><div class="v">${semPrem}</div><div class="l">Sem prem.</div></div>
    <div class="op-kpi${notifs>0?' warn':''}" title="Quantas vezes o admin notificou este operador (30 dias)"><div class="v">${notifs}</div><div class="l">Notificações</div></div>
    <div class="op-kpi${cnErros>0?' bad':''}" title="Erros de criação apontados na GU (30 dias)"><div class="v">${cnErros}</div><div class="l">Erros criação</div></div>
    <div class="op-kpi${overlay>5?' warn':''}" title="Rodadas que fecharam com overlay (abaixo do garantido)"><div class="v">${overlay}</div><div class="l">Overlay</div></div>
  </div>`;
  const actions=suspenso
    ? `<button class="btn btn-gold btn-sm" data-act="forceUnblockOp" data-arg="${esc(u.key)}" data-arg2="${esc(name)}">Reativar</button>`
    : `<button class="btn btn-ghost btn-sm" data-act="blockOp" data-arg="${esc(u.key)}" data-arg2="${esc(name)}">Suspender</button>`;
  const accessBlock=u.admin
    ? `<div class="op-admin-badge">👑 Acesso total — todos os painéis, ver e editar.</div>`
    : `<div class="op-access">
        <div class="op-access-head">Acesso aos painéis
          <div class="op-access-quick">
            <button class="qbtn" data-act="grantAllAccess" data-arg="${esc(u.key)}">Liberar tudo</button>
            <button class="qbtn danger" data-act="revokeAllAccess" data-arg="${esc(u.key)}">Tirar tudo</button>
          </div>
        </div>
        <div class="perm-grid">${ACCESS_PANELS.map(p=>accessRow(u,p,EDIT_PANELS.includes(p.id))).join('')}</div>
      </div>`;
  return `<div class="op-card${suspenso?' attn':''}" data-search="${esc(search)}">
    <div class="op-card-head">
      <div class="op-av">${esc(initials)}</div>
      <div class="op-id">
        <div class="op-name">${esc(name)}${tags}</div>
        <div class="op-email">${esc(email)}</div>
      </div>
      <div class="op-card-actions">${actions}</div>
    </div>
    ${kpis}
    ${accessBlock}
  </div>`;
}

/* busca por nome/email — esconde os cards que não batem (sem re-fetch) */
function filterOps(el){
  const q=((el&&el.value)||'').trim().toLowerCase();
  document.querySelectorAll('#opCards .op-card').forEach(card=>{
    card.style.display=(!q||(card.dataset.search||'').includes(q))?'':'none';
  });
}

/* Liberar tudo / Tirar tudo — todos os painéis de acesso de uma conta de uma vez
   (mesma semântica do toggleAccess: grava true / remove a chave). */
async function grantAllAccess(key){
  if(!fbOk){ alert('Firebase não conectado.'); return; }
  const updates={}; ACCESS_PANELS.forEach(p=>{ updates[`users/${key}/access/${p.id}`]=true; });
  try{ await db.ref().update(updates); await loadOps(); }
  catch(e){ alert('Falha ao liberar acesso: '+(e.message||e)); }
}
async function revokeAllAccess(key){
  if(!fbOk){ alert('Firebase não conectado.'); return; }
  const updates={}; ACCESS_PANELS.forEach(p=>{ updates[`users/${key}/access/${p.id}`]=null; });
  try{ await db.ref().update(updates); await loadOps(); }
  catch(e){ alert('Falha ao tirar acesso: '+(e.message||e)); }
}

/* ── CONTROLE DE ACESSO POR PAINEL ──
   Bloqueio por padrão: só entra no painel quem tiver users/<key>/access/<id>=true.
   Aqui o admin libera/retira painel por painel, por pessoa. Admin entra em tudo. */
const ACCESS_PANELS = (window.SupremaAuth && SupremaAuth.PANELS ? SupremaAuth.PANELS : []).filter(p=>!p.adminOnly);
/* painéis onde VER ≠ EDITAR (têm nós de escrita no RTDB). Learn/Org são
   externos e Radar é leitura por natureza — edição não se aplica. */
const EDIT_PANELS = ['painel','gu','cash','tv'];
/* Uma LINHA por painel: nome + os dois interruptores (👁 Vê / ✎ Edita) lado a
   lado. Lê-se naturalmente ("Painel do Dia: vê, edita") em vez de cruzar duas
   fileiras de chips. Painéis sem escrita (Radar, externos) mostram só o Vê. */
function accessRow(u, p, editable){
  const acc = u.access || {};
  const ed  = u.edit || {};
  const legado = u.edit == null;                 // sem nó `edit` → herda do acesso
  const sees  = acc[p.id] === true;
  const edits = editable && (legado ? sees : ed[p.id] === true);
  const see = `<button class="perm-pill see${sees?' on':''}" data-key="${esc(u.key)}" data-panel="${p.id}" data-on="${sees?'1':'0'}" data-act="toggleAccess" data-act-self `+
    `title="${sees?'Vê — clique para tirar o acesso':'Não vê — clique para liberar'}">${sees?'👁 Vê':'○ Sem acesso'}</button>`;
  const edit = editable
    ? `<button class="perm-pill edit${edits?' on':''}${sees?'':' muted'}" data-key="${esc(u.key)}" data-panel="${p.id}" data-on="${edits?'1':'0'}" data-act="toggleEdit" data-act-self `+
        `title="${edits?'Edita — clique para deixar só leitura':'Só leitura — clique para liberar edição'}${legado?' (herdado do acesso; o 1º clique torna explícito)':''}">${edits?'✎ Edita':'🔒 Só leitura'}</button>`
    : `<span class="perm-pill na" title="Este painel é somente leitura — não há o que editar">—</span>`;
  return `<div class="perm-row"><span class="perm-name">${esc(p.label)}</span>${see}${edit}</div>`;
}
function accessCell(u){
  if(u.admin) return `<span class="perm-admin">👑 Acesso total <small>(todos os painéis, ver e editar)</small></span>`;
  const rows = ACCESS_PANELS.map(p => accessRow(u, p, EDIT_PANELS.includes(p.id))).join('');
  return `<div class="perm-grid">${rows}</div>`;
}
async function toggleAccess(btn){
  if(!fbOk){ alert('Firebase não conectado.'); return; }
  const key=btn.dataset.key, panel=btn.dataset.panel, next = btn.dataset.on!=='1';
  btn.disabled=true;
  try{
    // grava true, ou remove a chave quando desliga (mantém o nó limpo)
    await db.ref(`users/${key}/access/${panel}`).set(next?true:null);
    await loadOps();          // re-pinta a linha (tirar o Vê já apaga o Edita ao lado)
  }catch(e){ alert('Falha ao salvar acesso: '+(e.message||e)); btn.disabled=false; }
}
/* liga/desliga a EDIÇÃO de um painel. Conta legada (sem nó `edit`): o primeiro
   toggle materializa o nó copiando o access atual dos painéis editáveis, e aí
   aplica o clique — a partir daqui as regras param de herdar do access. */
async function toggleEdit(btn){
  if(!fbOk){ alert('Firebase não conectado.'); return; }
  const key=btn.dataset.key, panel=btn.dataset.panel, next = btn.dataset.on!=='1';
  btn.disabled=true;
  try{
    const ref = db.ref(`users/${key}/edit`);
    const cur = (await ref.once('value')).val();
    if(cur == null){
      const acc = (await db.ref(`users/${key}/access`).once('value')).val() || {};
      const seed = {};
      EDIT_PANELS.forEach(id => { if(acc[id]===true) seed[id]=true; });
      seed[panel] = next;
      if(!next) delete seed[panel];
      await ref.set(Object.keys(seed).length ? seed : { _off:true });   // nó precisa EXISTIR pra regra não herdar
    }else{
      await ref.child(panel).set(next?true:null);
      // se esvaziou, mantém o marcador — sem nó, as regras voltariam a herdar do access
      const left = (await ref.once('value')).val();
      if(left == null) await ref.set({ _off:true });
    }
    await loadOps();                       // re-pinta a linha (o legado pode ter virado explícito)
  }catch(e){ alert('Falha ao salvar edição: '+(e.message||e)); btn.disabled=false; }
}

/* ── BACKFILL edição ──
   Materializa users/<key>/edit pra TODAS as contas de uma vez, copiando o
   access atual dos painéis editáveis (quem via, segue editando — nada muda no
   dia 1). A partir daí ver e editar são independentes: dá pra liberar o
   Painel do Dia (ver) pra todo mundo sem entregar a escrita. Rodar 1x antes
   de abrir os acessos. Contas que já têm nó `edit` não são tocadas. */
async function backfillEditFlags(btn){
  if(!fbOk){ alert('Firebase não conectado.'); return; }
  if(btn){ btn.disabled=true; btn.textContent='Migrando…'; }
  try{
    const snap = await db.ref('users').once('value');
    const users = snap.val() || {};
    const updates = {}; let n=0, skip=0;
    Object.entries(users).forEach(([key,u])=>{
      if(!u || u.edit != null){ skip++; return; }
      const acc = u.access || {};
      const seed = {};
      EDIT_PANELS.forEach(id => { if(acc[id]===true) seed[id]=true; });
      updates['users/'+key+'/edit'] = Object.keys(seed).length ? seed : { _off:true };
      n++;
    });
    if(n) await db.ref().update(updates);
    alert(`Edição materializada em ${n} conta(s).`+(skip?` ${skip} já tinham (intactas).`:''));
    await loadOps();
  }catch(e){ alert('Falha ao migrar edição: '+(e.message||e)); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='Separar ver/editar (1ª vez)'; } }
}

/* ── BACKFILL uidIndex ──
   As regras de acesso por painel leem users/<key>/access via um índice
   uidIndex/<uid>=<key>. O hub popula esse índice a cada login, mas operadores
   que não logarem de novo ficariam trancados quando as regras entrarem no ar.
   Este botão preenche o índice de uma vez, a partir do authUid já gravado em
   cada conta migrada. Rodar 1x ANTES de publicar as regras novas. */
async function backfillUidIndex(btn){
  if(!fbOk){ alert('Firebase não conectado.'); return; }
  if(btn){ btn.disabled=true; btn.textContent='Sincronizando…'; }
  try{
    const snap = await db.ref('users').once('value');
    const users = snap.val() || {};
    const updates = {}; let n=0, skip=0;
    Object.entries(users).forEach(([key,u])=>{
      if(u && u.authUid){ updates['uidIndex/'+u.authUid] = key; n++; }
      else skip++;
    });
    if(n) await db.ref().update(updates);
    alert(`Índice sincronizado: ${n} conta(s) migrada(s).`+(skip?` ${skip} sem authUid (logam depois — o hub cuida).`:''));
  }catch(e){ alert('Falha ao sincronizar: '+(e.message||e)); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='Sincronizar acessos (regras)'; } }
}

function openAddOp(){
  document.getElementById('aoErr').style.display='none';
  document.getElementById('moAddOp').classList.add('open');
  setTimeout(()=>document.getElementById('aoNome')?.focus(),80);
}

async function createOp(){
  const nome=document.getElementById('aoNome').value.trim();
  const apelido=document.getElementById('aoApelido').value.trim();
  const email=document.getElementById('aoEmail').value.trim().toLowerCase();
  const pass=document.getElementById('aoPass').value;
  const admin=document.getElementById('aoAdmin').checked;
  const errEl=document.getElementById('aoErr');
  const btn=document.getElementById('aoBtn');
  const label=document.getElementById('aoLabel');
  errEl.style.display='none';
  if(!nome){errEl.textContent='Nome é obrigatório.';errEl.style.display='block';return;}
  if(!email||!/^[^\s@]+@[^\s@]+/.test(email)){errEl.textContent='Email inválido.';errEl.style.display='block';return;}
  if(!pass||pass.length<8){errEl.textContent='Senha deve ter ao menos 8 caracteres.';errEl.style.display='block';return;}
  if(!fbOk){errEl.textContent='Firebase não conectado.';errEl.style.display='block';return;}
  btn.disabled=true;label.textContent='Criando...';
  try{
    const existing=await db.ref(`users/${eKey(email)}`).once('value');
    if(existing.val()){errEl.textContent='Este email já está cadastrado.';errEl.style.display='block';btn.disabled=false;label.textContent='Criar conta';return;}
    const hash=await hashStr(pass);
    await db.ref(`users/${eKey(email)}`).set({nome,apelido:apelido||nome,email,pwHash:hash,admin,createdAt:Date.now(),createdBy:_email});
    closeMo('moAddOp');
    ['aoNome','aoApelido','aoEmail','aoPass'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('aoAdmin').checked=false;
    loadOps();
    // Modal de sucesso
    document.getElementById('sucMsg').textContent=`A conta de ${apelido||nome} foi criada com sucesso.`;
    document.getElementById('sucCreds').innerHTML=`
      <div class="row"><span class="k">Email</span><span class="v">${esc(email)}</span></div>
      <div class="row"><span class="k">Senha</span><span class="v">${esc(pass)}</span></div>
      <div class="row"><span class="k">Nível</span><span class="v">${admin?'Administrador':'Operador'}</span></div>`;
    document.getElementById('moSuccess').classList.add('open');
  }catch(e){errEl.textContent='Erro: '+(e.message||'verifique a conexão.');errEl.style.display='block';}
  finally{btn.disabled=false;label.textContent='Criar conta';}
}

let _blockOpTarget=null; // {key, name}
function blockOp(key,name){
  _blockOpTarget={key,name};
  document.getElementById('blkSub').innerHTML=
    `<b>${esc(name)}</b> ficará com o painel suspenso até enviar uma justificativa. A notificação aparece na hora em que ele estiver logado.`;
  document.getElementById('blkErr').style.display='none';
  document.getElementById('blkReason').value='';
  document.getElementById('moBlockOp').classList.add('open');
  setTimeout(()=>document.getElementById('blkReason')?.focus(),80);
}

async function confirmBlockOp(){
  if(!_blockOpTarget) return;
  const {key,name}=_blockOpTarget;
  const reason=document.getElementById('blkReason').value.trim();
  const errEl=document.getElementById('blkErr');
  const btn=document.getElementById('blkBtn');
  const label=document.getElementById('blkLabel');
  errEl.style.display='none';
  if(!reason){errEl.textContent='Descreva o motivo da suspensão.';errEl.style.display='block';return;}
  if(!fbOk){errEl.textContent='Firebase não conectado.';errEl.style.display='block';return;}
  btn.disabled=true;label.textContent='Enviando...';

  // Cria uma notificação bloqueante — o painel do operador (index.html) tem um listener
  // em userNotifs/{key} que abre o modal de justificativa assim que houver uma pendente
  // com blocked:true, justified:false e resolved:false.
  const notifId='block_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  const notif={
    id:notifId, type:'bloqueio', typeLabel:'Acesso suspenso pelo admin',
    torneio:'', date:nowSP(), desc:reason,
    sentBy:_email, sentAt:Date.now(),
    seen:false, justified:false, resolved:false, blocked:true,
  };
  try{
    await db.ref(`userNotifs/${key}/${notifId}`).set(notif);
    await db.ref(`users/${key}/pendingNotif`).set({notifId, since:Date.now()});
    invalidateNotifsCache();
    closeMo('moBlockOp');
    toast(`✓ ${name} suspenso — aguardando justificativa`,'ok');
    writeAdminLog('bloquear', {operador:name, motivo:reason});
    loadOps();
    loadPendingNotifs();
  }catch(e){
    errEl.textContent='Erro: '+e.message;errEl.style.display='block';
  }finally{
    btn.disabled=false;label.textContent='Suspender e notificar';
  }
}

/* ══════════════════════════════════════════════════════════════
   SISTEMA DE NOTIFICAÇÃO DE ERROS
   Fluxo: Admin notifica → Firebase userNotifs/{email}/{id}
          Operador vê no painel → justifica → Firebase userJustifs/{id}
          Admin bloqueia até justificativa chegar
══════════════════════════════════════════════════════════════ */

let _notifContext = null; // {nome, date, key, fixBy}
let _notifType = '';
let _allUsers  = {}; // {emailKey: userData}

async function loadUsers(){
  const snap = await db.ref('users').once('value');
  _allUsers = snap.val()||{};
  // Popular select de operadores
  ['notifOp'].forEach(selId => {
    const sel = document.getElementById(selId);
    if(!sel)return;
    sel.innerHTML = '<option value="">Selecione o operador...</option>';
    Object.entries(_allUsers).forEach(([k,u])=>{
      const name = u.apelido||u.nome||u.email||k;
      const email = u.email||(k.replace(/_dot_/g,'.').replace(/_at_/g,'@'));
      sel.innerHTML += `<option value="${k}" data-name="${esc(name)}" data-email="${esc(email)}">${esc(name)} — ${esc(email)}</option>`;
    });
  });
}

function openNotif(ctx){
  _notifContext = typeof ctx==='string' ? JSON.parse(ctx) : ctx;
  _notifType = '';
  const errEl = document.getElementById('notifErr');
  if(errEl) errEl.style.display='none';
  // Preencher torneio
  document.getElementById('notifTorneio').value = _notifContext.nome||'';
  document.getElementById('notifDesc').value = '';
  document.getElementById('notifPreview').textContent = 'Selecione o tipo de erro para ver a pré-visualização...';
  // Remover seleção dos botões de tipo
  document.querySelectorAll('.notif-type-btn').forEach(b=>b.classList.remove('sel'));
  // Pré-selecionar operador se soubermos quem foi
  if(_notifContext.fixBy){
    const sel = document.getElementById('notifOp');
    if(sel){
      [...sel.options].forEach(opt => {
        if(opt.dataset.name === _notifContext.fixBy || opt.text.startsWith(_notifContext.fixBy)){
          sel.value = opt.value;
        }
      });
    }
  }
  loadUsers().then(()=>{
    if(_notifContext.fixBy){
      const sel = document.getElementById('notifOp');
      if(sel) [...sel.options].forEach(opt => {
        if(opt.dataset.name===_notifContext.fixBy) sel.value=opt.value;
      });
    }
  });
  // ── sugestão inteligente: pré-seleciona o tipo e escreve a descrição ──
  const sug = suggestNotif(_notifContext);
  const hint = document.getElementById('notifSmartHint');
  if(sug){
    _notifType = sug.type;
    document.querySelectorAll('.notif-type-btn').forEach(b=>
      b.classList.toggle('sel', b.dataset.arg===sug.type));
    const descEl = document.getElementById('notifDesc');
    if(descEl && !descEl.value) descEl.value = sug.desc;
    if(hint){
      hint.innerHTML = `💡 Sugestão automática: <b>${esc(NOTIF_TYPES[sug.type]||sug.type)}</b>. Revise antes de enviar.`;
      hint.style.display = 'flex';
    }
    updateNotifPreview();
  } else if(hint){
    hint.style.display = 'none';
  }
  document.getElementById('moNotif').classList.add('open');
}

const NOTIF_TYPES = {
  garantido: 'Garantido incorreto',
  field:     'Field incorreto',
  premiacao: 'Premiação incorreta',
  id:        'ID do evento incorreto',
  criacao:   'Erro de criação (GU)',
  outro:     'Erro operacional',
};

function selNotifType(type, btn){
  _notifType = type;
  document.querySelectorAll('.notif-type-btn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  updateNotifPreview();
}

function updateNotifPreview(){
  const preview = document.getElementById('notifPreview');
  const desc = document.getElementById('notifDesc').value.trim();
  const torneio = _notifContext?.nome||'';
  if(!_notifType){preview.textContent='Selecione o tipo de erro...';return;}
  preview.innerHTML = `<strong>⚠ ${NOTIF_TYPES[_notifType]}</strong> no torneio <strong>${esc(torneio)}</strong> em <strong>${_notifContext?.date?fmtDate(_notifContext.date):''}</strong>${desc?`<br><span style="color:var(--ink2)">${esc(desc)}</span>`:''}`;
}

document.getElementById('notifDesc').addEventListener('input', updateNotifPreview);

async function sendNotif(){
  const opKey   = document.getElementById('notifOp').value;
  const desc    = document.getElementById('notifDesc').value.trim();
  const errEl   = document.getElementById('notifErr');
  const btn     = document.getElementById('notifBtn');
  const label   = document.getElementById('notifLabel');
  errEl.style.display='none';

  if(!opKey){errEl.textContent='Selecione o operador.';errEl.style.display='block';return;}
  if(!_notifType){errEl.textContent='Selecione o tipo de erro.';errEl.style.display='block';return;}
  if(!desc){errEl.textContent='Descreva o erro encontrado.';errEl.style.display='block';return;}
  if(!fbOk){errEl.textContent='Firebase não conectado.';errEl.style.display='block';return;}

  btn.disabled=true;label.textContent='Enviando...';

  const opData  = _allUsers[opKey]||{};
  const opEmail = opData.email||(opKey.replace(/_dot_/g,'.').replace(/_at_/g,'@'));
  const notifId = 'n_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);

  const notif = {
    id:        notifId,
    type:      _notifType,
    typeLabel: NOTIF_TYPES[_notifType],
    torneio:   _notifContext?.nome||'',
    date:      _notifContext?.date||'',
    key:       _notifContext?.key||'',
    desc,
    sentBy:    _email,
    sentAt:    Date.now(),
    seen:      false,
    justified: false,
    blocked:   true, // bloqueia o operador até justificar
  };

  try {
    // Salvar notificação
    await db.ref(`userNotifs/${opKey}/${notifId}`).set(notif);
    // Marcar operador como bloqueado por notificação pendente
    await db.ref(`users/${opKey}/pendingNotif`).set({notifId, since:Date.now()});
    invalidateNotifsCache();

    closeMo('moNotif');
    toast(`✓ Notificação enviada para ${opData.apelido||opEmail}`,'ok');
    // Atualizar lista de justificativas
    loadPendingNotifs();
  } catch(e){
    errEl.textContent='Erro ao enviar: '+e.message;
    errEl.style.display='block';
  } finally {
    btn.disabled=false;label.textContent='Enviar notificação';
  }
}

// Cache curto de userNotifs — evita reler o nó inteiro do Firebase toda vez que o
// admin abre Justificativas/Notificações/Ranking em sequência (o nó cresce sem limite
// e hoje é lido por completo em 4 pontos diferentes do painel).
let _notifsCache = null, _notifsCacheAt = 0;
const NOTIFS_CACHE_MS = 15000;
async function getAllNotifsCached(force){
  if(!force && _notifsCache && (Date.now()-_notifsCacheAt)<NOTIFS_CACHE_MS) return _notifsCache;
  const snap = await db.ref('userNotifs').once('value');
  _notifsCache = snap.val()||{};
  _notifsCacheAt = Date.now();
  return _notifsCache;
}
function invalidateNotifsCache(){ _notifsCache=null; }

// Carregar notificações pendentes (sem justificativa)
let _pendingNotifs = {};
async function loadPendingNotifs(force){
  if(!fbOk)return;
  const all = await getAllNotifsCached(force);
  _pendingNotifs = {};
  Object.entries(all).forEach(([opKey,notifs])=>{
    if(!notifs||typeof notifs!=='object')return;
    Object.entries(notifs).forEach(([nid,n])=>{
      if(n&&!n.justified) _pendingNotifs[nid]={...n,opKey};
    });
  });
  // Atualizar badge no menu
  const count = Object.keys(_pendingNotifs).length;
  const badge = document.getElementById('pendingBadge');
  if(badge){badge.textContent=count||'';badge.style.display=count?'inline':'none';}
}

async function openJustifs(){
  if(!fbOk)return;
  const all = await getAllNotifsCached();
  const list = document.getElementById('justifList');
  const rows = [];
  Object.entries(all).forEach(([opKey,notifs])=>{
    if(!notifs)return;
    Object.entries(notifs).forEach(([nid,n])=>{
      if(n) rows.push({...n,nid,opKey});
    });
  });
  rows.sort((a,b)=>b.sentAt-a.sentAt);
  if(!rows.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">📭</div><h3>Nenhuma notificação enviada</h3></div>';
  } else {
    list.innerHTML = rows.map(n=>{
      const op = _allUsers[n.opKey]||{};
      const opName = op.apelido||op.nome||n.opKey;
      const sentDate = n.sentAt?new Date(n.sentAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';
      return `<div style="border:1px solid var(--border);border-radius:9px;padding:14px;margin-bottom:10px;background:var(--s2)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <span style="font-size:11px;font-weight:700;color:var(--amber)">${esc(n.typeLabel||n.type||'Erro')}</span>
            <span style="color:var(--ink3);font-size:11px;margin-left:8px">${esc(n.torneio)} · ${n.date?fmtDate(n.date):''}</span>
          </div>
          <span style="font-size:10px;color:var(--ink3)">${sentDate}</span>
        </div>
        <div style="font-size:12px;color:var(--ink2);margin-bottom:8px">${esc(n.desc||'')}</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;color:var(--ink3)">Operador: <strong style="color:var(--ink)">${esc(opName)}</strong></span>
          ${n.justified
            ? `<div>
                <span class="notif-justified">Justificado</span>
                <div style="font-size:11px;color:var(--green);margin-top:4px;padding:8px;background:var(--greenf);border-radius:6px">"${esc(n.justification||'')}"</div>
                <button class="btn btn-ghost btn-sm" style="margin-top:6px" data-act="resolveNotif" data-arg="${n.opKey}" data-arg2="${n.nid}">✓ Resolver</button>
              </div>`
            : `<span class="notif-pending">Aguardando justificativa</span>`}
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('moJustifs').classList.add('open');
}

// Reativação forçada pelo admin — não depende do operador enviar justificativa antes.
// Útil quando o operador não consegue logar ou o bloqueio foi engano.
async function forceUnblockOp(key,name){
  if(!confirm(`Reativar "${name}" imediatamente? Isso libera o acesso mesmo sem justificativa.`))return;
  try{
    const snap = await db.ref(`users/${key}/pendingNotif`).once('value');
    const pending = snap.val();
    if(pending?.notifId) await db.ref(`userNotifs/${key}/${pending.notifId}`).update({resolved:true,forcedByAdmin:true});
    await db.ref(`users/${key}/pendingNotif`).remove();
    invalidateNotifsCache();
    toast(`✓ ${name} reativado`,'ok');
    writeAdminLog('reativar', {operador:name});
    loadOps();
    loadPendingNotifs();
  }catch(e){ toast('Erro: '+e.message,'err'); }
}

async function resolveNotif(opKey,nid){
  if(!await confirmModal({title:'Resolver notificação',message:'Marcar como resolvido e liberar o operador?',confirmLabel:'Resolver'}))return;
  try {
    // erro de criação (GU): resolver a notificação também limpa o badge de erro
    // na página da criação — fecha o ciclo marcou → notificou → justificou → ok
    try{
      const n = (await db.ref(`userNotifs/${opKey}/${nid}`).once('value')).val();
      if(n && n.type === 'criacao' && n.date && n.key){
        await db.ref(`painel/${n.date}/criacaoNoturna/audit/${n.key}`).remove();
        db.ref(`painel/${n.date}/criacaoNoturna/log`).push({by:`Admin ${_name||''}`.trim(), at:Date.now(), action:'aceitou justificativa — erro resolvido', detail:n.torneio||n.key});
      }
    }catch(e){}
    await db.ref(`userNotifs/${opKey}/${nid}/resolved`).set(true);
    await db.ref(`users/${opKey}/pendingNotif`).remove();
    invalidateNotifsCache();
    toast('✓ Notificação resolvida — operador liberado','ok');
    openJustifs();
    loadPendingNotifs();
  } catch(e){ toast('Erro: '+e.message,'err'); }
}

/* ══════════════════════════════════════════════════════════════
   SISTEMA DE AUDITORIA — nó separado no Firebase
   auditoria/{YYYY-MM-DD}/{key} = {
     premiacaoAuditada, fieldAuditado, premiacaoOriginal, fieldOriginal,
     status: "corrigido"|"aprovado", obs, auditadoEm, auditadoPor
   }
══════════════════════════════════════════════════════════════ */

let _auditData = {};     // { date: { key: {...} } }
let _auditContext = null; // contexto do modal aberto

// Carregar dados de auditoria do Firebase
async function loadAuditData(){
  if(!fbOk) return;
  try{
    const snap = await db.ref('auditoria').once('value');
    _auditData = snap.val() || {};
    console.log('[Audit] dados carregados:', Object.keys(_auditData).length, 'dias');
  } catch(e){ console.warn('loadAuditData:', e.message); }
}

// Verificar se um row tem dados auditados
function getAuditEntry(date, key){
  return _auditData[date]?.[key] || null;
}

// Abrir modal de edição
function openAuditEditByEl(btn){
  const key  = btn.dataset.key;
  const date = btn.dataset.date;
  // Encontrar o row completo em _auditRows
  const r = _auditRows.find(r=>r.key===key&&r.date===date);
  if(!r){ toast('Dado não encontrado','err'); return; }
  // Passar os valores ORIGINAIS de verdade (não os já corrigidos): se a linha já foi
  // auditada, r.premiacao/field/garantido são os CORRIGIDOS. Usá-los como "original" fazia
  // o premiacaoOriginal derivar a cada reedição (perdia o valor real da planilha). O
  // prefill do input continua vindo do premiacaoAuditada dentro de openAuditEdit.
  const e = r._auditEntry;
  openAuditEdit({key:r.key,date:r.date,nome:r.nome,hora:r.hora,
    premiacao: e && e.premiacaoOriginal!=null ? e.premiacaoOriginal : r.premiacao,
    field:     e && e.fieldOriginal!=null     ? e.fieldOriginal     : r.field,
    garantido: e && e.garantidoOriginal!=null ? e.garantidoOriginal : r.garantido,
    buyin:     e && e.buyinOriginal!=null      ? e.buyinOriginal     : r.buyin});
}

function openNotifByEl(btn){
  // enriquece o contexto com os VALORES da linha (achados em _auditRows por
  // key+date) pra a notificação já sugerir o tipo de erro e a descrição.
  const key=btn.dataset.key, date=btn.dataset.date;
  const row=(typeof _auditRows!=='undefined'&&Array.isArray(_auditRows))
    ? _auditRows.find(r=>r.key===key&&r.date===date) : null;
  openNotif(Object.assign({
    nome:  btn.dataset.nome,
    date:  date,
    fixBy: btn.dataset.fixby,
    key:   key,
  }, row ? {
    premiacao:row.premiacao, field:row.field, garantido:row.garantido,
    overlay:row.overlay, id:row.id, buyin:row.buyin, hora:row.hora, status:row.status,
  } : {}));
}

/* ── Notificação inteligente ──
   A partir dos valores da linha, adivinha o TIPO de erro mais provável e escreve
   uma descrição específica (com os números reais). O admin ainda revisa e pode
   trocar o tipo/texto — isto só tira o trabalho de digitar o óbvio. */
function suggestNotif(ctx){
  if(!ctx) return null;
  const g=ctx.garantido, p=ctx.premiacao, f=ctx.field, ov=ctx.overlay, id=ctx.id, b=ctx.buyin;
  const money=v=>'R$ '+brl(v||0);
  const idFalta = (id==null || String(id).trim()==='' || String(id).toUpperCase()==='NF');
  // 1) ID de evento ausente — o erro operacional mais comum e barato de corrigir
  if(idFalta && ctx.status!=='nf'){
    return {type:'id', desc:`O torneio ${ctx.nome||''} foi registrado sem o ID do evento. Confirme e preencha o ID correto.`};
  }
  // 2) Premiação zerada
  if(p===0 && g>0){
    return {type:'premiacao', desc:`Premiação registrada como R$ 0 com garantido de ${money(g)}. Confirme o valor real da premiação paga.`};
  }
  // 3) Overlay alto (>50% do GTD) — geralmente premiação subestimada ou field errado
  if(ov!=null && ov<0 && g && Math.abs(ov) > g*0.5){
    return {type:'premiacao', desc:`Overlay de ${money(Math.abs(ov))} — mais de 50% do garantido de ${money(g)}. Revise a premiação${f!=null?` e o field (${f} jogadores)`:''} registrados.`};
  }
  // 4) Premiação muito acima do garantido (3x) — provável erro de digitação
  if(p!=null && g && p > g*3){
    return {type:'premiacao', desc:`Premiação de ${money(p)} é mais de 3× o garantido de ${money(g)}. Confirme se o valor não foi digitado errado.`};
  }
  // 5) Field baixo demais pro GTD (arrecadação < 10% do garantido)
  if(f!=null && b && f>0 && g && (f*b) < g*0.1){
    return {type:'field', desc:`Field de ${f} jogadores parece baixo para o garantido de ${money(g)}. Confirme o número de entradas.`};
  }
  return null;
}

function openAuditEdit(ctx){
  /* Só objeto. Havia aqui um ramo que aceitava STRING, desescapava &quot; e
     fazia JSON.parse — o padrão de "JSON embutido em atributo HTML", que quebra
     no primeiro nome de torneio com aspa e é porta de injeção. Ninguém chamava
     mais assim (o openAuditEditByEl passa objeto, lido de data-key/data-date),
     mas o ramo continuava lá convidando ao reuso. */
  _auditContext = ctx;
  const audit = getAuditEntry(_auditContext.date, _auditContext.key);

  document.getElementById('auditErr').style.display = 'none';
  document.getElementById('auditSubtitle').textContent =
    `${_auditContext.nome} · ${_auditContext.hora} · ${_auditContext.date?fmtDate(_auditContext.date):''}`;

  // Valores originais
  document.getElementById('auditOrigPrem').textContent =
    _auditContext.premiacao != null ? 'R$ '+brl(_auditContext.premiacao) : '—';
  document.getElementById('auditOrigField').textContent =
    _auditContext.field != null ? _auditContext.field+' jog.' : '—';
  document.getElementById('auditOrigGar').textContent =
    _auditContext.garantido != null ? 'R$ '+brl(_auditContext.garantido) : '—';
  document.getElementById('auditOrigBuyin').textContent =
    _auditContext.buyin != null ? 'R$ '+brl(_auditContext.buyin) : '—';

  // Preencher com valor já auditado (se existir) ou original
  const premVal  = audit?.premiacaoAuditada ?? _auditContext.premiacao;
  const garVal   = audit?.garantidoAuditado ?? _auditContext.garantido;
  const buyinVal = audit?.buyinAuditada ?? _auditContext.buyin;
  document.getElementById('auditPremInput').value =
    premVal != null ? brl(premVal,2) : '';
  document.getElementById('auditFieldInput').value =
    audit?.fieldAuditado ?? _auditContext.field ?? '';
  document.getElementById('auditGarInput').value =
    garVal != null ? brl(garVal,2) : '';
  document.getElementById('auditBuyinInput').value =
    buyinVal != null ? brl(buyinVal,2) : '';
  document.getElementById('auditObs').value = audit?.obs || '';
  document.getElementById('auditApproved').checked = audit?.status === 'aprovado';

  document.getElementById('moAudit').classList.add('open');
  setTimeout(() => document.getElementById('auditPremInput').focus(), 80);
}

// Salvar auditoria no Firebase
async function saveAudit(){
  if(!_auditContext) return;
  if(!fbOk){ toast('Firebase não conectado','err'); return; }

  const btn   = document.getElementById('auditBtnLabel');
  const errEl = document.getElementById('auditErr');
  const premRaw  = document.getElementById('auditPremInput').value.trim();
  const fieldRaw = document.getElementById('auditFieldInput').value.trim();
  const garRaw   = document.getElementById('auditGarInput').value.trim();
  const buyinRaw = document.getElementById('auditBuyinInput').value.trim();
  const obs      = document.getElementById('auditObs').value.trim();
  const approved = document.getElementById('auditApproved').checked;

  errEl.style.display = 'none';
  if(!premRaw && !fieldRaw && !garRaw && !buyinRaw && !approved){
    errEl.textContent = 'Preencha ao menos um valor ou marque como aprovado.';
    errEl.style.display = 'block'; return;
  }

  const prem  = premRaw  ? parseBRL(premRaw)  : null;
  const field = fieldRaw ? parseInt(fieldRaw,10) : null;
  const gar   = garRaw   ? parseBRL(garRaw)   : null;
  const buyin = buyinRaw ? parseBRL(buyinRaw) : null;

  if(premRaw && isNaN(prem)){
    errEl.textContent = 'Premiação inválida.'; errEl.style.display='block'; return;
  }
  if(garRaw && isNaN(gar)){
    errEl.textContent = 'Garantido inválido.'; errEl.style.display='block'; return;
  }
  if(buyinRaw && isNaN(buyin)){
    errEl.textContent = 'Buy-in inválido.'; errEl.style.display='block'; return;
  }

  btn.textContent = 'Salvando...';

  const entry = {
    premiacaoOriginal: _auditContext.premiacao ?? null,
    fieldOriginal:     _auditContext.field ?? null,
    garantidoOriginal: _auditContext.garantido ?? null,
    buyinOriginal:     _auditContext.buyin ?? null,
    premiacaoAuditada: approved ? (_auditContext.premiacao ?? null) : (prem ?? null),
    fieldAuditado:     approved ? (_auditContext.field ?? null) : (field ?? null),
    garantidoAuditado: approved ? (_auditContext.garantido ?? null) : (gar ?? null),
    buyinAuditada:     approved ? (_auditContext.buyin ?? null) : (buyin ?? null),
    status:    approved ? 'aprovado' : 'corrigido',
    obs:       obs || null,
    auditadoEm:   Date.now(),
    auditadoPor:  _email || 'admin',
    nome:      _auditContext.nome,
    hora:      _auditContext.hora,
  };

  try {
    await db.ref(`auditoria/${_auditContext.date}/${_auditContext.key}`).set(entry);

    // Se corrigido: sobrescrever o dado ao vivo no painel também
    if(!approved){
      const basePath = `painel/${_auditContext.date}`;
      if(prem != null){
        await db.ref(`${basePath}/premiacao/${_auditContext.key}`).set(prem);
        // A correção do admin é um preenchimento HUMANO: precisa de carimbo premBy, senão o gate
        // do painel (e agora o do admin) a trata como valor-fantasma e NÃO exibe em lugar nenhum.
        // Só carimba se ainda não houver — preserva o crédito do operador que já tinha preenchido.
        const pbRef = db.ref(`${basePath}/premBy/${_auditContext.key}`);
        if(!(await pbRef.once('value')).exists()){
          await pbRef.set({ by: (_email || 'Admin') + ' (auditoria)', at: Date.now() });
        }
      }
      if(field != null) await db.ref(`${basePath}/field/${_auditContext.key}`).set(field);
      if(gar != null)   await db.ref(`${basePath}/garantido/${_auditContext.key}`).set(gar);
      // Buy-in corrigido: overlay próprio (painel/<data>/buyin) que o painel lê e sobrepõe à
      // planilha, recalculando as "ações". Não muda a rowKey (ela usa o buy-in da planilha).
      if(buyin != null) await db.ref(`${basePath}/buyin/${_auditContext.key}`).set(buyin);
    }

    // Atualizar cache local
    if(!_auditData[_auditContext.date]) _auditData[_auditContext.date] = {};
    _auditData[_auditContext.date][_auditContext.key] = entry;
    // Atualizar _auditRows para refletir o novo valor
    _auditRows.forEach(r => {
      if(r.date === _auditContext.date && r.key === _auditContext.key){
        r._audited = true;
        r._auditEntry = entry;
        if(!approved){
          if(prem != null)  r.premiacao = prem;
          if(field != null) r.field = field;
          if(gar != null)   r.garantido = gar;
          if(buyin != null) r.buyin = buyin;
          // Recalcular overlay/perf
          if(r.premiacao != null && r.garantido != null){
            r.overlay = r.premiacao - r.garantido < 0 ? r.premiacao - r.garantido : null;
            r.perf    = r.garantido > 0 ? Math.round(((r.premiacao-r.garantido)/r.garantido)*1000)/10 : null;
          }
          // Recalcular ações (prem ÷ buy-in líquido) — buy-in ou premiação podem ter mudado
          r.acoes = (r.premiacao != null && r.buyin && r.netFactor)
            ? Math.round(r.premiacao/(r.buyin*r.netFactor)) : null;
        }
      }
    });

    closeMo('moAudit');
    toast(approved ? '✓ Aprovado sem correção' : '✓ Dado corrigido e salvo no Firebase', 'ok');
    // 12. Log de auditoria permanente
    writeAdminLog(approved ? 'aprovar' : 'corrigir', {
      torneio: _auditContext.nome, date: _auditContext.date,
      premOriginal: _auditContext.premiacao, premNova: approved?null:prem,
      fieldOriginal: _auditContext.field, fieldNovo: approved?null:field,
      garOriginal: _auditContext.garantido, garNovo: approved?null:gar,
      buyinOriginal: _auditContext.buyin, buyinNovo: approved?null:buyin,
      obs,
    });
    // Re-renderizar a auditoria para mostrar badge
    loadAudit();
    // Correção mudou um valor → reescreve a aba do dia no Sheets (silencioso se não configurado)
    if(!approved) autoResendSheets(_auditContext.date);
  } catch(e){
    errEl.textContent = 'Erro: '+e.message; errEl.style.display='block';
  } finally {
    btn.textContent = 'Salvar auditoria';
  }
}

/* ── ADICIONAR TORNEIO (audit-only) ──────────────────────────────
   Lança um torneio que não veio na planilha. Grava a base em
   painel/<data>/manualRows/<rk_key> (nó que só o admin lê — mergeDayInto o dobra
   em _allData[date].rows como qualquer linha) e os valores preenchidos nos MESMOS
   nós overlay do painel (premiacao/premBy/field/garantido/ids), pelo mesmo padrão
   do saveAudit. Não toca em painel/<data>/sheet.rows → não aparece na grade ao
   vivo dos operadores. */
/* ── MULTIDAY (torneio A/B/C + Dia 2) ─────────────────────────────
   Um multiday é UM torneio jogado em vários dias: os flights de Dia 1 (A, B, C…)
   e o Dia 2, que é a final. O VALOR do torneio (garantido e arrecadado) é do DIA 2 —
   se cada flight carregasse o garantido, o total do dia contaria o mesmo prêmio uma
   vez por flight, inflando garantido, overlay e performance. Então o flight entra na
   grade e conta jogadores/buy-in (entradas de verdade), mas SEM garantido e SEM
   arrecadado. Marcadores gravados na row (o painel lê e respeita a mesma regra):
     mdEtapa  'd1' (flight) | 'd2' (final)
     mdFlight 'A', 'B', 'C'… (só no Dia 1)
     mdGrupo  nome do multiday em CAIXA ALTA — amarra os flights à final          */
function multidaySuffix(etapa, flight){
  if(etapa === 'd1') return ' · Dia 1' + (flight || '');
  if(etapa === 'd2') return ' · Dia 2';
  return '';
}
function multidayGrupoKey(nome){ return String(nome || '').trim().toUpperCase(); }

/* Etapa escolhida no modal: mostra o campo do flight, TRAVA garantido/arrecadado no
   Dia 1 (deixá-los digitáveis só convidaria a lançar o mesmo prêmio em cada flight)
   e explica em uma linha o que a etapa faz com os números. */
function syncAddEtapa(){
  const sel = document.getElementById('addEtapa');
  if(!sel) return;
  const etapa = sel.value;
  const wrap  = document.getElementById('addFlightWrap');
  const flight= document.getElementById('addFlight');
  const hint  = document.getElementById('addEtapaHint');
  if(wrap) wrap.style.display = etapa === 'd1' ? '' : 'none';
  if(flight && etapa !== 'd1') flight.value = '';
  ['addGar','addPrem'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    el.disabled = etapa === 'd1';
    el.style.opacity = etapa === 'd1' ? '.45' : '';
    if(etapa === 'd1'){ el.value=''; el.placeholder='vale no Dia 2'; }
    else el.placeholder = id === 'addGar' ? '0,00' : '—';
  });
  if(hint){
    hint.style.display = etapa ? '' : 'none';
    if(etapa === 'd1') hint.innerHTML = 'O flight entra na grade e conta <b>jogadores e buy-in</b>, mas fica sem garantido e sem arrecadado — quem fecha o valor do multiday é o <b>Dia 2</b>.';
    else if(etapa === 'd2') hint.innerHTML = 'A final <b>carrega o valor do multiday inteiro</b>: garantido, arrecadado, overlay e performance saem daqui. Os flights de Dia 1 só somam jogadores.';
  }
}

function openAddTorneio(){
  const err = document.getElementById('addErr');
  if(err){ err.style.display='none'; err.textContent=''; }
  const d = document.getElementById('addDate');
  if(d) d.value = document.getElementById('auFrom')?.value || nowSP();
  ['addNome','addHora','addBuyin','addGar','addPrem','addField','addId','addObs','addFlight']
    .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const cat = document.getElementById('addCat'); if(cat) cat.value='side';
  const et = document.getElementById('addEtapa'); if(et) et.value='';
  syncAddEtapa();   // reabrir o modal volta pro estado "evento normal" (destrava os valores)
  document.getElementById('moAddTorneio').classList.add('open');
  loadManualList();   // mostra (e permite excluir) o que já foi adicionado nessa data
  setTimeout(() => document.getElementById('addNome')?.focus(), 80);
}

async function saveAddTorneio(){
  if(!fbOk){ toast('Firebase não conectado','err'); return; }
  const err = document.getElementById('addErr');
  const lbl = document.getElementById('addBtnLabel');
  const fail = m => { err.textContent=m; err.style.display='block'; };
  err.style.display='none';

  const date     = document.getElementById('addDate').value;
  const nomeBase = document.getElementById('addNome').value.trim();
  const hora     = document.getElementById('addHora').value.trim();
  const cat      = document.getElementById('addCat').value || 'side';
  const etapaSel = document.getElementById('addEtapa');
  const etapa    = etapaSel ? etapaSel.value : '';
  const flightEl = document.getElementById('addFlight');
  const flight   = flightEl ? flightEl.value.trim().toUpperCase() : '';
  const buyinRaw = document.getElementById('addBuyin').value.trim();
  const garRaw   = document.getElementById('addGar').value.trim();
  const premRaw  = document.getElementById('addPrem').value.trim();
  const fieldRaw = document.getElementById('addField').value.trim();
  const idVal    = document.getElementById('addId').value.trim();
  const obs      = document.getElementById('addObs').value.trim();

  if(!date)      return fail('Escolha a data da grade.');
  if(!nomeBase)  return fail('Preencha o nome do torneio.');
  if(!/^\d{1,2}:\d{2}$/.test(hora)) return fail('Hora inválida — use HH:MM (ex: 20:00).');
  // sem a letra, dois flights do mesmo multiday no mesmo horário ficariam indistinguíveis
  if(etapa === 'd1' && !flight) return fail('Diga qual é o flight (A, B, C…).');

  // o nome que vai pra grade carrega a etapa: "SPS Mystery Multiday · Dia 1B"
  const nome  = nomeBase + multidaySuffix(etapa, flight);
  const isFlight = etapa === 'd1';
  const buyin = buyinRaw ? parseBRL(buyinRaw)     : null;
  // flight de Dia 1 NUNCA carrega valor — o garantido/arrecadado do multiday é do Dia 2
  const gar   = isFlight ? null : (garRaw  ? parseBRL(garRaw)  : null);
  const prem  = isFlight ? null : (premRaw ? parseBRL(premRaw) : null);
  const field = fieldRaw ? parseInt(fieldRaw,10)  : null;
  if(buyinRaw && isNaN(buyin)) return fail('Buy-in inválido.');
  if(!isFlight && garRaw  && isNaN(gar))   return fail('Garantido inválido.');
  if(!isFlight && premRaw && isNaN(prem))  return fail('Arrecadado inválido.');

  // MESMA forma da linha manual do PAINEL (buildManualRow) — é isto que faz o painel fundir
  // este torneio na grade AO VIVO exatamente como a ferramenta "Adicionar torneio" dele:
  // `_manual:true` faz o ingest do painel tratá-lo como manual (separa da planilha, não
  // duplica, sobrevive a re-upload da Global). Quando a data for a de hoje, o operador vê o
  // card na hora; para datas passadas, entra só na auditoria (o painel só funde o dia atual).
  // `tipo` = categoria escolhida; classify() já mapeia 'main'/'side'/'sat' de volta pra cat.
  const row = {
    nome, hora, late:null,
    garantido: gar!=null?gar:null,
    buyin: buyin!=null?buyin:null,
    premiacao:null, premFromSheet:false, explicitNF:false, overlay:null,
    field: field!=null?field:null, acoes:null, perf:null, check:null,
    tipo:cat, highlighted:false,
    // multiday: o painel lê estes 3 campos pra tirar o flight dos valores (ver bloco
    // MULTIDAY no painel.js) — card sem arrecadado, fora de overlay/performance/fechamento
    mdEtapa: (etapa === 'd1' || etapa === 'd2') ? etapa : null,
    mdFlight: isFlight ? flight : null,
    mdGrupo: etapa ? multidayGrupoKey(nomeBase) : null,
    _manual:true,                       // ← painel: trata como torneio manual (grade ao vivo)
    manual:true,                        // compat: o merge da auditoria (mergeDayInto) usa este flag
    obs: obs||null,
    _by:(_email||'admin'), by:(_email||'admin'), _at:Date.now(), at:Date.now(),
  };
  const key = rowKey(row);              // hash de nome|hora|buyin|garantido (mesmo do painel)
  const stamp = { by:(_email||'Admin')+' (add)', at:Date.now() };

  if(lbl) lbl.textContent='Adicionando...';
  try{
    const base = `painel/${date}`;
    await db.ref(`${base}/manualRows/${key}`).set(row);
    if(idVal)      await db.ref(`${base}/ids/${key}`).set({ val:idVal, by:stamp.by, at:stamp.at });
    if(gar != null)   await db.ref(`${base}/garantido/${key}`).set(gar);
    if(field != null) await db.ref(`${base}/field/${key}`).set(field);
    if(prem != null){
      await db.ref(`${base}/premiacao/${key}`).set(prem);
      // carimbo premBy obrigatório, senão o gate de premiação-fantasma esconde o valor (ver saveAudit)
      await db.ref(`${base}/premBy/${key}`).set(stamp);
    }

    // Reflete em memória já (sem esperar o refresh ao vivo)
    if(!_allData[date]) _allData[date]={rows:{},fixed:{},ids:{},field:{},prem:{},guar:{},buy:{},premBy:{}};
    _allData[date].rows[key]={...row,_key:key,manual:true};
    if(idVal)      _allData[date].ids[key]={val:idVal,by:stamp.by};
    if(gar != null)   _allData[date].guar[key]=gar;
    if(field != null) _allData[date].field[key]=field;
    if(prem != null){ _allData[date].prem[key]=prem; _allData[date].premBy[key]={by:stamp.by,at:stamp.at}; }

    closeMo('moAddTorneio');
    toast(date === nowSP()
      ? '✓ Torneio adicionado — já está na grade ao vivo de hoje'
      : '✓ Torneio adicionado à auditoria','ok');
    writeAdminLog('adicionar', { torneio:nome, date, hora, cat, buyin, garantido:gar, premiacao:prem, field, id:idVal, obs,
      etapa: etapa || null, flight: flight || null });

    // Garante que o período visível cobre a data lançada, senão a linha não apareceria
    const fromEl=document.getElementById('auFrom'), toEl=document.getElementById('auTo');
    if(fromEl && date < fromEl.value) fromEl.value=date;
    if(toEl   && date > toEl.value)   toEl.value=date;
    loadAudit();
  }catch(e){
    fail('Erro: '+e.message);
  }finally{
    if(lbl) lbl.textContent='Adicionar à auditoria';
  }
}

/* ── EXCLUIR TORNEIO ADICIONADO À MÃO ────────────────────────────
   Só vale pra linha que veio de painel/<data>/manualRows (a ferramenta
   "Adicionar torneio"). Linha da planilha NÃO tem este botão: apagá-la aqui
   não adiantaria nada — o próximo ingest da Global traria de volta, e o
   admin ficaria achando que excluiu.

   Apaga o nó base E os valores que o "Adicionar" gravou junto (ids, garantido,
   field, premiacao/premBy, fixed). Deixar esses pendurados seria pior que não
   excluir: a chave é hash de nome|hora|buyin|garantido, então recriar o mesmo
   torneio ressuscitaria arrecadado e field antigos sem ninguém digitar nada. */
async function removeAddedTorneio(key, date){
  if(!fbOk){ toast('Firebase não conectado','err'); return; }
  if(!key || !date){ toast('Torneio sem referência — recarregue a página','err'); return; }
  const linha = (_allData[date] && _allData[date].rows && _allData[date].rows[key]) || {};
  if(!linha.manual){ toast('Só dá pra excluir torneio adicionado à mão','err'); return; }
  const nome = linha.nome || 'este torneio';
  const [y,m,d] = String(date).split('-');
  if(!confirm(`Excluir "${nome}" de ${d}/${m}/${y}?\n\nApaga também o arrecadado, o field, o garantido e o ID lançados nele. Não dá pra desfazer.`)) return;

  try{
    await wipeManualRow(date, key, nome, linha.hora||null);
    toast('✓ Torneio excluído','ok');
    loadAudit();
  }catch(e){
    toast('Falha ao excluir: '+e.message,'err');
  }
}

/* apaga o nó base + os valores que o "Adicionar" gravou junto. Extraído porque a
   lista do modal (loadManualList) precisa exatamente da mesma limpeza — duas
   versões disso divergiriam e uma delas deixaria valor órfão. */
async function wipeManualRow(date, key, nome, hora){
  const base = `painel/${date}`;
  // manualRows por último: enquanto ele existir, a linha ainda aparece — se algum
  // remove falhar no meio, o admin vê o torneio lá e pode repetir a exclusão
  await Promise.all(['ids','garantido','field','premiacao','premBy','fixed']
    .map(no => db.ref(`${base}/${no}/${key}`).remove().catch(()=>{})));
  await db.ref(`${base}/manualRows/${key}`).remove();

  // espelha em memória pra lista sumir sem esperar o refresh ao vivo
  const dia = _allData[date];
  if(dia) ['rows','ids','field','prem','guar','premBy','fixed','buy'].forEach(b => { if(dia[b]) delete dia[b][key]; });

  await writeAdminLog('excluir', { torneio:nome||null, date, hora:hora||null, key });
}

/* ── LISTA DO QUE JÁ FOI ADICIONADO À MÃO (dentro do modal) ──────────────
   Por que existe, se a linha da auditoria já tem o 🗑: aquele botão só aparece
   quando a linha chega à tabela COM o flag `manual`. O flatRows deduplica por
   nome+hora, então se a Global passar a trazer um torneio que alguém já tinha
   adicionado à mão, a linha da planilha vence — o flag some, o 🗑 não é
   desenhado, e o registro fica INVISÍVEL e impossível de apagar, continuando a
   somar arrecadado/field na auditoria. Esta lista lê o nó CRU
   (painel/<data>/manualRows), então o que foi criado à mão sempre dá pra tirar. */
async function loadManualList(){
  const wrap = document.getElementById('addExistingWrap');
  const list = document.getElementById('addExistingList');
  const cnt  = document.getElementById('addExistingCount');
  if(!wrap || !list) return;
  const date = document.getElementById('addDate')?.value;
  if(!fbOk || !date){ wrap.style.display='none'; return; }
  let val = null;
  // sem permissão/offline: esconde em vez de mostrar caixa vazia (que leria como
  // "não há nada adicionado" — mentira perigosa numa tela de exclusão)
  try{ val = (await db.ref(`painel/${date}/manualRows`).once('value')).val(); }
  catch(e){ wrap.style.display='none'; return; }
  const itens = Object.entries(val || {})
    .filter(([,r]) => r && typeof r === 'object' && r.nome)
    .sort((a,b) => String(a[1].hora||'').localeCompare(String(b[1].hora||'')));
  if(!itens.length){ wrap.style.display='none'; list.innerHTML=''; return; }
  wrap.style.display='';
  if(cnt) cnt.textContent = `· ${itens.length}`;
  list.innerHTML = itens.map(([k,r]) => `
    <div class="manual-row">
      <div class="manual-info">
        <b>${esc(r.nome)}</b>
        <span>${esc(r.hora||'--:--')}${r.buyin!=null?' · buy-in R$ '+brl(r.buyin):''}${r.garantido!=null?' · gtd R$ '+brl(r.garantido):''}</span>
      </div>
      <button class="btn-del-manual" title="Excluir este torneio adicionado à mão"
        data-act="removeManualByEl" data-act-self data-key="${esc(k)}" data-date="${esc(date)}"
        data-nome="${esc(r.nome)}" data-hora="${esc(r.hora||'')}"
        aria-label="Excluir ${esc(r.nome)}">🗑</button>
    </div>`).join('');
}
function removeManualByEl(el){
  if(!el) return;
  removeManualFromList(el.dataset.key, el.dataset.date, el.dataset.nome, el.dataset.hora);
}
async function removeManualFromList(key, date, nomeAttr, hora){
  if(!fbOk){ toast('Firebase não conectado','err'); return; }
  if(!key || !date){ toast('Torneio sem referência — reabra o modal','err'); return; }
  const nome = nomeAttr || 'este torneio';
  const [y,m,d] = String(date).split('-');
  if(!confirm(`Excluir "${nome}"${hora ? ' ('+hora+')' : ''} de ${d}/${m}/${y}?\n\nApaga também o arrecadado, o field, o garantido e o ID lançados nele. Não dá pra desfazer.`)) return;
  try{
    await wipeManualRow(date, key, nome, hora || null);
    toast('✓ Torneio excluído','ok');
    await loadManualList();   // a lista vem do nó cru: recarrega pra refletir o que sobrou
    loadAudit();
  }catch(e){
    toast('Falha ao excluir: '+e.message,'err');
  }
}
/* o botão vive numa linha gerada pelo próprio admin.js — mesmo padrão de
   openAuditEditByEl: o dispatcher entrega o elemento e a chave vem do dataset */
function removeAddedTorneioByEl(el){
  if(!el) return;
  removeAddedTorneio(el.dataset.key, el.dataset.date);
}

/* ── BOARD DA CAMPANHA (config do telão SPS) ──────────────────────
   Escreve em campanhas/sps { nome, inicio, fim, meta, metaMetric }. O board
   campanha.html lê daqui (e cai nos defaults embutidos se o nó não existir).
   Os TOTAIS do board vêm da mesma fonte deste dashboard (campanha-core), então
   batem 100% — aqui só se define o RECORTE (nome/período/meta). */
const CAMP_CFG_DEFAULT = { nome:'SPS', inicio:'2026-08-01', fim:'2026-09-20', meta:null, metaMetric:'arrecadado' };
async function openCampanhaCfg(){
  const err = document.getElementById('campErr'); if(err){ err.style.display='none'; err.textContent=''; }
  let c = {};
  try{ if(fbOk) c = (await db.ref('campanhas/sps').once('value')).val() || {}; }catch(e){}
  const cfg = Object.assign({}, CAMP_CFG_DEFAULT, c);
  document.getElementById('campNome').value   = cfg.nome || 'SPS';
  document.getElementById('campInicio').value = cfg.inicio || '';
  document.getElementById('campFim').value    = cfg.fim || '';
  document.getElementById('campMeta').value   = (cfg.meta != null && cfg.meta !== '') ? brl(cfg.meta,2) : '';
  document.getElementById('campMetaMetric').value = cfg.metaMetric || 'arrecadado';
  document.getElementById('moCampanha').classList.add('open');
}
async function saveCampanhaCfg(){
  if(!fbOk){ toast('Firebase não conectado','err'); return; }
  const err = document.getElementById('campErr');
  const lbl = document.getElementById('campBtnLabel');
  const fail = m => { err.textContent=m; err.style.display='block'; };
  err.style.display='none';
  const nome    = document.getElementById('campNome').value.trim() || 'SPS';
  const inicio  = document.getElementById('campInicio').value;
  const fim     = document.getElementById('campFim').value;
  const metaRaw = document.getElementById('campMeta').value.trim();
  const metric  = document.getElementById('campMetaMetric').value || 'arrecadado';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return fail('Escolha a data de início.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fim))    return fail('Escolha a data de fim.');
  if(fim < inicio) return fail('O fim não pode ser antes do início.');
  const meta = metaRaw ? parseBRL(metaRaw) : null;
  if(metaRaw && (isNaN(meta) || meta < 0)) return fail('Meta inválida.');
  const cfg = { nome, inicio, fim, meta: (meta != null ? meta : null), metaMetric: metric, at: Date.now(), by: (_email||'admin') };
  if(lbl) lbl.textContent='Salvando...';
  try{
    await db.ref('campanhas/sps').set(cfg);
    closeMo('moCampanha');
    toast('✓ Board da campanha atualizado','ok');
    writeAdminLog('campanha', { nome, inicio, fim, meta, metric });
  }catch(e){
    fail('Erro: '+e.message + (String(e.message||'').indexOf('permission')>-1 ? ' — as regras do Firebase precisam ser publicadas (nó campanhas).' : ''));
  }finally{
    if(lbl) lbl.textContent='Salvar campanha';
  }
}

// Enriquecer flatRows com dados de auditoria
function enrichWithAudit(rows){
  return rows.map(r => {
    const a = getAuditEntry(r.date, r.key);
    if(!a) return r;
    const corr = a.status === 'corrigido';
    // Honra o valor AUDITADO quando corrigido, E TAMBÉM quando um "aprovado" preservou uma
    // correção anterior (auditada ≠ original). Antes, "aprovado" ignorava a auditada e caía
    // no valor da planilha — então aprovar um que você já tinha corrigido REVERTIA o valor
    // (o "muda o valor" relatado). Aprovação limpa (auditada == original) segue o valor vivo.
    const useAudited = (aud, orig) => aud != null && (corr || aud !== orig);
    const prem = useAudited(a.premiacaoAuditada, a.premiacaoOriginal) ? a.premiacaoAuditada : r.premiacao;
    const gar  = useAudited(a.garantidoAuditado, a.garantidoOriginal) ? a.garantidoAuditado : r.garantido;
    const field= useAudited(a.fieldAuditado,     a.fieldOriginal)     ? a.fieldAuditado     : r.field;
    const buyin= useAudited(a.buyinAuditada,     a.buyinOriginal)     ? a.buyinAuditada     : r.buyin;
    // Recalcular overlay/perf com base nos valores corrigidos
    const diff = prem!=null&&gar!=null ? prem-gar : null;
    const overlay = diff!=null&&diff<0 ? diff : null;
    const perf = prem!=null&&gar!=null&&gar>0 ? Math.round(((prem-gar)/gar)*10000)/100 : null;
    // Ações recalculadas — buy-in ou premiação corrigidos mudam o número de entradas
    const acoes = (prem!=null && buyin && r.netFactor) ? Math.round(prem/(buyin*r.netFactor)) : r.acoes;
    return {
      ...r,
      _audited: true,
      _auditEntry: a,
      premiacao: prem,
      garantido: gar,
      field,
      buyin,
      overlay,
      perf,
      acoes,
    };
  });
}

/* ── EXPORTS ─────────────────────────────────────────────────── */
async function exportAuditXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  if(!_auditRows.length){toast('Carregue os dados primeiro','err');return;}
  const byDate={};
  _auditRows.forEach(r=>{if(!byDate[r.date])byDate[r.date]=[];byDate[r.date].push(r);});
  const wb=XLSX.utils.book_new();

  Object.keys(byDate).sort().forEach(date=>{
    const dayRows=byDate[date];
    const aoa=[];
    const styleMap={};
    const dateLabel=fmtDate(date);
    aoa.push([`RELATÓRIO DE ACOMPANHAMENTO — ${dateLabel}`]);
    aoa.push([]);

    const groups=[
      {cat:'main',rows:sortByTime(dayRows.filter(r=>r.cat==='main'))},
      {cat:'side',rows:sortByClock(dayRows.filter(r=>r.cat==='side'))},
      {cat:'sat', rows:sortByTime(dayRows.filter(r=>r.cat==='sat'))},
    ].filter(g=>g.rows.length);

    const totalsByGroup={};
    groups.forEach(g=>{
      const cc=CAT_COLORS[g.cat];
      const ghRow=aoa.length;
      aoa.push([cc.label]);
      const chRow=aoa.length;
      aoa.push(COL_HEADERS);
      let sg=0,sp=0,so=0,sa=0,cnt=0;
      g.rows.forEach(r=>{
        const drRow=aoa.length;
        const ov=r.overlay??'',perf=r.perf??'';
        aoa.push([r.nome,r.hora,r.late,catLabel(r.cat),
          r.garantido??'',r.buyin??'',r.premiacao??'',ov,r.field??'',r.acoes??'',perf,
          r.fixBy||r.idBy||'',r.id,statusLabel(r.status)]);
        cnt++;if(r.garantido)sg+=r.garantido;if(r.premiacao)sp+=r.premiacao;if(r.overlay)so+=r.overlay;if(r.acoes)sa+=r.acoes;
        if(r.status==='nf')for(let c=0;c<14;c++)styleMap[XLSX.utils.encode_cell({r:drRow,c})]={font:{color:{rgb:'888888'},italic:true},fill:{fgColor:{rgb:'F5F5F5'}}};
        else if(r.overlay<0)styleMap[XLSX.utils.encode_cell({r:drRow,c:7})]={font:{bold:true,color:{rgb:'C62828'}}};
        if(r.perf!=null)styleMap[XLSX.utils.encode_cell({r:drRow,c:10})]={font:{bold:true,color:{rgb:r.perf>=0?'1B5E20':'C62828'}}};
      });
      const totRow=aoa.length;
      aoa.push([`Total (${cnt})`,'','','',sg?'R$ '+brl(sg):'','',sp?'R$ '+brl(sp):'',so?'R$ '+brl(so):'—','',sa?brl(sa,0):'','','','','']);
      aoa.push([]);
      styleMap[XLSX.utils.encode_cell({r:ghRow,c:0})]={font:{bold:true,color:{rgb:'FFFFFF'},sz:12},fill:{fgColor:{rgb:cc.header}}};
      for(let c=0;c<COL_HEADERS.length;c++)styleMap[XLSX.utils.encode_cell({r:chRow,c})]={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:cc.sub}},alignment:{horizontal:'center'}};
      styleMap[XLSX.utils.encode_cell({r:totRow,c:0})]={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:cc.sub}}};
      totalsByGroup[g.cat]={sg,sp,so,sa,cnt};
    });

    const allG=groups.reduce((s,g)=>s+(totalsByGroup[g.cat]?.sg||0),0);
    const allP=groups.reduce((s,g)=>s+(totalsByGroup[g.cat]?.sp||0),0);
    const allO=groups.reduce((s,g)=>s+(totalsByGroup[g.cat]?.so||0),0);
    const allA=groups.reduce((s,g)=>s+(totalsByGroup[g.cat]?.sa||0),0);
    const sumRow=aoa.length;
    aoa.push(['SUMÁRIO']);
    aoa.push(['Garantido total','R$ '+brl(allG)]);
    aoa.push(['Premiação total','R$ '+brl(allP)]);
    aoa.push(['Ações totais',brl(allA,0)]);
    aoa.push(['Overlay total',allO<0?'R$ '+brl(allO)+' (déficit)':'Sem overlay']);
    aoa.push(['Performance geral',allG>0?((allP-allG)/allG*100).toFixed(1)+'%':'—']);
    styleMap[XLSX.utils.encode_cell({r:sumRow,c:0})]={font:{bold:true,color:{rgb:'FFFFFF'},sz:12},fill:{fgColor:{rgb:'1A472A'}}};
    if(aoa[0])styleMap['A1']={font:{bold:true,color:{rgb:'FFFFFF'},sz:14},fill:{fgColor:{rgb:'0A3D27'}},alignment:{horizontal:'center'}};

    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=COL_WIDTHS.map(w=>({wch:w}));
    ws['!merges']=ws['!merges']||[];
    ws['!merges'].push({s:{r:0,c:0},e:{r:0,c:COL_HEADERS.length-1}});
    Object.entries(styleMap).forEach(([addr,style])=>{if(!ws[addr])ws[addr]={t:'s',v:''};ws[addr].s=style;});
    XLSX.utils.book_append_sheet(wb,ws,`${dateLabel.replace(/\//g,'-')}`.slice(0,31));
  });

  const from=document.getElementById('auFrom')?.value||'';
  const to=document.getElementById('auTo')?.value||'';
  XLSX.writeFile(wb,`Acompanhamento_${from}_${to}.xlsx`);
  toast(`✓ ${Object.keys(byDate).length} dia(s) exportado(s)`,'ok');

  // Backup permanente do fechamento: grava os mesmos dados (já com correções da auditoria
  // aplicadas) em relatorios/<de>_<até> — nó que a limpeza automática NUNCA remove. Assim o
  // relatório da diretoria não depende dos nós ao vivo (painel/<data>) nem do arquivo baixado.
  if(fbOk && from && to){
    const backupRows = _auditRows.map(r => ({
      date: r.date, nome: r.nome ?? null, hora: r.hora ?? null, cat: r.cat ?? null,
      garantido: r.garantido ?? null, buyin: r.buyin ?? null, premiacao: r.premiacao ?? null,
      field: r.field ?? null, overlay: r.overlay ?? null, perf: r.perf ?? null,
      id: r.id ?? null, status: r.status ?? null, auditado: r._audited ? true : null,
    }));
    db.ref(`relatorios/${from}_${to}`).set({
      savedAt: Date.now(),
      savedBy: _email || 'admin',
      periodo: {from, to},
      totalLinhas: backupRows.length,
      rows: backupRows,
    }).then(() => toast('✓ Backup permanente do período salvo no Firebase (relatorios/)','ok'))
      .catch(e => toast('Exportado, mas o backup permanente falhou: '+e.message,'err'));
  }
}

async function exportGradeXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  if(!_gradeRows.length){toast('Carregue os dados','err');return;}
  const aoa=[['Torneio','Categoria','Rodadas','GTD Médio','Pool Médio','Perf%','Overlay Total']];
  _gradeRows.forEach(r=>aoa.push([r.nome,catLabel(r.cat),
    r.runs,r.avgGar,r.avgPrem,r.avgPerf!=null?r.avgPerf/100:'',r.ov||'']));
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[36,14,8,12,12,8,12].map(w=>({wch:w}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Grade');
  XLSX.writeFile(wb,'Grade.xlsx');
  toast('✓ Exportado','ok');
}

/* ── UTILS ───────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════
   BACKUP & ARQUIVO
══════════════════════════════════════════════════════════════ */

// ── Inicializar página de backup ──
async function initBackup(){
  // Restaurar URL/segredo salvos localmente (nunca hardcoded no código-fonte)
  const urlField = document.getElementById('sheetsUrl');
  if(urlField && !urlField.value) urlField.value = localStorage.getItem('suprema_sheets_url') || '';
  const secretField = document.getElementById('sheetsSecret');
  if(secretField && !secretField.value) secretField.value = localStorage.getItem('suprema_sheets_secret') || '';
  // Re-arma o backup diário automático: se já há URL salva localmente, re-sincroniza
  // config/sheetsBackup no RTDB ao abrir. Cobre o caso de a URL ter sido configurada
  // ANTES das regras do nó `config` serem publicadas (a 1ª escrita falhava em silêncio).
  const _savedSheetsUrl = (localStorage.getItem('suprema_sheets_url')||'').trim();
  if(_savedSheetsUrl) syncSheetsCfgToRTDB(_savedSheetsUrl, (localStorage.getItem('suprema_sheets_secret')||'').trim());
  renderAutoBackupStatus();   // status do backup diário automático (Cloud Function)
  await loadAll(true);   // backup exporta o histórico COMPLETO, não a janela de 60 dias
  const dates = Object.keys(_allData).sort();
  if(!dates.length){ document.getElementById('backupKpi').innerHTML='<div style="color:var(--ink3);font-size:12px">Nenhum dado encontrado.</div>'; return; }

  // KPIs do banco
  const totalDays  = dates.length;
  const oldDays    = dates.filter(d => d < dago(90)).length;
  const months     = [...new Set(dates.map(d=>d.slice(0,7)))];
  const totalRows  = Object.values(_allData).reduce((s,d)=>s+Object.keys(d.rows||{}).length,0);

  document.getElementById('backupKpi').innerHTML = `
    <div class="kpi"><div class="kpi-label">Dias no banco</div><div class="kpi-val">${totalDays}</div><div class="kpi-sub">${months.length} meses</div></div>
    <div class="kpi r"><div class="kpi-label">Dias antigos (>90d)</div><div class="kpi-val">${oldDays}</div><div class="kpi-sub">candidatos à limpeza</div></div>
    <div class="kpi g"><div class="kpi-label">Total de torneios</div><div class="kpi-val">${totalRows.toLocaleString('pt-BR')}</div><div class="kpi-sub">registros históricos</div></div>
    <div class="kpi b"><div class="kpi-label">Período</div><div class="kpi-val" style="font-size:13px">${fmtDate(dates[0])}</div><div class="kpi-sub">até ${fmtDate(dates[dates.length-1])}</div></div>
  `;

  // Popular select de meses
  const sel = document.getElementById('bkMonth');
  sel.innerHTML = '<option value="">Selecione o mês...</option>';
  months.sort().reverse().forEach(m => {
    const [y,mo] = m.split('-');
    const label = new Date(y, mo-1, 1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    sel.innerHTML += `<option value="${m}">${label.charAt(0).toUpperCase()+label.slice(1)}</option>`;
  });
}

// ── Helper: adicionar aba com nome sempre válido ──
// Excel proíbe : \ / ? * [ ] e nomes >31 chars ou duplicados. Isso normaliza tudo.
function appendSheetSafe(wb, ws, name){
  let base = String(name).replace(/[:\\/?*\[\]]/g,'-').trim().slice(0,31) || 'Aba';
  let final = base, i = 2;
  const used = (wb.SheetNames||[]).map(n=>n.toLowerCase());
  while(used.includes(final.toLowerCase())){
    const suf = ' ('+i+')';
    final = base.slice(0,31-suf.length)+suf;
    i++;
  }
  XLSX.utils.book_append_sheet(wb, ws, final);
}

// ── 1. EXPORT MENSAL ──
async function exportMonthXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  const month = document.getElementById('bkMonth').value;
  if(!month){ toast('Selecione um mês','err'); return; }
  const status = document.getElementById('bkMonthStatus');
  status.textContent = 'Gerando XLSX...';

  const dates = Object.keys(_allData).filter(d=>d.startsWith(month)).sort();
  if(!dates.length){ toast('Sem dados neste mês','err'); status.textContent=''; return; }

  const wb = XLSX.utils.book_new();
  dates.forEach(date => {
    const ws = buildDaySheet(date);
    if(ws) appendSheetSafe(wb, ws, date.slice(5));
  });

  // Aba de resumo do mês
  const sumWs = buildMonthSummary(dates, month);
  appendSheetSafe(wb, sumWs, 'Resumo');

  const [y,m] = month.split('-');
  const label = new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  XLSX.writeFile(wb, `Suprema_${month}.xlsx`);
  toast(`✓ ${dates.length} dias exportados`,'ok');
  status.textContent = `✓ ${dates.length} dias exportados (${label})`;
}

// ── EXPORT TUDO ──
async function exportAllTimeXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  const dates = Object.keys(_allData).sort();
  const BIG_EXPORT_THRESHOLD = 90; // ~3 meses — acima disso o XLSX fica pesado pro navegador gerar
  const big = dates.length > BIG_EXPORT_THRESHOLD;
  const msg = big
    ? `Isso vai exportar <b>${dates.length} dias</b> (${Object.keys(dates.reduce((s,d)=>{s[d.slice(0,7)]=1;return s;},{})).length} meses) num único XLSX. Com esse volume o navegador pode travar por um tempo — considere exportar por mês (acima) em vez de tudo de uma vez. Continuar mesmo assim?`
    : `Isso vai exportar <b>TODOS</b> os dados históricos (${dates.length} dias) em um XLSX. Pode demorar alguns segundos. Continuar?`;
  if(!await confirmModal({title:'Exportar tudo',message:msg,confirmLabel:'Exportar'})) return;
  const status = document.getElementById('bkMonthStatus');
  status.textContent = 'Gerando arquivo completo...';

  const wb = XLSX.utils.book_new();

  // Agrupar por mês
  const byMonth = {};
  dates.forEach(d => {
    const m = d.slice(0,7);
    if(!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(d);
  });

  Object.entries(byMonth).sort().forEach(([month, mDates]) => {
    mDates.forEach(date => {
      const ws = buildDaySheet(date);
      if(ws) appendSheetSafe(wb, ws, date.slice(2));
    });
    const sumWs = buildMonthSummary(mDates, month);
    const [y,m] = month.split('-');
    appendSheetSafe(wb, sumWs, `Resumo ${m}-${y.slice(2)}`);
  });

  XLSX.writeFile(wb, `Suprema_HistoricoCompleto_${nowSP()}.xlsx`);
  toast(`✓ ${dates.length} dias exportados`,'ok');
  status.textContent = `✓ Histórico completo exportado (${dates.length} dias)`;
}

// ── Construir aba de um dia ──
function buildDaySheet(date){
  const day = _allData[date];
  if(!day) return null;
  const rows = Object.values(day.rows||{}).filter(r=>r&&r.nome);
  if(!rows.length) return null;

  const dateLabel = fmtDate(date);
  const aoa = [[`ACOMPANHAMENTO — ${dateLabel}`],[]];
  const groups = [
    {cat:'main', rows:sortByTime(rows.filter(r=>classify(r)==='main'))},
    {cat:'side', rows:sortByClock(rows.filter(r=>classify(r)==='side'))},
    {cat:'sat',  rows:sortByTime(rows.filter(r=>classify(r)==='sat'))},
  ].filter(g=>g.rows.length);

  groups.forEach(g=>{
    const cc = CAT_COLORS[g.cat];
    aoa.push([cc.label]);
    aoa.push(['Torneio','Hora','Late Reg.','Garantido','Buy-in','Premiação','Overlay','Field','Perf%','ID','Status']);
    let sG=0,sP=0,sO=0;
    g.rows.forEach(r=>{
      const key  = Object.keys(day.rows).find(k=>day.rows[k]===r)||'';
      // mesmo fallback de alias do flatRows: dados do card podem estar sob a chave ao vivo
      const pick = map => pickByKey(map, key, r);
      // MESMO gate do flatRows: premiação só conta com prova de coleta (premBy ao vivo ou
      // premPor no snapshot). Sem isso, o export de histórico ressuscitava a premiação-fantasma
      // da coluna "Premiação" da planilha nos snapshots antigos (inflava o Arrecadado ~5×).
      const _pbGate = pick(day.premBy);
      const _hasPremBy = _pbGate!=null && _pbGate!==false && _pbGate!=='';
      const _snapHasPremPor = r.premPor!=null && r.premPor!==false && r.premPor!=='';
      const prem = _hasPremBy ? (pick(day.prem) ?? null)
                 : (r._snap && _snapHasPremPor) ? (r._snapPrem ?? null)
                 : null;
      const gar  = pick(day.guar)??r.garantido??null;
      const field= pick(day.field)??r.field??null;
      const idRaw= pick(day.ids);
      const id   = typeof idRaw==='object'&&idRaw?idRaw.val||'':idRaw||'';
      const ov   = prem!=null&&gar!=null?prem-gar:null;
      const perf = ov!=null&&gar>0?((prem-gar)/gar*100):null;
      const status = id.toUpperCase()==='NF'?'Não formou':prem!=null?'Fechado':'Aberto';
      if(gar)sG+=gar; if(prem)sP+=prem; if(ov)sO+=ov;
      aoa.push([r.nome,r.hora,r.late||'',gar??'',r.buyin??'',prem??'',ov??'',field??'',
        perf!=null?perf/100:'',id,status]);
    });
    aoa.push([`Total`,'','',sG||'','',sP||'',sO||'','','','','']);
    aoa.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [32,7,10,13,10,13,12,8,8,12,10].map(w=>({wch:w}));
  return ws;
}

// ── Construir aba de resumo mensal ──
function buildMonthSummary(dates, month){
  const aoa = [['Data','Torneios','Fechados','GTD Total','Premiação','Overlay','Perf%']];
  let totT=0,totF=0,totG=0,totP=0,totO=0;
  dates.forEach(date=>{
    const day = _allData[date];
    if(!day) return;
    const rows = Object.values(day.rows||{}).filter(r=>r&&r.nome);
    const prems = Object.keys(day.rows||{}).map(k=>day.prem?.[k]??null).filter(v=>v!=null);
    const gars  = Object.keys(day.rows||{}).map(k=>day.guar?.[k]??day.rows[k]?.garantido??0);
    const sumG  = gars.reduce((s,v)=>s+v,0);
    const sumP  = prems.reduce((s,v)=>s+v,0);
    const sumO  = prems.length?prems.reduce((s,v,i)=>s+(v-(gars[i]||0)),0):0;
    const perf  = sumG>0?(sumP-sumG)/sumG*100:null;
    totT+=rows.length; totF+=prems.length; totG+=sumG; totP+=sumP; totO+=sumO;
    aoa.push([fmtDate(date),rows.length,prems.length,sumG||'',sumP||'',sumO||'',
      perf!=null?perf/100:'']);
  });
  aoa.push(['TOTAL',totT,totF,totG,totP,totO,totG>0?(totP-totG)/totG/100:'']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [12,10,10,14,14,12,8].map(w=>({wch:w}));
  return ws;
}

// ── 2. LIMPEZA AUTOMÁTICA (>90 dias) ──
async function previewCleanup(){
  const cutoff = dago(90);
  const old = Object.keys(_allData).filter(d=>d<cutoff).sort();
  const el  = document.getElementById('cleanupPreview');

  if(!old.length){
    el.innerHTML = '<span style="color:var(--green)">✅ Nenhum dado com mais de 90 dias. Banco limpo.</span>';
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:10px;color:var(--amber)">
      ⚠ <b>${old.length} dia(s)</b> com mais de 90 dias serão removidos do Firebase:
    </div>
    <div style="font-family:var(--mono);font-size:11px;color:var(--ink3);line-height:1.8">
      ${old.map(d=>`<span style="margin-right:12px">${fmtDate(d)}</span>`).join('')}
    </div>
    <div style="margin-top:10px;font-size:11.5px;color:var(--ink3)">
      ℹ️ Os snapshots e relatórios XLSX desses dias <b>não serão removidos</b> — apenas os dados ao vivo do painel.
    </div>`;
}

function runCleanup(){
  const cutoff = dago(90);
  const old    = Object.keys(_allData).filter(d=>d<cutoff).sort();
  if(!old.length){ toast('Nada para limpar','ok'); return; }

  document.getElementById('dcCount').textContent = old.length;
  document.getElementById('dcCutoff').textContent = fmtDate(cutoff);
  document.getElementById('dcInput').value = '';
  document.getElementById('dcBtn').disabled = true;
  document.getElementById('dcInput').oninput = e =>{
    document.getElementById('dcBtn').disabled = e.target.value.trim().toUpperCase()!=='REMOVER';
  };
  document.getElementById('dcBtn').onclick = ()=>executeCleanup(old);
  document.getElementById('moDestructiveConfirm').classList.add('open');
  setTimeout(()=>document.getElementById('dcInput')?.focus(),80);
}

async function executeCleanup(old){
  closeMo('moDestructiveConfirm');
  const el = document.getElementById('cleanupPreview');
  el.innerHTML = '<span style="color:var(--ink3)">Limpando...</span>';

  let removed = 0;
  for(const date of old){
    try{
      // A criação noturna mora DENTRO de painel/{dia} — arquivar em snapshots/
      // antes de apagar, senão os KPIs de período longo (criados, tempos, erros)
      // somem junto com a limpeza. Guarda só o essencial (sem a sheet pesada).
      try{
        const cn = (await db.ref(`painel/${date}/criacaoNoturna`).once('value')).val();
        if(cn && (cn.done || cn.audit)){
          await db.ref(`snapshots/${date}/criacaoNoturna`).set({
            done: cn.done||null, ids: cn.ids||null, audit: cn.audit||null, log: cn.log||null
          });
        }
      }catch(e){ console.error('Erro ao arquivar criação de', date, e); }
      // Remover só o nó painel/ — manter snapshots/ e relatorios/
      await db.ref(`painel/${date}`).remove();
      delete _allData[date];
      removed++;
    }catch(e){ console.error('Erro ao remover', date, e); }
  }

  // Podar notificações antigas já resolvidas/justificadas — evita que userNotifs
  // cresça sem limite, já que é lido por inteiro em vários pontos do admin.
  let notifsRemoved = 0;
  try{
    const cutoffMs = Date.now() - 90*24*60*60*1000;
    const all = await getAllNotifsCached(true);
    for(const [opKey,notifs] of Object.entries(all)){
      if(!notifs||typeof notifs!=='object')continue;
      for(const [nid,n] of Object.entries(notifs)){
        if(n && n.resolved && (n.sentAt||0) < cutoffMs){
          await db.ref(`userNotifs/${opKey}/${nid}`).remove();
          notifsRemoved++;
        }
      }
    }
    invalidateNotifsCache();
  }catch(e){ console.error('Erro ao podar notificações', e); }

  el.innerHTML = `<span style="color:var(--green)">✅ ${removed} dia(s) removidos do Firebase${notifsRemoved?` · ${notifsRemoved} notificação(ões) antiga(s) resolvida(s) podada(s)`:''}.</span>`;
  toast(`✓ ${removed} dias removidos`,'ok');
  writeAdminLog('cleanup', {removed, notifsRemoved});
  initBackup(); // atualizar KPIs
}

// ── 3. GOOGLE SHEETS ──
const APPS_SCRIPT = `// Cole este script no Apps Script da sua planilha Google
// Extensões → Apps Script → cole → Implantar → App da Web (Qualquer pessoa)

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    // Segredo compartilhado: Extensões → Apps Script → Configurações do projeto →
    // Propriedades do script → adicione SHARED_SECRET com o mesmo valor colado no admin.
    const expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (expected && data.secret !== expected) {
      return ContentService.createTextOutput(JSON.stringify({error:'unauthorized'})).setMimeType(ContentService.MimeType.JSON);
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = data.date || new Date().toLocaleDateString('pt-BR');
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.clearContents();

    // Cabeçalho
    sheet.getRange(1, 1, 1, 9).setValues([['Torneio','Hora','Categoria','Garantido','Buy-in','Premiação','Overlay','Field','Status']]);

    // Dados
    if (data.rows && data.rows.length) {
      const values = data.rows.map(r => [
        r.nome||'', r.hora||'', r.cat||'',
        r.garantido||'', r.buyin||'', r.premiacao||'',
        r.overlay||'', r.field||'', r.status||''
      ]);
      sheet.getRange(2, 1, values.length, 9).setValues(values);
    }

    // Formatar
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#1a472a').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, 9);

    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

function copyAppsScript(){
  navigator.clipboard.writeText(APPS_SCRIPT)
    .then(()=>toast('✓ Script copiado — cole no Apps Script','ok'))
    .catch(()=>{ prompt('Copie o script abaixo:', APPS_SCRIPT); });
}

// Config do Sheets salva localmente (URL do Apps Script + segredo). null se não há URL.
function _sheetsCfg(){
  const url = (localStorage.getItem('suprema_sheets_url')||'').trim();
  if(!url) return null;
  return { url, secret:(localStorage.getItem('suprema_sheets_secret')||'').trim() };
}

/* Status do BACKUP DIÁRIO AUTOMÁTICO (Cloud Function supremaBackupSheets).
   Lê config/sheetsBackup/lastRun — carimbo que a função grava a cada execução —
   e mostra se rodou, quando e se deu certo. Fecha o ciclo do "está funcionando?". */
async function renderAutoBackupStatus(){
  const el = document.getElementById('autoBackupStatus');
  if(!el || !fbOk) return;
  try{
    const lr = (await db.ref('config/sheetsBackup/lastRun').once('value')).val();
    if(!lr || !lr.at){
      el.innerHTML = `<div style="font-size:11.5px;color:var(--ink3);display:flex;gap:6px;align-items:center">⏱ <span>Backup automático diário: <b>sem execução registrada ainda</b> — arme a URL abaixo e faça o deploy da Cloud Function <code>supremaBackupSheets</code>.</span></div>`;
      return;
    }
    const when = new Date(lr.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const okCol = lr.ok ? 'var(--green)' : 'var(--red)';
    const icon  = lr.ok ? '✓' : '⚠';
    const msg   = lr.ok ? `enviou ${lr.rows||0} torneios do dia ${lr.date? lr.date.slice(8,10)+'/'+lr.date.slice(5,7):'—'}`
                        : `falhou (${esc(lr.error||'sem detalhe')})`;
    el.innerHTML = `<div style="font-size:11.5px;display:flex;gap:6px;align-items:center;color:var(--ink2)">
      <span style="color:${okCol};font-weight:800">${icon}</span>
      <span>Backup automático diário — último run <b>${when}</b>: ${msg}</span></div>`;
  }catch(e){ /* sem permissão/config → silencioso */ }
}

// Grava a config do backup no RTDB (config/sheetsBackup) — é isso que ARMA o
// backup diário AUTOMÁTICO: o painel lê esse nó (leitura p/ qualquer auth, escrita
// só admin) e, quando o último resultado do dia é preenchido, envia sozinho pro
// Sheets. Sem esta escrita, o auto-backup fica dormente por mais que a URL esteja
// salva no navegador do admin. Silencioso/best-effort (não trava a UI).
async function syncSheetsCfgToRTDB(url, secret){
  if(!fbOk || !url) return false;
  try{
    await db.ref('config/sheetsBackup').set({
      url, secret: secret||'', updatedBy: _email||'admin', updatedAt: Date.now(),
    });
    return true;
  }catch(e){ console.warn('syncSheetsCfgToRTDB:', e.message); return false; }
}

async function exportToSheets(){
  const url = document.getElementById('sheetsUrl').value.trim();
  if(!url){ toast('Cole a URL do Apps Script primeiro','err'); return; }
  const secret = document.getElementById('sheetsSecret').value.trim();
  localStorage.setItem('suprema_sheets_url', url);
  localStorage.setItem('suprema_sheets_secret', secret);   // grava sempre (inclusive vazio) pra permitir limpar

  const status = document.getElementById('sheetsStatus');
  const today  = nowSP();

  // ARMA o backup diário automático: grava a config compartilhada no RTDB pra o
  // PAINEL ler e enviar sozinho quando o dia fecha. É o passo que faltava.
  const armed = await syncSheetsCfgToRTDB(url, secret);
  const armMsg = armed ? ' · ⏱ backup diário automático armado'
    : (fbOk ? ' · ⚠ não consegui armar o automático (confira: você é admin e as regras do RTDB foram publicadas?)'
            : ' · (automático offline — Firebase não conectado)');

  // a página de Backup roda loadAll(true) ao abrir, mas seja robusto se chamada antes
  if(!Object.keys(_allData).length){ status.textContent='Carregando dados…'; await loadAll(true); }
  const rows = flatRows(today, today).filter(r=>r&&r.nome);
  if(!rows.length){
    toast(armed?'✓ Backup automático armado':'Config salva','ok');
    status.textContent = (armed?'✓ Configuração salva.':'Configuração salva localmente.') + armMsg + ' Ainda não há torneios hoje para enviar agora.';
    return;
  }

  status.textContent = 'Enviando…';
  // SupremaSheets.send é resiliente a CORS: o Apps Script responde via redirect pro
  // googleusercontent SEM header CORS, então res.json() estoura mesmo com o POST entregue.
  // send() distingue "confirmado" (leu o ok) de "enviado" (entregou mas não deu pra ler).
  const built = SupremaSheets.buildGrid(rows);
  const res = await SupremaSheets.send(_sheetsCfg()||{url,secret}, today, built);
  const aba = SupremaSheets.sheetLabel(today);
  if(res.confirmed){
    toast('✓ Dados enviados para Google Sheets','ok');
    status.textContent = `✓ ${res.rows} torneios enviados em ${new Date().toLocaleTimeString('pt-BR')}`+armMsg;
    localStorage.setItem('suprema_last_sheets', String(Date.now()));
  } else if(res.sent){
    toast('✓ Enviado — confira a planilha','ok');
    status.textContent = `✓ ${res.rows} torneios enviados (resposta bloqueada por CORS — confira a aba ${aba}). Se não aparecer, reimplante o Apps Script como App da Web para "Qualquer pessoa".`+armMsg;
    localStorage.setItem('suprema_last_sheets', String(Date.now()));
  } else {
    toast('Erro ao enviar'+(res.error?': '+res.error:''),'err');
    status.textContent = '❌ Não foi possível enviar. Verifique a URL e reimplante o Apps Script como App da Web para "Qualquer pessoa".'+armMsg;
  }
}

// Re-envia a aba do dia ao Sheets quando a auditoria CORRIGE um valor — assim a
// planilha reflete o Arrecadado auditado sem envio manual. Silencioso se o Sheets
// não estiver configurado (a auditoria não depende disso). Usa as linhas JÁ
// corrigidas: o saveAudit patcha _auditRows antes de chamar aqui.
async function autoResendSheets(date){
  const cfg = _sheetsCfg();
  if(!cfg) return;
  const src = (typeof _auditRows!=='undefined' && _auditRows.length)
    ? _auditRows.filter(r=>r.date===date)
    : flatRows(date, date);
  const rows = src.filter(r=>r&&r.nome);
  if(!rows.length) return;
  try{
    const res = await SupremaSheets.send(cfg, date, SupremaSheets.buildGrid(rows));
    if(res.confirmed || res.sent){
      localStorage.setItem('suprema_last_sheets', String(Date.now()));
      toast('↻ Aba '+SupremaSheets.sheetLabel(date)+' atualizada no Sheets','ok');
    }
  }catch(e){ console.warn('autoResendSheets:', e.message); }
}

// ── BACKUP SQLITE (sql.js sob demanda, mesmo padrão do ensureXLSX) ──
// Carrega o motor sql.js 1.10.3 do cdnjs na 1ª vez. Sem CSP no admin.html e o SW
// faz network-first em cross-origin (deixa o CDN passar), então funciona online.
let _sqlJsP = null;
function ensureSqlJs(){
  if(window.SQL) return Promise.resolve(window.SQL);
  if(_sqlJsP) return _sqlJsP;
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
  _sqlJsP = new Promise((resolve,reject)=>{
    if(window.initSqlJs) return resolve();
    const s = document.createElement('script');
    s.src = CDN+'sql-wasm.js'; s.async = true;
    s.onload = ()=> window.initSqlJs ? resolve() : (_sqlJsP=null, reject(new Error('sql.js carregou mas initSqlJs não inicializou')));
    s.onerror = ()=>{ _sqlJsP=null; reject(new Error('falha ao carregar sql.js do CDN')); };
    document.head.appendChild(s);
  }).then(()=> window.initSqlJs({ locateFile: f => CDN+f }))
    .then(SQL=>{ window.SQL = SQL; return SQL; });
  return _sqlJsP;
}

// Exporta TODO o histórico num arquivo .sqlite (tabelas torneios + auditoria + meta).
async function exportSqlite(){
  const status = document.getElementById('bkSqliteStatus');
  try{
    status.textContent = 'Carregando motor SQLite (sql.js)…';
    const SQL = await ensureSqlJs();
    status.textContent = 'Lendo histórico completo…';
    await loadAll(true);                 // banco inteiro, não a janela de 60 dias
    const rows = flatRows();             // sem datas = tudo
    const sdb = new SQL.Database();

    sdb.run(`CREATE TABLE torneios(
      data TEXT, chave TEXT, nome TEXT, hora TEXT, late TEXT, tipo TEXT, categoria TEXT,
      garantido REAL, buyin REAL, premiacao REAL, overlay REAL, perf REAL, field INTEGER,
      acoes INTEGER, id TEXT, fixado_por TEXT, fixado_em TEXT, prem_por TEXT, status TEXT);`);
    const insT = sdb.prepare(`INSERT INTO torneios VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    rows.forEach(r=>insT.run([r.date, r.key, r.nome, r.hora, r.late, r.tipo, r.cat,
      r.garantido, r.buyin, r.premiacao, r.overlay, r.perf, r.field, r.acoes,
      r.id, r.fixBy, r.fixAt, r.premBy, r.status]));
    insT.free();

    sdb.run(`CREATE TABLE auditoria(
      data TEXT, chave TEXT, nome TEXT, hora TEXT,
      premiacao_original REAL, premiacao_auditada REAL,
      field_original INTEGER, field_auditado INTEGER,
      garantido_original REAL, garantido_auditado REAL,
      status TEXT, obs TEXT, auditado_por TEXT, auditado_em INTEGER);`);
    const insA = sdb.prepare(`INSERT INTO auditoria VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let nAudit = 0;
    Object.entries(_auditData).forEach(([date,keys])=> Object.entries(keys||{}).forEach(([key,e])=>{
      if(!e || typeof e!=='object') return;
      insA.run([date, key, e.nome||'', e.hora||'',
        e.premiacaoOriginal ?? null, e.premiacaoAuditada ?? null,
        e.fieldOriginal ?? null, e.fieldAuditado ?? null,
        e.garantidoOriginal ?? null, e.garantidoAuditado ?? null,
        e.status||'', e.obs||'', e.auditadoPor||'', e.auditadoEm ?? null]);
      nAudit++;
    }));
    insA.free();

    const dts = rows.map(r=>r.date).sort();
    sdb.run(`CREATE TABLE meta(chave TEXT, valor TEXT);`);
    sdb.run(`INSERT INTO meta VALUES ('gerado_em',?),('torneios',?),('auditorias',?),('periodo_ini',?),('periodo_fim',?),('gerado_por',?)`,
      [new Date().toISOString(), String(rows.length), String(nAudit), dts[0]||'', dts[dts.length-1]||'', _email||'admin']);

    const bytes = sdb.export();
    sdb.close();
    const blob = new Blob([bytes], {type:'application/x-sqlite3'});
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = `suprema_${nowSP()}.sqlite`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(href), 4000);

    status.textContent = `✓ ${rows.length} torneios · ${nAudit} auditorias exportados (.sqlite)`;
    toast('✓ SQLite gerado','ok');
    localStorage.setItem('suprema_last_sqlite', String(Date.now()));
  }catch(e){
    status.textContent = '❌ '+e.message;
    toast('Erro no SQLite: '+e.message,'err');
  }
}

function timeMin(h){
  if(!h)return null;
  const m=h.match(/(\d{1,2}):(\d{2})/);
  return m?parseInt(m[1])*60+parseInt(m[2]):null;
}


function closeMo(id){document.getElementById(id).classList.remove('open');}

/* Confirmação com a UI do painel (substitui confirm() nativo). Retorna Promise<boolean>. */
function confirmModal({title='Confirmar', message='', confirmLabel='Confirmar', danger=false}={}){
  return new Promise(resolve=>{
    const mo=document.getElementById('moConfirm');
    document.getElementById('cfTitle').textContent=title;
    document.getElementById('cfMsg').innerHTML=message;
    const ok=document.getElementById('cfOk');
    const cancel=document.getElementById('cfCancel');
    ok.textContent=confirmLabel;
    ok.className='btn '+(danger?'btn-red':'btn-gold');
    ok.style.cssText='flex:1;justify-content:center';
    const done=val=>{ mo.classList.remove('open'); ok.onclick=null; cancel.onclick=null; resolve(val); };
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
    mo.classList.add('open');
  });
}

/* ── 10. Filtro só anomalias ── */
let _soAnomalia = false;
function toggleSoAnomalia(){
  _soAnomalia = !_soAnomalia;
  const btn = document.getElementById('btnSoAnomalia');
  if(btn){
    btn.style.background = _soAnomalia ? 'rgba(239,68,68,.1)' : '';
    btn.style.color = _soAnomalia ? 'var(--red)' : '';
    btn.style.borderColor = _soAnomalia ? 'rgba(239,68,68,.3)' : '';
    btn.textContent = _soAnomalia ? '✕ Todas as linhas' : '⚠ Só anomalias';
  }
  // Esconder/mostrar linhas
  document.querySelectorAll('#auditResult tr[data-key]').forEach(tr=>{
    if(_soAnomalia){
      tr.style.display = tr.classList.contains('anomalia') ? '' : 'none';
    } else {
      tr.style.display = '';
    }
  });
}

/* ── 11. Notificar anomalias em lote ── */
async function batchNotifyAnomalias(){
  const anomalas = [...document.querySelectorAll('#auditResult tr.anomalia')];
  if(!anomalas.length){ toast('Nenhuma anomalia detectada no período.','err'); return; }
  if(!await confirmModal({title:'Notificar anomalias',message:`Notificar os operadores responsáveis por <b>${anomalas.length}</b> anomalia(s)? Isso enviará uma notificação individual para cada um.`,confirmLabel:'Notificar'})) return;

  let sent = 0;
  for(const tr of anomalas){
    const key  = tr.dataset.key;
    const date = tr.dataset.date;
    const r    = _auditRows.find(r=>r.key===key&&r.date===date);
    // alvo = quem preencheu o Arrecadado/Field (premBy); as anomalias são de premiação/overlay,
    // responsabilidade de quem arrecadou. Cai pra fixBy só se ninguém arrecadou ainda.
    const alvo = r && (r.premBy || r.fixBy);
    if(!r||!alvo) continue;
    // Identificar a anomalia
    const anomalias = [];
    if(r.premiacao===0) anomalias.push('Premiação R$0');
    if(r.premiacao!=null&&r.garantido&&r.premiacao>r.garantido*3) anomalias.push('Premiação muito alta');
    if(r.overlay!=null&&r.garantido&&Math.abs(r.overlay)>r.garantido*0.5) anomalias.push('Overlay >50% GTD');
    if(!anomalias.length) anomalias.push('Anomalia detectada');

    try{
      const emailKey = alvo.replace(/[.#$\[\]]/g,'_').toLowerCase();
      const notifId = 'notif_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
      await db.ref(`userNotifs/${emailKey}/${notifId}`).set({
        type:'anomalia', typeLabel:'Anomalia automática',
        torneio: r.nome, date: r.date,
        desc: anomalias.join('; '),
        sentBy: _email, sentAt: Date.now(),
        resolved: false,
      });
      sent++;
    }catch(e){ console.error('batchNotify error:', e); }
  }
  invalidateNotifsCache();
  toast(`✓ ${sent} notificação(ões) enviada(s)`,'ok');
  await writeAdminLog('batchNotifyAnomalias', {count:sent, date:nowSP()});
}

/* ── 12. Log de auditoria permanente ── */
async function writeAdminLog(action, meta={}){
  if(!fbOk) return;
  try{
    const logId = Date.now()+'_'+Math.random().toString(36).slice(2,6);
    await db.ref('adminLog/'+logId).set({
      action, ...meta,
      admin: _email,
      at: Date.now(),
      atStr: new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
    });
  }catch(e){ console.warn('adminLog error:', e); }
}

/* ══ AVISOS DO HUB ═══════════════════════════════════════════════
   CRUD dos avisos que aparecem no topo do hub (hub/avisos). Erros de
   atualização e informativos. Escrita restrita a admin pelas regras. */
let _avisos = {}, _avEditId = null, _avAttached = false;
/* tipos de aviso — fonte única (o hub.js espelha as MESMAS chaves em AV_ICONS e
   nas cores do hub.css). Ordem = da mais neutra à mais crítica. */
const AV_TIPO_LABEL = { info:'Informativo', novidade:'Novidade', sucesso:'Sucesso', aviso:'Aviso', manutencao:'Manutenção', erro:'Erro' };
const avTipoOk = t => Object.prototype.hasOwnProperty.call(AV_TIPO_LABEL, t) ? t : 'info';
let _hubEvents = {}, _hubLinks = {}, _hubPatch = null, _hubLinksHidden = {};
/* MESMOS seeds embutidos no hub.js (DEFAULT_LINKS) — precisam bater id a id.
   O hub mostra cada seed a menos que exista tombstone em hub/linksHidden/<id>.
   O admin não listava os seeds, então não dava pra remover o "All-in"/"Tour"
   padrão. Aqui a lista do admin passa a incluí-los, com Remover (grava tombstone)
   e Restaurar (apaga o tombstone). */
const HUB_DEFAULT_LINKS = [
  { id:'seed-allin', url:'https://allin.supremapoker.com.br/', title:'All-in Suprema',     tag:'Campanha ativa' },
  { id:'seed-tour',  url:'https://supremapokertour.com/',      title:'Suprema Poker Tour', tag:'Evento Live' },
];
/* patch notes default — igual ao do hub, pra o editor começar do conteúdo real
   quando ainda não há nada salvo no Firebase */
const HUB_DEFAULT_PATCH =
`## v1.0 · 08/07/2026
- Login e criação de conta agora acontecem só aqui no hub. Os produtos exigem sessão.
- Nova Agenda da casa: o calendário de eventos importantes (admin adiciona, todo mundo vê).
- Mesas abertas: os links das campanhas e eventos live da Suprema.
- Nova área de Patch notes.`;
function initAvisos(){
  if(!fbOk){ document.getElementById('avList').innerHTML = '<p style="color:var(--ink3);font-size:13px;padding:10px 0">Firebase não conectado.</p>'; return; }
  // sub-navegação entre as seções do centro de edição
  const nav = document.getElementById('hubEditNav');
  if(nav && !nav.__wired){
    nav.__wired = true;
    nav.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      nav.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.hub-edit-sec').forEach(s => s.hidden = (s.id !== b.dataset.sec));
    }));
  }
  if(_avAttached) return;
  _avAttached = true;
  db.ref('hub/avisos').on('value', s => { _avisos = s.val() || {}; renderAvisosAdmin(); });
  db.ref('hub/calendar').on('value', s => { _hubEvents = s.val() || {}; renderHubEvents(); });
  db.ref('hub/links').on('value', s => { _hubLinks = s.val() || {}; renderHubLinks(); });
  db.ref('hub/linksHidden').on('value', s => { _hubLinksHidden = s.val() || {}; renderHubLinks(); });
  db.ref('hub/patchNotes').on('value', s => {
    _hubPatch = s.val();
    const ta = document.getElementById('pnTextA');
    // só sobrescreve o textarea se o admin não estiver editando (sem foco)
    if(ta && document.activeElement !== ta) ta.value = (_hubPatch && _hubPatch.text) || HUB_DEFAULT_PATCH;
    const meta = document.getElementById('pnMetaA');
    if(meta) meta.textContent = _hubPatch && _hubPatch.updatedAt
      ? `Atualizado em ${new Date(_hubPatch.updatedAt).toLocaleDateString('pt-BR')} por ${String(_hubPatch.by||'').split('@')[0]}` : 'Ainda usando o texto padrão';
  });
}

/* ── AGENDA DA CASA (hub/calendar) ── mesmo formato que o hub grava ── */
async function saveHubEvent(){
  if(!fbOk){ toast('Firebase não conectado.','err'); return; }
  const date = document.getElementById('agDate').value;
  const endDate = document.getElementById('agEnd').value;
  const allDay = document.getElementById('agAllDay').checked;
  const time = allDay ? null : (document.getElementById('agTime').value || null);
  const title = document.getElementById('agTitle').value.trim();
  if(!date || !title){ toast('Preencha a data de início e o nome do evento.','err'); return; }
  if(endDate && endDate < date){ toast('A data de fim precisa ser depois do início.','err'); return; }
  try{
    await db.ref('hub/calendar').push({
      date, endDate: endDate && endDate > date ? endDate : null,
      time, allDay: allDay || null, title, by: _email,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await writeAdminLog('hub.evento.add', {title, date});
    toast('✓ Evento adicionado à agenda do hub','ok');
    document.getElementById('agTitle').value = ''; document.getElementById('agEnd').value = '';
  }catch(e){ console.error(e); toast('Falha ao adicionar evento.','err'); }
}
async function removeHubEvent(id){
  if(!confirm('Apagar este evento?')) return;
  try{ await db.ref('hub/calendar/'+id).remove(); await writeAdminLog('hub.evento.remove',{id}); toast('Evento removido','ok'); }
  catch(e){ toast('Falha ao remover.','err'); }
}
function renderHubEvents(){
  const el = document.getElementById('agList'); if(!el) return;
  const items = Object.entries(_hubEvents).map(([id,e]) => ({id, ...e}))
    .filter(e => e && e.date && e.title).sort((a,b) => (a.date||'').localeCompare(b.date||''));
  document.getElementById('agCount').textContent = items.length ? `${items.length} evento(s) adicionado(s)` : 'Nenhum evento adicionado';
  if(!items.length){ el.innerHTML = '<p style="color:var(--ink3);font-size:13px;padding:12px 0">Nenhum evento adicionado. Os eventos padrão da casa continuam no hub.</p>'; return; }
  const fmt = d => { const [y,m,dd]=d.split('-'); return `${dd}/${m}/${y}`; };
  el.innerHTML = items.map(e => {
    const when = e.allDay ? 'dia inteiro' : (e.time || '');
    const range = e.endDate ? ` — ${fmt(e.endDate)}` : '';
    return `<div class="he-row"><div class="he-main"><div class="he-t">${esc(e.title)}</div>
      <div class="he-s">${fmt(e.date)}${range}${when ? ' · '+esc(when) : ''}${e.by ? ' · '+esc(String(e.by).split('@')[0]) : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-act="removeHubEvent" data-arg="${e.id}" style="color:var(--red)">Remover</button></div>`;
  }).join('');
}

/* ── FIQUE LIGADO (hub/links) ── */
async function saveHubLink(){
  if(!fbOk){ toast('Firebase não conectado.','err'); return; }
  const url = document.getElementById('lkUrlA').value.trim();
  const title = document.getElementById('lkTitleA').value.trim();
  const tag = document.getElementById('lkTagA').value.trim();
  if(!url || !title){ toast('Preencha o link e o nome.','err'); return; }
  if(!/^https?:\/\//i.test(url)){ toast('O link precisa começar com https://','err'); return; }
  try{
    await db.ref('hub/links').push({ url, title, tag: tag || null, by: _email, createdAt: firebase.database.ServerValue.TIMESTAMP });
    await writeAdminLog('hub.link.add', {title, url});
    toast('✓ Link adicionado ao Fique ligado','ok');
    document.getElementById('lkUrlA').value = ''; document.getElementById('lkTitleA').value = ''; document.getElementById('lkTagA').value = '';
  }catch(e){ console.error(e); toast('Falha ao adicionar link.','err'); }
}
async function removeHubLink(id){
  const isSeed = String(id).indexOf('seed-') === 0;
  if(!confirm(isSeed ? 'Ocultar este link padrão do hub?' : 'Remover este link?')) return;
  try{
    // seed embutido: não existe em hub/links pra apagar — grava o tombstone que o
    // hub lê (hub/linksHidden/<id>). Link customizado: remove o nó normalmente.
    if(isSeed) await db.ref('hub/linksHidden/'+id).set(true);
    else       await db.ref('hub/links/'+id).remove();
    await writeAdminLog('hub.link.remove',{id, seed:isSeed});
    toast(isSeed ? 'Link padrão ocultado' : 'Link removido','ok');
  }catch(e){ toast('Falha ao remover.','err'); }
}
/* devolve um seed padrão ocultado (apaga o tombstone) */
async function restoreHubLink(id){
  try{ await db.ref('hub/linksHidden/'+id).remove(); await writeAdminLog('hub.link.restore',{id}); toast('Link restaurado','ok'); }
  catch(e){ toast('Falha ao restaurar.','err'); }
}
function renderHubLinks(){
  const el = document.getElementById('lkListA'); if(!el) return;
  const rowHtml = (l, {seed=false, hidden=false}={}) => {
    const host = (l.url||'').replace(/^https?:\/\//,'').replace(/\/$/,'');
    const tag = l.tag ? ` <span style="font-size:11px;color:var(--gold);font-weight:500">· ${esc(l.tag)}</span>` : '';
    const badge = seed
      ? ` <span style="font-size:10px;font-weight:700;color:var(--ink3);background:var(--s3);border:1px solid var(--border);border-radius:99px;padding:1px 7px">${hidden?'OCULTO':'PADRÃO'}</span>`
      : '';
    const by = l.by ? ' · '+esc(String(l.by).split('@')[0]) : '';
    const btn = (seed && hidden)
      ? `<button class="btn btn-ghost btn-sm" data-act="restoreHubLink" data-arg="${l.id}" style="color:var(--green)">Restaurar</button>`
      : `<button class="btn btn-ghost btn-sm" data-act="removeHubLink" data-arg="${l.id}" style="color:var(--red)">${seed?'Ocultar':'Remover'}</button>`;
    return `<div class="he-row"${hidden?' style="opacity:.55"':''}><div class="he-main"><div class="he-t">${esc(l.title)}${tag}${badge}</div>
      <div class="he-s">${esc(host)}${by}</div></div>${btn}</div>`;
  };
  // seeds padrão (All-in, Tour) — sempre listados, com estado oculto/visível
  const seedRows = HUB_DEFAULT_LINKS.map(l => rowHtml(l, {seed:true, hidden:!!_hubLinksHidden[l.id]})).join('');
  // links customizados adicionados pelo admin (hub/links)
  const custom = Object.entries(_hubLinks).map(([id,l]) => ({id, ...l})).filter(l => l && l.url && l.title);
  const customRows = custom.map(l => rowHtml(l)).join('');
  const shownCount = HUB_DEFAULT_LINKS.filter(l=>!_hubLinksHidden[l.id]).length + custom.length;
  document.getElementById('lkCountA').textContent = `${shownCount} link(s) no hub`;
  el.innerHTML = seedRows + customRows;
}

/* ── PATCH NOTES (hub/patchNotes) ── */
async function saveHubPatch(){
  if(!fbOk){ toast('Firebase não conectado.','err'); return; }
  const text = document.getElementById('pnTextA').value;
  if(!text.trim()){ toast('Escreva o conteúdo das patch notes.','err'); return; }
  try{
    await db.ref('hub/patchNotes').set({ text, by: _email, updatedAt: firebase.database.ServerValue.TIMESTAMP });
    await writeAdminLog('hub.patchNotes.save', {});
    toast('✓ Patch notes atualizadas no hub','ok');
  }catch(e){ console.error(e); toast('Falha ao salvar as patch notes.','err'); }
}
function resetAvisoForm(){
  _avEditId = null;
  document.getElementById('avTipo').value = 'info';
  document.getElementById('avTitulo').value = '';
  document.getElementById('avTexto').value = '';
  document.getElementById('avAtivo').checked = true;
  document.getElementById('avFormTitle').textContent = 'Novo aviso';
  document.getElementById('avSaveBtn').textContent = 'Publicar aviso';
  document.getElementById('avCancelBtn').hidden = true;
}
async function saveAviso(){
  if(!fbOk){ toast('Firebase não conectado.','err'); return; }
  const tipo = document.getElementById('avTipo').value;
  const titulo = document.getElementById('avTitulo').value.trim();
  const texto = document.getElementById('avTexto').value.trim();
  const ativo = document.getElementById('avAtivo').checked;
  if(!titulo){ toast('Escreva um título para o aviso.','err'); return; }
  const id = _avEditId || (Date.now()+'_'+Math.random().toString(36).slice(2,6));
  const prev = _avisos[id] || {};
  const data = { tipo, titulo, texto, ativo, by: _email, at: prev.at || Date.now(), updatedAt: Date.now() };
  try{
    await db.ref('hub/avisos/'+id).set(data);
    await writeAdminLog(_avEditId ? 'aviso.editar' : 'aviso.publicar', {tipo, titulo});
    toast(_avEditId ? '✓ Aviso atualizado' : '✓ Aviso publicado no hub','ok');
    resetAvisoForm();
  }catch(e){ console.error(e); toast('Falha ao salvar o aviso.','err'); }
}
function editAviso(id){
  const a = _avisos[id]; if(!a) return;
  _avEditId = id;
  document.getElementById('avTipo').value = avTipoOk(a.tipo);
  document.getElementById('avTitulo').value = a.titulo || '';
  document.getElementById('avTexto').value = a.texto || '';
  document.getElementById('avAtivo').checked = a.ativo !== false;
  document.getElementById('avFormTitle').textContent = 'Editar aviso';
  document.getElementById('avSaveBtn').textContent = 'Salvar alterações';
  document.getElementById('avCancelBtn').hidden = false;
  document.getElementById('pageAvisos').scrollIntoView({behavior:'smooth', block:'start'});
}
async function toggleAviso(id){
  const a = _avisos[id]; if(!a) return;
  try{ await db.ref(`hub/avisos/${id}/ativo`).set(a.ativo === false); }
  catch(e){ toast('Falha ao alterar visibilidade.','err'); }
}
async function removeAviso(id){
  if(!confirm('Remover este aviso definitivamente?')) return;
  try{
    await db.ref('hub/avisos/'+id).remove();
    await writeAdminLog('aviso.remover', {id});
    toast('Aviso removido','ok');
    if(_avEditId === id) resetAvisoForm();
  }catch(e){ toast('Falha ao remover.','err'); }
}
function renderAvisosAdmin(){
  const el = document.getElementById('avList');
  const count = document.getElementById('avCount');
  const items = Object.entries(_avisos).map(([id,a]) => ({id, ...a})).sort((a,b) => (b.at||0)-(a.at||0));
  const ativos = items.filter(a => a.ativo !== false).length;
  count.textContent = items.length ? `${items.length} aviso(s) · ${ativos} ativo(s) no hub` : 'Nenhum aviso publicado';
  if(!items.length){ el.innerHTML = '<p class="av-empty">Nenhum aviso ainda. Publique o primeiro acima.</p>'; return; }
  const tag = t => AV_TIPO_LABEL[avTipoOk(t)];
  /* estilo mora em admin.css (.av-item e família) — inline aqui era caça ao
     tesouro pra qualquer ajuste visual */
  el.innerHTML = items.map(a => {
    const tipo = avTipoOk(a.tipo);
    const inativo = a.ativo === false;
    const when = a.at ? new Date(a.at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="av-item tp-${tipo}${inativo?' off':''}">
      <span class="av-item-tag">${tag(tipo)}</span>
      <div class="av-item-body">
        <div class="av-item-title">${esc(a.titulo)}${inativo?' <span class="av-item-hidden">(oculto)</span>':''}</div>
        ${a.texto?`<div class="av-item-text">${esc(a.texto)}</div>`:''}
        <div class="av-item-meta">${when}${a.by?' · '+esc(String(a.by).split('@')[0]):''}</div>
      </div>
      <div class="av-item-actions">
        <button class="btn btn-ghost btn-sm" data-act="toggleAviso" data-arg="${a.id}">${inativo?'Mostrar':'Ocultar'}</button>
        <button class="btn btn-ghost btn-sm" data-act="editAviso" data-arg="${a.id}">Editar</button>
        <button class="btn btn-ghost btn-sm av-item-rm" data-act="removeAviso" data-arg="${a.id}">Remover</button>
      </div>
    </div>`;
  }).join('');
}

async function openAdminLog(){
  const mo = document.getElementById('moAdminLog');
  const el = document.getElementById('adminLogBody');
  if(!mo||!el) return;
  try{
    const snap = await db.ref('adminLog').orderByKey().limitToLast(100).once('value');
    const all  = snap.val()||{};
    const rows = Object.values(all).sort((a,b)=>(b.at||0)-(a.at||0));
    el.innerHTML = rows.length ? rows.map(r=>`<tr>
      <td class="mono c-ink3" style="font-size:10px;white-space:nowrap">${r.atStr||'—'}</td>
      <td class="c-ink2">${esc(r.action||'—')}</td>
      <td class="c-ink3" style="font-size:10px">${esc(r.admin||'—')}</td>
      <td class="c-ink3" style="font-size:10px">${esc(JSON.stringify(r).slice(0,80))}</td>
    </tr>`).join('') :
    '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--ink3)">Nenhum registro ainda.</td></tr>';
  }catch(e){ el.innerHTML='<tr><td colspan="4" style="color:var(--red)">Erro ao carregar.</td></tr>'; }
  mo.classList.add('open');
}

/* ══════════════════════════════════════════════════════════════
   CENTRAL DE ALERTAS — "o admin manda em tudo": todo comportamento
   suspeito do operador vira alerta num lugar só (sino na topbar).
   Fontes (TODAS já detectadas noutras telas; aqui só agregadas, pra
   não divergirem):
   • fixação cedo/atrasada     → flatRows.fixTiming
   • anomalias de resultado    → resultAnoms (prem R$0 / >3× GTD / field baixo / overlay >50%)
   • criação noturna suspeita  → cnAnoms (sem ID / após início / tempo 3× / alterado)
   • criação de card à mão     → flatRows.manual (manualRows)
══════════════════════════════════════════════════════════════ */
let _alertasDays = 7;
const _sevRank = { alta:3, media:2, info:1 };
/* alertas já VISTOS (some do contador). Em sessionStorage: some só quando o
   admin viu, sobrevive a reload da sessão, mas NADA vai pro Firebase. */
const alSig = a => `${a.date}|${a.hora}|${a.nome}|${a.motivo}`;
const _alSeen = (() => {
  try { return new Set(JSON.parse(sessionStorage.getItem('alertSeen')||'[]')); }
  catch(e){ return new Set(); }
})();
function _alSeenPersist(){
  try { sessionStorage.setItem('alertSeen', JSON.stringify([..._alSeen].slice(-500))); }
  catch(e){ /* storage cheio/indisponível — o Set em memória ainda vale */ }
}

/* Anomalias de RESULTADO — MESMA regra da tabela de auditoria (~L1335),
   centralizada aqui pra as duas telas nunca discordarem. */
function resultAnoms(r){
  const out = [];
  if(r.premiacao === 0) out.push('Premiação R$0');
  if(r.premiacao != null && r.garantido && r.premiacao > r.garantido*3) out.push('Premiação >3× o GTD');
  if(r.field != null && r.buyin && r.field > 0 && r.garantido && (r.field*r.buyin) < r.garantido*0.1) out.push('Field baixo pro GTD');
  if(r.overlay != null && r.garantido && Math.abs(r.overlay) > r.garantido*0.5) out.push('Overlay >50% do GTD');
  return out;
}

/* Junta TODOS os alertas do período. Puro sobre _allData (já em memória) + fetch
   leve da Criação Noturna. Não renderiza nem re-baixa a janela de 60 dias. */
async function collectAlertas(days){
  const to = nowSP(), from = dago((days||7)-1);
  const rows = flatRows(from, to);
  const out = [];
  const push = (sev, cat, motivo, r) => out.push({
    sev, cat, motivo, nome:r.nome, hora:r.hora, date:r.date,
    op: r.fixBy || r.idBy || '', when:0,
  });
  for(const r of rows){
    if(r.fixTiming === 'atrasado')
      push('alta','fix', `Fixou atrasado (${Math.abs(r.fixLeadMin)}min ${r.fixLeadMin<0?'após o':'antes do'} início)`, r);
    else if(r.fixTiming === 'cedo')
      push('media','fix', `Fixou muito cedo (${Math.round(r.fixLeadMin/60*10)/10}h antes do prazo)`, r);
    for(const a of resultAnoms(r))
      push(a==='Premiação R$0'?'alta':'media','resultado', a, r);
    if(r.manual)
      push('info','card', 'Card adicionado à mão na auditoria', r);
  }
  // Criação Noturna — mesma janela
  try{
    const dates = []; const d=new Date(from+'T12:00:00Z'), end=new Date(to+'T12:00:00Z');
    while(d<=end && dates.length<62){ dates.push(d.toISOString().slice(0,10)); d.setUTCDate(d.getUTCDate()+1); }
    const cn = await fetchCnRows(dates);
    const avg = cnAvgDur(cn);
    for(const r of cn) for(const a of cnAnoms(r, avg))
      out.push({ sev:(a==='criado após o início'?'alta':'media'), cat:'criacao',
        motivo:'Criação · '+a, nome:r.nome, hora:r.hora, date:r.date, op:r.doneBy||'', when:r.doneAt||0 });
  }catch(e){ console.warn('[alertas] CN:', e.message); }
  // ordena: gravidade ↓, depois data ↓ / hora ↓
  out.sort((a,b)=> (_sevRank[b.sev]-_sevRank[a.sev])
    || String(b.date).localeCompare(String(a.date))
    || String(b.hora).localeCompare(String(a.hora)));
  return out;
}

function setAlertasPeriod(n){ _alertasDays = n; openAlertas(); }

async function openAlertas(){
  const mo = document.getElementById('moAlertas');
  const body = document.getElementById('alertasBody');
  if(!mo || !body) return;
  mo.classList.add('open');
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink3)">Carregando alertas…</div>';
  [7,15,30].forEach(n=>{ const b=document.getElementById('alPer'+n); if(b) b.classList.toggle('btn-gold', _alertasDays===n); });
  let al; try{ al = await collectAlertas(_alertasDays); }
  catch(e){ body.innerHTML='<div style="padding:24px;color:var(--red)">Erro ao carregar alertas.</div>'; return; }
  if(!al.length){ updateAlertasBadge(0); body.innerHTML='<div style="padding:24px;text-align:center;color:var(--ink3)">✓ Nenhum comportamento suspeito no período.</div>'; return; }
  const sevMeta = {
    alta:  ['var(--red)','rgba(239,68,68,.12)','Alta'],
    media: ['var(--amber)','rgba(245,158,11,.12)','Média'],
    info:  ['#60a5fa','rgba(96,165,250,.12)','Info'],
  };
  const catIcon = { fix:'⏱', resultado:'⚠', criacao:'🌙', card:'➕' };
  const fmtD = d => d ? `${d.slice(8,10)}/${d.slice(5,7)}` : '—';
  body.innerHTML = al.map(a=>{
    const [c,bg,lbl] = sevMeta[a.sev]||sevMeta.info;
    const novo = !_alSeen.has(alSig(a));   // marca os que ainda não tinham sido vistos
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--s2,rgba(0,0,0,.06))${novo?';background:rgba(96,165,250,.05)':''}">
      <span style="font-size:16px;flex:0 0 auto">${catIcon[a.cat]||'•'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--ink);font-weight:600">${novo?'<span style="color:#60a5fa;font-weight:800;margin-right:4px">•</span>':''}${esc(a.motivo)}</div>
        <div style="font-size:11px;color:var(--ink3);margin-top:2px">${esc(a.nome||'—')} · ${esc(a.hora||'—')} · ${fmtD(a.date)}${a.op?` · <b style="color:var(--ink2)">${esc(a.op)}</b>`:''}</div>
      </div>
      <span style="flex:0 0 auto;font-size:9px;font-weight:800;color:${c};background:${bg};border-radius:5px;padding:2px 7px;white-space:nowrap">${lbl}</span>
    </div>`;
  }).join('');
  // abriu = viu: marca todos como vistos e zera o contador
  al.forEach(a => _alSeen.add(alSig(a)));
  _alSeenPersist();
  updateAlertasBadge(0);
}

/* atualiza SÓ o número do sino (sem abrir o modal) = quantos alertas AINDA NÃO
   foram vistos. Roda no idle do init e a cada atualização ao vivo da grade. */
async function refreshAlertasBadge(){
  try{
    if(!Object.keys(_allData).length) return;
    const al = await collectAlertas(_alertasDays);
    updateAlertasBadge(al.filter(a => !_alSeen.has(alSig(a))).length);
  }catch(e){ /* silencioso — o sino é secundário */ }
}
function updateAlertasBadge(n){
  const b = document.getElementById('alertasBadge');
  if(!b) return;
  if(n>0){ b.textContent = n>99?'99+':String(n); b.style.display=''; }
  else b.style.display='none';
}

/* ── 13. Tendência de field por torneio ── */
function buildFieldTrend(){
  const el = document.getElementById('fieldTrendBody');
  if(!el) return;

  const today = nowSP();
  const mid   = dago(30);
  const old   = dago(60);

  const avg = a => a.reduce((s,x)=>s+x,0)/a.length;
  const rows60 = flatRows(old, today).filter(r=>r.field!=null&&r.field>0);
  const byName = {};
  rows60.forEach(r=>{
    if(!byName[r.nome]) byName[r.nome]={recent:[],older:[]};
    if(r.date >= mid) byName[r.nome].recent.push(r.field);
    else              byName[r.nome].older.push(r.field);
  });

  // Comparação: 2+ rodadas recentes (estabilidade) vs. 1+ antiga (histórico curto já vale)
  const trends = Object.entries(byName)
    .filter(([,v])=>v.recent.length>=2&&v.older.length>=1)
    .map(([nome,v])=>{
      const avgR=avg(v.recent), avgO=avg(v.older), p=avgO>0?((avgR-avgO)/avgO*100):0;
      return {nome, avgR:Math.round(avgR), avgO:Math.round(avgO), pct:Math.round(p*10)/10, n:v.recent.length};
    })
    .sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct))
    .slice(0,20);

  if(trends.length){
    el.innerHTML = trends.map(t=>{
      const up=t.pct>=10, down=t.pct<=-10;
      const color = up?'var(--green)':down?'var(--red)':'var(--ink3)';
      const arrow = up?'▲':down?'▼':'—';
      return `<tr>
        <td class="nm">${esc(t.nome)}</td>
        <td class="r mono c-ink3">${t.avgO}</td>
        <td class="r mono">${t.avgR}</td>
        <td class="r mono" style="color:${color};font-weight:700">${t.pct>=0?'+':''}${t.pct}%</td>
        <td style="text-align:center;color:${color};font-weight:800">${arrow}</td>
      </tr>`;
    }).join('');
    return;
  }

  // FALLBACK: sem 60 dias p/ comparar → ranking dos maiores fields dos últimos 30 dias
  const recent = Object.entries(byName)
    .filter(([,v])=>v.recent.length>=2)
    .map(([nome,v])=>({nome, avgR:Math.round(avg(v.recent)), n:v.recent.length}))
    .sort((a,b)=>b.avgR-a.avgR).slice(0,20);
  if(recent.length){
    el.innerHTML = `<tr><td colspan="5" style="padding:8px 10px;color:var(--ink3);font-size:11px;background:var(--s2)">Sem 60 dias de histórico p/ comparar — mostrando os <b>maiores fields dos últimos 30 dias</b>.</td></tr>`
      + recent.map(t=>`<tr>
        <td class="nm">${esc(t.nome)}</td>
        <td class="r mono c-ink3">—</td>
        <td class="r mono">${t.avgR}</td>
        <td class="r mono c-ink3">—</td>
        <td style="text-align:center;font-size:10px;color:var(--ink3)">${t.n}×</td>
      </tr>`).join('');
    return;
  }
  el.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--ink3)">Ainda sem field registrado no período (o campo "field" dos torneios está vazio).</td></tr>';
}

/* ── 1. Atalhos de período ── */
function setAuditPeriod(period){
  const today = nowSP();
  let from = today, to = today;
  if(period === 'today'){
    from = to = today;
  } else if(period === 'week'){
    // Segunda-feira desta semana
    const d = new Date(today + 'T12:00:00');
    const day = d.getDay() || 7; // dom=7
    d.setDate(d.getDate() - day + 1);
    from = d.toISOString().slice(0,10);
    to   = today;
  } else if(period === 'lastweek'){
    const d = new Date(today + 'T12:00:00');
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    const endD = new Date(d); endD.setDate(endD.getDate() - 1);
    d.setDate(d.getDate() - 7);
    from = d.toISOString().slice(0,10);
    to   = endD.toISOString().slice(0,10);
  } else if(period === 'month'){
    from = today.slice(0,7) + '-01';
    to   = today;
  }
  const auFrom = document.getElementById('auFrom');
  const auTo   = document.getElementById('auTo');
  if(auFrom) auFrom.value = from;
  if(auTo)   auTo.value   = to;
  loadAudit();
}

/* ── 2. Lote de aprovação ── */
function updateBatchActions(){
  const checks = document.querySelectorAll('.row-check:checked');
  const bar = document.getElementById('batchActions');
  const count = document.getElementById('batchCount');
  if(bar) bar.style.display = checks.length > 0 ? 'flex' : 'none';
  if(count) count.textContent = `${checks.length} selecionado${checks.length>1?'s':''}`;
}

function toggleCheckAll(cb){
  document.querySelectorAll('.row-check').forEach(c => {
    c.checked = cb.checked;
  });
  updateBatchActions();
}

function batchDeselect(){
  document.querySelectorAll('.row-check, #checkAll').forEach(c => c.checked = false);
  updateBatchActions();
}

async function batchApprove(){
  const checks = [...document.querySelectorAll('.row-check:checked')];
  if(!checks.length) return;
  if(!await confirmModal({title:'Aprovar em lote',message:`Aprovar <b>${checks.length}</b> torneio${checks.length>1?'s':''} sem correção?`,confirmLabel:'Aprovar'})) return;

  const bar = document.getElementById('batchActions');
  if(bar) bar.innerHTML = '<span style="font-size:11px;color:var(--ink3)">Salvando...</span>';

  let done = 0, skipped = 0;
  for(const cb of checks){
    const key  = cb.dataset.key;
    const date = cb.dataset.date;
    const r = _auditRows.find(r=>r.key===key&&r.date===date);
    if(!r) continue;
    // NÃO reaprovar um que já foi CORRIGIDO: "aprovado" ignora premiacaoAuditada
    // (ver enrichWithAudit), então trocar corrigido→aprovado reverteria o valor pro
    // original — era o "muda o valor". Corrigido já está auditado; pula e avisa.
    if(r._auditEntry && r._auditEntry.status === 'corrigido'){ skipped++; continue; }
    const entry = {
      premiacaoOriginal: r.premiacao??null, fieldOriginal: r.field??null,
      premiacaoAuditada: r.premiacao??null, fieldAuditado: r.field??null,
      status:'aprovado', obs:null,
      auditadoEm: Date.now(), auditadoPor: _email||'admin',
      nome: r.nome, hora: r.hora,
    };
    try{
      await db.ref(`auditoria/${date}/${key}`).set(entry);
      if(!_auditData[date]) _auditData[date] = {};
      _auditData[date][key] = entry;
      r._audited = true; r._auditEntry = entry;
      done++;
    }catch(e){ console.error('batchApprove error:', e); }
  }
  toast(`✓ ${done} torneio${done>1?'s':''} aprovado${done>1?'s':''}${skipped?` · ${skipped} corrigido(s) mantido(s)`:''}`, 'ok');
  batchDeselect();
  loadAudit();
}

/* "Aprovar todos sem erro" (botão do topo da Auditoria) — marca como APROVADO,
   SEM correção, todos os torneios do período que (a) não têm anomalia automática e
   (b) ainda NÃO foram auditados. Os já auditados/corrigidos ficam INTOCADOS de
   propósito: reaprovar um corrigido reverteria o valor pro original (ver
   enrichWithAudit) — a causa do "muda o valor" relatado. Estava faltando a função
   (o botão existia e caía no vazio). */
function _auditAnomalia(r){
  return (r.premiacao === 0)
    || (r.premiacao != null && r.garantido && r.premiacao > r.garantido * 3)
    || (r.field != null && r.buyin && r.field > 0 && r.garantido && (r.field * r.buyin) < r.garantido * 0.1)
    || (r.overlay != null && r.garantido && Math.abs(r.overlay) > r.garantido * 0.5);
}
async function approveAllAudit(){
  if(!fbOk){ toast('Sem conexão com o Firebase','err'); return; }
  const alvos = (_auditRows || []).filter(r => !r._audited && !_auditAnomalia(r));
  if(!alvos.length){ toast('Nada a aprovar — todos já foram auditados ou têm anomalia.','ok'); return; }
  if(!await confirmModal({title:'Aprovar todos sem erro',message:`Aprovar <b>${alvos.length}</b> torneio${alvos.length>1?'s':''} sem anomalia e ainda não auditado${alvos.length>1?'s':''}?<br><span style="font-size:11px;color:var(--ink3)">Os já auditados/corrigidos não são tocados.</span>`,confirmLabel:'Aprovar todos'})) return;
  let done = 0;
  for(const r of alvos){
    const entry = {
      premiacaoOriginal: r.premiacao??null, fieldOriginal: r.field??null,
      premiacaoAuditada: r.premiacao??null, fieldAuditado: r.field??null,
      status:'aprovado', obs:null,
      auditadoEm: Date.now(), auditadoPor: _email||'admin',
      nome: r.nome, hora: r.hora,
    };
    try{
      await db.ref(`auditoria/${r.date}/${r.key}`).set(entry);
      if(!_auditData[r.date]) _auditData[r.date] = {};
      _auditData[r.date][r.key] = entry;
      r._audited = true; r._auditEntry = entry;
      done++;
    }catch(e){ console.error('approveAllAudit error:', e); }
  }
  toast(`✓ ${done} torneio${done>1?'s':''} aprovado${done>1?'s':''} sem erro`, 'ok');
  loadAudit();
}

/* ── 4. Histórico de notificações por operador ── */
async function openNotifHistory(){
  if(!fbOk) return;
  const all = await getAllNotifsCached();
  const mo   = document.getElementById('moNotifHistory');
  const el   = document.getElementById('notifHistoryBody');
  if(!mo||!el) return;

  const rows = [];
  Object.entries(all).forEach(([emailKey, notifs])=>{
    Object.entries(notifs||{}).forEach(([id, n])=>{
      rows.push({emailKey, id, ...n});
    });
  });
  rows.sort((a,b)=>(b.sentAt||0)-(a.sentAt||0));

  if(!rows.length){
    el.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--ink3)">Nenhuma notificação enviada ainda.</td></tr>';
  } else {
    el.innerHTML = rows.map(n=>`<tr>
      <td class="mono c-ink3" style="font-size:10px">${n.sentAt?new Date(n.sentAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}</td>
      <td class="nm">${esc(n.torneio||'—')}</td>
      <td>${esc(n.typeLabel||n.type||'—')}</td>
      <td class="c-ink2">${esc(n.sentBy||'—')}</td>
      <td><span class="badge ${n.resolved?'badge-closed':'badge-open'}">${n.resolved?'Resolvido':'Pendente'}</span></td>
      <td class="c-ink3 mono" style="font-size:10px">${esc(n.emailKey||'')}</td>
    </tr>`).join('');
  }
  mo.classList.add('open');
}

/* ── 5. Ranking de operadores ── */
/* estatísticas da Criação Noturna por operador no período (pro ranking e dashboard) */
async function cnStatsByOp(fromDate, toDate){
  const dates = [];
  const d = new Date(fromDate + 'T12:00:00Z'), end = new Date(toDate + 'T12:00:00Z');
  while(d <= end && dates.length < 62){ dates.push(d.toISOString().slice(0,10)); d.setUTCDate(d.getUTCDate()+1); }
  const snaps = await Promise.all(dates.map(dt => db.ref(`painel/${dt}/criacaoNoturna`).once('value').then(s => s.val())));
  const byOp = {}; let total = 0, criados = 0, comId = 0, erros = 0, durSum = 0, durN = 0, dias = 0;
  snaps.forEach(v => {
    if(!v || !v.sheet) return;
    dias++;
    let data; try{ data = JSON.parse(v.sheet.json); }catch(e){ return; }
    const done = v.done||{}, ids = v.ids||{}, audit = v.audit||{};
    ['main','side','sat'].forEach(k => (data[k]||[]).forEach(it => {
      total++;
      const key = cnKey(it), dn = done[key];
      if(!dn || !dn.by) return;
      criados++;
      const o = byOp[dn.by] || (byOp[dn.by] = {criados:0, erros:0, comId:0, durSum:0, durN:0});
      o.criados++;
      if(ids[key]){ o.comId++; comId++; }
      if(dn.dur){ o.durSum += dn.dur; o.durN++; durSum += dn.dur; durN++; }
      if(audit[key] && audit[key].status === 'erro'){ o.erros++; erros++; }
    }));
  });
  return {byOp, total, criados, comId, erros, durSum, durN, dias};
}

async function buildOpRanking(){
  const el = document.getElementById('opRankingBody');
  if(!el) return;

  const rows = flatRows(dago(30), nowSP());
  const byOp = {};

  rows.forEach(r=>{
    const op = r.fixBy || r.idBy || '(sem operador)';
    if(!byOp[op]) byOp[op]={op, total:0, fixados:0, comId:0, overlay:0, semPrem:0, notifs:0};
    byOp[op].total++;
    if(r.fixBy) byOp[op].fixados++;
    if(r.id && r.id.toUpperCase()!=='NF' && r.id.trim()) byOp[op].comId++;
    if(r.overlay!=null&&r.overlay<0) byOp[op].overlay++;
    if(r.status==='aberto') byOp[op].semPrem++;
  });

  // Contar notificações por operador — casa a chave de e-mail com o nome de exibição
  // via _allUsers (evita o match frágil por substring do nome anterior).
  try{
    const all = await getAllNotifsCached();
    Object.entries(all).forEach(([emailKey, notifs])=>{
      const u = _allUsers[emailKey]||{};
      const name = u.apelido||u.nome||'';
      const count = Object.keys(notifs||{}).length;
      if(name && byOp[name]) byOp[name].notifs += count;
    });
  }catch(e){}

  // soma o lado da CRIAÇÃO NOTURNA (GU) — quem cria de noite também pontua/penaliza aqui
  let cn = {byOp:{}};
  try{ cn = await cnStatsByOp(dago(30), nowSP()); }catch(e){}
  Object.entries(cn.byOp).forEach(([name, s]) => {
    if(!byOp[name]) byOp[name] = {op:name, total:0, fixados:0, comId:0, overlay:0, semPrem:0, notifs:0};
    byOp[name].cnCriados = s.criados;
    byOp[name].cnErros = s.erros;
  });

  const sorted = Object.values(byOp).sort((a,b)=>(b.total+(b.cnCriados||0))-(a.total+(a.cnCriados||0)));

  el.innerHTML = sorted.map((op,i)=>`<tr>
    <td style="font-weight:700;color:var(--ink3)">${i+1}</td>
    <td class="nm">${esc(op.op)}</td>
    <td class="r mono">${op.total}</td>
    <td class="r mono">${op.fixados}</td>
    <td class="r mono">${op.comId}</td>
    <td class="r mono ${op.semPrem>5?'c-red':''}">${op.semPrem}</td>
    <td class="r mono ${op.notifs>0?'c-amber':''}">${op.notifs}</td>
    <td class="r mono">${op.cnCriados||0}</td>
    <td class="r mono ${op.cnErros?'c-red':''}">${op.cnErros||0}</td>
  </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--ink3)">Sem dados nos últimos 30 dias.</td></tr>';
}

/* ── 6. Heatmap de overlay por horário (card inline no Dashboard) ── */
async function buildHeatmap(){
  const el = document.getElementById('heatmapBody');
  if(!el) return;

  const rows = flatRows(dago(30), nowSP()).filter(r=>r.premiacao!=null&&r.garantido);
  const byHour = {};
  rows.forEach(r=>{
    const h = r.hora ? r.hora.slice(0,2) : '??';
    if(!byHour[h]) byHour[h]={h, total:0, ovCount:0, ovTotal:0, gar:0};
    byHour[h].total++;
    byHour[h].gar += r.garantido;
    if(r.overlay!=null&&r.overlay<0){ byHour[h].ovCount++; byHour[h].ovTotal+=Math.abs(r.overlay); }
  });

  const hours = Object.values(byHour).sort((a,b)=>a.h.localeCompare(b.h));
  const maxMoney = Math.max(...hours.map(h=>h.ovTotal), 1);   // barra = onde o dinheiro sangra
  const worst = hours.reduce((a,b)=>b.ovTotal>(a?a.ovTotal:0)?b:a, null);

  el.innerHTML = (hours.map(h=>{
    const rate = h.total>0 ? h.ovCount/h.total : 0;
    const has  = h.ovTotal>0;
    // taxa colorida por severidade (verde baixo → vermelho alto); horas limpas ficam apagadas
    const rateColor = rate>=0.5?'var(--red)':rate>=0.25?'var(--amber)':(has?'var(--ink2)':'var(--ink3)');
    const moneyBar  = Math.round(h.ovTotal/maxMoney*100);
    const isWorst   = worst && h.h===worst.h && has;
    return `<tr style="${has?'':'opacity:.45'}${isWorst?';background:color-mix(in srgb,var(--red) 6%,transparent)':''}">
      <td class="mono c-ink2">${h.h}:xx${isWorst?' <span style="font-size:9px;color:var(--red);font-weight:700">pior</span>':''}</td>
      <td class="r mono">${h.total}</td>
      <td class="r mono ${has?'c-amber':'c-ink3'}">${h.ovCount||'—'}</td>
      <td class="r mono" style="color:${rateColor}">${h.total?Math.round(rate*100)+'%':'—'}</td>
      <td class="r" style="min-width:132px">
        <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          ${has?`<div style="flex:1;max-width:78px;height:7px;background:var(--s3);border-radius:4px;overflow:hidden"><div style="width:${moneyBar}%;height:100%;background:linear-gradient(90deg,var(--amber),var(--red));border-radius:4px"></div></div>`:''}
          <span class="mono" style="min-width:52px;text-align:right;font-size:11px;color:${has?'var(--red)':'var(--ink3)'}">${has?brlk(h.ovTotal):'—'}</span>
        </div>
      </td>
    </tr>`;
  }).join('')) || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--ink3)">Sem dados suficientes.</td></tr>';
}

/* ── 7. Projeção de premiação do mês ── */
function buildMonthProjection(){
  const el = document.getElementById('monthProjection');
  if(!el) return;

  const today   = nowSP();
  const [y,m]   = today.split('-');
  const firstDay = `${y}-${m}-01`;
  const lastDay  = new Date(parseInt(y), parseInt(m), 0).getDate();
  const daysPast = parseInt(today.slice(8));
  const daysLeft = lastDay - daysPast;

  const rows    = flatRows(firstDay, today);
  const closed  = rows.filter(r=>r.premiacao!=null);
  const totalPrem = closed.reduce((s,r)=>s+(r.premiacao||0),0);
  const totalGar  = rows.reduce((s,r)=>s+(r.garantido||0),0);
  const totalOv   = closed.reduce((s,r)=>s+(r.overlay||0),0);

  if(!closed.length || !daysPast){
    el.innerHTML = '<div style="font-size:12px;color:var(--ink3)">Sem dados suficientes para projeção.</div>';
    return;
  }

  // Projeção linear: média/dia × dias restantes
  const premPerDay  = totalPrem / daysPast;
  const ovPerDay    = totalOv   / daysPast;
  const projPrem    = totalPrem + premPerDay * daysLeft;
  const projOv      = totalOv   + ovPerDay   * daysLeft;
  const coveragePct = totalGar > 0 ? (totalPrem/totalGar*100) : 0;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
      <div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Premiação até hoje</div>
        <div style="font-size:18px;font-weight:800;font-family:var(--mono)">${brlk(totalPrem)}</div>
        <div style="font-size:10px;color:var(--ink3)">${daysPast}/${lastDay} dias</div>
      </div>
      <div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Projeção do mês</div>
        <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--gold)">${brlk(projPrem)}</div>
        <div style="font-size:10px;color:var(--ink3)">+${daysLeft} dias restantes</div>
      </div>
      <div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Overlay projetado</div>
        <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:${projOv<0?'var(--red)':'var(--green)'}">${projOv<0?'-':'+'}${brlk(Math.abs(projOv))}</div>
        <div style="font-size:10px;color:var(--ink3)">baseado na média diária</div>
      </div>
      <div style="padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:9px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:5px">Cobertura GTD</div>
        <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:${coveragePct>=100?'var(--green)':'var(--amber)'}">${coveragePct.toFixed(0)}%</div>
        <div style="font-size:10px;color:var(--ink3)">premiação vs garantido</div>
      </div>
    </div>`;
}

async function openAuditSummary(){
  await loadAuditData();
  const to   = nowSP();
  const from = dago(6);
  document.getElementById('sumFrom').value = from;
  document.getElementById('sumTo').value   = to;
  document.getElementById('moAuditSummary').classList.add('open');
  buildAuditSummary();
}

function buildAuditSummary(){
  const from = document.getElementById('sumFrom').value || dago(6);
  const to   = document.getElementById('sumTo').value   || nowSP();
  const el   = document.getElementById('auditSummaryResult');

  // Coletar todos os dados auditados no período
  const entries = [];
  Object.entries(_auditData).forEach(([date, keys]) => {
    if(date < from || date > to) return;
    Object.entries(keys||{}).forEach(([key, a]) => {
      entries.push({date, key, ...a});
    });
  });

  if(!entries.length){
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><h3>Nenhuma auditoria no período</h3><p>Edite os dados na aba Acompanhamento para criar registros de auditoria.</p></div>';
    return;
  }

  // Agrupar por status
  const corrigidos = entries.filter(e => e.status === 'corrigido');
  const aprovados  = entries.filter(e => e.status === 'aprovado');

  const mkRow = e => {
    const premOk  = e.premiacaoAuditada != null;
    const fieldOk = e.fieldAuditado != null;
    const diffPrem = premOk && e.premiacaoOriginal != null
      ? e.premiacaoAuditada - e.premiacaoOriginal : null;
    return `<tr>
      <td class="mono c-ink3">${fmtDate(e.date)}</td>
      <td class="nm">${esc(e.nome||'')}</td>
      <td class="mono c-ink2">${esc(e.hora||'')}</td>
      <td class="r mono c-ink3">${e.premiacaoOriginal!=null?'R$ '+brl(e.premiacaoOriginal):'—'}</td>
      <td class="r mono ${diffPrem!=null&&diffPrem!==0?'c-gold':''}">${premOk?'R$ '+brl(e.premiacaoAuditada):'—'}</td>
      <td class="r mono ${diffPrem!=null&&diffPrem<0?'c-red':diffPrem>0?'c-green':''}">${diffPrem!=null&&diffPrem!==0?(diffPrem>0?'+':'')+brl(diffPrem):'—'}</td>
      <td class="r mono c-ink3">${e.fieldOriginal!=null?e.fieldOriginal:'—'}</td>
      <td class="r mono ${e.fieldAuditado!=null&&e.fieldAuditado!==e.fieldOriginal?'c-gold':''}">${fieldOk?e.fieldAuditado:'—'}</td>
      <td class="c-ink2" style="font-size:10px">${esc(e.obs||'')}</td>
      <td class="c-ink3" style="font-size:10px">${esc(e.auditadoPor||'')}</td>
    </tr>`;
  };

  el.innerHTML = `
    ${corrigidos.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:8px">
        ⚠ Corrigidos (${corrigidos.length})
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>Data</th><th>Torneio</th><th>Hora</th>
            <th class="r">Prem. Original</th><th class="r">Prem. Auditada</th><th class="r">Diferença</th>
            <th class="r">Field Original</th><th class="r">Field Auditado</th>
            <th>Obs.</th><th>Por</th>
          </tr></thead>
          <tbody>${corrigidos.map(mkRow).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
    ${aprovados.length ? `
    <div>
      <div style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--green);margin-bottom:8px">
        ✓ Aprovados sem correção (${aprovados.length})
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Data</th><th>Torneio</th><th>Hora</th><th class="r">Premiação</th><th class="r">Field</th><th>Por</th></tr></thead>
          <tbody>${aprovados.map(e=>`<tr>
            <td class="mono c-ink3">${fmtDate(e.date)}</td>
            <td class="nm">${esc(e.nome||'')}</td>
            <td class="mono c-ink2">${esc(e.hora||'')}</td>
            <td class="r mono">${e.premiacaoAuditada!=null?'R$ '+brl(e.premiacaoAuditada):'—'}</td>
            <td class="r mono">${e.fieldAuditado!=null?e.fieldAuditado:'—'}</td>
            <td class="c-ink3" style="font-size:10px">${esc(e.auditadoPor||'')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
  `;
}

async function exportAuditSummaryXlsx(){
  await ensureXLSX();                 // SheetJS sob demanda
  const from = document.getElementById('sumFrom').value || dago(6);
  const to   = document.getElementById('sumTo').value   || nowSP();
  const entries = [];
  Object.entries(_auditData).forEach(([date,keys])=>{
    if(date<from||date>to) return;
    Object.entries(keys||{}).forEach(([key,a])=>entries.push({date,key,...a}));
  });
  if(!entries.length){ toast('Nenhuma auditoria no período','err'); return; }

  const aoa = [['Data','Torneio','Hora','Status','Prem. Original','Prem. Auditada','Diferença','Field Original','Field Auditado','Observação','Auditado por','Data/Hora auditoria']];
  entries.sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>{
    const diff = (e.premiacaoAuditada!=null&&e.premiacaoOriginal!=null)?e.premiacaoAuditada-e.premiacaoOriginal:null;
    aoa.push([fmtDate(e.date),e.nome||'',e.hora||'',e.status==='corrigido'?'Corrigido':'Aprovado',
      e.premiacaoOriginal??'',e.premiacaoAuditada??'',diff??'',
      e.fieldOriginal??'',e.fieldAuditado??'',e.obs||'',e.auditadoPor||'',
      e.auditadoEm?new Date(e.auditadoEm).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):''
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [10,30,6,10,13,13,10,12,12,30,12,16].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Auditoria');
  XLSX.writeFile(wb,`Auditoria_${from}_${to}.xlsx`);
  toast('✓ Exportado','ok');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-bg.open').forEach(m=>m.classList.remove('open'));});

/* debounce por chave: buscas não re-renderizam a lista a cada tecla (fluidez ao digitar) */
var _dbTimers = {};
function debounced(key, fn, ms){
  clearTimeout(_dbTimers[key]);
  _dbTimers[key] = setTimeout(fn, ms || 150);
}

/* ── INIT ────────────────────────────────────────────────────── */
/* Firebase agora carrega com `defer`. initFb() usa `firebase` e autoEnterFromSession()
   depende do db — ambos rodam no DOMContentLoaded (após os deferred, na ordem certa). */
function adminBoot(){ initFb(); autoEnterFromSession(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', adminBoot); else adminBoot();

/* pausa animações quando a janela sai de foco / fica oculta — fluidez p/ os outros apps */
(function freezeWhenBlurred(){
  var set = function(b){ document.body.classList.toggle('win-blurred', b); };
  addEventListener('blur', function(){ set(true); });
  addEventListener('focus', function(){ set(false); });
  document.addEventListener('visibilitychange', function(){ set(document.hidden); });
})();

/* ── a11y dos modais (.modal-bg) ───────────────────────────────────────────
   Os modais abrem/fecham só por classe .open (em vários pontos). Em vez de
   mexer em cada chamada, um observer central espelha a classe em aria-hidden,
   leva o foco pra dentro ao abrir e o devolve ao fechar. O Esc já fecha (acima). */
(function(){
  var lastFocus = null;
  function focusIn(mo){
    lastFocus = document.activeElement;
    var f = mo.querySelector('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    if(f) setTimeout(function(){ f.focus(); }, 40);
  }
  function focusBack(){ if(lastFocus && lastFocus.focus) lastFocus.focus(); lastFocus = null; }
  document.querySelectorAll('.modal-bg').forEach(function(mo){
    var open = mo.classList.contains('open');
    new MutationObserver(function(){
      var now = mo.classList.contains('open');
      if(now === open) return;
      open = now;
      mo.setAttribute('aria-hidden', now ? 'false' : 'true');
      if(now) focusIn(mo); else focusBack();
    }).observe(mo, { attributes:true, attributeFilter:['class'] });
  });
  // Tab-trap: mantém o foco dentro do modal aberto
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Tab') return;
    var mo = document.querySelector('.modal-bg.open'); if(!mo) return;
    var foc = [].slice.call(mo.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(function(el){ return el.getClientRects().length; });
    if(!foc.length) return;
    var first = foc[0], last = foc[foc.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    else if(!mo.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  });
})();

/* ── ⌘K Command Palette: navegação de seções do Admin ────────────────────────
   Pluga a sidebar do Admin (Acompanhamento/Operadores/Grade…) no buscador global.
   "abrir" clica o .ntab certo — a delegação data-act="nav" cuida do resto. */
document.addEventListener('DOMContentLoaded', () => {
  if (!window.SupremaPalette) return;
  const pnorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const SECTIONS = [
    ['audit','Acompanhamento'], ['criacao','Criação (GU)'], ['dashboard','Dashboard'],
    ['grade','Grade'], ['operadores','Operadores'], ['backup','Backup & Arquivo'],
    ['avisos','Conteúdo do hub']
  ];
  SupremaPalette.register({
    id: 'secoes-admin', group: 'Seções do Admin',
    search(q){
      const nq = pnorm(q);
      if (!nq) return [];
      return SECTIONS.filter(([, label]) => pnorm(label).includes(nq)).map(([id, label]) => ({
        title: label, sub: 'Ir para a seção', icon: '♦', hint: 'seção',
        run(){ try { document.querySelector(`.ntab[data-act="nav"][data-arg="${id}"]`)?.click(); } catch (e) {} }
      }));
    }
  });
});

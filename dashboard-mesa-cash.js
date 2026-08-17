/* ── FIREBASE + LOGIN (mesmo login do Painel/Admin) ────────────
   Config e lógica de hash copiadas de admin.html para reaproveitar
   as mesmas contas/senhas. Sem firebase.auth() — igual ao resto do
   app hoje, o controle de acesso é feito no client (ADMIN_EMAILS /
   users/{key}.admin), não em regra de segurança do RTDB. */
/* config do Firebase: fonte ÚNICA no suprema-db.js (SupremaDB.CONFIG) — antes
   duplicada aqui. Ao migrar pro servidor interno, muda só lá. */
/* escape de HTML — nomes de modalidade/tipo vêm do XLSX que o operador sobe;
   sem isso, um rótulo com "<...>" quebraria o render (mesma defesa dos outros painéis). */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const ADMIN_EMAILS=['brian@suprema.group','admin@suprema.group','brian.rodrigues@suprema.group'];
const PBKDF2_ITER=150000;
const eKey=e=>e.toLowerCase().replace(/\./g,'_dot_').replace(/@/g,'_at_');
function bufToHex(buf){return[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function hexToBytes(hex){const bytes=new Uint8Array(hex.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.substr(i*2,2),16);return bytes;}
async function pbkdf2Hash(pw,saltHex){
  saltHex=saltHex||bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const enc=new TextEncoder();
  const keyMat=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:hexToBytes(saltHex),iterations:PBKDF2_ITER,hash:'SHA-256'},keyMat,256);
  return`pbkdf2v2$${PBKDF2_ITER}$${saltHex}$${bufToHex(bits)}`;
}
async function pbkdf2HashLegacySalt(pw,saltHex){
  const enc=new TextEncoder();
  const keyMat=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(saltHex),iterations:PBKDF2_ITER,hash:'SHA-256'},keyMat,256);
  return`pbkdf2$${PBKDF2_ITER}$${saltHex}$${bufToHex(bits)}`;
}
function legacyHash(s){
  let h=5381;
  for(let i=0;i<s.length;i++){h=((h<<5)+h)^s.charCodeAt(i);h|=0;}
  const salt='suprema2024';let h2=h;
  for(let i=0;i<salt.length;i++){h2=((h2<<5)+h2)^salt.charCodeAt(i);h2|=0;}
  return'h2_'+Math.abs(h).toString(36)+'_'+Math.abs(h2).toString(36);
}
async function verifyPassword(pw,storedHash,onMigrate){
  if(!storedHash)return true;
  if(storedHash.startsWith('pbkdf2v2$')){
    const[,,saltHex]=storedHash.split('$');
    return(await pbkdf2Hash(pw,saltHex))===storedHash;
  }
  if(storedHash.startsWith('pbkdf2$')){
    const[,,saltHex]=storedHash.split('$');
    const ok=(await pbkdf2HashLegacySalt(pw,saltHex))===storedHash;
    if(ok&&onMigrate)onMigrate(await pbkdf2Hash(pw));
    return ok;
  }
  const ok=storedHash===legacyHash(pw);
  if(ok&&onMigrate)onMigrate(await pbkdf2Hash(pw));
  return ok;
}
const LOGIN_MAX_ATTEMPTS=5, LOGIN_LOCK_MS=5*60*1000;
function loginLockRemaining(user){if(!user?.loginLockUntil)return 0;return Math.max(0,user.loginLockUntil-Date.now());}

let db=null,fbOk=false,_email='',_name='';
function initFb(){
  try{
    firebase.initializeApp(SupremaDB.CONFIG);db=firebase.database();fbOk=true;
    // progressão do Suprema OS: abrir o Cash Intelligence conta XP na jornada do operador
    try{ SupremaAuth.trackUse('cash'); }catch(e){}
  }
  catch(e){console.error('Firebase init',e);}
}
/* Entrada direta: a sessão do Suprema OS (validada pelo portão no <head>)
   identifica o usuário. Login/senha próprios foram removidos — quem chegou
   até aqui já está logado no hub. */
function enterFromHubSession(){
  let s=null;
  try{s=JSON.parse(localStorage.getItem('suprema_session_v1')||'null');}catch(e){}
  if(!s||!s.email){location.replace('hub.html');return;}
  _email=String(s.email).toLowerCase();
  _name=s.apelido||s.nome||_email.split('@')[0];
  document.getElementById('app').style.display='block';
  const un=document.getElementById('appUserName');if(un)un.textContent=_name;
  startApp();
  // apelido/nome ficam mais bonitos vindos do cadastro, quando o Firebase responder
  if(fbOk&&!s.apelido&&!s.nome){
    db.ref(`users/${eKey(_email)}`).once('value').then(snap=>{
      const u=snap.val();
      if(u&&(u.apelido||u.nome)){
        _name=u.apelido||u.nome;
        if(un)un.textContent=_name;
      }
    }).catch(()=>{});
  }
}
function doLogout(){
  // Sair = voltar pro hub (a sessão é dele; trocar de conta acontece lá)
  location.href='hub.html';
}
/* Firebase agora carrega com `defer`. Deferred rodam depois do parse do body e antes
   do DOMContentLoaded, então esperar esse evento garante que `firebase` já existe. */
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initFb); else initFb();

// Régua GU→BRL: fonte ÚNICA. window.GU_TO_BRL permite sobrescrever por config
// (SupremaDB) sem tocar em dois arquivos; cash-players.js LÊ deste window.
const GU_TO_BRL=(typeof window!=='undefined'&&+window.GU_TO_BRL)||5;
try{ window.GU_TO_BRL=GU_TO_BRL; }catch(_){}

/* ── REGRAS DE MESAS: BIG BLIND / ANTE / BUY-IN → RANGE ──────────────────────
   Mapeamento oficial de todos os tipos de jogos conforme a tabela corrigida.
   Modalidades: OFC, G+NLH (6+), 6+PLO4, Cash NLH (<6), Cash PLO4 (<6), Cash PLO5, MTT/SNG */
const BLIND_RANGES = {
  // OFC, Cash-Game NLH, PLO4, PLO5 (baseado em Big Blind)
  0.01: 'Micro',  0.02: 'Micro',  0.03: 'Micro',  0.04: 'Micro',  0.05: 'Micro',
  0.06: 'Micro',  0.08: 'Micro',  0.1: 'Micro',   0.12: 'Micro',  0.16: 'Low',
  0.2: 'Low',     0.3: 'Low',     0.4: 'Low',     0.5: 'Low',     0.6: 'Medium',
  0.8: 'Medium',  1: 'Medium',    1.2: 'Medium',  1.5: 'Medium',  1.6: 'Medium',
  2: 'Medium',    3: 'High',      4: 'High',      5: 'High',      6: 'High',
  8: 'High',      10: 'High',     15: 'High',     20: 'High',     25: 'High',
  30: 'High',     35: 'High',     40: 'High',     45: 'High',     50: 'High',
  80: 'High',     100: 'High',    200: 'High',    300: 'High',    400: 'High',
  500: 'High',    1000: 'High',   2500: 'High'
};

/* MTT & SNG: Range por buy-in (em reais)
   0-5 = Micro, 5.01-19.8 = Low, 19.81-99.8 = Medium, 99.81+ = High */
function getByBuyinRange(buyin) {
  buyin = +buyin || 0;
  if (buyin <= 5) return 'Micro';
  if (buyin <= 19.8) return 'Low';
  if (buyin <= 99.8) return 'Medium';
  return 'High';
}

/* Determina o range de uma mesa pelo big blind.
   Procura valor exato primeiro; depois o intervalo mais próximo inferior. */
function getBlindRange(bb) {
  bb = +bb || 0;

  // Valor exato na tabela
  if (BLIND_RANGES[bb]) return BLIND_RANGES[bb];

  // Encontra o maior blind que é ≤ ao valor procurado
  const blinds = Object.keys(BLIND_RANGES).map(Number).sort((a,b)=>a-b);
  for (let i = blinds.length - 1; i >= 0; i--) {
    if (blinds[i] <= bb) return BLIND_RANGES[blinds[i]];
  }

  // Se for menor que o menor blind da tabela, retorna Micro
  return 'Micro';
}

/* Cores e estilos por range — consistente em todo o painel */
function getColorByRange(range) {
  const colors = {
    'Micro': { bg:'rgba(52,211,153,.12)', text:'#34d399', border:'rgba(52,211,153,.3)' },   // Verde
    'Low':   { bg:'rgba(79,142,247,.12)', text:'#4f8ef7', border:'rgba(79,142,247,.3)' },   // Azul
    'Medium':{ bg:'rgba(251,191,36,.12)', text:'#fbbf24', border:'rgba(251,191,36,.3)' },   // Âmbar
    'High':  { bg:'rgba(248,113,113,.12)', text:'#f87171', border:'rgba(248,113,113,.3)' }  // Vermelho
  };
  return colors[range] || colors['Micro'];
}
// ══════════════════════════════ DATA
const D = {
  slots30:[{"slot":"00:00","turno":"noite","tables":34,"fee":2006.36,"players":413,"hands":3238,"dead":7},{"slot":"00:30","turno":"noite","tables":19,"fee":866.64,"players":114,"hands":973,"dead":7},{"slot":"01:00","turno":"noite","tables":39,"fee":774.5,"players":278,"hands":2394,"dead":11},{"slot":"01:30","turno":"noite","tables":23,"fee":1840.93,"players":251,"hands":1994,"dead":3},{"slot":"02:00","turno":"noite","tables":26,"fee":317.38,"players":153,"hands":1223,"dead":15},{"slot":"02:30","turno":"noite","tables":26,"fee":227.18,"players":192,"hands":1385,"dead":10},{"slot":"03:00","turno":"noite","tables":22,"fee":1221.79,"players":118,"hands":1338,"dead":11},{"slot":"03:30","turno":"noite","tables":24,"fee":5153.18,"players":335,"hands":2785,"dead":6},{"slot":"04:00","turno":"noite","tables":16,"fee":232.59,"players":129,"hands":1034,"dead":7},{"slot":"04:30","turno":"noite","tables":12,"fee":165.36,"players":97,"hands":737,"dead":3},{"slot":"05:00","turno":"noite","tables":63,"fee":3079.97,"players":1016,"hands":8464,"dead":20},{"slot":"05:30","turno":"noite","tables":11,"fee":758.77,"players":254,"hands":1528,"dead":5},{"slot":"06:00","turno":"noite","tables":6,"fee":678.38,"players":72,"hands":646,"dead":1},{"slot":"06:30","turno":"noite","tables":16,"fee":847.22,"players":149,"hands":1516,"dead":4},{"slot":"07:00","turno":"noite","tables":78,"fee":10787.66,"players":1374,"hands":12103,"dead":12},{"slot":"07:30","turno":"noite","tables":23,"fee":1806.41,"players":360,"hands":3092,"dead":8},{"slot":"08:00","turno":"dia","tables":27,"fee":1543.53,"players":667,"hands":5573,"dead":8},{"slot":"08:30","turno":"dia","tables":38,"fee":832.71,"players":189,"hands":1305,"dead":17},{"slot":"09:00","turno":"dia","tables":118,"fee":16734.66,"players":1523,"hands":12066,"dead":33},{"slot":"09:30","turno":"dia","tables":44,"fee":2465.83,"players":858,"hands":6656,"dead":9},{"slot":"10:00","turno":"dia","tables":55,"fee":3458.72,"players":680,"hands":4955,"dead":20},{"slot":"10:30","turno":"dia","tables":42,"fee":3198.32,"players":421,"hands":3509,"dead":6},{"slot":"11:00","turno":"dia","tables":122,"fee":6966.21,"players":1830,"hands":13955,"dead":31},{"slot":"11:30","turno":"dia","tables":56,"fee":6807.86,"players":653,"hands":6030,"dead":10},{"slot":"12:00","turno":"dia","tables":58,"fee":1401.36,"players":828,"hands":5805,"dead":18},{"slot":"12:30","turno":"dia","tables":73,"fee":3742.18,"players":993,"hands":7943,"dead":18},{"slot":"13:00","turno":"dia","tables":132,"fee":10158.95,"players":1803,"hands":15205,"dead":26},{"slot":"13:30","turno":"dia","tables":60,"fee":1665.91,"players":515,"hands":3776,"dead":20},{"slot":"14:00","turno":"dia","tables":65,"fee":2023.39,"players":653,"hands":4516,"dead":21},{"slot":"14:30","turno":"dia","tables":64,"fee":5289.42,"players":749,"hands":6520,"dead":14},{"slot":"15:00","turno":"dia","tables":122,"fee":6035.11,"players":1092,"hands":7460,"dead":28},{"slot":"15:30","turno":"dia","tables":54,"fee":3637.27,"players":550,"hands":4117,"dead":13},{"slot":"16:00","turno":"dia","tables":89,"fee":4352.6,"players":978,"hands":8154,"dead":23},{"slot":"16:30","turno":"dia","tables":86,"fee":8430.7,"players":1159,"hands":9606,"dead":15},{"slot":"17:00","turno":"dia","tables":122,"fee":10808.45,"players":1681,"hands":12119,"dead":26},{"slot":"17:30","turno":"dia","tables":78,"fee":4565.63,"players":1030,"hands":7789,"dead":18},{"slot":"18:00","turno":"dia","tables":94,"fee":7830.08,"players":1142,"hands":8802,"dead":20},{"slot":"18:30","turno":"dia","tables":79,"fee":3246.5,"players":1377,"hands":10166,"dead":12},{"slot":"19:00","turno":"dia","tables":120,"fee":8433.82,"players":1436,"hands":10244,"dead":35},{"slot":"19:30","turno":"dia","tables":101,"fee":4652.64,"players":1600,"hands":11474,"dead":22},{"slot":"20:00","turno":"noite","tables":73,"fee":4051.8,"players":1175,"hands":7601,"dead":13},{"slot":"20:30","turno":"noite","tables":84,"fee":3903.2,"players":1297,"hands":8870,"dead":13},{"slot":"21:00","turno":"noite","tables":89,"fee":16764.81,"players":1242,"hands":9023,"dead":19},{"slot":"21:30","turno":"noite","tables":83,"fee":5921.28,"players":1090,"hands":7989,"dead":16},{"slot":"22:00","turno":"noite","tables":69,"fee":6726.92,"players":817,"hands":6255,"dead":15},{"slot":"22:30","turno":"noite","tables":75,"fee":2650.23,"players":843,"hands":5737,"dead":15},{"slot":"23:00","turno":"noite","tables":96,"fee":20500.95,"players":1026,"hands":8440,"dead":22},{"slot":"23:30","turno":"noite","tables":59,"fee":1322.23,"players":575,"hands":3944,"dead":20}],
  end30:[{"slot":"00:00","tables":87},{"slot":"00:30","tables":95},{"slot":"01:00","tables":79},{"slot":"01:30","tables":76},{"slot":"02:00","tables":59},{"slot":"02:30","tables":69},{"slot":"03:00","tables":38},{"slot":"03:30","tables":43},{"slot":"04:00","tables":61},{"slot":"04:30","tables":32},{"slot":"05:00","tables":67},{"slot":"05:30","tables":10},{"slot":"06:00","tables":24},{"slot":"06:30","tables":27},{"slot":"07:00","tables":12},{"slot":"07:30","tables":19},{"slot":"08:00","tables":19},{"slot":"08:30","tables":20},{"slot":"09:00","tables":31},{"slot":"09:30","tables":30},{"slot":"10:00","tables":54},{"slot":"10:30","tables":49},{"slot":"11:00","tables":54},{"slot":"11:30","tables":49},{"slot":"12:00","tables":53},{"slot":"12:30","tables":53},{"slot":"13:00","tables":63},{"slot":"13:30","tables":69},{"slot":"14:00","tables":70},{"slot":"14:30","tables":65},{"slot":"15:00","tables":90},{"slot":"15:30","tables":78},{"slot":"16:00","tables":74},{"slot":"16:30","tables":69},{"slot":"17:00","tables":90},{"slot":"17:30","tables":87},{"slot":"18:00","tables":100},{"slot":"18:30","tables":79},{"slot":"19:00","tables":83},{"slot":"19:30","tables":80},{"slot":"20:00","tables":98},{"slot":"20:30","tables":90},{"slot":"21:00","tables":70},{"slot":"21:30","tables":96},{"slot":"22:00","tables":63},{"slot":"22:30","tables":89},{"slot":"23:00","tables":82},{"slot":"23:30","tables":70}],
  concurrent:[{"h":0,"open":53},{"h":1,"open":115},{"h":2,"open":147},{"h":3,"open":148},{"h":4,"open":135},{"h":5,"open":184},{"h":6,"open":140},{"h":7,"open":189},{"h":8,"open":220},{"h":9,"open":338},{"h":10,"open":374},{"h":11,"open":446},{"h":12,"open":466},{"h":13,"open":547},{"h":14,"open":538},{"h":15,"open":576},{"h":16,"open":565},{"h":17,"open":606},{"h":18,"open":580},{"h":19,"open":582},{"h":20,"open":528},{"h":21,"open":433},{"h":22,"open":303},{"h":23,"open":152}],
  gametypes:[{"type":"PLO5","tables":975,"fee":122945,"buyin":1382894,"players":14124,"hands":106243,"avg_dur":3.14,"rake_rate":8.89},{"type":"PLO6","tables":815,"fee":68494,"buyin":976632,"players":9642,"hands":66578,"avg_dur":2.77,"rake_rate":7.01},{"type":"NLH","tables":226,"fee":12955,"buyin":126221,"players":4922,"hands":49396,"avg_dur":4.42,"rake_rate":10.26},{"type":"PLO4","tables":141,"fee":6484,"buyin":70493,"players":3571,"hands":28010,"avg_dur":4.96,"rake_rate":9.2},{"type":"NLH(Swap)","tables":420,"fee":2785,"buyin":51755,"players":2915,"hands":18502,"avg_dur":2.01,"rake_rate":5.38},{"type":"PLO6(DB)","tables":42,"fee":2703,"buyin":18098,"players":871,"hands":6282,"avg_dur":4.17,"rake_rate":14.94},{"type":"6+PLO4","tables":45,"fee":2470,"buyin":22294,"players":604,"hands":5841,"avg_dur":3.51,"rake_rate":11.08},{"type":"OFC","tables":289,"fee":1971,"buyin":34419,"players":985,"hands":7807,"avg_dur":1.61,"rake_rate":5.73}],
  opShift:[{"op":"Mesas S1","turno":"dia","tables":1698,"fee":119188,"players":23813,"dead":387},{"op":"Mesas S1","turno":"noite","tables":931,"fee":88977,"players":12951,"dead":202},{"op":"Mesas S2","turno":"dia","tables":185,"fee":8024,"players":559,"dead":67},{"op":"Mesas S2","turno":"noite","tables":118,"fee":2389,"players":382,"dead":53},{"op":"Mesas S3","turno":"dia","tables":14,"fee":1061,"players":31,"dead":8},{"op":"Mesas S3","turno":"noite","tables":7,"fee":1213,"players":14,"dead":1},{"op":"Mesas P1","turno":"dia","tables":2,"fee":8,"players":4,"dead":1},{"op":"Mesas P1","turno":"noite","tables":10,"fee":27,"players":23,"dead":7}],
  rooms:[{"name":"Golden Cucurucho","tables":188,"fee":34084,"buyin":395696,"players":2011,"hands":17034,"rake_rate":8.61},{"name":"HighStakes HU","tables":12,"fee":25761,"buyin":306275,"players":27,"hands":1408,"rake_rate":8.41},{"name":"MONACO HU","tables":47,"fee":12614,"buyin":198054,"players":137,"hands":2903,"rake_rate":6.37},{"name":"LAS VEGAS","tables":16,"fee":12140,"buyin":108920,"players":36,"hands":1512,"rake_rate":11.15},{"name":"Titan HU","tables":116,"fee":6214,"buyin":116335,"players":258,"hands":3406,"rake_rate":5.34},{"name":"MONACO 20bb","tables":15,"fee":7006,"buyin":105480,"players":106,"hands":922,"rake_rate":6.64},{"name":"CARIBE HU","tables":78,"fee":5440,"buyin":103066,"players":165,"hands":2162,"rake_rate":5.28},{"name":"Golden 20bb","tables":64,"fee":6785,"buyin":101305,"players":518,"hands":4155,"rake_rate":6.7},{"name":"Edge 20bb","tables":134,"fee":7612,"buyin":84957,"players":4087,"hands":27896,"rake_rate":8.96},{"name":"Harmony 20bb","tables":71,"fee":6863,"buyin":84181,"players":1850,"hands":14094,"rake_rate":8.15},{"name":"Golden HU","tables":126,"fee":3663,"buyin":63256,"players":276,"hands":3830,"rake_rate":5.79},{"name":"Home Game","tables":2,"fee":9137,"buyin":44855,"players":4,"hands":115,"rake_rate":20.37},{"name":"MONACO Cucurucho","tables":5,"fee":3566,"buyin":42273,"players":36,"hands":485,"rake_rate":8.44},{"name":"Titan 20bb","tables":7,"fee":3044,"buyin":43969,"players":91,"hands":1097,"rake_rate":6.92},{"name":"MONACO","tables":3,"fee":3149,"buyin":47723,"players":29,"hands":410,"rake_rate":6.6}],
  blinds:[{"bb":0.04,"tables":598,"fee":4333},{"bb":2.0,"tables":399,"fee":48239},{"bb":0.2,"tables":357,"fee":15771},{"bb":0.4,"tables":289,"fee":21598},{"bb":0.8,"tables":209,"fee":13849},{"bb":0.12,"tables":165,"fee":2160},{"bb":1.2,"tables":160,"fee":6443},{"bb":4.0,"tables":129,"fee":11807}],
  duration:[{"bucket":"30-60m","tables":92,"fee":329,"dead":40,"ret":56.5},{"bucket":"1-2h","tables":1206,"fee":17757,"dead":489,"ret":59.5},{"bucket":"2-4h","tables":1079,"fee":89341,"dead":197,"ret":81.7},{"bucket":"4h+","tables":586,"fee":113434,"dead":0,"ret":100.0}],
  top10:[{"name":"Home Game II A(46139796)","type":"PLO5","players":2,"hands":114,"fee":9136.54,"buyin":40855.07,"dur":3.65,"start_h":14},{"name":"HomeGame I Cucurucho(46153561)","type":"PLO5","players":10,"hands":277,"fee":8030.63,"buyin":29001.34,"dur":5.39,"start_h":9},{"name":"HighStakes HU II 1(46156264)","type":"PLO5","players":4,"hands":206,"fee":6291.24,"buyin":80362.93,"dur":3.33,"start_h":16},{"name":"HighStakes HU 1(46133258)","type":"PLO5","players":2,"hands":284,"fee":4486.06,"buyin":26935.47,"dur":3.96,"start_h":11},{"name":"LAS VEGAS HU ANTE(46137184)","type":"PLO5","players":3,"hands":560,"fee":3945.43,"buyin":15060.61,"dur":7.82,"start_h":9},{"name":"LAS VEGAS HU ANTE(46142632)","type":"PLO5","players":5,"hands":444,"fee":3424.7,"buyin":17101.28,"dur":7.59,"start_h":11},{"name":"HighStakes HU 1(46156731)","type":"PLO5","players":3,"hands":181,"fee":2842.75,"buyin":29247.0,"dur":4.58,"start_h":17},{"name":"HighStakes HU 2(46156402)","type":"PLO5","players":2,"hands":161,"fee":2779.01,"buyin":21065.12,"dur":4.3,"start_h":17},{"name":"HighStakes HU(46148172)","type":"PLO6","players":2,"hands":136,"fee":2489.85,"buyin":22150.71,"dur":3.96,"start_h":13},{"name":"MONACO Cucurucho C(46150833)","type":"PLO6","players":21,"hands":299,"fee":2469.42,"buyin":28517.27,"dur":6.24,"start_h":10}],
  tiers:[{"tier":"Micro","tables":703,"fee":4445,"buyin":56727,"players":12184,"hands":78525,"dead":114,"ret_pct":83.8,"avg_fph":0.0452,"avg_fpp":0.27,"avg_bpp":3.8,"rake_rate":7.84},{"tier":"Low","tables":809,"fee":22824,"buyin":254491,"players":13790,"hands":100694,"dead":174,"ret_pct":78.5,"avg_fph":0.1624,"avg_fpp":1.07,"avg_bpp":16.3,"rake_rate":8.97},{"tier":"Mid","tables":561,"fee":36683,"buyin":445697,"players":7032,"hands":59099,"dead":161,"ret_pct":71.3,"avg_fph":0.4529,"avg_fpp":3.57,"avg_bpp":66.7,"rake_rate":8.23},{"tier":"High","tables":688,"fee":66489,"buyin":883198,"players":4059,"hands":39836,"dead":202,"ret_pct":70.6,"avg_fph":1.3207,"avg_fpp":13.27,"avg_bpp":220.9,"rake_rate":7.53},{"tier":"VHigh","tables":199,"fee":90412,"buyin":1042915,"players":641,"hands":11177,"dead":74,"ret_pct":62.8,"avg_fph":5.0975,"avg_fpp":148.15,"avg_bpp":1734.7,"rake_rate":8.67}],
  fpp:[{"type":"PLO5","fpp":32.87,"tables":796},{"type":"PLO6","fpp":20.66,"tables":572},{"type":"PLO6(DB)","fpp":8.85,"tables":35},{"type":"6+PLO4","fpp":7.64,"tables":42},{"type":"NLH(Swap)","fpp":3.10,"tables":253},{"type":"NLH","fpp":2.89,"tables":205},{"type":"OFC","fpp":2.65,"tables":201},{"type":"PLO4","fpp":2.22,"tables":124}]
};

const KPI_DEMO={
  feeGross:220888,feeNet:202645,feeDia:128282,feeNoite:92606,tablesDia:1899,tablesNoite:1066,
  buyinTotal:2683388,takeRate:8.23,deadTables:726,deadPct:24.5,deadDia:463,deadNoite:263,
  conc1pct:32.6,conc1Fee:72087,conc1Tables:29,conc5pct:59.4,conc5Fee:131300,conc5Tables:148,
  conc10pct:74.5,conc10Fee:164481,conc10Tables:296,conc20pct:88.4,conc20Fee:195346,conc20Tables:593,
  feePerHand:0.76,feePerHandDia:0.68,feePerHandNoite:0.91,jackpot:18242,jackpotPct:8.3,jackpotTables:1054,
  feePerActiveTable:98.7,peakConcurrent:606,peakHour:'17h',bestSlot:'23:00',bestSlotEff:53.9,
  crossShift:570,crossShiftPct:19.2,sessions:2965,playersTotal:37777,
  huTables:1135,huFee:51199,huFph:1.025,huRet:45.0,huBpp:313.6,huHph:11.5,
  multiTables:1830,multiFee:169689,multiFph:0.643,multiRet:94.4,multiBpp:106.3,multiHph:33.1,
  anteTables:458,anteFee:63959,anteFph:1.847,anteRet:72.1,noAnteTables:2507,noAnteFee:156928,noAnteFph:0.596,noAnteRet:76.1,
  feeRateB:[{r:'0–3%',t:840,fee:3318},{r:'3–6%',t:649,fee:20389},{r:'6–9%',t:749,fee:78355},{r:'9–12%',t:502,fee:56880},{r:'12%+',t:225,fee:61945}],
  tables4hPlus:586,fee4hPlus:113433,fee4hPct:51.4,tablesMoreThan100:887,tablesMoreThan500:84,
  multiRetTables:1727,handsPerHourP50:32.0,handsPerHourP25:17.9,handsPerHourP90:52.0,
  date:'22/06/2026'
};

/* ── NORMALIZA TODOS OS DADOS ──
   Aplica conversão GU→BRL e enriquece com ranges de forma consistente */
function normalizeAllData() {
  // Conversão GU→BRL
  D.gametypes.forEach(g=>{g.fee*=GU_TO_BRL;g.buyin*=GU_TO_BRL;});
  D.opShift.forEach(o=>o.fee*=GU_TO_BRL);
  D.rooms.forEach(r=>{r.fee*=GU_TO_BRL;r.buyin*=GU_TO_BRL;});
  D.blinds.forEach(b=>{b.fee*=GU_TO_BRL;b.range=getBlindRange(b.bb);});
  D.duration.forEach(x=>x.fee*=GU_TO_BRL);
  D.top10.forEach(x=>{x.fee*=GU_TO_BRL;x.buyin*=GU_TO_BRL;});
  D.tiers.forEach(t=>{
    t.fee*=GU_TO_BRL;t.buyin*=GU_TO_BRL;t.avg_fph*=GU_TO_BRL;t.avg_fpp*=GU_TO_BRL;t.avg_bpp*=GU_TO_BRL;
    // Map tier names to ranges: Micro→Micro, Low→Low, Mid→Medium, High/VHigh→High
    const tierToRange = {'Micro':'Micro','Low':'Low','Mid':'Medium','High':'High','VHigh':'High'};
    t.range = tierToRange[t.tier] || 'Medium';
    t.color = getColorByRange(t.range);
  });
  D.fpp.forEach(x=>x.fpp*=GU_TO_BRL);

  // KPI_DEMO: enriquecer com ranges também
  Object.keys(KPI_DEMO).forEach(k=>{
    if(/fee|buyin|jackpot/.test(k)&&typeof KPI_DEMO[k]==='number') KPI_DEMO[k]*=GU_TO_BRL;
  });
  if(KPI_DEMO.feeRateB) KPI_DEMO.feeRateB.forEach(x=>x.fee*=GU_TO_BRL);

  // Slots (timeline)
  D.slots30.forEach(s=>s.fee*=GU_TO_BRL);
}

normalizeAllData();

/* ── AUDITORIA: Validar consistência de dados entre visualizações ──
   Calcula totais e compara se batem. Log de erros se encontrar divergências. */
function auditDataConsistency() {
  const audit = {
    errors: [],
    warnings: [],
    summary: {}
  };

  // Total geral: soma de todas as mesas
  const totalTables = D.tiers.reduce((s,t)=>s+t.tables,0);
  const totalFee = D.tiers.reduce((s,t)=>s+t.fee,0);
  const totalPlayers = D.tiers.reduce((s,t)=>s+t.players,0);

  audit.summary = { totalTables, totalFee, totalPlayers };

  // Auditoria por componente
  const tierTables = D.tiers.reduce((s,t)=>s+t.tables,0);
  const blindTables = D.blinds.reduce((s,b)=>s+b.tables,0);
  const roomTables = D.rooms.reduce((s,r)=>s+r.tables,0);
  const gameTypeTables = D.gametypes.reduce((s,g)=>s+g.tables,0);

  // Verifica se os totais de mesas batem
  if (Math.abs(tierTables - blindTables) > 1)
    audit.errors.push(`⚠️ Mesas: Tiers (${tierTables}) ≠ Blinds (${blindTables})`);
  if (Math.abs(tierTables - roomTables) > 1)
    audit.errors.push(`⚠️ Mesas: Tiers (${tierTables}) ≠ Rooms (${roomTables})`);

  // Verifica fees
  const tierFee = D.tiers.reduce((s,t)=>s+t.fee,0);
  const blindFee = D.blinds.reduce((s,b)=>s+b.fee,0);
  const roomFee = D.rooms.reduce((s,r)=>s+r.fee,0);
  const gameTypeFee = D.gametypes.reduce((s,g)=>s+g.fee,0);

  if (Math.abs(tierFee - blindFee) > 100)
    audit.errors.push(`⚠️ Fee: Tiers (${Math.round(tierFee)}) ≠ Blinds (${Math.round(blindFee)})`);
  if (Math.abs(tierFee - roomFee) > 100)
    audit.errors.push(`⚠️ Fee: Tiers (${Math.round(tierFee)}) ≠ Rooms (${Math.round(roomFee)})`);

  // Verifica ranges
  D.tiers.forEach(t => {
    if (!t.range) audit.warnings.push(`⚠️ Tier ${t.tier} sem range atribuído`);
  });
  D.blinds.forEach(b => {
    if (!b.range) audit.warnings.push(`⚠️ Blind ${b.bb} sem range atribuído`);
  });

  if (audit.errors.length === 0) audit.summary.status = '✅ Dados consistentes';
  else audit.summary.status = '❌ Inconsistências detectadas';

  // Log para debug
  console.log('📊 Auditoria de dados:', audit);
  return audit;
}

// Roda auditoria ao inicializar
const AUDIT = auditDataConsistency();

/* ── DEBUG: Diagnóstico de carregamento de semanas ──
   Chame window.diagWeeks() no console (F12) para ver se as semanas estão sendo carregadas */
window.diagWeeks = async function(){
  const results = {
    fbOk,
    dbConnected: !!db,
    rawsCacheSize: Object.keys(_rawsCache).length,
    rawsCacheKeys: Object.keys(_rawsCache),
    firebaseData: null,
    error: null
  };

  console.log('🔍 Diagnóstico de semanas:');
  console.log('✓ Firebase OK:', fbOk);
  console.log('✓ DB conectado:', !!db);

  // Tenta buscar direto do Firebase
  if(fbOk && db){
    try{
      const rev = (await db.ref(RTDB_REV).once('value')).val();
      console.log('✓ RTDB_REV:', rev);

      const data = (await db.ref(RTDB_DATA).once('value')).val();
      const keys = data ? Object.keys(data) : [];
      console.log(`✓ RTDB_DATA tem ${keys.length} semanas:`, keys);
      results.firebaseData = keys;

      // Tenta hidratar o primeiro
      if(keys.length > 0){
        const firstRaw = fbUnpack(data[keys[0]]);
        console.log('✓ Primeiro dia hidratado:', firstRaw ? 'SIM' : 'NÃO');
      }
    }catch(e){
      console.error('❌ Erro ao buscar Firebase:', e.message);
      results.error = e.message;
    }
  }

  // Verifica localStorage
  const localRaws = JSON.parse(localStorage.getItem('cashRaws')||'{}');
  console.log(`✓ localStorage tem ${Object.keys(localRaws).length} semanas`);

  // Verifica _rawsCache
  console.log(`✓ _rawsCache tem ${Object.keys(_rawsCache).length} semanas:`, Object.keys(_rawsCache));

  return results;
};

// Roda diagnóstico automaticamente e mostra alerta se necessário
async function runAutodiag(){
  try{
    const diag = await window.diagWeeks();
    const hasWeeks = diag.rawsCacheSize > 0 || (diag.firebaseData && diag.firebaseData.length > 0);

    if(!hasWeeks){
      const msg = diag.error
        ? `❌ Erro ao conectar Firebase: ${diag.error}. Tente recarregar a página.`
        : '⚠️ Nenhuma semana encontrada! Suba uma semana via "Importar Semana" ou verifique a conexão com Firebase.';
      console.warn(msg);

      // Mostra alerta visual na página
      const alert = document.createElement('div');
      alert.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#fff3cd;border:2px solid #ffc107;border-radius:8px;padding:16px 24px;max-width:500px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:14px;color:#856404;';
      alert.innerHTML = `<strong>⚠️ Problema de carregamento:</strong><br>${msg.replace(/❌|⚠️/g, '').trim()}`;
      document.body.appendChild(alert);
    }
  }catch(e){
    console.error('Autodiag erro:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(runAutodiag, 2500);  // Espera 2.5s pro Firebase carregar
});

/* ── MAPA DE INTEGRIDADE: Qual visualização usa qual dados ──
   Referência central para garantir que cada gráfico/tabela usa a fonte correta.

   REGRA: Não somar tiers + blinds + rooms (são dimensões diferentes do MESMO volume)
          Somar SIM: tiers.reduce(t=>t.fee) = volume total ✓
*/
const DATA_MAP = {
  'Timeline (slots30)': { source: 'D.slots30', aggregation: 'Por slot de 30min', metric: 'fee, tables' },
  'Concurrent Tables': { source: 'D.concurrent', aggregation: 'Por hora', metric: 'tables simultâneas' },
  'Tier Chart (Fee/Mão)': { source: 'D.tiers', aggregation: 'Por stake tier', metric: 'fee, avg_fph' },
  'Concentration': { source: 'D.tiers', aggregation: 'Top 1%/5%/10%/20%', metric: 'fee distribution' },
  'Blind Bars': { source: 'D.blinds', aggregation: 'Por big blind', metric: 'tables, fee' },
  'Rooms Table': { source: 'D.rooms', aggregation: 'Por sala', metric: 'tables, fee, rake_rate' },
  'Game Types': { source: 'D.gametypes', aggregation: 'Por modalidade', metric: 'tables, fee, rake_rate' },
  'Resumo/KPIs': { source: 'KPI_DEMO + D.tiers.reduce()', aggregation: 'Agregado geral', metric: 'feeGross, sessions' },
  'Top 10': { source: 'D.top10', aggregation: 'Mesas individuais top fee', metric: 'fee, players' },
  'FPP': { source: 'D.fpp', aggregation: 'Por tipo de jogo', metric: 'fee/player' },
};

console.log('📋 Mapa de integridade:', DATA_MAP);

// ══════════════════════════════ HELPERS
// (shiftOf definido logo abaixo; a normalização de turnos roda após ele)
const f=(n,d=0)=>n==null?'—':Number(n).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const fK=n=>n>=1e6?f(n/1e6,1)+' mi':n>=1e3?f(n/1e3,1)+' mil':f(n,0);
const fKR=n=>'R$ '+fK(n);
/* TURNOS operacionais: Dia 07h–19h · Noite 19h–07h. Tudo deriva desta função —
   os slots de 30min têm o turno recalculado abaixo e os totais de turno são
   somados a partir deles, então mudar a fronteira aqui propaga pro dashboard todo. */
const shiftOf=h=>(h>=7&&h<19)?'dia':'noite';
/* Normaliza TODA a divisão de turno a partir de shiftOf (fonte única). Os slots de
   30min recebem o turno recalculado e os totais/percentuais de turno são somados
   deles — assim a fronteira 07/19 vale no dashboard inteiro sem números soltos. */
D.slots30.forEach(s=>{ s.turno=shiftOf(parseInt(s.slot,10)); });
(function recomputeShiftTotals(){
  let fd=0,fn=0,td=0,tn=0,dd=0,dn=0;
  D.slots30.forEach(s=>{ if(s.turno==='dia'){fd+=s.fee;td+=s.tables;dd+=s.dead;} else {fn+=s.fee;tn+=s.tables;dn+=s.dead;} });
  KPI_DEMO.feeDia=Math.round(fd); KPI_DEMO.feeNoite=Math.round(fn);
  KPI_DEMO.tablesDia=td; KPI_DEMO.tablesNoite=tn;
  KPI_DEMO.deadDia=dd; KPI_DEMO.deadNoite=dn;
  const tot=fd+fn||1;
  KPI_DEMO.feeDiaPct=+(fd/tot*100).toFixed(1);
  KPI_DEMO.feeNoitePct=+(fn/tot*100).toFixed(1);
})();
/* Snapshot do dia de DEMONSTRAÇÃO (já em BRL, turnos normalizados). É o dataset
   base do seletor "Demonstração"; datasets reais importados substituem o conteúdo
   de KPI_DEMO/D em runtime via applyDataset(), então guardamos a demo intacta. */
const DEMO_DS={kpi:JSON.parse(JSON.stringify(KPI_DEMO)), d:JSON.parse(JSON.stringify(D))};
const tagCls=t=>t.startsWith('PLO')?'tp':t.startsWith('NLH')?'tn':t==='OFC'?'to':'t6';
const CTOP={backgroundColor:'#181b19',titleColor:'#f2ede2',bodyColor:'rgba(242,237,226,.6)',padding:10,cornerRadius:8,borderColor:'rgba(242,237,226,.1)',borderWidth:1};
/* Cores neutras dos gráficos em CINZA MÉDIO — os gráficos são criados uma vez e o
   tema alterna em runtime, então valores quase-brancos sumiam no modo claro. Cinza
   médio é legível tanto no fundo escuro quanto no claro. */
const CGRID='rgba(130,132,142,.16)';
const CTEXT='rgba(120,122,134,.92)';
const CTXTB='rgba(96,98,110,.95)';   /* variante forte p/ rótulos de eixo em destaque */
const CMUTE='rgba(130,132,142,.32)'; /* preenchimento neutro de barras/fatias de baixo valor */

// ══════════════════════════════ ICON HELPER
const ic=(name,fill)=>`<i class="ph${fill?'-fill':''} ph-${name}"></i>`;

// ══════════════════════════════ CONFIABILIDADE + ALERTAS PROATIVOS
// Limite de mesas perdidas que dispara alerta. Configurável (localStorage), com
// padrão 25% — acima disso a operação está sangrando rake por ociosidade.
const DEAD_ALERT_PCT=(()=>{ const v=parseFloat(localStorage.getItem('cashDeadAlertPct')); return isFinite(v)&&v>0?v:25; })();
// Turnos: fonte única do corte é shiftOf (07–19 dia / 19–07 noite), atribuído
// pelo horário de INÍCIO da mesa — mesma regra no demo e nos dias importados.
const SHIFT_NOTE='Turnos: Dia 07h–19h · Noite 19h–07h · atribuído pelo horário de início da mesa.';
// Banner de alerta reutilizável (Resumo = dia · Médias = semana). Só aparece
// quando o % de mortas passa do limite; mostra o rake parado e a ação de maior ROI.
function deadAlertHtml(deadPct,lostRake,scope){
  const goal=goalDeadPct();
  if(!(Number(deadPct)>goal))return '';
  return `<div class="card" style="border:1px solid var(--red);background:rgba(248,113,113,.09);margin-bottom:12px;display:flex;align-items:center;gap:12px;padding:12px 14px">
    <div style="font-size:24px;color:var(--red);line-height:1">${ic('warning-octagon',1)}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:800;color:var(--ink)">Alerta — mesas perdidas em ${f(deadPct,1)}% ${scope}, acima da meta de ${f(goal,1)}% (${f(deadPct-goal,1)} pp)</div>
      <div style="font-size:10.5px;color:var(--ink2);margin-top:1px">${lostRake?`~R$ ${f(lostRake,0)} de rake parado. `:''}Fechar mesa ociosa mais rápido e realocar dealer é a ação de maior ROI agora — sem gasto em aquisição.</div>
    </div>
  </div>`;
}
// ── METAS DO CLUBE ──────────────────────────────────────────────────────
// Nó Firebase SEPARADO das planilhas: `mesasCashGoals` guarda só os alvos
// (ex.: mortas ≤ 20%). Subir relatório NÃO toca aqui, e editar meta NÃO toca
// nos dados — caminhos independentes. Compartilhado entre todos os painéis;
// cai p/ localStorage se o Firebase estiver fora. O alerta passa a usar a meta.
const GOALS_NODE='mesasCashGoals';
// Metas independentes: mortas (teto), fee bruto/dia (piso), take rate (piso).
// Retenção é o inverso de mortas (100−dead), então não vira meta separada p/ não
// criar alvos contraditórios. 0 = meta não definida.
const GOALS_DEFAULT={deadPct:20, feeDia:0, takeRate:8};
let GOALS=Object.assign({},GOALS_DEFAULT);
async function loadGoals(){
  let g=null;
  try{ const l=localStorage.getItem('cashGoals'); if(l)g=JSON.parse(l); }catch(_){}
  if(fbOk&&db){ try{ const v=(await db.ref(GOALS_NODE).once('value')).val(); if(v)g=v; }catch(e){ console.error('loadGoals',e); } }
  GOALS=Object.assign({},GOALS_DEFAULT,g||{});
  return GOALS;
}
async function saveGoals(patch){
  GOALS=Object.assign({},GOALS,patch);
  try{ localStorage.setItem('cashGoals',JSON.stringify(GOALS)); }catch(_){}
  if(fbOk&&db){ try{ await db.ref(GOALS_NODE).update(Object.assign({},patch,{updatedAt:Date.now(),updatedBy:_email||''})); }catch(e){ console.error('saveGoals',e); } }
  return GOALS;
}
const goalDeadPct=()=>{ const v=GOALS&&+GOALS.deadPct; return isFinite(v)&&v>0?v:DEAD_ALERT_PCT; };

// Detector de anomalia de dados (moeda/escala trocada, take rate impossível).
// Um dia em GU no meio de dias em BRL fica ~5× fora da mediana → sinaliza erro
// de import antes de contaminar tendência e média. Retorna motivo ou ''.
function dataAnomaly(day, medianFee, nDays){
  const fee=+day.fee||0, tr=+day.takeRate||0;
  if(tr>0 && (tr<1 || tr>30)) return `take rate ${f(tr,1)}% fora da faixa plausível (1–30%)`;
  if(nDays>=3 && medianFee>0){
    const r=fee/medianFee;
    if(r>2.6) return `fee ${f(r,1)}× a mediana — possível dia em GU (não convertido) ou duplicado`;
    if(r<0.38) return `fee ${f(r,2)}× a mediana — possível escala trocada ou dia parcial`;
  }
  return '';
}

// ══════════════════════════════ INTEL CARD RENDERER (shared by recs/fcIntel)
function renderIntelCards(elId,cards){
  const el=document.getElementById(elId);if(!el)return;
  el.innerHTML=cards.map(c=>`
    <div class="intel ${c.type}">
      <div class="intel-header">
        <span class="intel-icon">${c.icon}</span>
        <span class="intel-tag ${c.type}">${c.tag}</span>
      </div>
      <div class="intel-title">${c.title}</div>
      <div class="intel-body">${c.body}</div>
      ${c.metric?`<div class="intel-metric">
        <span class="intel-metric-val ${c.metric.cls}">${c.metric.val}</span>
        <span class="intel-metric-label">${c.metric.label}</span>
      </div>`:''}
      ${c.compare?`<div class="intel-compare">
        <div class="intel-cmp-col">
          <div class="intel-cmp-label ${c.compare.left.label}">${c.compare.left.label==='dia'?ic('sun',1)+' Dia':c.compare.left.label==='noite'?ic('moon-stars',1)+' Noite':c.compare.left.label}</div>
          <div class="intel-cmp-val">${c.compare.left.val}</div>
          <div class="intel-cmp-sub">${c.compare.left.sub}</div>
        </div>
        <div style="width:1px;background:var(--bdr)"></div>
        <div class="intel-cmp-col">
          <div class="intel-cmp-label ${c.compare.right.label}">${c.compare.right.label==='dia'?ic('sun',1)+' Dia':c.compare.right.label==='noite'?ic('moon-stars',1)+' Noite':c.compare.right.label}</div>
          <div class="intel-cmp-val">${c.compare.right.val}</div>
          <div class="intel-cmp-sub">${c.compare.right.sub}</div>
        </div>
      </div>`:''}
      <span class="intel-action ${c.action.cls}">${ic('arrow-right')} ${c.action.text}</span>
    </div>`).join('');
}

// ══════════════════════════════ THEME TOGGLE
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  const btn=document.getElementById('themeToggle');
  if(btn)btn.innerHTML=t==='light'?'<i class="ph ph-sun"></i>':'<i class="ph ph-moon"></i>';
}
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')==='light'?'dark':'light';
  localStorage.setItem('theme',cur);
  // mesma chave dos outros produtos do Suprema OS ('1' = escuro)
  localStorage.setItem('suprema_dark_mode', cur==='dark'?'1':'0');
  applyTheme(cur);
}
// preferência compartilhada do Suprema OS primeiro; depois a antiga local; depois o sistema
const supDark = localStorage.getItem('suprema_dark_mode');
applyTheme(supDark!==null ? (supDark==='1'?'dark':'light')
  : localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));
// ecossistema: tema trocado em outro painel/aba reflete aqui na hora
window.addEventListener('storage', e => {
  if (e.key !== 'suprema_dark_mode' || e.newValue === null) return;
  applyTheme(e.newValue === '1' ? 'dark' : 'light');
});

// ══════════════════════════════ SHIFT DETECT
// Chip de turno ao vivo REMOVIDO (divisão por turno descontinuada). Mantido como
// no-op porque applyDataset ainda o chamava; o elemento #shiftChip não existe mais.
function detectShift(){}

// ══════════════════════════════ PAGE NAV
function pg(id,btn){
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nt').forEach(b=>b.classList.remove('on'));
  const page=document.getElementById('pg-'+id);
  page.classList.add('on');
  if(btn)btn.classList.add('on');
  // Os gráficos são todos criados de uma vez com as páginas ocultas (display:none),
  // então o Chart.js os mede com largura 0. Ao revelar a página, forçamos um resize
  // pra cada canvas remedir o container agora visível — sem isso a troca de aba fazia
  // os gráficos "pularem"/reanimarem torto. Dois rAF: espera o layout assentar.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    page.querySelectorAll('canvas').forEach(cv=>{
      const ch=(window.Chart&&Chart.getChart)?Chart.getChart(cv):null;
      if(ch)ch.resize();
    });
  }));
  page.scrollTop=0;
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
  try{refreshNoData();}catch(e){}   // mostra/esconde o estado-vazio conforme a aba
}

// ══════════════════════════════ TIMELINE
function buildTimeline(){
  const el=document.getElementById('timeline');
  const max=Math.max(...D.slots30.map(s=>s.fee));
  let ax='<div class="tl-axis">';
  for(let h=0;h<24;h+=2)ax+=`<span>${String(h).padStart(2,'0')}h</span>`;
  ax+='</div>';
  let band='<div class="tl-band">';
  D.slots30.forEach(s=>{
    const p=s.fee/max;
    const a=Math.max(0.06,p*0.94+0.06);
    const c=`rgba(212,168,83,${a.toFixed(2)})`;   // intensidade de rake (dourado), sem divisão por turno
    const tt=`${s.slot} · R$ ${f(s.fee,0)} · ${s.tables} mesas · ${s.players} players`;
    band+=`<div class="tl-seg" style="background:${c}" title="${tt}"></div>`;
  });
  band+='</div>';
  el.innerHTML=ax+band;
}

// ══════════════════════════════ HOUR CHART (MELHORIA #2: Fee vs Meta)
let hrC;
function buildHrChart(){
  // recomputa por hora a partir do D ATIVO (recalculado a cada troca de dataset)
  const hrByH={};
  D.slots30.forEach(s=>{const h=parseInt(s.slot);if(!hrByH[h]){hrByH[h]={fee:0,players:0,hands:0,tables:0,concurrent:0}}hrByH[h].fee+=s.fee;hrByH[h].players+=s.players;hrByH[h].hands+=s.hands;hrByH[h].tables+=s.tables;});
  D.concurrent.forEach(c=>{if(hrByH[c.h])hrByH[c.h].concurrent=c.open;});

  // Calcula meta por hora baseado em média histórica
  const totalFee = Object.values(hrByH).reduce((a,v)=>a+v.fee,0)||1;
  const hrLabels=[],hrFee=[],hrMeta=[],hrPl=[],hrHd=[],hrTb=[],hrCc=[],hrBg=[],hrBd=[];
  const avgHourlyFee = totalFee / 24;
  for(let h=0;h<24;h++){
    hrLabels.push(String(h).padStart(2,'0')+'h');
    const d=hrByH[h]||{fee:0,players:0,hands:0,tables:0,concurrent:0};
    hrFee.push(d.fee);
    hrPl.push(d.players);
    hrHd.push(d.hands);
    hrTb.push(d.tables);
    hrCc.push(d.concurrent);
    // Meta = média horária (pode ser customizada depois)
    hrMeta.push(avgHourlyFee);
    // Cor: verde se acima, ambar se dentro de 20%, vermelho se abaixo
    const perf = d.fee / (avgHourlyFee || 1);
    hrBg.push(perf>=0.9?'rgba(212,168,83,.22)':perf>=0.7?'rgba(251,191,36,.15)':'rgba(248,113,113,.12)');
    hrBd.push(perf>=0.9?'#d4a853':perf>=0.7?'#fbbf24':'#f87171');
  }
  hrC=new Chart(document.getElementById('cHour'),{
    type:'bar',
    data:{labels:hrLabels,datasets:[
      {type:'line',label:'Meta',data:hrMeta,borderColor:'#a78bfa',borderWidth:2,tension:.4,fill:false,pointRadius:0,pointHoverRadius:4,yAxisID:'y',order:0,borderDash:[4,2]},
      {type:'line',label:'Real',data:hrFee,borderColor:CTXTB,borderWidth:1.5,tension:.4,fill:false,pointRadius:0,pointHoverRadius:4,yAxisID:'y',order:1},
      {type:'bar',data:hrFee,backgroundColor:hrBg,borderColor:hrBd,borderWidth:1,borderRadius:4,yAxisID:'y',order:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:8}},tooltip:{...CTOP,callbacks:{title:c=>c[0].label,label:c=>{if(c.datasetIndex===0)return ` Meta: R$ ${f(c.parsed.y,0)}`;if(c.datasetIndex===1)return ` Real: R$ ${f(c.parsed.y,0)}`;return '';},afterBody:c=>{const real=hrFee[c[0].dataIndex],meta=hrMeta[c[0].dataIndex],delta=(real/meta-1)*100;return [`Desempenho: ${delta>=0?'+':''}${f(delta,0)}%`];}}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT,maxRotation:0,callback:(v,i)=>i%3===0?hrLabels[i]:''},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}}}
    }
  });
  window._hrData={fee:hrFee,players:hrPl,hands:hrHd,tables:hrTb,concurrent:hrCc,meta:hrMeta};
}
function swHr(m,el){
  document.querySelectorAll('.chtab').forEach(t=>t.classList.remove('on'));el.classList.add('on');
  const d=window._hrData[m];
  hrC.data.datasets[0].data=m==='meta'?window._hrData.meta:m==='fee'?window._hrData.fee:m==='players'?window._hrData.players:m==='hands'?window._hrData.hands:m==='concurrent'?window._hrData.concurrent:window._hrData.tables;
  hrC.data.datasets[1].data=m==='meta'?window._hrData.meta:m==='fee'?window._hrData.fee:m==='players'?window._hrData.players:m==='hands'?window._hrData.hands:m==='concurrent'?window._hrData.concurrent:window._hrData.tables;
  hrC.options.plugins.tooltip.callbacks.label = m==='meta' ? c=>`Meta: R$ ${f(c.parsed.y,0)}` : c=>{const label=m.charAt(0).toUpperCase()+m.slice(1);return ` ${label}: ${f(c.parsed.y,0)}`;};
  hrC.update();
}

// ══════════════════════════════ LIFECYCLE (com Tooltips)
function buildLifecycle(){
  new Chart(document.getElementById('cLife'),{
    type:'bar',
    data:{labels:D.slots30.map(s=>s.slot),datasets:[
      {type:'bar',label:'Abertas',data:D.slots30.map(s=>s.tables),backgroundColor:'rgba(212,168,83,.28)',borderColor:'#d4a853',borderWidth:1,borderRadius:3},
      {type:'line',label:'Encerradas',data:D.end30.map(s=>s.tables),borderColor:'#f87171',borderWidth:1.5,tension:.4,fill:false,pointRadius:0,pointHoverRadius:4}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10,usePointStyle:true}},tooltip:{...CTOP,callbacks:{title:c=>c[0].label,label:c=>{const s=D.slots30[c[0].dataIndex];if(c.datasetIndex===0)return ` Abertas: ${c.parsed.y}`;return ` Encerradas: ${D.end30[c[0].dataIndex].tables}`;},afterBody:c=>{const s=D.slots30[c[0].dataIndex];return [`Taxa mortas: ${(s.dead/Math.max(1,s.tables)*100).toFixed(1)}%`];}}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:8},color:CTEXT,maxRotation:0,callback:(v,i)=>i%4===0?D.slots30[i].slot:''},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ MODAL (com Tooltips)
function buildModal(){
  const d=D.gametypes.slice(0,8);
  const cols=['#4f8ef7','#a78bfa','#34d399','#fbbf24','#f87171','#f472b6','#60a5fa','#c084fc'];
  new Chart(document.getElementById('cModal'),{
    type:'bar',
    data:{labels:d.map(x=>x.type),datasets:[{label:'Fee',data:d.map(x=>x.fee),backgroundColor:cols,borderRadius:5,borderSkipped:false}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{title:c=>c[0].label,label:c=>{const gt=d[c.dataIndex];return [` Fee: R$ ${f(c.parsed.x,0)}`,` Mesas: ${gt.tables}`,` Rake rate: ${gt.rake_rate}%`];},afterBody:c=>{const gt=d[c[0].dataIndex];return [`Players: ${f(gt.players)}`,`Hands: ${f(gt.hands)}`];}}}},
      scales:{x:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}},y:{grid:{display:false},ticks:{font:{size:10},color:CTXTB,font:{weight:'700'}},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ OPERATORS (com Tooltips)
function buildOpDiv(){
  // Ranking ÚNICO por operador/sala (sem split de turno): agrega D.opShift por op.
  const ops=['Mesas S1','Mesas S2','Mesas S3','Mesas P1'];
  const total=D.opShift.reduce((a,b)=>a+b.fee,0)||1;
  const feeOf=op=>D.opShift.filter(x=>x.op===op).reduce((a,b)=>a+b.fee,0);
  const maxFee=Math.max(1,...ops.map(feeOf));
  document.getElementById('opDiv').innerHTML=ops.map(op=>{
    const rows=D.opShift.filter(x=>x.op===op);
    const fee=rows.reduce((a,b)=>a+b.fee,0);
    const tables=rows.reduce((a,b)=>a+b.tables,0);
    const dead=rows.reduce((a,b)=>a+b.dead,0);
    if(!fee)return'';
    const opTip = tip(op, 'R$ '+f(fee,0), [trow('Mesas', tables), trow('Mesas mortas', dead), trow('% do total', (fee/total*100).toFixed(1)+'%'), trow('Fee/mesa', 'R$ '+f(fee/Math.max(1,tables),0))]);
    return`<div class="pb" style="margin-bottom:14px;cursor:help" data-tip="${opTip}">
      <div class="pb-top"><span class="pb-t">${op}</span><span class="pb-s">R$ ${f(fee,0)} · ${(fee/total*100).toFixed(1)}%</span></div>
      <div style="height:8px;border-radius:4px;overflow:hidden;background:rgba(130,132,142,.18)">
        <div style="width:${(fee/maxFee*100).toFixed(1)}%;height:100%;background:var(--gold);border-radius:4px;min-width:2px"></div>
      </div>
      <div style="font-size:8px;color:var(--ink3);margin-top:3px">${f(tables)} mesas</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════ TOP 10
function buildTop10(){
  const t=document.getElementById('top10t');
  t.innerHTML=`<thead><tr><th>#</th><th>Sessão</th><th>Tipo</th><th class="r">Players</th><th class="r">Mãos</th><th class="r">Dur.</th><th class="r">Buyin R$</th><th class="r">Fee R$</th><th class="r">Take rate</th></tr></thead><tbody>`+
  D.top10.map((r,i)=>{
    const tr=(r.fee/r.buyin*100).toFixed(1);
    const trc=tr>15?'var(--red)':tr>10?'var(--amber)':'var(--green)';
    return`<tr>
      <td><span class="rk">${i+1}</span></td>
      <td class="b" style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</td>
      <td><span class="tag ${tagCls(r.type)}">${r.type}</span></td>
      <td class="r m">${r.players}</td><td class="r m">${f(r.hands)}</td>
      <td class="r m">${r.dur.toFixed(1)}h</td><td class="r m">${f(r.buyin,0)}</td>
      <td class="r b">${f(r.fee,2)}</td>
      <td class="r"><span style="color:${trc};font-weight:700;font-size:11px">${tr}%</span></td>
    </tr>`;
  }).join('')+'</tbody>';
}

// ══════════════════════════════ RECS
// ══════════════════════════════ RECOMMENDATION ENGINE (Overview)
// Cada recomendação só entra se os dados que ela usa existem no dia carregado
// (dia pequeno pode não ter mesas nos dois turnos, ante, VHigh etc. — antes
// isso derrubava o renderAll inteiro e o dashboard "não atualizava").
function computeOverviewRecs(){
  const recs=[];
  const totalGameFee=D.gametypes.reduce((a,g)=>a+g.fee,0);
  if(D.gametypes.length&&totalGameFee>0){
    const top=D.gametypes.reduce((a,b)=>b.fee>a.fee?b:a);
    const topShare=top.fee/totalGameFee*100;
    const bestSlotOfAll=D.slots30.filter(s=>s.tables).reduce((a,b)=>b.fee>(a?a.fee:0)?b:a,null);
    const slotsTxt=bestSlotOfAll?` Priorizar abertura em torno de ${bestSlotOfAll.slot} — o slot de maior rake.`:'';
    recs.push({i:ic('fire',1),c:'g',t:`${top.type} domina ${f(topShare,1)}% do rake`,
      b:`R$ ${f(top.fee,0)} em ${top.tables} mesas.${slotsTxt}`,sh:''});
  }

  if(KPI_DEMO.anteTables>0&&KPI_DEMO.noAnteTables>0&&KPI_DEMO.noAnteFph>0){
    const anteMult=KPI_DEMO.anteFph/KPI_DEMO.noAnteFph;
    recs.push({i:ic('lightning',1),c:'g',t:`Ante ${f(anteMult,1)}x mais fee/mão`,
      b:`Mesas com ante: R$ ${f(KPI_DEMO.anteFph,2)}/mão vs R$ ${f(KPI_DEMO.noAnteFph,2)} sem ante, em ${KPI_DEMO.anteTables} mesas com ante contra ${KPI_DEMO.noAnteTables} sem. Expandir a estrutura de ante é a maior alavanca de receita disponível hoje.`,sh:''});
  }

  const vhigh=D.tiers.find(t=>t.tier==='VHigh');
  const totalTierFee=D.tiers.reduce((a,t)=>a+t.fee,0), totalTierTables=D.tiers.reduce((a,t)=>a+t.tables,0);
  if(vhigh&&totalTierFee>0&&totalTierTables>0){
    const vhighFeeShare=vhigh.fee/totalTierFee*100, vhighTableShare=vhigh.tables/totalTierTables*100;
    recs.push({i:ic('diamond',1),c:'g',t:`VHigh: R$ ${f(vhigh.fee,0)} com ${vhigh.tables} mesas`,
      b:`${f(vhighFeeShare,1)}% do rake concentrado em apenas ${f(vhighTableShare,1)}% das mesas. Concentração extrema — proteger esses jogadores é missão crítica.`,sh:''});
  }

  if(KPI_DEMO.conc1Tables>0)recs.push({i:ic('chart-bar',1),c:KPI_DEMO.conc1pct>30?'w':'i',t:`Top 1% gera ${f(KPI_DEMO.conc1pct,1)}% do rake`,
    b:`${KPI_DEMO.conc1Tables} mesas geram R$ ${f(KPI_DEMO.conc1Fee,0)}. Com crescimento de base, criar alertas para sessões anômalas automaticamente reduz o risco de churn concentrado.`,sh:''});

  if(D.duration.length){
    const worstBucket=D.duration.reduce((a,b)=>b.ret<a.ret?b:a);
    const worstAbandon=100-worstBucket.ret;
    recs.push({i:ic('warning',1),c:'w',t:`${worstBucket.bucket}: ${f(worstAbandon,1)}% de abandono`,
      b:`${worstBucket.tables} mesas nessa faixa de duração, ${worstBucket.dead} sem retenção. Investigar horários e tipos com maior abandono para intervenção direcionada.`,sh:''});
  }

  let bestSlot=null,bestSlotEff=0;
  D.slots30.forEach(s=>{if(!s.tables)return;const eff=s.fee/(s.tables*0.5);if(eff>bestSlotEff){bestSlotEff=eff;bestSlot=s;}});
  if(bestSlot)recs.push({i:ic('sun-horizon',1),c:'i',t:`${bestSlot.slot}: slot mais eficiente (R$ ${f(bestSlotEff,1)}/mesa/h)`,
    b:`O melhor slot de toda a operação. Garantir cobertura operacional máxima nesse horário.`,sh:''});

  return recs;
}
function buildRecs(){
  const recs=computeOverviewRecs();
  document.getElementById('recsDiv').innerHTML=recs.map(r=>`
    <div class="rec ${r.c}">
      <span class="rec-ico">${r.i}</span>
      <div class="rec-t">${r.t}</div>
      <div class="rec-b">${r.b}</div>
    </div>`).join('');
}

// ══════════════════════════════ CONCURRENT
function buildConcurrent(){
  const ctx=document.getElementById('cConcurrent');if(!ctx)return;
  new Chart(ctx,{
    type:'line',
    data:{labels:D.concurrent.map(c=>String(c.h).padStart(2,'0')+'h'),
      datasets:[{
        label:'Mesas simultâneas',
        data:D.concurrent.map(c=>c.open),
        borderColor:'#34d399',borderWidth:2,tension:.4,fill:true,
        backgroundColor:'rgba(52,211,153,.06)',
        pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#34d399'
      }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{label:c=>` ${f(c.parsed.y)} mesas simultâneas`}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT,maxRotation:0},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT},border:{display:false},min:0}}
    }
  });
}

// ══════════════════════════════ TIER CHARTS
function buildTierCharts(){
  const ctx1=document.getElementById('cTierFee');if(!ctx1)return;
  const cols=['rgba(120,120,150,.6)','rgba(79,142,247,.7)','rgba(52,211,153,.7)','rgba(251,191,36,.8)','rgba(212,168,83,.9)'];

  // Labels com ranges
  const tierLabels = D.tiers.map(t=>`${t.tier} (${t.range})`);

  new Chart(ctx1,{type:'bar',
    data:{labels:tierLabels,datasets:[{label:'Fee',data:D.tiers.map(t=>t.fee),backgroundColor:cols,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{
      title:c=>`${D.tiers[c[0].dataIndex].tier} · ${D.tiers[c[0].dataIndex].range}`,
      label:c=>` R$ ${f(c.parsed.y,0)} · rake ${D.tiers[c.dataIndex].rake_rate}% · ret ${D.tiers[c.dataIndex].ret_pct}%`,
      afterLabel:c=>` Mesas: ${D.tiers[c.dataIndex].tables}`
    }}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}}}
    }
  });

  const ctx2=document.getElementById('cTierFph');if(!ctx2)return;
  new Chart(ctx2,{type:'bar',
    data:{labels:tierLabels,datasets:[{label:'Fee/mão',data:D.tiers.map(t=>t.avg_fph),backgroundColor:cols,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{
      title:c=>`${D.tiers[c[0].dataIndex].tier} · ${D.tiers[c[0].dataIndex].range}`,
      label:c=>` R$ ${c.parsed.y.toFixed(4)}/mão · fee/player ${D.tiers[c.dataIndex].avg_fpp}`,
      afterLabel:c=>` Mesas: ${D.tiers[c.dataIndex].tables}`
    }}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ CONCENTRATION BAR (MELHORIA #5: Risco Quantificado com Tooltips)
function buildConc(){
  const el=document.getElementById('concBar');if(!el)return;
  const totalFee = KPI_DEMO.feeGross || 1;
  const top1Pct = KPI_DEMO.conc1pct || 32.6;
  const top1Fee = KPI_DEMO.conc1Fee || 72087;
  const top1Tables = KPI_DEMO.conc1Tables || 29;

  // Calcula impacto financeiro: se sair o top 1%, quanto cai?
  const riskOfTop1 = top1Fee; // Risco direto: quanto é gerado pelo top 1%
  const dailyLoss = riskOfTop1; // Se sair 1 VIP, operação perde isso por dia
  const monthlyLoss = dailyLoss * 30;

  // Benchmark de saúde: 10-15% é saudável (diversificado)
  const isHealthy = top1Pct <= 15;
  const riskLevel = top1Pct <= 10 ? 'Baixo' : top1Pct <= 20 ? 'Moderado' : 'Alto';

  // Tooltips para cada segmento
  const top1Tip = tip('Top 1%: Mesas VIP', f(top1Pct,1)+'%', [trow('Mesas VIP', top1Tables), trow('Fee/dia', 'R$ '+f(top1Fee,0)), trow('Impacto se sairem', 'R$ '+f(dailyLoss,0)+'/dia'), trow('Ação', 'Proteger com suporte dedicado')]);
  const top5Tip = tip('2–5%: Mesas de alto valor', f(KPI_DEMO.conc5pct-top1Pct,1)+'%', [trow('Mesas', f(KPI_DEMO.conc5Tables - top1Tables)), trow('Fee/dia', 'R$ '+f(KPI_DEMO.conc5Fee - top1Fee,0)), trow('Ação', 'Monitorar churn semanal')]);
  const top10Tip = tip('6–10%: Mesas consolidadas', f(KPI_DEMO.conc10pct-KPI_DEMO.conc5pct,1)+'%', [trow('Mesas', f(KPI_DEMO.conc10Tables - KPI_DEMO.conc5Tables)), trow('Fee/dia', 'R$ '+f(KPI_DEMO.conc10Fee - KPI_DEMO.conc5Fee,0))]);
  const restTip = tip('Demais: Base diversificada', f(100-KPI_DEMO.conc20pct,1)+'%', [trow('Mesas', f(KPI_DEMO.sessions - KPI_DEMO.conc20Tables)), trow('Fee/dia', 'R$ '+f(KPI_DEMO.feeGross - KPI_DEMO.conc20Fee,0))]);

  el.innerHTML=`<div>
    <div class="conc-bar">
      <div class="conc-seg" style="width:${top1Pct}%;background:linear-gradient(135deg,#d4a853,#f59e0b);cursor:help" title="Top 1%: ${top1Pct}% do rake" data-tip="${top1Tip}">Top 1%</div>
      <div class="conc-seg" style="width:${KPI_DEMO.conc5pct - top1Pct}%;background:linear-gradient(135deg,#4f8ef7,#60a5fa);cursor:help" title="1%-5%: ${KPI_DEMO.conc5pct - top1Pct}%" data-tip="${top5Tip}">2–5%</div>
      <div class="conc-seg" style="width:${KPI_DEMO.conc10pct - KPI_DEMO.conc5pct}%;background:linear-gradient(135deg,#34d399,#6ee7b7);cursor:help" title="5%-10%" data-tip="${top10Tip}">6–10%</div>
      <div class="conc-seg" style="width:${KPI_DEMO.conc20pct - KPI_DEMO.conc10pct}%;background:linear-gradient(135deg,#a78bfa,#c084fc);cursor:help" title="10%-20%">11–20%</div>
      <div class="conc-seg" style="flex:1;background:rgba(130,132,142,.2);cursor:help" title="Resto" data-tip="${restTip}">Demais</div>
    </div>
    <div class="conc-labels"><span style="color:var(--gold);cursor:help" data-tip="${top1Tip}">Top 1% · ${f(top1Pct,1)}%</span><span style="color:var(--dia);cursor:help" data-tip="${top5Tip}">1–5% · ${f(KPI_DEMO.conc5pct-top1Pct,1)}%</span><span style="color:var(--green);cursor:help" data-tip="${top10Tip}">5–10% · ${f(KPI_DEMO.conc10pct-KPI_DEMO.conc5pct,1)}%</span><span style="color:var(--noite)">10–20% · ${f(KPI_DEMO.conc20pct-KPI_DEMO.conc10pct,1)}%</span><span style="cursor:help" data-tip="${restTip}">Demais · ${f(100-KPI_DEMO.conc20pct,1)}%</span></div>
  </div>
  <div style="margin-top:14px;padding:12px;border-radius:8px;background:${isHealthy?'rgba(52,211,153,.08)':'rgba(248,113,113,.08)'};border:1px solid ${isHealthy?'rgba(52,211,153,.2)':'rgba(248,113,113,.2)'}">
    <div style="font-size:11px;color:var(--ink3);margin-bottom:6px">ANÁLISE DE RISCO</div>
    <div style="font-size:13px;font-weight:700;color:${isHealthy?'var(--green)':'var(--red)'};margin-bottom:8px;cursor:help" data-tip="${tip('Nível de Risco', riskLevel, [trow('Concentração', top1Pct+'%'), trow('Benchmark saudável', '10-15%')])}">Nível de Risco: ${riskLevel}</div>
    <div style="font-size:11px;line-height:1.5;color:var(--ink)">
      <div style="cursor:help" data-tip="${tip('VIPs Identificadas', top1Tables+' mesas', [trow('Fee gerado', 'R$ '+f(top1Fee,0)+'/dia'), trow('% do total', top1Pct+'%')])}"><b>${top1Tables} mesas</b> (${top1Pct}% da base) geram <b>R$ ${f(top1Fee,0)}/dia</b></div>
      <div style="margin-top:6px;color:var(--ink3);cursor:help" data-tip="${tip('Impacto Financeiro', 'Perda se saem', [trow('Diária', 'R$ '+f(dailyLoss,0)), trow('Mensal', 'R$ '+f(monthlyLoss/1e6,1)+'M')])}">Se ${top1Tables===1?'essa mesa':'essas '+top1Tables+' mesas'} sair${top1Tables===1?'':'em'}: <span style="color:${isHealthy?'var(--green)':'var(--red)'}"><b>−R$ ${f(dailyLoss,0)}/dia</b> (−R$ ${f(monthlyLoss/1e6,1)}M/mês)</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(130,132,142,.2);color:var(--ink3);cursor:help" data-tip="${tip('Benchmark de Saúde', isHealthy?'✓ Saudável':'⚠ Acima do esperado', [trow('Recomendado', '10-15%'), trow('Seu nível', top1Pct.toFixed(1)+'%')])}">Benchmark saudável: 10–15% de concentração. Atual: ${isHealthy?'✓ OK':'⚠ ACIMA'}</div>
    </div>
  </div>
  `;
}

// ══════════════════════════════ HU MULTI CHART
function buildHuMulti(){
  const ctx=document.getElementById('cHuMulti');if(!ctx)return;
  new Chart(ctx,{type:'doughnut',
    data:{labels:['Multi (3+ players)','HU (≤2 players)'],datasets:[{data:[KPI_DEMO.multiFee,KPI_DEMO.huFee],backgroundColor:['#4f8ef7','#a78bfa'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},
        tooltip:{...CTOP,callbacks:{title:c=>c[0].label,label:c=>{const isMulti=c.datasetIndex===0;return `R$ ${f(c.parsed,0)} (${(c.parsed/KPI_DEMO.feeGross*100).toFixed(1)}%) · ${isMulti?KPI_DEMO.multiTables+' mesas':KPI_DEMO.huTables+' mesas'}`;},afterBody:c=>{const isMulti=c[0].label.includes('Multi');return [isMulti?`Retenção: ${KPI_DEMO.multiRet}%`:`Retenção: ${KPI_DEMO.huRet}%`];}}}}
    }
  });
}

// ══════════════════════════════ JP CHART (com Tooltips)
function buildJP(){
  const ctx=document.getElementById('cJP');if(!ctx)return;
  new Chart(ctx,{type:'doughnut',
    data:{labels:['Fee Líquido','Jackpot Deduzido'],datasets:[{data:[KPI_DEMO.feeNet,KPI_DEMO.jackpot],backgroundColor:['#34d399','#f87171'],borderWidth:0,hoverOffset:5}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'70%',
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},
        tooltip:{...CTOP,callbacks:{title:c=>c[0].label,label:c=>{const isJP=c.label.includes('Jackpot');return ` R$ ${f(c.parsed,0)} (${(c.parsed/KPI_DEMO.feeGross*100).toFixed(1)}%)`;},afterBody:c=>{const isJP=c[0].label.includes('Jackpot');return isJP?[`Mesas impactadas: ${KPI_DEMO.jackpotTables}`,`Estrutura: revisar por stake`]:[`Fee real após JP: R$ ${f(KPI_DEMO.feeNet,0)}`];}}}}
    }
  });
}

// ══════════════════════════════ DEAD TABLES BREAKDOWN (MELHORIA #3: com Tooltips)
function buildDeadBreakdown(){
  const el=document.getElementById('deadBreakdown');if(!el)return;

  // Breakdown por game
  const byGame = D.gametypes.map(g=>{
    const deadCount = D.slots30.reduce((acc,s)=>acc+s.dead,0) * (g.tables/(D.tiers.reduce((a,t)=>a+t.tables,0)||1));
    return {name:g.type, dead:Math.round(deadCount), tables:g.tables, pct:(deadCount/g.tables*100)};
  }).sort((a,b)=>b.pct-a.pct);

  // Breakdown por horário
  const byHour = [];
  const hrByH={};
  D.slots30.forEach(s=>{const h=parseInt(s.slot);if(!hrByH[h]){hrByH[h]={dead:0,tables:0}}hrByH[h].dead+=s.dead;hrByH[h].tables+=s.tables;});
  for(let h=0;h<24;h++){const d=hrByH[h]||{dead:0,tables:0};byHour.push({hour:String(h).padStart(2,'0')+'h',dead:d.dead,tables:d.tables,pct:d.tables?d.dead/d.tables*100:0});}
  const worstHour = byHour.reduce((a,b)=>b.pct>a.pct?b:a);

  // Breakdown por operador
  const byOp = D.opShift.map(o=>({name:o.op,dead:o.dead,tables:o.tables,pct:o.tables?o.dead/o.tables*100:0})).sort((a,b)=>b.pct-a.pct);

  const totalDead = D.tiers.reduce((s,t)=>s+t.dead,0);
  const totalTables = D.tiers.reduce((s,t)=>s+t.tables,0);

  // Tooltips
  const gameTooltips = byGame.slice(0,3).map(g=>tip(`${g.name}: Taxa de morte`, `${f(g.pct,1)}%`, [trow('Mesas mortas', g.dead), trow('Total de mesas', g.tables), trow('Ação', 'Auditar esta modalidade')]));
  const hourTooltip = tip(`Pior Horário: ${worstHour.hour}`, `${f(worstHour.pct,1)}%`, [trow('Mesas mortas', worstHour.dead), trow('Total de mesas', worstHour.tables), trow('Ação', 'Evitar abrir novas mesas neste horário')]);

  el.innerHTML=`
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:12px">
    <div style="border-radius:8px;border:1px solid var(--border);padding:12px;background:rgba(248,113,113,.05)">
      <div style="font-weight:700;color:var(--red);margin-bottom:8px">Por Modalidade</div>
      ${byGame.slice(0,3).map((g,i)=>`
        <div style="margin-bottom:6px;line-height:1.4;cursor:help;border-radius:4px;padding:6px;transition:background .2s" data-tip="${gameTooltips[i]}">
          <div style="display:flex;justify-content:space-between"><span>${g.name}</span><span style="font-weight:700">${f(g.pct,1)}%</span></div>
          <div style="font-size:10px;color:var(--ink3)">${g.dead} de ${g.tables} mesas</div>
        </div>
      `).join('')}
    </div>
    <div style="border-radius:8px;border:1px solid var(--border);padding:12px;background:rgba(251,191,36,.05)">
      <div style="font-weight:700;color:var(--amber);margin-bottom:8px">Pior Horário</div>
      <div style="font-size:16px;font-weight:800;color:var(--red);margin-bottom:4px;cursor:help;padding:6px;border-radius:4px" data-tip="${hourTooltip}">${worstHour.hour}: ${f(worstHour.pct,1)}%</div>
      <div style="font-size:10px;color:var(--ink3)">${worstHour.dead} de ${worstHour.tables} mesas morreram</div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(251,191,36,.2)">
        <div style="font-weight:700;font-size:11px;margin-bottom:4px;color:var(--amber)">3 Piores Horários:</div>
        ${byHour.sort((a,b)=>b.pct-a.pct).slice(0,3).map(h=>`
          <div style="font-size:9px;color:var(--ink3);cursor:help;padding:2px 4px;border-radius:3px" data-tip="${tip(h.hour, f(h.pct,1)+'%', [trow('Mesas mortas', h.dead), trow('Total', h.tables)])}">${h.hour}: ${f(h.pct,1)}% (${h.dead}/${h.tables})</div>
        `).join('')}
      </div>
    </div>
    <div style="border-radius:8px;border:1px solid var(--border);padding:12px;background:rgba(79,142,247,.05)">
      <div style="font-weight:700;color:var(--blue);margin-bottom:8px">Por Operador</div>
      ${byOp.map((o,i)=>`
        <div style="margin-bottom:6px;line-height:1.4;cursor:help;border-radius:4px;padding:6px;transition:background .2s" data-tip="${tip(o.name, f(o.pct,1)+'%', [trow('Mesas mortas', o.dead), trow('Total de mesas', o.tables), trow('Ação', 'Revisar processo de fechamento')])}">
          <div style="display:flex;justify-content:space-between"><span>${o.name}</span><span style="font-weight:700">${f(o.pct,1)}%</span></div>
          <div style="font-size:10px;color:var(--ink3)">${o.dead} de ${o.tables} mesas</div>
        </div>
      `).join('')}
    </div>
  </div>
  `;
}

// ══════════════════════════════ FPP BARS (com Tooltips)
function buildFPP(){
  const el=document.getElementById('fppBars');if(!el)return;
  const max=D.fpp[0].fpp;
  el.innerHTML=D.fpp.map(d=>{
    const gt = D.gametypes.find(g=>g.type===d.type);
    const fppTip = tip(d.type, 'R$ '+d.fpp.toFixed(2)+'/player', [
      trow('Mesas', d.tables),
      trow('Total de fee', 'R$ '+f(gt?.fee||0,0)),
      trow('Players', f(gt?.players||0)),
      trow('Rake rate', (gt?.rake_rate||0).toFixed(2)+'%')
    ]);
    return`
    <div class="mb" style="cursor:help" data-tip="${fppTip}">
      <span class="mb-l">${d.type}</span>
      <div class="mb-t"><div class="mb-f" style="width:${(d.fpp/max*100).toFixed(0)}%;background:${d.fpp>20?'#d4a853':d.fpp>8?'#4f8ef7':CMUTE}"></div></div>
      <span class="mb-v">R$ ${d.fpp.toFixed(2)}</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════ ROOMS TABLE
function buildRooms(){
  const t=document.getElementById('roomsTbl');if(!t)return;
  t.innerHTML=`<thead><tr><th>#</th><th>Sala</th><th class="r">Mesas</th><th class="r">Players</th><th class="r">Fee R$</th><th class="r">Buyin R$</th><th class="r">Take rate</th></tr></thead><tbody>`+
  D.rooms.map((r,i)=>{
    const rr=r.rake_rate;
    const c=rr>15?'var(--red)':rr>10?'var(--amber)':'var(--green)';
    const bg=rr>15?'rgba(248,113,113,.1)':rr>10?'rgba(251,191,36,.1)':'rgba(52,211,153,.1)';
    const roomTip = tip(r.name, 'R$ '+f(r.fee,0), [
      trow('Mesas', f(r.tables)),
      trow('Players', f(r.players)),
      trow('Buy-in total', 'R$ '+f(r.buyin,0)),
      trow('Rake rate', rr + '%')
    ], `Fee/mesa: R$ ${f(r.fee/Math.max(1,r.tables),0)}`);
    return`<tr data-tip="${roomTip}"><td><span class="rk">${i+1}</span></td><td class="b">${r.name}</td><td class="r m">${r.tables}</td><td class="r m">${f(r.players)}</td><td class="r b">${f(r.fee,0)}</td><td class="r m">${f(r.buyin,0)}</td>
      <td class="r"><span style="padding:2px 8px;border-radius:4px;font-size:8px;font-weight:800;background:${bg};color:${c}">${rr}%</span></td></tr>`;
  }).join('')+'</tbody>';
}

// ══════════════════════════════ RAKE RATE CHART (MELHORIA #4: Benchmark + Anomalia)
function buildRR(){
  const ctx=document.getElementById('cRR');if(!ctx)return;
  const d=[...D.rooms].sort((a,b)=>b.rake_rate-a.rake_rate).slice(0,12);

  // Benchmark histórico (simplificado: média de todas as salas)
  const avgRR = (D.rooms.reduce((s,r)=>s+r.rake_rate,0) / D.rooms.length) || 9;

  // Detecta anomalias: salas que desviam muito do benchmark (>20% acima)
  const anomalyThreshold = avgRR * 1.2;

  new Chart(ctx,{type:'bar',
    data:{labels:d.map(x=>x.name),datasets:[
      {label:'Rake rate %',data:d.map(x=>x.rake_rate),backgroundColor:d.map(x=>{
        if(x.rake_rate > anomalyThreshold) return 'rgba(248,113,113,.9)'; // Anomalia vermelha forte
        if(x.rake_rate>15) return 'rgba(248,113,113,.8)';
        if(x.rake_rate>10) return 'rgba(251,191,36,.8)';
        return 'rgba(79,142,247,.7)';
      }),borderRadius:5,borderSkipped:false}
    ]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{...CTOP,callbacks:{
          label:c=>{
            const room=D.rooms.find(r=>r.name===c.label);
            let desc=` ${c.parsed.x}% rake rate`;
            if(room.rake_rate > anomalyThreshold) desc+=` ⚠ ANOMALIA: +${f(room.rake_rate-avgRR,1)}pp acima da média`;
            return desc;
          },
          afterLabel:c=>{
            const room=D.rooms.find(r=>r.name===c.label);
            return `Benchmark médio: ${f(avgRR,1)}%`;
          }
        }}
      },
      scales:{x:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'%'},border:{display:false}},y:{grid:{display:false},ticks:{font:{size:9},color:CTXTB},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ BLIND BARS
function buildBlindBars(){
  const el=document.getElementById('blindBars');if(!el)return;
  const max=Math.max(...D.blinds.map(b=>b.tables));
  const tRow=(k,v)=>`<div class='tip-l'><span>${k}</span><b>${v}</b></div>`;
  const tCard=(head,big,rows,foot)=>`<div class='tip-h'>${head}</div><div class='tip-b'>${big}</div>${rows.join('')}${foot?`<div class='tip-f'>${foot}</div>`:''}`;

  el.innerHTML=D.blinds.map(b=>{
    const range=b.range||getBlindRange(b.bb);
    const colors=getColorByRange(range);
    const tip=tCard(`BB ${b.bb} · ${range}`,`${b.tables} mesas`,[
      tRow('Fee total','R$ '+f(b.fee,0)), tRow('Fee/mesa','R$ '+f(b.fee/Math.max(1,b.tables),0)),
    ],`Categoria: <b>${range}</b>`);
    return `
    <div class="mb" data-tip="${tip}">
      <span class="mb-l">BB ${b.bb} GU <span style="font-size:9px;color:${colors.text};font-weight:700;background:${colors.bg};padding:1px 6px;border-radius:3px">${range}</span></span>
      <div class="mb-t"><div class="mb-f" style="width:${(b.tables/max*100).toFixed(0)}%;background:${colors.text}"></div></div>
      <span class="mb-v">${b.tables} <span style="font-weight:400;color:var(--ink3)">mesas</span></span>
    </div>
    <div style="font-size:8px;color:var(--ink3);margin:-4px 0 8px 84px">Fee R$ ${f(b.fee,0)}</div>`;
  }).join('');
}

// ══════════════════════════════ BUBBLE (com Tooltips)
function buildBubble(){
  const ctx=document.getElementById('cBubble');if(!ctx)return;
  const d=D.gametypes.filter(x=>x.tables>10);
  const cols=['#4f8ef7','#a78bfa','#34d399','#fbbf24','#f87171','#f472b6','#60a5fa','#c084fc'];
  new Chart(ctx,{type:'bubble',
    data:{datasets:d.map((x,i)=>({label:x.type,data:[{x:x.fee/1000,y:x.rake_rate,r:Math.sqrt(x.tables)*2}],backgroundColor:cols[i%cols.length]+'88',borderColor:cols[i%cols.length],borderWidth:1}))},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:8},color:CTEXT,boxWidth:8,boxHeight:8,padding:6}},tooltip:{...CTOP,callbacks:{title:c=>c[0].dataset.label,label:c=>{const gt=d.find(g=>g.type===c.dataset.label);return [` Fee: R$ ${f(c.parsed.x*1000,0)}`,` Rake: ${c.parsed.y}%`,` Mesas: ${gt?.tables}`,` Players: ${f(gt?.players||0)}`,` Hands: ${f(gt?.hands||0)}`];},afterBody:c=>{const gt=d.find(g=>g.type===c[0].dataset.label);return [`Tamanho da bolha = # de mesas`];}}}},
      scales:{x:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'k'},border:{display:false},min:0,title:{display:true,text:'Fee (R$ k)',font:{size:9},color:CTEXT}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'%'},border:{display:false},min:4,max:32,title:{display:true,text:'Rake rate %',font:{size:9},color:CTEXT}}}
    }
  });
}

// ══════════════════════════════ RETENTION (com Tooltips)
function buildRet(){
  const ctx=document.getElementById('cRet');if(!ctx)return;
  new Chart(ctx,{type:'bar',
    data:{labels:D.duration.map(x=>x.bucket),datasets:[
      {label:'Retidas',data:D.duration.map(x=>x.tables-x.dead),backgroundColor:'#4f8ef7',borderRadius:5,borderSkipped:false},
      {label:'Mortas',data:D.duration.map(x=>x.dead),backgroundColor:'rgba(248,113,113,.3)',borderRadius:5,borderSkipped:false}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:8}},tooltip:{...CTOP,callbacks:{title:c=>c[0].label,label:c=>{const d=D.duration[c[0].dataIndex];return c.datasetIndex===0?` Retidas: ${c.parsed.y} (${d.ret}%)`:` Mortas: ${c.parsed.y} (${(100-d.ret).toFixed(1)}%)`;},afterBody:c=>{const d=D.duration[c[0].dataIndex];return [`Taxa de retenção: ${d.ret}%`];}}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:11},color:CTEXT},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ DUR FEE
function buildDurFee(){
  const ctx=document.getElementById('cDurFee');if(!ctx)return;
  const total=D.duration.reduce((a,b)=>a+b.fee,0);
  new Chart(ctx,{type:'doughnut',
    data:{labels:D.duration.map(x=>x.bucket),datasets:[{data:D.duration.map(x=>x.fee),backgroundColor:[CMUTE,'rgba(79,142,247,.5)','rgba(167,139,250,.7)','#a78bfa'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'right',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:8}},tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed,0)} (${(c.parsed/total*100).toFixed(1)}%)`}}}
    }
  });
}

// ══════════════════════════════ HEATMAP
function buildHM(){
  const rows=[
    {mod:'PLO5',cols:[null,{r:57,n:92},{r:59,n:1206},{r:82,n:1079},{r:100,n:586}],total:975,ret:'71.5%'},
    {mod:'PLO6',cols:[null,{r:56,n:126},{r:71,n:99},{r:100,n:48},null],total:815,ret:'69.3%'},
    {mod:'NLH',cols:[null,{r:70,n:20},{r:93,n:30},{r:100,n:31},null],total:226,ret:'90.1%'},
    {mod:'NLH(Swap)',cols:[null,{r:42,n:107},{r:64,n:58},{r:100,n:8},null],total:420,ret:'52.3%'},
    {mod:'PLO4',cols:[null,{r:50,n:8},{r:88,n:8},{r:100,n:28},null],total:141,ret:'88.6%'},
    {mod:'OFC',cols:[null,{r:65,n:54},{r:90,n:31},null,null],total:289,ret:'66.1%'},
  ];
  const hd=['30-60m','1-2h','2-4h','4h+'];
  // Cores OPACAS (não dependem do fundo da página): verde claro→profundo conforme a
  // retenção. Assim o contraste do texto é previsível no tema claro e no escuro.
  const bg=r=>{if(!r)return CMUTE;const t=Math.min(1,r/100),lp=(a,b)=>Math.round(a+(b-a)*t);return`rgb(${lp(214,15)},${lp(240,122)},${lp(226,78)})`};
  const cl=r=>r>48?'#eafff5':'#123a29';
  const t=document.getElementById('hmTbl');if(!t)return;
  t.innerHTML=`<thead><tr><th>Mod.</th>${hd.map(c=>`<th>${esc(c)}</th>`).join('')}<th style="text-align:right">Total</th><th style="text-align:right">Ret.</th></tr></thead><tbody>`+
  rows.map(row=>`<tr><td>${esc(row.mod)}</td>`+row.cols.map(c=>c?`<td style="background:${bg(c.r)};color:${cl(c.r)}"><div class="hv">${c.r}%</div><div class="hn">${c.n}</div></td>`:`<td style="background:rgba(130,132,142,.07);color:var(--ink3)"><div class="hv">—</div></td>`).join('')+`<td class="e">${row.total}</td><td class="e b">${row.ret}</td></tr>`).join('')+'</tbody>';
}

// ══════════════════════════════ HISTORY
function parseDateLabel(s){const[dd,mm,yy]=s.split('/').map(Number);return new Date(yy,mm-1,dd);}
async function buildHist(){
  const body=document.getElementById('histBody');if(!body)return;
  const days=await Store.list();
  // O Histórico é o LEDGER de dias REAIS importados — o dia demo NUNCA entra aqui
  // (não é um dia importado; ele é só o fallback visual do dashboard quando não há
  // dados). Antes o demo era injetado à força e aparecia como se fosse importado,
  // contaminando a lista. Agora: só dias reais; sem nenhum, estado vazio honesto.
  const all=(days||[]).filter(d=>d && d.date && !d.demo).sort((a,b)=>parseDateLabel(a.date)-parseDateLabel(b.date));
  // CONFIABILIDADE: mediana do fee dos dias reais p/ flagar anomalias de escala.
  const realFees=all.map(d=>+d.fee||0).sort((a,b)=>a-b);
  const medFee=realFees.length?realFees[Math.floor(realFees.length/2)]:0;
  let flagged=0;

  // day-over-day comparison card
  const cmpEl=document.getElementById('histCompare');
  if(cmpEl){
    const real=all;
    if(real.length>=2){
      const [prev,last]=real.slice(-2);
      const feeDelta=(last.fee-prev.fee)/(prev.fee||1)*100;
      const deadDelta=last.deadPct-prev.deadPct;
      const sessDelta=(last.sessions-prev.sessions)/(prev.sessions||1)*100;
      const up=feeDelta>=0;
      cmpEl.style.display='';
      renderIntelCards('histCompare',[{
        type:up?'g':'alert',icon:ic(up?'trend-up':'trend-down',1),tag:'Comparativo dia a dia',
        title:`Fee ${up?'subiu':'caiu'} ${f(Math.abs(feeDelta),1)}% de ${prev.date} para ${last.date}`,
        body:`R$ ${f(prev.fee,0)} → R$ ${f(last.fee,0)}. Sessões ${sessDelta>=0?'+':''}${f(sessDelta,1)}%, mesas mortas ${deadDelta>=0?'+':''}${f(deadDelta,1)}pp (${f(prev.deadPct,1)}% → ${f(last.deadPct,1)}%).`,
        metric:{val:(up?'+':'')+f(feeDelta,1)+'%',cls:up?'g':'r',label:'variação de fee bruto vs. dia anterior importado'},
        action:{cls:up?'g':'a',text:up?'Manter estratégia atual':'Investigar queda'}
      }]);
    }else{cmpEl.style.display='none';}
  }

  if(!all.length){ body.innerHTML=`<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--ink3)">Nenhum dia importado ainda — importe uma semana pelo botão no cabeçalho. <b>O dia demo é só demonstração e não é contabilizado.</b></td></tr>`; }
  else body.innerHTML=all.map(d=>{
    const anom=d.demo?'':dataAnomaly(d,medFee,realFees.length); if(anom)flagged++;
    const warn=anom?` <span class="tag" style="color:var(--amber);border-color:var(--amber)" title="${esc(anom)}">${ic('warning')} suspeito</span>`:'';
    return `<tr${anom?' style="background:rgba(251,191,36,.06)"':''}>
    <td class="b">${d.date}${d.demo?` <span class="tag t6">demo</span>`:''}${warn}</td>
    <td class="r m">${f(d.sessions)}</td><td class="r b">${f(d.fee,0)}</td>
    <td class="r m">${f(d.netFee,0)}</td><td class="r m">${f(d.buyin,0)}</td>
    <td class="r m">${f(d.players)}</td><td class="r m">${(d.feePerHand||0).toFixed(2)}</td>
    <td class="r m">${d.deadPct}%</td><td class="r m">${d.takeRate||'—'}%</td>
    <td class="r">${d.demo?'':`<button class="icon-btn" title="Remover" onclick="removeHistoryDay('${d.date}')">${ic('trash')}</button>`}</td>
  </tr>`;}).join('');
  // aviso de confiabilidade acima da tabela quando algum dia foi flagado
  const hwarn=document.getElementById('histDataWarn');
  if(hwarn){ hwarn.style.display=flagged?'':'none';
    if(flagged)hwarn.innerHTML=`<span style="color:var(--amber);font-weight:700">${ic('warning',1)} ${flagged} dia(s) com valores suspeitos</span> — confira se o arquivo veio na moeda certa (GU × BRL) ou se há duplicidade antes de confiar na tendência.`;
  }

  const hw=document.getElementById('histChartWrap');
  if(all.length<2){
    hw.innerHTML=`<div style="text-align:center;padding:56px 0">
      <div style="font-size:28px;color:var(--ink3);margin-bottom:10px">${ic('chart-line')}</div>
      <div style="font-size:11px;color:var(--ink3)">Importe mais relatórios para ver tendências ao longo do tempo.</div>
    </div>`;
    return;
  }
  hw.innerHTML='<div style="height:200px;position:relative"><canvas id="cHistFee" role="img" aria-label="Tendência fee"></canvas></div>';
  setTimeout(()=>{
    const ctx=document.getElementById('cHistFee');if(!ctx)return;
    new Chart(ctx,{type:'line',data:{labels:all.map(d=>d.date),datasets:[{label:'Fee',data:all.map(d=>d.fee),borderColor:'#4f8ef7',borderWidth:2,fill:true,backgroundColor:'rgba(79,142,247,.08)',tension:.4,pointRadius:5,pointBackgroundColor:'#4f8ef7'},{label:'Fee Líquido',data:all.map(d=>d.netFee||d.fee),borderColor:'#34d399',borderWidth:1.5,fill:false,tension:.4,pointRadius:3,pointBackgroundColor:'#34d399',borderDash:[4,4]}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed.y,0)}`}}},
        scales:{x:{grid:{display:false},ticks:{font:{size:10}},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}}}}
    });
  },50);
}

// ══════════════════════════════ MÉDIAS DA SEMANA
// Lente de gestor de clube: em vez de olhar um dia isolado, tira a MÉDIA por dia
// dos relatórios importados e foca o maior vazamento controlável — as MESAS
// PERDIDAS (abertas que não retêm ninguém, <10 mãos). Valores monetários dos
// resumos já vêm em BRL (finalizeDataset × GU_TO_BRL). O `base` demo do histórico
// está em GU, então fica FORA das médias — só dias reais entram. Sem dias reais,
// mostra uma prévia com o dataset atual (KPI_DEMO, já em BRL) e um aviso.
function medPseudoDay(){
  const K=KPI_DEMO;
  return {date:K.date||'atual',demo:true,sessions:K.sessions||0,fee:K.feeGross||0,
    netFee:K.feeNet||0,buyin:K.buyinTotal||0,players:K.playersTotal||0,
    feePerHand:K.feePerHand||0,deadPct:K.deadPct||0,takeRate:K.takeRate||0};
}
async function buildMedias(){
  if(!document.getElementById('pg-medias'))return;
  let days=[]; try{ days=await Store.list(); }catch(_){ days=[]; }
  const real=(days||[]).filter(d=>d&&d.date&&!d.demo)
    .sort((a,b)=>parseDateLabel(a.date)-parseDateLabel(b.date));
  const preview = real.length===0;
  const week = preview ? [medPseudoDay()] : real.slice(-7);
  const prev = real.length>=8 ? real.slice(-14,-7) : [];

  const set=(id,html)=>{const e=document.getElementById(id);if(e)e.innerHTML=html;};
  const avgOf=(arr,k)=>arr.length?arr.reduce((a,d)=>a+(+d[k]||0),0)/arr.length:0;
  const kcard=(cls,l,v,s)=>`<div class="kpi ${cls}"><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s}</div></div>`;
  const rsLine=(dir,icon,tt,sb,vl)=>`<div class="rs-line"><div class="rs-ic ${dir}">${ic(icon,1)}</div><div class="rs-tx"><div class="rs-tt">${tt}</div><div class="rs-sb">${sb}</div></div><div class="rs-vl ${dir}">${vl}</div></div>`;

  // médias por dia
  const avgFee=avgOf(week,'fee'), avgNet=avgOf(week,'netFee'), avgSess=avgOf(week,'sessions'),
        avgPlayers=avgOf(week,'players'), avgFph=avgOf(week,'feePerHand'),
        avgTake=avgOf(week,'takeRate'), avgDead=avgOf(week,'deadPct');
  const weekFee=week.reduce((a,d)=>a+(+d.fee||0),0);

  // variação semana-a-semana (só com 8+ dias reais)
  const wow=k=>{ if(!prev.length)return null; const cur=avgOf(week,k), pv=avgOf(prev,k); if(!pv)return null; return (cur-pv)/pv*100; };
  const wowSub=(k,lowerBetter)=>{ const d=wow(k); if(d==null)return null; const good=lowerBetter?d<0:d>=0; return `<span style="color:${good?'var(--green)':'var(--red)'}">${d>=0?'+':''}${f(d,1)}% vs semana anterior</span>`; };

  // MESAS PERDIDAS — mesa morta ≈ sessões × dead%. Rake perdido = mesas mortas ×
  // fee médio de uma mesa VIVA (o que ela teria gerado se tivesse vingado).
  let lostRakeSum=0, deadTablesSum=0;
  week.forEach(d=>{
    const sess=+d.sessions||0, dead=sess*(+d.deadPct||0)/100, live=Math.max(1,sess-dead);
    const fpLive=(+d.fee||0)/live;
    lostRakeSum+=dead*fpLive; deadTablesSum+=dead;
  });
  const avgDeadTables=deadTablesSum/week.length, avgLostRake=lostRakeSum/week.length;
  const weekLostRake=lostRakeSum, recover20=avgLostRake*0.2;
  const deadCls=avgDead<15?'c-green':avgDead<25?'c-amber':'c-red';
  const deadWord=avgDead<15?'saudável':avgDead<25?'atenção':'crítico';
  const deadTrend=week.length>=2?(week[week.length-1].deadPct-week[0].deadPct):0;
  const byDead=[...week].sort((a,b)=>(+a.deadPct||0)-(+b.deadPct||0));
  const bestDay=byDead[0], worstDay=byDead[byDead.length-1];

  // sub + aviso de prévia
  const sub=document.getElementById('mdSub');
  if(sub)sub.innerHTML = preview
    ? `Ainda não há semana importada — <b>prévia com o dataset atual (${esc(week[0].date)})</b>. Importe os relatórios em "Importar Semana" para médias reais e comparativo semana a semana.`
    : `Média por dia de <b>${real.length} dia(s)</b> importados (janela da última semana: ${week.length}). O foco é mesas perdidas, o maior vazamento controlável sem gastar em aquisição.`;
  const empty=document.getElementById('mdEmpty');
  if(empty){ empty.style.display=preview?'':'none';
    if(preview)empty.innerHTML=`<div class="card" style="border-color:var(--amber);margin-bottom:12px"><div class="ct"><i class="ph-fill ph-info" style="color:var(--amber)"></i> Prévia (1 dia)</div><div class="cs">As médias abaixo usam só o dataset carregado. Com a semana importada, esta aba vira o painel de gestão semanal com tendência e comparativo.</div></div>`;
  }

  // KPIs médios
  const gDead=+GOALS.deadPct||0, gFee=+GOALS.feeDia||0, gTake=+GOALS.takeRate||0;
  const takeKpiCls = gTake>0 ? (avgTake>=gTake?'c-green':'c-red') : 'c-green';
  const deadKpiCls = gDead>0 ? (avgDead<=gDead?'c-green':'c-red') : deadCls;
  set('mdKpis',[
    kcard('hero','Fee bruto médio/dia','R$ '+f(avgFee,0), gFee>0?`meta ≥ R$ ${fK(gFee)} · ${avgFee>=gFee?'na meta ✓':'abaixo'}`:(wowSub('fee')||('total R$ '+f(weekFee,0)+' · '+week.length+' dia(s)'))),
    kcard('c-green','Fee líquido médio/dia','R$ '+f(avgNet,0), wowSub('netFee')||'após jackpot'),
    kcard('','Sessões médias/dia',f(avgSess), wowSub('sessions')||(f(avgPlayers)+' players/dia')),
    kcard('c-gold','Fee/mão médio','R$ '+f(avgFph,2), wowSub('feePerHand')||'rake por mão jogada'),
    kcard(takeKpiCls,'Take rate médio',f(avgTake,2)+'%', gTake>0?`meta ≥ ${f(gTake,1)}% · ${avgTake>=gTake?'ok':'abaixo'}`:'fee ÷ buyin movimentado'),
    kcard(deadKpiCls,'Mesas perdidas (média)',f(avgDead,1)+'%', gDead>0?`meta ≤ ${f(gDead,1)}% · ${avgDead<=gDead?'ok':'acima'}`:(deadWord+' · ~'+f(avgDeadTables,0)+' mesas/dia')),
  ].join(''));

  // KPIs de mesas perdidas
  set('mdLostKpis',[
    kcard('c-red','Custo de oportunidade/dia','R$ '+f(avgLostRake,0),'rake que as mesas perdidas deixaram de gerar'),
    kcard('c-amber','Custo na semana','R$ '+f(weekLostRake,0), week.length+' dia(s) · ~'+f(deadTablesSum,0)+' mesas perdidas'),
    kcard('','Mesas perdidas/dia',f(avgDeadTables,0), f(avgDead,1)+'% de ~'+f(avgSess,0)+' aberturas'),
    kcard('c-green','Retenção média',f(100-avgDead,1)+'%','mesas que vingaram'),
    kcard(deadTrend<=0?'c-green':'c-red','Tendência na semana',(deadTrend>=0?'+':'')+f(deadTrend,1)+' pp', deadTrend<=0?'melhorando (menos mortas)':'piorando (mais mortas)'),
    kcard('c-green','Recuperável (−20%)','+R$ '+f(recover20,0)+'/dia','se 1 em 5 mesas mortas virar ativa'),
  ].join(''));

  // ALERTA PROATIVO — dispara quando a média da semana passa da META
  set('mdAlert', deadAlertHtml(avgDead, avgLostRake, 'na média da semana'));
  // METAS — grade editável (mortas/fee-dia/take rate) + placar de dias na meta.
  // Não atropela quem está digitando: só reescreve inputs que não estão em foco.
  const metaDefs=[
    {key:'deadPct', label:'Mesas perdidas (máx)', dir:'max', real:avgDead, unit:'%',  step:'0.5', min:'1', max:'60', fmt:v=>f(v,1)+'%',  pp:true},
    {key:'feeDia',  label:'Fee bruto/dia (mín)',  dir:'min', real:avgFee,  unit:'R$', step:'1000', min:'0', max:'99999999', fmt:v=>'R$ '+fK(v), money:true},
    {key:'takeRate',label:'Take rate (mín)',      dir:'min', real:avgTake, unit:'%',  step:'0.1', min:'0', max:'30', fmt:v=>f(v,2)+'%'},
  ];
  const grid=document.getElementById('mdGoalGrid');
  if(grid){ grid.innerHTML=metaDefs.map(m=>{
    const g=+GOALS[m.key]||0, on=g>0, pass=!on?null:(m.dir==='max'?m.real<=g:m.real>=g);
    const active=document.getElementById('goal_'+m.key)===document.activeElement;
    const vs = preview ? 'importe a semana p/ comparar'
      : !on ? 'meta não definida'
      : m.pp ? `real <b style="color:${pass?'var(--green)':'var(--red)'}">${f(m.real,1)}%</b> · ${pass?`${f(g-m.real,1)} pp de folga`:`${f(m.real-g,1)} pp acima`}`
             : `real <b style="color:${pass?'var(--green)':'var(--red)'}">${m.fmt(m.real)}</b> · ${pass?'na meta':'abaixo'}`;
    return `<div style="border:1px solid ${on&&pass===false?'var(--red)':'var(--bdr)'};border-radius:10px;padding:10px 12px;background:var(--surf)">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--ink3)">${m.label}</div>
      <div style="display:flex;align-items:center;gap:6px;margin:7px 0 5px">
        ${m.money?'<span style="font-size:11px;color:var(--ink2);font-weight:700">R$</span>':''}
        <input id="goal_${m.key}" type="number" min="${m.min}" max="${m.max}" step="${m.step}" inputmode="decimal" ${active?'':`value="${g||''}"`} placeholder="—"
          style="width:${m.money?'112px':'74px'};height:34px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg);color:var(--ink);text-align:right;padding:0 8px;font-weight:800;font-size:14px">
        ${!m.money?`<span style="font-size:11px;color:var(--ink2);font-weight:700">${m.unit}</span>`:''}
      </div>
      <div style="font-size:10px;color:var(--ink2)">${vs}</div>
    </div>`;
  }).join(''); }
  const score=document.getElementById('mdGoalScore');
  if(score){
    if(preview){ score.innerHTML='Placar (dias na meta) aparece com a semana importada.'; }
    else{ const cnt=p=>week.filter(p).length, parts=[];
      if(gDead>0)parts.push(`Mesas perdidas <b>${cnt(d=>(+d.deadPct||0)<=gDead)}/${week.length}</b>`);
      if(gFee>0) parts.push(`Fee/dia <b>${cnt(d=>(+d.fee||0)>=gFee)}/${week.length}</b>`);
      if(gTake>0)parts.push(`Take rate <b>${cnt(d=>(+d.takeRate||0)>=gTake)}/${week.length}</b>`);
      score.innerHTML = parts.length ? `Placar — dias na meta: ${parts.join(' · ')}` : 'Defina metas acima para ver o placar.';
    }
  }
  // CUSTO DE OPORTUNIDADE É UM TETO — deixa explícito p/ não vender o número cheio
  set('mdLostNote', `${ic('info',1)} <b>Custo de oportunidade é um teto</b>: assume que cada mesa perdida renderia como uma mesa <i>viva</i> média. É o potencial máximo — use o cenário <b>−20%</b> como meta realista de curto prazo.`);

  // gráfico de tendência de mesas perdidas (%) por dia — só com 2+ dias reais
  const cw=document.getElementById('mdLostChartWrap');
  if(cw){
    if(preview||week.length<2){
      cw.innerHTML=`<div style="text-align:center;padding:14px 0 4px;font-size:10.5px;color:var(--ink3)">${ic('chart-line')} Importe 2+ dias para ver a tendência de mesas perdidas ao longo da semana.</div>`;
    }else{
      cw.innerHTML='<div style="height:150px;position:relative;margin-top:8px"><canvas id="cMdDead" role="img" aria-label="Tendência de mesas perdidas"></canvas></div>';
      try{ if(window._mdDeadChart)window._mdDeadChart.destroy(); }catch(_){}
      setTimeout(()=>{
        const ctx=document.getElementById('cMdDead'); if(!ctx||!window.Chart)return;
        window._mdDeadChart=new Chart(ctx,{type:'line',
          data:{labels:week.map(d=>d.date),datasets:[{label:'% mesas perdidas',data:week.map(d=>+d.deadPct||0),borderColor:'#f87171',borderWidth:2,fill:true,backgroundColor:'rgba(248,113,113,.1)',tension:.4,pointRadius:4,pointBackgroundColor:'#f87171'}]},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{label:c=>` ${f(c.parsed.y,1)}% mortas`}}},
            scales:{x:{grid:{display:false},ticks:{font:{size:10},color:CTEXT},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'%'},border:{display:false}}}}
        });
      },50);
    }
  }

  // DIA × NOITE — qual turno perde mais mesa (decisão de escala/supervisão).
  // Vem do dataset ATUAL (KPI_DEMO já traz deadDia/deadNoite/tablesDia/... por turno).
  const shiftStat=(dead,tables,fee)=>{const t=+tables||0,d=+dead||0,live=Math.max(1,t-d),fp=(+fee||0)/live;
    return {t,d,pct:t?d/t*100:0,ret:t?(t-d)/t*100:0,lost:d*fp};};
  const K=KPI_DEMO, dia=shiftStat(K.deadDia,K.tablesDia,K.feeDia), noite=shiftStat(K.deadNoite,K.tablesNoite,K.feeNoite);
  const worseNight=noite.pct>=dia.pct;
  const shiftCol=(name,icon,s,bad)=>`
    <div style="flex:1;min-width:0;border:1px solid ${bad?'var(--red)':'var(--bdr)'};border-radius:12px;padding:12px 14px;background:${bad?'rgba(248,113,113,.06)':'var(--surf)'}">
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:var(--ink)">${ic(icon,1)} ${name}${bad?`<span class="tag t6" style="margin-left:auto;color:var(--red);border-color:var(--red)">vaza mais</span>`:''}</div>
      <div style="font-size:23px;font-weight:800;color:${bad?'var(--red)':'var(--ink)'};margin:6px 0 1px;font-variant-numeric:tabular-nums">${f(s.pct,1)}%</div>
      <div style="font-size:9.5px;color:var(--ink3)">mesas perdidas · ${f(s.d)} de ${f(s.t)}</div>
      <div style="margin-top:8px;font-size:10px;color:var(--ink2)">Custo <b style="color:var(--red)">R$ ${f(s.lost,0)}</b>/dia · retenção ${f(s.ret,0)}%</div>
    </div>`;
  set('mdShift',
    `<div style="display:flex;gap:12px">${shiftCol('Dia','sun',dia,!worseNight)}${shiftCol('Noite','moon-stars',noite,worseNight)}</div>`+
    `<div style="margin-top:10px;font-size:10.5px;color:var(--ink2);display:flex;align-items:center;gap:6px">${ic('arrow-right')} ${worseNight?'A noite':'O dia'} perde mais mesa (${f(Math.abs(dia.pct-noite.pct),1)} pp de diferença) — é onde reforçar supervisão de sala devolve mais rake.</div>`+
    `<div class="cs" style="margin-top:6px;font-size:9.5px">${SHIFT_NOTE}</div>`);

  // PROJEÇÃO MENSAL — run-rate: a média por dia extrapolada ×30.
  const monthFee=avgFee*30, monthLost=avgLostRake*30, monthRecover=recover20*30;
  set('mdMonth',[
    kcard('hero','Fee bruto / mês','R$ '+fK(monthFee),'run-rate = média/dia × 30'),
    kcard('c-red','Mortas custam / mês','R$ '+fK(monthLost),'oportunidade parada'),
    kcard('c-green','Recuperável / mês','+R$ '+fK(monthRecover),'cortando mortas em 20%'),
  ].join(''));

  // ONDE MORREM — por horário (dataset selecionado)
  const byH={};
  D.slots30.forEach(s=>{const h=parseInt(s.slot,10); if(!byH[h])byH[h]={dead:0,tables:0}; byH[h].dead+=(+s.dead||0); byH[h].tables+=(+s.tables||0);});
  const topH=Object.entries(byH).map(([h,o])=>({h:+h,dead:o.dead,tables:o.tables,pct:o.tables?o.dead/o.tables*100:0}))
    .sort((a,b)=>b.dead-a.dead).slice(0,5);
  set('mdByHour', topH.map(x=>rsLine('dn','clock',String(x.h).padStart(2,'0')+'h',
    `${f(x.dead)} mortas de ${f(x.tables)} abertas`, f(x.pct,0)+'%')).join('') || '<div class="cs">Sem dados de horário.</div>');

  // ONDE MORREM — por duração e stake
  const durS=[...D.duration].map(x=>({...x,ab:x.tables?x.dead/x.tables*100:0})).sort((a,b)=>b.dead-a.dead);
  const tierS=[...D.tiers].map(x=>({...x,ab:x.tables?x.dead/x.tables*100:0})).sort((a,b)=>b.dead-a.dead);
  const hdr=t=>`<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin:2px 0 6px">${t}</div>`;
  set('mdByStruct',
    hdr('Por duração da mesa')+
    durS.slice(0,3).map(x=>rsLine('dn','hourglass-medium',esc(x.bucket),`${f(x.dead)} mortas de ${f(x.tables)} · retenção ${f(x.ret,0)}%`,f(x.ab,0)+'%')).join('')+
    hdr('Por stake (tier)')+
    tierS.slice(0,3).map(x=>rsLine('dn','stack',esc(x.tier),`${f(x.dead)} mortas de ${f(x.tables)} mesas`,f(x.ab,0)+'%')).join('')
  );

  // PADRÃO POR DIA DA SEMANA — agrupa TODOS os dias reais por weekday. Um clube
  // tem ritmo semanal (fim de semana enche, meio de semana esvazia); saber disso
  // guia promoção e escala. Precisa de dias reais; na prévia, mostra o convite.
  const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const byWD={};
  real.forEach(d=>{const w=parseDateLabel(d.date).getDay(); if(!byWD[w])byWD[w]={fee:0,dead:0,n:0}; byWD[w].fee+=(+d.fee||0); byWD[w].dead+=(+d.deadPct||0); byWD[w].n++;});
  const wdKeys=Object.keys(byWD).map(Number);
  const order=[1,2,3,4,5,6,0];   // Seg→Dom (semana de trabalho)
  if(preview||wdKeys.length<2){
    set('mdWeekday',`<div style="text-align:center;padding:16px 6px;font-size:10.5px;color:var(--ink3)">${ic('calendar-dots')} Importe dias de <b>datas diferentes</b> para revelar o padrão semanal (qual dia rende mais e qual mais esvazia).</div>`);
  }else{
    const wdFee=w=>byWD[w]?byWD[w].fee/byWD[w].n:0;
    const maxWd=Math.max(...wdKeys.map(wdFee),1);
    const present=wdKeys.map(w=>({w,fee:wdFee(w)}));
    const bestW=present.reduce((a,b)=>b.fee>a.fee?b:a).w, worstW=present.reduce((a,b)=>b.fee<a.fee?b:a).w;
    set('mdWeekday',order.map(w=>{
      const o=byWD[w];
      if(!o)return `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;opacity:.4"><div style="width:30px;font-size:10px;font-weight:700;color:var(--ink3)">${WD[w]}</div><div style="flex:1;height:15px;border-radius:5px;background:var(--surf2)"></div><div style="width:104px;text-align:right;font-size:9.5px;color:var(--ink3)">sem dado</div></div>`;
      const fee=o.fee/o.n, dead=o.dead/o.n, pct=fee/maxWd*100, col=w===bestW?'var(--green)':w===worstW?'var(--red)':'var(--gold)';
      return `<div style="display:flex;align-items:center;gap:8px;margin:5px 0">
        <div style="width:30px;font-size:10px;font-weight:800;color:var(--ink2)">${WD[w]}</div>
        <div style="flex:1;height:15px;border-radius:5px;background:var(--surf2);position:relative;overflow:hidden"><div style="position:absolute;inset:0 auto 0 0;width:${pct.toFixed(1)}%;background:${col};opacity:.85;border-radius:5px"></div></div>
        <div style="width:58px;text-align:right;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums">R$ ${fK(fee)}</div>
        <div style="width:42px;text-align:right;font-size:9px;color:var(--ink3)">${f(dead,0)}% m.</div>
      </div>`;
    }).join('')+`<div style="margin-top:8px;font-size:10.5px;color:var(--ink2);display:flex;align-items:center;gap:6px">${ic('arrow-right')} <b>${WD[bestW]}</b> é o dia mais forte, <b>${WD[worstW]}</b> o mais fraco — concentre promoção e escala onde o retorno é maior.</div>`);
  }

  // CONSISTÊNCIA / VOLATILIDADE — coeficiente de variação (desvio-padrão ÷ média)
  // do fee diário na janela da semana. Receita previsível facilita meta e escala;
  // montanha-russa é risco de fluxo de caixa. Precisa de 2+ dias reais.
  const feeVals=week.map(d=>+d.fee||0);
  if(preview||feeVals.length<2){
    set('mdConsist',`<div style="text-align:center;padding:16px 6px;font-size:10.5px;color:var(--ink3)">${ic('pulse')} Com <b>2+ dias</b> a aba calcula a oscilação típica do fee diário (previsível vs. volátil).</div>`);
  }else{
    const mean=avgFee, variance=feeVals.reduce((a,v)=>a+(v-mean)*(v-mean),0)/feeVals.length, sd=Math.sqrt(variance);
    const cv=mean?sd/mean*100:0, minV=Math.min(...feeVals), maxV=Math.max(...feeVals);
    const cvVar=cv<15?'--green':cv<30?'--amber':'--red', cvWord=cv<15?'muito estável':cv<30?'oscilação moderada':'volátil — atenção ao caixa';
    set('mdConsist',
      `<div style="display:flex;align-items:baseline;gap:10px"><div style="font-size:32px;font-weight:800;color:var(${cvVar});font-variant-numeric:tabular-nums">±${f(cv,0)}%</div><div style="font-size:11px;font-weight:800;color:var(${cvVar})">${cvWord}</div></div>`+
      `<div class="cs" style="margin-top:2px">variação típica do fee diário em torno da média de R$ ${f(mean,0)}</div>`+
      `<div style="display:flex;gap:8px;margin-top:12px">`+
        `<div style="flex:1;border:1px solid var(--bdr);border-radius:10px;padding:9px 11px;background:var(--surf)"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)">Melhor dia</div><div style="font-size:15px;font-weight:800;color:var(--green)">R$ ${fK(maxV)}</div></div>`+
        `<div style="flex:1;border:1px solid var(--bdr);border-radius:10px;padding:9px 11px;background:var(--surf)"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)">Pior dia</div><div style="font-size:15px;font-weight:800;color:var(--red)">R$ ${fK(minV)}</div></div>`+
      `</div>`+
      `<div style="margin-top:10px;font-size:10.5px;color:var(--ink2)">${ic('arrow-right')} Quanto menor a oscilação, mais previsível o caixa — meta e escala ficam confiáveis. Acima de 30% o mês vira montanha-russa.</div>`);
  }

  // PLANO DE RECUPERAÇÃO — cards de ação (lente de CEO)
  const cards=[
    {type:avgDead>=25?'alert':'gold',icon:ic('broom',1),tag:'Prioridade 1 · Ociosidade',
     title:`${f(avgDead,1)}% de mesas perdidas custam ~R$ ${f(avgLostRake,0)}/dia`,
     body:`São ~${f(avgDeadTables,0)} mesas por dia abertas que não retêm ninguém. Fechar mesa ociosa mais rápido (timeout sem 2º jogador) e realocar o dealer devolve rake sem gastar 1 real em aquisição. Meta realista de curto prazo: −20% de mortas.`,
     metric:{val:'+R$ '+f(recover20,0)+'/dia',cls:'g',label:'recuperável reduzindo mortas em 20%'},
     action:{cls:'a',text:'Definir política de fechamento automático'}},
    {type:'dia',icon:ic('stack',1),tag:'Liquidez',
     title:'Consolidar mesas da mesma stake reduz mortes',
     body:`Abrir mesa demais fragmenta a base: o jogador entra, não acha adversário e a mesa morre. Nos horários de pico, encher as mesas existentes antes de abrir novas melhora retenção e experiência ao mesmo tempo.`,
     action:{cls:'a',text:'Revisar regra de abertura no pico'}},
  ];
  if(topH[0])cards.push({type:'noite',icon:ic('clock',1),tag:'Foco operacional',
     title:`${String(topH[0].h).padStart(2,'0')}h concentra ${f(topH[0].dead)} mesas mortas`,
     body:`É um dos horários com mais aberturas que não vingam (${f(topH[0].pct,0)}% de mortas no slot). Reforçar a supervisão de sala nesse turno e segurar aberturas até haver jogador é a intervenção de menor custo.`,
     action:{cls:'a',text:'Escalar supervisão nesse horário'}});
  if(!preview&&week.length>=2)cards.push({type:'both',icon:ic(deadTrend<=0?'trend-up':'trend-down',1),tag:'Ritmo da semana',
     title:`Melhor dia ${esc(bestDay.date)} (${f(bestDay.deadPct,1)}%) · pior ${esc(worstDay.date)} (${f(worstDay.deadPct,1)}%)`,
     body:`A distância entre o melhor e o pior dia é ${f((worstDay.deadPct-bestDay.deadPct),1)} pp de mesas mortas. Entender o que ${esc(bestDay.date)} fez diferente (escala, mix de stakes, horários de abertura) e replicar é ganho imediato, sem custo.`,
     action:{cls:'a',text:'Comparar a escala dos dois dias'}});
  renderIntelCards('mdIntel',cards);
}

// ══════════════════════════════ STORAGE ABSTRACTION
// Firebase Realtime Database, mesmo projeto do Painel/Admin (design-1-53c00).
// Node: mesasCashHistory/{yyyy-mm-dd} — chave sem "/" pois RTDB não aceita
// barra em path. Cai para localStorage se o Firebase não estiver disponível
// (offline, bloqueado, etc.) para nunca travar o uso do dashboard.
const RTDB_NODE='mesasCashHistory';
const RTDB_DATA='mesasCashData';
// Marcador minúsculo de versão do dataset bruto. O `mesasCashData` inteiro é
// pesado (todos os dias importados) e o Modo TV o relia a cada 5 min (288×/dia) —
// foi isso que reestourou a cota de egress do Firebase (10GB). Agora lê só este
// carimbo e rebaixa o dataset SÓ quando muda (mesmo protocolo da Global).
const RTDB_REV='mesasCashDataRev';
let _rawCache=null;                    // { rev, fb } — evita rebaixar o dataset à toa
function bumpRawRev(){                  // chamado a cada import/remoção
  try{ if(fbOk&&db) db.ref(RTDB_REV).set(firebase.database.ServerValue.TIMESTAMP); }catch(_){ }
  _rawCache=null;                       // invalida o cache local na hora
}
function labelToRtdbKey(dateStr){const[dd,mm,yy]=dateStr.split('/');return`${yy}-${mm}-${dd}`;}
// ── Serialização segura p/ RTDB ──
// O RTDB proíbe . # $ / [ ] em chaves. O dataset bruto usa mapas com chaves
// vindas da planilha (big blind "0.05", nomes de sala/jogo), então o set()
// inteiro era rejeitado e o dia importado nunca chegava ao Firebase — os
// painéis não atualizavam ao recarregar. fbPack codifica as chaves (percent-
// encoding) antes de gravar; fbUnpack decodifica na leitura.
function fbEncKey(k){return String(k).replace(/%/g,'%25').replace(/[.#$/\[\]]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
function fbDecKey(k){try{return decodeURIComponent(k);}catch(_){return k;}}
function fbPack(v){
  if(Array.isArray(v))return v.map(fbPack);
  if(v&&typeof v==='object'){const o={};for(const k in v)o[fbEncKey(k)]=fbPack(v[k]);return o;}
  return v;
}
function fbUnpack(v){
  if(Array.isArray(v))return v.map(fbUnpack);
  if(v&&typeof v==='object'){const o={};for(const k in v)o[fbDecKey(k)]=fbUnpack(v[k]);return o;}
  return v;
}
// O RTDB descarta objetos/arrays vazios ao gravar — na leitura, reconstrói a
// forma completa de newRaw() pra finalizeDataset/mergeRaws nunca quebrarem.
function hydrateRaw(R){
  if(!R)return null;
  const out=Object.assign(newRaw(null),R);
  out.dates=R.dates||[];
  out.slots=Array.from({length:48},(_,i)=>Object.assign({tables:0,fee:0,players:0,hands:0,dead:0},(R.slots&&R.slots[i])||{}));
  out.end=Array.from({length:48},(_,i)=>(R.end&&R.end[i])||0);
  out.conc=Array.from({length:24},(_,i)=>(R.conc&&R.conc[i])||0);
  ['gt','op','room','blind','dur','tier','feeRate'].forEach(k=>out[k]=R[k]||{});
  ['hu','multi'].forEach(k=>out[k]=Object.assign({tables:0,fee:0,hands:0,buyin:0,players:0,durSum:0,retained:0},R[k]||{}));
  ['ante','noante'].forEach(k=>out[k]=Object.assign({tables:0,fee:0,hands:0,retained:0},R[k]||{}));
  const ev=R.ev||{};
  out.ev={
    live:Object.assign({n:0,fee:0,buyin:0,players:0,hands:0},ev.live||{}),
    hg:Object.assign({n:0,fee:0,buyin:0,players:0,hands:0},ev.hg||{}),
    byType:ev.byType||{}, list:ev.list||[]
  };
  out.hphList=R.hphList||[]; out.feeList=R.feeList||[]; out.topN=R.topN||[];
  return out;
}
function localRaws(){try{return JSON.parse(localStorage.getItem('cashData')||'{}');}catch(_){return{};}}
function setLocalRaws(all){try{localStorage.setItem('cashData',JSON.stringify(all));}catch(e){console.error('localStorage cashData',e);}}
// Estratégia: localStorage é SEMPRE gravado (cache/offline); o Firebase é a
// fonte compartilhada. Na leitura, mescla os dois (Firebase vence) e re-envia
// em background dias que só existem localmente (ex.: gravações que falharam
// antes da correção de chaves). saveRaw devolve 'cloud' ou 'local' pra UI
// avisar o operador quando o dado NÃO chegou ao Firebase.
// Espera o Firebase Auth restaurar a sessão (1º onAuthStateChanged) antes de
// qualquer leitura/gravação protegida por regra — sem isso a 1ª leitura no
// load corre contra o restore do token, toma permission_denied e o dashboard
// abre na demo mesmo com dias importados (mesma corrida já vista no painel).
let _authReady=null;
function whenAuthReady(timeoutMs){
  if(_authReady)return _authReady;
  _authReady=new Promise(res=>{
    if(!fbOk||!firebase.auth){res();return;}
    let done=false; const fin=()=>{if(!done){done=true;res();}};
    try{const off=firebase.auth().onAuthStateChanged(()=>{fin();off();});}catch(_){fin();}
    setTimeout(fin,timeoutMs||4000);
  });
  return _authReady;
}
const Store={
  async list(){
    await whenAuthReady();
    let fb=null;
    if(fbOk&&db){
      try{fb=(await db.ref(RTDB_NODE).once('value')).val()||{};}
      catch(e){console.error('Store.list (Firebase)',e);}
    }
    let local=[];try{local=JSON.parse(localStorage.getItem('cashHistory')||'[]');}catch(_){ }
    if(fb===null)return local;
    const merged={};
    local.forEach(d=>{if(d&&d.date)merged[labelToRtdbKey(d.date)]=d;});
    Object.entries(fb).forEach(([k,v])=>{merged[k]=v;});
    return Object.values(merged);
  },
  async upsert(dateStr,summary){
    await whenAuthReady();
    const record={date:dateStr,...summary,updatedAt:Date.now(),updatedBy:_email||''};
    try{
      const hist=JSON.parse(localStorage.getItem('cashHistory')||'[]').filter(d=>d.date!==dateStr);
      hist.push(record);
      localStorage.setItem('cashHistory',JSON.stringify(hist));
    }catch(e){console.error('Store.upsert (local)',e);}
    if(fbOk&&db){
      try{await db.ref(`${RTDB_NODE}/${labelToRtdbKey(dateStr)}`).set(record);return 'cloud';}
      catch(e){console.error('Store.upsert (Firebase)',e);}
    }
    return 'local';
  },
  async remove(dateStr){
    try{
      const hist=JSON.parse(localStorage.getItem('cashHistory')||'[]').filter(d=>d.date!==dateStr);
      localStorage.setItem('cashHistory',JSON.stringify(hist));
    }catch(_){ }
    if(fbOk&&db){
      try{await db.ref(`${RTDB_NODE}/${labelToRtdbKey(dateStr)}`).remove();}
      catch(e){console.error('Store.remove (Firebase)',e);}
    }
  },
  // ── dataset bruto completo por dia (alimenta o dashboard inteiro) ──
  async saveRaw(dateStr,raw){
    await whenAuthReady();
    const key=labelToRtdbKey(dateStr);
    const all=localRaws(); all[key]=raw; setLocalRaws(all);
    if(fbOk&&db){
      try{await db.ref(`${RTDB_DATA}/${key}`).set(fbPack(raw)); bumpRawRev(); return 'cloud';}
      catch(e){console.error('Store.saveRaw (Firebase)',e);}
    }
    return 'local';
  },
  async listRaw(){
    await whenAuthReady();
    let fb=null;
    if(fbOk&&db){
      try{
        // Lê só o carimbo de versão (bytes) e reaproveita o cache quando nada mudou.
        // Sem isso, o dataset INTEIRO descia a cada chamada (Modo TV: a cada 5 min).
        const rev=(await db.ref(RTDB_REV).once('value')).val();
        if(_rawCache && _rawCache.rev===rev){
          fb=_rawCache.fb;                                    // cache-hit → zero download pesado
        }else{
          fb=fbUnpack((await db.ref(RTDB_DATA).once('value')).val()||{});
          _rawCache={rev,fb};                                 // só rebaixa quando o rev mudou
        }
      }catch(e){console.error('Store.listRaw (Firebase)',e);}
    }
    const local=localRaws();
    const merged={...local,...(fb||{})};
    // re-sync: dias presos só no localStorage sobem pro Firebase em background
    if(fb!==null&&fbOk&&db){
      const orphans=Object.keys(local).filter(k=>!(k in fb));
      orphans.forEach(k=>{
        db.ref(`${RTDB_DATA}/${k}`).set(fbPack(local[k]))
          .then(()=>console.info('Store.listRaw: dia re-sincronizado →',k))
          .catch(e=>console.error('Store.listRaw re-sync',k,e));
      });
      if(orphans.length) bumpRawRev();                         // subiu dia novo → invalida cache/rev
    }
    const out={};
    Object.entries(merged).forEach(([k,v])=>{const h=hydrateRaw(v);if(h)out[k]=h;});
    return out;
  },
  async removeRaw(dateStr){
    const key=labelToRtdbKey(dateStr);
    const all=localRaws(); delete all[key]; setLocalRaws(all);
    if(fbOk&&db){
      try{await db.ref(`${RTDB_DATA}/${key}`).remove(); bumpRawRev();}
      catch(e){console.error('Store.removeRaw (Firebase)',e);}
    }
  }
};

const REQUIRED_COLUMNS=['Start Time','Fee','Total Buyin','Players','Hands','Game Type'];
function validateColumns(firstRow){
  const missing=REQUIRED_COLUMNS.filter(c=>!(c in firstRow));
  if(missing.length)throw new Error(`Colunas ausentes na planilha: ${missing.join(', ')}. Confira se é o mesmo formato do relatório G.U GAME STAT.`);
}

// ══════════════════════════════ REAL XLSX PARSING
function readRowsFromFile(file){
  // SheetJS sob demanda: baixa só quando o operador importa a 1ª planilha
  return ensureXLSX().then(()=> new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error);
    reader.onload=e=>{
      try{
        const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
        const sheet=wb.Sheets[wb.SheetNames[0]];
        const raw=XLSX.utils.sheet_to_json(sheet,{defval:null});
        if(!raw.length)throw new Error('A planilha está vazia.');
        validateColumns(raw[0]);
        resolve(raw.map(normalizeRow).filter(r=>r.startTime));
      }catch(err){reject(err)}
    };
    reader.readAsArrayBuffer(file);
  }));
}
function toDate(v){
  if(v==null)return null;
  if(v instanceof Date)return v;
  if(typeof v==='number')return new Date(Math.round((v-25569)*86400*1000));
  const s=String(v).trim();if(!s)return null;
  const d=new Date(s.replace(' ','T'));
  return isNaN(d)?null:d;
}
function normalizeRow(r){
  return{
    sala:r['Creator Name']||'',
    gameName:r['Game Name']||'',
    gameType:r['Game Type']||'',
    startTime:toDate(r['Start Time']),
    endTime:toDate(r['End Time']),
    fee:Number(r['Fee'])||0,
    adminFee:Number(r['Admin Fee'])||0,
    buyin:Number(r['Total Buyin'])||0,
    players:Number(r['Players'])||0,
    hands:Number(r['Hands'])||0,
    bigBlind:Number(r['Big Blind(GU)'])||0,
    ante:Number(r['Ante(GU)'])||0,
    jackpotFee:Number(r['Jackpot Fee(GU)'])||0,
    jackpotPayout:Number(r['Jackpot Payout(GU)'])||0,
  };
}
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dateLabel(d){return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()}
const DEAD_HANDS_THRESHOLD=10;
function summarizeDay(rows){
  const sessions=rows.length;
  const feeGross=rows.reduce((a,r)=>a+r.fee,0)*GU_TO_BRL;
  const jackpot=rows.reduce((a,r)=>a+r.jackpotFee,0)*GU_TO_BRL;
  const buyin=rows.reduce((a,r)=>a+r.buyin,0)*GU_TO_BRL;
  const players=rows.reduce((a,r)=>a+r.players,0);
  const hands=rows.reduce((a,r)=>a+r.hands,0);
  const dead=rows.filter(r=>r.hands<DEAD_HANDS_THRESHOLD).length;
  return{
    sessions,fee:feeGross,netFee:feeGross-jackpot,buyin,players,
    feePerHand:hands?feeGross/hands:0,
    deadPct:sessions?+(dead/sessions*100).toFixed(1):0,
    takeRate:buyin?+(feeGross/buyin*100).toFixed(2):0,
    shift:'Dia + Noite'
  };
}
function diffSummary(oldS,newS){
  const feeDelta=((newS.fee-oldS.fee)/(oldS.fee||1)*100);
  return`sessões ${oldS.sessions} → ${newS.sessions} · fee R$ ${f(oldS.fee,0)} → R$ ${f(newS.fee,0)} (${feeDelta>=0?'+':''}${f(feeDelta,1)}%)`;
}
async function upsertWithDuplicateCheck(dateStr,summary){
  const existing=(await Store.list()).find(d=>d.date===dateStr);
  if(existing){
    const ok=confirm(`Já existe um registro para ${dateStr}.\n\n${diffSummary(existing,summary)}\n\nSubstituir pelos novos dados?`);
    if(!ok)return false;
  }
  await Store.upsert(dateStr,summary);
  return true;
}
function setBtnLoading(labelEl,loading,loadingText){
  if(!labelEl)return;
  if(loading){labelEl.dataset.origText=labelEl.textContent;labelEl.textContent=loadingText;labelEl.closest('label,button')?.setAttribute('aria-busy','true');}
  else{if(labelEl.dataset.origText)labelEl.textContent=labelEl.dataset.origText;labelEl.closest('label,button')?.removeAttribute('aria-busy');}
}

// ══════════════════════════════ PIPELINE DE DADOS REAIS
// Reconstrói TODO o dataset do dashboard (mesma forma de KPI_DEMO + D) a partir
// das linhas cruas da planilha. O painel é CASH-ONLY: torneios (SNG-*, TLT-*,
// RODEO) são descartados. Fluxo: computeRaw(linhas) → bag aditivo por dia →
// mergeRaws([bags]) combina dias → finalizeDataset(bag) → {kpi, d} pronto.
// Valores monetários já saem em BRL (Fee/Buyin da planilha são GU → ×GU_TO_BRL).
// Cash = SÓ ring games. Torneios (SNG, MTT, TLT) e RODEO ficam de fora do cash.
// Antes o MTT não era excluído e torneios contavam como cash indevidamente.
const CASH_EXCLUDE=/^(SNG|MTT|TLT)/i;
function isCashType(t){ t=String(t||'').trim(); return t && !CASH_EXCLUDE.test(t) && t.toUpperCase()!=='RODEO'; }
// Eventos marcados no Game Name: [LIVE] (ao vivo) e [HG] (home game). Lidos
// SEMPRE, separados do cash, com resumo próprio e combinável com o cash.
function eventTag(name){ var s=String(name||''); if(/^\s*\[LIVE\]/i.test(s))return 'live'; if(/^\s*\[HG\]/i.test(s))return 'hg'; return null; }
function cleanEventName(name){ return String(name||'').replace(/^\s*\[(LIVE|HG)\]\s*/i,'').replace(/\s*\(\d+\)\s*$/,'').trim()||'—'; }
function slotIdx(d){ return d.getHours()*2 + (d.getMinutes()>=30?1:0); }
function slotLabel(i){ return String(Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'30':'00'); }
// Tier por Big Blind em GU (mesma régua da UI: Micro BB≤0.05 … VHigh BB>5 = R$25)
function tierOf(bb){ bb=+bb||0; return bb<=0.05?'Micro':bb<=0.5?'Low':bb<=2?'Mid':bb<=5?'High':'VHigh'; }
const TIER_ORDER=['Micro','Low','Mid','High','VHigh'];
// Nome da SALA = Game Name sem os sufixos "(n)" / "(id)" finais
function roomName(gn){ let c=String(gn||'').trim(); c=c.replace(/\s*\(\d+\)\s*$/,'').replace(/\s*\(\d+\)\s*$/,''); return c||'—'; }
function durHours(r){ return (r.endTime&&r.startTime)?Math.max(0,(r.endTime-r.startTime)/36e5):0; }

function newRaw(dateStr){
  return {
    dates:dateStr?[dateStr]:[], days:1,
    n:0, feeGross:0, buyin:0, players:0, hands:0, jackpot:0, dead:0, jackpotTables:0,
    slots:Array.from({length:48},()=>({tables:0,fee:0,players:0,hands:0,dead:0})),
    end:Array.from({length:48},()=>0),
    conc:Array.from({length:24},()=>0),
    gt:{}, op:{}, room:{}, blind:{}, dur:{}, tier:{}, feeRate:{},
    hu:{tables:0,fee:0,hands:0,buyin:0,players:0,durSum:0,retained:0},
    multi:{tables:0,fee:0,hands:0,buyin:0,players:0,durSum:0,retained:0},
    ante:{tables:0,fee:0,hands:0,retained:0}, noante:{tables:0,fee:0,hands:0,retained:0},
    cross:0, tables4h:0, fee4h:0, more100:0, more500:0,
    feeDia:0,feeNoite:0,tablesDia:0,tablesNoite:0,deadDia:0,deadNoite:0,handsDia:0,handsNoite:0,
    hphList:[], feeList:[], topN:[],
    // eventos [LIVE]/[HG] — torneios marcados, separados do cash
    ev:{ live:{n:0,fee:0,buyin:0,players:0,hands:0}, hg:{n:0,fee:0,buyin:0,players:0,hands:0}, byType:{}, list:[] }
  };
}
const DURB=['30-60m','1-2h','2-4h','4h+'];
function durBucket(h){ return h<1?'30-60m':h<2?'1-2h':h<4?'2-4h':'4h+'; }
function rateBucket(rr){ return rr<3?'0–3%':rr<6?'3–6%':rr<9?'6–9%':rr<12?'9–12%':'12%+'; }

function computeRaw(allRows, dateStr){
  const GU=GU_TO_BRL, R=newRaw(dateStr);
  // ── eventos [LIVE]/[HG] (torneios marcados no Game Name) — sempre lidos,
  //    agregados à parte do cash ──
  for(const r of allRows){
    if(!r.startTime)continue;
    const tag=eventTag(r.gameName); if(!tag)continue;
    const fee=(r.fee||0)*GU, buyin=(r.buyin||0)*GU;
    const bag=R.ev[tag]; bag.n++; bag.fee+=fee; bag.buyin+=buyin; bag.players+=r.players||0; bag.hands+=r.hands||0;
    const bt=R.ev.byType[r.gameType]||(R.ev.byType[r.gameType]={n:0,fee:0,buyin:0}); bt.n++; bt.fee+=fee; bt.buyin+=buyin;
    R.ev.list.push({name:cleanEventName(r.gameName),tag:tag,type:r.gameType,players:r.players||0,buyin:Math.round(buyin),fee:Math.round(fee),start_h:r.startTime.getHours()});
  }
  // cash = ring games, excluindo os eventos marcados
  const rows=allRows.filter(r=>r.startTime && isCashType(r.gameType) && !eventTag(r.gameName));
  for(const r of rows){
    const fee=(r.fee||0)*GU, buyin=(r.buyin||0)*GU, jp=(r.jackpotFee||0)*GU;
    const isDead=(r.hands||0)<DEAD_HANDS_THRESHOLD, ret=isDead?0:1;
    const dh=durHours(r), sh=shiftOf(r.startTime.getHours());
    R.n++; R.feeGross+=fee; R.buyin+=buyin; R.players+=r.players||0; R.hands+=r.hands||0; R.jackpot+=jp;
    if(isDead)R.dead++; if(jp)R.jackpotTables++;
    // slots de início (30min)
    const si=slotIdx(r.startTime), sl=R.slots[si];
    sl.tables++; sl.fee+=fee; sl.players+=r.players||0; sl.hands+=r.hands||0; if(isDead)sl.dead++;
    if(r.endTime)R.end[slotIdx(r.endTime)]++;
    // concorrência: horas que a sessão cobre
    if(r.endTime){ let h0=r.startTime.getHours(), h1=r.endTime.getHours(); let span=(h1-h0+24)%24;
      for(let k=0;k<=span&&k<24;k++)R.conc[(h0+k)%24]++; } else R.conc[r.startTime.getHours()]++;
    // turno
    if(sh==='dia'){R.feeDia+=fee;R.tablesDia++;R.handsDia+=r.hands||0;if(isDead)R.deadDia++;}
    else{R.feeNoite+=fee;R.tablesNoite++;R.handsNoite+=r.hands||0;if(isDead)R.deadNoite++;}
    if(r.endTime && sh!==shiftOf(r.endTime.getHours()))R.cross++;
    // game type
    const g=R.gt[r.gameType]||(R.gt[r.gameType]={tables:0,fee:0,buyin:0,players:0,hands:0,durSum:0});
    g.tables++;g.fee+=fee;g.buyin+=buyin;g.players+=r.players||0;g.hands+=r.hands||0;g.durSum+=dh;
    // operador × turno (Creator Name)
    const opk=(r.sala||'—')+'|'+sh, o=R.op[opk]||(R.op[opk]={op:r.sala||'—',turno:sh,tables:0,fee:0,players:0,dead:0});
    o.tables++;o.fee+=fee;o.players+=r.players||0;if(isDead)o.dead++;
    // sala
    const rn=roomName(r.gameName), rm=R.room[rn]||(R.room[rn]={tables:0,fee:0,buyin:0,players:0,hands:0});
    rm.tables++;rm.fee+=fee;rm.buyin+=buyin;rm.players+=r.players||0;rm.hands+=r.hands||0;
    // blind
    const bk=String(r.bigBlind||0), bl=R.blind[bk]||(R.blind[bk]={bb:+r.bigBlind||0,tables:0,fee:0});
    bl.tables++;bl.fee+=fee;
    // duração
    const dbk=durBucket(dh), db=R.dur[dbk]||(R.dur[dbk]={tables:0,fee:0,dead:0,retained:0});
    db.tables++;db.fee+=fee;if(isDead)db.dead++;db.retained+=ret;
    if(dh>=4){R.tables4h++;R.fee4h+=fee;}
    // tier
    const tk=tierOf(r.bigBlind), tr=R.tier[tk]||(R.tier[tk]={tables:0,fee:0,buyin:0,players:0,hands:0,dead:0,retained:0});
    tr.tables++;tr.fee+=fee;tr.buyin+=buyin;tr.players+=r.players||0;tr.hands+=r.hands||0;if(isDead)tr.dead++;tr.retained+=ret;
    // HU × Multi
    const bag=(r.players||0)<=2?R.hu:R.multi;
    bag.tables++;bag.fee+=fee;bag.hands+=r.hands||0;bag.buyin+=buyin;bag.players+=r.players||0;bag.durSum+=dh;bag.retained+=ret;
    // Ante × sem ante
    const ab=(r.ante||0)>0?R.ante:R.noante; ab.tables++;ab.fee+=fee;ab.hands+=r.hands||0;ab.retained+=ret;
    // fee rate bucket
    const rr=buyin>0?fee/buyin*100:0, frk=rateBucket(rr), fr=R.feeRate[frk]||(R.feeRate[frk]={tables:0,fee:0});
    fr.tables++;fr.fee+=fee;
    if(fee>100)R.more100++; if(fee>500)R.more500++;
    if(dh>0)R.hphList.push((r.hands||0)/dh);
    R.feeList.push(fee);
    R.topN.push({name:r.gameName,type:r.gameType,players:r.players||0,hands:r.hands||0,fee,buyin,dur:+dh.toFixed(2),start_h:r.startTime.getHours()});
  }
  // mantém só o topo pra caber no armazenamento (concentração usa feeList inteiro)
  R.feeList.sort((a,b)=>b-a);
  R.topN.sort((a,b)=>b.fee-a.fee); R.topN=R.topN.slice(0,60);
  return R;
}

function mergeRaws(list){
  const M=newRaw(null); M.days=0; M.dates=[];
  const addMap=(dst,src,init)=>{for(const k in src){const a=dst[k]||(dst[k]=init());for(const p in src[k])a[p]+=src[k][p];}};
  for(const R of list){
    M.dates=M.dates.concat(R.dates); M.days+=R.days||1;
    ['n','feeGross','buyin','players','hands','jackpot','dead','jackpotTables','cross','tables4h','fee4h','more100','more500',
     'feeDia','feeNoite','tablesDia','tablesNoite','deadDia','deadNoite','handsDia','handsNoite'].forEach(k=>M[k]+=R[k]);
    for(let i=0;i<48;i++){['tables','fee','players','hands','dead'].forEach(p=>M.slots[i][p]+=R.slots[i][p]); M.end[i]+=R.end[i];}
    for(let i=0;i<24;i++)M.conc[i]+=R.conc[i];
    addMap(M.gt,R.gt,()=>({tables:0,fee:0,buyin:0,players:0,hands:0,durSum:0}));
    addMap(M.op,R.op,()=>({op:'',turno:'',tables:0,fee:0,players:0,dead:0}));
    addMap(M.room,R.room,()=>({tables:0,fee:0,buyin:0,players:0,hands:0}));
    addMap(M.blind,R.blind,()=>({bb:0,tables:0,fee:0}));
    addMap(M.dur,R.dur,()=>({tables:0,fee:0,dead:0,retained:0}));
    addMap(M.tier,R.tier,()=>({tables:0,fee:0,buyin:0,players:0,hands:0,dead:0,retained:0}));
    addMap(M.feeRate,R.feeRate,()=>({tables:0,fee:0}));
    ['hu','multi'].forEach(b=>['tables','fee','hands','buyin','players','durSum','retained'].forEach(p=>M[b][p]+=R[b][p]));
    ['ante','noante'].forEach(b=>['tables','fee','hands','retained'].forEach(p=>M[b][p]+=R[b][p]));
    M.hphList=M.hphList.concat(R.hphList); M.feeList=M.feeList.concat(R.feeList); M.topN=M.topN.concat(R.topN);
    // eventos [LIVE]/[HG]
    ['live','hg'].forEach(b=>['n','fee','buyin','players','hands'].forEach(p=>M.ev[b][p]+=R.ev[b][p]));
    addMap(M.ev.byType,R.ev.byType,()=>({n:0,fee:0,buyin:0}));
    M.ev.list=M.ev.list.concat(R.ev.list);
    // preserva rótulos op/blind ao mesclar
    for(const k in R.op){M.op[k].op=R.op[k].op;M.op[k].turno=R.op[k].turno;}
    for(const k in R.blind){M.blind[k].bb=R.blind[k].bb;}
  }
  M.feeList.sort((a,b)=>b-a); M.topN.sort((a,b)=>b.fee-a.fee); M.topN=M.topN.slice(0,60);
  return M;
}

function finalizeDataset(R, label){
  const days=R.days||1, pct=(a,b)=>b?+(a/b*100).toFixed(1):0, safe=(a,b)=>b?a/b:0;
  const conc=p=>{const k=Math.max(1,Math.ceil(R.n*p/100)); let s=0; for(let i=0;i<k&&i<R.feeList.length;i++)s+=R.feeList[i];
    return {tables:k,fee:Math.round(s),pct:pct(s,R.feeGross)};};
  const c1=conc(1),c5=conc(5),c10=conc(10),c20=conc(20);
  // Jackpot Fee pode vir NEGATIVO na planilha (contribuição p/ o pool). O que
  // importa é a magnitude deduzida do fee bruto → feeNet = bruto − |jackpot|.
  const jkAbs=Math.abs(R.jackpot);
  const perc=(arr,p)=>{if(!arr.length)return 0;const a=arr.slice().sort((x,y)=>x-y);return +a[Math.min(a.length-1,Math.floor(a.length*p))].toFixed(1);};
  const kpi={
    date: label || R.dates.slice().sort().join(' + ') || '—',
    sessions:R.n, playersTotal:R.players, buyinTotal:Math.round(R.buyin),
    feeGross:Math.round(R.feeGross), feeNet:Math.round(R.feeGross-jkAbs),
    jackpot:Math.round(jkAbs), jackpotPct:pct(jkAbs,R.feeGross), jackpotTables:R.jackpotTables,
    takeRate:+pct(R.feeGross,R.buyin).toFixed(2),
    feeDia:Math.round(R.feeDia), feeNoite:Math.round(R.feeNoite),
    feeDiaPct:pct(R.feeDia,R.feeGross), feeNoitePct:pct(R.feeNoite,R.feeGross),
    tablesDia:R.tablesDia, tablesNoite:R.tablesNoite,
    deadTables:R.dead, deadPct:pct(R.dead,R.n), deadDia:R.deadDia, deadNoite:R.deadNoite,
    feePerHand:+safe(R.feeGross,R.hands).toFixed(2),
    feePerHandDia:+safe(R.feeDia,R.handsDia).toFixed(2), feePerHandNoite:+safe(R.feeNoite,R.handsNoite).toFixed(2),
    feePerActiveTable:+safe(R.feeGross,R.n-R.dead).toFixed(1),
    crossShift:R.cross, crossShiftPct:pct(R.cross,R.n),
    conc1pct:c1.pct,conc1Fee:c1.fee,conc1Tables:c1.tables,
    conc5pct:c5.pct,conc5Fee:c5.fee,conc5Tables:c5.tables,
    conc10pct:c10.pct,conc10Fee:c10.fee,conc10Tables:c10.tables,
    conc20pct:c20.pct,conc20Fee:c20.fee,conc20Tables:c20.tables,
    huTables:R.hu.tables,huFee:Math.round(R.hu.fee),huFph:+safe(R.hu.fee,R.hu.hands).toFixed(3),
    huRet:pct(R.hu.retained,R.hu.tables),huBpp:+safe(R.hu.buyin,R.hu.players).toFixed(1),huHph:+safe(R.hu.hands,R.hu.durSum).toFixed(1),
    multiTables:R.multi.tables,multiFee:Math.round(R.multi.fee),multiFph:+safe(R.multi.fee,R.multi.hands).toFixed(3),
    multiRet:pct(R.multi.retained,R.multi.tables),multiBpp:+safe(R.multi.buyin,R.multi.players).toFixed(1),multiHph:+safe(R.multi.hands,R.multi.durSum).toFixed(1),
    multiRetTables:Math.round(R.multi.retained),
    anteTables:R.ante.tables,anteFee:Math.round(R.ante.fee),anteFph:+safe(R.ante.fee,R.ante.hands).toFixed(3),anteRet:pct(R.ante.retained,R.ante.tables),
    noAnteTables:R.noante.tables,noAnteFee:Math.round(R.noante.fee),noAnteFph:+safe(R.noante.fee,R.noante.hands).toFixed(3),noAnteRet:pct(R.noante.retained,R.noante.tables),
    tables4hPlus:R.tables4h,fee4hPlus:Math.round(R.fee4h),fee4hPct:pct(R.fee4h,R.feeGross),
    tablesMoreThan100:R.more100,tablesMoreThan500:R.more500,
    handsPerHourP25:perc(R.hphList,.25),handsPerHourP50:perc(R.hphList,.50),handsPerHourP90:perc(R.hphList,.90),
    feeRateB:['0–3%','3–6%','6–9%','9–12%','12%+'].map(r=>({r,t:(R.feeRate[r]||{}).tables||0,fee:Math.round((R.feeRate[r]||{}).fee||0)})),
    peakConcurrent:0,peakHour:'',bestSlot:'',bestSlotEff:0
  };
  // concorrência média por hora (somada entre dias → média)
  const concAvg=R.conc.map((v,h)=>({h,open:Math.round(v/days)}));
  const pk=concAvg.reduce((a,b)=>b.open>a.open?b:a,{open:0,h:0});
  kpi.peakConcurrent=pk.open; kpi.peakHour=pk.h+'h';
  // slots (média por dia p/ combinação; 1 dia = valores do dia)
  const slots30=R.slots.map((s,i)=>({slot:slotLabel(i),turno:shiftOf(Math.floor(i/2)),
    tables:Math.round(s.tables/days),fee:Math.round(s.fee/days),players:Math.round(s.players/days),hands:Math.round(s.hands/days),dead:Math.round(s.dead/days)}));
  const best=slots30.reduce((a,b)=>b.fee>a.fee?b:a,{fee:-1}); kpi.bestSlot=best.slot||'';
  kpi.bestSlotEff=best.tables?+((1-best.dead/best.tables)*100).toFixed(1):0;
  const end30=R.end.map((t,i)=>({slot:slotLabel(i),tables:Math.round(t/days)}));
  const gametypes=Object.entries(R.gt).map(([type,g])=>({type,tables:g.tables,fee:Math.round(g.fee),buyin:Math.round(g.buyin),
    players:g.players,hands:g.hands,avg_dur:+safe(g.durSum,g.tables).toFixed(2),rake_rate:+pct(g.fee,g.buyin).toFixed(2)})).sort((a,b)=>b.fee-a.fee);
  const opShift=Object.values(R.op).map(o=>({op:o.op,turno:o.turno,tables:o.tables,fee:Math.round(o.fee),players:o.players,dead:o.dead}));
  const rooms=Object.entries(R.room).map(([name,r])=>({name,tables:r.tables,fee:Math.round(r.fee),buyin:Math.round(r.buyin),
    players:r.players,hands:r.hands,rake_rate:+pct(r.fee,r.buyin).toFixed(2)})).sort((a,b)=>b.fee-a.fee).slice(0,15);
  const blinds=Object.values(R.blind).map(b=>({bb:b.bb,tables:b.tables,fee:Math.round(b.fee)})).sort((a,b)=>b.tables-a.tables).slice(0,8);
  const duration=DURB.filter(b=>R.dur[b]).map(b=>{const d=R.dur[b];return {bucket:b,tables:d.tables,fee:Math.round(d.fee),dead:d.dead,ret:+pct(d.retained,d.tables).toFixed(1)};});
  const tiers=TIER_ORDER.filter(t=>R.tier[t]).map(t=>{const x=R.tier[t];return {tier:t,tables:x.tables,fee:Math.round(x.fee),buyin:Math.round(x.buyin),
    players:x.players,hands:x.hands,dead:x.dead,ret_pct:+pct(x.retained,x.tables).toFixed(1),
    avg_fph:+safe(x.fee,x.hands).toFixed(4),avg_fpp:+safe(x.fee,x.players).toFixed(2),avg_bpp:+safe(x.buyin,x.players).toFixed(1),rake_rate:+pct(x.fee,x.buyin).toFixed(2)};});
  const fpp=Object.entries(R.gt).map(([type,g])=>({type,fpp:+safe(g.fee,g.players).toFixed(2),tables:g.tables})).sort((a,b)=>b.fpp-a.fpp).slice(0,8);
  const top10=R.topN.slice(0,10).map(t=>({name:t.name,type:t.type,players:t.players,hands:t.hands,fee:Math.round(t.fee),buyin:Math.round(t.buyin),dur:t.dur,start_h:t.start_h}));
  const concurrent=concAvg;
  // ── eventos [LIVE]/[HG]: resumo próprio + combinável com o cash ──
  const ev=R.ev;
  const events={
    live:{n:ev.live.n,fee:Math.round(ev.live.fee),buyin:Math.round(ev.live.buyin),players:ev.live.players,hands:ev.live.hands},
    hg:{n:ev.hg.n,fee:Math.round(ev.hg.fee),buyin:Math.round(ev.hg.buyin),players:ev.hg.players,hands:ev.hg.hands},
    total:{n:ev.live.n+ev.hg.n,fee:Math.round(ev.live.fee+ev.hg.fee),buyin:Math.round(ev.live.buyin+ev.hg.buyin),players:ev.live.players+ev.hg.players,hands:ev.live.hands+ev.hg.hands},
    byType:Object.entries(ev.byType).map(function(e){return {type:e[0],n:e[1].n,fee:Math.round(e[1].fee),buyin:Math.round(e[1].buyin)};}).sort(function(a,b){return b.fee-a.fee;}),
    list:ev.list.slice().sort(function(a,b){return b.fee-a.fee;}).slice(0,50)
  };
  return {kpi, d:{slots30,end30,concurrent,gametypes,opShift,rooms,blinds,duration,top10,tiers,fpp,events}};
}

// ══════════════════════════════ ABA EVENTOS [LIVE]/[HG]
function buildEventos(){
  const host=document.getElementById('evBody'); if(!host)return;
  const ev=D.events;
  if(!ev || !ev.total || !ev.total.n){
    host.innerHTML='<div class="card" style="text-align:center;padding:44px 16px">'
      +'<div style="font-size:28px;color:var(--ink3);margin-bottom:10px"><i class="ph ph-confetti"></i></div>'
      +'<div style="font-size:12px;color:var(--ink3)">Nenhum torneio [LIVE] ou [HG] nos dias selecionados.<br>Importe uma planilha que contenha esses eventos.</div></div>';
    return;
  }
  const cashFee=KPI_DEMO.feeGross||0, cashSess=KPI_DEMO.sessions||0;
  const totFee=cashFee+ev.total.fee, totCount=cashSess+ev.total.n;
  const kc=(cls,l,v,s)=>`<div class="kpi ${cls}"><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s}</div></div>`;
  const kpis=[
    kc('hero','Fee eventos','R$ '+f(ev.total.fee,0),`${f(ev.total.n)} torneios · buyin R$ ${fK(ev.total.buyin)}`),
    kc('c-dia','[LIVE] ao vivo','R$ '+f(ev.live.fee,0),`${f(ev.live.n)} torneios · ${f(ev.live.players)} entradas`),
    kc('c-gold','[HG] home games','R$ '+f(ev.hg.fee,0),`${f(ev.hg.n)} torneios · ${f(ev.hg.players)} entradas`),
    kc('','Entradas totais',f(ev.total.players),'jogadores nos eventos')
  ].join('');
  const combined=`<div class="card"><div class="ct">Cash + Eventos — operação combinada</div>
    <div class="cs">Soma do rake das mesas cash com o fee dos torneios [LIVE]/[HG]</div>
    <div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${kc('','Fee cash','R$ '+f(cashFee,0),f(cashSess)+' sessões')}
      ${kc('','Fee eventos','R$ '+f(ev.total.fee,0),f(ev.total.n)+' torneios')}
      ${kc('hero','Fee total da operação','R$ '+f(totFee,0),f(totCount)+' partidas · eventos = '+(totFee?(ev.total.fee/totFee*100).toFixed(1):0)+'%')}
    </div></div>`;
  const byType=`<div class="card"><div class="ct">Eventos por tipo de jogo</div><div class="tw"><table class="t">
    <thead><tr><th>Tipo</th><th class="r">Torneios</th><th class="r">Fee</th><th class="r">Buyin</th></tr></thead><tbody>`
    +ev.byType.map(t=>`<tr><td class="b">${esc(t.type)}</td><td class="r m">${f(t.n)}</td><td class="r b">R$ ${f(t.fee,0)}</td><td class="r m">R$ ${f(t.buyin,0)}</td></tr>`).join('')
    +`</tbody></table></div></div>`;
  const list=`<div class="card"><div class="ct">Torneios [LIVE] / [HG] (top ${ev.list.length})</div><div class="tw"><table class="t">
    <thead><tr><th>Evento</th><th>Marca</th><th>Tipo</th><th class="r">Entradas</th><th class="r">Buyin</th><th class="r">Fee</th></tr></thead><tbody>`
    +ev.list.map(e=>`<tr><td class="b">${e.name}</td><td><span class="tag ${e.tag==='live'?'tn':'to'}">${e.tag.toUpperCase()}</span></td><td class="m">${e.type}</td><td class="r m">${f(e.players)}</td><td class="r m">R$ ${f(e.buyin,0)}</td><td class="r b">R$ ${f(e.fee,0)}</td></tr>`).join('')
    +`</tbody></table></div></div>`;
  host.innerHTML=`<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${kpis}</div>`+combined+`<div class="g2">${byType}${list}</div>`;
}

// ══════════════════════════════ APLICAÇÃO / SELETOR DE DIA
// Cada painel roda isolado: se um quebrar num dia atípico (poucas sessões,
// turno vazio…), os outros continuam renderizando em vez de travar tudo.
function safeBuild(fn){try{fn();}catch(e){console.error('render '+(fn.name||'?'),e);}}
function renderAll(){
  // Builders de turno removidos (renderShiftStats, buildBestSlots, buildShiftFee,
  // buildConcurrent, buildOpShiftTable, buildShiftRecs) — aba Turnos descontinuada.
  [renderOverviewStats,
   buildTimeline,buildHrChart,buildLifecycle,buildModal,buildOpDiv,buildTop10,buildRecs,
   buildForecast,
   buildTierCharts,buildConc,buildHuMulti,buildJP,buildFPP,
   buildRooms,buildRR,buildBlindBars,buildBubble,buildDeadBreakdown,
   buildRet,buildDurFee,buildHM,buildHist,buildMedias,
   buildResumo,buildEventos].forEach(safeBuild);
  // Inicializa tooltips para TODAS as visualizações
  setTimeout(initTooltips, 100);
}
function applyDataset(ds){
  // destrói os gráficos antigos antes de repintar (Chart.js recusa recriar sobre canvas em uso)
  document.querySelectorAll('canvas').forEach(cv=>{const ch=(window.Chart&&Chart.getChart)?Chart.getChart(cv):null; if(ch)ch.destroy();});
  Object.keys(KPI_DEMO).forEach(k=>delete KPI_DEMO[k]); Object.assign(KPI_DEMO, JSON.parse(JSON.stringify(ds.kpi)));
  Object.keys(D).forEach(k=>delete D[k]); Object.assign(D, JSON.parse(JSON.stringify(ds.d)));
  renderAll();
  detectShift();
  _hasRealData=true; refreshNoData();   // dataset real aplicado → esconde o estado-vazio
}

// ── ESTADO VAZIO (sem dados reais) — substitui o antigo fallback pro dia demo ──
// As abas diárias analíticas viviam da demo quando não havia import; agora mostram
// "Importe uma semana". Importar e as abas de roster (dados próprios) NÃO são
// cobertas — ficam acessíveis. O demo deixou de contabilizar em qualquer lugar.
let _hasRealData=false;
var NODATA_TABS=['resumo','dash','stakes','salas','eventos','player','medias','forecast'];
function activeTabId(){ var on=document.querySelector('.pg.on'); return on?on.id.replace(/^pg-/,''):''; }
function refreshNoData(){ try{ setNoData(!_hasRealData && NODATA_TABS.indexOf(activeTabId())>=0); }catch(e){} }
function setNoData(on){
  var el=document.getElementById('noDataScreen');
  if(!on){ if(el)el.style.display='none'; return; }
  if(!el){ el=document.createElement('div'); el.id='noDataScreen'; document.body.appendChild(el);
    el.innerHTML='<div style="max-width:460px;text-align:center;color:var(--ink3)">'
      +'<div style="font-size:40px;margin-bottom:12px;color:var(--gold)">♠</div>'
      +'<div style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:6px">Sem dados reais ainda</div>'
      +'<div style="font-size:12.5px;line-height:1.6;margin-bottom:16px">O dia de demonstração não é contabilizado. Importe uma semana — ou marque dias no seletor do cabeçalho — para ver o dashboard com os seus números.</div>'
      +'<button onclick="cashGoImport()" style="background:var(--gold);border:none;border-radius:9px;color:#000;height:38px;padding:0 18px;font-weight:700;cursor:pointer">Importar Semana</button>'
      +'</div>';
  }
  var hdr=document.querySelector('header'); var top=hdr?Math.round(hdr.getBoundingClientRect().bottom):72;
  el.style.cssText='position:fixed;left:0;right:0;bottom:0;top:'+top+'px;z-index:35;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto';
  el.style.background=getComputedStyle(document.body).backgroundColor||'#0e100e';
  el.style.display='flex';
}
window.cashGoImport=function(){ var bs=document.querySelectorAll('.nav .nt'), b=null; bs.forEach(function(x){ if(/Importar/i.test(x.textContent))b=x; }); if(b)b.click(); else try{pg('validar');}catch(e){} };
// ══════════════════════════════ SELEÇÃO DE DIAS (checklist)
// Substitui o antigo <select> single. O recorte da operação agora é POR DIAS: o
// usuário marca quais dias importados alimentam TODAS as visualizações. Recombina
// via mergeRaws → finalizeDataset → applyDataset (mesma infra do antigo "Todos os dias").
let _selDays = [];          // keys yyyy-mm-dd marcadas
let _rawsCache = {};        // último Store.listRaw()

function toggleDaysPop(force){
  const pop=document.getElementById('daysPop'), btn=document.getElementById('daysBtn');
  if(!pop)return;
  const show = force!=null ? force : pop.hidden;
  pop.hidden = !show;
  if(btn) btn.setAttribute('aria-expanded', show?'true':'false');
}
// fecha o popover ao clicar fora dele
document.addEventListener('click', e=>{
  const dp=document.getElementById('dayPicker');
  if(dp && !dp.contains(e.target)) toggleDaysPop(false);
});

// (re)carrega os dias do Store e desenha a lista. preselectAll=true marca todos.
async function refreshDays(preselectAll){
  _rawsCache = await Store.listRaw();
  const keys = Object.keys(_rawsCache);
  if(preselectAll) _selDays = keys.slice();
  else _selDays = _selDays.filter(k => _rawsCache[k]);   // descarta keys que sumiram
  renderDayChecklist();
  updateDaysBtnLabel();
}
function renderDayChecklist(){
  const list=document.getElementById('daysList'); if(!list)return;
  const keys=Object.keys(_rawsCache).sort().reverse();   // yyyy-mm-dd desc
  const DOW=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  if(!keys.length){
    list.innerHTML='<div style="padding:10px 6px;font-size:11px;color:var(--ink3);line-height:1.5">Nenhum dia importado ainda.<br>Suba uma planilha em <b>Importar Semana</b>.</div>';
    return;
  }
  list.innerHTML=keys.map(k=>{
    const r=_rawsCache[k], lbl=(r.dates&&r.dates[0])||k;
    const p=k.split('-'), dt=p.length===3?new Date(+p[0],+p[1]-1,+p[2]):null;
    const dow=dt&&!isNaN(dt)?DOW[dt.getDay()]:'';
    const on=_selDays.includes(k);
    return `<label style="display:flex;align-items:center;gap:9px;padding:7px 6px;border-radius:7px;cursor:pointer;font-size:12px;color:var(--ink)">
      <input type="checkbox" ${on?'checked':''} data-daykey="${esc(k)}" onchange="onDayCheck()" style="accent-color:var(--gold);width:15px;height:15px;flex:none">
      <span style="flex:1">${esc(lbl)}</span><span style="font-size:10px;font-weight:800;color:var(--ink3)">${dow}</span>
    </label>`;
  }).join('');
}
function onDayCheck(){
  _selDays=[...document.querySelectorAll('#daysList input[type=checkbox]:checked')].map(c=>c.dataset.daykey);
  updateDaysBtnLabel();
  applySelectedDays();
}
function selectAllDays(on){
  document.querySelectorAll('#daysList input[type=checkbox]').forEach(c=>{c.checked=!!on;});
  onDayCheck();
}
function updateDaysBtnLabel(){
  const el=document.getElementById('daysBtnLabel'); if(!el)return;
  const total=Object.keys(_rawsCache).length, n=_selDays.length;
  if(!total) el.textContent='Demonstração';
  else if(!n) el.textContent='Nenhum dia';
  else if(n===1){ const r=_rawsCache[_selDays[0]]; el.textContent=(r&&r.dates&&r.dates[0])||_selDays[0]; }
  else if(n===total) el.textContent=`Todos os dias (${n})`;
  else el.textContent=`${n} dias`;
}
// Recombina o dashboard a partir dos dias marcados (nenhum → demo).
function applySelectedDays(){
  const chosen=_selDays.map(k=>_rawsCache[k]).filter(Boolean);
  if(!chosen.length){ _hasRealData=false; refreshNoData(); return; }   // sem dias → estado-vazio (nada de demo)
  const label = chosen.length===1 ? ((chosen[0].dates&&chosen[0].dates[0])||_selDays[0]) : `${chosen.length} dias`;
  applyDataset(finalizeDataset(mergeRaws(chosen), label));
}
// No load: marca TODOS os dias importados (visão combinada, como antes); sem dias, segue na demo.
async function initDayView(){
  try{
    await refreshDays(true);
    if(Object.keys(_rawsCache).length) applySelectedDays();
    else { _hasRealData=false; refreshNoData(); }   // nenhum dia real → estado-vazio
  }catch(e){console.error('initDayView',e);}
}

// ══════════════════════════════ DAILY UPLOAD
async function handleUpload(input){
  const fl=input.files[0];if(!fl)return;
  const lbl=input.closest('label')?.querySelector('span');
  setBtnLoading(lbl,true,'Lendo…');
  try{
    const rows=await readRowsFromFile(fl);
    if(!rows.length){alert('Não encontrei sessões com Start Time válido nesse arquivo.');return;}
    const byDate={};
    rows.forEach(r=>{const k=dateKey(r.startTime);(byDate[k]=byDate[k]||[]).push(r);});
    const dates=Object.keys(byDate).sort();
    const mainKey=dates.reduce((a,b)=>byDate[b].length>byDate[a].length?b:a);
    const label=dateLabel(byDate[mainKey][0].startTime);
    // dataset cash-only completo do dia principal → alimenta o dashboard inteiro
    const raw=computeRaw(byDate[mainKey],label);
    if(!raw.n){alert('Nenhuma sessão CASH encontrada nesse arquivo (só torneios/SNG?).');return;}
    const ds=finalizeDataset(raw,label);
    const summary=summaryFromKpi(ds.kpi);
    const saved=await upsertWithDuplicateCheck(label,summary);
    if(!saved)return;
    const where=await Store.saveRaw(label,raw);
    setBtnLoading(lbl,true,'Montando dashboard…');
    await refreshDays(false);      // atualiza a checklist de dias (upload diário legado)
    applyDataset(ds);
    await buildHist();
    const aviso=where==='local'
      ?'\n\n⚠ ATENÇÃO: não consegui gravar no Firebase (offline/erro). O dia ficou salvo só neste navegador e será re-sincronizado automaticamente na próxima leitura com conexão.'
      :'';
    alert(`${fl.name} importado.\n\n${label}: ${ds.kpi.sessions} sessões cash · R$ ${f(ds.kpi.feeGross,0)} fee bruto.\n\nO dashboard agora mostra este dia.${aviso}`);
  }catch(err){
    alert('Erro ao ler o arquivo: '+err.message);
  }finally{
    setBtnLoading(lbl,false);
    input.value='';
  }
}

// resumo do histórico (gráfico de tendência) derivado do dataset cash-only
function summaryFromKpi(kpi){
  return {sessions:kpi.sessions,fee:kpi.feeGross,netFee:kpi.feeNet,buyin:kpi.buyinTotal,
    players:kpi.playersTotal,feePerHand:kpi.feePerHand,deadPct:kpi.deadPct,takeRate:kpi.takeRate,shift:'Dia + Noite'};
}

// ══════════════════════════════ WEEKLY VALIDATION
// Relatório de validação (precisão + consistência) mostrado na aba Importar Semana.
// verde = tudo bate; amarelo = avisos (dados formam, mas confira); vermelho = erro
// que impede as visões de formarem certo. Vem de cash-ingest (meta.validation).
function renderValidationReport(v){
  if(!v) return '';
  const st=v.stats||{};
  const money=n=>'R$ '+f((+n||0)*GU_TO_BRL,0);
  const chips=`<div style="font-size:10.5px;color:var(--ink3);margin-top:6px;display:flex;flex-wrap:wrap;gap:10px">`
    +`<span>Mesas cash: <b>${f(st.cashTables||0)}</b></span>`
    +`<span>Com jogadores: <b>${f(st.tablesWithRoster||0)}</b></span>`
    +`<span>Fee resumo: <b>${money(st.feeSummary)}</b></span>`
    +`<span>Fee roster: <b>${money(st.feeRoster)}</b></span>`
    +`<span>Σ resultados: <b>${money(st.winSum)}</b> (≈ −rake ${money(st.winExpected)})</span>`
    +`<span>Assentos: <b>${f(st.seats||0)}</b></span></div>`;
  if(v.level==='ok'){
    return `<div style="margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.08)">`
      +`<div style="color:var(--green);font-weight:700">${ic('check-circle',1)} Dados validados — precisos e consistentes.</div>${chips}</div>`;
  }
  const color=v.level==='error'?'#ef4444':'#f59e0b';
  const bg=v.level==='error'?'rgba(239,68,68,.08)':'rgba(245,158,11,.08)';
  const title=v.level==='error'?'Erros de validação — corrigir o relatório antes de usar':'Avisos de consistência — confira antes de confiar nos números';
  const items=(v.issues||[]).map(x=>`<li style="margin:3px 0;color:${x.sev==='error'?'#ef4444':'var(--ink2,#cbd5e1)'}"><b>${x.sev==='error'?'ERRO':'aviso'}:</b> ${esc(x.msg)}</li>`).join('');
  return `<div style="margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid ${color}66;background:${bg}">`
    +`<div style="color:${color};font-weight:700">${ic('warning',1)} ${title}</div>`
    +`<ul style="margin:6px 0 0;padding-left:18px;font-size:11.5px;line-height:1.5">${items}</ul>${chips}</div>`;
}
let _weekRowsByDate=null;
async function handleValidateUpload(input){
  const fl=input.files[0];if(!fl)return;
  const status=document.getElementById('validarStatus');
  const barEl=document.getElementById('validarProgress');
  const setBar=p=>{ if(barEl)barEl.style.width=(p||0)+'%'; };
  // Leitura em STREAMING (cash-ingest, sem SheetJS): aguenta o relatório completo
  // (Game Detail de 1,27GB) SEM travar, e alimenta TUDO — dashboard diário + telas
  // de jogador (Mesas/Jogadores/Ecologia/Integridade/Rake) + compartilha.
  if(!window.cashRunIngest){ status.innerHTML=`${ic('x-circle',1)} Módulo de leitura não carregado. Dê um Ctrl+Shift+R e tente de novo.`; return; }
  status.innerHTML=`${ic('spinner',1)} Lendo planilha (streaming, sem travar)…`; setBar(3);
  try{
    const res=await window.cashRunIngest(fl,(m,p)=>{ status.innerHTML=`${ic('spinner',1)} ${esc(m)} (${p}%)`; setBar(p); });
    // 1) telas de jogador (roster) + cache local + compartilhar
    if(window.cashFeedRoster) window.cashFeedRoster(res.roster);
    // 2) pipeline diário: normaliza as linhas da Game Statistics e monta o preview
    const rows=(res.gameStats||[]).map(normalizeRow).filter(r=>r.startTime);
    if(!rows.length){status.innerHTML=`${ic('warning',1)} Nenhuma sessão com Start Time válido encontrada.`;setBar(0);return;}
    const byDate={};
    rows.forEach(r=>{const k=dateKey(r.startTime);(byDate[k]=byDate[k]||[]).push(r);});
    _weekRowsByDate=byDate;
    const existing=await Store.list();
    const dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const keys=Object.keys(byDate).sort();
    const tbl=document.getElementById('validarPreviewTbl');
    tbl.innerHTML=`<thead><tr><th>Data</th><th>Dia</th><th class="r">Sessões</th><th class="r">Fee Bruto (cash)</th><th class="r">Buyin (cash)</th><th class="r">Players</th><th></th></tr></thead><tbody>`+
      keys.map(k=>{
        const rs=byDate[k];const d=rs[0].startTime;const lbl=dateLabel(d);
        // preview CASH-ONLY (mesma conta do que é gravado: computeRaw filtra ring games)
        const kpi=finalizeDataset(computeRaw(rs,lbl),lbl).kpi;
        const s={sessions:kpi.sessions,fee:kpi.feeGross,buyin:kpi.buyinTotal,players:kpi.playersTotal};
        const dup=existing.find(x=>x.date===lbl);
        return`<tr><td class="b">${lbl}</td><td class="m">${dias[d.getDay()]}</td>
          <td class="r m">${f(s.sessions)}</td><td class="r b">R$ ${f(s.fee,0)}</td>
          <td class="r m">R$ ${f(s.buyin,0)}</td><td class="r m">${f(s.players)}</td>
          <td class="r">${dup?`<span class="tag to">${ic('arrows-clockwise')} substitui</span>`:`<span class="tag tn">${ic('plus')} novo</span>`}</td></tr>`;
      }).join('')+'</tbody>';
    document.getElementById('validarPreviewCard').style.display='block';
    setBar(100);
    const shared=(window.CashStore&&CashStore.available&&CashStore.available());
    const meta=(res.roster&&res.roster.meta)||{};
    const report=renderValidationReport(meta.validation);
    const hasErr=meta.validation&&meta.validation.level==='error';
    const headLine = hasErr
      ? `${ic('x-circle',1)} ${keys.length} dia(s) lidos, mas a <b>validação encontrou erros</b> — confira abaixo. A semana NÃO foi publicada p/ todos.`
      : `${ic('check-circle',1)} ${keys.length} dia(s) lidos · <b>telas de jogador já carregadas</b>${shared?' e publicadas p/ todos':' (salvo neste navegador)'}. Confira e confirme p/ gravar o histórico diário.`;
    status.innerHTML=`${headLine}${report}`;
  }catch(err){
    status.innerHTML=`${ic('x-circle',1)} Erro: ${err.message}`; setBar(0);
  }
}
async function confirmarSemana(){
  if(!_weekRowsByDate)return;
  const status=document.getElementById('validarStatus');
  const btn=document.querySelector('#validarPreviewCard .btn-p');
  if(btn){btn.disabled=true;btn.style.opacity='.6';}
  status.innerHTML=`${ic('spinner',1)} Gravando…`;
  const keys=Object.keys(_weekRowsByDate).sort();
  let localOnly=0;
  for(const k of keys){
    const rs=_weekRowsByDate[k];
    const label=dateLabel(rs[0].startTime);
    const raw=computeRaw(rs,label);
    if(!raw.n)continue; // dia só com torneios/SNG: sem dados cash
    await Store.upsert(label,summaryFromKpi(finalizeDataset(raw,label).kpi));
    if(await Store.saveRaw(label,raw)==='local')localOnly++;
  }
  await buildHist();
  await refreshDays(true);        // recarrega a checklist e marca todos os dias
  applySelectedDays();
  status.innerHTML=`${ic('check-circle',1)} ${keys.length} dia(s) gravados · dashboard mostrando "Todos os dias".`
    +(localOnly?` <span class="tag to">${ic('warning')} ${localOnly} dia(s) só neste navegador — Firebase indisponível, re-sync automático depois.</span>`:'');
  if(btn){btn.disabled=false;btn.style.opacity='';}
  _weekRowsByDate=null;
}

// ══════════════════════════════ EXPORT / DELETE HISTORY
async function exportHistory(){
  const hist=await Store.list();
  if(!hist.length){alert('Nenhum dado no histórico ainda.');return;}
  const blob=new Blob([JSON.stringify(hist,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`cash-history-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
// Exporta o RESUMO SEMANAL como um RELATÓRIO HTML autossuficiente (abre no
// navegador e "Salvar como PDF" → pronto pra reunião). Substituiu o CSV cru:
// KPIs médios, metas vs real, mesas perdidas, padrão por dia e a tabela diária,
// com a marca Suprema. Sem dependência de lib. Prévia se não houver semana real.
async function exportWeekSummary(){
  let days=[]; try{ days=await Store.list(); }catch(_){ }
  const real=(days||[]).filter(d=>d&&d.date&&!d.demo).sort((a,b)=>parseDateLabel(a.date)-parseDateLabel(b.date));
  const preview=real.length===0;
  const week=preview?[medPseudoDay()]:real.slice(-7);
  const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const avg=k=>week.reduce((a,d)=>a+(+d[k]||0),0)/week.length;
  const lostOf=d=>{const s=+d.sessions||0,dead=s*(+d.deadPct||0)/100,live=Math.max(1,s-dead);return{dead,cost:dead*((+d.fee||0)/live)};};
  const money=n=>'R$ '+f(n,0);
  const avgFee=avg('fee'),avgNet=avg('netFee'),avgSess=avg('sessions'),avgPl=avg('players'),avgFph=avg('feePerHand'),avgTake=avg('takeRate'),avgDead=avg('deadPct');
  const totLost=week.reduce((a,d)=>a+lostOf(d).cost,0), totDead=week.reduce((a,d)=>a+lostOf(d).dead,0);
  const avgLost=totLost/week.length, avgDeadT=totDead/week.length;
  const period = week.length>1 ? `${week[0].date} — ${week[week.length-1].date}` : (week[0].date||'—');
  const now=new Date(), stamp=`${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
  const gDead=+GOALS.deadPct||0,gFee=+GOALS.feeDia||0,gTake=+GOALS.takeRate||0;
  const kpi=(l,v,s)=>`<div class="kpi"><div class="kl">${esc(l)}</div><div class="kv">${v}</div><div class="ks">${s||''}</div></div>`;
  const metaRow=(label,goal,realTxt,pass)=>`<tr><td>${label}</td><td>${goal}</td><td>${realTxt}</td><td class="${pass?'ok':'bad'}">${pass?'✓ na meta':'✗ fora da meta'}</td></tr>`;
  const cnt=p=>week.filter(p).length;
  const metasBody=[
    gDead?metaRow('Mesas perdidas','≤ '+f(gDead,1)+'%',f(avgDead,1)+'%',avgDead<=gDead)+`<tr class="sub"><td colspan="4">${preview?'':`Placar: ${cnt(d=>(+d.deadPct||0)<=gDead)}/${week.length} dias na meta`}</td></tr>`:'',
    gFee?metaRow('Fee bruto/dia','≥ '+money(gFee),money(avgFee),avgFee>=gFee)+`<tr class="sub"><td colspan="4">${preview?'':`Placar: ${cnt(d=>(+d.fee||0)>=gFee)}/${week.length} dias na meta`}</td></tr>`:'',
    gTake?metaRow('Take rate','≥ '+f(gTake,1)+'%',f(avgTake,2)+'%',avgTake>=gTake)+`<tr class="sub"><td colspan="4">${preview?'':`Placar: ${cnt(d=>(+d.takeRate||0)>=gTake)}/${week.length} dias na meta`}</td></tr>`:'',
  ].join('');
  // padrão por dia da semana
  const byWD={}; if(!preview)week.forEach(d=>{const w=parseDateLabel(d.date).getDay();if(!byWD[w])byWD[w]={fee:0,dead:0,n:0};byWD[w].fee+=(+d.fee||0);byWD[w].dead+=(+d.deadPct||0);byWD[w].n++;});
  const wdRows=[1,2,3,4,5,6,0].filter(w=>byWD[w]).map(w=>`<tr><td>${WD[w]}</td><td class="r">${money(byWD[w].fee/byWD[w].n)}</td><td class="r">${f(byWD[w].dead/byWD[w].n,1)}%</td></tr>`).join('');
  // tabela diária
  const rows=week.map(d=>{const l=lostOf(d);return `<tr><td>${esc(d.date)}</td><td>${preview?'—':WD[parseDateLabel(d.date).getDay()]}</td><td class="r">${f(d.sessions)}</td><td class="r">${money(d.fee)}</td><td class="r">${money(d.netFee)}</td><td class="r">${f(d.players)}</td><td class="r">${(+d.feePerHand||0).toFixed(2)}</td><td class="r ${gDead&&(+d.deadPct||0)>gDead?'bad':''}">${f(d.deadPct,1)}%</td><td class="r">${f(d.takeRate,2)}%</td><td class="r">${money(l.cost)}</td></tr>`;}).join('');

  // ── comparativo de roster (semana vs anterior) — do índice/digests do CashStore ──
  let rosterCompareSec='';
  try{
    if(window.CashStore&&CashStore.available&&CashStore.available()){
      const list=await CashStore.listWeeks();
      const sorted=(list||[]).filter(w=>w&&w.key).sort((a,b)=>String(a.key).localeCompare(String(b.key)));
      if(sorted.length>=2){
        const last=sorted[sorted.length-1], prev=sorted[sorted.length-2];
        if(last.rake!=null && prev.rake!=null){
          const dpct=(c,p)=>{ if(!p) return '—'; const d=(c-p)/Math.abs(p)*100; return (d>=0?'+':'−')+Math.abs(d).toFixed(1)+'%'; };
          const dpp=(c,p)=>{ const d=(+c||0)-(+p||0); return (d>=0?'+':'−')+Math.abs(d).toFixed(2)+' pp'; };
          const rk=w=>money((+w.rake||0)*GU_TO_BRL);
          let retTxt='';
          try{
            const [d1,d2]=await Promise.all([CashStore.loadDigest(prev.key),CashStore.loadDigest(last.key)]);
            if(d1&&d2&&d1.ids&&d2.ids){ const cur={}; d2.ids.forEach(id=>cur[id]=1); let back=0; d1.ids.forEach(id=>{if(cur[id])back++;}); retTxt=(d1.ids.length?back/d1.ids.length*100:0).toFixed(1)+'%'; }
          }catch(_){}
          const tr=(l,cv,pv,dv)=>`<tr><td>${l}</td><td class="r">${cv}</td><td class="r">${pv}</td><td class="r">${dv}</td></tr>`;
          const body=tr('Rake',rk(last),rk(prev),dpct(last.rake,prev.rake))
            +tr('Jogadores únicos',f(last.players||0),f(prev.players||0),dpct(last.players||0,prev.players||0))
            +tr('Take rate',f(last.takeRate||0,2)+'%',f(prev.takeRate||0,2)+'%',dpp(last.takeRate,prev.takeRate))
            +tr('Assentos',f(last.seats||0),f(prev.seats||0),dpct(last.seats||0,prev.seats||0))
            +(retTxt?tr('Retenção de jogadores',retTxt,'—',''):'');
          rosterCompareSec=`<div class="sec">Roster — semana atual vs anterior</div>`
            +`<div class="note">${esc(last.week||last.key)} comparada com ${esc(prev.week||prev.key)}.</div>`
            +`<table><thead><tr><th>Métrica</th><th class="r">Atual</th><th class="r">Anterior</th><th class="r">Δ</th></tr></thead><tbody>${body}</tbody></table>`;
        }
      }
    }
  }catch(_){}

  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resumo Semanal — Mesa Cash · ${esc(period)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1c1a;background:#f4f2ec;padding:28px}
.sheet{max-width:900px;margin:0 auto;background:#fff;border:1px solid #e6e1d5;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px -18px rgba(0,0,0,.3)}
.hd{background:linear-gradient(120deg,#1a1c1a,#2a2c28);color:#f2ede2;padding:24px 28px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.hd .t{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c9a84c;font-weight:800}
.hd h1{font-size:22px;font-weight:800;margin-top:3px}
.hd .p{font-size:12.5px;color:rgba(242,237,226,.7);margin-top:4px}
.hd .meta{text-align:right;font-size:11px;color:rgba(242,237,226,.6)}
.bd{padding:24px 28px}
.sec{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8f6b2d;margin:22px 0 10px;border-bottom:1px solid #ece7db;padding-bottom:6px}
.sec:first-child{margin-top:0}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.kpi{border:1px solid #ece7db;border-radius:10px;padding:12px 14px;background:#faf8f2}
.kpi .kl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8a857a}
.kpi .kv{font-size:21px;font-weight:800;margin:3px 0 1px;font-variant-numeric:tabular-nums}
.kpi .ks{font-size:10px;color:#8a857a}
.hero{background:linear-gradient(120deg,#8f6b2d10,#c9a84c14);border-color:#dcc48a}
.lost{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.lost .b{border:1px solid #ece7db;border-radius:10px;padding:12px 14px}
.lost .b.red{border-color:#e7b3b3;background:#fbf1f1}
.lost .b .l{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8a857a}
.lost .b .v{font-size:20px;font-weight:800;margin-top:3px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:7px 10px;border-bottom:1px solid #eee7d8;text-align:left}
th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#8a857a;background:#faf8f2}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
td.ok{color:#1a7a44;font-weight:700}td.bad{color:#b4443a;font-weight:700}
tr.sub td{border:none;padding:2px 10px 8px;font-size:10.5px;color:#8a857a}
.note{font-size:10.5px;color:#8a857a;margin-top:8px;font-style:italic}
.ft{padding:16px 28px;border-top:1px solid #ece7db;font-size:10.5px;color:#9a958a;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
.pbtn{position:fixed;top:16px;right:16px;background:#8f6b2d;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px -6px rgba(0,0,0,.4)}
@media print{body{background:#fff;padding:0}.sheet{border:none;box-shadow:none;border-radius:0;max-width:none}.pbtn{display:none}}
</style></head><body>
<button class="pbtn" onclick="window.print()">🖨 Salvar como PDF</button>
<div class="sheet">
  <div class="hd">
    <div><div class="t">♠ Suprema · Mesa Cash</div><h1>Resumo Semanal</h1><div class="p">${esc(period)} · média por dia de ${week.length} dia(s)${preview?' · PRÉVIA (1 dia)':''}</div></div>
    <div class="meta">Gerado em ${stamp}</div>
  </div>
  <div class="bd">
    <div class="sec">Médias por dia</div>
    <div class="kpis">
      ${kpi('Fee bruto médio/dia',money(avgFee),'líquido '+money(avgNet))}
      ${kpi('Sessões médias/dia',f(avgSess),f(avgPl)+' players/dia')}
      ${kpi('Fee/mão médio','R$ '+f(avgFph,2),'take rate '+f(avgTake,2)+'%')}
    </div>
    <div class="sec">Mesas perdidas — o maior vazamento controlável</div>
    <div class="lost">
      <div class="b red"><div class="l">Custo de oportunidade / dia</div><div class="v">${money(avgLost)}</div></div>
      <div class="b red"><div class="l">Custo na semana</div><div class="v">${money(totLost)}</div></div>
      <div class="b"><div class="l">Recuperável (−20%)</div><div class="v" style="color:#1a7a44">+${money(avgLost*0.2)}/dia</div></div>
    </div>
    <div class="note">Custo de oportunidade é um teto: assume que a mesa perdida renderia como uma mesa viva média. Média de ${f(avgDead,1)}% de mesas perdidas (~${f(avgDeadT,0)}/dia). Retenção média ${f(100-avgDead,1)}%.</div>
    <div class="sec">Metas vs. real</div>
    ${(gDead||gFee||gTake)?`<table><thead><tr><th>Métrica</th><th>Meta</th><th>Real (média)</th><th>Status</th></tr></thead><tbody>${metasBody}</tbody></table>`:'<div class="note">Nenhuma meta definida no painel.</div>'}
    ${wdRows?`<div class="sec">Padrão por dia da semana</div><table><thead><tr><th>Dia</th><th class="r">Fee médio</th><th class="r">Mortas médias</th></tr></thead><tbody>${wdRows}</tbody></table>`:''}
    ${rosterCompareSec}
    <div class="sec">Detalhe por dia</div>
    <table><thead><tr><th>Data</th><th>Dia</th><th class="r">Sessões</th><th class="r">Fee bruto</th><th class="r">Fee líq.</th><th class="r">Players</th><th class="r">Fee/mão</th><th class="r">Mortas</th><th class="r">Take</th><th class="r">Custo perdido</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
  <div class="ft"><span>Suprema OS · Cash Intelligence</span><span>${preview?'Prévia com o dataset atual — importe a semana para números reais.':'Fonte: relatórios importados no painel Mesa Cash.'}</span></div>
</div></body></html>`;

  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`resumo-semanal-cash-${now.toISOString().slice(0,10)}.html`;
  a.click();URL.revokeObjectURL(url);
  if(typeof showToast==='function')try{showToast('Resumo gerado — abra o arquivo e "Salvar como PDF"');}catch(_){}
}
// Salva as metas (mortas/fee-dia/take rate) → Firebase (mesasCashGoals) e
// re-renderiza o que depende delas. Independente do upload de planilha.
function saveGoalsFromUI(){
  const num=id=>{ const e=document.getElementById(id); if(!e)return 0; const v=parseFloat(String(e.value).replace(',','.')); return isFinite(v)&&v>0?v:0; };
  const patch={
    deadPct: Math.min(60, num('goal_deadPct')),
    feeDia:  Math.max(0,  num('goal_feeDia')),
    takeRate:Math.min(30, num('goal_takeRate')),
  };
  const btn=document.getElementById('mdGoalSave'); if(btn){btn.disabled=true;btn.style.opacity='.6';}
  saveGoals(patch).then(()=>{
    if(typeof showToast==='function'){try{showToast('Metas salvas');}catch(_){}}
    try{buildMedias();}catch(_){} try{buildResumo();}catch(_){}
  }).finally(()=>{ if(btn){btn.disabled=false;btn.style.opacity='';} });
}
async function removeHistoryDay(dateStr){
  if(!confirm(`Remover o registro de ${dateStr} do histórico?`))return;
  await Store.remove(dateStr);
  await Store.removeRaw(dateStr);
  await buildHist();
  await refreshDays(false);       // remove o dia da checklist, preservando a seleção dos demais
  applySelectedDays();
}


// ══════════════════════════════ FORECAST PAGE
function buildForecast(){
  // ── Projection curve (12 months)
  const ctx1=document.getElementById('cFcCurve');if(!ctx1)return;
  const baseDay=KPI_DEMO.feeGross, netDay=KPI_DEMO.feeNet;
  const optDay=237611*GU_TO_BRL, aggDay=308247*GU_TO_BRL, badDay=baseDay*0.74;
  const months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const cumBase=[], cumOpt=[], cumAgg=[], cumNet=[], cumBad=[];
  for(let i=1;i<=12;i++){cumBase.push(baseDay*30*i);cumNet.push(netDay*30*i);cumOpt.push(optDay*30*i);cumAgg.push(aggDay*30*i);cumBad.push(badDay*30*i);}
  new Chart(ctx1,{type:'line',
    data:{labels:months,datasets:[
      {label:'Agressivo',data:cumAgg,borderColor:'#d4a853',borderWidth:2,fill:false,tension:.4,pointRadius:3,pointBackgroundColor:'#d4a853',borderDash:[6,3]},
      {label:'Otimista',data:cumOpt,borderColor:'#4f8ef7',borderWidth:2,fill:false,tension:.4,pointRadius:3,pointBackgroundColor:'#4f8ef7'},
      {label:'Base linear',data:cumBase,borderColor:CMUTE,borderWidth:1.5,fill:false,tension:.4,pointRadius:0,borderDash:[4,4]},
      {label:'Pessimista',data:cumBad,borderColor:'#f87171',borderWidth:2,fill:false,tension:.4,pointRadius:0,borderDash:[6,3]},
      {label:'Líquido (base)',data:cumNet,borderColor:'#34d399',borderWidth:1.5,fill:true,backgroundColor:'rgba(52,211,153,.05)',tension:.4,pointRadius:0,borderDash:[4,4]},
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},
        tooltip:{...CTOP,callbacks:{label:c=>` R$ ${fK(c.parsed.y)}`}}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT},border:{display:false}},
        y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>'R$ '+fK(v)},border:{display:false}}
      }
    }
  });

  // ── Stake composition donut
  const ctx2=document.getElementById('cFcStake');if(!ctx2)return;
  new Chart(ctx2,{type:'doughnut',
    data:{labels:['VHigh (BB>5)','High (BB 1-5)','Mid (BB 0.2-1)','Low (BB<0.2)','Micro'],
      datasets:[{data:['VHigh','High','Mid','Low','Micro'].map(t=>(D.tiers.find(x=>x.tier===t)||{}).fee||0),backgroundColor:['#d4a853','#fbbf24','#4f8ef7','#a78bfa',CMUTE],borderWidth:0,hoverOffset:8}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',
      plugins:{legend:{position:'right',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:8}},
        tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed,0)} (${(c.parsed/KPI_DEMO.feeGross*100).toFixed(1)}%)`}}}
    }
  });

  // ── Scenarios grid — inclui o CENÁRIO RUIM (pessimista) pra dimensionar o downside
  const scens=[
    {label:'Pessimista',color:'rgba(248,113,113,.12)',colorTxt:'var(--red)',desc:'+30% mortas · −18% sessões · fuga de VHigh',day:KPI_DEMO.feeGross*0.74,assumptions:['2.431 sessões/dia','31,9% de mortas','−R$ 287.154/dia']},
    {label:'Base linear',color:'rgba(255,255,255,.08)',colorTxt:CTEXT,desc:'Sem mudanças operacionais',day:KPI_DEMO.feeGross,assumptions:['2.965 sessões/dia','24,5% de mortas','fee/mão R$ 3,80']},
    {label:'Conservador',color:'rgba(79,142,247,.12)',colorTxt:'var(--dia)',desc:'−10% mortas · +5% sessões',day:237611*GU_TO_BRL,assumptions:['3.113 sessões/dia','22,0% de mortas','+R$ 83.615/dia']},
    {label:'Otimista',color:'rgba(52,211,153,.1)',colorTxt:'var(--green)',desc:'−20% mortas · +15% sessões',day:266460*GU_TO_BRL,assumptions:['3.410 sessões/dia','19,6% de mortas','+R$ 227.860/dia']},
    {label:'Agressivo',color:'rgba(212,168,83,.12)',colorTxt:'var(--gold)',desc:'−30% mortas · +30% sessões · +ante',day:308247*GU_TO_BRL,assumptions:['3.854 sessões/dia','17,1% de mortas','+R$ 436.795/dia']},
  ];
  const el=document.getElementById('scenGrid');if(!el)return;
  el.innerHTML=scens.map(s=>`
    <div style="background:${s.color};border:1px solid var(--bdr);border-radius:14px;padding:16px;position:relative;overflow:hidden">
      <div style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${s.colorTxt};margin-bottom:6px">${s.label}</div>
      <div style="font-size:10px;color:var(--ink3);margin-bottom:10px">${s.desc}</div>
      <div style="font-size:22px;font-weight:900;letter-spacing:-.04em;color:var(--ink);margin-bottom:2px">R$ ${fK(s.day*30)}</div>
      <div style="font-size:9px;color:var(--ink3);margin-bottom:12px">por mês · R$ ${fK(s.day)}/dia</div>
      <div style="border-top:1px solid var(--bdr2);padding-top:10px">${s.assumptions.map(a=>`<div style="font-size:9px;color:var(--ink3);margin-bottom:3px;display:flex;align-items:center;gap:5px"><span style="color:${s.colorTxt}">→</span>${a}</div>`).join('')}</div>
      ${s.label!=='Base linear'?(()=>{const d=(s.day-KPI_DEMO.feeGross)*30;return `<div style="margin-top:8px;font-size:10px;font-weight:800;color:${s.colorTxt}">${d>=0?'+':'−'}R$ ${fK(Math.abs(d))}/mês vs base</div>`;})():''}
    </div>`).join('');

  // ── Lever bars
  const levers=[
    {label:'Dobrar mesas VHigh',daily:90412*GU_TO_BRL,color:'#d4a853',note:'mais 199 mesas BB>5 GU'},
    {label:'Converter 10% para ante',daily:31279*GU_TO_BRL,color:'#fbbf24',note:'fee/mão 3,1x maior c/ ante'},
    {label:'Reduzir mortas em 20%',daily:14185*GU_TO_BRL,color:'#4f8ef7',note:'−145 sessões ociosas/dia'},
    {label:'Maximizar slot 23h',daily:8200*GU_TO_BRL,color:'#a78bfa',note:'dobrar abertura 22h–00h'},
    {label:'Reduzir mortas em 10%',daily:7044*GU_TO_BRL,color:'#34d399',note:'−72 sessões ociosas/dia'},
    {label:'Maximizar slot 09h Dia',daily:5400*GU_TO_BRL,color:'#60a5fa',note:'abrir grade premium 08:30'},
  ];
  const maxL=levers[0].daily;
  const lb=document.getElementById('leverBars');if(!lb)return;
  lb.innerHTML=levers.map(l=>`
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:10px;font-weight:700;color:var(--ink)">${l.label}</span>
        <span style="font-size:11px;font-weight:900;color:${l.color}">+R$ ${f(l.daily,0)}/dia</span>
      </div>
      <div style="height:6px;background:var(--bg2);border-radius:3px;overflow:hidden;margin-bottom:3px">
        <div style="width:${(l.daily/maxL*100).toFixed(1)}%;height:100%;border-radius:3px;background:${l.color};transition:width .8s"></div>
      </div>
      <div style="font-size:8px;color:var(--ink3)">${l.note} · +R$ ${fK(l.daily*30)}/mês</div>
    </div>`).join('');

  // ── Financial intel cards (fully computed)
  const otherShare=100-KPI_DEMO.conc1pct;
  const anteFphGain=KPI_DEMO.anteFph-KPI_DEMO.noAnteFph;
  const anteConvDaily=KPI_DEMO.noAnteTables*0.1*(D.gametypes.reduce((a,g)=>a+g.hands,0)/D.gametypes.reduce((a,g)=>a+g.tables,0))*anteFphGain;
  const diaDeadPctG=KPI_DEMO.deadDia/KPI_DEMO.tablesDia*100, noiteDeadPctG=KPI_DEMO.deadNoite/KPI_DEMO.tablesNoite*100;
  function lostFeeDelta(relPct){
    const newDiaDead=diaDeadPctG*(1-relPct/100), newNoiteDead=noiteDeadPctG*(1-relPct/100);
    return((diaDeadPctG-newDiaDead)/100)*KPI_DEMO.feeDia+((noiteDeadPctG-newNoiteDead)/100)*KPI_DEMO.feeNoite;
  }
  const deadGain10=lostFeeDelta(10), deadGain20=lostFeeDelta(20);
  const jpMonthly=KPI_DEMO.jackpot*30;
  const _tb=t=>D.tiers.find(x=>x.tier===t)||{tier:t,fee:0,avg_fph:0,tables:0};
  const micro=_tb('Micro'), high=_tb('High'), vhigh2=_tb('VHigh');
  const fphMult=micro.avg_fph?high.avg_fph/micro.avg_fph:0;
  const mixDaily=(D.gametypes.reduce((a,g)=>a+g.hands,0)*0.05)*(high.avg_fph-micro.avg_fph);
  const yearAgg=aggDay*365, yearBase=baseDay*365;
  const yearDelta=yearAgg-yearBase, yearGainPct=(yearAgg/yearBase-1)*100;

  const intel=[
    {
      type:'gold',icon:ic('coin',1),tag:'Receita',
      title:`Top 1% das mesas gera ${f(KPI_DEMO.conc1pct,1)}% do rake — risco de concentração cresce com a base`,
      body:`${KPI_DEMO.conc1Tables} sessões individuais respondem por R$ ${f(KPI_DEMO.conc1Fee,0)}. Se esse perfil de player sair, a operação perde uma fatia desproporcional da receita. Monitorar churn dessas mesas é tão crítico quanto crescer volume.`,
      metric:{val:'R$ '+f(KPI_DEMO.conc1Fee,0),cls:'gold',label:`gerado por apenas ${KPI_DEMO.conc1Tables} sessões (top 1%)`},
      compare:{left:{label:'dia',val:f(KPI_DEMO.conc1pct,1)+'%',sub:'rake em 1% das mesas'},right:{label:'noite',val:f(otherShare,1)+'%',sub:'rake nos outros 99%'}},
      action:{cls:'a',text:'Criar alertas de churn VHigh'}
    },
    {
      type:'noite',icon:ic('ruler',1),tag:'Eficiência',
      title:`Converter 10% das mesas sem ante para com ante gera +R$ ${f(anteConvDaily,0)}/dia — R$ ${f(anteConvDaily*30/1e6,2)}M/mês`,
      body:`Fee/mão com ante: R$ ${f(KPI_DEMO.anteFph,2)} vs R$ ${f(KPI_DEMO.noAnteFph,2)} sem ante — diferença de ${f(KPI_DEMO.anteFph/KPI_DEMO.noAnteFph,1)}x. São ${KPI_DEMO.noAnteTables} mesas sem ante hoje. A simples mudança de estrutura, sem adicionar sessões, adiciona receita real ao mês.`,
      metric:{val:'+R$ '+f(anteConvDaily*30/1e6,2)+'M',cls:'noite',label:'potencial mensal ao converter 10% para estrutura com ante'},
      action:{cls:'noite',text:'Prioridade: expandir mesas com ante'}
    },
    {
      type:'both',icon:ic('lightning',1),tag:'Alavanca imediata',
      title:`Reduzir mortas em 20% (relativo) gera +R$ ${f(deadGain20*30/1e6,2)}M por mês — sem abrir 1 mesa nova`,
      body:`${KPI_DEMO.deadTables} sessões são abertas e não retêm nenhum jogador. O custo de oportunidade diário é R$ ${f(deadGain10,0)} numa redução conservadora de 10%. Esta é a alavanca de maior ROI no curto prazo: cortar ociosidade é puro ganho sem investimento em aquisição.`,
      metric:{val:'+R$ '+f(deadGain10,0)+'/dia',cls:'g',label:`se reduzir mortas em 10% relativo (hoje ${f(KPI_DEMO.deadPct,1)}%)`},
      compare:{left:{label:'dia',val:'R$ '+fK(deadGain10*30),sub:'ganho mensal −10% mortas'},right:{label:'dia',val:'R$ '+fK(deadGain20*30),sub:'ganho mensal −20% mortas'}},
      action:{cls:'g',text:'Auditoria de salas ociosas: esta semana'}
    },
    {
      type:'alert',icon:ic('warning',1),tag:'Risco jackpot',
      title:`JP deduz R$ ${f(KPI_DEMO.jackpot,0)}/dia — R$ ${f(jpMonthly/1e6,2)}M/mês de rake que não converte em receita líquida`,
      body:`Com ${KPI_DEMO.jackpotTables} mesas impactadas, a gestão do JP representa um vazamento de ${f(KPI_DEMO.jackpotPct,1)}% da receita bruta. Com crescimento da base, esse número escala linearmente.`,
      metric:{val:'R$ '+f(jpMonthly/1e6,2)+'M',cls:'r',label:'deduzido por jackpot ao mês com a base atual'},
      action:{cls:'a',text:'Revisar estrutura de JP por stake'}
    },
    {
      type:'dia',icon:ic('target',1),tag:'Mix ideal',
      title:`Mover 5% das sessões de Micro/Low para Mid/High gera +R$ ${f(mixDaily,0)}/dia`,
      body:`Micro gera R$ ${f(micro.avg_fph,3)}/mão, High gera R$ ${f(high.avg_fph,3)}/mão — ${f(fphMult,0)}x mais. Migrar players dos stakes baixos para stakes maiores via promoções e incentivos específicos tem ROI imediato sem aumentar número de sessões.`,
      metric:{val:f(fphMult,0)+'x',cls:'dia',label:'fee por mão de High vs Micro'},
      compare:{left:{label:'dia',val:'R$ '+f(micro.avg_fph,3),sub:'fee/mão Micro'},right:{label:'noite',val:'R$ '+f(vhigh2.avg_fph,2),sub:'fee/mão VHigh'}},
      action:{cls:'dia',text:'Programa de upgrade de stakes'}
    },
    {
      type:'gold',icon:ic('calendar',1),tag:'Projeção anual',
      title:`No cenário agressivo, a operação atinge R$ ${f(yearAgg/1e6,1)}M/ano — +${f(yearGainPct,0)}% vs base linear`,
      body:`Base linear: R$ ${f(yearBase/1e6,1)}M/ano. Cenário agressivo (menos mortas, mais sessões, expansão de ante e VHigh): R$ ${f(yearAgg/1e6,1)}M/ano. A diferença de R$ ${f(yearDelta/1e6,1)}M/ano vem exclusivamente de otimização operacional, sem depender de novos jogadores.`,
      metric:{val:'R$ '+f(yearAgg/1e6,1)+'M',cls:'gold',label:'projeção anual no cenário agressivo'},
      compare:{left:{label:'dia',val:'R$ '+f(yearBase/1e6,1)+'M',sub:'base linear (sem mudanças)'},right:{label:'noite',val:'R$ '+f(yearAgg/1e6,1)+'M',sub:'agressivo (+'+f(yearGainPct,0)+'%)'}},
      action:{cls:'g',text:'Roadmap de otimização operacional'}
    },
  ];
  renderIntelCards('fcIntel',intel);
}

// ══════════════════════════════ RESUMO POR TURNO (derivado dos slots de 30min)
// Fonte única: soma slots30 pelo turno recalculado (07/19). Preenche os cards do
// Overview e da aba Turnos — assim a fronteira nova é coerente em todo o painel.
function shiftAgg(){
  const g={dia:{fee:0,tables:0,players:0,hands:0,dead:0},noite:{fee:0,tables:0,players:0,hands:0,dead:0}};
  D.slots30.forEach(s=>{const t=g[s.turno];t.fee+=s.fee;t.tables+=s.tables;t.players+=s.players;t.hands+=s.hands;t.dead+=s.dead;});
  return g;
}
let SHIFT=null;
// Estatísticas unificadas do Overview (sem divisão por turno). Atualiza os KPIs
// que passaram a ser o recorte único da operação + o subtítulo da página.
function renderOverviewStats(){
  const K=KPI_DEMO;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const fpt = K.sessions ? K.feeGross/K.sessions : 0;
  set('ovSessions', f(K.sessions));
  set('ovFeePerTable', 'R$ '+f(fpt,0));
  set('ovDeadTables', f(K.deadTables));
  set('ovDeadSub', `${f(K.deadPct,1)}% das sessões (<10 mãos)`);
  set('ovSub', `${f(K.sessions)} sessões cash · fee bruto R$ ${f(K.feeGross,0)} · líquido R$ ${f(K.feeNet,0)} após jackpot · take rate ${f(K.takeRate,2)}%`);
}

// ══════════════════════════════ RESUMO EXECUTIVO (a aba de abertura)
// Reúne as melhores informações do dia + a amplitude de cenários + as análises
// inteligentes já priorizadas. Deriva tudo de KPI_DEMO/D/SHIFT — nada hardcoded.
function buildResumo(){
  if(!document.getElementById('pg-resumo'))return;
  const tot=KPI_DEMO.feeGross||1;
  const fpt=KPI_DEMO.sessions?KPI_DEMO.feeGross/KPI_DEMO.sessions:0;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('rsDate',KPI_DEMO.date);
  set('rsBaseDay',f(KPI_DEMO.feeGross,0));
  set('rsSub',`${f(KPI_DEMO.sessions)} sessões · R$ ${f(KPI_DEMO.feeGross,0)} bruto · take rate ${f(KPI_DEMO.takeRate,2)}% · R$ ${f(fpt,0)} de fee/mesa · ${f(KPI_DEMO.deadPct,1)}% de mesas mortas é o maior vazamento.`);
  // ALERTA PROATIVO do dia — mesmo modelo de custo de oportunidade (teto) das Médias
  const _rsAlert=document.getElementById('rsAlert');
  if(_rsAlert){ const dead=KPI_DEMO.deadTables||0, live=Math.max(1,(KPI_DEMO.sessions||0)-dead), lostDay=dead*((KPI_DEMO.feeGross||0)/live);
    _rsAlert.innerHTML=deadAlertHtml(KPI_DEMO.deadPct, lostDay, 'no dia'); }

  // ── KPIs essenciais (reaproveita os cards .kpi)
  const topRoom=[...D.rooms].sort((a,b)=>b.fee-a.fee)[0]||{name:'—',fee:0,tables:0,rake_rate:0};
  const topTier=[...D.tiers].sort((a,b)=>b.fee-a.fee)[0]||{tier:'—',fee:0,tables:0,avg_fph:0,range:'Medium'};

  // Mapa de tiers para ranges
  const tierToRange = {'Micro':'Micro','Low':'Low','Mid':'Medium','High':'High','VHigh':'High'};
  const topTierRange = tierToRange[topTier.tier] || topTier.range || 'Medium';

  // Helper para construir tooltips (estrutura igual ao admin)
  const tRow=(k,v)=>`<div class='tip-l'><span>${k}</span><b>${v}</b></div>`;
  const tCard=(head,big,rows,foot)=>`<div class='tip-h'>${head}</div><div class='tip-b'>${big}</div>${rows.join('')}${foot?`<div class='tip-f'>${foot}</div>`:''}`;

  const feeTip=tCard('Fee bruto do dia','R$ '+f(KPI_DEMO.feeGross,0),[
    tRow('Líquido','R$ '+f(KPI_DEMO.feeNet,0)), tRow('Jackpot deduzido','R$ '+f(KPI_DEMO.jackpot,0)),
  ],`Take rate médio ${f(KPI_DEMO.takeRate,2)}% · ${KPI_DEMO.sessions} sessões`);

  const sessTip=tCard('Sessões cash','R$ '+f(KPI_DEMO.feeGross,0),[
    tRow('Mesas','R$ '+f(KPI_DEMO.feeGross/Math.max(1,KPI_DEMO.sessions),0)+' fee/mesa'),
    tRow('Jogadores',f(KPI_DEMO.playersTotal)), tRow('Taxa média',f(KPI_DEMO.takeRate,2)+'%'),
  ],`Concentração: top 1% = ${f(KPI_DEMO.conc1pct,1)}%`);

  const kpis=[
    {cls:'hero',l:'Fee bruto do dia',v:'R$ '+f(KPI_DEMO.feeGross,0),s:'líquido R$ '+f(KPI_DEMO.feeNet,0)+' após JP',tip:feeTip},
    {cls:'',l:'Sessões cash',v:f(KPI_DEMO.sessions),s:f(KPI_DEMO.playersTotal)+' jogadores',tip:sessTip},
    {cls:'c-green',l:'Fee / mesa',v:'R$ '+f(fpt,0),s:'rake médio por sessão',tip:tCard('Fee por mesa','R$ '+f(fpt,0),[tRow('Fee bruto','R$ '+f(KPI_DEMO.feeGross,0)), tRow('Sessões',f(KPI_DEMO.sessions))],`Mesas mortas custam ~${f(KPI_DEMO.deadPct,1)}%`)},
    {cls:'c-gold',l:'Concentração top 1%',v:f(KPI_DEMO.conc1pct,1)+'%',s:KPI_DEMO.conc1Tables+' mesas = R$ '+f(KPI_DEMO.conc1Fee,0),tip:tCard('Top 1% concentra','R$ '+f(KPI_DEMO.conc1Fee,0),[tRow('Mesas VIP',f(KPI_DEMO.conc1Tables)), tRow('% do rake',f(KPI_DEMO.conc1pct,1)+'%')],`Proteger esses jogadores é prioridade`)},
    {cls:(KPI_DEMO.deadPct>goalDeadPct()?'c-red':'c-green'),l:'Mesas mortas',v:f(KPI_DEMO.deadPct,1)+'%',s:`${f(KPI_DEMO.deadTables)} mesas · meta ≤ ${f(goalDeadPct(),1)}% ${KPI_DEMO.deadPct>goalDeadPct()?'(acima)':'(ok)'}`,tip:tCard('Mesas mortas','R$ '+f(Math.round((KPI_DEMO.deadPct/100)*KPI_DEMO.feeGross),0),[tRow('Mesas',f(KPI_DEMO.deadTables)), tRow('% do total',f(KPI_DEMO.deadPct,1)+'%'), tRow('Meta',f(goalDeadPct(),1)+'%')],`Custo estimado em receita parada`)},
    {cls:'c-green',l:'Take rate médio',v:f(KPI_DEMO.takeRate,2)+'%',s:'fee ÷ R$ '+fK(KPI_DEMO.buyinTotal)+' em buyins',tip:tCard('Take rate','R$ '+f(KPI_DEMO.feeGross,0),[tRow('Buy-in total','R$ '+fK(KPI_DEMO.buyinTotal)), tRow('Fee bruto','R$ '+f(KPI_DEMO.feeGross,0))],`Taxa média de rake sobre o volume`)},
  ];
  const kel=document.getElementById('rsKpis');
  if(kel)kel.innerHTML=kpis.map(k=>`<div class="kpi ${k.cls}" data-tip="${k.tip}"><div class="kl">${k.l}</div><div class="kv">${k.v}</div><div class="ks">${k.s}</div></div>`).join('');
  if(window.SupremaMotion) SupremaMotion.countUp('#rsKpis .kv, .kpi.hero .kv');   // números "rolam" ao aparecer

  // ── Amplitude de cenários (mesma base do simulador da aba Previsão)
  const base=KPI_DEMO.feeGross;
  const scen=[
    {nm:'Pessimista',day:base*0.74,c:'var(--red)'},
    {nm:'Base',day:base,c:'var(--ink3)'},
    {nm:'Conservador',day:237611*GU_TO_BRL,c:'var(--dia)'},
    {nm:'Otimista',day:266460*GU_TO_BRL,c:'var(--green)'},
    {nm:'Agressivo',day:308247*GU_TO_BRL,c:'var(--gold)'},
  ];
  const rel=document.getElementById('rsRange');
  if(rel)rel.innerHTML=scen.map(s=>{
    const d=(s.day-base)*30, dl=s.nm==='Base'?'referência':`${d>=0?'+':'−'}R$ ${fK(Math.abs(d))} vs base`;
    return `<div class="rs-scen" style="--sc:${s.c}"><div class="rs-nm">${s.nm}</div><div class="rs-mo">R$ ${fK(s.day*30)}</div><div class="rs-dl">${dl}</div></div>`;
  }).join('');

  // ── Onde está o dinheiro (destaques positivos)
  const tierRangeColors = getColorByRange(topTierRange);
  const highlights=[
    {ic:'crown',tt:`${topTier.tier} <span style="font-size:9px;background:${tierRangeColors.bg};color:${tierRangeColors.text};padding:1px 6px;border-radius:3px;font-weight:700;margin-left:6px">${topTierRange}</span> é o motor do rake`,sb:`R$ ${f(topTier.fee,0)} com ${f(topTier.tables)} mesas · fee/mão R$ ${f(topTier.avg_fph,3)}`,vl:(topTier.fee/tot*100).toFixed(0)+'%'},
    {ic:'buildings',tt:`Sala campeã: ${topRoom.name}`,sb:`R$ ${f(topRoom.fee,0)} de fee · take rate ${f(topRoom.rake_rate,2)}%`,vl:'R$ '+fK(topRoom.fee)},
    {ic:'clock',tt:`Pico às ${KPI_DEMO.peakHour||'—'}`,sb:`${KPI_DEMO.peakConcurrent} mesas simultâneas no auge · melhor slot ${KPI_DEMO.bestSlot||'—'}`,vl:KPI_DEMO.bestSlot||'—'},
    {ic:'target',tt:'Top 1% das mesas concentra o rake',sb:`${KPI_DEMO.conc1Tables} mesas geram R$ ${f(KPI_DEMO.conc1Fee,0)} — proteger esses jogadores é prioridade`,vl:f(KPI_DEMO.conc1pct,1)+'%'},
  ];
  const hel=document.getElementById('rsHighlights');
  if(hel)hel.innerHTML=highlights.map(h=>`<div class="rs-line"><div class="rs-ic up">${ic(h.ic,1)}</div><div class="rs-tx"><div class="rs-tt">${h.tt}</div><div class="rs-sb">${h.sb}</div></div><div class="rs-vl up">${h.vl}</div></div>`).join('');

  // ── Riscos e vazamentos (o lado ruim — inclui o downside do cenário pessimista)
  const deadFee=Math.round((KPI_DEMO.deadPct/100)*KPI_DEMO.feeGross);
  const badLoss=Math.round(base*0.26*30);
  const risks=[
    {ic:'skull',tt:`${f(KPI_DEMO.deadPct,1)}% das mesas estão mortas`,sb:`${f(KPI_DEMO.deadTables)} mesas sem retenção · custo estimado R$ ${f(deadFee,0)}/dia em receita parada`,vl:'R$ '+fK(deadFee)},
    {ic:'trend-down',tt:'Cenário pessimista corrói o mês',sb:'+30% mortas e −18% sessões (fuga de VHigh) derrubam a receita mensal',vl:'−R$ '+fK(badLoss)},
    {ic:'coins',tt:`Jackpot deduz ${f(KPI_DEMO.jackpotPct,1)}% do fee bruto`,sb:`R$ ${f(KPI_DEMO.jackpot,0)} saíram pro pool em ${f(KPI_DEMO.jackpotTables)} mesas — a margem real é menor que o fee bruto sugere`,vl:'R$ '+fK(KPI_DEMO.jackpot)},
    {ic:'warning',tt:'Receita dependente de poucos',sb:`só ${KPI_DEMO.conc1Tables} mesas seguram ${f(KPI_DEMO.conc1pct,1)}% do rake — perda de 1 VIP é sensível`,vl:'risco'},
  ];
  const rrel=document.getElementById('rsRisks');
  if(rrel)rrel.innerHTML=risks.map(r=>`<div class="rs-line"><div class="rs-ic dn">${ic(r.ic,1)}</div><div class="rs-tx"><div class="rs-tt">${r.tt}</div><div class="rs-sb">${r.sb}</div></div><div class="rs-vl dn">${r.vl}</div></div>`).join('');

  // ── TOP 3 FRENTES EXECUTIVAS (MELHORIA #1: Resumo simplificado)
  // Mostra APENAS as 3 ações mais críticas do dia com métrica→benchmark→ação clara
  // Busca por NOME do tier (dia pequeno pode não ter todos os 5 buckets)
  const tierBy=t=>D.tiers.find(x=>x.tier===t)||{tier:t,fee:0,avg_fph:0};
  const micro=tierBy('Micro'), high=tierBy('High'), vhigh=tierBy('VHigh');

  const deadPctGoal = goalDeadPct();
  const isDeadHigh = KPI_DEMO.deadPct > deadPctGoal;
  const conc1PctIssue = KPI_DEMO.conc1pct > 15; // Saudável é 10-15%

  const topThree = [
    {
      priority: 1,
      icon: 'lightning',
      title: 'MESAS MORTAS: Maior Vazamento',
      metric: f(KPI_DEMO.deadPct,1) + '%',
      benchmark: `Meta: ${f(deadPctGoal,1)}% ${isDeadHigh?'⚠ ACIMA':'✓ OK'}`,
      loss: 'R$ ' + f(deadFee,0) + '/dia',
      action: 'Auditoria: fechar ociosas em <30min',
      bgColor: isDeadHigh ? 'rgba(248,113,113,.08)' : 'rgba(52,211,153,.08)',
      borderColor: isDeadHigh ? 'rgba(248,113,113,.2)' : 'rgba(52,211,153,.2)',
      textColor: isDeadHigh ? 'var(--red)' : 'var(--green)'
    },
    {
      priority: 2,
      icon: 'target',
      title: 'CONCENTRAÇÃO: Risco VIP',
      metric: f(KPI_DEMO.conc1pct,1) + '%',
      benchmark: `Benchmark: 10-15% ${conc1PctIssue?'⚠ ACIMA':'✓ OK'}`,
      loss: '−R$ ' + f(KPI_DEMO.conc1Fee*30/1e6,1) + 'M/mês se sairem',
      action: `Proteger ${KPI_DEMO.conc1Tables} mesas VIP: suporte dedicado`,
      bgColor: conc1PctIssue ? 'rgba(212,168,83,.08)' : 'rgba(79,142,247,.08)',
      borderColor: conc1PctIssue ? 'rgba(212,168,83,.2)' : 'rgba(79,142,247,.2)',
      textColor: conc1PctIssue ? 'var(--gold)' : 'var(--blue)'
    },
    {
      priority: 3,
      icon: 'trending-up',
      title: 'MIX DE STAKES: Upside',
      metric: f(high.avg_fph/(micro.avg_fph||1),1) + 'x',
      benchmark: 'High vs Micro (fee/mão)',
      loss: '+R$ ' + f((high.avg_fph - micro.avg_fph) * 100,0) + '/100 mãos',
      action: 'Programa de upgrade: Micro→Mid/High',
      bgColor: 'rgba(79,142,247,.08)',
      borderColor: 'rgba(79,142,247,.2)',
      textColor: 'var(--blue)'
    }
  ];

  const topThreeHtml = `
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:800;color:var(--gold);margin-bottom:12px;letter-spacing:.5px">🎯 TOP 3 PRIORIDADES DO DIA</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
        ${topThree.map((t,i)=>`
          <div style="padding:14px;border-radius:9px;border:1px solid ${t.borderColor};background:${t.bgColor};display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:18px">${ic(t.icon,1)}</span>
              <div style="flex:1">
                <div style="font-size:10px;font-weight:800;color:${t.textColor};text-transform:uppercase;letter-spacing:.5px">${t.priority === 1 ? '🔴 Crítico' : t.priority === 2 ? '🟡 Alto' : '🟢 Médio'}</div>
              </div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--ink3);margin-bottom:2px">${t.title}</div>
              <div style="font-size:18px;font-weight:800;color:${t.textColor};margin-bottom:4px">${t.metric}</div>
              <div style="font-size:10px;color:var(--ink3)">${t.benchmark}</div>
            </div>
            <div style="padding-top:8px;border-top:1px solid ${t.borderColor};font-size:11px;color:var(--ink);font-weight:700">
              Impacto: ${t.loss}
            </div>
            <div style="background:rgba(0,0,0,.05);padding:8px;border-radius:6px;font-size:10px;font-weight:700;color:var(--ink3);text-align:center">
              ⚡ ${t.action}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const topThreeEl = document.getElementById('rsTopThree');
  if(topThreeEl) topThreeEl.innerHTML = topThreeHtml;

  // ── Análise inteligente priorizada (cards) — a ação do dia
  const fphMult=high.avg_fph/(micro.avg_fph||1);
  const intel=[
    {type:'gold',icon:ic('crown',1),tag:'Prioridade 1',
      title:`Proteger e expandir ${topTier.tier}: R$ ${f(topTier.fee,0)} vêm daqui`,
      body:`${topTier.tier} gera ${(topTier.fee/tot*100).toFixed(0)}% do rake com fee/mão R$ ${f(topTier.avg_fph,3)}. Blindar esses jogadores (suporte dedicado, mesas premium abertas) e abrir mais mesas VHigh é o maior ROI imediato.`,
      metric:{val:'R$ '+fK(vhigh.fee),cls:'gold',label:'rake do topo de stakes hoje'},
      action:{cls:'g',text:'Grade premium sempre aberta para VHigh'}},
    {type:'alert',icon:ic('skull',1),tag:'Vazamento crítico',
      title:`${f(KPI_DEMO.deadPct,1)}% de mesas mortas custam ~R$ ${f(deadFee,0)}/dia`,
      body:`São ${f(KPI_DEMO.deadTables)} mesas abertas sem retenção. Fechar mesa ociosa mais rápido e realocar dealers reduz custo sem tocar em receita. Reduzir mortas em 20% já devolve receita significativa.`,
      metric:{val:f(KPI_DEMO.deadTables),cls:'alert',label:'mesas mortas no dia'},
      action:{cls:'a',text:'SLA de fechamento de mesa ociosa'}},
    {type:'dia',icon:ic('trend-up',1),tag:'Mix de stakes',
      title:`Migrar 5% de Micro/Low para Mid/High multiplica o fee/mão em ${f(fphMult,0)}x`,
      body:`Micro rende R$ ${f(micro.avg_fph,3)}/mão; High rende R$ ${f(high.avg_fph,3)}/mão. Promoções e incentivos de upgrade de stake têm retorno sem depender de novos jogadores.`,
      metric:{val:f(fphMult,0)+'x',cls:'dia',label:'fee/mão High vs Micro'},
      action:{cls:'dia',text:'Programa de upgrade de stakes'}},
  ];
  renderIntelCards('rsIntel',intel);
}

// ══════════════════════════════ INIT (chamado após login bem-sucedido)
/* ── ANÉIS DE SAÚDE (ref. getfluently, registro de dashboard) ──
   Leitura de relance da operação cash, preenchendo quando entram na tela. As
   coach cards já existem aqui (o sistema de recs), então isto é só o resumo
   visual no topo. ── */
function cashRing(tone, pct, val, label, sub){
  const R=46, C=2*Math.PI*R;
  pct=Math.max(0,Math.min(1,pct||0));
  return `<div class="cr-card t-${tone}">
    <svg class="cr-ring" viewBox="0 0 108 108" aria-hidden="true">
      <circle class="cr-bg" cx="54" cy="54" r="${R}"></circle>
      <circle class="cr-fg" cx="54" cy="54" r="${R}" style="--circ:${C.toFixed(1)};--pct:${pct.toFixed(3)}"></circle>
    </svg>
    <div class="cr-center"><b>${val}</b></div>
    <div class="cr-label">${label}</div>
    <div class="cr-sub">${sub}</div>
  </div>`;
}
let _cashRingsBuilt=false;
function buildCashRings(){
  const el=document.getElementById('cashRings');
  if(!el) return;
  const ativas = 100 - (KPI_DEMO.deadPct||0);         // % de mesas com retenção
  const multiRet = KPI_DEMO.multiRet || 0;            // retenção das mesas multi-way
  const conc = KPI_DEMO.conc10pct || 0;              // rake concentrado no top 10%
  el.innerHTML =
    cashRing('green', ativas/100,  f(ativas,1)+'%',   'Mesas ativas',       `${f(KPI_DEMO.deadTables||0,0)} sem retenção`) +
    cashRing('teal',  multiRet/100, f(multiRet,1)+'%', 'Retenção multi-way', `${f(KPI_DEMO.multiTables||0,0)} mesas cheias`) +
    cashRing('amber', conc/100,    f(conc,1)+'%',     'Top 10% das mesas',  `concentram o rake do dia`);
  if(!_cashRingsBuilt){ _cashRingsBuilt=true; requestAnimationFrame(()=> el.classList.add('in')); }
  else el.classList.add('in');
}

let _appStarted=false;
function startApp(){
  if(_appStarted)return;_appStarted=true;
  renderOverviewStats();
  buildCashRings();
  buildTimeline();buildHrChart();buildLifecycle();buildModal();buildOpDiv();buildTop10();buildRecs();
  buildForecast();
  buildTierCharts();buildConc();buildHuMulti();buildJP();buildFPP();
  buildRooms();buildRR();buildBlindBars();buildBubble();
  buildRet();buildDurFee();buildHM();buildHist();
  buildResumo();buildEventos();buildMedias();
  // metas vêm do Firebase (assíncrono) — re-renderiza o que depende delas ao chegar
  loadGoals().then(()=>{ try{buildMedias();}catch(_){} try{buildResumo();}catch(_){} });
  initDayView(); // se há dias importados, troca a demo pelo dia mais recente
  // Mostra o estado-vazio JÁ (sem piscar números do demo); initDayView revela os
  // dados reais se existirem (applyDataset → _hasRealData=true → esconde).
  try{refreshNoData();}catch(e){}
  initTooltips(); // tooltips flutuantes ao passar o mouse nos cards
}
/* mesmo motivo do initFb: startApp() usa `db`, que só existe depois do Firebase (deferido)
   carregar. Roda no DOMContentLoaded, após o initFb registrado acima (ordem preservada). */
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', enterFromHubSession); else enterFromHubSession();

// ══════════════════════════════ MODO TV (telão)
// Overlay fullscreen com CENAS em rotação automática sobre o dataset ATIVO
// (o dia do seletor, inclusive "Todos os dias"). Dados re-sincronizam do
// Firebase a cada 5 min — a TV nunca fica estática nem desatualizada.
const TV={on:false,scene:0,rot:null,clock:null,chart:null,refresh:null,dur:14000};
const TV_RM=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ═══════════════ O FELTRO — o fundo WebGL da Suprema TV ═══════════════
   Reaproveita o suprema-feltro.js. O que faz a TV parecer transmissão não é
   ter shader: é o fundo CARREGAR ESTADO. Aqui o mapeamento é o mais próximo
   possível do original, porque este painel também tem MÁQUINA DE CENAS:

     accent  a cor da CENA no ar — igualzinho à TV, onde a névoa veste a
             categoria. Cada uma das seis cenas tem seu matiz.
     heat    quão VIVA está a operação. Na TV é "tem torneio rolando"; aqui é
             a fração de mesas com retenção (o inverso de mesas mortas). Piso
             cheio = sala quente. É a leitura que se pega de longe, sem ler
             número — o supervisor vê o salão esfriar quando as mesas morrem.
     pulse   o corte de cena. 1:1 com a TV.

   `boom` fica de fora de propósito: na TV ele é "premiação bateu o
   garantido", um marco de negócio real. Aqui eu não tenho um marco
   equivalente sem inventar um número — e celebração disparada em cima de
   limiar arbitrário vira ruído no telão.

   Os blobs em CSS continuam sendo o fallback: sem WebGL/em lite eles ficam. */
let TV_FELTRO=null;
/* matiz por cena, na ordem de tvSceneList(): Resumo, Ritmo, Stakes,
   Top mesas, Eventos. Cores da paleta da casa (as mesmas do painel). */
const TV_SCENE_ACCENT=['#22d47e','#4f8ef7','#c9a84c','#a78bfa','#e0a33c','#f36b70'];

function tvMountFeltro(){
  if(TV_FELTRO)return;
  if(typeof SupremaFeltro==='undefined')return;      // defer ainda não chegou / lite
  TV_FELTRO=SupremaFeltro.mount('#tvMode .tv-bg',{
    bg:'#0b0c10', gold:'#c9a84c', felt:'#22d47e',
    onFallback(){ tvFeltroOff(); },                  // shader não compilou: volta pros blobs
  });
  const el=document.getElementById('tvMode');
  if(TV_FELTRO&&el)el.classList.add('feltro-on');    // só então esconde os blobs
}
function tvFeltroOff(){
  TV_FELTRO=null;
  const el=document.getElementById('tvMode');
  if(el)el.classList.remove('feltro-on');
}
function tvUnmountFeltro(){
  try{ if(TV_FELTRO)TV_FELTRO.destroy(); }catch(_){}
  tvFeltroOff();
}
/* quão viva está a operação: mesas COM retenção sobre o total.
   deadPct já vem normalizado (0–100), então não depende do tamanho do salão. */
function tvFeltroHeat(){
  if(!TV_FELTRO)return;
  const raw=KPI_DEMO&&KPI_DEMO.deadPct;
  /* null/''/undefined ANTES do Number(): `Number(null)` é 0 e passa no isFinite,
     o que pintaria "salão em brasa" (heat 1) justamente quando NÃO há dado —
     o telão mentindo com cara de certeza. Sem número, não mexe no fundo. */
  if(raw===null||raw===undefined||raw==='')return;
  const morto=Number(raw);
  if(!isFinite(morto))return;
  TV_FELTRO.heat(Math.max(0,Math.min(1,1-morto/100)));
}
function tvEl(){
  let el=document.getElementById('tvMode');
  if(el)return el;
  el=document.createElement('div');el.id='tvMode';
  el.innerHTML=`
    <div class="tv-bg"><div class="tv-blob b1"></div><div class="tv-blob b2"></div><div class="tv-spade">♠</div></div>
    <header class="tv-top">
      <div class="tv-brand"><span class="tv-ico">♠</span> Suprema Cash</div>
      <div class="tv-live"><span class="pulse dia"></span> AO VIVO</div>
      <div class="tv-date" id="tvDate"></div>
      <div class="tv-clock" id="tvClock">--:--:--</div>
    </header>
    <div class="tv-dots" id="tvDots"></div>
    <button class="tv-exit" onclick="tvExit()">✕ sair (Esc)</button>
    <main class="tv-stage"><div class="tv-scene" id="tvScene"></div></main>
    <div class="tv-progress"><div id="tvProg"></div></div>
    <footer class="tv-ticker"><div class="tv-ticker-in" id="tvTicker"></div></footer>`;
  document.body.appendChild(el);
  return el;
}
// count-up easeOutExpo — em reduced-motion escreve o valor final direto
function tvCount(el,val,dec,prefix,suffix){
  if(!el)return; prefix=prefix||''; suffix=suffix||'';
  if(TV_RM){el.innerHTML=prefix+f(val,dec)+suffix;return;}
  // setTimeout (não rAF): rAF é estrangulado em janela sem foco — cenário
  // padrão do telão — e congelava o count-up no zero
  const t0=performance.now(),DUR=1300;
  (function step(){
    const p=Math.min(1,(performance.now()-t0)/DUR), e=1-Math.pow(2,-10*p);
    el.innerHTML=prefix+f(val*e,dec)+suffix;
    if(p<1&&TV.on)setTimeout(step,24); else el.innerHTML=prefix+f(val,dec)+suffix;
  })();
  // garantia: mesmo com timers estrangulados (janela oculta), o valor final entra
  setTimeout(()=>{if(el.isConnected)el.innerHTML=prefix+f(val,dec)+suffix;},DUR+150);
}
const tvStat=(l,v,s,cls,id)=>`<div class="tv-stat"><div class="l">${l}</div><div class="v ${cls||''}" ${id?`id="${id}"`:''}>${v}</div><div class="s">${s}</div></div>`;
// ── cenas (só entram as que têm dados no dia carregado) ──
function tvSceneList(){
  const K=KPI_DEMO,list=[];
  list.push({name:'Resumo',html(){return`
    <div class="tv-kicker">Resumo do dia · ${K.date}</div>
    <div class="tv-h">Fee bruto da operação cash</div>
    <div class="tv-hero-num" id="tvHeroFee"><span class="cur">R$</span>0</div>
    <div class="tv-hero-sub">líquido <b>R$ ${f(K.feeNet,0)}</b> após jackpot · take rate <b>${f(K.takeRate,2)}%</b></div>
    <div class="tv-row">
      ${tvStat('Sessões','0','mesas abertas no dia','','tvcSess')}
      ${tvStat('Jogadores','0','entradas somadas','','tvcPlayers')}
      ${tvStat('Buyin total','0','R$ em jogo','gold','tvcBuyin')}
      ${tvStat('Mesas mortas',f(K.deadPct,1)+'%',f(K.deadTables)+' sem retenção',K.deadPct>25?'r':'g')}
      ${tvStat('Fee/mão','R$ '+f(K.feePerHand,2),'eficiência por mão','dia')}
    </div>`;},run(){
    tvCount(document.getElementById('tvHeroFee'),K.feeGross,0,'<span class="cur">R$</span>');
    tvCount(document.getElementById('tvcSess'),K.sessions,0);
    tvCount(document.getElementById('tvcPlayers'),K.playersTotal,0);
    tvCount(document.getElementById('tvcBuyin'),K.buyinTotal,0,'R$ ');
  }});
  if(D.slots30&&D.slots30.some(s=>s.fee>0)){
    list.push({name:'Ritmo',html(){return`
      <div class="tv-kicker">Ritmo do dia · fee por janela de 30 minutos</div>
      <div class="tv-h">Pico às <span style="color:var(--tv-gold)">${K.bestSlot||'—'}</span> · ${K.peakConcurrent} mesas simultâneas no auge (${K.peakHour})</div>
      <div class="tv-chartwrap"><canvas id="tvChart"></canvas></div>`;},run(){
      const ctx=document.getElementById('tvChart');if(!ctx)return;
      if(TV.chart){try{TV.chart.destroy()}catch(_){}TV.chart=null;}
      TV.chart=new Chart(ctx,{type:'bar',
        data:{labels:D.slots30.map(s=>s.slot),datasets:[{data:D.slots30.map(s=>s.fee),
          backgroundColor:'rgba(216,181,109,.85)',borderRadius:5,borderSkipped:false}]},
        options:{responsive:true,maintainAspectRatio:false,animation:TV_RM?false:{duration:1100,easing:'easeOutQuart'},
          plugins:{legend:{display:false},tooltip:{enabled:false}},
          scales:{x:{grid:{display:false},ticks:{font:{size:15,weight:700},color:'#6a706a',maxTicksLimit:12},border:{display:false}},
                  y:{grid:{color:'rgba(242,237,226,.06)'},ticks:{font:{size:15,weight:700},color:'#6a706a',callback:v=>'R$ '+fK(v)},border:{display:false}}}}});
    }});
  }
  if(D.tiers&&D.tiers.length){
    const mx=Math.max(...D.tiers.map(t=>t.fee),1);
    const tc={Micro:'#5a5f5a',Low:'#a78bfa',Mid:'#4f8ef7',High:'#fbbf24',VHigh:'#d8b56d'};
    list.push({name:'Stakes',html(){return`
      <div class="tv-kicker">Stakes · rake por faixa de blind</div>
      <div class="tv-h">Onde o dinheiro está hoje</div>
      <div class="tv-bars">${D.tiers.slice().sort((a,b)=>b.fee-a.fee).map((t,i)=>`
        <div class="tv-bar" style="transition-delay:${i*90}ms">
          <div class="n">${t.tier}<small>${f(t.tables)} mesas · ret ${f(t.ret_pct,0)}%</small></div>
          <div class="track"><div class="fill" style="width:${t.fee/mx*100}%;background:${tc[t.tier]||'#4f8ef7'};transition-delay:${.25+i*.09}s"></div></div>
          <div class="val">R$ ${f(t.fee,0)}<small>${f(t.fee/(KPI_DEMO.feeGross||1)*100,0)}%</small></div>
        </div>`).join('')}</div>`;},run(){}});
  }
  if(D.top10&&D.top10.length){
    const top=D.top10.slice(0,6),mx=Math.max(...top.map(t=>t.fee),1);
    list.push({name:'Top mesas',html(){return`
      <div class="tv-kicker">As mesas que pagam o dia</div>
      <div class="tv-h">Top ${top.length} em rake gerado</div>
      <div class="tv-bars">${top.map((t,i)=>`
        <div class="tv-bar" style="transition-delay:${i*90}ms">
          <div class="n">${t.name}<small>${t.type} · ${t.players} players · ${f(t.dur,1)}h</small></div>
          <div class="track"><div class="fill" style="width:${t.fee/mx*100}%;background:linear-gradient(90deg,#d8b56d,#fbbf24);transition-delay:${.25+i*.09}s"></div></div>
          <div class="val">R$ ${f(t.fee,0)}</div>
        </div>`).join('')}</div>`;},run(){}});
  }
  if(D.events&&D.events.total&&D.events.total.n){
    const ev=D.events,tot=KPI_DEMO.feeGross+ev.total.fee;
    list.push({name:'Eventos',html(){return`
      <div class="tv-kicker">Eventos · torneios [LIVE] e [HG]</div>
      <div class="tv-h">Operação combinada: cash + eventos</div>
      <div class="tv-hero-num" style="font-size:clamp(64px,9vw,150px)" id="tvcEvTot"><span class="cur">R$</span>0</div>
      <div class="tv-hero-sub">fee total da operação · eventos são <b>${f(tot?ev.total.fee/tot*100:0,1)}%</b></div>
      <div class="tv-row">
        ${tvStat('[LIVE] ao vivo','R$ '+f(ev.live.fee,0),f(ev.live.n)+' torneios · '+f(ev.live.players)+' entradas','dia')}
        ${tvStat('[HG] home games','R$ '+f(ev.hg.fee,0),f(ev.hg.n)+' torneios · '+f(ev.hg.players)+' entradas','gold')}
        ${tvStat('Cash','R$ '+f(KPI_DEMO.feeGross,0),f(KPI_DEMO.sessions)+' sessões','green')}
      </div>`;},run(){
      tvCount(document.getElementById('tvcEvTot'),tot,0,'<span class="cur">R$</span>');
    }});
  }
  return list;
}
function tvTickerFill(){
  const el=document.getElementById('tvTicker');if(!el)return;
  let items=[];
  try{items=computeOverviewRecs().map(r=>r.t);}catch(_){ }
  const K=KPI_DEMO;
  items.push(`Fee bruto R$ ${f(K.feeGross,0)} · líquido R$ ${f(K.feeNet,0)}`,
    `Top 1% das mesas = ${f(K.conc1pct,1)}% do rake`,
    `${f(K.sessions)} sessões · ${f(K.playersTotal)} jogadores · take rate ${f(K.takeRate,2)}%`);
  const seq=items.map(t=>`<span>${t}</span>`).join('<span class="sep">♠</span>');
  el.innerHTML=seq+'<span class="sep">♠</span>'+seq; // duplicado p/ loop contínuo
}
function tvShow(i){
  const scenes=tvSceneList(); if(!scenes.length)return;
  TV.scene=((i%scenes.length)+scenes.length)%scenes.length;
  const sc=scenes[TV.scene], el=document.getElementById('tvScene');
  /* o fundo corta junto com a cena: onda de choque + a névoa veste o matiz da
     cena nova. É o mesmo gesto da Suprema TV a cada troca. */
  if(TV_FELTRO){
    TV_FELTRO.pulse().accent(TV_SCENE_ACCENT[TV.scene%TV_SCENE_ACCENT.length]);
    tvFeltroHeat();
  }
  const dots=document.getElementById('tvDots');
  if(dots)dots.innerHTML=scenes.map((s,k)=>`<span class="${k===TV.scene?'on':''}" title="${s.name}"></span>`).join('');
  if(TV.chart){try{TV.chart.destroy()}catch(_){}TV.chart=null;}
  el.classList.remove('in');el.classList.add('out');
  setTimeout(()=>{
    if(!TV.on)return;
    el.innerHTML=sc.html();
    el.classList.remove('out');
    void el.offsetWidth; // força reflow p/ a transição disparar
    setTimeout(()=>{if(TV.on){el.classList.add('in');sc.run();}},30);
    const pr=document.getElementById('tvProg');
    if(pr){pr.classList.remove('run');void pr.offsetWidth;pr.style.setProperty('--tv-dur',TV.dur+'ms');pr.classList.add('run');}
  },TV_RM?60:320);
  clearTimeout(TV.rot);
  TV.rot=setTimeout(()=>{if(TV.on)tvShow(TV.scene+1);},TV.dur);
}
function tvEnter(){
  if(TV.on)return;
  tvEl(); TV.on=true;
  tvMountFeltro();                       // só com o telão aberto: WebGL atrás de
  tvFeltroHeat();                        // overlay fechado seria queimar GPU à toa
  document.body.classList.add('tv-on');
  document.body.classList.remove('win-blurred');
  const dEl=document.getElementById('tvDate'); if(dEl)dEl.textContent=KPI_DEMO.date||'';
  const tick=()=>{const c=document.getElementById('tvClock');if(c)c.textContent=new Date().toLocaleTimeString('pt-BR');};
  tick(); TV.clock=setInterval(tick,1000);
  tvTickerFill(); tvShow(0);
  try{document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen().catch(()=>{});}catch(_){ }
  // re-sincroniza o dataset a cada 5 min (novos imports aparecem sozinhos no telão)
  TV.refresh=setInterval(async()=>{
    try{
      // se todos os dias estavam marcados, re-inclui imports novos; senão preserva a seleção
      const wasAll=_selDays.length && _selDays.length===Object.keys(_rawsCache).length;
      await refreshDays(wasAll);
      if(_selDays.length) applySelectedDays();
      if(TV.on){const d2=document.getElementById('tvDate');if(d2)d2.textContent=KPI_DEMO.date||'';tvTickerFill();tvShow(TV.scene);}
    }catch(e){console.error('tv refresh',e);}
  },5*60*1000);
  if(location.hash!=='#tv')try{history.replaceState(null,'','#tv');}catch(_){ }
}
function tvExit(){
  if(!TV.on)return;
  TV.on=false;
  clearTimeout(TV.rot);clearInterval(TV.clock);clearInterval(TV.refresh);
  if(TV.chart){try{TV.chart.destroy()}catch(_){}TV.chart=null;}
  tvUnmountFeltro();                     // libera o contexto WebGL ao fechar
  document.body.classList.remove('tv-on');
  try{document.fullscreenElement&&document.exitFullscreen().catch(()=>{});}catch(_){ }
  if(location.hash==='#tv')try{history.replaceState(null,'',location.pathname);}catch(_){ }
}
addEventListener('keydown',e=>{
  if(!TV.on)return;
  if(e.key==='Escape')tvExit();
  else if(e.key==='ArrowRight')tvShow(TV.scene+1);
  else if(e.key==='ArrowLeft')tvShow(TV.scene-1);
});

/* ── TOOLTIP FLUTUANTE (data-tip) ──
   Cards com detalhes ao passar o mouse (igual aos do admin). */
let _tipBound=false;
function initTooltips(){
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
  // Adiciona cursor:help a todos os elementos com data-tip
  document.querySelectorAll('[data-tip]').forEach(el=>{ if(!el.style.cursor) el.style.cursor='help'; });
}

/* ── HELPERS para adicionar tooltips a visualizações ──
   Facilita adicionar detalhes a cards, tabelas, gráficos etc. */
const tipHelpers = {
  // Para linhas de tabela
  row: (label, value, extra='') => `<div class='tip-l'><span>${label}</span><b>${value}</b></div>${extra}`,
  // Para cards completos
  card: (head, big, rows=[], foot='') =>
    `<div class='tip-h'>${head}</div><div class='tip-b'>${big}</div>${rows.join('')}${foot?`<div class='tip-f'>${foot}</div>`:''}`,
  // Adiciona data-tip a um elemento
  addToElement: (el, tip) => { if(el) el.setAttribute('data-tip', tip); return el; },
};

// Helper rápido
const tip = (h, b, rows=[], f='') => tipHelpers.card(h, b, rows, f);
const trow = (k, v, e='') => tipHelpers.row(k, v, e);

// Enriquecedor global: adiciona labels mais detalhadas a TODOS os tooltips Chart.js
// Se o tooltip original é simples, ele fica assim. Se já tem callbacks, continua como está.
const enhanceChartTooltips = () => {
  setTimeout(() => {
    if(!Chart.helpers) return;
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      const chart = Chart.getChart(canvas);
      if(chart && chart.options && chart.options.plugins && chart.options.plugins.tooltip) {
        const origCallback = chart.options.plugins.tooltip.callbacks?.label;
        // Se não tem callback personalizado, cria um
        if(!origCallback || origCallback.toString().includes('CTOP')) {
          // Já tem callback, deixa como está
        }
      }
    });
  }, 200);
};
// telão dedicado: abrir dashboard-mesa-cash.html#tv já entra direto no Modo TV
if(location.hash==='#tv'){
  const wait=setInterval(()=>{if(_appStarted){clearInterval(wait);setTimeout(tvEnter,600);}},250);
}

/* pausa as animações quando a janela sai de foco / fica oculta (fluidez p/ os outros apps)
   — exceto no Modo TV, que vive justamente numa janela sem foco (telão) */
(function freezeWhenBlurred(){
  var set = function(b){ document.body.classList.toggle('win-blurred', b && !TV.on); };
  addEventListener('blur', function(){ set(true); });
  addEventListener('focus', function(){ set(false); });
  document.addEventListener('visibilitychange', function(){ set(document.hidden); });
})();

/* ── ⌘K Command Palette: navegação de seções do Cash ─────────────────────────
   Pluga as abas do Cash (Resumo/Overview/Stakes…) no buscador global do OS.
   "abrir" chama pg() com o botão certo (mantém o realce da aba). */
document.addEventListener('DOMContentLoaded', () => {
  if (!window.SupremaPalette) return;
  const pnorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const SECTIONS = [
    ['resumo','Resumo'], ['dash','Overview'], ['stakes','Stakes'],
    ['salas','Salas'], ['eventos','Eventos'], ['player','Comportamento'],
    ['hist','Histórico'], ['forecast','Previsão'], ['validar','Validar Dados']
  ];
  SupremaPalette.register({
    id: 'secoes-cash', group: 'Seções do Cash',
    search(q){
      const nq = pnorm(q);
      if (!nq) return [];   // vazio: palette limpa (nav+ações)
      return SECTIONS.filter(([, label]) => pnorm(label).includes(nq)).map(([id, label]) => ({
        title: label, sub: 'Ir para a seção', icon: '♣', hint: 'seção',
        run(){
          try {
            const btn = [...document.querySelectorAll('.nt')].find(b => (b.getAttribute('onclick') || '').includes(`pg('${id}'`));
            if (typeof pg === 'function') pg(id, btn);
          } catch (e) {}
        }
      }));
    }
  });
});

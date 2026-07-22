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

const GU_TO_BRL=5;
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
Object.keys(KPI_DEMO).forEach(k=>{
  if(/fee|buyin|jackpot/i.test(k)&&typeof KPI_DEMO[k]==='number')KPI_DEMO[k]=KPI_DEMO[k]*GU_TO_BRL;
});
KPI_DEMO.feeRateB.forEach(x=>x.fee*=GU_TO_BRL);
D.slots30.forEach(s=>s.fee*=GU_TO_BRL);
D.gametypes.forEach(g=>{g.fee*=GU_TO_BRL;g.buyin*=GU_TO_BRL;});
D.opShift.forEach(o=>o.fee*=GU_TO_BRL);
D.rooms.forEach(r=>{r.fee*=GU_TO_BRL;r.buyin*=GU_TO_BRL;});
D.blinds.forEach(b=>b.fee*=GU_TO_BRL);
D.duration.forEach(x=>x.fee*=GU_TO_BRL);
D.top10.forEach(x=>{x.fee*=GU_TO_BRL;x.buyin*=GU_TO_BRL;});
D.tiers.forEach(t=>{t.fee*=GU_TO_BRL;t.buyin*=GU_TO_BRL;t.avg_fph*=GU_TO_BRL;t.avg_fpp*=GU_TO_BRL;t.avg_bpp*=GU_TO_BRL;});
D.fpp.forEach(x=>x.fpp*=GU_TO_BRL);

// ══════════════════════════════ HELPERS
// (shiftOf definido logo abaixo; a normalização de turnos roda após ele)
const f=(n,d=0)=>n==null?'—':Number(n).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const fK=n=>n>=1e6?f(n/1e6,1)+'M':n>=1e3?f(n/1e3,1)+'k':f(n,0);
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

// ══════════════════════════════ INTEL CARD RENDERER (shared by recs/shiftRecs/fcIntel)
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
function detectShift(){
  const h=new Date().getHours();
  const s=shiftOf(h);
  const chip=document.getElementById('shiftChip');
  const pl=document.getElementById('shiftPulse');
  const lb=document.getElementById('shiftLabel');
  chip.className='shift-chip '+s;
  pl.className='pulse '+s;
  lb.textContent=s==='dia'?'Turno Dia (07–19)':'Turno Noite (19–07)';
}
detectShift();

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
    const c=s.turno==='dia'?`rgba(79,142,247,${a.toFixed(2)})`:`rgba(167,139,250,${a.toFixed(2)})`;
    const tt=`${s.slot} · Turno ${s.turno==='dia'?'Dia':'Noite'} · R$ ${f(s.fee,0)} · ${s.tables} mesas · ${s.players} players`;
    band+=`<div class="tl-seg" style="background:${c}" title="${tt}"></div>`;
  });
  band+='</div>';
  el.innerHTML=ax+band;
}

// ══════════════════════════════ HOUR CHART
let hrC;
function buildHrChart(){
  // recomputa por hora a partir do D ATIVO (recalculado a cada troca de dataset)
  const hrByH={};
  D.slots30.forEach(s=>{const h=parseInt(s.slot);if(!hrByH[h]){hrByH[h]={fee:0,players:0,hands:0,tables:0,concurrent:0}}hrByH[h].fee+=s.fee;hrByH[h].players+=s.players;hrByH[h].hands+=s.hands;hrByH[h].tables+=s.tables;});
  D.concurrent.forEach(c=>{if(hrByH[c.h])hrByH[c.h].concurrent=c.open;});
  const hrLabels=[],hrFee=[],hrPl=[],hrHd=[],hrTb=[],hrCc=[],hrBg=[],hrBd=[];
  for(let h=0;h<24;h++){hrLabels.push(String(h).padStart(2,'0')+'h');const d=hrByH[h]||{fee:0,players:0,hands:0,tables:0,concurrent:0};hrFee.push(d.fee);hrPl.push(d.players);hrHd.push(d.hands);hrTb.push(d.tables);hrCc.push(d.concurrent);hrBg.push(shiftOf(h)==='dia'?'rgba(79,142,247,.2)':'rgba(167,139,250,.2)');hrBd.push(shiftOf(h)==='dia'?'#4f8ef7':'#a78bfa');}
  hrC=new Chart(document.getElementById('cHour'),{
    type:'bar',
    data:{labels:hrLabels,datasets:[
      {type:'line',data:hrFee,borderColor:CTXTB,borderWidth:1.5,tension:.4,fill:false,pointRadius:0,pointHoverRadius:4,yAxisID:'y',order:1},
      {type:'bar',data:hrFee,backgroundColor:hrBg,borderColor:hrBd,borderWidth:1,borderRadius:4,yAxisID:'y',order:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{title:c=>`${c[0].label} · ${shiftOf(parseInt(c[0].label))==='dia'?'Turno Dia':'Turno Noite'}`,label:c=>c.datasetIndex===0?` R$ ${f(c.parsed.y,0)}`:''}},
      },
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT,maxRotation:0,callback:(v,i)=>i%3===0?hrLabels[i]:''},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}}}
    }
  });
  window._hrData={fee:hrFee,players:hrPl,hands:hrHd,tables:hrTb,concurrent:hrCc};
}
function swHr(m,el){
  document.querySelectorAll('.chtab').forEach(t=>t.classList.remove('on'));el.classList.add('on');
  const d=window._hrData[m];
  hrC.data.datasets[0].data=d;hrC.data.datasets[1].data=d;hrC.update();
}

// ══════════════════════════════ LIFECYCLE
function buildLifecycle(){
  new Chart(document.getElementById('cLife'),{
    type:'bar',
    data:{labels:D.slots30.map(s=>s.slot),datasets:[
      {type:'bar',label:'Abertas',data:D.slots30.map(s=>s.tables),backgroundColor:D.slots30.map(s=>s.turno==='dia'?'rgba(79,142,247,.3)':'rgba(167,139,250,.3)'),borderColor:D.slots30.map(s=>s.turno==='dia'?'#4f8ef7':'#a78bfa'),borderWidth:1,borderRadius:3},
      {type:'line',label:'Encerradas',data:D.end30.map(s=>s.tables),borderColor:'#f87171',borderWidth:1.5,tension:.4,fill:false,pointRadius:0,pointHoverRadius:4}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10,usePointStyle:true}},tooltip:{...CTOP}},
      scales:{x:{grid:{display:false},ticks:{font:{size:8},color:CTEXT,maxRotation:0,callback:(v,i)=>i%4===0?D.slots30[i].slot:''},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ MODAL
function buildModal(){
  const d=D.gametypes.slice(0,8);
  const cols=['#4f8ef7','#a78bfa','#34d399','#fbbf24','#f87171','#f472b6','#60a5fa','#c084fc'];
  new Chart(document.getElementById('cModal'),{
    type:'bar',
    data:{labels:d.map(x=>x.type),datasets:[{label:'Fee',data:d.map(x=>x.fee),backgroundColor:cols,borderRadius:5,borderSkipped:false}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed.x,0)} · rake ${d[c.dataIndex].rake_rate}%`}}},
      scales:{x:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}},y:{grid:{display:false},ticks:{font:{size:10},color:CTXTB,font:{weight:'700'}},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ OPERATORS
function buildOpDiv(){
  const ops=['Mesas S1','Mesas S2','Mesas S3','Mesas P1'];
  const total=D.opShift.reduce((a,b)=>a+b.fee,0);
  document.getElementById('opDiv').innerHTML=ops.map(op=>{
    const dia=D.opShift.find(x=>x.op===op&&x.turno==='dia')||{tables:0,fee:0,players:0};
    const noite=D.opShift.find(x=>x.op===op&&x.turno==='noite')||{tables:0,fee:0,players:0};
    const t=dia.fee+noite.fee;if(!t)return'';
    return`<div class="pb" style="margin-bottom:14px">
      <div class="pb-top"><span class="pb-t">${op}</span><span class="pb-s">R$ ${f(t,0)} · ${(t/total*100).toFixed(1)}%</span></div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px">
        <div style="width:${(dia.fee/t*100).toFixed(1)}%;background:#4f8ef7;border-radius:4px 0 0 4px;min-width:2px"></div>
        <div style="flex:1;background:#a78bfa;border-radius:0 4px 4px 0;min-width:2px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--ink3);margin-top:3px">
        <span style="color:var(--dia)"><i class="ph-fill ph-sun"></i> ${f(dia.fee,0)}</span><span style="color:var(--noite)"><i class="ph-fill ph-moon-stars"></i> ${f(noite.fee,0)}</span>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════ TOP 10
function buildTop10(){
  const t=document.getElementById('top10t');
  t.innerHTML=`<thead><tr><th>#</th><th>Sessão</th><th>Tipo</th><th>Turno</th><th class="r">Players</th><th class="r">Mãos</th><th class="r">Dur.</th><th class="r">Buyin R$</th><th class="r">Fee R$</th><th class="r">Take rate</th></tr></thead><tbody>`+
  D.top10.map((r,i)=>{
    const sh=shiftOf(r.start_h);const tr=(r.fee/r.buyin*100).toFixed(1);
    const trc=tr>15?'var(--red)':tr>10?'var(--amber)':'var(--green)';
    return`<tr>
      <td><span class="rk">${i+1}</span></td>
      <td class="b" style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</td>
      <td><span class="tag ${tagCls(r.type)}">${r.type}</span></td>
      <td><span class="sbdg ${sh}"><span class="sdot ${sh}"></span>${sh==='dia'?'Dia':'Noite'}</span></td>
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
    const bestDiaSlot=D.slots30.filter(s=>s.turno==='dia'&&s.tables).reduce((a,b)=>b.fee>(a?a.fee:0)?b:a,null);
    const bestNoiteSlot=D.slots30.filter(s=>s.turno==='noite'&&s.tables).reduce((a,b)=>b.fee>(a?a.fee:0)?b:a,null);
    const slotsTxt=[bestDiaSlot&&`${bestDiaSlot.slot} (Dia)`,bestNoiteSlot&&`${bestNoiteSlot.slot} (Noite)`].filter(Boolean).join(' e ');
    recs.push({i:ic('fire',1),c:'g',t:`${top.type} domina ${f(topShare,1)}% do rake`,
      b:`R$ ${f(top.fee,0)} em ${top.tables} mesas.${slotsTxt?` Priorizar abertura em ${slotsTxt} — os melhores slots de cada turno.`:''}`,sh:'dia'});
  }

  if(KPI_DEMO.tablesDia>0&&KPI_DEMO.tablesNoite>0){
    const diaFpm=KPI_DEMO.feeDia/KPI_DEMO.tablesDia, noiteFpm=KPI_DEMO.feeNoite/KPI_DEMO.tablesNoite;
    const shiftUp=noiteFpm>=diaFpm?'noite':'dia', shiftDown=shiftUp==='dia'?'noite':'dia';
    const minFpm=Math.min(diaFpm,noiteFpm);
    const shiftGap=minFpm>0?(Math.abs(noiteFpm-diaFpm)/minFpm*100):0;
    recs.push({i:ic(shiftUp==='noite'?'moon-stars':'sun',1),c:'i',t:`Turno ${shiftUp==='dia'?'Dia':'Noite'}: fee/mesa ${f(shiftGap,0)}% maior`,
      b:`R$ ${f(Math.max(diaFpm,noiteFpm),1)} vs R$ ${f(minFpm,1)} no Turno ${shiftDown==='dia'?'Dia':'Noite'}. A diferença de eficiência por mesa é o principal sinal de qualidade de player entre turnos.`,sh:shiftUp});
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
    b:`O melhor slot de toda a operação, no Turno ${bestSlot.turno==='dia'?'Dia':'Noite'}. Garantir cobertura operacional máxima nesse horário.`,sh:bestSlot.turno});

  if(KPI_DEMO.crossShift>0)recs.push({i:ic('arrows-clockwise',1),c:'w',t:`${f(KPI_DEMO.crossShift)} sessões cruzam a virada de turno`,
    b:`${f(KPI_DEMO.crossShiftPct,1)}% das sessões diárias. Handoff crítico às 07h e 19h — rastrear quais salas geram mais mesas órfãs nesse momento.`,sh:''});

  return recs;
}
function buildRecs(){
  const recs=computeOverviewRecs();
  document.getElementById('recsDiv').innerHTML=recs.map(r=>`
    <div class="rec ${r.c}">
      <span class="rec-ico">${r.i}</span>
      <div class="rec-t">${r.t}</div>
      <div class="rec-b">${r.b}</div>
      ${r.sh?`<div class="rec-sh ${r.sh}">${r.sh==='dia'?ic('sun',1)+' Turno Dia':ic('moon-stars',1)+' Turno Noite'}</div>`:''}
    </div>`).join('');
}

// ══════════════════════════════ SHIFT BEST SLOTS
function buildBestSlots(){
  const dia=D.slots30.filter(s=>s.turno==='dia').sort((a,b)=>b.fee-a.fee).slice(0,3);
  const noite=D.slots30.filter(s=>s.turno==='noite').sort((a,b)=>b.fee-a.fee).slice(0,3);
  const maxDia=dia[0]?.fee||1;const maxNoite=noite[0]?.fee||1;
  const renderSlots=(arr,maxF,col,elId)=>{
    document.getElementById(elId).innerHTML=arr.map(s=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:10px;font-weight:800;width:40px;color:${col}">${s.slot}</span>
        <div style="flex:1;height:5px;background:rgba(130,132,142,.18);border-radius:3px;overflow:hidden">
          <div style="width:${(s.fee/maxF*100).toFixed(0)}%;height:100%;background:${col};border-radius:3px"></div>
        </div>
        <span style="font-size:9px;font-weight:700;color:${col};width:60px;text-align:right">R$ ${fK(s.fee)}</span>
      </div>`).join('');
  };
  renderSlots(dia,maxDia,'#4f8ef7','diaBestSlots');
  renderSlots(noite,maxNoite,'#a78bfa','nBestSlots');
}

// ══════════════════════════════ SHIFT FEE CHART
function buildShiftFee(){
  const dia=D.slots30.filter(s=>s.turno==='dia');
  const noite=D.slots30.filter(s=>s.turno==='noite');
  const ctx=document.getElementById('cShiftFee');if(!ctx)return;
  new Chart(ctx,{
    type:'bar',
    data:{labels:Array.from({length:Math.max(dia.length,noite.length)},(_,i)=>i),
      datasets:[
        {label:'Dia (07-19h)',data:dia.map(s=>s.fee),backgroundColor:'rgba(79,142,247,.3)',borderColor:'#4f8ef7',borderWidth:1,borderRadius:4},
        {label:'Noite (19-07h)',data:noite.map(s=>s.fee),backgroundColor:'rgba(167,139,250,.3)',borderColor:'#a78bfa',borderWidth:1,borderRadius:4}
      ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},tooltip:{...CTOP,callbacks:{title:c=>c[0].datasetIndex===0?dia[c[0].dataIndex]?.slot:noite[c[0].dataIndex]?.slot}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:8},color:CTEXT,callback:(v,i)=>i%3===0?(dia[i]?.slot||''):''},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}}}
    }
  });
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

// ══════════════════════════════ OP SHIFT TABLE
function buildOpShiftTable(){
  const t=document.getElementById('opShiftTbl');if(!t)return;
  const ops=[...new Set(D.opShift.map(x=>x.op))];
  t.innerHTML=`<thead><tr><th>Operador</th><th>Turno</th><th class="r">Mesas</th><th class="r">Fee R$</th><th class="r">Players</th><th class="r">Mortas</th><th class="r">Fee/mesa</th></tr></thead><tbody>`+
  ops.flatMap(op=>{
    const d=D.opShift.find(x=>x.op===op&&x.turno==='dia')||{tables:0,fee:0,players:0,dead:0};
    const n=D.opShift.find(x=>x.op===op&&x.turno==='noite')||{tables:0,fee:0,players:0,dead:0};
    return[`<tr><td rowspan="2" class="b" style="border-right:1px solid var(--bdr)">${op}</td>
      <td><span class="sbdg dia"><span class="sdot dia"></span><i class="ph-fill ph-sun"></i> Dia</span></td>
      <td class="r m">${f(d.tables)}</td><td class="r b">${f(d.fee,0)}</td><td class="r m">${f(d.players)}</td>
      <td class="r" style="color:${d.tables?d.dead/d.tables>0.25?'var(--amber)':'var(--ink2)':'var(--ink3)'}">${d.dead} (${d.tables?f(d.dead/d.tables*100,0):0}%)</td>
      <td class="r m">${d.tables?f(d.fee/d.tables,1):'—'}</td></tr>`,
    `<tr style="background:rgba(255,255,255,.015)"><td><span class="sbdg noite"><span class="sdot noite"></span><i class="ph-fill ph-moon-stars"></i> Noite</span></td>
      <td class="r m">${f(n.tables)}</td><td class="r b">${f(n.fee,0)}</td><td class="r m">${f(n.players)}</td>
      <td class="r" style="color:${n.tables?n.dead/n.tables>0.25?'var(--amber)':'var(--ink2)':'var(--ink3)'}">${n.dead} (${n.tables?f(n.dead/n.tables*100,0):0}%)</td>
      <td class="r m">${n.tables?f(n.fee/n.tables,1):'—'}</td></tr>`];
  }).join('')+'</tbody>';
}

// ══════════════════════════════ SHIFT RECS — INTEL CARDS
function buildShiftRecs(){
  if(!document.getElementById('shiftRecs'))return;

  const diaFee=KPI_DEMO.feeDia, noiteFee=KPI_DEMO.feeNoite;
  const diaMesas=KPI_DEMO.tablesDia, noiteMesas=KPI_DEMO.tablesNoite;
  const diaFpm=diaFee/diaMesas, noiteFpm=noiteFee/noiteMesas;
  const diaDeadPct=KPI_DEMO.deadDia/diaMesas*100, noiteDeadPct=KPI_DEMO.deadNoite/noiteMesas*100;
  const higherFpm=noiteFpm>=diaFpm?'noite':'dia';
  const gain=(Math.abs(noiteFpm-diaFpm)/Math.min(diaFpm,noiteFpm)*100);
  const volumeUp=diaMesas>=noiteMesas?'dia':'noite';
  const volumeGain=(Math.abs(diaMesas-noiteMesas)/Math.min(diaMesas,noiteMesas)*100);
  const revenueUp=diaFee>=noiteFee?'dia':'noite';
  const revenueGain=(Math.abs(diaFee-noiteFee)/Math.min(diaFee,noiteFee)*100);

  const diaSlots=D.slots30.filter(s=>s.turno==='dia'), noiteSlots=D.slots30.filter(s=>s.turno==='noite');
  const bestDiaSlot=diaSlots.reduce((a,b)=>b.fee>a.fee?b:a);
  const bestNoiteSlot=noiteSlots.reduce((a,b)=>b.fee>a.fee?b:a);
  const bestDiaEff=bestDiaSlot.fee/(bestDiaSlot.tables*0.5);
  const bestNoiteEff=bestNoiteSlot.fee/(bestNoiteSlot.tables*0.5);
  const avgEff=D.slots30.filter(s=>s.tables).reduce((a,s)=>a+s.fee/(s.tables*0.5),0)/D.slots30.filter(s=>s.tables).length;
  const overallBest=bestNoiteSlot.fee>=bestDiaSlot.fee?bestNoiteSlot:bestDiaSlot, overallOther=overallBest===bestNoiteSlot?bestDiaSlot:bestNoiteSlot;
  const overallBestEff=overallBest===bestNoiteSlot?bestNoiteEff:bestDiaEff;
  const diaSlotShare=bestDiaSlot.fee/diaFee*100;

  const crossing=KPI_DEMO.crossShift;
  const crossPct=crossing/(diaMesas+noiteMesas)*100;

  const lostDeadFee=Math.round((diaDeadPct/100)*diaFee+(noiteDeadPct/100)*noiteFee);

  // slot de chegada logo antes da virada às 07h (06:30 é o último bloco do Noite)
  const noite7hSlot=noiteSlots.find(s=>s.slot==='06:30');
  const noiteRank=[...noiteSlots].sort((a,b)=>b.fee-a.fee).findIndex(s=>s.slot==='06:30')+1;

  const cards=[
    {
      type:'both', icon:ic('scales',1),
      tag:'Comparativo',
      title:`Turno ${higherFpm==='noite'?'Noite':'Dia'} é ${f(gain,0)}% mais eficiente por mesa — mas Turno ${revenueUp==='dia'?'Dia':'Noite'} gera ${f(revenueGain,0)}% mais receita total`,
      body:`O Turno ${volumeUp==='dia'?'Dia':'Noite'} abre ${f(volumeGain,0)}% mais mesas e domina em volume. O outro turno compensa com qualidade: players com stakes mais altos produzem R$ ${f(gain,0)}% a mais por mesa. A estratégia ótima é maximizar volume onde ele já é forte e proteger qualidade no outro turno.`,
      compare:{
        left:{label:'dia', val:'R$ '+f(diaFpm,0), sub:'fee por mesa ativa'},
        right:{label:'noite', val:'R$ '+f(noiteFpm,0), sub:'fee por mesa ativa'}
      },
      action:{cls:'both', text:'Oportunidade estrutural de longo prazo'}
    },
    {
      type:overallBest===bestNoiteSlot?'noite':'dia', icon:ic('sparkle',1),
      tag:`Turno ${overallBest===bestNoiteSlot?'Noite':'Dia'}`,
      title:`${overallBest.slot} supera qualquer slot do outro turno — o melhor momento de toda a operação`,
      body:`O slot das ${overallBest.slot} gera R$ ${f(overallBest.fee,0)} em apenas 30 minutos, ${f((overallBest.fee/overallOther.fee-1)*100,0)}% acima do melhor slot do outro turno. Fee/mesa/hora de R$ ${f(overallBestEff,1)} — ${f(overallBestEff/avgEff,1)}x a média geral. Cobertura operacional neste bloco é inegociável.`,
      metric:{val:'R$ '+f(overallBestEff,1), cls:overallBest===bestNoiteSlot?'noite':'dia', label:`fee por mesa por hora no slot ${overallBest.slot}`},
      compare:{
        left:{label:'noite', val:'R$ '+f(bestNoiteSlot.fee,0), sub:'melhor slot: '+bestNoiteSlot.slot},
        right:{label:'dia', val:'R$ '+f(bestDiaSlot.fee,0), sub:'melhor slot: '+bestDiaSlot.slot}
      },
      action:{cls:overallBest===bestNoiteSlot?'noite':'dia', text:'Prioridade máxima nesse bloco'}
    },
    {
      type:'dia', icon:ic('sun',1),
      tag:'Turno Dia',
      title:`${bestDiaSlot.slot} concentra ${f(diaSlotShare,1)}% de todo o fee diurno em 30 minutos`,
      body:`O slot das ${bestDiaSlot.slot} gera R$ ${f(bestDiaSlot.fee,0)}, representando ${f(diaSlotShare,1)}% de todo o rake do Turno Dia. Mesas premium, promoções e atenção operacional devem se concentrar neste momento.`,
      metric:{val:f(diaSlotShare,1)+'%', cls:'dia', label:`do rake do Turno Dia gerado no slot ${bestDiaSlot.slot}`},
      compare:{
        left:{label:'dia', val:'R$ '+f(bestDiaSlot.fee,0), sub:`slot ${bestDiaSlot.slot} (30 min)`},
        right:{label:'dia', val:'R$ '+f(diaFee/diaSlots.length,0), sub:'média por slot 30min'}
      },
      action:{cls:'dia', text:`Preparar grade antes das ${bestDiaSlot.slot}`}
    },
    {
      type:'alert', icon:ic('arrows-clockwise',1),
      tag:'Risco operacional',
      title:`${f(crossing)} sessões ativas na virada de turno — ${f(crossPct,1)}% das mesas não têm dono claro`,
      body:`Às 07:00 e 19:00 há ${f(crossing)} mesas em andamento que foram abertas no turno anterior. Com crescimento da base, esse número vai aumentar. Sem protocolo de handoff, jogadores nessas mesas ficam sem suporte. Criar SLA de transferência é urgente.`,
      metric:{val:f(crossPct,1)+'%', cls:'r', label:'das sessões diárias cruzam a fronteira de turno'},
      action:{cls:'a', text:'Implementar protocolo de handoff'}
    },
    {
      type:'gold', icon:ic('hand-coins',1),
      tag:'Fee desperdiçado',
      title:`R$ ${f(lostDeadFee,0)} perdidos por mesas mortas — ${f(diaDeadPct,1)}% Dia e ${f(noiteDeadPct,1)}% Noite`,
      body:`Taxa de ociosidade próxima nos dois turnos indica problema estrutural, não de gestão por turno. As mesas abertas sem jogadores custam rake não gerado. Cada 1% de redução na taxa de mortas equivale a aproximadamente R$ ${f(lostDeadFee/100*20,0)} extras por dia.`,
      compare:{
        left:{label:'dia', val:f(diaDeadPct,1)+'%', sub:'mesas sem retenção'},
        right:{label:'noite', val:f(noiteDeadPct,1)+'%', sub:'mesas sem retenção'}
      },
      action:{cls:'a', text:'Auditar salas com maior ociosidade'}
    },
  ];
  if(noite7hSlot){
    cards.push({
      type:'noite', icon:ic('rocket-launch',1),
      tag:'Underdog do Noite',
      title:`06:30 é o slot surpresa — R$ ${f(noite7hSlot.fee,0)} ignorado nos relatórios convencionais`,
      body:`O bloco das 06h30 gera R$ ${f(noite7hSlot.fee,0)} — mais que a maioria dos slots do Turno Noite tardio. É o "pico de chegada" de jogadores logo antes da virada às 07h. Abrir mesas premium nesse slot adianta receita da transição de turno.`,
      metric:{val:'R$ '+f(noite7hSlot.fee,0), cls:'noite', label:`gerados no slot 06:30 — ${noiteRank}° melhor do Turno Noite`},
      action:{cls:'noite', text:'Abrir grade premium às 06:30'}
    });
  }
  renderIntelCards('shiftRecs',cards);
}

// ══════════════════════════════ TIER CHARTS
function buildTierCharts(){
  const ctx1=document.getElementById('cTierFee');if(!ctx1)return;
  const cols=['rgba(120,120,150,.6)','rgba(79,142,247,.7)','rgba(52,211,153,.7)','rgba(251,191,36,.8)','rgba(212,168,83,.9)'];
  new Chart(ctx1,{type:'bar',
    data:{labels:D.tiers.map(t=>t.tier),datasets:[{label:'Fee',data:D.tiers.map(t=>t.fee),backgroundColor:cols,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed.y,0)} · rake ${D.tiers[c.dataIndex].rake_rate}% · ret ${D.tiers[c.dataIndex].ret_pct}%`}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>fK(v)},border:{display:false}}}
    }
  });
  const ctx2=document.getElementById('cTierFph');if(!ctx2)return;
  new Chart(ctx2,{type:'bar',
    data:{labels:D.tiers.map(t=>t.tier),datasets:[{label:'Fee/mão',data:D.tiers.map(t=>t.avg_fph),backgroundColor:cols,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{label:c=>` R$ ${c.parsed.y.toFixed(4)}/mão · fee/player ${D.tiers[c.dataIndex].avg_fpp}`}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},color:CTEXT},border:{display:false}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ CONCENTRATION BAR
function buildConc(){
  const el=document.getElementById('concBar');if(!el)return;
  el.innerHTML=`<div class="conc-bar">
    <div class="conc-seg" style="width:32.6%;background:linear-gradient(135deg,#d4a853,#f59e0b)" title="Top 1%: 32,6% do rake">Top 1%</div>
    <div class="conc-seg" style="width:26.8%;background:linear-gradient(135deg,#4f8ef7,#60a5fa)" title="1%-5%: 26,8%">2–5%</div>
    <div class="conc-seg" style="width:15.1%;background:linear-gradient(135deg,#34d399,#6ee7b7)" title="5%-10%: 15,1%">6–10%</div>
    <div class="conc-seg" style="width:13.9%;background:linear-gradient(135deg,#a78bfa,#c084fc)" title="10%-20%: 13,9%">11–20%</div>
    <div class="conc-seg" style="flex:1;background:rgba(130,132,142,.2)" title="Resto 80%: 11,6%">80%</div>
  </div>
  <div class="conc-labels"><span style="color:var(--gold)">Top 1% · 32,6%</span><span style="color:var(--dia)">1–5% · 26,8%</span><span style="color:var(--green)">5–10% · 15,1%</span><span style="color:var(--noite)">10–20% · 13,9%</span><span>Demais · 11,6%</span></div>`;
}

// ══════════════════════════════ HU MULTI CHART
function buildHuMulti(){
  const ctx=document.getElementById('cHuMulti');if(!ctx)return;
  new Chart(ctx,{type:'doughnut',
    data:{labels:['Multi (3+ players)','HU (≤2 players)'],datasets:[{data:[KPI_DEMO.multiFee,KPI_DEMO.huFee],backgroundColor:['#4f8ef7','#a78bfa'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},
        tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed,0)} (${(c.parsed/KPI_DEMO.feeGross*100).toFixed(1)}%)`}}}
    }
  });
}

// ══════════════════════════════ JP CHART
function buildJP(){
  const ctx=document.getElementById('cJP');if(!ctx)return;
  new Chart(ctx,{type:'doughnut',
    data:{labels:['Fee Líquido','Jackpot Deduzido'],datasets:[{data:[KPI_DEMO.feeNet,KPI_DEMO.jackpot],backgroundColor:['#34d399','#f87171'],borderWidth:0,hoverOffset:5}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'70%',
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:10}},
        tooltip:{...CTOP,callbacks:{label:c=>` R$ ${f(c.parsed,0)}`}}}
    }
  });
}

// ══════════════════════════════ FPP BARS
function buildFPP(){
  const el=document.getElementById('fppBars');if(!el)return;
  const max=D.fpp[0].fpp;
  el.innerHTML=D.fpp.map(d=>`
    <div class="mb">
      <span class="mb-l">${d.type}</span>
      <div class="mb-t"><div class="mb-f" style="width:${(d.fpp/max*100).toFixed(0)}%;background:${d.fpp>20?'#d4a853':d.fpp>8?'#4f8ef7':CMUTE}"></div></div>
      <span class="mb-v">R$ ${d.fpp.toFixed(2)}</span>
    </div>`).join('');
}

// ══════════════════════════════ ROOMS TABLE
function buildRooms(){
  const t=document.getElementById('roomsTbl');if(!t)return;
  t.innerHTML=`<thead><tr><th>#</th><th>Sala</th><th class="r">Mesas</th><th class="r">Players</th><th class="r">Fee R$</th><th class="r">Buyin R$</th><th class="r">Take rate</th></tr></thead><tbody>`+
  D.rooms.map((r,i)=>{
    const rr=r.rake_rate;
    const c=rr>15?'var(--red)':rr>10?'var(--amber)':'var(--green)';
    const bg=rr>15?'rgba(248,113,113,.1)':rr>10?'rgba(251,191,36,.1)':'rgba(52,211,153,.1)';
    return`<tr><td><span class="rk">${i+1}</span></td><td class="b">${r.name}</td><td class="r m">${r.tables}</td><td class="r m">${f(r.players)}</td><td class="r b">${f(r.fee,0)}</td><td class="r m">${f(r.buyin,0)}</td>
      <td class="r"><span style="padding:2px 8px;border-radius:4px;font-size:8px;font-weight:800;background:${bg};color:${c}">${rr}%</span></td></tr>`;
  }).join('')+'</tbody>';
}

// ══════════════════════════════ RAKE RATE CHART
function buildRR(){
  const ctx=document.getElementById('cRR');if(!ctx)return;
  const d=[...D.rooms].sort((a,b)=>b.rake_rate-a.rake_rate).slice(0,12);
  new Chart(ctx,{type:'bar',
    data:{labels:d.map(x=>x.name),datasets:[{label:'Rake rate %',data:d.map(x=>x.rake_rate),backgroundColor:d.map(x=>x.rake_rate>15?'rgba(248,113,113,.8)':x.rake_rate>10?'rgba(251,191,36,.8)':'rgba(79,142,247,.7)'),borderRadius:5,borderSkipped:false}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...CTOP,callbacks:{label:c=>` ${c.parsed.x}% rake rate`}}},
      scales:{x:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'%'},border:{display:false}},y:{grid:{display:false},ticks:{font:{size:9},color:CTXTB},border:{display:false}}}
    }
  });
}

// ══════════════════════════════ BLIND BARS
function buildBlindBars(){
  const el=document.getElementById('blindBars');if(!el)return;
  const max=Math.max(...D.blinds.map(b=>b.tables));
  el.innerHTML=D.blinds.map(b=>`
    <div class="mb">
      <span class="mb-l">BB ${b.bb} GU</span>
      <div class="mb-t"><div class="mb-f" style="width:${(b.tables/max*100).toFixed(0)}%;background:${b.fee>40000?'#d4a853':b.fee>15000?'#4f8ef7':CMUTE}"></div></div>
      <span class="mb-v">${b.tables} <span style="font-weight:400;color:var(--ink3)">mesas</span></span>
    </div>
    <div style="font-size:8px;color:var(--ink3);margin:-4px 0 8px 84px">Fee R$ ${f(b.fee,0)}</div>`).join('');
}

// ══════════════════════════════ BUBBLE
function buildBubble(){
  const ctx=document.getElementById('cBubble');if(!ctx)return;
  const d=D.gametypes.filter(x=>x.tables>10);
  const cols=['#4f8ef7','#a78bfa','#34d399','#fbbf24','#f87171','#f472b6','#60a5fa','#c084fc'];
  new Chart(ctx,{type:'bubble',
    data:{datasets:d.map((x,i)=>({label:x.type,data:[{x:x.fee/1000,y:x.rake_rate,r:Math.sqrt(x.tables)*2}],backgroundColor:cols[i%cols.length]+'88',borderColor:cols[i%cols.length],borderWidth:1}))},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:8},color:CTEXT,boxWidth:8,boxHeight:8,padding:6}},tooltip:{...CTOP,callbacks:{title:c=>c[0].dataset.label,label:c=>[` Fee: R$ ${f(c.parsed.x*1000,0)}`,` Rake: ${c.parsed.y}%`,` Mesas: ${d.find(g=>g.type===c.dataset.label)?.tables}`]}}},
      scales:{x:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'k'},border:{display:false},min:0,title:{display:true,text:'Fee (R$ k)',font:{size:9},color:CTEXT}},y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>v+'%'},border:{display:false},min:4,max:32,title:{display:true,text:'Rake rate %',font:{size:9},color:CTEXT}}}
    }
  });
}

// ══════════════════════════════ RETENTION
function buildRet(){
  const ctx=document.getElementById('cRet');if(!ctx)return;
  new Chart(ctx,{type:'bar',
    data:{labels:D.duration.map(x=>x.bucket),datasets:[
      {label:'Retidas',data:D.duration.map(x=>x.tables-x.dead),backgroundColor:'#4f8ef7',borderRadius:5,borderSkipped:false},
      {label:'Mortas',data:D.duration.map(x=>x.dead),backgroundColor:'rgba(248,113,113,.3)',borderRadius:5,borderSkipped:false}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:8}},tooltip:{...CTOP,callbacks:{afterBody:c=>[`Retenção: ${D.duration[c[0].dataIndex].ret}%`]}}},
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
  const base={date:'22/06/2026',shift:'Dia + Noite',sessions:2965,fee:220888,netFee:202645,buyin:2683388,players:37777,feePerHand:0.76,deadPct:24.5,takeRate:8.23,demo:true};
  const all=[base,...days.filter(d=>d.date!==base.date)].sort((a,b)=>parseDateLabel(a.date)-parseDateLabel(b.date));

  // day-over-day comparison card
  const cmpEl=document.getElementById('histCompare');
  if(cmpEl){
    const real=all.filter(d=>!d.demo);
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

  body.innerHTML=all.map(d=>`<tr>
    <td class="b">${d.date}${d.demo?` <span class="tag t6">demo</span>`:''}</td><td>${d.shift||'—'}</td>
    <td class="r m">${f(d.sessions)}</td><td class="r b">${f(d.fee,0)}</td>
    <td class="r m">${f(d.netFee,0)}</td><td class="r m">${f(d.buyin,0)}</td>
    <td class="r m">${f(d.players)}</td><td class="r m">${(d.feePerHand||0).toFixed(2)}</td>
    <td class="r m">${d.deadPct}%</td><td class="r m">${d.takeRate||'—'}%</td>
    <td class="r">${d.demo?'':`<button class="icon-btn" title="Remover" onclick="removeHistoryDay('${d.date}')">${ic('trash')}</button>`}</td>
  </tr>`).join('');

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

// ══════════════════════════════ STORAGE ABSTRACTION
// Firebase Realtime Database, mesmo projeto do Painel/Admin (design-1-53c00).
// Node: mesasCashHistory/{yyyy-mm-dd} — chave sem "/" pois RTDB não aceita
// barra em path. Cai para localStorage se o Firebase não estiver disponível
// (offline, bloqueado, etc.) para nunca travar o uso do dashboard.
const RTDB_NODE='mesasCashHistory';
const RTDB_DATA='mesasCashData';
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
      try{await db.ref(`${RTDB_DATA}/${key}`).set(fbPack(raw));return 'cloud';}
      catch(e){console.error('Store.saveRaw (Firebase)',e);}
    }
    return 'local';
  },
  async listRaw(){
    await whenAuthReady();
    let fb=null;
    if(fbOk&&db){
      try{fb=fbUnpack((await db.ref(RTDB_DATA).once('value')).val()||{});}
      catch(e){console.error('Store.listRaw (Firebase)',e);}
    }
    const local=localRaws();
    const merged={...local,...(fb||{})};
    // re-sync: dias presos só no localStorage sobem pro Firebase em background
    if(fb!==null&&fbOk&&db){
      Object.keys(local).filter(k=>!(k in fb)).forEach(k=>{
        db.ref(`${RTDB_DATA}/${k}`).set(fbPack(local[k]))
          .then(()=>console.info('Store.listRaw: dia re-sincronizado →',k))
          .catch(e=>console.error('Store.listRaw re-sync',k,e));
      });
    }
    const out={};
    Object.entries(merged).forEach(([k,v])=>{const h=hydrateRaw(v);if(h)out[k]=h;});
    return out;
  },
  async removeRaw(dateStr){
    const key=labelToRtdbKey(dateStr);
    const all=localRaws(); delete all[key]; setLocalRaws(all);
    if(fbOk&&db){
      try{await db.ref(`${RTDB_DATA}/${key}`).remove();}
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
  [renderShiftStats,
   buildTimeline,buildHrChart,buildLifecycle,buildModal,buildOpDiv,buildTop10,buildRecs,
   buildBestSlots,buildShiftFee,buildForecast,buildConcurrent,buildOpShiftTable,buildShiftRecs,
   buildTierCharts,buildConc,buildHuMulti,buildJP,buildFPP,
   buildRooms,buildRR,buildBlindBars,buildBubble,
   buildRet,buildDurFee,buildHM,buildHist,
   buildResumo,buildEventos].forEach(safeBuild);
}
function applyDataset(ds){
  // destrói os gráficos antigos antes de repintar (Chart.js recusa recriar sobre canvas em uso)
  document.querySelectorAll('canvas').forEach(cv=>{const ch=(window.Chart&&Chart.getChart)?Chart.getChart(cv):null; if(ch)ch.destroy();});
  Object.keys(KPI_DEMO).forEach(k=>delete KPI_DEMO[k]); Object.assign(KPI_DEMO, JSON.parse(JSON.stringify(ds.kpi)));
  Object.keys(D).forEach(k=>delete D[k]); Object.assign(D, JSON.parse(JSON.stringify(ds.d)));
  renderAll();
  detectShift();
}
async function onDaySel(val){
  if(val==='__demo__'){ applyDataset(DEMO_DS); return; }
  const raws=await Store.listRaw();
  if(val==='__all__'){
    const list=Object.values(raws); if(!list.length){applyDataset(DEMO_DS);return;}
    applyDataset(finalizeDataset(mergeRaws(list),`Todos os dias (${list.length})`)); return;
  }
  const R=raws[val]; if(!R){applyDataset(DEMO_DS);return;}
  applyDataset(finalizeDataset(R, R.dates&&R.dates[0]||val));
}
async function refreshDaySelector(preferKey){
  const sel=document.getElementById('daySel'); if(!sel)return;
  const raws=await Store.listRaw();
  const keys=Object.keys(raws).sort().reverse(); // yyyy-mm-dd desc
  let html='<option value="__demo__">Demonstração (22/06)</option>';
  if(keys.length>1)html+=`<option value="__all__">Todos os dias (${keys.length})</option>`;
  html+=keys.map(k=>`<option value="${k}">${(raws[k].dates&&raws[k].dates[0])||k}</option>`).join('');
  sel.innerHTML=html;
  if(preferKey && (preferKey==='__demo__'||preferKey==='__all__'||raws[preferKey]))sel.value=preferKey;
}
// No load: se já há dias importados, abre na visão COMBINADA (todos os dias
// juntos, com as análises inteligentes sobre o agregado); senão, a demo.
async function initDayView(){
  try{
    const raws=await Store.listRaw(); const keys=Object.keys(raws).sort();
    if(!keys.length)return; // segue na demo já renderizada
    const start=keys.length>1?'__all__':keys[keys.length-1];
    await refreshDaySelector(start);
    await onDaySel(start);
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
    await refreshDaySelector(labelToRtdbKey(label));
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
let _weekRowsByDate=null;
async function handleValidateUpload(input){
  const fl=input.files[0];if(!fl)return;
  const status=document.getElementById('validarStatus');
  status.innerHTML=`${ic('spinner',1)} Lendo arquivo…`;
  try{
    const rows=await readRowsFromFile(fl);
    if(!rows.length){status.innerHTML=`${ic('warning',1)} Nenhuma sessão com Start Time válido encontrada.`;return;}
    const byDate={};
    rows.forEach(r=>{const k=dateKey(r.startTime);(byDate[k]=byDate[k]||[]).push(r);});
    _weekRowsByDate=byDate;
    const existing=await Store.list();
    const dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const keys=Object.keys(byDate).sort();
    const tbl=document.getElementById('validarPreviewTbl');
    tbl.innerHTML=`<thead><tr><th>Data</th><th>Dia</th><th class="r">Sessões</th><th class="r">Fee Bruto</th><th class="r">Buyin</th><th class="r">Players</th><th></th></tr></thead><tbody>`+
      keys.map(k=>{
        const rs=byDate[k];const s=summarizeDay(rs);const d=rs[0].startTime;const lbl=dateLabel(d);
        const dup=existing.find(x=>x.date===lbl);
        return`<tr><td class="b">${lbl}</td><td class="m">${dias[d.getDay()]}</td>
          <td class="r m">${f(s.sessions)}</td><td class="r b">R$ ${f(s.fee,0)}</td>
          <td class="r m">R$ ${f(s.buyin,0)}</td><td class="r m">${f(s.players)}</td>
          <td class="r">${dup?`<span class="tag to">${ic('arrows-clockwise')} substitui</span>`:`<span class="tag tn">${ic('plus')} novo</span>`}</td></tr>`;
      }).join('')+'</tbody>';
    document.getElementById('validarPreviewCard').style.display='block';
    status.innerHTML=`${ic('check-circle',1)} ${keys.length} dia(s) encontrados · confira antes de confirmar.`;
  }catch(err){
    status.innerHTML=`${ic('x-circle',1)} Erro: ${err.message}`;
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
  await refreshDaySelector('__all__');
  await onDaySel('__all__');
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
async function removeHistoryDay(dateStr){
  if(!confirm(`Remover o registro de ${dateStr} do histórico?`))return;
  await Store.remove(dateStr);
  await Store.removeRaw(dateStr);
  const sel=document.getElementById('daySel');
  const wasViewing=sel && sel.value===labelToRtdbKey(dateStr);
  await buildHist();
  await refreshDaySelector(wasViewing?'__demo__':(sel&&sel.value));
  if(wasViewing)await onDaySel(document.getElementById('daySel').value);
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

  // ── Turno projection bar chart
  const ctx3=document.getElementById('cFcTurno');if(!ctx3)return;
  const dF=KPI_DEMO.feeDia, nF=KPI_DEMO.feeNoite;
  new Chart(ctx3,{type:'bar',
    data:{labels:['Semana','Mês','Trimestre','Ano'],
      datasets:[
        {label:'Turno Dia',data:[dF*7,dF*30,dF*90,dF*365],backgroundColor:'rgba(79,142,247,.7)',borderRadius:5,borderSkipped:false},
        {label:'Turno Noite',data:[nF*7,nF*30,nF*90,nF*365],backgroundColor:'rgba(167,139,250,.7)',borderRadius:5,borderSkipped:false},
        {label:'Noite → patamar Dia',data:[(dF-nF)*7,(dF-nF)*30,(dF-nF)*90,(dF-nF)*365],backgroundColor:'rgba(52,211,153,.35)',borderRadius:5,borderSkipped:false},
      ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{size:9},color:CTEXT,boxWidth:10,boxHeight:4,padding:8}},
        tooltip:{...CTOP,callbacks:{label:c=>` R$ ${fK(c.parsed.y)}`}}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:10},color:CTEXT},border:{display:false},stacked:true},
        y:{grid:{color:CGRID},ticks:{font:{size:9},color:CTEXT,callback:v=>'R$ '+fK(v)},border:{display:false},stacked:true}
      }
    }
  });

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
function renderShiftStats(){
  SHIFT=shiftAgg();
  const g=SHIFT, tot=g.dia.fee+g.noite.fee||1;
  const pctD=g.dia.fee/tot*100, pctN=g.noite.fee/tot*100;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const fpm=t=>t.tables?t.fee/t.tables:0, fph=t=>t.hands?t.fee/t.hands:0, dpct=t=>t.tables?t.dead/t.tables*100:0;
  // Overview
  set('ovDiaFee','R$ '+f(g.dia.fee,0)); set('ovDiaSub',`${f(g.dia.tables)} mesas · R$ ${f(fpm(g.dia),0)}/mesa`);
  set('ovNoiteFee','R$ '+f(g.noite.fee,0)); set('ovNoiteSub',`${f(g.noite.tables)} mesas · R$ ${f(fpm(g.noite),0)}/mesa`);
  set('ovDeadSub',`${f(g.dia.dead)} Dia · ${f(g.noite.dead)} Noite`);
  set('ovSub',`${f(KPI_DEMO.sessions)} sessões cash · Turno Dia R$ ${f(g.dia.fee,0)} (${f(pctD,1)}%) · Turno Noite R$ ${f(g.noite.fee,0)} (${f(pctN,1)}%) · ${f(KPI_DEMO.crossShift)} sessões cruzaram a virada · Top 1% das mesas gera 32,6% do rake`);
  // Aba Turnos
  set('sDiaFee','R$ '+f(g.dia.fee,0)); set('sDiaTables',f(g.dia.tables)); set('sDiaPlayers',f(g.dia.players));
  set('sDiaHands',f(g.dia.hands)); set('sDiaDead',`${f(g.dia.dead)} (${f(dpct(g.dia),1)}%)`);
  set('sDiaFph','R$ '+f(fph(g.dia),3)); set('sDiaFpm','R$ '+f(fpm(g.dia),1)); set('sDiaPct',f(pctD,1)+'%');
  set('sNoiteFee','R$ '+f(g.noite.fee,0)); set('sNoiteTables',f(g.noite.tables)); set('sNoitePlayers',f(g.noite.players));
  set('sNoiteHands',f(g.noite.hands)); set('sNoiteDead',`${f(g.noite.dead)} (${f(dpct(g.noite),1)}%)`);
  set('sNoiteFph','R$ '+f(fph(g.noite),3)); set('sNoiteFpm','R$ '+f(fpm(g.noite),1)); set('sNoitePct',f(pctN,1)+'%');
}

// ══════════════════════════════ RESUMO EXECUTIVO (a aba de abertura)
// Reúne as melhores informações do dia + a amplitude de cenários + as análises
// inteligentes já priorizadas. Deriva tudo de KPI_DEMO/D/SHIFT — nada hardcoded.
function buildResumo(){
  if(!document.getElementById('pg-resumo'))return;
  const g=SHIFT||shiftAgg();
  const tot=g.dia.fee+g.noite.fee||1;
  const pctD=g.dia.fee/tot*100, pctN=g.noite.fee/tot*100;
  const melhorTurno=g.noite.fee/((g.noite.tables)||1) > g.dia.fee/((g.dia.tables)||1) ? 'Noite' : 'Dia';
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('rsDate',KPI_DEMO.date);
  set('rsBaseDay',f(KPI_DEMO.feeGross,0));
  set('rsSub',`${f(KPI_DEMO.sessions)} sessões · R$ ${f(KPI_DEMO.feeGross,0)} bruto · take rate ${f(KPI_DEMO.takeRate,2)}% · Turno ${melhorTurno} lidera em fee/mesa · ${f(KPI_DEMO.deadPct,1)}% de mesas mortas é o maior vazamento.`);

  // ── KPIs essenciais (reaproveita os cards .kpi)
  const topRoom=[...D.rooms].sort((a,b)=>b.fee-a.fee)[0]||{name:'—',fee:0,tables:0,rake_rate:0};
  const topTier=[...D.tiers].sort((a,b)=>b.fee-a.fee)[0]||{tier:'—',fee:0,tables:0,avg_fph:0};
  const kpis=[
    {cls:'hero',l:'Fee bruto do dia',v:'R$ '+f(KPI_DEMO.feeGross,0),s:'líquido R$ '+f(KPI_DEMO.feeNet,0)+' após JP'},
    {cls:'c-dia',l:'Turno Dia (07–19h)',v:'R$ '+f(g.dia.fee,0),s:f(pctD,1)+'% do rake · '+f(g.dia.tables)+' mesas'},
    {cls:'c-noite',l:'Turno Noite (19–07h)',v:'R$ '+f(g.noite.fee,0),s:f(pctN,1)+'% do rake · '+f(g.noite.tables)+' mesas'},
    {cls:'c-gold',l:'Concentração top 1%',v:f(KPI_DEMO.conc1pct,1)+'%',s:KPI_DEMO.conc1Tables+' mesas = R$ '+f(KPI_DEMO.conc1Fee,0)},
    {cls:'c-amber',l:'Mesas mortas',v:f(KPI_DEMO.deadTables),s:f(KPI_DEMO.deadPct,1)+'% do total · receita parada'},
    {cls:'c-green',l:'Take rate médio',v:f(KPI_DEMO.takeRate,2)+'%',s:'fee ÷ R$ '+fK(KPI_DEMO.buyinTotal)+' em buyins'},
  ];
  const kel=document.getElementById('rsKpis');
  if(kel)kel.innerHTML=kpis.map(k=>`<div class="kpi ${k.cls}"><div class="kl">${k.l}</div><div class="kv">${k.v}</div><div class="ks">${k.s}</div></div>`).join('');
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
  const highlights=[
    {ic:'crown',tt:`${topTier.tier} é o motor do rake`,sb:`R$ ${f(topTier.fee,0)} com ${f(topTier.tables)} mesas · fee/mão R$ ${f(topTier.avg_fph,3)}`,vl:(topTier.fee/tot*100).toFixed(0)+'%'},
    {ic:'buildings',tt:`Sala campeã: ${topRoom.name}`,sb:`R$ ${f(topRoom.fee,0)} de fee · take rate ${f(topRoom.rake_rate,2)}%`,vl:'R$ '+fK(topRoom.fee)},
    (function(){
      const fmD=g.dia.fee/(g.dia.tables||1), fmN=g.noite.fee/(g.noite.tables||1);
      const lead=Math.max(fmD,fmN), other=Math.min(fmD,fmN)||1;
      return {ic:melhorTurno==='Dia'?'sun':'moon-stars',tt:`Turno ${melhorTurno} rende mais por mesa`,
        sb:`fee/mesa R$ ${f(fmD,0)} no Dia vs R$ ${f(fmN,0)} no Noite`,vl:'+'+f(lead/other*100-100,0)+'%'};
    })(),
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
    {ic:'arrows-left-right',tt:`${f(KPI_DEMO.crossShift)} sessões cruzam a virada de turno`,sb:'sem SLA de handoff às 07h/19h, jogadores dessas mesas ficam sem suporte',vl:f(KPI_DEMO.crossShiftPct,1)+'%'},
    {ic:'warning',tt:'Receita dependente de poucos',sb:`só ${KPI_DEMO.conc1Tables} mesas seguram ${f(KPI_DEMO.conc1pct,1)}% do rake — perda de 1 VIP é sensível`,vl:'risco'},
  ];
  const rrel=document.getElementById('rsRisks');
  if(rrel)rrel.innerHTML=risks.map(r=>`<div class="rs-line"><div class="rs-ic dn">${ic(r.ic,1)}</div><div class="rs-tx"><div class="rs-tt">${r.tt}</div><div class="rs-sb">${r.sb}</div></div><div class="rs-vl dn">${r.vl}</div></div>`).join('');

  // ── Análise inteligente priorizada (cards) — a ação do dia
  // Busca por NOME do tier (dia pequeno pode não ter todos os 5 buckets)
  const tierBy=t=>D.tiers.find(x=>x.tier===t)||{tier:t,fee:0,avg_fph:0};
  const micro=tierBy('Micro'), high=tierBy('High'), vhigh=tierBy('VHigh');
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
  renderShiftStats();
  buildCashRings();
  buildTimeline();buildHrChart();buildLifecycle();buildModal();buildOpDiv();buildTop10();buildRecs();
  buildBestSlots();buildShiftFee();buildForecast();buildConcurrent();buildOpShiftTable();buildShiftRecs();
  buildTierCharts();buildConc();buildHuMulti();buildJP();buildFPP();
  buildRooms();buildRR();buildBlindBars();buildBubble();
  buildRet();buildDurFee();buildHM();buildHist();
  buildResumo();buildEventos();
  initDayView(); // se há dias importados, troca a demo pelo dia mais recente
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
/* matiz por cena, na ordem de tvSceneList(): Resumo, Turnos, Ritmo, Stakes,
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
  if(K.tablesDia>0||K.tablesNoite>0){
    const fpmD=K.tablesDia?K.feeDia/K.tablesDia:0, fpmN=K.tablesNoite?K.feeNoite/K.tablesNoite:0;
    list.push({name:'Turnos',html(){return`
      <div class="tv-kicker">Divisão de turnos · 07h—19h—07h</div>
      <div class="tv-h">${fpmN>=fpmD?'Noite':'Dia'} lidera em eficiência por mesa</div>
      <div class="tv-duel">
        <div>
          ${tvStat('☀ Turno Dia','0',f(K.tablesDia)+' mesas · '+f(K.feeDiaPct,1)+'% do rake','dia','tvcFeeD')}
          <div class="tv-hero-sub" style="margin-top:14px">R$ <b>${f(fpmD,1)}</b> por mesa · ${f(K.deadDia)} mortas</div>
        </div>
        <div>
          ${tvStat('☾ Turno Noite','0',f(K.tablesNoite)+' mesas · '+f(K.feeNoitePct,1)+'% do rake','noite','tvcFeeN')}
          <div class="tv-hero-sub" style="margin-top:14px">R$ <b>${f(fpmN,1)}</b> por mesa · ${f(K.deadNoite)} mortas</div>
        </div>
      </div>
      <div class="tv-share"><div style="width:${f(K.feeDiaPct,1)}%;background:linear-gradient(90deg,#4f8ef7,#6ba3f8)"></div></div>
      <div class="tv-hero-sub" style="margin-top:10px">${f(K.crossShift)} sessões cruzam a virada de turno (${f(K.crossShiftPct,1)}%)</div>`;},run(){
      tvCount(document.getElementById('tvcFeeD'),K.feeDia,0,'R$ ');
      tvCount(document.getElementById('tvcFeeN'),K.feeNoite,0,'R$ ');
    }});
  }
  if(D.slots30&&D.slots30.some(s=>s.fee>0)){
    list.push({name:'Ritmo',html(){return`
      <div class="tv-kicker">Ritmo do dia · fee por janela de 30 minutos</div>
      <div class="tv-h">Pico às <span style="color:var(--tv-gold)">${K.bestSlot||'—'}</span> · ${K.peakConcurrent} mesas simultâneas no auge (${K.peakHour})</div>
      <div class="tv-chartwrap"><canvas id="tvChart"></canvas></div>`;},run(){
      const ctx=document.getElementById('tvChart');if(!ctx)return;
      if(TV.chart){try{TV.chart.destroy()}catch(_){}TV.chart=null;}
      TV.chart=new Chart(ctx,{type:'bar',
        data:{labels:D.slots30.map(s=>s.slot),datasets:[{data:D.slots30.map(s=>s.fee),
          backgroundColor:D.slots30.map(s=>s.turno==='dia'?'rgba(79,142,247,.85)':'rgba(167,139,250,.85)'),borderRadius:5,borderSkipped:false}]},
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
      const sel=document.getElementById('daySel');
      if(sel&&sel.value!=='__demo__'){await onDaySel(sel.value);}
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

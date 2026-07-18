/* =========================================================================
   CRIAÇÃO NOTURNA — GU
   Página exclusiva do turno da noite (19→07): recebe a Global MTT, extrai a
   "receita" dos torneios do PRÓXIMO dia da grade (janela 06:10→05:30) e
   divide a criação de Main/Side/Satélite igualmente entre os operadores.
   Parsing idêntico ao da Conferência de amanhã do painel (index.html) —
   se mudar lá, espelhar aqui.
========================================================================= */

/* ── PORTÃO DE ACESSO: o login do Suprema OS mora no hub (hub.html) — só entra
   quem está logado lá (mesma sessão 'suprema_session_v1'). Sem sessão válida,
   redireciona pro hub ANTES de qualquer coisa renderizar. ── */
(function(){
  try{
    const s = JSON.parse(localStorage.getItem('suprema_session_v1') || 'null');
    if (!s || !s.email || !s.expiresAt || Date.now() > s.expiresAt){
      location.replace('hub.html');
      throw new Error('sem sessão'); // interrompe o resto do script inline até o redirect
    }
  }catch(e){
    if (e.message !== 'sem sessão') location.replace('hub.html');
    throw e;
  }
})();

/* ── GUARDA: esta página depende de gu-parser.js (parser da G MTTS compartilhado).
   Se ele não carregou (não foi publicado junto no deploy, 404, cache velho),
   avisa NA TELA em vez de morrer em silêncio com tudo em "—". ── */
if (typeof buildSections === 'undefined' || typeof CONF_WINDOW_END_MIN === 'undefined'){
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="background:#c0392b;color:#fff;padding:14px 20px;font:600 13.5px/1.6 -apple-system,sans-serif;text-align:center">
        ⚠ O arquivo <b>gu-parser.js</b> não foi carregado — a página não consegue ler a Global nem conectar.<br>
        Publique o <b>gu-parser.js</b> na MESMA pasta do criacao-noturna.html (ele faz parte do deploy) e recarregue.
      </div>`);
  });
  throw new Error('gu-parser.js ausente');
}

/* ── modo escuro: padrão DARK (página noturna), mas respeita a escolha salva do painel ── */
(function(){
  const saved = localStorage.getItem('suprema_dark_mode');
  const dark = saved === null ? true : saved === '1';
  if (dark) document.documentElement.classList.add('dark');
})();

const $ = id => document.getElementById(id);

/* escapa TAMBÉM a aspa simples: sem ela, o dia que alguém escrever
   title='${escHtml(x)}' vira XSS — e nome de torneio vem da planilha enviada.
   painel-scope.test.js falha se qualquer escHtml do repo deixar de cobrir os 5. */
function escHtml(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
/* normText, parser da G MTTS, janelas da grade e BRL_RATE vêm de gu-parser.js */
function showToast(msg, isErr){
  const t = $('toast');
  t.textContent = msg;
  t.className = isErr ? 'show err' : 'show';
  clearTimeout(t._h);
  t._h = setTimeout(() => t.className = '', 3200);
}

/* ── relógio de Brasília (mesma regra do painel: nunca confiar no fuso do dispositivo) ── */
function nowInSP(){
  const fmt = new Intl.DateTimeFormat('en-US', {timeZone:'America/Sao_Paulo', year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', second:'numeric', hour12:false});
  const parts = fmt.formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return { year:+get('year'), month:+get('month'), day:+get('day'), hour:parseInt(get('hour'),10)%24, minute:+get('minute'), second:+get('second') };
}
function tickClock(){
  const n = nowInSP();
  $('navTime').textContent = `${String(n.hour).padStart(2,'0')}:${String(n.minute).padStart(2,'0')} BRT`;
}
setInterval(tickClock, 15000); tickClock();

/* ── regra de turno: até 05:29 "amanhã" ainda é o dia civil de hoje (grade não virou).
   WEEKDAYS_PT/EN e a janela CONF_WINDOW_* vêm de gu-parser.js. ── */
function turnoAmanha(){
  const n = nowInSP();
  const isMadrugada = (n.hour*60 + n.minute) < CONF_WINDOW_END_MIN;
  const tomorrowOffset = isMadrugada ? 0 : 1;
  const refTomorrow = new Date(Date.UTC(n.year, n.month-1, n.day, 12, 0, 0));
  refTomorrow.setUTCDate(refTomorrow.getUTCDate() + tomorrowOffset);
  const refDayAfter = new Date(refTomorrow.getTime() + 86400000);
  return { n, refTomorrow, refDayAfter };
}
function refToISO(ref){ return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth()+1).padStart(2,'0')}-${String(ref.getUTCDate()).padStart(2,'0')}`; }
function refToLabel(ref){ return `${String(ref.getUTCDate()).padStart(2,'0')}/${String(ref.getUTCMonth()+1).padStart(2,'0')}`; }

const TURNO = turnoAmanha();
const TOMORROW_ISO = refToISO(TURNO.refTomorrow);
const WEEKDAY_TOMORROW = WEEKDAYS_PT[TURNO.refTomorrow.getUTCDay()];      // exibição
const WEEKDAY_DAYAFTER = WEEKDAYS_PT[TURNO.refDayAfter.getUTCDay()];
const WEEKDAY_TOMORROW_EN = WEEKDAYS_EN[TURNO.refTomorrow.getUTCDay()];   // a G MTTS usa dias em inglês
const WEEKDAY_DAYAFTER_EN = WEEKDAYS_EN[TURNO.refDayAfter.getUTCDay()];
const DAY_LABEL = `${WEEKDAY_TOMORROW.split('-')[0].toLowerCase()} · ${refToLabel(TURNO.refTomorrow)}`;

$('heroDay').textContent = `de ${WEEKDAY_TOMORROW.toLowerCase()} · ${refToLabel(TURNO.refTomorrow)}`;
$('uploadDayLabel').textContent = `${WEEKDAY_TOMORROW.toLowerCase()} (${refToLabel(TURNO.refTomorrow)})`;

/* =========================================================================
   PARSER DA GU — aba "G MTTS" da Global: é a planilha que a GU usa pra criar
   os eventos, com a receita completa (~33 colunas) e valores JÁ EM DÓLAR.
   Nada de índice fixo de coluna: tudo é mapeado pela linha de cabeçalho
   (MTT MARKETING, TYPE, PRIZE POOL USD, BUY-IN, FEE, STRUCTURE, CHIPS...),
   então a página sobrevive se a GU adicionar ou mover colunas.
   Real = dólar × 5 (multiplicador Brazil da operação).
========================================================================= */
/* BRL_RATE, cellToHHMM, timeToMinutes, readSheetMatrix, findWeekdaySectionRange,
   findHeaderCols, isCoreLabel, guIdx e fmtExtraVal vivem em gu-parser.js. */

/* =========================================================================
   DETECÇÃO DE CAMPOS-CHAVE — a divisão do turno e os destaques dependem de
   ler, pela receita, colunas que a Global pode nomear de formas diferentes:
   FEE/RAKE, ADMIN FEE, EARLY BIRD e CAMPANHA. Nada de índice fixo — casamos
   pelo nome (normalizado) da coluna, com exclusões pra não confundir
   "ADMIN FEE" com "FEE". Se a GU renomear, é só ajustar os padrões aqui.
========================================================================= */
function detectField(it, patterns, exclude){
  if (!it || !it.extra) return null;
  for (const label of Object.keys(it.extra)){
    const n = normText(label);
    if (exclude && exclude.test(n)) continue;
    if (patterns.some(re => re.test(n))){
      const v = it.extra[label];
      if (v !== undefined && v !== null && v !== '')
        return {label, raw: v, disp: fmtExtraVal(label, v)};
    }
  }
  return null;
}
/* registro dos campos-chave: padrões de auto-detecção + rótulo amigável. Um
   mapeamento manual (MAP[fk] = coluna) sempre vence a auto-detecção. */
const FIELD_DEFS = {
  fee:       {label:'Rake / Fee',    res:[/\brake\b/, /^fee$/, /(^|[^a-z])fee([^a-z]|$)/, /taxa\s*do\s*torneio/], excl:/admin|early|adm\.?\s*fee/},
  admin:     {label:'Admin Fee',     res:[/admin\s*fee/, /taxa\s*administ/, /adm\.?\s*fee/], excl:/early/},
  early:     {label:'Early Bird',    res:[/early\s*bird/], excl:/early\s*game/}, // SÓ a coluna EARLY BIRD — "Early game" é blinds, não é isso
  camp:      {label:'Campanha',      res:[/campanh/, /campaign/, /\bpromo/, /\bcampanha/]},
  mtt:       {label:'MTT',           res:[/^mtt$/, /^mtt\s*id/, /nome\s*interno/], excl:/marketing/},
  gametype:  {label:'Game Type',     res:[/game\s*type/, /variante/, /modalidade/, /^game$/], excl:/early\s*game/},
  ko:        {label:'K.O',           res:[/^k\.?\s*o\b/, /\bk\.?o\b/, /knock\s*-?\s*out/]},
  ticket:    {label:'Ticket Award',  res:[/ticket/, /award/]},
  payout:    {label:'Payout',        res:[/payout/, /pagamento/, /premiac/], excl:/calculated|calculado/},
  calcpayout:{label:'Calculated Payout', res:[/calculated\s*payout/, /payout\s*calculado/, /calc.*payout/]},
  rebuy:     {label:'Rebuy',         res:[/re-?buy/, /reentry/, /re-?entry/]},
  addon:     {label:'Add-on',        res:[/add-?on/]},
  chips:     {label:'Chips',         res:[/^chips$/, /chip\s*stack/, /starting\s*stack/, /stack\s*inicial/, /fichas/, /\bstack\b/], excl:/add-?on|rebuy|reentry/},
  timebank:  {label:'Time Bank',     res:[/time\s*bank/, /banco\s*de\s*tempo/, /^tb$/]},
  structure: {label:'Structure',     res:[/structure/, /estrutura/]}
};
/* resolve o campo por MAP (manual) ou auto-detecção */
function fieldInfo(fk, it){
  const col = MAP[fk];
  if (col){
    if (!it || !it.extra) return null;
    const v = it.extra[col];
    return (v !== undefined && v !== null && v !== '') ? {label: col, raw: v, disp: fmtExtraVal(col, v)} : null;
  }
  const d = FIELD_DEFS[fk];
  return d ? detectField(it, d.res, d.excl) : null;
}
/* qual coluna cada campo está usando (pro diagnóstico/mapeador) — via probe */
function fieldColumn(fk){
  if (MAP[fk]) return {col: MAP[fk], manual: true};
  const labels = recipeFields();
  const probe = {extra: Object.fromEntries(labels.map(l => [l, 1]))};
  const d = FIELD_DEFS[fk];
  const i = d ? detectField(probe, d.res, d.excl) : null;
  return {col: i ? i.label : null, manual: false};
}
function feeInfo(it){   return fieldInfo('fee', it); }
function adminInfo(it){ return fieldInfo('admin', it); }
function earlyInfo(it){ return fieldInfo('early', it); }
function campInfo(it){  return fieldInfo('camp', it); }

/* "tem valor de fato" — número > 0, ou texto que não seja um "vazio disfarçado" */
function fieldActive(info){
  if (!info) return false;
  if (typeof info.raw === 'number') return info.raw > 0;
  const s = normText(info.raw);
  return !['','0','0%','-','—','nao','no','sem','n/a','na','false','none','nenhum'].includes(s);
}
function hasAdminFee(it){ return fieldActive(adminInfo(it)); }
function hasCampaign(it){ return fieldActive(campInfo(it)); }
/* versões que só retornam o campo quando ele tem valor de fato (ignora 0/vazio) */
function feeActive(it){   const i = feeInfo(it);   return fieldActive(i) ? i : null; }
function adminActive(it){ const i = adminInfo(it); return fieldActive(i) ? i : null; }
function earlyActive(it){ const i = earlyInfo(it); return fieldActive(i) ? i : null; }

/* ── campos-chave da FICHA do torneio (via registro, com mapeamento manual) ── */
function mttInfo(it){       return fieldInfo('mtt', it); }
function gameTypeInfo(it){  return fieldInfo('gametype', it); }
function koInfo(it){        return fieldInfo('ko', it); }
function ticketInfo(it){    return fieldInfo('ticket', it); }
function payoutInfo(it){    return fieldInfo('payout', it); }
function calcPayoutInfo(it){return fieldInfo('calcpayout', it); }
function rebuyInfo(it){     return fieldInfo('rebuy', it); }
function addonInfo(it){     return fieldInfo('addon', it); }
function chipsInfo(it){     return fieldInfo('chips', it); }
function timeBankInfo(it){  return fieldInfo('timebank', it); }
function structureInfo(it){ return fieldInfo('structure', it); }

/* #valores: quanto um fee/percentual REPRESENTA em dinheiro (buy-in em dólar).
   - fração (0<v<1)  → é percentual: valor = buy-in × v
   - v ≥ 1           → já é valor absoluto: mostra e calcula o % sobre o buy-in
   pctOnly = true  → não converte absolutos em dinheiro (ex.: chips do early bird) */
function calcValueParts(it, info, pctOnly){
  if (!info) return null;
  const raw = CriacaoCalc.parseRaw(info.raw);
  if (raw === null) return {main: info.disp, sub: '', money: null};
  if (raw > 0 && raw < 1){
    const money = (it.buyin != null) ? CriacaoCalc.moneyOf(it.buyin, raw) : null;
    return {main: CriacaoCalc.pctText(raw), sub: money != null ? fmtMoneyPlain(money) : '', money};
  }
  if (pctOnly) return {main: info.disp, sub: '', money: null};
  const pct = (it.buyin && it.buyin > 0) ? CriacaoCalc.pctText(raw / it.buyin) : '';
  return {main: fmtMoneyPlain(raw), sub: pct, money: raw, isMoney: true};
}

/* converte o valor cru de um campo pra fração percentual (0–1).
   número ≥ 1 em campo de fee = valor absoluto → vira % do buy-in */
function rawToPct(it, info){
  if (!info) return 0;
  return CriacaoCalc.rawToPctFee(it.buyin, info.raw);
}
/* ADMIN FEE — Rake/Fee e Admin Fee SEPARADOS na mesma linha (regra da casa:
   10% do buy-in / +2% do buy-in quando tem admin fee de campanha).
   Cada parcela mostra o % e o decimal do buy-in (sem $). */
function adminFeeParts(it){
  const pctTx = p => (Math.round(p * 10000) / 100).toLocaleString('pt-BR') + '%';
  const decTx = p => it.buyin != null
    ? ' = ' + ((CURRENCY === 'usd' ? it.buyin : it.buyin * BRL_RATE) * p).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
    : '';
  const f = rawToPct(it, feeActive(it)), a = rawToPct(it, adminActive(it));
  if (!f && !a) return null;
  const seg = p => pctTx(p) + decTx(p);
  return {main: [f ? seg(f) : null, a ? seg(a) : null].filter(Boolean).join(' / '), sub: ''};
}
/* EARLY BIRD — o percentual (0–20%) representa % das FICHAS (chips) do stack
   inicial: mostra o % e quantas fichas extras ele significa. */
function earlyParts(it){
  const e = earlyActive(it);
  if (!e) return null;
  const pct = CriacaoCalc.earlyPct(e.raw);
  if (!pct) return null;
  const ch = chipsInfo(it);
  const fichas = ch ? CriacaoCalc.earlyChips(e.raw, ch.raw) : null;
  const sub = fichas ? '= ' + fichas.toLocaleString('pt-BR') + ' fichas' : '% das fichas';
  return {main: CriacaoCalc.pctText(pct), sub};
}

/* ícones da ficha (traço, no mesmo estilo do resto) */
const SPEC_ICONS = {
  buyin:'<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  rake:'<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  admin:'<path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1z"/><path d="M9 8h6M9 12h5"/>',
  early:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  prize:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>',
  payout:'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  game:'<path d="M12 3C9 7 5 8 5 12a3 3 0 0 0 5 2c-.3 2-1 3-2 4h8c-1-1-1.7-2-2-4a3 3 0 0 0 5-2c0-4-4-5-7-9z"/>',
  chips:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  structure:'<path d="M3 20h4v-6H3zM10 20h4V8h-4zM17 20h4V4h-4z"/>',
  timebank:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ticket:'<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"/><path d="M15 6v12"/>',
  rebuy:'<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/>',
  addon:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  calcpayout:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>'
};
function specTile(icon, accent, label, mainHtml, sub, hot){
  if (mainHtml === '' || mainHtml === null || mainHtml === undefined || mainHtml === '—') return '';
  return `<div class="spec ${accent} ${hot ? 'hot' : ''}">
    <span class="spec-ic"><svg viewBox="0 0 24 24">${SPEC_ICONS[icon] || ''}</svg></span>
    <div class="spec-tx"><div class="spec-k">${escHtml(label)}</div><div class="spec-v">${mainHtml}</div>${sub ? `<div class="spec-sub">${escHtml(sub)}</div>` : ''}</div>
  </div>`;
}
/* a FICHA: valores (com quanto o fee representa) + especificações destacadas */
function specSheetHtml(it){
  const money = info => { // valor de célula → $ formatado (Add-on e afins)
    if (typeof info.raw === 'number') return fmtMoney(info.raw);
    const n = parseFloat(String(info.raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return isFinite(n) ? fmtMoney(n) : escHtml(info.disp);
  };
  const tiles = [];
  tiles.push(specTile('buyin','c-felt','Buy-in', fmtMoney(it.buyin), '', true));
  tiles.push(specTile('prize','c-felt','Prize Pool', fmtMoney(it.garantido), '', true));
  const af = adminFeeParts(it); if (af) tiles.push(specTile('admin','c-side','Admin Fee', escHtml(af.main), '10% do buy-in / +2% se tiver admin fee', true));
  const e = earlyParts(it);     if (e)  tiles.push(specTile('early','c-sat','Early Bird', escHtml(e.main), e.sub + ' (% das fichas)', true));
  const tk = ticketInfo(it);   if (tk) tiles.push(specTile('ticket','c-gold','Ticket Award', escHtml(tk.disp), '', true));
  const pay = payoutInfo(it);  if (pay) tiles.push(specTile('payout','c-sat','Payout', escHtml(pay.disp), '', true));
  const cp = calcPayoutInfo(it);if (cp) tiles.push(specTile('calcpayout','c-sat','Calculated Payout', escHtml(cp.disp), '', true));
  const rb = rebuyInfo(it);    if (rb) tiles.push(specTile('rebuy','c-side','Rebuy', escHtml(rb.disp), '', true));
  const ao = addonInfo(it);    if (ao && fieldActive(ao)) tiles.push(specTile('addon','c-gold','Add-on', money(ao), '', true));
  const ch = chipsInfo(it);    if (ch) tiles.push(specTile('chips','c-felt','Chips', escHtml(ch.disp), '', true));
  const st = structureInfo(it);if (st) tiles.push(specTile('structure','c-gold','Structure', escHtml(st.disp), '', true));
  const gt = gameTypeInfo(it); if (gt) tiles.push(specTile('game','c-side','Game Type', escHtml(gt.disp), '', false));
  const tb = timeBankInfo(it); if (tb) tiles.push(specTile('timebank','c-sidefree','Time Bank', escHtml(tb.disp), '', false));
  const filled = tiles.filter(Boolean);
  return filled.length ? `<div class="spec-sheet">${filled.join('')}</div>` : '';
}
/* nome interno curto (coluna MTT) quando difere do nome exibido */
function mttKicker(it){
  const m = mttInfo(it);
  if (!m || !fieldActive(m)) return null;
  if (normText(m.disp) === normText(it.nome)) return null;
  return m.disp;
}

/* separa os Side Events em dois blocos: com e sem Admin Fee */
function sideSplit(){
  const admin = [], noadmin = [];
  ((DATA && DATA.side) || []).forEach(it => (hasAdminFee(it) ? admin : noadmin).push(it));
  return {admin, noadmin};
}

/* =========================================================================
   FUNÇÕES DO TURNO — quatro blocos de trabalho. A cor de cada um casa com os
   tokens (--main / --sat / --side / --sidefree). O 'role' liga o bloco ao
   operador: quem faz Main faz Satélite (mesmo role 'mainSat').
========================================================================= */
const CAT_MAIN   = {key:'main',        cls:'main',     suit:'♠', label:'Main Events',              role:'mainSat'};
const CAT_SAT    = {key:'sat',         cls:'sat',      suit:'♣', label:'Satélites',                role:'mainSat'};
const CAT_SIDE_A = {key:'sideAdmin',   cls:'side',     suit:'♥', label:'Side Events · com Admin Fee', role:'sideAdmin'};
const CAT_SIDE_B = {key:'sideNoAdmin', cls:'sidefree', suit:'♦', label:'Side Events · sem Admin Fee', role:'sideNoAdmin'};
const SECTIONS = [CAT_MAIN, CAT_SAT, CAT_SIDE_A, CAT_SIDE_B];
function catItems(cat){
  if (!DATA) return [];
  if (cat.key === 'main') return DATA.main;
  if (cat.key === 'sat')  return DATA.sat;
  const s = sideSplit();
  return cat.key === 'sideAdmin' ? s.admin : s.noadmin;
}
function allWithCat(){
  const s = sideSplit();
  return [
    ...DATA.main.map(it => ({it, cat: CAT_MAIN})),
    ...s.admin.map(it => ({it, cat: CAT_SIDE_A})),
    ...s.noadmin.map(it => ({it, cat: CAT_SIDE_B})),
    ...DATA.sat.map(it => ({it, cat: CAT_SAT}))
  ];
}

/* papéis (função) por operador — chave saneada pro Firebase */
const ROLE_OPTS = [
  {key:'mainSat',     label:'Main + Satélites'},
  {key:'sideAdmin',   label:'Side c/ Admin Fee'},
  {key:'sideNoAdmin', label:'Side s/ Admin Fee'}
];
function roleKey(op){ return normText(op).replace(/[.#$\[\]\/]/g,'_'); }
function roleOf(op){ return ROLES[roleKey(op)] || ''; }
function setRole(op, role){
  const k = roleKey(op);
  if (role) ROLES[k] = role; else delete ROLES[k];
  if (fbDb) fbDb.ref(`${FB_PATH}/roles`).set(ROLES);
  else renderAll();
}
/* operadores de um bloco: os marcados com aquela função; se ninguém marcou,
   todos dividem (fallback pra funcionar antes de atribuírem as funções) */
function opsForRole(role){
  const assigned = OPS.filter(o => roleOf(o) === role);
  return assigned.length ? assigned : OPS;
}

/* extractGuDaySection e buildSections vivem em gu-parser.js */

/* =========================================================================
   ESTADO + FIREBASE — tudo do dia vive em /painel/{amanhã}/criacaoNoturna:
   sheet (dados extraídos, JSON), ops (equipe), done/{key} (progresso).
========================================================================= */
// config do Firebase: fonte ÚNICA no suprema-db.js (SupremaDB.CONFIG)
const FB_PATH = `painel/${TOMORROW_ISO}/criacaoNoturna`;

let fbDb = null;
let DATA = null;          // {main, side, sat[], unknown, warnings, by, at}
let OPS = [];             // nomes da equipe
let DONE = {};            // key -> {by, at}
let IDS = {};             // key -> {val, by, at} — ID do evento no Pokerbyte
let ROLES = {};           // roleKey(op) -> 'mainSat' | 'sideAdmin' | 'sideNoAdmin'
let OVERRIDES = {};       // itemKey -> opName — reatribuições manuais (handoff) vencem a divisão
let MAP = {};             // fieldKey -> rótulo da coluna (mapeamento manual vence a auto-detecção)
let AUDIT = {};           // itemKey -> {status:'erro', motivo, by, at} — marcado pelo Admin
let SEARCH = '';
let CURRENCY = localStorage.getItem('cn_currency') || 'usd';
let FILTER = 'all';

function setSync(state, label){
  const el = $('syncStatus');
  el.className = 'sync-status ' + state;
  el.querySelector('.sync-label').textContent = label;
}
try{
  firebase.initializeApp(SupremaDB.CONFIG);
  // Cutover email/senha (Fase 4): sem login anônimo. O token de acesso vem da
  // sessão real do Firebase Auth (email/senha) que o hub deixa persistida por
  // origem — quem logou no hub já chega autenticado aqui.
  // progressão do Suprema OS: abrir a Criação Noturna conta XP na jornada do operador
  firebase.auth().onAuthStateChanged(u => {
    if(u && !window.__spTracked){ window.__spTracked = true; try{ SupremaAuth.trackUse('gu'); }catch(e){} }
  });
  fbDb = firebase.database();
  fbDb.ref('.info/connected').on('value', s => {
    if (s.val() === true) setSync('on','Sincronizado');
    else setSync('','Conectando…');
  });
  /* ── LISTENERS SÓ COM AUTH VIVA ──
     Mesma corrida já corrigida no Painel do Dia (whenAuthed): a restauração da
     sessão do Firebase Auth é ASSÍNCRONA — anexar antes dela terminar faz o
     RTDB negar a leitura (as regras exigem auth) e CANCELAR o listener. Sintoma:
     grade vazia/da memória até um F5 com sorte. O .info/connected (acima) não
     precisa de auth e fica de fora. */
  const attachCN = () => {
  // ECONOMIA DE BANDA: observa só o timestamp; baixa a grade (json pesado) com
  // .once() SÓ quando muda — antes o .on('value') rebaixava a grade a cada reconexão.
  fbDb.ref(`${FB_PATH}/sheet/at`).on('value', tsSnap => {
    const at = tsSnap.val();
    if (!at || `${at}` === `${window._cnSheetLastTs}`) return;
    window._cnSheetLastTs = `${at}`;
    fbDb.ref(`${FB_PATH}/sheet`).once('value').then(s => {
      const v = s.val();
      if (v && v.json){
        try{
          DATA = JSON.parse(v.json);
          DATA.by = v.by; DATA.at = v.at;
          onDataReady(true);
        }catch(e){ console.error('sheet corrompida no Firebase', e); }
      }
    }).catch(()=>{ window._cnSheetLastTs = null; });
  });
  fbDb.ref(`${FB_PATH}/ops`).on('value', s => {
    const v = s.val();
    OPS = Array.isArray(v) ? v.filter(Boolean) : (v ? Object.values(v).filter(Boolean) : []);
    renderAll();
  });
  fbDb.ref(`${FB_PATH}/done`).on('value', s => {
    DONE = s.val() || {};
    renderAll();
    renderFocus(); // se o modo foco estiver aberto, o parceiro marcando também avança a fila
  });
  fbDb.ref(`${FB_PATH}/ids`).on('value', s => {
    IDS = s.val() || {};
    // não re-renderizar a lista enquanto alguém digita um ID — só atualiza os inputs parados
    if (document.activeElement && document.activeElement.classList.contains('id-inp')){
      document.querySelectorAll('.id-inp').forEach(inp => {
        if (inp === document.activeElement) return;
        const v = IDS[inp.dataset.idkey] ? IDS[inp.dataset.idkey].val : '';
        inp.value = v; inp.classList.toggle('has-id', !!v);
      });
    } else renderAll();
  });
  fbDb.ref(`${FB_PATH}/roles`).on('value', s => {
    ROLES = s.val() || {};
    renderAll();
  });
  fbDb.ref(`${FB_PATH}/overrides`).on('value', s => {
    OVERRIDES = s.val() || {};
    renderAll();
    renderFocus();
  });
  fbDb.ref(`${FB_PATH}/fieldMap`).on('value', s => {
    MAP = s.val() || {};
    renderAll();
    renderFocus();
  });
  // presença ao vivo agora é global e compartilhada (suprema-presence.js) — ver rodapé
  // erros de criação marcados pela auditoria (admin.html → Criação GU)
  fbDb.ref(`${FB_PATH}/audit`).on('value', s => {
    const before = Object.keys(AUDIT).filter(k => AUDIT[k] && AUDIT[k].status === 'erro').length;
    AUDIT = s.val() || {};
    const now = Object.keys(AUDIT).filter(k => AUDIT[k] && AUDIT[k].status === 'erro').length;
    if (now > before) showToast(`⚠ A auditoria marcou ${now - before} erro(s) de criação — veja o alerta no topo.`, true);
    renderAll();
    renderFocus();
  });
  };  // fim do attachCN
  if (firebase.auth().currentUser) attachCN();
  else {
    let cnAttached = false;
    firebase.auth().onAuthStateChanged(u => { if (u && !cnAttached){ cnAttached = true; attachCN(); } });
  }
  // (a Conferência do dia mora no Painel — index.html — lendo este mesmo /sheet e /conf)
}catch(e){
  console.error('Firebase indisponível — modo local', e);
  setSync('off','Offline (só local)');
}

/* =========================================================================
   CONTA — a MESMA do Painel/Admin, e SÓ ela: não existe login próprio aqui.
   O portão no <script> inicial redireciona pro hub (hub.html) quem chega sem
   a sessão 'suprema_session_v1'; o login/cadastro acontecem exclusivamente lá.
========================================================================= */
const AUTH_STORE_KEY = 'suprema_session_v1';
function getSession(){
  try{
    const s = JSON.parse(localStorage.getItem(AUTH_STORE_KEY) || 'null');
    if(!s || !s.email || !s.expiresAt) return null;
    if(Date.now() > s.expiresAt){ localStorage.removeItem(AUTH_STORE_KEY); return null; }
    return s;
  }catch(e){ return null; }
}
/* delega pro SupremaAuth: a cópia local deixava o 'suprema_trusted_admin' pra
   trás e o logout de admin não deslogava de fato (ver painel.js). */
function clearSession(){
  try{
    if (window.SupremaAuth && SupremaAuth.clearSession){ SupremaAuth.clearSession(); return; }
  }catch(e){}
  try{ localStorage.removeItem(AUTH_STORE_KEY); }catch(e){}
}

/* o portão no topo da página já barrou quem não tem sessão — aqui ela sempre existe */
let SESSION = getSession();
let ME = SESSION ? (SESSION.apelido || SESSION.nome || SESSION.displayName || SESSION.email) : '';

/* se a sessão sumir no meio do turno (logout em outra aba, expiração), volta pro Painel */
function ensureSession(){
  if (!getSession()) location.replace('index.html');
}
window.addEventListener('focus', ensureSession);
setInterval(ensureSession, 5*60*1000);
function paintOperator(){
  $('opName').textContent = ME || 'Entrar';
  $('opAvatar').textContent = ME ? ME.trim()[0].toUpperCase() : '?';
  $('opBadge').title = SESSION ? `${SESSION.email} — clique para sair` : 'Entrar com a conta do Painel';
}
paintOperator();

/* ══ BLOQUEIO POR NOTIFICAÇÃO — a MESMA lógica do painel: notificação com
   blocked:true (erro apontado pelo admin ou suspensão) trava a página até o
   operador justificar. Grava nos mesmos nós (userNotifs + pendingNotif), então
   justificar aqui libera o painel também, e vice-versa. ══ */
const EMAIL_KEY = SESSION ? SESSION.email.toLowerCase().replace(/\./g,'_dot_').replace(/@/g,'_at_') : '';
function initNotifBlock(){
  if (!fbDb || !EMAIL_KEY) return;
  fbDb.ref(`userNotifs/${EMAIL_KEY}`).on('value', snap => {
    const notifs = snap.val();
    const existing = $('cnJustifModal');
    if (!notifs){ if (existing) existing.remove(); return; }
    const pending = Object.entries(notifs).filter(([id, n]) => n && !n.justified && !n.resolved && n.blocked);
    if (pending.length){ showBlockModal(pending); return; }
    if (existing) existing.remove();
    // não-bloqueantes: só avisa (o painel marca o "seen")
    Object.values(notifs).forEach(n => {
      if (n && !n.seen && !n.justified && !n.resolved && !n.blocked)
        showToast('⚠ Notificação do admin: ' + (n.typeLabel || 'verifique o painel.'), true);
    });
  });
}
function showBlockModal(pending){
  const [notifId, notif] = pending[0];
  const existing = $('cnJustifModal');
  if (existing){ if (existing.dataset.nid === notifId) return; existing.remove(); }
  const dateLabel = notif.date ? notif.date.split('-').reverse().join('/') : '';
  const el = document.createElement('div');
  el.id = 'cnJustifModal'; el.dataset.nid = notifId;
  el.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(8,10,9,.88);backdrop-filter:blur(14px);display:grid;place-items:center;padding:20px';
  el.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--hairline-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);width:min(520px,94vw);padding:28px">
      <div style="width:44px;height:44px;border-radius:12px;background:var(--red-soft);display:grid;place-items:center;font-size:20px;margin-bottom:14px">🚫</div>
      <div style="font-family:var(--display);font-size:19px;font-weight:800;letter-spacing:-.02em">Justificativa necessária</div>
      <p style="font-size:13px;color:var(--ink-soft);line-height:1.6;margin:6px 0 16px">O admin sinalizou uma pendência — a criação fica travada até você justificar (a mesma trava do painel).</p>
      <div style="background:var(--card-elevated);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:16px">
        <div style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--red)">${escHtml(notif.typeLabel || 'Erro operacional')}</div>
        <div style="font-weight:700;margin-top:5px">${escHtml(notif.torneio || '')}</div>
        ${notif.desc ? `<div style="font-size:12.5px;color:var(--ink-soft);line-height:1.55;margin-top:5px">${escHtml(notif.desc)}</div>` : ''}
        <div style="font-size:11px;color:var(--ink-soft);margin-top:8px;font-family:var(--mono)">${dateLabel ? dateLabel + ' · ' : ''}por ${escHtml(notif.sentBy || 'admin')}</div>
      </div>
      ${pending.length > 1 ? `<div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">⚠ Há mais ${pending.length - 1} notificação(ões) após esta.</div>` : ''}
      <textarea id="cnJustifText" rows="4" placeholder="Descreva o que ocorreu, a causa e como foi ou será corrigido… (mín. 10 caracteres)"
        style="width:100%;background:var(--card-elevated);border:1.5px solid var(--hairline-strong);border-radius:10px;padding:11px 13px;font-family:var(--text);font-size:13px;color:var(--ink);outline:none;resize:none"></textarea>
      <div id="cnJustifErr" style="display:none;color:var(--red);font-size:12px;margin-top:8px"></div>
      <button class="btn primary" id="cnJustifBtn" style="width:100%;justify-content:center;margin-top:14px">Enviar justificativa</button>
    </div>`;
  document.body.appendChild(el);
  $('cnJustifBtn').addEventListener('click', async () => {
    const text = $('cnJustifText').value.trim();
    const err = $('cnJustifErr');
    if (text.length < 10){ err.textContent = 'Justificativa muito curta — descreva o ocorrido.'; err.style.display = 'block'; return; }
    $('cnJustifBtn').disabled = true;
    try{
      await fbDb.ref(`userNotifs/${EMAIL_KEY}/${notifId}`).update({justified:true, justification:text, justifiedAt:Date.now(), justifiedBy:ME || SESSION.email});
      await fbDb.ref(`users/${EMAIL_KEY}/pendingNotif`).remove();
      el.remove();
      showToast('✓ Justificativa enviada — aguarde a aprovação do admin');
    }catch(e){ err.textContent = 'Erro ao enviar: ' + e.message; err.style.display = 'block'; $('cnJustifBtn').disabled = false; }
  });
  setTimeout(() => { const t = $('cnJustifText'); if (t) t.focus(); }, 250);
}
initNotifBlock();

/* ── nova versão publicada: banner de recarga (mesmo aviso do painel) —
   página fica aberta o turno todo, ninguém pode operar com código velho ── */
if ('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'sw-updated' && !$('swBar')){
      const bar = document.createElement('div');
      bar.id = 'swBar';
      bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:150;background:var(--ink);color:var(--bg);padding:10px 18px;border-radius:99px;font-size:13px;font-weight:600;box-shadow:var(--shadow-lg);cursor:pointer';
      bar.innerHTML = `Nova versão (v${escHtml(String(e.data.version))}) — <u>clique para atualizar</u>`;
      bar.addEventListener('click', () => location.reload());
      document.body.appendChild(bar);
    }
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ── presença ao vivo: agora vem do módulo compartilhado suprema-presence.js
   (node global presence/, com ícone + moldura + título — igual ao Painel do Dia).
   Incluído no rodapé da página; nada mais a fazer aqui. ── */

$('opBadge').addEventListener('click', () => {
  if (confirm(`Sair da conta ${SESSION.email}?\n(Também desloga do Painel e do Admin — é a mesma sessão.)`)){
    clearSession();
    location.replace('index.html'); // sem sessão não se fica aqui — volta pro Painel logar
  }
});

/* ── modo escuro ── */
function paintDarkBtn(){ $('darkToggle').textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙'; }
paintDarkBtn();
$('darkToggle').addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('suprema_dark_mode', isDark ? '1' : '0');
  paintDarkBtn();
});
// ecossistema: tema trocado em outro painel/aba reflete aqui na hora
window.addEventListener('storage', e => {
  if (e.key !== 'suprema_dark_mode' || e.newValue === null) return;
  document.documentElement.classList.toggle('dark', e.newValue === '1');
  paintDarkBtn();
});

/* =========================================================================
   UPLOAD
========================================================================= */
const dz = $('dropZone');
dz.addEventListener('click', () => $('fileInput').click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
$('fileInput').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

async function handleFile(file){
  // SheetJS sob demanda: baixa na 1ª importação. Se o arquivo cair, avisa em vez de morrer em silêncio.
  try{ await ensureXLSX(); }
  catch(_){
    showToast('A biblioteca de planilhas não carregou (sem internet?) — verifique a conexão e recarregue a página.', true);
    return;
  }
  $('dzTitle').textContent = 'Lendo planilha…';
  try{
    // a criação é baseada SÓ na aba da GU (G MTTS) — valores em dólar, receita completa
    const matrix = readSheetMatrix(await file.arrayBuffer(), 'G MTTS');
    const headerCols = findHeaderCols(matrix);
    if (!headerCols){
      showToast('Não encontrei o cabeçalho da aba G MTTS (MTT MARKETING / TYPE / BUY-IN…) — é a Global MTT certa?', true);
      $('dzTitle').textContent = 'Global MTT';
      return;
    }
    const secTom = extractGuDaySection(matrix, WEEKDAY_TOMORROW_EN, headerCols);
    const secAfter = extractGuDaySection(matrix, WEEKDAY_DAYAFTER_EN, headerCols);
    if (!secTom){
      showToast(`Não encontrei a seção "${WEEKDAY_TOMORROW_EN}" na aba G MTTS — é a Global MTT certa?`, true);
      $('dzTitle').textContent = 'Global MTT';
      return;
    }
    const sections = buildSections(secTom, secAfter);
    const warnings = [];
    if (!secAfter) warnings.push(`Seção "${WEEKDAY_DAYAFTER}" não encontrada — a madrugada de fechamento (até 05:30) pode estar faltando.`);
    if (secTom.duplicateSection || (secAfter && secAfter.duplicateSection)) warnings.push('Nome de dia duplicado na planilha — confira se as seções usadas são as certas.');
    const semHora = [...secTom.semHora, ...(secAfter ? secAfter.semHora : [])];
    if (semHora.length) warnings.push(`${semHora.length} torneio(s) sem horário reconhecível ficaram de fora: ${semHora.map(x=>x.nome).join(', ')}`);
    const aposGap = [...secTom.aposGap, ...(secAfter ? secAfter.aposGap : [])];
    if (aposGap.length) warnings.push(`${aposGap.length} linha(s) depois do vão de linhas vazias ficaram de fora: ${aposGap.map(x=>`${x.hora} ${x.nome}`).join(', ')}`);
    if (sections.unknown.length) warnings.push(`${sections.unknown.length} torneio(s) com tipo não reconhecido na coluna TYPE (listados em seção própria).`);

    const fields = headerCols.filter(c => !isCoreLabel(c.label)).map(c => c.label);
    // diff contra a versão que já estava carregada (a GU corrige a Global durante a noite):
    // o que mudou fica marcado — e o que JÁ FOI CRIADO com a receita antiga pede revisão
    const changes = computeChanges(DATA, sections);
    if (DATA && changes.length) showToast(`⚠ ${changes.length} alteração(ões) em relação à Global anterior — veja os avisos.`, true);
    DATA = {...sections, fields, warnings, changes, by: ME || 'Alguém', at: Date.now(), fileName: file.name};
    onDataReady(false);

    if (fbDb){
      fbDb.ref(`${FB_PATH}/sheet`).set({
        json: JSON.stringify({main:sections.main, side:sections.side, sat:sections.sat, unknown:sections.unknown, fields, warnings, changes, fileName:file.name}),
        // count pequeno pra o hub contar sem baixar a grade inteira (economia de banda)
        count: sections.main.length + sections.side.length + sections.sat.length,
        by: ME || 'Alguém', at: firebase.database.ServerValue.TIMESTAMP
      });
    }
    logEvent('subiu Global', `${file.name} — ${sections.main.length + sections.side.length + sections.sat.length} torneios${changes.length ? ` (${changes.length} alterações)` : ''}`);
    showToast(`Global carregada — ${sections.main.length + sections.side.length + sections.sat.length} torneios de ${WEEKDAY_TOMORROW.toLowerCase()}.`);
  }catch(e){
    console.error(e);
    showToast('Erro ao ler a planilha — confira se é a Global MTT (.xlsx).', true);
  }
  $('dzTitle').textContent = 'Global MTT';
  $('fileInput').value = '';
}

/* =========================================================================
   DIVISÃO IGUAL — determinística: mesma ordem de equipe + mesma planilha
   ⇒ mesma divisão em qualquer navegador (sem sorteio, sem gravação extra).
   Main e Side: round-robin cronológico. Satélite: grupos inteiros (a receita
   de um grupo é encadeada), sempre pro operador com menos satélites até ali.
========================================================================= */
function itemKey(it){
  return `${normText(it.nome)}|${it.hora}`.replace(/[.#$\[\]\/]/g,'_');
}
function computeAssignments(){
  const asg = {}; // key -> opName
  if (!DATA || !OPS.length) return asg;

  // round-robin simples de uma lista dentro de um pool de operadores
  const roundRobin = (list, pool) => {
    if (!pool.length) return;
    let cursor = 0;
    list.forEach(it => { asg[itemKey(it)] = pool[cursor++ % pool.length]; });
  };

  /* ── FUNÇÃO 1 · Main + Satélites — mesmo pool: quem cria o Main cria os
     Satélites. Os Main Events vão em round-robin cronológico; cada GRUPO de
     satélites (receita encadeada) vai inteiro pro operador do pool com menos
     carga até ali, equilibrando dentro da própria função. ── */
  const poolMS = opsForRole('mainSat');
  const loadMS = Object.fromEntries(poolMS.map(o => [o,0]));
  let msCursor = 0;
  DATA.main.forEach(it => {
    const op = poolMS[msCursor++ % poolMS.length];
    asg[itemKey(it)] = op; loadMS[op]++;
  });
  const order = [], groups = {};
  DATA.sat.forEach(it => {
    const k = it.groupHeader || it.nome;
    if (!groups[k]){ groups[k] = []; order.push(k); }
    groups[k].push(it);
  });
  order.forEach(k => {
    const op = poolMS.reduce((best,o) => loadMS[o] < loadMS[best] ? o : best, poolMS[0]);
    groups[k].forEach(it => asg[itemKey(it)] = op);
    loadMS[op] += groups[k].length;
  });

  /* ── FUNÇÕES 2 e 3 · Side com / sem Admin Fee — pools próprios, cada bloco
     dividido igualmente entre quem está naquela função. ── */
  const {admin, noadmin} = sideSplit();
  roundRobin(admin,   opsForRole('sideAdmin'));
  roundRobin(noadmin, opsForRole('sideNoAdmin'));

  /* reatribuições manuais (handoff de turno) vencem a divisão automática,
     desde que o destino ainda esteja na equipe */
  Object.keys(OVERRIDES).forEach(k => { if (OPS.includes(OVERRIDES[k])) asg[k] = OVERRIDES[k]; });
  return asg;
}

/* =========================================================================
   RENDER
========================================================================= */
const OP_COLORS = ['#22d47e','#5aa8ff','#b888f0','#f0a050','#f06050','#4dd0c4','#e8c860','#f078b8'];
function opColor(name){
  const i = OPS.indexOf(name);
  return OP_COLORS[(i >= 0 ? i : 0) % OP_COLORS.length];
}
function fmtMoney(vUsd){
  if (vUsd === null || vUsd === undefined) return '—';
  const v = CURRENCY === 'usd' ? vUsd : vUsd * BRL_RATE;
  const s = v.toLocaleString('pt-BR', {minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2});
  return `<span class="cur">${CURRENCY === 'usd' ? '$' : 'R$'}</span>${s}`;
}
function fmtMoneyPlain(vUsd){
  if (vUsd === null || vUsd === undefined) return '—';
  const v = CURRENCY === 'usd' ? vUsd : vUsd * BRL_RATE;
  return (CURRENCY === 'usd' ? '$ ' : 'R$ ') + v.toLocaleString('pt-BR', {minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2});
}

function onDataReady(fromRemote){
  $('controlsCard').hidden = false;
  $('actionsBar').hidden = false;
  const meta = $('uploadMeta');
  meta.hidden = false;
  const when = DATA.at ? new Date(DATA.at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'}) : '';
  meta.innerHTML = `
    <span class="pill ok">✓ ${escHtml(DATA.fileName || 'Global MTT')}</span>
    <span class="pill">por ${escHtml(DATA.by || '—')}${when ? ' às ' + when : ''}</span>
    <span class="pill gold">${WEEKDAY_TOMORROW.toLowerCase()} · janela 06:10 → 05:30</span>`;
  renderAll();
}

function renderAllNow(){
  renderOps();
  renderFilters();
  renderAlerts();
  renderStats();
  renderFieldDiag();
  renderList();
  renderTV();
}
/* PERF: os listeners do Firebase disparam em rajada (done + ids + roles no mesmo
   segundo) — agrupa tudo num render só, em vez de reconstruir a tabela 3–4x */
let _renderT = null;
function renderAll(){
  if (_renderT) return;
  _renderT = setTimeout(() => { _renderT = null; renderAllNow(); }, 80);
}

/* ── LOG DE AUDITORIA — trilha só-de-acréscimo da noite: quem marcou, desmarcou,
   trocou ID, passou torneio, subiu Global. Responde "quem mexeu nisso?" às 4h. ── */
function logEvent(action, detail){
  if (!fbDb) return;
  try{
    fbDb.ref(`${FB_PATH}/log`).push({
      by: ME || '—', at: firebase.database.ServerValue.TIMESTAMP,
      action, detail: String(detail || '').slice(0, 140)
    });
  }catch(e){}
}
$('logBtn').addEventListener('click', e => {
  const anchor = e.currentTarget;
  if (!fbDb){ showToast('Histórico precisa do Firebase (offline agora).', true); return; }
  fbDb.ref(`${FB_PATH}/log`).limitToLast(30).once('value').then(s => {
    const v = s.val() || {};
    const entries = Object.values(v).sort((a,b) => (b.at||0) - (a.at||0));
    if (!entries.length){ showToast('Nada registrado ainda nesta noite.'); return; }
    openPickMenu(anchor, 'Histórico da noite (últimos 30)', entries.map(en => {
      const t = en.at ? new Date(en.at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'}) : '—';
      return {label: `${t} · ${en.by}: ${en.action}${en.detail ? ' — ' + en.detail : ''}`,
              color: opColor(en.by), initial: (en.by || '?').trim()[0].toUpperCase(), onPick: () => {}};
    }));
  });
});

/* ── NOTIFICAÇÃO DE PRAZO — avisa mesmo com a aba em segundo plano quando um
   torneio entra em "late" (<3h) sem estar criado. Pede permissão no 1º clique. ── */
const NOTIFIED = new Set();
document.addEventListener('click', () => {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}, {once: true});
function checkDeadlineNotifs(){
  if (!('Notification' in window) || Notification.permission !== 'granted' || !DATA) return;
  const late = [...DATA.main, ...DATA.side, ...DATA.sat]
    .filter(it => !DONE[itemKey(it)] && !NOTIFIED.has(itemKey(it)) && urgency(it) === 'late')
    .slice(0, 3); // no máx. 3 por checagem pra não virar spam
  late.forEach(it => {
    NOTIFIED.add(itemKey(it));
    try{ new Notification(`⏰ ${it.nome}`, {body: `Começa ${urgLabel(it)} (${it.hora}) e ainda não foi criado.`, tag: itemKey(it)}); }catch(e){}
  });
}

/* ── MODO TV — visão de parede, só leitura: progresso, ritmo por operador e
   próximos prazos. Atualiza sozinho junto com o sync. ── */
let TV_OPEN = false;
function renderTV(){
  if (!TV_OPEN || !DATA) return;
  const asg = computeAssignments();
  const all = [...DATA.main, ...DATA.side, ...DATA.sat];
  const total = all.length, doneCount = all.filter(it => DONE[itemKey(it)]).length;
  const pct = total ? Math.round(doneCount/total*100) : 0;
  const n = nowInSP();
  const ops = OPS.map(o => {
    const mine = all.filter(it => asg[itemKey(it)] === o);
    const d = mine.filter(it => DONE[itemKey(it)]).length;
    return {o, d, t: mine.length};
  }).filter(x => x.t);
  const next = all.filter(it => !DONE[itemKey(it)])
    .sort((a,b) => (hoursToStart(a) ?? 999) - (hoursToStart(b) ?? 999)).slice(0, 9);
  $('tvInner').innerHTML = `
    <div class="tv-head">
      <h2>🌙 Criação Noturna — ${WEEKDAY_TOMORROW.toLowerCase()} ${refToLabel(TURNO.refTomorrow)}</h2>
      <span class="clk">${String(n.hour).padStart(2,'0')}:${String(n.minute).padStart(2,'0')} BRT</span>
    </div>
    <div class="tv-pct">${pct}%</div>
    <div class="tv-bar"><div class="fill" style="width:${pct}%"></div></div>
    <div class="tv-sub">${doneCount} de ${total} torneios criados${avgDurMin() ? ` · ⏱ ${avgDurMin().toFixed(1)}m/torneio` : ''}</div>
    <div class="tv-grid">
      <div class="tv-sec"><h3>Ritmo por operador</h3>
        ${ops.length ? ops.map(x => `
          <div class="tv-op">
            <span class="av" style="background:${opColor(x.o)}">${escHtml(x.o.trim()[0].toUpperCase())}</span>
            <span class="nm">${escHtml(x.o.split(' ')[0])}</span>
            <span class="bar"><span class="fill" style="width:${x.t ? Math.round(x.d/x.t*100) : 0}%"></span></span>
            <span class="n">${x.d}/${x.t}</span>
          </div>`).join('') : '<div class="tv-sub">sem equipe montada</div>'}
      </div>
      <div class="tv-sec"><h3>Próximos prazos</h3>
        ${next.length ? next.map(it => `
          <div class="tv-next ${urgency(it) === 'late' ? 'late' : ''}">
            <span class="h">${escHtml(it.hora)}</span>
            <span class="nm">${escHtml(it.nome)}</span>
            <span style="font-family:var(--mono);font-size:12px;opacity:.6">${urgLabel(it)}</span>
          </div>`).join('') : '<div class="tv-sub">🎉 tudo criado</div>'}
      </div>
    </div>`;
}
function openTV(){ if (!DATA){ showToast('Carregue a Global primeiro.', true); return; } TV_OPEN = true; $('tvOverlay').classList.add('open'); renderTV(); a11yOpenDialog('tvOverlay'); }
function closeTV(){ TV_OPEN = false; $('tvOverlay').classList.remove('open'); a11yCloseDialog('tvOverlay'); }
$('tvBtn').addEventListener('click', openTV);
$('tvClose').addEventListener('click', closeTV);
$('allDoneExport').addEventListener('click', () => $('exportBtn').click());
/* mostra QUAIS colunas da Global foram reconhecidas como Admin Fee / Rake /
   Early Bird / Campanha — reaproveita a MESMA lógica de detecção (probe com
   todos os rótulos). Se uma não é achada, o time vê na hora e ajusta o padrão
   em vez de achar que "não tem". */
function renderFieldDiag(){
  const el = $('fieldDiag');
  if (!DATA){ el.hidden = true; return; }
  const labels = recipeFields();
  const probe = {extra: Object.fromEntries(labels.map(l => [l, 1]))};
  const seek = getter => { const i = getter(probe); return i ? i.label : null; };
  const items = [
    ['Admin Fee', seek(adminInfo)],
    ['Rake / Fee', seek(feeInfo)],
    ['Early Bird', seek(earlyInfo)],
    ['Campanha', seek(campInfo)],
    ['MTT', seek(mttInfo)],
    ['Game Type', seek(gameTypeInfo)],
    ['K.O', seek(koInfo)],
    ['Ticket Award', seek(ticketInfo)],
    ['Payout', seek(payoutInfo)],
    ['Calculated Payout', seek(calcPayoutInfo)],
    ['Rebuy', seek(rebuyInfo)],
    ['Add-on', seek(addonInfo)],
    ['Chips', seek(chipsInfo)],
    ['Time Bank', seek(timeBankInfo)],
    ['Structure', seek(structureInfo)]
  ];
  const chips = items.map(([k, lab]) => lab
    ? `<span class="lk" title="coluna reconhecida: ${escHtml(lab)}"><span class="d" style="background:var(--felt-bright)"></span>${k}</span>`
    : `<span class="lk" style="opacity:.6" title="Nenhuma coluna da Global bateu com ${k} — o destaque/divisão desse item não aparece até a coluna existir ou o padrão ser ajustado"><span class="d" style="background:var(--ink-soft)"></span>${k}: não achada</span>`
  ).join('');
  el.hidden = false;
  el.innerHTML = `<b>Colunas lidas da Global:</b> ${chips}`;
}

function renderOps(){
  const row = $('opsRow');
  if (!row) return;
  let html = OPS.map(o => {
    const r = roleOf(o);
    const opts = `<option value="">Função…</option>` + ROLE_OPTS.map(ro =>
      `<option value="${ro.key}" ${r === ro.key ? 'selected' : ''}>${ro.label}</option>`).join('');
    return `
    <span class="op-chip" ${r ? `data-role="${r}"` : ''}>
      <span class="avatar" style="background:${opColor(o)}">${escHtml(o.trim()[0].toUpperCase())}</span>
      ${escHtml(o)}
      <select class="role-sel" data-op="${escHtml(o)}" title="Função de ${escHtml(o)} no turno">${opts}</select>
      <button class="rm" data-op="${escHtml(o)}" title="Remover do turno">×</button>
    </span>`;
  }).join('');
  html += `
    <span class="op-add">
      <input type="text" id="opAddInput" placeholder="Nome do operador" maxlength="30">
      <button id="opAddBtn">+ Adicionar</button>
    </span>`;
  if (ME && !OPS.some(o => normText(o) === normText(ME))){
    html += `<button class="fchip" id="opAddMe">+ Me incluir (${escHtml(ME.split(' ')[0])})</button>`;
  }
  row.innerHTML = html;
  row.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => saveOps(OPS.filter(o => o !== b.dataset.op))));
  row.querySelectorAll('.role-sel').forEach(sel => sel.addEventListener('change', () => setRole(sel.dataset.op, sel.value)));
  const addOp = () => {
    const v = $('opAddInput').value.trim();
    if (!v) return;
    if (OPS.some(o => normText(o) === normText(v))){ showToast('Esse nome já está na equipe.', true); return; }
    saveOps([...OPS, v]);
  };
  $('opAddBtn').addEventListener('click', addOp);
  $('opAddInput').addEventListener('keydown', e => { if (e.key === 'Enter') addOp(); });
  const me = $('opAddMe');
  if (me) me.addEventListener('click', () => saveOps([...OPS, ME]));
}
function saveOps(list){
  OPS = list;
  if (FILTER !== 'all' && !OPS.includes(FILTER)) FILTER = 'all';
  if (fbDb) fbDb.ref(`${FB_PATH}/ops`).set(list);
  else renderAll();
}

function renderFilters(){
  const asg = computeAssignments();
  const counts = {};
  OPS.forEach(o => counts[o] = 0);
  Object.values(asg).forEach(o => { if (o in counts) counts[o]++; });
  const total = DATA ? DATA.main.length + DATA.side.length + DATA.sat.length : 0;
  let html = `<button class="fchip ${FILTER==='all'?'on':''}" data-f="all">Todos <span class="cnt">${total}</span></button>`;
  html += OPS.map(o => `
    <button class="fchip ${FILTER===o?'on':''}" data-f="${escHtml(o)}">
      ${escHtml(o)}${normText(o)===normText(ME) ? ' (você)' : ''} <span class="cnt">${counts[o] || 0}</span>
    </button>`).join('');
  $('filterChips').innerHTML = html;
  $('filterChips').querySelectorAll('.fchip').forEach(b => b.addEventListener('click', () => { FILTER = b.dataset.f; renderAll(); }));
}

function renderAlerts(){
  const el = $('alerts');
  let html = (DATA && DATA.warnings || []).map(w => `<div class="alert">⚠ ${escHtml(w)}</div>`).join('');
  // erros de criação apontados pela auditoria — o turno corrige e avisa o admin
  if (DATA){
    const errs = [...DATA.main, ...DATA.side, ...DATA.sat].filter(it => auditErr(it));
    if (errs.length){
      const lines = errs.slice(0, 10).map(it => { const a = auditErr(it); return `<b>${escHtml(it.nome)}</b> (${escHtml(it.hora)})${a.motivo ? ' — ' + escHtml(a.motivo) : ''}`; });
      html += `<div class="alert">🛑 <b>Auditoria apontou ${errs.length} erro(s) de criação</b> — corrija no Pokerbyte e avise o admin:<br>${lines.join('<br>')}${errs.length > 10 ? `<br>… e mais ${errs.length - 10}.` : ''}</div>`;
    }
  }
  const chg = DATA && DATA.changes || [];
  if (chg.length){
    const lines = chg.slice(0, 14).map(c => `<b>${escHtml(c.nome)}</b> — ${escHtml(c.campo)}: ${escHtml(fmtChangeVal(c.de))} → ${escHtml(fmtChangeVal(c.para))}`);
    html += `<div class="alert gold">🔄 <b>Global atualizada</b> — ${chg.length} alteração(ões) em relação à versão anterior. Torneios já criados com receita antiga estão marcados com <b>⚠ revisar</b>.<br>${lines.join('<br>')}${chg.length > 14 ? `<br>… e mais ${chg.length - 14}.` : ''}</div>`;
  }
  el.innerHTML = html;
}

let ALLDONE_TOASTED = false;
function renderAllDone(total, doneCount){
  const el = $('allDoneBanner');
  const complete = total > 0 && doneCount >= total;
  el.hidden = !complete;
  if (complete && !ALLDONE_TOASTED){
    ALLDONE_TOASTED = true;
    showToast('🌙 Tudo criado! Suba uma nova GU pra atualizar o cronograma de criação.');
  }
  if (!complete) ALLDONE_TOASTED = false;
}
$('allDoneGo').addEventListener('click', () => {
  $('uploadCard').scrollIntoView({behavior:'smooth', block:'start'});
  $('fileInput').click();
});

function renderStats(){
  if (!DATA){ return; }
  const total = DATA.main.length + DATA.side.length + DATA.sat.length;
  const doneCount = [...DATA.main, ...DATA.side, ...DATA.sat].filter(it => DONE[itemKey(it)]).length;
  const pct = total ? Math.round(doneCount/total*100) : 0;
  renderAllDone(total, doneCount);
  const side = sideSplit();
  const campCount = [...DATA.main, ...DATA.side, ...DATA.sat].filter(hasCampaign).length;
  $('stTotal').textContent = total;
  $('stMain').textContent = DATA.main.length + DATA.sat.length;
  $('stSideA').textContent = side.admin.length;
  $('stSideB').textContent = side.noadmin.length;
  $('stCampWrap').hidden = campCount === 0;
  $('stCamp').textContent = campCount;
  $('stProg').textContent = pct + '%';
  $('progFill').style.width = pct + '%';
  // torneios estourando prazo (começam em <6h e ainda não criados)
  const urgAll = [...DATA.main, ...DATA.side, ...DATA.sat].filter(it => urgency(it));
  const lateCount = urgAll.filter(it => urgency(it) === 'late').length;
  $('stUrgWrap').hidden = urgAll.length === 0;
  $('stUrg').textContent = urgAll.length;
  $('stUrg').style.color = lateCount ? '#f06050' : '#e8c860';
  const perOp = OPS.map(o => {
    const asg = computeAssignments();
    const mine = [...DATA.main, ...DATA.side, ...DATA.sat].filter(it => asg[itemKey(it)] === o);
    const d = mine.filter(it => DONE[itemKey(it)]).length;
    return `${o.split(' ')[0]} ${d}/${mine.length}`;
  }).join(' · ');
  const avg = avgDurMin();
  const avgTxt = avg ? ` · ⏱ ${avg < 1 ? Math.round(avg*60) + 's' : avg.toFixed(1) + 'm'}/torneio` : '';
  $('progCap').textContent = total
    ? `${doneCount} de ${total} torneios criados${avgTxt}${perOp ? ' — ' + perOp : ''}`
    : 'Carregue a Global MTT pra começar';
}

/* ── prazo: instante de início do evento vs agora (tudo em relógio de Brasília).
   Madrugada (até 05:30) pertence ao dia SEGUINTE ao da grade. ── */
function eventStartUTC(it){
  const m = timeToMinutes(it.hora);
  if (m === null) return null;
  const ref = m <= CONF_WINDOW_END_MIN ? TURNO.refDayAfter : TURNO.refTomorrow;
  return Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), Math.floor(m/60), m%60);
}
function hoursToStart(it){
  const start = eventStartUTC(it);
  if (start === null) return null;
  const n = nowInSP();
  const nowU = Date.UTC(n.year, n.month-1, n.day, n.hour, n.minute);
  return (start - nowU) / 3600000;
}
/* 'late' = começa em <3h (ou já começou) e não foi criado; 'warn' = <6h */
function urgency(it){
  if (DONE[itemKey(it)]) return null;
  const h = hoursToStart(it);
  if (h === null) return null;
  if (h < 3) return 'late';
  if (h < 6) return 'warn';
  return null;
}
function urgLabel(it){
  const h = hoursToStart(it);
  if (h === null) return '';
  if (h < 0) return 'já começou!';
  if (h < 1) return `em ${Math.round(h*60)}min`;
  return `em ${Math.floor(h)}h${String(Math.round((h%1)*60)).padStart(2,'0')}`;
}

/* ── ID do evento (Pokerbyte) — compartilhado com o turno via Firebase ── */
function setId(key, val, autoCheck = true){
  val = String(val || '').trim();
  if (fbDb){
    if (val){ fbDb.ref(`${FB_PATH}/ids/${key}`).set({val, by: ME || 'Alguém', at: firebase.database.ServerValue.TIMESTAMP}); logEvent('registrou ID', `${key} → ${val}`); }
    else { fbDb.ref(`${FB_PATH}/ids/${key}`).remove(); logEvent('apagou ID', key); }
  } else {
    if (val) IDS[key] = {val, by: ME}; else delete IDS[key];
  }
  // check automático: cadastrar o ID = o evento existe no Pokerbyte, então marca "criado".
  // só marca (nunca desmarca) e só se ainda não estava criado — apagar o ID não reverte.
  if (autoCheck && val && !DONE[key]) markDone(key);
  else if (!fbDb) renderAll();
}
function idVal(key){ return IDS[key] ? IDS[key].val : ''; }
function idInputHtml(key, extraStyle){
  const v = idVal(key);
  return `<input type="text" class="id-inp ${v ? 'has-id' : ''}" data-idkey="${key}" value="${escHtml(v)}" placeholder="ID Pokerbyte" maxlength="20" style="${extraStyle || ''}" title="${IDS[key] && IDS[key].by ? 'ID por ' + escHtml(IDS[key].by) : 'ID do evento cadastrado no Pokerbyte'}">`;
}

function toggleDone(key){
  const cur = DONE[key];
  if (fbDb){
    if (cur){ fbDb.ref(`${FB_PATH}/done/${key}`).remove(); logEvent('desmarcou criado', key); }
    // transação: se um parceiro marcou no mesmo instante, o registro dele
    // (by/at) é preservado — retornar undefined aborta sem sobrescrever
    else {
      fbDb.ref(`${FB_PATH}/done/${key}`).transaction(existing =>
        existing ? undefined : {by: ME || 'Alguém', at: Date.now()}); logEvent('marcou criado', key);
      // progressão: cada torneio criado na GU é uma ação da jornada do operador
      try{ SupremaAuth.trackAction('gu_criado'); }catch(e){}
    }
  } else {
    if (cur) delete DONE[key]; else DONE[key] = {by: ME, at: Date.now()};
    renderAll();
  }
}

function recipeFields(){ return (DATA && DATA.fields) || []; }

/* ── ORDEM DE CRIAÇÃO ── a receita segue a ordem em que se DIGITA no app,
   não a ordem das colunas da planilha:
   Torneio → K.O → Max. Table → Garantido → Ticket Award → Calculated Payout →
   Payout → Buy-in → Reentry/Rebuy → Stack Reentry/Rebuy → Rebuy Condition →
   Add-on → Stack Add-on → Break Late Reg. → Admin Fee → Structure → Chips →
   Early game → Pós Late Reg. → Final Table → Early Bird → Time Bank.
   Colunas fora da lista entram DEPOIS, na ordem original da planilha.
   Garantido e Buy-in aparecem UMA vez só: se outra coluna casar de novo
   (ex.: "Size buy-in"), ela sai da receita em vez de duplicar. */
const CREATION_ORDER = [
  { m: n => n === 'mtt' },                                                          // Torneio
  { m: n => /(^|[^a-z])k\.?\s*o\b/.test(n) || n.includes('knock') },                // K.O (REG/PROG/OFF)
  { m: n => n.includes('max') && n.includes('table') },                             // MAX. TABLE
  { m: n => n.includes('prize pool') || n.includes('guarant') || n.includes('garantido'), once: true }, // Garantido (1x)
  { m: n => n.includes('ticket') && n.includes('award') },                          // TICKET AWARD
  { m: n => n.includes('payout') && (n.includes('calculated') || n.includes('calculado')) }, // CALCULATED PAYOUT
  { m: n => n.includes('payout') || n.includes('premiac') },                        // PAYOUT
  { m: n => n.includes('buy-in') || n.includes('buy in') || n === 'buyin', once: true }, // Buy-in (1x)
  { m: n => (n.includes('reentry') || n.includes('re-entry') || n.includes('rebuy')) && !n.includes('stack') && !n.includes('condition') },
  { m: n => n.includes('stack') && (n.includes('reentry') || n.includes('re-entry') || n.includes('rebuy')) },
  { m: n => n.includes('rebuy') && n.includes('condition') },
  { m: n => (n.includes('add-on') || n.includes('addon')) && !n.includes('stack') },
  { m: n => n.includes('stack') && (n.includes('add-on') || n.includes('addon')) },
  { m: n => n.includes('break') && n.includes('late') },                            // BREAK LATE REG.
  { m: n => n.includes('admin') && n.includes('fee') },                             // Admin Fee
  { m: n => n.includes('structure') || n.includes('estrutura') },                   // STRUCTURE
  { m: n => n === 'chips' || n.includes('chip stack') || n.includes('starting stack') || n.includes('stack inicial') },
  { m: n => n.includes('early game') },                                             // Early game (blinds)
  { m: n => n.includes('pos late') },                                               // Pós Late Reg. (normText tira o acento)
  { m: n => n.includes('final table') },                                            // Final Table
  { m: n => n.includes('early bird') },                                             // Early Bird
  { m: n => n.includes('time bank') || n === 'tb' },                                // TIME BANK
];
function creationOrderFields(fields){
  const remaining = fields.slice(), out = [];
  CREATION_ORDER.forEach(slot => {
    let claimed = false;
    for (let i = 0; i < remaining.length; ){
      if (slot.m(normText(remaining[i]))){
        if (!claimed){
          out.push(remaining[i]); remaining.splice(i, 1); claimed = true;
          if (!slot.once) break;               // sem dedup: para no primeiro
        } else remaining.splice(i, 1);          // duplicata de Garantido/Buy-in: fora
      } else i++;
    }
  });
  return out.concat(remaining);                 // o que sobrou vai pro fim, na ordem da planilha
}

/* data e hora em que o evento deve ser CRIADO na grade: torneios da madrugada
   (até 05:30) pertencem ao dia civil SEGUINTE ao da grade. Formato: 2026-xx-xx dia 00:00 */
function creationWhen(it){
  const m = timeToMinutes(it.hora);
  const ref = (m !== null && m <= CONF_WINDOW_END_MIN) ? TURNO.refDayAfter : TURNO.refTomorrow;
  return `${refToISO(ref)} dia ${it.hora}`;
}

/* linhas da receita que a operação NÃO usa na criação — fora da tabela e do foco */
const HIDDEN_RECIPE = /num\.?\s*(de\s*)?players|jogadores|\bchat\b/;
function visibleRecipeFields(){ return creationOrderFields(recipeFields().filter(l => !HIDDEN_RECIPE.test(normText(l)))); }
function recipeText(it, cat){
  // Garantido e Buy-in não entram aqui em cima: já saem UMA vez, na posição
  // deles, dentro da receita ordenada abaixo (ordem de digitação do app)
  const parts = [
    `${cat} — ${it.nome}`,
    creationWhen(it),
    `Horário: ${it.hora}`
  ];
  if (it.groupHeader) parts.push(`Grupo: ${it.groupHeader}`);
  // destaques do turno: cálculo e campanha em cima, antes da receita crua
  const af = adminFeeParts(it), e = earlyParts(it);
  if (af) parts.push(`Admin Fee (Rake/Fee + Admin): ${af.main}${af.sub ? ' ' + af.sub : ''}`);
  if (e) parts.push(`Early Bird: ${e.main}${e.sub ? ' ' + e.sub : ''}`);
  if (hasCampaign(it)){ const c = campInfo(it); parts.push(`✦ CAMPANHA${c ? ': ' + c.disp : ''}`); }
  // receita completa da GU — todos os campos que vão no app, na ordem de criação
  creationOrderFields(recipeFields()).forEach(label => {
    const v = it.extra ? it.extra[label] : undefined;
    if (v !== undefined && v !== null && v !== '') parts.push(`${label}: ${fmtExtraVal(label, v)}`);
  });
  if (!recipeFields().length && it.late) parts.push(`Fim do late reg: ${it.late}`);
  return parts.join('\n');
}
/* grid com TODOS os campos da receita (mostra também os vazios — quem cria a
   mesa precisa saber que aquele campo fica em branco no app) */
function recipeGridHtml(it){
  const fields = recipeFields();
  if (!fields.length) return `<div class="recipe-note">Receita completa indisponível nesta planilha (cabeçalho da Global não foi lido). Recarregue a Global MTT original.</div>`;
  return `<div class="recipe-grid">${creationOrderFields(fields).map(label => {
    const v = it.extra ? it.extra[label] : undefined;
    const has = v !== undefined && v !== null && v !== '';
    return `<div class="rf"><div class="k" title="${escHtml(label)}">${escHtml(label)}</div><div class="v ${has ? '' : 'empty'}">${has ? escHtml(fmtExtraVal(label, v)) : 'em branco'}</div></div>`;
  }).join('')}</div>`;
}

/* ── CÁLCULO em destaque: rake / admin fee / early bird ──
   chips compactos pra ver na linha sem abrir a receita */
function calcChipsHtml(it){
  const chips = [];
  const af = adminFeeParts(it);
  if (af) chips.push(`<span class="calc-chip admin" title="Admin Fee — 10% do buy-in / +2% se tiver admin fee"><span class="lab">Admin Fee</span>${escHtml(af.main)}</span>`);
  const e = earlyParts(it);
  if (e) chips.push(`<span class="calc-chip early" title="Early Bird — % das fichas do stack inicial"><span class="lab">EB</span>${escHtml(e.main)}${e.sub ? `<span class="amt">${escHtml(e.sub)}</span>` : ''}</span>`);
  return chips.length ? `<div class="calc-chips">${chips.join('')}</div>` : `<span class="tval" style="opacity:.35">—</span>`;
}
function campBadgeHtml(it){
  if (!hasCampaign(it)) return '';
  const c = campInfo(it);
  return `<span class="camp-badge" title="Torneio com campanha${c ? ' — ' + escHtml(c.disp) : ''}"><span class="spark">✦</span>Campanha</span>`;
}
/* painel de cálculo grande — detalhe expandido e modo foco */
function calcPanelHtml(it){
  const af = adminFeeParts(it), e = earlyParts(it), c = campInfo(it);
  const tile = (cls, k, p, sub) =>
    `<div class="calc-tile ${cls}"><div class="k">${k}</div><div class="v ${p ? '' : 'empty'}">${p ? escHtml(p.main) : '—'}</div>${p && sub ? `<div class="sub">${escHtml(sub)}</div>` : ''}</div>`;
  let html = `<div class="calc-panel">
    ${tile('admin','Admin Fee', af, af ? '10% do buy-in / +2% se tiver admin fee' : '')}
    ${tile('early','Early Bird', e, e ? e.sub + ' (% das fichas)' : '')}`;
  if (hasCampaign(it))
    html += `<div class="calc-tile camp"><div class="k">✦ Campanha</div><div class="v">${c ? escHtml(c.disp) : 'Ativa'}</div>${c ? `<div class="sub" title="${escHtml(c.label)}">${escHtml(c.label)}</div>` : ''}</div>`;
  return html + `</div>`;
}

/* ── diff de versão da Global: quando alguém sobe uma planilha nova por cima,
   compara com a anterior e marca o que mudou — pra revisar no app o que já
   tinha sido criado com a receita antiga ── */
function computeChanges(oldData, sections){
  if (!oldData) return [];
  const flat = d => [...d.main, ...d.side, ...d.sat];
  const byName = list => new Map(list.map(it => [normText(it.nome), it]));
  const oldMap = byName(flat(oldData)), newMap = byName(flat(sections));
  const changes = [];
  const cmp = (nome, campo, a, b) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes.push({nome, campo, de: a ?? '—', para: b ?? '—'}); };
  newMap.forEach((n, k) => {
    const o = oldMap.get(k);
    if (!o){ changes.push({nome: n.nome, campo: 'NOVO', de: '', para: `${n.hora} · $${n.garantido ?? '—'}`}); return; }
    cmp(n.nome, 'Horário', o.hora, n.hora);
    cmp(n.nome, 'Garantido', o.garantido, n.garantido);
    cmp(n.nome, 'Buy-in', o.buyin, n.buyin);
    // receita: qualquer campo extra diferente conta como alteração (um só aviso por torneio)
    if (o.extra && n.extra){
      const labels = new Set([...Object.keys(o.extra), ...Object.keys(n.extra)]);
      for (const l of labels){
        if (JSON.stringify(o.extra[l] ?? null) !== JSON.stringify(n.extra[l] ?? null)){
          changes.push({nome: n.nome, campo: l, de: o.extra[l] ?? '—', para: n.extra[l] ?? '—'});
        }
      }
    }
  });
  oldMap.forEach((o, k) => { if (!newMap.has(k)) changes.push({nome: o.nome, campo: 'REMOVIDO', de: `${o.hora} · $${o.garantido ?? '—'}`, para: ''}); });
  return changes;
}
function changedNames(){
  return new Set((DATA && DATA.changes || []).map(c => normText(c.nome)));
}
function changeBadge(it){
  if (!DATA || !DATA.changes || !DATA.changes.length) return '';
  if (!changedNames().has(normText(it.nome))) return '';
  const wasDone = !!DONE[itemKey(it)];
  const my = DATA.changes.filter(c => normText(c.nome) === normText(it.nome));
  const tip = my.map(c => `${c.campo}: ${fmtChangeVal(c.de)} → ${fmtChangeVal(c.para)}`).join('\n');
  return `<span class="chg-pill ${wasDone ? 'review' : ''}" title="${escHtml(tip)}">${wasDone ? '⚠ revisar' : 'alterado'}</span>`;
}
function fmtChangeVal(v){ return typeof v === 'number' ? v.toLocaleString('pt-BR', {maximumFractionDigits:2}) : String(v); }

/* ── erro de criação marcado pela auditoria (Admin) ── */
function auditErr(it){
  const a = AUDIT[itemKey(it)];
  return a && a.status === 'erro' ? a : null;
}
function auditBadge(it){
  const a = auditErr(it);
  if (!a) return '';
  return `<span class="chg-pill review" title="Erro apontado por ${escHtml(a.by || 'Admin')}${a.motivo ? ':\n' + escHtml(a.motivo) : ''}">⚠ erro de criação</span>`;
}

const EXPANDED = new Set();
function applyExpanded(){
  document.querySelectorAll('[data-detail]').forEach(tr => { tr.hidden = !EXPANDED.has(tr.dataset.detail); });
  document.querySelectorAll('[data-rowkey]').forEach(tr => tr.classList.toggle('expanded', EXPANDED.has(tr.dataset.rowkey)));
}

function visibleItems(list, asg){
  let out = FILTER === 'all' ? list : list.filter(it => asg[itemKey(it)] === FILTER);
  if (SEARCH){
    const q = normText(SEARCH);
    out = out.filter(it => normText(it.nome).includes(q) || it.hora.startsWith(SEARCH.trim()) || (it.groupHeader && normText(it.groupHeader).includes(q)));
  }
  return out;
}

function opTagHtml(op){
  if (!op) return `<span class="op-tag none">sem equipe</span>`;
  return `<span class="op-tag" style="background:${opColor(op)}"><span class="dot">${escHtml(op.trim()[0].toUpperCase())}</span>${escHtml(op.split(' ')[0])}</span>`;
}

/* nota abaixo do cabeçalho da seção: explica a função e quem está nela */
function sectionNoteHtml(cat){
  const explicit = OPS.filter(o => roleOf(o) === cat.role);
  const chips = explicit.map(o =>
    `<span class="lk"><span class="d" style="background:${opColor(o)}"></span>${escHtml(o.split(' ')[0])}</span>`).join('');
  let msg;
  if (cat.key === 'sat')            msg = '<b>Quem cria o Main cria os Satélites</b> — mesma função.';
  else if (cat.key === 'main')      msg = 'Base da grade — vai junto com os Satélites.';
  else if (cat.key === 'sideAdmin') msg = 'Side Events que <b>cobram Admin Fee</b>.';
  else                              msg = 'Side Events <b>sem Admin Fee</b>.';
  const who = explicit.length ? chips : '<span style="opacity:.7">sem função marcada — todos dividem</span>';
  return `<p class="section-note">${msg} ${who}</p>`;
}

function renderList(){
  const area = $('listArea');
  if (!DATA){
    area.innerHTML = `<div class="empty-state"><span class="moon">🌙</span>Nenhuma planilha carregada ainda pra este dia da grade.<br>Suba a Global MTT acima — ou aguarde: se um parceiro subir, aparece aqui sozinho.</div>`;
    return;
  }
  const asg = computeAssignments();
  let html = '';

  SECTIONS.forEach(cat => {
    const items = visibleItems(catItems(cat), asg);
    if (!items.length) return;
    const doneCount = items.filter(it => DONE[itemKey(it)]).length;
    html += `
      <div class="section-head ${cat.cls}">
        <span class="tag"><span class="suit">${cat.suit}</span>${cat.label}</span>
        <span class="cnt">${doneCount}/${items.length} criados</span>
        <span class="line"></span>
      </div>
      ${sectionNoteHtml(cat)}`;
    html += `<div class="secwrap" data-suit="${cat.suit}">${renderVertical(items, cat, asg)}</div>`;
  });

  if (DATA.unknown && DATA.unknown.length && FILTER === 'all'){
    html += `
      <div class="section-head">
        <span class="tag" style="background:var(--red-soft);color:var(--red)">⚠ Tipo não reconhecido</span>
        <span class="cnt">confira a coluna D na Global — não entram na divisão</span>
        <span class="line"></span>
      </div>
      <div class="ttable"><table><tbody>
        ${DATA.unknown.map(it => `<tr><td class="tname">${escHtml(it.nome)} <em style="opacity:.55;font-weight:400">(tipo: "${escHtml(it.tipo ?? '')}")</em></td><td class="thora">${escHtml(it.hora)}</td><td class="tval">${fmtMoney(it.garantido)}</td><td class="tval">${fmtMoney(it.buyin)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  if (!html) html = `<div class="empty-state"><span class="moon">🃏</span>Nada nesse filtro.</div>`;
  area.innerHTML = html;

  area.querySelectorAll('[data-done]').forEach(el => el.addEventListener('click', () => toggleDone(el.dataset.done)));
  area.querySelectorAll('[data-focus]').forEach(el => {
    el.addEventListener('click', () => openFocusAt(el.dataset.focus));
    /* teclado: o nome é role="button" — Enter/Espaço abrem o modo foco */
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); openFocusAt(el.dataset.focus); }
    });
  });
  // ID Pokerbyte: grava ao sair do campo ou no Enter (não a cada tecla, pra não ecoar no parceiro)
  area.querySelectorAll('.id-inp').forEach(inp => {
    inp.addEventListener('change', () => setId(inp.dataset.idkey, inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  // receita expandida sobrevive aos re-renders (sync do Firebase re-renderiza a lista toda)
  area.querySelectorAll('[data-expand]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.expand;
    if (EXPANDED.has(k)) EXPANDED.delete(k); else EXPANDED.add(k);
    applyExpanded();
  }));
  applyExpanded();
  area.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(el.dataset.copy);
      showToast('Receita copiada 📋');
    }catch(e){ showToast('Não consegui copiar — copie manualmente.', true); }
  }));
}

/* vertical (única visão): planilha transposta — campos nas linhas, torneios nas
   colunas, na ordem em que se digita no app. Campos-chave com rótulo destacado. */
function renderVertical(items, cat, asg){
  const cols = items.map(it => {
    const key = itemKey(it);
    return {it, key, done: !!DONE[key], op: asg[key]};
  });
  const cell = (fn, cls) => cols.map(c => `<td class="${c.done ? 'done-col' : ''} ${cls || ''}">${fn(c)}</td>`).join('');
  // rótulos das colunas-chave pra destacar a linha correspondente da receita
  const keyLabels = new Set();
  cols.forEach(c => [feeInfo, adminInfo, earlyInfo, ticketInfo, payoutInfo, calcPayoutInfo, rebuyInfo, addonInfo, chipsInfo, structureInfo, gameTypeInfo, koInfo]
    .forEach(g => { const i = g(c.it); if (i && i.label) keyLabels.add(i.label); }));
  // rótulo da coluna de cada campo temático (ticket, chips, game type, k.o)
  const labelOf = getter => { const c0 = cols.find(c => getter(c.it)); return c0 ? getter(c0.it).label : null; };
  const addonL = labelOf(addonInfo), ticketL = labelOf(ticketInfo), chipsL = labelOf(chipsInfo),
        gameL = labelOf(gameTypeInfo), koL = labelOf(koInfo);
  const SUITS = ['♠','♥','♦','♣'];
  // FEE, ADMIN FEE e EARLY BIRD crus saem da receita: já estão consolidados nas linhas de cima
  const feeCols = new Set();
  cols.forEach(c => [feeInfo, adminInfo, earlyInfo].forEach(g => { const i = g(c.it); if (i && i.label) feeCols.add(i.label); }));
  const rows = visibleRecipeFields().filter(l => !feeCols.has(l));
  return `
    <div class="vwrap"><table class="vtable">
      <tr class="trow-head"><th class="rowlab">Torneio</th>${cell(c => {
        const m = mttKicker(c.it), urg = urgency(c.it);
        return `<span class="vgo" data-focus="${c.key}" role="button" tabindex="0" title="Abrir este torneio no modo foco" aria-label="Abrir ${escHtml(c.it.nome)} no modo foco">${escHtml(c.it.nome)}</span>` + campBadgeHtml(c.it) + valBadge(c.it, cat) + changeBadge(c.it) + auditBadge(c.it)
          + (auditErr(c.it) && auditErr(c.it).motivo ? `<br><span style="font-size:10.5px;color:var(--red);font-weight:600">↳ ${escHtml(auditErr(c.it).motivo)}</span>` : '')
          + (urg ? `<br><span class="urg-pill ${urg}">⏰ ${urgLabel(c.it)}</span>` : '')
          + (m ? `<br><span class="mtt-kick"><span class="tag-k">MTT</span><span class="val">${escHtml(m)}</span></span>` : '');
      }, 'vname')}</tr>
      <tr><th class="rowlab">Horário</th>${cell(c => `<span class="thora">${escHtml(c.it.hora)}</span>`)}</tr>
      <tr><th class="rowlab key">Criar em</th>${cell(c => `<span class="mono" style="font-weight:700">${escHtml(creationWhen(c.it))}</span>`)}</tr>
      <tr><th class="rowlab">Admin Fee</th>${cell(c => { const p = adminFeeParts(c.it); return p ? `<span class="calc-chip admin">${escHtml(p.main)}${p.sub ? `<span class="amt">${escHtml(p.sub)}</span>` : ''}</span>` : `<span style="opacity:.4">—</span>`; })}</tr>
      <tr><th class="rowlab">Early Bird</th>${cell(c => { const p = earlyParts(c.it); return p ? `<span class="calc-chip early">${escHtml(p.main)}${p.sub ? `<span class="amt">${escHtml(p.sub)}</span>` : ''}</span>` : `<span style="opacity:.4">—</span>`; })}</tr>
      ${cols.some(c => hasCampaign(c.it)) ? `<tr><th class="rowlab">Campanha</th>${cell(c => hasCampaign(c.it) ? campBadgeHtml(c.it) : `<span style="opacity:.4">—</span>`)}</tr>` : ''}
      ${cat.key === 'sat' ? `<tr><th class="rowlab">Grupo</th>${cell(c => `<span style="font-size:11px;color:var(--sat-bright)">${escHtml(c.it.groupHeader || '—')}</span>`)}</tr>` : ''}
      ${rows.length
        ? rows.map(label => `<tr><th class="rowlab ${keyLabels.has(label) ? 'key' : ''}" title="${escHtml(label)}">${escHtml(label)}</th>${cell(c => {
            const v = c.it.extra ? c.it.extra[label] : undefined;
            const has = v !== undefined && v !== null && v !== '';
            if (!has) return `<span class="mono" style="color:var(--ink-soft);opacity:.5">—</span>`;
            const disp = fmtExtraVal(label, v);
            // Add-on em $; demais campos como se digita no app
            if (label === addonL){
              const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
              if (isFinite(n) && n > 0) return `<span class="mono" style="color:var(--gold);font-weight:700">${escHtml(fmtMoneyPlain(n))}</span>`;
            }
            // elementos de poker: ticket picotado, ficha de chips, carta do game type, bounty do K.O
            if (label === ticketL) return `<span class="tkt"><span class="stub">Ticket</span><span class="val" title="${escHtml(disp)}">${escHtml(disp)}</span></span>`;
            if (label === chipsL) return `<span class="pchip">${escHtml(disp)}</span>`;
            if (label === gameL){
              const idx = [...normText(disp)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 4;
              return `<span class="gcard"><span class="suit ${idx === 1 || idx === 2 ? 'red' : ''}">${SUITS[idx]}</span>${escHtml(disp)}</span>`;
            }
            if (label === koL && !/^(off|nao|não|no|-|—)$/i.test(String(disp).trim()))
              return `<span class="kochip"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>${escHtml(disp)}</span>`;
            return `<span class="mono" style="${keyLabels.has(label) ? 'font-weight:700' : ''}">${escHtml(disp)}</span>`;
          })}</tr>`).join('')
        : `<tr><th class="rowlab">Late reg</th>${cell(c => `<span class="mono" style="color:var(--ink-soft)">${c.it.late ? escHtml(c.it.late) : '—'}</span>`)}</tr>`}
      <tr><th class="rowlab">Operador</th>${cell(c => opTagHtml(c.op))}</tr>
      <tr><th class="rowlab">ID Pokerbyte</th>${cell(c => idInputHtml(c.key, 'width:110px'))}</tr>
      <tr><th class="rowlab">Criado</th>${cell(c => `
        <button class="chk ${c.done ? 'on' : ''}" data-done="${c.key}" role="checkbox" aria-checked="${c.done ? 'true' : 'false'}"
          aria-label="${c.done ? `Criado por ${escHtml((DONE[c.key]||{}).by || '—')} — desmarcar` : `Marcar ${escHtml(c.it.nome)} como criado`}"
          title="${c.done ? `Criado por ${escHtml((DONE[c.key]||{}).by || '—')}` : 'Marcar como criado'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg></button>
        <button class="copy-btn" data-copy="${escHtml(recipeText(c.it, cat.label))}" title="Copiar receita" style="margin-left:6px;display:inline-grid;vertical-align:middle"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>`)}</tr>
    </table></div>`;
}

/* =========================================================================
   MODO FOCO — criar o próximo: um torneio por vez, receita gigante, campo de
   ID e avanço automático ao marcar como criado. A fila prioriza quem está
   mais perto de estourar o prazo e, se você está na equipe, mostra só os seus.
========================================================================= */
const FOCUS_SKIP = new Set();
let FOCUS_OPEN = false;
let FOCUS_ENTERED = new Set();   // campos já digitados do torneio atual (efêmero)
let FOCUS_ENTERED_KEY = null;    // de qual torneio esse progresso é
let FOCUS_ANIMATE = false;       // dispara a transição só ao avançar, não no tick de 1min
let FOCUS_CURSOR = null;         // #2 rótulo do campo "atual" (auto-avanço)
let FOCUS_FIELDS = [];           // ordem dos campos do torneio atual
const FOCUS_SEEN_AT = {};        // #4 itemKey -> quando o torneio apareceu no foco (início da criação)

/* #4 duração: formata ms e calcula a média dos torneios já criados com tempo */
function fmtDur(ms){
  const s = Math.max(0, Math.round(ms/1000));
  return s < 60 ? `${s}s` : `${Math.floor(s/60)}m${String(s%60).padStart(2,'0')}s`;
}
function avgDurMin(){
  const ds = Object.values(DONE).map(d => d && d.dur).filter(x => typeof x === 'number' && x > 0);
  return ds.length ? ds.reduce((a,b) => a+b, 0) / ds.length / 60000 : null;
}

/* #3 validação da receita — só regras conservadoras (sem falso alarme) */
function validateItem(it, cat){
  const out = [];
  if (it.buyin === null || it.buyin === undefined) out.push('Buy-in ausente na receita');
  if (it.garantido === null || it.garantido === undefined) out.push('Garantido (prize pool) ausente');
  if (!feeActive(it) && !adminActive(it) && cat.key !== 'sat') out.push('Sem Admin Fee (rake/fee) reconhecido na receita');
  return out;
}
function valBadge(it, cat){
  const v = validateItem(it, cat);
  return v.length ? `<span class="val-pill" title="${escHtml(v.join(' · '))}">⚠ conferir</span>` : '';
}

function markDone(key){
  // #4 duração: do 1º instante que o torneio apareceu no foco até marcar criado
  const start = FOCUS_SEEN_AT[key];
  const dur = start ? Date.now() - start : null;
  DONE[key] = {by: ME || 'Alguém', at: Date.now(), ...(dur ? {dur} : {})}; // otimista — o eco do Firebase confirma
  // transação: se dois operadores marcarem juntos, o primeiro vence e o by/dur dele fica
  if (fbDb){
    fbDb.ref(`${FB_PATH}/done/${key}`).transaction(existing =>
      existing ? undefined : {by: ME || 'Alguém', at: Date.now(), ...(dur ? {dur} : {})});
    logEvent('criou (modo foco)', key);
  }
  renderAll();
}

/* =========================================================================
   #5 HANDOFF DE TURNO + menu popover reaproveitável
========================================================================= */
function closePickMenu(){ const m = $('popMenu'); if (m) m.remove(); document.removeEventListener('mousedown', pickMenuOutside, true); }
function pickMenuOutside(e){ const m = $('popMenu'); if (m && !m.contains(e.target)) closePickMenu(); }
function openPickMenu(anchor, title, options){
  closePickMenu();
  const m = document.createElement('div');
  m.className = 'pop-menu'; m.id = 'popMenu';
  m.innerHTML = `<div class="ph">${escHtml(title)}</div>` + options.map((o,i) =>
    `<button class="pm" data-i="${i}"><span class="avatar" style="background:${o.color || 'var(--felt)'}">${escHtml(o.initial || '')}</span>${escHtml(o.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(12, Math.min(r.left, window.innerWidth - m.offsetWidth - 12)) + 'px';
  m.style.top = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 12) + 'px';
  m.querySelectorAll('.pm').forEach(b => b.addEventListener('click', () => { const o = options[+b.dataset.i]; closePickMenu(); o.onPick(); }));
  setTimeout(() => document.addEventListener('mousedown', pickMenuOutside, true), 0);
}
function myOp(){ return OPS.find(o => normText(o) === normText(ME)) || (FILTER !== 'all' ? FILTER : null); }
function myPending(){
  const asg = computeAssignments();
  const op = myOp();
  if (!op) return {op:null, items:[]};
  const items = allWithCat().map(x => x.it).filter(it => asg[itemKey(it)] === op && !DONE[itemKey(it)]);
  return {op, items};
}
function saveOverrides(){ if (fbDb) fbDb.ref(`${FB_PATH}/overrides`).set(OVERRIDES); else { renderAll(); renderFocus(); } }
function handoffTo(items, toOp){
  items.forEach(it => OVERRIDES[itemKey(it)] = toOp);
  saveOverrides();
  logEvent('passou pendentes', `${items.length} torneio(s) → ${toOp}`);
  showToast(`${items.length} torneio(s) passados para ${toOp.split(' ')[0]}.`);
}
function resetOverrides(){ OVERRIDES = {}; saveOverrides(); logEvent('restaurou divisão automática', ''); showToast('Divisão automática restaurada.'); }
function openHandoff(anchor){
  const {op, items} = myPending();
  if (!op){ showToast('Entre na equipe (ou filtre por você) pra passar torneios.', true); return; }
  const others = OPS.filter(o => o !== op);
  const opts = others.map(o => ({
    label: `${o.split(' ')[0]} — assumir ${items.length}`, color: opColor(o), initial: o.trim()[0].toUpperCase(),
    onPick: () => handoffTo(items, o)
  }));
  if (!items.length && !Object.keys(OVERRIDES).length){ showToast('Você não tem pendentes pra passar.'); return; }
  if (Object.keys(OVERRIDES).length) opts.push({label:'↺ Restaurar divisão automática', color:'var(--ink-soft)', initial:'↺', onPick: resetOverrides});
  if (!opts.length){ showToast('Sem parceiros na equipe pra receber.', true); return; }
  const title = items.length ? `Passar ${items.length} pendente(s) de ${op.split(' ')[0]} para:` : 'Divisão manual ativa:';
  openPickMenu(anchor, title, opts);
}

let FOCUS_TARGET = null; // clicou num torneio da tabela → foco abre direto nele
function openFocusAt(key){
  if (DONE[key]){ showToast('Esse torneio já foi criado.'); return; }
  FOCUS_TARGET = key;
  openFocus();
}
function focusQueue(){
  if (!DATA) return [];
  const asg = computeAssignments();
  let all = allWithCat().filter(x => !DONE[itemKey(x.it)]);
  // torneio clicado na tabela fura a fila (mesmo sendo de outro operador)
  if (FOCUS_TARGET){
    const hit = all.find(x => itemKey(x.it) === FOCUS_TARGET);
    if (hit) return [hit, ...all.filter(x => x !== hit).sort((a,b) => (hoursToStart(a.it) ?? 999) - (hoursToStart(b.it) ?? 999))];
    FOCUS_TARGET = null;
  }
  // meus torneios primeiro: se meu nome está na equipe, a fila é só minha;
  // senão respeita o filtro de operador escolhido na tela
  const mineOp = OPS.find(o => normText(o) === normText(ME)) || (FILTER !== 'all' ? FILTER : null);
  if (mineOp) all = all.filter(x => asg[itemKey(x.it)] === mineOp);
  // prioridade: menos horas até o início (prazo estourando primeiro)
  all.sort((a,b) => (hoursToStart(a.it) ?? 999) - (hoursToStart(b.it) ?? 999));
  const notSkipped = all.filter(x => !FOCUS_SKIP.has(itemKey(x.it)));
  if (!notSkipped.length && all.length) FOCUS_SKIP.clear(); // pulou tudo: recomeça a fila
  return notSkipped.length ? notSkipped : all;
}

function openFocus(){
  if (!DATA){ showToast('Carregue a Global primeiro.', true); return; }
  FOCUS_OPEN = true;
  FOCUS_ENTERED = new Set(); FOCUS_ENTERED_KEY = null; FOCUS_ANIMATE = true;
  $('focusOverlay').classList.add('open');
  renderFocus();
  a11yOpenDialog('focusOverlay');   // a11y: aria-hidden + foco entra no diálogo
}
function closeFocus(){
  FOCUS_OPEN = false;
  $('focusOverlay').classList.remove('open');
  const cf = $('focusConfirm'); if (cf) cf.remove();
  closePickMenu();
  a11yCloseDialog('focusOverlay');  // a11y: devolve o foco pra quem abriu
}

/* avança na fila com transição — usado por "Criado" e "Pular" */
function focusAdvance(){ FOCUS_TARGET = null; FOCUS_ANIMATE = true; renderFocus(); }

/* a RECEITA de cima para baixo: uma coluna, na ORDEM da planilha (= ordem que
   se digita no app). Cada campo tem valor, botão de copiar só aquele valor e
   um toque pra marcar "digitei" (apaga a linha) — assim não se perde o lugar
   na descida. Os campos-chave (buy-in, garantido, rake, admin, early, campanha)
   ganham cor na própria linha. */
function focusFlowHtml(it){
  const fields = visibleRecipeFields();
  if (!fields.length)
    return `<div class="recipe-note">Receita completa indisponível nesta planilha (cabeçalho da Global não foi lido). Recarregue a Global MTT original.</div>`;
  const feeL = (feeInfo(it) || {}).label, admL = (adminInfo(it) || {}).label,
        earL = (earlyInfo(it) || {}).label, campL = (campInfo(it) || {}).label;
  // mapa rótulo→destaque dos campos-chave (game type, ticket, chips, structure, time bank, payout)
  const featMap = {};
  const setFeat = (info, cls) => { if (info && info.label && !featMap[info.label]) featMap[info.label] = cls; };
  setFeat(gameTypeInfo(it),'game'); setFeat(ticketInfo(it),'ticket'); setFeat(chipsInfo(it),'chips');
  setFeat(structureInfo(it),'structure'); setFeat(timeBankInfo(it),'timebank'); setFeat(payoutInfo(it),'payout');
  setFeat(calcPayoutInfo(it),'payout'); setFeat(rebuyInfo(it),'rebuy'); setFeat(addonInfo(it),'addon'); setFeat(koInfo(it),'game');
  const copySvg = `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;
  // linha 0 — quando o evento deve ser criado (2026-xx-xx dia 00:00); só leitura
  const quando = creationWhen(it);
  const quandoRow = `<div class="frow prize key-line" data-static="1">
    <span class="fnum">♦</span>
    <span class="fk">Criar em</span>
    <span class="fv">${escHtml(quando)}</span>
    <button class="fcopy" data-fcopy="${escHtml(quando)}" title="Copiar data e hora">${copySvg}</button>
  </div>`;
  return quandoRow + fields.map((label, i) => {
    const v = it.extra ? it.extra[label] : undefined;
    const has = v !== undefined && v !== null && v !== '';
    const disp = has ? fmtExtraVal(label, v) : '';
    const nl = normText(label);
    let accent = '';
    if ((label === feeL && feeActive(it)) || (label === admL && adminActive(it))) accent = 'admin';
    else if (label === earL && earlyActive(it)) accent = 'early';
    else if (label === campL && hasCampaign(it)) accent = 'camp';
    else if (nl.includes('buy')) accent = 'buyin';
    else if (nl.includes('prize') || nl.includes('guarant')) accent = 'prize';
    else if (featMap[label]) accent = featMap[label];
    let vHtml = has ? escHtml(disp) : 'deixar em branco';
    // linha de fee: mostra as parcelas separadas (10% / 2%) com o decimal do buy-in
    if (has && accent === 'admin'){
      const af = adminFeeParts(it);
      if (af) vHtml = escHtml(disp) + `<span class="fsub">${escHtml(af.main)}</span>`;
    }
    // Early Bird: % das fichas — mostra as fichas extras que o % representa
    if (has && accent === 'early'){
      const p = earlyParts(it);
      if (p) vHtml = escHtml(p.main) + (p.sub ? `<span class="fsub">${escHtml(p.sub)}</span>` : '');
    }
    // Add-on: formata em $
    if (has && accent === 'addon'){
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (isFinite(n) && n > 0) vHtml = escHtml(fmtMoneyPlain(n));
    }
    const done = FOCUS_ENTERED.has(label);
    return `<div class="frow ${accent} ${has ? '' : 'blank'} ${done ? 'entered' : ''} ${accent ? 'key-line' : ''}" data-field="${escHtml(label)}">
      <span class="fnum">${done ? '✓' : (i + 1)}</span>
      <span class="fk" title="${escHtml(label)}">${escHtml(label)}</span>
      <span class="fv">${vHtml}</span>
      ${has ? `<button class="fcopy" data-fcopy="${escHtml(disp)}" title="Copiar valor">${copySvg}</button>` : `<span></span>`}
    </div>`;
  }).join('');
}

/* #2 auto-avanço do campo "atual" */
function focusRowByField(card, f){ return [...card.querySelectorAll('.frow')].find(r => r.dataset.field === f) || null; }
function focusNextField(after){
  const start = after != null ? FOCUS_FIELDS.indexOf(after) + 1 : 0;
  for (let i = start; i < FOCUS_FIELDS.length; i++) if (!FOCUS_ENTERED.has(FOCUS_FIELDS[i])) return FOCUS_FIELDS[i];
  for (let i = 0; i < FOCUS_FIELDS.length; i++) if (!FOCUS_ENTERED.has(FOCUS_FIELDS[i])) return FOCUS_FIELDS[i];
  return null;
}
function focusApplyCurrent(card, scroll){
  card.querySelectorAll('.frow.current').forEach(r => r.classList.remove('current'));
  if (!FOCUS_CURSOR) return;
  const row = focusRowByField(card, FOCUS_CURSOR);
  if (!row) return;
  row.classList.add('current');
  if (scroll){
    const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    row.scrollIntoView({block:'center', behavior: reduce ? 'auto' : 'smooth'});
  }
}
function updateFlowProg(card){
  const p = card.querySelector('#flowProg');
  if (p) p.textContent = `${FOCUS_ENTERED.size}/${FOCUS_FIELDS.length} campos`;
}
function focusMarkField(card, label, entered){
  if (entered) FOCUS_ENTERED.add(label); else FOCUS_ENTERED.delete(label);
  const row = focusRowByField(card, label);
  if (row){
    row.classList.toggle('entered', entered);
    const num = row.querySelector('.fnum');
    if (num) num.textContent = entered ? '✓' : (FOCUS_FIELDS.indexOf(label) + 1);
  }
  updateFlowProg(card);
}

/* #6 conferência pós-criação — folha que sobe com o recap dos números-chave */
function openCreateConfirm(it, cat, key, onConfirm){
  const card = $('focusCard');
  if ($('focusConfirm')) return;
  const af = adminFeeParts(it), e = earlyParts(it);
  const idv = $('focusIdInp') ? $('focusIdInp').value.trim() : idVal(key);
  const issues = validateItem(it, cat);
  const cci = (k, v, warn) => `<div class="cci ${warn ? 'warn' : ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const ov = document.createElement('div');
  ov.className = 'focus-confirm'; ov.id = 'focusConfirm';
  ov.dataset.openedAt = Date.now();
  ov.innerHTML = `<div class="cc">
    <h4>Conferir antes de criar</h4>
    <div class="sub"><b>${escHtml(it.nome)}</b> · ${escHtml(cat.label)} — bata os números com o que você cadastrou no Pokerbyte.</div>
    <div class="cc-grid">
      ${cci('Horário', escHtml(it.hora))}
      ${cci('Buy-in', fmtMoney(it.buyin), it.buyin == null)}
      ${cci('Garantido', fmtMoney(it.garantido), it.garantido == null)}
      ${af ? cci('Admin Fee', escHtml(af.main) + (af.sub ? ` <span style="opacity:.6;font-size:11px">${escHtml(af.sub)}</span>` : '')) : cci('Admin Fee', '—', cat.key !== 'sat')}
      ${e ? cci('Early Bird', escHtml(e.main) + (e.sub ? ` <span style="opacity:.6;font-size:11px">${escHtml(e.sub)}</span>` : '')) : ''}
      ${hasCampaign(it) ? cci('✦ Campanha', escHtml((campInfo(it) || {}).disp || 'ativa'), false) : ''}
      ${cci('ID Pokerbyte', idv ? escHtml(idv) : 'em branco', !idv)}
    </div>
    ${issues.length ? `<div class="focus-alerts">${issues.map(m => `<div class="focus-alert">⚠ ${escHtml(m)}</div>`).join('')}</div>` : ''}
    <div class="focus-actions">
      <button class="btn primary" id="ccConfirm"><svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 6.5"/></svg> Confere — criar</button>
      <button class="btn ghost" id="ccBack">Voltar e revisar</button>
    </div>
  </div>`;
  card.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', ev => { if (ev.target === ov) close(); });
  $('ccBack').addEventListener('click', close);
  $('ccConfirm').addEventListener('click', () => { close(); onConfirm(); });
}

function renderFocus(){
  if (!FOCUS_OPEN) return;
  const card = $('focusCard');
  const queue = focusQueue();
  if (!queue.length){
    card.innerHTML = `
      <div class="focus-head" style="border:none"><div class="focus-top"><span class="queue-pos">fila vazia</span><button class="focus-close" id="focusClose" title="Fechar">✕</button></div></div>
      <div class="focus-empty">🎉 <b>Tudo criado!</b><br>Nenhum torneio pendente na sua fila — bom descanso, ou ajude um parceiro trocando o filtro de operador.</div>`;
    $('focusClose').addEventListener('click', closeFocus);
    return;
  }
  const {it, cat} = queue[0];
  const key = itemKey(it);
  // progresso "digitei" é por torneio — zera ao trocar de torneio
  if (FOCUS_ENTERED_KEY !== key){ FOCUS_ENTERED = new Set(); FOCUS_ENTERED_KEY = key; FOCUS_CURSOR = null; }
  if (!FOCUS_SEEN_AT[key]) FOCUS_SEEN_AT[key] = Date.now();   // #4 início da criação
  FOCUS_FIELDS = visibleRecipeFields();                      // #2 ordem dos campos (sem Num. Players/Chat)
  if (!FOCUS_CURSOR || !FOCUS_FIELDS.includes(FOCUS_CURSOR) || FOCUS_ENTERED.has(FOCUS_CURSOR))
    FOCUS_CURSOR = focusNextField(null);
  const urg = urgency(it);
  const issues = validateItem(it, cat);

  // progresso da MINHA fila da noite (pra saber o ritmo)
  const asg = computeAssignments();
  const mineOp = OPS.find(o => normText(o) === normText(ME)) || (FILTER !== 'all' ? FILTER : null);
  const mineAll = mineOp ? allWithCat().filter(x => asg[itemKey(x.it)] === mineOp) : allWithCat();
  const mineDone = mineAll.filter(x => DONE[itemKey(x.it)]).length;
  const mineTotal = mineAll.length || 1;
  const nightPct = Math.round(mineDone / mineTotal * 100);
  const next = queue[1] ? queue[1].it : null;
  const fieldsN = FOCUS_FIELDS.length;

  card.innerHTML = `
    <div class="focus-head">
      <div class="focus-top">
        <span class="tag" style="background:var(--${cat.cls}-soft);color:var(--${cat.cls}-bright)">${cat.label}</span>
        ${urg ? `<span class="urg-pill ${urg}">⏰ começa ${urgLabel(it)}</span>` : ''}
        ${auditBadge(it)}
        ${campBadgeHtml(it)}
        ${it.groupHeader ? `<span class="pill" style="color:var(--sat-bright)">${escHtml(it.groupHeader)}</span>` : ''}
        <span class="queue-pos">${mineDone + 1} de ${mineTotal} · ${queue.length} na fila</span>
        <button class="focus-close" id="focusClose" title="Fechar (Esc)">✕</button>
      </div>
      <div class="focus-name">${escHtml(it.nome)}</div>
      ${(() => { const m = mttKicker(it); return m ? `<div class="focus-mtt"><span class="tag-k">MTT</span>${escHtml(m)}</div>` : ''; })()}
      <div class="focus-check">
        <div class="fc hora"><span class="k">Criar em</span><span class="v">${escHtml(creationWhen(it))}</span></div>
        ${it.late ? `<div class="fc"><span class="k">Fim late reg</span><span class="v">${escHtml(it.late)}</span></div>` : ''}
      </div>
      <div class="focus-night">
        <div class="bar"><div class="fill" style="width:${nightPct}%"></div></div>
        <span class="cap">${mineDone}/${mineTotal} da sua noite</span>
        <span class="cap" id="focusElapsed"></span>
      </div>
    </div>

    <div class="focus-body">
      ${issues.length ? `<div class="focus-alerts">${issues.map(m => `<div class="focus-alert">⚠ ${escHtml(m)}</div>`).join('')}</div>` : ''}
      ${(() => { const s = specSheetHtml(it); return s ? `<div class="spec-title"><svg viewBox="0 0 24 24"><path d="M12 2 15 9l7 .5-5.3 4.6L18.5 21 12 17l-6.5 4 1.8-6.9L2 9.5 9 9z"/></svg> Destaques</div>${s}` : ''; })()}
      <div class="flow-head">
        <span class="t"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h12"/></svg> Receita — de cima para baixo</span>
        <span class="flow-prog" id="flowProg">${FOCUS_ENTERED.size}/${fieldsN} campos</span>
      </div>
      ${focusFlowHtml(it)}
      <div class="flow-hint"><kbd>↓</kbd><kbd>↑</kbd> muda o campo · <kbd>Enter</kbd> marca e desce · toque na linha marca "digitei"</div>
    </div>

    <div class="focus-foot">
      <div class="focus-id-row">
        <label>ID Pokerbyte</label>
        <input type="text" id="focusIdInp" maxlength="20" placeholder="Cole o ID do evento criado no Pokerbyte" value="${escHtml(idVal(key))}">
      </div>
      <div class="focus-actions">
        <button class="btn primary" id="focusDone">
          <svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 6.5"/></svg>
          Criado — próximo
        </button>
        <button class="btn ghost" id="focusSkip">Pular</button>
        <button class="btn ghost" id="focusCopy">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          Copiar tudo
        </button>
        ${next ? `<span class="focus-next">próximo<br><span class="h">${escHtml(next.hora)}</span> <b>${escHtml(next.nome.length > 30 ? next.nome.slice(0,30) + '…' : next.nome)}</b></span>` : ''}
      </div>
    </div>`;

  // transição só ao avançar de torneio (não no tick de 1 min)
  if (FOCUS_ANIMATE){
    const body = card.querySelector('.focus-body');
    if (body){
      body.scrollTop = 0;
      body.classList.add('swap');
      body.addEventListener('animationend', () => body.classList.remove('swap'), {once:true});
    }
    FOCUS_ANIMATE = false;
  }
  focusApplyCurrent(card, false); // #2 marca o campo atual sem rolar de repente

  $('focusClose').addEventListener('click', closeFocus);
  // #6 "Criado" abre a conferência antes de confirmar
  $('focusDone').addEventListener('click', () => {
    const idv = $('focusIdInp').value.trim();
    if (idv && idv !== idVal(key)) setId(key, idv, false); // no foco, a conferência é que confirma
    openCreateConfirm(it, cat, key, () => { markDone(key); focusAdvance(); });
  });
  $('focusSkip').addEventListener('click', () => { FOCUS_SKIP.add(key); focusAdvance(); });
  $('focusCopy').addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(recipeText(it, cat.label)); showToast('Receita completa copiada 📋'); }
    catch(e){ showToast('Não consegui copiar.', true); }
  });
  $('focusIdInp').addEventListener('change', () => setId(key, $('focusIdInp').value, false));
  $('focusIdInp').addEventListener('keydown', e => { if (e.key === 'Enter') $('focusDone').click(); });

  // por-campo: toque marca "digitei" e AVANÇA o campo atual; botão copia só o valor
  card.querySelectorAll('.frow').forEach(row => {
    row.addEventListener('click', e => {
      if (row.dataset.static) return;   // linha "Criar em": só leitura/cópia
      if (e.target.closest('.fcopy')) return;
      const f = row.dataset.field;
      const willEnter = !FOCUS_ENTERED.has(f);
      focusMarkField(card, f, willEnter);
      if (willEnter){ FOCUS_CURSOR = focusNextField(f); focusApplyCurrent(card, true); }
      else { FOCUS_CURSOR = f; focusApplyCurrent(card, true); }
    });
  });
  card.querySelectorAll('.fcopy').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    try{
      await navigator.clipboard.writeText(btn.dataset.fcopy || '');
      showToast('Valor copiado 📋');
      const row = btn.closest('.frow');
      const f = row && row.dataset.field;
      if (f && !FOCUS_ENTERED.has(f)){ focusMarkField(card, f, true); FOCUS_CURSOR = focusNextField(f); focusApplyCurrent(card, true); }
    }catch(err){ showToast('Não consegui copiar.', true); }
  }));
}
$('focusBtn').addEventListener('click', openFocus);
$('handoffBtn').addEventListener('click', e => openHandoff(e.currentTarget));
$('focusOverlay').addEventListener('click', e => { if (e.target === $('focusOverlay')) closeFocus(); });

/* #2 teclado no foco: setas movem o campo atual, Enter marca e desce */
document.addEventListener('keydown', e => {
  if ($('popMenu') && e.key === 'Escape'){ closePickMenu(); return; }
  if (TV_OPEN && e.key === 'Escape'){ closeTV(); return; }
  const confirmEl = $('focusConfirm');
  if (confirmEl){
    if (e.key === 'Escape'){ confirmEl.remove(); e.preventDefault(); }
    else if (e.key === 'Enter'){
      if (Date.now() - (+confirmEl.dataset.openedAt || 0) < 350) return; // ignora o Enter que abriu a conferência
      const b = $('ccConfirm'); if (b){ b.click(); e.preventDefault(); }
    }
    return;
  }
  if (!FOCUS_OPEN) return;
  if (e.key === 'Escape'){ closeFocus(); return; }
  const ae = document.activeElement;
  if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return; // digitando o ID: não sequestra teclas
  const card = $('focusCard');
  if (!FOCUS_FIELDS.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault();
    let i = FOCUS_CURSOR ? FOCUS_FIELDS.indexOf(FOCUS_CURSOR) : -1;
    i = Math.max(0, Math.min(FOCUS_FIELDS.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    FOCUS_CURSOR = FOCUS_FIELDS[i];
    focusApplyCurrent(card, true);
  } else if (e.key === 'Enter' || e.key === ' '){
    if (!FOCUS_CURSOR) return;
    e.preventDefault();
    const f = FOCUS_CURSOR;
    focusMarkField(card, f, true);
    FOCUS_CURSOR = focusNextField(f);
    focusApplyCurrent(card, true);
  }
});

/* #4 cronômetro ao vivo do torneio em criação (só enquanto o foco está aberto) */
setInterval(() => {
  if (!FOCUS_OPEN) return;
  const el = $('focusElapsed');
  if (!el) return;
  const t = FOCUS_SEEN_AT[FOCUS_ENTERED_KEY];
  el.textContent = t ? '· ⏱ ' + fmtDur(Date.now() - t) : '';
}, 1000);

/* ── busca ── */
$('searchInp').addEventListener('input', () => { SEARCH = $('searchInp').value; renderList(); });

/* relógio de urgência: a cada minuto atualiza stats/notificações, mas SÓ
   reconstrói a tabela se algum torneio mudou de estado de prazo (warn/late) —
   sem mudança, re-renderizar 10 mil células é desperdício */
let LAST_URG_SIG = '';
function urgSignature(){
  return [...DATA.main, ...DATA.side, ...DATA.sat].map(it => urgency(it) || '-').join('');
}
setInterval(() => {
  if (!DATA) return;
  renderStats();
  renderTV();
  checkDeadlineNotifs();
  const sig = urgSignature();
  if (sig === LAST_URG_SIG) return;
  LAST_URG_SIG = sig;
  const ae = document.activeElement;
  if (!(ae && ae.classList.contains('id-inp'))) renderList();
  // não re-renderizar o foco enquanto a pessoa digita o ID ou marca campos
  if (!(FOCUS_OPEN && ae && ae.id === 'focusIdInp')) renderFocus();
}, 60000);

/* ── AVISO: fechamento dos planos de mesa — toda SEGUNDA 05:00 (BRT) ──
   Aparece 1h, 30min e 15min antes (banner escalonado + notificação nativa).
   Deadline = próxima segunda 05:00 no fuso America/Sao_Paulo. ── */
(function tablePlanDeadline(){
  const THRESHOLDS = [60, 30, 15];   // minutos antes que disparam o aviso
  const NOTIF_KEY  = 'cn_plan_notified_v1';   // {deadlineTs: [thresholds já notificados]}
  let notified = {};
  try{ notified = JSON.parse(localStorage.getItem(NOTIF_KEY)) || {}; }catch(e){ notified = {}; }
  let dismissedFor = 0;              // nível de escalonamento que o usuário fechou p/ este deadline

  // "agora" em SP como se fosse UTC — assim getUTCDay()/getUTCHours() = relógio de parede de SP
  function spNowUTC(){
    const n = nowInSP();
    return new Date(Date.UTC(n.year, n.month-1, n.day, n.hour, n.minute, n.second));
  }
  // próxima segunda-feira 05:00 (SP). Se hoje é segunda e ainda não deu 05:00, é hoje.
  function nextDeadline(){
    const now = spNowUTC();
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 0, 0));
    const toMon = (1 - t.getUTCDay() + 7) % 7;         // dias até segunda (0=dom,1=seg)
    t.setUTCDate(t.getUTCDate() + toMon);
    if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 7);
    return { now, target: t, minsLeft: (t.getTime() - now.getTime()) / 60000 };
  }

  // elemento (criado uma vez)
  let el = null;
  function ensureEl(){
    if (el) return el;
    el = document.createElement('div');
    el.className = 'plan-deadline';
    el.innerHTML =
      `<div class="pd-ic">🗂️</div>
       <div class="pd-txt">
         <div class="pd-title">Fechar os planos de mesa <span class="pd-count" id="pdCount"></span></div>
         <div class="pd-sub" id="pdSub"></div>
       </div>
       <button class="pd-x" id="pdX" title="Ocultar até o próximo aviso" aria-label="Ocultar">✕</button>`;
    document.body.appendChild(el);
    el.querySelector('#pdX').addEventListener('click', () => {
      dismissedFor = curLevel;   // esconde até subir de nível (30→15) ou passar do prazo
      el.classList.remove('show');
    });
    return el;
  }

  let curLevel = 0;  // 0 nada · 1 (≤60) · 2 (≤30) · 3 (≤15 ou estourou)
  function fmtLeft(m){
    if (m <= 0) return 'agora';
    const h = Math.floor(m/60), mm = Math.floor(m%60);
    return h > 0 ? `${h}h${String(mm).padStart(2,'0')}` : `${mm}min`;
  }
  function levelOf(m){
    if (m <= 15) return 3;
    if (m <= 30) return 2;
    if (m <= 60) return 1;
    return 0;
  }

  function tick(){
    const d = nextDeadline();
    const key = String(d.target.getTime());
    // limpa notificações de deadlines antigos
    Object.keys(notified).forEach(k => { if (Number(k) < d.now.getTime() - 3600000) delete notified[k]; });

    // dispara notificação nativa ao CRUZAR cada limiar (janela de ~1 min)
    if ('Notification' in window && Notification.permission === 'granted'){
      const fired = notified[key] || [];
      THRESHOLDS.forEach(T => {
        if (d.minsLeft <= T && d.minsLeft > T - 1.2 && !fired.includes(T)){
          fired.push(T);
          try{ new Notification('🗂️ Fechamento dos planos de mesa', {
            body: `Faltam ${T} min (segunda 05:00). Feche os planos de mesa antes do prazo.`,
            tag: 'plan-deadline'
          }); }catch(e){}
        }
      });
      notified[key] = fired;
      try{ localStorage.setItem(NOTIF_KEY, JSON.stringify(notified)); }catch(e){}
    }

    // banner: visível de 60min antes até 30min DEPOIS do prazo (grace pra pegar as 05:00)
    const passed = d.minsLeft <= 0;
    const inGrace = passed && d.minsLeft > -30;
    const lvl = passed ? (inGrace ? 3 : 0) : levelOf(d.minsLeft);
    curLevel = lvl;
    if (lvl === 0){ if (el) el.classList.remove('show'); dismissedFor = 0; return; }

    ensureEl();
    // subiu de nível → reexibe mesmo se o usuário tinha fechado
    if (dismissedFor && lvl > dismissedFor) dismissedFor = 0;
    el.classList.toggle('lvl2', lvl === 2);
    el.classList.toggle('lvl3', lvl === 3);
    el.classList.remove('lvl1');
    const count = el.querySelector('#pdCount');
    const sub   = el.querySelector('#pdSub');
    if (passed){
      count.textContent = '· prazo às 05:00';
      sub.textContent = 'Passou das 05:00 — confirme que os planos de mesa foram fechados.';
    } else {
      count.textContent = `· faltam ${fmtLeft(d.minsLeft)}`;
      sub.textContent = 'Prazo toda segunda-feira às 05:00 (BRT). Feche os planos de mesa antes do horário.';
    }
    if (!dismissedFor) el.classList.add('show');
  }

  tick();
  setInterval(tick, 20000);   // atualiza o contador e checa os limiares
})();

/* ── segmented: moeda + orientação ── */
$('currencySeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  CURRENCY = b.dataset.cur;
  localStorage.setItem('cn_currency', CURRENCY);
  $('currencySeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  renderList();
}));
(function restoreSegs(){
  $('currencySeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.cur === CURRENCY));
})();

/* ── export xlsx — EXATAMENTE o formato da "Conferência de amanhã" do Painel
   (exportConfAmanhaXlsx em painel.js): colunas Torneio · Horário · Garantido ·
   Buy in; Main Events em ordem cronológica, linha em branco, Side Events em
   ordem cronológica, linha em branco, Satélites agrupados por grupo (linha em
   branco entre grupos), e o total no rodapé. Sem subdivisão por Admin Fee, sem
   colunas de operador, sem cores — igual à planilha que a operação usa no dia. ── */
$('exportBtn').addEventListener('click', async () => {
  if (!DATA){ showToast('Carregue a Global primeiro.', true); return; }
  try{ await ensureXLSX(); }catch(_){ showToast('A biblioteca de planilhas não carregou — recarregue a página.', true); return; }
  const cur = CURRENCY === 'usd' ? '$' : 'R$';
  const conv = v => v === null || v === undefined ? null : (CURRENCY === 'usd' ? v : Math.round(v * BRL_RATE * 100) / 100);
  const asg = computeAssignments(); // itemKey -> operador da divisão

  // main e side já vêm em ordem cronológica do gu-parser (buildSections); sat vem
  // na ordem de leitura da Global, agrupado por groupHeader — igual à Conferência de amanhã
  const main = DATA.main || [];
  const side = DATA.side || [];
  const sat  = DATA.sat  || [];
  const unknown = DATA.unknown || [];
  const total = main.length + side.length + sat.length;
  if (!total && !unknown.length){ showToast('Nada para exportar.', true); return; }

  // agrupa satélites por groupHeader, preservando a ordem de primeira aparição
  const satOrder = [], satMap = {};
  sat.forEach(it => { const k = it.groupHeader || it.nome; if (!satMap[k]){ satMap[k] = []; satOrder.push(k); } satMap[k].push(it); });
  const satGroups = satOrder.map(k => satMap[k]);

  const rows = [['Torneio', 'Horário', `Garantido (${cur})`, `Buy in (${cur})`, 'ID', 'Operador']];
  const pushRow = it => { const key = itemKey(it); rows.push([it.nome, it.hora, conv(it.garantido), conv(it.buyin), idVal(key), asg[key] || '']); };
  const blankRow = () => rows.push([]);

  main.forEach(pushRow); if (main.length) blankRow();
  side.forEach(pushRow); if (side.length) blankRow();
  satGroups.forEach(g => { g.forEach(pushRow); blankRow(); });

  if (unknown.length){
    blankRow();
    rows.push(['TIPO NÃO RECONHECIDO — verificar coluna TYPE na Global antes de fechar']);
    unknown.forEach(it => { const key = itemKey(it); rows.push([it.nome, it.hora, conv(it.garantido), conv(it.buyin), idVal(key), asg[key] || '', it.tipo ?? '']); });
  }

  // rodapé de checagem: quem receber a planilha confere se nada foi cortado
  blankRow();
  rows.push([`Total: ${total} torneios (Main ${main.length} · Side ${side.length} · Sat ${sat.length}) — ${WEEKDAY_TOMORROW} ${refToLabel(TURNO.refTomorrow)}`]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:30},{wch:10},{wch:14},{wch:12},{wch:16},{wch:18}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (WEEKDAY_TOMORROW || 'Criação Noturna').slice(0,31));
  XLSX.writeFile(wb, `CriacaoNoturna_${TOMORROW_ISO}.xlsx`);
  showToast(`Exportado — ${total} torneios (Main ${main.length} · Side ${side.length} · Sat ${sat.length}).`);
});

/* ── resumo pra colar no grupo ── */
$('summaryBtn').addEventListener('click', async () => {
  if (!DATA){ showToast('Carregue a Global primeiro.', true); return; }
  const asg = computeAssignments();
  const lines = [`🌙 Criação Noturna — ${WEEKDAY_TOMORROW.toLowerCase()} ${refToLabel(TURNO.refTomorrow)}`];
  if (OPS.length){
    OPS.forEach(o => {
      const r = roleOf(o);
      const rlabel = r ? ' · ' + (ROLE_OPTS.find(x => x.key === r) || {}).label : '';
      lines.push(`\n👤 ${o}${rlabel}`);
      SECTIONS.forEach(cat => {
        const mine = catItems(cat).filter(it => asg[itemKey(it)] === o);
        if (mine.length){
          const camp = mine.filter(hasCampaign).length;
          lines.push(`  ${cat.label}: ${mine.length}${camp ? ` (✦${camp} campanha)` : ''} — ${mine.map(it => it.hora).join(', ')}`);
        }
      });
    });
  } else {
    SECTIONS.forEach(cat => lines.push(`${cat.label}: ${catItems(cat).length}`));
  }
  const total = DATA.main.length + DATA.side.length + DATA.sat.length;
  const doneCount = [...DATA.main, ...DATA.side, ...DATA.sat].filter(it => DONE[itemKey(it)]).length;
  const avg = avgDurMin();
  lines.push(`\nTotal: ${total} torneios · ${doneCount} criados${avg ? ` · ⏱ ${avg < 1 ? Math.round(avg*60) + 's' : avg.toFixed(1) + 'm'}/torneio` : ''}`);
  try{
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast('Resumo copiado — pronto pra colar no grupo 📋');
  }catch(e){ showToast('Não consegui copiar.', true); }
});

/* pausa animações quando a janela sai de foco / fica oculta — mantém o PC fluido p/ os outros apps */
(function freezeWhenBlurred(){
  const set = b => document.body.classList.toggle('win-blurred', b);
  addEventListener('blur', () => set(true));
  addEventListener('focus', () => set(false));
  document.addEventListener('visibilitychange', () => set(document.hidden));
})();

/* ── a11y dos diálogos (focusOverlay / tvOverlay) ──────────────────────────
   Move o foco pra DENTRO do diálogo ao abrir, prende o Tab lá e devolve o foco
   pra quem abriu ao fechar. O Esc já é tratado no handler global acima. */
var _a11yLastFocus = null;
function a11yOpenDialog(id){
  var dlg = document.getElementById(id); if(!dlg) return;
  dlg.setAttribute('aria-hidden','false');
  _a11yLastFocus = document.activeElement;
  var foc = dlg.querySelector('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])');
  setTimeout(function(){ (foc || dlg).focus && (foc || dlg).focus(); }, 40);
}
function a11yCloseDialog(id){
  var dlg = document.getElementById(id); if(dlg) dlg.setAttribute('aria-hidden','true');
  if(_a11yLastFocus && _a11yLastFocus.focus) _a11yLastFocus.focus();
  _a11yLastFocus = null;
}
document.addEventListener('keydown', function(e){
  if(e.key !== 'Tab') return;
  var dlg = document.querySelector('#focusOverlay.open, #tvOverlay.open');
  if(!dlg) return;
  var foc = [].slice.call(dlg.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(function(el){ return el.getClientRects().length; });
  if(!foc.length) return;
  var first = foc[0], last = foc[foc.length-1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  else if(!dlg.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
});

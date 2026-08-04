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

const _clock = turnoAmanha();
const NATURAL_ISO = refToISO(_clock.refTomorrow);   // madrugada que o RELÓGIO indica agora
/* ── MADRUGADA ATIVA (sticky) ─────────────────────────────────────────────
   A página LEMBRA a madrugada que você está criando (localStorage) e NUNCA troca
   sozinha num reload. Antes, o caminho no Firebase vinha direto do relógio: passava
   das 05:30, alguém dava F5 (ou clicava em "nova versão") e a página pulava pro dia
   seguinte — VAZIO — parecendo que "resetou" a Criação Noturna e os IDs (que na
   verdade continuavam salvos no dia certo). Agora só vira pra próxima madrugada
   quando o operador CLICA em "Começar a nova" (banner abaixo, quando o relógio já
   passou pra uma madrugada mais nova). Tudo da página — caminho, dias, rótulos —
   passa a derivar da madrugada ATIVA, não do relógio, pra não haver descompasso. */
let _storedDay = null; try{ _storedDay = localStorage.getItem('cn_active_day'); }catch(e){}
/* sem dia salvo = sessão "cega": ou é o primeiro acesso desta madrugada mesmo, ou o
   localStorage foi limpo (PC compartilhado, modo anônimo, outro navegador/dispositivo
   no meio do turno) e a página está prestes a recalcular do relógio — o cenário exato
   do bug de IDs sumindo. Guardado pra depois checar no Firebase se sobrou criação
   iniciada num dia anterior antes de aceitar o dia calculado agora como o certo. */
const HAD_STORED_DAY = !!_storedDay;
/* GUARD DE DIA MORTO: o sticky existe pra segurar a virada de +1 dia às 05:30 (não
   resetar criação/IDs no meio do turno — ver bloco acima). Mas se o dia gravado ficou
   2+ dias ATRÁS do natural (uma noite inteira pulada, painel sem abrir por um dia), o
   dia guardado está MORTO: segurar só trava o painel num dia passado (foi o bug do
   "conta como se fosse dia 30" quando já era 01/08). Nesse caso avança sozinho pro dia
   certo. O hold de +1 dia — a proteção real da virada — continua intacto. */
let _activeCandidate = _storedDay || NATURAL_ISO;
if (_storedDay){
  const _dNat = new Date(`${NATURAL_ISO}T12:00:00Z`);
  const _dStored = new Date(`${_storedDay}T12:00:00Z`);
  const _daysBehind = Math.round((_dNat.getTime() - _dStored.getTime()) / 86400000);
  if (isNaN(_dStored.getTime()) || _daysBehind >= 2) _activeCandidate = NATURAL_ISO;
}
const ACTIVE_ISO = _activeCandidate;
try{ localStorage.setItem('cn_active_day', ACTIVE_ISO); }catch(e){}
const _refTom = new Date(`${ACTIVE_ISO}T12:00:00Z`);
const _refAfter = new Date(_refTom.getTime() + 86400000);
/* dia anterior ao ativo — usado só pela checagem de recuperação (ver cnCheckAbandonedDay) */
const PREV_ACTIVE_ISO = refToISO(new Date(_refTom.getTime() - 86400000));
const TURNO = { n: _clock.n, refTomorrow: _refTom, refDayAfter: _refAfter };
const TOMORROW_ISO = ACTIVE_ISO;
const WEEKDAY_TOMORROW = WEEKDAYS_PT[TURNO.refTomorrow.getUTCDay()];      // exibição
const WEEKDAY_DAYAFTER = WEEKDAYS_PT[TURNO.refDayAfter.getUTCDay()];
const WEEKDAY_TOMORROW_EN = WEEKDAYS_EN[TURNO.refTomorrow.getUTCDay()];   // a G MTTS usa dias em inglês
const WEEKDAY_DAYAFTER_EN = WEEKDAYS_EN[TURNO.refDayAfter.getUTCDay()];
const DAY_LABEL = `${WEEKDAY_TOMORROW.split('-')[0].toLowerCase()} · ${refToLabel(TURNO.refTomorrow)}`;
const NIGHT_ADVANCED = NATURAL_ISO > ACTIVE_ISO;   // já chegou uma madrugada mais nova que a carregada

$('heroDay').textContent = `de ${WEEKDAY_TOMORROW.toLowerCase()} · ${refToLabel(TURNO.refTomorrow)}`;
$('uploadDayLabel').textContent = `${WEEKDAY_TOMORROW.toLowerCase()} (${refToLabel(TURNO.refTomorrow)})`;

/* Nova madrugada disponível: NÃO troca sozinho (sticky). Oferece a troca explícita —
   a de agora fica salva no Firebase (nada se perde); começar a nova só re-aponta o caminho. */
if (NIGHT_ADVANCED){
  const naturalLabel = `${WEEKDAYS_PT[_clock.refTomorrow.getUTCDay()].split('-')[0].toLowerCase()} · ${refToLabel(_clock.refTomorrow)}`;
  const bar = document.createElement('div');
  bar.id = 'newNightBar';
  bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:160;background:var(--gold);color:#1a1206;padding:9px 10px 9px 16px;border-radius:99px;font-size:12.5px;font-weight:650;box-shadow:var(--shadow-lg);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px)';
  bar.innerHTML = `<span>🌙 Criando a madrugada de <b>${escHtml(DAY_LABEL)}</b> — já chegou a de <b>${escHtml(naturalLabel)}</b>.</span>`;
  const go = document.createElement('button');
  go.textContent = 'Começar a nova';
  go.style.cssText = 'background:#1a1206;color:var(--gold);border:none;border-radius:99px;padding:6px 13px;font-weight:800;font-size:12px;cursor:pointer;flex:none';
  go.onclick = () => { try{ localStorage.setItem('cn_active_day', NATURAL_ISO); }catch(e){} location.reload(); };
  const dismiss = document.createElement('button');
  dismiss.textContent = '✕'; dismiss.title = 'Continuar nesta madrugada';
  dismiss.style.cssText = 'background:none;border:none;color:#1a1206;cursor:pointer;font-weight:800;font-size:14px;flex:none';
  dismiss.onclick = () => bar.remove();
  bar.append(go, dismiss);
  document.body.appendChild(bar);
}

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
const CAT_LIGA = {key:'liga', cls:'liga', suit:'🏆', label:'Liga Principal'};
function ligaItemsForDay(){
  if (typeof LIGA_PRINCIPAL_SECTIONS === 'undefined') return [];
  const lp = LIGA_PRINCIPAL_SECTIONS[WEEKDAY_TOMORROW_EN];
  return lp ? [...(lp.main||[]), ...(lp.side||[]), ...(lp.sat||[])] : [];
}
function allWithCat(){
  const s = sideSplit();
  return [
    ...DATA.main.map(it => ({it, cat: CAT_MAIN})),
    ...s.admin.map(it => ({it, cat: CAT_SIDE_A})),
    ...s.noadmin.map(it => ({it, cat: CAT_SIDE_B})),
    ...DATA.sat.map(it => ({it, cat: CAT_SAT})),
    // Liga Principal agora entra na divisão/handoff — itemKey (nome|hora) casa com as
    // cópias US-eq do render, então atribuição e "meus torneios" enxergam a Liga também
    ...ligaItemsForDay().map(it => ({it, cat: CAT_LIGA}))
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
/* itemKey da última ação do OPERADOR (digitar ID / marcar criado) — usado só
   pelo restore de scroll do próximo render (ver renderAllNow): a restauração
   por pixel (window.scrollY) quebra quando um alerta/banner acima da lista
   aparece ou some entre um render e outro (a página toda desloca, o pixel
   salvo já não aponta pra mesma linha) — isso é o "volta pro início" ao
   preencher ID/marcar criado. Restaurar pela COLUNA (o torneio que você
   mexeu) em vez de pixel absoluto resolve isso de vez. */
let _lastTouchedKey = null;
let ROLES = {};           // roleKey(op) -> 'mainSat' | 'sideAdmin' | 'sideNoAdmin'
let OVERRIDES = {};       // itemKey -> opName — atribuição manual por evento (clique)
let SEC_OWNERS = {};      // catKey (main/side/sat/liga) -> opName — dono da seção inteira (cobre os sem override)
let SELECTED_OP = null;   // pessoa selecionada p/ atribuir torneios no clique
let MAP = {};             // fieldKey -> rótulo da coluna (mapeamento manual vence a auto-detecção)
let AUDIT = {};           // itemKey -> {status:'erro', motivo, by, at} — marcado pelo Admin
let SEARCH = '';
let CURRENCY = localStorage.getItem('cn_currency') || 'usd';
let FILTER = 'all';
/* tela cheia POR SEÇÃO (Main/Side/Satélite) — só uma por vez, com escolha de
   visão (planilha = tabela atual / colunas = um cartão por torneio, sem
   precisar rolar na horizontal pra ver os campos de todos de uma vez) */
let SEC_FS = null;    // cat.key da seção em tela cheia, ou null
let SEC_VIEW = localStorage.getItem('cn_sec_view') || 'sheet'; // 'sheet' | 'columns'
// campos ocultos na tela cheia (o "olhinho") — persistido, vale pras duas visões
let SEC_HIDDEN = new Set();
try{ SEC_HIDDEN = new Set(JSON.parse(localStorage.getItem('cn_sec_hidden') || '[]')); }catch(e){}

function setSync(state, label){
  const el = $('syncStatus');
  el.className = 'sync-status ' + state;
  el.querySelector('.sync-label').textContent = label;
}
/* Firebase carrega com `defer` — embrulhado numa função chamada no DOMContentLoaded
   (roda depois dos deferred, quando `firebase` já existe). */
function cnInitFirebase(){
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
          // sincroniza a assinatura com o que veio do Firebase: sem isto, o próximo
          // poll deste painel acharia "mudou" e reescreveria /sheet à toa (ver guarda
          // de egress em processGlobalBuffer).
          window._cnLastSig = globalSignature(DATA);
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
  });
  fbDb.ref(`${FB_PATH}/secOwners`).on('value', s => {
    SEC_OWNERS = s.val() || {};
    renderAll();
  });
  fbDb.ref(`${FB_PATH}/fieldMap`).on('value', s => {
    MAP = s.val() || {};
    renderAll();
  });
  // presença ao vivo agora é global e compartilhada (suprema-presence.js) — ver rodapé
  // erros de criação marcados pela auditoria (admin.html → Criação GU)
  fbDb.ref(`${FB_PATH}/audit`).on('value', s => {
    const before = Object.keys(AUDIT).filter(k => AUDIT[k] && AUDIT[k].status === 'erro').length;
    AUDIT = s.val() || {};
    const now = Object.keys(AUDIT).filter(k => AUDIT[k] && AUDIT[k].status === 'erro').length;
    if (now > before) showToast(`⚠ A auditoria marcou ${now - before} erro(s) de criação — veja o alerta no topo.`, true);
    renderAll();
  });
  /* ── RECUPERAÇÃO DE MADRUGADA ABANDONADA ──────────────────────────────────
     Só roda quando esta sessão NÃO tinha 'cn_active_day' salvo (HAD_STORED_DAY
     false) — ou seja, ou é o primeiro acesso mesmo, ou o localStorage se perdeu
     (PC compartilhado, modo anônimo, outro dispositivo) e ACTIVE_ISO acabou de
     ser recalculado do relógio. Nesse caso, o sticky (bloco lá em cima) não teve
     como proteger nada — se havia criação em andamento no dia ANTERIOR e ela
     ainda tem torneio pendente, mostra um jeito explícito de voltar pra lá em
     vez de deixar a operação simplesmente "sumir" (ela nunca foi apagada, só
     ficou noutro caminho do Firebase que ninguém está mais olhando). */
  if (!HAD_STORED_DAY){
    const prevPath = `painel/${PREV_ACTIVE_ISO}/criacaoNoturna`;
    Promise.all([
      fbDb.ref(`${prevPath}/sheet/at`).once('value'),
      fbDb.ref(`${prevPath}/done`).once('value')
    ]).then(([atSnap, doneSnap]) => {
      const at = atSnap.val();
      if (!at) return; // nada foi publicado nesse dia — não é o caso do bug
      const ageH = (Date.now() - at) / 3600000;
      if (ageH < 0 || ageH > 14) return; // fora da janela plausível de um turno — ignora
      const doneCount = Object.keys(doneSnap.val() || {}).length;
      if (!doneCount) return; // sheet publicada mas ninguém marcou nada ainda — nada a recuperar
      if (document.getElementById('cnRecoverBar')) return;
      const bar = document.createElement('div');
      bar.id = 'cnRecoverBar';
      bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:160;background:#e85d5d;color:#fff;padding:9px 10px 9px 16px;border-radius:99px;font-size:12.5px;font-weight:650;box-shadow:var(--shadow-lg);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px)';
      bar.innerHTML = `<span>⚠ Havia criação em andamento em <b>${escHtml(PREV_ACTIVE_ISO)}</b> (${doneCount} marcado${doneCount===1?'':'s'}) que esta aba não estava vendo.</span>`;
      const go = document.createElement('button');
      go.textContent = 'Voltar pra esse dia';
      go.style.cssText = 'background:#fff;color:#a91d1d;border:none;border-radius:99px;padding:6px 13px;font-weight:800;font-size:12px;cursor:pointer;flex:none';
      go.onclick = () => { try{ localStorage.setItem('cn_active_day', PREV_ACTIVE_ISO); }catch(e){} location.reload(); };
      const dismiss = document.createElement('button');
      dismiss.textContent = '✕'; dismiss.title = 'Continuar na madrugada atual';
      dismiss.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-weight:800;font-size:14px;flex:none';
      dismiss.onclick = () => bar.remove();
      bar.append(go, dismiss);
      document.body.appendChild(bar);
    }).catch(()=>{});
  }
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
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', cnInitFirebase); else cnInitFirebase();

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
    processGlobalBuffer(await file.arrayBuffer(), file.name, { manual:true });
  }catch(e){
    console.error(e);
    showToast('Erro ao ler a planilha — confira se é a Global MTT (.xlsx).', true);
  }
  $('dzTitle').textContent = 'Global MTT';
  $('fileInput').value = '';
}

/* =========================================================================
   NÚCLEO DE INGESTÃO — recebe o BINÁRIO .xlsx (upload manual OU fetch do
   Google Sheets publicado) e roda a MESMA extração da aba G MTTS. É o ponto
   que garante "zero diferença por origem": o auto-sync extrai IDÊNTICO ao
   manual, porque é o mesmíssimo readSheetMatrix → findHeaderCols →
   extractGuDaySection → buildSections. Nada de parsing paralelo.
   Retorna {ok, count, unchanged, reason}; quem chamou decide os toasts.
========================================================================= */
/* assinatura só do CONTEÚDO extraído (não do fileName/at/changes): decide se
   vale reescrever o Firebase e disparar todos os painéis. Sem ela, cada poll
   reescreveria /sheet e re-baixaria a grade em todo painel aberto (egress). */
function globalSignature(s){
  try{ return JSON.stringify([s.main, s.side, s.sat, s.unknown]); }
  catch(e){ return 'sig-' + Date.now() + '-' + Math.random(); }
}

function processGlobalBuffer(arrayBuffer, sourceName, opts){
  opts = opts || {};
  // a criação é baseada SÓ na aba da GU (G MTTS) — valores em dólar, receita completa
  const matrix = readSheetMatrix(arrayBuffer, 'G MTTS');
  const headerCols = findHeaderCols(matrix);
  if (!headerCols){
    if (opts.manual) showToast('Não encontrei o cabeçalho da aba G MTTS (MTT MARKETING / TYPE / BUY-IN…) — é a Global MTT certa?', true);
    return { ok:false, reason:'header' };
  }
  const secTom = extractGuDaySection(matrix, WEEKDAY_TOMORROW_EN, headerCols);
  const secAfter = extractGuDaySection(matrix, WEEKDAY_DAYAFTER_EN, headerCols);
  if (!secTom){
    if (opts.manual) showToast(`Não encontrei a seção "${WEEKDAY_TOMORROW_EN}" na aba G MTTS — é a Global MTT certa?`, true);
    return { ok:false, reason:'day' };
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
  // A operação quer TYPE e HORA TAMBÉM como coluna da receita (a imagem lista as duas).
  // O gu-parser as trata como "core" (viram seção e linha Horário) e não põe no `extra`,
  // então re-hidrato AQUI, só na Criação Noturna: acha o rótulo real no cabeçalho, adiciona
  // à lista de campos e escreve o valor de cada torneio no `extra` (TYPE = it.tipo cru;
  // HORA = it.hora). Ficam posicionadas pela CREATION_ORDER (slots TYPE e HORA).
  const typeCol = headerCols.find(c => isTypeLabel(normText(c.label)));
  const horaCol = headerCols.find(c => ['hora','horario','time'].includes(normText(c.label)));
  const typeLabel = typeCol ? typeCol.label : null;
  const horaLabel = horaCol ? horaCol.label : 'HORA';
  if (typeLabel && !fields.includes(typeLabel)) fields.push(typeLabel);
  if (!fields.includes(horaLabel)) fields.push(horaLabel);
  [sections.main, sections.side, sections.sat, sections.unknown].forEach(list => (list || []).forEach(it => {
    it.extra = it.extra || {};
    if (typeLabel && it.tipo != null && it.tipo !== '') it.extra[typeLabel] = it.tipo;
    if (it.hora) it.extra[horaLabel] = it.hora;
  }));
  const total = sections.main.length + sections.side.length + sections.sat.length;

  // guarda de egress: no auto-sync, se o conteúdo extraído é IDÊNTICO ao já
  // carregado, não reescreve o Firebase (senão todo painel recarregaria a grade
  // a cada poll). O manual é ação explícita e sempre grava.
  const sig = globalSignature(sections);
  if (opts.auto && DATA && sig === window._cnLastSig){
    return { ok:true, unchanged:true, count: total };
  }

  // diff contra a versão que já estava carregada (a GU corrige a Global durante a noite):
  // o que mudou fica marcado — e o que JÁ FOI CRIADO com a receita antiga pede revisão.
  // NO AUTO-SYNC, só marca "revisar" DEPOIS que a criação começou (algum torneio em DONE):
  // antes disso o baseline troca em silêncio, pra não inundar de "131 alterações" toda vez
  // que o painel abre contra uma versão antiga sem que ninguém tenha criado nada ainda.
  // O upload manual é ação explícita e sempre mostra o diff.
  const creationStarted = DONE && Object.keys(DONE).length > 0;
  const changes = (opts.auto && !creationStarted) ? [] : computeChanges(DATA, sections);
  if (DATA && changes.length) showToast(`⚠ ${changes.length} alteração(ões) em relação à Global anterior — veja os avisos.`, true);
  window._cnLastSig = sig;
  const by = ME || (opts.auto ? 'Sheets' : 'Alguém');
  DATA = {...sections, fields, warnings, changes, by, at: Date.now(), fileName: sourceName};
  onDataReady(false);

  if (fbDb){
    fbDb.ref(`${FB_PATH}/sheet`).set({
      json: JSON.stringify({main:sections.main, side:sections.side, sat:sections.sat, unknown:sections.unknown, fields, warnings, changes, fileName:sourceName}),
      // count pequeno pra o hub contar sem baixar a grade inteira (economia de banda)
      count: total,
      by, at: firebase.database.ServerValue.TIMESTAMP
    });
  }
  logEvent(opts.auto ? 'sincronizou Global (Sheets)' : 'subiu Global', `${sourceName} — ${total} torneios${changes.length ? ` (${changes.length} alterações)` : ''}`);
  if (opts.manual) showToast(`Global carregada — ${total} torneios de ${WEEKDAY_TOMORROW.toLowerCase()}.`);
  return { ok:true, count: total, changed:true };
}

/* =========================================================================
   AUTO-SYNC COM O GOOGLE SHEETS DA GU
   A Global mora numa planilha publicada na web (aba G MTTS → "Publicar na web"
   como XLSX). Buscamos esse binário e mandamos pro MESMO processGlobalBuffer do
   upload manual — extração idêntica, sem lógica nova. O Firebase continua sendo
   o barramento que espalha pra todos os painéis (o listener /sheet/at já existe).
   Link é público mas expõe SÓ a aba G MTTS (single=true); o resto do doc fica
   privado. Para trocar de planilha sem redeploy: localStorage 'cn_sheet_url'.
   Para desligar o auto-sync: localStorage 'cn_autosync' = '0'.
========================================================================= */
const SHEET_XLSX_URL_DEFAULT = 'https://docs.google.com/spreadsheets/d/1GMcEG3-J1Bg8nDvivHh6yAbVv914eJJA5rDT7DuYXck/pub?gid=1114105684&single=true&output=xlsx';
let SHEET_XLSX_URL = SHEET_XLSX_URL_DEFAULT;
try{ const _u = localStorage.getItem('cn_sheet_url'); if (_u) SHEET_XLSX_URL = _u; }catch(e){}
let AUTO_SYNC = true;
try{ AUTO_SYNC = localStorage.getItem('cn_autosync') !== '0'; }catch(e){}
const SYNC_POLL_MS = 150000;   // ~2,5 min entre leituras (só com a aba visível)
let _syncing = false, _lastSyncAt = 0, _lastSyncOk = false;

function setSyncBusy(b){
  const btn = $('syncNowBtn'); if (!btn) return;
  btn.classList.toggle('busy', b); btn.disabled = b;
}
function updateSyncMeta(){
  const m = $('syncMeta'); if (!m) return;
  if (!AUTO_SYNC){ m.textContent = '⏸ Auto-sync desligado — use o botão pra atualizar.'; m.hidden = false; return; }
  const when = _lastSyncAt ? new Date(_lastSyncAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'}) : null;
  m.textContent = when
    ? `↻ Atualiza sozinho · última leitura da planilha ${when}${_lastSyncOk ? '' : ' — falhou, vou tentar de novo'}`
    : '↻ Atualiza sozinho a cada ~2 min direto da planilha da GU.';
  m.hidden = false;
}

async function syncFromSheets(opts){
  opts = opts || {};
  if (_syncing){ return; }
  if (!SHEET_XLSX_URL){ if (opts.manual) showToast('Sem link do Google Sheets configurado.', true); return; }
  _syncing = true; setSyncBusy(true);
  try{
    await ensureXLSX();
    // cache-buster p/ o cache DO NAVEGADOR (o cache do "Publicar na web" é do Google e não dá pra furar)
    const url = SHEET_XLSX_URL + (SHEET_XLSX_URL.indexOf('?') >= 0 ? '&' : '?') + '_cn=' + Date.now();
    const resp = await fetch(url, { cache:'no-store', redirect:'follow' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    const r = processGlobalBuffer(buf, 'Google Sheets (auto)', { auto:true, manual: !!opts.manual });
    _lastSyncAt = Date.now(); _lastSyncOk = !!(r && r.ok);
    if (opts.manual){
      if (!r.ok){
        showToast(r.reason === 'header' ? 'A planilha veio, mas não achei o cabeçalho da aba G MTTS — confira o link/gid.'
          : r.reason === 'day' ? `Planilha ok, mas sem a seção "${WEEKDAY_TOMORROW_EN}" na G MTTS.`
          : 'Não consegui ler a planilha.', true);
      } else if (r.unchanged){
        showToast('Já está na versão mais recente da planilha.');
      } else {
        showToast(`Sincronizado com o Google Sheets — ${r.count} torneios de ${WEEKDAY_TOMORROW.toLowerCase()}.`);
      }
    }
  }catch(e){
    console.error('syncFromSheets', e);
    _lastSyncOk = false;
    if (opts.manual) showToast('Não consegui buscar a planilha (sem internet, ou o "Publicar na web" saiu do ar?).', true);
  }finally{
    _syncing = false; setSyncBusy(false); updateSyncMeta();
  }
}

/* poll com jitter (dessincroniza painéis p/ não gravarem juntos) e só com a aba
   visível — aba escondida não consome banda nem bate no Google à toa. */
function scheduleAutoSync(){
  clearTimeout(window._cnPollT);
  if (!AUTO_SYNC) return;
  const jitter = Math.floor(Math.random() * 30000);
  window._cnPollT = setTimeout(() => {
    if (AUTO_SYNC && document.visibilityState === 'visible') syncFromSheets({});
    scheduleAutoSync();
  }, SYNC_POLL_MS + jitter);
}
document.addEventListener('visibilitychange', () => {
  if (AUTO_SYNC && document.visibilityState === 'visible' && Date.now() - _lastSyncAt > 60000) syncFromSheets({});
});

function initSheetSync(){
  const btn = $('syncNowBtn');
  if (btn) btn.addEventListener('click', () => syncFromSheets({ manual:true }));
  updateSyncMeta();
  /* CORRIDA DE AUTH: gravar /sheet exige sessão do Firebase Auth (regras deny-by-default),
     e a restauração da sessão é ASSÍNCRONA. Se a 1ª leitura da planilha rodasse antes
     disso, a escrita seria NEGADA em silêncio — e a guarda de egress (_cnLastSig) travaria
     nova tentativa até o conteúdo mudar, deixando o Firebase sem a grade. Então o auto-sync
     só começa com a auth viva (mesmo cuidado do attachCN dos listeners). O botão manual
     continua livre pra usar a qualquer momento. */
  const startAuto = () => {
    if (window._cnAutoStarted) return; window._cnAutoStarted = true;
    setTimeout(() => { if (AUTO_SYNC) syncFromSheets({}); }, 1200);   // fora do caminho crítico de render
    scheduleAutoSync();
  };
  try{
    if (firebase.auth().currentUser) startAuto();
    else firebase.auth().onAuthStateChanged(u => { if (u) startAuto(); });
  }catch(e){
    startAuto();   // sem Firebase (modo local): lê a planilha e renderiza local, sem gravar
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSheetSync); else initSheetSync();

/* =========================================================================
   DIVISÃO IGUAL — determinística: mesma ordem de equipe + mesma planilha
   ⇒ mesma divisão em qualquer navegador (sem sorteio, sem gravação extra).
   Main e Side: round-robin cronológico. Satélite: grupos inteiros (a receita
   de um grupo é encadeada), sempre pro operador com menos satélites até ali.
========================================================================= */
function itemKey(it){
  return `${normText(it.nome)}|${it.hora}`.replace(/[.#$\[\]\/]/g,'_');
}
/* DIVISÃO 100% MANUAL (por clique) — as funções fixas (Main+Sat / Side c-s Admin) e o
   round-robin automático foram removidos a pedido. Cada torneio pertence a quem foi
   atribuído no clique (OVERRIDES), desde que a pessoa siga na equipe. */
function computeAssignments(){
  const asg = {};
  if (!DATA) return asg;
  Object.keys(OVERRIDES).forEach(k => { if (OPS.includes(OVERRIDES[k])) asg[k] = OVERRIDES[k]; });
  return asg;
}
/* DONO DA SEÇÃO — cobre os torneios da seção que NÃO têm dono por evento (override).
   Devolve um asg derivado: override do evento vence; senão, o dono da seção (se ainda
   está na equipe). Usado por seção no render, e por myOp/myPending pra "meus torneios". */
function withSecOwner(baseAsg, items, catKey){
  const owner = SEC_OWNERS[catKey];
  if (!owner || !OPS.includes(owner)) return baseAsg;
  const m = {...baseAsg};
  (items || []).forEach(it => { const k = itemKey(it); if (!m[k]) m[k] = owner; });
  return m;
}
/* asg efetivo do DIA inteiro (todas as seções + Liga), já com dono de seção aplicado —
   é o que "meus torneios" e o handoff enxergam. */
function effectiveAssignments(){
  let asg = computeAssignments();
  SECTIONS.forEach(cat => { asg = withSecOwner(asg, catItems(cat), cat.key); });
  if (typeof LIGA_PRINCIPAL_SECTIONS !== 'undefined'){
    const lp = LIGA_PRINCIPAL_SECTIONS[WEEKDAY_TOMORROW_EN];
    if (lp) asg = withSecOwner(asg, [...(lp.main||[]), ...(lp.side||[]), ...(lp.sat||[])], 'liga');
  }
  return asg;
}
/* define/limpa o dono de uma seção inteira e persiste (mesmo trilho do overrides) */
function setSecOwner(catKey, op){
  if (op) SEC_OWNERS[catKey] = op; else delete SEC_OWNERS[catKey];
  if (fbDb) fbDb.ref(`${FB_PATH}/secOwners`).set(SEC_OWNERS); else renderAll();
  logEvent('dono da seção', `${catKey} → ${op || '(livre)'}`);
}
/* chip no cabeçalho da seção: mostra/define o dono da seção inteira (popover da equipe) */
function secOwnerChipHtml(catKey){
  const owner = SEC_OWNERS[catKey];
  const valid = owner && OPS.includes(owner);
  const label = valid ? escHtml(owner.split(' ')[0]) : 'Dono da seção';
  return `<button class="sec-owner-chip${valid ? ' set' : ''}" data-secowner="${escHtml(catKey)}" title="${valid ? `Seção de ${escHtml(owner)} — clique pra trocar/limpar` : 'Definir um responsável pela seção inteira'}">`
    + `<span class="so-ic">👤</span>${label}</button>`;
}
/* abre o popover pra escolher (ou limpar) o dono da seção */
function openSecOwnerMenu(anchor, catKey){
  if (!OPS.length){ showToast('Ninguém na equipe ainda — adicione operadores primeiro.', true); return; }
  const opts = OPS.map(o => ({ label: o, color: opColor(o), initial: o.trim()[0].toUpperCase(), onPick: () => setSecOwner(catKey, o) }));
  if (SEC_OWNERS[catKey]) opts.push({ label:'✕ Limpar dono da seção', color:'var(--ink-soft)', initial:'✕', onPick: () => setSecOwner(catKey, null) });
  openPickMenu(anchor, 'Dono da seção inteira:', opts);
}
/* atribui/tira um torneio do operador SELECIONADO (clique na célula) e persiste. */
function setAssign(key){
  if (!SELECTED_OP){ showToast('Selecione uma pessoa na equipe primeiro — depois clique nos torneios.', true); return; }
  if (OVERRIDES[key] === SELECTED_OP) delete OVERRIDES[key];   // clicar de novo tira
  else OVERRIDES[key] = SELECTED_OP;
  if (fbDb) fbDb.ref(`${FB_PATH}/overrides`).set(OVERRIDES);   // o listener re-renderiza
  else renderAll();
  logEvent('atribuição', `${key} → ${OVERRIDES[key] || '(livre)'}`);
}
function persistOverrides(){ if (fbDb) fbDb.ref(`${FB_PATH}/overrides`).set(OVERRIDES); else renderAll(); }
/* atribui/transfere UM evento a um operador explícito (ou limpa, com op=null) e persiste */
function setAssignTo(key, op){
  if (op) OVERRIDES[key] = op; else delete OVERRIDES[key];
  if (fbDb) fbDb.ref(`${FB_PATH}/overrides`).set(OVERRIDES); else renderAll();
  logEvent('atribuição', `${key} → ${op || '(livre)'}`);
}
/* garante que EU estou na equipe (pra "pegar pra mim" funcionar mesmo sem me adicionar antes) */
function ensureMeInOps(){
  const meIn = OPS.find(o => normText(o) === normText(ME));
  if (meIn) return meIn;
  if (ME){ saveOps([...OPS, ME]); return ME; }
  return null;
}
/* menu por evento: PEGAR PRA MIM, TRANSFERIR PARA <operador>, TIRAR dono */
function openAssignMenu(anchor, key){
  const cur = OVERRIDES[key];
  const opts = [];
  if (ME) opts.push({ label:'🙋 Pegar pra mim', color: opColor(ME), initial:(ME.trim()[0] || '?').toUpperCase(),
    onPick: () => { const me = ensureMeInOps(); if (me) setAssignTo(key, me); } });
  OPS.filter(o => normText(o) !== normText(ME)).forEach(o => opts.push({
    label:`Transferir para ${o.split(' ')[0]}`, color: opColor(o), initial:o.trim()[0].toUpperCase(),
    onPick: () => setAssignTo(key, o) }));
  if (cur) opts.push({ label:'✕ Tirar dono (deixar livre)', color:'var(--ink-soft)', initial:'✕', onPick: () => setAssignTo(key, null) });
  if (!opts.length){ showToast('Adicione operadores na equipe primeiro.', true); return; }
  openPickMenu(anchor, cur ? `Dono: ${cur.split(' ')[0]} — passar para:` : 'Atribuir este evento a:', opts);
}
/* clique no operador de um evento: com pessoa selecionada na equipe = atribuição rápida
   (fluxo antigo, bom pra vários seguidos); SEM seleção = abre o menu pegar/transferir. */
function onAssignClick(el){
  const key = el.dataset.assign;
  if (SELECTED_OP) setAssign(key);
  else openAssignMenu(el, key);
}
/* todos os torneios atribuíveis do dia (GU + Liga Principal) */
function assignableItems(){
  if (!DATA) return [];
  const arr = [...(DATA.main||[]), ...(DATA.side||[]), ...(DATA.sat||[])];
  if (typeof LIGA_PRINCIPAL_SECTIONS !== 'undefined'){
    const lp = LIGA_PRINCIPAL_SECTIONS[WEEKDAY_TOMORROW_EN];
    if (lp) arr.push(...(lp.main||[]), ...(lp.side||[]), ...(lp.sat||[]));
  }
  return arr;
}
/* "Pegar livres" — a pessoa selecionada pega TODOS os torneios sem dono de uma vez */
function claimUnassigned(){
  if (!SELECTED_OP){ showToast('Selecione uma pessoa na equipe primeiro.', true); return; }
  const asg = computeAssignments(); let n = 0;
  assignableItems().forEach(it => { const k = itemKey(it); if (!asg[k]){ OVERRIDES[k] = SELECTED_OP; n++; } });
  if (!n){ showToast('Nenhum torneio livre no momento.'); return; }
  persistOverrides(); logEvent('pegou livres', `${SELECTED_OP} +${n}`);
  showToast(`${n} torneio(s) livre(s) → ${SELECTED_OP.split(' ')[0]}.`);
}
/* "Pegar atrasados" — a pessoa selecionada pega os que estão estourando o prazo (urgência) e ainda não criados */
function claimLate(){
  if (!SELECTED_OP){ showToast('Selecione uma pessoa na equipe primeiro.', true); return; }
  let n = 0;
  assignableItems().forEach(it => { const k = itemKey(it); if (urgency(it) && !DONE[k]){ OVERRIDES[k] = SELECTED_OP; n++; } });
  if (!n){ showToast('Nenhum torneio atrasado agora. 👍'); return; }
  persistOverrides(); logEvent('pegou atrasados', `${SELECTED_OP} +${n}`);
  showToast(`${n} atrasado(s) → ${SELECTED_OP.split(' ')[0]}.`);
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

/* =========================================================================
   VISÃO DA SEMANA (read-only) — os 7 dias da planilha a partir do dia ativo.
   Derivada da última matriz sincronizada (window._cnMatrix), não toca na
   operação da noite (divisão/done/ids/TV): é só pra enxergar o que vem.
========================================================================= */
window.VIEW = 'day';
function setView(v){
  window.VIEW = v;
  const seg = $('viewSeg');
  if (seg) seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const week = v === 'week';
  const wa = $('weekArea'); if (wa) wa.hidden = !week;   // null-safe: sobrevive se o HTML da semana faltar
  $('listArea').hidden = week;
  // some com os controles/ações da operação na visão da semana (ela é só leitura)
  $('controlsCard').hidden = week || !DATA;
  $('actionsBar').hidden = week || !DATA;
  const hint = $('viewHint');
  if (hint) hint.textContent = week
    ? 'Selecione um dia pra ver os torneios daquela madrugada e quem preencheu cada ID do Pokerbyte. Só leitura — a marcação/divisão continua na aba Noite.'
    : `Janela 06:10 → 05:30 · divisão e marcação da madrugada de ${WEEKDAY_TOMORROW.toLowerCase()}.`;
  if (week) renderWeek();
}

/* SELETOR DE DIA + HISTÓRICO — a semana são os 7 dias TERMINANDO no dia ativo (a
   janela de criação que já rodou/está rodando). Cada dia lê o SEU nó do Firebase
   (painel/{data}/criacaoNoturna: sheet + ids + done), então o "quem preencheu o ID
   do Pokerbyte" é o histórico real daquela madrugada. O dia ativo usa os globais
   ao vivo (DATA/IDS/DONE). É só leitura — a edição continua na aba Noite. */
let _weekSel = null;               // ISO do dia selecionado
const _weekCache = {};             // ISO -> {sections, ids, done, by} (dias passados; o ativo é sempre ao vivo)

function weekDaysList(){
  const out = [];
  for (let i = 6; i >= 0; i--){
    const ref = new Date(TURNO.refTomorrow.getTime() - i * 86400000);
    out.push({ iso: refToISO(ref), dow: ref.getUTCDay(), ref });
  }
  return out;   // cronológico, terminando no dia ativo
}

function renderWeek(){
  const area = $('weekArea');
  if (!area) return;
  const days = weekDaysList();
  if (!_weekSel || !days.some(d => d.iso === _weekSel)) _weekSel = TOMORROW_ISO;   // default: dia ativo
  const btns = days.map(d => {
    const pt = WEEKDAYS_PT[d.dow].split('-')[0];
    const isActive = d.iso === TOMORROW_ISO;
    return `<button class="wk-day-btn${d.iso === _weekSel ? ' on' : ''}" data-wkiso="${d.iso}" title="${escHtml(WEEKDAYS_PT[d.dow])} ${refToLabel(d.ref)}${isActive ? ' — em criação' : ''}">
      <span class="wd">${escHtml(pt)}</span><span class="dt">${refToLabel(d.ref)}</span>${isActive ? '<span class="wk-live">•</span>' : ''}</button>`;
  }).join('');
  area.innerHTML = `<div class="wk-days">${btns}</div><div class="wk-detail" id="wkDetail"><div class="wk-empty">Carregando…</div></div>`;
  area.querySelectorAll('.wk-day-btn').forEach(b => b.addEventListener('click', () => {
    _weekSel = b.dataset.wkiso;
    area.querySelectorAll('.wk-day-btn').forEach(x => x.classList.toggle('on', x.dataset.wkiso === _weekSel));
    loadWeekDay(_weekSel);
  }));
  loadWeekDay(_weekSel);
}

async function loadWeekDay(iso){
  const host = () => document.getElementById('wkDetail');
  // dia ativo: usa os globais ao vivo (reflete quem está preenchendo ID agora)
  if (iso === TOMORROW_ISO && DATA){
    renderWeekDetail(iso, { sections:{main:DATA.main||[], side:DATA.side||[], sat:DATA.sat||[], unknown:DATA.unknown||[]}, fields:DATA.fields, ids:IDS||{}, done:DONE||{}, by:DATA.by });
    return;
  }
  if (_weekCache[iso]){ renderWeekDetail(iso, _weekCache[iso]); return; }
  if (!fbDb){ if (host()) host().innerHTML = `<div class="wk-empty">Sem conexão pra carregar o histórico deste dia.</div>`; return; }
  try{
    const base = `painel/${iso}/criacaoNoturna`;
    const [sSnap, iSnap, dSnap] = await Promise.all([
      fbDb.ref(`${base}/sheet`).once('value'),
      fbDb.ref(`${base}/ids`).once('value'),
      fbDb.ref(`${base}/done`).once('value')
    ]);
    const sv = sSnap.val();
    let sections = null, fields = null;
    if (sv && sv.json){ try{ const j = JSON.parse(sv.json); sections = {main:j.main||[], side:j.side||[], sat:j.sat||[], unknown:j.unknown||[]}; fields = j.fields || null; }catch(e){} }
    const data = _weekCache[iso] = { sections, fields, ids: iSnap.val() || {}, done: dSnap.val() || {}, by: sv ? sv.by : null };
    if (iso === _weekSel) renderWeekDetail(iso, data);   // só pinta se o usuário ainda está neste dia
  }catch(e){
    if (host()) host().innerHTML = `<div class="wk-empty">Erro ao carregar o histórico: ${escHtml(e.message || e)}</div>`;
  }
}

/* receita em PLANILHA (transposta): um torneio, campos nas linhas — pro clique na aba
   Semana. Difere do specSheetHtml (cards): aqui é tabela, no formato da operação. */
function recipeSheetHtml(it, fields){
  if (!it) return '';
  const rowsFromFields = ((fields && fields.length) ? fields : Object.keys(it.extra || {}))
    .filter(l => typeof isCoreLabel === 'function' ? !isCoreLabel(l) : true)
    .map(l => {
      const v = it.extra ? it.extra[l] : undefined;
      const has = v !== undefined && v !== null && v !== '';
      return `<tr><th>${escHtml(l)}</th><td>${has ? escHtml(fmtExtraVal(l, v)) : '<span class="rs-dash">—</span>'}</td></tr>`;
    }).join('');
  return `<table class="rs-table">
    <tr><th>Horário</th><td>${escHtml(it.hora || '—')}</td></tr>
    <tr><th>Buy-in</th><td>${fmtMoney(it.buyin)}</td></tr>
    <tr><th>Prize Pool</th><td>${fmtMoney(it.garantido)}</td></tr>
    ${rowsFromFields}
  </table>`;
}

function renderWeekDetail(iso, data){
  const el = document.getElementById('wkDetail');
  if (!el) return;
  if (!data.sections){
    el.innerHTML = `<div class="wk-empty"><span class="moon">🌙</span>Nenhuma grade foi criada neste dia${iso === TOMORROW_ISO ? ' ainda — suba/sincronize a Global na aba Noite' : ''}.</div>`;
    return;
  }
  const items = [
    ...data.sections.main.map(x => ({...x, cat:'main'})),
    ...data.sections.side.map(x => ({...x, cat:'side'})),
    ...data.sections.sat.map(x => ({...x, cat:'sat'}))
  ].sort((a,b) => (timeToMinutes(a.hora) ?? 9999) - (timeToMinutes(b.hora) ?? 9999));
  const withId = items.filter(it => { const r = data.ids[itemKey(it)]; return r && r.val; }).length;
  // guarda os itens + campos do dia pra montar a RECEITA (planilha) sob demanda no clique
  const wi = window._weekItems = {};
  window._weekFields = data.fields || null;
  // uma linha da tabela (mesmo markup de antes) — reusada por cada grupo
  const rowHtml = it => {
    const k = itemKey(it);
    wi[k] = it;
    const idRec = data.ids[k], doneRec = data.done[k];
    const idTxt = idRec && idRec.val ? escHtml(idRec.val) : '<span class="wk-noid">— sem ID</span>';
    const by = (idRec && idRec.by) || (doneRec && doneRec.by) || '';
    const at = idRec && idRec.at ? new Date(idRec.at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'}) : '';
    return `<div class="wk-rowwrap">
      <div class="wk-row wk-${it.cat}${idRec && idRec.val ? ' has-id' : ''}" data-wkkey="${escHtml(k)}" role="button" tabindex="0" title="Ver a receita seguida">
        <span class="wk-time">${escHtml(it.hora || '—')}</span>
        <span class="wk-name">${escHtml(it.nome)} <span class="wk-exp">receita ▾</span></span>
        <span class="wk-id">${idTxt}</span>
        <span class="wk-by">${by ? escHtml(by) + (at ? ` · ${at}` : '') : ''}</span>
      </div>
      <div class="wk-recipe" hidden></div>
    </div>`;
  };
  // ── agrupa a tabela do dia em Main Event / Side Event / Satélite (nesta ordem),
  //    com o horário ordenado DENTRO de cada grupo. Grupo vazio não aparece. ──
  const GROUPS = [
    {cat:'main', suit:'♠', label:'Main Events'},
    {cat:'side', suit:'♥', label:'Side Events'},
    {cat:'sat',  suit:'♣', label:'Satélites'},
  ];
  const rows = GROUPS.map(g => {
    const list = items.filter(it => it.cat === g.cat);
    if (!list.length) return '';
    return `<div class="wk-group wk-group-${g.cat}"><span class="wk-group-suit">${g.suit}</span>${g.label}<span class="wk-group-count">${list.length}</span></div>`
         + list.map(rowHtml).join('');
  }).join('');
  el.innerHTML = `
    <div class="wk-detail-head">
      <div class="wk-sum"><b>${items.length}</b> torneios · <b>${withId}</b> com ID Pokerbyte${iso === TOMORROW_ISO ? ' <span class="wk-live-tag">ao vivo</span>' : ''}</div>
      ${data.by ? `<div class="wk-src">grade por ${escHtml(data.by)}</div>` : ''}
    </div>
    <div class="wk-rows-head"><span>Horário</span><span>Torneio</span><span>ID Pokerbyte</span><span>Preencheu</span></div>
    <div class="wk-rows">${rows || '<div class="wk-empty">Sem torneios neste dia.</div>'}</div>`;
  // clique/enter na linha → abre a RECEITA que foi seguida (a mesma ficha da aba Noite)
  el.querySelectorAll('.wk-row[data-wkkey]').forEach(row => {
    const toggle = () => {
      const wrap = row.closest('.wk-rowwrap'), rec = wrap && wrap.querySelector('.wk-recipe');
      if (!rec) return;
      if (rec.hidden){
        if (!rec.dataset.built){
          const it = window._weekItems[row.dataset.wkkey];
          rec.innerHTML = (it && typeof recipeSheetHtml === 'function' ? recipeSheetHtml(it, window._weekFields) : '') || '<div class="wk-norecipe">Sem detalhes de receita para este torneio.</div>';
          rec.dataset.built = '1';
        }
        rec.hidden = false; row.classList.add('open');
      } else { rec.hidden = true; row.classList.remove('open'); }
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const seg = $('viewSeg');
  if (seg) seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
});

function onDataReady(fromRemote){
  $('controlsCard').hidden = false;
  $('actionsBar').hidden = false;
  const vs = $('viewSwitch'); if (vs) vs.hidden = false;   // null-safe: não trava o render se o seletor faltar
  const meta = $('uploadMeta');
  meta.hidden = false;
  const when = DATA.at ? new Date(DATA.at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'}) : '';
  meta.innerHTML = `
    <span class="pill ok">✓ ${escHtml(DATA.fileName || 'Global MTT')}</span>
    <span class="pill">por ${escHtml(DATA.by || '—')}${when ? ' às ' + when : ''}</span>
    <span class="pill gold">${WEEKDAY_TOMORROW.toLowerCase()} · janela 06:10 → 05:30</span>`;
  renderAll();
  setView(window.VIEW);   // mantém a visão atual (dia/semana) coerente quando a grade chega/atualiza
}

function renderAllNow(){
  // PRESERVAR SCROLL — captura ANTES de qualquer re-render (marcar criado/ID re-renderiza
  // tudo via listener do Firebase; se não guardar aqui, a página pula pro topo). Restaura a
  // rolagem da JANELA + a de cada tabela (por naipe) depois do rebuild — síncrono e no rAF
  // pra vencer o clamp/scroll-anchor do navegador. Fim do "volta pro começo ao concluir".
  const winY = window.scrollY;
  const secScroll = {};
  document.querySelectorAll('#listArea .secwrap').forEach(sw => {
    const vw = sw.querySelector('.vwrap');
    if (vw) secScroll[sw.dataset.suit] = { t: vw.scrollTop, l: vw.scrollLeft };
  });
  renderOps();
  renderFilters();
  renderAlerts();
  renderStats();
  renderFieldDiag();
  renderList();
  renderTV();
  renderSecFs();
  const restoreScroll = () => {
    document.querySelectorAll('#listArea .secwrap').forEach(sw => {
      const p = secScroll[sw.dataset.suit]; if (!p) return;
      const vw = sw.querySelector('.vwrap');
      if (vw){ vw.scrollTop = p.t; vw.scrollLeft = p.l; }
    });
    window.scrollTo(0, winY);
    // restauração por pixel quebra se um alerta/banner acima da lista mudou de
    // altura entre um render e outro (a página desloca inteira e o pixel salvo
    // não aponta mais pra mesma linha) — a coluna do torneio que você ACABOU de
    // mexer (ID digitado / criado marcado) é uma âncora que não depende de pixel
    // nenhum, então tem a palavra final por cima da restauração acima.
    if (_lastTouchedKey){
      const esc = k => (window.CSS && CSS.escape) ? CSS.escape(k) : k;
      const anchor = document.querySelector(`#listArea [data-idkey="${esc(_lastTouchedKey)}"], #listArea [data-done="${esc(_lastTouchedKey)}"]`);
      if (anchor) anchor.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }
  };
  restoreScroll();
  requestAnimationFrame(() => { restoreScroll(); _lastTouchedKey = null; });
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
  /* o fundo acompanha o turno — renderTV já roda a cada sync, então o Feltro
     recebe o estado novo junto com o texto, sem timer próprio */
  tvDriveFeltro(pct, all);
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
/* ═══════════════ O FELTRO no modo TV (mesmo fundo WebGL da Suprema TV) ═══════
   O que faz a TV parecer transmissão não é "ter WebGL" — é o fundo CARREGAR
   ESTADO. Lá as entradas são a categoria da cena, o ao-vivo e o corte. Aqui o
   estado é OUTRO: o turno da noite tem prazo. Então o mapeamento é:

     accent  a cor do turno. Verde-feltro enquanto tudo corre no prazo; vira
             âmbar quando aparece atraso; dourado quando fecha em 100%.
     heat    a PRESSÃO do turno: fração de torneios que já estão atrasados ou
             na janela de risco. A sala esquenta quando a noite aperta — é a
             leitura periférica que o supervisor pega de longe, sem ler número.
     pulse   cada torneio marcado como criado. É o "corte" da transmissão.
     boom    fechou tudo. A celebração do turno.

   O Feltro só sobe com o telão aberto: WebGL rodando atrás de um overlay
   fechado seria queimar GPU 24h à toa. ── */
let TV_FELTRO = null;
let _tvPctAnterior = null;

function tvMountFeltro(){
  if (TV_FELTRO) return;
  /* o script é `defer` e pode não ter chegado; em modo lite o mount devolve
     null de propósito. Nos dois casos fica o #090c0a do CSS, que é fundo
     legítimo — não é degradação visível. */
  if (typeof SupremaFeltro === 'undefined') return;
  TV_FELTRO = SupremaFeltro.mount('#tvOverlay .tv-bg', {
    bg:'#090c0a', gold:'#c9a84c', felt:'#22d47e',
    onFallback(){ TV_FELTRO = null; },   // shader não compilou: fundo chapado
  });
}
function tvUnmountFeltro(){
  try{ if (TV_FELTRO) TV_FELTRO.destroy(); }catch(e){}
  TV_FELTRO = null;
  _tvPctAnterior = null;
}

/* traduz o estado do turno nas quatro entradas do fundo */
function tvDriveFeltro(pct, all){
  if (!TV_FELTRO) return;
  const pendentes = all.filter(it => !DONE[itemKey(it)]);
  const atrasados = pendentes.filter(it => urgency(it) === 'late').length;
  const emRisco   = pendentes.filter(it => urgency(it) === 'warn').length;

  /* heat: atraso pesa o dobro do risco. Normaliza pelo total pendente pra não
     depender do tamanho da grade — 3 atrasados em 5 é pânico, em 80 não é. */
  const base = pendentes.length || 1;
  TV_FELTRO.heat(Math.min(1, (atrasados * 2 + emRisco) / base));

  TV_FELTRO.accent(pct >= 100 ? '#c9a84c' : atrasados ? '#e0a33c' : '#22d47e');

  /* pulse a cada torneio novo criado; boom só na virada pro 100% (não a cada
     re-render, senão o telão explode em loop enquanto ninguém mexe) */
  if (_tvPctAnterior !== null && pct > _tvPctAnterior){
    if (pct >= 100 && _tvPctAnterior < 100) TV_FELTRO.boom();
    else TV_FELTRO.pulse();
  }
  _tvPctAnterior = pct;
}

function openTV(){
  if (!DATA){ showToast('Carregue a Global primeiro.', true); return; }
  TV_OPEN = true; $('tvOverlay').classList.add('open');
  tvMountFeltro();
  renderTV(); a11yOpenDialog('tvOverlay');
}
function closeTV(){
  TV_OPEN = false; $('tvOverlay').classList.remove('open');
  tvUnmountFeltro();
  a11yCloseDialog('tvOverlay');
}
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
  const asg = computeAssignments();
  // contagem no chip da equipe inclui o dono da seção (não só override por evento)
  const effAsg = effectiveAssignments();
  const cnt = {}; OPS.forEach(o => cnt[o] = 0); Object.values(effAsg).forEach(o => { if (o in cnt) cnt[o]++; });
  let html = OPS.map(o => {
    const sel = SELECTED_OP && normText(SELECTED_OP) === normText(o);
    return `
    <button class="op-chip${sel ? ' sel' : ''}" data-selop="${escHtml(o)}" style="--opc:${opColor(o)}"
      title="${sel ? `Selecionado — clique nos torneios pra atribuir a ${escHtml(o)} (clique aqui de novo pra soltar)` : `Selecionar ${escHtml(o)} e atribuir torneios no clique`}">
      <span class="avatar" style="background:${opColor(o)}">${escHtml(o.trim()[0].toUpperCase())}</span>
      ${escHtml(o)}
      <span class="op-cnt" title="torneios atribuídos">${cnt[o] || 0}</span>
      <span class="rm" data-op="${escHtml(o)}" title="Remover do turno" role="button" aria-label="Remover ${escHtml(o)}">×</span>
    </button>`;
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
  row.querySelectorAll('.rm').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); saveOps(OPS.filter(o => o !== b.dataset.op)); }));
  row.querySelectorAll('[data-selop]').forEach(b => b.addEventListener('click', () => {
    const o = b.dataset.selop;
    SELECTED_OP = (SELECTED_OP && normText(SELECTED_OP) === normText(o)) ? null : o;   // clicar de novo solta
    renderAll();
  }));
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
  renderDivTools(asg);
}
/* medidor de equilíbrio (carga por pessoa) + ações rápidas: "Pegar livres" e "Pegar atrasados" */
function renderDivTools(asg){
  const el = $('divTools');
  if (!el) return;
  if (!DATA || !OPS.length){ el.innerHTML = ''; return; }
  asg = asg || computeAssignments();
  const cnt = {}; OPS.forEach(o => cnt[o] = 0);
  let free = 0, late = 0;
  assignableItems().forEach(it => {
    const k = itemKey(it), o = asg[k];
    if (o && (o in cnt)) cnt[o]++; else if (!o) free++;
    if (urgency(it) && !DONE[k]) late++;
  });
  const max = Math.max(1, ...OPS.map(o => cnt[o]));
  const avg = OPS.length ? OPS.reduce((s,o)=>s+cnt[o],0) / OPS.length : 0;
  const bars = OPS.map(o => {
    const over = cnt[o] > avg * 1.4 && cnt[o] - avg >= 2;   // sinaliza sobrecarga
    return `<div class="bal-row"${over ? ' title="Sobrecarregado"' : ''}>
      <span class="bal-name" style="color:${opColor(o)}">${escHtml(o.split(' ')[0])}${over ? ' ⚠' : ''}</span>
      <span class="bal-bar"><span class="bal-fill" style="width:${Math.round(cnt[o]/max*100)}%;background:${opColor(o)}"></span></span>
      <span class="bal-n">${cnt[o]}</span>
    </div>`;
  }).join('');
  const who = SELECTED_OP ? escHtml(SELECTED_OP.split(' ')[0]) : '';
  el.innerHTML = `
    <div class="bal-meter">${bars}</div>
    <div class="div-actions">
      <button class="btn ghost divbtn" id="claimFreeBtn"${SELECTED_OP && free ? '' : ' disabled'} title="${SELECTED_OP ? '' : 'Selecione uma pessoa primeiro'}">⬇ ${who ? who + ' pega' : 'Pegar'} os livres (${free})</button>
      <button class="btn ghost divbtn" id="claimLateBtn"${SELECTED_OP && late ? '' : ' disabled'} title="${SELECTED_OP ? '' : 'Selecione uma pessoa primeiro'}">⏰ Pegar atrasados (${late})</button>
      ${!SELECTED_OP ? '<span class="div-hint">Selecione alguém na equipe pra usar</span>' : ''}
    </div>`;
  const cf = $('claimFreeBtn'); if (cf) cf.addEventListener('click', claimUnassigned);
  const cl = $('claimLateBtn'); if (cl) cl.addEventListener('click', claimLate);
}
function saveOps(list){
  OPS = list;
  if (FILTER !== 'all' && !OPS.includes(FILTER)) FILTER = 'all';
  if (fbDb) fbDb.ref(`${FB_PATH}/ops`).set(list);
  else renderAll();
}

function renderFilters(){
  // status/dono mais claro: contagem por pessoa agora inclui o DONO DA SEÇÃO, não só o
  // override por evento — e mostra "pendentes" (ainda não criados) além do total atribuído.
  const asg = effectiveAssignments();
  const counts = {}, pend = {};
  OPS.forEach(o => { counts[o] = 0; pend[o] = 0; });
  if (DATA) allWithCat().forEach(({it}) => {
    const o = asg[itemKey(it)];
    if (o in counts){ counts[o]++; if (!DONE[itemKey(it)]) pend[o]++; }
  });
  const total = DATA ? DATA.main.length + DATA.side.length + DATA.sat.length + ligaItemsForDay().length : 0;
  const cntBadge = o => `<span class="cnt" title="${counts[o]||0} atribuído(s) · ${pend[o]||0} pendente(s)">${pend[o]||0}/${counts[o] || 0}</span>`;
  let html = `<button class="fchip ${FILTER==='all'?'on':''}" data-f="all">Todos <span class="cnt">${total}</span></button>`;
  // atalho destacado: "Meus torneios" (só quando você está na equipe) — vai direto pro seu filtro
  const meOp = OPS.find(o => normText(o) === normText(ME));
  if (meOp) html += `<button class="fchip me ${FILTER===meOp?'on':''}" data-f="${escHtml(meOp)}" title="Ver só os torneios atribuídos a você (por evento ou como dono da seção)">🙋 Meus torneios ${cntBadge(meOp)}</button>`;
  html += OPS.map(o => `
    <button class="fchip ${FILTER===o?'on':''}" data-f="${escHtml(o)}">
      ${escHtml(o)}${normText(o)===normText(ME) ? ' (você)' : ''} ${cntBadge(o)}
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
  // REDE DE SEGURANÇA DO ID — se a GU renomear/mudar o horário de um torneio, a chave
  // (nome|hora) muda e o ID gravado ficaria "órfão" (some da linha). Aqui ele NÃO se perde:
  // é detectado e avisado (segue salvo no Firebase). Assim nenhum ID some em silêncio.
  if (DATA && IDS){
    const validKeys = new Set([...(DATA.main||[]), ...(DATA.side||[]), ...(DATA.sat||[]), ...(DATA.unknown||[])].map(itemKey));
    if (typeof LIGA_PRINCIPAL_SECTIONS !== 'undefined'){
      const lp = LIGA_PRINCIPAL_SECTIONS[WEEKDAY_TOMORROW_EN];
      if (lp) [...(lp.main||[]), ...(lp.side||[]), ...(lp.sat||[])].forEach(it => validKeys.add(itemKey(it)));
    }
    const orphans = Object.keys(IDS).filter(k => IDS[k] && IDS[k].val && !validKeys.has(k));
    if (orphans.length){
      const lines = orphans.slice(0, 12).map(k => `<b>${escHtml(IDS[k].val)}</b>${IDS[k].by ? ' · por ' + escHtml(IDS[k].by) : ''}`);
      html += `<div class="alert">🔒 <b>${orphans.length} ID(s) do Pokerbyte não casaram com a grade atual</b> — provável mudança de nome/horário na planilha. <b>Não se perderam</b> (seguem salvos): ${lines.join(', ')}${orphans.length > 12 ? ` … e mais ${orphans.length - 12}` : ''}.</div>`;
    }
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

/* ── ANÉIS DE CRIAÇÃO (ref. getfluently) — progresso POR FUNÇÃO do turno,
   preenchendo conforme os torneios são marcados como criados ── */
function cnRing(tone, done, total, label){
  const R = 44, C = 2 * Math.PI * R;
  const pct = total ? Math.max(0, Math.min(1, done/total)) : 0;
  return `<div class="cn-ring t-${tone}">
    <svg viewBox="0 0 108 108" aria-hidden="true">
      <circle class="cn-bg" cx="54" cy="54" r="${R}"></circle>
      <circle class="cn-fg" cx="54" cy="54" r="${R}" style="--circ:${C.toFixed(1)};--pct:${pct.toFixed(3)}"></circle>
    </svg>
    <div class="cn-center"><b>${done}<span>/${total}</span></b></div>
    <div class="cn-label">${label}</div>
  </div>`;
}
let _cnRingsBuilt = false;
function renderCriacaoRings(){
  const el = document.getElementById('cnRings');
  if (!el || !DATA) return;
  const mainSat = [...DATA.main, ...DATA.sat];
  const sd = sideSplit();
  const doneOf = arr => arr.filter(it => DONE[itemKey(it)]).length;
  el.innerHTML =
    cnRing('main',     doneOf(mainSat),    mainSat.length,    'Main + Satélites') +
    cnRing('side',     doneOf(sd.admin),   sd.admin.length,   'Side · c/ Admin') +
    cnRing('sidefree', doneOf(sd.noadmin), sd.noadmin.length, 'Side · s/ Admin');
  if (!_cnRingsBuilt){ _cnRingsBuilt = true; requestAnimationFrame(() => el.classList.add('in')); }
  else el.classList.add('in');
}

function renderStats(){
  if (!DATA){ return; }
  renderCriacaoRings();
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
  _lastTouchedKey = key;
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
  _lastTouchedKey = key;
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
/* ORDEM EXATA pedida pela operação (imagem da GU) — a receita das seções segue
   ESTA sequência, mostrando TODAS as colunas da planilha. Cada slot casa o rótulo
   por radical (tolerante à grafia). A ordem dos slots É a ordem final; matcher
   guloso claima o 1º que casar e remove, então slots mais específicos vêm antes
   dos genéricos (BREAK LATE / PÓS LATE antes de LATE REG; PAYOUT antes/…).
   normText já tira acento e baixa a caixa. */
const CREATION_ORDER = [
  { m: n => n === 'mtt' },                                                          // MTT (nome interno)
  { m: n => isTypeLabel(n), once: true },                                           // TYPE (injetado em criação)
  { m: n => n.includes('game') && n.includes('type') },                            // GAME TYPE
  { m: n => /(^|[^a-z])k\.?\s*o\b/.test(n) || n.includes('knock') },                // K.O (REG/PROG/OFF)
  { m: n => n.includes('max') && n.includes('table') },                             // MAX. TABLE
  { m: n => n.includes('prize') || n.includes('guarant') || n.includes('garantido'), once: true }, // PRIZE POOL USD
  { m: n => n.includes('ticket') && n.includes('award') },                          // TICKET AWARD
  { m: n => (n.includes('personal') || n.includes('pessoal')) && n.includes('award') }, // PERSONALIZED AWARD
  { m: n => n.includes('payout') && !n.includes('calculated') && !n.includes('calculado'), once: true }, // PAYOUT
  { m: n => n.includes('payout') && (n.includes('calculated') || n.includes('calculado')) }, // CALCULATED PAYOUT
  { m: n => /buy[\s-]?in/.test(n) && !n.includes('size'), once: true },             // BUY-IN
  { m: n => (n.includes('reentry') || n.includes('re-entry') || n.includes('rebuy')) && !n.includes('stack') && !n.includes('condition') }, // REENTRY/REBUY
  { m: n => n.includes('stack') && (n.includes('reentry') || n.includes('re-entry') || n.includes('rebuy')) }, // STACK REENTRY/REBUY
  { m: n => n.includes('rebuy') && n.includes('condition') },                       // REBUY CONDITION
  { m: n => (n.includes('add-on') || n.includes('addon')) && !n.includes('stack') }, // ADD-ON
  { m: n => n.includes('stack') && (n.includes('add-on') || n.includes('addon')) }, // STACK ADD-ON
  { m: n => n.includes('break') && n.includes('late') },                            // BREAK LATE REG.
  { m: n => n === 'rake' || n.includes('rake') },                                   // RAKE
  { m: n => (n.includes('adm') || n.includes('admin')) && n.includes('fee') },      // ADM FEE
  { m: n => n.includes('structure') || n.includes('estrutura') },                   // STRUCTURE
  { m: n => n === 'chips' || n.includes('chip') || n.includes('starting stack') || n.includes('stack inicial') }, // CHIPS
  { m: n => n.includes('early game') },                                             // EARLY GAME
  { m: n => n.includes('pos late') },                                               // PÓS LATE REG. (normText tira o acento)
  { m: n => n.includes('final table') },                                            // FINAL TABLE
  { m: n => n === 'late reg' || (n.includes('late') && n.includes('reg')) },        // LATE REG (após BREAK/PÓS já claimados)
  { m: n => n.includes('num') && n.includes('player') || n.includes('players') || n.includes('jogadores') }, // NUM PLAYERS
  { m: n => n.includes('early bird') },                                             // EARLY BIRD
  { m: n => n.includes('time bank') || n === 'tb' },                                // TIME BANK
  { m: n => n === 'chat' || n.includes('chat') },                                   // CHAT
  { m: n => n === 'hora' || n === 'horario' || n.includes('hora') },                // HORA (injetado em criação)
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

/* A operação pediu pra ver TODAS as colunas da planilha nas seções (NUM PLAYERS e
   CHAT inclusos), na ordem da imagem — então nada é escondido aqui. `HIDDEN_RECIPE`
   fica como regex que não casa nada (documenta a decisão sem filtrar). */
const HIDDEN_RECIPE = /(?!)/;
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

function opTagHtml(op, key){
  const inner = op
    ? `<span class="op-tag" style="background:${opColor(op)}"><span class="dot">${escHtml(op.trim()[0].toUpperCase())}</span>${escHtml(op.split(' ')[0])}</span>`
    : `<span class="op-tag none">${SELECTED_OP ? 'clique p/ atribuir' : 'atribuir ▾'}</span>`;
  if (!key) return inner;   // usos read-only (ex.: TV) passam sem key
  const tip = SELECTED_OP
    ? 'Atribuir a ' + escHtml(SELECTED_OP) + ' (clique de novo tira)'
    : 'Clique: pegar pra mim ou transferir para outro operador';
  return `<button class="op-assign${SELECTED_OP ? ' armed' : ''}" data-assign="${escHtml(key)}" title="${tip}">${inner}</button>`;
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

/* soma do PRIZE POOL USD por seção (chip .gtd-total do cabeçalho) — era local a
   renderList(), mas renderSecFs() (tela cheia da seção) também precisa: ficou
   TOP-LEVEL pra não duplicar. BUG CORRIGIDO: renderSecFs() chamava a versão
   local (fora de escopo) e estourava ReferenceError — por isso o botão de
   tela cheia "não fazia nada" (o erro parava a função antes do classList.add). */
const _nf = n => n.toLocaleString('pt-BR', {maximumFractionDigits:0});
const prizeChip = (list, brl) => {
  const usd = list.reduce((a,it) => a + (typeof it.garantido === 'number' ? it.garantido : 0), 0);
  if (brl) return `<span class="gtd-total" title="Soma do garantido desta seção (R$)">Σ R$ ${_nf(usd * BRL_RATE)}</span>`;
  return `<span class="gtd-total" title="Soma do PRIZE POOL USD desta seção · R$ ${_nf(usd * BRL_RATE)}">Σ $ ${_nf(usd)}</span>`;
};

function renderList(){
  const area = $('listArea');
  if (!DATA){
    area.innerHTML = `<div class="empty-state"><span class="moon">🌙</span>Nenhuma planilha carregada ainda pra este dia da grade.<br>Suba a Global MTT acima — ou aguarde: se um parceiro subir, aparece aqui sozinho.</div>`;
    return;
  }
  // COMPORTAMENTO GOOGLE SHEETS: uma atualização de dados (listener do Firebase → renderAll)
  // reconstrói o innerHTML e zeraria a rolagem de cada grade. Guarda a rolagem de cada grade
  // (por naipe) + a da janela ANTES de reconstruir e restaura DEPOIS — o operador não perde o
  // lugar onde estava quando um parceiro marca um ID/torneio do outro lado.
  const _scroll = {};
  area.querySelectorAll('.secwrap').forEach(sw => {
    const vw = sw.querySelector('.vwrap');
    if (vw) _scroll[sw.dataset.suit] = { t: vw.scrollTop, l: vw.scrollLeft };
  });
  const _winY = window.scrollY;
  const asg = computeAssignments();
  let html = hiddenBarHtml();   // barra de "linhas ocultas" (olhinho por linha), quando houver
  const isBrl = CURRENCY === 'brl';   // a grade agora SEGUE o toggle (default US$, clique → R$)

  SECTIONS.forEach(cat => {
    const all = catItems(cat);
    const secAsg = withSecOwner(asg, all, cat.key);        // dono da seção cobre os sem dono
    const items = visibleItems(all, secAsg);               // filtro por pessoa já enxerga o dono da seção
    if (!items.length) return;
    const doneCount = items.filter(it => DONE[itemKey(it)]).length;
    html += `
      <div class="section-head ${cat.cls}">
        <span class="tag"><span class="suit">${cat.suit}</span>${cat.label}</span>
        <span class="cnt">${doneCount}/${items.length} criados</span>
        ${prizeChip(items, isBrl)}
        ${secOwnerChipHtml(cat.key)}
        <span class="line"></span>
        <button class="sec-fs-btn" data-secfs="${cat.key}" title="Tela cheia" aria-label="Tela cheia desta seção">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
        </button>
      </div>
      ${sectionNoteHtml(cat)}
      <div class="secwrap" data-suit="${cat.suit}">${renderVertical(items, cat, secAsg)}</div>`;
  });

  // #2 LIGA PRINCIPAL — grade fixa dos Eventos Principais do dia. Reconstruída do dado
  // local; preenchimento (ID/criado) e AGORA a atribuição por operador persistem pelas
  // MESMAS chaves (itemKey). A Liga é R$ NATIVO: converto pra US-equivalente (÷BRL_RATE)
  // e deixo o renderVertical/formatadores reaplicarem a moeda do toggle (×BRL_RATE em R$),
  // então ela segue o botão igual às outras seções. Entra na divisão: por evento (clique)
  // e por dono da seção (secAsg).
  const cur = CURRENCY;
  // Liga aparece em "Todos" e TAMBÉM quando o filtro é uma pessoa que tem evento da Liga
  // (por override ou dono da seção) — senão "meus torneios" esconderia a Liga do dono dela.
  if (typeof LIGA_PRINCIPAL_SECTIONS !== 'undefined'){
    const lp = LIGA_PRINCIPAL_SECTIONS[WEEKDAY_TOMORROW_EN];
    if (lp){
      const toUsdEq = it => ({...it,
        garantido: typeof it.garantido === 'number' ? it.garantido / BRL_RATE : it.garantido,
        buyin: typeof it.buyin === 'number' ? it.buyin / BRL_RATE : it.buyin });
      let pit = [...(lp.main||[]), ...(lp.side||[]), ...(lp.sat||[])].map(toUsdEq);
      const ligaAsgAll = withSecOwner(asg, pit, 'liga');
      if (FILTER !== 'all') pit = pit.filter(it => ligaAsgAll[itemKey(it)] === FILTER);
      if (SEARCH){ const q = normText(SEARCH); pit = pit.filter(it => normText(it.nome).includes(q) || String(it.hora||'').includes(SEARCH)); }
      pit.sort((a,b) => (timeToMinutes(a.hora) ?? 9999) - (timeToMinutes(b.hora) ?? 9999));
      if (pit.length){
        const pcat = { key:'liga', cls:'liga', suit:'🏆', label:`Liga Principal · ${cur === 'usd' ? '$' : 'R$'}` };
        const ligaFields = creationOrderFields((typeof LIGA_PRINCIPAL_FIELDS !== 'undefined' ? LIGA_PRINCIPAL_FIELDS : []).filter(l => !isCoreLabel(l)));
        const ligaAsg = withSecOwner(asg, pit, 'liga');   // per-evento + dono da seção
        const pdone = pit.filter(it => DONE[itemKey(it)]).length;
        html += `
          <div class="section-head liga">
            <span class="tag"><span class="suit">🏆</span>Liga Principal · ${cur === 'usd' ? '$' : 'R$'}</span>
            <span class="cnt">${pdone}/${pit.length} criados</span>
            ${prizeChip(pit, isBrl)}
            ${secOwnerChipHtml('liga')}
            <span class="line"></span>
          </div>
          <p class="section-note" style="margin:4px 0 0">Grade fixa dos <b>Eventos Principais</b> (R$ nativo). Selecione alguém na equipe e clique nos eventos pra atribuir, ou defina um <b>dono da seção</b>.</p>
          <div class="secwrap liga-sec" data-suit="🏆">${renderVertical(pit, pcat, ligaAsg, ligaFields)}</div>`;
      }
    }
  }

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

  // "vazio" = só a barra de linhas ocultas (ou nada) — nenhuma grade renderizada
  if (html === hiddenBarHtml()) html += `<div class="empty-state"><span class="moon">🃏</span>Nada nesse filtro.</div>`;
  area.innerHTML = html;
  applyListHidden();   // aplica as linhas ocultas na lista recém-montada

  // restaura a rolagem capturada acima (atribuição direta = instantânea, sem animar o scroll-behavior:smooth)
  area.querySelectorAll('.secwrap').forEach(sw => {
    const p = _scroll[sw.dataset.suit]; if (!p) return;
    const vw = sw.querySelector('.vwrap');
    if (vw){ vw.scrollTop = p.t; vw.scrollLeft = p.l; }
  });
  document.documentElement.scrollTop = _winY;

  area.querySelectorAll('[data-done]').forEach(el => el.addEventListener('click', () => toggleDone(el.dataset.done)));
  area.querySelectorAll('[data-secfs]').forEach(el => el.addEventListener('click', () => toggleSectionFs(el.dataset.secfs)));
  area.querySelectorAll('[data-secowner]').forEach(el => el.addEventListener('click', () => openSecOwnerMenu(el, el.dataset.secowner)));
  area.querySelectorAll('[data-hiderow]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); hideRow(el.dataset.hiderow); }));
  area.querySelectorAll('[data-showrow]').forEach(el => el.addEventListener('click', () => showRow(el.dataset.showrow)));
  area.querySelectorAll('[data-showall]').forEach(el => el.addEventListener('click', showAllRows));
  area.querySelectorAll('[data-assign]').forEach(el => el.addEventListener('click', el2 => onAssignClick(el)));
  area.querySelectorAll('[data-focus]').forEach(el => {
    el.addEventListener('click', () => openSectionFsAt(el.dataset.focuscat, el.dataset.focus));
    /* teclado: o nome é role="button" — Enter/Espaço abrem a seção em tela cheia */
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); openSectionFsAt(el.dataset.focuscat, el.dataset.focus); }
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

/* liga/desliga a tela cheia de UMA seção (Main/Side/Satélite) — só uma por vez,
   igual ao padrão já usado na Conferência do dia (conf-dia.js). Sair da tela
   cheia de uma volta pra ela, sair da atual fecha (mesmo botão). */
function toggleSectionFs(catKey){
  const opening = SEC_FS !== catKey;
  SEC_FS = opening ? catKey : null;
  document.body.classList.toggle('cn-sec-fs-lock', !!SEC_FS);
  renderSecFs();
  if (opening) a11yOpenDialog('secFsOverlay'); else a11yCloseDialog('secFsOverlay');
}
function setSectionView(view){
  SEC_VIEW = view;
  try{ localStorage.setItem('cn_sec_view', view); }catch(e){}
  renderSecFs();
}
/* tela cheia de UMA seção — overlay PRÓPRIO no nível do <body> (#secFsOverlay,
   ver criacao-noturna.html, mesmo padrão do #tvOverlay), NUNCA
   aninhado dentro de #listArea: um elemento position:fixed dentro de um
   ancestral com transform/will-change (as animações de entrada da lista usam
   isso) deixa de ser fixo à VIEWPORT e passa a ser fixo ao ancestral — daí o
   bug de ter que rolar a página inteira pra alcançar o botão de fechar. Um
   overlay solto direto no body nunca tem esse problema. */
function renderSecFs(){
  const ov = $('secFsOverlay');
  if (!ov) return;
  if (!SEC_FS || !DATA){ ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); return; }
  const cat = SECTIONS.find(c => c.key === SEC_FS);
  // tela cheia usa o MESMO asg da grade: override por evento + dono da seção, e respeita
  // o filtro por pessoa — assim o dono aparece na tela de criação e "meus torneios" bate.
  const allCat = cat ? catItems(cat) : [];
  const asg = withSecOwner(computeAssignments(), allCat, SEC_FS);
  const items = cat ? visibleItems(allCat, asg) : [];
  if (!cat || !items.length){
    SEC_FS = null;
    document.body.classList.remove('cn-sec-fs-lock');
    ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true');
    return;
  }
  // sem cursor válido nesta seção (primeira abertura pelo ⛶, ou o item
  // sumiu/foi criado) — cai no primeiro torneio, pra ← → sempre ter de onde partir
  if (!SEC_CURSOR || !items.some(it => itemKey(it) === SEC_CURSOR)) SEC_CURSOR = itemKey(items[0]);
  const doneCount = items.filter(it => DONE[itemKey(it)]).length;
  const pct = items.length ? Math.round(doneCount / items.length * 100) : 0;
  const card = $('secFsCard');
  card.innerHTML = `
    <div class="section-head ${cat.cls}">
      <span class="tag"><span class="suit">${cat.suit}</span>${cat.label}</span>
      <span class="cnt">${doneCount}/${items.length} criados</span>
      ${prizeChip(items, CURRENCY === 'brl')}
      ${secOwnerChipHtml(SEC_FS)}
      <span class="sec-fs-prog" title="${pct}% criados" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span>
      <span class="line"></span>
      <div class="seg sec-view-seg" role="group" aria-label="Visão da seção">
        <button data-secview="sheet" class="${SEC_VIEW === 'sheet' ? 'on' : ''}" title="Planilha — um torneio por linha, igual à Global (tecla P)">Planilha</button>
        <button data-secview="columns" class="${SEC_VIEW === 'columns' ? 'on' : ''}" title="Colunas — campos empilhados, um torneio por coluna (tecla C)">Colunas</button>
      </div>
      <button class="sec-fs-btn sec-fs-eye" id="secFsEye" title="Mostrar/ocultar campos" aria-label="Escolher campos visíveis" aria-haspopup="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
        <span class="eye-n"></span>
      </button>
      <button class="sec-fs-btn" id="secFsClose" title="Fechar (Esc)" aria-label="Fechar tela cheia">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="secwrap" data-suit="${cat.suit}">${SEC_VIEW === 'sheet' ? renderPlanilhaRows(items, cat, asg) : renderVertical(items, cat, asg, null, true)}</div>
    <div class="sec-fs-foot">
      <div class="keys" aria-hidden="true">
        <span class="kbtn"><kbd>←</kbd><kbd>→</kbd> navegar</span>
        <span class="kbtn"><kbd>Espaço</kbd> marcar criado</span>
        <span class="kbtn"><kbd>P</kbd><kbd>C</kbd> planilha/colunas</span>
        <span class="kbtn"><kbd>Esc</kbd> sair</span>
      </div>
      <span class="sec-fs-pos" id="secFsPos" aria-live="polite"></span>
    </div>`;
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
  $('secFsClose').addEventListener('click', () => toggleSectionFs(SEC_FS));
  $('secFsEye').addEventListener('click', e => { e.stopPropagation(); openFieldEye(e.currentTarget); });
  card.querySelectorAll('[data-secview]').forEach(b => b.addEventListener('click', () => setSectionView(b.dataset.secview)));
  card.querySelectorAll('[data-secowner]').forEach(el => el.addEventListener('click', () => openSecOwnerMenu(el, el.dataset.secowner)));
  card.querySelectorAll('[data-assign]').forEach(el => el.addEventListener('click', () => onAssignClick(el)));
  card.querySelectorAll('[data-hiderow]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); hideRow(el.dataset.hiderow); }));
  card.querySelectorAll('[data-done]').forEach(el => el.addEventListener('click', () => toggleDone(el.dataset.done)));
  card.querySelectorAll('.id-inp').forEach(inp => {
    inp.addEventListener('change', () => setId(inp.dataset.idkey, inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  card.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(el.dataset.copy); showToast('Receita copiada 📋'); }
    catch(e){ showToast('Não consegui copiar — copie manualmente.', true); }
  }));
  card.querySelectorAll('[data-focus]').forEach(el => {
    el.addEventListener('click', () => { SEC_CURSOR = el.dataset.focus; secFsHighlightCursor(); });
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); SEC_CURSOR = el.dataset.focus; secFsHighlightCursor(); } });
  });
  applySecFsHidden();
  secFsHighlightCursor();
}

/* ── O "OLHINHO": mostra/oculta campos na tela cheia (Colunas = linhas,
   Planilha = colunas). Cada campo carrega data-field; ocultar é só esconder
   todo elemento com aquele data-field. O conjunto é persistido e vale pras
   duas visões — serve pra enxugar a tela e evitar scroll. ─────────────────── */
function applySecFsHidden(){
  const card = $('secFsCard'); if (!card) return;
  card.querySelectorAll('[data-field]').forEach(el => {
    el.style.display = SEC_HIDDEN.has(el.dataset.field) ? 'none' : '';
  });
  const btn = document.getElementById('secFsEye');
  if (btn){
    const n = SEC_HIDDEN.size;
    btn.classList.toggle('has-hidden', n > 0);
    const tag = btn.querySelector('.eye-n'); if (tag) tag.textContent = n ? String(n) : '';
  }
}
/* rótulo legível a partir do data-field (pra barra de "linhas ocultas") */
function fieldLabelFor(key){
  if (key.startsWith('f:')) return key.slice(2);
  return ({hora:'Horário', criar:'Criar em', admin:'Admin Fee', early:'Early Bird', camp:'Campanha', grupo:'Grupo', late:'Late reg'})[key] || key;
}
function persistHidden(){ try{ localStorage.setItem('cn_sec_hidden', JSON.stringify([...SEC_HIDDEN])); }catch(e){} }
/* aplica SEC_HIDDEN na LISTA normal (#listArea) — some/aparece a <tr> inteira (vtable
   é transposta, então cada campo é uma linha). Compartilha o conjunto com a tela cheia. */
function applyListHidden(){
  const area = $('listArea'); if (!area) return;
  area.querySelectorAll('.vtable tr[data-field]').forEach(tr => {
    tr.style.display = SEC_HIDDEN.has(tr.dataset.field) ? 'none' : '';
  });
}
/* barra acima das grades listando as linhas ocultas — clique num chip mostra de volta */
function hiddenBarHtml(){
  if (!SEC_HIDDEN.size) return '';
  const chips = [...SEC_HIDDEN].map(k =>
    `<button class="hf-chip" data-showrow="${escHtml(k)}" title="Mostrar a linha “${escHtml(fieldLabelFor(k))}” de novo">${EYE_OFF_SVG}${escHtml(fieldLabelFor(k))}</button>`).join('');
  return `<div class="hidden-fields-bar"><b>${SEC_HIDDEN.size}</b> linha(s) oculta(s): ${chips}<button class="hf-all" data-showall>Mostrar todas</button></div>`;
}
function hideRow(field){ SEC_HIDDEN.add(field); persistHidden(); renderAll(); }
function showRow(field){ SEC_HIDDEN.delete(field); persistHidden(); renderAll(); }
function showAllRows(){ SEC_HIDDEN.clear(); persistHidden(); renderAll(); }
function closeFieldEye(){
  const m = document.getElementById('fieldEyeMenu'); if (m) m.remove();
  document.removeEventListener('mousedown', fieldEyeOutside, true);
}
function fieldEyeOutside(e){
  const m = document.getElementById('fieldEyeMenu');
  if (m && !m.contains(e.target) && e.target.id !== 'secFsEye' && !e.target.closest('#secFsEye')) closeFieldEye();
}
function openFieldEye(anchor){
  if (document.getElementById('fieldEyeMenu')){ closeFieldEye(); return; } // toggle
  const card = $('secFsCard'); if (!card) return;
  // fonte de verdade = o que está renderizado agora (fica em sincronia com a visão)
  const seen = new Map();
  card.querySelectorAll('[data-flabel]').forEach(el => { if (!seen.has(el.dataset.field)) seen.set(el.dataset.field, el.dataset.flabel); });
  const fields = [...seen.entries()]; // [ [key,label], ... ] na ordem de render
  if (!fields.length) return;
  const eyeOn  = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOff = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>`;
  const m = document.createElement('div');
  m.className = 'pop-menu fieldeye'; m.id = 'fieldEyeMenu';
  m.setAttribute('role', 'menu');
  m.innerHTML =
    `<div class="ph">Campos visíveis · clique pra ocultar</div>` +
    fields.map(([k, lbl]) => {
      const off = SEC_HIDDEN.has(k);
      return `<button class="pm feye ${off ? 'off' : ''}" data-fk="${escHtml(k)}" role="menuitemcheckbox" aria-checked="${off ? 'false' : 'true'}">
        <span class="eye" aria-hidden="true">${off ? eyeOff : eyeOn}</span><span class="lbl">${escHtml(lbl)}</span></button>`;
    }).join('') +
    `<button class="pm feye-all">↺ Mostrar tudo</button>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(12, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 12)) + 'px';
  m.style.top  = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 12) + 'px';
  // toggle de cada campo — atualiza o item no lugar, sem fechar o menu
  m.querySelectorAll('.feye[data-fk]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.fk;
    if (SEC_HIDDEN.has(k)) SEC_HIDDEN.delete(k); else SEC_HIDDEN.add(k);
    try{ localStorage.setItem('cn_sec_hidden', JSON.stringify([...SEC_HIDDEN])); }catch(e){}
    const off = SEC_HIDDEN.has(k);
    b.classList.toggle('off', off);
    b.setAttribute('aria-checked', off ? 'false' : 'true');
    b.querySelector('.eye').innerHTML = off ? eyeOff : eyeOn;
    applySecFsHidden();
  }));
  m.querySelector('.feye-all').addEventListener('click', () => {
    SEC_HIDDEN.clear();
    try{ localStorage.setItem('cn_sec_hidden', '[]'); }catch(e){}
    applySecFsHidden(); closeFieldEye();
  });
  setTimeout(() => document.addEventListener('mousedown', fieldEyeOutside, true), 0);
}

/* planilha transposta: campos nas linhas, torneios nas colunas — é a visão
   "Colunas" (padrão da lista normal, e opção dentro da tela cheia da seção).
   A visão "Planilha" de verdade (uma linha por torneio) é renderPlanilhaRows,
   acima. Campos-chave com rótulo destacado. */
/* SVG do olho-fechado (ocultar) — reusado no th das linhas e no menu do olhinho */
const EYE_OFF_SVG = `<svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>`;
/* th (rótulo) de uma linha da vtable com o OLHINHO de ocultar embutido. `field` casa
   com o data-field da <tr> — clicar oculta a linha (some da lista E da tela cheia, pois
   compartilham SEC_HIDDEN). Linhas de ação (operador/id/criado) não passam por aqui. */
function rlabTh(field, label, isKey){
  return `<th class="rowlab hideable ${isKey ? 'key' : ''}" title="${escHtml(label)}"><span class="rl-txt">${escHtml(label)}</span>`
    + `<button class="rl-hide" data-hiderow="${escHtml(field)}" title="Ocultar a linha “${escHtml(label)}” (dá pra restaurar na barra acima)" aria-label="Ocultar ${escHtml(label)}">${EYE_OFF_SVG}</button></th>`;
}
function renderVertical(items, cat, asg, fieldList, dropEmpty){
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
  // MOSTRAR TODAS as colunas: FEE/ADMIN FEE/EARLY BIRD crus continuam na receita, na
  // ordem da planilha (a operação pediu). Os chips Admin Fee/Early Bird no topo são só
  // atalho JÁ CALCULADO (10% / +2% / % das fichas), não substituem a coluna original.
  let rows = (fieldList || visibleRecipeFields());
  // tela cheia: descarta campo que é vazio ("—") em TODOS os torneios da seção —
  // linha só de traço é ruído e come altura à toa (pedido: evitar scroll vertical)
  if (dropEmpty) rows = rows.filter(label => cols.some(c => {
    const v = c.it.extra ? c.it.extra[label] : undefined;
    return v !== undefined && v !== null && v !== '';
  }));
  return `
    <div class="vwrap"><table class="vtable">
      <tr class="trow-head"><th class="rowlab">Torneio</th>${cell(c => {
        const m = mttKicker(c.it), urg = urgency(c.it);
        return `<span class="vgo" data-focus="${c.key}" data-focuscat="${cat.key}" role="button" tabindex="0" title="Abrir a seção em tela cheia neste torneio" aria-label="Abrir a seção em tela cheia em ${escHtml(c.it.nome)}">${escHtml(c.it.nome)}</span>` + campBadgeHtml(c.it) + valBadge(c.it, cat) + changeBadge(c.it) + auditBadge(c.it)
          + (auditErr(c.it) && auditErr(c.it).motivo ? `<br><span style="font-size:10.5px;color:var(--red);font-weight:600">↳ ${escHtml(auditErr(c.it).motivo)}</span>` : '')
          + (urg ? `<br><span class="urg-pill ${urg}">⏰ ${urgLabel(c.it)}</span>` : '')
          + (m ? `<br><span class="mtt-kick"><span class="tag-k">MTT</span><span class="val">${escHtml(m)}</span></span>` : '');
      }, 'vname')}</tr>
      <tr data-field="hora" data-flabel="Horário">${rlabTh('hora', 'Horário', false)}${cell(c => `<span class="thora">${escHtml(c.it.hora)}</span>`)}</tr>
      <tr data-field="criar" data-flabel="Criar em">${rlabTh('criar', 'Criar em', true)}${cell(c => `<span class="mono" style="font-weight:700">${escHtml(creationWhen(c.it))}</span>`)}</tr>
      <tr data-field="admin" data-flabel="Admin Fee">${rlabTh('admin', 'Admin Fee', false)}${cell(c => { const p = adminFeeParts(c.it); return p ? `<span class="calc-chip admin">${escHtml(p.main)}${p.sub ? `<span class="amt">${escHtml(p.sub)}</span>` : ''}</span>` : `<span style="opacity:.4">—</span>`; })}</tr>
      <tr data-field="early" data-flabel="Early Bird">${rlabTh('early', 'Early Bird', false)}${cell(c => { const p = earlyParts(c.it); return p ? `<span class="calc-chip early">${escHtml(p.main)}${p.sub ? `<span class="amt">${escHtml(p.sub)}</span>` : ''}</span>` : `<span style="opacity:.4">—</span>`; })}</tr>
      ${cols.some(c => hasCampaign(c.it)) ? `<tr data-field="camp" data-flabel="Campanha">${rlabTh('camp', 'Campanha', false)}${cell(c => hasCampaign(c.it) ? campBadgeHtml(c.it) : `<span style="opacity:.4">—</span>`)}</tr>` : ''}
      ${cat.key === 'sat' ? `<tr data-field="grupo" data-flabel="Grupo">${rlabTh('grupo', 'Grupo', false)}${cell(c => `<span style="font-size:11px;color:var(--sat-bright)">${escHtml(c.it.groupHeader || '—')}</span>`)}</tr>` : ''}
      ${rows.length
        ? rows.map(label => `<tr data-field="f:${escHtml(label)}" data-flabel="${escHtml(label)}">${rlabTh('f:' + label, label, keyLabels.has(label))}${cell(c => {
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
        : `<tr data-field="late" data-flabel="Late reg">${rlabTh('late', 'Late reg', false)}${cell(c => `<span class="mono" style="color:var(--ink-soft)">${c.it.late ? escHtml(c.it.late) : '—'}</span>`)}</tr>`}
      <tr data-field="op" data-flabel="Operador"><th class="rowlab">Operador</th>${cell(c => opTagHtml(c.op, c.key))}</tr>
      <tr data-field="id" data-flabel="ID Pokerbyte"><th class="rowlab">ID Pokerbyte</th>${cell(c => idInputHtml(c.key, 'width:110px'))}</tr>
      <tr data-field="done" data-flabel="Criado"><th class="rowlab">Criado</th>${cell(c => `
        <button class="chk ${c.done ? 'on' : ''}" data-done="${c.key}" role="checkbox" aria-checked="${c.done ? 'true' : 'false'}"
          aria-label="${c.done ? `Criado por ${escHtml((DONE[c.key]||{}).by || '—')} — desmarcar` : `Marcar ${escHtml(c.it.nome)} como criado`}"
          title="${c.done ? `Criado por ${escHtml((DONE[c.key]||{}).by || '—')}` : 'Marcar como criado'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg></button>
        <button class="copy-btn" data-copy="${escHtml(recipeText(c.it, cat.label))}" title="Copiar receita" style="margin-left:6px;display:inline-grid;vertical-align:middle"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>`)}</tr>
    </table></div>`;
}

/* PLANILHA DE VERDADE — uma LINHA por torneio, campos em COLUNA: a mesma
   orientação da aba G MTTS da Global (a "vtable" de cima, usada em Colunas, é
   TRANSPOSTA — campos na linha, torneio na coluna — o oposto disso). Só usada
   na tela cheia. Mesmas ações de sempre (ID, criado, copiar, abrir em tela
   cheia por evento) — data-attrs batem com os listeners já existentes. */
function renderPlanilhaRows(items, cat, asg){
  const cols = visibleRecipeFields();   // TODAS as colunas, na ordem da planilha (ver renderVertical)
  const head = `<tr>
      <th class="pname">Torneio</th><th data-field="hora" data-flabel="Horário">Horário</th><th class="key" data-field="criar" data-flabel="Criar em">Criar em</th>
      <th data-field="admin" data-flabel="Admin Fee">Admin Fee</th><th data-field="early" data-flabel="Early Bird">Early Bird</th>
      ${cat.key === 'sat' ? '<th data-field="grupo" data-flabel="Grupo">Grupo</th>' : ''}
      ${cols.map(l => `<th data-field="f:${escHtml(l)}" data-flabel="${escHtml(l)}" title="${escHtml(l)}">${escHtml(l)}</th>`).join('')}
      <th data-field="op" data-flabel="Operador">Operador</th><th data-field="id" data-flabel="ID Pokerbyte">ID Pokerbyte</th><th data-field="done" data-flabel="Criado">Criado</th><th></th>
    </tr>`;
  const body = items.map(it => {
    const key = itemKey(it);
    const done = !!DONE[key];
    const op = asg[key];
    const af = adminFeeParts(it), eb = earlyParts(it);
    const m = mttKicker(it), urg = urgency(it);
    return `<tr class="${done ? 'done-row' : ''}">
      <td class="pname">
        <span class="vgo" data-focus="${key}" data-focuscat="${cat.key}" role="button" tabindex="0" title="Ir pra este torneio na tela cheia" aria-label="Ir pra ${escHtml(it.nome)} na tela cheia">${escHtml(it.nome)}</span>
        ${campBadgeHtml(it)}${valBadge(it, cat)}${changeBadge(it)}${auditBadge(it)}
        ${urg ? `<br><span class="urg-pill ${urg}">⏰ ${urgLabel(it)}</span>` : ''}
        ${m ? `<br><span class="mtt-kick"><span class="tag-k">MTT</span><span class="val">${escHtml(m)}</span></span>` : ''}
      </td>
      <td class="thora" data-field="hora">${escHtml(it.hora)}</td>
      <td class="mono key" style="font-weight:700" data-field="criar">${escHtml(creationWhen(it))}</td>
      <td data-field="admin">${af ? `<span class="calc-chip admin">${escHtml(af.main)}${af.sub ? `<span class="amt">${escHtml(af.sub)}</span>` : ''}</span>` : '<span style="opacity:.4">—</span>'}</td>
      <td data-field="early">${eb ? `<span class="calc-chip early">${escHtml(eb.main)}${eb.sub ? `<span class="amt">${escHtml(eb.sub)}</span>` : ''}</span>` : '<span style="opacity:.4">—</span>'}</td>
      ${cat.key === 'sat' ? `<td data-field="grupo" style="font-size:11px;color:var(--sat-bright)">${escHtml(it.groupHeader || '—')}</td>` : ''}
      ${cols.map(label => {
        const v = it.extra ? it.extra[label] : undefined;
        const has = v !== undefined && v !== null && v !== '';
        return `<td data-field="f:${escHtml(label)}">${has ? escHtml(fmtExtraVal(label, v)) : '<span style="color:var(--ink-soft);opacity:.5">—</span>'}</td>`;
      }).join('')}
      <td data-field="op">${opTagHtml(op, key)}</td>
      <td data-field="id">${idInputHtml(key, 'width:110px')}</td>
      <td data-field="done">
        <button class="chk ${done ? 'on' : ''}" data-done="${key}" role="checkbox" aria-checked="${done ? 'true' : 'false'}"
          title="${done ? `Criado por ${escHtml((DONE[key]||{}).by || '—')}` : 'Marcar como criado'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg></button>
      </td>
      <td><button class="copy-btn" data-copy="${escHtml(recipeText(it, cat.label))}" title="Copiar receita"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></td>
    </tr>`;
  }).join('');
  return `<div class="pwrap"><table class="ptable"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/* duração média de criação (mostrada nos stats/TV) — sem o rastreamento
   por-torneio que o Modo Foco fazia (removido, ver abaixo), fica sem dado
   até algo popular DONE[key].dur de novo; a função não quebra, só devolve null. */
function avgDurMin(){
  const ds = Object.values(DONE).map(d => d && d.dur).filter(x => typeof x === 'number' && x > 0);
  return ds.length ? ds.reduce((a,b) => a+b, 0) / ds.length / 60000 : null;
}

/* validação da receita — só regras conservadoras (sem falso alarme) */
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
  DONE[key] = {by: ME || 'Alguém', at: Date.now()}; // otimista — o eco do Firebase confirma
  // transação: se dois operadores marcarem juntos, o primeiro vence
  if (fbDb){
    fbDb.ref(`${FB_PATH}/done/${key}`).transaction(existing =>
      existing ? undefined : {by: ME || 'Alguém', at: Date.now()});
    logEvent('marcou criado', key);
  }
  renderAll();
}

/* =========================================================================
   HANDOFF DE TURNO + menu popover reaproveitável
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
  const asg = effectiveAssignments();   // inclui dono da seção, não só override por evento
  const op = myOp();
  if (!op) return {op:null, items:[]};
  const items = allWithCat().map(x => x.it).filter(it => asg[itemKey(it)] === op && !DONE[itemKey(it)]);
  return {op, items};
}
function saveOverrides(){ if (fbDb) fbDb.ref(`${FB_PATH}/overrides`).set(OVERRIDES); else renderAll(); }
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

/* =========================================================================
   NAVEGAÇÃO POR TORNEIO NA TELA CHEIA DA SEÇÃO — substituiu o Modo Foco
   (overlay separado, removido): clicar o nome de um torneio, na lista normal
   ou já dentro da tela cheia, abre/mantém a seção em tela cheia com o cursor
   nesse torneio; ← → andam pro anterior/próximo sem sair dali. Pedido
   explícito: "as funcionalidades tem que ser por seção não no modo foco".
========================================================================= */
let SEC_CURSOR = null; // itemKey do torneio "atual" dentro da seção em tela cheia
function openSectionFsAt(catKey, key){
  if (SEC_FS !== catKey){
    SEC_FS = catKey;
    document.body.classList.add('cn-sec-fs-lock');
  }
  SEC_CURSOR = key;
  renderSecFs();
  a11yOpenDialog('secFsOverlay');
}
function secFsMoveCursor(delta){
  if (!SEC_FS || !DATA) return;
  const cat = SECTIONS.find(c => c.key === SEC_FS);
  if (!cat) return;
  const asg = computeAssignments();
  const items = visibleItems(catItems(cat), asg);
  if (!items.length) return;
  const keys = items.map(itemKey);
  let idx = SEC_CURSOR ? keys.indexOf(SEC_CURSOR) : -1;
  idx = idx === -1 ? 0 : Math.max(0, Math.min(keys.length - 1, idx + delta));
  SEC_CURSOR = keys[idx];
  secFsHighlightCursor();
}
/* Home/End — pula pro primeiro/último torneio da seção (idx=Infinity = último) */
function secFsJumpCursor(idx){
  if (!SEC_FS || !DATA) return;
  const cat = SECTIONS.find(c => c.key === SEC_FS);
  if (!cat) return;
  const keys = visibleItems(catItems(cat), computeAssignments()).map(itemKey);
  if (!keys.length) return;
  const i = Math.max(0, Math.min(keys.length - 1, idx === Infinity ? keys.length - 1 : idx));
  SEC_CURSOR = keys[i];
  secFsHighlightCursor();
}
/* destaca e rola até o torneio "atual": em Colunas (vtable transposta) marca
   a COLUNA inteira (mesmo índice em toda linha); em Planilha marca a LINHA.
   Também atualiza o indicador de posição "N / Total" no rodapé. */
function secFsHighlightCursor(){
  const card = $('secFsCard');
  if (!card || !SEC_CURSOR) return;
  // indicador de posição (N / Total) — some redundante mas barato; roda a cada ← →
  const pos = document.getElementById('secFsPos');
  if (pos && SEC_FS){
    const c = SECTIONS.find(s => s.key === SEC_FS);
    if (c){
      const keys = visibleItems(catItems(c), computeAssignments()).map(itemKey);
      const i = keys.indexOf(SEC_CURSOR);
      if (i >= 0) pos.innerHTML = `<b>${i + 1}</b> / ${keys.length}`;
    }
  }
  const esc = k => (window.CSS && CSS.escape) ? CSS.escape(k) : k;
  card.querySelectorAll('.sec-cursor, .sec-cursor-col').forEach(el => el.classList.remove('sec-cursor', 'sec-cursor-col'));
  const table = card.querySelector('table');
  if (!table) return;
  const anchor = table.querySelector(`[data-idkey="${esc(SEC_CURSOR)}"], [data-done="${esc(SEC_CURSOR)}"]`);
  if (!anchor) return;
  if (table.classList.contains('ptable')){
    const tr = anchor.closest('tr');
    if (tr){ tr.classList.add('sec-cursor'); tr.scrollIntoView({block:'nearest', behavior:'smooth'}); }
  } else {
    const td = anchor.closest('td');
    if (td){
      const idx = td.cellIndex;
      table.querySelectorAll('tr').forEach(row => { const cell = row.cells[idx]; if (cell) cell.classList.add('sec-cursor-col'); });
      td.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
    }
  }
}
$('handoffBtn').addEventListener('click', e => openHandoff(e.currentTarget));

document.addEventListener('keydown', e => {
  if ($('popMenu') && e.key === 'Escape'){ closePickMenu(); return; }
  if (TV_OPEN && e.key === 'Escape'){ closeTV(); return; }
  if (SEC_FS && e.key === 'Escape'){ toggleSectionFs(SEC_FS); return; }
  if (!SEC_FS) return;
  const ae = document.activeElement;
  const tag = ae && ae.tagName;
  if (tag && /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return; // digitando o ID: não sequestra teclas
  // Espaço/Enter num controle (botão, nome-link) = ação dele, não "marcar criado"
  const onControl = !!(ae && (tag === 'BUTTON' || tag === 'A' || (ae.getAttribute && ae.getAttribute('role') === 'button')));
  // ← → e ↑ ↓ navegam torneio (o mapeamento certo depende da visão; aceitar os dois é perdão de UX)
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown'){ e.preventDefault(); secFsMoveCursor(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp'){ e.preventDefault(); secFsMoveCursor(-1); }
  else if (e.key === 'Home'){ e.preventDefault(); secFsJumpCursor(0); }
  else if (e.key === 'End'){ e.preventDefault(); secFsJumpCursor(Infinity); }
  else if ((e.key === ' ' || e.key === 'Enter') && !onControl){ if (SEC_CURSOR){ e.preventDefault(); toggleDone(SEC_CURSOR); } }
  else if (e.key === 'p' || e.key === 'P'){ e.preventDefault(); setSectionView('sheet'); }
  else if (e.key === 'c' || e.key === 'C'){ e.preventDefault(); setSectionView('columns'); }
});

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
  if (!(SEC_FS && ae && ae.classList.contains('id-inp'))) renderSecFs();
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
  if (window.VIEW === 'week') renderWeek();   // a visão da semana também segue a moeda
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

/* ── a11y dos diálogos (secFsOverlay / tvOverlay) ──────────────────────────
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
  var dlg = document.querySelector('#tvOverlay.open, #secFsOverlay.open');
  if(!dlg) return;
  var foc = [].slice.call(dlg.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(function(el){ return el.getClientRects().length; });
  if(!foc.length) return;
  var first = foc[0], last = foc[foc.length-1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  else if(!dlg.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
});

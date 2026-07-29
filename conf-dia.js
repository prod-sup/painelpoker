/* =========================================================================
   CONF-DIA — CONFERÊNCIA DO DIA (GU) do Painel (index.html).
   Extraído do painel.js: módulo independente, carregado DEPOIS de
   gu-parser.js (parser da G MTTS) e do painel.js (helpers: nowInSP,
   escHtml, showToast, openDrawer/closeDrawer, addDaysISO, fbDb,
   OPERATOR_NAME, SHARED_GLOBAL/publishSharedGlobal).

   A receita COMPLETA dos eventos de hoje, lida do que o turno noturno
   publicou no Firebase (painel/{hoje}/criacaoNoturna/sheet) — ou da
   Global MTT subida aqui mesmo (aba G MTTS). Cada coluna é um torneio;
   as linhas são os campos da GU na ordem de criação; "Action" marca
   conferido em …/conf (mesma base que a Criação usa) — sincroniza.
========================================================================= */
(function guConfInit(){
  // dia operacional: antes das 05:30 a grade em vigor ainda é a de ontem (mesma regra da Criação)
  function opTodayISO(){
    const n = nowInSP();
    const d = new Date(Date.UTC(n.year, n.month-1, n.day, 12));
    if (n.hour*60 + n.minute < 330) d.setUTCDate(d.getUTCDate()-1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  const DAY_ISO = opTodayISO();
  const BASE = `painel/${DAY_ISO}/criacaoNoturna`;
  let gcSheet = null, gcConf = {}, gcIds = {}, gcAttached = false, gcSearch = '';
  let gcHideDone = false, gcSrc = null; // gcSrc = {fileName, by, at} da sheet em uso
  let gcFs = null;                      // cls da seção em tela cheia ('main'|'side'|'sat') ou null

  const gcKey = it => `${normText(it.nome)}|${it.hora}`.replace(/[.#$\[\]\/]/g,'_');   // = itemKey da Criação

  /* ── COLUNAS = MESMA LÓGICA DA CRIAÇÃO NOTURNA ──
     Os campos da receita seguem a ordem em que se DIGITA no app (cópia do
     creationOrderFields de criacao-noturna.html):
     Torneio → Game Type → K.O → Max. Table → Garantido → Ticket Award →
     Calculated Payout → Payout → Buy-in → Reentry/Rebuy → Stack Reentry/Rebuy →
     Rebuy Condition → Add-on → Stack Add-on → Break Late Reg. → Admin Fee →
     Structure → Chips → Early game → Pós Late Reg. → Final Table → Early Bird →
     Time Bank.
     Campos fora da lista entram DEPOIS, na ordem original da planilha;
     Garantido e Buy-in aparecem UMA vez; "Num. players"/"Chat" ficam fora. */
  /* ORDEM DAS COLUNAS pedida pela GU (jul/2026) — esta é a sequência do quadro,
     de cima pra baixo (a tabela é TRANSPOSTA: cada slot vira uma LINHA). "Torneio"
     e "Horário" são renderizados fixos ANTES desta lista, por isso ela começa no MTT.
     `key:true` = coluna-chave (dinheiro/estrutura crítica) que ganha destaque forte.
     Campos que a planilha traga fora desta lista (K.O, payout, time bank…) entram
     DEPOIS, esmaecidos. `once:true` = aparece uma vez só (dedup de garantido/buy-in). */
  const GC_CREATION_ORDER = [
    { m: n => n === 'mtt' },                                                          // MTT (nome curto)
    { m: n => n.includes('ticket') && n.includes('award'), key: true },              // TICKET AWARD
    { m: n => n.includes('max') && n.includes('table') },                            // MAX. TABLE
    { m: n => n.includes('early game') },                                            // Early game
    { m: n => n.includes('pos late') },                                              // Pós Late Reg. (normText tira o acento)
    { m: n => n.includes('final table') },                                           // Final Table
    { m: n => n.includes('late') && n.includes('reg') && !n.includes('break')
              && !n.includes('hour') && !n.includes('pos') && !n.includes('final') },// LATE REG.
    { m: n => n.includes('buy-in') || n.includes('buy in') || n === 'buyin', once: true, key: true }, // BUY-IN (1x)
    { m: n => n.includes('admin') && n.includes('fee'), key: true },                 // ADMIN FEE
    { m: n => n.includes('prize pool') || n.includes('guarant') || n.includes('garantido'), once: true, key: true }, // PRIZE POOL USD (1x)
    { m: n => n === 'chips' || n.includes('chip stack') || n.includes('starting stack') || n.includes('stack inicial'), key: true }, // CHIPS
    { m: n => n.includes('early bird'), key: true },                                 // EARLY BIRD (0-20% = 20% das CHIPS)
    { m: n => n.includes('rebuy') && n.includes('condition') },                      // REBUY CONDITION
    // tone: agrupa por FAMÍLIA pra psicologia das cores — o campo e o seu "stack" na mesma cor,
    // pra o olho verificar valor+stack juntos. Recompra=azul, Add-on=roxo, Modalidade=teal, Estrutura=âmbar.
    { m: n => (n.includes('reentry') || n.includes('re-entry') || n.includes('rebuy')) && !n.includes('stack') && !n.includes('condition'), tone:'rebuy' }, // REENTRY/REBUY
    { m: n => n.includes('stack') && (n.includes('reentry') || n.includes('re-entry') || n.includes('rebuy')), tone:'rebuy' }, // STACK REENTRY/REBUY
    { m: n => (n.includes('add-on') || n.includes('addon')) && !n.includes('stack'), tone:'addon' }, // ADD-ON
    { m: n => n.includes('stack') && (n.includes('add-on') || n.includes('addon')), tone:'addon' }, // STACK ADD-ON
    { m: n => (/game\s*type/.test(n) || /variante/.test(n) || /modalidade/.test(n) || n === 'game')
              && !/early\s*game/.test(n), tone:'game' },                             // Game Type
    { m: n => n.includes('structure') || n.includes('estrutura'), tone:'structure' },// STRUCTURE
    { m: n => n.includes('hour late') || n.includes('hora late') },                  // Hour late register
  ];
  // além dos campos que a Criação esconde, some o "Action" da planilha —
  // aqui a linha Action é o botão de conferido do checklist, duplicaria
  const GC_HIDDEN_RECIPE = /num\.?\s*(de\s*)?players|jogadores|\bchat\b|^action$/;
  /* ── a coluna FEE/Rake não vira linha própria ──
     Ela JÁ está dentro da linha Admin Fee: gcAdminFeeVal() monta as DUAS parcelas
     juntas ("10% = 2,20 / 2% = 0,44"), a do rake e a do admin, do mesmo jeito que
     a Criação Noturna. A linha "Fee" solta repetia o mesmo número num formato
     diferente — e duas linhas pro mesmo valor, num checklist de conferência, só
     dão margem pra alguém conferir a errada.
     Os padrões são os MESMOS do gcAdminFeeVal (inclusive o "não é admin/early"):
     se a planilha renomear a coluna um dia, os dois lugares mudam juntos ou a
     linha volta a aparecer duplicada. */
  const GC_FEE_FIELD  = /\brake\b|(^|[^a-z])fee([^a-z]|$)|taxa\s*do\s*torneio/;
  const GC_FEE_EXCETO = /admin|early|adm\.?\s*fee/;
  function gcHiddenField(label){
    const n = normText(label);
    if (GC_HIDDEN_RECIPE.test(n)) return true;
    return GC_FEE_FIELD.test(n) && !GC_FEE_EXCETO.test(n);
  }
  /* devolve [{label, hi, key}]: hi=true nas colunas da lista da GU (destacadas),
     hi=false no que sobrou (esmaecido no fim); key=true nas colunas-chave. */
  function gcOrderFields(fields){
    const remaining = fields.slice(), out = [];
    GC_CREATION_ORDER.forEach(slot => {
      let claimed = false;
      for (let i = 0; i < remaining.length; ){
        if (slot.m(normText(remaining[i]))){
          if (!claimed){
            out.push({label: remaining[i], hi: true, key: !!slot.key, tone: slot.tone || ''}); remaining.splice(i, 1); claimed = true;
            if (!slot.once) break;               // sem dedup: para no primeiro
          } else remaining.splice(i, 1);          // duplicata de Garantido/Buy-in: fora
        } else i++;
      }
    });
    return out.concat(remaining.map(label => ({label, hi: false, key: false}))); // sobra esmaecida no fim
  }
  function gcVisibleFields(){
    return gcOrderFields(((gcSheet && gcSheet.fields) || []).filter(l => !gcHiddenField(l)));
  }
  /* ── ADMIN FEE CALCULADO, igual à Criação (adminFeeParts de criacao-noturna.html):
     Rake/Fee e Admin Fee SEPARADOS na mesma linha — regra da casa: 10% do buy-in
     / +2% quando tem admin fee. Cada parcela mostra o % e o decimal do buy-in
     em dólar (sem $): ex. "10% = 2,20 / 2% = 0,44". */
  function gcDetectField(it, patterns, exclude){
    if (!it || !it.extra) return null;
    for (const label of Object.keys(it.extra)){
      const n = normText(label);
      if (exclude && exclude.test(n)) continue;
      if (patterns.some(re => re.test(n))){
        const v = it.extra[label];
        if (v !== undefined && v !== null && v !== '') return {label, raw: v};
      }
    }
    return null;
  }
  // "tem valor de fato" — número > 0, ou texto que não seja um "vazio disfarçado"
  function gcFieldActive(info){
    if (!info) return null;
    if (typeof info.raw === 'number') return info.raw > 0 ? info : null;
    return ['','0','0%','-','—','nao','no','sem','n/a','na','false','none','nenhum'].includes(normText(info.raw)) ? null : info;
  }
  // valor cru → fração percentual (0–1); número ≥ 1 em campo de fee = absoluto → % do buy-in
  function gcRawToPct(it, info){
    if (!info) return 0;
    let raw;
    if (typeof info.raw === 'number') raw = info.raw;
    else {
      const s = String(info.raw);
      raw = parseFloat(s.replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (isFinite(raw) && /%/.test(s)) raw = raw / 100;
    }
    if (!isFinite(raw) || raw <= 0) return 0;
    if (raw >= 1) return (it.buyin && it.buyin > 0) ? raw / it.buyin : 0;
    return raw;
  }
  function gcAdminFeeVal(it){
    const f = gcRawToPct(it, gcFieldActive(gcDetectField(it, [/\brake\b/, /^fee$/, /(^|[^a-z])fee([^a-z]|$)/, /taxa\s*do\s*torneio/], /admin|early|adm\.?\s*fee/)));
    const a = gcRawToPct(it, gcFieldActive(gcDetectField(it, [/admin\s*fee/, /taxa\s*administ/, /adm\.?\s*fee/], /early/)));
    if (!f && !a) return null;
    const pctTx = p => (Math.round(p * 10000) / 100).toLocaleString('pt-BR') + '%';
    const decTx = p => it.buyin != null ? ' = ' + (it.buyin * p).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
    const seg = p => pctTx(p) + decTx(p);
    return [f ? seg(f) : null, a ? seg(a) : null].filter(Boolean).join(' / ');
  }
  // formatação por TIPO do rótulo — fmtExtraVal do gu-parser.js, com escape pra ir direto no HTML
  function gcFmtExtra(label, v){
    if (v === null || v === undefined || v === '') return '—';
    return escHtml(String(fmtExtraVal(label, v)));
  }
  /* seções na MESMA ordem/divisão da Criação: Main Event / Side Event / Satélite */
  function gcSections(){
    if (!gcSheet) return [];
    const byHora = arr => [...(arr||[])].sort((a,b) => (timeToMinutes(a.hora) ?? 9999) - (timeToMinutes(b.hora) ?? 9999));
    return [
      {cls:'main', suit:'♠', label:'Main Event', items: byHora(gcSheet.main)},
      {cls:'side', suit:'♥', label:'Side Event', items: byHora(gcSheet.side)},
      {cls:'sat',  suit:'♣', label:'Satélite',   items: byHora(gcSheet.sat)},
    ].filter(s => s.items.length);
  }
  function gcItems(){ return gcSections().flatMap(s => s.items); }
  function gcToggle(key){
    if (!fbDb) { showToast('Sem conexão com o Firebase.', true); return; }
    if (gcConf[key]) fbDb.ref(`${BASE}/conf/${key}`).remove();
    else fbDb.ref(`${BASE}/conf/${key}`).set({by: OPERATOR_NAME || 'Alguém', at: Date.now()});
  }

  /* ── FONTE DA SHEET EM USO — quem subiu, quando, que arquivo.
     Alerta quando a planilha tem mais de 12h: a GU corrige a Global durante o
     dia e uma versão velha pode estar desatualizada. */
  function gcRenderSrc(){
    const el = document.getElementById('guConfSrc');
    if (!el) return;
    if (!gcSrc || !gcSrc.at){ el.hidden = true; return; }
    const ageMs = Date.now() - gcSrc.at;
    const ageH = ageMs / 3600000;
    const age = ageH < 1 ? `${Math.max(1, Math.round(ageMs/60000))} min` : `${Math.round(ageH)}h`;
    const stale = ageH >= 12;
    el.hidden = false;
    el.classList.toggle('is-stale', stale);
    el.innerHTML = `${stale ? '⚠ ' : ''}Fonte: <b>${escHtml(gcSrc.fileName || 'planilha publicada')}</b> — por ${escHtml(gcSrc.by || 'alguém')}, há ${age}${stale ? ' — pode existir Global mais nova, confira antes de fechar a conferência' : ''}`;
  }

  /* ── DIFF GU × VERSÃO ANTERIOR — mesma ideia do computeChanges da Criação:
     a GU corrige a Global ao longo do dia; ao subir uma versão nova, o que
     mudou em relação ao que a equipe já estava conferindo precisa GRITAR. */
  function gcComputeChanges(oldSheet, newSheet){
    if (!oldSheet) return [];
    const flat = sh => [...(sh.main||[]), ...(sh.side||[]), ...(sh.sat||[])];
    const oldMap = new Map(flat(oldSheet).map(it => [gcKey(it), it]));
    const newMap = new Map(flat(newSheet).map(it => [gcKey(it), it]));
    const changes = [];
    newMap.forEach((it, key) => {
      const old = oldMap.get(key);
      if (!old){ changes.push(`+ ${it.hora} ${it.nome} — NOVO na grade`); return; }
      const diffs = [];
      if ((old.garantido ?? null) !== (it.garantido ?? null)) diffs.push(`Garantido ${old.garantido ?? '—'} → ${it.garantido ?? '—'}`);
      if ((old.buyin ?? null) !== (it.buyin ?? null)) diffs.push(`Buy-in ${old.buyin ?? '—'} → ${it.buyin ?? '—'}`);
      const labels = new Set([...Object.keys(old.extra || {}), ...Object.keys(it.extra || {})]);
      labels.forEach(l => {
        const a = old.extra ? old.extra[l] : undefined, b = it.extra ? it.extra[l] : undefined;
        if (String(a ?? '') !== String(b ?? '')) diffs.push(`${l}: ${fmtExtraVal(l, a) ?? '—'} → ${fmtExtraVal(l, b) ?? '—'}`);
      });
      if (diffs.length) changes.push(`≠ ${it.hora} ${it.nome} — ${diffs.join(' · ')}`);
    });
    oldMap.forEach((it, key) => {
      if (!newMap.has(key)) changes.push(`− ${it.hora} ${it.nome} — SAIU da grade`);
    });
    return changes;
  }
  function gcAlertsHtml(){
    const ch = (gcSheet && gcSheet.changes) || [];
    if (!ch.length) return '';
    const rows = ch.slice(0, 40).map(c => `<div class="row">${escHtml(c)}</div>`).join('');
    return `<div class="gc-alerts"><div class="ttl">⚠ ${ch.length} alteração(ões) em relação à versão anterior da Global — revise antes de confiar no que já foi conferido:</div>${rows}${ch.length > 40 ? `<div class="row">…e mais ${ch.length - 40}.</div>` : ''}</div>`;
  }

  function gcRender(){
    const area = document.getElementById('guConfArea');
    // A Conferência é TRANSPOSTA: cada seção rola na HORIZONTAL (torneios = colunas).
    // Marcar um ✓ dispara o listener do Firebase → re-render → o scroll caía pro
    // começo, e quem estava num horário avançado tinha que arrastar tudo de novo.
    // Guardamos o scroll (horizontal por seção + vertical do drawer) e restauramos.
    // cada seção (.gc-scroll) rola nas DUAS direções: horizontal (torneios = colunas) e
    // VERTICAL (campos = linhas, com max-height própria). O bug era guardar só o scrollLeft —
    // quem estava lá embaixo (Structure/Add-on) e marcava o ✓ (linha Action, no fim) voltava
    // pro topo. Guardamos scrollLeft E scrollTop de cada seção + o vertical do drawer.
    const _prevSc = {};
    area.querySelectorAll('.gc-secwrap').forEach(w => {
      const sc = w.querySelector('.gc-scroll');
      if (sc) _prevSc[w.dataset.sec] = { x: sc.scrollLeft, y: sc.scrollTop };
    });
    const _scroller = area.closest('.drawer-body') || area;
    const _prevY = _scroller ? _scroller.scrollTop : 0;
    const dayLbl = document.getElementById('guConfDayLbl');
    const [y,m,d] = DAY_ISO.split('-');
    dayLbl.textContent = `${d}/${m}`;
    gcRenderSrc();
    const items = gcItems();
    const noIdPill = document.getElementById('guConfNoId');
    if (!items.length){
      area.innerHTML = `<div class="gc-empty"><span class="ic gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg></span>Nenhuma receita publicada pra hoje (${d}/${m}).<br>O turno noturno sobe a GU na página de Criação — ou carregue a <b>Global MTT</b> no botão acima que ela aparece aqui na hora.</div>`;
      document.getElementById('guConfProgress').textContent = '—';
      document.getElementById('guConfBadge').hidden = true;
      if (noIdPill) noIdPill.hidden = true;
      return;
    }
    const total = items.length, done = items.filter(it => gcConf[gcKey(it)]).length;
    document.getElementById('guConfProgress').textContent = `${done}/${total} conferidos`;
    document.getElementById('guConfBarFill').style.transform = `scaleX(${total ? done/total : 0})`;
    const badge = document.getElementById('guConfBadge');
    badge.hidden = false; badge.textContent = `${done}/${total}`;
    // torneios ainda sem ID Pokerbyte = candidatos a "esqueceram de criar no app"
    const noIdCount = items.filter(it => !gcIds[gcKey(it)]).length;
    if (noIdPill){
      noIdPill.hidden = noIdCount === 0;
      noIdPill.textContent = `${noIdCount} sem ID Pokerbyte`;
    }
    const q = normText(gcSearch);
    // TRANSPOSTO, igual à Criação: campos nas linhas, torneios nas colunas, por seção
    let html = gcAlertsHtml();
    gcSections().forEach(sec => {
      let vis = q ? sec.items.filter(it => normText(it.nome).includes(q)) : sec.items;
      if (gcHideDone) vis = vis.filter(it => !gcConf[gcKey(it)]);
      if (!vis.length) return;
      const cols = vis.map(it => {
        const key = gcKey(it);
        return {it, key, ok: !!gcConf[key], by: gcConf[key] && gcConf[key].by ? String(gcConf[key].by).split(' ')[0] : ''};
      });
      const secDone = sec.items.filter(it => gcConf[gcKey(it)]).length;
      const cell = (fn, cls) => cols.map(c => `<td class="${c.ok ? 'gc-ok' : ''} ${cls || ''}">${fn(c)}</td>`).join('');
      let t = `<tr class="gc-head"><th class="gc-rowlab">Torneio</th>${cell(c => escHtml(c.it.nome), 'gc-name')}</tr>`;
      t += `<tr><th class="gc-rowlab key">Horário</th>${cell(c => escHtml(c.it.hora || '—'), 'gc-time')}</tr>`;
      // colunas na ordem/destaque da GU (gcVisibleFields → {label, hi, key})
      gcVisibleFields().forEach(f => {
        const label = f.label, n = normText(label);
        // Admin Fee sai já CALCULADA (Rake 10% / +2%, com o decimal do buy-in), igual à Criação
        const isAdmin = /admin\s*fee|taxa\s*administ|adm\.?\s*fee/.test(n) && !/early/.test(n);
        const val = c => {
          if (isAdmin){ const af = gcAdminFeeVal(c.it); if (af) return escHtml(af); }
          return gcFmtExtra(label, c.it.extra ? c.it.extra[label] : undefined);
        };
        const toneCls = f.tone ? ` gc-tone gc-tone-${f.tone}` : '';
        const labCls = `${f.key ? 'gc-key' : ''} ${f.hi ? 'gc-hi' : 'gc-dim'}`.trim();
        t += `<tr class="${f.key ? 'gc-keyrow' : ''}${toneCls}"><th class="gc-rowlab ${labCls}" title="${escHtml(label)}">${escHtml(label)}</th>${cell(val, /chips|prize pool|buy-?in|ticket|admin\s*fee/.test(n) ? 'gc-num' : '')}</tr>`;
      });
      t += `<tr><th class="gc-rowlab">ID Pokerbyte</th>${cell(c => gcIds[c.key] ? escHtml(gcIds[c.key].val) : '<span class="gc-noid" title="Sem ID cadastrado — confira se o torneio foi criado no app">sem ID</span>', 'gc-num')}</tr>`;
      t += `<tr><th class="gc-rowlab key">Action</th>${cell(c =>
        `<button class="gc-chk ${c.ok ? 'on' : ''}" data-gckey="${escHtml(c.key)}" title="${c.ok ? 'Conferido por ' + escHtml(c.by) : 'Marcar como conferido'}"><svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 6.5"/></svg></button>${c.by ? `<span class="gc-by">${escHtml(c.by)}</span>` : ''}`, 'gc-act')}</tr>`;
      html += `
        <div class="gc-secwrap" data-sec="${sec.cls}">
          <div class="gc-sec ${sec.cls}">
            <span class="tag"><span class="suit">${sec.suit}</span>${sec.label}</span>
            <span class="cnt">${secDone}/${sec.items.length} conferidos</span>
            <span class="line"></span>
            <button class="gc-fs-btn" type="button" data-fs="${sec.cls}" title="Tela cheia deste quadro (Esc pra sair)" aria-label="Tela cheia deste quadro">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            </button>
          </div>
          <div class="gc-scroll"><table class="gc-table">${t}</table></div>
        </div>`;
    });
    area.innerHTML = html || `<div class="gc-empty"><span class="ic"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C7 8 3 12 3 15.5A4 4 0 0 0 11 17.3C10.6 19.4 9.5 20.6 7 21.5H17C14.5 20.6 13.4 19.4 13 17.3A4 4 0 0 0 21 15.5C21 12 17 8 12 3Z"/></svg></span>Nada nesse filtro.</div>`;
    // restaura o scroll guardado no topo da função — POR SEÇÃO (data-sec, robusto a filtro/ordem).
    // Faz na hora E de novo no próximo frame: logo após o innerHTML o layout ainda não terminou e
    // atribuir scrollTop grudava em 0 (era ISSO que jogava tudo pro topo); o rAF roda já com a
    // altura calculada, então cola de verdade.
    const _restoreScroll = () => {
      area.querySelectorAll('.gc-secwrap').forEach(w => {
        const p = _prevSc[w.dataset.sec]; if (!p) return;
        const sc = w.querySelector('.gc-scroll');
        if (sc){ sc.scrollLeft = p.x; sc.scrollTop = p.y; }
      });
      if (_scroller && _prevY) _scroller.scrollTop = _prevY;
    };
    _restoreScroll();
    requestAnimationFrame(_restoreScroll);
    area.querySelectorAll('[data-gckey]').forEach(b => b.addEventListener('click', () => gcToggle(b.dataset.gckey)));
    // tela cheia por quadro — liga os botões e reaplica o estado após o re-render
    area.querySelectorAll('[data-fs]').forEach(b => b.addEventListener('click', () => gcToggleFs(b.dataset.fs)));
    if (gcFs){
      const w = area.querySelector(`.gc-secwrap[data-sec="${gcFs}"]`);
      if (w) w.classList.add('gc-fs'); else gcSetFs(null);
    }
  }
  /* TELA CHEIA POR QUADRO — expande UMA seção sobre a tela toda (CSS position:fixed,
     transição fluida). Estado guardado em gcFs pra sobreviver ao re-render do Firebase. */
  function gcSetFs(cls){
    gcFs = cls;
    document.body.classList.toggle('gc-fs-lock', !!cls);
    // expande o drawer a 100vw pra o inset:0 do quadro cobrir a viewport (ver painel.css)
    const drawer = document.getElementById('guConfDrawer');
    if (drawer) drawer.classList.toggle('gc-has-fs', !!cls);
  }
  function gcToggleFs(cls){
    const area = document.getElementById('guConfArea');
    const w = area && area.querySelector(`.gc-secwrap[data-sec="${cls}"]`);
    if (!w) return;
    const on = !w.classList.contains('gc-fs');
    // só uma seção em tela cheia por vez
    area.querySelectorAll('.gc-secwrap.gc-fs').forEach(el => el.classList.remove('gc-fs'));
    if (on) w.classList.add('gc-fs');
    gcSetFs(on ? cls : null);
  }
  // Esc sai da tela cheia (sem fechar o drawer)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && gcFs){ e.stopPropagation(); gcToggleFs(gcFs); }
  }, true);
  function gcAttach(){
    if (gcAttached || !fbDb) return;
    /* só com auth viva: leitura negada CANCELA o listener (mesma corrida do
       Painel do Dia). Sem usuário ainda, espera o onAuthStateChanged e re-tenta. */
    if (!(window.firebase && firebase.auth && firebase.auth().currentUser)){
      if (!gcAttach._waiting && window.firebase && firebase.auth){
        gcAttach._waiting = true;
        firebase.auth().onAuthStateChanged(u => { if (u) gcAttach(); });
      }
      return;
    }
    gcAttached = true;
    // ECONOMIA DE BANDA: observa só o timestamp; baixa a grade (json pesado) com
    // .once() SÓ quando muda — antes o .on('value') rebaixava a grade a cada reconexão.
    fbDb.ref(`${BASE}/sheet/at`).on('value', tsSnap => {
      const at = tsSnap.val();
      if (!at || `${at}` === `${window._gcSheetLastTs}`) return;
      window._gcSheetLastTs = `${at}`;
      fbDb.ref(`${BASE}/sheet`).once('value').then(s => {
        const v = s.val();
        if (v && v.json){
          try{
            gcSheet = JSON.parse(v.json);
            gcSrc = {fileName: gcSheet.fileName || '', by: v.by || '', at: v.at || 0};
          }catch(e){ console.error('guConf: sheet corrompida', e); }
        }
        gcRender();
      }).catch(()=>{ window._gcSheetLastTs = null; });
    });
    fbDb.ref(`${BASE}/conf`).on('value', s => { gcConf = s.val() || {}; gcRender(); });
    fbDb.ref(`${BASE}/ids`).on('value', s => { gcIds = s.val() || {}; gcRender(); });
  }
  // o fbDb só existe depois do init do Firebase — tenta já e re-tenta até conectar
  gcAttach();
  const gcRetry = setInterval(() => { gcAttach(); if (gcAttached) clearInterval(gcRetry); }, 2000);

  /* ── GU DIRETO NO PAINEL (upload ou Global compartilhada) ──
     Lê a aba G MTTS da Global MTT com o gu-parser.js (o MESMO parser da
     Criação Noturna — uma fonte só), monta a grade do dia OPERACIONAL de
     hoje (06:10 de hoje → 05:30 de amanhã) e publica no MESMO caminho do
     Firebase que a Criação usa — a tabela aparece na hora e os ✓ de
     Action sincronizam com a equipe do mesmo jeito. */
  const gcWeekdayEn = iso => WEEKDAYS_EN[new Date(iso + 'T12:00:00Z').getUTCDay()];
  function gcProcessGlobal(arrayBuffer, fileName){
    const matrix = readSheetMatrix(arrayBuffer, 'G MTTS');
    const headerCols = findHeaderCols(matrix);
    if (!headerCols) throw new Error('Não encontrei o cabeçalho da aba G MTTS (MTT MARKETING / TYPE / BUY-IN…) — é a Global MTT certa?');
    const secToday = extractGuDaySection(matrix, gcWeekdayEn(DAY_ISO), headerCols);
    if (!secToday) throw new Error(`Não encontrei a seção "${gcWeekdayEn(DAY_ISO)}" na aba G MTTS — é a Global MTT certa?`);
    const secNext = extractGuDaySection(matrix, gcWeekdayEn(addDaysISO(DAY_ISO, 1)), headerCols);
    const sections = buildSections(secToday, secNext);       // janela 06:10 → 05:30, cronológico
    const fields = headerCols.filter(c => !isCoreLabel(c.label)).map(c => c.label);
    const total = sections.main.length + sections.side.length + sections.sat.length;
    if (!total) throw new Error('Nenhum torneio na janela de hoje (06:10 → 05:30) nessa planilha.');
    // avisos do parser — os mesmos que a Criação mostra
    const semHora = [...secToday.semHora, ...(secNext ? secNext.semHora : [])];
    if (semHora.length) showToast(`Atenção: ${semHora.length} torneio(s) sem horário reconhecível ficaram de fora: ${semHora.map(x=>x.nome).slice(0,3).join(', ')}${semHora.length>3?'…':''}`, true);
    if (secToday.duplicateSection || (secNext && secNext.duplicateSection)) showToast('Atenção: nome de dia duplicado na planilha — confira se a seção usada é a certa.', true);
    if (sections.unknown.length) showToast(`Atenção: ${sections.unknown.length} torneio(s) com tipo não reconhecido na coluna TYPE ficaram de fora.`, true);
    if (sections.tipoColMissing) showToast('⚠ Coluna TYPE não encontrada — classifiquei tudo pelo nome/garantido. Confira a divisão Main/Side.', true);
    // diff contra o que a equipe já estava conferindo (publicado pelo noturno ou por upload anterior)
    const changes = gcComputeChanges(gcSheet, sections);
    gcSheet = {...sections, fields, fileName, changes};
    gcSrc = {fileName, by: OPERATOR_NAME || 'você', at: Date.now()};
    gcRender();
    if (changes.length) showToast(`⚠ ${changes.length} alteração(ões) em relação à versão anterior — veja o quadro amarelo.`, true);
    if (fbDb){
      fbDb.ref(`${BASE}/sheet`).set({
        json: JSON.stringify({main: sections.main, side: sections.side, sat: sections.sat, unknown: sections.unknown, fields, fileName, changes}),
        by: OPERATOR_NAME || 'Alguém', at: Date.now()
      });
      showToast(`GU carregada — ${total} torneios de hoje, compartilhada com a equipe.`);
    } else {
      showToast(`GU carregada — ${total} torneios de hoje (só neste navegador, sem conexão pra compartilhar).`);
    }
    return total;
  }

  document.getElementById('guConfFileInput').addEventListener('change', async function(e){
    const file = e.target.files[0];
    if (!file) return;
    const lbl = document.getElementById('guConfFileLabel');
    const box = document.getElementById('guConfUploadLabel');
    if (typeof XLSX === 'undefined'){
      showToast('A biblioteca de planilhas ainda está carregando — aguarde 2 segundos e tente de novo.', true);
      e.target.value = ''; return;
    }
    lbl.textContent = 'Lendo…';
    // deixa o navegador pintar "Lendo…" antes do parse pesado do XLSX
    // (com fallback de timeout: em aba oculta o requestAnimationFrame não dispara)
    await new Promise(r => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 200); });
    try{
      const arrayBuffer = await file.arrayBuffer();
      gcProcessGlobal(arrayBuffer, file.name);
      lbl.textContent = file.name;
      box.classList.add('is-loaded');
      // compartilha o ARQUIVO inteiro também (painel/globalMtt) — as outras
      // ferramentas e o parceiro reaproveitam sem subir de novo
      if (typeof publishSharedGlobal === 'function') publishSharedGlobal(arrayBuffer, file.name);
    }catch(err){
      console.error('guConf: erro no upload da GU', err);
      showToast(err && err.message ? err.message : 'Erro ao ler a planilha — confira se é a Global MTT (.xlsx).', true);
      lbl.textContent = 'Carregar Global MTT (.xlsx)';
      box.classList.remove('is-loaded');
    }
    e.target.value = '';
  });

  // botão "usar a Global compartilhada" — o arquivo que alguém da equipe já subiu hoje
  const gcSharedBtn = document.getElementById('guConfSharedBtn');
  if (gcSharedBtn) gcSharedBtn.addEventListener('click', () => {
    const sg = window.SHARED_GLOBAL;
    if (!sg || !sg.buf){ showToast('Nenhuma Global compartilhada disponível.', true); return; }
    try{
      gcProcessGlobal(sg.buf.slice(0), sg.filename);
      const lbl = document.getElementById('guConfFileLabel');
      lbl.textContent = sg.filename;
      document.getElementById('guConfUploadLabel').classList.add('is-loaded');
    }catch(err){
      console.error('guConf: erro na Global compartilhada', err);
      showToast(err && err.message ? err.message : 'Erro ao ler a Global compartilhada.', true);
    }
  });

  // fecha o drawer saindo antes de qualquer quadro em tela cheia
  function gcCloseDrawer(){
    if (gcFs) gcToggleFs(gcFs);
    closeDrawer('guConfDrawerOverlay');
  }
  document.getElementById('guConfToggle').addEventListener('click', () => { openDrawer('guConfDrawerOverlay'); gcAttach(); gcRender(); });
  document.getElementById('guConfDrawerClose').addEventListener('click', gcCloseDrawer);
  document.getElementById('guConfDrawerOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'guConfDrawerOverlay') gcCloseDrawer();
  });
  let gcSearchT = null;
  document.getElementById('guConfSearch').addEventListener('input', function(){
    clearTimeout(gcSearchT);
    gcSearchT = setTimeout(() => { gcSearch = this.value; gcRender(); }, 150);
  });
  const gcHideBtn = document.getElementById('guConfHideDoneBtn');
  if (gcHideBtn) gcHideBtn.addEventListener('click', function(){
    gcHideDone = !gcHideDone;
    this.classList.toggle('active', gcHideDone);
    gcRender();
  });
})();

/* ── SUPREMA OS · COPILOTO (Claude) — "Pergunte ao Suprema OS" ──────────────
   Cliente do copiloto de IA. O repo é PÚBLICO, então a chave da Anthropic vive
   numa Cloud Function própria (copiloto/functions → supremaCopiloto), que guarda o
   secret e chama o Claude. Aqui só montamos a pergunta + um snapshot do estado
   atual, mandamos com o ID token do Firebase Auth (gate) e mostramos a resposta.

   Cada painel registra o que sabe:  SupremaCopiloto.setSnapshot(() => ({...}))
   Sem provider, manda um snapshot mínimo raspado do hero. Auto-registra uma
   entrada no ⌘K ("Perguntar à IA") se a SupremaPalette existir. ── */
(function (global) {
  'use strict';
  if (global.SupremaCopiloto) return;

  // URL da function (v2, projeto design-1-53c00). Sobrescreva com
  // window.SUPREMA_COPILOTO_URL se o deploy sair em outro nome/região.
  var ENDPOINT = global.SUPREMA_COPILOTO_URL ||
    'https://us-central1-design-1-53c00.cloudfunctions.net/supremaCopiloto';

  var snapshotProvider = null;
  var PANEL = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');

  function setSnapshot(fn){ if (typeof fn === 'function') snapshotProvider = fn; }

  /* snapshot padrão: raspa os stats do hero (garantido/premiação/overlay…) */
  function defaultSnapshot(){
    var stats = {};
    document.querySelectorAll('.hstat').forEach(function (el){
      var label = (el.querySelector('.hstat-label, .label, h3, span') || {}).textContent;
      var val = (el.querySelector('.hstat-value, .value, b, strong') || {}).textContent;
      if (label && val) stats[label.trim()] = val.trim();
    });
    return { stats: stats, url: location.href };
  }

  function buildSnapshot(){
    try { return snapshotProvider ? snapshotProvider() : defaultSnapshot(); }
    catch (e){ return defaultSnapshot(); }
  }

  /* ID token do Firebase Auth — o gate do backend exige. */
  function idToken(){
    try {
      var u = global.firebase && firebase.auth && firebase.auth().currentUser;
      return u ? u.getIdToken() : Promise.resolve(null);
    } catch (e){ return Promise.resolve(null); }
  }

  /* ── UI (glass escuro, reaproveita a linguagem do ⌘K) ── */
  function injectCss(){
    if (document.getElementById('sc-css')) return;
    var css =
      '.sc-back{position:fixed;inset:0;z-index:2147483200;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px;background:rgba(6,10,8,.55);opacity:0;pointer-events:none;transition:opacity .18s}'
      + '.sc-back.on{opacity:1;pointer-events:auto}'
      + '@supports (backdrop-filter:blur(2px)){.sc-back{backdrop-filter:blur(6px) saturate(120%);-webkit-backdrop-filter:blur(6px) saturate(120%)}}'
      + '.sc-panel{width:min(640px,100%);max-height:76vh;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,#141917,#0e1210);border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 24px 60px -12px rgba(0,0,0,.7);font-family:var(--sup-text,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);color:#eef2ef}'
      + '.sc-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid rgba(255,255,255,.08)}'
      + '.sc-head .sc-spark{color:#c9a84c;font-size:16px}'
      + '.sc-head b{font-size:14px;font-weight:600;flex:1}'
      + '.sc-head .sc-x{background:none;border:none;color:#6d766f;cursor:pointer;font-size:18px;line-height:1;padding:4px;border-radius:8px}'
      + '.sc-head .sc-x:hover{color:#eef2ef;background:rgba(255,255,255,.1)}'
      + '.sc-q{padding:13px 18px 4px;font-size:13px;color:#a6b0aa}'
      + '.sc-q b{color:#eef2ef;font-weight:600}'
      + '.sc-body{padding:10px 18px 20px;overflow-y:auto;font-size:14.5px;line-height:1.6;white-space:pre-wrap}'
      + '.sc-body a{color:#c9a84c}'
      + '.sc-load{display:flex;align-items:center;gap:9px;color:#a6b0aa;font-size:13.5px;padding:8px 0}'
      + '.sc-dot{width:8px;height:8px;border-radius:50%;background:#18a36b;animation:sc-pulse 1s ease-in-out infinite}'
      + '@keyframes sc-pulse{0%,100%{opacity:1}50%{opacity:.3}}'
      + '@media (prefers-reduced-motion:reduce){.sc-dot{animation:none}}'
      + '.sc-err{color:#f0603f}'
      + '.sc-foot{padding:9px 18px;border-top:1px solid rgba(255,255,255,.07);font-family:var(--sup-mono,ui-monospace,monospace);font-size:10px;color:#6d766f}';
    var st = document.createElement('style'); st.id = 'sc-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  var back, qEl, bodyEl, lastFocus;
  function build(){
    injectCss();
    back = document.createElement('div');
    back.className = 'sc-back';
    back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'Copiloto do Suprema OS');
    back.innerHTML =
      '<div class="sc-panel">'
      + '<div class="sc-head"><span class="sc-spark">&#10022;</span><b>Copiloto &middot; pergunte ao Suprema OS</b><button class="sc-x" aria-label="Fechar">&times;</button></div>'
      + '<div class="sc-q"></div>'
      + '<div class="sc-body" aria-live="polite"></div>'
      + '<div class="sc-foot">respostas geradas por IA a partir do estado atual &middot; confira antes de agir</div>'
      + '</div>';
    document.body.appendChild(back);
    qEl = back.querySelector('.sc-q');
    bodyEl = back.querySelector('.sc-body');
    back.querySelector('.sc-x').addEventListener('click', close);
    back.addEventListener('click', function (e){ if (e.target === back) close(); });
    document.addEventListener('keydown', function (e){ if (e.key === 'Escape' && back.classList.contains('on')) close(); });
  }
  function open(){ if (!back) build(); lastFocus = document.activeElement; back.classList.add('on'); }
  function close(){ if (back){ back.classList.remove('on'); if (lastFocus && lastFocus.focus) try{ lastFocus.focus(); }catch(e){} } }

  /* escapa texto e transforma **negrito** simples em <b> (o Claude usa markdown leve) */
  function fmt(t){
    var esc = String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  function ask(question){
    question = String(question || '').trim();
    if (!question) return;
    open();
    qEl.innerHTML = '<b>Pergunta:</b> ' + fmt(question);
    bodyEl.innerHTML = '<div class="sc-load"><span class="sc-dot"></span>Pensando…</div>';

    idToken().then(function (tok){
      if (!tok){ bodyEl.innerHTML = '<div class="sc-err">Faça login no hub para usar o Copiloto.</div>'; return; }
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ question: question, snapshot: buildSnapshot(), panel: PANEL })
      }).then(function (r){ return r.json().then(function (j){ return { ok: r.ok, j: j }; }); })
        .then(function (res){
          if (!res.ok){ bodyEl.innerHTML = '<div class="sc-err">' + fmt((res.j && res.j.error) || 'Erro no Copiloto.') + '</div>'; return; }
          bodyEl.innerHTML = fmt((res.j && res.j.answer) || 'Sem resposta.');
        });
    }).catch(function (e){
      bodyEl.innerHTML = '<div class="sc-err">Sem conexão com o Copiloto. Tente de novo.</div>';
    });
  }

  global.SupremaCopiloto = { ask: ask, setSnapshot: setSnapshot, open: open, close: close };

  /* auto-registra no ⌘K: "Perguntar à IA: <o que você digitou>" */
  if (global.SupremaPalette && typeof SupremaPalette.register === 'function'){
    SupremaPalette.register({
      id: 'copiloto', group: 'Copiloto',
      search: function (q){
        q = String(q || '').trim();
        if (q.length < 3) return [];   // só aparece quando há uma pergunta de verdade
        return [{
          title: 'Perguntar à IA: “' + q + '”',
          sub: 'Responde a partir do estado atual do painel',
          icon: '✦', hint: 'IA',
          run: function (){ ask(q); }
        }];
      }
    });
  }
})(window);

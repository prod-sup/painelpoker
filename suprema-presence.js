/* =========================================================================
   SUPREMA-PRESENCE — presença ao vivo compartilhada por TODOS os painéis.
   Mesma lógica do Painel do Dia: cada aba escreve sua sessão em presence/{sid}
   (node GLOBAL, então quem está em qualquer painel aparece pra todo mundo), com
   nome + ÍCONE (emoji), MOLDURA conquistada (tier de XP) e TÍTULO equipado.
   Renderiza os avatares no elemento #presenceWrap da página.

   Como usar num painel:
     1) tenha um <div id="presenceWrap" hidden></div> na barra de topo;
     2) inclua <script src="suprema-presence.js"></script> depois do firebase
        e do suprema-auth. O módulo se vira sozinho: espera o firebase inicializar,
        espera a autenticação, lê o perfil do operador e começa a bater presença.

   Leitura por filho (child_added/changed/removed) de propósito: um .on('value')
   no node inteiro relê todos a cada mudança — foi o que estourou o egress antes.
========================================================================= */
(function (global) {
  'use strict';
  if (global.SupremaPresence) return;

  var AV_KEY = 'suprema_user_avatar_v1';   // ícone (emoji) — mesmo nome que hub/painel usam
  var TIER_KEY = 'suprema_user_frame_v1';  // moldura equipada (0..7)
  var TITLE_KEY = 'suprema_user_title_v1'; // id da tag/título equipado
  var STALE_MS = 3 * 60 * 1000;            // sem heartbeat há 3min = offline
  var SID = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  /* espelho dos TITLES do hub (id -> nome legível) */
  var TITLES = {
    novato: 'Novato na mesa', regular: 'Regular', operador: 'Operador', grinder: 'Grinder',
    tubarao: 'Tubarão', especialista: 'Especialista', highroller: 'High Roller', controlador: 'Controlador',
    arquiteto: 'Arquiteto', mestremesas: 'Mestre das Mesas', supervisor: 'Supervisor', veterano: 'Veterano',
    lenda: 'Lenda da casa', imortal: 'Imortal', tita: 'Titã Suprema'
  };
  /* cores dos avatares de iniciais (quem não escolheu emoji) */
  var COLORS = ['#18a36b', '#2563eb', '#8b5cf6', '#0ea5a0', '#d8b56d'];

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

  /* sessão do Suprema OS — usa SupremaAuth se presente (painéis), senão lê direto
     o localStorage (o hub não carrega suprema-auth.js, tem sessão própria inline) */
  var SESSION_KEY = 'suprema_session_v1';
  function readSession() {
    if (global.SupremaAuth && global.SupremaAuth.getSession) return global.SupremaAuth.getSession();
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.email || !s.expiresAt || Date.now() > s.expiresAt) return null;
      return s;
    } catch (e) { return null; }
  }
  function emailToKey(email) {
    if (global.SupremaAuth && global.SupremaAuth.emailToKey) return global.SupremaAuth.emailToKey(email);
    return String(email).toLowerCase().trim().replace(/\./g, '_dot_').replace(/@/g, '_at_');
  }

  function myAvatar() { return ls(AV_KEY) || null; }
  function myTier() { var v = ls(TIER_KEY); return v == null || v === '' ? null : Math.max(0, Math.min(7, +v)); }
  function myTitleId() { return ls(TITLE_KEY) || null; }
  function titleName(id) { return id ? (TITLES[id] || null) : null; }

  /* rótulos de cada painel — espelho de SupremaAuth.PANELS + o hub (launcher).
     Duplicado aqui de propósito: o hub não carrega suprema-auth.js, então o
     módulo precisa saber os nomes por conta própria pros tooltips "em <painel>". */
  var EXTRA_LABELS = {
    hub: 'Suprema OS', painel: 'Painel do Dia', gu: 'Criação Noturna',
    cash: 'Cash Intelligence', admin: 'Admin', learn: 'Poker Learn', org: 'A Constelação'
  };

  /* qual painel é este? deriva do arquivo atual via SupremaAuth.PANELS (file->label) */
  function currentPanel() {
    var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase() || 'index.html';
    if (file === 'hub.html') return { id: 'hub', label: EXTRA_LABELS.hub };
    var panels = (global.SupremaAuth && global.SupremaAuth.PANELS) || [];
    for (var i = 0; i < panels.length; i++) if (panels[i].file && panels[i].file.toLowerCase() === file) return panels[i];
    return { id: '', label: '' };
  }
  var PANEL = currentPanel();
  function panelLabelById(id) {
    if (EXTRA_LABELS[id]) return EXTRA_LABELS[id];
    var panels = (global.SupremaAuth && global.SupremaAuth.PANELS) || [];
    for (var i = 0; i < panels.length; i++) if (panels[i].id === id) return panels[i].label;
    return '';
  }

  /* nome do operador logado */
  function operatorName() {
    var s = readSession();
    if (!s) return null;
    return s.displayName || s.apelido || s.nome || (s.email ? s.email.split('@')[0] : null) || 'Alguém';
  }

  /* injeta o CSS uma vez (self-contained; não depende do painel.css) */
  function injectCss() {
    if (document.getElementById('sp-presence-css')) return;
    var st = document.createElement('style');
    st.id = 'sp-presence-css';
    st.textContent =
      /* chip de vidro: o cluster vira um objeto intencional na nav, com pulso
         "ao vivo". Cada painel nomeia seus tokens de um jeito (hub: --bg-raise;
         painel/criação: --card; admin: --s1; cash: --surf) — a cadeia de
         fallbacks resolve a superfície/linha/verde certos em QUALQUER painel,
         nos dois temas, sem cor fixa que quebre no claro. */
      '#presenceWrap{' +
        '--sp-surf:var(--bg-raise,var(--card,var(--s1,var(--surf,var(--bg,#111412)))));' +
        '--sp-line:var(--hairline,var(--border,var(--bdr,rgba(128,128,128,.16))));' +
        '--sp-live:var(--felt,var(--green,#18a36b));' +
        'display:flex;align-items:center;gap:0;' +
        'padding:3px 10px 3px 5px;border-radius:99px;' +
        'border:1px solid var(--sp-line);' +
        'background:color-mix(in srgb, var(--sp-surf) 55%, transparent)}' +
      '#presenceWrap::after{content:"";width:6px;height:6px;border-radius:99px;flex:none;margin-left:9px;' +
        'background:var(--sp-live);box-shadow:0 0 0 3px color-mix(in srgb, var(--sp-live) 22%, transparent);' +
        'animation:sp-pulse 2.6s ease-in-out infinite}' +
      '#presenceWrap[hidden]{display:none}' +
      '.sp-av{position:relative;width:26px;height:26px;border-radius:50%;flex:none;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font:700 10px/1 system-ui,sans-serif;color:#fff;' +
        'border:2px solid var(--sp-surf);margin-left:-7px;' +
        'box-shadow:0 2px 6px rgba(0,0,0,.22);animation:sp-pop .4s cubic-bezier(.2,.8,.2,1) backwards;' +
        'transition:transform .25s cubic-bezier(.2,.8,.2,1)}' +
      '.sp-av:first-child{margin-left:0}' +
      /* hover: o avatar levanta e sobe na pilha — dá pra ver quem é */
      '.sp-av:hover{transform:translateY(-2px) scale(1.12);z-index:3}' +
      '.sp-av.emoji{background:linear-gradient(145deg,#1d7a52,#0f4a31) !important}' +
      '.sp-emoji{font-size:15px;line-height:1}' +
      '.sp-more{background:#6b7280 !important;font-size:9px}' +
      '@keyframes sp-pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}' +
      '@keyframes sp-pulse{0%,100%{opacity:.55}50%{opacity:1}}' +
      '@media (prefers-reduced-motion:reduce){.sp-av{animation:none;transition:none}#presenceWrap::after{animation:none}}' +
      /* molduras conquistadas (tier 0..7) — aro por máscara, estático */
      '.sp-av[data-tier]{--fa:120deg}' +
      '.sp-av[data-tier]::before{content:"";position:absolute;inset:-3px;border-radius:inherit;pointer-events:none;z-index:1;padding:2px;' +
        '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
        '-webkit-mask-composite:xor;mask-composite:exclude}' +
      '.sp-av[data-tier="0"]::before{background:linear-gradient(150deg,#3b3e44,#2a2c31)}' +
      '.sp-av[data-tier="1"]::before{background:conic-gradient(from var(--fa),#4a4e56,#5c626c 22%,#7d848f 36%,#9aa1ac 44%,#6d737e 56%,#51555e 74%,#4a4e56)}' +
      '.sp-av[data-tier="2"]::before{background:conic-gradient(from var(--fa),#6e4d29,#9a6d3a 18%,#c99a5f 34%,#f0d29a 42%,#c99a5f 50%,#7d5a34 68%,#8a6236 84%,#6e4d29)}' +
      '.sp-av[data-tier="3"]::before{background:conic-gradient(from var(--fa),#7e8896,#aab4c4 20%,#eef3fa 33%,#aab4c4 46%,#8b95a4 62%,#dfe7f1 80%,#7e8896)}' +
      '.sp-av[data-tier="4"]::before{background:conic-gradient(from var(--fa),#a97a2e,#e3c176 16%,#fff3cf 26%,#d8b56d 40%,#8f6b2d 55%,#f6e6b8 72%,#fff6dc 80%,#c9a84c 90%,#a97a2e)}' +
      '.sp-av[data-tier="5"]::before{background:conic-gradient(from var(--fa),#9fb0c6,#ffffff 14%,#c7d4e6 30%,#eef4fb 44%,#aebccf 58%,#ffffff 72%,#dce6f2 86%,#9fb0c6)}' +
      '.sp-av[data-tier="6"]::before{background:conic-gradient(from var(--fa),#d8b56d,#22d47e 18%,#9ff0c8 28%,#5ad0ff 40%,#b98cff 56%,#ffd98a 70%,#fff3cf 78%,#22d47e 88%,#d8b56d)}' +
      '.sp-av[data-tier="7"]::before{background:conic-gradient(from var(--fa),#8f6b2d,#ffe9b0 10%,#fffdf4 16%,#d8b56d 26%,#0f7a4e 38%,#22d47e 46%,#9ff0c8 52%,#d8b56d 62%,#b98cff 72%,#fff3cf 82%,#e8c778 92%,#8f6b2d)}';
    document.head.appendChild(st);
  }

  var db = null, cache = {}, started = false, myRef = null;

  /* lê o perfil do operador (users/<key>) e cacheia ícone/moldura/título.
     Igual ao painel: se não há moldura equipada, usa o tier já calculado no
     leaderboard do hub (a mais alta desbloqueada). */
  function hydrateProfile(email, then) {
    var key = emailToKey(email);
    db.ref('users/' + key).once('value').then(function (snap) {
      var u = snap.val() || {};
      if (u.avatar) lset(AV_KEY, u.avatar);
      if (u.tag != null) lset(TITLE_KEY, u.tag);
      if (u.frame != null) { lset(TIER_KEY, String(u.frame)); then(); return; }
      db.ref('hub/leaderboard/' + key + '/tier').once('value').then(function (s) {
        var t = s.val(); if (t != null) lset(TIER_KEY, String(t)); then();
      }).catch(then);
    }).catch(then);
  }

  function payload() {
    var p = { name: operatorName() || 'Alguém', at: global.firebase.database.ServerValue.TIMESTAMP, panel: PANEL.id || '' };
    var av = myAvatar(); if (av) p.avatar = av;
    var t = myTier(); if (t != null) p.tier = t;
    var tt = titleName(myTitleId()); if (tt) p.title = tt;
    return p;
  }

  function writePresence() {
    if (!db) return;
    myRef.set(payload()).catch(function () {});
  }

  function render() {
    var wrap = document.getElementById('presenceWrap');
    if (!wrap) return;
    var now = Date.now();
    var sessions = Object.keys(cache).map(function (id) { return [id, cache[id]]; })
      .filter(function (e) { return e[1] && typeof e[1].at === 'number' && (now - e[1].at) < STALE_MS; });
    if (!sessions.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    wrap.hidden = false;

    // agrupa por nome; guarda ícone, moldura (tier), título e painel
    var byName = {}, order = [];
    sessions.forEach(function (e) {
      var v = e[1]; var name = (v && v.name) || 'Alguém';
      if (!byName[name]) { byName[name] = { avatar: null, tier: null, title: null, panel: null }; order.push(name); }
      var g = byName[name];
      if (v.avatar && !g.avatar) g.avatar = v.avatar;
      if (typeof v.tier === 'number' && g.tier == null) g.tier = v.tier;
      if (v.title && !g.title) g.title = v.title;
      if (v.panel && !g.panel) g.panel = v.panel;
    });

    wrap.innerHTML = order.slice(0, 6).map(function (name, i) {
      var g = byName[name];
      var initials = name.trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
      var content = g.avatar ? '<span class="sp-emoji">' + esc(g.avatar) + '</span>' : esc(initials);
      var tierAttr = g.tier != null ? ' data-tier="' + g.tier + '"' : '';
      var where = g.panel && g.panel !== PANEL.id ? panelLabelById(g.panel) : '';
      var tip = name + (g.title ? ' · ' + g.title : '') + (where ? ' — em ' + where : ' — no painel agora');
      var color = g.avatar ? '' : ' style="background:' + COLORS[i % COLORS.length] + '"';
      return '<span class="sp-av' + (g.avatar ? ' emoji' : '') + '"' + tierAttr + color + ' title="' + escAttr(tip) + '">' + content + '</span>';
    }).join('') + (order.length > 6 ? '<span class="sp-av sp-more">+' + (order.length - 6) + '</span>' : '');
  }

  function attachListeners() {
    var ref = db.ref('presence');
    ref.on('child_added', function (s) { cache[s.key] = s.val(); render(); });
    ref.on('child_changed', function (s) { cache[s.key] = s.val(); render(); });
    ref.on('child_removed', function (s) { delete cache[s.key]; render(); });
    // reavalia staleness periodicamente (sessões que morreram em silêncio somem sozinhas)
    setInterval(function () {
      var cutoff = Date.now() - STALE_MS;
      for (var id in cache) { var v = cache[id]; if (!v || typeof v.at !== 'number' || v.at < cutoff) delete cache[id]; }
      render();
    }, 45 * 1000);
  }

  function begin() {
    if (started) return; started = true;
    injectCss();
    var s = readSession();
    var email = s && s.email;
    myRef = db.ref('presence/' + SID);
    myRef.onDisconnect().remove();
    attachListeners();
    var boot = function () {
      writePresence();
      setInterval(function () { if (db) myRef.update({ at: global.firebase.database.ServerValue.TIMESTAMP }).catch(function () {}); }, 60 * 1000);
    };
    if (email) hydrateProfile(email, boot); else boot();
    // some limpo ao fechar a aba (além do onDisconnect)
    global.addEventListener('pagehide', function () { try { myRef.remove(); } catch (e) {} });
  }

  /* espera firebase inicializar E a autenticação (o node presence exige auth) */
  function waitAndStart() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (global.firebase && global.firebase.apps && global.firebase.apps.length && global.firebase.database) {
        db = global.firebase.database();
        clearInterval(timer);
        if (global.firebase.auth) {
          var a = global.firebase.auth();
          if (a.currentUser) { begin(); }
          else { var un = a.onAuthStateChanged(function (u) { if (u) { un(); begin(); } }); }
        } else { begin(); }
      } else if (tries > 100) { // ~30s: desiste silenciosamente
        clearInterval(timer);
      }
    }, 300);
  }

  function autostart() {
    if (!document.getElementById('presenceWrap')) return; // painel sem barra de presença: não faz nada
    waitAndStart();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autostart);
  else autostart();

  global.SupremaPresence = { sessionId: SID, refresh: writePresence, render: render };
})(window);

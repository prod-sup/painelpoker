/* =========================================================================
   SUPREMA-AUTH — camada de sessão compartilhada do Suprema OS.
   Uma fonte única para: sessão, reconhecimento de admin, tema e hashing.
   Incluída por TODOS os produtos (<script src="suprema-auth.js"></script>)
   ANTES do resto do JS da página. Antes, cada painel reimplementava sessão,
   emailToKey, PBKDF2 e o portão de acesso inline — divergindo a cada correção.
   Agora o hub é "real": logou no hub, o resto reconhece; é admin, entra direto.

   Não depende do Firebase estar carregado: sessão e tema são localStorage puro.
   Os helpers que precisam do Firebase (verifyPassword/signIn) checam window.firebase.
========================================================================= */
(function (global) {
  'use strict';

  var SESSION_KEY = 'suprema_session_v1';
  var TRUSTED_KEY = 'suprema_trusted_admin';
  var THEME_KEY   = 'suprema_dark_mode';
  var AVATAR_KEY  = 'suprema_user_avatar_v1';

  /* administradores da casa — a mesma lista que cada painel repetia inline */
  var ADMIN_EMAILS = [
    'brian@suprema.group',
    'admin@suprema.group',
    'brian.rodrigues@suprema.group'
  ];
  var isAdminEmail = function (email) {
    return ADMIN_EMAILS.indexOf(String(email || '').toLowerCase().trim()) !== -1;
  };

  /* ── sessão (365 dias, compartilhada entre todos os produtos) ── */
  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.email || !s.expiresAt) return null;
      if (Date.now() > s.expiresAt) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch (e) { return null; }
  }
  function saveSession(data) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(
        Object.assign({}, data, { expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 })
      ));
    } catch (e) {}
    // admin que loga fica "confiável" neste navegador: os produtos liberam direto
    if (data && isAdminEmail(data.email)) setTrustedAdmin(data.email);
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { localStorage.removeItem(TRUSTED_KEY); } catch (e) {}
  }

  /* ── admin confiável neste navegador ──
     Guarda o e-mail do admin que já logou aqui; permite os painéis liberarem
     sem passar pela tela de login de novo (a sessão de 365 dias é reconstruída
     do Firebase quando necessário). */
  function setTrustedAdmin(email) {
    try { localStorage.setItem(TRUSTED_KEY, String(email).toLowerCase().trim()); } catch (e) {}
  }
  function getTrustedAdmin() {
    try {
      var e = localStorage.getItem(TRUSTED_KEY);
      return e && isAdminEmail(e) ? e : null;
    } catch (err) { return null; }
  }

  /* quem é o usuário reconhecido AGORA (sessão viva ou admin confiável) */
  function recognize() {
    var s = getSession();
    if (s) return { email: s.email, session: s, isAdmin: isAdminEmail(s.email), trustedOnly: false };
    var t = getTrustedAdmin();
    if (t) return { email: t, session: null, isAdmin: true, trustedOnly: true };
    return { email: null, session: null, isAdmin: false, trustedOnly: false };
  }

  var emailToKey = function (email) {
    return String(email).toLowerCase().trim().replace(/\./g, '_dot_').replace(/@/g, '_at_');
  };

  /* ── PORTÃO: chame no topo da página. Redireciona pro hub quem não é
        reconhecido. `adminOnly` bounce quem não é admin. Retorna o
        reconhecimento pra página seguir. ── */
  function guard(opts) {
    opts = opts || {};
    var r = recognize();
    if (!r.email) { location.replace(opts.redirect || 'hub.html'); return r; }
    if (opts.adminOnly && !r.isAdmin) { location.replace(opts.redirect || 'hub.html'); return r; }
    return r;
  }

  /* ── TEMA compartilhado ──
     A preferência (claro/escuro) vale pra todo o ecossistema. Cada painel usa
     sua própria classe (uns 'dark', outros 'light'); por isso aplicamos por
     callback: a página diz COMO refletir `dark` no seu <html>. */
  function isDarkPreferred() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved !== null) return saved === '1';
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function setThemePref(dark) {
    try { localStorage.setItem(THEME_KEY, dark ? '1' : '0'); } catch (e) {}
  }
  /* liga a sincronização entre abas/páginas: quando o tema muda em qualquer
     lugar, `apply(dark)` roda aqui também. Retorna o estado inicial. */
  function wireThemeSync(apply) {
    if (typeof apply !== 'function') return isDarkPreferred();
    global.addEventListener('storage', function (e) {
      if (e.key !== THEME_KEY || e.newValue === null) return;
      apply(e.newValue === '1');
    });
    return isDarkPreferred();
  }

  /* ── HASHING (PBKDF2v2) + verificação com migração dos formatos legados ──
     Protocolo idêntico ao que os painéis já usam; centralizado aqui. Precisa
     de crypto.subtle (contexto seguro). ── */
  var PBKDF2_ITER = 150000;
  var bufToHex = function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  };
  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }
  async function hashPassword(pw, saltHex) {
    saltHex = saltHex || bufToHex(crypto.getRandomValues(new Uint8Array(16)));
    var enc = new TextEncoder();
    var keyMat = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' }, keyMat, 256);
    return 'pbkdf2v2$' + PBKDF2_ITER + '$' + saltHex + '$' + bufToHex(bits);
  }
  async function hashPasswordLegacySalt(pw, saltHex) {
    var enc = new TextEncoder();
    var keyMat = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' }, keyMat, 256);
    return 'pbkdf2$' + PBKDF2_ITER + '$' + saltHex + '$' + bufToHex(bits);
  }
  function legacyHashPassword(pw) {
    var h = 5381, i;
    for (i = 0; i < pw.length; i++) { h = ((h << 5) + h) ^ pw.charCodeAt(i); h |= 0; }
    var salt = 'suprema2024', h2 = h;
    for (i = 0; i < salt.length; i++) { h2 = ((h2 << 5) + h2) ^ salt.charCodeAt(i); h2 |= 0; }
    return 'h2_' + Math.abs(h).toString(36) + '_' + Math.abs(h2).toString(36);
  }
  async function verifyPassword(pw, storedHash, onMigrate) {
    if (!storedHash) return true;
    if (storedHash.indexOf('pbkdf2v2$') === 0) {
      var saltHex = storedHash.split('$')[2];
      return (await hashPassword(pw, saltHex)) === storedHash;
    }
    if (storedHash.indexOf('pbkdf2$') === 0) {
      var s2 = storedHash.split('$')[2];
      var ok = (await hashPasswordLegacySalt(pw, s2)) === storedHash;
      if (ok && onMigrate) onMigrate(await hashPassword(pw));
      return ok;
    }
    if (/^[0-9a-f]{64}$/i.test(storedHash)) {
      var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
      var ok2 = bufToHex(digest) === storedHash.toLowerCase();
      if (ok2 && onMigrate) onMigrate(await hashPassword(pw));
      return ok2;
    }
    var ok3 = storedHash === legacyHashPassword(pw);
    if (ok3 && onMigrate) onMigrate(await hashPassword(pw));
    return ok3;
  }
  function validatePassword(pw) {
    if (pw.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (!/[a-z]/.test(pw)) return 'A senha precisa ter pelo menos 1 letra minúscula.';
    if (!/[^a-zA-Z0-9]/.test(pw)) return 'A senha precisa ter pelo menos 1 caractere especial (ex: @, #, !, %).';
    return null;
  }

  /* ── Firebase Auth (email/senha) ──
     Helpers finos usados na migração (Fase 1) e pelos painéis na Fase 4.
     Só funcionam com firebase-app + firebase-auth compat carregados e o
     provedor Email/Senha ligado no Console. Guardam contra ausência do SDK. */
  function fbAuth() {
    return (global.firebase && global.firebase.auth) ? global.firebase.auth() : null;
  }
  function signInEmail(email, pw) {
    var a = fbAuth();
    return a ? a.signInWithEmailAndPassword(email, pw) : Promise.reject(new Error('firebase-auth ausente'));
  }
  function signUpEmail(email, pw) {
    var a = fbAuth();
    return a ? a.createUserWithEmailAndPassword(email, pw) : Promise.reject(new Error('firebase-auth ausente'));
  }
  function sendReset(email) {
    var a = fbAuth();
    return a ? a.sendPasswordResetEmail(email) : Promise.reject(new Error('firebase-auth ausente'));
  }
  /* ── PROGRESSÃO (XP do operador) ──
     Todos os produtos alimentam a MESMA jornada: o hub lê users/<key>/stats e
     converte em XP/nível/rank/molduras. trackUse(toolId) = "abri a ferramenta"
     (chamar 1x no load, depois do firebase init); trackAction(tipo) = ação de
     operação concluída (finalizar evento, corrigir mesa, concluir GU...).
     Silencioso por design: sem sessão ou sem Firebase, simplesmente não conta. */
  function statsRef(sub) {
    var r = recognize();
    if (!r.email || !global.firebase || !global.firebase.database) return null;
    return global.firebase.database().ref('users/' + emailToKey(r.email) + '/stats/' + sub);
  }
  function bump(ref) { if (ref) ref.transaction(function (n) { return (n || 0) + 1; }).catch(function(){}); }
  function todayIsoStat() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function markDayActive() {
    var ref = statsRef('days/' + todayIsoStat());
    if (ref) ref.set(true).catch(function(){});
  }

  /* toast de XP: o feedback imediato que fecha o loop de recompensa —
     pílula discreta no rodapé, aria-live polite (não rouba foco), some em 3s.
     Vários ganhos em sequência somam na mesma pílula em vez de empilhar. */
  var xpToastEl = null, xpToastTimer = null, xpToastSum = 0;
  function xpToast(amount, label) {
    try {
      if (!document.body || document.hidden) return;
      if (!xpToastEl) {
        var st = document.createElement('style');
        st.textContent =
          '.sp-xp-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,8px);z-index:9999;' +
            'display:flex;align-items:center;gap:8px;padding:9px 16px;border-radius:99px;pointer-events:none;' +
            'background:rgba(14,16,15,.92);border:1px solid rgba(216,181,109,.5);color:#f2ede2;' +
            'font:700 12.5px/1 ui-monospace,monospace;letter-spacing:.04em;' +
            'box-shadow:0 10px 30px -10px rgba(0,0,0,.6);opacity:0;transition:opacity .3s ease,transform .3s ease}' +
          '.sp-xp-toast.on{opacity:1;transform:translate(-50%,0)}' +
          '.sp-xp-toast b{color:#d8b56d}' +
          '@media (prefers-reduced-motion:reduce){.sp-xp-toast{transition:none}}';
        document.head.appendChild(st);
        xpToastEl = document.createElement('div');
        xpToastEl.className = 'sp-xp-toast';
        xpToastEl.setAttribute('role', 'status');
        xpToastEl.setAttribute('aria-live', 'polite');
        document.body.appendChild(xpToastEl);
      }
      xpToastSum += amount;
      xpToastEl.innerHTML = '<b>+' + xpToastSum + ' XP</b> ' + (label || '');
      xpToastEl.classList.add('on');
      clearTimeout(xpToastTimer);
      xpToastTimer = setTimeout(function () {
        xpToastEl.classList.remove('on');
        xpToastSum = 0;
      }, 3200);
    } catch (e) {}
  }

  function trackUse(toolId) {
    try {
      if (!statsRef('opens')) return;          // sem sessão/Firebase: não conta nem avisa
      bump(statsRef('opens'));
      bump(statsRef('daily/' + todayIsoStat() + '/opens'));
      if (toolId) {
        var safe = String(toolId).replace(/[.#$/\[\]]/g, '_');
        bump(statsRef('tools/' + safe));
        // "continuar de onde parou" do hub: última ferramenta usada
        var lt = statsRef('lastTool');
        if (lt) lt.set({ t: safe, at: Date.now() }).catch(function(){});
      }
      markDayActive();
      xpToast(10, 'ferramenta aberta');
    } catch (e) {}
  }
  function trackAction(type) {
    try {
      if (!statsRef('opens')) return;
      bump(statsRef('actions/' + String(type || 'acao').replace(/[.#$/\[\]]/g, '_')));
      bump(statsRef('daily/' + todayIsoStat() + '/actions'));
      markDayActive();
      xpToast(5, 'ação registrada');
    } catch (e) {}
  }

  /* onUser(cb): dispara com o usuário do Firebase Auth (ou null). Na Fase 4 os
     painéis trocam signInAnonymously por isto: sem usuário → manda pro hub. */
  function onUser(cb) {
    var a = fbAuth();
    if (!a) { cb(null); return function () {}; }
    return a.onAuthStateChanged(cb);
  }

  global.SupremaAuth = {
    signInEmail: signInEmail, signUpEmail: signUpEmail, sendReset: sendReset, onUser: onUser,
    SESSION_KEY: SESSION_KEY, TRUSTED_KEY: TRUSTED_KEY, THEME_KEY: THEME_KEY, AVATAR_KEY: AVATAR_KEY,
    ADMIN_EMAILS: ADMIN_EMAILS, isAdminEmail: isAdminEmail,
    getSession: getSession, saveSession: saveSession, clearSession: clearSession,
    setTrustedAdmin: setTrustedAdmin, getTrustedAdmin: getTrustedAdmin,
    recognize: recognize, guard: guard, emailToKey: emailToKey,
    trackUse: trackUse, trackAction: trackAction,
    isDarkPreferred: isDarkPreferred, setThemePref: setThemePref, wireThemeSync: wireThemeSync,
    hashPassword: hashPassword, verifyPassword: verifyPassword, validatePassword: validatePassword
  };
})(window);

/* =========================================================================
   SUPREMA-DB — camada única de acesso a dados + conexão do Suprema OS.

   POR QUE ISSO EXISTE
   -------------------
   Hoje cada painel fala Firebase direto: `firebase.initializeApp`, `db.ref(x)
   .on('value', ...)`, `.set`, `.push`, `ServerValue.TIMESTAMP`, etc. — espalhado
   em 6 arquivos, centenas de chamadas. Essa base do Firebase é TEMPORÁRIA: o
   projeto vai pro servidor interno da empresa mais pra frente.

   Este módulo embrulha TODO o acesso a dados atrás de uma API neutra
   (`SupremaDB.watch/get/set/update/push/...`). Consequência:
     · MIGRAÇÃO: no dia de trocar de base, você reescreve SÓ a seção ADAPTER
       aqui embaixo (a única parte que conhece o Firebase). Os painéis não mudam.
     · SEGURANÇA: o controle de acesso (exigir usuário logado) vive num lugar só,
       em vez de cada painel decidir por conta própria.

   CONTRATO DO SNAPSHOT — os callbacks de `watch/get` recebem um objeto com a
   MESMA interface do snapshot do Firebase (`.val()`, `.forEach(child=>...)`,
   `.numChildren()`, `.exists()`, `.child(k)`, `.hasChild(k)`, `.key`). Assim o
   código atual liga sem reescrever callback. Ao migrar, o ADAPTER constrói um
   objeto compatível a partir do backend novo — os painéis continuam iguais.

   Requer firebase-app-compat + firebase-database-compat carregados antes.
   Depende de SupremaAuth (sessão) para o controle de acesso.
========================================================================= */
(function (global) {
  'use strict';

  /* ── CONFIG — fonte ÚNICA (antes duplicada em cada painel) ─────────────── */
  var CONFIG = {
    apiKey: "AIzaSyAFy1GtRaJE3LHC1Rjtmq0uw2JC8bviXes",
    authDomain: "design-1-53c00.firebaseapp.com",
    databaseURL: "https://design-1-53c00-default-rtdb.firebaseio.com",
    projectId: "design-1-53c00",
    storageBucket: "design-1-53c00.firebasestorage.app",
    messagingSenderId: "140511032441",
    appId: "1:140511032441:web:dcf970125bbf5eec53d0a8"
  };

  /* ═══════════════════════════════════════════════════════════════════════
     ADAPTER — a ÚNICA parte que conhece o Firebase.
     Ao migrar pro servidor interno, reescreva SÓ este bloco (mesma assinatura
     de saída) e todo o resto do app continua funcionando sem tocar em painel.
     ═══════════════════════════════════════════════════════════════════════ */
  var _db = null, _ready = false;

  var Adapter = {
    init: function () {
      if (_ready) return true;
      if (typeof global.firebase === 'undefined' || !global.firebase.database) return false;
      if (!global.firebase.apps || !global.firebase.apps.length) global.firebase.initializeApp(CONFIG);
      _db = global.firebase.database();
      _ready = true;
      return true;
    },
    ready: function () { return _ready; },
    // subscrição a mudanças de valor. cb recebe o snapshot (interface acima).
    watch: function (path, cb) {
      if (!_ready) return function () {};
      var ref = _db.ref(path);
      var handler = ref.on('value', function (snap) { cb(snap); });
      return function off() { ref.off('value', handler); };
    },
    get: function (path) {
      if (!_ready) return Promise.reject(new Error('SupremaDB offline'));
      return _db.ref(path).once('value');
    },
    set:    function (path, v)   { return _db.ref(path).set(v); },
    update: function (path, obj) { return _db.ref(path).update(obj); },
    push:   function (path, v)   { var r = _db.ref(path).push(); return r.set(v).then(function () { return r.key; }); },
    remove: function (path)      { return _db.ref(path).remove(); },
    transaction: function (path, fn) { return _db.ref(path).transaction(fn); },
    serverTime: function () { return global.firebase.database.ServerValue.TIMESTAMP; },
    onDisconnectRemove: function (path) { try { _db.ref(path).onDisconnect().remove(); } catch (e) {} },
    onConnection: function (cb) {
      if (!_ready) return function () {};
      var ref = _db.ref('.info/connected');
      var h = ref.on('value', function (s) { cb(s.val() === true); });
      return function off() { ref.off('value', h); };
    },
    // escape hatch p/ consultas avançadas (orderBy/limitTo/startAt) enquanto a
    // API neutra não cobre queries. Poucos usos (~11). Migrar por último.
    rawRef: function (path) { return _ready ? _db.ref(path) : null; }
  };

  /* ═══════════════════════════════════════════════════════════════════════
     API NEUTRA — o que os painéis usam. Não menciona "firebase" de propósito.
     ═══════════════════════════════════════════════════════════════════════ */
  var SupremaDB = {
    CONFIG: CONFIG,

    /* inicia a conexão (idempotente). Retorna true se subiu. */
    init: function () { return Adapter.init(); },
    ready: function () { return Adapter.ready(); },

    /* escuta um caminho. cb(snapshot) roda a cada mudança. Retorna off(). */
    watch: function (path, cb) { return Adapter.watch(path, cb); },
    /* lê uma vez. Retorna Promise<snapshot>. */
    get: function (path) { return Adapter.get(path); },
    /* lê uma vez já resolvendo o valor cru. Retorna Promise<value>. */
    getValue: function (path) { return Adapter.get(path).then(function (s) { return s.val(); }); },

    set:    function (path, v)   { return Adapter.set(path, v); },
    update: function (path, obj) { return Adapter.update(path, obj); },
    push:   function (path, v)   { return Adapter.push(path, v); },
    remove: function (path)      { return Adapter.remove(path); },
    transaction: function (path, fn) { return Adapter.transaction(path, fn); },

    serverTime: function () { return Adapter.serverTime(); },
    onDisconnectRemove: function (path) { return Adapter.onDisconnectRemove(path); },
    onConnection: function (cb) { return Adapter.onConnection(cb); },

    rawRef: function (path) { return Adapter.rawRef(path); },

    /* ── CONTROLE DE ACESSO (segurança) ──────────────────────────────────
       Ponto único onde o app decide "quem pode usar". Delega identidade ao
       Firebase Auth (email/senha) + à sessão do SupremaAuth. Ao migrar, troca
       só a implementação aqui; os painéis seguem chamando requireUser(). */
    _fbAuth: function () { return (global.firebase && global.firebase.auth) ? global.firebase.auth() : null; },

    /* dispara cb(user|null) quando o estado de auth resolve. */
    onUser: function (cb) {
      var a = this._fbAuth();
      if (!a) { cb(null); return function () {}; }
      return a.onAuthStateChanged(cb);
    },

    /* PORTÃO do painel (usado na Etapa 2 do cutover): exige usuário real de
       email/senha. Sem usuário → manda ao hub pra (re)logar UMA vez (marca
       ?reauth=1 pra o hub forçar login e não cair em loop). Com usuário →
       onReady(user). Se o SDK de auth não existir (dev/local), NÃO trava:
       chama onReady(null) e segue — a trava real é a regra do banco.
       `opts.redirect` troca o destino (default hub.html). */
    requireUser: function (onReady, opts) {
      opts = opts || {};
      var a = this._fbAuth();
      if (!a) { if (onReady) onReady(null); return; }
      var done = false, self = this;
      a.onAuthStateChanged(function (user) {
        if (user) { if (!done) { done = true; if (onReady) onReady(user); } return; }
        if (done) return;            // já entrou uma vez; ignore transições posteriores
        // sem usuário Firebase: precisa (re)logar. Se havia sessão local, sinaliza
        // reauth pra o hub forçar o login em vez de mostrar "já logado" (evita loop).
        var hasSession = false;
        try { hasSession = !!(global.SupremaAuth && SupremaAuth.getSession && SupremaAuth.getSession()); } catch (e) {}
        var dest = opts.redirect || 'hub.html';
        try { global.location.replace(dest + (hasSession ? '?reauth=1' : '')); }
        catch (e) { try { global.location.href = dest; } catch (_) {} }
      });
    },

    currentUser: function () { var a = this._fbAuth(); return a ? a.currentUser : null; }
  };

  global.SupremaDB = SupremaDB;
})(window);

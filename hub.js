(function(){
  /* escape de HTML — definido no topo do IIFE porque é usado por funções que
     podem rodar cedo (ex.: renderHeroOps); antes ficava lá embaixo e só não
     dava TDZ por sorte da ordem de chamada. */
  const escHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /* ── Sessão + hash: FONTE ÚNICA no suprema-auth.js (carregado acima) ──
     Antes o hub reimplementava sessão, emailToKey, PBKDF2 e verificação inline —
     divergindo dos painéis a cada correção. Agora delega pro módulo compartilhado;
     os aliases locais preservam intactas todas as chamadas já existentes abaixo.
     Bônus: saveSession/clearSession do módulo também tratam o "admin confiável"
     deste navegador (os painéis liberam sem novo login). */
  const getSession       = SupremaAuth.getSession;
  const saveSession      = SupremaAuth.saveSession;
  const clearSession     = SupremaAuth.clearSession;
  const emailToKey       = SupremaAuth.emailToKey;
  const hashPassword     = SupremaAuth.hashPassword;
  const verifyPassword   = SupremaAuth.verifyPassword;
  const validatePassword = SupremaAuth.validatePassword;
  const LOGIN_MAX_ATTEMPTS = 5, LOGIN_LOCK_MS = 5*60*1000;
  const loginLockRemaining = user => user && user.loginLockUntil ? Math.max(0, user.loginLockUntil - Date.now()) : 0;

  /* ── Gate: sem sessão, o hub mostra login/cadastro; com sessão, os produtos ── */
  const $ = id => document.getElementById(id);
  let session = getSession();
  let db = null, fbReady = false;

  let gateWasHidden = true;
  function paintAuthState(){
    session = getSession();
    const gate = $('gate');
    gate.hidden = !!session;
    // a11y: ao APARECER, o foco entra no primeiro campo do formulário visível
    // (senão o Tab passeia pela grade atrás do gate translúcido)
    if(!gate.hidden && gateWasHidden){
      const first = gate.querySelector('form:not([hidden]) input, .gate-tab');
      if(first) setTimeout(() => first.focus(), 60);
    }
    gateWasHidden = gate.hidden;
    $('navUser').hidden = !session;
    if(session) $('navUserName').textContent = session.displayName || session.apelido || session.nome || session.email;
    paintHello();
    applyPanelAccess();
    syncGateVideo();
  }

  /* ── PERMISSÃO POR PAINEL ──
     Bloqueio por padrão: o operador só vê o card se tiver acesso liberado pelo
     admin (users/<key>/access/<id>=true, salvo na sessão no login). Admin vê
     tudo. Os painéis sem acesso ficam ESCONDIDOS. As páginas em si também têm
     o portão (SupremaAuth.guard) — aqui é o reflexo no hub + trava do clique. */
  function canAccessHub(id){
    if(!session) return false;
    if(isAdmin(session.email) || session.admin === true) return true;
    if(id === 'admin') return false;                 // admin só pra admin
    return !!(session.access && session.access[id] === true);
  }
  const panelTilesWired = new Set();
  function applyPanelAccess(){
    document.querySelectorAll('.tile[data-panel]').forEach(tile => {
      const id = tile.dataset.panel;
      const allowed = canAccessHub(id);
      tile.style.display = allowed ? '' : 'none';    // esconde os sem acesso
      if(!panelTilesWired.has(tile)){
        panelTilesWired.add(tile);
        tile.addEventListener('click', e => {         // defesa extra: barra o clique
          if(!canAccessHub(tile.dataset.panel)){ e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);
      }
    });
  }

  /* ── Boas-vindas do usuário logado: avatar + nome no hero ── */
  function paintHello(){
    const hello = $('heroHello'), title = $('heroTitle');
    if(!session){
      hello.hidden = true;
      title.innerHTML = 'Suprema <span class="os">OS</span>';
      return;
    }
    const name = session.displayName || session.apelido || session.nome || session.email.split('@')[0];
    hello.hidden = false;
    $('hhEmail').textContent = session.email;
    title.innerHTML = `${name.replace(/[<>&]/g,'')} <span class="os">&spades;</span>`;
    paintAvatar();
    try{ renderHeroOps(); }catch(e){}
  }
  /* ── centro de comando do hero: turno, próximo evento, missões do dia e
     "continuar de onde parou". Cada pedaço acende quando o dado chega
     (sessão → turno; boards → evento; stats → missões; lastTool → continuar). ── */
  let heroLastTool = null;   // users/<key>/lastTool {t, at} — alimentado pelo suprema-auth
  const HERO_TOOL_URLS = { painel:'index.html', admin:'admin.html', gu:'criacao-noturna.html', cash:'dashboard-mesa-cash.html', eventos:'eventos.html', tv:'tv.html' };
  function renderHeroOps(){
    const box = $('heroOps'); if(!box) return;
    if(!session){ box.hidden = true; return; }
    box.hidden = false;

    // turno da operação: 07–19 / 19–07 (o dia da grade é outra coisa — aqui é o turno humano)
    const h = new Date().getHours();
    const diurno = h >= 7 && h < 19;
    $('hoTurnoTxt').innerHTML = `Turno <b>${diurno ? '07–19' : '19–07'}</b> em andamento`;

    // próximo compromisso da agenda da casa
    try{
      const tIso = todayIso();
      const evs = allEvents().filter(e => (e.endDate && e.endDate > e.date ? e.endDate : e.date) >= tIso)
        .sort((a,b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||''));
      const ev = evs[0], nextEl = $('hoNext');
      if(ev){
        const days = Math.round((new Date(ev.date+'T12:00') - new Date(tIso+'T12:00')) / 86400000);
        const when = days <= 0 ? (ev.time ? `hoje às ${ev.time}` : 'hoje')
                   : days === 1 ? 'amanhã' : `em ${days} dias`;
        nextEl.innerHTML = `<span class="ho-ic" aria-hidden="true">♠</span><b>${escHtml(ev.title.length > 34 ? ev.title.slice(0,33)+'…' : ev.title)}</b> ${when}`;
        nextEl.hidden = false;
        nextEl.onclick = () => $('calBoard').scrollIntoView({behavior:'smooth', block:'center'});
      } else nextEl.hidden = true;
    }catch(e){}

    // missões do dia (clicar abre o perfil, onde elas moram)
    try{
      const done = Object.keys(missionsToday()).length;
      const mEl = $('hoMissions');
      mEl.innerHTML = `<span class="ho-ic" aria-hidden="true">♦</span>Missões de hoje <b>${done}/${MISSIONS.length}</b>${done >= MISSIONS.length ? ' ✓' : ''}`;
      mEl.hidden = false;
      mEl.onclick = openProfile;
    }catch(e){}

    // continuar de onde parou (última ferramenta usada, se foi nas últimas 12h)
    const lEl = $('hoLast');
    if(heroLastTool && heroLastTool.t && TOOL_META[heroLastTool.t] && HERO_TOOL_URLS[heroLastTool.t]
       && Date.now() - (heroLastTool.at||0) < 12*60*60*1000){
      const mins = Math.max(1, Math.round((Date.now() - heroLastTool.at) / 60000));
      const ago = mins < 60 ? `há ${mins} min` : `há ${Math.round(mins/60)}h`;
      lEl.innerHTML = `<span class="ho-ic" aria-hidden="true">→</span>Continuar na <b>${TOOL_META[heroLastTool.t].nm}</b> ${ago}`;
      lEl.href = HERO_TOOL_URLS[heroLastTool.t];
      lEl.hidden = false;
    } else lEl.hidden = true;
  }

  function paintAvatar(av){
    // mesmo avatar do painel: emoji escolhido (localStorage/Firebase) ou iniciais
    const el = $('hhAvatar');
    const cached = (()=>{ try{ return localStorage.getItem('suprema_user_avatar_v1'); }catch(e){ return null; } })();
    const fallback = session ? (session.displayName || session.email || '?').slice(0,2).toUpperCase() : '♠';
    const face = av || cached || fallback;
    el.textContent = face;
    const navAv = $('navAvatar'); if(navAv) navAv.textContent = face;
    const pfAv = $('pfAvatarContent'); if(pfAv) pfAv.textContent = face;
    // repintar o avatar não pode apagar a moldura. try/catch: o 1º paint no load
    // roda antes de FRAME_TIERS ser inicializado (TDZ) — aí a moldura entra quando
    // o XP carrega (renderProfileProgress). XP=0 no load = sem moldura, então tudo bem.
    try{ applyProgressionFrames(); }catch(e){}
  }

  /* ── Vídeo do gate: só baixa/roda enquanto o gate está na tela ── */
  function syncGateVideo(){
    const v = $('gateVideo');
    if(!v) return;
    if(!$('gate').hidden){
      if(!v.src){
        v.addEventListener('error', () => { v.style.display = 'none'; }, {once:true});
        const show = () => v.classList.add('ready');
        v.addEventListener('canplay', show, {once:true});
        v.addEventListener('loadeddata', show, {once:true});
        v.src = 'bg.mp4';
      }
      v.play().catch(()=>{});
    } else if(v.src){
      try{ v.pause(); v.removeAttribute('src'); v.load(); v.classList.remove('ready'); }catch(e){}
    }
  }

  /* ── Tema claro/escuro: por usuário ──
     - aplica na hora e guarda em localStorage (pro próximo load não piscar)
     - persiste em users/<key>/darkMode; no login a preferência do usuário vence */
  function isDark(){ return !document.documentElement.classList.contains('light'); }
  function applyThemeBtn(){ $('themeBtn').textContent = isDark() ? '☀' : '☾'; }
  function setTheme(dark, persist){
    document.documentElement.classList.toggle('light', !dark);
    try{ localStorage.setItem('suprema_dark_mode', dark ? '1' : '0'); }catch(e){}
    applyThemeBtn();
    if(persist && session && db && fbReady){
      db.ref(`users/${emailToKey(session.email)}/darkMode`).set(!!dark).catch(()=>{});
    }
  }
  $('themeBtn').addEventListener('click', () => setTheme(!isDark(), true));
  applyThemeBtn();
  // ecossistema: tema trocado em outra aba/página (painel, admin...) reflete aqui na hora
  window.addEventListener('storage', e => {
    if(e.key !== 'suprema_dark_mode' || e.newValue === null) return;
    document.documentElement.classList.toggle('light', e.newValue !== '1');
    applyThemeBtn();
  });

  /* preferências salvas do usuário (tema por usuário + avatar do painel) */
  function loadUserPrefs(){
    if(!session || !db || !fbReady) return;
    const key = emailToKey(session.email);
    db.ref(`users/${key}/darkMode`).once('value').then(s => {
      if(s.val() !== null && s.val() !== undefined) setTheme(!!s.val(), false);
    }).catch(()=>{});
    db.ref(`users/${key}/avatar`).once('value').then(s => {
      if(s.val()){
        try{ localStorage.setItem('suprema_user_avatar_v1', s.val()); }catch(e){}
        paintAvatar(s.val());
      }
    }).catch(()=>{});
  }
  function switchTab(tab){
    document.querySelectorAll('.gate-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('gLogin').hidden = tab !== 'login';
    $('gCad').hidden   = tab !== 'cadastro';
    $('gRec').hidden   = tab !== 'recovery';
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  const err = (id,msg) => { const el=$(id); el.textContent = msg; el.hidden = false; };
  const busy = (btn,label,on) => { btn.disabled = on; btn.textContent = label; };

  /* login — mesmas regras e lockout do painel */
  /* LOGIN — MIGRAÇÃO PREGUIÇOSA (Fase 1 do PLANO-AUTENTICACAO.md):
     1) tenta Firebase Auth (usuário novo ou já migrado);
     2) se falhar, decide pelo registro no banco: quem já tem `authUid` errou a
        senha; quem é legado (só `pwHash`) confere contra o hash antigo e, se
        bater, é MIGRADO — cria a conta no Firebase Auth com a MESMA senha.
     O `pwHash` NÃO é apagado agora (só na Fase 4): assim o login legado segue
     válido e um `git revert` reverte tudo sem travar ninguém. Se o provedor
     Email/Senha ainda não estiver ligado no Console, os passos de Auth falham
     de leve e o login legado continua funcionando — nada quebra. */
  $('gLogin').addEventListener('submit', () => {
    const email = ($('gLoginEmail').value||'').trim().toLowerCase();
    const pw = $('gLoginPw').value||'';
    $('gLoginErr').hidden = true;
    if(!email || !pw) return err('gLoginErr','Preencha email e senha.');
    if(!email.endsWith('@suprema.group')) return err('gLoginErr','Use seu email @suprema.group.');
    if(!fbReady) return err('gLoginErr','Sem conexão com o servidor. Tente em instantes.');
    const btn = $('gLoginBtn'); busy(btn,'Entrando...',true);
    loginFlow(email, pw, btn);
  });

  async function loginFlow(email, pw, btn){
    const reset = () => busy(btn,'Entrar',false);
    const userRef = db.ref(`users/${emailToKey(email)}`);
    try{
      // 1) tenta Firebase Auth
      let uid = null, authOk = false;
      try{
        const cred = await firebase.auth().signInWithEmailAndPassword(email, pw);
        uid = cred.user.uid; authOk = true;
      }catch(e){
        if(e && e.code === 'auth/too-many-requests'){ reset(); return err('gLoginErr','Muitas tentativas. Tente novamente mais tarde.'); }
        // outros erros (senha errada OU usuário legado sem conta Auth OU provedor
        // desligado): decidimos lendo o registro no banco, abaixo.
      }
      const snap = await userRef.once('value');
      const user = snap.val() || {};

      if(authOk){
        // Firebase Auth aceitou: garante o registro e a marca de migrado
        if(!snap.exists()){
          await userRef.set({ email, authUid: uid, createdAt: firebase.database.ServerValue.TIMESTAMP }).catch(()=>{});
        }
        await afterAuthLogin(email, uid, userRef, user);
        reset(); return;
      }

      // Firebase Auth NÃO aceitou:
      if(!snap.exists()){ reset(); return err('gLoginErr','Email não cadastrado. Crie sua conta.'); }
      if(user.authUid){ reset(); return err('gLoginErr','Senha incorreta.'); } // já migrado → senha errada mesmo

      // legado, ainda não migrado: confere contra o pwHash antigo
      const remaining = loginLockRemaining(user);
      if(remaining > 0){ reset(); return err('gLoginErr',`Muitas tentativas. Tente novamente em ${Math.ceil(remaining/60000)} min.`); }
      const ok = await verifyPassword(pw, user.pwHash, h => userRef.update({pwHash:h}));
      if(!ok){
        const attempts = (user.loginAttempts||0) + 1;
        const patch = {loginAttempts: attempts};
        if(attempts >= LOGIN_MAX_ATTEMPTS){ patch.loginLockUntil = Date.now()+LOGIN_LOCK_MS; patch.loginAttempts = 0; }
        await userRef.update(patch);
        reset();
        return err('gLoginErr', attempts >= LOGIN_MAX_ATTEMPTS
          ? `Muitas tentativas. Login bloqueado por ${LOGIN_LOCK_MS/60000} min.` : 'Senha incorreta.');
      }
      if(user.loginAttempts || user.loginLockUntil) userRef.update({loginAttempts:0, loginLockUntil:null});

      // senha legada confere → MIGRA: cria a conta no Firebase Auth com a mesma senha
      let newUid = null;
      try{
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, pw);
        newUid = cred.user.uid;
      }catch(e){
        if(e && e.code === 'auth/email-already-in-use'){
          try{ const c = await firebase.auth().signInWithEmailAndPassword(email, pw); newUid = c.user.uid; }catch(_){}
        }
        // provedor desligado / rede: segue no legado, migra na próxima vez
      }
      await afterAuthLogin(email, newUid, userRef, user);
      reset();
    }catch(e){
      busy(btn,'Entrar',false);
      err('gLoginErr','Falha ao conectar. Tente novamente.');
    }
  }

  /* fecha o login: grava `authUid` (marca migrado), cria a sessão compartilhada
     e reconhece o admin neste navegador. NÃO remove `pwHash` (só na Fase 4). */
  async function afterAuthLogin(email, uid, userRef, user){
    user = user || {};
    // Índice uid→key que as REGRAS do RTDB usam pra gatear acesso por painel
    // (regras só olham por auth.uid; não convertem email→key). Populado no login,
    // amarrado ao authUid — impossível apontar pra outra conta. As regras do
    // uidIndex validam contra o authUid, então ele SÓ pode ser gravado depois que
    // o authUid assentar — daí o encadeamento (senão a 1ª vez perde a corrida).
    if(uid){
      const claim = (user.authUid === uid)
        ? Promise.resolve()
        : userRef.update({ authUid: uid });
      claim.then(() => firebase.database().ref('uidIndex/' + uid).set(userRef.key)).catch(()=>{});
    }
    const displayName = user.apelido || user.nome || email;
    saveSession({ email, nome:user.nome, sobrenome:user.sobrenome, apelido:user.apelido, displayName,
      access: user.access || null, edit: user.edit || null,
      admin: (user.admin===true || user.Admin===true || isAdmin(email)) });
    if(isAdmin(email)){ try{ localStorage.setItem('suprema_trusted_admin', email); }catch(e){} }
    paintAuthState();
    startLiveTiles();
  }

  /* cadastro — conta nova nasce no Firebase Auth (com `authUid`, sem `pwHash`) */
  $('gCad').addEventListener('submit', () => {
    const nome = ($('gCadNome').value||'').trim(), sobrenome = ($('gCadSobrenome').value||'').trim();
    const apelido = ($('gCadApelido').value||'').trim();
    const email = ($('gCadEmail').value||'').trim().toLowerCase();
    const pw = $('gCadPw').value||'', pw2 = $('gCadPw2').value||'';
    $('gCadErr').hidden = true;
    if(!nome) return err('gCadErr','Informe seu nome.');
    if(!sobrenome) return err('gCadErr','Informe seu sobrenome.');
    if(!email) return err('gCadErr','Informe seu email.');
    if(!email.endsWith('@suprema.group')) return err('gCadErr','Apenas emails @suprema.group são aceitos.');
    const pwErr = validatePassword(pw);
    if(pwErr) return err('gCadErr', pwErr);
    if(pw !== pw2) return err('gCadErr','As senhas não conferem.');
    if(!fbReady) return err('gCadErr','Sem conexão com o servidor.');
    const btn = $('gCadBtn'); busy(btn,'Verificando...',true);
    cadFlow({ nome, sobrenome, apelido, email, pw, btn });
  });

  async function cadFlow({ nome, sobrenome, apelido, email, pw, btn }){
    const userRef = db.ref(`users/${emailToKey(email)}`);
    try{
      // checagem prévia é só cortesia: se as regras do banco exigirem auth para
      // ler users/, este read falha — não derruba o cadastro, o createUser abaixo
      // ainda barra duplicados com auth/email-already-in-use.
      try{
        const snap = await userRef.once('value');
        if(snap.exists()){ busy(btn,'Criar conta',false); return err('gCadErr','Este email já possui cadastro. Faça login.'); }
      }catch(preErr){ console.warn('Pré-checagem de email indisponível:', preErr && preErr.code); }
      busy(btn,'Criando conta...',true);
      const displayName = apelido || nome;
      // cria no Firebase Auth
      let uid = null;
      try{
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, pw);
        uid = cred.user.uid;
      }catch(e){
        busy(btn,'Criar conta',false);
        const code = e && e.code || '';
        // mensagens específicas — antes um genérico "verifique sua conexão" escondia
        // a causa real (ex.: criação de conta desativada no Console)
        if(code === 'auth/email-already-in-use') return err('gCadErr','Este email já possui cadastro. Faça login.');
        if(code === 'auth/operation-not-allowed') return err('gCadErr','Provedor Email/Senha desativado no Firebase. Avise o admin.');
        if(code === 'auth/admin-restricted-operation') return err('gCadErr','Criação de conta desativada no Firebase (Authentication → Settings → User actions → habilitar "Enable create"). Avise o admin.');
        if(code === 'auth/weak-password') return err('gCadErr','Senha muito fraca — use pelo menos 6 caracteres.');
        if(code === 'auth/invalid-email') return err('gCadErr','Email inválido.');
        if(code === 'auth/network-request-failed') return err('gCadErr','Sem conexão com o servidor. Tente de novo.');
        console.error('Cadastro falhou:', code, e && e.message);
        return err('gCadErr', 'Falha ao criar conta (' + (code || 'erro desconhecido') + ').');
      }
      // grava o perfil (sem pwHash — a senha agora vive no Firebase Auth)
      await userRef.set({
        nome, sobrenome, apelido: displayName, email, authUid: uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      });
      busy(btn,'Criar conta',false);
      saveSession({ email, nome, sobrenome, apelido: displayName, displayName, access: null, admin: isAdmin(email) });
      if(isAdmin(email)){ try{ localStorage.setItem('suprema_trusted_admin', email); }catch(e){} }
      paintAuthState();
      startLiveTiles();
    }catch(e){
      busy(btn,'Criar conta',false);
      const code = (e && e.code) || '';
      const msg  = (e && e.message) || '';
      console.error('Cadastro falhou (fluxo):', code, msg, e);
      // permission_denied = a conta foi criada no Auth, mas a regra do Realtime
      // Database barrou a gravação em users/. Não é falta de conexão.
      if(code === 'PERMISSION_DENIED' || /permission_denied/i.test(msg))
        return err('gCadErr','Conta criada, mas o banco recusou a gravação do perfil (regras do Realtime Database). Avise o admin.');
      if(code === 'auth/network-request-failed' || /network/i.test(msg))
        return err('gCadErr','Sem conexão com o servidor. Tente novamente.');
      err('gCadErr', 'Falha ao criar conta (' + (code || msg || 'erro desconhecido') + ').');
    }
  }

  /* recuperação — mesmo fluxo do painel (código em passwordReset/, 15 min) */
  let recEmail = null, recCode = null, recExpiry = 0;
  $('gRec').addEventListener('submit', async () => {
    const btn = $('gRecBtn');
    $('gRecErr').hidden = true; $('gRecOk').hidden = true;
    if(recEmail && recCode){
      const code = ($('gRecCode').value||'').trim();
      const newPw = $('gRecPw').value||'';
      if(code !== recCode || Date.now() > recExpiry) return err('gRecErr','Código inválido ou expirado. Tente novamente.');
      const pwErr = validatePassword(newPw);
      if(pwErr) return err('gRecErr', pwErr);
      if(!fbReady) return err('gRecErr','Sem conexão.');
      busy(btn,'Salvando...',true);
      try{
        await db.ref(`users/${emailToKey(recEmail)}/pwHash`).set(await hashPassword(newPw));
        await db.ref(`passwordReset/${emailToKey(recEmail)}`).remove();
        recEmail = null; recCode = null;
        $('gRecOk').textContent = 'Senha redefinida! Faça login com a nova senha.'; $('gRecOk').hidden = false;
        setTimeout(() => switchTab('login'), 1600);
      }catch(e){ err('gRecErr','Erro ao salvar. Tente novamente.'); }
      finally{ busy(btn,'Redefinir senha',false); }
      return;
    }
    const email = ($('gRecEmail').value||'').trim().toLowerCase();
    if(!email.endsWith('@suprema.group')) return err('gRecErr','Use seu email @suprema.group.');
    if(!fbReady) return err('gRecErr','Sem conexão.');
    busy(btn,'Verificando...',true);
    try{
      const snap = await db.ref(`users/${emailToKey(email)}`).once('value');
      if(!snap.exists()){ busy(btn,'Enviar código',false); return err('gRecErr','Email não cadastrado.'); }
      // conta já migrada pro Firebase Auth → link de redefinição por email nativo
      if((snap.val()||{}).authUid){
        try{
          await firebase.auth().sendPasswordResetEmail(email);
          busy(btn,'Enviar código',false);
          $('gRecOk').textContent = 'Enviamos um link de redefinição para seu email. Confira a caixa de entrada e o spam.';
          $('gRecOk').hidden = false;
          setTimeout(() => switchTab('login'), 2600);
          return;
        }catch(e){ busy(btn,'Enviar código',false); return err('gRecErr','Não foi possível enviar o email agora. Tente em instantes.'); }
      }
      // legado (ainda não migrado): mantém o fluxo de código até a Fase 4
      const code = String(Math.floor(100000 + Math.random()*900000));
      const expiry = Date.now() + 15*60*1000;
      await db.ref(`passwordReset/${emailToKey(email)}`).set({ code, expiry, email, requestedAt: firebase.database.ServerValue.TIMESTAMP });
      recEmail = email; recCode = code; recExpiry = expiry;
      $('gRecEmail').disabled = true;
      $('gRecStep2').hidden = false;
      busy(btn,'Redefinir senha',false);
      $('gRecOk').textContent = `Código gerado: ${code} (válido por 15min). Em produção será enviado ao email.`;
      $('gRecOk').hidden = false;
      setTimeout(() => { $('gRecOk').hidden = true; }, 8000);
    }catch(e){ busy(btn,'Enviar código',false); err('gRecErr','Erro. Tente novamente.'); }
  });

  /* ═══════════════ Calendário de eventos + Patch notes ═══════════════
     Dados no Firebase: hub/calendar (eventos), hub/calendarHidden
     (tombstones dos eventos padrão apagados) e hub/patchNotes.
     Todo mundo logado vê; só admin adiciona/edita/apaga. */
  /* lista de admins: fonte única no suprema-auth.js (não repetir aqui) */
  const isAdmin = SupremaAuth.isAdminEmail;

  // Eventos padrão embutidos: aparecem mesmo antes de qualquer escrita no Firebase.
  // Apagar um deles (admin) grava tombstone em hub/calendarHidden/<id>.
  const DEFAULT_EVENTS = [
    { id:'seed-5m-20260816', date:'2026-08-16', time:'15:00', title:'Primeiro 5M Garantidos' },
  ];
  // Links dos nossos eventos: padrões embutidos + hub/links no Firebase.
  // Apagar um padrão (admin) grava tombstone em hub/linksHidden/<id>.
  const DEFAULT_LINKS = [
    { id:'seed-allin',  url:'https://allin.supremapoker.com.br/', title:'All-in Suprema',     tag:'Campanha ativa' },
    { id:'seed-tour',   url:'https://supremapokertour.com/',      title:'Suprema Poker Tour', tag:'Evento Live' },
  ];
  const DEFAULT_PATCH_NOTES =
`## v1.0 · 08/07/2026
- Login e criação de conta agora acontecem só aqui no hub. Os produtos exigem sessão.
- Nova Agenda da casa: o calendário de eventos importantes (admin adiciona, todo mundo vê).
- Mesas abertas: os links das campanhas e eventos live da Suprema.
- Nova área de Patch notes.`;

  let boardsDb = null;               // fica pronto junto com o auth anônimo do Firebase
  let fbEvents = {};                 // hub/calendar
  let hiddenSeeds = {};              // hub/calendarHidden
  let fbLinks = {};                  // hub/links
  let hiddenLinks = {};              // hub/linksHidden
  let patchNotes = null;             // hub/patchNotes ({text, updatedAt, by}) ou null (usa default)
  let fbAvisos = {};                 // hub/avisos ({id:{tipo,titulo,texto,ativo,at,by}})
  const now0 = new Date();
  let viewY = now0.getFullYear(), viewM = now0.getMonth();

  const pad = n => String(n).padStart(2,'0');
  const todayIso = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const MONTHS_SHORT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  /* ── Feriados nacionais do Brasil (fixos + móveis via Páscoa) ──
     Recorrem todo ano — calculados por ano e cacheados. Domingo de Páscoa: Meeus/Butcher. */
  function easterSunday(y){
    const a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4,
          f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30,
          i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7,
          m=Math.floor((a+11*h+22*l)/451),
          mo=Math.floor((h+l-7*m+114)/31), da=((h+l-7*m+114)%31)+1;
    return new Date(y, mo-1, da);
  }
  const holidayCache = {};
  function holidaysForYear(y){
    const map = {};
    const iso = (mo,da) => `${y}-${pad(mo)}-${pad(da)}`;
    map[iso(1,1)]   = 'Confraternização Universal';
    map[iso(4,21)]  = 'Tiradentes';
    map[iso(5,1)]   = 'Dia do Trabalho';
    map[iso(9,7)]   = 'Independência do Brasil';
    map[iso(10,12)] = 'Nossa Senhora Aparecida';
    map[iso(11,2)]  = 'Finados';
    map[iso(11,15)] = 'Proclamação da República';
    map[iso(11,20)] = 'Consciência Negra';
    map[iso(12,25)] = 'Natal';
    const easter = easterSunday(y);
    const rel = (days, name) => { const d = new Date(easter); d.setDate(d.getDate()+days);
      map[`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`] = name; };
    rel(-48, 'Carnaval');            // segunda de carnaval
    rel(-47, 'Carnaval');            // terça de carnaval
    rel(-2,  'Sexta-feira Santa');
    rel(60,  'Corpus Christi');
    return map;
  }
  function holidays(y){ return holidayCache[y] || (holidayCache[y] = holidaysForYear(y)); }
  function holidayName(isoDate){ return holidays(+isoDate.slice(0,4))[isoDate] || null; }
  // preferência do usuário: ocultar feriados no calendário/lista (persistida)
  let hideHolidays = false;
  try{ hideHolidays = localStorage.getItem('hub_hide_holidays_v1') === '1'; }catch(e){}

  function allEvents(){
    const list = DEFAULT_EVENTS.filter(e => !hiddenSeeds[e.id]).map(e => ({...e, seed:true}));
    Object.entries(fbEvents).forEach(([id,e]) => { if(e && e.date && e.title) list.push({id, ...e}); });
    return list.sort((a,b) => (a.date+(a.time||'')) < (b.date+(b.time||'')) ? -1 : 1);
  }

  // rótulo de horário de um evento: hora, "dia inteiro" e/ou faixa de dias
  function evWhen(e){
    const fmt = iso => { const [,m,d] = iso.split('-'); return `${d}/${m}`; };
    const time = (e.allDay || !e.time) ? 'dia inteiro' : e.time;
    return e.endDate && e.endDate > e.date ? `${time} · ${fmt(e.date)} → ${fmt(e.endDate)}` : time;
  }

  function renderCalendar(){
    const grid = $('calGrid');
    $('calMonth').textContent = `${MONTHS[viewM]} ${viewY}`;
    // evento de vários dias pinta TODOS os dias da faixa (limite de 90 por segurança)
    const evByDate = {};
    allEvents().forEach(e => {
      const end = (e.endDate && e.endDate > e.date) ? e.endDate : e.date;
      let d = new Date(e.date + 'T12:00:00');
      for(let i = 0; i < 90; i++){
        const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        (evByDate[iso] = evByDate[iso] || []).push(e);
        if(iso >= end) break;
        d.setDate(d.getDate()+1);
      }
    });
    const admin = session && isAdmin(session.email);
    const first = new Date(viewY, viewM, 1);
    const start = new Date(first); start.setDate(1 - first.getDay()); // domingo da 1ª semana
    let html = ['D','S','T','Q','Q','S','S'].map(d => `<span class="cal-dow">${d}</span>`).join('');
    const tIso = todayIso();
    for(let i=0;i<42;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      const inMonth = d.getMonth() === viewM;
      const evs = evByDate[iso] || [];
      const hol = hideHolidays ? null : holidayName(iso);
      const cls = ['cal-day', inMonth?'in-month':'other', iso===tIso?'today':'', evs.length?'has-ev':'', hol?'holiday':'', admin?'admin-click':''].filter(Boolean).join(' ');
      const tipLines = [...(hol ? [`Feriado · ${hol}`] : []), ...evs.map(e => `${evWhen(e)} · ${e.title}`)];
      const title = tipLines.length ? ` title="${escHtml(tipLines.join('\n'))}"` : '';
      const marks = [hol?'<span class="dot hol"></span>':'', evs.length?'<span class="dot"></span>':''].filter(Boolean).join('');
      html += `<span class="${cls}" data-date="${iso}"${title}>${d.getDate()}${marks?`<span class="cal-daymarks">${marks}</span>`:''}</span>`;
    }
    grid.innerHTML = html;
  }

  function renderEventList(){
    try{ renderHeroOps(); }catch(e){}   // o "próximo compromisso" do hero usa os mesmos eventos
    const list = $('evList');
    const admin = session && isAdmin(session.email);
    const tIso = todayIso();
    // eventos em andamento (multi-dia) continuam na lista até o último dia deles
    const evs = allEvents().filter(e => (e.endDate && e.endDate > e.date ? e.endDate : e.date) >= tIso);
    // próximos feriados nacionais (ano atual + próximo), a partir de hoje — só leitura
    const curY = now0.getFullYear();
    const holItems = [];
    if(!hideHolidays) [curY, curY+1].forEach(y => Object.entries(holidays(y)).forEach(([date, name]) => {
      if(date >= tIso) holItems.push({date, title:name, hol:true});
    }));
    const combined = [...evs, ...holItems].sort((a,b) => (a.date+(a.time||'')) < (b.date+(b.time||'')) ? -1 : 1).slice(0, 24);
    if(!combined.length){ list.innerHTML = '<div class="ev-empty">Nenhum evento agendado por enquanto.</div>'; return; }
    const PIPS = [['♠','black'],['♥','red'],['♦','red'],['♣','black']];
    let evIdx = 0;
    list.innerHTML = combined.map(e => {
      const [y,m,d] = e.date.split('-');
      if(e.hol){
        return `<div class="ev-item ev-holiday">
          <span class="ev-date"><span class="pip hol">★</span><b>${+d}</b><span>${MONTHS_SHORT[+m-1]} ${y !== String(curY) ? y : ''}</span></span>
          <span class="ev-body"><b>${escHtml(e.title)}</b><span>Feriado nacional</span></span>
        </div>`;
      }
      const range = e.endDate && e.endDate > e.date;
      const sameMonth = range && e.endDate.slice(0,7) === e.date.slice(0,7);
      const dayLabel = range && sameMonth ? `${+d}-${+e.endDate.split('-')[2]}` : `${+d}`;
      const [pip, pipCls] = PIPS[evIdx++ % 4];
      return `<div class="ev-item">
        <span class="ev-date"><span class="pip ${pipCls}">${pip}</span><b${range && sameMonth ? ' class="range"' : ''}>${dayLabel}</b><span>${MONTHS_SHORT[+m-1]} ${y !== String(now0.getFullYear()) ? y : ''}</span></span>
        <span class="ev-body"><b>${escHtml(e.title)}</b><span>${evWhen(e)}</span></span>
      </div>`;
    }).join('');
  }

  /* links dos nossos eventos (campanhas, eventos live) */
  function renderLinks(){
    const admin = session && isAdmin(session.email);
    const links = DEFAULT_LINKS.filter(l => !hiddenLinks[l.id]).map(l => ({...l, seed:true}));
    Object.entries(fbLinks).forEach(([id,l]) => { if(l && l.url && l.title) links.push({id, ...l}); });
    const list = $('lkList');
    if(!links.length){ list.innerHTML = '<div class="ev-empty">Nenhum link por enquanto.</div>'; return; }
    list.innerHTML = links.map(l => {
      const live = /live|ao vivo/i.test(l.tag||'');
      const tagCls = live ? 'lk-tag live' : 'lk-tag';
      const host = (l.url||'').replace(/^https?:\/\//,'').replace(/\/$/,'');
      return `<a class="lk-item" href="${escHtml(l.url)}" target="_blank" rel="noopener">
        <span class="lk-chip ${live ? 'felt' : 'gold'}" aria-hidden="true">♠</span>
        <span class="lk-body"><b>${escHtml(l.title)}</b><span>${escHtml(host)}</span></span>
        ${l.tag ? `<span class="${tagCls}">${escHtml(l.tag)}</span>` : ''}
        <span class="lk-arrow">↗</span>
      </a>`;
    }).join('');
  }

  /* patch notes: "## título" vira heading, "- item" vira bullet, resto vira parágrafo */
  function renderPatchNotes(){
    const raw = (patchNotes && patchNotes.text) || DEFAULT_PATCH_NOTES;
    let html = '', ul = [];
    const flush = () => { if(ul.length){ html += `<ul>${ul.map(i=>`<li>${i}</li>`).join('')}</ul>`; ul = []; } };
    raw.split('\n').forEach(line => {
      const l = line.trim();
      if(!l) { flush(); return; }
      if(l.startsWith('## ')){
        flush();
        const [t, ...rest] = l.slice(3).split('·');
        html += `<h3>${escHtml(t.trim())}${rest.length?` <small>${escHtml(rest.join('·').trim())}</small>`:''}</h3>`;
      }
      else if(l.startsWith('- ') || l.startsWith('* ')) ul.push(escHtml(l.slice(2)));
      else { flush(); html += `<p>${escHtml(l)}</p>`; }
    });
    flush();
    $('pnBody').innerHTML = html;
    $('pnMeta').textContent = patchNotes && patchNotes.updatedAt
      ? `Atualizado em ${new Date(patchNotes.updatedAt).toLocaleDateString('pt-BR')} por ${(patchNotes.by||'').split('@')[0]}`
      : '';
  }

  /* ── AVISOS DA CASA ── erros de atualização / informativos publicados no admin.
     Lê hub/avisos, mostra só os ativos que o usuário ainda não dispensou (dispensa
     é local, por navegador). Some a faixa inteira quando não há nada a mostrar. */
  const AV_ICONS = {
    erro:  '<path d="M12 2 22 20H2L12 2Z"/><path d="M12 9v5M12 17h.01"/>',
    aviso: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    info:  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
  };
  function avisoDismissed(id){
    try{ return (JSON.parse(localStorage.getItem('suprema_avisos_lidos')||'[]')).includes(id); }catch(e){ return false; }
  }
  function dismissAviso(id){
    try{
      const arr = JSON.parse(localStorage.getItem('suprema_avisos_lidos')||'[]');
      if(!arr.includes(id)){ arr.push(id); localStorage.setItem('suprema_avisos_lidos', JSON.stringify(arr.slice(-200))); }
    }catch(e){}
    renderAvisos();
  }
  function renderAvisos(){
    const sec = $('avisosSection'), list = $('avisosList');
    if(!sec || !list) return;
    const items = Object.entries(fbAvisos||{})
      .map(([id,a]) => ({id, ...a}))
      .filter(a => a && a.ativo !== false && a.titulo && !avisoDismissed(a.id))
      .sort((a,b) => (b.at||0) - (a.at||0));
    if(!items.length){ sec.hidden = true; list.innerHTML = ''; return; }
    sec.hidden = false;
    list.innerHTML = items.map(a => {
      const tipo = ['erro','aviso','info'].includes(a.tipo) ? a.tipo : 'info';
      const tagTxt = tipo === 'erro' ? 'Erro' : tipo === 'aviso' ? 'Aviso' : 'Informativo';
      const when = a.at ? new Date(a.at).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="aviso" data-tipo="${tipo}" role="status">
        <span class="av-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${AV_ICONS[tipo]}</svg></span>
        <div class="av-body">
          <div class="av-head"><span class="av-tag">${tagTxt}</span><span class="av-title">${escHtml(a.titulo)}</span></div>
          ${a.texto ? `<p class="av-text">${escHtml(a.texto)}</p>` : ''}
          ${when ? `<span class="av-time">${when}${a.by ? ' · ' + escHtml(String(a.by).split('@')[0]) : ''}</span>` : ''}
        </div>
        <button type="button" class="av-dismiss" data-av="${escHtml(a.id)}" aria-label="Dispensar aviso" title="Dispensar">&times;</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.av-dismiss').forEach(b => b.addEventListener('click', () => dismissAviso(b.dataset.av)));
  }

  /* a edição de agenda / links / patch notes agora mora no Admin (Conteúdo do hub).
     Aqui o hub é vitrine: só mostra pro admin um atalho "Editar no Admin". */
  function refreshBoardsAdminUI(){
    const admin = session && isAdmin(session.email);
    document.querySelectorAll('.board-admin-link').forEach(a => a.hidden = !admin);
    renderCalendar(); renderEventList(); renderLinks();
  }

  /* chamado pelo fluxo de login/cadastro do gate (acima) — atualiza os
     controles de admin dos boards assim que a sessão nasce */
  function startLiveTiles(){ refreshBoardsAdminUI(); loadUserPrefs(); pfLoadStats(); }

  $('calPrev').addEventListener('click', () => { viewM--; if(viewM<0){viewM=11;viewY--;} renderCalendar(); });
  $('calNext').addEventListener('click', () => { viewM++; if(viewM>11){viewM=0;viewY++;} renderCalendar(); });
  // toggle de feriados (persistido por navegador)
  function paintHolToggle(){
    const b = $('calHolToggle');
    b.classList.toggle('off', hideHolidays);
    b.setAttribute('aria-pressed', String(!hideHolidays));
  }
  $('calHolToggle').addEventListener('click', () => {
    hideHolidays = !hideHolidays;
    try{ localStorage.setItem('hub_hide_holidays_v1', hideHolidays ? '1' : '0'); }catch(e){}
    paintHolToggle(); renderCalendar(); renderEventList();
  });
  paintHolToggle();

  /* edição de agenda / links / patch notes movida para o Admin (Conteúdo do hub) */

  function initBoards(db){
    boardsDb = db;
    db.ref('hub/calendar').on('value', s => { fbEvents = s.val() || {}; renderCalendar(); renderEventList(); });
    db.ref('hub/calendarHidden').on('value', s => { hiddenSeeds = s.val() || {}; renderCalendar(); renderEventList(); });
    db.ref('hub/patchNotes').on('value', s => { patchNotes = s.val(); renderPatchNotes(); });
    db.ref('hub/leaderboard').on('value', s => { lbData = s.val() || {}; renderLeaderboard(); });
    const lbT = $('lbTabs');
    if(lbT) lbT.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      lbMode = b.dataset.mode; renderLeaderboard();
    }));
    db.ref('hub/links').on('value', s => { fbLinks = s.val() || {}; renderLinks(); });
    db.ref('hub/linksHidden').on('value', s => { hiddenLinks = s.val() || {}; renderLinks(); });
    db.ref('hub/avisos').on('value', s => { fbAvisos = s.val() || {}; renderAvisos(); });
    loadUserPrefs(); // tema por usuário + avatar assim que a conexão nasce
    pfLoadStats();   // progressão do perfil (XP, títulos) — e o dia ativo de hoje
  }

  /* ═══════════════ Perfil do operador (a experiência mora no hub) ═══════════════
     Identidade (apelido, avatar, título), dados da conta e progressão.
     XP: cada abertura de ferramenta e cada dia ativo contam — quanto mais a
     pessoa usa o Suprema OS, mais títulos ela desbloqueia. Dados em
     users/<key>/{avatar, apelido, tag, stats{opens, days}}. */
  /* XP: abrir ferramenta (10), dia ativo (25), ação na operação (5 — evento
     finalizado, mesa corrigida, GU concluída... os produtos gravam em
     users/<key>/stats/actions/<tipo> via SupremaAuth.trackAction) */
  const XP_PER_OPEN = 10, XP_PER_DAY = 25, XP_PER_ACTION = 5;
  const TITLES = [
    { id:'novato',      name:'Novato na mesa',   xp:0,     desc:'Todo mundo começa aqui.' },
    { id:'regular',     name:'Regular',          xp:100,   desc:'Já conhece a casa.' },
    { id:'operador',    name:'Operador',         xp:300,   desc:'Presença constante na operação.' },
    { id:'grinder',     name:'Grinder',          xp:700,   desc:'Volume é o seu jogo.' },
    { id:'tubarao',     name:'Tubarão',          xp:1200,  desc:'A mesa te respeita.' },
    { id:'especialista',name:'Especialista',     xp:1800,  desc:'Domina as ferramentas da casa.' },
    { id:'highroller',  name:'High Roller',      xp:2500,  desc:'Uso pesado de todas as ferramentas.' },
    { id:'controlador', name:'Controlador',      xp:3200,  desc:'Nada passa despercebido.' },
    { id:'arquiteto',   name:'Arquiteto',        xp:4000,  desc:'Constrói a operação, não só executa.' },
    { id:'mestremesas', name:'Mestre das Mesas', xp:5000,  desc:'As mesas obedecem.' },
    { id:'supervisor',  name:'Supervisor',       xp:6000,  desc:'O turno confia em você.' },
    { id:'veterano',    name:'Veterano',         xp:7500,  desc:'Já viu de tudo nesta casa.' },
    { id:'lenda',       name:'Lenda da casa',    xp:9000,  desc:'O Suprema OS é sua segunda casa.' },
    { id:'imortal',     name:'Imortal',          xp:10500, desc:'Seu nome fica na parede.' },
    { id:'tita',        name:'Titã Suprema',     xp:12000, desc:'O topo absoluto da progressão.' },
  ];
  /* curva calibrada pra jornada terminar junto: nível 50 cai em 12.005 XP —
     exatamente o marco Suprema (antes exigia 60k, inalcançável) */
  const levelFromXp = xp => Math.min(50, 1 + Math.floor(Math.sqrt(xp/5)));
  const xpForLevel = lv => 5*(lv-1)*(lv-1);
  let pfStats = { opens:0, days:0, actions:0, tools:{} };
  let pfStatsLoaded = false; // só true após uma leitura BEM-SUCEDIDA de users/<key>/stats
  let pfTag = null;

  function pfXp(){ return pfStats.opens*XP_PER_OPEN + pfStats.days*XP_PER_DAY + pfStats.actions*XP_PER_ACTION + missionsTotal()*XP_PER_MISSION; }

  /* transforma o snapshot cru de users/<key>/stats no shape que o perfil usa */
  function pfSetStatsFromSnap(v){
    pfStats = {
      opens: v.opens||0,
      days: v.days ? Object.keys(v.days).length : 0,
      actions: v.actions ? Object.values(v.actions).reduce((a,n) => a + (+n||0), 0) : 0,
      tools: v.tools || {},
      daily: v.daily || {},
      missions: v.missions || {},
      daysMap: v.days || {},
    };
  }

  /* Retrato local do XP/nível: cache do último stats lido com sucesso. Serve pra
     pintar o card na hora — mesmo numa volta rápida (bfcache) ou enquanto o Firebase
     Auth restaura — em vez de mostrar o default Nível 1, que o operador lê como
     "resetado". É só EXIBIÇÃO: não liga pfStatsLoaded (não publica no leaderboard
     nem dispara level-up); o dado ao vivo, quando chega, sobrescreve. */
  function pfCacheKey(){ try{ return session ? 'suprema_pfstats_v1_' + emailToKey(session.email) : null; }catch(e){ return null; } }
  function pfSaveCache(){
    const k = pfCacheKey(); if(!k) return;
    try{ localStorage.setItem(k, JSON.stringify(pfStats)); }catch(e){}
  }
  function pfLoadCacheAndPaint(){
    if(pfStatsLoaded) return;            // já temos dado ao vivo — não sobrescreve
    const k = pfCacheKey(); if(!k) return;
    try{
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      if(v && typeof v === 'object'){
        pfStats = {
          opens: v.opens||0, days: v.days||0, actions: v.actions||0,
          tools: v.tools||{}, daily: v.daily||{}, missions: v.missions||{}, daysMap: v.daysMap||{},
        };
        renderProfileProgress();
      }
    }catch(e){}
  }

  /* ── Molduras de progressão: a jornada completa do operador, do Novato ao
     Suprema. Cada faixa de XP libera um aro melhor no avatar. ── */
  const FRAME_TIERS = [
    { t:0, xp:0,     name:'Novato',   desc:'Moldura lisa — todo mundo começa aqui.' },
    { t:1, xp:100,   name:'Regular',  desc:'Primeira moldura de verdade: metal escuro discreto.' },
    { t:2, xp:300,   name:'Bronze',   desc:'Metal escovado com fios dourados.' },
    { t:3, xp:700,   name:'Prata',    desc:'Aço frio, acabamento premium.' },
    { t:4, xp:1500,  name:'Ouro',     desc:'Camadas douradas com linhas luminosas.' },
    { t:5, xp:3000,  name:'Platina',  desc:'Gelo vivo com aura respirando.' },
    { t:6, xp:6000,  name:'Diamante', desc:'Cristal holográfico com luz interna.' },
    { t:7, xp:12000, name:'Suprema',  desc:'Metal, vidro, energia e cristal — a obra de arte da casa.' },
  ];

  /* ── RANK: sobe por performance (consistência de dias ativos + volume de
     ações na operação), não só por XP acumulado. ── */
  const RANKS = [
    { id:'ferro',      name:'Ferro',      score:0 },
    { id:'bronze',     name:'Bronze',     score:80 },
    { id:'prata',      name:'Prata',      score:200 },
    { id:'ouro',       name:'Ouro',       score:450 },
    { id:'platina',    name:'Platina',    score:900 },
    { id:'diamante',   name:'Diamante',   score:1600 },
    { id:'ascendente', name:'Ascendente', score:2600 },
    { id:'suprema',    name:'Suprema',    score:4000 },
  ];
  function rankScore(){ return pfStats.days*10 + Math.min(pfStats.opens,1000) + pfStats.actions*3; }
  function rankFromStats(){ let r = RANKS[0]; const s = rankScore(); for(const rk of RANKS) if(s >= rk.score) r = rk; return r; }

  /* ── MISSÕES DO DIA: metas diárias derivadas de stats/daily/<dia> (que o
     suprema-auth alimenta em todos os produtos). Completou, o hub grava
     stats/missions/<dia>/<id> e cada missão cumprida vale 15 XP pra sempre. ── */
  const XP_PER_MISSION = 15;
  const MISSIONS = [
    { id:'abrir1',  nm:'Abra uma ferramenta',            target:1,  of:d => d.opens||0 },
    { id:'abrir3',  nm:'Abra 3 ferramentas no dia',      target:3,  of:d => d.opens||0 },
    { id:'acoes10', nm:'Conclua 10 ações na operação',   target:10, of:d => d.actions||0 },
  ];
  function missionsToday(){ return (pfStats.missions && pfStats.missions[todayIso()]) || {}; }
  function missionsTotal(){
    let n = 0;
    for(const dia in (pfStats.missions||{})) n += Object.keys(pfStats.missions[dia]).length;
    return n;
  }
  // detecta missões recém-completadas e registra no Firebase (idempotente)
  function checkMissions(){
    if(!session || !db || !fbReady) return;
    const daily = (pfStats.daily && pfStats.daily[todayIso()]) || {};
    const done = missionsToday();
    const key = emailToKey(session.email);
    MISSIONS.forEach(m => {
      if(!done[m.id] && m.of(daily) >= m.target)
        db.ref(`users/${key}/stats/missions/${todayIso()}/${m.id}`).set(true).catch(()=>{});
    });
  }
  function frameFromXp(xp){ let f = FRAME_TIERS[0]; for(const ft of FRAME_TIERS) if(xp >= ft.xp) f = ft; return f; }
  // pausa a rotação/pulso das molduras quando a janela perde o foco ou fica oculta
  // (o browser só freia abas OCULTAS, não janela visível-sem-foco) — não pesa nos outros apps
  (function freezeFramesWhenBlurred(){
    const set = blur => document.body.classList.toggle('win-blurred', blur);
    addEventListener('blur', () => set(true));
    addEventListener('focus', () => set(false));
    document.addEventListener('visibilitychange', () => set(document.hidden));
  })();

  /* ── Motion do hub (referências MotionSites) ──
     1) cursor-glow: brilho na tinta do produto segue o cursor dentro do tile;
     2) tilt: o tile inclina ±2.5° na direção do cursor (o CSS só aplica com
        hover real e sem prefers-reduced-motion);
     3) reveal: boards entram com stagger quando aparecem no viewport.
     Tudo via CSS vars + transform — nada de layout/paint por frame. */
  (function hubMotion(){
    const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if(fine && !calm){
      document.querySelectorAll('.grid .tile').forEach(t => {
        const glow = document.createElement('span');
        glow.className = 'cursor-glow';
        glow.setAttribute('aria-hidden','true');
        t.appendChild(glow);
        // rect medido 1x por hover (getBoundingClientRect força layout) —
        // scroll/resize invalidam
        let rect = null;
        const drop = () => { rect = null; };
        addEventListener('scroll', drop, {passive:true, capture:true});
        addEventListener('resize', drop, {passive:true});
        t.addEventListener('pointerenter', drop);
        t.addEventListener('pointermove', e => {
          const r = rect || (rect = t.getBoundingClientRect());
          const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
          t.style.setProperty('--mx', (x*100).toFixed(1) + '%');
          t.style.setProperty('--my', (y*100).toFixed(1) + '%');
          t.style.setProperty('--ry', ((x - .5) * 5).toFixed(2) + 'deg');
          t.style.setProperty('--rx', ((.5 - y) * 5).toFixed(2) + 'deg');
        });
        t.addEventListener('pointerleave', () => {
          t.style.setProperty('--rx','0deg'); t.style.setProperty('--ry','0deg');
        });
      });
    }

    // reveal dos boards: a classe js-reveal só entra AQUI — sem JS, nada fica oculto
    if('IntersectionObserver' in window && !calm){
      const boards = document.querySelectorAll('.boards .board');
      if(boards.length){
        document.documentElement.classList.add('js-reveal');
        const io = new IntersectionObserver(es => es.forEach(e => {
          if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
        }), { rootMargin:'0px 0px -8% 0px' });
        boards.forEach(b => io.observe(b));
      }
    }
  })();
  function nextFrame(xp){ return FRAME_TIERS.find(ft => xp < ft.xp) || null; }

  /* ── equipar moldura + banner do cartão (localStorage p/ pintar já; Firebase p/ seguir a conta) ── */
  let equippedFrame = null;   // tier escolhido; null = a mais alta desbloqueada
  let pfBanner = 'felt';
  try{ const v = localStorage.getItem('suprema_user_frame_v1'); if(v !== null && v !== '') equippedFrame = +v; }catch(e){}
  try{ pfBanner = localStorage.getItem('suprema_user_banner_v1') || 'felt'; }catch(e){}
  /* banners do cartão: os básicos vêm de graça, os raros desbloqueiam com XP —
     cada um conta uma história da casa */
  const PF_BANNERS = [
    { id:'felt',      nm:'Feltro',         xp:0 },
    { id:'gold',      nm:'Dourado',        xp:0 },
    { id:'crimson',   nm:'Carmesim',       xp:0 },
    { id:'night',     nm:'Madrugada',      xp:0 },
    { id:'royal',     nm:'Royal',          xp:0 },
    { id:'carbon',    nm:'Carbon Fiber',   xp:100 },
    { id:'darkgrid',  nm:'Dark Grid',      xp:300 },
    { id:'aurora',    nm:'Aurora',         xp:700 },
    { id:'blueprint', nm:'Blueprint',      xp:700 },
    { id:'rain',      nm:'Digital Rain',   xp:1500 },
    { id:'blackgold', nm:'Black Gold',     xp:1500 },
    { id:'neural',    nm:'Neural Network', xp:3000 },
    { id:'galaxy',    nm:'Galaxy',         xp:3000 },
    { id:'quantum',   nm:'Quantum',        xp:6000 },
    { id:'core',      nm:'Suprema Core',   xp:12000 },
  ];

  function unlockedTier(){ return frameFromXp(pfXp()).t; }
  function shownFrame(){
    const un = unlockedTier();
    const t = (equippedFrame !== null && equippedFrame >= 0 && equippedFrame <= un) ? equippedFrame : un;
    return FRAME_TIERS[t] || FRAME_TIERS[0];
  }
  // aplica a moldura EQUIPADA nos três avatares (hero, nav, perfil)
  function applyProgressionFrames(){
    const f = shownFrame();
    const setTier = (el, withTitle) => {
      if(!el) return;
      el.setAttribute('data-tier', f.t);   // 0 = Novato (aro liso cinza)
      if(withTitle) el.title = `Moldura ${f.name} · ${f.desc}`;
    };
    setTier($('hhAvatar'), true);
    setTier($('navAvatar'), false);           // mantém o title "Meu perfil"
    setTier(document.querySelector('.pf-avatar'), false);
    // a paleta do tier equipado tinge o cartão inteiro (placa, ícones, barra)
    const panel = document.querySelector('.pf-panel');
    if(panel) panel.setAttribute('data-ttier', f.t);
    const lbl = $('pfFrameLbl');
    if(lbl) lbl.textContent = `${unlockedTier()+1} de ${FRAME_TIERS.length} conquistadas`;
    renderFrames();
    renderNextReward();
    return f;
  }

  /* galeria: todas as molduras, com estado conquistada/equipada/bloqueada */
  function renderFrames(){
    const box = $('pfFrames'); if(!box) return;
    const un = unlockedTier(), cur = shownFrame().t;
    let face = '♠';
    try{ face = localStorage.getItem('suprema_user_avatar_v1') || '♠'; }catch(e){}
    box.innerHTML = FRAME_TIERS.map(ft => {
      const locked = ft.t > un, eq = ft.t === cur;
      return `<button type="button" class="pf-frame-it${locked?' locked':''}${eq?' equipped':''}" data-ft="${ft.t}"
        title="${escHtml(ft.desc)}${locked ? ` — desbloqueia aos ${ft.xp} XP` : eq ? ' — equipada' : ' — clique pra equipar'}">
        ${eq ? '<span class="fequip">Equipada</span>' : ''}${locked ? `<span class="flock">${PF_LOCK}</span>` : ''}
        <span class="fprev" data-tier="${ft.t}">${escHtml(face)}</span>
        <span class="fname">${escHtml(ft.name)}</span>
        <span class="fxp">${ft.xp ? ft.xp + ' XP' : 'inicial'}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('.pf-frame-it:not(.locked)').forEach(b => b.addEventListener('click', () => {
      equippedFrame = +b.dataset.ft;
      try{ localStorage.setItem('suprema_user_frame_v1', String(equippedFrame)); }catch(e){}
      if(session && db && fbReady) db.ref(`users/${emailToKey(session.email)}/frame`).set(equippedFrame).catch(()=>{});
      applyProgressionFrames();
    }));
  }

  /* próxima recompensa: o que chega primeiro (moldura ou título) no caminho do XP */
  function renderNextReward(){
    const el = $('pfNextReward'); if(!el) return;
    const xp = pfXp();
    const cands = [];
    // ícones estruturais em SVG (emoji varia por plataforma e não segue o tema)
    const IC = {
      frame:  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><rect x="8" y="8" width="8" height="8" rx="1.5"/></svg>',
      title:  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15l-5.5 3 1.5-6L3 8l6-.5L12 2l3 5.5L21 8l-5 4 1.5 6z"/></svg>',
      banner: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v18l-7-4-7 4z"/></svg>'
    };
    const nf = nextFrame(xp); if(nf) cands.push({xp:nf.xp, txt:`Moldura ${nf.name}`, ic:IC.frame});
    const nt = TITLES.find(t => xp < t.xp); if(nt) cands.push({xp:nt.xp, txt:`Título "${nt.name}"`, ic:IC.title});
    const nb = PF_BANNERS.filter(b => xp < b.xp).sort((a,b) => a.xp - b.xp)[0];
    if(nb) cands.push({xp:nb.xp, txt:`Banner ${nb.nm}`, ic:IC.banner});
    if(!cands.length){ el.hidden = true; return; }
    cands.sort((a,b) => a.xp - b.xp);
    el.hidden = false;
    $('pfNextRewardIc').innerHTML = cands[0].ic;   // SVG estrutural, não emoji
    $('pfNextRewardTxt').textContent = cands[0].txt;
    $('pfNextRewardXp').textContent = `faltam ${cands[0].xp - xp} XP`;
  }

  /* ── missões do dia + estatísticas no perfil ── */
  function renderMissions(){
    const box = $('pfMissions'); if(!box) return;
    const daily = (pfStats.daily && pfStats.daily[todayIso()]) || {};
    const done = missionsToday();
    box.innerHTML = MISSIONS.map(m => {
      const cur = Math.min(m.of(daily), m.target), ok = !!done[m.id];
      return `<div class="pf-mission${ok?' done':''}">
        <span class="pm-check" aria-hidden="true">${ok?PF_CHECK:''}</span>
        <span class="pm-txt"><b>${escHtml(m.nm)}</b><span>${ok?'Concluída · +'+XP_PER_MISSION+' XP':`${cur}/${m.target}`}</span></span>
        <span class="pm-bar"><i style="transform:scaleX(${ok?1:(cur/m.target).toFixed(2)})"></i></span>
      </div>`;
    }).join('');
    try{ renderHeroOps(); }catch(e){}
    const tot = missionsTotal();
    $('pfMissionsHint').textContent = tot
      ? `${tot} ${tot === 1 ? 'missão cumprida' : 'missões cumpridas'} até hoje · +${tot*XP_PER_MISSION} XP no total`
      : 'Missões renovam todo dia — cada uma vale 15 XP pra sempre.';
  }
  const TOOL_META = {
    painel:{nm:'Painel do Dia', c:'var(--p-painel)'}, admin:{nm:'Admin', c:'var(--p-admin)'},
    gu:{nm:'Criação Noturna', c:'var(--p-gu)'}, cash:{nm:'Cash Intelligence', c:'var(--p-cash)'},
    learn:{nm:'Poker Learn', c:'var(--p-learn)'}, org:{nm:'A Constelação', c:'var(--p-org)'},
  };
  function renderActivity(){
    const box = $('pfActivity'); if(!box) return;
    // últimos 14 dias: bolinha acesa = dia ativo
    const dots = [];
    for(let i = 13; i >= 0; i--){
      const d = new Date(); d.setDate(d.getDate()-i);
      const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      dots.push(`<span class="pa-dot${(pfStats.daysMap && pfStats.daysMap[iso])?' on':''}" title="${iso}"></span>`);
    }
    const tools = Object.entries(pfStats.tools||{})
      .filter(([id]) => TOOL_META[id]).sort((a,b) => b[1]-a[1]);
    const max = tools.length ? tools[0][1] : 1;
    box.innerHTML = `
      <div class="pa-days"><span class="pa-lbl">Últimos 14 dias</span><span class="pa-dots">${dots.join('')}</span></div>
      ${tools.length ? tools.map(([id,n]) => `
        <div class="pa-tool">
          <span class="pa-nm">${TOOL_META[id].nm}</span>
          <span class="pa-track"><i style="width:${Math.max(6,(n/max*100)).toFixed(0)}%;background:${TOOL_META[id].c}"></i></span>
          <span class="pa-n">${n}</span>
        </div>`).join('')
      : '<p class="pf-hint" style="margin:6px 0 0">Use as ferramentas — os números aparecem aqui.</p>'}`;
  }

  /* ── leaderboard: publica o próprio placar e desenha a mesa dos campeões.
     Temporada = SEMESTRE (6 meses): S1 vai de janeiro a junho, S2 de julho a
     dezembro. XP da temporada é derivado de stats/daily, days e missions por
     data — nada extra pra gravar, e o corte é só uma questão de qual data conta.
     Seis meses dão fôlego pra quem entra no meio e fazem a ponta valer algo. ── */
  const SEASON_MONTHS = 6;
  // '2026-07-18' -> {id:'2026-S2', y:2026, s:2, from:'2026-07', to:'2026-12'}
  function seasonOf(iso){
    const y = +iso.slice(0,4), m = +iso.slice(5,7);
    const s = Math.floor((m-1)/SEASON_MONTHS) + 1;           // 1 ou 2
    const mFrom = (s-1)*SEASON_MONTHS + 1, mTo = s*SEASON_MONTHS;
    const p2 = n => String(n).padStart(2,'0');
    return { id:`${y}-S${s}`, y, s, from:`${y}-${p2(mFrom)}`, to:`${y}-${p2(mTo)}`,
             lastDay:`${y}-${p2(mTo)}-${new Date(y, mTo, 0).getDate()}` };
  }
  function season(){ return seasonOf(todayIso()); }
  function seasonId(){ return season().id; }
  // um dia 'YYYY-MM-DD' pertence à temporada? (compara só o prefixo YYYY-MM)
  function inSeason(dia, sn){ const ym = dia.slice(0,7); return ym >= sn.from && ym <= sn.to; }
  function seasonXp(){
    const sn = season();
    let xp = 0;
    for(const dia in (pfStats.daily||{})){
      if(!inSeason(dia, sn)) continue;
      const d = pfStats.daily[dia];
      xp += (d.opens||0)*XP_PER_OPEN + (d.actions||0)*XP_PER_ACTION;
    }
    for(const dia in (pfStats.daysMap||{})) if(inSeason(dia, sn)) xp += XP_PER_DAY;
    for(const dia in (pfStats.missions||{})) if(inSeason(dia, sn)) xp += Object.keys(pfStats.missions[dia]).length*XP_PER_MISSION;
    return xp;
  }
  // dias que faltam pro fim da temporada (0 = último dia)
  function seasonDaysLeft(){
    const MS = 86400000;
    return Math.max(0, Math.round((Date.parse(season().lastDay+'T00:00:00') - Date.parse(todayIso()+'T00:00:00')) / MS));
  }
  let lbData = null, lbLastPub = 0, lbMode = 'season';
  function lbPublish(){
    if(!session || !db || !fbReady) return;
    if(!pfStatsLoaded) return;   // nunca publica XP=0 antes de ler stats (evita zerar o leaderboard)
    const now = Date.now();
    if(now - lbLastPub < 30000) return;   // no máx. a cada 30s
    lbLastPub = now;
    let face = '♠'; try{ face = localStorage.getItem('suprema_user_avatar_v1') || '♠'; }catch(e){}
    db.ref(`hub/leaderboard/${emailToKey(session.email)}`).set({
      name: session.displayName || session.apelido || session.nome || session.email.split('@')[0],
      xp: pfXp(), lv: levelFromXp(pfXp()), tier: frameFromXp(pfXp()).t, face, updatedAt: now,
      season: { id: seasonId(), xp: seasonXp() }
    }).catch(()=>{});
  }
  function renderLeaderboard(){
    const list = $('lbList'); if(!list) return;
    const sn = season();
    const tabs = $('lbTabs');
    if(tabs){
      tabs.querySelector('[data-mode="season"]').textContent = `Temporada · ${sn.s}º sem ${sn.y}`;
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === lbMode));
    }
    /* placar da temporada: aceita o formato novo (season.id) e, por transição, o
       antigo mensal (season.ym) quando o mês cai dentro do semestre — assim
       ninguém aparece zerado até publicar de novo (no máx. 30s depois). */
    const seasonScore = r => {
      const s = r.season; if(!s) return 0;
      if(s.id) return s.id === sn.id ? (s.xp||0) : 0;
      if(s.ym) return (s.ym >= sn.from && s.ym <= sn.to) ? (s.xp||0) : 0;
      return 0;
    };
    const score = r => lbMode === 'season' ? seasonScore(r) : (r.xp||0);
    const rows = Object.entries(lbData || {})
      .map(([k,v]) => ({key:k, ...v})).filter(r => r && r.name)
      .sort((a,b) => score(b) - score(a)).slice(0,10);
    /* rodapé da temporada: 6 meses sem prazo à vista viram um placar sem fim —
       o contador diz que a disputa fecha e dá urgência na reta final. */
    const left = seasonDaysLeft();
    const foot = lbMode !== 'season' ? '' :
      `<p class="lb-foot${left <= 14 ? ' urgent' : ''}">${
        left === 0 ? 'Último dia da temporada — o placar congela hoje.'
        : left === 1 ? 'Falta <b>1 dia</b> pra temporada fechar.'
        : `Faltam <b>${left} dias</b> pra temporada fechar.`}</p>`;
    if(!rows.length || (lbMode === 'season' && score(rows[0]) === 0)){
      list.innerHTML = `<p class="ev-empty">${lbMode === 'season'
        ? 'A temporada acabou de começar — o primeiro a jogar leva a ponta.'
        : 'A mesa ainda está vazia — o primeiro a jogar leva a ponta.'}</p>` + foot;
      return;
    }
    const meKey = session ? emailToKey(session.email) : null;
    const fmt = n => n.toLocaleString('pt-BR') + ' XP';
    // pódio: os 3 primeiros em destaque, o resto em lista
    const podio = rows.slice(0,3), resto = rows.slice(3);
    const podiumHtml = `<div class="lb-podium">${[1,0,2].map(i => {
      const r = podio[i]; if(!r) return '<span></span>';
      return `<div class="lb-champ c${i+1}${r.key === meKey ? ' me' : ''}">
        <span class="lb-face" ${r.tier ? `data-tier="${r.tier}"` : ''}>${escHtml(r.face || '♠')}</span>
        <b class="lc-nm">${escHtml(r.name)}</b>
        <span class="lc-xp">${fmt(score(r))}</span>
        <span class="lc-pos">${i+1}º</span>
      </div>`;
    }).join('')}</div>`;
    list.innerHTML = podiumHtml + resto.map((r,i) => `
      <div class="lb-row${r.key === meKey ? ' me' : ''}">
        <span class="lb-pos">${i+4}</span>
        <span class="lb-face" ${r.tier ? `data-tier="${r.tier}"` : ''}>${escHtml(r.face || '♠')}</span>
        <span class="lb-nm">${escHtml(r.name)}${r.key === meKey ? ' <small>(você)</small>' : ''}</span>
        <span class="lb-lv">Nv ${r.lv || 1}</span>
        <span class="lb-xp">${fmt(score(r))}</span>
      </div>`).join('') + foot;
  }

  /* badges: conquistas da operação (derivadas das stats — nada extra pra gravar).
     Sistema data-driven: cada badge é {id, ic, nm, desc, rar, test}; pra criar
     uma nova, basta adicionar uma linha. Raridade: comum/rara/epica/lendaria. */
  const tool = id => (pfStats.tools && pfStats.tools[id]) || 0;
  /* ── set de ícones do cartão: SVG stroke 1.8 em currentColor — emoji varia por
     plataforma e nunca segue a cor da raridade; estes seguem. ── */
  const _ic = inner => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const _icF = inner => `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${inner}</svg>`;
  const PF_IC = {
    cards:    _ic('<rect x="8" y="4" width="13" height="17" rx="2"/><path d="M4 8v11a2 2 0 0 0 2 2h9"/><path d="M12.5 9.5l2 2-2 2-2-2z"/>'),
    sprout:   _ic('<path d="M12 21v-8"/><path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6z"/><path d="M12 11c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5z"/>'),
    calendar: _ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    calcheck: _ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M9 15.5l2 2 4-4.5"/>'),
    flame:    _ic('<path d="M12 3c1 3-4 5-4 10a4.5 4.5 0 0 0 9 0c0-2-1-3.5-2-4.5 0 1.5-1 2.5-2 2.5 1-2.5-.5-6-1-8z"/>'),
    moon:     _ic('<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z"/>'),
    hourglass:_ic('<path d="M6 3h12M6 21h12M8 3c0 5 8 5 8 10M16 3c0 5-8 5-8 10M8 21c0-4 2.5-5.5 4-6 1.5.5 4 2 4 6"/>'),
    bank:     _ic('<path d="M3 9l9-6 9 6z"/><path d="M5 9v9M10 9v9M14 9v9M19 9v9M3 21h18"/>'),
    cake:     _ic('<path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16c2 1.5 4-1.5 6 0s4-1.5 6 0 4 0 4 0M12 8v4M12 8c-1.2 0-2-.8-2-2s2-3 2-3 2 1.8 2 3-.8 2-2 2z"/>'),
    wrench:   _ic('<path d="M14.5 6.5a4.5 4.5 0 0 1 6-4.3l-3 3 1.3 1.3 3-3a4.5 4.5 0 0 1-6 6L7 18.3A2 2 0 0 1 4.2 15.5z"/>'),
    hammer:   _ic('<path d="M14 5l5 5M11 8l-8 8 3 3 8-8"/><path d="M11 8l3-3 2-1 4 4-1 2-3 3z"/>'),
    nut:      _ic('<path d="M12 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1z"/><circle cx="12" cy="12" r="3.4"/>'),
    gear:     _ic('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>'),
    layers:   _ic('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>'),
    gauge:    _ic('<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 14l4.5-4.5"/><circle cx="12" cy="14" r="1.6"/>'),
    check:    _ic('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/>'),
    clipboard:_ic('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a3 3 0 0 1 6 0M9 11h6M9 15h4"/>'),
    target:   _ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
    bolt:     _ic('<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>'),
    storm:    _ic('<path d="M6 16a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 18 8.5 3.8 3.8 0 0 1 18.5 16"/><path d="M12.5 12l-3 5h3l-1.5 4.5"/>'),
    grid:     _ic('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    nightowl: _ic('<path d="M17 12.5A6.5 6.5 0 0 1 9.3 4 6.5 6.5 0 1 0 17 12.5z"/><path d="M17.5 17l1 1.7 1.9.3-1.4 1.3.3 1.9-1.8-.9-1.7.9.3-1.9-1.4-1.3 1.9-.3z"/>'),
    sparkle:  _ic('<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>'),
    briefcase:_ic('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8a3 3 0 0 1 6 0M3 13h18"/>'),
    chart:    _ic('<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>'),
    trend:    _ic('<path d="M4 17l5-5 3.5 3.5L20 8"/><path d="M15 8h5v5"/>'),
    mountain: _ic('<path d="M3 19L10 6l4 7 2.5-3.5L21 19z"/>'),
    medal:    _ic('<circle cx="12" cy="14" r="5"/><path d="M9.5 9.8L6 3M14.5 9.8L18 3M9 3h6"/>'),
    ascend:   _ic('<circle cx="12" cy="12" r="9"/><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5"/>'),
    orbit:    _ic('<circle cx="12" cy="12" r="4"/><path d="M19 7.5c2 2.8 1.6 5.7-1 8.3-3.1 3.1-7.9 3.5-10.6.8S5.1 9.1 8.2 6C10.8 3.4 13.7 3 16.5 5" opacity=".9"/>'),
    stars:    _ic('<path d="M11 4l1.5 4.5L17 10l-4.5 1.5L11 16l-1.5-4.5L5 10l4.5-1.5z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>'),
    gem:      _ic('<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 9L12 20 14.5 9M7 4l2.5 5M17 4l-2.5 5"/>'),
    diamond:  _ic('<path d="M12 3l7 7-7 11L5 10z"/><path d="M5 10h14M12 3l-3 7 3 11 3-11z"/>'),
    crown:    _ic('<path d="M4 18h16M4 18L3 8l5 3 4-6 4 6 5-3-1 10z"/>'),
    trophy:   _ic('<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3.5 3.5 0 0 0 3.6 3.5M16 6h3.5a3.5 3.5 0 0 1-3.6 3.5M12 14v3M8.5 20h7M10 17h4"/>'),
    shield:   _ic('<path d="M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.7"/>'),
    spade:    _icF('<path d="M12 2C9 6 4 8.5 4 12.6c0 2.4 1.9 4 4.1 4 1 0 1.9-.3 2.6-.9-.3 2-1.2 3.6-2.7 4.8v1h8v-1c-1.5-1.2-2.4-2.8-2.7-4.8.7.6 1.6.9 2.6.9 2.2 0 4.1-1.6 4.1-4C20 8.5 15 6 12 2z"/>'),
    club:     _icF('<circle cx="12" cy="6.4" r="3.9"/><circle cx="6.6" cy="13" r="3.9"/><circle cx="17.4" cy="13" r="3.9"/><path d="M10.8 12h2.4c-.4 3.2.4 5.9 2.3 8v1H8.5v-1c1.9-2.1 2.7-4.8 2.3-8z"/>'),
    heart:    _icF('<path d="M12 21C6.5 16.5 3 13.2 3 9.3 3 6.4 5.2 4.5 7.7 4.5c1.8 0 3.3.9 4.3 2.4 1-1.5 2.5-2.4 4.3-2.4 2.5 0 4.7 1.9 4.7 4.8 0 3.9-3.5 7.2-9 11.7z"/>'),
    diamsuit: _icF('<path d="M12 2.5c1.6 3.6 3.8 6.8 6.7 9.5-2.9 2.7-5.1 5.9-6.7 9.5-1.6-3.6-3.8-6.8-6.7-9.5 2.9-2.7 5.1-5.9 6.7-9.5z"/>'),
  };
  const PF_LOCK  = _ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>');
  const PF_CHECK = _ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
  const PF_BADGES = [
    // ── Tempo na casa ──
    {id:'firsthand', ic:'cards',    nm:'Primeira mão',    rar:'comum',    desc:'Primeiro dia ativo no Suprema OS.',    test:() => pfStats.days >= 1},
    {id:'days3',     ic:'sprout',   nm:'Criando raiz',    rar:'comum',    desc:'3 dias ativos.',                        test:() => pfStats.days >= 3},
    {id:'week',      ic:'calendar', nm:'Semana cheia',    rar:'comum',    desc:'7 dias ativos.',                        test:() => pfStats.days >= 7},
    {id:'days14',    ic:'flame',    nm:'Duas semanas',    rar:'rara',     desc:'14 dias ativos.',                       test:() => pfStats.days >= 14},
    {id:'month',     ic:'calcheck', nm:'Mês de mesa',     rar:'rara',     desc:'30 dias ativos.',                       test:() => pfStats.days >= 30},
    {id:'days60',    ic:'moon',     nm:'Bimestre',        rar:'rara',     desc:'60 dias ativos.',                       test:() => pfStats.days >= 60},
    {id:'days90',    ic:'hourglass',nm:'Trimestre',       rar:'epica',    desc:'90 dias ativos.',                       test:() => pfStats.days >= 90},
    {id:'days180',   ic:'bank',     nm:'Meio ano',        rar:'epica',    desc:'180 dias ativos.',                      test:() => pfStats.days >= 180},
    {id:'days365',   ic:'cake',     nm:'Um ano de casa',  rar:'lendaria', desc:'365 dias ativos — veterano de verdade.',test:() => pfStats.days >= 365},
    // ── Volume de uso ──
    {id:'opens10',   ic:'wrench',   nm:'Esquenta',        rar:'comum',    desc:'10 ferramentas abertas.',               test:() => pfStats.opens >= 10},
    {id:'opens50',   ic:'hammer',   nm:'Mão na massa',    rar:'comum',    desc:'50 ferramentas abertas.',               test:() => pfStats.opens >= 50},
    {id:'opens100',  ic:'nut',      nm:'Centena',         rar:'rara',     desc:'100 ferramentas abertas.',              test:() => pfStats.opens >= 100},
    {id:'opens200',  ic:'gear',     nm:'Engrenagem',      rar:'rara',     desc:'200 ferramentas abertas.',              test:() => pfStats.opens >= 200},
    {id:'opens500',  ic:'layers',   nm:'Motor da casa',   rar:'epica',    desc:'500 ferramentas abertas.',              test:() => pfStats.opens >= 500},
    {id:'opens1000', ic:'gauge',    nm:'Locomotiva',      rar:'lendaria', desc:'1000 ferramentas abertas.',             test:() => pfStats.opens >= 1000},
    // ── Ações na operação ──
    {id:'act1',      ic:'check',    nm:'Primeira ação',   rar:'comum',    desc:'Primeira ação registrada na operação.', test:() => pfStats.actions >= 1},
    {id:'act25',     ic:'clipboard',nm:'Executor',        rar:'comum',    desc:'25 ações na operação.',                 test:() => pfStats.actions >= 25},
    {id:'act100',    ic:'target',   nm:'Cirúrgico',       rar:'rara',     desc:'100 ações na operação.',                test:() => pfStats.actions >= 100},
    {id:'act500',    ic:'bolt',     nm:'Imparável',       rar:'epica',    desc:'500 ações na operação.',                test:() => pfStats.actions >= 500},
    {id:'act2000',   ic:'storm',    nm:'Força da natureza',rar:'lendaria',desc:'2000 ações na operação.',               test:() => pfStats.actions >= 2000},
    // ── Especialista por ferramenta ──
    {id:'painel10',  ic:'spade',    nm:'Homem do dia',    rar:'comum',    desc:'10 usos do Painel do Dia.',             test:() => tool('painel') >= 10},
    {id:'painel100', ic:'grid',     nm:'Dono da grade',   rar:'epica',    desc:'100 usos do Painel do Dia.',            test:() => tool('painel') >= 100},
    {id:'gu10',      ic:'moon',     nm:'Coruja',          rar:'comum',    desc:'10 usos da Criação Noturna.',           test:() => tool('gu') >= 10},
    {id:'gu100',     ic:'nightowl', nm:'Senhor da noite', rar:'epica',    desc:'100 usos da Criação Noturna.',          test:() => tool('gu') >= 100},
    {id:'cash10',    ic:'club',     nm:'Analista',        rar:'rara',     desc:'10 usos do Cash Intelligence.',         test:() => tool('cash') >= 10},
    {id:'learn5',    ic:'heart',    nm:'Estudioso',       rar:'comum',    desc:'5 aberturas do Poker Learn.',           test:() => tool('learn') >= 5},
    {id:'org5',      ic:'sparkle',  nm:'Astrônomo',       rar:'comum',    desc:'5 visitas à Constelação.',              test:() => tool('org') >= 5},
    {id:'alltools',  ic:'briefcase',nm:'Canivete suíço',  rar:'epica',    desc:'Usou todos os produtos do Suprema OS.', test:() => ['painel','gu','cash','learn','org'].every(t => tool(t) >= 1)},
    // ── Níveis ──
    {id:'lv5',       ic:'chart',    nm:'Nível 5',         rar:'comum',    desc:'Alcance o nível 5.',                    test:() => levelFromXp(pfXp()) >= 5},
    {id:'lv10',      ic:'trend',    nm:'Nível 10',        rar:'comum',    desc:'Alcance o nível 10.',                   test:() => levelFromXp(pfXp()) >= 10},
    {id:'lv15',      ic:'mountain', nm:'Nível 15',        rar:'rara',     desc:'Alcance o nível 15.',                   test:() => levelFromXp(pfXp()) >= 15},
    {id:'lv20',      ic:'medal',    nm:'Nível 20',        rar:'rara',     desc:'Alcance o nível 20.',                   test:() => levelFromXp(pfXp()) >= 20},
    {id:'lv25',      ic:'ascend',   nm:'Nível 25',        rar:'epica',    desc:'Alcance o nível 25.',                   test:() => levelFromXp(pfXp()) >= 25},
    {id:'lv35',      ic:'orbit',    nm:'Nível 35',        rar:'epica',    desc:'Alcance o nível 35 (5.780 XP).',        test:() => levelFromXp(pfXp()) >= 35},
    {id:'lv50',      ic:'stars',    nm:'Nível 50',        rar:'lendaria', desc:'Nível máximo — 12.005 XP, o teto da casa.', test:() => levelFromXp(pfXp()) >= 50},
    // ── Marcos da jornada ──
    {id:'bronze',    ic:'medal',    nm:'Bronze',          rar:'comum',    desc:'Alcançou a etapa Bronze (300 XP).',     test:() => pfXp() >= 300},
    {id:'prata',     ic:'medal',    nm:'Prata',           rar:'rara',     desc:'Alcançou a etapa Prata (700 XP).',      test:() => pfXp() >= 700},
    {id:'ouro',      ic:'trophy',   nm:'Ouro',            rar:'rara',     desc:'Alcançou a etapa Ouro (1500 XP).',      test:() => pfXp() >= 1500},
    {id:'platina',   ic:'gem',      nm:'Platina',         rar:'epica',    desc:'Alcançou a etapa Platina (3000 XP).',   test:() => pfXp() >= 3000},
    {id:'diamante',  ic:'diamond',  nm:'Diamante',        rar:'epica',    desc:'Alcançou a etapa Diamante (6000 XP).',  test:() => pfXp() >= 6000},
    {id:'suprema',   ic:'crown',    nm:'Suprema',         rar:'lendaria', desc:'12000 XP — o topo absoluto.',           test:() => pfXp() >= 12000},
    // ── Rank ──
    {id:'rkouro',    ic:'trophy',   nm:'Rank Ouro',       rar:'rara',     desc:'Alcance o rank Ouro por performance.',  test:() => rankScore() >= 450},
    {id:'rkdiam',    ic:'diamond',  nm:'Rank Diamante',   rar:'epica',    desc:'Alcance o rank Diamante.',              test:() => rankScore() >= 1600},
    {id:'rksup',     ic:'shield',   nm:'Rank Suprema',    rar:'lendaria', desc:'O rank mais alto por performance.',     test:() => rankScore() >= 4000},
    // ── Administração ──
    {id:'admin',     ic:'diamsuit', nm:'Admin',           rar:'epica',    desc:'Acesso de administrador.',              test:() => !!(session && isAdmin(session.email))},
  ];
  function renderBadges(){
    const box = $('pfBadges'); if(!box) return;
    let got = 0;
    box.innerHTML = PF_BADGES.map(b => {
      const on = b.test(); if(on) got++;
      const rar = b.rar || 'comum';
      // raridade também em TEXTO (não só a cor do aro) — daltônicos e touch
      return `<div class="pf-badge${on?'':' locked'}" data-rar="${rar}" title="${escHtml(b.desc)}${on?'':' (bloqueada)'}">
        <span class="bic">${PF_IC[b.ic] || b.ic}</span><span class="bnm">${escHtml(b.nm)}</span><span class="brar">${rar === 'epica' ? 'épica' : rar === 'lendaria' ? 'lendária' : rar}</span>
      </div>`;
    }).join('');
    const hint = $('pfBadgesHint');
    if(hint) hint.textContent = `${got}/${PF_BADGES.length} conquistadas`;
  }

  /* banner do cartão: mostra todos, trava os que ainda não foram desbloqueados */
  function paintBanner(){
    const hero = $('pfHero'); if(!hero) return;
    const xp = pfXp();
    const cur = PF_BANNERS.find(b => b.id === pfBanner);
    hero.dataset.banner = (cur && xp >= cur.xp) ? cur.id : 'felt';
    const picker = $('pfBannerPicker');
    if(picker){
      picker.innerHTML = PF_BANNERS.map(b => {
        const locked = xp < b.xp;
        return `<button type="button" data-b="${b.id}"${locked?' class="locked" disabled':''}
          title="${b.nm}${locked ? ` — desbloqueia aos ${b.xp} XP` : ''}" aria-label="Banner ${b.nm}">
          <span class="bnm">${b.nm}</span>
          ${b.xp ? `<span class="bxp">${locked ? PF_LOCK + ' ' : ''}${b.xp} XP</span>` : ''}
        </button>`;
      }).join('');
      const desbloq = PF_BANNERS.filter(b => xp >= b.xp).length;
      const hint = $('pfBannersHint');
      if(hint) hint.textContent = `${desbloq} de ${PF_BANNERS.length} desbloqueados`;
      picker.querySelectorAll('button:not(.locked)').forEach(bt => bt.addEventListener('click', () => {
        pfBanner = bt.dataset.b;
        try{ localStorage.setItem('suprema_user_banner_v1', pfBanner); }catch(e){}
        if(session && db && fbReady) db.ref(`users/${emailToKey(session.email)}/banner`).set(pfBanner).catch(()=>{});
        paintBanner();
      }));
      picker.querySelectorAll('button').forEach(bt => bt.classList.toggle('on', bt.dataset.b === hero.dataset.banner));
    }
  }

  /* level-up: celebração quando o nível sobe (comparado por navegador/conta) */
  let lvlUpLastFocus = null;
  function showLevelUp(lv){
    $('lvlUpNum').textContent = lv;
    const nf = nextFrame(pfXp());
    $('lvlUpSub').textContent = nf ? `Continue assim — a moldura ${nf.name} chega aos ${nf.xp} XP.` : 'Você está no topo da casa. Moldura máxima equipável. ♠';
    $('lvlUp').classList.add('open');
    $('lvlUp').setAttribute('aria-hidden','false');
    lvlUpLastFocus = document.activeElement;
    $('lvlUpOk').focus();   // a11y: Enter fecha a celebração direto
  }
  function closeLevelUp(){
    $('lvlUp').classList.remove('open'); $('lvlUp').setAttribute('aria-hidden','true');
    if(lvlUpLastFocus && lvlUpLastFocus.focus) lvlUpLastFocus.focus();
    lvlUpLastFocus = null;
  }
  $('lvlUpOk').addEventListener('click', closeLevelUp);
  $('lvlUp').addEventListener('click', e => { if(e.target === $('lvlUp')) closeLevelUp(); });

  // registra a abertura de um produto (chamado no clique dos tiles).
  // Os produtos da casa (painel, admin, gu, cash) se auto-registram via
  // SupremaAuth.trackUse ao abrir — aqui o hub só cobre os EXTERNOS
  // (Learn e Org), que não têm como escrever no nosso Firebase.
  const EXTERNAL_TILES = { 't-learn':'learn', 't-org':'org' };
  function trackOpen(toolId){
    if(!session) return;
    const key = emailToKey(session.email);
    try{
      if(db && fbReady){
        db.ref(`users/${key}/stats/opens`).transaction(n => (n||0)+1);
        if(toolId) db.ref(`users/${key}/stats/tools/${toolId}`).transaction(n => (n||0)+1);
        db.ref(`users/${key}/stats/days/${todayIso()}`).set(true);
      }
    }catch(e){}
  }
  document.querySelectorAll('.grid .tile').forEach(t => {
    const ext = Object.keys(EXTERNAL_TILES).find(c => t.classList.contains(c));
    if(ext) t.addEventListener('click', () => trackOpen(EXTERNAL_TILES[ext]));
  });

  let pfStatsWired = false, pfStatsWaitingAuth = false;
  function pfLoadStats(){
    if(pfStatsWired || !session || !db || !fbReady) return;
    // Pinta o card com o retrato local JÁ: enquanto o Auth restaura (ou numa volta
    // rápida), o operador vê o nível certo em vez do default Nível 1 ("resetado").
    pfLoadCacheAndPaint();
    // Numa navegação de volta ao hub, o token do Firebase Auth ainda não restaurou
    // quando esta função roda. Ler users/<key>/stats cedo dá permission_denied e o
    // RTDB CANCELA o listener (não re-tenta) — o nível ficava "resetado". Então
    // esperamos o usuário do Auth existir antes de anexar os listeners.
    if(!firebase.auth().currentUser){
      if(pfStatsWaitingAuth) return;
      pfStatsWaitingAuth = true;
      firebase.auth().onAuthStateChanged(function(u){ if(u){ pfStatsWaitingAuth = false; pfLoadStats(); } });
      return;
    }
    pfStatsWired = true;
    const key = emailToKey(session.email);
    db.ref(`users/${key}/stats`).on('value', s => {
      const v = s.val() || {};
      pfStatsLoaded = true;   // leitura autorizada e concluída — XP/nível agora são confiáveis
      pfSetStatsFromSnap(v);
      pfSaveCache();          // retrato local pra próxima abertura/volta não aparecer "resetada"
      checkMissions();
      lbPublish();
      renderProfileProgress();
      // level-up: compara com o último nível visto NESTA conta/navegador e celebra
      try{
        const lvKey = 'suprema_last_level_v1_' + key;
        const lv = levelFromXp(pfXp());
        const prev = parseInt(localStorage.getItem(lvKey) || '0', 10);
        if(prev > 0 && lv > prev) showLevelUp(lv);
        localStorage.setItem(lvKey, String(lv));
      }catch(e){}
    }, err => {
      // Leitura negada = sessão sem Firebase Auth vivo (ex.: login antigo só no localStorage).
      // NÃO mostramos 0 nem publicamos no leaderboard: o dado está intacto, falta re-login.
      pfStatsLoaded = false;
      console.warn('stats read negado — refaça login no hub para restaurar XP/nível.', err && err.code);
    });
    db.ref(`users/${key}/tag`).on('value', s => { pfTag = s.val(); renderProfileTag(); renderProfileTitles(); });
    // moldura equipada e banner seguem a CONTA (o localStorage só evita piscar no load)
    db.ref(`users/${key}/frame`).on('value', s => {
      const v = s.val();
      if(v !== null && v !== undefined){
        equippedFrame = +v;
        try{ localStorage.setItem('suprema_user_frame_v1', String(v)); }catch(e){}
        applyProgressionFrames();
      }
    });
    db.ref(`users/${key}/banner`).on('value', s => {
      const v = s.val();
      if(v){ pfBanner = v; try{ localStorage.setItem('suprema_user_banner_v1', v); }catch(e){} paintBanner(); }
    });
    // "continuar de onde parou": última ferramenta usada (gravada pelo suprema-auth)
    db.ref(`users/${key}/stats/lastTool`).on('value', s => {
      heroLastTool = s.val();
      try{ renderHeroOps(); }catch(e){}
    });
    // presença do dia: abrir o hub logado já conta como dia ativo
    db.ref(`users/${key}/stats/days/${todayIso()}`).set(true).catch(()=>{});
  }

  function renderProfileTag(){
    const t = TITLES.find(t => t.id === pfTag);
    $('pfTagPill').hidden = !t;
    if(t) $('pfTagTxt').textContent = t.name;
  }
  function renderProfileProgress(){
    const xp = pfXp(), lv = levelFromXp(xp);
    const cur = xpForLevel(lv), next = xpForLevel(lv+1);
    /* A MESA reflete a progressão: quanto mais alto o nível, mais quente o
       dourado do fundo. É a leitura periférica da jornada — o hub de um
       Titã não parece o hub de um Novato, sem precisar ler número nenhum.
       Nível 50 é o teto da curva (ver levelFromXp). */
    try{ if (window.__hubMesa) window.__hubMesa.heat(Math.min(1, lv / 50)); }catch(e){}
    $('pfLevel').textContent = lv;
    $('pfXpLbl').textContent = `${xp} XP`;
    $('pfXpNext').textContent = `nível ${lv+1} · ${next} XP`;
    // fill por scaleX (compositor) — o CSS anima transform, não width
    $('pfXpBar').style.transform = `scaleX(${Math.min(1, (xp-cur)/(next-cur)).toFixed(3)})`;
    $('pfXpMeta').textContent = `${pfStats.opens} aberturas · ${pfStats.days} dias ativos${pfStats.actions ? ` · ${pfStats.actions} ações` : ''}`;
    // grade de stats do cartão: os números CONTAM até o valor (dopamina barata,
    // rAF só enquanto anima; pulado com prefers-reduced-motion)
    const setStat = (id, n) => {
      const el = $(id); if(!el) return;
      n = n || 0;
      const from = +(el.dataset.v || 0);
      el.dataset.v = n;
      if(n === from || matchMedia('(prefers-reduced-motion: reduce)').matches){
        el.textContent = n.toLocaleString('pt-BR'); return;
      }
      const t0 = performance.now(), dur = 750;
      const step = t => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (n - from) * e).toLocaleString('pt-BR');
        if(p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    setStat('pfStatOpens', pfStats.opens);
    setStat('pfStatDays', pfStats.days);
    setStat('pfStatActions', pfStats.actions);
    setStat('pfStatMissions', missionsTotal());
    const rk = rankFromStats(), rkEl = $('pfRank');
    if(rkEl){ rkEl.dataset.rank = rk.id; $('pfRankNm').textContent = rk.name; }
    paintBanner();
    applyProgressionFrames();
    renderBadges();
    renderProfileTitles();
    renderMissions();
    renderActivity();
  }
  function renderProfileTitles(){
    const xp = pfXp();
    $('pfTitles').innerHTML = TITLES.map(t => {
      const locked = xp < t.xp;
      const on = pfTag === t.id;
      return `<button type="button" class="pf-title${locked?' locked':''}${on?' on':''}" data-id="${t.id}"
        title="${escHtml(t.desc)}${locked ? ` — desbloqueia com ${t.xp} XP` : ''}">${locked?`<span class="lock">${PF_LOCK}</span>`:''}${escHtml(t.name)}</button>`;
    }).join('');
    const nextT = TITLES.find(t => xp < t.xp);
    $('pfTitlesHint').textContent = nextT
      ? `Próximo título: ${nextT.name} aos ${nextT.xp} XP — faltam ${nextT.xp - xp}.`
      : 'Você desbloqueou todos os títulos. Lenda confirmada. ♠';
    $('pfTitles').querySelectorAll('.pf-title:not(.locked)').forEach(b => b.addEventListener('click', () => {
      pfTag = b.dataset.id === pfTag ? null : b.dataset.id;
      renderProfileTag(); renderProfileTitles();
      if(session && db && fbReady) db.ref(`users/${emailToKey(session.email)}/tag`).set(pfTag).catch(()=>{});
    }));
  }

  const PF_EMOJIS = ['🎯','🃏','♠️','♣️','♦️','♥️','🎲','🏆','⚡','🌟','🦁','🐯','🦊','🐺','🦅','🔥','💎','🥇','🎭','🚀','👑','🌙','⚔️','🛡️','🎱','🎰','🎮','💡','🏅','😎'];
  $('pfAvatar').addEventListener('click', () => {
    const picker = $('pfPicker');
    const atual = (()=>{ try{ return localStorage.getItem('suprema_user_avatar_v1'); }catch(e){ return null; } })();
    $('pfPickerGrid').innerHTML = PF_EMOJIS.map(e =>
      `<button type="button"${e===atual?' class="selected"':''} aria-label="Usar ${e}">${e}</button>`).join('');
    $('pfPickerGrid').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const em = b.textContent;
      try{ localStorage.setItem('suprema_user_avatar_v1', em); }catch(e){}
      if(session && db && fbReady) db.ref(`users/${emailToKey(session.email)}/avatar`).set(em).catch(()=>{});
      paintAvatar(em);
      picker.classList.remove('open');
    }));
    picker.classList.toggle('open');
  });

  function renderProfile(){
    if(!session) return;
    $('pfName').textContent = session.displayName || session.nome || '—';
    $('pfEmail').textContent = session.email;
    $('pfNick').value = session.apelido || session.displayName || '';
    const info = [
      { k:'Nome completo', v:`${session.nome||''} ${session.sobrenome||''}`.trim() || '—' },
      { k:'Email', v:session.email },
      { k:'Acesso', v:isAdmin(session.email) ? 'Admin ♦' : 'Operador' },
    ];
    $('pfInfo').innerHTML = info.map(i => `<div class="pf-row"><span class="k">${escHtml(i.k)}</span><span class="v">${escHtml(i.v)}</span></div>`).join('');
    paintAvatar();
    paintBanner();
    renderProfileTag(); renderProfileProgress();
  }

  let pfLastFocus = null;
  function openProfile(){
    if(!session) return;
    renderProfile();
    pfLoadStats();
    $('pfOverlay').classList.add('open');
    $('pfOverlay').setAttribute('aria-hidden','false');
    // a11y: foco entra no drawer (senão o Tab continua passeando pela página de trás)
    pfLastFocus = document.activeElement;
    $('pfClose').focus();
  }
  function closeProfile(){
    if(!$('pfOverlay').classList.contains('open')) return;
    $('pfOverlay').classList.remove('open');
    $('pfOverlay').setAttribute('aria-hidden','true');
    if(location.hash === '#perfil') history.replaceState(null,'',location.pathname);
    // a11y: devolve o foco pra quem abriu o perfil
    if(pfLastFocus && pfLastFocus.focus) pfLastFocus.focus();
    pfLastFocus = null;
  }
  $('navAvatar').addEventListener('click', openProfile);
  $('pfClose').addEventListener('click', closeProfile);
  // a11y: Tab fica DENTRO do drawer enquanto ele está aberto (focus trap)
  $('pfOverlay').addEventListener('keydown', e => {
    if(e.key !== 'Tab') return;
    const panel = $('pfOverlay').querySelector('.pf-panel');
    const foc = [...panel.querySelectorAll('button:not([disabled]), a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.getClientRects().length);
    if(!foc.length) return;
    const first = foc[0], last = foc[foc.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    else if(!panel.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  });
  $('pfOverlay').addEventListener('click', e => { if(e.target === $('pfOverlay')) closeProfile(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeProfile(); });

  // a11y: focus trap do gate de login — enquanto ele cobre a tela, o Tab fica
  // DENTRO do cartão (não há como "sair" de um gate; sem sessão não há página).
  $('gate').addEventListener('keydown', e => {
    if(e.key !== 'Tab' || $('gate').hidden) return;
    const card = $('gate').querySelector('.gate-card');
    const foc = [...card.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.getClientRects().length);
    if(!foc.length) return;
    const first = foc[0], last = foc[foc.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    else if(!card.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  });

  // apelido: salva no Firebase + sessão, e reflete em todos os painéis
  $('pfNickSave').addEventListener('click', () => {
    const nick = ($('pfNick').value||'').trim();
    if(!nick || !session) return;
    session = {...session, apelido:nick, displayName:nick};
    saveSession(session);
    if(db && fbReady) db.ref(`users/${emailToKey(session.email)}/apelido`).set(nick).catch(()=>{});
    paintAuthState();
    renderProfile();
    $('pfNickSave').textContent = 'Salvo ✓';
    setTimeout(() => { $('pfNickSave').textContent = 'Salvar'; }, 1500);
  });

  $('pfLogout').addEventListener('click', () => {
    if(!confirm('Sair da sua conta?')) return;
    clearSession();
    try{ localStorage.removeItem('suprema_trusted_admin'); }catch(e){}
    location.reload();
  });

  // bfcache: ao voltar pelo botão "voltar", o navegador restaura a página CONGELADA
  // sem re-rodar os scripts e com a conexão do Firebase possivelmente morta. Se o
  // operador saiu pro painel antes do XP carregar, o card ficava preso no Nível 1 e
  // só o F5 corrigia. No pageshow persistido: repinta do cache na hora e puxa o valor
  // ao vivo uma vez, pra o nível voltar ao certo sem precisar recarregar.
  window.addEventListener('pageshow', function(e){
    if(!e.persisted || !session) return;
    pfLoadCacheAndPaint();
    if(db && fbReady && firebase.auth().currentUser){
      db.ref(`users/${emailToKey(session.email)}/stats`).once('value').then(function(s){
        pfStatsLoaded = true;
        pfSetStatsFromSnap(s.val() || {});
        pfSaveCache();
        renderProfileProgress();
        lbPublish();
      }).catch(function(){});
    }
  });

  // deep-link: os painéis mandam o operador pra cá com hub.html#perfil
  if(location.hash === '#perfil' && session) setTimeout(openProfile, 300);

  // aviso de acesso: as áreas de admin devolvem operador comum pra cá com #sem-acesso
  if(location.hash === '#sem-acesso'){
    history.replaceState(null,'',location.pathname);
    const t = document.createElement('div');
    t.setAttribute('role','status'); t.setAttribute('aria-live','polite');
    t.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translate(-50%,10px);z-index:99999;'+
      'display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:99px;pointer-events:none;'+
      'background:rgba(14,16,15,.94);border:1px solid rgba(216,181,109,.5);color:#f2ede2;'+
      'font:600 13px/1.3 var(--text);box-shadow:0 12px 34px -10px rgba(0,0,0,.6);'+
      'opacity:0;transition:opacity .35s var(--ease),transform .35s var(--ease)';
    t.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#d8b56d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'+
      '<span>Essa &aacute;rea &eacute; restrita a administradores &mdash; voc&ecirc; est&aacute; de volta ao hub.</span>';
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translate(-50%,0)'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 5200);
  }

  // primeiro paint (offline / antes do Firebase responder): defaults embutidos
  renderPatchNotes();
  refreshBoardsAdminUI();

  paintAuthState();

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAFy1GtRaJE3LHC1Rjtmq0uw2JC8bviXes",
    authDomain: "design-1-53c00.firebaseapp.com",
    databaseURL: "https://design-1-53c00-default-rtdb.firebaseio.com",
    projectId: "design-1-53c00",
    storageBucket: "design-1-53c00.firebasestorage.app",
    messagingSenderId: "140511032441",
    appId: "1:140511032441:web:dcf970125bbf5eec53d0a8"
  };

  // Dia OPERACIONAL em São Paulo: antes das 05:30 ainda é o dia anterior (mesma regra do painel)
  function opDates(){
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false
    }).formatToParts(new Date()).reduce((a,p)=>(a[p.type]=p.value,a),{});
    const ref = new Date(Date.UTC(+parts.year, +parts.month-1, +parts.day, 12));
    const hm = +parts.hour*60 + +parts.minute;
    if (hm < 5*60+30) ref.setUTCDate(ref.getUTCDate()-1);
    const iso = d => d.toISOString().slice(0,10);
    const tomorrow = new Date(ref); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    return { today: iso(ref), tomorrow: iso(tomorrow) };
  }

  function show(id, txtId, txt){
    document.getElementById(txtId).textContent = txt;
    document.getElementById(id).hidden = false;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    // Mesmo protocolo do painel: a conexão fica pronta JÁ — o auth anônimo
    // roda em paralelo (se falhar, os listeners é que não recebem dados).
    // Antes o db/fbReady do gate nunca eram setados e login/gravações no hub
    // morriam com "Sem conexão com o servidor".
    db = firebase.database();
    fbReady = true;
    /* boards só com auth viva: a restauração da sessão do Firebase Auth é
       assíncrona, e listener anexado antes dela é negado pelas regras e
       CANCELADO — agenda/leaderboard/avisos ficavam vazios até F5 (mesma
       corrida já corrigida no Painel do Dia). */
    if (firebase.auth().currentUser) initBoards(db);
    else {
      let boardsWired = false;
      firebase.auth().onAuthStateChanged(u => { if (u && !boardsWired){ boardsWired = true; initBoards(db); } });
    }
    // usuário já logado ao abrir: carrega o XP cedo pra moldura de progressão
    // aparecer no avatar do hero sem precisar abrir o perfil.
    if(session) pfLoadStats();
    // Admin reconhecido neste navegador: nada de tela de login — a sessão é
    // recriada direto do cadastro no Firebase e o gate nem aparece.
    (function restoreTrustedAdmin(){
      if(session) return;
      let trusted = null;
      try{ trusted = localStorage.getItem('suprema_trusted_admin'); }catch(e){}
      if(!trusted || !isAdmin(trusted)) return;
      db.ref(`users/${emailToKey(trusted)}`).once('value').then(snap => {
        if(!snap.exists()) return;
        const u = snap.val();
        const displayName = u.apelido || u.nome || trusted;
        saveSession({ email:trusted, nome:u.nome, sobrenome:u.sobrenome, apelido:u.apelido, displayName,
          access: u.access || null, admin: (u.admin===true || u.Admin===true || isAdmin(trusted)) });
        paintAuthState();
        startLiveTiles();
      }).catch(()=>{});
    })();
    // Cutover email/senha (Fase 4): sem login anônimo. Os tiles ao vivo rodam
    // direto — antes ficavam presos no .then() do anônimo (que falhava e deixava
    // os tiles estáticos). O token de leitura vem da sessão email/senha do hub.
    (function loadLiveTiles(){
      const { today, tomorrow } = opDates();

      // Painel: operadores online + a grade do dia (torneios e conferidos)
      let pOnline = 0, pTorneios = 0, pConferidos = 0;
      const paintPainel = () => {
        const parts = [];
        if (pOnline > 0) parts.push(pOnline + ' online');
        if (pTorneios > 0) parts.push(pTorneios + ' torneios' + (pConferidos > 0 ? ` · ${pConferidos} conferidos` : ''));
        if (parts.length) show('livePainel', 'livePainelTxt', parts.join(' · '));
        else document.getElementById('livePainel').hidden = true;
      };
      // presence é leitura pública — pode anexar já
      db.ref('presence').on('value', s => { pOnline = s.numChildren(); paintPainel(); });

      // Criação GU: progresso da noite (torneios criados / total da receita)
      const guBase = `painel/${tomorrow}/criacaoNoturna`;
      let guTotal = 0, guDone = 0;
      const paintGu = () => {
        if (guTotal > 0) show('liveGu', 'liveGuTxt', `${guDone}/${guTotal} criados · ${Math.round(guDone/guTotal*100)}%`);
      };

      // painel/criacaoNoturna exigem auth (regras estritas). Numa volta ao hub o token
      // do Firebase Auth ainda não restaurou; anexar cedo dá permission_denied e o RTDB
      // CANCELA o listener, deixando os tiles vazios. Só anexamos com usuário autenticado.
      const wirePainelTiles = () => {
        // As regras gateiam painel/criacaoNoturna por acesso — só assina o que este
        // usuário PODE ler, senão o RTDB devolve permission_denied e cancela o listener.
        if(canAccessHub('painel')){
          // lê só o contador (barato); planilhas antigas sem `count` caem no fallback de 1 leitura das rows
          db.ref(`painel/${today}/sheet/count`).on('value', s => {
            const n = s.val();
            if(typeof n === 'number'){ pTorneios = n; paintPainel(); }
            else db.ref(`painel/${today}/sheet/rows`).once('value').then(r => { pTorneios = r.numChildren(); paintPainel(); });
          });
          db.ref(`painel/${today}/checklist`).on('value', s => { pConferidos = s.numChildren(); paintPainel(); });
        }
        if(canAccessHub('gu')){
          // ECONOMIA DE BANDA: lê só o contador (um número), não a grade inteira. Fallback
          // pra grades antigas (sem o campo count): baixa o json 1x.
          db.ref(`${guBase}/sheet/count`).on('value', s => {
            const c = s.val();
            if (typeof c === 'number') { guTotal = c; paintGu(); }
            else db.ref(`${guBase}/sheet/json`).once('value').then(js => {
              try { const d = JSON.parse(js.val()); guTotal = (d.main||[]).length + (d.side||[]).length + (d.sat||[]).length; paintGu(); } catch(e){}
            });
          });
          db.ref(`${guBase}/done`).on('value', s => { guDone = s.numChildren(); paintGu(); });
        }
      };
      if(firebase.auth().currentUser) wirePainelTiles();
      else { let wired = false; firebase.auth().onAuthStateChanged(function(u){ if(u && !wired){ wired = true; wirePainelTiles(); } }); }
    })();
  } catch(e){ /* offline: hub continua funcionando como launcher */ }
})();

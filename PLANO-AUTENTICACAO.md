# Plano de migração — Firebase Auth + regras estritas

Objetivo: fechar o buraco em que **o `pwHash` de todos é legível por qualquer visitante**
(porque hoje o login lê o hash e confere a senha no navegador, com login anônimo e regras
abertas), sem derrubar o login da operação ao vivo.

**Estratégia: migração preguiçosa (lazy migration).** Os hashes são mistos (pbkdf2v2,
pbkdf2, SHA-256 puro, legado `h2_`) — inclusive o admin em SHA-256 — então importar todos
para o Firebase Auth em lote é inviável. Em vez disso, cada usuário é migrado **no próximo
login que fizer**: confere-se a senha contra o hash antigo uma última vez e cria-se a conta
no Firebase Auth com a mesma senha. Ninguém precisa redefinir senha. Há uma janela de
compatibilidade (login antigo E novo funcionam juntos), e só no fim (Fase 4) as regras
fecham. **Zero risco de lockout durante a transição.**

Fonte da verdade dos admins nas regras: a lista fixa de e-mails em `database.rules.target.json`
(`brian.rodrigues@`, `admin@`, `brian@` `@suprema.group`). Ela precisa bater com `ADMIN_EMAILS`
em `suprema-auth.js`. Se um dia mudar, muda nos dois lugares.

---

## Fase 0 — Preparação e rede de segurança (sem publicar nada)

1. **Backup das regras atuais.** No Firebase Console → Realtime Database → Regras, copie o
   JSON atual para `database.rules.backup-AAAA-MM-DD.json` no repo. (Hoje há **dois** arquivos
   conflitantes no projeto — `database.rules.json` estrito e `firebase.rules.json` aberto;
   confirme qual está realmente publicado. O aberto provavelmente está, porque o login
   precisa ler `pwHash`.)
2. **Backup do nó `users`.** Console → Exportar JSON do nó `users` para um arquivo local.
   É o seguro contra qualquer engano de escrita durante a migração.
3. **Inicializar o Firebase Authentication (importante — hoje ele NÃO existe).**
   Descoberto ao testar a Fase 1: toda chamada de auth retorna
   `auth/configuration-not-found` — inclusive o `signInAnonymously` que os painéis
   fazem hoje. Ou seja, **o app roda sem autenticação nenhuma**, só pelas regras
   abertas; isso reforça a urgência. Passos:
   - Console → **Authentication → Começar** (inicializa o serviço).
   - **Sign-in method → habilitar Email/Password** (Spark serve; sem Cloud Functions).
   - **Settings → Authorized domains**: adicionar o domínio do GitHub Pages
     (`prod-sup.github.io`) e `localhost` — senão o login recusa por domínio.
   Enquanto isso não é feito, a Fase 1 já pode estar no ar: os passos de Auth
   falham de leve e o login legado continua funcionando (verificado).
4. **Personalizar o e-mail de redefinição** (Authentication → Templates) em pt-BR, remetente
   e domínio corretos — será o novo "esqueci minha senha".
5. **Usuário de teste.** Crie `teste@suprema.group` com senha conhecida, para validar cada
   fase sem tocar em conta real.

Rollback da Fase 0: nada foi publicado. Basta desabilitar o provedor se quiser.

---

## Fase 1 — Código com compatibilidade dupla (deploy no GitHub Pages)

Aqui o `hub.html` (dono do login/cadastro/recuperação) passa a falar Firebase Auth, **mantendo**
o caminho antigo como fallback. As **regras continuam as de hoje** (abertas) — nada trava.

Mudanças em `hub.html`:

- **Cadastro novo** → `createUserWithEmailAndPassword(email, senha)`. Ao criar, grava o
  registro em `users/<emailToKey>` com `authUid` = `cred.user.uid` e **sem `pwHash`**.
- **Login**:
  1. Tenta `signInWithEmailAndPassword(email, senha)`. Deu certo → já é usuário Firebase Auth;
     segue (grava sessão compartilhada via `SupremaAuth.saveSession`).
  2. Falhou com `auth/user-not-found` → é usuário **legado**. Confere a senha contra o
     `pwHash` antigo com `SupremaAuth.verifyPassword` (código que já existe). Se bater:
     `createUserWithEmailAndPassword(email, senha)` → grava `authUid`, remove `pwHash`,
     marca migrado. Se não bater → "senha incorreta".
  3. `auth/wrong-password` numa conta já Firebase → "senha incorreta".
- **Recuperação de senha** → passa a `sendPasswordResetEmail(email)` (e-mail real do Firebase).
  Remover o fluxo do código de 6 dígitos em `passwordReset/` assim que a Fase 1 estiver estável.
- **Rate limit** (`loginAttempts`/`loginLockUntil`): pode sair — o Firebase Auth já limita
  tentativas. Remover na Fase 1 ou deixar quieto até a Fase 4.

Mudanças em `suprema-auth.js`:

- Adicionar helpers finos: `signInEmail`, `signUpEmail`, `sendReset`, `onUser(cb)`
  (wrapper de `onAuthStateChanged`). Manter `verifyPassword`/`hashPassword` **só** enquanto
  durar a janela (Fase 1–3); remover na Fase 4.

Painéis (`index`, `admin`, `criacao`, `cash`): **nenhuma mudança nesta fase**. Eles seguem
com `signInAnonymously` e leem a sessão do localStorage. Como as regras ainda estão abertas,
tudo funciona. (A troca de anônimo → Auth real acontece na Fase 4.)

Validação: com o usuário de teste e uma conta legada real, confirmar os 3 caminhos de login,
o cadastro novo e o reset por e-mail. Conferir no Console → Authentication que as contas vão
aparecendo.

Rollback da Fase 1: reverter o commit do `hub.html`/`suprema-auth.js` (as contas Firebase Auth
já criadas não atrapalham — o login legado continua válido porque `pwHash` ainda existe).

---

## Fase 2 — Deixar a base migrar sozinha (dias/semanas)

**ATENÇÃO — quem já estava logado NÃO migra sozinho.** A migração acontece no
*momento do login* (precisa da senha em texto, que a sessão salva não guarda). Quem
tem sessão válida (365 dias) entra direto e nunca passa pelo login — logo, nunca
migra só navegando. Para migrar, a pessoa precisa **sair e entrar de novo uma vez**
(mesma senha). Isso vale para os já-logados no dia do deploy (ex.: Brian e Kelly).
Estratégia de rollout: pedir para a equipe sair/entrar uma vez, ou, perto da Fase 4,
forçar re-login/reset dos que ainda não têm `authUid`. A rede de segurança final é a
trava da Fase 4 (`onAuthStateChanged`): quem chegar sem usuário do Firebase Auth é
mandado ao login uma vez e migra ali — ninguém perde a conta.

Com a Fase 1 no ar, todo login migra um usuário. Acompanhar o progresso:

- Contagem de migrados: no Console, quantos registros em `users` já têm `authUid` vs total.
- É esperado chegar perto de 100% em 1–2 ciclos de turno, já que os operadores logam
  todo dia.
- Avisar a equipe (uma vez): "faça login normalmente; sua senha continua a mesma".

Sem rollback necessário — é só espera monitorada.

---

## Fase 3 — Fechar os retardatários

Perto da data de cutover, para quem ainda não migrou (`users` sem `authUid`):

- Admin dispara **redefinição de senha** (`sendPasswordResetEmail`) para esses e-mails. Ao
  definir a nova senha, o Firebase cria a conta Auth deles.
- Alternativa para contas de serviço/genéricas: migrar manualmente logando uma vez.

Meta: **0 registros sem `authUid`** antes da Fase 4.

---

## Fase 4 — Cutover (a troca que fecha o buraco)

Só quando a Fase 3 zerar os retardatários. Ordem importa:

1. **Painéis passam a exigir Firebase Auth.** Em `index`, `admin`, `criacao`, `cash`, trocar
   `firebase.auth().signInAnonymously()` por esperar `onAuthStateChanged`: se **não** houver
   usuário Firebase Auth, redirecionar pro `hub.html` (login). Como o Firebase Auth persiste
   a sessão por origem (IndexedDB), quem logou no hub já chega autenticado nos painéis — o
   `SupremaAuth.guard()` do admin continua valendo como primeira barreira via localStorage.
2. **Remover a verificação client-side de senha.** Tirar `verifyPassword`/`hashPassword` e a
   leitura de `pwHash` do `hub.html` e do `suprema-auth.js`. O login agora é 100% Firebase Auth.
3. **Apagar os `pwHash`.** Script único (admin) removendo `users/<key>/pwHash` de todos.
   Guardar o backup da Fase 0 antes.
4. **Publicar `database.rules.target.json`.** Este arquivo fecha `users` (só o dono lê o
   próprio registro via `authUid`; admin lê a coleção; `pwHash` deixa de ser legível),
   valida `admin` pelo e-mail do token, e trava `passwordReset`.
5. **Limpeza.** Apagar `firebase.rules.json` e o `database.rules.json` antigo (deixar só o
   `.target` como fonte). Remover o nó `passwordReset/` do banco.

Validação do cutover (com o usuário de teste, numa aba anônima):
- Sem login → painéis e hub barram e mandam pro login. ✓
- Login pelo hub → todos os painéis abrem sem novo login. ✓
- Tentar ler `users` de outro e-mail no console de rede → **negado**. ✓
- `pwHash` não existe / não é legível. ✓
- Admin abre `admin.html` direto; não-admin é barrado. ✓

Rollback da Fase 4: republicar `database.rules.backup-*.json` (reabre o acesso). Como o
`pwHash` foi apagado no passo 3, o rollback **completo** do login legado exige também restaurar
o backup do nó `users` da Fase 0. Por isso os passos 3 e 4 só depois da Fase 3 estar 100%.

---

## Resumo de risco

- **Fases 0–3:** risco ~nulo. Nada trava; login antigo e novo convivem; dá pra reverter só
  com um `git revert`.
- **Fase 4:** é a única irreversível-na-prática (apaga `pwHash`). Fazer com você presente,
  fora do horário de pico, com os backups da Fase 0 à mão e o usuário de teste validando
  antes de mexer em conta real.

## O que já está pronto neste repo

- `database.rules.target.json` — as regras estritas do estado final (não publicar antes da Fase 4).
- `suprema-auth.js` — a camada compartilhada onde os novos helpers de Firebase Auth entram.
- Este runbook.

Próximo passo quando você quiser começar: eu implemento a **Fase 1** no `hub.html` +
`suprema-auth.js` (compatibilidade dupla), você habilita o provedor Email/Senha no Console,
e validamos com o usuário de teste antes de qualquer commit em produção.

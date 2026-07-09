# Fase 4 — patches dos painéis (aplicar só no cutover)

Estas mudanças **não** devem ir pro ar junto com a Fase 1. Elas são o corte final:
trocam o `signInAnonymously` (que hoje falha silenciosamente e só funcionava porque
as regras estão abertas) por **esperar o usuário do Firebase Auth** — a sessão que a
pessoa criou ao logar no hub e que persiste por origem (mesma máquina/domínio).
Quem chegar sem usuário autenticado é mandado pro hub logar.

**Pré-condições (não pule):**
1. Fase 1 no ar há tempo suficiente e a base migrada (ferramenta `fase4-limpar-pwhash.html`
   mostrando **0 não migrados**).
2. `brian.rodrigues@suprema.group` já migrado (logue uma vez e confirme na ferramenta).
3. Rodar a ferramenta e apagar os `pwHash` das contas migradas.
4. **Só então** aplicar estes patches + publicar `database.rules.target.json`.

Ordem no cutover: **patches dos painéis → deploy → apagar pwHash → publicar regras estritas.**
(Se publicar as regras antes dos painéis, os painéis antigos perdem acesso ao banco.)

---

## A trava padrão (a mesma nos painéis)

```js
// Fase 4: sem auth anônimo. A sessão do Firebase Auth (login feito no hub) persiste
// por origem; sem usuário autenticado, volta pro hub logar. O RTDB segura a 1ª
// leitura até o token de auth resolver, então os listeners abaixo continuam iguais.
firebase.auth().onAuthStateChanged(function(u){ if(!u) location.replace('hub.html'); });
```

---

## 1) index.html  (Painel do Dia) — linha ~6280

**Trocar:**
```js
    firebase.auth().signInAnonymously().catch(e => console.warn('auth anônimo falhou', e));
```
**Por:**
```js
    firebase.auth().onAuthStateChanged(function(u){ if(!u) location.replace('hub.html'); });
```
`index.html` já carrega `firebase-auth-compat` — nada mais a fazer aqui.

---

## 2) criacao-noturna.html — linha ~1593

**Trocar:**
```js
  firebase.auth().signInAnonymously().catch(e => console.warn('auth anônimo falhou (regras abertas ainda funcionam)', e));
```
**Por:**
```js
  firebase.auth().onAuthStateChanged(function(u){ if(!u) location.replace('hub.html'); });
```

---

## 3) admin.html — linha ~1675

**Trocar:**
```js
    firebase.auth().signInAnonymously().catch(e=>console.warn('auth anônimo falhou',e));
```
**Por:**
```js
    firebase.auth().onAuthStateChanged(function(u){ if(!u && !SupremaAuth.recognize().email) location.replace('hub.html'); });
```
O admin já tem `SupremaAuth.guard()` no topo e `autoEnterFromSession()`; a trava aqui
é a segunda camada (garante usuário do Firebase Auth para as regras estritas).

---

## 4) hub.html — linha ~1951 (dono do login)

O hub **não** precisa mais de auth anônimo: antes do login o gate cobre tudo (os dados
dos boards só aparecem depois de logar). No bloco do Firebase, **remover** a linha:
```js
    firebase.auth().signInAnonymously().then(() => {
```
e reorganizar para que os listeners de "dados vivos" (presence/GU) rodem **dentro** de:
```js
    firebase.auth().onAuthStateChanged(function(u){
      if(!u) return;            // sem login, os boards ficam ocultos atrás do gate
      // ... (o mesmo corpo que hoje está no .then() do signInAnonymously) ...
    });
```
Assim os badges de presença/GU aparecem quando há usuário logado. Os fluxos de
login/cadastro/reset da Fase 1 já autenticam via email/senha — nada muda neles.

---

## 5) dashboard-mesa-cash.html — ATENÇÃO: precisa de duas mudanças

O Cash **não** usa `firebase.auth()` hoje (só lê a sessão do localStorage) e **não**
carrega o SDK de auth. Sob as regras estritas ele perde acesso ao banco. Então:

**a) Adicionar o SDK de auth** — junto dos outros `<script>` do Firebase no `<head>`
(entre o `firebase-app-compat` e o `firebase-database-compat`):
```html
<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
```

**b) Adicionar a trava** logo após o `firebase.initializeApp(...)` do Cash:
```js
firebase.auth().onAuthStateChanged(function(u){ if(!u) location.replace('hub.html'); });
```

---

## Validação do cutover (com o usuário de teste, aba anônima)

- Sem login → cada painel manda pro hub. ✓
- Login pelo hub → todos os painéis abrem sem novo login (sessão do Auth persiste). ✓
- Ler `users/<outro>` no console de rede → **negado**. ✓
- `pwHash` não existe mais. ✓
- Admin abre `admin.html` direto; não-admin é barrado. ✓

## Rollback

Republicar `database.rules.backup-*.json` (reabre o acesso) **e** reverter estes
patches (`git revert`). Como o `pwHash` já foi apagado, o rollback completo do login
legado exige também restaurar o backup do nó `users` (Fase 0). Por isso os passos 3–5
só depois da migração 100%.

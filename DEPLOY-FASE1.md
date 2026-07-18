# Deploy da Fase 1 (e das melhorias desta rodada)

Tudo aqui é **frontend** (GitHub Pages). **Não** mexe nas regras do Firebase agora —
elas continuam como estão até a Fase 4.

## Arquivos que VÃO pro ar (copiar pro repo do Pages)

Deploy juntos, na mesma leva:

| Arquivo | O quê |
|---|---|
| **`suprema-auth.js`** | **NOVO** — camada de sessão/admin/tema/Firebase Auth |
| `hub.html` | login com migração preguiçosa (Fase 1) + perfil + tema + "Fique ligado" |
| `admin.html` | reconhece admin e entra direto; usa o `suprema-auth.js` |
| `index.html` | badge do operador → `hub.html#perfil`; tema sincronizado |
| `criacao-noturna.html` | ordem das colunas + linha "Criar em"; tema sincronizado |
| `dashboard-mesa-cash.html` | tema sincronizado |

⚠️ **`suprema-auth.js` e `admin.html` andam JUNTOS.** O admin quebra se subir sem o
`suprema-auth.js` no mesmo diretório (ele faz `<script src="suprema-auth.js">`).

## Arquivos que NÃO vão agora

- `database.rules.target.json` — regras estritas: publicar **só na Fase 4**, pelo Console
  do Firebase (não é arquivo do Pages).
- `fase4-limpar-pwhash.html` — ferramenta da Fase 4. Pode subir junto (é inofensiva, exige
  login de admin), mas só será usada no corte. Opcional agora.
- `PLANO-AUTENTICACAO.md`, `FASE4-PATCHES.md`, `DEPLOY-FASE1.md` — documentação; ficam no
  repo pra referência, não precisam estar no site.

## NÃO copiar pra produção (são só do preview local)

- `.claude/serve.ps1`, `.claude/launch.json` — servidor de teste local.

## Ordem

1. Copiar os 6 arquivos da tabela pro repo do GitHub Pages (o mesmo diretório onde já
   estão `hub.html`, `index.html` etc. hoje).
2. Rodar `deploy.ps1` (faz o bump do `sw.js` → as abas abertas recebem o banner de
   "nova versão"), ou publicar como você já faz.
3. **Você loga primeiro** em `hub.html` com sua conta — isso te migra na hora. Confirme
   abrindo `fase4-limpar-pwhash.html` (ou o Console → Authentication → Users): sua conta
   deve aparecer com `authUid`.
4. Deixe a base rodar. Cada pessoa que logar migra sozinha (Fase 2). Nada mais a fazer
   até o corte da Fase 4.

## Importante

- **Não toque nas regras do Firebase agora.** Elas seguem abertas durante as Fases 1–2;
  é isso que garante que ninguém trava enquanto migra.
- O login legado continua valendo o tempo todo. Se algo no Firebase Auth falhar, cai no
  antigo — testado.

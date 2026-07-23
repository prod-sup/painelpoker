# Copiloto de IA — backend

Cloud Function que dá voz ao **"Pergunte ao Suprema OS"**. Independente do Pipefy:
é a única função aqui, no mesmo projeto Firebase (`design-1-53c00`), com o nome
`supremaCopiloto` — a URL que o cliente já usa.

O repositório do painel é **público**, então a chave da Anthropic **não** pode ir
no cliente. Ela mora aqui como um *secret* do Firebase; o navegador só manda a
pergunta + um snapshot do estado, com um ID token do Firebase Auth (gate anti-abuso).

## Deploy (uma vez)

```sh
cd copiloto/functions
npm i
firebase functions:secrets:set ANTHROPIC_API_KEY      # cola a chave sk-ant-...
firebase deploy --only functions:supremaCopiloto      # NÃO toca em outras funções (ex. pipefyApi)
```

A URL fica: `https://us-central1-design-1-53c00.cloudfunctions.net/supremaCopiloto`
(é o default do cliente). Se sair diferente, ajuste `window.SUPREMA_COPILOTO_URL`
no painel.

## O que ele faz

- Recebe `{ question, snapshot, panel }` via POST.
- Exige `Authorization: Bearer <ID token do Firebase Auth>` — senão 401.
- Chama o Claude (`claude-opus-4-8`, adaptive thinking, effort medium) com um
  system prompt que responde **só** a partir do snapshot (não inventa números).
- Devolve `{ answer }`.

Custo é por uso (tokens da Anthropic); o gate por login evita queima anônima.

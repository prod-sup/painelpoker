# Sync do PokerByte — ferramenta local

**Esta pasta é ignorada pelo git de propósito.** O repositório é o site publicado:
tudo que for versionado fica baixável por URL. Aqui dentro moram o cookie de sessão
do PokerByte e capturas com dados de clube/afiliado — nenhum dos dois pode ir pro ar.

## Por que existe

O PokerByte não tem API pública e o painel `/metas` responde 401 sem sessão. O login
tem reCAPTCHA v3 e código de e-mail válido por 5 minutos, então **automatizar o login
é inviável**. A saída é criar a sessão uma vez, à mão, e reaproveitá-la.

## Como usar

Node não está no PATH desta máquina. Prefixe:

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.18.0-win-x64;$env:Path"
```

### 1. Criar a sessão (uma vez, e de novo quando expirar)

```powershell
node _pokerbyte/login.mjs
```

Abre o Edge. Faça o login normalmente — e-mail, senha, captcha, código do e-mail.
O script detecta sozinho quando a sessão entra e salva o perfil em `_pokerbyte/perfil/`.

### 2. Capturar o payload da meta

```powershell
node _pokerbyte/capture.mjs
```

Abre a `/metas` já logado e grava **toda resposta JSON** enquanto você navega.
Abra a meta de um Main Event e passeie pelas abas — no print, a tabela por afiliado
vive num modal, não na primeira carga. Feche a janela quando terminar.

Saída em `_pokerbyte/capturas/<data-hora>/`, com um `_indice.json` ordenado por
"cara de payload de meta".

### 3. (ainda não existe) Sync

Com o formato real em mãos, entra o `sync.mjs`: lê a meta, normaliza e grava no
Firebase (`painel/<dia>/metasDados/<key>`), de onde o painel lê. É o que destrava
o "META ALCANÇADA" automático e, mais adiante, a geração da imagem.

## Estrutura da /metas (descoberta em 20/08/2026)

A página é **HTML renderizado no servidor** — não há API JSON. O scraper lê o DOM.

**Sessão** — dois cookies em `www.pokerbyte.com.br/api`:

| Cookie | Significa |
|---|---|
| `suprema-token` | JWT da sessão |
| `suprema-filter` | slot/clube escolhido (`106-10044` = Liga Suprema ADM) |

Sem o `suprema-filter` a página vem vazia ("0 Clubes filtrados"). Ele persiste no
perfil junto com a sessão. **Não** dá pra detectar login pelo HTML: toda página do
app tem `input[type=password]` (form de troca de senha no shell).

**Listagem** — `div.card`, fora de `.edit-filter-modal` (o modal de filtro também
contém "MAIN EVENT" e "MAIOR BUY-IN" e envenena qualquer busca por texto).
A classe carrega tipo e status: `card <main|paralelo|satelite> <inicio|andamento|finalizado>`.
Texto: `MAIN EVENT <nome> Suprema <hora> Buy-in: R$ x GTD: R$ y <status>`.

**Modal** — clicar no card abre `div.modal-content:has(table#details)`.
Existem 5 `.modal-content` pré-renderizados; os outros 4 ficam com caixa 0×0.

⚠️ **O print sai por CLIP de coordenada, não por `element.screenshot()`, e a viewport
é 1900×1200.** Duas razões, ambas medidas:

1. O modal mede sempre `viewport + 2px` — **sempre** excede a viewport. Um
   `element.screenshot()` faz o Playwright rolar a página pra enquadrar; como o
   ancestral é `position: fixed`, o fundo se move e o print sai com os *cards* em
   vez do modal. Capturar por `page.screenshot({clip})` não rola nada.
2. As linhas da tabela **esticam** pra preencher a altura: a 1500 ficam ~30% mais
   altas que o natural (~1067px para 20 linhas). 1200 é o ponto em que nada rola e
   nada incha.

**Dados** — o painel lateral são `<input>` (use `.value`, não `textContent`):

| `name` do input | Conteúdo |
|---|---|
| `torneio` / `liga` / `data` | identificação |
| `dataStart` / `dataLate` | início e late |
| `buyin` | buy-in |
| `acoes-necessarias` | garantido (GTD) |
| `acoes-faltantes` | overlay |
| `data_importacao` | "Atualizado em" |

`Arrecadado p/ GTD` é texto solto, não input. **META ALCANÇADA = arrecadado ≥ garantido.**
A tabela por afiliado é `table#details` (20 linhas + TOTAL).

## Variáveis de ambiente

| Variável | Para quê | Padrão |
|---|---|---|
| `PLAYWRIGHT_HOST_PKG` | `package.json` de onde sai o `playwright-core` | projeto Grade-MTT |
| `EDGE_PATH` | executável do Edge | Program Files (x86) |
| `POKERBYTE_URL` | base do site | `https://www.pokerbyte.com.br` |
| `POKERBYTE_METAS` | página de metas | `<base>/metas` |
| `LOGIN_TIMEOUT_MIN` | tempo pra concluir o login | 10 |
| `CAPTURE_TIMEOUT_MIN` | tempo de gravação | 15 |

## Cuidado operacional

Quando o sync automático existir, mantenha a frequência civilizada (5–15 min, não 5s)
e puxe só as suas metas. O reCAPTCHA no login indica que eles não gostam de acesso
automatizado — vale ler o `/policy` deles antes de deixar rodando 24/7.

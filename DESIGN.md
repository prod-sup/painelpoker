# SUPREMA OS — Sistema de Design

Um produto, uma voz. Chrome igual em todo painel + **um** acento por produto (modelo Riot).
Esta é a fonte de verdade das regras visuais; quando um painel diverge, ele está errado, não a regra.

> Fonte única de tokens: [`suprema-tokens.css`](suprema-tokens.css) (carregado **por último** em cada
> painel, então vence os `:root` internos). Mudou a marca? Muda aqui, muda em todos.

---

## 1. Identidade

- **Dourado da marca**: `#8f6b2d` (claro) / `#c9a84c` (escuro) — `--sup-gold` / `--sup-gold-dark`.
  Nunca invente um terceiro dourado (o hub/cash já fizeram isso com `#d8b56d`, que é a cor do
  Organograma). No dark o dourado troca de valor **num lugar só** — apps só consomem `--gold`.
- **Acento por produto** (`--sup-p-*`): Painel = feltro `#18a36b`, Admin = dourado, Criação GU =
  violeta `#8c5cc6`, Learn = âmbar `#e8933d`, Cash = azul `#4f8ef7`, Eventos = framboesa `#b3475d`.
- **Cores de categoria** (Main / Side / Satélite) são **significado**, não decoração — o mesmo
  vermelho-queimado de Main aparece no Painel, na Criação, no Radar e no telão. Vêm de
  `--sup-cat-*`, nunca copiadas por painel.
- **Header**: wordmark "Suprema OS" + pill do produto na cor dele. TV mantém logo de canal.
- **Tipografia**: `--sup-display` / `--sup-text` / `--sup-mono` (stack Segoe UI no Windows antes de
  Helvetica — senão cai em Arial). Escala de tipo/espaço/sombra/raio toda tokenizada (`--sup-*`).

## 2. Tema

- Claro/escuro via `data-theme` **ou** `.dark` (o cash usa `[data-theme]`, os outros `.dark`) —
  os dois seletores são cobertos em `suprema-tokens.css`. `color-scheme` é setado pra evitar flash
  de tema errado no 1º paint.
- **Os dois sinais são espelhados automaticamente** por `mirrorThemeSignals()` em
  [`suprema-auth.js`](suprema-auth.js) (roda em todo painel): mexeu em `.dark`, o `[data-theme]`
  acompanha e vice-versa. Então CSS local de tema escuro pode usar qualquer um dos dois que funciona
  em todos os painéis — mas prefira o que o painel já escreve. É aditivo (não suja o DOM no claro).
- **Cuidado com contraste** (o cash já quase virou bug): corpo ≥ 4,5:1, texto grande ≥ 3:1,
  placeholder ≥ 4,5:1. Cinza claro "pra elegância" é o maior motivo de texto ilegível — puxe pro ink.
- Anti-flash / auth-guard ficam **inline** no HTML (não extrair).

## 3. Foco de teclado (a11y)

Já existe **um anel compartilhado** em `suprema-tokens.css` (`:where(...):focus-visible`, na cor do
produto). **Não redefina por painel.** Regras:

- `outline:none` **só** em input/select/textarea que reponham o foco com `border-color` +
  `box-shadow` (ver `.fld input:focus` do admin). Nunca em `button`/`a` sem substituto.
- `:focus-visible` (não `:focus`) pra o anel não aparecer no clique de mouse.

## 4. Bans absolutos (valem em todos os painéis)

- **Texto em degradê** (`background-clip:text` sobre gradiente): **proibido** em corpo, labels,
  dados, botões — é decoração sem significado. **Exceção escopada**: 1 palavra em `<em>` de herói
  display ou o sheen do wordmark/nome de perfil (momento de marca). Fora disso, cor sólida + peso.
  (Referência da decisão: o comentário em `eventos.css` que removeu o degradê de texto.)
- **Side-stripe** (`border-left`/`border-right` > 1px como acento em card/callout/alerta/list-item):
  **proibido**. Use borda inteira, fundo tonal, ou ícone/número à frente. **Única exceção**:
  indicador de dado em célula de tabela (ex.: `tr.anomalia td:first-child` no admin).
- Glassmorphism decorativo por padrão; hero-metric template; grids de cards idênticos; eyebrow
  minúsculo em toda seção; texto que estoura o container.

## 5. Layout responsivo

- **Toolbar cheia é a classe de bug nº 1 deste produto.** Nav/topbar com muitos itens `flex:none`
  fica mais larga que a tela; como o `body` tem `overflow-x:hidden`, o excesso é **cortado** (some
  o botão da direita) em vez de rolar. Regras:
  - O container da toolbar precisa de `max-width` que **contenha** o conteúdo intrínseco (o painel
    usa 1720px), OU
  - **descarte progressivo**: esconda os itens do menos essencial pro mais conforme a largura cai
    (relógio → status → links externos → âncoras), mantendo o núcleo operacional (ferramentas +
    ação principal) sempre visível. Ver os `@media` de `.nav-inner` no painel e o colapso
    icon-only da `.tb-right` no admin (`<1660px` vira só ícone, com `title`/`aria-label`).
  - Alternativa boa (cash): `overflow-x:auto` nas abas + `flex-shrink:0` nos controles — as abas
    rolam, os controles ficam.
- Testar a copy do heading em cada breakpoint; se estoura, reduz o clamp ou reescreve.

## 6. Motion

- Lib compartilhada: [`suprema-motion.js`](suprema-motion.js) (glow/reveal/tilt/countUp/aurora…) —
  cheque antes de reimplementar efeito.
- **Nunca animar `backdrop-filter`/`blur`** (re-blur de viewport = FPS no chão; ver o caso
  `sp-covered`). `backdrop-filter` estático é ok.
- `@media (prefers-reduced-motion: reduce)` **não é opcional** — todo painel precisa de um guarda
  (o admin usa um `*{}` global; o painel cobre efeito a efeito).
- Ease-out exponencial (`--sup-ease` / `--sup-ease-expo`). Sem bounce/elastic.
- `html.lite` (scripts/lite.js) corta blur + animação em PC fraco — não quebre o layout sem eles.

## 7. Deploy (crítico)

- **Mudou asset precacheado? BUMPA `SW_VERSION` no [`sw.js`](sw.js)** — senão o Brian vê HTML novo
  com CSS velho e parece quebrado.
- Publicação é do **Brian** (upload web / GitHub Pages), não `git push`. O Claude deixa os fontes
  da raiz + `dist/` prontos.
- Relatórios XLSX: usar `xlsx-js-style` (o build community do SheetJS ignora estilo).
- Repo `prod-sup/painelpoker` é **público** — nunca commitar segredo.

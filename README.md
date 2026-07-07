# Suprema Poker — Painel Operacional

Painel de gerenciamento de torneios em tempo real para operadores do Grupo Suprema.

## URL de produção

**https://[seu-usuario].github.io/suprema-poker**

## Estrutura

```
suprema-poker/
├── index.html            # Painel operacional principal
├── admin.html            # Área administrativa
├── criacao-noturna.html  # Criação de torneios do turno noturno (GU, dia seguinte)
├── bg.mp4          # Vídeo de fundo (não versionado — manter local)
├── .nojekyll       # GitHub Pages serve HTML puro
└── README.md
```

## Deploy (GitHub Pages)

1. Suba os arquivos neste repositório
2. Vá em **Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: **main** / pasta: **/ (root)**
5. Clique **Save**

A URL fica disponível em ~1 minuto.

A cada novo commit o site atualiza automaticamente.

## Firebase

- **Projeto:** `design-1-53c00`
- **Database:** `design-1-53c00-default-rtdb.firebaseio.com`

### Estrutura do banco

```
/painel/{YYYY-MM-DD}/
  sheet/          → planilha Global MTT do dia
  fixed/          → torneios fixados {val, by, at}
  premiacao/      → premiações preenchidas
  ids/            → IDs dos eventos {val, by, at}
  field/          → field (jogadores)
  garantido/      → garantidos sobrescritos
  checklist/      → checklist do turno
  confhoje/       → conferência de hoje
  criacaoNoturna/ → criação noturna GU {sheet, ops, done, ids, presence}

/relatorios/{YYYY-MM-DD}/
  acompanhamento/ → XLSX do dia em base64 (salvo automático)

/presence/        → operadores online
/relatorioTurno/  → relatório de turno
/mesasCash/       → planilha de mesas cash
/users/           → contas de operadores
```

## Observações

- `bg.mp4` não é versionado (arquivo grande). Incluir manualmente se necessário.
- O painel funciona normalmente sem o vídeo de fundo.

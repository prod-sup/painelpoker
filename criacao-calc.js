/* =========================================================================
   CRIACAO-CALC — o núcleo numérico da receita da Criação Noturna, PURO.

   POR QUÊ ESTE ARQUIVO EXISTE
   ---------------------------
   Os números daqui são a RECEITA que o turno da noite usa pra criar o torneio.
   Fee errado = torneio criado com rake errado. Mesmo assim, nada travava esses
   valores — e o mesmo bloco de parsing estava copiado em TRÊS funções
   (calcValueParts, rawToPct, earlyParts), cada uma interpretando o resultado de
   um jeito diferente. Aqui o parsing é UM só, e cada regra de interpretação tem
   nome próprio e teste.

   ATENÇÃO — AMBIGUIDADE CONHECIDA (ver criacao-calc.test.js)
   ----------------------------------------------------------
   Um número >= 1 na planilha é "10 dólares" ou "10 por cento"? O código antigo
   respondia DIFERENTE em cada função:
       rawToPctFee  -> dólar absoluto  (divide pelo buy-in)
       earlyPct     -> percentual      (divide por 100)
   Este módulo PRESERVA os dois comportamentos como estavam, de propósito: mudar
   isso altera dinheiro e precisa de decisão da operação, não de refatoração.
   Os testes deixam a divergência explícita.

   Sem DOM, sem Firebase, sem estado global (CURRENCY/BRL_RATE entram por
   parâmetro). Roda em Node: `node criacao-calc.test.js`.
   ========================================================================= */
(function (root) {
  'use strict';

  /* ── PARSING DO VALOR CRU ──
     A planilha entrega número ("0.1", 10) ou texto ("10%", "R$ 1.234,56").
     Texto com % vira fração na hora ("10%" → 0.10). Este bloco estava copiado
     em três lugares; agora é um só.
     Devolve null quando não dá pra ler um número. */
  function parseRaw(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;
    const s = String(raw);
    let t = s.replace(/[^\d.,-]/g, '');
    /* separador de milhar BR: o código antigo fazia só `.replace(',','.')`, o
       que transformava "1.234,56" em "1.234.56" — e parseFloat corta no segundo
       ponto, devolvendo 1.234. Erro de MIL VEZES num campo de dinheiro.
       Regra (a mesma já validada em painel-calc.toNumber): com ponto E vírgula,
       ponto é milhar e vírgula é decimal; só vírgula, ela é o decimal; só
       ponto, já é decimal padrão. */
    const temVirgula = t.includes(','), temPonto = t.includes('.');
    if (temVirgula && temPonto) t = t.replace(/\./g, '').replace(',', '.');
    else if (temVirgula) t = t.replace(',', '.');
    const n = parseFloat(t);
    if (!isFinite(n)) return null;
    return /%/.test(s) ? n / 100 : n;    // "10%" (texto) → 0.10
  }

  /* ── FEE/ADMIN → fração do buy-in ──
     Regra ATUAL (preservada): valor >= 1 é tratado como DÓLAR ABSOLUTO e
     convertido em % dividindo pelo buy-in.
     ⚠ É aqui que mora a ambiguidade: se a planilha escreve "10" querendo dizer
     10%, isto devolve 10/buyin — que só coincide com 10% quando o buy-in é 100.
     Ver o teste "ambiguidade do >= 1". */
  function rawToPctFee(buyin, raw) {
    const v = parseRaw(raw);
    if (v === null || v <= 0) return 0;
    if (v >= 1) return (buyin && buyin > 0) ? v / buyin : 0;
    return v;
  }

  /* ── EARLY BIRD → fração das fichas ──
     Regra ATUAL (preservada): valor >= 1 é tratado como PERCENTUAL
     ("20" na planilha = 20%), NÃO como absoluto. Note que é o oposto do
     rawToPctFee acima — a divergência é real e está pinada em teste. */
  function earlyPct(raw) {
    const v = parseRaw(raw);
    if (v === null || v <= 0) return 0;
    return v >= 1 ? v / 100 : v;
  }

  /* quantas fichas o early bird representa, dado o stack inicial */
  function earlyChips(rawEarly, rawChips) {
    const pct = earlyPct(rawEarly);
    const chips = parseRaw(rawChips);
    if (!pct || chips === null || !(chips > 0)) return null;
    return Math.round(chips * pct);
  }

  /* ── CONVERSÃO DE MOEDA ──
     A planilha vem em dólar; a operação usa o multiplicador fixo da casa.
     `rate` entra por parâmetro justamente pra este módulo não depender de
     constante global — e pra ficar visível que é um multiplicador acordado,
     não uma cotação ao vivo. */
  function toCurrency(vUsd, currency, rate) {
    if (vUsd === null || vUsd === undefined || !isFinite(vUsd)) return null;
    return currency === 'usd' ? vUsd : vUsd * rate;
  }

  /* quanto uma fração representa em dinheiro sobre o buy-in */
  function moneyOf(buyin, pct) {
    if (buyin === null || buyin === undefined || !isFinite(buyin)) return null;
    if (!isFinite(pct)) return null;
    return Math.round(buyin * pct * 100) / 100;
  }

  /* fração → texto de porcentagem no padrão BR ("0.1" → "10%") */
  function pctText(pct) {
    if (!isFinite(pct)) return '';
    return (Math.round(pct * 10000) / 100).toLocaleString('pt-BR') + '%';
  }

  const api = { parseRaw, rawToPctFee, earlyPct, earlyChips, toCurrency, moneyOf, pctText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CriacaoCalc = api;
})(typeof self !== 'undefined' ? self : this);

/* =========================================================================
   SUPREMA-INSIGHTS — motor de diagnóstico e recomendações do Suprema OS

   POR QUÊ
   -------
   O painel já sabia MUITA coisa (premiação fora do garantido, overlay recorrente
   no histórico, ID duplicado, evento atrasado), mas cada aviso vivia solto: um toast
   que passa em 3s, um badge escondido num tooltip. Quem estava no turno não tinha
   UM lugar pra perguntar "o que está errado agora e o que eu faço?".

   O QUE É
   -------
   Uma função PURA: recebe um retrato do estado e devolve uma lista de ACHADOS.
   Não toca no DOM, não lê variável global, não chama Firebase. Isso é de propósito:
     - dá pra testar cada regra no Node, sem navegador (e as regras mexem com dinheiro);
     - outros painéis (cash, criação GU) podem reusar sem arrastar o painel do dia junto;
     - quando a base sair do Firebase (ver suprema-db.js), nada aqui muda.

   FORMATO DO ACHADO
   -----------------
   { id, cat, sev, titulo, porque, acao, key?, qtd? }
     cat: 'operacional' | 'tecnico' | 'preditivo'
     sev: 'critico'  → está errado AGORA e custa dinheiro/auditoria
          'atencao'  → provavelmente errado, confira
          'info'     → contexto útil, sem ação obrigatória
     porque: por que isso importa (nunca repetir o título)
     acao:   o que fazer, em imperativo. Um achado SEM ação não deveria existir.
     key:    _key do torneio, quando o achado é de um evento específico (a UI leva até ele)
   ========================================================================= */
(function (global) {
  'use strict';

  /* ── helpers ────────────────────────────────────────────────────────── */
  var toMin = function (hhmm) {
    if (!hhmm) return null;
    var m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  /* Relógio operacional: a grade vai de 06:10 até 05:30 do dia seguinte, então
     00:00–05:29 é o FIM do dia, não o começo. Sem isso um torneio da madrugada
     parece "12h atrasado" às 23h. Mesma regra do painel (opMinutes). */
  var opMin = function (min) {
    if (min == null) return null;
    return min < 5 * 60 + 30 ? min + 24 * 60 : min;
  };
  var fmt = function (n) {
    return (n == null ? 0 : n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  };
  var isNF = function (r, ctx) {
    var id = (ctx.idMap && ctx.idMap[r._key]) || '';
    id = (typeof id === 'object' && id) ? (id.val || '') : id;
    return String(id).toUpperCase() === 'NF' || !!r.explicitNF;
  };

  /* ── REGRAS OPERACIONAIS ────────────────────────────────────────────── */

  /* Premiação muito fora do garantido = quase sempre dedo no teclado (um zero a mais
     ou a menos). Mesma faixa que o aviso do card já usava (5x / 0,2x), mas aqui vira
     um achado que FICA na lista até ser resolvido, em vez de um toast que some. */
  function premiacaoForaDaFaixa(ctx) {
    var out = [];
    ctx.rows.forEach(function (r) {
      var gar = ctx.garantidoEfetivo(r);
      if (r.premiacao == null || gar == null || gar <= 0) return;
      var alto = r.premiacao > gar * 5, baixo = r.premiacao < gar * 0.2;
      if (!alto && !baixo) return;
      out.push({
        id: 'prem-faixa:' + r._key, cat: 'operacional', sev: 'atencao', key: r._key,
        titulo: r.nome + ' — premiação ' + (alto ? 'muito acima' : 'muito abaixo') + ' do garantido',
        porque: 'R$ ' + fmt(r.premiacao) + ' contra um garantido de R$ ' + fmt(gar) +
                '. Diferença dessa ordem costuma ser um zero a mais ou a menos, e entra direto no overlay do dia.',
        acao: 'Confira o valor no app da Suprema e corrija se foi erro de digitação.',
      });
    });
    return out;
  }

  /* Evento que já começou há um tempo e segue sem premiação nem NF: o dinheiro do dia
     fica subnotificado e a auditoria do dia fecha torta. */
  function eventoVencidoSemFecho(ctx) {
    var out = [], agora = opMin(ctx.nowMin);
    var atrasados = ctx.rows.filter(function (r) {
      if (r.premiacao != null || isNF(r, ctx)) return false;
      var ev = opMin(toMin(r.hora));
      return ev != null && agora - ev >= 90;
    });
    if (!atrasados.length) return out;
    atrasados.slice(0, 6).forEach(function (r) {
      var atraso = Math.round((agora - opMin(toMin(r.hora))) / 60);
      out.push({
        id: 'sem-fecho:' + r._key, cat: 'operacional', sev: 'critico', key: r._key,
        titulo: r.nome + ' começou há ' + atraso + 'h e continua aberto',
        porque: 'Sem premiação nem NF, ele não entra em "Pago em premiações" nem no overlay — o resultado do dia fica menor do que foi de verdade.',
        acao: 'Preencha a premiação no card, ou marque NF se o torneio não formou.',
      });
    });
    if (atrasados.length > 6) {
      out.push({
        id: 'sem-fecho-resto', cat: 'operacional', sev: 'critico', qtd: atrasados.length - 6,
        titulo: 'mais ' + (atrasados.length - 6) + ' eventos vencidos sem fecho',
        porque: 'O mesmo problema acima, em escala: o fechamento do dia sai errado.',
        acao: 'Vá pela Agenda em ordem de horário e feche os que já rodaram.',
      });
    }
    return out;
  }

  /* ID repetido: a auditoria casa evento por ID. Dois iguais = um evento some do relatório. */
  function idsDuplicados(ctx) {
    var porId = {};
    ctx.rows.forEach(function (r) {
      var raw = ctx.idMap && ctx.idMap[r._key];
      var id = (typeof raw === 'object' && raw) ? (raw.val || '') : (raw || '');
      id = String(id).trim().toUpperCase();
      if (!id || id === 'NF') return;
      (porId[id] = porId[id] || []).push(r);
    });
    return Object.keys(porId).filter(function (id) { return porId[id].length > 1; }).map(function (id) {
      var nomes = porId[id].map(function (r) { return r.nome; }).join(' · ');
      return {
        id: 'id-dup:' + id, cat: 'operacional', sev: 'critico', key: porId[id][0]._key,
        titulo: 'ID ' + id + ' está em ' + porId[id].length + ' torneios',
        porque: 'A auditoria casa cada evento pelo ID. Repetido, um dos torneios não aparece no relatório do dia — e o número fecha errado sem ninguém ver.',
        acao: 'Abra os cards (' + nomes + ') e deixe o ID certo em cada um.',
      };
    });
  }

  /* Fixado sem ID: alguém marcou como conferido mas não registrou qual evento é. */
  function fixadoSemId(ctx) {
    var faltando = ctx.rows.filter(function (r) {
      if (!ctx.estaFixado(r)) return false;
      var raw = ctx.idMap && ctx.idMap[r._key];
      var id = (typeof raw === 'object' && raw) ? (raw.val || '') : (raw || '');
      return !String(id).trim();
    });
    if (!faltando.length) return [];
    return [{
      id: 'fix-sem-id', cat: 'operacional', sev: 'atencao', qtd: faltando.length,
      key: faltando[0]._key,
      titulo: faltando.length + (faltando.length > 1 ? ' torneios fixados estão' : ' torneio fixado está') + ' sem ID',
      porque: 'Fixado diz "eu conferi"; o ID diz "conferi ESTE aqui". Sem ele a auditoria não consegue amarrar o evento.',
      acao: 'Preencha o ID nos cards já fixados — começa por ' + faltando[0].nome + '.',
    }];
  }

  /* Garantido ausente: sem ele não existe overlay, e o torneio vira ponto cego. */
  function semGarantido(ctx) {
    var sem = ctx.rows.filter(function (r) {
      return !isNF(r, ctx) && !r.proxCronograma && ctx.garantidoEfetivo(r) == null;
    });
    if (!sem.length) return [];
    return [{
      id: 'sem-garantido', cat: 'operacional', sev: 'atencao', qtd: sem.length,
      key: sem[0]._key,
      titulo: sem.length + (sem.length > 1 ? ' torneios estão' : ' torneio está') + ' sem garantido',
      porque: 'Overlay é premiação menos garantido. Sem garantido, esses eventos não entram no overlay do dia — o prejuízo real fica escondido.',
      acao: 'Corrija o garantido no card (dá pra sobrescrever sem mexer na planilha).',
    }];
  }

  /* ── REGRAS TÉCNICAS ────────────────────────────────────────────────── */

  function semPlanilha(ctx) {
    if (ctx.rows.length) return [];
    return [{
      id: 'sem-planilha', cat: 'tecnico', sev: 'critico',
      titulo: 'Nenhuma grade carregada',
      porque: 'O painel inteiro (cards, totais, conferência) sai da Global do dia. Sem ela não há o que acompanhar.',
      acao: 'Clique em "Global MTT" no topo e suba a planilha de hoje.',
    }];
  }

  function offline(ctx) {
    if (ctx.conectado !== false) return [];
    return [{
      id: 'offline', cat: 'tecnico', sev: 'atencao',
      titulo: 'Sem conexão com o servidor',
      porque: 'O que você digitar agora fica salvo só neste navegador e seu parceiro não vê. Nada se perde: ao reconectar, sobe sozinho.',
      acao: 'Continue trabalhando normalmente e confira a internet. Não recarregue a página até voltar o "Sincronizado".',
    }];
  }

  function avisosDaPlanilha(ctx) {
    if (!ctx.avisosPlanilha || !ctx.avisosPlanilha.length) return [];
    return [{
      id: 'planilha-avisos', cat: 'tecnico', sev: 'atencao', qtd: ctx.avisosPlanilha.length,
      titulo: 'A Global carregou com ' + ctx.avisosPlanilha.length + ' aviso(s)',
      porque: 'Coluna faltando ou célula vazia na planilha vira número errado aqui — sem barulho. Avisos: ' +
              ctx.avisosPlanilha.slice(0, 3).join(' · ') + (ctx.avisosPlanilha.length > 3 ? ' …' : ''),
      acao: 'Confira a planilha na origem e suba de novo. Até lá, desconfie dos totais.',
    }];
  }

  /* ── REGRAS PREDITIVAS ──────────────────────────────────────────────── */

  /* O histórico já era coletado e mostrado num tooltip que ninguém abre. Aqui ele
     ANTECIPA: o evento ainda não rodou hoje e vem dando overlay — dá pra agir antes. */
  function overlayRecorrente(ctx) {
    var out = [], agora = opMin(ctx.nowMin);
    ctx.rows.forEach(function (r) {
      if (r.premiacao != null || isNF(r, ctx)) return;          // já resolvido hoje
      var ev = opMin(toMin(r.hora));
      if (ev == null || ev < agora) return;                      // já passou: não dá pra prevenir
      var h = (ctx.historico && ctx.historico[r.nome]) || [];
      var last = h.slice(0, 5);
      if (last.length < 3) return;                               // amostra pequena não vira recomendação
      var neg = last.filter(function (x) { return (x.perf == null ? 0 : x.perf) < 0; });
      if (neg.length < 3) return;
      var medio = neg.reduce(function (s, x) { return s + (x.perf || 0); }, 0) / neg.length;
      out.push({
        id: 'ov-recorrente:' + r._key, cat: 'preditivo', sev: 'atencao', key: r._key,
        titulo: r.nome + ' deu overlay em ' + neg.length + ' das últimas ' + last.length + ' vezes',
        porque: 'Média de ' + medio.toFixed(1) + '% abaixo do garantido nessas rodadas. Ele está marcado pra hoje às ' +
                (r.hora || '--:--') + ' com R$ ' + fmt(ctx.garantidoEfetivo(r)) + ' garantidos — o padrão tende a repetir.',
        acao: 'Ainda dá tempo: avalie revisar o garantido ou reforçar a divulgação antes do late.',
      });
    });
    return out.sort(function (a, b) { return (b.qtd || 0) - (a.qtd || 0); }).slice(0, 5);
  }

  /* Garantido de hoje bem acima da média histórica do próprio evento = risco de overlay
     que ninguém pediu. Só avisa antes do evento rodar. */
  function garantidoAcimaDoHistorico(ctx) {
    var out = [], agora = opMin(ctx.nowMin);
    ctx.rows.forEach(function (r) {
      if (r.premiacao != null || isNF(r, ctx)) return;
      var ev = opMin(toMin(r.hora));
      if (ev == null || ev < agora) return;
      var gar = ctx.garantidoEfetivo(r);
      if (gar == null || gar <= 0) return;
      var h = ((ctx.historico && ctx.historico[r.nome]) || []).slice(0, 5)
              .filter(function (x) { return x.garantido > 0; });
      if (h.length < 3) return;
      var media = h.reduce(function (s, x) { return s + x.garantido; }, 0) / h.length;
      if (gar < media * 1.5) return;
      out.push({
        id: 'gar-acima:' + r._key, cat: 'preditivo', sev: 'info', key: r._key,
        titulo: r.nome + ' está com garantido ' + Math.round((gar / media - 1) * 100) + '% acima do normal',
        porque: 'Hoje R$ ' + fmt(gar) + ' contra uma média de R$ ' + fmt(media) + ' nas últimas ' + h.length +
                ' rodadas. Se o field vier igual ao de sempre, a diferença vira overlay.',
        acao: 'Confirme se o aumento foi proposital (campanha/evento especial). Se não, revise antes de abrir.',
      });
    });
    return out.slice(0, 5);
  }

  /* ── MOTOR ──────────────────────────────────────────────────────────── */
  var REGRAS = [
    semPlanilha, offline, avisosDaPlanilha,
    premiacaoForaDaFaixa, eventoVencidoSemFecho, idsDuplicados, fixadoSemId, semGarantido,
    overlayRecorrente, garantidoAcimaDoHistorico,
  ];

  var ORDEM_SEV = { critico: 0, atencao: 1, info: 2 };

  /* ctx = {
       rows, historico, idMap, avisosPlanilha, conectado, nowMin,
       garantidoEfetivo(row) -> number|null,   // respeita override manual
       estaFixado(row) -> bool
     }
     Uma regra que estoura NÃO pode derrubar o diagnóstico inteiro — o painel é
     ferramenta de turno, não pode sumir porque uma análise deu ruim. */
  function analisar(ctx) {
    ctx = ctx || {};
    ctx.rows = ctx.rows || [];
    ctx.garantidoEfetivo = ctx.garantidoEfetivo || function (r) { return r.garantido; };
    ctx.estaFixado = ctx.estaFixado || function () { return false; };
    ctx.nowMin = ctx.nowMin != null ? ctx.nowMin : 0;

    var achados = [];
    REGRAS.forEach(function (regra) {
      try { achados = achados.concat(regra(ctx) || []); }
      catch (e) { if (global.console) console.warn('[insights] regra falhou:', regra.name, e); }
    });
    return achados.sort(function (a, b) {
      var d = ORDEM_SEV[a.sev] - ORDEM_SEV[b.sev];
      return d !== 0 ? d : String(a.titulo).localeCompare(String(b.titulo));
    });
  }

  function resumo(achados) {
    return {
      total: achados.length,
      critico: achados.filter(function (a) { return a.sev === 'critico'; }).length,
      atencao: achados.filter(function (a) { return a.sev === 'atencao'; }).length,
      info: achados.filter(function (a) { return a.sev === 'info'; }).length,
    };
  }

  global.SupremaInsights = { analisar: analisar, resumo: resumo, _regras: REGRAS };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SupremaInsights;

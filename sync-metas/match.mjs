/* =========================================================================
   PokerByte — casamento de torneio por NOME + HORÁRIO

   O painel conhece o torneio pela Global MTT; o PokerByte lista os dele. Não há
   ID em comum, então o par é achado por semelhança de nome dentro de uma janela
   de horário.

   REGRA DE OURO: na dúvida, NÃO casa.
   Mandar a meta do clube errado no grupo é pior que não mandar. Por isso, além
   de um piso de semelhança, exigimos MARGEM sobre o segundo colocado: dois
   candidatos parecidos (o típico "Turbo" vs "Hyper" no mesmo horário) devolvem
   `ok:false` com a lista, pra decisão humana — nunca um chute silencioso.
   ========================================================================= */

/* ---------- normalização ---------- */

/* horários costumam vir grudados no nome ("40K OmaX HR 20h", "#AS 25K WarmUp
   14:00"). Tiramos do nome pra não poluir a comparação — e ainda aproveitamos
   como pista extra de horário. */
/* Só casa no FIM do nome e só com marca explícita de hora (`:` ou `h`).
   Antes o padrão aceitava um traço à frente e engolia o "47" de
   "SPS 47-H Mystery HR" achando que era "47h" — apagando justamente o token que
   diferencia esse torneio do "SPS 48-H". Sem a marca explícita, um nome que
   termina em número ("Battle 3") também viraria 03:00. */
const RE_HORA_NO_NOME = /\b(\d{1,2})(?::(\d{2})\s*h?|\s*h)(?=\s*$)/i;

export function extrairHoraDoNome(nome){
  const m = String(nome || '').match(RE_HORA_NO_NOME);
  if(!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if(h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function normalizarNome(nome){
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')    // tira acento (combining marks)
    .toLowerCase()
    .replace(RE_HORA_NO_NOME, ' ')                       // tira horário do fim
    .replace(/[#*]/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2')                      // 1,5k -> 1.5k
    .replace(/(\d+)\s*-\s*h\b/g, '$1h')                  // 47-h -> 47h
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(nome){
  return normalizarNome(nome).split(' ').filter(Boolean);
}

/* ---------- semelhança ---------- */

/* Token que funciona como IDENTIDADE do evento: o "102" de "SPS 102-M WarmUp", o
   "47h" de "SPS 47-H Mystery HR". Dois nomes que só divergem nesse número são
   torneios DIFERENTES, por mais parecidos que o Dice ache que são.

   O SUFIXO "K" É DINHEIRO, NÃO IDENTIDADE.
   A planilha escreve o garantido dentro do nome e o PokerByte não:
       painel:    "SPS 102-M 40K WarmUp"
       pokerbyte: "SPS 102-M WarmUp"
   Tratar "40k" como identidade fazia esse par legítimo ser recusado (0.36). O
   número do evento vem cru (102) ou com marca de nível (47h, 139l); valor vem com
   K. Excluir os "K" mantém a proteção do 47-H x 48-H e libera o caso real. */
const RE_TOKEN_NUMERICO = /^\d+(?:\.\d+)?[a-z]?$/;
const RE_DINHEIRO = /^\d+(?:\.\d+)?k$/;

export function tokensNumericos(nome){
  return new Set(tokens(nome).filter(t => RE_TOKEN_NUMERICO.test(t) && !RE_DINHEIRO.test(t)));
}

function mesmosNumeros(a, b){
  const na = tokensNumericos(a), nb = tokensNumericos(b);
  if(!na.size || !nb.size) return true;           // um dos lados não numera: Dice decide sozinho
  if(na.size !== nb.size) return false;
  for(const t of na) if(!nb.has(t)) return false;
  return true;
}

/* Dice sobre conjuntos de tokens: robusto a ordem e a palavra a mais/a menos,
   que é exatamente como esses nomes variam. */
export function semelhanca(a, b){
  const na = normalizarNome(a), nb = normalizarNome(b);
  if(!na || !nb) return 0;
  if(na === nb) return 1;

  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  if(!ta.size || !tb.size) return 0;
  let comuns = 0;
  ta.forEach(t => { if(tb.has(t)) comuns++; });
  const dice = (2 * comuns) / (ta.size + tb.size);

  /* prefixo longo em comum ajuda em nomes truncados de um lado
     ("SPS 47-H Mystery" vs "SPS 47-H Mystery HR") */
  let p = 0;
  while(p < na.length && p < nb.length && na[p] === nb[p]) p++;
  const prefixo = p / Math.max(na.length, nb.length);

  const bruto = Math.min(1, dice * 0.8 + prefixo * 0.2);

  /* "SPS 47-H Mystery HR" x "SPS 48-H Mystery HR" dá Dice 0.75 — passaria pelo
     limiar e casaria o torneio errado se o certo não estivesse na lista (nome
     digitado diferente na planilha, evento ainda não publicado…). Números
     diferentes derrubam o score pra baixo do piso: é melhor não casar. */
  return mesmosNumeros(a, b) ? bruto : bruto * 0.45;
}

/* ---------- horário ---------- */

export function paraMinutos(hhmm){
  if(typeof hhmm === 'number') return hhmm;
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if(!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if(h > 23 || min > 59) return null;
  return h * 60 + min;
}

/* distância circular em minutos: 23:55 e 00:05 estão a 10 min, não a 1430.
   Sem isso, todo torneio que cruza a meia-noite ficaria fora da janela. */
export function distanciaMinutos(a, b){
  const ma = paraMinutos(a), mb = paraMinutos(b);
  if(ma === null || mb === null) return null;
  const d = Math.abs(ma - mb);
  return Math.min(d, 1440 - d);
}

/* ---------- casamento ---------- */

export const PADROES = {
  toleranciaMin: 10,   // janela de horário aceita
  limiar:        0.55, // semelhança mínima do 1º colocado
  margem:        0.15, // vantagem mínima sobre o 2º colocado
};

/**
 * @param {{nome:string, hora:string}} alvo        torneio do painel
 * @param {Array<{nome:string, hora:string}>} candidatos  listagem do PokerByte
 * @returns {{ok:boolean, escolhido?:object, score?:number, motivo?:string, ranking:Array}}
 */
export function casarTorneio(alvo, candidatos, opcoes = {}){
  const { toleranciaMin, limiar, margem } = { ...PADROES, ...opcoes };
  const lista = Array.isArray(candidatos) ? candidatos : [];

  const horaAlvo = paraMinutos(alvo && alvo.hora) ?? extrairHoraDoNome(alvo && alvo.nome);

  const ranking = lista.map(c => {
    const horaC = paraMinutos(c.hora) ?? extrairHoraDoNome(c.nome);
    const dist = (horaAlvo === null || horaC === null) ? null : distanciaMinutos(horaAlvo, horaC);
    return { candidato: c, score: semelhanca(alvo && alvo.nome, c.nome), distancia: dist };
  }).sort((a, b) => b.score - a.score);

  if(!ranking.length) return { ok:false, motivo:'listagem vazia', ranking };

  /* o horário é PORTEIRO, não pontuação: quem está fora da janela sai da disputa,
     mesmo com nome idêntico (é o caso clássico do mesmo torneio em outro dia/edição) */
  const naJanela = ranking.filter(r => r.distancia !== null && r.distancia <= toleranciaMin);
  if(!naJanela.length){
    return { ok:false, motivo:`nenhum candidato dentro de ${toleranciaMin}min de ${alvo && alvo.hora}`, ranking };
  }

  const [primeiro, segundo] = naJanela;
  if(primeiro.score < limiar){
    return { ok:false, motivo:`melhor semelhança ${primeiro.score.toFixed(2)} abaixo do limiar ${limiar}`, ranking: naJanela };
  }
  if(segundo && (primeiro.score - segundo.score) < margem){
    return {
      ok:false,
      motivo:`ambíguo: "${primeiro.candidato.nome}" (${primeiro.score.toFixed(2)}) x "${segundo.candidato.nome}" (${segundo.score.toFixed(2)})`,
      ranking: naJanela,
    };
  }

  return { ok:true, escolhido: primeiro.candidato, score: primeiro.score, distancia: primeiro.distancia, ranking: naJanela };
}

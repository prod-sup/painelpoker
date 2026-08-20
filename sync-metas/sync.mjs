/* =========================================================================
   PokerByte → Firebase — o serviço de sync.

   Ciclo:
     1. lê a grade do dia no RTDB (painel/<dia>/sheet)
     2. lista os Main Events na /metas do PokerByte
     3. casa os dois por nome + horário (match.mjs — na dúvida, não casa)
     4. abre o modal de cada casado, tira o print recortado e lê os números
     5. grava em painel/<dia>/metasDados/<rowKey>, SOBRESCREVENDO
     6. apaga o que não está mais na janela e publica a saúde em metasStatus

   SEM HISTÓRICO, POR DECISÃO
   --------------------------
   O print não vai pro Storage. Vive como base64 no próprio nó, é substituído a
   cada ciclo e removido quando o torneio sai da janela. Sem arquivo acumulando,
   sem link público com token de download (que seria legível por qualquer um com
   a URL, contornando as regras) e sem CORS pra manter.

       node _pokerbyte/sync.mjs          # um ciclo e sai
       WATCH=1 node _pokerbyte/sync.mjs  # serviço: laço + obedece o botão do painel
       DRY=1 node _pokerbyte/sync.mjs    # não escreve no Firebase

   MODO SERVIÇO
   ------------
   Em WATCH=1 roda a cada INTERVALO_MIN e também sempre que alguém clica
   "Atualizar agora" na seção Metas (o painel escreve em metasComando). O operador
   nunca abre terminal: a ferramenta que ele opera é o painel; isto aqui é só o
   braço que alcança o PokerByte, porque o navegador não pode (same-origin).
   ========================================================================= */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { abrirNavegador, METAS_URL, RAIZ, temSessao, sessaoRealmenteViva } from './_browser.mjs';
import { casarTorneio } from './match.mjs';
import { rtdbGet, rtdbPut, rtdbDelete, temCredenciais, contaEmail } from './firebase.mjs';
import { tentarLideranca, largarLideranca, EU } from './lideranca.mjs';

/* A MESMA regra de classificação do painel, não uma cópia.
   Sem isso o sync tentava casar side events e satélites das 12h com a listagem de
   Main Events — 14 candidatos, zero pares. painel-calc.js já exporta pra Node
   (é o que o painel-calc.test.js consome). */
const PainelCalc = (() => {
  const req = createRequire(import.meta.url);
  /* dois lugares possíveis: rodando dentro do repo (../) ou no pacote exportado
     para a máquina de outro operador, onde o arquivo viaja junto (./). Sem o
     fallback, o pacote quebrava na outra máquina com "cannot find module". */
  for (const p of [join(RAIZ, '..', 'painel-calc.js'), join(RAIZ, 'painel-calc.js')]){
    try { return req(p); } catch {}
  }
  throw new Error('painel-calc.js não encontrado (nem no repo, nem no pacote)');
})();

const DRY = !!process.env.DRY;
const WATCH = !!process.env.WATCH;
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN || 10);
const log = (...a) => console.log('[sync]', new Date().toLocaleTimeString('pt-BR'), ...a);

/* A altura da viewport define o print, por dois motivos:
   1) o modal mede sempre `viewport + 2px` — ou seja, SEMPRE excede a viewport.
      Um element.screenshot() faria o Playwright rolar a página pra enquadrar, o
      fundo (position:fixed) se moveria e o print sairia com os cards. Por isso
      capturamos por CLIP de coordenada, sem rolagem.
   2) as linhas da tabela ESTICAM pra preencher a altura disponível: a 1500 elas
      ficam ~30% mais altas que o natural (~1067px pras 20 linhas). 1200 é o ponto
      em que nada rola e nada incha. */
const VIEWPORT = { width: 1900, height: 1200 };

/* ---------- dia operacional (mesma régua do painel) ---------- */
/* a grade vai de 06:10 a 05:30, então 00:00–05:29 ainda pertence ao dia anterior */
function diaOperacional(){
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (sp.getHours() * 60 + sp.getMinutes() <= 330) sp.setDate(sp.getDate() - 1);
  const p = n => String(n).padStart(2, '0');
  return `${sp.getFullYear()}-${p(sp.getMonth() + 1)}-${p(sp.getDate())}`;
}

/* ---------- rowKey: réplica exata de painel.js:526 ----------
   Precisa bater byte a byte, senão o painel não acha o dado pela própria chave. */
function rowKey(row){
  const s = `${row.nome}|${row.hora}|${row.buyin}|${row.garantido}`;
  let h = 0;
  for (let i = 0; i < s.length; i++){ h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'rk_' + Math.abs(h) + (row.proxCronograma ? '_px' : '');
}

/* ---------- números em pt-BR ---------- */
function brl(txt){
  if (txt == null) return null;
  const m = String(txt).replace(/\s/g, '').match(/-?R?\$?\s*(-?[\d.]+,\d{2}|-?[\d.]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return /-/.test(String(txt)) ? -Math.abs(n) : n;
}

/* ---------- só captura o que está na janela de meta ----------
   O print pesa ~200KB em base64. Capturar os 10 Main Events do dia jogaria ~2MB
   no nó — e o painel BAIXA esse nó inteiro no listener, em toda aba aberta, o dia
   todo. Capturando só a janela (normalmente 1 a 3 torneios) fica em centenas de KB.
   LEAD_MIN dá uma dianteira pro print já estar pronto quando o card nascer. */
const LEAD_MIN = 30;
const TENTATIVAS = 3;   // card sem print e a falha que nao pode acontecer

function minutosSP(){
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return sp.getHours() * 60 + sp.getMinutes();
}
/* mesma régua de madrugada do painel: <= 05:30 pertence ao fim do dia (+24h) */
const op = m => (m != null && m <= 330) ? m + 1440 : m;
const paraMin = s => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };

function naJanela(row){
  const ini = paraMin(row.hora), late = paraMin(row.late);
  if (ini == null || late == null) return false;   // sem late não dá pra afirmar nada
  const agora = op(minutosSP());
  return agora >= op(ini) - LEAD_MIN && agora <= op(late);
}

const dia = diaOperacional();

/* O painel lê isto pra dizer "atualizado há X min" ou gritar que a sessão caiu.
   Sem status publicado, um serviço morto passaria por dado fresco. */
async function reportar(patch){
  if (DRY) return;
  try { await rtdbPut(`painel/${dia}/metasStatus`, { em: Date.now(), maquina: EU.host, por: contaEmail(), ...patch }); }
  catch(e){ log('não consegui publicar status:', e.message); }
}

const CAMINHO_LIDER = `painel/${dia}/metasLider`;

/* Sessao viva? Cookie presente NAO basta — cookie vencido continua no perfil, e
   com isso esta maquina reivindicava a lideranca como "sessaoOk", impedindo outra
   COM sessao de verdade de assumir. Resultado: painel cego a noite toda.
   A confirmacao real custa uma requisicao, entao vale por 60s. */
let _sessaoOk = null, _sessaoEm = 0;
async function checarSessao(ctx){
  if (_sessaoOk !== null && Date.now() - _sessaoEm < 60000) return _sessaoOk;
  _sessaoOk = (await temSessao(ctx)) ? await sessaoRealmenteViva(ctx, METAS_URL) : false;
  _sessaoEm = Date.now();
  return _sessaoOk;
}
function marcarSessaoMorta(){ _sessaoOk = false; _sessaoEm = Date.now(); }

/* Carrega a listagem e CARIMBA cada card com seu índice.
   O carimbo existe porque a contagem daqui exclui os cards de dentro do modal de
   filtro, e um nth() lá fora contaria todos — os índices desalinhavam. */
async function carregarListagem(page){
  await page.goto(METAS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  /* ESPERA OS CARDS EXISTIREM, não um tempo fixo.
     Com `waitForTimeout(2000)` a listagem às vezes voltava vazia — a página tinha
     carregado o HTML mas ainda não montado os cards — e o torneio parecia ter
     "sumido da listagem". A repetição salvava, mas gastava dois ciclos e escondia
     a causa. Se a página não é de login, os cards VÃO aparecer: esperar por eles
     é determinístico; esperar 2s é chute. */
  if (!/\/login/i.test(page.url())){
    await page.waitForSelector('div.card.main', { state: 'attached', timeout: 30000 }).catch(() => {});
    /* a contagem estabilizar significa que o render terminou */
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('div.card.main').length;
      const antes = window.__syncN;
      window.__syncN = n;
      return n > 0 && n === antes;
    }, null, { timeout: 15000, polling: 500 }).catch(() => {});
  }

  return page.evaluate(() => {
    const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('div.card.main')]
      .filter(c => !c.closest('.edit-filter-modal'))
      .map((c, indice) => {
        c.setAttribute('data-sync-idx', String(indice));
        const t = txt(c);
        return {
          indice,
          nome:  (t.match(/MAIN EVENT\s+(.+?)\s+Suprema/i) || [])[1] || null,
          hora:  (t.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || null,
          status:(c.className.match(/\b(inicio|andamento|finalizado)\b/) || [])[1] || null,
        };
      })
      .filter(x => x.nome);
  });
}

/* Abre o modal de um torneio RECARREGANDO a página antes.
   Parece desperdício, mas não é: o Escape NÃO fecha o modal deste app. Medido —
   depois dele o body continua com `modal-open`, overflow:hidden e o backdrop no
   lugar. Resultado: a página não rola, o backdrop engole o clique e o segundo
   torneio do dia nunca era capturado (sumia do painel em silêncio). Os cards
   ficam a até 3.400px de altura, então rolar é obrigatório. Recarregar custa ~5s
   e elimina a classe inteira de bugs de estado preso. */
async function abrirCard(page, nomeEsperado){
  /* Procura pelo NOME, não por índice guardado.
     A listagem é reordenada quando um torneio muda de status (aguardando →
     andamento → finalizado). Como recarregamos a página antes de cada clique, um
     índice colhido antes podia apontar pra OUTRO evento — e aí publicaríamos o
     print do torneio errado no grupo, que é pior que não publicar nada. */
  const lista = await carregarListagem(page);
  const achado = lista.find(c => c.nome === nomeEsperado);
  if (!achado) throw new Error(`"${nomeEsperado}" sumiu da listagem`);

  const alvo = page.locator(`div.card.main[data-sync-idx="${achado.indice}"]`);
  await alvo.scrollIntoViewIfNeeded({ timeout: 10000 });
  await alvo.click({ timeout: 15000 });
  await page.waitForSelector('div.modal-content:has(table#details)', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1800);

  /* CONFERE que o modal aberto é mesmo o torneio pedido. Cinto de segurança: se
     qualquer suposição acima falhar, a captura é descartada em vez de virar um
     print errado com o nome certo na legenda. */
  const aberto = await page.evaluate(() => {
    const m = [...document.querySelectorAll('div.modal-content')].find(x => x.querySelector('table#details'));
    const i = m && m.querySelector('input[name="torneio"], #torneio');
    return i ? i.value : null;
  });
  if (!aberto || aberto.trim() !== nomeEsperado.trim()){
    throw new Error(`abriu "${aberto}" em vez de "${nomeEsperado}"`);
  }
  return achado;
}

/* ========================================================================= */

async function umCiclo(page){
  /* 1. grade do painel */
  const sheet = await rtdbGet(`painel/${dia}/sheet`).catch(() => null);
  const linhasPainel = (sheet && Array.isArray(sheet.rows) ? sheet.rows : []).filter(r => r && r.nome);
  log(`grade: ${linhasPainel.length} torneios`);

  /* 2. listagem do PokerByte */
  const mains = await carregarListagem(page);

  if (/\/login/i.test(page.url())){
    log('✗ sessao expirada');
    marcarSessaoMorta();   // derruba o cache: cedo a lideranca a quem tiver sessao
    await reportar({ ok: false, sessao: 'expirada', erro: null, torneios: 0 });
    return { sessao: 'expirada' };
  }
  log(`Main Events no PokerByte: ${mains.length}`);

  /* 3+4. casar e capturar */
  const escritos = new Set();
  const naoCasados = [];
  const semPrint = [];   // casou mas nao capturou: o painel PRECISA gritar isso

  const candidatos = linhasPainel.filter(r => PainelCalc.classify(r) === 'main' && naJanela(r));
  log(`Main Events na janela de meta agora: ${candidatos.length}`);

  for (const alvo of candidatos){
    const r = casarTorneio({ nome: alvo.nome, hora: alvo.hora }, mains);
    if (!r.ok){
      // só registra o que faria sentido casar (Main Event costuma bater de longe)
      if (r.ranking && r.ranking.length) naoCasados.push({ nome: alvo.nome, hora: alvo.hora, motivo: r.motivo });
      continue;
    }

    const pb = r.escolhido;
    const chave = rowKey(alvo);
    log(`  ${alvo.nome} (${alvo.hora}) → ${pb.nome} [${pb.status}] score ${r.score.toFixed(2)}`);

    /* TENTA MAIS DE UMA VEZ. "Card sem print" é a falha que não pode acontecer:
       o operador abriria o painel, não veria imagem e teria que descobrir sozinho
       que precisa tirar o print à mão. Como abrirCard() recarrega a página, cada
       tentativa parte de estado limpo — repetir é barato e cura falha passageira
       (rede lenta, render atrasado). */
    let tentativa = 0;
    while (tentativa < TENTATIVAS) {
    tentativa++;
    try {
      await abrirCard(page, pb.nome);

      const caixa = await page.evaluate(() => {
        const m = [...document.querySelectorAll('div.modal-content')].find(x => x.querySelector('table#details'));
        const b = m.getBoundingClientRect();
        return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)),
                 width: Math.round(b.width), height: Math.round(b.height) };
      });
      caixa.width  = Math.min(caixa.width,  VIEWPORT.width  - caixa.x);
      caixa.height = Math.min(caixa.height, VIEWPORT.height - caixa.y);
      const png = await page.screenshot({ clip: caixa });

      const dados = await page.evaluate(() => {
        const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
        const m = [...document.querySelectorAll('div.modal-content')].find(x => x.querySelector('table#details'));
        if (!m) return null;
        const val = nome => { const i = m.querySelector(`input[name="${nome}"], #${nome}`); return i ? i.value : null; };
        const bruto = txt(m);
        return {
          inicio:    val('dataStart'),
          late:      val('dataLate'),
          buyin:     val('buyin'),
          garantido: val('acoes-necessarias'),
          overlay:   val('acoes-faltantes'),
          atualizadoEm: val('data_importacao'),
          arrecadado: (bruto.match(/Arrecadado p\/ GTD:\s*(R\$\s*[\d.,]+)/i) || [])[1] || null,
          afiliados: m.querySelectorAll('table#details tbody tr').length,
        };
      });

      const garantido  = brl(dados && dados.garantido);
      const arrecadado = brl(dados && dados.arrecadado);

      const no = {
        pokerbyte:    pb.nome,
        status:       pb.status,
        inicio:       (dados && dados.inicio) || null,
        late:         (dados && dados.late) || null,
        buyin:        brl(dados && dados.buyin),
        garantido,
        arrecadado,
        overlay:      brl(dados && dados.overlay),
        atualizadoEm: (dados && dados.atualizadoEm) || null,
        afiliados:    (dados && dados.afiliados) || 0,
        // é isto que destrava a legenda "META ALCANÇADA" sem ninguém digitar
        metaAlcancada: (garantido != null && arrecadado != null) ? arrecadado >= garantido : null,
        print:        'data:image/png;base64,' + png.toString('base64'),
        printBytes:   png.length,
        sincronizadoEm: Date.now(),
        casadoPor:    { score: Number(r.score.toFixed(3)), distanciaMin: r.distancia },
      };

      log(`     arrecadado ${no.arrecadado} / GTD ${no.garantido} → meta ${no.metaAlcancada ? 'ALCANÇADA' : 'não'} · ${(png.length / 1024).toFixed(0)}KB`);
      if (!DRY) await rtdbPut(`painel/${dia}/metasDados/${chave}`, no);
      escritos.add(chave);

      /* não fecha o modal: o próximo abrirCard() recarrega a página, o que é a
         única forma confiável de zerar o estado (ver comentário em abrirCard) */
      break;   // deu certo, não tenta de novo
    } catch(e){
      const ultima = tentativa >= TENTATIVAS;
      log(`     ${ultima ? '✗' : '↻'} tentativa ${tentativa}/${TENTATIVAS}: ${e.message.slice(0, 70)}`);
      if (ultima) semPrint.push(`${alvo.nome} (${alvo.hora})`);
    }
    }
  }

  /* 5. limpar o que saiu da janela — é o que impede o nó de crescer */
  if (!DRY){
    const atual = await rtdbGet(`painel/${dia}/metasDados`).catch(() => null);
    for (const chave of Object.keys(atual || {})){
      if (!escritos.has(chave)){
        await rtdbDelete(`painel/${dia}/metasDados/${chave}`).catch(() => {});
        log(`  limpo: ${chave}`);
      }
    }
  }

  log(`${escritos.size} sincronizados${naoCasados.length ? `, ${naoCasados.length} sem par` : ''}${DRY ? ' (DRY)' : ''}`);
  naoCasados.slice(0, 5).forEach(n => log(`  sem par: ${n.hora} ${n.nome} — ${n.motivo}`));
  if (semPrint.length) log(`  ⚠ SEM PRINT apos ${TENTATIVAS} tentativas: ${semPrint.join(', ')}`);

  await reportar({ ok: true, sessao: 'ok', erro: null, torneios: escritos.size,
    semPar: naoCasados.length, semPrint: semPrint.length, semPrintNomes: semPrint.slice(0, 3) });
  return { ok: true, torneios: escritos.size };
}

/* ========================================================================= */

if (!DRY && !temCredenciais()){
  console.error('Faltam FB_EMAIL/FB_SENHA no .env da pasta de estado — ou rode com DRY=1.');
  process.exit(1);
}

log(`dia operacional: ${dia}${WATCH ? ` · serviço a cada ${INTERVALO_MIN}min` : ''}`);

const ctx = await abrirNavegador({ headless: true });
const page = await ctx.newPage();
await page.setViewportSize(VIEWPORT);

async function cicloProtegido(){
  try { return await umCiclo(page); }
  catch(e){
    log('✗ ciclo falhou:', e.message);
    await reportar({ ok: false, erro: e.message.slice(0, 140), sessao: 'ok' });
    return { ok: false };
  }
}

if (!WATCH){
  await cicloProtegido();
  await ctx.close();
} else {
  /* Laço do serviço. O "comando" vem do botão Atualizar agora, no painel: o
     operador não sabe (nem precisa saber) que existe um processo aqui.

     Antes de qualquer coisa, a máquina disputa a LIDERANÇA. Cada operador roda
     este serviço no próprio computador, com a própria conta do PokerByte — mas
     só o líder toca no site. Os demais ficam em silêncio, prontos pra assumir. */
  log(`máquina ${EU.host} (${EU.id})`);

  let ultimoComando = 0, eraLider = null, proximo = 0;

  const parar = async () => {
    log('encerrando…');
    await largarLideranca(CAMINHO_LIDER).catch(() => {});   // não deixa a trava presa
    await ctx.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);

  for(;;){
    const sessaoOk = await checarSessao(ctx);
    const eleicao = await tentarLideranca(CAMINHO_LIDER, sessaoOk);

    if (eleicao.lider !== eraLider){
      eraLider = eleicao.lider;
      log(eleicao.lider
        ? `sou o líder (${eleicao.motivo})${sessaoOk ? '' : ' — MAS minha sessão caiu'}`
        : `em espera: ${eleicao.motivo}`);
      if (eleicao.lider) proximo = 0;   // assumiu: sincroniza já
    }

    if (!eleicao.lider){
      await new Promise(r => setTimeout(r, 20000));   // parado, sem pesar no PokerByte
      continue;
    }

    if (!sessaoOk){
      // sou líder mas não enxergo o PokerByte: aviso o painel e cedo a vez a quem
      // tiver sessão (a própria trava marca sessaoOk:false pra isso)
      await reportar({ ok: false, sessao: 'expirada', erro: null, torneios: 0 });
      await new Promise(r => setTimeout(r, 20000));
      continue;
    }

    const cmd = await rtdbGet(`painel/${dia}/metasComando`).catch(() => null);
    const pedido = cmd && cmd.em ? cmd.em : 0;
    const pediram = pedido > ultimoComando;
    if (pediram){ ultimoComando = pedido; log(`pedido manual de ${cmd.por || 'alguém'}`); }

    if (pediram || Date.now() >= proximo){
      await cicloProtegido();
      proximo = Date.now() + INTERVALO_MIN * 60000;
    }

    await new Promise(r => setTimeout(r, 5000));
  }
}

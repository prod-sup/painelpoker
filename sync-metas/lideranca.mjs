/* =========================================================================
   LIDERANÇA — só UMA máquina sincroniza por vez.

   O PROBLEMA
   ----------
   Cada operador tem a própria conta do PokerByte e roda o serviço na própria
   máquina. Sem coordenação, cinco máquinas abririam o PokerByte a cada 10 min,
   escreveriam o mesmo dado por cima uma da outra e multiplicariam por cinco o
   acesso a um site que já mostra (pelo reCAPTCHA) não gostar de automação.

   A SOLUÇÃO
   ---------
   Uma trava de tempo no Firebase. Quem a segura, sincroniza; os outros ficam
   parados, sem tocar no PokerByte. A trava expira sozinha em TTL — então se a
   máquina do líder desligar, outra assume no ciclo seguinte, sem ninguém mexer.

   A disputa é resolvida por compare-and-set (ETag), não por "li e escrevi": duas
   máquinas tentando ao mesmo tempo, uma recebe 412 e desiste.

   CEDER A VEZ
   -----------
   Um líder cuja sessão do PokerByte expirou é pior que nenhum líder: ele segura
   a trava e não produz nada. Por isso ele se declara `sessaoOk:false`, e qualquer
   máquina COM sessão válida pode tomar a liderança na hora, sem esperar o TTL.
   Na prática, se um operador do turno tiver sessão viva, o painel nem percebe que
   a de outro caiu.
   ========================================================================= */
import { hostname } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ESTADO_DIR } from './_browser.mjs';
import { rtdbGetComEtag, rtdbPutSeIgual } from './firebase.mjs';

export const TTL_MS = 3 * 60 * 1000;   // sem renovar nisso, a trava é de quem quiser

/* identidade estável da máquina — sobrevive a reinício, some se apagarem a pasta */
const ARQ_ID = join(ESTADO_DIR, 'maquina.id');
function meuId(){
  try {
    if (existsSync(ARQ_ID)) {
      const v = readFileSync(ARQ_ID, 'utf8').trim();
      if (v) return v;
    }
  } catch {}
  const novo = randomUUID().slice(0, 8);
  try { writeFileSync(ARQ_ID, novo, 'utf8'); } catch {}
  return novo;
}

export const EU = { id: meuId(), host: hostname() };

/**
 * Tenta virar (ou seguir sendo) o líder.
 * @param {string} caminho  nó da trava, ex. painel/2026-08-20/metasLider
 * @param {boolean} sessaoOk  minha sessão do PokerByte está viva?
 * @returns {Promise<{lider:boolean, dono:object|null, motivo:string}>}
 */
export async function tentarLideranca(caminho, sessaoOk){
  let atual;
  try { atual = await rtdbGetComEtag(caminho); }
  catch(e){ return { lider:false, dono:null, motivo:'não li a trava: ' + e.message }; }

  const dono = atual.valor;
  const agora = Date.now();
  const meu = dono && dono.id === EU.id;
  const expirou = !dono || !dono.em || (agora - dono.em) > TTL_MS;
  /* líder sem sessão não serve pra nada: quem tem sessão pode tomar na hora */
  const donoInutil = !!dono && dono.sessaoOk === false && sessaoOk;

  if (!meu && !expirou && !donoInutil){
    return { lider:false, dono, motivo:`${dono.host} está sincronizando` };
  }
  /* eu sem sessão só assumo se não houver mais ninguém — melhor um líder cego
     reportando "sessão expirada" ao painel do que trava vazia e silêncio */
  if (!sessaoOk && !meu && !expirou){
    return { lider:false, dono, motivo:'minha sessão caiu' };
  }

  const novo = { ...EU, em: agora, sessaoOk: !!sessaoOk };
  let ok;
  try { ok = await rtdbPutSeIgual(caminho, novo, atual.etag); }
  catch(e){ return { lider:false, dono, motivo:'falha ao gravar: ' + e.message }; }

  return ok
    ? { lider:true, dono:novo, motivo: meu ? 'renovei' : 'assumi' }
    : { lider:false, dono, motivo:'outra máquina assumiu primeiro' };
}

/* Solta a trava ao encerrar — sem isso a próxima máquina esperaria o TTL inteiro
   por nada quando alguém simplesmente desliga o computador com educação. */
export async function largarLideranca(caminho){
  try {
    const atual = await rtdbGetComEtag(caminho);
    if (atual.valor && atual.valor.id === EU.id){
      await rtdbPutSeIgual(caminho, null, atual.etag);
    }
  } catch {}
}

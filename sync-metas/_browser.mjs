/* =========================================================================
   PokerByte — infraestrutura comum dos scripts (navegador + caminhos).

   POR QUE PERFIL PERSISTENTE (e não storageState)
   -----------------------------------------------
   O login do PokerByte tem reCAPTCHA v3 + código de e-mail válido por 5 min.
   Automatizar esse login é inviável — e é por isso que a sessão é criada UMA VEZ,
   à mão, e reaproveitada depois. `launchPersistentContext` guarda cookies,
   localStorage e device-id num perfil de disco igual a um navegador de verdade,
   então a conta continua "conhecida" entre execuções e o reCAPTCHA v3 (que pontua
   comportamento, não só o clique) tem muito menos motivo pra derrubar a sessão.
   ========================================================================= */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = dirname(fileURLToPath(import.meta.url));

/* ESTADO SEPARADO DO CÓDIGO.
   O código é público e substituível (o instalador baixa por cima a cada
   atualização). O estado é secreto e insubstituível: cookie de sessão, senha do
   Firebase, identidade da máquina. Misturar os dois significava que atualizar a
   ferramenta apagaria a sessão, e que publicar a ferramenta arriscaria publicar o
   cookie. Por isso o estado mora no perfil do usuário, fora da pasta do código. */
export const ESTADO_DIR = process.env.SYNC_METAS_ESTADO
  || join(process.env.LOCALAPPDATA || process.env.HOME || RAIZ, 'SupremaSyncMetas');

export const PERFIL_DIR   = join(ESTADO_DIR, 'perfil');    // cookies da sessão do PokerByte
export const CAPTURAS_DIR = join(ESTADO_DIR, 'capturas');  // payloads crus (diagnóstico)

/* garante a pasta antes de qualquer escrita (.env, maquina.id, perfil) */
try { mkdirSync(ESTADO_DIR, { recursive: true }); } catch {}

/* playwright-core não está instalado NESTE repo (ele é o site publicado e não tem
   node_modules). Reaproveitamos o do projeto Grade-MTT, que já o traz. Dá pra
   apontar pra outro lugar com PLAYWRIGHT_HOST_PKG=<caminho do package.json>. */
const HOST_PKG = process.env.PLAYWRIGHT_HOST_PKG
  || 'C:/Users/BrianLaureanoAlvesRo/Downloads/Grade-MTT-extract/Grade-MTT-main/package.json';

export function carregarPlaywright(){
  try {
    return createRequire(HOST_PKG)('playwright-core');
  } catch (e) {
    throw new Error(
      `Não achei o playwright-core a partir de ${HOST_PKG}.\n` +
      `Aponte para um package.json que o tenha:  PLAYWRIGHT_HOST_PKG=<caminho> node <script>`
    );
  }
}

/* Playwright-core não baixa navegador — usa um já instalado. O Edge do Windows
   serve e tem a vantagem de ser um Chromium "de verdade" aos olhos do reCAPTCHA. */
const EDGE_CANDIDATOS = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

export function acharEdge(){
  const achado = EDGE_CANDIDATOS.find(p => existsSync(p));
  if(!achado) throw new Error(`Edge não encontrado. Tente EDGE_PATH=<caminho do msedge.exe>`);
  return achado;
}

export const BASE_URL  = process.env.POKERBYTE_URL   || 'https://www.pokerbyte.com.br';
export const METAS_URL = process.env.POKERBYTE_METAS || `${BASE_URL}/metas`;

/* headless:false é o padrão de propósito: no login você PRECISA ver a tela (resolver
   o captcha, digitar o código), e na captura é você quem navega até a meta. */
export async function abrirNavegador({ headless = false } = {}){
  const { chromium } = carregarPlaywright();
  mkdirSync(PERFIL_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PERFIL_DIR, {
    headless,
    executablePath: acharEdge(),
    viewport: null,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args: ['--start-maximized'],
  });
  return ctx;
}

/* Heurística de "estou logado?": a rota /metas responde 401 pra quem não tem
   sessão (verificado na mão), e a página de erro carrega o título "Suprema Union".
   Se o conteúdo não for a tela de erro nem o formulário de login, considera logado. */
export async function pareceLogado(page){
  const url = page.url();
  if(/\/login/i.test(url)) return false;
  const temFormLogin = await page.locator('input[type="password"]').count().catch(() => 0);
  if(temFormLogin > 0) return false;
  const corpo = await page.content().catch(() => '');
  if(/>\s*401\s*</.test(corpo)) return false;
  return true;
}

/* Sessão viva? Checagem barata, por COOKIE — não navega, não gasta requisição.
   Ler o HTML não serve: toda página do app tem input[type=password] (form de troca
   de senha no shell), então "tem campo de senha" não significa "deslogado".
     suprema-token  → sessão autenticada
     suprema-filter → slot/clube escolhido, sem o qual a /metas vem vazia */
export async function temSessao(ctx){
  try {
    const cookies = await ctx.cookies();
    const pega = n => cookies.find(c => c.name === n && /pokerbyte\.com\.br$/.test(c.domain.replace(/^\./, '')));
    return !!(pega('suprema-token') && pega('suprema-filter'));
  } catch { return false; }
}

/* Confirmacao REAL: cookie presente nao quer dizer sessao viva — cookie vencido
   fica no perfil do mesmo jeito. Aqui pedimos a pagina e vemos se ela responde
   em vez de mandar pro login. Custa uma requisicao, entao o chamador deve
   espacar (a cada ciclo, nao a cada segundo). */
export async function sessaoRealmenteViva(ctx, url){
  try {
    const r = await ctx.request.get(url, { timeout: 15000 });
    if (r.status() !== 200) return false;
    if (/\/login/i.test(r.url())) return false;
    return !/>\s*401\s*</.test(await r.text());
  } catch { return false; }
}

export function carimbo(){
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

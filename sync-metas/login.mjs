/* =========================================================================
   PokerByte — LOGIN (roda uma vez, à mão)

   Abre o Edge com o perfil persistente e espera VOCÊ logar: e-mail, senha,
   reCAPTCHA e o código de 5 minutos que chega no e-mail. Nada disso é
   automatizável, e tentar seria só uma forma cara de ser bloqueado.

   REGRA DESTE SCRIPT: NÃO ENCOSTAR NA SUA ABA.
   A primeira versão fazia page.goto('/metas') a cada 2s pra testar a sessão e,
   quando dava errado, mandava a aba de volta pro /login — atropelando a tela do
   código de verificação. Parecia "deslogar sozinho"; era o script brigando com
   o login. Agora a checagem usa ctx.request, que compartilha os cookies do
   contexto mas roda FORA da página: você loga sem ser interrompido.

       node _pokerbyte/login.mjs
   ========================================================================= */
import { abrirNavegador, BASE_URL, METAS_URL, PERFIL_DIR } from './_browser.mjs';

const TIMEOUT_MIN = Number(process.env.LOGIN_TIMEOUT_MIN || 12);
const log = (...a) => console.log('[login]', ...a);

const ctx = await abrirNavegador({ headless: false });
const page = ctx.pages()[0] || await ctx.newPage();

log(`abrindo ${BASE_URL}/login`);
log(`logue nesta janela — você tem ${TIMEOUT_MIN} min.`);
log('não vou tocar na sua aba; a checagem roda por fora.');

await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});

/* Sessão válida = os DOIS cookies existem.

   Ler o HTML não serve: toda página do app carrega um input[type=password]
   (form de troca de senha no shell), então "tem campo de senha" NÃO significa
   "ainda no login" — foi o que travou a detecção na primeira tentativa.
   Os cookies são explícitos:
     suprema-token  → sessão autenticada (JWT)
     suprema-filter → slot/clube escolhido, sem o qual a /metas vem vazia */
const SLOT_ESPERADO = process.env.POKERBYTE_SLOT || '106-10044';  // Liga Suprema ADM

async function estado(){
  const cookies = await ctx.cookies().catch(() => []);
  const pega = nome => cookies.find(c => c.name === nome && /pokerbyte\.com\.br$/.test(c.domain.replace(/^\./, '')));
  const token = pega('suprema-token');
  const filtro = pega('suprema-filter');
  const temCookies = !!(token && token.value);

  /* COOKIE PRESENTE NAO E SESSAO VALIDA.
     Cookie vencido continua no perfil — e foi assim que este script anunciou
     "sessao renovada" sem ninguem ter logado, deixando o servico cego o resto da
     noite. Confirmacao de verdade: pedir a /metas e ver se ela responde em vez de
     mandar pro login. Feito por HTTP no mesmo jar de cookies, sem tocar na aba
     onde a pessoa esta digitando. */
  let valida = false;
  if (temCookies){
    try {
      const r = await ctx.request.get(METAS_URL, { timeout: 15000 });
      valida = r.status() === 200 && !/\/login/i.test(r.url()) && !/>\s*401\s*</.test(await r.text());
    } catch { valida = false; }
  }

  return { logado: valida, slot: filtro ? String(filtro.value) : null, temCookies };
}

const limite = Date.now() + TIMEOUT_MIN * 60 * 1000;
let ok = false, ultimo = { logado:false, slot:null };
let avisouSlot = false;

while (Date.now() < limite) {
  await new Promise(r => setTimeout(r, 3000));
  if (!ctx.pages().length) { log('janela fechada antes de confirmar.'); break; }

  ultimo = await estado();
  if (ultimo.logado && !ultimo.slot && !avisouSlot){
    avisouSlot = true;
    log('sessão ok — agora escolha o slot no modal "Filtro" (Liga Suprema ADM).');
  }
  if (ultimo.logado && ultimo.slot) { ok = true; break; }
}

if (ok) {
  log(`✓ sessão válida, slot ${ultimo.slot}.`);
  if (ultimo.slot !== SLOT_ESPERADO){
    log(`⚠ slot diferente do esperado (${SLOT_ESPERADO}). O sync vai colher OUTRO clube.`);
  }
  log(`perfil salvo em ${PERFIL_DIR}`);
} else if (ultimo.logado) {
  log('✗ logado, mas sem slot selecionado — a /metas viria vazia. Rode de novo e escolha o clube.');
} else {
  log('✗ não confirmei a sessão dentro do tempo. Rode de novo.');
}

await ctx.close().catch(() => {});
process.exit(ok ? 0 : 1);

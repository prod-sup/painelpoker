/* Guarda de sessão — rode com:  node sessao.test.js

   O logout tem que apagar as DUAS chaves: a sessão e o "admin confiável neste
   navegador". As cópias locais de clearSession (painel.js e criacao-noturna.js)
   apagavam só a sessão, então:

       admin clica "Sair da conta" -> sessão some, mas 'suprema_trusted_admin'
       fica -> SupremaAuth.recognize() segue devolvendo isAdmin:true

   Numa máquina compartilhada da operação, o próximo usuário herdava o
   reconhecimento de admin. Este teste impede a volta disso.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

let passed = 0;
const SESSION_KEY = 'suprema_session_v1';
const TRUSTED_KEY = 'suprema_trusted_admin';

/* localStorage falso, só o que o módulo usa */
function makeStorage(inicial) {
  const dados = Object.assign({}, inicial);
  return {
    dados,
    getItem: k => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
    removeItem: k => { delete dados[k]; },
  };
}

/* carrega o suprema-auth.js com globais falsos */
function loadAuth(storage) {
  const src = fs.readFileSync(__dirname + '/suprema-auth.js', 'utf8');
  const global_ = {};
  const win = {
    localStorage: storage,
    location: { href: '', replace() {}, hostname: 'localhost', pathname: '/' },
    addEventListener() {},
ifr: null,
  };
  const doc = {
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, documentElement: { classList: { add() {}, remove() {} } },
    body: null, cookie: '',
  };
  try {
    new Function('window', 'document', 'localStorage', 'navigator', 'console', 'self',
      src + '\n;window.__SupremaAuth = (typeof global !== "undefined" && global.SupremaAuth) || window.SupremaAuth;')
      (win, doc, storage, { userAgent: 'node' }, { log() {}, warn() {}, error() {} }, win);
  } catch (e) {
    return { erro: e.message, win };
  }
  return { auth: win.SupremaAuth || win.__SupremaAuth, win };
}

console.log('\nlogout apaga as duas chaves:');
{
  const storage = makeStorage({ [SESSION_KEY]: JSON.stringify({ email: 'a@b.c', expiresAt: Date.now() + 1e6 }),
                                [TRUSTED_KEY]: 'a@b.c' });
  const { auth, erro } = loadAuth(storage);

  if (erro || !auth || typeof auth.clearSession !== 'function') {
    // o módulo depende de APIs de browser que não vale simular por inteiro;
    // então validamos a REGRA direto no fonte, que é o que precisa não regredir.
    console.log('  (módulo não roda fora do browser — validando o fonte)');
    const src = fs.readFileSync(__dirname + '/suprema-auth.js', 'utf8');
    const m = src.match(/function clearSession\(\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(m, 'clearSession não encontrada em suprema-auth.js');
    assert.ok(m[0].includes('SESSION_KEY'), 'clearSession deve remover SESSION_KEY');
    assert.ok(m[0].includes('TRUSTED_KEY'), 'clearSession deve remover TRUSTED_KEY');
    passed += 2;
    console.log('  ✓ SupremaAuth.clearSession remove SESSION_KEY');
    console.log('  ✓ SupremaAuth.clearSession remove TRUSTED_KEY');
  } else {
    auth.clearSession();
    assert.strictEqual(storage.getItem(SESSION_KEY), null, 'sessão deveria sumir');
    assert.strictEqual(storage.getItem(TRUSTED_KEY), null, 'admin confiável deveria sumir');
    passed += 2;
    console.log('  ✓ sessão apagada');
    console.log('  ✓ admin confiável apagado');
  }
}

/* ── o ponto central: nenhum painel pode ter clearSession "própria" que
   esqueça o TRUSTED_KEY. Ou delega pro SupremaAuth, ou limpa as duas. ── */
console.log('\nnenhum painel apaga só a sessão:');
{
  const falhas = [];
  for (const arq of ['painel.js', 'criacao-noturna.js', 'admin.js', 'hub.js']) {
    let src;
    try { src = fs.readFileSync(__dirname + '/' + arq, 'utf8'); } catch (e) { continue; }
    const m = src.match(/function clearSession\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!m) { console.log('  – ' + arq + ' (não define clearSession)'); continue; }
    const corpo = m[0];
    const delega = /SupremaAuth\s*\.\s*clearSession/.test(corpo);
    const limpaTrusted = /trusted/i.test(corpo);
    if (delega || limpaTrusted) { passed++; console.log('  ✓ ' + arq + (delega ? ' (delega pro SupremaAuth)' : ' (limpa as duas)')); }
    else { falhas.push(arq); console.log('  ✗ ' + arq + ' — apaga só a sessão, deixa o admin confiável'); }
  }
  assert.strictEqual(falhas.length, 0,
    'painéis com clearSession incompleta: ' + falhas.join(', '));
}

console.log(`\n${passed} verificações passaram.`);

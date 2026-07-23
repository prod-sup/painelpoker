/* ── Build de produção do Painel do Dia ─────────────────────────────────────
   Gera cópias MINIFICADAS dos assets pesados em dist/, sem tocar nos fontes da
   raiz (que o Brian edita e publica por upload web). O HTML da raiz continua
   apontando pros fontes legíveis; só o index.html DENTRO de dist/ aponta pros
   .min — assim dá pra medir/servir a versão enxuta sem quebrar o fluxo de edição.

   Uso:  node build.mjs      (ou  npm run build)

   O que minifica e o ganho típico (parse + transferência antes do gzip do GH Pages):
     painel.js   466KB → ~180KB     painel.css  190KB → ~120KB
     suprema-motion.js, suprema-insights.js, gu-parser.js, painel-calc/actions.js

   NÃO fazemos bundle (a ordem dos <script> importa e há inline scripts): só
   minificação arquivo-a-arquivo, mantendo os mesmos nomes dentro de dist/. */
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'dist';
mkdirSync(OUT, { recursive: true });

// JS minificado, um arquivo por vez (sem bundle — preserva a ordem de carga).
// Cobre TODOS os painéis do hub + as libs compartilhadas.
const JS = [
  // painel do dia
  'painel.js', 'painel-calc.js', 'painel-actions.js', 'conf-dia.js', 'suprema-insights.js',
  // hub e demais painéis
  'hub.js', 'hub-onboarding.js',
  'admin.js', 'admin-actions.js',
  'criacao-noturna.js', 'criacao-calc.js', 'liga-principal-data.js',
  'dashboard-mesa-cash.js',
  'eventos.js',
  'tv.js',
  // libs compartilhadas
  'suprema-motion.js', 'suprema-auth.js', 'suprema-shell.js', 'suprema-db.js', 'suprema-feltro.js',
  'suprema-presence.js', 'suprema-onboarding.js', 'gu-parser.js', 'radar-core.js',
  'scripts/lite.js', 'scripts/fluidez.js',
].filter(existsSync);

// CSS minificado — um por painel + tokens compartilhados
const CSS = [
  'painel.css', 'hub.css', 'admin.css', 'criacao-noturna.css',
  'dashboard-mesa-cash.css', 'eventos.css', 'tv.css', 'suprema-tokens.css',
].filter(existsSync);

const kb = n => (n / 1024).toFixed(1) + 'KB';

async function run() {
  mkdirSync(`${OUT}/scripts`, { recursive: true });
  let before = 0, after = 0;
  for (const f of [...JS, ...CSS]) {
    const src = readFileSync(f);
    before += src.length;
    await build({
      entryPoints: [f],
      outfile: `${OUT}/${f}`,
      minify: true,
      legalComments: 'none',
      logLevel: 'error',
    });
    after += readFileSync(`${OUT}/${f}`).length;
  }

  // HTMLs de produção: copiados como estão (mesmos caminhos de <script>/<link> —
  // os .min moram com o mesmo nome dentro de dist/, então nada precisa ser reescrito).
  const HTML = [
    'index.html', 'hub.html', 'admin.html', 'criacao-noturna.html',
    'dashboard-mesa-cash.html', 'eventos.html', 'tv.html',
  ].filter(existsSync);
  for (const h of HTML) copyFileSync(h, `${OUT}/${h}`);

  console.log(`✓ dist/ gerado — ${JS.length + CSS.length} assets + ${HTML.length} HTMLs`);
  console.log(`  ${kb(before)} → ${kb(after)}  (${(100 - after / before * 100).toFixed(0)}% menor, antes do gzip do GitHub Pages)`);
  console.log('  Fontes da raiz intactos. Pra servir a versão enxuta, publique o conteúdo de dist/.');
}

run().catch(e => { console.error(e); process.exit(1); });

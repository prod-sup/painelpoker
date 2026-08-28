/* Fins de linha — rode com:  node eol.test.js

   POR QUÊ ESTE ARQUIVO EXISTE
   ---------------------------
   Em 28/08/2026 uma bateria de edições no painel.js reescreveu o arquivo inteiro
   de CRLF para LF. O código continuou funcionando — mas o `git diff` virou
   "23.551 linhas alteradas" no arquivo da operação principal, quando a mudança
   real era ~1.200. Um diff assim é impossível de revisar, apaga o rastro do
   `git blame` e esconde qualquer coisa errada no meio.

   O repositório é CRLF (96 arquivos), então a regra é: CRLF em todo arquivo de
   código. Dois estados reprovam:
     - MISTO  (CRLF e LF no mesmo arquivo) — o pior: o diff fica ilegível em pedaços
     - LF     (arquivo inteiro convertido)  — o caso que aconteceu

   ALLOWLIST: os arquivos abaixo JÁ estavam torto antes deste teste existir e têm
   trabalho de outra pessoa em andamento — converter agora atropelaria a edição
   dela. A lista é dívida: quando esses arquivos forem fechados, tire-os daqui.
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

/* .cmd/.bat entram aqui por um motivo mais grave que diff feio: o interpretador
   do Windows lê o arquivo em BYTES, e um .cmd em LF puro (ou misto) pode quebrar
   em label, `goto` e bloco de parênteses — justamente nos instaladores que
   precisam rodar em QUALQUER PC do turno. Achado em 28/08/2026: o INSTALAR.cmd
   da raiz estava inteiro em LF. */
const EXTS = ['.js', '.html', '.css', '.mjs', '.cjs', '.cmd', '.bat'];
const ALLOWLIST = new Set([
  'admin.css',                // misto — trabalho em andamento de outra pessoa
  'suprema-tokens.css',       // misto — idem
  'liga-principal-data.js',   // misto — idem
]);

let pass = 0;
const falhas = [];

/* sync-metas/ entra junto: é o robô das Metas, que é INSTALADO em cada PC do
   turno. Um .cmd torto ali quebra numa máquina e não na outra — o pior tipo de
   bug pra diagnosticar à distância. */
const PASTAS = ['.', 'sync-metas'];
const arquivos = PASTAS.flatMap(sub => {
  const dir = path.join(__dirname, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => EXTS.includes(path.extname(f)))
    .map(f => (sub === '.' ? f : sub + '/' + f));
}).filter(f => !ALLOWLIST.has(path.basename(f))).sort();

console.log('Fins de linha (CRLF) em ' + arquivos.length + ' arquivos de código:');

for (const f of arquivos) {
  let s;
  try { s = fs.readFileSync(path.join(__dirname, f), 'latin1'); } catch (e) { continue; }
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/[^\r]\n/g) || []).length;
  if (crlf === 0 && lf === 0) { pass++; continue; }          // arquivo de uma linha só
  if (crlf > 0 && lf > 0) {
    falhas.push(f + ' está MISTO (CRLF ' + crlf + ' / LF ' + lf + ') — normalize para CRLF');
  } else if (lf > 0) {
    falhas.push(f + ' está todo em LF — normalize para CRLF, senão o diff vira o arquivo inteiro');
  } else {
    pass++;
  }
}

console.log('  ✓ ' + pass + ' arquivo(s) em CRLF');
console.log('');
if (falhas.length) {
  console.log(falhas.length + ' FALHA(S):');
  falhas.forEach(f => console.log('  ✗ ' + f));
  console.log('');
  console.log('  Como normalizar (PowerShell, na raiz do repo):');
  console.log('    $p="ARQUIVO"; $s=[IO.File]::ReadAllText($p);');
  console.log('    [IO.File]::WriteAllText($p, ($s -replace "`r`n","`n" -replace "`n","`r`n"))');
  process.exitCode = 1;
} else {
  console.log(pass + ' verificações passaram.');
}

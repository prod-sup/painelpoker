/* Roda todas as suítes de uma vez:   node test.js
   Sai com código 1 se qualquer uma falhar (serve pra pre-commit/CI). */
const { execFileSync } = require('child_process');
const fs = require('fs');

const suites = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let falhas = 0;

for (const s of suites) {
  process.stdout.write(s.padEnd(28));
  try {
    const out = execFileSync(process.execPath, [__dirname + '/' + s], { encoding: 'utf8' });
    const n = (out.match(/(\d+) (?:testes|verificações)/g) || []).pop() || '';
    console.log('PASSOU  ' + n);
  } catch (e) {
    falhas++;
    console.log('FALHOU');
    console.log((e.stdout || '') + (e.stderr || ''));
  }
}

console.log('\n' + suites.length + ' suítes, ' + falhas + ' falha(s).');
process.exit(falhas ? 1 : 0);

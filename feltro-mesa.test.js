/* Variante 'mesa' do Feltro (fundo do hub) — node feltro-mesa.test.js

   POR QUE ISTO EXISTE
   -------------------
   Erro em shader NÃO dá tela de erro: o `program()` devolve null, o build()
   falha, o onFallback dispara e o hub volta pro fundo antigo. Do lado de fora
   parece "não funcionou" — sem pista nenhuma de onde olhar.

   Pior ainda é o erro que compila: um uniform usado no GLSL mas ausente da
   lista de `locs()` nunca é setado, fica 0 pra sempre, e o fundo renderiza
   silenciosamente errado.

   Não dá pra compilar GLSL em Node sem GPU, então isto valida o que É
   verificável estaticamente — que é justamente onde esses dois erros moram.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/suprema-feltro.js', 'utf8');
let passed = 0;
function ok(cond, name) { assert.ok(cond, name); passed++; console.log('  ✓ ' + name); }
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name + ' = ' + JSON.stringify(got));
}

/* extrai o corpo de um shader-template `const NOME = (octaves) => \`...\`` */
function shader(nome) {
  const re = new RegExp('const ' + nome + ' = \\(octaves\\) => `([\\s\\S]*?)`;');
  const m = src.match(re);
  assert.ok(m, nome + ' não encontrado');
  return m[1];
}
const MESA = shader('MESA_FS');
const FOG = shader('FOG_FS');

/* a lista de uniforms que o build() realmente pede ao WebGL */
const locsList = (() => {
  const m = src.match(/fogU\s*=\s*locs\(gl, fogP, \[([^\]]+)\]\)/);
  assert.ok(m, "chamada locs() do fogU não encontrada");
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
})();

/* ── 1. todo uniform usado no shader está na lista do locs() ──
   Este é O erro silencioso: usar sem pedir a location = valor 0 pra sempre. */
console.log('\nuniforms declarados x pedidos ao WebGL:');
{
  const declarados = nome => {
    const set = new Set();
    for (const m of nome.matchAll(/uniform\s+\w+\s+([^;]+);/g)) {
      m[1].split(',').forEach(v => set.add(v.trim()));
    }
    return set;
  };
  for (const [rot, sh] of [['mesa', MESA], ['tv (névoa)', FOG]]) {
    const decl = [...declarados(sh)];
    const faltando = decl.filter(u => !locsList.includes(u));
    eq(faltando, [], rot + ': todo uniform declarado é pedido no locs()');
  }
  ok(locsList.includes('uMouse'), 'uMouse está no locs() (a mesa precisa dele)');
}

/* ── 2. o uniform novo não pode quebrar a TV ──
   uMouse não existe no shader da névoa; getUniformLocation devolve null e
   gl.uniform2f(null, …) é no-op por especificação. Mas o CÓDIGO tem que
   continuar chamando sem ramificar — se alguém puser um if errado aqui, a
   mesa para de reagir e ninguém entende por quê. */
console.log('\na TV não pode quebrar com o uniform novo:');
{
  ok(!/uniform\s+vec2\s+uMouse/.test(FOG), 'a névoa da TV NÃO declara uMouse');
  ok(/gl\.uniform2f\(fogU\.uMouse/.test(src), 'o upload de uMouse é incondicional (no-op na TV)');
  ok(/opts\.variant === 'mesa' \? MESA_FS : FOG_FS/.test(src),
     "sem variant, a TV continua no FOG_FS");
}

/* ── 3. GLSL estruturalmente são ── */
console.log('\nestrutura do GLSL da mesa:');
{
  const semComentario = MESA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const abre = (semComentario.match(/{/g) || []).length;
  const fecha = (semComentario.match(/}/g) || []).length;
  eq(abre, fecha, 'chaves balanceadas');
  const pa = (semComentario.match(/\(/g) || []).length;
  const pf = (semComentario.match(/\)/g) || []).length;
  eq(pa, pf, 'parênteses balanceados');
  ok(/void main\(\)/.test(MESA), 'tem void main()');
  ok(/gl_FragColor\s*=/.test(MESA), 'escreve em gl_FragColor');
  ok(/#define OCTAVES \$\{octaves\}/.test(MESA),
     'OCTAVES entra por #define (GLSL ES 1.00 exige limite de laço constante)');
  ok(MESA.includes('${FS_PRECISION}'),
     'usa o guard de precisão (highp não é garantido no fragment em WebGL1)');
}

/* ── 4. toda função chamada no main existe ──
   GLSL não tem hoisting: chamar antes de declarar é erro de compilação. */
console.log('\nfunções do shader:');
{
  /* comentários em português ficam DENTRO do shader e têm palavras seguidas de
     "(" — sem removê-los, o scanner acusa "cursor(" como função órfã. */
  const codigo = MESA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const decl = new Set([...codigo.matchAll(/^\s*(?:float|vec2|vec3|vec4)\s+(\w+)\s*\(/gm)].map(m => m[1]));
  const builtin = new Set(['main','mix','fract','sin','cos','floor','length','distance',
    'smoothstep','dot','abs','vec2','vec3','vec4','max','min','clamp','pow','sqrt','mod']);
  const usadas = new Set([...codigo.matchAll(/(\w+)\s*\(/g)].map(m => m[1])
    .filter(n => !builtin.has(n) && !/^(if|for|while|return)$/.test(n)));
  const orfas = [...usadas].filter(n => !decl.has(n));
  eq(orfas, [], 'nenhuma função usada sem ser declarada');

  /* ordem: GLSL exige declaração ANTES do uso */
  for (const fn of ['hash', 'noise', 'fbm', 'weave', 'falloff']) {
    ok(MESA.indexOf('float ' + fn + '(') < MESA.indexOf('void main()'),
       fn + '() declarada antes do main()');
  }
}

/* ── 5. o cursor: sem ponteiro, a onda não pode aparecer ──
   Em touch o mouse nunca chega. O sentinela é (-1,-1) e o shader precisa
   testá-lo, senão a ondulação fica presa no canto e parece bug. */
console.log('\nsentinela do cursor:');
{
  ok(/uMouse\.x >= 0\.0/.test(MESA), 'o shader testa o sentinela antes de desenhar a onda');
  ok(/let mouse = \[-1, -1\], mouseTo = \[-1, -1\]/.test(src), 'o estado inicial é "sem cursor"');
  const api = src.match(/mouse\(x, y\)\{[\s\S]*?\n      \}/);
  assert.ok(api, 'api.mouse não encontrada');
  ok(/x === null \|\| x === undefined/.test(api[0]), 'mouse(null) solta o cursor');
  ok(/if \(mouse\[0\] < 0\) mouse = \[x, y\]/.test(api[0]),
     'a 1ª leitura não varre a tela (sem isso a onda cruza o hero na entrada)');
}

console.log(`\n${passed} verificações passaram.`);

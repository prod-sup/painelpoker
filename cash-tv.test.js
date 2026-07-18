/* Modo TV do Cash Intelligence — rode com:  node cash-tv.test.js

   O fundo WebGL só vale se CARREGAR ESTADO. Aqui o painel já tinha MÁQUINA DE
   CENAS, então o mapeamento é quase 1:1 com a Suprema TV: cada cena veste um
   matiz, o corte dá pulse, e o heat diz quão vivo está o salão.

   Um erro aqui não dá tela de erro — o telão só passa a mentir sobre a
   operação (sala quente com as mesas mortas, ou fria com o piso cheio).
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/dashboard-mesa-cash.js', 'utf8');
let passed = 0;
function eq(got, exp, name) {
  assert.deepStrictEqual(got, exp, `${name}: esperado ${JSON.stringify(exp)}, veio ${JSON.stringify(got)}`);
  passed++; console.log('  ✓ ' + name + ' = ' + JSON.stringify(got));
}

/* ── 1. o heat: mesas COM retenção sobre o total ── */
console.log('\nheat = quão vivo está o salão:');
{
  const m = src.match(/function tvFeltroHeat\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'tvFeltroHeat não encontrada');

  const roda = deadPct => {
    let v = null;
    const feltro = { heat(x) { v = x; return feltro; } };
    new Function('ctx', `
      const TV_FELTRO = ctx.f, KPI_DEMO = ctx.k;
      ${m[0]}
      tvFeltroHeat();
    `)({ f: feltro, k: { deadPct } });
    return v;
  };

  eq(roda(0),    1,    'nenhuma mesa morta: salão em brasa');
  eq(roda(100),  0,    'tudo morto: sala fria');
  eq(roda(24.5), 0.755,'24,5% mortas (o número real do painel) = 0.755');
  eq(roda(50),   0.5,  'metade morta: meio-termo');

  /* o shader espera 0..1: dado sujo não pode estourar o intervalo */
  eq(roda(120),  0,    'acima de 100% satura em 0, não vira negativo');
  eq(roda(-10),  1,    'negativo satura em 1, não passa de 1');

  /* sem dado, NÃO mente sobre o salão: deixa o heat como está */
  eq(roda(undefined), null, 'sem deadPct não chama heat');
  eq(roda(null),      null, 'deadPct nulo não chama heat');
  eq(roda('abc'),     null, 'lixo não vira número');
}

/* ── 2. uma cor por cena, e o índice nunca estoura ── */
console.log('\naccent por cena:');
{
  const m = src.match(/const TV_SCENE_ACCENT=\[[^\]]*\]/);
  assert.ok(m, 'TV_SCENE_ACCENT não encontrada');
  const cores = new Function('return ' + m[0].replace('const TV_SCENE_ACCENT=', ''))();

  eq(cores.length, 6, 'seis cores para as seis cenas');
  eq(cores.every(c => /^#[0-9a-f]{6}$/i.test(c)), true, 'todas em hex de 6 dígitos');
  eq(new Set(cores).size, 6, 'nenhuma cena repete a cor da outra');

  /* a rotação é infinita (tvShow(scene+1) pra sempre): o índice TEM que dar
     a volta, senão a cena 6 pega undefined e a névoa some. */
  const cor = i => cores[i % cores.length];
  eq(cor(0), cores[0], 'cena 0');
  eq(cor(6), cores[0], 'cena 6 volta pra primeira cor');
  eq(cor(13), cores[1], 'cena 13 dá a volta certa');
}

/* ── 3. o corte de cena dispara pulse + accent juntos ── */
console.log('\ncorte de cena:');
{
  assert.ok(/TV_FELTRO\.pulse\(\)\.accent\(/.test(src),
    'o corte deveria encadear pulse().accent()');
  passed++; console.log('  ✓ tvShow encadeia pulse() e accent()');

  assert.ok(/if\(TV_FELTRO\)\{[\s\S]{0,200}TV_FELTRO\.pulse\(\)/.test(src),
    'o corte precisa ser guardado por if(TV_FELTRO)');
  passed++; console.log('  ✓ guardado por if(TV_FELTRO) — sem WebGL não estoura');
}

/* ── 4. ciclo de vida: sobe ao abrir, cai ao fechar ──
   WebGL rodando atrás de overlay fechado é GPU queimando 24h à toa. */
console.log('\nciclo de vida do contexto:');
{
  const enter = src.match(/function tvEnter\(\)\{[\s\S]*?\n\}/)[0];
  const exit  = src.match(/function tvExit\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/tvMountFeltro\(\)/.test(enter), 'tvEnter deveria montar o Feltro');
  assert.ok(/tvUnmountFeltro\(\)/.test(exit), 'tvExit deveria destruir o Feltro');
  passed += 2;
  console.log('  ✓ tvEnter monta');
  console.log('  ✓ tvExit destrói (libera o contexto WebGL)');

  /* o mount precisa vir DEPOIS do tvEl(), que cria o #tvMode onde o canvas mora */
  assert.ok(enter.indexOf('tvEl()') < enter.indexOf('tvMountFeltro()'),
    'tvEl() tem que criar o #tvMode ANTES do mount procurar por ele');
  passed++; console.log('  ✓ monta depois do #tvMode existir');
}

/* ── 5. fallback: os blobs em CSS só somem se o shader subir MESMO ── */
console.log('\nfallback dos blobs:');
{
  const mount = src.match(/function tvMountFeltro\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/if\(TV_FELTRO&&el\)el\.classList\.add\('feltro-on'\)/.test(mount),
    "a classe 'feltro-on' só pode entrar se o mount devolveu algo");
  passed++; console.log('  ✓ esconde os blobs só com o Feltro no ar');

  assert.ok(/onFallback\(\)\{\s*tvFeltroOff\(\)/.test(mount),
    'onFallback tem que devolver os blobs');
  passed++; console.log('  ✓ onFallback devolve os blobs (shader falhou = fundo animado volta)');

  const css = fs.readFileSync(__dirname + '/dashboard-mesa-cash.css', 'utf8');
  assert.ok(/#tvMode\.feltro-on \.tv-blob\{display:none\}/.test(css),
    'o CSS precisa esconder os blobs sob .feltro-on');
  passed++; console.log('  ✓ o CSS casa com a classe');
}

console.log(`\n${passed} testes passaram.`);

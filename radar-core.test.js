/* Testes do radar-core.js — rode com:  node radar-core.test.js
   (mesma receita do gu-parser.test.js: carrega o fonte com new Function e
   exporta o que interessa, sem precisar de bundler nem de navegador)

   Cobre o VÍNCULO SATÉLITE → ALVO, que é a regra mais cara de errar do Radar:
   o número que sai daqui ("3 satélites classificam") é o que o Marketing fala
   pro jogador. Dois bugs REAIS de produção viraram teste aqui:

   1. SATÉLITE REPETIDO NO MESMO GRUPO (relatado com print da tela)
      "5 Seats WarmUp" rodando 10:30/11:00/11:30 dentro de um grupo com o MESMO
      nome. Como o cabeçalho do grupo casava exato com as próprias linhas, cada
      execução apontava pra seguinte e virava uma CORRENTE — só a última chegava
      no torneio real, que exibia "1 satélite" tendo três.

   2. ALVO ANTES DO SATÉLITE
      O headerTarget só PREFERIA alvos posteriores em vez de exigir. Num grupo
      "Mega Sat Big Main", o Mega Sat das 18:00 casava exato com o nome do Step 1
      das 16:00 (rank 4, pra trás no tempo) e vencia o Main das 20:00, que casava
      só por tokens (rank 3). O Mega Sat classificava pro próprio Step.

   Se mexer em headerTarget/linkSatellites, rode isto ANTES de publicar.
========================================================================= */
const fs = require('fs');
const assert = require('assert');

const guSrc = fs.readFileSync(__dirname + '/gu-parser.js', 'utf8');
const coreSrc = fs.readFileSync(__dirname + '/radar-core.js', 'utf8');
const api = {};
new Function('api', guSrc + '\n;' + coreSrc + `
;Object.assign(api, { parseGlobalWeek, buildModel, evKey, statusOf, fmtMoney });`)(api);

let passed = 0;
function ok(cond, name){ assert.ok(cond, name); passed++; console.log('  ✓ ' + name); }
function eq(got, exp, name){ assert.strictEqual(got, exp, `${name}: esperado ${exp}, veio ${got}`); passed++; console.log('  ✓ ' + name + ' = ' + got); }

/* colunas que o parseGlobalWeek lê: [0]=grupo/dia [1]=hora [2]=nome [3]=tipo [6]=gtd [7]=buyin */
function L(grupo, hora, nome, tipo, gtd, buyin){
  const r = new Array(18).fill(null);
  r[0] = grupo; r[1] = hora; r[2] = nome; r[3] = tipo; r[6] = gtd; r[7] = buyin;
  return r;
}
const dia = d => { const r = new Array(18).fill(null); r[2] = d; return r; };
const model = m => api.buildModel(api.parseGlobalWeek(m), {});
const acha = (mo, n) => mo.events.find(e => e.nome === n);
const alvoDe = (mo, nome) => { const s = acha(mo, nome); const t = s && mo.byId.get(s.targetId); return t ? t.nome : '(nenhum)'; };

/* ── 1. satélite repetido no mesmo grupo: os TRÊS classificam pro Main ── */
console.log('\nsatélite repetido no mesmo grupo (bug do print):');
{
  const mo = model([
    dia('SEXTA-FEIRA'),
    L(null, '14:00', '#AS 20K WarmUp', 'Main Event', 20000, 110),
    L('5 Seats WarmUp', '10:30', '5 Seats WarmUp', 'Satelite', null, 6),
    L(null,             '11:00', '5 Seats WarmUp', 'Satelite', null, 6),
    L(null,             '11:30', '5 Seats WarmUp', 'Satelite', null, 6),
  ]);
  const main = acha(mo, '#AS 20K WarmUp');
  eq(main.satCount, 3, 'o Main conta os 3 satélites');
  const sats = mo.events.filter(e => e.cat === 'sat');
  eq(sats.filter(s => s.targetId === main.id).length, 3, 'os 3 apontam pro Main');
  eq(sats.filter(s => { const t = mo.byId.get(s.targetId); return t && t.cat === 'sat'; }).length, 0,
     'nenhum satélite aponta pra outro satélite (corrente falsa)');
}

/* ── 2. a cadeia REAL (nomes diferentes por degrau) não pode quebrar ── */
console.log('\ncadeia real Step → Mega Sat → Main:');
{
  const mo = model([
    dia('SABADO'),
    L(null, '20:00', '#AS 100K Big Main', 'Main Event', 100000, 500),
    L('Mega Sat Big Main', '18:00', 'Mega Sat Big Main', 'Satelite', null, 50),
    L('Mega Sat Big Main', '16:00', 'Step 1 Mega Sat Big Main', 'Satelite', null, 5),
  ]);
  eq(alvoDe(mo, 'Step 1 Mega Sat Big Main'), 'Mega Sat Big Main', 'Step 1 → Mega Sat');
  eq(alvoDe(mo, 'Mega Sat Big Main'), '#AS 100K Big Main', 'Mega Sat → Main (não volta pro Step)');
  eq(acha(mo, '#AS 100K Big Main').satCount, 1, 'o Main conta só quem aponta direto nele');
  eq(acha(mo, 'Mega Sat Big Main').satCount, 1, 'o Mega Sat conta o Step');
}

/* ── 3. satélites de nomes diferentes no mesmo alvo ── */
console.log('\nsatélites diferentes no mesmo alvo:');
{
  const mo = model([
    dia('DOMINGO'),
    L(null, '19:00', '#AS 50K Sunday', 'Main Event', 50000, 200),
    L('#AS 50K Sunday', '17:00', 'Sat 50K Sunday Turbo', 'Satelite', null, 20),
    L('#AS 50K Sunday', '18:00', 'Sat 50K Sunday Hyper', 'Satelite', null, 30),
  ]);
  eq(acha(mo, '#AS 50K Sunday').satCount, 2, 'os 2 satélites contam');
}

/* ── 4. o alvo NUNCA pode começar antes do satélite ── */
console.log('\nalvo tem que começar depois do satélite:');
{
  const mo = model([
    dia('SEGUNDA-FEIRA'),
    L(null, '10:00', '#AS 30K Early', 'Main Event', 30000, 150),   // ANTES do satélite
    L('#AS 30K Early', '22:00', 'Sat 30K Early', 'Satelite', null, 15),
  ]);
  const sat = acha(mo, 'Sat 30K Early');
  ok(!sat.targetId, 'satélite das 22:00 não liga em torneio das 10:00');
  eq(acha(mo, '#AS 30K Early').satCount, 0, 'o torneio que já passou não conta satélite');
}

/* ── 5. o override do admin vence a heurística, e o satCount respeita ── */
console.log('\noverride manual vence a heurística:');
{
  const parsed = api.parseGlobalWeek([
    dia('TERÇA-FEIRA'),
    L(null, '20:00', '#AS 40K Alvo Certo', 'Main Event', 40000, 200),
    L(null, '21:00', '#AS 40K Alvo Errado', 'Main Event', 40000, 200),
    L('#AS 40K Alvo Errado', '18:00', 'Sat 40K Qualquer', 'Satelite', null, 20),
  ]);
  const semOv = api.buildModel(parsed, {});
  eq(alvoDe(semOv, 'Sat 40K Qualquer'), '#AS 40K Alvo Errado', 'sem override: segue o cabeçalho');

  const sat = acha(semOv, 'Sat 40K Qualquer');
  const certo = acha(semOv, '#AS 40K Alvo Certo');
  const chave = api.evKey(sat).replace(/[.#$/\[\]]/g, '_');
  const comOv = api.buildModel(parsed, { [chave]: { target: api.evKey(certo), targetName: certo.nome } });
  eq(alvoDe(comOv, 'Sat 40K Qualquer'), '#AS 40K Alvo Certo', 'com override: vai pro alvo escolhido');
  eq(acha(comOv, '#AS 40K Alvo Certo').satCount, 1, 'satCount conta DEPOIS do override');
  eq(acha(comOv, '#AS 40K Alvo Errado').satCount, 0, 'o alvo antigo perde a contagem');
}

/* ── 6. satélite sem destino vira grupo nomeado, não chute ── */
console.log('\ndestino fora da grade:');
{
  const mo = model([
    dia('QUARTA-FEIRA'),
    L('SUPREMA SERIES XI', '19:00', 'Sat Series XI Dia 1', 'Satelite', null, 30),
  ]);
  const sat = acha(mo, 'Sat Series XI Dia 1');
  ok(!sat.targetId, 'sem evento na grade: não inventa alvo');
  eq(sat.targetGroup, 'SUPREMA SERIES XI', 'o grupo vira destino nomeado');
}

console.log(`\n${passed} testes passaram.\n`);

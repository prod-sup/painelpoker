/* Testes do casador nome+horário.
   Os nomes e horários vêm da listagem real da /metas e do modal do PokerByte —
   não são inventados.

   node --test _pokerbyte/match.test.mjs
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  casarTorneio, semelhanca, normalizarNome, extrairHoraDoNome,
  distanciaMinutos, tokensNumericos,
} from './match.mjs';

/* listagem como aparece na /metas (nome + horário do card) */
const LISTAGEM = [
  { nome: 'SPS 106-M OmaX HR',    hora: '20:00' },
  { nome: 'SPS 105-M Battle HR',  hora: '18:00' },
  { nome: 'SPS 48-H Mystery HR',  hora: '19:00' },
  { nome: 'SPS 103-M Plus HR',    hora: '19:00' },
  { nome: 'SPS 102-M WarmUp',     hora: '14:00' },
];

test('casa o torneio exato pelo nome e horário', () => {
  const r = casarTorneio({ nome: 'SPS 102-M WarmUp', hora: '14:00' }, LISTAGEM);
  assert.equal(r.ok, true);
  assert.equal(r.escolhido.nome, 'SPS 102-M WarmUp');
  assert.equal(r.distancia, 0);
});

test('tolera diferença pequena de horário', () => {
  const r = casarTorneio({ nome: 'SPS 106-M OmaX HR', hora: '20:05' }, LISTAGEM);
  assert.equal(r.ok, true);
  assert.equal(r.escolhido.nome, 'SPS 106-M OmaX HR');
});

test('NÃO casa 47-H com 48-H: número do evento é identidade', () => {
  // o caso real: a legenda do Digisac cita "SPS 47-H Mystery HR" e a listagem
  // tem "SPS 48-H Mystery HR" no mesmo horário. Só o Dice casaria (0.75).
  const r = casarTorneio({ nome: 'SPS 47-H Mystery HR', hora: '19:00' }, LISTAGEM);
  assert.equal(r.ok, false, `casou errado com ${r.escolhido && r.escolhido.nome}`);
});

test('horário é porteiro: nome idêntico no horário errado não casa', () => {
  // às 20:00 existe candidato na janela (SPS 106-M OmaX HR), mas com nome
  // distante — e o homônimo verdadeiro (14:00) ficou fora. Recusa dos dois lados.
  const r = casarTorneio({ nome: 'SPS 102-M WarmUp', hora: '20:00' }, LISTAGEM);
  assert.equal(r.ok, false);
  assert.equal(r.escolhido, undefined);
});

test('janela vazia é dita explicitamente', () => {
  const r = casarTorneio({ nome: 'SPS 102-M WarmUp', hora: '03:00' }, LISTAGEM);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /dentro de 10min/);
});

test('recusa quando há empate — não chuta', () => {
  const duplicado = [
    { nome: 'SPS 102-M WarmUp', hora: '14:00', id: 'a' },
    { nome: 'SPS 102-M WarmUp', hora: '14:00', id: 'b' },
  ];
  const r = casarTorneio({ nome: 'SPS 102-M WarmUp', hora: '14:00' }, duplicado);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /ambíguo/);
});

test('listagem vazia não explode', () => {
  const r = casarTorneio({ nome: 'SPS 102-M WarmUp', hora: '14:00' }, []);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'listagem vazia');
});

test('normaliza vírgula decimal, cerquilha e traço do -H', () => {
  assert.equal(semelhanca('1,5K PLO5 PKO', '1.5K PLO5 PKO'), 1);
  assert.equal(normalizarNome('#AS 25K WarmUp'), 'as 25k warmup');
  assert.equal(normalizarNome('SPS 47-H Mystery HR'), 'sps 47h mystery hr');
});

test('tira acento', () => {
  assert.equal(normalizarNome('Satélite Turbo'), 'satelite turbo');
});

test('extrai horário grudado no fim do nome', () => {
  assert.equal(extrairHoraDoNome('#AS 25K WarmUp 14:00'), 14 * 60);
  assert.equal(extrairHoraDoNome('40K OmaX HR 20h'), 20 * 60);
  assert.equal(extrairHoraDoNome('SPS 102-M WarmUp'), null);
});

test('distância de horário atravessa a meia-noite', () => {
  assert.equal(distanciaMinutos('23:55', '00:05'), 10);
  assert.equal(distanciaMinutos('23:30', '00:53'), 83);
  assert.equal(distanciaMinutos('14:00', '14:00'), 0);
});

test('tokens numéricos identificam o evento, mas ignoram valor em K', () => {
  assert.deepEqual([...tokensNumericos('SPS 102-M WarmUp')], ['102']);
  assert.deepEqual([...tokensNumericos('SPS 47-H Mystery HR')], ['47h']);
  // 25K/40K é o garantido escrito no nome, não a identidade do evento
  assert.deepEqual([...tokensNumericos('#AS 25K WarmUp')], []);
  assert.deepEqual([...tokensNumericos('SPS 102-M 40K WarmUp')], ['102']);
});

test('casa mesmo quando a planilha põe o garantido no nome', () => {
  // caso real: a grade diz "SPS 102-M 40K WarmUp", o PokerByte diz "SPS 102-M WarmUp"
  const r = casarTorneio({ nome: 'SPS 102-M 40K WarmUp', hora: '14:00' }, LISTAGEM);
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.escolhido.nome, 'SPS 102-M WarmUp');
});

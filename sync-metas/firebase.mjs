/* =========================================================================
   Firebase por REST — sem SDK, sem service account.

   POR QUÊ REST
   ------------
   Não existe chave de service account neste repo (e nem poderia: ele é público).
   O app autentica operadores com signInWithEmailAndPassword, então o sync faz o
   mesmo: entra como uma CONTA DE ROBÔ e escreve com o idToken dela, sujeito às
   MESMAS regras do RTDB que valem pra qualquer operador. Nada de privilégio de
   admin escondido numa máquina.

   Configure no .env da pasta de ESTADO (%LOCALAPPDATA%\SupremaSyncMetas), fora do repo:
       FB_EMAIL=robo.metas@suprema.group
       FB_SENHA=...
   ========================================================================= */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ESTADO_DIR } from './_browser.mjs';

/* .env local — sem dependência de dotenv */
const ENV = (() => {
  const p = join(ESTADO_DIR, '.env');
  if (!existsSync(p)) return {};
  const out = {};
  for (const linha of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
})();

const cfg = k => process.env[k] || ENV[k] || null;

/* mesmos valores do suprema-db.js — são públicos por design (chave de cliente) */
export const API_KEY  = cfg('FB_API_KEY')  || 'AIzaSyAFy1GtRaJE3LHC1Rjtmq0uw2JC8bviXes';
export const RTDB_URL = cfg('FB_RTDB_URL') || 'https://design-1-53c00-default-rtdb.firebaseio.com';
export const BUCKET   = cfg('FB_BUCKET')   || 'design-1-53c00.firebasestorage.app';

let _token = null, _expira = 0;

export async function idToken(){
  if (_token && Date.now() < _expira - 60000) return _token;

  const email = cfg('FB_EMAIL'), senha = cfg('FB_SENHA');
  if (!email || !senha){
    throw new Error('Faltam FB_EMAIL/FB_SENHA no .env da pasta de estado (%LOCALAPPDATA%\SupremaSyncMetas).');
  }

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login Firebase falhou: ${j.error?.message || r.status}`);

  _token = j.idToken;
  _expira = Date.now() + Number(j.expiresIn || 3600) * 1000;
  return _token;
}

/* ---------- RTDB ---------- */

export async function rtdbGet(caminho){
  const t = await idToken();
  const r = await fetch(`${RTDB_URL}/${caminho}.json?auth=${t}`);
  if (!r.ok) throw new Error(`RTDB GET ${caminho}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function rtdbPut(caminho, valor){
  const t = await idToken();
  const r = await fetch(`${RTDB_URL}/${caminho}.json?auth=${t}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(valor),
  });
  if (!r.ok) throw new Error(`RTDB PUT ${caminho}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function rtdbPatch(caminho, patch){
  const t = await idToken();
  const r = await fetch(`${RTDB_URL}/${caminho}.json?auth=${t}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`RTDB PATCH ${caminho}: ${r.status} ${await r.text()}`);
  return r.json();
}

/* ---------- compare-and-set (para a trava de liderança) ----------
   O REST do RTDB não tem transaction, mas tem ETag: leio o valor com o ETag,
   escrevo com `if-match`. Se outra máquina escreveu no meio, volta 412 e eu perdi
   a disputa. Sem isso, duas máquinas "ganhariam" a liderança no mesmo instante e
   as duas martelariam o PokerByte. */
export async function rtdbGetComEtag(caminho){
  const t = await idToken();
  const r = await fetch(`${RTDB_URL}/${caminho}.json?auth=${t}`, {
    headers: { 'X-Firebase-ETag': 'true' },
  });
  if (!r.ok) throw new Error(`RTDB GET ${caminho}: ${r.status}`);
  return { valor: await r.json(), etag: r.headers.get('etag') };
}

/** @returns true se gravou; false se outro mudou antes (412) */
export async function rtdbPutSeIgual(caminho, valor, etag){
  const t = await idToken();
  const r = await fetch(`${RTDB_URL}/${caminho}.json?auth=${t}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag },
    body: JSON.stringify(valor),
  });
  if (r.status === 412) return false;          // perdeu a corrida
  if (!r.ok) throw new Error(`RTDB CAS ${caminho}: ${r.status} ${await r.text()}`);
  return true;
}

export async function rtdbDelete(caminho){
  const t = await idToken();
  const r = await fetch(`${RTDB_URL}/${caminho}.json?auth=${t}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`RTDB DELETE ${caminho}: ${r.status} ${await r.text()}`);
}

/* Storage NÃO é usado de propósito: o print vive como base64 no RTDB, sobrescrito
   a cada ciclo e apagado quando o torneio sai da janela. Assim não há arquivo
   acumulando, não há link público com token de download (que seria legível por
   quem tivesse a URL, contornando as regras) e não há CORS pra configurar. */

export function temCredenciais(){
  return !!(cfg('FB_EMAIL') && cfg('FB_SENHA'));
}

/* Quem é a conta que está escrevendo. Vai pro painel: com cada operador usando o
   PRÓPRIO login, mostrar o nome de quem sustenta o sync transforma "alguém
   instalou" em responsabilidade de uma pessoa. */
export function contaEmail(){
  return cfg('FB_EMAIL') || null;
}

/**
 * SUPREMA OS · COPILOTO (Claude) — backend independente.
 *
 * "Pergunte ao Suprema OS": o cliente (suprema-copiloto.js) manda a pergunta do
 * operador + um snapshot JSON do estado atual; esta função guarda a chave da
 * Anthropic (secret, nunca no repo público) e chama o Claude.
 *
 * NÃO tem nada a ver com o Pipefy — é uma Cloud Function própria, no mesmo
 * projeto Firebase (design-1-53c00), com o nome supremaCopiloto (pra a URL do
 * cliente continuar valendo).
 *
 * Gate: exige um ID token do Firebase Auth (operador logado) no header
 * Authorization — sem isso qualquer um queimaria tokens pagos da API.
 *
 * Deploy (uma vez):
 *   cd copiloto/functions && npm i
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase deploy --only functions:supremaCopiloto      # NÃO mexe em outras funções
 */
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.post("/", async (req, res) => {
  try {
    // ── gate: operador logado (ID token do Firebase Auth) ──
    const authz = req.get("Authorization") || "";
    const bearer = authz.match(/^Bearer (.+)$/);
    if (!bearer) return res.status(401).json({ error: "Faça login para usar o Copiloto." });
    try { await admin.auth().verifyIdToken(bearer[1]); }
    catch (e) { return res.status(401).json({ error: "Sessão expirada — entre de novo." }); }

    const question = String((req.body && req.body.question) || "").slice(0, 2000).trim();
    const snapshot = (req.body && req.body.snapshot) || {};
    const panel = String((req.body && req.body.panel) || "").slice(0, 40);
    if (!question) return res.status(400).json({ error: "Pergunta vazia." });

    const SDK = require("@anthropic-ai/sdk");
    const Anthropic = SDK.Anthropic || SDK.default || SDK;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const system = [
      "Você é o Copiloto do Suprema OS — o sistema de operação de uma sala de poker (torneios MTT e mesas cash).",
      "Responde perguntas do operador sobre o estado ATUAL da operação usando SOMENTE o snapshot JSON fornecido.",
      "Regras: direto e conciso, em português do Brasil. Dinheiro como R$ 1.234. Não repita a pergunta.",
      "Se a informação não estiver no snapshot, diga claramente que não tem esse dado — nunca invente números.",
      "Prefira respostas curtas: um parágrafo ou uma lista enxuta. Se a pergunta pedir conta (somar overlay, contar eventos), faça a conta a partir do snapshot e mostre o resultado.",
    ].join(" ");

    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages: [{
        role: "user",
        content: `Painel: ${panel || "?"}\n\nPergunta do operador:\n${question}\n\nSnapshot do estado atual (JSON):\n${JSON.stringify(snapshot).slice(0, 80000)}`,
      }],
    });

    const answer = (msg.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    res.json({ answer: answer || "Não consegui gerar uma resposta agora." });
  } catch (e) {
    console.error("[copiloto]", e && e.message);
    res.status(500).json({ error: "Erro no Copiloto — tente de novo em instantes." });
  }
});

exports.supremaCopiloto = onRequest(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", cors: true, timeoutSeconds: 120 },
  app
);

/**
 * Assistant IA Automatique (Google Gemini) avec Machine à États de Relais Humain ↔ IA :
 * - À l'ouverture d'une discussion : envoie un message non-IA (0 coût API) indiquant qu'une
 *   demande d'assistance humaine a été transmise.
 * - Si aucun admin n'a répondu au bout du délai configuré (60s par défaut) :
 *   l'IA envoie un message thématisé de prise de relais puis répond automatiquement au client.
 * - L'admin dispose à tout moment des actions :
 *   • "Reprendre le relais" (take_human) : coupe immédiatement l'IA et envoie un message thématisé.
 *   • "Perdre le relais" (release_to_ai) : laisse l'IA reprendre et envoie un message thématisé.
 */

import crypto from "node:crypto";
import { db } from "./db.js";
import { canonicalizeEmail } from "./security.js";

const FALLBACK_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite"
];

const relayTimers = new Map(); // threadId -> Timeout
const debounceTimers = new Map(); // threadId -> Timeout
const inFlightVersion = new Map(); // threadId -> relayVersion
const pendingFollowUp = new Set(); // threadIds that received a new customer message while AI was generating

let deps = {
  broadcastDiscussion: null,
  broadcastOrder: null,
  broadcastAdmin: null,
  enrichThreadForAdmin: null
};

export function initAiAssistant(injected = {}) {
  deps = { ...deps, ...injected };
  rehydratePendingRelayTimers();
  setInterval(sweepDueRelays, 5000).unref?.();
}

function getAiSettings() {
  const ai = db.data?.settings?.ai || {};
  return {
    enabled: ai.enabled !== false,
    apiKey: String(ai.apiKey || process.env.GEMINI_API_KEY || "").trim(),
    model: String(ai.model || process.env.GEMINI_MODEL || "gemini-flash-lite-latest").trim() || "gemini-flash-lite-latest",
    delaySeconds: Math.max(5, Math.min(600, Number(ai.delaySeconds) || 60))
  };
}

function ensureAiControl(thread) {
  if (!thread.aiControl || typeof thread.aiControl !== "object") {
    thread.aiControl = {
      mode: "human_active",
      humanRequestedAt: null,
      relayDueAt: null,
      aiTakeoverAt: null,
      humanTakeoverAt: null,
      lastAiReplyAt: null,
      relayVersion: 0
    };
  }
  if (typeof thread.aiControl.relayVersion !== "number") {
    thread.aiControl.relayVersion = 0;
  }
  return thread.aiControl;
}

function clearThreadTimers(threadId) {
  if (relayTimers.has(threadId)) {
    clearTimeout(relayTimers.get(threadId));
    relayTimers.delete(threadId);
  }
  if (debounceTimers.has(threadId)) {
    clearTimeout(debounceTimers.get(threadId));
    debounceTimers.delete(threadId);
  }
}

function buildRelayMessage(relayEvent, delaySeconds = 60) {
  const nowIso = new Date().toISOString();
  const texts = {
    human_requested: `📩 Demande d'assistance humaine envoyée ! Un conseiller NEXUS a été alerté en priorité. S'il n'est pas disponible sous ${delaySeconds}s, notre assistant IA prendra automatiquement le relais pour vous aider.`,
    ai_takeover:
      "🤖 Aucun conseiller humain n'a pu répondre dans la minute — l'assistant IA NEXUS prend le relais pour vous aider immédiatement.",
    human_takeover:
      "👤 Un conseiller humain reprend le relais de la conversation. L'assistant IA est mis en pause.",
    ai_resume:
      "🤖 Le conseiller humain a passé le relais — l'assistant IA NEXUS reprend le relais pour continuer à vous aider."
  };
  return {
    id: `dmsg_relay_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
    sender: "relay",
    relayEvent,
    text: texts[relayEvent] || texts.human_requested,
    createdAt: nowIso
  };
}

function syncRelayOrAiMessageToLinkedOrder(thread, msg) {
  if (!thread.orderId) return;
  const ord = db.data.orders.find((o) => o.orderId === thread.orderId);
  if (!ord) return;
  ord.messages = ord.messages || [];
  ord.messages.push({
    id: `ord_${msg.id}`,
    sender: msg.sender,
    relayEvent: msg.relayEvent || undefined,
    text: msg.text,
    createdAt: msg.createdAt
  });
  ord.updatedAt = msg.createdAt;
  deps.broadcastOrder?.(ord.orderId, "new_message", ord);
}

function broadcastThreadUpdate(thread, eventName = "new_message") {
  deps.broadcastDiscussion?.(thread.threadId, eventName, thread);
}

function scheduleRelayTimerForThread(thread) {
  clearThreadTimers(thread.threadId);
  const ctrl = ensureAiControl(thread);
  if (ctrl.mode !== "waiting_human" || !ctrl.relayDueAt || thread.status === "resolved") return;

  const delayMs = Math.max(0, new Date(ctrl.relayDueAt).getTime() - Date.now());
  const expectedVersion = ctrl.relayVersion;

  const timer = setTimeout(() => {
    relayTimers.delete(thread.threadId);
    executeAiTakeover(thread.threadId, expectedVersion).catch((err) => {
      console.error("[AI Relay Takeover Error]", err.message);
    });
  }, delayMs);
  timer.unref?.();
  relayTimers.set(thread.threadId, timer);
}

function rehydratePendingRelayTimers() {
  for (const t of db.data.discussions || []) {
    if (t.aiControl?.mode === "waiting_human" && t.status !== "resolved") {
      scheduleRelayTimerForThread(t);
    }
  }
}

function sweepDueRelays() {
  const now = Date.now();
  for (const t of db.data.discussions || []) {
    if (
      t.status !== "resolved" &&
      t.aiControl?.mode === "waiting_human" &&
      t.aiControl.relayDueAt &&
      new Date(t.aiControl.relayDueAt).getTime() <= now
    ) {
      executeAiTakeover(t.threadId, t.aiControl.relayVersion).catch(() => {});
    }
  }
}

function buildSystemInstructionForThread(thread) {
  const products = (db.data.products || [])
    .filter((p) => p.active !== false)
    .map(
      (p) =>
        `- ${p.title} : ${p.price} € (${p.duration || "12 mois"}), dispo: ${p.availability === "out_of_stock" ? "Rupture" : p.availability === "low_stock" ? "Stock limité" : "En stock"}, activation: ${p.activationFormat || "Livraison directe + e-mail"}`
    )
    .join("\n");

  const cleanEmail = canonicalizeEmail(thread.customerEmail || "");
  const linkedOrders = (db.data.orders || [])
    .filter(
      (o) =>
        (thread.orderId && o.orderId === thread.orderId) ||
        (cleanEmail && canonicalizeEmail(o.email) === cleanEmail) ||
        (thread.userId && o.userId === thread.userId)
    )
    .slice(0, 3)
    .map(
      (o) =>
        `• Commande #${o.orderId} (${o.dossierId || `DOS-${o.orderId.replace(/^NX-/, "")}`}) — Total: ${o.total} €, Paiement: ${o.paymentStatus} (${o.paymentMethod}), Livraison: ${o.deliveryStatus}, Date: ${o.createdAt}`
    )
    .join("\n");

  return [
    `Tu es l'assistant IA officiel du support client de NEXUS SUBS (boutique d'abonnements numériques 12 mois).`,
    `Tu interviens en relais temporaire en attendant qu'un conseiller humain reprenne la conversation.`,
    `RÈGLES STRICTES DE SÉCURITÉ & DE COMPORTEMENT :`,
    `1. Réponds toujours en français clair, chaleureux, rassurant et concis (maximum 4 à 6 phrases, va à l'essentiel).`,
    `2. N'INVENTE JAMAIS d'identifiants, de mots de passe, de codes PIN, de liens d'invitation, ni de confirmation de paiement bancaire.`,
    `3. Ne promets jamais d'accès gratuit, de remboursement automatique ou d'envoi avant vérification humaine du paiement.`,
    `4. Si le client dit avoir perdu son bien, ses accès, fermé sa page ou fait une erreur d'e-mail : rassure-le immédiatement (les achats sont tracés dans nos Dossiers avec sauvegarde permanente) et demande-lui les indices utiles pour l'administrateur s'ils manquent : numéro de commande (#NX-...), adresse e-mail utilisée, nom du titulaire bancaire/PayPal, montant et moyen de paiement ; indique aussi le bouton « Mes Accès » ou « Secours Paiement ».`,
    `5. Ne divulgue jamais d'informations sur d'autres clients ni aucune clé ou détail technique interne.`,
    ``,
    `CATALOGUE ACTUEL NEXUS SUBS :`,
    products || "- Offres disponibles sur le catalogue du site.",
    ``,
    `PAIEMENTS & LIVRAISON :`,
    `- Moyens acceptés : Stripe (CB / Apple Pay / Google Pay), PayPal, Virement SEPA Instantané 10s avec QR Code bancaire.`,
    `- Livraison dans le coffre sécurisé chiffré (« Mes Accès ») + par e-mail après confirmation du règlement. Garantie continuité 365 jours incluse.`,
    `- Sujet actuel de cette discussion : ${thread.topicLabel || "Question générale"}.`,
    linkedOrders ? `\nCOMMANDES LIÉES À CE CLIENT (statut uniquement) :\n${linkedOrders}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConversationContents(thread) {
  const relevant = (thread.messages || []).filter((m) => m.sender === "customer" || m.sender === "admin" || m.sender === "ai");
  const recent = relevant.slice(-14);
  const contents = [];
  for (const m of recent) {
    const role = m.sender === "customer" ? "user" : "model";
    const text = String(m.text || "").trim();
    if (!text) continue;
    // Gemini exige une alternance propre ou fusion des messages consécutifs du même rôle
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Bonjour, j'ai besoin d'aide." }] });
  } else if (contents[0].role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "Bonjour" }] });
  }
  return contents;
}

export async function callGeminiApi({ apiKey, model, systemInstruction, contents }) {
  const candidates = Array.from(new Set([model, ...FALLBACK_MODELS].filter(Boolean)));
  let lastError = "Aucun modèle Gemini disponible.";

  for (const mName of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 1024
          }
        }),
        signal: AbortSignal.timeout(25_000)
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        lastError = data?.error?.message || `HTTP ${resp.status} (${mName})`;
        // En cas de 401/403 clé invalide, inutile de boucler
        if (resp.status === 401 || resp.status === 403) {
          return { ok: false, error: lastError, model: mName };
        }
        continue;
      }

      const parts = data?.candidates?.[0]?.content?.parts || [];
      const replyText = parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
        .trim();

      if (replyText) {
        return { ok: true, text: replyText, model: mName };
      }
      lastError = `Réponse vide du modèle ${mName}`;
    } catch (err) {
      lastError = err.message || String(err);
    }
  }

  return { ok: false, error: lastError, model: candidates[0] };
}

export async function testGeminiConnection(overrideApiKey = "", overrideModel = "") {
  const cfg = getAiSettings();
  const apiKey = String(overrideApiKey || cfg.apiKey || "").trim();
  const model = String(overrideModel || cfg.model || "gemini-flash-lite-latest").trim();
  if (!apiKey) {
    return { ok: false, error: "Aucune clé API Gemini configurée." };
  }
  const t0 = Date.now();
  const res = await callGeminiApi({
    apiKey,
    model,
    systemInstruction: "Tu es l'assistant support NEXUS SUBS. Réponds en une courte phrase de confirmation en français.",
    contents: [{ role: "user", parts: [{ text: "Test de connexion du relais IA NEXUS." }] }]
  });
  return {
    ...res,
    latencyMs: Date.now() - t0
  };
}

async function generateAndPostAiReply(threadId, expectedVersion) {
  const thread = db.data.discussions.find((t) => t.threadId === threadId);
  if (!thread || thread.status === "resolved") return;

  const ctrl = ensureAiControl(thread);
  if (ctrl.mode !== "ai_active" || ctrl.relayVersion !== expectedVersion) return;

  const cfg = getAiSettings();
  if (!cfg.enabled) return;
  if (!cfg.apiKey) {
    const errMsg = "Clé API Gemini manquante sur le serveur (ajoutez-la dans Admin > Téléphone, IA & Paiements).";
    db.data.settings.ai = db.data.settings.ai || {};
    db.data.settings.ai.lastError = errMsg;
    ctrl.lastError = errMsg;
    console.warn("[AI Reply Blocked]", errMsg);
    db.save();
    broadcastThreadUpdate(thread, "discussion_updated");
    return;
  }

  if (inFlightVersion.get(threadId) === expectedVersion) {
    pendingFollowUp.add(threadId);
    return;
  }
  inFlightVersion.set(threadId, expectedVersion);

  try {
    const result = await callGeminiApi({
      apiKey: cfg.apiKey,
      model: cfg.model,
      systemInstruction: buildSystemInstructionForThread(thread),
      contents: buildConversationContents(thread)
    });

    // Re-vérifier après l'appel réseau : l'admin a peut-être repris le relais entre-temps !
    const freshThread = db.data.discussions.find((t) => t.threadId === threadId);
    if (!freshThread || freshThread.status === "resolved") return;
    const freshCtrl = ensureAiControl(freshThread);
    if (freshCtrl.mode !== "ai_active" || freshCtrl.relayVersion !== expectedVersion) {
      return;
    }

    if (!result.ok || !result.text) {
      db.data.settings.ai = db.data.settings.ai || {};
      db.data.settings.ai.lastError = result.error || "Erreur Gemini inconnue";
      freshCtrl.lastError = result.error || "Erreur Gemini inconnue";
      console.warn("[AI Reply Skipped]", result.error);
      db.save();
      broadcastThreadUpdate(freshThread, "discussion_updated");
      return;
    }

    if (db.data.settings.ai) db.data.settings.ai.lastError = "";
    freshCtrl.lastError = "";

    const nowIso = new Date().toISOString();
    const aiMsg = {
      id: `dmsg_ai_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
      sender: "ai",
      aiModel: result.model,
      text: result.text.slice(0, 1800),
      createdAt: nowIso
    };
    freshThread.messages.push(aiMsg);
    freshThread.updatedAt = nowIso;
    freshThread.unreadByCustomer = (freshThread.unreadByCustomer || 0) + 1;
    freshCtrl.lastAiReplyAt = nowIso;

    syncRelayOrAiMessageToLinkedOrder(freshThread, aiMsg);
    db.save();
    broadcastThreadUpdate(freshThread, "new_message");
  } finally {
    if (inFlightVersion.get(threadId) === expectedVersion) {
      inFlightVersion.delete(threadId);
    }
    if (pendingFollowUp.has(threadId)) {
      pendingFollowUp.delete(threadId);
      const tNow = db.data.discussions.find((t) => t.threadId === threadId);
      if (tNow && tNow.status !== "resolved" && tNow.aiControl?.mode === "ai_active" && tNow.aiControl.relayVersion === expectedVersion) {
        const nonMeta = (tNow.messages || []).filter((m) => m.sender === "customer" || m.sender === "admin" || m.sender === "ai");
        if (nonMeta[nonMeta.length - 1]?.sender === "customer") {
          setTimeout(() => {
            generateAndPostAiReply(threadId, expectedVersion).catch(() => {});
          }, 400).unref?.();
        }
      }
    }
  }
}

export function checkThreadRelayDue(thread) {
  if (!thread || thread.status === "resolved") return;
  if (
    thread.aiControl?.mode === "waiting_human" &&
    thread.aiControl.relayDueAt &&
    new Date(thread.aiControl.relayDueAt).getTime() <= Date.now()
  ) {
    executeAiTakeover(thread.threadId, thread.aiControl.relayVersion).catch(() => {});
  }
}

async function executeAiTakeover(threadId, expectedVersion) {
  const thread = db.data.discussions.find((t) => t.threadId === threadId);
  if (!thread || thread.status === "resolved") return;

  const ctrl = ensureAiControl(thread);
  if (ctrl.mode !== "waiting_human" || ctrl.relayVersion !== expectedVersion) return;

  const cfg = getAiSettings();
  if (!cfg.enabled) return;

  // Vérifier qu'aucun admin n'a répondu depuis l'ouverture de l'attente
  const waitMs = ctrl.humanRequestedAt ? new Date(ctrl.humanRequestedAt).getTime() : 0;
  const adminRepliedSince = (thread.messages || []).some(
    (m) => m.sender === "admin" && new Date(m.createdAt).getTime() >= waitMs
  );
  if (adminRepliedSince) {
    ctrl.mode = "human_active";
    ctrl.relayDueAt = null;
    db.save();
    return;
  }

  const nowIso = new Date().toISOString();
  ctrl.mode = "ai_active";
  ctrl.aiTakeoverAt = nowIso;
  ctrl.relayDueAt = null;
  ctrl.relayVersion += 1;

  const relayMsg = buildRelayMessage("ai_takeover", cfg.delaySeconds);
  thread.messages.push(relayMsg);
  thread.updatedAt = nowIso;
  thread.unreadByCustomer = (thread.unreadByCustomer || 0) + 1;

  syncRelayOrAiMessageToLinkedOrder(thread, relayMsg);
  db.save();
  broadcastThreadUpdate(thread, "new_message");

  await generateAndPostAiReply(thread.threadId, ctrl.relayVersion);
}

/**
 * Appelé à chaque nouveau message envoyé par le client dans une discussion :
 * - À l'ouverture : envoie un message non-IA (0 coût API) puis arme le timer 1 minute.
 * - Si l'IA est déjà en relais actif : programme sa réponse Gemini (avec léger anti-rebond).
 * - Si l'humain a le relais : ne déclenche rien.
 */
export function onCustomerMessageInThread(thread, { isNewThread = false } = {}) {
  if (!thread) return;
  const cfg = getAiSettings();
  const ctrl = ensureAiControl(thread);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!cfg.enabled) {
    if (isNewThread && !ctrl.humanRequestedAt) {
      ctrl.mode = "human_active";
      ctrl.humanRequestedAt = nowIso;
    }
    return;
  }

  const hasHumanReqMsg = (thread.messages || []).some(
    (m) => m.sender === "relay" && m.relayEvent === "human_requested"
  );

  if (isNewThread || (!hasHumanReqMsg && !ctrl.aiTakeoverAt && !ctrl.humanTakeoverAt && ctrl.mode !== "ai_active")) {
    ctrl.mode = "waiting_human";
    ctrl.humanRequestedAt = nowIso;
    ctrl.relayDueAt = new Date(nowMs + cfg.delaySeconds * 1000).toISOString();
    ctrl.relayVersion += 1;

    // Message initial NON-IA pour économiser l'API
    const reqMsg = buildRelayMessage("human_requested", cfg.delaySeconds);
    thread.messages = thread.messages || [];
    thread.messages.push(reqMsg);
    thread.updatedAt = nowIso;
    syncRelayOrAiMessageToLinkedOrder(thread, reqMsg);
    scheduleRelayTimerForThread(thread);
    return;
  }

  if (ctrl.mode === "waiting_human") {
    // Timer déjà actif : ne pas re-poster ni consommer d'API
    if (!relayTimers.has(thread.threadId)) {
      scheduleRelayTimerForThread(thread);
    }
    return;
  }

  if (ctrl.mode === "ai_active") {
    clearThreadTimers(thread.threadId);
    const ver = ctrl.relayVersion;
    const t = setTimeout(() => {
      debounceTimers.delete(thread.threadId);
      generateAndPostAiReply(thread.threadId, ver).catch((err) => {
        console.error("[AI Reply Error]", err.message);
      });
    }, 1100);
    t.unref?.();
    debounceTimers.set(thread.threadId, t);
  }
}

/**
 * Bascule manuelle ou automatique du relais :
 * - "take_human" : Admin clique "Reprendre le relais" (ou répond manuellement) -> l'IA s'arrête + message thématisé.
 * - "release_to_ai" : Admin clique "Perdre le relais" -> l'IA reprend + message thématisé (+ réponse si dernier msg client sans réponse).
 */
export function setThreadRelayMode(thread, action, { triggeredByMessage = false } = {}) {
  if (!thread) return null;
  const ctrl = ensureAiControl(thread);
  const nowIso = new Date().toISOString();

  if (action === "take_human") {
    const alreadyHuman = ctrl.mode === "human_active";
    if (alreadyHuman && triggeredByMessage) return null;

    clearThreadTimers(thread.threadId);
    ctrl.mode = "human_active";
    ctrl.humanTakeoverAt = nowIso;
    ctrl.relayDueAt = null;
    ctrl.relayVersion += 1;

    if (!alreadyHuman) {
      const relayMsg = buildRelayMessage("human_takeover");
      thread.messages = thread.messages || [];
      thread.messages.push(relayMsg);
      thread.updatedAt = nowIso;
      thread.unreadByCustomer = (thread.unreadByCustomer || 0) + 1;
      syncRelayOrAiMessageToLinkedOrder(thread, relayMsg);

      if (!triggeredByMessage) {
        db.save();
        broadcastThreadUpdate(thread, "new_message");
      }
      return relayMsg;
    }
    return null;
  }

  if (action === "release_to_ai") {
    const alreadyAi = ctrl.mode === "ai_active";
    clearThreadTimers(thread.threadId);
    ctrl.mode = "ai_active";
    ctrl.aiTakeoverAt = nowIso;
    ctrl.relayDueAt = null;
    ctrl.relayVersion += 1;

    let relayMsg = null;
    if (!alreadyAi) {
      relayMsg = buildRelayMessage("ai_resume");
      thread.messages = thread.messages || [];
      thread.messages.push(relayMsg);
      thread.updatedAt = nowIso;
      thread.unreadByCustomer = (thread.unreadByCustomer || 0) + 1;
      syncRelayOrAiMessageToLinkedOrder(thread, relayMsg);
    }

    db.save();
    broadcastThreadUpdate(thread, "new_message");

    // Si le dernier échange réel vient du client sans réponse admin/ai depuis, l'IA répond immédiatement
    const nonMeta = (thread.messages || []).filter((m) => m.sender === "customer" || m.sender === "admin" || m.sender === "ai");
    const lastReal = nonMeta[nonMeta.length - 1];
    if (lastReal && lastReal.sender === "customer") {
      const ver = ctrl.relayVersion;
      generateAndPostAiReply(thread.threadId, ver).catch((err) => {
        console.error("[AI Resume Reply Error]", err.message);
      });
    }

    return relayMsg;
  }

  return null;
}

export function sanitizeAiControlForCustomer(aiControl) {
  if (!aiControl || typeof aiControl !== "object") return null;
  return {
    mode: aiControl.mode || "waiting_human",
    humanRequestedAt: aiControl.humanRequestedAt || null,
    relayDueAt: aiControl.relayDueAt || null,
    aiTakeoverAt: aiControl.aiTakeoverAt || null,
    humanTakeoverAt: aiControl.humanTakeoverAt || null
  };
}

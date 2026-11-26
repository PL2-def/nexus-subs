/**
 * Moteur Anti-Fraude & Diagnostic Intelligent des Discussions Client :
 * Calcule automatiquement les indicateurs :
 * - 🚨 "Suspecté de fraude" (score de risque + raisons détaillées)
 * - ⏳ "En attente depuis X min / h"
 * - 😤 "Client agacé" (détection linguistique & ponctuation)
 * - ⚡ "Nécessite de l'aide rapide" (urgence paiement, blocage technique, attente longue)
 */

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "yopmail.com",
  "yopmail.fr",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "guerrillamail.com",
  "sharklasers.com",
  "mailinator.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "mohmal.com",
  "jetable.org",
  "fakeinbox.com",
  "throwawaymail.com"
]);

const ANNOYED_PATTERNS = [
  /\barnaque/i,
  /\bescroc/i,
  /\bvoleur/i,
  /\bhonte/i,
  /\bscandale/i,
  /\binadmissible/i,
  /\brembours/i,
  /\bplainte\b/i,
  /\blitige\b/i,
  /\bmarre\b/i,
  /\babus[ée]/i,
  /\bnul\b/i,
  /personne (ne )?r[ée]pond/i,
  /toujours rien/i,
  /[çc]a fait \d+/i,
  /\bfurieux/i,
  /\bm[ée]content/i,
  /[!]{3,}/,
  /[?]{3,}/
];

const URGENT_HELP_PATTERNS = [
  /\burgent/i,
  /\baide(-|\s)?moi/i,
  /\bbloqu[ée]/i,
  /\bbug\b/i,
  /\berreur\b/i,
  /marche pas/i,
  /fonctionne pas/i,
  /pay[ée] mais/i,
  /d[ée]bit[ée]/i,
  /virement fait/i,
  /perdu mon argent/i,
  /rien re[çc]u/i,
  /code invalide/i,
  /mot de passe incorrect/i,
  /\bsvp vite\b/i,
  /\bau secours\b/i
];

const FRAUD_CHAT_PATTERNS = [
  /chargeback/i,
  /opposition bancaire/i,
  /faux virement/i,
  /gratuitement/i,
  /donne(-|\s)?moi un compte gratuit/i,
  /test gratuit/i,
  /http(s)?:\/\/(?!(families\.google\.com|paypal\.me|checkout\.stripe\.com))/i
];

export function isDisposableEmail(email) {
  const domain = String(email || "").split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/**
 * Évalue le risque de fraude lors d'une création de commande ou déclaration de paiement
 */
export function evaluateOrderFraud({
  email,
  customerName,
  total,
  totalQuantity,
  clientHash,
  formFillMs = null,
  honeypot = "",
  existingOrders = [],
  blockedEmails = [],
  blockedHashes = []
}) {
  let score = 0;
  const reasons = [];
  const cleanEmail = String(email || "").toLowerCase().trim();

  if (honeypot && String(honeypot).trim() !== "") {
    return {
      score: 100,
      blocked: true,
      reasons: ["Champ anti-bot déclenché"]
    };
  }

  if (blockedEmails.includes(cleanEmail) || (clientHash && blockedHashes.includes(clientHash))) {
    return {
      score: 100,
      blocked: true,
      reasons: ["Client ou connexion figurant sur la liste de blocage sécurité"]
    };
  }

  if (isDisposableEmail(cleanEmail)) {
    score += 45;
    reasons.push("Adresse e-mail jetable / temporaire détectée");
  }

  if (typeof formFillMs === "number" && formFillMs > 0 && formFillMs < 1200) {
    score += 50;
    reasons.push("Formulaire soumis à une vitesse robotique (< 1,2s)");
  }

  if (/^(test|azerty|qwerty|aaa|xxx|fake)/i.test(String(customerName || "").trim())) {
    score += 15;
    reasons.push("Nom client inhabituel ou générique");
  }

  // Vélocité depuis la même empreinte réseau sur les 45 dernières minutes
  if (clientHash) {
    const recentCutoff = Date.now() - 45 * 60 * 1000;
    const recentSameOrigin = existingOrders.filter(
      (o) => o.clientHash === clientHash && new Date(o.createdAt).getTime() > recentCutoff
    );
    const unpaidRecent = recentSameOrigin.filter((o) => o.paymentStatus !== "paid");
    const distinctEmails = new Set(recentSameOrigin.map((o) => o.email.toLowerCase()));

    if (unpaidRecent.length >= 3) {
      score += 40;
      reasons.push(`${unpaidRecent.length} commandes non réglées créées récemment depuis cette même connexion`);
    }
    if (distinctEmails.size >= 3) {
      score += 35;
      reasons.push(`${distinctEmails.size} adresses e-mail différentes utilisées sur la même connexion`);
    }
  }

  if (total >= 350 || totalQuantity >= 4) {
    score += 20;
    reasons.push(`Panier élevé à vérifier (${total} € / ${totalQuantity} articles)`);
  }

  score = Math.min(100, score);
  return {
    score,
    blocked: score >= 90,
    reasons
  };
}

/**
 * Vérifie si une déclaration manuelle "J'ai payé" (SEPA / PayPal.Me) est suspecte
 */
export function evaluateFastDeclarationFraud(order) {
  const createdMs = new Date(order.createdAt).getTime();
  const elapsedSec = Math.round((Date.now() - createdMs) / 1000);
  if (elapsedSec < 9) {
    return {
      suspicious: true,
      addedScore: 45,
      reason: `Déclaration de virement cliquée en seulement ${elapsedSec}s (vérifiez impérativement votre banque avant d'envoyer les accès)`
    };
  }
  return { suspicious: false, addedScore: 0, reason: null };
}

/**
 * Formate une durée d'attente claire en français ("En attente depuis 14 min", "En attente depuis 1h 20min")
 */
export function formatWaitingDuration(waitingSinceIso, nowMs = Date.now()) {
  if (!waitingSinceIso) return null;
  const diffMs = Math.max(0, nowMs - new Date(waitingSinceIso).getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "En attente depuis < 1 min";
  if (mins < 60) return `En attente depuis ${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `En attente depuis ${hours}h ${remMins}min` : `En attente depuis ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `En attente depuis ${days}j ${hours % 24}h`;
}

/**
 * Calcule l'ensemble des badges de diagnostic précis d'un fil de discussion pour le menu Admin "Discussions"
 */
export function computeDiscussionDiagnostics(thread, allOrders = [], nowMs = Date.now()) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const customerMessages = messages.filter((m) => m.sender === "customer");
  const lastMsg = messages[messages.length - 1] || null;
  const isResolved = thread.status === "resolved";

  // 1. Calcul du temps d'attente depuis le premier message client resté sans réponse admin
  let waitingSince = null;
  if (!isResolved && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "admin") break;
      if (messages[i].sender === "customer") {
        waitingSince = messages[i].createdAt;
      }
    }
  }

  const waitingMinutes = waitingSince ? Math.floor((nowMs - new Date(waitingSince).getTime()) / 60000) : 0;
  const waitingLabel = waitingSince ? formatWaitingDuration(waitingSince, nowMs) : null;
  const waitingLevel = !waitingSince
    ? "none"
    : waitingMinutes >= 15
    ? "critical"
    : waitingMinutes >= 5
    ? "warning"
    : "normal";

  // Commandes associées à ce client (par orderId lié, par email ou par empreinte)
  const cleanEmail = (thread.customerEmail || "").toLowerCase().trim();
  const linkedOrders = allOrders.filter(
    (o) =>
      (thread.orderId && o.orderId === thread.orderId) ||
      (cleanEmail && o.email.toLowerCase() === cleanEmail) ||
      (thread.clientHash && o.clientHash && o.clientHash === thread.clientHash)
  );

  // 2. Détection "Suspecté de fraude"
  const fraudReasons = [...(thread.fraudReasons || [])];
  let riskScore = Number(thread.riskScore || 0);

  if (cleanEmail && isDisposableEmail(cleanEmail) && !fraudReasons.some((r) => r.includes("jetable"))) {
    riskScore += 45;
    fraudReasons.push("E-mail jetable / temporaire utilisé dans la discussion");
  }

  for (const ord of linkedOrders) {
    if ((ord.riskScore || 0) >= 40) {
      riskScore = Math.max(riskScore, ord.riskScore);
      for (const r of ord.fraudReasons || []) {
        if (!fraudReasons.includes(r)) fraudReasons.push(r);
      }
    }
  }

  const combinedCustomerText = customerMessages.map((m) => m.text || "").join(" \n ");
  for (const pat of FRAUD_CHAT_PATTERNS) {
    if (pat.test(combinedCustomerText)) {
      riskScore += 35;
      const msg = "Message contenant un lien externe ou des termes suspects (chargeback / demande gratuite)";
      if (!fraudReasons.includes(msg)) fraudReasons.push(msg);
      break;
    }
  }

  const isSuspectedFraud =
    thread.manualFlags?.fraud === true
      ? true
      : thread.manualFlags?.fraud === false
      ? false
      : riskScore >= 40;

  if (thread.manualFlags?.fraud === true && fraudReasons.length === 0) {
    fraudReasons.push("Marqué manuellement comme suspect par l'administrateur");
  }

  // 3. Détection "Client agacé"
  let autoAnnoyed = false;
  for (const cm of customerMessages.slice(-5)) {
    const txt = String(cm.text || "");
    if (ANNOYED_PATTERNS.some((p) => p.test(txt))) {
      autoAnnoyed = true;
      break;
    }
    const letters = txt.replace(/[^a-zA-ZÀ-ÿ]/g, "");
    if (letters.length >= 14) {
      const upper = letters.replace(/[^A-ZÀ-Ý]/g, "").length;
      if (upper / letters.length > 0.65) {
        autoAnnoyed = true;
        break;
      }
    }
  }

  const isAnnoyed =
    thread.manualFlags?.annoyed === true
      ? true
      : thread.manualFlags?.annoyed === false
      ? false
      : autoAnnoyed;

  // 4. Détection "Nécessite de l'aide rapide"
  const hasPendingPaidOrder = linkedOrders.some(
    (o) => (o.paymentStatus === "paid" || o.paymentStatus === "declaration_sent") && o.deliveryStatus !== "delivered"
  );
  const hasUrgentKeywords = customerMessages
    .slice(-4)
    .some((m) => URGENT_HELP_PATTERNS.some((p) => p.test(m.text || "")));

  const autoFastHelp =
    !isResolved &&
    (thread.topicType === "rescue" ||
      isAnnoyed ||
      hasPendingPaidOrder ||
      hasUrgentKeywords ||
      waitingMinutes >= 10);

  const needsFastHelp =
    thread.manualFlags?.fastHelp === true
      ? true
      : thread.manualFlags?.fastHelp === false
      ? false
      : autoFastHelp;

  // Score de tri par priorité pour remonter les urgences en haut du menu Discussion
  let priorityScore = 0;
  if (!isResolved) {
    priorityScore += 100;
    if (waitingSince) priorityScore += 200 + Math.min(180, waitingMinutes * 4);
    if (needsFastHelp) priorityScore += 300;
    if (isAnnoyed) priorityScore += 220;
    if (thread.topicType === "rescue") priorityScore += 350;
    if (isSuspectedFraud) priorityScore += 90;
  }

  return {
    isResolved,
    waitingSince,
    waitingMinutes,
    waitingLabel,
    waitingLevel,
    isSuspectedFraud,
    riskScore: Math.min(100, riskScore),
    fraudReasons,
    isAnnoyed,
    needsFastHelp,
    hasPendingPaidOrder,
    linkedOrderIds: linkedOrders.map((o) => o.orderId),
    lastMessagePreview: lastMsg ? lastMsg.text.slice(0, 95) : "Discussion démarrée",
    lastActivityAt: lastMsg ? lastMsg.createdAt : thread.createdAt,
    unreadByAdmin: Number(thread.unreadByAdmin || 0),
    priorityScore
  };
}

/**
 * Moteur Anti-Fraude Multi-Dimensionnel (6 dimensions + suivi site complet)
 * & Système de Flags Précis pour le Centre de Contrôle Admin :
 *
 * Dimensions du score de risque (0-100) + indice de confiance (0-100%) :
 *  1. Identité & E-mail (domaines jetables, entropie Shannon, alias Gmail, incohérence nom)
 *  2. Comportement & Suivi sur le site (bot/headless, vitesse, rush checkout, coupon/lookup/login probing)
 *  3. Vélocité & Graphe Multi-Comptes (même réseau, même appareil, alias multiples, décroissance temporelle)
 *  4. Paiement & Transactions (déclaration ultra-rapide, impayés répétés, panier atypique, faux secours)
 *  5. Linguistique & Ingénierie Sociale (menace chargeback, pression livraison avant paiement, liens suspects, spam)
 *  6. Modificateur de Confiance (historique payé vérifié, ancienneté compte, navigation humaine organique, whitelist)
 */

import { canonicalizeEmail, getCanonicalEmailKey } from "./security.js";

export const FLAG_DEFINITIONS = [
  // --- SÉCURITÉ & ANTI-FRAUDE ---
  {
    id: "fraud_critical",
    category: "fraud",
    icon: "🚨",
    label: "Fraude Critique",
    shortLabel: "Fraude Critique",
    severity: "critical",
    colorClass: "diag-fraud-critical",
    manualToggleable: true,
    description: "Score anti-fraude ≥ 70 : ne jamais livrer avant vérification bancaire irréfutable."
  },
  {
    id: "fraud_risk",
    category: "fraud",
    icon: "⚠️",
    label: "Risque de Fraude",
    shortLabel: "Risque Fraude",
    severity: "high",
    colorClass: "diag-fraud",
    manualToggleable: true,
    description: "Score anti-fraude entre 45 et 69 : vérification renforcée recommandée."
  },
  {
    id: "fraud_watch",
    category: "fraud",
    icon: "👁️",
    label: "Sous Surveillance",
    shortLabel: "Surveillance",
    severity: "medium",
    colorClass: "diag-watch",
    manualToggleable: true,
    description: "Signaux atypiques modérés (score 25-44) à garder à l'œil."
  },
  {
    id: "bot_automation",
    category: "fraud",
    icon: "🤖",
    label: "Bot / Automatisation",
    shortLabel: "Bot / Script",
    severity: "critical",
    colorClass: "diag-fraud-critical",
    manualToggleable: true,
    description: "Honeypot, webdriver, vitesse robotique ou absence totale d'interactions humaines."
  },
  {
    id: "fast_fake_payment",
    category: "fraud",
    icon: "⏱️",
    label: "Fausse Déclaration Rapide",
    shortLabel: "Déclaration Rapide",
    severity: "critical",
    colorClass: "diag-fraud-critical",
    manualToggleable: true,
    description: "Bouton « J'ai payé » cliqué trop vite (< 20s) ou déclarations non encaissées répétées."
  },
  {
    id: "multi_account",
    category: "fraud",
    icon: "👥",
    label: "Multi-Comptes / Alias",
    shortLabel: "Multi-Comptes",
    severity: "high",
    colorClass: "diag-fraud",
    manualToggleable: true,
    description: "Plusieurs comptes ou alias e-mail reliés à la même connexion ou au même appareil."
  },
  {
    id: "disposable_email",
    category: "fraud",
    icon: "🗑️",
    label: "E-mail Jetable",
    shortLabel: "Mail Jetable",
    severity: "high",
    colorClass: "diag-fraud",
    manualToggleable: false,
    description: "Domaine de boîte mail temporaire / jetable détecté."
  },
  {
    id: "chargeback_threat",
    category: "fraud",
    icon: "💳",
    label: "Menace Chargeback / Litige",
    shortLabel: "Chargeback",
    severity: "critical",
    colorClass: "diag-fraud-critical",
    manualToggleable: true,
    description: "Mention d'opposition bancaire, litige PayPal/Stripe ou contestation de paiement."
  },
  {
    id: "social_engineering",
    category: "fraud",
    icon: "🎭",
    label: "Pression / Ingénierie Sociale",
    shortLabel: "Pression Accès",
    severity: "high",
    colorClass: "diag-fraud",
    manualToggleable: true,
    description: "Demande d'accès avant paiement, gratuité, faux justificatif ou lien externe suspect."
  },
  {
    id: "site_probing",
    category: "fraud",
    icon: "🔍",
    label: "Probing / Abus Site",
    shortLabel: "Probing Site",
    severity: "high",
    colorClass: "diag-watch",
    manualToggleable: true,
    description: "Bruteforce de codes promo, recherches multiples de commandes ou échecs répétés de connexion."
  },

  // --- ÉTAT ÉMOTIONNEL & TON ---
  {
    id: "furious_escalation",
    category: "emotion",
    icon: "🤬",
    label: "Très en colère / Escalade",
    shortLabel: "Très en colère",
    severity: "critical",
    colorClass: "diag-furious",
    manualToggleable: true,
    description: "Client furieux, accusations graves (arnaque/escroc), menace de plainte ou avis négatif."
  },
  {
    id: "annoyed",
    category: "emotion",
    icon: "😤",
    label: "Agacé / Impatient",
    shortLabel: "Agacé",
    severity: "high",
    colorClass: "diag-annoyed",
    manualToggleable: true,
    description: "Frustration, relances répétées ou impatience marquée."
  },
  {
    id: "anxious_worried",
    category: "emotion",
    icon: "😟",
    label: "Inquiet / À Rassurer",
    shortLabel: "Inquiet",
    severity: "medium",
    colorClass: "diag-anxious",
    manualToggleable: true,
    description: "Client stressé au sujet de son paiement ou de la réception : rassurer rapidement."
  },
  {
    id: "confused_needs_guide",
    category: "emotion",
    icon: "❓",
    label: "Perdu / Besoin d'Explications",
    shortLabel: "Perdu / Aide",
    severity: "low",
    colorClass: "diag-confused",
    manualToggleable: true,
    description: "Demande de guidage sur l'achat, le paiement ou l'activation d'un service."
  },
  {
    id: "positive_satisfied",
    category: "emotion",
    icon: "😊",
    label: "Satisfait / Courtois",
    shortLabel: "Satisfait",
    severity: "positive",
    colorClass: "diag-positive",
    manualToggleable: true,
    description: "Client courtois, satisfait ou remerciant l'équipe."
  },

  // --- URGENCE & OPÉRATIONS ---
  {
    id: "rescue_sos",
    category: "urgency",
    icon: "🆘",
    label: "Secours Paiement SOS",
    shortLabel: "Secours SOS",
    severity: "critical",
    colorClass: "diag-rescue",
    manualToggleable: true,
    description: "Dossier prioritaire suite à un incident technique ou oubli de référence après paiement."
  },
  {
    id: "paid_undelivered",
    category: "urgency",
    icon: "📦",
    label: "Payé — À Livrer Vite",
    shortLabel: "Payé à livrer",
    severity: "high",
    colorClass: "diag-fast-help",
    manualToggleable: false,
    description: "Paiement confirmé ou déclaré avec accès encore en attente d'envoi."
  },
  {
    id: "technical_issue",
    category: "urgency",
    icon: "🔧",
    label: "Bug / Problème Technique",
    shortLabel: "Problème Tech",
    severity: "high",
    colorClass: "diag-tech",
    manualToggleable: true,
    description: "Identifiants invalides, erreur d'activation, code PIN ou bug signalé."
  },
  {
    id: "fast_help",
    category: "urgency",
    icon: "⚡",
    label: "Aide Rapide Requise",
    shortLabel: "Aide Rapide",
    severity: "high",
    colorClass: "diag-fast-help",
    manualToggleable: true,
    description: "Intervention rapide recommandée."
  },
  {
    id: "waiting_long",
    category: "urgency",
    icon: "⏳",
    label: "Attente Longue",
    shortLabel: "Attente Longue",
    severity: "medium",
    colorClass: "diag-wait-warning",
    manualToggleable: false,
    description: "Message client sans réponse administrateur depuis plus de 10 minutes."
  },

  // --- PROFIL COMMERCIAL & CONFIANCE ---
  {
    id: "vip_loyal",
    category: "commercial",
    icon: "⭐",
    label: "Client VIP / Fidèle",
    shortLabel: "VIP Fidèle",
    severity: "positive",
    colorClass: "diag-vip",
    manualToggleable: true,
    description: "Client fidèle avec achats confirmés ou montant cumulé ≥ 250 €."
  },
  {
    id: "high_value_cart",
    category: "commercial",
    icon: "💎",
    label: "Panier Élevé",
    shortLabel: "Panier Élevé",
    severity: "medium",
    colorClass: "diag-vip",
    manualToggleable: true,
    description: "Commande ou panier à forte valeur (≥ 250 € ou 3+ articles)."
  },
  {
    id: "ready_to_buy",
    category: "commercial",
    icon: "🛒",
    label: "Prêt à Acheter",
    shortLabel: "Intention Achat",
    severity: "positive",
    colorClass: "diag-ready",
    manualToggleable: true,
    description: "Pose des questions pré-achat ou a consulté plusieurs offres / ouvert le panier."
  },
  {
    id: "verified_account",
    category: "commercial",
    icon: "✅",
    label: "Compte Client Connecté",
    shortLabel: "Compte Actif",
    severity: "positive",
    colorClass: "diag-verified",
    manualToggleable: false,
    description: "Client inscrit et authentifié sur NEXUS SUBS."
  },
  {
    id: "trusted_verified",
    category: "commercial",
    icon: "🛡️",
    label: "Client Fiable (Whitelist)",
    shortLabel: "Fiable",
    severity: "positive",
    colorClass: "diag-positive",
    manualToggleable: true,
    description: "Client explicitement validé comme fiable par l'administrateur."
  }
];

export const FLAG_MAP = new Map(FLAG_DEFINITIONS.map((f) => [f.id, f]));

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailo.com",
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "grr.la",
  "mailinator.com",
  "mailinator2.com",
  "trashmail.com",
  "trashmail.me",
  "trashmail.net",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mohmal.com",
  "jetable.org",
  "jetable.net",
  "fakeinbox.com",
  "throwawaymail.com",
  "mintemail.com",
  "emailondeck.com",
  "mytemp.email",
  "tempail.com",
  "burnermail.io",
  "moakt.com",
  "mailnesia.com",
  "mailcatch.com",
  "spamgourmet.com",
  "inboxbear.com",
  "dropmail.me",
  "linshi-email.com",
  "guerrillamailblock.com",
  "pokemail.net",
  "harakirimail.com",
  "crazymailing.com",
  "tempr.email",
  "discard.email",
  "mailsac.com",
  "mailpoof.com",
  "anonaddy.me",
  "tmailor.com",
  "internxt.com",
  "mailtemp.net",
  "minuteinbox.com",
  "tmpmail.org",
  "tmpmail.net",
  "wegwerfmail.de",
  "byom.de",
  "spambog.com"
]);

const FURIOUS_PATTERNS = [
  /\barnaque(ur|s)?\b/i,
  /\bescroc(s|querie)?\b/i,
  /\bvoleur(s)?\b/i,
  /\bfraude(ur)?\b/i,
  /\bporter plainte\b/i,
  /\bplainte\b/i,
  /\bpolice\b/i,
  /\bgendarmerie\b/i,
  /\bsignal\s?conso\b/i,
  /\bdgccrf\b/i,
  /\bavocat\b/i,
  /\btribunal\b/i,
  /\bputain\b/i,
  /\bmerde\b/i,
  /\bconnard/i,
  /\bencul[ée]/i,
  /\bfoutage de gueule\b/i,
  /\bavis n[ée]gatif\b/i,
  /\bscandale(ux)?\b/i,
  /\bfurieux\b/i,
  /\bhonte(ux)?\b/i
];

const ANNOYED_PATTERNS = [
  /\binadmissible\b/i,
  /\bmarre\b/i,
  /\babus[ée]\b/i,
  /\bnul\b/i,
  /\bm[ée]content/i,
  /personne (ne )?r[ée]pond/i,
  /toujours rien/i,
  /j['’]attends depuis/i,
  /[çc]a fait \d+\s*(min|heure|h|jour|j)/i,
  /trop long/i,
  /vous dormez/i,
  /r[ée]pondez/i,
  /pas s[ée]rieux/i,
  /[!]{3,}/,
  /[?]{3,}/
];

const ANXIOUS_PATTERNS = [
  /\binquiet/i,
  /\bpeur\b/i,
  /\bstress/i,
  /rassure(z|-moi)/i,
  /perdu mon argent/i,
  /d[ée]bit[ée] (mais|deux fois|2 fois)/i,
  /est-ce (que c['’]est )?(fiable|s[ée]curis[ée]|s[ée]rieux|normal)/i,
  /je m['’]inqui[èe]te/i,
  /rien re[çc]u/i,
  /toujours pas re[çc]u/i,
  /mon argent/i,
  /j['’]ai pay[ée] mais/i
];

const CONFUSED_PATTERNS = [
  /comment (faire|activer|payer|fonctionne|marche|r[ée]cup[ée]rer|trouver)/i,
  /je ne comprends pas/i,
  /je suis perdu/i,
  /o[ùu] trouver/i,
  /pouvez-vous m['’]expliquer/i,
  /quelle [ée]tape/i,
  /c['’]est quoi le/i,
  /comment [çc]a se passe/i,
  /j['’]arrive pas [àa] trouver/i
];

const POSITIVE_PATTERNS = [
  /\bmerci( beaucoup| infiniment| bien)?\b/i,
  /\bsuper\b/i,
  /\bparfait\b/i,
  /\bg[ée]nial\b/i,
  /\bexcellent\b/i,
  /\bau top\b/i,
  /\bbravo\b/i,
  /[çc]a marche nickel/i,
  /bien re[çc]u/i,
  /tr[èe]s rapide/i
];

const TECHNICAL_ISSUE_PATTERNS = [
  /\bbug\b/i,
  /\berreur\b/i,
  /marche pas/i,
  /fonctionne pas/i,
  /code invalide/i,
  /mot de passe incorrect/i,
  /pin incorrect/i,
  /lien expir[ée]/i,
  /lien (ne )?marche pas/i,
  /impossible de me connecter/i,
  /page ferm[ée]e/i,
  /coupure/i,
  /bloqué sur/i,
  /compte d[ée]connect[ée]/i,
  /ne s['’]active pas/i
];

const URGENT_HELP_PATTERNS = [
  /\burgent/i,
  /\baide(-|\s)?moi/i,
  /\bbloqu[ée]/i,
  /\bau secours\b/i,
  /\bsvp vite\b/i,
  /pay[ée] mais/i,
  /d[ée]bit[ée]/i,
  /virement fait/i,
  /perdu mon argent/i,
  /rien re[çc]u/i
];

const CHARGEBACK_PATTERNS = [
  /chargeback/i,
  /opposition bancaire/i,
  /faire opposition/i,
  /litige\s?(paypal|stripe|bancaire|banque)?/i,
  /contester (le |mon )?(paiement|pr[ée]l[èe]vement|virement)/i,
  /r[ée]trofacturation/i,
  /dispute/i
];

const SOCIAL_ENG_PATTERNS = [
  /envoie.*d['’]abord/i,
  /donne.*avant.*pay/i,
  /je paie apr[èe]s/i,
  /payer apr[èe]s/i,
  /faux virement/i,
  /gratuitement/i,
  /compte gratuit/i,
  /test gratuit/i,
  /essai gratuit/i,
  /fais-moi confiance/i,
  /envoie les codes.*vite/i,
  /capture d['’][ée]cran.*envoie/i,
  /http(s)?:\/\/(?!(families\.google\.com|paypal\.me|checkout\.stripe\.com|www\.paypal\.com))/i
];

const READY_TO_BUY_PATTERNS = [
  /\bdisponible\b/i,
  /\ben stock\b/i,
  /\bcode promo\b/i,
  /\br[ée]duction\b/i,
  /je veux (acheter|commander|prendre)/i,
  /je souhaite (acheter|commander|prendre)/i,
  /comment payer/i,
  /moyen(s)? de paiement/i,
  /combien co[ûu]te/i,
  /est-ce compatible/i,
  /si je commande maintenant/i
];

export function isDisposableEmail(email) {
  const domain = canonicalizeEmail(email).split("@")[1] || "";
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  // Heuristique pour sous-domaines ou domaines jetables évidents
  if (/(tempmail|temp-mail|throwaway|guerrillamail|mailinator|trashmail|yopmail|jetable|10minmail)/i.test(domain)) {
    return true;
  }
  return false;
}

/**
 * Entropie de Shannon (détecte les chaînes aléatoires générées par des bots/scripts)
 */
export function computeShannonEntropy(str) {
  const s = String(str || "");
  if (!s.length) return 0;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Fusionne un lot d'événements de télémétrie site dans `db.data.visitorProfiles`
 */
export function ingestVisitorTelemetry(db, {
  visitorId = "",
  sessionId = "",
  clientHash = "",
  deviceFingerprint = "",
  userId = null,
  email = "",
  events = [],
  snapshot = null,
  userAgentSummary = ""
} = {}) {
  const cleanVid = String(visitorId || "").trim().slice(0, 64);
  const cleanEmail = canonicalizeEmail(email);
  const key = userId
    ? `usr:${userId}`
    : cleanVid
    ? `vis:${cleanVid}`
    : clientHash
    ? `net:${clientHash}`
    : null;

  if (!key) return null;

  db.data.visitorProfiles = db.data.visitorProfiles || {};
  const nowIso = new Date().toISOString();

  // Si l'utilisateur vient de se connecter et avait un profil visiteur anonyme, fusionner les métriques
  let profile = db.data.visitorProfiles[key];
  if (userId && cleanVid && db.data.visitorProfiles[`vis:${cleanVid}`] && key !== `vis:${cleanVid}`) {
    const anon = db.data.visitorProfiles[`vis:${cleanVid}`];
    if (!profile) {
      profile = { ...anon, key, userId };
      delete db.data.visitorProfiles[`vis:${cleanVid}`];
    } else {
      profile = mergeProfileData(profile, anon);
      delete db.data.visitorProfiles[`vis:${cleanVid}`];
    }
  }

  if (!profile) {
    profile = {
      key,
      visitorId: cleanVid || key,
      userId: userId || null,
      email: cleanEmail || "",
      canonicalEmail: cleanEmail ? getCanonicalEmailKey(cleanEmail) : "",
      clientHashes: [],
      deviceFingerprints: [],
      sessionIds: [],
      userAgentSummary: userAgentSummary || "",
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      sessionCount: 1,
      totalDurationMs: 0,
      maxScrollDepthPct: 0,
      sectionsVisited: [],
      viewedProducts: [],
      cartAdds: 0,
      cartRemoves: 0,
      couponAttempts: 0,
      couponFailures: 0,
      orderLookupAttempts: 0,
      orderLookupFailures: 0,
      checkoutOpens: 0,
      checkoutAbandons: 0,
      paymentMethodSwitches: 0,
      loginFailures: 0,
      loginSuccesses: 0,
      registerAttempts: 0,
      discussionOpens: 0,
      messagesSent: 0,
      rescueSubmits: 0,
      pointerMoves: 0,
      clickCount: 0,
      scrollEvents: 0,
      keyEvents: 0,
      pasteCount: 0,
      visibilitySwitches: 0,
      webdriverDetected: false,
      headlessSignals: [],
      timezone: "",
      language: "",
      screenSize: "",
      recentEvents: []
    };
  }

  profile.lastSeenAt = nowIso;
  if (userId) profile.userId = userId;
  if (cleanVid) profile.visitorId = cleanVid;
  if (cleanEmail) {
    profile.email = cleanEmail;
    profile.canonicalEmail = getCanonicalEmailKey(cleanEmail);
  }
  if (userAgentSummary) profile.userAgentSummary = userAgentSummary;
  if (clientHash && !profile.clientHashes.includes(clientHash)) {
    profile.clientHashes = [clientHash, ...profile.clientHashes].slice(0, 12);
  }
  if (deviceFingerprint) {
    const cleanFp = String(deviceFingerprint).slice(0, 64);
    if (cleanFp && !profile.deviceFingerprints.includes(cleanFp)) {
      profile.deviceFingerprints = [cleanFp, ...profile.deviceFingerprints].slice(0, 8);
    }
  }
  if (sessionId) {
    const cleanSid = String(sessionId).slice(0, 48);
    if (cleanSid && !profile.sessionIds.includes(cleanSid)) {
      profile.sessionIds = [cleanSid, ...profile.sessionIds].slice(0, 20);
      profile.sessionCount = Math.max(profile.sessionCount || 1, profile.sessionIds.length);
    }
  }

  if (snapshot && typeof snapshot === "object") {
    profile.totalDurationMs = Math.max(profile.totalDurationMs || 0, Math.min(86_400_000, Number(snapshot.sessionDurationMs) || 0));
    profile.maxScrollDepthPct = Math.max(profile.maxScrollDepthPct || 0, Math.min(100, Number(snapshot.maxScrollDepthPct) || 0));
    profile.pointerMoves = Math.max(profile.pointerMoves || 0, Math.min(50_000, Number(snapshot.pointerMoves) || 0));
    profile.clickCount = Math.max(profile.clickCount || 0, Math.min(10_000, Number(snapshot.clickCount) || 0));
    profile.scrollEvents = Math.max(profile.scrollEvents || 0, Math.min(10_000, Number(snapshot.scrollEvents) || 0));
    profile.keyEvents = Math.max(profile.keyEvents || 0, Math.min(20_000, Number(snapshot.keyEvents) || 0));
    profile.pasteCount = Math.max(profile.pasteCount || 0, Math.min(500, Number(snapshot.pasteCount) || 0));
    profile.visibilitySwitches = Math.max(profile.visibilitySwitches || 0, Math.min(500, Number(snapshot.visibilitySwitches) || 0));
    if (snapshot.webdriver === true) profile.webdriverDetected = true;
    if (Array.isArray(snapshot.headlessSignals)) {
      for (const sig of snapshot.headlessSignals.slice(0, 10)) {
        const s = String(sig || "").slice(0, 60);
        if (s && !profile.headlessSignals.includes(s)) profile.headlessSignals.push(s);
      }
    }
    if (snapshot.timezone) profile.timezone = String(snapshot.timezone).slice(0, 60);
    if (snapshot.language) profile.language = String(snapshot.language).slice(0, 24);
    if (snapshot.screenSize) profile.screenSize = String(snapshot.screenSize).slice(0, 24);
    if (Array.isArray(snapshot.sectionsVisited)) {
      for (const sec of snapshot.sectionsVisited.slice(0, 15)) {
        const s = String(sec || "").slice(0, 40);
        if (s && !profile.sectionsVisited.includes(s)) profile.sectionsVisited.push(s);
      }
    }
    if (Array.isArray(snapshot.viewedProducts)) {
      for (const prod of snapshot.viewedProducts.slice(0, 25)) {
        const p = String(prod || "").slice(0, 60);
        if (p && !profile.viewedProducts.includes(p)) profile.viewedProducts.push(p);
      }
    }
  }

  if (Array.isArray(events)) {
    for (const ev of events.slice(0, 40)) {
      if (!ev || typeof ev !== "object") continue;
      const type = String(ev.type || "").slice(0, 40);
      const label = String(ev.label || "").slice(0, 120);
      const ts = ev.ts && !Number.isNaN(new Date(ev.ts).getTime()) ? new Date(ev.ts).toISOString() : nowIso;
      if (!type) continue;

      switch (type) {
        case "section_view":
          if (label && !profile.sectionsVisited.includes(label)) profile.sectionsVisited.push(label);
          break;
        case "product_detail_open":
          if (label && !profile.viewedProducts.includes(label)) profile.viewedProducts.push(label);
          break;
        case "cart_add":
          profile.cartAdds += 1;
          break;
        case "cart_remove":
          profile.cartRemoves += 1;
          break;
        case "coupon_attempt":
          profile.couponAttempts += 1;
          if (ev.ok === false) profile.couponFailures += 1;
          break;
        case "order_lookup_attempt":
          profile.orderLookupAttempts += 1;
          if (ev.ok === false) profile.orderLookupFailures += 1;
          break;
        case "checkout_open":
          profile.checkoutOpens += 1;
          break;
        case "checkout_abandon":
          profile.checkoutAbandons += 1;
          break;
        case "payment_method_switch":
          profile.paymentMethodSwitches += 1;
          break;
        case "auth_login_fail":
          profile.loginFailures += 1;
          break;
        case "auth_login_success":
          profile.loginSuccesses += 1;
          break;
        case "auth_register_attempt":
          profile.registerAttempts += 1;
          break;
        case "discussion_open":
          profile.discussionOpens += 1;
          break;
        case "message_sent":
          profile.messagesSent += 1;
          break;
        case "rescue_submit":
          profile.rescueSubmits += 1;
          break;
      }

      profile.recentEvents.unshift({
        type,
        label,
        ok: ev.ok === undefined ? undefined : Boolean(ev.ok),
        ts
      });
    }
    profile.recentEvents = profile.recentEvents.slice(0, 45);
  }

  db.data.visitorProfiles[key] = profile;
  db.pruneVisitorProfiles?.();
  return profile;
}

function mergeProfileData(base, extra) {
  const uniq = (a = [], b = [], max = 25) => [...new Set([...a, ...b].filter(Boolean))].slice(0, max);
  return {
    ...base,
    clientHashes: uniq(base.clientHashes, extra.clientHashes, 12),
    deviceFingerprints: uniq(base.deviceFingerprints, extra.deviceFingerprints, 8),
    sessionIds: uniq(base.sessionIds, extra.sessionIds, 20),
    sectionsVisited: uniq(base.sectionsVisited, extra.sectionsVisited, 15),
    viewedProducts: uniq(base.viewedProducts, extra.viewedProducts, 25),
    headlessSignals: uniq(base.headlessSignals, extra.headlessSignals, 10),
    firstSeenAt:
      new Date(extra.firstSeenAt || Date.now()) < new Date(base.firstSeenAt || Date.now())
        ? extra.firstSeenAt
        : base.firstSeenAt,
    lastSeenAt:
      new Date(extra.lastSeenAt || 0) > new Date(base.lastSeenAt || 0) ? extra.lastSeenAt : base.lastSeenAt,
    sessionCount: Math.max(base.sessionCount || 1, (base.sessionCount || 0) + (extra.sessionCount || 0)),
    totalDurationMs: Math.max(base.totalDurationMs || 0, extra.totalDurationMs || 0),
    maxScrollDepthPct: Math.max(base.maxScrollDepthPct || 0, extra.maxScrollDepthPct || 0),
    cartAdds: (base.cartAdds || 0) + (extra.cartAdds || 0),
    cartRemoves: (base.cartRemoves || 0) + (extra.cartRemoves || 0),
    couponAttempts: (base.couponAttempts || 0) + (extra.couponAttempts || 0),
    couponFailures: (base.couponFailures || 0) + (extra.couponFailures || 0),
    orderLookupAttempts: (base.orderLookupAttempts || 0) + (extra.orderLookupAttempts || 0),
    orderLookupFailures: (base.orderLookupFailures || 0) + (extra.orderLookupFailures || 0),
    checkoutOpens: (base.checkoutOpens || 0) + (extra.checkoutOpens || 0),
    checkoutAbandons: (base.checkoutAbandons || 0) + (extra.checkoutAbandons || 0),
    paymentMethodSwitches: (base.paymentMethodSwitches || 0) + (extra.paymentMethodSwitches || 0),
    loginFailures: (base.loginFailures || 0) + (extra.loginFailures || 0),
    loginSuccesses: (base.loginSuccesses || 0) + (extra.loginSuccesses || 0),
    registerAttempts: (base.registerAttempts || 0) + (extra.registerAttempts || 0),
    discussionOpens: (base.discussionOpens || 0) + (extra.discussionOpens || 0),
    messagesSent: (base.messagesSent || 0) + (extra.messagesSent || 0),
    rescueSubmits: (base.rescueSubmits || 0) + (extra.rescueSubmits || 0),
    pointerMoves: Math.max(base.pointerMoves || 0, extra.pointerMoves || 0),
    clickCount: Math.max(base.clickCount || 0, extra.clickCount || 0),
    scrollEvents: Math.max(base.scrollEvents || 0, extra.scrollEvents || 0),
    keyEvents: Math.max(base.keyEvents || 0, extra.keyEvents || 0),
    pasteCount: Math.max(base.pasteCount || 0, extra.pasteCount || 0),
    visibilitySwitches: Math.max(base.visibilitySwitches || 0, extra.visibilitySwitches || 0),
    webdriverDetected: Boolean(base.webdriverDetected || extra.webdriverDetected),
    timezone: base.timezone || extra.timezone || "",
    language: base.language || extra.language || "",
    screenSize: base.screenSize || extra.screenSize || "",
    recentEvents: [...(base.recentEvents || []), ...(extra.recentEvents || [])]
      .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime())
      .slice(0, 45)
  };
}

/**
 * Agrège toutes les traces comportementales corrélées d'un client sur le site
 */
export function collectUnifiedVisitorTelemetry({
  userId = null,
  email = "",
  visitorId = "",
  clientHash = "",
  deviceFingerprint = "",
  visitorProfiles = {},
  inlineSnapshot = null
} = {}) {
  const cleanEmail = canonicalizeEmail(email);
  const canonEmail = cleanEmail ? getCanonicalEmailKey(cleanEmail) : "";
  const matched = [];

  for (const p of Object.values(visitorProfiles || {})) {
    if (!p) continue;
    const hit =
      (userId && p.userId === userId) ||
      (visitorId && p.visitorId === visitorId) ||
      (cleanEmail && p.email === cleanEmail) ||
      (canonEmail && p.canonicalEmail && p.canonicalEmail === canonEmail) ||
      (deviceFingerprint && Array.isArray(p.deviceFingerprints) && p.deviceFingerprints.includes(deviceFingerprint)) ||
      (clientHash && Array.isArray(p.clientHashes) && p.clientHashes.includes(clientHash));
    if (hit) matched.push(p);
  }

  let agg = null;
  for (const m of matched) {
    agg = agg ? mergeProfileData(agg, m) : structuredClone(m);
  }

  if (inlineSnapshot && typeof inlineSnapshot === "object") {
    const snap = {
      visitorId: visitorId || inlineSnapshot.visitorId || "",
      userId,
      email: cleanEmail,
      canonicalEmail: canonEmail,
      clientHashes: clientHash ? [clientHash] : [],
      deviceFingerprints: deviceFingerprint ? [deviceFingerprint] : [],
      sessionIds: inlineSnapshot.sessionId ? [inlineSnapshot.sessionId] : [],
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      sessionCount: 1,
      totalDurationMs: Number(inlineSnapshot.sessionDurationMs) || 0,
      maxScrollDepthPct: Number(inlineSnapshot.maxScrollDepthPct) || 0,
      sectionsVisited: Array.isArray(inlineSnapshot.sectionsVisited) ? inlineSnapshot.sectionsVisited : [],
      viewedProducts: Array.isArray(inlineSnapshot.viewedProducts) ? inlineSnapshot.viewedProducts : [],
      cartAdds: Number(inlineSnapshot.cartAdds) || 0,
      cartRemoves: Number(inlineSnapshot.cartRemoves) || 0,
      couponAttempts: Number(inlineSnapshot.couponAttempts) || 0,
      couponFailures: Number(inlineSnapshot.couponFailures) || 0,
      orderLookupAttempts: Number(inlineSnapshot.orderLookupAttempts) || 0,
      orderLookupFailures: Number(inlineSnapshot.orderLookupFailures) || 0,
      checkoutOpens: Number(inlineSnapshot.checkoutOpens) || 0,
      checkoutAbandons: Number(inlineSnapshot.checkoutAbandons) || 0,
      paymentMethodSwitches: Number(inlineSnapshot.paymentMethodSwitches) || 0,
      loginFailures: Number(inlineSnapshot.loginFailures) || 0,
      loginSuccesses: Number(inlineSnapshot.loginSuccesses) || 0,
      registerAttempts: Number(inlineSnapshot.registerAttempts) || 0,
      discussionOpens: Number(inlineSnapshot.discussionOpens) || 0,
      messagesSent: Number(inlineSnapshot.messagesSent) || 0,
      rescueSubmits: Number(inlineSnapshot.rescueSubmits) || 0,
      pointerMoves: Number(inlineSnapshot.pointerMoves) || 0,
      clickCount: Number(inlineSnapshot.clickCount) || 0,
      scrollEvents: Number(inlineSnapshot.scrollEvents) || 0,
      keyEvents: Number(inlineSnapshot.keyEvents) || 0,
      pasteCount: Number(inlineSnapshot.pasteCount) || 0,
      visibilitySwitches: Number(inlineSnapshot.visibilitySwitches) || 0,
      webdriverDetected: Boolean(inlineSnapshot.webdriver),
      headlessSignals: Array.isArray(inlineSnapshot.headlessSignals) ? inlineSnapshot.headlessSignals : [],
      timezone: String(inlineSnapshot.timezone || ""),
      language: String(inlineSnapshot.language || ""),
      screenSize: String(inlineSnapshot.screenSize || ""),
      recentEvents: Array.isArray(inlineSnapshot.recentEvents) ? inlineSnapshot.recentEvents : []
    };
    agg = agg ? mergeProfileData(agg, snap) : snap;
  }

  return agg;
}

/**
 * Moteur principal d'évaluation du risque de fraude en 6 dimensions
 */
export function computeComprehensiveFraudRisk({
  email = "",
  customerName = "",
  userId = null,
  clientHash = "",
  deviceFingerprint = "",
  visitorId = "",
  orderTotal = 0,
  orderQuantity = 0,
  formFillMs = null,
  honeypot = "",
  messagesText = "",
  customerMessages = [],
  existingOrders = [],
  allUsers = [],
  allDiscussions = [],
  rescueClaims = [],
  visitorProfiles = {},
  inlineSnapshot = null,
  security = {},
  isRescueContext = false,
  fastDeclarationSec = null
} = {}) {
  const cleanEmail = canonicalizeEmail(email);
  const canonEmail = cleanEmail ? getCanonicalEmailKey(cleanEmail) : "";
  const cleanName = String(customerName || "").trim();
  const signals = [];

  const addSignal = (code, category, severity, weight, label, detail) => {
    if (signals.some((s) => s.code === code)) return;
    signals.push({ code, category, severity, weight, label, detail });
  };

  // Vérifications de blocage absolu (Honeypot & Blacklists)
  if (honeypot && String(honeypot).trim() !== "") {
    addSignal("honeypot_triggered", "behavioral", "critical", 100, "Champ anti-bot déclenché", "Un champ invisible anti-robot a été rempli automatiquement.");
    return buildFinalAssessment({
      signals,
      dimensions: { identity: 0, behavioral: 100, velocityGraph: 0, payment: 0, linguistic: 0, trustBonus: 0 },
      forcedScore: 100,
      blocked: true,
      confidence: 99,
      telemetry: null,
      linkedUsersCount: 0,
      linkedOrders: []
    });
  }

  const blockedEmails = security?.blockedEmails || [];
  const blockedHashes = security?.blockedHashes || [];
  const blockedFingerprints = security?.blockedFingerprints || [];
  const isBlacklisted =
    (cleanEmail && blockedEmails.includes(cleanEmail)) ||
    (clientHash && blockedHashes.includes(clientHash)) ||
    (deviceFingerprint && blockedFingerprints.includes(deviceFingerprint));

  if (isBlacklisted) {
    addSignal("blacklisted", "velocityGraph", "critical", 100, "Client / Connexion sur liste noire", "Adresse e-mail, connexion réseau ou appareil précédemment bloqué par l'administrateur.");
    return buildFinalAssessment({
      signals,
      dimensions: { identity: 100, behavioral: 0, velocityGraph: 100, payment: 0, linguistic: 0, trustBonus: 0 },
      forcedScore: 100,
      blocked: true,
      confidence: 99,
      telemetry: collectUnifiedVisitorTelemetry({ userId, email: cleanEmail, visitorId, clientHash, deviceFingerprint, visitorProfiles, inlineSnapshot }),
      linkedUsersCount: 0,
      linkedOrders: []
    });
  }

  // Agrégation du suivi comportemental complet sur le site
  const telemetry = collectUnifiedVisitorTelemetry({
    userId,
    email: cleanEmail,
    visitorId,
    clientHash,
    deviceFingerprint,
    visitorProfiles,
    inlineSnapshot
  });

  // Recherche du compte client et des entités corrélées
  const user =
    (userId ? allUsers.find((u) => u.id === userId) : null) ||
    (cleanEmail ? allUsers.find((u) => canonicalizeEmail(u.email) === cleanEmail) : null) ||
    null;

  const isWhitelisted = Boolean(
    user?.trustedOverride === true ||
      (user && (security?.trustedUserIds || []).includes(user.id)) ||
      (cleanEmail && (security?.trustedEmails || []).includes(cleanEmail))
  );

  // Commandes liées à cette identité / empreinte / appareil
  const linkedOrders = existingOrders.filter((o) => {
    const oEmail = canonicalizeEmail(o.email);
    return (
      (user && o.userId && o.userId === user.id) ||
      (cleanEmail && oEmail === cleanEmail) ||
      (canonEmail && oEmail && getCanonicalEmailKey(oEmail) === canonEmail) ||
      (deviceFingerprint && o.deviceFingerprint && o.deviceFingerprint === deviceFingerprint) ||
      (clientHash && o.clientHash && o.clientHash === clientHash)
    );
  });

  // =========================================================================
  // DIMENSION 1 : IDENTITÉ & E-MAIL (0-100)
  // =========================================================================
  let identityScore = 0;

  if (cleanEmail && isDisposableEmail(cleanEmail)) {
    identityScore += 48;
    addSignal("disposable_email", "identity", "high", 48, "E-mail jetable / temporaire", `Le domaine « ${cleanEmail.split("@")[1]} » appartient à un fournisseur de mails jetables.`);
  }

  if (cleanEmail) {
    const localPart = cleanEmail.split("@")[0] || "";
    const digitsCount = (localPart.match(/\d/g) || []).length;
    const entropy = computeShannonEntropy(localPart);
    if (localPart.length >= 12 && digitsCount / localPart.length >= 0.55) {
      identityScore += 18;
      addSignal("high_digit_email", "identity", "medium", 18, "E-mail à structure automatisée", `Partie locale très numérique (${digitsCount}/${localPart.length} chiffres).`);
    } else if (localPart.length >= 14 && entropy >= 3.85 && !/[._-]/.test(localPart)) {
      identityScore += 14;
      addSignal("high_entropy_email", "identity", "medium", 14, "Entropie d'e-mail élevée", `L'identifiant e-mail ressemble à une chaîne aléatoire (entropie ${entropy.toFixed(2)}).`);
    }
    if (localPart.includes("+")) {
      // Vérifier si un autre compte/commande existe déjà sous le même e-mail canonique
      const aliasPeers = allUsers.filter(
        (u) => u.canonicalEmail === canonEmail && canonicalizeEmail(u.email) !== cleanEmail
      );
      const aliasOrderPeers = existingOrders.filter(
        (o) => getCanonicalEmailKey(o.email) === canonEmail && canonicalizeEmail(o.email) !== cleanEmail
      );
      if (aliasPeers.length > 0 || aliasOrderPeers.length > 0) {
        identityScore += 32;
        addSignal("email_alias_abuse", "identity", "high", 32, "Contournement par alias e-mail (+)", `Alias détecté correspondant au même compte canonique (${canonEmail}) déjà présent.`);
      }
    }
  }

  if (cleanName) {
    if (
      /^(test|azerty|qwerty|asdf|aaa+|xxx+|fake|admin|root|user\d*|client\d*)$/i.test(cleanName) ||
      cleanName.length <= 2 ||
      /^\d+$/.test(cleanName)
    ) {
      identityScore += 18;
      addSignal("suspicious_name", "identity", "medium", 18, "Nom client factice ou générique", `Nom saisi atypique : « ${cleanName} ».`);
    }
    if (user && user.name && cleanName.toLowerCase() !== user.name.toLowerCase()) {
      const aTokens = user.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      const bTokens = cleanName.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      const overlap = aTokens.some((t) => bTokens.includes(t));
      if (!overlap && aTokens.length > 0 && bTokens.length > 0) {
        identityScore += 14;
        addSignal("name_account_mismatch", "identity", "medium", 14, "Nom différent du compte connecté", `Compte au nom de « ${user.name} » mais commande / message sous « ${cleanName} ».`);
      }
    }
  }

  if (user && user.status === "suspended") {
    identityScore += 65;
    addSignal("suspended_account", "identity", "critical", 65, "Compte client suspendu", "Ce compte a été suspendu par l'administrateur.");
  }

  identityScore = Math.min(100, identityScore);

  // =========================================================================
  // DIMENSION 2 : COMPORTEMENT & SUIVI COMPLET SUR LE SITE (0-100)
  // =========================================================================
  let behavioralScore = 0;

  if (typeof formFillMs === "number" && formFillMs > 0) {
    if (formFillMs < 1300) {
      behavioralScore += 52;
      addSignal("robotic_form_speed", "behavioral", "critical", 52, "Soumission robotique (< 1,3s)", `Formulaire rempli en ${formFillMs} ms.`);
    } else if (formFillMs < 2600) {
      behavioralScore += 20;
      addSignal("very_fast_form", "behavioral", "medium", 20, "Remplissage anormalement rapide", `Formulaire soumis en ${(formFillMs / 1000).toFixed(1)}s.`);
    }
  }

  if (telemetry) {
    if (telemetry.webdriverDetected) {
      behavioralScore += 50;
      addSignal("webdriver_detected", "behavioral", "critical", 50, "Navigateur automatisé (WebDriver)", "Indicateur navigator.webdriver actif (bot / script Selenium / Playwright).");
    }
    if ((telemetry.headlessSignals || []).length > 0) {
      behavioralScore += 30;
      addSignal("headless_signals", "behavioral", "high", 30, "Signaux navigateur Headless", `Anomalies détectées : ${telemetry.headlessSignals.join(", ")}.`);
    }

    const totalHumanActions = (telemetry.pointerMoves || 0) + (telemetry.scrollEvents || 0) + (telemetry.keyEvents || 0);
    if (orderTotal > 0 && telemetry.totalDurationMs > 0 && telemetry.totalDurationMs < 7000 && (telemetry.viewedProducts || []).length === 0 && (telemetry.maxScrollDepthPct || 0) < 8) {
      behavioralScore += 28;
      addSignal("direct_checkout_rush", "behavioral", "high", 28, "Passage commande éclair sans consultation", `Commande initiée en ${(telemetry.totalDurationMs / 1000).toFixed(1)}s sans consulter de fiche produit ni scroller.`);
    }
    if (orderTotal > 0 && totalHumanActions === 0 && telemetry.clickCount <= 2) {
      behavioralScore += 26;
      addSignal("zero_human_telemetry", "behavioral", "high", 26, "Aucune interaction humaine naturelle", "0 mouvement souris/tactile, 0 scroll et 0 frappe clavier détectés avant validation.");
    }

    // Probing & tentatives d'abus sur le site
    if ((telemetry.couponFailures || 0) >= 7) {
      behavioralScore += 36;
      addSignal("coupon_bruteforce", "behavioral", "high", 36, "Bruteforce de codes promo", `${telemetry.couponFailures} codes promo invalides testés successivement.`);
    } else if ((telemetry.couponFailures || 0) >= 4) {
      behavioralScore += 20;
      addSignal("coupon_probing", "behavioral", "medium", 20, "Tests répétés de codes promo", `${telemetry.couponFailures} essais de codes promo échoués.`);
    }

    if ((telemetry.orderLookupFailures || 0) >= 5) {
      behavioralScore += 45;
      addSignal("order_enumeration", "behavioral", "critical", 45, "Tentative d'énumération de commandes", `${telemetry.orderLookupFailures} recherches infructueuses dans « Mes Accès » (possible vol d'accès).`);
    } else if ((telemetry.orderLookupFailures || 0) >= 3) {
      behavioralScore += 26;
      addSignal("order_lookup_probing", "behavioral", "high", 26, "Recherches répétées de commandes", `${telemetry.orderLookupFailures} recherches de commandes échouées.`);
    }

    if ((telemetry.loginFailures || 0) >= 6 || (user && (user.failedLoginCount || 0) >= 5)) {
      behavioralScore += 35;
      addSignal("credential_stuffing", "behavioral", "high", 35, "Échecs répétés de connexion", `${Math.max(telemetry.loginFailures || 0, user?.failedLoginCount || 0)} tentatives de mot de passe incorrectes.`);
    } else if ((telemetry.loginFailures || 0) >= 3) {
      behavioralScore += 16;
      addSignal("login_failures", "behavioral", "medium", 16, "Plusieurs échecs de connexion", `${telemetry.loginFailures} échecs de connexion observés dans le suivi.`);
    }

    if ((telemetry.paymentMethodSwitches || 0) >= 4) {
      behavioralScore += 15;
      addSignal("payment_method_probing", "behavioral", "medium", 15, "Bascules répétées de paiement", `${telemetry.paymentMethodSwitches} changements de moyen de paiement avant commande.`);
    }
    if ((telemetry.checkoutAbandons || 0) >= 3) {
      behavioralScore += 14;
      addSignal("repeated_checkout_abandons", "behavioral", "medium", 14, "Multiples abandons de checkout", `${telemetry.checkoutAbandons} ouvertures/abandons de paiement sans finalisation.`);
    }
    if ((telemetry.pasteCount || 0) >= 5 && telemetry.totalDurationMs > 0 && telemetry.totalDurationMs < 20_000) {
      behavioralScore += 14;
      addSignal("rapid_mass_paste", "behavioral", "medium", 14, "Copier-coller massif rapide", `${telemetry.pasteCount} collages rapides détectés durant une session très courte.`);
    }
  }

  behavioralScore = Math.min(100, behavioralScore);

  // =========================================================================
  // DIMENSION 3 : VÉLOCITÉ & GRAPHE MULTI-COMPTES (0-100)
  // =========================================================================
  let velocityGraphScore = 0;
  const nowMs = Date.now();

  // Comptes reliés à la même empreinte réseau, appareil ou e-mail canonique
  const correlatedUsers = new Set();
  const fpSet = new Set([...(telemetry?.deviceFingerprints || []), deviceFingerprint].filter(Boolean));
  const hashSet = new Set([...(telemetry?.clientHashes || []), clientHash].filter(Boolean));

  for (const u of allUsers) {
    if (
      (canonEmail && u.canonicalEmail === canonEmail) ||
      (u.lastClientHash && hashSet.has(u.lastClientHash)) ||
      (u.lastDeviceFingerprint && fpSet.has(u.lastDeviceFingerprint))
    ) {
      correlatedUsers.add(u.id);
    }
  }

  if (correlatedUsers.size >= 3) {
    velocityGraphScore += 52;
    addSignal("multi_account_cluster", "velocityGraph", "critical", 52, "Graphe Multi-Comptes critique", `${correlatedUsers.size} comptes distincts reliés au même appareil ou réseau.`);
  } else if (correlatedUsers.size === 2) {
    velocityGraphScore += 28;
    addSignal("multi_account_pair", "velocityGraph", "high", 28, "Double compte détecté", "2 comptes distincts partagent la même empreinte appareil ou réseau.");
  }

  // Vélocité des commandes avec décroissance exponentielle (demi-vie 4h)
  let decayedUnpaidWeight = 0;
  const recentEmails = new Set();
  const cutoff24h = nowMs - 24 * 60 * 60 * 1000;

  for (const o of linkedOrders) {
    const ageMs = Math.max(0, nowMs - new Date(o.createdAt).getTime());
    const ageHours = ageMs / 3_600_000;
    if (new Date(o.createdAt).getTime() >= cutoff24h) {
      recentEmails.add(canonicalizeEmail(o.email));
    }
    if (o.paymentStatus !== "paid") {
      decayedUnpaidWeight += Math.exp(-ageHours / 4);
    }
  }

  if (decayedUnpaidWeight >= 3.2) {
    velocityGraphScore += 48;
    addSignal("unpaid_order_burst", "velocityGraph", "critical", 48, "Rafale de commandes impayées", `Poids de vélocité impayée élevé (${decayedUnpaidWeight.toFixed(1)} commandes récentes non réglées).`);
  } else if (decayedUnpaidWeight >= 1.8) {
    velocityGraphScore += 26;
    addSignal("multiple_unpaid_recent", "velocityGraph", "high", 26, "Plusieurs commandes impayées récentes", `${linkedOrders.filter((o) => o.paymentStatus !== "paid").length} commande(s) non payée(s) récemment.`);
  }

  if (recentEmails.size >= 3) {
    velocityGraphScore += 38;
    addSignal("multi_email_velocity", "velocityGraph", "high", 38, "Rotation d'adresses e-mail", `${recentEmails.size} e-mails différents utilisés sur les dernières 24h depuis la même origine.`);
  } else if (recentEmails.size === 2 && linkedOrders.filter((o) => o.paymentStatus !== "paid").length >= 2) {
    velocityGraphScore += 20;
    addSignal("dual_email_unpaid", "velocityGraph", "medium", 20, "Changement d'e-mail entre commandes", "2 adresses e-mail utilisées avec des commandes impayées.");
  }

  if (user) {
    const accountAgeMin = (nowMs - new Date(user.createdAt).getTime()) / 60_000;
    if (accountAgeMin < 3 && (orderTotal >= 200 || isRescueContext)) {
      velocityGraphScore += 18;
      addSignal("fresh_account_high_action", "velocityGraph", "medium", 18, "Compte très récent (< 3 min)", "Action sensible (grosse commande ou secours) juste après création du compte.");
    }
  }

  velocityGraphScore = Math.min(100, velocityGraphScore);

  // =========================================================================
  // DIMENSION 4 : PAIEMENT & TRANSACTIONS (0-100)
  // =========================================================================
  let paymentScore = 0;

  if (typeof fastDeclarationSec === "number") {
    if (fastDeclarationSec < 9) {
      paymentScore += 52;
      addSignal("fast_declaration_critical", "payment", "critical", 52, "Déclaration « J'ai payé » en < 9s", `Bouton cliqué en ${fastDeclarationSec}s : vérifiez impérativement votre banque avant envoi.`);
    } else if (fastDeclarationSec < 20) {
      paymentScore += 26;
      addSignal("fast_declaration_warn", "payment", "high", 26, "Déclaration de paiement très rapide", `Bouton cliqué en ${fastDeclarationSec}s (vérification bancaire conseillée).`);
    }
  }

  // Vérifier si des commandes liées ont déjà eu des déclarations rapides ou multiples impayés
  const declaredUnpaidOrders = linkedOrders.filter((o) => o.paymentStatus === "declaration_sent");
  const paidOrders = linkedOrders.filter((o) => o.paymentStatus === "paid");
  const unpaidOrders = linkedOrders.filter((o) => o.paymentStatus !== "paid");

  if (declaredUnpaidOrders.length >= 2 && paidOrders.length === 0) {
    paymentScore += 36;
    addSignal("repeated_unverified_declarations", "payment", "critical", 36, "Déclarations répétées non encaissées", `${declaredUnpaidOrders.length} paiements déclarés sans aucun règlement confirmé.`);
  }
  if (unpaidOrders.length >= 4 && paidOrders.length === 0) {
    paymentScore += 30;
    addSignal("high_unpaid_ratio", "payment", "high", 30, "Historique uniquement impayé", `${unpaidOrders.length} commandes créées, 0 réglée.`);
  }

  // Remonter un score élevé existant sur une commande liée (ex: déclaration rapide antérieure)
  const maxLinkedOrderRisk = linkedOrders.reduce((mx, o) => Math.max(mx, Number(o.riskScore || 0)), 0);
  if (maxLinkedOrderRisk >= 45 && paymentScore < 35) {
    const fastReason = linkedOrders.find((o) => (o.fraudReasons || []).some((r) => /déclaration|virement cliquée/i.test(r)));
    if (fastReason) {
      paymentScore += 38;
      addSignal("linked_order_fast_decl", "payment", "high", 38, "Commande liée suspecte", `La commande #${fastReason.orderId} présente une déclaration rapide suspecte.`);
    }
  }

  if ((orderTotal >= 450 || orderQuantity >= 5) && paidOrders.length === 0) {
    paymentScore += 28;
    addSignal("very_high_first_cart", "payment", "high", 28, "Premier panier très élevé", `Montant de ${orderTotal} € (${orderQuantity} articles) sans historique payé.`);
  } else if ((orderTotal >= 280 || orderQuantity >= 4) && paidOrders.length === 0) {
    paymentScore += 18;
    addSignal("high_first_cart", "payment", "medium", 18, "Panier élevé à vérifier", `${orderTotal} € / ${orderQuantity} articles sur un nouveau client.`);
  }

  if (isRescueContext && linkedOrders.length === 0 && !user) {
    paymentScore += 22;
    addSignal("unmatched_rescue_claim", "payment", "medium", 22, "Secours sans commande trouvée", "Ticket de secours soumis sans commande correspondante dans la base (vérifier le relevé bancaire).");
  }

  const recentRescues = (rescueClaims || []).filter(
    (c) => cleanEmail && canonicalizeEmail(c.email) === cleanEmail && nowMs - new Date(c.createdAt).getTime() < 24 * 3_600_000
  );
  if (recentRescues.length >= 2) {
    paymentScore += 24;
    addSignal("multiple_rescue_claims", "payment", "high", 24, "Multiples tickets secours en 24h", `${recentRescues.length} réclamations secours soumises en moins de 24h.`);
  }

  paymentScore = Math.min(100, paymentScore);

  // =========================================================================
  // DIMENSION 5 : LINGUISTIQUE & INGÉNIERIE SOCIALE (0-100)
  // =========================================================================
  let linguisticScore = 0;
  const fullText = String(messagesText || "").trim();

  if (fullText) {
    if (CHARGEBACK_PATTERNS.some((p) => p.test(fullText))) {
      linguisticScore += 55;
      addSignal("chargeback_threat", "linguistic", "critical", 55, "Menace de chargeback / opposition", "Le message mentionne un litige bancaire, PayPal ou une opposition.");
    }
    if (SOCIAL_ENG_PATTERNS.some((p) => p.test(fullText))) {
      linguisticScore += 42;
      addSignal("social_engineering", "linguistic", "high", 42, "Ingénierie sociale / Pression", "Demande d'accès avant paiement, gratuité ou lien externe non officiel.");
    }
  }

  // Détection de spam / rafale de messages dans la discussion
  if (Array.isArray(customerMessages) && customerMessages.length >= 5) {
    const last6 = customerMessages.slice(-6);
    const spanMs =
      new Date(last6[last6.length - 1].createdAt).getTime() - new Date(last6[0].createdAt).getTime();
    if (last6.length >= 6 && spanMs >= 0 && spanMs < 60_000) {
      linguisticScore += 26;
      addSignal("chat_spam_burst", "linguistic", "high", 26, "Rafale de spam dans le chat", "6 messages envoyés en moins d'une minute.");
    }
    const texts = customerMessages.slice(-5).map((m) => String(m.text || "").trim().toLowerCase()).filter(Boolean);
    const uniqueRatio = texts.length > 0 ? new Set(texts).size / texts.length : 1;
    if (texts.length >= 4 && uniqueRatio <= 0.4) {
      linguisticScore += 22;
      addSignal("duplicate_spam_messages", "linguistic", "medium", 22, "Messages copiés-collés en boucle", "Répétition identique des mêmes messages.");
    }
  }

  linguisticScore = Math.min(100, linguisticScore);

  // =========================================================================
  // DIMENSION 6 : BONUS DE CONFIANCE / RÉPUTATION (0 à -35)
  // =========================================================================
  let trustBonus = 0;
  const hasCriticalHardRisk =
    signals.some((s) => ["honeypot_triggered", "blacklisted", "chargeback_threat", "fast_declaration_critical", "webdriver_detected", "order_enumeration"].includes(s.code));

  if (!hasCriticalHardRisk) {
    if (isWhitelisted) {
      trustBonus -= 40;
      addSignal("admin_whitelisted", "trust", "positive", -40, "Client validé fiable (Whitelist)", "Marqué manuellement comme client de confiance par l'administrateur.");
    }

    const deliveredPaid = paidOrders.filter((o) => o.deliveryStatus === "delivered").length;
    if (deliveredPaid > 0) {
      const reduction = Math.min(30, deliveredPaid * 15);
      trustBonus -= reduction;
      addSignal("verified_order_history", "trust", "positive", -reduction, "Historique d'achats confirmés", `${deliveredPaid} commande(s) payée(s) et livrée(s) sans incident.`);
    }

    if (user && user.status === "active") {
      const ageHours = (nowMs - new Date(user.createdAt).getTime()) / 3_600_000;
      if (ageHours >= 168) {
        trustBonus -= 12;
        addSignal("aged_account", "trust", "positive", -12, "Compte ancien (> 7 jours)", "Compte client actif et établi sur le site.");
      } else if (ageHours >= 24) {
        trustBonus -= 6;
        addSignal("established_account", "trust", "positive", -6, "Compte authentifié (> 24h)", "Client connecté avec un compte actif.");
      }
    }

    if (
      telemetry &&
      telemetry.totalDurationMs >= 30_000 &&
      telemetry.maxScrollDepthPct >= 25 &&
      telemetry.pointerMoves >= 15 &&
      !telemetry.webdriverDetected &&
      (telemetry.viewedProducts.length >= 1 || telemetry.sectionsVisited.includes("guide") || telemetry.sectionsVisited.includes("faq"))
    ) {
      trustBonus -= 8;
      addSignal("organic_human_journey", "trust", "positive", -8, "Navigation organique humaine", "Parcours naturel sur le site (lecture des offres/guide, scroll et interactions régulières).");
    }
  }

  // =========================================================================
  // COMBINAISON NON-LINÉAIRE + AMPLIFICATEUR DE CONVERGENCE MULTI-VECTEUR
  // =========================================================================
  const riskDims = [identityScore, behavioralScore, velocityGraphScore, paymentScore, linguisticScore];
  const maxDim = Math.max(...riskDims);
  const weightedSum =
    identityScore * 0.28 +
    behavioralScore * 0.25 +
    velocityGraphScore * 0.24 +
    paymentScore * 0.30 +
    linguisticScore * 0.25;

  // On combine la pire dimension (65%) + l'accumulation transversale (55%) pour ne pas diluer un gros signal unique
  let combined = Math.max(maxDim, Math.round(maxDim * 0.65 + weightedSum * 0.55));

  const activeRiskDims = riskDims.filter((v) => v >= 22).length;
  if (activeRiskDims >= 3) {
    combined += 18;
    addSignal("multi_vector_convergence", "velocityGraph", "high", 18, "Convergence multi-facteurs", `${activeRiskDims} dimensions de risque indépendantes se cumulent simultanément.`);
  } else if (activeRiskDims === 2) {
    combined += 10;
  }

  // Intégrer aussi le score historique d'une commande liée si pertinent
  if (maxLinkedOrderRisk > combined && !isWhitelisted) {
    combined = Math.round(combined * 0.4 + maxLinkedOrderRisk * 0.6);
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(combined + trustBonus)));

  // Calcul de l'indice de confiance du diagnostic (basé sur la richesse des signaux disponibles)
  let confidence = 35;
  if (telemetry) {
    confidence += 22;
    if (telemetry.totalDurationMs >= 5000 || telemetry.recentEvents.length >= 3) confidence += 10;
    if (telemetry.deviceFingerprints.length > 0) confidence += 8;
  }
  if (user) confidence += 10;
  if (linkedOrders.length > 0) confidence += 10;
  if (fullText.length >= 15) confidence += 5;
  confidence = Math.min(99, confidence);

  const blocked =
    !isWhitelisted &&
    (finalScore >= 92 ||
      signals.some((s) => s.code === "webdriver_detected" && behavioralScore >= 75));

  return buildFinalAssessment({
    signals,
    dimensions: {
      identity: identityScore,
      behavioral: behavioralScore,
      velocityGraph: velocityGraphScore,
      payment: paymentScore,
      linguistic: linguisticScore,
      trustBonus
    },
    forcedScore: finalScore,
    blocked,
    confidence,
    telemetry,
    linkedUsersCount: correlatedUsers.size,
    linkedOrders
  });
}

function buildFinalAssessment({
  signals,
  dimensions,
  forcedScore,
  blocked,
  confidence,
  telemetry,
  linkedUsersCount,
  linkedOrders
}) {
  const score = Math.max(0, Math.min(100, Math.round(forcedScore)));
  const level = score >= 70 ? "critical" : score >= 45 ? "elevated" : score >= 25 ? "moderate" : "low";

  let recommendedAction = "allow";
  let recommendationLabel = "Client normal — aucune anomalie majeure détectée.";
  if (blocked || score >= 85) {
    recommendedAction = "block";
    recommendationLabel = "🚨 Risque critique : bloquer ou exiger une vérification bancaire complète avant toute action.";
  } else if (score >= 70) {
    recommendedAction = "verify_payment_first";
    recommendationLabel = "🚨 Fraude probable : vérifiez impérativement la réception réelle des fonds sur votre banque avant d'envoyer les accès.";
  } else if (score >= 45) {
    recommendedAction = "manual_review";
    recommendationLabel = "⚠️ Risque élevé : vérifiez le relevé bancaire et l'identité avant livraison.";
  } else if (score >= 25) {
    recommendedAction = "monitor";
    recommendationLabel = "👁️ Surveillance légère : quelques signaux atypiques observés sur le parcours.";
  } else if (dimensions.trustBonus <= -15) {
    recommendedAction = "fast_track";
    recommendationLabel = "🛡️ Client fiable et établi : traitement prioritaire en toute confiance.";
  }

  const riskReasons = signals.filter((s) => s.weight > 0).map((s) => `${s.label} — ${s.detail}`);

  const siteJourneySummary = telemetry
    ? {
        firstSeenAt: telemetry.firstSeenAt,
        lastSeenAt: telemetry.lastSeenAt,
        sessionCount: telemetry.sessionCount || 1,
        totalDurationSec: Math.round((telemetry.totalDurationMs || 0) / 1000),
        maxScrollDepthPct: telemetry.maxScrollDepthPct || 0,
        sectionsVisited: telemetry.sectionsVisited || [],
        viewedProducts: telemetry.viewedProducts || [],
        cartAdds: telemetry.cartAdds || 0,
        couponFailures: telemetry.couponFailures || 0,
        orderLookupFailures: telemetry.orderLookupFailures || 0,
        checkoutOpens: telemetry.checkoutOpens || 0,
        checkoutAbandons: telemetry.checkoutAbandons || 0,
        paymentMethodSwitches: telemetry.paymentMethodSwitches || 0,
        loginFailures: telemetry.loginFailures || 0,
        pointerMoves: telemetry.pointerMoves || 0,
        clickCount: telemetry.clickCount || 0,
        keyEvents: telemetry.keyEvents || 0,
        pasteCount: telemetry.pasteCount || 0,
        webdriverDetected: Boolean(telemetry.webdriverDetected),
        userAgentSummary: telemetry.userAgentSummary || "",
        timezone: telemetry.timezone || "",
        language: telemetry.language || "",
        screenSize: telemetry.screenSize || "",
        linkedUsersCount,
        linkedOrdersCount: linkedOrders.length,
        recentEvents: (telemetry.recentEvents || []).slice(0, 15)
      }
    : null;

  return {
    score,
    level,
    confidence,
    blocked,
    recommendedAction,
    recommendationLabel,
    dimensions,
    signals,
    reasons: riskReasons,
    siteJourneySummary
  };
}

/**
 * Évalue le risque de fraude lors d'une création de commande (point d'entrée compatible)
 */
export function evaluateOrderFraud({
  email,
  customerName,
  total,
  totalQuantity,
  clientHash,
  deviceFingerprint = "",
  visitorId = "",
  userId = null,
  formFillMs = null,
  honeypot = "",
  existingOrders = [],
  allUsers = [],
  rescueClaims = [],
  visitorProfiles = {},
  inlineSnapshot = null,
  security = {},
  blockedEmails = [],
  blockedHashes = []
}) {
  const mergedSecurity = {
    ...security,
    blockedEmails: security.blockedEmails || blockedEmails,
    blockedHashes: security.blockedHashes || blockedHashes
  };

  return computeComprehensiveFraudRisk({
    email,
    customerName,
    userId,
    clientHash,
    deviceFingerprint,
    visitorId,
    orderTotal: Number(total) || 0,
    orderQuantity: Number(totalQuantity) || 0,
    formFillMs,
    honeypot,
    existingOrders,
    allUsers,
    rescueClaims,
    visitorProfiles,
    inlineSnapshot,
    security: mergedSecurity
  });
}

/**
 * Vérifie si une déclaration manuelle "J'ai payé" (SEPA / PayPal.Me) est suspecte
 */
export function evaluateFastDeclarationFraud(order) {
  const createdMs = new Date(order.createdAt).getTime();
  const elapsedSec = Math.max(0, Math.round((Date.now() - createdMs) / 1000));
  if (elapsedSec < 9) {
    return {
      suspicious: true,
      severity: "critical",
      elapsedSec,
      addedScore: 50,
      reason: `Déclaration de virement cliquée en seulement ${elapsedSec}s (vérifiez impérativement votre banque avant d'envoyer les accès)`
    };
  }
  if (elapsedSec < 20) {
    return {
      suspicious: true,
      severity: "high",
      elapsedSec,
      addedScore: 25,
      reason: `Déclaration de paiement très rapide (${elapsedSec}s) — vérifiez la réception effective des fonds`
    };
  }
  return { suspicious: false, severity: "none", elapsedSec, addedScore: 0, reason: null };
}

/**
 * Formate une durée d'attente claire en français
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
 * Détermine l'ensemble structuré des flags précis pour une entité (Discussion / Commande / Client)
 */
function resolveFlagList(autoFlagReasons, manualFlags = {}) {
  const resolved = [];
  for (const def of FLAG_DEFINITIONS) {
    const manualVal = manualFlags?.[def.id];
    // Rétro-compatibilité avec les anciens noms manuels (fraud -> fraud_risk, fastHelp -> fast_help)
    const legacyManual =
      def.id === "fraud_risk"
        ? manualFlags?.fraud
        : def.id === "fast_help"
        ? manualFlags?.fastHelp
        : undefined;

    const effectiveManual = manualVal !== undefined ? manualVal : legacyManual;
    const autoReason = autoFlagReasons.get(def.id) || null;

    if (effectiveManual === true) {
      resolved.push({
        ...def,
        source: "manual",
        reason: autoReason || "Activé manuellement par l'administrateur"
      });
    } else if (effectiveManual === false) {
      // Explicitement levé par l'administrateur
      continue;
    } else if (autoReason) {
      resolved.push({
        ...def,
        source: "auto",
        reason: autoReason
      });
    }
  }
  return resolved;
}

/**
 * Calcule l'ensemble des flags précis, l'analyse émotionnelle et le diagnostic anti-fraude complet
 * pour un fil de discussion dans le panneau Admin.
 */
export function computeDiscussionDiagnostics(
  thread,
  allOrders = [],
  {
    allUsers = [],
    allDiscussions = [],
    rescueClaims = [],
    visitorProfiles = {},
    security = {},
    nowMs = Date.now()
  } = {}
) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const customerMessages = messages.filter((m) => m.sender === "customer");
  const lastMsg = messages[messages.length - 1] || null;
  const isResolved = thread.status === "resolved";

  // 1. Calcul du temps d'attente depuis le premier message client resté sans réponse admin
  let waitingSince = null;
  let consecutiveUnansweredCount = 0;
  if (!isResolved && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "admin") break;
      if (messages[i].sender === "customer") {
        waitingSince = messages[i].createdAt;
        consecutiveUnansweredCount += 1;
      }
    }
  }

  const waitingMinutes = waitingSince ? Math.floor((nowMs - new Date(waitingSince).getTime()) / 60000) : 0;
  const waitingLabel = waitingSince ? formatWaitingDuration(waitingSince, nowMs) : null;
  const waitingLevel = !waitingSince
    ? "none"
    : waitingMinutes >= 20
    ? "critical"
    : waitingMinutes >= 8
    ? "warning"
    : "normal";

  // Utilisateur & commandes liés
  const cleanEmail = canonicalizeEmail(thread.customerEmail);
  const linkedUser =
    (thread.userId ? allUsers.find((u) => u.id === thread.userId) : null) ||
    (cleanEmail ? allUsers.find((u) => canonicalizeEmail(u.email) === cleanEmail) : null) ||
    null;

  const linkedOrders = allOrders.filter(
    (o) =>
      (thread.orderId && o.orderId === thread.orderId) ||
      (linkedUser && o.userId && o.userId === linkedUser.id) ||
      (cleanEmail && canonicalizeEmail(o.email) === cleanEmail) ||
      (thread.deviceFingerprint && o.deviceFingerprint && o.deviceFingerprint === thread.deviceFingerprint) ||
      (thread.clientHash && o.clientHash && o.clientHash === thread.clientHash)
  );

  const combinedCustomerText = customerMessages.map((m) => m.text || "").join(" \n ");
  const recentCustomerText = customerMessages
    .slice(-5)
    .map((m) => m.text || "")
    .join(" \n ");

  // 2. Évaluation Anti-Fraude Complète en 6 Dimensions + Suivi Site
  const maxOrderTotal = linkedOrders.reduce((mx, o) => Math.max(mx, Number(o.total || 0)), 0);
  const fraudAssessment = computeComprehensiveFraudRisk({
    email: cleanEmail || linkedUser?.email || "",
    customerName: thread.customerName || linkedUser?.name || "",
    userId: linkedUser?.id || thread.userId || null,
    clientHash: thread.clientHash || linkedUser?.lastClientHash || "",
    deviceFingerprint: thread.deviceFingerprint || linkedUser?.lastDeviceFingerprint || "",
    visitorId: thread.visitorId || "",
    orderTotal: maxOrderTotal,
    messagesText: combinedCustomerText,
    customerMessages,
    existingOrders: allOrders,
    allUsers,
    allDiscussions,
    rescueClaims,
    visitorProfiles,
    security,
    isRescueContext: thread.topicType === "rescue"
  });

  // Fusionner d'éventuelles raisons historiques attachées au thread
  const fraudReasons = [...fraudAssessment.reasons];
  for (const r of thread.fraudReasons || []) {
    if (r && !fraudReasons.includes(r)) fraudReasons.push(r);
  }
  const effectiveRiskScore = Math.max(Number(thread.riskScore || 0), fraudAssessment.score);

  // 3. Collecte automatique de tous les Flags Précis
  const autoFlags = new Map();
  const signalCodes = new Set(fraudAssessment.signals.map((s) => s.code));

  // --- Flags Sécurité & Fraude ---
  if (effectiveRiskScore >= 70) {
    autoFlags.set("fraud_critical", `Score de risque critique (${effectiveRiskScore}/100, confiance ${fraudAssessment.confidence}%).`);
  } else if (effectiveRiskScore >= 45) {
    autoFlags.set("fraud_risk", `Score de risque élevé (${effectiveRiskScore}/100, confiance ${fraudAssessment.confidence}%).`);
  } else if (effectiveRiskScore >= 25) {
    autoFlags.set("fraud_watch", `Anomalies légères observées (${effectiveRiskScore}/100).`);
  }

  if (
    signalCodes.has("honeypot_triggered") ||
    signalCodes.has("webdriver_detected") ||
    signalCodes.has("headless_signals") ||
    signalCodes.has("robotic_form_speed") ||
    signalCodes.has("zero_human_telemetry")
  ) {
    autoFlags.set("bot_automation", "Comportement automatisé ou robotique détecté sur le site.");
  }

  if (
    signalCodes.has("fast_declaration_critical") ||
    signalCodes.has("fast_declaration_warn") ||
    signalCodes.has("linked_order_fast_decl") ||
    signalCodes.has("repeated_unverified_declarations")
  ) {
    autoFlags.set("fast_fake_payment", "Déclaration de paiement suspecte ou ultra-rapide détectée.");
  }

  if (
    signalCodes.has("multi_account_cluster") ||
    signalCodes.has("multi_account_pair") ||
    signalCodes.has("email_alias_abuse") ||
    signalCodes.has("multi_email_velocity")
  ) {
    autoFlags.set("multi_account", "Plusieurs comptes ou alias e-mail corrélés sur la même empreinte.");
  }

  if (signalCodes.has("disposable_email")) {
    autoFlags.set("disposable_email", "Adresse e-mail jetable / temporaire utilisée.");
  }

  if (signalCodes.has("chargeback_threat")) {
    autoFlags.set("chargeback_threat", "Mention de litige, chargeback ou opposition bancaire dans le chat.");
  }

  if (signalCodes.has("social_engineering")) {
    autoFlags.set("social_engineering", "Tentative de pression, demande d'accès avant paiement ou lien suspect.");
  }

  if (
    signalCodes.has("coupon_bruteforce") ||
    signalCodes.has("coupon_probing") ||
    signalCodes.has("order_enumeration") ||
    signalCodes.has("order_lookup_probing") ||
    signalCodes.has("credential_stuffing") ||
    signalCodes.has("payment_method_probing")
  ) {
    autoFlags.set("site_probing", "Probing ou abus détecté lors du parcours sur le site.");
  }

  // --- Flags Émotionnels & Tonaux ---
  const hasCapsShouting = customerMessages.slice(-5).some((cm) => {
    const letters = String(cm.text || "").replace(/[^a-zA-ZÀ-ÿ]/g, "");
    if (letters.length < 14) return false;
    const upper = letters.replace(/[^A-ZÀ-Ý]/g, "").length;
    return upper / letters.length > 0.68;
  });

  const isAutoFurious =
    FURIOUS_PATTERNS.some((p) => p.test(recentCustomerText)) ||
    (hasCapsShouting && ANNOYED_PATTERNS.some((p) => p.test(recentCustomerText)));

  if (isAutoFurious) {
    autoFlags.set("furious_escalation", "Vocabulaire très accusateur, colère intense ou menace d'escalade.");
  }

  const isAutoAnnoyed =
    !isAutoFurious &&
    (ANNOYED_PATTERNS.some((p) => p.test(recentCustomerText)) ||
      hasCapsShouting ||
      (consecutiveUnansweredCount >= 3 && waitingMinutes >= 4));

  if (isAutoAnnoyed) {
    autoFlags.set(
      "annoyed",
      consecutiveUnansweredCount >= 3
        ? `${consecutiveUnansweredCount} relances consécutives sans réponse ou ton impatient.`
        : "Ton agacé, impatient ou ponctuation insistante détectée."
    );
  }

  if (ANXIOUS_PATTERNS.some((p) => p.test(recentCustomerText))) {
    autoFlags.set("anxious_worried", "Le client exprime de l'inquiétude au sujet de son paiement ou de la livraison.");
  }

  if (CONFUSED_PATTERNS.some((p) => p.test(recentCustomerText))) {
    autoFlags.set("confused_needs_guide", "Le client cherche à comprendre une étape d'achat ou d'activation.");
  }

  if (
    !isAutoFurious &&
    !isAutoAnnoyed &&
    POSITIVE_PATTERNS.some((p) => p.test(recentCustomerText))
  ) {
    autoFlags.set("positive_satisfied", "Ton positif, remerciement ou satisfaction exprimée.");
  }

  // --- Flags Urgence & Opérations ---
  if (thread.topicType === "rescue") {
    autoFlags.set("rescue_sos", "Ticket de Secours Paiement prioritaire.");
  }

  const hasPendingPaidOrder = linkedOrders.some(
    (o) => (o.paymentStatus === "paid" || o.paymentStatus === "declaration_sent") && o.deliveryStatus !== "delivered"
  );
  if (hasPendingPaidOrder) {
    autoFlags.set("paid_undelivered", "Commande payée ou déclarée en attente de livraison d'accès.");
  }

  if (TECHNICAL_ISSUE_PATTERNS.some((p) => p.test(recentCustomerText))) {
    autoFlags.set("technical_issue", "Bug, identifiant refusé ou difficulté technique mentionnée.");
  }

  if (!isResolved && waitingMinutes >= 10) {
    autoFlags.set("waiting_long", `Client sans réponse depuis ${waitingMinutes} min.`);
  }

  const hasUrgentKeywords = URGENT_HELP_PATTERNS.some((p) => p.test(recentCustomerText));
  if (
    !isResolved &&
    (thread.topicType === "rescue" ||
      isAutoFurious ||
      isAutoAnnoyed ||
      hasPendingPaidOrder ||
      hasUrgentKeywords ||
      autoFlags.has("technical_issue") ||
      waitingMinutes >= 12)
  ) {
    autoFlags.set("fast_help", "Traitement prioritaire recommandé.");
  }

  // --- Flags Profil Commercial & Confiance ---
  const paidOrders = linkedOrders.filter((o) => o.paymentStatus === "paid");
  const totalSpent = paidOrders.reduce((acc, o) => acc + Number(o.total || 0), 0);

  if ((paidOrders.length >= 2 || totalSpent >= 250) && effectiveRiskScore < 45) {
    autoFlags.set("vip_loyal", `Client fidèle (${paidOrders.length} commande(s) payée(s), ${totalSpent} €).`);
  }

  if (maxOrderTotal >= 250 || linkedOrders.some((o) => (o.items || []).reduce((s, i) => s + i.quantity, 0) >= 3)) {
    autoFlags.set("high_value_cart", `Commande à forte valeur (${maxOrderTotal} €).`);
  }

  const journey = fraudAssessment.siteJourneySummary;
  if (
    !isResolved &&
    paidOrders.length === 0 &&
    (READY_TO_BUY_PATTERNS.some((p) => p.test(recentCustomerText)) ||
      (thread.topicType === "product" && journey && (journey.cartAdds > 0 || journey.viewedProducts.length >= 1)))
  ) {
    autoFlags.set("ready_to_buy", "Forte intention d'achat pré-commande détectée.");
  }

  if (linkedUser && linkedUser.status === "active") {
    autoFlags.set("verified_account", `Compte NEXUS actif (${linkedUser.email}).`);
  }

  if (
    linkedUser?.trustedOverride === true ||
    (cleanEmail && (security?.trustedEmails || []).includes(cleanEmail))
  ) {
    autoFlags.set("trusted_verified", "Validé client fiable par l'administrateur.");
  }

  // Fusionner les overrides manuels (du thread + du compte client lié)
  const mergedManualFlags = {
    ...(linkedUser?.manualFlags || {}),
    ...(thread.manualFlags || {})
  };
  const flags = resolveFlagList(autoFlags, mergedManualFlags);
  const flagIds = flags.map((f) => f.id);

  // Rétro-compatibilité booléens clés
  const isSuspectedFraud =
    mergedManualFlags.fraud === true ||
    flagIds.includes("fraud_critical") ||
    flagIds.includes("fraud_risk") ||
    flagIds.includes("bot_automation") ||
    flagIds.includes("fast_fake_payment") ||
    flagIds.includes("chargeback_threat");

  const isFurious = flagIds.includes("furious_escalation");
  const isAnnoyed = isFurious || flagIds.includes("annoyed");
  const needsFastHelp =
    !isResolved &&
    (flagIds.includes("fast_help") ||
      flagIds.includes("rescue_sos") ||
      flagIds.includes("paid_undelivered") ||
      isFurious);

  // Sentiment principal synthétique
  const sentiment = isFurious
    ? "furious"
    : flagIds.includes("annoyed")
    ? "annoyed"
    : flagIds.includes("anxious_worried")
    ? "anxious"
    : flagIds.includes("confused_needs_guide")
    ? "confused"
    : flagIds.includes("positive_satisfied")
    ? "positive"
    : "neutral";

  // Score de priorité intelligent pour remonter les cas critiques en haut
  let priorityScore = 0;
  if (!isResolved) {
    priorityScore += 100;
    if (waitingSince) priorityScore += 200 + Math.min(200, waitingMinutes * 4);
    if (flagIds.includes("rescue_sos")) priorityScore += 400;
    if (flagIds.includes("paid_undelivered")) priorityScore += 340;
    if (isFurious) priorityScore += 330;
    if (flagIds.includes("chargeback_threat")) priorityScore += 310;
    if (needsFastHelp) priorityScore += 260;
    if (flagIds.includes("annoyed")) priorityScore += 210;
    if (flagIds.includes("anxious_worried")) priorityScore += 150;
    if (flagIds.includes("vip_loyal")) priorityScore += 140;
    if (isSuspectedFraud) priorityScore += 110;
    if (flagIds.includes("ready_to_buy")) priorityScore += 90;
  }

  return {
    isResolved,
    waitingSince,
    waitingMinutes,
    waitingLabel,
    waitingLevel,
    isSuspectedFraud,
    riskScore: Math.min(100, effectiveRiskScore),
    riskLevel: fraudAssessment.level,
    riskConfidence: fraudAssessment.confidence,
    recommendedAction: fraudAssessment.recommendedAction,
    recommendationLabel: fraudAssessment.recommendationLabel,
    fraudReasons,
    fraudAssessment,
    flags,
    flagIds,
    sentiment,
    isFurious,
    isAnnoyed,
    isAnxious: flagIds.includes("anxious_worried"),
    needsFastHelp,
    hasPendingPaidOrder,
    isAccountHolder: Boolean(linkedUser),
    accountId: linkedUser?.id || null,
    accountStatus: linkedUser?.status || null,
    linkedOrderIds: linkedOrders.map((o) => o.orderId),
    lastMessagePreview: lastMsg ? String(lastMsg.text || "").slice(0, 105) : "Discussion démarrée",
    lastActivityAt: lastMsg ? lastMsg.createdAt : thread.createdAt,
    unreadByAdmin: Number(thread.unreadByAdmin || 0),
    priorityScore
  };
}

/**
 * Synthèse complète d'un compte client ou d'un visiteur pour le nouvel onglet Admin "Clients & Anti-Fraude"
 */
export function computeCustomerProfileAssessment(
  user,
  { allOrders = [], allUsers = [], allDiscussions = [], rescueClaims = [], visitorProfiles = {}, security = {} } = {}
) {
  const cleanEmail = canonicalizeEmail(user.email);
  const userOrders = allOrders.filter(
    (o) => (o.userId && o.userId === user.id) || canonicalizeEmail(o.email) === cleanEmail
  );
  const userDiscussions = allDiscussions.filter(
    (t) => (t.userId && t.userId === user.id) || canonicalizeEmail(t.customerEmail) === cleanEmail
  );
  const customerMessages = userDiscussions.flatMap((t) => (t.messages || []).filter((m) => m.sender === "customer"));
  const combinedText = customerMessages.map((m) => m.text || "").join(" \n ");

  const paidOrders = userOrders.filter((o) => o.paymentStatus === "paid");
  const totalSpent = Math.round(paidOrders.reduce((s, o) => s + Number(o.total || 0), 0) * 100) / 100;
  const maxOrder = userOrders.reduce((mx, o) => Math.max(mx, Number(o.total || 0)), 0);

  const fraudAssessment = computeComprehensiveFraudRisk({
    email: cleanEmail,
    customerName: user.name,
    userId: user.id,
    clientHash: user.lastClientHash || "",
    deviceFingerprint: user.lastDeviceFingerprint || "",
    visitorId: user.lastVisitorId || "",
    orderTotal: maxOrder,
    messagesText: combinedText,
    customerMessages,
    existingOrders: allOrders,
    allUsers,
    allDiscussions,
    rescueClaims,
    visitorProfiles,
    security
  });

  const autoFlags = new Map();
  const codes = new Set(fraudAssessment.signals.map((s) => s.code));

  if (fraudAssessment.score >= 70) autoFlags.set("fraud_critical", `Risque critique (${fraudAssessment.score}/100).`);
  else if (fraudAssessment.score >= 45) autoFlags.set("fraud_risk", `Risque élevé (${fraudAssessment.score}/100).`);
  else if (fraudAssessment.score >= 25) autoFlags.set("fraud_watch", `Sous surveillance (${fraudAssessment.score}/100).`);

  if (codes.has("webdriver_detected") || codes.has("headless_signals") || codes.has("robotic_form_speed")) {
    autoFlags.set("bot_automation", "Indicateurs d'automatisation détectés.");
  }
  if (codes.has("fast_declaration_critical") || codes.has("linked_order_fast_decl") || codes.has("repeated_unverified_declarations")) {
    autoFlags.set("fast_fake_payment", "Déclaration de paiement rapide ou non encaissée.");
  }
  if (codes.has("multi_account_cluster") || codes.has("multi_account_pair") || codes.has("email_alias_abuse")) {
    autoFlags.set("multi_account", "Plusieurs comptes ou alias corrélés.");
  }
  if (codes.has("disposable_email")) autoFlags.set("disposable_email", "Domaine mail jetable.");
  if (codes.has("chargeback_threat")) autoFlags.set("chargeback_threat", "Mention de litige/chargeback.");
  if (codes.has("social_engineering")) autoFlags.set("social_engineering", "Pression ou lien suspect.");
  if (codes.has("coupon_bruteforce") || codes.has("order_enumeration") || codes.has("credential_stuffing")) {
    autoFlags.set("site_probing", "Probing ou abus observé sur le site.");
  }
  if ((paidOrders.length >= 2 || totalSpent >= 250) && fraudAssessment.score < 45) {
    autoFlags.set("vip_loyal", `${paidOrders.length} commande(s) payée(s) — ${totalSpent} €.`);
  }
  if (user.status === "active") autoFlags.set("verified_account", "Compte client actif.");
  if (user.trustedOverride || (security?.trustedEmails || []).includes(cleanEmail)) {
    autoFlags.set("trusted_verified", "Client fiable (Whitelist).");
  }

  const flags = resolveFlagList(autoFlags, user.manualFlags || {});

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status || "active",
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    ordersCount: userOrders.length,
    paidOrdersCount: paidOrders.length,
    totalSpent,
    discussionsCount: userDiscussions.length,
    trustedOverride: Boolean(user.trustedOverride),
    adminNotes: user.adminNotes || "",
    manualFlags: user.manualFlags || {},
    lastClientHash: user.lastClientHash || "",
    lastDeviceFingerprint: user.lastDeviceFingerprint || "",
    flags,
    flagIds: flags.map((f) => f.id),
    fraudAssessment
  };
}

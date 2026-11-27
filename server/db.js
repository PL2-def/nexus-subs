import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  encryptText,
  decryptText,
  encryptObject,
  decryptObject,
  createRollingBackupIfDue,
  hashToken,
  summarizeUserAgent
} from "./security.js";
import { scheduleRemoteSync } from "./remote-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "nexus-store.json");

const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_HASH = crypto.scryptSync("nexus-timing-equalization-dummy", DUMMY_SALT, 64).toString("hex");

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) {
    // Calcul factice anti-timing-attack même si le compte n'existe pas
    crypto.scryptSync(String(password || ""), DUMMY_SALT, 64);
    return false;
  }
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function dummyPasswordCheck(password = "") {
  return verifyPassword(password, DUMMY_SALT, DUMMY_HASH);
}

const DEFAULT_PRODUCTS = [
  {
    id: "youtube-premium",
    slug: "youtube-premium-1-an",
    title: "YouTube Premium",
    tagline: "Zéro publicité, lecture écran éteint & YouTube Music Premium inclus",
    price: 120,
    compareAtPrice: 155.88,
    currency: "€",
    billingPeriod: "an",
    duration: "12 mois (365 jours)",
    badge: "Essentiel Quotidien",
    badgeColor: "youtube",
    category: "streaming-video",
    categoryLabel: "Vidéo & Musique",
    accentColor: "#ef4444",
    accentGlow: "rgba(239, 68, 68, 0.22)",
    availability: "in_stock",
    stockCount: null,
    active: true,
    popular: false,
    sortOrder: 1,
    deliveryMode: "google_invite",
    shortFeatures: [
      "100% sans publicité sur TV, mobile, PC et console",
      "Lecture en arrière-plan et écran verrouillé",
      "YouTube Music Premium complet inclus (100M+ titres)",
      "Téléchargements hors-ligne Full HD 1080p Enhanced",
      "Activation officielle sur votre propre compte Google (sans mot de passe)"
    ],
    fullDescription:
      "Profitez de l'expérience YouTube ultime pendant 12 mois complets. Plus aucune coupure publicitaire sur Smart TV, smartphone, tablette ou ordinateur, avec l'accès intégral à YouTube Music Premium directement sur votre compte Google habituel.",
    detailedBenefits: [
      {
        title: "Zéro Publicité Partout",
        desc: "Regardez toutes vos vidéos sans aucune interruption sur Smart TV, iOS, Android, PC/Mac et consoles."
      },
      {
        title: "Écran Éteint & Arrière-plan",
        desc: "Continuez l'écoute de vos podcasts, musiques et vidéos tout en utilisant d'autres applications."
      },
      {
        title: "YouTube Music Premium Inclus",
        desc: "Accès illimité à plus de 100 millions de titres en haute qualité audio, sans pub et hors-connexion."
      },
      {
        title: "Sur Votre Compte Personnel",
        desc: "Conservez vos playlists, votre historique et vos abonnements : aucun mot de passe ne vous est demandé."
      }
    ],
    activationFormat: "Invitation officielle sur votre compte Google personnel (aucun mot de passe requis)",
    activationSteps: [
      "Indiquez votre adresse Gmail / Google lors du passage de commande.",
      "Recevez votre lien d'invitation officiel directement dans votre boîte de dialogue sur le site et/ou par e-mail.",
      "Cliquez sur le lien d'acceptation Google : votre compte passe immédiatement en Premium pour 12 mois."
    ],
    specs: [
      { label: "Durée garantie", value: "365 jours continus" },
      { label: "Appareils compatibles", value: "Smart TV, iOS, Android, PC/Mac, PS5/Xbox" },
      { label: "Compte utilisé", value: "Votre compte Google personnel (sans mot de passe)" },
      { label: "Livraison", value: "En direct sur le site et/ou par e-mail" },
      { label: "Garantie", value: "Continuité de service 365j & support 7j/7" }
    ]
  },
  {
    id: "psn-premium",
    slug: "psn-premium-1-an",
    title: "PlayStation Plus Premium",
    tagline: "Catalogue de 400+ jeux PS5/PS4, classiques rétro, cloud gaming & multijoueur",
    price: 130,
    compareAtPrice: 151.99,
    currency: "€",
    billingPeriod: "an",
    duration: "12 mois (365 jours)",
    badge: "Best-Seller Gaming",
    badgeColor: "playstation",
    category: "gaming",
    categoryLabel: "Gaming PS5 & PS4",
    accentColor: "#3b82f6",
    accentGlow: "rgba(59, 130, 246, 0.26)",
    availability: "in_stock",
    stockCount: 8,
    active: true,
    popular: true,
    sortOrder: 2,
    deliveryMode: "psn_account",
    shortFeatures: [
      "Catalogue géant de 400+ jeux PS5 & PS4 à télécharger",
      "Classiques PlayStation (PS1, PS2, PSP) & Cloud Streaming",
      "Multijoueur en ligne + jeux mensuels offerts",
      "Jouez depuis votre propre profil PSN habituel (trophées & amis)",
      "Identifiants dédiés complets et 100% modifiables"
    ],
    fullDescription:
      "Accédez au palier ultime de PlayStation Plus pendant 1 an complet. Téléchargez des centaines de hits PS5 et PS4, jouez en ligne avec vos amis, profitez du Cloud Gaming et conservez vos trophées sur votre profil personnel grâce au partage console officiel.",
    detailedBenefits: [
      {
        title: "400+ Jeux PS5 & PS4 Inclus",
        desc: "Accès illimité aux exclusivités PlayStation et grands blockbusters renouvelés chaque mois."
      },
      {
        title: "Partage Console sur Votre Profil",
        desc: "Activez le compte sur votre console et jouez normalement avec votre pseudo, vos amis et vos trophées."
      },
      {
        title: "Multijoueur & Cloud Streaming",
        desc: "Parties en ligne illimitées, 100 Go de sauvegardes cloud et streaming direct sans téléchargement."
      },
      {
        title: "Contrôle Total du Compte",
        desc: "Compte officiel pré-chargé 12 mois ou code selon arrivage, avec guide d'installation illustré."
      }
    ],
    activationFormat: "Compte PlayStation officiel pré-activé 12 mois compatible partage console PS5/PS4",
    activationSteps: [
      "Validez votre commande avec le moyen de paiement de votre choix (Carte/Stripe, PayPal ou SEPA Instant).",
      "Recevez vos identifiants dédiés directement dans votre fenêtre de suivi sur le site ou par e-mail.",
      "Ajoutez l'utilisateur sur votre PS5/PS4 et activez « Partage de console et jeu hors ligne ».",
      "Revenez sur votre profil habituel et profitez de tout le catalogue PS Plus Premium !"
    ],
    specs: [
      { label: "Durée garantie", value: "365 jours continus" },
      { label: "Consoles compatibles", value: "PlayStation 5 & PlayStation 4" },
      { label: "Trophées & Amis", value: "Conservés sur votre profil personnel" },
      { label: "Livraison", value: "En direct sur le site et/ou par e-mail" },
      { label: "Garantie", value: "Assistance & remplacement 365j inclus" }
    ]
  },
  {
    id: "netflix-premium",
    slug: "netflix-premium-1-an",
    title: "Netflix Premium 4K",
    tagline: "Ultra HD 4K, HDR / Dolby Vision, Audio Spatial & 4 écrans simultanés",
    price: 180,
    compareAtPrice: 239.88,
    currency: "€",
    billingPeriod: "an",
    duration: "12 mois (365 jours)",
    badge: "Cinéma 4K UHD",
    badgeColor: "netflix",
    category: "streaming-video",
    categoryLabel: "Séries & Cinéma 4K",
    accentColor: "#e50914",
    accentGlow: "rgba(229, 9, 20, 0.24)",
    availability: "in_stock",
    stockCount: 5,
    active: true,
    popular: false,
    sortOrder: 3,
    deliveryMode: "netflix_account",
    shortFeatures: [
      "Qualité maximale Ultra HD 4K + HDR10 & Dolby Vision",
      "Audio Spatial immersif sans équipement requis",
      "Jusqu'à 4 écrans simultanés & téléchargements sur 6 appareils",
      "Profil personnel dédié verrouillé par code PIN privé",
      "Garantie de continuité 365 jours sans coupure"
    ],
    fullDescription:
      "Savourez tout le catalogue Netflix dans sa meilleure définition pendant 12 mois. Films, séries originales et documentaires en 4K Ultra HD, Dolby Vision et Audio Spatial, à un tarif annuel nettement inférieur à l'abonnement mensuel classique.",
    detailedBenefits: [
      {
        title: "Image 4K Ultra HD & Dolby Vision",
        desc: "Profitez d'une netteté quatre fois supérieure au Full HD sur tous vos téléviseurs et écrans 4K."
      },
      {
        title: "Son Spatial Cinéma",
        desc: "Immersion sonore 360° native sur TV, ordinateur, tablette et écouteurs."
      },
      {
        title: "Profil Privé avec Code PIN",
        desc: "Votre historique, votre liste et vos recommandations restent 100% personnels et protégés."
      },
      {
        title: "Mode Hors-Connexion Étendu",
        desc: "Téléchargez vos séries et films sur jusqu'à 6 smartphones ou tablettes pour vos déplacements."
      }
    ],
    activationFormat: "Accès officiel Netflix Ultra HD 4K garanti 365 jours avec profil PIN dédié",
    activationSteps: [
      "Passez commande en quelques secondes par Carte Bancaire, PayPal ou Virement Instantané.",
      "Recevez vos identifiants et votre code PIN directement sur le site (boîte de dialogue en direct) ou par e-mail.",
      "Connectez-vous sur votre Smart TV, box TV, mobile ou ordinateur et profitez immédiatement de la 4K."
    ],
    specs: [
      { label: "Durée garantie", value: "365 jours continus" },
      { label: "Qualité vidéo", value: "4K Ultra HD + HDR / Dolby Vision" },
      { label: "Flux simultanés", value: "Jusqu'à 4 écrans" },
      { label: "Livraison", value: "En direct sur le site et/ou par e-mail" },
      { label: "Garantie", value: "Remplacement technique 24h pendant 1 an" }
    ]
  }
];

function createDefaultStore() {
  const defaultPass = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString("base64url");
  const { salt, hash } = hashPassword(defaultPass);
  const randomTopicSuffix = crypto.randomBytes(5).toString("hex");

  return {
    version: 4,
    admin: {
      name: "Gasc Enzo",
      email: process.env.ADMIN_EMAIL || "subpassdelivrey@gmail.com",
      passwordSalt: salt,
      passwordHash: hash
    },
    security: {
      blockedEmails: [],
      blockedHashes: [],
      blockedFingerprints: [],
      trustedEmails: [],
      trustedUserIds: [],
      securityEvents: []
    },
    users: [],
    userSessions: [],
    visitorProfiles: {},
    settings: {
      storeName: "NEXUS SUBS",
      supportEmail: "subpassdelivrey@gmail.com",
      publicUrl: process.env.PUBLIC_URL || "",
      payments: {
        stripe: {
          enabled: true,
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
          secretKey: process.env.STRIPE_SECRET_KEY || "",
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
          paymentLinkFallback: ""
        },
        paypal: {
          enabled: true,
          mode: process.env.PAYPAL_MODE || "live",
          clientId: process.env.PAYPAL_CLIENT_ID || "",
          clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
          paypalMeUrl: process.env.PAYPAL_ME_URL || "",
          businessEmail: "subpassdelivrey@gmail.com"
        },
        sepa: {
          enabled: true,
          beneficiary: "Gasc Enzo",
          iban: "FR76 1348 5008 0004 3173 7582 896",
          bic: "CEPAFRPP348",
          bank: "Caisse d’Épargne"
        }
      },
      notifications: {
        ntfyEnabled: true,
        ntfyServer: "https://ntfy.sh",
        ntfyTopic: `nexus-enzo-${randomTopicSuffix}`,
        webhookUrl: "",
        smtp: {
          enabled: false,
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          user: "subpassdelivrey@gmail.com",
          pass: process.env.SMTP_PASS || "",
          fromName: "NEXUS SUBSCRIPTIONS"
        }
      }
    },
    products: DEFAULT_PRODUCTS,
    coupons: [
      {
        id: "coupon_welcome",
        code: "BIENVENUE5",
        type: "fixed",
        value: 5,
        label: "5 € offerts sur votre commande",
        minAmount: 100,
        maxUsage: 0,
        usageCount: 0,
        active: true,
        createdAt: new Date().toISOString()
      }
    ],
    orders: [],
    discussions: [],
    rescueClaims: [],
    supportMessages: [],
    newsletter: [],
    notifications: [
      {
        id: "notif_init",
        type: "system",
        title: "Plateforme NEXUS sécurisée active",
        message:
          "Chiffrement AES-256-GCM, anti-fraude, système de secours client et centre de discussions en direct sont opérationnels.",
        createdAt: new Date().toISOString(),
        read: false
      }
    ]
  };
}

/**
 * Déchiffre les champs sensibles en mémoire au chargement, et les chiffre sur disque à la sauvegarde.
 */
function decryptInMemory(storeObj) {
  if (!storeObj) return storeObj;
  const p = storeObj.settings?.payments;
  if (p?.stripe) {
    p.stripe.secretKey = decryptText(p.stripe.secretKey);
    p.stripe.webhookSecret = decryptText(p.stripe.webhookSecret);
  }
  if (p?.paypal) {
    p.paypal.clientSecret = decryptText(p.paypal.clientSecret);
  }
  if (storeObj.settings?.notifications?.smtp) {
    storeObj.settings.notifications.smtp.pass = decryptText(storeObj.settings.notifications.smtp.pass);
  }
  if (Array.isArray(storeObj.orders)) {
    for (const o of storeObj.orders) {
      if (o.deliveredAccess) {
        o.deliveredAccess = decryptObject(o.deliveredAccess);
      }
    }
  }
  return storeObj;
}

function serializeWithEncryption(storeObj) {
  const clone = structuredClone(storeObj);
  const p = clone.settings?.payments;
  if (p?.stripe) {
    p.stripe.secretKey = encryptText(p.stripe.secretKey);
    p.stripe.webhookSecret = encryptText(p.stripe.webhookSecret);
  }
  if (p?.paypal) {
    p.paypal.clientSecret = encryptText(p.paypal.clientSecret);
  }
  if (clone.settings?.notifications?.smtp) {
    clone.settings.notifications.smtp.pass = encryptText(clone.settings.notifications.smtp.pass);
  }
  if (Array.isArray(clone.orders)) {
    for (const o of clone.orders) {
      if (o.deliveredAccess) {
        o.deliveredAccess = encryptObject(o.deliveredAccess);
      }
    }
  }
  return JSON.stringify(clone, null, 2);
}

class StoreDB {
  constructor() {
    this.data = null;
    this.sessions = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, "utf8");
        const parsed = decryptInMemory(JSON.parse(raw));
        const defaults = createDefaultStore();
        this.data = {
          ...defaults,
          ...parsed,
          version: 4,
          admin: { ...defaults.admin, ...(parsed.admin || {}) },
          security: {
            ...defaults.security,
            ...(parsed.security || {}),
            blockedEmails: Array.isArray(parsed.security?.blockedEmails) ? parsed.security.blockedEmails : [],
            blockedHashes: Array.isArray(parsed.security?.blockedHashes) ? parsed.security.blockedHashes : [],
            blockedFingerprints: Array.isArray(parsed.security?.blockedFingerprints) ? parsed.security.blockedFingerprints : [],
            trustedEmails: Array.isArray(parsed.security?.trustedEmails) ? parsed.security.trustedEmails : [],
            trustedUserIds: Array.isArray(parsed.security?.trustedUserIds) ? parsed.security.trustedUserIds : [],
            securityEvents: Array.isArray(parsed.security?.securityEvents) ? parsed.security.securityEvents : []
          },
          users: Array.isArray(parsed.users) ? parsed.users : [],
          userSessions: Array.isArray(parsed.userSessions) ? parsed.userSessions : [],
          visitorProfiles:
            parsed.visitorProfiles && typeof parsed.visitorProfiles === "object" && !Array.isArray(parsed.visitorProfiles)
              ? parsed.visitorProfiles
              : {},
          discussions: Array.isArray(parsed.discussions) ? parsed.discussions : [],
          rescueClaims: Array.isArray(parsed.rescueClaims) ? parsed.rescueClaims : [],
          settings: {
            ...defaults.settings,
            ...(parsed.settings || {}),
            payments: {
              stripe: { ...defaults.settings.payments.stripe, ...(parsed.settings?.payments?.stripe || {}) },
              paypal: { ...defaults.settings.payments.paypal, ...(parsed.settings?.payments?.paypal || {}) },
              sepa: { ...defaults.settings.payments.sepa, ...(parsed.settings?.payments?.sepa || {}) }
            },
            notifications: {
              ...defaults.settings.notifications,
              ...(parsed.settings?.notifications || {}),
              smtp: {
                ...defaults.settings.notifications.smtp,
                ...(parsed.settings?.notifications?.smtp || {})
              }
            }
          }
        };
        this.applyEnvAdminOverrideIfSet();
        this.save();
        return;
      } catch (err) {
        console.error("[DB] Recovery backup created:", err);
        fs.copyFileSync(DB_FILE, `${DB_FILE}.bak.${Date.now()}`);
      }
    }
    this.data = createDefaultStore();
    this.applyEnvAdminOverrideIfSet();
    this.save();
  }

  /**
   * Si ADMIN_EMAIL et/ou ADMIN_PASSWORD sont définis dans les variables d'environnement (ex: Render),
   * applique ces identifiants dès qu'ils changent (via signature SHA-256), sans écraser les futures
   * modifications faites depuis l'interface Admin.
   */
  applyEnvAdminOverrideIfSet() {
    const envEmail = String(process.env.ADMIN_EMAIL || "").trim();
    const envPass = String(process.env.ADMIN_PASSWORD || "");
    if (!envEmail && envPass.length < 8) return;

    const sig = crypto.createHash("sha256").update(`${envEmail}|${envPass}`).digest("hex").slice(0, 24);
    if (this.data.admin?.appliedEnvSig === sig) return;

    if (envEmail) {
      this.data.admin.email = envEmail;
    }
    if (envPass.length >= 8) {
      const { salt, hash } = hashPassword(envPass);
      this.data.admin.passwordSalt = salt;
      this.data.admin.passwordHash = hash;
    }
    this.data.admin.appliedEnvSig = sig;
    console.log("[DB] Identifiants Admin synchronisés depuis les variables d'environnement.");
  }

  save() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, serializeWithEncryption(this.data), "utf8");
    fs.renameSync(tmpFile, DB_FILE);
    createRollingBackupIfDue(DB_FILE);
    scheduleRemoteSync("nexus-store.json");
  }

  createAdminSession(email) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 1000 * 60 * 60 * 12; // 12h session
    this.sessions.set(token, { email, expiresAt });
    return token;
  }

  verifyAdminSession(token) {
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  revokeAdminSession(token) {
    if (token) this.sessions.delete(token);
  }

  // ============================================================================
  // Gestion sécurisée des sessions comptes clients (Tokens hachés SHA-256 + CSRF)
  // ============================================================================
  pruneExpiredUserSessions() {
    const now = Date.now();
    const before = this.data.userSessions.length;
    this.data.userSessions = this.data.userSessions.filter((s) => s && s.expiresAt > now);
    return this.data.userSessions.length !== before;
  }

  createUserSession(user, { clientHash = "", deviceFingerprint = "", userAgent = "", rememberDays = 7 } = {}) {
    this.pruneExpiredUserSessions();
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const csrfToken = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    const ttlMs = Math.max(1, Math.min(30, rememberDays)) * 24 * 60 * 60 * 1000;
    const session = {
      id: `sess_${now}_${crypto.randomBytes(4).toString("hex")}`,
      tokenHash,
      csrfToken,
      userId: user.id,
      clientHash,
      deviceFingerprint: String(deviceFingerprint || "").slice(0, 64),
      userAgentSummary: summarizeUserAgent(userAgent),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: now + ttlMs
    };

    // Maximum 5 sessions actives par compte (éviction des plus anciennes)
    const userSessions = this.data.userSessions
      .filter((s) => s.userId === user.id)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    if (userSessions.length >= 5) {
      const toRemove = new Set(userSessions.slice(4).map((s) => s.id));
      this.data.userSessions = this.data.userSessions.filter((s) => !toRemove.has(s.id));
    }

    this.data.userSessions.unshift(session);
    this.save();
    return { rawToken, session };
  }

  verifyUserSession(rawToken) {
    if (!rawToken || typeof rawToken !== "string") return null;
    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const session = this.data.userSessions.find((s) => s.tokenHash === tokenHash);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.data.userSessions = this.data.userSessions.filter((s) => s.id !== session.id);
      this.save();
      return null;
    }
    const user = this.data.users.find((u) => u.id === session.userId);
    if (!user || user.status === "suspended") {
      return null;
    }
    const lastMs = new Date(session.lastSeenAt || session.createdAt).getTime();
    if (now - lastMs > 2 * 60 * 1000) {
      session.lastSeenAt = new Date(now).toISOString();
      this.save();
    }
    return { session, user };
  }

  revokeUserSessionByToken(rawToken) {
    if (!rawToken) return false;
    const tokenHash = hashToken(rawToken);
    const before = this.data.userSessions.length;
    this.data.userSessions = this.data.userSessions.filter((s) => s.tokenHash !== tokenHash);
    if (this.data.userSessions.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  revokeUserSessionById(userId, sessionId) {
    const before = this.data.userSessions.length;
    this.data.userSessions = this.data.userSessions.filter((s) => !(s.userId === userId && s.id === sessionId));
    if (this.data.userSessions.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  revokeAllUserSessions(userId, exceptSessionId = null) {
    const before = this.data.userSessions.length;
    this.data.userSessions = this.data.userSessions.filter(
      (s) => s.userId !== userId || (exceptSessionId && s.id === exceptSessionId)
    );
    if (this.data.userSessions.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  getUserActiveSessions(userId, currentSessionId = null) {
    this.pruneExpiredUserSessions();
    return this.data.userSessions
      .filter((s) => s.userId === userId)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .map((s) => ({
        id: s.id,
        userAgentSummary: s.userAgentSummary,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: new Date(s.expiresAt).toISOString(),
        isCurrent: Boolean(currentSessionId && s.id === currentSessionId)
      }));
  }

  recordSecurityEvent(event) {
    this.data.security = this.data.security || {};
    this.data.security.securityEvents = this.data.security.securityEvents || [];
    this.data.security.securityEvents.unshift({
      id: `sec_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      createdAt: new Date().toISOString(),
      ...event
    });
    this.data.security.securityEvents = this.data.security.securityEvents.slice(0, 250);
  }

  pruneVisitorProfiles() {
    const profiles = this.data.visitorProfiles || {};
    const keys = Object.keys(profiles);
    if (keys.length <= 350) return;
    const sorted = keys
      .map((k) => ({ k, ts: new Date(profiles[k]?.lastSeenAt || 0).getTime() }))
      .sort((a, b) => b.ts - a.ts);
    for (const item of sorted.slice(300)) {
      delete profiles[item.k];
    }
  }

  addNotification({ type = "system", title, message, orderId = null, threadId = null, meta = null }) {
    const notif = {
      id: `notif_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      type,
      title,
      message,
      orderId,
      threadId,
      meta,
      createdAt: new Date().toISOString(),
      read: false
    };
    this.data.notifications.unshift(notif);
    this.data.notifications = this.data.notifications.slice(0, 180);
    this.save();
    return notif;
  }
}

export const db = new StoreDB();

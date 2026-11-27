/**
 * Runtime autonome pour déploiement statique (GitHub Pages / Netlify / Cloudflare Pages).
 * - Si un backend Node/Express NEXUS répond sur /api/bootstrap (ou VITE_API_URL / ?api=...),
 *   toutes les requêtes passent directement par le vrai serveur.
 * - Si le site est hébergé en statique pur (ex: *.github.io sans backend connecté),
 *   ce module active automatiquement un émulateur localStorage complet pour que
 *   le catalogue, le panier, le QR Code SEPA EPC, le suivi sécurisé, la boîte de dialogue
 *   et les discussions client fonctionnent immédiatement à 100%.
 */

import QRCode from "qrcode";

const STATIC_DB_KEY = "nexus_static_pages_db_v3";
const API_BASE_KEY = "nexus_custom_api_base";

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
      { title: "Zéro Publicité Partout", desc: "Regardez toutes vos vidéos sans aucune interruption sur Smart TV, iOS, Android, PC/Mac et consoles." },
      { title: "Écran Éteint & Arrière-plan", desc: "Continuez l'écoute de vos podcasts, musiques et vidéos tout en utilisant d'autres applications." },
      { title: "YouTube Music Premium Inclus", desc: "Accès illimité à plus de 100 millions de titres en haute qualité audio, sans pub et hors-connexion." },
      { title: "Sur Votre Compte Personnel", desc: "Conservez vos playlists, votre historique et vos abonnements : aucun mot de passe ne vous est demandé." }
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
      { title: "400+ Jeux PS5 & PS4 Inclus", desc: "Accès illimité aux exclusivités PlayStation et grands blockbusters renouvelés chaque mois." },
      { title: "Partage Console sur Votre Profil", desc: "Activez le compte sur votre console et jouez normalement avec votre pseudo, vos amis et vos trophées." },
      { title: "Multijoueur & Cloud Streaming", desc: "Parties en ligne illimitées, 100 Go de sauvegardes cloud et streaming direct sans téléchargement." },
      { title: "Contrôle Total du Compte", desc: "Compte officiel pré-chargé 12 mois ou code selon arrivage, avec guide d'installation illustré." }
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
      { title: "Image 4K Ultra HD & Dolby Vision", desc: "Profitez d'une netteté quatre fois supérieure au Full HD sur tous vos téléviseurs et écrans 4K." },
      { title: "Son Spatial Cinéma", desc: "Immersion sonore 360° native sur TV, ordinateur, tablette et écouteurs." },
      { title: "Profil Privé avec Code PIN", desc: "Votre historique, votre liste et vos recommandations restent 100% personnels et protégés." },
      { title: "Mode Hors-Connexion Étendu", desc: "Téléchargez vos séries et films sur jusqu'à 6 smartphones ou tablettes pour vos déplacements." }
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

function createInitialStaticDb() {
  return {
    admin: {
      name: "Gasc Enzo",
      email: ""
    },
    settings: {
      storeName: "NEXUS SUBS",
      supportEmail: "subpassdelivrey@gmail.com",
      publicUrl: window.location.origin + window.location.pathname.replace(/\/$/, ""),
      payments: {
        stripe: { enabled: true, publishableKey: "", paymentLinkFallback: "" },
        paypal: { enabled: true, mode: "live", clientId: "", paypalMeUrl: "", businessEmail: "subpassdelivrey@gmail.com" },
        sepa: {
          enabled: true,
          beneficiary: "Gasc Enzo",
          iban: "FR76 1348 5008 0004 3173 7582 896",
          bic: "CEPAFRPP348",
          bank: "Caisse d’Épargne"
        }
      },
      notifications: {
        ntfyEnabled: false,
        ntfyServer: "https://ntfy.sh",
        ntfyTopic: "nexus-subs-live",
        webhookUrl: "",
        smtp: { enabled: false, host: "smtp.gmail.com", port: 465, secure: true, user: "subpassdelivrey@gmail.com", fromName: "NEXUS SUBS" }
      }
    },
    products: structuredClone(DEFAULT_PRODUCTS),
    coupons: [
      { code: "BIENVENUE10", type: "percent", value: 10, label: "-10% de bienvenue", minAmount: 0, maxUsage: 0, usageCount: 0, active: true },
      { code: "NEXUS20", type: "fixed", value: 20, label: "-20 € dès 150 € d'achat", minAmount: 150, maxUsage: 0, usageCount: 0, active: true },
      { code: "PACK15", type: "percent", value: 15, label: "-15% spécial multi-abonnements", minAmount: 200, maxUsage: 0, usageCount: 0, active: true }
    ],
    orders: [],
    discussions: [],
    rescueClaims: [],
    supportMessages: [],
    newsletter: [],
    notifications: [],
    security: { blockedEmails: [], blockedHashes: [] }
  };
}

function loadStaticDb() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATIC_DB_KEY) || "null");
    if (parsed && Array.isArray(parsed.products) && parsed.products.length) return parsed;
  } catch {}
  const fresh = createInitialStaticDb();
  localStorage.setItem(STATIC_DB_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveStaticDb(db) {
  try {
    localStorage.setItem(STATIC_DB_KEY, JSON.stringify(db));
  } catch {}
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function randomHex(len = 16) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

const DISPOSABLE = new Set(["yopmail.com", "yopmail.fr", "tempmail.com", "temp-mail.org", "10minutemail.com", "guerrillamail.com", "mailinator.com", "trashmail.com"]);

function computeStaticDiagnostics(thread, orders) {
  const msgs = thread.messages || [];
  const lastUser = [...msgs].reverse().find((m) => m.sender === "customer");
  const lastAdmin = [...msgs].reverse().find((m) => m.sender === "admin");
  const waitingForReply = Boolean(lastUser && (!lastAdmin || new Date(lastUser.createdAt) > new Date(lastAdmin.createdAt)));
  const waitingSince = waitingForReply && thread.status !== "resolved" ? lastUser.createdAt : null;
  const waitingMs = waitingSince ? Math.max(0, Date.now() - new Date(waitingSince).getTime()) : 0;
  const waitingMinutes = Math.floor(waitingMs / 60000);
  const allText = msgs.filter((m) => m.sender === "customer").map((m) => m.text).join(" ");

  const fraudReasons = [...(thread.fraudReasons || [])];
  let riskScore = Number(thread.riskScore || 0);
  const domain = String(thread.customerEmail || "").split("@")[1]?.toLowerCase() || "";
  if (DISPOSABLE.has(domain)) {
    riskScore += 45;
    if (!fraudReasons.includes("Adresse e-mail jetable")) fraudReasons.push("Adresse e-mail jetable");
  }
  const linkedOrder = orders.find((o) => o.orderId === thread.orderId || (thread.customerEmail && o.email === thread.customerEmail));
  if (linkedOrder && linkedOrder.riskScore > riskScore) {
    riskScore = linkedOrder.riskScore;
    for (const r of linkedOrder.fraudReasons || []) if (!fraudReasons.includes(r)) fraudReasons.push(r);
  }
  if (/gratuit|chargeback|opposition|faux virement/i.test(allText)) {
    riskScore += 35;
    if (!fraudReasons.includes("Mots-clés suspects dans le chat")) fraudReasons.push("Mots-clés suspects dans le chat");
  }

  const manual = thread.manualFlags || {};
  const isSuspectedFraud = manual.fraud === true || (manual.fraud !== false && riskScore >= 45);
  const isAnnoyed = manual.annoyed === true || (manual.annoyed !== false && /arnaque|escroc|marre|toujours rien|nul|inadmissible|!!!|\?\?\?/i.test(allText));
  const needsFastHelp = manual.fastHelp === true || thread.topicType === "rescue" || (manual.fastHelp !== false && (/urgent|bloqué|bug|erreur|payé mais|débité|rien reçu|au secours/i.test(allText) || waitingMinutes >= 15));

  return {
    isResolved: thread.status === "resolved",
    waitingSince,
    waitingMs,
    waitingMinutes,
    waitingLevel: waitingMinutes >= 30 ? "critical" : waitingMinutes >= 10 ? "warning" : "normal",
    isSuspectedFraud,
    riskScore: Math.min(100, riskScore),
    fraudReasons,
    isAnnoyed,
    needsFastHelp,
    priorityScore:
      (thread.status === "resolved" ? -100 : 0) +
      (thread.topicType === "rescue" ? 90 : 0) +
      (isSuspectedFraud ? 60 : 0) +
      (isAnnoyed ? 55 : 0) +
      (needsFastHelp ? 50 : 0) +
      Math.min(40, waitingMinutes)
  };
}

async function generateEpcQrDataUrl(sepa, amount, reference) {
  const cleanIban = String(sepa.iban || "").replace(/\s+/g, "").toUpperCase();
  const payload = ["BCD", "002", "1", "SCT", sepa.bic || "", sepa.beneficiary || "Gasc Enzo", cleanIban, `EUR${Number(amount).toFixed(2)}`, "", reference, ""].join("\n");
  try {
    return await QRCode.toDataURL(payload, { width: 220, margin: 1 });
  } catch {
    return "";
  }
}

function getConfiguredApiBase() {
  const urlParam = new URLSearchParams(window.location.search).get("api");
  if (urlParam && /^https?:\/\//i.test(urlParam)) {
    localStorage.setItem(API_BASE_KEY, urlParam.replace(/\/+$/, ""));
    return urlParam.replace(/\/+$/, "");
  }
  const envBase = (import.meta.env?.VITE_API_URL || "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;
  return (localStorage.getItem(API_BASE_KEY) || "").trim().replace(/\/+$/, "");
}

function installStaticEventSourceStub() {
  const NativeEventSource = window.EventSource;
  window.EventSource = class StaticEventSource {
    constructor(url) {
      if (typeof url === "string" && url.includes("/api/events/")) {
        this.url = url;
        this.readyState = 1;
        this._listeners = {};
        return;
      }
      return new NativeEventSource(url);
    }
    addEventListener(type, fn) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
    }
    removeEventListener() {}
    close() {
      this.readyState = 2;
    }
  };
}

function installStaticApiInterceptor() {
  const nativeFetch = window.fetch.bind(window);
  let staticAdminToken = sessionStorage.getItem("nexus_static_admin_token") || "";

  installStaticEventSourceStub();

  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    const parsedUrl = new URL(rawUrl, window.location.origin);
    if (!parsedUrl.pathname.startsWith("/api/")) {
      return nativeFetch(input, init);
    }

    const method = (init.method || "GET").toUpperCase();
    const path = parsedUrl.pathname;
    let body = {};
    if (init.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {}
    }

    const db = loadStaticDb();
    const authHeader = (init.headers?.Authorization || init.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const isAdmin = Boolean(staticAdminToken && authHeader === staticAdminToken);

    // 1. Bootstrap
    if (path === "/api/bootstrap" && method === "GET") {
      return jsonResponse({
        storeName: db.settings.storeName,
        supportEmail: db.settings.supportEmail,
        staticMode: true,
        products: db.products.filter((p) => p.active !== false).sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)),
        payments: {
          stripe: { enabled: db.settings.payments.stripe.enabled, configured: Boolean(db.settings.payments.stripe.paymentLinkFallback), mode: "sandbox_demo" },
          paypal: { enabled: db.settings.payments.paypal.enabled, configured: Boolean(db.settings.payments.paypal.paypalMeUrl), mode: db.settings.payments.paypal.paypalMeUrl ? "paypal_me" : "sandbox_demo", paypalMeUrl: db.settings.payments.paypal.paypalMeUrl },
          sepa: { ...db.settings.payments.sepa }
        }
      });
    }

    // 2. Coupons
    if (path === "/api/coupons/validate" && method === "POST") {
      const code = String(body.code || "").trim().toUpperCase();
      const subtotal = Number(body.subtotal || 0);
      const c = db.coupons.find((x) => x.code.toUpperCase() === code && x.active);
      if (!c) return jsonResponse({ valid: false, message: `Le code « ${code} » n'existe pas.` }, 400);
      if (c.minAmount && subtotal < c.minAmount) return jsonResponse({ valid: false, message: `Minimum ${c.minAmount} € requis.` }, 400);
      const discountAmount = c.type === "percent" ? Math.round(((subtotal * c.value) / 100) * 100) / 100 : Math.min(subtotal, c.value);
      return jsonResponse({ valid: true, coupon: c, discountAmount, message: `Code « ${c.code} » appliqué : ${c.label}` });
    }

    // 3. Orders Create
    if (path === "/api/orders" && method === "POST") {
      const cleanName = String(body.customerName || "").trim();
      const cleanEmail = String(body.email || "").trim().toLowerCase();
      if (!cleanName || !cleanEmail.includes("@")) return jsonResponse({ error: "Nom et e-mail valides requis." }, 400);
      if (body.honeypot) return jsonResponse({ error: "Requête refusée." }, 403);

      const resolvedItems = [];
      for (const raw of body.items || []) {
        const prod = db.products.find((p) => p.id === raw.id);
        if (!prod) continue;
        const qty = Math.max(1, Math.min(10, parseInt(raw.quantity, 10) || 1));
        resolvedItems.push({
          id: prod.id,
          title: prod.title,
          duration: prod.duration,
          categoryLabel: prod.categoryLabel,
          accentColor: prod.accentColor,
          deliveryMode: prod.deliveryMode || "generic",
          quantity: qty,
          unitPrice: Number(prod.price),
          lineTotal: Math.round(Number(prod.price) * qty * 100) / 100
        });
      }
      if (!resolvedItems.length) return jsonResponse({ error: "Votre panier est vide." }, 400);

      const subtotal = Math.round(resolvedItems.reduce((a, i) => a + i.lineTotal, 0) * 100) / 100;
      let discount = 0;
      let appliedCoupon = null;
      if (body.couponCode) {
        const c = db.coupons.find((x) => x.code.toUpperCase() === String(body.couponCode).toUpperCase() && x.active);
        if (c && (!c.minAmount || subtotal >= c.minAmount)) {
          discount = c.type === "percent" ? Math.round(((subtotal * c.value) / 100) * 100) / 100 : Math.min(subtotal, c.value);
          appliedCoupon = c.code;
        }
      }
      const total = Math.max(1, Math.round((subtotal - discount) * 100) / 100);
      const numId = String(Math.floor(100000 + Math.random() * 900000));
      const orderId = `NX-${numId}`;
      const sepaRef = `NEXUS-${numId}`;
      const accessToken = randomHex(24);
      const nowIso = new Date().toISOString();
      const paymentMethod = body.paymentMethod || "sepa_instant";

      let sepaDetails = null;
      if (paymentMethod === "sepa_instant") {
        const qrDataUrl = await generateEpcQrDataUrl(db.settings.payments.sepa, total, sepaRef);
        sepaDetails = { ...db.settings.payments.sepa, reference: sepaRef, qrDataUrl };
      }

      const domain = cleanEmail.split("@")[1] || "";
      const fraudReasons = [];
      let riskScore = 0;
      if (DISPOSABLE.has(domain)) {
        riskScore += 45;
        fraudReasons.push("Adresse e-mail jetable détectée");
      }

      const order = {
        orderId,
        sepaRef,
        accessToken,
        riskScore,
        fraudReasons,
        proofSignature: `NXPROOF-${randomHex(16).toUpperCase()}`,
        createdAt: nowIso,
        updatedAt: nowIso,
        customerName: cleanName,
        email: cleanEmail,
        notes: String(body.notes || "").trim(),
        items: resolvedItems,
        subtotal,
        discount,
        coupon: appliedCoupon,
        total,
        currency: "EUR",
        paymentMethod,
        paymentStatus: "awaiting_payment",
        deliveryStatus: "pending",
        deliveredAccess: null,
        sepaDetails,
        messages: [
          {
            id: `msg_${Date.now()}`,
            sender: "system",
            text: `Commande #${orderId} enregistrée avec suivi sécurisé. ${paymentMethod === "sepa_instant" ? `Scannez le QR Code SEPA ou utilisez la référence ${sepaRef}.` : "Finalisez votre règlement sécurisé ci-dessus."}`,
            createdAt: nowIso
          }
        ]
      };

      db.orders.unshift(order);
      saveStaticDb(db);

      const paymentAction =
        paymentMethod === "sepa_instant"
          ? { type: "sepa_instant", sepa: sepaDetails }
          : paymentMethod === "paypal"
          ? { type: "paypal", mode: db.settings.payments.paypal.paypalMeUrl ? "paypal_me" : "sandbox_demo", url: db.settings.payments.paypal.paypalMeUrl ? `${db.settings.payments.paypal.paypalMeUrl.replace(/\/+$/, "")}/${total}EUR` : "" }
          : { type: "stripe", mode: "sandbox_demo" };

      return jsonResponse({ order, accessToken, paymentAction }, 201);
    }

    // 4. Order Lookup / Get / Declare / Confirm / Messages
    if (path === "/api/orders/lookup" && method === "POST") {
      const rawId = String(body.orderId || "").trim().toUpperCase().replace(/^#/, "").replace(/^NEXUS-/, "NX-");
      const cleanEmail = String(body.email || "").trim().toLowerCase();
      const order = db.orders.find((o) => o.orderId.toUpperCase() === rawId && o.email === cleanEmail);
      if (!order) return jsonResponse({ error: "Commande introuvable dans cette session navigateur." }, 404);
      return jsonResponse({ order, accessToken: order.accessToken });
    }

    const orderMatch = path.match(/^\/api\/orders\/([^/]+)(\/(.+))?$/);
    if (orderMatch) {
      const orderId = decodeURIComponent(orderMatch[1]);
      const sub = orderMatch[3] || "";
      const order = db.orders.find((o) => o.orderId === orderId);
      if (!order) return jsonResponse({ error: "Commande introuvable." }, 404);

      if (!sub && method === "GET") return jsonResponse({ order });
      if (sub === "confirm-gateway" && method === "POST") {
        order.paymentStatus = "paid";
        order.paidAt = new Date().toISOString();
        order.messages.push({ id: `msg_${Date.now()}`, sender: "system", text: "Paiement confirmé ! Vos accès seront affichés ici dès livraison par l'administrateur.", createdAt: new Date().toISOString() });
        saveStaticDb(db);
        return jsonResponse({ order });
      }
      if (sub === "declare-payment" && method === "POST") {
        order.paymentStatus = "declaration_sent";
        order.declaredAt = new Date().toISOString();
        order.messages.push({ id: `msg_${Date.now()}`, sender: "system", text: `Règlement déclaré${body.senderHint ? ` (${body.senderHint})` : ""}. Enregistré dans le journal de garantie !`, createdAt: new Date().toISOString() });
        saveStaticDb(db);
        return jsonResponse({ order });
      }
      if (sub === "messages" && method === "POST") {
        const msg = { id: `msg_${Date.now()}`, sender: isAdmin ? "admin" : "customer", text: String(body.text || "").trim(), createdAt: new Date().toISOString() };
        order.messages.push(msg);
        saveStaticDb(db);
        return jsonResponse({ order, message: msg });
      }
    }

    // 5. Discussions (Client & Admin)
    if (path === "/api/discussions" && method === "POST") {
      const nowIso = new Date().toISOString();
      const prod = body.productId ? db.products.find((p) => p.id === body.productId) : null;
      const topicLabel = body.topicType === "rescue" ? "🛡️ Secours Paiement" : prod ? `Article : ${prod.title} (${prod.price} €)` : "Question générale (Catalogue & Boutique)";
      let thread = body.existingThreadId ? db.discussions.find((t) => t.threadId === body.existingThreadId) : null;

      if (!thread) {
        thread = {
          threadId: `DSC-${Math.floor(100000 + Math.random() * 900000)}`,
          threadToken: randomHex(20),
          createdAt: nowIso,
          updatedAt: nowIso,
          topicType: prod ? "product" : body.topicType || "general",
          topicLabel,
          productId: prod?.id || null,
          productTitle: prod?.title || null,
          orderId: body.orderId || null,
          customerName: String(body.customerName || "").trim() || "Visiteur",
          customerEmail: String(body.customerEmail || "").trim().toLowerCase(),
          status: "open",
          riskScore: 0,
          fraudReasons: [],
          manualFlags: {},
          unreadByAdmin: 1,
          unreadByCustomer: 0,
          messages: [
            { id: `dmsg_sys_${Date.now()}`, sender: "system", text: `Discussion ouverte concernant : ${topicLabel}.`, createdAt: nowIso },
            { id: `dmsg_${Date.now()}`, sender: "customer", text: String(body.initialMessage || "").trim(), createdAt: nowIso }
          ]
        };
        db.discussions.unshift(thread);
      } else {
        thread.messages.push({ id: `dmsg_${Date.now()}`, sender: "customer", text: String(body.initialMessage || "").trim(), createdAt: nowIso });
        thread.updatedAt = nowIso;
        thread.unreadByAdmin = (thread.unreadByAdmin || 0) + 1;
      }
      saveStaticDb(db);
      return jsonResponse({ thread, threadToken: thread.threadToken }, 201);
    }

    const discMatch = path.match(/^\/api\/discussions\/([^/]+)(\/(.+))?$/);
    if (discMatch) {
      const threadId = decodeURIComponent(discMatch[1]);
      const sub = discMatch[3] || "";
      const thread = db.discussions.find((t) => t.threadId === threadId);
      if (!thread) return jsonResponse({ error: "Discussion introuvable." }, 404);

      if (!sub && method === "GET") return jsonResponse({ thread: isAdmin ? { ...thread, diagnostics: computeStaticDiagnostics(thread, db.orders) } : thread });
      if (sub === "context" && method === "PATCH") {
        const prod = body.productId ? db.products.find((p) => p.id === body.productId) : null;
        if (body.topicType) {
          thread.topicType = prod ? "product" : body.topicType;
          thread.productId = prod?.id || null;
          thread.productTitle = prod?.title || null;
          thread.topicLabel = prod ? `Article : ${prod.title} (${prod.price} €)` : "Question générale (Catalogue & Boutique)";
        }
        saveStaticDb(db);
        return jsonResponse({ thread });
      }
      if (sub === "messages" && method === "POST") {
        let attachment = null;
        if (isAdmin && body.attachedProductId) {
          const p = db.products.find((x) => x.id === body.attachedProductId);
          if (p) attachment = { type: "product", id: p.id, title: p.title, price: p.price, duration: p.duration };
        } else if (isAdmin && body.attachedCouponCode) {
          const c = db.coupons.find((x) => x.code.toUpperCase() === String(body.attachedCouponCode).toUpperCase());
          if (c) attachment = { type: "coupon", code: c.code, label: c.label };
        }
        const msg = { id: `dmsg_${Date.now()}`, sender: isAdmin ? "admin" : "customer", text: String(body.text || "").trim(), attachment, createdAt: new Date().toISOString() };
        thread.messages.push(msg);
        thread.updatedAt = msg.createdAt;
        if (isAdmin) thread.unreadByAdmin = 0;
        else {
          thread.status = "open";
          thread.unreadByAdmin = (thread.unreadByAdmin || 0) + 1;
        }
        saveStaticDb(db);
        return jsonResponse({ thread: isAdmin ? { ...thread, diagnostics: computeStaticDiagnostics(thread, db.orders) } : thread, message: msg });
      }
    }

    // 6. Rescue Claim, Support & Newsletter
    if (path === "/api/rescue-claim" && method === "POST") {
      const nowIso = new Date().toISOString();
      const rescueId = `SOS-${Math.floor(100000 + Math.random() * 900000)}`;
      const thread = {
        threadId: `DSC-${rescueId.replace("SOS-", "")}`,
        threadToken: randomHex(20),
        createdAt: nowIso,
        updatedAt: nowIso,
        topicType: "rescue",
        topicLabel: `🛡️ Secours Paiement (${body.amountPaid || "?"} €)`,
        customerName: body.customerName || "Client Secours",
        customerEmail: String(body.email || "").trim().toLowerCase(),
        orderId: body.orderRef || null,
        status: "open",
        riskScore: 0,
        fraudReasons: [],
        manualFlags: { fastHelp: true },
        unreadByAdmin: 1,
        unreadByCustomer: 0,
        messages: [
          { id: `dmsg_sos_${Date.now()}`, sender: "system", text: `Dossier d'assistance prioritaire #${rescueId} enregistré.`, createdAt: nowIso },
          { id: `dmsg_sos_u_${Date.now()}`, sender: "customer", text: `Preuve: ${body.paymentProof || ""} — ${body.problemDetails || ""}`, createdAt: nowIso }
        ]
      };
      db.rescueClaims.unshift({ rescueId, createdAt: nowIso, ...body });
      db.discussions.unshift(thread);
      saveStaticDb(db);
      return jsonResponse({ rescueId, thread, threadToken: thread.threadToken }, 201);
    }

    if (path === "/api/support" && method === "POST") {
      const nowIso = new Date().toISOString();
      const thread = {
        threadId: `DSC-${Math.floor(100000 + Math.random() * 900000)}`,
        threadToken: randomHex(20),
        createdAt: nowIso,
        updatedAt: nowIso,
        topicType: "general",
        topicLabel: "Formulaire Support 7j/7",
        customerName: body.name || "Visiteur",
        customerEmail: String(body.email || "").toLowerCase(),
        status: "open",
        riskScore: 0,
        fraudReasons: [],
        manualFlags: {},
        unreadByAdmin: 1,
        unreadByCustomer: 0,
        messages: [{ id: `dmsg_${Date.now()}`, sender: "customer", text: body.message || "", createdAt: nowIso }]
      };
      db.discussions.unshift(thread);
      db.supportMessages.unshift({ id: `sup_${Date.now()}`, ...body, createdAt: nowIso });
      saveStaticDb(db);
      return jsonResponse({ ok: true, thread, threadToken: thread.threadToken });
    }

    if (path === "/api/newsletter" && method === "POST") {
      if (body.email && !db.newsletter.includes(body.email)) {
        db.newsletter.unshift(body.email);
        saveStaticDb(db);
      }
      return jsonResponse({ ok: true });
    }

    // 7. Admin Auth & Dashboard désactivés hors-ligne (authentification serveur obligatoire)
    if (path === "/api/admin/login" || path.startsWith("/api/admin/")) {
      return jsonResponse({ error: "Connexion administrateur indisponible hors-ligne : serveur requis." }, 503);
    }

    return jsonResponse({ error: "Endpoint non disponible en mode statique." }, 404);
  };
}

export async function initStaticRuntimeIfNeeded() {
  const apiBase = getConfiguredApiBase();
  const nativeFetch = window.fetch.bind(window);

  // Si une URL backend externe est configurée (?api=https://... ou VITE_API_URL), préfixer /api/* automatiquement
  if (apiBase) {
    window.fetch = (input, init) => {
      if (typeof input === "string" && input.startsWith("/api/")) {
        return nativeFetch(`${apiBase}${input}`, init);
      }
      return nativeFetch(input, init);
    };
    return { mode: "remote-api", apiBase };
  }

  // Tester rapidement si un vrai serveur Express NEXUS répond sur /api/bootstrap
  try {
    const probe = await nativeFetch("/api/bootstrap", { headers: { Accept: "application/json" } });
    const ct = probe.headers.get("content-type") || "";
    if (probe.ok && ct.includes("application/json")) {
      return { mode: "live-server" };
    }
  } catch {
    // Pas de serveur backend sur cette origine -> activer le mode autonome GitHub Pages
  }

  installStaticApiInterceptor();
  console.info("[NEXUS] Mode autonome GitHub Pages activé (catalogue, QR SEPA, discussions & Admin actifs localement).");
  return { mode: "static-pages" };
}

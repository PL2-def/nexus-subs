/**
 * Moteur de Traçage Forensique Complet & Gestion des Dossiers d'Achat :
 * - Capture l'ensemble des indices réseau, appareil, navigateur, paiement et accès pour retrouver
 *   n'importe quel acheteur qui a perdu son bien, fermé sa page ou fait une faute de frappe.
 * - Calcule les correspondances automatiques entre commandes, comptes, discussions et tickets.
 */

import crypto from "node:crypto";
import {
  getPrivacyClientHash,
  appendRescueLedger,
  canonicalizeEmail,
  getCanonicalEmailKey,
  summarizeUserAgent
} from "./security.js";

function normalizeIp(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("::ffff:")) s = s.slice(7);
  return s.slice(0, 80);
}

export function extractRawClientIp(req) {
  if (!req) return { ipAddress: "", forwardedIps: [] };
  const cf = normalizeIp(req.headers["cf-connecting-ip"]);
  const xReal = normalizeIp(req.headers["x-real-ip"]);
  const xffRaw = String(req.headers["x-forwarded-for"] || "");
  const forwardedIps = xffRaw
    .split(",")
    .map((p) => normalizeIp(p))
    .filter(Boolean)
    .slice(0, 8);
  const remote = normalizeIp(req.socket?.remoteAddress || req.ip || "");
  const ipAddress = cf || xReal || forwardedIps[0] || remote || "";
  return { ipAddress, forwardedIps };
}

function inferCountryFromTimezone(tz = "") {
  const s = String(tz || "");
  if (!s) return "";
  if (s === "Europe/Paris") return "FR (Fuseau)";
  if (s === "Europe/Brussels") return "BE (Fuseau)";
  if (s === "Europe/Zurich") return "CH (Fuseau)";
  if (s === "America/Toronto" || s === "America/Montreal") return "CA (Fuseau)";
  return "";
}

export function extractRequestTrace(req, body = {}) {
  const { ipAddress, forwardedIps } = extractRawClientIp(req);
  const clientHash = req ? getPrivacyClientHash(req) : "";
  const ua = String(req?.headers?.["user-agent"] || "").slice(0, 300);
  const acceptLanguage = String(req?.headers?.["accept-language"] || "").slice(0, 120);
  const snap = body?.telemetrySnapshot && typeof body.telemetrySnapshot === "object" ? body.telemetrySnapshot : {};
  const meta = body?.traceMeta && typeof body.traceMeta === "object" ? body.traceMeta : {};

  const timezone = String(meta.timezone || snap.timezone || "").slice(0, 60);
  const countryHeader =
    req?.headers?.["cf-ipcountry"] ||
    req?.headers?.["x-vercel-ip-country"] ||
    req?.headers?.["x-geo-country"] ||
    "";
  const countryHint = String(countryHeader || "").trim().slice(0, 24) || inferCountryFromTimezone(timezone);

  return {
    capturedAt: new Date().toISOString(),
    ipAddress,
    forwardedIps,
    clientHash,
    visitorId: String(body?.visitorId || snap.visitorId || "").slice(0, 64),
    sessionId: String(body?.sessionId || snap.sessionId || "").slice(0, 64),
    deviceFingerprint: String(body?.deviceFingerprint || "").slice(0, 64),
    userAgent: ua,
    userAgentSummary: summarizeUserAgent(ua),
    acceptLanguage,
    countryHint,
    timezone,
    language: String(meta.language || snap.language || "").slice(0, 24),
    languages: Array.isArray(meta.languages) ? meta.languages.slice(0, 6).map((x) => String(x).slice(0, 20)) : [],
    screenSize: String(meta.screenSize || snap.screenSize || "").slice(0, 24),
    viewportSize: String(meta.viewportSize || "").slice(0, 24),
    pixelRatio: meta.pixelRatio ? Number(meta.pixelRatio) : null,
    platform: String(meta.platform || "").slice(0, 48),
    hardwareConcurrency: meta.hardwareConcurrency ? Number(meta.hardwareConcurrency) : null,
    deviceMemory: meta.deviceMemory ? Number(meta.deviceMemory) : null,
    maxTouchPoints: typeof meta.maxTouchPoints === "number" ? meta.maxTouchPoints : null,
    referrer: String(meta.referrer || req?.headers?.referer || "").slice(0, 260),
    landingUrl: String(meta.landingUrl || "").slice(0, 260),
    currentUrl: String(meta.currentUrl || "").slice(0, 260),
    sessionDurationSec: snap.sessionDurationMs ? Math.round(Number(snap.sessionDurationMs) / 1000) : null,
    formFillMs: typeof body?.formFillMs === "number" ? Math.round(body.formFillMs) : null,
    viewedProducts: Array.isArray(snap.viewedProducts) ? snap.viewedProducts.slice(0, 15) : [],
    sectionsVisited: Array.isArray(snap.sectionsVisited) ? snap.sectionsVisited.slice(0, 10) : []
  };
}

export function generateDossierIdentifiers(orderId) {
  const cleanNum = String(orderId || "").replace(/^NX-/i, "").trim() || crypto.randomBytes(3).toString("hex").toUpperCase();
  const dossierId = `DOS-${cleanNum}`;
  const part1 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const part2 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const recoveryCode = `REC-${part1}-${part2}`;
  return { dossierId, recoveryCode };
}

const LEDGER_IMPORTANT_EVENTS = new Set([
  "order_created",
  "payment_confirmed",
  "payment_declared",
  "access_delivered",
  "loss_report_submitted",
  "vault_opened",
  "secret_revealed",
  "order_recovered_self"
]);

export function appendOrderTraceEvent(
  order,
  { type, label, detail = "", actor = "customer", req = null, meta = {} } = {}
) {
  if (!order || !type) return null;
  order.traceTimeline = Array.isArray(order.traceTimeline) ? order.traceTimeline : [];
  const { ipAddress } = req ? extractRawClientIp(req) : { ipAddress: "" };
  const uaSummary = req ? summarizeUserAgent(req.headers?.["user-agent"] || "") : "";
  const entry = {
    id: `trc_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
    ts: new Date().toISOString(),
    type: String(type).slice(0, 48),
    label: String(label || type).slice(0, 140),
    detail: String(detail || "").slice(0, 320),
    actor: String(actor || "customer").slice(0, 24),
    ipAddress,
    userAgentSummary: uaSummary,
    meta: meta && typeof meta === "object" ? meta : {}
  };
  order.traceTimeline.unshift(entry);
  order.traceTimeline = order.traceTimeline.slice(0, 120);

  if (LEDGER_IMPORTANT_EVENTS.has(entry.type)) {
    appendRescueLedger(entry.type, {
      orderId: order.orderId,
      dossierId: order.dossierId || `DOS-${String(order.orderId || "").replace(/^NX-/, "")}`,
      email: order.email,
      actor: entry.actor,
      label: entry.label,
      detail: entry.detail,
      ipAddress
    });
  }
  return entry;
}

export function levenshtein(a = "", b = "") {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[s.length][t.length];
}

export function areEmailsClose(a = "", b = "") {
  const ca = canonicalizeEmail(a);
  const cb = canonicalizeEmail(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (getCanonicalEmailKey(ca) === getCanonicalEmailKey(cb)) return true;

  const [la, da] = ca.split("@");
  const [lb, db] = cb.split("@");
  if (!la || !lb) return false;
  if (la === lb && da && db) return true; // même préfixe sur domaine fautif (ex: gmail.fr vs gmail.com)
  if (da === db && Math.abs(la.length - lb.length) <= 2 && levenshtein(la, lb) <= 2) return true;
  if (levenshtein(ca, cb) <= 2) return true;
  return false;
}

function normalizePhone(raw = "") {
  return String(raw || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
}

function normalizeName(raw = "") {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findCandidateOrdersForLostBuyer(query = {}, db) {
  const orders = db?.data?.orders || [];
  const rawOrderRef = String(query.orderRef || "")
    .trim()
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/^NEXUS-/, "NX-")
    .replace(/^DOS-/, "NX-");
  const cleanNum = rawOrderRef.replace(/^NX-/, "");
  const cleanRec = String(query.recoveryCode || "").trim().toUpperCase();
  const qEmail = canonicalizeEmail(query.email || "");
  const qOldEmail = canonicalizeEmail(query.oldEmail || "");
  const qPhone = normalizePhone(query.phone || "");
  const qName = normalizeName(query.customerName || "");
  const qPayer = normalizeName(query.payerName || query.paymentProof || "");
  const qAmount = Number(String(query.amountPaid || "").replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
  const qIp = normalizeIp(query.ipAddress || "");
  const qHash = String(query.clientHash || "").trim();
  const qVid = String(query.visitorId || "").trim();
  const qFp = String(query.deviceFingerprint || "").trim();
  const qProd = normalizeName(query.productHint || "");

  const candidates = [];

  for (const ord of orders) {
    let score = 0;
    const reasons = [];
    const ordDossierId = ord.dossierId || `DOS-${String(ord.orderId || "").replace(/^NX-/, "")}`;

    if (cleanRec && ord.recoveryCode && ord.recoveryCode.toUpperCase() === cleanRec) {
      score += 100;
      reasons.push(`Code récupération exact (${cleanRec})`);
    }
    if (
      rawOrderRef &&
      (ord.orderId?.toUpperCase() === rawOrderRef ||
        ord.sepaRef?.toUpperCase() === rawOrderRef ||
        (cleanNum.length >= 5 && ord.orderId?.endsWith(cleanNum)))
    ) {
      score += 95;
      reasons.push(`Référence commande/SEPA correspondante (#${ord.orderId})`);
    }

    const ordEmail = canonicalizeEmail(ord.email);
    if (qEmail && ordEmail === qEmail) {
      score += 75;
      reasons.push("E-mail identique");
    } else if (qOldEmail && ordEmail === qOldEmail) {
      score += 75;
      reasons.push("Ancien e-mail identique");
    } else if ((qEmail && areEmailsClose(qEmail, ordEmail)) || (qOldEmail && areEmailsClose(qOldEmail, ordEmail))) {
      score += 48;
      reasons.push(`E-mail proche / faute de frappe (${ord.email})`);
    }

    const ordPhone = normalizePhone(ord.phone || ord.paymentTrace?.payerPhone || "");
    if (qPhone && qPhone.length >= 6 && ordPhone && (ordPhone === qPhone || ordPhone.endsWith(qPhone.slice(-8)))) {
      score += 60;
      reasons.push("Numéro de téléphone concordant");
    }

    if (qIp && ord.trace?.ipAddress && ord.trace.ipAddress === qIp) {
      score += 42;
      reasons.push("Même adresse IP");
    }
    if (qFp && ord.deviceFingerprint && ord.deviceFingerprint === qFp) {
      score += 42;
      reasons.push("Même empreinte appareil");
    }
    if (qVid && ord.visitorId && ord.visitorId === qVid) {
      score += 38;
      reasons.push("Même identifiant visiteur navigateur");
    }
    if (qHash && ord.clientHash && ord.clientHash === qHash) {
      score += 24;
      reasons.push("Même empreinte réseau du jour");
    }

    const ordName = normalizeName(ord.customerName);
    const ordPayerName = normalizeName(ord.paymentTrace?.payerName || ord.paymentTrace?.senderHint || "");
    if (qName && ordName && (ordName === qName || (qName.length >= 4 && (ordName.includes(qName) || qName.includes(ordName))))) {
      score += 32;
      reasons.push("Nom du client concordant");
    }
    if (qPayer && (ordPayerName.includes(qPayer) || (ord.paymentTransactionId && normalizeName(ord.paymentTransactionId).includes(qPayer)))) {
      score += 45;
      reasons.push("Titulaire / preuve de paiement concordante");
    }

    if (qAmount > 0 && Math.abs(Number(ord.total || 0) - qAmount) <= 1) {
      score += 22;
      reasons.push(`Montant exact (${ord.total} €)`);
    }

    if (qProd && (ord.items || []).some((i) => normalizeName(i.title).includes(qProd))) {
      score += 18;
      reasons.push("Produit acheté correspondant");
    }

    if (score >= 24 && reasons.length > 0) {
      candidates.push({
        orderId: ord.orderId,
        dossierId: ordDossierId,
        customerName: ord.customerName,
        email: ord.email,
        total: ord.total,
        createdAt: ord.createdAt,
        paymentStatus: ord.paymentStatus,
        deliveryStatus: ord.deliveryStatus,
        matchScore: Math.min(100, score),
        matchReasons: reasons
      });
    }
  }

  candidates.sort((a, b) => b.matchScore - a.matchScore || new Date(b.createdAt) - new Date(a.createdAt));
  return candidates.slice(0, 8);
}

export function buildOrderDossier(
  order,
  { allOrders = [], allUsers = [], allDiscussions = [], rescueClaims = [], lossReports = [], visitorProfiles = {} } = {}
) {
  const dossierId = order.dossierId || `DOS-${String(order.orderId || "").replace(/^NX-/, "")}`;
  const cleanEmail = canonicalizeEmail(order.email);
  const canonicalEmail = getCanonicalEmailKey(cleanEmail);

  const linkedUser =
    (order.userId ? allUsers.find((u) => u.id === order.userId) : null) ||
    (cleanEmail ? allUsers.find((u) => canonicalizeEmail(u.email) === cleanEmail) : null) ||
    null;

  // Enrichir l'empreinte forensique avec le profil visiteur si la commande est ancienne ou partielle
  const vp =
    (order.userId && visitorProfiles[`usr:${order.userId}`]) ||
    (order.visitorId && visitorProfiles[`vis:${order.visitorId}`]) ||
    (order.clientHash && visitorProfiles[`net:${order.clientHash}`]) ||
    null;

  const baseTrace = order.trace && typeof order.trace === "object" ? order.trace : {};
  const mergedTrace = {
    ipAddress: baseTrace.ipAddress || "",
    forwardedIps: baseTrace.forwardedIps || [],
    clientHash: baseTrace.clientHash || order.clientHash || vp?.clientHashes?.[0] || "",
    visitorId: baseTrace.visitorId || order.visitorId || vp?.visitorId || "",
    sessionId: baseTrace.sessionId || vp?.sessionIds?.[0] || "",
    deviceFingerprint: baseTrace.deviceFingerprint || order.deviceFingerprint || vp?.deviceFingerprints?.[0] || "",
    userAgent: baseTrace.userAgent || "",
    userAgentSummary: baseTrace.userAgentSummary || vp?.userAgentSummary || "",
    acceptLanguage: baseTrace.acceptLanguage || "",
    countryHint: baseTrace.countryHint || inferCountryFromTimezone(baseTrace.timezone || vp?.timezone || ""),
    timezone: baseTrace.timezone || vp?.timezone || "",
    language: baseTrace.language || vp?.language || "",
    languages: baseTrace.languages || [],
    screenSize: baseTrace.screenSize || vp?.screenSize || "",
    viewportSize: baseTrace.viewportSize || "",
    pixelRatio: baseTrace.pixelRatio || null,
    platform: baseTrace.platform || "",
    hardwareConcurrency: baseTrace.hardwareConcurrency || null,
    deviceMemory: baseTrace.deviceMemory || null,
    maxTouchPoints: baseTrace.maxTouchPoints ?? null,
    referrer: baseTrace.referrer || "",
    landingUrl: baseTrace.landingUrl || "",
    currentUrl: baseTrace.currentUrl || "",
    sessionDurationSec:
      baseTrace.sessionDurationSec ?? (vp?.totalDurationMs ? Math.round(vp.totalDurationMs / 1000) : null),
    formFillMs: baseTrace.formFillMs ?? null,
    viewedProducts: baseTrace.viewedProducts?.length ? baseTrace.viewedProducts : vp?.viewedProducts || [],
    sectionsVisited: baseTrace.sectionsVisited?.length ? baseTrace.sectionsVisited : vp?.sectionsVisited || []
  };

  // Correspondances croisées automatiques pour retrouver l'acheteur sous d'autres identités
  const crossMatches = {
    orders: [],
    users: [],
    discussions: []
  };

  const ordPhone = normalizePhone(order.phone || order.paymentTrace?.payerPhone || "");

  for (const other of allOrders) {
    if (other.orderId === order.orderId) continue;
    const reasons = [];
    if (mergedTrace.ipAddress && other.trace?.ipAddress && mergedTrace.ipAddress === other.trace.ipAddress) {
      reasons.push("Même IP");
    }
    if (mergedTrace.deviceFingerprint && other.deviceFingerprint === mergedTrace.deviceFingerprint) {
      reasons.push("Même appareil");
    }
    if (mergedTrace.visitorId && other.visitorId === mergedTrace.visitorId) {
      reasons.push("Même visiteur");
    }
    if (mergedTrace.clientHash && other.clientHash === mergedTrace.clientHash) {
      reasons.push("Même réseau");
    }
    if (cleanEmail && canonicalizeEmail(other.email) === cleanEmail) {
      reasons.push("Même e-mail");
    } else if (cleanEmail && areEmailsClose(cleanEmail, other.email)) {
      reasons.push("E-mail proche");
    }
    if (ordPhone && ordPhone.length >= 6 && normalizePhone(other.phone || "") === ordPhone) {
      reasons.push("Même téléphone");
    }
    if (reasons.length > 0) {
      crossMatches.orders.push({
        orderId: other.orderId,
        dossierId: other.dossierId || `DOS-${String(other.orderId || "").replace(/^NX-/, "")}`,
        customerName: other.customerName,
        email: other.email,
        total: other.total,
        createdAt: other.createdAt,
        paymentStatus: other.paymentStatus,
        deliveryStatus: other.deliveryStatus,
        reasons
      });
    }
  }

  for (const u of allUsers) {
    const reasons = [];
    if (linkedUser && u.id === linkedUser.id) reasons.push("Compte titulaire");
    if (cleanEmail && areEmailsClose(cleanEmail, u.email) && (!linkedUser || u.id !== linkedUser.id)) {
      reasons.push("E-mail proche");
    }
    if (mergedTrace.deviceFingerprint && u.lastDeviceFingerprint === mergedTrace.deviceFingerprint) {
      reasons.push("Même appareil");
    }
    if (mergedTrace.visitorId && u.lastVisitorId === mergedTrace.visitorId) {
      reasons.push("Même visiteur");
    }
    if (mergedTrace.clientHash && u.lastClientHash === mergedTrace.clientHash) {
      reasons.push("Même réseau");
    }
    if (reasons.length > 0) {
      crossMatches.users.push({
        id: u.id,
        name: u.name,
        email: u.email,
        status: u.status || "active",
        reasons
      });
    }
  }

  for (const t of allDiscussions) {
    const reasons = [];
    if (t.orderId === order.orderId) reasons.push("Liée à la commande");
    if (cleanEmail && canonicalizeEmail(t.customerEmail) === cleanEmail) reasons.push("Même e-mail");
    else if (cleanEmail && areEmailsClose(cleanEmail, t.customerEmail)) reasons.push("E-mail proche");
    if (mergedTrace.deviceFingerprint && t.deviceFingerprint === mergedTrace.deviceFingerprint) reasons.push("Même appareil");
    if (mergedTrace.visitorId && t.visitorId === mergedTrace.visitorId) reasons.push("Même visiteur");
    if (mergedTrace.clientHash && t.clientHash === mergedTrace.clientHash) reasons.push("Même réseau");
    if (reasons.length > 0) {
      crossMatches.discussions.push({
        threadId: t.threadId,
        topicLabel: t.topicLabel,
        customerName: t.customerName,
        customerEmail: t.customerEmail,
        status: t.status,
        updatedAt: t.updatedAt,
        reasons
      });
    }
  }

  const explicitLinkedIds = new Set(Array.isArray(order.linkedClaimIds) ? order.linkedClaimIds : []);
  const linkedClaims = [];

  for (const r of lossReports) {
    const isExplicit = explicitLinkedIds.has(r.reportId);
    const isCandidate = Array.isArray(r.candidateOrderIds) && r.candidateOrderIds.includes(order.orderId);
    const sameOrderRef = r.orderRef && r.orderRef.toUpperCase().includes(order.orderId.toUpperCase());
    if (isExplicit || isCandidate || sameOrderRef) {
      linkedClaims.push({
        kind: "loss_report",
        id: r.reportId,
        createdAt: r.createdAt,
        customerName: r.customerName,
        email: r.email,
        oldEmail: r.oldEmail || "",
        phone: r.phone || "",
        lossType: r.lossType || "lost_access",
        paymentMethod: r.paymentMethod || "",
        amountPaid: r.amountPaid || "",
        paymentProof: r.paymentProof || "",
        problemDetails: r.problemDetails || "",
        threadId: r.threadId || null,
        ipAddress: r.trace?.ipAddress || "",
        deviceFingerprint: r.trace?.deviceFingerprint || "",
        linkedExplicitly: isExplicit
      });
    }
  }

  for (const c of rescueClaims) {
    const isExplicit = explicitLinkedIds.has(c.rescueId);
    const sameRef = c.orderRef && c.orderRef.toUpperCase().includes(order.orderId.toUpperCase());
    const sameEmail = cleanEmail && areEmailsClose(cleanEmail, c.email);
    const sameDevice = mergedTrace.deviceFingerprint && c.trace?.deviceFingerprint === mergedTrace.deviceFingerprint;
    if (isExplicit || sameRef || sameEmail || sameDevice) {
      linkedClaims.push({
        kind: "rescue_claim",
        id: c.rescueId,
        createdAt: c.createdAt,
        customerName: c.customerName,
        email: c.email,
        phone: c.phone || "",
        paymentMethod: c.paymentMethod || "",
        amountPaid: c.amountPaid || "",
        paymentProof: c.paymentProof || "",
        problemDetails: c.problemDetails || "",
        threadId: c.threadId || null,
        ipAddress: c.trace?.ipAddress || "",
        linkedExplicitly: isExplicit
      });
    }
  }

  linkedClaims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    dossierId,
    orderId: order.orderId,
    recoveryCode: order.recoveryCode || "",
    proofSignature: order.proofSignature || "",
    sepaRef: order.sepaRef || "",
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
    dossierStatus: order.dossierStatus || "normal",
    dossierNotes: order.dossierNotes || "",
    recoveredContact: order.recoveredContact || "",
    identity: {
      customerName: order.customerName,
      email: order.email,
      canonicalEmail,
      phone: order.phone || order.paymentTrace?.payerPhone || "",
      alternateContact: order.alternateContact || "",
      notes: order.notes || "",
      userId: linkedUser?.id || order.userId || null,
      accountName: linkedUser?.name || null,
      accountStatus: linkedUser?.status || null
    },
    trace: mergedTrace,
    payment: {
      method: order.paymentMethod,
      status: order.paymentStatus,
      total: order.total,
      subtotal: order.subtotal,
      discount: order.discount || 0,
      coupon: order.coupon || null,
      currency: order.currency || "EUR",
      transactionId: order.paymentTransactionId || "",
      paidAt: order.paidAt || null,
      declaredAt: order.declaredAt || null,
      fastDeclarationSec: order.fastDeclarationSec ?? null,
      payerTrace: order.paymentTrace || {}
    },
    goods: {
      items: order.items || [],
      deliveryStatus: order.deliveryStatus || "pending",
      deliveredAt: order.deliveredAccess?.deliveredAt || null,
      channels: order.deliveredAccess?.channels || [],
      deliveredAccess: order.deliveredAccess || null
    },
    accessMetrics: {
      vaultOpens: order.accessMetrics?.vaultOpens || 0,
      secretReveals: order.accessMetrics?.secretReveals || 0,
      credentialCopies: order.accessMetrics?.credentialCopies || 0,
      proofDownloads: order.accessMetrics?.proofDownloads || 0,
      lastAccessedAt: order.accessMetrics?.lastAccessedAt || null
    },
    riskScore: Number(order.riskScore || 0),
    fraudReasons: order.fraudReasons || [],
    crossMatches,
    linkedClaims,
    traceTimeline: Array.isArray(order.traceTimeline) ? order.traceTimeline : []
  };
}

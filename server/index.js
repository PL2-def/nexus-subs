import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { db, hashPassword, verifyPassword } from "./db.js";
import {
  getPrivacyClientHash,
  signOrderRescueProof,
  appendRescueLedger,
  securityHeadersMiddleware,
  createRateLimiter,
  checkAdminLoginAllowed,
  recordAdminLoginFailure,
  clearAdminLoginFailures
} from "./security.js";
import {
  evaluateOrderFraud,
  evaluateFastDeclarationFraud,
  computeDiscussionDiagnostics
} from "./fraud-and-triage.js";
import {
  sendMobilePushNotification,
  generateNtfyQrDataUrl,
  buildAccessEmailContent,
  sendEmailIfConfigured
} from "./notifications.js";
import {
  generateSepaEpcQr,
  createStripeCheckoutForOrder,
  verifyStripeSession,
  constructStripeWebhookEvent,
  createPayPalOrderForOrder,
  capturePayPalOrder
} from "./payments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist");

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(securityHeadersMiddleware);

// Rate Limiters anti-spam / anti-fraude
const orderLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Trop de tentatives de commandes rapprochées. Patientez 1 minute."
});
const couponLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  message: "Trop d'essais de codes promo. Patientez 1 minute."
});
const lookupLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 12,
  message: "Trop de recherches de commandes. Patientez 1 minute."
});
const chatLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Envoi de messages trop rapide. Patientez quelques secondes."
});

// ============================================================================
// Real-Time Server-Sent Events (SSE) Hubs
// ============================================================================
const catalogStreams = new Set();
const adminStreams = new Set();
const orderStreams = new Map(); // orderId -> Set<res>
const discussionStreams = new Map(); // threadId -> Set<res>

function sendSse(res, event, payload) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // ignore closed stream
  }
}

function broadcastCatalog() {
  const activeProducts = getPublicProducts();
  for (const res of catalogStreams) {
    sendSse(res, "catalog_updated", { products: activeProducts });
  }
}

function broadcastAdmin(event, payload) {
  for (const res of adminStreams) {
    sendSse(res, event, payload);
  }
}

function broadcastOrder(orderId, event, order) {
  const subs = orderStreams.get(orderId);
  if (subs) {
    for (const res of subs) {
      sendSse(res, event, { order: sanitizeOrderForCustomer(order) });
    }
  }
  broadcastAdmin("order_updated", { order });
}

function broadcastDiscussion(threadId, event, thread) {
  const subs = discussionStreams.get(threadId);
  if (subs) {
    for (const res of subs) {
      sendSse(res, event, { thread: sanitizeThreadForCustomer(thread) });
    }
  }
  broadcastAdmin("discussion_updated", {
    thread: enrichThreadForAdmin(thread)
  });
}

function getPublicProducts() {
  return [...db.data.products]
    .filter((p) => p.active !== false)
    .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
}

function getPublicPaymentConfig() {
  const p = db.data.settings.payments;
  const stripeLiveReady = Boolean((p.stripe.secretKey || "").trim() || (p.stripe.paymentLinkFallback || "").trim());
  const paypalLiveReady = Boolean(
    ((p.paypal.clientId || "").trim() && (p.paypal.clientSecret || "").trim()) ||
      (p.paypal.paypalMeUrl || "").trim()
  );

  return {
    stripe: {
      enabled: Boolean(p.stripe.enabled),
      configured: stripeLiveReady,
      mode: (p.stripe.secretKey || "").startsWith("sk_live_")
        ? "live"
        : stripeLiveReady
        ? "configured"
        : "sandbox_demo"
    },
    paypal: {
      enabled: Boolean(p.paypal.enabled),
      configured: paypalLiveReady,
      hasPayPalMe: Boolean((p.paypal.paypalMeUrl || "").trim()),
      mode: paypalLiveReady ? p.paypal.mode || "live" : "sandbox_demo"
    },
    sepa: {
      enabled: Boolean(p.sepa.enabled),
      beneficiary: p.sepa.beneficiary,
      iban: p.sepa.iban,
      bic: p.sepa.bic,
      bank: p.sepa.bank
    }
  };
}

function sanitizeOrderForCustomer(order) {
  if (!order) return null;
  const { accessToken, clientHash, riskScore, fraudReasons, ...safe } = order;
  return safe;
}

function sanitizeThreadForCustomer(thread) {
  if (!thread) return null;
  const { threadToken, clientHash, riskScore, fraudReasons, manualFlags, unreadByAdmin, ...safe } = thread;
  return safe;
}

function enrichThreadForAdmin(thread) {
  return {
    ...thread,
    diagnostics: computeDiscussionDiagnostics(thread, db.data.orders)
  };
}

/**
 * Synchronise aussi chaque message client d'une commande vers un fil dans le menu "Discussions"
 * pour que l'admin ait une vue centralisée de tous les échanges clients !
 */
function syncOrderMessageToDiscussion(order, sender, text) {
  let thread = db.data.discussions.find((t) => t.orderId === order.orderId);
  const nowIso = new Date().toISOString();

  if (!thread) {
    thread = {
      threadId: `DSC-${order.orderId.replace(/^NX-/, "")}`,
      threadToken: crypto.randomBytes(18).toString("hex"),
      createdAt: nowIso,
      updatedAt: nowIso,
      topicType: "order",
      topicLabel: `Commande #${order.orderId}`,
      productId: order.items[0]?.id || null,
      productTitle: order.items.map((i) => i.title).join(", "),
      orderId: order.orderId,
      customerName: order.customerName,
      customerEmail: order.email,
      clientHash: order.clientHash || "",
      status: "open",
      riskScore: order.riskScore || 0,
      fraudReasons: [...(order.fraudReasons || [])],
      manualFlags: {},
      unreadByAdmin: sender === "customer" ? 1 : 0,
      unreadByCustomer: sender === "admin" ? 1 : 0,
      messages: [
        {
          id: `dmsg_${Date.now()}`,
          sender,
          text,
          createdAt: nowIso
        }
      ]
    };
    db.data.discussions.unshift(thread);
  } else {
    thread.messages.push({
      id: `dmsg_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
      sender,
      text,
      createdAt: nowIso
    });
    thread.updatedAt = nowIso;
    if (sender === "customer") {
      thread.status = "open";
      thread.unreadByAdmin = (thread.unreadByAdmin || 0) + 1;
    } else if (sender === "admin") {
      thread.unreadByCustomer = (thread.unreadByCustomer || 0) + 1;
    }
  }
  db.save();
  broadcastDiscussion(thread.threadId, "new_message", thread);
}

function getOrigin(req) {
  const configured = (db.data.settings.publicUrl || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (req.headers.origin) return req.headers.origin.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function extractAdminToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (req.query?.adminToken) return String(req.query.adminToken);
  return "";
}

function requireAdmin(req, res, next) {
  const token = extractAdminToken(req);
  if (!db.verifyAdminSession(token)) {
    return res.status(401).json({ error: "Session administrateur invalide ou expirée." });
  }
  next();
}

function validateCouponInternal(rawCode, subtotal) {
  if (!rawCode) return { valid: false, message: "Veuillez saisir un code promo." };
  const clean = String(rawCode).trim().toUpperCase();
  const coupon = db.data.coupons.find((c) => c.code.toUpperCase() === clean);
  if (!coupon) return { valid: false, message: `Le code « ${clean} » n'existe pas.` };
  if (!coupon.active) return { valid: false, message: `Le code « ${clean} » n'est plus actif.` };
  if (coupon.maxUsage > 0 && (coupon.usageCount || 0) >= coupon.maxUsage) {
    return { valid: false, message: `Ce code promo a atteint sa limite d'utilisations.` };
  }
  if (coupon.minAmount > 0 && subtotal < coupon.minAmount) {
    return {
      valid: false,
      message: `Ce code nécessite un panier minimum de ${coupon.minAmount} € (actuel : ${subtotal} €).`
    };
  }
  const discountAmount =
    coupon.type === "percent"
      ? Math.round(((subtotal * coupon.value) / 100) * 100) / 100
      : Math.min(subtotal, coupon.value);

  return {
    valid: true,
    coupon,
    discountAmount,
    message: `Code « ${coupon.code} » appliqué : ${coupon.label}`
  };
}

async function markOrderPaid(order, { transactionId = "", sourceLabel = "", originUrl = "" } = {}) {
  const alreadyPaid = order.paymentStatus === "paid";
  order.paymentStatus = "paid";
  order.paidAt = order.paidAt || new Date().toISOString();
  if (transactionId) order.paymentTransactionId = transactionId;
  order.updatedAt = new Date().toISOString();

  appendRescueLedger("payment_confirmed", {
    orderId: order.orderId,
    email: order.email,
    total: order.total,
    transactionId,
    sourceLabel
  });

  if (!order.stockDecremented) {
    order.stockDecremented = true;
    let catalogChanged = false;
    for (const item of order.items) {
      const prod = db.data.products.find((p) => p.id === item.id);
      if (prod && typeof prod.stockCount === "number") {
        prod.stockCount = Math.max(0, prod.stockCount - item.quantity);
        if (prod.stockCount === 0) prod.availability = "out_of_stock";
        else if (prod.stockCount <= 3) prod.availability = "low_stock";
        catalogChanged = true;
      }
    }
    if (catalogChanged) broadcastCatalog();
  }

  if (!alreadyPaid) {
    order.messages.push({
      id: `msg_${Date.now()}`,
      sender: "system",
      text: `Paiement confirmé (${sourceLabel || order.paymentMethod}). Vos accès sont garantis : notre équipe vous les transmet directement dans cette fenêtre et par e-mail.`,
      createdAt: new Date().toISOString()
    });
  }

  db.save();

  if (!alreadyPaid) {
    const itemsText = order.items.map((i) => `${i.quantity}x ${i.title}`).join(", ");
    const notif = db.addNotification({
      type: "payment_verified",
      title: `Paiement reçu : ${order.total} € — #${order.orderId}`,
      message: `${order.customerName} (${order.email}) a réglé ${order.total} € via ${sourceLabel || order.paymentMethod} pour : ${itemsText}.`,
      orderId: order.orderId
    });
    broadcastAdmin("notification", { notification: notif });

    const adminUrl = originUrl ? `${originUrl}/?adminOrder=${encodeURIComponent(order.orderId)}#admin` : "";
    await sendMobilePushNotification({
      title: `💰 Paiement confirmé ${order.total} € (#${order.orderId})`,
      message: `Client : ${order.customerName} (${order.email})\nOffre : ${itemsText}\nMode : ${sourceLabel || order.paymentMethod}\nTouchez pour envoyer les accès !`,
      priority: "urgent",
      tags: "moneybag,white_check_mark",
      clickUrl: adminUrl
    });
  }

  broadcastOrder(order.orderId, "order_updated", order);
}

// ============================================================================
// Stripe Webhook (raw body required)
// ============================================================================
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const event = constructStripeWebhookEvent(req.body, sig);
    if (!event) return res.status(200).json({ received: true });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId || session.client_reference_id;
      const order = db.data.orders.find((o) => o.orderId === orderId);
      if (order) {
        await markOrderPaid(order, {
          transactionId: session.id,
          sourceLabel: "Stripe Checkout"
        });
      }
    }
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.use(express.json({ limit: "1mb" }));

// ============================================================================
// Public Storefront Routes
// ============================================================================
app.get("/api/bootstrap", (_req, res) => {
  res.json({
    storeName: db.data.settings.storeName,
    supportEmail: db.data.settings.supportEmail,
    products: getPublicProducts(),
    payments: getPublicPaymentConfig()
  });
});

app.get("/api/events/catalog", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write(": connected\n\n");
  catalogStreams.add(res);
  req.on("close", () => catalogStreams.delete(res));
});

app.post("/api/coupons/validate", couponLimiter, (req, res) => {
  const { code, subtotal = 0 } = req.body || {};
  const result = validateCouponInternal(code, Number(subtotal) || 0);
  if (!result.valid) {
    return res.status(400).json({ valid: false, message: result.message });
  }
  res.json({
    valid: true,
    message: result.message,
    discountAmount: result.discountAmount,
    coupon: {
      code: result.coupon.code,
      type: result.coupon.type,
      value: result.coupon.value,
      label: result.coupon.label,
      minAmount: result.coupon.minAmount
    }
  });
});

app.post("/api/orders", orderLimiter, async (req, res) => {
  try {
    const {
      items,
      couponCode,
      customerName,
      email,
      notes = "",
      paymentMethod,
      honeypot = "",
      formFillMs = null
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Votre panier est vide." });
    }
    const cleanName = String(customerName || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanName) {
      return res.status(400).json({ error: "Veuillez renseigner votre nom." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Veuillez renseigner une adresse e-mail valide." });
    }
    if (!["stripe", "paypal", "sepa_instant"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Moyen de paiement non reconnu." });
    }

    const clientHash = getPrivacyClientHash(req);
    const resolvedItems = [];
    for (const rawItem of items) {
      const product = db.data.products.find((p) => p.id === rawItem.id && p.active !== false);
      if (!product) {
        return res.status(400).json({ error: "Un produit de votre panier n'est plus disponible." });
      }
      const qty = Math.max(1, Math.min(10, parseInt(rawItem.quantity, 10) || 1));
      if (product.availability === "out_of_stock" || (typeof product.stockCount === "number" && product.stockCount <= 0)) {
        return res.status(400).json({ error: `L'offre « ${product.title} » est momentanément en rupture de stock.` });
      }
      if (typeof product.stockCount === "number" && qty > product.stockCount) {
        return res.status(400).json({
          error: `Il ne reste que ${product.stockCount} unité(s) disponible(s) pour « ${product.title} ».`
        });
      }
      resolvedItems.push({
        id: product.id,
        title: product.title,
        duration: product.duration,
        categoryLabel: product.categoryLabel,
        accentColor: product.accentColor,
        deliveryMode: product.deliveryMode || "generic",
        quantity: qty,
        unitPrice: Number(product.price),
        lineTotal: Math.round(Number(product.price) * qty * 100) / 100
      });
    }

    const subtotal = Math.round(resolvedItems.reduce((acc, i) => acc + i.lineTotal, 0) * 100) / 100;
    const totalQuantity = resolvedItems.reduce((acc, i) => acc + i.quantity, 0);

    // Contrôle Anti-Fraude en temps réel
    const fraudCheck = evaluateOrderFraud({
      email: cleanEmail,
      customerName: cleanName,
      total: subtotal,
      totalQuantity,
      clientHash,
      formFillMs: typeof formFillMs === "number" ? formFillMs : null,
      honeypot,
      existingOrders: db.data.orders,
      blockedEmails: db.data.security?.blockedEmails || [],
      blockedHashes: db.data.security?.blockedHashes || []
    });

    if (fraudCheck.blocked) {
      db.addNotification({
        type: "security",
        title: `🚨 Tentative de commande bloquée (${cleanEmail})`,
        message: `Raisons : ${fraudCheck.reasons.join(" • ")}`
      });
      return res.status(403).json({
        error: "Votre commande n'a pas pu être validée par notre filtre de sécurité automatique. Contactez notre assistance en direct si vous pensez qu'il s'agit d'une erreur."
      });
    }

    let discount = 0;
    let appliedCoupon = null;
    if (couponCode) {
      const cVal = validateCouponInternal(couponCode, subtotal);
      if (cVal.valid) {
        discount = cVal.discountAmount;
        appliedCoupon = cVal.coupon.code;
        cVal.coupon.usageCount = (cVal.coupon.usageCount || 0) + 1;
      }
    }

    const total = Math.max(1, Math.round((subtotal - discount) * 100) / 100);
    const numId = String(Math.floor(100000 + Math.random() * 900000));
    const orderId = `NX-${numId}`;
    const sepaRef = `NEXUS-${numId}`;
    const accessToken = crypto.randomBytes(18).toString("hex");
    const createdAt = new Date().toISOString();
    const originUrl = getOrigin(req);

    let sepaQr = null;
    if (paymentMethod === "sepa_instant") {
      sepaQr = await generateSepaEpcQr(total, sepaRef);
    }

    const order = {
      orderId,
      sepaRef,
      accessToken,
      clientHash,
      riskScore: fraudCheck.score,
      fraudReasons: fraudCheck.reasons,
      createdAt,
      updatedAt: createdAt,
      customerName: cleanName,
      email: cleanEmail,
      notes: String(notes || "").trim().slice(0, 500),
      items: resolvedItems,
      subtotal,
      discount,
      coupon: appliedCoupon,
      total,
      currency: "EUR",
      paymentMethod,
      paymentStatus: "awaiting_payment",
      paymentTransactionId: "",
      deliveryStatus: "pending",
      deliveredAccess: null,
      sepaDetails: sepaQr
        ? {
            qrDataUrl: sepaQr.qrDataUrl,
            beneficiary: sepaQr.beneficiary,
            iban: sepaQr.iban,
            bic: sepaQr.bic,
            bank: sepaQr.bank,
            reference: sepaRef
          }
        : null,
      messages: [
        {
          id: `msg_init_${Date.now()}`,
          sender: "system",
          text:
            paymentMethod === "sepa_instant"
              ? `Commande #${orderId} enregistrée avec Garantie Zéro Perte. Scannez le QR Code SEPA ou copiez l'IBAN avec la référence ${sepaRef}, puis cliquez sur « J'ai effectué le virement ».`
              : `Commande #${orderId} enregistrée avec Garantie Zéro Perte. Finalisez le paiement sécurisé pour recevoir vos accès ici-même et par e-mail.`,
          createdAt
        }
      ]
    };

    order.proofSignature = signOrderRescueProof(order);

    // Sauvegarde double : Base chiffrée + Journal de secours immuable
    db.data.orders.unshift(order);
    db.data.orders = db.data.orders.slice(0, 400);
    db.save();

    appendRescueLedger("order_created", {
      orderId: order.orderId,
      sepaRef: order.sepaRef,
      email: order.email,
      customerName: order.customerName,
      total: order.total,
      paymentMethod: order.paymentMethod,
      items: order.items.map((i) => ({ id: i.id, title: i.title, qty: i.quantity })),
      proofSignature: order.proofSignature
    });

    let paymentAction = { type: paymentMethod };
    if (paymentMethod === "stripe") {
      const stripeRes = await createStripeCheckoutForOrder(order, originUrl);
      paymentAction = { type: "stripe", ...stripeRes };
    } else if (paymentMethod === "paypal") {
      const paypalRes = await createPayPalOrderForOrder(order, originUrl);
      if (paypalRes.paypalOrderId) {
        order.paymentTransactionId = paypalRes.paypalOrderId;
        db.save();
      }
      paymentAction = { type: "paypal", ...paypalRes };
    } else if (paymentMethod === "sepa_instant") {
      paymentAction = { type: "sepa_instant", sepa: order.sepaDetails };
    }

    const itemsSummary = resolvedItems.map((i) => `${i.quantity}x ${i.title}`).join(", ");
    const fraudTag = fraudCheck.score >= 40 ? ` ⚠️ [Risque Fraude: ${fraudCheck.score}/100]` : "";
    const notif = db.addNotification({
      type: "order",
      title: `Nouvelle commande #${orderId} (${total} €)${fraudTag}`,
      message: `${cleanName} (${cleanEmail}) — ${paymentMethod.toUpperCase()} : ${itemsSummary}.`,
      orderId
    });
    broadcastAdmin("order_created", { order, notification: notif });

    res.status(201).json({
      order: sanitizeOrderForCustomer(order),
      accessToken,
      paymentAction
    });
  } catch (err) {
    console.error("[Order Create Error]", err);
    res.status(500).json({ error: err.message || "Erreur lors de la création de la commande." });
  }
});

app.post("/api/orders/:orderId/confirm-gateway", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { token, gateway, sessionId, paypalOrderId, sandboxConfirm } = req.body || {};
    const order = db.data.orders.find((o) => o.orderId === orderId);
    if (!order || order.accessToken !== token) {
      return res.status(404).json({ error: "Commande introuvable ou jeton invalide." });
    }

    const originUrl = getOrigin(req);

    if (gateway === "stripe") {
      const secretKey = (db.data.settings.payments.stripe.secretKey || "").trim();
      if (secretKey && sessionId) {
        const check = await verifyStripeSession(sessionId);
        if (!check.verified) {
          return res.status(400).json({ error: "Le paiement Stripe n'est pas encore confirmé." });
        }
        await markOrderPaid(order, {
          transactionId: sessionId,
          sourceLabel: "Carte Bancaire / Stripe",
          originUrl
        });
      } else if (!secretKey && sandboxConfirm) {
        await markOrderPaid(order, {
          transactionId: `sandbox_stripe_${Date.now()}`,
          sourceLabel: "Stripe (Mode Test Sandbox)",
          originUrl
        });
      } else {
        return res.status(400).json({ error: "Session Stripe manquante." });
      }
    } else if (gateway === "paypal") {
      const paypalCfg = db.data.settings.payments.paypal;
      const hasApiKeys = Boolean((paypalCfg.clientId || "").trim() && (paypalCfg.clientSecret || "").trim());
      if (hasApiKeys && (paypalOrderId || order.paymentTransactionId)) {
        const cap = await capturePayPalOrder(paypalOrderId || order.paymentTransactionId);
        if (!cap.completed) {
          return res.status(400).json({ error: "Le paiement PayPal n'a pas pu être capturé." });
        }
        await markOrderPaid(order, {
          transactionId: paypalOrderId || order.paymentTransactionId,
          sourceLabel: "PayPal Checkout",
          originUrl
        });
      } else if (!hasApiKeys && sandboxConfirm) {
        await markOrderPaid(order, {
          transactionId: `sandbox_paypal_${Date.now()}`,
          sourceLabel: "PayPal (Mode Test Sandbox)",
          originUrl
        });
      } else {
        return res.status(400).json({ error: "Identifiant PayPal manquant." });
      }
    }

    res.json({ order: sanitizeOrderForCustomer(order) });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur de vérification du paiement." });
  }
});

app.post("/api/orders/:orderId/declare-payment", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { token, senderHint = "" } = req.body || {};
    const order = db.data.orders.find((o) => o.orderId === orderId);
    if (!order || order.accessToken !== token) {
      return res.status(404).json({ error: "Commande introuvable." });
    }

    if (order.paymentStatus !== "paid") {
      const fastCheck = evaluateFastDeclarationFraud(order);
      if (fastCheck.suspicious) {
        order.riskScore = Math.min(100, (order.riskScore || 0) + fastCheck.addedScore);
        order.fraudReasons = order.fraudReasons || [];
        if (!order.fraudReasons.includes(fastCheck.reason)) {
          order.fraudReasons.push(fastCheck.reason);
        }
      }

      order.paymentStatus = "declaration_sent";
      order.declaredAt = new Date().toISOString();
      order.updatedAt = new Date().toISOString();
      const methodLabel =
        order.paymentMethod === "sepa_instant"
          ? `Virement SEPA Instantané (Réf: ${order.sepaRef})`
          : "PayPal";

      order.messages.push({
        id: `msg_${Date.now()}`,
        sender: "system",
        text: `Règlement déclaré (${methodLabel})${senderHint ? ` — Titulaire/Note : ${senderHint}` : ""}. Votre déclaration est enregistrée dans notre journal de garantie : le vendeur vient d'être alerté sur son téléphone !`,
        createdAt: new Date().toISOString()
      });
      db.save();

      appendRescueLedger("payment_declared", {
        orderId: order.orderId,
        email: order.email,
        total: order.total,
        methodLabel,
        senderHint,
        suspiciousFastClick: fastCheck.suspicious
      });

      const itemsText = order.items.map((i) => `${i.quantity}x ${i.title}`).join(", ");
      const warnSuffix = fastCheck.suspicious ? " 🚨 [ALERTE: Déclaration en < 9s, vérifiez votre banque !]" : "";
      const notif = db.addNotification({
        type: "order",
        title: `⚡ Règlement déclaré : ${order.total} € — #${order.orderId}${warnSuffix}`,
        message: `${order.customerName} (${order.email}) déclare avoir payé ${order.total} € (${methodLabel}).`,
        orderId: order.orderId
      });
      broadcastAdmin("notification", { notification: notif });

      const originUrl = getOrigin(req);
      await sendMobilePushNotification({
        title: `${fastCheck.suspicious ? "🚨 [VÉRIFIER BANQUE]" : "⚡"} Paiement déclaré ${order.total} € (#${order.orderId})`,
        message: `Client : ${order.customerName} (${order.email})\nOffre : ${itemsText}\nMéthode : ${methodLabel}${senderHint ? `\nTitulaire : ${senderHint}` : ""}${fastCheck.suspicious ? `\n⚠️ Attention : cliqué en moins de 9s !` : ""}`,
        priority: "urgent",
        tags: fastCheck.suspicious ? "warning,euro" : "zap,euro",
        clickUrl: `${originUrl}/?adminOrder=${encodeURIComponent(order.orderId)}#admin`
      });

      broadcastOrder(order.orderId, "order_updated", order);
    }

    res.json({ order: sanitizeOrderForCustomer(order) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders/lookup", lookupLimiter, (req, res) => {
  const { orderId, email } = req.body || {};
  const rawId = String(orderId || "")
    .trim()
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/^NEXUS-/, "NX-");
  const normalizedNum = rawId.replace(/^NX-/, "");
  const cleanEmail = String(email || "").trim().toLowerCase();

  const order = db.data.orders.find(
    (o) =>
      (o.orderId.toUpperCase() === rawId || o.orderId.endsWith(normalizedNum)) &&
      o.email.toLowerCase() === cleanEmail
  );

  if (!order) {
    return res.status(404).json({
      error: "Aucune commande trouvée avec ce numéro et cet e-mail. Si vous avez fait une erreur d'adresse e-mail en commandant, utilisez le bouton « Secours Paiement / Bug » !"
    });
  }

  res.json({
    order: sanitizeOrderForCustomer(order),
    accessToken: order.accessToken
  });
});

app.get("/api/orders/:orderId", (req, res) => {
  const { orderId } = req.params;
  const token = String(req.query.token || "");
  const isAdmin = db.verifyAdminSession(extractAdminToken(req));
  const order = db.data.orders.find((o) => o.orderId === orderId);

  if (!order || (!isAdmin && order.accessToken !== token)) {
    return res.status(404).json({ error: "Commande introuvable." });
  }

  res.json({ order: isAdmin ? order : sanitizeOrderForCustomer(order) });
});

app.get("/api/events/order/:orderId", (req, res) => {
  const { orderId } = req.params;
  const token = String(req.query.token || "");
  const isAdmin = db.verifyAdminSession(extractAdminToken(req));
  const order = db.data.orders.find((o) => o.orderId === orderId);

  if (!order || (!isAdmin && order.accessToken !== token)) {
    return res.status(403).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  sendSse(res, "init", { order: sanitizeOrderForCustomer(order) });

  if (!orderStreams.has(orderId)) orderStreams.set(orderId, new Set());
  orderStreams.get(orderId).add(res);

  req.on("close", () => {
    const set = orderStreams.get(orderId);
    if (set) {
      set.delete(res);
      if (set.size === 0) orderStreams.delete(orderId);
    }
  });
});

app.post("/api/orders/:orderId/messages", chatLimiter, async (req, res) => {
  const { orderId } = req.params;
  const { token, text } = req.body || {};
  const isAdmin = db.verifyAdminSession(extractAdminToken(req));
  const order = db.data.orders.find((o) => o.orderId === orderId);

  if (!order || (!isAdmin && order.accessToken !== token)) {
    return res.status(403).json({ error: "Non autorisé." });
  }

  const cleanText = String(text || "").trim().slice(0, 1500);
  if (!cleanText) return res.status(400).json({ error: "Message vide." });

  const sender = isAdmin ? "admin" : "customer";
  const msg = {
    id: `msg_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
    sender,
    text: cleanText,
    createdAt: new Date().toISOString()
  };

  order.messages.push(msg);
  order.updatedAt = new Date().toISOString();
  db.save();

  // Synchroniser aussi avec le Menu "Discussions" de l'Admin !
  syncOrderMessageToDiscussion(order, sender, cleanText);

  if (!isAdmin) {
    const notif = db.addNotification({
      type: "contact",
      title: `💬 Message sur commande #${order.orderId}`,
      message: `${order.customerName} : « ${cleanText.slice(0, 120)} »`,
      orderId: order.orderId
    });
    broadcastAdmin("notification", { notification: notif });

    const originUrl = getOrigin(req);
    await sendMobilePushNotification({
      title: `💬 ${order.customerName} (#${order.orderId})`,
      message: cleanText,
      priority: "high",
      tags: "speech_balloon",
      clickUrl: `${originUrl}/?adminOrder=${encodeURIComponent(order.orderId)}#admin`
    });
  }

  broadcastOrder(order.orderId, "new_message", order);
  res.json({ order: isAdmin ? order : sanitizeOrderForCustomer(order), message: msg });
});

// ============================================================================
// Universal Live Customer Discussion System (Tous articles ou Article précis)
// + Garantie Zéro Perte / Ticket de Secours Paiement
// ============================================================================
app.post("/api/discussions", chatLimiter, async (req, res) => {
  try {
    const {
      existingThreadId = "",
      existingToken = "",
      customerName = "",
      customerEmail = "",
      topicType = "general", // 'general' | 'product' | 'rescue' | 'order'
      productId = "",
      orderId = "",
      initialMessage = "",
      honeypot = ""
    } = req.body || {};

    if (honeypot) return res.status(400).json({ error: "Requête refusée." });

    const cleanMsg = String(initialMessage || "").trim().slice(0, 1800);
    if (!cleanMsg) {
      return res.status(400).json({ error: "Veuillez écrire votre question ou message." });
    }

    const clientHash = getPrivacyClientHash(req);
    const cleanEmail = String(customerEmail || "").trim().toLowerCase();
    if (
      (cleanEmail && db.data.security?.blockedEmails?.includes(cleanEmail)) ||
      db.data.security?.blockedHashes?.includes(clientHash)
    ) {
      return res.status(403).json({ error: "Accès restreint par la modération." });
    }

    const prod = productId ? db.data.products.find((p) => p.id === productId) : null;
    const topicLabel =
      topicType === "rescue"
        ? "🛡️ Secours Paiement / Garantie Zéro Perte"
        : prod
        ? `Article : ${prod.title} (${prod.price} €)`
        : topicType === "order" && orderId
        ? `Commande #${orderId}`
        : "Question générale (Catalogue & Boutique)";

    // Si le client reprend sa discussion existante
    let thread = null;
    if (existingThreadId && existingToken) {
      const found = db.data.discussions.find((t) => t.threadId === existingThreadId && t.threadToken === existingToken);
      if (found) thread = found;
    }

    const nowIso = new Date().toISOString();

    if (!thread) {
      const num = String(Math.floor(100000 + Math.random() * 900000));
      thread = {
        threadId: `DSC-${num}`,
        threadToken: crypto.randomBytes(18).toString("hex"),
        createdAt: nowIso,
        updatedAt: nowIso,
        topicType: prod ? "product" : topicType,
        topicLabel,
        productId: prod ? prod.id : null,
        productTitle: prod ? prod.title : null,
        orderId: orderId ? String(orderId).trim() : null,
        customerName: String(customerName || "").trim() || "Visiteur",
        customerEmail: cleanEmail,
        clientHash,
        status: "open",
        riskScore: 0,
        fraudReasons: [],
        manualFlags: {},
        unreadByAdmin: 1,
        unreadByCustomer: 0,
        messages: [
          {
            id: `dmsg_welcome_${Date.now()}`,
            sender: "system",
            text: `Discussion ouverte concernant : ${topicLabel}. Notre équipe vient de recevoir une notification sur mobile et vous répond ici-même en direct !`,
            createdAt: nowIso
          },
          {
            id: `dmsg_${Date.now()}_c`,
            sender: "customer",
            text: cleanMsg,
            topicContext: topicLabel,
            createdAt: nowIso
          }
        ]
      };
      db.data.discussions.unshift(thread);
      db.data.discussions = db.data.discussions.slice(0, 300);
    } else {
      if (customerName && String(customerName).trim()) thread.customerName = String(customerName).trim();
      if (cleanEmail) thread.customerEmail = cleanEmail;
      thread.topicType = prod ? "product" : topicType;
      thread.topicLabel = topicLabel;
      thread.productId = prod ? prod.id : thread.productId;
      thread.productTitle = prod ? prod.title : thread.productTitle;
      thread.status = "open";
      thread.updatedAt = nowIso;
      thread.unreadByAdmin = (thread.unreadByAdmin || 0) + 1;
      thread.messages.push({
        id: `dmsg_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
        sender: "customer",
        text: cleanMsg,
        topicContext: topicLabel,
        createdAt: nowIso
      });
    }

    db.save();

    const diag = computeDiscussionDiagnostics(thread, db.data.orders);
    const alertPrefix = diag.isSuspectedFraud
      ? "🚨 [SUSPECT FRAUDE]"
      : diag.isAnnoyed
      ? "😤 [CLIENT AGACÉ]"
      : diag.needsFastHelp
      ? "⚡ [AIDE RAPIDE]"
      : "💬";

    const notif = db.addNotification({
      type: "discussion",
      title: `${alertPrefix} ${thread.customerName} — ${topicLabel}`,
      message: cleanMsg.slice(0, 140),
      threadId: thread.threadId
    });
    broadcastAdmin("discussion_updated", {
      thread: { ...thread, diagnostics: diag },
      notification: notif
    });

    const originUrl = getOrigin(req);
    await sendMobilePushNotification({
      title: `${alertPrefix} ${thread.customerName} (${topicLabel})`,
      message: cleanMsg.slice(0, 300),
      priority: diag.needsFastHelp || diag.isAnnoyed ? "urgent" : "high",
      tags: diag.isAnnoyed ? "rotating_light,speech_balloon" : "speech_balloon,sparkles",
      clickUrl: `${originUrl}/?adminThread=${encodeURIComponent(thread.threadId)}#admin`
    });

    res.status(201).json({
      thread: sanitizeThreadForCustomer(thread),
      threadToken: thread.threadToken
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur lors de l'ouverture de la discussion." });
  }
});

// Garantie Zéro Perte : Formulaire de Secours d'Urgence après paiement / bug
app.post("/api/rescue-claim", orderLimiter, async (req, res) => {
  try {
    const {
      customerName = "",
      email = "",
      orderRef = "",
      paymentMethod = "",
      amountPaid = "",
      paymentProof = "",
      problemDetails = ""
    } = req.body || {};

    const cleanName = String(customerName || "").trim() || "Client Secours";
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || !String(paymentProof || problemDetails).trim()) {
      return res.status(400).json({
        error: "Veuillez indiquer une adresse e-mail valide ainsi qu'un détail ou justificatif de votre règlement."
      });
    }

    const nowIso = new Date().toISOString();
    const rescueId = `SOS-${Math.floor(100000 + Math.random() * 900000)}`;
    const claim = {
      rescueId,
      createdAt: nowIso,
      customerName: cleanName,
      email: cleanEmail,
      orderRef: String(orderRef || "").trim(),
      paymentMethod: String(paymentMethod || "").trim(),
      amountPaid: String(amountPaid || "").trim(),
      paymentProof: String(paymentProof || "").trim(),
      problemDetails: String(problemDetails || "").trim()
    };

    // Écriture immuable immédiate sur le disque de secours
    appendRescueLedger("rescue_claim_submitted", claim);
    db.data.rescueClaims.unshift(claim);
    db.save();

    // Créer automatiquement une discussion prioritaire pour que le client parle en direct avec le vendeur
    const summaryMsg = [
      `🛡️ TICKET DE SECOURS PAIEMENT (${rescueId})`,
      `• Montant réglé : ${claim.amountPaid || "Non précisé"} (${claim.paymentMethod || "Non précisé"})`,
      claim.orderRef ? `• N° commande / Réf : ${claim.orderRef}` : null,
      claim.paymentProof ? `• Preuve / Titulaire / ID Transaction : ${claim.paymentProof}` : null,
      claim.problemDetails ? `• Détail du problème : ${claim.problemDetails}` : null
    ]
      .filter(Boolean)
      .join("\n");

    const thread = {
      threadId: `DSC-${rescueId.replace("SOS-", "")}`,
      threadToken: crypto.randomBytes(18).toString("hex"),
      createdAt: nowIso,
      updatedAt: nowIso,
      topicType: "rescue",
      topicLabel: `🛡️ Secours Paiement (${claim.amountPaid || "?"} €)`,
      productId: null,
      productTitle: null,
      orderId: claim.orderRef || null,
      customerName: cleanName,
      customerEmail: cleanEmail,
      clientHash: getPrivacyClientHash(req),
      status: "open",
      riskScore: 0,
      fraudReasons: [],
      manualFlags: { fastHelp: true },
      unreadByAdmin: 1,
      unreadByCustomer: 0,
      messages: [
        {
          id: `dmsg_sos_sys_${Date.now()}`,
          sender: "system",
          text: `Votre dossier de Garantie Zéro Perte #${rescueId} est enregistré de façon permanente. Un administrateur vient d'être alerté en urgence sur son téléphone : vos fonds sont 100% protégés.`,
          createdAt: nowIso
        },
        {
          id: `dmsg_sos_usr_${Date.now()}`,
          sender: "customer",
          text: summaryMsg,
          createdAt: nowIso
        }
      ]
    };

    db.data.discussions.unshift(thread);
    db.save();

    const diag = computeDiscussionDiagnostics(thread, db.data.orders);
    const notif = db.addNotification({
      type: "rescue",
      title: `🚨 URGENCE SECOURS PAIEMENT #${rescueId} — ${cleanName}`,
      message: `${cleanEmail} signale un paiement de ${claim.amountPaid || "?"} € (${claim.paymentMethod}).`,
      threadId: thread.threadId
    });
    broadcastAdmin("discussion_updated", {
      thread: { ...thread, diagnostics: diag },
      notification: notif
    });

    const originUrl = getOrigin(req);
    await sendMobilePushNotification({
      title: `🚨 SECOURS PAIEMENT #${rescueId} (${claim.amountPaid || "?"} €)`,
      message: `Client : ${cleanName} (${cleanEmail})\nPreuve : ${claim.paymentProof}\n${claim.problemDetails.slice(0, 180)}`,
      priority: "urgent",
      tags: "sos,rotating_light",
      clickUrl: `${originUrl}/?adminThread=${encodeURIComponent(thread.threadId)}#admin`
    });

    res.status(201).json({
      rescueId,
      thread: sanitizeThreadForCustomer(thread),
      threadToken: thread.threadToken
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/discussions/:threadId", (req, res) => {
  const { threadId } = req.params;
  const token = String(req.query.token || "");
  const isAdmin = db.verifyAdminSession(extractAdminToken(req));
  const thread = db.data.discussions.find((t) => t.threadId === threadId);

  if (!thread || (!isAdmin && thread.threadToken !== token)) {
    return res.status(404).json({ error: "Discussion introuvable." });
  }

  if (!isAdmin && thread.unreadByCustomer > 0) {
    thread.unreadByCustomer = 0;
    db.save();
  }

  res.json({
    thread: isAdmin ? enrichThreadForAdmin(thread) : sanitizeThreadForCustomer(thread)
  });
});

app.patch("/api/discussions/:threadId/context", (req, res) => {
  const { threadId } = req.params;
  const { token, topicType, productId, customerName, customerEmail } = req.body || {};
  const thread = db.data.discussions.find((t) => t.threadId === threadId && t.threadToken === token);
  if (!thread) return res.status(404).json({ error: "Discussion introuvable." });

  if (customerName !== undefined && String(customerName).trim()) {
    thread.customerName = String(customerName).trim();
  }
  if (customerEmail !== undefined && String(customerEmail).trim()) {
    thread.customerEmail = String(customerEmail).trim().toLowerCase();
  }
  if (topicType) {
    const prod = productId ? db.data.products.find((p) => p.id === productId) : null;
    thread.topicType = prod ? "product" : topicType;
    thread.productId = prod ? prod.id : null;
    thread.productTitle = prod ? prod.title : null;
    thread.topicLabel =
      topicType === "rescue"
        ? "🛡️ Secours Paiement / Garantie Zéro Perte"
        : prod
        ? `Article : ${prod.title} (${prod.price} €)`
        : "Question générale (Catalogue & Boutique)";
  }
  db.save();
  broadcastDiscussion(thread.threadId, "discussion_updated", thread);
  res.json({ thread: sanitizeThreadForCustomer(thread) });
});

app.get("/api/events/discussion/:threadId", (req, res) => {
  const { threadId } = req.params;
  const token = String(req.query.token || "");
  const isAdmin = db.verifyAdminSession(extractAdminToken(req));
  const thread = db.data.discussions.find((t) => t.threadId === threadId);

  if (!thread || (!isAdmin && thread.threadToken !== token)) {
    return res.status(403).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  sendSse(res, "init", { thread: sanitizeThreadForCustomer(thread) });

  if (!discussionStreams.has(threadId)) discussionStreams.set(threadId, new Set());
  discussionStreams.get(threadId).add(res);

  req.on("close", () => {
    const set = discussionStreams.get(threadId);
    if (set) {
      set.delete(res);
      if (set.size === 0) discussionStreams.delete(threadId);
    }
  });
});

app.post("/api/discussions/:threadId/messages", chatLimiter, async (req, res) => {
  const { threadId } = req.params;
  const { token, text, attachedProductId = null, attachedCouponCode = null } = req.body || {};
  const isAdmin = db.verifyAdminSession(extractAdminToken(req));
  const thread = db.data.discussions.find((t) => t.threadId === threadId);

  if (!thread || (!isAdmin && thread.threadToken !== token)) {
    return res.status(403).json({ error: "Non autorisé." });
  }

  const cleanText = String(text || "").trim().slice(0, 1800);
  if (!cleanText && !attachedProductId && !attachedCouponCode) {
    return res.status(400).json({ error: "Message vide." });
  }

  let attachment = null;
  if (isAdmin && attachedProductId) {
    const p = db.data.products.find((x) => x.id === attachedProductId);
    if (p) {
      attachment = {
        type: "product",
        id: p.id,
        title: p.title,
        price: p.price,
        duration: p.duration
      };
    }
  } else if (isAdmin && attachedCouponCode) {
    const c = db.data.coupons.find((x) => x.code.toUpperCase() === String(attachedCouponCode).toUpperCase());
    if (c) {
      attachment = {
        type: "coupon",
        code: c.code,
        label: c.label
      };
    }
  }

  const nowIso = new Date().toISOString();
  const msg = {
    id: `dmsg_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`,
    sender: isAdmin ? "admin" : "customer",
    text: cleanText,
    attachment,
    createdAt: nowIso
  };

  thread.messages.push(msg);
  thread.updatedAt = nowIso;

  if (isAdmin) {
    thread.unreadByAdmin = 0;
    thread.unreadByCustomer = (thread.unreadByCustomer || 0) + 1;
    // Si la discussion est liée à une commande, synchroniser aussi la réponse dans la fenêtre de commande !
    if (thread.orderId) {
      const ord = db.data.orders.find((o) => o.orderId === thread.orderId);
      if (ord) {
        ord.messages.push({
          id: `msg_${Date.now()}`,
          sender: "admin",
          text: cleanText,
          createdAt: nowIso
        });
        broadcastOrder(ord.orderId, "new_message", ord);
      }
    }
  } else {
    thread.status = "open";
    thread.unreadByAdmin = (thread.unreadByAdmin || 0) + 1;
  }

  db.save();

  if (!isAdmin) {
    const diag = computeDiscussionDiagnostics(thread, db.data.orders);
    const prefix = diag.isSuspectedFraud
      ? "🚨 [SUSPECT FRAUDE]"
      : diag.isAnnoyed
      ? "😤 [CLIENT AGACÉ]"
      : diag.needsFastHelp
      ? "⚡ [AIDE RAPIDE]"
      : "💬";

    const notif = db.addNotification({
      type: "discussion",
      title: `${prefix} ${thread.customerName} (${thread.topicLabel})`,
      message: cleanText.slice(0, 140),
      threadId: thread.threadId
    });
    broadcastAdmin("notification", { notification: notif });

    const originUrl = getOrigin(req);
    await sendMobilePushNotification({
      title: `${prefix} ${thread.customerName}`,
      message: `[${thread.topicLabel}]\n${cleanText.slice(0, 260)}`,
      priority: diag.needsFastHelp || diag.isAnnoyed ? "urgent" : "high",
      tags: diag.isAnnoyed ? "anger,speech_balloon" : "speech_balloon",
      clickUrl: `${originUrl}/?adminThread=${encodeURIComponent(thread.threadId)}#admin`
    });
  }

  broadcastDiscussion(thread.threadId, "new_message", thread);
  res.json({
    thread: isAdmin ? enrichThreadForAdmin(thread) : sanitizeThreadForCustomer(thread),
    message: msg
  });
});

app.post("/api/support", chatLimiter, async (req, res) => {
  const { name, email, message } = req.body || {};
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanMsg = String(message || "").trim();

  if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || !cleanMsg) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs correctement." });
  }

  const nowIso = new Date().toISOString();
  const item = {
    id: `sup_${Date.now()}`,
    name: cleanName,
    email: cleanEmail,
    message: cleanMsg.slice(0, 2000),
    createdAt: nowIso
  };
  db.data.supportMessages.unshift(item);

  // Créer aussi un fil dans le menu "Discussions" pour que l'admin puisse tout traiter au même endroit !
  const thread = {
    threadId: `DSC-${Math.floor(100000 + Math.random() * 900000)}`,
    threadToken: crypto.randomBytes(18).toString("hex"),
    createdAt: nowIso,
    updatedAt: nowIso,
    topicType: "general",
    topicLabel: "Formulaire Support 7j/7",
    productId: null,
    productTitle: null,
    orderId: null,
    customerName: cleanName,
    customerEmail: cleanEmail,
    clientHash: getPrivacyClientHash(req),
    status: "open",
    riskScore: 0,
    fraudReasons: [],
    manualFlags: {},
    unreadByAdmin: 1,
    unreadByCustomer: 0,
    messages: [
      {
        id: `dmsg_${Date.now()}`,
        sender: "customer",
        text: cleanMsg.slice(0, 2000),
        createdAt: nowIso
      }
    ]
  };
  db.data.discussions.unshift(thread);

  const notif = db.addNotification({
    type: "contact",
    title: `Demande Support de ${cleanName}`,
    message: cleanMsg.slice(0, 140),
    threadId: thread.threadId
  });
  db.save();

  broadcastAdmin("support_message", { supportMessage: item, notification: notif });
  await sendMobilePushNotification({
    title: `✉️ Support : ${cleanName}`,
    message: `${cleanEmail}\n${cleanMsg.slice(0, 250)}`,
    priority: "default",
    tags: "envelope",
    clickUrl: `${getOrigin(req)}/?adminThread=${encodeURIComponent(thread.threadId)}#admin`
  });

  res.json({ ok: true, thread: sanitizeThreadForCustomer(thread), threadToken: thread.threadToken });
});

app.post("/api/newsletter", (req, res) => {
  const cleanEmail = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Adresse e-mail invalide." });
  }
  if (!db.data.newsletter.includes(cleanEmail)) {
    db.data.newsletter.unshift(cleanEmail);
    const notif = db.addNotification({
      type: "newsletter",
      title: "Nouvel inscrit Newsletter",
      message: `${cleanEmail} a rejoint la liste privilège.`
    });
    db.save();
    broadcastAdmin("notification", { notification: notif });
  }
  res.json({ ok: true });
});

// ============================================================================
// Admin Routes (Authenticated + Brute-Force Protected)
// ============================================================================
app.post("/api/admin/login", async (req, res) => {
  const ipHash = getPrivacyClientHash(req);
  const lockCheck = checkAdminLoginAllowed(ipHash);
  if (!lockCheck.allowed) {
    return res.status(429).json({ error: lockCheck.message });
  }

  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const admin = db.data.admin;

  const emailMatches = cleanEmail === admin.email.toLowerCase() || cleanEmail === "admin@nexus.fr";

  if (!emailMatches || !verifyPassword(String(password || ""), admin.passwordSalt, admin.passwordHash)) {
    // Délai anti-timing-attack
    await new Promise((r) => setTimeout(r, 350));
    const failInfo = recordAdminLoginFailure(ipHash);
    if (failInfo.count >= 3) {
      db.addNotification({
        type: "security",
        title: `🔐 Alerte sécurité : ${failInfo.count} échecs de connexion Admin`,
        message: `Empreinte réseau anonymisée : #${ipHash}`
      });
    }
    return res.status(401).json({
      error: `Identifiants incorrects (${Math.max(0, 5 - failInfo.count)} essai(s) restant(s) avant verrouillage temporaire).`
    });
  }

  clearAdminLoginFailures(ipHash);
  const token = db.createAdminSession(admin.email);
  res.json({
    token,
    admin: {
      name: admin.name,
      email: admin.email
    }
  });
});

app.post("/api/admin/logout", (req, res) => {
  db.revokeAdminSession(extractAdminToken(req));
  res.json({ ok: true });
});

app.get("/api/events/admin", requireAdmin, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write(": admin-connected\n\n");
  adminStreams.add(res);
  req.on("close", () => adminStreams.delete(res));
});

app.get("/api/admin/dashboard", requireAdmin, async (_req, res) => {
  const orders = db.data.orders;
  const paidOrders = orders.filter((o) => o.paymentStatus === "paid");
  const totalRevenue = Math.round(paidOrders.reduce((acc, o) => acc + Number(o.total || 0), 0) * 100) / 100;
  const pendingDeliveries = orders.filter(
    (o) => (o.paymentStatus === "paid" || o.paymentStatus === "declaration_sent") && o.deliveryStatus !== "delivered"
  ).length;

  const enrichedDiscussions = db.data.discussions
    .map((t) => enrichThreadForAdmin(t))
    .sort((a, b) => b.diagnostics.priorityScore - a.diagnostics.priorityScore);

  const openWaitingDiscussions = enrichedDiscussions.filter(
    (t) => !t.diagnostics.isResolved && (t.diagnostics.waitingSince || t.unreadByAdmin > 0)
  ).length;
  const urgentDiscussionsCount = enrichedDiscussions.filter(
    (t) => !t.diagnostics.isResolved && (t.diagnostics.needsFastHelp || t.diagnostics.isAnnoyed)
  ).length;
  const fraudDiscussionsCount = enrichedDiscussions.filter((t) => t.diagnostics.isSuspectedFraud).length;

  const ntfyInfo = await generateNtfyQrDataUrl();
  const s = db.data.settings;

  res.json({
    admin: {
      name: db.data.admin.name,
      email: db.data.admin.email
    },
    stats: {
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      totalRevenue,
      pendingDeliveries,
      openWaitingDiscussions,
      urgentDiscussionsCount,
      fraudDiscussionsCount,
      unreadNotifications: db.data.notifications.filter((n) => !n.read).length
    },
    orders,
    discussions: enrichedDiscussions,
    rescueClaims: db.data.rescueClaims || [],
    security: {
      blockedEmails: db.data.security?.blockedEmails || [],
      blockedHashesCount: (db.data.security?.blockedHashes || []).length
    },
    products: [...db.data.products].sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)),
    coupons: db.data.coupons,
    supportMessages: db.data.supportMessages,
    newsletter: db.data.newsletter,
    notifications: db.data.notifications,
    ntfyInfo,
    settings: {
      storeName: s.storeName,
      supportEmail: s.supportEmail,
      publicUrl: s.publicUrl,
      payments: {
        stripe: {
          enabled: s.payments.stripe.enabled,
          publishableKey: s.payments.stripe.publishableKey,
          hasSecretKey: Boolean((s.payments.stripe.secretKey || "").trim()),
          secretKeyPreview: maskSecret(s.payments.stripe.secretKey),
          hasWebhookSecret: Boolean((s.payments.stripe.webhookSecret || "").trim()),
          paymentLinkFallback: s.payments.stripe.paymentLinkFallback || ""
        },
        paypal: {
          enabled: s.payments.paypal.enabled,
          mode: s.payments.paypal.mode || "live",
          clientId: s.payments.paypal.clientId || "",
          hasClientSecret: Boolean((s.payments.paypal.clientSecret || "").trim()),
          clientSecretPreview: maskSecret(s.payments.paypal.clientSecret),
          paypalMeUrl: s.payments.paypal.paypalMeUrl || "",
          businessEmail: s.payments.paypal.businessEmail || ""
        },
        sepa: { ...s.payments.sepa }
      },
      notifications: {
        ntfyEnabled: s.notifications.ntfyEnabled,
        ntfyServer: s.notifications.ntfyServer,
        ntfyTopic: s.notifications.ntfyTopic,
        webhookUrl: s.notifications.webhookUrl,
        smtp: {
          enabled: s.notifications.smtp.enabled,
          host: s.notifications.smtp.host,
          port: s.notifications.smtp.port,
          secure: s.notifications.smtp.secure,
          user: s.notifications.smtp.user,
          hasPass: Boolean((s.notifications.smtp.pass || "").trim()),
          fromName: s.notifications.smtp.fromName
        }
      }
    }
  });
});

// Actions Admin sur les Discussions (Marquer lu, Résolu, Suspect Fraude, Aide rapide, Agacé, Bloquer client)
app.post("/api/admin/discussions/:threadId/read", requireAdmin, (req, res) => {
  const thread = db.data.discussions.find((t) => t.threadId === req.params.threadId);
  if (!thread) return res.status(404).json({ error: "Discussion introuvable." });
  thread.unreadByAdmin = 0;
  db.save();
  res.json({ thread: enrichThreadForAdmin(thread) });
});

app.patch("/api/admin/discussions/:threadId/flags", requireAdmin, (req, res) => {
  const thread = db.data.discussions.find((t) => t.threadId === req.params.threadId);
  if (!thread) return res.status(404).json({ error: "Discussion introuvable." });

  const { status, fraud, annoyed, fastHelp, blockClient } = req.body || {};
  thread.manualFlags = thread.manualFlags || {};

  if (status === "open" || status === "resolved") {
    thread.status = status;
    if (status === "resolved") thread.unreadByAdmin = 0;
  }
  if (fraud !== undefined) thread.manualFlags.fraud = fraud;
  if (annoyed !== undefined) thread.manualFlags.annoyed = annoyed;
  if (fastHelp !== undefined) thread.manualFlags.fastHelp = fastHelp;

  if (blockClient === true) {
    db.data.security = db.data.security || { blockedEmails: [], blockedHashes: [] };
    if (thread.customerEmail && !db.data.security.blockedEmails.includes(thread.customerEmail)) {
      db.data.security.blockedEmails.push(thread.customerEmail);
    }
    if (thread.clientHash && !db.data.security.blockedHashes.includes(thread.clientHash)) {
      db.data.security.blockedHashes.push(thread.clientHash);
    }
    thread.manualFlags.fraud = true;
    thread.status = "resolved";
  } else if (blockClient === false) {
    if (db.data.security) {
      db.data.security.blockedEmails = (db.data.security.blockedEmails || []).filter((e) => e !== thread.customerEmail);
      db.data.security.blockedHashes = (db.data.security.blockedHashes || []).filter((h) => h !== thread.clientHash);
    }
  }

  db.save();
  res.json({ thread: enrichThreadForAdmin(thread) });
});

app.delete("/api/admin/discussions/:threadId", requireAdmin, (req, res) => {
  db.data.discussions = db.data.discussions.filter((t) => t.threadId !== req.params.threadId);
  db.save();
  res.json({ ok: true });
});

// Catalogue Admin
app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const prod = db.data.products.find((p) => p.id === req.params.id);
  if (!prod) return res.status(404).json({ error: "Produit introuvable." });

  const b = req.body || {};
  if (b.title !== undefined) prod.title = String(b.title).trim();
  if (b.tagline !== undefined) prod.tagline = String(b.tagline).trim();
  if (b.price !== undefined) prod.price = Math.max(0.5, Number(b.price) || prod.price);
  if (b.compareAtPrice !== undefined) {
    prod.compareAtPrice = b.compareAtPrice === "" || b.compareAtPrice === null ? null : Math.max(0, Number(b.compareAtPrice));
  }
  if (b.duration !== undefined) prod.duration = String(b.duration).trim();
  if (b.badge !== undefined) prod.badge = String(b.badge).trim();
  if (b.categoryLabel !== undefined) prod.categoryLabel = String(b.categoryLabel).trim();
  if (b.accentColor !== undefined) prod.accentColor = String(b.accentColor).trim();
  if (b.availability !== undefined && ["in_stock", "low_stock", "out_of_stock"].includes(b.availability)) {
    prod.availability = b.availability;
  }
  if (b.stockCount !== undefined) {
    prod.stockCount =
      b.stockCount === "" || b.stockCount === null || Number.isNaN(Number(b.stockCount))
        ? null
        : Math.max(0, parseInt(b.stockCount, 10));
    if (prod.stockCount === 0) prod.availability = "out_of_stock";
  }
  if (b.active !== undefined) prod.active = Boolean(b.active);
  if (b.popular !== undefined) prod.popular = Boolean(b.popular);
  if (Array.isArray(b.shortFeatures)) {
    prod.shortFeatures = b.shortFeatures.map((s) => String(s).trim()).filter(Boolean);
  }
  if (b.fullDescription !== undefined) prod.fullDescription = String(b.fullDescription).trim();

  db.save();
  broadcastCatalog();
  res.json({ product: prod });
});

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  const price = Number(b.price);
  if (!title || !price || price <= 0) {
    return res.status(400).json({ error: "Titre et prix valide obligatoires." });
  }
  const slugBase = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const id = `${slugBase || "offre"}-${crypto.randomBytes(2).toString("hex")}`;

  const newProd = {
    id,
    slug: id,
    title,
    tagline: String(b.tagline || "Abonnement numérique premium garanti").trim(),
    price,
    compareAtPrice: b.compareAtPrice ? Number(b.compareAtPrice) : Math.round(price * 1.3),
    currency: "€",
    billingPeriod: "an",
    duration: String(b.duration || "12 mois (365 jours)").trim(),
    badge: String(b.badge || "Nouvelle Offre").trim(),
    badgeColor: "custom",
    category: "digital",
    categoryLabel: String(b.categoryLabel || "Abonnement Premium").trim(),
    accentColor: b.accentColor || "#8b5cf6",
    accentGlow: "rgba(139, 92, 246, 0.24)",
    availability: b.availability || "in_stock",
    stockCount:
      b.stockCount === "" || b.stockCount === undefined || b.stockCount === null
        ? null
        : Math.max(0, parseInt(b.stockCount, 10)),
    active: true,
    popular: Boolean(b.popular),
    sortOrder: db.data.products.length + 1,
    deliveryMode: b.deliveryMode || "generic",
    shortFeatures: [
      "Accès officiel garanti pendant toute la durée",
      "Livraison directe sur le site et par e-mail",
      "Assistance dédiée 7j/7 incluse",
      "Garantie Zéro Perte & remplacement technique"
    ],
    fullDescription: String(
      b.fullDescription || `Profitez de ${title} au meilleur tarif avec activation rapide et garantie NEXUS.`
    ).trim(),
    detailedBenefits: [
      { title: "Accès 100% Officiel", desc: "Activation propre, sécurisée et garantie." },
      { title: "Livraison Rapide", desc: "Réception directe dans votre espace commande et par e-mail." }
    ],
    activationFormat: "Identifiants ou lien d'invitation officiel livrés après commande",
    activationSteps: [
      "Validez votre commande par Carte/Stripe, PayPal ou Virement SEPA Instantané.",
      "Recevez vos accès dans la boîte de dialogue de suivi et par e-mail.",
      "Suivez les instructions fournies pour profiter immédiatement de votre service."
    ],
    specs: [
      { label: "Durée", value: String(b.duration || "12 mois (365 jours)") },
      { label: "Support", value: "Assistance 7j/7 incluse" }
    ]
  };

  db.data.products.push(newProd);
  db.save();
  broadcastCatalog();
  res.status(201).json({ product: newProd });
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const idx = db.data.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Produit introuvable." });
  db.data.products.splice(idx, 1);
  db.save();
  broadcastCatalog();
  res.json({ ok: true });
});

app.post("/api/admin/orders/:orderId/confirm-payment", requireAdmin, async (req, res) => {
  const order = db.data.orders.find((o) => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });

  await markOrderPaid(order, {
    transactionId: order.sepaRef || `manual_${Date.now()}`,
    sourceLabel: "Validation Administrateur",
    originUrl: getOrigin(req)
  });

  res.json({ order });
});

app.post("/api/admin/orders/:orderId/deliver", requireAdmin, async (req, res) => {
  const order = db.data.orders.find((o) => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });

  const {
    credentials = [],
    customMessage = "",
    sendViaDialog = true,
    sendViaEmail = true,
    markPaid = true
  } = req.body || {};

  if (markPaid && order.paymentStatus !== "paid") {
    order.paymentStatus = "paid";
    order.paidAt = new Date().toISOString();
    if (!order.stockDecremented) {
      order.stockDecremented = true;
      for (const item of order.items) {
        const prod = db.data.products.find((p) => p.id === item.id);
        if (prod && typeof prod.stockCount === "number") {
          prod.stockCount = Math.max(0, prod.stockCount - item.quantity);
          if (prod.stockCount === 0) prod.availability = "out_of_stock";
          else if (prod.stockCount <= 3) prod.availability = "low_stock";
        }
      }
      broadcastCatalog();
    }
  }

  const channels = [];
  if (sendViaDialog) channels.push("dialog");
  if (sendViaEmail) channels.push("email");

  const accessPayload = {
    deliveredAt: new Date().toISOString(),
    channels,
    credentials,
    customMessage: String(customMessage || "").trim()
  };

  order.deliveryStatus = "delivered";
  order.deliveredAccess = accessPayload;
  order.updatedAt = new Date().toISOString();

  appendRescueLedger("access_delivered", {
    orderId: order.orderId,
    email: order.email,
    deliveredAt: accessPayload.deliveredAt
  });

  if (sendViaDialog) {
    order.messages.push({
      id: `msg_deliv_${Date.now()}`,
      sender: "admin",
      isDeliveryNotice: true,
      text:
        customMessage && customMessage.trim()
          ? `🎉 Vos accès viennent d'être livrés ! ${customMessage.trim()}`
          : "🎉 Vos accès et identifiants viennent d'être livrés dans votre coffre sécurisé ci-dessus !",
      createdAt: new Date().toISOString()
    });
  }

  db.save();

  const emailContent = buildAccessEmailContent(order, accessPayload);
  let emailResult = { sent: false, reason: null };

  if (sendViaEmail) {
    emailResult = await sendEmailIfConfigured({
      to: order.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html
    });
  }

  broadcastOrder(order.orderId, "access_delivered", order);

  res.json({
    order,
    emailSent: emailResult.sent,
    emailReason: emailResult.reason || null,
    mailtoUrl: emailContent.mailtoUrl
  });
});

app.delete("/api/admin/orders/:orderId", requireAdmin, (req, res) => {
  db.data.orders = db.data.orders.filter((o) => o.orderId !== req.params.orderId);
  db.save();
  res.json({ ok: true });
});

app.post("/api/admin/coupons", requireAdmin, (req, res) => {
  const { code, type = "percent", value, minAmount = 0, maxUsage = 0, label = "" } = req.body || {};
  const cleanCode = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  const numVal = Number(value);

  if (cleanCode.length < 2 || !numVal || numVal <= 0 || (type === "percent" && numVal > 100)) {
    return res.status(400).json({ error: "Code ou valeur de remise invalide." });
  }
  if (db.data.coupons.some((c) => c.code.toUpperCase() === cleanCode)) {
    return res.status(400).json({ error: `Le code « ${cleanCode} » existe déjà.` });
  }

  const coupon = {
    id: `cpn_${Date.now()}`,
    code: cleanCode,
    type: type === "fixed" ? "fixed" : "percent",
    value: numVal,
    minAmount: Math.max(0, Number(minAmount) || 0),
    maxUsage: Math.max(0, parseInt(maxUsage, 10) || 0),
    usageCount: 0,
    active: true,
    label: String(label || "").trim() || (type === "fixed" ? `-${numVal} € de remise` : `-${numVal}% de réduction`),
    createdAt: new Date().toISOString()
  };

  db.data.coupons.unshift(coupon);
  db.save();
  res.status(201).json({ coupon });
});

app.patch("/api/admin/coupons/:code", requireAdmin, (req, res) => {
  const c = db.data.coupons.find((x) => x.code.toUpperCase() === req.params.code.toUpperCase());
  if (!c) return res.status(404).json({ error: "Code introuvable." });
  c.active = !c.active;
  db.save();
  res.json({ coupon: c });
});

app.delete("/api/admin/coupons/:code", requireAdmin, (req, res) => {
  db.data.coupons = db.data.coupons.filter((x) => x.code.toUpperCase() !== req.params.code.toUpperCase());
  db.save();
  res.json({ ok: true });
});

app.post("/api/admin/notifications/read-all", requireAdmin, (_req, res) => {
  db.data.notifications.forEach((n) => (n.read = true));
  db.save();
  res.json({ ok: true });
});

app.delete("/api/admin/notifications", requireAdmin, (_req, res) => {
  db.data.notifications = [];
  db.save();
  res.json({ ok: true });
});

app.delete("/api/admin/support/:id", requireAdmin, (req, res) => {
  db.data.supportMessages = db.data.supportMessages.filter((m) => m.id !== req.params.id);
  db.save();
  res.json({ ok: true });
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const b = req.body || {};
  const s = db.data.settings;

  if (b.supportEmail !== undefined) s.supportEmail = String(b.supportEmail).trim();
  if (b.publicUrl !== undefined) s.publicUrl = String(b.publicUrl).trim();

  if (b.payments) {
    if (b.payments.stripe) {
      const st = b.payments.stripe;
      if (st.enabled !== undefined) s.payments.stripe.enabled = Boolean(st.enabled);
      if (st.publishableKey !== undefined) s.payments.stripe.publishableKey = String(st.publishableKey).trim();
      if (st.secretKey && !st.secretKey.includes("••••")) s.payments.stripe.secretKey = String(st.secretKey).trim();
      if (st.clearSecretKey) s.payments.stripe.secretKey = "";
      if (st.webhookSecret && !st.webhookSecret.includes("••••")) s.payments.stripe.webhookSecret = String(st.webhookSecret).trim();
      if (st.paymentLinkFallback !== undefined) s.payments.stripe.paymentLinkFallback = String(st.paymentLinkFallback).trim();
    }
    if (b.payments.paypal) {
      const pp = b.payments.paypal;
      if (pp.enabled !== undefined) s.payments.paypal.enabled = Boolean(pp.enabled);
      if (pp.mode !== undefined) s.payments.paypal.mode = pp.mode === "sandbox" ? "sandbox" : "live";
      if (pp.clientId !== undefined) s.payments.paypal.clientId = String(pp.clientId).trim();
      if (pp.clientSecret && !pp.clientSecret.includes("••••")) s.payments.paypal.clientSecret = String(pp.clientSecret).trim();
      if (pp.clearClientSecret) s.payments.paypal.clientSecret = "";
      if (pp.paypalMeUrl !== undefined) s.payments.paypal.paypalMeUrl = String(pp.paypalMeUrl).trim();
      if (pp.businessEmail !== undefined) s.payments.paypal.businessEmail = String(pp.businessEmail).trim();
    }
    if (b.payments.sepa) {
      const sp = b.payments.sepa;
      if (sp.enabled !== undefined) s.payments.sepa.enabled = Boolean(sp.enabled);
      if (sp.beneficiary !== undefined) s.payments.sepa.beneficiary = String(sp.beneficiary).trim();
      if (sp.iban !== undefined) s.payments.sepa.iban = String(sp.iban).trim();
      if (sp.bic !== undefined) s.payments.sepa.bic = String(sp.bic).trim();
      if (sp.bank !== undefined) s.payments.sepa.bank = String(sp.bank).trim();
    }
  }

  if (b.notifications) {
    const nf = b.notifications;
    if (nf.ntfyEnabled !== undefined) s.notifications.ntfyEnabled = Boolean(nf.ntfyEnabled);
    if (nf.ntfyServer !== undefined) s.notifications.ntfyServer = String(nf.ntfyServer).trim() || "https://ntfy.sh";
    if (nf.ntfyTopic !== undefined && String(nf.ntfyTopic).trim()) s.notifications.ntfyTopic = String(nf.ntfyTopic).trim();
    if (nf.webhookUrl !== undefined) s.notifications.webhookUrl = String(nf.webhookUrl).trim();
    if (nf.smtp) {
      if (nf.smtp.enabled !== undefined) s.notifications.smtp.enabled = Boolean(nf.smtp.enabled);
      if (nf.smtp.host !== undefined) s.notifications.smtp.host = String(nf.smtp.host).trim();
      if (nf.smtp.port !== undefined) s.notifications.smtp.port = Number(nf.smtp.port) || 465;
      if (nf.smtp.secure !== undefined) s.notifications.smtp.secure = Boolean(nf.smtp.secure);
      if (nf.smtp.user !== undefined) s.notifications.smtp.user = String(nf.smtp.user).trim();
      if (nf.smtp.pass && !nf.smtp.pass.includes("••••")) s.notifications.smtp.pass = String(nf.smtp.pass).trim();
      if (nf.smtp.fromName !== undefined) s.notifications.smtp.fromName = String(nf.smtp.fromName).trim();
    }
  }

  if (b.adminAccount) {
    if (b.adminAccount.name) db.data.admin.name = String(b.adminAccount.name).trim();
    if (b.adminAccount.email) db.data.admin.email = String(b.adminAccount.email).trim();
    if (b.adminAccount.newPassword && String(b.adminAccount.newPassword).length >= 4) {
      const { salt, hash } = hashPassword(b.adminAccount.newPassword);
      db.data.admin.passwordSalt = salt;
      db.data.admin.passwordHash = hash;
    }
  }

  db.save();
  broadcastCatalog();
  const ntfyInfo = await generateNtfyQrDataUrl();
  res.json({ ok: true, ntfyInfo });
});

app.post("/api/admin/test-notification", requireAdmin, async (req, res) => {
  const originUrl = getOrigin(req);
  const pushRes = await sendMobilePushNotification({
    title: "🔔 Test réussi — NEXUS SUBS",
    message:
      "Votre téléphone est bien relié ! Vous recevrez ici chaque commande, urgence paiement et discussion client en direct.",
    priority: "high",
    tags: "iphone,tada",
    clickUrl: `${originUrl}/#admin`
  });
  res.json({ ok: true, pushRes });
});

// ============================================================================
// Serve Production Static Frontend if built (`dist/`)
// ============================================================================
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

function maskSecret(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 7)}••••••••${s.slice(-4)}`;
}

app.listen(PORT, () => {
  console.log(`[NEXUS API] Serveur démarré sur http://localhost:${PORT}`);
});

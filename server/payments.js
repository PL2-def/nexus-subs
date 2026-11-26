import Stripe from "stripe";
import QRCode from "qrcode";
import { db } from "./db.js";

/**
 * Génère un QR Code bancaire européen officiel EPC069-12 (SEPA Credit Transfer / Instant)
 * reconnu par Revolut, BoursoBank, BNP, Caisse d'Épargne, Crédit Agricole, N26, Lydia/Sumeria, etc.
 */
export async function generateSepaEpcQr(amountEur, sepaRef) {
  const sepa = db.data.settings.payments.sepa;
  const cleanIban = (sepa.iban || "").replace(/\s+/g, "").toUpperCase();
  const cleanBic = (sepa.bic || "").replace(/\s+/g, "").toUpperCase();
  const beneficiary = (sepa.beneficiary || "Gasc Enzo").trim().slice(0, 70);
  const formattedAmount = `EUR${Number(amountEur).toFixed(2)}`;
  const remittance = `Commande ${sepaRef}`.slice(0, 140);

  const epcPayload = [
    "BCD",
    "002",
    "1",
    "SCT",
    cleanBic,
    beneficiary,
    cleanIban,
    formattedAmount,
    "",
    "",
    remittance
  ].join("\n");

  const qrDataUrl = await QRCode.toDataURL(epcPayload, {
    errorCorrectionLevel: "M",
    width: 240,
    margin: 1,
    color: {
      dark: "#07080e",
      light: "#ffffff"
    }
  });

  return {
    qrDataUrl,
    epcPayload,
    beneficiary: sepa.beneficiary,
    iban: sepa.iban,
    cleanIban,
    bic: sepa.bic,
    bank: sepa.bank,
    reference: sepaRef
  };
}

/**
 * Crée une session Stripe Checkout officielle (Carte Bancaire, Apple Pay, Google Pay, Link)
 * ou bascule proprement en mode Sandbox interactif si aucune clé secrète n'est encore configurée.
 */
export async function createStripeCheckoutForOrder(order, originUrl) {
  const stripeCfg = db.data.settings.payments.stripe;
  const secretKey = (stripeCfg.secretKey || "").trim();

  if (!secretKey) {
    if (stripeCfg.paymentLinkFallback && stripeCfg.paymentLinkFallback.startsWith("http")) {
      const sep = stripeCfg.paymentLinkFallback.includes("?") ? "&" : "?";
      return {
        mode: "payment_link",
        checkoutUrl: `${stripeCfg.paymentLinkFallback}${sep}client_reference_id=${encodeURIComponent(order.orderId)}&prefilled_email=${encodeURIComponent(order.email)}`
      };
    }
    return {
      mode: "sandbox_demo",
      checkoutUrl: null,
      message: "Mode démonstration Stripe actif (ajoutez votre clé secrète sk_live_... ou sk_test_... dans Admin > Paiements pour activer l'encaissement bancaire réel)."
    };
  }

  const stripe = new Stripe(secretKey);

  // Construire les lignes en tenant compte d'une éventuelle remise code promo
  const discountRatio = order.subtotal > 0 ? order.total / order.subtotal : 1;
  const lineItems = order.items.map((item) => {
    const unitCents = Math.max(50, Math.round(item.unitPrice * discountRatio * 100));
    return {
      quantity: item.quantity,
      price_data: {
        currency: "eur",
        unit_amount: unitCents,
        product_data: {
          name: `${item.title} (${item.duration})`,
          description: `Commande #${order.orderId} — Livraison numérique NEXUS SUBS`
        }
      }
    };
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email,
    client_reference_id: order.orderId,
    metadata: {
      orderId: order.orderId,
      accessToken: order.accessToken
    },
    line_items: lineItems,
    success_url: `${originUrl}/?payment=stripe_success&order=${encodeURIComponent(order.orderId)}&token=${encodeURIComponent(order.accessToken)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${originUrl}/?payment=stripe_cancel&order=${encodeURIComponent(order.orderId)}&token=${encodeURIComponent(order.accessToken)}`
  });

  return {
    mode: secretKey.startsWith("sk_live_") ? "live" : "test",
    sessionId: session.id,
    checkoutUrl: session.url
  };
}

export async function verifyStripeSession(sessionId) {
  const secretKey = (db.data.settings.payments.stripe.secretKey || "").trim();
  if (!secretKey) {
    return { verified: false, reason: "Clé Stripe non configurée" };
  }
  const stripe = new Stripe(secretKey);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return {
    verified: session.payment_status === "paid",
    session
  };
}

export function constructStripeWebhookEvent(rawBody, signature) {
  const stripeCfg = db.data.settings.payments.stripe;
  const secretKey = (stripeCfg.secretKey || "").trim();
  const webhookSecret = (stripeCfg.webhookSecret || "").trim();
  if (!secretKey || !webhookSecret) return null;
  const stripe = new Stripe(secretKey);
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * PayPal Orders v2 REST API (Live ou Sandbox) + Fallback PayPal.Me
 */
function getPayPalBaseUrl() {
  const mode = db.data.settings.payments.paypal.mode;
  return mode === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function getPayPalAccessToken() {
  const { clientId, clientSecret } = db.data.settings.payments.paypal;
  if (!clientId || !clientSecret) return null;

  const auth = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString("base64");
  const resp = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`PayPal OAuth error (${resp.status}): ${txt}`);
  }
  const data = await resp.json();
  return data.access_token;
}

export async function createPayPalOrderForOrder(order, originUrl) {
  const paypalCfg = db.data.settings.payments.paypal;
  const hasApiKeys = Boolean((paypalCfg.clientId || "").trim() && (paypalCfg.clientSecret || "").trim());

  if (!hasApiKeys) {
    if (paypalCfg.paypalMeUrl && paypalCfg.paypalMeUrl.trim()) {
      let base = paypalCfg.paypalMeUrl.trim().replace(/\/+$/, "");
      if (!base.startsWith("http")) {
        base = `https://www.paypal.com/paypalme/${base.replace(/^@/, "")}`;
      }
      return {
        mode: "paypal_me",
        approveUrl: `${base}/${Number(order.total).toFixed(2)}EUR`
      };
    }
    return {
      mode: "sandbox_demo",
      approveUrl: null
    };
  }

  const accessToken = await getPayPalAccessToken();
  const resp = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: order.orderId,
          custom_id: order.orderId,
          description: `Abonnements NEXUS #${order.orderId}`,
          amount: {
            currency_code: "EUR",
            value: Number(order.total).toFixed(2)
          }
        }
      ],
      application_context: {
        brand_name: "NEXUS SUBS",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: `${originUrl}/?payment=paypal_return&order=${encodeURIComponent(order.orderId)}&token=${encodeURIComponent(order.accessToken)}`,
        cancel_url: `${originUrl}/?payment=paypal_cancel&order=${encodeURIComponent(order.orderId)}&token=${encodeURIComponent(order.accessToken)}`
      }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erreur création commande PayPal: ${errText}`);
  }

  const data = await resp.json();
  const approveLink = (data.links || []).find((l) => l.rel === "approve" || l.rel === "payer-action");

  return {
    mode: paypalCfg.mode === "sandbox" ? "sandbox" : "live",
    paypalOrderId: data.id,
    approveUrl: approveLink ? approveLink.href : null
  };
}

export async function capturePayPalOrder(paypalOrderId) {
  const accessToken = await getPayPalAccessToken();
  if (!accessToken) {
    throw new Error("Clés API PayPal non configurées.");
  }

  const resp = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  const data = await resp.json();
  const completed = resp.ok && data.status === "COMPLETED";
  return { completed, data };
}

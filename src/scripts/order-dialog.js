/**
 * Boîte de Dialogue Client en Direct (#order-live-dialog) :
 * - Coffre-fort de confidentialité : masquage par défaut des mots de passe & PIN (révélation auto-masquée 15s)
 * - Suivi Sécurisé : Téléchargement du Certificat de Preuve d'Achat signé + File de secours hors-ligne
 * - Réception instantanée SSE + Messagerie directe avec le vendeur
 */

import { store } from "./store.js";
import { closeDialogSmoothly, showToast, playChime, escapeHtml } from "./mwg-helpers.js";
import { downloadOrderRescueProof, enqueueOfflineDeclaration } from "./guide-and-rescue.js";
import { siteTracker } from "./site-tracker.js";
import { account } from "./account.js";

let activeEventSource = null;
let currentOrderState = null;
let currentAccessToken = "";
let currentPaymentAction = null;
let secretsRevealed = false;
let revealTimer = null;

function cleanupOrderStream() {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  clearTimeout(revealTimer);
  secretsRevealed = false;
}

function getMergedCustomerOrders() {
  const savedLocal = store.getSavedCustomerOrders();
  const acctOrders = account.authenticated && Array.isArray(account.orders) ? account.orders : [];
  const mergedMap = new Map();
  for (const o of acctOrders) {
    mergedMap.set(o.orderId, {
      orderId: o.orderId,
      accessToken: o.accessToken,
      email: o.email,
      total: o.total,
      fromAccount: true
    });
  }
  for (const s of savedLocal) {
    if (!mergedMap.has(s.orderId)) mergedMap.set(s.orderId, s);
  }
  return Array.from(mergedMap.values());
}

export function initOrderTrackerModal() {
  const dialog = document.getElementById("order-live-dialog");
  if (!dialog) return;

  dialog.addEventListener("close", () => cleanupOrderStream());

  window.openOrderTracker = () => {
    const saved = getMergedCustomerOrders();
    if (saved.length > 0) {
      openLiveOrderDialog({ orderId: saved[0].orderId, accessToken: saved[0].accessToken });
    } else {
      renderOrderLookupView();
      if (!dialog.open) dialog.showModal();
    }
  };
}

export function renderOrderLookupView() {
  cleanupOrderStream();
  const dialog = document.getElementById("order-live-dialog");
  const container = document.getElementById("order-live-dialog-content");
  if (!dialog || !container) return;

  const saved = getMergedCustomerOrders();

  container.innerHTML = `
    <div class="checkout-header">
      <div class="checkout-header-title">
        <div class="checkout-lock-badge" aria-hidden="true">📦</div>
        <div>
          <h1 id="order-live-dialog-title" class="checkout-title">Mes Accès &amp; Suivi de Commande</h1>
          <p class="checkout-subtitle">Retrouvez vos identifiants chiffrés ou contactez l'Assistance Commande</p>
        </div>
      </div>
      <button type="button" class="btn-close-dialog" data-close-live-dialog aria-label="Fermer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="order-lookup-body">
      ${
        saved.length > 0
          ? `
          <div class="saved-orders-box">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;flex-wrap:wrap;gap:0.5rem;">
              <h2 class="saved-orders-heading" style="margin:0;">Commandes enregistrées sur cet appareil</h2>
              <button type="button" class="btn btn-outline btn-xs" id="btn-clear-device-orders" title="Protection sur ordinateur partagé">
                🔒 Effacer de cet appareil
              </button>
            </div>
            <div class="saved-orders-list">
              ${saved
                .map(
                  (s) => `
                  <button type="button" class="saved-order-pill" data-open-saved="${escapeHtml(s.orderId)}" data-token="${escapeHtml(s.accessToken)}">
                    <span><strong>#${escapeHtml(s.orderId)}</strong> ${s.email ? `• ${escapeHtml(s.email)}` : ""}</span>
                    <span class="saved-order-arrow">${s.total ? `${escapeHtml(s.total)} € →` : "Ouvrir →"}</span>
                  </button>
                `
                )
                .join("")}
            </div>
          </div>
        `
          : ""
      }

      <form id="order-lookup-form" class="order-lookup-form">
        <h2 class="saved-orders-heading">Rechercher avec votre numéro de commande</h2>
        <div class="form-row">
          <div class="form-group">
            <label for="lookup-order-id" class="form-label">Numéro de commande *</label>
            <input type="text" id="lookup-order-id" class="form-control" placeholder="Ex : NX-849201" required />
          </div>
          <div class="form-group">
            <label for="lookup-order-email" class="form-label">E-mail utilisé lors de l'achat *</label>
            <input type="email" id="lookup-order-email" class="form-control" placeholder="vous@exemple.fr" required />
          </div>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:0.85rem;">
          <button type="submit" class="btn btn-primary">Ouvrir mon coffre d'accès</button>
          <button type="button" class="btn btn-outline" id="btn-lookup-rescue">
            🛡️ J'ai payé mais j'ai un bug / oublié mon numéro
          </button>
        </div>
      </form>
    </div>
  `;

  container.querySelectorAll("[data-close-live-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => closeDialogSmoothly(dialog));
  });

  container.querySelector("#btn-clear-device-orders")?.addEventListener("click", () => {
    localStorage.removeItem("nexus_my_orders_v2");
    store.updateHeaderOrderDot();
    showToast("Historique local effacé par mesure de confidentialité (vos accès restent récupérables par N° + E-mail).", "info", 4500);
    renderOrderLookupView();
  });

  container.querySelector("#btn-lookup-rescue")?.addEventListener("click", async () => {
    await closeDialogSmoothly(dialog);
    window.openRescueModal?.();
  });

  container.querySelectorAll("[data-open-saved]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openLiveOrderDialog({
        orderId: btn.getAttribute("data-open-saved"),
        accessToken: btn.getAttribute("data-token")
      });
    });
  });

  container.querySelector("#order-lookup-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const orderId = container.querySelector("#lookup-order-id").value.trim();
    const email = container.querySelector("#lookup-order-email").value.trim();
    const meta = siteTracker.getPayloadMeta();
    try {
      const resp = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderId, email, visitorId: meta.visitorId, deviceFingerprint: meta.deviceFingerprint })
      });
      const data = await resp.json();
      siteTracker.track("order_lookup_attempt", orderId, { ok: resp.ok });
      if (!resp.ok) throw new Error(data.error || "Commande introuvable.");

      store.saveCustomerOrderRef({
        orderId: data.order.orderId,
        accessToken: data.accessToken,
        email: data.order.email,
        total: data.order.total,
        createdAt: data.order.createdAt
      });

      openLiveOrderDialog({
        orderId: data.order.orderId,
        accessToken: data.accessToken,
        initialOrder: data.order
      });
    } catch (err) {
      showToast(err.message, "error", 5000);
    }
  });
}

export async function openLiveOrderDialog({ orderId, accessToken, initialOrder = null, paymentAction = null }) {
  const dialog = document.getElementById("order-live-dialog");
  if (!dialog) return;

  cleanupOrderStream();
  currentAccessToken = accessToken;
  currentPaymentAction = paymentAction;

  if (initialOrder) {
    currentOrderState = initialOrder;
    renderLiveOrderContent();
    if (!dialog.open) dialog.showModal();
  } else {
    try {
      const resp = await fetch(`/api/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(accessToken)}`);
      if (!resp.ok) {
        renderOrderLookupView();
        if (!dialog.open) dialog.showModal();
        return;
      }
      const data = await resp.json();
      currentOrderState = data.order;
      renderLiveOrderContent();
      if (!dialog.open) dialog.showModal();
    } catch {
      renderOrderLookupView();
      if (!dialog.open) dialog.showModal();
      return;
    }
  }

  try {
    const es = new EventSource(
      `/api/events/order/${encodeURIComponent(orderId)}?token=${encodeURIComponent(accessToken)}`
    );
    es.addEventListener("order_updated", (e) => {
      currentOrderState = JSON.parse(e.data).order;
      renderLiveOrderContent({ preserveChatInput: true });
    });
    es.addEventListener("access_delivered", (e) => {
      currentOrderState = JSON.parse(e.data).order;
      playChime("delivery");
      showToast("🎉 Vos accès viennent d'arriver dans votre coffre sécurisé !", "success", 6000);
      renderLiveOrderContent({ preserveChatInput: true });
    });
    es.addEventListener("new_message", (e) => {
      const prevLen = currentOrderState?.messages?.length || 0;
      currentOrderState = JSON.parse(e.data).order;
      const lastMsg = currentOrderState.messages?.[currentOrderState.messages.length - 1];
      if (currentOrderState.messages.length > prevLen && lastMsg?.sender === "admin") {
        playChime("success");
        showToast("Nouveau message du vendeur reçu !", "info");
      }
      renderLiveOrderContent({ preserveChatInput: true });
    });
    activeEventSource = es;
  } catch {
    // ignore SSE fallback
  }
}

function renderLiveOrderContent({ preserveChatInput = false } = {}) {
  const dialog = document.getElementById("order-live-dialog");
  const container = document.getElementById("order-live-dialog-content");
  if (!container || !currentOrderState) return;

  const prevChatDraft = preserveChatInput ? container.querySelector("#live-chat-input")?.value || "" : "";
  const ord = currentOrderState;

  const isPaid = ord.paymentStatus === "paid";
  const isDeclared = ord.paymentStatus === "declaration_sent";
  const isDelivered = ord.deliveryStatus === "delivered" && ord.deliveredAccess;

  const step2State = isPaid ? "done" : isDeclared ? "active" : "pending";
  const step3State = isDelivered ? "done" : isPaid || isDeclared ? "active" : "pending";

  container.innerHTML = `
    <div class="checkout-header">
      <div class="checkout-header-title">
        <div class="live-pulse-badge ${isDelivered ? "delivered" : ""}" aria-hidden="true">
          ${isDelivered ? "✓" : "⚡"}
        </div>
        <div>
          <div class="live-order-title-row">
            <h1 id="order-live-dialog-title" class="checkout-title">Commande #${escapeHtml(ord.orderId)}</h1>
            <span class="live-sync-pill"><span class="sync-dot"></span>Suivi &amp; Garantie actifs</span>
          </div>
          <p class="checkout-subtitle">${escapeHtml(ord.customerName)} • ${escapeHtml(ord.email)} • Total : <strong>${ord.total} €</strong></p>
        </div>
      </div>
      <div class="header-dialog-btns">
        <button type="button" class="btn btn-outline btn-xs" id="btn-download-proof" title="Télécharger votre certificat de commande signé">
          💾 Preuve d'achat (.txt)
        </button>
        <button type="button" class="btn btn-outline btn-xs" id="btn-switch-order-lookup">Mes commandes</button>
        <button type="button" class="btn-close-dialog" data-close-live aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="order-live-stepper">
      <div class="stepper-node done">
        <span class="node-circle">✓</span>
        <span class="node-label">1. Certificat créé</span>
      </div>
      <div class="stepper-line ${isPaid || isDeclared ? "filled" : ""}"></div>
      <div class="stepper-node ${step2State}">
        <span class="node-circle">${isPaid ? "✓" : "2"}</span>
        <span class="node-label">${isPaid ? "2. Paiement validé" : isDeclared ? "2. Vérification en cours" : "2. Règlement"}</span>
      </div>
      <div class="stepper-line ${isDelivered ? "filled" : ""}"></div>
      <div class="stepper-node ${step3State}">
        <span class="node-circle">${isDelivered ? "✓" : "3"}</span>
        <span class="node-label">${isDelivered ? "3. Accès livrés !" : "3. Livraison des accès"}</span>
      </div>
    </div>

    <div class="order-live-body">
      <div class="order-live-main-col">
        ${isDelivered ? renderDeliveredCredentialsVault(ord) : ""}
        ${!isPaid ? renderPaymentActionPanel(ord) : ""}
        ${
          isPaid && !isDelivered
            ? `
            <div class="waiting-delivery-card">
              <div class="waiting-spinner-ring" aria-hidden="true"></div>
              <div>
                <h2>Paiement sécurisé confirmé ! Vos accès arrivent…</h2>
                <p>
                  Notre équipe vient de recevoir une alerte sur son téléphone. Vos identifiants s'afficheront <strong>automatiquement ici-même</strong> et à <strong>${escapeHtml(ord.email)}</strong>. Pensez à télécharger votre <em>Preuve d'achat (.txt)</em> en haut à droite par précaution !
                </p>
              </div>
            </div>
          `
            : ""
        }

        <div class="order-summary-mini-card">
          <div class="mini-card-head">
            <h3>Récapitulatif &amp; Solutions de Secours</h3>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-xs" id="btn-order-rescue-help">🛡️ Signaler un bug</button>
              <button type="button" class="btn btn-outline btn-xs" id="btn-print-order">Imprimer</button>
            </div>
          </div>
          <ul class="mini-order-items">
            ${ord.items
              .map(
                (i) => `
                <li>
                  <span><strong>${escapeHtml(i.title)}</strong> (${escapeHtml(i.duration)}) × ${i.quantity}</span>
                  <strong>${i.lineTotal} €</strong>
                </li>
              `
              )
              .join("")}
          </ul>
          ${
            ord.proofSignature
              ? `<p style="font-size:0.72rem;color:var(--text-subtle);margin-top:0.65rem;">Empreinte de vérification de commande : <code>${escapeHtml(ord.proofSignature)}</code></p>`
              : ""
          }
        </div>
      </div>

      <div class="order-live-chat-col">
        <div class="live-chat-header">
          <div>
            <h2>Dialogue direct avec le vendeur</h2>
            <p>Votre message déclenche une alerte immédiate sur notre téléphone.</p>
          </div>
        </div>

        <div class="live-chat-messages" id="live-chat-scroll">
          ${(ord.messages || [])
            .map((m) => {
              const roleClass =
                m.sender === "admin" ? "msg-admin" : m.sender === "customer" ? "msg-customer" : "msg-system";
              const author =
                m.sender === "admin" ? "Conseiller NEXUS" : m.sender === "customer" ? "Vous" : "Garantie Système";
              const time = new Date(m.createdAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit"
              });
              return `
                <div class="chat-bubble ${roleClass}">
                  <div class="chat-bubble-meta">
                    <strong>${escapeHtml(author)}</strong>
                    <span>${time}</span>
                  </div>
                  <div class="chat-bubble-text">${escapeHtml(m.text)}</div>
                </div>
              `;
            })
            .join("")}
        </div>

        <form id="live-chat-form" class="live-chat-input-row">
          <label for="live-chat-input" class="visually-hidden">Écrire un message au vendeur</label>
          <input
            type="text"
            id="live-chat-input"
            class="form-control"
            placeholder="Écrire un message en direct..."
            value="${escapeHtml(prevChatDraft)}"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-primary btn-send-chat">Envoyer</button>
        </form>
      </div>
    </div>
  `;

  const chatScroll = container.querySelector("#live-chat-scroll");
  if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;

  container.querySelectorAll("[data-close-live]").forEach((btn) => {
    btn.addEventListener("click", () => closeDialogSmoothly(dialog));
  });

  container.querySelector("#btn-download-proof")?.addEventListener("click", () => {
    downloadOrderRescueProof(ord);
  });

  container.querySelector("#btn-order-rescue-help")?.addEventListener("click", async () => {
    await closeDialogSmoothly(dialog);
    window.openRescueModal?.(ord.orderId);
  });

  container.querySelector("#btn-switch-order-lookup")?.addEventListener("click", () => {
    renderOrderLookupView();
  });

  container.querySelector("#btn-print-order")?.addEventListener("click", () => window.print());

  // Révélation temporisée des mots de passe / PIN (Confidentialité anti-regards indiscrets)
  container.querySelector("#btn-toggle-vault-secrets")?.addEventListener("click", () => {
    secretsRevealed = !secretsRevealed;
    clearTimeout(revealTimer);
    if (secretsRevealed) {
      revealTimer = setTimeout(() => {
        secretsRevealed = false;
        renderLiveOrderContent({ preserveChatInput: true });
      }, 15000);
    }
    renderLiveOrderContent({ preserveChatInput: true });
  });

  container.querySelectorAll("[data-copy-val]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const val = btn.getAttribute("data-copy-val") || "";
      try {
        await navigator.clipboard.writeText(val);
        showToast("Copié dans le presse-papiers !", "success", 2200);
      } catch {
        showToast(val, "info");
      }
    });
  });

  // Déclaration de paiement avec sauvegarde hors-ligne automatique si Internet coupe !
  container.querySelector("#btn-declare-payment")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const senderHint = container.querySelector("#sepa-sender-hint")?.value.trim() || "";
    try {
      const resp = await fetch(`/api/orders/${encodeURIComponent(ord.orderId)}/declare-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: currentAccessToken, senderHint })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      currentOrderState = data.order;
      showToast("Confirmation enregistrée ! Le téléphone du vendeur vient de sonner.", "success", 5000);
      renderLiveOrderContent();
    } catch {
      // Sauvegarde de secours hors-ligne !
      enqueueOfflineDeclaration({
        orderId: ord.orderId,
        token: currentAccessToken,
        senderHint
      });
      btn.disabled = false;
      showToast(
        "Mode Secours Hors-Ligne : votre confirmation est sauvegardée sur votre appareil et sera envoyée automatiquement dès le retour de votre connexion Internet !",
        "info",
        6500
      );
    }
  });

  container.querySelector("[data-sandbox-pay]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const gateway = btn.getAttribute("data-sandbox-pay");
    btn.disabled = true;
    btn.textContent = "Validation sécurisée en cours...";
    try {
      const resp = await fetch(`/api/orders/${encodeURIComponent(ord.orderId)}/confirm-gateway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: currentAccessToken, gateway, sandboxConfirm: true })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      currentOrderState = data.order;
      playChime("success");
      showToast("Paiement validé ! Notification envoyée au téléphone Admin.", "success");
      renderLiveOrderContent();
    } catch (err) {
      btn.disabled = false;
      showToast(err.message, "error");
    }
  });

  container.querySelector("#live-chat-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = container.querySelector("#live-chat-input");
    const text = input?.value.trim() || "";
    if (!text) return;
    input.value = "";
    try {
      const resp = await fetch(`/api/orders/${encodeURIComponent(ord.orderId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: currentAccessToken, text })
      });
      const data = await resp.json();
      if (resp.ok) {
        currentOrderState = data.order;
        renderLiveOrderContent();
      }
    } catch {
      input.value = text;
      showToast("Connexion momentanément indisponible, réessayez dans un instant.", "error");
    }
  });
}

function renderDeliveredCredentialsVault(ord) {
  const access = ord.deliveredAccess || {};
  const creds = Array.isArray(access.credentials) ? access.credentials : [];
  const hasSensitive = creds.some((c) => c.password || c.pin);

  return `
    <div class="delivered-vault-card">
      <div class="vault-header">
        <span class="vault-badge">🎉 Coffre d'Accès Officiels (Chiffré AES-256)</span>
        ${
          hasSensitive
            ? `<button type="button" class="btn btn-secondary btn-xs" id="btn-toggle-vault-secrets">
                ${secretsRevealed ? "🙈 Masquer maintenant" : "👁️ Révéler mots de passe (15s)"}
              </button>`
            : ""
        }
      </div>

      <div class="vault-credentials-list">
        ${creds
          .map(
            (c) => `
            <div class="vault-cred-item">
              <h3 class="vault-prod-title">${escapeHtml(c.productTitle || "Votre abonnement")}</h3>

              ${
                c.inviteLink
                  ? `
                  <div class="vault-field-row">
                    <span class="vault-field-label">Lien d'activation :</span>
                    <div class="vault-field-val-group">
                      <a href="${escapeHtml(c.inviteLink)}" target="_blank" rel="noopener noreferrer" class="vault-invite-link">${escapeHtml(c.inviteLink)}</a>
                      <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(c.inviteLink)}">Copier</button>
                    </div>
                  </div>
                `
                  : ""
              }

              ${
                c.login
                  ? `
                  <div class="vault-field-row">
                    <span class="vault-field-label">Identifiant / E-mail :</span>
                    <div class="vault-field-val-group">
                      <code>${escapeHtml(c.login)}</code>
                      <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(c.login)}">Copier</button>
                    </div>
                  </div>
                `
                  : ""
              }

              ${
                c.password
                  ? `
                  <div class="vault-field-row">
                    <span class="vault-field-label">Mot de passe confidentiel :</span>
                    <div class="vault-field-val-group">
                      <code>${secretsRevealed ? escapeHtml(c.password) : "••••••••••••"}</code>
                      <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(c.password)}">Copier</button>
                    </div>
                  </div>
                `
                  : ""
              }

              ${
                c.profile
                  ? `
                  <div class="vault-field-row">
                    <span class="vault-field-label">Profil dédié :</span>
                    <div class="vault-field-val-group">
                      <strong>${escapeHtml(c.profile)}</strong>
                    </div>
                  </div>
                `
                  : ""
              }

              ${
                c.pin
                  ? `
                  <div class="vault-field-row">
                    <span class="vault-field-label">Code PIN privé :</span>
                    <div class="vault-field-val-group">
                      <code>${secretsRevealed ? escapeHtml(c.pin) : "••••"}</code>
                      <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(c.pin)}">Copier</button>
                    </div>
                  </div>
                `
                  : ""
              }

              ${c.instructions ? `<p class="vault-instructions">${escapeHtml(c.instructions)}</p>` : ""}
            </div>
          `
          )
          .join("")}
      </div>

      ${
        access.customMessage
          ? `<div class="vault-seller-note"><strong>Message de votre conseiller :</strong><p>${escapeHtml(access.customMessage)}</p></div>`
          : ""
      }
    </div>
  `;
}

function renderPaymentActionPanel(ord) {
  if (ord.paymentMethod === "sepa_instant") {
    const sepa = ord.sepaDetails || store.payments.sepa;
    const isDeclared = ord.paymentStatus === "declaration_sent";

    return `
      <div class="payment-action-card sepa-live-card">
        <span class="pm-pill-badge">Virement SEPA Instantané (10s)</span>
        <h2>Réglez ${ord.total} € depuis votre application bancaire</h2>
        <p>Scannez ce QR Code bancaire officiel (pré-remplit tout automatiquement) ou copiez l'IBAN avec la référence obligatoire.</p>

        <div class="sepa-qr-and-fields">
          ${
            sepa?.qrDataUrl
              ? `
              <div class="sepa-qr-box">
                <img src="${sepa.qrDataUrl}" alt="QR Code Virement SEPA EPC" width="168" height="168" />
                <span>QR Code SEPA officiel (EPC)</span>
              </div>
            `
              : ""
          }

          <div class="sepa-copy-list">
            <div class="copy-row">
              <span class="copy-lbl">Bénéficiaire</span>
              <div class="copy-val-wrap">
                <strong>${escapeHtml(sepa?.beneficiary || "Gasc Enzo")}</strong>
                <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(sepa?.beneficiary || "Gasc Enzo")}">Copier</button>
              </div>
            </div>
            <div class="copy-row">
              <span class="copy-lbl">IBAN (${escapeHtml(sepa?.bank || "Caisse d'Épargne")})</span>
              <div class="copy-val-wrap">
                <code>${escapeHtml(sepa?.iban || "")}</code>
                <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml((sepa?.iban || "").replace(/\s+/g, ""))}">Copier IBAN</button>
              </div>
            </div>
            <div class="copy-row">
              <span class="copy-lbl">BIC</span>
              <div class="copy-val-wrap">
                <code>${escapeHtml(sepa?.bic || "CEPAFRPP348")}</code>
                <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(sepa?.bic || "CEPAFRPP348")}">Copier</button>
              </div>
            </div>
            <div class="copy-row highlight-copy-row">
              <span class="copy-lbl">Motif / Référence OBLIGATOIRE</span>
              <div class="copy-val-wrap">
                <strong>${escapeHtml(ord.sepaRef)}</strong>
                <button type="button" class="btn-copy-sm" data-copy-val="${escapeHtml(ord.sepaRef)}">Copier Réf</button>
              </div>
            </div>
          </div>
        </div>

        ${
          isDeclared
            ? `
            <div class="declared-alert-box">
              ✓ Votre confirmation est enregistrée et protégée. Notre équipe vient d'être alertée sur son téléphone et prépare vos accès !
            </div>
          `
            : `
            <div class="declare-virement-footer">
              <input
                type="text"
                id="sepa-sender-hint"
                class="form-control"
                placeholder="Nom du titulaire du compte émetteur (facultatif, sécurise le rapprochement)"
              />
              <button type="button" id="btn-declare-payment" class="btn btn-primary" style="width:100%">
                ✓ J'ai effectué le virement instantané (${ord.total} €) — Alerter le vendeur
              </button>
            </div>
          `
        }
      </div>
    `;
  }

  if (ord.paymentMethod === "stripe") {
    const linkUrl = currentPaymentAction?.checkoutUrl;
    if (linkUrl) {
      return `
        <div class="payment-action-card">
          <span class="pm-pill-badge">Stripe Checkout</span>
          <h2>Finalisez votre paiement Carte / Apple Pay (${ord.total} €)</h2>
          <p>Cliquez ci-dessous pour régler sur Stripe, puis revenez sur cette fenêtre.</p>
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;">
            <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Ouvrir Stripe (${ord.total} €)</a>
            <button type="button" id="btn-declare-payment" class="btn btn-secondary">J'ai terminé mon paiement</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="payment-action-card">
        <span class="pm-pill-badge">Passerelle Stripe (Mode Test Sandbox)</span>
        <h2>Simulation de paiement Carte Bancaire / Apple Pay (${ord.total} €)</h2>
        <p>Ajoutez votre clé secrète <code>sk_live_...</code> dans <strong>Admin &gt; Téléphone &amp; Paiements</strong> pour encaisser en réel. Cliquez ci-dessous pour tester la validation instantanée :</p>
        <button type="button" class="btn btn-primary" style="margin-top:1rem;width:100%;" data-sandbox-pay="stripe">
          💳 Simuler un paiement Stripe réussi (${ord.total} €)
        </button>
      </div>
    `;
  }

  const approveUrl = currentPaymentAction?.approveUrl;
  if (approveUrl) {
    return `
      <div class="payment-action-card">
        <span class="pm-pill-badge">PayPal</span>
        <h2>Réglez ${ord.total} € avec PayPal</h2>
        <p>Ouvrez votre lien PayPal pré-rempli, puis cliquez sur « J'ai payé » pour alerter le vendeur.</p>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;">
          <a href="${escapeHtml(approveUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Payer ${ord.total} € sur PayPal ↗</a>
          <button type="button" id="btn-declare-payment" class="btn btn-secondary">✓ J'ai effectué le paiement PayPal</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="payment-action-card">
      <span class="pm-pill-badge">PayPal Checkout (Mode Test Sandbox)</span>
      <h2>Simulation de paiement PayPal (${ord.total} €)</h2>
      <p>Ajoutez votre lien <code>PayPal.Me</code> ou vos clés API dans <strong>Admin &gt; Téléphone &amp; Paiements</strong> pour encaisser en réel :</p>
      <button type="button" class="btn btn-primary" style="margin-top:1rem;width:100%;" data-sandbox-pay="paypal">
        🅿️ Simuler un paiement PayPal réussi (${ord.total} €)
      </button>
    </div>
  `;
}

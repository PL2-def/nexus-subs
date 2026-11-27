import { store } from "./store.js";
import { closeDialogSmoothly, showToast, escapeHtml } from "./mwg-helpers.js";
import { openLiveOrderDialog } from "./order-dialog.js";
import { account } from "./account.js";
import { siteTracker } from "./site-tracker.js";

let selectedGateway = "stripe";
let checkoutOpenedAtMs = 0;
let checkoutSubmitted = false;

function pickDefaultGateway() {
  const p = store.payments;
  if (p.stripe?.enabled) return "stripe";
  if (p.paypal?.enabled) return "paypal";
  if (p.sepa?.enabled) return "sepa_instant";
  return "stripe";
}

export function initCheckoutModal() {
  const dialog = document.getElementById("checkout-dialog");
  if (!dialog) return;

  dialog.addEventListener("close", () => {
    if (checkoutOpenedAtMs > 0 && !checkoutSubmitted) {
      siteTracker.track("checkout_abandon", "Fermeture sans validation");
    }
    checkoutOpenedAtMs = 0;
  });

  window.openCheckoutModal = () => {
    const summary = store.getCartSummary();
    if (summary.isEmpty) {
      showToast("Ajoutez d'abord une offre à votre panier.", "info");
      return;
    }
    selectedGateway = pickDefaultGateway();
    checkoutOpenedAtMs = Date.now();
    checkoutSubmitted = false;
    siteTracker.track("checkout_open", `${summary.total} € (${summary.itemCount} art.)`);
    renderCheckoutForm();
    if (!dialog.open) dialog.showModal();
  };
}

function renderCheckoutForm() {
  const dialog = document.getElementById("checkout-dialog");
  const container = document.getElementById("checkout-dialog-content");
  if (!container) return;

  const summary = store.getCartSummary();
  const p = store.payments;

  const paymentOptions = [
    p.stripe?.enabled && {
      id: "stripe",
      title: "Carte Bancaire, Apple Pay & Google Pay",
      badge: "Recommandé • Instantané",
      subtitle: "Paiement sécurisé SSL via Stripe (Visa, Mastercard, CB, Apple Pay, Google Pay)",
      logos: ["CB", "VISA", "Mastercard", "Apple Pay"]
    },
    p.paypal?.enabled && {
      id: "paypal",
      title: "PayPal",
      badge: "Rapide",
      subtitle: "Réglez facilement avec votre compte PayPal ou solde PayPal",
      logos: ["PayPal"]
    },
    p.sepa?.enabled && {
      id: "sepa_instant",
      title: "Virement Bancaire Instantané SEPA (10s)",
      badge: "QR Code Bancaire",
      subtitle: `Scannez le QR Code officiel depuis votre application bancaire (${p.sepa.bank || "SEPA Instant"})`,
      logos: ["SEPA QR"]
    }
  ].filter(Boolean);

  if (!paymentOptions.some((o) => o.id === selectedGateway) && paymentOptions[0]) {
    selectedGateway = paymentOptions[0].id;
  }

  container.innerHTML = `
    <div class="checkout-header">
      <div class="checkout-header-title">
        <div class="checkout-lock-badge" aria-hidden="true">🔒</div>
        <div>
          <h1 id="checkout-dialog-title" class="checkout-title">Finaliser ma commande sécurisée</h1>
          <p class="checkout-subtitle">Coffre d'accès chiffré AES-256 • Certificat de commande signé inclus</p>
        </div>
      </div>
      <button type="button" class="btn-close-dialog" data-close-checkout aria-label="Fermer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="checkout-body">
      <div class="checkout-mobile-summary-bar">
        <div>
          <strong>🛒 ${summary.itemCount} article${summary.itemCount > 1 ? "s" : ""}</strong>
          <span> • Total : <strong class="grand-price">${summary.total} €</strong></span>
        </div>
        <button type="button" class="inline-legal-btn" id="btn-scroll-checkout-promo">
          ${summary.coupon ? `✓ Code ${escapeHtml(summary.coupon.code)}` : "🏷️ Code promo / Détail ↓"}
        </button>
      </div>

      <form id="checkout-order-form" class="checkout-form">
        <!-- Champ Honeypot Anti-Robot invisible -->
        <input type="text" id="checkout-hp-field" name="company_website" class="visually-hidden" tabindex="-1" autocomplete="off" aria-hidden="true" />

        <div class="checkout-step-block">
          <div class="checkout-section-badge">
            <span class="step-num">1</span>
            <h2 class="checkout-section-title">Vos coordonnées de réception confidentielles</h2>
          </div>

          ${
            account.authenticated && account.user
              ? `
                <div class="checkout-account-banner connected">
                  <span>✅ Connecté en tant que <strong>${escapeHtml(account.user.name)}</strong> (${escapeHtml(account.user.email)}) — cette commande sera automatiquement liée à votre espace compte.</span>
                </div>
              `
              : `
                <div class="checkout-account-banner">
                  <span>💡 Vous avez déjà un compte NEXUS ?</span>
                  <button type="button" class="inline-legal-btn" id="btn-checkout-signin">Se connecter / Créer un compte</button>
                </div>
              `
          }

          <div class="form-row">
            <div class="form-group">
              <label for="checkout-name" class="form-label">Prénom &amp; Nom *</label>
              <input
                type="text"
                id="checkout-name"
                name="name"
                class="form-control"
                placeholder="Thomas Martin"
                value="${escapeHtml(account.authenticated && account.user ? account.user.name : "")}"
                autocomplete="name"
                autofocus
                required
                data-error="checkout-name-err"
              />
              <div id="checkout-name-err" class="field-error-msg">
                <span role="img" aria-label="Erreur">⚠️</span> Indiquez votre nom complet.
              </div>
            </div>

            <div class="form-group">
              <label for="checkout-email" class="form-label">Adresse e-mail personnelle *</label>
              <span id="checkout-email-hint" class="input-hint">Utilisez une vraie boîte mail (adresses jetables refusées par sécurité)</span>
              <input
                type="email"
                id="checkout-email"
                name="email"
                class="form-control"
                placeholder="vous@exemple.fr"
                value="${escapeHtml(account.authenticated && account.user ? account.user.email : "")}"
                autocomplete="email"
                aria-describedby="checkout-email-hint"
                required
                data-error="checkout-email-err"
              />
              <div id="checkout-email-err" class="field-error-msg">
                <span role="img" aria-label="Erreur">⚠️</span> Saisissez une adresse e-mail valide (ex: vous@exemple.fr).
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-top: 0.85rem;">
            <label for="checkout-notes" class="form-label">Précision ou compte Gmail pour YouTube (facultatif)</label>
            <input
              type="text"
              id="checkout-notes"
              name="notes"
              class="form-control"
              placeholder="Ex : adresse Gmail à inviter si différente de l'e-mail ci-dessus"
            />
          </div>
        </div>

        <div class="checkout-step-block">
          <div class="checkout-section-badge">
            <span class="step-num">2</span>
            <h2 class="checkout-section-title">Choisissez votre moyen de paiement</h2>
          </div>

          <div class="payment-methods-selector" role="radiogroup" aria-label="Choix du moyen de paiement">
            ${paymentOptions
              .map(
                (opt) => `
                <label class="payment-method-card ${selectedGateway === opt.id ? "active" : ""}" data-gateway-card="${opt.id}">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="${opt.id}"
                    ${selectedGateway === opt.id ? "checked" : ""}
                  />
                  <div class="pm-info">
                    <div class="pm-header">
                      <div class="pm-title-group">
                        <span class="pm-title">${escapeHtml(opt.title)}</span>
                        <span class="pm-pill-badge">${escapeHtml(opt.badge)}</span>
                      </div>
                      <div class="pm-logos">
                        ${opt.logos.map((l) => `<span class="badge-card-brand">${escapeHtml(l)}</span>`).join("")}
                      </div>
                    </div>
                    <p class="pm-sub">${escapeHtml(opt.subtitle)}</p>
                  </div>
                </label>
              `
              )
              .join("")}
          </div>
        </div>

        <div class="legal-consent-section">
          <label class="consent-checkbox-label">
            <input type="checkbox" id="consent-terms" name="consent" required data-error="consent-err" />
            <span>
              J'accepte les <button type="button" class="inline-legal-btn" data-open-legal="cgv">CGV</button> et demande la délivrance immédiate de mon accès numérique (protégé par la <strong>Garantie 365 jours</strong> et le <strong>Suivi Sécurisé</strong>).
            </span>
          </label>
          <div id="consent-err" class="field-error-msg">
            <span role="img" aria-label="Erreur">⚠️</span> Veuillez cocher cette case pour continuer.
          </div>
        </div>

        <button type="submit" id="btn-submit-order" class="btn btn-primary btn-submit-order">
          <span>Valider et passer au règlement (${summary.total} €)</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="btn-icon"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </form>

      <aside class="checkout-summary-sidebar">
        <h2 class="sidebar-title">Récapitulatif</h2>
        <ul class="summary-items-list">
          ${summary.items
            .map(
              (item) => `
              <li class="summary-item">
                <div>
                  <span class="summary-item-title">${escapeHtml(item.product.title)}</span>
                  <span class="summary-item-meta">Qté : ${item.quantity} • ${escapeHtml(item.product.duration)}</span>
                </div>
                <span class="summary-item-price">${item.lineTotal} €</span>
              </li>
            `
            )
            .join("")}
        </ul>

        <form id="checkout-promo-form" class="checkout-inline-promo">
          <label for="checkout-promo-input" class="visually-hidden">Code promo</label>
          <div class="promo-input-group">
            <input
              type="text"
              id="checkout-promo-input"
              class="input-promo"
              placeholder="Code promo (ex: BIENVENUE5)"
              value="${summary.coupon ? escapeHtml(summary.coupon.code) : ""}"
              ${summary.coupon ? "disabled" : ""}
            />
            ${
              summary.coupon
                ? `<button type="button" id="btn-checkout-rm-coupon" class="btn-promo-remove">Retirer</button>`
                : `<button type="submit" class="btn btn-secondary btn-promo-apply">OK</button>`
            }
          </div>
        </form>

        <div class="summary-totals-box">
          <div class="totals-line">
            <span>Sous-total</span>
            <span>${summary.subtotal} €</span>
          </div>
          ${
            summary.discountAmount > 0
              ? `<div class="totals-line totals-discount">
                  <span>Code ${escapeHtml(summary.coupon.code)}</span>
                  <span>- ${summary.discountAmount} €</span>
                </div>`
              : ""
          }
          <div class="totals-line grand-total">
            <span>Total TTC</span>
            <span class="grand-price">${summary.total} €</span>
          </div>
        </div>

        <div class="summary-reassurance-box">
          <div class="reassurance-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>Suivi Sécurisé : certificat signé téléchargeable</span>
          </div>
          <div class="reassurance-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
            <span>Réception directe à l'écran + par e-mail</span>
          </div>
          <div class="reassurance-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Aucun prélèvement récurrent caché</span>
          </div>
        </div>
      </aside>
    </div>
  `;

  container.querySelectorAll("[data-close-checkout]").forEach((btn) => {
    btn.addEventListener("click", () => closeDialogSmoothly(dialog));
  });

  container.querySelectorAll("[data-open-legal]").forEach((btn) => {
    btn.addEventListener("click", () => window.openLegalModal?.(btn.getAttribute("data-open-legal")));
  });

  container.querySelector("#btn-checkout-signin")?.addEventListener("click", async () => {
    await closeDialogSmoothly(dialog);
    account.openModal("login");
  });

  container.querySelector("#btn-scroll-checkout-promo")?.addEventListener("click", () => {
    const sidebar = container.querySelector(".checkout-summary-sidebar");
    sidebar?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const promoInput = container.querySelector("#checkout-promo-input");
    if (promoInput && !promoInput.disabled) {
      setTimeout(() => promoInput.focus({ preventScroll: true }), 260);
    }
  });

  container.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (selectedGateway !== radio.value) {
        siteTracker.track("payment_method_switch", `${selectedGateway} → ${radio.value}`);
      }
      selectedGateway = radio.value;
      container.querySelectorAll(".payment-method-card").forEach((card) => {
        card.classList.toggle("active", card.getAttribute("data-gateway-card") === selectedGateway);
      });
    });
  });

  container.querySelector("#checkout-promo-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = container.querySelector("#checkout-promo-input")?.value || "";
    const res = await store.applyCouponCode(code);
    showToast(res.message, res.ok ? "success" : "error");
    if (res.ok) renderCheckoutForm();
  });

  container.querySelector("#btn-checkout-rm-coupon")?.addEventListener("click", () => {
    store.removeCoupon();
    renderCheckoutForm();
  });

  const form = container.querySelector("#checkout-order-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const submitBtn = container.querySelector("#btn-submit-order");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner-icon"></span><span>Sécurisation &amp; création du certificat...</span>`;
    }

    try {
      const currentSummary = store.getCartSummary();
      const payload = {
        items: currentSummary.items.map((i) => ({ id: i.id, quantity: i.quantity })),
        couponCode: currentSummary.coupon ? currentSummary.coupon.code : null,
        customerName: container.querySelector("#checkout-name").value.trim(),
        email: container.querySelector("#checkout-email").value.trim(),
        notes: container.querySelector("#checkout-notes")?.value.trim() || "",
        paymentMethod: selectedGateway,
        honeypot: container.querySelector("#checkout-hp-field")?.value || "",
        formFillMs: checkoutOpenedAtMs ? Date.now() - checkoutOpenedAtMs : 5000,
        ...siteTracker.getPayloadMeta()
      };

      const resp = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || "Impossible de créer la commande.");
      }

      checkoutSubmitted = true;
      store.saveCustomerOrderRef({
        orderId: data.order.orderId,
        accessToken: data.accessToken,
        email: data.order.email,
        total: data.order.total,
        createdAt: data.order.createdAt
      });

      if (account.authenticated) {
        account.fetchSession({ silent: true });
      }

      store.clearCart();
      await closeDialogSmoothly(dialog);

      if (
        data.paymentAction?.type === "stripe" &&
        data.paymentAction.checkoutUrl &&
        (data.paymentAction.mode === "live" || data.paymentAction.mode === "test")
      ) {
        window.location.href = data.paymentAction.checkoutUrl;
        return;
      }

      if (
        data.paymentAction?.type === "paypal" &&
        data.paymentAction.approveUrl &&
        (data.paymentAction.mode === "live" || data.paymentAction.mode === "sandbox")
      ) {
        window.location.href = data.paymentAction.approveUrl;
        return;
      }

      openLiveOrderDialog({
        orderId: data.order.orderId,
        accessToken: data.accessToken,
        initialOrder: data.order,
        paymentAction: data.paymentAction
      });
    } catch (err) {
      showToast(err.message || "Une erreur est survenue.", "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Valider et passer au règlement (${summary.total} €)</span>`;
      }
    }
  });
}

export async function handlePaymentReturnQuery() {
  const params = new URLSearchParams(window.location.search);
  const paymentFlag = params.get("payment");
  const orderId = params.get("order");
  const token = params.get("token");

  if (!paymentFlag || !orderId || !token) return;

  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);

  store.saveCustomerOrderRef({ orderId, accessToken: token });

  if (paymentFlag === "stripe_success") {
    const sessionId = params.get("session_id");
    try {
      await fetch(`/api/orders/${encodeURIComponent(orderId)}/confirm-gateway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, gateway: "stripe", sessionId })
      });
      showToast("Paiement Stripe confirmé ! Vos accès arrivent en direct.", "success", 5000);
    } catch {
      // ignore
    }
  } else if (paymentFlag === "paypal_return") {
    try {
      await fetch(`/api/orders/${encodeURIComponent(orderId)}/confirm-gateway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, gateway: "paypal" })
      });
      showToast("Paiement PayPal confirmé ! Vos accès arrivent en direct.", "success", 5000);
    } catch {
      // ignore
    }
  } else if (paymentFlag === "stripe_cancel" || paymentFlag === "paypal_cancel") {
    showToast("Le paiement a été annulé. Vous pouvez le reprendre ci-dessous.", "info", 4500);
  }

  openLiveOrderDialog({ orderId, accessToken: token });
}

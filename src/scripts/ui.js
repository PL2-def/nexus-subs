import { store, getProductSvgIcon } from "./store.js";
import { closeDialogSmoothly, showToast, escapeHtml } from "./mwg-helpers.js";
import { openCustomerDiscussion } from "./discussion-widget.js";

function computeSavingsInfo(product) {
  const price = Number(product.price) || 0;
  const compare = Number(product.compareAtPrice) || 0;
  if (compare > price && price > 0) {
    const savedEur = Math.round(compare - price);
    const savedPct = Math.round(((compare - price) / compare) * 100);
    return { hasSavings: savedEur >= 2, savedEur, savedPct, compareFormatted: compare.toFixed(2).replace(".", ",") };
  }
  return { hasSavings: false, savedEur: 0, savedPct: 0, compareFormatted: "" };
}

function getAvailabilityBadgeHtml(product) {
  if (product.availability === "out_of_stock" || product.stockCount === 0) {
    return `<span class="stock-pill stock-out"><span class="stock-dot"></span>Rupture temporaire</span>`;
  }
  if (product.availability === "low_stock" || (typeof product.stockCount === "number" && product.stockCount <= 3)) {
    const qtyLabel = typeof product.stockCount === "number" ? `Plus que ${product.stockCount} dispo` : "Stock limité";
    return `<span class="stock-pill stock-low"><span class="stock-dot"></span>${escapeHtml(qtyLabel)}</span>`;
  }
  const suffix = typeof product.stockCount === "number" ? ` (${product.stockCount} en stock)` : " — Livraison immédiate";
  return `<span class="stock-pill stock-in"><span class="stock-dot"></span>En stock${escapeHtml(suffix)}</span>`;
}

export function renderProductGrid() {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  const activeCat = store.activeCategory || "all";
  const list = store.products.filter((p) => activeCat === "all" || p.category === activeCat);

  if (list.length === 0) {
    grid.innerHTML = `<div class="catalog-empty-card"><p>Aucune offre dans cette catégorie.</p></div>`;
    return;
  }

  grid.innerHTML = list
    .map((product) => {
      const available = store.isProductAvailable(product);
      const savings = computeSavingsInfo(product);
      const monthly = (Number(product.price) / 12).toFixed(2).replace(".", ",");
      const iconSvg = getProductSvgIcon(product);

      return `
        <article class="product-card ${product.popular ? "product-card-popular" : ""} ${!available ? "product-card-disabled" : ""}" data-product-id="${escapeHtml(product.id)}" style="--card-accent: ${escapeHtml(product.accentColor || "#8b5cf6")};">
          ${product.popular ? `<div class="popular-crown-ribbon">★ Offre la plus choisie</div>` : ""}
          <div class="product-card-glow"></div>

          <div class="product-card-top">
            <div class="product-top-badges">
              <span class="product-badge badge-${escapeHtml(product.badgeColor || "custom")}">${escapeHtml(product.badge || "Offre Annuelle")}</span>
              ${getAvailabilityBadgeHtml(product)}
            </div>
            <div class="product-header-icon" style="color: ${escapeHtml(product.accentColor || "#8b5cf6")}">
              ${iconSvg}
            </div>
          </div>

          <div class="product-card-body">
            <span class="product-category">${escapeHtml(product.categoryLabel || "Abonnement")}</span>
            <h3 class="product-title">${escapeHtml(product.title)}</h3>
            <p class="product-tagline">${escapeHtml(product.tagline)}</p>

            <div class="product-price-panel">
              <div class="price-panel-left">
                ${
                  savings.hasSavings
                    ? `<div class="price-compare-row">
                        <span class="price-old">${savings.compareFormatted} €</span>
                        <span class="price-save-pill">Économisez ${savings.savedEur} € (-${savings.savedPct}%)</span>
                      </div>`
                    : ""
                }
                <div class="price-main-row">
                  <span class="price-value">${escapeHtml(product.price)}</span>
                  <span class="price-currency">€</span>
                  <span class="price-period-inline">/ ${escapeHtml(product.duration || "12 mois")}</span>
                </div>
                <span class="price-monthly-note">Soit <strong>${monthly} € / mois</strong> • Zéro renouvellement auto</span>
              </div>
            </div>

            <ul class="features-list">
              ${(product.shortFeatures || [])
                .slice(0, 5)
                .map(
                  (f) => `
                  <li>
                    <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <span>${escapeHtml(f)}</span>
                  </li>
                `
                )
                .join("")}
            </ul>
          </div>

          <div class="product-card-actions">
            ${
              available
                ? `
                  <button type="button" class="btn btn-primary btn-buy-now" data-action="buy-now" data-id="${escapeHtml(product.id)}">
                    <span>Commander maintenant — ${escapeHtml(product.price)} €</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="btn-icon" aria-hidden="true">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                  <div class="product-secondary-btns">
                    <button type="button" class="btn btn-secondary btn-sm-card" data-action="add-cart" data-id="${escapeHtml(product.id)}">
                      + Panier
                    </button>
                    <button type="button" class="btn btn-outline btn-sm-card" data-action="open-detail" data-id="${escapeHtml(product.id)}">
                      Détails &amp; Guide
                    </button>
                  </div>
                `
                : `
                  <button type="button" class="btn btn-secondary btn-disabled-stock" disabled>
                    Momentanément indisponible
                  </button>
                `
            }
            <button type="button" class="btn-ask-product-chat" data-action="ask-product" data-id="${escapeHtml(product.id)}">
              💬 Poser une question sur ${escapeHtml(product.title)}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

export function openProductDetail(productId) {
  const product = store.getProductById(productId);
  if (!product) return;

  const dialog = document.getElementById("product-detail-dialog");
  const content = document.getElementById("product-detail-dialog-content");
  if (!dialog || !content) return;

  const available = store.isProductAvailable(product);
  const savings = computeSavingsInfo(product);

  content.innerHTML = `
    <div class="modal-product-header" style="--accent-color: ${escapeHtml(product.accentColor || "#8b5cf6")}; --accent-glow: ${escapeHtml(product.accentGlow || "rgba(139,92,246,0.22)")}">
      <div class="modal-header-top-row">
        <div class="modal-badge-wrapper">
          <span class="product-badge badge-${escapeHtml(product.badgeColor || "custom")}">${escapeHtml(product.badge || "Offre")}</span>
          ${getAvailabilityBadgeHtml(product)}
        </div>
        <button type="button" class="btn-close-dialog" data-close-detail aria-label="Fermer la fiche produit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="modal-title-row">
        <div class="modal-icon-wrap" style="color: ${escapeHtml(product.accentColor || "#8b5cf6")}">
          ${getProductSvgIcon(product)}
        </div>
        <div>
          <h1 id="product-dialog-title" class="modal-product-title">${escapeHtml(product.title)}</h1>
          <p class="modal-product-tagline">${escapeHtml(product.tagline)}</p>
        </div>
      </div>
    </div>

    <div class="modal-product-body">
      <div class="detail-price-banner">
        <div>
          ${savings.hasSavings ? `<div class="detail-old-price">Tarif mensuel cumulé : <s>${savings.compareFormatted} €</s> • <strong>-${savings.savedEur} € d'économie</strong></div>` : ""}
          <span class="detail-price-amount">${escapeHtml(product.price)} €</span>
          <span class="detail-price-period">TTC pour ${escapeHtml(product.duration)}</span>
        </div>
        <div class="detail-payment-mini">
          <span>✓ Stripe (CB / Apple Pay)</span>
          <span>✓ PayPal</span>
          <span>✓ SEPA QR</span>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="detail-section-title">Présentation</h2>
        <p class="detail-description-text">${escapeHtml(product.fullDescription || product.tagline)}</p>
      </div>

      ${
        Array.isArray(product.detailedBenefits) && product.detailedBenefits.length
          ? `
          <div class="detail-section">
            <h2 class="detail-section-title">Avantages clés inclus</h2>
            <div class="detail-benefits-grid">
              ${product.detailedBenefits
                .map(
                  (b) => `
                  <div class="benefit-card">
                    <div class="benefit-card-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="benefit-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                      <h3 class="benefit-title">${escapeHtml(b.title)}</h3>
                    </div>
                    <p class="benefit-desc">${escapeHtml(b.desc)}</p>
                  </div>
                `
                )
                .join("")}
            </div>
          </div>
        `
          : ""
      }

      <div class="detail-section activation-box">
        <h2 class="detail-section-title">Instructions d'obtention &amp; d'activation</h2>
        <p class="activation-format-badge"><strong>Format :</strong> ${escapeHtml(product.activationFormat || "Livraison directe sur le site et par e-mail")}</p>
        <ol class="activation-steps-list">
          ${(product.activationSteps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ol>
      </div>
    </div>

    <div class="modal-product-footer">
      <div class="modal-footer-price">
        <span class="footer-price-val">${escapeHtml(product.price)} €</span>
        <span class="footer-price-sub">/ ${escapeHtml(product.duration)}</span>
      </div>
      <div class="modal-footer-actions">
        <button type="button" class="btn btn-outline" id="btn-detail-ask">💬 Discuter de cet article</button>
        ${
          available
            ? `
              <button type="button" class="btn btn-secondary" id="btn-detail-add-cart">+ Panier</button>
              <button type="button" class="btn btn-primary" id="btn-detail-buy-now">Commander maintenant</button>
            `
            : `<button type="button" class="btn btn-secondary" disabled>Indisponible</button>`
        }
      </div>
    </div>
  `;

  content.querySelectorAll("[data-close-detail]").forEach((btn) => {
    btn.addEventListener("click", () => closeDialogSmoothly(dialog));
  });

  content.querySelector("#btn-detail-ask")?.addEventListener("click", async () => {
    await closeDialogSmoothly(dialog);
    openCustomerDiscussion({ productId: product.id });
  });

  content.querySelector("#btn-detail-add-cart")?.addEventListener("click", () => {
    const res = store.addToCart(product.id, 1);
    if (res.ok) {
      showToast(res.message, "success");
      closeDialogSmoothly(dialog);
      openCartDrawer();
    } else {
      showToast(res.message, "error");
    }
  });

  content.querySelector("#btn-detail-buy-now")?.addEventListener("click", () => {
    const res = store.setBuyNowItem(product.id);
    if (res.ok) {
      closeDialogSmoothly(dialog);
      window.openCheckoutModal?.();
    } else {
      showToast(res.message, "error");
    }
  });

  if (!dialog.open) dialog.showModal();
}

export function openCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (!drawer || !overlay) return;
  renderCartDrawer();
  drawer.classList.add("open");
  overlay.classList.add("open");
}

export function closeCartDrawer() {
  document.getElementById("cart-drawer")?.classList.remove("open");
  document.getElementById("cart-overlay")?.classList.remove("open");
}

export function renderCartDrawer() {
  const itemsEl = document.getElementById("cart-items-container");
  const sumEl = document.getElementById("cart-summary-container");
  const badges = document.querySelectorAll(".cart-count-badge");
  if (!itemsEl || !sumEl) return;

  const summary = store.getCartSummary();
  badges.forEach((b) => {
    b.textContent = summary.itemCount;
    b.classList.toggle("hidden", summary.itemCount === 0);
  });

  if (summary.isEmpty) {
    itemsEl.innerHTML = `
      <div class="cart-empty-state">
        <div class="empty-icon-wrap" aria-hidden="true">🛒</div>
        <p class="empty-title">Votre panier est vide</p>
        <p class="empty-subtitle">Sélectionnez un abonnement 12 mois pour profiter de nos tarifs réduits.</p>
        <button type="button" class="btn btn-primary" id="btn-cart-explore">Voir les offres</button>
      </div>
    `;
    itemsEl.querySelector("#btn-cart-explore")?.addEventListener("click", () => {
      closeCartDrawer();
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    });
    sumEl.innerHTML = "";
    return;
  }

  itemsEl.innerHTML = `
    <ul class="cart-items-list">
      ${summary.items
        .map(
          (item) => `
          <li class="cart-item">
            <div class="cart-item-header">
              <div>
                <span class="cart-item-category">${escapeHtml(item.product.categoryLabel)}</span>
                <h3 class="cart-item-title">${escapeHtml(item.product.title)}</h3>
                <span class="cart-item-duration">${escapeHtml(item.product.duration)}</span>
              </div>
              <button type="button" class="cart-item-remove" data-remove-cart="${escapeHtml(item.id)}" aria-label="Retirer ${escapeHtml(item.product.title)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="cart-item-footer">
              <div class="cart-quantity-selector">
                <button type="button" class="qty-btn" data-dec-cart="${escapeHtml(item.id)}" aria-label="Diminuer">−</button>
                <span class="qty-val">${item.quantity}</span>
                <button type="button" class="qty-btn" data-inc-cart="${escapeHtml(item.id)}" aria-label="Augmenter">+</button>
              </div>
              <div class="cart-item-price-wrap">
                <span class="cart-item-total">${item.lineTotal} €</span>
              </div>
            </div>
          </li>
        `
        )
        .join("")}
    </ul>
  `;

  sumEl.innerHTML = `
    <form id="cart-promo-form" class="cart-promo-form">
      <label for="drawer-promo-input" class="visually-hidden">Code promotionnel</label>
      <div class="promo-input-group">
        <input
          type="text"
          id="drawer-promo-input"
          class="input-promo"
          placeholder="Code promo (ex: BIENVENUE5)"
          value="${summary.coupon ? escapeHtml(summary.coupon.code) : ""}"
          ${summary.coupon ? "disabled" : ""}
        />
        ${
          summary.coupon
            ? `<button type="button" id="btn-drawer-remove-coupon" class="btn-promo-remove">Retirer</button>`
            : `<button type="submit" class="btn btn-secondary btn-promo-apply">Appliquer</button>`
        }
      </div>
      ${summary.coupon ? `<p class="promo-applied-text">✓ ${escapeHtml(summary.coupon.label)}</p>` : ""}
    </form>

    <div class="cart-totals-block">
      <div class="totals-row">
        <span>Sous-total</span>
        <span>${summary.subtotal} €</span>
      </div>
      ${
        summary.discountAmount > 0
          ? `<div class="totals-row totals-discount">
              <span>Remise (${escapeHtml(summary.coupon.code)})</span>
              <span>- ${summary.discountAmount} €</span>
            </div>`
          : ""
      }
      <div class="totals-row totals-grand">
        <span>Total TTC</span>
        <span class="val-grand">${summary.total} €</span>
      </div>
    </div>

    <button type="button" id="btn-drawer-checkout" class="btn btn-primary btn-checkout-lg">
      <span>Passer au paiement sécurisé (${summary.total} €)</span>
    </button>
    <p class="drawer-pay-methods-note">🛡️ Livraison Sécurisée • Stripe • PayPal • SEPA QR</p>
  `;

  itemsEl.querySelectorAll("[data-remove-cart]").forEach((btn) => {
    btn.addEventListener("click", () => store.removeFromCart(btn.getAttribute("data-remove-cart")));
  });
  itemsEl.querySelectorAll("[data-dec-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-dec-cart");
      const found = summary.items.find((x) => x.id === id);
      if (found) store.updateQuantity(id, found.quantity - 1);
    });
  });
  itemsEl.querySelectorAll("[data-inc-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-inc-cart");
      const found = summary.items.find((x) => x.id === id);
      if (found) store.updateQuantity(id, found.quantity + 1);
    });
  });
  sumEl.querySelector("#cart-promo-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = sumEl.querySelector("#drawer-promo-input")?.value || "";
    const res = await store.applyCouponCode(val);
    showToast(res.message, res.ok ? "success" : "error");
  });
  sumEl.querySelector("#btn-drawer-remove-coupon")?.addEventListener("click", () => {
    store.removeCoupon();
    showToast("Code promo retiré.", "info");
  });
  sumEl.querySelector("#btn-drawer-checkout")?.addEventListener("click", () => {
    closeCartDrawer();
    window.openCheckoutModal?.();
  });
}

/**
 * État réactif central de la boutique (Catalogue temps réel, Panier, Commandes client mémorisées)
 */

const CART_KEY = "nexus_cart_v2";
const COUPON_KEY = "nexus_coupon_v2";
const MY_ORDERS_KEY = "nexus_my_orders_v2";

export function getProductSvgIcon(product) {
  const id = (product.id || "").toLowerCase();
  if (id.includes("youtube")) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="product-icon-svg" aria-hidden="true">
        <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" />
        <path d="m10 15 5-3-5-3v6Z" fill="#ef4444" stroke="#ef4444" />
      </svg>
    `;
  }
  if (id.includes("psn") || id.includes("playstation")) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="product-icon-svg" aria-hidden="true">
        <rect width="20" height="12" x="2" y="6" rx="6" fill="rgba(59, 130, 246, 0.16)" stroke="#3b82f6" />
        <path d="M6 12h4m-2-2v4" stroke="#3b82f6" stroke-width="2" />
        <circle cx="17" cy="10" r="1" fill="#3b82f6" />
        <circle cx="15" cy="12" r="1" fill="#3b82f6" />
        <circle cx="17" cy="14" r="1" fill="#3b82f6" />
        <circle cx="19" cy="12" r="1" fill="#3b82f6" />
      </svg>
    `;
  }
  if (id.includes("netflix")) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="product-icon-svg" aria-hidden="true">
        <rect width="20" height="15" x="2" y="4" rx="2.5" fill="rgba(229, 9, 20, 0.16)" stroke="#e50914" />
        <polygon points="10 8 16 11.5 10 15 10 8" fill="#e50914" stroke="#e50914" />
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="product-icon-svg" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="rgba(139, 92, 246, 0.18)" stroke="currentColor" />
    </svg>
  `;
}

class AppStore {
  constructor() {
    this.products = [];
    this.payments = {
      stripe: { enabled: true, configured: false, mode: "sandbox_demo" },
      paypal: { enabled: true, configured: false, mode: "sandbox_demo" },
      sepa: {
        enabled: true,
        beneficiary: "Gasc Enzo",
        iban: "FR76 1348 5008 0004 3173 7582 896",
        bic: "CEPAFRPP348",
        bank: "Caisse d’Épargne"
      }
    };
    this.activeCategory = "all";
    this.cartItems = [];
    this.coupon = null; // { code, type, value, label, minAmount }
    this.listeners = new Set();
    this.catalogEventSource = null;

    this.loadLocalCart();
  }

  loadLocalCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (Array.isArray(raw)) {
        this.cartItems = raw
          .filter((x) => x && x.id)
          .map((x) => ({ id: x.id, quantity: Math.max(1, Math.min(10, parseInt(x.quantity, 10) || 1)) }));
      }
      const savedCoupon = JSON.parse(localStorage.getItem(COUPON_KEY) || "null");
      if (savedCoupon && savedCoupon.code) {
        this.coupon = savedCoupon;
      }
    } catch {
      this.cartItems = [];
      this.coupon = null;
    }
  }

  saveLocalCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(this.cartItems));
      if (this.coupon) localStorage.setItem(COUPON_KEY, JSON.stringify(this.coupon));
      else localStorage.removeItem(COUPON_KEY);
    } catch {
      // ignore storage quota errors
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.saveLocalCart();
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error("[Store listener error]", err);
      }
    }
  }

  async initBootstrap() {
    try {
      const resp = await fetch("/api/bootstrap");
      if (resp.ok) {
        const data = await resp.json();
        this.products = Array.isArray(data.products) ? data.products : [];
        if (data.payments) this.payments = data.payments;
        this.reconcileCartWithCatalog();
        this.emit();
      }
    } catch (err) {
      console.error("[Bootstrap fetch error]", err);
    }

    this.connectCatalogSse();
  }

  connectCatalogSse() {
    if (this.catalogEventSource) this.catalogEventSource.close();
    try {
      const es = new EventSource("/api/events/catalog");
      es.addEventListener("catalog_updated", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (Array.isArray(payload.products)) {
            this.products = payload.products;
            this.reconcileCartWithCatalog();
            this.emit();
          }
        } catch {
          // ignore
        }
      });
      this.catalogEventSource = es;
    } catch {
      // ignore SSE error
    }
  }

  reconcileCartWithCatalog() {
    if (!this.products.length) return;
    this.cartItems = this.cartItems.filter((item) => {
      const p = this.getProductById(item.id);
      if (!p || p.availability === "out_of_stock" || p.stockCount === 0) return false;
      if (typeof p.stockCount === "number" && item.quantity > p.stockCount) {
        item.quantity = p.stockCount;
      }
      return item.quantity > 0;
    });
  }

  getProductById(id) {
    if (!id) return null;
    const clean = String(id).toLowerCase();
    return this.products.find((p) => p.id.toLowerCase() === clean || (p.slug && p.slug.toLowerCase() === clean)) || null;
  }

  isProductAvailable(product) {
    if (!product || product.active === false) return false;
    if (product.availability === "out_of_stock") return false;
    if (typeof product.stockCount === "number" && product.stockCount <= 0) return false;
    return true;
  }

  addToCart(productId, qty = 1) {
    const product = this.getProductById(productId);
    if (!product) return { ok: false, message: "Offre introuvable." };
    if (!this.isProductAvailable(product)) {
      return { ok: false, message: `« ${product.title} » est momentanément en rupture de stock.` };
    }

    const maxAllowed = typeof product.stockCount === "number" ? Math.min(10, product.stockCount) : 10;
    const existing = this.cartItems.find((i) => i.id === product.id);

    if (existing) {
      if (existing.quantity >= maxAllowed) {
        return { ok: false, message: `Stock disponible maximum atteint (${maxAllowed}) pour cette offre.` };
      }
      existing.quantity = Math.min(maxAllowed, existing.quantity + qty);
    } else {
      this.cartItems.push({ id: product.id, quantity: Math.min(maxAllowed, Math.max(1, qty)) });
    }

    this.emit();
    return { ok: true, product, message: `${product.title} ajouté au panier.` };
  }

  setBuyNowItem(productId) {
    const product = this.getProductById(productId);
    if (!product || !this.isProductAvailable(product)) {
      return { ok: false, message: "Cette offre n'est pas disponible actuellement." };
    }
    const existing = this.cartItems.find((i) => i.id === product.id);
    if (!existing) {
      this.cartItems.push({ id: product.id, quantity: 1 });
      this.emit();
    }
    return { ok: true, product };
  }

  updateQuantity(productId, nextQty) {
    const qty = parseInt(nextQty, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      return this.removeFromCart(productId);
    }
    const product = this.getProductById(productId);
    const maxAllowed = product && typeof product.stockCount === "number" ? Math.min(10, product.stockCount) : 10;
    const item = this.cartItems.find((i) => i.id === productId);
    if (item) {
      item.quantity = Math.min(maxAllowed, qty);
      this.emit();
    }
  }

  removeFromCart(productId) {
    this.cartItems = this.cartItems.filter((i) => i.id !== productId);
    this.emit();
  }

  clearCart() {
    this.cartItems = [];
    this.coupon = null;
    this.emit();
  }

  async applyCouponCode(rawCode) {
    const summary = this.getCartSummary();
    const resp = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: rawCode, subtotal: summary.subtotal })
    });
    const data = await resp.json();
    if (!resp.ok || !data.valid) {
      return { ok: false, message: data.message || "Code promo invalide." };
    }
    this.coupon = data.coupon;
    this.emit();
    return { ok: true, message: data.message };
  }

  removeCoupon() {
    this.coupon = null;
    this.emit();
  }

  getCartSummary() {
    const items = this.cartItems
      .map((ci) => {
        const product = this.getProductById(ci.id);
        if (!product) return null;
        const unitPrice = Number(product.price);
        const lineTotal = Math.round(unitPrice * ci.quantity * 100) / 100;
        return {
          id: product.id,
          product,
          quantity: ci.quantity,
          unitPrice,
          lineTotal
        };
      })
      .filter(Boolean);

    const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);
    const subtotal = Math.round(items.reduce((acc, i) => acc + i.lineTotal, 0) * 100) / 100;

    let discountAmount = 0;
    if (this.coupon && subtotal > 0) {
      if (!this.coupon.minAmount || subtotal >= this.coupon.minAmount) {
        discountAmount =
          this.coupon.type === "percent"
            ? Math.round(((subtotal * this.coupon.value) / 100) * 100) / 100
            : Math.min(subtotal, Number(this.coupon.value));
      }
    }

    const total = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

    return {
      items,
      itemCount,
      subtotal,
      discountAmount,
      coupon: discountAmount > 0 ? this.coupon : null,
      total,
      isEmpty: items.length === 0
    };
  }

  // Historique local des commandes du client pour rouvrir ses accès en 1 clic
  getSavedCustomerOrders() {
    try {
      const list = JSON.parse(localStorage.getItem(MY_ORDERS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  saveCustomerOrderRef({ orderId, accessToken, email, total, createdAt }) {
    try {
      const list = this.getSavedCustomerOrders().filter((o) => o.orderId !== orderId);
      list.unshift({ orderId, accessToken, email, total, createdAt: createdAt || new Date().toISOString() });
      localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(list.slice(0, 15)));
      this.updateHeaderOrderDot();
    } catch {
      // ignore
    }
  }

  updateHeaderOrderDot() {
    const dot = document.getElementById("customer-order-dot");
    if (!dot) return;
    const hasOrders = this.getSavedCustomerOrders().length > 0;
    dot.classList.toggle("hidden", !hasOrders);
  }
}

export const store = new AppStore();

import { initStaticRuntimeIfNeeded } from "./static-runtime.js";
import { store } from "./store.js";
import { initAllDialogs, initFormValidationAria, showToast } from "./mwg-helpers.js";
import { siteTracker } from "./site-tracker.js";
import { account } from "./account.js";
import { renderProductGrid, openProductDetail, openCartDrawer, closeCartDrawer, renderCartDrawer } from "./ui.js";
import { initCheckoutModal, handlePaymentReturnQuery } from "./checkout.js";
import { initOrderTrackerModal } from "./order-dialog.js";
import { setupLegalModal } from "./legal.js";
import { initGuideAndRescue } from "./guide-and-rescue.js";
import { initCustomerDiscussionWidget, openCustomerDiscussion } from "./discussion-widget.js";
import { admin } from "./admin.js";

document.addEventListener("DOMContentLoaded", async () => {
  await initStaticRuntimeIfNeeded();
  siteTracker.init();
  initAllDialogs();
  initFormValidationAria();
  await account.init();
  initCheckoutModal();
  initOrderTrackerModal();
  setupLegalModal();
  initGuideAndRescue();
  await initCustomerDiscussionWidget();
  admin.init();

  const syncSupportPrefill = () => {
    const sName = document.getElementById("support-name");
    const sEmail = document.getElementById("support-email");
    if (account.authenticated && account.user) {
      if (sName && !sName.value) sName.value = account.user.name || "";
      if (sEmail && !sEmail.value) sEmail.value = account.user.email || "";
    }
  };
  syncSupportPrefill();
  account.subscribe(() => {
    syncSupportPrefill();
    store.updateHeaderOrderDot();
  });

  store.subscribe(() => {
    renderProductGrid();
    renderCartDrawer();
  });

  store.updateHeaderOrderDot();
  await store.initBootstrap();
  renderProductGrid();
  renderCartDrawer();

  await handlePaymentReturnQuery();

  // Ouverture directe depuis notification mobile Admin (?adminOrder=... ou ?adminThread=...)
  const params = new URLSearchParams(window.location.search);
  const adminOrder = params.get("adminOrder");
  const adminThread = params.get("adminThread");
  if (adminOrder) {
    window.history.replaceState({}, "", window.location.pathname);
    admin.openModal("orders", { orderId: adminOrder });
  } else if (adminThread) {
    window.history.replaceState({}, "", window.location.pathname);
    admin.openModal("discussions", { threadId: adminThread });
  } else if (window.location.hash === "#admin") {
    admin.openModal();
  }

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#admin") admin.openModal();
  });

  // Raccourci clavier rapide Admin : Alt + Shift + A
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      admin.openModal();
    }
    if (e.key === "Escape") {
      closeCartDrawer();
      closeMobileMenu();
    }
  });

  // Filtres catégories catalogue
  document.querySelectorAll("[data-filter]").forEach((pill) => {
    pill.addEventListener("click", () => {
      store.activeCategory = pill.getAttribute("data-filter") || "all";
      document.querySelectorAll("[data-filter]").forEach((p) => p.classList.toggle("active", p === pill));
      renderProductGrid();
    });
  });

  // Copie rapide code promo
  document.querySelectorAll("[data-copy-promo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-copy-promo") || "";
      try {
        await navigator.clipboard.writeText(code);
        showToast(`Code promo « ${code} » copié !`, "success");
      } catch {
        showToast(`Code promo : ${code}`, "info");
      }
    });
  });

  // Délégation globale des actions
  document.addEventListener("click", (e) => {
    const brand = e.target.closest(".brand-logo");
    if (brand) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.getAttribute("data-action");
    const id = actionEl.getAttribute("data-id");

    switch (action) {
      case "buy-now":
        if (id) {
          const res = store.setBuyNowItem(id);
          if (res.ok) window.openCheckoutModal?.();
          else showToast(res.message, "error");
        }
        break;

      case "add-cart":
        if (id) {
          const res = store.addToCart(id, 1);
          showToast(res.message, res.ok ? "success" : "error");
          if (res.ok) openCartDrawer();
        }
        break;

      case "open-detail":
        if (id) openProductDetail(id);
        break;

      case "ask-product":
        if (id) openCustomerDiscussion({ productId: id });
        break;

      case "open-account":
        closeMobileMenu();
        account.openModal();
        break;

      case "open-discussion":
        closeMobileMenu();
        openCustomerDiscussion();
        break;

      case "open-rescue":
        closeMobileMenu();
        window.openRescueModal?.();
        break;

      case "open-cart":
        closeMobileMenu();
        openCartDrawer();
        break;

      case "close-cart":
        closeCartDrawer();
        break;

      case "open-order-tracker":
        closeMobileMenu();
        window.openOrderTracker?.();
        break;

      case "open-legal":
        window.openLegalModal?.(actionEl.getAttribute("data-doc") || "cgv");
        break;

      case "toggle-mobile-menu":
        toggleMobileMenu();
        break;

      case "close-mobile-menu":
        closeMobileMenu();
        break;
    }
  });

  document.getElementById("cart-overlay")?.addEventListener("click", closeCartDrawer);

  const mobileNav = document.getElementById("mobile-nav-drawer");
  const mobileOverlay = document.getElementById("mobile-nav-overlay");

  function toggleMobileMenu() {
    const open = mobileNav?.classList.contains("open");
    if (open) closeMobileMenu();
    else {
      mobileNav?.classList.add("open");
      mobileOverlay?.classList.add("open");
    }
  }

  function closeMobileMenu() {
    mobileNav?.classList.remove("open");
    mobileOverlay?.classList.remove("open");
  }

  mobileOverlay?.addEventListener("click", closeMobileMenu);
  mobileNav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMobileMenu));

  // Formulaire Support 7j/7 (ouvre également un fil dans le menu Discussions !)
  const supportForm = document.getElementById("support-contact-form");
  supportForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supportForm.checkValidity()) {
      supportForm.reportValidity();
      return;
    }
    const payload = {
      name: document.getElementById("support-name").value.trim(),
      email: document.getElementById("support-email").value.trim(),
      message: document.getElementById("support-message").value.trim(),
      ...siteTracker.getPayloadMeta()
    };
    try {
      const resp = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Erreur lors de l'envoi.");
      showToast("Votre message est envoyé ! Fenêtre de suivi en direct ouverte.", "success");
      supportForm.reset();
      if (data.thread && data.threadToken) {
        openCustomerDiscussion({ resumeThread: data.thread, resumeToken: data.threadToken });
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Newsletter
  const newsletterForm = document.getElementById("newsletter-form");
  newsletterForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("newsletter-email");
    if (!input || !input.checkValidity()) {
      input?.reportValidity();
      return;
    }
    try {
      await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: input.value.trim() })
      });
      showToast("Inscription confirmée !", "success");
      input.value = "";
    } catch {
      showToast("Erreur réseau.", "error");
    }
  });

  const header = document.querySelector(".site-header");
  window.addEventListener(
    "scroll",
    () => {
      header?.classList.toggle("scrolled", window.scrollY > 24);
    },
    { passive: true }
  );
});

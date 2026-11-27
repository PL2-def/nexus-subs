import { initStaticRuntimeIfNeeded } from "./static-runtime.js";
import { store } from "./store.js";
import { initAllDialogs, initFormValidationAria, showToast } from "./mwg-helpers.js";
import { siteTracker } from "./site-tracker.js";
import { account } from "./account.js";
import { renderProductGrid, openProductDetail, openCartDrawer, closeCartDrawer, renderCartDrawer, syncDrawerScrollLock } from "./ui.js";
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
  window.openProductDetailModal = openProductDetail;

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

  // Ouverture directe depuis notification mobile Admin (?adminOrder=..., ?adminThread=..., ?adminTab=...), /admin ou #admin
  const params = new URLSearchParams(window.location.search);
  const adminOrder = params.get("adminOrder");
  const adminThread = params.get("adminThread");
  const adminTab = params.get("adminTab");
  const isAdminPath = /^\/admin\/?$/i.test(window.location.pathname);
  if (adminOrder) {
    window.history.replaceState({}, "", "/");
    admin.openModal("orders", { orderId: adminOrder });
  } else if (adminThread) {
    window.history.replaceState({}, "", "/");
    admin.openModal("discussions", { threadId: adminThread });
  } else if (adminTab) {
    window.history.replaceState({}, "", "/");
    admin.openModal(adminTab);
  } else if (window.location.hash === "#admin" || isAdminPath) {
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
  const mobileToggleBtn = document.getElementById("btn-mobile-menu-toggle");

  function toggleMobileMenu() {
    const open = mobileNav?.classList.contains("open");
    if (open) closeMobileMenu();
    else {
      mobileNav?.classList.add("open");
      mobileOverlay?.classList.add("open");
      mobileToggleBtn?.setAttribute("aria-expanded", "true");
      syncDrawerScrollLock();
    }
  }

  function closeMobileMenu() {
    mobileNav?.classList.remove("open");
    mobileOverlay?.classList.remove("open");
    mobileToggleBtn?.setAttribute("aria-expanded", "false");
    syncDrawerScrollLock();
  }

  mobileOverlay?.addEventListener("click", closeMobileMenu);
  mobileNav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMobileMenu));

  // Fermer automatiquement le tiroir mobile si le viewport repasse en mode bureau (> 1024px)
  const desktopMq = window.matchMedia("(min-width: 1025px)");
  desktopMq.addEventListener("change", (ev) => {
    if (ev.matches) closeMobileMenu();
  });

  // Gestes tactiles natifs (swipe-to-close) sur les tiroirs latéraux
  const attachDrawerSwipe = (el, direction, onClose) => {
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    el.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );
    el.addEventListener(
      "touchend",
      (e) => {
        if (!tracking || !e.changedTouches.length) return;
        tracking = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (direction === "left" && dx < -55) onClose();
          if (direction === "right" && dx > 55) onClose();
        }
      },
      { passive: true }
    );
  };
  attachDrawerSwipe(mobileNav, "left", closeMobileMenu);
  attachDrawerSwipe(document.getElementById("cart-drawer"), "right", closeCartDrawer);

  // Scrollspy discret sur la navigation PC
  const navLinks = Array.from(document.querySelectorAll('.nav-desktop .nav-link[href^="#"]'));
  const spyTargets = navLinks
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      const sec = id ? document.getElementById(id) : null;
      return sec ? { link, sec } : null;
    })
    .filter(Boolean);

  if (spyTargets.length && "IntersectionObserver" in window) {
    const visibleMap = new Map();
    const setActiveNav = (activeLink) => {
      navLinks.forEach((l) => {
        if (l === activeLink) l.setAttribute("aria-current", "true");
        else l.removeAttribute("aria-current");
      });
    };
    const spyObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibleMap.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        let best = null;
        let bestRatio = 0;
        for (const item of spyTargets) {
          const r = visibleMap.get(item.sec) || 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = item.link;
          }
        }
        setActiveNav(best);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5] }
    );
    spyTargets.forEach(({ sec }) => spyObserver.observe(sec));
  }

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
